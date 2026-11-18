"""Barridos de liquidaciones del probador de reglas. Uso: python -m pytest tests/test_liq_sweeps.py"""
import numpy as np
import pytest

import liq_sweeps as ls
import rule_tester as rt

TF = 15
MS = TF * 60000
DAY = ls.DAY_MS
T0 = 40 * DAY  # Las velas empiezan con 40 días de liquidaciones detrás
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}


def flat(n=400, price=100.0):
    return [{"t": T0 + k * MS, "o": price, "h": price + 0.5, "l": price - 0.5, "c": price, "delta": 0.0, "vol": 10.0} for k in range(n)]


def with_low(bars, j, low=98.0):
    """Un mínimo único en la vela j: swing de 5 velas por lado, conocido al cerrar j + 5."""
    bars[j]["l"] = low
    return bars


def source(cells, first=0, last=400 * DAY):
    """Una fuente con celdas (known, precio, usd de largos)."""
    cells = sorted(cells)
    data = {"known": np.array([c[0] for c in cells], np.int64), "start": np.array([c[0] - DAY for c in cells], np.int64),
            "end": np.array([c[0] for c in cells], np.int64), "low": np.array([c[1] for c in cells], float),
            "high": np.array([c[1] for c in cells], float), "long": np.array([c[2] for c in cells], float),
            "short": np.zeros(len(cells))}
    return [(data, {"id": "prueba", "ranges": [[first, last]], "first": first, "cell_width": 0.0})]


def test_un_swing_se_barre_una_vez_y_se_conoce_con_sus_velas_de_la_derecha():
    bars = with_low(flat(), 20)
    bars[23]["l"] = 97.0   # Dentro de las 5 velas de la derecha: el swing de la 20 no llega a confirmarse
    bars[40]["l"] = 96.5   # Pasa el swing de la 23
    bars[50]["l"] = 96.0   # El de la 23 ya se barrió: este pasa el de la 40
    found = [(s["j"], s["i"]) for s in ls.sweeps(bars, 5, 3) if s["dir"] > 0]
    assert found == [(23, 40), (40, 50)]


def test_recuperar_pide_un_cierre_de_vuelta():
    bars = with_low(flat(), 20)
    bars[40].update(l=97.0, c=97.5)                       # Pasa el swing y cierra debajo
    bars[41].update(o=97.5, l=96.8, h=98.6, c=98.4)       # Cierra de vuelta encima de 98
    sweep = [s for s in ls.sweeps(bars, 5, 3) if s["dir"] > 0][0]
    assert sweep["i"] == 40 and sweep["r"] == 41 and sweep["extreme"] == 96.8
    bars[41].update(c=97.6)
    bars[42].update(o=97.6, l=97.0, h=97.9, c=97.7)
    bars[43].update(o=97.7, l=97.0, h=97.9, c=97.7)
    bars[44].update(o=97.7, l=97.0, h=97.9, c=97.7)
    assert [s for s in ls.sweeps(bars, 5, 3) if s["dir"] > 0][0]["r"] is None


def test_liq_si_el_swing_cae_en_una_zona_y_swp_si_no():
    bars = with_low(flat(), 20)
    bars[40]["l"] = 97.0
    inside = ls.events("X", bars, TF, 5, "pierce", 3, sources=source([(T0 - DAY, 98.0, 5e6), (T0 - 2 * DAY, 120.0, 1e5)]))
    liq = [e for e in inside if e["code"] == "LIQ"]
    assert len(liq) == 1 and liq[0]["dir"] == 1 and liq[0]["t"] == bars[40]["t"] and liq[0]["known"] == bars[41]["t"]
    assert (liq[0]["lo"], liq[0]["hi"]) == (97.0, 98.0) and liq[0]["info"]["usd"] == 5e6 and liq[0]["info"]["swingAgeBars"] == 20
    away = ls.events("X", bars, TF, 5, "pierce", 3, sources=source([(T0 - DAY, 103.0, 5e6)]))
    assert [e["code"] for e in away if e["code"] != "VH"] == ["SWP"]


def test_no_usa_liquidaciones_que_se_conocen_despues_del_barrido():
    bars = with_low(flat(), 20)
    bars[40]["l"] = 97.0
    late = ls.events("X", bars, TF, 5, "pierce", 3, sources=source([(bars[40]["t"] + 1, 98.0, 5e6), (T0 - DAY, 103.0, 1e5)]))
    assert [e["code"] for e in late if e["code"] != "VH"] == ["SWP"]


def test_sin_datos_en_la_fecha_no_sale_ni_el_control():
    bars = with_low(flat(), 20)
    bars[40]["l"] = 97.0
    empty = ls.events("X", bars, TF, 5, "pierce", 3, sources=source([(T0 + 300 * DAY, 98.0, 5e6)], first=T0 + 299 * DAY))
    assert [e for e in empty if e["code"] != "VH"] == []


