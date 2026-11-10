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
REST_SHARE = 0.4          # Parte pasiva mínima de un nivel de absorción
SWING_BARS = 5
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
    "RL": ("Absorción (propuesta)", "band", False, None),
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
EXTREME_SHARE = 0.95  # Delta en 95% o más de su máximo o mínimo, como la celda cian o magenta del libro
VOLUME_FILTERED = {"ST", "VI", "IR", "RD", "VD", "TP", "OP", "RX"}
DEFAULT_VOL_FILTER = 2.0
VOLUME_BARS = 20
OPEN_POC_BARS = 5
OPEN_POC_ATR = 0.25  # El POC debe quedar a esta parte del ATR fuera del rango de las 5 velas previas
MAX_THIN_ROWS = 3

_cache = OrderedDict()
_lock = threading.Lock()


def analysis_step(price, interval_minutes, cell):
    """Step fijo del marco: 1, 2 o 5 por potencia de diez, múltiplo de la celda guardada."""
    target = price * fs.STEP_BY_INTERVAL.get(interval_minutes, 0.000125)
    power = 10 ** math.floor(math.log10(target))
    options = [k * p for p in (power / 10, power, power * 10) for k in (1, 2, 5)]
    options = [x for x in options if x >= cell - 1e-12 and abs(x / cell - round(x / cell)) < 1e-6]
    return min(options, key=lambda x: abs(x - target)) if options else cell


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
    f["zero"] = bool(P[0] == 0 or P[1] == 0)
    dl = A - P
    f["tail"] = bool(dl[0] < 0 and np.all(dl[1:][totO[1:] > 0] > 0))
    f["suck"] = P[0] / meanlv if n >= 5 and P[0] > P[1] > P[2] else None
    k = 1
    while k < n and A[k] > A[k - 1]:
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
    f["rest_cells"] = (totO, P)
    return f


def _day_key(minute):
    return dt.datetime.fromtimestamp(minute * 60, dt.timezone.utc).date()


def _load_bars(symbol, tf, day, known_min):
    """Velas cerradas de un día, con sus hechos. Un día completo se guarda en caché."""
    day_start = int(dt.datetime(day.year, day.month, day.day, tzinfo=dt.timezone.utc).timestamp()) // 60
    complete = day_start + 1440 <= known_min
    key = (symbol, tf, day.isoformat())
    if complete:
        with _lock:
            if key in _cache:
                _cache.move_to_end(key)
                return _cache[key]
    data = fs._load_day(symbol, day.isoformat())
    if data is None:
        result = []
    else:
        result = _compute_day(data, tf, min(known_min, day_start + 1440), _load_flow(symbol, day))
    if complete:
        with _lock:
            _cache[key] = result
            while len(_cache) > MAX_CACHED_DAYS:
                _cache.popitem(last=False)
    return result


def _load_flow(symbol, day):
    """Delta dentro de cada minuto y órdenes agresivas del día, o None si no se armó."""
    path = FLOW_DIR / symbol / day.isoformat()[:4] / f"{symbol}_{day.isoformat()}.npz"
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


def _compute_day(data, tf, known_min, flow=None):
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
    if "A" not in f or thr is None:
        return (0, -1, -1)
    return _run(f["A"] >= thr)


def _rest_row(f, thr):
    if "A" not in f or thr is None:
        return None
    totO, P = f["rest_cells"]
    ok = np.nonzero((totO >= thr) & (P >= REST_SHARE * totO))[0]
    return int(ok[np.argmax(totO[ok])]) if len(ok) else None


