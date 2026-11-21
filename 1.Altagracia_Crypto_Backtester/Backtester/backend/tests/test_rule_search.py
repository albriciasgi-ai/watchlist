"""Búsqueda genética de reglas en la fase 1. Uso: python -m pytest tests/test_rule_search.py"""
import random
import time

import rule_search as rs
import rule_tester as rt

TF = 240
MS = TF * 60000
START = rt._ms("2021-01-01")
SPLIT = "2021-07-01"


def noisy(n=2200, seed=3):
    rng = random.Random(seed)
    bars, price = [], 100.0
    for k in range(n):
        close = price * (1 + rng.gauss(0, 0.01))
        bars.append({"t": START + k * MS, "o": price, "c": close, "h": max(price, close) * (1 + abs(rng.gauss(0, 0.003))),
                     "l": min(price, close) * (1 - abs(rng.gauss(0, 0.003))), "delta": 0.0, "vol": 50.0 + 100.0 * rng.random() ** 3 * 6})
        price = close
    return bars


def fake_market(monkeypatch, coins=("AAAUSDT", "BBBUSDT")):
    spans = {c: {"bars": noisy(seed=i + 3), "events": []} for i, c in enumerate(coins)}
    end = spans[coins[0]]["bars"][-1]["t"] + MS
    phase = {"phase": 1, "name": "Exploración", "start": START, "end": end, "from": "2021-01-01", "to": rt._iso(end - 1),
             "days": (end - START) // 86400000, "available": True}
    monkeypatch.setattr(rt, "candle_symbols", lambda group="base": list(coins) if group == "base" else [])
    monkeypatch.setattr(rt, "new_symbols", lambda: [])
    monkeypatch.setattr(rt, "stock_symbols", lambda: [])
    monkeypatch.setattr(rt, "phases", lambda symbol: [phase])
    monkeypatch.setattr(rt, "detect_span", lambda symbol, tf, ph, rule, progress=None: spans[symbol])
    monkeypatch.setattr(rt, "has_store", lambda symbol: False)
    return spans


def config(**extra):
    return rs.clean_config({"tfs": [TF], "codes": ["RF", "HM", "EN", "DJ", "CC", "GC"], "split": SPLIT, "seed": 11,
                            "population": 8, "generations": 2, "minTrades": 20, "minCoins": 1, **extra})


def test_cada_genoma_es_una_regla_valida_del_catalogo():
    cfg = config()
    rng = random.Random(1)
    for _ in range(300):
        rule = rs.decode(rs.random_genome(cfg, rng), cfg)
        assert rule is not None and rule == rt.clean_rule(rule)
        codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
        assert codes <= set(cfg["codes"]) and 1 <= len(codes) <= cfg["maxElements"]
        assert rule["tf"] in cfg["tfs"]


def test_un_gen_que_la_regla_no_usa_no_cambia_su_identidad():
    cfg = config()
    opts = rs._options(cfg)
    genome = {name: 0 for name in opts}
    genome["e1"] = opts["e1"].index("RF")
    key = rs.rule_key(rs.decode(genome, cfg))
    assert rs.rule_key(rs.decode({**genome, "gcPeriod": 2}, cfg)) == key   # Sin GC en la regla
    assert rs.rule_key(rs.decode({**genome, "window": 3}, cfg)) == key     # Un solo elemento: la ventana es 1
    assert rs.rule_key(rs.decode({**genome, "rvSpike": 2}, cfg)) != key


def test_la_aptitud_pone_debajo_lo_que_no_llega_al_minimo_y_castiga_lo_complejo():
    cfg = config(minTrades=100, minCoins=3)
    good = {"train": {"n": 150, "edge": 0.10, "se": 0.04, "coinsUp": 3, "coinsWith": 3}, "complexity": 1}
    few = {"train": {"n": 99, "edge": 0.50, "se": 0.04, "coinsUp": 3, "coinsWith": 3}, "complexity": 1}
    assert rs.fitness(good, cfg) == 0.06
    assert rs.fitness(few, cfg) < -1 < rs.fitness(good, cfg)
    assert rs.fitness({**good, "complexity": 3}, cfg) == 0.02
    assert rs.fitness({**good, "train": {**good["train"], "coinsUp": 1}}, cfg) == round(0.06 - 2 * rs.COIN_R, 4)


def test_busqueda_y_validacion_no_se_mezclan(monkeypatch):
    fake_market(monkeypatch)
    cfg = config()
    ev = rs.Evaluator(cfg)
    rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2},
                          "exit": {"targetR": 2}, "rv": {"arrow": "any", "spike": 1.5}})
    out = ev.evaluate(rule)
    split = rt._ms(SPLIT)
    assert out["train"]["n"] > 0 and out["hold"]["n"] > 0
    for symbol, item in ev.data.items():
        result = rt.run(symbol[0], rule, item["span"], item["phase"], None, base=False)
        train = [t for t in result["trades"] if t["exit_t"] < split]
        hold = [t for t in result["trades"] if t["entry_t"] >= split]
        row = next(c for c in out["coins"] if c["symbol"] == symbol[0])
        assert row["train"]["n"] == len(train) and row["hold"]["n"] == len(hold)
    # Lo de la validación no cambia lo del tramo de búsqueda: cortar las velas tras la fecha deja lo mismo
    spans = {s: {"bars": [b for b in item["span"]["bars"] if b["t"] < split], "events": []} for (s, _), item in ev.data.items()}
    monkeypatch.setattr(rt, "detect_span", lambda symbol, tf, ph, rule, progress=None: spans[symbol])
    cut = rs.Evaluator(cfg).evaluate(rule)
    assert cut["train"]["n"] == out["train"]["n"] and cut["train"]["edge"] == out["train"]["edge"]
    assert cut["hold"]["n"] == 0


