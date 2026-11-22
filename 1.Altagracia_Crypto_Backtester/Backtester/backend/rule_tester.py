"""
Probador de reglas del Observador: una regla (elementos de order flow + entrada + stop + salida) corrida
sobre un tramo fijo del histórico, con cada trade contabilizado.

- Tres fases por fecha (UTC). La 1 es para explorar. La 2 y la 3 se corren con la regla ya decidida: su
  resultado queda guardado por regla exacta y no se vuelve a calcular, y la 3 exige haber pasado por la 2.
- Nada usa el futuro: la señal se conoce al cierre de su vela (of_setups.match_recipes), se entra en la
  apertura de la siguiente o con una limit que se llena al cruzar, y el stop sale de velas ya cerradas.
  Un trade que sigue abierto al final de la fase no cuenta: su salida está en la fase siguiente.
- Cuando stop y objetivo caen en la misma vela se mira minuto a minuto; si siguen juntos, cuenta el stop. Sin
  minutos, con el recorrido supuesto de la vela (apertura, el extremo más cercano, el otro y cierre: _minute_path).
- Cada trade guarda, además de lo que pide la regla, todos los elementos presentes en su ventana y las
  medidas de measures.py al decidir, para buscar qué separa a los ganadores de los perdedores.
"""
import bisect
import collections
import datetime as dt
import os
import pathlib
import gzip
import hashlib
import json
import math
import random
import threading
import time
import uuid

import numpy as np

import box_elements
import byko
import flow_filters
import fvg_swing
import footprint_store as fs
import gaussian_channel
import liq_sweeps
import onchain_flows
import measures
import observer
import of_elements as oe
import of_setups as os_
import patterns
import response_volume
import candle_patterns
import smc
import structure
import vp_sessions
import vpa
import williams

TFS = (5, 15, 30, 60, 240, 1440)
DAY_MS = 86400000
DAILY = 1440   # En 1 día la regla corre sobre velas, en todas las monedas: solo valen los elementos de CANDLE_CODES
CUTS = ("2024-01-01", "2025-07-01")  # Inicio de la fase 2 y de la fase 3 (la 3 coincide con el corte de los setups)
PHASE_NAMES = {1: "Exploración", 2: "Validación", 3: "Final"}
WARM_DAYS = oe.WINDOW_DAYS + 1  # Los umbrales relativos necesitan 30 días previos
CHUNK_DAYS = 60
TAKER_FEE = 0.00055
MAKER_FEE = 0.0002
REACH_BARS = 300          # Velas en que se mide hasta dónde llegó el precio antes del stop inicial
REACH_LEVELS = (1, 2, 3, 5)
DEFAULT_HORIZON = 96
MAX_HORIZON = 2000
GAP_MS = 6 * 3600000      # Un hueco de datos mayor cierra el trade en la última vela conocida
BASE_TRADES = 3000
SMALL_SAMPLE = 30
MAX_FILTERS = 3
MAX_WINDOW = 10           # Un gatillo puede llegar hasta 10 velas después del barrido
VP_CODES = ("VR", "VF", "VX", "VE")  # Contra el valor de la sesión anterior (vp_sessions.py)
# Patrones de vela de "Rejection Patterns" (candle_patterns.py): el lado lo da el patrón
PATTERN_CODES = {"HM": "Martillo (alcista) o estrella fugaz (bajista)", "EN": "Envolvente alcista o bajista",
                 "DJ": "Doji libélula (alcista) o lápida (bajista)"}
PATTERN_OF = {"HAMMER": "HM", "SHOOTING_STAR": "HM", "ENGULFING_BULLISH": "EN", "ENGULFING_BEARISH": "EN",
              "DOJI_DRAGONFLY": "DJ", "DOJI_GRAVESTONE": "DJ"}
LINE_TYPES = ("vwap", "ema")   # VWAP móvil de N velas y EMA de N velas, sobre las velas de la regla
RV_CODES = tuple(response_volume.CODES)  # Flecha y rombo del Volumen de Respuesta
EXTRA_CODES = ("LIQ", "VH") + VP_CODES + ("CC",) + tuple(PATTERN_CODES) + RV_CODES + tuple(gaussian_channel.CODES) + tuple(box_elements.CODES) + tuple(fvg_swing.CODES) + tuple(williams.CODES) + tuple(smc.CODES) + tuple(vpa.CODES) + tuple(byko.CODES)  # Elementos del probador que no son de of_elements
VP_CONTROL_RUNS = 3       # Corridas con los perfiles desplazados al azar que se juntan en el control
MIN_TARGET_R = 0.3        # Un objetivo en un nivel a menos de esto del riesgo no se opera

_jobs = {}
_spans = {}
_lock = threading.Lock()
_write_lock = threading.Lock()


def tester_dir():
    return observer.OBSERVER_DIR / "tester"


def _ms(day):
    return int(dt.datetime.fromisoformat(day).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)


def _iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d")


# ==================== MONEDAS SIN ALMACÉN DE TRADES ====================
# Solo BTC tiene el almacén de trades completo. Los elementos que salen de las velas (CC, VH) y el barrido de
# liquidaciones (LIQ) no lo necesitan: en las demás monedas la regla corre sobre el caché de velas de App 1.

CANDLE_DIR = pathlib.Path("backtesting_cache")   # Relativa: el backend corre en backend/
CANDLE_CODES = ("CC", "VH", "LIQ", "HM", "EN", "DJ", "RF", "RB", "GC", "BX", "BE", "CP", "FV", "SP", "IM") + tuple(williams.CODES) + tuple(smc.CODES) + tuple(vpa.CODES) + tuple(byko.CODES)
CANDLE_KEYS = {5: ("5m", 1), 15: ("15m", 1), 30: ("15m", 2), 60: ("1h", 1), 240: ("4h", 1), 1440: ("4h", 6)}  # marco → (clave del caché, velas que se unen)
MIN_STORE_DAYS = 60
_candles = {}


def has_store(symbol):
    if is_stock(symbol):
        return False  # Las acciones corren sobre sus velas (el almacén de Alpaca es de otra sesión y del gráfico)
    return fs.coverage(symbol).get("days", 0) >= MIN_STORE_DAYS


def _on_candles(symbol, tf):
    """Si la regla corre sobre las velas guardadas y no sobre el almacén de trades: monedas sin almacén, y el marco de 1 día."""
    return tf == DAILY or not has_store(symbol)


# Monedas nuevas: velas de 1h y 4h de Bybit que baja candles_update.py, fuera del repositorio. Nunca se usaron para
# elegir reglas: sirven para comprobar en todas sus fechas una regla elegida en las de App 1
EXTRA_DIR = pathlib.Path(os.environ.get("TESTER_CANDLES", r"C:\Users\inven\OrderFlowData\candles"))
EXTRA_KEYS = {5: ("5", 1), 15: ("15", 1), 30: ("15", 2), 60: ("60", 1), 240: ("240", 1), 1440: ("240", 6)}
EXTRA_FINE = ("5", "15")  # Desde el 21/11, cada uno en su carpeta (candles/15/{moneda}.json.gz), para no cargarlos con 1h y 4h
GROUPS = ("base", "new", "stocks", "all")
# Acciones de EE. UU. (Alpaca), que baja alpaca_candles.py (otra sesión): velas de 15 minutos, 1 hora, 4 horas y 1 día
# desde 2016, solo de la sesión regular. Las de 1h y 4h empiezan a las 09:30 de Nueva York y el día a la medianoche
# de Nueva York: se leen tal como vienen, sin llevarlas a la hora en punto (eso adelantaría lo que se sabe de cada vela)
STOCK_DIR = pathlib.Path(os.environ.get("ALPACA_CANDLES", "C:/Users/inven/OrderFlowData/alpaca/candles"))
STOCK_KEYS = {15: "15", 60: "60", 240: "240", 1440: "1440"}
STOCK_FEE = 0.0002            # Por lado: sin comisión, el spread. No cuenta el costo de pedir prestadas acciones para el corto
STOCK_GAP_MS = 5 * 86400000   # Noches, fines de semana y feriados no son huecos: el trade sigue y una apertura más allá se llena ahí


def base_symbols():
    """Monedas con caché de velas de App 1: con las que se han elegido las reglas."""
    return sorted(p.name.split("_")[0] for p in CANDLE_DIR.glob("*_backtesting_data.json.gz"))


def new_symbols():
    """Monedas nuevas, sin caché de App 1."""
    base = set(base_symbols())
    return sorted(s for s in (p.name.split(".")[0] for p in EXTRA_DIR.glob("*.json.gz")) if s not in base)


def stock_symbols():
    """Acciones con velas de Alpaca."""
    return sorted(s for s in (p.name.split(".")[0] for p in STOCK_DIR.glob("*.json.gz")) if not s.endswith("USDT"))


def is_stock(symbol):
    return not symbol.endswith("USDT") and (STOCK_DIR / f"{symbol}.json.gz").exists()


def candle_symbols(group="base"):
    """Símbolos del grupo: base (las monedas de App 1, las de siempre), new (las monedas nuevas), all (todas las monedas)
    o stocks (las acciones). "all" no incluye las acciones: son otro mercado."""
    if group == "stocks":
        return stock_symbols()
    if group == "new":
        return new_symbols()
    if group == "all":
        return sorted(set(base_symbols()) | set(new_symbols()))
    return base_symbols()


def _candle_path(symbol):
    if is_stock(symbol):
        return STOCK_DIR / f"{symbol}.json.gz"
    own = CANDLE_DIR / f"{symbol}_backtesting_data.json.gz"
    extra = EXTRA_DIR / f"{symbol}.json.gz"
    return own if own.exists() or not extra.exists() else extra


def has_candles(symbol, tf):
    """Si una moneda nueva tiene el archivo de velas de ese marco (sin abrirlo). Las demás, siempre."""
    path = _candle_path(symbol)
    if path.parent != EXTRA_DIR:
        return True
    name = EXTRA_KEYS.get(tf, (None,))[0]
    if name is None:
        return False
    return (EXTRA_DIR / name / f"{symbol}.json.gz").exists() if name in EXTRA_FINE else path.exists()


