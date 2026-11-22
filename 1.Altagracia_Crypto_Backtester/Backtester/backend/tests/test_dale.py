"""Zonas de Trader Dale con el primer regreso (21/11). Uso: python -m pytest tests/test_dale.py"""
import math

import numpy as np
import pytest

import dale
import rule_tester as rt

M30 = 1800000
T0 = 1704067200000  # 2024-01-01
CFG = dale.clean({})


def wave(n=1000, amp=1.0, period=48, vol=100.0):
    """Una onda por día en velas de 30 minutos: un rango diario de unos 2 * amp."""
    bars, prev = [], 100.0
    for i in range(n):
        c = round(100.0 + amp * math.sin(2 * math.pi * i / period), 6)
        bars.append({"t": T0 + i * M30, "o": prev, "c": c, "h": round(max(prev, c) + 0.05, 6), "l": round(min(prev, c) - 0.05, 6),
                     "vol": vol, "delta": 0.0})
        prev = c
    return bars


def add(bars, h, l, c, vol=100.0):
    o = bars[-1]["c"]
    bars.append({"t": bars[-1]["t"] + M30, "o": o, "h": max(h, o, c), "l": min(l, o, c), "c": c, "vol": vol, "delta": 0.0})


def arrays(bars):
    return (np.array([b["t"] for b in bars], dtype=np.int64), *(np.array([b[k] for b in bars], dtype=float) for k in ("o", "h", "l", "c", "vol")))


def st_event(bars, lo, hi, k=None):
    k = len(bars) - 1 if k is None else k
    return {"code": "ST", "dir": 1, "t": bars[k]["t"], "known": bars[k]["t"] + M30, "lo": lo, "hi": hi}


# ---------------------------------------------------------------- Piezas

def test_el_atr_diario_es_el_de_los_dias_ya_cerrados():
    t, o, h, l, c, v = arrays(wave(20 * 48))
    da = dale.day_atr(t, h, l, c)
    assert np.isnan(da[:14 * 48]).all()                      # Hacen falta 14 días cerrados
    assert da[14 * 48] == pytest.approx(2.1, abs=0.15)        # Rango diario de la onda
    assert np.all(da[14 * 48:15 * 48] == da[14 * 48])         # El mismo todo el día: el del día anterior


def test_el_perfil_reparte_el_volumen_de_cada_vela_en_su_rango():
    h, l, v = np.array([2.0, 4.0]), np.array([0.0, 2.0]), np.array([10.0, 30.0])
    edges, vol = dale.profile(h, l, v, 0, 1, 4)
    assert edges[0] == 0 and edges[-1] == 4 and vol.sum() == pytest.approx(40)
    assert vol.tolist() == pytest.approx([5, 5, 15, 15])


def test_la_zona_se_arma_con_dos_velas_completas_seguidas_y_el_lado_da_la_direccion():
    h = np.array([10.5, 12.0, 11.8, 12.0, 12.5, 12.6])
    l = np.array([10.0, 11.5, 10.5, 11.2, 11.3, 11.4])  # La 2 toca la zona: la cuenta vuelve a empezar
    assert dale._arm(h, l, 10.0, 11.0, 0, CFG, None) == (4, 1)
    assert dale._arm(h, l, 10.0, 11.0, 0, {**CFG, "armBars": 3}, None) is None  # No se armó a tiempo
    down = dale._arm(np.array([10.5, 9.8, 9.5]), np.array([10.0, 9.0, 8.8]), 10.0, 11.0, 0, CFG, None)
    assert down == (2, -1)
    # La acumulación pide además llegar a `run` del borde de la caja del lado de la ruptura
    extra = {"edge": 11.0, "side": 1, "run": 3.0}
    assert dale._arm(h, l, 10.0, 11.0, 0, CFG, extra) is None
    far = np.r_[h, 14.5]
    assert dale._arm(far, np.r_[l, 13.0], 10.0, 11.0, 0, CFG, extra) == (6, 1)


# ---------------------------------------------------------------- El stop de Dale y las zonas del almacén

def armed_bars(lo, hi):
    bars = wave(20 * 48)
    zone = st_event(bars, lo, hi)
    add(bars, hi + 0.6, hi + 0.3, hi + 0.5)  # Sube desde el valle de la onda: esta vela toca la zona
    add(bars, hi + 0.8, hi + 0.4, hi + 0.6)  # Dos velas completas arriba: se arma
    add(bars, hi + 0.9, hi + 0.5, hi + 0.7)
    return bars, zone


