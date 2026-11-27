"""La cocina de estrategias (kitchen.py): sin futuro, las capas (contexto, zona y pasos del gatillo), lo que hay en una
vela, las zonas, el order flow en segundo plano y que el motor y la página conozcan los mismos bloques.
Uso: python -m pytest tests/test_kitchen.py"""
import json
import random
import re
import shutil
import subprocess
import threading
import time
from pathlib import Path

import numpy as np
import pytest

import kitchen

MS = 60 * 60000
HERE = Path(__file__).resolve().parent
CATALOG_JS = HERE.parents[1] / "frontend" / "src" / "components" / "kitchen" / "kitchenCatalog.js"


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
        if bid in kitchen.PAGE_IDS:
            continue   # Lo que manda la página tiene sus propias pruebas
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
    assert kitchen.clean_doc(None) == {"side": "short", "ctx": [], "ctxWhen": "first", "gat": [], "links": [],
                                       "zone": {"picks": [], "rel": "near", "atr": 0.5, "when": "first"}}


def test_la_capa_de_zona_queda_dentro_de_rango_y_sin_zonas_desconocidas():
    zone = kitchen.clean_zone({"rel": "in", "atr": 99, "when": "last", "picks": [
        {"uid": "a", "type": "kind", "kind": "sr", "dir": "contra"},
        {"uid": "b", "type": "kind", "kind": "liq", "dir": "favor"},          # Las de liquidaciones no tienen lado
        {"uid": "c", "type": "kind", "kind": "nube"},                         # Un tipo que el motor no detecta
        {"uid": "d", "type": "kind", "kind": "draw"},                         # Un dibujo solo puede ser una zona fija
        {"uid": "e", "type": "one", "kind": "draw", "lo": 120, "hi": 100, "from": 5000, "way": 7},
        {"uid": "f", "type": "one", "kind": "sr", "lo": "x", "hi": 100, "from": 5000},
        {"uid": "g", "type": "one", "kind": "ob", "lo": -5, "hi": 100, "from": 5000}]})
    assert zone["rel"] == "in" and zone["atr"] == 3.0 and zone["when"] == "last"
    assert zone["picks"] == [{"uid": "a", "type": "kind", "kind": "sr", "dir": "contra"},
                             {"uid": "b", "type": "kind", "kind": "liq", "dir": "any"},
                             {"uid": "e", "type": "one", "kind": "draw", "lo": 100.0, "hi": 120.0, "from": 5000, "way": 0}]
    many = kitchen.clean_zone({"picks": [{"uid": str(k), "type": "kind", "kind": "fvg"} for k in range(20)]})
    assert len(many["picks"]) == kitchen.MAX_PICKS and many["picks"][0]["dir"] == "any"
    doc = kitchen.clean_doc({"gat": [{"blocks": [{"id": "ztoca", "p": {"dir": "contra"}}, {"id": "zrech"}, {"id": "ST"}, {"id": "cvd", "p": {"n": 999}}]}]})
    assert [b["id"] for b in doc["gat"][0]["blocks"]] == ["ztoca", "zrech", "ST", "cvd"]
    assert doc["gat"][0]["blocks"][0]["p"] == {} and doc["gat"][0]["blocks"][2]["p"] == {"dir": "favor"}
    assert doc["gat"][0]["blocks"][3]["p"] == {"n": 100, "dir": "favor"} and doc["gat"][0]["blocks"][3]["conv"] == "during"
    assert kitchen.uses_flow(doc) and not kitchen.uses_flow(kitchen.clean_doc({"gat": [{"blocks": [{"id": "zrech"}, {"id": "VH"}]}]}))


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


# ==================== Las zonas ====================

def candle(i, o, h, l, c, ms=MS):
    return {"t": i * ms, "o": o, "h": h, "l": l, "c": c, "vol": 100.0, "delta": 0.0}


def flat(n, price=100.0):
    """Velas quietas, todas iguales: sin swings ni huecos. Cada prueba cambia a mano las que le hacen falta."""
    return [candle(i, price, price + 0.1, price - 0.1, price) for i in range(n)]


def zone_doc(*picks, **more):
    return kitchen.clean_zone({"picks": list(picks), **more})


def where(mask):
    return [int(i) for i in np.flatnonzero(mask)]


def test_las_zonas_ya_cerradas_no_cambian_con_velas_posteriores():
    """Las zonas de cada tipo, y lo que la capa de zona dice de cada vela, son iguales con 900 velas que con 1,200: una
    zona cuenta desde que se conoce y nada de lo que pasa después la cambia hacia atrás."""
    bars = walk(1200)
    short, long = kitchen.Facts("TEST", 60, bars[:900]), kitchen.Facts("TEST", 60, bars)
    fixed = [{"uid": "f", "type": "one", "kind": "sr", "lo": bars[500]["h"], "hi": bars[500]["h"], "from": bars[501]["t"], "way": -1},
             {"uid": "g", "type": "one", "kind": "draw", "lo": bars[600]["l"], "hi": bars[600]["h"], "from": bars[650]["t"]},
             {"uid": "h", "type": "one", "kind": "fvg", "lo": bars[400]["l"] * 0.97, "hi": bars[400]["l"] * 0.99, "from": bars[401]["t"], "way": 1}]
    layers = [zone_doc({"uid": "z", "type": "kind", "kind": kind, "dir": way}, rel=rel)
              for kind in ("sr", "fvg", "ob") for way in ("favor", "contra", "any") for rel in ("near", "in")]
    layers += [zone_doc(pick, rel="in") for pick in fixed] + [zone_doc(*fixed)]
    touched = 0
    for kind in ("sr", "fvg", "ob"):
        assert len(long.zones(kind)) > 20, f"Las velas de prueba casi no dan zonas {kind}"
    for zone in layers:
        for side in (1, -1):
            a, b = short.zone_layer(zone, side), long.zone_layer(zone, side)
            for field in ("ok", "near", "touch", "arrive", "reject"):
                assert np.array_equal(a[field], b[field][:900]), f"{zone['picks']} {zone['rel']}: {field} cambia al llegar velas nuevas"
            touched += int(a["touch"].sum())
    assert touched > 1000
    for i in range(300, 900, 13):
        assert short.zones_at(i, bars[i]["c"]) == long.zones_at(i, bars[i]["c"]), f"Las zonas de la vela {i} cambian"


