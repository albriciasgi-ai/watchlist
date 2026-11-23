"""
Protocolo (22/11/2026), etapa 7, pruebas adicionales 1 y 2: las corridas de la galería de elementos (una regla de un
elemento por cada elemento que más usas, en BTC fase 1) y la de dos trades en la misma vela (R05a), con el motor 6 en
la copia aislada (POST /api/tester/run/BTCUSDT, una tras otra). Guarda el id de cada corrida para las capturas.

Uso (desde backend/): python -B tests/audit/galeria_corridas.py
Escribe evidencia/etapa7/galeria_corridas.json
"""
import copy
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import reglas_prueba as rp  # noqa: E402

API = "http://127.0.0.1:9300"
OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7")
# (clave, regla de prueba, título de la galería); en el orden de lo que más usas
GALLERY = [
    ("BX", "E-BX", "Ruptura de caja"), ("FV", "R01", "FVG nuevo"), ("RF", "E-RF", "Flecha del volumen de respuesta"),
    ("DJ", "E-DJ", "Doji"), ("QB", "E-QB", "Ruptura con volumen (VPA)"), ("IM", "E-IM", "Impulso"),
    ("WA", "E-WA", "AO tres barras"), ("WD", "E-WD", "Barra divergente"), ("WF", "E-WF", "Ruptura de fractal"),
    ("ST", "E-ST", "Desequilibrios apilados"), ("SP", "E-SP", "Swing"), ("VH", "E-VH", "Volumen alto"),
    ("VE", "E-VE", "Extremo del valor"), ("LIQz", "E-LIQz", "Barrido de la zona de liquidaciones"),
    ("LIQs", "E-LIQs", "Barrido de un swing en una zona de liquidaciones"),
]
EXTRA = [("R05a", "R05a", "Dos trades en la misma vela (limit)")]


def call(method, path, body=None, timeout=300):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    out = {}
    for key, name, title in EXTRA + GALLERY:
        rule = copy.deepcopy(rp.RULES[name])
        t0 = time.time()
        res = call("POST", "/api/tester/run/BTCUSDT", {"rule": rule, "phase": 1, "confirm": True})
        run = res.get("run") or (res.get("result") or {}).get("id")
        if res.get("job"):
            while True:
                time.sleep(4)
                j = (call("GET", f"/api/tester/job/{res['job']}").get("job") or {})
                if j.get("state") not in ("running", None):
                    break
            run = j.get("run")
            if j.get("state") != "done":
                print(key, "falló:", j.get("error"), flush=True)
        detail = call("GET", f"/api/tester/result/{run}") if run else {}
        result = detail.get("result") or detail
        s = result.get("summary") or {}
        out[key] = {"rule": name, "title": title, "run": run, "tf": rule["tf"], "trades": s.get("n"),
                    "skipped": result.get("skipped"), "signals": result.get("signals")}
        print(key, name, run, s.get("n"), "trades", f"{time.time() - t0:.0f} s", flush=True)
        (OUT / "galeria_corridas.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
