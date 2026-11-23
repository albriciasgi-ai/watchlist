"""
Reglas de prueba del protocolo (21/11/2026), en el formato que guarda el probador (pasan por clean_rule).
Los nombres empiezan con "PRUEBA" para distinguirlas en el registro aislado.
"""
import copy

BASE_RECIPE = {"side": "both", "mode": "strict", "min": 1, "groups": [0], "groupMins": {"0": 1}, "window": 1,
               "swing": {"on": False, "bars": 5, "flex": 0, "onSwing": False}, "momentum": False,
               "entry": {"on": False, "atr": 0.25, "bars": 2}}


def recipe(*codes, mode="strict", window=1, minimum=1, side="both", **extra):
    r = copy.deepcopy(BASE_RECIPE)
    r.update(slots=[{"codes": [c], "group": 0} for c in codes], mode=mode, window=window, min=minimum, side=side)
    r.update(extra)
    return r


def rule(name, tf, rec, entry=None, stop=None, exit_=None, **extra):
    out = {"name": f"PRUEBA {name}", "tf": tf, "recipe": rec, "invert": False,
           "entry": {"type": "market", "at": "near", "expiry": 8, **(entry or {})},
           "stop": {"type": "atr", "bars": 5, "atr": 1.5, "buffer": 0.1, "minAtr": 0.1, "maxAtr": 6.0, **(stop or {})},
           "exit": {"targetR": 3.0, "trail": "none", "trailBars": 5, "horizon": None, "opposite": False, **(exit_ or {})},
           "oneAtATime": True, "cooldown": 0, "vaGap": 0.0, "filters": [], "target": 0.05, "volFilter": 2.0}
    out.update(extra)
    return out


FV03 = {"fv": {"minAtr": 0.3}}
# Los sabios de la regla del usuario (registro: "williams", 89 corridas, siempre a mercado)
WISE = {"lookback": 1, "angBars": 5, "minGapAtr": 0.0, "requireAo": True, "teeth": True}
WISE_USER = {"side": "both", "mode": "sequence", "slots": [{"codes": ["WD"], "group": 0}, {"codes": ["WA"], "group": 1}, {"codes": ["WF"], "group": 1}],
             "min": 3, "groups": [0, 1], "groupMins": {"0": 1, "1": 2}, "window": 10,
             "swing": {"on": False, "bars": 5, "flex": 1, "onSwing": False}, "momentum": False,
             "entry": {"on": False, "atr": 0.25, "bars": 2}, "sameBar": True}
SEQ_BX_FV = {**BASE_RECIPE, "slots": [{"codes": ["BX"], "group": 0}, {"codes": ["FV"], "group": 1}], "mode": "sequence",
             "min": 2, "groups": [0, 1], "groupMins": {"0": 1, "1": 1}, "window": 5}

