"""
Búsqueda genética de reglas para el probador, solo en la fase 1.

- El genoma es una lista de elecciones sobre las casillas que ya valida rule_tester.clean_rule(): marco, elementos,
  cómo se combinan, ventana, lado, parámetros de cada elemento, entrada, stop, salida y un filtro de línea. Así
  cada individuo es una regla válida que también se puede escribir a mano en la ventana (la "gramática").
- Solo elementos que salen de las velas (rule_tester.CANDLE_CODES): la misma regla corre en todas las monedas.
- La fase 1 se parte en dos por fecha: el tramo de búsqueda (hasta `split`) y la validación interna (desde
  `split` hasta el final de la fase 1). La aptitud usa solo el tramo de búsqueda. La validación se calcula para
  cada regla pero nunca elige nada: al final dice si lo encontrado se sostiene antes de gastar la fase 2.
- Con el embudo (23/11, de fábrica en las búsquedas nuevas; `funnel` en la configuración): la fase 1 va en tres
  tramos seguidos, con un hueco de `gapDays` días tras cada corte. La búsqueda trabaja en los dos primeros (hasta
  `split1`, y de ahí a `split`) y la aptitud de cada regla es la del peor de los dos. El tercero (desde `split`) es la
  puerta: mientras se busca no se calcula para nadie; al terminar la miran solo las `gateQuota` mejores, y de las que
  la pasan quedan como candidatas a la fase 2 a lo sumo `phase2Quota`. Cada mirada a la puerta cuenta, también las de
  búsquedas anteriores con el mismo corte: el margen que pide sube con ellas (_gate_z). Las finalistas traen además
  su resultado por régimen (trade_regime.py). Una búsqueda guardada antes no trae `funnel` y sigue como abajo.
- Nada lee las fases 2 y 3. Las reglas probadas no se anotan en el registro del probador (runs.jsonl): la búsqueda
  lleva su propia cuenta, que el informe muestra junto con el umbral de suerte que da probar tantas.

Aptitud, en el tramo de búsqueda y con las monedas juntas (desde el 23/11, con los tres controles del tablero):
  ventaja = la del control que más le exige a la regla, de los tres del tablero (strategy_board._pool): entradas al
  azar con el mismo stop y salida, seguir el tramo al azar y el azar del trimestre y el lado de cada trade (B-07 del
  protocolo de pruebas), cada una con el margen agrupado por la semana de la salida (B-08) y el error del control.
  "Más le exige": la menor ventaja menos su error;
  aptitud = esa ventaja − su error − 0.02 R por cada pieza más allá de la primera − 0.05 R por cada moneda que falte
  para `minCoins` monedas a favor. Con menos de `minTrades` trades queda por debajo de cualquier regla que los tenga.
  Una búsqueda de antes (sin "controls" en su configuración) sigue con la de entonces, también al retomarla: R medio
  − el mejor de dos controles en cada moneda (el azar y seguir el tramo), con el error de trades independientes.
Candidata a la fase 2: en la validación les gana a los tres controles y sus vecinas aguantan. Con `holdMargin`, además
con margen y con R medio positivo, como "pasa" en el tablero. De fábrica no: en la validación hay pocos trades, y
descartaría reglas que podrían mejorarse; el margen lo pide después el tablero en la fase 2.
"""
import hashlib
import json
import math
import os
import pathlib
import random
import threading
import time
import uuid
from statistics import NormalDist

import numpy as np

import gaussian_channel
import measures
import rule_tester as rt
import structure
import trade_regime

SEARCH_TFS = (60, 240, 1440)
CTRL_TRADES = 1000        # Entradas de cada control, por moneda y tramo
COMPLEXITY_R = 0.02       # Castigo por cada pieza extra (elemento o filtro)
COIN_R = 0.05             # Castigo por cada moneda que falta a favor
FINALISTS = 5
MIN_HOLD_TRADES = 30
MIN_COIN_TRADES = 10      # Una moneda con menos trades no cuenta ni a favor ni en contra
MIN_QUARTERS = 4          # Con aptitud por constancia, trimestres con trades suficientes que hacen falta
DAY_MS = 86400000
PARTS = ("a", "b")        # Embudo: los dos tramos en que trabaja la búsqueda; el tercero ("hold") es la puerta

STOPS = (("atr", 1.0), ("atr", 1.5), ("atr", 2.0), ("atr", 3.0), ("swing", 3), ("swing", 5), ("candle", None), ("zone", None))
TARGETS = (1.0, 1.5, 2.0, 3.0, 5.0, None)
HORIZONS = (None, 24, 96)
WINDOWS = (1, 2, 3, 5)
# Las opciones nuevas van al final de cada lista: una búsqueda guardada antes conserva el sentido de sus genes
ENTRIES = (("market", "near"), ("limit", "near"), ("limit", "mid"), ("straddle", "zone"), ("straddle", "close"),
           ("stop", "zone"))   # 20/11: una orden stop a favor en el borde de la zona (los sabios de Williams)
TRAILS = ("none", "swing", ("atr", 3.0), ("atr", 4.0), ("pct", 5.0), "bars")  # bars: bajo el mínimo de N velas (Williams)
LINES = (None, ("vwap", 50, "side"), ("vwap", 200, "side"), ("ema", 14, "touch"), ("ema", 50, "side"), ("ema", 200, "side"))

# Nombre del gen → opciones. Los genes de un elemento solo pesan si el elemento está en la regla: un cambio en uno
# inactivo deja la misma regla (misma identidad), y la búsqueda no la cuenta dos veces.
GENES = {
    "tf": None, "e1": None, "e2": None, "e3": None,           # Dependen de la configuración
    "need": (0, 1),                                           # 0: todos los elementos; 1: todos menos uno
    "window": WINDOWS, "invert": (False, True),
    "rvArrow": ("with", "against", "any"), "rvRombo": ("turn", "follow"), "rvSpike": (1.5, 2.0, 3.0), "rvLeg": (1.0, 2.0, 3.0),
    "patTrend": (True, False), "patMinZ": (None, 1.0, 2.0),
    "ccStruct": (0, 1, 2), "ccSwing": (2, 3, 5), "ccLegs": (2, 3),
    "gcPeriod": (72, 144, 200), "gcMult": (1.0, 1.414, 2.0), "gcTrend": (True, False), "gcExit": ("band", "mid", "none"),
    "liqWhat": ("zone", "swing"), "liqVariant": ("pierce", "reclaim"),
    "entry": ENTRIES, "stop": STOPS, "target": TARGETS, "trail": TRAILS, "horizon": HORIZONS,
    "opposite": (False, True), "line": LINES, "slope": (False, True),
    # Desde el 19/11. Cada gen nuevo empieza en "apagado": un genoma guardado antes, sin él, queda como estaba
    "bxMax": (None, 4.0, 5.5, 8.0), "bePattern": (False, True), "cpMax": (None, 5.5),
    "fvMin": (0.0, 0.3, 0.6), "spBars": (3, 5, 8), "spMinZ": (None, 1.0), "imBars": (2, 3, 5), "imAtr": (1.5, 2.0, 3.0),
    "straddleOff": (0.2, 0.5, 1.0), "trailStart": (None, 1.0), "breakEven": (None, 1.5),
    "cvd": (None, 20, 50), "oi": (None, "noconf", "conf", "rise"),
    "regime": (None, "outside", "inside", "breakout"), "regimeMajor": (True, False),
    # Desde el 19/11, segunda tanda: la multitud por el funding y el OI sostenido (también empiezan apagados)
    "crowd": (None, "nocon", "contra"), "steady": (False, True),
    # Desde el 20/11: los tres sabios de Williams, la estructura SMC y sus filtros (también empiezan apagados)
    "trailBars": (5, 3),
    "wiseLookback": (1, 3), "wiseAng": (5, 3, 10), "wiseAo": (True, False), "wiseTeeth": (True, False),
    "smcScope": ("swing", "internal"), "smcSwing": (50, 20, 100), "smcInternal": (5, 3, 10), "smcBreak": ("any", "bos", "choch"),
    "smcPick": ("extreme", "opposite"), "smcArea": ("full", "body"), "smcMitigation": ("close", "wick"),
    "smcEq": (0.1, 0.25), "smcReclaim": (True, False),
    "bwf": (None, "awake", "side", "sleeping"), "bwZone": (False, True), "smcPd": (False, True), "smcBias": (False, True),
    "targetWeak": (False, True),
    # Desde el 21/11: los filtros del AO, el AC, el Gator y el MFI (también empiezan apagados)
    "bwAo": (None, "color", "zero"), "bwAc": (None, "color", "zero"), "bwGator": (None, "eating", "open"),
    "bwMfi": (None, "green", "squat", "volume"),
    # Desde el 21/11: el filtro del medidor del lector VPA y el grado desde el que cuentan sus elementos (apagado de fábrica)
    "vpaf": (None, "favor", "notAgainst"), "vpaFire": (0.5, 0.35, 0.7),
    # Desde el 21/11: los flujos on-chain diarios de Coin Metrics (apagado de fábrica): medida y días, modo y umbral del z
    "chain": (None, ("net", 7), ("net", 30), ("stable", 7), ("stable", 30)), "chainMode": ("favor", "nocontra"),
    "chainZ": (0.5, 0.0, 1.0),
}

