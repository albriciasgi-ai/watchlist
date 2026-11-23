"""
Protocolo (22/11/2026), etapa 7: qué parte del cambio de las 28 corridas LIQ del usuario es el tope de la comisión (H18)
y qué parte lo demás del motor 6 (F-16, H23, H15 y el resto): cada una con el motor 6 sin el tope (maxFeeR 0) y con él.

Uso (desde backend/): python -B tests/audit/liq_atribucion_etapa7.py
Escribe evidencia/etapa7/liq_atribucion.json
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


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    rows = [r for r in rt.history(None, stale=True)
            if any("LIQ" in s.get("codes", []) for s in (r.get("rule") or {}).get("recipe", {}).get("slots", []))
            and not str(r["rule"].get("name", "")).startswith(("E-", "PRUEBA"))]
    out, started = [], time.time()
    for r in rows:
        old = rt.load_run(r["id"]) or {}
        rule = rt.clean_rule(r["rule"])
        phase = {"phase": r["phase"], "from": r["from"], "to": r["to"], "start": rt._ms(r["from"]), "end": rt._ms(r["to"]) + rt.oe.DAY_MS}
        span = rt.detect_span(r["symbol"], rule["tf"], phase, rule)
        table = measures.table_for(r["symbol"]) if rule.get("filters") else None
        row = {"id": r["id"], "marco": rule["tf"], "guardada": {k: (old.get("summary") or {}).get(k) for k in ("n", "avgR")}}
        for label, cap in (("motor 6 sin el tope", 0), ("motor 6", None)):
            variant = dict(rule) if cap is None else {**rule, "maxFeeR": cap}
            res = rt.run(r["symbol"], variant, span, phase, table, base=False)
            s = res.get("summary") or {}
            row[label] = {"n": s.get("n"), "avgR": s.get("avgR"), "señales": res.get("signals"),
                          "comisión": (res.get("skipped") or {}).get("comisión muy alta para el riesgo", 0)}
        out.append(row)
        print(json.dumps(row, ensure_ascii=False), f"{time.time() - started:.0f} s", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "liq_atribucion.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
