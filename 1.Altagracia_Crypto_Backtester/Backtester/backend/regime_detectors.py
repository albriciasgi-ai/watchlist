"""
Detectores de horizontalidad, sin futuro: cada uno dice en cada vela si el mercado está en rango, solo con lo
ocurrido hasta el cierre de esa vela. Se califican contra la referencia de regime.truth().

Cada detector devuelve {"state": arreglo bool por vela, "zones": [...]}. Una zona tiene:
  start     primera vela que el detector incluye (puede ser anterior a cuando se supo: así se dibuja la caja)
  detected  vela en que se supo que había rango (desde ahí cuenta para la calificación)
  end       última vela del rango (exclusiva en tiempo al dibujar)
  low, high caja de precios conocida al terminar
Versiones portadas, con sus fallos corregidos:
  atr_range     el Range Detection de App 1 (estilo LuxAlgo): sin unir rangos por precio y con la SMA en la vela actual
  vwap_bw       el BandWidth del VWAP de sesión de App 1, con sus umbrales por marco
  ttm           el TTM Squeeze clásico: Bollinger 20 a 2σ dentro de Keltner 20 a 1.5 ATR
  bbwp          percentil del ancho de Bollinger en las 252 velas anteriores
  vp_prog       el "Progresivo (D creciente)" de App 8, publicado al detectarse y con los niveles de cada vela
  adx, er       referencias simples: ADX bajo y eficiencia baja en las velas anteriores
"""
import numpy as np

import regime

# ==================== AYUDAS ====================


def sma(x, n):
    out = np.full(len(x), np.nan)
    if len(x) >= n:
        c = np.cumsum(np.insert(x, 0, 0.0))
        out[n - 1:] = (c[n:] - c[:-n]) / n
    return out


def true_range(h, l, c):
    prev = np.concatenate([[c[0]], c[:-1]])
    return np.maximum(h - l, np.maximum(abs(h - prev), abs(l - prev)))


def _zones_from_state(a, state, warm=0):
    """Tramos seguidos con estado de rango como zonas, con la caja de sus máximos y mínimos."""
    zones, i, n = [], warm, len(state)
    while i < n:
        if not state[i]:
            i += 1
            continue
        j = i
        while j + 1 < n and state[j + 1]:
            j += 1
        zones.append({"start": i, "detected": i, "end": j, "low": float(a["l"][i:j + 1].min()), "high": float(a["h"][i:j + 1].max())})
        i = j + 1
    return zones


def _state_from_zones(n, zones):
    state = np.zeros(n, dtype=bool)
    for z in zones:
        state[z["detected"]:z["end"] + 1] = True
    return state


# ==================== RANGE DETECTION (App 1) ====================

def atr_range(a, length=20, atr_len=200, mult=1.0, max_out=5):
    """
    Rango cuando los últimos `length` cierres quedan a menos de `mult` ATR (media de `atr_len` velas) de su media.
    Se conoce en la vela que lo cumple; la caja empieza `length` velas antes. Sigue mientras el cierre no salga de la
    caja más de `max_out` velas seguidas.
    """
    c, h, l = a["c"], a["h"], a["l"]
    n = len(c)
    atr = sma(true_range(h, l, c), atr_len) * mult
    ma = sma(c, length)
    zones, active, out, z = [], False, 0, None
    first = max(atr_len, length) - 1
    for i in range(first, n):
        if np.isnan(atr[i]) or np.isnan(ma[i]):
            continue
        inside_all = bool(np.all(np.abs(c[i - length + 1:i + 1] - ma[i]) <= atr[i]))
        if inside_all:
            if not active:
                z = {"start": i - length + 1, "detected": i, "end": i, "low": ma[i] - atr[i], "high": ma[i] + atr[i]}
                active = True
            z["end"] = i
            z["low"], z["high"] = min(z["low"], ma[i] - atr[i]), max(z["high"], ma[i] + atr[i])
            out = 0
        elif active:
            if c[i] > z["high"] or c[i] < z["low"]:
                out += 1
                if out > max_out:
                    zones.append(z)
                    active = False
            else:
                out = 0
                z["end"] = i
    if active:
        zones.append(z)
    zones = [{**z, "low": float(z["low"]), "high": float(z["high"])} for z in zones]
    return {"state": _state_from_zones(n, zones), "zones": zones}


