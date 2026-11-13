# swing_rules.py - Reglas del Swing Detector de App 1, en Python, para que el servidor detecte lo mismo que
# dibuja el grafico.
#
# Es la misma regla de detectSwings() en
# 1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/indicators/SwingDetectorIndicator.js:
#   - swing alto: el maximo de la vela es mayor que el de las swingBars velas de cada lado (un empate no cuenta);
#     swing bajo: lo mismo con el minimo. El precio de la senal es ese maximo o minimo, no el cierre;
#   - z-score del volumen contra las lookbackBars velas anteriores, con la desviacion de la poblacion;
#   - zonas de precio (priceZones): las que tienen hora mandan, y si hay zonas activas y ninguna coincide, no hay senal;
#   - filtro VWAP: solo dentro de un rectangulo del grafico (los que no definen un VP Fixed), con las bandas
#     upper_N / lower_N del VWAP. Afuera de los rectangulos la senal no cambia: no son lista blanca.
# Un cambio en esa regla se hace en los dos archivos y se corre server/tests/swing_checks.py, que compara los dos.
#
# Aqui no hay red ni archivos: velas, VWAP y rectangulos llegan como argumentos.
import math

INTERVAL_MS = {"1": 60_000, "5": 300_000, "15": 900_000, "60": 3_600_000, "240": 14_400_000}
DIRECTIONS = ("BOTH", "LONG", "SHORT")

# Valores de fabrica del indicador de App 1 (su constructor)
DEFAULT_RULES = {
    "swingBars": 5,
    "direction": "BOTH",
    "volumeFilter": {"enabled": True, "minZScore": 0, "lookbackBars": 20},
    "vwapFilter": {"enabled": False, "deviations": [1, 2, 3], "marginPercent": 20, "skipVolumeInRectangle": False},
    "priceZones": [],
}

# Limites que acepta el servidor. El modal de App 1 es mas estrecho (swingBars 2-15, lookback 10-50, z 0-3)
LIMITS = {"swingBars": (1, 20), "lookbackBars": (2, 200), "minZScore": (0.0, 5.0), "marginPercent": (0.0, 100.0)}


def _number(value) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _bounded(value, name, low, high, integer=False):
    if not _number(value) or (integer and float(value) != int(value)):
        raise ValueError(f"{name} debe ser un numero{' entero' if integer else ''}")
    if not low <= value <= high:
        raise ValueError(f"{name} debe estar entre {low} y {high}")
    return int(value) if integer else float(value)


def clean_zone(zone: dict) -> dict:
    """Una zona de precio valida, con los campos que lee la regla. Otro valor: ValueError."""
    if not isinstance(zone, dict):
        raise ValueError("cada zona debe ser un objeto")
    low, high = zone.get("min"), zone.get("max")
    if not (_number(low) and _number(high)) or low > high:
        raise ValueError("una zona necesita min <= max")
    direction = zone.get("direction", "BOTH")
    if direction not in DIRECTIONS:
        raise ValueError("la direccion de una zona es BOTH, LONG o SHORT")
    out = {"id": str(zone.get("id") or "")[:80], "min": low, "max": high, "direction": direction,
           "enabled": zone.get("enabled") is not False, "timeBound": bool(zone.get("timeBound"))}
    for key in ("symbol", "sourceRectId", "label"):
        if zone.get(key):
            out[key] = str(zone[key])[:80]
    if out["timeBound"]:
        start, end = zone.get("timeStart"), zone.get("timeEnd")
        if not (_number(start) and _number(end)) or start > end:
            raise ValueError("una zona con hora necesita timeStart <= timeEnd")
        out["timeStart"], out["timeEnd"] = int(start), int(end)
    if not out["id"]:
        raise ValueError("cada zona necesita un id")
    return out


