"""
Elementos de Orderflows Unlocked sobre el almacén de trades (fase 1).

Reglas leídas en las láminas del módulo 1 y calibradas en BTC de 2020 a 2026
(OrderFlowData/research/orderflows_unlocked/CALIBRACION.md):
- Se detecta con un step de análisis fijo por marco, sin agrupar niveles: el del dibujo no sirve
  porque con step automático cada vela queda con su propio step.
- Los umbrales relativos salen de las velas de los 30 días anteriores al día de cada vela, para que
  el elemento marque cerca de `target` de las velas. Nunca usan el día en curso ni el futuro.
- Una vela cuenta solo si cerró antes de known_until. La VA abandonada se conoce al cerrar la siguiente.

Orientación: índice 0 = extremo donde empieza el movimiento de la vela (el mínimo en una verde, el
máximo en una roja). A = lado agresor a favor del color, P = lado contrario.
"""
import datetime as dt
import math
import os
import threading
from collections import OrderedDict
from pathlib import Path

import numpy as np

import footprint_store as fs

WINDOW_DAYS = 30
MIN_WINDOW_BARS = 100     # Con menos historia no hay umbral relativo
DEFAULT_TARGET = 0.05     # Parte de las velas que marca cada elemento relativo
RATIO = 4.0               # Desequilibrio diagonal del módulo (400 %)
MIN_IMB = 0.05            # Lado dominante mínimo del desequilibrio, como parte del nivel promedio
SWEEP_PASSIVE = 0.02      # Contrapartida casi nula en un barrido, como parte del nivel promedio
SWING_BARS = 5
# Motor 8 (26/11/2026, galería 4 del protocolo de pruebas, decidido por el usuario)
DT_WICK = 0.5             # Delta Tail: la mecha donde empieza la vela, al menos la mitad de su rango
DT_CELL = 0.1             # y en ella delta en contra: su celda del extremo, desde el 10% del nivel medio, o la mecha entera
AD_RATIO = 2.0            # Acumulación/Distribución: en su nivel, el lado pasivo al menos el doble del agresor
ABSORB_BARS = 10          # Absorción: el segundo intento llega en las N velas siguientes al primero (el usuario elige N)
ABSORB_MAX_BARS = 50
ABSORB_CELL_PCT = 95      # Mucho volumen agresivo en una celda: el 5% mayor de las celdas de los 30 días anteriores
RETIRED = {"RX"}          # Fuera de las listas (lo pidió el usuario): el código queda para abrir las corridas guardadas
MAX_RANGE_DAYS = 70
MAX_CACHED_DAYS = 400
DAY_MS = 86400000

# código: (nombre, forma, relativo, mínimo literal). Forma: band = franja hasta que el precio vuelve,
# mark = celdas y glifo, box = contorno sobre varias velas, table = solo la tabla de la vela
CATALOG = {
    "VA": ("VA abandonada", "band", False, None),
    "OG": ("Orderflows Gap", "band", True, None),
    "AP": ("POC alineado", "band", False, None),
    "SL": ("POC Slingshot", "band", False, None),
    "RL": ("Absorción (varios intentos)", "band", True, None),
    "EX": ("Exhaustion Print", "band", True, None),
    "ZP": ("Zero Print", "mark", False, None),
    "DT": ("Delta Tail", "band", False, None),
    "RS": ("Retail Suck", "band", True, None),
    "DD": ("Delta Divergence", "band", False, None),
    "PD": ("Price Action Divergence", "mark", True, None),
    "IV": ("Inverse Imbalance", "mark", False, None),
    "AD": ("Acumulación/Distribución", "band", True, None),
    "SW": ("Market Sweep", "band", True, 3),
    "VL": ("Vertical Liquidity", "mark", True, 3),
    "SQ": ("Orderflows Sequencing", "mark", True, 4),
    "DB": ("Delta Breakout", "box", True, None),
    "PW": ("POC Wave", "box", False, None),
    "DV": ("Delta/Volume extremo", "table", True, None),
    # Solo en velas con volumen >= vol_filter veces la mediana de las 20 anteriores: sin ese filtro marcan
    # entre 12% y 74% de las velas de 15m (filtro_volumen.py)
    "ST": ("Stacked Imbalance", "band", False, 3),
    "VI": ("Volume Imbalance", "box", False, 3),
    "IR": ("Imbalance Reversal", "band", False, None),
    "RD": ("Imbalance Reload", "band", False, None),
    "VD": ("Volume Decline", "mark", False, None),
    "TP": ("Thin Print", "mark", False, None),
    "OP": ("Open POC", "band", False, None),
    "RX": ("Ratio de extremos", "mark", False, None),
}
CATALOG.update({
    # Con el almacén de flujo (OrderFlowData/flow, tools/build_flow.py): delta exacto y órdenes agresivas
    "XD": ("Extreme Delta", "table", True, None),
    "SM": ("Small Min/Max Delta", "table", True, None),
    "BR": ("Barrido real", "band", True, None),
    "GR": ("Orden grande", "band", True, None),
})
FLOW_CODES = {"XD", "SM", "BR", "GR"}
FLOW_DIR = Path(os.environ.get("ORDERFLOW_FLOW", r"C:\Users\inven\OrderFlowData\flow"))
# Flujo de las acciones de Alpaca (alpaca_store.py): OrderFlowData/alpaca/flow, junto a alpaca/store
ALPACA_FLOW_DIR = Path(os.environ.get("ALPACA_FLOW", str(fs.ALPACA_STORE_DIR.parent / "flow")))
# Flujo de los dias de la nube (live=True), como footprint_store: OrderFlowData/live/flow, junto a live/store.
# None = al lado de fs.LIVE_DIR. ORDERFLOW_LIVE_FLOW cambia la carpeta
LIVE_FLOW_DIR = Path(os.environ["ORDERFLOW_LIVE_FLOW"]) if os.environ.get("ORDERFLOW_LIVE_FLOW") else None
EXTREME_SHARE = 0.95  # Delta en 95% o más de su máximo o mínimo, como la celda cian o magenta del libro
VOLUME_FILTERED = {"ST", "VI", "IR", "RD", "VD", "TP", "OP", "RX"}
DEFAULT_VOL_FILTER = 2.0
VOLUME_BARS = 20
OPEN_POC_BARS = 5
OPEN_POC_ATR = 0.25  # El POC debe quedar a esta parte del ATR fuera del rango de las 5 velas previas
MAX_THIN_ROWS = 3

INVERSE_MIN = 2  # Inverse Imbalance: desequilibrios contrarios en la mitad lejana

