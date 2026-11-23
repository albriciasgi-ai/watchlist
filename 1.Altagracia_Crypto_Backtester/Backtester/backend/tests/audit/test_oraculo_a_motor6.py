"""Casos de respuesta conocida del oráculo A con las reglas del motor 6 (etapa 7 del protocolo, 22/11/2026), calculados a
mano en cada comentario: lo a favor desde el llenado (H4), el alcance de 300 velas desde la siguiente al llenado (O-05),
el tope de la comisión (H18) y la selección nueva (H15, F-01 y H19). Cada caso dice también lo que daba la
especificación de antes, que es la de los 64 casos de test_oraculo_b_casos.py.

Velas de 1 hora, ATR = 1 y sin comisiones salvo que se diga otra cosa. Velas: (o, h, l, c). Sin minutos, el recorrido
supuesto: apertura, el extremo más cerca de la apertura, el otro y cierre.

Uso (desde backend/): python -B -m pytest -q tests/audit/test_oraculo_a_motor6.py
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import oraculo as oa  # noqa: E402
from test_oraculo_b_casos import STEP, T0, TF, regla, velas  # noqa: E402

A = pytest.approx
ANTES = {"h4": False, "o05": False}  # La especificación de antes del motor 6


def correr(bars, k, side, rule, zone=None, atr=1.0, taker=0.0, maker=0.0, variant=None):
    b = oa.Bars(TF, [x["t"] for x in bars], [x["o"] for x in bars], [x["h"] for x in bars], [x["l"] for x in bars],
                [x["c"] for x in bars], [atr] * len(bars))
    stop = {"buffer": 0.0, "minAtr": 0.0, "maxAtr": float("inf"), **rule["stop"]}
    rule = {**rule, "stop": stop}
    sig = {"k": k, "side": side, "zone": zone, "i0": k, "expiry": None, "sides": (side,)}
    return oa.simulate(b, rule, sig, taker=taker, maker=maker, variant=variant)


def test_h4_lo_a_favor_de_la_vela_del_llenado_cuenta_desde_el_llenado():
    # Limit de compra en 99 (zona 99-99), stop 3 ATR = 96, riesgo 3. Vela 1: (100, 101, 97, 99); el máximo está más
    # cerca de la apertura: recorrido 100 → 101 → 97 → 99. Se llena al cruzar 99, en el tramo 101 → 97: el 101 fue antes.
    # Después del llenado el precio va a 97 y cierra en 99: lo a favor de esa vela es (99 − 99) / 3 = 0. Vela 2:
    # (98.5, 98.8, 95, 95.5): toca el stop en 96 y su máximo queda bajo la entrada. Motor 6: mfe 0. Antes: la vela
    # entera, (101 − 99) / 3 = 0.667
    b = velas((100, 100.5, 99.5, 100), (100, 101, 97, 99), (98.5, 98.8, 95, 95.5))
    rule = regla(entry={"type": "limit", "at": "near", "expiry": 3}, stop={"type": "atr", "atr": 3.0, "buffer": 0.0}, targetR=3)
    r6 = correr(b, 0, 1, rule, zone=(99.0, 99.0))
    old = correr(b, 0, 1, rule, zone=(99.0, 99.0), variant=ANTES)
    for r in (r6, old):
        assert r["order"] == "limit" and r["entry_i"] == 1 and r["entry"] == 99 and r["stop"] == 96
        assert r["exit_i"] == 2 and r["exit"] == 96 and r["reason"] == "stop"
    assert r6["mfe"] == A(0.0, abs=1e-6)
    assert old["mfe"] == A(2 / 3, abs=1e-3)


def test_o05_el_alcance_son_300_velas_desde_la_siguiente_al_llenado():
    # Limit de compra en 99.5, stop 1 ATR = 98.5, riesgo 1, objetivo 1R = 100.5. Vela 1: (100, 100.2, 99, 99.6), se
    # llena. Velas 2 a 300: (99.6, 99.9, 99.4, 99.7), alcance (99.9 − 99.5) / 1 = 0.4. Vela 301: máximo 103 (3.5 R).
    # Vela 302: máximo 104 (4.5 R). Ninguna toca el stop inicial. Motor 6: las 300 velas desde la 2, de la 2 a la 301:
    # alcance 3.5. Antes: 299, de la 2 a la 300: alcance 0.4. La 302 queda fuera de las dos
    rows = [(100, 100.2, 99.8, 100), (100, 100.2, 99, 99.6)] + [(99.6, 99.9, 99.4, 99.7)] * 299
    rows += [(99.7, 103, 99.6, 102.5), (102.5, 104, 102, 103.5)]
    b = velas(*rows)
    assert len(b) == 303
    rule = regla(entry={"type": "limit", "at": "near", "expiry": 3}, targetR=1)
    r6 = correr(b, 0, 1, rule, zone=(99.5, 99.5))
    old = correr(b, 0, 1, rule, zone=(99.5, 99.5), variant=ANTES)
    assert r6["entry_i"] == 1 and r6["entry"] == 99.5 and r6["reason"] == "objetivo" and r6["exit_i"] == 301
    assert r6["reach"] == A(3.5) and old["reach"] == A(0.4)


def test_h18_una_senal_con_la_comision_sobre_0_3_R_no_se_toma():
    # A mercado, entrada 100 (apertura de la vela 1). Comisión taker 0.055% de entrada y de salida: 0.0011 × 100 = 0.11
    # en precio. Con stop 1 ATR (riesgo 1) son 0.11 R: se toma. Con stop 0.2 ATR (riesgo 0.2), 0.55 R: pasa de 0.3 y no
    # se toma. Con maxFeeR 0 (sin tope) se toma igual. Antes no había tope
    b = velas((100, 100.5, 99.5, 100), (100, 102, 99.9, 101.5), (101.5, 102, 101, 101.8))
    wide = correr(b, 0, 1, regla(targetR=1), taker=0.00055, maker=0.0002)
    assert "skip" not in wide and wide["entry"] == 100 and wide["risk"] == 1
    narrow = regla(stop={"type": "atr", "atr": 0.2, "buffer": 0.0}, targetR=1)
    assert correr(b, 0, 1, narrow, taker=0.00055, maker=0.0002) == {"skip": "comisión muy alta para el riesgo"}
    free = correr(b, 0, 1, {**narrow, "maxFeeR": 0}, taker=0.00055, maker=0.0002)
    assert "skip" not in free and free["risk"] == A(0.2)


def test_h15_a_mercado_la_senal_de_la_vela_de_la_salida_entra():
    # Señal en 0: entra en la vela 1 a 100, stop 99. Vela 2 (100, 100.2, 98.5, 99): sale por el stop. Señal en 2 (la vela
    # de la salida): entra en la vela 3 a 99, stop 98, objetivo 1R = 100, que la vela 4 toca. Motor 6: los dos trades.
    # Antes: la de la vela 2 quedaba como "posición abierta"
    b = velas((100, 100.5, 99.5, 100), (100, 100.5, 99.5, 100), (100, 100.2, 98.5, 99), (99, 99.5, 98.8, 99.2),
              (99.2, 101, 99, 100.8))
    rule = regla(targetR=1)
    results = [(k, correr(b, k, 1, rule)) for k in (0, 2)]
    assert results[0][1]["exit_i"] == 2 and results[0][1]["reason"] == "stop"
    assert results[1][1]["entry_i"] == 3 and results[1][1]["reason"] == "objetivo"
    taken6, _ = oa.select_motor6(results)
    taken_old, fates_old = oa.select(results, True)
    assert [t["k"] for t in taken6] == [0, 2]
    assert [t["k"] for t in taken_old] == [0] and list(fates_old.values()) == ["posición abierta"]


def test_f01_sin_enfriamiento_al_comenzar_y_su_largo_tras_un_trade():
    # Enfriamiento de 2 velas. Señal en 0: motor 6, entra (sin trades no hay enfriamiento); antes, "enfriamiento" (empezaba
    # activo). Tras el trade de 0, que sale en la vela 2: las señales en 3 y 4 (2 + 1 y 2 + 2) quedan en enfriamiento y la
    # de 5 (2 + 2 + 1) entra
    b = velas(*([(100, 100.5, 99.5, 100), (100, 100.5, 99.5, 100), (100, 100.2, 98.5, 99)] + [(99, 99.5, 98.8, 99.2)] * 3
                + [(99.2, 101, 99, 100.8)] * 3))
    rule = regla(targetR=1, cooldown=2)
    results = [(k, correr(b, k, 1, rule)) for k in (0, 3, 4, 5)]
    taken6, fates6 = oa.select_motor6(results, cooldown=2)
    assert [t["k"] for t in taken6] == [0, 5]
    assert sorted(fates6.values()) == ["enfriamiento", "enfriamiento"]
    _, fates_old = oa.select(results, True, cooldown=2)
    assert fates_old[(0, 1, 1)] == "enfriamiento"


def test_h19_a_mercado_dos_senales_opuestas_en_la_misma_vela_no_dan_ninguna():
    # En la vela 0, una señal larga y una corta: a mercado no se sabe cuál tomar y no entra ninguna. Con órdenes que
    # esperan, cada una espera la suya y no aplica
    b = velas((100, 100.5, 99.5, 100), (100, 101.5, 99.6, 101), (101, 101.2, 100.5, 100.8))
    rule = regla(targetR=1)
    results = [(0, correr(b, 0, 1, rule)), (0, correr(b, 0, -1, rule))]
    taken, fates = oa.select_motor6(results)
    assert taken == [] and set(fates.values()) == {"señales opuestas en la misma vela"}
    assert STEP == 3_600_000 and T0 > 0  # Las mismas velas de los 64 casos