def clean_rules(rules: dict, base: dict = None) -> dict:
    """Reglas completas: `rules` sobre `base` (las de fabrica si no hay), campo por campo, como updateConfig() de App 1.
    Un valor fuera de rango o de otro tipo: ValueError con el motivo."""
    if not isinstance(rules, dict):
        raise ValueError("las reglas deben ser un objeto")
    base = base or DEFAULT_RULES
    out = {"swingBars": base["swingBars"], "direction": base["direction"],
           "volumeFilter": dict(base["volumeFilter"]), "vwapFilter": dict(base["vwapFilter"]),
           "priceZones": [dict(z) for z in base.get("priceZones", [])]}
    if "swingBars" in rules:
        out["swingBars"] = _bounded(rules["swingBars"], "swingBars", *LIMITS["swingBars"], integer=True)
    if "direction" in rules:
        if rules["direction"] not in DIRECTIONS:
            raise ValueError("direction es BOTH, LONG o SHORT")
        out["direction"] = rules["direction"]
    volume = rules.get("volumeFilter")
    if volume is not None:
        if not isinstance(volume, dict):
            raise ValueError("volumeFilter debe ser un objeto")
        if "enabled" in volume:
            out["volumeFilter"]["enabled"] = bool(volume["enabled"])
        if "minZScore" in volume:
            out["volumeFilter"]["minZScore"] = _bounded(volume["minZScore"], "minZScore", *LIMITS["minZScore"])
        if "lookbackBars" in volume:
            out["volumeFilter"]["lookbackBars"] = _bounded(volume["lookbackBars"], "lookbackBars", *LIMITS["lookbackBars"], integer=True)
    vwap = rules.get("vwapFilter")
    if vwap is not None:
        if not isinstance(vwap, dict):
            raise ValueError("vwapFilter debe ser un objeto")
        if "enabled" in vwap:
            out["vwapFilter"]["enabled"] = bool(vwap["enabled"])
        if "deviations" in vwap:
            devs = vwap["deviations"]
            # Puede quedar vacia, como en el modal de App 1: el filtro descarta entonces lo que cae en un rectangulo
            if (not isinstance(devs, list) or len(devs) > 6
                    or not all(_number(d) and float(d) == int(d) and 1 <= d <= 6 for d in devs)):
                raise ValueError("deviations es una lista de bandas entre 1 y 6")
            out["vwapFilter"]["deviations"] = sorted({int(d) for d in devs})
        if "marginPercent" in vwap:
            out["vwapFilter"]["marginPercent"] = _bounded(vwap["marginPercent"], "marginPercent", *LIMITS["marginPercent"])
        if "skipVolumeInRectangle" in vwap:
            out["vwapFilter"]["skipVolumeInRectangle"] = bool(vwap["skipVolumeInRectangle"])
    if "priceZones" in rules:
        zones = rules["priceZones"]
        if not isinstance(zones, list) or len(zones) > 200:
            raise ValueError("priceZones es una lista de hasta 200 zonas")
        out["priceZones"] = [clean_zone(z) for z in zones]
    return out


def rectangle_zones(shapes, excluded_ids=()) -> list:
    """Los rectangulos de los dibujos de la moneda como zonas del filtro VWAP, como _rectangleZones() de App 1.
    Los dibujos se guardan con price1/time1/price2/time2; el rectangulo de App 1 toma de ahi su alto, bajo,
    inicio y fin. No cuentan los que definen un VP Fixed (`excluded_ids`)."""
    excluded = set(excluded_ids or ())
    zones = []
    for shape in shapes or []:
        if not isinstance(shape, dict) or shape.get("type") != "rectangle" or shape.get("id") in excluded:
            continue
        values = [shape.get(k) for k in ("price1", "price2", "time1", "time2")]
        if not all(_number(v) for v in values):
            continue
        p1, p2, t1, t2 = values
        zones.append({"id": f"rect_{shape.get('id')}", "sourceRectId": shape.get("id"), "enabled": True,
                      "direction": "BOTH", "timeBound": True, "min": min(p1, p2), "max": max(p1, p2),
                      "timeStart": min(t1, t2), "timeEnd": max(t1, t2)})
    return zones


def known_at(timestamp: int, swing_bars: int, interval: str) -> int:
    """Hora en que se conoce la senal: el cierre de la ultima de las swingBars velas de su derecha."""
    return int(timestamp) + (int(swing_bars) + 1) * INTERVAL_MS[interval]


# ---------- la regla, linea por linea como detectSwings() ----------
def _is_swing_high(candles, idx, bars):
    current = candles[idx]["high"]
    for i in range(idx - bars, idx):
        if candles[i]["high"] >= current:
            return False
    for i in range(idx + 1, idx + bars + 1):
        if candles[i]["high"] >= current:
            return False
    return True


def _is_swing_low(candles, idx, bars):
    current = candles[idx]["low"]
    for i in range(idx - bars, idx):
        if candles[i]["low"] <= current:
            return False
    for i in range(idx + 1, idx + bars + 1):
        if candles[i]["low"] <= current:
            return False
    return True


def _volume_zscore(volumes, idx, lookback):
    # Como _calculateVolumeZScore(): suma de izquierda a derecha (sum() de Python compensa y daria otro decimal),
    # varianza de la poblacion y 0 si no hay variacion
    if idx < lookback:
        return 0
    window = volumes[idx - lookback:idx]
    if len(window) < 2:
        return 0
    total = 0.0
    for v in window:
        total += v
    mean = total / len(window)
    acc = 0.0
    for v in window:
        d = v - mean
        acc += d * d
    stdev = math.sqrt(acc / len(window))
    if stdev == 0:
        return 0
    return (volumes[idx] - mean) / stdev


def _check_price_zones(price, zones, signal_direction, timestamp):
    time_bound = [z for z in zones if z.get("timeBound") and z.get("timeStart") and z.get("timeEnd")]
    manual = [z for z in zones if not z.get("timeBound")]
    for zone in time_bound:
        if zone["min"] <= price <= zone["max"] and zone["timeStart"] <= timestamp <= zone["timeEnd"]:
            # Zona activa: si la direccion no coincide, bloquea aunque una zona manual la acepte
            return zone if zone.get("direction") in ("BOTH", signal_direction) else None
    for zone in manual:
        if zone["min"] <= price <= zone["max"] and zone.get("direction") in ("BOTH", signal_direction):
            return zone
    return None


