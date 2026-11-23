"""Casos armados a mano del oráculo A de los filtros de Williams y del horario (filtros_a2.py), con el resultado
esperado calculado en el comentario de cada uno.

Velas de 4 horas (tf = 240) desde el 01/01/2024 00:00 UTC (T0, un lunes), salvo que se diga otra cosa. Cada vela es
(o, h, l, c) con volumen 1, o (o, h, l, c, vol). La vela i abre en T0 + i·4h y cierra en T0 + (i+1)·4h.
Las series empiezan con la primera vela de la lista, como las de una fase.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import filtros_a2 as fb  # noqa: E402
from filtros_a2 import (  # noqa: E402
    SUBE, BAJA, SeriesWilliams, atr_serie, direcciones, estado_alligator, evaluar_filtros, filtro_ac,
    filtro_alligator, filtro_ao, filtro_gator, filtro_horario, filtro_mfi, filtro_zona, gator_desde_lineas,
    rangos_verdaderos, series, tipos_mfi, veredicto_gator,
)

TF = 240
STEP = TF * 60_000
T0 = 1_704_067_200_000          # 2024-01-01 00:00 UTC, lunes
HORA = 3_600_000
DIA = 24 * HORA
A = pytest.approx


def velas(*filas, t0=T0, paso=STEP):
    out = []
    for i, f in enumerate(filas):
        o, h, l, c = f[:4]
        vol = f[4] if len(f) > 4 else 1.0
        out.append({"t": t0 + i * paso, "o": o, "h": h, "l": l, "c": c, "vol": vol})
    return out


def medios(*ms, ancho=1.0):
    """Velas con precio medio m: o = c = m, h = m + ancho, l = m − ancho."""
    return velas(*[(m, m + ancho, m - ancho, m) for m in ms])


def subida(n=60):
    """Precio medio 100 + i, con h = medio + 0.5, l = medio − 0.5 y cierre en el medio."""
    return medios(*[100 + i for i in range(n)], ancho=0.5)


def una_vela(apertura_ms, tf=TF):
    """Una sola vela (k = 0) que abre en `apertura_ms`."""
    return velas((100, 101, 99, 100), t0=apertura_ms, paso=tf * 60_000)


# ------------------------------------------------------------------ piezas

def test_config_de_fabrica():
    # Los números de defaultWilliamsConfig: mandíbula 13/8, dientes 8/5, labios 5/3, abertura 0.5 ATR de 14, AO 5/34,
    # AC con la media de 5.
    c = fb.CONFIG
    assert (c["jaw"], c["teeth"], c["lips"], c["sleepAtr"], c["atr"]) == ((13, 8), (8, 5), (5, 3), 0.5, 14)
    assert (c["aoFast"], c["aoSlow"], c["acSignal"]) == (5, 34, 5)


def test_smma_sembrada_con_la_media_simple():
    # n = 3 sobre 1..6: s2 = (1+2+3)/3 = 2; s3 = (2·2 + 4)/3 = 8/3; s4 = (8/3·2 + 5)/3 = 31/9; s5 = (31/9·2 + 6)/3 = 116/27.
    s = fb._smma([1, 2, 3, 4, 5, 6], 3)
    assert s[:2] == [None, None]
    assert s[2:] == [A(2.0), A(8 / 3), A(31 / 9), A(116 / 27)]


def test_smma_sembrada_con_el_primer_valor():
    # Lectura alternativa: s0 = 1; s1 = (1·2 + 2)/3 = 4/3; s2 = (4/3·2 + 3)/3 = 17/9; s3 = (17/9·2 + 4)/3 = 70/27.
    # Se da desde la vela n − 1, como la sembrada con la media.
    s = fb._smma([1, 2, 3, 4, 5, 6], 3, "primera")
    assert s[:2] == [None, None] and s[2] == A(17 / 9) and s[3] == A(70 / 27)


def test_desplazar_lleva_el_valor_pasado_adelante():
    assert fb._desplazar([10, 20, 30, 40], 2) == [None, None, 10, 20]


def test_lineas_del_alligator_en_su_vela():
    # Precio medio 100 + i. Labios: SMMA 5 en la vela 4 = media(100..104) = 102, desplazada 3 → primera en la vela 7;
    # en la 8, (102·4 + 105)/5 = 102.6. Dientes: SMMA 8 en la 7 = media(100..107) = 103.5 → primera en la 12.
    # Mandíbula: SMMA 13 en la 12 = media(100..112) = 106 → primera en la 20.
    w = SeriesWilliams(subida(30))
    assert w.labios[6] is None and w.labios[7] == A(102.0) and w.labios[8] == A(102.6)
    assert w.dientes[11] is None and w.dientes[12] == A(103.5)
    assert w.mandibula[19] is None and w.mandibula[20] == A(106.0)


def test_lineas_del_alligator_en_una_subida_larga():
    # SMMA de n sobre una subida de 1 por vela, sembrada con la media: el retraso e = x − s arranca en (n − 1)/2 y va a
    # n − 1 multiplicando la distancia por (n − 1)/n en cada vela: e_i = (n − 1) − (n − 1)/2·((n − 1)/n)^(i − n + 1).
    # En la vela 59: mandíbula = SMMA13 de la 51, dientes = SMMA8 de la 54, labios = SMMA5 de la 56.
    w = SeriesWilliams(subida(60))
    mand = 151 - (12 - 6 * (12 / 13) ** 39)
    dien = 154 - (7 - 3.5 * (7 / 8) ** 47)
    lab = 156 - (4 - 2 * (4 / 5) ** 52)
    assert w.mandibula[59] == A(mand) and w.dientes[59] == A(dien) and w.labios[59] == A(lab)
    assert lab > dien > mand


def test_rango_verdadero():
    # 14 velas de 99 a 101 con cierre 100 (rango 2); la 14 salta: 105 a 107 con cierre 106 → máx(2, |107 − 100|,
    # |105 − 100|) = 7; la 15, de 105 a 107 con cierre anterior 106 → 2.
    b = velas(*[(100, 101, 99, 100)] * 14, (106, 107, 105, 106), (106, 107, 105, 106))
    assert rangos_verdaderos(b) == [2.0] * 14 + [7.0, 2.0]


def test_atr_en_sus_cinco_formas():
    # Rangos verdaderos 2 ×14, 7, 2 (ver arriba); máximo − mínimo siempre 2.
    b = velas(*[(100, 101, 99, 100)] * 14, (106, 107, 105, 106), (106, 107, 105, 106))
    sma = atr_serie(b, 14, "sma")
    # sma: primera en la vela 13 = 2; 14: (2·13 + 7)/14 = 33/14; 15: (33/14·13 + 2)/14 = 457/196.
    assert sma[12] is None and sma[13] == A(2.0) and sma[14] == A(33 / 14) and sma[15] == A(457 / 196)
    # sma1: sin la primera vela → primera en la 14 = media(TR 1..14) = (13·2 + 7)/14 = 33/14.
    sma1 = atr_serie(b, 14, "sma1")
    assert sma1[13] is None and sma1[14] == A(33 / 14)
    # primera: ATR_0 = 2 y Wilder desde ahí: 2 hasta la 13, 33/14 en la 14.
    pri = atr_serie(b, 14, "primera")
    assert pri[0] == A(2.0) and pri[13] == A(2.0) and pri[14] == A(33 / 14)
    # simple: media de los últimos 14 rangos verdaderos: en la 15, (12·2 + 7 + 2)/14 = 33/14 (Wilder da 457/196).
    sim = atr_serie(b, 14, "simple")
    assert sim[12] is None and sim[13] == A(2.0) and sim[15] == A(33 / 14)
    # rango: media de los máximo − mínimo: siempre 2.
    assert atr_serie(b, 14, "rango")[15] == A(2.0)


def test_direcciones_con_empate():
    # 1 → 2 sube; 2 → 2 empate: conserva "sube" (estricto: sin dirección); 2 → 1 baja. Un empate sin dirección
    # anterior no tiene dirección.
    assert direcciones([1, 2, 2, 1]) == [None, SUBE, SUBE, BAJA]
    assert direcciones([1, 2, 2, 1], "estricto") == [None, SUBE, None, BAJA]
    assert direcciones([5, 5, 6]) == [None, None, SUBE]
    assert direcciones([None, 1, 2]) == [None, None, SUBE]


# ------------------------------------------------------------------ estado del Alligator

def test_estado_alligator():
    # labios 105 > dientes 103 > mandíbula 100: abertura 5. Con ATR 4 el umbral es 2 → despierto al alza;
    # con ATR 12 el umbral es 6 → dormido; con ATR 10 el umbral es 5 justo → despierto ("al menos").
    assert estado_alligator(105, 103, 100, 4) == (SUBE, A(5.0))
    assert estado_alligator(105, 103, 100, 12) == (0, A(5.0))
    assert estado_alligator(105, 103, 100, 10) == (SUBE, A(5.0))
    # Al revés, despierto a la baja; desordenado o con líneas iguales, dormido; sin ATR, sin dato.
    assert estado_alligator(100, 103, 105, 4) == (BAJA, A(5.0))
    assert estado_alligator(105, 99, 100, 1)[0] == 0
    assert estado_alligator(100, 100, 100, 1) == (0, 0)
    assert estado_alligator(105, 103, 100, None) == (None, None)


def test_estado_alligator_abertura_minima():
    # labios 105, dientes 104.5, mandíbula 100, ATR 4 (umbral 2): la abertura total (5) despierta; la mínima entre
    # líneas vecinas (0.5) no.
    assert estado_alligator(105, 104.5, 100, 4)[0] == SUBE
    assert estado_alligator(105, 104.5, 100, 4, abertura="minima") == (0, A(0.5))


# ------------------------------------------------------------------ filtro del Alligator

def test_alligator_despierto_en_una_subida():
    # En la vela 59 de la subida: labios ≈ 152 > dientes ≈ 147 > mandíbula ≈ 139.3, abertura ≈ 12.7. El rango verdadero
    # es 1 en la primera vela y 1.5 en las demás (el máximo pasa 1.5 al cierre anterior): el ATR se siembra en la 13 con
    # (1 + 13·1.5)/14 y en la 59 vale 1.5 − (1.5 − 20.5/14)·(13/14)^46 ≈ 1.4988; el umbral, ≈ 0.75 → despierto al alza.
    b = subida(60)
    w = SeriesWilliams(b)
    r = filtro_alligator(b, 59, 1, "awake", w)
    assert r.pasa is True and r.valor["estado"] == SUBE and r.valor["abertura"] > 12
    assert r.valor["atr"] == A(1.5 - (1.5 - 20.5 / 14) * (13 / 14) ** 46)
    assert filtro_alligator(b, 59, -1, "awake", w).pasa is False
    assert filtro_alligator(b, 59, 1, "sleeping", w).pasa is False
    assert filtro_alligator(b, 59, -1, "sleeping", w).pasa is False
    # side: cierre 159 sobre los dientes ≈ 147 → pasa el largo y no el corto.
    assert filtro_alligator(b, 59, 1, "side", w).pasa is True
    assert filtro_alligator(b, 59, -1, "side", w).pasa is False


def test_alligator_dormido_con_precio_plano():
    # Precio medio 100 siempre: las tres líneas valen 100 (no hay orden estricto) → dormido, para los dos lados.
    # side: el cierre 100 queda igual a los dientes → no pasa a ningún lado.
    b = medios(*[100] * 40)
    w = SeriesWilliams(b)
    for lado in (1, -1):
        assert filtro_alligator(b, 39, lado, "sleeping", w).pasa is True
        assert filtro_alligator(b, 39, lado, "awake", w).pasa is False
        assert filtro_alligator(b, 39, lado, "side", w).pasa is False


def test_alligator_sin_dato_al_principio():
    # La mandíbula llega en la vela 20: en la 19, "awake" y "sleeping" no tienen dato (no pasan). "side" solo pide
    # los dientes, que llegan en la 12: en la 19 pasa el largo (cierre 119 sobre los dientes); en la 11, sin dato.
    b = subida(60)
    w = SeriesWilliams(b)
    assert filtro_alligator(b, 19, 1, "awake", w).pasa is None
    assert filtro_alligator(b, 19, 1, "sleeping", w).pasa is None
    assert filtro_alligator(b, 19, 1, "side", w).pasa is True
    assert filtro_alligator(b, 11, 1, "side", w).pasa is None
    # Con la lectura alternativa "side pide el Alligator entero", en la 19 no hay dato.
    w2 = SeriesWilliams(b, {"side_pide": "alligator"})
    assert filtro_alligator(b, 19, 1, "side", w2).pasa is None


def test_alligator_side_con_los_dientes_sin_desplazar():
    # Plano en 100 hasta la vela 29 y salto a 110 en la 30 (cierre 110). Los dientes como se dibujan en la 30 son la
    # SMMA 8 de la 25 = 100: el cierre 110 queda arriba → pasa el largo. La SMMA 8 de la misma vela 30 es
    # (100·7 + 110)/8 = 101.25: también abajo del cierre. En la 31 con cierre 100: los desplazados (SMMA 8 de la 26 =
    # 100) igualan el cierre → no pasa; los sin desplazar (SMMA 8 de la 31 = (101.25·7 + 100)/8 = 101.09375) quedan
    # arriba → pasa el corto.
    b = medios(*([100] * 30 + [110, 100]))
    w = SeriesWilliams(b)
    ws = SeriesWilliams(b, {"dientes": "sin_desplazar"})
    assert filtro_alligator(b, 30, 1, "side", w).pasa is True
    assert filtro_alligator(b, 31, -1, "side", w).pasa is False
    r = filtro_alligator(b, 31, -1, "side", ws)
    assert r.pasa is True and r.valor["dientes_mirados"] == A(101.09375)


# ------------------------------------------------------------------ AO

def _ao_salto():
    # Precio medio 100 en las velas 0 a 33; después 110, 105, 100 y 90.
    return medios(*([100] * 34 + [110, 105, 100, 90]))


def test_ao_valores_y_color():
    # AO = media 5 − media 34 del precio medio. En la 33: 100 − 100 = 0 (el primero: sin color).
    # 34: 102 − 3410/34 = 1.70588 (sube: verde). 35: 515/5 − 3415/34 = 2.55882 (verde).
    # 36: (100+100+110+105+100)/5 − 3415/34 = la misma suma → empate: conserva el verde (estricto: sin color).
    # 37: 505/5 − 3405/34 = 0.85294 (baja: roja).
    w = SeriesWilliams(_ao_salto())
    assert w.ao[32] is None and w.ao[33] == A(0.0)
    assert w.ao[34] == A(102 - 3410 / 34) and w.ao[35] == A(103 - 3415 / 34)
    assert w.ao[36] == w.ao[35] and w.ao[37] == A(101 - 3405 / 34)
    assert w.color_ao[33:38] == [None, SUBE, SUBE, SUBE, BAJA]
    assert SeriesWilliams(_ao_salto(), {"empate": "estricto"}).color_ao[36] is None


def test_filtro_ao():
    b = _ao_salto()
    w = SeriesWilliams(b)
    # 33: sin color (primer AO) → "color" sin dato; AO = 0 justo → "zero" no pasa a ningún lado; "both" no pasa.
    assert filtro_ao(b, 33, 1, "color", w).pasa is None
    assert filtro_ao(b, 33, 1, "zero", w).pasa is False and filtro_ao(b, 33, -1, "zero", w).pasa is False
    assert filtro_ao(b, 33, 1, "both", w).pasa is False
    # 34: verde y sobre el cero → pasa el largo en los tres modos; el corto en ninguno.
    for modo in ("color", "zero", "both"):
        assert filtro_ao(b, 34, 1, modo, w).pasa is True
        assert filtro_ao(b, 34, -1, modo, w).pasa is False
    # 36: el empate conserva el verde → "color" pasa el largo; con "estricto", sin dato.
    assert filtro_ao(b, 36, 1, "color", w).pasa is True
    assert filtro_ao(b, 36, 1, "color", SeriesWilliams(b, {"empate": "estricto"})).pasa is None
    # 37: roja pero sobre el cero → "color" pasa el corto, "zero" el largo y "both" ninguno.
    assert filtro_ao(b, 37, -1, "color", w).pasa is True and filtro_ao(b, 37, 1, "color", w).pasa is False
    assert filtro_ao(b, 37, 1, "zero", w).pasa is True
    assert filtro_ao(b, 37, 1, "both", w).pasa is False and filtro_ao(b, 37, -1, "both", w).pasa is False


# ------------------------------------------------------------------ AC y zonas

def _ac_salto():
    # Precio medio 100 en las velas 0 a 37, 110 en la 38 y 100 en la 39.
    return medios(*([100] * 38 + [110, 100]))


def test_ac_valores_y_color():
    # AO: 0 de la 33 a la 37; en la 38, A = 102 − 3410/34; en la 39, media 5 = 510/5 y media 34 = 3410/34 → otra vez A
    # (empate: conserva el verde). AC = AO − media 5 del AO: 37: 0 − 0 = 0 (el primero); 38: A − A/5 = 0.8·A (sube);
    # 39: A − 2A/5 = 0.6·A (baja).
    w = SeriesWilliams(_ac_salto())
    a = 102 - 3410 / 34
    assert w.ao[38] == A(a) and w.ao[39] == w.ao[38]
    assert w.ac[36] is None and w.ac[37] == A(0.0) and w.ac[38] == A(0.8 * a) and w.ac[39] == A(0.6 * a)
    assert w.color_ac[37:40] == [None, SUBE, BAJA]
    assert w.color_ao[37:40] == [None, SUBE, SUBE]


def test_filtro_ac():
    b = _ac_salto()
    w = SeriesWilliams(b)
    # 37: primer AC, sin color → "color" sin dato; AC = 0 → "zero" no pasa.
    assert filtro_ac(b, 37, 1, "color", w).pasa is None and filtro_ac(b, 37, 1, "zero", w).pasa is False
    # 38: verde y sobre el cero → el largo pasa en los tres; el corto en ninguno.
    for modo in ("color", "zero", "both"):
        assert filtro_ac(b, 38, 1, modo, w).pasa is True and filtro_ac(b, 38, -1, modo, w).pasa is False
    # 39: roja y sobre el cero → "color" el corto, "zero" el largo, "both" ninguno.
    assert filtro_ac(b, 39, -1, "color", w).pasa is True and filtro_ac(b, 39, 1, "zero", w).pasa is True
    assert filtro_ac(b, 39, 1, "both", w).pasa is False and filtro_ac(b, 39, -1, "both", w).pasa is False


def test_filtro_zona():
    b = _ac_salto()
    w = SeriesWilliams(b)
    # 38: AO verde y AC verde → zona verde: pasa el largo, no el corto.
    r = filtro_zona(b, 38, 1, w)
    assert r.pasa is True and r.valor["zona"] == SUBE
    assert filtro_zona(b, 38, -1, w).pasa is False
    # 39: AO verde (empate) y AC roja → gris: no pasa a ningún lado. 37: sin colores → sin dato.
    assert filtro_zona(b, 39, 1, w).pasa is False and filtro_zona(b, 39, -1, w).pasa is False
    assert filtro_zona(b, 39, 1, w).valor["zona"] == 0
    assert filtro_zona(b, 37, 1, w).pasa is None
    # Con "estricto", el AO de la 39 no tiene color → la zona no se sabe.
    assert filtro_zona(b, 39, 1, SeriesWilliams(b, {"empate": "estricto"})).pasa is None


def test_zona_roja_en_una_bajada():
    # En una bajada lineal el AO queda constante (empates) y en una parábola el AC también; en una cúbica que baja,
    # medio 200 − i³/1000, las medias de 5 y 34 cancelan el término cúbico: con t uniforme en 0..m, la media de
    # (i − t)³ es i³ − 3i²·m/2 + 3i·m(2m+1)/6 − m²(m+1)/4, y el AO queda −(43.5·i² − 1087.5·i + 9236.5)/1000, una
    # parábola que baja cada vez más (en la 60, −100.5865, y en la 59, −96.4975). El AC (el AO menos su media de 5) es una
    # recta que baja: los dos rojos → zona roja en la 60, pasa el corto.
    b = medios(*[200 - i ** 3 / 1000 for i in range(61)])
    w = SeriesWilliams(b)
    assert w.ao[60] == A(-100.5865) and w.ao[59] == A(-96.4975)
    assert w.color_ao[60] == BAJA and w.color_ac[60] == BAJA
    assert filtro_zona(b, 60, -1, w).pasa is True and filtro_zona(b, 60, 1, w).pasa is False


# ------------------------------------------------------------------ Gator

def test_gator_desde_lineas():
    # mandíbula 10; dientes 12, 13, 12.5, 12.5; labios 13, 15, 13, 14.
    # arriba |m − d| = 2, 3, 2.5, 2.5 → colores: —, crece, se achica, empate (conserva: se achica).
    # abajo |d − l| = 1, 2, 0.5, 1.5 → colores: —, crece, se achica, crece.
    m = [None, 10, 10, 10, 10]
    d = [None, 12, 13, 12.5, 12.5]
    lb = [None, 13, 15, 13, 14]
    arriba, abajo, ca, cb = gator_desde_lineas(m, d, lb)
    assert arriba == [None, 2, 3, 2.5, 2.5] and abajo == [None, 1, 2, 0.5, 1.5]
    assert ca == [None, None, SUBE, BAJA, BAJA] and cb == [None, None, SUBE, BAJA, SUBE]


def test_veredicto_gator():
    # Las dos crecen: comiendo y despierto. Las dos se achican: dormido. Una y una: solo despierto.
    assert [veredicto_gator(SUBE, SUBE, m).pasa for m in ("eating", "open", "sleeping")] == [True, True, False]
    assert [veredicto_gator(BAJA, BAJA, m).pasa for m in ("eating", "open", "sleeping")] == [False, False, True]
    assert [veredicto_gator(BAJA, SUBE, m).pasa for m in ("eating", "open", "sleeping")] == [False, True, False]
    # Sin una de las barras: sin dato; con "la_que_hay", "open" mira la que hay.
    assert veredicto_gator(None, SUBE, "open").pasa is None
    assert veredicto_gator(None, SUBE, "open", "la_que_hay").pasa is True
    assert veredicto_gator(None, SUBE, "eating", "la_que_hay").pasa is False


def test_filtro_gator_tras_un_salto():
    # Precio medio 100 hasta la vela 39 y 110 desde la 40. Con j velas desde el salto, la SMMA de n vale
    # 110 − 10·((n − 1)/n)^j: labios(i) = SMMA5(i − 3), dientes(i) = SMMA8(i − 5), mandíbula(i) = SMMA13(i − 8).
    # Arriba |mandíbula − dientes|: 0 hasta la 44 (sin color: empates desde el principio), 1.25 en la 45, 2.34375 en
    # la 46. Abajo |dientes − labios|: 0 hasta la 42, 2 en la 43, 3.6 en la 44, 3.63 en la 45, 3.56025 en la 46.
    b = medios(*([100] * 40 + [110] * 21))
    w = SeriesWilliams(b)
    assert w.gator_arriba[44] == A(0.0) and w.gator_arriba[45] == A(1.25) and w.gator_arriba[46] == A(2.34375)
    assert w.gator_abajo[43] == A(2.0) and w.gator_abajo[44] == A(3.6) and w.gator_abajo[45] == A(3.63)
    assert w.gator_abajo[46] == A(3.56025)
    # 44: la de arriba no tiene color → sin dato. 45: crecen las dos → comiendo. 46: la de abajo se achica → solo
    # despierto.
    assert filtro_gator(b, 44, 1, "open", w).pasa is None
    assert [filtro_gator(b, 45, 1, m, w).pasa for m in ("eating", "open", "sleeping")] == [True, True, False]
    assert [filtro_gator(b, 46, -1, m, w).pasa for m in ("eating", "open", "sleeping")] == [False, True, False]
    # 60: las líneas se juntan hacia 110 y las dos barras se achican: arriba 10·((12/13)^13 − (7/8)^16) = 2.352 contra
    # 10·((12/13)^12 − (7/8)^15) = 2.478 en la 59; abajo 10·((7/8)^16 − 0.8^18) = 1.0005 contra 1.124 → dormido.
    assert w.gator_arriba[60] == A(10 * ((12 / 13) ** 13 - (7 / 8) ** 16))
    assert w.gator_abajo[60] == A(10 * ((7 / 8) ** 16 - 0.8 ** 18))
    assert [filtro_gator(b, 60, 1, m, w).pasa for m in ("eating", "open", "sleeping")] == [False, False, True]


# ------------------------------------------------------------------ MFI

def _mfi_velas():
    # (máximo − mínimo, volumen): (2, 10), (3, 12), (2, 8), (1, 9), (0.5, 9), (0.4, 8), (2, 0).
    return velas((100, 101, 99, 100, 10), (100, 101.5, 98.5, 100, 12), (100, 101, 99, 100, 8),
                 (100, 100.5, 99.5, 100, 9), (100, 100.25, 99.75, 100, 9), (100, 100.2, 99.8, 100, 8),
                 (100, 101, 99, 100, 0))


def test_tipos_mfi():
    # MFI: 0.2, 0.25, 0.25, 0.111, 0.0556, 0.05, sin MFI (volumen 0).
    # 1: sube el MFI y el volumen → green. 2: el MFI empata (conserva "sube") y baja el volumen → fake.
    # 3: baja el MFI y sube el volumen → squat. 4: baja el MFI y el volumen empata (conserva "sube") → squat.
    # 5: bajan los dos → fade. 6: sin MFI.
    mfi, _, _, tipo = tipos_mfi(_mfi_velas())
    assert mfi[:3] == [A(0.2), A(0.25), A(0.25)] and mfi[6] is None
    assert tipo == [None, "green", "fake", "squat", "squat", "fade", None]
    # Estricto: los empates no tienen dirección → la 2 y la 4 sin tipo.
    assert tipos_mfi(_mfi_velas(), "estricto")[3] == [None, "green", None, "squat", None, "fade", None]


def test_filtro_mfi():
    b = _mfi_velas()
    w = SeriesWilliams(b)
    tabla = {  # vela: (green, squat, volume, notFake)
        1: (True, False, True, True),
        2: (False, False, False, False),
        3: (False, True, True, True),
        4: (False, True, True, True),
        5: (False, False, False, True),
    }
    for k, esperado in tabla.items():
        for lado in (1, -1):  # no mira el lado
            assert tuple(filtro_mfi(b, k, lado, m, w).pasa for m in ("green", "squat", "volume", "notFake")) == esperado
    assert filtro_mfi(b, 0, 1, "notFake", w).pasa is None
    assert filtro_mfi(b, 6, 1, "notFake", w).pasa is None


# ------------------------------------------------------------------ horario

def test_horario_que_cruza_la_medianoche():
    # De 22:00 (1320) a 04:00 (240), con los bordes incluidos. T0 es lunes 01/01/2024.
    h = {"from": 1320, "to": 240, "weekdays": False}
    # Vela de 4 h de 00:00 a 04:00: se conoce a las 04:00 (minuto 240, el borde) → pasa; con el borde excluido, no.
    assert filtro_horario(TF, una_vela(T0), 0, 1, h).pasa is True
    assert filtro_horario(TF, una_vela(T0), 0, 1, h, {"hasta": "excluido"}).pasa is False
    # De 20:00 a 00:00: minuto 0 → pasa. De 16:00 a 20:00: minuto 1200 → no pasa.
    assert filtro_horario(TF, una_vela(T0 + 20 * HORA), 0, -1, h).pasa is True
    assert filtro_horario(TF, una_vela(T0 + 16 * HORA), 0, 1, h).pasa is False
    # Vela de 1 h de 21:00 a 22:00: minuto 1320, el otro borde → pasa; con el borde "from" excluido, no.
    assert filtro_horario(60, una_vela(T0 + 21 * HORA, 60), 0, 1, h).pasa is True
    assert filtro_horario(60, una_vela(T0 + 21 * HORA, 60), 0, 1, h, {"desde": "excluido"}).pasa is False
    # Con la hora de apertura (lectura alternativa), la vela de 00:00 a 04:00 queda en el minuto 0: también pasa; la
    # de 04:00 a 08:00 queda en el 240 → pasa, aunque se conoce a las 08:00.
    assert filtro_horario(TF, una_vela(T0 + 4 * HORA), 0, 1, h).pasa is False
    assert filtro_horario(TF, una_vela(T0 + 4 * HORA), 0, 1, h, {"hora": "apertura"}).pasa is True


def test_horario_normal_en_15m():
    # De 13:30 (810) a 21:00 (1260), velas de 15 minutos: cierra a las 13:30 → pasa; a las 13:15 → no; a las 21:00 →
    # pasa; a las 21:15 → no.
    h = {"from": 810, "to": 1260, "weekdays": False}
    q = 15 * 60_000
    for apertura, esperado in ((13 * HORA + q, True), (13 * HORA, False), (20 * HORA + 3 * q, True), (21 * HORA, False)):
        r = filtro_horario(15, una_vela(T0 + apertura, 15), 0, 1, h)
        assert r.pasa is esperado, r.valor


def test_horario_de_lunes_a_viernes():
    # Todo el día (0 a 1439), solo de lunes a viernes, sobre la hora del cierre en UTC.
    h = {"from": 0, "to": 1439, "weekdays": True}
    vie = T0 + 4 * DIA       # viernes 05/01/2024 00:00
    dom = T0 + 6 * DIA       # domingo 07/01/2024 00:00
    # Viernes de 16:00 a 20:00 → pasa. Viernes de 20:00 a sábado 00:00 → se conoce el sábado: no pasa.
    assert filtro_horario(TF, una_vela(vie + 16 * HORA), 0, 1, h).pasa is True
    r = filtro_horario(TF, una_vela(vie + 20 * HORA), 0, 1, h)
    assert r.pasa is False and r.valor["dia"] == 5 and r.valor["minuto"] == 0
    # Domingo de 20:00 a lunes 00:00 → se conoce el lunes: pasa. Sábado de 08:00 a 12:00 → no.
    assert filtro_horario(TF, una_vela(dom + 20 * HORA), 0, 1, h).pasa is True
    assert filtro_horario(TF, una_vela(vie + DIA + 8 * HORA), 0, -1, h).pasa is False
    # Con la hora de apertura (lectura alternativa), al revés en las dos velas del borde del fin de semana.
    assert filtro_horario(TF, una_vela(vie + 20 * HORA), 0, 1, h, {"hora": "apertura"}).pasa is True
    assert filtro_horario(TF, una_vela(dom + 20 * HORA), 0, 1, h, {"hora": "apertura"}).pasa is False


def test_horario_apagado_y_sin_dias():
    v = una_vela(T0 + 4 * DIA + 20 * HORA)   # se conoce el sábado a las 00:00
    assert filtro_horario(TF, v, 0, 1, {"on": False, "from": 600, "to": 700}).pasa is True
    assert filtro_horario(TF, v, 0, 1, None).pasa is True
    # Sin "weekdays", el sábado a las 00:00 pasa en un horario de 0 a 60.
    assert filtro_horario(TF, v, 0, 1, {"from": 0, "to": 60}).pasa is True
    assert filtro_horario(TF, v, 0, 1, {"from": 1, "to": 60}).pasa is False


# ------------------------------------------------------------------ todos los de una regla

def test_evaluar_filtros_de_una_regla():
    b = subida(60)
    regla = {"bwf": {"alligator": "awake", "ao": "zero"}, "hours": {"from": 0, "to": 1439, "weekdays": False}}
    cache = {}
    ok, det = evaluar_filtros("BTCUSDT", TF, b, 59, 1, regla, cache)
    # Subida: Alligator despierto al alza y AO sobre el cero (media 5 sobre la 34) → el largo pasa todos.
    assert ok is True and set(det) == {"alligator", "ao", "horario"}
    ok2, det2 = evaluar_filtros("BTCUSDT", TF, b, 59, -1, regla, cache)
    assert ok2 is False and det2["alligator"].pasa is False and det2["ao"].pasa is False and det2["horario"].pasa is True
    # Sin filtros: pasa sin mirar nada.
    assert evaluar_filtros("BTCUSDT", TF, b, 59, -1, {}, cache) == (True, {})
    # Un filtro sin dato no deja pasar: en la 10 no hay AO.
    ok3, det3 = evaluar_filtros("BTCUSDT", TF, b, 10, 1, {"bwf": {"ao": "color"}}, cache)
    assert ok3 is False and det3["ao"].pasa is None
    # La caché da las mismas series para la misma lista y las mismas opciones.
    assert series(b, cache) is series(b, cache) and series(b, cache) is not series(b, cache, {"atr": "primera"})


def test_nada_mira_despues_de_k():
    # Cambiar las velas posteriores a k no cambia ningún veredicto ni valor en k.
    b = subida(60)
    b2 = [dict(v) for v in b]
    for v in b2[41:]:
        for c in ("o", "h", "l", "c"):
            v[c] = v[c] * 0.5
        v["vol"] = 1000.0
    w, w2 = SeriesWilliams(b), SeriesWilliams(b2)
    for lado in (1, -1):
        for modo in ("awake", "side", "sleeping"):
            assert filtro_alligator(b, 40, lado, modo, w) == filtro_alligator(b2, 40, lado, modo, w2)
        for modo in ("color", "zero", "both"):
            assert filtro_ao(b, 40, lado, modo, w) == filtro_ao(b2, 40, lado, modo, w2)
            assert filtro_ac(b, 40, lado, modo, w) == filtro_ac(b2, 40, lado, modo, w2)
        for modo in ("eating", "open", "sleeping"):
            assert filtro_gator(b, 40, lado, modo, w) == filtro_gator(b2, 40, lado, modo, w2)
        for modo in ("green", "squat", "volume", "notFake"):
            assert filtro_mfi(b, 40, lado, modo, w) == filtro_mfi(b2, 40, lado, modo, w2)
        assert filtro_zona(b, 40, lado, w) == filtro_zona(b2, 40, lado, w2)
