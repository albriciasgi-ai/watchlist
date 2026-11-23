"""Casos armados a mano del oráculo A de los filtros (filtros_a.py), con el resultado esperado
calculado en el comentario de cada uno.

Velas de 4 horas (tf = 240) desde el 01/01/2024 00:00 UTC (T0), salvo que se diga otra cosa.
Cada vela es (o, h, l, c) con volumen 1 y sin delta, o (o, h, l, c, vol[, delta]). La vela i abre
en T0 + i·4h y cierra en T0 + (i+1)·4h: con una serie de OI de 4 horas que empieza en T0, el OI
al cierre de la vela i es el punto i + 1. Los datos (OI, funding, Coin Metrics) se pasan a mano;
solo la última sección lee OrderFlowData, y se salta si no está.
"""

import math
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import filtros_a as fa  # noqa: E402
from filtros_a import (  # noqa: E402
    PASO_4H, PASO_5MIN, Serie, activo_de, evaluar_filtros, filtro_cvd, filtro_linea,
    filtro_lineas, filtro_multitud, filtro_oi, filtro_oi_sostenido, filtro_onchain,
    medidas_emision, medidas_neto, serie_oi, volumen_con_signo,
)

TF = 240
STEP = TF * 60_000
T0 = 1_704_067_200_000          # 2024-01-01 00:00 UTC
HORA = fa.HORA
DIA = fa.DIA
A = pytest.approx
RAIZ19 = math.sqrt(19)          # z de un valor aislado entre 20: ±√(n − 1)


def velas(*filas, t0=T0, paso=STEP):
    out = []
    for i, f in enumerate(filas):
        o, h, l, c = f[:4]
        vol = f[4] if len(f) > 4 else 1.0
        delta = f[5] if len(f) > 5 else None
        out.append({"t": t0 + i * paso, "o": o, "h": h, "l": l, "c": c, "vol": vol, "delta": delta})
    return out


def cierres(*cs):
    """Velas chicas alrededor de cada cierre: o = c, h = c + 0.5, l = c − 0.5."""
    return velas(*[(c, c + 0.5, c - 0.5, c) for c in cs])


def una_vela(cierre_ms, tf=TF):
    """Una sola vela (k = 0) que cierra en `cierre_ms`."""
    return velas((100, 101, 99, 100), t0=cierre_ms - tf * 60_000, paso=tf * 60_000)


def oi_4h(valores, t0=T0):
    """Serie de 4 horas: el punto j en t0 + j·4h."""
    return Serie([(t0 + j * PASO_4H, v) for j, v in enumerate(valores)], PASO_4H)


def VWAP(n, mode="side", slope=False, maxDev=None):
    d = {"type": "vwap", "period": n, "mode": mode, "slope": slope}
    if maxDev is not None:
        d["maxDev"] = maxDev
    return d


def EMA(n, mode="side", slope=False):
    return {"type": "ema", "period": n, "mode": mode, "slope": slope}


# ------------------------------------------------------------------ VWAP móvil

def test_vwap_cierra_a_favor_en_largo_y_no_en_corto():
    # típicos: (101+99+100)/3 = 100, (103+101+102)/3 = 102, (105+103+104)/3 = 104; vol 1, 1, 2.
    # VWAP 3 = (100 + 102 + 2·104) / 4 = 410 / 4 = 102.5. Cierre 104 > 102.5: el largo pasa;
    # el corto no (tendría que cerrar bajo la línea).
    b = velas((100, 101, 99, 100), (101, 103, 101, 102), (103, 105, 103, 104, 2.0))
    r = filtro_linea("BTCUSDT", TF, b, 2, 1, VWAP(3))
    assert r.pasa is True and r.valor["linea"] == A(102.5) and r.valor["cierre"] == 104
    assert filtro_linea("BTCUSDT", TF, b, 2, -1, VWAP(3)).pasa is False


def test_vwap_sin_linea_con_menos_de_n_velas():
    # k = 1: hay 2 velas y el VWAP pide 3 → todavía no hay línea: sin dato (en la app no pasa).
    b = velas((100, 101, 99, 100), (101, 103, 101, 102), (103, 105, 103, 104, 2.0))
    r = filtro_linea("BTCUSDT", TF, b, 1, 1, VWAP(3))
    assert r.pasa is None and r.valor["linea"] is None


def test_vwap_la_mecha_lo_toca_en_largo():
    # típicos 100, (102+99+101)/3 = 100.667, (104+100+103)/3 = 102.333 → VWAP 3 = 303/3 = 101.
    # cierre 103 > 101 y mínimo 100 <= 101: "touch" pasa en el largo.
    b = velas((100, 101, 99, 100), (100, 102, 99, 101), (101, 104, 100, 103))
    r = filtro_linea("BTCUSDT", TF, b, 2, 1, VWAP(3, "touch"))
    assert r.pasa is True and r.valor["linea"] == A(101.0) and r.valor["toca"] is True
    # con el mínimo de la vela 2 en 101.5: típico (104+101.5+103)/3 = 102.833 → VWAP = 303.5/3 =
    # 101.1667; el mínimo 101.5 no llega → "touch" no pasa, "side" sí (103 > 101.17).
    b2 = velas((100, 101, 99, 100), (100, 102, 99, 101), (101.5, 104, 101.5, 103))
    r2 = filtro_linea("BTCUSDT", TF, b2, 2, 1, VWAP(3, "touch"))
    assert r2.pasa is False and r2.valor["linea"] == A(101.1666667) and r2.valor["toca"] is False
    assert filtro_linea("BTCUSDT", TF, b2, 2, 1, VWAP(3, "side")).pasa is True


def test_vwap_la_mecha_lo_toca_en_corto():
    # típicos 100, (101+98+99)/3 = 99.333, (100+96+97)/3 = 97.667 → VWAP 3 = 297/3 = 99.
    # corto: cierre 97 < 99 y máximo 100 >= 99 → "touch" pasa. El largo no: cierra bajo la línea.
    b = velas((100, 101, 99, 100), (100, 101, 98, 99), (99, 100, 96, 97))
    assert filtro_linea("BTCUSDT", TF, b, 2, -1, VWAP(3, "touch")).pasa is True
    assert filtro_linea("BTCUSDT", TF, b, 2, 1, VWAP(3, "touch")).pasa is False