RULES = {
    # R01: el FVG nuevo del usuario (4h, a mercado, stop 1.5 ATR, 3R)
    "R01": rule("R01 · FVG 0.3 · 3R", 240, recipe("FV"), **FV03),
    # R02: la misma en 15m (minuto a minuto en las velas dudosas). R02v: hueco de 1 ATR, para la revisión visual
    "R02": rule("R02 · FVG 0.3 · 3R · 15m", 15, recipe("FV"), **FV03),
    "R02v": rule("R02v · FVG 1.0 · 3R · 15m", 15, recipe("FV"), fv={"minAtr": 1.0}),
    "R02w": rule("R02w · FVG 2.5 · 3R · 15m", 15, recipe("FV"), fv={"minAtr": 2.5}),
    # R02x: velas dudosas a propósito (stop 0.5 ATR y objetivo 1R en 4h): stop y objetivo en la misma vela
    "R02x": rule("R02x · FVG 0.3 · stop 0.5 ATR · 1R", 240, recipe("FV"), stop={"type": "atr", "atr": 0.5},
                 exit_={"targetR": 1.0}, **FV03),
    # R04: los cuatro stops (E-02)
    "R04a": rule("R04a · FVG 0.3 · stop swing 5", 240, recipe("FV"), stop={"type": "swing", "bars": 5, "buffer": 0.1}, **FV03),
    "R04b": rule("R04b · FVG 0.3 · stop vela del elemento", 240, recipe("FV"), stop={"type": "candle", "buffer": 0.1}, **FV03),
    "R04c": rule("R04c · FVG 0.3 · stop borde lejano", 240, recipe("FV"), stop={"type": "zone", "buffer": 0.1}, **FV03),
    "R04d": rule("R04d · FVG 0.3 · stop 8 ATR, máximo 6", 240, recipe("FV"), stop={"type": "atr", "atr": 8.0, "maxAtr": 6.0}, **FV03),
    "R04e": rule("R04e · FVG 0.3 · stop swing, mín 1 máx 2 ATR", 240, recipe("FV"),
                 stop={"type": "swing", "bars": 5, "buffer": 0.1, "minAtr": 1.0, "maxAtr": 2.0}, **FV03),
    # R05: limit en la zona (E-03)
    "R05a": rule("R05a · FVG 0.3 · limit cercano 8", 240, recipe("FV"), entry={"type": "limit", "at": "near", "expiry": 8}, **FV03),
    "R05b": rule("R05b · FVG 0.3 · limit mitad 8", 240, recipe("FV"), entry={"type": "limit", "at": "mid", "expiry": 8}, **FV03),
    "R05c": rule("R05c · FVG 0.3 · limit lejano 8", 240, recipe("FV"), entry={"type": "limit", "at": "far", "expiry": 8}, **FV03),
    "R05d": rule("R05d · FVG 0.3 · invertida · limit cercano", 240, recipe("FV"), entry={"type": "limit", "at": "near", "expiry": 8},
                 invert=True, **FV03),
    "R05e": rule("R05e · FVG 0.3 · limit cercano · trailing 2 ATR y stop a la entrada", 240, recipe("FV"),
                 entry={"type": "limit", "at": "near", "expiry": 8},
                 exit_={"targetR": None, "trail": "atr", "trailAtr": 2.0, "trailStart": 1.0, "breakEven": 1.0, "horizon": 48}, **FV03),
    # R06: Compresión con dos órdenes stop (E-05), desde la zona y desde el cierre
    "R06a": rule("R06a · Compresión · dos órdenes desde la zona 0.2", 240, recipe("CP"),
                 entry={"type": "straddle", "from": "zone", "offset": 0.2, "expiry": 8}),
    "R06b": rule("R06b · Compresión · dos órdenes desde el cierre 0.5", 240, recipe("CP"),
                 entry={"type": "straddle", "from": "close", "offset": 0.5, "expiry": 8}),
    # R07: los sabios con orden stop (E-04): la regla del usuario (que corre a mercado) con orden stop, la barra
    # divergente sola con margen y stop en la barra, y la ruptura de fractal sola
    "R07a": rule("R07a · sabios del usuario · orden stop", 240, WISE_USER, entry={"type": "stop", "offset": 0.0, "expiry": 5, "cancel": True},
                 stop={"type": "atr", "atr": 2.0, "buffer": 0.0}, exit_={"targetR": 2.2, "tpTrail": {"start": 1.5, "dist": 0.5, "unit": "r"}},
                 wise=dict(WISE), bwf={"alligator": "side"}),
    "R07b": rule("R07b · barra divergente · orden stop 0.1 · stop en la barra", 240, recipe("WD"),
                 entry={"type": "stop", "offset": 0.1, "expiry": 3, "cancel": True}, stop={"type": "zone", "buffer": 0.0}, wise=dict(WISE)),
    "R07c": rule("R07c · ruptura de fractal · orden stop", 240, recipe("WF"),
                 entry={"type": "stop", "offset": 0.0, "expiry": 5, "cancel": True}, wise=dict(WISE)),
    # R08: salidas de a una y en carrera (E-06 y E-07)
    "R08a": rule("R08a · FVG · sin salida (cierre a las 96 velas)", 240, recipe("FV"), exit_={"targetR": None}, **FV03),
    "R08b": rule("R08b · FVG · 3R y 12 velas", 240, recipe("FV"), exit_={"horizon": 12}, **FV03),
    "R08c": rule("R08c · FVG · trailing al swing", 240, recipe("FV"), exit_={"targetR": None, "trail": "swing", "trailBars": 5}, **FV03),
    "R08d": rule("R08d · FVG · trailing a 3 velas", 240, recipe("FV"), exit_={"targetR": None, "trail": "bars", "trailBars": 3}, **FV03),
    "R08e": rule("R08e · FVG · trailing 3% desde 1R", 240, recipe("FV"),
                 exit_={"targetR": None, "trail": "pct", "trailPct": 3.0, "trailStart": 1.0}, **FV03),
    "R08f": rule("R08f · FVG · 3R y stop a la entrada en 1R", 240, recipe("FV"), exit_={"breakEven": 1.0}, **FV03),
    "R08g": rule("R08g · FVG · señal contraria", 240, recipe("FV"), exit_={"targetR": None, "opposite": True}, **FV03),
    "R08h": rule("R08h · FVG · carrera: 3R, trailing 3 ATR desde 1R, entrada en 1.5R, 24 velas", 240, recipe("FV"),
                 exit_={"trail": "atr", "trailAtr": 3.0, "trailStart": 1.0, "breakEven": 1.5, "horizon": 24}, **FV03),
    # R09: objetivo arrastrado en R, ATR y % (E-06)
    "R09a": rule("R09a · FVG · 3R arrastrado desde 2.5R a 0.5R", 240, recipe("FV"), exit_={"tpTrail": {"start": 2.5, "dist": 0.5, "unit": "r"}}, **FV03),
    "R09b": rule("R09b · FVG · 3R arrastrado desde 2.5R a 1.5 ATR", 240, recipe("FV"), exit_={"tpTrail": {"start": 2.5, "dist": 1.5, "unit": "atr"}}, **FV03),
    "R09c": rule("R09c · FVG · 3R arrastrado desde 2R a 1%", 240, recipe("FV"), exit_={"tpTrail": {"start": 2.0, "dist": 1.0, "unit": "pct"}}, **FV03),
    # R10: objetivo mixto on-chain (E-06 y D-08): 3R, y 5R con la emisión de stablecoins de 30 días a favor
    "R10": rule("R10 · Impulso · 3R o 5R con la emisión a favor", 240, recipe("IM"),
                exit_={"chainTarget": {"metric": "stable", "days": 30, "z": 0.5, "r": 5.0}}, im={"bars": 3, "atr": 2.0}),
    # R11: salida VPA (E-06): con todas las lecturas y sin objetivo, y solo el clímax desde 1R con 3R
    "R11a": rule("R11a · FVG · salida VPA con todas", 240, recipe("FV"),
                 exit_={"targetR": None, "vpa": {"on": ["climax", "absorb", "push", "meter", "fade"], "fromR": 0.0, "thr": 1.0}}, **FV03),
    "R11b": rule("R11b · FVG · 3R y salida VPA por clímax desde 1R", 240, recipe("FV"), exit_={"vpa": {"on": ["climax"], "fromR": 1.0}}, **FV03),
    # R12: canal gaussiano en 1D, solo largos, stop en la línea central y salida por la banda
    "R12": rule("R12 · canal gaussiano 1D · largos · sale por la banda", 1440, recipe("GC", side="long"), stop={"type": "zone", "buffer": 0.0},
                exit_={"targetR": None}, gc={"period": 144, "poles": 4, "mult": 1.414, "trend": True, "exit": "band"}),
    # R13: objetivos de nivel (E-06): borde contrario y POC del perfil por sesión, centro de la caja y rango SMC
    "R13a": rule("R13a · regreso al valor 1 día · al borde contrario", 15, recipe("VR"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "edge"}, vp={"hours": 24}),
    "R13b": rule("R13b · fallo fuera del valor 1 día · al POC", 15, recipe("VF"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "poc"}, vp={"hours": 24}),
    "R13e": rule("R13e · fallo fuera del valor semanal · al POC", 60, recipe("VF"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "poc"}, vp={"hours": 168}),
    "R13c": rule("R13c · borde de caja · al centro", 240, recipe("BE"), stop={"type": "zone", "buffer": 0.1}, exit_={"targetR": None, "targetAt": "mid"}),
    "R13d": rule("R13d · order block · al extremo del rango SMC", 240, recipe("OB"), exit_={"targetR": None, "targetAt": "weak"}),
    # R14: operación (E-09): todas las señales, enfriamiento y las dos limits del rango (VE con la orden esperando)
    "R14a": rule("R14a · FVG · todas las señales", 240, recipe("FV"), oneAtATime=False, **FV03),
    "R14b": rule("R14b · FVG · enfriamiento 8", 240, recipe("FV"), cooldown=8, **FV03),
    "R14c": rule("R14c · extremo del valor tras perfil D · orden esperando · al centro", 15, recipe("VE"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "mid"}, vp={"hours": 24, "veEntry": "resting", "shapes": ["D"]}),
    # R15: detección (E-12 y H3)
    "R15a": rule("R15a · FVG e Impulso en la misma vela", 240, recipe("FV", "IM"), im={"bars": 3, "atr": 2.0}, **FV03),
    "R15b": rule("R15b · al menos 2 de FVG, Impulso y Ruptura de caja en 3 velas", 240, recipe("FV", "IM", "BX", mode="threshold", minimum=2, window=3),
                 im={"bars": 3, "atr": 2.0}, **FV03),
    "R15c": rule("R15c · Ruptura de caja y después FVG, en 5 velas", 240, SEQ_BX_FV, **FV03),
    "R15d": rule("R15d · Ruptura de caja y FVG, en 5 velas, también en la misma", 240, {**SEQ_BX_FV, "sameBar": True}, **FV03),
    "R15e": rule("R15e · FVG · solo largos", 240, recipe("FV", side="long"), **FV03),
    "R15f": rule("R15f · FVG · invertida a mercado", 240, recipe("FV"), invert=True, **FV03),
    "R15g": rule("R15g · FVG · en un extremo de 5 velas", 240, recipe("FV", swing={"on": True, "bars": 5, "flex": 1, "onSwing": False}), **FV03),
    "R15h": rule("R15h · FVG · con momentum", 240, recipe("FV", momentum=True), **FV03),
    "R15i": rule("R15i · FVG · con confirmación de 0.25 ATR en 2 velas", 240, recipe("FV", entry={"on": True, "atr": 0.25, "bars": 2}), **FV03),
    # Etapa 4: un elemento de prioridad 1 por regla, a mercado, stop 1.5 ATR y 3R (las de order flow, en 15m)
    "E-IM": rule("E-IM · Impulso 2 ATR en 3 velas", 240, recipe("IM"), im={"bars": 3, "atr": 2.0}),
    "E-SP": rule("E-SP · Swing de 5 velas", 240, recipe("SP")),
    "E-VH": rule("E-VH · Volumen alto", 240, recipe("VH")),
    "E-RF": rule("E-RF · Flecha a favor del tramo", 240, recipe("RF"), rv={"arrow": "with"}),
    "E-HM": rule("E-HM · Martillo o estrella", 240, recipe("HM")),
    "E-EN": rule("E-EN · Envolvente", 240, recipe("EN")),
    "E-DJ": rule("E-DJ · Doji", 240, recipe("DJ")),
    "E-BX": rule("E-BX · Ruptura de caja de hasta 5.5 ATR", 240, recipe("BX"), bx={"maxHeight": 5.5}),
    "E-BE": rule("E-BE · Borde de caja", 240, recipe("BE")),
    "E-CP": rule("E-CP · Compresión con dos órdenes", 240, recipe("CP"), entry={"type": "straddle", "from": "zone", "offset": 0.2, "expiry": 3}),
    "E-QB": rule("E-QB · Ruptura con volumen (VPA)", 240, recipe("QB")),
    "E-WF": rule("E-WF · Ruptura de fractal a mercado", 240, recipe("WF")),
    "E-ST": rule("E-ST · Desequilibrios apilados", 15, recipe("ST")),
    "E-DT": rule("E-DT · Cola de delta", 15, recipe("DT")),
    # Etapa 4: un filtro de prioridad 1 sobre el FVG 0.3 (R01)
    "FL-VWAP": rule("FL-VWAP · FVG con VWAP 200 a favor y tope de 2 desviaciones", 240, recipe("FV"), lines=[{"type": "vwap", "period": 200, "mode": "side", "maxDev": 2}], **FV03),
    "FL-EMA": rule("FL-EMA · FVG con EMA 50 a favor con pendiente", 240, recipe("FV"), lines=[{"type": "ema", "period": 50, "mode": "side", "slope": True}], **FV03),
    "FL-CVD": rule("FL-CVD · FVG con CVD 20 a favor", 240, recipe("FV"), flow={"cvd": 20}, **FV03),
    "FL-OI": rule("FL-OI · FVG con OI subiendo 2% en 6", 240, recipe("FV"), flow={"oi": "rise", "oiBars": 6, "oiPct": 2.0}, **FV03),
    "FL-CONF": rule("FL-CONF · FVG con confluencia OI-volumen a favor", 240, recipe("FV"), flow={"oi": "conf"}, **FV03),
    "FL-CROWD": rule("FL-CROWD · FVG sin ir con la multitud", 240, recipe("FV"), flow={"crowd": "nocon"}, **FV03),
    "FL-STEADY": rule("FL-STEADY · FVG con OI sostenido", 240, recipe("FV"), flow={"steady": True}, **FV03),
    "FL-CHAIN": rule("FL-CHAIN · FVG con emisión de stablecoins de 30 d a favor", 240, recipe("FV"), flow={"chain": {"metric": "stable", "days": 30, "mode": "favor"}}, **FV03),
    "FL-REG": rule("FL-REG · FVG fuera de los rangos", 240, recipe("FV"), regime={"mode": "outside"}, **FV03),
    "FL-REG1D": rule("FL-REG1D · FVG fuera de los rangos medidos en 1D", 240, recipe("FV"), regime={"mode": "outside", "tf": 1440}, **FV03),
    "FL-BRK": rule("FL-BRK · FVG tras romper un rango", 240, recipe("FV"), regime={"mode": "breakout"}, **FV03),
    "FL-HORA": rule("FL-HORA · FVG en el horario de Nueva York, de lunes a viernes", 240, recipe("FV"), hours={"on": True, "from": 810, "to": 1260, "weekdays": True}, **FV03),
}