def test_un_nivel_nace_con_su_swing_se_refuerza_con_otro_toque_y_termina_con_un_cierre_mas_alla():
    """El nivel es la línea que dibuja S&R v2 (el promedio de sus toques), y lo rompe un cierre más allá del más lejano."""
    bars = flat(120)
    bars[20].update(h=110.0)             # Un máximo solo: se conoce 5 velas después, en la 25
    bars[39].update(h=109.95)            # Se acerca sin tocarlo
    bars[40].update(h=110.1)             # Lo toca y cierra abajo
    bars[41].update(h=110.2)             # Otro máximo a menos de 0.3%: refuerza el mismo nivel (se conoce en la 46)
    bars[55].update(h=110.3, c=110.15)   # Cierra sobre la línea (110.1), pero no sobre el toque más alto: el nivel sigue
    bars[60].update(h=112.1, c=112.0)    # Cierra por encima de todos los toques: el nivel termina
    facts = kitchen.Facts("TEST", 60, bars)
    levels = [z for z in facts.zones("sr") if z["way"] == -1 and z["lo0"] == 110.0]
    assert len(levels) == 1 and not [z for z in facts.zones("sr") if z["way"] == 1]
    z = levels[0]
    assert (z["a"], z["b"]) == (26, 59)   # Desde la vela siguiente a la que lo da a conocer, hasta la anterior a la que lo rompe
    assert z["lo"] is z["hi"]             # Una línea, no una franja
    assert list(z["lo"]) == pytest.approx([110.0] * 21 + [110.1] * 13)        # La línea se corre al promedio desde la vela 47
    assert list(z["edge"]) == [110.0] * 21 + [110.2] * 13                     # Y el toque más lejano pasa a ser 110.2
    resistances = {"uid": "z", "type": "kind", "kind": "sr", "dir": "favor"}
    layer = facts.zone_layer(zone_doc(resistances, rel="in"), -1)
    assert where(layer["touch"]) == [40, 41, 55] and where(layer["ok"]) == [40, 41, 55]
    assert where(layer["arrive"]) == [40, 55]    # En la 41 sigue tocándolo: no es otra llegada
    assert where(layer["reject"]) == [40, 41]    # Las dos cierran por debajo; la 55 cierra por encima de la línea
    assert where(facts.zone_layer(zone_doc(resistances, rel="near"), -1)["ok"])[:3] == [39, 40, 41]
    # Para un largo, «a favor» son los soportes, y aquí no hay; «en contra», las resistencias: la 55 cierra de su lado
    assert not facts.zone_layer(zone_doc(resistances, rel="in"), 1)["touch"].any()
    against = facts.zone_layer(zone_doc({**resistances, "dir": "contra"}, rel="in"), 1)
    assert where(against["touch"]) == [40, 41, 55] and where(against["reject"]) == [55]
    # Con un clic en su precio: en la vela 45 la línea está en 110; en la 50 ya se corrió a 110.1, desde la vela 47
    early = [x for x in facts.zones_at(45, 110.0) if x["kind"] == "sr"]
    assert [(x["lo"], x["hi"], x["edge"], x["from"], x["under"]) for x in early] == [(110.0, 110.0, 110.0, 26 * MS, True)]
    later = [x for x in facts.zones_at(50, 110.1) if x["kind"] == "sr"]
    assert [(x["lo"], x["hi"], x["edge"], x["from"]) for x in later] == [(pytest.approx(110.1), pytest.approx(110.1), 110.2, 47 * MS)]
    assert facts.zones_at(45) == []   # Sin clic, y con la vela a 10 de distancia, no se ofrece: queda lejos
    # Elegida «solo esta» en la vela 50, la línea fija aguanta el cierre de la 55 como el nivel, por su toque más lejano
    alone = facts._fixed_zone(kitchen.clean_pick({"type": "one", "kind": "sr", "way": -1, **{k: later[0][k] for k in ("lo", "hi", "edge", "from")}}))
    assert (alone["a"], alone["b"]) == (47, 59)
    loose = facts._fixed_zone(kitchen.clean_pick({"type": "one", "kind": "sr", "way": -1, **{k: later[0][k] for k in ("lo", "hi", "from")}}))
    assert (loose["a"], loose["b"]) == (47, 54)   # Sin ese dato, una línea fija termina con el primer cierre más allá de ella


@pytest.mark.skipif(shutil.which("node") is None, reason="sin node")
def test_los_soportes_y_resistencias_son_los_niveles_que_dibuja_sr_v2():
    """Paridad con el indicador del navegador (swingLevels.js, con sus valores de fábrica): al abrir cada vela, la cocina
    tiene los mismos niveles vigentes, en el mismo precio y con el mismo toque más lejano."""
    bars = walk(900)
    at = list(range(60, 898, 19))
    payload = {"at": at, "candles": [{"timestamp": b["t"], "open": b["o"], "high": b["h"], "low": b["l"], "close": b["c"], "volume": b["vol"]}
                                     for b in bars]}
    run = subprocess.run(["node", str(HERE / "kitchen_levels_parity.mjs")], input=json.dumps(payload), capture_output=True, text=True, timeout=120)
    assert run.returncode == 0, run.stderr
    facts = kitchen.Facts("TEST", 60, bars)
    value = lambda edge, k: float(edge if np.isscalar(edge) else edge[k])
    total = 0
    for i, shown in zip(at, json.loads(run.stdout)):
        # La cocina cuenta un nivel en la vela i+1 si se conocía al cerrar la i y la i+1 no lo rompe
        theirs = sorted(row for row in shown if not (facts.C[i + 1] - row[2]) * row[0] < 0)
        mine = sorted([z["way"], value(z["lo"], i + 1 - z["a"]), value(z["edge"], i + 1 - z["a"])]
                      for z in facts.zones("sr") if z["a"] <= i + 1 <= z["b"])
        assert len(mine) == len(theirs), f"vela {i}: {len(mine)} niveles en la cocina y {len(theirs)} en el indicador"
        assert mine == [pytest.approx(row) for row in theirs], f"vela {i}"
        total += len(mine)
    assert total > 300