def test_linea_sin_modo_no_filtra():
    # "sin filtro": no mira nada, ni la pendiente ni el tope (la vela cierra contra el largo).
    b = velas((100, 101, 99, 100), (100, 101, 98, 99), (99, 100, 96, 97))
    for modo in (None, "none", ""):
        r = filtro_linea("BTCUSDT", TF, b, 2, 1, VWAP(3, modo, slope=True, maxDev=0.1))
        assert r.pasa is True


# ------------------------------------------------------------------ EMA

def test_ema_arranca_con_el_primer_cierre():
    # EMA 3, alfa = 2/4 = 0.5: 10 → 0.5·12 + 0.5·10 = 11 → 0.5·14 + 0.5·11 = 12.5 →
    # 0.5·13 + 0.5·12.5 = 12.75. (Con una media simple de arranque sería 12 en la vela 2 y 12.5
    # en la 3.) k = 3: cierre 13 > 12.75 → el largo pasa y el corto no.
    b = cierres(10, 12, 14, 13)
    r = filtro_linea("BTCUSDT", TF, b, 3, 1, EMA(3))
    assert r.pasa is True and r.valor["linea"] == A(12.75)
    assert filtro_linea("BTCUSDT", TF, b, 3, -1, EMA(3)).pasa is False
    # k = 2: tres velas, ya hay línea: 14 > 12.5 → pasa. k = 1: dos velas → sin línea (None).
    r2 = filtro_linea("BTCUSDT", TF, b, 2, 1, EMA(3))
    assert r2.pasa is True and r2.valor["linea"] == A(12.5)
    assert filtro_linea("BTCUSDT", TF, b, 1, 1, EMA(3)).pasa is None


def test_ema_cierre_igual_a_la_linea_no_pasa():
    # cierres 10, 10, 10: la EMA 3 es 10 y el cierre es 10: no queda de ningún lado (estricto).
    b = cierres(10, 10, 10)
    assert filtro_linea("BTCUSDT", TF, b, 2, 1, EMA(3)).pasa is False
    assert filtro_linea("BTCUSDT", TF, b, 2, -1, EMA(3)).pasa is False


def test_ema_pendiente_a_favor():
    # EMA 2, alfa 2/3, cierres 10..16: e1 = 2/3·11 + 1/3·10 = 10.6667, ..., e6 = 15.5007.
    # cierre 16 > 15.5007 y pendiente e6 − e1 = +4.834 > 0 → el largo pasa con pendiente.
    b = cierres(10, 11, 12, 13, 14, 15, 16)
    r = filtro_linea("BTCUSDT", TF, b, 6, 1, EMA(2, slope=True))
    assert r.pasa is True and r.valor["linea"] == A(15.5006859)
    assert r.valor["pendiente"] == A(15.5006859 - 10.6666667)


def test_ema_pendiente_en_contra_aunque_cierre_a_favor():
    # EMA 2, cierres 20, 19, 18, 17, 16, 15, 17: e1 = 2/3·19 + 1/3·20 = 19.3333;
    # e2 = 18.4444, e3 = 17.4815, e4 = 16.4938, e5 = 15.4979, e6 = 2/3·17 + 1/3·15.4979 = 16.4993.
    # cierre 17 > 16.4993: "side" pasa; con pendiente, e6 − e1 = −2.834 < 0 → no pasa.
    b = cierres(20, 19, 18, 17, 16, 15, 17)
    assert filtro_linea("BTCUSDT", TF, b, 6, 1, EMA(2)).pasa is True
    r = filtro_linea("BTCUSDT", TF, b, 6, 1, EMA(2, slope=True))
    assert r.pasa is False and r.valor["pendiente"] == A(16.4993141 - 19.3333333)


def test_pendiente_sin_linea_5_velas_antes():
    # EMA 2 en k = 5: la línea de k − 5 = 0 no existe (pide 2 velas) → sin dato. En k = 6 ya está.
    b = cierres(10, 11, 12, 13, 14, 15, 16)
    assert filtro_linea("BTCUSDT", TF, b, 5, 1, EMA(2, slope=True)).pasa is None
    # si el lado ya falla, el resultado es False aunque falte la pendiente (el corto cierra arriba).
    assert filtro_linea("BTCUSDT", TF, b, 5, -1, EMA(2, slope=True)).pasa is False


# ------------------------------------------------------------------ tope de desviaciones del VWAP

def test_tope_de_desviaciones_en_largo():
    # VWAP 2: típicos 100 (101, 99, 100) y 102 (103, 101, 102), vol 1 y 1 → VWAP 101;
    # desviación = √((1·1² + 1·1²) / 2) = 1. Con maxDev 1, el tope del largo es 101 + 1 = 102.
    # cierre 102 > 101: "side" pasa. Apertura de la vela de la señal:
    #   101.5 <= 102 → pasa; 102, justo en la banda → pasa; 102.5 > 102 → no pasa.
    # Con maxDev 2 el tope es 103 y 102.5 pasa.
    for apertura, esperado in ((101.5, True), (102, True), (102.5, False)):
        b = velas((100, 101, 99, 100), (apertura, 103, 101, 102))
        r = filtro_linea("BTCUSDT", TF, b, 1, 1, VWAP(2, maxDev=1))
        assert r.pasa is esperado, apertura
        assert r.valor["desv"] == A(1.0) and r.valor["tope"] == A(102.0)
    b = velas((100, 101, 99, 100), (102.5, 103, 101, 102))
    assert filtro_linea("BTCUSDT", TF, b, 1, 1, VWAP(2, maxDev=2)).pasa is True


def test_tope_de_desviaciones_en_corto():
    # típicos 102 (103, 101, 102) y 100 (101, 99, 100) → VWAP 101, desviación 1; el tope del
    # corto es 101 − 1 = 100. cierre 100 < 101: "side" pasa.
    # apertura 99.5 < 100: abrió más allá de la banda, del lado del corto → no pasa; 100.5 → pasa.
    b = velas((102, 103, 101, 102), (99.5, 101, 99, 100))
    r = filtro_linea("BTCUSDT", TF, b, 1, -1, VWAP(2, maxDev=1))
    assert r.pasa is False and r.valor["tope"] == A(100.0)
    b2 = velas((102, 103, 101, 102), (100.5, 101, 99, 100))
    assert filtro_linea("BTCUSDT", TF, b2, 1, -1, VWAP(2, maxDev=1)).pasa is True