# Etapa 4, familias R16, R19 y R20 del protocolo: las reglas exactas del registro del usuario (la variante con más
# corridas de cada nombre), con otro nombre (el nombre no cambia su identidad). R19b, el rombo, no tiene regla suya.
USER_RULES = {
    "R16": {"bx": {"maxHeight": 5.5}, "flow": {"cvd": 20}, "lines": [{"type": "ema", "period": 200, "mode": "side", "slope": False}],
            "name": "PRUEBA R16 · Ruptura de caja con EMA 200 y CVD", "tf": 240,
            "recipe": {**BASE_RECIPE, "swing": {"on": False, "bars": 5, "flex": 1, "onSwing": False}, "slots": [{"codes": ["BX"], "group": 0}], "mode": "threshold", "min": 1, "groups": [0], "groupMins": {"0": 1}, "window": 1},
            "invert": False, "entry": {"type": "market", "at": "near", "expiry": 8},
            "stop": {"type": "atr", "bars": 5, "atr": 1.5, "buffer": 0.0, "minAtr": 0.1, "maxAtr": 6.0},
            "exit": {"targetR": 3.0, "trail": "none", "trailBars": 5, "horizon": None, "opposite": False},
            "oneAtATime": True, "cooldown": 0, "vaGap": 0.0, "filters": [], "target": 0.05, "volFilter": 2.0},
    "R19a": {"rv": {"leg": 2.0, "spike": 2.0, "arrow": "with", "rombo": "turn"}, "lines": [{"type": "vwap", "period": 200, "mode": "side", "slope": False}],
             "name": "PRUEBA R19a · Flecha con VWAP 200", "tf": 240,
             "recipe": {**BASE_RECIPE, "swing": {"on": False, "bars": 5, "flex": 1, "onSwing": False}, "slots": [{"codes": ["RF"], "group": 0}], "mode": "threshold", "min": 1, "groups": [0], "groupMins": {"0": 1}, "window": 1},
             "invert": False, "entry": {"type": "market", "at": "near", "expiry": 8},
             "stop": {"type": "atr", "bars": 5, "atr": 2.0, "buffer": 0.0, "minAtr": 0.1, "maxAtr": 6.0},
             "exit": {"targetR": 2.0, "trail": "none", "trailBars": 5, "horizon": 400, "opposite": False},
             "oneAtATime": True, "cooldown": 0, "vaGap": 0.0, "filters": [], "target": 0.05, "volFilter": 2.0},
    "R20": {"pat": {"trend": True, "trendBars": 5, "minZ": None, "wick": 2.0}, "fv": {"minAtr": 0.6}, "flow": {"oi": "rise", "oiBars": 6, "oiPct": 2.0},
            "lines": [{"type": "ema", "period": 50, "mode": "side", "slope": False}], "name": "PRUEBA R20 · B5", "tf": 240,
            "recipe": {**BASE_RECIPE, "swing": {"on": False, "bars": 5, "flex": 1, "onSwing": False}, "slots": [{"codes": ["FV"], "group": 0}, {"codes": ["DJ"], "group": 0}], "mode": "threshold", "min": 1, "groups": [0],
                       "groupMins": {"0": 1}, "window": 2},
            "invert": False, "entry": {"type": "market", "at": "near", "expiry": 3},
            "stop": {"type": "atr", "bars": 5, "atr": 1.5, "buffer": 0.1, "minAtr": 0.1, "maxAtr": 8.0},
            "exit": {"targetR": 2.0, "trail": "atr", "trailBars": 5, "horizon": 24, "opposite": True, "trailAtr": 3.0, "breakEven": 1.5},
            "oneAtATime": True, "cooldown": 0, "vaGap": 0.0, "filters": [], "target": 0.05, "volFilter": 2.0},
}
RULES.update(USER_RULES)
RULES["E-WD"] = rule("E-WD · Barra divergente a mercado", 240, recipe("WD"), wise=WISE)
RULES["E-WA"] = rule("E-WA · AO tres barras a mercado", 240, recipe("WA"), wise=WISE)
RULES["R19b"] = rule("R19b · Rombo de volumen, giro", 240, recipe("RB"), rv={"rombo": "turn"}, stop={"atr": 2.0}, exit_={"targetR": 2.0})

