# swing_watch.py - Swing del servidor de la suite (paso 5, parte A): detecta las senales al cierre de cada vela con
# las reglas de App 1 (swing_rules.py) y las anota. Nunca envia nada: ni al bot ni a otro lado. Las alertas quedan
# para la central de alertas de confluencia.
#
#   GET  /api/swing/status                 estado de la deteccion, por moneda
#   GET  /api/swing/config                 configuracion: monedas, marco, reglas generales y por moneda, VWAP
#   POST /api/swing/config                 cambia la configuracion (cada campo se valida)
#   GET  /api/swing/signals/{symbol}       senales de las velas cerradas que tiene el grafico, con las reglas del servidor
#   GET  /api/swing/log                    senales detectadas en vivo, las mas nuevas primero
#   POST /api/swing/profile-rects/{symbol} rectangulos que definen un VP Fixed: no cuentan para el filtro VWAP
#
# Datos en data/swing: config.json, signals/AAAA-MM-DD.jsonl (por dia UTC de la confirmacion), rules.jsonl (cada
# conjunto de reglas usado, con su id) y detector.lock (un solo proceso detecta por carpeta de datos).
# La primera vez, la configuracion se toma de la del Swing de la Watchlist (App 2), que solo se lee.
# SUITE_SWING=0 apaga la deteccion; las rutas siguen.
import asyncio
import hashlib
import importlib.util
import json
import logging
import os
import re
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response

import candles
import swing_rules
from settings import CONFIG, REPO_DIR

logger = logging.getLogger("suite.swing")

INTERVAL_MS = swing_rules.INTERVAL_MS
CHECK_DELAY_MS = 4000        # tras el cierre de la vela, para que Bybit ya la tenga cerrada
RECOVER_CANDLES = 120        # velas de mas en cada consulta: cubren una pausa de hasta 120 velas del marco
LOG_MEMORY = 5000            # senales recientes en memoria para /api/swing/log
MAX_PARALLEL = 12            # monedas pedidas a Bybit a la vez en cada vuelta
CHART_RECENT = 200           # velas que la ruta del grafico vuelve a pedir en cada actualizacion
CHART_FULL_MS = 6 * 3_600_000    # cada tanto, las velas del grafico se piden completas otra vez
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}USDT$")
MAX_SYMBOLS = 60
RULE_KEYS = ("swingBars", "direction", "volumeFilter", "vwapFilter", "priceZones")
CONFIG_KEYS = ("enabled", "interval", "symbols", "rules", "symbolRules", "vwap")
WATCHLIST_CONFIG = REPO_DIR / "2.WatchlistConIndicadores" / "backend" / "config" / "swing_config.json"

# La configuracion del Swing de la Watchlist el 12/11/2026, por si su archivo no se puede leer
_WATCHLIST_COINS = ["BTCUSDT", "ETHUSDT", "XRPUSDT", "TRXUSDT", "GALAUSDT", "SUIUSDT", "TRBUSDT", "SOLUSDT", "ADAUSDT",
                    "DOGEUSDT", "ARBUSDT"]
WATCHLIST_FALLBACK = {
    "interval": "1",
    "symbols": _WATCHLIST_COINS,
    "swingBars": 3, "direction": "BOTH",
    "volumeFilter": {"enabled": False, "minZScore": 1, "lookbackBars": 10},
    "vwapFilter": {"enabled": False, "deviations": [1, 2, 3], "marginPercent": 20, "skipVolumeInRectangle": False},
    "priceZones": [],
    "symbolConfigs": {
        **{s: {"swingBars": 2, "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}}
           for s in _WATCHLIST_COINS if s != "ARBUSDT"},
        "ETHUSDT": {"swingBars": 2, "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50},
                    "vwapFilter": {"enabled": False, "deviations": [2, 3], "marginPercent": 20, "skipVolumeInRectangle": False}},
    },
}
# VWAP del filtro: los valores de fabrica del indicador VWAP de App 1
DEFAULT_VWAP = {"vwapType": "session", "resetHour": 0, "rollingPeriod": 20, "bandMultipliers": [1.0, 2.0, 3.0],
                "applyCryptoAdjustment": True, "anchorTimestamp": None}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _iso(ms) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).isoformat() if ms else None


def _interval(value) -> str:
    text = str(value if value is not None else "").strip().lower()
    if text.endswith("h") and text[:-1].isdigit():
        text = str(int(text[:-1]) * 60)
    elif text.endswith("m") and text[:-1].isdigit():
        text = text[:-1]
    if text not in INTERVAL_MS:
        raise ValueError("el marco es 1, 5, 15, 60 o 240 minutos")
    return text