def test_tope_no_mira_aperturas_del_otro_lado():
    # largo con la apertura bajo el VWAP: no la limita el tope de arriba. Velas: típicos 100 y 102
    # (VWAP 101, desv. 1, tope 102); la vela 1 abre en 100.5 (bajo 101) y cierra en 102 → pasa.
    b = velas((100, 101, 99, 100), (100.5, 103, 100.5, 102.5))
    # típico de la vela 1: (103 + 100.5 + 102.5)/3 = 102 → VWAP 101, cierre 102.5 > 101.
    r = filtro_linea("BTCUSDT", TF, b, 1, 1, VWAP(2, maxDev=1))
    assert r.pasa is True and r.valor["linea"] == A(101.0)


def test_dos_lineas_pasan_si_pasan_las_dos():
    # cierres 10, 12, 14, 13 (velas chicas, vol 1): VWAP 3 en k = 3 = (12 + 14 + 13)/3 = 13 →
    # cierre 13 no queda arriba → falla; EMA 3 = 12.75 → pasa. Juntas: no pasan.
    b = cierres(10, 12, 14, 13)
    r = filtro_lineas("BTCUSDT", TF, b, 3, 1, [EMA(3), VWAP(3)])
    assert r.pasa is False
    assert [x.pasa for x in r.valor] == [True, False]
    assert r.valor[1].valor["linea"] == A(13.0)
    # con el VWAP de 2: (14 + 13)/2 = 13.5 > 13 → también falla; sin líneas, pasa.
    assert filtro_lineas("BTCUSDT", TF, b, 3, 1, [EMA(3), VWAP(2)]).pasa is False
    assert filtro_lineas("BTCUSDT", TF, b, 3, 1, []).pasa is True


def test_las_velas_despues_de_k_no_cuentan():
    # las mismas velas que arriba con dos velas más, extremas: en k = 3 todo da igual.
    b = cierres(10, 12, 14, 13)
    b_mas = cierres(10, 12, 14, 13, 1000, -1000)
    for ln in (EMA(3), VWAP(3), EMA(2, slope=True)):
        assert filtro_linea("X", TF, b, 3, 1, ln).valor == filtro_linea("X", TF, b_mas, 3, 1, ln).valor


def test_cache_de_la_ema_da_lo_mismo():
    # con un dict de caché la EMA se calcula una vez para toda la lista; en cada k da lo mismo que
    # calcularla hasta k (su valor en i solo depende de las velas hasta i).
    b = cierres(10, 11, 12, 13, 14, 15, 16)
    cache = {}
    for k in range(len(b)):
        sin = filtro_linea("X", TF, b, k, 1, EMA(2, slope=True))
        con = filtro_linea("X", TF, b, k, 1, EMA(2, slope=True), cache)
        assert (sin.pasa, sin.valor) == (con.pasa, con.valor)
    with pytest.raises(ValueError):
        filtro_linea("X", TF, b, 3, 1, {"type": "ema", "period": 0, "mode": "side"})


# ------------------------------------------------------------------ CVD

def test_cvd_real_a_favor():
    # CVD 3: delta 5 − 2 + 4 = 7 sobre un volumen de 30 → 0.2333: el largo pasa, el corto no.
    b = velas((100, 101, 99, 100, 10, 5), (100, 101, 99, 100, 10, -2), (100, 101, 99, 100, 10, 4))
    pasa, valor = filtro_cvd("BTCUSDT", TF, b, 2, 1, 3)
    assert pasa is True and valor == A(7 / 30)
    assert filtro_cvd("BTCUSDT", TF, b, 2, -1, 3).pasa is False


def test_cvd_incluye_la_vela_de_la_senal_y_no_mira_antes():
    # CVD 2 en k = 2: solo las velas 1 y 2 → (−2 + 4)/20 = 0.1 (la vela 0 no entra).
    b = velas((100, 101, 99, 100, 10, -50), (100, 101, 99, 100, 10, -2), (100, 101, 99, 100, 10, 4))
    assert filtro_cvd("BTCUSDT", TF, b, 2, 1, 2).valor == A(0.1)


def test_cvd_con_menos_de_n_velas_sin_dato():
    b = velas((100, 101, 99, 100, 10, 5), (100, 101, 99, 100, 10, -2))
    assert filtro_cvd("BTCUSDT", TF, b, 1, 1, 3).pasa is None


def test_cvd_estimado_por_donde_cierra_la_vela():
    # sin delta: (100, 110, 90, 105), vol 20 → ((105−90) − (110−105))/20 = +0.5 → +10;
    # (105, 106, 96, 98), vol 10 → ((98−96) − (106−98))/10 = −0.6 → −6.
    # CVD 2: (10 − 6)/30 = 0.1333 → el largo pasa.
    b = velas((100, 110, 90, 105, 20), (105, 106, 96, 98, 10))
    pasa, valor = filtro_cvd("ETHUSDT", TF, b, 1, 1, 2)
    assert pasa is True and valor == A(4 / 30)


def test_cvd_en_1d_se_estima_aunque_haya_delta():
    # las mismas velas con delta −100 cada una. En 4h manda la delta real: −200/30 → el largo no
    # pasa. En 1D se estima por el cierre, como arriba: 4/30 → el largo pasa.
    b = velas((100, 110, 90, 105, 20, -100), (105, 106, 96, 98, 10, -100))
    assert filtro_cvd("BTCUSDT", 240, b, 1, 1, 2).valor == A(-200 / 30)
    assert filtro_cvd("BTCUSDT", 240, b, 1, 1, 2).pasa is False
    d = velas((100, 110, 90, 105, 20, -100), (105, 106, 96, 98, 10, -100), paso=DIA)
    assert filtro_cvd("BTCUSDT", 1440, d, 1, 1, 2).valor == A(4 / 30)
    assert filtro_cvd("BTCUSDT", 1440, d, 1, 1, 2).pasa is True


def test_cvd_neto_cero_no_pasa_a_ningun_lado():
    # +3 y −3: delta neta 0 → ni largo ni corto.
    b = velas((100, 101, 99, 100, 10, 3), (100, 101, 99, 100, 10, -3))
    assert filtro_cvd("BTCUSDT", TF, b, 1, 1, 2).pasa is False
    assert filtro_cvd("BTCUSDT", TF, b, 1, -1, 2).pasa is False


def test_cvd_sin_volumen_sin_dato():
    b = velas((100, 101, 99, 100, 0, 0), (100, 101, 99, 100, 0, 0))
    assert filtro_cvd("BTCUSDT", TF, b, 1, 1, 2).pasa is None


# ------------------------------------------------------------------ OI: sube y baja

