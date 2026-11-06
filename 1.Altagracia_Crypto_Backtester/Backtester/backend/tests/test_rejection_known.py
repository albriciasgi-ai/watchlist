"""Rejection validado en backtesting: niveles ya formados y sin alertas. Uso: python -m pytest tests/test_rejection_known.py"""
import asyncio
import json

import pytest

import main
from rejection_detector import RejectionDetector

HOUR = 3600000
START = 1780444800000

CONFIG = {
    "patterns": {
        "hammer": {"enabled": True, "minWickRatio": 2.0},
        "shootingStar": {"enabled": True, "minWickRatio": 2.0},
        "engulfing": {"enabled": False},
        "doji": {"enabled": False},
    },
    "filters": {"minConfidence": 0, "requireNearLevel": True, "proximityPercent": 1.0, "requireVolumeSpike": False},
}


def flat(i, price=1000.0):
    return {"timestamp": START + i * HOUR, "open": price, "high": price + 5, "low": price - 5, "close": price + 2, "volume": 100.0}


def hammer(i, close=1000.0):
    return {"timestamp": START + i * HOUR, "open": close - 4, "high": close + 0.2, "low": close - 40, "close": close, "volume": 300.0}


def candles_with_hammers(*indexes, count=40):
    return [hammer(i) if i in indexes else flat(i) for i in range(count)]


def context(end_index, poc=1000.0, kind="VOLUME_PROFILE_FIXED", enabled=True):
    return {
        "id": f"range_{end_index}", "type": kind, "enabled": enabled, "weight": 0.5, "levels": ["POC", "VAH", "VAL"],
        "metadata": {"poc": poc, "vah": poc + 20, "val": poc - 20, "startTimestamp": START, "endTimestamp": START + end_index * HOUR},
    }


def detect(candles, contexts, strict=True):
    return RejectionDetector().detect_patterns("BTCUSDT", candles, CONFIG, contexts, known_levels_only=strict)


def stamps(patterns):
    return [(pattern.timestamp - START) // HOUR for pattern in patterns]


def test_un_nivel_solo_valida_velas_desde_que_existe():
    patterns = detect(candles_with_hammers(10, 20, 30), [context(20)])
    assert stamps(patterns) == [20, 30], "la vela 10 ocurrió antes de terminar el rango"


def test_sin_modo_estricto_sigue_validando_con_el_nivel_actual():
    patterns = detect(candles_with_hammers(10, 20, 30), [context(20)], strict=False)
    assert stamps(patterns) == [10, 20, 30]


def test_cada_vela_usa_los_niveles_formados_hasta_ella():
    contexts = [context(15, poc=2000.0), context(25, poc=1000.0)]
    assert stamps(detect(candles_with_hammers(20, 30), contexts)) == [30], "en la vela 20 solo existía el nivel lejano"


def test_un_rango_futuro_no_valida_nada():
    assert detect(candles_with_hammers(10, 20), [context(100)]) == []


def test_un_contexto_apagado_no_cuenta():
    assert detect(candles_with_hammers(20), [context(5, enabled=False)]) == []


def test_un_nivel_sin_calcular_se_ignora():
    empty = context(5)
    empty["metadata"].update(poc=None, vah=None, val=None)
    assert detect(candles_with_hammers(20), [empty, context(5)]) != []
    assert detect(candles_with_hammers(20), [empty]) == []


def test_un_contexto_sin_fecha_no_sirve_en_backtesting():
    without_date = context(5)
    del without_date["metadata"]["endTimestamp"]
    assert detect(candles_with_hammers(20), [without_date]) == []


def test_rango_detectado_usa_su_fecha():
    candles = candles_with_hammers(10, 20)
    range_context = {
        "id": "r", "type": "RANGE_DETECTOR", "enabled": True, "weight": 0.5,
        "metadata": {"top": 1000.0, "bottom": 900.0, "endTimestamp": START + 15 * HOUR},
    }
    assert stamps(detect(candles, [range_context])) == [20]


def test_la_vela_final_del_rango_ya_cuenta():
    assert stamps(detect(candles_with_hammers(20), [context(20)])) == [20]


def test_el_resultado_de_una_vela_no_cambia_con_velas_posteriores():
    candles = candles_with_hammers(8, 20, 26, 33)
    contexts = [context(6), context(24, poc=1001.0)]
    everything = {(p.timestamp, p.pattern_type, p.confidence) for p in detect(candles, contexts)}
    for end in range(10, len(candles)):
        cut = {(p.timestamp, p.pattern_type, p.confidence) for p in detect(candles[:end], contexts)}
        assert cut == {item for item in everything if item[0] < START + end * HOUR}


class FakeRequest:
    def __init__(self, body):
        self.body = body

    async def json(self):
        return self.body


def post(body):
    return asyncio.run(main.detect_rejection_patterns(FakeRequest(body)))


@pytest.fixture
def no_network(monkeypatch):
    async def fail(*args, **kwargs):
        raise AssertionError("no debe pedir velas recientes")

    sent = []

    async def alert(*args, **kwargs):
        sent.append(args)

    monkeypatch.setattr(main, "_fetch_historical_internal", fail)
    monkeypatch.setattr(main, "send_pattern_alert", alert)
    return sent


def test_con_velas_no_pide_velas_recientes_ni_envia_alertas(no_network):
    config = json.loads(json.dumps(CONFIG))
    config["alertsEnabled"] = True
    result = post({
        "symbol": "BTCUSDT", "interval": "15m", "config": config,
        "referenceContexts": [context(5)], "candles": candles_with_hammers(20),
    })
    assert result["success"] is True
    assert len(result["patterns"]) == 1 and result["patterns"][0]["patternType"] == "HAMMER"
    assert no_network == [], "una simulación nunca avisa al bot"


def test_en_simulacion_el_endpoint_exige_niveles_ya_formados(no_network):
    result = post({
        "symbol": "BTCUSDT", "interval": "15m", "config": CONFIG,
        "referenceContexts": [context(15)], "candles": candles_with_hammers(10, 20),
    })
    assert [(pattern["timestamp"] - START) // HOUR for pattern in result["patterns"]] == [20]


def test_sin_velas_sigue_el_camino_de_siempre(monkeypatch):
    calls = []

    async def fetched(symbol, interval, days):
        calls.append(interval)
        return {"success": True, "data": candles_with_hammers(20)}

    monkeypatch.setattr(main, "_fetch_historical_internal", fetched)
    result = post({"symbol": "BTCUSDT", "interval": "15", "days": 7, "config": CONFIG, "referenceContexts": [context(30)]})
    assert calls == ["15"]
    assert len(result["patterns"]) == 1, "fuera de backtesting no se exige la fecha del nivel"
