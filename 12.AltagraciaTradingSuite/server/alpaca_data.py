# alpaca_data.py - Datos de acciones de EE. UU. (NYSE, NASDAQ) desde Alpaca, para order flow y open interest (19/11/2026).
#
# Pedido del usuario: tener, ademas de Bybit, datos gratuitos de un broker regulado para las estrategias de order flow
# y open interest. Se eligio Alpaca: su plan gratuito da el historico consolidado (SIP) de trades y quotes de todos los
# exchanges, salvo los ultimos 15 minutos, y el open interest de las opciones.
#
# Lo que hace:
#   - Trades de un dia, con el lado del agresor. Las acciones no lo traen (Bybit si): se deduce.
#       "lee_ready": el trade contra el bid/ask vigente (quote rule). Sobre el medio es compra, bajo el medio venta,
#                    en el medio se usa la regla del tick. Necesita bajar todos los quotes del dia: es lo mejor, pero
#                    lento en acciones muy negociadas (millones de quotes por dia).
#       "tick":      solo la regla del tick (sube = compra, baja = venta, igual = el lado anterior). Rapido.
#     Lo que no se puede clasificar (el primer trade del dia sin tick previo) se reparte mitad y mitad.
#     Cada dia UTC completo se guarda en data/alpaca/trades/<SIMBOLO>/<AAAA-MM-DD>_<metodo>.npz y no se vuelve a bajar.
#   - Footprints con la misma forma que /api/orderflow/historical (niveles, delta, POC, imbalances de App 1) y CVD.
#   - Velas de Alpaca con la misma forma que /api/historical.
#   - Open interest de las opciones (por strike, por vencimiento, put/call, max pain) y su cambio contra la foto
#     anterior: Alpaca da solo el OI del dia (lo publica la OCC una vez al dia), asi que cada consulta guarda su foto en
#     data/alpaca/oi/<SIMBOLO>/<fecha del OI>.json y la historia se arma sola con el tiempo.
#
# Claves: config/suite.json ("alpaca_key_id" y "alpaca_secret_key", ese archivo no va a git) o las variables
# SUITE_ALPACA_KEY_ID / SUITE_ALPACA_SECRET_KEY (tambien APCA_API_KEY_ID / APCA_API_SECRET_KEY, las de Alpaca).
# Sirven las de una cuenta paper. Las claves nunca salen en una respuesta.
import asyncio
import calendar
import json
import math
import os
import re
import sys
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

from settings import CONFIG

sys.path.insert(0, CONFIG["app1_backend"])
import footprint_store  # noqa: E402  imbalances y stacked de App 1 (la pieza compartida)

MINUTE_MS = 60_000
DAY_MS = 86_400_000
SIP_DELAY_MS = 16 * MINUTE_MS        # plan gratuito: el SIP no deja pedir los ultimos 15 minutos (uno de margen)
PAGE_LIMIT = 10_000                  # maximo de Alpaca por pagina
PER_MINUTE = 190                     # plan gratuito: 200 pedidos por minuto
RETRIES = 5
METHODS = ("lee_ready", "tick")
SESSIONS = ("all", "rth")            # rth: 09:30 a 16:00 hora de Nueva York
RTH_OPEN, RTH_CLOSE = 9 * 60 + 30, 16 * 60
MAX_ONDEMAND_DAYS = 2                # dias sin bajar que un pedido de footprints baja en el momento
MAX_JOB_DAYS = 31
MAX_RANGE_DAYS = 31
UNIFORM_LEVELS = 10
ZSCORE_LOOKBACK = 20
SYMBOL_RE = re.compile(r"^[A-Z]{1,5}([.][A-Z]{1,2})?$")      # AAPL, BRK.B
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
INTERVALS = {"1": 1, "5": 5, "15": 15, "60": 60, "240": 240, "D": 1440}
BAR_TIMEFRAMES = {"1": "1Min", "5": "5Min", "15": "15Min", "60": "1Hour", "240": "4Hour", "D": "1Day"}
BAR_DAYS = {"1": 5, "5": 20, "15": 60, "60": 180, "240": 365, "D": 2000}

# Condiciones del SIP que no son una agresion al mercado en ese momento: precio promedio (W), derivado (4), contingentes
# (V, 7), dia siguiente (N), contado (C), vendedor (R), precio de referencia anterior (P), fuera de secuencia (Z, U),
# variacion de precio (H), aperturas y cierres oficiales informados aparte (M, Q) y cierre corregido (9).
# Se sacan del order flow; el resto (regulares, odd lots, sweeps, extended hours) queda.
EXCLUDED_CONDITIONS = frozenset("WVNCRPZUHMQ" + "479")