def test_oi_sube_mas_de_2_por_ciento_en_2_velas():
    # oiBars 2, oiPct 2, señal en la vela 4: OI al cierre de la vela 4 = punto 5 (103) y al cierre
    # de la vela 2 = punto 3 (100) → (103 − 100)/100 = +3 % > 2: "rise" pasa (a los dos lados);
    # "fall" no.
    b = cierres(*[100] * 5)
    s = oi_4h([100, 100, 100, 100, 101, 103])
    pasa, pct = filtro_oi("SOLUSDT", TF, b, 4, 1, "rise", 2, 2, serie=s)
    assert pasa is True and pct == A(3.0)
    assert filtro_oi("SOLUSDT", TF, b, 4, -1, "rise", 2, 2, serie=s).pasa is True
    assert filtro_oi("SOLUSDT", TF, b, 4, 1, "fall", 2, 2, serie=s).pasa is False


def test_oi_baja_mas_de_2_por_ciento():
    # punto 3 = 100, punto 5 = 97 → −3 % < −2: "fall" pasa, "rise" no.
    b = cierres(*[100] * 5)
    s = oi_4h([100, 100, 100, 100, 99, 97])
    assert filtro_oi("SOLUSDT", TF, b, 4, 1, "fall", 2, 2, serie=s).pasa is True
    assert filtro_oi("SOLUSDT", TF, b, 4, 1, "rise", 2, 2, serie=s).pasa is False


def test_oi_justo_en_el_umbral_no_pasa():
    # punto 3 = 50, punto 5 = 51 → (51 − 50)/50·100 = 2.0, justo 2 %: "más de 2 %" no se cumple.
    b = cierres(*[100] * 5)
    s = oi_4h([50, 50, 50, 50, 50, 51])
    pasa, pct = filtro_oi("SOLUSDT", TF, b, 4, 1, "rise", 2, 2, serie=s)
    assert pct == 2.0 and pasa is False


def test_oi_sin_punto_al_cierre_sin_dato():
    # falta el punto 5 (cierre de la vela 4): el último conocido es el 4, una vela antes → la vela
    # no tiene OI → sin dato.
    b = cierres(*[100] * 5)
    s = Serie([(T0 + j * PASO_4H, 100.0) for j in range(5)], PASO_4H)
    assert filtro_oi("SOLUSDT", TF, b, 4, 1, "rise", 2, 2, serie=s).pasa is None


def test_oi_con_pocas_velas_sin_dato():
    # k = 1 con oiBars 2: no hay vela k − 2.
    b = cierres(100, 100)
    s = oi_4h([100, 100, 103])
    assert filtro_oi("SOLUSDT", TF, b, 1, 1, "rise", 2, 2, serie=s).pasa is None


def test_oi_de_4_horas_solo_en_4h_y_1d():
    # con la serie de 4 horas, en 1h no pasa ninguna señal ("En ETH 15m no pasa ninguna señal").
    b = velas(*[(100, 101, 99, 100)] * 30, paso=HORA)
    s = oi_4h([100 + j for j in range(10)])
    assert filtro_oi("ETHUSDT", 60, b, 29, 1, "rise", 0, 1, serie=s).pasa is None
    # sin serie a mano: ETH en 1h ni siquiera abre el archivo.
    serie, motivo = serie_oi("ETHUSDT", 60)
    assert serie is None and "4h y 1D" in motivo


def test_oi_en_1d_con_la_serie_de_4_horas():
    # velas de 1 día desde T0: la vela 1 cierra en T0 + 2 días (punto 12 de la serie de 4 h) y la
    # 0 en T0 + 1 día (punto 6). Puntos 0..12 = 100, 100, ..., con el 6 = 100 y el 12 = 104 →
    # +4 % en 1 vela > 2: "rise" pasa.
    d = velas((100, 101, 99, 100), (100, 101, 99, 100), paso=DIA)
    vals = [100.0] * 13
    vals[12] = 104.0
    pasa, pct = filtro_oi("ETHUSDT", 1440, d, 1, 1, "rise", 2, 1, serie=oi_4h(vals))
    assert pasa is True and pct == A(4.0)


def test_oi_con_serie_de_5_minutos_en_15m():
    # BTC: puntos cada 5 min desde T0, 1000 + 0.5·j. Velas de 15m: la vela 2 cierra en T0 + 45 min
    # (j = 9 → 1004.5) y la vela 0 en T0 + 15 min (j = 3 → 1001.5): (1004.5 − 1001.5)/1001.5 =
    # +0.29955 %. Con oiPct 0.2 en 2 velas pasa; con 2 no.
    b = velas(*[(100, 101, 99, 100)] * 3, paso=15 * 60_000)
    s = Serie([(T0 + j * PASO_5MIN, 1000 + 0.5 * j) for j in range(20)], PASO_5MIN)
    pasa, pct = filtro_oi("BTCUSDT", 15, b, 2, 1, "rise", 0.2, 2, serie=s)
    assert pasa is True and pct == A(3 / 1001.5 * 100)
    assert filtro_oi("BTCUSDT", 15, b, 2, 1, "rise", 2, 2, serie=s).pasa is False


# ------------------------------------------------------------------ OI: confluencia con el volumen

def confluencia(oi_ultimo_cambio, oi_paso=1.0, vol_ultima=10.0):
    """21 velas verdes (k = 20): las 20 primeras con vol 1 y la 20 con `vol_ultima`. OI al cierre
    de la vela i = punto i + 1: 1000 + i·oi_paso hasta la vela 19 y luego + oi_ultimo_cambio."""
    filas = [(100, 101.5, 99.5, 101, 1.0)] * 20 + [(100, 101.5, 99.5, 101, vol_ultima)]
    b = velas(*filas)
    puntos = [1000.0] + [1000.0 + i * oi_paso for i in range(20)]   # puntos 0..20
    puntos.append(puntos[-1] + oi_ultimo_cambio)                      # punto 21 = cierre de la 20
    return b, oi_4h(puntos)


def test_confluencia_a_favor_del_largo():
    # volumen con signo de las velas 1..20: diecinueve +1 y un +10 → z = +√19 = +4.359.
    # cambio del OI de las velas 1..20: diecinueve +1 y un +5 → z = +√19. Los dos a favor del
    # largo: "conf" pasa y "noconf" también. En el corto los dos van en contra: "conf" no pasa y
    # "noconf" tampoco.
    b, s = confluencia(5.0)
    pasa, valor = filtro_oi("SOLUSDT", TF, b, 20, 1, "conf", serie=s)
    assert pasa is True and valor["zVol"] == A(RAIZ19) and valor["zOi"] == A(RAIZ19)
    assert filtro_oi("SOLUSDT", TF, b, 20, 1, "noconf", serie=s).pasa is True
    assert filtro_oi("SOLUSDT", TF, b, 20, -1, "conf", serie=s).pasa is False
    assert filtro_oi("SOLUSDT", TF, b, 20, -1, "noconf", serie=s).pasa is False


