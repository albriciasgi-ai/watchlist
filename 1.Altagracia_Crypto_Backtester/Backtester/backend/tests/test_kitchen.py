"""La cocina de estrategias (kitchen.py): sin futuro, las capas (contexto y pasos del gatillo), lo que hay en una vela y
que el motor y la página conozcan los mismos bloques.
Uso: python -m pytest tests/test_kitchen.py"""
import random
import re
from pathlib import Path

import numpy as np
import pytest

import kitchen

MS = 60 * 60000
CATALOG_JS = Path(__file__).resolve().parents[2] / "frontend" / "src" / "components" / "kitchen" / "kitchenCatalog.js"


def walk(n, seed=5, start=100.0, ms=MS):
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
        bars.append({"t": i * ms, "o": o, "h": max(o, c) * (1 + up_w), "l": min(o, c) * (1 - dn_w), "c": c, "vol": vol, "delta": 0.0})
        price = c
    return bars


def rows(bars):
    return [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in bars]


def every_block():
    """Un bloque de cada clase, con sus valores de fábrica y los dos sentidos."""
    out = []
    for bid in kitchen.STATE_IDS + kitchen.LINE_EVENT_IDS + kitchen.EVENT_CODES:
        for way in ("favor", "contra"):
            block = kitchen.clean_block({"uid": bid + way, "id": bid, "p": {"dir": way}}, "step")
            out.append(block)
            if bid in kitchen.NEUTRAL:
                break
    return out


def stub(n, arrays):
    """Un juego de velas cuya verdad por bloque se fija a mano: `arrays` va por uid, con las velas en que se cumple."""
    facts = kitchen.Facts("TEST", 60, walk(n))
    masks = {}
    for uid, where in arrays.items():
        mask = np.zeros(n, dtype=bool)
        mask[list(where)] = True
        masks[uid] = mask
    facts.truth = lambda block, side: masks[block["uid"]]
    return facts


def doc_of(ctx=(), steps=(), links=(), **more):
    """ctx: uids de estados. steps: por paso, (uids de eventos, uids de estados, extras)."""
    gat = []
    for step in steps:
        events, states = step[0], step[1] if len(step) > 1 else ()
        extra = step[2] if len(step) > 2 else {}
        gat.append({"blocks": [{"uid": u, "id": "HM"} for u in events] + [{"uid": u, "id": "side"} for u in states], **extra})
    return kitchen.clean_doc({"side": "long", "ctx": [{"uid": u, "id": "side"} for u in ctx], "gat": gat, "links": list(links), **more})


# ==================== Sin futuro ====================

def test_lo_cerrado_no_cambia_con_velas_posteriores():
    """Cada bloque, en las velas ya cerradas, dice lo mismo con 900 velas que con 1,200: nada mira a la derecha."""
    bars = walk(1200)
    short, long = kitchen.Facts("TEST", 60, bars[:900]), kitchen.Facts("TEST", 60, bars)
    seen = 0
    for block in every_block():
        for side in (1, -1):
            a, b = short.truth(block, side), long.truth(block, side)[:900]
            assert np.array_equal(a, b), f"{block['id']} {block['p']} cambia al llegar velas nuevas"
            seen += int(a.sum())
    assert seen > 500  # Las velas de prueba sí dan elementos


def test_un_evento_cuenta_en_la_vela_con_que_se_conoce():
    """Un patrón de vela se confirma dos velas después: la estrategia no puede usarlo antes."""
    facts = kitchen.Facts("TEST", 60, walk(1200))
    late = [(at, known) for at, known, _ in facts.events_of("HM") if known > at]
    assert late, "Las velas de prueba no dan un patrón confirmado después"
    block = kitchen.clean_block({"uid": "x", "id": "HM", "p": {}}, "step")
    both = facts.truth(block, 1) | facts.truth(block, -1)
    for at, known in late:
        assert both[known] and known - at <= 2


def test_todos_los_marcos_de_la_simulacion_corren():
    for tf in (1, 5, 15, 60, 240):
        bars = walk(700, ms=tf * 60000)
        result = kitchen.evaluate("TEST", tf, rows(bars), {"gat": [{"blocks": [{"uid": "a", "id": "VH"}, {"uid": "b", "id": "QB"}, {"uid": "c", "id": "CC"}]}]},
                                  view=300, pick=bars[-5]["t"])
        assert result["success"], result
        assert result["seen"] == 300 and len(result["times"]) == 300 and result["candle"] is not None


# ==================== Las capas ====================

def test_un_paso_con_un_evento_da_una_senal_por_aparicion_y_no_repite_en_velas_pegadas():
    facts = stub(200, {"e": [50, 52, 60, 120]})
    out = facts.side(doc_of(steps=[(["e"],)]), 1)
    assert out["signals"] == [50, 60, 120]  # La de la vela 52 queda a menos de 4 velas de la anterior


