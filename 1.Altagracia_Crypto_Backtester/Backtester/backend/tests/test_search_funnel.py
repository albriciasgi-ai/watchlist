"""
Embudo de la búsqueda (23/11/2026): la fase 1 en tres tramos con hueco, la aptitud por el peor de los dos primeros, la
puerta (el tercero) solo para las finalistas y con cupo, la cuenta de lo ya gastado y el régimen de cada trade.
Uso: python -m pytest tests/test_search_funnel.py
"""
import json

import numpy as np

import rule_search as rs
import rule_tester as rt
import trade_regime
from tests.test_rule_search import MS, START, TF, fake_market

DAY = 86400000
SPLIT1, SPLIT = "2021-04-01", "2021-10-01"


def config(**extra):
    return rs.clean_config({"tfs": [TF], "codes": ["RF", "HM", "EN", "DJ", "CC", "GC"], "split1": SPLIT1, "split": SPLIT, "seed": 11,
                            "population": 8, "generations": 2, "minTrades": 20, "minCoins": 1, "checkNew": False,
                            "checkStocks": False, **extra})


def arrow_rule():
    return rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["RF"]}]}, "stop": {"type": "atr", "atr": 2},
                          "exit": {"targetR": 2}, "rv": {"arrow": "any", "spike": 1.5}})


def test_la_configuracion_trae_el_embudo_y_una_busqueda_guardada_sigue_con_dos_tramos():
    cfg = rs.clean_config({})
    assert cfg["funnel"] and cfg["split"] == "2023-01-01" and cfg["split1"] == "2022-01-01"
    assert (cfg["gapDays"], cfg["gateQuota"], cfg["phase2Quota"]) == (30, 10, 5)
    # El primer corte, al menos 180 días antes del segundo; si no, un año antes
    assert rs.clean_config({"split": "2023-01-01", "split1": "2022-11-01"})["split1"] == "2022-01-01"
    assert rs.clean_config({"split": "2023-01-01", "split1": "no es fecha"})["split1"] == "2022-01-01"
    assert rs.clean_config({"gateQuota": 99, "phase2Quota": 1, "gapDays": 400}) | {} and \
        [rs.clean_config({"gateQuota": 99, "phase2Quota": 1, "gapDays": 400})[k] for k in ("gateQuota", "phase2Quota", "gapDays")] == [20, 3, 60]
    assert rs.clean_config({"funnel": False})["funnel"] is False
    # Una configuración guardada antes no trae "funnel": dos tramos, como entonces
    old = {k: v for k, v in rs.clean_config({"split": SPLIT}).items() if k not in ("funnel", "split1", "gapDays", "gateQuota", "phase2Quota")}
    assert set(rs.Evaluator(old).bounds) == {"train", "hold"}
    funnel = rs.Evaluator(config(gapDays=30))
    first, second = rt._ms(SPLIT1), rt._ms(SPLIT)
    assert funnel.bounds == {"a": (None, first), "b": (first + 30 * DAY, second), "hold": (second + 30 * DAY, None)}


def test_cada_trade_es_de_un_solo_tramo_y_los_del_hueco_de_ninguno(monkeypatch):
    fake_market(monkeypatch)
    cfg = config(gapDays=30)
    ev = rs.Evaluator(cfg)
    rule = arrow_rule()
    out = ev.evaluate(rule)
    first, second, gap = rt._ms(SPLIT1), rt._ms(SPLIT), 30 * DAY
    total = 0
    for (symbol, _), item in ev.data.items():
        trades = rt.run(symbol, rule, item["span"], item["phase"], None, base=False)["trades"]
        total += len(trades)
        a = [t for t in trades if t["exit_t"] < first]
        b = [t for t in trades if t["entry_t"] >= first + gap and t["exit_t"] < second]
        hold = [t for t in trades if t["entry_t"] >= second + gap]
        row = next(c for c in out["coins"] if c["symbol"] == symbol)
        assert (row["a"]["n"], row["b"]["n"], row["hold"]["n"]) == (len(a), len(b), len(hold))
        assert row["train"]["n"] == len(a) + len(b)
    assert out["a"]["n"] > 0 and out["b"]["n"] > 0 and out["hold"]["n"] > 0
    assert out["train"]["n"] == out["a"]["n"] + out["b"]["n"]
    assert out["train"]["n"] + out["hold"]["n"] < total, "los del hueco y los que cruzan un corte no cuentan"
    assert out["parts"] == {"a": out["a"], "b": out["b"]}
    # Sin hueco entran más trades al segundo tramo y a la puerta
    wide = rs.Evaluator(config(gapDays=0)).evaluate(rule)
    assert wide["b"]["n"] > out["b"]["n"] and wide["hold"]["n"] > out["hold"]["n"] and wide["a"]["n"] == out["a"]["n"]