def test_la_busqueda_corre_guarda_y_la_validacion_sale_solo_al_terminar(monkeypatch, tmp_path):
    fake_market(monkeypatch)
    monkeypatch.setattr(rs, "search_dir", lambda: tmp_path)
    # Sin la orden stop a favor ni los filtros de Williams y SMC (20/11): la misma busqueda de antes; esas piezas se prueban
    # en test_williams_smc.py. Casi todo el tiempo son los controles de las vecinas de cada finalista: en este PC tarda de
    # 100 a 130 s, y la espera es de hasta 300 s
    answer = rs.start({"tfs": [TF], "codes": ["RF", "HM", "EN"], "split": SPLIT, "seed": 5, "population": 6, "generations": 2,
                       "minTrades": 10, "minCoins": 1, "stopEntry": False, "williams": False})
    assert answer["success"]
    for _ in range(1500):
        if rs.job_status(answer["job"])["state"] != "running":
            break
        time.sleep(0.2)
    assert rs.job_status(answer["job"])["state"] == "done"
    found = rs.summary(answer["search"])
    assert found["generation"] == 2 and len(found["history"]) == 2 and found["tested"] >= 6
    assert "report" in found and all("hold" in row for row in found["best"])
    assert rs.history()[0]["id"] == answer["search"]
    # Mientras corre, la validación no sale
    state = rs.load(answer["search"])
    state["state"] = "running"
    rs._save(state)
    partial = rs.summary(answer["search"])
    assert partial["state"] == "stopped" and "report" not in partial and all("hold" not in row for row in partial["best"])


def test_una_regla_de_la_busqueda_cargada_en_la_ventana_sigue_siendo_la_misma(tmp_path):
    """La ventana convierte la regla a su editor (fromBackendRule) y de vuelta (toBackendRule): tiene que quedar igual,
    o la corrida en el probador sería otra regla. Necesita node."""
    import json
    import pathlib
    import shutil
    import subprocess
    import pytest
    node = shutil.which("node")
    if node is None:
        pytest.skip("sin node")
    cfg = rs.clean_config({"tfs": [60, 240, 1440], "maxElements": 3, "codes": list(rt.CANDLE_CODES)})
    rng = random.Random(9)
    rules = [r for r in (rs.decode(rs.random_genome(cfg, rng), cfg) for _ in range(200)) if r]
    source, target = tmp_path / "rules.json", tmp_path / "back.json"
    source.write_text(json.dumps(rules), encoding="utf-8")
    module = (pathlib.Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "backtesting" / "ruleTester.js").as_uri()
    script = ("const fs = await import('node:fs'); const m = await import(process.argv[1]);"
              "const rules = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));"
              "fs.writeFileSync(process.argv[3], JSON.stringify(rules.map(r => m.toBackendRule(m.fromBackendRule(r)))));")
    subprocess.run([node, "--input-type=module", "-e", script, module, str(source), str(target)], check=True, capture_output=True)
    back = json.loads(target.read_text(encoding="utf-8"))
    assert len(back) == len(rules)
    for rule, again in zip(rules, back):
        assert rt.rule_hash("S", rule) == rt.rule_hash("S", rt.clean_rule(again))
