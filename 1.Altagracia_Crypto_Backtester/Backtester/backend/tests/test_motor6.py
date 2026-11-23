"""
Decisiones del protocolo de pruebas que cambian trades (motor 6, 22/11/2026):

- H4: lo máximo a favor (y en contra) de la vela del llenado de una limit u orden stop se mide desde el llenado.
- H15: la señal de la vela en que salió el trade anterior ya puede entrar; una orden que espera y se llena en esa vela
  entra si se llenó después de la salida.
- F-01: el enfriamiento no empieza activo al comienzo de la fase.
- H16: "Extremo de la vela del elemento" en un FVG cubre las tres velas del patrón.
- H18: una señal cuya comisión de ida y vuelta pasa de 0.3 R no se toma.
- H19: con una posición a la vez y entrada a mercado, una vela con una señal larga y otra corta no da ninguna.

Uso: python -m pytest tests/test_motor6.py
"""
import numpy as np

import rule_tester as rt

TF = 15
MS = TF * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def flat(n=200, price=100.0):
    """Velas planas: abren y cierran en `price`, con medio punto de mecha a cada lado (ATR 1)."""
    return [{"t": k * MS, "o": price, "h": price + 0.5, "l": price - 0.5, "c": price, "delta": 0.0, "vol": 10.0} for k in range(n)]


def ev(bar, lo=99.0, hi=99.6, d=1):
    return {"code": "EX", "dir": d, "t": bar * MS, "known": (bar + 1) * MS, "lo": lo, "hi": hi}


def rule(entry=None, **kw):
    base = {"name": "R", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1},
            "entry": entry or {"type": "market"}, "stop": {"type": "atr", "atr": 3.0, "minAtr": 0, "maxAtr": 100},
            "exit": {"targetR": None, "horizon": 3}}
    base.update(kw)
    return rt.clean_rule(base)