_lock = threading.Lock()
_jobs = {}


def search_dir():
    # RULE_SEARCH_DIR cambia la carpeta (pruebas en una copia aislada)
    return pathlib.Path(os.environ["RULE_SEARCH_DIR"]) if os.environ.get("RULE_SEARCH_DIR") else rt.tester_dir() / "search"


def _path(search_id):
    return search_dir() / f"{search_id}.json"


# ==================== CONFIGURACIÓN Y GENOMA ====================

def clean_config(raw):
    raw = raw or {}
    tfs = [tf for tf in SEARCH_TFS if tf in (raw.get("tfs") or [240])] or [240]
    codes = [c for c in rt.CANDLE_CODES if c in (raw.get("codes") or [c for c in rt.CANDLE_CODES if c != "LIQ"])]
    if not codes:
        codes = [c for c in rt.CANDLE_CODES if c != "LIQ"]
    split = str(raw.get("split") or "2023-01-01")[:10]
    try:
        split_ms = rt._ms(split)
    except ValueError:
        split, split_ms = "2023-01-01", rt._ms("2023-01-01")
    low, high = rt._ms("2021-06-01"), rt._ms(rt.CUTS[0]) - 90 * 86400000
    if not low <= split_ms <= high:
        split = "2023-01-01"
    # Embudo (23/11): la fase 1 en tres tramos seguidos, con un hueco entre ellos. La búsqueda trabaja en los dos
    # primeros (hasta split1, y de split1 a split) y califica por el peor; el tercero (desde split) es una puerta que
    # solo ven las finalistas, con cupo. Una búsqueda guardada antes no trae "funnel" y sigue con sus dos tramos
    split_ms = rt._ms(split)
    split1 = str(raw.get("split1") or "")[:10]
    try:
        split1_ms = rt._ms(split1)
    except ValueError:
        split1_ms = None
    if split1_ms is None or not rt._ms("2020-12-01") <= split1_ms <= split_ms - 180 * DAY_MS:
        split1 = time.strftime("%Y-%m-%d", time.gmtime((split_ms - 365 * DAY_MS) / 1000))
    seed = raw.get("seed")
    try:
        seed = int(seed)
    except (TypeError, ValueError):
        seed = random.randrange(1, 10 ** 6)
    return {
        "tfs": tfs, "codes": codes, "split": split,
        "population": int(rt._num(raw.get("population"), 60, 10, 300)),
        "generations": int(rt._num(raw.get("generations"), 25, 1, 200)),
        "mutation": rt._num(raw.get("mutation"), 0.1, 0.01, 0.5),
        "maxElements": int(rt._num(raw.get("maxElements"), 2, 1, 3)),
        "minTrades": int(rt._num(raw.get("minTrades"), 150, 20, 5000)),
        "minCoins": int(rt._num(raw.get("minCoins"), 4, 1, 10)),
        "lines": raw.get("lines") is not False, "invert": raw.get("invert") is not False,
        # Piezas que la búsqueda puede usar además de los elementos (todas de fábrica)
        "flow": raw.get("flow") is not False, "regime": raw.get("regime") is not False,
        "trailing": raw.get("trailing") is not False, "straddle": raw.get("straddle") is not False,
        # Desde el 20/11: la orden stop a favor y los filtros de Williams y SMC (con el objetivo en el rango SMC)
        "stopEntry": raw.get("stopEntry") is not False, "williams": raw.get("williams") is not False,
        # Desde el 21/11: el filtro del medidor del lector VPA
        "vpa": raw.get("vpa") is not False,
        # Desde el 21/11: el filtro de flujos on-chain (Coin Metrics)
        "chain": raw.get("chain") is not False,
        # Al terminar, las finalistas se corren también en las monedas nuevas (que nunca eligieron nada)
        "checkNew": raw.get("checkNew") is not False,
        # Y en las acciones (otro mercado): una regla de cripto que también gana ahí difícilmente es suerte
        "checkStocks": raw.get("checkStocks") is not False,
        # Cómo se elige: "promedio" (ventaja media menos su error) o "constancia" (mediana de la ventaja de cada trimestre)
        "fitness": raw.get("fitness") if raw.get("fitness") in ("promedio", "constancia") else "promedio",
        # Desde el 23/11 (protocolo de pruebas): los tres controles del tablero, con el margen por semanas, en la aptitud y
        # en la validación. holdMargin: la candidata pide además el margen en la validación (de fábrica no)
        "controls": "tres", "holdMargin": raw.get("holdMargin") is True,
        # Embudo: tramos, hueco entre ellos (lo que miran atrás las medidas), cupo de la puerta y cupo para la fase 2
        "funnel": raw.get("funnel") is not False, "split1": split1,
        "gapDays": int(rt._num(raw.get("gapDays"), 30, 0, 60)),
        "gateQuota": int(rt._num(raw.get("gateQuota"), 10, 5, 20)),
        "phase2Quota": int(rt._num(raw.get("phase2Quota"), 5, 3, 5)),
        "seed": seed,
    }


def _options(cfg):
    opts = dict(GENES)
    opts["tf"] = tuple(cfg["tfs"])
    opts["e1"] = tuple(cfg["codes"])
    opts["e2"] = (None,) + tuple(cfg["codes"]) if cfg["maxElements"] >= 2 else (None,)
    opts["e3"] = (None,) + tuple(cfg["codes"]) if cfg["maxElements"] >= 3 else (None,)
    if not cfg["lines"]:
        opts["line"] = (None,)
    if not cfg["invert"]:
        opts["invert"] = (False,)
    if not cfg.get("flow", True):
        opts["cvd"], opts["oi"], opts["crowd"], opts["steady"] = (None,), (None,), (None,), (False,)
    if not cfg.get("regime", True):
        opts["regime"] = (None,)
    if not cfg.get("trailing", True):
        opts["trail"] = TRAILS[:2]
    # Sin las dos órdenes stop o sin la orden stop a favor, esas entradas salen de la lista; las demás conservan su lugar
    if not cfg.get("straddle", True):
        opts["entry"] = tuple(e for e in opts["entry"] if e[0] != "straddle")
    if not cfg.get("stopEntry", True):
        opts["entry"] = tuple(e for e in opts["entry"] if e[0] != "stop")
    if not cfg.get("williams", True):
        opts["bwf"], opts["bwZone"], opts["smcPd"], opts["smcBias"], opts["targetWeak"] = (None,), (False,), (False,), (False,), (False,)
        opts["bwAo"], opts["bwAc"], opts["bwGator"], opts["bwMfi"] = (None,), (None,), (None,), (None,)
    if not cfg.get("vpa", True):
        opts["vpaf"] = (None,)
    if not cfg.get("chain", True):
        opts["chain"] = (None,)
    return opts


