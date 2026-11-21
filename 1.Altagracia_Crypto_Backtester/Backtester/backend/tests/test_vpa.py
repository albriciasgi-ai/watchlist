"""El lector VPA (vpa.py) en el probador: sin futuro, sus elementos y zonas, el filtro del medidor, los controles al azar,
las filas del trade elegido, la búsqueda y que una regla de antes conserve su identidad.
La paridad con vpa.js está en frontend/tests/vpa.parity.test.mjs.
Uso: python -m pytest tests/test_vpa.py"""
import random

import pytest

import rule_tester as rt
import vpa

MS = 240 * 60000
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2023-12-31"}


def rule_of(codes=("QB",), **raw):
    return rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": list(codes)}]}, **raw})


def walk(n, seed=5, start=100.0):
    """Velas al azar con rachas de tendencia, mechas largas y volumen que a veces se dispara o se seca."""
    rnd = random.Random(seed)
    bars, price, drift = [], start, 0.0
    for i in range(n):
        if i % 60 == 0:
            drift = (rnd.random() - 0.5) * 0.01
        o = price
        c = o * (1 + drift + (rnd.random() - 0.5) * 0.02)
        up_w = rnd.random() * 0.03 if rnd.random() < 0.15 else rnd.random() * 0.006
        dn_w = rnd.random() * 0.03 if rnd.random() < 0.15 else rnd.random() * 0.006
        vol = (100 + rnd.random() * 900) * (4 if rnd.random() < 0.1 else 0.3 if rnd.random() < 0.2 else 1)
        bars.append({"t": i * MS, "o": o, "h": max(o, c) * (1 + up_w), "l": min(o, c) * (1 - dn_w), "c": c, "vol": vol, "delta": 0.0})
        price = c
    return bars


def cols(bars):
    return ([b["t"] for b in bars], [b["o"] for b in bars], [b["h"] for b in bars], [b["l"] for b in bars],
            [b["c"] for b in bars], [b["vol"] for b in bars])


def test_nada_mira_el_futuro_y_lo_ya_calculado_no_cambia():
    bars = walk(1500, seed=3)
    whole = vpa.compute(*cols(bars), 240)
    part = vpa.compute(*cols(bars[:900]), 240)
    for key in ("rv", "rr", "absorb", "trap", "meter", "leg", "fade"):
        for i in range(900):
            a, b = whole[key][i], part[key][i]
            assert a == b or (a != a and b != b), f"{key}[{i}]"
    early = [e for e in vpa.detect(*cols(bars), 240) if e["index"] < 900]
    assert early == vpa.detect(*cols(bars[:900]), 240)
    # Los primeros días no hay volumen normal de su hora: ni lectura ni medidor que pase un filtro
    assert whole["rv"][0] != whole["rv"][0]
    assert not vpa.filter_ok({"mode": "notAgainst", "thr": 1}, whole, 0, 1)


def test_las_lecturas_de_una_vela_por_grados():
    # Treinta días de velas iguales y después una con mucho volumen y poco rango, y otra con mucho rango y poco volumen
    base = [{"t": i * MS, "o": 100.0, "h": 101.0, "l": 99.0, "c": 100.5, "vol": 1000.0} for i in range(6 * 30)]
    n = len(base)
    absorbed = {"t": n * MS, "o": 100.0, "h": 100.3, "l": 99.9, "c": 100.25, "vol": 3000.0}
    trap = {"t": (n + 1) * MS, "o": 100.0, "h": 103.5, "l": 99.9, "c": 103.3, "vol": 500.0}
    s = vpa.compute(*cols(base + [absorbed, trap]), 240)
    assert s["rv"][n] == pytest.approx(3.0) and s["absorb"][n] == 1.0, "esfuerzo sin resultado"
    assert s["trap"][n + 1] == pytest.approx(1.0) and s["absorb"][n + 1] == 0.0, "resultado sin esfuerzo"
    assert s["contrib"][n] < 0, "una verde estrecha con mucho volumen es debilidad"
    events = [e for e in vpa.detect(*cols(base + [absorbed, trap]), 240) if e["code"] == "QA"]
    assert events and events[-1]["dir"] == -1


