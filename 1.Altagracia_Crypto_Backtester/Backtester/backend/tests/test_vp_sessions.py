"""Perfil por sesión del probador de reglas. Uso: python -m pytest tests/test_vp_sessions.py"""
import numpy as np
import pytest

import rule_tester as rt
import vp_sessions as vp

TF = 15
MS = TF * 60000
DAY = vp.DAY_MS
PHASE = {"phase": 1, "from": "2020-01-01", "to": "2020-01-31"}
LEVELS = {0: {"poc": 100.0, "vah": 102.0, "val": 98.0, "high": 104.0, "low": 96.0}}  # La sesión del día 0


def day(prices, start=DAY):
    """Velas de 15m del día 1: cada precio es (apertura, máximo, mínimo, cierre) o un número para una vela plana."""
    bars = []
    for k, p in enumerate(prices):
        o, h, l, c = p if isinstance(p, tuple) else (p, p + 0.2, p - 0.2, p)
        bars.append({"t": start + k * MS, "o": o, "h": h, "l": l, "c": c, "delta": 0.0, "vol": 10.0})
    return bars


def codes(found):
    return [(e["code"], e["dir"], (e["t"] - DAY) // MS) for e in found]


def test_el_perfil_sigue_la_regla_del_indicador():
    prices = np.array([10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 20.0])
    volumes = np.array([1.0, 1.0, 2.0, 8.0, 10.0, 6.0, 2.0, 1.0, 1.0, 1.0])
    levels = vp.profile_levels(prices, volumes, rows=10, share=0.7)
    assert levels["poc"] == pytest.approx(14.5) and levels["val"] == pytest.approx(13.5) and levels["vah"] == pytest.approx(15.5)
    assert vp.profile_levels(np.array([5.0, 5.0]), np.array([1.0, 1.0])) is None


def test_las_sesiones_van_en_utc_y_la_semana_empieza_el_lunes():
    assert vp.session_start(DAY + 5 * vp.HOUR, 24) == DAY and vp.session_start(DAY + 9 * vp.HOUR, 8) == DAY + 8 * vp.HOUR
    monday = 4 * DAY  # 5 de enero de 1970
    assert vp.session_start(monday + 3 * DAY, 168) == monday


def test_regreso_al_valor_abre_fuera_y_se_sostiene_dentro():
    bars = day([103, 103, 101.5, 103, 101, 100.5, 100])  # Abre encima del VAH; la primera vuelta no se sostiene
    found = vp.events(bars, TF, LEVELS, 24, accept=2, fail_bars=3)
    vr = [e for e in found if e["code"] == "VR"]
    assert codes(vr) == [("VR", -1, 5)] and vr[0]["info"]["open"] == 1 and vr[0]["hi"] == pytest.approx(103.2)
    assert [e for e in vp.events(day([100, 100, 100]), TF, LEVELS, 24) if e["code"] == "VR"] == []


def test_fallo_fuera_del_valor_cierra_de_vuelta_a_tiempo():
    bars = day([100, 101, (101, 102.8, 100.9, 102.5), (102.5, 103.1, 101.2, 101.5), 101])
    vf = [e for e in vp.events(bars, TF, LEVELS, 24, accept=4, fail_bars=3) if e["code"] == "VF"]
    assert codes(vf) == [("VF", -1, 3)] and vf[0]["info"]["extreme"] == 103.1 and (vf[0]["lo"], vf[0]["hi"]) == (102.0, 103.1)
    slow = day([100, 101, (101, 102.8, 100.9, 102.5), 102.6, 102.7, 102.8, 101])
    assert [e for e in vp.events(slow, TF, LEVELS, 24, accept=9, fail_bars=3) if e["code"] == "VF"] == []


def test_aceptacion_fuera_una_vez_por_lado():
    bars = day([100, 102.5, 102.6, 102.7, 102.8, 100, 97, 96.8])
    vx = [e for e in vp.events(bars, TF, LEVELS, 24, accept=2, fail_bars=1) if e["code"] == "VX"]
    assert codes(vx) == [("VX", 1, 2), ("VX", -1, 7)]


def test_sin_sesion_anterior_no_hay_elementos():
    assert vp.events(day([103, 101, 101], start=5 * DAY), TF, LEVELS, 24) == []


def test_objetivo_en_el_poc_y_en_el_borde_contrario(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    monkeypatch.setattr(rt, "_vp_levels", lambda *a: LEVELS)
    filler = day([100] * 96, start=0)
    today = day([100, 101, (101, 102.8, 100.9, 102.5), (102.5, 103.1, 101.2, 101.5)] + [101.5] * 6 + [(101.5, 101.6, 99.5, 99.8)] + [99.8] * 6
                + [(99.8, 99.9, 97.5, 97.8)] + [97.8] * 60)
    span = {"bars": filler + today, "events": []}

    def run(target_at):
        raw = {"name": "V", "tf": TF, "recipe": {"slots": [{"codes": ["VF"]}]}, "vp": {"hours": 24, "accept": 60},
               "stop": {"type": "zone", "buffer": 0.1}, "exit": {"targetAt": target_at, "targetR": 2}, "cooldown": 0}
        rule = rt.clean_rule(raw)
        assert rule["targetAt"] == target_at and rule["exit"]["targetR"] is None and rule["exit"]["horizon"] is None
        return rt.run("X", rule, span, PHASE, None, base=False)["trades"][0]

    poc = run("poc")
    assert poc["dir"] == -1 and poc["target"] == 100.0 and poc["reason"] == "objetivo" and poc["exit"] == 100.0
    assert poc["stop"] > 103.1 and poc["vp"]["vah"] == 102.0
    edge = run("edge")
    assert edge["target"] == 98.0 and edge["reason"] == "objetivo" and edge["exit_t"] > poc["exit_t"]
    plain = rt.clean_rule({"name": "V", "tf": TF, "recipe": {"slots": [{"codes": ["EX"]}]}, "exit": {"targetAt": "poc"}})
    assert "targetAt" not in plain and "vp" not in plain and plain["exit"]["horizon"] == rt.DEFAULT_HORIZON


def bell(center, rows=50, width=6.0, height=100.0):
    return height * np.exp(-((np.arange(rows) - center) / width) ** 2)


def test_forma_del_perfil_segun_donde_quedo_el_volumen():
    assert vp.profile_shape(bell(25)) == "D"
    assert vp.profile_shape(bell(40)) == "P" and vp.profile_shape(bell(8)) == "b"
    assert vp.profile_shape(bell(10) + bell(38, height=80)) == "B"
    assert vp.profile_shape(bell(25) + bell(40, height=30)) == "D"       # El segundo pico es chico
    assert vp.profile_shape(bell(22, width=12) + bell(30, width=12)) == "D"  # Dos picos pegados son una sola distribución


def test_el_filtro_de_forma_deja_solo_esas_sesiones(monkeypatch):
    monkeypatch.setattr(rt.fs, "minutes", lambda *a: None)
    levels = {0: {**LEVELS[0], "shape": "P"}, DAY: {**LEVELS[0], "shape": "b"}}
    monkeypatch.setattr(rt, "_vp_levels", lambda *a: levels)
    fail = [100, 101, (101, 102.8, 100.9, 102.5), (102.5, 103.1, 101.2, 101.5)] + [101.5] * 92
    span = {"bars": day([100] * 96, start=0) + day(fail) + day(fail, start=2 * DAY), "events": []}

    def run(shapes):
        raw = {"name": "V", "tf": TF, "recipe": {"slots": [{"codes": ["VF"]}]}, "vp": {"hours": 24, "accept": 600, "shapes": shapes},
               "stop": {"type": "zone"}, "exit": {"targetR": None, "horizon": 5}, "cooldown": 0}
        return rt.run("X", rt.clean_rule(raw), span, PHASE, None, base=False)

    both = run([])
    assert [t["vp"]["shape"] for t in both["trades"]] == ["P", "b"] and "shapes" not in rt.clean_rule({"name": "V", "recipe": {"slots": [{"codes": ["VF"]}]}})["vp"]
    assert [row["label"] for row in both["breakdowns"]["vpShape"]] == ["P", "b"]
    assert [t["vp"]["shape"] for t in run(["b"])["trades"]] == ["b"]
