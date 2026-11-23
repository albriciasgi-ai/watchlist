"""
Protocolo (21/11/2026), R11: la salida VPA (exit.vpa) comprobada aparte.

Los oráculos de la capa A reciben del motor el mapa de avisos (`ctx["vpaExit"]`): comprueban cómo sale el trade con
esos avisos, no si los avisos son los que pide la documentación. Aquí se rearma ese mapa con el lector VPA del
navegador (frontend/src/components/indicators/vpa.js, otra implementación, en node) sobre las MISMAS velas del motor,
con lo que dice la documentación (CLAUDE.md de App 1, "Fase 4: salida VPA"):
  climax  clímax o frenado (QC, QS) en contra del lado del trade
  absorb  esfuerzo sin resultado en contra (contra el color de la vela; en un doji, contra el tramo)
  push    retroceso con volumen: vela validada del color contrario al trade
  meter   el medidor en contra, a thr o más
  fade    el esfuerzo se agota en un tramo del lado del trade
con el grado `fire` del lector, en ese orden si caen en la misma vela. Se compara vela por vela y lado por lado con el
mapa del motor, y después cada trade de la corrida guardada con una salida recalculada con ese mapa: stop u objetivo
dentro de la vela primero; si no, al cierre de la vela, el aviso si el trade ya llegó a fromR a favor; sale en la
apertura de la siguiente.

Uso: python -B tests/audit/vpa_exit_check.py <id de la corrida> [<id> ...]
"""
import gzip
import json
import os
import subprocess
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import comparar  # noqa: E402

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"
VPA_JS = HERE.parents[2] / "frontend" / "src" / "components" / "indicators" / "vpa.js"
OUT = Path(os.environ.get("AUDIT_TMP", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\capa_a"))


def _list(x):
    return [float(v) for v in x]


def check(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    symbol, rule = res["symbol"], res["rule"]
    phase = int(run_id.split("_f")[1].split("_")[0])
    cap = comparar.capture(symbol, rule, phase=phase, base=False)
    rule_calls = [c for c in cap["calls"] if c["who"] == "rule"]
    ctx = cap["contexts"][rule_calls[0]["ctx"]]
    again = [(t["entry_t"], t["exit_t"], t["reason"], round(t["r"], 9)) for t in cap["result"]["trades"]]
    saved = [(t["entry_t"], t["exit_t"], t["reason"], round(t["r"], 9)) for t in res["trades"]]
    engine = {str(side): {str(i): why for i, why in (ctx.get("vpaExit") or {}).get(side, {}).items()} for side in (1, -1)}
    data = {
        "run": run_id, "tf": ctx["tf"], "T": _list(ctx["T"]), "O": _list(ctx["O"]), "H": _list(ctx["H"]), "L": _list(ctx["L"]),
        "C": _list(ctx["C"]), "V": _list(ctx["V"]), "vpaCfg": rule.get("vpa") or {}, "exitVpa": rule["exit"]["vpa"],
        "engine": engine,
        "trades": [{k: t.get(k) for k in ("n", "dir", "entry_t", "exit_t", "reason", "entry", "stop", "target", "risk", "exit")}
                   for t in res["trades"]],
    }
    path = OUT / f"vpa_exit_{run_id}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    print(f"{run_id}: la corrida repetida da {'los mismos' if again == saved else 'OTROS'} {len(again)} trades "
          f"(guardada: {len(saved)}); velas del motor: {len(data['T'])}; avisos del motor: largos {len(engine['1'])}, cortos {len(engine['-1'])}")
    node = subprocess.run(["node", str(HERE / "vpa_exit_check.mjs"), str(path), str(VPA_JS)], capture_output=True, text=True,
                          encoding="utf-8")
    print(node.stdout.rstrip())
    if node.returncode:
        print(node.stderr.rstrip())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for rid in sys.argv[1:]:
        check(rid)