def test_un_fvg_se_recorta_con_cada_vela_que_entra_y_termina_cuando_se_llena():
    bars = [candle(i, 99.9, 100.0, 99.8, 99.9) for i in range(10)]
    bars += [candle(10, 99.9, 104.1, 99.9, 104.0), candle(11, 104.0, 105.1, 103.0, 105.0)]   # Hueco de 100 a 103
    bars += [candle(i, 104.5, 105.1, 104.0, 104.5) for i in range(12, 40)]
    bars[20].update(l=102.0)    # Entra en el hueco: queda de 100 a 102
    bars[21].update(l=102.5)    # Ya no lo alcanza
    bars[22].update(l=101.0)    # Entra otra vez: de 100 a 101
    bars[25].update(l=99.5)     # Lo llena entero
    facts = kitchen.Facts("TEST", 60, bars)
    gaps = facts.zones("fvg")
    assert len(gaps) == 1 and gaps[0]["way"] == 1
    z = gaps[0]
    assert (z["a"], z["b"], z["lo"]) == (12, 24, 100.0)
    assert list(z["hi"]) == [103.0] * 9 + [102.0] * 2 + [101.0] * 2      # Velas 12 a 20, 21 y 22, 23 y 24
    layer = facts.zone_layer(zone_doc({"uid": "z", "type": "kind", "kind": "fvg", "dir": "favor"}, rel="in"), 1)
    assert where(layer["touch"]) == [20, 22] and where(layer["arrive"]) == [20, 22] and where(layer["reject"]) == [20, 22]
    assert not facts.zone_layer(zone_doc({"uid": "z", "type": "kind", "kind": "fvg", "dir": "favor"}, rel="in"), -1)["touch"].any()
    offered = [x for x in facts.zones_at(23) if x["kind"] == "fvg"]
    assert [(x["lo"], x["hi"], x["from"]) for x in offered] == [(100.0, 101.0, 23 * MS)]   # Como se ve en esa vela
    alone = facts._fixed_zone({"kind": "fvg", "way": 1, "lo": 100.0, "hi": 101.0, "from": 23 * MS})
    assert (alone["a"], alone["b"], alone["lo"], alone["hi"]) == (23, 24, 100.0, 101.0)


def test_un_soporte_una_resistencia_o_un_order_block_valen_hasta_el_cierre_que_los_rompe():
    facts = kitchen.Facts("TEST", 60, walk(900))
    for kind in ("sr", "ob"):
        ended = 0
        for z in facts.zones(kind):
            # Lo que un cierre tiene que pasar: el borde lejano de un order block, o el toque más lejano de un nivel
            limit = z["edge"] if "edge" in z else z["lo"] if z["way"] > 0 else z["hi"]
            closes = facts.C[z["a"]:z["b"] + 1]
            assert (closes >= limit).all() if z["way"] > 0 else (closes <= limit).all()
            if z["b"] < facts.n - 1:
                last = float(limit if np.isscalar(limit) else limit[-1])
                assert facts.C[z["b"] + 1] < last if z["way"] > 0 else facts.C[z["b"] + 1] > last
                ended += 1
        assert ended > 10


def test_solo_esta_zona_es_una_franja_fija_que_cuenta_desde_que_se_conoce():
    bars = flat(80)
    for i in (30, 50, 70):
        bars[i].update(h=106.0)              # Tocan la franja de 105 a 107
    bars[60].update(h=108.0, c=107.5)        # La pasa y cierra por encima
    facts = kitchen.Facts("TEST", 60, bars)

    def touches(kind, way=0, since=40 * MS):
        pick = {"uid": "z", "type": "one", "kind": kind, "lo": 105.0, "hi": 107.0, "from": since, "way": way}
        return where(facts.zone_layer(zone_doc(pick, rel="in"), -1)["touch"])

    assert touches("draw") == [50, 60, 70]                # Un dibujo cuenta desde su vela, no antes, y no termina
    assert touches("liq") == [50, 60, 70]
    assert touches("draw", since=30 * MS) == [30, 50, 60, 70]
    assert touches("draw", since=50 * MS + 1) == [60, 70]  # Dibujado con la vela 50 a medias: cuenta desde la siguiente
    assert touches("sr", -1) == [50]                      # Una resistencia termina con el cierre por encima (vela 60)
    assert touches("ob", -1) == [50]
    assert touches("sr", 1) == []                         # Un soporte con el precio ya debajo está roto
    assert touches("fvg", 1) == []                        # Y un hueco alcista con el precio ya debajo está lleno
    assert touches("draw", since=80 * MS) == []           # Todavía no cuenta: empieza después de la última vela
    zone = zone_doc({"uid": "z", "type": "one", "kind": "draw", "lo": 105.0, "hi": 107.0, "from": 40 * MS}, rel="in")
    result = kitchen.evaluate("TEST", 60, rows(bars), {"side": "short", "zone": zone, "gat": [{"blocks": [{"uid": "g", "id": "zrech"}]}]}, view=80)
    assert [s["i"] for s in result["signals"]] == [50, 70]   # La vela 60 la toca, pero cierra arriba: no es un rechazo para un corto
    assert result["zone"]["picks"]["z"] == {"count": 1, "open": True, "bands": [[40 * MS, 80 * MS, 105.0, 107.0, 0]]}


def mask(n, cells):
    out = np.zeros(n, dtype=bool)
    out[list(cells)] = True
    return out


def layer_of(n=200, ok=(), arrive=(), reject=()):
    return {"has": True, "ok": mask(n, ok), "near": mask(n, ok), "touch": mask(n, ok), "arrive": mask(n, arrive),
            "reject": mask(n, reject), "picks": {}}


def test_la_zona_se_mira_al_empezar_el_gatillo_o_en_la_senal():
    facts = stub(200, {"e1": [50], "e2": [62]})
    steps, links = [(["e1"],), (["e2"],)], [{"type": "after", "max": 15}]
    first, last = doc_of(steps=steps, links=links), doc_of(steps=steps, links=links, zone={"when": "last"})
    facts.zone_layer = lambda zone, sd: layer_of(ok=range(40, 56))
    assert facts.side(first, 1)["signals"] == [62]   # La zona valía mientras se juntaba el paso 1 (velas 46 a 50)
    assert facts.side(last, 1)["signals"] == []      # Mientras se junta el último paso (velas 58 a 62) ya no
    facts.zone_layer = lambda zone, sd: layer_of(ok=range(58, 70))
    assert facts.side(first, 1)["signals"] == [] and facts.side(last, 1)["signals"] == [62]
    # Con el contexto: cada capa tiene su momento
    both = stub(200, {"ctx": range(40, 56), "e1": [50], "e2": [62]})
    both.zone_layer = lambda zone, sd: layer_of(ok=range(58, 70))
    assert both.side(doc_of(ctx=["ctx"], steps=steps, links=links, zone={"when": "last"}), 1)["signals"] == [62]
    assert both.side(doc_of(ctx=["ctx"], steps=steps, links=links, zone={"when": "last"}, ctxWhen="last"), 1)["signals"] == []