def test_confluencia_con_uno_solo_a_favor():
    # el OI de la vela 20 baja 5: cambios diecinueve +1 y un −5 → z = −√19; volumen z = +√19.
    # largo: "conf" no (el OI no acompaña), "noconf" sí (no van los dos en contra).
    # corto: "conf" no, "noconf" sí.
    b, s = confluencia(-5.0)
    pasa, valor = filtro_oi("SOLUSDT", TF, b, 20, 1, "conf", serie=s)
    assert pasa is False and valor["zVol"] == A(RAIZ19) and valor["zOi"] == A(-RAIZ19)
    assert filtro_oi("SOLUSDT", TF, b, 20, 1, "noconf", serie=s).pasa is True
    assert filtro_oi("SOLUSDT", TF, b, 20, -1, "conf", serie=s).pasa is False
    assert filtro_oi("SOLUSDT", TF, b, 20, -1, "noconf", serie=s).pasa is True


def test_confluencia_mira_el_z_no_el_signo_del_cambio():
    # el OI sube en la vela 20, pero +1 contra diecinueve +2: z = (1 − 1.95)/0.218 = −√19 < 0.
    # El largo no tiene la confluencia aunque el OI haya subido.
    b, s = confluencia(1.0, oi_paso=2.0)
    pasa, valor = filtro_oi("SOLUSDT", TF, b, 20, 1, "conf", serie=s)
    assert pasa is False and valor["zOi"] == A(-RAIZ19)


def test_confluencia_con_cambios_planos():
    # todos los cambios del OI son +1: la ventana no varía → z del OI = 0, ni a favor ni en contra.
    # largo: "conf" no pasa; "noconf" sí.
    b, s = confluencia(1.0)
    pasa, valor = filtro_oi("SOLUSDT", TF, b, 20, 1, "conf", serie=s)
    assert pasa is False and valor["zOi"] == 0.0
    assert filtro_oi("SOLUSDT", TF, b, 20, 1, "noconf", serie=s).pasa is True


def test_confluencia_pide_la_vela_20_atras():
    # k = 19: el cambio del OI de la vela 0 necesita la vela −1 → sin dato.
    b, s = confluencia(5.0)
    assert filtro_oi("SOLUSDT", TF, b, 19, 1, "conf", serie=s).pasa is None


def test_volumen_con_signo_por_el_color():
    # verde +vol, roja −vol, sin cuerpo 0.
    assert volumen_con_signo({"o": 100, "c": 101, "vol": 7}) == 7
    assert volumen_con_signo({"o": 101, "c": 100, "vol": 7}) == -7
    assert volumen_con_signo({"o": 100, "c": 100, "vol": 7}) == 0


# ------------------------------------------------------------------ multitud (funding)

def funding(tasas, t0=T0, paso=8 * HORA):
    return Serie([(t0 + j * paso, f) for j, f in enumerate(tasas)])


def test_funding_en_la_tasa_base_es_neutro():
    # cobros de 0.0001 cada 8 h desde T0. La vela cierra en T0 + 72 h: entran los de (T0, T0 + 72 h],
    # las horas 8, 16, ..., 72: 9 cobros → 0.0009 / 9 = 0.0001, justo 0.01 %: neutro.
    # "nocon" deja pasar a los dos lados; "contra", a ninguno.
    b = una_vela(T0 + 72 * HORA)
    s = funding([0.0001] * 20)
    pasa, valor = filtro_multitud("BTCUSDT", TF, b, 0, 1, "nocon", serie=s)
    assert pasa is True and valor["funding"] == A(0.0001) and valor["multitud"] == "neutral"
    assert filtro_multitud("BTCUSDT", TF, b, 0, -1, "nocon", serie=s).pasa is True
    assert filtro_multitud("BTCUSDT", TF, b, 0, 1, "contra", serie=s).pasa is False
    assert filtro_multitud("BTCUSDT", TF, b, 0, -1, "contra", serie=s).pasa is False


def test_funding_alto_la_multitud_va_larga():
    # 0.0003 en cada cobro → 0.0003 > 0.0001: un largo va con la multitud y un corto contra ella.
    # "nocon": el largo no pasa y el corto sí. "contra": solo el corto.
    b = una_vela(T0 + 72 * HORA)
    s = funding([0.0003] * 20)
    r = filtro_multitud("BTCUSDT", TF, b, 0, 1, "nocon", serie=s)
    assert r.pasa is False and r.valor["multitud"] == "con"
    assert filtro_multitud("BTCUSDT", TF, b, 0, -1, "nocon", serie=s).pasa is True
    assert filtro_multitud("BTCUSDT", TF, b, 0, -1, "contra", serie=s).pasa is True
    assert filtro_multitud("BTCUSDT", TF, b, 0, 1, "contra", serie=s).pasa is False


def test_funding_negativo_la_multitud_va_corta():
    # −0.0002 < 0: el largo va contra la multitud y el corto con ella.
    b = una_vela(T0 + 72 * HORA)
    s = funding([-0.0002] * 20)
    r = filtro_multitud("BTCUSDT", TF, b, 0, 1, "contra", serie=s)
    assert r.pasa is True and r.valor["multitud"] == "contra" and r.valor["funding"] == A(-0.0002)
    assert filtro_multitud("BTCUSDT", TF, b, 0, -1, "nocon", serie=s).pasa is False


def test_funding_ventana_de_3_dias():
    # cobro de 0.01 justo 72 h antes del cierre (hora 0) y 0.0001 en los demás: el de la hora 0
    # queda fuera → (9·0.0001)/9 = 0.0001, neutro.
    b = una_vela(T0 + 72 * HORA)
    r = filtro_multitud("BTCUSDT", TF, b, 0, 1, "nocon", serie=funding([0.01] + [0.0001] * 19))
    assert r.valor["multitud"] == "neutral" and r.valor["funding"] == A(0.0001)
    # el cobro justo al cierre (hora 72, j = 9) sí entra: con 0.0028 ahí,
    # (8·0.0001 + 0.0028)/9 = 0.0036/9 = 0.0004 > 0.0001 → el largo va con la multitud.
    tasas = [0.0001] * 20
    tasas[9] = 0.0028
    r2 = filtro_multitud("BTCUSDT", TF, b, 0, 1, "nocon", serie=funding(tasas))
    assert r2.pasa is False and r2.valor["funding"] == A(0.0004)


