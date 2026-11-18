"""Probador de reglas del Observador. Uso: python -m pytest tests/test_rule_tester.py"""
import numpy as np
import pytest

import rule_tester as rt

TF = 15
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def flat(n=400, price=100.0):
    """Velas planas: abren y cierran en `price`, con medio punto de mecha a cada lado."""
    return [{"t": k * MS, "o": price, "h": price + 0.5, "l": price - 0.5, "c": price, "delta": 0.0, "vol": 10.0} for k in range(n)]


def ev(code, bar, d=1, lo=99.0, hi=99.5, known_bar=None):
    return {"code": code, "dir": d, "t": bar * MS, "known": ((known_bar if known_bar is not None else bar) + 1) * MS, "lo": lo, "hi": hi}


def rule(**kw):
    base = {"name": "R", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1},
            "stop": {"type": "atr", "atr": 1.0, "minAtr": 0, "maxAtr": 100}, "exit": {"targetR": 2}}
    base.update(kw)
    return rt.clean_rule(base)


def go(bars, events, r, minutes=None, monkeypatch=None):
    if monkeypatch is not None:
        monkeypatch.setattr(rt.fs, "minutes", minutes or (lambda *a: None))
    return rt.run("TEST", r, {"bars": bars, "events": events}, PHASE, None, base=False)


@pytest.fixture(autouse=True)
def sin_almacen(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)


def test_entra_en_la_apertura_siguiente_y_cobra_el_objetivo_con_comisiones():
    bars = flat()
    bars[32]["h"] = 103.0  # ATR 1 → stop en 99, objetivo en 102
    result = go(bars, [ev("EX", 30)], rule())
    trade = result["trades"][0]
    assert trade["entry_t"] == 31 * MS and trade["entry"] == 100.0 and trade["signal"] == 30 * MS
    assert trade["reason"] == "objetivo" and trade["exit"] == 102.0
    assert trade["r"] == pytest.approx(2 - rt.TAKER_FEE * (100 + 102) / 1.0, abs=1e-4)


def test_stop_y_objetivo_en_la_misma_vela_cuenta_el_stop_sin_minutos():
    bars = flat()
    bars[32]["h"], bars[32]["l"] = 103.0, 98.0
    trade = go(bars, [ev("EX", 30)], rule())["trades"][0]
    assert trade["reason"] == "stop" and trade["r"] < -1


def test_con_minutos_gana_lo_que_paso_primero(monkeypatch):
    bars = flat()
    bars[32]["h"], bars[32]["l"] = 103.0, 98.0
    first = 32 * TF

    def minutes(symbol, a, b):
        return {"m": np.array([first, first + 1]), "h": np.array([103.0, 100.0]), "l": np.array([100.0, 98.0])}

    trade = go(bars, [ev("EX", 30)], rule(), minutes, monkeypatch)["trades"][0]
    assert trade["reason"] == "objetivo" and trade["exit_t"] == first * 60000


def test_la_limit_se_llena_al_cruzar_no_al_tocar():
    r = rule(entry={"type": "limit", "at": "near", "expiry": 3}, stop={"type": "zone", "buffer": 0.5, "minAtr": 0, "maxAtr": 100})
    touch = flat()
    touch[32]["l"] = 99.5  # Toca la limit de 99.5 sin pasarla
    result = go(touch, [ev("EX", 30)], r)
    assert result["trades"] == [] and result["skipped"] == {"limit sin llenar": 1}
    cross = flat()
    cross[32]["l"] = 99.4
    filled = go(cross, [ev("EX", 30)], rule(entry={"type": "limit", "at": "near", "expiry": 3},
                                               stop={"type": "zone", "buffer": 0.5, "minAtr": 0, "maxAtr": 100},
                                               exit={"targetR": None, "horizon": 5}))["trades"][0]
    assert filled["order"] == "limit" and filled["entry"] == 99.5 and filled["entry_t"] == 32 * MS
    assert filled["stop"] == pytest.approx(99.0 - 0.5 * 1.0)


def test_sin_objetivo_sale_por_tiempo_y_mide_hasta_donde_llego():
    bars = flat(400)
    bars[33]["h"] = 103.4
    trade = go(bars, [ev("EX", 30)], rule(exit={"targetR": None, "horizon": 10}))["trades"][0]
    assert trade["reason"] == "tiempo" and trade["bars"] == 10 and trade["target"] is None
    assert trade["mfe"] == pytest.approx(3.4) and trade["reach"] == pytest.approx(3.4)


def test_una_posicion_a_la_vez_o_todas_las_senales():
    bars = flat(400)
    events = [ev("EX", 30), ev("EX", 33)]
    one = go(bars, events, rule(exit={"targetR": None, "horizon": 10}))
    assert len(one["trades"]) == 1 and one["busy"] == 1
    every = go(bars, events, rule(exit={"targetR": None, "horizon": 10}, oneAtATime=False))
    assert len(every["trades"]) == 2


def test_un_trade_abierto_al_final_de_la_fase_no_cuenta():
    result = go(flat(), [ev("EX", 390)], rule(exit={"targetR": None, "horizon": 500}))
    assert result["trades"] == [] and result["open"] == 1