def test_llegar_a_la_zona_y_rechazarla_son_eventos_de_la_capa_de_zona():
    facts = stub(200, {})
    facts.zone_layer = lambda zone, sd: layer_of(ok=range(200), arrive=[70, 120], reject=[72] if sd < 0 else [121])
    doc = kitchen.clean_doc({"side": "both", "gat": [{"blocks": [{"uid": "a", "id": "ztoca"}]}, {"blocks": [{"uid": "r", "id": "zrech"}]}],
                             "links": [{"type": "after", "max": 5}]})
    assert facts.side(doc, -1)["signals"] == [72] and facts.side(doc, 1)["signals"] == [121]
    # Sin zonas elegidas no ocurren: la estrategia no da señales
    empty = kitchen.Facts("TEST", 60, walk(300))
    assert empty.side(doc, -1)["signals"] == [] and not empty.zone_layer(doc["zone"], 1)["has"] and empty.zone_layer(doc["zone"], 1)["ok"].all()
    # En el contexto, un evento de zona cuenta «si ocurrió en las últimas N velas»
    recent = kitchen.clean_doc({"side": "short", "ctx": [{"uid": "a", "id": "ztoca", "cn": 3}], "gat": []})
    assert where(facts.side(recent, -1)["ctx"]) == [70, 71, 72, 120, 121, 122]


def test_la_respuesta_pinta_y_cuenta_la_capa_de_zona():
    bars = walk(900)
    doc = {"side": "short", "zone": {"rel": "in", "picks": [{"uid": "r", "type": "kind", "kind": "sr", "dir": "favor"}]},
           "gat": [{"blocks": [{"uid": "g", "id": "zrech"}]}]}
    facts = kitchen.facts_for("TEST", 60, kitchen.bars_of(rows(bars)))
    layer = facts.zone_layer(kitchen.clean_doc(doc)["zone"], -1)
    hit = where(layer["reject"][300:])[-1] + 300
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=600, pick=bars[hit]["t"])
    assert result["zone"]["has"] and result["zone"]["count"] == int(layer["touch"][300:].sum()) > 0
    assert result["zone"]["arrivals"] == int(layer["arrive"][300:].sum()) > 0
    assert [i + 300 for a, b in result["zone"]["runs"] for i in range(a, b + 1)] == [i for i in where(layer["touch"]) if i >= 300]
    assert result["blocks"]["g"]["count"] == int(layer["reject"][300:].sum())
    assert result["signals"] and {s["i"] + 300 for s in result["signals"]} <= set(where(layer["reject"]))
    chosen = result["zone"]["picks"]["r"]
    assert chosen["count"] == len(chosen["bands"]) > 0 and all(b[4] == -1 and b[2] <= b[3] and b[0] < b[1] for b in chosen["bands"])
    assert result["candle"]["diag"][0]["zone"] is True
    assert {"id": "zrech", "p": {}, "d": 0, "late": 0} in result["candle"]["events"]   # Se ofrece donde ocurre
    blank = kitchen.evaluate("TEST", 60, rows(bars), None, view=600, pick=bars[hit]["t"])
    assert blank["zone"] == {"has": False, "runs": [], "count": 0, "arrivals": 0, "picks": {}}
    assert blank["candle"]["diag"][0]["zone"] is None and not [e for e in blank["candle"]["events"] if e["id"] in kitchen.ZONE_EVENT_IDS]


def test_las_zonas_de_la_vela_elegida_y_cada_una_sola_es_la_misma_franja():
    """Lo que se ofrece al elegir una vela: zonas que cuentan en ella, la más cercana al clic primero. Y elegida «solo
    esta», la franja toca esa vela igual que la zona de donde salió."""
    bars = walk(900)
    facts = kitchen.facts_for("TEST", 60, kitchen.bars_of(rows(bars)))
    tried = under = 0
    for i in range(400, 890, 7):
        result = kitchen.evaluate("TEST", 60, rows(bars), None, view=600, pick=bars[i]["t"], pick_price=bars[i]["h"])
        zones = result["candle"]["zones"]
        assert len(zones) <= kitchen.CANDLE_ZONES
        for z in zones:
            assert z["kind"] in kitchen.ZONE_KINDS and 0 < z["lo"] <= z["hi"] and z["from"] <= bars[i]["t"] and z["way"] in (1, -1)
            pick = {"uid": "p", "type": "one", "kind": z["kind"], "lo": z["lo"], "hi": z["hi"], "from": z["from"], "way": z["way"], "edge": z.get("edge")}
            layer = facts.zone_layer(zone_doc(pick, rel="in"), -1)
            assert bool(layer["touch"][i]) == z["touch"], f"{z} no es la misma franja en la vela {i}"
            tried += 1
            under += z["under"]
        if zones and zones[0]["under"]:
            assert zones[0]["lo"] - 0.15 * facts.atr[i] <= bars[i]["h"] <= zones[0]["hi"] + 0.15 * facts.atr[i]
    assert tried > 150 and under > 10


def test_un_nivel_de_un_vp_fijo_es_una_zona_fija_que_cuenta_desde_que_se_suma_y_no_termina():
    """El POC, el VAH, el VAL o el área de valor de un perfil de rango fijo del gráfico: la página manda su precio y
    desde cuándo cuenta (la hora simulada en que se sumó). Como un dibujo, vale desde ahí y hasta que se quita."""
    bars = flat(80)
    for i in (30, 50, 70):
        bars[i].update(h=106.0)              # Tocan el nivel de 105.5
    bars[60].update(h=108.0, c=107.5)        # Una vela lo pasa y cierra por encima: no lo termina
    facts = kitchen.Facts("TEST", 60, bars)
    poc = kitchen.clean_pick({"uid": "p", "type": "one", "kind": "vp", "shape": "poc", "lo": 105.5, "hi": 105.5, "from": 40 * MS, "way": 0})
    assert poc == {"uid": "p", "type": "one", "kind": "vp", "lo": 105.5, "hi": 105.5, "from": 40 * MS, "way": 0}
    assert where(facts.zone_layer(zone_doc(poc, rel="in"), -1)["touch"]) == [50, 60, 70]   # La vela 30 es de antes: no cuenta
    area = kitchen.clean_pick({"uid": "a", "type": "one", "kind": "vp", "lo": 107.0, "hi": 105.0, "from": 55 * MS})
    assert (area["lo"], area["hi"], area["way"]) == (105.0, 107.0, 0)
    assert where(facts.zone_layer(zone_doc(area, rel="in"), 1)["touch"]) == [60, 70]
    assert kitchen.clean_pick({"uid": "x", "type": "kind", "kind": "vp"}) is None          # No hay «todas»: solo zona fija
    doc = {"side": "short", "zone": zone_doc(poc, rel="in"), "gat": [{"blocks": [{"uid": "g", "id": "zrech"}]}]}
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=80)
    assert [s["i"] for s in result["signals"]] == [50, 70]      # La vela 60 lo toca, pero cierra arriba: no es un rechazo
    assert result["zone"]["picks"]["p"] == {"count": 1, "open": True, "bands": [[40 * MS, 80 * MS, 105.5, 105.5, 0]]}
    zones = kitchen.catalog()["zones"]
    assert set(zones["user"]) == set(kitchen.USER_KINDS) == {"draw", "vp", "ind"} and set(zones["user"]) < set(zones["fixed"])