def candle_bars(symbol, tf):
    """Velas cerradas del caché de App 1 en el marco de la regla, con la forma de las del almacén (sin delta)."""
    path = _candle_path(symbol)
    if path.parent == STOCK_DIR:
        return _stock_bars(symbol, tf, path)
    extra = path.parent == EXTRA_DIR
    keys = EXTRA_KEYS if extra else CANDLE_KEYS
    if extra and tf in keys and keys[tf][0] in EXTRA_FINE:
        path = EXTRA_DIR / keys[tf][0] / f"{symbol}.json.gz"
    if tf not in keys or not path.exists():
        return []
    key = (symbol, tf, path.stat().st_mtime)
    with _lock:
        found = _candles.get(key)
    if found is not None:
        return found
    name, group = keys[tf]
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        if extra:
            rows = [{"timestamp": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
                    for r in json.load(fh).get(name) or []]
        else:
            rows = ((json.load(fh).get("timeframes") or {}).get(name) or {}).get("main") or []
    now = time.time() * 1000
    step = tf * 60000
    bars = []
    for c in rows:
        t = int(c["timestamp"])
        start = t // step * step
        if start + step > now or not c["high"] >= c["low"] > 0:
            continue  # La vela en curso no cuenta
        if bars and bars[-1]["t"] == start:
            last = bars[-1]
            last.update(h=max(last["h"], float(c["high"])), l=min(last["l"], float(c["low"])), c=float(c["close"]),
                        vol=last["vol"] + float(c.get("volume") or 0))
        else:
            bars.append({"t": start, "o": float(c["open"]), "h": float(c["high"]), "l": float(c["low"]), "c": float(c["close"]),
                         "delta": 0.0, "vol": float(c.get("volume") or 0)})
    if tf == DAILY and bars and rows and int(rows[0]["timestamp"]) != bars[0]["t"]:
        bars = bars[1:]  # El caché empieza a mitad de un día: ese día no está completo
    with _lock:
        _candles[key] = bars
        while len(_candles) > 3:
            _candles.pop(next(iter(_candles)))
    return bars


def _stock_bars(symbol, tf, path):
    """Velas de una acción en el marco, con su hora de inicio tal como viene (09:30 de Nueva York en 1h y 4h)."""
    if tf not in STOCK_KEYS or not path.exists():
        return []
    key = (symbol, tf, path.stat().st_mtime)
    with _lock:
        found = _candles.get(key)
    if found is not None:
        return found
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        rows = json.load(fh).get(STOCK_KEYS[tf]) or []
    now = time.time() * 1000
    bars = [{"t": int(r[0]), "o": float(r[1]), "h": float(r[2]), "l": float(r[3]), "c": float(r[4]), "delta": 0.0, "vol": float(r[5])}
            for r in rows if int(r[0]) + tf * 60000 <= now and r[2] >= r[3] > 0]  # La vela en curso no cuenta
    with _lock:
        _candles[key] = bars
        while len(_candles) > 3:
            _candles.pop(next(iter(_candles)))
    return bars


def codes_for(symbol, tf):
    """Elementos que puede usar una regla en ese símbolo y marco: None si todos (almacén de trades). Las acciones, los
    de velas menos el barrido de liquidaciones (no hay liquidaciones de acciones)."""
    if is_stock(symbol):
        return set(CANDLE_CODES) - {"LIQ"} - set(byko.OI_CODES)  # Ni liquidaciones ni OI de acciones
    return set(CANDLE_CODES) if _on_candles(symbol, tf) else None


def daily_bars(symbol):
    """Velas de 1 día (UTC): las de 4 horas del caché unidas y, antes de ellas, las del almacén de trades si la moneda lo tiene."""
    bars = candle_bars(symbol, DAILY)
    if not bars or not has_store(symbol):
        return bars
    early = early_candles(symbol, DAILY, bars[0]["t"])
    older = [{"t": int(t), "o": float(o), "h": float(h), "l": float(l), "c": float(c), "delta": 0.0, "vol": float(v)}
             for t, o, h, l, c, v in zip(early["t"], early["o"], early["h"], early["l"], early["c"], early["v"]) if t < bars[0]["t"]]
    return older + bars


def _candle_cover(symbol):
    """Primer y último día con velas de 15m en el caché, guardado junto al probador para no abrir el archivo cada vez."""
    path = _candle_path(symbol)
    if not path.exists():
        return None
    note = tester_dir() / "cache" / f"velas_tramo_{symbol}.json"
    stamp = path.stat().st_mtime
    try:
        with open(note, encoding="utf-8") as fh:
            saved = json.load(fh)
        if saved.get("stamp") == stamp:
            return saved
    except (OSError, ValueError):
        pass
    bars = candle_bars(symbol, 15) or candle_bars(symbol, 60)
    if not bars:
        return None
    saved = {"stamp": stamp, "first": _iso(bars[0]["t"] + oe.DAY_MS), "last": _iso(bars[-1]["t"] - oe.DAY_MS)}  # Días completos
    note.parent.mkdir(parents=True, exist_ok=True)
    with open(note, "w", encoding="utf-8") as fh:
        json.dump(saved, fh)
    return saved


# ==================== FASES ====================

def phases(symbol):
    """Tramo de cada fase para el símbolo, según lo que hay en el almacén (o en el caché de velas si no tiene almacén)."""
    cov = fs.coverage(symbol) if has_store(symbol) else (_candle_cover(symbol) or {})
    if not cov.get("first"):
        return []
    first = _ms(cov["first"]) + WARM_DAYS * oe.DAY_MS
    last = _ms(cov["last"]) + oe.DAY_MS
    bounds = [first, _ms(CUTS[0]), _ms(CUTS[1]), last]
    out = []
    for n in (1, 2, 3):
        start, end = max(bounds[n - 1], first), min(bounds[n], last)
        out.append({"phase": n, "name": PHASE_NAMES[n], "start": start, "end": end,
                    "from": _iso(start), "to": _iso(max(start, end - 1)), "days": max(0, (end - start) // oe.DAY_MS),
                    "available": end - start >= 30 * oe.DAY_MS, "last_day": cov["last"]})
    return out


# ==================== REGLA ====================

def _num(value, default, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    if math.isnan(value):
        return default
    return max(low, min(high, value))


def clean_rule(raw):
    """Regla válida con valores dentro de rango; None si no tiene elementos conocidos."""
    raw = raw or {}
    name = str(raw.get("name") or "Regla")[:60]
    recipe = os_.clean_recipe({**(raw.get("recipe") or {}), "id": name}, EXTRA_CODES, MAX_WINDOW)
    if recipe is None:
        return None
    tf = int(raw.get("tf") or 15)
    if tf not in TFS:
        tf = 15
    entry, stop, exit_ = raw.get("entry") or {}, raw.get("stop") or {}, raw.get("exit") or {}
    if raw.get("targetAt") and not exit_.get("targetAt"):
        # Una regla ya limpia lleva el objetivo de nivel arriba: limpiarla de nuevo (al correrla en todas las monedas
        # desde la búsqueda, por ejemplo) la deja igual. Antes lo perdía y quedaba con el cierre a las 96 velas
        exit_ = {**exit_, "targetAt": raw["targetAt"]}
    target_r = exit_.get("targetR")
    target_r = None if target_r in (None, "", 0, "0") else _num(target_r, 2.0, 0.2, 50.0)
    trail = exit_.get("trail") if exit_.get("trail") in TRAILS else "none"
    horizon = exit_.get("horizon")
    horizon = None if horizon in (None, "", 0, "0") else int(_num(horizon, DEFAULT_HORIZON, 1, MAX_HORIZON))
    known_keys = {item[0] for item in measures.MEASURES}
    filters = []
    for item in (raw.get("filters") or [])[:MAX_FILTERS]:
        if item.get("key") in known_keys and item.get("op") in (">=", "<="):
            filters.append({"key": item["key"], "op": item["op"], "value": _num(item.get("value"), 0.0, -1e9, 1e9)})
    liq = raw.get("liq") or {}
    extra = {}
    if any("LIQ" in slot["codes"] for slot in recipe["slots"]):
        # pierce: basta pasar el swing. reclaim: además una vela cierra de vuelta, en reclaimBars velas o menos
        # what: "swing" barre un swing dentro de una zona; "zone", la zona misma de lado a lado
        extra["liq"] = {"what": "zone" if liq.get("what") == "zone" else "swing",
                        "variant": "reclaim" if liq.get("variant") == "reclaim" else "pierce",
                        "swingBars": int(_num(liq.get("swingBars"), 5, 2, 20)),
                        "reclaimBars": int(_num(liq.get("reclaimBars"), 3, 0, 10))}
    if any(c in VP_CODES for slot in recipe["slots"] for c in slot["codes"]):
        vp = raw.get("vp") or {}
        hours = int(_num(vp.get("hours"), 24, 4, 168))
        # accept: minutos seguidos cerrando dentro (VR) o fuera (VX) del valor. failBars: velas para que un fallo cierre de vuelta
        shapes = sorted({s for s in (vp.get("shapes") or []) if s in vp_sessions.SHAPES})
        extra["vp"] = {**({"shapes": shapes} if shapes and len(shapes) < len(vp_sessions.SHAPES) else {}),  # Formas del perfil anterior que se operan
                       "hours": hours if hours in vp_sessions.PERIODS else 24, "accept": int(_num(vp.get("accept"), 30, 5, 480)),
                       "failBars": int(_num(vp.get("failBars"), 3, 1, 20)), "rows": int(_num(vp.get("rows"), 50, 10, 400)),
                       "share": _num(vp.get("share"), 70, 40, 95)}
        if any("VE" in slot["codes"] for slot in recipe["slots"]):
            # touch: entra tras el primer toque del borde. resting: orden limit esperando en el borde toda la sesión
            extra["vp"]["veEntry"] = "resting" if vp.get("veEntry") == "resting" else "touch"
        # Objetivo en un nivel del perfil en vez de un múltiplo del riesgo. mid: el centro del rango de la sesión anterior
        if exit_.get("targetAt") in ("poc", "edge", "mid"):
            extra["targetAt"], target_r = exit_["targetAt"], None
    entry_rule = {"type": entry.get("type") if entry.get("type") in ("market", "limit", "straddle", "stop") else "market",
                  "at": entry.get("at") if entry.get("at") in ("near", "mid", "far") else "near",
                  "expiry": int(_num(entry.get("expiry"), 8, 1, 200))}
    if entry_rule["type"] == "straddle":
        # Dos órdenes stop, una a cada lado; entra la que se llena primero y la otra se cancela. from: "close" pone cada
        # una a `offset` ATR del cierre de la vela de la señal; "zone", a `offset` ATR por fuera de la zona del elemento
        entry_rule = {"type": "straddle", "from": entry.get("from") if entry.get("from") in ("close", "zone") else "close",
                      "offset": _num(entry.get("offset"), 1.0, 0.0, 10.0), "expiry": entry_rule["expiry"]}
    if entry_rule["type"] == "stop":
        # Una orden stop a favor (20/11, los sabios de Williams): en el borde de la zona del elemento (su máximo en un
        # largo) más `offset` ATR. Espera `expiry` velas (el 3.er sabio, hasta que el precio pasa su fractal) y, con
        # cancel, se cancela si antes el precio pasa el otro borde de la zona
        entry_rule = {"type": "stop", "offset": _num(entry.get("offset"), 0.0, 0.0, 10.0), "expiry": int(_num(entry.get("expiry"), 5, 1, 500)),
                      "cancel": entry.get("cancel") is not False}
    if (extra.get("vp") or {}).get("veEntry") == "resting":
        # La orden espera en el borde del valor hasta que termina la sesión
        entry_rule = {"type": "limit", "at": "near", "expiry": max(1, extra["vp"]["hours"] * 60 // tf)}
    if any("CC" in slot["codes"] for slot in recipe["slots"]):
        cc = raw.get("cc") or {}
        struct_tf = int(_num(cc.get("tf"), tf, 1, 1440))
        if struct_tf not in structure.STRUCT_TFS or struct_tf < tf or struct_tf % tf:
            struct_tf = tf
        # tf: marco de las velas de la estructura. offset: minutos desde las 00:00 UTC en que empiezan (810 = 13:30)
        extra["cc"] = {"tf": struct_tf, "offset": int(_num(cc.get("offset"), 0, 0, 1439)) % struct_tf,
                       "swing": int(_num(cc.get("swing"), 3, 2, 20)), "legs": int(_num(cc.get("legs"), 2, 2, 5))}
    if any(c in PATTERN_CODES for slot in recipe["slots"] for c in slot["codes"]):
        pat = raw.get("pat") or {}
        # trend: el patrón pide un movimiento previo en contra, de trendBars velas. minZ: z-score mínimo del volumen de su vela
        # contra las 20 anteriores (None = sin filtro). wick: mecha mínima del martillo y la estrella, en cuerpos
        extra["pat"] = {"trend": pat.get("trend") is not False, "trendBars": int(_num(pat.get("trendBars"), 5, 1, 50)),
                        "minZ": None if pat.get("minZ") in (None, "") else _num(pat.get("minZ"), 1.0, -3.0, 20.0),
                        "wick": _num(pat.get("wick"), 2.0, 0.5, 10.0)}
    if any(c in RV_CODES for slot in recipe["slots"] for c in slot["codes"]):
        rv = raw.get("rv") or {}
        # leg: ATR con que gira el tramo. spike: veces el volumen normal de su hora. arrow: la flecha va a favor del
        # tramo, en contra o cualquiera. rombo: se opera contra el tramo (turn) o a favor (follow)
        extra["rv"] = {"leg": _num(rv.get("leg"), 2.0, 0.5, 10.0), "spike": _num(rv.get("spike"), 2.0, 1.2, 20.0),
                       "arrow": rv.get("arrow") if rv.get("arrow") in response_volume.ARROWS else "with",
                       "rombo": rv.get("rombo") if rv.get("rombo") in response_volume.ROMBOS else "turn"}
    if any("GC" in slot["codes"] for slot in recipe["slots"]):
        gc = raw.get("gc") or {}
        # period y poles: el filtro. mult: ancho de las bandas en rangos verdaderos filtrados. trend: la línea central va a
        # favor. exit: sale al cerrar de vuelta dentro de la banda (band), al otro lado de la línea central (mid) o no sale por el canal
        extra["gc"] = {"period": int(_num(gc.get("period"), 144, 10, 1000)), "poles": int(_num(gc.get("poles"), 4, 1, 9)),
                       "mult": _num(gc.get("mult"), 1.414, 0.2, 10.0), "trend": gc.get("trend") is not False,
                       "exit": gc.get("exit") if gc.get("exit") in gaussian_channel.EXITS else "band"}
    codes_used = {c for slot in recipe["slots"] for c in slot["codes"]}
    if codes_used & set(williams.CODES):
        wise = raw.get("wise") or {}
        # Los tres sabios con las medias del libro. lookback: velas cuyo mínimo queda arriba de la barra divergente;
        # angBars: velas en que el hueco con la mandíbula tiene que haber crecido; minGapAtr: ese hueco mínimo;
        # requireAo: el AO en contra; teeth: el 3.º solo del lado correcto de los dientes
        extra["wise"] = {"lookback": int(_num(wise.get("lookback"), 1, 1, 20)), "angBars": int(_num(wise.get("angBars"), 5, 1, 50)),
                         "minGapAtr": _num(wise.get("minGapAtr"), 0.0, 0.0, 10.0), "requireAo": wise.get("requireAo") is not False,
                         "teeth": wise.get("teeth") is not False}
    if codes_used & set(smc.CODES):
        sm = raw.get("smc") or {}
        extra["smc"] = {"internal": int(_num(sm.get("internal"), 5, 2, 50)), "swing": int(_num(sm.get("swing"), 50, 5, 300)),
                        "scope": "internal" if sm.get("scope") == "internal" else "swing",
                        "break": sm.get("break") if sm.get("break") in ("any", "bos", "choch") else "any",
                        "pick": "opposite" if sm.get("pick") == "opposite" else "extreme", "area": "body" if sm.get("area") == "body" else "full",
                        "mitigation": "wick" if sm.get("mitigation") == "wick" else "close", "eqLength": int(_num(sm.get("eqLength"), 3, 2, 20)),
                        "eqThreshold": _num(sm.get("eqThreshold"), 0.1, 0.01, 2.0), "reclaim": sm.get("reclaim") is not False}
        if extra["smc"]["internal"] >= extra["smc"]["swing"]:
            extra["smc"]["internal"] = max(2, extra["smc"]["swing"] - 1)
    vpf = raw.get("vpaf") or {}
    vexit = _vpa_exit(exit_)
    if codes_used & set(vpa.CODES) or vpf.get("mode") in vpa.FILTER_MODES or vexit:
        q = raw.get("vpa") or {}
        # El lector VPA (vpa.py): tramo en ATR, grado desde el que cuenta un elemento, umbral y memoria del medidor, y
        # velas del rango que se rompe, su alto máximo y las del retroceso. Solo entra si la regla usa sus elementos, su filtro o su salida
        extra["vpa"] = {"legAtr": _num(q.get("legAtr"), 2.0, 0.5, 10.0), "fire": _num(q.get("fire"), 0.5, 0.1, 1.0),
                        "meter": _num(q.get("meter"), 1.0, 0.2, 5.0), "decay": _num(q.get("decay"), 0.75, 0.0, 0.98),
                        "rangeBars": int(_num(q.get("rangeBars"), 20, 5, 200)), "maxRangeAtr": _num(q.get("maxRangeAtr"), 6.0, 1.0, 50.0),
                        "pullBars": int(_num(q.get("pullBars"), 8, 1, 50))}
    if vpf.get("mode") in vpa.FILTER_MODES:
        # Filtro del medidor VPA en la vela de la señal: a favor (favor) o que no esté en contra (notAgainst), con su umbral
        extra["vpaf"] = {"mode": vpf["mode"], "thr": _num(vpf.get("thr"), 1.0, 0.0, 5.0)}
    if "BX" in codes_used:
        bx = raw.get("bx") or {}
        # maxHeight: solo rupturas de cajas de hasta tantos ATR de alto (None = todas)
        extra["bx"] = {"maxHeight": None if bx.get("maxHeight") in (None, "", 0) else _num(bx.get("maxHeight"), 5.0, 0.5, 50.0)}
    if "BE" in codes_used:
        be = raw.get("be") or {}
        # share: parte de la caja que cuenta como borde. maxBody: cuerpo máximo de la vela en ATR (0 = sin límite).
        # rejection: dónde tiene que cerrar la vela, de 0 (en el borde) a 1 (en el otro extremo de su vela)
        extra["be"] = {"share": _num(be.get("share"), 0.2, 0.05, 0.5), "maxBody": _num(be.get("maxBody"), 1.0, 0.0, 10.0),
                       "rejection": _num(be.get("rejection"), 0.6, 0.0, 1.0)}
        if be.get("pattern"):
            extra["be"]["pattern"] = True  # Además un patrón de rechazo a favor en la vela; solo entra si se pide
        if exit_.get("targetAt") == "mid" and not any(c in VP_CODES for c in codes_used):
            extra["targetAt"], target_r = "mid", None  # Objetivo en el centro de la caja
    if "CP" in codes_used:
        cp = raw.get("cp") or {}
        extra["cp"] = {"maxHeight": None if cp.get("maxHeight") in (None, "", 0) else _num(cp.get("maxHeight"), 5.0, 0.5, 50.0)}
    if "IM" in codes_used:
        im = raw.get("im") or {}
        extra["im"] = {"bars": int(_num(im.get("bars"), 3, 1, 50)), "atr": _num(im.get("atr"), 2.0, 0.2, 20.0),
                       "range": None if im.get("range") in (None, "", 0) else _num(im.get("range"), 1.5, 0.1, 20.0)}
    if "FV" in codes_used:
        fv = raw.get("fv") or {}
        extra["fv"] = {"minAtr": _num(fv.get("minAtr"), 0.0, 0.0, 5.0)}  # Hueco mínimo en ATR
    if "SP" in codes_used:
        sp = raw.get("sp") or {}
        extra["sp"] = {"bars": int(_num(sp.get("bars"), 5, 2, 20)),
                       "minZ": None if sp.get("minZ") in (None, "") else _num(sp.get("minZ"), 1.0, -3.0, 10.0)}
    for code, key in byko.KEYS.items():
        if code in codes_used:
            extra[key] = byko.clean(key, raw.get(key))  # Los elementos de Byko (byko.py), con las cifras del plan de fábrica
    flow = raw.get("flow") or {}
    clean_flow = {}
    if flow.get("cvd"):
        clean_flow["cvd"] = int(_num(flow.get("cvd"), 20, 2, 500))  # CVD de N velas a favor
    if flow.get("oi") in OI_MODES:
        clean_flow["oi"] = flow["oi"]
        if flow["oi"] in ("rise", "fall"):
            clean_flow["oiBars"] = int(_num(flow.get("oiBars"), 6, 1, 100))
            clean_flow["oiPct"] = _num(flow.get("oiPct"), 2.0, 0.0, 50.0)
    if flow.get("crowd") in flow_filters.CROWD_MODES:
        clean_flow["crowd"] = flow["crowd"]  # Multitud por el funding: nocon (no ir con ella) o contra (solo contra ella)
    if flow.get("steady"):
        # OI sostenido: la parte de los pasos de 4 h de los últimos `steadyDays` días en que subió el OI, al menos `steadyMin`
        clean_flow["steady"] = True
        clean_flow["steadyDays"] = int(_num(flow.get("steadyDays"), 14, 3, 60))
        clean_flow["steadyMin"] = _num(flow.get("steadyMin"), 0.52, 0.3, 0.9)
    chain = flow.get("chain") or {}
    if chain.get("metric") in onchain_flows.METRICS:
        # Flujos on-chain diarios de Coin Metrics (21/11): flujo neto de BTC o ETH a los exchanges, o emisión de stablecoins
        clean_flow["chain"] = {"metric": chain["metric"], "days": int(_num(chain.get("days"), 7, 1, 90)),
                               "z": _num(chain.get("z"), 0.5, 0.0, 3.0),
                               "mode": chain.get("mode") if chain.get("mode") in onchain_flows.MODES else "favor"}
        if chain["metric"] == "net":
            clean_flow["chain"]["asset"] = chain.get("asset") if chain.get("asset") in onchain_flows.ASSETS else "auto"
    if clean_flow:
        extra["flow"] = clean_flow  # Solo entra si se pide: una regla sin él conserva su identidad
    bwf = raw.get("bwf") or {}
    # Filtros de Williams en la vela de la señal: el Alligator despierto a favor, el cierre del lado de los dientes o
    # dormido; zone, la zona de Williams a favor; desde el 21/11, el AO y el AC (su barra a favor, del lado del cero o las
    # dos), el Gator y el tipo de vela del MFI. Cada uno solo entra a la regla si se pide: una regla de antes conserva su
    # identidad
    clean_bwf = {}
    if bwf.get("alligator") in ("awake", "side", "sleeping"):
        clean_bwf["alligator"] = bwf["alligator"]
    if bwf.get("zone"):
        clean_bwf["zone"] = True
    for key in ("ao", "ac"):
        if bwf.get(key) in williams.MOMENTUM_MODES:
            clean_bwf[key] = bwf[key]
    if bwf.get("gator") in williams.GATOR_MODES:
        clean_bwf["gator"] = bwf["gator"]
    if bwf.get("mfi") in williams.MFI_MODES:
        clean_bwf["mfi"] = bwf["mfi"]
    if clean_bwf:
        extra["bwf"] = clean_bwf
    smcf = raw.get("smcf") or {}
    if smcf.get("pd") or smcf.get("bias"):
        # Filtros SMC: pd, un largo solo en discount y un corto solo en premium (del rango mayor); bias, a favor de la
        # tendencia de la estructura mayor (de `swing` velas)
        extra["smcf"] = {**({"pd": True} if smcf.get("pd") else {}), **({"bias": True} if smcf.get("bias") else {}),
                         "swing": int(_num(smcf.get("swing"), (extra.get("smc") or {}).get("swing", 50), 5, 300))}
    if exit_.get("targetAt") == "weak" and "targetAt" not in extra:
        extra["targetAt"], target_r = "weak", None  # Objetivo en el máximo (largo) o mínimo (corto) del rango mayor SMC
    lines = []
    for item in (raw.get("lines") or [])[:2]:
        if item.get("type") in LINE_TYPES and item.get("mode") in ("side", "touch"):
            # side: la vela de la señal cierra del lado de la línea a favor del trade. touch: además su mecha la toca.
            # slope: la línea va a favor en las últimas 5 velas
            lines.append({"type": item["type"], "period": int(_num(item.get("period"), 200 if item["type"] == "vwap" else 14, 2, 1000)),
                          "mode": item["mode"], "slope": bool(item.get("slope"))})
            # maxDev (solo VWAP): la vela de la señal no puede abrir a más de tantas desviaciones del VWAP, del lado del
            # trade. Solo entra a la regla si se pide: así una regla ya corrida conserva su identidad
            if item["type"] == "vwap" and item.get("maxDev") not in (None, "", False):
                lines[-1]["maxDev"] = _num(item.get("maxDev"), 1.0, 0.1, 10.0)
    if lines:
        extra["lines"] = lines
    hours = raw.get("hours") or {}
    if hours.get("on"):
        # Solo señales que se conocen (y entran) entre esas horas UTC, en minutos del día; de lunes a viernes si se pide
        extra["hours"] = {"from": int(_num(hours.get("from"), 0, 0, 1439)), "to": int(_num(hours.get("to"), 1439, 0, 1439)),
                          "weekdays": bool(hours.get("weekdays"))}
    reg = raw.get("regime") or {}
    if reg.get("mode") in REGIME_MODES:
        # Régimen de la vela de la señal, con el detector de regime_detectors (eficiencia con caja afinada) y, con
        # major, el rango mayor que une sus cajas. inside: solo en rango; outside: solo fuera; breakout: en las `after`
        # velas que siguen a la ruptura de un rango, mientras no empiece otro. Solo entra a la regla si se pide
        extra["regime"] = {"mode": reg["mode"], "major": reg.get("major") is not False,
                           "majorOut": int(_num(reg.get("majorOut"), 6, 1, 50)), "after": int(_num(reg.get("after"), 6, 1, 200))}
        if int(_num(reg.get("tf"), 0, 0, DAILY)) == DAILY and tf < DAILY:
            extra["regime"]["tf"] = DAILY  # Medido en velas diarias; solo entra si se pide
    leaves_channel = (extra.get("gc") or {}).get("exit") in ("band", "mid")
    if target_r is None and trail == "none" and horizon is None and "targetAt" not in extra and not leaves_channel and not vexit:
        horizon = DEFAULT_HORIZON  # Sin objetivo hace falta otra salida
    return {
        **extra,
        "name": name, "tf": tf, "recipe": recipe, "invert": bool(raw.get("invert")),
        "entry": entry_rule,
        "stop": {"type": stop.get("type") if stop.get("type") in ("swing", "candle", "zone", "atr") else "swing",
                 "bars": int(_num(stop.get("bars"), 5, 2, 20)), "atr": _num(stop.get("atr"), 1.5, 0.1, 20.0),
                 "buffer": _num(stop.get("buffer"), 0.1, 0.0, 5.0), "minAtr": _num(stop.get("minAtr"), 0.1, 0.0, 10.0),
                 "maxAtr": _num(stop.get("maxAtr"), 6.0, 0.2, 100.0)},
        "exit": {"targetR": target_r, "trail": trail, "trailBars": int(_num(exit_.get("trailBars"), 5, 2, 20)),
                 "horizon": horizon, "opposite": bool(exit_.get("opposite")), **_trail_extra(exit_, trail),
                 **_tp_trail(exit_, target_r), **_chain_target(exit_, target_r, "targetAt" in extra or bool(_tp_trail(exit_, target_r))), **vexit},
        "oneAtATime": raw.get("oneAtATime") is not False,
        # Velas de espera tras cerrar un trade antes de tomar otra señal (solo con una posición a la vez)
        "cooldown": int(_num(raw.get("cooldown"), 0, 0, 500)),
        # Hueco mínimo, en ATR, entre el área de valor y la vela que la abandona. 0 = la regla literal
        "vaGap": _num(raw.get("vaGap"), 0.0, 0.0, 5.0),
        "filters": filters,
        "target": _num(raw.get("target"), oe.DEFAULT_TARGET, 0.005, 0.3),
        "volFilter": _num(raw.get("volFilter"), oe.DEFAULT_VOL_FILTER, 0.0, 10.0),
    }


TRAILS = ("none", "swing", "atr", "pct", "bars")


def _trail_extra(exit_, trail):
    """Lo nuevo de la salida, solo si se usa: así una regla ya corrida conserva su identidad.
    trail atr: el stop queda a trailAtr ATR del mejor precio desde la entrada (máximo en un largo); pct: a trailPct %.
    trailStart: el trailing empieza cuando el trade llegó a tantos R a favor (0 = desde la entrada).
    breakEven: al llegar a tantos R a favor, el stop pasa a la entrada."""
    out = {}
    if trail == "atr":
        out["trailAtr"] = _num(exit_.get("trailAtr"), 3.0, 0.2, 20.0)
    if trail == "pct":
        out["trailPct"] = _num(exit_.get("trailPct"), 2.0, 0.05, 50.0)
    if trail in ("atr", "pct") and exit_.get("trailStart") not in (None, "", 0, "0"):
        out["trailStart"] = _num(exit_.get("trailStart"), 1.0, 0.0, 20.0)
    if exit_.get("breakEven") not in (None, "", 0, "0", False):
        out["breakEven"] = _num(exit_.get("breakEven"), 1.0, 0.1, 20.0)
    return out


TP_TRAIL_UNITS = ("r", "atr", "pct")

# Salida con el lector VPA (fase 4, 21/11/2026): seguir mientras el VPA no avise en contra y salir, en la apertura de la
# vela siguiente, con la primera de estas lecturas en contra del trade. En este orden si caen en la misma vela
VPA_EXITS = {"climax": "clímax o frenado", "absorb": "esfuerzo en contra", "push": "retroceso con volumen",
             "meter": "medidor en contra", "fade": "esfuerzo que se agota"}


def _vpa_exit(exit_):
    """La salida VPA, solo si se pide (una regla sin ella conserva su identidad). on: las lecturas que la disparan;
    thr: el umbral del medidor (solo con meter); fromR: la salida se arma cuando el trade llegó a tantos R a favor
    (0 = desde la entrada)."""
    raw = exit_.get("vpa") or {}
    on = [key for key in VPA_EXITS if key in (raw.get("on") or [])]
    if not on:
        return {}
    out = {"on": on, "fromR": _num(raw.get("fromR"), 0.0, 0.0, 20.0)}
    if "meter" in on:
        out["thr"] = _num(raw.get("thr"), 1.0, 0.2, 5.0)
    return {"vpa": out}


def _vpa_exit_bars(rule, ctx):
    """Por lado del trade, las velas en que el VPA avisa en contra: {1: {vela: motivo}, -1: {...}}. Todo se sabe al cerrar
    la vela, y la salida es en la apertura de la siguiente.
      climax  clímax o frenado (QC, QS) contra el lado del trade
      absorb  esfuerzo sin resultado contra el trade (una vela verde con mucho volumen y poco rango avisa a los largos)
      push    retroceso con volumen: una vela validada (rango ancho con volumen alto) del color contrario al trade
      meter   el medidor en contra del trade, a thr o más
      fade    el esfuerzo se agota en un tramo del lado del trade"""
    ve = rule["exit"]["vpa"]
    series = _vpa_series(rule, ctx)
    fire = rule["vpa"]["fire"]
    on = set(ve["on"])
    out = {1: {}, -1: {}}
    finite = vpa._finite
    events = []
    if "climax" in on:
        events = [e for e in vpa.detect(ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["V"], ctx["tf"], _vpa_cfg(rule), series)
                  if e["code"] in ("QC", "QS")]
    for e in events:
        out[-e["dir"]].setdefault(e["index"], "VPA: " + VPA_EXITS["climax"])
    for i in range(len(ctx["C"])):
        d, leg = series["dir"][i], series["leg"][i]
        if "absorb" in on and finite(series["absorb"][i]) and series["absorb"][i] >= fire:
            against = -d if d else -leg
            if against:
                out[-against].setdefault(i, "VPA: " + VPA_EXITS["absorb"])
        if "push" in on and d and finite(series["valid"][i]) and series["valid"][i] >= fire:
            out[-d].setdefault(i, "VPA: " + VPA_EXITS["push"])
        if "meter" in on and finite(series["meter"][i]) and finite(series["rv"][i]):
            for side in (1, -1):
                if series["meter"][i] * side <= -ve["thr"]:
                    out[side].setdefault(i, "VPA: " + VPA_EXITS["meter"])
        if "fade" in on and leg and finite(series["fade"][i]) and series["fade"][i] >= fire:
            out[leg].setdefault(i, "VPA: " + VPA_EXITS["fade"])
    return out


def _chain_target(exit_, target_r, level_target):
    """
    Objetivo distinto cuando los flujos on-chain van a favor del trade (pedido del usuario, 21/11/2026): en los días en que
    la emisión de stablecoins (u otra medida de onchain_flows) va a favor, el mercado da más, así que el objetivo es `r` R;
    los demás días, el objetivo de siempre (target_r). Se mira en la vela de la señal, con el dato ya publicado.
    Solo con el objetivo en R, y solo entra a la regla si se pide: una regla sin él conserva su identidad.
    """
    raw = exit_.get("chainTarget")
    if not isinstance(raw, dict) or raw.get("on") is False or target_r is None or level_target:
        return {}
    if raw.get("metric") not in onchain_flows.METRICS:
        return {}
    out = {"r": _num(raw.get("r"), 5.0, 0.2, 50.0), "metric": raw["metric"], "days": int(_num(raw.get("days"), 30, 1, 90)),
           "z": _num(raw.get("z"), 0.5, 0.0, 3.0), "mode": "favor"}
    if raw["metric"] == "net":
        out["asset"] = raw.get("asset") if raw.get("asset") in onchain_flows.ASSETS else "auto"
    return {"chainTarget": out}


def _tp_trail(exit_, target_r):
    """
    Trailing del objetivo, como lo hace un bot (pedido del usuario, 20/11/2026): el objetivo está fijo en target_r R y,
    al llegar el precio a `start` R a favor (antes del objetivo, o en él como máximo), deja de ser fijo: sigue al mejor
    precio a `dist` R, ATR (los de la vela de la señal) o % del mejor precio, y el trade se cierra cuando el precio
    vuelve hasta él. Solo con el objetivo en R, y solo entra a la regla si se pide: una regla sin él conserva su identidad.
    """
    raw = exit_.get("tpTrail")
    if not isinstance(raw, dict) or raw.get("on") is False or target_r is None:
        return {}
    unit = raw.get("unit") if raw.get("unit") in TP_TRAIL_UNITS else "r"
    start = _num(raw.get("start"), max(0.1, target_r - 0.5), 0.1, 50.0)
    return {"tpTrail": {"start": round(min(start, target_r), 4), "dist": _num(raw.get("dist"), 0.5, 0.01, 50.0 if unit == "pct" else 20.0),
                        "unit": unit}}


def rule_hash(symbol, rule):
    """Identidad de la regla exacta: el nombre no cuenta, lo demás sí."""
    body = {k: v for k, v in rule.items() if k != "name"}
    body["recipe"] = {k: v for k, v in rule["recipe"].items() if k != "id"}
    text = json.dumps([symbol, body], sort_keys=True, separators=(",", ":"), default=str)
    return hashlib.sha1(text.encode("utf-8")).hexdigest()[:16]


# ==================== ELEMENTOS DEL TRAMO ====================

def _span_path(symbol, tf, phase, rule):
    key = f"{symbol}_{tf}_f{phase['phase']}_{phase['from']}_{phase['to']}_t{rule['target']}_v{rule['volFilter']}"
    return tester_dir() / "cache" / (key.replace(".", "p") + ".npz")


def detect_span(symbol, tf, phase, rule, progress=None):
    """Velas y elementos de toda la fase. Se calcula una vez y queda en disco: una fase no cambia."""
    path = _span_path(symbol, tf, phase, rule)
    with _lock:
        cached = _spans.get(str(path))
    if cached is not None:
        return cached
    if _on_candles(symbol, tf):
        # Sin almacén, o en 1 día: las velas guardadas y ningún elemento de order flow
        source = daily_bars(symbol) if tf == DAILY else candle_bars(symbol, tf)
        span = {"bars": [b for b in source if phase["start"] <= b["t"] < phase["end"]], "events": []}
        if tf == DAILY:
            # Velas anteriores a la fase: ya ocurrieron, y un indicador lento (Gaussian Channel de 144 días) arranca con ellas
            span["warm"] = [b for b in source if b["t"] < phase["start"]]
        with _lock:
            _spans[str(path)] = span
            while len(_spans) > 3:
                _spans.pop(next(iter(_spans)))
        return span
    if path.exists():
        with np.load(path, allow_pickle=False) as z:
            bars = [dict(t=int(t), o=float(o), h=float(h), l=float(l), c=float(c), delta=float(d), vol=float(v))
                    for t, o, h, l, c, d, v in zip(z["t"], z["o"], z["h"], z["l"], z["c"], z["delta"], z["vol"])]
            events = [dict(code=str(code), dir=int(d), t=int(t), known=int(k), lo=float(lo), hi=float(hi))
                      for code, d, t, k, lo, hi in zip(z["e_code"], z["e_dir"], z["e_t"], z["e_known"], z["e_lo"], z["e_hi"])]
        span = {"bars": bars, "events": events}
    else:
        start, end, tf_ms = phase["start"], phase["end"], tf * 60000
        bars, events = [], []
        total = max(1, math.ceil((end - start) / (CHUNK_DAYS * oe.DAY_MS)))
        chunk_start, done = start, 0
        while chunk_start < end:
            chunk_end = min(end, chunk_start + CHUNK_DAYS * oe.DAY_MS)
            # Se pide una vela de más para que la última del tramo vea a su siguiente (VA abandonada);
            # lo que pasa del tramo se descarta y llega con el tramo que sigue
            part = oe.detect(symbol, tf, chunk_start, min(end, chunk_end + tf_ms) - 1, end, rule["target"], 0, rule["volFilter"])
            bars.extend(b for b in part["bars"] if chunk_start <= b["t"] < chunk_end)
            events.extend(e for e in part["events"] if chunk_start <= e["t"] < chunk_end and e["known"] <= end)
            chunk_start = chunk_end
            done += 1
            if progress:
                progress(done, total)
        span = {"bars": [dict(t=b["t"], o=b["o"], h=b["h"], l=b["l"], c=b["c"], delta=b["delta"], vol=b["vol"]) for b in bars],
                "events": [dict(code=e["code"], dir=e["dir"], t=e["t"], known=e["known"], lo=e["lo"], hi=e["hi"]) for e in events]}
        if span["bars"]:
            path.parent.mkdir(parents=True, exist_ok=True)
            partial = path.with_suffix(".tmp.npz")
            b, e = span["bars"], span["events"]
            np.savez_compressed(
                partial, t=np.array([x["t"] for x in b], np.int64), o=np.array([x["o"] for x in b]),
                h=np.array([x["h"] for x in b]), l=np.array([x["l"] for x in b]), c=np.array([x["c"] for x in b]),
                delta=np.array([x["delta"] for x in b]), vol=np.array([x["vol"] for x in b]),
                e_code=np.array([x["code"] for x in e], dtype="U2"), e_dir=np.array([x["dir"] for x in e], np.int8),
                e_t=np.array([x["t"] for x in e], np.int64), e_known=np.array([x["known"] for x in e], np.int64),
                e_lo=np.array([x["lo"] for x in e]), e_hi=np.array([x["hi"] for x in e]))
            partial.replace(path)
    with _lock:
        _spans[str(path)] = span
        while len(_spans) > 3:
            _spans.pop(next(iter(_spans)))
    return span


def early_candles(symbol, tf, before_ms):
    """
    Velas del almacén de trades desde el inicio de la fase 1 hasta before_ms, para el gráfico de la ventana: el caché
    de velas de App 1 guarda 5 años y la fase 1 empieza antes. Columnas t, o, h, l, c, v. Queda en disco por mes.
    """
    tf = int(tf)
    first = next((p["start"] for p in phases(symbol) if p["phase"] == 1), None)
    empty = {"t": [], "o": [], "h": [], "l": [], "c": [], "v": []}
    if first is None or tf not in TFS or before_ms <= first:
        return empty
    step = tf * 60000
    end = before_ms // step * step
    # El final se lleva al cierre del día: el archivo no cambia cada vez que el caché de velas corre una vela
    stop = -(-end // oe.DAY_MS) * oe.DAY_MS
    path = tester_dir() / "cache" / f"velas_{symbol}_{tf}_{_iso(first)}_{_iso(stop - 1)}.npz"
    if path.exists():
        with np.load(path, allow_pickle=False) as z:
            cols = {k: z[k] for k in empty}
    else:
        parts_t, parts = [], {k: [] for k in "ohlcv"}
        start = first
        while start < stop:
            chunk = min(stop, start + CHUNK_DAYS * oe.DAY_MS)
            found = fs._parts(symbol, start // 60000, chunk // 60000)
            if found:
                c = fs._candles(found, tf)
                parts_t.append(c["start"].astype(np.int64) * 60000)
                for key, name in (("o", "open"), ("h", "high"), ("l", "low"), ("c", "close")):
                    parts[key].append(c[name])
                parts["v"].append(c["buy"] + c["sell"])
            start = chunk
        if not parts_t:
            return empty
        cols = {"t": np.concatenate(parts_t), **{k: np.concatenate(v) for k, v in parts.items()}}
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".tmp.npz")
        np.savez_compressed(partial, **cols)
        partial.replace(path)
    keep = cols["t"] < end
    return {"t": cols["t"][keep].tolist(), **{k: np.round(cols[k][keep], 8).tolist() for k in "ohlcv"}}


# ==================== SIMULACIÓN ====================

def _pivot(values, start, n, sign):
    """Pivote más reciente en `start` o antes: mínimo (sign 1) o máximo (-1) de n velas a cada lado."""
    for p in range(start, max(n, start - 200) - 1, -1):
        if _is_pivot(values[p - n:p + n + 1], values[p], sign):
            return p
    return None


def _is_pivot(window, value, sign):
    """El único extremo de su ventana: empatar con una vecina no cuenta, como en S&R v2."""
    extreme = min(window) if sign > 0 else max(window)
    return value == extreme and window.count(extreme) == 1


def _stop_price(rule, ctx, k, side, zone, entry_hint):
    """Stop de la regla con lo conocido al cierre de la vela k. None si no hay dónde ponerlo."""
    stop, atr = rule["stop"], ctx["atr"][k]
    buffer = stop["buffer"] * atr
    lows, highs = ctx["L"], ctx["H"]
    kind = stop["type"]
    if kind == "atr":
        return entry_hint - side * stop["atr"] * atr
    if kind == "zone" and zone is not None:
        return zone[0] - buffer if side > 0 else zone[1] + buffer
    if kind == "swing":
        values = lows if side > 0 else highs
        # El swing debe quedar detrás de la entrada: si el último no lo está se busca el anterior
        # Un pivote necesita sus velas de la derecha ya cerradas: el más reciente posible es k - bars
        p = k - stop["bars"]
        for _ in range(6):
            p = _pivot(values, p, stop["bars"], side)
            if p is None:
                break
            if (entry_hint - values[p]) * side > 0:
                return values[p] - side * buffer
            p -= 1
        first = max(0, k - 4 * stop["bars"])
        return (min(lows[first:k + 1]) - buffer) if side > 0 else (max(highs[first:k + 1]) + buffer)
    # candle (y zone sin zona): extremo desde la primera vela del elemento hasta la que dispara
    first = max(0, min(k, ctx.get("i0", k)))
    return (min(lows[first:k + 1]) - buffer) if side > 0 else (max(highs[first:k + 1]) + buffer)


def _minute_path(ctx, j):
    """Minutos de la vela j: listas (t, h, l). Sin minutos de esa vela (moneda sin almacén, acción o día que falta), un
    recorrido supuesto de cuatro puntos: apertura, el extremo más cerca de la apertura, el otro extremo y cierre (el
    supuesto del emulador de TradingView). Medido el 20/11 contra los minutos reales, en las seis monedas que los tienen
    (fase 1, 4h): la ventaja de cuatro reglas quedó a 0.03 R o menos de la real. Contar siempre el stop, lo de antes,
    erraba hasta 0.8 R por trade con dos órdenes stop y llegó a inventar una ventaja de +0.13 R."""
    reader = ctx.get("minutes")
    if reader is not None:
        data = _minutes_of(ctx, reader, j)
        if data is not None and len(data["m"]):
            return list(zip((int(m) * 60000 for m in data["m"]), (float(x) for x in data["h"]), (float(x) for x in data["l"])))
    o, h, l, c = (float(ctx[key][j]) for key in ("O", "H", "L", "C"))
    points = (o, h, l, c) if h - o < o - l else (o, l, h, c)
    return [(ctx["T"][j] + step, p, p) for step, p in enumerate(points)]


MINUTES_KEEP = 1000  # Velas cuyos minutos se guardan en el contexto de una corrida (en 4h, unos 6 MB)


def _minutes_of(ctx, reader, j):
    """Los minutos de la vela j, guardados en el contexto: el azar vuelve muchas veces a las mismas velas (en BTC 4h, fase 1,
    con el objetivo arrastrado, 3,202 lecturas eran de 852 velas, a unos 5 ms cada una). Las últimas MINUTES_KEEP, solo
    con lo que se usa (minuto, máximo y mínimo); si cambia el lector, se empieza de nuevo."""
    if ctx.get("_minutes_reader") is not reader:
        ctx["_minutes_reader"], ctx["_minutes"] = reader, collections.OrderedDict()
    cache = ctx["_minutes"]
    if j in cache:
        cache.move_to_end(j)
        return cache[j]
    t0 = ctx["T"][j] // 60000
    data = reader(ctx["symbol"], t0, t0 + ctx["tf"])
    if data is not None:
        data = {"m": data["m"], "h": data["h"], "l": data["l"]}
    cache[j] = data
    if len(cache) > MINUTES_KEEP:
        cache.popitem(last=False)
    return data


def _straddle_fill(rule, ctx, k, e, zone, sides):
    """Las dos órdenes stop puestas al cierre de la vela k: (lado, precio, vela) de la que se llena primero, o None.
    Si las dos se tocan en la misma vela decide el minuto a minuto (sin minutos, el recorrido supuesto de la vela)."""
    T, O, H, L, C, atr = ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["atr"]
    ent = rule["entry"]
    off = ent["offset"] * atr[k]
    if ent["from"] == "zone" and zone is not None:
        up, dn = zone[1] + off, zone[0] - off
    else:
        up, dn = C[k] + off, C[k] - off
    for j in range(e, min(len(T), e + ent["expiry"])):
        hit = {sd: (H[j] >= up if sd > 0 else L[j] <= dn) for sd in sides}
        hit = [sd for sd, v in hit.items() if v]
        if not hit:
            continue
        if len(hit) == 2:
            first = None
            minutes = _minute_path(ctx, j)
            for _, mh, ml in minutes or []:
                if mh >= up or ml <= dn:
                    first = 1 if mh >= up and not ml <= dn else -1 if ml <= dn and not mh >= up else None
                    break
            if first is None:
                first = 1 if abs(up - O[j]) <= abs(O[j] - dn) else -1
            hit = [first]
        sd = hit[0]
        price = up if sd > 0 else dn
        gapped = (O[j] > up) if sd > 0 else (O[j] < dn)  # Abrió más allá: se llena en la apertura
        return sd, (O[j] if gapped else price), j
    return None


def _stop_fill(rule, ctx, k, e, zone, side):
    """La orden stop de un lado puesta al cierre de la vela k: (precio, vela) cuando se llena, o None.
    Va en el borde de la zona a favor más `offset` ATR (sin zona, o con from "close", desde el cierre). Espera `expiry`
    velas o, si el elemento lo dice (ctx["entryInfo"]["expiry"], el 3.er sabio), las suyas. Con cancel se cancela si antes
    el precio pasa el otro borde de la zona; si los dos se tocan en la misma vela decide el minuto a minuto (sin
    minutos, el recorrido supuesto de la vela)."""
    T, O, H, L, C, atr = ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["atr"]
    ent = rule["entry"]
    off = ent.get("offset", 0.0) * atr[k]
    if zone is None or ent.get("from") == "close":
        level, cancel = C[k] + side * off, None
    else:
        level = (zone[1] if side > 0 else zone[0]) + side * off
        cancel = (zone[0] if side > 0 else zone[1]) if ent.get("cancel") and zone[1] > zone[0] else None
    expiry = (ctx.get("entryInfo") or {}).get("expiry") or ent["expiry"]
    for j in range(e, min(len(T), e + expiry)):
        hit = H[j] >= level if side > 0 else L[j] <= level
        broke = cancel is not None and (L[j] < cancel if side > 0 else H[j] > cancel)
        if not hit:
            if broke:
                return None
            continue
        if broke:
            first = None
            for _, mh, ml in _minute_path(ctx, j) or []:
                up, down = (mh >= level, ml < cancel) if side > 0 else (ml <= level, mh > cancel)
                if up or down:
                    first = "fill" if up and not down else ("cancel" if down and not up else None)
                    break
            if first is None:
                first = "fill" if abs(level - O[j]) <= abs(O[j] - cancel) else "cancel"
            if first == "cancel":
                return None
        gapped = (O[j] > level) if side > 0 else (O[j] < level)  # Abrió más allá: se llena en la apertura
        return (O[j] if gapped else level), j
    return None


def simulate(rule, ctx, k, side, zone=None, opposite=None, sides=None, path=None):
    """
    Un trade con la señal conocida al cierre de la vela k. Devuelve None si no hay vela siguiente,
    {"skip": motivo} si la orden no entra, o el trade con "open": True si la fase termina antes de su salida.
    path (una lista): guarda ahí [hora de la vela, stop vigente en ella] de cada vela del trade, para dibujarlo.
    """
    T, O, H, L, C, atr = ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["atr"]
    n, tf_ms = len(T), ctx["tf"] * 60000
    e = k + 1
    if e >= n or T[e] - T[k] > ctx.get("gap", max(GAP_MS, 2 * ctx["tf"] * 60000)):
        return None
    entry_rule, exit_rule = rule["entry"], rule["exit"]
    taker, maker = ctx.get("taker", TAKER_FEE), ctx.get("maker", MAKER_FEE)
    entry, entry_i, fee_in, limit_fill, stop_fill = O[e], e, taker, False, False
    if entry_rule["type"] == "straddle":
        filled = _straddle_fill(rule, ctx, k, e, zone, sides or (1, -1))
        if filled is None:
            return {"skip": "ninguna orden stop se llenó"}
        side, entry, entry_i = filled
        stop_fill = entry != O[entry_i]  # En la apertura no hay vela previa que mirar
    if entry_rule["type"] == "stop":
        filled = _stop_fill(rule, ctx, k, e, zone, side)
        if filled is None:
            return {"skip": "orden stop sin llenar"}
        entry, entry_i = filled
        stop_fill = entry != O[entry_i]
    if isinstance(opposite, dict):
        opposite = opposite.get(-side)
    if entry_rule["type"] == "limit" and zone is not None:
        share = {"near": 1.0, "mid": 0.5, "far": 0.0}[entry_rule["at"]]
        price = zone[0] + share * (zone[1] - zone[0]) if side > 0 else zone[1] - share * (zone[1] - zone[0])
        if (O[e] - price) * side > 0:  # El precio tiene que volver hasta la limit
            entry_i = None
            for j in range(e, min(n, e + entry_rule["expiry"])):
                if (L[j] < price) if side > 0 else (H[j] > price):  # Se llena al cruzar, no al tocar
                    entry, entry_i, fee_in, limit_fill = price, j, maker, True
                    break
            if entry_i is None:
                return {"skip": "limit sin llenar"}
    stop = _stop_price(rule, ctx, k, side, zone, entry)
    risk = (entry - stop) * side if stop is not None else 0
    if risk <= 0:
        return {"skip": "stop del lado equivocado"}
    stop_atr = risk / atr[k] if atr[k] > 0 else 0
    if stop_atr < rule["stop"]["minAtr"]:
        return {"skip": "stop muy corto"}
    if stop_atr > rule["stop"]["maxAtr"]:
        return {"skip": "stop muy largo"}
    target_r, chain_on = exit_rule["targetR"], None
    if target_r and exit_rule.get("chainTarget") and "bars" in ctx:
        # Objetivo mixto: con los flujos on-chain a favor en la vela de la señal, el objetivo de los días que dan más
        ct = exit_rule["chainTarget"]
        chain_on = bool(onchain_flows.chain_ok(ct, _chain_series(ct, ctx)[1][k], side))
        if chain_on:
            target_r = ct["r"]
    target = entry + side * risk * target_r if target_r else None
    if rule.get("targetAt") == "weak":
        # El máximo (largo) o el mínimo (corto) del rango mayor SMC en la vela de la señal: la liquidez del lado débil
        rng = _smc_range(rule, ctx) if "bars" in ctx else None
        level = None if rng is None else (rng["top"][k] if side > 0 else rng["bottom"][k])
        if level is None or not level == level:
            return {"skip": "sin rango SMC para el objetivo"}
        target = level
        if (target - entry) * side < MIN_TARGET_R * risk:
            return {"skip": "objetivo del rango muy cerca o ya pasado"}
    elif rule.get("targetAt"):
        # Objetivo en el POC o en el borde contrario del valor de la sesión anterior
        levels = ctx.get("vp")
        if levels is None:
            return {"skip": "sin perfil para el objetivo"}
        if rule["targetAt"] == "mid" and levels.get("high") is not None:
            target = (levels["high"] + levels["low"]) / 2
        else:
            target = levels["poc"] if rule["targetAt"] in ("poc", "mid") else (levels["vah"] if side > 0 else levels["val"])
        if (target - entry) * side < MIN_TARGET_R * risk:
            return {"skip": "objetivo del perfil muy cerca o ya pasado"}
    initial_stop = stop
    # Trailing del objetivo (_tp_trail): al llegar a tp_start el objetivo deja de ser fijo y sigue al mejor precio a una
    # distancia fijada en la entrada (con el ATR de la vela de la señal) o en % del mejor precio. El objetivo fijo nunca
    # cierra el trade (goal): el trailing se activa antes o en él, y desde ahí lo arrastra
    tp = exit_rule.get("tpTrail")
    goal = None if tp else target
    tp_start = tp_gap = None
    if tp:
        tp_start = entry + side * tp["start"] * risk
        tp_gap = tp["dist"] * risk if tp["unit"] == "r" else (tp["dist"] * atr[k] if tp["unit"] == "atr" else None)
    tp_on = tp_level = None  # Cuándo se activó y dónde va el objetivo arrastrado
    tp_best = entry  # Mejor precio desde la entrada, mirado dentro de la vela

    def favorable(j):
        return ((H[j] if side > 0 else L[j]) - entry) * side / risk

    def adverse(j):
        return ((L[j] if side > 0 else H[j]) - entry) * side / risk

    def stop_reason(level):
        return "stop" if level == initial_stop else ("stop en la entrada" if level == entry else "stop arrastrado")

    exit_price = exit_t = reason = None
    mfe, mae = 0.0, 0.0
    j = entry_i
    while j < n:
        if j > entry_i and T[j] - T[j - 1] > ctx.get("gap", max(GAP_MS, 2 * ctx["tf"] * 60000)):
            exit_price, exit_t, reason = C[j - 1], T[j - 1] + tf_ms, "hueco de datos"
            break
        row = None
        if path is not None:
            # El stop que rige en esta vela (se mueve al cerrarla y vale desde la siguiente) y, con el trailing del
            # objetivo activo, dónde quedó el objetivo arrastrado al cerrarla o al salir
            row = [T[j], stop, None]
            path.append(row)
        low, high = L[j], H[j]
        first_bar = (limit_fill or stop_fill) and j == entry_i
        walk = False
        if tp and (tp_on is not None or ((high >= tp_start) if side > 0 else (low <= tp_start))):
            # Con el objetivo arrastrado, o si se activa en esta vela. Si el extremo en contra de la vela no llega ni al
            # nivel de antes ni al que deja su mejor precio, nada lo puede cerrar, sea cual sea el orden de sus precios:
            # basta con mover el mejor precio y el objetivo (y es mucho más rápido que leer sus minutos)
            peak, trough = (high, low) if side > 0 else (low, high)
            top = peak if (peak - tp_best) * side > 0 else tp_best
            after = top - side * (tp_gap if tp_gap is not None else abs(top) * tp["dist"] / 100)
            now = tp_level if tp_on is not None and (tp_level - stop) * side > 0 else stop
            if not first_bar and (trough - now) * side > 0 and (trough - after) * side > 0:
                tp_best, tp_on = top, (T[j] if tp_on is None else tp_on)
                if tp_level is None or (after - tp_level) * side > 0:
                    tp_level = after
                if row is not None:
                    row[2] = tp_level
            else:
                walk = True
        if walk:
            # Si no, se mira dentro de la vela como una orden trailing del exchange: minuto a minuto o, sin minutos, el
            # recorrido supuesto. Sale por el nivel que el precio toca primero, el stop vigente o el objetivo arrastrado.
            # En cada minuto se mira primero si lo toca y después si el mejor precio sube el objetivo; en el minuto del
            # llenado de una limit o stop solo cuenta el stop
            filled = not first_bar
            for step, (mt, mh, ml) in enumerate(_minute_path(ctx, j)):
                if not filled:
                    crossed = ((mh >= entry) if side > 0 else (ml <= entry)) if stop_fill else ((ml < entry) if side > 0 else (mh > entry))
                    if crossed:
                        filled = True
                        if (ml <= stop) if side > 0 else (mh >= stop):
                            exit_price, exit_t, reason = stop, mt, stop_reason(stop)
                            break
                    continue
                cap, why = stop, stop_reason(stop)
                if tp_on is not None and (tp_level - stop) * side > 0:
                    cap, why = tp_level, "objetivo arrastrado"
                if (ml <= cap) if side > 0 else (mh >= cap):
                    gapped = step == 0 and not first_bar and ((O[j] < cap) if side > 0 else (O[j] > cap))
                    exit_price, exit_t, reason = (O[j] if gapped else cap), mt, why  # Abrió más allá: sale en la apertura
                    break
                top = mh if side > 0 else ml
                if (top - tp_best) * side > 0:
                    tp_best = top
                if tp_on is None and (tp_best - tp_start) * side >= 0:
                    tp_on = T[j]  # La vela en que se activó
                if tp_on is not None:
                    cap = tp_best - side * (tp_gap if tp_gap is not None else abs(tp_best) * tp["dist"] / 100)
                    if tp_level is None or (cap - tp_level) * side > 0:
                        tp_level = cap
            if row is not None:
                row[2] = tp_level
            if exit_price is not None:
                mfe = max(mfe, (tp_best - entry) * side / risk)
                mae = min(mae, (exit_price - entry) * side / risk)
                break
            hit_stop = hit_goal = False
        else:
            hit_stop = low <= stop if side > 0 else high >= stop
            hit_goal = goal is not None and (high >= goal if side > 0 else low <= goal)
        if hit_stop and (hit_goal or first_bar):
            # Dudoso a nivel de vela: se mira minuto a minuto (sin minutos, el recorrido supuesto). En el minuto del
            # llenado no cuenta el objetivo
            minutes = _minute_path(ctx, j)
            hit_stop = hit_goal = False
            if minutes is None:
                hit_stop = True
            else:
                filled = not first_bar
                for mt, mh, ml in minutes:
                    if not filled:
                        crossed = ((mh >= entry) if side > 0 else (ml <= entry)) if stop_fill else ((ml < entry) if side > 0 else (mh > entry))
                        if crossed:
                            filled = True
                            if (ml <= stop) if side > 0 else (mh >= stop):
                                hit_stop, exit_t = True, mt
                                break
                        continue
                    s = ml <= stop if side > 0 else mh >= stop
                    g = goal is not None and (mh >= goal if side > 0 else ml <= goal)
                    if s or g:
                        hit_stop, hit_goal, exit_t = s, g and not s, mt
                        break
        elif first_bar and hit_goal:
            hit_goal = False  # Sin stop tocado, el objetivo en la vela del llenado se deja para la siguiente
        if hit_stop:
            gapped = (O[j] < stop) if side > 0 else (O[j] > stop)
            exit_price = O[j] if gapped and not first_bar else stop
            reason = stop_reason(stop)
            exit_t = exit_t or T[j]
            mae = min(mae, (exit_price - entry) * side / risk)
            break
        if hit_goal:
            exit_price, reason, exit_t = goal, "objetivo", exit_t or T[j]
            mfe = max(mfe, (goal - entry) * side / risk)
            break
        mfe, mae = max(mfe, favorable(j)), min(mae, adverse(j))
        # Con la vela cerrada: señal contraria, horizonte y stop arrastrado
        if exit_rule["opposite"] and opposite is not None and j > k and j in opposite and j + 1 < n:
            exit_price, exit_t, reason = O[j + 1], T[j + 1], "señal contraria"
            break
        leave = (ctx.get("exitAt") or {}).get(side)
        if leave is not None and j > k and j in leave and j + 1 < n:
            exit_price, exit_t, reason = O[j + 1], T[j + 1], "sale del canal"
            break
        warn = (ctx.get("vpaExit") or {}).get(side, {}).get(j) if j > k and j + 1 < n else None
        if warn and mfe >= exit_rule["vpa"]["fromR"]:
            exit_price, exit_t, reason = O[j + 1], T[j + 1], warn
            break
        if exit_rule["horizon"] and j - entry_i + 1 >= exit_rule["horizon"]:
            exit_price, exit_t, reason = C[j], T[j] + tf_ms, "tiempo"
            break
        if exit_rule["trail"] == "swing":
            m = exit_rule["trailBars"]
            p = j - m
            if p - m >= 0 and p > k:
                values = L if side > 0 else H
                is_pivot = _is_pivot(values[p - m:j + 1], values[p], side)
                level = values[p] - side * rule["stop"]["buffer"] * atr[j]
                if is_pivot and (level - stop) * side > 0 and (C[j] - level) * side > 0:
                    stop = level
        elif exit_rule["trail"] == "bars" and j >= entry_i:
            # Williams: el stop bajo el mínimo (sobre el máximo) de las últimas trailBars velas cerradas; solo se acerca
            m = exit_rule["trailBars"]
            values = L if side > 0 else H
            window = values[max(0, j - m + 1):j + 1]
            level = (min(window) if side > 0 else max(window)) - side * rule["stop"]["buffer"] * atr[j]
            if (level - stop) * side > 0 and (C[j] - level) * side > 0:
                stop = level
        elif exit_rule["trail"] in ("atr", "pct") and mfe >= exit_rule.get("trailStart", 0.0):
            # Con la vela cerrada: el mejor precio desde la entrada, menos la distancia; el stop solo se acerca
            best = entry + side * mfe * risk
            gap = exit_rule["trailAtr"] * atr[j] if exit_rule["trail"] == "atr" else best * exit_rule["trailPct"] / 100
            level = best - side * gap
            if (level - stop) * side > 0 and (C[j] - level) * side > 0:
                stop = level
        if exit_rule.get("breakEven") and mfe >= exit_rule["breakEven"] and (entry - stop) * side > 0 and (C[j] - entry) * side > 0:
            stop = entry
        j += 1

    # Hasta dónde llegó antes del stop inicial, sin importar la salida elegida
    reach, reach_done = 0.0, False
    for i in range(entry_i + (1 if limit_fill or stop_fill else 0), min(n, entry_i + REACH_BARS)):
        if i > entry_i and T[i] - T[i - 1] > ctx.get("gap", max(GAP_MS, 2 * ctx["tf"] * 60000)):
            reach_done = True
            break
        if (L[i] <= initial_stop) if side > 0 else (H[i] >= initial_stop):
            reach_done = True
            break
        reach = max(reach, favorable(i))
    else:
        reach_done = entry_i + REACH_BARS <= n

    trade = {"k": k, "entry_i": entry_i, "dir": side, "signal": T[k], "known": T[k] + tf_ms, "entry_t": T[entry_i], "entry": entry,
             "stop": initial_stop, "target": target, "risk": risk, "stop_atr": round(stop_atr, 3),
             "order": "limit" if limit_fill else ("stop" if entry_rule["type"] in ("straddle", "stop") else "market"), "reach": round(reach, 3) if reach_done else None}
    if entry_rule["type"] in ("straddle", "stop"):
        trade["trigger_atr"] = round(abs(entry - C[k]) / atr[k], 3) if atr[k] > 0 else 0.0
    if chain_on is not None:
        trade["chain_on"] = chain_on  # Si el objetivo fue el de los días con los flujos on-chain a favor
    if tp:
        trade["tp_on"] = tp_on  # Cuándo se activó el trailing del objetivo; None si el precio nunca llegó a su arranque
    if exit_price is None:
        trade["open"] = True
        return trade
    gross = (exit_price - entry) * side / risk
    cost = (fee_in * entry + taker * exit_price) / risk
    trade.update(exit_t=exit_t, exit=exit_price, reason=reason, r=round(gross - cost, 4), gross=round(gross, 4),
                 mfe=round(mfe, 3), mae=round(mae, 3), bars=j - entry_i + 1, exit_i=j)
    return trade


# ==================== RESUMEN ====================

def _wilson(wins, n):
    return list(os_._wilson(wins, n))


def summary(trades):
    """Estadísticas de una lista de trades cerrados, en orden de salida."""
    rs = [t["r"] for t in trades]
    n = len(rs)
    if not n:
        return {"n": 0}
    wins = sum(1 for r in rs if r > 0)
    gains, losses = sum(r for r in rs if r > 0), -sum(r for r in rs if r < 0)
    equity, peak, drawdown, run_w, run_l, best_w, best_l = 0.0, 0.0, 0.0, 0, 0, 0, 0
    for r in rs:
        equity += r
        peak = max(peak, equity)
        drawdown = max(drawdown, peak - equity)
        run_w, run_l = (run_w + 1, 0) if r > 0 else (0, run_l + 1)
        best_w, best_l = max(best_w, run_w), max(best_l, run_l)
    reached = [t["reach"] for t in trades if t.get("reach") is not None]
    mean = sum(rs) / n
    var = sum((r - mean) ** 2 for r in rs) / (n - 1) if n > 1 else 0.0
    return {
        "n": n, "wins": wins, "winRate": round(100 * wins / n, 1), "wilson": _wilson(wins, n),
        "avgR": round(mean, 3), "totalR": round(sum(rs), 2), "seR": round(math.sqrt(var / n), 4),
        "profitFactor": round(gains / losses, 2) if losses > 0 else None,
        "avgWin": round(gains / wins, 3) if wins else None, "avgLoss": round(-losses / (n - wins), 3) if n > wins else None,
        "maxDrawdownR": round(drawdown, 2), "bestStreak": best_w, "worstStreak": best_l,
        "avgBars": round(sum(t["bars"] for t in trades) / n, 1),
        "medianMfe": round(float(np.median([t["mfe"] for t in trades])), 2),
        "medianMae": round(float(np.median([t["mae"] for t in trades])), 2),
        "reach": {str(level): round(100 * sum(1 for x in reached if x >= level) / len(reached), 1) for level in REACH_LEVELS} if reached else None,
        "reachN": len(reached), "medianReach": round(float(np.median(reached)), 2) if reached else None,
        "smallSample": n < SMALL_SAMPLE,
    }


def _brief(trades):
    n = len(trades)
    if not n:
        return {"n": 0, "winRate": None, "avgR": None, "totalR": 0.0}
    wins = sum(1 for t in trades if t["r"] > 0)
    return {"n": n, "winRate": round(100 * wins / n, 1), "avgR": round(sum(t["r"] for t in trades) / n, 3),
            "totalR": round(sum(t["r"] for t in trades), 2)}


def _split(trades, label, check):
    yes = [t for t in trades if check(t)]
    no = [t for t in trades if not check(t)]
    return {"label": label, "with": _brief(yes), "without": _brief(no)}


def _breakdowns(trades, rule):
    by = {"year": {}, "side": {}, "hour": {}, "reason": {}, "combo": {}}
    for t in trades:
        moment = dt.datetime.fromtimestamp(t["entry_t"] / 1000, dt.timezone.utc)
        by["year"].setdefault(str(moment.year), []).append(t)
        by["side"].setdefault("Largos" if t["dir"] > 0 else "Cortos", []).append(t)
        by["hour"].setdefault(f"{moment.hour // 4 * 4:02d}-{moment.hour // 4 * 4 + 4:02d} UTC", []).append(t)
        by["reason"].setdefault(t["reason"], []).append(t)
        by["combo"].setdefault("+".join(sorted(t["votes"])), []).append(t)
    # Perfil de la sesión anterior: su forma y dónde abrió la sesión del trade, también por lado
    open_names = {1: "Abrió encima del valor", -1: "Abrió debajo del valor", 0: "Abrió dentro del valor"}
    by.update(vpShape={}, vpShapeSide={}, vpOpen={})
    for t in trades:
        vp = t.get("vp")
        if not vp:
            continue
        shape = vp.get("shape") or "?"
        by["vpShape"].setdefault(shape, []).append(t)
        by["vpShapeSide"].setdefault(f"{shape} · {'largos' if t['dir'] > 0 else 'cortos'}", []).append(t)
        by["vpOpen"].setdefault(open_names.get(vp.get("open"), "?"), []).append(t)
    out = {name: [{"label": key, **_brief(group)} for key, group in sorted(groups.items())] for name, groups in by.items()}
    out["combo"].sort(key=lambda row: -row["n"])
    out["combo"] = out["combo"][:20]
    rule_codes = sorted({c for slot in rule["recipe"]["slots"] for c in slot["codes"]})
    out["ruleElements"] = [_split(trades, c, lambda t, c=c: c in t["votes"]) for c in rule_codes] if len(rule_codes) > 1 else []
    # Con "todos" cada trade tiene todos los elementos: no hay con qué comparar
    out["ruleElements"] = [row for row in out["ruleElements"] if row["with"]["n"] and row["without"]["n"]]
    others = sorted({c for t in trades for c in t["present"]} - set(rule_codes))
    out["otherElements"] = [_split(trades, c, lambda t, c=c: c in t["present"]) for c in others]
    against = sorted({c for t in trades for c in t["against"]})
    out["againstElements"] = [_split(trades, c, lambda t, c=c: c in t["against"]) for c in against]
    for key in ("otherElements", "againstElements"):
        out[key] = [row for row in out[key] if row["with"]["n"] >= 5 and row["without"]["n"] >= 5]
        out[key].sort(key=lambda row: -abs((row["with"]["avgR"] or 0) - (row["without"]["avgR"] or 0)))
    return out


# ==================== CORRIDA ====================

def _context(symbol, tf, bars):
    _, atr, _ = os_._series(bars)
    stock = is_stock(symbol)
    return {"symbol": symbol, "tf": tf, "T": [b["t"] for b in bars], "O": [b["o"] for b in bars], "H": [b["h"] for b in bars],
            "L": [b["l"] for b in bars], "C": [b["c"] for b in bars], "V": [b["vol"] for b in bars], "atr": atr, "minutes": fs.minutes,
            # Un salto mayor cierra el trade como hueco de datos; en acciones la noche y el fin de semana no lo son
            "gap": STOCK_GAP_MS if stock else max(GAP_MS, 2 * tf * 60000),
            "taker": STOCK_FEE if stock else TAKER_FEE, "maker": STOCK_FEE if stock else MAKER_FEE}


LINE_SLOPE_BARS = 5


def _line(ctx, kind, period):
    """VWAP móvil (precio típico por volumen de las últimas `period` velas, con la vela incluida) o EMA del cierre. NaN sin velas suficientes."""
    cache = ctx.setdefault("lines", {})
    key = (kind, period)
    if key not in cache:
        close = np.array(ctx["C"], dtype=float)
        n = len(close)
        out = np.full(n, np.nan)
        if kind == "vwap":
            volume = np.array(ctx["V"], dtype=float)
            typical = (np.array(ctx["H"]) + np.array(ctx["L"]) + close) / 3
            pv, vv = np.r_[0, np.cumsum(typical * volume)], np.r_[0, np.cumsum(volume)]
            if n >= period:
                total = vv[period:] - vv[:-period]
                out[period - 1:] = np.where(total > 0, (pv[period:] - pv[:-period]) / np.where(total > 0, total, 1), np.nan)
        else:
            k, value = 2 / (period + 1), close[0] if n else 0.0
            for i in range(n):
                value = close[i] * k + value * (1 - k)
                if i >= period - 1:
                    out[i] = value
        cache[key] = out
    return cache[key]


def _vwap_dev(ctx, period):
    """Desviación del VWAP móvil: la del precio típico alrededor del VWAP, pesada por volumen, en sus mismas `period`
    velas. Es la de las bandas del indicador VWAP en modo rolling. Se suma ventana por ventana: con sumas de todo el
    historial un tramo tranquilo no alcanza a medirse."""
    cache = ctx.setdefault("lines", {})
    key = ("vwapdev", period)
    if key not in cache:
        vwap = _line(ctx, "vwap", period)
        n = len(vwap)
        out = np.full(n, np.nan)
        if n >= period:
            volume = np.array(ctx["V"], dtype=float)
            typical = (np.array(ctx["H"], dtype=float) + np.array(ctx["L"], dtype=float) + np.array(ctx["C"], dtype=float)) / 3
            tw = np.lib.stride_tricks.sliding_window_view(typical, period)
            vw = np.lib.stride_tricks.sliding_window_view(volume, period)
            for a in range(0, len(tw), 2048):
                center = vwap[period - 1 + a: period - 1 + a + len(tw[a:a + 2048])]
                total = vw[a:a + 2048].sum(axis=1)
                spread = (vw[a:a + 2048] * (tw[a:a + 2048] - center[:, None]) ** 2).sum(axis=1)
                out[period - 1 + a: period - 1 + a + len(total)] = np.sqrt(np.where(total > 0, spread / np.where(total > 0, total, 1), np.nan))
        cache[key] = out
    return cache[key]


def _lines_ok(lines, ctx, k, side):
    """Si la vela k, que da a conocer la señal, cumple los filtros de línea a favor del trade."""
    for item in lines:
        line = _line(ctx, item["type"], item["period"])
        level = line[k]
        if not level == level:  # NaN: todavía no hay línea
            return False
        if (ctx["C"][k] - level) * side <= 0:
            return False
        if item["mode"] == "touch" and ((ctx["L"][k] if side > 0 else ctx["H"][k]) - level) * side > 0:
            return False
        if item["slope"]:
            before = line[k - LINE_SLOPE_BARS] if k >= LINE_SLOPE_BARS else float("nan")
            if not (level - before) * side > 0:
                return False
        if item.get("maxDev"):
            dev = _vwap_dev(ctx, item["period"])[k]
            if not dev == dev or (ctx["O"][k] - level) * side > item["maxDev"] * dev:
                return False
    return True


def _passes(filters, row):
    for item in filters:
        value = row.get(item["key"]) if row else None
        if value is None or (item["op"] == ">=" and value < item["value"]) or (item["op"] == "<=" and value > item["value"]):
            return False
    return True


def _va_gap_ok(min_gap, match, zones, index, ctx, tf_ms):
    """Cada VA abandonada de la señal deja al menos min_gap ATR entre su área y la vela que la abandonó."""
    for code, t in match["votes"]:
        if code != "VA":
            continue
        i = index.get(t)  # El voto cuenta en la vela que abandona el área
        if i is None or not ctx["atr"][i] > 0:
            return False
        for lo, hi, _ in zones.get((code, match["dir"], t + tf_ms), []):
            gap = ctx["L"][i] - hi if match["dir"] > 0 else lo - ctx["H"][i]
            if gap / ctx["atr"][i] < min_gap:
                return False
    return True


_extra = {}


def _in_hours(hours, t):
    """Si la hora t (ms) cae en el horario de la regla. Un horario que cruza la medianoche también vale."""
    moment = dt.datetime.fromtimestamp(t / 1000, dt.timezone.utc)
    if hours["weekdays"] and moment.weekday() >= 5:
        return False
    minute = moment.hour * 60 + moment.minute
    start, end = hours["from"], hours["to"]
    return start <= minute <= end if start <= end else (minute >= start or minute <= end)


def _bars_key(bars):
    """Huella de unas velas para el caché de elementos. No sirve `id(bars)`: al soltarse una lista, la de otra moneda
    puede recibir el mismo id y quedarse con los elementos de la anterior."""
    return (len(bars), bars[0]["t"], bars[-1]["t"], sum(b["h"] for b in bars), sum(b["l"] for b in bars), sum(b["c"] for b in bars),
            sum(b["vol"] for b in bars))


def _pattern_events(rule, span):
    """Patrones de vela de candle_patterns sobre las velas de la fase: una vela, a lo sumo un patrón."""
    pat = rule.get("pat")
    bars = span["bars"]
    if not pat or not bars:
        return []
    key = (_bars_key(bars), rule["tf"], "pat", pat["trend"], pat["trendBars"], pat["minZ"], pat["wick"])
    with _lock:
        found = _extra.get(key)
    if found is None:
        tf_ms = rule["tf"] * 60000
        candles = [{"open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["vol"]} for b in bars]
        opts = {"minWickRatio": pat["wick"], "enabled": {"hammer": True, "shootingStar": True, "engulfing": True, "doji": True},
                "requireTrend": pat["trend"], "trendBars": pat["trendBars"],
                "volume": {"enabled": pat["minZ"] is not None, "lookback": 20, "minZ": pat["minZ"] if pat["minZ"] is not None else 0.0}}
        found = []
        for p in candle_patterns.find_patterns(candles, opts):
            b = bars[p["index"]]
            found.append({"code": PATTERN_OF[p["type"]], "dir": 1 if p["type"] in candle_patterns.BULLISH else -1, "t": b["t"],
                          "known": b["t"] + tf_ms, "lo": b["l"], "hi": b["h"],
                          "info": {"type": p["type"], "volumeZ": None if p["volumeZ"] is None else round(p["volumeZ"], 2)}})
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _rv_events(rule, span):
    """Flecha y rombo del Volumen de Respuesta (response_volume.py) sobre las velas de la fase."""
    rv = rule.get("rv")
    bars = span["bars"]
    if not rv or not bars:
        return []
    key = (_bars_key(bars), rule["tf"], "rv", rv["leg"], rv["spike"], rv["arrow"], rv["rombo"])
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = response_volume.events(bars, rule["tf"], rv["leg"], rv["spike"], rv["arrow"], rv["rombo"])
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    return [e for e in found if e["code"] in codes]


def _gc_events(rule, span):
    """Gaussian Channel (gaussian_channel.py) sobre las velas de la fase."""
    gc = rule.get("gc")
    bars = span["bars"]
    if not gc or not bars:
        return []
    first = bars[0]["t"]
    bars = (span.get("warm") or []) + bars
    key = (_bars_key(bars), first, rule["tf"], "gc", gc["period"], gc["poles"], gc["mult"], gc["trend"])
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = [e for e in gaussian_channel.events(bars, rule["tf"], gc["period"], gc["poles"], gc["mult"], gc["trend"]) if e["t"] >= first]
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _cc_events(rule, span):
    """Cambio de carácter (structure.py) sobre las velas de la fase."""
    cc = rule.get("cc")
    bars = span["bars"]
    if not cc or not bars:
        return []
    key = (_bars_key(bars), rule["tf"], "cc", cc["tf"], cc["offset"], cc["swing"], cc["legs"])
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = structure.events(bars, rule["tf"], cc["tf"], cc["offset"], cc["swing"], cc["legs"])
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _extra_events(symbol, rule, span, ctx, control=False, vp_shift=None):
    """Elementos del probador que no son de of_elements: liquidaciones, volumen, perfil por sesión y estructura."""
    return (_liq_vp_events(symbol, rule, span, ctx, control, vp_shift) + _cc_events(rule, span) + _pattern_events(rule, span)
            + _rv_events(rule, span) + _gc_events(rule, span) + _box_events(rule, span) + _fs_events(rule, span)
            + _williams_events(rule, span) + _smc_events(rule, span) + _vpa_events(rule, span) + _byko_events(symbol, rule, span, control))


def _byko_codes(rule):
    return tuple(c for slot in rule["recipe"]["slots"] for c in slot["codes"] if c in byko.CODES)


def _byko_events(symbol, rule, span, control=False):
    """Los elementos de Byko (byko.py): los que cumplen la firma, o con `control` los que no."""
    codes = _byko_codes(rule)
    bars = span["bars"]
    if not codes or not bars:
        return []
    cfg = {key: rule[key] for key in byko.KEYS.values() if key in rule}
    key = (_bars_key(bars), symbol, rule["tf"], "byko", json.dumps(cfg, sort_keys=True), codes, byko.oi_stamp(symbol, cfg))
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = byko.candidates(symbol, bars, rule["tf"], cfg, codes)
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return [e for e in found if e["info"]["sig"] != control]


def _vpa_cfg(rule):
    return {**(rule.get("vpa") or {})}


def _vpa_events(rule, span):
    """Los elementos del lector VPA (vpa.py) sobre las velas de la fase."""
    q = rule.get("vpa")
    bars = span["bars"]
    codes = tuple(c for slot in rule["recipe"]["slots"] for c in slot["codes"] if c in vpa.CODES)
    if not q or not bars or not codes:
        return []
    key = (_bars_key(bars), rule["tf"], "vpa", json.dumps(q, sort_keys=True), codes)
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = vpa.events(bars, rule["tf"], _vpa_cfg(rule), codes)
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _vpa_series(rule, ctx):
    """Las lecturas del lector VPA de las velas de la corrida (filtro del medidor), por configuración."""
    cache = ctx.setdefault("vpaSeries", {})
    key = json.dumps(rule.get("vpa") or {}, sort_keys=True)
    if key not in cache:
        cache[key] = vpa.compute(ctx["T"], ctx["O"], ctx["H"], ctx["L"], ctx["C"], ctx["V"], ctx["tf"], _vpa_cfg(rule))
    return cache[key]


def _williams_events(rule, span):
    """Los tres sabios de Bill Williams (williams.py) sobre las velas de la fase."""
    wise = rule.get("wise")
    bars = span["bars"]
    if not wise or not bars:
        return []
    codes = tuple(c for slot in rule["recipe"]["slots"] for c in slot["codes"] if c in williams.CODES)
    # La ruptura de fractal se sabe al pasar el precio por él: solo la orden stop puede esperar en el fractal desde antes
    at_hit = rule["entry"]["type"] != "stop"
    key = (_bars_key(bars), rule["tf"], "wise", json.dumps(wise, sort_keys=True), codes, at_hit)
    with _lock:
        found = _extra.get(key)
    if found is None:
        cfg = {"lookback": wise["lookback"], "angBars": wise["angBars"], "minGapAtr": wise["minGapAtr"], "requireAo": wise["requireAo"],
               "alligatorFilter": wise["teeth"]}
        found = williams.events(bars, rule["tf"], cfg, codes, at_hit=at_hit)
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _smc_events(rule, span):
    """Ruptura, order block, breaker y barrido de iguales de la estructura SMC (smc.py) sobre las velas de la fase."""
    sm = rule.get("smc")
    bars = span["bars"]
    if not sm or not bars:
        return []
    codes = tuple(c for slot in rule["recipe"]["slots"] for c in slot["codes"] if c in smc.CODES)
    key = (_bars_key(bars), rule["tf"], "smc", json.dumps(sm, sort_keys=True), codes)
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = smc.events(bars, rule["tf"], sm, codes)
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _bw_series(ctx):
    """Series de Williams de las velas de la corrida, una vez por corrida (filtros)."""
    if "bwSeries" not in ctx:
        ctx["bwSeries"] = williams.compute(ctx["H"], ctx["L"], ctx["C"], v=ctx.get("V"))  # Con el volumen, para el MFI
    return ctx["bwSeries"]


def _smc_range(rule, ctx):
    """Rango mayor y tendencia SMC de las velas de la corrida (filtros y objetivo débil), por configuración: un contexto
    que comparten varias reglas (los controles de la búsqueda) no devuelve el rango de otra."""
    swing = (rule.get("smcf") or {}).get("swing") or (rule.get("smc") or {}).get("swing", 50)
    cfg = {**(rule.get("smc") or {}), "swing": swing}
    if cfg.get("internal", 5) >= swing:
        cfg["internal"] = max(2, swing - 1)
    cache = ctx.setdefault("smcRanges", {})
    key = json.dumps(cfg, sort_keys=True)
    if key not in cache:
        cache[key] = smc.ranges(ctx["bars"], cfg)
    return cache[key]


# Nombres cortos para los mensajes: los mismos de frontend/src/components/backtesting/elementLabels.js
LABELS = {"WD": "Barra divergente", "WA": "AO tres barras", "WF": "Ruptura de fractal", "BS": "Ruptura de estructura",
          "OB": "Order block", "BK": "Breaker", "EQ": "Barrido de iguales", "CP": "Compresión", "IM": "Impulso", "LIQ": "Barrido de liquidaciones", "VH": "Volumen alto", "VR": "Regreso al valor", "VF": "Fallo fuera del valor",
          "VX": "Aceptación fuera del valor", "VE": "Borde del valor", "CC": "Cambio de carácter", "HM": "Martillo o estrella",
          "EN": "Envolvente", "DJ": "Doji", "RF": "Flecha de volumen", "RB": "Rombo de volumen", "GC": "Canal gaussiano",
          "BX": "Ruptura de caja", "BE": "Borde de caja", "FV": "FVG nuevo", "SP": "Swing",
          "QA": "Esfuerzo sin resultado", "QB": "Ruptura con volumen", "QF": "Ruptura sin volumen", "QR": "Retroceso sin volumen",
          "QT": "Prueba de poco volumen", "QS": "Frenado o techo", "QC": "Clímax de volumen", "QE": "Medidor VPA",
          "FB": "Falso rompimiento", "BA": "Ruptura tras acumulación", "TA": "Trampa de absorción", "PO": "Purga de OI"}


def _labels(codes):
    """Los códigos con su nombre corto, para los mensajes; un elemento OF va con el nombre de su catálogo."""
    return ", ".join(LABELS.get(c) or (oe.CATALOG[c][0] if c in oe.CATALOG else c) for c in codes)


def _fs_events(rule, span):
    """FVG nuevo y swing del detector (fvg_swing.py)."""
    fv, sp, im = rule.get("fv"), rule.get("sp"), rule.get("im")
    bars = span["bars"]
    if (fv is None and sp is None and im is None) or not bars:
        return []
    key = (_bars_key(bars), rule["tf"], "fs", json.dumps(fv, sort_keys=True), json.dumps(sp, sort_keys=True), json.dumps(im, sort_keys=True))
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = fvg_swing.events(bars, rule["tf"], fv, sp, im)
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _sided(rule):
    """La regla tiene filtros que miran el lado del trade: CVD, OI, funding, Williams o SMC."""
    return bool(rule.get("flow") or rule.get("bwf") or rule.get("smcf") or rule.get("vpaf"))


def _side_ok(rule, ctx, k, side):
    """Los filtros que miran el lado en la vela k, para los controles al azar: entran solo donde la regla podría."""
    if rule.get("flow") and not _flow_ok(rule["flow"], ctx, k, side):
        return False
    if rule.get("bwf") and not williams.filter_ok(rule["bwf"], _bw_series(ctx), k, side):
        return False
    if rule.get("smcf") and not smc.filter_ok(rule["smcf"], _smc_range(rule, ctx), ctx["C"], k, side):
        return False
    if rule.get("vpaf") and not vpa.filter_ok(rule["vpaf"], _vpa_series(rule, ctx), k, side):
        return False
    return True


def _flow_ok(flow, ctx, k, side):
    """Filtros de CVD y OI de la vela k a favor del trade (flow_filters.py)."""
    cache, bars = ctx.setdefault("flow", {}), ctx["bars"]
    if flow.get("cvd"):
        if ("cvd", flow["cvd"]) not in cache:
            cache[("cvd", flow["cvd"])] = flow_filters.cvd(bars, flow["cvd"])[0]
        value = cache[("cvd", flow["cvd"])][k]
        if not value == value or value * side <= 0:
            return False
    if flow.get("oi"):
        if "oi" not in cache:
            oi = flow_filters.oi_at_close(ctx["symbol"], bars, ctx["tf"])
            signed = flow_filters.signed_volume(bars)[0]
            cache["oi"] = (oi, signed, None if oi is None else flow_filters.z_pair(oi, signed))
        oi, signed, z = cache["oi"]
        if not flow_filters.oi_ok(flow["oi"], oi, signed, k, side, flow.get("oiBars", 6), flow.get("oiPct", 2.0), z):
            return False
    if flow.get("crowd"):
        if "funding" not in cache:
            cache["funding"] = flow_filters.funding_3d(ctx["symbol"], bars, ctx["tf"])
        if not flow_filters.crowd_ok(flow["crowd"], cache["funding"][k], side):
            return False
    if flow.get("steady"):
        key = ("steady", flow["steadyDays"])
        if key not in cache:
            cache[key] = flow_filters.oi_steady(ctx["symbol"], bars, ctx["tf"], flow["steadyDays"])
        value = cache[key][k]
        if not value == value or value < flow["steadyMin"]:
            return False
    if flow.get("chain"):
        if not onchain_flows.chain_ok(flow["chain"], _chain_series(flow["chain"], ctx)[1][k], side):
            return False
    return True


def _chain_series(chain, ctx, symbol=None, tf=None):
    """Medida y z de los flujos on-chain al cierre de cada vela, en el caché de la corrida."""
    cache = ctx.setdefault("flow", {})
    key = ("chain", chain["metric"], chain.get("asset"), chain["days"])
    if key not in cache:
        cache[key] = onchain_flows.at_close(chain, symbol or ctx["symbol"], ctx["bars"], tf or ctx["tf"])
    return cache[key]


def _box_events(rule, span):
    """Ruptura y borde de las cajas del detector de régimen (box_elements.py)."""
    bx, be, cp = rule.get("bx"), rule.get("be"), rule.get("cp")
    bars = span["bars"]
    if (bx is None and be is None and cp is None) or not bars:
        return []
    key = (_bars_key(bars), rule["tf"], "box", json.dumps(bx, sort_keys=True), json.dumps(be, sort_keys=True), json.dumps(cp, sort_keys=True))
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = box_elements.events(bars, rule["tf"], bx, be, cp)
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    return found


def _liq_vp_events(symbol, rule, span, ctx, control=False, vp_shift=None):
    """LIQ y VH de liq_sweeps para las velas de la fase. control: los barridos sin liquidación pasan por LIQ."""
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    if not codes & set(EXTRA_CODES):
        return []
    if not codes & {"LIQ", "VH"}:
        return _vp_events(symbol, rule, span, vp_shift)
    liq = {"what": "swing", "variant": "pierce", "swingBars": 5, "reclaimBars": 3, **(rule.get("liq") or {})}
    key = (_bars_key(span["bars"]), symbol, rule["tf"], liq["what"], liq["variant"], liq["swingBars"], liq["reclaimBars"])
    with _lock:
        found = _extra.get(key)
    if found is None:
        found = liq_sweeps.events(symbol, span["bars"], rule["tf"], liq["swingBars"], liq["variant"], liq["reclaimBars"], ctx["atr"],
                                  what=liq["what"])
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    wanted = "SWP" if control else "LIQ"
    out = [{**e, "code": "LIQ"} if e["code"] == wanted else e for e in found if e["code"] in (wanted, "VH")]
    return out + _vp_events(symbol, rule, span, vp_shift)


def _vp_levels(symbol, hours, rows, share, start_ms, end_ms):
    """Niveles de las sesiones del tramo, guardados en disco: una sesión cerrada no cambia."""
    path = tester_dir() / "cache" / f"vp3_{symbol}_{hours}h_{rows}_{int(share)}_{_iso(start_ms)}_{_iso(end_ms - 1)}.json"
    if path.exists():
        with open(path, encoding="utf-8") as fh:
            return {int(k): v for k, v in json.load(fh).items()}
    levels = vp_sessions.sessions(symbol, hours, start_ms - hours * vp_sessions.HOUR, end_ms, rows, share / 100)
    if levels:
        path.parent.mkdir(parents=True, exist_ok=True)
        partial = path.with_suffix(".tmp")
        with open(partial, "w", encoding="utf-8") as fh:
            json.dump(levels, fh)
        partial.replace(path)
    return levels


def _vp_events(symbol, rule, span, shift=None):
    """VR, VF, VX y VE contra el valor de la sesión anterior. shift: semilla del control con los perfiles desplazados."""
    vp = rule.get("vp")
    bars = span["bars"]
    if not vp or not bars:
        return []
    key = (_bars_key(bars), symbol, rule["tf"], "vp", vp["hours"], vp["accept"], vp["failBars"], vp["rows"], vp["share"], vp.get("veEntry"), shift)
    with _lock:
        found = _extra.get(key)
    if found is None:
        tf_ms = rule["tf"] * 60000
        levels = _vp_levels(symbol, vp["hours"], vp["rows"], vp["share"], bars[0]["t"], bars[-1]["t"] + tf_ms)
        if shift is not None:
            levels = vp_sessions.shifted(levels, shift)
        accept = max(1, round(vp["accept"] / rule["tf"]))
        found = vp_sessions.events(bars, rule["tf"], levels, vp["hours"], accept, vp["failBars"], vp.get("veEntry") or "touch")
        with _lock:
            _extra[key] = found
            while len(_extra) > 6:
                _extra.pop(next(iter(_extra)))
    shapes = vp.get("shapes")
    return [e for e in found if e["info"].get("shape") in shapes] if shapes else found


def run(symbol, rule, span, phase, table=None, base=True, control=False, vp_shift=None, trace=None):
    """La regla sobre las velas y elementos de la fase. Devuelve resumen, cortes y cada trade.
    trace (un dict): guarda ahí el contexto de las velas, los elementos y qué pasó con cada señal (trade_context)."""
    bars, events, tf = span["bars"], span["events"], rule["tf"]
    tf_ms = tf * 60000
    if len(bars) < 100:
        return {"success": False, "message": "Sin velas suficientes en el almacén para esa fase"}
    ctx = _context(symbol, tf, bars)
    ctx["bars"] = bars
    if rule.get("gc"):
        gc = rule["gc"]
        # Con la regla invertida el trade va contra el canal: su salida por el canal también es la contraria
        warm = span.get("warm") or []
        leave = gaussian_channel.exits(warm + bars, gc["period"], gc["poles"], gc["mult"], gc["exit"])
        if leave and warm:
            leave = {side: {i - len(warm) for i in found if i >= len(warm)} for side, found in leave.items()}
        ctx["exitAt"] = {1: leave[-1], -1: leave[1]} if leave and rule["invert"] else leave
    if rule["exit"].get("vpa"):
        ctx["vpaExit"] = _vpa_exit_bars(rule, ctx)
    if rule.get("regime"):
        ctx["regimeOK"] = regime_mask(rule["regime"], bars, is_stock(symbol))
    if rule.get("smcf") or rule.get("targetAt") == "weak":
        _smc_range(rule, ctx)
    extra = _extra_events(symbol, rule, span, ctx, control, vp_shift)
    events = events + extra if extra else events
    note = None
    if trace is not None:
        trace.update(ctx=ctx, events=events, signals=[])
        note = trace["signals"].append
    liq_info = {(e["dir"], e["known"]): e["info"] for e in extra if e["code"] == "LIQ"}
    vp_info = {(e["code"], e["dir"], e["known"]): e["info"] for e in extra if e["code"] in VP_CODES}
    cc_info = {(e["dir"], e["known"]): e["info"] for e in extra if e["code"] == "CC"}
    pat_info = {(e["code"], e["dir"], e["known"]): e["info"] for e in extra if e["code"] in PATTERN_CODES}
    rv_info = {(e["code"], e["dir"], e["known"]): {**e["info"], "code": e["code"]} for e in extra if e["code"] in RV_CODES}
    gc_info = {(e["dir"], e["known"]): e["info"] for e in extra if e["code"] == "GC"}
    box_info = {(e["code"], e["dir"], e["known"]): e["info"] for e in extra if e["code"] in box_elements.CODES}
    fs_info = {(e["code"], e["dir"], e["known"]): {**e["info"], "code": e["code"]} for e in extra if e["code"] in fvg_swing.CODES}
    wise_info = {(e["code"], e["dir"], e["known"]): {**e["info"], "code": e["code"]} for e in extra if e["code"] in williams.CODES}
    smc_info = {(e["code"], e["dir"], e["known"]): {**e["info"], "code": e["code"]} for e in extra if e["code"] in smc.CODES}
    vpa_info = {(e["code"], e["dir"], e["known"]): {**e["info"], "code": e["code"]} for e in extra if e["code"] in vpa.CODES}
    byko_info = {(e["code"], e["dir"], e["known"]): {**e["info"], "code": e["code"]} for e in extra if e["code"] in byko.CODES}
    index = {t: i for i, t in enumerate(ctx["T"])}
    votes = os_._votes(bars, events, tf_ms)
    zones = {}
    for e in events:
        zones.setdefault((e["code"], e["dir"], e["known"]), []).append((e["lo"], e["hi"], e["t"]))
    matches = os_.match_recipes(bars, events, [rule["recipe"]], tf)
    matches.sort(key=lambda m: m["known"])
    flip = -1 if rule["invert"] else 1
    known_at = {1: set(), -1: set()}
    for m in matches:
        k = index.get(m["known"] - tf_ms)
        if k is not None:
            known_at[m["dir"] * flip].add(k)

    trades, skipped, open_count, busy_until, busy = [], {}, 0, -1, 0

    def skip(reason, k, side):
        skipped[reason] = skipped.get(reason, 0) + 1
        if note is not None:
            note({"k": k, "dir": side, "what": reason})

    window = rule["recipe"]["window"]
    # Con órdenes limit, una señal posterior puede llenarse antes que una anterior (o las dos órdenes de un rango,
    # la de arriba y la de abajo): se simulan todas y se toman por orden de llenado, no de señal
    straddle = rule["entry"]["type"] == "straddle"
    defer = rule["oneAtATime"] and rule["entry"]["type"] in ("limit", "straddle", "stop")
    pending, placed = [], set()
    for m in matches:
        k = index.get(m["known"] - tf_ms)
        if k is None:
            continue
        side = m["dir"] * flip
        if straddle:
            if k in placed:
                continue  # Las dos órdenes de esa vela ya están puestas
            placed.add(k)
        if rule["oneAtATime"] and not defer and k < busy_until:
            busy += 1
            if note is not None:
                note({"k": k, "dir": side, "what": "posición abierta"})
            continue
        if rule["oneAtATime"] and not defer and k < busy_until + rule["cooldown"]:
            skip("enfriamiento", k, side)
            continue
        # Con dos órdenes, cada filtro que mira el lado decide si se pone la orden de ese lado
        sides = (1, -1) if straddle else (side,)
        if rule.get("lines"):
            sides = tuple(sd for sd in sides if _lines_ok(rule["lines"], ctx, k, sd))
            if not sides:
                skip("filtro de VWAP o EMA", k, side)
                continue
        if rule.get("flow"):
            sides = tuple(sd for sd in sides if _flow_ok(rule["flow"], ctx, k, sd))
            if not sides:
                skip("filtro de CVD u OI", k, side)
                continue
        if rule.get("regime") and not ctx["regimeOK"][k]:
            skip("filtro de régimen", k, side)
            continue
        if rule.get("bwf"):
            sides = tuple(sd for sd in sides if williams.filter_ok(rule["bwf"], _bw_series(ctx), k, sd))
            if not sides:
                skip("filtro de Williams", k, side)
                continue
        if rule.get("smcf"):
            sides = tuple(sd for sd in sides if smc.filter_ok(rule["smcf"], _smc_range(rule, ctx), ctx["C"], k, sd))
            if not sides:
                skip("filtro SMC", k, side)
                continue
        if rule.get("vpaf"):
            sides = tuple(sd for sd in sides if vpa.filter_ok(rule["vpaf"], _vpa_series(rule, ctx), k, sd))
            if not sides:
                skip("filtro VPA", k, side)
                continue
        if rule.get("hours") and not _in_hours(rule["hours"], m["known"]):
            skip("fuera de horario", k, side)
            continue
        if rule["vaGap"] > 0 and not _va_gap_ok(rule["vaGap"], m, zones, index, ctx, tf_ms):
            skip("VA con hueco pequeño", k, side)
            continue
        measured = None
        if table is not None:
            row = measures.row_at(table, m["known"])
            if row is not None and rule["filters"]:
                sides = tuple(sd for sd in sides if _passes(rule["filters"], measures.read_row(table, row, sd)))
            measured = measures.read_row(table, row, sides[0] if sides else side) if row is not None else None
        if rule["filters"] and (not sides or (table is None and not _passes(rule["filters"], None))):
            skip("filtro de contexto", k, side)
            continue
        found = [z for code, t in m["votes"] for z in zones.get((code, m["dir"], t + tf_ms), [])]
        zone = (min(z[0] for z in found), max(z[1] for z in found)) if found else None
        ctx["i0"] = index.get(min([e_t for _, e_t in m["votes"]] + [m["t0"]]), k)
        ctx["vp"] = next((vp_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in vp_info), None)
        boxed = next((box_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in box_info), None)
        if ctx["vp"] is None and boxed is not None:
            # El objetivo "centro" de un borde de caja: el centro de la caja
            ctx["vp"] = {"high": boxed["high"], "low": boxed["low"], "poc": (boxed["high"] + boxed["low"]) / 2, "vah": boxed["high"], "val": boxed["low"]}
        # La espera propia de la orden stop del 3.er sabio (hasta que el precio pasa su fractal)
        ctx["entryInfo"] = next((wise_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in wise_info), None)
        steps = [] if trace is not None else None
        trade = simulate(rule, ctx, k, side, zone, known_at if straddle else known_at[-side], sides=sides, path=steps)
        if steps is not None and trade is not None and "skip" not in trade:
            trade["_path"] = steps
        if trade is None:
            if note is not None:
                note({"k": k, "dir": side, "what": "sin vela siguiente"})
            continue
        if "skip" in trade:
            skip(trade["skip"], k, side)
            continue
        if note is not None:
            note({"k": k, "dir": trade["dir"], "trade": trade})  # Qué fue de él se sabe al final: trade, ocupado o abierto
        if trade.get("open"):
            if defer:
                pending.append(trade)
            else:
                open_count += 1
                busy_until = len(bars)
                trade["_fate"] = "abierta al final de la fase"
            continue
        lo = max(0, k - window + 1)
        trade["votes"] = sorted({code for code, _ in m["votes"]})
        trade["present"] = sorted({c for j in range(lo, k + 1) for c in votes[m["dir"]][j]})
        trade["against"] = sorted({c for j in range(lo, k + 1) for c in votes[-m["dir"]][j]})
        trade["zone"] = [round(zone[0], 8), round(zone[1], 8)] if zone else None
        # Dónde estaba cada elemento de la regla, para dibujarlo con el trade
        trade["marks"] = [{"code": code, "t": z[2], "lo": round(z[0], 8), "hi": round(z[1], 8)}
                          for code, t in m["votes"] for z in zones.get((code, m["dir"], t + tf_ms), [])]
        swept = next((liq_info[(m["dir"], t + tf_ms)] for code, t in m["votes"]
                      if code == "LIQ" and (m["dir"], t + tf_ms) in liq_info), None)
        if swept is not None:
            trade["liq"] = swept  # La zona barrida: dinero, antigüedad y hasta dónde pasó el precio
        found_more = [info[(code, m["dir"], t + tf_ms)] for info in (wise_info, smc_info, vpa_info) for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in info]
        if found_more:
            trade["elements"] = found_more  # Lo de los sabios, la estructura SMC o el lector VPA que dio la señal
        found_fs = [fs_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in fs_info]
        if found_fs:
            trade["fs"] = found_fs  # El hueco del FVG o el swing que dispararon
        if rule.get("flow"):
            flow_cache = ctx.get("flow", {})
            trade["flow"] = {}
            if ("cvd", rule["flow"].get("cvd")) in flow_cache:
                trade["flow"]["cvd"] = round(float(flow_cache[("cvd", rule["flow"]["cvd"])][k]), 4)
            if flow_cache.get("oi") and flow_cache["oi"][0] is not None:
                trade["flow"]["oi"] = float(flow_cache["oi"][0][k])
            if "funding" in flow_cache and flow_cache["funding"][k] == flow_cache["funding"][k]:
                trade["flow"]["funding"] = round(float(flow_cache["funding"][k]), 6)
                trade["flow"]["crowd"] = flow_filters.crowd(float(flow_cache["funding"][k]), side)
            steady = flow_cache.get(("steady", rule["flow"].get("steadyDays")))
            if steady is not None and steady[k] == steady[k]:
                trade["flow"]["steady"] = round(float(steady[k]), 3)
            chain = rule["flow"].get("chain")
            found = chain and flow_cache.get(("chain", chain["metric"], chain.get("asset"), chain["days"]))
            if found and found[1][k] == found[1][k]:
                trade["flow"]["chain"] = round(float(found[0][k]), 4)   # La medida en %, a favor de un largo
                trade["flow"]["chainZ"] = round(float(found[1][k]), 3)
        if boxed is not None:
            trade["box"] = boxed  # La caja de la ruptura o del borde, para dibujarla con el trade
        elif ctx["vp"] is not None:
            trade["vp"] = ctx["vp"]  # El valor de la sesión anterior que usó la regla, y dónde abrió la sesión
        read = next((byko_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in byko_info), None)
        if read is not None:
            # Lo que midió la firma de Byko (llegada, volumen, OI) y si la cumplía; su caja se dibuja con el trade
            trade["byko"] = {k: v for k, v in read.items() if k != "box"}
            if read.get("box") and "box" not in trade:
                trade["box"] = read["box"]
        broken = next((cc_info[(m["dir"], t + tf_ms)] for code, t in m["votes"] if code == "CC" and (m["dir"], t + tf_ms) in cc_info), None)
        if broken is not None:
            trade["cc"] = broken  # El swing roto y el extremo de la tendencia
        shape = next((pat_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in pat_info), None)
        if shape is not None:
            trade["pat"] = shape  # Qué patrón fue y el z-score del volumen de su vela
        seen = next((rv_info[(code, m["dir"], t + tf_ms)] for code, t in m["votes"] if (code, m["dir"], t + tf_ms) in rv_info), None)
        if seen is not None:
            trade["rv"] = seen  # Flecha: veces el volumen de su hora y lado del tramo. Rombo: tramo y su extremo
        band = next((gc_info[(m["dir"], t + tf_ms)] for code, t in m["votes"] if code == "GC" and (m["dir"], t + tf_ms) in gc_info), None)
        if band is not None:
            trade["gc"] = band  # Línea central y bandas del canal en la vela de la señal
        if rule.get("lines"):
            trade["lines"] = [{"type": item["type"], "period": item["period"], "value": round(float(_line(ctx, item["type"], item["period"])[k]), 8),
                               # El tope de la apertura: el VWAP más `maxDev` desviaciones, del lado del trade
                               **({"limit": round(float(_line(ctx, "vwap", item["period"])[k] + side * item["maxDev"] * _vwap_dev(ctx, item["period"])[k]), 8),
                                   "maxDev": item["maxDev"]} if item.get("maxDev") else {})}
                              for item in rule["lines"]]
        trade["measures"] = measured
        if defer:
            pending.append(trade)
            continue
        trades.append(trade)
        if rule["oneAtATime"]:
            busy_until = trade.pop("exit_i") + 1
        else:
            trade.pop("exit_i")
    for trade in sorted(pending, key=lambda t: (t["entry_i"], t["k"])):
        if trade["entry_i"] < busy_until:
            busy += 1
            trade["_fate"] = "posición abierta"
        elif trade["entry_i"] < busy_until + rule["cooldown"]:
            skipped["enfriamiento"] = skipped.get("enfriamiento", 0) + 1
            trade["_fate"] = "enfriamiento"
        elif trade.get("open"):
            open_count += 1
            busy_until = len(bars)
            trade["_fate"] = "abierta al final de la fase"
        else:
            trades.append(trade)
            busy_until = trade.pop("exit_i") + 1
    for number, trade in enumerate(trades, 1):
        trade["n"] = number
        trade.pop("k", None)
        trade.pop("entry_i", None)
    if trace is not None:
        # El stop de cada vela de cada trade que quedó, por su número (los demás se descartan con su trade)
        trace["paths"] = {trade["n"]: trade.pop("_path") for trade in trades if "_path" in trade}
        # Cada señal con lo que pasó: el número de su trade o por qué no entró. Los que no quedaron no salen en la corrida
        for item in trace["signals"]:
            trade = item.pop("trade", None)
            if trade is not None:
                fate = trade.pop("_fate", None)
                if fate is None and "n" in trade:
                    item.update(what="trade", n=trade["n"])
                else:
                    item["what"] = fate or "posición abierta"

    ordered = sorted(trades, key=lambda t: t["exit_t"])
    result = {
        "success": True, "symbol": symbol, "rule": rule, "phase": phase["phase"], "from": phase["from"], "to": phase["to"],
        "bars": len(bars), "signals": len(matches), "skipped": skipped, "busy": busy, "open": open_count,
        "summary": summary(ordered), "breakdowns": _breakdowns(trades, rule),
        "equity": _equity(ordered), "measuresAvailable": table is not None, "trades": trades,
    }
    if base:
        result["baseline"] = _baseline(rule, ctx, trades, symbol)
        s, b = result["summary"], result["baseline"]
        if s.get("n") and b.get("n"):
            edge = s["avgR"] - b["avgR"]
            se = math.sqrt(s["seR"] ** 2 + b["seR"] ** 2)
            result["edge"] = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
                              "clear": abs(edge) > 1.96 * se and not s["smallSample"]}
        if not control and vp_shift is None:
            # Seguir el tramo en velas al azar: lo que el mercado ya daba por ir a favor del movimiento
            result["legBaseline"] = _leg_baseline(rule, ctx, trades, symbol)
            result["legEdge"] = _edge(s, result["legBaseline"])
        if ("liq" in rule or _byko_codes(rule)) and not control:
            # LIQ: el mismo gatillo tras barrer un swing sin liquidaciones. Byko: los mismos candidatos sin su firma
            # (llegada, volumen u OI). Dice si esa pieza aporta algo
            other = run(symbol, rule, span, phase, table, base=False, control=True)
            c = other.get("summary") or {}
            result["control"] = {key: c.get(key) for key in ("n", "winRate", "avgR", "seR", "profitFactor", "smallSample")}
            result["controlKind"] = "liq" if "liq" in rule else "byko"
            if s.get("n") and c.get("n"):
                edge = s["avgR"] - c["avgR"]
                se = math.sqrt(s["seR"] ** 2 + c["seR"] ** 2)
                result["control"]["edge"] = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
                                             "clear": abs(edge) > 1.96 * se and not s["smallSample"] and not c["smallSample"]}
            if "liq" in rule:
                first = liq_sweeps.first_day(symbol)
                result["liqFrom"] = _iso(first) if first else None
    if base and rule.get("vp") and not control and vp_shift is None:
        # La misma regla con los perfiles desplazados al azar: dice si importa dónde estuvo el volumen
        pooled = []
        for seed in range(1, VP_CONTROL_RUNS + 1):
            pooled += run(symbol, rule, span, phase, table, base=False, vp_shift=seed).get("trades") or []
        s, c = result["summary"], summary(sorted(pooled, key=lambda t: t["exit_t"]))
        result["vpControl"] = {"runs": VP_CONTROL_RUNS, **{key: c.get(key) for key in ("n", "winRate", "avgR", "seR", "profitFactor", "smallSample")}}
        if s.get("n") and c.get("n"):
            edge = s["avgR"] - c["avgR"]
            se = math.sqrt(s["seR"] ** 2 + c["seR"] ** 2)
            result["vpControl"]["edge"] = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
                                           "clear": abs(edge) > 1.96 * se and not s["smallSample"] and not c["smallSample"]}
    result["winnersVsLosers"] = _winners_vs_losers(trades)
    return result


def _equity(ordered):
    total, points = 0.0, []
    for t in ordered:
        total += t["r"]
        points.append([t["exit_t"], round(total, 3)])
    return points


def _baseline(rule, ctx, trades, symbol):
    """Entradas al azar con el mismo stop y la misma salida, y la misma proporción de largos y cortos."""
    if not trades:
        return {"n": 0}
    n = len(ctx["T"])
    longs = sum(1 for t in trades if t["dir"] > 0) / len(trades)
    rng = random.Random(int(hashlib.sha1(f"{symbol}{rule['tf']}{n}".encode()).hexdigest()[:8], 16))
    base_rule = _random_rule(rule, trades)
    # El azar se simula igual que la regla: con el minuto a minuto de la moneda si lo tiene (sin él, con el recorrido
    # supuesto de la vela, para los dos). Hasta el 20/11 iba sin minutos aunque la regla los usara: con dos órdenes stop o
    # una limit, cada vela dudosa del llenado era una pérdida del azar y no de la regla, y la ventaja salía inflada
    light = {**ctx, "i0": None}
    done = []
    allowed = _allowed(ctx, n)
    if allowed is not None and not len(allowed):
        return {"n": 0}
    sided = "bars" in ctx and _sided(rule)
    for _ in range(BASE_TRADES * (6 if sided else 1)):
        if sided and len(done) >= BASE_TRADES:
            break
        k = int(allowed[rng.randrange(len(allowed))]) if allowed is not None else rng.randrange(30, n - 2)
        side = 1 if rng.random() < longs else -1
        if sided and not _side_ok(rule, ctx, k, side):
            continue  # Con filtro de CVD, OI, Williams o SMC, el azar entra solo donde el filtro deja entrar a ese lado
        light["i0"] = k
        trade = simulate(base_rule, light, k, side)
        if trade and "skip" not in trade and not trade.get("open"):
            done.append(trade)
    stats = summary(done)
    out = {key: stats.get(key) for key in ("n", "winRate", "avgR", "seR", "profitFactor", "reach", "medianReach")}
    out["quarters"] = _by_quarter(done)
    return out


def quarter_of(ms):
    """Trimestre UTC de una hora en ms: "2025T3"."""
    d = dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc)
    return f"{d.year}T{(d.month - 1) // 3 + 1}"


def _by_quarter(trades):
    """{trimestre: {"1": [n, suma de R], "-1": [n, suma de R]}} de unos trades (por la hora de entrada)."""
    out = {}
    for t in trades:
        cell = out.setdefault(quarter_of(t["entry_t"]), {}).setdefault(str(t["dir"]), [0, 0.0])
        cell[0] += 1
        cell[1] += t["r"]
    return {q: {side: [n, round(total, 4)] for side, (n, total) in sides.items()} for q, sides in out.items()}


QUARTER_MIN_RANDOM = 10   # Con menos entradas al azar en un trimestre y lado se usa el azar de toda la corrida
QUARTER_MIN_TRADES = 20   # Un trimestre con menos trades de la regla no cuenta para la constancia


def quarter_rows(result):
    """Por trimestre: trades de la regla, suma de R y suma de la ventaja (cada trade contra el azar de su trimestre y lado).
    {trimestre: [n, suma de R, suma de ventaja]}. Sin azar por trimestre, contra el azar de la corrida."""
    base = result.get("baseline") or {}
    quarters, fallback = base.get("quarters") or {}, base.get("avgR") or 0.0
    out = {}
    for t in result.get("trades") or []:
        q = quarter_of(t["entry_t"])
        n, total = (quarters.get(q) or {}).get(str(t["dir"]), [0, 0.0])
        ctrl = total / n if n >= QUARTER_MIN_RANDOM else fallback
        cell = out.setdefault(q, [0, 0.0, 0.0])
        cell[0] += 1
        cell[1] += t["r"]
        cell[2] += t["r"] - ctrl
    return out


def consistency(quarters):
    """Constancia de unos trimestres {q: [n, suma de R, suma de ventaja]}: cuántos quedan sobre el azar, la mediana de la
    ventaja por trade de cada trimestre y qué parte de la ventaja total ponen los 4 mejores (None si el total no es positivo)."""
    rows = [{"quarter": q, "n": n, "avgR": round(r / n, 3), "edge": round(e / n, 3), "edgeR": round(e, 2)}
            for q, (n, r, e) in sorted(quarters.items()) if n >= QUARTER_MIN_TRADES]
    if not rows:
        return {"total": 0, "rows": []}
    total = sum(r["edgeR"] for r in rows)
    top4 = sum(sorted((r["edgeR"] for r in rows), reverse=True)[:4])
    return {"rows": rows, "total": len(rows), "positive": sum(1 for r in rows if r["edgeR"] > 0),
            "median": round(float(np.median([r["edge"] for r in rows])), 3),
            "top4Share": round(top4 / total, 3) if total > 0 else None}


def _leg_baseline(rule, ctx, trades, symbol):
    """Entradas en velas al azar, siempre a favor del tramo en curso (el zigzag del Volumen de Respuesta), con el mismo
    stop y la misma salida. Dice cuánto de lo que gana una regla que sigue el movimiento lo pone el mercado."""
    if not trades:
        return {"n": 0}
    n = len(ctx["T"])
    high, low, close = (np.array(ctx[key], dtype=float) for key in ("H", "L", "C"))
    leg = float((rule.get("rv") or {}).get("leg", measures.LEG_ATR))
    direction, _, _ = measures.zigzag(high, low, close, measures.atr(high, low, close), leg)
    rng = random.Random(int(hashlib.sha1(f"{symbol}{rule['tf']}{n}tramo".encode()).hexdigest()[:8], 16))
    base_rule = _random_rule(rule, trades)
    light = {**ctx, "i0": None}  # Con el minuto a minuto, como la regla (ver _baseline)
    done = []
    allowed = _allowed(ctx, n)
    if allowed is not None and not len(allowed):
        return {"n": 0}
    sided = "bars" in ctx and _sided(rule)
    for _ in range(BASE_TRADES * (6 if sided else 1)):
        if sided and len(done) >= BASE_TRADES:
            break
        k = int(allowed[rng.randrange(len(allowed))]) if allowed is not None else rng.randrange(30, n - 2)
        if sided and not _side_ok(rule, ctx, k, int(direction[k])):
            continue
        light["i0"] = k
        trade = simulate(base_rule, light, k, int(direction[k]), sides=(int(direction[k]),))
        if trade and "skip" not in trade and not trade.get("open"):
            done.append(trade)
    stats = summary(done)
    return {"leg": leg, **{key: stats.get(key) for key in ("n", "winRate", "avgR", "seR", "profitFactor", "reach", "medianReach")}}


OI_MODES = ("rise", "fall", "conf", "noconf")  # Filtro de OI: sube, baja, confluencia OI-volumen a favor, sin ella en contra
REGIME_MODES = ("inside", "outside", "breakout")
_regime_cache = {}


def _regime_ok(a, reg):
    """Velas permitidas por el régimen, en las velas de `a` (las del marco en que se mide)."""
    import regime_detectors as rd
    params = rd.PARAMS["er_box"]["params"]
    boxes = rd.er_box(a, **params)
    zones = rd.major(a, [{"i": z["detected"], "low": z["low"], "high": z["high"]} for z in boxes["zones"]], 8.0, 0.5, reg["majorOut"]) if reg["major"] else boxes
    state = zones["state"]
    if reg["mode"] == "inside":
        ok = state.copy()
    elif reg["mode"] == "outside":
        ok = ~state
    else:
        ok = np.zeros(len(state), dtype=bool)
        for z in zones["zones"]:
            ok[z["end"] + 1:z["end"] + 1 + reg["after"]] = True  # La vela que rompe y las que siguen
        ok &= ~state
    ok[:params["n"]] = False  # Antes de tener las velas del detector no se sabe el régimen
    return ok


def _daily(a, step):
    """Las velas unidas por día UTC; solo los días completos."""
    day = a["t"] // DAY_MS
    per = DAY_MS // step
    out = {k: [] for k in ("t", "o", "h", "l", "c", "v")}
    starts = np.flatnonzero(np.diff(day, prepend=day[0] - 1))
    for k, s0 in enumerate(starts):
        s1 = starts[k + 1] if k + 1 < len(starts) else len(day)
        if s1 - s0 != per:
            continue
        out["t"].append(int(day[s0] * DAY_MS)); out["o"].append(a["o"][s0]); out["c"].append(a["c"][s1 - 1])
        out["h"].append(a["h"][s0:s1].max()); out["l"].append(a["l"][s0:s1].min()); out["v"].append(a["v"][s0:s1].sum())
    return {k: np.array(v, dtype=np.int64 if k == "t" else float) for k, v in out.items()}


def _sessions(a):
    """Las velas de una acción unidas por día de sesión: todos los días, porque cada uno es una sesión entera (la sesión
    regular de Nueva York cae siempre dentro de un mismo día UTC). Da también el día de cada vela."""
    day = a["t"] // DAY_MS
    starts = np.flatnonzero(np.diff(day, prepend=day[0] - 1))
    ends = np.append(starts[1:], len(day))
    d = {"t": (day[starts] * DAY_MS).astype(np.int64), "o": a["o"][starts], "c": a["c"][ends - 1],
         "h": np.maximum.reduceat(a["h"], starts), "l": np.minimum.reduceat(a["l"], starts), "v": np.add.reduceat(a["v"], starts)}
    return d, np.searchsorted(starts, np.arange(len(day)), side="right") - 1


def regime_mask(reg, bars, session=False):
    """
    Velas en que la regla puede operar según el régimen, conocido al cierre de cada vela (sin futuro). Con
    `reg["tf"]` = 1440 el régimen se mide en velas diarias (las de la regla unidas por día UTC), y cada vela de la
    regla usa el del último día ya cerrado; `after` cuenta entonces en días.
    Con `session` (acciones: solo la sesión regular) un día no tiene 24 horas de velas: cuenta cada día de sesión, y
    cada vela usa el día de sesión anterior al suyo. Así un día solo se usa cuando ya terminó, también el último.
    """
    key = (_bars_key(bars), json.dumps(reg, sort_keys=True), session)
    with _lock:
        found = _regime_cache.get(key)
    if found is not None:
        return found
    a = {"t": np.array([b["t"] for b in bars], dtype=np.int64), **{k: np.array([b[src] for b in bars], dtype=float)
         for k, src in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))}}
    step = int(np.median(np.diff(a["t"]))) if len(a["t"]) > 1 else DAY_MS
    if reg.get("tf") == DAILY and step < DAY_MS and session:
        d, which = _sessions(a)
        coarse = _regime_ok(d, reg) if len(d["t"]) > 30 else np.zeros(len(d["t"]), dtype=bool)
        ok = np.zeros(len(a["t"]), dtype=bool)
        seen = which >= 1
        ok[seen] = coarse[which[seen] - 1]
    elif reg.get("tf") == DAILY and step < DAY_MS:
        d = _daily(a, step)
        coarse = _regime_ok(d, reg) if len(d["t"]) > 30 else np.zeros(len(d["t"]), dtype=bool)
        # La vela de la regla que cierra en el instante c ve el último día que cerró en c o antes
        k = np.searchsorted(d["t"] + DAY_MS, a["t"] + step, side="right") - 1
        ok = np.zeros(len(a["t"]), dtype=bool)
        seen = k >= 0
        ok[seen] = coarse[k[seen]]
    else:
        ok = _regime_ok(a, reg)
    with _lock:
        _regime_cache[key] = ok
        while len(_regime_cache) > 40:
            _regime_cache.pop(next(iter(_regime_cache)))
    return ok


def _allowed(ctx, n):
    """Con filtro de régimen, las velas en que pueden entrar los controles al azar: las mismas que la regla."""
    ok = ctx.get("regimeOK")
    if ok is None:
        return None
    return np.flatnonzero(ok[30:n - 2]) + 30


def _edge(s, b):
    """Diferencia de R medio entre la regla y un control, con su margen. None si alguno no tiene trades."""
    if not s.get("n") or not b.get("n"):
        return None
    edge = s["avgR"] - b["avgR"]
    se = math.sqrt(s["seR"] ** 2 + b["seR"] ** 2)
    return {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
            "clear": abs(edge) > 1.96 * se and not s.get("smallSample")}


def with_leg_baseline(result):
    """Una corrida guardada antes de existir el control del tramo lo recibe la primera vez que se pide. No recalcula la
    regla: solo suma el control, con las velas ya guardadas de la fase."""
    if result is None or "legBaseline" in result or not result.get("trades"):
        return result
    symbol, rule = result["symbol"], result["rule"]
    phase = next((p for p in phases(symbol) if p["phase"] == result["phase"]), None)
    if phase is None or (not _on_candles(symbol, rule["tf"]) and not _span_path(symbol, rule["tf"], phase, rule).exists()):
        return result  # Sin los elementos de la fase en disco habría que detectarlos de nuevo: no se hace solo por esto
    try:
        span = detect_span(symbol, rule["tf"], phase, rule)
        result["legBaseline"] = _leg_baseline(rule, _control_context(symbol, rule, span), result["trades"], symbol)
        result["legEdge"] = _edge(result["summary"], result["legBaseline"])
        _resave(result)
    except Exception:  # Sin el control la corrida se muestra igual
        result.pop("legBaseline", None)
        result.pop("legEdge", None)
    return result


def _control_context(symbol, rule, span):
    """El contexto de los controles como en run(): con las velas (filtros de flujo) y el régimen."""
    ctx = _context(symbol, rule["tf"], span["bars"])
    ctx["bars"] = span["bars"]
    if rule["exit"].get("vpa"):
        ctx["vpaExit"] = _vpa_exit_bars(rule, ctx)
    if rule.get("regime"):
        ctx["regimeOK"] = regime_mask(rule["regime"], span["bars"], is_stock(symbol))
    return ctx


def _resave(result):
    with _write_lock:
        path = _run_path(result["id"])
        partial = path.with_suffix(".tmp")
        with gzip.open(partial, "wt", encoding="utf-8") as fh:
            json.dump(result, fh, allow_nan=False, separators=(",", ":"))
        partial.replace(path)


def with_quarter_baseline(result):
    """Una corrida guardada antes de existir el azar por trimestre lo recibe la primera vez que se pide (para la
    constancia). No recalcula la regla ni cambia su azar de la fase: solo suma el reparto por trimestre."""
    base = (result or {}).get("baseline")
    if result is None or not result.get("trades") or not base or "quarters" in base:
        return result
    symbol, rule = result["symbol"], result["rule"]
    phase = next((p for p in phases(symbol) if p["phase"] == result["phase"]), None)
    if phase is None or (not _on_candles(symbol, rule["tf"]) and not _span_path(symbol, rule["tf"], phase, rule).exists()):
        return result
    try:
        span = detect_span(symbol, rule["tf"], phase, rule)
        if rule.get("gc"):
            return result  # La salida por el canal se arma dentro de run(): esas corridas quedan con el azar de la fase
        again = _baseline(rule, _control_context(symbol, rule, span), result["trades"], symbol)
        if again.get("quarters") is not None:
            base["quarters"] = again["quarters"]
            _resave(result)
    except Exception:  # Sin el reparto la constancia usa el azar de la fase
        pass
    return result


def _random_rule(rule, trades):
    """La regla que usan las entradas al azar: a mercado, y sin lo que depende del elemento."""
    stop = rule["stop"]
    if stop["type"] in ("zone", "candle"):
        # Ese stop depende del elemento, que al azar no existe: se usa la distancia mediana de los trades de la regla
        stop = {**stop, "type": "atr", "atr": max(0.1, float(np.median([t["stop_atr"] for t in trades])))}
    entry = {**rule["entry"], "type": "market"}
    if rule["entry"]["type"] == "stop":
        # La orden stop en velas al azar, del lado del trade, a la distancia mediana del cierre que tuvieron las de la regla
        dist = [t["trigger_atr"] for t in trades if t.get("trigger_atr") is not None]
        entry = {"type": "stop", "from": "close", "offset": float(np.median(dist)) if dist else rule["entry"]["offset"],
                 "expiry": rule["entry"]["expiry"], "cancel": False}
    if rule["entry"]["type"] == "straddle":
        # Las dos órdenes en velas al azar, a la distancia mediana del cierre que tuvieron las de la regla
        dist = [t["trigger_atr"] for t in trades if t.get("trigger_atr") is not None]
        entry = {"type": "straddle", "from": "close", "offset": float(np.median(dist)) if dist else rule["entry"]["offset"],
                 "expiry": rule["entry"]["expiry"]}
    base_rule = {**rule, "entry": entry, "stop": stop}
    if rule.get("targetAt"):
        # Al azar no hay perfil ni rango: el objetivo es el múltiplo del riesgo mediano que tuvieron los trades de la regla
        reward = [abs(t["target"] - t["entry"]) / t["risk"] for t in trades if t.get("target") is not None and t["risk"] > 0]
        base_rule = {k: v for k, v in base_rule.items() if k != "targetAt"}
        base_rule["exit"] = {**rule["exit"], "targetR": max(0.2, float(np.median(reward))) if reward else 1.0}
    return base_rule


def _winners_vs_losers(trades):
    winners = [t["measures"] for t in trades if t["r"] > 0 and t.get("measures")]
    losers = [t["measures"] for t in trades if t["r"] <= 0 and t.get("measures")]
    if len(winners) < patterns.MIN_GROUP or len(losers) < patterns.MIN_GROUP:
        return None
    labels = patterns._labels()
    keys = [item[0] for item in measures.MEASURES if item[0] not in patterns.UNCOMPARED]
    result = patterns.compare_groups(winners, losers, keys, labels)
    result["rows"] = result["rows"][:25]
    return result


# ==================== REGISTRO Y TRABAJOS ====================

def _runs_path():
    return tester_dir() / "runs.jsonl"


# Versión del motor, anotada en cada corrida. 2 (20/11/2026): el régimen medido en 1D en las acciones, que antes
# descartaba todas las señales (sus días no tienen 24 horas de velas). Las corridas que ese fallo tocó no se reusan,
# no se cuentan y no se listan (_stale); siguen en el disco. 3 (20/11/2026): las entradas al azar se simulan con el
# minuto a minuto de la moneda, como la regla (antes iban sin él y, con dos órdenes stop o una limit, la ventaja de las
# monedas con almacén salía inflada), y una vela dudosa sin minutos se resuelve con su recorrido supuesto en vez de
# contar siempre el stop (_minute_path). Las corridas anteriores conservan lo suyo: el número dice cómo se hicieron
ENGINE = 4


def _stale(record):
    """Corrida que salió mal por un fallo ya corregido: una acción con el régimen medido en 1D, antes de la versión 2, o
    una regla con la ruptura de fractal sin la orden stop, antes de la 4 (entraba sabiendo que el precio lo rompería)."""
    rule = record.get("rule") or {}
    reg = rule.get("regime") or {}
    if (record.get("engine", 1) < 2 and reg.get("tf") == DAILY and record.get("tf", DAILY) < DAILY
            and is_stock(record.get("symbol", ""))):
        return True
    codes = {c for slot in (rule.get("recipe") or {}).get("slots") or [] for c in slot.get("codes") or []}
    return record.get("engine", 1) < 4 and "WF" in codes and (rule.get("entry") or {}).get("type") != "stop"


def _run_path(run_id):
    return tester_dir() / "runs" / f"{run_id}.json.gz"


def history(symbol=None):
    path = _runs_path()
    rows = []
    if path.exists():
        with open(path, encoding="utf-8") as fh:
            rows = [json.loads(line) for line in fh if line.strip()]
    return [r for r in rows if (symbol is None or r.get("symbol") == symbol) and not _stale(r)]


def _save(result, digest):
    run_id = f"{result['symbol']}_{result['rule']['tf']}_f{result['phase']}_{digest}_{int(time.time())}"
    result["id"], result["hash"], result["at"], result["engine"] = run_id, digest, int(time.time() * 1000), ENGINE
    with _write_lock:
        path = _run_path(run_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        with gzip.open(path, "wt", encoding="utf-8") as fh:
            json.dump(result, fh, allow_nan=False, separators=(",", ":"))
        record = {"id": run_id, "at": result["at"], "symbol": result["symbol"], "tf": result["rule"]["tf"],
                  "phase": result["phase"], "hash": digest, "name": result["rule"]["name"], "rule": result["rule"],
                  "from": result["from"], "to": result["to"], "summary": result["summary"],
                  "baseline": result.get("baseline"), "edge": result.get("edge"), "engine": ENGINE}
        with open(_runs_path(), "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, allow_nan=False) + "\n")
    return run_id


def load_run(run_id):
    path = _run_path(run_id)
    if not path.exists():
        return None
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def public_run(result):
    """La corrida sin las medidas de cada trade, que se piden por trade."""
    if result is None:
        return None
    out = dict(result)
    out["trades"] = [{k: v for k, v in t.items() if k != "measures"} for t in result["trades"]]
    return out


def trade_detail(run_id, number):
    result = load_run(run_id)
    if result is None:
        return None
    for t in result["trades"]:
        if t["n"] == number:
            labels = patterns._labels()
            rows = [{"key": k, "label": labels[k][0], "group": labels[k][1], "value": v}
                    for k, v in (t.get("measures") or {}).items() if k in labels]
            return {"trade": {k: v for k, v in t.items() if k != "measures"}, "measures": rows}
    return None


# ==================== LO QUE USÓ LA REGLA EN UN TRADE ====================
# Pedido del usuario (20/11/2026) para depurar en el backtesting global: al elegir un trade, ver en el gráfico los
# indicadores de la regla con los ajustes de la prueba. La regla de la corrida se vuelve a correr (sin los controles)
# con `trace`, y de ahí salen las mismas líneas, filtros y elementos que usó, en una ventana alrededor del trade.

CONTEXT_BEFORE = 150   # Velas de la regla antes de la señal
CONTEXT_AFTER = 60     # Y después de la salida
_replays = {}
OI_TEXT = {"conf": "Confluencia OI-volumen a favor", "noconf": "Sin confluencia OI-volumen en contra"}
REGIME_TEXT = {"inside": "dentro", "outside": "fuera", "breakout": "tras romper"}


def saved_rule(result):
    """La regla de una corrida guardada, lista para correr otra vez. Del disco, los mínimos por grupo de una receta en
    secuencia vuelven con las llaves como texto ("1") y la receta las busca como números: sin esto, repetir una regla en
    secuencia (el contexto del trade elegido) fallaba."""
    rule = result["rule"]
    mins = rule["recipe"].get("groupMins")
    if isinstance(mins, dict):
        rule = {**rule, "recipe": {**rule["recipe"], "groupMins": {int(g): v for g, v in mins.items()}}}
    return rule


def _replay(result):
    """La regla de una corrida guardada, corrida otra vez sin controles y con `trace`: el contexto de sus velas, los
    elementos y qué pasó con cada señal. Las últimas 3 en memoria: elegir otro trade de la misma corrida no la repite."""
    run_id = result.get("id")
    with _lock:
        found = _replays.get(run_id)
    if found is not None:
        return found
    symbol, rule = result["symbol"], saved_rule(result)
    # El tramo de la corrida, no el de hoy: la fase 3 crece con el almacén
    phase = {"phase": result["phase"], "from": result["from"], "to": result["to"],
             "start": _ms(result["from"]), "end": _ms(result["to"]) + oe.DAY_MS}
    span = detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule.get("filters") else None
    trace = {}
    if not run(symbol, rule, span, phase, table, base=False, trace=trace).get("success"):
        return None
    trace["span"], trace["table"] = span, table
    with _lock:
        _replays[run_id] = trace
        while len(_replays) > 3:
            _replays.pop(next(iter(_replays)))
    return trace


def _regime_boxes(reg, bars, session=False):
    """Las cajas del detector que usa el filtro de régimen, en el marco en que se mide (el de la regla o el día), en
    horas: start (apertura de su primera vela), known (cierre de la vela en que se supo), end (cierre de la última)."""
    import regime_detectors as rd
    a = {"t": np.array([b["t"] for b in bars], dtype=np.int64), **{k: np.array([b[src] for b in bars], dtype=float)
         for k, src in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))}}
    step = int(np.median(np.diff(a["t"]))) if len(a["t"]) > 1 else DAY_MS
    if reg.get("tf") == DAILY and step < DAY_MS:
        a = _sessions(a)[0] if session else _daily(a, step)
        step = DAY_MS
    if len(a["t"]) <= 30:
        return []
    params = rd.PARAMS["er_box"]["params"]
    boxes = rd.er_box(a, **params)
    zones = rd.major(a, [{"i": z["detected"], "low": z["low"], "high": z["high"]} for z in boxes["zones"]], 8.0, 0.5, reg["majorOut"]) if reg["major"] else boxes
    return [{"start": int(a["t"][z["start"]]), "known": int(a["t"][z["detected"]]) + step, "end": int(a["t"][z["end"]]) + step,
             "low": float(z["low"]), "high": float(z["high"]), "major": bool(reg["major"])} for z in zones["zones"]]


def _line_text(item):
    """Lo que pide un filtro de línea, en palabras"""
    name = f"{'VWAP' if item['type'] == 'vwap' else 'EMA'} {item['period']}"
    text = f"{name} {'tocando' if item['mode'] == 'touch' else 'a favor'}"
    if item.get("slope"):
        text += f", con pendiente en {LINE_SLOPE_BARS} velas"
    if item.get("maxDev"):
        text += f", abre a no más de {item['maxDev']:g} desv."
    return name, text


def _num_text(value, digits=6):
    return "—" if value is None or not value == value else f"{float(value):.{digits}g}"


# Los filtros de Williams en palabras, para las filas del trade elegido (los mismos de ruleFacets.js en la ventana)
BW_ALLIGATOR_TEXT = {"awake": "Alligator despierto a favor", "side": "Cierre del lado de los dientes del Alligator", "sleeping": "Alligator dormido"}
BW_MOMENTUM_TEXT = {"color": "con la barra a favor", "zero": "del lado del cero a favor", "both": "con la barra a favor y del lado del cero"}
BW_GATOR_TEXT = {"eating": "Gator comiendo: sus dos barras crecen", "open": "Gator despierto: al menos una barra crece",
                 "sleeping": "Gator dormido: sus dos barras se achican"}
BW_MFI_TEXT = {"green": "MFI: vela verde (suben el MFI y el volumen)", "squat": "MFI: vela squat (baja el MFI y sube el volumen)",
               "volume": "MFI: vela verde o squat (sube el volumen)", "notFake": "MFI: la vela no es fake"}


def _bw_rows(bwf, ws, k, close):
    """Una fila por filtro de Williams de la regla: (clave, ese filtro solo, su nombre, su valor en la vela de la señal)."""
    rows = []
    moves = lambda d: "sube" if d > 0 else ("baja" if d < 0 else "sin dato")
    grows = lambda d: "crece" if d > 0 else ("se achica" if d < 0 else "sin dato")
    if bwf.get("alligator"):
        state = ws["state"][k]
        rows.append(("bwAlligator", {"alligator": bwf["alligator"]}, BW_ALLIGATOR_TEXT[bwf["alligator"]],
                     f"{'despierto al alza' if state > 0 else 'despierto a la baja' if state < 0 else 'dormido'}; "
                     f"cierre en {_num_text(close[k])}, dientes en {_num_text(ws['teeth'][k])}"))
    if bwf.get("zone"):
        zone = ws["zone"][k]
        rows.append(("bwZone", {"zone": True}, "Zona de Williams a favor",
                     "zona " + ("verde" if zone == 1 else "roja" if zone == -1 else "gris" if zone == 0 else "sin dato")))
    for key, name in (("ao", "AO"), ("ac", "AC")):
        if bwf.get(key):
            rows.append((f"bw{name}", {key: bwf[key]}, f"{name} {BW_MOMENTUM_TEXT[bwf[key]]}",
                         f"{name} en {_num_text(ws[key][k])}, {moves(ws[key + 'Dir'][k])}"))
    if bwf.get("gator"):
        rows.append(("bwGator", {"gator": bwf["gator"]}, BW_GATOR_TEXT[bwf["gator"]],
                     f"barra de arriba {grows(ws['gUpDir'][k])}, la de abajo {grows(ws['gDownDir'][k])}"))
    if bwf.get("mfi"):
        kind = ws["mfiType"][k] if ws.get("mfiType") else 0
        rows.append(("bwMfi", {"mfi": bwf["mfi"]}, BW_MFI_TEXT[bwf["mfi"]], f"vela {williams.MFI_TYPES.get(kind, 'sin dato')}"))
    return rows


def trade_context(run_id, number, before=CONTEXT_BEFORE, after=CONTEXT_AFTER):
    """
    Lo que usó la regla alrededor de un trade, para dibujarlo: sus líneas (EMA, VWAP móvil con su tope, canal gaussiano)
    enteras en la ventana; todas las apariciones de sus elementos; las cajas del régimen; una fila por filtro con si
    pasa en cada vela, para el lado del trade, y su valor en la vela de la señal; y cada señal de la regla con lo que
    pasó (su trade o por qué no entró). Todo con las funciones y los ajustes de la prueba, y sin nada posterior a lo
    que la regla podía saber en cada vela. `same` dice si al repetirla hoy la señal da el mismo trade.
    """
    result = load_run(run_id)
    if result is None:
        return None
    trade = next((t for t in result["trades"] if t["n"] == number), None)
    if trade is None:
        return None
    trace = _replay(result)
    if trace is None:
        return {"success": False, "message": "No se pudo repetir la regla de esta corrida"}
    rule, symbol = result["rule"], result["symbol"]
    tf_ms = rule["tf"] * 60000
    ctx, bars = trace["ctx"], trace["span"]["bars"]
    T = ctx["T"]
    n = len(T)
    k = bisect.bisect_left(T, trade["signal"])
    if k >= n or T[k] != trade["signal"]:
        return {"success": False, "message": "La vela de la señal no está en las velas de la fase"}
    e = min(n - 1, bisect.bisect_left(T, trade["exit_t"]))
    lo, hi = max(0, k - before), min(n, e + after + 1)
    side = trade["dir"]

    def clean(value):
        return None if value is None or not value == value else round(float(value), 8)

    def series(values, offset=0, start=0):
        return [[T[i], clean(values[offset + i])] for i in range(lo, hi) if offset + i >= start and clean(values[offset + i]) is not None]

    def row(key, label, state, note):
        items = []
        for i in range(lo, hi):
            value = state(i)
            items.append([T[i], None if value is None else (1 if value else 0)])
        return {"key": key, "label": label, "items": items, "note": note}

    out = {"success": True, "tf": rule["tf"], "from": T[lo], "to": T[hi - 1] + tf_ms, "side": side, "signal": T[k],
           "engine": result.get("engine", 1), "engineNow": ENGINE, "lines": [], "channel": None, "elements": [], "regime": None,
           "rows": [], "signals": []}

    for item in rule.get("lines") or []:
        values = _line(ctx, item["type"], item["period"])
        name, text = _line_text(item)
        entry = {"label": name, "type": item["type"], "points": series(values)}
        if item.get("maxDev"):
            dev = _vwap_dev(ctx, item["period"])
            entry["limit"] = series([v + side * item["maxDev"] * d for v, d in zip(values, dev)])
            entry["limitLabel"] = f"{name} {'+' if side > 0 else '−'}{item['maxDev']:g} desv."
        out["lines"].append(entry)
        out["rows"].append(row(f"line{len(out['lines'])}", text,
                               lambda i, item=item, values=values: None if not values[i] == values[i] else _lines_ok([item], ctx, i, side),
                               f"{name} en {_num_text(values[k])}, cierre en {_num_text(ctx['C'][k])}"))

    if rule.get("gc"):
        gc = rule["gc"]
        warm = trace["span"].get("warm") or []
        mid, up, down = gaussian_channel.channel(warm + bars, gc["period"], gc["poles"], gc["mult"])
        off, start = len(warm), 2 * gc["period"]  # Antes, el canal todavía no da señales: no se dibuja
        out["channel"] = {"label": f"Canal gaussiano {gc['period']}, {gc['poles']} polos, ×{gc['mult']:g}",
                          "mid": series(mid, off, start), "high": series(up, off, start), "low": series(down, off, start)}

    flow = rule.get("flow") or {}
    cache = ctx.setdefault("flow", {})
    if flow.get("cvd"):
        key = ("cvd", flow["cvd"])
        if key not in cache:
            cache[key] = flow_filters.cvd(bars, flow["cvd"])[0]
        values = cache[key]
        out["rows"].append(row("cvd", f"CVD de {flow['cvd']} velas a favor",
                               lambda i: None if not values[i] == values[i] else values[i] * side > 0,
                               f"CVD {values[k] * 100:+.1f}% del volumen" if values[k] == values[k] else "CVD sin dato"))
    if flow.get("oi"):
        if "oi" not in cache:
            oi = flow_filters.oi_at_close(symbol, bars, rule["tf"])
            signed = flow_filters.signed_volume(bars)[0]
            cache["oi"] = (oi, signed, None if oi is None else flow_filters.z_pair(oi, signed))
        oi, signed, z = cache["oi"]
        mode, back, pct = flow["oi"], flow.get("oiBars", 6), flow.get("oiPct", 2.0)
        label = (f"OI {'sube' if mode == 'rise' else 'baja'} más de {pct:g}% en {back} velas" if mode in ("rise", "fall") else OI_TEXT[mode])
        if oi is None:
            note = "sin OI de esta moneda en este marco"
        elif mode in ("rise", "fall") and k >= back and oi[k] == oi[k] and oi[k - back] == oi[k - back] and oi[k - back] > 0:
            note = f"OI {(oi[k] / oi[k - back] - 1) * 100:+.2f}% en {back} velas"
        else:
            note = f"OI {_num_text(oi[k])}"
        out["rows"].append(row("oi", label, lambda i: None if oi is None or not np.isfinite(oi[i])
                               else flow_filters.oi_ok(mode, oi, signed, i, side, back, pct, z), note))
    if flow.get("crowd"):
        if "funding" not in cache:
            cache["funding"] = flow_filters.funding_3d(symbol, bars, rule["tf"])
        funding = cache["funding"]
        label = "No ir con la multitud (funding)" if flow["crowd"] == "nocon" else "Solo contra la multitud (funding)"
        note = (f"funding {funding[k] * 100:.4f}% por 8 h: {flow_filters.crowd(float(funding[k]), side)} la multitud"
                if funding[k] == funding[k] else "sin funding")
        out["rows"].append(row("crowd", label, lambda i: None if not funding[i] == funding[i] else flow_filters.crowd_ok(flow["crowd"], funding[i], side), note))
    if flow.get("steady"):
        key = ("steady", flow["steadyDays"])
        if key not in cache:
            cache[key] = flow_filters.oi_steady(symbol, bars, rule["tf"], flow["steadyDays"])
        values = cache[key]
        out["rows"].append(row("steady", f"OI sostenido: sube en {flow['steadyMin'] * 100:.0f}% o más de los pasos de {flow['steadyDays']} días",
                               lambda i: None if not values[i] == values[i] else values[i] >= flow["steadyMin"],
                               f"sube en {values[k] * 100:.0f}% de los pasos" if values[k] == values[k] else "OI sin datos suficientes"))
    if flow.get("chain"):
        chain = flow["chain"]
        value, cz = _chain_series(chain, ctx, symbol, rule["tf"])
        out["rows"].append(row("chain", onchain_flows.describe(chain, symbol),
                               lambda i: None if not cz[i] == cz[i] else onchain_flows.chain_ok(chain, cz[i], side),
                               f"{value[k]:+.2f}% a favor de un largo, z {cz[k]:+.2f}" if cz[k] == cz[k] else "sin dato on-chain"))

    if rule.get("regime"):
        reg = rule["regime"]
        ok = ctx.get("regimeOK")
        if ok is None:
            ok = regime_mask(reg, bars, is_stock(symbol))
        where = f"{'del rango mayor' if reg['major'] else 'de las cajas'}{' medido en 1D' if reg.get('tf') == DAILY else ''}"
        label = f"Régimen: {REGIME_TEXT.get(reg['mode'], reg['mode'])} {where}"
        if reg["mode"] == "breakout":
            label += f", {reg['after']} velas"
        t0, t1 = out["from"], out["to"]
        boxes = [b for b in _regime_boxes(reg, bars, is_stock(symbol)) if b["end"] >= t0 and b["start"] <= t1]
        out["regime"] = {"label": label, "boxes": boxes}
        out["rows"].append(row("regime", label, lambda i: bool(ok[i]), "en la señal: " + ("permitido" if ok[k] else "no permitido")))

    # Los filtros de Williams y SMC, uno por fila (21/11: no tenían la suya). En gris las velas sin el dato del filtro
    if rule.get("bwf"):
        ws = _bw_series(ctx)
        for key, piece, label, note in _bw_rows(rule["bwf"], ws, k, ctx["C"]):
            out["rows"].append(row(key, label, lambda i, piece=piece: williams.filter_ok(piece, ws, i, side) if williams.filter_known(piece, ws, i) else None, note))
    if rule.get("smcf"):
        smcf, rng, close = rule["smcf"], _smc_range(rule, ctx), ctx["C"]
        if smcf.get("pd"):
            top, bottom = rng["top"][k], rng["bottom"][k]
            known = lambda i: rng["top"][i] == rng["top"][i] and rng["bottom"][i] == rng["bottom"][i] and rng["top"][i] > rng["bottom"][i]
            out["rows"].append(row("smcPd", f"Largos en discount y cortos en premium (rango mayor de {smcf['swing']} velas)",
                                   lambda i: smc.filter_ok({"pd": True}, rng, close, i, side) if known(i) else None,
                                   f"cierre en {_num_text(close[k])}, mitad del rango en {_num_text((top + bottom) / 2)}" if known(k) else "sin rango mayor todavía"))
        if smcf.get("bias"):
            trend = rng["bias"][k]
            out["rows"].append(row("smcBias", f"A favor de la estructura mayor de {smcf['swing']} velas",
                                   lambda i: (rng["bias"][i] == side) if rng["bias"][i] else None,
                                   "tendencia " + ("alcista" if trend == 1 else "bajista" if trend == -1 else "sin ruptura todavía")))

    if rule.get("vpaf"):
        vs, vf = _vpa_series(rule, ctx), rule["vpaf"]
        label = (f"Medidor VPA a favor (≥ {vf['thr']:g})" if vf["mode"] == "favor" else f"Medidor VPA no en contra (> −{vf['thr']:g})")
        meter = vs["meter"][k]
        out["rows"].append(row("vpaf", label, lambda i: vpa.filter_ok(vf, vs, i, side) if vpa.filter_known(vs, i) else None,
                               f"medidor {meter:+.2f} ({'fuerza' if meter >= 0 else 'debilidad'})" if vpa.filter_known(vs, k) else "sin volumen normal de su hora todavía"))

    if rule.get("hours"):
        hours = rule["hours"]
        clock = lambda minute: f"{minute // 60:02d}:{minute % 60:02d}"
        label = f"Horario {clock(hours['from'])}–{clock(hours['to'])} UTC{', lunes a viernes' if hours['weekdays'] else ''}"
        out["rows"].append(row("hours", label, lambda i: _in_hours(hours, T[i] + tf_ms), f"la señal se supo a las {clock(((T[k] + tf_ms) // 60000) % 1440)} UTC"))

    if rule.get("filters"):
        table = trace.get("table")
        labels = patterns._labels()
        text = " y ".join(f"{labels.get(f['key'], (f['key'],))[0]} {'≥' if f['op'] == '>=' else '≤'} {f['value']:g}" for f in rule["filters"])

        def measured(i):
            if table is None:
                return None
            at = measures.row_at(table, T[i] + tf_ms)
            return None if at is None else _passes(rule["filters"], measures.read_row(table, at, side))
        out["rows"].append(row("filters", f"Medidas: {text}", measured, "sin la tabla de medidas" if table is None else ""))

    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    t0, t1 = out["from"], out["to"]
    out["elements"] = [{"code": ev["code"], "dir": ev["dir"], "t": ev["t"], "known": ev["known"], "lo": clean(ev["lo"]), "hi": clean(ev["hi"])}
                       for ev in trace["events"] if ev["code"] in codes and t0 <= ev["t"] < t1][:400]
    for s in trace["signals"]:
        if lo <= s["k"] < hi:
            out["signals"].append({"t": T[s["k"]], "known": T[s["k"]] + tf_ms, "dir": s["dir"], "what": s["what"], **({"n": s["n"]} if "n" in s else {})})
    out["same"] = any(s["k"] == k and s.get("n") == number for s in trace["signals"])
    # El stop de cada vela del trade, con su fase: el inicial, a la entrada o arrastrado (pedido del usuario para revisar
    # el trailing). Sale de la corrida repetida: solo si da el mismo trade
    path = (trace.get("paths") or {}).get(number) if out["same"] else None
    if path:
        initial, entry = trade["stop"], trade["entry"]
        out["stopPath"] = [[t, clean(level), "inicial" if level == initial else ("entrada" if level == entry else "arrastrado")]
                           for t, level, *_ in path]
        # Con el trailing del objetivo: dónde se activa y dónde quedó el objetivo arrastrado al cerrar cada vela
        tp = rule["exit"].get("tpTrail")
        if tp:
            out["tpStart"] = {"price": clean(entry + side * tp["start"] * trade["risk"]), "r": tp["start"], "t": trade.get("tp_on")}
            out["tpPath"] = [[t, clean(rest[0])] for t, _, *rest in path if rest and rest[0] is not None]
    return out


def gate(symbol, rule, phase_number):
    """Qué se sabe antes de correr una fase: corrida guardada, variantes probadas y si la fase 3 está permitida."""
    digest = rule_hash(symbol, rule)
    rows = history(symbol)
    same = [r for r in rows if r["hash"] == digest and r["phase"] == phase_number]
    info = {"hash": digest, "stored": same[-1]["id"] if same and phase_number > 1 else None,
            "variantsPhase1": len({r["hash"] for r in rows if r["phase"] == 1}),
            "rulesInPhase": len({r["hash"] for r in rows if r["phase"] == phase_number}),
            "ranPhase1": any(r["hash"] == digest and r["phase"] == 1 for r in rows),
            "ranPhase2": any(r["hash"] == digest and r["phase"] == 2 for r in rows)}
    info["blocked"] = "La fase 3 pide haber corrido antes esta misma regla en la fase 2" if phase_number == 3 and not info["ranPhase2"] else None
    return info


def start(symbol, raw_rule, phase_number, confirm=False):
    """Lanza la corrida en un hilo. Las fases 2 y 3 devuelven la guardada si esa regla exacta ya se corrió."""
    rule = clean_rule(raw_rule)
    if rule is None:
        return {"success": False, "message": "La regla no tiene elementos conocidos"}
    phase = next((p for p in phases(symbol) if p["phase"] == phase_number), None)
    if phase is None or not phase["available"]:
        return {"success": False, "message": "No hay datos de esa fase para este símbolo"}
    allowed = codes_for(symbol, rule["tf"])
    if allowed is not None:
        codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
        if codes - allowed:
            why = (f"{symbol} es una acción y corre sobre sus velas" if is_stock(symbol)
                   else "En 1 día la regla corre sobre velas" if rule["tf"] == DAILY else f"{symbol} no tiene almacén de trades")
            return {"success": False, "message": f"{why}: aquí solo se pueden usar {_labels(sorted(allowed))}. "
                                                 f"Quita {_labels(sorted(codes - allowed))} de la regla"}
    info = gate(symbol, rule, phase_number)
    if info["blocked"]:
        return {"success": False, "message": info["blocked"], "gate": info}
    if info["stored"]:
        return {"success": True, "run": info["stored"], "stored": True, "gate": info}
    if phase_number > 1 and not confirm:
        return {"success": True, "needsConfirm": True, "gate": info, "phase": phase}
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "state": "running", "done": 0, "total": 1, "stage": "Elementos del tramo", "run": None, "error": None}
    with _lock:
        _jobs[job_id] = job

    def work():
        try:
            span = detect_span(symbol, rule["tf"], phase, rule, lambda d, t: job.update(done=d, total=t))
            job["stage"] = "Simulando los trades"
            table = measures.table_for(symbol)
            result = run(symbol, rule, span, phase, table)
            if not result.get("success"):
                job.update(state="error", error=result.get("message"))
                return
            result["gate"] = info
            job.update(run=_save(result, info["hash"]), state="done")
        except Exception as error:  # El hilo no puede dejar el trabajo colgado
            job.update(state="error", error=f"{type(error).__name__}: {error}")

    threading.Thread(target=work, daemon=True).start()
    return {"success": True, "job": job_id, "gate": info}


# ==================== TODAS LAS MONEDAS ====================
# La misma regla en cada moneda con velas guardadas, una tras otra, y el informe de todas juntas.

def _plan(rule, phase_number, group="base"):
    """Qué pasa con cada moneda del grupo: se corre, ya tiene esa regla exacta corrida en la fase, o no se puede (y por qué)."""
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    rows = []
    for symbol in candle_symbols(group if group in GROUPS else "base"):
        row = {"symbol": symbol, "action": "skip", "run": None, "reason": None}
        phase = next((p for p in phases(symbol) if p["phase"] == phase_number), None)
        info = gate(symbol, rule, phase_number)
        same = [r for r in history(symbol) if r["hash"] == info["hash"] and r["phase"] == phase_number]
        if same:
            row.update(action="stored", run=same[-1]["id"])  # La corrida es determinista: no se repite
        elif phase is None or not phase["available"]:
            row["reason"] = "sin datos de esa fase"
        elif _on_candles(symbol, rule["tf"]) and not has_candles(symbol, rule["tf"]):
            row["reason"] = "sin velas de ese marco (candles_update.py --tf 15,5)"
        elif codes_for(symbol, rule["tf"]) is not None and codes - codes_for(symbol, rule["tf"]):
            row["reason"] = f"corre sobre velas: no puede usar {_labels(sorted(codes - codes_for(symbol, rule['tf'])))}"
        elif info["blocked"]:
            row["reason"] = "falta correr esta regla en la fase 2"
        else:
            row["action"] = "run"
        rows.append(row)
    return rows


def start_all(raw_rule, phase_number, confirm=False, group="base"):
    """La regla en todas las monedas, en un solo trabajo. Las fases 2 y 3 piden confirmar lo que se va a gastar."""
    rule = clean_rule(raw_rule)
    if rule is None:
        return {"success": False, "message": "La regla no tiene elementos conocidos"}
    with _lock:
        busy = next((j for j in _jobs.values() if j.get("all") and j["state"] == "running"), None)
    if busy is not None:  # Un segundo clic no lanza otro trabajo: se sigue el que ya corre
        return {"success": True, "job": busy["id"], "plan": busy["plan"], "already": True}
    plan = _plan(rule, phase_number, group)
    todo = [row for row in plan if row["action"] == "run"]
    if not todo and not any(row["action"] == "stored" for row in plan):
        return {"success": False, "message": "Ninguna moneda puede correr esta regla en esta fase", "plan": plan}
    if phase_number > 1 and todo and not confirm:
        return {"success": True, "needsConfirm": True, "plan": plan}
    if not todo:
        return {"success": True, "done": True, "plan": plan}
    job_id = uuid.uuid4().hex[:12]
    job = {"id": job_id, "state": "running", "done": 0, "total": 1, "stage": todo[0]["symbol"], "run": None, "error": None,
           "all": True, "phase": phase_number, "group": group, "plan": plan, "symbolsDone": 0, "symbolsTotal": len(todo)}
    with _lock:
        _jobs[job_id] = job

    def work():
        for number, row in enumerate(todo):
            symbol = row["symbol"]
            try:
                job.update(stage=f"{symbol} ({number + 1} de {len(todo)}): elementos", done=0, total=1)
                phase = next(p for p in phases(symbol) if p["phase"] == phase_number)
                info = gate(symbol, rule, phase_number)
                span = detect_span(symbol, rule["tf"], phase, rule, lambda d, t: job.update(done=d, total=t))
                job["stage"] = f"{symbol} ({number + 1} de {len(todo)}): trades"
                result = run(symbol, rule, span, phase, measures.table_for(symbol))
                if not result.get("success"):
                    row.update(action="skip", reason=result.get("message"))
                else:
                    result["gate"] = info
                    row.update(action="stored", run=_save(result, info["hash"]))
            except Exception as error:  # Una moneda que falla no detiene a las demás
                row.update(action="skip", reason=f"{type(error).__name__}: {error}")
            job["symbolsDone"] = number + 1
        job.update(state="done")

    threading.Thread(target=work, daemon=True).start()
    return {"success": True, "job": job_id, "plan": plan}


def _pooled_row(label, trades):
    s = summary(sorted(trades, key=lambda t: t["exit_t"]))
    return {"label": label, "n": s.get("n", 0), "winRate": s.get("winRate"), "avgR": s.get("avgR"), "totalR": s.get("totalR")}


def consolidated(raw_rule, phase_number, group="base"):
    """Informe de todas las monedas que ya tienen esa regla exacta corrida en la fase: juntas y una por una."""
    rule = clean_rule(raw_rule)
    if rule is None:
        return {"success": False, "message": "La regla no tiene elementos conocidos"}
    plan = _plan(rule, phase_number, group)
    rows, pooled, weights, leg_weights, controls = [], [], [], [], []
    pooled_quarters = {}
    for row in plan:
        result = with_quarter_baseline(with_leg_baseline(load_run(row["run"]))) if row["run"] else None
        if result is None:
            continue
        for q, (n, r, e) in quarter_rows(result).items():
            cell = pooled_quarters.setdefault(q, [0, 0.0, 0.0])
            cell[0] += n
            cell[1] += r
            cell[2] += e
        s, b, trades = result["summary"], result.get("baseline") or {}, result["trades"]
        leg = result.get("legBaseline") or {}
        if s.get("n") and leg.get("n"):
            leg_weights.append((s["n"], leg))
        if "control" in result:
            controls.append((result.get("controlKind", "liq"), result["control"]))
        for t in trades:
            pooled.append({"r": t["r"], "dir": t["dir"], "entry_t": t["entry_t"], "exit_t": t["exit_t"], "mfe": t.get("mfe"), "mae": t.get("mae"),
                           "bars": t.get("bars"), "reach": t.get("reach"), "symbol": row["symbol"]})
        rows.append({"symbol": row["symbol"], "run": row["run"], "from": result["from"], "to": result["to"], "n": s.get("n", 0),
                     "winRate": s.get("winRate"), "avgR": s.get("avgR"), "totalR": s.get("totalR"), "profitFactor": s.get("profitFactor"),
                     "maxDrawdownR": s.get("maxDrawdownR"), "baseR": b.get("avgR"), "edge": result.get("edge"),
                     "legR": leg.get("avgR"), "legEdge": result.get("legEdge")})
        if s.get("n") and b.get("n"):
            weights.append((s["n"], b))
    if not rows:
        return {"success": False, "message": "Ninguna moneda tiene esta regla corrida en esta fase", "plan": plan}
    ordered = sorted(pooled, key=lambda t: t["exit_t"])
    out = {"success": True, "rule": rule, "phase": phase_number, "group": group, "plan": plan, "symbols": rows, "summary": summary(ordered) if ordered else {"n": 0},
           "trades": [[t["entry_t"], t["exit_t"], t["r"]] for t in ordered],  # Para la vista "como cuenta" de la ventana
           "equity": _equity(ordered), "positive": sum(1 for r in rows if (r["avgR"] or 0) > 0), "withTrades": sum(1 for r in rows if r["n"]),
           # Constancia: la ventaja de cada trimestre contra el azar de ese trimestre y lado, en cada moneda
           "consistency": consistency(pooled_quarters)}
    if ordered:
        years = sorted({dt.datetime.fromtimestamp(t["entry_t"] / 1000, dt.timezone.utc).year for t in ordered})
        out["byYear"] = [_pooled_row(str(y), [t for t in ordered if dt.datetime.fromtimestamp(t["entry_t"] / 1000, dt.timezone.utc).year == y]) for y in years]
        out["bySide"] = [_pooled_row(label, [t for t in ordered if t["dir"] == d]) for label, d in (("Largos", 1), ("Cortos", -1)) if any(t["dir"] == d for t in ordered)]
    if weights and ordered:
        # El azar de cada moneda pesa según los trades que la regla hizo en ella
        total = sum(n for n, _ in weights)
        base = sum(n * b["avgR"] for n, b in weights) / total
        base_se = math.sqrt(sum((n * b["seR"]) ** 2 for n, b in weights)) / total
        s = out["summary"]
        edge, se = s["avgR"] - base, math.sqrt(s["seR"] ** 2 + base_se ** 2)
        reach = {level: round(sum(n * b["reach"][level] for n, b in weights if b.get("reach")) / max(1, sum(n for n, b in weights if b.get("reach"))), 1)
                 for level in (str(x) for x in REACH_LEVELS)} if any(b.get("reach") for _, b in weights) else None
        out["baseline"] = {"avgR": round(base, 3), "seR": round(base_se, 4), "reach": reach,
                           "winRate": round(sum(n * b["winRate"] for n, b in weights) / total, 1)}
        out["edge"] = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3),
                       "clear": abs(edge) > 1.96 * se and not s["smallSample"]}
    # El control del tramo solo vale si lo tienen todas las monedas con trades: con una parte, compararía grupos distintos
    if leg_weights and ordered and len(leg_weights) == sum(1 for r in rows if r["n"]):
        total = sum(n for n, _ in leg_weights)
        pooled_leg = {"n": total, "avgR": sum(n * b["avgR"] for n, b in leg_weights) / total,
                      "seR": math.sqrt(sum((n * b["seR"]) ** 2 for n, b in leg_weights)) / total}
        out["legEdge"] = _edge(out["summary"], pooled_leg)
        out["legBaseline"] = {"avgR": round(pooled_leg["avgR"], 3), "seR": round(pooled_leg["seR"], 4), "leg": leg_weights[0][1].get("leg"),
                              "winRate": round(sum(n * b["winRate"] for n, b in leg_weights) / total, 1)}
    # El control propio (sin liquidaciones, o sin la firma de Byko) de todas las monedas juntas: sus trades se juntan
    # a partir del resumen de cada moneda. Solo si lo tienen todas las corridas
    if controls and ordered and len(controls) == len(rows):
        pooled_control = _pool_summaries([c for _, c in controls])
        if pooled_control:
            out["control"] = {**pooled_control, "kind": controls[0][0], "edge": _edge(out["summary"], pooled_control)}
    return out


