"""Protocolo de pruebas, galería 4 (26/11/2026), revisión del usuario. Lo que harían las propuestas en BTC 15m, fase 1 (solo lectura).
Para cada elemento: señales hoy y con la propuesta, cuántas siguen, y qué pasa con cada caso de la galería.
Uso, con el python del .venv de App 1: python -X utf8 -B tests/audit/medir_galeria4.py"""
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

SYMBOL, TF, MIN = "BTCUSDT", 15, 60000
RUNS = json.loads(g.RUNS.read_text(encoding="utf-8"))
MARKS = {  # lo que marcó el usuario (galeria_marcas_4.txt): S = Sí, N = No, ? = No sé
    "EX": {208: "S", 623: "N", 1037: "N", 1866: "S"}, "VD": {157: "N", 937: "S", 1093: "S", 1405: "S"},
    "DT": {29: "N", 43: "N", 113: "S", 127: "N"}, "DD": {512: "S", 1533: "N", 2044: "S", 2299: "S"},
    "IV": {306: "S", 915: "S", 2134: "N", 3048: "S"}, "ZP": {559: "S", 1676: "S", 1955: "S", 2513: "?"},
    "SQ": {1: "N", 697: "S", 1044: "N", 1566: "N"}, "VL": {559: "S", 1676: "S", 2514: "S", 3072: "?"},
    "AD": {637: "S", 849: "S", 1908: "S", 2332: "S*"},
}


def case_times():
    out = {}
    for code, cases in MARKS.items():
        res = rt.load_run(RUNS[code]["run"])
        trades = {t["n"]: t for t in res["trades"]}
        for n, mark in cases.items():
            out[trades[n]["signal"]] = out.get(trades[n]["signal"], []) + [(code, n, mark)]
    return out


def load(start_day, end_day):
    bars, day = [], start_day
    while day <= end_day:
        for f in oe._load_bars(SYMBOL, TF, day, 10 ** 12):
            f = dict(f)
            f["_day"] = day
            bars.append(f)
        day += dt.timedelta(days=1)
    return bars


def sides(f):
    """bid y ask en orden de precio (de abajo arriba)."""
    if f["col"] > 0:
        return f["P"], f["A"]
    return f["A"][::-1], f["P"][::-1]


def facts_new(f, hi5, lo5):
    n, ml = f["n"], f["meanlv"]
    bid, ask = sides(f)
    out = {}
    # EX y VD en el extremo del movimiento: máximo de 5 -> arriba (bajista), mínimo de 5 -> abajo (alcista); si no, como hoy
    if hi5 and not lo5:
        out["ex"] = (ask[-1] / ml if ask[-1] > 0 else None, -1)
        out["vd"] = (n >= 5 and ask[-3] > ask[-2] > ask[-1], -1)
    elif lo5 and not hi5:
        out["ex"] = (bid[0] / ml if bid[0] > 0 else None, 1)
        out["vd"] = (n >= 5 and bid[2] > bid[1] > bid[0], 1)
    else:
        out["ex"] = (f["exh"], f["col"])
        out["vd"] = (f["decline"], f["col"])
    # SQ: el agresor crece nivel a nivel, gana a su lado contrario y tiene algo de volumen (5% del nivel medio)
    A, P = f["A"], f["P"]
    k = 0
    while k < n and A[k] > P[k] and A[k] >= oe.MIN_IMB * ml and (k == 0 or A[k] > A[k - 1]):
        k += 1
    out["seq"] = k
    return out


