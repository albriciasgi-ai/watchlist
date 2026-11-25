"""
Protocolo (24/11/2026), galería de elementos: las corridas de los elementos que cambiaron con el motor 7, en la copia
aislada (POST /api/tester/run/BTCUSDT), con la misma regla de su corrida del motor 6 y los valores de fábrica nuevos.
- Galería 1 (G1_RESPUESTAS.md): los patrones con tamaño y swing confirmado, el rombo solo cuando sube la respuesta, la
  ruptura con el primer cierre afuera, el borde de caja al 5% y el cambio de carácter con el swing que originó el tramo.
- Galería 2 (G2_RESPUESTAS.md): los seis elementos del lector VPA que cambiaron y los dos nuevos (esfuerzo con
  resultado y el giro del medidor, con la regla del cruce del medidor y su código).

Escribe evidencia/etapa7/galeria_corridas_m7.json (suma lo de cada galería a lo que ya tenía) y las colas de captura
(4 casos por elemento, elegidos con galeria_html.pick): cola_m7_a.json (sin indicadores) y cola_m7_b.json (los rombos,
con el Volumen de Respuesta) en la galería 1; cola_m7_c.json en la 2, con los paneles (el volumen y el Lector VPA).

24/11, tras el caso 2 del esfuerzo sin resultado (la vela ancha con volumen alto tuvo resultado): con códigos después de
la galería, rehace solo esos. Una vela que ya era caso y sigue siendo trade queda con su clave (keys: su marca sigue
valiendo); los casos nuevos llevan claves nuevas. WANT pone una vela entre los casos si es trade de la corrida.

Uso (desde backend/, con el backend aislado del motor 7 en el 9300):
python -B tests/audit/galeria_corridas_m7.py [1|2] [códigos]
"""
import copy
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import galeria_html as g  # noqa: E402

API = "http://127.0.0.1:9300"
SIGNAL = {"until": "signal", "after": 8, "longBars": 1000000000}
OPTS = {"HM": {**SIGNAL, "before": 20}, "EN": {**SIGNAL, "before": 20}, "DJ": {**SIGNAL, "before": 20},
        "RBg": {**SIGNAL, "before": 30, "panels": True}, "RBs": {**SIGNAL, "before": 30, "panels": True},
        "BX": {**SIGNAL, "before": 30}, "BE": {**SIGNAL, "before": 30}, "CC": {**SIGNAL, "before": 30}}
# Galería 2: todos con los paneles, para leer el volumen y el medidor (O-37)
OPTS.update({code: {**SIGNAL, "before": before, "panels": True}
             for code, before in (("QA", 20), ("QV", 20), ("QB", 30), ("QR", 30), ("QT", 30), ("QS", 20), ("QC", 20), ("QE", 30),
                                  ("QG", 30))})
# El cruce del medidor (QE) entra con el medidor que lee la vela ancha como los elementos (wideMeter, 24/11)
GALLERY = {"1": ("HM", "EN", "DJ", "RBg", "RBs", "BX", "BE", "CC"), "2": ("QA", "QV", "QB", "QR", "QT", "QS", "QC", "QE", "QG")}
# Los casos del cruce en la página antes del motor 7 (corrida del motor 6, carpeta G_QE): su trade y su clave
QE_BEFORE = {"chosen": [13, 75, 88, 125], "keys": {"13": "QE-2", "75": "QE-7", "88": "QE-8", "125": "QE-11"}}
# Los elementos nuevos del motor 7 no tienen corrida del motor 6: van con la regla del cruce del medidor y su código
NEW = {"QV": "PRUEBA E-QV · Esfuerzo con resultado (VPA)", "QG": "PRUEBA E-QG · El medidor VPA gira"}
# La vela del caso 2 del esfuerzo sin resultado (17/04/21 19:00 en Colombia): el usuario dijo que es esfuerzo con resultado
WANT = {"QV": [1618704000000]}