def test_los_niveles_de_los_vp_fijos_se_ordenan_con_las_zonas_de_la_vela_elegida():
    """La página ofrece los niveles de sus VP fijos para la vela elegida y el motor los ordena con sus zonas: bajo el
    clic, la línea antes que la franja que la contiene. Vuelven con su `ref`; lo que no es una franja de precio, o no
    es del usuario, se descarta."""
    bars = flat(80)
    bars[70].update(h=106.0)
    offers = [{"ref": "r1|va", "kind": "vp", "lo": 107.0, "hi": 104.0}, {"ref": "r1|poc", "kind": "vp", "lo": 105.5, "hi": 105.5},
              {"ref": "r1|val", "kind": "vp", "lo": 104.0, "hi": 104.0}, {"ref": "lejos", "kind": "vp", "lo": 500.0, "hi": 500.0},
              {"ref": "mal", "kind": "vp", "lo": "x", "hi": 1}, {"ref": "ajena", "kind": "sr", "lo": 105.0, "hi": 105.0},
              {"ref": "cero", "kind": "draw", "lo": 0, "hi": 5}, "nada"]
    clean = kitchen.clean_offers(offers)
    assert [o["ref"] for o in clean] == ["r1|va", "r1|poc", "r1|val", "lejos"] and (clean[0]["lo"], clean[0]["hi"]) == (104.0, 107.0)
    assert kitchen.clean_offers(None) == [] and len(kitchen.clean_offers([offers[0]] * 99)) == kitchen.MAX_OFFERS
    ask = lambda **more: kitchen.evaluate("TEST", 60, rows(bars), None, view=80, pick=bars[70]["t"], **more)["candle"]["zones"]
    zones = [z for z in ask(pick_price=105.5, offers=offers) if "ref" in z]
    assert [z["ref"] for z in zones] == ["r1|poc", "r1|va", "r1|val"]        # El de 500 queda a más de 3 ATR: no se ofrece
    assert zones[0] == {"kind": "vp", "way": 0, "lo": 105.5, "hi": 105.5, "touch": True, "gapAtr": 0.0, "under": True, "ref": "r1|poc"}
    assert zones[1]["under"] and zones[1]["touch"] and (zones[1]["lo"], zones[1]["hi"]) == (104.0, 107.0)
    assert not zones[2]["under"] and zones[2]["touch"] and "from" not in zones[2]   # Desde cuándo cuenta lo pone la página
    assert [z for z in ask(pick_price=105.5) if "ref" in z] == []            # Sin oferta de la página, solo las del motor
    assert [z["ref"] for z in ask(offers=offers) if "ref" in z][0] == "r1|poc"   # Sin clic, por cercanía a la vela

