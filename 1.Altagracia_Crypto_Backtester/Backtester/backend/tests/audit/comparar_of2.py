"""
Protocolo (22/11/2026), etapa 6: condiciones necesarias (nivel B) de los elementos de order flow de prioridad 2, con las
celdas del almacén (compra y venta por minuto y precio) sumadas por vela y por nivel del step de la documentación.

Las reglas salen solo de la documentación, sin leer of_elements.py:
- Backtester/CLAUDE.md, sección "ELEMENTOS DE ORDER FLOW (Noviembre 2026)";
- research/orderflows_unlocked/CALIBRACION.md, LEEME.md y lectura_modulo1.md;
- la hoja "Elementos" de CHEQUEO_PRUEBAS_REGLAS.xlsx.

Qué se comprueba:
- Literales (VA, AP, SL, ZP, DD, IV, PW, VI, IR, RD, VD, TP, OP, RX): lo que la documentación dice de cada uno: el lado
  y su relación con el color, la vela, la zona en la grilla del step y sobre los niveles que corresponden, el filtro de
  volumen de los marcados así (VI, IR, RD, VD, TP, OP, RX) y cuándo se conoce (`known`).
- De umbral relativo (OG, EX, RS, PD, AD, SW, VL, SQ, DB, DV, XD, SM, BR, GR, RL): lo que se puede con la vela misma: el
  lado contra el color, la zona, que `value` pase `thr` en su sentido y, donde es fácil, que `value` sea la cuenta con
  las celdas (o con el almacén de flujo: Máx y Mín Δ exactos y órdenes agresivas). El umbral de 30 días no se rehace.
- Lo que la documentación no decide (empates del POC y del área de valor, los ceros y los bordes de los desequilibrios,
  qué mitad o tercio, qué ATR, con qué precio se elige el step, cómo se cuenta el USD de una orden) va como "lectura":
  se cuenta cada una por separado y se dice cuál sigue el motor. Seguir una lectura que la documentación permite no es
  un error; incumplir lo que dice claro, sí. Cada condición clara lleva "(alguna lectura)" cuando basta con que se
  cumpla en una de las lecturas.

Convenciones de la documentación: índice 0 = extremo donde empieza la vela (el mínimo en una verde, el máximo en una
roja); A = agresor a favor del color (compra en una verde, venta en una roja) y P = el lado contrario; un doji no marca
nada. Desequilibrio diagonal de 4x: la compra de un nivel contra la venta del de abajo, la venta contra la compra del
de arriba. Área de valor del 70% que crece de a un nivel desde el POC, sumando el vecino mayor. Filtro de volumen:
volumen de la vela ≥ 2 veces la mediana de las 20 anteriores.

El step es el de la documentación (0.0125% del precio en 15m, llevado a 1, 2 o 5 por potencia de diez y a múltiplo de
la celda). La documentación no dice con qué precio: se usa la apertura del día UTC y se cuenta aparte el que daría la
apertura de cada vela. `value`, `thr` y `t0` no vienen en detect_span: se piden a of_elements.detect() para cada día
revisado, con los mismos parámetros de la regla (solo se llama, no se lee su código), y se comprueba que da los mismos
eventos que la fase.

Uso (desde backend/):
    python -B tests/audit/comparar_of2.py BTCUSDT [--fase 1] [--dias 60] [--codigos VA,AP,...]
    python -B tests/audit/comparar_of2.py ARBUSDT --dias 0      (todos los días de la fase)
Escribe evidencia/elementos/comparar_of2_<MONEDA>_15_f<fase>.json con las cuentas por elemento y condición, y hasta
12 ejemplos de cada falla, y lo imprime.
"""
import argparse
import collections
import datetime as dt
import json
import math
import os
import random
import statistics
import sys
import time
from pathlib import Path

import numpy as np

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1]

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
FLOW_DIR = Path(os.environ.get("ORDERFLOW_FLOW", r"C:\Users\inven\OrderFlowData\flow"))
TF = 15
TF_MS = TF * 60_000
DAY = 86_400_000
FRACTION = 0.000125        # CLAUDE.md: la de footprint_store.STEP_BY_INTERVAL en 15m (10 USD con BTC en 80,000)
RATIO = 4.0                # desequilibrio diagonal de 4x (lectura_modulo1.md, convenciones)
VA_SHARE = 0.70            # área de valor del 70%, de a un nivel
VOL_MULT, VOL_BARS = 2.0, 20
EXTREME = 0.95             # Extreme Delta: delta en 95% o más de su máximo o mínimo exacto
MAX_EXAMPLES = 12

LITERAL = ("VA", "AP", "SL", "ZP", "DD", "IV", "PW", "VI", "IR", "RD", "VD", "TP", "OP", "RX")
RELATIVE = ("OG", "EX", "RS", "PD", "AD", "SW", "VL", "SQ", "DB", "DV", "XD", "SM", "BR", "GR", "RL")
VOL_FILTERED = {"VI", "IR", "RD", "VD", "TP", "OP", "RX"}
# Elementos cuyo lado es el color de la vela (CLAUDE.md, orientación; hoja "Elementos", columna Lado)
BY_COLOR = {"AP", "SL", "ZP", "DD", "IV", "PW", "VI", "IR", "RD", "VD", "TP", "RX",
            "EX", "RS", "PD", "AD", "SW", "VL", "SQ", "DB", "DV", "SM", "RL"}
ZERO = ("un 0 enfrente cuenta", "pide volumen enfrente")
EDGE = ("fuera de la vela vale 0", "fuera de la vela no hay")
ATRS = ("media de 14 con la vela", "media de 14 hasta la anterior", "Wilder de 14 con la vela", "Wilder de 14 hasta la anterior")
TOL = 1e-4                 # tolerancia relativa al comparar `value` con una cuenta


# ==================== AYUDAS ====================

def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def arrow(d):
    return "↑" if d > 0 else "↓" if d < 0 else "·"


def close(a, b, rel=TOL, eps=6e-7):
    """Iguales salvo redondeo: el motor da `value` y `thr` con 6 decimales (de ahí eps = 6e-7)."""
    if a is None or b is None:
        return False
    a, b = float(a), float(b)
    if math.isnan(a) or math.isnan(b):
        return False
    return bool(abs(a - b) <= max(eps, rel * max(abs(a), abs(b))))


def doc_step(price, cell):
    """1, 2 o 5 por potencia de diez, lo más cerca de la fracción del precio, y múltiplo de la celda."""
    target = price * FRACTION
    p = 10 ** math.floor(math.log10(target))
    options = [k * q for q in (p / 10, p, p * 10) for k in (1, 2, 5)]
    options = [x for x in options if x >= cell - 1e-12 and abs(x / cell - round(x / cell)) < 1e-6]
    return min(options, key=lambda x: abs(x - target)) if options else cell


def color_of(v):
    return 1 if v["c"] > v["o"] else -1 if v["c"] < v["o"] else 0


def bs(v, L):
    """(compra, venta) del nivel L; un nivel sin trades dentro de la vela vale (0, 0)."""
    return v["lv"].get(L, (0.0, 0.0))


def lvol(v, L):
    b, s = bs(v, L)
    return b + s


def agg(v, L, color):
    """A: el agresor a favor del color (compra en una verde, venta en una roja)."""
    b, s = bs(v, L)
    return b if color > 0 else s


def pas(v, L, color):
    """P: el lado contrario al color (venta en una verde, compra en una roja)."""
    b, s = bs(v, L)
    return s if color > 0 else b


def levels(v):
    return range(v["lmin"], v["lmax"] + 1)


def nlev(v):
    return v["lmax"] - v["lmin"] + 1


def from_start(v, color):
    """Niveles desde el extremo donde empieza la vela: el mínimo en una verde, el máximo en una roja."""
    return list(levels(v)) if color > 0 else list(reversed(levels(v)))


def idx_start(v, L, color):
    return L - v["lmin"] if color > 0 else v["lmax"] - L


def mean_level(v):
    """Volumen medio por nivel, con los niveles vacíos dentro de la vela."""
    return v["vol"] / nlev(v)


def mean_traded(v):
    """Volumen medio por nivel, solo los niveles con trades."""
    n = sum(1 for L in levels(v) if lvol(v, L) > 0)
    return v["vol"] / n if n else 0.0


def pocs(v):
    """Niveles con el mayor volumen (más de uno si empatan)."""
    m = max(lvol(v, L) for L in levels(v))
    return [L for L in levels(v) if lvol(v, L) == m]


