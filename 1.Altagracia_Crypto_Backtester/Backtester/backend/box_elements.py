"""
Elementos del probador hechos con las cajas de la eficiencia con caja (regime_detectors.er_box), sin futuro:

- BX, ruptura de caja: la primera vela que cierra fuera de una caja vigente, a favor de ese lado (desde el motor 7,
  23/11/2026: antes era la vela que la terminaba, a más de 0.5 ATR, o la que seguía a una caja terminada por su
  eficiencia aunque cerrara dentro, F-18). Se conoce al cierre de esa vela. La zona es la caja entera.
- BE, borde de caja: dentro de una caja vigente, la vela que llega a la franja del borde (`share` de la caja: 5% de
  fábrica desde el motor 7; antes, la quinta parte) de arriba o de abajo, hacia el centro. Un evento por llegada; se
  rearma cuando una vela cierra en el tercio del centro, desde la vela siguiente (F-19). Filtros del estudio:
  la vela no puede ser grande (cuerpo ≤ `maxBody` ATR) y tiene que cerrar lejos del borde (en su vela, a
  `rejection` o más del extremo del borde). La zona va del borde a su franja: el stop "borde lejano de la zona"
  queda detrás del borde, y el objetivo "centro" es el centro de la caja. Con `pattern`, la vela tiene que ser además
  un patrón de rechazo a favor (martillo, envolvente o doji, con tendencia previa: la regla de candle_patterns).

- CP, compresión: la vela en que se detecta una caja (el mercado entró en rango). No tiene dirección: sale hacia los
  dos lados y está pensada para la entrada con dos órdenes stop, una sobre la caja y otra debajo. La zona es la caja.

Una caja se sabe vigente en la vela i si se detectó antes y todavía no se rompió (la ruptura es la vela end + 1).
"""
import numpy as np

CODES = {"BX": "Ruptura de caja (rango de la pestaña Régimen)", "BE": "Borde de caja, hacia el centro",
         "CP": "Compresión (se detecta una caja; para las dos órdenes stop)"}


def _arrays(bars):
    return {"t": np.array([b["t"] for b in bars], dtype=np.int64),
            **{k: np.array([b[s] for b in bars], dtype=float) for k, s in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))}}


def events(bars, tf, bx=None, be=None, cp=None):
    if not bars or (bx is None and be is None and cp is None):
        return []
    import regime  # Aquí y no arriba: regime importa rule_tester, que importa este módulo
    import regime_detectors as rd
    a = _arrays(bars)
    atr = regime.atr(a["h"], a["l"], a["c"])
    zones = rd.er_box(a, **rd.PARAMS["er_box"]["params"])["zones"]
    step = tf * 60000
    o, h, l, c, t = a["o"], a["h"], a["l"], a["c"], a["t"]
    pattern = np.zeros(len(c))
    if be is not None and be.get("pattern"):
        import candle_patterns
        found = candle_patterns.find_patterns(
            [{"open": o[i], "high": h[i], "low": l[i], "close": c[i], "volume": a["v"][i]} for i in range(len(c))],
            {"minWickRatio": 2.0, "enabled": {"hammer": True, "shootingStar": True, "engulfing": True, "doji": True},
             "requireTrend": True, "trendBars": 5, "volume": {"enabled": False, "lookback": 20, "minZ": 0.0}})
        for p in found:
            pattern[p["index"]] = 1 if p["type"] in ("HAMMER", "ENGULFING_BULLISH", "DOJI_DRAGONFLY") else -1
    out = []
    for z in zones:
        height = z["high"] - z["low"]
        if height <= 0:
            continue
        mid = (z["low"] + z["high"]) / 2
        box = {"low": round(z["low"], 8), "high": round(z["high"], 8), "start": int(t[z["start"]]), "detected": int(t[z["detected"]])}
        if cp is not None:
            i = z["detected"]
            if cp.get("maxHeight") is None or height / atr[i] <= cp["maxHeight"]:
                for side in (1, -1):
                    out.append({"code": "CP", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": z["low"], "hi": z["high"],
                                "info": {**box, "heightAtr": round(float(height / atr[i]), 2)}})
        if bx is not None:
            # La primera vela que cierra fuera de la caja, desde que se conoce hasta la que la termina (motor 7, 23/11/2026:
            # decidido por el usuario, sin el margen de 0.5 ATR con que la caja se da por terminada). Una caja que termina
            # por su eficiencia sin ningún cierre afuera no da ruptura (F-18 del protocolo de pruebas)
            for i in range(z["detected"] + 1, min(z["end"] + 2, len(c))):
                if z["low"] <= c[i] <= z["high"]:
                    continue
                side = 1 if c[i] > z["high"] else -1
                if bx.get("maxHeight") is None or height / atr[i] <= bx["maxHeight"]:
                    out.append({"code": "BX", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": z["low"], "hi": z["high"],
                                "info": {**box, "heightAtr": round(float(height / atr[i]), 2), "bars": int(i - z["start"])}})
                break
        if be is not None:
            share = be["share"]
            armed = {1: True, -1: True}
            for i in range(z["detected"] + 1, min(z["end"] + 1, len(c))):
                # El rearme va después de mirar la llegada de la vela (F-19 del protocolo de pruebas, 23/11/2026): si la
                # vela toca el borde y cierra en el centro, el toque fue antes de volver al centro y no es una llegada nueva
                rearm = abs(c[i] - mid) < height / 6
                for side, hit in ((1, l[i] <= z["low"] + share * height), (-1, h[i] >= z["high"] - share * height)):
                    if not hit or not armed[side]:
                        continue
                    armed[side] = False
                    rng = max(h[i] - l[i], 1e-12)
                    close_at = (c[i] - l[i]) / rng if side > 0 else (h[i] - c[i]) / rng
                    if be["maxBody"] and abs(c[i] - o[i]) > be["maxBody"] * atr[i]:
                        continue
                    if close_at < be["rejection"]:
                        continue
                    if be.get("pattern") and pattern[i] != side:
                        continue
                    lo, hi = (z["low"], z["low"] + share * height) if side > 0 else (z["high"] - share * height, z["high"])
                    out.append({"code": "BE", "dir": side, "t": int(t[i]), "known": int(t[i] + step), "lo": lo, "hi": hi,
                                "info": {**box, "closeAt": round(float(close_at), 2)}})
                if rearm:
                    armed = {1: True, -1: True}
    return out