def test_la_variante_recuperar_se_conoce_en_la_vela_que_cierra_de_vuelta():
    bars = with_low(flat(), 20)
    bars[40].update(l=97.0, c=97.5)
    bars[41].update(o=97.5, l=96.8, h=98.6, c=98.4)
    liq = [e for e in ls.events("X", bars, TF, 5, "reclaim", 3, sources=source([(T0 - DAY, 98.0, 5e6)])) if e["code"] == "LIQ"][0]
    assert liq["known"] == bars[42]["t"] and liq["lo"] == 96.8


def test_volumen_alto_contra_su_misma_hora():
    bars = flat(96 * 12)  # 12 días
    bars[96 * 11 + 5].update(vol=25.0, c=100.4)
    bars[96 * 11 + 9].update(vol=25.0)  # Sin color no tiene lado
    found = [e for e in ls._volume_events(bars, MS)]
    assert [(e["t"], e["dir"]) for e in found] == [(bars[96 * 11 + 5]["t"], 1)]


def test_la_regla_en_secuencia_entra_con_el_gatillo_tras_el_barrido(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    monkeypatch.setattr(ls.liq_store, "_sources", lambda symbol: source([(T0 - DAY, 98.0, 5e6)]))
    bars = with_low(flat(), 20)
    bars[40]["l"] = 97.0
    ev = lambda bar: {"code": "EX", "dir": 1, "t": bars[bar]["t"], "known": bars[bar + 1]["t"], "lo": 99.0, "hi": 99.5}
    raw = {"name": "L", "tf": TF, "liq": {"variant": "pierce"}, "stop": {"type": "candle"}, "exit": {"targetR": None, "horizon": 5}, "cooldown": 0,
           "recipe": {"slots": [{"codes": ["LIQ"], "group": 0}, {"codes": ["EX"], "group": 1}], "mode": "sequence", "sameBar": True, "window": 10}}
    rule = rt.clean_rule(raw)
    assert rule["recipe"]["window"] == 10 and rule["liq"]["variant"] == "pierce"
    # El gatillo de la vela 30 llega antes del barrido y no cuenta; el de la 44 sí, y el de la 60 queda fuera de la ventana
    result = rt.run("X", rule, {"bars": bars, "events": [ev(30), ev(44), ev(60)]}, PHASE, None, base=False)
    assert [t["signal"] for t in result["trades"]] == [bars[44]["t"]]
    trade = result["trades"][0]
    assert trade["liq"]["swing"] == 98.0 and trade["stop"] < 97.0 and trade["votes"] == ["EX", "LIQ"]
    same = rt.run("X", rule, {"bars": bars, "events": [ev(40)]}, PHASE, None, base=False)
    assert [t["signal"] for t in same["trades"]] == [bars[40]["t"]]
    assert "liq" not in rt.clean_rule({**raw, "recipe": {"slots": [{"codes": ["EX"]}]}})


def test_la_zona_se_barre_de_lado_a_lado_y_solo_si_existia_con_el_precio_fuera():
    bars = flat()  # El precio entre 99.5 y 100.5: entero encima de una zona en 98
    bars[40]["l"] = 97.5          # Pasa el borde de abajo de la zona (97.9 a 98.0)
    bars[41]["l"] = 97.4          # La misma zona no se barre dos veces sin que el precio salga
    found = [e for e in ls.events("X", bars, TF, 5, "pierce", 3, sources=source([(T0 - DAY, 97.95, 5e6)]), what="zone") if e["code"] == "LIQ"]
    assert [(e["t"], e["dir"]) for e in found] == [(bars[40]["t"], 1)]
    info = found[0]["info"]
    assert info["what"] == "zone" and info["zoneLow"] < 97.95 < info["zoneHigh"] and found[0]["lo"] == 97.5 and found[0]["hi"] == info["zoneLow"]
    # Una zona que se conoce cuando el precio ya está dentro no queda armada
    late = [dict(b) for b in flat()]
    late[39].update(l=97.95)
    late[40]["l"] = 97.5
    born = late[39]["t"]
    none = [e for e in ls.events("X", late, TF, 5, "pierce", 3, sources=source([(born, 97.95, 5e6), (T0 - DAY, 150.0, 1e3)]), what="zone") if e["code"] == "LIQ"]
    assert none == []


def test_subir_a_traves_de_una_zona_es_bajista_y_recuperar_espera_el_cierre():
    bars = flat()
    bars[40].update(h=102.5, c=102.3)           # Pasa la zona de 102 y cierra encima
    bars[41].update(o=102.3, h=102.6, l=101.0, c=101.5)  # Cierra de vuelta debajo
    src = source([(T0 - DAY, 102.05, 5e6)])
    liq = [e for e in ls.events("X", bars, TF, 5, "reclaim", 3, sources=src, what="zone") if e["code"] == "LIQ"][0]
    assert liq["dir"] == -1 and liq["t"] == bars[40]["t"] and liq["known"] == bars[42]["t"] and liq["hi"] == 102.6
