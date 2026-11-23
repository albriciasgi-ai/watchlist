"""
Protocolo (22/11/2026), etapa 6: cuántas señales y trades da cada regla de prueba de prioridad 2 (`reglas_prueba.STAGE6`)
en cada moneda, en su fase, sin los controles al azar. Sirve para decidir dónde se captura cada trade (capa C).

Uso (desde backend/): python -B tests/audit/contar_etapa6.py BTCUSDT,ARBUSDT [--fase 1] [--reglas E-QA,E-QB] [--salida nombre]
Escribe evidencia/etapa6/<salida>.json
"""
import argparse
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
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6")


def count(symbol, name, phase_number):
    rule = rt.clean_rule(rp.RULES[name])
    if rule is None:
        return {"error": "regla vacía"}
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    allowed = rt.codes_for(symbol, rule["tf"])  # None: todos (la moneda tiene almacén de trades)
    if allowed is not None and not codes <= set(allowed):
        return {"skip": "sin datos para " + ",".join(sorted(codes - allowed))}
    phase = next(p for p in rt.phases(symbol) if p["phase"] == phase_number)
    t0 = time.time()
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule.get("filters") else None
    res = rt.run(symbol, rule, span, phase, table, base=False)
    s = res.get("summary") or {}
    return {"trades": s.get("n"), "avgR": s.get("avgR"), "signals": res.get("signals"), "busy": res.get("busy"),
            "open": res.get("open"), "skipped": res.get("skipped"), "s": round(time.time() - t0, 1)}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols")
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--reglas", default="")
    ap.add_argument("--salida", default="conteo")
    a = ap.parse_args()
    names = [x for x in a.reglas.split(",") if x] or list(rp.STAGE6)
    OUT.mkdir(parents=True, exist_ok=True)
    out = {}
    for symbol in a.symbols.split(","):
        for name in names:
            try:
                got = count(symbol, name, a.fase)
            except Exception as e:  # una regla que falla no detiene a las demás
                got = {"error": repr(e)}
            out[f"{name}|{symbol}"] = got
            print(f"{name} {symbol} f{a.fase}: {got.get('trades', got)} trades, {got.get('signals')} señales, "
                  f"R {got.get('avgR')}, {got.get('s')} s", flush=True)
            (OUT / f"{a.salida}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
