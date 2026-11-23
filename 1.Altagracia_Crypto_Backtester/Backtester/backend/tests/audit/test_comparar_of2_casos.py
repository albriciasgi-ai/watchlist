"""Casos armados a mano de comparar_of2.py (condiciones necesarias de los elementos de order flow), con la respuesta en
cada comentario.

Velas de 15 minutos con step 1: el nivel L va del precio L al L+1, así que las zonas se leen directo de los niveles.
Cada vela se arma con {nivel: (compra, venta)}; el mínimo es el nivel más bajo y el máximo, el más alto más 0.5. Una
verde abre en el mínimo y cierra en el máximo; una roja, al revés. Las velas de relleno (volumen 1) dan las 20
anteriores del filtro de volumen.
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from comparar_of2 import (DAY, EDGE, TF_MS, ZERO, Ctx, check_event, doc_step, imbalance,  # noqa: E402
                          value_area)

T0 = 1_704_067_200_000          # 2024-01-01 00:00 UTC


def vela(i, lv, color=1):
    lmin, lmax = min(lv), max(lv)
    lo, hi = float(lmin), lmax + 0.5
    o, c = (lo, hi) if color > 0 else (hi, lo) if color < 0 else (lo, lo)
    b = sum(x[0] for x in lv.values())
    s = sum(x[1] for x in lv.values())
    return dict(t=T0 + i * TF_MS, o=o, h=hi, l=lo, c=c, buy=b, sell=s, vol=b + s, delta=b - s, lv=dict(lv),
                lmin=lmin, lmax=lmax, step=1.0)


def relleno(n, base=100):
    """n velas verdes de volumen 1 en dos niveles, antes de las del caso."""
    return [vela(i, {base: (0.25, 0.25), base + 1: (0.25, 0.25)}) for i in range(n)]


def ctx(*velas, **kw):
    return Ctx({v["t"]: v for v in velas}, 1.0, **kw)


def ev(code, d, v, lo, hi, value=None, thr=None, t0=None, known=None):
    t = v["t"]
    return dict(code=code, dir=d, t=t, known=known if known is not None else t + (2 if code == "VA" else 1) * TF_MS,
                lo=float(lo), hi=float(hi), value=value, thr=thr, t0=t if t0 is None else t0)


def fallas(e, c):
    cond, _, _ = check_event(e, c)
    return sorted(k for k, ok in cond.items() if ok is False)


def lecturas(e, c):
    _, lect, _ = check_event(e, c)
    return lect


# ------------------------------------------------------------------ ayudas

def test_step_de_la_documentacion():
    # 80,000 × 0.0125% = 10 → 10; 30,000 → 3.75 → 5 (1.25 contra 1.75 de 2); 20,000 → 2.5 → 2 (0.5 contra 2.5)
    assert doc_step(80_000, 0.1) == 10
    assert doc_step(30_000, 0.1) == 5
    assert doc_step(20_000, 0.1) == 2
    # con celda de 0.5, un step de 0.2 no es múltiplo: 1,600 × 0.0125% = 0.2 → 0.5
    assert doc_step(1_600, 0.5) == 0.5


def test_area_de_valor_de_a_un_nivel_y_sus_empates():
    # volúmenes 1, 30, 40, 30, 1 (total 102, 70% = 71.4): POC 102 (40); empate 30/30: con uno queda en 70, falta;
    # después el de abajo (30) gana al 1 de arriba → 101 a 103 con cualquier empate
    v = vela(0, {100: (0.5, 0.5), 101: (15, 15), 102: (20, 20), 103: (15, 15), 104: (0.5, 0.5)})
    assert value_area(v, tie="arriba") == (101, 103)
    assert value_area(v, tie="abajo") == (101, 103)
    # 1, 30, 40, 30, 1 con total 100 exacto: 0.5|0.5 → 70% = 70: con el primer vecino ya llega → el empate decide
    w = vela(0, {100: (0, 0.0), 101: (15, 15), 102: (20, 20), 103: (15, 15), 104: (0, 0.0)})
    w["lv"][100] = (0.0, 0.0)
    w["lv"][104] = (0.0, 0.0)
    assert value_area(w, tie="arriba") == (102, 103)
    assert value_area(w, tie="abajo") == (101, 102)
    # dos POC empatados (40 en 101 y en 103; total 105, 70% = 73.5). Desde 101: 100 (10) le gana a 102 (5) → 50; ya no
    # hay abajo: 102 → 55; 103 → 95. Desde 103: 104 (10) → 50; 102 → 55; 101 → 95
    p = vela(0, {100: (5, 5), 101: (20, 20), 102: (2, 3), 103: (20, 20), 104: (5, 5)})
    assert value_area(p, poc="bajo") == (100, 103)
    assert value_area(p, poc="alto") == (101, 104)


def test_desequilibrio_diagonal_con_sus_ceros_y_bordes():
    v = vela(0, {100: (1, 0.0), 101: (8, 2), 102: (1, 1)})
    # compra de 101 (8) contra venta de 100 (0): con un 0 enfrente cuenta; pidiendo volumen, no
    assert imbalance(v, 101, "compra", ZERO[0]) is True
    assert imbalance(v, 101, "compra", ZERO[1]) is False
    # compra de 102 (1) contra venta de 101 (2): 1 < 8, no
    assert imbalance(v, 102, "compra") is False
    # venta de 101 (2) contra compra de 102 (1): 2 < 4, no; compra de 100 contra la venta de 99 (fuera de la vela)
    assert imbalance(v, 101, "venta") is False
    assert imbalance(v, 100, "compra", ZERO[0], EDGE[0]) is True
    assert imbalance(v, 100, "compra", ZERO[0], EDGE[1]) is False


# ------------------------------------------------------------------ literales

def test_va_abandonada():
    n = vela(0, {100: (0.5, 0.5), 101: (15, 15), 102: (20, 20), 103: (15, 15), 104: (0.5, 0.5)})
    arriba = vela(1, {104: (1, 1), 105: (1, 1), 106: (1, 1)})   # mínimo 104: queda entera sobre el área (101-104)
    adentro = vela(1, {103: (1, 1), 104: (1, 1), 105: (1, 1)})  # mínimo 103: entra
    assert fallas(ev("VA", 1, n, 101, 104), ctx(n, arriba)) == []
    assert "la siguiente no entra en el área, del lado del evento (por niveles)" in fallas(ev("VA", 1, n, 101, 104), ctx(n, adentro))
    assert "la siguiente no entra en el área, del lado del evento (por niveles)" in fallas(ev("VA", -1, n, 101, 104), ctx(n, arriba))
    # la zona tiene que ser el área: 100-105 no lo es
    assert "zona = área de valor del 70% de la vela, de a un nivel (alguna lectura de empates)" in fallas(ev("VA", 1, n, 100, 105), ctx(n, arriba))
    # se conoce al cierre de la siguiente, no al de su vela
    assert "known = cierre de la vela siguiente" in fallas(ev("VA", 1, n, 101, 104, known=n["t"] + TF_MS), ctx(n, arriba))


def test_va_bajista_con_el_maximo_justo_en_el_val_entra():
    # área 101-104 (VAL = 101). La siguiente tiene su máximo en 101.0: negoció en el nivel 101, dentro del área
    n = vela(0, {100: (0.5, 0.5), 101: (15, 15), 102: (20, 20), 103: (15, 15), 104: (0.5, 0.5)})
    toca = vela(1, {98: (1, 1), 99: (1, 1), 100: (1, 1), 101: (1, 0.0)}, color=-1)
    toca["h"] = 101.0
    e = ev("VA", -1, n, 101, 104)
    assert "la siguiente no entra en el área, del lado del evento (por niveles)" in fallas(e, ctx(n, toca))
    assert lecturas(e, ctx(n, toca))["bajista con el máximo de la siguiente justo en el VAL (borde bajo del área)"] is True
    # con el máximo en 100.5 (nivel 100) no entra
    abajo = vela(1, {98: (1, 1), 99: (1, 1), 100: (1, 1)}, color=-1)
    assert fallas(e, ctx(n, abajo)) == []


def test_poc_alineado_y_tirachinas():
    a = vela(0, {100: (1, 1), 101: (1, 1), 102: (5, 5), 103: (2, 2)}, color=-1)   # POC 102
    b = vela(1, {101: (1, 1), 102: (6, 6), 103: (3, 3)})                           # POC 102, verde
    c = vela(1, {101: (1, 1), 102: (3, 3), 103: (6, 6)})                           # POC 103
    assert fallas(ev("AP", 1, b, 102, 103), ctx(a, b)) == []
    assert "el mismo nivel es POC de la anterior (alguna lectura de empates)" in fallas(ev("AP", 1, c, 103, 104), ctx(a, c))
    assert "lado = color de la vela" in fallas(ev("AP", -1, b, 102, 103), ctx(a, b))
    # tirachinas: dos verdes y el POC baja (103 → 102) es alcista; si sube, no
    v1 = vela(0, {101: (1, 1), 102: (2, 2), 103: (6, 6)})
    v2 = vela(1, {101: (1, 1), 102: (6, 6), 103: (2, 2)})
    assert fallas(ev("SL", 1, v2, 102, 103), ctx(v1, v2)) == []
    # dos verdes con el POC que sube (102 → 103): no es tirachinas
    u1 = vela(0, {101: (1, 1), 102: (6, 6), 103: (2, 2)})
    u2 = vela(1, {101: (1, 1), 102: (2, 2), 103: (6, 6)})
    assert "POC hacia atrás: más bajo que el anterior en dos verdes, más alto en dos rojas (alguna lectura de empates)" in fallas(
        ev("SL", 1, u2, 103, 104), ctx(u1, u2))


def test_tirachinas_con_colores_distintos_no():
    v1 = vela(0, {101: (1, 1), 102: (2, 2), 103: (6, 6)}, color=-1)
    v2 = vela(1, {101: (1, 1), 102: (6, 6), 103: (2, 2)})
    assert "las dos velas del mismo color" in fallas(ev("SL", 1, v2, 102, 103), ctx(v1, v2))


def test_zero_print():
    # verde con la venta en 0 en el mínimo: alcista, zona de las dos celdas del inicio (100-102)
    v = vela(0, {100: (5, 0.0), 101: (5, 2), 102: (5, 5)})
    assert fallas(ev("ZP", 1, v, 100, 102), ctx(v)) == []
    w = vela(0, {100: (5, 1), 101: (5, 2), 102: (5, 5)})
    assert "un 0 del lado pasivo en una de las dos celdas del inicio" in fallas(ev("ZP", 1, w, 100, 102), ctx(w))
    # en una roja el inicio es el máximo: el 0 tiene que estar en la compra de 102 o 101
    r = vela(0, {100: (5, 5), 101: (0.0, 5), 102: (2, 5)}, color=-1)
    assert fallas(ev("ZP", -1, r, 101, 103), ctx(r)) == []


def test_divergencia_de_delta():
    prev = [vela(i, {101 + i: (1, 1), 102 + i: (1, 1), 103 + i: (1, 1)}) for i in range(5)]   # mínimos 101 a 105
    v = vela(5, {100: (3, 1), 101: (3, 1), 102: (3, 1)})                                     # verde, Δ +6, mínimo 100
    assert fallas(ev("DD", 1, v, 100, 102), ctx(*prev, v)) == []
    w = vela(5, {100: (1, 3), 101: (1, 3), 102: (1, 3)})                                     # verde con Δ -6
    assert "delta de la vela del signo de su color" in fallas(ev("DD", 1, w, 100, 102), ctx(*prev, w))
    alto = vela(5, {106: (3, 1), 107: (3, 1), 108: (3, 1)})                                  # mínimo 106: no es extremo
    assert "nuevo extremo de 5 velas del lado del color (alguna lectura)" in fallas(ev("DD", 1, alto, 106, 108), ctx(*prev, alto))


def test_desequilibrio_inverso_en_la_mitad_lejana():
    # verde de 6 niveles: ventas 8 contra compras 1 de arriba en 103 y 104 (índices 3 y 4: mitad lejana)
    v = vela(0, {100: (5, 1), 101: (5, 1), 102: (5, 1), 103: (2, 8), 104: (1, 8), 105: (1, 0.5)})
    assert fallas(ev("IV", 1, v, 103, 105), ctx(v)) == []
    # las mismas celdas en la mitad cercana no: y ahí tampoco hay desequilibrios de venta
    f = fallas(ev("IV", 1, v, 100, 102), ctx(v))
    assert "en la mitad lejana de la vela (alguna lectura)" in f
    assert "las celdas de la zona son desequilibrios contrarios 4x seguidos (alguna lectura)" in f


def test_onda_de_poc():
    a = vela(0, {103: (1, 1), 104: (1, 1), 105: (5, 5), 106: (1, 1), 107: (1, 1)}, color=-1)  # roja, POC 105
    b = vela(1, {102: (1, 1), 103: (1, 1), 104: (5, 5), 105: (1, 1), 106: (1, 1)})            # verde, POC 104
    c = vela(2, {104: (1, 1), 105: (1, 1), 106: (5, 5), 107: (1, 1), 108: (1, 1)})            # verde, POC 106
    e = ev("PW", 1, c, 102, 108.5, t0=a["t"])
    assert fallas(e, ctx(a, b, c)) == []
    c2 = vela(2, {104: (1, 1), 105: (5, 5), 106: (1, 1), 107: (1, 1), 108: (1, 1)})           # POC 105: igual al de la roja
    assert "POC de la 2.ª al otro lado del de la 1.ª y el de la 3.ª más allá de él (alguna lectura de empates)" in fallas(
        ev("PW", 1, c2, 102, 108.5, t0=a["t"]), ctx(a, b, c2))
    assert "t0 = la primera de las tres" in fallas(ev("PW", 1, c, 102, 108.5), ctx(a, b, c))


def test_varios_desequilibrios_con_filtro_de_volumen():
    pre = relleno(20)
    v = vela(20, {100: (4, 0.5), 101: (4, 0.5), 102: (4, 0.5), 103: (4, 0.5)})               # volumen 18, 4 a favor
    assert fallas(ev("VI", 1, v, 100, 103.5), ctx(*pre, v)) == []
    flojo = vela(20, {100: (0.5, 0.5), 101: (0.5, 0.5), 102: (1, 1)})                         # volumen 4, sin desequilibrios
    f = fallas(ev("VI", 1, flojo, 100, 102.5), ctx(*pre, flojo))
    assert "3 o más desequilibrios 4x a favor del color, seguidos o no (alguna lectura)" in f
    poco = vela(20, {100: (0.6, 0.1), 101: (0.6, 0.1), 102: (0.6, 0.1)})                       # volumen 2.1 ≥ 2, pasa
    assert "volumen ≥ 2 veces la mediana de las 20 anteriores" not in fallas(ev("VI", 1, poco, 100, 102.5), ctx(*pre, poco))
    muy_poco = vela(20, {100: (0.5, 0.1), 101: (0.5, 0.1), 102: (0.5, 0.1)})                   # volumen 1.8 < 2
    assert "volumen ≥ 2 veces la mediana de las 20 anteriores" in fallas(ev("VI", 1, muy_poco, 100, 102.5), ctx(*pre, muy_poco))


def test_desequilibrio_de_giro():
    pre = relleno(20)
    v = vela(20, {100: (1, 8), 101: (1, 1), 102: (5, 1)})   # verde: venta 8 en 100 contra compra 1 en 101
    assert fallas(ev("IR", 1, v, 100, 102), ctx(*pre, v)) == []
    w = vela(20, {100: (1, 2), 101: (1, 1), 102: (5, 6)})
    assert "desequilibrio contrario 4x en uno de los dos precios del inicio (alguna lectura)" in fallas(ev("IR", 1, w, 100, 102), ctx(*pre, w))


def test_desequilibrio_repetido():
    pre = relleno(19)
    a = vela(19, {101: (1, 1), 102: (8, 1), 103: (1, 1)})   # compra 8 en 102 contra venta 1 en 101
    b = vela(20, {101: (1, 1), 102: (8, 1), 103: (1, 1)})
    assert fallas(ev("RD", 1, b, 102, 103), ctx(*pre, a, b)) == []
    roja = vela(20, {101: (1, 1), 102: (8, 1), 103: (1, 1)}, color=-1)
    assert "las dos velas del mismo color" in fallas(ev("RD", -1, roja, 102, 103), ctx(*pre, a, roja))


def test_volumen_decreciente():
    pre = relleno(20)
    v = vela(20, {100: (3, 1), 101: (3, 2), 102: (3, 3)})   # venta 1 < 2 < 3 desde el mínimo
    assert fallas(ev("VD", 1, v, 100, 103), ctx(*pre, v)) == []
    w = vela(20, {100: (3, 3), 101: (3, 2), 102: (3, 1)})
    assert "pasivo estrictamente creciente del 1.º al 3.º precio desde el inicio" in fallas(ev("VD", 1, w, 100, 103), ctx(*pre, w))


def test_nivel_fino():
    pre = relleno(20)
    v = vela(20, {100: (2, 1), 101: (3, 0.0), 102: (2, 1)})
    c = ctx(*pre, v, events={("TP", v["t"]): 1})
    assert fallas(ev("TP", 1, v, 101, 102), c) == []
    w = vela(20, {100: (2, 0.0), 101: (3, 1), 102: (2, 1)})   # el 0 está en el mínimo: no es interior
    assert "nivel interior: ni el mínimo ni el máximo" in fallas(ev("TP", 1, w, 100, 101), ctx(*pre, w, events={("TP", w["t"]): 1}))
    assert "hasta 3 por vela" in fallas(ev("TP", 1, v, 101, 102), ctx(*pre, v, events={("TP", v["t"]): 4}))


def test_poc_fuera_de_rango():
    pre = [vela(i, {100: (0.5, 0.5), 101: (0.5, 0.5)}) for i in range(15)]
    p5 = [vela(15 + i, {100 + j: (0.5, 0.5) for j in range(6)}) for i in range(5)]     # máximos 105.5
    v = vela(20, {108: (1, 1), 109: (1, 1), 110: (6, 6), 111: (1, 1)})               # POC 110, a 4.5 del rango
    assert fallas(ev("OP", 1, v, 110, 111), ctx(*pre, *p5, v)) == []
    w = vela(20, {104: (1, 1), 105: (6, 6), 106: (1, 1), 107: (1, 1)})               # POC 105: dentro del rango
    # el nivel del POC (105 a 106) contiene el máximo anterior (105.5): no está fuera, aunque su borde alto lo pase
    assert "POC fuera del rango de las 5 anteriores, del lado del evento (la celda entera o su centro)" in fallas(
        ev("OP", 1, w, 105, 106), ctx(*pre, *p5, w))


def test_ratio_de_extremos():
    pre = relleno(20)
    v = vela(20, {100: (2, 10), 101: (2, 3), 102: (5, 1)})   # venta 3 ÷ 10 = 0.3 < 0.70
    assert fallas(ev("RX", 1, v, 100, 102), ctx(*pre, v)) == []
    w = vela(20, {100: (2, 3), 101: (2, 3), 102: (5, 1)})    # 1.0
    assert "2.º precio ÷ extremo, del lado pasivo, < 0.70 o > 30 (alguna lectura de los ceros)" in fallas(ev("RX", 1, w, 100, 102), ctx(*pre, w))


# ------------------------------------------------------------------ de umbral relativo

def test_hueco_entre_areas():
    a = vela(0, {100: (1, 1), 101: (10, 10), 102: (5, 5)})    # área 101-102
    b = vela(1, {104: (1, 1), 105: (10, 10), 106: (5, 5)})    # área 105-106: hueco 103 a 105 (niveles 103 y 104)
    assert fallas(ev("OG", 1, b, 103, 105, value=1.0, thr=0.5, t0=a["t"]), ctx(a, b)) == []
    assert "áreas de valor sin solape, la de la vela del lado del evento, y la zona es el hueco (alguna lectura de empates)" in fallas(
        ev("OG", -1, b, 103, 105, value=1.0, thr=0.5, t0=a["t"]), ctx(a, b))
    assert "value ≥ thr" in fallas(ev("OG", 1, b, 103, 105, value=0.4, thr=0.5, t0=a["t"]), ctx(a, b))


def test_agotamiento_retiro_y_divergencia_de_precio():
    v = vela(0, {100: (5, 0.01), 101: (5, 5), 102: (5, 5)})
    assert fallas(ev("EX", 1, v, 100, 101, value=0.0012, thr=0.005), ctx(v)) == []
    assert "value ≤ thr" in fallas(ev("EX", 1, v, 100, 101, value=0.01, thr=0.005), ctx(v))
    assert lecturas(ev("EX", 1, v, 100, 101, value=round(0.01 / (25.01 / 3), 6), thr=0.005), ctx(v))[
        "value = pasivo del extremo ÷ volumen medio por nivel"] is True
    rs = vela(0, {100: (1, 9), 101: (1, 5), 102: (1, 2), 103: (5, 1)})
    assert fallas(ev("RS", 1, rs, 100, 103, value=2.0, thr=1.0), ctx(rs)) == []
    rs2 = vela(0, {100: (1, 5), 101: (1, 9), 102: (1, 2), 103: (5, 1)})
    assert "pasivo estrictamente decreciente desde el extremo, tres niveles" in fallas(ev("RS", 1, rs2, 100, 103, value=2.0, thr=1.0), ctx(rs2))
    pd = vela(0, {100: (1, 5), 101: (1, 5), 102: (2, 1)})   # verde con Δ -7
    assert fallas(ev("PD", 1, pd, 100, 102, value=7 / 15, thr=0.2), ctx(pd)) == []
    pd2 = vela(0, {100: (5, 1), 101: (5, 1), 102: (2, 1)})
    assert "delta contra el color" in fallas(ev("PD", 1, pd2, 100, 102, value=0.5, thr=0.2), ctx(pd2))


def test_acumulacion():
    v = vela(0, {100: (1, 20), 101: (2, 2), 102: (3, 1), 103: (3, 1), 104: (3, 1), 105: (3, 1)})
    assert fallas(ev("AD", 1, v, 100, 101, value=3.0, thr=2.0), ctx(v)) == []
    w = vela(0, {100: (1, 2), 101: (2, 2), 102: (3, 1), 103: (3, 1), 104: (3, 1), 105: (3, 20)})
    assert "en el tercio del inicio (alguna lectura)" in fallas(ev("AD", 1, w, 105, 106, value=3.0, thr=2.0), ctx(w))


def test_rachas():
    v = vela(0, {100: (1, 1), 101: (3, 0.0), 102: (3, 0.0), 103: (3, 0.0), 104: (1, 1)})
    assert fallas(ev("SW", 1, v, 101, 104, value=3.0, thr=3.0), ctx(v)) == []
    assert "racha de 3 niveles o más" in fallas(ev("SW", 1, v, 101, 103, value=2.0, thr=2.0), ctx(v))
    sq = vela(0, {100: (1, 0.5), 101: (2, 0.5), 102: (3, 0.5), 103: (4, 0.5), 104: (1, 0.5)})
    assert fallas(ev("SQ", 1, sq, 100, 104, value=4.0, thr=4.0), ctx(sq)) == []
    f = fallas(ev("SQ", 1, sq, 101, 105, value=4.0, thr=4.0), ctx(sq))
    assert "la racha empieza en el extremo de inicio" in f
    vl = vela(0, {100: (1, 1), 101: (9, 1), 102: (9, 1), 103: (9, 1), 104: (1, 1)})
    assert fallas(ev("VL", 1, vl, 101, 104, value=3.0, thr=3.0), ctx(vl)) == []
    assert "value ≥ thr" in fallas(ev("VL", 1, vl, 101, 104, value=3.0, thr=4.0), ctx(vl))


def test_ruptura_de_delta_y_delta_volumen():
    a = vela(0, {100: (3, 1), 101: (3, 2)})                  # verde, Δ +3
    b = vela(1, {101: (10, 1), 102: (10, 1)})                # verde, Δ +18
    assert fallas(ev("DB", 1, b, 100, 102.5, value=1.0, thr=0.5, t0=a["t"]), ctx(a, b)) == []
    r = vela(1, {101: (10, 1), 102: (10, 1)}, color=-1)
    assert "las dos velas del mismo color" in fallas(ev("DB", -1, r, 100, 102.5, value=1.0, thr=0.5, t0=a["t"]), ctx(a, r))
    assert fallas(ev("DV", 1, b, 101, 102.5, value=18 / 22, thr=0.5), ctx(b)) == []
    assert "lado = color de la vela" in fallas(ev("DV", -1, b, 101, 102.5, value=18 / 22, thr=0.5), ctx(b))


def test_delta_extremo_y_delta_contrario_chico():
    v = vela(0, {100: (8, 1), 101: (4, 1)})                  # Δ +10, volumen 14
    ok = ctx(v, flow={v["t"]: (10.2, -0.5)})                  # 10 ≥ 0.95 × 10.2 = 9.69
    assert fallas(ev("XD", 1, v, 100, 101.5, value=10 / 14, thr=0.5), ok) == []
    lejos = ctx(v, flow={v["t"]: (12.0, -0.5)})              # 10 < 11.4
    assert "delta en 95% o más de su Máx Δ exacto (alcista) o de su Mín Δ (bajista)" in fallas(
        ev("XD", 1, v, 100, 101.5, value=10 / 14, thr=0.5), lejos)
    chico = ctx(v, flow={v["t"]: (10.0, -0.001)})            # verde: |Mín Δ| ÷ volumen = 0.00007
    assert fallas(ev("SM", 1, v, 100, 101.5, value=-0.001 / 14, thr=0.0002), chico) == []
    grande = ctx(v, flow={v["t"]: (10.0, -1.0)})
    assert "el lado contrario apenas movió la delta: |Mín Δ| (verde) o Máx Δ (roja) ÷ volumen ≤ thr" in fallas(
        ev("SM", 1, v, 100, 101.5, value=-0.001 / 14, thr=0.0002), grande)


def test_ordenes_barrido_y_grande():
    v = vela(0, {100: (5, 1), 101: (5, 1), 102: (5, 1), 103: (5, 1)})
    o1 = dict(ts=v["t"] + 1000, side=1, qty=2.0, p0=100.0, p1=103.0, n=4)   # 2 × 101.5 = 203 USD, cruzó 4 precios
    o2 = dict(ts=v["t"] + 2000, side=1, qty=1.0, p0=101.0, p1=101.0, n=1)   # 101 USD
    c = ctx(v, orders={v["t"]: [o1, o2]})
    assert fallas(ev("BR", 1, v, 100, 103, value=203.0, thr=100.0), c) == []
    assert fallas(ev("GR", 1, v, 100, 103, value=203.0, thr=100.0), c) == []
    assert "la orden cruzó 3 precios o más" in fallas(ev("BR", 1, v, 101, 101, value=101.0, thr=100.0), c)
    assert "es la mayor orden de la vela (alguna lectura del USD)" in fallas(ev("GR", 1, v, 101, 101, value=101.0, thr=100.0), c)
    assert "zona = precios de una orden de la vela, del lado del evento (alguna lectura)" in fallas(
        ev("GR", -1, v, 100, 103, value=203.0, thr=100.0), c)
    # sin umbral (thr vacío) no se puede marcar: la documentación pide el USD sobre el umbral relativo
    assert "trae su umbral relativo (value y thr)" in fallas(ev("BR", 1, v, 100, 103, value=203.0, thr=None), c)
    # una orden de un solo precio (101): la zona de un step de alto (101 a 102) es una lectura, no una falla
    e = ev("GR", 1, v, 101, 102, value=101.0, thr=100.0)
    c2 = ctx(v, orders={v["t"]: [o2]})
    assert fallas(e, c2) == []
    assert lecturas(e, c2)["zona = desde el precio más bajo de la orden, con un step de alto como mínimo"] is True
    assert lecturas(e, c2)["zona más alta que los precios de la orden (la orden ocupa menos de un step)"] is True


def test_absorcion():
    v = vela(0, {100: (1, 1), 101: (3, 7), 102: (1, 1)})     # verde: venta 7 de 10 en 101 (70% pasivo)
    assert fallas(ev("RL", 1, v, 101, 102), ctx(v)) == []
    w = vela(0, {100: (1, 1), 101: (8, 2), 102: (1, 1)})     # 20%
    assert "40% o más del lado pasivo en el nivel" in fallas(ev("RL", 1, w, 101, 102), ctx(w))


def test_doji_no_marca():
    v = vela(0, {100: (5, 0.0), 101: (5, 2), 102: (5, 5)}, color=0)
    f = fallas(ev("ZP", 1, v, 100, 102), ctx(v))
    assert "no es doji" in f and "lado = color de la vela" in f


def test_known_es_el_cierre_de_la_vela():
    a = vela(0, {100: (1, 1), 101: (1, 1), 102: (5, 5), 103: (2, 2)}, color=-1)
    b = vela(1, {101: (1, 1), 102: (6, 6), 103: (3, 3)})
    assert "known = cierre de la vela" in fallas(ev("AP", 1, b, 102, 103, known=b["t"] + 2 * TF_MS), ctx(a, b))
    assert DAY % TF_MS == 0