def test_una_regla_de_antes_conserva_su_identidad_y_lo_nuevo_solo_entra_si_se_pide():
    plain = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "exit": {"targetR": 2}})
    assert "vpa" not in plain and "vpaf" not in plain
    junk = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "exit": {"targetR": 2}, "vpa": {"fire": 0.3}, "vpaf": {"mode": "x"}})
    assert rt.rule_hash("X", junk) == rt.rule_hash("X", plain)
    full = rule_of(("QB",), vpa={"fire": 0.7, "rangeBars": 30}, vpaf={"mode": "favor", "thr": 0.5})
    assert full["vpa"]["fire"] == 0.7 and full["vpa"]["rangeBars"] == 30
    assert full["vpaf"] == {"mode": "favor", "thr": 0.5}
    assert full == rt.clean_rule(full), "limpiarla otra vez la deja igual"
    only_filter = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "vpaf": {"mode": "notAgainst"}})
    assert only_filter["vpaf"] == {"mode": "notAgainst", "thr": 1.0} and "vpa" in only_filter
    assert set(vpa.CODES) <= set(rt.CANDLE_CODES), "son de velas: valen sin almacén, en acciones y en 1D"


def test_los_elementos_en_la_corrida_con_sus_zonas():
    bars = walk(3000, seed=9)
    for code in ("QB", "QA", "QT", "QE"):
        rule = rule_of((code,), stop={"type": "zone", "maxAtr": 20, "buffer": 0}, exit={"targetR": 2})
        result = rt.run("TEST", rule, {"bars": bars, "events": []}, PHASE)
        assert result["summary"]["n"] > 5, code
        for t in result["trades"][:20]:
            info = t["elements"][0]
            assert info["code"] == code and 0 <= info["grade"] <= 1
            # El stop "borde lejano de la zona" queda del otro lado de la entrada
            assert (t["entry"] - t["stop"]) * t["dir"] > 0


def test_el_filtro_del_medidor_y_los_controles_al_azar(monkeypatch):
    bars = walk(2500, seed=11)
    base = dict(stop={"type": "atr", "atr": 1.5, "maxAtr": 20}, exit={"targetR": 2})
    plain = rt.run("TEST", rule_of(("QB",), **base), {"bars": bars, "events": []}, PHASE)
    piece = {"mode": "favor", "thr": 0.5}
    result = rt.run("TEST", rule_of(("QB",), vpaf=piece, **base), {"bars": bars, "events": []}, PHASE)
    assert 0 < result["summary"]["n"] < plain["summary"]["n"], "el filtro quita trades"
    assert result["skipped"].get("filtro VPA", 0) > 0
    s = vpa.compute(*cols(bars), 240, result["rule"]["vpa"])
    index = {b["t"]: i for i, b in enumerate(bars)}
    assert all(vpa.filter_ok(result["rule"]["vpaf"], s, index[t["signal"]], t["dir"]) for t in result["trades"])
    ctx = rt._context("TEST", 240, bars)
    ctx["minutes"], ctx["bars"] = None, bars
    seen = []
    monkeypatch.setattr(rt, "simulate", lambda rule, c, k, side, **kw: seen.append((k, side)))
    rt._baseline(rule_of(("QB",), vpaf=piece, **base), ctx, [{"dir": 1, "stop_atr": 1.5}, {"dir": -1, "stop_atr": 1.5}], "TEST")
    assert len(seen) > 200 and all(vpa.filter_ok(piece, s, k, side) for k, side in seen), "el azar entra solo donde deja el filtro"


def test_el_trade_elegido_muestra_la_fila_del_medidor(tmp_path, monkeypatch):
    monkeypatch.setattr(rt.observer, "OBSERVER_DIR", tmp_path)
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    bars = walk(2500, seed=9)
    span = {"bars": bars, "events": []}
    monkeypatch.setattr(rt, "detect_span", lambda *a, **k: span)
    rt._replays.clear()
    rule = rule_of(("QB",), vpaf={"mode": "notAgainst", "thr": 1}, stop={"type": "atr", "atr": 1.5, "maxAtr": 20}, exit={"targetR": 2})
    result = rt.run("TEST", rule, span, PHASE, None, base=False)
    assert result["trades"]
    run_id = rt._save(result, "vpa")
    for trade in result["trades"][:5]:
        ctx = rt.trade_context(run_id, trade["n"])
        assert ctx["success"] and ctx["same"]
        row = next(r for r in ctx["rows"] if r["key"] == "vpaf")
        assert dict(row["items"])[trade["signal"]] == 1 and "medidor" in row["note"]


