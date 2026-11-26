"""
Motor 8 del probador (26/11/2026): lo que decidió el usuario en la galería 4 del protocolo de pruebas
(pruebas_backtesting/revision_visual/G4_RESPUESTAS.md), en los elementos de order flow (of_elements.py).

- Exhaustion Print y Volume Decline: el extremo hacia donde fue el precio (máximo o mínimo de 5 velas).
- Delta Tail (opción B): mecha de inicio de al menos la mitad de la vela, cuerpo con delta a favor y la mecha en contra.
- Orderflows Sequencing y Vertical Liquidity: el agresor le gana al lado contrario en cada nivel.
- Acumulación/Distribución: en su nivel, el pasivo al menos el doble del agresor.
- Inverse Imbalance: el cierre en la mitad del rango de su color.
- Absorción: varios intentos contra el mismo nivel en las velas que elige el usuario (de 1 a 50).
- Qué corridas guardadas deja fuera (_stale), y la absorción en la regla y en el caché de la fase.

(La recarga por celda, el Delta Divergence sin la vela que envuelve y el Inverse Imbalance sobre un almacén, en
test_of_elements.py; el ratio de extremos fuera del barrido, en test_signal_sweep.py.)

Uso: python -m pytest tests/test_motor8.py
"""
import numpy as np
import pytest

import of_elements as oe
import rule_tester as rt


def facts(ask, bid, o, c, h=None, l=None, lo=100, step=1.0):
    """Una vela de celdas de 1 USD desde `lo`, con sus hechos como los arma _compute_day."""
    f = oe.bar_facts(np.array(ask, float), np.array(bid, float), o, c)
    n = len(ask)
    f.update(o=o, c=c, h=h if h is not None else lo + n * step, l=l if l is not None else lo, lo=lo, step=step)
    return f


# ==================== Sequencing y Vertical Liquidity ====================

def test_la_secuencia_pide_que_el_agresor_gane_y_tenga_volumen_en_cada_nivel():
    assert facts(ask=[41, 42, 81, 98, 193, 528], bid=[9] * 6, o=100, c=105)["seq"] == 6
    # Caso 1 de la galería: los primeros niveles casi en cero de los dos lados. Antes contaba 5
    assert facts(ask=[0, 0, 0.03, 0.11, 8.68, 0.34], bid=[0.01, 0, 0, 0, 0, 4.55], o=100, c=105)["seq"] == 0
    # Casos 1044 y 1566: el agresor crece, pero en el segundo nivel gana el otro lado
    assert facts(ask=[10, 20, 30, 40], bid=[5, 25, 5, 5], o=100, c=103)["seq"] == 1


def test_la_liquidez_vertical_pide_que_el_agresor_gane_en_cada_nivel():
    f = facts(ask=[50, 50, 50, 50], bid=[10, 60, 10, 10], o=100, c=103)
    assert oe._vertical_run(f, 40) == (2, 2, 3)  # El segundo nivel, parejo con la venta mayor, corta la racha


# ==================== Exhaustion Print y Volume Decline ====================

def test_el_extremo_hacia_donde_fue_el_precio():
    # Vela verde: compra 0.5 en el máximo y venta 3 en el mínimo; la compra cae hacia arriba y la venta hacia abajo
    f = facts(ask=[30, 30, 30, 9, 6, 0.5], bid=[3, 10, 20, 30, 30, 30], o=101, c=105)
    assert f["exh_high"] == pytest.approx(0.5 / f["meanlv"]) and f["exh_low"] == pytest.approx(3 / f["meanlv"])
    # Hace el máximo de 5 velas: los compradores se agotan arriba, bajista (antes miraba su mínimo, casos 623 y 1037)
    assert oe._turn_side(f, True, False) == (-1, f["exh_high"], f["decline_high"], True)
    assert f["decline_high"] and f["decline_low"]
    # El mínimo: los vendedores se agotan abajo, alcista
    assert oe._turn_side(f, False, True) == (1, f["exh_low"], f["decline_low"], False)
    # Ninguno o los dos: el extremo donde empieza la vela, como antes
    assert oe._turn_side(f, False, False) == (1, f["exh"], f["decline"], None)
    assert oe._turn_side(f, True, True) == (1, f["exh"], f["decline"], None)


