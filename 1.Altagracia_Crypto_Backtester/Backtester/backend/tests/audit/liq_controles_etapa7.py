"""
Protocolo (22/11/2026), etapa 7: las 28 corridas del usuario con el barrido de liquidaciones (LIQ, todas de BTC en la
fase 1), repetidas con el motor 6 y sus controles: el azar de la fase, seguir el tramo, el azar de su trimestre y lado
(B-07, con el margen por semanas, B-08) y el mismo gatillo tras barrer un swing sin liquidaciones (SWP, "¿Aportan las
liquidaciones?"). Dice si alguna pasaría ahora (las tres ventajas con margen sobre cero y R positivo) y si las
liquidaciones aportan con margen. No guarda corridas.

Uso (desde backend/): python -B tests/audit/liq_controles_etapa7.py
Escribe evidencia/etapa7/liq_controles.json
"""
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
import measures  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7")


def pick(d, *keys):
    return {k: (d or {}).get(k) for k in keys}


def edge_of(x):
    return None if not x else pick(x, "r", "low", "high")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = [r for r in rt.history(None, stale=True)
            if any("LIQ" in s.get("codes", []) for s in (r.get("rule") or {}).get("recipe", {}).get("slots", []))
            and not str(r["rule"].get("name", "")).startswith(("E-", "PRUEBA"))]  # Las de las etapas 3 a 6 no son del usuario
    out, started = [], time.time()
    for r in rows:
        old = rt.load_run(r["id"]) or {}
        rule = rt.clean_rule(r["rule"])
        phase = {"phase": r["phase"], "from": r["from"], "to": r["to"], "start": rt._ms(r["from"]), "end": rt._ms(r["to"]) + rt.oe.DAY_MS}
        span = rt.detect_span(r["symbol"], rule["tf"], phase, rule)
        new = rt.run(r["symbol"], rule, span, phase, measures.table_for(r["symbol"]) if rule.get("filters") else None, base=True)
        s = new.get("summary") or {}
        three = [new.get("edge"), new.get("legEdge"), new.get("quarterEdge")]
        passes = bool(s.get("n")) and (s.get("avgR") or 0) > 0 and all(e and e.get("low") is not None and e["low"] > 0 for e in three)
        ctl = new.get("control") or {}
        row = {"id": r["id"], "moneda": r["symbol"], "marco": rule["tf"], "fase": r["phase"], "nombre": rule.get("name"),
               "motor guardado": r.get("engine", 1),
               "guardada": {**pick(old.get("summary"), "n", "avgR"), "azar": edge_of(old.get("edge")), "tramo": edge_of(old.get("legEdge")),
                            "sin liquidaciones": edge_of((old.get("control") or {}).get("edge"))},
               "motor 6": {**pick(s, "n", "avgR"), "azar": edge_of(new.get("edge")), "tramo": edge_of(new.get("legEdge")),
                           "trimestre": edge_of(new.get("quarterEdge")),
                           "sin liquidaciones": {**pick(ctl, "n", "avgR"), "ventaja": edge_of(ctl.get("edge"))},
                           "embudo": new.get("skipped")},
               "pasa": passes,
               "aportan las liquidaciones": bool(ctl.get("edge") and ctl["edge"]["low"] > 0)}
        out.append(row)
        print(json.dumps(row, ensure_ascii=False), f"{time.time() - started:.0f} s", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "liq_controles.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