_client: Optional[httpx.AsyncClient] = None
_slots = deque()
_jobs = {}


class AlpacaError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# ---------- configuracion ----------
def _keys():
    key = CONFIG.get("alpaca_key_id") or os.environ.get("APCA_API_KEY_ID", "")
    secret = CONFIG.get("alpaca_secret_key") or os.environ.get("APCA_API_SECRET_KEY", "")
    return key, secret


def configured() -> bool:
    key, secret = _keys()
    return bool(key and secret)


def feed() -> str:
    return CONFIG.get("alpaca_feed", "sip") if CONFIG.get("alpaca_feed") in ("sip", "iex") else "sip"


def root() -> Path:
    return Path(CONFIG["data_dir"]) / "alpaca"


def set_client(client: Optional[httpx.AsyncClient]):
    global _client
    _client = client


def _http() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0))
    return _client


# ---------- tiempo ----------
_day_cache = {}


def ts_us(s: str) -> int:
    """'2024-01-03T14:30:00.123456789Z' -> microsegundos UTC. Rapido para millones de filas."""
    if len(s) >= 20 and s[-1] == "Z" and s[10] == "T":
        base = _day_cache.get(s[:10])
        if base is None:
            base = calendar.timegm((int(s[:4]), int(s[5:7]), int(s[8:10]), 0, 0, 0))
            _day_cache[s[:10]] = base
        sec = int(s[11:13]) * 3600 + int(s[14:16]) * 60 + int(s[17:19])
        frac = s[20:-1] if s[19] == "." else ""
        return (base + sec) * 1_000_000 + (int((frac + "000000")[:6]) if frac else 0)
    dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    return int(round(dt.timestamp() * 1_000_000))


def iso(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def day_ms(day: str) -> int:
    return calendar.timegm(date.fromisoformat(day).timetuple()) * 1000


def day_str(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _nth_sunday(year: int, month: int, n: int) -> int:
    first = date(year, month, 1)
    return (first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))).day


def dst_bounds_ms(year: int):
    """Horario de verano de Nueva York (EDT) en UTC: del 2.o domingo de marzo a las 2:00 EST (07:00 UTC)
    al 1.er domingo de noviembre a las 2:00 EDT (06:00 UTC). Sin tzdata: Windows no lo trae."""
    start = calendar.timegm((year, 3, _nth_sunday(year, 3, 2), 7, 0, 0)) * 1000
    end = calendar.timegm((year, 11, _nth_sunday(year, 11, 1), 6, 0, 0)) * 1000
    return start, end


def ny_offset_ms(t_ms: np.ndarray) -> np.ndarray:
    """Diferencia de Nueva York con UTC (-4 h o -5 h) para cada instante."""
    t_ms = np.asarray(t_ms, dtype=np.int64)
    out = np.full(t_ms.shape, -5 * 3_600_000, dtype=np.int64)
    if t_ms.size == 0:
        return out
    years = range(datetime.fromtimestamp(int(t_ms.min()) / 1000, tz=timezone.utc).year,
                  datetime.fromtimestamp(int(t_ms.max()) / 1000, tz=timezone.utc).year + 1)
    for y in years:
        a, b = dst_bounds_ms(y)
        out[(t_ms >= a) & (t_ms < b)] = -4 * 3_600_000
    return out


# ---------- red ----------
def _reserve_slot() -> float:
    now = time.monotonic()
    while _slots and now - _slots[0] >= 60.0:
        _slots.popleft()
    slot = now
    if len(_slots) >= PER_MINUTE:
        slot = max(now, _slots[-PER_MINUTE] + 60.0)
    _slots.append(slot)
    return slot