def _thresholds(window, target):
    """Umbrales relativos con las velas de los 30 días anteriores."""
    if len(window) < MIN_WINDOW_BARS:
        return None
    aggr = np.concatenate([f["A"][f["A"] > 0] for f in window if "A" in f] or [np.zeros(0)])
    totals = np.concatenate([f["rest_cells"][0][f["rest_cells"][0] > 0] for f in window if "A" in f] or [np.zeros(0)])
    vert_cell = float(np.percentile(aggr, 90)) if len(aggr) else None
    rest_cell = float(np.percentile(totals, 99.5)) if len(totals) else None
    vols = np.array([f["vol"] for f in window])
    medvol = float(np.median(vols)) if len(vols) else None
    thr = {"vert_cell": vert_cell, "rest_cell": rest_cell, "medvol": medvol}
    thr["DV"] = _kth_largest([f["col"] * f["delta"] / f["vol"] if f["vol"] > 0 else None for f in window], target)
    thr["PD"] = _kth_largest([abs(f["delta"]) / f["vol"] if f["col"] * f["delta"] < 0 and f["vol"] > 0 else None for f in window], target)
    thr["EX"] = _kth_largest([-f["exh"] if f.get("exh") is not None else None for f in window], target)
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
    return f["lo"] * f["step"] + f["val"] * f["step"], f["lo"] * f["step"] + (f["vah"] + 1) * f["step"]


def _poc_price(f):
    return (f["lo"] + f["poc"]) * f["step"], (f["lo"] + f["poc"] + 1) * f["step"]


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


