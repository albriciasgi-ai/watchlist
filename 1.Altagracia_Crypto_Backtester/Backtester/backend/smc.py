"""
Estructura SMC para el probador de reglas (20/11/2026): el mismo cálculo de
frontend/src/components/indicators/smcStructure.js (prueba de paridad en tests/test_smc.py). Reglas propias: no copia el
código de LuxAlgo (su licencia es CC BY-NC-SA, no comercial).

Elementos del probador (solo necesitan velas: valen en todas las monedas, en las acciones y en 1D):
- BS, ruptura de estructura: el cierre que pasa el último pivote (BOS o CHoCH, de la estructura elegida). La zona va
  del nivel roto al cierre: el stop "borde lejano de la zona" queda detrás del nivel.
- OB, order block: el que deja la ruptura, desde la vela que lo crea. La zona es el OB: con entrada limit en la zona,
  el trade espera que el precio vuelva a él; el stop "borde lejano" queda al otro lado.
- BK, breaker: un OB roto, del lado contrario, desde la vela que lo rompe. La zona es el OB.
- EQ, barrido de iguales: la vela que pasa el nivel de dos pivotes casi iguales y cierra de vuelta; va contra el lado
  barrido. La zona va del nivel al extremo de esa vela: el stop "borde lejano" queda detrás del barrido.

Para filtros y objetivo: `ranges` da en cada vela el rango mayor (techo, suelo) y la tendencia de la estructura mayor.
"""
import math

CODES = {
    "BS": "Ruptura de estructura (BOS o CHoCH)",
    "OB": "Order block (regreso a él)",
    "BK": "Breaker (OB roto, del lado contrario)",
    "EQ": "Barrido de iguales (EQH o EQL)",
}

DEFAULTS = {"internal": 5, "swing": 50, "scope": "swing", "break": "any", "pick": "extreme", "area": "full",
            "mitigation": "close", "eqLength": 3, "eqThreshold": 0.1, "reclaim": True}


def atr_of(h, l, c, n=14):
    out = [0.0] * len(h)
    for i in range(len(h)):
        previous = c[i - 1] if i else c[0]
        tr = max(h[i] - l[i], abs(h[i] - previous), abs(l[i] - previous))
        out[i] = out[i - 1] + (tr - out[i - 1]) / n if i else tr
    return out


def leg_pivots(h, l, length):
    """Pivotes de tramo: {type: 1 máximo / −1 mínimo, index, price, known}, alternados."""
    out, leg = [], 0
    for t in range(length, len(h)):
        c = t - length
        max_right, min_right = -math.inf, math.inf
        for j in range(c + 1, t + 1):
            if h[j] > max_right:
                max_right = h[j]
            if l[j] < min_right:
                min_right = l[j]
        if leg >= 0 and h[c] > max_right:
            out.append({"type": 1, "index": c, "price": h[c], "known": t})
            leg = -1
        elif leg <= 0 and l[c] < min_right:
            out.append({"type": -1, "index": c, "price": l[c], "known": t})
            leg = 1
    return out


def _order_block(o, h, l, c, pivot_index, break_index, side, pick, area):
    last = max(pivot_index, break_index - 1)
    m = pivot_index
    for j in range(pivot_index, last + 1):
        if (l[j] < l[m]) if side > 0 else (h[j] > h[m]):
            m = j
    if pick == "opposite":
        for j in range(m, pivot_index - 1, -1):
            if (c[j] < o[j]) if side > 0 else (c[j] > o[j]):
                m = j
                break
    top, bottom = h[m], l[m]
    if area == "body" and max(o[m], c[m]) > min(o[m], c[m]):
        top, bottom = max(o[m], c[m]), min(o[m], c[m])
    return {"index": m, "top": top, "bottom": bottom, "mid": (top + bottom) / 2}


