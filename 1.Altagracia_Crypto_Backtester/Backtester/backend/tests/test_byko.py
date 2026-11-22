"""Elementos de Byko (21/11): falso rompimiento, ruptura tras acumulación, trampa y purga. Uso: python -m pytest tests/test_byko.py"""
import math

import numpy as np
import pytest

import byko
import oi_history
import regime
import regime_detectors as rd
import rule_tester as rt

H = 3600000
T0 = 1704067200000  # 2024-01-01


def base(n=760):
    """Rango de 1 hora: una onda de 10 velas (eficiencia casi 0, la caja se detecta y sigue), volumen 100."""
    bars, prev = [], 100.0
    for i in range(n):
        c = round(100.0 + 2.0 * math.sin(2 * math.pi * i / 10), 6)
        bars.append({"t": T0 + i * H, "o": prev, "c": c, "h": round(max(prev, c) + 0.1, 6), "l": round(min(prev, c) - 0.1, 6),
                     "vol": 100.0, "delta": 0.0})
        prev = c
    return bars


def add(bars, h, l, c, vol=100.0, o=None):
    o = bars[-1]["c"] if o is None else o
    bars.append({"t": bars[-1]["t"] + H, "o": o, "h": max(h, o, c), "l": min(l, o, c), "c": c, "vol": vol, "delta": 0.0})


def box_of(bars):
    """La caja vigente al final de las velas, como la ve el detector, y el ATR de la última vela."""
    a = {k: np.array([b[s] for b in bars], dtype=float) for k, s in (("o", "o"), ("h", "h"), ("l", "l"), ("c", "c"), ("v", "vol"))}
    a["t"] = np.array([b["t"] for b in bars], dtype=np.int64)
    zones = rd.er_box(a, **rd.PARAMS["er_box"]["params"])["zones"]
    z = zones[-1]
    assert z["end"] == len(bars) - 1, "la caja tiene que seguir viva"
    return z["high"], z["low"], float(regime.atr(a["h"], a["l"], a["c"])[-1])


CFG = {key: byko.clean(key, {}) for key in ("fb", "ba", "ta", "po")}


def cands(bars, code, symbol="TEST"):
    return [e for e in byko.candidates(symbol, bars, 60, CFG, (code,)) if e["code"] == code]


def at(found, t):
    return [e for e in found if e["t"] == t]


# ---------------------------------------------------------------- Falso rompimiento

def fb_bars(vol):
    bars = base()
    top, bot, atr = box_of(bars)
    add(bars, 99.6, 99.4, 99.5)        # Abajo, a más de 2 ATR del techo
    add(bars, 100.7, 99.5, 100.6)
    add(bars, 101.7, 100.5, 101.6)     # Sube rápido, todavía dentro
    add(bars, top + 0.8, 101.4, 101.8, vol=vol)  # Pasa el techo y cierra dentro: el falso rompimiento
    return bars, top


def test_el_falso_rompimiento_con_llegada_impulsiva_y_volumen_cumple_la_firma():
    bars, top = fb_bars(vol=600)
    hit = at(cands(bars, "FB"), bars[-1]["t"])
    assert len(hit) == 1
    e = hit[0]
    assert e["dir"] == -1 and e["known"] == bars[-1]["t"] + H and e["info"]["sig"]
    assert e["lo"] == pytest.approx(top) and e["hi"] == pytest.approx(top + 0.8)  # Del techo a la mecha: el stop va sobre ella
    assert e["info"]["approachAtr"] >= 2 and e["info"]["volx"] >= 3
    # Sin volumen es el mismo candidato, pero sin la firma: va al control
    quiet, _ = fb_bars(vol=100)
    hit = at(cands(quiet, "FB"), quiet[-1]["t"])
    assert len(hit) == 1 and not hit[0]["info"]["sig"]
    assert not at(byko.events("TEST", quiet, 60, CFG, ("FB",)), quiet[-1]["t"])
    assert at(byko.events("TEST", quiet, 60, CFG, ("FB",), control=True), quiet[-1]["t"])


def test_el_falso_rompimiento_que_vuelve_dos_velas_despues_se_sabe_al_volver():
    bars = base()
    top, bot, atr = box_of(bars)
    add(bars, 99.6, 99.4, 99.5)
    add(bars, 101.0, 99.5, 100.9)
    add(bars, top + 0.4, 100.8, top + 0.2, vol=600)  # Cierra apenas fuera: la caja sigue
    add(bars, top + 0.6, top - 0.1, top + 0.3)
    add(bars, top + 0.35, 101.0, 101.2)              # Vuelve adentro: aquí se sabe
    found = cands(bars, "FB")
    e = at(found, bars[-1]["t"])[0]
    assert e["dir"] == -1 and e["info"]["pierced"] == bars[-3]["t"] and e["hi"] == pytest.approx(top + 0.6)
    assert not at(found, bars[-3]["t"]) and not at(found, bars[-2]["t"])