def detect(symbol, interval_minutes, start_ms, end_ms, known_until_ms, target=DEFAULT_TARGET, band_days=3,
           vol_filter=DEFAULT_VOL_FILTER):
    """
    Elementos de las velas que empiezan entre start_ms y end_ms, y franjas nacidas hasta band_days
    antes. Solo velas cerradas antes de known_until_ms. Devuelve eventos y la tabla de cada vela.
    vol_filter: volumen mínimo de la vela, en veces la mediana de las 20 anteriores, para los
    elementos de VOLUME_FILTERED. 0 los muestra en todas las velas.
    """
    tf = int(interval_minutes)
    target = min(0.3, max(0.005, float(target)))
    vol_filter = min(10.0, max(0.0, float(vol_filter)))
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
        for f in _load_bars(symbol, tf, day, known_min):
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
    thresholds = {}
    band_from = start_ms - band_days * DAY_MS
    cum, cum_day = 0.0, None
    events = result["events"]

    for i, f in enumerate(bars):
        if f["t"] < band_from or f["t"] > end_ms:
            continue
        d = f["_day"]
        if d not in thresholds:
            window = [bars[j] for k in range(1, WINDOW_DAYS + 1) for j in day_index.get(d - dt.timedelta(days=k), [])]
            window.sort(key=lambda x: x["t"])
            thresholds[d] = _thresholds(window, target)
        thr = thresholds[d]
        if thr is None:
            result["warming"] = True
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
            result["bars"].append({"t": f["t"], "delta": round(f["delta"], 6), "vol": round(f["vol"], 6),
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
            if col > 0 and f["l"] <= min(lows) and f["delta"] > 0:
                add("DD", 1, *_rows_price(f, 0, min(1, f["n"] - 1)))
            if col < 0 and f["h"] >= max(highs) and f["delta"] < 0:
                add("DD", -1, *_rows_price(f, 0, min(1, f["n"] - 1)))
            if f["zero"]:
                add("ZP", col, *_rows_price(f, 0, 1))
            if f["tail"]:
                add("DT", col, *_row_price(f, 0))
            if f["inverse"][0] >= 2:
                add("IV", col, *_rows_price(f, f["inverse"][1], f["inverse"][2]))
            row = _rest_row(f, thr["rest_cell"]) if thr else None
            if row is not None:
                add("RL", col, *_row_price(f, row))
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
            if rel >= vol_filter:
                if f["stacked"][0] >= CATALOG["ST"][3]:
                    add("ST", col, *_rows_price(f, f["stacked"][1], f["stacked"][2]), rel)
                if f["imb_count"] >= CATALOG["VI"][3]:
                    add("VI", col, f["l"], f["h"], f["imb_count"])
                if f["reversal_rows"]:
                    add("IR", col, *_rows_price(f, 0, 1), rel)
                if p is not None and p.get("col") == col and p["step"] == f["step"] and "imb_rows" in p:
                    mine = {_row_price(f, k) for k in f["imb_rows"]}
                    shared = sorted(mine & {_row_price(p, k) for k in p["imb_rows"]})
                    if shared:
                        add("RD", col, shared[0][0], shared[-1][1], rel)
                if f["decline"]:
                    add("VD", col, *_rows_price(f, 0, 2), rel)
                for k in f["thin_rows"][:MAX_THIN_ROWS]:
                    add("TP", col, *_row_price(f, k), rel)
                if f["ratio"]:
                    add("RX", col, *_rows_price(f, 0, 1), rel)
                prev = bars[max(0, i - OPEN_POC_BARS):i]
                if len(prev) == OPEN_POC_BARS and atr[i] > 0:
                    lo_p, hi_p = _poc_price(f)
                    margin = OPEN_POC_ATR * atr[i]
                    if lo_p > max(x["h"] for x in prev) + margin:
                        add("OP", 1, lo_p, hi_p, rel)
                    elif hi_p < min(x["l"] for x in prev) - margin:
                        add("OP", -1, lo_p, hi_p, rel)

        if thr is None:
            continue
        # Con umbral relativo
        if f["vol"] > 0 and col != 0 and thr["DV"] is not None and col * f["delta"] / f["vol"] >= thr["DV"]:
            add("DV", col, f["l"], f["h"], col * f["delta"] / f["vol"], thr["DV"])
        if f["vol"] > 0 and col * f["delta"] < 0 and thr["PD"] is not None and abs(f["delta"]) / f["vol"] >= thr["PD"] and "A" in f:
            add("PD", col, *_rows_price(f, 0, 1), abs(f["delta"]) / f["vol"], thr["PD"])
        jump = _jump(f, p)
        if jump is not None and thr["medvol"] and thr["DB"] is not None and jump / thr["medvol"] >= thr["DB"]:
            add("DB", col, min(f["l"], p["l"]), max(f["h"], p["h"]), jump / thr["medvol"], thr["DB"], t0=p["t"])
        g = _gap(f, p)
        if g and atr[i] > 0 and thr["OG"] is not None and g[2] / atr[i] >= thr["OG"]:
            add("OG", g[0], g[1][0], g[1][1], g[2] / atr[i], thr["OG"], t0=p["t"])
        if "xmaxd" in f and f["vol"] > 0:
            value = _extreme(f)
            if value is not None and thr["XD"] is not None and value >= thr["XD"]:
                add("XD", 1 if f["delta"] > 0 else -1, f["l"], f["h"], value, thr["XD"])
            small = _small(f)
            if small is not None and thr["SM"] is not None and -small >= thr["SM"]:
                add("SM", col, f["l"], f["h"], small, -thr["SM"])
        if "sweep_real" in f and thr["BR"] is not None and f["sweep_real"][0] >= thr["BR"]:
            usd, side, p0, p1, _ = f["sweep_real"]
            add("BR", side, p0, max(p1, p0 + f["step"]), usd, thr["BR"])
        if "big" in f and thr["GR"] is not None and f["big"][0] >= thr["GR"]:
            usd, side, p0, p1 = f["big"]
            add("GR", side, p0, max(p1, p0 + f["step"]), usd, thr["GR"])
        if "A" not in f:
            continue
        if f["exh"] is not None and thr["EX"] is not None and -f["exh"] >= thr["EX"]:
            add("EX", col, *_row_price(f, 0), f["exh"], -thr["EX"])
        if f["suck"] is not None and thr["RS"] is not None and f["suck"] >= thr["RS"]:
            add("RS", col, *_rows_price(f, 0, 2), f["suck"], thr["RS"])
        need = max(CATALOG["SQ"][3], thr["SQ"]) if thr["SQ"] is not None else None
        if need is not None and f["seq"] >= need:
            add("SQ", col, *_rows_price(f, 0, f["seq"] - 1), f["seq"], need)
        need = max(CATALOG["SW"][3], thr["SW"]) if thr["SW"] is not None else None
        if need is not None and f["sweep"][0] >= need:
            add("SW", col, *_rows_price(f, f["sweep"][1], f["sweep"][2]), f["sweep"][0], need)
        run = _vertical_run(f, thr["vert_cell"])
        need = max(CATALOG["VL"][3], thr["VL"]) if thr["VL"] is not None else None
        if need is not None and run[0] >= need:
            add("VL", col, *_rows_price(f, run[1], run[2]), run[0], need)
        if f["accdist"] and thr["AD"] is not None and f["accdist"][0] >= thr["AD"]:
            add("AD", col, *_row_price(f, f["accdist"][1]), f["accdist"][0], thr["AD"])

    return result
