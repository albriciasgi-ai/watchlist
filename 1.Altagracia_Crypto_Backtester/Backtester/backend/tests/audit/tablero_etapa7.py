"""
Protocolo (22/11/2026), etapa 7, prueba adicional 5: tus estrategias que llegaron a la fase 2 o 3, corridas otra vez con el
motor 6 en la copia aislada, como lo hace la app: "Correr en todas las monedas" (POST /api/tester/run-all) por cada
grupo y fase que tenían, y una sola moneda donde corriste solo una. Al final guarda el tablero nuevo
(GET /api/tester/strategies). Todo va al backend aislado (9300) y a su copia del registro, nunca al tuyo.

Uso (desde backend/): python -B tests/audit/tablero_etapa7.py RUTA_estrategias_serias.json
Escribe evidencia/etapa7/tablero.log y evidencia/etapa7/tablero.json
"""
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
import rule_tester as rt  # noqa: E402

API = "http://127.0.0.1:9300"
OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7")
FIRST = ("B5.", "Ruptura de caja con EMA 200 y CVD", "Flecha")  # Las de tus 18 veredictos van primero


def call(method, path, body=None, timeout=900):  # Planear 99 acciones con el servidor ocupado pasó de 2 minutos
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def log(text):
    line = time.strftime("%H:%M:%S ") + text
    print(line, flush=True)
    with open(OUT / "tablero.log", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")


def wait(job):
    while True:
        time.sleep(5)
        try:
            j = call("GET", f"/api/tester/job/{job}")
        except Exception as error:  # noqa: BLE001 (un corte del servidor: se reintenta)
            log(f"  (consulta del trabajo falló: {error}; reintento)")
            time.sleep(20)
            continue
        inner = j.get("job") or {}
        if inner.get("state") not in (None, "running", "queued"):
            return inner
        if j.get("success") is False:
            return {"state": "perdido", "error": "el servidor no conoce el trabajo"}


def symbols_of(key, group, phase):
    """Las monedas de esa celda en tu registro (para las que corriste en una sola)."""
    out = set()
    for r in rt.history(None, stale=True):
        rule = rt.clean_rule(r.get("rule") or {})
        if rule and rt.rule_hash("TODAS", rule) == key and r["phase"] == phase:
            out.add(r["symbol"])
    return sorted(out)


def main(path):
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    strategies = json.load(open(path, encoding="utf-8"))
    strategies.sort(key=lambda s: (not any(n.startswith(FIRST) for n in s["names"]), "VA abandonada" in s["names"]))
    started = time.time()
    for s in strategies:
        name = s["names"][0]
        for phase in (1, 2, 3):
            for group in ("base", "new", "stocks"):
                count = s["cells"].get(f"{group}{phase}")
                if not count:
                    continue
                t0 = time.time()
                if count == 1:
                    for symbol in symbols_of(s["key"], group, phase):
                        res = call("POST", f"/api/tester/run/{symbol}", {"rule": s["rule"], "phase": phase, "confirm": True})
                        if res.get("job"):
                            res = wait(res["job"])
                        state = res.get("state") or ("guardada" if res.get("success") else res.get("message"))
                        log(f"{name} · {symbol} f{phase}: {state}{' · ' + str(res.get('error')) if res.get('error') else ''} ({time.time() - t0:.0f} s)")
                    continue
                res = call("POST", "/api/tester/run-all", {"rule": s["rule"], "phase": phase, "confirm": True, "group": group})
                if not res.get("success"):
                    log(f"{name} · {group} f{phase}: no corrió: {res.get('message')}")
                    continue
                plan = res.get("plan") or []
                todo = sum(1 for p in plan if p.get("action") == "run")
                skip = [p.get("symbol") for p in plan if p.get("action") == "skip"]
                if res.get("job"):
                    done = wait(res["job"])
                    state = done.get("state") + (f" · {done.get('error')}" if done.get("error") else "")
                else:
                    state = "ya estaba"
                log(f"{name} · {group} f{phase}: {todo} por correr, {len(skip)} saltadas · {state} ({time.time() - t0:.0f} s)"
                    + (f" · saltadas: {', '.join(skip[:6])}" if skip else ""))
    board = call("GET", "/api/tester/strategies", timeout=600)
    (OUT / "tablero.json").write_text(json.dumps(board, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"fin: {time.time() - started:.0f} s")


if __name__ == "__main__":
    main(sys.argv[1])