class FakeFlow:
    """Un almacén de trades de mentira, con la firma de of_elements.detect: cada vela trae su delta, un «ST» cada 7
    velas y una «VA» cada 11, que se conoce una vela después. Como el de verdad, no da nada posterior a `known`."""

    def __init__(self):
        self.calls, self.hold, self.missing = [], None, set()

    @staticmethod
    def delta(t):
        return float((t // MS * 37) % 11 - 5)

    def __call__(self, symbol, tf, start, end, known, target, band_days, vol_filter, live=False):
        if self.hold is not None:
            self.hold.wait(10)
        self.calls.append((start, end, known))
        bars, events = [], []
        t = -(-start // MS) * MS
        while t <= end and t + MS <= known:
            k = t // MS
            if k not in self.missing:
                bars.append({"t": t, "delta": self.delta(t), "vol": 100.0})
                if k % 7 == 0:
                    events.append({"code": "ST", "t": t, "known": t + MS, "dir": 1 if k % 2 else -1})
                if k % 11 == 0 and t + 2 * MS <= known:
                    events.append({"code": "VA", "t": t, "known": t + 2 * MS, "dir": 1})
            t += MS
        return {"events": events, "bars": bars}


@pytest.fixture
def flow(monkeypatch):
    """Una moneda «FLOW» con almacén de mentira. Lo guardado en memoria no pasa de una prueba a otra."""
    fake = FakeFlow()
    monkeypatch.setattr(kitchen.oe, "detect", fake)
    monkeypatch.setattr(kitchen, "has_store", lambda symbol: symbol == "FLOW")
    kitchen._books.clear()
    kitchen._facts.clear()
    yield fake
    if fake.hold is not None:
        fake.hold.set()
    kitchen._books.clear()
    kitchen._facts.clear()


def ask(symbol, tf, candles, doc, **more):
    """Pregunta hasta que el order flow esté listo, como hace la página."""
    for _ in range(500):
        result = kitchen.evaluate(symbol, tf, candles, doc, **more)
        if not result["pending"]:
            return result
        time.sleep(0.02)
    raise AssertionError("El order flow no terminó")


def ready(bars, first=0):
    facts = kitchen.Facts("FLOW", 60, bars)
    facts.want_flow(first)
    assert facts.flow(30)["state"] == "ready"
    return facts


def test_el_order_flow_llega_despues_y_el_pedido_no_espera(flow, monkeypatch):
    flow.hold = threading.Event()                 # La detección queda detenida, como la primera vez de un tramo
    monkeypatch.setattr(kitchen, "FLOW_WAIT", 0.05)
    bars = walk(700)
    doc = {"side": "long", "ctx": [{"uid": "c", "id": "cvd", "p": {"n": 5}}],
           "gat": [{"mode": "any", "blocks": [{"uid": "g", "id": "ST"}, {"uid": "v", "id": "VH"}]}]}
    began = time.perf_counter()
    first = kitchen.evaluate("FLOW", 60, rows(bars), doc, view=300)
    assert time.perf_counter() - began < 5 and first["success"] and first["pending"]
    assert first["flow"]["state"] == "loading" and first["flow"]["done"] == 0 and first["flow"]["total"] == 4
    assert first["blocks"]["g"] == {"runs": [], "count": 0, "pending": "loading"} and first["blocks"]["c"]["pending"] == "loading"
    assert "pending" not in first["blocks"]["v"] and first["blocks"]["v"]["count"] > 0    # Lo que no es de order flow ya cuenta
    flow.hold.set()
    done = ask("FLOW", 60, rows(bars), doc, view=300)
    assert done["flow"] == {"state": "ready", "cover": 1.0} and "pending" not in done["blocks"]["g"]
    painted = [i + 400 for a, b in done["blocks"]["g"]["runs"] for i in range(a, b + 1)]
    assert painted == [i for i in range(400, 700) if i % 7 == 0 and i % 2]                # Los «ST» alcistas: a favor de un largo
    assert done["blocks"]["c"]["count"] > 0 and done["signals"]
    # Una moneda sin almacén: los bloques de order flow no cuentan y nadie queda esperando
    none = kitchen.evaluate("TEST", 60, rows(bars), doc, view=300)
    assert not none["pending"] and none["flow"] == {"state": "none"} and none["blocks"]["g"] == {"runs": [], "count": 0, "pending": "none"}
    # Sin bloques de order flow ni vela elegida, ni se pide
    assert kitchen.evaluate("FLOW", 60, rows(bars), {"gat": [{"blocks": [{"uid": "v", "id": "VH"}]}]}, view=300)["flow"] is None


def test_el_order_flow_no_mira_el_futuro(flow):
    """Con 900 velas o con 1,200, lo ya cerrado dice lo mismo. Y un bloque detectado con más velas no le adelanta nada a
    un pedido con menos, que es lo que pasa cuando la simulación retrocede."""
    bars = walk(1200)
    blocks = [kitchen.clean_block({"uid": "a", "id": "ST", "p": {"dir": way}}, "step") for way in ("favor", "contra")]
    blocks += [kitchen.clean_block({"uid": "b", "id": bid, "p": {"n": 9}}, "step") for bid in ("VA", "delta", "cvd")]

    def truths(count):
        facts = ready(bars[:count])
        return [facts.truth(block, side) for block in blocks for side in (1, -1)]

    long = truths(1200)    # Primero el pedido largo: sus bloques quedan en memoria
    short = truths(900)
    assert sum(int(t.sum()) for t in short) > 1000
    for a, b in zip(short, long):
        assert np.array_equal(a, b[:900])
    kitchen._books.clear()
    for a, b in zip(truths(900), short):    # Detectado de cero da lo mismo
        assert np.array_equal(a, b)
    # La «VA» de la vela 891 se conoce al cerrar la 892: ahí cuenta, no antes
    va = short[4]
    assert va[892] and not va[891]


def test_el_delta_y_el_cvd_salen_del_almacen_con_la_cuenta_del_probador(flow):
    bars = walk(400)
    facts = ready(bars)
    delta = np.array([flow.delta(b["t"]) for b in bars])
    block = kitchen.clean_block({"uid": "d", "id": "delta"}, "ctx")
    assert np.array_equal(facts.truth(block, 1), delta > 0) and np.array_equal(facts.truth(block, -1), delta < 0)
    run = np.array([delta[i - 5:i + 1].sum() if i >= 5 else 0.0 for i in range(400)])   # Seis velas, con la de la señal
    block = kitchen.clean_block({"uid": "c", "id": "cvd", "p": {"n": 6}}, "ctx")
    assert np.array_equal(facts.truth(block, 1), run > 0) and np.array_equal(facts.truth(block, -1), run < 0)
    # Lo que se ofrece al elegir una vela: la 301 (7 × 43, impar) trae un «ST» alcista; la 300, un delta de −4 sobre 100
    assert {"id": "ST", "p": {}, "d": 1, "late": 0} in facts.candidates(301)["events"]
    found = facts.candidates(300)
    assert delta[300] == -4 and {"id": "delta", "p": {}, "d": -1, "obs": {"share": 4.0}} in found["states"]
    assert [s["d"] for s in found["states"] if s["id"] == "cvd"] == [1 if delta[281:301].sum() > 0 else -1]


def test_donde_el_almacen_no_tiene_velas_el_order_flow_no_cuenta(flow):
    flow.missing = set(range(200, 240))
    bars = walk(400)
    facts = ready(bars)
    assert facts.flow()["cover"] == 0.9
    up = kitchen.clean_block({"uid": "d", "id": "delta"}, "ctx")
    assert not (facts.truth(up, 1) | facts.truth(up, -1))[200:240].any()
    run = kitchen.clean_block({"uid": "c", "id": "cvd", "p": {"n": 6}}, "ctx")
    both = facts.truth(run, 1) | facts.truth(run, -1)
    assert not both[200:245].any() and both[245:260].any()   # El CVD de seis velas vuelve cuando las seis tienen delta


def test_una_vela_nueva_vuelve_a_detectar_solo_el_ultimo_bloque(flow):
    bars = walk(701)
    doc = {"side": "long", "gat": [{"blocks": [{"uid": "g", "id": "ST"}]}]}
    ask("FLOW", 60, rows(bars[:700]), doc, view=300)
    assert sorted(call[0] for call in flow.calls) == [240 * MS, 360 * MS, 480 * MS, 600 * MS]   # Bloques de 5 días
    before = len(flow.calls)
    ask("FLOW", 60, rows(bars), doc, view=300)
    assert [call[0] for call in flow.calls[before:]] == [600 * MS]   # El que contiene la vela nueva
    ask("FLOW", 60, rows(bars), {**doc, "side": "short"}, view=300)
    assert len(flow.calls) == before + 1                             # Cambiar la estrategia no detecta nada


def test_un_dia_ilegible_del_almacen_se_dice_y_no_deja_la_cocina_esperando(flow, monkeypatch):
    def broken(*args, **more):
        raise OSError("día ilegible")
    monkeypatch.setattr(kitchen.oe, "detect", broken)
    bars = walk(400)
    doc = {"side": "long", "gat": [{"blocks": [{"uid": "g", "id": "ST"}]}]}
    result = None
    for _ in range(100):
        result = kitchen.evaluate("FLOW", 60, rows(bars), doc, view=200)
        if result["flow"]["state"] != "loading":
            break
        time.sleep(0.02)
    assert result["flow"]["state"] == "error" and "día ilegible" in result["flow"]["message"] and not result["pending"]
    assert result["blocks"]["g"]["pending"] == "error"


# ==================== El motor y la página ====================

def test_la_pagina_conoce_los_mismos_bloques_que_el_motor():
    if not CATALOG_JS.exists():
        pytest.skip("Sin la página a la vista")
    text = CATALOG_JS.read_text(encoding="utf-8")
    ids = set(re.findall(r"\bid: '([A-Za-z]+)'", text)) | set(re.findall(r"^\s{2}([A-Z]{2}): ", text, flags=re.M))
    listed = lambda name: set(re.findall(r"'([A-Za-z]+)'", (re.search(name + r" = \[(.*?)\]", text, flags=re.S) or [None, ""])[1]))
    ids |= listed("OF_ELEMENTS")
    wanted = set(kitchen.STATE_IDS + kitchen.LINE_EVENT_IDS + kitchen.ZONE_EVENT_IDS + kitchen.PAGE_EVENT_IDS + kitchen.EVENT_CODES)
    assert wanted <= ids, f"La página no conoce: {sorted(wanted - ids)}"
    catalog = kitchen.catalog()
    assert {b["id"] for b in catalog["states"] + catalog["events"]} == wanted
    # Las zonas y lo que sale del almacén de trades, igual en los dos lados
    assert listed("ZONE_KINDS") == set(kitchen.ZONE_KINDS) == set(catalog["zones"]["kinds"])
    assert listed("USER_ZONE_KINDS") == set(kitchen.USER_KINDS) == set(catalog["zones"]["user"])
    assert listed("OF_ELEMENTS") == set(kitchen.OF_CODES) == set(catalog["flow"]["events"])
    assert listed("FLOW_STATES") == set(kitchen.FLOW_STATE_IDS)


# ==================== Lo que calcula el gráfico, con los ajustes de la sesión (27/11) ====================

def test_una_linea_del_grafico_sirve_como_cualquier_linea():
    """El VWAP que manda la página (un valor por vela cerrada) se usa en «cierra de un lado», «lejos», «cruza» y «rebota»."""
    bars = walk(600)
    closes = [b["c"] for b in bars]
    line = [c * 0.99 for c in closes[-300:]]          # Siempre por debajo del cierre: el precio está encima
    doc = {"side": "long", "ctx": [{"uid": "a", "id": "side", "p": {"line": "p:vwap"}}], "gat": []}
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=300, page={"lines": {"vwap": line}})
    assert result["success"] and result["blocks"]["a"]["count"] == 300
    assert result["lines"]["p:vwap"][0] == pytest.approx(line[0])
    # Sin la línea en el pedido, el bloque no se cumple nunca
    empty = kitchen.evaluate("TEST", 60, rows(bars), doc, view=300)
    assert empty["blocks"]["a"]["count"] == 0
    # Y otra línea da otro resultado con las mismas velas: los cálculos no se mezclan
    above = kitchen.evaluate("TEST", 60, rows(bars), doc, view=300, page={"lines": {"vwap": [c * 1.01 for c in closes[-300:]]}})
    assert above["blocks"]["a"]["count"] == 0


def test_una_linea_del_grafico_solo_cuenta_donde_la_pagina_la_mando():
    bars = walk(600)
    line = [b["c"] * 0.99 for b in bars[-100:]]
    doc = {"side": "long", "ctx": [{"uid": "a", "id": "side", "p": {"line": "p:vwap"}}], "gat": []}
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=300, page={"lines": {"vwap": line}})
    assert result["blocks"]["a"]["count"] == 100 and result["blocks"]["a"]["runs"] == [[200, 299]]


def test_una_serie_de_un_panel_sube_o_esta_sobre_cero():
    bars = walk(400)
    series = [float(i) for i in range(-100, 100)]     # Sube siempre; pasa de negativa a positiva en la mitad
    doc = {"side": "long", "ctx": [{"uid": "up", "id": "psube", "p": {"s": "oi", "n": 5}}, {"uid": "pos", "id": "ppos", "p": {"s": "oi"}}], "gat": []}
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=200, page={"nums": {"oi": series}})
    assert result["blocks"]["up"]["count"] == 195      # Las 5 primeras no tienen con qué comparar
    assert result["blocks"]["pos"]["count"] == 99      # De 1 a 99
    short = kitchen.evaluate("TEST", 60, rows(bars), {**doc, "side": "short"}, view=200, page={"nums": {"oi": series}})
    assert short["blocks"]["up"]["count"] == 0 and short["blocks"]["pos"]["count"] == 100