# Etapa 6 (22/11): las piezas de prioridad 2, una por regla, con el ciclo de R01 (a mercado, stop 1.5 ATR, 3R) salvo
# donde la pieza trae su propia salida o su propio stop. Elementos de velas en 4h; los del almacén (perfil por sesión,
# liquidaciones y order flow) en 15m.
STAGE6 = {
    # VPA (nivel C), con los parámetros de fábrica del lector
    "E-QA": rule("E-QA · Esfuerzo sin resultado (VPA)", 240, recipe("QA")),
    "E-QF": rule("E-QF · Ruptura sin volumen (VPA)", 240, recipe("QF")),
    "E-QR": rule("E-QR · Retroceso sin volumen tras la ruptura (VPA)", 240, recipe("QR")),
    "E-QT": rule("E-QT · Prueba de poco volumen (VPA)", 240, recipe("QT")),
    "E-QS": rule("E-QS · Frenado o techo (VPA)", 240, recipe("QS")),
    "E-QC": rule("E-QC · Clímax de volumen (VPA)", 240, recipe("QC")),
    "E-QE": rule("E-QE · Medidor VPA cruza el umbral", 240, recipe("QE")),
    # SMC (nivel C), con los ajustes de fábrica
    "E-BS": rule("E-BS · Ruptura de estructura (SMC)", 240, recipe("BS")),
    "E-OB": rule("E-OB · Order block (SMC)", 240, recipe("OB")),
    "E-BK": rule("E-BK · Breaker (SMC)", 240, recipe("BK")),
    "E-EQ": rule("E-EQ · Barrido de iguales (SMC)", 240, recipe("EQ")),
    # Cambio de carácter (nivel B): en 4h con su estructura en 4h, y la del usuario (regla de 15m, estructura de 4 h
    # desde las 13:30 UTC, swing 3, 2 tramos, stop tras el extremo, 2R)
    "E-CC": rule("E-CC · Cambio de carácter 4h", 240, recipe("CC"), stop={"type": "zone", "buffer": 0.1, "maxAtr": 12.0},
                 exit_={"targetR": 2.0}, cc={"tf": 240, "offset": 0, "swing": 3, "legs": 2}),
    "E-CC15": rule("E-CC15 · Cambio de carácter 15m con estructura de 4h desde las 13:30", 15, recipe("CC"),
                   stop={"type": "zone", "buffer": 0.1, "maxAtr": 40.0}, exit_={"targetR": 2.0},
                   cc={"tf": 240, "offset": 810, "swing": 3, "legs": 2}),
    # Canal gaussiano (nivel B) en 4h, los dos lados, stop en la línea central y salida por la banda
    "E-GC": rule("E-GC · Canal gaussiano 4h · sale por la banda", 240, recipe("GC"), stop={"type": "zone", "buffer": 0.0},
                 exit_={"targetR": None}, gc={"period": 144, "poles": 4, "mult": 1.414, "trend": True, "exit": "band"}),
    # Perfil por sesión (nivel B), sesiones de 1 día
    "E-VR": rule("E-VR · Regreso al valor · al borde contrario", 15, recipe("VR"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "edge"}, vp={"hours": 24}),
    "E-VF": rule("E-VF · Fallo fuera del valor · al POC", 15, recipe("VF"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "poc"}, vp={"hours": 24}),
    "E-VX": rule("E-VX · Aceptación fuera del valor · 2R", 15, recipe("VX"), exit_={"targetR": 2.0}, vp={"hours": 24}),
    "E-VE": rule("E-VE · Borde del valor al tocarlo · al POC", 15, recipe("VE"), stop={"type": "zone", "buffer": 0.1},
                 exit_={"targetR": None, "targetAt": "poc"}, vp={"hours": 24, "veEntry": "touch"}),
    # Liquidaciones (nivel C): barrido de un swing dentro de una zona, y de la zona de lado a lado
    "E-LIQs": rule("E-LIQs · Barrido de un swing en una zona de liquidaciones", 15, recipe("LIQ"),
                   stop={"type": "candle", "buffer": 0.1}, exit_={"targetR": 2.0},
                   liq={"what": "swing", "variant": "pierce", "swingBars": 5, "reclaimBars": 3}),
    "E-LIQz": rule("E-LIQz · Barrido de la zona de liquidaciones", 15, recipe("LIQ"),
                   stop={"type": "candle", "buffer": 0.1}, exit_={"targetR": 2.0},
                   liq={"what": "zone", "variant": "pierce", "swingBars": 5, "reclaimBars": 3}),
}
# Order flow de prioridad 2 (los 31 del catálogo salvo ST y DT, que fueron de la etapa 4), en 15m
OF_PRIO2 = ("VA", "OG", "AP", "SL", "RL", "EX", "ZP", "RS", "DD", "PD", "IV", "AD", "SW", "VL", "SQ", "DB", "PW", "DV",
            "VI", "IR", "RD", "VD", "TP", "OP", "RX", "XD", "SM", "BR", "GR")