def compute(o, h, l, c, cfg=None):
    """Rupturas, order blocks con su vida, iguales y rango, como computeSmc de smcStructure.js."""
    cfg = {**DEFAULTS, **(cfg or {})}
    n = len(h)
    pivots = {"internal": leg_pivots(h, l, int(cfg["internal"])), "swing": leg_pivots(h, l, int(cfg["swing"]))}
    state = {scope: {"next": 0, "high": None, "low": None, "trend": 0} for scope in ("internal", "swing")}
    breaks, obs, live = [], [], []
    bias, top, bottom = [0] * n, [math.nan] * n, [math.nan] * n
    trail_top = trail_bottom = math.nan
    breakers = True
    for t in range(n):
        for ob in list(live):
            if ob["known"] >= t:
                continue
            if ob["broken"] is None:
                reach = l[t] if ob["dir"] > 0 else h[t]
                if ob["touched"] is None and (reach <= ob["top"] if ob["dir"] > 0 else reach >= ob["bottom"]):
                    ob["touched"] = t
                if ob["half"] is None and (reach <= ob["mid"] if ob["dir"] > 0 else reach >= ob["mid"]):
                    ob["half"] = t
                through = reach if cfg["mitigation"] == "wick" else c[t]
                if through < ob["bottom"] if ob["dir"] > 0 else through > ob["top"]:
                    ob["broken"] = t
            elif breakers and ob["breakerEnd"] is None and ob["broken"] < t:
                if ob["breakerTouched"] is None and (h[t] >= ob["bottom"] if ob["dir"] > 0 else l[t] <= ob["top"]):
                    ob["breakerTouched"] = t
                if c[t] > ob["top"] if ob["dir"] > 0 else c[t] < ob["bottom"]:
                    ob["breakerEnd"] = t
            if ob["broken"] is not None and ob["breakerEnd"] is not None:
                live.remove(ob)
        for scope in ("swing", "internal"):
            s = state[scope]
            for side in (1, -1):
                p = s["high"] if side > 0 else s["low"]
                if p is None or p["crossed"]:
                    continue
                if not (c[t] > p["price"] if side > 0 else c[t] < p["price"]):
                    continue
                p["crossed"] = True
                if scope == "internal":
                    twin = state["swing"]["high"] if side > 0 else state["swing"]["low"]
                    if twin is not None and twin["index"] == p["index"]:
                        continue
                tag = "CHoCH" if s["trend"] == -side else "BOS"
                s["trend"] = side
                ob = _order_block(o, h, l, c, p["index"], t, side, cfg["pick"], cfg["area"])
                breaks.append({"scope": scope, "dir": side, "tag": tag, "price": p["price"], "pivot": p["index"], "index": t, "known": t})
                block = {"scope": scope, "dir": side, **ob, "created": t, "known": t, "pivot": p["index"], "touched": None, "half": None,
                         "broken": None, "breakerTouched": None, "breakerEnd": None}
                obs.append(block)
                live.append(block)
        for scope in ("swing", "internal"):
            s = state[scope]
            while s["next"] < len(pivots[scope]) and pivots[scope][s["next"]]["known"] == t:
                p = {**pivots[scope][s["next"]], "crossed": False}
                if p["type"] > 0:
                    s["high"] = p
                    if scope == "swing":
                        trail_top = p["price"]
                else:
                    s["low"] = p
                    if scope == "swing":
                        trail_bottom = p["price"]
                s["next"] += 1
        if trail_top == trail_top:
            trail_top = max(trail_top, h[t])
        if trail_bottom == trail_bottom:
            trail_bottom = min(trail_bottom, l[t])
        top[t], bottom[t], bias[t] = trail_top, trail_bottom, state["swing"]["trend"]

    atr = atr_of(h, l, c, 200)
    equals, last = [], {1: None, -1: None}
    for p in leg_pivots(h, l, int(cfg["eqLength"])):
        previous = last[p["type"]]
        if previous is not None and abs(p["price"] - previous["price"]) < cfg["eqThreshold"] * atr[p["known"]]:
            level = max(p["price"], previous["price"]) if p["type"] > 0 else min(p["price"], previous["price"])
            item = {"dir": p["type"], "first": previous["index"], "firstPrice": previous["price"], "index": p["index"], "price": p["price"],
                    "level": level, "known": p["known"], "swept": None, "reclaimed": False}
            for u in range(p["known"] + 1, n):
                if h[u] > level if p["type"] > 0 else l[u] < level:
                    item["swept"] = u
                    item["reclaimed"] = c[u] < level if p["type"] > 0 else c[u] > level
                    break
            equals.append(item)
        last[p["type"]] = p
    return {"breaks": breaks, "obs": obs, "equals": equals, "top": top, "bottom": bottom, "bias": bias,
            "swingPivots": pivots["swing"], "internalPivots": pivots["internal"]}


