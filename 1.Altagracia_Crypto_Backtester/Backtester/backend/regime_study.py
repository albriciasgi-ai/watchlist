"""
Bloques de construcción por régimen, en la fase 1. Dos tipos de momento, con las cajas de la eficiencia con caja:

- ruptura: la vela que cierra fuera de una caja vigente (la que la termina). Se mide si siguió o volvió adentro;
- borde: dentro de una caja vigente, una vela que llega al quinto de arriba o de abajo. Se mide si fue al centro.

En cada momento se guardan indicadores conocidos al cierre de esa vela (sin futuro) y el resultado de un trade
simple, para comparar los que salieron bien contra los que salieron mal. Solo sirve para buscar ideas de reglas:
lo hallado se comprueba después con el probador.
"""
import math

import numpy as np

import measures
import regime_detectors as rd
import rule_tester as rt

TAKER = rt.TAKER_FEE


def _ema(x, n):
    out = np.empty_like(x)
    out[0] = x[0]
    k = 2 / (n + 1)
    for i in range(1, len(x)):
        out[i] = x[i] * k + out[i - 1] * (1 - k)
    return out


def _rsi(c, n=14):
    d = np.diff(c, prepend=c[0])
    up, dn = np.where(d > 0, d, 0.0), np.where(d < 0, -d, 0.0)
    au, ad = _ema(up, 2 * n - 1), _ema(dn, 2 * n - 1)  # Media de Wilder
    return 100 - 100 / (1 + au / np.where(ad > 0, ad, 1e-12))


def _bbwp(c, n=20, lookback=126):
    mid = rd.sma(c, n)
    sd = np.full(len(c), np.nan)
    for i in range(n - 1, len(c)):
        sd[i] = c[i - n + 1:i + 1].std()
    w = 4 * sd / mid
    out = np.full(len(c), np.nan)
    for i in range(n - 1 + lookback, len(c)):
        out[i] = (w[i - lookback + 1:i + 1] < w[i]).mean()
    return out


def _trade(a, i, side, stop, target, horizon=48):
    """Entra en la apertura de la vela siguiente; stop y objetivo al tocar (en la misma vela cuenta el stop)."""
    o, h, l, c = a["o"], a["h"], a["l"], a["c"]
    e = i + 1
    if e >= len(c):
        return None
    entry = o[e]
    risk = (entry - stop) * side
    if risk <= 0 or (target - entry) * side <= 0:
        return None
    for j in range(e, min(len(c), e + horizon)):
        hit_stop = l[j] <= stop if side > 0 else h[j] >= stop
        hit_goal = h[j] >= target if side > 0 else l[j] <= target
        if hit_stop:
            out = o[j] if (o[j] < stop if side > 0 else o[j] > stop) else stop
            break
        if hit_goal:
            out = target
            break
    else:
        if e + horizon > len(c):
            return None  # Sin velas para terminarlo
        out = c[min(len(c), e + horizon) - 1]
    return (out - entry) * side / risk - TAKER * (entry + out) / risk


