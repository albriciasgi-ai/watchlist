"""La cocina de estrategias de la simulación manual (26/11/2026, plan en docs/PLAN_CENTRAL_ESTRATEGIAS.md, etapa 1).

Qué hace:
- dice lo que se cumple en cada vela, con los detectores del probador de reglas (rule_tester.py) y sus valores de fábrica:
  un bloque de la cocina y un elemento del backtesting global son el mismo cálculo;
- arma la estrategia en borrador por capas: contexto (lo que ya venía pasando), zona (paso 1.2) y gatillo por pasos;
- responde dónde se cumple cada bloque, cada capa y la estrategia entera en las velas que recibe.

Sin futuro: solo recibe velas ya cerradas (quien llama corta en la hora simulada), cada evento cuenta en la vela con que
se conoce (`known`) y nada mira a la derecha de una vela. tests/test_kitchen.py lo comprueba: lo ya cerrado no cambia al
llegar velas nuevas.

Los nombres de los bloques y sus textos viven en la página (frontend/src/components/kitchen/kitchenCatalog.js). Aquí
están el cálculo y los rangos de cada parámetro; tests/test_kitchen.py vigila que las dos listas digan lo mismo."""
import json
import threading
import time
from collections import OrderedDict

import numpy as np

import liq_sweeps
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

# Estados: se cumplen o no en cada vela. Con lado (dir: favor o contra del trade), salvo los de NEUTRAL
STATE_IDS = ("side", "lejos", "order", "awake", "sleep", "tramo", "pausa", "vpam")
# Eventos de las líneas: ocurren en una vela
LINE_EVENT_IDS = ("cross", "bounce", "xline")
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
EVENT_CODES = tuple(code for codes in FAMILIES.values() for code in codes)
FAMILY_OF = {code: family for family, codes in FAMILIES.items() for code in codes}
NEUTRAL = ("sleep", "pausa", "CP")   # Sin lado

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
    "cross": {"line": "e20"},
    "bounce": {"line": "e50"},
    "xline": {"a": "e20", "b": "e50"},
}
ORDER_LINES = ("e20", "e50", "e200")

_lock = threading.Lock()
_facts = OrderedDict()


# ==================== El documento de la estrategia ====================

def _num(value, default, low, high):
    try:
        value = float(value)
    except (TypeError, ValueError):
        return default
    if value != value:
        return default
    return max(low, min(high, value))


