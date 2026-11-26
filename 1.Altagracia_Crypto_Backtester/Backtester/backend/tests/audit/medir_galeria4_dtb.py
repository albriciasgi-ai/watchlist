"""Protocolo de pruebas, galería 4 (26/11/2026): el usuario eligió la opción B del Delta Tail. Sola marca un tercio de las
velas: aquí se miden umbrales para ella, con sus seis casos (los cuatro marcados y las dos velas vecinas que señaló).
B: mecha de inicio de al menos el 20% del rango, cuerpo con delta a favor y la mecha con delta en contra (su celda del
extremo, 10% del nivel medio o más, o la mecha sumada). BTC 15m, fase 1, solo lectura.
Uso, con el python del .venv de App 1: python -X utf8 -B tests/audit/medir_galeria4_dtb.py"""
import sys
from pathlib import Path

exec(open(Path(__file__).with_name("medir_galeria4.py"), encoding="utf-8").read().split("def main():")[0])
sys.stdout.reconfigure(encoding="utf-8")


def tail(f):
    """Lo que mira B en una vela, o None si no es candidata."""
    rng = f["h"] - f["l"]
    if rng <= 0 or "A" not in f:
        return None
    wick = (min(f["o"], f["c"]) - f["l"]) if f["col"] > 0 else (f["h"] - max(f["o"], f["c"]))
    dl = f["A"] - f["P"]
    w = max(1, int(round(wick / f["step"])))
    row0 = -dl[0] / f["meanlv"]
    wick_sum, body_sum = float(dl[:w].sum()), float(dl[w:].sum())
    share = wick / rng
    ok = share >= 0.2 and body_sum > 0 and (row0 >= 0.1 or wick_sum < 0)
    against = max(row0, -wick_sum / f["meanlv"])
    wick_vol = float((f["A"][:w] + f["P"][:w]).sum())
    return {"ok": ok, "share": share, "against": against, "row0": row0, "wick_sum": wick_sum,
            "ratio": -wick_sum / wick_vol if wick_vol > 0 else 0.0}


VARIANTS = {
    "B sola": lambda x, t: x["ok"],
    "B y la mecha >= 30%": lambda x, t: x["ok"] and x["share"] >= 0.3,
    "B y la mecha >= 40%": lambda x, t: x["ok"] and x["share"] >= 0.4,
    "B y la mecha >= 50%": lambda x, t: x["ok"] and x["share"] >= 0.5,
    "B y la mecha >= 55%": lambda x, t: x["ok"] and x["share"] >= 0.55,
    "B y el delta en contra, el 5% mayor": lambda x, t: x["ok"] and t["against"] is not None and x["against"] >= t["against"],
    "B y la mecha, el 5% mayor": lambda x, t: x["ok"] and t["share"] is not None and x["share"] >= t["share"],
}


def main():
    phase = next(p for p in rt.phases(SYMBOL) if p["phase"] == 1)
    p0 = dt.datetime.fromtimestamp(phase["start"] / 1000, dt.timezone.utc).date()
    p1 = dt.datetime.fromtimestamp(phase["end"] / 1000, dt.timezone.utc).date()
    bars = load(p0 - dt.timedelta(days=31), p1)
    facts = [tail(f) for f in bars]
    by_day = {}
    for i, f in enumerate(bars):
        by_day.setdefault(f["_day"], []).append(i)
    thr = {}
    for day in sorted(by_day):
        win = [j for k in range(1, 31) for j in by_day.get(day - dt.timedelta(days=k), [])]
        thr[day] = {
            "against": oe._kth_largest([facts[j]["against"] if facts[j] and facts[j]["ok"] else None for j in win], 0.05),
            "share": oe._kth_largest([facts[j]["share"] if facts[j] and facts[j]["ok"] else None for j in win], 0.05),
        }
    res = rt.load_run(RUNS["DT"]["run"])
    trades = {t["n"]: t for t in res["trades"]}
    wanted = {}
    for n, shift, mark in ((29, 0, "No"), (43, 0, "No"), (113, 0, "Sí"), (127, 0, "No"), (113, 1, "derecha de la 113, «también»"),
                           (127, -1, "izquierda de la 127, «mejor»")):
        wanted[(trades[n]["signal"], shift)] = f"{n}{'' if not shift else (' +1' if shift > 0 else ' -1')} ({mark})"
    index = {f["t"]: i for i, f in enumerate(bars)}
    counts = {name: 0 for name in VARIANTS}
    inside = 0
    for i, f in enumerate(bars):
        if not (phase["start"] <= f["t"] < phase["end"]) or facts[i] is None:
            continue
        inside += 1
        t = thr[f["_day"]]
        for name, rule in VARIANTS.items():
            counts[name] += bool(rule(facts[i], t))
    total = sum(1 for f in bars if phase["start"] <= f["t"] < phase["end"])
    print(f"Delta Tail B en BTC 15m, fase 1 ({total:,} velas):")
    for name, k in counts.items():
        print(f"  {name}: {k:,} ({k / total:.1%})")
    print("Los seis casos del usuario:")
    for (T, shift), label in wanted.items():
        i = index[T] + shift
        x, t = facts[i], thr[bars[i]["_day"]]
        flags = " · ".join(f"{name}: {'sí' if rule(x, t) else 'no'}" for name, rule in VARIANTS.items())
        print(f"  {label}: mecha {x['share']:.0%}, en contra {x['against']:.2f} del nivel medio "
              f"(umbrales del día: en contra {t['against']}, mecha {t['share']})\n    {flags}")


if __name__ == "__main__":
    main()