def test_la_busqueda_no_mira_la_puerta_y_lo_de_despues_no_cambia_sus_tramos(monkeypatch):
    fake_market(monkeypatch)
    cfg = config()
    rule = arrow_rule()
    ev = rs.Evaluator(cfg)
    full = ev.evaluate(rule)
    blind = rs.Evaluator(cfg).evaluate(rule, gate=False)
    assert blind["hold"] == {"n": 0, "edge": None, "se": None, "pending": True}
    assert all(row["hold"] == {"n": 0} for row in blind["coins"])
    for name in ("a", "b", "train"):
        assert blind[name] == full[name]
    # Sin las velas de la puerta, los dos tramos de búsqueda dan lo mismo: nada de ella llega a la aptitud
    second = rt._ms(SPLIT)
    spans = {s: {"bars": [b for b in item["span"]["bars"] if b["t"] < second], "events": []} for (s, _), item in ev.data.items()}
    monkeypatch.setattr(rt, "detect_span", lambda symbol, tf, ph, rule, progress=None: spans[symbol])
    cut = rs.Evaluator(cfg).evaluate(rule)
    for name in ("a", "b", "train"):
        assert cut[name]["n"] == full[name]["n"] and cut[name]["edge"] == full[name]["edge"]
    assert cut["hold"]["n"] == 0
    # Y la regla que guarda la búsqueda queda con la puerta pendiente
    state = {"config": cfg, "evaluated": {}}
    monkeypatch.setattr(rs, "decode", lambda genome, c: rule)
    found = rs._evaluate_genome(state, rs.Evaluator(cfg), {})
    assert found["hold"].get("pending") and set(found["parts"]) == {"a", "b"}


def part(n=100, edge=0.10, se=0.04, up=3, with_=3):
    return {"n": n, "edge": edge, "se": se, "coinsUp": up, "coinsWith": with_}


def test_la_aptitud_es_la_del_peor_tramo():
    cfg = config(minTrades=100, minCoins=3)
    record = lambda a, b: {"train": part(n=a["n"] + b["n"]), "parts": {"a": a, "b": b}, "complexity": 1}
    both = record(part(), part())
    assert rs.fitness(both, cfg) == 0.06
    # Buena en un tramo y mala en el otro: la nota del malo
    assert rs.fitness(record(part(edge=0.5), part(edge=-0.02)), cfg) == -0.06
    assert rs.fitness(record(part(edge=-0.02), part(edge=0.5)), cfg) == -0.06
    # Cada tramo pide la mitad de los trades mínimos: con menos, queda debajo de cualquiera que los tenga
    thin = rs.fitness(record(part(n=49, edge=0.9), part(n=300)), cfg)
    assert thin < -1 < rs.fitness(both, cfg)
    assert rs.fitness(record(part(n=50), part(n=50)), cfg) == 0.06
    # Sin el embudo no se miran los tramos
    assert rs.fitness(both, {**cfg, "funnel": False}) == 0.06
    assert rs.fitness({"train": part(n=150), "complexity": 1}, {**cfg, "funnel": False}) == 0.06


def test_el_margen_de_la_puerta_sube_con_las_miradas():
    assert round(rs._gate_z(1), 2) == 1.64
    assert round(rs._gate_z(10), 2) == 2.58
    assert round(rs._gate_z(20), 2) == 2.81
    assert rs._gate_z(0) == rs._gate_z(1)
    assert rs._luck([0.05, 0.05, 0.05], 100) == round(0.05 * (2 * np.log(100)) ** 0.5, 3)
    assert rs._luck([0.05], 1) is None and rs._luck([], 50) is None


def three(r, se=0.05):
    return {name: {"r": r, "low": round(r - 1.96 * se, 4), "high": round(r + 1.96 * se, 4), "se": se} for name in ("edge", "legEdge", "quarterEdge")}


class Gate:
    """Un evaluador falso: la puerta de cada regla ya viene escrita."""

    def __init__(self, holds):
        self.holds, self.asked = holds, []

    def evaluate(self, rule, gate=True, detail=False):
        self.asked.append((rule["id"], gate, detail))
        return {"hold": self.holds[rule["id"]], "coins": [], "regimes": {"hold": {"trend": []}}}


def _state(monkeypatch, tmp_path, holds, **extra):
    monkeypatch.setattr(rs, "search_dir", lambda: tmp_path)
    monkeypatch.setattr(rs, "_neighbors", lambda state, evaluator, record: [{"gene": "x", "edge": 0.1, "n": 50, "key": "v"}] * 3)
    monkeypatch.setattr(rs, "_distance", lambda a, b: 99)
    cfg = {**config(minTrades=100), **extra}
    evaluated = {}
    for i, name in enumerate(holds):
        evaluated[name] = {"key": name, "origin": "search", "genome": {}, "rule": {"id": name}, "complexity": 1, "coins": [],
                           "train": {**part(n=200), "avgR": 0.3}, "parts": {"a": part(), "b": part()},
                           "hold": {"n": 0, "pending": True}, "fitness": round(1.0 - i * 0.01, 4)}
    return {"id": "esta", "config": cfg, "evaluated": evaluated}