def test_todos_al_menos_n_y_cualquiera_dentro_de_las_velas_del_paso():
    arrays = {"a": [50, 100, 150], "b": [52, 110], "c": [150]}
    blank = dict(steps=[(["a", "b", "c"], (), {"win": 5})])
    all_of = stub(200, arrays).side(doc_of(**blank), 1)
    assert all_of["signals"] == []  # Los tres nunca caen en 5 velas
    two = stub(200, arrays).side(doc_of(steps=[(["a", "b", "c"], (), {"win": 5, "mode": "min", "min": 2})]), 1)
    assert two["signals"] == [52, 150]  # a y b en 50-52; a y c en la misma vela 150
    any_of = stub(200, arrays).side(doc_of(steps=[(["a", "b", "c"], (), {"win": 5, "mode": "any"})]), 1)
    assert any_of["signals"] == [50, 100, 110, 150]


def test_el_contexto_se_mira_al_empezar_o_en_la_senal():
    arrays = {"ctx": range(40, 56), "e1": [50], "e2": [62]}
    steps, links = [(["e1"],), (["e2"],)], [{"type": "after", "max": 15}]
    first = stub(200, arrays).side(doc_of(ctx=["ctx"], steps=steps, links=links), 1)
    assert first["signals"] == [62]  # El contexto valía mientras se juntaba el paso 1 (velas 46 a 50)
    last = stub(200, arrays).side(doc_of(ctx=["ctx"], steps=steps, links=links, ctxWhen="last"), 1)
    assert last["signals"] == []     # Mientras se junta el último paso (velas 58 a 62) el contexto ya no vale
    close = stub(200, {**arrays, "e2": [58]}).side(doc_of(ctx=["ctx"], steps=steps, links=links, ctxWhen="last"), 1)
    assert close["signals"] == [58]  # Aquí sí: el contexto valía en las velas 54 y 55, dentro de las 5 del último paso
    gone = stub(200, {**arrays, "ctx": range(60, 70)}).side(doc_of(ctx=["ctx"], steps=steps, links=links), 1)
    assert gone["signals"] == []


def test_los_pasos_van_en_orden_y_con_un_plazo():
    steps = [(["e1"],), (["e2"],)]
    after = stub(200, {"e1": [50, 100], "e2": [50, 55, 130]})
    assert after.side(doc_of(steps=steps, links=[{"type": "after", "max": 8}]), 1)["signals"] == [55]  # 130 llega tarde; el de la vela 50 no es "después"
    same = stub(200, {"e1": [50, 100], "e2": [50, 130]})
    assert same.side(doc_of(steps=steps, links=[{"type": "same", "max": 8}]), 1)["signals"] == [50]
    any_order = stub(200, {"e1": [60], "e2": [55]})
    assert any_order.side(doc_of(steps=steps, links=[{"type": "after", "max": 8}]), 1)["signals"] == []
    assert any_order.side(doc_of(steps=steps, links=[{"type": "any", "max": 8}]), 1)["signals"] == [60]


def test_un_estado_en_un_paso_tiene_que_cumplirse_en_esas_velas_y_no_completa_el_paso_solo():
    facts = stub(200, {"e": [50, 90], "s": range(86, 95)})
    out = facts.side(doc_of(steps=[(["e"], ["s"], {"win": 3})]), 1)
    assert out["signals"] == [90]  # En la vela 50 el estado no se cumplía; y el estado solo (86 a 94) no da señal


def test_un_paso_de_solo_estados_da_senal_cuando_empieza_a_cumplirse():
    facts = stub(200, {"s": list(range(60, 80)) + list(range(120, 125))})
    assert facts.side(doc_of(steps=[((), ["s"])]), 1)["signals"] == [60, 120]


def test_a_punto_es_tras_el_penultimo_paso_y_antes_de_la_senal():
    facts = stub(200, {"e1": [50, 100], "e2": [54]})
    out = facts.side(doc_of(steps=[(["e1"],), (["e2"],)], links=[{"type": "after", "max": 6}]), 1)
    assert out["signals"] == [54]
    assert list(np.flatnonzero(out["near"])) == [50, 51, 52, 53] + list(range(100, 107))


def test_un_evento_en_el_contexto_cuenta_si_ocurrio_hace_poco():
    facts = kitchen.Facts("TEST", 60, walk(400))
    block = kitchen.clean_block({"uid": "x", "id": "VH", "cn": 4}, "ctx")
    assert block["conv"] == "recent"
    raw = facts.truth(block, 1)
    out = facts.side({"side": "long", "ctx": [block], "ctxWhen": "first", "gat": [], "links": []}, 1)
    first = int(np.flatnonzero(raw)[0])
    assert list(out["ctx"][first:first + 4]) == [True] * 4
    assert int(out["ctx"].sum()) > int(raw.sum())


# ==================== El documento ====================