# ==================== VWAP, TTM Y BBWP ====================

APP1_BW = {15: 2.15, 60: 2.05, 240: 2.05}   # Umbral "consolidación" del BandWidth de App 1 por marco


def vwap_bw(a, tf, threshold=None, min_bars=None):
    """
    BandWidth del VWAP de sesión de App 1: 2 × 1.15 × σ ÷ VWAP × 100, con σ la desviación del precio típico
    ponderada por volumen desde el inicio de la sesión (día UTC). Rango si queda bajo `threshold` (el umbral de
    "consolidación" de App 1). Las primeras `min_bars` velas de cada sesión no se leen, como en App 1.
    """
    threshold = APP1_BW.get(tf, 2.15) if threshold is None else threshold
    min_bars = {15: 10, 60: 3, 240: 2}.get(tf, 2) if min_bars is None else min_bars
    tp = (a["h"] + a["l"] + a["c"]) / 3
    v, t = a["v"], a["t"]
    n = len(tp)
    state = np.zeros(n, dtype=bool)
    day = t // 86400000
    start = 0
    for i in range(n):
        if i and day[i] != day[i - 1]:
            start = i
        if i - start + 1 < min_bars:
            continue
        w, p = v[start:i + 1], tp[start:i + 1]
        if w.sum() <= 0:
            continue
        vw = (w * p).sum() / w.sum()
        sd = np.sqrt((w * (p - vw) ** 2).sum() / w.sum())
        state[i] = 2 * 1.15 * sd / vw * 100 < threshold
    return {"state": state, "zones": _zones_from_state(a, state)}


def bollinger(c, n=20, k=2.0):
    mid = sma(c, n)
    sd = np.full(len(c), np.nan)
    for i in range(n - 1, len(c)):
        sd[i] = c[i - n + 1:i + 1].std()
    return mid, mid + k * sd, mid - k * sd


def ttm(a, n=20, bb_k=2.0, kc_k=1.5, min_bars=1):
    """TTM Squeeze: la banda de Bollinger cabe dentro del canal de Keltner. Rango con `min_bars` velas seguidas así."""
    c = a["c"]
    mid, up, lo = bollinger(c, n, bb_k)
    atr = sma(true_range(a["h"], a["l"], c), n)
    on = (up < mid + kc_k * atr) & (lo > mid - kc_k * atr)
    on = np.nan_to_num(on, nan=0).astype(bool)
    if min_bars > 1:
        run = np.zeros(len(on), dtype=int)
        for i in range(len(on)):
            run[i] = run[i - 1] + 1 if on[i] and i else int(on[i])
        on = run >= min_bars
    return {"state": on, "zones": _zones_from_state(a, on)}


def bbwp(a, n=20, lookback=252, below=20.0):
    """Ancho de Bollinger en su percentil de las `lookback` velas anteriores; rango si queda bajo `below`."""
    mid, up, lo = bollinger(a["c"], n, 2.0)
    width = (up - lo) / mid
    state = np.zeros(len(width), dtype=bool)
    for i in range(n - 1 + lookback, len(width)):
        hist = width[i - lookback + 1:i + 1]
        state[i] = (hist < width[i]).mean() * 100 < below
    return {"state": state, "zones": _zones_from_state(a, state)}


# ==================== VP PROGRESIVO (App 8) ====================

def volume_profile(h, l, v, bins=50, va=0.70):
    lo, hi = float(l.min()), float(h.max())
    if hi <= lo:
        return None
    edges = np.linspace(lo, hi, bins + 1)
    rng = h - l
    ok = (rng > 0) & (v > 0)
    if not ok.any():
        return None
    hh, ll, vv, rr = h[ok][:, None], l[ok][:, None], v[ok][:, None], rng[ok][:, None]
    overlap = np.clip(np.minimum(hh, edges[1:]) - np.maximum(ll, edges[:-1]), 0, None)
    vol = (vv * overlap / rr).sum(axis=0)
    total = vol.sum()
    if total <= 0:
        return None
    poc = int(vol.argmax())
    a_i = b_i = poc
    acc = vol[poc]
    while acc < total * va:
        up = vol[b_i + 1] if b_i < bins - 1 else -1
        down = vol[a_i - 1] if a_i > 0 else -1
        if up < 0 and down < 0:
            break
        if up >= down:
            b_i += 1
            acc += vol[b_i]
        else:
            a_i -= 1
            acc += vol[a_i]
    return {"vol": vol, "edges": edges, "poc": poc, "val": float(edges[a_i]), "vah": float(edges[b_i + 1]), "low": lo, "high": hi, "total": total}


