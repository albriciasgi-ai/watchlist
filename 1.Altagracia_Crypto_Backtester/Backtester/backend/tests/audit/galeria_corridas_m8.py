"""
Protocolo (26/11/2026), galería 4: las corridas de los elementos de order flow que cambiaron con el motor 8, en la copia
aislada (POST /api/tester/run/BTCUSDT), con la misma regla de su corrida de antes (revision_visual/G4_RESPUESTAS.md,
"Lo que decidió el usuario"): Exhaustion Print, Volume Decline, Delta Tail, Delta Divergence, Inverse Imbalance,
Orderflows Sequencing, Vertical Liquidity, Acumulación/Distribución y la absorción en varios intentos.

Los casos: una vela que ya era caso en la página y sigue siendo trade conserva su clave (la marca del usuario sigue);
los demás se eligen con galeria_html.pick y llevan claves nuevas (<código>8-<trade>). Escribe
evidencia/etapa7/galeria_corridas_m8.json; la cola de captura la arma galeria_of.py cola8, con las celdas de cada caso.

Uso (desde backend/, con el backend aislado del motor 8 en el 9300): python -B tests/audit/galeria_corridas_m8.py [códigos]
"""
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import galeria_html as g  # noqa: E402

API = "http://127.0.0.1:9300"
M8 = ("EX", "VD", "DT", "DD", "IV", "SQ", "VL", "AD", "RL")


def call(method, path, body=None, timeout=900):
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(API + path, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def page_cases(code):
    """Los casos a la vista hoy en la página (galeria_html.build_page sobre G_<código>): [(trade, clave)]."""
    folder = g.SHOTS / f"G_{code}"
    files = sorted({folder / re.sub(r"_paneles(?=[.]jpg$)", "", f.name) for f in folder.glob("trade_[0-9][0-9][0-9][0-9]*.jpg")
                    if re.fullmatch(r"trade_[0-9]{4}(_paneles)?[.]jpg", f.name)})
    items = []
    for i, img in enumerate(files, 1):
        meta_path = img.with_suffix(".json")
        meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
        items.append({"i": i, "side": g.caption(meta)[1], "n": int(img.stem.split("_")[1])})
    return [(it["n"], f"{code}-{it['i']}") for it in g.pick(items, g.PER_ELEMENT)]


def run(rule):
    res = call("POST", "/api/tester/run/BTCUSDT", {"rule": rule, "phase": 1, "confirm": True})
    run_id = res.get("run") or (res.get("result") or {}).get("id")
    if res.get("job"):
        while True:
            time.sleep(5)
            job = call("GET", f"/api/tester/job/{res['job']}").get("job") or {}
            if job.get("state") not in ("running", None):
                break
        if job.get("state") != "done":
            raise RuntimeError(job.get("error"))
        run_id = job.get("run")
    detail = call("GET", f"/api/tester/result/{run_id}")
    return run_id, detail.get("result") or detail


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    only = set(sys.argv[1:])
    runs = json.loads(g.RUNS.read_text(encoding="utf-8"))
    path = g.RUNS.with_name("galeria_corridas_m8.json")
    out = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for code in M8:
        if only and code not in only:
            continue
        t0 = time.time()
        old = call("GET", f"/api/tester/result/{runs[code]['run']}")
        old = old.get("result") or old
        run_id, result = run(old["rule"])
        trades = sorted(result.get("trades") or [], key=lambda t: t["n"])
        by_signal = {(t["signal"], t["dir"]): t["n"] for t in trades}
        old_trades = {t["n"]: t for t in old.get("trades") or []}
        keep = {}
        for n, key in page_cases(code):
            t = old_trades.get(n)
            if t and (t["signal"], t["dir"]) in by_signal:
                keep[by_signal[(t["signal"], t["dir"])]] = key
        rest = [{"i": k + 1, "side": "largo" if t["dir"] > 0 else "corto", "n": t["n"]} for k, t in enumerate(trades)
                if t["n"] not in keep]
        missing = g.PER_ELEMENT - len(keep)
        fresh = [it["n"] for it in g.pick(rest, missing)] if missing > 0 else []
        keys = {**{str(n): key for n, key in keep.items()}, **{str(n): f"{code}8-{n}" for n in fresh}}
        out[code] = {"title": g.E[code][0], "run": run_id, "tf": result["rule"]["tf"], "engine": result.get("engine"),
                     "trades": (result.get("summary") or {}).get("n"), "before": old.get("summary", {}).get("n"),
                     "signals": result.get("signals"), "chosen": sorted(int(n) for n in keys), "keys": keys,
                     "previous": {"run": runs[code]["run"], "cases": page_cases(code)}}
        print(code, run_id, f"{out[code]['before']} → {out[code]['trades']} trades;", "siguen", sorted(keep.values()),
              "nuevos", fresh, f"{time.time() - t0:.0f} s", flush=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
