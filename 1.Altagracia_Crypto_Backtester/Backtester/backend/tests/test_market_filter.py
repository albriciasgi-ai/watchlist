"""
Filtro de mercado del probador (23/11/2026): la tendencia y la volatilidad de 4 horas al cerrar la vela de la señal, por
combinación; y lo que cambió con él en la búsqueda: el gen, el grupo de monedas con que elige y la moneda sin control.
Uso: python -m pytest tests/test_market_filter.py
"""
import numpy as np

import rule_search as rs
import rule_tester as rt
import trade_regime
from tests.test_rule_search import TF, fake_market
from tests.test_search_funnel import SPLIT, SPLIT1, arrow_rule, config, trend_bars

MS = TF * 60000
PHASE = {"phase": 1, "from": "2021-01-01", "to": "2021-12-31"}


def raw(**extra):
    return {"name": "R", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1},
            "entry": {"type": "market"}, "stop": {"type": "atr", "atr": 3.0, "minAtr": 0, "maxAtr": 100},
            "exit": {"targetR": None, "horizon": 3}, "oneAtATime": False, **extra}


def test_solo_entra_a_la_regla_si_deja_fuera_alguna_combinacion():
    assert len(trade_regime.COMBOS) == 6 and "subida-alta" in trade_regime.COMBOS
    plain = rt.clean_rule(raw())
    assert "market" not in plain
    every = rt.clean_rule(raw(market={"allow": list(trade_regime.COMBOS)}))
    none = rt.clean_rule(raw(market={"allow": []}))
    junk = rt.clean_rule(raw(market={"allow": ["otra", 3]}))
    for rule in (every, none, junk):
        assert "market" not in rule and rt.rule_hash("X", rule) == rt.rule_hash("X", plain), "sin filtrar nada, la misma regla"
    some = rt.clean_rule(raw(market={"allow": ["rango-baja", "otra", "rango-alta", "rango-alta"]}))
    assert some["market"] == {"allow": ["rango-alta", "rango-baja"]}
    assert rt.rule_hash("X", some) != rt.rule_hash("X", plain)
    # Limpiarla otra vez la deja igual
    assert rt.clean_rule(some)["market"] == some["market"]
    assert trade_regime.allow_text(["rango-alta", "rango-baja"]) == "solo en rango con volatilidad alta, rango con volatilidad baja"
    assert trade_regime.allow_text([c for c in trade_regime.COMBOS if c != "subida-alta"]) == "sin subida con volatilidad alta"
    assert trade_regime.combo(("subida", "alta")) == "subida-alta" and trade_regime.combo(("subida", trade_regime.UNKNOWN)) is None


def mixed_bars():
    """600 velas en subida y 600 planas, seguidas."""
    up = trend_bars(600, 0.004)
    last = up[-1]
    flat = []
    rng = np.random.default_rng(9)
    price = last["c"]
    for k in range(600):
        close = price * (1 + rng.normal(0, 0.002))
        flat.append({"t": last["t"] + (k + 1) * MS, "o": price, "c": close, "h": max(price, close) * 1.001, "l": min(price, close) * 0.999})
        price = close
    return [{**b, "delta": 0.0, "vol": 10.0} for b in up + flat]


def ev(bars, k, d=1):
    return {"code": "EX", "dir": d, "t": bars[k]["t"], "known": bars[k]["t"] + MS, "lo": bars[k]["l"], "hi": bars[k]["h"]}


def test_la_regla_solo_entra_donde_el_mercado_lo_deja_y_el_azar_tambien(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a, **k: None)
    bars = mixed_bars()
    labels = trade_regime.labels(bars, TF)
    places = list(range(150, 1150, 25))
    span = {"bars": bars, "events": [ev(bars, k) for k in places]}
    everything = rt.run("TEST", rt.clean_rule(raw()), span, PHASE, None, base=False)
    assert everything["summary"]["n"] == len(places)
    ups = [c for c in trade_regime.COMBOS if c.startswith("subida")]
    rule = rt.clean_rule(raw(market={"allow": ups}))
    result = rt.run("TEST", rule, span, PHASE, None, base=False)
    index = {b["t"]: i for i, b in enumerate(bars)}
    took = sorted(index[t["entry_t"]] - 1 for t in result["trades"])
    expected = [k for k in places if trade_regime.combo(labels[k]) in ups]
    assert took == expected and 0 < len(expected) < len(places)
    assert result["skipped"]["filtro de mercado"] == len(places) - len(expected)
    # Lo que se sabía al cerrar la vela de la señal: con las velas cortadas ahí, la misma etiqueta
    for k in expected[:5]:
        assert trade_regime.labels(bars[:k + 1], TF)[k] == labels[k]
    # Los controles al azar entran solo en esas velas
    ctx = rt._control_context("TEST", rule, span)
    allowed = rt._allowed(ctx, len(bars))
    assert len(allowed) and all(trade_regime.combo(labels[k]) in ups for k in allowed)
    assert rt._allowed(rt._control_context("TEST", rt.clean_rule(raw()), span), len(bars)) is None
    # Y el contexto del trade elegido tiene su fila
    assert np.array_equal(rt.market_mask(rule["market"], bars, TF), np.array([trade_regime.combo(x) in ups for x in labels]))


