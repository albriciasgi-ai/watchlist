"""
Protocolo (21/11/2026), R13c y R13d: la caja del borde de caja (BE) y el order block (OB) con su objetivo, contra las
implementaciones del navegador.

- OB: `computeSmc` de smcStructure.js (otra implementación, la del indicador) sobre las velas del motor, con la
  configuración SMC de la regla. Según la documentación, el OB "nace con la ruptura y su zona es el OB"; el objetivo
  `weak` es "el máximo (largo) o el mínimo (corto) del rango mayor en la vela de la señal".
- BE: la caja de la eficiencia con caja con `erBox` de regimeDetectors.js; el objetivo `mid` es el centro de la caja;
  la zona del borde, la franja de la caja del lado del borde. La regla de la llegada (filtros de cuerpo y cierre) no
  está escrita en la documentación: aquí se comprueba la caja, la zona, que la vela de la señal llegue a ella, el
  objetivo y el stop.
El stop es el borde lejano de la zona más `buffer` ATR (media simple de 14 rangos), o `atr` ATR desde la entrada.

Uso: python -B tests/audit/smc_box_check.py <id de la corrida> [<id> ...]
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
IND = HERE.parents[2] / "frontend" / "src" / "components" / "indicators"
OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\capa_a")


def check(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    rule = res["rule"]
    phase = int(run_id.split("_f")[1].split("_")[0])
    cap = comparar.capture(res["symbol"], rule, phase=phase, base=False)
    ctx = cap["contexts"][next(c for c in cap["calls"] if c["who"] == "rule")["ctx"]]
    import regime_detectors as rd  # solo los parámetros afinados de la caja (datos), para pasárselos a erBox
    data = {"run": run_id, "rule": rule, "signals": res.get("signals"), "erBox": rd.PARAMS["er_box"]["params"],
            "T": [float(x) for x in ctx["T"]], "O": [float(x) for x in ctx["O"]], "H": [float(x) for x in ctx["H"]],
            "L": [float(x) for x in ctx["L"]], "C": [float(x) for x in ctx["C"]],
            "trades": [{k: t.get(k) for k in ("n", "dir", "signal", "entry_t", "entry", "stop", "target", "zone", "box", "reason")} for t in res["trades"]]}
    path = OUT / f"smc_box_{run_id}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    node = subprocess.run(["node", str(HERE / "smc_box_check.mjs"), str(path), str(IND)], capture_output=True, text=True, encoding="utf-8")
    print(node.stdout.rstrip())
    if node.returncode:
        print(node.stderr.rstrip())


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for rid in sys.argv[1:]:
        check(rid)