def random_genome(cfg, rng):
    opts = _options(cfg)
    genome = {name: rng.randrange(len(values)) for name, values in opts.items()}
    # Reglas simples primero: el segundo y el tercer elemento, y el filtro de línea, empiezan apagados más seguido
    for name in ("e2", "e3", "line", "cvd", "oi", "regime", "crowd", "steady", "bwf", "bwZone", "smcPd", "smcBias", "targetWeak",
                 "bwAo", "bwAc", "bwGator", "bwMfi", "vpaf", "chain"):
        if len(opts[name]) > 1 and rng.random() < 0.6:
            genome[name] = 0
    return genome


def decode(genome, cfg):
    """La regla, ya limpia por rule_tester.clean_rule(). None si no queda ningún elemento."""
    opts = _options(cfg)
    pick = {name: opts[name][min(len(opts[name]) - 1, max(0, int(genome.get(name, 0))))] for name in opts}
    codes = []
    for name in ("e1", "e2", "e3"):
        if pick[name] and pick[name] not in codes:
            codes.append(pick[name])
    if not codes:
        return None
    tf = pick["tf"]
    need = len(codes) - pick["need"] if len(codes) > 1 else 1
    stop_type, stop_value = pick["stop"]
    entry_type, entry_at = pick["entry"]
    if "CP" in codes and entry_type != "straddle":
        entry_type, entry_at = "straddle", "zone"  # La compresión no tiene dirección: solo va con las dos órdenes
    if entry_type == "straddle":
        entry = {"type": "straddle", "from": entry_at, "offset": pick["straddleOff"], "expiry": 12}
    elif entry_type == "stop":
        # En el borde de la zona del elemento, como el libro: espera 5 velas y se cancela si antes pasa el otro borde
        entry = {"type": "stop", "offset": 0.0, "expiry": 5, "cancel": True}
    else:
        entry = {"type": entry_type, "at": entry_at, "expiry": 3}
    trail = pick["trail"]
    exit_ = {"targetR": pick["target"], "trail": trail if isinstance(trail, str) else trail[0],
             "horizon": pick["horizon"], "opposite": pick["opposite"], "breakEven": pick["breakEven"]}
    if not isinstance(trail, str):
        exit_["trailAtr" if trail[0] == "atr" else "trailPct"] = trail[1]
        exit_["trailStart"] = pick["trailStart"]
    elif trail in ("swing", "bars"):
        exit_["trailBars"] = pick["trailBars"]  # Solo pesa con esas salidas: en las demás la regla queda igual
    if pick["targetWeak"]:
        exit_["targetAt"] = "weak"  # El máximo o el mínimo del rango mayor SMC en vez de un múltiplo del riesgo
    raw = {
        "name": "Búsqueda", "tf": tf, "invert": pick["invert"],
        "recipe": {"slots": [{"codes": [c]} for c in codes], "mode": "strict" if need >= len(codes) else "threshold",
                   "min": need, "window": pick["window"] if len(codes) > 1 else 1,
                   # Como la manda la ventana (toBackendRule): así la regla cargada allí conserva su identidad
                   "swing": {"on": False, "bars": 5, "flex": 1}},
        "entry": entry,
        "stop": {"type": stop_type, "atr": stop_value if stop_type == "atr" else 1.5,
                 "bars": stop_value if stop_type == "swing" else 5, "buffer": 0.1, "maxAtr": 8},
        "exit": exit_,
        "rv": {"arrow": pick["rvArrow"], "rombo": pick["rvRombo"], "spike": pick["rvSpike"], "leg": pick["rvLeg"]},
        "pat": {"trend": pick["patTrend"], "minZ": pick["patMinZ"]},
        "gc": {"period": pick["gcPeriod"], "mult": pick["gcMult"], "trend": pick["gcTrend"], "exit": pick["gcExit"]},
        "liq": {"what": pick["liqWhat"], "variant": pick["liqVariant"]},
        "bx": {"maxHeight": pick["bxMax"]}, "be": {"pattern": pick["bePattern"]}, "cp": {"maxHeight": pick["cpMax"]},
        "fv": {"minAtr": pick["fvMin"]}, "sp": {"bars": pick["spBars"], "minZ": pick["spMinZ"]},
        "im": {"bars": pick["imBars"], "atr": pick["imAtr"]},
        "flow": {"cvd": pick["cvd"], "oi": pick["oi"], "crowd": pick["crowd"], "steady": pick["steady"],
                 "chain": {"metric": pick["chain"][0], "days": pick["chain"][1], "mode": pick["chainMode"], "z": pick["chainZ"],
                           "asset": "auto"} if pick["chain"] else None},
        # Solo entran a la regla si están sus elementos (clean_rule): con otros, cambiarlos no cambia la regla
        "wise": {"lookback": pick["wiseLookback"], "angBars": pick["wiseAng"], "requireAo": pick["wiseAo"], "teeth": pick["wiseTeeth"]},
        "smc": {"scope": pick["smcScope"], "swing": pick["smcSwing"], "internal": pick["smcInternal"], "break": pick["smcBreak"],
                "pick": pick["smcPick"], "area": pick["smcArea"], "mitigation": pick["smcMitigation"],
                "eqThreshold": pick["smcEq"], "reclaim": pick["smcReclaim"]},
        "bwf": {"alligator": pick["bwf"], "zone": pick["bwZone"], "ao": pick["bwAo"], "ac": pick["bwAc"], "gator": pick["bwGator"],
                "mfi": pick["bwMfi"]},
        "smcf": {"pd": pick["smcPd"], "bias": pick["smcBias"], "swing": pick["smcSwing"]},
        "vpa": {"fire": pick["vpaFire"]},
        "vpaf": {"mode": pick["vpaf"]},
    }
    if pick["regime"]:
        raw["regime"] = {"mode": pick["regime"], "major": pick["regimeMajor"], "majorOut": 6, "after": 6}
    struct = [s for s in structure.STRUCT_TFS if s >= tf and s % tf == 0]
    raw["cc"] = {"tf": struct[min(len(struct) - 1, pick["ccStruct"])] if struct else tf, "swing": pick["ccSwing"], "legs": pick["ccLegs"]}
    if pick["line"]:
        kind, period, mode = pick["line"]
        raw["lines"] = [{"type": kind, "period": period, "mode": mode, "slope": pick["slope"]}]
    return rt.clean_rule(raw)  # Las piezas que la regla no usa quedan fuera: no cambian su identidad


def rule_key(rule):
    return rt.rule_hash("BUSQUEDA", rule)


def complexity(rule):
    flow, bwf, smcf = rule.get("flow") or {}, rule.get("bwf") or {}, rule.get("smcf") or {}
    return (len(rule["recipe"]["slots"]) + len(rule.get("lines") or []) + len(rule.get("filters") or [])
            + bool(flow.get("cvd")) + bool(flow.get("oi")) + bool(flow.get("crowd")) + bool(flow.get("steady")) + bool(flow.get("chain")) + bool(rule.get("regime"))
            + bool(bwf.get("alligator")) + bool(bwf.get("zone")) + bool(smcf.get("pd")) + bool(smcf.get("bias"))
            + bool(bwf.get("ao")) + bool(bwf.get("ac")) + bool(bwf.get("gator")) + bool(bwf.get("mfi")) + bool(rule.get("vpaf")))


# ==================== EVALUACIÓN ====================

