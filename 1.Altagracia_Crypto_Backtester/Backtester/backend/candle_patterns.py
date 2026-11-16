# candle_patterns.py - Regla de los patrones de vela de "Rejection Patterns" (16/11/2026).
#
# Repite linea por linea frontend/src/components/indicators/candlePatterns.js (el detector del navegador, modo
# "todos"): este es el del servidor (modo "validado" y la suite). Un cambio se hace en los dos y se corre
# tests/test_candle_patterns.py, que compara los dos con node. La explicacion de cada regla esta en el archivo JS.
import math
from typing import Dict, List, Optional

SHAPE = {"dojiBody": 0.05, "maxBody": 0.33, "oppositeWick": 0.10, "engulfedMinBody": 0.10, "engulfingMinBody": 0.30}
BULLISH = {"HAMMER", "DOJI_DRAGONFLY", "ENGULFING_BULLISH"}


def _parts(c: Dict) -> Dict[str, float]:
    top = max(c["open"], c["close"])
    bottom = min(c["open"], c["close"])
    return {"range": c["high"] - c["low"], "body": top - bottom, "upper": c["high"] - top, "lower": bottom - c["low"],
            "top": top, "bottom": bottom}


def shape_of(prev: Optional[Dict], cur: Dict, min_wick_ratio: float = 2.0, enabled: Optional[Dict] = None) -> Optional[str]:
    """La forma de una vela (con la anterior, para el envolvente), sin contexto. None si no es ninguna."""
    enabled = enabled or {}
    on = lambda key: enabled.get(key) is not False  # noqa: E731
    k = _parts(cur)
    if not k["range"] > 0:
        return None
    if k["body"] <= SHAPE["dojiBody"] * k["range"]:
        if not on("doji"):
            return None
        if k["upper"] <= SHAPE["oppositeWick"] * k["range"]:
            return "DOJI_DRAGONFLY"
        if k["lower"] <= SHAPE["oppositeWick"] * k["range"]:
            return "DOJI_GRAVESTONE"
        return None
    if prev is not None and on("engulfing"):
        p = _parts(prev)
        prev_bull = prev["close"] > prev["open"]
        cur_bull = cur["close"] > cur["open"]
        if (p["range"] > 0 and prev_bull != cur_bull and prev["close"] != prev["open"]
                and p["body"] >= SHAPE["engulfedMinBody"] * p["range"] and k["body"] >= SHAPE["engulfingMinBody"] * k["range"]
                and k["body"] > p["body"] and k["bottom"] <= p["bottom"] and k["top"] >= p["top"]):
            return "ENGULFING_BULLISH" if cur_bull else "ENGULFING_BEARISH"
    if k["body"] <= SHAPE["maxBody"] * k["range"]:
        if on("hammer") and k["lower"] >= min_wick_ratio * k["body"] and k["upper"] <= SHAPE["oppositeWick"] * k["range"]:
            return "HAMMER"
        if on("shootingStar") and k["upper"] >= min_wick_ratio * k["body"] and k["lower"] <= SHAPE["oppositeWick"] * k["range"]:
            return "SHOOTING_STAR"
    return None


def volume_z(candles: List[Dict], i: int, lookback: int = 20) -> Optional[float]:
    """Z-score del volumen de la vela i contra las `lookback` anteriores (sin ella). None sin velas suficientes."""
    if i < lookback:
        return None
    vols = [float(candles[j].get("volume") or 0) for j in range(i - lookback, i)]
    mean = sum(vols) / lookback
    std = math.sqrt(sum((v - mean) ** 2 for v in vols) / lookback)
    if std == 0:
        return 0.0
    return (float(candles[i].get("volume") or 0) - mean) / std


def trend_fits(candles: List[Dict], i: int, pattern_type: str, bars: int = 5) -> bool:
    """Si la tendencia previa acompana al patron: bajista antes de uno alcista, alcista antes de uno bajista."""
    if i - 1 - bars < 0:
        return False
    last, before = candles[i - 1]["close"], candles[i - 1 - bars]["close"]
    return last < before if pattern_type in BULLISH else last > before


def _num(value, default):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def rule_options(config: Optional[Dict] = None) -> Dict:
    """Opciones de la regla a partir de la configuracion del indicador (la misma forma que en el navegador)."""
    config = config or {}
    p = config.get("patterns") or {}
    v = config.get("volumeZScore") or {}
    f = config.get("filters") or {}
    hammer, star = p.get("hammer") or {}, p.get("shootingStar") or {}
    wick = hammer.get("minWickRatio", star.get("minWickRatio", 2.0))
    return {
        "minWickRatio": _num(wick, 2.0) or 2.0,
        "enabled": {"hammer": hammer.get("enabled") is not False, "shootingStar": star.get("enabled") is not False,
                    "engulfing": (p.get("engulfing") or {}).get("enabled") is not False,
                    "doji": bool((p.get("doji") or {}).get("enabled"))},
        "requireTrend": f.get("requireTrend") is not False,
        "trendBars": max(1, int(round(_num(f.get("trendBars"), 5) or 5))),
        "volume": {"enabled": bool(v.get("enabled")), "lookback": max(2, int(round(_num(v.get("lookbackPeriod"), 20) or 20))),
                   "minZ": _num(v.get("minZScore", 1.0), 1.0)},
    }


def find_patterns(candles: List[Dict], opts: Dict) -> List[Dict]:
    """Los patrones de una lista de velas cerradas, en orden: [{index, type, volumeZ}]."""
    out = []
    for i in range(1, len(candles or [])):
        kind = shape_of(candles[i - 1], candles[i], opts["minWickRatio"], opts["enabled"])
        if not kind:
            continue
        if opts["requireTrend"] and not trend_fits(candles, i, kind, opts["trendBars"]):
            continue
        z = volume_z(candles, i, opts["volume"]["lookback"])
        if opts["volume"]["enabled"] and (z is None or z < opts["volume"]["minZ"]):
            continue
        out.append({"index": i, "type": kind, "volumeZ": z})
    return out