def _write_atomic(path: Path, text: str):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


# ---------- configuracion ----------
def clean_vwap(value, base: dict) -> dict:
    if not isinstance(value, dict):
        raise ValueError("vwap debe ser un objeto")
    out = dict(base)
    if "vwapType" in value:
        if value["vwapType"] not in ("session", "anchored", "rolling"):
            raise ValueError("vwapType es session, anchored o rolling")
        out["vwapType"] = value["vwapType"]
    if "resetHour" in value:
        out["resetHour"] = swing_rules._bounded(value["resetHour"], "resetHour", 0, 23, integer=True)
    if "rollingPeriod" in value:
        out["rollingPeriod"] = swing_rules._bounded(value["rollingPeriod"], "rollingPeriod", 2, 5000, integer=True)
    if "bandMultipliers" in value:
        mults = value["bandMultipliers"]
        if not isinstance(mults, list) or not 1 <= len(mults) <= 6 or not all(swing_rules._number(m) and 0 < m <= 10 for m in mults):
            raise ValueError("bandMultipliers es una lista de 1 a 6 numeros mayores que 0")
        out["bandMultipliers"] = [float(m) for m in mults]
    if "applyCryptoAdjustment" in value:
        out["applyCryptoAdjustment"] = bool(value["applyCryptoAdjustment"])
    if "anchorTimestamp" in value:
        anchor = value["anchorTimestamp"]
        if anchor is not None and not (swing_rules._number(anchor) and anchor > 0):
            raise ValueError("anchorTimestamp es una hora en milisegundos o null")
        out["anchorTimestamp"] = int(anchor) if anchor is not None else None
    if out["vwapType"] == "anchored" and not out["anchorTimestamp"]:
        raise ValueError("el VWAP anclado necesita anchorTimestamp")
    return out


def _symbols(value) -> list:
    if not isinstance(value, list) or not value:
        raise ValueError("symbols es una lista con al menos una moneda")
    out = []
    for s in value:
        s = str(s).strip().upper()
        if not SYMBOL_RE.match(s):
            raise ValueError(f"moneda invalida: {s} (como LINKUSDT)")
        if s not in out:
            out.append(s)
    if len(out) > MAX_SYMBOLS:
        raise ValueError(f"maximo {MAX_SYMBOLS} monedas")
    return out


def _clean_part(part: dict, base: dict) -> dict:
    """Ajustes propios de una moneda: solo los campos que trae, ya validados sobre las reglas generales."""
    if not isinstance(part, dict):
        raise ValueError("los ajustes de una moneda deben ser un objeto")
    unknown = set(part) - set(RULE_KEYS)
    if unknown:
        raise ValueError(f"campos desconocidos en las reglas: {', '.join(sorted(unknown))}")
    full = swing_rules.clean_rules(part, base=base)
    out = {}
    for key in RULE_KEYS:
        if key not in part:
            continue
        if key in ("volumeFilter", "vwapFilter"):
            out[key] = {k: full[key][k] for k in part[key] if k in full[key]}
        else:
            out[key] = full[key]
    return out


def _minimal_part(part: dict, base: dict, current: dict = None) -> dict:
    """Los ajustes de una moneda que llegan del grafico, sobre los que ya tenia (`current`): lo que no se manda queda
    como estaba. Se guarda solo lo que difiere de las reglas generales, asi un cambio de las generales sigue valiendo
    para lo que la moneda no cambio."""
    _clean_part(part, base)   # campos conocidos y valores validos
    full = swing_rules.clean_rules(part, base=swing_rules.clean_rules(current or {}, base=base))
    out = {}
    for key in RULE_KEYS:
        if key in ("volumeFilter", "vwapFilter"):
            diff = {k: v for k, v in full[key].items() if base[key].get(k) != v}
            if diff:
                out[key] = diff
        elif full[key] != base[key]:
            out[key] = full[key]
    return out


