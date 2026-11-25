"""
Lector VPA (Volume Price Analysis de Anna Coulling, 2013) para el probador de reglas (21/11/2026): el mismo cálculo de
frontend/src/components/indicators/vpa.js, operación por operación (paridad en frontend/tests/vpa.parity.test.mjs y
tests/test_vpa.py). Si cambia una regla aquí, hay que cambiarla allá.

Reglas propias, no del libro (el libro no trae números): la autora dice que VPA "es un arte" porque juzga todo de forma
relativa, por grados y según dónde cae la vela. Aquí eso va así:
- Relativo: el volumen y el rango de cada vela se comparan con la mediana de esa misma hora en los `days` días anteriores
  (en cripto la hora pesa: medido con el Volumen de Respuesta). En 1D, con los días anteriores. Desde el motor 7
  (24/11/2026, galería 2 del protocolo de pruebas), para los elementos un volumen alto (o un rango ancho) lo es también
  frente a la mediana de las `nearBars` velas anteriores: lo que ve el ojo. El medidor sigue con su hora, salvo en la
  vela ancha con volumen alto, que lee como los elementos (`wideMeter`).
- Por grados: cada lectura es un grado de 0 a 1 con rampas (bajo, alto, ultra alto, estrecho, ancho), no un sí o no.
- Esfuerzo contra resultado (3.ª ley de Wyckoff): q = rango relativo ÷ volumen relativo. Mucho volumen con poco rango es
  esfuerzo sin resultado (absorción); mucho rango con poco volumen, resultado sin esfuerzo (trampa). Desde el motor 7,
  en los elementos el resultado lo da también el tamaño de la vela: una vela ancha con volumen alto tuvo resultado,
  aunque su volumen fuera todavía mayor que su rango (`wideResult`). El medidor la lee igual (`wideMeter`): no le suma
  como esfuerzo sin resultado, contra su color, sino como esfuerzo con resultado, a favor.
- El lugar: el tramo (zigzag de `legAtr` ATR, como el Volumen de Respuesta) y cuánto lleva recorrido. Un martillo arriba
  de un tramo alcista es un "hanging man" y avisa debilidad; una estrella abajo de un tramo bajista, un martillo
  invertido, avisa fuerza (desde el 22/11, H22 del protocolo de pruebas: antes restaba como cualquier estrella).
- Paciencia: ninguna vela decide. Cada vela suma evidencia a un medidor que se desvanece (`decay` por vela): sube con la
  fuerza (alcista) y baja con la debilidad (bajista).

Elementos del probador (solo necesitan velas: valen en todas las monedas, en las acciones y en 1D), todos se saben al
cerrar su vela (`known`):
- QA esfuerzo sin resultado: contra el color de la vela (una verde estrecha con mucho volumen es debilidad). Desde el
  motor 7, no cuenta si la vela anterior fue ancha (`skipAfterWide`): esa sí tuvo resultado y esta es su pausa. Tampoco
  si la vela misma es ancha (`wideResult`): se movió, y eso es resultado.
- QV esfuerzo con resultado (motor 7): la vela ancha con volumen alto, a favor de su color (`wideResult`; sin él, la
  vela validada: además el rango sigue al volumen). Para usarla de gatillo tras un clímax, un frenado o una prueba.
- QB ruptura con volumen y QF ruptura sin volumen: el primer cierre fuera del rango de las `rangeBars` velas anteriores
  (de hasta `maxRangeAtr` ATR de alto); con volumen alto sigue la ruptura, con volumen bajo va en contra (trampa).
- QR retroceso sin volumen: tras una QB, el precio vuelve al nivel roto en `pullBars` velas o menos con poco volumen y
  una vela cierra a favor de la ruptura. Desde el motor 7 (`pullBack`), antes de esa vela al menos una vuelve en contra.
- QT prueba de poco volumen: vela de cuerpo chico, mecha larga y poco volumen que entra a una zona con mucho volumen
  contrario en las `testLook` velas anteriores (la prueba de oferta es alcista; la de demanda, bajista). Desde el motor
  7, solo dentro de una caja de la pestaña Régimen (`testBox`: la de oferta en su mitad de abajo, la de demanda en la de
  arriba) y tras un frenado o un clímax de su lado en las `testLook` velas anteriores (`testAfter`): la prueba que dice
  si terminó la tendencia, como en el libro.
- QS volumen de frenado o de techo: en un tramo de al menos `legAtr` ATR, 2 de las últimas `stopBars` velas con mecha
  contra el tramo (`stopWick`: desde el motor 7, de media vela), cierre en su mitad de ese lado y volumen alto. Contra
  el tramo; una vez por tramo.
- QC clímax: en las últimas `climaxBars` velas, 2 o más con volumen ultra alto y mecha contra el tramo, en el mismo
  precio (a menos de 1 ATR). Contra el tramo; una vez por tramo.
- QE el medidor cruza el umbral `meter`: hacia arriba, alcista; hacia abajo, bajista.
- QG el medidor gira (motor 7): cruza el cero después de haber pasado el umbral del otro lado. QE sirve para seguir el
  movimiento; QG, para el giro (los dos modos que pidió el usuario).

Con los valores de antes de cada parámetro del motor 7 (nearBars 0, skipAfterWide, wideResult, wideMeter, testBox,
testAfter y pullBack apagados, stopWick [0.25, 0.4]) los elementos y el medidor son los del motor 6.

Filtro (filter_ok): el medidor a favor del trade (`favor`: medidor × lado ≥ umbral) o que no esté en contra
(`notAgainst`: medidor × lado > −umbral), en la vela de la señal.
"""
import math