def test_una_marca_del_grafico_es_un_evento_en_la_vela_con_que_se_conoce():
    bars = walk(400)
    marks = [[bars[-50]["t"], 1], [bars[-20]["t"], -1], [bars[-10]["t"], 0], [123, 1]]
    doc = {"side": "long", "gat": [{"blocks": [{"uid": "m", "id": "pmark", "p": {"s": "swing"}}]}]}
    result = kitchen.evaluate("TEST", 60, rows(bars), doc, view=200, pick=bars[-50]["t"], page={"marks": {"swing": marks}})
    assert result["blocks"]["m"]["runs"] == [[150, 150], [190, 190]]     # La alcista y la que no tiene lado
    assert any(e["id"] == "pmark" and e["p"] == {"s": "swing"} and e["d"] == 1 for e in result["candle"]["events"])


def test_la_vela_elegida_lista_lo_que_manda_la_pagina():
    bars = walk(400)
    page = {"lines": {"vwap": [b["c"] - 5 * (b["h"] - b["l"]) - 50 for b in bars[-100:]]}, "nums": {"oi": [float(i) for i in range(100)], "delta": [float(i) for i in range(-50, 50)]}}
    result = kitchen.evaluate("TEST", 60, rows(bars), {}, view=200, pick=bars[-3]["t"], page=page)
    states = result["candle"]["states"]
    assert any(s["id"] == "side" and s["p"]["line"] == "p:vwap" and s["d"] == 1 for s in states)
    assert any(s["id"] == "psube" and s["p"]["s"] == "oi" and s["d"] == 1 for s in states)
    # «Sobre cero» solo se ofrece en una serie que cambia de signo: el interés abierto siempre es positivo
    assert any(s["id"] == "ppos" and s["p"]["s"] == "delta" for s in states)
    assert not any(s["id"] == "ppos" and s["p"]["s"] == "oi" for s in states)


