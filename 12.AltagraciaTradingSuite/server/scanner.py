# scanner.py - Scanner de monedas de la suite (22/11/2026; plan en docs/PLAN_SCANNER.md, paso 1).
#
# Mira todos los perpetuos USDT de Bybit con un pedido cada 30 s (el ticker de todas) y elige las candidatas por
# liquidez. De ellas mide, con velas de 15 min cerradas: el costo de operar en R del stop, el volumen relativo (contra la
# misma hora en dias del mismo tipo, entre semana o fin de semana), el movimiento propio (sin la parte que pone BTC), la
# volatilidad y su expansion, el OI y el funding en una misma base. Con eso arma listas con su regla a la vista (En juego,
# Tendencia con fuerza, Rapidos y Mis monedas) y el estado del mercado.
#
# Solo lee datos publicos de Bybit. Nunca envia nada al bot, no agrega monedas a la suite y no graba su libro ni su cinta:
# eso pasa solo con "Agregar a la suite" (POST /api/suite/symbols, en main.py).
#
#   GET  /api/scanner/status     si mira, cuantas monedas, ultima vuelta y errores
#   GET  /api/scanner/list       una lista (?lista=enjuego|tendencia|rapidos|mias&limit=) con sus filas y el mercado
#   GET  /api/scanner/coin/{s}   todas las medidas de una moneda (pide su libro si hace falta)
#   GET  /api/scanner/market     el estado del mercado
#   GET  /api/scanner/events     entradas y salidas de las listas (?limit=, ?day=AAAA-MM-DD)
#   GET/POST /api/scanner/config la configuracion (cada campo se valida; no mueve dinero: sin palabra de confirmacion)
#
# Datos en data/scanner: config.json; log/AAAA-MM-DD.jsonl.gz (cada 15 min, la foto de las candidatas, las listas y el
# mercado, para juzgar el scanner despues); events/AAAA-MM-DD.jsonl (entradas y salidas de las listas); liquidity.json
# (turnover diario de las monedas de la suite); state.json (las listas con su hora de entrada y los libros recientes: un
# reinicio las retoma sin anotar entradas de las que ya estaban, 23/11) y scanner.lock (un solo proceso mira por carpeta).
# SUITE_SCANNER=0 lo apaga; sin esa variable vale SUITE_SWING, que las pruebas ponen en 0. Las rutas siguen.
import asyncio
import bisect
from array import array
import gzip
import json
import logging
import math
import os
import re
import statistics
import time
import zlib
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import candles
import swing_watch
from settings import CONFIG

logger = logging.getLogger("suite.scanner")

BAR_MS = 900_000                 # velas de 15 min
HOUR_MS = 3_600_000
DAY_MS = 86_400_000
BARS_DAY = 96
HISTORY_BARS = 3000              # 31 dias y algo: la ventana de 24 h contra los 30 dias anteriores
PAGE = 1000
INITIAL_PAGES = 3
INCREMENTAL = 8                  # velas que se vuelven a pedir en cada vuelta de 15 min
TICKER_EVERY_MS = 30_000
CYCLE_DELAY_MS = 20_000          # la vuelta de 15 min empieza 20 s despues del cierre: Bybit ya cerro la vela
BOOK_EVERY_MS = 300_000
BOOK_TOP = 40                    # libros por vuelta si las listas y las que cumplen una regla dejan lugar (esas van todas)
BOOK_MAX = 200                   # tope de libros por vuelta
BOOK_RECENT_MS = 60_000          # un libro de hace menos de un minuto no se vuelve a pedir
BOOK_STALE_MS = 15 * 60_000
STATE_SAVE_MS = 5 * 60_000       # las listas y los libros se guardan al entrar o salir una moneda, y si no, cada 5 min
META_EVERY_MS = 6 * HOUR_MS      # instrumentos (grupo, etiquetas, alta, funding) y anuncios de cierre
BTC_DAILY_EVERY_MS = 6 * HOUR_MS
START_DELAY_S = 30               # al arrancar, deja pasar primero los pedidos de las grabaciones y del grafico
MAX_PARALLEL = 8
SNAP_KEEP_MS = 20 * 60_000       # fotos del ticker para la lista rapida (precio y OI de todas)
FAST_HOLD_MS = 30 * 60_000
SPREAD_KEEP_MS = HOUR_MS
EVENTS_MEMORY = 2000
LIQ_DAYS_KEEP = 10
LIQ_SAVE_MS = 10 * 60_000
WINDOWS = {"1h": 4, "4h": 16, "24h": 96, "7d": 672}
SYMBOL_RE = re.compile(r"^[A-Z0-9]{1,24}USDT$")   # Bybit tiene monedas de una letra (H, A, B...)
GROUPS = {"": "cripto", "innovation": "innovacion", "stock": "acciones", "ETF": "etf", "commodity": "materias",
          "forex": "forex"}
GROUP_NAMES = {"cripto": "Cripto", "innovacion": "Innovación", "acciones": "Acciones", "etf": "ETF",
               "materias": "Materias primas", "forex": "Forex", "otros": "Otros"}
LISTS = ("enjuego", "tendencia", "rapidos", "mias")
LIST_NAMES = {"enjuego": "En juego", "tendencia": "Tendencia con fuerza", "rapidos": "Rápidos", "mias": "Mis monedas"}
# Lectura del mercado: en bloque, cada una por su lado o mixto (hipotesis del plan, a validar con el registro)
BLOCK_CORR, BLOCK_DISP = 0.70, 3.0     # correlacion mediana de 7 dias y rango intercuartil de los retornos de 24 h (puntos)
OWN_CORR, OWN_DISP = 0.50, 6.0
DEFAULT_CONFIG = {
    "enabled": True,
    "size_usdt": 1000,          # decidido con el usuario el 22/11: opera con menos de 1,000 USDT
    "floor_usd": 5_000_000,     # piso de liquidez de las candidatas: turnover de 24 h
    "max_candidates": 150,
    "groups": ["cripto", "innovacion"],
    "allow_st": False,
    "taker_pct": 0.055,         # VIP 0 de Bybit en perpetuos
    "maker_pct": 0.02,
    "stop_atr1h": 1.0,          # las dos columnas del costo en R
    "stop_atr4h": 1.5,          # el stop de la ruptura con volumen (QB) en 4 h
    "book_max_bps": 20.0,       # libro suficiente: spread y deslizamiento de ida y vuelta para el tamano
    "rvol24_min": 1.5,
    "rvol1h_min": 3.0,
    "hold_min": 60,             # una moneda sale de una lista despues de este tiempo sin cumplir su regla
    "fast": {"a_min": 5, "a_price_pct": 1.0, "a_oi_pct": 4.0,      # los ejemplos del Pump Screener de WunderTrading
             "b_min": 15, "b_price_pct": 10.0, "b_oi_pct": 1.0, "floor_usd": 1_000_000},
}
STATS = {"requests": 0}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_off() -> bool:
    return os.environ.get("SUITE_SCANNER", os.environ.get("SUITE_SWING", "1")) == "0"


def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def fnum(x, default=None):
    try:
        v = float(x)
    except (TypeError, ValueError):
        return default
    return v if math.isfinite(v) else default


# ---------- configuracion ----------
def _bounded(value, name, lo, hi, integer=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} debe ser un numero")
    if not lo <= value <= hi:
        raise ValueError(f"{name} va de {lo} a {hi}")
    if integer and value != int(value):
        raise ValueError(f"{name} debe ser un entero")
    return int(value) if integer else float(value)


NUMBERS = {
    "size_usdt": (10, 1_000_000, False), "floor_usd": (100_000, 2_000_000_000, False),
    "max_candidates": (20, 250, True), "taker_pct": (0, 0.5, False), "maker_pct": (-0.05, 0.5, False),
    "stop_atr1h": (0.1, 10, False), "stop_atr4h": (0.1, 10, False), "book_max_bps": (1, 500, False),
    "rvol24_min": (0.5, 20, False), "rvol1h_min": (0.5, 50, False), "hold_min": (0, 1440, True),
}
FAST_NUMBERS = {
    "a_min": (1, 15, True), "a_price_pct": (0.1, 50, False), "a_oi_pct": (0, 100, False),
    "b_min": (1, 15, True), "b_price_pct": (0.1, 50, False), "b_oi_pct": (0, 100, False),
    "floor_usd": (0, 1_000_000_000, False),
}


def clean_config(body: dict, current: dict) -> dict:
    """La configuracion nueva, partiendo de la vigente. Cada campo se valida; lo que no viene queda igual."""
    if not isinstance(body, dict):
        raise ValueError("la configuracion debe ser un objeto")
    unknown = set(body) - set(DEFAULT_CONFIG)
    if unknown:
        raise ValueError(f"campo desconocido: {sorted(unknown)[0]}")
    out = json.loads(json.dumps(current))
    for key in ("enabled", "allow_st"):
        if key in body:
            if not isinstance(body[key], bool):
                raise ValueError(f"{key} es true o false")
            out[key] = body[key]
    for key, (lo, hi, integer) in NUMBERS.items():
        if key in body:
            out[key] = _bounded(body[key], key, lo, hi, integer)
    if "groups" in body:
        groups = body["groups"]
        if not isinstance(groups, list) or not groups or any(g not in GROUP_NAMES or g == "otros" for g in groups):
            raise ValueError(f"groups es una lista con algunos de {', '.join(g for g in GROUP_NAMES if g != 'otros')}")
        out["groups"] = [g for g in GROUP_NAMES if g in groups]
    if "fast" in body:
        fast = body["fast"]
        if not isinstance(fast, dict) or set(fast) - set(FAST_NUMBERS):
            raise ValueError(f"fast es un objeto con {', '.join(FAST_NUMBERS)}")
        for key, (lo, hi, integer) in FAST_NUMBERS.items():
            if key in fast:
                out["fast"][key] = _bounded(fast[key], f"fast.{key}", lo, hi, integer)
    return out


