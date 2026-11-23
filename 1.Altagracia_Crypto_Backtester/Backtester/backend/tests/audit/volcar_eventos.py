"""
Protocolo (22/11/2026), etapa 4: vuelca lo que el motor dice de las piezas de nivel B y C de prioridad 1, para
compararlo con sus indicadores en JavaScript (`comparar_js.mjs`), que tienen sus propias pruebas de paridad con Python:

- los eventos de RB (rombo), BX, BE y CP (cajas), QB (ruptura con volumen del VPA) y WD, WA y WF (los sabios), con sus
  parámetros de la regla de prueba y su info;
- las señales del FVG nuevo 0.3 (sin "una posición a la vez") y cuáles deja pasar el filtro de régimen en cada modo
  (dentro, fuera, tras romper; con y sin el rango mayor; en 4h y medido en 1D).

Uso (desde backend/): python -B tests/audit/volcar_eventos.py BTCUSDT [--tf 240] [--fase 1]
Escribe evidencia/elementos/volcado_<moneda>_<tf>_f<fase>.json
"""
import argparse
import copy
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")

# Reglas de un elemento: las de la etapa 4, y variantes para ver todos los eventos (sin tope de alto)
ELEMENT_RULES = {
    "RB": rp.rule("RB", 240, rp.recipe("RB")),
    "RB-sigue": rp.rule("RB sigue", 240, rp.recipe("RB"), rv={"rombo": "follow"}),
    "BX": rp.rule("BX", 240, rp.recipe("BX")),
    "BX-5.5": rp.RULES["E-BX"],
    "BE": rp.RULES["E-BE"],
    "CP": rp.rule("CP", 240, rp.recipe("CP")),
    "QB": rp.RULES["E-QB"],
    "W": rp.rule("W", 240, rp.recipe("WD", "WA", "WF", mode="threshold", minimum=1)),
}
REGIMES = {
    "dentro": {"mode": "inside"},
    "fuera": {"mode": "outside"},
    "tras": {"mode": "breakout"},
    "dentro-cajas": {"mode": "inside", "major": False},
    "fuera-cajas": {"mode": "outside", "major": False},
    "tras-cajas": {"mode": "breakout", "major": False},
    "dentro-1D": {"mode": "inside", "tf": 1440},
    "fuera-1D": {"mode": "outside", "tf": 1440},
    "tras-1D": {"mode": "breakout", "tf": 1440},
}


def engine_events(symbol, raw, tf, phase):
    rule = rt.clean_rule(copy.deepcopy({**raw, "tf": tf}))
    span = rt.detect_span(symbol, tf, phase, rule)
    ctx = rt._context(symbol, tf, span["bars"])
    ctx["bars"] = span["bars"]
    return rule, span, rt._extra_events(symbol, rule, span, ctx)


def regime_signals(symbol, tf, phase, extra):
    raw = {"recipe": rp.recipe("FV"), "fv": {"minAtr": 0.3}, **copy.deepcopy(extra)}
    rule = rt.clean_rule(rp.rule("régimen", tf, raw.pop("recipe"), oneAtATime=False, **raw))
    span = rt.detect_span(symbol, tf, phase, rule)
    trace = {}
    rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=False, trace=trace)
    return rule, [{"k": s["k"], "dir": s["dir"], "what": s.get("what")} for s in trace["signals"]]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=240)
    ap.add_argument("--fase", type=int, default=1)
    a = ap.parse_args()
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    out = {"moneda": a.symbol, "tf": a.tf, "fase": a.fase, "events": {}, "rules": {}, "regime": {}}
    for name, raw in ELEMENT_RULES.items():
        rule, span, evs = engine_events(a.symbol, raw, a.tf, phase)
        out["rules"][name] = rule
        out["events"][name] = evs
        if "bars" not in out:
            out["bars"] = [[b["t"], b["o"], b["h"], b["l"], b["c"], b.get("vol", b.get("v", 0))] for b in span["bars"]]
        print(name, len(evs), "eventos", flush=True)
    base_rule, base = regime_signals(a.symbol, a.tf, phase, {})
    out["regime"]["sin filtro"] = {"rule": base_rule, "signals": base}
    for name, regime in REGIMES.items():
        rule, sig = regime_signals(a.symbol, a.tf, phase, {"regime": regime})
        out["regime"][name] = {"rule": rule, "signals": sig}
        passed = sum(1 for s in sig if s["what"] != "filtro de régimen")
        print("régimen", name, rule.get("regime"), f"{passed} de {len(sig)} pasan", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"volcado_{a.symbol}_{a.tf}_f{a.fase}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, default=str), encoding="utf-8")
    print("->", path)


if __name__ == "__main__":
    main()
