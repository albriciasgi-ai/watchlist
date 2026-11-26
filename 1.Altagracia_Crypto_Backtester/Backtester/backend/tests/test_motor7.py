"""
Motor 7 del probador (23 y 24/11/2026): lo que decidió el usuario en la galería del protocolo de pruebas
(pruebas_backtesting/revision_visual/G1_RESPUESTAS.md) y los fallos que salieron de ella.

- Patrones de vela: con tamaño (minPart ATR) y en un swing confirmado (swingBefore y swingAfter velas).
- Ruptura de caja: el primer cierre afuera; una caja que termina por su eficiencia no da ruptura (F-18).
- Borde de caja: el rearme va después de mirar la llegada de la vela (F-19); la franja de fábrica es el 5%.
- Filtro de régimen "tras romper": sin las cajas que terminan por su eficiencia (F-18).
- Cambio de carácter: el swing que originó el último tramo, la tendencia confirmada por cierres y el extremo de la
  tendencia desde su vela (F-20).
- Qué corridas guardadas deja fuera (_stale).

- Lector VPA (24/11, galería 2): el volumen alto de los elementos también frente a las velas anteriores, el esfuerzo sin
  resultado no tras una vela ancha, la prueba dentro de una caja y tras un frenado o un clímax, el frenado con mecha de
  media vela, el retroceso con una vela en contra y los elementos nuevos (esfuerzo con resultado y el giro del medidor).
  Después, por el caso 2 de esa galería: la vela ancha con volumen alto tuvo resultado.

(El rombo del Volumen de Respuesta, solo cuando sube la respuesta, está en test_response_volume.py y response.test.mjs;
la paridad del lector VPA con vpa.js, en vpa.parity.test.mjs.)

Uso: python -m pytest tests/test_motor7.py
"""
import numpy as np
import pytest

import random

import box_elements
import regime
import regime_detectors
import rule_tester as rt
import structure
import vpa

TF = 240
MS = TF * 60000


def velas(rows):
    return [{"t": k * MS, "o": float(o), "h": float(h), "l": float(l), "c": float(c), "vol": 100.0} for k, (o, h, l, c) in enumerate(rows)]


# ==================== Patrones de vela ====================

def martillo(siguientes=((88.5, 89.5, 88.2, 89.3), (89.3, 90.2, 89.0, 90.0))):
    """12 velas rojas que bajan de a 1 y un martillo en la vela 12 (mecha de abajo de 1.6, el mínimo de todas), con dos
    velas después."""
    rows = [(100 - k, 100.2 - k, 98.8 - k, 99 - k) for k in range(12)]
    rows.append((87.9, 88.6, 86.3, 88.5))
    rows.extend(siguientes)
    rows.extend([(90.0, 91.2, 89.8, 91.0), (91.0, 92.1, 90.7, 92.0)])
    return velas(rows)


def patrones(bars, **pat):
    rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["HM"]}]}, "pat": pat})
    return [e for e in rt._pattern_events(rule, {"bars": bars}) if e["t"] == bars[12]["t"]]


def test_de_fabrica_los_patrones_piden_tamano_y_swing_confirmado():
    rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["HM"]}]}})
    assert rule["pat"]["minPart"] == 0.5 and rule["pat"]["swingBefore"] == 5 and rule["pat"]["swingAfter"] == 2
    bars = martillo()
    (e,) = patrones(bars)
    # Se conoce al cerrar la 2.ª vela después del martillo, y el stop por la vela del elemento cubre desde el martillo
    assert e["code"] == "HM" and e["dir"] == 1 and e["known"] == bars[14]["t"] + MS
    assert e["first"] == bars[12]["t"] and e["info"]["confirmed"] == bars[14]["t"] and e["info"]["partAtr"] > 0.5
    # Sin los filtros, como hasta el motor 6: se conoce al cerrar el martillo y no lleva primera vela aparte
    (old,) = patrones(bars, minPart=0, swingBefore=0, swingAfter=0)
    assert old["known"] == bars[12]["t"] + MS and "first" not in old