# Lo que un elemento puede llevar propio en `overrides` de detect (28/11/2026, pedido del usuario para la cocina de
# estrategias): campo -> (de fábrica, mínimo, máximo). Sin `overrides`, todos van con los valores de fábrica y detect
# da exactamente lo de siempre: el probador, la suite y el indicador no cambian.
# - target: parte de las velas que marca un elemento relativo (su umbral sale de los 30 días anteriores);
# - vol: volumen mínimo de la vela, en veces la mediana de las 20 anteriores (los de VOLUME_FILTERED);
# - min: su mínimo literal (niveles apilados, desequilibrios, niveles de la secuencia, del barrido o de la liquidez);
# - absorb y cell (RL): velas del segundo intento, y parte de las celdas que cuentan como «mucho volumen»;
# - margin y bars (OP): cuánto fuera del rango de las velas previas queda el POC, en ATR, y cuántas velas;
# - usd (BR, GR): tamaño mínimo en USD, además de su umbral relativo.
OWN_FIELDS = {}
for _code, (_name, _shape, _relative, _literal) in CATALOG.items():
    _own = {}
    if _relative and _code != "RL":
        _own["target"] = (DEFAULT_TARGET, 0.005, 0.3)
    if _code in VOLUME_FILTERED:
        _own["vol"] = (DEFAULT_VOL_FILTER, 0.0, 10.0)
    if _literal is not None:
        _own["min"] = (_literal, 1, 50)
    if _code == "IV":
        _own["min"] = (INVERSE_MIN, 1, 50)
    if _code == "RL":
        _own["absorb"] = (ABSORB_BARS, 1, ABSORB_MAX_BARS)
        _own["cell"] = (round(1 - ABSORB_CELL_PCT / 100, 4), 0.005, 0.3)
    if _code == "OP":
        _own["margin"] = (OPEN_POC_ATR, 0.0, 5.0)
        _own["bars"] = (OPEN_POC_BARS, 2, 50)
    if _code in ("BR", "GR"):
        _own["usd"] = (0.0, 0.0, 1e12)
    OWN_FIELDS[_code] = _own


def clean_overrides(raw):
    """Los valores propios de cada elemento, dentro de rango: {código: {campo: valor}}. Lo desconocido se descarta."""
    out = {}
    for code, fields in (raw or {}).items():
        known = OWN_FIELDS.get(code)
        if not known or not isinstance(fields, dict):
            continue
        kept = {}
        for field, value in fields.items():
            if field not in known:
                continue
            default, low, high = known[field]
            try:
                number = min(high, max(low, float(value)))
            except (TypeError, ValueError):
                continue
            if not math.isfinite(number):
                continue
            kept[field] = int(round(number)) if isinstance(default, int) else number
        if kept:
            out[code] = kept
    return out


_cache = OrderedDict()
_lock = threading.Lock()


def analysis_step(price, interval_minutes, cell):
    """Step fijo del marco: 1, 2 o 5 por potencia de diez, múltiplo de la celda guardada."""
    target = price * fs.STEP_BY_INTERVAL.get(interval_minutes, 0.000125)
    power = 10 ** math.floor(math.log10(target))
    options = [k * p for p in (power / 10, power, power * 10) for k in (1, 2, 5)]
    options = [x for x in options if x >= cell - 1e-12 and abs(x / cell - round(x / cell)) < 1e-6]
    return min(options, key=lambda x: abs(x - target)) if options else cell


def day_step(symbol, interval_minutes, t_ms):
    """El step de análisis de la vela que empieza en t_ms: el de su día UTC, que sale de la apertura del primer minuto del
    día, como en _compute_day. None si el almacén no tiene ese día. El trade elegido del probador dibuja el footprint con
    estas celdas, las de los elementos (O-39 del protocolo de pruebas, 25/11/2026)."""
    day = dt.datetime.fromtimestamp(t_ms / 1000, dt.timezone.utc).date()
    data = fs._load_day(symbol, day.isoformat())
    if data is None:
        return None
    ps, _, ticks = (int(x) for x in data["info"])
    step = analysis_step(float(data["o"][0]) / ps, int(interval_minutes), ticks / ps)
    return max(ticks, int(round(step * ps / ticks)) * ticks) / ps


def _run(mask):
    """Racha más larga de True: (largo, primer índice, último índice)."""
    best = (0, -1, -1)
    start = None
    for i, v in enumerate(mask):
        if v:
            if start is None:
                start = i
            if i - start + 1 > best[0]:
                best = (i - start + 1, start, i)
        else:
            start = None
    return best


def _value_area(tot):
    """Área de valor del 70% que crece de a un nivel, sumando el vecino mayor."""
    poc = int(np.argmax(tot))
    target = 0.7 * tot.sum()
    lo = hi = poc
    acc = tot[poc]
    n = len(tot)
    while acc < target and (lo > 0 or hi < n - 1):
        up = tot[hi + 1] if hi < n - 1 else -1.0
        dn = tot[lo - 1] if lo > 0 else -1.0
        if up >= dn:
            hi += 1
            acc += tot[hi]
        else:
            lo -= 1
            acc += tot[lo]
    return poc, lo, hi