def test_el_stop_va_entre_el_10_y_el_20_por_ciento_del_atr_diario():
    bars, zone = armed_bars(100.0, 100.2)
    t, o, h, l, c, v = arrays(bars)
    day = dale.day_atr(t, h, l, c)[-1]
    e = dale.candidates(bars, 30, CFG, ("DS",), [zone])[0]
    assert e["dir"] == 1 and e["t"] == bars[-1]["t"] and e["known"] == bars[-1]["t"] + M30
    assert e["hi"] == pytest.approx(100.2)                             # La limit va en el borde cercano
    assert 0.1 <= (e["hi"] - e["lo"]) / day <= 0.2 and e["info"]["from"] == "ST"
    tall, zone = armed_bars(99.0, 100.2)                               # El borde lejano pasa del 20%: no se opera
    assert dale.candidates(tall, 30, CFG, ("DS",), [zone]) == []
    thin, zone = armed_bars(100.18, 100.2)                             # Más cerca que el 10%: el stop se aleja hasta ahí
    e = dale.candidates(thin, 30, CFG, ("DS",), [zone])[0]
    assert (e["hi"] - e["lo"]) / day == pytest.approx(0.1, abs=1e-6)


def test_el_nodo_y_la_orden_grande_salen_de_sus_elementos_y_lo_demas_no_cuenta():
    bars, zone = armed_bars(100.0, 100.2)
    other = {**zone, "code": "AP"}
    assert [e["code"] for e in dale.candidates(bars, 30, CFG, ("DN",), [zone, other])] == ["DN"]
    assert dale.candidates(bars, 30, CFG, ("DG",), [zone, other]) == []  # No hay GR


# ---------------------------------------------------------------- Acumulación y cluster del tramo

def box_base(n=760):
    """Rango de 30 minutos: una onda de 10 velas (la caja se detecta y sigue)."""
    bars, prev = [], 100.0
    for i in range(n):
        c = round(100.0 + 2.0 * math.sin(2 * math.pi * i / 10), 6)
        bars.append({"t": T0 + i * M30, "o": prev, "c": c, "h": round(max(prev, c) + 0.1, 6), "l": round(min(prev, c) - 0.1, 6),
                     "vol": 100.0, "delta": 0.0})
        prev = c
    return bars


def test_la_acumulacion_toma_el_poc_de_la_caja_que_rompe():
    bars = box_base()
    top = max(b["h"] for b in bars[-20:])
    add(bars, top + 1.0, top - 0.5, top + 0.9)  # Cierra fuera: la caja termina
    t, o, h, l, c, v = arrays(bars)
    import regime
    zones = dale._accumulation(t, o, h, l, c, v, regime.atr(h, l, c), CFG)
    i, lo, hi, info, extra = zones[-1]
    assert i == len(bars) - 1 and extra["side"] == 1
    assert info["box"][0] <= lo < hi <= info["box"][1]  # El POC queda dentro de la caja


def test_el_cluster_del_tramo_es_el_nodo_de_volumen_del_tramo():
    bars = wave(20 * 48, amp=0.2, period=10)
    for c in np.linspace(100.2, 103.0, 6):      # Sube rápido
        add(bars, c + 0.1, c - 0.3, float(c))
    for k in range(14):                          # Se detiene en 103 con volumen: el cluster
        add(bars, 103.2, 102.8, 103.0 + 0.05 * (k % 2), vol=400.0)
    for c in np.linspace(103.3, 107.0, 10):     # Y sigue
        add(bars, c + 0.1, c - 0.3, float(c))
    t, o, h, l, c, v = arrays(bars)
    import regime
    found = dale._leg_cluster(t, h, l, c, v, regime.atr(h, l, c), CFG)
    pause = [(i, lo, hi, info) for i, lo, hi, info, _ in found if lo <= 103.0 <= hi]
    assert pause  # La pausa con volumen en 103 es un cluster del tramo
    i, lo, hi, info = pause[0]
    assert info["leg"][1] == 1 and info["legAtr"] >= 5 and bars[i]["c"] > hi  # Se conoce con el precio ya arriba de ella