def shape(p):
    """La clasificación y el d_score de App 8 (zone_vp_scanner.classify_shape), sin cambios."""
    vol, n = p["vol"], len(p["vol"])
    rng = p["high"] - p["low"]
    poc_price = (p["edges"][p["poc"]] + p["edges"][p["poc"] + 1]) / 2
    poc_c = (poc_price - p["low"]) / rng
    va_c = (p["vah"] - p["val"]) / rng
    above, below = vol[p["poc"] + 1:].sum(), vol[:p["poc"]].sum()
    sym = abs(above - below) / (above + below) if above + below > 0 else 0.5
    kurt = vol[int(n * 0.3):int(n * 0.7)].sum() / p["total"]
    if kurt < 0.25 and va_c > 0.85:
        kind = "thin"
    elif 0.25 <= poc_c <= 0.75 and sym < 0.40:
        kind = "D"
    elif poc_c > 0.60:
        kind = "P"
    elif poc_c < 0.40:
        kind = "b"
    else:
        kind = "D"
    poc_s = max(0, 25 * (1 - abs(poc_c - 0.5) * 2.5))
    if va_c < 0.25:
        va_s = va_c / 0.25 * 15
    elif va_c <= 0.65:
        va_s = 25
    elif va_c <= 0.85:
        va_s = max(0, 25 * (1 - (va_c - 0.65) / 0.20 * 0.8))
    else:
        va_s = max(0, 25 * 0.2 * (1 - (va_c - 0.85) / 0.15))
    sym_s = max(0, 25 * (1 - sym * 2))
    kurt_s = 25 if kurt >= 0.55 else (25 * (kurt - 0.30) / 0.25 if kurt >= 0.30 else max(0, 25 * kurt / 0.30 * 0.5))
    return kind, int(min(100, max(0, round(poc_s + va_s + sym_s + kurt_s))))


def vp_prog(a, min_c=30, range_pct=1.5, range_atr=None, min_d=40, close_out=3, ref="va", pb=True, bins=50):
    """
    Zona cuando las últimas `min_c` velas caben en `range_pct` % del precio (o en `range_atr` ATR de 14, si se da)
    y su perfil de volumen es D con d_score ≥ `min_d` (o P/b con 0.7 × d + 20 ≥ `min_d`). Se publica en esa vela.
    Crece vela a vela mientras el rango total siga dentro del límite y no haya `close_out` cierres seguidos fuera del
    área de valor de ese momento (`ref="va"`) o de la caja (`ref="zone"`).
    """
    h, l, c, v = a["h"], a["l"], a["c"], a["v"]
    n = len(c)
    atr = regime.atr(h, l, c) if range_atr else None
    zones, i = [], min_c - 1
    while i < n:
        s = i - min_c + 1
        lo, hi = l[s:i + 1].min(), h[s:i + 1].max()
        mid = (lo + hi) / 2
        limit = range_atr * atr[i] if range_atr else range_pct / 100 * mid
        if hi - lo > limit:
            i += 1
            continue
        p = volume_profile(h[s:i + 1], l[s:i + 1], v[s:i + 1], bins)
        if p is None:
            i += 1
            continue
        kind, d = shape(p)
        if not (kind == "D" and d >= min_d) and not (pb and kind in ("P", "b") and int(d * 0.7 + 20) >= min_d):
            i += 1
            continue
        z = {"start": s, "detected": i, "end": i, "low": float(lo), "high": float(hi), "shape": kind, "d": d}
        vah, val, outside, j = p["vah"], p["val"], 0, i + 1
        while j < n:
            nlo, nhi = min(lo, l[j]), max(hi, h[j])
            if nhi - nlo > limit:
                break
            top, bot = (hi, lo) if ref == "zone" else (vah, val)
            if c[j] > top or c[j] < bot:
                outside += 1
                if outside >= close_out:
                    break
            else:
                outside = 0
            lo, hi = nlo, nhi
            z.update(end=j, low=float(lo), high=float(hi))
            p = volume_profile(h[s:j + 1], l[s:j + 1], v[s:j + 1], bins)
            if p is not None:
                vah, val = p["vah"], p["val"]
            j += 1
        zones.append(z)
        i = z["end"] + 1
    return {"state": _state_from_zones(n, zones), "zones": zones}