# ---------------------------------------------------------------- Ruptura tras acumulación

def ba_bars(hug):
    bars = base()
    top, bot, atr = box_of(bars)
    if hug:
        for i in range(6):  # Seis velas pegadas al techo, con mínimos crecientes
            c = top - 0.6 + 0.08 * i
            add(bars, c + 0.1, c - 0.3, c)
    add(bars, top + 1.6, top - 0.3, top + 1.5)  # Cierra fuera y termina la caja
    return bars, top


def test_la_ruptura_tras_acumulacion_pide_velas_pegadas_al_borde_con_minimos_crecientes():
    bars, top = ba_bars(hug=True)
    e = at(cands(bars, "BA"), bars[-1]["t"])[0]
    assert e["dir"] == 1 and e["info"]["sig"] and e["info"]["rising"]
    assert e["hi"] == pytest.approx(top) and e["lo"] == pytest.approx(min(b["l"] for b in bars[-7:-1]))  # El stop, bajo el último retroceso
    loose, _ = ba_bars(hug=False)
    e = at(cands(loose, "BA"), loose[-1]["t"])[0]
    assert e["dir"] == 1 and not e["info"]["sig"]  # Ruptura desde el centro de la caja: sin la firma


# ---------------------------------------------------------------- Trampa y purga (con el OI)

def oi_for(bars, jump_at=None, change=0.0, span=3, seed=3):
    rng = np.random.default_rng(seed)
    steps = rng.normal(0, 0.001, len(bars))
    if jump_at is not None:
        steps[jump_at - span + 1:jump_at + 1] += change / span
    return 1000.0 * np.exp(np.cumsum(steps))


def ta_bars():
    bars = base()
    top, bot, atr = box_of(bars)
    for _ in range(20):  # Baja hasta cerca del piso (al pasar por el centro, la llegada se rearma)
        if bars[-1]["c"] <= bot + 0.9:
            break
        c = max(bars[-1]["c"] - 0.6, bot + 0.3)
        add(bars, bars[-1]["c"] + 0.1, c - 0.1, c)
    add(bars, bars[-1]["c"] + 0.1, bot + 0.1, bot + 0.3)  # El mínimo, cerca del piso
    for c in (99.0, 99.8, 100.4, 100.8, 101.0):     # Sube hasta casi el quinto de arriba
        add(bars, min(c + 0.1, top - 0.95), c - 0.3, c)
    for c in (101.05, 101.0, 101.1):                  # Se queda ahí
        add(bars, min(c + 0.1, top - 0.95), c - 0.2, c)
    add(bars, top - 0.5, 100.9, 101.2)                # Llega al quinto de arriba sin avanzar
    return bars, top


def test_la_trampa_pide_el_salto_del_oi_sin_avance(monkeypatch):
    bars, top = ta_bars()
    k = len(bars) - 1
    monkeypatch.setattr(oi_history, "at_close", lambda symbol, b, tf, source="bybit", field="oi": oi_for(b, k, 0.03))
    e = at(cands(bars, "TA"), bars[k]["t"])[0]
    assert e["dir"] == -1 and e["info"]["sig"] and e["info"]["oiZ"] >= 2 and e["info"]["advanceAtr"] <= 0.5
    assert e["lo"] == pytest.approx(bars[k]["c"]) and e["hi"] == pytest.approx(max(b["h"] for b in bars[-3:]))
    monkeypatch.setattr(oi_history, "at_close", lambda symbol, b, tf, source="bybit", field="oi": oi_for(b))
    e = at(cands(bars, "TA"), bars[k]["t"])[0]
    assert not e["info"]["sig"]  # La misma llegada sin el salto del OI
    monkeypatch.setattr(oi_history, "at_close", lambda symbol, b, tf, source="bybit", field="oi": np.full(len(b), np.nan))
    assert not cands(bars, "TA")  # Sin OI no cuenta en ningún grupo


def po_bars():
    bars = base()
    while abs(bars[-1]["c"] - 100.0) > 0.3:
        add(bars, bars[-1]["c"] + 0.2, bars[-1]["c"] - 0.2, 100.0 + (bars[-1]["c"] - 100.0) * 0.3)
    for step in (-0.3, -0.3, -0.4, -1.0, -1.2):  # Acelera hacia abajo
        c = bars[-1]["c"] + step
        add(bars, bars[-1]["c"] + 0.05, c - 0.1, c)
    c = bars[-1]["c"] - 1.5
    add(bars, bars[-1]["c"] + 0.05, c - 0.3, c, vol=500)
    return bars