def clean_config(body: dict, current: dict) -> dict:
    """La configuracion nueva: `body` sobre `current`, campo por campo. Un valor invalido: ValueError."""
    if not isinstance(body, dict):
        raise ValueError("la configuracion debe ser un objeto")
    unknown = set(body) - set(CONFIG_KEYS) - {"profileRectIds", "source", "updated_at", "version"}
    if unknown:
        raise ValueError(f"campos desconocidos: {', '.join(sorted(unknown))}")
    out = json.loads(json.dumps(current))
    if "enabled" in body:
        if not isinstance(body["enabled"], bool):
            raise ValueError("enabled es true o false")
        out["enabled"] = body["enabled"]
    if "interval" in body:
        out["interval"] = _interval(body["interval"])
    if "symbols" in body:
        out["symbols"] = _symbols(body["symbols"])
    if "rules" in body:
        out["rules"] = swing_rules.clean_rules(body["rules"], base=out["rules"])
    if "symbolRules" in body:
        parts = body["symbolRules"]
        if not isinstance(parts, dict):
            raise ValueError("symbolRules es un objeto por moneda")
        for symbol, part in parts.items():
            if not SYMBOL_RE.match(str(symbol)):
                raise ValueError(f"moneda invalida en symbolRules: {symbol}")
            part = _minimal_part(part, out["rules"], out["symbolRules"].get(symbol)) if part else None
            if part:
                out["symbolRules"][symbol] = part
            else:
                out["symbolRules"].pop(symbol, None)   # null, {} o igual a las generales: sin ajustes propios
    # Las de cada moneda se validan otra vez sobre las reglas generales nuevas
    out["symbolRules"] = {s: _clean_part(p, out["rules"]) for s, p in out["symbolRules"].items()}
    if "vwap" in body:
        out["vwap"] = clean_vwap(body["vwap"], out["vwap"])
    if "profileRectIds" in body:
        out["profileRectIds"] = _profile_rects(body["profileRectIds"])
    if isinstance(body.get("source"), str):
        out["source"] = body["source"][:40]
    return out


def _profile_rects(value) -> dict:
    if not isinstance(value, dict):
        raise ValueError("profileRectIds es un objeto por moneda")
    out = {}
    for symbol, ids in value.items():
        if not SYMBOL_RE.match(str(symbol)):
            raise ValueError(f"moneda invalida: {symbol}")
        out_ids = _rect_ids(ids)
        if out_ids:
            out[symbol] = out_ids
    return out


def _rect_ids(ids) -> list:
    if not isinstance(ids, list) or len(ids) > 500 or not all(isinstance(i, str) and 0 < len(i) <= 120 for i in ids):
        raise ValueError("ids es una lista de hasta 500 textos")
    return sorted(set(ids))


def base_config() -> dict:
    return {"version": 1, "enabled": True, "interval": "15", "symbols": ["BTCUSDT"],
            "rules": swing_rules.clean_rules({}), "symbolRules": {}, "vwap": dict(DEFAULT_VWAP), "profileRectIds": {},
            "source": "fabrica"}


def from_watchlist(data: dict) -> dict:
    """La configuracion del Swing de la Watchlist (swing_config.json de App 2) en la forma de la suite. Toma las
    monedas, el marco y las reglas; deja fuera las alertas, el cooldown y los dias, que aqui no se usan."""
    cfg = base_config()
    rules = swing_rules.clean_rules({k: data[k] for k in RULE_KEYS if k in data})
    symbol_rules = {}
    for symbol, part in (data.get("symbolConfigs") or {}).items():
        if SYMBOL_RE.match(str(symbol)) and isinstance(part, dict):
            part = {k: part[k] for k in RULE_KEYS if k in part}
            if part:
                symbol_rules[symbol] = _clean_part(part, rules)
    cfg.update({"interval": _interval(data.get("interval", "1")), "symbols": _symbols(data.get("symbols") or _WATCHLIST_COINS),
                "rules": rules, "symbolRules": symbol_rules, "source": "watchlist"})
    return cfg


# ---------- Bybit y VWAP ----------
async def bybit_recent(symbol: str, interval: str, limit: int) -> list:
    """Las ultimas `limit` velas de Bybit (la ultima puede estar en curso), en orden."""
    http = candles.client()
    params = {"category": "linear", "symbol": symbol, "interval": interval, "limit": max(1, min(int(limit), 1000))}
    data = None
    for attempt in range(4):
        await candles.bybit_turn()
        try:
            r = await http.get(f"{CONFIG['bybit_url']}/v5/market/kline", params=params)
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            if attempt >= 2:
                raise RuntimeError(f"Bybit no respondio las velas: {type(e).__name__}")
            await asyncio.sleep(1 + attempt)
            continue
        if isinstance(data, dict) and data.get("retCode") == candles.TOO_MANY_VISITS and attempt < 3:
            await asyncio.sleep(1.2 + attempt)   # "Too many visits": pasa la ventana de 1 s de Bybit
            continue
        break
    if not isinstance(data, dict) or data.get("retCode") != 0:
        raise RuntimeError(f"Bybit: {(data or {}).get('retMsg') if isinstance(data, dict) else 'respuesta invalida'}")
    rows, seen = [], set()
    for c in (data.get("result") or {}).get("list") or []:
        ts = int(c[0])
        if ts in seen:
            continue
        seen.add(ts)
        rows.append({"timestamp": ts, "open": float(c[1]), "high": float(c[2]), "low": float(c[3]),
                     "close": float(c[4]), "volume": float(c[5])})
    rows.sort(key=lambda c: c["timestamp"])
    return rows


