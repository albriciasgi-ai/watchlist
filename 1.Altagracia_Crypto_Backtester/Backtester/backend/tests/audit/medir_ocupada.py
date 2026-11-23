"""
Medición del protocolo (21/11/2026), hallazgo H15: "una posición a la vez" se cuenta distinto según la entrada.

- A mercado (`run`, línea `k < busy_until`): se salta la señal si su vela es la vela en que salió el trade anterior,
  aunque al cerrar esa vela (cuando la regla decide) el trade ya salió.
- Con limit, orden stop o dos órdenes (`defer`): se salta solo si el llenado cae en la vela de la salida o antes.

Para medir el efecto sin cambiar la app, se carga en memoria una copia de rule_tester.py en la que la entrada a
mercado también va por `defer` (la regla de las limit), y se comparan las dos corridas de la misma regla, sin controles.
El archivo de la app no se toca.

Uso: python -B tests/audit/medir_ocupada.py R01 240 1 ARBUSDT,SUIUSDT,BTCUSDT
"""
import importlib.util
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

import rule_tester as rt  # noqa: E402
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\motor")
ORIGINAL = 'defer = rule["oneAtATime"] and rule["entry"]["type"] in ("limit", "straddle", "stop")'
PATCHED = 'defer = rule["oneAtATime"] and rule["entry"]["type"] in ("limit", "straddle", "stop", "market")'


def patched_engine():
    path = Path(rt.__file__).resolve()
    src = path.read_text(encoding="utf-8")
    if src.count(ORIGINAL) != 1:
        raise SystemExit("No se encontró la línea de defer: el motor cambió")
    spec = importlib.util.spec_from_loader("rule_tester_ocupada", loader=None)
    mod = importlib.util.module_from_spec(spec)
    mod.__dict__["__file__"] = str(path)
    exec(compile(src.replace(ORIGINAL, PATCHED), str(path), "exec"), mod.__dict__)
    return mod


def summary(trades):
    n = len(trades)
    total = sum(t["r"] for t in trades)
    return {"n": n, "avgR": round(total / n, 4) if n else None, "totalR": round(total, 2)}


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    name, tf, phase_number = argv[0], int(argv[1]), int(argv[2])
    symbols = argv[3].split(",")
    alt = patched_engine()
    rows = []
    for symbol in symbols:
        rule = rt.clean_rule({**rp.RULES[name], "tf": tf})
        phase = next((p for p in rt.phases(symbol) if p["phase"] == phase_number), None)
        if phase is None or not phase["available"]:
            print(f"{symbol}: sin la fase {phase_number}")
            continue
        span = rt.detect_span(symbol, tf, phase, rule)
        table = measures.table_for(symbol)
        a = rt.run(symbol, rule, span, phase, table, base=False)
        b = alt.run(symbol, rule, span, phase, table, base=False)
        if not a.get("success") or not b.get("success"):
            print(f"{symbol}: {a.get('message') or b.get('message')}")
            continue
        sa, sb = summary(a["trades"]), summary(b["trades"])
        ka = {t["signal"] for t in a["trades"]}
        kb = {t["signal"] for t in b["trades"]}
        row = {"symbol": symbol, "signals": a["signals"], "app": {**sa, "busy": a["busy"]}, "salida_antes": {**sb, "busy": b["busy"]},
               "solo_app": len(ka - kb), "solo_salida_antes": len(kb - ka)}
        rows.append(row)
        print(f"{symbol}: señales {a['signals']} · app {sa['n']} trades, {sa['avgR']} R, ocupadas {a['busy']} · "
              f"contando la salida antes de decidir {sb['n']} trades, {sb['avgR']} R, ocupadas {b['busy']} · "
              f"distintos {len(ka - kb)}/{len(kb - ka)}")
    tot = {k: sum(r[k]["n"] for r in rows) for k in ("app", "salida_antes")}
    rep = {"rule": name, "tf": tf, "phase": phase_number, "rows": rows, "trades": tot}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"ocupada_{name}_{tf}_f{phase_number}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print("total de trades:", tot)


if __name__ == "__main__":
    main(sys.argv[1:])