def test_un_bloque_del_grafico_sin_clave_valida_no_entra():
    assert kitchen.clean_block({"uid": "a", "id": "psube", "p": {"s": "OI; drop"}}, "ctx") is None
    assert kitchen.clean_block({"uid": "a", "id": "pmark", "p": {}}, "step") is None
    assert kitchen.clean_line("p:vwap_u1", "e50") == "p:vwap_u1" and kitchen.clean_line("p:../x", "e50") == "e50"


def test_un_nivel_de_un_indicador_es_una_zona_fija_como_un_dibujo():
    """Lo que se elige con un clic en el gráfico (una zona de liquidaciones, un POC, un borde de FVG) entra como franja
    fija: cuenta desde que se suma y no termina. Y se ordena con las zonas del motor en la vela elegida."""
    bars = walk(400)
    price = bars[-5]["c"]
    offers = kitchen.clean_offers([{"ref": "liq|1", "kind": "ind", "lo": price * 0.999, "hi": price * 1.001}])
    assert offers and offers[0]["kind"] == "ind"
    result = kitchen.evaluate("TEST", 60, rows(bars), {}, view=200, pick=bars[-5]["t"], pick_price=price, offers=offers)
    assert any(z.get("ref") == "liq|1" and z["under"] for z in result["candle"]["zones"])
    pick = kitchen.clean_pick({"uid": "z", "type": "one", "kind": "ind", "lo": price * 0.999, "hi": price * 1.001, "from": bars[-30]["t"]})
    assert pick is not None
    doc = {"zone": {"picks": [pick], "rel": "in"}, "gat": [{"blocks": [{"uid": "t", "id": "ztoca"}]}]}
    out = kitchen.evaluate("TEST", 60, rows(bars), doc, view=200)
    assert out["zone"]["picks"]["z"]["count"] == 1 and out["zone"]["picks"]["z"]["open"]


def test_los_tres_modos_del_interes_abierto_cada_uno_a_su_manera():
    """El histograma, con un umbral frente a lo típico; el flow, cuando cruza el cero o gira (pasa un máximo y empieza a
    bajar, o un mínimo y empieza a subir). El acumulado va con «sube o baja en N velas»."""
    bars = walk(500)
    hist = [1.0 if i % 2 else -1.0 for i in range(200)]
    hist[150], hist[170] = 9.0, -9.0                       # Dos valores muy grandes, uno de cada signo
    flow = [float(abs((i % 40) - 20) - 10) for i in range(200)]   # Dientes de sierra entre −10 y 10
    doc = {"side": "long", "gat": [{"mode": "any", "blocks": [
        {"uid": "big", "id": "pgrande", "p": {"s": "oi_hist", "k": 3}},
        {"uid": "cross", "id": "pcruza", "p": {"s": "oi_flow"}},
        {"uid": "turn", "id": "pgiro", "p": {"s": "oi_flow"}}]}]}
    page = {"nums": {"oi_hist": hist, "oi_flow": flow}}
    up = kitchen.evaluate("TEST", 60, rows(bars), doc, view=200, page=page)["blocks"]
    assert up["big"]["runs"] == [[150, 150]]               # Solo la subida grande: es un largo y va a favor
    assert up["turn"]["runs"] == [[21, 21], [61, 61], [101, 101], [141, 141], [181, 181]]   # Tras cada mínimo
    assert up["cross"]["count"] == 5                       # Cada vez que pasa de negativo a positivo
    down = kitchen.evaluate("TEST", 60, rows(bars), {**doc, "side": "short"}, view=200, page=page)["blocks"]
    assert down["big"]["runs"] == [[170, 170]]
    assert down["turn"]["runs"] == [[41, 41], [81, 81], [121, 121], [161, 161]]     # Tras cada máximo
    # Lo típico sale de las velas anteriores: un valor grande no cambia lo que se dijo antes de él
    longer = kitchen.evaluate("TEST", 60, rows(bars), doc, view=200, page={"nums": {"oi_hist": hist[:160] + [50.0] * 40, "oi_flow": flow}})["blocks"]
    assert longer["big"]["runs"][0] == [150, 150]


def test_los_detectores_calculan_con_los_ajustes_de_la_sesion():
    """Los ajustes del modal de cada indicador llegan al motor (27/11): cambian lo que cuenta, y sin ellos, o con los
    de fábrica, todo queda como antes. Dos ajustes distintos no se mezclan en lo guardado."""
    bars = walk(900)
    doc = {"side": "long", "zone": {"picks": [{"kind": "sr", "mode": "type"}]},
           "gat": [{"mode": "any", "blocks": [{"uid": code, "id": code} for code in ("EQ", "WD", "QA")]}]}
    def count(settings=None):
        out = kitchen.evaluate("TEST", 60, rows(bars), doc, view=600, settings=settings)
        return {**{uid: block["count"] for uid, block in out["blocks"].items()}, "zone": json.dumps(out.get("zone"), sort_keys=True)}
    base = count()
    assert count({}) == base and count({"sr": {"bars": 5, "cluster": 0.3}}) == base
    for name, settings, moves in (("smc", {"internal": 12, "swing": 60, "eqLength": 8}, "EQ"), ("wise", {"requireAo": False, "lookback": 3}, "WD"),
                                  ("vpa", {"legAtr": 4, "fire": 0.8}, "QA"), ("sr", {"bars": 12, "cluster": 1.5}, "zone")):
        moved = count({name: settings})
        assert moved[moves] != base[moves], name                                  # Cada familia toma los suyos
        assert all(moved[key] == base[key] for key in base if key != moves), name  # Y no toca a las demás
    assert count() == base                                          # Lo de fábrica no quedó contaminado
    clean = kitchen.clean_session({"smc": {"internal": 9, "x": [1]}, "otra": {"a": 1}, "sr": {"bars": 99, "cluster": "x"}})
    assert clean["smc"] == {"internal": 9} and "otra" not in clean and clean["sr"] == {"bars": 15, "cluster": 0.3}
