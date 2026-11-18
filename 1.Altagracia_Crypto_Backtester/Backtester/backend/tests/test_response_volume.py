"""Flecha y rombo del Volumen de Respuesta en el probador. Uso: python -m pytest tests/test_response_volume.py"""
import random

import response_volume as rv
import rule_tester as rt

TF = 240
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def rising(n=120):
    """Velas verdes de 4 horas que suben de a 1, con volumen parejo."""
    return [{"t": k * MS, "o": 100.0 + k, "c": 101.0 + k, "h": 101.2 + k, "l": 99.8 + k, "delta": 0.0, "vol": 100.0} for k in range(n)]


def marked():
    bars = rising()
    bars[50]["vol"] = 500.0                                  # Verde con 5 veces el volumen de su hora, a favor del tramo
    bars[55].update(o=156.0, c=155.0, vol=500.0)             # Roja con 5 veces, contra el tramo alcista
    return bars


def test_flecha_a_favor_y_en_contra_del_tramo():
    bars = marked()
    favor = [e for e in rv.events(bars, TF) if e["code"] == "RF"]
    assert [(e["t"], e["dir"]) for e in favor] == [(bars[50]["t"], 1)]
    e = favor[0]
    assert e["known"] == bars[51]["t"] and (e["lo"], e["hi"]) == (bars[50]["l"], bars[50]["h"])
    assert e["info"] == {"times": 5.0, "leg": 1}
    against = [e for e in rv.events(bars, TF, arrow="against") if e["code"] == "RF"]
    assert [(e["t"], e["dir"]) for e in against] == [(bars[55]["t"], -1)]
    assert len([e for e in rv.events(bars, TF, arrow="any") if e["code"] == "RF"]) == 2
    assert [e for e in rv.events(bars, TF, spike=6.0) if e["code"] == "RF"] == []


def noisy(n=700, seed=3):
    rng = random.Random(seed)
    bars, price = [], 100.0
    for k in range(n):
        close = price + rng.gauss(0, 1.0)
        bars.append({"t": k * MS, "o": price, "c": close, "h": max(price, close) + abs(rng.gauss(0, 0.3)),
                     "l": min(price, close) - abs(rng.gauss(0, 0.3)), "delta": 0.0, "vol": 50.0 + 100.0 * rng.random() ** 3 * 6})
        price = close
    return bars


def test_el_rombo_se_opera_como_giro_o_siguiendo_el_tramo():
    bars = noisy()
    turn = [e for e in rv.events(bars, TF) if e["code"] == "RB"]
    follow = [e for e in rv.events(bars, TF, rombo="follow") if e["code"] == "RB"]
    assert len(turn) >= 5 and [e["t"] for e in turn] == [e["t"] for e in follow]
    by_t = {b["t"]: b for b in bars}
    for a, b in zip(turn, follow):
        assert a["dir"] == -a["info"]["leg"] and b["dir"] == b["info"]["leg"]
        # Giro: la zona llega al extremo del tramo. Siguiendo: es la vela
        assert a["info"]["extreme"] in (round(a["lo"], 8), round(a["hi"], 8))
        assert (b["lo"], b["hi"]) == (by_t[b["t"]]["l"], by_t[b["t"]]["h"])


def test_lo_conocido_no_cambia_con_velas_posteriores():
    bars = noisy()
    full = rv.events(bars, TF, arrow="any")
    for cut in (200, 431, 650):
        assert rv.events(bars[:cut], TF, arrow="any") == [e for e in full if e["known"] <= bars[cut]["t"]]


def test_la_regla_con_la_flecha_abre_el_trade_y_guarda_lo_que_vio(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    raw = {"name": "F", "tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2.0},
           "exit": {"targetR": 2.0, "horizon": 5}, "cooldown": 0}
    rule = rt.clean_rule(raw)
    assert rule["rv"] == {"leg": 2.0, "spike": 2.0, "arrow": "with", "rombo": "turn"}
    bars = marked()
    trades = rt.run("X", rule, {"bars": bars, "events": []}, PHASE, None, base=False)["trades"]
    assert [(t["signal"], t["dir"]) for t in trades] == [(bars[50]["t"], 1)]
    assert trades[0]["rv"] == {"times": 5.0, "leg": 1, "code": "RF"} and trades[0]["entry"] == bars[51]["o"]
    other = rt.clean_rule({**raw, "rv": {"arrow": "against"}})
    assert rt.rule_hash("X", other) != rt.rule_hash("X", rule)
    trades = rt.run("X", other, {"bars": marked(), "events": []}, PHASE, None, base=False)["trades"]
    assert [(t["signal"], t["dir"]) for t in trades] == [(bars[55]["t"], -1)]
    # Una regla sin estos elementos no lleva sus ajustes
    assert "rv" not in rt.clean_rule({**raw, "recipe": {"slots": [{"codes": ["VH"]}]}})
    assert {"RF", "RB"} <= set(rt.CANDLE_CODES)