# ---------- Bybit ----------
async def bybit_get(path: str, params: dict) -> dict:
    """Un pedido publico a Bybit, con el limite de la suite (candles.bybit_turn) y reintentos. Devuelve `result`."""
    http = candles.client()
    data = None
    for attempt in range(4):
        await candles.bybit_turn()
        STATS["requests"] += 1
        try:
            r = await http.get(CONFIG["bybit_url"] + path, params=params)
            data = r.json()
        except (httpx.HTTPError, ValueError) as e:
            if attempt >= 2:
                raise RuntimeError(f"Bybit no respondio ({type(e).__name__})")
            await asyncio.sleep(1 + attempt)
            continue
        if isinstance(data, dict) and data.get("retCode") == candles.TOO_MANY_VISITS and attempt < 3:
            await asyncio.sleep(1.2 + attempt)   # "Too many visits": pasa la ventana de 1 s de Bybit
            continue
        break
    if not isinstance(data, dict) or data.get("retCode") != 0:
        raise RuntimeError(f"Bybit: {(data or {}).get('retMsg') if isinstance(data, dict) else 'respuesta invalida'}")
    return data.get("result") or {}


def parse_instruments(items: list) -> dict:
    """Perpetuos USDT que cotizan, con su grupo (symbolType de Bybit), la etiqueta ST, la fecha de alta, el tick y el
    intervalo del funding."""
    out = {}
    for i in items or []:
        if i.get("contractType") != "LinearPerpetual" or i.get("quoteCoin") != "USDT" or i.get("status") != "Trading":
            continue
        sym = i.get("symbol") or ""
        if not SYMBOL_RE.match(sym):
            continue
        out[sym] = {
            "group": GROUPS.get(i.get("symbolType") or "", "otros"),
            "st": "ST" in (i.get("tags") or []),
            "launch": int(fnum(i.get("launchTime"), 0) or 0) or None,
            "tick": fnum((i.get("priceFilter") or {}).get("tickSize")),
            "funding_min": fnum(i.get("fundingInterval")),
            "max_leverage": fnum((i.get("leverageFilter") or {}).get("maxLeverage")),
            "min_notional": fnum((i.get("lotSizeFilter") or {}).get("minNotionalValue")),
            "name": i.get("displayName") or sym,
        }
    return out


DELIST_RE = re.compile(r"\b([A-Z0-9]{1,24}USDT)\b")


def parse_delistings(items: list, now: int, days: int = 45) -> dict:
    """Los anuncios de cierre de Bybit (type=delistings) que nombran el perpetuo en el titulo, de los ultimos `days`."""
    out = {}
    for a in items or []:
        at = int(fnum(a.get("dateTimestamp")) or fnum(a.get("publishTime")) or fnum(a.get("startDateTimestamp")) or 0)
        if at and now - at > days * DAY_MS:
            continue
        title = str(a.get("title") or "")
        for sym in DELIST_RE.findall(title.upper()):
            if sym not in out:
                out[sym] = {"title": title[:200], "url": str(a.get("url") or "")[:300], "at": at or None}
    return out


def parse_ticker(t: dict, inst: dict) -> dict:
    price = fnum(t.get("lastPrice"))
    if not price or price <= 0:
        return None
    bid, ask = fnum(t.get("bid1Price")), fnum(t.get("ask1Price"))
    spread = (ask - bid) / ((ask + bid) / 2) * 1e4 if bid and ask and ask >= bid > 0 else None
    funding_min = (inst or {}).get("funding_min")
    if not funding_min:
        hours = fnum(t.get("fundingIntervalHour"))
        funding_min = hours * 60 if hours else 480
    return {"price": price, "prev1h": fnum(t.get("prevPrice1h")), "prev24h": fnum(t.get("prevPrice24h")),
            "chg24h": fnum(t.get("price24hPcnt")), "turnover24h": fnum(t.get("turnover24h"), 0.0),
            "oi": fnum(t.get("openInterest")), "oi_usd": fnum(t.get("openInterestValue"), 0.0),
            "funding": fnum(t.get("fundingRate")), "funding_min": funding_min, "bid": bid, "ask": ask,
            "spread_bps": spread}


def parse_klines(rows: list, now: int) -> list:
    """Velas de Bybit ([inicio, apertura, maximo, minimo, cierre, volumen, turnover], la mas nueva primero) a velas
    cerradas en orden. La vela en curso queda fuera."""
    out, seen = [], set()
    for r in rows or []:
        try:
            t = int(r[0])
        except (TypeError, ValueError, IndexError):
            continue
        if t in seen or t + BAR_MS > now:
            continue
        seen.add(t)
        out.append({"t": t, "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]),
                    "q": float(r[6]) if len(r) > 6 else float(r[5]) * float(r[4])})
    out.sort(key=lambda b: b["t"])
    return out


def merge_bars(old: list, new: list, keep: int = HISTORY_BARS) -> list:
    by_t = {b["t"]: b for b in old or []}
    for b in new or []:
        by_t[b["t"]] = b
    return [by_t[t] for t in sorted(by_t)][-keep:]


class BarStore:
    """Las velas de 15 min de una moneda en arreglos de numeros, sin un objeto por valor: 3,000 velas ocupan unos 140 KB
    en lugar de ~1 MB como diccionarios. Las medidas las arman como diccionarios de a una moneda (dicts())."""
    __slots__ = ("t", "o", "h", "l", "c", "q")

    def __init__(self, bars=()):
        self.t, self.o, self.h, self.l, self.c, self.q = array("q"), array("d"), array("d"), array("d"), array("d"), array("d")
        for b in bars:
            self.t.append(int(b["t"]))
            self.o.append(b["o"])
            self.h.append(b["h"])
            self.l.append(b["l"])
            self.c.append(b["c"])
            self.q.append(b["q"])

    def __len__(self):
        return len(self.t)

    def last_t(self):
        return self.t[-1] if self.t else None

    def dicts(self) -> list:
        return [{"t": t, "o": o, "h": h, "l": lo, "c": c, "q": q}
                for t, o, h, lo, c, q in zip(self.t, self.o, self.h, self.l, self.c, self.q)]


# ---------- medidas ----------
def is_weekend(ms: int) -> bool:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).weekday() >= 5


def rvol(bars: list, width: int, days: int = 30):
    """Turnover de las ultimas `width` velas cerradas contra la mediana de la misma ventana a la misma hora en los `days`
    dias anteriores, de los del mismo tipo (entre semana o fin de semana, por la mitad de la ventana). Con menos de 4 del
    mismo tipo usa todos (al menos 7). Devuelve (valor, "tipo"|"todos", muestras) o (None, None, 0)."""
    if not bars or len(bars) < width:
        return None, None, 0
    t0 = bars[0]["t"]
    n = (bars[-1]["t"] - t0) // BAR_MS + 1
    q = [0.0] * n
    for b in bars:
        q[(b["t"] - t0) // BAR_MS] = b["q"]
    prefix = [0.0]
    for x in q:
        prefix.append(prefix[-1] + x)
    end = n - 1

    def window(e):
        return prefix[e + 1] - prefix[e + 1 - width] if e + 1 - width >= 0 else None

    def weekend_at(e):
        return is_weekend(t0 + (e - width // 2) * BAR_MS)

    cur = window(end)
    kind = weekend_at(end)
    same, every = [], []
    for k in range(1, days + 1):
        e = end - k * BARS_DAY
        s = window(e)
        if s is None:
            break
        every.append(s)
        if weekend_at(e) == kind:
            same.append(s)
    if len(same) >= 4:
        base, how, count = statistics.median(same), "tipo", len(same)
    elif len(every) >= 7:
        base, how, count = statistics.median(every), "todos", len(every)
    else:
        return None, None, 0
    if not base or base <= 0 or cur is None:
        return None, None, 0
    return cur / base, how, count


def aggregate(bars: list, minutes: int) -> list:
    """Une velas de 15 min en velas de `minutes` alineadas a UTC (1 h, 4 h o el dia). Solo las completas."""
    span = minutes * 60_000
    per = span // BAR_MS
    out, cur = [], None
    for b in bars:
        key = b["t"] // span
        if cur is None or cur["k"] != key:
            if cur is not None and cur["n"] == per:
                out.append(cur)
            cur = {"k": key, "t": key * span, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "q": b["q"], "n": 1}
        else:
            cur["h"] = max(cur["h"], b["h"])
            cur["l"] = min(cur["l"], b["l"])
            cur["c"] = b["c"]
            cur["q"] += b["q"]
            cur["n"] += 1
    if cur is not None and cur["n"] == per:
        out.append(cur)
    return out


def tr_pcts(bars: list) -> list:
    out = []
    for i in range(1, len(bars)):
        h, l, pc = bars[i]["h"], bars[i]["l"], bars[i - 1]["c"]
        out.append(max(h - l, abs(h - pc), abs(l - pc)) / bars[i]["c"] if bars[i]["c"] > 0 else 0.0)
    return out


def atr_pct(bars: list, n: int = 14):
    trs = tr_pcts(bars)
    if len(trs) < n:
        return None
    return sum(trs[-n:]) / n


def vol_expansion(hourly: list):
    """El rango verdadero medio de las ultimas 24 velas de 1 h contra su mediana de los 30 dias anteriores."""
    trs = tr_pcts(hourly)
    if len(trs) < 24 + 168:
        return None
    cur = sum(trs[-24:]) / 24
    base = statistics.median(trs[-24 - 720:-24])
    return cur / base if base > 0 else None


def log_returns(bars: list) -> dict:
    return {bars[i]["t"]: math.log(bars[i]["c"] / bars[i - 1]["c"]) for i in range(1, len(bars))
            if bars[i - 1]["c"] > 0 and bars[i]["c"] > 0 and bars[i]["t"] - bars[i - 1]["t"] == HOUR_MS}


def corr_beta(ra: dict, rb: dict, count: int, minimum: int):
    keys = sorted(t for t in ra if t in rb)[-count:]
    if len(keys) < minimum:
        return None, None
    xa = [ra[t] for t in keys]
    xb = [rb[t] for t in keys]
    ma, mb = sum(xa) / len(xa), sum(xb) / len(xb)
    cov = sum((a - ma) * (b - mb) for a, b in zip(xa, xb)) / len(xa)
    va = sum((a - ma) ** 2 for a in xa) / len(xa)
    vb = sum((b - mb) ** 2 for b in xb) / len(xb)
    if va <= 0 or vb <= 0:
        return None, None
    return cov / math.sqrt(va * vb), cov / vb


def ret_back(bars: list, count: int):
    """Retorno desde el cierre de hace `count` velas de 15 min (por hora, no por posicion: aguanta un hueco)."""
    if not bars:
        return None
    ts = [b["t"] for b in bars]
    i = bisect.bisect_right(ts, bars[-1]["t"] - count * BAR_MS) - 1
    if i < 0 or bars[i]["c"] <= 0:
        return None
    return bars[-1]["c"] / bars[i]["c"] - 1


def efficiency(hourly: list, hours: int):
    if len(hourly) <= hours:
        return None
    seg = hourly[-hours - 1:]
    path = sum(abs(seg[i]["c"] - seg[i - 1]["c"]) for i in range(1, len(seg)))
    return abs(seg[-1]["c"] - seg[0]["c"]) / path if path > 0 else None


def walk(levels: list, usd: float):
    """Precio promedio de una orden a mercado de `usd` contra esos niveles ([(precio, cantidad)], del mejor al peor).
    None si el libro pedido no alcanza."""
    need, cost, qty = usd, 0.0, 0.0
    for p, s in levels:
        if p <= 0 or s <= 0:
            continue
        take = min(s, need / p)
        cost += take * p
        qty += take
        need -= take * p
        if need <= usd * 1e-9:
            return cost / qty
    return None


def book_cost(bids: list, asks: list, usd: float) -> dict:
    """Deslizamiento de compra y de venta de una orden a mercado de `usd`, en bps desde el precio medio (incluye la
    mitad del spread de cada lado)."""
    if not bids or not asks or bids[0][0] <= 0 or asks[0][0] < bids[0][0]:
        return None
    mid = (bids[0][0] + asks[0][0]) / 2
    buy, sell = walk(asks, usd), walk(bids, usd)
    return {"mid": mid, "spread_bps": (asks[0][0] - bids[0][0]) / mid * 1e4,
            "buy_bps": (buy - mid) / mid * 1e4 if buy else None,
            "sell_bps": (mid - sell) / mid * 1e4 if sell else None,
            "levels": min(len(bids), len(asks))}


def us_market_open(ms: int) -> bool:
    """Bolsa de Nueva York abierta: lunes a viernes de 9:30 a 16:00 de Nueva York (sin feriados)."""
    d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)

    def nth_sunday(month, n):
        first = datetime(d.year, month, 1, tzinfo=timezone.utc)
        return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))

    dst = nth_sunday(3, 2) + timedelta(hours=7) <= d < nth_sunday(11, 1) + timedelta(hours=6)
    local = d + timedelta(hours=-4 if dst else -5)
    minutes = local.hour * 60 + local.minute
    return local.weekday() < 5 and 570 <= minutes < 960


