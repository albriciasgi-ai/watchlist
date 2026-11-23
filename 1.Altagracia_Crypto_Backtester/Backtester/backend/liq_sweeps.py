"""
Barridos de liquidaciones para el probador de reglas: el precio pasa un swing que coincide con una zona
del indicador Liquidaciones. Barrer un mínimo es alcista; barrer un máximo, bajista.

- Swing: el único extremo de `swing_bars` velas a cada lado. Se conoce al cerrar la última de su derecha.
- Barrido: la primera vela posterior que pasa más allá del swing. Cada swing se barre una sola vez.
- Zonas: la regla de liquidationZones.js (buildZones y pickZones) con las celdas conocidas antes de abrir la
  vela del barrido, y el precio de esa apertura. Una fuente por fecha, la de más prioridad, sin mezclar.
- LIQ: el swing barrido cae en una zona mostrada (con TOLERANCE_PCT de margen). SWP: el mismo barrido sin
  zona, que sirve de control. Sin datos de liquidaciones en esa fecha no sale ninguno de los dos.
- Variantes: "pierce" se conoce al cerrar la vela del barrido; "reclaim", al cerrar la primera vela (la del
  barrido o hasta `reclaim_bars` después) que cierra de vuelta del lado del swing.
- VH: vela con `VOLUME_TIMES` veces el volumen normal de su hora en los 30 días anteriores, hacia su color.

- what="zone": en vez de un swing, se barre la zona misma. El precio estuvo entero de un lado de una zona
  mostrada (la vela no la toca) y después una vela pasa su borde contrario: bajar a través de la zona es
  alcista, subir a través de ella, bajista. Cada zona se barre una vez hasta que el precio vuelve a salir.

La zona de cada evento va del extremo del barrido al precio del swing (o al borde pasado de la zona).
"""
import math

import numpy as np

import liq_store

DAY_MS = liq_store.DAY_MS
LOOKBACK_DAYS = 30
BIN_PCT = 0.1
HALF_FRACTION = 0.5
PER_SIDE = 3
MAX_DISTANCE_PCT = 6.0
MIN_SHARE = 0.05
MIN_GAP_PCT = 0.25
TOLERANCE_PCT = 0.1    # Margen para que un swing cuente dentro de una zona
MAX_SWING_AGE_DAYS = LOOKBACK_DAYS  # Un swing más viejo que la ventana de liquidaciones ya no se sigue
VOLUME_TIMES = 2.0
VOLUME_MIN_DAYS = 10

CODES = {"LIQ": "Barrido de liquidación", "SWP": "Barrido de swing sin liquidación", "VH": "Volumen alto para su hora"}


def nice_step(value):
    """Paso redondo más cercano en escala logarítmica: 1, 2, 2.5 o 5 por una potencia de 10."""
    if not value > 0:
        return 0.0
    power = 10 ** math.floor(math.log10(value))
    best = power
    for factor in (1, 2, 2.5, 5, 10):
        if abs(math.log(factor * power / value)) < abs(math.log(best / value)):
            best = factor * power
    return float(f"{best:.12g}")


def _source_at(sources, t):
    """Fuente de esa hora: la de más prioridad que la cubre; si ninguna, la de más prioridad con datos en la ventana."""
    lookback = LOOKBACK_DAYS * DAY_MS
    for data, info in sources:
        if any(a <= t <= b + DAY_MS for a, b in info["ranges"]):
            return data, info
    for data, info in sources:
        if any(a <= t and t - lookback < b for a, b in info["ranges"]):
            return data, info
    return None


