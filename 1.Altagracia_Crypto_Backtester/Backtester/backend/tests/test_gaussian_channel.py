"""Gaussian Channel en el probador de reglas. Uso: python -m pytest tests/test_gaussian_channel.py"""
import importlib.util
import pathlib
import random
import sys

import pytest

import gaussian_channel as gc
import rule_tester as rt

TF = 240
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-12-31", "available": True}


def walk(n=900, seed=5, drift=0.0):
    rng = random.Random(seed)
    bars, price = [], 100.0
    for k in range(n):
        close = max(1.0, price + rng.gauss(drift, 1.0))
        bars.append({"t": k * MS, "o": price, "c": close, "h": max(price, close) + abs(rng.gauss(0, 0.3)),
                     "l": min(price, close) - abs(rng.gauss(0, 0.3)), "delta": 0.0, "vol": 100.0})
        price = close
    return bars


def test_un_precio_quieto_deja_el_canal_en_ese_precio():
    flat = [{"t": k * MS, "o": 50.0, "h": 50.0, "l": 50.0, "c": 50.0, "vol": 1.0} for k in range(400)]
    for poles in (1, 2, 4, 9):
        mid, high, low = gc.channel(flat, 144, poles, 1.414)
        assert max(abs(v - 50.0) for v in mid) < 1e-3 and high[-1] == pytest.approx(50.0) and low[-1] == pytest.approx(50.0)


