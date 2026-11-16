"""Regla de los patrones de vela (candle_patterns.py) y su paridad con el navegador (candlePatterns.js), 16/11/2026.
Uso: python -m pytest tests/test_candle_patterns.py"""
import json
import random
import shutil
import subprocess
from pathlib import Path

import pytest

import candle_patterns as cp
from rejection_detector import RejectionDetector

HERE = Path(__file__).resolve().parent
NO_TREND = {"filters": {"requireTrend": False}, "patterns": {"doji": {"enabled": True}}}


def c(o, h, l, cl, v=100.0, t=0):
    return {"timestamp": t, "open": o, "high": h, "low": l, "close": cl, "volume": v}


def shape(prev, cur):
    return cp.shape_of(prev, cur, 2.0, {"doji": True})


def test_envolvente_con_apertura_igual_al_cierre_anterior():
    # En cripto la vela abre donde cerro la anterior: antes el servidor nunca lo marcaba
    prev = c(100, 101, 94, 95)          # bajista, cuerpo 5
    cur = c(95, 104, 94.5, 103)         # alcista, abre en 95 (el cierre anterior), cuerpo 8
    assert shape(prev, cur) == "ENGULFING_BULLISH"
    assert shape(c(95, 101, 94, 100), c(100, 100.5, 91, 92)) == "ENGULFING_BEARISH"


def test_envolvente_no_con_dojis_ni_cuerpos_iguales():
    # el caso del 06/11 10:15: la anterior casi doji (cuerpo 0.1) no es una vela envuelta
    assert shape(c(76144.5, 76160, 76130, 76144.6), c(76144.6, 76150, 76050, 76100)) != "ENGULFING_BEARISH"
    # cuerpos iguales: no envuelve
    assert shape(c(100, 101, 94, 95), c(95, 101, 94, 100)) is None
    # la actual casi doji (cuerpo < 30% del rango): no
    assert shape(c(100, 100.5, 99, 99.5), c(99.5, 104, 95, 100.3)) != "ENGULFING_BULLISH"


def test_martillo_por_rango_y_no_por_cuerpo():
    # el martillo de libro del 06/11 15:30 que ninguno marcaba: mecha de arriba 5% del rango (29% del cuerpo)
    assert shape(None, c(75612.0, 75719.6, 75250.0, 75695.5)) == "HAMMER"
    assert shape(None, c(75511.4, 75819.5, 74810.0, 75809.1)) == "HAMMER"
    # estrella del 07/11 23:45: mecha de abajo 6% del rango
    assert shape(None, c(75828.2, 75904.5, 75823.3, 75841.5)) == "SHOOTING_STAR"


def test_doji_libelula_no_es_martillo():
    assert shape(None, c(100, 100, 90, 100)) == "DOJI_DRAGONFLY"
    assert shape(None, c(100, 110, 100, 100)) == "DOJI_GRAVESTONE"
    assert shape(None, c(100, 105, 95, 100.2)) is None       # doji de piernas largas: ninguno de los dos


def _trend(direction, n=8, start=100.0):
    out, p = [], start
    for i in range(n):
        q = p - 2 if direction == "down" else p + 2
        out.append(c(p, max(p, q) + 0.5, min(p, q) - 0.5, q, t=i))
        p = q
    return out, p


def test_tendencia_previa():
    down, p = _trend("down")
    ham = c(p, p + 0.3, p - 8, p + 1.5, t=99)
    opts = cp.rule_options({})
    assert [x["type"] for x in cp.find_patterns(down + [ham], opts)] == ["HAMMER"]
    up, p = _trend("up")
    ham = c(p, p + 0.3, p - 8, p + 1.5, t=99)              # el mismo martillo tras una subida: hanging man
    assert cp.find_patterns(up + [ham], opts) == []
    assert [x["type"] for x in cp.find_patterns(up + [ham], cp.rule_options({"filters": {"requireTrend": False}}))] == ["HAMMER"]