for _code in OF_PRIO2:
    STAGE6[f"E-{_code}"] = rule(f"E-{_code} · {_code} (order flow)", 15, recipe(_code))
STAGE6["E-VAg"] = rule("E-VAg · VA abandonada con hueco de 0.25 ATR", 15, recipe("VA"), vaGap=0.25)


def _fv(name, **extra):
    """Un filtro de prioridad 2 sobre el FVG 0.3 de R01 (BTC 4h)."""
    return rule(name, 240, recipe("FV"), **FV03, **extra)


STAGE6.update({
    "FL-ALLa": _fv("FL-ALLa · FVG con el Alligator despierto a favor", bwf={"alligator": "awake"}),
    "FL-ALLs": _fv("FL-ALLs · FVG con el cierre del lado de los dientes", bwf={"alligator": "side"}),
    "FL-ALLz": _fv("FL-ALLz · FVG con el Alligator dormido", bwf={"alligator": "sleeping"}),
    "FL-ZONE": _fv("FL-ZONE · FVG con la zona de Williams a favor", bwf={"zone": True}),
    "FL-AOc": _fv("FL-AOc · FVG con la barra del AO a favor", bwf={"ao": "color"}),
    "FL-AOz": _fv("FL-AOz · FVG con el AO del lado del cero a favor", bwf={"ao": "zero"}),
    "FL-AOb": _fv("FL-AOb · FVG con el AO a favor en las dos", bwf={"ao": "both"}),
    "FL-ACc": _fv("FL-ACc · FVG con la barra del AC a favor", bwf={"ac": "color"}),
    "FL-ACz": _fv("FL-ACz · FVG con el AC del lado del cero a favor", bwf={"ac": "zero"}),
    "FL-ACb": _fv("FL-ACb · FVG con el AC a favor en las dos", bwf={"ac": "both"}),
    "FL-GTe": _fv("FL-GTe · FVG con el Gator comiendo", bwf={"gator": "eating"}),
    "FL-GTo": _fv("FL-GTo · FVG con el Gator despierto", bwf={"gator": "open"}),
    "FL-GTs": _fv("FL-GTs · FVG con el Gator dormido", bwf={"gator": "sleeping"}),
    "FL-MFIg": _fv("FL-MFIg · FVG con la vela verde del MFI", bwf={"mfi": "green"}),
    "FL-MFIs": _fv("FL-MFIs · FVG con la vela squat del MFI", bwf={"mfi": "squat"}),
    "FL-MFIv": _fv("FL-MFIv · FVG con vela verde o squat del MFI", bwf={"mfi": "volume"}),
    "FL-MFIn": _fv("FL-MFIn · FVG con todo menos fake del MFI", bwf={"mfi": "notFake"}),
    "FL-PD": _fv("FL-PD · FVG en premium o discount a favor (SMC)", smcf={"pd": True}),
    "FL-BIAS": _fv("FL-BIAS · FVG a favor de la estructura mayor (SMC)", smcf={"bias": True}),
    "FL-VPAf": _fv("FL-VPAf · FVG con el medidor VPA a favor", vpaf={"mode": "favor", "thr": 1.0}),
    "FL-VPAn": _fv("FL-VPAn · FVG con el medidor VPA que no esté en contra", vpaf={"mode": "notAgainst", "thr": 1.0}),
    "FL-HORA2": _fv("FL-HORA2 · FVG de 22:00 a 04:00 UTC (cruza la medianoche)", hours={"on": True, "from": 1320, "to": 240, "weekdays": False}),
    "FL-HORA3": _fv("FL-HORA3 · FVG solo de lunes a viernes", hours={"on": True, "from": 0, "to": 1439, "weekdays": True}),
    "FL-MED": _fv("FL-MED · FVG con la dirección de 4h a favor y volumen de 4h de 1 o más",
                  filters=[{"key": "ctx_4h", "op": ">=", "value": 1}, {"key": "vol_rel_4h", "op": ">=", "value": 1.0}]),
    "FL-MED2": _fv("FL-MED2 · FVG en el tercio a favor del valor del día anterior", filters=[{"key": "value_pos", "op": "<=", "value": 0.33}]),
    # La dirección de 4h es continua (de −1 a 1): con 1 casi nada pasa, y lo que pasa en BTC es de antes de la tabla
    "FL-MED3": _fv("FL-MED3 · FVG con la dirección de 4h de 0.2 o más a favor y volumen de 4h de 1 o más",
                   filters=[{"key": "ctx_4h", "op": ">=", "value": 0.2}, {"key": "vol_rel_4h", "op": ">=", "value": 1.0}]),
})
# R35 (sección 9.7): el FVG 0.3 de R01 en los otros marcos (30m sale de dos velas de 15m y 1D de seis de 4h) y R34: el
# Impulso en las acciones, en 1h y 4h
STAGE6.update({
    "R35-5": rule("R35-5 · FVG 0.3 · 3R · 5m", 5, recipe("FV"), **FV03),
    "R35-30": rule("R35-30 · FVG 0.3 · 3R · 30m", 30, recipe("FV"), **FV03),
    "R35-60": rule("R35-60 · FVG 0.3 · 3R · 1h", 60, recipe("FV"), **FV03),
    "R35-1D": rule("R35-1D · FVG 0.3 · 3R · 1D", 1440, recipe("FV"), **FV03),
    "R34-60": rule("R34-60 · Impulso 2 ATR en 3 · 1h", 60, recipe("IM"), im={"bars": 3, "atr": 2.0}),
    "R34-240": rule("R34-240 · Impulso 2 ATR en 3 · 4h", 240, recipe("IM"), im={"bars": 3, "atr": 2.0}),
})
RULES.update(STAGE6)