def test_un_patron_chico_o_que_no_queda_en_un_swing_no_cuenta():
    bars = martillo()
    assert patrones(bars, minPart=3.0) == [], "la mecha (1.6) no llega a 3 ATR"
    # La vela 14 baja a 86.2, más allá del mínimo del martillo: no es un swing (un empate tampoco lo sería)
    passed = martillo(siguientes=((88.5, 89.5, 88.2, 89.3), (89.3, 90.2, 86.2, 90.0)))
    assert patrones(passed) == []
    tie = martillo(siguientes=((88.5, 89.5, 86.3, 89.3), (89.3, 90.2, 89.0, 90.0)))
    assert patrones(tie) == []
    # Pidiendo solo una vela de confirmación, la que pasa el mínimo en la 14 ya no importa
    (e,) = patrones(passed, swingAfter=1)
    assert e["known"] == passed[13]["t"] + MS


# ==================== Cajas ====================

@pytest.fixture
def caja(monkeypatch):
    """Una caja de 100 a 110 (detectada en la vela 5, termina en la 15) y el ATR en 1."""
    zones = []

    def fake_box(a, **params):
        state = np.zeros(len(a["c"]), dtype=bool)
        for z in zones:
            state[z["start"]:z["end"] + 1] = True
        return {"state": state, "zones": [dict(z) for z in zones]}

    monkeypatch.setattr(regime_detectors, "er_box", fake_box)
    monkeypatch.setattr(regime, "atr", lambda h, l, c, *args, **kw: np.ones(len(c)))
    return zones


def adentro(n):
    return [(105, 106, 104, 105)] * n


def test_la_ruptura_es_el_primer_cierre_afuera_y_no_la_vela_que_sigue_a_la_caja(caja):
    caja.append({"start": 0, "detected": 5, "end": 15, "low": 100.0, "high": 110.0})
    # La vela 10 cierra en 110.3: afuera, aunque a menos de 0.5 ATR (la caja sigue); la ruptura es esa vela
    rows = adentro(10) + [(108, 110.6, 107.5, 110.3)] + adentro(10)
    (e,) = [x for x in box_elements.events(velas(rows), TF, bx={}) if x["code"] == "BX"]
    assert e["t"] == 10 * MS and e["dir"] == 1 and e["info"]["bars"] == 10


def test_una_caja_que_termina_por_su_eficiencia_sin_cierre_afuera_no_da_ruptura(caja):
    caja.append({"start": 0, "detected": 5, "end": 15, "low": 100.0, "high": 110.0})
    rows = adentro(25)  # Hasta la vela 16 (la que sigue al final) todo cierra adentro
    assert [x for x in box_elements.events(velas(rows), TF, bx={}) if x["code"] == "BX"] == []


def test_el_borde_se_rearma_despues_de_mirar_la_llegada_de_la_vela(caja):
    caja.append({"start": 0, "detected": 5, "end": 15, "low": 100.0, "high": 110.0})
    rows = adentro(10) + [
        (108.6, 109.8, 108.0, 108.2),   # 10: llega a la franja de arriba (5%: desde 109.5) y cierra lejos: llegada
        (106.0, 109.6, 105.2, 105.5),   # 11: vuelve a tocarla, ya gastada, y cierra en el centro: rearma después
        (105.6, 109.7, 105.4, 106.0),   # 12: llegada nueva
    ] + adentro(5)
    be = {"share": 0.05, "maxBody": 1.0, "rejection": 0.6}
    got = [x["t"] // MS for x in box_elements.events(velas(rows), TF, be=be) if x["code"] == "BE"]
    assert got == [10, 12], "el toque de la vela 11 fue antes de volver al centro: no es una llegada nueva (F-19)"
    assert rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["BE"]}]}})["be"]["share"] == 0.05


