"""
Grabador de Hyperliquid (21/11/2026, paso 2 del plan on-chain: docs/PLAN_INDICADORES_ONCHAIN.md).

Hyperliquid es un exchange de perpetuos en su propia cadena: las posiciones de cada billetera, con su apalancamiento y
su precio de liquidación, son públicas. Su historia gratis es corta (desde 2025), así que la grabamos nosotros, como el
libro de Bybit. Solo lee, con la API pública `info` (sin clave): nunca envía órdenes ni nada a Hyperliquid.

Qué graba, en OrderFlowData/live/hyperliquid/:
- `ctx/AAAA-MM-DD.jsonl`, cada CTX_SECONDS (1 min desde el 21/11; antes 5): por moneda de la suite, interés abierto, funding, precio marca y de
  oráculo, prima y volumen de 24 h (`metaAndAssetCtxs`, un pedido para todas).
- `wallets.json`, una vez al día: del leaderboard público (stats-data, ~38 MB, unos 3 minutos, leído por partes desde
  el 22/11 para no tenerlo entero en memoria: RowStream y WalletPicker), las BY_VALUE cuentas de
  más capital y las BY_VOLUME de más volumen operado en el mes, sin repetir. Las de más capital usan poco apalancamiento y
  se liquidarían lejísimos; las muy activas son las que tienen liquidaciones cerca del precio (medido el 21/11: de 150
  por volumen, 16 posiciones con la liquidación a menos de 25%, 124 M USD).
- `positions/AAAA-MM-DD.jsonl`, cada POS_SECONDS (15 min): una línea por vuelta con las posiciones de esas cuentas en
  las monedas de la suite (`clearinghouseState`, un pedido por cuenta, a PACE_SECONDS entre pedidos). Cada posición:
  [billetera, moneda, tamaño con signo, entrada, liquidación, apalancamiento, valor en USD].
- `fast/AAAA-MM-DD.jsonl`, cada FAST_SECONDS (1 min, 21/11): las posiciones de las cuentas con alguna liquidación a
  menos de FAST_BAND_PCT % del precio (hasta FAST_MAX), con el mismo formato. Las 1,200 cada minuto no se pueden: la
  API deja 1,200 de peso por minuto y cada cuenta pesa 2. Lo que se ve (latest_positions) junta las dos: de cada
  cuenta, su consulta más reciente.

Un solo grabador por carpeta (`recorder.lock`). SUITE_HL=0 lo apaga; sin esa variable vale SUITE_RECORD.
Rutas: /api/hyperliquid/status, /api/hyperliquid/ctx/{símbolo}, /api/hyperliquid/liqmap/{símbolo}.

En la nube (22/11): el collector de Northflank corre este mismo archivo (copia exacta en 5.Order_flow/cloud_collector),
guarda HL_KEEP_DAYS días (cleanup_days) y da /api/hyperliquid/days y /api/hyperliquid/file/{carpeta}/{día}?offset
(make_files_router). La suite baja lo nuevo con hl_cloud.py a live/hyperliquid_cloud, y read_rows junta las dos.
"""
import asyncio
import bisect
import codecs
import heapq
import json
import logging
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

logger = logging.getLogger("hyperliquid")

INFO_URL = "https://api.hyperliquid.xyz/info"
LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
CTX_SECONDS = 60
FAST_SECONDS = 60
FAST_BAND_PCT = 10.0
FAST_MAX = 200
POS_SECONDS = 900
WALLETS_SECONDS = 86400
BY_VALUE = 300
BY_VOLUME = 1000
WORKERS = 3                  # Pedidos de posiciones a la vez
PACE_SECONDS = 0.3           # Pausa de cada uno entre pedidos. Medido el 21/11: de uno en uno, 1,219 cuentas tardaron
                             # 10.8 min (0.53 s cada una); con 3 a la vez, unos 4 a 5 min y unos 550 de peso por minuto,
                             # de los 1,200 que deja la API (cada pedido pesa 2)