def cases(code, trades, prev, prev_trades):
    """Los casos de la corrida nueva y la clave de cada uno: las velas que ya eran caso, con su clave; WANT; el resto,
    repartidos con galeria_html.pick, con claves nuevas."""
    by_signal = {t["signal"]: t for t in trades}
    if prev:
        old_keys = prev.get("keys") or {str(n): k + 1 for k, n in enumerate(prev["chosen"])}
        old = {t["n"]: t for t in prev_trades}
        keep = {by_signal[old[int(n)]["signal"]]["n"]: k for n, k in old_keys.items()
                if int(n) in old and old[int(n)]["signal"] in by_signal}
        last = max([k for k in old_keys.values() if isinstance(k, int)] or [0])
    else:
        keep, last = {}, 0
    want = [by_signal[s]["n"] for s in WANT.get(code, []) if s in by_signal and by_signal[s]["n"] not in keep]
    rest = [{"i": k + 1, "side": "largo" if t["dir"] > 0 else "corto", "n": t["n"]} for k, t in enumerate(trades)
            if t["n"] not in keep and t["n"] not in want]
    fresh = want[:max(0, g.PER_ELEMENT - len(keep))]
    missing = g.PER_ELEMENT - len(keep) - len(fresh)
    fresh += [it["n"] for it in g.pick(rest, missing)] if missing > 0 else []
    keys = {**{str(n): k for n, k in keep.items()}, **{str(n): last + j + 1 for j, n in enumerate(sorted(fresh))}}
    return sorted([*keep, *fresh]), keys


def call(method, path, body=None, timeout=600):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def motor7(rule):
    """La regla de la corrida del motor 6 con los valores de fábrica del motor 7."""
    rule = copy.deepcopy(rule)
    for key in ("minPart", "swingBefore", "swingAfter"):
        (rule.get("pat") or {}).pop(key, None)
    for key in ("ref", "closes"):
        (rule.get("cc") or {}).pop(key, None)
    if rule.get("be"):
        rule["be"]["share"] = 0.05
    return rule


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    gallery = sys.argv[1] if len(sys.argv) > 1 else "1"
    only = set(sys.argv[2:])
    runs = json.loads(g.RUNS.read_text(encoding="utf-8"))
    out = json.loads(g.RUNS_M7.read_text(encoding="utf-8")) if g.RUNS_M7.exists() else {}
    queues = {"a": [], "b": []} if gallery == "1" else {"c": []}
    for code in GALLERY[gallery]:
        if only and code not in only:
            continue
        old = call("GET", f"/api/tester/result/{runs['QE' if code in NEW else code]['run']}")
        rule = motor7((old.get("result") or old)["rule"])
        if code in NEW:
            rule["recipe"]["id"] = NEW[code]
            rule["recipe"]["slots"] = [{"codes": [code], "group": 0}]
        t0 = time.time()
        res = call("POST", "/api/tester/run/BTCUSDT", {"rule": rule, "phase": 1, "confirm": True})
        run = res.get("run") or (res.get("result") or {}).get("id")
        if res.get("job"):
            while True:
                time.sleep(4)
                job = call("GET", f"/api/tester/job/{res['job']}").get("job") or {}
                if job.get("state") not in ("running", None):
                    break
            run = job.get("run")
            if job.get("state") != "done":
                print(code, "falló:", job.get("error"), flush=True)
                continue
        detail = call("GET", f"/api/tester/result/{run}")
        result = detail.get("result") or detail
        trades = sorted(result.get("trades") or [], key=lambda t: t["n"])
        prev = out.get(code) if only else None
        if only and code == "QE" and not prev:
            prev = {"run": runs["QE"]["run"], **QE_BEFORE}
        prev_trades = []
        if prev:
            old_detail = call("GET", f"/api/tester/result/{prev['run']}")
            prev_trades = (old_detail.get("result") or old_detail).get("trades") or []
        chosen, keys = cases(code, trades, prev, prev_trades)
        out[code] = {"title": g.E[code][0], "run": run, "tf": rule["tf"], "trades": (result.get("summary") or {}).get("n"),
                     "skipped": result.get("skipped"), "signals": result.get("signals"), "engine": result.get("engine"),
                     "before": (runs.get(code) or {}).get("trades"), "chosen": chosen, "keys": keys}
        if prev:
            out[code]["previous"] = {"run": prev["run"], "chosen": prev["chosen"], "keys": prev.get("keys")}
            print(code, "casos", chosen, "claves", keys, flush=True)
        queues["c" if gallery == "2" else "b" if code in ("RBg", "RBs") else "a"].append(
            {"name": f"G7_{code}", "run": run, "opts": OPTS[code], "only": chosen, "linesName": "lineas"})
        print(code, run, out[code]["trades"], "trades (antes", (runs.get(code) or {}).get("trades"), ")", f"{time.time() - t0:.0f} s", flush=True)
        (g.RUNS_M7).write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    for name, queue in queues.items():
        (g.RUNS.parent / f"cola_m7_{name}.json").write_text(json.dumps(queue, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
