"""
Protocolo (22/11/2026), etapa 6: volcado del barrido de liquidaciones (LIQ) para liq_check.mjs.

Corre en el motor las reglas de prueba E-LIQs (barrido de un swing dentro de una zona) y E-LIQz (barrido de la zona de
lado a lado) en una moneda y fase (rule_tester.run(..., trace={}), solo para leer sus eventos y trades) y escribe:
- las velas de la regla que usa el motor (rule_tester.detect_span(...)["bars"]): [t, o, h, l, c];
- cada evento LIQ (lado, hora, zona e `info`, con las zonas que guardó) y cada trade (con `liq`);
- las fuentes de liquidaciones como las entrega el backend al navegador (liq_store.coverage: tramos y ancho de celda),
  en su orden de prioridad, y el archivo de cada una (liq_store.LIQ_DIR), para que liq_check.mjs lea los mismos datos.
No calcula zonas ni barridos: eso lo hace liq_check.mjs con liquidationZones.js.

Uso (desde backend/): python -B tests/audit/liq_volcado.py <MONEDA> <archivo de salida.json> [--fase 1] [--reglas E-LIQs,E-LIQz]
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
import liq_store  # noqa: E402  (solo para saber qué archivos y fuentes lee el motor)
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402  (solo para correr la regla y leer sus velas, eventos y trades)


def dump_rule(symbol, name, phase, span):
    rule = rt.clean_rule(rp.RULES[name])
    t0 = time.time()
    tr = {}
    res = rt.run(symbol, rule, span, phase, None, base=False, trace=tr)
    events = [{"dir": e["dir"], "t": e["t"], "known": e["known"], "lo": e["lo"], "hi": e["hi"], "info": e["info"]}
              for e in tr["events"] if e["code"] == "LIQ"]
    trades = [{k: t.get(k) for k in ("n", "dir", "signal", "known", "entry_t", "entry", "stop", "zone", "liq")} for t in res.get("trades") or []]
    signals = [{"t": span["bars"][s["k"]]["t"], "dir": s["dir"], "what": s.get("what")} for s in tr.get("signals") or []]
    print(f"  {name}: {len(events)} eventos, {len(signals)} señales, {len(trades)} trades, {time.time() - t0:.1f} s", flush=True)
    return {"regla": name, "liq": rule.get("liq"), "stop": rule["stop"], "invert": rule["invert"], "eventos": events,
            "señales": signals, "trades": trades}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("salida")
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--reglas", default="E-LIQs,E-LIQz")
    a = ap.parse_args()
    names = a.reglas.split(",")
    tf = rt.clean_rule(rp.RULES[names[0]])["tf"]
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    span = rt.detect_span(a.symbol, tf, phase, rt.clean_rule(rp.RULES[names[0]]))
    print(f"{a.symbol} {tf}m f{a.fase}: {len(span['bars'])} velas", flush=True)
    files = {s["id"]: str(liq_store.LIQ_DIR / s["file"].format(symbol=a.symbol)) for s in liq_store.SOURCES}
    out = {
        "moneda": a.symbol, "tf": tf, "fase": a.fase, "desde": phase["from"], "hasta": phase["to"],
        "fuentes": liq_store.coverage(a.symbol),
        "archivos": {s["id"]: files[s["id"]] for s in liq_store.coverage(a.symbol)},
        "velas": [[b["t"], b["o"], b["h"], b["l"], b["c"]] for b in span["bars"]],
        "reglas": [dump_rule(a.symbol, name, phase, span) for name in names],
    }
    Path(a.salida).write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), default=str), encoding="utf-8")
    print(f"→ {a.salida}")


if __name__ == "__main__":
    main()
