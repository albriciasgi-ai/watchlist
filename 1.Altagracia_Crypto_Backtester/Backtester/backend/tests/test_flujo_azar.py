"""Azar con filtros de lado (F-07), multitud en la tasa base (F-08) y confluencia OI-volumen como el panel (F-09).
Protocolo de pruebas, 22/11/2026. Uso: python -m pytest tests/test_flujo_azar.py"""
import numpy as np

import flow_filters as ff
import rule_tester as rt


def test_la_tasa_base_es_neutra_aunque_la_resta_deje_ruido():
    """F-08: funding_3d resta dos sumas acumuladas y deja la tasa base un poco arriba o abajo de 0.0001."""
    for noisy in (0.00010000000000000026, 0.00009999999999999998, 0.0001):
        assert ff.crowd(noisy, -1) == "neutro" and ff.crowd(noisy, 1) == "neutro"
    assert ff.crowd(0.00011, -1) == "contra" and ff.crowd(0.00011, 1) == "con"
    assert ff.crowd(-0.00001, 1) == "contra" and ff.crowd(-0.00001, -1) == "con"
    # La resta de sumas acumuladas, como funding_3d, con nueve liquidaciones en la tasa base
    rates = np.full(40, 0.0001)
    cum = np.r_[0.0, np.cumsum(rates)]
    three_days = [(cum[i + 9] - cum[i]) / 9 for i in range(30)]
    assert {ff.crowd(x, -1) for x in three_days} == {"neutro"} and {ff.crowd(x, 1) for x in three_days} == {"neutro"}


def test_la_confluencia_de_un_corto_es_la_del_panel():
    """F-09: el panel llama confluencia bajista al volumen vendedor con el OI bajando; el filtro pedía el OI subiendo."""
    n = 40
    rng = np.random.default_rng(3)
    signed = rng.normal(0, 1, n)
    oi = 1000 + np.cumsum(rng.normal(0, 1, n))
    signed[-1], oi[-1] = -8.0, oi[-2] - 9.0           # Vela vendedora con el OI bajando fuerte
    z = ff.z_pair(oi, signed)
    k = n - 1
    assert ff.oi_ok("conf", oi, signed, k, -1, zcache=z), "corto: volumen y OI bajan, confluencia a favor"
    assert not ff.oi_ok("conf", oi, signed, k, 1, zcache=z)
    assert not ff.oi_ok("noconf", oi, signed, k, 1, zcache=z), "para un largo es confluencia en contra"
    oi[-1] = oi[-2] + 9.0                               # El mismo volumen con el OI subiendo
    z = ff.z_pair(oi, signed)
    assert not ff.oi_ok("conf", oi, signed, k, -1, zcache=z)


def test_el_z_incluye_la_vela_como_el_panel():
    values = np.arange(30, dtype=float)
    z = ff._zscore_with(values, 20)
    window = values[10:30]
    assert np.isnan(z[18]) and abs(z[29] - (values[29] - window.mean()) / window.std()) < 1e-12


def test_el_azar_con_filtro_de_lado_guarda_la_proporcion_de_la_regla(monkeypatch):
    """F-07: el filtro deja entrar largos en el 10% de las velas y cortos en el 90%. Antes se sorteaban la vela y el lado
    y se descartaba lo que el filtro no dejaba: quedaban casi solo cortos. Ahora la proporción es la de la regla."""
    n = 5000
    ctx = {"T": np.arange(n) * 3600000, "bars": [{} for _ in range(n)], "symbol": "X", "tf": 60}
    rule = {"tf": 60, "flow": {"cvd": 20}}
    trades = [{"dir": 1 if k % 2 else -1, "r": 0.0} for k in range(100)]  # La regla: mitad largos, mitad cortos
    monkeypatch.setattr(rt, "_random_rule", lambda r, t: r)
    monkeypatch.setattr(rt, "_allowed", lambda c, m: None)
    monkeypatch.setattr(rt, "_side_ok", lambda r, c, k, side: (k % 10 == 0) if side > 0 else (k % 10 != 0))
    monkeypatch.setattr(rt, "simulate", lambda r, c, k, side, **kw: {"dir": side, "r": 0.0, "entry_t": int(c["T"][k]),
                                                                      "exit_t": int(c["T"][k]) + 1, "bars": 1,
                                                                      "mfe": 0.0, "mae": 0.0})
    base = rt._baseline(rule, ctx, trades, "X")
    longs = sum(cell.get("1", [0])[0] for cell in base["quarters"].values())
    shorts = sum(cell.get("-1", [0])[0] for cell in base["quarters"].values())
    assert base["n"] == rt.BASE_TRADES
    assert abs(longs / (longs + shorts) - 0.5) < 0.04
