"""Casos armados a mano del oráculo A de los elementos de velas, con el resultado en cada comentario.

Salvo que se diga otra cosa: velas de 1 hora (tf = 60), ATR fijo de 1 (``atrSource = 1.0``) para que
los umbrales en ATR se lean directo de los precios, y precios con fracciones exactas en binario
(0.5, 0.25, 0.125...) para que los bordes no dependan del redondeo. Velas: (o, h, l, c). Cada evento
se resume como (índice de la vela del elemento, dir, lo, hi).
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from elementos_a import (atr_series, element_params, events, patrones,  # noqa: E402
                         true_ranges, tramo)

TF = 60
STEP = TF * 60_000
DAY = 86_400_000
T0 = 1_704_067_200_000          # 2024-01-01 00:00 UTC
A = pytest.approx
ATR1 = {"atrSource": 1.0}
KEYS = {"code", "dir", "t", "known", "lo", "hi"}


def velas(*rows, tf=TF, vols=None, times=None):
    step = tf * 60_000
    return [{"t": T0 + i * step if times is None else times[i], "o": o, "h": h, "l": l, "c": c,
             "vol": 1.0 if vols is None else vols[i]} for i, (o, h, l, c) in enumerate(rows)]


def res(evs, tf=TF):
    """(índice, dir, lo, hi) de cada evento, con el índice sacado de t (velas sin huecos)."""
    step = tf * 60_000
    return [((e["t"] - T0) // step, e["dir"], e["lo"], e["hi"]) for e in evs]


# ------------------------------------------------------------------------------------ ATR

def test_rango_verdadero_y_atr_a_mano():
    # TR: v0 11-9 = 2; v1 máx(2, |12-10| = 2, |10-10| = 0) = 2; v2 máx(1, 0.5, 0.5) = 1;
    # v3 máx(1.5, |14-11| = 3, |12.5-11| = 1.5) = 3 (abre con salto); v4 máx(1.5, 0.5, 1) = 1.5.
    # Máximo - mínimo: 2, 2, 1, 1.5, 1.5.
    b = velas((10, 11, 9, 10), (10, 12, 10, 11), (11, 11.5, 10.5, 11), (13, 14, 12.5, 13.5),
              (13.5, 14, 12.5, 13))
    assert true_ranges(b) == [2, 2, 1, 3, 1.5]
    # Wilder de 3: arranca en la vela 2 con (2+2+1)/3 = 5/3; v3 (5/3·2 + 3)/3 = 19/9;
    # v4 (19/9·2 + 1.5)/3 = 51.5/27.
    w = atr_series(b, "wilder", 3)
    assert w[:2] == [None, None]
    assert w[2:] == [A(5 / 3), A(19 / 9), A(51.5 / 27)]
    # media simple de los rangos verdaderos: 5/3, (2+1+3)/3 = 2, (1+3+1.5)/3 = 5.5/3
    assert atr_series(b, "sma", 3)[2:] == [A(5 / 3), A(2.0), A(5.5 / 3)]
    # media simple de máximo - mínimo: 5/3, (2+1+1.5)/3 = 1.5, (1+1.5+1.5)/3 = 4/3
    assert atr_series(b, "sma_hl", 3)[2:] == [A(5 / 3), A(1.5), A(4 / 3)]
    # un ATR fijo, o una lista: lo que no es positivo queda sin ATR
    assert atr_series(b, 2.5) == [2.5] * 5
    assert atr_series(b, [1, None, 0, -1, 2]) == [1.0, None, None, None, 2.0]
    # Wilder de 14 con 5 velas: todavía no hay ATR
    assert atr_series(b) == [None] * 5
    with pytest.raises(ValueError):
        atr_series(b, [1, 2])


# ------------------------------------------------------------------------------------ FV

FV_BARS = velas((100, 101, 99, 100.5),         # 0
                (100.5, 103, 100.5, 102.75),   # 1
                (102.75, 104, 101.5, 103.5),   # 2: alcista, l2 - h0 = 101.5 - 101 = 0.5
                (103.5, 103.75, 101.25, 101.5),  # 3: nada (l3 < h1, h3 > l1)
                (101.25, 101.375, 100, 100.25),  # 4: bajista, l2 - h4 = 101.5 - 101.375 = 0.125
                (100.25, 101, 99, 99.5),       # 5: bajista, l3 - h5 = 101.25 - 101 = 0.25
                (99.5, 99.5, 98, 98.25))       # 6: bajista, l4 - h6 = 100 - 99.5 = 0.5


@pytest.mark.parametrize("min_atr, esperado", [
    # de fábrica (0.3): los huecos de 0.5 (velas 2 y 6); los de 0.125 y 0.25 no llegan
    (None, [(2, 1, 101, 101.5), (6, -1, 99.5, 100)]),
    # 0.25: también el de 0.25, con igualdad ("de al menos")
    (0.25, [(2, 1, 101, 101.5), (5, -1, 101, 101.25), (6, -1, 99.5, 100)]),
    # 0: cualquier hueco positivo, también el de 0.125
    (0.0, [(2, 1, 101, 101.5), (4, -1, 101.375, 101.5), (5, -1, 101, 101.25),
           (6, -1, 99.5, 100)]),
    # 0.5: los de 0.5 con igualdad; 0.75: ninguno
    (0.5, [(2, 1, 101, 101.5), (6, -1, 99.5, 100)]),
    (0.75, []),
])
def test_fv_alcista_bajista_y_el_minimo_en_atr(min_atr, esperado):
    p = dict(ATR1)
    if min_atr is not None:
        p["minAtr"] = min_atr
    evs = events("FV", FV_BARS, TF, p)
    assert res(evs) == esperado
    for e in evs:   # se conoce al cerrar la vela que deja el hueco
        assert e["code"] == "FV" and e["known"] == e["t"] + STEP


def test_fv_usa_el_atr_de_la_vela_que_deja_el_hueco():
    # ATR 1 en todas salvo la vela 6, con 2: su hueco de 0.5 no llega a 0.3 · 2 = 0.6 (con el ATR
    # de la vela anterior, 1, sí llegaría). La vela 2 sigue: 0.5 ≥ 0.3 · 1.
    p = {"atrSource": [1.0] * 6 + [2.0]}
    assert res(events("FV", FV_BARS, TF, p)) == [(2, 1, 101, 101.5)]


def test_fv_con_el_atr_de_wilder_sin_atr_no_hay_evento():
    # Todas las velas tienen rango verdadero 1, así que el ATR de Wilder de 14 vale 1 desde la vela
    # 13 (antes no hay). Dos huecos alcistas de 0.5: en la vela 6 (l6 101 - h4 100.5), sin ATR
    # todavía, y en la 16 (l16 102.5 - h14 102), con ATR 1. Los demás pares no dejan hueco: la 7
    # toca la 5 (l7 101 = h5 101, hueco 0) y la 17 toca la 15 (102.5 = 102.5).
    flat0 = (100, 100.5, 99.5, 100)
    flat1 = (101.5, 102, 101, 101.5)
    b = velas(*([flat0] * 5), (100, 101, 100, 101), (101, 102, 101, 101.5), *([flat1] * 8),
              (101.5, 102.5, 101.5, 102.5), (102.5, 103.5, 102.5, 103), (103, 103.5, 102.5, 103))
    assert true_ranges(b) == [1.0] * 18
    a = atr_series(b)
    assert a[:13] == [None] * 13 and a[13:] == [1.0] * 5
    assert res(events("FV", b, TF)) == [(16, 1, 102, 102.5)]
    # con hueco mínimo 0 no hace falta ATR: entra también la 6
    assert res(events("FV", b, TF, {"minAtr": 0})) == [(6, 1, 100.5, 101), (16, 1, 102, 102.5)]
    # con un ATR de 5 velas hay ATR (1) desde la vela 4: entra la 6 con 0.5 ≥ 0.3
    assert res(events("FV", b, TF, {"atrPeriod": 5})) == [(6, 1, 100.5, 101),
                                                          (16, 1, 102, 102.5)]
    # la media simple de 14 da lo mismo que Wilder aquí (todos los rangos valen 1)
    assert res(events("FV", b, TF, {"atrSource": "sma"})) == [(16, 1, 102, 102.5)]


# ------------------------------------------------------------------------------------ IM

# Cierres: 100, 100.5, 101, 102, 103, 103.5, 103.5, 105.5, 104, 101.5, 101.
IM_BARS = velas((100, 100.25, 99.75, 100),       # 0
                (100, 100.75, 99.75, 100.5),     # 1
                (100.5, 101.25, 100.25, 101),    # 2
                (101, 102.25, 100.75, 102),      # 3
                (102, 103.25, 101.75, 103),      # 4
                (103, 103.75, 102.75, 103.5),    # 5
                (103.5, 103.75, 103.25, 103.5),  # 6
                (103.5, 105.75, 103.25, 105.5),  # 7
                (105.5, 105.75, 103.75, 104),    # 8
                (104, 104.25, 101.25, 101.5),    # 9
                (101.5, 101.75, 100.75, 101))    # 10


def test_im_un_evento_al_empezar_y_su_zona():
    # N = 3, 2 ATR (ATR 1). Avance c[i] - c[i-3]: v3 +2 (cumple, con igualdad), v4 +2.5, v5 +2.5,
    # v6 +1.5, v7 +2.5, v8 +0.5, v9 -2 (cumple bajista), v10 -4.5.
    # Comienzos (la anterior no cumplía): v3 (la v2 no tiene 3 velas antes), v7 y v9.
    # Zonas, de las velas i-2 a i: v3 → mín(99.75, 100.25, 100.75) = 99.75 y máx(100.75, 101.25,
    # 102.25) = 102.25; v7 → velas 5 a 7: 102.75 y 105.75; v9 → velas 7 a 9: 101.25 y 105.75.
    evs = events("IM", IM_BARS, TF, ATR1)
    assert res(evs) == [(3, 1, 99.75, 102.25), (7, 1, 102.75, 105.75), (9, -1, 101.25, 105.75)]
    assert all(e["known"] == e["t"] + STEP for e in evs)


def test_im_alto_minimo_de_la_vela_del_comienzo():
    # range 2: la vela del comienzo tiene que medir 2 ATR o más. v3 mide 102.25 - 100.75 = 1.5 →
    # no; v4 no es comienzo (la v3 cumplía) → ese impulso no da evento. v7 mide 2.5 y v9 mide 3 → sí.
    assert res(events("IM", IM_BARS, TF, {**ATR1, "range": 2})) == [(7, 1, 102.75, 105.75),
                                                                    (9, -1, 101.25, 105.75)]
    # range 1.5: v3 mide justo 1.5 → entra (con igualdad)
    assert len(events("IM", IM_BARS, TF, {**ATR1, "range": 1.5})) == 3


def test_im_otro_multiplo_y_otra_cantidad_de_velas():
    # 2.5 ATR en 3 velas: cumplen v4 (+2.5), v5 (+2.5), v7 (+2.5) y v10 (-4.5); v3 (+2) y v9 (-2) ya
    # no. Comienzos: v4 (la v3 no cumple), v7 y v10 (la v9 no cumple).
    # Zonas: v4 → velas 2 a 4: 100.25 y 103.25; v10 → velas 8 a 10: 100.75 y 105.75.
    p = {**ATR1, "im": {"bars": 3, "atr": 2.5}}
    assert res(events("IM", IM_BARS, TF, p)) == [(4, 1, 100.25, 103.25), (7, 1, 102.75, 105.75),
                                                 (10, -1, 100.75, 105.75)]
    # 2 ATR en 2 velas: c[i] - c[i-2] = v2 +1, v3 +1.5, v4 +2, v5 +1.5, v6 +0.5, v7 +2, v8 +0.5,
    # v9 -4, v10 -3. Comienzos: v4, v7 y v9. Zonas de las velas i-1 a i: v4 → 100.75 y 103.25;
    # v7 → 103.25 y 105.75; v9 → 101.25 y 105.75.
    p = {**ATR1, "im": {"bars": 2, "atr": 2.0}}
    assert res(events("IM", IM_BARS, TF, p)) == [(4, 1, 100.75, 103.25), (7, 1, 103.25, 105.75),
                                                 (9, -1, 101.25, 105.75)]


def test_im_usa_el_atr_de_su_vela():
    # ATR 1 salvo en la vela 3, con 1.25: su avance de 2 no llega a 2 · 1.25 = 2.5 (con el ATR de
    # la vela anterior sí llegaría). La vela 4 (+2.5 con ATR 1) pasa a ser el comienzo, con la zona
    # de las velas 2 a 4: 100.25 y 103.25. Las de la 7 y la 9 no cambian.
    p = {"atrSource": [1.0, 1.0, 1.0, 1.25] + [1.0] * 7}
    assert res(events("IM", IM_BARS, TF, p)) == [(4, 1, 100.25, 103.25), (7, 1, 102.75, 105.75),
                                                 (9, -1, 101.25, 105.75)]


def test_im_sin_atr_no_hay_impulso():
    # con el ATR de Wilder de 14 y 11 velas no hay ATR todavía
    assert events("IM", IM_BARS, TF) == []


# ------------------------------------------------------------------------------------ SP

def _hl(*pares, vols=None, times=None):
    """Velas con apertura y cierre en el medio, a partir de (máximo, mínimo)."""
    return velas(*[((h + l) / 2, h, l, (h + l) / 2) for h, l in pares], vols=vols, times=times)


def test_sp_unico_extremo_empates_y_cuando_se_conoce():
    # N = 2. Mínimos: 10, 9, 8, 9, 10, 9, 9, 10, 11; máximos: 11, 10.5, 10, 10.5, 12, 11, 10.5,
    # 11, 11.5. Solo se miran p = 2..6 (ventana entera).
    # p = 2: mínimo 8, único de [0, 4] → alcista, se conoce al cerrar la vela 4 (t de la 4 + 1 h).
    # p = 4: máximo 12, único de [2, 6] → bajista, se conoce al cerrar la vela 6.
    # p = 5 y p = 6: mínimo 9 empatado entre las dos (y con la 3) → no son swing.
    b = _hl((11, 10), (10.5, 9), (10, 8), (10.5, 9), (12, 10), (11, 9), (10.5, 9), (11, 10),
            (11.5, 11))
    evs = events("SP", b, TF, {"bars": 2})
    assert res(evs) == [(2, 1, 8, 10), (4, -1, 10, 12)]
    assert [e["known"] for e in evs] == [T0 + 5 * STEP, T0 + 7 * STEP]


def test_sp_de_fabrica_se_conoce_cinco_velas_despues():
    # N = 5, una V de 11 velas con el mínimo (7) en la vela 5: único de [0, 10]. Se conoce al cerrar
    # la vela 10: 6 velas después de abrir la del swing ("la entrada queda 6 velas después").
    # Los máximos (mínimo + 1) no tienen swing: p = 5 es la única con ventana entera y es el menor.
    mins = [10, 9.5, 9, 8.5, 8, 7, 8, 8.5, 9, 9.5, 10]
    b = _hl(*[(m + 1, m) for m in mins])
    evs = events("SP", b, TF)
    assert res(evs) == [(5, 1, 7, 8)]
    assert evs[0]["known"] - evs[0]["t"] == 6 * STEP
    # con un hueco de 3 horas entre la 7 y la 8 se siguen contando velas de la lista: se conoce al
    # cerrar la vela 10, que ahora abre en T0 + 13 h
    tt = [T0 + i * STEP for i in range(8)] + [T0 + (i + 3) * STEP for i in range(8, 11)]
    evs = events("SP", _hl(*[(m + 1, m) for m in mins], times=tt), TF)
    assert [(e["t"], e["known"]) for e in evs] == [(T0 + 5 * STEP, T0 + 14 * STEP)]


def test_sp_con_volumen_z():
    # N = 2, 25 velas. Todas con mínimo 10 y máximo 11 (empatadas: no son swing), salvo la 22, con
    # mínimo 9 y máximo 10.5: swing alcista. Volúmenes: 1 en las pares y 3 en las impares hasta la
    # 21; la 22 tiene 3.5. Las 20 anteriores a la 22 (2 a 21): diez de 1 y diez de 3 → media 2,
    # desviación poblacional 1 → z = (3.5 - 2) / 1 = 1.5.
    pares = [(11, 10)] * 22 + [(10.5, 9), (11, 10), (11, 10)]
    vols = [1 if i % 2 == 0 else 3 for i in range(22)] + [3.5, 1, 1]
    b = _hl(*pares, vols=vols)
    assert res(events("SP", b, TF, {"bars": 2})) == [(22, 1, 9, 10.5)]
    assert len(events("SP", b, TF, {"sp": {"bars": 2, "minZ": 1}})) == 1
    # z ≥ 1.5 con igualdad (con la desviación muestral el z sería 1.462 y no pasaría)
    assert len(events("SP", b, TF, {"sp": {"bars": 2, "minZ": 1.5}})) == 1
    assert events("SP", b, TF, {"sp": {"bars": 2, "minZ": 1.6}}) == []


# ------------------------------------------------------------------------------------ VH

D_TF = 1440                         # velas de 1 día: todas abren a las 00:00 UTC
GREEN = (100, 101, 99.5, 100.5)
RED = (100.5, 101, 99.5, 100)
DOJI = (100.25, 101, 99.5, 100.25)


@pytest.mark.parametrize("v10, esperado", [
    (200, [(10, 1, 99.5, 101)]),    # 200 ≥ 2 · 100: entra con igualdad
    (199.5, []),                    # no llega al doble
])
def test_vh_doble_de_la_media_de_su_hora_con_diez_dias(v10, esperado):
    # 11 velas diarias verdes; las 10 primeras con volumen 100. La vela 10 tiene 10 días de su hora
    # (las 10 anteriores, todas dentro de 30 días) y media 100. Las anteriores no tienen 10 días.
    b = velas(*([GREEN] * 11), tf=D_TF, vols=[100] * 10 + [v10])
    evs = events("VH", b, D_TF)
    assert res(evs, D_TF) == esperado
    assert all(e["known"] == e["t"] + DAY for e in evs)
    # con solo 9 días de historia no hay comparación, aunque el volumen sea enorme
    b9 = velas(*([GREEN] * 10), tf=D_TF, vols=[100] * 9 + [1000])
    assert events("VH", b9, D_TF) == []


def test_vh_ventana_de_treinta_dias_doji_y_color():
    # Velas diarias: 0 a 3 con volumen 1000, 4 a 33 con 100 (todas verdes).
    # Vela 34 (verde, 200): su ventana empieza 30 días antes, en la vela 4 (incluida): velas 4 a 33,
    # media 100 → 200 ≥ 200 → alcista. Si entrara la vela 3 (31 días) la media sería
    # (1000 + 30·100)/31 = 129 y no habría evento.
    # Vela 35: doji (c == o) con volumen 5000 → no cuenta.
    # Vela 36 (roja, 540): ventana 6 a 35 → 28·100 + 200 + 5000 = 8000 / 30 = 266.67; el doble es
    # 533.33 → 540 entra, bajista.
    # Las velas 10 a 33 (100) tienen medias de 100 o más con los 1000 → no llegan al doble.
    rows = [GREEN] * 35 + [DOJI, RED]
    vols = [1000] * 4 + [100] * 30 + [200, 5000, 540]
    assert res(events("VH", velas(*rows, tf=D_TF, vols=vols), D_TF), D_TF) == [
        (34, 1, 99.5, 101), (36, -1, 99.5, 101)]
    # la roja con 530 no llega
    vols[-1] = 530
    assert res(events("VH", velas(*rows, tf=D_TF, vols=vols), D_TF), D_TF) == [(34, 1, 99.5, 101)]


def test_vh_su_misma_hora_slot_o_la_hora_entera():
    # Velas de 30 minutos, todas verdes: las de :00 con volumen 100 y las de :30 con 300, durante 11
    # días, y el día 11 hasta las 05:30 (vela 539) con volumen 450.
    # "slot" (de fábrica): la 05:30 se compara con las 05:30 de los 11 días anteriores (300 cada
    # una, media 300) → 450 < 600 → nada. Ninguna otra vela pasa del doble de su hora.
    # "hour": con las 05:00 y 05:30 de los 11 días anteriores (22 velas, media 200) → 450 ≥ 400 →
    # alcista. Las demás: las :30 (300) contra 200 no llegan a 400.
    tf = 30
    n = 11 * 48 + 12
    rows = [GREEN] * n
    vols = [100 if i % 2 == 0 else 300 for i in range(n)]
    vols[-1] = 450
    b = velas(*rows, tf=tf, vols=vols)
    assert events("VH", b, tf) == []
    assert res(events("VH", b, tf, {"hourKey": "hour"}), tf) == [(n - 1, 1, 99.5, 101)]


# ------------------------------------------------------------------------------------ RF

# Velas diarias, ATR 1, el tramo gira a 2 ATR. Volúmenes: 100 salvo v6 250, v7 300, v9 220 y v10 500.
RF_ROWS = [(100, 100.5, 99.5, 100),         # 0 (sin color)
           (100, 101, 99.75, 100.75),       # 1
           (100.75, 101.5, 100.5, 101.25),  # 2
           (101.25, 102, 101, 101.75),      # 3: c 101.75 ≥ mín 99.5 + 2 → tramo alcista
           (101.75, 102.5, 101.5, 102.25),  # 4
           (102.25, 103, 102, 102.75),      # 5
           (102.75, 103.5, 102.5, 103.25),  # 6: verde, 250
           (103.25, 103.5, 102.25, 102.5),  # 7: roja, 300
           (102.5, 102.75, 101, 101.25),    # 8: c 101.25 ≤ máx 103.5 - 2 → gira a bajista
           (101.25, 101.5, 100, 100.25),    # 9: roja, 220
           (100.25, 102.75, 100.25, 102.5)]  # 10: verde, 500; c 102.5 ≥ mín 100 + 2 → gira a alcista
RF_VOLS = [100, 100, 100, 100, 100, 100, 250, 300, 100, 220, 500]


def test_tramo_zigzag_a_mano():
    # Sin tramo hasta la vela 3: el máximo sube a 102 y el cierre 101.75 queda 2.25 sobre el mínimo
    # 99.5 → alcista; extremo = máx de las velas 1 a 3 = 102. Sube el extremo a 103.5 (vela 6; la 7
    # empata y no lo mueve). Vela 8: 101.25 ≤ 103.5 - 2 → bajista; extremo = mín de las velas 7 y 8 =
    # 101. Vela 9: el extremo baja a 100. Vela 10: 102.5 ≥ 100 + 2 → alcista.
    b = velas(*RF_ROWS, tf=D_TF, vols=RF_VOLS)
    assert tramo(b, 2.0, 1.0) == [0, 0, 0, 1, 1, 1, 1, 1, -1, -1, 1]
    # sin ATR (Wilder de 14 con 11 velas) no hay tramo
    assert tramo(b, 2.0) == [0] * 11


@pytest.mark.parametrize("arrow, esperado", [
    # a favor del tramo: v6 (verde, tramo alcista), v9 (roja, bajista) y v10 (verde: su cierre
    # hace girar el tramo a alcista y ya cuenta el tramo nuevo)
    ("with", [(6, 1, 102.5, 103.5), (9, -1, 100, 101.5), (10, 1, 100.25, 102.75)]),
    ("a favor del tramo", [(6, 1, 102.5, 103.5), (9, -1, 100, 101.5), (10, 1, 100.25, 102.75)]),
    # en contra: v7 (roja en tramo alcista)
    ("against", [(7, -1, 102.25, 103.5)]),
    ("en contra", [(7, -1, 102.25, 103.5)]),
    # cualquiera: las cuatro
    ("any", [(6, 1, 102.5, 103.5), (7, -1, 102.25, 103.5), (9, -1, 100, 101.5),
             (10, 1, 100.25, 102.75)]),
    ("cualquiera", [(6, 1, 102.5, 103.5), (7, -1, 102.25, 103.5), (9, -1, 100, 101.5),
                    (10, 1, 100.25, 102.75)]),
])
def test_rf_mediana_de_su_hora_y_lado_del_tramo(arrow, esperado):
    # Medianas de los días anteriores (todas las velas abren a las 00:00 y caben en 30 días):
    # v5: 5 días de 100 → mediana 100, v5 = 100 no llega a 200.
    # v6: seis de 100 → 100; 250 ≥ 200 → flecha.
    # v7: seis de 100 y 250 → 100; 300 → flecha.
    # v8: seis de 100, 250 y 300 (8) → (100 + 100)/2 = 100; 100 no.
    # v9: siete de 100, 250 y 300 (9) → 100; 220 ≥ 200 → flecha. (Con la media, 1250/9 = 138.9, el
    #     doble es 277.8 y no habría flecha: es la mediana.)
    # v10: siete de 100, 250, 300 y 220 (10) → (100 + 100)/2 = 100; 500 → flecha.
    # Las velas 1 a 4 tienen menos de 5 días.
    b = velas(*RF_ROWS, tf=D_TF, vols=RF_VOLS)
    evs = events("RF", b, D_TF, {**ATR1, "rv": {"leg": 2, "spike": 2, "arrow": arrow}})
    assert res(evs, D_TF) == esperado
    assert all(e["known"] == e["t"] + DAY for e in evs)


def test_rf_pide_cinco_dias_de_su_hora():
    # Las 6 primeras velas, con 1000 en la 4 y la 5 (las dos verdes y en tramo alcista).
    # v4: 4 días antes → no. v5: 5 días (100, 100, 100, 100, 1000) → mediana 100 → flecha.
    b = velas(*RF_ROWS[:6], tf=D_TF, vols=[100, 100, 100, 100, 1000, 1000])
    assert res(events("RF", b, D_TF, ATR1), D_TF) == [(5, 1, 102, 103)]
    # con el doble de volumen exigido de 12 veces no llega (1000 < 1200)
    assert events("RF", b, D_TF, {**ATR1, "rv": {"spike": 12}}) == []


def test_rf_lado_desconocido():
    with pytest.raises(ValueError):
        events("RF", velas(*RF_ROWS, tf=D_TF), D_TF, {"rv": {"arrow": "arriba"}})


# ------------------------------------------------------------------------------------ patrones

NEUTRA_VERDE = (99, 100.5, 98.5, 100)      # cuerpo 1 de 2: no es patrón
NEUTRA_ROJA = (102, 102.5, 100.5, 101)


@pytest.mark.parametrize("prev, cur, esperado", [
    # Libélula: rango 4, cuerpo 0, mecha de arriba 0.25 (6.25% ≤ 10%) → DJ alcista
    (NEUTRA_VERDE, (100, 100.25, 96.25, 100), ("DJ", 1)),
    # Lápida: rango 4, cuerpo 0, mecha de abajo 0.25 → DJ bajista
    (NEUTRA_VERDE, (100, 103.75, 99.75, 100), ("DJ", -1)),
    # Doji de mechas largas (2 y 2 de 4): ni libélula ni lápida → nada
    (NEUTRA_VERDE, (100, 102, 98, 100), None),
    # Martillo: rango 4.25, cuerpo 1 (23.5%), mecha de abajo 3 ≥ 2 cuerpos, arriba 0.25 (5.9%).
    # La anterior es verde: no hay envolvente.
    (NEUTRA_VERDE, (100, 101.25, 97, 101), ("HM", 1)),
    # Estrella fugaz: roja, cuerpo 1, mecha de arriba 3, abajo 0.25; la anterior roja.
    (NEUTRA_ROJA, (101, 104, 99.75, 100), ("HM", -1)),
    # Envolvente alcista: anterior roja (cuerpo 1 de 2); actual verde, cuerpo 1.75 de 2.25 (78%),
    # abre en 99.75 ≤ 100 y cierra en 101.5 ≥ 101.
    ((101, 101.5, 99.5, 100), (99.75, 101.75, 99.5, 101.5), ("EN", 1)),
    # Envolvente bajista: anterior verde (100 → 101); actual roja 101.25 → 99.5.
    ((100, 101.5, 99.5, 101), (101.25, 101.5, 99.25, 99.5), ("EN", -1)),
    # Abre en el cierre anterior (empate en el borde vale): 100 → 101.25 cubre 101 → 100.
    ((101, 101.5, 99.5, 100), (100, 101.5, 99.75, 101.25), ("EN", 1)),
    # Cuerpos iguales (1 y 1): "el cuerpo más grande" no se cumple; tampoco es martillo (67%).
    ((101, 101.5, 99.5, 100), (100, 101.25, 99.75, 101), None),
    # La anterior casi sin cuerpo (0.25 de 4 = 6.25% < 10%): no hay envolvente.
    ((100.25, 102, 98, 100), (99.75, 101, 99.5, 100.75), None),
    # Vela sin rango
    (NEUTRA_VERDE, (100, 100, 100, 100), None),
])
def test_patrones_formas(prev, cur, esperado):
    evs = patrones(velas(prev, cur), TF, trend=False)
    got = [(e["code"], e["dir"]) for e in evs]
    assert got == ([] if esperado is None else [esperado])
    for e in evs:   # la zona es la vela, y se conoce al cerrarla
        assert e["t"] == T0 + STEP and e["known"] == T0 + 2 * STEP
        assert (e["lo"], e["hi"]) == (cur[2], cur[1])


def test_patrones_un_patron_por_vela():
    sin_tendencia = {"pat": {"trend": False}}
    # Envolvente con forma de martillo: rango 4, cuerpo 1.25 (31.25%: ≥ 30% y ≤ 33%), mecha de
    # abajo 2.5 = 2 cuerpos, arriba 0.25; cubre la anterior roja (101 → 100) con 100 → 101.25.
    # Primero la envolvente: con "Martillo o estrella" sola no se ve.
    b = velas((101, 101.25, 99.75, 100), (100, 101.5, 97.5, 101.25))
    assert [(e["code"], e["dir"]) for e in events("EN", b, TF, sin_tendencia)] == [("EN", 1)]
    assert events("HM", b, TF, sin_tendencia) == []
    # La libélula también tiene forma de martillo (cuerpo 0): primero el doji.
    b = velas(NEUTRA_VERDE, (100, 100.25, 96.25, 100))
    assert events("HM", b, TF, sin_tendencia) == []
    assert len(events("DJ", b, TF, sin_tendencia)) == 1


def test_patrones_mecha_en_cuerpos():
    # El martillo de rango 4.25 tiene la mecha de abajo de 3 cuerpos: pasa con wick 3, no con 3.5.
    b = velas(NEUTRA_VERDE, (100, 101.25, 97, 101))
    assert len(events("HM", b, TF, {"pat": {"trend": False, "wick": 3}})) == 1
    assert events("HM", b, TF, {"pat": {"trend": False, "wick": 3.5}}) == []


# Bajada: velas rojas de cuerpo 0.5 y rango 1, cierres 105, 104.5, 104, 103.5, 103, 102.5.
BAJA = [(105.5 - 0.5 * k, 105.75 - 0.5 * k, 104.75 - 0.5 * k, 105 - 0.5 * k) for k in range(6)]
# Subida: velas verdes de cuerpo 0.5 y rango 1, cierres 100, 100.5, 101, 101.5, 102, 102.5.
SUBE = [(99.5 + 0.5 * k, 100.25 + 0.5 * k, 99.25 + 0.5 * k, 100 + 0.5 * k) for k in range(6)]
# Martillo verde tras 102.5: cuerpo 0.25 de 1.0625 (23.5%), abajo 0.75 (3 cuerpos), arriba 0.0625.
MARTILLO = (102.5, 102.8125, 101.75, 102.75)
# Estrella roja tras 102.5: cuerpo 0.25 de 1.0625, arriba 0.75, abajo 0.0625.
ESTRELLA = (102.75, 103.5, 102.4375, 102.5)


def test_patrones_tendencia_previa():
    # Tras la bajada: c5 = 102.5 < c0 = 105 → el martillo de la vela 6 pasa. Las velas de la bajada
    # no son patrón (todas rojas, cuerpo 50%), y el martillo no envuelve a la 5 (cuerpo 0.25 < 0.5).
    assert res(events("HM", velas(*BAJA, MARTILLO), TF)) == [(6, 1, 101.75, 102.8125)]
    # Tras la subida: c5 = 102.5 no está bajo c0 = 100 → el martillo no pasa; sin tendencia, sí.
    assert events("HM", velas(*SUBE, MARTILLO), TF) == []
    assert len(events("HM", velas(*SUBE, MARTILLO), TF, {"pat": {"trend": False}})) == 1
    # La estrella tras la subida: c5 = 102.5 > c0 = 100 → pasa.
    assert res(events("HM", velas(*SUBE, ESTRELLA), TF)) == [(6, -1, 102.4375, 103.5)]
    # Con 3 velas de tendencia (trendBars 2: c5 contra c3): bajada 102.5 < 103.5 → pasa; subida
    # 102.5 < 101.5 no.
    p2 = {"pat": {"trendBars": 2}}
    assert len(events("HM", velas(*BAJA, MARTILLO), TF, p2)) == 1
    assert events("HM", velas(*SUBE, MARTILLO), TF, p2) == []


def test_patrones_tendencia_sin_velas_suficientes():
    # El martillo en la vela 5: haría falta el cierre de la vela -1 → no pasa.
    martillo5 = (103, 103.3125, 102.25, 103.25)     # misma forma, tras c4 = 103
    assert events("HM", velas(*BAJA[:5], martillo5), TF) == []
    assert len(events("HM", velas(*BAJA[:5], martillo5), TF, {"pat": {"trend": False}})) == 1


def test_patrones_la_forma_decide_antes_que_la_tendencia():
    # Subida de 6 velas verdes de cuerpo 0.5 (cierres 100 a 105); vela 6 roja 105.25 → 104.75 (no
    # cubre el cuerpo de la 5: no es envolvente); vela 7 verde 104.75 → 105.375 con máximo 106.625 y
    # mínimo 104.625: rango 2, cuerpo 0.625 (31.25%), arriba 1.25 = 2 cuerpos, abajo 0.125. Es
    # envolvente alcista de la 6 y también tiene forma de estrella fugaz (bajista).
    sube = [(99.5 + k, 100.25 + k, 99.25 + k, 100 + k) for k in range(6)]
    b = velas(*sube, (105.25, 105.5, 104.5, 104.75), (104.75, 106.625, 104.625, 105.375))
    sin = {"pat": {"trend": False}}
    assert [(e["code"], e["dir"]) for e in patrones(b, TF, trend=False)] == [("EN", 1)]
    assert events("HM", b, TF, sin) == []
    # Con tendencia: la envolvente alcista pide c6 = 104.75 < c1 = 101 → no pasa, y la vela no se
    # vuelve a mirar como estrella (que sí pasaría la tendencia: 104.75 > 101).
    assert patrones(b, TF) == []


def test_patrones_volumen_z():
    # 20 velas verdes iguales (no son patrón; verde tras verde no es envolvente) con volumen 1 en
    # las pares y 3 en las impares (media 2, desviación poblacional 1), y el martillo de rango 4.25
    # en la vela 20 con volumen 4 → z = (4 - 2) / 1 = 2.
    neutra = (100, 100.75, 99.75, 100.5)
    vols = [1 if i % 2 == 0 else 3 for i in range(20)] + [4]
    b = velas(*([neutra] * 20), (100, 101.25, 97, 101), vols=vols)
    sin = {"trend": False}
    assert res(events("HM", b, TF, {"pat": {**sin, "minZ": 2}})) == [(20, 1, 97, 101.25)]
    assert events("HM", b, TF, {"pat": {**sin, "minZ": 2.5}}) == []
    # con 19 velas antes no hay z: no pasa ni con un mínimo de -3
    b19 = velas(*([neutra] * 19), (100, 101.25, 97, 101), vols=vols[1:])
    assert events("HM", b19, TF, {"pat": {**sin, "minZ": -3}}) == []
    assert len(events("HM", b19, TF, {"pat": sin})) == 1


# ------------------------------------------------------------------------------------ despacho

def test_eventos_con_sus_campos_y_detalle():
    evs = events("FV", FV_BARS, TF, ATR1)
    assert evs and all(set(e) == KEYS for e in evs)
    det = events("FV", FV_BARS, TF, ATR1, detail=True)
    assert [(e["i"], e["known_i"]) for e in det] == [(2, 2), (6, 6)]
    assert det[0]["info"]["gap"] == 0.5 and det[0]["info"]["atr"] == 1.0
    # de SP, la vela con que se conoce es la última de su derecha
    b = _hl((11, 10), (10.5, 9), (10, 8), (10.5, 9), (12, 10), (11, 9), (10.5, 9))
    assert [(e["i"], e["known_i"]) for e in events("SP", b, TF, {"bars": 2}, detail=True)] == [
        (2, 4), (4, 6)]


def test_parametros_de_fabrica_y_del_grupo_de_la_regla():
    _, p = element_params("IM")
    assert (p["bars"], p["atr"], p["range"], p["atrSource"]) == (3, 2.0, None, "wilder")
    # los del grupo ("im") van encima de los sueltos; lo que no es del elemento se ignora
    _, p = element_params("IM", {"bars": 4, "im": {"bars": 5, "range": 1.5}, "entry": {}})
    assert (p["bars"], p["range"]) == (5, 1.5)
    _, p = element_params("hm", {"pat": {"trend": False, "trendBars": 7}})
    assert (p["trend"], p["trendBars"], p["wick"], p["minZ"]) == (False, 7, 2.0, None)
    _, p = element_params("RF")
    assert (p["leg"], p["spike"], p["arrow"], p["minDays"]) == (2.0, 2.0, "with", 5)
    _, p = element_params("VH")
    assert (p["mult"], p["days"], p["minDays"], p["hourKey"]) == (2.0, 30, 10, "slot")
    assert element_params("FV")[1]["minAtr"] == 0.3 and element_params("SP")[1]["bars"] == 5
    with pytest.raises(ValueError):
        events("XX", FV_BARS, TF)


def test_velas_fuera_de_orden():
    b = velas(GREEN, GREEN, GREEN)
    b[2]["t"] = b[1]["t"]
    with pytest.raises(ValueError):
        events("FV", b, TF)