def test_filtro_de_volumen_filtra():
    down, p = _trend("down", 25)
    for k in down:
        k["volume"] = 100.0 + (k["timestamp"] % 3)
    ham = c(p, p + 0.3, p - 8, p + 1.5, v=101.0, t=99)
    opts = cp.rule_options({"volumeZScore": {"enabled": True, "lookbackPeriod": 20, "minZScore": 1.0}})
    assert cp.find_patterns(down + [ham], opts) == []
    ham["volume"] = 500.0
    assert [x["type"] for x in cp.find_patterns(down + [ham], opts)] == ["HAMMER"]


def _random_candles(seed, n=3000):
    rnd = random.Random(seed)
    out, p = [], 1000.0
    for i in range(n):
        o = p
        cl = round(o * (1 + rnd.gauss(0, 0.004)), 2)
        if rnd.random() < 0.05:
            cl = o                                   # dojis de verdad
        hi = round(max(o, cl) * (1 + abs(rnd.gauss(0, 0.002)) * rnd.choice([0, 1, 1, 3])), 2)
        lo = round(min(o, cl) * (1 - abs(rnd.gauss(0, 0.002)) * rnd.choice([0, 1, 1, 3])), 2)
        out.append(c(o, hi, lo, cl, v=round(rnd.uniform(50, 400), 3), t=i))
        p = cl
    return out


@pytest.mark.skipif(shutil.which("node") is None, reason="sin node")
def test_paridad_con_el_navegador():
    configs = [{}, NO_TREND, {"filters": {"trendBars": 3}, "patterns": {"hammer": {"minWickRatio": 3}}},
               {"volumeZScore": {"enabled": True, "lookbackPeriod": 10, "minZScore": 0.5}, "patterns": {"doji": {"enabled": True}}},
               {"patterns": {"engulfing": {"enabled": False}, "shootingStar": {"enabled": False}}}]
    cases = [{"candles": _random_candles(s), "config": cfg} for s in (1, 2) for cfg in configs]
    run = subprocess.run(["node", str(HERE / "candle_patterns_parity.mjs")], input=json.dumps({"cases": cases}),
                         capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, run.stderr
    js = json.loads(run.stdout)
    total = 0
    for case, got in zip(cases, js):
        py = [[p["index"], p["type"], None if p["volumeZ"] is None else round(p["volumeZ"] * 1e6) / 1e6]
              for p in cp.find_patterns(case["candles"], cp.rule_options(case["config"]))]
        assert py == got
        total += len(py)
    assert total > 100                               # hubo patrones que comparar


LEVEL_CTX = [{"id": "vp1", "type": "VOLUME_PROFILE_FIXED", "enabled": True, "weight": 1.0, "levels": ["VAL"],
              "metadata": {"val": 90.0, "endTimestamp": 0}}]


def _validated(final):
    down, _ = _trend("down", 8, start=106.0)
    cfg = {"filters": {"minConfidence": 0, "requireNearLevel": True, "proximityPercent": 1.0}}
    return RejectionDetector().detect_patterns("X", down + [final], cfg, LEVEL_CTX)


def test_validado_mide_la_mecha_y_el_lado():
    # martillo cuya mecha toca el VAL (90) y cierra arriba: vale
    ok = _validated(c(91.0, 91.6, 89.95, 91.5, t=99))
    assert [p.pattern_type for p in ok] == ["HAMMER"]
    # mismo martillo pero cerrando bajo el VAL: no rechaza el nivel
    assert _validated(c(89.0, 89.6, 87.0, 89.5, t=99)) == []
    # cierre cerca del nivel pero la mecha lejos (ya no se mide con el cierre): no
    assert _validated(c(90.4, 90.9, 86.0, 90.8, t=99)) == []


def test_validado_no_usa_la_vela_en_curso():
    final = c(91.0, 91.6, 89.95, 91.5, t=99)
    final["in_progress"] = True
    assert _validated(final) == []