def test_la_busqueda_suma_el_filtro_vpa_apagado_de_fabrica():
    import rule_search as rs
    cfg = rs.clean_config({"tfs": [240], "codes": ["QB", "FV"], "seed": 4})
    opts = rs._options(cfg)
    assert opts["vpaf"][0] is None, "empieza apagado"
    old = {name: 0 for name in opts if name not in ("vpaf", "vpaFire")}
    old["e1"] = opts["e1"].index("FV")
    plain = rs.decode(old, cfg)
    assert plain == rs.decode({**old, "vpaf": 0, "vpaFire": 2}, cfg), "un genoma de antes da la misma regla"
    assert "vpa" not in plain and "vpaf" not in plain
    full = rs.decode({**old, "vpaf": 1}, cfg)
    assert full["vpaf"]["mode"] == "favor" and rs.complexity(full) == rs.complexity(plain) + 1
    qb = rs.decode({**old, "e1": opts["e1"].index("QB"), "vpaFire": 2}, cfg)
    assert qb["vpa"]["fire"] == 0.7
    assert rs._options(rs.clean_config({"tfs": [240], "codes": ["QB"], "vpa": False}))["vpaf"] == (None,)


def test_la_salida_vpa_sale_al_primer_aviso_en_contra_y_solo_entra_si_se_pide():
    plain = rule_of(("QB",), exit={"targetR": 2})
    assert "vpa" not in plain["exit"]
    junk = rule_of(("QB",), exit={"targetR": 2, "vpa": {"on": ["nada"]}})
    assert rt.rule_hash("X", junk) == rt.rule_hash("X", plain), "sin lecturas válidas no hay salida VPA"
    full = rt.clean_rule({"tf": 240, "recipe": {"slots": [{"codes": ["FV"]}]}, "exit": {"vpa": {"on": ["meter", "absorb", "climax", "push", "fade"], "thr": 0.8}}})
    assert full["exit"]["vpa"] == {"on": ["climax", "absorb", "push", "meter", "fade"], "fromR": 0.0, "thr": 0.8}
    assert "vpa" in full, "la salida necesita la configuración del lector"
    assert full["exit"]["horizon"] is None, "la salida VPA cuenta como salida: no se impone el cierre a las 96 velas"
    assert full == rt.clean_rule(full)

    bars = walk(3000, seed=13)
    rule = rule_of(("QB",), stop={"type": "atr", "atr": 2, "maxAtr": 20}, exit={"vpa": {"on": list(rt.VPA_EXITS), "thr": 1}})
    result = rt.run("TEST", rule, {"bars": bars, "events": []}, PHASE)
    ctx = rt._context("TEST", 240, bars)
    ctx["bars"] = bars
    warns = rt._vpa_exit_bars(result["rule"], ctx)
    index = {b["t"]: i for i, b in enumerate(bars)}
    vpa_out = [t for t in result["trades"] if t["reason"].startswith("VPA: ")]
    assert len(vpa_out) > 10 and {t["reason"] for t in vpa_out} <= {"VPA: " + v for v in rt.VPA_EXITS.values()}
    for t in result["trades"]:
        k, e, x = index[t["signal"]], index[t["entry_t"]], index[t["exit_t"]]
        first = min((j for j in warns[t["dir"]] if j >= e and j > k), default=None)
        if t["reason"].startswith("VPA: "):
            assert first == x - 1 and warns[t["dir"]][first] == t["reason"], "sale en la apertura siguiente al primer aviso"
            assert t["exit"] == bars[x]["o"]
        else:
            assert first is None or first >= x - 1, "ningún aviso antes de otra salida"

    # Sin futuro: los avisos de las primeras velas no cambian con velas posteriores
    short = rt._context("TEST", 240, bars[:1800])
    short["bars"] = bars[:1800]
    early = rt._vpa_exit_bars(result["rule"], short)
    for side in (1, -1):
        assert early[side] == {j: why for j, why in warns[side].items() if j < 1800}

    # Armada desde 1R: solo sale por el VPA un trade que ya llegó a 1R a favor
    armed = rule_of(("QB",), stop={"type": "atr", "atr": 2, "maxAtr": 20}, exit={"vpa": {"on": list(rt.VPA_EXITS), "fromR": 1}})
    later = rt.run("TEST", armed, {"bars": bars, "events": []}, PHASE)
    assert all(t["mfe"] >= 1 for t in later["trades"] if t["reason"].startswith("VPA: "))