async def _get(base: str, path: str, params: dict) -> dict:
    if not configured():
        raise AlpacaError(503, "faltan las claves de Alpaca (alpaca_key_id y alpaca_secret_key en config/suite.json)")
    key, secret = _keys()
    headers = {"APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret, "Accept": "application/json"}
    last = ""
    for attempt in range(RETRIES):
        wait = _reserve_slot() - time.monotonic()
        if wait > 0:
            await asyncio.sleep(wait)
        try:
            r = await _http().get(base + path, params=params, headers=headers)
        except httpx.HTTPError as e:
            last = f"sin conexion con Alpaca ({type(e).__name__})"
            await asyncio.sleep(1.5 * (attempt + 1))
            continue
        if r.status_code == 200:
            return r.json()
        if r.status_code == 429 or r.status_code >= 500:
            last = f"Alpaca respondio {r.status_code}"
            try:
                pause = float(r.headers.get("Retry-After", "")) if r.headers.get("Retry-After") else 2.0 * (attempt + 1)
            except ValueError:
                pause = 2.0 * (attempt + 1)
            await asyncio.sleep(min(pause, 30.0))
            continue
        try:
            message = r.json().get("message") or r.text
        except Exception:
            message = r.text
        if r.status_code in (401, 403):
            raise AlpacaError(r.status_code, f"Alpaca rechazo el pedido ({r.status_code}): {message[:200]}")
        raise AlpacaError(r.status_code, f"Alpaca respondio {r.status_code}: {message[:200]}")
    raise AlpacaError(502, last or "Alpaca no respondio")


async def _pages(base: str, path: str, params: dict, key: str):
    """Recorre las paginas de un pedido de Alpaca; entrega la lista de cada una."""
    params = dict(params)
    while True:
        body = await _get(base, path, params)
        yield body.get(key) or []
        token = body.get("next_page_token")
        if not token:
            return
        params["page_token"] = token


def _data_url() -> str:
    return CONFIG.get("alpaca_data_url", "https://data.alpaca.markets").rstrip("/")


def _trading_url() -> str:
    return CONFIG.get("alpaca_trading_url", "https://paper-api.alpaca.markets").rstrip("/")


# ---------- lado del agresor ----------
def tick_rule(price: np.ndarray) -> np.ndarray:
    """+1 si el precio subio contra el ultimo distinto, -1 si bajo, 0 si aun no hubo cambio."""
    price = np.asarray(price, dtype=np.float64)
    if price.size == 0:
        return np.zeros(0, dtype=np.int8)
    d = np.zeros(price.size, dtype=np.int8)
    d[1:] = np.sign(np.diff(price)).astype(np.int8)
    idx = np.where(d != 0, np.arange(price.size), 0)
    np.maximum.accumulate(idx, out=idx)
    return d[idx]          # sin cambio previo idx queda en 0, y d[0] es 0


def quote_side(trade_t, trade_p, quote_t, bid, ask) -> np.ndarray:
    """Quote rule: contra el ultimo quote anterior al trade (estrictamente antes: el quote del mismo instante suele
    ser el que el propio trade movio). 0 sin quote valido o justo en el medio."""
    trade_t = np.asarray(trade_t, dtype=np.int64)
    out = np.zeros(trade_t.size, dtype=np.int8)
    if trade_t.size == 0 or len(quote_t) == 0:
        return out
    idx = np.searchsorted(np.asarray(quote_t, dtype=np.int64), trade_t, side="left") - 1
    has = idx >= 0
    i = np.where(has, idx, 0)
    b, a = np.asarray(bid, dtype=np.float64)[i], np.asarray(ask, dtype=np.float64)[i]
    valid = has & (b > 0) & (a > 0) & (a >= b)
    mid = (a + b) / 2.0
    p = np.asarray(trade_p, dtype=np.float64)
    out[valid & (p > mid)] = 1
    out[valid & (p < mid)] = -1
    return out


def classify(trade_t, trade_p, quote_side_arr=None) -> np.ndarray:
    """Lee-Ready: el lado del quote y, donde no hay, el del tick."""
    tick = tick_rule(trade_p)
    if quote_side_arr is None:
        return tick
    q = np.asarray(quote_side_arr, dtype=np.int8)
    return np.where(q != 0, q, tick).astype(np.int8)


def _trade_rows(rows):
    t, p, s = [], [], []
    for row in rows:
        conds = row.get("c") or ()
        if any(c in EXCLUDED_CONDITIONS for c in conds):
            continue
        size = row.get("s") or 0
        price = row.get("p") or 0
        if size <= 0 or price <= 0:
            continue
        t.append(ts_us(row["t"]))
        p.append(float(price))
        s.append(float(size))
    return t, p, s


async def fetch_day(symbol: str, day: str, method: str, now_ms: Optional[int] = None) -> dict:
    """Trades de un dia UTC con su lado. Arrays: t (us), p, s, side (+1 compra, -1 venta, 0 sin clasificar)."""
    now_ms = now_ms or int(time.time() * 1000)
    start = day_ms(day)
    cutoff = now_ms - (SIP_DELAY_MS if feed() == "sip" else 0)
    end = min(start + DAY_MS, cutoff)
    empty = {"t": np.zeros(0, np.int64), "p": np.zeros(0), "s": np.zeros(0), "side": np.zeros(0, np.int8),
             "complete": start + DAY_MS <= cutoff}
    if end <= start:
        return empty
    params = {"start": iso(start), "end": iso(end), "limit": PAGE_LIMIT, "feed": feed(), "sort": "asc"}
    tt, pp, ss = [], [], []
    async for rows in _pages(_data_url(), f"/v2/stocks/{symbol}/trades", params, "trades"):
        t, p, s = _trade_rows(rows)
        tt.extend(t)
        pp.extend(p)
        ss.extend(s)
    t = np.asarray(tt, dtype=np.int64)
    p = np.asarray(pp, dtype=np.float64)
    s = np.asarray(ss, dtype=np.float64)
    order = np.argsort(t, kind="stable")
    t, p, s = t[order], p[order], s[order]
    qside = None
    if method == "lee_ready" and t.size:
        qside = np.zeros(t.size, dtype=np.int8)
        prev = None                      # ultimo quote de la pagina anterior
        done = 0
        async for rows in _pages(_data_url(), f"/v2/stocks/{symbol}/quotes", params, "quotes"):
            if not rows:
                continue
            qt = [ts_us(q["t"]) for q in rows]
            qb = [float(q.get("bp") or 0) for q in rows]
            qa = [float(q.get("ap") or 0) for q in rows]
            if prev:
                qt.insert(0, prev[0])
                qb.insert(0, prev[1])
                qa.insert(0, prev[2])
            upto = int(np.searchsorted(t, qt[-1], side="right"))
            if upto > done:
                qside[done:upto] = quote_side(t[done:upto], p[done:upto], qt, qb, qa)
                done = upto
            prev = (qt[-1], qb[-1], qa[-1])
        if prev and done < t.size:
            qside[done:] = quote_side(t[done:], p[done:], [prev[0]], [prev[1]], [prev[2]])
    side = classify(t, p, qside)
    return {"t": t, "p": p, "s": s, "side": side, "complete": start + DAY_MS <= cutoff}


def _day_path(symbol: str, day: str, method: str) -> Path:
    return root() / "trades" / symbol / f"{day}_{method}.npz"


def load_day(symbol: str, day: str, method: str) -> Optional[dict]:
    path = _day_path(symbol, day, method)
    if not path.exists():
        return None
    try:
        with np.load(path) as z:
            return {"t": z["t"], "p": z["p"], "s": z["s"], "side": z["side"], "complete": True}
    except Exception as e:
        print(f"[ALPACA] dia ilegible {path}: {e}; se baja de nuevo")
        return None


def save_day(symbol: str, day: str, method: str, data: dict):
    path = _day_path(symbol, day, method)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.stem + ".tmp.npz")
    np.savez_compressed(tmp, t=data["t"], p=data["p"], s=data["s"], side=data["side"])
    os.replace(tmp, path)