def test_el_filtro_tras_romper_no_cuenta_las_cajas_que_terminan_por_su_eficiencia(caja):
    n = 60
    closes = np.full(n, 105.0)
    closes[31] = 115.0  # La segunda caja termina con un cierre a más de 0.5 ATR afuera
    a = {"h": closes + 1, "l": closes - 1, "c": closes}
    caja.extend([{"start": 0, "detected": 5, "end": 20, "low": 100.0, "high": 110.0},     # termina por su eficiencia
                 {"start": 22, "detected": 25, "end": 30, "low": 100.0, "high": 110.0}])  # la rompe el precio
    ok = rt._regime_ok(a, {"mode": "breakout", "major": False, "after": 3})
    assert not ok[21:24].any(), "después de la primera no hubo ruptura (F-18)"
    assert ok[31:34].all() and not ok[34]


# ==================== Cambio de carácter ====================

BAJISTA = [  # Máximos 120, 116 y el rebote de 109; mínimos 110 y 104 (con cierres bajo 110)
    (118, 118.5, 117, 117.5), (117.5, 119, 117, 118.5), (118.5, 120, 117.5, 118), (118, 118.8, 115, 115.5),
    (115.5, 116, 112, 112.5), (112.5, 113, 110, 111), (111, 113.5, 110.5, 113), (113, 115, 112, 114.5),
    (114.5, 116, 113, 113.5), (113.5, 114, 108, 108.5), (108.5, 109, 105.5, 106), (106, 106.5, 104, 104.5),
    (104.5, 107, 105, 106.5), (106.5, 108, 106, 107.5), (107.5, 109, 107, 108), (108, 108.5, 106.5, 107),
    (107, 107.8, 106.8, 107.5), (107.5, 110.5, 107.2, 110), (110, 112.5, 109.5, 112), (112, 114.5, 111.5, 114),
    (114, 117.5, 113.5, 117), (117, 118, 116, 117.5)]


def test_el_cambio_de_caracter_rompe_el_swing_que_origino_el_tramo():
    bars = velas(BAJISTA)
    # Hasta el motor 6: el último máximo (el rebote de 109) se rompe en la vela 17
    (old,) = structure.events(bars, TF, TF, 0, swing=2, legs=2, ref="last", closes=False)
    assert old["t"] == 17 * MS and old["dir"] == 1 and old["info"]["level"] == 109
    # Ahora: el máximo que originó la última caída (116) se rompe recién en la vela 20, y el extremo de la tendencia es
    # el mínimo de 104 (vela 11), desde su vela
    (new,) = structure.events(bars, TF, TF, 0, swing=2, legs=2)
    assert new["t"] == 20 * MS and new["info"]["level"] == 116 and new["info"]["levelT"] == 8 * MS
    assert new["info"]["extreme"] == 104 and new["info"]["extremeT"] == 11 * MS and new["lo"] == 104
    rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["CC"]}]}})
    assert rule["cc"]["ref"] == "origin" and rule["cc"]["closes"] is True


def test_un_maximo_mas_alto_hecho_solo_con_la_mecha_no_sube_la_tendencia():
    bars = velas([  # Máximos 103 y 104 (solo mecha: ningún cierre pasa 103); mínimos 97 y 98; la vela 14 cierra en 96.5
        (100, 101, 99, 100.5), (100.5, 102, 100, 101.5), (101.5, 103, 101, 102), (102, 102.5, 100.5, 101),
        (101, 101.5, 98, 98.5), (98.5, 99, 97, 97.5), (97.5, 99.5, 97.5, 99), (99, 101, 98.5, 100.5),
        (100.5, 104, 100, 102.5), (102.5, 103, 100.5, 101), (101, 101.5, 99, 99.5), (99.5, 100, 98, 98.5),
        (98.5, 100.5, 98.5, 100), (100, 101, 99.5, 100.5), (100.5, 100.8, 96, 96.5)])
    assert structure.events(bars, TF, TF, 0, swing=2, legs=2) == []
    (e,) = structure.events(bars, TF, TF, 0, swing=2, legs=2, closes=False)
    assert e["t"] == 14 * MS and e["dir"] == -1 and e["info"]["level"] == 97


# ==================== Corridas guardadas ====================

