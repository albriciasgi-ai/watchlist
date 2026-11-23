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
    # Sin el embudo: estas pruebas son las de los dos tramos (búsqueda y validación), que siguen para las búsquedas guardadas
    return rs.clean_config({"tfs": [TF], "codes": ["RF", "HM", "EN", "DJ", "CC", "GC"], "split": SPLIT, "seed": 11, "funnel": False,
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


# ==================== Los tres controles del tablero y el margen en la validación (23/11) ====================

WEEK = 7 * 86400000


def test_las_tres_ventajas_son_las_del_tablero():
    """Contra el azar, el tramo y el azar del trimestre y el lado, con el margen por semanas y el error del control."""
    rows = [(1.0, 0.2, rt._ms("2022-01-03") + k * WEEK) for k in range(10)] + \
           [(-0.5, -0.1, rt._ms("2022-01-03") + k * WEEK) for k in range(10)]
    coins = [{"n": 12, "random": (0.1, 0.02), "leg": (0.2, 0.03)}, {"n": 8, "random": (-0.1, 0.02), "leg": (0.0, 0.03)}]
    three = rs._three(rows, coins)
    mean = 0.25
    assert three["edge"]["r"] == round(mean - (12 * 0.1 + 8 * -0.1) / 20, 4)
    assert three["legEdge"]["r"] == round(mean - (12 * 0.2 + 8 * 0.0) / 20, 4)
    assert three["quarterEdge"]["r"] == round(sum(r - q for r, q, _ in rows) / 20, 4)
    # El margen nunca es más angosto que el de trades independientes y suma el error del control
    iid = rs._se([r for r, _, _ in rows])
    assert three["edge"]["se"] >= iid and three["legEdge"]["se"] > three["edge"]["se"]
    assert abs(three["edge"]["low"] - (three["edge"]["r"] - 1.96 * three["edge"]["se"])) < 3e-4  # Redondeadas a 4 cifras
    # Trades de la misma semana que se mueven juntos: el margen se ensancha (B-08)
    flat = [{"n": 30, "random": (0.0, 0.0), "leg": (0.0, 0.0)}]
    same = [(1.0 if k % 2 == 0 else -1.0, 0.0, rt._ms("2022-01-03") + k * WEEK) for k in range(10) for _ in range(3)]
    spread = [(r, q, rt._ms("2022-01-03") + j * WEEK) for j, (r, q, _) in enumerate(same)]
    assert rs._three(same, flat)["edge"]["se"] > 1.5 * rs._three(spread, flat)["edge"]["se"]
    # Sin el tramo en una moneda con trades no hay ventaja contra el tramo; sin el azar del trimestre, tampoco la suya
    assert "legEdge" not in rs._three(rows, [{"n": 12, "random": (0.1, 0.02), "leg": None}, {"n": 8, "random": (-0.1, 0.02), "leg": (0.0, 0.03)}])
    assert "quarterEdge" not in rs._three(rows[:-1] + [(1.0, None, rows[-1][2])], coins)
    assert rs._three(rows[:1], coins) is None


def test_la_busqueda_elige_con_el_control_que_mas_le_exige(monkeypatch):
    fake_market(monkeypatch)
    rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2},
                          "exit": {"targetR": 2}, "rv": {"arrow": "any", "spike": 1.5}})
    new = rs.Evaluator(config()).evaluate(rule)
    old_cfg = {k: v for k, v in config().items() if k not in ("controls", "holdMargin")}  # Una búsqueda de antes del 23/11
    old = rs.Evaluator(old_cfg).evaluate(rule)
    for segment in ("train", "hold"):
        seg, before = new[segment], old[segment]
        three = seg["three"]
        name = min(three, key=lambda k: three[k]["r"] - three[k]["se"])
        assert seg["against"] == name and seg["edge"] == three[name]["r"] and seg["se"] == three[name]["se"]
        # La de dos controles queda como estaba, y una búsqueda de antes sigue eligiendo con ella
        assert seg["edgeTwo"] == before["edge"] and seg["seTwo"] == before["se"] and "against" not in before
    cfg, t = config(), new["train"]
    assert t["n"] >= cfg["minTrades"]
    expected = t["edge"] - t["se"] - rs.COIN_R * max(0, min(cfg["minCoins"], t["coinsWith"]) - t["coinsUp"])
    assert rs.fitness({"train": t, "complexity": 1}, cfg) == round(expected, 4)


def _finished(monkeypatch, tmp_path, hold, **extra):
    """El veredicto de una sola finalista con estas cifras de validación y vecinas que aguantan."""
    monkeypatch.setattr(rs, "search_dir", lambda: tmp_path)
    monkeypatch.setattr(rs, "_neighbors", lambda state, evaluator, record: [{"gene": "x", "edge": 0.1, "n": 50, "key": "v"}] * 3)
    cfg = {**config(checkNew=False, checkStocks=False), **extra}
    train = {"n": 200, "edge": 0.2, "se": 0.05, "coinsUp": 2, "coinsWith": 2, "avgR": 0.3}
    record = {"key": "k", "origin": "search", "genome": {}, "rule": {}, "complexity": 1, "train": train, "hold": hold, "coins": [], "fitness": 0.1}
    state = {"config": cfg, "evaluated": {"k": record}}
    rs._finish(state, None, {})
    return state["report"]["finalists"][0]


def test_candidata_con_o_sin_el_margen_en_la_validacion(monkeypatch, tmp_path):
    three = {"edge": {"r": 0.08, "low": -0.1, "high": 0.26, "se": 0.09}, "legEdge": {"r": 0.05, "low": -0.12, "high": 0.22, "se": 0.09},
             "quarterEdge": {"r": 0.1, "low": -0.07, "high": 0.27, "se": 0.09}}
    hold = {"n": 150, "edge": 0.05, "se": 0.09, "avgR": 0.1, "three": three}
    # De fábrica: les gana a los tres controles, aunque no con margen
    assert _finished(monkeypatch, tmp_path, hold)["verdict"] == "Candidata a la fase 2"
    # Pidiendo el margen, como "pasa" en el tablero
    found = _finished(monkeypatch, tmp_path, hold, holdMargin=True)
    assert found["verdict"].startswith("Les gana a los tres controles en la validación, pero no con margen") and not found["candidate"]
    clear = {k: {**v, "low": 0.01} for k, v in three.items()}
    assert _finished(monkeypatch, tmp_path, {**hold, "three": clear}, holdMargin=True)["candidate"]
    assert not _finished(monkeypatch, tmp_path, {**hold, "three": clear, "avgR": -0.02}, holdMargin=True)["candidate"]
    # Uno de los tres por debajo de cero
    below = {**three, "quarterEdge": {**three["quarterEdge"], "r": -0.01}}
    assert _finished(monkeypatch, tmp_path, {**hold, "three": below})["verdict"].startswith("No les gana a los tres controles")
    # Una búsqueda de antes del 23/11 juzga como entonces: la ventaja sobre el mejor de dos controles
    assert _finished(monkeypatch, tmp_path, {**hold, "three": below}, controls=None)["verdict"] == "Candidata a la fase 2"