def test_funding_sin_cobros_sin_dato():
    # el último cobro es en T0 y la vela cierra en T0 + 100 h: (T0 + 28 h, T0 + 100 h] vacío.
    b = una_vela(T0 + 100 * HORA)
    assert filtro_multitud("BTCUSDT", TF, b, 0, 1, "nocon", serie=funding([0.0001])).pasa is None


def test_funding_de_una_moneda_que_cobra_cada_hora():
    # 0.00003 cada hora: 72 cobros en (T0, T0 + 72 h] → 0.00216 / 9 = 0.00024 por 8 h > 0.0001:
    # el largo va con la multitud.
    b = una_vela(T0 + 72 * HORA)
    s = funding([0.00003] * 100, paso=HORA)
    r = filtro_multitud("COTIUSDT", TF, b, 0, 1, "nocon", serie=s)
    assert r.pasa is False and r.valor["funding"] == A(0.00024)


# ------------------------------------------------------------------ OI sostenido

def sostenido(subidas, bajadas, iguales=0, quitar=()):
    """Serie de 4 h desde T0 con 85 puntos (84 pasos): primero `subidas` pasos de +1, después
    `iguales` de 0 y después `bajadas` de −1. `quitar`: puntos que faltan."""
    vals = [1000.0]
    for d in [1] * subidas + [0] * iguales + [-1] * bajadas:
        vals.append(vals[-1] + d)
    assert len(vals) == 85
    return Serie([(T0 + j * PASO_4H, v) for j, v in enumerate(vals) if j not in set(quitar)], PASO_4H)


CIERRE_84 = T0 + 84 * PASO_4H     # 14 días después de T0: el punto 84


def test_oi_sostenido_pasa_con_la_mayoria_de_los_pasos():
    # vela de 4 h que cierra en el punto 84. 14 días = 84 pasos; 50 suben → 50/84 = 0.595 >= 0.52.
    # No depende del lado.
    b = una_vela(CIERRE_84)
    pasa, parte = filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52, serie=sostenido(50, 34))
    assert pasa is True and parte == A(50 / 84)
    assert filtro_oi_sostenido("SOLUSDT", TF, b, 0, -1, 14, 0.52, serie=sostenido(50, 34)).pasa is True


def test_oi_sostenido_en_el_borde_del_umbral():
    # 43 de 84 = 0.5119 < 0.52 → no pasa; 44 de 84 = 0.5238 >= 0.52 → pasa.
    b = una_vela(CIERRE_84)
    assert filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52, serie=sostenido(43, 41)).pasa is False
    assert filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52, serie=sostenido(44, 40)).pasa is True


def test_oi_sostenido_un_paso_igual_no_sube():
    # 43 suben, 1 queda igual y 40 bajan: 43/84 = 0.5119 → no pasa (si el igual contara, 44/84 pasaría).
    b = una_vela(CIERRE_84)
    r = filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52, serie=sostenido(43, 40, iguales=1))
    assert r.pasa is False and r.valor == A(43 / 84)


def test_oi_sostenido_umbral_escrito_en_porcentaje():
    # la ventana muestra 52 (%): vale lo mismo que 0.52.
    b = una_vela(CIERRE_84)
    assert filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 52, serie=sostenido(44, 40)).pasa is True
    assert filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 52, serie=sostenido(43, 41)).pasa is False


def test_oi_sostenido_con_huecos():
    # faltan los puntos 30 a 49 (20): quedan los pasos 1..29 y 51..84 = 29 + 34 = 63 < 0.8·84 =
    # 67.2 → sin dato. El salto de 29 a 50 no es un paso de 4 h.
    b = una_vela(CIERRE_84)
    r = filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52,
                            serie=sostenido(50, 34, quitar=range(30, 50)))
    assert r.pasa is None
    # faltan 30 a 39 (10): pasos 1..29 (todos suben) y 41..84 (suben 41..50, diez) = 73 >= 67.2.
    # suben 29 + 10 = 39 → 39/73 = 0.534 >= 0.52 → pasa.
    r2 = filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52,
                             serie=sostenido(50, 34, quitar=range(30, 40)))
    assert r2.pasa is True and r2.valor == A(39 / 73)


def test_oi_sostenido_en_15m_cuenta_desde_el_ultimo_punto():
    # vela de 15m que cierra 15 min después del punto 84: el último OI de 4 h conocido es el 84 →
    # los mismos 84 pasos: 50/84.
    b = una_vela(CIERRE_84 + 15 * 60_000, tf=15)
    r = filtro_oi_sostenido("SOLUSDT", 15, b, 0, 1, 14, 0.52, serie=sostenido(50, 34))
    assert r.pasa is True and r.valor == A(50 / 84)


def test_oi_sostenido_sin_punto_reciente():
    # la serie termina en el punto 84 y la vela cierra 5 h después: no hay OI de 4 h al cierre.
    b = una_vela(CIERRE_84 + 5 * HORA)
    assert filtro_oi_sostenido("SOLUSDT", TF, b, 0, 1, 14, 0.52, serie=sostenido(50, 34)).pasa is None


# ------------------------------------------------------------------ flujos on-chain

def dia(i):
    return T0 + i * DIA


def usdt_alterno():
    """USDT de 1,000 el día 0, +1 % los días impares y −1 % los pares hasta el 180, y +2 % el 181."""
    s = [1000.0]
    for d in range(1, 181):
        s.append(s[-1] * (1.01 if d % 2 else 0.99))
    s.append(s[-1] * 1.02)
    return [[dia(i), v] for i, v in enumerate(s)]


def flujos(signo):
    """Saldo fijo de 1,000 en exchanges. Días 1..180: entran 10 (impares) o salen 10 (pares) si
    signo = +1, al revés si −1. Día 181: salen 20 (signo +1) o entran 20 (signo −1)."""
    ent, sal = [], []
    for d in range(0, 182):
        neto = 0.0 if d == 0 else (signo * 10.0 if d % 2 else -signo * 10.0)
        if d == 181:
            neto = -signo * 20.0
        ent.append([dia(d), max(neto, 0.0)])
        sal.append([dia(d), max(-neto, 0.0)])
    return {"FlowInExNtv": ent, "FlowOutExNtv": sal, "SplyExNtv": [[dia(d), 1000.0] for d in range(182)]}


