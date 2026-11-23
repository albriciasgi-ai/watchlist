"""
Protocolo (22/11/2026), etapa 7: las corridas del usuario con el barrido de liquidaciones (LIQ), repetidas con el motor 6
(F-16: el ancho de las franjas ya no mira celdas del futuro; H23: el barrido de zona se desarma; y lo demás del motor 6).
Compara cada una con la guardada: trades, R medio y cuántos trades son los mismos (por su señal y su lado).

Uso (desde backend/): python -B tests/audit/liq_etapa7.py
Escribe evidencia/etapa7/liq_corridas.json
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
            and not str(r["rule"].get("name", "")).startswith("E-")]  # Las de la etapa 6 no son del usuario
    out, started = [], time.time()
    for r in rows:
        old = rt.load_run(r["id"])
        rule = rt.clean_rule(r["rule"])
        phase = {"phase": r["phase"], "from": r["from"], "to": r["to"], "start": rt._ms(r["from"]), "end": rt._ms(r["to"]) + rt.oe.DAY_MS}
        span = rt.detect_span(r["symbol"], rule["tf"], phase, rule)
        new = rt.run(r["symbol"], rule, span, phase, measures.table_for(r["symbol"]) if rule.get("filters") else None, base=False)
        a = {(t["signal"], t["dir"]) for t in (old or {}).get("trades") or []}
        b = {(t["signal"], t["dir"]) for t in new.get("trades") or []}
        row = {"id": r["id"], "moneda": r["symbol"], "marco": rule["tf"], "fase": r["phase"], "nombre": rule.get("name"),
               "motor guardado": r.get("engine", 1),
               "guardada": {"trades": len(a), "R": ((old or {}).get("summary") or {}).get("avgR")},
               "motor 6": {"trades": len(b), "R": (new.get("summary") or {}).get("avgR")},
               "mismos": len(a & b), "solo guardada": len(a - b), "solo motor 6": len(b - a)}
        out.append(row)
        print(json.dumps(row, ensure_ascii=False), f"{time.time() - started:.0f} s", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "liq_corridas.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