def events(bars, tf, cfg=None, codes=("BS", "OB", "BK", "EQ")):
    """Eventos del probador: {code, dir, t, known, lo, hi, info} con la forma de los de of_elements."""
    cfg = {**DEFAULTS, **(cfg or {})}
    tf_ms = int(tf) * 60000
    o, h, l, c = [b["o"] for b in bars], [b["h"] for b in bars], [b["l"] for b in bars], [b["c"] for b in bars]
    r = compute(o, h, l, c, cfg)
    out = []
    t_of = lambda i: bars[i]["t"]
    for br in r["breaks"]:
        if br["scope"] != cfg["scope"] or "BS" not in codes:
            continue
        if cfg["break"] == "bos" and br["tag"] != "BOS" or cfg["break"] == "choch" and br["tag"] != "CHoCH":
            continue
        i = br["index"]
        out.append({"code": "BS", "dir": br["dir"], "t": t_of(i), "known": t_of(i) + tf_ms, "lo": min(br["price"], c[i]), "hi": max(br["price"], c[i]),
                    "info": {"tag": br["tag"], "scope": br["scope"], "level": br["price"], "pivot": t_of(br["pivot"])}})
    for ob in r["obs"]:
        if ob["scope"] != cfg["scope"]:
            continue
        info = {"scope": ob["scope"], "candle": t_of(ob["index"]), "top": ob["top"], "bottom": ob["bottom"]}
        if "OB" in codes:
            i = ob["known"]
            out.append({"code": "OB", "dir": ob["dir"], "t": t_of(i), "known": t_of(i) + tf_ms, "lo": ob["bottom"], "hi": ob["top"], "info": info})
        if "BK" in codes and ob["broken"] is not None:
            i = ob["broken"]
            out.append({"code": "BK", "dir": -ob["dir"], "t": t_of(i), "known": t_of(i) + tf_ms, "lo": ob["bottom"], "hi": ob["top"], "info": info})
    if "EQ" in codes:
        for eq in r["equals"]:
            if eq["swept"] is None or (cfg["reclaim"] and not eq["reclaimed"]):
                continue
            u = eq["swept"]
            extreme = h[u] if eq["dir"] > 0 else l[u]
            out.append({"code": "EQ", "dir": -eq["dir"], "t": t_of(u), "known": t_of(u) + tf_ms, "lo": min(eq["level"], extreme),
                        "hi": max(eq["level"], extreme), "info": {"level": eq["level"], "first": t_of(eq["first"]), "second": t_of(eq["index"]),
                                                                    "reclaimed": eq["reclaimed"]}})
    out.sort(key=lambda e: (e["known"], e["code"]))
    return out


def ranges(bars, cfg=None):
    """Techo, suelo y tendencia de la estructura mayor en cada vela (para los filtros y el objetivo "débil")."""
    o, h, l, c = [b["o"] for b in bars], [b["h"] for b in bars], [b["l"] for b in bars], [b["c"] for b in bars]
    r = compute(o, h, l, c, cfg)
    return {"top": r["top"], "bottom": r["bottom"], "bias": r["bias"]}


def filter_ok(smcf, rng, close, k, side):
    """pd: un largo solo en discount (bajo la mitad del rango) y un corto solo en premium. bias: a favor de la estructura mayor."""
    if smcf.get("pd"):
        top, bottom = rng["top"][k], rng["bottom"][k]
        if not (top == top and bottom == bottom and top > bottom):
            return False
        middle = (top + bottom) / 2
        if (close[k] - middle) * side >= 0:
            return False
    if smcf.get("bias") and rng["bias"][k] != side:
        return False
    return True
