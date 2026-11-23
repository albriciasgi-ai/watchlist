"""
Protocolo (22/11/2026), etapa 5, paso 3: ¿siguen en pie las conclusiones del usuario?

Para una regla real (con la identidad de sus corridas guardadas), en cada moneda de un grupo y en cada fase:
- la corre de nuevo con sus controles, como la app (R, azar y tramo);
- calcula tres azares más, con el mismo stop y la misma salida que el de la app:
    lados   guarda la proporción de largos y cortos de la regla también con filtros de lado (F-07);
    líneas  entra solo donde dejan la línea (VWAP o EMA) y el horario, que el azar de la app no copia (H1);
    ambos   las dos cosas.
Junta las monedas como el informe "Todas" (el azar pesado por los trades de la regla en cada moneda, con su margen)
y dice si "pasa" (ventaja sobre el azar y sobre el tramo con margen que no toca el cero, y R positivo) con el azar de
la app y con cada azar alternativo.

Uso (desde backend/): python -B tests/audit/conclusiones_etapa5.py B5 --grupo base --fases 1,2,3
Reglas: B5, CAJA, CAJA-CORTOS, FLECHA (las exactas del registro).
Escribe evidencia/etapa5/conclusiones_<regla>_<grupo>.json
"""
import argparse
import hashlib
import json
import math
import os
import random
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa5")
NAMES = {"B5": "B5. 4h · 1 de FVG nuevo, Doji @2 · OI sube", "CAJA": "Ruptura de caja con EMA 200 y CVD",
         "CAJA-CORTOS": "Ruptura de caja con EMA 200 y CVD · solo cortos", "FLECHA": "Flecha_Volumen de respuesta_VWAP"}


def user_rule(key, symbols):
    """La variante con más corridas guardadas de ese nombre en las monedas del grupo (la que sostiene sus conclusiones
    ahí); en un empate, la que más corridas tiene fuera de las acciones. Solo cortos y la flecha tienen otra variante en
    las acciones (régimen en 1D, VWAP 220) con más corridas en total."""
    import collections
    by = collections.defaultdict(list)
    for r in rt.history(None):
        if (r.get("rule") or {}).get("name") == NAMES[key] and r["rule"].get("tf") == 240:
            by[rt.rule_hash("BTCUSDT", r["rule"])].append(r)
    group = set(symbols)
    best = max(by.values(), key=lambda rs: (sum(1 for r in rs if r["symbol"] in group),
                                            sum(1 for r in rs if not rt.is_stock(r["symbol"]))))
    return best[0]["rule"]


def alt_baseline(rule, ctx, trades, symbol, sides, lines):
    """El azar de la app (mismo stop y salida, a mercado) con lo que se pida: proporción de lados de la regla también con
    filtros de lado (primero el lado, después una vela donde el filtro lo deje) y la línea y el horario."""
    n = len(ctx["T"])
    longs = sum(1 for t in trades if t["dir"] > 0) / len(trades)
    tag = f"{symbol}{rule['tf']}{n}etapa5{int(sides)}{int(lines)}"
    rng = random.Random(int(hashlib.sha1(tag.encode()).hexdigest()[:8], 16))
    base_rule = rt._random_rule(rule, trades)
    light = {**ctx, "i0": None}
    allowed = rt._allowed(ctx, n)
    tf_ms = rule["tf"] * 60000
    sided = rt._sided(rule)
    done = []

    def ok(k, side):
        if sided and not rt._side_ok(rule, ctx, k, side):
            return False
        if lines and rule.get("lines") and not rt._lines_ok(rule["lines"], ctx, k, side):
            return False
        if lines and rule.get("hours") and not rt._in_hours(rule["hours"], ctx["T"][k] + tf_ms):
            return False
        return True

    attempts = 0
    while len(done) < rt.BASE_TRADES and attempts < rt.BASE_TRADES * 3:
        attempts += 1
        side = 1 if rng.random() < longs else -1
        k = None
        for _ in range(400 if sides else 1):
            j = int(allowed[rng.randrange(len(allowed))]) if allowed is not None and len(allowed) else rng.randrange(30, n - 2)
            if ok(j, side):
                k = j
                break
        if k is None:
            continue
        light["i0"] = k
        trade = rt.simulate(base_rule, light, k, side)
        if trade and "skip" not in trade and not trade.get("open"):
            done.append(trade)
    s = rt.summary(done)
    s["largos"] = round(sum(1 for t in done if t["dir"] > 0) / len(done), 3) if done else None
    return s