class Evaluator:
    """Velas, elementos y controles de cada moneda, cargados una vez para toda la búsqueda."""

    def __init__(self, cfg, progress=None, group="base"):
        self.cfg = cfg
        self.split = rt._ms(cfg["split"])
        # Cada tramo: (inicio, fin) en ms; None = hasta el borde de la fase 1. Un trade es de un tramo si entra desde su
        # inicio y sale antes de su fin: los que cruzan un corte, o caen en el hueco, no son de ninguno
        self.funnel = bool(cfg.get("funnel"))
        if self.funnel:
            gap = int(cfg.get("gapDays", 0)) * DAY_MS
            first = rt._ms(cfg["split1"])
            self.bounds = {"a": (None, first), "b": (first + gap, self.split), "hold": (self.split + gap, None)}
        else:
            self.bounds = {"train": (None, self.split), "hold": (self.split, None)}
        self.data = {}      # (moneda, marco) → {span, phase, ctx, bounds}
        self.controls = {}  # clave del control → resumen
        self.legs = {}      # (moneda, marco, ATR del tramo) → dirección del tramo en cada vela
        self.progress = progress
        self.group = group

    def symbols(self):
        return rt.candle_symbols(self.group)

    def load(self, symbol, tf, rule):
        key = (symbol, tf)
        if key in self.data:
            return self.data[key]
        phase = next((p for p in rt.phases(symbol) if p["phase"] == 1), None)
        item = None
        if phase is not None and phase["available"]:
            if self.progress:
                slow = not rt._on_candles(symbol, tf) and not rt._span_path(symbol, tf, phase, rule).exists()
                label = {60: "1h", 240: "4h", 1440: "1D"}.get(tf, f"{tf} min")
                self.progress(f"Preparando {symbol} en {label}" + (": detecta los elementos de la fase, varios minutos la primera vez" if slow else ""))
            span = rt.detect_span(symbol, tf, phase, rule)
            if len(span["bars"]) >= 100:
                ctx = rt._context(symbol, tf, span["bars"])
                T = ctx["T"]
                cut = int(np.searchsorted(np.array(T, dtype=np.int64), self.split))
                item = {"span": span, "phase": phase, "ctx": ctx, "cut": cut, "n": len(T), "T": np.array(T, dtype=np.int64)}
        self.data[key] = item
        return item

    def _leg_direction(self, symbol, tf, ctx, leg):
        key = (symbol, tf, leg)
        if key not in self.legs:
            high, low, close = (np.array(ctx[k], dtype=float) for k in ("H", "L", "C"))
            direction, _, _ = measures.zigzag(high, low, close, measures.atr(high, low, close), leg)
            self.legs[key] = direction
        return self.legs[key]

    def _control(self, symbol, tf, item, rule, trades, segment, kind):
        """Entradas al azar en el tramo: `random` con la proporción de largos de la regla, `leg` a favor del tramo."""
        start, end = self.bounds[segment]
        lo = 30 if start is None else max(30, int(np.searchsorted(item["T"], start)))
        hi = item["n"] if end is None else int(np.searchsorted(item["T"], end))
        if hi - lo < 50:
            return None
        base_rule = rt._random_rule(rule, trades)
        if base_rule["stop"]["type"] == "atr":
            base_rule = {**base_rule, "stop": {**base_rule["stop"], "atr": round(base_rule["stop"]["atr"] * 4) / 4 or 0.25}}
        longs = sum(1 for t in trades if t["dir"] > 0) / len(trades)
        leg = float((rule.get("rv") or {}).get("leg", measures.LEG_ATR))
        core = {"stop": base_rule["stop"], "exit": {**base_rule["exit"], "opposite": False}, "gc": rule.get("gc"),
                "invert": rule["invert"] if rule.get("gc") else False, "entry": base_rule["entry"],
                "regime": rule.get("regime"), "flow": rule.get("flow"), "lines": rule.get("lines")}
        for name in ("bwf", "smcf", "vpaf"):
            if rule.get(name):
                core[name] = rule[name]
        if rule.get("vpaf"):
            core["vpa"] = rule.get("vpa")  # El medidor del filtro sale con los parámetros del lector de la regla
        if rule.get("smcf"):
            core["smc"] = rule.get("smc")  # El rango de los filtros SMC sale con la estructura de la regla
        # El control al azar se guarda por lado (largos y cortos aparte) y se mezcla con la proporción de cada regla:
        # así lo comparten todas las reglas con el mismo stop y la misma salida
        key = json.dumps([symbol, tf, segment, kind, core, None if kind == "random" else leg], sort_keys=True, default=str)
        found = self.controls.get(key)
        if found is None:
            # Con el minuto a minuto de la moneda, como la regla en run(). Hasta el 20/11 el azar iba sin él: con dos
            # órdenes stop cerca de la apertura, cada llenado dudoso del azar era una pérdida, y las finalistas lo usaban
            ctx = {**item["ctx"], "i0": None}
            exit_at = _exit_at(rule, item["span"])
            if exit_at is not None:
                ctx["exitAt"] = exit_at
            direction = self._leg_direction(symbol, tf, item["ctx"], leg) if kind == "leg" else None
            rng = random.Random(int(hashlib.sha1(key.encode()).hexdigest()[:8], 16))
            by_side = {1: [], -1: []}
            # Con filtro de régimen el azar entra solo en las velas que el filtro deja; con filtro de flujo, solo del lado
            # que el filtro deja entrar. Si no, la ventaja mezclaría el filtro con la señal
            allowed = None
            if rule.get("regime"):
                mask = rt.regime_mask(rule["regime"], item["span"]["bars"], rt.is_stock(symbol))
                allowed = [k for k in range(lo, hi - 2) if mask[k]]
                if len(allowed) < 50:
                    return None
            sided = rt._sided(rule)
            fctx = {**item["ctx"], "bars": item["span"]["bars"]} if sided else None
            straddle = base_rule["entry"]["type"] == "straddle"
            taken = 0
            by_quarter = {}
            for number in range(CTRL_TRADES * (6 if sided else 1)):
                if sided and taken >= CTRL_TRADES:
                    break
                k = allowed[rng.randrange(len(allowed))] if allowed is not None else rng.randrange(lo, hi - 2)
                side = int(direction[k]) if kind == "leg" else (1 if number % 2 == 0 else -1)
                if side == 0:
                    continue
                sides = (side,) if kind == "leg" or not straddle else (1, -1)
                if sided:
                    sides = tuple(sd for sd in sides if rt._side_ok(rule, fctx, k, sd))
                    if not sides:
                        continue
                taken += 1
                ctx["i0"] = k
                trade = rt.simulate(base_rule, ctx, k, side, sides=sides)
                if not trade or "skip" in trade or trade.get("open"):
                    continue
                if end is not None and trade["exit_t"] >= end:
                    continue
                by_side[trade["dir"]].append(trade["r"])
                by_quarter.setdefault((rt.quarter_of(trade["entry_t"]), trade["dir"]), []).append(trade["r"])
            found = {side: float(np.mean(rs)) if rs else None for side, rs in by_side.items()}
            both = by_side[1] + by_side[-1]
            found["all"] = float(np.mean(both)) if both else None
            found["q"] = {k: (float(np.mean(v)), len(v)) for k, v in by_quarter.items()}  # Azar de cada trimestre y lado
            # El error de cada promedio: el margen de las tres ventajas suma el del control, como el tablero
            found["se"] = {1: _se(by_side[1]), -1: _se(by_side[-1]), "all": _se(both)}
            self.controls[key] = found
        se = found.get("se") or {}
        if kind == "leg":
            return {"avgR": found["all"], "se": se.get("all")}
        if found[1] is None or found[-1] is None:
            return {"avgR": found["all"], "se": se.get("all"), "q": found["q"]}
        mix = math.sqrt((longs * (se.get(1) or 0.0)) ** 2 + ((1 - longs) * (se.get(-1) or 0.0)) ** 2)
        return {"avgR": longs * found[1] + (1 - longs) * found[-1], "se": mix, "q": found["q"]}

    def evaluate(self, rule, gate=True, detail=False):
        """Resultado de la regla en el tramo de búsqueda y en la validación interna, con las monedas juntas.
        Con el embudo: en los tramos a y b (y los dos juntos, "train"), y en la puerta ("hold") solo con `gate`: la
        búsqueda nunca la pide; la piden las finalistas al terminar. detail: además, el resultado por régimen."""
        names = [name for name in self.bounds if gate or name != "hold"]
        keys = list(self.bounds) + (["train"] if self.funnel else [])
        segments = {k: [] for k in keys}
        raw_r = {k: [] for k in keys}
        quarters = {k: {} for k in keys}    # Por trimestre: [trades, suma de R, suma de la ventaja contra el azar de ese trimestre]
        rows3 = {k: [] for k in keys}       # Para las tres ventajas: (R, azar de su trimestre y lado, salida)
        coin_ctrls = {k: [] for k in keys}  # Por moneda: sus trades y (promedio, error) de cada control
        regime_rows = {k: [] for k in keys}  # Con detail: (tendencia, volatilidad, R, R menos el control de su moneda)
        coins = []
        codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
        for symbol in self.symbols():
            allowed = rt.codes_for(symbol, rule["tf"])
            if allowed is not None and codes - allowed:
                continue  # Un elemento que ese símbolo no tiene (el barrido de liquidaciones en una acción)
            item = self.load(symbol, rule["tf"], rule)
            if item is None:
                continue
            result = rt.run(symbol, rule, item["span"], item["phase"], None, base=False)
            if not result.get("success"):
                continue
            trades = result["trades"]
            row = {"symbol": symbol, **{k: {"n": 0} for k in keys}}
            if detail and "regime" not in item:
                item["regime"] = trade_regime.labels(item["span"]["bars"], rule["tf"])
            for segment in names:
                start, end = self.bounds[segment]
                picked = [t for t in trades if (start is None or t["entry_t"] >= start) and (end is None or t["exit_t"] < end)]
                if not picked:
                    continue
                # Con el embudo, lo de los tramos a y b se junta además en "train" (los dos tramos de búsqueda)
                into = (segment, "train") if self.funnel and segment in PARTS else (segment,)
                controls = [self._control(symbol, rule["tf"], item, rule, picked, segment, kind) for kind in ("random", "leg")]
                values = [c["avgR"] for c in controls if c and c["avgR"] is not None]
                ctrl = max(values) if values else 0.0
                rs = [t["r"] for t in picked]
                row[segment] = {"n": len(rs), "avgR": round(float(np.mean(rs)), 4), "control": round(ctrl, 4),
                                "edge": round(float(np.mean(rs)) - ctrl, 4)}
                rnd, leg = (c if c and c["avgR"] is not None else None for c in controls)
                by_q = (controls[0] or {}).get("q") or {}
                for name in into:
                    segments[name].extend(r - ctrl for r in rs)
                    raw_r[name].extend(rs)
                    coin_ctrls[name].append({"n": len(rs), "random": (rnd["avgR"], rnd.get("se") or 0.0) if rnd else None,
                                             "leg": (leg["avgR"], leg.get("se") or 0.0) if leg else None})
                for t in picked:
                    q = rt.quarter_of(t["entry_t"])
                    mean, n = by_q.get((q, t["dir"]), (None, 0))
                    for name in into:
                        cell = quarters[name].setdefault(q, [0, 0.0, 0.0])
                        cell[0] += 1
                        cell[1] += t["r"]
                        cell[2] += t["r"] - (mean if n >= rt.QUARTER_MIN_RANDOM else ctrl)
                        # El azar del trimestre y el lado; con pocas entradas, el de la moneda (como rt.quarter_control)
                        rows3[name].append((t["r"], mean if n >= rt.QUARTER_MIN_RANDOM else (rnd["avgR"] if rnd else None), t["exit_t"]))
                    if detail:
                        # El régimen que se sabía al cerrar la vela anterior a la de la entrada (la de la señal, a mercado)
                        i = int(np.searchsorted(item["T"], t["entry_t"], side="right")) - 2
                        trend, vol = item["regime"][i] if 0 <= i < len(item["regime"]) else (trade_regime.UNKNOWN, trade_regime.UNKNOWN)
                        for name in into:
                            regime_rows[name].append((trend, vol, t["r"], t["r"] - ctrl))
            if self.funnel:
                parts = [row[name] for name in PARTS if row[name]["n"]]
                total = sum(p["n"] for p in parts)
                if total:
                    row["train"] = {"n": total, **{k: round(sum(p[k] * p["n"] for p in parts) / total, 4) for k in ("avgR", "control", "edge")}}
            coins.append(row)
        out = {"coins": coins}
        for segment, residuals in segments.items():
            n = len(residuals)
            rows = [c[segment] for c in coins if c[segment]["n"] >= MIN_COIN_TRADES]
            out[segment] = {
                "n": n, "edge": round(float(np.mean(residuals)), 4) if n else None,
                "se": round(float(np.std(residuals, ddof=1) / math.sqrt(n)), 4) if n > 1 else None,
                "coinsUp": sum(1 for c in rows if c["edge"] > 0), "coinsWith": len(rows),
                "avgR": round(float(np.mean(raw_r[segment])), 4) if n else None,
                "consistency": {k: v for k, v in rt.consistency(quarters[segment]).items() if k != "rows"},
            }
            three = _three(rows3[segment], coin_ctrls[segment])
            if three:
                out[segment]["three"] = three
                if self.cfg.get("controls") == "tres":
                    # La ventaja con que elige y que se muestra: la del control que más le exige (la menor menos su error).
                    # La de dos controles queda como edgeTwo, seTwo
                    name = min(three, key=lambda k: three[k]["r"] - three[k]["se"])
                    seg = out[segment]
                    seg.update(edgeTwo=seg["edge"], seTwo=seg["se"], edge=three[name]["r"], se=three[name]["se"], against=name)
        if self.funnel:
            out["parts"] = {name: out[name] for name in PARTS}
            if not gate:
                out["hold"] = {"n": 0, "edge": None, "se": None, "pending": True}  # La puerta: todavía sin mirar
        if detail:
            out["regimes"] = {k: trade_regime.summarize(rows) for k, rows in regime_rows.items() if rows}
        return out