def test_las_filas_del_maximo_y_del_minimo_en_cada_color():
    green = facts(ask=[5] * 10, bid=[1] * 10, o=101, c=108)
    red = facts(ask=[1] * 10, bid=[5] * 10, o=108, c=101)
    assert oe._rows_price(green, *oe._edge_rows(green, True, 1)) == (109, 110)
    assert oe._rows_price(green, *oe._edge_rows(green, False, 3)) == (100, 103)
    assert oe._rows_price(red, *oe._edge_rows(red, True, 3)) == (107, 110)
    assert oe._rows_price(red, *oe._edge_rows(red, False, 1)) == (100, 101)


# ==================== Delta Tail ====================

def tail(wick_ask, wick_bid, body_ask=(30, 30, 30, 30, 30), body_bid=(5, 5, 5, 5, 5), o=105):
    """Vela verde de 100 a 110: la mecha de abajo va de 100 a la apertura y el cuerpo de la apertura a 110."""
    return oe._tail(facts(ask=list(wick_ask) + list(body_ask), bid=list(wick_bid) + list(body_bid), o=o, c=110, h=110, l=100))


def test_delta_tail_con_mecha_cuerpo_a_favor_y_la_cola_en_contra():
    # Mecha de la mitad de la vela, la celda del extremo en contra (venta 20 contra compra 2)
    assert tail([2, 10, 10, 10, 10], [20, 5, 5, 5, 5]) == 5
    # La mecha entera en contra aunque su celda del extremo no (la vela de la derecha de la 113)
    assert tail([10, 1, 1, 1, 1], [10, 20, 20, 20, 20]) == 5
    # Sin mecha (casos 29 y 43): ya no cuenta aunque la celda del extremo vaya en contra
    assert tail([2, 10, 10, 10, 10], [20, 5, 5, 5, 5], o=100) is None
    # La cola con poco delta en contra y el resto de la mecha a favor (caso 127)
    assert tail([10, 10, 10, 10, 10], [10.2, 5, 5, 5, 5]) is None
    # El cuerpo con delta en contra
    assert tail([2, 10, 10, 10, 10], [20, 5, 5, 5, 5], body_ask=(5,) * 5, body_bid=(30,) * 5) is None


# ==================== Acumulación/Distribución e Inverse Imbalance ====================

def test_la_acumulacion_pide_el_pasivo_al_menos_el_doble_del_agresor_en_su_nivel():
    f = facts(ask=[20, 50, 60, 60, 60, 60], bid=[90, 158, 20, 20, 20, 20], o=100, c=105)
    assert f["accdist"][1] == 1 and oe._accdist_row(f) == 1  # 158 contra 50
    f = facts(ask=[20, 98, 60, 60, 60, 60], bid=[90, 158, 20, 20, 20, 20], o=100, c=105)
    assert f["accdist"][1] == 1 and oe._accdist_row(f) is None  # 158 contra 98: 1.6 veces (caso 2332)


def test_el_inverse_imbalance_pide_el_cierre_en_la_mitad_de_su_color():
    def bar(col, close):
        return {"col": col, "h": 110.0, "l": 100.0, "c": close}
    assert oe._closes_toward(bar(1, 106)) and not oe._closes_toward(bar(1, 101.6))  # Caso 2134: cerró al 16%
    assert oe._closes_toward(bar(-1, 103)) and not oe._closes_toward(bar(-1, 108))


# ==================== Absorción ====================

MS = 15 * 60000


def velas(closes, attempts):
    """Velas verdes de 15m con celdas de 1 USD de 100 a 115. attempts: {vela: precio de la celda con mucha compra}."""
    bars = []
    for k, close in enumerate(closes):
        ask = np.full(16, 2.0)
        if k in attempts:
            ask[int(attempts[k]) - 100] = 80.0
        bars.append({"t": k * MS, "c": float(close), "col": 1, "A": ask, "P": np.full(16, 2.0), "lo": 100, "n": 16, "step": 1.0})
    return bars


def absorbe(bars, n=10):
    found = oe._absorptions(bars, 0, len(bars) - 1, lambda f: 50.0, n, 15)
    return {k: [(d, lo, hi) for d, lo, hi, *_ in v] for k, v in found.items()}