async def get_day(symbol: str, day: str, method: str, now_ms: Optional[int] = None) -> dict:
    hit = await run_in_threadpool(load_day, symbol, day, method)
    if hit is not None:
        return hit
    data = await fetch_day(symbol, day, method, now_ms)
    if data["complete"]:
        await run_in_threadpool(save_day, symbol, day, method, data)
    return data


def cached_days(symbol: Optional[str] = None) -> dict:
    base = root() / "trades"
    out = {}
    if not base.exists():
        return out
    for folder in sorted(base.iterdir()):
        if folder.is_dir() and (symbol is None or folder.name == symbol):
            days = sorted(f.stem for f in folder.glob("*.npz") if not f.stem.endswith(".tmp"))
            out[folder.name] = days
    return out


# ---------- footprints ----------
def nice_step(raw: float) -> float:
    power = 10 ** math.floor(math.log10(raw))
    return round(min((k * power for k in (1, 2, 2.5, 5, 10)), key=lambda v: abs(v - raw)), 12)


def candle_keys(t_ms: np.ndarray, interval_min: int, session: str) -> np.ndarray:
    """Inicio de la vela de cada trade. El dia y, en rth, las velas de 1 h y 4 h arrancan a las 09:30 de Nueva York
    (como los graficos de acciones); el resto, en minutos fijos desde 1970 (como el almacen de Bybit)."""
    tf = interval_min * MINUTE_MS
    if interval_min >= 1440 or (session == "rth" and interval_min >= 60):
        off = ny_offset_ms(t_ms)
        local = t_ms + off
        day0 = local - local % DAY_MS
        if interval_min >= 1440:
            return day0 - off                                   # medianoche de Nueva York, en UTC
        anchor = day0 + RTH_OPEN * MINUTE_MS
        return anchor + ((local - anchor) // tf) * tf - off
    return t_ms - t_ms % tf


def session_mask(t_ms: np.ndarray, session: str) -> np.ndarray:
    if session != "rth":
        return np.ones(np.asarray(t_ms).shape, dtype=bool)
    local = np.asarray(t_ms, dtype=np.int64) + ny_offset_ms(t_ms)
    minute = (local % DAY_MS) // MINUTE_MS
    weekday = ((local // DAY_MS) + 3) % 7                      # 0 = lunes (1970-01-01 fue jueves)
    return (minute >= RTH_OPEN) & (minute < RTH_CLOSE) & (weekday < 5)


def build_footprints(t_us, price, size, side, interval_min: int, start_ms: int, end_ms: int,
                     step: Optional[float] = None, session: str = "all", rules: Optional[dict] = None,
                     known_until_ms: Optional[int] = None) -> dict:
    """Footprints con la forma de footprint_store (App 1): niveles de menor a mayor precio sin huecos."""
    rules = rules or {}
    t_ms = np.asarray(t_us, dtype=np.int64) // 1000
    price = np.asarray(price, dtype=np.float64)
    size = np.asarray(size, dtype=np.float64)
    side = np.asarray(side, dtype=np.int8)
    keep = (t_ms >= start_ms) & (t_ms < end_ms) & session_mask(t_ms, session)
    t_ms, price, size, side = t_ms[keep], price[keep], size[keep], side[keep]
    known = known_until_ms if known_until_ms is not None else end_ms
    if t_ms.size == 0:
        return {"footprints": [], "step_size": step, "known_until": known}
    keys = candle_keys(t_ms, interval_min, session)
    order = np.argsort(keys, kind="stable")                    # estable: dentro de la vela sigue el orden del tiempo
    t_ms, price, size, side, keys = t_ms[order], price[order], size[order], side[order], keys[order]
    starts, first = np.unique(keys, return_index=True)
    bounds = list(first) + [keys.size]
    if not step:
        ranges = [float(price[a:b].max() - price[a:b].min()) for a, b in zip(bounds[:-1], bounds[1:])]
        ranges = [r for r in ranges if r > 0]
        step = nice_step(float(np.median(ranges)) / UNIFORM_LEVELS) if ranges else 0.01
    step = float(step)
    buy = np.where(side > 0, size, np.where(side == 0, size / 2.0, 0.0))
    sell = np.where(side < 0, size, np.where(side == 0, size / 2.0, 0.0))
    level = np.floor(price / step + 1e-9).astype(np.int64)
    tf_ms = interval_min * MINUTE_MS
    result, volumes, cvd = [], [], 0.0
    stacked_min = int(rules.get("stacked_levels", 3))
    for n, (a, b) in enumerate(zip(bounds[:-1], bounds[1:])):
        lv = level[a:b]
        lo, hi = int(lv.min()), int(lv.max())
        idx = lv - lo
        width = hi - lo + 1
        lb = np.bincount(idx, weights=buy[a:b], minlength=width)
        ls = np.bincount(idx, weights=sell[a:b], minlength=width)
        lc = np.bincount(idx, minlength=width)
        levels = []
        for k in range(width):
            low, high = (lo + k) * step, (lo + k + 1) * step
            levels.append({
                "price": (low + high) / 2, "price_min": low, "price_max": high, "price_mid": (low + high) / 2,
                "bid_volume": round(float(ls[k]), 6), "ask_volume": round(float(lb[k]), 6),
                "delta": round(float(lb[k] - ls[k]), 6), "total_volume": round(float(lb[k] + ls[k]), 6),
                "trade_count": int(lc[k]),
            })
        poc = max(range(width), key=lambda i: levels[i]["total_volume"])
        cb, cs = float(buy[a:b].sum()), float(sell[a:b].sum())
        total = cb + cs
        past = np.asarray(volumes[-ZSCORE_LOOKBACK:])
        mean = float(past.mean()) if past.size else 0.0
        std = float(past.std()) if past.size else 0.0
        volumes.append(total)
        cvd += cb - cs
        found = footprint_store._imbalances(levels, rules)
        stacked = footprint_store._stacked(levels, found, stacked_min)
        t0 = int(starts[n])
        result.append({
            "candle_timestamp": t0, "interval": str(interval_min),
            "candle_open": float(price[a]), "candle_high": float(price[a:b].max()),
            "candle_low": float(price[a:b].min()), "candle_close": float(price[b - 1]),
            "step_size": step, "levels": levels, "num_levels": width,
            "poc_index": poc, "poc_price": levels[poc]["price_mid"], "poc": levels[poc]["price_mid"],
            "total_delta": round(cb - cs, 6), "delta": round(cb - cs, 6), "cvd": round(cvd, 6),
            "total_volume": round(total, 6), "trade_count": int(b - a),
            "imbalances": found, "stacked_imbalances": stacked,
            "volume_zscore": round((total - mean) / std, 2) if std > 0 else 0.0,
            "complete": t0 + tf_ms <= known, "estimated": False, "source": "alpaca",
        })
    return {"footprints": result, "step_size": step, "known_until": known}


def _days_between(start_ms: int, end_ms: int):
    d = start_ms - start_ms % DAY_MS
    while d < end_ms:
        yield day_str(d)
        d += DAY_MS


async def footprints(symbol: str, interval_min: int, start_ms: int, end_ms: int, method: str = "lee_ready",
                     step: Optional[float] = None, session: str = "all", rules: Optional[dict] = None,
                     now_ms: Optional[int] = None) -> dict:
    now_ms = now_ms or int(time.time() * 1000)
    cutoff = now_ms - (SIP_DELAY_MS if feed() == "sip" else 0)
    end_ms = min(end_ms, cutoff)
    days = list(_days_between(start_ms, end_ms))
    missing = [d for d in days if not _day_path(symbol, d, method).exists()]
    if len(missing) > MAX_ONDEMAND_DAYS:
        raise AlpacaError(409, f"faltan {len(missing)} dias sin bajar ({missing[0]} a {missing[-1]}): "
                               f"bajalos primero con POST /api/alpaca/download")
    parts = [await get_day(symbol, d, method, now_ms) for d in days]
    cat = lambda k, dt: np.concatenate([x[k] for x in parts]) if parts else np.zeros(0, dt)  # noqa: E731
    out = await run_in_threadpool(build_footprints, cat("t", np.int64), cat("p", np.float64), cat("s", np.float64),
                                  cat("side", np.int8), interval_min, start_ms, end_ms, step, session, rules, end_ms)
    out["days"] = days
    return out


# ---------- velas ----------
async def bars(symbol: str, interval: str, days: int, now_ms: Optional[int] = None) -> list:
    now_ms = now_ms or int(time.time() * 1000)
    end = now_ms - (SIP_DELAY_MS if feed() == "sip" else 0)
    start = end - days * DAY_MS
    params = {"timeframe": BAR_TIMEFRAMES[interval], "start": iso(start), "end": iso(end), "limit": PAGE_LIMIT,
              "feed": feed(), "adjustment": "raw", "sort": "asc"}
    tf = INTERVALS[interval] * MINUTE_MS
    out = []
    async for rows in _pages(_data_url(), f"/v2/stocks/{symbol}/bars", params, "bars"):
        for b in rows:
            ts = ts_us(b["t"]) // 1000
            out.append({"timestamp": ts, "open": float(b["o"]), "high": float(b["h"]), "low": float(b["l"]),
                        "close": float(b["c"]), "volume": float(b["v"]), "trades": int(b.get("n") or 0),
                        "vwap": float(b.get("vw") or 0), "in_progress": ts + tf > end})
    return out


# ---------- open interest de opciones ----------
def summarize_oi(contracts: list, previous: Optional[dict] = None) -> dict:
    """Resumen del OI: totales, put/call, por strike y por vencimiento, max pain y cambio contra la foto anterior."""
    by_strike, by_exp = {}, {}
    call_oi = put_oi = 0
    oi_dates = set()
    for c in contracts:
        try:
            oi = int(float(c.get("open_interest") or 0))
            strike = float(c["strike_price"])
        except (TypeError, ValueError, KeyError):
            continue
        kind = c.get("type")
        if kind not in ("call", "put"):
            continue
        if c.get("open_interest_date"):
            oi_dates.add(c["open_interest_date"])
        row = by_strike.setdefault(strike, {"strike": strike, "call_oi": 0, "put_oi": 0})
        exp = by_exp.setdefault(c.get("expiration_date", ""), {"expiration": c.get("expiration_date", ""),
                                                               "call_oi": 0, "put_oi": 0})
        row[kind + "_oi"] += oi
        exp[kind + "_oi"] += oi
        if kind == "call":
            call_oi += oi
        else:
            put_oi += oi
    strikes = sorted(by_strike.values(), key=lambda r: r["strike"])
    for r in strikes:
        r["total"] = r["call_oi"] + r["put_oi"]
    max_pain = None
    if strikes:
        ks = np.array([r["strike"] for r in strikes])
        co = np.array([r["call_oi"] for r in strikes], dtype=np.float64)
        po = np.array([r["put_oi"] for r in strikes], dtype=np.float64)
        # Lo que pagan las opciones si el precio cierra en cada strike: el minimo es el max pain
        pain = [float((co * np.maximum(0, k - ks)).sum() + (po * np.maximum(0, ks - k)).sum()) for k in ks]
        max_pain = float(ks[int(np.argmin(pain))])
    out = {
        "oi_date": max(oi_dates) if oi_dates else None, "contracts": len(contracts),
        "call_oi": call_oi, "put_oi": put_oi, "total_oi": call_oi + put_oi,
        "put_call_ratio": round(put_oi / call_oi, 4) if call_oi else None, "max_pain": max_pain,
        "by_strike": strikes, "by_expiration": sorted(by_exp.values(), key=lambda r: r["expiration"]),
        "change": None,
    }
    if previous:
        before = {r["strike"]: r for r in previous.get("by_strike", [])}
        out["change"] = {
            "since": previous.get("oi_date"),
            "call_oi": call_oi - previous.get("call_oi", 0), "put_oi": put_oi - previous.get("put_oi", 0),
            "total_oi": out["total_oi"] - previous.get("total_oi", 0),
            "by_strike": [{"strike": r["strike"],
                           "call_oi": r["call_oi"] - before.get(r["strike"], {}).get("call_oi", 0),
                           "put_oi": r["put_oi"] - before.get(r["strike"], {}).get("put_oi", 0)} for r in strikes],
        }
    return out


def _oi_dir(symbol: str) -> Path:
    return root() / "oi" / symbol


def _previous_snapshot(symbol: str, scope: str, oi_date: Optional[str]) -> Optional[dict]:
    folder = _oi_dir(symbol)
    if not folder.exists():
        return None
    files = sorted(f for f in folder.glob(f"*_{scope}.json") if oi_date is None or f.name[:10] < oi_date)
    if not files:
        return None
    try:
        return json.loads(files[-1].read_text(encoding="utf-8"))
    except Exception:
        return None


async def options_oi(symbol: str, exp_from: Optional[str], exp_to: Optional[str]) -> dict:
    params = {"underlying_symbols": symbol, "status": "active", "limit": PAGE_LIMIT}
    if exp_from:
        params["expiration_date_gte"] = exp_from
    if exp_to:
        params["expiration_date_lte"] = exp_to
    contracts = []
    async for rows in _pages(_trading_url(), "/v2/options/contracts", params, "option_contracts"):
        contracts.extend(rows)
    scope = f"{exp_from or 'all'}_{exp_to or 'all'}"
    probe = summarize_oi(contracts)
    previous = await run_in_threadpool(_previous_snapshot, symbol, scope, probe["oi_date"])
    out = summarize_oi(contracts, previous)
    if out["oi_date"]:
        folder = _oi_dir(symbol)
        folder.mkdir(parents=True, exist_ok=True)
        snap = {k: v for k, v in out.items() if k != "change"}
        tmp = folder / f"{out['oi_date']}_{scope}.json.tmp"
        tmp.write_text(json.dumps(snap, separators=(",", ":")), encoding="utf-8")
        os.replace(tmp, folder / f"{out['oi_date']}_{scope}.json")
    out.update({"underlying": symbol, "expiration_from": exp_from, "expiration_to": exp_to})
    return out


# ---------- bajada en segundo plano ----------
async def _run_job(symbol: str, days: list, method: str):
    job = _jobs[symbol]
    for d in days:
        job["current"] = d
        try:
            if not _day_path(symbol, d, method).exists():
                await get_day(symbol, d, method)
            job["done"] += 1
        except AlpacaError as e:
            job.update({"state": "error", "error": str(e), "current": None})
            return
        except Exception as e:
            job.update({"state": "error", "error": f"{type(e).__name__}: {e}", "current": None})
            return
    job.update({"state": "done", "current": None, "finished": int(time.time() * 1000)})


# ---------- rutas ----------
def _symbol(symbol: str) -> str:
    symbol = (symbol or "").upper().strip()
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail="simbolo de accion invalido (ej. AAPL, BRK.B)")
    return symbol


def _day(value: Optional[str], name: str) -> Optional[str]:
    if value is None:
        return None
    if not DAY_RE.match(value):
        raise HTTPException(status_code=400, detail=f"{name} debe ser AAAA-MM-DD")
    try:
        date.fromisoformat(value)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"{name} no es una fecha valida")
    return value


def _method(method: str) -> str:
    if method not in METHODS:
        raise HTTPException(status_code=400, detail=f"method debe ser {' o '.join(METHODS)}")
    return method


def _fail(e: AlpacaError):
    raise HTTPException(status_code=e.status if 400 <= e.status < 600 else 502, detail=str(e))


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/alpaca/status")
    async def alpaca_status():
        return {"success": True, "configured": configured(), "feed": feed(),
                "trading_url": _trading_url(), "cached": await run_in_threadpool(cached_days),
                "jobs": _jobs}

    @r.get("/api/alpaca/historical/{symbol}")
    async def alpaca_historical(symbol: str, interval: str = "15", days: Optional[int] = None):
        symbol = _symbol(symbol)
        if interval not in INTERVALS:
            raise HTTPException(status_code=400, detail="marco invalido (1, 5, 15, 60, 240 o D)")
        days = max(1, min(int(days or BAR_DAYS[interval]), BAR_DAYS[interval]))
        try:
            data = await bars(symbol, interval, days)
        except AlpacaError as e:
            _fail(e)
        return {"symbol": symbol, "interval": interval, "data": data, "success": True, "total_candles": len(data),
                "days_fetched": days, "max_days_allowed": BAR_DAYS[interval], "source": "alpaca", "feed": feed(),
                "updated": int(time.time() * 1000)}

    @r.get("/api/alpaca/footprints/{symbol}")
    async def alpaca_footprints(symbol: str, interval: str = "5", start_timestamp: Optional[int] = None,
                                end_timestamp: Optional[int] = None, method: str = "lee_ready",
                                session: str = "all", step: Optional[float] = None, imbalance_ratio: float = 3.0,
                                imbalance_mode: str = "level", imbalance_min_volume: float = 0.0,
                                stacked_levels: int = 3):
        symbol, method = _symbol(symbol), _method(method)
        if interval not in INTERVALS:
            raise HTTPException(status_code=400, detail="marco invalido (1, 5, 15, 60, 240 o D)")
        if session not in SESSIONS:
            raise HTTPException(status_code=400, detail="session debe ser all o rth")
        if step is not None and not (step > 0 and math.isfinite(step)):
            raise HTTPException(status_code=400, detail="step debe ser mayor que 0")
        now = int(time.time() * 1000)
        end = end_timestamp or now
        start = start_timestamp or end - DAY_MS
        if start >= end or end - start > MAX_RANGE_DAYS * DAY_MS:
            raise HTTPException(status_code=400, detail=f"rango invalido (a lo sumo {MAX_RANGE_DAYS} dias)")
        rules = {"ratio": max(1.01, imbalance_ratio),
                 "mode": imbalance_mode if imbalance_mode in ("level", "diagonal") else "level",
                 "min_volume": max(0.0, imbalance_min_volume), "stacked_levels": max(2, stacked_levels)}
        try:
            out = await footprints(symbol, INTERVALS[interval], start, end, method, step, session, rules, now)
        except AlpacaError as e:
            _fail(e)
        return {"success": True, "symbol": symbol, "interval": interval, "method": method, "session": session,
                "feed": feed(), "source": "alpaca", "count": len(out["footprints"]), **out}

    @r.get("/api/alpaca/options/oi/{symbol}")
    async def alpaca_options_oi(symbol: str, expiration_from: Optional[str] = None,
                                expiration_to: Optional[str] = None):
        symbol = _symbol(symbol)
        exp_from, exp_to = _day(expiration_from, "expiration_from"), _day(expiration_to, "expiration_to")
        try:
            out = await options_oi(symbol, exp_from, exp_to)
        except AlpacaError as e:
            _fail(e)
        return {"success": True, **out}

    @r.post("/api/alpaca/download")
    async def alpaca_download(symbol: str, start: str, end: str, method: str = "lee_ready"):
        symbol, method = _symbol(symbol), _method(method)
        start, end = _day(start, "start"), _day(end, "end")
        a, b = day_ms(start), day_ms(end)
        if b < a or (b - a) // DAY_MS + 1 > MAX_JOB_DAYS:
            raise HTTPException(status_code=400, detail=f"rango invalido (a lo sumo {MAX_JOB_DAYS} dias)")
        if not configured():
            raise HTTPException(status_code=503, detail="faltan las claves de Alpaca en config/suite.json")
        running = _jobs.get(symbol)
        if running and running["state"] == "running":
            raise HTTPException(status_code=409, detail=f"ya se esta bajando {symbol}")
        days = list(_days_between(a, b + DAY_MS))
        _jobs[symbol] = {"state": "running", "method": method, "start": start, "end": end, "total": len(days),
                         "done": 0, "current": None, "error": None, "started": int(time.time() * 1000)}
        asyncio.create_task(_run_job(symbol, days, method))
        return {"success": True, "job": _jobs[symbol]}

    @r.get("/api/alpaca/download")
    async def alpaca_download_status():
        return {"success": True, "jobs": _jobs}

    return r