def build_zones(low, high, long_usd, short_usd, known, width):
    """Zonas de todos los precios: cada pico del histograma suavizado con su núcleo de una franja por lado."""
    if not width > 0 or not len(known):
        return []
    keys = np.floor((low + high) / 2 / width).astype(np.int64)
    base = int(keys.min()) - 2
    size = int(keys.max()) - base + 3
    longs = np.bincount(keys - base, weights=long_usd, minlength=size)
    shorts = np.bincount(keys - base, weights=short_usd, minlength=size)
    raw = longs + shorts
    smooth = np.convolve(raw, [0.25, 0.5, 0.25], "same")
    # Un pico sube desde la izquierda y no baja hacia la derecha: en una meseta gana la franja de la izquierda
    inner = np.arange(1, size - 1)
    peaks = inner[(raw[inner] > 0) & (smooth[inner] > smooth[inner - 1]) & (smooth[inner] >= smooth[inner + 1])]
    peaks = sorted(peaks.tolist(), key=lambda k: (-smooth[k], k))
    owner, zones = {}, []
    for key in peaks:
        if key in owner:
            continue
        lo = hi = key
        owner[key] = len(zones)
        for step in (-1, 1):
            nxt = key + step
            if nxt not in owner and 0 <= nxt < size and raw[nxt] > 0 and smooth[nxt] <= smooth[key] \
                    and smooth[nxt] >= HALF_FRACTION * smooth[key]:
                owner[nxt] = len(zones)
                lo, hi = min(lo, nxt), max(hi, nxt)
        zones.append((lo, hi))
    out = []
    for index, (lo, hi) in enumerate(zones):
        long_total, short_total = float(longs[lo:hi + 1].sum()), float(shorts[lo:hi + 1].sum())
        if long_total + short_total <= 0:
            continue
        mask = (keys - base >= lo) & (keys - base <= hi)
        out.append({"low": float(f"{(lo + base) * width:.10g}"), "high": float(f"{(hi + base + 1) * width:.10g}"), "long": long_total, "short": short_total,
                    "total": long_total + short_total, "side": "long" if long_total >= short_total else "short",
                    "last": int(known[mask].max()), "first": int(known[mask].min())})
    out.sort(key=lambda z: -z["total"])
    return out


def pick_zones(zones, price):
    """Las zonas que mostraría el indicador con ese precio: hasta PER_SIDE por lado dentro de MAX_DISTANCE_PCT."""
    if not zones or not math.isfinite(price):
        return []
    top = zones[0]["total"]
    gap = price * MIN_GAP_PCT / 100
    chosen, above, below = [], 0, 0
    for zone in zones:
        if zone["total"] < MIN_SHARE * top:
            continue
        side = 1 if zone["low"] > price else (-1 if zone["high"] < price else 0)
        distance = (zone["low"] - price) / price * 100 if side > 0 else ((price - zone["high"]) / price * 100 if side < 0 else 0)
        if side and ((above if side > 0 else below) >= PER_SIDE or distance > MAX_DISTANCE_PCT):
            continue
        if any(max(o["low"], zone["low"]) - min(o["high"], zone["high"]) < gap for o in chosen):
            continue
        chosen.append({**zone, "share": zone["total"] / top})
        above += side > 0
        below += side < 0
    return chosen


def zones_at(symbol, t, price, sources=None, cache=None):
    """(zonas mostradas, id de la fuente) con lo conocido hasta t. (None, None) sin datos en esa fecha.
    cache: dict para no rearmar el histograma mientras no lleguen celdas nuevas ni cambie el ancho de franja."""
    sources = liq_store._sources(symbol) if sources is None else sources
    found = _source_at(sources, t)
    if found is None:
        return None, None
    data, info = found
    first, stop = np.searchsorted(data["known"], [t - LOOKBACK_DAYS * DAY_MS, t], side="right")
    if stop <= first:
        return [], info["id"]
    part = slice(first, stop)
    # El ancho de celda con lo conocido hasta t, no el de todo el archivo (F-16)
    width = max(nice_step(price * BIN_PCT / 100), liq_store.known_width(data, int(stop)))
    key = (info["id"], int(first), int(stop), width)
    zones = cache.get(key) if cache is not None else None
    if zones is None:
        zones = build_zones(data["low"][part], data["high"][part], data["long"][part], data["short"][part], data["known"][part], width)
        if cache is not None:
            if len(cache) > 50:
                cache.clear()
            cache[key] = zones
    return pick_zones(zones, price), info["id"]