def clean_line(value, default):
    """Una línea válida: e<periodo> (EMA de 2 a 400 velas) o una del Alligator."""
    text = str(value or "")
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
    if not is_state and bid not in LINE_EVENT_IDS and bid not in EVENT_CODES:
        return None
    given = raw.get("p") if isinstance(raw.get("p"), dict) else {}
    p = {}
    if bid in BLOCK_PARAMS:
        for key, spec in BLOCK_PARAMS[bid].items():
            if isinstance(spec, str):
                p[key] = clean_line(given.get(key), spec)
            else:
                value = _num(given.get(key), spec[0], spec[1], spec[2])
                p[key] = int(round(value)) if isinstance(spec[0], int) else value
    for _, key, default, low, high in EVENT_PARAMS.get(bid, ()):
        value = _num(given.get(key), default, low, high)
        p[key] = int(round(value)) if isinstance(default, int) else value
    if bid not in NEUTRAL:
        p["dir"] = "contra" if given.get("dir") == "contra" else "favor"
    conv = None
    if place == "ctx" and not is_state:
        conv = "recent"
    if place == "step" and is_state:
        conv = "during"
    return {"uid": str(raw.get("uid") or "")[:40], "id": bid, "p": p, "conv": conv,
            "cn": int(_num(raw.get("cn"), 5, 1, 50))}


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
            "ctx": ctx, "ctxWhen": "last" if raw.get("ctxWhen") == "last" else "first", "gat": gat, "links": links}


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
        self.lock = threading.RLock()
        self._lines, self._events, self._truth = {}, {}, {}
        self._bw = self._vpa = None

    # ---------- Series
    def bw(self):
        if self._bw is None:
            self._bw = williams.compute(self.ctx["H"], self.ctx["L"], self.ctx["C"], v=self.ctx["V"])
        return self._bw

    def meter(self):
        """El medidor del Lector VPA, con sus valores de fábrica (los del probador)."""
        if self._vpa is None:
            rule = self.rule(("QE",))
            cfg = rt._vpa_cfg(rule) if rule else None
            series = vpa.compute(self.ctx["T"], self.ctx["O"], self.ctx["H"], self.ctx["L"], self.ctx["C"], self.ctx["V"], self.tf, cfg)
            self._vpa = np.array([x if x is not None else np.nan for x in series["meter"]], dtype=float)
        return self._vpa

    def line(self, name):
        """Una EMA del cierre (la del probador: sin dato hasta tener su periodo) o una línea del Alligator."""
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
        extra = {}
        for rule_key, field, default, low, high in EVENT_PARAMS.get(code, ()):
            extra.setdefault(rule_key, {})[field] = (p or {}).get(field, default)
        # Los de la misma familia van juntos: sus otros códigos, con los valores de fábrica
        for other in FAMILIES[FAMILY_OF[code]]:
            for rule_key, field, default, _, _ in EVENT_PARAMS.get(other, ()):
                extra.setdefault(rule_key, {}).setdefault(field, default)
        return self.family(FAMILY_OF[code], extra or None)[code]

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
        d = side * (-1 if p.get("dir") == "contra" else 1)
        key = (bid, json.dumps(p, sort_keys=True), 0 if bid in NEUTRAL else d)
        if key not in self._truth:
            if bid in STATE_IDS:
                out = self.state(bid, p, d)
            elif bid in LINE_EVENT_IDS:
                out = self.line_event(bid, p, d)
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
        ctx = np.ones(n, dtype=bool)
        shown = {}
        for b in doc["ctx"]:
            t = self.truth(b, sd)
            if b["conv"] == "recent":
                t = _any_back(t, 0, max(1, b["cn"]) - 1)
            shown[b["uid"]] = t
            ctx &= t
        # El contexto se mira al empezar el gatillo (mientras se junta el paso 1) o en la señal (mientras se junta el último)
        last = doc["ctxWhen"] == "last"
        everywhere = np.ones(n, dtype=bool)
        base, fin = (everywhere, ctx) if last else (ctx, everywhere)
        steps = []
        for gi, g in enumerate(doc["gat"]):
            if not g["blocks"]:
                continue
            occ = [self.truth(b, sd) for b in g["blocks"]]
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
        return {"sd": sd, "ctx": ctx, "steps": steps, "signals": signals, "near": near, "shown": shown}

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
        for name in ORDER_LINES + ("teeth",):
            for way in (1, -1):
                for bid in ("cross", "bounce"):
                    if self.line_event(bid, {"line": name}, way)[i]:
                        events.append({"id": bid, "p": {"line": name}, "d": way, "late": 0})
        for a, b in (("e20", "e50"), ("e50", "e200"), ("lips", "teeth"), ("teeth", "jaw")):
            for way in (1, -1):
                if self.line_event("xline", {"a": a, "b": b}, way)[i]:
                    events.append({"id": "xline", "p": {"a": a, "b": b}, "d": way, "late": 0})
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


def evaluate(symbol, tf, rows, doc=None, view=1000, pick=None):
    """La estrategia en borrador sobre unas velas cerradas.

    rows: velas [hora, apertura, máximo, mínimo, cierre, volumen]. Las últimas `view` son lo recorrido: ahí se pinta y se
    cuenta; las anteriores solo calientan los indicadores. pick: hora de una vela de lo recorrido, para decir lo que hay
    en ella. Las posiciones de la respuesta se cuentan desde la primera vela de lo recorrido (`times`)."""
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
        sides = [facts.side(doc, sd) for sd in SIDES[doc["side"]]]
        blocks, uids = {}, [b["uid"] for b in doc["ctx"]] + [b["uid"] for g in doc["gat"] for b in g["blocks"]]
        for uid in uids:
            mask = np.zeros(n, dtype=bool)
            for s in sides:
                if uid in s["shown"]:
                    mask |= s["shown"][uid]
            blocks[uid] = {"runs": _runs(mask, start), "count": int(mask[start:].sum())}
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
            signals += [{"i": i - start, "side": s["sd"]} for i in s["signals"] if i >= start]
        signals.sort(key=lambda x: (x["i"], -x["side"]))
        out = {"success": True, "tf": tf, "bars": n, "seen": seen, "times": [b["t"] for b in bars[start:]],
               "doc": doc, "blocks": blocks,
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
                          **facts.candidates(i), "diag": []}
                for s in sides:
                    candle["diag"].append({"side": s["sd"], "context": bool(s["ctx"][i]), "signal": i in s["signals"],
                                           "near": bool(s["near"][i]),
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
            out[key] = {"line": spec} if isinstance(spec, str) else {"default": spec[0], "min": spec[1], "max": spec[2]}
        for _, key, default, low, high in EVENT_PARAMS.get(bid, ()):
            out[key] = {"default": default, "min": low, "max": high}
        return out
    return {"states": [{"id": bid, "sided": bid not in NEUTRAL, "p": fields(bid)} for bid in STATE_IDS],
            "events": [{"id": bid, "sided": bid not in NEUTRAL, "p": fields(bid)} for bid in LINE_EVENT_IDS + EVENT_CODES],
            "maxSteps": MAX_STEPS, "maxBlocks": MAX_BLOCKS, "maxBars": MAX_BARS, "maxView": MAX_VIEW}