def series(symbol, tf=240):
    ph = next((p for p in rt.phases(symbol) if p["phase"] == 1), None)
    if ph is None or not ph["available"]:
        return None
    rule = rt.clean_rule({"tf": tf, "recipe": {"slots": [{"codes": ["RF"]}]}})
    bars = rt.detect_span(symbol, tf, ph, rule)["bars"]
    if len(bars) < 400:
        return None
    a = {"t": np.array([b["t"] for b in bars], dtype=np.int64), **{k: np.array([b[s] for b in bars], dtype=float)
         for k, s in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"), ("d", "delta"))}}
    h, l, c = a["h"], a["l"], a["c"]
    a["atr"] = measures.atr(h, l, c)
    a["ema200"], a["ema50"], a["ema120"] = _ema(c, 200), _ema(c, 50), _ema(c, 120)
    a["rsi"] = _rsi(c)
    a["bbwp"] = _bbwp(c)
    a["hvol"] = measures.hour_volume(a["t"], a["v"])
    a["leg"], _, _ = measures.zigzag(h, l, c, a["atr"], 2.0)
    a["eff"] = rd.er(a, 20, 0.3)["value"]
    a["store"] = bool(np.abs(a["d"]).sum() > 0)
    return a


def _common(a, i, side):
    """Indicadores de la vela i, a favor del lado `side`."""
    c, o, h, l, v, atr = a["c"], a["o"], a["h"], a["l"], a["v"], a["atr"]
    rng = max(h[i] - l[i], 1e-12)
    f = {
        "cuerpo_atr": abs(c[i] - o[i]) / atr[i],
        "rango_atr": rng / atr[i],
        "cierre_en_vela": ((c[i] - l[i]) / rng) if side > 0 else ((h[i] - c[i]) / rng),  # 1 = cerró en el extremo a favor
        "vol_hora": a["hvol"][i],
        "rsi_a_favor": (a["rsi"][i] - 50) * side,
        "bbwp": a["bbwp"][i],
        "eficiencia_20": a["eff"][i],
        "sobre_ema200": side * (c[i] - a["ema200"][i]) / atr[i],
        "pendiente_ema120": side * (a["ema120"][i] - a["ema120"][max(0, i - 30)]) / atr[i],
        "tramo_a_favor": float(a["leg"][i] * side),
    }
    if a["store"] and v[i] > 0:
        f["delta_vol"] = side * a["d"][i] / v[i]
    return f


def breakouts(a, params=None):
    params = params or rd.PARAMS["er_box"]["params"]
    zones = rd.er_box(a, **params)["zones"]
    c, atr = a["c"], a["atr"]
    out = []
    for z in zones:
        i = z["end"] + 1  # La vela que rompe
        if i >= len(c) - 2 or i < 210:
            continue
        mid = (z["low"] + z["high"]) / 2
        side = 1 if c[i] > mid else -1
        height = z["high"] - z["low"]
        box = slice(z["start"], z["detected"] + 1)
        edge = z["high"] if side > 0 else z["low"]
        f = _common(a, i, side)
        f.update({
            "alto_caja_atr": height / atr[i],
            "duracion_caja": float(z["end"] - z["start"] + 1),
            "pasa_el_borde_atr": side * (c[i] - edge) / atr[i],
            "vol_vs_caja": a["v"][i] / max(np.median(a["v"][box]), 1e-12),
            "toques_del_borde": float(sum(1 for j in range(z["detected"], i)
                                          if ((a["h"][j] >= edge - 0.15 * height) if side > 0 else (a["l"][j] <= edge + 0.15 * height)))),
        })
        r = _trade(a, i, side, c[i] - side * 1.5 * atr[i], c[i] + side * 3 * 1.5 * atr[i])
        back = any((c[j] < edge if side > 0 else c[j] > edge) for j in range(i + 1, min(len(c), i + 7)))
        if r is None:
            continue
        out.append({"t": int(a["t"][i]), "side": side, "r": r, "fake": back, "f": f, "low": z["low"], "high": z["high"], "start": int(a["t"][z["start"]])})
    return out


def edges(a, params=None, share=0.2):
    """Llegadas al borde dentro de una caja vigente: un evento por llegada (se rearma al volver al tercio del centro)."""
    params = params or rd.PARAMS["er_box"]["params"]
    zones = rd.er_box(a, **params)["zones"]
    c, h, l, atr = a["c"], a["h"], a["l"], a["atr"]
    out = []
    for z in zones:
        height = z["high"] - z["low"]
        if height <= 0:
            continue
        mid = (z["low"] + z["high"]) / 2
        armed = {1: True, -1: True}
        touches = {1: 0, -1: 0}
        for i in range(z["detected"] + 1, z["end"] + 1):
            if i < 210 or i >= len(c) - 2:
                continue
            if abs(c[i] - mid) < height / 6:
                armed = {1: True, -1: True}
            for side, hit in ((1, l[i] <= z["low"] + share * height), (-1, h[i] >= z["high"] - share * height)):
                if not hit or not armed[side]:
                    continue
                armed[side] = False
                touches[side] += 1
                edge = z["low"] if side > 0 else z["high"]
                stop = edge - side * 0.5 * atr[i]
                r = _trade(a, i, side, stop, mid)
                if r is None:
                    continue
                f = _common(a, i, side)
                wick = (min(a["o"][i], c[i]) - l[i]) if side > 0 else (h[i] - max(a["o"][i], c[i]))
                f.update({
                    "mecha_al_borde": wick / max(h[i] - l[i], 1e-12),
                    "penetra_borde_atr": side * (edge - (l[i] if side > 0 else h[i])) / atr[i],
                    "toque_numero": float(touches[side]),
                    "edad_caja": float(i - z["detected"]),
                    "alto_caja_atr": height / atr[i],
                    "vol_vs_caja": a["v"][i] / max(np.median(a["v"][z["start"]:z["detected"] + 1]), 1e-12),
                    "al_centro_r": (mid - c[i]) * side / max((c[i] - stop) * side, 1e-12),
                })
                out.append({"t": int(a["t"][i]), "side": side, "r": r, "f": f, "low": z["low"], "high": z["high"]})
    return out


def _spearman(x, y):
    if len(x) < 20:
        return None
    rx, ry = np.argsort(np.argsort(x)), np.argsort(np.argsort(y))
    v = np.corrcoef(rx, ry)[0, 1]
    return None if math.isnan(v) else float(v)


def analyze(events, split_ms):
    """
    Para cada indicador: correlación por rangos con el R del trade en el tramo de búsqueda (antes de split) y en el
    de validación, y el R medio por tercio (los cortes salen del tramo de búsqueda y se aplican a los dos).
    """
    names = sorted({k for e in events for k in e["f"]})
    train = [e for e in events if e["t"] < split_ms]
    hold = [e for e in events if e["t"] >= split_ms]
    rows = []
    for name in names:
        tr = [(e["f"][name], e["r"]) for e in train if name in e["f"] and np.isfinite(e["f"][name])]
        ho = [(e["f"][name], e["r"]) for e in hold if name in e["f"] and np.isfinite(e["f"][name])]
        if len(tr) < 60 or len(ho) < 30:
            continue
        cuts = np.quantile([x for x, _ in tr], [1 / 3, 2 / 3])

        def thirds(pairs):
            groups = [[r for x, r in pairs if x <= cuts[0]], [r for x, r in pairs if cuts[0] < x <= cuts[1]], [r for x, r in pairs if x > cuts[1]]]
            return [(len(g), float(np.mean(g)) if g else None, float(np.std(g, ddof=1) / math.sqrt(len(g))) if len(g) > 1 else None) for g in groups]
        rows.append({"name": name, "rhoTrain": _spearman([x for x, _ in tr], [r for _, r in tr]), "rhoHold": _spearman([x for x, _ in ho], [r for _, r in ho]),
                     "cuts": [float(cuts[0]), float(cuts[1])], "train": thirds(tr), "hold": thirds(ho)})
    return {"n": len(events), "nTrain": len(train), "nHold": len(hold),
            "rTrain": float(np.mean([e["r"] for e in train])) if train else None, "rHold": float(np.mean([e["r"] for e in hold])) if hold else None,
            "rows": rows}
