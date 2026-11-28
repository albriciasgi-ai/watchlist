"""La cocina de estrategias de la simulación manual (26/11/2026, plan en docs/PLAN_CENTRAL_ESTRATEGIAS.md, etapa 1).

Qué hace:
- dice lo que se cumple en cada vela, con los detectores del probador de reglas (rule_tester.py) y sus valores de fábrica:
  un bloque de la cocina y un elemento del backtesting global son el mismo cálculo;
- arma la estrategia en borrador por capas: contexto (lo que ya venía pasando), zona (dónde) y gatillo por pasos;
- responde dónde se cumple cada bloque, cada capa y la estrategia entera en las velas que recibe.

Sin futuro: solo recibe velas ya cerradas (quien llama corta en la hora simulada), cada evento cuenta en la vela con que
se conoce (`known`) y nada mira a la derecha de una vela. tests/test_kitchen.py lo comprueba: lo ya cerrado no cambia al
llegar velas nuevas.

Zonas (paso 1.2, 26/11/2026): soportes y resistencias, FVG abiertos, order blocks y zonas de liquidaciones, armadas con
los detectores del probador (el swing y el FVG de fvg_swing.py, smc.py y liq_sweeps.py). Una zona cuenta desde la vela
que abre cuando ya se conoce y deja de contar en la vela que la termina. La estrategia las pide de dos maneras: «todas
las de este tipo» (una regla) o «solo esta» (una franja fija de precio, que también puede ser un dibujo del usuario).

Order flow (paso 1.2): los Elementos OF de of_elements.py como eventos y el delta real como estados, en las monedas con
almacén de trades. Se detecta en segundo plano, por bloques de días que quedan en memoria: un pedido nunca espera más
de FLOW_WAIT segundos; mientras tanto responde «detectando» y la página vuelve a preguntar.

Los nombres de los bloques y sus textos viven en la página (frontend/src/components/kitchen/kitchenCatalog.js). Aquí
están el cálculo y los rangos de cada parámetro; tests/test_kitchen.py vigila que las dos listas digan lo mismo."""
import hashlib
import json
import threading
import time
from collections import OrderedDict

import numpy as np

import flow_filters
import liq_store
import liq_sweeps
import of_elements as oe
import rule_tester as rt
import smc
import vpa
import williams

MAX_BARS = 12000      # Velas por pedido: las que se pintan y las anteriores, que calientan los indicadores
MAX_VIEW = 3000       # Velas en que se pinta y se cuenta ("lo recorrido")
MAX_STEPS = 4
MAX_BLOCKS = 8        # Por capa o por paso
SIGNAL_GAP = 3        # Dos señales del mismo lado necesitan más de tantas velas entre ellas
KEEP = 4              # Juegos de velas con sus cálculos en memoria

SIDES = {"long": (1,), "short": (-1,), "both": (1, -1)}
LINES = ("jaw", "teeth", "lips")     # Además de las EMA, que van como "e<periodo>"

# Estados con trades reales (delta de la vela y CVD de N velas): solo en las monedas con almacén
FLOW_STATE_IDS = ("delta", "cvd")
# Estados: se cumplen o no en cada vela. Con lado (dir: favor o contra del trade), salvo los de NEUTRAL
# Lo que calcula el gráfico con los ajustes de la sesión y manda la página (27/11): una serie de un panel (interés
# abierto, delta, CVD) que sube o baja en N velas, o que está sobre o bajo cero; y una marca de un indicador
PAGE_STATE_IDS = ("psube", "ppos", "pumbral")
# Eventos sobre una serie: un valor muy grande frente a lo típico (pgrande), cruza el cero (pcruza) y pasa un máximo y
# empieza a bajar, o un mínimo y empieza a subir (pgiro, como el AO de Williams)
PAGE_EVENT_IDS = ("pmark", "pgrande", "pcruza", "pgiro")
PAGE_BIG_BARS = 100       # Velas anteriores con que se mide lo típico de una serie
PAGE_IDS = PAGE_STATE_IDS + PAGE_EVENT_IDS
VOLUME = "vol"            # El volumen de las velas: una serie que el motor ya tiene, sin pedirla a la página
# La tabla de la vela de Elementos OF, con trades reales: delta, Δ/Vol (en %), delta acumulado del día y el máximo y
# el mínimo exactos del delta dentro de la vela. Series del motor, que salen del almacén de trades
OF_TABLE = ("of_delta", "of_dvol", "of_cum", "of_maxd", "of_mind")
ABS_DIRS = ("up", "down", "any")   # Un sentido que no depende del lado del trade: sube, baja o cualquiera
PAGE_LINE = "p:"          # Una línea del gráfico (el VWAP y sus bandas): "p:<clave>"
PAGE_SERIES = 16          # Series de cada clase por pedido
PAGE_MARKS = 4000         # Marcas por serie
STATE_IDS = ("side", "lejos", "order", "awake", "sleep", "tramo", "pausa", "vpam") + FLOW_STATE_IDS + PAGE_STATE_IDS
# Eventos de las líneas: ocurren en una vela
LINE_EVENT_IDS = ("cross", "bounce", "xline")
# Eventos de la capa de zona: el precio llega a una de sus zonas, o la toca y cierra de vuelta
ZONE_EVENT_IDS = ("ztoca", "zrech")
# Elementos OF (of_elements.py): salen del almacén de trades, no de una regla sobre las velas. Sin los retirados (el
# ratio de extremos, motor 8: lo decidió el usuario en la galería 4)
OF_CODES = tuple(code for code in oe.CATALOG if code not in oe.RETIRED)
# Eventos del probador, por familia: los códigos de cada una salen del mismo cálculo
FAMILIES = OrderedDict((
    ("pat", ("HM", "EN", "DJ")),
    ("vh", ("VH",)),
    ("fs", ("FV", "IM", "SP")),
    ("cc", ("CC",)),
    ("box", ("BX", "BE", "CP")),
    ("rv", ("RF", "RB")),
    ("gc", ("GC",)),
    ("vpa", tuple(vpa.CODES)),
    ("wise", tuple(williams.CODES)),
    ("smc", tuple(smc.CODES)),
))
EVENT_CODES = tuple(code for codes in FAMILIES.values() for code in codes) + OF_CODES
FAMILY_OF = {code: family for family, codes in FAMILIES.items() for code in codes}
NEUTRAL = ("sleep", "pausa", "CP") + ZONE_EVENT_IDS   # Sin lado propio (el rechazo en la zona mira el lado del trade)

# Zonas que detecta el motor, y las que puede traer una zona fija: además, lo que el usuario pone en el gráfico y solo
# conoce la página: un dibujo ('draw') o un nivel de un perfil de volumen de rango fijo ('vp': POC, VAH, VAL o área de valor)
ZONE_KINDS = ("sr", "fvg", "ob", "liq")
# 'ind': un nivel de cualquier indicador del gráfico, con los ajustes de la sesión, elegido con un clic (27/11)
USER_KINDS = ("draw", "vp", "ind")
FIXED_KINDS = ZONE_KINDS + USER_KINDS
MAX_PICKS = 6             # Zonas elegidas en la capa de zona
MAX_OFFERS = 40           # Zonas de la página que se ordenan junto a las del motor en la vela elegida
SR_BARS = 5               # Velas a cada lado de un swing: las del indicador S&R v2 y del elemento Swing del probador
SR_CLUSTER_PCT = 0.3      # Un swing a esta distancia del primer toque de un nivel activo lo refuerza, como en S&R v2
FVG_MIN_ATR = 0.3         # Hueco mínimo de un FVG: el del bloque «FVG nuevo» de la cocina
LIQ_BARS = 1300           # Velas, desde la última, con zonas de liquidaciones: cada vela pide las que había al abrir
ZONE_NEAR = (0.5, 0.1, 3.0)   # «Cerca de la zona», en ATR: de fábrica, mínimo y máximo
MAX_BANDS = 300           # Zonas de una elección que se devuelven para dibujarlas
CANDLE_ZONES = 8          # Zonas que se listan en la vela elegida
CANDLE_ZONE_ATR = 3.0     # Hasta esta distancia de la vela o del clic

# Order flow: días por bloque según el marco, velas anteriores a lo recorrido y cuánto espera un pedido
FLOW_BLOCK_DAYS = {1: 1, 5: 1, 15: 2, 30: 2, 60: 5, 240: 20}
FLOW_LEAD = 120           # El CVD y los plazos entre pasos miran hacia atrás
FLOW_WAIT = 0.6           # Segundos: pasado eso, la respuesta dice «detectando» y la página vuelve a preguntar
FLOW_KEEP = 80            # Bloques en memoria por moneda y marco
FLOW_BOOKS = 6            # Monedas y marcos con bloques en memoria
FLOW_STALE_S = 300        # Un bloque al que le faltan velas se detecta otra vez pasado este tiempo: el almacén puede estar armándose
STORE_CHECK_S = 60        # Cada cuánto se vuelve a mirar si la moneda tiene almacén

# Parámetros que la cocina deja cambiar en un evento del probador: (clave de la regla, campo, de fábrica, mínimo, máximo)
EVENT_PARAMS = {
    "FV": (("fv", "minAtr", 0.3, 0.0, 5.0),),
    "IM": (("im", "bars", 3, 1, 50), ("im", "atr", 2.0, 0.2, 20.0)),
    "SP": (("sp", "bars", 5, 2, 20),),
}
# Parámetros de los estados y de los eventos de las líneas: campo -> (de fábrica, mínimo, máximo)
BLOCK_PARAMS = {
    "side": {"line": "e50"},
    "lejos": {"line": "e50", "atr": (2.0, 0.5, 8.0)},
    "order": {},
    "awake": {},
    "sleep": {},
    "tramo": {"atr": (4.0, 1.0, 12.0), "n": (24, 3, 60)},
    "pausa": {"n": (3, 2, 20), "atr": (1.0, 0.2, 5.0)},
    "vpam": {"u": (0.3, 0.1, 3.0)},
    "delta": {"min": (0.0, 0.0, 90.0)},
    "cvd": {"n": (20, 2, 100), "min": (0.0, 0.0, 90.0)},
    "cross": {"line": "e20"},
    "bounce": {"line": "e50"},
    "xline": {"a": "e20", "b": "e50"},
    "ztoca": {},
    "zrech": {},
    # how: contra hace N velas (ends), el promedio de las últimas N contra las N anteriores (avg) o N velas seguidas
    # (steps). min: cuánto como mínimo, en veces el cambio típico (x) o en % del valor de partida (pct); 0 no pide nada
    "psube": {"n": (5, 1, 100), "how": ["ends", "avg", "steps"], "min": (0.0, 0.0, 1000.0), "unit": ["x", "pct"]},
    "ppos": {},
    # Un valor contra un umbral: al menos (ge) o no más de (le) `u`, medido tal cual (abs), en veces lo típico de las
    # 100 velas anteriores (x) o en % del volumen de la vela (vol)
    "pumbral": {"op": ["ge", "le"], "u": (1.0, 0.0, 1e12), "unit": ["x", "vol", "abs"]},
    "pmark": {},
    "pgrande": {"k": (3.0, 1.0, 20.0), "w": (PAGE_BIG_BARS, 20, 500)},
    "pcruza": {},
    "pgiro": {},
}
ORDER_LINES = ("e20", "e50", "e200")