def test_el_motor_7_deja_fuera_solo_las_corridas_que_usan_lo_que_cambio():
    def record(engine, codes=("FV",), **rule):
        return {"engine": engine, "rule": {"recipe": {"slots": [{"codes": list(codes)}]}, **rule}}

    assert rt.ENGINE >= 7  # El motor 8 (galería 4) deja fuera otras corridas: test_motor8.py
    assert rt._stale(record(5))
    assert not rt._stale(record(6)), "una regla con el FVG no cambia"
    for code in ("HM", "EN", "DJ", "RB", "BX", "BE", "CC", "QA", "QB", "QR", "QT", "QS", "QC", "QE"):
        assert rt._stale(record(6, (code,))) and not rt._stale(record(7, (code,)))
    assert not rt._stale(record(6, ("RF",))), "la flecha no cambió"
    assert not rt._stale(record(6, ("QF",))), "la ruptura sin volumen no cambió"
    # El medidor lee la vela ancha con volumen alto como los elementos (wideMeter): su filtro y su aviso cambian
    assert rt._stale(record(6, vpaf={"mode": "favor", "thr": 1.0}))
    assert rt._stale(record(6, vpaf={"mode": "notFavor", "thr": 1.0, "tf": 240})), "también leído en un marco mayor"
    assert not rt._stale(record(7, vpaf={"mode": "favor", "thr": 1.0}))
    assert rt._stale(record(6, exit={"vpa": {"on": ["climax"], "fromR": 0}})), "la salida VPA lee el clímax y el frenado"
    assert rt._stale(record(6, exit={"vpa": {"on": ["absorb", "meter"], "fromR": 0}}))
    assert rt._stale(record(6, exit={"vpa": {"on": ["meter"], "fromR": 0}})), "el aviso del medidor"
    assert not rt._stale(record(6, exit={"vpa": {"on": ["fade"], "fromR": 0}})), "el esfuerzo que se agota no cambió"
    assert rt._stale(record(6, regime={"mode": "breakout", "major": False}))
    assert not rt._stale(record(6, regime={"mode": "breakout", "major": True}))
    assert rt._stale(record(6, filters=[{"key": "since_signal_4h", "op": "<=", "value": 3}]))
    assert not rt._stale(record(6, filters=[{"key": "leg_age_4h", "op": "<=", "value": 3}]))


# ==================== Lector VPA (galería 2) ====================

BEFORE = {"nearBars": 0, "skipAfterWide": False, "wideResult": False, "wideMeter": False, "testBox": False,
          "testAfter": False, "stopWick": [0.25, 0.4], "pullBack": False}


def cols(bars):
    return ([b["t"] for b in bars], [b["o"] for b in bars], [b["h"] for b in bars], [b["l"] for b in bars],
            [b["c"] for b in bars], [b["vol"] for b in bars])


def calmas(n, vol=1000.0, rango=2.0, desde=0):
    """Velas iguales (verdes, de `rango` de alto) con el mismo volumen a toda hora."""
    return [{"t": (desde + i) * MS, "o": 100.0, "h": 100.0 + rango / 2, "l": 100.0 - rango / 2, "c": 100.3, "vol": vol}
            for i in range(n)]


def codigos(bars, code, **cfg):
    return [e for e in vpa.detect(*cols(bars), TF, cfg) if e["code"] == code]


def test_el_volumen_alto_de_los_elementos_lo_es_tambien_frente_a_las_velas_anteriores():
    """El caso del esfuerzo 21: alto para su hora, pero las 20 velas anteriores tuvieron más."""
    base = calmas(6 * 30)
    agitadas = calmas(20, vol=3000.0, desde=len(base))
    n = len(base) + len(agitadas)
    estrecha = {"t": n * MS, "o": 100.0, "h": 100.25, "l": 99.85, "c": 100.2, "vol": 2500.0}
    bars = base + agitadas + [estrecha]
    s = vpa.compute(*cols(bars), TF)
    assert s["rv"][n] == pytest.approx(2.5) and s["rvn"][n] == pytest.approx(2500 / 3000)
    assert s["absorb"][n] == 1.0, "para su hora es esfuerzo sin resultado (y el medidor lo cuenta)"
    assert s["absorbE"][n] == 0.0 and not [e for e in codigos(bars, "QA") if e["index"] == n]
    assert [e for e in codigos(bars, "QA", **BEFORE) if e["index"] == n], "con la regla de antes, sí"
    # Tras velas tranquilas, la misma vela sí lo es
    calma = base + calmas(20, desde=len(base)) + [estrecha]
    (e,) = [e for e in codigos(calma, "QA") if e["index"] == n]
    assert e["dir"] == -1 and e["info"]["rvn"] == pytest.approx(2.5)