def test_la_purga_pide_la_caida_del_oi_al_final_de_un_movimiento_acelerado(monkeypatch):
    bars = po_bars()
    k = len(bars) - 1
    monkeypatch.setattr(oi_history, "at_close", lambda symbol, b, tf, source="bybit", field="oi": oi_for(b, k, -0.04, span=2))
    e = at(cands(bars, "PO"), bars[k]["t"])[0]
    assert e["dir"] == 1 and e["info"]["sig"] and e["info"]["oiZ"] <= -2 and e["info"]["moveAtr"] >= 3
    assert e["hi"] == pytest.approx(bars[k]["c"]) and e["lo"] == pytest.approx(min(b["l"] for b in bars[-6:]))
    monkeypatch.setattr(oi_history, "at_close", lambda symbol, b, tf, source="bybit", field="oi": oi_for(b))
    e = at(cands(bars, "PO"), bars[k]["t"])[0]
    assert not e["info"]["sig"]  # El mismo clímax sin la purga del OI: va al control


# ---------------------------------------------------------------- Sin futuro y en el probador

def test_lo_que_se_sabe_no_cambia_con_velas_posteriores(monkeypatch):
    monkeypatch.setattr(oi_history, "at_close", lambda symbol, b, tf, source="bybit", field="oi": oi_for(b, len(b) - 1, 0.0))
    bars, _ = fb_bars(vol=600)
    full = list(bars)
    for c in (101.0, 100.0, 99.0, 98.6, 99.5, 100.4):
        add(full, c + 0.3, c - 0.3, c)
    for code in ("FB", "BA", "TA"):
        cut = [e for e in byko.candidates("TEST", full, 60, CFG, (code,)) if e["known"] <= bars[-1]["t"] + H]
        now = byko.candidates("TEST", bars, 60, CFG, (code,))
        key = lambda e: (e["code"], e["t"], e["dir"], e["info"]["sig"], round(e["lo"], 8), round(e["hi"], 8))
        assert sorted(map(key, cut)) == sorted(map(key, now)), code


def test_una_regla_sin_byko_no_cambia_y_la_de_byko_trae_sus_cifras():
    bx = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["BX"]}]}, "bx": {"maxHeight": 5.5}})
    assert not any(key in bx for key in ("fb", "ba", "ta", "po"))
    fb = rt.clean_rule({"tf": 60, "recipe": {"slots": [{"codes": ["FB"]}]}, "fb": {"vol": 99, "back": "x"}})
    assert fb["fb"] == {"back": 3, "approachBars": 4, "approachAtr": 2.0, "vol": 50.0}
    ta = rt.clean_rule({"tf": 60, "recipe": {"slots": [{"codes": ["TA"]}]}, "ta": {"source": "otro"}})
    assert ta["ta"]["source"] == "sum" and ta["ta"]["z"] == 2.0
    assert not (rt.codes_for("AAPL", 60) or set()) & set(byko.OI_CODES)  # Las acciones no tienen OI


def test_la_corrida_suma_el_control_sin_la_firma():
    bars, _ = fb_bars(vol=600)
    for c in (101.0, 100.4, 99.6, 99.0, 98.6, 99.5, 100.4, 101.2):
        add(bars, c + 0.3, c - 0.3, c)
    rule = rt.clean_rule({"name": "FB", "tf": 60, "recipe": {"slots": [{"codes": ["FB"]}]}, "stop": {"type": "zone", "buffer": 0.1},
                          "exit": {"targetR": 3}, "oneAtATime": True, "cooldown": 0})
    phase = {"phase": 1, "from": "2024-01-01", "to": "2024-02-05"}
    res = rt.run("TEST", rule, {"bars": bars, "events": []}, phase, None, base=True)
    assert res["success"] and res["controlKind"] == "byko" and "control" in res
    signed = [t for t in res["trades"] if t.get("byko")]
    assert signed and all(t["byko"]["sig"] for t in signed) and all(t.get("box") for t in signed)


def test_el_control_de_todas_las_monedas_junta_los_trades_de_cada_una():
    rng = np.random.default_rng(5)
    parts = [rng.normal(0.1, 1.0, 40), rng.normal(-0.2, 1.5, 70), rng.normal(0.4, 0.8, 25)]
    summaries = [rt.summary([{"r": float(r), "exit_t": i, "dir": 1, "mfe": 0, "mae": 0, "bars": 1} for i, r in enumerate(p)]) for p in parts]
    pooled = rt._pool_summaries(summaries)
    every = np.concatenate(parts)
    assert pooled["n"] == len(every) and pooled["avgR"] == pytest.approx(every.mean(), abs=2e-3)
    assert pooled["seR"] == pytest.approx(every.std(ddof=1) / math.sqrt(len(every)), rel=0.03)
