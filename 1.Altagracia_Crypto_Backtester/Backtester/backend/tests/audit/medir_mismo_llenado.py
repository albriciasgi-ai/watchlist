"""
Protocolo (21/11/2026), hallado con el espejo (M-01) en R07c: con "una posición a la vez" y órdenes que esperan (limit,
orden stop, dos órdenes), el motor toma las señales por (vela del llenado, vela de la señal) y, si dos se llenan en la
misma vela, la que va primero en la lista (los largos antes que los cortos), no la que se llenó primero.

Este script mide cuántas veces pasa y cuántas veces la tomada no fue la primera en llenarse según los minutos del almacén
(o el recorrido supuesto sin minutos). Para cada trade tomado busca otras señales de la regla llenadas en la misma vela y
que quedaron fuera; compara el minuto del llenado de cada una.

Uso (desde backend/): python -B tests/audit/medir_mismo_llenado.py BTCUSDT R05a,R05b,R07a,R07b,R07c [--fase 1]
"""
import argparse
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import comparar as cmp  # noqa: E402
import oraculo as oa  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\motor")


def fill_minute(path, out):
    """El primer punto del recorrido de la vela en que la orden se llena: limit al cruzar, stop al tocar."""
    side, level, order = out["dir"], out["entry"], out["order"]
    for i, (t, h, l) in enumerate(path):
        if order == "limit":
            hit = l < level if side > 0 else h > level
        else:
            hit = h >= level if side > 0 else l <= level
        if hit or (i == 0 and abs(h - level) < 1e-12 and abs(l - level) < 1e-12):
            return t
    return None


def measure(symbol, name, phase_n):
    rule = rp.RULES[name]
    cap = cmp.capture(symbol, rule, phase_n, base=False)
    ctx = next(iter(cap["contexts"].values()))
    b = cmp._bars_of(ctx, symbol)
    calls = [c for c in cap["calls"] if c["who"] == "rule" and c["out"] and "skip" not in c["out"] and not c["out"].get("open")]
    taken = {(t["entry_t"], t["dir"], round(t["entry"], 8)) for t in cap["result"]["trades"]}
    by_bar = {}
    for c in calls:
        by_bar.setdefault(c["out"]["entry_i"], []).append(c)
    groups, wrong, ties, same_side = 0, [], 0, 0
    for j, group in sorted(by_bar.items()):
        picked = [c for c in group if (c["out"]["entry_t"], c["out"]["dir"], round(c["out"]["entry"], 8)) in taken]
        if not picked or len(group) < 2:
            continue
        groups += 1
        p = picked[0]
        path, real = b.path(j)
        tp = fill_minute(path, p["out"])
        for c in group:
            if c is p:
                continue
            tc = fill_minute(path, c["out"])
            if c["out"]["dir"] == p["out"]["dir"]:
                same_side += 1
            if tp is None or tc is None:
                continue
            if tc < tp:
                wrong.append({"vela": rt._iso(ctx["T"][j]) if hasattr(rt, "_iso") else ctx["T"][j], "minutos": real,
                              "tomada": {"lado": p["out"]["dir"], "precio": p["out"]["entry"], "llena": tp, "señal": p["k"], "r": p["out"]["r"]},
                              "antes": {"lado": c["out"]["dir"], "precio": c["out"]["entry"], "llena": tc, "señal": c["k"], "r": c["out"]["r"]}})
            elif tc == tp:
                ties += 1
    # La selección otra vez: como el motor (vela del llenado, vela de la señal) y por el minuto del llenado dentro de la vela
    cool = int(cap["rule"].get("cooldown") or 0)

    def select(order_key):
        busy, out = -1, []
        for c in sorted(calls_all, key=order_key):
            o = c["out"]
            if o["entry_i"] < busy or o["entry_i"] < busy + cool and busy >= 0:
                continue
            if o.get("open"):
                break
            out.append(o)
            busy = o["exit_i"] + 1
        return out

    calls_all = [c for c in cap["calls"] if c["who"] == "rule" and c["out"] and "skip" not in c["out"]]
    fill_t = {}
    for c in calls_all:
        j = c["out"]["entry_i"]
        fill_t[id(c)] = fill_minute(b.path(j)[0], c["out"]) or ctx["T"][j]
    def select_time(order_key):
        """Por el minuto del llenado y, si el trade anterior ya salió antes de ese minuto, también en su misma vela."""
        last_exit_t, last_exit_i, out = None, -1, []
        for c in sorted(calls_all, key=order_key):
            o = c["out"]
            if last_exit_t is not None and (fill_t[id(c)] <= last_exit_t or o["entry_i"] < last_exit_i):
                continue
            if cool and last_exit_i >= 0 and o["entry_i"] < last_exit_i + 1 + cool:
                continue
            if o.get("open"):
                break
            out.append(o)
            last_exit_t, last_exit_i = o["exit_t"], o["exit_i"]
        return out

    engine_like = select(lambda c: (c["out"]["entry_i"], c["k"]))
    by_minute = select(lambda c: (c["out"]["entry_i"], fill_t[id(c)], c["k"]))
    by_time = select_time(lambda c: (fill_t[id(c)], c["k"]))
    eng = cap["result"]["trades"]
    key = lambda xs: [(o["entry_t"], o["dir"], o["r"]) for o in xs]  # noqa: E731
    same = key(engine_like) == key(eng)            # el orden de antes del motor 5 (vela de la señal)
    same_minute = key(by_minute) == key(eng)       # el del motor 5 (minuto del llenado)
    avg = lambda xs: round(sum(o["r"] for o in xs) / len(xs), 4) if xs else None  # noqa: E731
    return {"regla": name, "moneda": symbol, "trades": len(cap["result"]["trades"]), "velas con dos o más llenados": groups,
            "del mismo lado": same_side, "la tomada no fue la primera": len(wrong), "mismo minuto": ties, "casos": wrong[:12],
            "R de las tomadas mal": round(sum(w["tomada"]["r"] for w in wrong), 4),
            "R de las que debían": round(sum(w["antes"]["r"] for w in wrong), 4),
            "selección repetida igual al motor": same,
            "selección por minuto igual al motor": same_minute,
            "por minuto": {"trades": len(by_minute), "R medio": avg(by_minute), "R total": round(sum(o["r"] for o in by_minute), 2)},
            "por minuto, con reentrada": {"trades": len(by_time), "R medio": avg(by_time), "R total": round(sum(o["r"] for o in by_time), 2)},
            "motor": {"trades": len(eng), "R medio": avg(eng), "R total": round(sum(t["r"] for t in eng), 2)}}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("reglas")
    ap.add_argument("--fase", type=int, default=1)
    a = ap.parse_args()
    out = []
    for name in a.reglas.split(","):
        rep = measure(a.symbol, name.strip(), a.fase)
        out.append(rep)
        print(f"{rep['regla']} {rep['moneda']}: {rep['trades']} trades; velas con dos o más llenados {rep['velas con dos o más llenados']}; "
              f"la tomada no fue la primera {rep['la tomada no fue la primera']} (R {rep['R de las tomadas mal']} contra {rep['R de las que debían']}); "
              f"mismo minuto {rep['mismo minuto']} | orden por señal = motor: {rep['selección repetida igual al motor']}; "
              f"orden por minuto = motor: {rep['selección por minuto igual al motor']}; "
              f"motor {rep['motor']} · por minuto {rep['por minuto']} · con reentrada {rep['por minuto, con reentrada']}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"mismo_llenado_{a.symbol}_f{a.fase}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