def test_el_esfuerzo_sin_resultado_no_cuenta_tras_una_vela_ancha():
    """El caso del esfuerzo 48: la vela anterior tuvo volumen y rango; la señalada es su pausa."""
    base = calmas(6 * 30)
    n = len(base)
    ancha = {"t": n * MS, "o": 100.0, "h": 105.2, "l": 99.8, "c": 105.0, "vol": 2500.0}
    estrecha = {"t": (n + 1) * MS, "o": 105.0, "h": 105.3, "l": 104.9, "c": 105.2, "vol": 3000.0}
    bars = base + [ancha, estrecha]
    s = vpa.compute(*cols(bars), TF)
    assert s["wide"][n] == 1.0 and s["absorbE"][n + 1] == 1.0
    assert not [e for e in codigos(bars, "QA") if e["index"] == n + 1]
    assert [e for e in codigos(bars, "QA", skipAfterWide=False) if e["index"] == n + 1]
    # La ancha es esfuerzo con resultado: el elemento nuevo, a favor de su color
    (v,) = [e for e in codigos(bars, "QV") if e["index"] == n]
    assert v["dir"] == 1 and v["grade"] >= 0.5


def test_la_vela_ancha_con_volumen_alto_tuvo_resultado():
    """El caso 2 de la galería 2 (17/04/21): una roja de 10 veces su rango con 20 veces su volumen y cuerpo grande.
    Por la proporción era esfuerzo sin resultado; se movió, y el precio siguió bajando: es esfuerzo con resultado."""
    base = calmas(6 * 30)
    n = len(base)
    grande = {"t": n * MS, "o": 109.0, "h": 110.0, "l": 90.0, "c": 97.0, "vol": 20000.0}
    bars = base + [grande]
    s = vpa.compute(*cols(bars), TF)
    assert s["rr"][n] == pytest.approx(10) and s["rvn"][n] == pytest.approx(20) and s["wide"][n] == 1.0
    assert s["absorbE"][n] == 0.0 and s["validE"][n] == 1.0
    # El medidor la lee igual (wideMeter): le resta como esfuerzo con resultado de una roja, en vez de sumarle
    assert s["absorb"][n] == 0.0 and s["valid"][n] == 1.0
    assert s["contrib"][n] == pytest.approx(-vpa.W_VALID) and s["meter"][n] < s["meter"][n - 1]
    before = vpa.compute(*cols(bars), TF, {"wideMeter": False})
    assert before["absorb"][n] == pytest.approx(0.2 / 0.35) and before["valid"][n] == 0.0
    assert before["contrib"][n] > 0 and before["meter"][n] > before["meter"][n - 1], "antes, la roja subía el medidor"
    assert before["absorbE"][n] == s["absorbE"][n] and before["validE"][n] == s["validE"][n], "los elementos no dependen de él"
    assert not [e for e in codigos(bars, "QA") if e["index"] == n]
    (v,) = [e for e in codigos(bars, "QV") if e["index"] == n]
    assert v["dir"] == -1 and v["grade"] == 1.0, "a favor de su color"
    # Con la regla de antes era esfuerzo sin resultado, contra su color, y no con resultado
    (a,) = [e for e in codigos(bars, "QA", wideResult=False) if e["index"] == n]
    assert a["dir"] == 1 and not [e for e in codigos(bars, "QV", wideResult=False) if e["index"] == n]
    # El caso 68 (Sí): algo más ancha que lo normal, con mucho más volumen, sigue siendo esfuerzo sin resultado
    algo = {"t": n * MS, "o": 101.0, "h": 101.3, "l": 98.7, "c": 99.5, "vol": 3000.0}
    s = vpa.compute(*cols(base + [algo]), TF)
    assert s["rr"][n] == pytest.approx(1.3) and 0 < s["wide"][n] < 0.5
    (a,) = [e for e in codigos(base + [algo], "QA") if e["index"] == n]
    assert a["dir"] == 1 and a["grade"] == s["absorb"][n]
    assert not [e for e in codigos(base + [algo], "QV") if e["index"] == n]