def go(bars, events, r, monkeypatch, minutes=None):
    """minutes: {vela: [(alto, bajo), ...]} con los minutos de esas velas; las demás, sin minutos."""
    def reader(symbol, a, b):
        rows = (minutes or {}).get(a // TF)
        if rows is None:
            return None
        return {"m": np.arange(a, a + len(rows)), "h": np.array([h for h, _ in rows]), "l": np.array([l for _, l in rows])}

    monkeypatch.setattr(rt.fs, "minutes", reader)
    return rt.run("TEST", r, {"bars": bars, "events": events}, PHASE, None, base=False)


# ---------- H15: la vela de la salida ----------

def test_a_mercado_la_senal_de_la_vela_de_la_salida_entra(monkeypatch):
    """El trade de la señal 30 entra en la 31 y sale por tiempo al cierre de la 33. La señal de la 33 se decide al cerrar
    la 33, cuando ya salió: entra en la apertura de la 34. Antes del motor 6 quedaba como posición abierta."""
    result = go(flat(), [ev(30), ev(33)], rule(), monkeypatch)
    assert [t["entry_t"] // MS for t in result["trades"]] == [31, 34]
    assert result["busy"] == 0


def bars_exit_then_fill():
    """La vela 33 baja de 100 a 95: el largo de la señal 30 (limit en 99.6, stop a 3 ATR, 96.6) sale por su stop y la limit
    de la señal 32 espera más abajo, en 95.5."""
    bars = flat()
    bars[33].update(o=100.0, h=100.5, l=95.0, c=96.0)
    events = [ev(30), ev(32, 95.0, 95.5)]
    r = rule({"type": "limit", "at": "near", "expiry": 5}, exit={"targetR": None, "horizon": 10})
    return bars, events, r


def test_una_limit_que_se_llena_despues_de_la_salida_entra(monkeypatch):
    bars, events, r = bars_exit_then_fill()
    # Minuto 1: toca el stop del primero (96.6). Minuto 2: cruza la limit del segundo (95.5)
    result = go(bars, events, r, monkeypatch, {33: [(100.2, 99.0), (99.0, 96.5), (96.5, 95.0)]})
    assert [round(t["entry"], 4) for t in result["trades"]] == [99.6, 95.5]
    assert result["trades"][0]["reason"] == "stop" and result["busy"] == 0


def test_en_el_mismo_minuto_que_la_salida_no_entra(monkeypatch):
    bars, events, r = bars_exit_then_fill()
    # Un solo minuto toca el stop del primero y cruza la limit del segundo: no se sabe cuál fue antes
    result = go(bars, events, r, monkeypatch, {33: [(100.2, 99.0), (99.0, 95.0)]})
    assert [round(t["entry"], 4) for t in result["trades"]] == [99.6]
    assert result["busy"] == 1


def test_sin_minutos_decide_el_recorrido_supuesto_de_la_vela_de_la_salida(monkeypatch):
    bars, events, r = bars_exit_then_fill()
    # Apertura 100, máximo 100.5, mínimo 95: en el tramo que baja, el stop (96.6) llega antes que la limit (95.5)
    result = go(bars, events, r, monkeypatch)
    assert [round(t["entry"], 4) for t in result["trades"]] == [99.6, 95.5]


def test_una_limit_que_se_llena_antes_de_la_salida_no_entra(monkeypatch):
    bars, events, r = bars_exit_then_fill()
    events[1] = ev(32, 99.0, 99.4)  # La segunda limit, en 99.4: el precio la cruza antes de llegar al stop del primero
    result = go(bars, events, r, monkeypatch, {33: [(100.2, 99.0), (99.0, 96.5), (96.5, 95.0)]})
    assert [round(t["entry"], 4) for t in result["trades"]] == [99.6]
    assert result["busy"] == 1


# ---------- F-01: el enfriamiento al comienzo de la fase ----------

def test_el_enfriamiento_no_empieza_activo(monkeypatch):
    result = go(flat(), [ev(20)], rule(cooldown=30), monkeypatch)
    assert len(result["trades"]) == 1 and "enfriamiento" not in result["skipped"]


def test_el_enfriamiento_sigue_tras_un_trade(monkeypatch):
    """El trade de la señal 20 sale al cierre de la 23: con 8 velas de espera, las señales de la 23 a la 31 no entran."""
    result = go(flat(), [ev(20), ev(23), ev(31), ev(32)], rule(cooldown=8), monkeypatch)
    assert [t["signal"] // MS for t in result["trades"]] == [20, 32]
    assert result["skipped"]["enfriamiento"] == 2


# ---------- H16: el stop por la vela del FVG ----------

def fvg_bars():
    """Un FVG alcista entre la vela 30 (máximo 100.5, mínimo 97) y la 32 (mínimo 101), que se conoce al cerrar la 32."""
    bars = flat()
    bars[30].update(o=100.0, h=100.5, l=97.0, c=100.2)
    bars[31].update(o=100.2, h=103.0, l=100.1, c=102.8)
    bars[32].update(o=102.8, h=103.5, l=101.0, c=103.2)
    for b in bars[33:]:
        b.update(o=103.2, h=103.7, l=102.7, c=103.2)
    return bars


def test_el_stop_por_la_vela_del_fvg_cubre_sus_tres_velas(monkeypatch):
    r = rule(recipe={"slots": [{"codes": ["FV"]}], "mode": "strict", "window": 1}, fv={"minAtr": 0},
             stop={"type": "candle", "buffer": 0, "minAtr": 0, "maxAtr": 100})
    result = go(fvg_bars(), [], r, monkeypatch)
    assert len(result["trades"]) == 1
    trade = result["trades"][0]
    assert trade["signal"] == 32 * MS
    assert trade["stop"] == 97.0, "el mínimo de las tres velas del patrón; antes, el de la tercera (101)"


# ---------- H18: la comisión que se come el riesgo ----------

def test_una_senal_con_la_comision_sobre_el_tope_no_se_toma(monkeypatch):
    tiny = {"type": "atr", "atr": 0.1, "minAtr": 0, "maxAtr": 100}  # Riesgo 0.1: la comisión de ida y vuelta vale 1.1 R
    result = go(flat(), [ev(30)], rule(stop=tiny), monkeypatch)
    assert result["trades"] == [] and result["skipped"] == {"comisión muy alta para el riesgo": 1}
    assert len(go(flat(), [ev(30)], rule(stop=tiny, maxFeeR=0), monkeypatch)["trades"]) == 1, "0 apaga el tope"
    assert len(go(flat(), [ev(30)], rule(), monkeypatch)["trades"]) == 1, "con 3 ATR la comisión es 0.04 R"


def test_el_tope_de_fabrica_no_cambia_la_identidad_de_la_regla():
    plain, explicit, other = rule(), rule(maxFeeR=rt.MAX_FEE_R), rule(maxFeeR=0.5)
    assert "maxFeeR" not in plain and "maxFeeR" not in explicit and other["maxFeeR"] == 0.5
    assert rt.rule_hash("X", plain) == rt.rule_hash("X", explicit) != rt.rule_hash("X", other)


# ---------- H19: señales opuestas en la misma vela ----------

def test_senales_opuestas_en_la_misma_vela_no_dan_ninguna(monkeypatch):
    r = rule(recipe={"slots": [{"codes": ["EX"]}], "mode": "strict", "window": 1, "side": "both"})
    result = go(flat(), [ev(30, d=1), ev(30, d=-1)], r, monkeypatch)
    assert result["trades"] == [] and result["skipped"] == {"señales opuestas en la misma vela": 2}
    # Sin una posición a la vez entran las dos
    both = go(flat(), [ev(30, d=1), ev(30, d=-1)], rule(recipe=r["recipe"], oneAtATime=False), monkeypatch)
    assert sorted(t["dir"] for t in both["trades"]) == [-1, 1]


# ---------- H4: lo a favor de la vela del llenado ----------

def fill_bar_trade():
    """La limit en 99.6 de la señal 30 se llena en la vela 31, que primero sube a 100.6 y después baja a 99. Sale al
    cierre de esa misma vela (tiempo, 1 vela): lo a favor es solo lo de esa vela."""
    bars = flat()
    bars[31].update(o=100.0, h=100.6, l=99.0, c=99.2)
    return bars, [ev(30)], rule({"type": "limit", "at": "near", "expiry": 5}, exit={"targetR": None, "horizon": 1})


def test_sin_minutos_lo_a_favor_empieza_en_el_llenado(monkeypatch):
    bars, events, r = fill_bar_trade()
    trade = go(bars, events, r, monkeypatch)["trades"][0]
    # El máximo (100.6) fue antes de llenarse: desde el llenado el precio no pasó de la entrada. Antes, 0.333 R
    assert trade["entry"] == 99.6 and trade["mfe"] == 0.0 and trade["mae"] == round((99.0 - 99.6) / 3.0, 3)


def test_con_minutos_lo_a_favor_empieza_en_el_minuto_del_llenado(monkeypatch):
    bars, events, r = fill_bar_trade()
    trade = go(bars, events, r, monkeypatch, {31: [(100.6, 100.0), (100.0, 99.0), (99.5, 99.1)]})["trades"][0]
    assert trade["mfe"] == round((100.0 - 99.6) / 3.0, 3), "el máximo desde el minuto del llenado, 100"


def test_a_mercado_lo_a_favor_es_toda_la_vela(monkeypatch):
    bars, events, _ = fill_bar_trade()
    trade = go(bars, events, rule(exit={"targetR": None, "horizon": 1}), monkeypatch)["trades"][0]
    assert trade["entry"] == 100.0 and trade["mfe"] == round(0.6 / 3.0, 3)


# ---------- H2: las velas anteriores a la fase ----------

def warm_span(events, lead=60, n=200):
    """`lead` velas de antes de la fase (con un mínimo único en 95, 10 velas antes de que empiece) y `n` de la fase."""
    bars = flat(lead + n)
    bars[lead - 10].update(l=95.0)
    return {"bars": bars[lead:], "events": events, "warm": bars[:lead]}


def test_el_stop_ve_el_swing_de_antes_de_la_fase(monkeypatch):
    r = rule(stop={"type": "swing", "bars": 5, "buffer": 0, "minAtr": 0, "maxAtr": 100})
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    warm = rt.run("TEST", r, warm_span([ev(63)]), PHASE, None, base=False)
    assert [t["stop"] for t in warm["trades"]] == [95.0], "el swing de 10 velas antes de la fase"
    assert warm["bars"] == 200 and warm["warm"] == 60
    cold = rt.run("TEST", r, {"bars": warm_span([])["bars"], "events": [ev(63)]}, PHASE, None, base=False)
    assert [t["stop"] for t in cold["trades"]] == [99.5], "sin velas de antes, el extremo de las que hay"


def test_ninguna_senal_ni_entrada_al_azar_cae_antes_de_la_fase(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    span = warm_span([ev(20), ev(70)])  # La 20 es de antes de la fase; la 70, la vela 10 de la fase
    result = rt.run("TEST", rule(), span, PHASE, None, base=False)
    assert [t["signal"] // MS for t in result["trades"]] == [70] and result["signals"] == 1
    seen = []
    real = rt.simulate
    monkeypatch.setattr(rt, "simulate", lambda rl, c, k, side, *a, **kw: seen.append(k) or real(rl, c, k, side, *a, **kw))
    rt.run("TEST", rule(), warm_span([ev(70)]), PHASE, None)
    assert seen and min(seen) >= 60, "el azar y el tramo entran desde la primera vela de la fase"


# ---------- B-05 y B-06: deslizamiento y funding, apagados de fábrica ----------

def test_cada_trade_trae_sus_costos_y_la_regla_los_descuenta_si_los_pide(monkeypatch):
    hours = np.arange(0, 400 * MS, 8 * 3600000, dtype=np.int64)
    monkeypatch.setattr(rt.flow_filters, "funding_series", lambda symbol: (hours, np.full(len(hours), 0.0001)))
    plain = go(flat(), [ev(30)], rule(exit={"targetR": None, "horizon": 40}), monkeypatch)["trades"][0]
    # A mercado y sale por tiempo: entrada y salida deslizan; 0.01% de 100 y de 100 sobre un riesgo de 3
    assert plain["slip"] == round(200 * 0.0001 / 3.0, 6)
    paid = sum(1 for t in hours if plain["entry_t"] < t <= plain["exit_t"])
    assert paid > 0 and plain["funding"] == round(-paid * 0.0001 * 100 / 3.0, 6), "el largo paga la tasa positiva"
    costly = go(flat(), [ev(30)], rule(exit={"targetR": None, "horizon": 40}, slippage=0.02, funding=True), monkeypatch)["trades"][0]
    assert costly["r"] == round(plain["r"] - 2 * plain["slip"] + plain["funding"], 4)
    # Sin pedirlos, la identidad no cambia
    assert "slippage" not in rule() and "funding" not in rule()
    effect = rt._cost_effect(rule(), [plain])
    assert effect["slip"]["0.02"] == round(plain["r"] - 2 * plain["slip"], 4) and effect["withFunding"] == round(plain["r"] + plain["funding"], 4)