def _inside_rectangle(price, timestamp, zones):
    for zone in zones:
        if not zone.get("sourceRectId"):
            continue
        if zone["min"] <= price <= zone["max"]:
            if zone.get("timeBound"):
                if zone["timeStart"] <= timestamp <= zone["timeEnd"]:
                    return True
            else:
                return True
    return False


def _vwap_side(timestamp, price, vwap_map, vwap_times, deviations, margin_percent):
    """'SHORT' sobre la banda alta, 'LONG' bajo la baja, 'BOTH' sin bandas y None entre bandas (rechaza)."""
    point = vwap_map.get(timestamp)
    if point is None:
        # El punto anterior mas cercano
        lo, hi = 0, len(vwap_times)
        while lo < hi:
            mid = (lo + hi) // 2
            if vwap_times[mid] <= timestamp:
                lo = mid + 1
            else:
                hi = mid
        point = vwap_map.get(vwap_times[lo - 1]) if lo else None
    if point is None or point.get("bands") is None:
        return "BOTH"
    bands, vwap = point["bands"], point["vwap"]
    margin = margin_percent / 100
    for dev in sorted(deviations):
        upper, lower = bands.get(f"upper_{dev}"), bands.get(f"lower_{dev}")
        if upper is None or lower is None:
            continue
        if price >= upper - (upper - vwap) * margin:
            return "SHORT"
        if price <= lower + (vwap - lower) * margin:
            return "LONG"
    return None


def detect(candles, rules: dict, symbol: str = None, vwap_points=None, rect_zones=None) -> list:
    """Senales de swing en `candles` (en orden, solo velas cerradas), con las reglas de App 1.

    vwap_points: puntos {timestamp, vwap, bands} del VWAP, o None si el VWAP no esta (como el indicador VWAP apagado
    en App 1: sin el, el filtro VWAP no actua). rect_zones: los rectangulos de rectangle_zones()."""
    n = rules["swingBars"]
    if not candles or len(candles) < n * 2 + 1:
        return []
    volume = rules["volumeFilter"]
    vwap_filter = rules["vwapFilter"]
    use_vwap = bool(vwap_filter["enabled"]) and vwap_points is not None
    rect_zones = (rect_zones or []) if use_vwap else []
    vwap_map = {p["timestamp"]: p for p in (vwap_points or []) if isinstance(p, dict) and "timestamp" in p} if use_vwap else {}
    vwap_times = sorted(vwap_map)
    lookback = volume["lookbackBars"]
    volumes = [c.get("volume") or 0 for c in candles]
    active = [z for z in rules.get("priceZones", []) if z.get("enabled") and (not z.get("symbol") or z.get("symbol") == symbol)]
    direction = rules["direction"]
    signals = []
    for i in range(max(n, lookback), len(candles) - n):
        candle = candles[i]
        timestamp = candle["timestamp"]
        is_high = _is_swing_high(candles, i, n)
        is_low = _is_swing_low(candles, i, n)
        if not is_high and not is_low:
            continue
        if direction == "LONG" and is_high:
            continue
        if direction == "SHORT" and is_low:
            continue
        # Una vela que es swing alto y bajo a la vez queda como alto, con su maximo (App 1 tomaba el minimo hasta el 12/11)
        signal_direction = "SHORT" if is_high else "LONG"
        price = candle["high"] if is_high else candle["low"]
        zone = _check_price_zones(price, active, signal_direction, timestamp)
        if active and not zone:
            continue
        in_rect = _inside_rectangle(price, timestamp, active) or _inside_rectangle(price, timestamp, rect_zones)
        if use_vwap and in_rect and vwap_map:
            side = _vwap_side(timestamp, price, vwap_map, vwap_times, vwap_filter["deviations"], vwap_filter["marginPercent"])
            if side is None:
                continue
            wanted = (zone.get("direction") if zone else None) or "BOTH"
            if wanted == "BOTH":
                if side != signal_direction and side != "BOTH":
                    continue
            elif side != wanted and side != "BOTH":
                continue
        z = _volume_zscore(volumes, i, lookback)
        check_volume = (volume["enabled"] and volume["minZScore"] > 0
                        and not (in_rect and vwap_filter["skipVolumeInRectangle"]))
        if check_volume and z < volume["minZScore"]:
            continue
        signals.append({"timestamp": timestamp, "type": "SWING_HIGH" if is_high else "SWING_LOW", "price": price,
                        "direction": signal_direction, "volumeZScore": z, "candleIndex": i,
                        "zoneId": (zone.get("id") or None) if zone else None, "isInRectangle": in_rect})
    return signals


def gap_around(candles, index: int, swing_bars: int, interval: str) -> bool:
    """True si las velas de la ventana del swing no son seguidas (falta alguna vela entre ellas)."""
    step = INTERVAL_MS[interval]
    lo, hi = max(0, index - swing_bars), min(len(candles) - 1, index + swing_bars)
    return candles[hi]["timestamp"] - candles[lo]["timestamp"] != (hi - lo) * step