EMISION_1D = {"metric": "stable", "days": 1, "z": 0.5, "mode": "favor", "asset": "auto"}


def test_emision_z_y_lado():
    # crecimiento de 1 día: +1 % y −1 % alternados en los días 1 a 180 (90 y 90: media 0,
    # desviación 1) y +2 % el día 181 → z = (2 − 0)/1 = +2.
    # La vela de 4 h cierra en el día 181 + 30 h (06:00 del día 182): ya usa el día 181.
    # favor z 0.5: largo 2 >= 0.5 pasa; corto −2 >= 0.5 no.
    datos = {"usdt": {"SplyCur": usdt_alterno()}}
    b = una_vela(dia(181) + 30 * HORA)
    pasa, valor = filtro_onchain("SOLUSDT", TF, b, 0, 1, EMISION_1D, datos=datos)
    assert pasa is True and valor["dia"] == dia(181)
    assert valor["medida"] == A(2.0) and valor["z"] == A(2.0, abs=1e-9)
    assert filtro_onchain("SOLUSDT", TF, b, 0, -1, EMISION_1D, datos=datos).pasa is False
    # nocontra z 0.5: corto −2 > −0.5 no; largo sí.
    nc = dict(EMISION_1D, mode="nocontra")
    assert filtro_onchain("SOLUSDT", TF, b, 0, -1, nc, datos=datos).pasa is False
    assert filtro_onchain("SOLUSDT", TF, b, 0, 1, nc, datos=datos).pasa is True
    # z 2.5: largo favor 2 >= 2.5 no; nocontra, largo 2 > −2.5 sí y corto −2 > −2.5 también.
    assert filtro_onchain("SOLUSDT", TF, b, 0, 1, dict(EMISION_1D, z=2.5), datos=datos).pasa is False
    nc25 = dict(EMISION_1D, mode="nocontra", z=2.5)
    assert filtro_onchain("SOLUSDT", TF, b, 0, 1, nc25, datos=datos).pasa is True
    assert filtro_onchain("SOLUSDT", TF, b, 0, -1, nc25, datos=datos).pasa is True


def test_onchain_hora_de_publicacion_y_180_dias():
    # la vela que cierra 4 h antes (02:00 del día 182 = día 181 + 26 h) todavía no puede usar el
    # día 181: usa el 180, cuyo z solo tiene 179 días antes (1 a 179) < 180 → sin dato.
    datos = {"usdt": {"SplyCur": usdt_alterno()}}
    b = una_vela(dia(181) + 26 * HORA)
    r = filtro_onchain("SOLUSDT", TF, b, 0, 1, EMISION_1D, datos=datos)
    assert r.pasa is None and r.valor["dia"] == dia(180) and r.valor["z"] is None


def test_onchain_sin_datos_nuevos_en_3_dias():
    # el día 181 se usa desde el día 181 + 30 h y es el último dato. Una vela que cierra 72 h
    # después todavía lo usa (no pasa de 3 días); la que cierra 76 h después ya no: sin dato.
    datos = {"usdt": {"SplyCur": usdt_alterno()}}
    desde = dia(181) + 30 * HORA
    assert filtro_onchain("SOLUSDT", TF, una_vela(desde + 72 * HORA), 0, 1, EMISION_1D,
                          datos=datos).pasa is True
    assert filtro_onchain("SOLUSDT", TF, una_vela(desde + 76 * HORA), 0, 1, EMISION_1D,
                          datos=datos).pasa is None


def test_emision_usdc_cuenta_desde_que_tiene_dato():
    # USDC aparece el día 181 con 500 (sin dato, o en 0, el 180): no entra en la ventana del día
    # 181 → la medida sigue en +2 %. Si contara como 0 al empezar, daría (S181 + 500)/S180 − 1.
    for usdc in ([[dia(181), 500.0]], [[dia(180), 0.0], [dia(181), 500.0]]):
        datos = {"usdt": {"SplyCur": usdt_alterno()}, "usdc": {"SplyCur": usdc}}
        r = filtro_onchain("SOLUSDT", TF, una_vela(dia(181) + 30 * HORA), 0, 1, EMISION_1D,
                           datos=datos)
        assert r.valor["medida"] == A(2.0) and r.pasa is True


def test_emision_de_dos_dias_a_mano():
    # ventana de 2 días que termina el día 12 (empieza al cerrar el 10): USDT 100 → 110 y
    # USDC 50 → 55 → (110 + 55 − 150)/150 = +10 %. En dólares ("abs"): +15.
    datos = {"usdt": {"SplyCur": [[dia(10), 100.0], [dia(11), 105.0], [dia(12), 110.0]]},
             "usdc": {"SplyCur": [[dia(10), 50.0], [dia(11), 52.0], [dia(12), 55.0]]}}
    assert medidas_emision(datos, 2)[dia(12)] == A(10.0)
    assert medidas_emision(datos, 2, en="abs")[dia(12)] == A(15.0)
    assert dia(11) not in medidas_emision(datos, 2)      # le falta el día 9


def test_flujo_neto_de_dos_dias_a_mano():
    # saldo en exchanges al cerrar el día 10 = 500 (antes de la ventana 11–12).
    # día 11: entran 30 y salen 10 (+20); día 12: entran 5 y salen 45 (−40). Neto −20: salen 20.
    # medida = −(−20)/500·100 = +4 %.
    btc = {"FlowInExNtv": [[dia(11), 30.0], [dia(12), 5.0]],
           "FlowOutExNtv": [[dia(11), 10.0], [dia(12), 45.0]],
           "SplyExNtv": [[dia(10), 500.0], [dia(11), 520.0], [dia(12), 480.0]]}
    assert medidas_neto({"btc": btc}, "btc", 2)[dia(12)] == A(4.0)
    # con 1 día: el 12 contra el saldo del 11 → −(−40)/520·100 = +7.692 %.
    assert medidas_neto({"btc": btc}, "btc", 1)[dia(12)] == A(40 / 520 * 100)