def test_la_puerta_solo_la_miran_las_finalistas_con_cupo_y_a_la_fase_2_van_pocas(monkeypatch, tmp_path):
    good = lambda r: {"n": 150, "edge": r, "se": 0.05, "avgR": 0.2, "three": three(r)}
    holds = {f"r{i:02d}": good(0.30 - i * 0.02) for i in range(12)}   # 12 reglas, de mejor a peor
    holds["r01"] = {"n": 150, "edge": -0.05, "se": 0.05, "avgR": -0.1, "three": three(-0.05)}  # No pasa
    holds["r02"] = {"n": 10, "edge": 0.5, "se": 0.2, "avgR": 0.5, "three": three(0.5)}         # Pocos trades
    state = _state(monkeypatch, tmp_path, holds, gateQuota=8, phase2Quota=3)
    gate = Gate(holds)
    rs._finish(state, gate, {})
    report = state["report"]
    assert report["funnel"] and len(report["finalists"]) == 8
    assert [x[0] for x in gate.asked] == [f"r{i:02d}" for i in range(8)], "solo las 8 mejores por aptitud miran la puerta"
    assert all(x[1] and x[2] for x in gate.asked)
    assert state["evaluated"]["r08"]["hold"].get("pending"), "la novena sigue sin mirarla"
    assert state["evaluated"]["r00"]["hold"]["n"] == 150, "la finalista queda con su puerta"
    by_key = {f["key"]: f for f in report["finalists"]}
    assert by_key["r01"]["verdict"].startswith("No les gana a los tres controles en la puerta")
    assert by_key["r02"]["verdict"].startswith("Pocos trades en la puerta (10)")
    # Pasan r00, r03, r04, r05, r06 y r07; a la fase 2 solo las tres mejores
    assert [k for k, f in by_key.items() if f["candidate"]] == ["r00", "r03", "r04"]
    assert by_key["r05"]["verdict"] == "Pasa la puerta, fuera del cupo de la fase 2" and by_key["r05"]["passed"]
    assert report["gate"] == {"quota": 8, "looked": 8, "best": 1.0, "before": 0, "looks": 8, "z": round(rs._gate_z(8), 2), "passed": 6,
                              "strong": sum(1 for f in report["finalists"] if f["strong"]), "phase2Quota": 3}
    # Con margen: 0.30 − 2.5 × 0.05 pasa; 0.16 − 2.5 × 0.05 también; pero 0.10 no
    assert by_key["r00"]["strong"] and by_key["r07"]["strong"]
    assert report["spearman"] is None and report["luckParts"].keys() == {"a", "b"}
    # Una regla que no ganó en sus dos tramos (aptitud en cero o menos) no llega a la puerta ni gasta una mirada
    state = _state(monkeypatch, tmp_path, {"r00": good(0.3), "r01": good(0.3)})
    state["evaluated"]["r00"]["fitness"], state["evaluated"]["r01"]["fitness"] = 0.0, -0.2
    gate = Gate(holds)
    rs._finish(state, gate, {})
    assert state["report"]["finalists"] == [] and gate.asked == [] and state["report"]["gate"]["looked"] == 0
    assert state["report"]["gate"]["best"] == 0.0


def test_pidiendo_el_margen_la_puerta_usa_el_de_todas_las_miradas_tambien_las_de_antes(monkeypatch, tmp_path):
    hold = {"n": 150, "edge": 0.12, "se": 0.05, "avgR": 0.2, "three": three(0.12)}
    # Sola: 0.12 − 1.64 × 0.05 > 0, pasa con margen
    state = _state(monkeypatch, tmp_path, {"r00": hold}, holdMargin=True)
    rs._finish(state, Gate({"r00": hold}), {})
    assert state["report"]["finalists"][0]["candidate"] and state["report"]["gate"]["looks"] == 1
    # Tras otra búsqueda con el mismo corte en que 30 reglas miraron la puerta: 0.12 − 2.94 × 0.05 < 0
    other = {"id": "anterior", "config": {"funnel": True, "split": SPLIT}, "evaluated": {str(i): {} for i in range(400)},
             "report": {"gate": {"looked": 30}}}
    (tmp_path / "anterior.json").write_text(json.dumps(other), encoding="utf-8")
    # Las de otro corte, o sin embudo, gastaron reglas pero no esta puerta
    (tmp_path / "otra.json").write_text(json.dumps({"id": "otra", "config": {"funnel": True, "split": "2022-07-01"},
                                                     "evaluated": {"x": {}}, "report": {"gate": {"looked": 50}}}), encoding="utf-8")
    (tmp_path / "vieja.json").write_text(json.dumps({"id": "vieja", "config": {"split": SPLIT}, "evaluated": {"y": {}, "z": {}}}), encoding="utf-8")
    state = _state(monkeypatch, tmp_path, {"r00": hold}, holdMargin=True)
    rs._finish(state, Gate({"r00": hold}), {})
    found = state["report"]["finalists"][0]
    assert not found["candidate"] and "margen de 31 miradas" in found["verdict"]
    assert state["report"]["gate"]["before"] == 30 and state["report"]["testedBefore"] == 403
    assert state["report"]["luckAllR"] > state["report"]["luckR"] if state["report"]["luckR"] else state["report"]["luckAllR"] is not None
    # Sin pedir el margen sigue pasando, y queda dicho que no lo tiene
    state = _state(monkeypatch, tmp_path, {"r00": hold})
    rs._finish(state, Gate({"r00": hold}), {})
    assert state["report"]["finalists"][0]["candidate"] and not state["report"]["finalists"][0]["strong"]