_lock = threading.Lock()
_facts = OrderedDict()
_books = OrderedDict()
_liq = OrderedDict()
_stores = {}


# ==================== El documento de la estrategia ====================

def _num(value, default, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    if value != value:
        return default
    return max(low, min(high, value))


def clean_key(value):
    """La clave de una serie del gráfico: letras minúsculas, números y guion bajo. None si no vale."""
    text = str(value or "")
    return text if 0 < len(text) <= 24 and all(ch.isdigit() or "a" <= ch <= "z" or ch == "_" for ch in text) else None


def clean_line(value, default):
    """Una línea válida: e<periodo> (EMA de 2 a 400 velas), una del Alligator o una del gráfico (p:<clave>)."""
    text = str(value or "")
    if text.startswith(PAGE_LINE) and clean_key(text[len(PAGE_LINE):]):
        return text
    if text in LINES:
        return text
    if text[:1] == "e" and text[1:].isdigit() and 2 <= int(text[1:]) <= 400:
        return "e" + str(int(text[1:]))
    return default


def clean_block(raw, place):
    """Un bloque válido, o None. place: "ctx" o "step". Un evento en el contexto cuenta «si ocurrió en las últimas cn
    velas» (conv recent); un estado en un paso, «si se cumple en esas velas» (conv during)."""
    if not isinstance(raw, dict):
        return None
    bid = str(raw.get("id") or "")
    is_state = bid in STATE_IDS
    if not is_state and bid not in LINE_EVENT_IDS and bid not in ZONE_EVENT_IDS and bid not in EVENT_CODES and bid not in PAGE_EVENT_IDS:
        return None
    given = raw.get("p") if isinstance(raw.get("p"), dict) else {}
    p = {}
    if bid in PAGE_IDS:
        p["s"] = clean_key(given.get("s"))
        if p["s"] is None:
            return None
    if bid in BLOCK_PARAMS:
        for key, spec in BLOCK_PARAMS[bid].items():
            if isinstance(spec, str):
                p[key] = clean_line(given.get(key), spec)
            elif isinstance(spec, list):
                p[key] = given.get(key) if given.get(key) in spec else spec[0]
            else:
                value = _num(given.get(key), spec[0], spec[1], spec[2])
                p[key] = int(round(value)) if isinstance(spec[0], int) else value
    for _, key, default, low, high in EVENT_PARAMS.get(bid, ()):
        value = _num(given.get(key), default, low, high)
        p[key] = int(round(value)) if isinstance(default, int) else value
    if bid not in NEUTRAL:
        # El volumen o el interés abierto suben o bajan sin importar el lado del trade: su sentido puede ser fijo
        fixed = bid in PAGE_IDS and given.get("dir") in ABS_DIRS
        p["dir"] = given.get("dir") if fixed else "contra" if given.get("dir") == "contra" else "favor"
    conv = None
    if place == "ctx" and not is_state:
        conv = "recent"
    if place == "step" and is_state:
        conv = "during"
    return {"uid": str(raw.get("uid") or "")[:40], "id": bid, "p": p, "conv": conv,
            "cn": int(_num(raw.get("cn"), 5, 1, 50))}


def clean_pick(raw):
    """Una zona elegida, o None. «Todas las de este tipo» (type kind): un tipo que el motor detecta, con su sentido
    frente al trade. «Solo esta» (type one): una franja fija de precio que cuenta desde `from`."""
    if not isinstance(raw, dict):
        return None
    uid, kind = str(raw.get("uid") or "")[:40], str(raw.get("kind") or "")
    if raw.get("type") == "one":
        try:
            lo, hi, since = float(raw.get("lo")), float(raw.get("hi")), int(raw.get("from"))
        except (TypeError, ValueError):
            return None
        if kind not in FIXED_KINDS or not (lo == lo and hi == hi) or min(lo, hi) <= 0 or abs(lo) == float("inf") or abs(hi) == float("inf"):
            return None
        way = 1 if raw.get("way") == 1 else -1 if raw.get("way") == -1 else 0
        lo, hi = min(lo, hi), max(lo, hi)
        pick = {"uid": uid, "type": "one", "kind": kind, "lo": lo, "hi": hi, "from": since, "way": way}
        # Un nivel de S&R termina con un cierre más allá de su toque más lejano (edge), que queda del lado de afuera
        edge = raw.get("edge")
        if kind == "sr" and way and isinstance(edge, (int, float)) and edge == edge and 0 < edge < float("inf") and (edge <= lo if way > 0 else edge >= hi):
            pick["edge"] = float(edge)
        return pick
    if kind not in ZONE_KINDS:
        return None
    # Las zonas de liquidaciones no tienen lado
    return {"uid": uid, "type": "kind", "kind": kind,
            "dir": raw.get("dir") if raw.get("dir") in ("favor", "contra") and kind != "liq" else "any"}


def clean_offers(raw):
    """Las zonas que solo conoce la página (un nivel de un VP fijo, un dibujo) y que ofrece para la vela elegida: una
    franja de precio cada una. El motor las ordena junto a las suyas, por cercanía al clic. `ref` es de la página, para
    reconocerlas a la vuelta."""
    out = []
    for item in (raw if isinstance(raw, list) else [])[:MAX_OFFERS]:
        if not isinstance(item, dict) or item.get("kind") not in USER_KINDS:
            continue
        try:
            lo, hi = float(item.get("lo")), float(item.get("hi"))
        except (TypeError, ValueError):
            continue
        if not (lo == lo and hi == hi) or min(lo, hi) <= 0 or max(lo, hi) == float("inf"):
            continue
        out.append({"ref": str(item.get("ref") or "")[:80], "kind": item["kind"], "lo": min(lo, hi), "hi": max(lo, hi)})
    return out


def clean_page(raw, n):
    """Lo que manda la página de sus indicadores, con los ajustes de la sesión: `lines` (líneas sobre el precio) y
    `nums` (series de un panel), un valor por vela para las últimas velas del pedido; y `marks`, por serie, pares
    [hora de la vela con que se conoce la marca, lado]. Todo es de velas ya cerradas: la página no manda otra cosa.
    Devuelve series del largo de las velas (NaN donde no hay dato) y una huella, para no mezclar cálculos."""
    raw = raw if isinstance(raw, dict) else {}
    out = {"lines": {}, "nums": {}, "marks": {}, "stamp": ""}
    for group in ("lines", "nums"):
        items = raw.get(group) if isinstance(raw.get(group), dict) else {}
        for name in sorted(items)[:PAGE_SERIES]:
            values = items[name]
            if clean_key(name) is None or not isinstance(values, list):
                continue
            tail = values[-n:]
            series = np.full(n, np.nan)
            try:
                series[n - len(tail):] = [np.nan if x is None else float(x) for x in tail]
            except (TypeError, ValueError):
                continue
            series[~np.isfinite(series)] = np.nan
            out[group][name] = series
    items = raw.get("marks") if isinstance(raw.get("marks"), dict) else {}
    for name in sorted(items)[:PAGE_SERIES]:
        if clean_key(name) is None or not isinstance(items[name], list):
            continue
        rows = []
        for item in items[name][-PAGE_MARKS:]:
            try:
                rows.append((int(item[0]), 1 if item[1] > 0 else -1 if item[1] < 0 else 0))
            except (TypeError, ValueError, IndexError):
                continue
        out["marks"][name] = sorted(set(rows))
    if out["lines"] or out["nums"] or out["marks"]:
        digest = hashlib.md5()
        for group in ("lines", "nums"):
            for name, series in out[group].items():
                digest.update(f"{group}:{name}".encode())
                digest.update(series.tobytes())
        digest.update(json.dumps(out["marks"], sort_keys=True).encode())
        out["stamp"] = digest.hexdigest()
    return out


SESSION_FAMILIES = ("smc", "wise", "vpa", "rv")   # Familias del probador cuyos ajustes puede traer la sesión


def clean_session(raw):
    """Los ajustes del modal de cada indicador, como los tiene la sesión del usuario (27/11): con ellos calculan los
    detectores del motor en lugar de sus valores de fábrica. Por familia del probador (smc, wise, vpa, rv) van los campos
    de su regla, que clean_rule acota; `sr`, las velas por lado y el % de agrupación de S&R v2. Sin nada, todo de fábrica."""
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    for name in SESSION_FAMILIES:
        item = raw.get(name)
        if isinstance(item, dict):
            kept = {str(key)[:24]: value for key, value in item.items() if isinstance(value, (int, float, str, bool)) and value == value}
            if kept:
                out[name] = kept
    sr = raw.get("sr")
    if isinstance(sr, dict):
        out["sr"] = {"bars": int(_num(sr.get("bars"), SR_BARS, 2, 15)), "cluster": _num(sr.get("cluster"), SR_CLUSTER_PCT, 0.05, 3.0)}
    out["stamp"] = json.dumps(out, sort_keys=True) if out else ""
    return out


def block_flow(block):
    """Si el bloque sale del almacén de trades: un Elemento OF, el delta o el CVD reales, o una casilla de la tabla de la vela."""
    return block["id"] in OF_CODES or block["id"] in FLOW_STATE_IDS or (block["id"] in PAGE_IDS and block["p"].get("s") in OF_TABLE)


def uses_page(block):
    """Si el bloque lee algo que manda la página: una serie, una marca o una línea del gráfico."""
    if block["id"] in PAGE_IDS:
        return block["p"].get("s") != VOLUME and block["p"].get("s") not in OF_TABLE
    return any(str(block["p"].get(key, "")).startswith(PAGE_LINE) for key in ("line", "a", "b"))


def clean_zone(raw):
    """La capa de zona: las zonas elegidas (cualquiera de ellas sirve), qué se pide del precio (`near`: a menos de `atr`
    ATR; `in`: que la vela la toque) y cuándo se mira (al empezar el gatillo o en la señal)."""
    raw = raw if isinstance(raw, dict) else {}
    picks = [p for p in (clean_pick(x) for x in (raw.get("picks") or [])[:MAX_PICKS]) if p]
    return {"picks": picks, "rel": "in" if raw.get("rel") == "in" else "near", "atr": _num(raw.get("atr"), *ZONE_NEAR),
            "when": "last" if raw.get("when") == "last" else "first"}


def clean_doc(raw):
    """La estrategia en borrador con todo dentro de rango. Nunca None: un documento vacío es la cocina en blanco."""
    raw = raw if isinstance(raw, dict) else {}
    ctx = [b for b in (clean_block(x, "ctx") for x in (raw.get("ctx") or [])[:MAX_BLOCKS]) if b]
    gat = []
    for g in (raw.get("gat") or [])[:MAX_STEPS]:
        g = g if isinstance(g, dict) else {}
        blocks = [b for b in (clean_block(x, "step") for x in (g.get("blocks") or [])[:MAX_BLOCKS]) if b]
        gat.append({"mode": g.get("mode") if g.get("mode") in ("all", "min", "any") else "all",
                    "min": int(_num(g.get("min"), 1, 1, MAX_BLOCKS)), "win": int(_num(g.get("win"), 5, 1, 20)),
                    "blocks": blocks})
    links = []
    for i in range(max(0, len(gat) - 1)):
        item = (raw.get("links") or [])[i] if i < len(raw.get("links") or []) else {}
        item = item if isinstance(item, dict) else {}
        links.append({"type": item.get("type") if item.get("type") in ("after", "same", "any") else "after",
                      "max": int(_num(item.get("max"), 5, 1, 60))})
    return {"side": raw.get("side") if raw.get("side") in SIDES else "short",
            "ctx": ctx, "ctxWhen": "last" if raw.get("ctxWhen") == "last" else "first", "zone": clean_zone(raw.get("zone")),
            "gat": gat, "links": links}


def uses_flow(doc):
    """Si la estrategia tiene algún bloque de order flow."""
    return any(block_flow(b) for b in doc["ctx"] + [b for g in doc["gat"] for b in g["blocks"]])


# ==================== Order flow en segundo plano ====================

def has_store(symbol):
    """Si la moneda tiene almacén de trades (la misma condición del probador). Se mira a lo sumo cada STORE_CHECK_S."""
    now = time.time()
    with _lock:
        found = _stores.get(symbol)
        if found is not None and now - found[0] < STORE_CHECK_S:
            return found[1]
    try:
        answer = bool(rt.has_store(symbol))
    except OSError:
        answer = False
    with _lock:
        _stores[symbol] = (now, answer)
    return answer


class FlowBook:
    """Elementos OF y delta real de una moneda y un marco, por bloques de días. Cada bloque se detecta una vez con
    of_elements.detect y los valores de fábrica del probador (su `target` y su filtro de volumen), en un hilo aparte.

    Un bloque ya cerrado no cambia. El que contiene la última vela se detecta otra vez cuando cierra una vela nueva.
    Un bloque detectado con más velas sirve para un pedido con menos (la simulación retrocedió): al leerlo se dejan
    fuera las velas y los eventos que ese pedido todavía no conoce."""

    def __init__(self, symbol, tf):
        self.symbol, self.tf = symbol, int(tf)
        self.tf_ms = self.tf * 60000
        self.size = FLOW_BLOCK_DAYS[self.tf] * oe.DAY_MS
        self.blocks = {}
        self.cond = threading.Condition()
        self.want = None       # (bloques que faltan, hasta cuándo se conoce) del último pedido
        self.running = False
        self.error = None

    def _fresh(self, start, known):
        block = self.blocks.get(start)
        if block is None or block["known"] < min(known, start + self.size + self.tf_ms):
            return False
        return not (block["short"] and time.time() - block["at"] > FLOW_STALE_S)

    def _detect(self, start, known):
        end = start + self.size
        # Una vela de más, para que la última del bloque vea a su siguiente (VA abandonada), como el probador
        part = oe.detect(self.symbol, self.tf, start, min(end + self.tf_ms, known) - 1, known, oe.DEFAULT_TARGET, 0, oe.DEFAULT_VOL_FILTER)
        bars = {b["t"]: (b["delta"], b["vol"], b.get("cum"), b.get("maxd"), b.get("mind")) for b in part["bars"] if start <= b["t"] < end}
        events = [(e["code"], e["t"], e["known"], e["dir"]) for e in part["events"] if start <= e["t"] < end and e["known"] <= known]
        expected = max(0, (min(end, known) - start) // self.tf_ms)
        return {"known": known, "events": events, "bars": bars, "short": len(bars) < expected, "at": time.time()}

    def _work(self):
        while True:
            with self.cond:
                missing, known = self.want or ((), 0)
                todo = [s for s in missing if not self._fresh(s, known)]
                if not todo:
                    self.running, self.want = False, None
                    self.cond.notify_all()
                    return
                start = todo[-1]   # Primero lo más reciente: es lo que se está mirando
            try:
                block = self._detect(start, known)
            except Exception as problem:   # Un día ilegible del almacén no puede dejar el hilo colgado
                with self.cond:
                    self.error = f"{type(problem).__name__}: {problem}"[:200]
                    self.running, self.want = False, None
                    self.cond.notify_all()
                return
            with self.cond:
                self.blocks[start] = block
                for old in sorted(self.blocks)[:max(0, len(self.blocks) - FLOW_KEEP)]:
                    if old not in missing:
                        del self.blocks[old]
                self.cond.notify_all()

    def get(self, first_t, last_t, wait=FLOW_WAIT):
        """El order flow de las velas que abren entre first_t y last_t, todas ya cerradas. Listo: {"state": "ready",
        "events": {código: [(hora de la vela, hora en que se conoce, lado)]}, "bars": {hora: (delta, volumen)}}.
        Si falta algún bloque lo pide al hilo y espera hasta `wait` segundos; pasado eso responde "loading"."""
        known = last_t + self.tf_ms
        starts = list(range(first_t // self.size * self.size, last_t + 1, self.size))
        deadline = time.monotonic() + max(0.0, wait)
        with self.cond:
            while True:
                missing = [s for s in starts if not self._fresh(s, known)]
                if not missing:
                    break
                if self.error:
                    message, self.error = self.error, None   # Se dice una vez: el pedido siguiente lo intenta de nuevo
                    return {"state": "error", "message": message}
                self.want = (missing, known)
                if not self.running:
                    self.running = True
                    threading.Thread(target=self._work, name=f"kitchen-flow-{self.symbol}-{self.tf}", daemon=True).start()
                left = deadline - time.monotonic()
                if left <= 0:
                    return {"state": "loading", "done": len(starts) - len(missing), "total": len(starts)}
                self.cond.wait(left)
            events, bars = {}, {}
            for start in starts:
                block = self.blocks[start]
                for code, t, at, way in block["events"]:
                    if first_t <= t <= last_t and at <= known:
                        events.setdefault(code, []).append((t, at, way))
                for t, row in block["bars"].items():
                    if first_t <= t <= last_t:
                        bars[t] = row
        return {"state": "ready", "events": events, "bars": bars}


def flow_book(symbol, tf):
    key = (symbol, int(tf))
    with _lock:
        book = _books.get(key)
        if book is None:
            book = _books[key] = FlowBook(symbol, tf)
        _books.move_to_end(key)
        while len(_books) > FLOW_BOOKS:
            _books.popitem(last=False)
    return book


# ==================== Lo que se cumple en cada vela ====================

def _any_back(values, near, far):
    """Por vela i: si `values` vale en alguna de las velas i−far … i−near (0 ≤ near ≤ far)."""
    n = len(values)
    total = np.concatenate(([0], np.cumsum(values.astype(np.int64))))
    i = np.arange(n)
    return (total[np.clip(i - near + 1, 0, n)] - total[np.clip(i - far, 0, n)]) > 0


class Facts:
    """Unas velas cerradas y lo que los detectores dicen de ellas. Cada cálculo se hace una vez."""

    def __init__(self, symbol, tf, bars):
        self.symbol, self.tf, self.bars = symbol, int(tf), bars
        self.tf_ms = self.tf * 60000
        self.n = len(bars)
        self.ctx = rt._context(symbol, self.tf, bars)
        self.ctx["bars"] = bars
        self.span = {"bars": bars, "events": [], "lead": 0, "warm": []}
        self.index = {b["t"]: i for i, b in enumerate(bars)}
        self.O, self.H, self.L, self.C = (np.array(self.ctx[k], dtype=float) for k in ("O", "H", "L", "C"))
        self.atr = np.array(self.ctx["atr"], dtype=float)
        self.Vol = np.array(self.ctx["V"], dtype=float)
        self.lock = threading.RLock()
        self._lines, self._events, self._truth = {}, {}, {}
        self._bw = None
        self._vpa = {}
        self._zones, self._layers = {}, {}
        self._flow, self._flow_first, self._cvd = None, None, {}
        self.session = clean_session(None)     # Los ajustes del modal de cada indicador en el pedido en curso
        self.page = clean_page(None, self.n)   # Lo del gráfico en el pedido en curso (evaluate lo pone, con el candado)

    # ---------- Series
    def bw(self):
        if self._bw is None:
            self._bw = williams.compute(self.ctx["H"], self.ctx["L"], self.ctx["C"], v=self.ctx["V"])
        return self._bw

    def meter(self):
        """El medidor del Lector VPA, con sus valores de fábrica (los del probador)."""
        stamp = json.dumps(self.session.get("vpa") or {}, sort_keys=True)
        if stamp not in self._vpa:
            rule = self.rule(("QE",), {"vpa": self.session["vpa"]} if self.session.get("vpa") else None)
            cfg = rt._vpa_cfg(rule) if rule else None
            series = vpa.compute(self.ctx["T"], self.ctx["O"], self.ctx["H"], self.ctx["L"], self.ctx["C"], self.ctx["V"], self.tf, cfg)
            self._vpa[stamp] = np.array([x if x is not None else np.nan for x in series["meter"]], dtype=float)
        return self._vpa[stamp]

    def line(self, name):
        """Una EMA del cierre (la del probador: sin dato hasta tener su periodo) o una línea del Alligator."""
        if name.startswith(PAGE_LINE):
            found = self.page["lines"].get(name[len(PAGE_LINE):])
            return found if found is not None else np.full(self.n, np.nan)
        if name not in self._lines:
            if name in LINES:
                self._lines[name] = np.array([x if x is not None else np.nan for x in self.bw()[name]], dtype=float)
            else:
                self._lines[name] = np.array(rt._line(self.ctx, "ema", int(name[1:])), dtype=float)
        return self._lines[name]

    # ---------- Eventos del probador
    def rule(self, codes, extra=None):
        """La regla del probador que detecta esos códigos, con sus valores de fábrica y los cambios de `extra`."""
        rule = rt.clean_rule({"tf": self.tf, "name": "cocina", "recipe": {"slots": [{"codes": list(codes)}], "mode": "threshold", "min": 1},
                              **(extra or {})})
        if rule is not None and rule["tf"] != self.tf:
            # 1 minuto no es un marco del probador. Los detectores usan el marco para la hora en que se conoce cada
            # evento y para comparar cada vela con su misma hora: va el de las velas
            rule["tf"] = self.tf
            if rule.get("cc"):
                rule["cc"]["tf"] = self.tf
        return rule

    def family(self, name, extra=None):
        """Los eventos de una familia: por código, (vela del elemento, vela con que se conoce, lado)."""
        key = (name, json.dumps(extra or {}, sort_keys=True))
        if key in self._events:
            return self._events[key]
        codes = FAMILIES[name]
        if name == "vh":
            found = liq_sweeps._volume_events(self.bars, self.tf_ms)
        else:
            rule = self.rule(codes, extra)
            call = {"pat": rt._pattern_events, "fs": rt._fs_events, "cc": rt._cc_events, "box": rt._box_events,
                    "rv": rt._rv_events, "gc": rt._gc_events, "vpa": rt._vpa_events, "wise": rt._williams_events,
                    "smc": rt._smc_events}[name]
            found = call(rule, self.span) if rule else []
        out = {code: [] for code in codes}
        for e in found:
            if e.get("code") not in out:
                continue
            at = self.index.get(e["t"])
            known = self.index.get(e["known"] - self.tf_ms) if e.get("known") is not None else at
            if at is None or known is None or known < at:
                continue
            out[e["code"]].append((at, known, int(e.get("dir") or 0)))
        for rows in out.values():
            rows.sort()
        self._events[key] = out
        return out

    def events_of(self, code, p=None):
        if code in OF_CODES:
            flow = self.flow()
            return flow["events"].get(code, []) if flow["state"] == "ready" else []
        extra = {}
        for rule_key, field, default, low, high in EVENT_PARAMS.get(code, ()):
            extra.setdefault(rule_key, {})[field] = (p or {}).get(field, default)
        # Los de la misma familia van juntos: sus otros códigos, con los valores de fábrica
        for other in FAMILIES[FAMILY_OF[code]]:
            for rule_key, field, default, _, _ in EVENT_PARAMS.get(other, ()):
                extra.setdefault(rule_key, {}).setdefault(field, default)
        # Con los ajustes del modal del indicador, si la sesión los trae; lo que cambia la cocina en el bloque manda
        family = FAMILY_OF[code]
        if family in SESSION_FAMILIES and self.session.get(family):
            extra[family] = {**self.session[family], **extra.get(family, {})}
        return self.family(family, extra or None)[code]

    # ---------- Order flow
    def want_flow(self, start):
        """Desde qué vela hace falta el order flow: FLOW_LEAD velas antes de lo recorrido, que empieza en `start`."""
        first = max(0, int(start) - FLOW_LEAD)
        if self._flow_first is None or first < self._flow_first:
            self._flow_first, self._flow, self._cvd = first, None, {}
            self._truth = {key: value for key, value in self._truth.items()
                           if key[0] not in OF_CODES and key[0] not in FLOW_STATE_IDS and '"s": "of_' not in key[1]}

    def flow(self, wait=0.0):
        """El order flow de estas velas. {"state": "none"} sin almacén de trades; "loading" o "error" mientras no esté;
        "ready" con los eventos por código (vela del elemento, vela con que se conoce, lado) y, por vela, el delta y el
        volumen reales (NaN donde el almacén no tiene la vela)."""
        if self._flow is not None:
            return self._flow
        if self.tf not in FLOW_BLOCK_DAYS or not has_store(self.symbol):
            self._flow = {"state": "none"}
            return self._flow
        first = self._flow_first if self._flow_first is not None else max(0, self.n - 1000 - FLOW_LEAD)
        got = flow_book(self.symbol, self.tf).get(self.bars[first]["t"], self.bars[-1]["t"], wait)
        if got["state"] != "ready":
            return got
        events = {}
        for code, rows in got["events"].items():
            found = []
            for t, known, way in rows:
                at, at_known = self.index.get(t), self.index.get(known - self.tf_ms)
                if at is not None and at_known is not None and at_known >= at:
                    found.append((at, at_known, int(way)))
            events[code] = sorted(found)
        delta, vol = np.full(self.n, np.nan), np.full(self.n, np.nan)
        table = {name: np.full(self.n, np.nan) for name in ("of_cum", "of_maxd", "of_mind")}
        for t, row in got["bars"].items():
            i = self.index.get(t)
            if i is not None:
                delta[i], vol[i] = row[0], row[1]
                for name, value in zip(("of_cum", "of_maxd", "of_mind"), row[2:5]):
                    if value is not None:
                        table[name][i] = value
        with np.errstate(invalid="ignore", divide="ignore"):
            table["of_delta"], table["of_dvol"] = delta, np.where(vol > 0, delta / vol * 100, np.nan)
        have = np.isfinite(delta[first:])
        self._flow = {"state": "ready", "events": events, "delta": delta, "vol": vol, "table": table, "first": first,
                      "cover": round(float(have.mean()), 3) if len(have) else 0.0}
        return self._flow

    def cvd(self, count):
        """CVD de las últimas `count` velas sobre su volumen, con la función del filtro de CVD del probador
        (flow_filters.cvd) y el delta real del almacén. NaN sin order flow, o si falta el delta de alguna de esas velas."""
        if count in self._cvd:
            return self._cvd[count]
        out = np.full(self.n, np.nan)
        flow = self.flow()
        if flow["state"] != "ready":
            return out   # Sin guardar: se calcula cuando llegue el order flow
        first = flow["first"]
        delta, vol = flow["delta"][first:], flow["vol"][first:]
        ok = np.isfinite(delta)
        if ok.any():
            rows = [{**bar, "delta": float(d) if k else 0.0, "vol": float(v) if k else 0.0}
                    for bar, d, v, k in zip(self.bars[first:], delta, vol, ok)]
            values, estimated = flow_filters.cvd(rows, count)
            if not estimated:
                gaps = np.concatenate(([0], np.cumsum(~ok)))
                i = np.arange(len(ok))
                out[first:] = np.where(gaps[i + 1] - gaps[np.clip(i + 1 - count, 0, None)] == 0, values, np.nan)
        self._cvd[count] = out
        return out

    # ---------- Zonas
    def _zone(self, kind, way, a, b, lo, hi, edge=None):
        """Una zona: cuenta en las velas a..b con esos bordes (un número, o uno por vela si cambian en el camino).
        edge: el precio que la termina con un cierre más allá, cuando no es su propio borde (un nivel de S&R)."""
        first = lambda value: float(value if np.isscalar(value) else value[0])
        zone = {"kind": kind, "way": int(way), "a": int(a), "b": int(b), "lo": lo, "hi": hi, "lo0": first(lo), "hi0": first(hi)}
        if edge is not None:
            zone["edge"] = edge
        return zone

    def _sr_zones(self):
        """Soportes y resistencias: los swings del probador (su elemento Swing, SR_BARS velas por lado) con la vida del
        indicador S&R v2 (swingLevels.js). Un nivel nace al conocerse su swing; otro swing a SR_CLUSTER_PCT o menos de
        su primer toque lo refuerza; termina cuando una vela cierra más allá de todos sus toques. La zona es la línea
        que dibuja el indicador: el promedio de los toques, que se corre cuando llega uno nuevo."""
        sr = self.session.get("sr") or {"bars": SR_BARS, "cluster": SR_CLUSTER_PCT}
        rule = self.rule(("SP",), {"sp": {"bars": sr["bars"]}})
        swings = {}
        for e in (rt._fs_events(rule, self.span) if rule else []):
            known = self.index.get(e["known"] - self.tf_ms) if e.get("code") == "SP" else None
            if known is not None:
                # Un mínimo es un soporte (lado 1) y un máximo, una resistencia (lado −1)
                swings.setdefault(known, []).append((int(e["dir"]), float(e["info"]["price"])))
        n, close = self.n, self.C
        live, nearest, out = {1: [], -1: []}, {1: None, -1: None}, []

        def finish(level, last):
            marks = level["marks"]   # (desde qué vela, precio del nivel, toque más lejano), cada vez que un toque los cambia
            a = marks[0][0]
            if last < a:
                return
            if len(marks) == 1:
                out.append(self._zone("sr", level["way"], a, last, marks[0][1], marks[0][1], marks[0][2]))
                return
            price, edge = np.empty(last - a + 1), np.empty(last - a + 1)
            for k, (start, level_price, extreme) in enumerate(marks):
                stop = min(marks[k + 1][0] if k + 1 < len(marks) else last + 1, last + 1)
                if stop > start:
                    price[start - a:stop - a], edge[start - a:stop - a] = level_price, extreme
            out.append(self._zone("sr", level["way"], a, last, price, price, edge))

        for i in range(n):
            for way in (-1, 1):
                # El nivel activo que se rompería primero: si el cierre no lo pasa, no pasa ninguno
                if nearest[way] is None or (close[i] - nearest[way]) * way >= 0:
                    continue
                keep, edge = [], None
                for level in live[way]:
                    if (close[i] - level["extreme"]) * way < 0:
                        finish(level, i - 1)   # Roto en esta vela: deja de contar desde ella
                    else:
                        keep.append(level)
                        if edge is None or (level["extreme"] - edge) * way > 0:
                            edge = level["extreme"]
                live[way], nearest[way] = keep, edge
            for way, price in swings.get(i, ()):
                best, gap = None, None
                for level in live[way]:
                    distance = abs(price - level["anchor"]) / level["anchor"] * 100
                    if distance <= sr["cluster"] and (gap is None or distance < gap):
                        best, gap = level, distance
                if best is None:
                    live[way].append({"way": way, "anchor": price, "extreme": price, "sum": price, "touches": 1, "marks": [(i + 1, price, price)]})
                    if nearest[way] is None or (price - nearest[way]) * way > 0:
                        nearest[way] = price
                    continue
                if (price - best["extreme"]) * way < 0:
                    best["extreme"] = price
                best["sum"] += price
                best["touches"] += 1
                mark = (i + 1, best["sum"] / best["touches"], best["extreme"])
                if mark[1:] != best["marks"][-1][1:]:
                    best["marks"].append(mark)
        for way in (-1, 1):
            for level in live[way]:
                finish(level, n - 1)
        return out

    def _open_gap(self, a, lo, hi, way, kind="fvg"):
        """Un hueco [lo, hi] que cuenta desde la vela a, con la vida del indicador FVG en su modo de fábrica: cada vela
        que entra en él lo recorta (uno alcista, por su borde alto; uno bajista, por el bajo) y termina en la vela
        anterior a la que lo llena entero."""
        if a >= self.n:
            return None
        if way > 0:
            filled = np.flatnonzero(self.L[a:] <= lo)
            b = a + int(filled[0]) - 1 if len(filled) else self.n - 1
            if b < a:
                return None
            top = np.minimum(hi, np.concatenate(([np.inf], np.minimum.accumulate(self.L[a:b]))))
            return self._zone(kind, way, a, b, lo, top if (top != hi).any() else hi)
        filled = np.flatnonzero(self.H[a:] >= hi)
        b = a + int(filled[0]) - 1 if len(filled) else self.n - 1
        if b < a:
            return None
        bottom = np.maximum(lo, np.concatenate(([-np.inf], np.maximum.accumulate(self.H[a:b]))))
        return self._zone(kind, way, a, b, bottom if (bottom != lo).any() else lo, hi)

    def _fvg_zones(self):
        """FVG abiertos: el «FVG nuevo» del probador (hueco de FVG_MIN_ATR o más), desde la vela siguiente a la que lo
        da a conocer."""
        rule = self.rule(("FV",), {"fv": {"minAtr": FVG_MIN_ATR}})
        out = []
        for e in (rt._fs_events(rule, self.span) if rule else []):
            known = self.index.get(e["known"] - self.tf_ms) if e.get("code") == "FV" else None
            zone = None if known is None else self._open_gap(known + 1, float(e["lo"]), float(e["hi"]), int(e["dir"]))
            if zone:
                out.append(zone)
        return out

    def _ob_zones(self):
        """Order blocks de la estructura SMC (smc.compute con los valores de fábrica del probador), de la estructura
        interna y de la mayor, como los dibuja el indicador. Cada uno cuenta desde la vela siguiente a la ruptura que
        lo crea y hasta la vela anterior a la que lo rompe (un cierre más allá de su borde lejano)."""
        rule = self.rule(("OB",), {"smc": self.session["smc"]} if self.session.get("smc") else None)
        found = smc.compute(self.ctx["O"], self.ctx["H"], self.ctx["L"], self.ctx["C"], (rule or {}).get("smc") or {})
        out = []
        for ob in found["obs"]:
            a = ob["known"] + 1
            b = self.n - 1 if ob["broken"] is None else ob["broken"] - 1
            if b >= a and ob["top"] >= ob["bottom"] > 0:
                out.append(self._zone("ob", ob["dir"], a, b, float(ob["bottom"]), float(ob["top"])))
        return out

    def _liq_zones(self):
        """Zonas de liquidaciones: las que mostraría el indicador al abrir cada vela (liq_sweeps.zones_at, con lo
        liquidado conocido hasta esa hora y el precio de esa apertura). Una zona cuenta mientras se muestra, vela tras
        vela. Sin datos de liquidaciones de la moneda no hay ninguna."""
        try:
            sources = liq_store._sources(self.symbol)
        except OSError:
            sources = []
        if not sources:
            return []
        # Lo que se mostraba al abrir cada vela no cambia: queda guardado por moneda y marco, así una vela nueva pide
        # solo la suya. Si se relee el archivo de liquidaciones, lo guardado deja de valer
        with _lock:
            book = _liq.setdefault((self.symbol, self.tf), {"rows": {}, "cache": {}, "stamp": None})
            _liq.move_to_end((self.symbol, self.tf))
            while len(_liq) > FLOW_BOOKS:
                _liq.popitem(last=False)
        stamp = tuple(id(data) for data, _ in sources)
        if book["stamp"] != stamp:
            book["rows"], book["cache"], book["stamp"] = {}, {}, stamp
        rows = book["rows"]

        def finish(chain):
            lo, hi = np.array(chain["los"]), np.array(chain["his"])
            return self._zone("liq", 0, chain["a"], chain["a"] + len(lo) - 1, lo if (lo != lo[0]).any() else float(lo[0]),
                              hi if (hi != hi[0]).any() else float(hi[0]))

        out, chains = [], []
        first = max(0, self.n - LIQ_BARS)
        for i in range(first, self.n):
            bar = self.bars[i]
            got = rows.get(bar["t"])
            if got is None or got[0] != bar["o"]:
                zones, _ = liq_sweeps.zones_at(self.symbol, bar["t"], bar["o"], sources, book["cache"])
                got = rows[bar["t"]] = (bar["o"], [(float(z["low"]), float(z["high"])) for z in zones or []])
            used, following = set(), []
            for lo, hi in got[1]:
                # La zona de la vela anterior, aunque sus bordes se hayan corrido con lo liquidado después: la que se solapa
                match = next((k for k, chain in enumerate(chains) if k not in used and chain["los"][-1] <= hi and lo <= chain["his"][-1]), None)
                if match is None:
                    following.append({"a": i, "los": [lo], "his": [hi]})
                else:
                    used.add(match)
                    chains[match]["los"].append(lo)
                    chains[match]["his"].append(hi)
                    following.append(chains[match])
            out += [finish(chain) for k, chain in enumerate(chains) if k not in used]
            chains = following
        out += [finish(chain) for chain in chains]
        if len(rows) > 4 * LIQ_BARS:
            limit = self.bars[first]["t"]
            for t in [t for t in rows if t < limit]:
                del rows[t]
        return out

    def zones(self, kind):
        """Las zonas de un tipo en estas velas. Cada tipo se arma una vez."""
        kind_key = kind
        kind = (kind, self.session["stamp"])
        if kind not in self._zones:
            make = {"sr": self._sr_zones, "fvg": self._fvg_zones, "ob": self._ob_zones, "liq": self._liq_zones}[kind_key]
            self._zones[kind] = sorted(make(), key=lambda z: (z["a"], z["lo0"]))
        return self._zones[kind]

    def _fixed_zone(self, pick):
        """«Solo esta zona»: una franja fija que cuenta desde la primera vela que abre en `from` o después. Termina como
        las de su tipo: un soporte, una resistencia o un order block, con un cierre más allá; un FVG, al llenarse. Una
        zona de liquidaciones, un dibujo del usuario o un nivel de un VP fijo no terminan: valen hasta que se quitan de
        la estrategia."""
        if "T" not in self._zones:
            self._zones["T"] = np.array(self.ctx["T"], dtype=np.int64)
        a = int(np.searchsorted(self._zones["T"], pick["from"], side="left"))
        if a >= self.n:
            return None
        kind, way, lo, hi = pick["kind"], pick["way"], pick["lo"], pick["hi"]
        if kind == "fvg" and way:
            return self._open_gap(a, lo, hi, way)
        b = self.n - 1
        if kind in ("sr", "ob") and way:
            limit = pick.get("edge", lo if way > 0 else hi)
            broke = np.flatnonzero(self.C[a:] < limit if way > 0 else self.C[a:] > limit)
            if len(broke):
                b = a + int(broke[0]) - 1
        return self._zone(kind, way, a, b, lo, hi) if b >= a else None

    def zone_layer(self, zone, sd):
        """La capa de zona para un trade de ese lado. En cada vela: si el precio queda a `atr` ATR o menos de alguna de
        las zonas elegidas (near), si la toca (touch), si llega a ella (arrive: la toca y en la vela anterior, con la
        zona ya a la vista, no) y si la rechaza (reject: la toca y cierra fuera, del lado del trade: por debajo en un
        corto, por encima en un largo). `ok` es lo que pide la capa: cerca o tocándola;
        sin zonas elegidas no pide nada. `picks`: las zonas de cada elección."""
        key = (json.dumps(zone, sort_keys=True), sd, self.session["stamp"])
        if key in self._layers:
            return self._layers[key]
        n = self.n
        near, touch, arrive, reject = (np.zeros(n, dtype=bool) for _ in range(4))
        picks = {}
        for pick in zone["picks"]:
            if pick["type"] == "one":
                fixed = self._fixed_zone(pick)
                chosen = [fixed] if fixed else []
            else:
                want = 0 if pick["dir"] == "any" else sd * (-1 if pick["dir"] == "contra" else 1)
                chosen = [z for z in self.zones(pick["kind"]) if not want or not z["way"] or z["way"] == want]
            picks[pick["uid"]] = chosen
            for z in chosen:
                part = slice(z["a"], z["b"] + 1)
                gap = np.maximum(0.0, np.maximum(z["lo"] - self.H[part], self.L[part] - z["hi"]))
                hit = gap == 0
                near[part] |= gap <= zone["atr"] * self.atr[part]
                touch[part] |= hit
                # Llegar pide una vela anterior con la zona ya a la vista y sin tocarla: una zona que aparece con el precio
                # adentro (pasa con las de liquidaciones, que se rearman) no es una llegada
                arrive[part] |= hit & ~np.concatenate(([True], hit[:-1]))
                reject[part] |= hit & (self.C[part] < z["lo"] if sd < 0 else self.C[part] > z["hi"])
        has = bool(zone["picks"])
        out = {"has": has, "near": near, "touch": touch, "arrive": arrive, "reject": reject, "picks": picks,
               "ok": (touch if zone["rel"] == "in" else near) if has else np.ones(n, dtype=bool)}
        if len(self._layers) > 12:
            self._layers.clear()
        self._layers[key] = out
        return out

    def zone_by(self, layer, i):
        """La zona elegida más cercana a la vela i, entre las que cuentan en ella y quedan a CANDLE_ZONE_ATR o menos:
        [borde bajo, borde alto] con los bordes de esa vela, o None. Es la zona de una señal, para poner su stop en el
        borde lejano (paso 1.3). Solo mira esa vela: nada posterior."""
        atr = float(self.atr[i]) if self.atr[i] > 0 else 0.0
        best = None
        for chosen in layer["picks"].values():
            for z in chosen:
                if not z["a"] <= i <= z["b"]:
                    continue
                lo = float(z["lo"] if np.isscalar(z["lo"]) else z["lo"][i - z["a"]])
                hi = float(z["hi"] if np.isscalar(z["hi"]) else z["hi"][i - z["a"]])
                gap = max(0.0, lo - float(self.H[i]), float(self.L[i]) - hi)
                if gap <= CANDLE_ZONE_ATR * atr and (best is None or gap < best[0]):
                    best = (gap, lo, hi)
        return None if best is None else [best[1], best[2]]

    def zones_at(self, i, price=None, offers=()):
        """Las zonas que cuentan en la vela i, de todos los tipos: primero las que quedan bajo el precio del clic (la más
        angosta antes) y después las más cercanas a él (sin clic, a la vela). Es lo que se ofrece para la capa de zona.
        Cada una va con los bordes que tiene en esa vela y desde cuándo los tiene: así, elegida sola, es la misma
        franja que se ve.

        offers: las zonas que solo conoce la página (clean_offers: un nivel de un VP fijo, un dibujo). Se ordenan con
        las demás y vuelven con su `ref`. No son de esa vela sino de ahora: desde cuándo cuentan lo pone la página."""
        atr = float(self.atr[i]) if self.atr[i] > 0 else 0.0
        ref = float(price) if isinstance(price, (int, float)) and price == price and price > 0 else None
        found, seen = [], set()

        def offer(kind, way, lo, hi, extra):
            gap = max(0.0, lo - float(self.H[i]), float(self.L[i]) - hi)
            off = None if ref is None else max(0.0, lo - ref, ref - hi)
            # Dos zonas iguales (un order block de la estructura interna y de la mayor) se ofrecen una vez: la más vieja
            if min(gap, gap if off is None else off) > CANDLE_ZONE_ATR * atr or (kind, way, lo, hi) in seen:
                return
            seen.add((kind, way, lo, hi))
            # Bajo el clic (con un margen, para acertarle a una línea), primero la más angosta: una línea antes que la
            # franja ancha que la contiene. Después, las demás por distancia
            under = off is not None and off <= 0.15 * atr
            found.append({"kind": kind, "way": way, "lo": lo, "hi": hi, "touch": gap == 0,
                          "gapAtr": round(gap / atr, 2) if atr else None, "under": under, **extra,
                          "rank": (0, hi - lo, off) if under else (1, gap if off is None else off, hi - lo)})

        for kind in ZONE_KINDS:
            for z in self.zones(kind):
                if not z["a"] <= i <= z["b"]:
                    continue
                # Los bordes de esta vela y desde cuándo son esos: los que cambian en el camino van uno por vela
                k = i - z["a"]
                moving = [z[field] for field in ("lo", "hi", "edge") if field in z and not np.isscalar(z[field])]
                lo, hi = (float(z[field] if np.isscalar(z[field]) else z[field][k]) for field in ("lo", "hi"))
                edge = None if "edge" not in z else float(z["edge"] if np.isscalar(z["edge"]) else z["edge"][k])
                while k > 0 and all(values[k - 1] == values[k] for values in moving) and moving:
                    k -= 1
                since = z["a"] + k if moving else z["a"]
                offer(kind, z["way"], lo, hi, {"from": self.bars[since]["t"], **({} if edge is None else {"edge": edge})})
        for item in offers:
            offer(item["kind"], 0, item["lo"], item["hi"], {"ref": item["ref"]})
        found.sort(key=lambda item: item["rank"])
        return [{key: value for key, value in item.items() if key != "rank"} for item in found[:CANDLE_ZONES]]

    # ---------- Cada bloque, vela por vela
    def state(self, bid, p, d):
        n, C, atr = self.n, self.C, self.atr
        out = np.zeros(n, dtype=bool)
        if bid in ("side", "lejos"):
            line = self.line(p["line"])
            ok = np.isfinite(line)
            gap = np.where(ok, (C - np.where(ok, line, 0.0)) * d, -np.inf)
            return ok & (gap > 0) if bid == "side" else ok & (gap >= p["atr"] * atr)
        if bid == "order":
            a, b, c = (self.line(x) for x in ORDER_LINES)
            ok = np.isfinite(a) & np.isfinite(b) & np.isfinite(c)
            with np.errstate(invalid="ignore"):
                return ok & ((a > b) & (b > c) if d > 0 else (a < b) & (b < c))
        if bid in ("awake", "sleep"):
            state = np.array(self.bw()["state"])
            if bid == "awake":
                return state == d
            return (state == 0) & np.isfinite(self.line("jaw")) & np.isfinite(self.line("teeth")) & np.isfinite(self.line("lips"))
        if bid == "tramo":
            back = int(p["n"])
            if n > back:
                out[back:] = (C[back:] - C[:-back]) * d >= p["atr"] * atr[back:]
            return out
        if bid == "pausa":
            count = int(p["n"])
            if n >= count:
                high = np.lib.stride_tricks.sliding_window_view(self.H, count).max(axis=1)
                low = np.lib.stride_tricks.sliding_window_view(self.L, count).min(axis=1)
                out[count - 1:] = (high - low) <= p["atr"] * atr[count - 1:]
            return out
        if bid == "vpam":
            meter = self.meter()
            ok = np.isfinite(meter)
            return ok & (np.where(ok, meter, 0.0) * d >= p["u"])
        if bid in PAGE_STATE_IDS:
            # Una serie de un panel del gráfico: sube (o baja) en N velas, o está sobre (o bajo) cero
            if bid == "pumbral":
                return self.threshold(p, d)
            value = self.num(p["s"])
            if value is None:
                return out
            if bid == "ppos":
                ok = np.isfinite(value)
                return ok & (np.where(ok, value, 0.0) * d > 0)
            return self.rising(value, p, d or 1)
        if bid in FLOW_STATE_IDS:
            # Con trades reales: el delta de la vela, o el CVD de las últimas N (el filtro de CVD del probador), de ese lado
            flow = self.flow()
            if flow["state"] != "ready":
                return out
            value = flow["delta"] if bid == "delta" else self.cvd(int(p["n"]))
            ok = np.isfinite(value)
            out = ok & (np.where(ok, value, 0.0) * d > 0)
            least = float(p.get("min") or 0)
            if least > 0:
                # Su peso sobre el volumen negociado: el de la vela, o el de las N del CVD (que ya viene sobre su volumen)
                with np.errstate(invalid="ignore", divide="ignore"):
                    share = np.abs(value) / flow["vol"] * 100 if bid == "delta" else np.abs(value) * 100
                out &= np.isfinite(share) & (np.where(np.isfinite(share), share, 0.0) >= least)
            return out
        return out

    def num(self, name):
        """Una serie de un panel: el volumen de las velas, que el motor ya tiene, o lo que manda la página."""
        if name in OF_TABLE:
            flow = self.flow()
            return flow["table"][name] if flow["state"] == "ready" else None
        return self.Vol if name == VOLUME else self.page["nums"].get(name)

    def threshold(self, p, d):
        """Dónde el valor de una serie pasa un umbral. `ge`: del lado d (o de cualquiera, con d 0), al menos `u`; `le`:
        su tamaño no pasa de `u`. `unit`: el valor tal cual (abs), en veces la mediana de su tamaño en las 100 velas
        anteriores (x), o en % del volumen de la vela (vol; el real, en las casillas de la tabla de la vela)."""
        out = np.zeros(self.n, dtype=bool)
        value = self.num(p["s"])
        if value is None:
            return out
        ok = np.isfinite(value)
        size = np.where(ok, np.abs(value), np.nan)
        if p["unit"] == "vol":
            base = self.flow()["vol"] if p["s"] in OF_TABLE else self.Vol
            limit = p["u"] / 100 * np.where(np.isfinite(base), base, np.nan)
        elif p["unit"] == "x":
            limit = np.full(self.n, np.nan)
            for i in np.flatnonzero(ok):
                past = size[max(0, i - PAGE_BIG_BARS):i]
                past = past[np.isfinite(past)]
                if len(past) >= 20:
                    limit[i] = p["u"] * float(np.median(past))
        else:
            limit = np.full(self.n, float(p["u"]))
        with np.errstate(invalid="ignore"):
            if p["op"] == "le":
                return ok & np.isfinite(limit) & (size <= limit)
            side = (np.where(ok, value, 0.0) * d > 0) if d else ok
            return ok & np.isfinite(limit) & side & (size >= limit) & (size > 0)

    def rising(self, value, p, d):
        """Dónde una serie sube (d 1) o baja (d −1) en N velas. `how`: contra su valor de hace N velas (ends), el
        promedio de las últimas N contra el de las N anteriores (avg), o N velas seguidas (steps). `min` pide un mínimo:
        en veces el cambio típico (la mediana de ese mismo cambio en las 100 velas anteriores) o en % del valor de partida."""
        n, back, how = self.n, int(p["n"]), p.get("how", "ends")
        out = np.zeros(n, dtype=bool)
        cur = value
        if how == "avg":
            cur = np.full(n, np.nan)
            if n >= back:
                cur[back - 1:] = np.lib.stride_tricks.sliding_window_view(value, back).mean(axis=1)
        if n <= back:
            return out
        ref = np.full(n, np.nan)
        ref[back:] = cur[:-back]
        with np.errstate(invalid="ignore"):
            change = cur - ref
            ok = np.isfinite(change)
            out = ok & (np.where(ok, change, 0.0) * d > 0)
            if how == "steps":
                step = np.zeros(n, dtype=bool)
                step[1:] = (value[1:] - value[:-1]) * d > 0
                out[back:] &= np.lib.stride_tricks.sliding_window_view(step[1:], back).all(axis=1)
            least = float(p.get("min") or 0)
            if least > 0 and p.get("unit") == "pct":
                out &= np.abs(np.where(ok, change, 0.0)) >= least / 100 * np.abs(np.where(np.isfinite(ref), ref, np.inf))
            elif least > 0:
                size = np.abs(change)
                for i in np.flatnonzero(out):
                    past = size[max(0, i - PAGE_BIG_BARS):i]
                    past = past[np.isfinite(past)]
                    typical = float(np.median(past)) if len(past) >= 20 else 0.0
                    out[i] = typical > 0 and size[i] >= least * typical
        return out

    def series_event(self, bid, p, d):
        """Un evento sobre una serie de un panel del gráfico, del lado d (1 hacia arriba, −1 hacia abajo):
        - pgrande: el valor, de ese signo, es `k` veces o más la mediana de |valor| en las PAGE_BIG_BARS velas anteriores;
        - pcruza: cruza el cero hacia ese lado;
        - pgiro: gira hacia ese lado: venía bajando y sube (pasó un mínimo), o venía subiendo y baja (pasó un máximo)."""
        n = self.n
        out = np.zeros(n, dtype=bool)
        value = self.num(p["s"])
        if value is None or n < 3:
            return out
        if d == 0 and bid != "pgrande":
            return self.series_event(bid, p, 1) | self.series_event(bid, p, -1)
        ok = np.isfinite(value)
        v = np.where(ok, value, 0.0)
        if p["s"] == VOLUME:
            v = v * np.sign(self.C - self.O)   # El volumen no tiene signo: su lado es el color de la vela
        if bid == "pcruza":
            both = ok[1:] & ok[:-1]
            out[1:] = both & ((v[:-1] <= 0) & (v[1:] > 0) if d > 0 else (v[:-1] >= 0) & (v[1:] < 0))
            return out
        if bid == "pgiro":
            both = ok[2:] & ok[1:-1] & ok[:-2]
            out[2:] = both & ((v[1:-1] < v[:-2]) & (v[2:] > v[1:-1]) if d > 0 else (v[1:-1] > v[:-2]) & (v[2:] < v[1:-1]))
            return out
        size = np.where(ok, np.abs(value), np.nan)
        window = int(p.get("w") or PAGE_BIG_BARS)
        for i in np.flatnonzero(ok & ((v * d > 0) if d else (np.abs(value) > 0))):
            past = size[max(0, i - window):i]
            past = past[np.isfinite(past)]
            if len(past) >= 20:
                typical = float(np.median(past))
                out[i] = typical > 0 and size[i] >= p["k"] * typical
        return out

    def line_event(self, bid, p, d):
        n, C = self.n, self.C
        out = np.zeros(n, dtype=bool)
        if n < 2:
            return out
        with np.errstate(invalid="ignore"):
            if bid == "xline":
                if p["a"] == p["b"]:
                    return out
                a, b = self.line(p["a"]), self.line(p["b"])
                ok = np.isfinite(a[:-1]) & np.isfinite(a[1:]) & np.isfinite(b[:-1]) & np.isfinite(b[1:])
                out[1:] = ok & ((a[:-1] <= b[:-1]) & (a[1:] > b[1:]) if d > 0 else (a[:-1] >= b[:-1]) & (a[1:] < b[1:]))
                return out
            line = self.line(p["line"])
            ok = np.isfinite(line[:-1]) & np.isfinite(line[1:])
            if bid == "cross":
                out[1:] = ok & ((C[:-1] <= line[:-1]) & (C[1:] > line[1:]) if d > 0 else (C[:-1] >= line[:-1]) & (C[1:] < line[1:]))
            else:
                out[1:] = ok & ((C[:-1] > line[:-1]) & (self.L[1:] <= line[1:]) & (C[1:] > line[1:]) if d > 0
                                else (C[:-1] < line[:-1]) & (self.H[1:] >= line[1:]) & (C[1:] < line[1:]))
        return out

    def truth(self, block, side):
        """Dónde se cumple un bloque para un trade de ese lado (1 largo, −1 corto). Un evento, en la vela con que se
        conoce."""
        bid, p = block["id"], block["p"]
        way = p.get("dir")
        d = 1 if way == "up" else -1 if way == "down" else 0 if way == "any" else side * (-1 if way == "contra" else 1)
        key = (bid, json.dumps(p, sort_keys=True), 0 if bid in NEUTRAL else d, self.page["stamp"] if uses_page(block) else "", self.session["stamp"])
        if key not in self._truth and len(self._truth) > 400:
            self._truth.clear()   # Con cada cambio de lo que manda la página queda una entrada
        if key not in self._truth:
            if block_flow(block) and self.flow()["state"] != "ready":
                return np.zeros(self.n, dtype=bool)   # Sin guardar: se calcula cuando llegue el order flow
            if bid in STATE_IDS:
                out = self.state(bid, p, d)
            elif bid in LINE_EVENT_IDS:
                out = self.line_event(bid, p, d)
            elif bid in ZONE_EVENT_IDS:
                out = np.zeros(self.n, dtype=bool)    # Salen de la capa de zona de cada estrategia: ver side()
            elif bid in ("pgrande", "pcruza", "pgiro"):
                out = self.series_event(bid, p, d)
            elif bid in PAGE_EVENT_IDS:
                # Una marca de un indicador del gráfico, en la vela con que se conoce
                out = np.zeros(self.n, dtype=bool)
                for t, way in self.page["marks"].get(p["s"], ()):
                    at = self.index.get(t)
                    if at is not None and (not way or way == d):
                        out[at] = True
            else:
                out = np.zeros(self.n, dtype=bool)
                for _, known, way in self.events_of(bid, p):
                    if bid in NEUTRAL or not way or way == d:
                        out[known] = True
            self._truth[key] = out
        return self._truth[key]

    # ---------- La estrategia de un lado
    def side(self, doc, sd):
        n = self.n
        zone = doc.get("zone") or clean_zone(None)
        layer = self.zone_layer(zone, sd)

        def occur(block):
            # Los eventos de zona hablan de las zonas de esta estrategia: sin zonas elegidas no ocurren
            if block["id"] == "ztoca":
                return layer["arrive"]
            if block["id"] == "zrech":
                return layer["reject"]
            return self.truth(block, sd)

        ctx = np.ones(n, dtype=bool)
        shown = {}
        for b in doc["ctx"]:
            t = occur(b)
            if b["conv"] == "recent":
                t = _any_back(t, 0, max(1, b["cn"]) - 1)
            shown[b["uid"]] = t
            ctx &= t
        # El contexto y la zona se miran, cada uno, al empezar el gatillo (mientras se junta el paso 1) o en la señal
        # (mientras se junta el último)
        last, zone_last = doc["ctxWhen"] == "last", zone["when"] == "last"
        everywhere = np.ones(n, dtype=bool)
        base = (everywhere if last else ctx) & (everywhere if zone_last else layer["ok"])
        fin = (ctx if last else everywhere) & (layer["ok"] if zone_last else everywhere)
        steps = []
        for gi, g in enumerate(doc["gat"]):
            if not g["blocks"]:
                continue
            occ = [occur(b) for b in g["blocks"]]
            for b, t in zip(g["blocks"], occ):
                shown[b["uid"]] = t
            during = [b["conv"] == "during" for b in g["blocks"]]
            state_only = all(during)
            need = 1 if g["mode"] == "any" else max(1, min(len(occ), g["min"])) if g["mode"] == "min" else len(occ)
            now, count = np.zeros(n, dtype=bool), np.zeros(n, dtype=np.int64)
            for t, is_state in zip(occ, during):
                if state_only or not is_state:
                    now |= t          # Un paso se completa en la vela de uno de sus eventos
                count += _any_back(t, 0, g["win"] - 1)
            steps.append({"gi": gi, "win": g["win"], "done": now & (count >= need), "stateOnly": state_only})
        signals, near = [], np.zeros(n, dtype=bool)
        if steps:
            first = steps[0]
            first["reach"] = first["done"] & _any_back(base, 0, first["win"] - 1)
            for prev, cur in zip(steps, steps[1:]):
                link = doc["links"][cur["gi"] - 1] if cur["gi"] - 1 < len(doc["links"]) else {"type": "after", "max": 5}
                start = 1 if link["type"] == "after" else 0
                reach = cur["done"] & _any_back(prev["reach"], start, link["max"])
                if link["type"] == "any":
                    reach |= prev["reach"] & _any_back(cur["done"], 0, link["max"])
                cur["reach"] = reach
            final = steps[-1]
            end = final["reach"] & _any_back(fin, 0, final["win"] - 1)
            final["end"] = end
            previous = -99
            for i in np.flatnonzero(end):
                i = int(i)
                # Un paso final de solo estados da señal cuando empieza a cumplirse, no en cada vela
                if i - previous > SIGNAL_GAP and not (final["stateOnly"] and i > 0 and end[i - 1]):
                    signals.append(i)
                    previous = i
            if len(steps) > 1:
                # A punto: el penúltimo paso ya se cumplió, sigue a tiempo y todavía no hubo señal
                link = doc["links"][final["gi"] - 1] if final["gi"] - 1 < len(doc["links"]) else {"type": "after", "max": 5}
                index = np.arange(n)
                last_reach = np.maximum.accumulate(np.where(steps[-2]["reach"], index, -10**9))
                is_signal = np.zeros(n, dtype=bool)
                is_signal[signals] = True
                last_signal = np.maximum.accumulate(np.where(is_signal, index, -10**9))
                near = (last_reach >= index - link["max"]) & (last_signal < last_reach) & ~is_signal
        return {"sd": sd, "ctx": ctx, "steps": steps, "signals": signals, "near": near, "shown": shown, "zone": layer}

    # ---------- Lo que hay en una vela
    def candidates(self, i):
        """Estados que se cumplen en la vela i y eventos de esa vela, con el lado que se ve (1 alcista, −1 bajista, 0 sin
        lado). Lo que se ofrece al elegir una vela."""
        states, events = [], []
        atr = self.atr[i] if self.atr[i] > 0 else 1.0
        close = self.C[i]
        for name in ORDER_LINES:
            level = self.line(name)[i]
            if not level == level:
                continue
            gap = (close - level) / atr
            way = 1 if gap >= 0 else -1
            states.append({"id": "side", "p": {"line": name}, "d": way})
            if abs(gap) >= 1:
                states.append({"id": "lejos", "p": {"line": name, "atr": min(8.0, int(abs(gap) * 2) / 2)}, "d": way,
                               "obs": {"atr": round(abs(float(gap)), 1)}})
        for way in (1, -1):
            if self.state("order", {}, way)[i]:
                states.append({"id": "order", "p": {}, "d": way})
        alligator = self.bw()["state"][i]
        if alligator:
            states.append({"id": "awake", "p": {}, "d": int(alligator)})
        elif self.state("sleep", {}, 1)[i]:
            states.append({"id": "sleep", "p": {}, "d": 0})
        for back in (24, 12):
            if i >= back:
                move = (close - self.C[i - back]) / atr
                if abs(move) >= 3:
                    states.append({"id": "tramo", "p": {"atr": float(int(abs(move))), "n": back}, "d": 1 if move > 0 else -1,
                                   "obs": {"atr": round(abs(float(move)), 1)}})
        if i >= 2:
            height = (self.H[i - 2:i + 1].max() - self.L[i - 2:i + 1].min()) / atr
            if height <= 1:
                states.append({"id": "pausa", "p": {"n": 3, "atr": 1.0}, "d": 0, "obs": {"atr": round(float(height), 1)}})
        meter = self.meter()[i]
        if meter == meter and abs(meter) >= 0.3:
            states.append({"id": "vpam", "p": {"u": 0.3}, "d": 1 if meter > 0 else -1, "obs": {"meter": round(float(meter), 2)}})
        flow = self.flow()
        if flow["state"] == "ready":
            delta, traded = flow["delta"][i], flow["vol"][i]
            if delta == delta and delta != 0:
                states.append({"id": "delta", "p": {}, "d": 1 if delta > 0 else -1,
                               "obs": {"share": round(float(abs(delta) / traded * 100), 1) if traded > 0 else None}})
            # La tabla de la vela: cada casilla con el umbral que hoy cumple justo, para ajustarlo en su bloque
            for name in ("of_dvol", "of_maxd", "of_mind"):
                value = flow["table"][name][i]
                if not (value == value and value != 0 and traded > 0):
                    continue
                share = abs(float(value)) if name == "of_dvol" else abs(float(value)) / traded * 100
                if share >= 1:
                    states.append({"id": "pumbral", "d": 0, "obs": {"share": round(share, 1)},
                                   "p": {"s": name, "op": "ge", "u": float(int(share)), "unit": "abs" if name == "of_dvol" else "vol",
                                         "dir": "up" if value > 0 else "down"}})
            run = self.cvd(20)[i]
            if run == run and run != 0:
                states.append({"id": "cvd", "p": {"n": 20}, "d": 1 if run > 0 else -1, "obs": {"share": round(float(abs(run) * 100), 1)}})
        for name in ORDER_LINES + ("teeth",):
            for way in (1, -1):
                for bid in ("cross", "bounce"):
                    if self.line_event(bid, {"line": name}, way)[i]:
                        events.append({"id": bid, "p": {"line": name}, "d": way, "late": 0})
        for a, b in (("e20", "e50"), ("e50", "e200"), ("lips", "teeth"), ("teeth", "jaw")):
            for way in (1, -1):
                if self.line_event("xline", {"a": a, "b": b}, way)[i]:
                    events.append({"id": "xline", "p": {"a": a, "b": b}, "d": way, "late": 0})
        # Lo del gráfico, con los ajustes de la sesión: sus líneas, sus series y sus marcas
        for name, series in self.page["lines"].items():
            level = series[i]
            if not level == level:
                continue
            gap = (close - level) / atr
            way = 1 if gap >= 0 else -1
            line = PAGE_LINE + name
            states.append({"id": "side", "p": {"line": line}, "d": way})
            if abs(gap) >= 1:
                states.append({"id": "lejos", "p": {"line": line, "atr": min(8.0, int(abs(gap) * 2) / 2)}, "d": way,
                               "obs": {"atr": round(abs(float(gap)), 1)}})
            for side in (1, -1):
                for bid in ("cross", "bounce"):
                    if self.line_event(bid, {"line": line}, side)[i]:
                        events.append({"id": bid, "p": {"line": line}, "d": side, "late": 0})
        for name, series in self.page["nums"].items():
            value = series[i]
            # «Sobre o bajo cero» solo dice algo en una serie que cambia de signo: el interés abierto siempre es positivo
            signed = bool(np.nanmin(series) < 0 < np.nanmax(series)) if np.isfinite(series).any() else False
            if signed and value == value and value != 0:
                states.append({"id": "ppos", "p": {"s": name}, "d": 1 if value > 0 else -1})
            if i >= 5 and value == value and series[i - 5] == series[i - 5] and value != series[i - 5]:
                states.append({"id": "psube", "p": {"s": name, "n": 5}, "d": 1 if value > series[i - 5] else -1})
            for bid in ("pgrande", "pcruza", "pgiro"):
                for side in (1, -1):
                    proto = {"s": name, **({"k": 3.0} if bid == "pgrande" else {})}
                    if self.series_event(bid, proto, side)[i]:
                        events.append({"id": bid, "p": proto, "d": side, "late": 0})
        # El volumen: una vela muy por encima de lo típico, y si viene creciendo o cayendo (el promedio de 5 contra las 5 de antes)
        vol = self.Vol
        if i >= 9:
            now, before = float(vol[i - 4:i + 1].mean()), float(vol[i - 9:i - 4].mean())
            if before > 0 and now != before:
                states.append({"id": "psube", "p": {"s": VOLUME, "n": 5, "how": "avg", "dir": "up" if now > before else "down"}, "d": 0,
                               "obs": {"pct": round((now / before - 1) * 100)}})
        past = vol[max(0, i - PAGE_BIG_BARS):i]
        if len(past) >= 20 and float(np.median(past)) > 0 and vol[i] >= 2 * float(np.median(past)):
            events.append({"id": "pgrande", "p": {"s": VOLUME, "k": 2.0, "dir": "any"}, "d": 0, "late": 0,
                           "obs": {"x": round(float(vol[i] / np.median(past)), 1)}})
        for name, rows in self.page["marks"].items():
            for t, way in rows:
                if t == self.bars[i]["t"]:
                    events.append({"id": "pmark", "p": {"s": name}, "d": way, "late": 0})
        seen = set()
        for code in EVENT_CODES:
            for at, known, way in self.events_of(code):
                if at != i:
                    continue
                way = 0 if code in NEUTRAL else way
                if (code, way, known) in seen:
                    continue  # Un elemento sin lado sale una vez por cada lado (la compresión): aquí cuenta una sola
                seen.add((code, way, known))
                p = {field: default for _, field, default, _, _ in EVENT_PARAMS.get(code, ())}
                events.append({"id": code, "p": p, "d": way, "late": known - at})
        return {"states": states, "events": events}


def bars_of(rows):
    """Velas del probador a partir de filas [hora, apertura, máximo, mínimo, cierre, volumen], en orden y sin repetir."""
    bars, last = [], None
    for row in rows or []:
        try:
            t, o, h, l, c, v = int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])
        except (TypeError, ValueError, IndexError):
            continue
        if last is not None and t <= last:
            continue
        if not (h >= l and h > 0 and l > 0):
            continue
        bars.append({"t": t, "o": o, "h": h, "l": l, "c": c, "vol": v, "delta": 0.0})
        last = t
    return bars[-MAX_BARS:]


def facts_for(symbol, tf, bars):
    """Los cálculos de esas velas: los mismos mientras no cambie ninguna."""
    key = (symbol, int(tf), rt._bars_key(bars))
    with _lock:
        found = _facts.get(key)
        if found is not None:
            _facts.move_to_end(key)
            return found
    found = Facts(symbol, tf, bars)
    with _lock:
        _facts[key] = found
        while len(_facts) > KEEP:
            _facts.popitem(last=False)
    return found


def _runs(mask, start):
    """Tramos seguidos en que vale una serie, desde la vela `start`: pares [primera, última], contadas desde `start`."""
    values = np.asarray(mask[start:], dtype=np.int8)
    if not len(values):
        return []
    edges = np.flatnonzero(np.diff(np.concatenate(([0], values, [0]))))
    return [[int(a), int(b) - 1] for a, b in zip(edges[::2], edges[1::2])]


def _at(mask, start):
    return [int(i) for i in np.flatnonzero(mask[start:])]


def _zone_answer(facts, doc, sides, start):
    """La capa de zona en la respuesta: dónde se cumple, cuántas veces llegó el precio y, por cada zona elegida, las
    franjas que le tocan en lo recorrido (para dibujarlas) y si sigue contando en la última vela."""
    zone, bars, n = doc["zone"], facts.bars, facts.n
    if not zone["picks"]:
        return {"has": False, "runs": [], "count": 0, "arrivals": 0, "picks": {}}
    ok, arrive = np.zeros(n, dtype=bool), np.zeros(n, dtype=bool)
    for s in sides:
        ok |= s["zone"]["ok"]
        arrive |= s["zone"]["arrive"]
    picks = {}
    for pick in zone["picks"]:
        found = {}
        for s in sides:
            for z in s["zone"]["picks"].get(pick["uid"], ()):
                if z["b"] >= start:
                    found[(z["a"], z["b"], z["lo0"], z["hi0"])] = z
        zones = [found[key] for key in sorted(found)]
        picks[pick["uid"]] = {"count": len(zones), "open": any(z["b"] == n - 1 for z in zones),
                              "bands": [[bars[z["a"]]["t"], bars[z["b"]]["t"] + facts.tf_ms, z["lo0"], z["hi0"], z["way"]]
                                        for z in zones[-MAX_BANDS:]]}
    return {"has": True, "runs": _runs(ok, start), "count": int(ok[start:].sum()), "arrivals": int(arrive[start:].sum()), "picks": picks}


def evaluate(symbol, tf, rows, doc=None, view=1000, pick=None, pick_price=None, offers=None, page=None, settings=None):
    """La estrategia en borrador sobre unas velas cerradas.

    rows: velas [hora, apertura, máximo, mínimo, cierre, volumen]. Las últimas `view` son lo recorrido: ahí se pinta y se
    cuenta; las anteriores solo calientan los indicadores. pick: hora de una vela de lo recorrido, para decir lo que hay
    en ella; pick_price: el precio del clic, para poner primero la zona que quedó debajo; offers: las zonas que solo
    conoce la página (los niveles de sus VP fijos), para ordenarlas con las demás en esa vela. Las posiciones de la
    respuesta se cuentan desde la primera vela de lo recorrido (`times`).

    Con bloques de order flow, o con una vela elegida, pide el order flow: si todavía se está detectando, la respuesta
    trae `pending` y esos bloques sin contar, y quien llama vuelve a preguntar."""
    began = time.perf_counter()
    tf = int(tf)
    if tf not in (1, 5, 15, 30, 60, 240, 1440):
        return {"success": False, "message": "Marco no válido"}
    bars = bars_of(rows)
    if len(bars) < 50:
        return {"success": False, "message": "Hacen falta al menos 50 velas cerradas"}
    doc = clean_doc(doc)
    facts = facts_for(symbol, tf, bars)
    n = facts.n
    start = max(0, n - max(1, min(MAX_VIEW, int(view or 1000))))
    seen = n - start
    with facts.lock:
        facts.page = clean_page(page, n)
        facts.session = clean_session(settings)
        facts.want_flow(start)
        flow = facts.flow(FLOW_WAIT) if uses_flow(doc) or pick is not None else None
        sides = [facts.side(doc, sd) for sd in SIDES[doc["side"]]]
        every = doc["ctx"] + [b for g in doc["gat"] for b in g["blocks"]]
        blocks = {}
        for block in every:
            mask = np.zeros(n, dtype=bool)
            for s in sides:
                if block["uid"] in s["shown"]:
                    mask |= s["shown"][block["uid"]]
            blocks[block["uid"]] = {"runs": _runs(mask, start), "count": int(mask[start:].sum())}
            if flow is not None and flow["state"] != "ready" and block_flow(block):
                blocks[block["uid"]]["pending"] = flow["state"]   # Sin order flow todavía (o sin almacén): no cuenta
        used_steps = [gi for gi, g in enumerate(doc["gat"]) if g["blocks"]]
        ctx_mask = np.zeros(n, dtype=bool)
        near = np.zeros(n, dtype=bool)
        step_done = [np.zeros(n, dtype=bool) for _ in used_steps]
        step_reach = [np.zeros(n, dtype=bool) for _ in used_steps]
        signals = []
        for s in sides:
            ctx_mask |= s["ctx"]
            near |= s["near"]
            for k, step in enumerate(s["steps"]):
                step_done[k] |= step["done"]
                step_reach[k] |= step["reach"]
            # Cada señal lleva el ATR de su vela y, con capa de zona, la zona que le toca: de ahí sale su stop (paso 1.3)
            signals += [{"i": i - start, "side": s["sd"], "atr": float(facts.atr[i]) if facts.atr[i] > 0 else None,
                         "zone": facts.zone_by(s["zone"], i) if s["zone"]["has"] else None}
                        for i in s["signals"] if i >= start]
        signals.sort(key=lambda x: (x["i"], -x["side"]))
        flow_out = None
        if flow is not None:
            flow_out = {key: flow[key] for key in ("state", "done", "total", "cover", "message") if key in flow}
        out = {"success": True, "tf": tf, "bars": n, "seen": seen, "times": [b["t"] for b in bars[start:]],
               "doc": doc, "blocks": blocks, "flow": flow_out, "pending": bool(flow_out and flow_out["state"] == "loading"),
               "zone": _zone_answer(facts, doc, sides, start),
               "context": {"has": bool(doc["ctx"]), "runs": _runs(ctx_mask, start) if doc["ctx"] else [],
                           "count": int(ctx_mask[start:].sum()) if doc["ctx"] else 0},
               "steps": [{"step": gi, "alone": _at(done & ~reach, start), "chained": _at(reach, start),
                          "done": int(done[start:].sum()), "reached": int(reach[start:].sum())}
                         for gi, done, reach in zip(used_steps, step_done, step_reach)],
               "signals": signals, "near": _runs(near, start)}
        lines = set()
        for b in doc["ctx"] + [b for g in doc["gat"] for b in g["blocks"]]:
            if b["id"] == "order":
                lines.update(ORDER_LINES)
            lines.update(b["p"][key] for key in ("line", "a", "b") if key in b["p"])
        out["lines"] = {name: [None if not x == x else float(x) for x in facts.line(name)[start:]] for name in sorted(lines)}
        if pick is not None:
            i = facts.index.get(int(pick))
            if i is None or i < start:
                out["candle"] = None
            else:
                bar = bars[i]
                atr = facts.atr[i] if facts.atr[i] > 0 else None
                candle = {"t": bar["t"], "i": i - start, "rangeAtr": None if atr is None else round(float((bar["h"] - bar["l"]) / atr), 1),
                          **facts.candidates(i), "zones": facts.zones_at(i, pick_price, clean_offers(offers)),
                          "flow": flow["state"] if flow else None, "diag": []}
                # Los eventos de zona de esta estrategia que ocurren en la vela, para sumarlos a un paso
                for bid, field in (("ztoca", "arrive"), ("zrech", "reject")):
                    if any(s["zone"]["has"] and s["zone"][field][i] for s in sides):
                        candle["events"].append({"id": bid, "p": {}, "d": 0, "late": 0})
                for s in sides:
                    candle["diag"].append({"side": s["sd"], "context": bool(s["ctx"][i]), "signal": i in s["signals"],
                                           "near": bool(s["near"][i]), "zone": bool(s["zone"]["ok"][i]) if s["zone"]["has"] else None,
                                           "steps": [{"step": step["gi"], "done": bool(step["done"][i]), "reached": bool(step["reach"][i])}
                                                     for step in s["steps"]]})
                out["candle"] = candle
    out["ms"] = int((time.perf_counter() - began) * 1000)
    return out


def catalog():
    """Los bloques que conoce el motor y los rangos de sus parámetros. Los nombres y los textos están en la página."""
    def fields(bid):
        out = {}
        for key, spec in BLOCK_PARAMS.get(bid, {}).items():
            out[key] = {"line": spec} if isinstance(spec, str) else {"options": spec} if isinstance(spec, list) else {"default": spec[0], "min": spec[1], "max": spec[2]}
        for _, key, default, low, high in EVENT_PARAMS.get(bid, ()):
            out[key] = {"default": default, "min": low, "max": high}
        return out
    return {"states": [{"id": bid, "sided": bid not in NEUTRAL, "p": fields(bid)} for bid in STATE_IDS],
            "events": [{"id": bid, "sided": bid not in NEUTRAL, "p": fields(bid)} for bid in LINE_EVENT_IDS + ZONE_EVENT_IDS + PAGE_EVENT_IDS + EVENT_CODES],
            # Lo que manda la página de sus indicadores: series, marcas y líneas ("p:<clave>")
            "page": {"states": list(PAGE_STATE_IDS), "events": list(PAGE_EVENT_IDS), "line": PAGE_LINE, "series": PAGE_SERIES},
            # Con trades reales: solo en las monedas con almacén y en estos marcos
            "flow": {"states": list(FLOW_STATE_IDS), "events": list(OF_CODES), "tfs": sorted(FLOW_BLOCK_DAYS)},
            "zones": {"kinds": list(ZONE_KINDS), "fixed": list(FIXED_KINDS), "user": list(USER_KINDS), "maxPicks": MAX_PICKS,
                      "near": {"default": ZONE_NEAR[0], "min": ZONE_NEAR[1], "max": ZONE_NEAR[2]}},
            "maxSteps": MAX_STEPS, "maxBlocks": MAX_BLOCKS, "maxBars": MAX_BARS, "maxView": MAX_VIEW}