def session_of(ms: int) -> str:
    d = datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    m = d.hour * 60 + d.minute
    return "Asia" if m < 420 else "Europa" if m < 810 else "EE. UU." if m < 1200 else "Entre sesiones"


def _at_or_before(series: list, t: int):
    """El valor de una serie [(t, v)] ordenada en la hora t o la anterior mas cercana."""
    ts = [x[0] for x in series]
    i = bisect.bisect_right(ts, t) - 1
    return series[i][1] if i >= 0 else None


def btc_context(btc_bars: list) -> dict:
    hourly = aggregate(btc_bars, 60) if btc_bars else []
    return {"returns": log_returns(hourly), "ret": {k: ret_back(btc_bars, n) for k, n in WINDOWS.items()}}


def apply_costs(m: dict, book: dict, cfg: dict, now: int) -> dict:
    """El costo de ida y vuelta (comision + spread + deslizamiento para el tamano) y en R de los dos stops. Sin un libro
    reciente se estima con el spread mediano de la ultima hora."""
    taker, maker = cfg["taker_pct"] * 100, cfg["maker_pct"] * 100   # % a bps
    # Un libro viejo, o medido con otro tamano de orden, no cuenta
    fresh = book if book and now - book.get("at", 0) <= BOOK_STALE_MS and book.get("size") == cfg["size_usdt"] else None
    buy, sell = (fresh or {}).get("buy_bps"), (fresh or {}).get("sell_bps")
    m["book"] = fresh
    if fresh and buy is not None and sell is not None:
        slip = buy + sell
        m["cost_rt_bps"] = 2 * taker + slip
        m["cost_limit_bps"] = maker + taker + slip / 2
        m["cost_estimated"] = False
        m["book_ok"] = slip <= cfg["book_max_bps"]
        m["book_reach"] = True
    elif fresh:
        m["cost_rt_bps"] = m["cost_limit_bps"] = None
        m["cost_estimated"] = False
        m["book_ok"] = False
        m["book_reach"] = False     # el libro pedido no alcanza para el tamano
    else:
        spread = m.get("spread_bps")
        m["cost_rt_bps"] = 2 * taker + spread if spread is not None else None
        m["cost_limit_bps"] = maker + taker + spread / 2 if spread is not None else None
        m["cost_estimated"] = True
        m["book_ok"] = spread is not None and spread <= cfg["book_max_bps"] / 2
        m["book_reach"] = None
    rt = m.get("cost_rt_bps")
    a1, a4 = m.get("atr_1h"), m.get("atr_4h")
    m["cost_r_1h"] = rt / (cfg["stop_atr1h"] * a1 * 1e4) if rt is not None and a1 else None
    m["cost_r_4h"] = rt / (cfg["stop_atr4h"] * a4 * 1e4) if rt is not None and a4 else None
    return m


def coin_metrics(sym: str, bars: list, btc: dict, tick: dict, inst: dict, oi: list, spread_bps, now: int,
                 suite: bool, delisting: dict, turnover_rank) -> dict:
    """Las medidas de una moneda con sus velas de 15 min cerradas, sin futuro. El costo se suma con apply_costs()."""
    inst = inst or {}
    tick = tick or {}
    m = {"symbol": sym, "group": inst.get("group", "otros"), "st": bool(inst.get("st")), "suite": suite,
         "age_days": (now - inst["launch"]) / DAY_MS if inst.get("launch") else None,
         "price": tick.get("price") or (bars[-1]["c"] if bars else None),
         "turnover24h": tick.get("turnover24h"), "turnover_rank": turnover_rank, "oi_usd": tick.get("oi_usd"),
         "spread_bps": spread_bps, "bars": len(bars or []), "bar_close": bars[-1]["t"] + BAR_MS if bars else None,
         "delisting": delisting, "computed_at": now, "tick_bps": None}
    if inst.get("tick") and m["price"]:
        m["tick_bps"] = inst["tick"] / m["price"] * 1e4
    rate, fmin = tick.get("funding"), tick.get("funding_min") or 480
    m["funding"] = rate
    m["funding_min"] = fmin
    m["funding_8h"] = rate * 480 / fmin if rate is not None else None
    m["funding_day"] = rate * 1440 / fmin if rate is not None else None   # lo que paga un largo por dia (negativo: cobra)
    for key in ("rvol_1h", "rvol_4h", "rvol_24h"):
        m[key] = None
    m["rvol_base"], m["rvol_samples"] = None, 0
    if bars:
        for key, width in (("1h", 4), ("4h", 16), ("24h", 96)):
            value, how, count = rvol(bars, width)
            m[f"rvol_{key}"] = value
            if key == "24h":
                m["rvol_base"], m["rvol_samples"] = how, count
    hourly = aggregate(bars, 60) if bars else []
    four = aggregate(bars, 240) if bars else []
    daily = aggregate(bars, 1440) if bars else []
    m["atr_1h"], m["atr_4h"], m["atr_d"] = atr_pct(hourly), atr_pct(four), atr_pct(daily)
    m["vol_exp"] = vol_expansion(hourly)
    m["er_7d"] = efficiency(hourly, 168)
    ra = log_returns(hourly)
    if sym == "BTCUSDT":
        m["corr_30d"], m["beta_30d"], m["corr_7d"] = 1.0, 1.0, 1.0
    else:
        m["corr_30d"], m["beta_30d"] = corr_beta(ra, btc["returns"], 720, 200)
        m["corr_7d"], _ = corr_beta(ra, btc["returns"], 168, 100)
    for key, count in WINDOWS.items():
        r = ret_back(bars, count) if bars else None
        m[f"ret_{key}"] = r
        rb = btc["ret"].get(key)
        m[f"resid_{key}"] = r - m["beta_30d"] * rb if r is not None and rb is not None and m["beta_30d"] is not None else None
    m["resid_24h_atr"] = m["resid_24h"] / m["atr_d"] if m["resid_24h"] is not None and m["atr_d"] else None
    last = bars[-2880:] if bars else []
    if last:
        lo, hi = min(b["l"] for b in last), max(b["h"] for b in last)
        m["range_30d"] = (bars[-1]["c"] - lo) / (hi - lo) if hi > lo else None
    else:
        m["range_30d"] = None
    m["hi20"] = m["lo20"] = m["ma20"] = m["prev_hi"] = m["prev_lo"] = m["dist_prev_hi"] = m["dist_prev_lo"] = None
    m["break20"], m["above_ma20"] = 0, None
    if len(daily) >= 20 and m["price"]:
        prev = daily[-20:]
        m["hi20"], m["lo20"] = max(d["h"] for d in prev), min(d["l"] for d in prev)
        m["ma20"] = sum(d["c"] for d in prev) / 20
        m["break20"] = 1 if m["price"] > m["hi20"] else -1 if m["price"] < m["lo20"] else 0
        m["above_ma20"] = m["price"] > m["ma20"]
    if daily and m["price"]:
        m["prev_hi"], m["prev_lo"] = daily[-1]["h"], daily[-1]["l"]
        m["dist_prev_hi"] = m["prev_hi"] / m["price"] - 1
        m["dist_prev_lo"] = m["prev_lo"] / m["price"] - 1
    now_oi = tick.get("oi")
    for key, hours in (("1h", 1), ("4h", 4), ("24h", 24)):
        then = _at_or_before(oi, now - hours * HOUR_MS) if oi else None
        m[f"oi_{key}"] = now_oi / then - 1 if now_oi and then else None
    r24, o24 = m["ret_24h"], m["oi_24h"]
    m["oi_quadrant"] = None
    if r24 is not None and o24 is not None and abs(r24) >= 0.01 and abs(o24) >= 0.02:
        m["oi_quadrant"] = ("sube con OI: entran largos" if o24 > 0 else "sube sin OI: cierran cortos") if r24 > 0 else \
                           ("baja con OI: entran cortos" if o24 > 0 else "baja sin OI: cierran largos")
    m["us_open"] = us_market_open(now) if m["group"] in ("acciones", "etf") else None
    return m