def test_el_documento_queda_dentro_de_rango_y_sin_bloques_desconocidos():
    doc = kitchen.clean_doc({"side": "x", "ctx": [{"id": "nada"}, {"id": "lejos", "p": {"line": "e9999", "atr": 99, "dir": "contra"}}, {"id": "VH"}],
                             "gat": [{"mode": "z", "win": 500, "blocks": [{"id": "side", "p": {"line": "teeth"}}, {"id": "IM", "p": {"bars": 0}}]}] * 9,
                             "links": [{"type": "nunca", "max": 999}]})
    assert doc["side"] == "short" and len(doc["gat"]) == kitchen.MAX_STEPS and len(doc["links"]) == kitchen.MAX_STEPS - 1
    assert [b["id"] for b in doc["ctx"]] == ["lejos", "VH"]
    assert doc["ctx"][0]["p"] == {"line": "e50", "atr": 8.0, "dir": "contra"}
    assert doc["ctx"][1]["conv"] == "recent"          # Un evento en el contexto
    step = doc["gat"][0]
    assert step["mode"] == "all" and step["win"] == 20
    assert step["blocks"][0]["conv"] == "during" and step["blocks"][0]["p"]["line"] == "teeth"   # Un estado en un paso
    assert step["blocks"][1]["p"] == {"bars": 1, "atr": 2.0, "dir": "favor"}
    assert doc["links"][0] == {"type": "after", "max": 60}
    assert kitchen.clean_doc(None) == {"side": "short", "ctx": [], "ctxWhen": "first", "gat": [], "links": []}


# ==================== La respuesta ====================

def test_lo_que_se_ofrece_en_una_vela_se_cumple_en_esa_vela():
    """Sumar a la estrategia algo que se ofreció en una vela tiene que pintar esa vela (o la vela con que se supo)."""
    bars = walk(900)
    facts = kitchen.Facts("TEST", 60, bars)
    offered = 0
    for i in range(300, 900, 7):
        found = facts.candidates(i)
        for item in found["states"] + found["events"]:
            block = kitchen.clean_block({"uid": "x", "id": item["id"], "p": {**item["p"], "dir": "favor"}}, "step")
            side = item["d"] or 1
            assert facts.truth(block, side)[i + item.get("late", 0)], f"{item} no se cumple en la vela {i}"
            offered += 1
    assert offered > 300


def test_la_respuesta_cuenta_y_pinta_solo_lo_recorrido():
    bars = walk(900)
    doc = {"side": "both", "ctx": [{"uid": "c", "id": "side", "p": {"line": "e50"}}],
           "gat": [{"blocks": [{"uid": "g", "id": "VH"}], "win": 3}]}
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=250, pick=bars[-10]["t"])
    assert result["success"] and result["bars"] == 900 and result["seen"] == 250
    assert result["times"] == [b["t"] for b in bars[-250:]]
    facts = kitchen.facts_for("TEST", 60, kitchen.bars_of(rows(bars)))
    vh = kitchen.clean_block({"uid": "g", "id": "VH"}, "step")
    expected = (facts.truth(vh, 1) | facts.truth(vh, -1))[-250:]
    assert result["blocks"]["g"]["count"] == int(expected.sum())
    painted = [i for a, b in result["blocks"]["g"]["runs"] for i in range(a, b + 1)]
    assert painted == [int(i) for i in np.flatnonzero(expected)]
    assert all(0 <= s["i"] < 250 and s["side"] in (1, -1) for s in result["signals"]) and result["signals"]
    assert set(result["lines"]) == {"e50"} and len(result["lines"]["e50"]) == 250
    assert result["candle"]["i"] == 240 and len(result["candle"]["diag"]) == 2
    assert kitchen.evaluate("TEST", 60, rows(bars), doc, view=250, pick=bars[100]["t"])["candle"] is None  # Fuera de lo recorrido
    assert not kitchen.evaluate("TEST", 60, rows(bars[:20]))["success"]
    assert not kitchen.evaluate("TEST", 7, rows(bars))["success"]


def test_la_cocina_en_blanco_no_da_senales():
    result = kitchen.evaluate("TEST", 60, rows(walk(400)), None, view=200)
    assert result["success"] and result["signals"] == [] and result["steps"] == [] and not result["context"]["has"]


# ==================== El motor y la página ====================

def test_la_pagina_conoce_los_mismos_bloques_que_el_motor():
    if not CATALOG_JS.exists():
        pytest.skip("Sin la página a la vista")
    text = CATALOG_JS.read_text(encoding="utf-8")
    ids = set(re.findall(r"\bid: '([A-Za-z]+)'", text)) | set(re.findall(r"^\s{2}([A-Z]{2}): ", text, flags=re.M))
    wanted = set(kitchen.STATE_IDS + kitchen.LINE_EVENT_IDS + kitchen.EVENT_CODES)
    assert wanted <= ids, f"La página no conoce: {sorted(wanted - ids)}"
    catalog = kitchen.catalog()
    assert {b["id"] for b in catalog["states"] + catalog["events"]} == wanted
