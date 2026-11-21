# wise_smc_watch.py - Los tres sabios de Bill Williams y la estructura SMC en el servidor de la suite (20/11/2026): al
# cierre de cada vela del marco, con las reglas de App 1 (williams.py y smc.py de su backend, sin copiarlas), anota las
# senales nuevas. Nunca envia nada: ni al bot ni a otro lado. Quedan para la central de alertas de confluencia, como las
# del Swing del servidor (swing_watch.py, del que sale la forma de este modulo).
#
#   GET  /api/wsmc/status   estado de la deteccion, por moneda
#   GET  /api/wsmc/config   configuracion: encendida, marco, monedas, senales y sus parametros
#   POST /api/wsmc/config   la cambia (cada campo se valida)
#   GET  /api/wsmc/log      senales anotadas en vivo, las mas nuevas primero (?symbol=, ?limit=, ?day=AAAA-MM-DD)
#
# Datos en data/wsmc: config.json, signals/AAAA-MM-DD.jsonl (por dia UTC en que se supo cada una) y detector.lock (un
# solo proceso detecta por carpeta de datos). SUITE_WSMC=0 apaga la deteccion (sin esa variable vale SUITE_SWING, que
# las pruebas ponen en 0); las rutas siguen.
#
# Cuando se sabe cada senal (lo mismo que usa el probador de App 1):
#   - barra divergente (WD) y tres barras del AO (WA): al cerrar su vela; la entrada es una orden stop en su extremo;
#   - ruptura de fractal (WF): al cerrar la vela que pasa el fractal, del lado correcto de los dientes. El probador la
#     pone donde se supo el fractal, con la orden esperando; en vivo solo se sabe que valio cuando el precio lo pasa;
#   - ruptura de estructura (BS), order block nuevo (OB), breaker (BK) y barrido de iguales (EQ): al cerrar la vela que
#     los da. Se anotan las dos estructuras, la mayor y la interna (en la entrada, "scope").
# Ninguna de estas reglas supero al azar en la fase 1 del probador (4h, siete monedas, 20/11): son ayudas de lectura.
import asyncio
import json
import logging
import math
import os
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import smc        # App 1 (su backend esta en sys.path)
import williams   # App 1
import swing_watch

logger = logging.getLogger("suite.wsmc")

INTERVAL_MS = {"15": 900_000, "60": 3_600_000, "240": 14_400_000, "D": 86_400_000}
INTERVAL_NAMES = {"15": "15m", "60": "1h", "240": "4h", "D": "1D"}
CHECK_DELAY_MS = 4000      # tras el cierre, para que Bybit ya tenga la vela cerrada
CANDLES = 1000             # velas en cada revision: la estructura mayor de 50 velas necesita historia
LOG_MEMORY = 3000
MAX_PARALLEL = 8
CODES = ("WD", "WA", "WF", "BS", "OB", "BK", "EQ")
NAMES = {"WD": "Barra divergente", "WA": "AO tres barras", "WF": "Ruptura de fractal", "BS": "Ruptura de estructura",
         "OB": "Order block", "BK": "Breaker", "EQ": "Barrido de iguales"}
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}USDT$")
MAX_SYMBOLS = 60
DEFAULT_CONFIG = {
    "enabled": True, "interval": "240", "symbols": "all", "codes": list(CODES),
    # Los de fabrica del probador de App 1: los sabios como el libro y la estructura mayor de 50 velas e interna de 5
    "wise": {"lookback": 1, "angBars": 5, "minGapAtr": 0.0, "requireAo": True, "alligatorFilter": True},
    "smc": {"swing": 50, "internal": 5, "pick": "extreme", "area": "full", "mitigation": "close", "eqLength": 3,
            "eqThreshold": 0.1, "reclaim": True},
}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_off() -> bool:
    return os.environ.get("SUITE_WSMC", os.environ.get("SUITE_SWING", "1")) == "0"