def flags_of(m: dict, cfg: dict) -> list:
    """Banderas de riesgo de una moneda, con su texto."""
    out = []
    if m.get("group") == "innovacion":
        out.append({"code": "innovacion", "text": "Zona de innovación de Bybit"})
    if m.get("st"):
        out.append({"code": "st", "text": "Etiqueta ST de Bybit (riesgo)"})
    if m.get("age_days") is not None and m["age_days"] < 30:
        out.append({"code": "nueva", "text": f"Listada hace {max(0, int(m['age_days']))} días"})
    if m.get("group") in ("acciones", "etf"):
        out.append({"code": "accion", "text": "Acción o ETF" + ("" if m.get("us_open") else
                    ": su bolsa está cerrada y el precio puede saltar en la apertura de Nueva York")})
    if m.get("delisting"):
        out.append({"code": "cierre", "text": f"Bybit anunció su cierre: {m['delisting'].get('title', '')}"[:160]})
    f8 = m.get("funding_8h")
    if f8 is not None and abs(f8) >= 0.001:
        who = "el largo paga" if f8 > 0 else "el corto paga"
        out.append({"code": "funding", "text": f"Funding extremo: {who} {abs(m['funding_day']) * 100:.2f}% por día"})
    if m.get("book_reach") is False:
        out.append({"code": "libro", "text": f"El libro no alcanza para {cfg['size_usdt']:,.0f} USDT"})
    elif m.get("book_ok") is False and m.get("cost_rt_bps") is not None:
        out.append({"code": "libro", "text": f"Libro fino para {cfg['size_usdt']:,.0f} USDT"})
    if m.get("bars", 0) and m["bars"] < 31 * BARS_DAY - 1:
        out.append({"code": "historia", "text": f"Solo {m['bars'] // BARS_DAY} días de velas: el volumen relativo usa menos días"})
    if m.get("low_week"):
        out.append({"code": "quieta", "text": "Una semana bajo el piso de liquidez"})
    return out


def _pct(x, digits=1):
    return f"{x * 100:+.{digits}f}%"


def chips_of(m: dict, lista: str, member: dict = None) -> list:
    """Por que esta la moneda en la lista, en pocas palabras."""
    out = []

    def add(text, title):
        out.append({"text": text, "title": title})

    rv24, rv1 = m.get("rvol_24h"), m.get("rvol_1h")
    if lista == "rapidos" and member:
        add(f"{_pct(member['dp'])} en {member['minutes']} min", "Cambio del precio en esa ventana")
        add(f"OI {_pct(member['doi'])}", "Cambio del interés abierto en esa ventana")
    if lista in ("enjuego", "mias") and rv24 is not None:
        add(f"vol ×{rv24:.1f}", "Volumen de 24 h contra la misma hora de días del mismo tipo")
    if lista == "enjuego" and rv1 is not None and rv1 >= 3:
        add(f"1 h ×{rv1:.1f}", "Volumen de la última hora contra la misma hora de días del mismo tipo")
    if lista == "tendencia":
        add("máx. 20 d" if m.get("break20", 0) > 0 else "mín. 20 d", "Rompe el máximo o el mínimo de los 20 días anteriores")
        if m.get("resid_7d") is not None:
            add(f"{_pct(m['resid_7d'])} vs BTC 7 d", "Movimiento propio de 7 días: el retorno menos la parte que pone BTC")
        if m.get("er_7d") is not None:
            add(f"eficiencia {m['er_7d']:.2f}", "Recorrido neto de 7 días ÷ el camino recorrido (1 es una línea recta)")
    elif m.get("resid_24h") is not None and lista != "rapidos":
        add(f"{_pct(m['resid_24h'])} vs BTC", "Movimiento propio de 24 h: el retorno menos la parte que pone BTC")
    if lista == "enjuego" and m.get("oi_24h") is not None and abs(m["oi_24h"]) >= 0.05:
        add(f"OI {_pct(m['oi_24h'], 0)}", "Cambio del interés abierto en 24 h")
    if lista == "mias" and m.get("turnover24h") is not None:
        x = m["turnover24h"]
        add(f"{x / 1e9:.2f} B/día" if x >= 1e9 else f"{x / 1e6:,.1f} M/día", "Turnover de las últimas 24 h, en USD")
    if m.get("cost_r_1h") is not None:
        add(f"{m['cost_r_1h']:.2f} R" + ("*" if m.get("cost_estimated") else ""),
            "Costo de ida y vuelta (comisión, spread y deslizamiento) en R de un stop de 1 ATR de 1 h"
            + (". *Estimado con el spread: todavía sin libro" if m.get("cost_estimated") else ""))
    return out


def market_state(metrics: dict, btc_bars: list, btc_daily: list, now: int, cfg: dict) -> dict:
    """El estado del mercado con las candidatas de los grupos elegidos."""
    groups = set(cfg["groups"])
    rows = [m for m in metrics.values() if m.get("group") in groups and m["symbol"] != "BTCUSDT"
            and (cfg["allow_st"] or not m.get("st"))]
    btc = metrics.get("BTCUSDT") or {}

    def share(values):
        values = [v for v in values if v is not None]
        return sum(1 for v in values if v) / len(values) if values else None

    def median(values):
        values = [v for v in values if v is not None]
        return statistics.median(values) if values else None

    r24 = sorted(m["ret_24h"] for m in rows if m.get("ret_24h") is not None)
    iqr = None
    if len(r24) >= 8:
        qs = statistics.quantiles(r24, n=4)
        iqr = (qs[2] - qs[0]) * 100
    weights = [(m.get("oi_usd") or 0) for m in rows]
    total = sum(w for w, m in zip(weights, rows) if m.get("funding_8h") is not None)
    funding = sum((m.get("oi_usd") or 0) * m["funding_8h"] for m in rows if m.get("funding_8h") is not None) / total if total else None
    total_oi = sum(w for w, m in zip(weights, rows) if m.get("oi_24h") is not None)
    oi_chg = sum((m.get("oi_usd") or 0) * m["oi_24h"] for m in rows if m.get("oi_24h") is not None) / total_oi if total_oi else None
    atr_pctile = None
    if btc_daily and len(btc_daily) >= 60:
        series = []
        for i in range(15, len(btc_daily) + 1):
            a = atr_pct(btc_daily[:i])
            if a is not None:
                series.append(a)
        if series:
            year = series[-365:]
            atr_pctile = sum(1 for a in year if a <= year[-1]) / len(year)
    corr7 = median([m.get("corr_7d") for m in rows])
    reading, hint = "mixto", "Ni en bloque ni cada una por su lado."
    if corr7 is not None and iqr is not None:
        if corr7 >= BLOCK_CORR and iqr <= BLOCK_DISP:
            reading, hint = "en bloque", "Se mueven con BTC: BTC y ETH, o las de beta alta a favor de BTC. «En juego» da poco."
        elif corr7 < OWN_CORR or iqr >= OWN_DISP:
            reading, hint = "cada una por su lado", "Movimientos propios: mirar «En juego»."
    return {
        "at": now, "coins": len(rows), "session": session_of(now), "weekend": is_weekend(now),
        "btc": {"price": btc.get("price"), "ret_24h": btc.get("ret_24h"), "ret_7d": btc.get("ret_7d"),
                "above_ma20": btc.get("above_ma20"), "er_7d": btc.get("er_7d"), "atr_d": btc.get("atr_d"),
                "atr_d_pctile_1y": atr_pctile},
        "breadth_ma20": share([m.get("above_ma20") for m in rows]),
        "breadth_up24": share([(m["ret_24h"] > 0) if m.get("ret_24h") is not None else None for m in rows]),
        "dispersion_iqr24": iqr,
        "corr_7d": corr7, "corr_30d": median([m.get("corr_30d") for m in rows]),
        "alts_vs_btc7": share([(m["resid_7d"] > 0) if m.get("resid_7d") is not None else None for m in rows]),
        "funding_8h": funding, "oi_24h": oi_chg,
        "rvol_24h": median([m.get("rvol_24h") for m in rows]),
        "reading": reading, "hint": hint,
        "thresholds": {"block_corr": BLOCK_CORR, "block_disp": BLOCK_DISP, "own_corr": OWN_CORR, "own_disp": OWN_DISP},
    }


def fast_hits(snaps, tickers: dict, allowed, cfg: dict, now: int) -> dict:
    """Las monedas con un cambio de precio y de OI rapido (las dos reglas del Pump Screener de WunderTrading)."""
    fast = cfg["fast"]
    out = {}
    rules = (("A", fast["a_min"], fast["a_price_pct"] / 100, fast["a_oi_pct"] / 100),
             ("B", fast["b_min"], fast["b_price_pct"] / 100, fast["b_oi_pct"] / 100))
    for name, minutes, dp_min, doi_min in rules:
        target = now - minutes * 60_000
        then = None
        for t, snap in reversed(snaps):
            if t <= target + 15_000:   # la foto de hace unos `minutes` (cada 30 s)
                then = snap
                break
        if then is None:
            continue
        for sym, p in tickers.items():
            if sym not in allowed or p["turnover24h"] < fast["floor_usd"] or sym not in then:
                continue
            price0, oi0 = then[sym]
            if not price0 or not oi0 or not p.get("oi"):
                continue
            dp, doi = p["price"] / price0 - 1, p["oi"] / oi0 - 1
            if abs(dp) >= dp_min and doi >= doi_min and sym not in out:
                out[sym] = {"rule": name, "minutes": minutes, "dp": dp, "doi": doi, "dir": 1 if dp > 0 else -1}
    return out