def trend_bars(n, drift, tf=TF, noise=0.002, seed=1):
    rng = np.random.default_rng(seed)
    bars, price = [], 100.0
    for k in range(n):
        close = price * (1 + drift + rng.normal(0, noise))
        bars.append({"t": START + k * tf * 60000, "o": price, "c": close, "h": max(price, close) * 1.001, "l": min(price, close) * 0.999})
        price = close
    return bars


def test_el_regimen_dice_subida_bajada_o_rango_y_no_mira_adelante():
    up = trade_regime.labels(trend_bars(400, 0.004), TF)
    down = trade_regime.labels(trend_bars(400, -0.004), TF)
    assert up[0] == (trade_regime.UNKNOWN, trade_regime.UNKNOWN), "sin historia no hay etiqueta"
    assert {t for t, _ in up[100:]} == {"subida"} and {t for t, _ in down[100:]} == {"bajada"}
    flat = trade_regime.labels(trend_bars(600, 0.0, noise=0.004), TF)
    assert sum(1 for t, _ in flat[100:] if t == "rango") > 60
    assert {v for _, v in up[250:]} <= {"alta", "baja"} and up[100][1] == trade_regime.UNKNOWN
    # Sin futuro: lo sabido en las primeras 300 velas no cambia con las siguientes
    bars = trend_bars(300, 0.003) + trend_bars(300, -0.006, seed=2)[0:0]
    mixed = trend_bars(600, 0.0, noise=0.01, seed=5)
    assert trade_regime.labels(mixed[:300], TF) == trade_regime.labels(mixed, TF)[:300]
    assert bars  # (usado arriba)
    # Con velas de 1 hora, la etiqueta es la del último bloque de 4 horas ya cerrado
    hourly = trend_bars(1600, 0.001, tf=60)
    labels = trade_regime.labels(hourly, 60)
    assert trade_regime.labels(hourly[:800], 60) == labels[:800]
    assert labels[4 * 70 + 3] == labels[4 * 71] == labels[4 * 71 + 2], "dentro del bloque en curso se lee el anterior"
    # Volatilidad: una serie que se calma queda en "baja"; una que se agita, en "alta"
    calm = trend_bars(300, 0.0, noise=0.01, seed=3) + [dict(b, t=START + (300 + i) * MS) for i, b in enumerate(trend_bars(100, 0.0, noise=0.0005, seed=4))]
    assert trade_regime.labels(calm, TF)[-1][1] == "baja"


def test_el_resumen_por_regimen_cuenta_cada_trade_una_vez(monkeypatch):
    rows = [("subida", "alta", 2.0, 1.5), ("subida", "baja", -1.0, -1.2), ("rango", "alta", -1.0, -0.8), ("subida", "alta", 1.0, 0.7)]
    summary = trade_regime.summarize(rows)
    assert summary["trend"][0] == {"label": "subida", "n": 3, "avgR": round(2 / 3, 4), "edge": round(1.0 / 3, 4)}
    assert [r["label"] for r in summary["vol"]] == ["alta", "baja"] and summary["both"][0]["label"] == "subida · alta"
    assert sum(r["n"] for r in summary["both"]) == 4
    fake_market(monkeypatch)
    out = rs.Evaluator(config()).evaluate(arrow_rule(), detail=True)
    for name in ("a", "b", "train", "hold"):
        assert sum(r["n"] for r in out["regimes"][name]["trend"]) == out[name]["n"]
        assert sum(r["n"] for r in out["regimes"][name]["vol"]) == out[name]["n"]
    assert "regimes" not in rs.Evaluator(config()).evaluate(arrow_rule())