def _iso(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat() if ms else None


def _interval(value) -> str:
    raw = str(value if value is not None else "").strip()
    text = {"15m": "15", "1h": "60", "4h": "240", "1d": "D", "1D": "D", "d": "D"}.get(raw, raw)
    if text not in INTERVAL_MS:
        raise ValueError("el marco es 15m, 1h, 4h o 1D")
    return text


def _bounded(value, name, lo, hi, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} debe ser un numero")
    if not lo <= value <= hi:
        raise ValueError(f"{name} va de {lo} a {hi}")
    return int(value) if integer else float(value)


def clean_config(body: dict, current: dict) -> dict:
    """La configuracion nueva, partiendo de la vigente. Cada campo se valida; lo que no viene queda igual."""
    if not isinstance(body, dict):
        raise ValueError("la configuracion debe ser un objeto")
    out = json.loads(json.dumps(current))
    if "enabled" in body:
        if not isinstance(body["enabled"], bool):
            raise ValueError("enabled es true o false")
        out["enabled"] = body["enabled"]
    if "interval" in body:
        out["interval"] = _interval(body["interval"])
    if "symbols" in body:
        symbols = body["symbols"]
        if symbols != "all":
            if not isinstance(symbols, list) or not symbols or len(symbols) > MAX_SYMBOLS:
                raise ValueError(f'symbols es "all" o una lista de 1 a {MAX_SYMBOLS} monedas')
            clean = []
            for s in symbols:
                if not isinstance(s, str) or not SYMBOL_RE.match(s):
                    raise ValueError(f"moneda invalida: {s!r}")
                if s not in clean:
                    clean.append(s)
            symbols = clean
        out["symbols"] = symbols
    if "codes" in body:
        codes = body["codes"]
        if not isinstance(codes, list) or not codes or any(c not in CODES for c in codes):
            raise ValueError(f"codes es una lista con algunas de {', '.join(CODES)}")
        out["codes"] = [c for c in CODES if c in codes]
    if "wise" in body:
        w = body["wise"]
        if not isinstance(w, dict):
            raise ValueError("wise debe ser un objeto")
        if "lookback" in w:
            out["wise"]["lookback"] = _bounded(w["lookback"], "lookback", 1, 20, integer=True)
        if "angBars" in w:
            out["wise"]["angBars"] = _bounded(w["angBars"], "angBars", 1, 50, integer=True)
        if "minGapAtr" in w:
            out["wise"]["minGapAtr"] = _bounded(w["minGapAtr"], "minGapAtr", 0, 10)
        for key in ("requireAo", "alligatorFilter"):
            if key in w:
                if not isinstance(w[key], bool):
                    raise ValueError(f"{key} es true o false")
                out["wise"][key] = w[key]
    if "smc" in body:
        m = body["smc"]
        if not isinstance(m, dict):
            raise ValueError("smc debe ser un objeto")
        if "swing" in m:
            out["smc"]["swing"] = _bounded(m["swing"], "swing", 5, 300, integer=True)
        if "internal" in m:
            out["smc"]["internal"] = _bounded(m["internal"], "internal", 2, 50, integer=True)
        if "eqLength" in m:
            out["smc"]["eqLength"] = _bounded(m["eqLength"], "eqLength", 2, 20, integer=True)
        if "eqThreshold" in m:
            out["smc"]["eqThreshold"] = _bounded(m["eqThreshold"], "eqThreshold", 0.01, 2)
        for key, options in (("pick", ("extreme", "opposite")), ("area", ("full", "body")), ("mitigation", ("close", "wick"))):
            if key in m:
                if m[key] not in options:
                    raise ValueError(f"{key} es {' o '.join(options)}")
                out["smc"][key] = m[key]
        if "reclaim" in m:
            if not isinstance(m["reclaim"], bool):
                raise ValueError("reclaim es true o false")
            out["smc"]["reclaim"] = m["reclaim"]
    if out["smc"]["internal"] >= out["smc"]["swing"]:
        raise ValueError("la estructura interna tiene que ser mas corta que la mayor")
    return out


def _price(x) -> str:
    """Un precio con los decimales que pide su tamano (65,432.1 · 2.3456 · 0.0001234)."""
    if x is None or not isinstance(x, (int, float)) or not math.isfinite(x):
        return "-"
    size = abs(x)
    decimals = 1 if size >= 1000 else 2 if size >= 100 else max(2, min(8, 3 - int(math.floor(math.log10(size))))) if size > 0 else 2
    return f"{x:,.{decimals}f}"


def describe(e: dict) -> str:
    """La senal en una linea, para el panel y la central de alertas."""
    up = e["dir"] > 0
    info = e.get("info") or {}
    scope = {"swing": "mayor", "internal": "interna"}.get(info.get("scope"), "")
    if e["code"] in ("WD", "WA"):
        what = "Barra divergente " + ("alcista" if up else "bajista") if e["code"] == "WD" else "AO tres barras " + ("verdes" if up else "rojas")
        return f"{what}: {'compra' if up else 'venta'} stop en {_price(info.get('entry'))}, stop en {_price(info.get('stop'))}"
    if e["code"] == "WF":
        return f"Ruptura de fractal {'alcista' if up else 'bajista'} en {_price(info.get('level'))}"
    if e["code"] == "BS":
        return f"{info.get('tag', 'BOS')} {'alcista' if up else 'bajista'} de la estructura {scope} en {_price(info.get('level'))}"
    if e["code"] == "OB":
        return f"Order block {'alcista' if up else 'bajista'} nuevo ({scope}): {_price(info.get('bottom'))} a {_price(info.get('top'))}"
    if e["code"] == "BK":
        return (f"Breaker {'alcista' if up else 'bajista'} ({scope}): se rompio el OB {'bajista' if up else 'alcista'} de "
                f"{_price(info.get('bottom'))} a {_price(info.get('top'))}")
    if e["code"] == "EQ":
        return (f"Barrido de {'minimos' if up else 'maximos'} iguales en {_price(info.get('level'))}"
                f"{', con regreso' if info.get('reclaimed') else ''}")
    return NAMES.get(e["code"], e["code"])


def detect(rows: list, interval: str, cfg: dict) -> list:
    """Las senales de las velas cerradas, cada una con `known_at` (cuando se supo, en vivo). Velas como las de Bybit."""
    if len(rows) < 60:
        return []
    bars = [{"t": r["timestamp"], "o": r["open"], "h": r["high"], "l": r["low"], "c": r["close"]} for r in rows]
    step = INTERVAL_MS[interval]
    tf = step // 60000
    codes = cfg["codes"]
    out = []
    wise_codes = tuple(c for c in codes if c in williams.CODES)
    if wise_codes:
        index = {b["t"]: i for i, b in enumerate(bars)}
        for e in williams.events(bars, tf, cfg["wise"], wise_codes):
            known = e["known"]
            if e["code"] == "WF":
                hit = index[e["t"]] + int(e["info"].get("expiry", 0))
                if hit >= len(bars):
                    continue
                known = bars[hit]["t"] + step
            out.append({**e, "known_at": known})
    smc_codes = tuple(c for c in codes if c in smc.CODES)
    if smc_codes:
        for scope in ("swing", "internal"):
            own = smc_codes if scope == "swing" else tuple(c for c in smc_codes if c != "EQ")  # los iguales no dependen de la estructura
            if own:
                out += [{**e, "known_at": e["known"]} for e in smc.events(bars, tf, {**cfg["smc"], "scope": scope}, own)]
    out.sort(key=lambda e: (e["known_at"], e["code"], -e["dir"]))
    return out


def _key(symbol, interval, e) -> str:
    return f"{symbol}|{interval}|{e['code']}|{e['dir']}|{e['t']}|{(e.get('info') or {}).get('scope', '')}"


class WiseSmcWatch:
    def __init__(self, folder: Path, symbols_source=None, fetch_recent=None, now=None):
        self.folder = Path(folder)
        self._symbols_source = symbols_source or (lambda: [])
        self._fetch_recent = fetch_recent or swing_watch.bybit_recent
        self._now = now or _now_ms
        self.config_error = None
        self.config = self._load_config()
        self.started_ms = self._now()
        self._since = self.started_ms   # una moneda o un marco nuevos solo anotan lo que se supo desde aqui
        self._state = {}
        self._recent = deque(maxlen=LOG_MEMORY)
        self._keys = set()
        self._key_order = deque()
        self._day_counts = {}
        self._lock_fh = None
        self._task = None
        self._wake = None
        self.other_process = False
        self.round = None
        self._load_recent()

    # --- configuracion ---
    def _config_path(self) -> Path:
        return self.folder / "config.json"

    def _load_config(self) -> dict:
        path = self._config_path()
        if path.exists():
            try:
                saved = json.loads(path.read_text(encoding="utf-8"))
                return clean_config(saved, json.loads(json.dumps(DEFAULT_CONFIG)))
            except (ValueError, OSError) as e:
                # Un archivo ilegible no se pisa: la deteccion queda apagada hasta que se arregle o se guarde otra
                self.config_error = f"config.json ilegible: {e}"[:200]
                return {**json.loads(json.dumps(DEFAULT_CONFIG)), "enabled": False}
        return json.loads(json.dumps(DEFAULT_CONFIG))

    def set_config(self, body: dict) -> dict:
        cfg = clean_config(body, self.config)
        path = self._config_path()
        if self.config_error and path.exists():
            # El danado se copia aparte antes de reemplazarlo, como en el Swing del servidor
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            path.with_name(f"config.danado-{stamp}.json").write_bytes(path.read_bytes())
        swing_watch._write_atomic(path, json.dumps(cfg, indent=1, ensure_ascii=False))
        changed = cfg["interval"] != self.config["interval"] or self.symbols(cfg) != self.symbols()
        self.config, self.config_error = cfg, None
        if changed:
            self._since = self._now()
            # Un marco o una moneda que se dejaron de vigilar empiezan de nuevo al volver: no se anota tarde lo de entonces
            keep = set(self.symbols(cfg))
            self._state = {k: v for k, v in self._state.items() if k[1] == cfg["interval"] and k[0] in keep}
        if self._wake is not None:
            self._wake.set()
        return cfg

    def symbols(self, cfg: dict = None) -> list:
        cfg = cfg or self.config
        if cfg["symbols"] == "all":
            try:
                return [s for s in self._symbols_source() if SYMBOL_RE.match(s)][:MAX_SYMBOLS]
            except Exception:
                return []
        return list(cfg["symbols"])

    # --- un solo proceso detecta por carpeta ---
    def _take_lock(self) -> bool:
        if self._lock_fh is not None:
            return True
        path = self.folder / "detector.lock"
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
        self._lock_fh = fh
        self._load_recent()   # lo que anoto el proceso anterior no se repite
        return True

    def _release_lock(self):
        if self._lock_fh is not None:
            try:
                if os.name == "nt":
                    import msvcrt
                    self._lock_fh.seek(0)
                    msvcrt.locking(self._lock_fh.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
            self._lock_fh.close()
            self._lock_fh = None

    # --- bucle ---
    async def start(self):
        if _env_off() or self._task is not None:
            return
        self._wake = asyncio.Event()
        self.other_process = not self._take_lock()
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, Exception):
                pass
            self._task = None
        self._release_lock()

    async def _run(self):
        while True:
            try:
                step = INTERVAL_MS[self.config["interval"]]
                now = self._now()
                wake_at = (now - CHECK_DELAY_MS) // step * step + step + CHECK_DELAY_MS
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=max(0.05, (wake_at - now) / 1000))
                    self._wake.clear()
                    continue   # cambio la configuracion: se vuelve a calcular el proximo cierre
                except asyncio.TimeoutError:
                    pass
                if not self._take_lock():
                    self.other_process = True
                    continue
                self.other_process = False
                if self.config["enabled"]:
                    await self.check_all()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[WSMC] vuelta fallida: {e}")
                await asyncio.sleep(5)

    async def check_all(self):
        cfg = self.config
        began = time.time()
        gate = asyncio.Semaphore(MAX_PARALLEL)
        symbols = self.symbols(cfg)

        async def one(symbol):
            async with gate:
                await self.check_symbol(symbol, cfg)

        await asyncio.gather(*(one(s) for s in symbols), return_exceptions=True)
        self.round = {"at": self._now(), "seconds": round(time.time() - began, 2), "symbols": len(symbols)}

    async def check_symbol(self, symbol: str, cfg: dict = None):
        """Pide las ultimas velas, detecta en las cerradas y anota lo que se supo desde la revision anterior."""
        cfg = cfg or self.config
        interval = cfg["interval"]
        step = INTERVAL_MS[interval]
        now = self._now()
        st = self._state.get((symbol, interval))
        if st is None:
            # Una moneda que aparece despues de la primera vuelta (agregada a la suite) anota desde ahora
            st = {"cut": self._since if self.round is None else max(self._since, now), "checks": 0, "signals": 0, "errors": 0, "error": None, "last_check": None,
                  "last_close": None, "last_signal": None}
            self._state[(symbol, interval)] = st
        try:
            rows = await self._fetch_recent(symbol, interval, CANDLES)
            closed = [r for r in rows if r["timestamp"] + step <= now]
            if not closed:
                raise RuntimeError("Bybit no dio velas cerradas")
            newest_close = closed[-1]["timestamp"] + step
            if newest_close > st["cut"]:
                found = await run_in_threadpool(detect, closed, interval, cfg)
                for e in found:
                    if st["cut"] < e["known_at"] <= newest_close:
                        self._record(symbol, interval, e, st)
                st["cut"] = newest_close
                st["last_close"] = newest_close
            st["checks"] += 1
            st["last_check"] = now
            st["error"] = None
        except Exception as e:
            st["errors"] += 1
            st["error"] = f"{type(e).__name__}: {e}"[:200]
            logger.warning(f"[WSMC] {symbol} {interval}: {st['error']}")

    # --- registro ---
    def _day_file(self, ms: int) -> Path:
        return self.folder / "signals" / (datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d") + ".jsonl")

    def _remember(self, key: str):
        self._keys.add(key)
        self._key_order.append(key)
        while len(self._key_order) > LOG_MEMORY * 4:
            self._keys.discard(self._key_order.popleft())

    def _record(self, symbol, interval, e, st):
        key = _key(symbol, interval, e)
        if key in self._keys:
            return
        now = self._now()
        entry = {"symbol": symbol, "interval": interval, "code": e["code"], "name": NAMES[e["code"]], "dir": e["dir"],
                 "t": e["t"], "known_at": e["known_at"], "detected_at": now, "delay_ms": now - e["known_at"],
                 "lo": e["lo"], "hi": e["hi"], "info": e.get("info") or {}, "text": describe(e)}
        path = self._day_file(e["known_at"])
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
        self._remember(key)
        self._recent.append(entry)
        self._day_counts[path.stem] = self._day_counts.get(path.stem, 0) + 1
        st["signals"] += 1
        st["last_signal"] = entry

    def _load_recent(self):
        folder = self.folder / "signals"
        files = sorted(folder.glob("*.jsonl"))[-2:] if folder.exists() else []
        entries = []
        for path in files:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue   # una linea cortada (el PC se apago al escribir) no detiene la lectura
        entries.sort(key=lambda x: (x.get("known_at") or 0, x.get("symbol") or ""))
        self._recent = deque(entries[-LOG_MEMORY:], maxlen=LOG_MEMORY)
        self._day_counts = {}
        for x in entries:
            day = self._day_file(x.get("known_at") or 0).stem
            self._day_counts[day] = self._day_counts.get(day, 0) + 1
            self._remember(_key(x.get("symbol"), x.get("interval"), x))

    def log(self, symbol: str = None, limit: int = 200, day: str = None) -> list:
        if day:
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
                raise ValueError("day es AAAA-MM-DD")
            path = self.folder / "signals" / f"{day}.jsonl"
            entries = []
            if path.exists():
                for line in path.read_text(encoding="utf-8").splitlines():
                    try:
                        entries.append(json.loads(line))
                    except ValueError:
                        continue
        else:
            entries = list(self._recent)
        if symbol:
            entries = [x for x in entries if x.get("symbol") == symbol]
        entries.sort(key=lambda x: (x.get("known_at") or 0), reverse=True)
        return entries[:max(1, min(int(limit), 5000))]

    def status(self) -> dict:
        cfg = self.config
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        symbols = self.symbols(cfg)
        by_symbol = {}
        for symbol in symbols:
            st = self._state.get((symbol, cfg["interval"])) or {}
            last = st.get("last_signal")
            by_symbol[symbol] = {"last_check": st.get("last_check"), "last_close": st.get("last_close"),
                                 "signals": st.get("signals", 0), "errors": st.get("errors", 0), "error": st.get("error"),
                                 "last_signal": {k: last[k] for k in ("code", "dir", "text", "known_at")} if last else None}
        return {"success": True, "sends": False, "rules": "app1", "enabled": cfg["enabled"],
                "env_off": _env_off(),
                "detecting": bool(self._task is not None and self._lock_fh is not None and cfg["enabled"]),
                "other_process": self.other_process, "interval": cfg["interval"], "intervalName": INTERVAL_NAMES[cfg["interval"]],
                "symbols": symbols, "allSymbols": cfg["symbols"] == "all", "codes": cfg["codes"], "names": NAMES,
                "started_at": self.started_ms, "since": self._since, "round": self.round,
                "today": self._day_counts.get(today, 0), "config_error": self.config_error, "by_symbol": by_symbol}

    def brief(self) -> dict:
        s = self.status()
        return {"detecting": s["detecting"], "enabled": s["enabled"], "interval": s["intervalName"], "symbols": len(s["symbols"]),
                "today": s["today"], "errors": sum(1 for v in s["by_symbol"].values() if v["error"]),
                "other_process": s["other_process"]}


def make_router(watch: WiseSmcWatch) -> APIRouter:
    router = APIRouter()

    @router.get("/api/wsmc/status")
    async def wsmc_status():
        return watch.status()

    @router.get("/api/wsmc/config")
    async def wsmc_config():
        return {"success": True, "config": watch.config, "defaults": DEFAULT_CONFIG, "codes": NAMES, "sends": False,
                "intervals": INTERVAL_NAMES}

    @router.post("/api/wsmc/config")
    async def wsmc_set_config(request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "el cuerpo debe ser JSON")
        try:
            return {"success": True, "config": watch.set_config(body)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get("/api/wsmc/log")
    async def wsmc_log(symbol: str = None, limit: int = 200, day: str = None):
        if symbol is not None and not SYMBOL_RE.match(symbol):
            raise HTTPException(400, "moneda invalida")
        try:
            return {"success": True, "signals": watch.log(symbol, limit, day)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    return router
