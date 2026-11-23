"""
Medición del protocolo (21/11/2026), hallazgo H4: en la vela del llenado de una limit (u orden stop), el motor mide lo
"a favor" con toda la vela, también con lo que pasó antes del llenado. Con trailing o stop a la entrada, eso los
arranca con un precio anterior a la entrada.

Para cada trade de la corrida (los que quedaron, una posición a la vez) se repite su simulación con el oráculo A tal
cual (igual al motor) y con la variante h4 (en la vela del llenado, solo los minutos posteriores al llenado), y se
listan los que cambian. No vuelve a elegir los trades: si un trade cambia de salida, los siguientes podrían cambiar
también; eso no se cuenta aquí.

Uso: python -B tests/audit/medir_h4.py R05e ARBUSDT 1
"""
import json
import os
import sys
import datetime as dt
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import comparar as cmp  # noqa: E402
import reglas_prueba as rp  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\motor")


def utc(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M") if ms else None


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    name, symbol, phase = argv[0], argv[1], int(argv[2])
    cap = cmp.capture(symbol, rp.RULES[name], phase, base=False)
    trades = cap["result"]["trades"]
    calls = [c for c in cap["calls"] if c["who"] == "rule" and c["out"] and "skip" not in c["out"] and not c["out"].get("open")]
    # Cada señal (su vela y su lado) tiene una sola llamada; la hora de entrada se puede repetir entre señales
    by_signal = {(int(cap["contexts"][c["ctx"]]["T"][c["k"]]), c["out"]["dir"]): c for c in calls}
    rows, delta = [], 0.0
    for t in trades:
        call = by_signal.get((int(t["signal"]), t["dir"]))
        if call is None:
            rows.append({"n": t["n"], "error": "sin su llamada"})
            continue
        base = cmp.replay_call(cap, call)
        alt = cmp.replay_call(cap, call, {"h4": True})
        if abs(base["r"] - t["r"]) > 1e-9:
            rows.append({"n": t["n"], "error": f"el oráculo no repite el trade ({base['r']} contra {t['r']})"})
            continue
        if abs(alt["r"] - base["r"]) > 1e-9 or alt.get("reason") != base.get("reason"):
            delta += alt["r"] - base["r"]
            rows.append({"n": t["n"], "entrada": utc(t["entry_t"]), "lado": "largo" if t["dir"] > 0 else "corto",
                         "motor": {"r": round(base["r"], 3), "salida": base.get("reason"), "hora": utc(base.get("exit_t")), "mfe": t.get("mfe")},
                         "h4": {"r": round(alt["r"], 3), "salida": alt.get("reason"), "hora": utc(alt.get("exit_t"))}})
    errors = [r for r in rows if "error" in r]
    changed = [r for r in rows if "error" not in r]
    rep = {"rule": name, "symbol": symbol, "phase": phase, "trades": len(trades), "changed": len(changed),
           "sum_delta_r": round(delta, 4), "avgR_motor": cap["result"]["summary"]["avgR"],
           "avgR_h4": round((sum(t["r"] for t in trades) + delta) / len(trades), 4) if trades else None,
           "rows": rows}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"h4_{name}_{symbol}_f{phase}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{name} {symbol} f{phase}: {len(trades)} trades; cambian con h4: {len(changed)}; suma {delta:+.3f} R; "
          f"R por trade {rep['avgR_motor']} -> {rep['avgR_h4']}; errores {len(errors)}")
    for r in changed:
        print(f"  #{r['n']} {r['lado']} {r['entrada']}: motor {r['motor']['r']:+.3f} R ({r['motor']['salida']}, {r['motor']['hora']}) "
              f"-> h4 {r['h4']['r']:+.3f} R ({r['h4']['salida']}, {r['h4']['hora']})")
    for r in errors:
        print(f"  #{r['n']}: {r['error']}")


if __name__ == "__main__":
    main(sys.argv[1:])