NAN = float("nan")
DAY_MS = 86400000

CODES = {
    "QA": "Esfuerzo sin resultado (VPA)",
    "QV": "Esfuerzo con resultado (VPA)",
    "QB": "Ruptura con volumen (VPA)",
    "QF": "Ruptura sin volumen (VPA)",
    "QR": "Retroceso sin volumen tras la ruptura (VPA)",
    "QT": "Prueba de poco volumen (VPA)",
    "QS": "Volumen de frenado o de techo (VPA)",
    "QC": "Clímax de volumen (VPA)",
    "QE": "Medidor VPA cruza el umbral",
    "QG": "Medidor VPA gira",
}

DEFAULTS = {
    "days": 30, "minDays": 5, "legAtr": 2.0,
    # Rampas de los grados, en veces lo normal de su hora: [donde empieza, donde llega a 1]
    "volLow": [0.6, 0.95], "volHigh": [1.2, 1.8], "volUltra": [2.0, 3.0], "spreadWide": [1.2, 1.8],
    "decay": 0.75, "fire": 0.5, "meter": 1.0,
    "rangeBars": 20, "maxRangeAtr": 6.0, "pullBars": 8, "testLook": 20, "stopBars": 3, "climaxBars": 6,
    # Motor 7 del probador (24/11/2026): lo que decidió el usuario en la galería 2 del protocolo de pruebas
    # (pruebas_backtesting/revision_visual/G2_RESPUESTAS.md). Entre paréntesis, el valor que repite la regla de antes:
    "nearBars": 20,  # El volumen alto (y el rango ancho) de los elementos, también frente a las N velas anteriores (0)
    "skipAfterWide": True,  # El esfuerzo sin resultado no cuenta tras una vela ancha (False)
    # Con volumen alto, la vela ancha tuvo resultado: no es esfuerzo sin resultado, y el esfuerzo con resultado no pide
    # que el rango siga al volumen (False). Lo vio el usuario en el caso 2 de la galería 2
    "wideResult": True,
    # El medidor también: la vela ancha con volumen alto le suma como esfuerzo con resultado, no sin él (False)
    "wideMeter": True,
    "testBox": True,  # La prueba, solo dentro de una caja de la pestaña Régimen (False)
    "testAfter": True,  # La prueba, solo tras un frenado o un clímax de su lado en las testLook velas anteriores (False)
    "stopWick": [0.4, 0.6],  # Rampa de la mecha del frenado o techo: grado 0.5 con media vela ([0.25, 0.4]: un tercio)
    "pullBack": True,  # El retroceso pide una vela en contra de la ruptura antes de la que confirma (False)
}

# La caja de la pestaña Régimen ("Eficiencia con caja", regime_detectors.er_box con sus parámetros de
# regime_detectors.PARAMS): la consolidación de la prueba de poco volumen. tests/test_motor7.py comprueba que es la misma
BOX = {"n": 20, "below": 0.2, "buffer": 0.5, "exit_er": 0.5}

FILTER_MODES = ("favor", "notAgainst", "notFavor")  # notFavor (22/11): que no esté fuerte a favor (el ripple medido)

