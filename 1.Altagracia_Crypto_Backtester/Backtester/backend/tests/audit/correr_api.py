"""
Corre una regla de prueba en el backend AISLADO (9300) por su API, como lo haría la ventana, y espera la corrida.

Uso: python -B tests/audit/correr_api.py R01 ARBUSDT 1 [--confirmar]
Imprime el id de la corrida (para abrirla con ?probador=1&symbol=...&run=<id>).
"""
import json
import sys
import time
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reglas_prueba as rp  # noqa: E402

API = "http://127.0.0.1:9300"


def call(method, path, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run(name, symbol, phase, confirm=False, rule=None):
    rule = rule or rp.RULES[name]
    got = call("POST", f"/api/tester/run/{symbol}", {"rule": rule, "phase": phase, "confirm": confirm})
    if got.get("needsConfirm"):
        return {"needsConfirm": True, "gate": got.get("gate")}
    if got.get("run"):
        return {"run": got["run"], "stored": got.get("stored", False)}
    job = got.get("job")
    if not job:
        return {"error": got}
    while True:
        st = call("GET", f"/api/tester/job/{job}")["job"]
        if st["state"] == "done":
            return {"run": st["run"], "stored": False}
        if st["state"] == "error":
            return {"error": st["error"]}
        time.sleep(1.0)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    out = run(args[0], args[1], int(args[2]), "--confirmar" in args)
    print(json.dumps(out, ensure_ascii=False))