def test_es_la_misma_cuenta_del_strategy_builder_de_app_8():
    path = pathlib.Path(__file__).resolve().parents[4] / "4.Analizador cripto" / "backend" / "strategy_engine.py"
    if not path.exists():
        pytest.skip("sin el motor de App 8")
    spec = importlib.util.spec_from_file_location("app8_strategy_engine", path)
    old = importlib.util.module_from_spec(spec)
    sys.path.insert(0, str(path.parent))  # Importa a sus vecinos
    try:
        spec.loader.exec_module(old)
    except Exception as error:  # Le pueden faltar paquetes que este entorno no tiene
        pytest.skip(f"el motor de App 8 no carga aquí: {error}")
    finally:
        sys.path.remove(str(path.parent))
    bars = walk(3000)
    candles = [{"open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["vol"]} for b in bars]
    for poles, period, mult in ((4, 144, 1.414), (2, 50, 2.0), (9, 200, 1.0)):
        want = old.compute_gaussian_channel(candles, poles=poles, period=period, multiplier=mult)
        mid, high, low = gc.channel(bars, period, poles, mult)
        # App 8 arranca el filtro con ceros antes de la primera vela y aquí con el primer dato: coinciden al pasar el arranque
        for mine, theirs in ((mid, want["filt"]), (high, want["hband"]), (low, want["lband"])):
            assert max(abs(a - b) for a, b in zip(mine[-100:], theirs[-100:])) < 1e-3, (poles, period)


def test_entra_al_cerrar_fuera_de_la_banda_con_el_canal_a_favor():
    bars = walk(900, drift=0.05)
    mid, high, low = gc.channel(bars)
    index = {b["t"]: i for i, b in enumerate(bars)}
    found = gc.events(bars, TF)
    assert len(found) >= 3
    for e in found:
        i = index[e["t"]]
        assert i >= 288 and e["known"] == e["t"] + MS
        if e["dir"] > 0:
            assert bars[i]["c"] > high[i] and bars[i - 1]["c"] <= high[i - 1] and mid[i] > mid[i - 1] and (e["lo"], e["hi"]) == (mid[i], high[i])
        else:
            assert bars[i]["c"] < low[i] and bars[i - 1]["c"] >= low[i - 1] and mid[i] < mid[i - 1] and (e["lo"], e["hi"]) == (low[i], mid[i])
    # Sin pedir el canal a favor hay al menos los mismos cruces
    assert len(gc.events(bars, TF, trend=False)) >= len(found)


def test_lo_conocido_no_cambia_con_velas_posteriores():
    bars = walk(900, drift=0.03)
    full = gc.events(bars, TF, trend=False)
    for cut in (400, 650, 880):
        assert gc.events(bars[:cut], TF, trend=False) == [e for e in full if e["known"] <= bars[cut]["t"]]


def test_la_regla_sale_al_cerrar_de_vuelta_dentro_de_la_banda(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    bars = walk(900, drift=0.05)
    raw = {"name": "GC", "tf": TF, "recipe": {"slots": [{"codes": ["GC"]}], "side": "long"}, "stop": {"type": "zone", "buffer": 0.0, "maxAtr": 100},
           "exit": {"targetR": None, "horizon": None}, "cooldown": 0}
    rule = rt.clean_rule(raw)
    assert rule["gc"] == {"period": 144, "poles": 4, "mult": 1.414, "trend": True, "exit": "band"}
    assert rule["exit"]["horizon"] is None, "con la salida por el canal no se impone un cierre por tiempo"
    assert rt.clean_rule({**raw, "gc": {"exit": "none"}})["exit"]["horizon"] == rt.DEFAULT_HORIZON
    result = rt.run("X", rule, {"bars": bars, "events": []}, PHASE, None, base=False)
    trades = result["trades"]
    assert trades and {t["dir"] for t in trades} == {1} and {t["reason"] for t in trades} <= {"sale del canal", "stop"}
    mid, high, low = gc.channel(bars)
    index = {b["t"]: i for i, b in enumerate(bars)}
    for t in trades:
        assert t["gc"]["high"] == pytest.approx(high[index[t["signal"]]], abs=1e-6) and t["stop"] == pytest.approx(t["gc"]["mid"], abs=1e-6)
        if t["reason"] == "sale del canal":
            j = index[t["exit_t"]] - 1   # Sale en la apertura siguiente a la vela que cerró bajo la banda
            assert bars[j]["c"] < high[j] and t["exit"] == bars[j + 1]["o"]
            assert all(bars[i]["c"] >= high[i] for i in range(index[t["entry_t"]], j)), "ninguna vela anterior cerró bajo la banda"
    # Con la línea central como salida los trades duran al menos lo mismo
    slow = rt.run("X", rt.clean_rule({**raw, "gc": {"exit": "mid"}}), {"bars": bars, "events": []}, PHASE, None, base=False)["trades"]
    assert sum(t["bars"] for t in slow) / len(slow) >= sum(t["bars"] for t in trades) / len(trades)
    assert "GC" in rt.CANDLE_CODES and "gc" not in rt.clean_rule({**raw, "recipe": {"slots": [{"codes": ["VH"]}]}})


def test_en_1_dia_corre_sobre_velas_y_el_canal_arranca_con_las_anteriores_a_la_fase(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    day = 86400000
    bars = [dict(b, t=k * day) for k, b in enumerate(walk(900, drift=0.05))]
    raw = {"name": "GC", "tf": 1440, "recipe": {"slots": [{"codes": ["GC"]}], "side": "long"}, "stop": {"type": "zone", "buffer": 0.0, "maxAtr": 100},
           "exit": {"targetR": None, "horizon": None}, "cooldown": 0}
    rule = rt.clean_rule(raw)
    assert rule["tf"] == 1440 and rt._on_candles("X", 1440) and 1440 in rt.TFS
    whole = rt.run("X", rule, {"bars": bars, "events": []}, PHASE, None, base=False)["trades"]
    # La fase empieza en la vela 400: con las anteriores como arranque, sus trades son los mismos que al correr todo junto
    cut = 400
    warm = rt.run("X", rule, {"bars": bars[cut:], "warm": bars[:cut], "events": []}, PHASE, None, base=False)["trades"]
    cold = rt.run("X", rule, {"bars": bars[cut:], "events": []}, PHASE, None, base=False)["trades"]
    late = [t for t in whole if t["signal"] >= bars[cut]["t"]]
    assert warm and all(t["signal"] >= bars[cut]["t"] for t in warm)
    key = lambda t: (t["signal"], t["exit_t"], t["reason"], round(t["stop"], 6))
    assert [key(t) for t in warm if t["signal"] >= late[1]["signal"]] == [key(t) for t in late[1:]]
    # Sin arranque la fase pierde sus primeras 288 velas
    assert min(t["signal"] for t in cold) >= bars[cut + 288]["t"] and min(t["signal"] for t in warm) < bars[cut + 288]["t"]
    # En 1 día solo valen los elementos de velas
    monkeypatch.setattr(rt, "phases", lambda s: [{**PHASE, "start": 0, "end": 900 * day, "available": True}])
    answer = rt.start("X", {**raw, "recipe": {"slots": [{"codes": ["VA"]}]}}, 1)
    assert answer["success"] is False and "1 día" in answer["message"]