# ==================== REFERENCIAS SIMPLES ====================

def adx(a, n=14, below=20.0):
    """ADX de Wilder: rango si queda bajo `below`."""
    h, l, c = a["h"], a["l"], a["c"]
    up, dn = np.diff(h, prepend=h[0]), -np.diff(l, prepend=l[0])
    pdm = np.where((up > dn) & (up > 0), up, 0.0)
    mdm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = true_range(h, l, c)

    def wilder(x):
        out = np.empty_like(x)
        out[0] = x[0]
        for i in range(1, len(x)):
            out[i] = out[i - 1] + (x[i] - out[i - 1]) / n
        return out
    atr_ = wilder(tr)
    pdi, mdi = 100 * wilder(pdm) / np.where(atr_ > 0, atr_, np.nan), 100 * wilder(mdm) / np.where(atr_ > 0, atr_, np.nan)
    dx = 100 * np.abs(pdi - mdi) / np.where(pdi + mdi > 0, pdi + mdi, np.nan)
    value = wilder(np.nan_to_num(dx))
    state = value < below
    state[:3 * n] = False
    return {"state": state, "zones": _zones_from_state(a, state, 3 * n), "value": value}


def er(a, n=20, below=0.3):
    """Eficiencia de las últimas `n` velas (avance neto ÷ recorrido): rango si queda bajo `below`."""
    c = a["c"]
    step = np.abs(np.diff(c, prepend=c[0]))
    path = np.cumsum(step)
    value = np.full(len(c), np.nan)
    value[n:] = np.abs(c[n:] - c[:-n]) / np.maximum(path[n:] - path[:-n], 1e-12)
    state = np.nan_to_num(value, nan=1.0) < below
    return {"state": state, "zones": _zones_from_state(a, state, n), "value": value}


def er_box(a, n=20, below=0.3, buffer=0.5, exit_er=None, min_bars=1):
    """
    Entrada lenta y salida rápida. El rango empieza cuando la eficiencia de las últimas `n` velas queda bajo `below`
    durante `min_bars` velas; su caja son el máximo y el mínimo de esas `n` velas, y crece con las velas que siguen
    dentro. Termina en la primera vela que cierra a más de `buffer` ATR fuera de la caja, o (si se da `exit_er`)
    cuando la eficiencia pasa de `exit_er`. La caja no crece: un precio que se va moviendo de a poco termina saliendo.
    """
    h, l, c = a["h"], a["l"], a["c"]
    eff = er(a, n, below)["value"]
    atr_ = regime.atr(h, l, c)
    zones, z, low_run = [], None, 0
    for i in range(n, len(c)):
        if z is None:
            low_run = low_run + 1 if eff[i] < below else 0
            if low_run >= min_bars:
                s = i - n + 1
                z = {"start": s, "detected": i, "end": i, "low": float(l[s:i + 1].min()), "high": float(h[s:i + 1].max())}
            continue
        out = c[i] > z["high"] + buffer * atr_[i] or c[i] < z["low"] - buffer * atr_[i]
        if out or (exit_er is not None and eff[i] > exit_er):
            zones.append(z)
            z, low_run = None, 0
            continue
        z["end"] = i  # La caja queda fija: la de las velas con que se detectó el rango
    if z is not None:
        zones.append(z)
    return {"state": _state_from_zones(len(c), zones), "zones": zones}


DETECTORS = {"er_box": er_box, "atr_range": atr_range, "vwap_bw": vwap_bw, "ttm": ttm, "bbwp": bbwp, "vp_prog": vp_prog, "adx": adx, "er": er}


# ==================== CALIFICACIÓN ====================

