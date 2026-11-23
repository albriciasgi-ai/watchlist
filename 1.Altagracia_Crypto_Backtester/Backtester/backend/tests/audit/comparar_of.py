"""
Protocolo (22/11/2026), etapa 4: condiciones necesarias (nivel B) de los dos elementos de order flow de prioridad 1,
con las celdas del almacén (compra y venta por minuto y precio) sumadas por vela y por nivel:

- ST, desequilibrios apilados: tres o más desequilibrios diagonales de 4x seguidos a favor del color, en una vela con
  volumen de 2 veces o más la mediana de las 20 anteriores (filtro de volumen). Diagonal (como el indicador Order
  Flow): en una vela verde, la compra de un nivel contra la venta del nivel de abajo; en una roja, la venta de un nivel
  contra la compra del de arriba. La zona es la racha.
- DT, cola de delta: el delta del nivel del extremo donde empieza la vela (el mínimo en una verde, el máximo en una
  roja) va contra el color, y el del resto a favor. La zona es esa celda.

El step de análisis no se lee del motor: es el de la documentación (la fracción del marco, 15m: 0.0125% del precio,
llevada a 1, 2 o 5 por potencia de diez y a múltiplo de la celda), con el precio de la vela, y se comprueba que la zona
del evento cae en su grilla. Lo que la documentación no decide (los ceros, "el resto" nivel por nivel o sumado, la
mediana de volumen) se cuenta en sus variantes.

Uso (desde backend/): python -B tests/audit/comparar_of.py BTCUSDT [--fase 1] [--dias 60]
"""
import argparse
import collections
import datetime as dt
import json
import math
import os
import random
import statistics
import sys
from pathlib import Path

import numpy as np

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import footprint_store as fs  # noqa: E402  (solo para leer el almacén: _parts y _cell_sums suman compra y venta)
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
TF = 15
FRACTION = {15: 0.000125}  # CLAUDE.md, "ELEMENTOS DE ORDER FLOW": 15m, 10 USD con BTC en 80,000


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def doc_step(price, cell):
    """1, 2 o 5 por potencia de diez, lo más cerca de la fracción del precio, múltiplo de la celda."""
    target = price * FRACTION[TF]
    p = 10 ** math.floor(math.log10(target))
    options = [k * q for q in (p / 10, p, p * 10) for k in (1, 2, 5)]
    options = [x for x in options if x >= cell - 1e-12 and abs(x / cell - round(x / cell)) < 1e-6]
    return min(options, key=lambda x: abs(x - target)) if options else cell


def candle_levels(symbol, t_ms, step):
    """Compra y venta por nivel del step en la vela de 15m que abre en t_ms: {nivel: (compra, venta)} y la celda."""
    m0 = t_ms // 60000
    parts = fs._parts(symbol, m0, m0 + TF)
    if not parts:
        return None, None, None
    data = parts[0][0]
    ps, qs, ticks = (int(x) for x in data["info"])
    cell = ticks / ps
    step_ticks = int(round(step * ps))
    sums = fs._cell_sums(parts, TF, step_ticks)
    out = {}
    for lv, b, s, st in zip(sums["level"], sums["buy"], sums["sell"], sums["start"]):
        if int(st) * 60000 != t_ms:
            continue
        out[int(lv)] = (float(b), float(s))
    return out, step_ticks / ps, cell


def volume_ok(symbol, t_ms, mult=2.0, n=20):
    """Volumen de la vela contra la mediana de las n anteriores que hay (velas armadas con el almacén; un hueco del
    almacén, como el 06/04/2022 08:30-08:59 de BTC, no deja velas y se toman las de antes)."""
    m0 = t_ms // 60000
    parts = fs._parts(symbol, m0 - 3 * n * TF, m0 + TF)
    if not parts:
        return None, None
    c = fs._candles(parts, TF)
    vol = c["buy"] + c["sell"]
    idx = np.flatnonzero(c["start"] * 60000 == t_ms)
    if not len(idx):
        return None, None
    i = int(idx[0])
    prev = vol[max(0, i - n):i]
    if len(prev) < n:
        return None, None
    med = float(np.median(prev))
    return float(vol[i]) >= mult * med, float(vol[i]) / med if med > 0 else None