def chart_days(interval: str, days=None) -> int:
    """Dias de velas de un grafico: los que pide (la Watchlist pide menos) y a lo sumo los de /api/historical."""
    top = candles.LIVE_DAYS[interval]
    try:
        return max(1, min(int(days), top)) if days else top
    except (TypeError, ValueError):
        return top


async def chart_candles(symbol: str, interval: str, days: int = None) -> list:
    """Las velas del grafico en vivo: los mismos dias y la misma cache de 5 s que /api/historical. Al abrir la pagina
    el grafico acaba de pedirlas: asi no se piden dos veces a Bybit."""
    return await candles.cached_klines(symbol, interval, chart_days(interval, days))


_vwap_module = None


def vwap_calculator():
    """El calculador de VWAP de App 1, cargado por su ruta: el backend de Order Flow tiene otro con el mismo nombre."""
    global _vwap_module
    if _vwap_module is None:
        path = Path(CONFIG["app1_backend"]) / "vwap_calculator.py"
        spec = importlib.util.spec_from_file_location("app1_vwap_calculator", path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        _vwap_module = module
    return _vwap_module.vwap_calculator


def vwap_points(rows: list, vwap: dict) -> list:
    """Puntos del VWAP con bandas, como /api/vwap con los mismos ajustes (y la misma regla de App 1)."""
    config = {"reset_hour": vwap["resetHour"], "anchor_timestamp": vwap["anchorTimestamp"],
              "rolling_period": vwap["rollingPeriod"], "band_multipliers": vwap["bandMultipliers"],
              "apply_crypto_adjustment": vwap["applyCryptoAdjustment"]}
    points = vwap_calculator().calculate_vwap_with_bands(rows, vwap["vwapType"], config)
    return [{"timestamp": p["timestamp"], "vwap": p["vwap"], "bands": p.get("bands", {})} for p in points]


# ---------- servicio ----------
class SwingWatch:
    def __init__(self, folder: Path, drawings_dir: Path, fetch_recent=None, fetch_chart=None, now=None,
                 watchlist_config: Path = None):
        self.folder = Path(folder)
        self.drawings_dir = Path(drawings_dir)
        self._fetch_recent = fetch_recent or bybit_recent
        self._fetch_chart = fetch_chart or chart_candles
        self._now = now or _now_ms
        self._watchlist_config = Path(watchlist_config) if watchlist_config else WATCHLIST_CONFIG
        self.config_error = None
        self.config = self._load_config()
        self.started_ms = self._now()
        self._since = self.started_ms    # una moneda o un marco nuevos solo anotan lo confirmado desde aqui
        self._state = {}                 # (moneda, marco) -> estado de su deteccion
        self._recent = deque(maxlen=LOG_MEMORY)
        self._keys = set()
        self._key_order = deque()
        self._rule_ids = set()
        self._day_counts = {}            # dia UTC -> senales anotadas (las del archivo y las nuevas)
        self._drawings = {}
        self._vwap_cache = {}
        self._chart_rows_cache = {}      # (moneda, marco) -> velas del grafico ya pedidas
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
                return clean_config(json.loads(path.read_text(encoding="utf-8")), base_config())
            except Exception as e:
                # Un archivo danado no se pisa: sin deteccion hasta que se guarde una configuracion, y entonces se copia aparte
                self.config_error = f"{type(e).__name__}: {e}"[:300]
                logger.error(f"[SWING] configuracion ilegible ({path}): {e}")
                cfg = base_config()
                cfg["enabled"] = False
                return cfg
        try:
            cfg = from_watchlist(json.loads(self._watchlist_config.read_text(encoding="utf-8")))
        except Exception as e:
            logger.warning(f"[SWING] sin la configuracion de la Watchlist ({e}); se usa la del 12/11")
            cfg = from_watchlist(WATCHLIST_FALLBACK)
            cfg["source"] = "watchlist_12_11"
        self._save(cfg)
        return cfg

    def _save(self, cfg: dict):
        path = self._config_path()
        if self.config_error and path.exists():
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            backup = path.with_name(f"config.danado-{stamp}.json")
            backup.write_bytes(path.read_bytes())
            self.config_error = None
        cfg = dict(cfg, updated_at=datetime.now(timezone.utc).isoformat())
        _write_atomic(path, json.dumps(cfg, ensure_ascii=False, indent=1))

    def set_config(self, body: dict) -> dict:
        if not isinstance(body, dict):
            raise ValueError("la configuracion debe ser un objeto")
        unknown = set(body) - set(CONFIG_KEYS)
        if unknown:
            raise ValueError(f"campos desconocidos: {', '.join(sorted(unknown))}")
        new = clean_config(body, self.config)
        new["source"] = self.config.get("source")
        old = self.config
        self._save(new)
        if new["interval"] != old["interval"]:
            self._state.clear()
            self._since = self._now()
        elif set(new["symbols"]) - set(old["symbols"]):
            self._since = self._now()
        self.config = new
        self._vwap_cache.clear()
        if self._wake is not None:
            self._wake.set()
        return new

    def set_profile_rects(self, symbol: str, ids) -> list:
        ids = _rect_ids(ids)
        new = json.loads(json.dumps(self.config))
        if ids:
            new["profileRectIds"][symbol] = ids
        else:
            new["profileRectIds"].pop(symbol, None)
        self._save(new)
        self.config = new
        return ids

    def rules_for(self, symbol: str, cfg: dict = None) -> dict:
        cfg = cfg or self.config
        part = cfg["symbolRules"].get(symbol)
        return swing_rules.clean_rules(part, base=cfg["rules"]) if part else cfg["rules"]

    # --- candado: un solo proceso detecta por carpeta de datos ---
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
        if os.environ.get("SUITE_SWING", "1") == "0" or self._task is not None:
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
                # El proximo cierre mas la espera, despues de ahora: un cambio de configuracion entre el cierre y la
                # revision no se salta esa revision
                wake_at = (now - CHECK_DELAY_MS) // step * step + step + CHECK_DELAY_MS
                try:
                    await asyncio.wait_for(self._wake.wait(), timeout=max(0.05, (wake_at - now) / 1000))
                    self._wake.clear()
                    continue   # cambio la configuracion: se vuelve a calcular la hora del proximo cierre
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
                logger.error(f"[SWING] vuelta fallida: {e}")
                await asyncio.sleep(5)

    async def check_all(self):
        cfg = self.config
        began = time.time()
        gate = asyncio.Semaphore(MAX_PARALLEL)

        async def one(symbol):
            async with gate:
                await self.check_symbol(symbol, cfg)

        await asyncio.gather(*(one(s) for s in cfg["symbols"]), return_exceptions=True)
        self.round = {"at": self._now(), "seconds": round(time.time() - began, 2), "symbols": len(cfg["symbols"])}

    async def check_symbol(self, symbol: str, cfg: dict = None):
        """Revisa las velas cerradas de la moneda y anota las senales confirmadas desde la revision anterior."""
        cfg = cfg or self.config
        interval = cfg["interval"]
        step = INTERVAL_MS[interval]
        rules = self.rules_for(symbol, cfg)
        n, lookback = rules["swingBars"], rules["volumeFilter"]["lookbackBars"]
        now = self._now()
        st = self._state.get((symbol, interval))
        if st is None:
            st = {"cut": self._since, "checks": 0, "signals": 0, "errors": 0, "error": None, "last_check": None,
                  "last_close": None, "last_signal": None, "missed": None}
            self._state[(symbol, interval)] = st
        st["last_try"] = now
        try:
            rows = await self._fetch_recent(symbol, interval, max(n, lookback) + 2 * n + 1 + RECOVER_CANDLES)
            closed = [c for c in rows if c["timestamp"] + step <= now]
            if not closed:
                raise RuntimeError("Bybit no dio velas cerradas")
            newest_close = closed[-1]["timestamp"] + step
            if newest_close > st["cut"]:
                first = max(n, lookback)
                if len(closed) > first + n:
                    earliest = closed[first]["timestamp"] + (n + 1) * step
                    if earliest > st["cut"] + step:
                        st["missed"] = {"from": st["cut"], "to": earliest - step, "at": now}
                signals, _ = await self._detect(symbol, interval, closed, rules, since=st["cut"])
                for s in signals:
                    if swing_rules.known_at(s["timestamp"], n, interval) > st["cut"]:
                        self._record(symbol, interval, s, rules, closed, st)
                st["cut"] = newest_close
                st["last_close"] = newest_close
            st["checks"] += 1
            st["last_check"] = now
            st["error"] = None
        except Exception as e:
            st["errors"] += 1
            st["error"] = f"{type(e).__name__}: {e}"[:200]
            logger.warning(f"[SWING] {symbol} {interval}: {st['error']}")

    async def _detect(self, symbol, interval, closed, rules, since=None, days=None):
        """Senales de las velas cerradas. El VWAP se calcula solo si su filtro esta encendido y hay rectangulos en las
        horas revisadas: si no hay, el resultado es el mismo con o sin VWAP. Devuelve (senales, uso el VWAP)."""
        points, rects = None, []
        if rules["vwapFilter"]["enabled"]:
            rects = self.rect_zones(symbol)
            n, step = rules["swingBars"], INTERVAL_MS[interval]
            lo = closed[0]["timestamp"] if since is None else since - (n + 1) * step + 1
            hi = closed[-1]["timestamp"]
            zones = rects + [z for z in rules.get("priceZones", []) if z.get("sourceRectId") and z.get("enabled")]
            if any(not z.get("timeBound") or (z["timeEnd"] >= lo and z["timeStart"] <= hi) for z in zones):
                points = await self._vwap(symbol, interval, days)
        signals = await run_in_threadpool(swing_rules.detect, closed, rules, symbol, points, rects)
        return signals, points is not None

    async def chart_rows(self, symbol: str, interval: str, days: int = None) -> list:
        """Las velas del grafico (los dias por marco de /api/historical). La primera vez se piden completas; despues,
        solo las ultimas 200, unidas a las de antes: cada cierre cuesta un pedido a Bybit y no cinco. Cada 6 horas, o
        si faltan velas entre unas y otras, se piden completas otra vez.
        Una vela cuenta como cerrada 4 s despues de su cierre, como en la deteccion en vivo: `in_progress` marca las
        demas, que no se revisan. Las de antes que podian estar en curso quedan siempre dentro de las 200 nuevas.
        `days`: los del grafico que pregunta (la Watchlist pide menos); por omision, los de /api/historical."""
        step = INTERVAL_MS[interval]
        days = chart_days(interval, days)
        key = (symbol, interval, days)
        asked = self._now()
        hit = self._chart_rows_cache.get(key)
        rows, full_at = None, asked
        if hit and hit["rows"] and asked - hit["full_at"] < CHART_FULL_MS:
            recent = await self._fetch_recent(symbol, interval, CHART_RECENT)
            if recent and recent[0]["timestamp"] <= hit["rows"][-1]["timestamp"] + step:
                merged = {c["timestamp"]: c for c in hit["rows"]}
                merged.update((c["timestamp"], dict(c)) for c in recent)
                rows, full_at = [merged[t] for t in sorted(merged)], hit["full_at"]
        open_when_asked = set()
        if rows is None:
            rows = [dict(c) for c in await self._fetch_chart(symbol, interval, days)]
            # Pueden venir de la cache: la que estaba en curso cuando se pidieron sigue sin contar aunque ya cerro.
            # Lo que aun no fuera final se corrige en la actualizacion siguiente, que trae de nuevo las ultimas 200
            open_when_asked = {c["timestamp"] for c in rows if c.get("in_progress")}
        start = asked - days * 86_400_000
        rows = [c for c in rows if c["timestamp"] >= start]
        for c in rows:
            c["in_progress"] = c["timestamp"] in open_when_asked or c["timestamp"] + step > asked - CHECK_DELAY_MS
        self._chart_rows_cache[key] = {"rows": rows, "full_at": full_at}
        return rows

    async def _vwap(self, symbol: str, interval: str, days: int = None) -> list:
        """El VWAP con las velas del grafico que pregunta (sus dias), como lo calcula su indicador VWAP."""
        vwap = self.config["vwap"]
        days = chart_days(interval, days)
        rows = await self.chart_rows(symbol, interval, days)
        key = (symbol, interval, days, json.dumps(vwap, sort_keys=True))
        stamp = (rows[-1]["timestamp"], len(rows)) if rows else None
        hit = self._vwap_cache.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
        points = await run_in_threadpool(vwap_points, rows, vwap)
        self._vwap_cache[key] = (stamp, points)
        return points

    def rect_zones(self, symbol: str) -> list:
        """Rectangulos de los dibujos de la moneda (los mismos que ve el grafico), menos los de un VP Fixed."""
        path = self.drawings_dir / f"{symbol}.json"
        try:
            mtime = path.stat().st_mtime_ns
        except FileNotFoundError:
            return []
        hit = self._drawings.get(symbol)
        if not hit or hit[0] != mtime:
            shapes = json.loads(path.read_text(encoding="utf-8")).get("shapes") or []
            hit = (mtime, shapes)
            self._drawings[symbol] = hit
        return swing_rules.rectangle_zones(hit[1], self.config["profileRectIds"].get(symbol, []))

    # --- registro ---
    def _day_file(self, ms: int) -> Path:
        return self.folder / "signals" / (datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d") + ".jsonl")

    def _rules_id(self, rules: dict) -> str:
        text = json.dumps(rules, sort_keys=True, separators=(",", ":"))
        rid = hashlib.sha1(text.encode("utf-8")).hexdigest()[:10]
        if rid not in self._rule_ids:
            self._rule_ids.add(rid)
            path = self.folder / "rules.jsonl"
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps({"id": rid, "rules": rules, "first_seen": _iso(self._now())}, ensure_ascii=False) + "\n")
        return rid

    def _remember(self, key: str):
        self._keys.add(key)
        self._key_order.append(key)
        while len(self._key_order) > LOG_MEMORY * 4:
            self._keys.discard(self._key_order.popleft())

    def _record(self, symbol, interval, s, rules, closed, st):
        key = f"{symbol}|{interval}|{s['type']}|{s['timestamp']}"
        if key in self._keys:
            return
        n = rules["swingBars"]
        confirmed = swing_rules.known_at(s["timestamp"], n, interval)
        now = self._now()   # cuando el servidor la tiene: despues de pedir las velas y revisarlas
        entry = {"symbol": symbol, "interval": interval, "type": s["type"], "direction": s["direction"],
                 "price": s["price"], "timestamp": s["timestamp"], "known_at": confirmed, "detected_at": now,
                 "delay_ms": now - confirmed, "volume_z": round(float(s["volumeZScore"]), 4), "zone_id": s["zoneId"],
                 "in_rectangle": s["isInRectangle"], "gap": swing_rules.gap_around(closed, s["candleIndex"], n, interval),
                 "swing_bars": n, "rules_id": self._rules_id(rules)}
        path = self._day_file(confirmed)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry, separators=(",", ":")) + "\n")
        self._remember(key)
        self._recent.append(entry)
        day = path.stem
        self._day_counts[day] = self._day_counts.get(day, 0) + 1
        st["signals"] += 1
        st["last_signal"] = entry

    def _load_recent(self):
        """Las senales de los dos ultimos dias de archivo, para /api/swing/log y para no repetirlas."""
        folder = self.folder / "signals"
        files = sorted(folder.glob("*.jsonl"))[-2:] if folder.exists() else []
        entries = []
        for path in files:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue   # una linea cortada (el PC se apago al escribir) no detiene la lectura
        entries.sort(key=lambda e: (e.get("known_at") or 0, e.get("symbol") or ""))
        self._recent = deque(entries[-LOG_MEMORY:], maxlen=LOG_MEMORY)
        self._day_counts = {}
        for e in entries:
            day = self._day_file(e.get("known_at") or 0).stem
            self._day_counts[day] = self._day_counts.get(day, 0) + 1
            self._remember(f"{e.get('symbol')}|{e.get('interval')}|{e.get('type')}|{e.get('timestamp')}")
        rules_path = self.folder / "rules.jsonl"
        if rules_path.exists():
            for line in rules_path.read_text(encoding="utf-8").splitlines():
                try:
                    self._rule_ids.add(json.loads(line)["id"])
                except (ValueError, KeyError, TypeError):
                    continue

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
            entries = [e for e in entries if e.get("symbol") == symbol]
        entries.sort(key=lambda e: (e.get("known_at") or 0), reverse=True)
        return entries[:max(1, min(int(limit), 5000))]

    # --- para el grafico y el estado ---
    async def chart_signals(self, symbol: str, interval: str, days: int = None) -> dict:
        cfg = self.config
        rules = self.rules_for(symbol, cfg)
        rows = await self.chart_rows(symbol, interval, days)
        # Solo las cerradas hace 4 s o mas (las demas pueden no tener sus valores finales). La pagina vuelve a pedir
        # mientras falte la ultima
        closed = [c for c in rows if not c["in_progress"]]
        signals, used_vwap = await self._detect(symbol, interval, closed, rules, days=days) if closed else ([], False)
        n = rules["swingBars"]
        out = [{"timestamp": s["timestamp"], "type": s["type"], "price": s["price"], "direction": s["direction"],
                "volumeZScore": s["volumeZScore"], "zoneId": s["zoneId"], "isInRectangle": s["isInRectangle"],
                "known_at": swing_rules.known_at(s["timestamp"], n, interval),
                "gap": swing_rules.gap_around(closed, s["candleIndex"], n, interval)} for s in signals]
        return {"success": True, "symbol": symbol, "interval": interval, "rules": rules, "signals": out,
                "detected_live": cfg["enabled"] and symbol in cfg["symbols"] and interval == cfg["interval"],
                "detection_interval": cfg["interval"], "vwap_used": used_vwap,
                "candles": {"count": len(closed), "first": closed[0]["timestamp"] if closed else None,
                            "last": closed[-1]["timestamp"] if closed else None}}

    def status(self) -> dict:
        cfg = self.config
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        by_symbol = {}
        for symbol in cfg["symbols"]:
            st = self._state.get((symbol, cfg["interval"])) or {}
            last = st.get("last_signal")
            by_symbol[symbol] = {"last_check": st.get("last_check"), "last_close": st.get("last_close"),
                                 "signals": st.get("signals", 0), "errors": st.get("errors", 0), "error": st.get("error"),
                                 "missed": st.get("missed"),
                                 "last_signal": {k: last[k] for k in ("type", "price", "timestamp", "known_at")} if last else None}
        env_off = os.environ.get("SUITE_SWING", "1") == "0"
        return {"success": True, "sends": False, "rules": "app1", "enabled": cfg["enabled"], "env_off": env_off,
                "detecting": bool(self._task is not None and self._lock_fh is not None and cfg["enabled"]),
                "other_process": self.other_process, "interval": cfg["interval"], "symbols": cfg["symbols"],
                "started_at": self.started_ms, "since": self._since, "round": self.round,
                "today": self._day_counts.get(today, 0),
                "config_error": self.config_error, "config_source": cfg.get("source"), "by_symbol": by_symbol}

    def brief(self) -> dict:
        s = self.status()
        return {"detecting": s["detecting"], "enabled": s["enabled"], "interval": s["interval"], "symbols": len(s["symbols"]),
                "today": s["today"], "errors": sum(1 for v in s["by_symbol"].values() if v["error"]),
                "other_process": s["other_process"]}


