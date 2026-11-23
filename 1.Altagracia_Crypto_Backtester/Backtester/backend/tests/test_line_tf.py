"""La EMA leída en un marco mayor (22/11/2026): la tendencia por el precio de la versión refinada de DX.
Uso: python -m pytest tests/test_line_tf.py"""
import numpy as np
import pytest

import rule_tester as rt

TF = 30
MS = TF * 60000
H4 = 240 * 60000
T0 = 1_767_225_600_000  # 2026-01-01 00:00 UTC, en el borde de un bloque de 4 horas
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def bars_from(closes, start=T0, tf=TF):
    out, prev = [], closes[0]
    for k, c in enumerate(closes):
        out.append({"t": start + k * tf * 60000, "o": prev, "h": max(prev, c) + 0.05, "l": min(prev, c) - 0.05, "c": float(c),
                    "delta": 0.0, "vol": 9.0 + 2 * (k % 2)})
        prev = float(c)
    return out


def ema(values, n):
    k, v, out = 2 / (n + 1), values[0], []
    for i, x in enumerate(values):
        v = x * k + v * (1 - k)
        out.append(v if i >= n - 1 else float("nan"))
    return out


def test_solo_entra_si_se_pide_en_la_ema_y_en_un_marco_mayor():
    base = {"name": "E", "tf": TF, "recipe": {"slots": [{"codes": ["VH"]}]}, "exit": {"targetR": 2}}
    plain = rt.clean_rule({**base, "lines": [{"type": "ema", "period": 200, "mode": "side"}]})
    assert plain["lines"] == [{"type": "ema", "period": 200, "mode": "side", "slope": False}]  # sin tf, la de siempre
    four = rt.clean_rule({**base, "lines": [{"type": "ema", "period": 200, "mode": "side", "tf": 240}]})
    assert four["lines"][0]["tf"] == 240 and rt.rule_hash("X", plain) != rt.rule_hash("X", four)
    # El marco de la regla, uno que no es mayor o el VWAP no la cambian
    for line in ({"type": "ema", "period": 50, "mode": "side", "tf": 30}, {"type": "ema", "period": 50, "mode": "side", "tf": 45},
                 {"type": "vwap", "period": 200, "mode": "side", "tf": 240}, {"type": "ema", "period": 50, "mode": "side", "tf": 0}):
        assert "tf" not in rt.clean_rule({**base, "lines": [line]})["lines"][0]


def test_lee_la_ultima_vela_de_4_horas_ya_cerrada_con_su_ema_y_su_cierre():
    rng = np.random.default_rng(3)
    closes = 100 + np.cumsum(rng.normal(0, 0.3, 8 * 60))  # 60 velas de 4 horas, de 8 velas de 30 minutos
    bars = bars_from(closes)
    ctx = rt._context("X", TF, bars)
    item = {"type": "ema", "period": 10, "mode": "side", "slope": False, "tf": 240}
    block_close = [bars[8 * j + 7]["c"] for j in range(60)]
    expected = ema(block_close, 10)
    view = rt._line_view(ctx, item)
    differ = 0
    for k in range(len(bars)):
        j = (k + 1) // 8 - 1  # las velas de 4 horas ya cerradas al cerrar la vela k
        level, close, _, _, _ = rt._line_at(ctx, item, k)
        if j < 0 or expected[j] != expected[j]:
            assert level != level and not rt._lines_ok([item], ctx, k, 1) and not rt._lines_ok([item], ctx, k, -1)
            continue
        assert T0 + (j + 1) * H4 <= bars[k]["t"] + MS  # nada del futuro: esa vela de 4 horas ya terminó
        assert close == block_close[j] and level == pytest.approx(expected[j]) and view[k] == pytest.approx(level)
        # Decide el cierre de 4 horas contra su EMA, no el cierre de la vela de 30 minutos
        assert rt._lines_ok([item], ctx, k, 1) == (block_close[j] > expected[j])
        assert rt._lines_ok([item], ctx, k, -1) == (block_close[j] < expected[j])
        differ += (bars[k]["c"] > expected[j]) != (block_close[j] > expected[j])
    assert differ > 0  # hay velas donde el cierre de 30 minutos diría otra cosa
    # La pendiente se mide en velas de 4 horas
    sloped = dict(item, slope=True)
    k = 8 * 40 + 7
    level, _, _, _, before = rt._line_at(ctx, sloped, k)
    assert before == pytest.approx(expected[40 - rt.LINE_SLOPE_BARS]) and level == pytest.approx(expected[40])


def ramp(points):
    """Velas de 15 minutos desde la hora 0, como en test_structure.py."""
    return [{"t": k * 15 * 60000, "o": p, "h": p + 0.1, "l": p - 0.1, "c": p, "delta": 0.0, "vol": 9.0 + 2 * (k % 2)} for k, p in enumerate(points)]


def test_la_regla_filtra_con_la_ema_de_la_hora_y_la_anota_en_el_trade(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    raw = {"name": "P", "tf": 15, "recipe": {"slots": [{"codes": ["HM"]}]}, "stop": {"type": "candle", "buffer": 0.1, "maxAtr": 100},
           "exit": {"targetR": None, "horizon": 5}, "cooldown": 0, "lines": [{"type": "ema", "period": 3, "mode": "side", "tf": 60}]}
    # Subiendo, el cierre de la última hora cerrada queda sobre su EMA: el martillo (largo) pasa
    rising = ramp([100 + k * 0.5 for k in range(60)] + [130] * 60)
    rising[45].update(o=122.9, c=123.0, h=123.05, l=121.5)
    rule = rt.clean_rule({**raw, "pat": {"trend": False}})
    (trade,) = rt.run("X", rule, {"bars": rising, "events": []}, PHASE, None, base=False)["trades"]
    ctx = rt._context("X", 15, rising)
    assert trade["signal"] == rising[45]["t"] and trade["lines"][0]["tf"] == 60
    assert trade["lines"][0]["value"] == pytest.approx(float(rt._line_view(ctx, rule["lines"][0])[45]), rel=1e-6)
    # Bajando, el cierre de la hora queda bajo su EMA: el martillo no pasa
    falling = ramp([130 - k * 0.5 for k in range(60)] + [100] * 60)
    for k, bar in enumerate(falling):
        bar["vol"] = 9.0 + 2 * (k % 2)
    falling[45].update(o=107.4, c=107.5, h=107.55, l=106.0, vol=40.0)
    result = rt.run("X", rt.clean_rule(raw), {"bars": falling, "events": []}, PHASE, None, base=False)
    assert result["trades"] == [] and result["skipped"] == {"filtro de VWAP o EMA": 1}