def test_la_busqueda_tiene_el_gen_y_una_guardada_antes_no():
    cfg = config()
    assert cfg["market"] is True and cfg["group"] == "base"
    assert rs._options(cfg)["market"] == rs.GENES["market"]
    assert rs._options({**cfg, "market": False})["market"] == (None,)
    old = {k: v for k, v in cfg.items() if k not in ("market", "group")}
    assert rs._options(old)["market"] == (None,), "una búsqueda guardada antes sigue sin él"
    genome = {name: 0 for name in rs._options(cfg)}
    plain = rs.decode(genome, cfg)
    assert "market" not in plain
    picked = rs.decode({**genome, "market": rs.GENES["market"].index("noUpHigh")}, cfg)
    assert picked["market"]["allow"] == sorted(c for c in trade_regime.COMBOS if c != "subida-alta")
    assert rs.rule_key(picked) != rs.rule_key(plain)
    assert rs.complexity(picked) == rs.complexity(plain) + 1
    assert rs.decode({**genome, "market": rs.GENES["market"].index("range")}, cfg)["market"]["allow"] == ["rango-alta", "rango-baja"]
    assert rs._distance({"rule": picked}, {"rule": plain}) == 1
    assert rs.clean_config({"group": "new"})["group"] == "new" and rs.clean_config({"group": "otra"})["group"] == "base"
    assert rs.clean_config({"minCoins": 30})["minCoins"] == 30


def test_con_el_filtro_el_control_de_la_busqueda_entra_solo_donde_deja(monkeypatch):
    fake_market(monkeypatch)
    cfg = config()
    base = arrow_rule()
    calm = rt.clean_rule({**{"tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2}, "exit": {"targetR": 2},
                             "rv": {"arrow": "any", "spike": 1.5}}, "market": {"allow": [c for c in trade_regime.COMBOS if c.endswith("baja")]}})
    ev_ = rs.Evaluator(cfg)
    free = ev_.evaluate(base)
    kept = ev_.evaluate(calm)
    assert 0 < kept["train"]["n"] < free["train"]["n"], "el filtro quita trades"
    # Cada regla tiene su propio control: el del filtro no es el de la regla sin él
    keys = [k for k in ev_.controls if '"allow"' in k]
    assert keys and len(keys) < len(ev_.controls)


def test_una_moneda_con_pocas_velas_en_un_tramo_no_entra_en_ese_tramo(monkeypatch):
    spans = fake_market(monkeypatch)
    first = rt._ms(SPLIT1)
    # La segunda moneda empieza 30 velas antes del primer corte: en el tramo 1 no hay con qué armar su control
    short = [b for b in spans["BBBUSDT"]["bars"] if b["t"] >= first - 30 * MS]
    spans["BBBUSDT"] = {"bars": short, "events": []}
    out = rs.Evaluator(config()).evaluate(arrow_rule())
    row = next(c for c in out["coins"] if c["symbol"] == "BBBUSDT")
    assert row["a"] == {"n": 0} and row["b"]["n"] > 0
    assert out["a"].get("three"), "el tramo conserva sus tres ventajas con la moneda que sí tiene datos"
    assert out["a"]["coinsWith"] <= 1


def test_la_busqueda_elige_con_el_grupo_pedido(monkeypatch):
    spans = fake_market(monkeypatch)
    monkeypatch.setattr(rt, "candle_symbols", lambda group="base": ["AAAUSDT"] if group == "base" else ["BBBUSDT"] if group == "new" else ["AAAUSDT", "BBBUSDT"])
    monkeypatch.setattr(rt, "new_symbols", lambda: ["BBBUSDT"])
    rule = arrow_rule()
    seen = {group: [c["symbol"] for c in rs.Evaluator(config(), group=group).evaluate(rule)["coins"]] for group in ("base", "new", "all")}
    assert seen == {"base": ["AAAUSDT"], "new": ["BBBUSDT"], "all": ["AAAUSDT", "BBBUSDT"]}
    # Buscando con las nuevas, las que solo informan al final son las de siempre
    out = [{"rule": rule}]
    rs._other_markets({**config(checkNew=True), "group": "new"}, out, {"update": lambda **k: None} and type("J", (), {"update": lambda self, **k: None})())
    assert "baseCoins" in out[0] and "newCoins" not in out[0]
    assert [c["symbol"] for c in out[0]["baseCoins"]["coins"]] == ["AAAUSDT"]
    out = [{"rule": rule}]
    rs._other_markets(config(checkNew=True), out, type("J", (), {"update": lambda self, **k: None})())
    assert "newCoins" in out[0] and "baseCoins" not in out[0]
    assert spans and SPLIT