def _json(body) -> Response:
    return Response(content=json.dumps(body, allow_nan=False, separators=(",", ":")).encode("utf-8"),
                    media_type="application/json")


def make_router(watch: SwingWatch) -> APIRouter:
    router = APIRouter()

    @router.get("/api/swing/status")
    async def swing_status():
        return watch.status()

    @router.get("/api/swing/config")
    async def swing_config():
        cfg = watch.config
        return {"success": True, "config": cfg, "effective": {s: watch.rules_for(s, cfg) for s in cfg["symbols"]},
                "defaults": swing_rules.DEFAULT_RULES, "limits": swing_rules.LIMITS, "sends": False}

    @router.post("/api/swing/config")
    async def swing_set_config(request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(status_code=400, detail="el cuerpo debe ser JSON")
        try:
            cfg = watch.set_config(body)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "config": cfg}

    @router.get("/api/swing/signals/{symbol}")
    async def swing_signals(symbol: str, interval: str = None, days: int = None):
        symbol = candles.symbol_code(symbol)
        try:
            code = _interval(interval if interval is not None else watch.config["interval"])
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        try:
            return _json(await watch.chart_signals(symbol, code, days))
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=503, detail=f"no se pudieron calcular las senales: {type(e).__name__}: {e}"[:300])

    @router.get("/api/swing/log")
    async def swing_log(symbol: str = None, limit: int = 200, day: str = None):
        if symbol:
            symbol = candles.symbol_code(symbol)
        try:
            entries = watch.log(symbol, limit, day)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "signals": entries, "count": len(entries), "sends": False}

    @router.post("/api/swing/profile-rects/{symbol}")
    async def swing_profile_rects(symbol: str, request: Request):
        symbol = candles.symbol_code(symbol)
        try:
            body = await request.json()
            ids = watch.set_profile_rects(symbol, (body or {}).get("ids") if isinstance(body, dict) else None)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"success": True, "symbol": symbol, "ids": ids}

    return router