def zone_sweeps(symbol, bars, reclaim_bars=3, sources=None):
    """
    Zonas barridas de lado a lado: {i, dir, price: borde pasado, r, extreme, zone, source}. La zona debe existir
    con el precio entero de un lado (queda armada) antes de que una vela pase su borde contrario.
    """
    sources = liq_store._sources(symbol) if sources is None else sources
    n = len(bars)
    closes = [b["c"] for b in bars]
    armed, cache, out = {}, {}, []
    for i, bar in enumerate(bars):
        zones, source = zones_at(symbol, bar["t"], bar["o"], sources, cache)
        # Protocolo de pruebas, H23 (22/11/2026): una zona que deja de mostrarse se desarma. Antes seguía armada sin
        # límite (hasta 836 días en BTC) y salía un barrido aunque la vela ni tocara la zona
        shown = {(z["low"], z["high"]) for z in zones or []}
        for key in [key for key in armed if (key[0], key[1]) not in shown]:
            del armed[key]
        if not zones:
            continue
        if len(armed) > 5000:
            armed.clear()
        for zone in zones:
            for d in (1, -1):
                key = (zone["low"], zone["high"], d)
                level = zone["low"] if d > 0 else zone["high"]
                beyond = bar["l"] < level if d > 0 else bar["h"] > level
                clear = bar["l"] > zone["high"] if d > 0 else bar["h"] < zone["low"]
                if armed.get(key) and beyond:
                    armed[key] = False
                    r = next((x for x in range(i, min(n, i + reclaim_bars + 1)) if (closes[x] - level) * d > 0), None)
                    span = bars[i:(r if r is not None else i) + 1]
                    out.append({"i": i, "dir": d, "price": level, "r": r, "zone": zone, "source": source, "zones": zones,
                                "extreme": min(b["l"] for b in span) if d > 0 else max(b["h"] for b in span)})
                elif clear:
                    armed[key] = True
    return out


def _zone_rows(zones, swept=None):
    """Las zonas a la vista en el barrido, para dibujarlas con el trade: [bajo, alto, usd, lado, barrida]."""
    return [[round(z["low"], 8), round(z["high"], 8), round(z["total"]), z["side"], z is swept or (swept is not None and z["low"] == swept["low"])]
            for z in zones]


def _is_pivot(window, value, sign):
    extreme = min(window) if sign > 0 else max(window)
    return value == extreme and window.count(extreme) == 1


