"""Reglas de imbalance y de step del almacen de order flow. Uso: python -m pytest tests/test_footprint_rules.py"""
import numpy as np
import pytest

import footprint_store as fs

D = 86400000
DAY = "2026-06-03"
START_MIN = 1780444800000 // 60000  # 2026-06-03 00:00 UTC


def level(bid, ask):
    return {"bid_volume": bid, "ask_volume": ask}


def sides(found):
    return [(x["level_index"], x["type"]) for x in found]


def test_mismo_nivel_exige_ratio_y_ambos_lados():
    levels = [level(1, 3), level(1, 2.9), level(0, 5), level(9, 3), level(0, 0)]
    assert sides(fs._imbalances(levels)) == [(0, "BUY"), (3, "SELL")]


def test_ratio_configurable():
    levels = [level(1, 2), level(1, 5)]
    assert sides(fs._imbalances(levels, {"ratio": 2})) == [(0, "BUY"), (1, "BUY")]
    assert sides(fs._imbalances(levels, {"ratio": 6})) == []


def test_volumen_minimo_del_lado_dominante():
    levels = [level(1, 3), level(10, 30)]
    assert sides(fs._imbalances(levels, {"min_volume": 5})) == [(1, "BUY")]


def test_lado_en_cero_solo_cuenta_si_se_pide():
    levels = [level(0, 5), level(4, 0), level(0, 0)]
    assert sides(fs._imbalances(levels)) == []
    found = fs._imbalances(levels, {"count_zero": True})
    assert sides(found) == [(0, "BUY"), (1, "SELL")]
    assert all(x["ratio"] == fs.MAX_RATIO for x in found)


def test_diagonal_compara_compra_con_la_venta_del_nivel_inferior():
    # Niveles de menor a mayor precio
    levels = [level(2, 1), level(9, 7), level(1, 30)]
    found = fs._imbalances(levels, {"mode": "diagonal"})
    # Nivel 1: compra 7 contra venta 2 del nivel 0 = 3.5. Venta 9 contra compra 30 del nivel 2 no alcanza.
    # Nivel 2: compra 30 contra venta 9 del nivel 1 = 3.33
    assert sides(found) == [(1, "BUY"), (2, "BUY")]
    assert found[0]["ratio"] == 3.5


def test_diagonal_venta_contra_la_compra_del_nivel_superior():
    levels = [level(12, 1), level(1, 3)]
    # Nivel 0: venta 12 contra compra 3 del nivel 1 = 4
    assert sides(fs._imbalances(levels, {"mode": "diagonal"})) == [(0, "SELL")]


def test_diagonal_el_borde_no_tiene_vecino():
    levels = [level(0, 50), level(50, 0)]
    assert fs._imbalances(levels, {"mode": "diagonal"}) == []
    assert sides(fs._imbalances(levels, {"mode": "diagonal", "count_zero": True})) == [(0, "BUY"), (1, "SELL")]


def test_si_un_nivel_cumple_ambos_lados_gana_el_mayor():
    levels = [level(1, 1), level(40, 20), level(1, 1)]
    found = fs._imbalances(levels, {"mode": "diagonal"})
    assert found[0]["level_index"] == 1 and found[0]["type"] == "SELL" and found[0]["ratio"] == 40


def stacked_levels(n):
    return [{"price_min": i, "price_max": i + 1} for i in range(n)]


def test_stacked_con_minimo_configurable():
    found = [{"level_index": i, "type": "BUY", "ratio": 3} for i in (0, 1)]
    assert fs._stacked(stacked_levels(3), found) == []
    assert len(fs._stacked(stacked_levels(3), found, 2)) == 1


def make_day(tmp_path, minutes, ticks=10):
    """Dia sintetico: cada minuto negocia entre 80,000 y 80,000 + ancho, con 1 BTC por celda."""
    folder = tmp_path / "BTCUSDT" / "2026"
    folder.mkdir(parents=True)
    m, cr, cl, cb, cs = [], [], [], [], []
    for row, width in enumerate(minutes):
        m.append(START_MIN + row)
        for k in range(width):
            cr.append(row)
            cl.append(80000 + k)
            cb.append(1000)
            cs.append(500)
    width = np.array(minutes)
    price = np.full(len(minutes), 800000)
    np.savez(
        folder / f"BTCUSDT_{DAY}.npz", m=np.array(m, dtype=np.int64), o=price, h=price + width * 10, l=price, c=price + width * 10,
        buy=width * 1000, sell=width * 500, n=width, cr=np.array(cr, dtype=np.int32), cl=np.array(cl, dtype=np.int64),
        cb=np.array(cb, dtype=np.int64), cs=np.array(cs, dtype=np.int64), cn=np.ones(len(cr), dtype=np.int32),
        info=np.array([10, 1000, ticks], dtype=np.int64),
    )


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(fs, "STORE_DIR", tmp_path)
    fs._days.clear()
    yield tmp_path
    fs._days.clear()


