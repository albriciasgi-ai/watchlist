"""
Medición del protocolo (21/11/2026): una regla invertida con entrada limit en la zona del elemento. La zona queda del
lado contrario al trade (el FVG bajista está arriba y el trade invertido es un largo), así que la limit "cercana",
"mitad" o "lejana" nunca espera: entra a mercado. ¿Es la misma corrida que la regla invertida a mercado, trade por trade?

Uso: python -B tests/audit/medir_invertida_limit.py ARBUSDT 1 [near|mid|far]
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))

import rule_tester as rt  # noqa: E402
import measures  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\motor")
KEYS = ("dir", "signal", "entry_t", "entry", "stop", "target", "exit_t", "exit", "reason", "r", "order")


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    symbol, phase_number = argv[0], int(argv[1])
    at = argv[2] if len(argv) > 2 else "near"
    sys.path.insert(0, str(HERE))
    import reglas_prueba as rp
    base = rp.RULES["R05d"]
    variants = {
        "limit": rt.clean_rule({**base, "entry": {"type": "limit", "at": at, "expiry": 8}}),
        "mercado": rt.clean_rule({**base, "entry": {"type": "market", "at": at, "expiry": 8}}),
    }
    phase = next(p for p in rt.phases(symbol) if p["phase"] == phase_number)
    table = measures.table_for(symbol)
    out = {}
    for name, rule in variants.items():
        span = rt.detect_span(symbol, rule["tf"], phase, rule)
        res = rt.run(symbol, rule, span, phase, table, base=False)
        out[name] = [{k: t.get(k) for k in KEYS} for t in res.get("trades") or []]
    a, b = out["limit"], out["mercado"]
    same = len(a) == len(b) and all({k: x[k] for k in KEYS if k != "order"} == {k: y[k] for k in KEYS if k != "order"}
                                    for x, y in zip(a, b))
    orders = sorted({t["order"] for t in a})
    rep = {"symbol": symbol, "phase": phase_number, "at": at, "trades_limit": len(a), "trades_mercado": len(b),
           "identicas": same, "ordenes_de_la_limit": orders,
           "avgR_limit": round(sum(t["r"] for t in a) / len(a), 4) if a else None,
           "avgR_mercado": round(sum(t["r"] for t in b) / len(b), 4) if b else None}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"invertida_limit_{symbol}_f{phase_number}_{at}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(rep, ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