def sweeps(bars, swing_bars=5, reclaim_bars=3):
    """
    Cada swing barrido, en orden de vela: {i: vela del barrido, j: vela del swing, dir, price, r: vela que cierra
    de vuelta o None, extreme: lo más lejos que llegó hasta la vela r (o la del barrido)}.
    """
    n, tf_ms = len(bars), (bars[1]["t"] - bars[0]["t"]) if len(bars) > 1 else 60000
    highs, lows, closes = [b["h"] for b in bars], [b["l"] for b in bars], [b["c"] for b in bars]
    max_age = max(1, MAX_SWING_AGE_DAYS * DAY_MS // tf_ms)
    active = {1: [], -1: []}  # (precio, vela), los mínimos y los máximos sin barrer
    out = []
    for i in range(n):
        # Primero el barrido con los swings ya confirmados; después se confirma el swing de i - swing_bars
        for d, values in ((1, lows), (-1, highs)):
            kept = []
            for price, j in active[d]:
                if i - j > max_age:
                    continue
                if (values[i] - price) * d < 0:
                    r = next((x for x in range(i, min(n, i + reclaim_bars + 1)) if (closes[x] - price) * d > 0), None)
                    last = r if r is not None else i
                    span = values[i:last + 1]
                    out.append({"i": i, "j": j, "dir": d, "price": price, "r": r, "extreme": min(span) if d > 0 else max(span)})
                else:
                    kept.append((price, j))
            active[d] = kept
        j = i - swing_bars
        if j >= swing_bars:
            for d, values in ((1, lows), (-1, highs)):
                if _is_pivot(values[j - swing_bars:i + 1], values[j], d):
                    active[d].append((values[j], j))
    return out


def _volume_events(bars, tf_ms):
    """VH: velas con VOLUME_TIMES veces el volumen medio de su misma hora en los LOOKBACK_DAYS días anteriores."""
    history, out = {}, []
    for b in bars:
        slot = (b["t"] % DAY_MS) // tf_ms
        past = history.setdefault(slot, [])
        while past and b["t"] - past[0][0] > LOOKBACK_DAYS * DAY_MS:
            past.pop(0)
        if len(past) >= VOLUME_MIN_DAYS and b["c"] != b["o"]:
            normal = sum(v for _, v in past) / len(past)
            if normal > 0 and b["vol"] >= VOLUME_TIMES * normal:
                out.append({"code": "VH", "dir": 1 if b["c"] > b["o"] else -1, "t": b["t"], "known": b["t"] + tf_ms,
                            "lo": b["l"], "hi": b["h"], "info": {"volTimes": round(b["vol"] / normal, 2)}})
        past.append((b["t"], b["vol"]))
    return out


def events(symbol, bars, tf, swing_bars=5, variant="pierce", reclaim_bars=3, atr=None, sources=None, what="swing"):
    """Eventos LIQ, SWP y VH de las velas, con la forma de los de of_elements más `info` para el registro.
    what: "swing" (un swing dentro de una zona) o "zone" (la zona misma, de lado a lado). SWP siempre es de swings."""
    tf_ms = int(tf) * 60000
    out = _volume_events(bars, tf_ms)
    sources = liq_store._sources(symbol) if sources is None else sources
    if not sources:
        return out
    by_bar = {}
    for s in sweeps(bars, swing_bars, reclaim_bars):
        by_bar.setdefault(s["i"], []).append(s)
    for i, found in by_bar.items():
        bar = bars[i]
        zones, source = zones_at(symbol, bar["t"], bar["o"], sources)
        if zones is None:
            continue
        for d in (1, -1):
            side = [s for s in found if s["dir"] == d]
            if variant == "reclaim":
                side = [s for s in side if s["r"] is not None]
            if not side:
                continue
            # Varios swings barridos por la misma vela son un solo evento: manda el que tiene la zona mayor
            best, best_zone = None, None
            for s in side:
                margin = s["price"] * TOLERANCE_PCT / 100
                zone = next((z for z in zones if z["low"] - margin <= s["price"] <= z["high"] + margin), None)
                if zone is not None and (best_zone is None or zone["total"] > best_zone["total"]):
                    best, best_zone = s, zone
            code = "LIQ" if best is not None else "SWP"
            if best is None:
                best = max(side, key=lambda s: (s["extreme"] - s["price"]) * -d)
            last = best["r"] if variant == "reclaim" else i
            extreme = best["extreme"] if variant == "reclaim" else (bar["l"] if d > 0 else bar["h"])
            unit = atr[i] if atr is not None and atr[i] > 0 else None
            info = {"swing": best["price"], "swingAgeBars": i - best["j"], "extreme": extreme, "source": source,
                    "depthAtr": round(abs(best["price"] - extreme) / unit, 3) if unit else None, "swept": len(side),
                    "t": bar["t"], "swingT": bars[best["j"]]["t"]}
            if best_zone is not None:
                info.update(zoneLow=best_zone["low"], zoneHigh=best_zone["high"], zones=_zone_rows(zones, best_zone),
                            usd=round(best_zone["total"]), longUsd=round(best_zone["long"]), shortUsd=round(best_zone["short"]),
                            zoneSide=best_zone["side"], share=round(best_zone["share"], 3),
                            zoneAgeDays=round((bar["t"] - best_zone["last"]) / DAY_MS, 2))
            out.append({"code": code, "dir": d, "t": bar["t"], "known": bars[last]["t"] + tf_ms,
                        "lo": min(extreme, best["price"]), "hi": max(extreme, best["price"]), "info": info})
    if what == "zone":
        out = [e for e in out if e["code"] != "LIQ"]
        for s in zone_sweeps(symbol, bars, reclaim_bars, sources):
            if variant == "reclaim" and s["r"] is None:
                continue
            i, d, zone = s["i"], s["dir"], s["zone"]
            last = s["r"] if variant == "reclaim" else i
            extreme = s["extreme"] if variant == "reclaim" else (bars[i]["l"] if d > 0 else bars[i]["h"])
            unit = atr[i] if atr is not None and atr[i] > 0 else None
            info = {"swing": s["price"], "swingAgeBars": None, "extreme": extreme, "source": s["source"], "what": "zone",
                    "depthAtr": round(abs(s["price"] - extreme) / unit, 3) if unit else None, "swept": 1,
                    "zoneLow": zone["low"], "zoneHigh": zone["high"], "t": bars[i]["t"], "zones": _zone_rows(s["zones"], zone),
                    "usd": round(zone["total"]), "longUsd": round(zone["long"]), "shortUsd": round(zone["short"]),
                    "zoneSide": zone["side"], "share": round(zone["share"], 3),
                    "zoneAgeDays": round((bars[i]["t"] - zone["last"]) / DAY_MS, 2)}
            out.append({"code": "LIQ", "dir": d, "t": bars[i]["t"], "known": bars[last]["t"] + tf_ms,
                        "lo": min(extreme, s["price"]), "hi": max(extreme, s["price"]), "info": info})
    out.sort(key=lambda e: e["known"])
    return out


def first_day(symbol):
    """Primer día con liquidaciones del símbolo (ms), o None."""
    firsts = [info["first"] for _, info in liq_store._sources(symbol)]
    return min(firsts) if firsts else None
