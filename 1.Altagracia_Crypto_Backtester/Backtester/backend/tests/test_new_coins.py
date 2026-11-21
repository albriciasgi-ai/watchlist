"""Monedas nuevas (velas de candles_update.py) y la búsqueda con las piezas nuevas. Uso: python -m pytest tests/test_new_coins.py"""
import gzip
import json
import random

import rule_search as rs
import rule_tester as rt

H = 3600000


def _write(path, start, hours):
    rows60 = [[start + k * H, 100.0, 100.5, 99.5, 100.0, 10.0] for k in range(hours)]
    rows240 = [[start + k * 4 * H, 100.0, 100.6, 99.4, 100.0, 40.0] for k in range(hours // 4)]
    with gzip.open(path, "wt", encoding="utf-8") as fh:
        json.dump({"60": rows60, "240": rows240}, fh)


def test_las_monedas_nuevas_se_leen_aparte_de_las_de_siempre(tmp_path, monkeypatch):
    base, extra = tmp_path / "base", tmp_path / "extra"
    base.mkdir()
    extra.mkdir()
    with gzip.open(base / "AAAUSDT_backtesting_data.json.gz", "wt", encoding="utf-8") as fh:
        json.dump({"timeframes": {"15m": {"main": []}}}, fh)
    start = rt._ms("2021-01-01")
    _write(extra / "NEWUSDT.json.gz", start, 24 * 400)
    _write(extra / "AAAUSDT.json.gz", start, 24 * 10)  # La de App 1 manda: su archivo nuevo no se usa
    monkeypatch.setattr(rt, "CANDLE_DIR", base)
    monkeypatch.setattr(rt, "EXTRA_DIR", extra)
    monkeypatch.setattr(rt.fs, "coverage", lambda symbol: {"first": None, "last": None, "days": 0})
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path / "observer")
    assert rt.candle_symbols() == ["AAAUSDT"] and rt.candle_symbols("new") == ["NEWUSDT"]
    assert rt.candle_symbols("all") == ["AAAUSDT", "NEWUSDT"]
    assert len(rt.candle_bars("NEWUSDT", 60)) == 24 * 400 and len(rt.candle_bars("NEWUSDT", 240)) == 6 * 400
    days = rt.candle_bars("NEWUSDT", 1440)
    assert len(days) == 400 and days[0]["vol"] == 6 * 40.0
    assert rt.candle_bars("NEWUSDT", 15) == []  # Las nuevas solo tienen 1h, 4h y 1D
    assert rt.phases("NEWUSDT")[0]["available"]
    plan = rt._plan(rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}}), 1, "new")
    assert [row["symbol"] for row in plan] == ["NEWUSDT"] and plan[0]["action"] == "run"


def test_la_busqueda_arma_reglas_con_las_piezas_nuevas():
    cfg = rs.clean_config({"tfs": [240], "codes": ["CP", "IM", "BX"], "maxElements": 1, "seed": 3})
    opts = rs._options(cfg)
    rng = random.Random(5)
    seen = {"straddle": False, "trail": False, "flow": False, "regime": False}
    for _ in range(400):
        genome = rs.random_genome(cfg, rng)
        rule = rs.decode(genome, cfg)
        codes = {c for s in rule["recipe"]["slots"] for c in s["codes"]}
        if "CP" in codes:
            assert rule["entry"]["type"] == "straddle"  # La compresión solo va con las dos órdenes
        seen["straddle"] |= rule["entry"]["type"] == "straddle"
        seen["trail"] |= rule["exit"]["trail"] in ("atr", "pct")
        seen["flow"] |= bool(rule.get("flow"))
        seen["regime"] |= bool(rule.get("regime"))
        assert rt.clean_rule(rule) == rule  # Cada genoma da una regla válida, que no cambia al volver a limpiarla
    assert all(seen.values())
    # Un genoma guardado antes de las piezas nuevas (sin esos genes) da la misma regla que daba
    old = {"tf": 0, "e1": cfg["codes"].index("IM"), "e2": 0, "e3": 0, "need": 0, "window": 0, "invert": 0,
           "entry": 0, "stop": 1, "target": 3, "trail": 0, "horizon": 0, "opposite": 0, "line": 0, "slope": 0}
    rule = rs.decode(old, cfg)
    assert rule["entry"]["type"] == "market" and rule["exit"]["trail"] == "none"
    assert "flow" not in rule and "regime" not in rule and "breakEven" not in rule["exit"]
    off = rs.clean_config({"tfs": [240], "codes": ["IM"], "flow": False, "regime": False, "trailing": False, "straddle": False,
                           "stopEntry": False, "williams": False})  # 20/11: la orden stop a favor y los filtros de Williams y SMC
    opts = rs._options(off)
    assert opts["cvd"] == (None,) and opts["regime"] == (None,) and len(opts["trail"]) == 2 and len(opts["entry"]) == 3
    assert opts["bwf"] == (None,) and opts["targetWeak"] == (False,)