LOCK_RETRY_SECONDS = 60
LIQ_BAND_PCT = 25.0          # El mapa solo cuenta liquidaciones a menos de 25% del precio


def enabled() -> bool:
    return os.environ.get("SUITE_HL", os.environ.get("SUITE_RECORD", "1")) != "0"


def root(data_dir: Path) -> Path:
    return Path(data_dir) / "live" / "hyperliquid"


def cloud_root(data_dir: Path) -> Path:
    """Lo bajado de la nube (hl_cloud.py de la suite), aparte de lo grabado en el PC."""
    return Path(data_dir) / "live" / "hyperliquid_cloud"


def hl_coin(symbol: str) -> str:
    """Moneda de la suite (Bybit) a la de Hyperliquid: BTCUSDT → BTC, 1000PEPEUSDT → kPEPE, SHIB1000USDT → kSHIB."""
    base = symbol.upper()
    if base.endswith("USDT"):
        base = base[:-4]
    if base.startswith("1000"):
        return "k" + base[4:]
    if base.endswith("1000"):
        return "k" + base[:-4]
    return base


def day_of(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%d")


def _num(value):
    try:
        out = float(value)
    except (TypeError, ValueError):
        return None
    return out if out == out else None


def parse_ctx(meta, coins):
    """metaAndAssetCtxs → {moneda de Hyperliquid: {oi, oi_usd, funding, mark, oracle, premium, vol24}} de las pedidas."""
    universe, ctxs = meta[0]["universe"], meta[1]
    out = {}
    for info, ctx in zip(universe, ctxs):
        name = info.get("name")
        if name not in coins:
            continue
        mark, oi = _num(ctx.get("markPx")), _num(ctx.get("openInterest"))
        out[name] = {"oi": oi, "oi_usd": round(oi * mark, 2) if oi is not None and mark else None,
                     "funding": _num(ctx.get("funding")), "mark": mark, "oracle": _num(ctx.get("oraclePx")),
                     "premium": _num(ctx.get("premium")), "vol24": _num(ctx.get("dayNtlVlm"))}
    return out


def _month_volume(row):
    for window, perf in row.get("windowPerformances") or []:
        if window == "month":
            return _num((perf or {}).get("vlm")) or 0.0
    return 0.0


class WalletPicker:
    """Elige las cuentas a seguir fila por fila, sin guardar la lista entera (22/11: el leaderboard pesa ~38 MB y,
    leído de una vez, pasaba de 300 MB de memoria; el collector de la nube tiene 512 MB). Guarda solo las by_value de
    más capital y las by_volume de más volumen del mes. Da lo mismo que ordenar la lista entera: a igual valor, primero
    la que llegó antes."""

    def __init__(self, by_value=BY_VALUE, by_volume=BY_VOLUME):
        self.sizes = (by_value, by_volume)
        self.heaps = ([], [])
        self.n = 0

    def add(self, row):
        if not isinstance(row, dict):
            return
        address, value = row.get("ethAddress"), _num(row.get("accountValue"))
        if not (isinstance(address, str) and address.startswith("0x") and value):
            return
        w = [address.lower(), round(value, 2), round(_month_volume(row), 2)]
        self.n += 1
        for heap, size, key in zip(self.heaps, self.sizes, (w[1], w[2])):
            item = (key, -self.n, w)   # -n es único: la tupla nunca llega a comparar w
            if size <= 0:
                continue
            if len(heap) < size:
                heapq.heappush(heap, item)
            elif item[:2] > heap[0][:2]:
                heapq.heapreplace(heap, item)

    def result(self):
        """[[dirección, capital, volumen del mes], ...]: primero las de más capital y después las de más volumen, sin repetir."""
        picked, seen = [], set()
        for heap in self.heaps:
            for _, _, w in sorted(heap, key=lambda x: (-x[0], -x[1])):
                if w[0] not in seen:
                    seen.add(w[0])
                    picked.append(w)
        return picked


def top_wallets(rows, by_value=BY_VALUE, by_volume=BY_VOLUME):
    """Las cuentas a seguir: las by_value de más capital y las by_volume de más volumen del mes, sin repetir.
    [[dirección, capital, volumen del mes], ...]."""
    picker = WalletPicker(by_value, by_volume)
    for row in rows:
        picker.add(row)
    return picker.result()


_ROWS_KEY = re.compile(r'"leaderboardRows"\s*:\s*\[')
_SEP = re.compile(r"[\s,]*")
_DECODER = json.JSONDecoder()
MAX_ROW_CHARS = 1_000_000    # una fila a medio llegar más larga que esto es un archivo ilegible, no una fila


class RowStream:
    """Lee la lista de filas del leaderboard a medida que llegan los bytes (22/11). feed() devuelve las filas que ya
    llegaron completas; en memoria queda solo la fila a medio llegar. Acepta {"leaderboardRows": [...]} o una lista
    sola. Cada fila la lee el decodificador de JSON de Python (raw_decode): si todavía no llegó entera, espera al
    pedazo siguiente."""

    def __init__(self):
        self.decoder = codecs.getincrementaldecoder("utf-8")()
        self.buf = ""
        self.inside = False
        self.done = False

    def feed(self, chunk: bytes):
        if self.done:
            return []
        self.buf += self.decoder.decode(chunk)
        if not self.inside:
            head = self.buf.lstrip()
            if head.startswith("["):
                self.buf, self.inside = head[1:], True
            else:
                m = _ROWS_KEY.search(self.buf)
                if not m:
                    self.buf = self.buf[-64:] if head else ""   # la llave puede venir partida entre dos pedazos
                    return []
                self.buf, self.inside = self.buf[m.end():], True
        out, buf, i, n = [], self.buf, 0, len(self.buf)
        while True:
            i = _SEP.match(buf, i).end()
            if i >= n:
                break
            if buf[i] == "]":       # el cierre de la lista
                self.done = True
                break
            try:
                row, i = _DECODER.raw_decode(buf, i)
            except ValueError:      # la fila todavía no llegó entera
                if n - i > MAX_ROW_CHARS:
                    raise ValueError("el leaderboard trae una fila ilegible")
                break
            out.append(row)
        self.buf = "" if self.done else buf[i:]
        return out


def parse_positions(user, state, coins):
    """clearinghouseState → [[billetera, moneda, tamaño, entrada, liquidación, apalancamiento, valor USD], ...]."""
    out = []
    for item in (state or {}).get("assetPositions") or []:
        p = item.get("position") or {}
        coin = p.get("coin")
        size = _num(p.get("szi"))
        if coin not in coins or not size:
            continue
        lev = (p.get("leverage") or {}).get("value")
        out.append([user, coin, size, _num(p.get("entryPx")), _num(p.get("liquidationPx")), _num(lev), _num(p.get("positionValue"))])
    return out


def liq_map(positions, price, bucket_pct=0.25, band_pct=LIQ_BAND_PCT):
    """
    Mapa de liquidaciones de las posiciones seguidas: el valor en USD que se liquidaría en cada franja de precio.
    Largos (se liquidan si el precio baja) debajo del precio; cortos, encima. Solo a menos de band_pct % del precio.
    """
    if not price or price <= 0:
        return {"buckets": [], "longs_usd": 0.0, "shorts_usd": 0.0}
    step = price * bucket_pct / 100
    cells = {}
    longs = shorts = 0.0
    for user, coin, size, entry, liq, lev, value in positions:
        if not liq or liq <= 0 or not value:
            continue
        if abs(liq - price) / price * 100 > band_pct:
            continue
        side = "long" if size > 0 else "short"
        k = int((liq - price) // step)
        cell = cells.setdefault(k, {"lo": round(price + k * step, 8), "hi": round(price + (k + 1) * step, 8),
                                    "long_usd": 0.0, "short_usd": 0.0, "wallets": 0})
        cell[f"{side}_usd"] += abs(value)
        cell["wallets"] += 1
        if side == "long":
            longs += abs(value)
        else:
            shorts += abs(value)
    buckets = [cells[k] for k in sorted(cells)]
    for c in buckets:
        c["long_usd"], c["short_usd"] = round(c["long_usd"], 2), round(c["short_usd"], 2)
    return {"buckets": buckets, "longs_usd": round(longs, 2), "shorts_usd": round(shorts, 2)}


def _append(path: Path, row: dict):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")


def _write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(data), encoding="utf-8")
    tmp.replace(path)


def last_line(path: Path):
    """La última línea completa de un .jsonl (lee solo el final del archivo)."""
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            fh.seek(max(0, size - 4_000_000))
            lines = fh.read().splitlines()
    except OSError:
        return None
    for line in reversed(lines):
        try:
            return json.loads(line)
        except ValueError:
            continue
    return None


# ---------- archivos por día: limpieza, lista y lectura por partes (22/11, para la nube) ----------
KINDS = {"ctx": CTX_SECONDS, "positions": POS_SECONDS, "fast": FAST_SECONDS}   # carpeta → cada cuánto se anota
DAY_FILE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.jsonl$")
MAX_FILE_CHUNK = 8 << 20     # lo que entrega la nube por pedido


def complete_size(path: Path) -> int:
    """Bytes hasta la última línea completa: una línea a medio escribir no se entrega."""
    try:
        with open(path, "rb") as fh:
            fh.seek(0, os.SEEK_END)
            size = fh.tell()
            back = min(size, 4_000_000)
            fh.seek(size - back)
            tail = fh.read(back)
    except OSError:
        return 0
    cut = tail.rfind(b"\n")
    return size - back + cut + 1 if cut >= 0 else (0 if back == size else size - back)


def list_days(base: Path) -> dict:
    """{carpeta: {día: bytes completos}} de ctx, positions y fast."""
    out = {}
    for kind in KINDS:
        folder = base / kind
        if not folder.is_dir():
            continue
        for f in sorted(folder.iterdir()):
            m = DAY_FILE.match(f.name)
            if m:
                out.setdefault(kind, {})[m.group(1)] = complete_size(f)
    return out


def read_from(base: Path, kind: str, day: str, offset: int, limit: int = MAX_FILE_CHUNK) -> bytes:
    """Desde offset, a lo sumo limit bytes, terminando en una línea completa."""
    if kind not in KINDS or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", day or ""):
        raise ValueError("carpeta o día inválido")
    path = base / kind / f"{day}.jsonl"
    end = complete_size(path)
    if offset >= end:
        return b""
    with open(path, "rb") as fh:
        fh.seek(offset)
        data = fh.read(min(limit, end - offset))
    if offset + len(data) < end:   # cortado por el tope: hasta la última línea entera
        cut = data.rfind(b"\n")
        data = data[:cut + 1] if cut >= 0 else b""
    return data


def cleanup_days(base: Path, keep_days: int, now_ms: int) -> int:
    """Borra los días de ctx, positions y fast más viejos que keep_days (el de hoy cuenta). Devuelve cuántos."""
    if keep_days <= 0:
        return 0
    first = day_of(now_ms - (keep_days - 1) * 86_400_000)
    gone = 0
    for kind in KINDS:
        folder = base / kind
        if not folder.is_dir():
            continue
        for f in folder.iterdir():
            m = DAY_FILE.match(f.name)
            if m and m.group(1) < first:
                try:
                    f.unlink()
                    gone += 1
                except OSError:
                    pass
    return gone


def read_rows(data_dir: Path, kind: str, day: str) -> list:
    """Las líneas de un día, juntando lo del PC y lo bajado de la nube, en orden. Manda el PC: una línea de la nube
    entra solo si el PC no tiene ninguna a menos de media vuelta de ella (las dos graban las mismas vueltas, a otras
    horas)."""
    def load(path):
        rows = []
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    try:
                        rows.append(json.loads(line))
                    except ValueError:
                        continue
        except OSError:
            pass
        return [r for r in rows if isinstance(r, dict) and isinstance(r.get("t"), int)]

    mine = sorted(load(root(data_dir) / kind / f"{day}.jsonl"), key=lambda r: r["t"])
    cloud = load(cloud_root(data_dir) / kind / f"{day}.jsonl")
    half = KINDS.get(kind, 60) * 1000 // 2
    times = [r["t"] for r in mine]
    out = list(mine)
    for r in cloud:
        i = bisect.bisect_left(times, r["t"])
        near = [times[j] for j in (i - 1, i) if 0 <= j < len(times)]
        if all(abs(t - r["t"]) >= half for t in near):
            out.append(r)
    out.sort(key=lambda r: r["t"])
    return out


def make_files_router(data_dir: Path, keep_days: int) -> APIRouter:
    """Rutas para bajar los días grabados (las usa la suite contra el collector de la nube). Solo lectura."""
    r = APIRouter()
    base = root(data_dir)

    @r.get("/api/hyperliquid/days")
    async def hl_days():
        return {"now": int(time.time() * 1000), "keep_days": keep_days, "files": await asyncio.to_thread(list_days, base)}

    @r.get("/api/hyperliquid/file/{kind}/{day}")
    async def hl_file(kind: str, day: str, offset: int = 0):
        from fastapi.responses import Response
        try:
            data = await asyncio.to_thread(read_from, base, kind, day, max(0, int(offset)))
        except ValueError:
            raise HTTPException(status_code=404, detail="carpeta o día inválido")
        return Response(content=data, media_type="application/octet-stream")

    return r


class HlRecorder:
    def __init__(self, symbols, data_dir: Path, http, now=time.time, sleep=asyncio.sleep):
        self.base = root(data_dir)
        self.http = http
        self.now, self.sleep = now, sleep
        self.symbols = []
        self.coins = {}
        for s in symbols:
            self.add(s)
        self.tasks = []
        self.state = {"ctx": {"last": None, "error": None, "count": 0}, "wallets": {"last": None, "error": None, "count": 0},
                      "positions": {"last": None, "error": None, "count": 0, "wallets_seen": 0, "positions": 0, "seconds": None},
                      "fast": {"last": None, "error": None, "count": 0, "wallets_seen": 0, "positions": 0, "seconds": None}}
        self.latest_ctx = {}
        self.by_wallet = {}        # billetera -> (hora de la consulta en ms, [posiciones])

    @property
    def latest_positions(self):
        """Las posiciones a la vista: de cada cuenta, su consulta más reciente (vuelta completa o rápida)."""
        out = [p for _, rows in self.by_wallet.values() for p in rows]
        out.sort(key=lambda p: (p[1], p[0]))
        return out

    def _set_wallets(self, fetched):
        """fetched: {billetera: (hora, posiciones)}. Gana la consulta más reciente de cada cuenta."""
        for user, (t, rows) in fetched.items():
            old = self.by_wallet.get(user)
            if old is None or t >= old[0]:
                self.by_wallet[user] = (t, rows)

    def near_wallets(self, band_pct=FAST_BAND_PCT, limit=FAST_MAX):
        """Cuentas con alguna liquidación a menos de band_pct % del precio actual, de más a menos USD en riesgo."""
        marks = {c: (v or {}).get("mark") for c, v in (self.latest_ctx.get("coins") or {}).items()}
        risk = {}
        for user, (_, rows) in self.by_wallet.items():
            for _, coin, size, entry, liq, lev, value in rows:
                mark = marks.get(coin)
                if liq and mark and abs(liq - mark) / mark * 100 <= band_pct:
                    risk[user] = risk.get(user, 0.0) + abs(value or 0.0)
        return [u for u, _ in sorted(risk.items(), key=lambda x: -x[1])][:limit]

    def add(self, symbol: str):
        symbol = symbol.upper()
        if symbol not in self.symbols:
            self.symbols.append(symbol)
            self.coins[hl_coin(symbol)] = symbol

    async def _info(self, body):
        r = await self.http.post(INFO_URL, json=body, timeout=30)
        r.raise_for_status()
        return r.json()

    # ---------- las tres vueltas ----------
    async def ctx_once(self):
        meta = await self._info({"type": "metaAndAssetCtxs"})
        found = parse_ctx(meta, set(self.coins))
        t = int(self.now() * 1000)
        _append(self.base / "ctx" / f"{day_of(t)}.jsonl", {"t": t, "coins": found})
        self.latest_ctx = {"t": t, "coins": found}
        self.state["ctx"].update(last=t, error=None, count=len(found))

    async def _leaderboard_chunks(self):
        """Los bytes del leaderboard a medida que llegan (httpx.stream). Un cliente sin stream (las pruebas) da todo junto."""
        if hasattr(self.http, "stream"):
            async with self.http.stream("GET", LEADERBOARD_URL, timeout=600) as r:
                r.raise_for_status()
                async for chunk in r.aiter_bytes():
                    yield chunk
        else:
            r = await self.http.get(LEADERBOARD_URL, timeout=600)
            r.raise_for_status()
            yield r.content

    async def wallets_once(self):
        stream, picker, rows = RowStream(), WalletPicker(BY_VALUE, BY_VOLUME), 0
        async for chunk in self._leaderboard_chunks():
            for row in stream.feed(chunk):
                picker.add(row)
                rows += 1
        picked = picker.result()
        self.state["wallets"]["rows"] = rows
        if not picked:
            raise RuntimeError("el leaderboard llegó vacío")
        t = int(self.now() * 1000)
        _write_json(self.base / "wallets.json", {"t": t, "wallets": picked})
        self.state["wallets"].update(last=t, error=None, count=len(picked))

    def wallets(self):
        try:
            data = json.loads((self.base / "wallets.json").read_text(encoding="utf-8"))
            return data.get("t"), [w[0] for w in data.get("wallets") or []]
        except (OSError, ValueError):
            return None, []

    async def _fetch(self, users):
        """Consulta las cuentas (WORKERS a la vez). Devuelve ({billetera: (hora, posiciones)}, fallidas)."""
        coins = set(self.coins)
        fetched, counts = {}, {"failed": 0}
        queue = list(users)

        async def worker():
            while queue:
                user = queue.pop(0)
                try:
                    state = await self._info({"type": "clearinghouseState", "user": user})
                    fetched[user] = (int(self.now() * 1000), parse_positions(user, state, coins))
                except Exception as e:  # Una cuenta que falla no detiene la vuelta
                    counts["failed"] += 1
                    if counts["failed"] in (1, 25, 100):
                        logger.warning(f"[HL] clearinghouseState {user[:10]}: {e}")
                await self.sleep(PACE_SECONDS)

        await asyncio.gather(*(worker() for _ in range(WORKERS)))
        return fetched, counts["failed"]

    async def _round(self, name, folder, users):
        started = self.now()
        fetched, failed = await self._fetch(users)
        found = sorted((p for _, rows in fetched.values() for p in rows), key=lambda p: (p[1], p[0]))
        t = int(self.now() * 1000)
        _append(self.base / folder / f"{day_of(t)}.jsonl", {"t": t, "wallets": len(fetched), "failed": failed, "positions": found})
        if name == "positions":
            # La vuelta completa decide quién queda a la vista: una cuenta fuera de la lista o que no respondió sale,
            # salvo que una vuelta rápida la haya consultado después
            self.by_wallet = {u: v for u, v in self.by_wallet.items() if u in fetched and v[0] > fetched[u][0]}
        self._set_wallets(fetched)
        self.state[name].update(last=t, error=None if fetched or not users else "ninguna cuenta respondió", count=len(found),
                                wallets_seen=len(fetched), positions=len(found), seconds=round(self.now() - started, 1))

    async def positions_once(self):
        _, users = self.wallets()
        if not users:
            return False
        await self._round("positions", "positions", users)

    async def fast_once(self):
        users = self.near_wallets()
        if not users:
            return False
        await self._round("fast", "fast", users)

    # ---------- bucles ----------
    async def _loop(self, name, every, fn, first_delay=0):
        await self.sleep(first_delay)
        while True:
            t0 = self.now()
            done = True
            try:
                done = await fn() is not False
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.state[name]["error"] = f"{type(e).__name__}: {e}"[:300]
                logger.warning(f"[HL] {name}: {e}")
            # Sin nada que consultar todavía (la lista de cuentas sigue bajando), vuelve a mirar en 30 s: antes dormía la
            # vuelta entera, y la primera vuelta de posiciones llegaba unos 20 minutos después de abrir la suite
            await self.sleep(30.0 if not done else max(5.0, every - (self.now() - t0)))

    async def _wallets_loop(self):
        while True:
            t, users = self.wallets()
            age = None if t is None else self.now() - t / 1000
            if age is None or age >= WALLETS_SECONDS or not users:
                try:
                    await self.wallets_once()
                except asyncio.CancelledError:
                    raise
                except Exception as e:
                    self.state["wallets"]["error"] = f"{type(e).__name__}: {e}"[:300]
                    logger.warning(f"[HL] wallets: {e}")
                    await self.sleep(1800)  # Reintenta en media hora
                    continue
                age = 0
            await self.sleep(max(60.0, WALLETS_SECONDS - age))

    async def start(self):
        self.base.mkdir(parents=True, exist_ok=True)
        t, users = self.wallets()
        if t:
            self.state["wallets"].update(last=t, count=len(users))
        today = day_of(int(self.now() * 1000))
        for folder in ("positions", "fast"):  # Retoma lo de hoy: primero la vuelta completa y encima la rápida
            last = last_line(self.base / folder / f"{today}.jsonl")
            if last:
                grouped = {}
                for p in last.get("positions") or []:
                    grouped.setdefault(p[0], []).append(p)
                self._set_wallets({u: (last["t"], rows) for u, rows in grouped.items()})
        self.tasks = [asyncio.create_task(self._loop("ctx", CTX_SECONDS, self.ctx_once, 5)),
                      asyncio.create_task(self._wallets_loop()),
                      asyncio.create_task(self._loop("positions", POS_SECONDS, self.positions_once, 60)),
                      asyncio.create_task(self._loop("fast", FAST_SECONDS, self.fast_once, 90))]

    async def stop(self):
        for task in self.tasks:
            task.cancel()
        for task in self.tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self.tasks = []

    def status(self):
        size = 0
        for sub in ("ctx", "positions", "fast"):
            for p in (self.base / sub).glob("*.jsonl"):
                try:
                    size += p.stat().st_size
                except OSError:
                    pass
        return {"symbols": len(self.symbols), "coins": sorted(self.coins), "folder": str(self.base), "bytes": size,
                **{k: dict(v) for k, v in self.state.items()}}


# ---------- un grabador por servidor, con candado por carpeta ----------
_recorder: Optional[HlRecorder] = None
_waiting: Optional[asyncio.Task] = None
_lock_fh = None


def _take_lock(data_dir: Path) -> bool:
    global _lock_fh
    if _lock_fh is not None:
        return True
    path = root(data_dir) / "recorder.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(path, "a+b")
    try:
        fh.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return False
    _lock_fh = fh
    return True


async def start(symbols, data_dir: Path, http):
    """Arranca el grabador. No lanza excepciones. Si otro proceso ya graba esta carpeta, reintenta cada minuto."""
    global _recorder, _waiting
    if not enabled() or _recorder is not None or _waiting is not None:
        return

    async def begin():
        global _recorder
        rec = HlRecorder(symbols, Path(data_dir), http)
        await rec.start()
        _recorder = rec
        print(f"[SUITE] Hyperliquid: grabando {len(rec.coins)} monedas en {rec.base}")

    try:
        if _take_lock(Path(data_dir)):
            await begin()
            return
    except Exception as e:
        logger.error(f"[HL] no se pudo iniciar: {e}")
        print(f"[SUITE] Grabador de Hyperliquid no iniciado: {e}")
        return
    print("[SUITE] Hyperliquid: otro proceso ya graba esta carpeta; se reintenta cada minuto")

    async def wait():
        global _waiting
        while True:
            await asyncio.sleep(LOCK_RETRY_SECONDS)
            try:
                if _take_lock(Path(data_dir)):
                    _waiting = None
                    await begin()
                    return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[HL] candado: {e}")

    _waiting = asyncio.create_task(wait())


async def stop():
    global _recorder, _waiting
    if _waiting is not None:
        _waiting.cancel()
        _waiting = None
    if _recorder is not None:
        await _recorder.stop()
        _recorder = None


def add_symbol(symbol: str):
    if _recorder is not None:
        _recorder.add(symbol)


def brief() -> dict:
    if _recorder is None:
        return {"enabled": enabled(), "running": False, "other_process_records": _waiting is not None}
    s = _recorder.state
    return {"enabled": True, "running": True, "coins": len(_recorder.coins), "ctx_last": s["ctx"]["last"],
            "positions_last": s["positions"]["last"], "fast_last": s["fast"]["last"], "fast_wallets": s["fast"]["wallets_seen"],
            "wallets": s["wallets"]["count"], "positions": len(_recorder.latest_positions),
            "errors": {k: v["error"] for k, v in s.items() if v.get("error")}}


def make_router() -> APIRouter:
    r = APIRouter()

    def need():
        if _recorder is None:
            raise HTTPException(status_code=503, detail="Hyperliquid no se está grabando en este servidor")
        return _recorder

    def coin_of(rec, symbol):
        coin = hl_coin(symbol)
        if coin not in rec.coins:
            raise HTTPException(status_code=404, detail="moneda que no se graba")
        return coin

    @r.get("/api/hyperliquid/status")
    async def hl_status():
        if _recorder is None:
            return {"success": True, **brief()}
        return {"success": True, **brief(), **_recorder.status()}

    @r.get("/api/hyperliquid/ctx/{symbol}")
    async def hl_ctx(symbol: str):
        rec = need()
        coin = coin_of(rec, symbol)
        latest = rec.latest_ctx
        return {"success": True, "coin": coin, "t": latest.get("t"), **((latest.get("coins") or {}).get(coin) or {})}

    @r.get("/api/hyperliquid/liqmap/{symbol}")
    async def hl_liqmap(symbol: str, bucket_pct: float = 0.25, top: int = 10):
        rec = need()
        coin = coin_of(rec, symbol)
        price = ((rec.latest_ctx.get("coins") or {}).get(coin) or {}).get("mark")
        mine = [p for p in rec.latest_positions if p[1] == coin]
        bucket_pct = max(0.05, min(float(bucket_pct), 5.0))
        out = liq_map(mine, price, bucket_pct)
        near = [p for p in mine if p[4] and price and abs(p[4] - price) / price * 100 <= LIQ_BAND_PCT]
        biggest = sorted(near, key=lambda p: -abs(p[6] or 0))[:max(0, min(int(top), 50))]
        updated = max([v[0] for v in rec.by_wallet.values()] or [0]) or None
        return {"success": True, "coin": coin, "price": price, "t": updated, "full_t": rec.state["positions"]["last"],
                "fast_t": rec.state["fast"]["last"],
                "wallets": rec.state["positions"]["wallets_seen"], "positions": len(mine), "near": len(near),
                "band_pct": LIQ_BAND_PCT, **out,
                "biggest": [{"wallet": p[0], "side": "long" if p[2] > 0 else "short", "size": p[2], "entry": p[3],
                             "liq": p[4], "leverage": p[5], "usd": p[6]} for p in biggest]}

    return r