def score(state, labels, valid, mask=None):
    """
    Contra la referencia, en las velas válidas (y dentro de `mask`, si se da):
      share      parte del tiempo que el detector marca rango
      precision  de lo que marca, cuánto era horizontal (comparar con base, la parte horizontal de todo el tiempo)
      recall     de lo horizontal, cuánto marca
      leak       de la tendencia, cuánto marca como rango: el error caro
      j          recall − leak: 0 es tirar una moneda, 1 es perfecto
    """
    keep = valid if mask is None else valid & mask
    s, flat = state[keep], labels[keep] == 0
    if not keep.any():
        return None
    n_flat, n_trend = flat.sum(), (~flat).sum()
    recall = (s & flat).sum() / n_flat if n_flat else 0.0
    leak = (s & ~flat).sum() / n_trend if n_trend else 0.0
    return {"n": int(keep.sum()), "share": round(float(s.mean()), 3), "base": round(float(flat.mean()), 3),
            "precision": round(float((s & flat).sum() / s.sum()), 3) if s.any() else None,
            "recall": round(float(recall), 3), "leak": round(float(leak), 3), "j": round(float(recall - leak), 3)}


# ==================== VISTA PARA EL GRÁFICO ====================
# Valores de cada detector: los de fábrica (como estaban en App 1 y App 8) y los afinados en la fase 1 (lo anterior a
# 2023, calificados en 2023) contra la referencia de 48 velas. Ver la sección del CLAUDE.md de App 1.

PARAMS = {
    "er_box": {"label": "Eficiencia con caja", "params": {"n": 20, "below": 0.2, "buffer": 0.5, "exit_er": 0.5, "min_bars": 1}},
    "er": {"label": "Eficiencia baja (referencia simple)", "params": {"n": 20, "below": 0.3}},
    "adx": {"label": "ADX bajo (referencia simple)", "params": {"n": 14, "below": 30}, "original": {"n": 14, "below": 20}},
    "ttm": {"label": "TTM Squeeze", "params": {"n": 20, "bb_k": 2.0, "kc_k": 2.0, "min_bars": 1}, "original": {"n": 20, "bb_k": 2.0, "kc_k": 1.5, "min_bars": 1}},
    "bbwp": {"label": "BBWP", "params": {"n": 20, "lookback": 126, "below": 50}, "original": {"n": 20, "lookback": 252, "below": 20}},
    "atr_range": {"label": "Range Detection de App 1 (ATR)", "params": {"length": 30, "atr_len": 50, "mult": 2.0, "max_out": 5},
                  "original": {"length": 20, "atr_len": 200, "mult": 1.0, "max_out": 5}},
    "vwap_bw": {"label": "BandWidth del VWAP de sesión de App 1", "params": {"threshold": None}},
    "vp_prog": {"label": "VP progresivo (D creciente) de App 8", "params": {"min_c": 20, "range_pct": 99, "range_atr": 5, "min_d": 45, "close_out": 3},
                "original": {"min_c": 30, "range_pct": 1.5, "range_atr": None, "min_d": 40, "close_out": 3}},
}

_bars = {}


def _clean_params(name, raw):
    base = dict(PARAMS[name]["params"])
    for key, value in (raw or {}).items():
        if key not in base and key not in (PARAMS[name].get("original") or {}):
            continue
        if value in (None, ""):
            base[key] = None
        else:
            try:
                base[key] = int(value) if isinstance(base.get(key), int) and float(value).is_integer() else float(value)
            except (TypeError, ValueError):
                pass
    return base


def _load(symbol, tf):
    key = (symbol, tf)
    if key not in _bars:
        bars, phase = regime.phase_bars(symbol, tf)
        _bars[key] = (bars, phase, regime.arrays(bars) if bars else None)
        while len(_bars) > 8:
            _bars.pop(next(iter(_bars)))
    return _bars[key]


def run_detector(detector, a, tf, params):
    return DETECTORS[detector](a, tf, **params) if detector == "vwap_bw" else DETECTORS[detector](a, **params)