def test_flujo_neto_z_y_activo_auto():
    # BTC: entran 10 los días impares y salen 10 los pares (1 a 180), saldo 1,000 → medida −1 y +1
    # (media 0, desviación 1); el día 181 salen 20 → +2 → z = +2.
    # ETH, al revés: el día 181 entran 20 → −2 → z = −2.
    # Largo, favor z 0.5: SOLUSDT (auto → BTC) pasa; ETHUSDT (auto → ETH) no; SOLUSDT con
    # asset "eth" tampoco.
    datos = {"btc": flujos(+1), "eth": flujos(-1)}
    neto = {"metric": "net", "days": 1, "z": 0.5, "mode": "favor", "asset": "auto"}
    b = una_vela(dia(181) + 30 * HORA)
    r = filtro_onchain("SOLUSDT", TF, b, 0, 1, neto, datos=datos)
    assert r.pasa is True and r.valor["medida"] == A(2.0) and r.valor["z"] == A(2.0)
    r_eth = filtro_onchain("ETHUSDT", TF, b, 0, 1, neto, datos=datos)
    assert r_eth.pasa is False and r_eth.valor["z"] == A(-2.0)
    assert filtro_onchain("SOLUSDT", TF, b, 0, 1, dict(neto, asset="eth"), datos=datos).pasa is False
    # el corto en ETH sí tiene el flujo a favor: −2·(−1) = 2 >= 0.5.
    assert filtro_onchain("ETHUSDT", TF, b, 0, -1, neto, datos=datos).pasa is True


def test_activo_auto():
    assert activo_de("ETHUSDT") == "eth"
    for m in ("BTCUSDT", "SOLUSDT", "LINKUSDT", "ETCUSDT", "ENSUSDT"):
        assert activo_de(m) == "btc", m


# ------------------------------------------------------------------ la regla entera

def test_evaluar_filtros_de_una_regla():
    # 3 velas de 4 h (k = 2), las del primer caso del VWAP con delta: VWAP 3 = 102.5 y cierre 104
    # → la línea pasa en el largo; CVD 3 = (5 − 2 + 4)/(1 + 1 + 2) = 7/4 > 0 → pasa.
    # OI: puntos 1..3 = 100, 101, 103 → al cierre de la vela 2 (punto 3) contra la vela 0 (punto 1):
    # +3 % > 2 en 2 velas → pasa. Funding plano de 0.0001 → neutro → "nocon" pasa.
    # La vela 2 cierra en T0 + 12 h: la ventana del funding es (T0 − 60 h, T0 + 12 h].
    b = velas((100, 101, 99, 100, 1.0, 5), (101, 103, 101, 102, 1.0, -2), (103, 105, 103, 104, 2.0, 4))
    regla = {"lines": [VWAP(3)], "flow": {"cvd": 3, "oi": "rise", "oiPct": 2, "oiBars": 2,
                                          "crowd": "nocon"}}
    s_oi = oi_4h([100, 100, 101, 103])
    s_f = funding([0.0001] * 30, t0=T0 - 120 * HORA)
    todos, det = evaluar_filtros("SOLUSDT", TF, b, 2, 1, regla, oi=s_oi, funding=s_f)
    assert todos is True and sorted(det) == ["cvd", "linea1", "multitud", "oi"]
    assert det["cvd"].valor == A(7 / 4) and det["oi"].valor == A(3.0)
    # en corto: la línea y el CVD fallan; el OI (sube) y la multitud (neutra) pasan.
    todos_c, det_c = evaluar_filtros("SOLUSDT", TF, b, 2, -1, regla, oi=s_oi, funding=s_f)
    assert todos_c is False
    assert [det_c[n].pasa for n in ("linea1", "cvd", "oi", "multitud")] == [False, False, True, True]
    # un filtro sin dato tampoco deja pasar: el OI sin el punto 3.
    s_oi2 = Serie([(T0 + j * PASO_4H, 100.0) for j in range(3)], PASO_4H)
    todos2, det2 = evaluar_filtros("SOLUSDT", TF, b, 2, 1, regla, oi=s_oi2, funding=s_f)
    assert todos2 is False and det2["oi"].pasa is None


# ------------------------------------------------------------------ lectura de los datos crudos
# Solo lectura de OrderFlowData; se saltan si no está. Comprueban formatos vistos el 21/11/2026.

def _hay(*partes):
    return (fa.DATOS.joinpath(*partes)).is_file()


@pytest.mark.skipif(not (_hay("oi", "BTCUSDT_4h.json") and _hay("oi", "BTCUSDT_5min.csv")),
                    reason="sin OI de BTC en OrderFlowData")
def test_datos_reales_oi_de_btc_4h_y_5min_coinciden():
    # 01/01/2024 00:00 UTC está en las dos series y el valor es el mismo (se vio en 13,707 de
    # 13,708 puntos comunes). La de 5 minutos viene de lo nuevo a lo viejo: queda ordenada.
    s4, s5 = fa.serie_oi_4h("BTCUSDT"), fa.serie_oi_5min("BTCUSDT")
    assert s4.paso == PASO_4H and s5.paso == PASO_5MIN
    assert s5.t == sorted(s5.t) and s4.t == sorted(s4.t)
    assert s4.al(T0) == A(s5.al(T0), abs=1e-6)


@pytest.mark.skipif(not _hay("funding", "BTCUSDT.json"), reason="sin funding de BTC")
def test_datos_reales_funding_de_btc():
    # BTC cobra cada 8 h, en fracción (0.0001 = 0.01 %): el promedio de 3 días es chico.
    s = fa.serie_funding("BTCUSDT")
    assert all(b - a == 8 * HORA for a, b in zip(s.t[-50:], s.t[-49:]))
    f = fa.funding_3d(s, T0)
    assert f is not None and abs(f) < 0.003


@pytest.mark.skipif(not _hay("onchain", "coinmetrics.json"), reason="sin Coin Metrics")
def test_datos_reales_coin_metrics():
    # días a las 00:00 UTC, y el saldo de BTC cambia lo que dicen sus flujos del día.
    d = fa.datos_onchain()
    assert set(d) >= {"btc", "eth", "usdt", "usdc"}
    s = {t: v for t, v in d["btc"]["SplyExNtv"]}
    i = {t: v for t, v in d["btc"]["FlowInExNtv"]}
    o = {t: v for t, v in d["btc"]["FlowOutExNtv"]}
    assert all(t % DIA == 0 for t in list(s)[:100])
    assert s[T0] - s[T0 - DIA] == A(i[T0] - o[T0], abs=1e-3)
    r = filtro_onchain("BTCUSDT", TF, una_vela(T0 + 30 * HORA), 0, 1,
                       {"metric": "stable", "days": 7, "z": 0.5, "mode": "favor", "asset": "auto"})
    assert r.pasa in (True, False) and math.isfinite(r.valor["z"])
