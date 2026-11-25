"""
Bloques de construcción por régimen, en la fase 1. Dos tipos de momento, con las cajas de la eficiencia con caja:

- ruptura: la vela que cierra fuera de una caja vigente (la que la termina). Se mide si siguió o volvió adentro;
- borde: dentro de una caja vigente, una vela que llega al quinto de arriba o de abajo. Se mide si fue al centro.

En cada momento se guardan indicadores conocidos al cierre de esa vela (sin futuro) y el resultado de un trade
simple, para comparar los que salieron bien contra los que salieron mal. Solo sirve para buscar ideas de reglas:
lo hallado se comprueba después con el probador.
"""
import math

import json
import pathlib

import numpy as np

import candle_patterns
import measures
import regime
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


OI_DIR = None  # Carpeta con el OI de 4h bajado de Bybit ({símbolo}_4h.json: [[ms, oi], ...]); sin ella no hay medidas de OI


def _zscore(x, n=20):
    out = np.full(len(x), np.nan)
    for i in range(n, len(x)):
        w = x[i - n:i]
        sd = w.std()
        if sd > 0:
            out[i] = (x[i] - w.mean()) / sd  # Contra las n velas anteriores, sin la actual
    return out


def _pivots(h, l, n=5):
    """Swings confirmados: el único extremo de n velas a cada lado. Se conoce n velas después (en `known`)."""
    highs, lows = [], []
    for j in range(n, len(h) - n):
        if h[j] == h[j - n:j + n + 1].max() and (h[j - n:j + n + 1] == h[j]).sum() == 1:
            highs.append((j + n, j, h[j]))
        if l[j] == l[j - n:j + n + 1].min() and (l[j - n:j + n + 1] == l[j]).sum() == 1:
            lows.append((j + n, j, l[j]))
    return highs, lows


def _last_swing(swings, i):
    """El último swing ya confirmado en la vela i: (vela del swing, precio) o None."""
    known = [s for s in swings if s[0] <= i]
    return known[-1][1:] if known else None


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
    # Volumen con signo: la delta real si hay almacén; si no, estimada por dónde cerró la vela
    rng = np.where(h - l > 0, h - l, 1.0)
    signed = a["d"] if a["store"] else a["v"] * (c - a["o"]) / rng
    a["vol_z"] = _zscore(signed)
    a["cvd20"] = np.full(len(c), np.nan)
    if a["store"]:
        cd, cv = np.cumsum(a["d"]), np.cumsum(a["v"])
        a["cvd20"][20:] = (cd[20:] - cd[:-20]) / np.maximum(cv[20:] - cv[:-20], 1e-12)
    a["oi"] = np.full(len(c), np.nan)
    path = pathlib.Path(OI_DIR) / f"{symbol}_4h.json" if OI_DIR else None
    if tf == 240 and path is not None and path.exists():
        oi = dict(json.load(open(path)))
        step = tf * 60000
        # Al cierre de la vela se conoce el OI de ese instante (el de la vela siguiente); se arrastra el último conocido
        last = np.nan
        for i, t0 in enumerate(a["t"]):
            last = oi.get(int(t0 + step), last)
            a["oi"][i] = last
    a["oi_z"] = _zscore(np.diff(a["oi"], prepend=np.nan))
    pats = candle_patterns.find_patterns([{"open": o_, "high": h_, "low": l_, "close": c_, "volume": v_}
                                          for o_, h_, l_, c_, v_ in zip(a["o"], h, l, c, a["v"])],
                                         {"minWickRatio": 2.0, "enabled": {"hammer": True, "shootingStar": True, "engulfing": True, "doji": True},
                                          "requireTrend": True, "trendBars": 5, "volume": {"enabled": False, "lookback": 20, "minZ": 0.0}})
    a["pattern"] = np.zeros(len(c))
    for p in pats:
        a["pattern"][p["index"]] = 1 if p["type"] in ("HAMMER", "ENGULFING_BULLISH", "DOJI_DRAGONFLY") else -1
    a["swing_highs"], a["swing_lows"] = _pivots(h, l)
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
        f["cvd_20_a_favor"] = side * a["cvd20"][i]
        f["cvd_diverge"] = float(np.sign(a["cvd20"][i]) != np.sign(c[i] - c[i - 20]))
    if np.isfinite(a["oi"][i]) and i >= 6 and np.isfinite(a["oi"][i - 6]) and a["oi"][i - 6] > 0:
        f["oi_cambio_6"] = (a["oi"][i] / a["oi"][i - 6] - 1) * 100
        f["oi_z"] = a["oi_z"][i]
        vz, oz = a["vol_z"][i], a["oi_z"][i]
        if np.isfinite(vz) and np.isfinite(oz):
            f["confluencia_oi_vol"] = side * (1.0 if (vz > 0 and oz > 0) else -1.0 if (vz < 0 and oz < 0) else 0.0)
    if i >= 2:
        bull = l[i] > h[i - 2] or (i >= 3 and l[i - 1] > h[i - 3])
        bear = h[i] < l[i - 2] or (i >= 3 and h[i - 1] < l[i - 3])
        f["fvg_a_favor"] = float(bull if side > 0 else bear)
        f["fvg_en_contra"] = float(bear if side > 0 else bull)
    f["patron_a_favor"] = float(a["pattern"][i] == side)
    f["patron_en_contra"] = float(a["pattern"][i] == -side)
    return f


def _swing_break(a, i, side):
    """Si la ruptura pasa el último swing confirmado de su lado, y a qué distancia en ATR."""
    last = _last_swing(a["swing_highs"] if side > 0 else a["swing_lows"], i)
    if last is None:
        return {}
    return {"rompe_swing": float(side * (a["c"][i] - last[1]) > 0), "sobre_swing_atr": side * (a["c"][i] - last[1]) / a["atr"][i]}


def _swing_at_edge(a, i, side, edge, height):
    """1 si hay un swing confirmado de ese lado (un mínimo en el borde de abajo) en las últimas 15 velas, cerca del borde."""
    swings = a["swing_lows"] if side > 0 else a["swing_highs"]
    near = [s for s in swings if s[0] <= i and i - s[1] <= 15 and abs(s[2] - edge) <= 0.25 * height]
    return float(bool(near))


def breakouts(a, params=None):
    params = params or rd.PARAMS["er_box"]["params"]
    zones = rd.er_box(a, **params)["zones"]
    c, atr = a["c"], a["atr"]
    box_atr = regime.atr(a["h"], a["l"], c)  # El ATR con que er_box da la caja por terminada
    out = []
    for z in zones:
        i = z["end"] + 1  # La vela que rompe
        if i >= len(c) - 2 or i < 210:
            continue
        # Una caja que terminó por su eficiencia, sin cierre a más del margen afuera, no se rompió (F-18 del protocolo)
        if z["low"] - params["buffer"] * box_atr[i] <= c[i] <= z["high"] + params["buffer"] * box_atr[i]:
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
            **_swing_break(a, i, side),
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
                    "swing_en_borde": _swing_at_edge(a, i, side, edge, height),
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