def paseo(n, seed):
    rnd = random.Random(seed)
    bars, price, drift = [], 100.0, 0.0
    for i in range(n):
        if i % 60 == 0:
            drift = (rnd.random() - 0.5) * 0.01
        o = price
        c = o * (1 + drift + (rnd.random() - 0.5) * 0.02)
        up_w = rnd.random() * 0.03 if rnd.random() < 0.15 else rnd.random() * 0.006
        dn_w = rnd.random() * 0.03 if rnd.random() < 0.15 else rnd.random() * 0.006
        vol = (100 + rnd.random() * 900) * (4 if rnd.random() < 0.1 else 0.3 if rnd.random() < 0.2 else 1)
        bars.append({"t": i * MS, "o": o, "h": max(o, c) * (1 + up_w), "l": min(o, c) * (1 - dn_w), "c": c, "vol": vol})
        price = c
    return bars


def test_la_caja_de_la_prueba_es_la_de_la_pestana_regimen():
    assert regime_detectors.PARAMS["er_box"]["params"] == {**vpa.BOX, "min_bars": 1}
    bars = paseo(4000, 21)
    t, o, h, l, c, v = cols(bars)
    low, high = vpa.boxes(h, l, c, vpa.atr_of(h, l, c, 14))
    a = {"o": np.array(o), "h": np.array(h), "l": np.array(l), "c": np.array(c)}
    zones = regime_detectors.er_box(a, **regime_detectors.PARAMS["er_box"]["params"])["zones"]
    assert len(zones) > 20
    expected = [None] * len(bars)
    for z in zones:
        for i in range(z["detected"] + 1, min(z["end"] + 1, len(bars))):
            expected[i] = (z["low"], z["high"])
    assert [None if lo != lo else (lo, hi) for lo, hi in zip(low, high)] == expected


def test_la_prueba_solo_dentro_de_una_caja_y_tras_un_frenado_o_un_climax_de_su_lado():
    bars = paseo(6000, 4)
    t, o, h, l, c, v = cols(bars)
    s = vpa.compute(t, o, h, l, c, v, TF)

    def tests(**cfg):
        return {(e["index"], e["dir"]): e for e in vpa.detect(t, o, h, l, c, v, TF, {**BEFORE, "nearBars": 20, **cfg}, s)
                if e["code"] == "QT"}

    alone, box, after, both = tests(), tests(testBox=True), tests(testAfter=True), tests(testBox=True, testAfter=True)
    assert len(box) < len(alone) and len(after) < len(alone) and both
    assert set(both) == set(box) & set(after), "los dos filtros son independientes"
    turns = [e for e in vpa.detect(t, o, h, l, c, v, TF, {**BEFORE, "nearBars": 20}, s) if e["code"] in ("QS", "QC")]
    for (i, side), e in both.items():
        lo, hi = s["boxLow"][i], s["boxHigh"][i]
        assert lo == lo and (l[i] <= (lo + hi) / 2 if side > 0 else h[i] >= (lo + hi) / 2), "en la mitad de su lado"
        assert any(x["dir"] == side and i - 20 <= x["index"] < i for x in turns), "tras un frenado o un clímax de su lado"
        assert i - 20 <= e["info"]["turn"] < i
    # De fábrica son esas: la mecha del frenado no cambia cuáles pruebas quedan en este paseo
    assert set(both) == {(e["index"], e["dir"]) for e in vpa.detect(t, o, h, l, c, v, TF, {"stopWick": [0.25, 0.4]}, s)
                         if e["code"] == "QT"}