def test_la_absorcion_es_el_segundo_intento_al_mismo_nivel_y_va_en_contra():
    closes = [108] * 10
    # Compraron fuerte en 110 y cerraron debajo, dos veces: la señal es bajista, al cerrar el segundo intento
    assert absorbe(velas(closes, {2: 110, 5: 110})) == {5: [(-1, 110.0, 111.0)]}
    # A una celda de distancia también cuenta, con la zona de las dos celdas
    assert absorbe(velas(closes, {2: 110, 5: 111})) == {5: [(-1, 110.0, 112.0)]}
    # Cada intento más vuelve a dar la señal
    assert absorbe(velas(closes, {2: 110, 5: 110, 7: 110})) == {5: [(-1, 110.0, 111.0)], 7: [(-1, 110.0, 111.0)]}
    # Una celda más lejos no es el mismo nivel
    assert absorbe(velas(closes, {2: 110, 5: 112})) == {}


def test_la_absorcion_se_cancela_con_un_cierre_mas_alla_y_respeta_las_velas_elegidas():
    # Una vela entre los dos intentos cerró sobre el nivel: el precio lo aceptó
    closes = [108, 108, 108, 113, 108, 108, 108, 108, 108, 108]
    assert absorbe(velas(closes, {2: 110, 5: 110})) == {}
    # El segundo intento llega 3 velas después: con 2 velas no cuenta, con 3 sí
    closes = [108] * 10
    assert absorbe(velas(closes, {2: 110, 5: 110}), n=2) == {}
    assert absorbe(velas(closes, {2: 110, 5: 110}), n=3) == {5: [(-1, 110.0, 111.0)]}


def test_un_intento_pide_la_celda_del_otro_lado_del_cierre():
    bars = velas([111] * 10, {2: 110, 5: 110})  # Cerraron sobre la celda de la compra: no es un intento
    assert absorbe(bars) == {}
    f = velas([108], {0: 110})[0]
    assert oe._attempt(f, 50.0, 1) == (110.0, 111.0, 80.0)
    assert oe._attempt(f, 90.0, 1) is None, "bajo el umbral de las celdas grandes"
    assert oe._attempt(f, None, 1) is None, "sin umbral (sin historia)"


def test_la_absorcion_da_lo_mismo_pedida_desde_mas_adelante():
    bars = velas([108] * 12, {2: 110, 5: 110, 9: 110})
    whole = oe._absorptions(bars, 0, 11, lambda f: 50.0, 10, 15)
    late = oe._absorptions(bars, 6, 11, lambda f: 50.0, 10, 15)
    assert {k: v for k, v in whole.items() if k >= 6} == late


# ==================== Probador ====================

def test_el_motor_8_deja_fuera_solo_las_corridas_que_usan_lo_que_cambio():
    def record(engine, codes=("FV",)):
        return {"engine": engine, "rule": {"recipe": {"slots": [{"codes": list(codes)}]}}}

    assert rt.ENGINE == 8
    for code in ("EX", "VD", "DT", "DD", "IV", "SQ", "VL", "AD", "RL"):
        assert rt._stale(record(7, (code,))) and not rt._stale(record(8, (code,)))
    assert not rt._stale(record(7)), "una regla con el FVG no cambia"
    assert not rt._stale(record(7, ("RD",))), "la recarga por celda no cambia señales ni zonas"
    assert not rt._stale(record(7, ("RX",))), "el ratio de extremos solo salió de las listas"
    assert not rt._stale(record(7, ("ZP", "ST")))


def test_las_velas_de_la_absorcion_entran_a_la_regla_solo_si_la_usa():
    base = {"tf": 15, "recipe": {"slots": [{"codes": ["ZP"]}]}}
    plain = rt.clean_rule(base)
    assert "absorbBars" not in rt.clean_rule({**base, "absorbBars": 25})
    assert rt.rule_hash("BTCUSDT", rt.clean_rule({**base, "absorbBars": 25})) == rt.rule_hash("BTCUSDT", plain)
    absorb = {"tf": 15, "recipe": {"slots": [{"codes": ["RL"]}]}}
    assert "absorbBars" not in rt.clean_rule(absorb), "las de fábrica no cambian la identidad"
    assert rt.clean_rule({**absorb, "absorbBars": 25})["absorbBars"] == 25
    assert rt.clean_rule({**absorb, "absorbBars": 99})["absorbBars"] == oe.ABSORB_MAX_BARS
    phase = {"phase": 1, "from": "2021-01-01", "to": "2021-02-01"}
    assert rt._span_path("BTCUSDT", 15, phase, rt.clean_rule(absorb)).name.endswith(f"_a10_e{rt.SPAN_VERSION}.npz")
    assert "_a25_" in rt._span_path("BTCUSDT", 15, phase, rt.clean_rule({**absorb, "absorbBars": 25})).name
