"""Protocolo de pruebas, galería 4 (26/11/2026), revisión del usuario. Delta Tail con la mecha entera (solo lectura): BTC 15m fase 1 y los casos de la galería."""
import sys
from pathlib import Path
exec(open(Path(__file__).with_name("medir_galeria4.py"), encoding="utf-8").read().split("def main():")[0])
sys.stdout.reconfigure(encoding="utf-8")


def dt_flags(f):
    rng = f["h"] - f["l"]
    if rng <= 0 or "A" not in f:
        return None
    wick = (min(f["o"], f["c"]) - f["l"]) if f["col"] > 0 else (f["h"] - max(f["o"], f["c"]))
    dl = f["A"] - f["P"]
    w = max(1, int(round(wick / f["step"])))
    row0 = -dl[0] / f["meanlv"]          # > 0: la celda del extremo va en contra del color
    wick_sum, body_sum = float(dl[:w].sum()), float(dl[w:].sum())
    v1 = f["tail"] and wick / rng >= 0.2 and row0 >= 0.1
    v2 = wick / rng >= 0.2 and body_sum > 0 and (row0 >= 0.1 or wick_sum < 0)
    return {"old": f["tail"], "v1": v1, "v2": v2, "wick": wick / rng, "row0": row0, "wick_sum": wick_sum, "body_sum": body_sum}


phase = next(p for p in rt.phases(SYMBOL) if p["phase"] == 1)
p0 = dt.datetime.fromtimestamp(phase["start"] / 1000, dt.timezone.utc).date()
p1 = dt.datetime.fromtimestamp(phase["end"] / 1000, dt.timezone.utc).date()
bars = load(p0, p1)
c = {"old": 0, "v1": 0, "v2": 0, "v2 y hoy": 0}
for f in bars:
    if not (phase["start"] <= f["t"] < phase["end"]):
        continue
    x = dt_flags(f)
    if x is None:
        continue
    for k in ("old", "v1", "v2"):
        c[k] += bool(x[k])
    c["v2 y hoy"] += bool(x["v2"] and x["old"])
print("Delta Tail en BTC 15m fase 1:", c)
res = rt.load_run(RUNS["DT"]["run"])
trades = {t["n"]: t for t in res["trades"]}
for n, shift, mark in ((29, 0, "N"), (43, 0, "N"), (113, 0, "S"), (127, 0, "N"), (113, 1, "la vela de la derecha: «también»"), (127, -1, "la vela de la izquierda: «mejor»")):
    T = trades[n]["signal"]
    day = dt.datetime.fromtimestamp(T / 1000, dt.timezone.utc).date()
    bs = load(day, day)
    k = next(i for i, f in enumerate(bs) if f["t"] == T) + shift
    x = dt_flags(bs[k])
    print(f"  DT {n}{'' if not shift else (' +1' if shift > 0 else ' -1')} ({mark}): hoy {x['old']} · mecha y celda {x['v1']} · mecha entera {x['v2']} "
          f"(mecha {x['wick']:.0%}, celda {x['row0']:+.0%}, mecha {x['wick_sum']:+.1f}, cuerpo {x['body_sum']:+.1f})")