def value_area(v, poc="bajo", tie="arriba", share=VA_SHARE):
    """
    Área de valor que crece de a un nivel desde el POC, sumando el vecino mayor, hasta el 70% del volumen. Devuelve el
    primer y el último nivel. `poc`: con dos POC empatados, el más bajo o el más alto; `tie`: con los dos vecinos
    iguales, primero el de arriba o el de abajo (la documentación no decide ninguno de los dos).
    """
    vols = [lvol(v, L) for L in levels(v)]
    total = sum(vols)
    top = max(vols)
    tied = [i for i, x in enumerate(vols) if x == top]
    p = tied[0] if poc == "bajo" else tied[-1]
    lo = hi = p
    acc = vols[p]
    while acc < share * total - 1e-12:
        up = vols[hi + 1] if hi + 1 < len(vols) else None
        dn = vols[lo - 1] if lo >= 1 else None
        if up is None and dn is None:
            break
        if dn is None or (up is not None and (up > dn or (up == dn and tie == "arriba"))):
            hi += 1
            acc += up
        else:
            lo -= 1
            acc += dn
    return v["lmin"] + lo, v["lmin"] + hi


def imbalance(v, L, kind, zero=ZERO[0], edge=EDGE[0], ratio=RATIO):
    """
    Desequilibrio diagonal en el nivel L: "compra" es la compra de L contra la venta de L-1; "venta", la venta de L contra
    la compra de L+1. `zero`: si un 0 enfrente cuenta; `edge`: si fuera de la vela vale 0 o no hay comparación.
    """
    b, s = bs(v, L)
    if kind == "compra":
        own, exists = b, L - 1 >= v["lmin"]
        other = bs(v, L - 1)[1] if exists else 0.0
    else:
        own, exists = s, L + 1 <= v["lmax"]
        other = bs(v, L + 1)[0] if exists else 0.0
    if not exists and edge == EDGE[1]:
        return False
    if other <= 0:
        return own > 0 and zero == ZERO[0]
    return own >= ratio * other


def grid_zone(e, step):
    """(primer nivel, último nivel + 1) si lo y hi caen en la grilla del step; si no, None."""
    a, b = e["lo"] / step, e["hi"] / step
    ra, rb = round(a), round(b)
    if abs(a - ra) < 1e-6 and abs(b - rb) < 1e-6 and rb > ra:
        return int(ra), int(rb)
    return None


def inside(v, z):
    return z is not None and v["lmin"] <= z[0] and z[1] - 1 <= v["lmax"]


def start_zone(v, color, k):
    """Zona de las k celdas del extremo de inicio, como (primer nivel, último + 1)."""
    st = from_start(v, color)[:k]
    return (min(st), max(st) + 1) if st else None


def raw_zone(e, lo, hi):
    return close(e["lo"], lo, rel=1e-9, eps=1e-9) and close(e["hi"], hi, rel=1e-9, eps=1e-9)


def grid_edges(lo, hi, step):
    """Borde bajo del nivel del precio lo y borde alto del nivel del precio hi."""
    return math.floor(lo / step + 1e-9) * step, (math.floor(hi / step + 1e-9) + 1) * step


def cells(v, Ls, step, color=None):
    """Texto con compra|venta de los niveles pedidos (precio del borde bajo)."""
    out = []
    for L in Ls:
        b, s = bs(v, L)
        out.append(f"{L * step:g}: {b:g}|{s:g}")
    return "; ".join(out)


def vela_txt(v):
    return f"o {v['o']:g} h {v['h']:g} l {v['l']:g} c {v['c']:g} Δ {v['delta']:.6g} vol {v['vol']:.6g}"


class Ctx:
    """Velas de la ventana por su hora, el step del día, el flujo exacto, las órdenes y los eventos del motor."""

    def __init__(self, candles, step, flow=None, orders=None, events=None, has_orders=True, tp_levels=None, typ_vol=None):
        self.c = candles
        self.order = sorted(candles)
        self.pos = {t: i for i, t in enumerate(self.order)}
        self.step = step
        self.flow = flow or {}
        self.orders = orders or {}
        self.events = events if events is not None else collections.Counter()  # {(código, t): eventos del motor}
        self.has_orders = has_orders
        self.tp_levels = tp_levels or {}  # {t: niveles de los TP del motor en esa vela}
        self.typ_vol = typ_vol  # mediana del volumen de las velas de los 30 días anteriores al día
        self._atr = self._atr_series()

    def get(self, t):
        return self.c.get(t)

    def prev(self, t, k):
        """Las k velas anteriores que hay en la ventana (de la más vieja a la más nueva), o None si no alcanzan."""
        i = self.pos.get(t)
        if i is None or i < k:
            return None
        return [self.c[x] for x in self.order[i - k:i]]

    def next_of(self, t):
        i = self.pos.get(t)
        if i is None or i + 1 >= len(self.order):
            return None
        return self.c[self.order[i + 1]]

    def vol_ratio(self, t, n=VOL_BARS):
        prev = self.prev(t, n)
        if prev is None:
            return None
        med = statistics.median(p["vol"] for p in prev)
        return self.c[t]["vol"] / med if med > 0 else None

    def _atr_series(self):
        trs, sma, wil = [], [], []
        prev_c = None
        for t in self.order:
            v = self.c[t]
            tr = v["h"] - v["l"] if prev_c is None else max(v["h"] - v["l"], abs(v["h"] - prev_c), abs(v["l"] - prev_c))
            trs.append(tr)
            prev_c = v["c"]
            sma.append(sum(trs[-14:]) / 14 if len(trs) >= 14 else None)
            if len(trs) < 14:
                wil.append(None)
            elif len(trs) == 14:
                wil.append(sum(trs) / 14)
            else:
                wil.append((wil[-1] * 13 + tr) / 14)
        return {"sma": sma, "wilder": wil}

    def atr(self, t, kind):
        i = self.pos.get(t)
        if i is None:
            return None
        serie = self._atr["sma" if kind.startswith("media") else "wilder"]
        j = i if "con la vela" in kind else i - 1
        return serie[j] if j >= 0 else None


# ==================== ELEMENTOS ====================
# Cada uno devuelve (condiciones, lecturas, texto): las condiciones son lo que la documentación dice claro (una que no se
# cumple es una falla); las lecturas, lo que no decide, o datos para entender. None = no se pudo comprobar.

def _side_color(e, v, cond):
    color = color_of(v)
    cond["no es doji"] = color != 0
    cond["lado = color de la vela"] = color != 0 and e["dir"] == color
    return color


def _vol_filter(e, v, ctx, cond, lect):
    r = ctx.vol_ratio(e["t"])
    cond["volumen ≥ 2 veces la mediana de las 20 anteriores"] = None if r is None else r >= VOL_MULT - 1e-12
    lect["value = volumen ÷ mediana de las 20 anteriores"] = None if r is None else close(e.get("value"), r)
    return r


def chk_VA(e, v, ctx):
    cond, lect, show = {}, {}, []
    step = ctx.step
    z = grid_zone(e, step)
    cond["zona en la grilla y dentro de la vela"] = inside(v, z)
    hit = False
    for poc in ("bajo", "alto"):
        for tie in ("arriba", "abajo"):
            a, b = value_area(v, poc, tie)
            ok = z == (a, b + 1)
            lect[f"zona = área de valor (POC empatado: el más {poc}; vecinos empatados: primero {tie})"] = ok
            hit |= ok
    cond["zona = área de valor del 70% de la vela, de a un nivel (alguna lectura de empates)"] = hit
    a, b = value_area(v)
    show.append(f"área {a * step:g}–{(b + 1) * step:g}")
    nxt = ctx.get(e["t"] + TF_MS)
    cond["la vela siguiente está en el almacén"] = nxt is not None
    if nxt is not None and z is not None:
        up, down = nxt["lmin"] >= z[1], nxt["lmax"] < z[0]
        cond["la siguiente no entra en el área, del lado del evento (por niveles)"] = (e["dir"] > 0 and up) or (e["dir"] < 0 and down)
        lect["por precio: mínimo de la siguiente > VAH, o máximo < VAL"] = (e["dir"] > 0 and nxt["l"] > e["hi"]) or (e["dir"] < 0 and nxt["h"] < e["lo"])
        # El borde exacto: un máximo justo en el VAL es un trade dentro del nivel más bajo del área
        lect["bajista con el máximo de la siguiente justo en el VAL (borde bajo del área)"] = e["dir"] < 0 and close(nxt["h"], e["lo"], rel=1e-12, eps=1e-9)
        lect["alcista con el mínimo de la siguiente justo en el VAH (borde alto del área)"] = e["dir"] > 0 and close(nxt["l"], e["hi"], rel=1e-12, eps=1e-9)
        show.append(f"siguiente {nxt['l']:g}–{nxt['h']:g}")
        if z[0] <= nxt["lmax"] <= z[1] - 1 or z[0] <= nxt["lmin"] <= z[1] - 1:
            inside_lv = [L for L in range(max(z[0], nxt["lmin"]), min(z[1] - 1, nxt["lmax"]) + 1) if lvol(nxt, L) > 0]
            show.append("celdas de la siguiente dentro del área: " + cells(nxt, inside_lv[:3], step))
    lect["vela doji (el lado no es el color)"] = color_of(v) == 0
    return cond, lect, " ".join(show)