# Pesos de cada lectura en el medidor
W_ABSORB, W_TRAP, W_VALID, W_SHAPE, W_HANG, W_DOJI, W_FADE = 1.0, 0.8, 0.5, 1.0, 0.5, 0.6, 0.8
FADE_BARS = 4


def _finite(x):
    return x == x and x not in (math.inf, -math.inf)


def up(x, a, b):
    """Rampa que sube: 0 hasta a, 1 desde b."""
    if not _finite(x):
        return 0.0
    if x <= a:
        return 0.0
    if x >= b:
        return 1.0
    return (x - a) / (b - a)


def down(x, full, zero):
    """Rampa que baja: 1 hasta full, 0 desde zero."""
    if not _finite(x):
        return 0.0
    if x <= full:
        return 1.0
    if x >= zero:
        return 0.0
    return (zero - x) / (zero - full)


def _median(values):
    s = sorted(values)
    n = len(s)
    if n % 2:
        return s[n // 2]
    return (s[n // 2 - 1] + s[n // 2]) / 2


def atr_of(h, l, c, n=14):
    """Rango verdadero promedio de Wilder desde la primera vela (como williams.py)."""
    out = [0.0] * len(h)
    for i in range(len(h)):
        previous = c[i - 1] if i else c[0]
        tr = max(h[i] - l[i], abs(h[i] - previous), abs(l[i] - previous))
        out[i] = out[i - 1] + (tr - out[i - 1]) / n if i else tr
    return out


def relative_by_hour(t, values, tf_ms, days, min_days):
    """Cada valor dividido por la mediana de esa misma hora en los `days` días anteriores (NaN con menos de min_days)."""
    out = [NAN] * len(values)
    history = {}
    for i in range(len(values)):
        slot = (t[i] % DAY_MS) // tf_ms if tf_ms < DAY_MS else 0
        seen = history.setdefault(slot, [])
        if len(seen) >= min_days:
            usual = _median(seen[-days:])
            if usual > 0:
                out[i] = values[i] / usual
        seen.append(values[i])
        if len(seen) > days:
            del seen[0]
    return out


def relative_to_near(values, bars):
    """Cada valor dividido por la mediana de los `bars` valores anteriores, sin el suyo (NaN en los primeros o con
    mediana 0). Es lo que compara el ojo: la vela contra las de al lado (motor 7)."""
    out = [NAN] * len(values)
    if bars <= 0:
        return out
    for i in range(bars, len(values)):
        usual = _median(values[i - bars:i])
        if usual > 0:
            out[i] = values[i] / usual
    return out


def boxes(h, l, c, atr):
    """La caja de la pestaña Régimen vigente en cada vela (regime_detectors.er_box con BOX, operación por operación):
    (bajos, altos), NaN fuera de una caja. Vigente desde la vela siguiente a la que la detecta hasta la última que queda
    dentro: en cada vela solo se sabe lo de esa vela y las anteriores."""
    n, m = BOX["n"], len(c)
    low, high = [NAN] * m, [NAN] * m
    path = [0.0] * m  # np.cumsum de |cierre − cierre anterior|, con la primera en cero
    box, run = None, 0
    for i in range(m):
        step = abs(c[i] - (c[i - 1] if i else c[0]))
        path[i] = path[i - 1] + step if i else step
        if i < n:
            continue
        eff = abs(c[i] - c[i - n]) / max(path[i] - path[i - n], 1e-12)
        if box is None:
            run = run + 1 if eff < BOX["below"] else 0
            if run >= 1:
                start = i - n + 1
                box = (min(l[start:i + 1]), max(h[start:i + 1]))
            continue
        if c[i] > box[1] + BOX["buffer"] * atr[i] or c[i] < box[0] - BOX["buffer"] * atr[i] or eff > BOX["exit_er"]:
            box, run = None, 0
            continue
        low[i], high[i] = box
    return low, high


def zigzag(h, l, c, atr, k):
    """Tramo conocido al cierre de cada vela (la regla de measures.zigzag): dirección, inicio y extremo."""
    n = len(c)
    direction, start, extreme = [0] * n, [0] * n, [0.0] * n
    now_dir, now_start, now_extreme, extreme_at = 1, 0, h[0] if n else 0.0, 0
    for i in range(n):
        if now_dir == 1:
            if h[i] >= now_extreme:
                now_extreme, extreme_at = h[i], i
            elif c[i] <= now_extreme - k * atr[i]:
                now_dir, now_start = -1, extreme_at
                j_best = extreme_at
                for j in range(extreme_at, i + 1):
                    if l[j] < l[j_best]:
                        j_best = j
                now_extreme, extreme_at = l[j_best], j_best
        else:
            if l[i] <= now_extreme:
                now_extreme, extreme_at = l[i], i
            elif c[i] >= now_extreme + k * atr[i]:
                now_dir, now_start = 1, extreme_at
                j_best = extreme_at
                for j in range(extreme_at, i + 1):
                    if h[j] > h[j_best]:
                        j_best = j
                now_extreme, extreme_at = h[j_best], j_best
        direction[i], start[i], extreme[i] = now_dir, now_start, now_extreme
    return direction, start, extreme


def _cfg(cfg):
    out = {**DEFAULTS, **(cfg or {})}
    return out


def _absorb_grade(x, y, vh):
    """Esfuerzo sin resultado con volumen x y rango y relativos (NaN si no se puede medir)."""
    if not (_finite(x) and _finite(y) and x > 0):
        return NAN
    return min(up(x, vh[0], vh[1]), down(y / x, 0.35, 0.7))


def _valid_grade(x, y, vh, sw):
    """Esfuerzo con resultado (la vela validada) con volumen x y rango y relativos (NaN si no se puede medir)."""
    if not (_finite(x) and _finite(y) and x > 0):
        return NAN
    return min(up(y, sw[0], sw[1]), up(x, vh[0], vh[1]), up(y / x, 0.6, 0.9))


def compute(t, o, h, l, c, v, tf, cfg=None):
    """Las lecturas de cada vela cerrada (listas del mismo largo que las velas). tf en minutos."""
    cfg = _cfg(cfg)
    n = len(c)
    tf_ms = int(tf) * 60000
    atr = atr_of(h, l, c, 14)
    rng = [h[i] - l[i] for i in range(n)]
    fv = [float(x) for x in v]
    rv = relative_by_hour(t, fv, tf_ms, int(cfg["days"]), int(cfg["minDays"]))
    rr = relative_by_hour(t, rng, tf_ms, int(cfg["days"]), int(cfg["minDays"]))
    near = int(cfg["nearBars"])
    rvn, rrn = relative_to_near(fv, near), relative_to_near(rng, near)
    leg, leg_start, leg_ext = zigzag(h, l, c, atr, cfg["legAtr"])
    vl, vh, vu, sw = cfg["volLow"], cfg["volHigh"], cfg["volUltra"], cfg["spreadWide"]
    keys = ("q", "absorb", "trap", "valid", "upper", "lower", "body", "closeLoc", "star", "hammer", "doji",
            "ext", "maturity", "fade", "contrib", "meter", "rvHi", "wide", "absorbE", "validE")
    out = {k: [NAN] * n for k in keys}
    box_low, box_high = boxes(h, l, c, atr)
    out.update({"atr": atr, "rv": rv, "rr": rr, "leg": leg, "legStart": leg_start, "legExtreme": leg_ext,
                "dir": [0] * n, "hang": [0.0] * n, "invh": [0.0] * n, "rvn": rvn, "rrn": rrn,
                "boxLow": box_low, "boxHigh": box_high})
    meter = 0.0
    for i in range(n):
        d = 1 if c[i] > o[i] else (-1 if c[i] < o[i] else 0)
        out["dir"][i] = d
        r = rng[i]
        contrib = 0.0
        a = atr[i]
        start_price = l[leg_start[i]] if leg[i] == 1 else h[leg_start[i]]
        ext = abs(leg_ext[i] - start_price) / a if a > 0 else NAN
        mat = up(ext, cfg["legAtr"], 3 * cfg["legAtr"])
        out["ext"][i], out["maturity"][i] = ext, mat
        if r > 0:
            top, bottom = max(o[i], c[i]), min(o[i], c[i])
            upper, lower, body = (h[i] - top) / r, (bottom - l[i]) / r, (top - bottom) / r
            out["upper"][i], out["lower"][i], out["body"][i] = upper, lower, body
            out["closeLoc"][i] = (c[i] - l[i]) / r
            out["star"][i] = min(up(upper, 0.45, 0.6), down(body, 0.2, 0.35), down(lower, 0.1, 0.25))
            out["hammer"][i] = min(up(lower, 0.45, 0.6), down(body, 0.2, 0.35), down(upper, 0.1, 0.25))
            out["doji"][i] = min(down(body, 0.05, 0.15), up(min(upper, lower), 0.25, 0.35))
        x, y = rv[i], rr[i]
        # Lo alto de los elementos (motor 7): alto para su hora y frente a las velas anteriores. Sin nearBars, su hora
        if near > 0:
            x_hi = min(x, rvn[i]) if _finite(x) and _finite(rvn[i]) else NAN
            y_wide = min(y, rrn[i]) if _finite(y) and _finite(rrn[i]) else NAN
        else:
            x_hi, y_wide = x, y
        out["rvHi"][i] = x_hi
        out["wide"][i] = up(y_wide, sw[0], sw[1]) if _finite(y_wide) else NAN
        if _finite(x) and _finite(y) and x > 0:
            q = y / x
            out["q"][i] = q
            absorb = min(up(x, vh[0], vh[1]), down(q, 0.35, 0.7))
            trap = min(down(x, vl[0], vl[1]), up(q, 1.6, 2.5), up(y, sw[0], sw[1]))
            valid = min(up(y, sw[0], sw[1]), up(x, vh[0], vh[1]), up(q, 0.6, 0.9))
            out["absorb"][i], out["trap"][i], out["valid"][i] = absorb, trap, valid
            # Las de los elementos: el mismo grado medido también contra las velas anteriores, el menor de los dos.
            # El medidor sigue con el de su hora (absorb y valid), salvo en la vela ancha (abajo)
            if near > 0:
                a2, v2 = _absorb_grade(rvn[i], rrn[i], vh), _valid_grade(rvn[i], rrn[i], vh, sw)
                out["absorbE"][i] = min(absorb, a2) if _finite(a2) else 0.0
                out["validE"][i] = min(valid, v2) if _finite(v2) else 0.0
            else:
                out["absorbE"][i], out["validE"][i] = absorb, valid
            # La vela ancha (contra su hora y las velas anteriores) con volumen alto tuvo resultado: el caso 2 de la
            # galería 2, de 10 veces su rango con 20 veces su volumen, era esfuerzo con resultado
            w = out["wide"][i]
            if cfg["wideResult"] and _finite(w):
                out["absorbE"][i] = min(out["absorbE"][i], 1.0 - w)
                out["validE"][i] = min(w, up(x_hi, vh[0], vh[1]))
            # El medidor la lee igual (lo pidió el usuario): no le suma como esfuerzo sin resultado y le suma como
            # esfuerzo con resultado, con el grado del elemento. Lo demás del medidor sigue con su hora
            if cfg["wideMeter"] and _finite(w):
                absorb = min(absorb, 1.0 - w)
                valid = max(valid, min(w, up(x_hi, vh[0], vh[1])))
                out["absorb"][i], out["valid"][i] = absorb, valid
            against = -d if d else -leg[i]
            contrib += against * absorb * W_ABSORB + against * trap * W_TRAP + d * valid * W_VALID
            weight = 0.25 + 0.35 * up(x, 0.8, 1.2) + 0.4 * up(x, 1.5, 2.5)  # Lo que pesa la forma según su volumen
            if r > 0:
                star, hammer = out["star"][i], out["hammer"][i]
                near_bottom = leg[i] == -1 and a > 0 and (l[i] - leg_ext[i]) / a <= 0.5
                if near_bottom:  # Estrella abajo de un tramo bajista: martillo invertido, fuerza que pide confirmación (H22)
                    out["invh"][i] = star
                    contrib += star * weight * W_HANG * mat
                else:
                    contrib -= star * weight * W_SHAPE * (0.5 + 0.5 * (mat if leg[i] == 1 else 1.0))
                near_top = leg[i] == 1 and a > 0 and (leg_ext[i] - h[i]) / a <= 0.5
                if near_top:  # Martillo arriba de un tramo alcista: hanging man, debilidad que pide confirmación
                    out["hang"][i] = hammer
                    contrib -= hammer * weight * W_HANG * mat
                else:
                    contrib += hammer * weight * W_SHAPE * (0.5 + 0.5 * (mat if leg[i] == -1 else 1.0))
                contrib -= leg[i] * out["doji"][i] * up(x, 1.0, 1.8) * W_DOJI * mat
            if i >= FADE_BARS and a > 0:
                past = rv[i - FADE_BARS] + rv[i - FADE_BARS + 1]
                now = rv[i] + rv[i - 1]
                if _finite(past) and _finite(now) and past > 0:
                    advance = (c[i] - c[i - FADE_BARS]) * leg[i] / a
                    fade = min(up(advance, 0.5, 1.5), down(now / past, 0.6, 0.85))
                    out["fade"][i] = fade
                    contrib -= leg[i] * fade * W_FADE
        meter = meter * cfg["decay"] + contrib
        out["contrib"][i], out["meter"][i] = contrib, meter
    return out


def _plain_sum(values):
    total = 0.0
    for x in values:
        total += x
    return total


def _vol_high(cfg, x):
    return up(x, cfg["volHigh"][0], cfg["volHigh"][1])


def _vol_low(cfg, x):
    return down(x, cfg["volLow"][0], cfg["volLow"][1])


def detect(t, o, h, l, c, v, tf, cfg=None, series=None):
    """Los elementos del lector: {code, dir, index, lo, hi, grade, info}, en orden de vela."""
    cfg = _cfg(cfg)
    s = series or compute(t, o, h, l, c, v, tf, cfg)
    n = len(c)
    fire = cfg["fire"]
    atr, rv, leg, hv = s["atr"], s["rv"], s["leg"], s["rvHi"]
    out = []
    used_stop, used_climax = set(), set()
    breakouts = []  # Rupturas con volumen que todavía esperan su retroceso: {dir, level, index, done}
    R = int(cfg["rangeBars"])
    look = int(cfg["testLook"])
    sw0, sw1 = cfg["stopWick"]
    turned = {1: -10 ** 9, -1: -10 ** 9}  # La última vela con un frenado o un clímax de cada lado (testAfter)
    g_side, g_beyond, g_peak = 0, False, 0.0  # El medidor: de qué lado del cero, si pasó el umbral y hasta dónde llegó
    for i in range(n):
        a = atr[i]
        x = rv[i]
        d = s["dir"][i]
        # Esfuerzo sin resultado; tras una vela ancha no cuenta (esa tuvo resultado: esta es su pausa)
        grade = s["absorbE"][i]
        if grade == grade and grade >= fire and d and not (
                cfg["skipAfterWide"] and i >= 1 and _finite(s["wide"][i - 1]) and s["wide"][i - 1] >= fire):
            out.append({"code": "QA", "dir": -d, "index": i, "lo": l[i], "hi": h[i], "grade": grade,
                        "info": _near_info({"rv": x, "rr": s["rr"][i]}, s, i)})
        # Esfuerzo con resultado
        grade = s["validE"][i]
        if grade == grade and grade >= fire and d:
            out.append({"code": "QV", "dir": d, "index": i, "lo": l[i], "hi": h[i], "grade": grade,
                        "info": _near_info({"rv": x, "rr": s["rr"][i]}, s, i)})
        # Rupturas del rango de las R velas anteriores
        if i > R and _finite(x) and a > 0:
            hi_r, lo_r = max(h[i - R:i]), min(l[i - R:i])
            prev_a = atr[i - 1]
            if hi_r - lo_r <= cfg["maxRangeAtr"] * prev_a:
                for side, level in ((1, hi_r), (-1, lo_r)):
                    crossed = (c[i] - level) * side > 0.1 * a and (c[i - 1] - level) * side <= 0
                    if not crossed:
                        continue
                    strong, weak = _vol_high(cfg, hv[i]), _vol_low(cfg, x)
                    if strong >= fire:
                        lo, hi = (min(l[i], level), level) if side > 0 else (level, max(h[i], level))
                        out.append({"code": "QB", "dir": side, "index": i, "lo": lo, "hi": hi, "grade": strong,
                                    "info": _near_info({"rv": x, "level": level, "height": (hi_r - lo_r) / prev_a}, s, i)})
                        breakouts.append({"dir": side, "level": level, "index": i, "done": False})
                    elif weak >= fire:
                        lo, hi = (level, h[i]) if side > 0 else (l[i], level)
                        out.append({"code": "QF", "dir": -side, "index": i, "lo": lo, "hi": hi, "grade": weak,
                                    "info": {"rv": x, "level": level, "height": (hi_r - lo_r) / prev_a}})
        # Retroceso sin volumen al nivel roto
        for b in breakouts:
            if b["done"] or b["index"] >= i:
                continue
            side, level = b["dir"], b["level"]
            if i - b["index"] > cfg["pullBars"] or (c[i] - level) * side < -0.5 * a:
                b["done"] = True  # Se pasó el plazo, o volvió adentro del rango: ya no es un retroceso
                continue
            touched = (l[i] - level <= 0.5 * a) if side > 0 else (level - h[i] <= 0.5 * a)
            if not touched or d != side or (c[i] - level) * side <= 0:
                continue
            if cfg["pullBack"] and not any(s["dir"][j] == -side for j in range(b["index"] + 1, i)):
                continue  # Ninguna vela volvió en contra de la ruptura: es la ruptura que sigue, no un retroceso
            seg = rv[b["index"] + 1:i + 1]
            if not all(_finite(y) for y in seg):
                continue
            total = 0.0
            for y in seg:  # Suma simple, como vpa.js: sum() de Python 3.12 compensa y da otro último bit
                total += y
            mean = total / len(seg)
            grade = down(mean, 0.7, 1.0)
            if grade >= fire:
                far = min(l[b["index"] + 1:i + 1]) if side > 0 else max(h[b["index"] + 1:i + 1])
                lo, hi = (far, level) if side > 0 else (level, far)
                out.append({"code": "QR", "dir": side, "index": i, "lo": lo, "hi": hi, "grade": grade,
                            "info": {"level": level, "breakout": b["index"], "rv": mean}})
                b["done"] = True
        if breakouts and breakouts[0]["done"]:
            breakouts = [b for b in breakouts if not b["done"]]
        # Prueba de poco volumen: dentro de una consolidación y tras un frenado o un clímax de su lado (motor 7)
        if _finite(x) and s["body"][i] == s["body"][i]:
            weak = _vol_low(cfg, x)
            body_ok = down(s["body"][i], 0.25, 0.4)
            window = range(max(0, i - look), i)
            for side, wick in ((1, s["lower"][i]), (-1, s["upper"][i])):
                grade = min(weak, body_ok, up(wick, 0.45, 0.6))
                if grade < fire:
                    continue
                if cfg["testAfter"] and i - turned[side] > look:
                    continue  # Sin un frenado o un clímax de su lado antes, no hay tendencia que probar
                if cfg["testBox"]:
                    box_lo, box_hi = s["boxLow"][i], s["boxHigh"][i]
                    if not _finite(box_lo):
                        continue  # Fuera de una consolidación
                    mid = (box_lo + box_hi) / 2
                    if (side > 0 and l[i] > mid) or (side < 0 and h[i] < mid):
                        continue  # La prueba de oferta, en la mitad de abajo de la caja; la de demanda, en la de arriba
                # Mucho volumen contrario en las velas anteriores, en el precio al que entra la prueba
                heavy = [j for j in window if _finite(hv[j]) and hv[j] >= cfg["volHigh"][1] and s["dir"][j] == -side
                         and ((l[i] <= h[j]) if side > 0 else (h[i] >= l[j]))]
                if heavy:
                    info = {"rv": x, "heavy": heavy[-1]}
                    if cfg["testAfter"]:
                        info["turn"] = turned[side]
                    out.append({"code": "QT", "dir": side, "index": i, "lo": l[i], "hi": h[i], "grade": grade, "info": info})
        # Volumen de frenado (tramo bajista) o de techo (alcista)
        k = int(cfg["stopBars"])
        if i >= k - 1 and _finite(s["ext"][i]) and s["ext"][i] >= cfg["legAtr"] and (leg[i], s["legStart"][i]) not in used_stop:
            g = leg[i]
            grades = []
            for j in range(i - k + 1, i + 1):
                wick = s["lower"][j] if g < 0 else s["upper"][j]
                loc = s["closeLoc"][j]
                if not (_finite(wick) and _finite(loc) and _finite(hv[j])):
                    grades.append(0.0)
                    continue
                side_loc = loc if g < 0 else 1 - loc
                grades.append(min(up(wick, sw0, sw1), up(side_loc, 0.45, 0.55), _vol_high(cfg, hv[j])))
            hits = [gr for gr in grades if gr >= fire]
            if len(hits) >= 2 and grades[-1] >= fire:
                lo, hi = min(l[i - k + 1:i + 1]), max(h[i - k + 1:i + 1])
                out.append({"code": "QS", "dir": -g, "index": i, "lo": lo, "hi": hi, "grade": _plain_sum(hits) / len(hits),
                            "info": {"bars": len(hits), "leg": g, "ext": s["ext"][i]}})
                used_stop.add((leg[i], s["legStart"][i]))
                turned[-g] = i
        # Clímax
        m = int(cfg["climaxBars"])
        if i >= 1 and (leg[i], s["legStart"][i]) not in used_climax and a > 0:
            g = leg[i]
            hits = []
            for j in range(max(0, i - m + 1), i + 1):
                wick = s["upper"][j] if g > 0 else s["lower"][j]
                if not (_finite(wick) and _finite(hv[j])):
                    continue
                grade = min(up(hv[j], cfg["volUltra"][0], cfg["volUltra"][1]), up(wick, 0.25, 0.4))
                if grade >= fire:
                    hits.append(j)
            if len(hits) >= 2 and hits[-1] == i:
                ends = [h[j] for j in hits] if g > 0 else [l[j] for j in hits]
                if max(ends) - min(ends) <= a:
                    lo, hi = min(l[j] for j in hits), max(h[j] for j in hits)
                    out.append({"code": "QC", "dir": -g, "index": i, "lo": lo, "hi": hi, "grade": 1.0,
                                "info": {"bars": len(hits), "leg": g}})
                    used_climax.add((leg[i], s["legStart"][i]))
                    turned[-g] = i
        if i >= 1:
            now, before, thr = s["meter"][i], s["meter"][i - 1], cfg["meter"]
            # El medidor cruza el umbral
            if now >= thr > before:
                out.append({"code": "QE", "dir": 1, "index": i, "lo": l[i], "hi": h[i], "grade": 1.0, "info": {"meter": now}})
            elif now <= -thr < before:
                out.append({"code": "QE", "dir": -1, "index": i, "lo": l[i], "hi": h[i], "grade": 1.0, "info": {"meter": now}})
            # El medidor gira: cruza el cero después de haber pasado el umbral del otro lado
            side_now = 1 if now > 0 else (-1 if now < 0 else 0)
            if side_now and side_now != g_side:
                if g_side and g_beyond:
                    out.append({"code": "QG", "dir": side_now, "index": i, "lo": l[i], "hi": h[i], "grade": 1.0,
                                "info": {"meter": now, "peak": g_peak}})
                g_side, g_beyond, g_peak = side_now, False, now
            elif side_now and abs(now) > abs(g_peak):
                g_peak = now
            if side_now and abs(now) >= thr:
                g_beyond = True
    out.sort(key=lambda e: (e["index"], e["code"], -e["dir"]))
    return out


def _near_info(info, s, i):
    """La info de un elemento de volumen alto con su volumen frente a las velas anteriores, si se pudo medir."""
    if _finite(s["rvn"][i]):
        info["rvn"] = s["rvn"][i]
    return info


def events(bars, tf, cfg=None, codes=tuple(CODES)):
    """Eventos del probador: {code, dir, t, known, lo, hi, info} con la forma de los de of_elements."""
    tf_ms = int(tf) * 60000
    t = [b["t"] for b in bars]
    o, h, l, c, v = ([b[k] for b in bars] for k in ("o", "h", "l", "c", "vol"))
    out = []
    for e in detect(t, o, h, l, c, v, tf, cfg):
        if e["code"] not in codes:
            continue
        # Con 10 cifras significativas: con 4 decimales una moneda barata perdía cifras del nivel (O-12)
        info = {key: (float(f"{val:.10g}") if isinstance(val, float) and _finite(val) else val) for key, val in e["info"].items()}
        for key in ("breakout", "heavy", "turn"):
            if key in info:
                info[key] = bars[info[key]]["t"]  # La vela, por su hora
        info["grade"] = round(e["grade"], 3)
        tt = bars[e["index"]]["t"]
        out.append({"code": e["code"], "dir": e["dir"], "t": tt, "known": tt + tf_ms, "lo": e["lo"], "hi": e["hi"], "info": info})
    return out


def filter_ok(vf, series, k, side):
    """El medidor en la vela k a favor del trade: favor (medidor × lado ≥ umbral) o notAgainst (> −umbral). Una vela sin
    volumen relativo todavía (los primeros días) no pasa."""
    if not filter_known(series, k):
        return False
    value = series["meter"][k] * side
    thr = vf.get("thr", DEFAULTS["meter"])
    if vf.get("mode") == "favor":
        return value >= thr
    if vf.get("mode") == "notFavor":
        return value < thr  # El ripple medido (22/11): con el marco mayor ya fuerte a favor, la ruptura llega tarde
    return value > -thr


def filter_known(series, k):
    return _finite(series["rv"][k]) and _finite(series["meter"][k])