def test_invertir_cambia_el_lado_y_el_stop():
    trade = go(flat(400), [ev("EX", 30)], rule(invert=True, exit={"targetR": None, "horizon": 5}))["trades"][0]
    assert trade["dir"] == -1 and trade["stop"] > trade["entry"]


def test_guarda_los_elementos_presentes_aunque_no_esten_en_la_regla():
    events = [ev("EX", 30), ev("ZP", 30), ev("DT", 30, d=-1), ev("SW", 20)]
    trade = go(flat(400), events, rule(exit={"targetR": None, "horizon": 5}))["trades"][0]
    assert trade["votes"] == ["EX"] and trade["present"] == ["EX", "ZP"] and trade["against"] == ["DT"]


def test_el_stop_por_swing_solo_usa_pivotes_ya_confirmados():
    bars = flat(400)
    bars[20]["l"] = 97.0   # Pivote viejo, confirmado
    bars[29]["l"] = 98.0   # Mínimo reciente: en la vela 30 aún le faltan velas a la derecha
    r = rule(stop={"type": "swing", "bars": 3, "buffer": 0, "minAtr": 0, "maxAtr": 100}, exit={"targetR": None, "horizon": 3})
    assert go(bars, [ev("EX", 30)], r)["trades"][0]["stop"] == 97.0
    # Con sus tres velas de la derecha cerradas, el reciente ya vale
    assert go(bars, [ev("EX", 32)], r)["trades"][0]["stop"] == 98.0


def test_lo_ya_cerrado_no_cambia_con_velas_posteriores():
    rng = np.random.default_rng(3)
    bars, price = [], 100.0
    for k in range(1500):
        o = price
        price += float(rng.normal(0, 0.4))
        bars.append({"t": k * MS, "o": o, "h": max(o, price) + 0.2, "l": min(o, price) - 0.2, "c": price, "delta": 0.0, "vol": 10.0})
    events = [ev("EX", int(b), d=1 if b % 2 else -1, lo=bars[int(b)]["l"], hi=bars[int(b)]["l"] + 0.2)
              for b in sorted(rng.choice(np.arange(40, 1450), 120, replace=False))]
    r = rule(stop={"type": "swing", "bars": 4, "minAtr": 0, "maxAtr": 100}, exit={"targetR": 2, "trail": "swing", "trailBars": 4, "horizon": 60})
    whole = go(bars, events, r)["trades"]
    cut = 900
    part = go(bars[:cut], [e for e in events if e["known"] <= cut * MS], r)["trades"]
    assert len(part) > 10
    strip = lambda t: {k: v for k, v in t.items() if k not in ("n", "reach")}
    assert [strip(t) for t in part] == [strip(t) for t in whole[:len(part)]]


def test_resumen_y_azar():
    bars = flat(600)
    for k in range(40, 560, 20):
        bars[k + 2]["h"] = 103.0
    result = rt.run("TEST", rule(), {"bars": bars, "events": [ev("EX", k) for k in range(40, 560, 20)]}, PHASE, None)
    s = result["summary"]
    assert s["n"] == 26 and s["winRate"] == 100.0 and s["smallSample"] and s["maxDrawdownR"] == 0
    assert result["baseline"]["n"] > 100 and not result["edge"]["clear"]  # Muestra pequeña: nunca "claro"
    assert result["equity"][-1][1] == pytest.approx(s["totalR"], abs=0.01)


def test_la_regla_exacta_no_depende_del_nombre_y_sin_salida_pone_horizonte():
    a, b = rule(name="uno"), rule(name="dos")
    assert rt.rule_hash("X", a) == rt.rule_hash("X", b)
    assert rt.rule_hash("X", a) != rt.rule_hash("X", rule(exit={"targetR": 3}))
    assert rule(exit={"targetR": None})["exit"]["horizon"] == rt.DEFAULT_HORIZON
    assert rt.clean_rule({"recipe": {"slots": [{"codes": ["??"]}]}}) is None


def test_fases_la_tres_pide_la_dos_y_lo_corrido_no_se_repite(tmp_path, monkeypatch):
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.fs, "coverage", lambda s: {"first": "2020-03-25", "last": "2026-11-04", "days": 2400})
    names = [(p["phase"], p["from"], p["to"]) for p in rt.phases("X")]
    assert names == [(1, "2020-04-25", "2023-12-31"), (2, "2024-01-01", "2025-06-30"), (3, "2025-07-01", "2026-11-04")]
    r = rule()
    assert "fase 2" in rt.start("X", r, 3)["message"]
    assert rt.start("X", r, 2)["needsConfirm"] is True
    result = rt.run("X", rule(exit={"targetR": None, "horizon": 5}), {"bars": flat(400), "events": [ev("EX", 30)]}, rt.phases("X")[1], None)
    run_id = rt._save(result, rt.rule_hash("X", r))
    again = rt.start("X", r, 2, confirm=True)
    assert again["stored"] is True and again["run"] == run_id
    assert rt.start("X", r, 3)["needsConfirm"] is True
    assert rt.public_run(rt.load_run(run_id))["trades"][0].get("measures") is None
    assert rt.export_csv(run_id).count("\n") == 2
