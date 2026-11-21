"""
Grabador de Hyperliquid (21/11/2026, paso 2 del plan on-chain: docs/PLAN_INDICADORES_ONCHAIN.md).

Hyperliquid es un exchange de perpetuos en su propia cadena: las posiciones de cada billetera, con su apalancamiento y
su precio de liquidación, son públicas. Su historia gratis es corta (desde 2025), así que la grabamos nosotros, como el
libro de Bybit. Solo lee, con la API pública `info` (sin clave): nunca envía órdenes ni nada a Hyperliquid.

Qué graba, en OrderFlowData/live/hyperliquid/:
- `ctx/AAAA-MM-DD.jsonl`, cada CTX_SECONDS (5 min): por moneda de la suite, interés abierto, funding, precio marca y de
  oráculo, prima y volumen de 24 h (`metaAndAssetCtxs`, un pedido para todas).
- `wallets.json`, una vez al día: del leaderboard público (stats-data, ~38 MB, unos 3 minutos), las BY_VALUE cuentas de
  más capital y las BY_VOLUME de más volumen operado en el mes, sin repetir. Las de más capital usan poco apalancamiento y
  se liquidarían lejísimos; las muy activas son las que tienen liquidaciones cerca del precio (medido el 21/11: de 150
  por volumen, 16 posiciones con la liquidación a menos de 25%, 124 M USD).
- `positions/AAAA-MM-DD.jsonl`, cada POS_SECONDS (15 min): una línea por vuelta con las posiciones de esas cuentas en
  las monedas de la suite (`clearinghouseState`, un pedido por cuenta, a PACE_SECONDS entre pedidos). Cada posición:
  [billetera, moneda, tamaño con signo, entrada, liquidación, apalancamiento, valor en USD].

Un solo grabador por carpeta (`recorder.lock`). SUITE_HL=0 lo apaga; sin esa variable vale SUITE_RECORD.
Rutas: /api/hyperliquid/status, /api/hyperliquid/ctx/{símbolo}, /api/hyperliquid/liqmap/{símbolo}.
"""
import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException

logger = logging.getLogger("hyperliquid")

INFO_URL = "https://api.hyperliquid.xyz/info"
LEADERBOARD_URL = "https://stats-data.hyperliquid.xyz/Mainnet/leaderboard"
CTX_SECONDS = 300
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


def top_wallets(rows, by_value=BY_VALUE, by_volume=BY_VOLUME):
    """Las cuentas a seguir: las by_value de más capital y las by_volume de más volumen del mes, sin repetir.
    [[dirección, capital, volumen del mes], ...]."""
    valid = []
    for row in rows:
        address, value = row.get("ethAddress"), _num(row.get("accountValue"))
        if isinstance(address, str) and address.startswith("0x") and value:
            valid.append([address.lower(), round(value, 2), round(_month_volume(row), 2)])
    picked, seen = [], set()
    for group in (sorted(valid, key=lambda x: -x[1])[:by_value], sorted(valid, key=lambda x: -x[2])[:by_volume]):
        for w in group:
            if w[0] not in seen:
                seen.add(w[0])
                picked.append(w)
    return picked


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
                      "positions": {"last": None, "error": None, "count": 0, "wallets_seen": 0, "positions": 0, "seconds": None}}
        self.latest_ctx = {}
        self.latest_positions = []

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

    async def wallets_once(self):
        r = await self.http.get(LEADERBOARD_URL, timeout=600)
        r.raise_for_status()
        data = await asyncio.to_thread(json.loads, r.content)
        rows = data.get("leaderboardRows") if isinstance(data, dict) else data
        picked = top_wallets(rows or [])
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

    async def positions_once(self):
        _, users = self.wallets()
        if not users:
            return
        started = self.now()
        coins = set(self.coins)
        found, counts = [], {"seen": 0, "failed": 0}
        queue = list(users)

        async def worker():
            while queue:
                user = queue.pop(0)
                try:
                    state = await self._info({"type": "clearinghouseState", "user": user})
                    found.extend(parse_positions(user, state, coins))
                    counts["seen"] += 1
                except Exception as e:  # Una cuenta que falla no detiene la vuelta
                    counts["failed"] += 1
                    if counts["failed"] in (1, 25, 100):
                        logger.warning(f"[HL] clearinghouseState {user[:10]}: {e}")
                await self.sleep(PACE_SECONDS)

        await asyncio.gather(*(worker() for _ in range(WORKERS)))
        seen, failed = counts["seen"], counts["failed"]
        found.sort(key=lambda p: (p[1], p[0]))
        t = int(self.now() * 1000)
        _append(self.base / "positions" / f"{day_of(t)}.jsonl", {"t": t, "wallets": seen, "failed": failed, "positions": found})
        self.latest_positions = found
        self.state["positions"].update(last=t, error=None if seen else "ninguna cuenta respondió", count=len(found),
                                       wallets_seen=seen, positions=len(found), seconds=round(self.now() - started, 1))

    # ---------- bucles ----------
    async def _loop(self, name, every, fn, first_delay=0):
        await self.sleep(first_delay)
        while True:
            t0 = self.now()
            try:
                await fn()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.state[name]["error"] = f"{type(e).__name__}: {e}"[:300]
                logger.warning(f"[HL] {name}: {e}")
            await self.sleep(max(5.0, every - (self.now() - t0)))

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
        last = last_line(self.base / "positions" / f"{day_of(int(self.now() * 1000))}.jsonl")
        if last:
            self.latest_positions = last.get("positions") or []
        self.tasks = [asyncio.create_task(self._loop("ctx", CTX_SECONDS, self.ctx_once, 5)),
                      asyncio.create_task(self._wallets_loop()),
                      asyncio.create_task(self._loop("positions", POS_SECONDS, self.positions_once, 60))]

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
        for sub in ("ctx", "positions"):
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
            "positions_last": s["positions"]["last"], "wallets": s["wallets"]["count"], "positions": s["positions"]["positions"],
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
        return {"success": True, "coin": coin, "price": price, "t": rec.state["positions"]["last"],
                "wallets": rec.state["positions"]["wallets_seen"], "positions": len(mine), "near": len(near),
                "band_pct": LIQ_BAND_PCT, **out,
                "biggest": [{"wallet": p[0], "side": "long" if p[2] > 0 else "short", "size": p[2], "entry": p[3],
                             "liq": p[4], "leverage": p[5], "usd": p[6]} for p in biggest]}

    return r