def main():
    phase = next(p for p in rt.phases(SYMBOL) if p["phase"] == 1)
    p0 = dt.datetime.fromtimestamp(phase["start"] / 1000, dt.timezone.utc).date()
    p1 = dt.datetime.fromtimestamp(phase["end"] / 1000, dt.timezone.utc).date()
    bars = load(p0 - dt.timedelta(days=31), p1)
    print(f"{len(bars)} velas de {p0} a {p1}", flush=True)
    cases = case_times()
    by_day = {}
    for i, f in enumerate(bars):
        by_day.setdefault(f["_day"], []).append(i)
    # Hechos por vela
    rows = []
    for i, f in enumerate(bars):
        r = {"t": f["t"], "day": f["_day"], "in": f["t"] >= phase["start"] and f["t"] < phase["end"]}
        if "A" in f:
            hi5 = f["h"] >= max(b["h"] for b in bars[max(0, i - 4):i + 1])
            lo5 = f["l"] <= min(b["l"] for b in bars[max(0, i - 4):i + 1])
            rng = f["h"] - f["l"]
            r.update(col=f["col"], hi5=hi5, lo5=lo5, ex_old=(f["exh"], f["col"]), vd_old=f["decline"],
                     seq_old=f["seq"], tail=f["tail"], zero=f["zero"], inv=f["inverse"][0] >= 2,
                     closepos=(f["c"] - f["l"]) / rng if rng > 0 else 0.5, meanlv=f["meanlv"])
            r.update(facts_new(f, hi5, lo5))
            # DT: mecha en el extremo donde empieza la vela, y el delta de la cola contra el nivel medio
            start_wick = (min(f["o"], f["c"]) - f["l"]) if f["col"] > 0 else (f["h"] - max(f["o"], f["c"]))
            r["dt_wick"] = start_wick / rng if rng > 0 else 0
            r["dt_delta"] = abs(f["A"][0] - f["P"][0]) / f["meanlv"]
            # DD: vela verde en mínimo de 5 con delta > 0, o roja en máximo de 5 con delta < 0
            r["dd_old"] = (f["col"] > 0 and lo5 and f["delta"] > 0) or (f["col"] < 0 and hi5 and f["delta"] < 0)
            r["dd_new"] = r["dd_old"] and not (hi5 and lo5)
            # VL: racha con agresor >= p90 de 30 días (umbral por día, abajo); AD: la celda pasiva mayor
            r["A"], r["P"] = f["A"], f["P"]
            acc = f["accdist"]
            r["ad"] = acc[0] if acc else None
            r["ad_ratio"] = (f["P"][acc[1]] / f["A"][acc[1]] if f["A"][acc[1]] > 0 else 99.0) if acc else None
        rows.append(r)
    # Umbrales relativos por día (30 días antes), como oe._thresholds
    thr = {}
    for day in sorted(by_day):
        win = [rows[j] for k in range(1, 31) for j in by_day.get(day - dt.timedelta(days=k), [])]
        win = [w for w in win if "col" in w]
        if len(win) < 100:
            continue
        aggr = np.concatenate([w["A"][w["A"] > 0] for w in win])
        vert = float(np.percentile(aggr, 90))
        t = {"vert": vert}
        t["ex_old"] = oe._kth_largest([-w["ex_old"][0] if w["ex_old"][0] is not None else None for w in win], 0.05)
        t["ex_new"] = oe._kth_largest([-w["ex"][0] if w["ex"][0] is not None else None for w in win], 0.05)
        t["sq_old"] = oe._kth_largest([w["seq_old"] for w in win], 0.05)
        t["sq_new"] = oe._kth_largest([w["seq"] for w in win], 0.05)
        for name, rule in (("vl_old", lambda w: oe._run(w["A"] >= vert)[0]),
                           ("vl_dom", lambda w: oe._run((w["A"] >= vert) & (w["A"] > w["P"]))[0]),
                           ("vl_dom15", lambda w: oe._run((w["A"] >= vert) & (w["A"] >= 1.5 * w["P"]))[0])):
            t[name] = oe._kth_largest([rule(w) for w in win], 0.05)
        t["ad"] = oe._kth_largest([w["ad"] for w in win], 0.05)
        thr[day] = t
    counts = {}

    def add(name, old, new, key=None):
        c = counts.setdefault(name, [0, 0, 0])
        c[0] += bool(old)
        c[1] += bool(new)
        c[2] += bool(old and new)

    verdict = {}
    for r in rows:
        if not r["in"] or "col" not in r or r["day"] not in thr:
            continue
        t = thr[r["day"]]
        ex_old = r["ex_old"][0] is not None and -r["ex_old"][0] >= t["ex_old"]
        ex_new = r["ex"][0] is not None and -r["ex"][0] >= t["ex_new"]
        add("EX", ex_old, ex_new)
        add("EX con el lado cambiado", ex_old and ex_new and r["ex_old"][1] != r["ex"][1], False)
        vd_old, vd_new = r["vd_old"], r["vd"][0]
        add("VD (sin el filtro de volumen)", vd_old, vd_new)
        for w, d in ((0.15, 0.0), (0.2, 0.0), (0.2, 0.1), (0.25, 0.1), (0.2, 0.2)):
            add(f"DT mecha {w:.0%} y cola {d:.0%} del nivel medio", r["tail"], r["tail"] and r["dt_wick"] >= w and r["dt_delta"] >= d)
        add("DD sin velas que hacen máximo y mínimo", r["dd_old"], r["dd_new"])
        half = (r["closepos"] >= 0.5) if r["col"] > 0 else (r["closepos"] <= 0.5)
        add("IV con el cierre en su mitad", r["inv"], r["inv"] and half)
        add("ZP con el cierre en su mitad", r["zero"], r["zero"] and half)
        sq_need_old = max(4, t["sq_old"]) if t["sq_old"] is not None else None
        sq_need_new = max(4, t["sq_new"]) if t["sq_new"] is not None else None
        add("SQ", sq_need_old is not None and r["seq_old"] >= sq_need_old, sq_need_new is not None and r["seq"] >= sq_need_new)
        vert = t["vert"]
        for name, run in (("VL con el agresor ganando", oe._run((r["A"] >= vert) & (r["A"] > r["P"]))[0]),
                          ("VL con el agresor 1.5 veces", oe._run((r["A"] >= vert) & (r["A"] >= 1.5 * r["P"]))[0])):
            key = "vl_dom" if "ganando" in name else "vl_dom15"
            old = oe._run(r["A"] >= vert)[0] >= max(3, t["vl_old"]) if t["vl_old"] is not None else False
            new = run >= max(3, t[key]) if t[key] is not None else False
            add(name, old, new)
        ad_old = r["ad"] is not None and t["ad"] is not None and r["ad"] >= t["ad"]
        for x in (1.5, 2.0):
            add(f"AD con el pasivo {x} veces el agresor en su nivel", ad_old, ad_old and r["ad_ratio"] >= x)
        # Casos de la galería
        for code, n, mark in cases.get(r["t"], []):
            if code == "EX":
                verdict[(code, n)] = (mark, ex_old, ex_new, f"lado hoy {r['ex_old'][1]:+d}, con la propuesta {r['ex'][1]:+d}")
            elif code == "VD":
                verdict[(code, n)] = (mark, vd_old, vd_new, f"máx5 {r['hi5']} mín5 {r['lo5']}")
            elif code == "DT":
                verdict[(code, n)] = (mark, r["tail"], r["tail"] and r["dt_wick"] >= 0.2 and r["dt_delta"] >= 0.1,
                                      f"mecha {r['dt_wick']:.0%}, cola {r['dt_delta']:.0%} del nivel medio")
            elif code == "DD":
                verdict[(code, n)] = (mark, r["dd_old"], r["dd_new"], f"máx5 {r['hi5']} mín5 {r['lo5']}")
            elif code in ("IV", "ZP"):
                flag = r["inv"] if code == "IV" else r["zero"]
                verdict[(code, n)] = (mark, flag, flag and half, f"cierre al {r['closepos']:.0%} del rango")
            elif code == "SQ":
                verdict[(code, n)] = (mark, r["seq_old"], r["seq"], f"niveles seguidos hoy {r['seq_old']}, con la propuesta {r['seq']}")
            elif code == "VL":
                run = oe._run((r["A"] >= vert) & (r["A"] > r["P"]))[0]
                verdict[(code, n)] = (mark, oe._run(r["A"] >= vert)[0], run, "niveles de la racha hoy y con el agresor ganando")
            elif code == "AD":
                verdict[(code, n)] = (mark, ad_old, ad_old and r["ad_ratio"] >= 2.0, f"pasivo {r['ad_ratio']:.1f} veces el agresor")
    print("\nElemento · señales hoy · con la propuesta · siguen")
    for name, (a, b, c) in counts.items():
        print(f"  {name}: {a} · {b} · {c}")
    print("\nCasos de la galería (marca · hoy · con la propuesta · dato)")
    for (code, n), v in sorted(verdict.items()):
        print(f"  {code} {n}: {v[0]} · {v[1]} · {v[2]} · {v[3]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