ROW_FIELDS = ("turnover24h", "price", "rvol_1h", "rvol_4h", "rvol_24h", "ret_1h", "ret_4h", "ret_24h", "ret_7d",
              "resid_24h", "resid_7d", "beta_30d", "corr_30d", "corr_7d", "atr_1h", "atr_4h", "atr_d", "vol_exp",
              "er_7d", "range_30d", "break20", "above_ma20", "oi_1h", "oi_4h", "oi_24h", "funding_8h", "spread_bps",
              "cost_rt_bps", "cost_r_1h", "cost_r_4h", "cost_estimated", "book_ok", "group", "st")


def _compact(value):
    if isinstance(value, float):
        return float(f"{value:.5g}")
    return value


class Scanner:
    def __init__(self, folder: Path, symbols_source=None, fetch=None, now=None, start_delay: float = START_DELAY_S):
        self.folder = Path(folder)
        self._symbols_source = symbols_source or (lambda: [])
        self._fetch = fetch or bybit_get
        self._now = now or _now_ms
        self.start_delay = start_delay
        self.config_error = None
        self.config = self._load_config()
        self.instruments = {}
        self.delistings = {}
        self.tickers = {}
        self.tickers_at = None
        self.ranks = {}
        self.snaps = deque()
        self.spreads = {}
        self.bars = {}
        self.oi = {}
        self.books = {}
        self.metrics = {}
        self.market = None
        self.btc_daily = []
        self.members = {"enjuego": {}, "tendencia": {}, "rapidos": {}}
        self.wanting = set()
        self.order = {name: [] for name in LISTS}
        self.events = deque(maxlen=EVENTS_MEMORY)
        self.candidates = []
        self.meta_at = self.btc_daily_at = self.book_at = self.cycle_close = 0
        self.cycle = None
        self.compute_seconds = None
        self.evaluated_at = None
        self.book_round = None
        self.book_extra = None         # los libros medidos en la vuelta de 15 min (las que acaban de cumplir una regla)
        self.errors = deque(maxlen=20)
        self.coin_errors = {}
        self.started_ms = self._now()
        self.liq_days = self._load_liq()
        self._liq_saved = 0
        self.restored = None           # lo retomado de state.json al tomar el candado (para el estado)
        self._restored = False
        self._state_dirty = False
        self._state_saved = 0
        self._lock_fh = None
        self._tasks = []
        self._wake = None
        self._meta_lock = asyncio.Lock()
        self.other_process = False
        self._load_events()

    # --- configuracion ---
    def _config_path(self) -> Path:
        return self.folder / "config.json"

    def _load_config(self) -> dict:
        path = self._config_path()
        base = json.loads(json.dumps(DEFAULT_CONFIG))
        if path.exists():
            try:
                return clean_config(json.loads(path.read_text(encoding="utf-8")), base)
            except (ValueError, OSError) as e:
                # Un archivo ilegible no se pisa: el scanner queda apagado hasta que se guarde otra configuracion
                self.config_error = f"config.json ilegible: {e}"[:200]
                return {**base, "enabled": False}
        return base

    def set_config(self, body: dict) -> dict:
        cfg = clean_config(body, self.config)
        path = self._config_path()
        if self.config_error and path.exists():
            stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
            path.with_name(f"config.danado-{stamp}.json").write_bytes(path.read_bytes())
        swing_watch._write_atomic(path, json.dumps(cfg, indent=1, ensure_ascii=False))
        if cfg["size_usdt"] != self.config["size_usdt"]:
            self.book_at = 0   # los libros se vuelven a pedir con el tamano nuevo en la vuelta siguiente
        self.config, self.config_error = cfg, None
        now = self._now()
        for m in self.metrics.values():
            apply_costs(m, self.books.get(m["symbol"]), cfg, now)
        self._choose_candidates()
        self._evaluate(now)
        if self._wake is not None:
            self._wake.set()
        return cfg

    def suite_symbols(self) -> list:
        try:
            return [s for s in self._symbols_source() if SYMBOL_RE.match(s)]
        except Exception:
            return []

    def _allowed(self, sym: str, cfg: dict = None) -> bool:
        cfg = cfg or self.config
        inst = self.instruments.get(sym)
        return bool(inst) and inst["group"] in cfg["groups"] and (cfg["allow_st"] or not inst["st"])

    # --- un solo proceso mira por carpeta ---
    def _take_lock(self) -> bool:
        if self._lock_fh is not None:
            return True
        path = self.folder / "scanner.lock"
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
        return True

    def _hold_lock(self) -> bool:
        """El candado y, la primera vez que se toma, las listas y los libros que guardo la vuelta anterior."""
        if not self._take_lock():
            return False
        if not self._restored:
            self._restore_state()
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

    def _error(self, where: str, e: Exception):
        text = f"{where}: {type(e).__name__}: {e}"[:240]
        self.errors.append({"at": self._now(), "text": text})
        logger.warning(f"[SCANNER] {text}")

    # --- bucles ---
    async def start(self):
        if _env_off() or self._tasks:
            return
        self._wake = asyncio.Event()
        self.other_process = not self._hold_lock()
        self._tasks = [asyncio.create_task(self._ticker_loop()), asyncio.create_task(self._work_loop())]

    async def stop(self):
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks = []
        self._save_liq(force=True)
        self._save_state(self._now(), force=True)
        self._release_lock()

    def _ready(self) -> bool:
        if not self._hold_lock():
            self.other_process = True
            return False
        self.other_process = False
        return bool(self.config["enabled"])

    async def _ticker_loop(self):
        await asyncio.sleep(self.start_delay)
        while True:
            try:
                if self._ready():
                    await self.refresh_tickers()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error("ticker", e)
            now = self._now()
            await asyncio.sleep(max(1.0, (TICKER_EVERY_MS - now % TICKER_EVERY_MS) / 1000))

    async def _work_loop(self):
        await asyncio.sleep(self.start_delay + 3)
        while True:
            try:
                if self._ready():
                    await self.work_once()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error("vuelta", e)
            try:
                await asyncio.wait_for(self._wake.wait(), timeout=5)
                self._wake.clear()
            except asyncio.TimeoutError:
                pass

    async def work_once(self):
        """Lo que toque: instrumentos y anuncios, el diario de BTC, la vuelta de 15 min, las candidatas nuevas y libros."""
        now = self._now()
        if not self.instruments or now - self.meta_at >= META_EVERY_MS:
            await self.refresh_meta()
        if not self.tickers:
            await self.refresh_tickers()
        if now - self.btc_daily_at >= BTC_DAILY_EVERY_MS:
            await self.refresh_btc_daily()
        close = (now - CYCLE_DELAY_MS) // BAR_MS * BAR_MS
        if close > self.cycle_close:
            await self.run_cycle()
        elif any(s not in self.bars for s in self.candidates):
            await self.load_missing(8)
        if self._now() - self.book_at >= BOOK_EVERY_MS and self.metrics:
            await self.refresh_books()

    async def refresh_meta(self):
        async with self._meta_lock:   # las dos vueltas pueden pedirlo a la vez al arrancar
            if self.instruments and self._now() - self.meta_at < META_EVERY_MS:
                return
            await self._refresh_meta()

    async def _refresh_meta(self):
        items, cursor = [], ""
        for _ in range(5):
            params = {"category": "linear", "limit": 1000}
            if cursor:
                params["cursor"] = cursor
            res = await self._fetch("/v5/market/instruments-info", params)
            items += res.get("list") or []
            cursor = res.get("nextPageCursor") or ""
            if not cursor:
                break
        parsed = parse_instruments(items)
        if parsed:
            self.instruments = parsed
        now = self._now()
        try:
            res = await self._fetch("/v5/announcements/index", {"locale": "en-US", "type": "delistings", "limit": 50})
            self.delistings = parse_delistings(res.get("list") or [], now)
        except Exception as e:
            self._error("anuncios", e)
        self.meta_at = now

    async def refresh_btc_daily(self):
        try:
            res = await self._fetch("/v5/market/kline", {"category": "linear", "symbol": "BTCUSDT", "interval": "D", "limit": 400})
            now = self._now()
            rows = []
            for r in res.get("list") or []:
                t = int(r[0])
                if t + DAY_MS <= now:
                    rows.append({"t": t, "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "q": float(r[6])})
            rows.sort(key=lambda b: b["t"])
            self.btc_daily = rows
        except Exception as e:
            self._error("diario de BTC", e)
        self.btc_daily_at = self._now()

    async def refresh_tickers(self):
        if not self.instruments:
            await self.refresh_meta()
        res = await self._fetch("/v5/market/tickers", {"category": "linear"})
        now = self._now()
        out = {}
        for t in res.get("list") or []:
            sym = t.get("symbol")
            inst = self.instruments.get(sym)
            if inst is None:
                continue   # solo los perpetuos USDT que cotizan
            p = parse_ticker(t, inst)
            if p:
                out[sym] = p
        if not out:
            raise RuntimeError("Bybit no dio tickers de perpetuos USDT")
        self.tickers, self.tickers_at = out, now
        ranked = sorted(out, key=lambda s: -out[s]["turnover24h"])
        self.ranks = {s: i + 1 for i, s in enumerate(ranked)}
        self.snaps.append((now, {s: (p["price"], p["oi"]) for s, p in out.items()}))
        while self.snaps and now - self.snaps[0][0] > SNAP_KEEP_MS:
            self.snaps.popleft()
        for s, p in out.items():
            if p["spread_bps"] is None:
                continue
            dq = self.spreads.setdefault(s, deque())
            dq.append((now, p["spread_bps"]))
            while dq and now - dq[0][0] > SPREAD_KEEP_MS:
                dq.popleft()
        for s in list(self.spreads):
            if s not in out:
                del self.spreads[s]
        self._update_liq(now)
        self._choose_candidates()
        for sym, m in self.metrics.items():   # lo que cambia con el ticker: precio, turnover, OI y funding
            p = out.get(sym)
            if p:
                m.update({"price": p["price"], "turnover24h": p["turnover24h"], "oi_usd": p["oi_usd"],
                          "turnover_rank": self.ranks.get(sym), "spread_bps": self.spread_median(sym)})
        self._evaluate(now)

    def spread_median(self, sym: str):
        dq = self.spreads.get(sym)
        return statistics.median(v for _, v in dq) if dq else None

    def _choose_candidates(self):
        cfg = self.config
        pool = sorted((s for s, p in self.tickers.items() if self._allowed(s, cfg) and p["turnover24h"] >= cfg["floor_usd"]),
                      key=lambda s: -self.tickers[s]["turnover24h"])[:cfg["max_candidates"]]
        for s in ["BTCUSDT"] + self.suite_symbols():
            if s in self.tickers and s not in pool:
                pool.append(s)
        self.candidates = pool

    async def _refresh_bars(self, sym: str, now: int):
        have = self.bars.get(sym)
        if have and (now - have.last_t()) // BAR_MS > PAGE - 20:
            have = None   # una pausa larga: se pide todo otra vez
        if not have:
            rows, end = [], now
            for _ in range(INITIAL_PAGES):
                res = await self._fetch("/v5/market/kline", {"category": "linear", "symbol": sym, "interval": "15",
                                                            "limit": PAGE, "end": end})
                raw = res.get("list") or []
                page = parse_klines(raw, now)
                if not page:
                    break
                rows = page + rows
                end = page[0]["t"] - 1
                if len(raw) < PAGE:
                    break
            self.bars[sym] = BarStore(merge_bars([], rows))
        else:
            gap = (now - have.last_t()) // BAR_MS
            res = await self._fetch("/v5/market/kline", {"category": "linear", "symbol": sym, "interval": "15",
                                                        "limit": int(min(PAGE, max(INCREMENTAL, gap + 2)))})
            self.bars[sym] = BarStore(merge_bars(have.dicts(), parse_klines(res.get("list") or [], now)))

    async def _refresh_oi(self, sym: str):
        res = await self._fetch("/v5/market/open-interest", {"category": "linear", "symbol": sym, "intervalTime": "15min", "limit": 100})
        rows = {}
        for r in res.get("list") or []:
            try:
                rows[int(r["timestamp"])] = float(r["openInterest"])
            except (KeyError, TypeError, ValueError):
                continue
        merged = dict(self.oi.get(sym) or [])
        merged.update(rows)
        self.oi[sym] = sorted(merged.items())[-200:]

    async def _refresh_coin(self, sym: str, now: int, gate: asyncio.Semaphore):
        async with gate:
            try:
                await self._refresh_bars(sym, now)
                await self._refresh_oi(sym)
                self.coin_errors.pop(sym, None)
            except Exception as e:
                self.coin_errors[sym] = f"{type(e).__name__}: {e}"[:200]

    async def load_missing(self, limit: int):
        now = self._now()
        missing = [s for s in self.candidates if s not in self.bars and s not in self.coin_errors][:limit]
        if not missing:
            return
        gate = asyncio.Semaphore(MAX_PARALLEL)
        await asyncio.gather(*(self._refresh_coin(s, now, gate) for s in missing))
        await self.compute(now)
        self._evaluate(now)

    async def run_cycle(self):
        """La vuelta de 15 min: velas y OI de las candidatas, las medidas, las listas y el registro."""
        now = self._now()
        began, requests = time.time(), STATS["requests"]
        close = (now - CYCLE_DELAY_MS) // BAR_MS * BAR_MS
        gate = asyncio.Semaphore(MAX_PARALLEL)
        self.coin_errors = {}
        cands = list(self.candidates)
        if "BTCUSDT" not in cands:
            cands.insert(0, "BTCUSDT")
        await asyncio.gather(*(self._refresh_coin(s, now, gate) for s in cands))
        await self.compute(now)
        self.cycle_close = close
        self._evaluate(now)
        missing = [s for s in self.wanting if not self._fresh_book(s, now)]
        if missing:   # sin libro medido no se entra: las que acaban de cumplir una regla entran en esta misma vuelta
            await self.refresh_books(missing)
        self.cycle = {"at": now, "seconds": round(time.time() - began, 1), "coins": len(cands),
                      "loaded": sum(1 for s in cands if s in self.bars), "requests": STATS["requests"] - requests,
                      "errors": len(self.coin_errors), "compute_seconds": self.compute_seconds}
        self._write_log(now)

    async def compute(self, now: int):
        cfg = self.config
        suite = set(self.suite_symbols())
        btc_store = self.bars.get("BTCUSDT")
        inputs = []
        for sym in self.candidates:
            store = self.bars.get(sym)
            if not store:
                continue
            inputs.append((sym, store, self.tickers.get(sym), self.instruments.get(sym), self.oi.get(sym),
                           self.spread_median(sym), sym in suite, self.delistings.get(sym), self.ranks.get(sym)))
        low_week = self._low_week(cfg)

        def work():
            began = time.time()
            btc_bars = btc_store.dicts() if btc_store else []
            btc = btc_context(btc_bars)
            out = {}
            for sym, store, tick, inst, oi, spread, in_suite, delist, rank in inputs:
                bars = btc_bars if sym == "BTCUSDT" else store.dicts()   # de a una moneda: la memoria no crece
                m = coin_metrics(sym, bars, btc, tick, inst, oi, spread, now, in_suite, delist, rank)
                m["low_week"] = sym in low_week
                apply_costs(m, self.books.get(sym), cfg, now)
                out[sym] = m
            return out, time.time() - began

        metrics, seconds = await run_in_threadpool(work)
        self.metrics = metrics
        self.compute_seconds = round(seconds, 2)
        self.market = market_state(metrics, None, self.btc_daily, now, cfg)

    def _fresh_book(self, sym: str, now: int) -> bool:
        """Si hay un libro que cuenta para el costo (el mismo criterio de apply_costs)."""
        book = self.books.get(sym)
        return bool(book) and now - book.get("at", 0) <= BOOK_STALE_MS and book.get("size") == self.config["size_usdt"]

    async def refresh_books(self, only: list = None):
        """Los libros de todas las monedas de las listas y de todas las que cumplen la regla de una lista, y si queda lugar
        hasta 40, los de las de mas volumen relativo. Para entrar a una lista hace falta el libro medido: con un tope de 40
        libros para todo, las listas llenas no dejaban medir a las que llegaban (el 23/11, ACE con volumen x147 quedo
        fuera). Con `only`, solo esas: las que acaban de cumplir una regla en la vuelta de 15 min."""
        now = self._now()
        cfg = self.config
        if only is None:
            rv = lambda s: -((self.metrics.get(s) or {}).get("rvol_24h") or 0)   # noqa: E731
            listed = [s for name in ("enjuego", "tendencia", "rapidos") for s in self.order.get(name, [])]
            wanting = sorted((s for s in self.wanting if s in self.metrics and s not in listed), key=rv)
            rest = sorted((s for s in self.metrics if s not in listed and s not in self.wanting and self._allowed(s, cfg)), key=rv)
            must = list(dict.fromkeys(listed + wanting))
            pick = must + rest[:max(0, BOOK_TOP - len(must))]
            recent = lambda s: (self._fresh_book(s, now)   # noqa: E731
                                and now - self.books[s].get("at", 0) < BOOK_RECENT_MS)
            pick = [s for s in pick if not recent(s)][:BOOK_MAX]
        else:
            pick = list(dict.fromkeys(only))[:BOOK_MAX]
        gate = asyncio.Semaphore(MAX_PARALLEL)
        began = time.time()

        async def one(sym):
            async with gate:
                try:
                    await self.fetch_book(sym, now)
                except Exception as e:
                    self.coin_errors[sym] = f"libro: {type(e).__name__}: {e}"[:200]

        await asyncio.gather(*(one(s) for s in pick))
        if only is None:
            self.book_at = now
            self.book_round = {"at": now, "coins": len(pick), "seconds": round(time.time() - began, 1)}
        else:
            self.book_extra = {"at": now, "coins": len(pick), "seconds": round(time.time() - began, 1)}
        for sym, m in self.metrics.items():
            apply_costs(m, self.books.get(sym), cfg, now)
        self._evaluate(now)

    async def fetch_book(self, sym: str, now: int):
        size = self.config["size_usdt"]
        limit = 50 if size <= 5000 else 200
        cost = None
        while True:
            res = await self._fetch("/v5/market/orderbook", {"category": "linear", "symbol": sym, "limit": limit})
            bids = [(float(p), float(s)) for p, s in res.get("b") or []]
            asks = [(float(p), float(s)) for p, s in res.get("a") or []]
            cost = book_cost(bids, asks, size)
            if cost is None or (cost["buy_bps"] is not None and cost["sell_bps"] is not None) or limit >= 500:
                break
            limit = 500   # el libro pedido no alcanza: una vez mas con todos los niveles que da Bybit
        if cost is not None:
            cost["at"] = now
            cost["size"] = size
            self.books[sym] = cost
        return cost

    # --- listas ---
    def _members(self, name: str, ok: dict, now: int, hold_ms: int, blocked=()):
        """Entradas y salidas de una lista. Sale despues de `hold_ms` sin cumplir su regla, o en el acto si ya no se
        puede operar (`blocked`: libro fino, grupo que no se mira, etiqueta ST)."""
        members = self.members[name]
        for sym, info in ok.items():
            cur = members.get(sym)
            if cur is None:
                members[sym] = {"since": now, "last_ok": now, **info}
                self._event(now, name, sym, "entra")
                self._state_dirty = True
            else:
                cur.update({"last_ok": now, **info})
        for sym in list(members):
            if sym not in ok and (sym in blocked or now - members[sym]["last_ok"] >= hold_ms):
                del members[sym]
                self._event(now, name, sym, "sale")
                self._state_dirty = True

    def _eligible(self, m: dict, cfg: dict) -> bool:
        return m.get("group") in cfg["groups"] and (cfg["allow_st"] or not m.get("st")) and bool(m.get("book_ok"))

    def _could_enter(self, m: dict, cfg: dict) -> bool:
        """Si vale la pena medir su libro: se puede operar, o el libro todavia no se midio y su spread no lo descarta. El
        estimado pide un spread de la mitad del limite; el libro medido puede pasar con uno de hasta el limite entero (el
        23/11, MMT, con volumen x32 y 10 bps de spread, solo entro porque sobro lugar en la vuelta de los libros)."""
        if self._eligible(m, cfg):
            return True
        spread = m.get("spread_bps")
        return (m.get("group") in cfg["groups"] and (cfg["allow_st"] or not m.get("st")) and bool(m.get("cost_estimated"))
                and spread is not None and spread <= cfg["book_max_bps"])

    def _evaluate(self, now: int):
        cfg = self.config
        hold = cfg["hold_min"] * 60_000
        metrics = self.metrics
        if metrics:
            # "Ya no cumple" se mide contra la ultima revision de las listas, no contra la hora del pedido. Sin medidas
            # (recien arrancado) no hay revision: lo retomado sigue como estaba al guardarse
            self.evaluated_at = now
            # Sale en el acto la que ya no se puede operar o dejo de ser candidata. Una candidata cuyas velas no llegaron
            # (tras un reinicio no hay velas en memoria) no: sigue la hora de espera, como si no cumpliera
            blocked = {s for name in ("enjuego", "tendencia") for s in self.members[name]
                       if (s not in metrics and s not in self.coin_errors) or (s in metrics and not self._eligible(metrics[s], cfg))}
            # Para entrar a una lista hace falta el libro medido (con el estimado entraban libros finos que salian al
            # medirse); para quedarse basta seguir siendo operable
            entering = lambda name, s, m: s in self.members[name] or not m.get("cost_estimated")   # noqa: E731
            want = set()   # las que cumplen la regla de una lista y podrian entrar: su libro se mide en la vuelta
            ok = {}
            for sym, m in metrics.items():
                if not self._could_enter(m, cfg):
                    continue
                r24, r1 = m.get("rvol_24h"), m.get("rvol_1h")
                if (r24 is not None and r24 >= cfg["rvol24_min"]) or (r1 is not None and r1 >= cfg["rvol1h_min"]):
                    want.add(sym)
                    if self._eligible(m, cfg) and entering("enjuego", sym, m):
                        move = m.get("resid_24h") if m.get("resid_24h") is not None else m.get("ret_24h")
                        ok[sym] = {"dir": (1 if move > 0 else -1) if move else 0}
            self._members("enjuego", ok, now, hold, blocked)
            ers = sorted(m["er_7d"] for m in metrics.values() if self._eligible(m, cfg) and m.get("er_7d") is not None)
            cut = max(0.15, ers[int(len(ers) * 2 / 3)]) if len(ers) >= 6 else None
            ok = {}
            if cut is not None:
                for sym, m in metrics.items():
                    d = m.get("break20", 0)
                    if d and self._could_enter(m, cfg) and (m.get("er_7d") or 0) >= cut and (m.get("resid_7d") or 0) * d > 0:
                        want.add(sym)
                        if self._eligible(m, cfg) and entering("tendencia", sym, m):
                            ok[sym] = {"dir": d, "er_cut": cut}
            self._members("tendencia", ok, now, hold, blocked)
            self.wanting = want
        if self.tickers:   # sin tickers todavia (recien arrancado) no se sabe cuales se pueden operar
            allowed = {s for s in self.tickers if self._allowed(s, cfg)}
            self._members("rapidos", fast_hits(self.snaps, self.tickers, allowed, cfg, now), now, FAST_HOLD_MS,
                          {s for s in self.members["rapidos"] if s not in allowed})
        if metrics:
            rv = lambda s: (metrics.get(s) or {}).get("rvol_24h") or 0   # noqa: E731
            self.order["enjuego"] = sorted(self.members["enjuego"], key=lambda s: (
                self.members["enjuego"][s]["last_ok"] < now, -rv(s)))
            self.order["tendencia"] = sorted(self.members["tendencia"], key=lambda s: (
                self.members["tendencia"][s]["last_ok"] < now, -abs((metrics.get(s) or {}).get("resid_7d") or 0)))
        else:   # sin medidas todavia: el orden retomado
            for name in ("enjuego", "tendencia"):
                keep = [s for s in self.order.get(name, []) if s in self.members[name]]
                self.order[name] = keep + [s for s in self.members[name] if s not in keep]
        self.order["rapidos"] = sorted(self.members["rapidos"], key=lambda s: -self.members["rapidos"][s]["last_ok"])
        suite = self.suite_symbols()
        self.order["mias"] = sorted(suite, key=lambda s: -((self.tickers.get(s) or {}).get("turnover24h") or 0))
        self._save_state(now)

    # --- las listas y los libros sobreviven a un reinicio ---
    def _state_path(self) -> Path:
        return self.folder / "state.json"

    def _save_state(self, now: int, force: bool = False):
        """Las listas (con la hora de entrada y la ultima en que cumplieron su regla) y los libros recientes. Al entrar o
        salir una moneda, y si no, cada 5 min. Solo el proceso que mira (el del candado) y despues de haber retomado lo
        anterior: si no, un arranque pisaria las listas guardadas con unas vacias."""
        if self._lock_fh is None or not self._restored:
            return
        if not (force or self._state_dirty or now - self._state_saved >= STATE_SAVE_MS):
            return
        data = {"v": 1, "at": now, "size": self.config["size_usdt"], "members": self.members,
                "order": {name: list(self.order.get(name, [])) for name in self.members},
                "books": {s: b for s, b in self.books.items() if now - (b.get("at") or 0) <= BOOK_STALE_MS}}
        try:
            swing_watch._write_atomic(self._state_path(), json.dumps(data, separators=(",", ":"), ensure_ascii=False, default=str))
            self._state_saved, self._state_dirty = now, False
        except OSError as e:
            self._error("estado", e)

    def _restore_state(self):
        """Al tomar el candado, lo que guardo el proceso anterior. Una lista se retoma si el scanner dejo de mirar menos
        tiempo que su espera (una hora En juego y Tendencia, 30 min Rapidos): sus monedas siguen con su hora de entrada,
        sin anotar otra entrada. Si fue mas, no se sabe que paso mientras tanto: salen a la hora en que se las vio por
        ultima vez, con "gap" en su evento, y las que cumplan su regla entran de nuevo. Los libros de menos de 15 min
        vuelven a contar para el costo."""
        self._restored = True
        path = self._state_path()
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            saved_at = int(data["at"])
            saved_members = data.get("members") or {}
            saved_order = data.get("order") or {}
            saved_books = data.get("books") or {}
            if not all(isinstance(x, dict) for x in (saved_members, saved_order, saved_books)):
                raise ValueError("estado con otra forma")
        except (OSError, ValueError, KeyError, TypeError) as e:
            self._error("estado", e)
            return
        now = self._now()
        gap = max(0, now - saved_at)
        kept, closed = {}, 0
        for name in self.members:
            hold = FAST_HOLD_MS if name == "rapidos" else self.config["hold_min"] * 60_000
            saved = {s: dict(m) for s, m in (saved_members.get(name) or {}).items()
                     if SYMBOL_RE.match(str(s)) and isinstance(m, dict)
                     and isinstance(m.get("since"), int) and isinstance(m.get("last_ok"), int)}
            if gap < hold:
                self.members[name] = saved
                order = [s for s in (saved_order.get(name) or []) if s in saved]
                self.order[name] = order + [s for s in saved if s not in order]
                kept[name] = len(saved)
            else:
                for s in saved:
                    self._event(saved_at, name, s, "sale", gap=True)
                closed += len(saved)
        books = 0
        for s, b in saved_books.items():
            if (SYMBOL_RE.match(str(s)) and isinstance(b, dict) and isinstance(b.get("at"), int)
                    and now - b["at"] <= BOOK_STALE_MS and s not in self.books):
                self.books[s] = b
                books += 1
        if kept:
            self.evaluated_at = saved_at   # lo que estaba esperando sigue esperando, y lo demas no
        self._state_dirty = bool(closed)
        self.restored = {"saved_at": saved_at, "gap_s": round(gap / 1000), "kept": kept, "closed": closed, "books": books}

    def _event(self, now: int, name: str, sym: str, kind: str, gap: bool = False):
        m = self.metrics.get(sym) or {}
        member = self.members.get(name, {}).get(sym)
        entry = {"at": now, "list": name, "symbol": sym, "type": kind,
                 "chips": [c["text"] for c in chips_of(m, name, member)] if m or member else [],
                 "price": (self.tickers.get(sym) or {}).get("price")}
        if gap:
            entry["gap"] = True   # salio por un corte: el scanner no miro en ese tiempo y esta es la ultima vez que la vio
        self.events.append(entry)
        path = self.folder / "events" / f"{_day(now)}.jsonl"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(json.dumps(entry, separators=(",", ":"), ensure_ascii=False) + "\n")
        except OSError as e:
            self._error("eventos", e)

    def _load_events(self):
        folder = self.folder / "events"
        files = sorted(folder.glob("*.jsonl"))[-2:] if folder.exists() else []
        entries = []
        for path in files:
            for line in path.read_text(encoding="utf-8").splitlines():
                try:
                    entries.append(json.loads(line))
                except ValueError:
                    continue   # una linea cortada no detiene la lectura
        self.events = deque(sorted(entries, key=lambda e: e.get("at") or 0)[-EVENTS_MEMORY:], maxlen=EVENTS_MEMORY)

    def events_log(self, limit: int = 100, day: str = None, lista: str = None) -> list:
        if day:
            if not re.match(r"^\d{4}-\d{2}-\d{2}$", day):
                raise ValueError("day es AAAA-MM-DD")
            path = self.folder / "events" / f"{day}.jsonl"
            entries = []
            if path.exists():
                for line in path.read_text(encoding="utf-8").splitlines():
                    try:
                        entries.append(json.loads(line))
                    except ValueError:
                        continue
        else:
            entries = list(self.events)
        if lista:
            entries = [e for e in entries if e.get("list") == lista]
        entries.sort(key=lambda e: e.get("at") or 0, reverse=True)
        return entries[:max(1, min(int(limit), 2000))]

    # --- registro de cada vuelta, para juzgar el scanner ---
    def _write_log(self, now: int):
        line = {"v": 1, "at": now, "config": {k: self.config[k] for k in ("size_usdt", "floor_usd", "groups", "allow_st",
                                                                           "stop_atr1h", "stop_atr4h", "rvol24_min", "rvol1h_min")},
                "market": self.market, "lists": {k: list(v) for k, v in self.order.items()}, "fields": list(ROW_FIELDS),
                "rows": {s: [_compact(m.get(f)) for f in ROW_FIELDS] for s, m in self.metrics.items()}}
        path = self.folder / "log" / f"{_day(now)}.jsonl.gz"
        try:
            path.parent.mkdir(parents=True, exist_ok=True)
            data = (json.dumps(line, separators=(",", ":"), ensure_ascii=False, default=str) + "\n").encode("utf-8")
            with open(path, "ab") as fh:   # un miembro gzip por vuelta: el archivo se lee entero con gzip.open
                fh.write(gzip.compress(data))
        except OSError as e:
            self._error("registro", e)

    @staticmethod
    def read_log(path: Path) -> list:
        """Las vueltas de un dia, miembro gzip por miembro. Un final cortado (el PC se apago al escribir) se ignora."""
        out = []
        try:
            data = Path(path).read_bytes()
        except OSError:
            return out
        while data:
            d = zlib.decompressobj(wbits=31)
            try:
                chunk = d.decompress(data)
            except zlib.error:
                break
            if not d.eof:
                break   # un miembro cortado
            for line in chunk.decode("utf-8", "replace").splitlines():
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
            data = d.unused_data
        return out

    # --- turnover diario de las monedas de la suite ("una semana bajo el piso") ---
    def _liq_path(self) -> Path:
        return self.folder / "liquidity.json"

    def _load_liq(self) -> dict:
        try:
            data = json.loads(self._liq_path().read_text(encoding="utf-8"))
            return {d: v for d, v in data.items() if isinstance(v, dict)}
        except (OSError, ValueError, AttributeError):
            return {}

    def _update_liq(self, now: int):
        day = _day(now)
        today = self.liq_days.setdefault(day, {})
        for s in self.suite_symbols():
            p = self.tickers.get(s)
            if p:
                today[s] = round(p["turnover24h"])
        for d in sorted(self.liq_days)[:-LIQ_DAYS_KEEP]:
            del self.liq_days[d]
        self._save_liq()

    def _save_liq(self, force: bool = False):
        now = self._now()
        if not force and now - self._liq_saved < LIQ_SAVE_MS:
            return
        try:
            swing_watch._write_atomic(self._liq_path(), json.dumps(self.liq_days, separators=(",", ":")))
            self._liq_saved = now
        except OSError as e:
            self._error("liquidez", e)

    def _low_week(self, cfg: dict) -> set:
        today = _day(self._now())
        days = [d for d in sorted(self.liq_days) if d < today][-7:]
        if len(days) < 7:
            return set()
        out = set()
        for s in self.suite_symbols():
            values = [self.liq_days[d].get(s) for d in days]
            if all(v is not None and v < cfg["floor_usd"] for v in values):
                out.add(s)
        return out

    # --- lo que se muestra ---
    def row(self, sym: str, lista: str) -> dict:
        m = self.metrics.get(sym)
        member = self.members.get(lista, {}).get(sym) if lista in self.members else None
        now = self._now()
        if m is None:
            p = self.tickers.get(sym) or {}
            inst = self.instruments.get(sym) or {}
            m = {"symbol": sym, "group": inst.get("group", "otros"), "st": bool(inst.get("st")), "price": p.get("price"),
                 "turnover24h": p.get("turnover24h"), "turnover_rank": self.ranks.get(sym), "pending": True,
                 "age_days": (now - inst["launch"]) / DAY_MS if inst.get("launch") else None}
        out = dict(m)
        out["flags"] = flags_of(m, self.config)
        out["chips"] = chips_of(m, lista, member)
        if member:
            out["member"] = {"since": member["since"], "last_ok": member["last_ok"], "dir": member.get("dir"),
                             "grace": member["last_ok"] < (self.evaluated_at or now),
                             **({k: member[k] for k in ("rule", "minutes", "dp", "doi") if k in member})}
        return out

    def list_view(self, lista: str, limit: int = 50) -> dict:
        if lista not in LISTS:
            raise ValueError(f"lista es {', '.join(LISTS)}")
        symbols = self.order.get(lista, [])[:max(1, min(int(limit), 200))]
        return {"success": True, "lista": lista, "name": LIST_NAMES[lista], "rule": self.rule_text(lista),
                "at": self.tickers_at, "cycle": self.cycle, "market": self.market, "building": self.building(),
                "total": len(self.order.get(lista, [])), "rows": [self.row(s, lista) for s in symbols],
                "config": {k: self.config[k] for k in ("size_usdt", "stop_atr1h", "stop_atr4h", "floor_usd", "groups", "allow_st")}}

    def rule_text(self, lista: str) -> str:
        cfg = self.config
        if lista == "enjuego":
            return (f"Libro suficiente (ida y vuelta de {cfg['book_max_bps']:g} bps o menos para {cfg['size_usdt']:,.0f} USDT) y "
                    f"volumen relativo de 24 h de {cfg['rvol24_min']:g} o más, o de la última hora de {cfg['rvol1h_min']:g} o más, "
                    "contra la misma hora de días del mismo tipo. Ordena por el de 24 h.")
        if lista == "tendencia":
            return ("Libro suficiente, rompe el máximo o el mínimo de los 20 días anteriores, eficiencia de 7 días en el tercio "
                    "alto de las candidatas y movimiento propio de 7 días a favor. Ordena por el movimiento propio.")
        if lista == "rapidos":
            f = cfg["fast"]
            return (f"Precio {f['a_price_pct']:g}% o más y OI +{f['a_oi_pct']:g}% o más en {f['a_min']} min, o precio "
                    f"{f['b_price_pct']:g}% y OI +{f['b_oi_pct']:g}% en {f['b_min']} min, con {f['floor_usd'] / 1e6:g} M USD "
                    "por día o más (los ejemplos del Pump Screener de WunderTrading). Solo para mirar.")
        return "Las monedas de la suite, de más a menos turnover."

    def building(self) -> bool:
        return bool(self.candidates) and any(s not in self.bars and s not in self.coin_errors for s in self.candidates)

    def coin(self, sym: str) -> dict:
        if sym not in self.tickers and sym not in self.metrics:
            raise KeyError(sym)
        lists = [name for name in LISTS if sym in self.order.get(name, [])]
        return {"success": True, "lists": lists, "row": self.row(sym, lists[0] if lists else "mias"),
                "candidate": sym in self.candidates, "error": self.coin_errors.get(sym)}

    def status(self) -> dict:
        groups = {}
        for s in self.tickers:
            g = (self.instruments.get(s) or {}).get("group", "otros")
            groups[g] = groups.get(g, 0) + 1
        return {"success": True, "sends": False, "enabled": self.config["enabled"], "env_off": _env_off(),
                "running": bool(self._tasks and self._lock_fh is not None and self.config["enabled"]),
                "other_process": self.other_process, "started_at": self.started_ms, "universe": len(self.tickers),
                "groups": groups, "candidates": len(self.candidates), "loaded": sum(1 for s in self.candidates if s in self.bars),
                "building": self.building(), "tickers_at": self.tickers_at, "cycle": self.cycle, "books": self.book_round,
                "books_extra": self.book_extra, "restored": self.restored, "meta_at": self.meta_at or None,
                "delistings": len(self.delistings), "errors": list(self.errors)[-5:],
                "coin_errors": dict(list(self.coin_errors.items())[:10]), "config_error": self.config_error,
                "lists": {k: len(v) for k, v in self.order.items()}}

    def brief(self) -> dict:
        s = self.status()
        return {"running": s["running"], "enabled": s["enabled"], "universe": s["universe"], "candidates": s["candidates"],
                "building": s["building"], "lists": s["lists"], "other_process": s["other_process"],
                "errors": len(s["errors"])}


def make_router(scanner: Scanner) -> APIRouter:
    router = APIRouter()

    @router.get("/api/scanner/status")
    async def scanner_status():
        return scanner.status()

    @router.get("/api/scanner/config")
    async def scanner_config():
        return {"success": True, "config": scanner.config, "defaults": DEFAULT_CONFIG, "groups": GROUP_NAMES,
                "lists": LIST_NAMES, "sends": False}

    @router.post("/api/scanner/config")
    async def scanner_set_config(request: Request):
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "el cuerpo debe ser JSON")
        try:
            return {"success": True, "config": scanner.set_config(body)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get("/api/scanner/list")
    async def scanner_list(lista: str = "enjuego", limit: int = 50):
        try:
            return scanner.list_view(lista, limit)
        except ValueError as e:
            raise HTTPException(400, str(e))

    @router.get("/api/scanner/market")
    async def scanner_market():
        return {"success": True, "market": scanner.market}

    @router.get("/api/scanner/coin/{symbol}")
    async def scanner_coin(symbol: str):
        symbol = (symbol or "").upper()
        if not SYMBOL_RE.match(symbol):
            raise HTTPException(400, "moneda invalida")
        if symbol in scanner.tickers:
            book = scanner.books.get(symbol)
            now = scanner._now()
            if not book or now - book.get("at", 0) > BOOK_EVERY_MS or book.get("size") != scanner.config["size_usdt"]:
                try:
                    await scanner.fetch_book(symbol, now)   # el detalle de una moneda trae su libro al dia
                    if symbol in scanner.metrics:
                        apply_costs(scanner.metrics[symbol], scanner.books.get(symbol), scanner.config, now)
                except Exception as e:
                    scanner.coin_errors[symbol] = f"libro: {type(e).__name__}: {e}"[:200]
        try:
            return scanner.coin(symbol)
        except KeyError:
            raise HTTPException(404, f"{symbol} no es un perpetuo USDT que cotice en Bybit (o el scanner todavía no lo vio)")

    @router.get("/api/scanner/events")
    async def scanner_events(limit: int = 100, day: str = None, lista: str = None):
        if lista is not None and lista not in LISTS:
            raise HTTPException(400, f"lista es {', '.join(LISTS)}")
        try:
            return {"success": True, "events": scanner.events_log(limit, day, lista)}
        except ValueError as e:
            raise HTTPException(400, str(e))

    return router