def bar_facts(ask, bid, o, c):
    """
    Hechos de una vela que no dependen de umbrales. ask y bid van de menor a mayor precio.
    Devuelve los índices en orientación de la vela (0 = extremo donde empieza el movimiento).
    """
    n = len(ask)
    tot = ask + bid
    nz = tot > 0
    col = 1 if c > o else (-1 if c < o else 0)
    poc, vlo, vhi = _value_area(tot)
    f = {"col": col, "n": n, "poc": poc, "val": vlo, "vah": vhi,
         "vol": float(tot.sum()), "delta": float(ask.sum() - bid.sum())}
    if col == 0 or n < 3:
        return f
    A, P = (ask, bid) if col > 0 else (bid[::-1], ask[::-1])
    meanlv = float(tot[nz].mean())
    totO = A + P
    f.update(A=A, P=P, meanlv=meanlv)
    f["exh"] = P[0] / meanlv if P[0] > 0 else None
    # Motor 8: el Exhaustion Print y el Volume Decline miran el extremo hacia donde fue el precio (ver _turn_side). La
    # compra en el máximo y la venta en el mínimo, en orden de precio
    f["exh_high"] = ask[-1] / meanlv if ask[-1] > 0 else None
    f["exh_low"] = bid[0] / meanlv if bid[0] > 0 else None
    f["decline_high"] = bool(n >= 5 and ask[-3] > ask[-2] > ask[-1])
    f["decline_low"] = bool(n >= 5 and bid[2] > bid[1] > bid[0])
    f["zero"] = bool(P[0] == 0 or P[1] == 0)
    dl = A - P
    # La regla de antes del motor 8 (el Delta Tail la reemplazó por _tail); la leen las mediciones de la galería 4
    f["tail"] = bool(dl[0] < 0 and np.all(dl[1:][totO[1:] > 0] > 0))
    f["suck"] = P[0] / meanlv if n >= 5 and P[0] > P[1] > P[2] else None
    # Motor 8: en cada nivel de la secuencia el agresor crece, le gana al lado contrario y tiene algo de volumen. Antes
    # contaba niveles de milésimas y niveles donde ganaba el otro lado (galería 4, casos 1, 1044 y 1566)
    k = 0
    while k < n and A[k] > P[k] and A[k] >= MIN_IMB * meanlv and (k == 0 or A[k] > A[k - 1]):
        k += 1
    f["seq"] = k
    inner = (P[1:n - 1] <= SWEEP_PASSIVE * meanlv) & (A[1:n - 1] > 0)
    run = _run(inner)
    f["sweep"] = (run[0], run[1] + 1, run[2] + 1) if run[0] else (0, -1, -1)
    opp = np.zeros(n, bool)
    opp[:-1] = (P[:-1] >= RATIO * A[1:]) & (P[:-1] > 0) & (P[:-1] >= MIN_IMB * meanlv)
    run = _run(opp[n // 2:])
    f["inverse"] = (run[0], run[1] + n // 2, run[2] + n // 2) if run[0] else (0, -1, -1)
    imb = np.zeros(n, bool)
    imb[1:] = (A[1:] >= RATIO * P[:-1]) & (A[1:] > 0) & (A[1:] >= MIN_IMB * meanlv)
    run = _run(imb)
    f["stacked"] = run
    f["imb_count"] = int(imb.sum())
    f["imb_rows"] = [int(i) for i in np.nonzero(imb)[0]]
    f["reversal_rows"] = [i for i in (0, 1) if opp[i]]
    f["decline"] = bool(n >= 5 and P[2] > P[1] > P[0])
    f["thin_rows"] = [int(i) + 1 for i in np.nonzero((P[1:n - 1] == 0) & (A[1:n - 1] > 0))[0]]
    f["ratio"] = bool(P[0] > 0 and (P[1] / P[0] < 0.7 or P[1] / P[0] > 30))
    ip, ia = int(np.argmax(P)), int(np.argmax(A))
    f["accdist"] = (P[ip] / meanlv, ip) if P[ip] >= A[ia] and ip <= (n - 1) / 3 else None
    return f


def _day_key(minute):
    return dt.datetime.fromtimestamp(minute * 60, dt.timezone.utc).date()


def _load_bars(symbol, tf, day, known_min, live=False):
    """Velas cerradas de un día, con sus hechos. Un día completo se guarda en caché.

    live=True: si falta el día oficial, se lee el de la nube y el PC (footprint_store con live), con el flujo
    de live/flow. Ahí no cuentan las velas que tocan un hueco de la grabación ni las que pasan del último
    guardado. El día oficial siempre manda. Con live=False (App 1) todo queda como antes.
    """
    day_start = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp()) // 60
    complete = day_start + 1440 <= known_min
    key = (symbol, tf, day.isoformat())
    flow_path = _flow_path(symbol, day)
    if complete:
        with _lock:
            cached = _cache.get(key)
        # Un día calculado antes de armar su flujo se recalcula cuando el flujo aparece
        if cached is not None and (cached[1] or not flow_path.exists()) and                 (not live or cached[0] or fs._day_path(symbol, day.isoformat()).exists()):
            with _lock:
                _cache.move_to_end(key)
            return cached[0]
    data = fs._load_day(symbol, day.isoformat(), live) if live else fs._load_day(symbol, day.isoformat())
    if data is not None and data.get("_live"):
        return _load_live_bars(symbol, tf, day, day_start, known_min, data, key)
    if live and data is None:
        return []  # Ni oficial ni de la nube: no se guarda, el día puede aparecer después
    flow = _load_flow(symbol, day)
    if data is None:
        result = []
    else:
        result = _compute_day(data, tf, min(known_min, day_start + 1440), flow)
    if complete:
        with _lock:
            _cache[key] = (result, flow is not None)
            while len(_cache) > MAX_CACHED_DAYS:
                _cache.popitem(last=False)
    return result


def _live_flow_path(symbol, day):
    root = LIVE_FLOW_DIR if LIVE_FLOW_DIR is not None else fs.LIVE_DIR.parent / "flow"
    return root / symbol / day.isoformat()[:4] / f"{symbol}_{day.isoformat()}.npz"


def _load_live_bars(symbol, tf, day, day_start, known_min, data, key):
    """Día de la nube y el PC: cambia con cada sincronización, así que el caché se valida con sus archivos."""
    path = _live_flow_path(symbol, day)
    try:
        flow_mtime = path.stat().st_mtime
    except OSError:
        flow_mtime = None
    until = data.get("_until")
    cut = min(known_min, day_start + 1440)
    if until is not None:
        cut = min(cut, until // 60000)  # la vela que pasa del último guardado aún no está completa
    stamp = (data.get("_mtime"), flow_mtime, cut)
    live_key = key + ("live",)
    with _lock:
        cached = _cache.get(live_key)
        if cached is not None and cached[2] == stamp:
            _cache.move_to_end(live_key)
            return cached[0]
    flow = None
    if flow_mtime is not None:
        with np.load(path) as z:
            flow = {name: z[name] for name in z.files}
    gaps = [(a // 60000, -(-b // 60000)) for a, b in data.get("_gaps") or []]
    result = _compute_day(data, tf, cut, flow, gaps)
    with _lock:
        _cache[live_key] = (result, flow is not None, stamp)
        while len(_cache) > MAX_CACHED_DAYS:
            _cache.popitem(last=False)
    return result


def _flow_path(symbol, day):
    """Flujo de un dia: el de acciones (OrderFlowData/alpaca/flow, alpaca_store.py) o el de las monedas."""
    root = ALPACA_FLOW_DIR if fs.is_stock(symbol) else FLOW_DIR
    return root / symbol / day.isoformat()[:4] / f"{symbol}_{day.isoformat()}.npz"


def _load_flow(symbol, day):
    """Delta dentro de cada minuto y órdenes agresivas del día, o None si no se armó."""
    path = _flow_path(symbol, day)
    if not path.exists():
        return None
    with np.load(path) as z:
        return {name: z[name] for name in z.files}


def _flow_facts(flow, f, t0_min, tf, delta_minutes):
    """Max/Min Delta exacto de la vela y su mejor barrido y orden grande, solo con minutos cerrados."""
    ps, qs, orders_ok = int(flow["info"][0]), int(flow["info"][1]), bool(flow["info"][2])
    a, e = np.searchsorted(flow["m"], [t0_min, t0_min + tf])
    if e <= a or e - a != len(delta_minutes):
        return
    before = np.r_[0.0, np.cumsum(delta_minutes)[:-1]]
    f["xmaxd"] = max(0.0, float(np.max(before + flow["dmx"][a:e] / qs)))
    f["xmind"] = min(0.0, float(np.min(before + flow["dmn"][a:e] / qs)))
    f["orders_ok"] = orders_ok
    if not orders_ok:
        return
    lo, hi = np.searchsorted(flow["ot"], [t0_min * 60000, (t0_min + tf) * 60000])
    if hi <= lo:
        return
    usd = flow["oq"][lo:hi] / qs * (flow["op0"][lo:hi] + flow["op1"][lo:hi]) / 2 / ps
    sweeps = np.nonzero(flow["on"][lo:hi] >= 3)[0]
    if len(sweeps):
        k = sweeps[np.argmax(usd[sweeps])]
        f["sweep_real"] = (float(usd[k]), int(flow["os"][lo + k]), flow["op0"][lo + k] / ps, flow["op1"][lo + k] / ps,
                           int(flow["on"][lo + k]))
    k = int(np.argmax(usd))
    f["big"] = (float(usd[k]), int(flow["os"][lo + k]), flow["op0"][lo + k] / ps, flow["op1"][lo + k] / ps)


def _compute_day(data, tf, known_min, flow=None, gaps=None):
    """gaps: huecos de grabación en minutos [(inicio, fin)]; una vela que toca uno se omite (volumen incompleto)."""
    ps, qs, ticks = (int(x) for x in data["info"])
    m = data["m"]
    keep = m < known_min
    if not keep.any():
        return []
    step = analysis_step(float(data["o"][0]) / ps, tf, ticks / ps)
    st = max(ticks, int(round(step * ps / ticks)) * ticks)
    lev = data["cl"] * ticks // st
    bar = m // tf
    bars = []
    starts = np.r_[0, np.nonzero(np.diff(bar))[0] + 1]
    ends = np.r_[starts[1:], len(m)]
    md = (data["buy"].astype(float) - data["sell"].astype(float)) / qs
    for a, e in zip(starts, ends):
        t0 = int(bar[a]) * tf
        if t0 + tf > known_min:
            continue
        if gaps and any(ga < t0 + tf and gb > t0 for ga, gb in gaps):
            continue
        ca, ce = np.searchsorted(data["cr"], [a, e])
        if ce <= ca:
            continue
        lv = lev[ca:ce]
        lo = int(lv.min())
        n = int(lv.max()) - lo + 1
        ask = np.bincount(lv - lo, weights=data["cb"][ca:ce] / qs, minlength=n)
        bid = np.bincount(lv - lo, weights=data["cs"][ca:ce] / qs, minlength=n)
        o = float(data["o"][a]) / ps
        c = float(data["c"][e - 1]) / ps
        f = bar_facts(ask, bid, o, c)
        cum = np.cumsum(md[a:e])
        f.update(t=t0 * 60000, o=o, c=c, h=float(data["h"][a:e].max()) / ps, l=float(data["l"][a:e].min()) / ps,
                 lo=lo, step=st / ps, maxd=max(0.0, float(cum.max())), mind=min(0.0, float(cum.min())))
        if flow is not None and np.array_equal(flow["m"][np.searchsorted(flow["m"], m[a]):][:e - a], m[a:e]):
            _flow_facts(flow, f, t0, tf, md[a:e])
        bars.append(f)
    return bars


def _row_price(f, i):
    """Precio bajo y alto del nivel i en orientación de la vela."""
    level = f["lo"] + i if f["col"] > 0 else f["lo"] + f["n"] - 1 - i
    return level * f["step"], (level + 1) * f["step"]


def _rows_price(f, i0, i1):
    a, b = _row_price(f, i0), _row_price(f, i1)
    return min(a[0], b[0]), max(a[1], b[1])


def _kth_largest(values, share):
    """Valor que deja `share` de las velas de la ventana por encima o igual; None sin historia."""
    total = len(values)
    vals = np.array([v for v in values if v is not None and not (isinstance(v, float) and math.isnan(v))], float)
    k = int(share * total)
    if total < MIN_WINDOW_BARS or k < 1:
        return None
    if len(vals) <= k:
        return -math.inf
    return float(np.partition(vals, len(vals) - k)[len(vals) - k])


def _vertical_run(f, thr):
    """Racha de niveles con el agresor en el 10% mayor de 30 días. Motor 8: en cada nivel el agresor le gana al lado
    contrario (galería 4, caso 3072: la mitad de los niveles estaban parejos)."""
    if "A" not in f or thr is None:
        return (0, -1, -1)
    return _run((f["A"] >= thr) & (f["A"] > f["P"]))


def _edge_rows(f, top, count):
    """Las `count` filas del máximo (top) o del mínimo de la vela, como índices en su orientación."""
    n = f["n"]
    upper = f["col"] > 0  # En una verde el índice crece con el precio
    if top == upper:
        return n - count, n - 1
    return 0, count - 1


def _turn_side(f, hi5, lo5):
    """
    Motor 8 (galería 4, decidido por el usuario): el Exhaustion Print y el Volume Decline miran el extremo hacia donde
    fue el precio. Si la vela hace el máximo de 5 velas, miran arriba (los compradores se agotan: bajista); si hace el
    mínimo, abajo (los vendedores se agotan: alcista); si no hace ninguno, o los dos, el extremo donde empieza la vela,
    como antes. Antes miraban siempre el inicio: en una vela verde que hacía el máximo, su mínimo (casos 623 y 1037).
    Devuelve (lado, valor del Exhaustion Print, hay Volume Decline, top): top dice qué extremo, None = el del inicio.
    """
    if hi5 and not lo5:
        return -1, f["exh_high"], f["decline_high"], True
    if lo5 and not hi5:
        return 1, f["exh_low"], f["decline_low"], False
    return f["col"], f["exh"], f["decline"], None


def _tail(f):
    """
    Delta Tail del motor 8 (la opción B de la galería 4, elegida por el usuario): la mecha donde empieza la vela ocupa al
    menos la mitad de su rango, el cuerpo va con delta a favor del color y la mecha con delta en contra, en su celda del
    extremo (desde el 10% del nivel medio) o sumada entera. Antes pedía solo la celda del extremo en contra y todas las
    demás a favor, sin mecha (casos 29, 43 y 127). Devuelve cuántas filas tiene la mecha, o None.
    """
    rng = f["h"] - f["l"]
    if "A" not in f or rng <= 0:
        return None
    wick = (min(f["o"], f["c"]) - f["l"]) if f["col"] > 0 else (f["h"] - max(f["o"], f["c"]))
    if wick < DT_WICK * rng:
        return None
    dl = f["A"] - f["P"]
    w = min(f["n"], max(1, int(round(wick / f["step"]))))
    if float(dl[w:].sum()) <= 0:
        return None
    if -dl[0] >= DT_CELL * f["meanlv"] or float(dl[:w].sum()) < 0:
        return w
    return None


def _attempt(f, thr, side):
    """
    Intento contra un nivel, para la absorción del motor 8: la celda de la vela con más volumen agresivo de ese lado,
    desde `thr` (el 5% mayor de las celdas de 30 días), que queda del otro lado de su cierre. side 1: llegó desde abajo
    con mucha compra y cerró debajo de la celda; -1: desde arriba con mucha venta y cerró encima. (bajo, alto, volumen)
    o None.
    """
    if "A" not in f or thr is None:
        return None
    bid, ask = (f["P"], f["A"]) if f["col"] > 0 else (f["A"][::-1], f["P"][::-1])
    cells = ask if side > 0 else bid
    lows = (f["lo"] + np.arange(f["n"])) * f["step"]
    ok = (cells >= thr) & ((lows >= f["c"] - 1e-9) if side > 0 else (lows + f["step"] <= f["c"] + 1e-9))
    if not ok.any():
        return None
    j = int(np.flatnonzero(ok)[np.argmax(cells[ok])])
    return round(float(lows[j]), 10), round(float(lows[j] + f["step"]), 10), float(cells[j])


def _absorptions(bars, first, last, threshold_of, absorb_bars, tf):
    """
    Absorción del motor 8 (la idea del usuario en la galería 4): una barrera que aguanta varios intentos, y la señal en
    contra de ellos. Una vela es señal si intenta en un nivel (_attempt) donde ya hubo otro intento del mismo lado, a una
    celda o menos, en las `absorb_bars` velas anteriores, y ninguna vela entre los dos cerró más allá del nivel. Cada
    intento más en ese nivel vuelve a dar la señal. Solo mira velas ya cerradas: la señal se conoce al cerrar el intento.
    Devuelve {índice de la vela: [(lado de la señal, bajo, alto, volumen, umbral, hora del primer intento)]} para las
    velas de first a last.
    """
    span = absorb_bars * tf * 60000
    tries = {}  # índice -> {lado: (bajo, alto, volumen)}
    start = first
    while start > 0 and bars[first]["t"] - bars[start - 1]["t"] <= span:
        start -= 1
    out = {}
    oldest = start  # La primera vela que todavía cabe en la ventana de la vela i
    for i in range(start, last + 1):
        f = bars[i]
        thr = threshold_of(f)
        found = {side: _attempt(f, thr, side) for side in (1, -1)}
        tries[i] = found
        while f["t"] - bars[oldest]["t"] > span:
            tries.pop(oldest, None)
            oldest += 1
        if i < first:
            continue
        for side, cell in found.items():
            if cell is None:
                continue
            for j in range(oldest, i):
                prev = tries.get(j, {}).get(side)
                if prev is None or abs(prev[0] - cell[0]) > max(f["step"], bars[j]["step"]) + 1e-9:
                    continue
                lo, hi = min(prev[0], cell[0]), max(prev[1], cell[1])
                between = bars[j + 1:i]
                if any((b["c"] > hi + 1e-9) if side > 0 else (b["c"] < lo - 1e-9) for b in between):
                    continue
                out.setdefault(i, []).append((-side, lo, hi, cell[2], thr, bars[j]["t"]))
                break
    return out


def _thresholds(window, target, absorb_pct=ABSORB_CELL_PCT):
    """Umbrales relativos con las velas de los 30 días anteriores."""
    if len(window) < MIN_WINDOW_BARS:
        return None
    aggr = np.concatenate([f["A"][f["A"] > 0] for f in window if "A" in f] or [np.zeros(0)])
    # Las celdas de los dos lados, para la absorción del motor 8: cualquiera de los dos puede chocar con un nivel
    cells = np.concatenate([np.concatenate([f["A"][f["A"] > 0], f["P"][f["P"] > 0]]) for f in window if "A" in f] or [np.zeros(0)])
    vert_cell = float(np.percentile(aggr, 90)) if len(aggr) else None
    absorb_cell = float(np.percentile(cells, absorb_pct)) if len(cells) else None
    vols = np.array([f["vol"] for f in window])
    medvol = float(np.median(vols)) if len(vols) else None
    thr = {"vert_cell": vert_cell, "absorb_cell": absorb_cell, "medvol": medvol}
    thr["DV"] = _kth_largest([f["col"] * f["delta"] / f["vol"] if f["vol"] > 0 else None for f in window], target)
    thr["PD"] = _kth_largest([abs(f["delta"]) / f["vol"] if f["col"] * f["delta"] < 0 and f["vol"] > 0 else None for f in window], target)
    # Motor 8: con el valor del extremo que mira cada vela (_turn_side; detect lo deja en "ex_value")
    thr["EX"] = _kth_largest([-f["ex_value"] if f.get("ex_value") is not None else None for f in window], target)
    thr["RS"] = _kth_largest([f.get("suck") for f in window], target)
    thr["SQ"] = _kth_largest([f["seq"] if "seq" in f else None for f in window], target)
    thr["SW"] = _kth_largest([f["sweep"][0] if "sweep" in f else None for f in window], target)
    thr["VL"] = _kth_largest([_vertical_run(f, vert_cell)[0] if "A" in f else None for f in window], target)
    thr["AD"] = _kth_largest([f["accdist"][0] if f.get("accdist") else None for f in window], target)
    jumps, gaps = [], []
    atr = _atr(window)
    for i, f in enumerate(window):
        p = window[i - 1] if i else None
        jumps.append(_jump(f, p) / medvol if p and medvol and _jump(f, p) is not None else None)
        g = _gap(f, p)
        gaps.append(g[2] / atr[i] if g and atr[i] > 0 else None)
    thr["DB"] = _kth_largest(jumps, target)
    thr["OG"] = _kth_largest(gaps, target)
    # Con flujo: solo cuentan las velas que lo tienen, para no bajar el umbral con días sin datos
    exact = [f for f in window if "xmaxd" in f and f["vol"] > 0]
    thr["XD"] = _kth_largest([_extreme(f) for f in exact], target)
    thr["SM"] = _kth_largest([-_small(f) if _small(f) is not None else None for f in exact], target)
    with_orders = [f for f in window if f.get("orders_ok")]
    thr["BR"] = _kth_largest([f["sweep_real"][0] if "sweep_real" in f else None for f in with_orders], target)
    thr["GR"] = _kth_largest([f["big"][0] if "big" in f else None for f in with_orders], target)
    return thr


def _extreme(f):
    """|Δ/Vol| de una vela cuyo delta cierra en 95% o más de su máximo o mínimo exacto; None si no."""
    d = f["delta"]
    if (d > 0 and d >= EXTREME_SHARE * f["xmaxd"]) or (d < 0 and d <= EXTREME_SHARE * f["xmind"]):
        return abs(d) / f["vol"]
    return None


def _small(f):
    """Parte del volumen que alcanzó el lado contrario al color: Mín Δ en una verde, Máx Δ en una roja."""
    if f["col"] > 0:
        return -f["xmind"] / f["vol"]
    if f["col"] < 0:
        return f["xmaxd"] / f["vol"]
    return None


def _contiguous(f, p, tf):
    return p is not None and f["t"] - p["t"] == tf * 60000


def _jump(f, p):
    """Salto de delta entre dos velas seguidas del mismo color, con delta del signo de su color."""
    if p is None or f["col"] == 0 or f["col"] != p["col"] or f["delta"] * f["col"] <= 0 or p["delta"] * f["col"] <= 0:
        return None
    if f["t"] - p["t"] > 4 * 3600000:
        return None
    return (f["delta"] - p["delta"]) * f["col"]


def _price_va(f):
    # Sin el ruido de coma flotante: 1.3754000000000002 en vez de 1.3754 dejaba salir una VA bajista con la vela
    # siguiente tocando el VAL (F-14 del protocolo de pruebas, 22/11/2026)
    return (round(f["lo"] * f["step"] + f["val"] * f["step"], 10),
            round(f["lo"] * f["step"] + (f["vah"] + 1) * f["step"], 10))


def _poc_price(f):
    return round((f["lo"] + f["poc"]) * f["step"], 10), round((f["lo"] + f["poc"] + 1) * f["step"], 10)


def _gap(f, p):
    """Hueco entre las áreas de valor de dos velas seguidas: (lado, (bajo, alto), tamaño)."""
    if p is None or f["t"] - p["t"] > 4 * 3600000:
        return None
    fl, fh = _price_va(f)
    pl, ph = _price_va(p)
    if fl > ph:
        return (1, (ph, fl), fl - ph)
    if fh < pl:
        return (-1, (fh, pl), pl - fh)
    return None


def _atr(bars, period=14):
    out = []
    trs = []
    for i, f in enumerate(bars):
        pc = bars[i - 1]["c"] if i else f["c"]
        trs.append(max(f["h"] - f["l"], abs(f["h"] - pc), abs(f["l"] - pc)))
        w = trs[-period:]
        out.append(sum(w) / len(w))
    return out


def _accdist_row(f):
    """La fila de la Acumulación/Distribución, si en ella el lado pasivo es al menos AD_RATIO veces el agresor (motor 8,
    galería 4, caso 2332: 1.6 veces); None si no. El umbral relativo sigue saliendo de todas las candidatas."""
    if not f.get("accdist"):
        return None
    row = f["accdist"][1]
    return row if f["P"][row] >= AD_RATIO * f["A"][row] else None


def _closes_toward(f):
    """Motor 8, Inverse Imbalance: la vela cierra en la mitad de su rango hacia su color (galería 4, caso 2134: una verde
    con 84% de mecha arriba que cerró al 16% de su rango)."""
    rng = f["h"] - f["l"]
    position = (f["c"] - f["l"]) / rng if rng > 0 else 0.5
    return position >= 0.5 if f["col"] > 0 else position <= 0.5


def detect(symbol, interval_minutes, start_ms, end_ms, known_until_ms, target=DEFAULT_TARGET, band_days=3,
           vol_filter=DEFAULT_VOL_FILTER, live=False, absorb_bars=ABSORB_BARS, overrides=None):
    """
    Elementos de las velas que empiezan entre start_ms y end_ms, y franjas nacidas hasta band_days
    antes. Solo velas cerradas antes de known_until_ms. Devuelve eventos y la tabla de cada vela.
    vol_filter: volumen mínimo de la vela, en veces la mediana de las 20 anteriores, para los
    elementos de VOLUME_FILTERED. 0 los muestra en todas las velas.
    live: también los días de la nube y el PC donde falta el oficial (lo usa la app en tiempo real).
    absorb_bars: velas en que puede llegar el segundo intento de la absorción (RL), de 1 a ABSORB_MAX_BARS.
    overrides: valores propios de un elemento, {código: {campo: valor}} (OWN_FIELDS). Lo que no trae va con los
    generales (target, vol_filter, absorb_bars) y con sus mínimos de fábrica; sin él, todo es como siempre.
    """
    over = clean_overrides(overrides)
    own = lambda code, field, default: over.get(code, {}).get(field, default)
    tf = int(interval_minutes)
    target = min(0.3, max(0.005, float(target)))
    vol_filter = min(10.0, max(0.0, float(vol_filter)))
    absorb_bars = int(min(ABSORB_MAX_BARS, max(1, round(float(absorb_bars)))))
    known_min = (known_until_ms if known_until_ms is not None else end_ms) // 60000
    end_ms = min(end_ms, known_min * 60000)
    if end_ms - start_ms > MAX_RANGE_DAYS * DAY_MS:
        start_ms = end_ms - MAX_RANGE_DAYS * DAY_MS
    first_day = _day_key(start_ms // 60000 - band_days * 1440)
    last_day = _day_key(max(start_ms, end_ms - 1) // 60000)
    load_from = first_day - dt.timedelta(days=WINDOW_DAYS)

    days, bars = [], []
    day = load_from
    while day <= last_day:
        for f in (_load_bars(symbol, tf, day, known_min, True) if live else _load_bars(symbol, tf, day, known_min)):
            f = dict(f)
            f["_day"] = day
            bars.append(f)
        days.append(day)
        day += dt.timedelta(days=1)
    result = {"events": [], "bars": [], "known_until": known_min * 60000, "warming": False, "step": None}
    if not bars:
        return result

    atr = _atr(bars)
    day_index = {}
    for i, f in enumerate(bars):
        day_index.setdefault(f["_day"], []).append(i)
        if "A" in f:
            # El extremo de 5 velas (con la vela), para el Exhaustion Print y el Volume Decline del motor 8 (_turn_side)
            near = bars[max(0, i - SWING_BARS + 1):i + 1]
            f["ex_side"], f["ex_value"], f["vd_on"], f["turn_top"] = _turn_side(
                f, f["h"] >= max(b["h"] for b in near), f["l"] <= min(b["l"] for b in near))
    thresholds = {}
    band_from = start_ms - band_days * DAY_MS
    cum, cum_day = 0.0, None
    events = result["events"]

    windows = {}

    def day_thresholds(d, share=None, absorb_pct=ABSORB_CELL_PCT):
        """Los umbrales de un día. share: otra parte de las velas que la general, para un elemento con `target` propio."""
        key = (d, target if share is None else share, absorb_pct)
        if key not in thresholds:
            if d not in windows:
                window = [bars[j] for k in range(1, WINDOW_DAYS + 1) for j in day_index.get(d - dt.timedelta(days=k), [])]
                window.sort(key=lambda x: x["t"])
                windows[d] = window
            thresholds[key] = _thresholds(windows[d], key[1], absorb_pct)
        return thresholds[key]

    # La absorción mira los intentos de las velas anteriores, también las de antes del tramo pedido: así da lo mismo
    # pedir la fase entera o por tramos
    first = next((i for i, f in enumerate(bars) if f["t"] >= band_from), len(bars))
    last = max((i for i, f in enumerate(bars) if f["t"] <= end_ms), default=-1)
    absorb_pct = 100 - 100 * own("RL", "cell", 1 - ABSORB_CELL_PCT / 100) if "cell" in over.get("RL", {}) else ABSORB_CELL_PCT
    absorbs = _absorptions(bars, first, last, lambda f: (day_thresholds(f["_day"], None, absorb_pct) or {}).get("absorb_cell"),
                           int(own("RL", "absorb", absorb_bars)), tf) if first <= last else {}

    for i, f in enumerate(bars):
        if f["t"] < band_from or f["t"] > end_ms:
            continue
        d = f["_day"]
        thr = day_thresholds(d)
        if thr is None:
            result["warming"] = True

        def limit(code):
            """El umbral relativo de un elemento: el general, o el de su propia parte de las velas."""
            share = over.get(code, {}).get("target")
            return thr[code] if share is None else day_thresholds(d, share)[code]
        p = bars[i - 1] if i else None
        p = p if _contiguous(f, p, tf) else None
        in_range = f["t"] >= start_ms
        known = f["t"] + tf * 60000
        col = f["col"]

        def add(code, direction, lo, hi, value=None, threshold=None, t0=None, known_at=None):
            name, shape, _, _ = CATALOG[code]
            if shape != "band" and not in_range:
                return
            events.append({"code": code, "dir": int(direction), "t": f["t"], "t0": t0 if t0 is not None else f["t"],
                           "known": known_at or known, "lo": round(lo, 8), "hi": round(hi, 8),
                           "value": None if value is None else round(float(value), 6),
                           "thr": None if threshold is None or not math.isfinite(threshold) else round(float(threshold), 6)})

        if in_range:
            if d != cum_day:
                cum_day, cum = d, sum(bars[j]["delta"] for j in day_index[d] if bars[j]["t"] < f["t"])
            cum += f["delta"]
            result["bars"].append({"t": f["t"], "o": f["o"], "h": f["h"], "l": f["l"], "c": f["c"],
                                   "delta": round(f["delta"], 6), "vol": round(f["vol"], 6),
                                   "dv": round(f["delta"] / f["vol"], 6) if f["vol"] > 0 else 0.0,
                                   "cum": round(cum, 6), "step": f["step"],
                                   "maxd": round(f["xmaxd"], 6) if "xmaxd" in f else None,
                                   "mind": round(f["xmind"], 6) if "xmind" in f else None})
            result["step"] = f["step"]

        # Entre velas, sin umbral
        if p is not None and col != 0 and f["poc"] + f["lo"] == p["poc"] + p["lo"] and f["step"] == p["step"]:
            add("AP", col, *_poc_price(f))
        if p is not None and col != 0 and col == p["col"] and f["step"] == p["step"] and \
                col * ((f["lo"] + f["poc"]) - (p["lo"] + p["poc"])) < 0:
            add("SL", col, *_poc_price(f))
        q = bars[i - 2] if i >= 2 else None
        if p is not None and q is not None and _contiguous(p, q, tf) and f["step"] == p["step"] == q["step"]:
            pf, pp, pq = f["lo"] + f["poc"], p["lo"] + p["poc"], q["lo"] + q["poc"]
            if (q["col"] < 0 < p["col"] and col > 0 and pp < pq < pf) or (q["col"] > 0 > p["col"] and col < 0 and pp > pq > pf):
                add("PW", col, min(x["l"] for x in (f, p, q)), max(x["h"] for x in (f, p, q)), t0=q["t"])
        lows = [bars[j]["l"] for j in range(max(0, i - SWING_BARS + 1), i + 1)]
        highs = [bars[j]["h"] for j in range(max(0, i - SWING_BARS + 1), i + 1)]
        if "A" in f:
            # Motor 8: una vela que hace el máximo y el mínimo de 5 velas a la vez (envuelve a las anteriores) no cuenta
            # (galería 4, caso 1533: la app la tomaba por el mínimo)
            outside = f["l"] <= min(lows) and f["h"] >= max(highs)
            if col > 0 and f["l"] <= min(lows) and f["delta"] > 0 and not outside:
                add("DD", 1, *_rows_price(f, 0, min(1, f["n"] - 1)))
            if col < 0 and f["h"] >= max(highs) and f["delta"] < 0 and not outside:
                add("DD", -1, *_rows_price(f, 0, min(1, f["n"] - 1)))
            if f["zero"]:
                add("ZP", col, *_rows_price(f, 0, 1))
            tail = _tail(f)
            if tail is not None:
                add("DT", col, *_rows_price(f, 0, tail - 1))
            if f["inverse"][0] >= own("IV", "min", INVERSE_MIN) and _closes_toward(f):
                add("IV", col, *_rows_price(f, f["inverse"][1], f["inverse"][2]))
        for side, lo, hi, volume, cell_thr, first_try in absorbs.get(i, []):
            add("RL", side, lo, hi, volume, cell_thr, t0=first_try)
        nxt = bars[i + 1] if i + 1 < len(bars) else None
        if nxt is not None and _contiguous(nxt, f, tf):
            vl, vh = _price_va(f)
            if nxt["l"] > vh:
                add("VA", 1, vl, vh, known_at=nxt["t"] + tf * 60000)
            elif nxt["h"] < vl:
                add("VA", -1, vl, vh, known_at=nxt["t"] + tf * 60000)

        # Con filtro de volumen: la vela contra la mediana de las 20 anteriores
        if "A" in f and i >= VOLUME_BARS:
            median = float(np.median([bars[j]["vol"] for j in range(i - VOLUME_BARS, i)]))
            rel = f["vol"] / median if median > 0 else 0.0
            heavy = lambda code: rel >= own(code, "vol", vol_filter)   # Cada uno con su filtro de volumen, si lo trae
            if True:
                if heavy("ST") and f["stacked"][0] >= own("ST", "min", CATALOG["ST"][3]):
                    add("ST", col, *_rows_price(f, f["stacked"][1], f["stacked"][2]), rel)
                if heavy("VI") and f["imb_count"] >= own("VI", "min", CATALOG["VI"][3]):
                    add("VI", col, f["l"], f["h"], f["imb_count"])
                if heavy("IR") and f["reversal_rows"]:
                    add("IR", col, *_rows_price(f, 0, 1), rel)
                if heavy("RD") and p is not None and p.get("col") == col and p["step"] == f["step"] and "imb_rows" in p:
                    mine = {_row_price(f, k) for k in f["imb_rows"]}
                    # Motor 8: una franja por celda compartida; antes iba de la primera a la última y tomaba celdas que
                    # las dos velas no comparten (galería 4, casos 593 y 2072). El probador junta las de la vela: su
                    # zona y sus señales no cambian
                    for lo_s, hi_s in sorted(mine & {_row_price(p, k) for k in p["imb_rows"]}):
                        add("RD", col, lo_s, hi_s, rel)
                if heavy("VD") and f["vd_on"]:
                    rows = (0, 2) if f["turn_top"] is None else _edge_rows(f, f["turn_top"], 3)
                    add("VD", f["ex_side"], *_rows_price(f, *rows), rel)
                for k in (f["thin_rows"][:MAX_THIN_ROWS] if heavy("TP") else ()):
                    add("TP", col, *_row_price(f, k), rel)
                if heavy("RX") and f["ratio"]:
                    add("RX", col, *_rows_price(f, 0, 1), rel)
                poc_bars = int(own("OP", "bars", OPEN_POC_BARS))
                prev = bars[max(0, i - poc_bars):i]
                if heavy("OP") and len(prev) == poc_bars and atr[i] > 0:
                    lo_p, hi_p = _poc_price(f)
                    margin = own("OP", "margin", OPEN_POC_ATR) * atr[i]
                    if lo_p > max(x["h"] for x in prev) + margin:
                        add("OP", 1, lo_p, hi_p, rel)
                    elif hi_p < min(x["l"] for x in prev) - margin:
                        add("OP", -1, lo_p, hi_p, rel)

        if thr is None:
            continue
        # Con umbral relativo
        # (limit(código): el umbral general o, si el elemento trae su propia parte de las velas, el suyo)
        if f["vol"] > 0 and col != 0 and limit("DV") is not None and col * f["delta"] / f["vol"] >= limit("DV"):
            add("DV", col, f["l"], f["h"], col * f["delta"] / f["vol"], limit("DV"))
        if f["vol"] > 0 and col * f["delta"] < 0 and limit("PD") is not None and abs(f["delta"]) / f["vol"] >= limit("PD") and "A" in f:
            add("PD", col, *_rows_price(f, 0, 1), abs(f["delta"]) / f["vol"], limit("PD"))
        jump = _jump(f, p)
        if jump is not None and thr["medvol"] and limit("DB") is not None and jump / thr["medvol"] >= limit("DB"):
            add("DB", col, min(f["l"], p["l"]), max(f["h"], p["h"]), jump / thr["medvol"], limit("DB"), t0=p["t"])
        g = _gap(f, p)
        if g and atr[i] > 0 and limit("OG") is not None and g[2] / atr[i] >= limit("OG"):
            add("OG", g[0], g[1][0], g[1][1], g[2] / atr[i], limit("OG"), t0=p["t"])
        if "xmaxd" in f and f["vol"] > 0:
            value = _extreme(f)
            if value is not None and limit("XD") is not None and value >= limit("XD"):
                add("XD", 1 if f["delta"] > 0 else -1, f["l"], f["h"], value, limit("XD"))
            small = _small(f)
            if small is not None and limit("SM") is not None and -small >= limit("SM"):
                add("SM", col, f["l"], f["h"], small, -limit("SM"))
        if "sweep_real" in f and limit("BR") is not None and f["sweep_real"][0] >= max(limit("BR"), own("BR", "usd", 0.0)):
            usd, side, p0, p1, _ = f["sweep_real"]
            add("BR", side, p0, max(p1, p0 + f["step"]), usd, limit("BR"))
        if "big" in f and limit("GR") is not None and f["big"][0] >= max(limit("GR"), own("GR", "usd", 0.0)):
            usd, side, p0, p1 = f["big"]
            add("GR", side, p0, max(p1, p0 + f["step"]), usd, limit("GR"))
        if "A" not in f:
            continue
        if f["ex_value"] is not None and limit("EX") is not None and -f["ex_value"] >= limit("EX"):
            rows = (0, 0) if f["turn_top"] is None else _edge_rows(f, f["turn_top"], 1)
            add("EX", f["ex_side"], *_rows_price(f, *rows), f["ex_value"], -limit("EX"))
        if f["suck"] is not None and limit("RS") is not None and f["suck"] >= limit("RS"):
            add("RS", col, *_rows_price(f, 0, 2), f["suck"], limit("RS"))
        need = max(own("SQ", "min", CATALOG["SQ"][3]), limit("SQ")) if limit("SQ") is not None else None
        if need is not None and f["seq"] >= need:
            add("SQ", col, *_rows_price(f, 0, f["seq"] - 1), f["seq"], need)
        need = max(own("SW", "min", CATALOG["SW"][3]), limit("SW")) if limit("SW") is not None else None
        if need is not None and f["sweep"][0] >= need:
            add("SW", col, *_rows_price(f, f["sweep"][1], f["sweep"][2]), f["sweep"][0], need)
        run = _vertical_run(f, thr["vert_cell"])
        need = max(own("VL", "min", CATALOG["VL"][3]), limit("VL")) if limit("VL") is not None else None
        if need is not None and run[0] >= need:
            add("VL", col, *_rows_price(f, run[1], run[2]), run[0], need)
        row = _accdist_row(f)
        if row is not None and limit("AD") is not None and f["accdist"][0] >= limit("AD"):
            add("AD", col, *_row_price(f, row), f["accdist"][0], limit("AD"))

    return result
