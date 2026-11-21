"""Flujos on-chain de Coin Metrics en el probador. Uso: python -m pytest tests/test_onchain_flows.py"""
import json

import numpy as np
import pytest

import onchain_flows as oc
import rule_search as rs
import rule_tester as rt

DAY, H4 = 86400000, 4 * 3600000
START = 1577836800000  # 2020-01-01


def write(tmp_path, monkeypatch, data):
    monkeypatch.setattr(oc, "FILE", tmp_path / "coinmetrics.json")
    json.dump(data, open(oc.FILE, "w"))
    oc._load.cache = None
    oc.daily.cache = {}


def series(n, fn):
    return [[START + i * DAY, fn(i)] for i in range(n)]


def base(n=800, inflow=lambda i: 100.0, outflow=lambda i: 100.0, usdt=lambda i: 1e9, usdc=None):
    data = {"btc": {"FlowInExNtv": series(n, inflow), "FlowOutExNtv": series(n, outflow), "SplyExNtv": series(n, lambda i: 10000.0)},
            "usdt": {"SplyCur": series(n, usdt)}}
    if usdc:
        data["usdc"] = {"SplyCur": [[START + i * DAY, usdc(i)] for i in range(n) if usdc(i) is not None]}
    return data


def bars(n, start, tf=240):
    return [{"t": start + i * tf * 60000, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "vol": 1.0, "delta": 0.0} for i in range(n)]


def test_salir_de_los_exchanges_es_alcista_y_sale_en_z(tmp_path, monkeypatch):
    # Un día de salida grande (el 700) entre días con ruido chico
    rng = np.random.default_rng(1)
    noise = rng.normal(0, 5, 800)
    write(tmp_path, monkeypatch, base(outflow=lambda i: 100.0 + noise[i] + (500.0 if i == 700 else 0.0)))
    grid, value, z = oc.daily("net", "btc", 1)
    assert value[700] == pytest.approx((500 + noise[700]) / 10000 * 100, rel=1e-6)  # % del saldo en exchanges, positivo
    assert z[700] > 3
    assert np.isnan(z[100])  # Sin 180 días de historia


def test_el_dato_de_un_dia_se_usa_desde_las_6_del_dia_siguiente(tmp_path, monkeypatch):
    write(tmp_path, monkeypatch, base(outflow=lambda i: 100.0 + (500.0 if i == 700 else 0.0) + (i % 7)))
    chain = {"metric": "net", "asset": "btc", "days": 1, "z": 0.5, "mode": "favor"}
    day700 = START + 700 * DAY
    b = bars(18, day700 - H4)  # Velas de 4 h desde las 20:00 del día anterior
    value, z = oc.at_close(chain, "BTCUSDT", b, 240)
    closes = [x["t"] + H4 for x in b]
    for c, v in zip(closes, value):
        if c < day700 + DAY + 6 * 3600000:
            assert v < 1  # Antes de publicarse, sigue el día anterior
        elif c < day700 + 2 * DAY + 6 * 3600000:
            assert v > 4  # Publicado, hasta que llega el día siguiente
    # Sin datos nuevos en más de 3 días: no pasa
    late, zl = oc.at_close(chain, "BTCUSDT", bars(3, START + 805 * DAY), 240)
    assert np.isnan(zl).all()


def test_la_llegada_de_usdc_no_cuenta_como_emision(tmp_path, monkeypatch):
    write(tmp_path, monkeypatch, base(usdt=lambda i: 1e9, usdc=lambda i: None if i < 400 else 5e8))
    grid, value, z = oc.daily("stable", "btc", 7)
    assert np.nanmax(np.abs(value)) == pytest.approx(0.0)  # Ninguna crece: 0%, aunque USDC aparezca el día 400


def test_el_filtro_segun_el_lado():
    favor = {"z": 0.5, "mode": "favor"}
    assert oc.chain_ok(favor, 0.8, 1) and not oc.chain_ok(favor, 0.3, 1) and oc.chain_ok(favor, -0.8, -1)
    nocontra = {"z": 0.5, "mode": "nocontra"}
    assert oc.chain_ok(nocontra, -0.3, 1) and not oc.chain_ok(nocontra, -0.8, 1) and oc.chain_ok(nocontra, 0.3, -1)
    assert not oc.chain_ok(favor, float("nan"), 1)
    assert oc.asset_for("auto", "ETHUSDT") == "eth" and oc.asset_for("auto", "SOLUSDT") == "btc"


def test_la_regla_sin_el_filtro_conserva_su_identidad_y_la_busqueda_lo_empieza_apagado():
    raw = {"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "flow": {"cvd": 20}}
    before = rt.rule_hash("X", rt.clean_rule(raw))
    assert rt.rule_hash("X", rt.clean_rule({**raw, "flow": {"cvd": 20, "chain": None}})) == before
    rule = rt.clean_rule({**raw, "flow": {"cvd": 20, "chain": {"metric": "stable", "days": 500, "z": -1, "asset": "eth"}}})
    assert rule["flow"]["chain"] == {"metric": "stable", "days": 90, "z": 0.0, "mode": "favor"}  # Acotado y sin activo
    assert rt.rule_hash("X", rule) != before
    net = rt.clean_rule({**raw, "flow": {"chain": {"metric": "net"}}})["flow"]["chain"]
    assert net == {"metric": "net", "days": 7, "z": 0.5, "mode": "favor", "asset": "auto"}
    cfg = rs.clean_config({"seed": 1})
    assert rs._options(cfg)["chain"][0] is None
    assert rs._options(rs.clean_config({"seed": 1, "chain": False}))["chain"] == (None,)


def test_el_filtro_deja_pasar_solo_las_velas_a_favor(tmp_path, monkeypatch):
    out = lambda i: 100.0 + (i % 5) + (400.0 if 700 <= i <= 702 else 0.0)
    write(tmp_path, monkeypatch, base(outflow=out))
    b = bars(90, START + 690 * DAY)  # 15 días: del 690 al 705
    ctx = {"symbol": "BTCUSDT", "tf": 240, "bars": b}
    chain = {"metric": "net", "asset": "btc", "days": 1, "z": 3.0, "mode": "favor"}
    longs = [k for k in range(len(b)) if rt._flow_ok({"chain": chain}, ctx, k, 1)]
    shorts = [k for k in range(len(b)) if rt._flow_ok({"chain": chain}, ctx, k, -1)]
    assert longs and not set(longs) & set(shorts)
    first = min(longs)
    assert b[first]["t"] + H4 >= START + 701 * DAY + 6 * 3600000  # El primer largo, ya publicado el día 700
