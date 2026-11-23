"""
Protocolo (22/11/2026), etapa 6, sección 10: los sesgos B-02 a B-09, medidos (no se corrige nada).

  b02  arranque en frío (H2): la regla en la fase 2 y la 3 con las velas de su fase (como la app) contra la misma
       regla con 600 velas de la fase anterior delante para calentar (sin operar en ellas): señales que se pierden al
       empezar la fase y trades que cambian.
  b03  censura al final de la fase (H6): los trades abiertos al terminar la fase 1 y la 2, resueltos con las velas de
       la fase siguiente: cuántos son y su R.
  b05  deslizamiento: el R de las candidatas con 0.02% y 0.05% por lado en cada llenado a mercado (entrada a mercado,
       stop, tiempo, señal contraria, salida del canal y stop arrastrado; no en el objetivo, que es una orden limit).
  b06  funding no cobrado: lo que habrían pagado o cobrado las posiciones abiertas en cada liquidación de funding, en R.
  b07  azar repartido como la regla: el azar de cada trimestre y lado (baseline.quarters) pesado por los trades de la
       regla en ese trimestre y lado, contra el azar de toda la fase.
  b08  trades que se mueven juntos (H10): el margen de "Todas" (trades independientes) contra un bootstrap por semanas.
  b09  muchas variantes: las variantes distintas de cada nombre de regla en el registro.

Las candidatas son las reglas exactas del usuario (conclusiones_etapa5.user_rule): B5, CAJA, CAJA-CORTOS y FLECHA, en
las 7 monedas de siempre, con sus corridas guardadas.

Uso (desde backend/): python -B tests/audit/sesgos.py b05 [b06 ...]
Escribe evidencia/etapa6/sesgos_<b>.json
"""
import bisect
import collections
import copy
import datetime as dt
import json
import math
import os
import random
import statistics
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import conclusiones_etapa5 as c5  # noqa: E402
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6")
FUNDING = Path(r"C:\Users\inven\OrderFlowData\funding")
KEYS = ("B5", "CAJA", "CAJA-CORTOS", "FLECHA")
MARKET_EXITS = {"stop", "tiempo", "señal contraria", "sale del canal", "stop arrastrado", "stop en la entrada", "hueco de datos"}


def stored_runs(key, phase):
    """La última corrida guardada de la regla exacta del usuario en cada moneda de siempre, en esa fase."""
    symbols = rt.candle_symbols("base")
    rule = c5.user_rule(key, symbols)
    digest = rt.rule_hash("BTCUSDT", rule)
    out = {}
    for r in rt.history(None):
        if r["symbol"] in symbols and r["phase"] == phase and rt.rule_hash("BTCUSDT", r["rule"]) == digest:
            out[r["symbol"]] = r["id"]  # el último manda
    return rule, {s: rt.load_run(i) for s, i in out.items()}


def mean_ci(xs):
    if not xs:
        return None
    m = statistics.fmean(xs)
    se = statistics.stdev(xs) / math.sqrt(len(xs)) if len(xs) > 1 else float("nan")
    return {"n": len(xs), "avgR": round(m, 4), "low": round(m - 1.96 * se, 4), "high": round(m + 1.96 * se, 4)}


def b05():
    out = {}
    for key in KEYS:
        for phase in (1, 2, 3):
            rule, runs = stored_runs(key, phase)
            if not runs:
                continue
            rows = {}
            for slip in (0.0, 0.0002, 0.0005):
                rs = []
                for res in runs.values():
                    for t in res["trades"]:
                        cost = 0.0
                        if t.get("order", "market") == "market":
                            cost += slip * t["entry"]
                        if t["reason"] in MARKET_EXITS:
                            cost += slip * t["exit"]
                        rs.append(t["r"] - cost / t["risk"] if t["risk"] > 0 else t["r"])
                rows[f"{slip * 100:.2f}% por lado"] = mean_ci(rs)
            base = rows["0.00% por lado"]["avgR"]
            for k, v in rows.items():
                v["cambio"] = round(v["avgR"] - base, 4)
            out[f"{key} f{phase}"] = {"monedas": len(runs), **rows}
            print(key, phase, json.dumps(rows, ensure_ascii=False), flush=True)
    return out


def funding_series(symbol):
    path = FUNDING / f"{symbol}.json"
    if not path.exists():
        return None
    pairs = json.loads(path.read_text(encoding="utf-8"))
    return [p[0] for p in pairs], [p[1] for p in pairs]