# ---------------------------------------------------------------- Control, sin futuro y probador

def test_el_control_mueve_cada_zona_de_1_a_3_atr_siempre_igual():
    bars, zone = armed_bars(100.0, 100.2)
    for _ in range(6):  # Más velas para que la zona desplazada pueda armarse de algún lado
        add(bars, 101.5, 100.9, 101.2)
    a = dale.candidates(bars, 30, CFG, ("DS",), [zone], control=True)
    b = dale.candidates(bars, 30, CFG, ("DS",), [zone], control=True)
    assert a == b
    for e in a:
        assert 1.0 <= abs(e["info"]["shiftAtr"]) <= 3.0


def test_lo_que_se_sabe_no_cambia_con_velas_posteriores():
    bars = wave(20 * 48, amp=0.2, period=10)
    for c in np.linspace(100.2, 103.0, 6):
        add(bars, c + 0.1, c - 0.3, float(c))
    for k in range(14):
        add(bars, 103.2, 102.8, 103.0 + 0.05 * (k % 2), vol=400.0)
    for c in np.linspace(103.3, 107.0, 10):
        add(bars, c + 0.1, c - 0.3, float(c))
    cut = len(bars)
    for c in np.linspace(106.5, 102.0, 12):
        add(bars, c + 0.2, c - 0.2, float(c))
    key = lambda e: (e["code"], e["t"], e["dir"], round(e["lo"], 8), round(e["hi"], 8))
    for code in ("DA", "DC"):
        full = [key(e) for e in dale.candidates(bars, 30, CFG, (code,)) if e["known"] <= bars[cut - 1]["t"] + M30]
        now = [key(e) for e in dale.candidates(bars[:cut], 30, CFG, (code,))]
        assert sorted(full) == sorted(now), code


def test_una_regla_sin_dale_no_cambia_y_la_corrida_suma_las_zonas_desplazadas():
    bx = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["BX"]}]}, "bx": {"maxHeight": 5.5}})
    assert "dale" not in bx
    ds = rt.clean_rule({"tf": 30, "recipe": {"slots": [{"codes": ["DS"]}]}, "dale": {"away": 99}})
    assert ds["dale"]["away"] == 20 and ds["dale"]["maxDay"] == 0.2
    assert {"DA", "DC"} <= set(rt.CANDLE_CODES) and not {"DS", "DN", "DG"} & set(rt.CANDLE_CODES)  # Esas tres piden el almacén
    bars, zone = armed_bars(100.0, 100.2)
    for c in (100.6, 100.4, 100.25, 100.1, 100.3, 100.6, 100.9, 101.2, 101.4):  # Vuelve a la zona y sigue
        add(bars, c + 0.1, c - 0.2, c)
    rule = rt.clean_rule({"name": "DS", "tf": 30, "recipe": {"slots": [{"codes": ["DS"]}]},
                          "entry": {"type": "limit", "at": "near", "expiry": 200}, "stop": {"type": "zone", "buffer": 0, "maxAtr": 20},
                          "exit": {"targetR": 2}, "oneAtATime": True, "cooldown": 0, "volFilter": 0})
    phase = {"phase": 1, "from": "2024-01-01", "to": "2024-01-25"}
    res = rt.run("TEST", rule, {"bars": bars, "events": [zone]}, phase, None, base=True)
    assert res["success"] and res["controlKind"] == "dale" and "control" in res
    assert res["trades"] and res["trades"][0]["order"] == "limit" and res["trades"][0]["dale"]["code"] == "DS"
    assert res["trades"][0]["entry"] == pytest.approx(100.2)


# ---------------------------------------------------------------- DX, la hipótesis del 22/11

def dx_case():
    bars = wave(30 * 48)
    zones = [st_event(bars, bars[k]["c"] - 0.1, bars[k]["c"] + 0.1, k) for k in range(700, 1300, 10)]
    return bars, zones