def _pool_summaries(parts):
    """Media y error de todos los trades de varios resúmenes (n, avgR, seR) juntos, sin tenerlos uno por uno."""
    parts = [p for p in parts if p.get("n")]
    total = sum(p["n"] for p in parts)
    if not total:
        return None
    mean = sum(p["n"] * p["avgR"] for p in parts) / total
    # Varianza de cada grupo (seR² · n) más lo que separa su media de la de todos
    ss = sum((p["n"] - 1) * (p["seR"] ** 2) * p["n"] + p["n"] * (p["avgR"] - mean) ** 2 for p in parts)
    se = math.sqrt(ss / max(1, total - 1) / total)
    win = sum(p["n"] * (p.get("winRate") or 0) for p in parts) / total
    return {"n": total, "avgR": round(mean, 4), "seR": round(se, 4), "winRate": round(win, 1), "smallSample": total < SMALL_SAMPLE}


def job_status(job_id):
    with _lock:
        job = _jobs.get(job_id)
    return dict(job) if job else None


def sensitivity(symbol, raw_rule):
    """Solo en la fase 1: la regla con valores vecinos de objetivo y ventana, para ver si el resultado es frágil."""
    rule = clean_rule(raw_rule)
    phase = next((p for p in phases(symbol) if p["phase"] == 1), None)
    if rule is None or phase is None or not phase["available"]:
        return {"success": False, "message": "Regla o fase no válidas"}
    if not _on_candles(symbol, rule["tf"]) and not _span_path(symbol, rule["tf"], phase, rule).exists():
        return {"success": False, "message": "Corre primero la regla en la fase 1"}
    span = detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule["filters"] else None
    rows = []

    def add(label, variant, current=False):
        result = run(symbol, variant, span, phase, table, base=False)
        if result.get("success"):
            s = result["summary"]
            rows.append({"label": label, "current": current, "n": s.get("n", 0), "winRate": s.get("winRate"),
                         "avgR": s.get("avgR"), "totalR": s.get("totalR"), "profitFactor": s.get("profitFactor")})

    add("Regla actual", rule, True)
    target = rule["exit"]["targetR"]
    tp = rule["exit"].get("tpTrail")
    if tp:
        # Con el trailing del objetivo, el objetivo fijo solo pone el tope del arranque: se mueven el arranque y la distancia
        unit = {"r": "R", "atr": "ATR", "pct": "%"}[tp["unit"]]
        for value in sorted({round(min(target, max(0.1, tp["start"] * f)), 2) for f in (0.5, 0.75, 1.25)} - {round(tp["start"], 2)}):
            add(f"Trailing del objetivo desde {value:g} R", {**rule, "exit": {**rule["exit"], "tpTrail": {**tp, "start": value}}})
        for value in sorted({round(tp["dist"] * f, 3) for f in (0.5, 1.5, 2.0)}):
            add(f"Trailing del objetivo a {value:g} {unit}", {**rule, "exit": {**rule["exit"], "tpTrail": {**tp, "dist": value}}})
    elif target:
        for value in sorted({round(target * f, 2) for f in (0.5, 0.75, 1.25, 1.5)}):
            add(f"Objetivo {value} R", {**rule, "exit": {**rule["exit"], "targetR": value}})
    for window in (rule["recipe"]["window"] - 1, rule["recipe"]["window"] + 1):
        if 1 <= window <= MAX_WINDOW and len(rule["recipe"]["slots"]) > 1:
            add(f"Ventana {window} velas", {**rule, "recipe": {**rule["recipe"], "window": window}})
    for buffer in sorted({round(rule["stop"]["buffer"] * f, 3) for f in (0.5, 2.0)} | {0.0}):
        if buffer != rule["stop"]["buffer"]:
            add(f"Margen del stop {buffer} ATR", {**rule, "stop": {**rule["stop"], "buffer": buffer}})
    return {"success": True, "rows": rows}