def on_frame(fine, fine_tf, coarse, coarse_tf):
    """
    El estado de un detector corrido en velas de `fine_tf`, llevado a las velas de `coarse_tf`: una vela grande es
    rango si el detector lo decía en la última vela chica que cierra con ella (o antes). Sin mirar hacia adelante.
    """
    close_fine = fine["t"] + fine_tf * 60000
    close_coarse = coarse["t"] + coarse_tf * 60000
    k = np.searchsorted(close_fine, close_coarse, side="right") - 1
    state = np.zeros(len(coarse["t"]), dtype=bool)
    ok = k >= 0
    state[ok] = fine["state"][k[ok]]
    return state


def view(symbol, tf, detector, raw_params=None, window=regime.DEFAULT_WINDOW * 2, min_run=8, split="2023-01-01", detect_tf=None):
    """
    Referencia, zonas del detector y su calificación en la fase 1, en horas (ms) para dibujarlas. Con `detect_tf`
    menor que `tf` el detector corre en esas velas (sus parámetros cuentan en velas de ese marco) y se califica en `tf`.
    """
    import rule_tester as rt
    tf = int(tf)
    detect_tf = int(detect_tf or tf)
    if tf not in regime.TFS or detect_tf not in regime.TFS:
        return {"success": False, "message": "Marco no disponible: 15m, 1h o 4h"}
    if detect_tf > tf:
        return {"success": False, "message": "El marco de detección tiene que ser igual o menor que el del gráfico"}
    if detector not in DETECTORS or detector not in PARAMS:
        return {"success": False, "message": "Detector desconocido"}
    bars, phase, a = _load(symbol, tf)
    if not bars or len(bars) < 300:
        return {"success": False, "message": "Sin velas suficientes de la fase 1"}
    params = _clean_params(detector, raw_params)
    if detect_tf == tf:
        da, dtf = a, tf
        out = run_detector(detector, a, tf, params)
    else:
        dbars, _, da = _load(symbol, detect_tf)
        if not dbars:
            return {"success": False, "message": "Sin velas del marco de detección"}
        dtf = detect_tf
        raw = run_detector(detector, da, detect_tf, params)
        out = {"state": on_frame({"t": da["t"], "state": raw["state"]}, detect_tf, a, tf), "zones": raw["zones"]}
    tr = regime.truth(bars, window=int(window), min_run=int(min_run))
    t, step = a["t"], tf * 60000
    cut = a["t"] < rt._ms(split)
    flat = tr["labels"] == 0
    zones = []
    dt, dstep = da["t"], dtf * 60000
    for z in out["zones"]:
        # La calificación de la zona, en las velas del gráfico que cierran mientras dura
        first = int(np.searchsorted(t + step, dt[z["detected"]] + dstep, side="left"))
        last = int(np.searchsorted(t + step, dt[z["end"]] + dstep, side="right")) - 1
        seg = slice(first, max(first, last) + 1)
        ok = tr["valid"][seg]
        zones.append({"start": int(dt[z["start"]]), "detected": int(dt[z["detected"]] + dstep), "end": int(dt[z["end"]] + dstep),
                      "low": z["low"], "high": z["high"], "bars": int(z["end"] - z["detected"] + 1), "barsTf": dtf,
                      "match": round(float(flat[seg][ok].mean()), 2) if ok.any() else None,
                      **({"shape": z["shape"], "d": z["d"]} if "shape" in z else {})})
    truth_zones = [{"start": int(t[a_]), "end": int(t[b - 1] + step), "dir": lab, "bars": b - a_}
                   for a_, b, lab in regime._runs(tr["labels"]) if lab != 0]
    return {"success": True, "symbol": symbol, "tf": tf, "detectTf": dtf, "detector": detector, "params": params,
            "phase": {"from": phase["from"], "to": phase["to"]}, "split": split,
            "truth": {"window": int(window), "minRun": int(min_run), "zones": truth_zones,
                      "trendShare": round(float((tr["labels"][tr["valid"]] != 0).mean()), 3)},
            "zones": zones,
            "score": {"all": score(out["state"], tr["labels"], tr["valid"]), "train": score(out["state"], tr["labels"], tr["valid"], cut),
                      "hold": score(out["state"], tr["labels"], tr["valid"], ~cut)}}


def catalog():
    return [{"key": k, "label": v["label"], "params": v["params"], "original": v.get("original")} for k, v in PARAMS.items()]