def check_st(levels, step, e):
    side = e["dir"]
    lo_l, hi_l = int(round(e["lo"] / step)), int(round(e["hi"] / step))
    aligned = abs(e["lo"] / step - lo_l) < 1e-6 and abs(e["hi"] / step - hi_l) < 1e-6
    res = {"aligned": aligned}
    if not aligned:
        return res
    run = list(range(lo_l, hi_l))  # niveles de la racha: [lo, hi)
    res["len"] = len(run)
    for zero in ("cero cuenta", "ambos con volumen"):
        oks = []
        for L in run:
            b, s = levels.get(L, (0.0, 0.0))
            if side > 0:
                other = levels.get(L - 1, (0.0, 0.0))[1]
                mine = b
            else:
                other = levels.get(L + 1, (0.0, 0.0))[0]
                mine = s
            if other <= 0:
                oks.append(mine > 0 and zero == "cero cuenta")
            else:
                oks.append(mine >= 4 * other)
        res[zero] = len(run) >= 3 and all(oks)
    return res


def check_dt(levels, step, e, color):
    side = e["dir"]
    L = int(round(e["lo"] / step))
    aligned = abs(e["lo"] / step - L) < 1e-6 and abs((e["hi"] - e["lo"]) / step - 1) < 1e-6
    res = {"aligned": aligned}
    if not aligned or not levels:
        return res
    first = min(levels) if color > 0 else max(levels)
    res["extremo"] = L == first
    b, s = levels.get(L, (0.0, 0.0))
    d0 = b - s
    rest = [(lv, bb - ss) for lv, (bb, ss) in levels.items() if lv != L]
    res["contra en el extremo"] = d0 * color < 0
    res["resto a favor (sumado)"] = sum(d for _, d in rest) * color > 0
    res["resto a favor (cada nivel)"] = all(d * color > 0 for _, d in rest)
    res["lado"] = side == color
    return res


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--dias", type=int, default=60, help="días al azar de la fase (0 = todos)")
    a = ap.parse_args()
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    rule = rt.clean_rule(rp.RULES["E-ST"])
    span = rt.detect_span(a.symbol, TF, phase, rule)
    bars = {b["t"]: b for b in span["bars"]}
    evs = [e for e in span["events"] if e["code"] in ("ST", "DT")]
    days = sorted({e["t"] // 86400000 for e in evs})
    if a.dias:
        random.Random(2026).shuffle(days)
        days = set(days[:a.dias])
        evs = [e for e in evs if e["t"] // 86400000 in days]
    counts = collections.Counter()
    bad = collections.defaultdict(list)
    for e in sorted(evs, key=lambda x: x["t"]):
        b = bars.get(e["t"])
        if b is None:
            counts[(e["code"], "sin vela")] += 1
            continue
        color = 1 if b["c"] > b["o"] else -1 if b["c"] < b["o"] else 0
        # El step de la documentación con el precio de la vela; si la zona no cae en su grilla, se prueba el vecino
        levels, step, cell = None, None, None
        _, _, cell = candle_levels(a.symbol, e["t"], 1.0)
        if cell is None:
            counts[(e["code"], "sin celdas")] += 1
            continue
        step = doc_step(b["o"], cell)
        levels, step, _ = candle_levels(a.symbol, e["t"], step)
        # Cerca de un empate (el precio deja la fracción a medio camino entre dos pasos de 1, 2 o 5) la documentación no
        # dice con qué precio se elige: si la zona no cae en la grilla, se prueba el paso vecino y se cuenta aparte
        if not (abs(e["lo"] / step - round(e["lo"] / step)) < 1e-6 and abs(e["hi"] / step - round(e["hi"] / step)) < 1e-6):
            target = b["o"] * FRACTION[TF]
            ladder = sorted({k * 10 ** j for j in range(-6, 6) for k in (1, 2, 5) if k * 10 ** j >= cell - 1e-12 and abs(k * 10 ** j / cell - round(k * 10 ** j / cell)) < 1e-6})
            near = sorted(ladder, key=lambda x: abs(x - target))[:3]
            for alt in near:
                if alt == step:
                    continue
                if abs(e["lo"] / alt - round(e["lo"] / alt)) < 1e-6 and abs(e["hi"] / alt - round(e["hi"] / alt)) < 1e-6:
                    counts[(e["code"], f"con el paso vecino ({alt} en vez de {step}, objetivo {target:.3f})")] += 1
                    levels, step, _ = candle_levels(a.symbol, e["t"], alt)
                    counts[(e["code"], "con el paso vecino")] += 1
                    break
        if e["code"] == "ST":
            r = check_st(levels, step, e)
            if r.get("aligned") and not r.get("cero cuenta"):
                # La zona puede caer en las dos grillas (bordes pares con pasos de 1 y 2): si con el paso de la
                # documentación la racha no llega, se prueba el vecino del empate
                target = b["o"] * FRACTION[TF]
                ladder = sorted({k * 10 ** j for j in range(-6, 6) for k in (1, 2, 5) if k * 10 ** j >= cell - 1e-12 and abs(k * 10 ** j / cell - round(k * 10 ** j / cell)) < 1e-6})
                for alt in sorted(ladder, key=lambda x: abs(x - target))[:3]:
                    if alt == step:
                        continue
                    lv2, st2, _ = candle_levels(a.symbol, e["t"], alt)
                    r2 = check_st(lv2, st2, e)
                    if r2.get("aligned") and r2.get("cero cuenta"):
                        counts[("ST", "racha con el paso vecino")] += 1
                        r, step, levels = r2, st2, lv2
                        break
            vok, ratio = volume_ok(a.symbol, e["t"])
            if not vok:
                bad["ST volumen"].append(f"{iso(e['t'])} {'↑' if e['dir'] > 0 else '↓'} volumen {ratio} veces la mediana de las 20 anteriores")
            counts[("ST", "eventos")] += 1
            counts[("ST", "en la grilla")] += r["aligned"]
            counts[("ST", "lado = color")] += e["dir"] == color
            counts[("ST", "volumen ≥ 2× mediana de 20")] += bool(vok)
            for z in ("cero cuenta", "ambos con volumen"):
                counts[("ST", f"3+ diagonales 4x ({z})")] += bool(r.get(z))
            if not (r["aligned"] and e["dir"] == color and vok and r.get("cero cuenta")) and len(bad["ST"]) < 12:
                bad["ST"].append(f"{iso(e['t'])} {'↑' if e['dir'] > 0 else '↓'} color {color:+d} zona {e['lo']}–{e['hi']} step {step} {r} vol {ratio}")
        else:
            r = check_dt(levels, step, e, color)
            counts[("DT", "eventos")] += 1
            for k in ("aligned", "extremo", "lado", "contra en el extremo", "resto a favor (sumado)", "resto a favor (cada nivel)"):
                counts[("DT", k)] += bool(r.get(k))
            if not (r.get("aligned") and r.get("extremo") and r.get("lado") and r.get("contra en el extremo") and r.get("resto a favor (sumado)")) and len(bad["DT"]) < 12:
                bad["DT"].append(f"{iso(e['t'])} {'↑' if e['dir'] > 0 else '↓'} color {color:+d} zona {e['lo']}–{e['hi']} step {step} {r}")
    for code in ("ST", "DT", "ST volumen"):
        rows = {k[1]: v for k, v in counts.items() if k[0] == code}
        print(code, json.dumps(rows, ensure_ascii=False))
        for x in bad[code]:
            print("   ", x)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"comparar_of_{a.symbol}_{TF}_f{a.fase}.json").write_text(
        json.dumps({"cuentas": {f"{k[0]} {k[1]}": v for k, v in counts.items()}, "ejemplos": bad, "dias": a.dias}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