def export_csv(run_id):
    result = load_run(run_id)
    if result is None:
        return None
    keys = [item[0] for item in measures.MEASURES]
    head = ["n", "lado", "senal_utc", "entrada_utc", "salida_utc", "orden", "entrada", "stop", "objetivo", "salida", "motivo",
            "r_neto", "r_bruto", "max_favor_r", "max_contra_r", "alcance_r", "velas", "stop_atr", "elementos_regla",
            "elementos_presentes", "elementos_en_contra", "liq_swing", "liq_extremo", "liq_usd", "liq_dias", "liq_atr"] + keys
    stamp = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")
    lines = [",".join(head)]
    for t in result["trades"]:
        m = t.get("measures") or {}
        row = [t["n"], "largo" if t["dir"] > 0 else "corto", stamp(t["signal"]), stamp(t["entry_t"]), stamp(t["exit_t"]),
               t["order"], t["entry"], round(t["stop"], 8), "" if t["target"] is None else round(t["target"], 8), t["exit"],
               t["reason"], t["r"], t["gross"], t["mfe"], t["mae"], "" if t["reach"] is None else t["reach"], t["bars"],
               t["stop_atr"], " ".join(t["votes"]), " ".join(t["present"]), " ".join(t["against"])]
        liq = t.get("liq") or {}
        row += ["" if liq.get(k) is None else liq[k] for k in ("swing", "extreme", "usd", "zoneAgeDays", "depthAtr")]
        row += ["" if m.get(k) is None else m[k] for k in keys]
        lines.append(",".join(str(x) for x in row))
    return "\n".join(lines) + "\n"
