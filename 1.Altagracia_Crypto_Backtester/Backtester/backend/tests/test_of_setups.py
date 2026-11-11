"""Recetas de setups sobre los elementos. Uso: python -m pytest tests/test_of_setups.py"""
import pytest

import of_setups as st

TF = 15
MS = TF * 60000


def bars(n=12, step=0.0):
    """Velas planas de 100 a 101, con una tendencia opcional."""
    return [{"t": k * MS, "o": 100 + k * step, "h": 101 + k * step, "l": 100 + k * step, "c": 100.5 + k * step} for k in range(n)]


def ev(code, bar, d=1, known_bar=None):
    """Un evento de la vela `bar` que se conoce al cerrar `known_bar` (la misma, por defecto)."""
    return {"code": code, "dir": d, "t": bar * MS, "known": ((known_bar if known_bar is not None else bar) + 1) * MS}


def recipe(**kw):
    base = {"id": "R", "slots": [{"codes": ["EX"]}, {"codes": ["ST"]}], "mode": "strict", "window": 1}
    base.update(kw)
    return st.clean_recipe(base)


def triggers(matches, d=1):
    return [m["t"] // MS for m in matches if m["dir"] == d]


def test_misma_vela_exige_todas_las_casillas():
    b = bars()
    events = [ev("EX", 3), ev("ST", 3), ev("EX", 6)]
    assert triggers(st.match_recipes(b, events, [recipe()], TF)) == [3]


def test_ventana_y_la_vela_que_dispara_aporta_voto():
    b = bars()
    events = [ev("EX", 3), ev("ST", 4)]
    assert triggers(st.match_recipes(b, events, [recipe(window=2)], TF)) == [4]
    # ST antes y EX después: también, porque cada uno vota en su vela y la que dispara aporta el suyo
    assert triggers(st.match_recipes(b, [ev("ST", 3), ev("EX", 4)], [recipe(window=2)], TF)) == [4]
    # Fuera de la ventana no
    assert triggers(st.match_recipes(b, [ev("EX", 2), ev("ST", 4)], [recipe(window=2)], TF)) == []


def test_secuencia_exige_el_orden_y_nunca_la_misma_vela():
    seq = recipe(mode="sequence", window=3, slots=[{"codes": ["EX"], "group": 0}, {"codes": ["ST"], "group": 1}])
    b = bars()
    assert triggers(st.match_recipes(b, [ev("EX", 3), ev("ST", 5)], [seq], TF)) == [5]
    assert triggers(st.match_recipes(b, [ev("ST", 3), ev("EX", 5)], [seq], TF)) == []
    assert triggers(st.match_recipes(b, [ev("EX", 5), ev("ST", 5)], [seq], TF)) == []


def test_umbral_y_alternativas_de_codigo():
    rec = recipe(mode="threshold", min=2, slots=[{"codes": ["SW", "BR"]}, {"codes": ["EX"]}, {"codes": ["ZP"]}])
    events = [ev("BR", 4), ev("ZP", 4)]
    assert triggers(st.match_recipes(bars(), events, [rec], TF)) == [4]


def test_el_voto_cuenta_cuando_el_elemento_se_conoce():
    # La VA abandonada de la vela 3 se conoce al cerrar la 4: no puede disparar en la 3
    events = [ev("VA", 3, known_bar=4), ev("EX", 3)]
    rec = recipe(slots=[{"codes": ["VA"]}, {"codes": ["EX"]}])
    assert triggers(st.match_recipes(bars(), events, [rec], TF)) == []
    rec2 = recipe(slots=[{"codes": ["VA"]}, {"codes": ["EX"]}], window=2)
    assert triggers(st.match_recipes(bars(), events, [rec2], TF)) == [4]


def test_lados_separados_y_filtro_de_lado():
    events = [ev("EX", 3, d=-1), ev("ST", 3, d=-1)]
    assert triggers(st.match_recipes(bars(), events, [recipe()], TF), d=-1) == [3]
    assert st.match_recipes(bars(), events, [recipe(side="long")], TF) == []


def test_confirmacion_de_entrada_mueve_la_hora_en_que_se_conoce():
    b = bars(20)
    b[6]["h"] = 110  # La vela siguiente avanza mucho a favor
    # Velas de 1 de rango y cierre a 0.5 del máximo: pedir 1 ATR a favor exige más que su máximo
    rec = recipe(entry={"on": True, "atr": 1.0, "bars": 2})
    match = st.match_recipes(b, [ev("EX", 5), ev("ST", 5)], [rec], TF)
    assert match and match[0]["entry"] == 6 * MS and match[0]["known"] == 7 * MS
    # Sin avance no hay setup
    assert st.match_recipes(bars(20), [ev("EX", 5), ev("ST", 5)], [rec], TF) == []


def test_swing_exige_un_minimo_de_las_velas_previas():
    b = bars(12, step=1.0)  # Subida: ninguna vela es mínimo de 5
    rec = recipe(swing={"on": True, "bars": 5})
    assert st.match_recipes(b, [ev("EX", 8), ev("ST", 8)], [rec], TF) == []
    b[8]["l"] = 50  # Ahora sí
    assert triggers(st.match_recipes(b, [ev("EX", 8), ev("ST", 8)], [rec], TF)) == [8]


def test_resultado_neto_con_stop_primero_si_toca_los_dos():
    b = bars(10)
    atr = [1.0] * 10
    b[3]["c"] = 100.0
    b[4].update(h=104, l=98)  # Toca objetivo (103) y stop (98.5) en la misma vela
    r = st._trade(b, atr, 3, 1, 1.5, 2.0, 5)
    assert r == pytest.approx(-1 - st.TAKER_FEE * (100 + 98.5) / 1.5)
    b[4].update(h=104, l=99.5)
    r = st._trade(b, atr, 3, 1, 1.5, 2.0, 5)
    assert r == pytest.approx(2 - st.TAKER_FEE * (100 + 103) / 1.5)
    # Sin velas suficientes para el horizonte, el resultado todavía no se conoce
    assert st._trade(bars(5), [1.0] * 5, 3, 1, 1.5, 2.0, 5) is None


def test_receta_sin_codigos_conocidos_se_descarta():
    assert st.clean_recipe({"slots": [{"codes": ["ZZ"]}]}) is None
    assert st.clean_recipe({"slots": [{"codes": ["EX"]}], "window": 99})["window"] == st.MAX_WINDOW