def b06():
    out = {}
    cache = {}
    for key in KEYS:
        for phase in (1, 2, 3):
            rule, runs = stored_runs(key, phase)
            if not runs:
                continue
            base, adj, paid = [], [], []
            missing = 0
            for symbol, res in runs.items():
                if symbol not in cache:
                    cache[symbol] = funding_series(symbol)
                fs = cache[symbol]
                for t in res["trades"]:
                    base.append(t["r"])
                    if fs is None or t["risk"] <= 0:
                        missing += 1
                        adj.append(t["r"])
                        continue
                    ts, rates = fs
                    i0, i1 = bisect.bisect_right(ts, t["entry_t"]), bisect.bisect_right(ts, t["exit_t"])
                    # Cada liquidación con la posición abierta: el largo paga la tasa positiva y el corto la cobra
                    f = -t["dir"] * sum(rates[i0:i1]) * t["entry"] / t["risk"]
                    paid.append(f)
                    adj.append(t["r"] + f)
            out[f"{key} f{phase}"] = {"monedas": len(runs), "sin funding": missing, "R": mean_ci(base), "R con funding": mean_ci(adj),
                                      "funding medio por trade (R)": round(statistics.fmean(paid), 4) if paid else None,
                                      "funding total (R)": round(sum(paid), 2) if paid else None}
            print(key, phase, json.dumps(out[f"{key} f{phase}"], ensure_ascii=False), flush=True)
    return out


def b07():
    out = {}
    for key in KEYS:
        for phase in (1, 2, 3):
            rule, runs = stored_runs(key, phase)
            if not runs:
                continue
            app_num = app_den = q_num = q_den = 0.0
            lacking = 0
            for symbol, res in runs.items():
                b = res.get("baseline") or {}
                n = len(res["trades"])
                if not n or not b.get("n"):
                    continue
                app_num += n * b["avgR"]
                app_den += n
                quarters = b.get("quarters") or {}
                for t in res["trades"]:
                    q = rt.quarter_of(t["signal"])
                    cell = (quarters.get(q) or {}).get(str(t["dir"]))
                    if not cell or not cell[0]:
                        lacking += 1
                        continue
                    q_num += cell[1] / cell[0]
                    q_den += 1
            r_all = [t["r"] for res in runs.values() for t in res["trades"]]
            row = {"monedas": len(runs), "trades": len(r_all), "R": round(statistics.fmean(r_all), 4) if r_all else None,
                   "azar de la fase (pesado por moneda)": round(app_num / app_den, 4) if app_den else None,
                   "azar de su trimestre y lado": round(q_num / q_den, 4) if q_den else None, "trades sin azar en su trimestre": lacking}
            if row["R"] is not None and row["azar de la fase (pesado por moneda)"] is not None and row["azar de su trimestre y lado"] is not None:
                row["ventaja con el azar de la fase"] = round(row["R"] - row["azar de la fase (pesado por moneda)"], 4)
                row["ventaja con el azar repartido como la regla"] = round(row["R"] - row["azar de su trimestre y lado"], 4)
            out[f"{key} f{phase}"] = row
            print(key, phase, json.dumps(row, ensure_ascii=False), flush=True)
    return out