def read(tf, **kwargs):
    start = START_MIN * 60000
    return fs.footprints("BTCUSDT", tf, start, start + tf * 60000, **kwargs)


def test_step_se_ajusta_a_multiplos_de_la_celda(store):
    make_day(store, [20, 20])
    result = read(1, step=7.4)
    assert result["step_size"] == 7.0
    assert result["cell_size"] == 1.0
    assert all(lv["price_max"] - lv["price_min"] == 7.0 for lv in result["footprints"][0]["levels"])


def test_step_no_baja_de_la_celda(store):
    make_day(store, [20])
    assert read(1, step=0.2)["step_size"] == 1.0


def test_volumen_no_cambia_con_el_step(store):
    make_day(store, [40])
    a, b = read(1, step=1)["footprints"][0], read(1, step=8)["footprints"][0]
    assert sum(x["total_volume"] for x in a["levels"]) == pytest.approx(sum(x["total_volume"] for x in b["levels"]))
    assert a["total_delta"] == b["total_delta"]


def test_step_muy_fino_en_vela_ancha_se_limita(store):
    make_day(store, [1000])
    result = read(1, step=1)
    assert result["step_size"] == 5.0
    assert result["footprints"][0]["num_levels"] <= fs.MAX_LEVELS_PER_CANDLE + 1


def read_two(**kwargs):
    start = START_MIN * 60000
    return fs.footprints("BTCUSDT", 1, start, start + 2 * 60000, **kwargs)


def test_con_maximo_de_niveles_una_vela_ancha_sube_su_step(store):
    make_day(store, [1000])
    footprint = read(1, step=1, max_levels=10)["footprints"][0]
    assert footprint["num_levels"] <= 10
    assert footprint["step_size"] == 100.0


def test_el_maximo_es_por_vela_y_no_cambia_las_demas(store):
    make_day(store, [8, 1000])
    result = read_two(step=1, max_levels=10)
    narrow, wide = result["footprints"]
    assert narrow["step_size"] == 1.0 and narrow["num_levels"] == 8
    assert wide["step_size"] == 100.0
    assert result["step_size"] == 1.0, "el step base sigue igual para las proximas velas"


def test_una_vela_de_diez_niveles_no_se_toca(store):
    make_day(store, [10])
    assert read(1, step=1, max_levels=10)["footprints"][0]["step_size"] == 1.0


def test_once_niveles_ya_se_agrupan(store):
    make_day(store, [11])
    footprint = read(1, step=1, max_levels=10)["footprints"][0]
    assert footprint["step_size"] == 2.0
    assert footprint["num_levels"] <= 10


def test_al_agrupar_no_se_pierde_volumen(store):
    make_day(store, [137])
    plain, grouped = read(1, step=1)["footprints"][0], read(1, step=1, max_levels=10)["footprints"][0]
    assert sum(x["total_volume"] for x in grouped["levels"]) == pytest.approx(sum(x["total_volume"] for x in plain["levels"]))
    assert sum(x["delta"] for x in grouped["levels"]) == pytest.approx(sum(x["delta"] for x in plain["levels"]))
    assert sum(x["trade_count"] for x in grouped["levels"]) == sum(x["trade_count"] for x in plain["levels"])


def test_los_niveles_agrupados_son_contiguos_y_del_mismo_tamano(store):
    make_day(store, [137])
    footprint = read(1, step=1, max_levels=10)["footprints"][0]
    levels = footprint["levels"]
    assert all(lv["price_max"] - lv["price_min"] == footprint["step_size"] for lv in levels)
    assert all(a["price_max"] == b["price_min"] for a, b in zip(levels, levels[1:]))


def test_poc_e_imbalances_salen_de_los_niveles_agrupados(store):
    make_day(store, [137])
    footprint = read(1, step=1, max_levels=10, imbalance={"ratio": 1.5})["footprints"][0]
    assert 0 <= footprint["poc_index"] < footprint["num_levels"]
    assert all(item["level_index"] < footprint["num_levels"] for item in footprint["imbalances"])


def test_sin_maximo_el_step_elegido_se_respeta(store):
    make_day(store, [150])
    footprint = read(1, step=1)["footprints"][0]
    assert footprint["step_size"] == 1.0
    assert footprint["num_levels"] == 150


def test_la_union_siempre_es_redonda():
    assert fs._level_group(0, 9, 10) == 1
    assert fs._level_group(0, 10, 10) == 2
    assert fs._level_group(0, 49, 10) == 5
    assert fs._level_group(7, 16, 10) == 1, "diez niveles aunque no empiecen en cero"
    assert fs._level_group(7, 17, 10) == 2


def test_reglas_llegan_al_footprint(store):
    make_day(store, [10])
    plain = read(1, step=1)["footprints"][0]
    assert plain["imbalances"] == []  # 1 contra 0.5: ratio 2
    relaxed = read(1, step=1, imbalance={"ratio": 2, "stacked_levels": 4})["footprints"][0]
    assert len(relaxed["imbalances"]) == 10
    assert relaxed["stacked_imbalances"][0]["levels_count"] == 10
