"""Protocolo de pruebas, galería 4 (26/11/2026), revisión del usuario. En la recarga 593 y la 2072, la app cuenta desequilibrios de muy poco volumen (el lado dominante desde el 5% del
nivel medio de la vela, of_elements.MIN_IMB). ¿Qué pasaría con los elementos de desequilibrios si el mínimo subiera?
BTC 15m, fase 1, solo lectura. Uso, con el python del .venv de App 1: python -X utf8 -B tests/audit/medir_galeria4_imb.py"""
import datetime as dt
import json
import os
import sys
from pathlib import Path

os.environ["ORDERFLOW_OBSERVER"] = r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado"
os.environ["TESTER_AUTO_UPDATE"] = "0"
BACKEND = Path(__file__).resolve().parents[2]
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
sys.path.insert(0, str(BACKEND / "tests" / "audit"))

import numpy as np  # noqa: E402
import galeria_html as g  # noqa: E402
import of_elements as oe  # noqa: E402
import rule_tester as rt  # noqa: E402

SYMBOL, TF = "BTCUSDT", 15
MINS = (0.05, 0.25, 0.5, 1.0)
RUNS = json.loads(g.RUNS.read_text(encoding="utf-8"))
CASES = {"ST": [773, 1545, 3090, 3476], "VI": [843, 1264, 2528, 4212], "IR": [331, 1649, 1978, 3296],
         "IV": [306, 915, 2134, 3048], "RD": [593, 2072, 2368, 3255]}


def load(start_day, end_day):
    bars, day = [], start_day
    while day <= end_day:
        bars.extend(oe._load_bars(SYMBOL, TF, day, 10 ** 12))
        day += dt.timedelta(days=1)
    return bars


def masks(f, m):
    A, P, meanlv = f["A"], f["P"], f["meanlv"]
    n = len(A)
    imb = np.zeros(n, bool)
    imb[1:] = (A[1:] >= oe.RATIO * P[:-1]) & (A[1:] > 0) & (A[1:] >= m * meanlv)
    opp = np.zeros(n, bool)
    opp[:-1] = (P[:-1] >= oe.RATIO * A[1:]) & (P[:-1] > 0) & (P[:-1] >= m * meanlv)
    return imb, opp


def main():
    phase = next(p for p in rt.phases(SYMBOL) if p["phase"] == 1)
    p0 = dt.datetime.fromtimestamp(phase["start"] / 1000, dt.timezone.utc).date()
    p1 = dt.datetime.fromtimestamp(phase["end"] / 1000, dt.timezone.utc).date()
    bars = load(p0 - dt.timedelta(days=2), p1)
    vols = np.array([b["vol"] for b in bars])
    wanted = {}
    for code, ns in CASES.items():
        res = rt.load_run(RUNS[code]["run"])
        trades = {t["n"]: t for t in res["trades"]}
        for n in ns:
            wanted.setdefault(trades[n]["signal"], []).append((code, n))
    counts = {m: {c: 0 for c in CASES} for m in MINS}
    keep = {m: {c: 0 for c in CASES} for m in MINS}  # de las señales de hoy, cuántas siguen
    cases = {}
    rows_prev = {}
    for i, f in enumerate(bars):
        if "A" not in f:
            rows_prev = {}
            continue
        inside = phase["start"] <= f["t"] < phase["end"]
        rel = None
        if i >= oe.VOLUME_BARS:
            med = float(np.median(vols[i - oe.VOLUME_BARS:i]))
            rel = f["vol"] / med if med > 0 else 0.0
        p = bars[i - 1] if i > 0 else None
        same = p is not None and "A" in p and p.get("col") == f["col"] and p["step"] == f["step"]
        now = {}
        base = None
        for m in MINS:
            imb, opp = masks(f, m)
            n = len(imb)
            run = oe._run(opp[n // 2:])
            res = {"IV": run[0] >= 2}
            vol_ok = rel is not None and rel >= oe.DEFAULT_VOL_FILTER
            res["ST"] = vol_ok and oe._run(imb)[0] >= oe.CATALOG["ST"][3]
            res["VI"] = vol_ok and int(imb.sum()) >= oe.CATALOG["VI"][3]
            res["IR"] = vol_ok and bool(opp[0] or opp[1])
            mine = {oe._row_price(f, k) for k in np.nonzero(imb)[0]}
            shared = sorted(mine & rows_prev.get(m, set())) if same else []
            res["RD"] = vol_ok and bool(shared)
            now[m] = mine
            if m == MINS[0]:
                base = res
            if inside:
                for c in CASES:
                    counts[m][c] += res[c]
                    keep[m][c] += res[c] and base[c]
            if f["t"] in wanted:
                for code, n in wanted[f["t"]]:
                    cases.setdefault((code, n), {})[m] = (res[code], len(shared) if code == "RD" else None)
        rows_prev = now
    print("Señales en BTC 15m, fase 1, según el mínimo del lado dominante (en veces el nivel medio de la vela):")
    for c in CASES:
        print(f"  {c}: " + " · ".join(f"{m:g}: {counts[m][c]:,} (siguen {keep[m][c]:,})" for m in MINS))
    print("Casos de la galería (¿sigue?, y en la recarga cuántas celdas compartidas):")
    for (code, n), by in sorted(cases.items()):
        print(f"  {code} {n}: " + " · ".join(f"{m:g}: {'sí' if v[0] else 'no'}{'' if v[1] is None else f' ({v[1]} celdas)'}" for m, v in by.items()))


if __name__ == "__main__":
    main()