def test_dx_es_el_control_de_ds_con_su_semilla_y_su_control_ancla_en_velas_al_azar():
    bars, zones = dx_case()
    key = lambda e: (e["t"], e["dir"], round(e["lo"], 8), round(e["hi"], 8))
    dx = dale.candidates(bars, 30, CFG, ("DX",), zones)
    assert dx and [key(e) for e in dx] == [key(e) for e in dale.candidates(bars, 30, CFG, ("DS",), zones, control=True)]
    assert all(e["code"] == "DX" and 1 <= abs(e["info"]["shiftAtr"]) <= 3 for e in dx)
    anchored = dale.candidates(bars, 30, CFG, ("DX",), zones, control=True)
    assert anchored and anchored == dale.candidates(bars, 30, CFG, ("DX",), zones, control=True)  # Siempre igual
    assert all(e["info"]["anchor"] and 1 <= abs(e["info"]["shiftAtr"]) <= 3 for e in anchored)
    assert {e["info"]["born"] for e in anchored} != {e["info"]["born"] for e in dx}  # Nacen en otras velas


def test_la_corrida_de_dx_suma_las_anclas_al_azar():
    bars, zones = dx_case()
    rule = rt.clean_rule({"name": "DX", "tf": 30, "recipe": {"slots": [{"codes": ["DX"]}]},
                          "entry": {"type": "limit", "at": "near", "expiry": 200}, "stop": {"type": "zone", "buffer": 0, "maxAtr": 20},
                          "exit": {"targetR": 2}, "oneAtATime": True, "cooldown": 0, "volFilter": 0})
    assert "DX" in rule["recipe"]["slots"][0]["codes"] and rule["dale"]["shiftMax"] == 3.0
    assert "DX" not in rt.CANDLE_CODES  # Sale del almacén, como DS
    res = rt.run("TEST", rule, {"bars": bars, "events": zones}, {"phase": 1, "from": "2024-01-01", "to": "2024-01-30"}, None, base=True)
    assert res["success"] and res["controlKind"] == "daleAnchor" and res["control"]["n"]
    assert res["trades"] and res["trades"][0]["dale"]["code"] == "DX"


def test_run_desde_una_hora_y_con_las_posiciones_abiertas_para_el_registro_en_vivo():
    """El registro en vivo de DX de la suite (22/11): run con since (no toma las señales anteriores y da las posiciones
    abiertas) y con otro lector de minutos. Sin ellos, nada cambia."""
    bars, zones = dx_case()
    rule = rt.clean_rule({"name": "DX", "tf": 30, "recipe": {"slots": [{"codes": ["DX"]}]},
                          "entry": {"type": "limit", "at": "near", "expiry": 200}, "stop": {"type": "zone", "buffer": 0, "maxAtr": 20},
                          "exit": {"targetR": 2}, "oneAtATime": True, "cooldown": 0, "volFilter": 0})
    phase = {"phase": 1, "from": "2024-01-01", "to": "2024-01-30"}
    span = {"bars": bars, "events": zones}
    full = rt.run("TEST", rule, span, phase, None, base=False)
    assert len(full["trades"]) > 4 and "openTrades" not in full
    same = rt.run("TEST", rule, span, phase, None, base=False, since=0)
    assert [(t["known"], t["entry_t"], t["r"]) for t in same["trades"]] == [(t["known"], t["entry_t"], t["r"]) for t in full["trades"]]
    cut = full["trades"][len(full["trades"]) // 2]["known"]
    late = rt.run("TEST", rule, span, phase, None, base=False, since=cut)
    assert late["trades"] and all(t["known"] >= cut for t in late["trades"]) and late["signals"] < full["signals"]
    # Con las velas hasta antes de la salida de un trade, queda abierto: openTrades lo trae, sin salida
    last = next(t for t in reversed(full["trades"]) if t["exit_t"] // M30 * M30 > t["entry_t"])
    end = last["exit_t"] // M30 * M30
    upto = {"bars": [b for b in bars if b["t"] < end], "events": [e for e in zones if e["known"] <= end]}
    reader = lambda symbol, a, b: None
    trace = {}
    cut_run = rt.run("TEST", rule, upto, phase, None, base=False, trace=trace, since=0, minutes=reader)
    assert trace["ctx"]["minutes"] is reader
    assert cut_run["open"] == 1 and len(cut_run["openTrades"]) == 1
    o = cut_run["openTrades"][0]
    assert o["open"] and o["entry_t"] == last["entry_t"] and o["stop"] == last["stop"] and o["target"] == last["target"]
    assert "exit" not in o and "k" not in o and "entry_i" not in o
