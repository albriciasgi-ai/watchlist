"""
Protocolo (22/11/2026), etapa 4, sección 9.4: los controles al azar del probador.

  I-12   el azar y el tramo usan el stop, la salida y el lector de minutos de la regla (con los cambios documentados: a
         mercado, y el stop del elemento pasa a ATR con la distancia mediana); el azar, la misma proporción de lados;
         los dos entran solo donde dejan el régimen y los filtros de lado.
  Tramo  el zigzag del control del tramo no mira el futuro: su dirección en cada vela no cambia al cortar las velas.
  Cuenta cuántas entradas al azar quedan de verdad (la pantalla dice 3,000).
  H1     cuánto de la ventaja informada pone el filtro de línea: el azar de la app (que no copia VWAP, EMA ni horario)
         contra un azar que además los respeta.

Uso (desde backend/): python -B tests/audit/controles.py BTCUSDT [--fase 1]
"""
import argparse
import copy
import hashlib
import json
import math
import os
import random
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import numpy as np  # noqa: E402
import comparar as cmp  # noqa: E402
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\controles")
FV = dict(fv={"minAtr": 0.3})
B5 = {"recipe": {**rp.BASE_RECIPE, "slots": [{"codes": ["FV"], "group": 0}, {"codes": ["DJ"], "group": 0}], "mode": "threshold",
                 "min": 1, "window": 2}, "fv": {"minAtr": 0.6}, "lines": [{"type": "ema", "period": 50, "mode": "side"}],
      "flow": {"oi": "rise", "oiBars": 6, "oiPct": 2.0}}
I12_RULES = {
    "FVG 0.3 a mercado": dict(recipe=rp.recipe("FV"), **FV),
    "FVG 0.3, stop en la zona": dict(recipe=rp.recipe("FV"), stop={"type": "zone", "buffer": 0.1}, **FV),
    "FVG 0.3, régimen fuera": dict(recipe=rp.recipe("FV"), regime={"mode": "outside"}, **FV),
    "FVG 0.3, CVD 20 y OI sube": dict(recipe=rp.recipe("FV"), flow={"cvd": 20, "oi": "rise", "oiBars": 6, "oiPct": 2.0}, **FV),
    "Compresión con dos órdenes": dict(recipe=rp.recipe("CP"), entry={"type": "straddle", "from": "zone", "offset": 0.2, "expiry": 3}),
}
H1_RULES = {
    "B5: FVG 0.6 o doji en 2 velas, EMA 50 y OI subiendo": B5,
    "FVG 0.3 con EMA 50 a favor": dict(recipe=rp.recipe("FV"), lines=[{"type": "ema", "period": 50, "mode": "side"}], **FV),
    "FVG 0.3 con VWAP 200 a favor": dict(recipe=rp.recipe("FV"), lines=[{"type": "vwap", "period": 200, "mode": "side"}], **FV),
    "Flecha a favor del tramo con VWAP 200": dict(recipe=rp.recipe("RF"), rv={"arrow": "with"}, stop={"type": "atr", "atr": 2.0},
                                                  exit_={"targetR": 2.0}, lines=[{"type": "vwap", "period": 200, "mode": "side"}]),
    "Ruptura de caja con EMA 200 y CVD 20": dict(recipe=rp.recipe("BX"), bx={"maxHeight": 5.5}, lines=[{"type": "ema", "period": 200, "mode": "side"}],
                                                 flow={"cvd": 20}),
    "Impulso con EMA 200 y horario de Nueva York": dict(recipe=rp.recipe("IM"), lines=[{"type": "ema", "period": 200, "mode": "side"}],
                                                        hours={"on": True, "from": 810, "to": 1260, "weekdays": True}),
}


def make_rule(raw, tf=240):
    raw = copy.deepcopy(raw)
    return rp.rule("controles", tf, raw.pop("recipe"), **raw)