def _se(values):
    return float(np.std(values, ddof=1) / math.sqrt(len(values))) if len(values) > 1 else 0.0


def _three(rows, coins):
    """
    Las tres ventajas del tablero (strategy_board._pool) para los trades de un tramo, con las monedas juntas: contra el
    azar, contra seguir el tramo y contra el azar del trimestre y el lado de cada trade (B-07), con el margen agrupado
    por la semana de la salida (B-08) más el error del control. rows: (R, azar de su trimestre y lado, salida).
    coins: por moneda, sus trades y (promedio, error) de cada control. Un control que falta en una moneda con trades no
    da su ventaja, como en el tablero.
    """
    n = len(rows)
    if n < 2:
        return None
    values = [r for r, _, _ in rows]
    mean = sum(values) / n
    weeks = {}
    for r, _, exit_t in rows:
        cell = weeks.setdefault(rt.week_of(exit_t), [0, 0.0])
        cell[0] += 1
        cell[1] += r
    se_r = rt.clustered_se(weeks, mean, n, _se(values))
    traded = [c for c in coins if c["n"]]

    def edge(value, se):
        return {"r": round(value, 4), "low": round(value - 1.96 * se, 4), "high": round(value + 1.96 * se, 4), "se": round(se, 4)}

    out = {}
    for name, key in (("edge", "random"), ("legEdge", "leg")):
        if not traded or any(c[key] is None for c in traded):
            continue
        ctrl = sum(c["n"] * c[key][0] for c in traded) / n
        ctrl_se = math.sqrt(sum((c["n"] * c[key][1]) ** 2 for c in traded)) / n
        out[name] = edge(mean - ctrl, math.sqrt(se_r ** 2 + ctrl_se ** 2))
        if key == "random" and all(q is not None for _, q, _ in rows):
            diffs = [r - q for r, q, _ in rows]
            mean_d = sum(diffs) / n
            groups = {}
            for d, (_, _, exit_t) in zip(diffs, rows):
                cell = groups.setdefault(rt.week_of(exit_t), [0, 0.0])
                cell[0] += 1
                cell[1] += d
            se_d = rt.clustered_se(groups, mean_d, n, _se(diffs))
            out["quarterEdge"] = edge(mean_d, math.sqrt(se_d ** 2 + ctrl_se ** 2))
    return out or None