def b08():
    out = {}
    rng = random.Random(2026)
    for key in KEYS:
        for phase in (1, 2, 3):
            rule, runs = stored_runs(key, phase)
            trades = [t for res in runs.values() for t in res["trades"]]
            if len(trades) < 30:
                continue
            rs = [t["r"] for t in trades]
            normal = mean_ci(rs)
            weeks = collections.defaultdict(list)
            for t in trades:
                weeks[t["exit_t"] // (7 * 86400000)].append(t["r"])
            groups = list(weeks.values())
            means = []
            for _ in range(4000):
                pick = [groups[rng.randrange(len(groups))] for _ in range(len(groups))]
                flat = [x for g in pick for x in g]
                means.append(statistics.fmean(flat))
            means.sort()
            lo, hi = means[int(0.025 * len(means))], means[int(0.975 * len(means)) - 1]
            row = {"monedas": len(runs), "trades": len(rs), "semanas": len(groups), "margen normal": [normal["low"], normal["high"]],
                   "margen por semanas": [round(lo, 4), round(hi, 4)],
                   "ancho normal": round(normal["high"] - normal["low"], 4), "ancho por semanas": round(hi - lo, 4)}
            row["veces más ancho"] = round(row["ancho por semanas"] / row["ancho normal"], 2) if row["ancho normal"] else None
            out[f"{key} f{phase}"] = row
            print(key, phase, json.dumps(row, ensure_ascii=False), flush=True)
    return out


def b09():
    by_name = collections.defaultdict(set)
    by_name_phase = collections.defaultdict(set)
    runs = rt.history(None)
    for r in runs:
        name = (r.get("rule") or {}).get("name")
        digest = rt.rule_hash("BTCUSDT", r["rule"])
        by_name[name].add(digest)
        by_name_phase[(name, r["phase"])].add(digest)
    top = sorted(by_name.items(), key=lambda kv: -len(kv[1]))[:15]
    return {"corridas": len(runs), "nombres": len(by_name), "variantes por nombre (las 15 con más)": {k: len(v) for k, v in top},
            "variantes de la fase 1 por nombre (las 15 con más)": {f"{k[0]} f{k[1]}": len(v) for k, v in sorted(by_name_phase.items(), key=lambda kv: -len(kv[1]))[:15]}}


def extended_span(symbol, tf, phase, rule, before=None, after=None):
    """El tramo de la fase con velas de la fase anterior delante (before) o de la siguiente detrás (after)."""
    span = rt.detect_span(symbol, tf, phase, rule)
    bars = list(span["bars"])
    phases = {p["phase"]: p for p in rt.phases(symbol)}
    if before:
        prev = phases.get(phase["phase"] - 1)
        if prev:
            pb = rt.detect_span(symbol, tf, prev, rule)["bars"]
            bars = pb[-before:] + bars
    if after:
        nxt = phases.get(phase["phase"] + 1)
        if nxt:
            nb = rt.detect_span(symbol, tf, nxt, rule)["bars"]
            bars = bars + nb[:after]
    return {**span, "bars": bars}


B02_RULES = ("R20", "R16", "R19a", "FL-EMA", "FL-VWAP", "FL-REG", "E-BS", "E-QB", "E-WF", "FL-ALLs", "FL-PD", "E-RF")


def key_of(t):
    return (t["signal"], t["dir"], t["entry_t"], t["exit_t"], round(t["r"], 4))


def b02():
    out = {}
    for name in B02_RULES:
        rule = rt.clean_rule(copy.deepcopy(rp.RULES[name]))
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT"):
            for n in (2, 3):
                phase = next(p for p in rt.phases(symbol) if p["phase"] == n)
                span = rt.detect_span(symbol, rule["tf"], phase, rule)
                table = measures.table_for(symbol) if rule.get("filters") else None
                cold = rt.run(symbol, rule, span, phase, table, base=False)
                warm_span = extended_span(symbol, rule["tf"], phase, rule, before=600)
                warm = rt.run(symbol, rule, warm_span, phase, table, base=False)
                start = phase["start"]
                wt = [t for t in warm["trades"] if t["signal"] >= start]
                ct = cold["trades"]
                a, b = {key_of(t) for t in ct}, {key_of(t) for t in wt}
                first = sorted(t["signal"] for t in wt)
                tf_ms = rule["tf"] * 60000
                lost_start = sum(1 for t in wt if key_of(t) not in a and t["signal"] < start + 300 * tf_ms)
                row = {"trades en frío": len(ct), "trades con historia": len(wt), "iguales": len(a & b),
                       "solo con historia": len(b - a), "solo en frío": len(a - b),
                       "solo con historia en las primeras 300 velas": lost_start,
                       "R en frío": round(statistics.fmean([t["r"] for t in ct]), 4) if ct else None,
                       "R con historia": round(statistics.fmean([t["r"] for t in wt]), 4) if wt else None,
                       "primera señal con historia": rt._iso(first[0]) if first else None,
                       "primera señal en frío": rt._iso(min(t["signal"] for t in ct)) if ct else None}
                out[f"{name} {symbol} f{n}"] = row
                print(name, symbol, n, json.dumps(row, ensure_ascii=False), flush=True)
    return out


B03_RULES = ("R20", "R16", "R19a", "R05e", "R08c")


def b03():
    out = {}
    for name in B03_RULES:
        rule = rt.clean_rule(copy.deepcopy(rp.RULES[name]))
        for symbol in ("BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "GALAUSDT", "SUIUSDT", "TRXUSDT"):
            for n in (1, 2):
                phase = next((p for p in rt.phases(symbol) if p["phase"] == n), None)
                if phase is None or not phase["available"]:
                    continue
                span = rt.detect_span(symbol, rule["tf"], phase, rule)
                table = measures.table_for(symbol) if rule.get("filters") else None
                base = rt.run(symbol, rule, span, phase, table, base=False)
                if not base.get("success", True):
                    continue
                ext = rt.run(symbol, rule, extended_span(symbol, rule["tf"], phase, rule, after=400), phase, table, base=False)
                end = phase["end"]
                done = {key_of(t) for t in base["trades"]}
                resolved = [t for t in ext["trades"] if t["signal"] < end and t["exit_t"] >= end and key_of(t) not in done]
                rs = [t["r"] for t in base["trades"]]
                row = {"trades": len(rs), "abiertos al final": base.get("open"), "resueltos": len(resolved),
                       "R de los abiertos": [round(t["r"], 3) for t in resolved],
                       "R medio": round(statistics.fmean(rs), 4) if rs else None,
                       "R medio contándolos": round(statistics.fmean(rs + [t["r"] for t in resolved]), 4) if rs or resolved else None}
                out[f"{name} {symbol} f{n}"] = row
                print(name, symbol, n, json.dumps(row, ensure_ascii=False), flush=True)
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    OUT.mkdir(parents=True, exist_ok=True)
    for which in sys.argv[1:]:
        t0 = time.time()
        got = globals()[which]()
        (OUT / f"sesgos_{which}.json").write_text(json.dumps(got, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        print(f"== {which} en {round(time.time() - t0)} s", flush=True)


if __name__ == "__main__":
    main()