def i12(symbol, name, raw, phase_n):
    cap = cmp.capture(symbol, make_rule(raw), phase_n, base=True)
    rule, res = cap["rule"], cap["result"]
    rule_ctx_id = next((c["ctx"] for c in cap["calls"] if c["who"] == "rule"), None)
    ctx = cap["contexts"].get(rule_ctx_id)
    trades = res["trades"]
    expect = rt._random_rule(rule, trades) if trades else None
    out = {"regla": name, "trades": len(trades)}
    bad = []
    for who, test in (("azar", lambda c: c["sides"] is None), ("tramo", lambda c: c["sides"] is not None)):
        calls = [c for c in cap["calls"] if c["who"] == "control" and test(c)]
        done = [c for c in calls if c["out"] and "skip" not in c["out"] and not c["out"].get("open")]
        same_ctx = all(c["ctx"] == rule_ctx_id for c in calls)
        same_rule = all(c["rule"]["exit"] == expect["exit"] and c["rule"]["stop"] == expect["stop"] and c["rule"]["entry"] == expect["entry"]
                        for c in calls) if expect else None
        info = {"llamadas": len(calls), "trades hechos": len(done), "mismo contexto y lector de minutos": same_ctx,
                "misma regla que _random_rule": same_rule}
        if who == "azar" and calls and trades:
            p = sum(1 for t in trades if t["dir"] > 0) / len(trades)
            q = sum(1 for c in calls if c["side"] > 0) / len(calls)
            z = (q - p) / math.sqrt(p * (1 - p) / len(calls)) if 0 < p < 1 else 0.0
            info["largos de la regla"], info["largos del azar"], info["z"] = round(p, 3), round(q, 3), round(z, 2)
            if abs(z) > 3.5:
                bad.append(f"{who}: proporción de lados")
        if rule.get("regime") and ctx is not None:
            wrong = [c["k"] for c in calls if not bool(ctx["regimeOK"][c["k"]])]
            info["fuera del régimen"] = len(wrong)
            if wrong:
                bad.append(f"{who}: {len(wrong)} entradas fuera del régimen")
        if rt._sided(rule) and ctx is not None:
            wrong = [c["k"] for c in calls if not rt._side_ok(rule, ctx, c["k"], c["side"])]
            info["contra el filtro de lado"] = len(wrong)
            if wrong:
                bad.append(f"{who}: {len(wrong)} entradas contra el filtro de lado")
        if not same_ctx:
            bad.append(f"{who}: otro contexto")
        if same_rule is False:
            bad.append(f"{who}: otra regla")
        out[who] = info
    out["ok"] = not bad
    out["problemas"] = bad
    return out