def one(symbol, rule, phase_n):
    phases = [p for p in rt.phases(symbol) if p["phase"] == phase_n]
    if not phases:
        return {"moneda": symbol, "fase": phase_n, "sin fase": True}
    phase = phases[0]
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    trace = {}
    res = rt.run(symbol, rule, span, phase, measures.table_for(symbol) if rule.get("filters") else None, base=True, trace=trace)
    trades = res.get("trades") or []
    out = {"moneda": symbol, "fase": phase_n, "n": len(trades), "R": (res.get("summary") or {}).get("avgR"),
           "seR": (res.get("summary") or {}).get("seR"), "rs": [t["r"] for t in trades],
           "largos": round(sum(1 for t in trades if t["dir"] > 0) / len(trades), 3) if trades else None,
           "azar": {k: (res.get("baseline") or {}).get(k) for k in ("n", "avgR", "seR")},
           "tramo": {k: (res.get("legBaseline") or {}).get(k) for k in ("n", "avgR", "seR")}}
    if trades:
        ctx = trace["ctx"]
        for name, sides, lines in (("lados", True, False), ("lineas", False, True), ("ambos", True, True)):
            b = alt_baseline(rule, ctx, trades, symbol, sides, lines)
            out[name] = {k: b.get(k) for k in ("n", "avgR", "seR", "largos")}
    return out


def pool(rows, key):
    """El control pesado por los trades de la regla en cada moneda, con su error, como consolidated()."""
    pairs = [(r["n"], r[key]) for r in rows if r.get("n") and (r.get(key) or {}).get("n")]
    total = sum(n for n, _ in pairs)
    if not total:
        return None
    avg = sum(n * b["avgR"] for n, b in pairs) / total
    se = math.sqrt(sum((n * (b.get("seR") or 0)) ** 2 for n, b in pairs)) / total
    return avg, se


def verdict(rows):
    rs = [x for r in rows for x in r.get("rs", [])]
    if not rs:
        return {"trades": 0}
    n = len(rs)
    avg = sum(rs) / n
    sd = math.sqrt(sum((x - avg) ** 2 for x in rs) / (n - 1)) if n > 1 else 0.0
    se = sd / math.sqrt(n)
    out = {"trades": n, "R": round(avg, 3), "monedas": sum(1 for r in rows if r.get("n")),
           "monedas positivas": sum(1 for r in rows if r.get("n") and (r.get("R") or 0) > 0)}
    tramo = pool(rows, "tramo")
    for key in ("azar", "lados", "lineas", "ambos"):
        p = pool(rows, key)
        if not p:
            continue
        edge = avg - p[0]
        m = 1.96 * math.sqrt(se ** 2 + p[1] ** 2)
        out[key] = {"control": round(p[0], 3), "ventaja": round(edge, 3), "bajo": round(edge - m, 3), "alto": round(edge + m, 3)}
    if tramo:
        edge = avg - tramo[0]
        m = 1.96 * math.sqrt(se ** 2 + tramo[1] ** 2)
        out["tramo"] = {"control": round(tramo[0], 3), "ventaja": round(edge, 3), "bajo": round(edge - m, 3), "alto": round(edge + m, 3)}
    for key in ("azar", "lados", "lineas", "ambos"):
        if key in out and "tramo" in out:
            out[f"pasa con {key}"] = bool(out[key]["bajo"] > 0 and out["tramo"]["bajo"] > 0 and avg > 0)
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("regla", choices=sorted(NAMES))
    ap.add_argument("--grupo", default="base")
    ap.add_argument("--fases", default="1,2,3")
    ap.add_argument("--monedas", default="")
    a = ap.parse_args()
    symbols = rt.candle_symbols(a.grupo)
    rule = rt.clean_rule(user_rule(a.regla, symbols))
    if a.monedas:
        symbols = [x for x in symbols if x in a.monedas.split(",")]
    OUT.mkdir(parents=True, exist_ok=True)
    report = {"regla": a.regla, "nombre": NAMES[a.regla], "grupo": a.grupo, "hash": rt.rule_hash("BTCUSDT", rule), "fases": {}}
    for ph in [int(x) for x in a.fases.split(",")]:
        rows = []
        t0 = time.time()
        for sym in symbols:
            try:
                rows.append(one(sym, rule, ph))
            except Exception as e:  # una moneda que falla no detiene a las demás
                rows.append({"moneda": sym, "fase": ph, "error": repr(e)})
        v = verdict(rows)
        report["fases"][ph] = {"veredicto": v, "monedas": [{k: v2 for k, v2 in r.items() if k != "rs"} for r in rows]}
        print(f"{a.regla} {a.grupo} f{ph}: {json.dumps(v, ensure_ascii=False)} · {round(time.time() - t0)} s", flush=True)
        (OUT / f"conclusiones_{a.regla}_{a.grupo}{'_prueba' if a.monedas else ''}.json").write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