def test_el_frenado_pide_media_vela_de_mecha_y_el_retroceso_una_vela_en_contra():
    bars = paseo(6000, 8)
    t, o, h, l, c, v = cols(bars)
    s = vpa.compute(t, o, h, l, c, v, TF)
    now = vpa.detect(t, o, h, l, c, v, TF, None, s)
    before = vpa.detect(t, o, h, l, c, v, TF, {"stopWick": [0.25, 0.4], "pullBack": False}, s)
    for e in [e for e in now if e["code"] == "QS"]:
        i, g = e["index"], -e["dir"]
        assert (s["lower"][i] if g < 0 else s["upper"][i]) >= 0.5, "la última vela, con media vela de mecha"
    short = [e for e in before if e["code"] == "QS"
             and (s["lower"][e["index"]] if e["dir"] > 0 else s["upper"][e["index"]]) < 0.5]
    assert short, "con un tercio de vela entraban mechas más cortas"
    for e in [e for e in now if e["code"] == "QR"]:
        k = int(e["info"]["breakout"])
        assert any(s["dir"][j] == -e["dir"] for j in range(k + 1, e["index"])), "una vela en contra antes de la que confirma"
    straight = [e for e in before if e["code"] == "QR"
                and not any(s["dir"][j] == -e["dir"] for j in range(int(e["info"]["breakout"]) + 1, e["index"]))]
    assert straight, "antes contaba la vela que seguía a la ruptura"


def test_el_medidor_gira_cuando_cruza_el_cero_despues_de_pasar_el_umbral_del_otro_lado():
    bars = paseo(5000, 2)
    t, o, h, l, c, v = cols(bars)
    s = vpa.compute(t, o, h, l, c, v, TF)
    turns = [e for e in vpa.detect(t, o, h, l, c, v, TF, None, s) if e["code"] == "QG"]
    meter = s["meter"]
    assert len(turns) > 10
    for e in turns:
        i, d = e["index"], e["dir"]
        assert meter[i] * d > 0 and e["info"]["meter"] == meter[i]
        j = i - 1
        while j >= 0 and meter[j] * d < 0:
            j -= 1
        side = [meter[k] for k in range(j + 1, i)]
        assert side and all(x * d < 0 for x in side), "venía del otro lado"
        assert max(abs(x) for x in side) >= 1.0, "y había pasado el umbral"
        assert e["info"]["peak"] == max(side, key=abs)
    # Con un umbral que nunca se alcanza no gira nunca
    assert not [e for e in vpa.detect(t, o, h, l, c, v, TF, {"meter": 50.0}, s) if e["code"] == "QG"]


def test_el_esfuerzo_con_resultado_sigue_el_color_de_su_vela():
    bars = paseo(3000, 6)
    t, o, h, l, c, v = cols(bars)
    s = vpa.compute(t, o, h, l, c, v, TF)
    found = [e for e in vpa.detect(t, o, h, l, c, v, TF, None, s) if e["code"] == "QV"]
    assert len(found) > 20
    for e in found:
        i = e["index"]
        assert e["dir"] == (1 if c[i] > o[i] else -1) and e["grade"] == s["validE"][i] >= 0.5
        # La vela ancha con volumen alto, contra su hora y contra las velas anteriores
        assert s["validE"][i] == min(s["wide"][i], vpa.up(s["rvHi"][i], 1.2, 1.8))
    # Sin wideResult, la vela validada: además el rango sigue al volumen
    before = vpa.compute(t, o, h, l, c, v, TF, {"wideResult": False})
    old = [e for e in vpa.detect(t, o, h, l, c, v, TF, {"wideResult": False}, before) if e["code"] == "QV"]
    assert old and {e["index"] for e in old} <= {e["index"] for e in found}, "suma velas, no quita"
    for e in old:
        assert before["validE"][e["index"]] <= before["valid"][e["index"]], "pide también lo de las velas anteriores"