def zigzag_sin_futuro(symbol, phase_n, cuts=6, seed=2026):
    rule = rt.clean_rule(make_rule(dict(recipe=rp.recipe("FV"), **FV)))
    phase = next(p for p in rt.phases(symbol) if p["phase"] == phase_n)
    bars = rt.detect_span(symbol, 240, phase, rule)["bars"]
    h, l, c = (np.array([b[key] for b in bars], dtype=float) for key in ("h", "l", "c"))
    full = measures.zigzag(h, l, c, measures.atr(h, l, c), measures.LEG_ATR)[0]
    rnd = random.Random(seed)
    out = []
    for cut in sorted(rnd.sample(range(len(bars) // 10, len(bars) * 9 // 10), cuts)):
        part = measures.zigzag(h[:cut], l[:cut], c[:cut], measures.atr(h[:cut], l[:cut], c[:cut]), measures.LEG_ATR)[0]
        diff = int(np.sum(np.asarray(part) != np.asarray(full[:cut])))
        out.append({"corte": cut, "velas distintas": diff})
    return {"cortes": out, "ok": all(x["velas distintas"] == 0 for x in out)}


def baseline_with_lines(rule, ctx, trades, symbol, seed_extra="lineas"):
    """Como el azar de la app (mismo stop, salida y lado), pero solo en velas y lados que dejan la línea y el horario."""
    n = len(ctx["T"])
    longs = sum(1 for t in trades if t["dir"] > 0) / len(trades)
    rng = random.Random(int(hashlib.sha1(f"{symbol}{rule['tf']}{n}{seed_extra}".encode()).hexdigest()[:8], 16))
    base_rule = rt._random_rule(rule, trades)
    light = {**ctx, "i0": None}
    allowed = rt._allowed(ctx, n)
    tf_ms = rule["tf"] * 60000
    done, tries = [], 0
    while len(done) < rt.BASE_TRADES and tries < rt.BASE_TRADES * 40:
        tries += 1
        k = int(allowed[rng.randrange(len(allowed))]) if allowed is not None and len(allowed) else rng.randrange(30, n - 2)
        side = 1 if rng.random() < longs else -1
        if rt._sided(rule) and not rt._side_ok(rule, ctx, k, side):
            continue
        if rule.get("lines") and not rt._lines_ok(rule["lines"], ctx, k, side):
            continue
        if rule.get("hours") and not rt._in_hours(rule["hours"], ctx["T"][k] + tf_ms):
            continue
        light["i0"] = k
        trade = rt.simulate(base_rule, light, k, side)
        if trade and "skip" not in trade and not trade.get("open"):
            done.append(trade)
    return rt.summary(done)


def baseline_stratified(rule, ctx, trades, symbol):
    """El azar con la proporción de lados de la regla también con filtros de lado: primero el lado, después una vela
    donde el filtro deje ese lado (la app sortea el lado y descarta, y el filtro deja más de un lado que del otro)."""
    n = len(ctx["T"])
    longs = sum(1 for t in trades if t["dir"] > 0) / len(trades)
    rng = random.Random(int(hashlib.sha1(f"{symbol}{rule['tf']}{n}estratos".encode()).hexdigest()[:8], 16))
    base_rule = rt._random_rule(rule, trades)
    light = {**ctx, "i0": None}
    allowed = rt._allowed(ctx, n)
    done = []
    for _ in range(rt.BASE_TRADES):
        side = 1 if rng.random() < longs else -1
        for _try in range(200):
            k = int(allowed[rng.randrange(len(allowed))]) if allowed is not None and len(allowed) else rng.randrange(30, n - 2)
            if rt._side_ok(rule, ctx, k, side):
                break
        else:
            continue
        light["i0"] = k
        trade = rt.simulate(base_rule, light, k, side)
        if trade and "skip" not in trade and not trade.get("open"):
            done.append(trade)
    s = rt.summary(done)
    s["largos"] = round(sum(1 for t in done if t["dir"] > 0) / len(done), 3) if done else None
    return s


def lados(symbol, name, raw, phase_n):
    rule = rt.clean_rule(make_rule(raw))
    phase = next(p for p in rt.phases(symbol) if p["phase"] == phase_n)
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    trace = {}
    res = rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=True, trace=trace)
    if not res.get("trades"):
        return {"regla": name, "trades": 0}
    s, app = res["summary"], res.get("baseline") or {}
    mine = baseline_stratified(rule, trace["ctx"], res["trades"], symbol)
    edge = lambda b: None if not b.get("n") else round(s["avgR"] - b["avgR"], 3)  # noqa: E731
    return {"regla": name, "trades": s["n"], "largos de la regla": round(sum(1 for t in res["trades"] if t["dir"] > 0) / s["n"], 3),
            "R": s["avgR"], "azar de la app": {"n": app.get("n"), "R": app.get("avgR"), "ventaja": edge(app)},
            "azar estratificado": {"n": mine.get("n"), "R": mine.get("avgR"), "largos": mine.get("largos"), "ventaja": edge(mine)}}


SIDED_RULES = {
    "FVG 0.3, CVD 20 y OI sube": dict(recipe=rp.recipe("FV"), flow={"cvd": 20, "oi": "rise", "oiBars": 6, "oiPct": 2.0}, **FV),
    "FVG 0.3, CVD 20": dict(recipe=rp.recipe("FV"), flow={"cvd": 20}, **FV),
    "FVG 0.3, OI sostenido": dict(recipe=rp.recipe("FV"), flow={"steady": True}, **FV),
    "FVG 0.3, multitud: no ir con ella": dict(recipe=rp.recipe("FV"), flow={"crowd": "nocon"}, **FV),
    "FVG 0.3, emisión 30 d a favor": dict(recipe=rp.recipe("FV"), flow={"chain": {"metric": "stable", "days": 30, "mode": "favor"}}, **FV),
    "B5: FVG 0.6 o doji en 2 velas, EMA 50 y OI subiendo": B5,
}


def h1(symbol, name, raw, phase_n):
    rule = rt.clean_rule(make_rule(raw))
    phase = next(p for p in rt.phases(symbol) if p["phase"] == phase_n)
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    trace = {}
    res = rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=True, trace=trace)
    if not res.get("trades"):
        return {"regla": name, "trades": 0}
    ctx = trace["ctx"]
    mine = baseline_with_lines(rule, ctx, res["trades"], symbol)
    s, app = res["summary"], res.get("baseline") or {}
    edge = lambda b: None if not b.get("n") else {"r": round(s["avgR"] - b["avgR"], 3), "margen": round(1.96 * math.sqrt(s["seR"] ** 2 + b["seR"] ** 2), 3)}  # noqa: E731
    return {"regla": name, "trades": s["n"], "R de la regla": s["avgR"],
            "azar de la app": {"n": app.get("n"), "R": app.get("avgR"), "ventaja": edge(app)},
            "azar con la línea y el horario": {"n": mine.get("n"), "R": mine.get("avgR"), "ventaja": edge(mine)}}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--solo", default="")
    a = ap.parse_args()
    rep = {"moneda": a.symbol, "fase": a.fase}
    if a.solo in ("", "i12"):
        rep["I-12"] = [i12(a.symbol, n, r, a.fase) for n, r in I12_RULES.items()]
        for x in rep["I-12"]:
            print(f"I-12 {x['regla']}: {'bien' if x['ok'] else '⚠ ' + '; '.join(x['problemas'])} · azar {x['azar']} · tramo {x['tramo']}", flush=True)
    if a.solo in ("", "tramo"):
        rep["tramo"] = zigzag_sin_futuro(a.symbol, a.fase)
        print("Tramo sin futuro:", "bien" if rep["tramo"]["ok"] else rep["tramo"], flush=True)
    if a.solo in ("", "lados"):
        rep["lados"] = [lados(a.symbol, n, r, a.fase) for n, r in SIDED_RULES.items()]
        for x in rep["lados"]:
            print(f"Lados {x['regla']}: {x.get('trades')} trades, largos {x.get('largos de la regla')}, R {x.get('R')} · app {x.get('azar de la app')} · estratificado {x.get('azar estratificado')}", flush=True)
    if a.solo in ("", "h1"):
        rep["H1"] = [h1(a.symbol, n, r, a.fase) for n, r in H1_RULES.items()]
        for x in rep["H1"]:
            print(f"H1 {x['regla']}: {x.get('trades')} trades, R {x.get('R de la regla')} · app {x.get('azar de la app')} · con la línea {x.get('azar con la línea y el horario')}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"controles_{a.symbol}_f{a.fase}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