def chk_AP(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    z = grid_zone(e, step)
    cond["zona = una celda de la grilla dentro de la vela"] = inside(v, z) and z[1] - z[0] == 1
    prev = ctx.get(e["t"] - TF_MS)
    cond["la vela anterior está en el almacén"] = prev is not None
    if z is None or prev is None:
        return cond, lect, ""
    L = z[0]
    pv, pp = pocs(v), pocs(prev)
    cond["zona = POC de la vela (alguna lectura de empates)"] = L in pv
    cond["el mismo nivel es POC de la anterior (alguna lectura de empates)"] = L in pp
    lect["POC sin empates en las dos velas"] = len(pv) == 1 and len(pp) == 1
    lect["con empates, el POC más bajo de cada una"] = L == min(pv) and L == min(pp)
    lect["con empates, el POC más alto de cada una"] = L == max(pv) and L == max(pp)
    lect["las dos del mismo color"] = color_of(prev) == color
    return cond, lect, f"POC {[x * step for x in pv]} anterior {[x * step for x in pp]}"


def chk_SL(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    z = grid_zone(e, step)
    cond["zona = una celda de la grilla dentro de la vela"] = inside(v, z) and z[1] - z[0] == 1
    prev = ctx.get(e["t"] - TF_MS)
    cond["la vela anterior está en el almacén"] = prev is not None
    if z is None or prev is None:
        return cond, lect, ""
    L = z[0]
    pv, pp = pocs(v), pocs(prev)
    cond["las dos velas del mismo color"] = color != 0 and color_of(prev) == color
    cond["zona = POC de la vela (alguna lectura de empates)"] = L in pv
    back = (L < max(pp)) if color > 0 else (L > min(pp)) if color < 0 else False
    cond["POC hacia atrás: más bajo que el anterior en dos verdes, más alto en dos rojas (alguna lectura de empates)"] = back
    lect["POC sin empates en las dos velas"] = len(pv) == 1 and len(pp) == 1
    lect["hacia atrás contra todos los POC empatados de la anterior"] = (L < min(pp)) if color > 0 else (L > max(pp)) if color < 0 else False
    return cond, lect, f"POC {[x * step for x in pv]} anterior {[x * step for x in pp]} colores {color_of(prev):+d} {color:+d}"


def chk_ZP(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    if color == 0:
        return cond, lect, ""
    st = from_start(v, color)[:2]
    zeros = [L for L in st if pas(v, L, color) == 0]
    cond["un 0 del lado pasivo en una de las dos celdas del inicio"] = bool(zeros)
    lect["ese 0 con el agresor > 0 en su celda"] = any(agg(v, L, color) > 0 for L in zeros)
    z = grid_zone(e, step)
    two = z == start_zone(v, color, 2)
    one = z is not None and z[1] - z[0] == 1 and z[0] in zeros
    lect["zona = las dos celdas del inicio"] = two
    lect["zona = la celda del 0"] = one
    cond["zona sobre las celdas del inicio (alguna lectura)"] = two or one
    lect["vela de un solo nivel"] = nlev(v) == 1
    return cond, lect, cells(v, st, step)


def chk_DD(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    if color == 0:
        return cond, lect, ""
    cond["delta de la vela del signo de su color"] = v["delta"] * color > 0
    z = grid_zone(e, step)
    cond["zona = las dos celdas del extremo de inicio"] = z == start_zone(v, color, 2)
    p5 = ctx.prev(e["t"], 5)
    cond["las 5 velas anteriores están en la ventana"] = p5 is not None
    if p5 is None:
        return cond, lect, ""
    x = v["l"] if color > 0 else v["h"]
    ext = [p["l"] if color > 0 else p["h"] for p in p5]

    def beyond(a, b, strict):
        return (a < b if strict else a <= b) if color > 0 else (a > b if strict else a >= b)

    m4, m5 = (min if color > 0 else max)(ext[-4:]), (min if color > 0 else max)(ext)
    reads = {
        "extremo de 5 velas con ella (más allá de las 4 anteriores, estricto)": beyond(x, m4, True),
        "extremo de 5 velas con ella (igualar cuenta)": beyond(x, m4, False),
        "más allá de las 5 anteriores (estricto)": beyond(x, m5, True),
        "más allá de las 5 anteriores (igualar cuenta)": beyond(x, m5, False),
    }
    lect.update(reads)
    cond["nuevo extremo de 5 velas del lado del color (alguna lectura)"] = any(reads.values())
    gap = any(b["t"] - a["t"] != TF_MS for a, b in zip(p5 + [v], (p5 + [v])[1:]))
    lect["hueco del almacén entre las 5 anteriores"] = gap
    return cond, lect, f"extremo {x:g} anteriores {ext}"


def chk_IV(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    z = grid_zone(e, step)
    cond["zona en la grilla y dentro de la vela"] = inside(v, z)
    if color == 0 or z is None:
        return cond, lect, ""
    Z = list(range(*z))
    cond["zona de dos celdas seguidas o más"] = len(Z) >= 2
    lect["zona de exactamente dos celdas"] = len(Z) == 2
    kind = "venta" if color > 0 else "compra"  # contrarios al color
    any_ok = False
    for zero in ZERO:
        for edge in EDGE:
            ok = all(imbalance(v, L, kind, zero, edge) for L in Z)
            lect[f"desequilibrios contrarios 4x en sus celdas ({zero}; {edge})"] = ok
            any_ok |= ok
    cond["las celdas de la zona son desequilibrios contrarios 4x seguidos (alguna lectura)"] = any_ok
    n = nlev(v)
    mid = (v["l"] + v["h"]) / 2
    halves = {
        "mitad lejana: índice desde el inicio ≥ n/2": all(idx_start(v, L, color) >= n / 2 for L in Z),
        "mitad lejana: índice ≥ (n-1)/2 (con el nivel del medio)": all(idx_start(v, L, color) >= (n - 1) / 2 for L in Z),
        "mitad lejana por precio: la celda pasa el punto medio de la vela": all((L * step >= mid) if color > 0 else ((L + 1) * step <= mid) for L in Z),
        "mitad lejana por precio: el centro de la celda pasa el punto medio": all(((L + 0.5) * step >= mid) if color > 0 else ((L + 0.5) * step <= mid) for L in Z),
    }
    lect.update(halves)
    cond["en la mitad lejana de la vela (alguna lectura)"] = any(halves.values())
    return cond, lect, f"niveles {n} " + cells(v, sorted(set(Z) | {Z[0] - 1, Z[-1] + 1}), step)


def chk_PW(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    t = e["t"]
    a, b = ctx.get(t - 2 * TF_MS), ctx.get(t - TF_MS)
    cond["las tres velas seguidas están en el almacén"] = a is not None and b is not None
    cond["t0 = la primera de las tres"] = e.get("t0") == t - 2 * TF_MS
    if a is None or b is None:
        return cond, lect, ""
    d = e["dir"]
    cols = (color_of(a), color_of(b), color_of(v))
    cond["colores: contraria, a favor y a favor"] = cols == (-d, d, d)
    cond["lado = color de la última"] = cols[2] != 0 and d == cols[2]
    pa, pb, pc = pocs(a), pocs(b), pocs(v)

    def wave(x, y, w):
        return (y < x and w > x) if d > 0 else (y > x and w < x)

    cond["POC de la 2.ª al otro lado del de la 1.ª y el de la 3.ª más allá de él (alguna lectura de empates)"] = any(
        wave(x, y, w) for x in pa for y in pb for w in pc)
    lect["POC sin empates en las tres"] = len(pa) == len(pb) == len(pc) == 1
    lo, hi = min(a["l"], b["l"], v["l"]), max(a["h"], b["h"], v["h"])
    r1, r2 = raw_zone(e, lo, hi), raw_zone(e, *grid_edges(lo, hi, step))
    lect["zona = mínimo y máximo de las tres (precios)"] = r1
    lect["zona = mínimo y máximo de las tres (bordes de la grilla)"] = r2
    cond["zona = mínimo y máximo de las tres velas (alguna lectura)"] = r1 or r2
    return cond, lect, f"colores {cols} POC {[x * step for x in pa]} {[x * step for x in pb]} {[x * step for x in pc]}"


def chk_VI(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    r = _vol_filter(e, v, ctx, cond, lect)
    cond["t0 = la vela"] = e.get("t0") == e["t"]
    r1, r2 = raw_zone(e, v["l"], v["h"]), raw_zone(e, *grid_edges(v["l"], v["h"], step))
    lect["zona = la vela (precios)"] = r1
    lect["zona = la vela (bordes de la grilla)"] = r2
    cond["zona = la vela (alguna lectura)"] = r1 or r2
    if color == 0:
        return cond, lect, ""
    kind = "compra" if color > 0 else "venta"
    any_ok, counts = False, {}
    for zero in ZERO:
        for edge in EDGE:
            k = sum(imbalance(v, L, kind, zero, edge) for L in levels(v))
            counts[(zero, edge)] = k
            lect[f"3 o más desequilibrios a favor ({zero}; {edge})"] = k >= 3
            any_ok |= k >= 3
    cond["3 o más desequilibrios 4x a favor del color, seguidos o no (alguna lectura)"] = any_ok
    val = e.get("value")
    for zero in ZERO:
        lect[f"value = cuenta de desequilibrios a favor ({zero}; {EDGE[0]})"] = close(val, float(counts[(zero, EDGE[0])]))
    lo_k, hi_k = counts[(ZERO[1], EDGE[0])], counts[(ZERO[0], EDGE[0])]
    lect["value entre la cuenta que pide volumen enfrente y la que acepta el 0"] = val is not None and lo_k <= val <= hi_k
    return cond, lect, f"desequilibrios a favor {list(counts.values())} value {val} volumen {r}"


def chk_IR(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    r = _vol_filter(e, v, ctx, cond, lect)
    if color == 0:
        return cond, lect, ""
    st = from_start(v, color)[:2]
    z = grid_zone(e, step)
    cond["zona = las dos celdas del extremo de inicio"] = z == start_zone(v, color, 2)
    kind = "venta" if color > 0 else "compra"  # contrario al color
    any_ok = False
    for zero in ZERO:
        for edge in EDGE:
            ok = any(imbalance(v, L, kind, zero, edge) for L in st)
            lect[f"desequilibrio contrario en una de las dos del inicio ({zero}; {edge})"] = ok
            any_ok |= ok
    cond["desequilibrio contrario 4x en uno de los dos precios del inicio (alguna lectura)"] = any_ok
    near = sorted(set(st) | {min(st) - 1, max(st) + 1})
    return cond, lect, cells(v, near, step) + f" volumen {r}"


def chk_RD(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    r = _vol_filter(e, v, ctx, cond, lect)
    prev = ctx.get(e["t"] - TF_MS)
    cond["la vela anterior está en el almacén"] = prev is not None
    z = grid_zone(e, step)
    cond["zona en la grilla y dentro de la vela"] = inside(v, z)
    if prev is None or z is None or color == 0:
        return cond, lect, ""
    cond["las dos velas del mismo color"] = color_of(prev) == color
    rp_ = ctx.vol_ratio(prev["t"])
    lect["filtro de volumen también en la primera"] = None if rp_ is None else rp_ >= VOL_MULT
    Z = list(range(*z))
    favor = "compra" if color > 0 else "venta"
    lo_both, hi_both = max(v["lmin"], prev["lmin"]), min(v["lmax"], prev["lmax"])
    some = False
    for zero in ZERO:
        for edge in EDGE:
            def shared(L, kind):
                return imbalance(v, L, kind, zero, edge) and imbalance(prev, L, kind, zero, edge)
            S = [L for L in range(lo_both, hi_both + 1) if shared(L, favor)]
            tag = f"{zero}; {edge}"
            lect[f"zona = de la primera a la última celda compartida a favor ({tag})"] = bool(S) and z == (min(S), max(S) + 1)
            lect[f"todas las celdas de la zona comparten a favor ({tag})"] = all(shared(L, favor) for L in Z)
            lect[f"los dos bordes de la zona comparten a favor ({tag})"] = shared(Z[0], favor) and shared(Z[-1], favor)
            any_fav = any(shared(L, favor) for L in Z)
            any_side = any(shared(L, "compra") or shared(L, "venta") for L in Z)
            lect[f"alguna celda de la zona comparte a favor ({tag})"] = any_fav
            lect[f"alguna celda de la zona comparte de cualquier lado ({tag})"] = any_side
            some |= any_side
    cond["algún precio de la zona con desequilibrio del mismo lado en las dos velas (alguna lectura)"] = some
    return cond, lect, f"zona {len(Z)} niveles; vela: {cells(v, Z[:4], step)} | anterior: {cells(prev, Z[:4], step)} volumen {r}"


def chk_VD(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    r = _vol_filter(e, v, ctx, cond, lect)
    if color == 0:
        return cond, lect, ""
    st = from_start(v, color)[:3]
    cond["la vela tiene 3 niveles o más"] = len(st) == 3
    z = grid_zone(e, step)
    cond["zona = las tres celdas del extremo de inicio"] = z == start_zone(v, color, 3)
    if len(st) < 3:
        return cond, lect, ""
    P = [pas(v, L, color) for L in st]
    cond["pasivo estrictamente creciente del 1.º al 3.º precio desde el inicio"] = P[0] < P[1] < P[2]
    return cond, lect, f"pasivo desde el inicio {P} volumen {r}"


def chk_TP(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    r = _vol_filter(e, v, ctx, cond, lect)
    z = grid_zone(e, step)
    cond["zona = una celda de la grilla dentro de la vela"] = inside(v, z) and z[1] - z[0] == 1
    if color == 0 or z is None:
        return cond, lect, ""
    L = z[0]
    cond["nivel interior: ni el mínimo ni el máximo"] = v["lmin"] < L < v["lmax"]
    cond["lado pasivo = 0 en el nivel"] = pas(v, L, color) == 0
    lect["con el agresor > 0 en el nivel"] = agg(v, L, color) > 0
    k = ctx.events.get(("TP", e["t"]), 0)
    cond["hasta 3 por vela"] = k <= 3
    thin = [x for x in from_start(v, color)[1:-1] if pas(v, x, color) == 0 and agg(v, x, color) > 0]
    lect["la vela tiene más de 3 niveles finos (0 en el pasivo y agresor > 0)"] = len(thin) > 3
    if len(thin) > 3:
        chosen = set(ctx.tp_levels.get(e["t"], ()))
        if chosen:
            lect["con más de 3: elige los 3 más cerca del inicio"] = chosen == set(thin[:3])
            lect["con más de 3: elige los 3 más cerca del final"] = chosen == set(thin[-3:])
            big = sorted(thin, key=lambda x: -agg(v, x, color))[:3]
            lect["con más de 3: elige los 3 de más agresor"] = chosen == set(big)
    return cond, lect, cells(v, [L - 1, L, L + 1], step) + f" eventos TP en la vela {k} volumen {r}"


def chk_OP(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    r = _vol_filter(e, v, ctx, cond, lect)
    z = grid_zone(e, step)
    cond["zona = una celda de la grilla dentro de la vela"] = inside(v, z) and z[1] - z[0] == 1
    p5 = ctx.prev(e["t"], 5)
    cond["las 5 velas anteriores están en la ventana"] = p5 is not None
    lect["vela doji (el lado no es el color)"] = color_of(v) == 0
    lect["lado = color de la vela"] = e["dir"] == color_of(v)
    if z is None or p5 is None:
        return cond, lect, ""
    L = z[0]
    cond["zona = POC de la vela (alguna lectura de empates)"] = L in pocs(v)
    hi5, lo5 = max(p["h"] for p in p5), min(p["l"] for p in p5)
    if e["dir"] > 0:
        dists = {"la celda entera": L * step - hi5, "el centro de la celda": (L + 0.5) * step - hi5, "el borde lejano": (L + 1) * step - hi5}
    else:
        dists = {"la celda entera": lo5 - (L + 1) * step, "el centro de la celda": lo5 - (L + 0.5) * step, "el borde lejano": lo5 - L * step}
    for k, d in dists.items():
        lect[f"fuera del rango de las 5 anteriores, del lado del evento ({k})"] = d > 0
    # El borde lejano solo como dato: con él pasaría un POC cuyo nivel contiene el máximo (o el mínimo) anterior
    cond["POC fuera del rango de las 5 anteriores, del lado del evento (la celda entera o su centro)"] = max(
        dists["la celda entera"], dists["el centro de la celda"]) > 0
    any_atr, ratios = False, {}
    for kind in ATRS:
        atr = ctx.atr(e["t"], kind)
        if not atr:
            continue
        for k in ("la celda entera", "el centro de la celda"):
            ok = dists[k] >= 0.25 * atr - 1e-9
            lect[f"a 0.25 ATR o más ({k}; {kind})"] = ok
            any_atr |= ok
        ratios[kind] = round(dists["la celda entera"] / atr, 3)
    cond["a 0.25 ATR o más del rango (alguna lectura de ATR y del precio del POC)"] = any_atr
    return cond, lect, f"POC {L * step:g} rango de las 5 {lo5:g}–{hi5:g} distancia en ATR {ratios} volumen {r}"


def chk_RX(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    r = _vol_filter(e, v, ctx, cond, lect)
    if color == 0:
        return cond, lect, ""
    st = from_start(v, color)[:2]
    z = grid_zone(e, step)
    cond["zona = las dos celdas del extremo de inicio"] = z == start_zone(v, color, 2)
    cond["la vela tiene 2 niveles o más"] = len(st) == 2
    if len(st) < 2:
        return cond, lect, ""
    p0, p1 = pas(v, st[0], color), pas(v, st[1], color)
    pos = p0 > 0 and (p1 / p0 < 0.70 or p1 / p0 > 30)
    inf = p0 == 0 and p1 > 0
    lect["con el extremo > 0: 2.º ÷ extremo < 0.70 o > 30"] = pos
    lect["extremo en 0 y 2.º > 0 cuenta como > 30"] = inf
    lect["extremo y 2.º en 0"] = p0 == 0 and p1 == 0
    cond["2.º precio ÷ extremo, del lado pasivo, < 0.70 o > 30 (alguna lectura de los ceros)"] = pos or inf
    ratio = p1 / p0 if p0 > 0 else None
    return cond, lect, f"pasivo extremo {p0:g} 2.º {p1:g} cociente {ratio} volumen {r}"


def _value_thr(e, cond, sense):
    """
    `value` contra `thr`: "≥" (pasa si lo supera) o "≤" (casi en cero). Un elemento de umbral relativo sin `thr` se marcó
    sin su umbral: la documentación lo pide siempre (sin historia, "warming" y solo los literales).
    """
    val, thr = e.get("value"), e.get("thr")
    cond["trae su umbral relativo (value y thr)"] = val is not None and thr is not None
    if val is None or thr is None:
        cond[f"value {sense} thr"] = None
        return
    cond[f"value {sense} thr"] = val >= thr - 1e-12 if sense == "≥" else val <= thr + 1e-12


def chk_OG(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    prev = ctx.get(e["t"] - TF_MS)
    cond["la vela anterior está en el almacén"] = prev is not None
    lect["t0 = la vela anterior (el rectángulo cubre las dos velas)"] = e.get("t0") == e["t"] - TF_MS
    _value_thr(e, cond, "≥")
    z = grid_zone(e, step)
    cond["zona en la grilla"] = z is not None
    if prev is None or z is None:
        return cond, lect, ""
    hit = False
    for poc in ("bajo", "alto"):
        for tie in ("arriba", "abajo"):
            pl, ph = value_area(prev, poc, tie)
            cl, ch = value_area(v, poc, tie)
            gap = (ph + 1, cl) if e["dir"] > 0 else (ch + 1, pl)
            ok = gap[1] > gap[0] and z == gap
            lect[f"zona = hueco entre las dos áreas (POC empatado: el más {poc}; vecinos: primero {tie})"] = ok
            hit |= ok
    cond["áreas de valor sin solape, la de la vela del lado del evento, y la zona es el hueco (alguna lectura de empates)"] = hit
    val = e.get("value")
    ratios = {}
    if val:
        for kind in ATRS:
            atr = ctx.atr(e["t"], kind)
            if atr:
                lect[f"value = hueco ÷ ATR ({kind})"] = close(val, (e["hi"] - e["lo"]) / atr, rel=0.01)
                ratios[kind] = round((e["hi"] - e["lo"]) / atr, 4)
    pl, ph = value_area(prev)
    cl, ch = value_area(v)
    return cond, lect, f"área anterior {pl * step:g}–{(ph + 1) * step:g} área {cl * step:g}–{(ch + 1) * step:g} value {val} hueco/ATR {ratios}"


def chk_EX(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≤")
    if color == 0:
        return cond, lect, ""
    L0 = from_start(v, color)[0]
    z = grid_zone(e, step)
    cond["zona = la celda del extremo de inicio"] = z == (L0, L0 + 1)
    p0 = pas(v, L0, color)
    val = e.get("value")
    lect["value = pasivo del extremo ÷ volumen medio por nivel"] = close(val, p0 / mean_level(v))
    lect["value = pasivo del extremo ÷ volumen medio de los niveles con trades"] = close(val, p0 / mean_traded(v)) if mean_traded(v) else False
    lect["value = pasivo del extremo ÷ volumen de la vela"] = close(val, p0 / v["vol"])
    return cond, lect, f"pasivo del extremo {p0:g} nivel medio {mean_level(v):.6g} value {val} thr {e.get('thr')}"


def chk_RS(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    if color == 0:
        return cond, lect, ""
    st = from_start(v, color)[:3]
    z = grid_zone(e, step)
    cond["zona = las tres celdas del extremo de inicio"] = z == start_zone(v, color, 3)
    cond["la vela tiene 3 niveles o más"] = len(st) == 3
    if len(st) < 3:
        return cond, lect, ""
    P = [pas(v, L, color) for L in st]
    cond["pasivo estrictamente decreciente desde el extremo, tres niveles"] = P[0] > P[1] > P[2]
    val = e.get("value")
    lect["value = pasivo del extremo ÷ volumen medio por nivel"] = close(val, P[0] / mean_level(v))
    lect["value = pasivo del extremo ÷ volumen medio de los niveles con trades"] = close(val, P[0] / mean_traded(v))
    return cond, lect, f"pasivo desde el inicio {P} nivel medio {mean_level(v):.6g} value {val} thr {e.get('thr')}"


def chk_PD(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    if color == 0:
        return cond, lect, ""
    cond["delta contra el color"] = v["delta"] * color < 0
    z = grid_zone(e, step)
    cond["zona = las dos celdas del extremo de inicio"] = z == start_zone(v, color, 2)
    lect["value = |Δ| ÷ volumen"] = close(e.get("value"), abs(v["delta"]) / v["vol"])
    return cond, lect, f"Δ {v['delta']:g} vol {v['vol']:g} value {e.get('value')} thr {e.get('thr')}"


def chk_AD(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    z = grid_zone(e, step)
    cond["zona = una celda de la grilla dentro de la vela"] = inside(v, z) and z[1] - z[0] == 1
    if color == 0 or z is None:
        return cond, lect, ""
    L = z[0]
    cell = pas(v, L, color)
    biggest = max(max(bs(v, x)) for x in levels(v))
    cond["la mayor celda de la vela es la del lado pasivo de ese nivel"] = cell >= biggest
    lect["sin empate con otra celda"] = sum(1 for x in levels(v) for y in bs(v, x) if y == biggest) == 1
    n, i = nlev(v), idx_start(v, L, color)
    lo_edge = L * step if color > 0 else (L + 1) * step
    third = (v["h"] - v["l"]) / 3
    thirds = {
        "tercio del inicio: índice < n/3": i < n / 3,
        "tercio del inicio: índice ≤ n/3": i <= n / 3,
        "tercio del inicio por precio (la celda empieza en el tercio)": (lo_edge < v["l"] + third) if color > 0 else (lo_edge > v["h"] - third),
    }
    lect.update(thirds)
    cond["en el tercio del inicio (alguna lectura)"] = any(thirds.values())
    val = e.get("value")
    lect["value = celda ÷ volumen medio por nivel"] = close(val, cell / mean_level(v))
    lect["value = celda ÷ volumen medio de los niveles con trades"] = close(val, cell / mean_traded(v))
    return cond, lect, f"celda {cell:g} mayor {biggest:g} índice {i} de {n} value {val} thr {e.get('thr')}"


def _run_common(e, v, ctx, cond, lect, minimum):
    step = ctx.step
    z = grid_zone(e, step)
    cond["zona en la grilla y dentro de la vela"] = inside(v, z)
    if z is None:
        return None
    Z = list(range(*z))
    cond[f"racha de {minimum} niveles o más"] = len(Z) >= minimum
    lect["value = largo de la racha (niveles de la zona)"] = e.get("value") is not None and close(e["value"], float(len(Z)))
    return Z


def chk_SW(e, v, ctx):
    cond, lect = {}, {}
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    Z = _run_common(e, v, ctx, cond, lect, 3)
    if color == 0 or Z is None:
        return cond, lect, ""
    m = mean_level(v)
    P = [pas(v, L, color) for L in Z]
    lect["pasivo = 0 en toda la racha"] = all(x == 0 for x in P)
    lect["pasivo ≤ 2% del volumen medio por nivel en toda la racha"] = all(x <= 0.02 * m for x in P)
    lect["pasivo ≤ 5% del volumen medio por nivel en toda la racha"] = all(x <= 0.05 * m for x in P)
    lect["agresor > 0 en toda la racha"] = all(agg(v, L, color) > 0 for L in Z)
    worst = max(P) / m if m else None
    return cond, lect, f"racha {len(Z)} pasivo máx ÷ nivel medio {worst} value {e.get('value')} thr {e.get('thr')}"


def chk_VL(e, v, ctx):
    cond, lect = {}, {}
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    Z = _run_common(e, v, ctx, cond, lect, 3)
    if color == 0 or Z is None:
        return cond, lect, ""
    A = [agg(v, L, color) for L in Z]
    lect["agresor > 0 en toda la racha"] = all(x > 0 for x in A)
    lect["agresor de la racha ≥ volumen medio por nivel"] = all(x >= mean_level(v) for x in A)
    return cond, lect, f"racha {len(Z)} agresor mín {min(A):g} value {e.get('value')} thr {e.get('thr')}"


def chk_SQ(e, v, ctx):
    cond, lect = {}, {}
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    Z = _run_common(e, v, ctx, cond, lect, 4)
    if color == 0 or Z is None:
        return cond, lect, ""
    Zs = sorted(Z, key=lambda L: idx_start(v, L, color))
    cond["la racha empieza en el extremo de inicio"] = idx_start(v, Zs[0], color) == 0
    A = [agg(v, L, color) for L in Zs]
    cond["agresor estrictamente creciente desde el extremo"] = all(a < b for a, b in zip(A, A[1:]))
    st = from_start(v, color)
    nxt = st[len(Zs)] if len(Zs) < len(st) else None
    lect["la racha es la más larga posible (el nivel siguiente no crece)"] = nxt is None or agg(v, nxt, color) <= A[-1]
    return cond, lect, f"agresor desde el inicio {A} value {e.get('value')} thr {e.get('thr')}"


def chk_DB(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    prev = ctx.get(e["t"] - TF_MS)
    cond["la vela anterior está en el almacén"] = prev is not None
    cond["t0 = la vela anterior"] = e.get("t0") == e["t"] - TF_MS
    if prev is None or color == 0:
        return cond, lect, ""
    cond["las dos velas del mismo color"] = color_of(prev) == color
    cond["delta de las dos del signo de su color"] = prev["delta"] * color > 0 and v["delta"] * color > 0
    jump = (v["delta"] - prev["delta"]) * color
    cond["salto de delta a favor del color"] = jump > 0
    lo, hi = min(prev["l"], v["l"]), max(prev["h"], v["h"])
    r1, r2 = raw_zone(e, lo, hi), raw_zone(e, *grid_edges(lo, hi, step))
    lect["zona = mínimo y máximo de las dos (precios)"] = r1
    lect["zona = mínimo y máximo de las dos (bordes de la grilla)"] = r2
    cond["zona = mínimo y máximo de las dos velas (alguna lectura)"] = r1 or r2
    val = e.get("value")
    p20 = ctx.prev(e["t"], VOL_BARS)
    if p20 is not None and val is not None:
        vols = [p["vol"] for p in p20]
        lect["value = salto ÷ mediana del volumen de las 20 anteriores"] = close(val, jump / statistics.median(vols))
    if ctx.typ_vol:
        lect["value = salto ÷ mediana del volumen de las velas de los 30 días anteriores"] = close(val, jump / ctx.typ_vol)
    lect["value = salto ÷ volumen de la vela"] = close(val, jump / v["vol"])
    return cond, lect, f"Δ anterior {prev['delta']:g} Δ {v['delta']:g} salto {jump:g} value {val} thr {e.get('thr')}"


def chk_DV(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≥")
    if color == 0:
        return cond, lect, ""
    cond["Δ/Vol a favor del color"] = v["delta"] * color > 0
    lect["value = Δ/Vol a favor del color"] = close(e.get("value"), v["delta"] * color / v["vol"])
    r1, r2 = raw_zone(e, v["l"], v["h"]), raw_zone(e, *grid_edges(v["l"], v["h"], step))
    lect["zona = la vela (precios)"] = r1
    lect["zona = la vela (bordes de la grilla)"] = r2
    cond["zona = la vela (alguna lectura)"] = r1 or r2
    return cond, lect, f"Δ {v['delta']:g} vol {v['vol']:g} value {e.get('value')} thr {e.get('thr')}"


def chk_XD(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    _value_thr(e, cond, "≥")
    d = v["delta"]
    cond["lado = signo de la delta"] = d != 0 and e["dir"] == (1 if d > 0 else -1)
    fl = ctx.flow.get(e["t"])
    cond["vela con el almacén de flujo"] = fl is not None
    lect["vela doji (el lado no es el color)"] = color_of(v) == 0
    r1, r2 = raw_zone(e, v["l"], v["h"]), raw_zone(e, *grid_edges(v["l"], v["h"], step))
    lect["zona = la vela (precios)"] = r1
    lect["zona = la vela (bordes de la grilla)"] = r2
    cond["zona = la vela (alguna lectura)"] = r1 or r2
    lect["value = |Δ/Vol|"] = close(e.get("value"), abs(d) / v["vol"])
    if fl is None:
        return cond, lect, ""
    mx, mn = fl
    cond["delta en 95% o más de su Máx Δ exacto (alcista) o de su Mín Δ (bajista)"] = (
        d >= EXTREME * mx - 1e-9 if e["dir"] > 0 else d <= EXTREME * mn + 1e-9)
    return cond, lect, f"Δ {d:g} Máx Δ {mx:g} Mín Δ {mn:g} value {e.get('value')} thr {e.get('thr')}"


def chk_SM(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    _value_thr(e, cond, "≤")
    fl = ctx.flow.get(e["t"])
    cond["vela con el almacén de flujo"] = fl is not None
    r1, r2 = raw_zone(e, v["l"], v["h"]), raw_zone(e, *grid_edges(v["l"], v["h"], step))
    lect["zona = la vela (precios)"] = r1
    lect["zona = la vela (bordes de la grilla)"] = r2
    cond["zona = la vela (alguna lectura)"] = r1 or r2
    if fl is None or color == 0:
        return cond, lect, ""
    mx, mn = fl
    against = mn if color > 0 else mx  # el lado contrario al color: Mín Δ en una verde, Máx Δ en una roja
    val, thr = e.get("value"), e.get("thr")
    lect["value = Mín Δ ÷ volumen (verde) o Máx Δ ÷ volumen (roja), con su signo"] = close(val, against / v["vol"], eps=1e-6)
    lect["value = |Mín Δ| o |Máx Δ| ÷ volumen"] = close(val, abs(against) / v["vol"], eps=1e-6)
    cond["el lado contrario apenas movió la delta: |Mín Δ| (verde) o Máx Δ (roja) ÷ volumen ≤ thr"] = (
        None if thr is None else abs(against) / v["vol"] <= thr + 1e-6)
    return cond, lect, f"color {color:+d} Máx Δ {mx:g} Mín Δ {mn:g} vol {v['vol']:g} value {val} thr {thr}"


def _orders_check(e, v, ctx, cond, lect, need_cross):
    _value_thr(e, cond, "≥")
    cond["día con órdenes en el almacén de flujo"] = ctx.has_orders
    orders = ctx.orders.get(e["t"], [])
    step = ctx.step

    def exact(o):
        return raw_zone(e, min(o["p0"], o["p1"]), max(o["p0"], o["p1"]))

    def on_grid(o):
        return raw_zone(e, *grid_edges(min(o["p0"], o["p1"]), max(o["p0"], o["p1"]), step))

    def one_step(o):
        """Desde el precio más bajo de la orden, con un step de alto como mínimo."""
        lo = min(o["p0"], o["p1"])
        return raw_zone(e, lo, max(max(o["p0"], o["p1"]), lo + step))

    mine = [o for o in orders if o["side"] == e["dir"] and (exact(o) or on_grid(o) or one_step(o))]
    cond["zona = precios de una orden de la vela, del lado del evento (alguna lectura)"] = bool(mine)
    lect["zona = los precios exactos de la orden"] = any(exact(o) for o in mine)
    lect["zona = los precios de la orden en la grilla"] = any(on_grid(o) for o in mine)
    lect["zona = desde el precio más bajo de la orden, con un step de alto como mínimo"] = any(one_step(o) for o in mine)
    lect["zona más alta que los precios de la orden (la orden ocupa menos de un step)"] = bool(mine) and not any(exact(o) for o in mine)
    lect["vela doji (el lado no es el color)"] = color_of(v) == 0
    lect["lado = color de la vela"] = e["dir"] == color_of(v)
    if not mine:
        other = [o for o in orders if exact(o) or on_grid(o)]
        lect["la zona es de una orden del otro lado"] = bool(other)
        return f"órdenes en la vela {len(orders)}"
    o = max(mine, key=lambda x: x["qty"])
    if need_cross:
        cond["la orden cruzó 3 precios o más"] = o["n"] >= 3
    pool = [x for x in orders if x["n"] >= 3] if need_cross else list(orders)
    if o not in pool:
        pool.append(o)
    usd = {
        "cantidad × precio medio": lambda x: x["qty"] * (x["p0"] + x["p1"]) / 2,
        "cantidad × primer precio": lambda x: x["qty"] * x["p0"],
        "cantidad × último precio": lambda x: x["qty"] * x["p1"],
    }
    any_big = False
    for name, f in usd.items():
        top = max(f(x) for x in pool)
        ok = f(o) >= top - 1e-6
        lect[f"es la mayor de la vela ({name})"] = ok
        any_big |= ok
    lect["es la mayor de la vela por cantidad"] = o["qty"] >= max(x["qty"] for x in pool)
    cond["es la mayor orden de la vela (alguna lectura del USD)"] = any_big
    val = e.get("value")
    lo, hi = min(o["p0"], o["p1"]), max(o["p0"], o["p1"])
    lect["value ÷ cantidad cae entre los precios de la orden"] = bool(val) and lo - 1e-9 <= val / o["qty"] <= hi + 1e-9
    for name, f in usd.items():
        lect[f"value = USD de la orden ({name})"] = close(val, f(o), rel=1e-6)
    return f"orden lado {o['side']:+d} cantidad {o['qty']:g} precios {o['p0']:g}–{o['p1']:g} cruzó {o['n']} value {val} thr {e.get('thr')} órdenes en la vela {len(orders)}"


def chk_BR(e, v, ctx):
    cond, lect = {}, {}
    show = _orders_check(e, v, ctx, cond, lect, True)
    return cond, lect, show


def chk_GR(e, v, ctx):
    cond, lect = {}, {}
    show = _orders_check(e, v, ctx, cond, lect, False)
    return cond, lect, show


def chk_RL(e, v, ctx):
    cond, lect = {}, {}
    step = ctx.step
    color = _side_color(e, v, cond)
    z = grid_zone(e, step)
    cond["zona = una celda de la grilla dentro de la vela"] = inside(v, z) and z[1] - z[0] == 1
    if color == 0 or z is None:
        return cond, lect, ""
    L = z[0]
    tot = lvol(v, L)
    share = pas(v, L, color) / tot if tot else 0.0
    cond["40% o más del lado pasivo en el nivel"] = share >= 0.40 - 1e-12
    lect["el nivel es el POC de la vela"] = L in pocs(v)
    return cond, lect, cells(v, [L], step) + f" pasivo {share:.3f} del nivel; el nivel es {tot / v['vol']:.3f} de la vela"


CHECKS = {code: globals()[f"chk_{code}"] for code in LITERAL + RELATIVE}


def known_ok(e):
    """Cuándo se conoce: la VA abandonada, al cierre de la vela siguiente; los demás, al cierre de su vela."""
    return e["known"] == e["t"] + (2 if e["code"] == "VA" else 1) * TF_MS


def check_event(e, ctx):
    """Las condiciones comunes y las del elemento. Devuelve (condiciones, lecturas, texto)."""
    cond, lect = {}, {}
    v = ctx.get(e["t"])
    cond["t en el inicio de una vela de 15m"] = e["t"] % TF_MS == 0
    cond["known = " + ("cierre de la vela siguiente" if e["code"] == "VA" else "cierre de la vela")] = known_ok(e)
    cond["vela en el almacén"] = v is not None
    if v is None:
        return cond, lect, ""
    c2, l2, show = CHECKS[e["code"]](e, v, ctx)
    cond.update(c2)
    lect.update(l2)
    if e["code"] not in ("PW", "DB", "OG", "VI"):
        # La documentación define t0 solo para los contornos (DB, PW y VI): en los demás es un dato
        lect["t0 = la vela"] = e.get("t0") == e["t"] if e.get("t0") is not None else None
    return cond, lect, show


# ==================== DATOS ====================

def _backend():
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    sys.path.insert(0, str(HERE))
    import footprint_store as fs  # solo para leer el almacén (_parts, _candles, _cell_sums suman compra y venta)
    import of_elements as oe  # solo se llama a detect(): value, thr y t0 de cada evento (no se lee su código)
    import reglas_prueba as rp
    import rule_tester as rt
    return fs, oe, rp, rt


def day_part(fs, symbol, day):
    parts = fs._parts(symbol, day * DAY // 60000, (day + 1) * DAY // 60000)
    return parts[0] if parts else None


def candles_of(fs, part, step):
    """Velas de 15m del día con compra y venta por nivel del step: {t: vela} y la celda del día."""
    data = part[0]
    ps, qs, ticks = (int(x) for x in data["info"])
    step_ticks = int(round(step * ps))
    c = fs._candles([part], TF)
    sums = fs._cell_sums([part], TF, step_ticks)
    out = {}
    for i in range(len(c["start"])):
        t = int(c["start"][i]) * 60000
        b, s = float(c["buy"][i]), float(c["sell"][i])
        out[t] = dict(t=t, o=float(c["open"][i]), h=float(c["high"][i]), l=float(c["low"][i]), c=float(c["close"][i]),
                      buy=b, sell=s, vol=b + s, delta=b - s, lv={}, step=step)
    for st, lv, b, s in zip(sums["start"], sums["level"], sums["buy"], sums["sell"]):
        out[int(st) * 60000]["lv"][int(lv)] = (round(float(b), 9), round(float(s), 9))
    for v in out.values():
        v["lmin"], v["lmax"] = min(v["lv"]), max(v["lv"])
    return out, ticks / ps


def flow_of(symbol, day, part):
    """Máx y Mín Δ exactos por vela, con el delta dentro del minuto del almacén de flujo, y las órdenes agresivas."""
    d_iso = dt.datetime.fromtimestamp(day * DAY / 1000, dt.timezone.utc).date().isoformat()
    path = FLOW_DIR / symbol / d_iso[:4] / f"{symbol}_{d_iso}.npz"
    if not path.exists():
        return {}, {}, False
    with np.load(path) as z:
        fl = {k: z[k] for k in z.files}
    fps, fqs = float(fl["info"][0]), float(fl["info"][1])
    has_orders = int(fl["info"][2]) == 1
    data, a, b = part[0], part[1], part[2]
    qs = float(data["info"][1])
    pos = {int(m): i for i, m in enumerate(fl["m"])}
    ext = {}
    cum, t_cur, mx, mn, ok = 0.0, None, None, None, True
    for k in range(a, b):
        m = int(data["m"][k])
        t = m // TF * TF * 60000
        if t != t_cur:
            if t_cur is not None:
                ext[t_cur] = (mx, mn) if ok else None
            t_cur, cum, mx, mn, ok = t, 0.0, -math.inf, math.inf, True
        j = pos.get(m)
        if j is None:
            ok = False
        else:
            mx = max(mx, cum + fl["dmx"][j] / fqs)
            mn = min(mn, cum + fl["dmn"][j] / fqs)
        cum += (float(data["buy"][k]) - float(data["sell"][k])) / qs
    if t_cur is not None:
        ext[t_cur] = (mx, mn) if ok else None
    ext = {t: x for t, x in ext.items() if x is not None}
    orders = collections.defaultdict(list)
    for ts, side, q, p0, p1, n in zip(fl["ot"], fl["os"], fl["oq"], fl["op0"], fl["op1"], fl["on"]):
        orders[int(ts) // TF_MS * TF_MS].append(
            dict(ts=int(ts), side=int(side), qty=float(q) / fqs, p0=float(p0) / fps, p1=float(p1) / fps, n=int(n)))
    return ext, dict(orders), has_orders


def key(e):
    return (e["code"], int(e["dir"]), int(e["t"]), int(e["known"]), round(float(e["lo"]), 8), round(float(e["hi"]), 8))


# ==================== PRINCIPAL ====================

def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--dias", type=int, default=60, help="días al azar de la fase, con semilla fija (0 = todos)")
    ap.add_argument("--codigos", default=",".join(LITERAL + RELATIVE))
    a = ap.parse_args()
    codes = [c.strip().upper() for c in a.codigos.split(",") if c.strip()]
    fs, oe, rp, rt = _backend()
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    rule = rt.clean_rule(rp.RULES["E-VA"])
    span = rt.detect_span(a.symbol, TF, phase, rule)
    evs = [e for e in span["events"] if e["code"] in codes]
    days = sorted({e["t"] // DAY for e in evs})
    if a.dias:
        random.Random(2026).shuffle(days)
        days = sorted(days[:a.dias])
    dayset = set(days)
    by_day = collections.defaultdict(list)
    for e in evs:
        if e["t"] // DAY in dayset:
            by_day[e["t"] // DAY].append(e)

    counts = {code: {"eventos": 0, "condiciones": collections.defaultdict(lambda: [0, 0]),
                     "lecturas": collections.defaultdict(lambda: [0, 0]), "ejemplos": collections.defaultdict(list),
                     "ejemplos_lecturas": collections.defaultdict(list)} for code in codes}
    motor = collections.Counter()
    step_info = collections.Counter()
    step_examples = []
    t_start = time.time()
    for n_day, d in enumerate(days):
        part = day_part(fs, a.symbol, d)
        if part is None:
            motor["días sin almacén"] += 1
            continue
        first_open = float(part[0]["o"][part[1]] / part[0]["info"][0])
        cell = int(part[0]["info"][2]) / int(part[0]["info"][0])
        step = doc_step(first_open, cell)
        cand, _ = candles_of(fs, part, step)
        prev_part, next_part = day_part(fs, a.symbol, d - 1), day_part(fs, a.symbol, d + 1)
        prev_step_changes = False
        if prev_part is not None:
            pc, pcell = candles_of(fs, prev_part, step)
            cand.update(pc)
            p_open = float(prev_part[0]["o"][prev_part[1]] / prev_part[0]["info"][0])
            prev_step_changes = doc_step(p_open, pcell) != step
        if next_part is not None:
            nc, _ = candles_of(fs, next_part, step)
            first_next = min(nc)
            cand[first_next] = nc[first_next]
        ext, orders, has_orders = flow_of(a.symbol, d, part)
        # Los eventos del motor del día, con value, thr y t0, y sus velas (con su step, Máx Δ y Mín Δ). Con una vela de
        # más, como detect_span, para que la última del día vea a su siguiente (VA abandonada)
        out = oe.detect(a.symbol, TF, d * DAY, min(phase["end"], (d + 1) * DAY + TF_MS) - 1, phase["end"], rule["target"], 0,
                        rule["volFilter"])
        mine = [e for e in out["events"] if d * DAY <= e["t"] < (d + 1) * DAY]
        rich = collections.defaultdict(list)
        for e in mine:
            rich[key(e)].append(e)
        span_keys = collections.Counter(key(e) for e in by_day[d])
        day_keys = collections.Counter(key(e) for e in mine if e["code"] in codes)
        motor["eventos de la fase revisados"] += sum(span_keys.values())
        motor["eventos de la fase que también da la consulta del día"] += sum((span_keys & day_keys).values())
        motor["eventos de la consulta del día que no están en la fase"] += sum((day_keys - span_keys).values())
        bar_steps = {b["step"] for b in out["bars"] if d * DAY <= b["t"] < (d + 1) * DAY}
        step_info["días"] += 1
        step_info["step del motor (velas de detect) = el de la documentación con la apertura del día"] += bar_steps == {step}
        if bar_steps != {step} and len(step_examples) < MAX_EXAMPLES:
            step_examples.append(f"{iso(d * DAY)} documentación {step} motor {sorted(bar_steps)} apertura {first_open:g}")
        step_info["días en que el step cambia contra el día anterior"] += prev_step_changes
        # Con el precio de cada vela (otra lectura de "la fracción del precio"), cuántas velas darían otro step
        for t in range(d * DAY, (d + 1) * DAY, TF_MS):
            v = cand.get(t)
            if v is not None:
                step_info["velas del día"] += 1
                step_info["velas cuya apertura da otro step que la del día"] += doc_step(v["o"], cell) != step
        # Velas del motor contra las del almacén, y su Máx/Mín Δ contra la cuenta con el flujo
        for b in out["bars"]:
            v = cand.get(b["t"])
            if v is None or not (d * DAY <= b["t"] < (d + 1) * DAY):
                continue
            motor["velas comparadas"] += 1
            same = all(close(b[k1], v[k2], rel=1e-9, eps=1e-6) for k1, k2 in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c")))
            same &= close(b["delta"], v["delta"], rel=1e-6, eps=1e-3) and close(b["vol"], v["vol"], rel=1e-6, eps=1e-3)
            motor["velas del motor = las del almacén (OHLC, delta y volumen)"] += same
            if b.get("maxd") is not None and b["t"] in ext:
                motor["velas con Máx/Mín Δ del motor y del flujo"] += 1
                mx, mn = ext[b["t"]]
                motor["Máx/Mín Δ del motor = la cuenta con el almacén de flujo"] += close(b["maxd"], mx, rel=1e-6, eps=2e-3) and close(b["mind"], mn, rel=1e-6, eps=2e-3)
        ev_count = collections.Counter((e["code"], e["t"]) for e in mine)
        tp_levels = collections.defaultdict(set)
        for e in mine:
            if e["code"] == "TP":
                tp_levels[e["t"]].add(int(round(e["lo"] / step)))
        # "Volumen típico de la vela" (CALIBRACION, Delta Breakout): se prueba la mediana de las velas de 30 días
        parts30 = fs._parts(a.symbol, (d - 30) * DAY // 60000, d * DAY // 60000)
        typ_vol = None
        if parts30:
            c30 = fs._candles(parts30, TF)
            typ_vol = float(np.median(c30["buy"] + c30["sell"]))
        ctx = Ctx(cand, step, flow=ext, orders=orders, events=ev_count, has_orders=has_orders, tp_levels=tp_levels,
                  typ_vol=typ_vol)
        for e0 in sorted(by_day[d], key=lambda x: (x["t"], x["code"])):
            got = rich.get(key(e0))
            e = dict(e0)
            if got:
                e.update(value=got[0].get("value"), thr=got[0].get("thr"), t0=got[0].get("t0"))
            else:
                e.update(value=None, thr=None, t0=None)
            code = e["code"]
            box = counts[code]
            box["eventos"] += 1
            cond, lect, show = check_event(e, ctx)
            v = ctx.get(e["t"])
            color = color_of(v) if v else 0
            head = f"{iso(e['t'])} {arrow(e['dir'])} color {color:+d} zona {e['lo']:g}–{e['hi']:g} paso {step:g}"
            cond["value, thr y t0 de la consulta del día"] = bool(got)
            if prev_step_changes and e["t"] - 2 * TF_MS < d * DAY and code in ("AP", "SL", "PW", "DB", "OG", "RD", "DD", "OP"):
                lect["mira una vela del día anterior, que tiene otro step"] = True
            for k_, ok in cond.items():
                cell_ = box["condiciones"][k_]
                if ok is None:
                    continue
                cell_[1] += 1
                cell_[0] += bool(ok)
                if not ok and len(box["ejemplos"][k_]) < MAX_EXAMPLES:
                    box["ejemplos"][k_].append(f"{head} | {show}" + (f" | {vela_txt(v)}" if v else ""))
            for k_, ok in lect.items():
                cell_ = box["lecturas"][k_]
                if ok is None:
                    continue
                cell_[1] += 1
                cell_[0] += bool(ok)
                if not ok and len(box["ejemplos_lecturas"][k_]) < 3:
                    box["ejemplos_lecturas"][k_].append(f"{head} | {show}")
        if (n_day + 1) % 10 == 0:
            print(f"  {n_day + 1}/{len(days)} días ({time.time() - t_start:.0f} s)", flush=True)

    # Informe
    print(f"\n{a.symbol} 15m fase {a.fase}: {len(days)} días ({'al azar, semilla 2026' if a.dias else 'todos'})")
    print("Motor:", json.dumps(motor, ensure_ascii=False))
    print("Step:", json.dumps(step_info, ensure_ascii=False))
    for x in step_examples:
        print("    ", x)
    result = {"moneda": a.symbol, "fase": a.fase, "dias_pedidos": a.dias, "dias": [iso(d * DAY)[:10] for d in days],
              "motor": dict(motor), "step": dict(step_info), "step_ejemplos": step_examples, "elementos": {}}
    for code in codes:
        box = counts[code]
        if not box["eventos"]:
            continue
        fails = {k: v for k, v in box["condiciones"].items() if v[1] and v[0] < v[1]}
        print(f"\n{code}: {box['eventos']} eventos" + ("" if not fails else f" · {len(fails)} condición(es) que no siempre se cumplen"))
        for k_, (ok, tot) in box["condiciones"].items():
            if tot:
                print(f"   {'✓' if ok == tot else '✗'} {k_}: {ok}/{tot}")
                for x in box["ejemplos"].get(k_, [])[:3]:
                    print("        ", x)
        for k_, (ok, tot) in box["lecturas"].items():
            if tot:
                print(f"   · {k_}: {ok}/{tot}")
        result["elementos"][code] = {
            "eventos": box["eventos"],
            "condiciones": {k_: {"cumplen": ok, "con_dato": tot} for k_, (ok, tot) in box["condiciones"].items()},
            "lecturas": {k_: {"cumplen": ok, "con_dato": tot} for k_, (ok, tot) in box["lecturas"].items()},
            "ejemplos_de_fallas": {k_: v for k_, v in box["ejemplos"].items() if v},
            "ejemplos_de_lecturas_que_no_sigue": {k_: v for k_, v in box["ejemplos_lecturas"].items() if v},
        }
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"comparar_of2_{a.symbol}_{TF}_f{a.fase}.json"
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"\n{path} ({time.time() - t_start:.0f} s)")


if __name__ == "__main__":
    main()