def _exit_at(rule, span):
    """La salida por el Gaussian Channel, como la arma rule_tester.run()."""
    gc = rule.get("gc")
    if not gc:
        return None
    warm = span.get("warm") or []
    leave = gaussian_channel.exits(warm + span["bars"], gc["period"], gc["poles"], gc["mult"], gc["exit"])
    if leave and warm:
        leave = {side: {i - len(warm) for i in found if i >= len(warm)} for side, found in leave.items()}
    return {1: leave[-1], -1: leave[1]} if leave and rule["invert"] else leave


def fitness(record, cfg):
    """Con el embudo, la del peor de los dos tramos de búsqueda (cada uno con la mitad de los trades mínimos): una regla
    que gana en un tramo y no en el otro queda con la nota del malo. Sin él, la del tramo de búsqueda."""
    parts = record.get("parts")
    if cfg.get("funnel") and parts:
        least = max(10, cfg["minTrades"] // 2)
        return min(_fitness_of(parts[name], record, cfg, least) for name in PARTS)
    return _fitness_of(record["train"], record, cfg, cfg["minTrades"])


def _fitness_of(t, record, cfg, least):
    if not t["n"] or t["n"] < least:
        return round(-2.0 + (t["n"] or 0) / least, 4)
    if cfg.get("fitness") == "constancia":
        # La mediana de la ventaja por trimestre: no la mueven uno o dos trimestres excepcionales
        cons = t.get("consistency") or {}
        if cons.get("total", 0) < MIN_QUARTERS:
            return round(-1.0 + cons.get("total", 0) / MIN_QUARTERS * 0.5, 4)
        value = cons["median"] - COMPLEXITY_R * (record["complexity"] - 1)
    else:
        value = t["edge"] - (t["se"] or 0) - COMPLEXITY_R * (record["complexity"] - 1)
    value -= COIN_R * max(0, min(cfg["minCoins"], t["coinsWith"]) - t["coinsUp"])
    return round(value, 4)


# ==================== BÚSQUEDA ====================

def _evaluate_genome(state, evaluator, genome, origin="search"):
    rule = decode(genome, state["config"])
    if rule is None:
        return None
    key = rule_key(rule)
    found = state["evaluated"].get(key)
    if found is None:
        result = evaluator.evaluate(rule, gate=not state["config"].get("funnel"))  # Con el embudo, sin mirar la puerta
        # origin: "search" la eligió el algoritmo; "neighbor", vecina de una finalista probada al terminar
        found = {"key": key, "origin": origin, "genome": dict(genome), "rule": rule, "complexity": complexity(rule),
                 "train": result["train"], "hold": result["hold"], "coins": result["coins"]}
        if result.get("parts"):
            found["parts"] = result["parts"]
        found["fitness"] = fitness(found, state["config"])
        state["evaluated"][key] = found
    return found


def _tournament(scored, rng, size=3):
    picks = [scored[rng.randrange(len(scored))] for _ in range(size)]
    return max(picks, key=lambda r: r["fitness"])["genome"]


def _child(a, b, cfg, rng):
    opts = _options(cfg)
    child = {name: (a if rng.random() < 0.5 else b).get(name, 0) for name in opts}
    for name, values in opts.items():
        if len(values) > 1 and rng.random() < cfg["mutation"]:
            child[name] = rng.randrange(len(values))
    return child


def _save(state):
    path = _path(state["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    state["updatedAt"] = int(time.time() * 1000)
    partial = path.with_suffix(".tmp")
    with open(partial, "w", encoding="utf-8") as fh:
        json.dump(state, fh, allow_nan=False, separators=(",", ":"), default=str)
    partial.replace(path)


def load(search_id):
    path = _path(search_id)
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _distance(a, b):
    ra, rb = a["rule"], b["rule"]
    codes = lambda r: {c for s in r["recipe"]["slots"] for c in s["codes"]}
    if codes(ra) != codes(rb) or ra["tf"] != rb["tf"] or ra["invert"] != rb["invert"]:
        return 99
    return sum(1 for k in ("stop", "exit", "entry", "lines", "rv", "pat", "cc", "gc", "liq", "bx", "be", "cp", "fv", "sp", "im", "flow", "regime")
               if ra.get(k) != rb.get(k)) \
        + (ra["recipe"]["window"] != rb["recipe"]["window"]) + (ra["recipe"]["min"] != rb["recipe"]["min"])


def _neighbors(state, evaluator, record):
    """Las reglas vecinas: cada gen activo movido a la opción de al lado. Una regla sólida no depende de un valor exacto."""
    opts = _options(state["config"])
    out = []
    for name, values in opts.items():
        if name in ("e1", "e2", "e3", "tf") or len(values) < 2:
            continue
        for step in (-1, 1):
            j = record["genome"].get(name, 0) + step
            if not 0 <= j < len(values):
                continue
            genome = {**record["genome"], name: j}
            rule = decode(genome, state["config"])
            if rule is None or rule_key(rule) == record["key"]:
                continue  # Gen inactivo en esta regla
            found = _evaluate_genome(state, evaluator, genome, "neighbor")
            if found is not None and found["train"]["n"]:
                out.append({"gene": name, "edge": found["train"]["edge"], "n": found["train"]["n"], "key": found["key"]})
    return out


def _spearman(xs, ys):
    if len(xs) < 5:
        return None
    rx, ry = np.argsort(np.argsort(xs)), np.argsort(np.argsort(ys))
    c = np.corrcoef(rx, ry)[0, 1]
    return None if math.isnan(c) else round(float(c), 3)


def _gate_z(looks):
    """El margen que pide la puerta: cuantas más reglas la han mirado, más alto. Con una, 1.64 errores (5% de pasar por
    suerte); con 10, 2.58; con 20, 2.81: el 5% repartido entre todas las miradas."""
    return NormalDist().inv_cdf(1 - 0.05 / max(1, looks))


def _before(cfg, skip):
    """Lo ya gastado en otras búsquedas guardadas: reglas probadas en la fase 1 y, de las búsquedas con embudo y el mismo
    corte de la puerta, cuántas reglas la miraron. El viaje de vuelta (otra búsqueda tras fallar) también cuenta."""
    tested, looks = 0, 0
    for path in search_dir().glob("*.json"):
        try:
            with open(path, encoding="utf-8") as fh:
                other = json.load(fh)
        except (OSError, ValueError):
            continue
        if other.get("id") == skip:
            continue
        tested += len(other.get("evaluated") or {})
        config = other.get("config") or {}
        if config.get("funnel") and config.get("split") == cfg["split"]:
            looks += ((other.get("report") or {}).get("gate") or {}).get("looked", 0)
    return tested, looks


def _other_markets(cfg, out, job):
    if cfg.get("checkNew", True) and rt.new_symbols():
        # Las finalistas en las monedas nuevas, en toda su fase 1: datos que la búsqueda nunca vio. Solo informa
        fresh = Evaluator(cfg, lambda text: job.update(stage=f"Monedas nuevas: {text}"), group="new")
        for number, item in enumerate(out, 1):
            job.update(stage=f"Monedas nuevas: finalista {number} de {len(out)}")
            result = fresh.evaluate(item["rule"])
            item["newCoins"] = {"train": result["train"], "hold": result["hold"], "coins": result["coins"],
                                "all": _pooled(result)}
    if cfg.get("checkStocks", True) and rt.stock_symbols():
        stocks = Evaluator(cfg, lambda text: job.update(stage=f"Acciones: {text}"), group="stocks")
        for number, item in enumerate(out, 1):
            job.update(stage=f"Acciones: finalista {number} de {len(out)}")
            result = stocks.evaluate(item["rule"])
            item["stocks"] = {"train": result["train"], "hold": result["hold"], "coins": result["coins"], "all": _pooled(result)}


def _luck(ses, count):
    """El R que la mejor de `count` reglas sin ventaja mostraría por suerte: el error típico por raíz de 2·ln(count)."""
    ses = sorted(x for x in ses if x)
    return round(float(np.median(ses)) * math.sqrt(2 * math.log(count)), 3) if count > 1 and ses else None


def _finish_funnel(state, evaluator, job):
    """El cierre con el embudo: las mejores por el peor de sus dos tramos pasan, con cupo, a la puerta (el tercer tramo,
    que nadie había mirado); las que la pasan, con otro cupo, quedan para la fase 2."""
    cfg = state["config"]
    ranked = sorted(state["evaluated"].values(), key=lambda r: r["fitness"], reverse=True)
    # A la puerta solo llega la que ganó en sus dos tramos (aptitud sobre cero: su peor tramo, ya con el margen y los
    # castigos). Una regla que no ganó buscando no gasta una mirada: si pasara la puerta, sería por suerte
    qualified = [r for r in ranked if r.get("parts") and r["train"]["n"] >= cfg["minTrades"] and r["fitness"] > 0]
    finalists = []
    for record in qualified:
        if len(finalists) >= cfg["gateQuota"]:
            break
        if all(_distance(record, f) >= 3 for f in finalists):
            finalists.append(record)
    tested_before, looks_before = _before(cfg, state.get("id"))
    looks = looks_before + len(finalists)
    z = _gate_z(looks)
    out = []
    for number, record in enumerate(finalists, 1):
        job.update(stage=f"Vecinas de la finalista {number} de {len(finalists)}")
        near = _neighbors(state, evaluator, record)
        up = sum(1 for x in near if x["edge"] > 0)
        stable = near and up / len(near) >= 0.6
        job.update(stage=f"La puerta: finalista {number} de {len(finalists)}")
        result = evaluator.evaluate(record["rule"], gate=True, detail=True)
        hold = result["hold"]
        record["hold"], record["coins"] = hold, result["coins"]
        three = hold.get("three")
        wins = bool(three) and len(three) == 3 and all(e["r"] > 0 for e in three.values())
        strong = wins and all(e["r"] - z * e["se"] > 0 for e in three.values()) and (hold.get("avgR") or 0) > 0
        if hold["n"] < MIN_HOLD_TRADES:
            verdict = f"Pocos trades en la puerta ({hold['n']}): no se puede juzgar"
        elif not wins:
            verdict = "No les gana a los tres controles en la puerta: descartar"
        elif cfg.get("holdMargin") and not strong:
            verdict = f"Les gana a los tres controles en la puerta, pero no con el margen de {looks} miradas: descartar"
        elif not stable:
            verdict = "Pasa la puerta pero sus vecinas no aguantan: frágil"
        else:
            verdict = "Pasa la puerta"
        out.append({"key": record["key"], "rule": record["rule"], "fitness": record["fitness"], "train": record["train"],
                    "parts": record["parts"], "hold": hold, "coins": record["coins"], "regimes": result.get("regimes"),
                    "neighbors": near, "neighborsUp": up, "stable": bool(stable), "passed": verdict == "Pasa la puerta",
                    "strong": bool(strong), "candidate": False, "verdict": verdict})
    # A la fase 2, con cupo: de las que pasan la puerta, las que más le sacan a su control más exigente
    passed = sorted((item for item in out if item["passed"]),
                    key=lambda item: min(e["r"] - e["se"] for e in item["hold"]["three"].values()), reverse=True)
    for place, item in enumerate(passed):
        item["candidate"] = place < cfg["phase2Quota"]
        item["verdict"] = "Candidata a la fase 2" if item["candidate"] else "Pasa la puerta, fuera del cupo de la fase 2"
    _other_markets(cfg, out, job)
    every = [r for r in state["evaluated"].values() if r.get("parts") and r["train"]["n"] >= cfg["minTrades"]]
    state["report"] = {
        "funnel": True, "finalists": out, "tested": len(state["evaluated"]), "qualified": len(every),
        "luckR": _luck([r["train"]["se"] for r in every], len(every)),
        "luckParts": {name: _luck([r["parts"][name]["se"] for r in every], len(every)) for name in PARTS},
        # Con todo lo probado antes en otras búsquedas: el umbral que de verdad corresponde
        "testedBefore": tested_before,
        "luckAllR": _luck([r["train"]["se"] for r in every], len(every) + tested_before),
        "gate": {"quota": cfg["gateQuota"], "looked": len(finalists),
                 "best": ranked[0]["fitness"] if ranked else None, "before": looks_before, "looks": looks, "z": round(z, 2),
                 "passed": len(passed), "strong": sum(1 for item in out if item["strong"]), "phase2Quota": cfg["phase2Quota"]},
        "spearman": None, "pairs": 0, "topHoldEdge": None, "topCount": 0, "allHoldEdge": None,
    }


def _finish(state, evaluator, job):
    cfg = state["config"]
    if cfg.get("funnel"):
        return _finish_funnel(state, evaluator, job)
    ranked = sorted(state["evaluated"].values(), key=lambda r: r["fitness"], reverse=True)
    qualified = [r for r in ranked if r["train"]["n"] >= cfg["minTrades"]]
    finalists = []
    for record in qualified:
        if len(finalists) >= FINALISTS:
            break
        if all(_distance(record, f) >= 3 for f in finalists):
            finalists.append(record)
    out = []
    for number, record in enumerate(finalists, 1):
        job.update(stage=f"Vecinas de la finalista {number} de {len(finalists)}")
        near = _neighbors(state, evaluator, record)
        up = sum(1 for x in near if x["edge"] > 0)
        hold = record["hold"]
        stable = near and up / len(near) >= 0.6
        three = hold.get("three") if cfg.get("controls") == "tres" else None
        if hold["n"] < MIN_HOLD_TRADES:
            verdict = f"Pocos trades en la validación ({hold['n']}): no se puede juzgar"
        elif three:
            # Les gana a los tres controles del tablero; con holdMargin, además con margen y con R positivo ("pasa")
            if not all(e["r"] > 0 for e in three.values()):
                verdict = "No les gana a los tres controles en la validación: descartar"
            elif cfg.get("holdMargin") and not (all(e["low"] > 0 for e in three.values()) and (hold.get("avgR") or 0) > 0):
                verdict = "Les gana a los tres controles en la validación, pero no con margen: descartar"
            elif not stable:
                verdict = "Se sostiene en la validación pero sus vecinas no: frágil"
            else:
                verdict = "Candidata a la fase 2"
        elif hold["edge"] is None or hold["edge"] <= 0:
            verdict = "No se sostiene en la validación: descartar"
        elif not stable:
            verdict = "Se sostiene en la validación pero sus vecinas no: frágil"
        else:
            verdict = "Candidata a la fase 2"
        out.append({"key": record["key"], "rule": record["rule"], "fitness": record["fitness"], "train": record["train"],
                    "hold": hold, "coins": record["coins"], "neighbors": near, "neighborsUp": up, "stable": bool(stable),
                    "candidate": verdict == "Candidata a la fase 2", "verdict": verdict})
    _other_markets(cfg, out, job)
    # El umbral de suerte cuenta todas las reglas probadas, vecinas incluidas; la comparación de la validación, solo las
    # que eligió la búsqueda: dice si elegir por aptitud sirvió de algo
    every = [r for r in state["evaluated"].values() if r["train"]["n"] >= cfg["minTrades"]]
    tested = [r for r in every if r.get("origin") != "neighbor"]
    ses = sorted(r["train"]["se"] for r in every if r["train"]["se"])
    luck = round(float(np.median(ses)) * math.sqrt(2 * math.log(len(every))), 3) if len(every) > 1 and ses else None
    pairs = [(r["train"]["edge"], r["hold"]["edge"]) for r in tested if r["hold"]["n"] >= MIN_HOLD_TRADES and r["hold"]["edge"] is not None]
    top = sorted(tested, key=lambda r: r["fitness"], reverse=True)[:max(1, len(tested) // 10)]
    top_hold = [r["hold"]["edge"] for r in top if r["hold"]["n"] >= MIN_HOLD_TRADES and r["hold"]["edge"] is not None]
    all_hold = [p[1] for p in pairs]
    state["report"] = {
        "finalists": out, "tested": len(state["evaluated"]), "qualified": len(every), "luckR": luck,
        "spearman": _spearman([p[0] for p in pairs], [p[1] for p in pairs]), "pairs": len(pairs),
        "topHoldEdge": round(float(np.mean(top_hold)), 4) if top_hold else None, "topCount": len(top_hold),
        "allHoldEdge": round(float(np.mean(all_hold)), 4) if all_hold else None,
    }


def _pooled(result):
    """Los dos tramos juntos: ventaja media pesada por trades y monedas a favor."""
    t, h = result["train"], result["hold"]
    n = (t["n"] or 0) + (h["n"] or 0)
    if not n:
        return {"n": 0}
    edge = ((t["edge"] or 0) * (t["n"] or 0) + (h["edge"] or 0) * (h["n"] or 0)) / n
    rows = [c for c in result["coins"] if (c["train"]["n"] + c["hold"]["n"]) >= MIN_COIN_TRADES]
    up = sum(1 for c in rows if ((c["train"].get("edge") or 0) * c["train"]["n"] + (c["hold"].get("edge") or 0) * c["hold"]["n"]) > 0)
    return {"n": n, "edge": round(edge, 4), "coinsUp": up, "coinsWith": len(rows)}


def _work(state, job):
    cfg = state["config"]
    rng = random.Random(f"{cfg['seed']}-{state['generation']}")
    evaluator = Evaluator(cfg, lambda text: job.update(stage=text))
    try:
        population = state.get("population") or []
        if not population:
            seen = set()
            tries = 0
            while len(population) < cfg["population"] and tries < cfg["population"] * 20:
                tries += 1
                genome = random_genome(cfg, rng)
                rule = decode(genome, cfg)
                if rule is None or rule_key(rule) in seen:
                    continue
                seen.add(rule_key(rule))
                population.append(genome)
        while state["generation"] < cfg["generations"]:
            if job.get("stop"):
                state["state"] = "stopped"
                break
            gen = state["generation"] + 1
            scored = []
            for i, genome in enumerate(population):
                if job.get("stop"):
                    break
                job.update(stage=f"Generación {gen} de {cfg['generations']}: regla {i + 1} de {len(population)}",
                           done=state["generation"] * len(population) + i, total=cfg["generations"] * len(population))
                found = _evaluate_genome(state, evaluator, genome)
                if found is not None:
                    scored.append(found)
            if job.get("stop"):
                state["state"] = "stopped"
                break
            scored.sort(key=lambda r: r["fitness"], reverse=True)
            best = scored[0] if scored else None
            fits = [r["fitness"] for r in scored if r["train"]["n"] >= cfg["minTrades"]]
            state["history"].append({"generation": gen, "best": best["fitness"] if best else None,
                                     "bestKey": best["key"] if best else None,
                                     "median": round(float(np.median(fits)), 4) if fits else None,
                                     "qualified": len(fits), "tested": len(state["evaluated"])})
            state["generation"] = gen
            # Siguiente generación: las 4 mejores pasan tal cual, un 10% de reglas nuevas al azar y el resto de cruces
            elite = []
            for r in scored:
                if len(elite) >= 4:
                    break
                if r["genome"] not in elite:
                    elite.append(r["genome"])
            nxt, keys = list(elite), {rule_key(decode(g, cfg)) for g in elite}
            immigrants = max(1, cfg["population"] // 10)
            tries = 0
            while len(nxt) < cfg["population"] and tries < cfg["population"] * 30:
                tries += 1
                if len(nxt) >= cfg["population"] - immigrants or not scored:
                    genome = random_genome(cfg, rng)
                else:
                    genome = _child(_tournament(scored, rng), _tournament(scored, rng), cfg, rng)
                rule = decode(genome, cfg)
                if rule is None or rule_key(rule) in keys:
                    continue
                keys.add(rule_key(rule))
                nxt.append(genome)
            population = nxt
            state["population"] = population
            _save(state)
        if state["state"] == "running":
            job.update(stage="Revisando las finalistas")
            _finish(state, evaluator, job)
            state["state"] = "done"
        _save(state)
        job.update(state=state["state"])
    except Exception as error:  # El hilo no deja el trabajo colgado; lo hecho hasta la última generación queda guardado
        state["state"] = "error"
        state["error"] = f"{type(error).__name__}: {error}"
        try:
            _save(state)
        except Exception:
            pass
        job.update(state="error", error=state["error"])


def start(raw_config=None, resume=None):
    with _lock:
        busy = next((j for j in _jobs.values() if j["state"] == "running"), None)
    if busy is not None:
        return {"success": True, "job": busy["id"], "search": busy["search"], "already": True}
    if resume:
        state = load(resume)
        if state is None:
            return {"success": False, "message": "No se encontró esa búsqueda"}
        if state["state"] == "done":
            return {"success": False, "message": "Esa búsqueda ya terminó"}
        state["state"] = "running"
        state.pop("error", None)
    else:
        cfg = clean_config(raw_config)
        state = {"id": time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:4], "config": cfg, "state": "running",
                 "generation": 0, "population": [], "evaluated": {}, "history": [], "startedAt": int(time.time() * 1000)}
    job = {"id": uuid.uuid4().hex[:12], "search": state["id"], "state": "running", "stage": "Empezando", "done": 0, "total": 1, "error": None}
    with _lock:
        _jobs[job["id"]] = job
    _save(state)
    threading.Thread(target=_work, args=(state, job), daemon=True).start()
    return {"success": True, "job": job["id"], "search": state["id"]}


def stop(search_id):
    """Detiene la búsqueda al terminar la regla en curso. Lo hecho queda guardado y se puede retomar."""
    with _lock:
        job = next((j for j in _jobs.values() if j["search"] == search_id and j["state"] == "running"), None)
    if job is None:
        return {"success": False, "message": "Esa búsqueda no está corriendo"}
    job["stop"] = True
    return {"success": True}


def job_status(job_id):
    with _lock:
        job = _jobs.get(job_id)
    return dict(job) if job else None


def _brief(record):
    return {"key": record["key"], "rule": record["rule"], "fitness": record["fitness"], "train": record["train"],
            "complexity": record["complexity"]}


def summary(search_id, top=15):
    """Lo que muestra la ventana: estado, avance por generación, las mejores en el tramo de búsqueda y el informe final.
    La validación de cada regla solo sale cuando la búsqueda terminó: mientras corre no debe guiar nada."""
    state = load(search_id)
    if state is None:
        return None
    running = next((dict(j) for j in _jobs.values() if j["search"] == search_id and j["state"] == "running"), None)
    ranked = sorted((r for r in state["evaluated"].values() if r.get("origin") != "neighbor"), key=lambda r: r["fitness"], reverse=True)[:top]
    shown = "running" if running else ("stopped" if state["state"] == "running" else state["state"])  # Cortada al reiniciar el backend
    out = {"id": state["id"], "config": state["config"], "state": shown,
           "error": state.get("error"), "generation": state["generation"], "history": state["history"],
           "tested": len(state["evaluated"]), "best": [_brief(r) for r in ranked], "job": running,
           "startedAt": state.get("startedAt"), "updatedAt": state.get("updatedAt")}
    if state["state"] == "done":
        out["report"] = state.get("report")
        for row, record in zip(out["best"], ranked):
            row["hold"] = record["hold"]
    return out


def history():
    rows = []
    for path in sorted(search_dir().glob("*.json"), reverse=True):
        try:
            with open(path, encoding="utf-8") as fh:
                state = json.load(fh)
        except (OSError, ValueError):
            continue
        report = state.get("report") or {}
        live = any(j["search"] == state["id"] and j["state"] == "running" for j in _jobs.values())
        rows.append({"id": state["id"], "state": "running" if live else ("stopped" if state["state"] == "running" else state["state"]), "config": state["config"], "generation": state["generation"],
                     "tested": len(state.get("evaluated") or {}), "startedAt": state.get("startedAt"),
                     "candidates": sum(1 for f in report.get("finalists") or [] if f.get("candidate"))})
    return rows
