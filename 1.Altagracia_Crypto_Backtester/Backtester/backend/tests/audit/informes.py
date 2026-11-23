"""
Protocolo (22/11/2026), etapa 4, sección 9.5: los informes del probador, recalculados aparte desde las corridas
guardadas (I-11).

  Todas   la unión de las corridas de cada moneda: resumen de todos los trades, azar pesado por los trades de la regla
          en cada moneda, ventaja y su margen, fila por moneda, por año y por lado.
  CSV     cada fila y columna contra la corrida, con las horas en UTC.
  Sens.   cada variante de la sensibilidad, corrida aparte, da lo mismo.

Uso (desde backend/): python -B tests/audit/informes.py [--reglas 3] [--sensibilidad BTCUSDT]
"""
import argparse
import collections
import csv
import datetime as dt
import io
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import rule_tester as rt  # noqa: E402
from invariantes import i11_cuentas, wilson  # noqa: E402,F401

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\informes")


def utc(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc)


def candidates(top):
    """Reglas a mercado con corridas de la fase 1 en 5 o más de las monedas de siempre (las que no quedaron fuera)."""
    base = set(rt.candle_symbols("base"))
    seen = collections.defaultdict(dict)
    for r in rt.history(None):
        if r["phase"] == 1 and r["symbol"] in base and (r.get("rule") or {}).get("entry", {}).get("type") == "market":
            # La identidad de la regla sin la moneda (como el tablero: rule_hash con un símbolo fijo)
            seen[rt.rule_hash("BTCUSDT", r["rule"])][r["symbol"]] = r
    good = [(h, rows) for h, rows in seen.items() if len(rows) >= 5]
    good.sort(key=lambda hr: -sum(1 for _ in hr[1]))
    return good[:top]


def todas(rule, phase=1):
    out = rt.consolidated(rule, phase, "base")
    if not out.get("success"):
        return {"error": out.get("message")}
    runs = [rt.load_run(row["run"]) for row in out["symbols"]]
    trades = [t for res in runs for t in res["trades"]]
    res_like = {"trades": trades, "summary": out["summary"]}
    sums = i11_cuentas(res_like) if trades else {"ok": True}
    # Azar pesado por los trades de la regla en cada moneda
    pairs = [(res["summary"]["n"], res.get("baseline") or {}) for res in runs if res["summary"].get("n") and (res.get("baseline") or {}).get("n")]
    total = sum(n for n, _ in pairs)
    base = sum(n * b["avgR"] for n, b in pairs) / total
    base_se = math.sqrt(sum((n * b["seR"]) ** 2 for n, b in pairs)) / total
    s = out["summary"]
    edge = s["avgR"] - base
    se = math.sqrt(s["seR"] ** 2 + base_se ** 2)
    mine_edge = {"r": round(edge, 3), "low": round(edge - 1.96 * se, 3), "high": round(edge + 1.96 * se, 3)}
    theirs = {k: out["edge"][k] for k in ("r", "low", "high")} if out.get("edge") else None
    # Una fila por moneda: la de su corrida
    rows_ok = all(row["n"] == res["summary"].get("n", 0) and row["avgR"] == res["summary"].get("avgR") for row, res in zip(out["symbols"], runs))
    # Por año y por lado
    by_year = collections.defaultdict(list)
    for t in trades:
        by_year[str(utc(t["entry_t"]).year)].append(t["r"])
    years_ok = all(abs(y["avgR"] - round(sum(by_year[y["label"]]) / len(by_year[y["label"]]), 3)) < 1e-9 and y["n"] == len(by_year[y["label"]])
                   for y in out.get("byYear", [])) if out.get("byYear") and "label" in out["byYear"][0] else None
    sides = {1: [t["r"] for t in trades if t["dir"] > 0], -1: [t["r"] for t in trades if t["dir"] < 0]}
    side_ok = all(abs(row["avgR"] - round(sum(sides[1 if row.get("label") == "Largos" else -1]) / max(1, len(sides[1 if row.get("label") == "Largos" else -1])), 3)) < 1e-9
                  for row in out.get("bySide", [])) if out.get("bySide") and "label" in out["bySide"][0] else None
    # Constancia por trimestre (CLAUDE.md, "Multitud, OI sostenido y constancia por trimestre"): cada trade contra el
    # azar de su trimestre UTC y su lado en su moneda (el azar guardado en la corrida); los trimestres de 20 trades o
    # más; cuántos quedan sobre el azar, la mediana de la ventaja por trade y qué parte ponen los 4 mejores. Un
    # trimestre con pocas entradas al azar de ese lado usa el azar de toda la corrida (mínimo 10, que no está escrito).
    pooled = collections.defaultdict(lambda: [0, 0.0, 0.0])
    for res in runs:
        base = res.get("baseline") or {}
        qs, fallback = base.get("quarters") or {}, base.get("avgR") or 0.0
        for t in res["trades"]:
            d = utc(t["entry_t"])
            q = f"{d.year}T{(d.month - 1) // 3 + 1}"
            n, tot = (qs.get(q) or {}).get(str(t["dir"]), [0, 0.0])
            ctrl = tot / n if n >= 10 else fallback
            cell = pooled[q]
            cell[0] += 1
            cell[1] += t["r"]
            cell[2] += t["r"] - ctrl
    rows = [(q, n, e) for q, (n, _, e) in sorted(pooled.items()) if n >= 20]
    mine_c = None
    if rows:
        edges = sorted((round(e / n, 3) for _, n, e in rows))  # La mediana de lo que muestra la tabla (cada trimestre a 3 decimales)
        mid = len(edges) // 2
        median = edges[mid] if len(edges) % 2 else (edges[mid - 1] + edges[mid]) / 2
        total = sum(round(e, 2) for _, _, e in rows)
        top4 = sum(sorted((round(e, 2) for _, _, e in rows), reverse=True)[:4])
        mine_c = {"total": len(rows), "positive": sum(1 for _, _, e in rows if round(e, 2) > 0), "median": round(median, 3),
                  "top4Share": round(top4 / total, 3) if total > 0 else None}
    app_c = out.get("consistency") or {}
    theirs_c = {k: app_c.get(k) for k in ("total", "positive", "median", "top4Share")} if app_c else None
    return {"monedas": len(runs), "trades": len(trades), "resumen": sums, "ventaja de la app": theirs, "ventaja recalculada": mine_edge,
            "ventaja igual": theirs == mine_edge, "filas por moneda iguales": rows_ok, "por año": years_ok, "por lado": side_ok,
            "monedas positivas": out.get("positive"), "positivas recalculadas": sum(1 for res in runs if (res["summary"].get("avgR") or 0) > 0),
            "constancia de la app": theirs_c, "constancia recalculada": mine_c, "constancia igual": theirs_c == mine_c}


def csv_check(run_id):
    res = rt.load_run(run_id)
    text = rt.export_csv(run_id)
    rows = list(csv.reader(io.StringIO(text)))
    head, body = rows[0], rows[1:]
    bad = []
    if len(body) != len(res["trades"]):
        bad.append(f"filas {len(body)} contra {len(res['trades'])} trades")
    if any(len(r) != len(head) for r in body):
        bad.append("filas con otra cantidad de columnas (¿una coma dentro de un valor?)")
    col = {name: i for i, name in enumerate(head)}
    for t, r in zip(res["trades"], body):
        checks = {"n": str(t["n"]), "lado": "largo" if t["dir"] > 0 else "corto", "senal_utc": utc(t["signal"]).strftime("%Y-%m-%d %H:%M"),
                  "entrada_utc": utc(t["entry_t"]).strftime("%Y-%m-%d %H:%M"), "salida_utc": utc(t["exit_t"]).strftime("%Y-%m-%d %H:%M"),
                  "motivo": t["reason"], "r_neto": str(t["r"]), "velas": str(t["bars"])}
        for name, want in checks.items():
            if r[col[name]] != want:
                bad.append(f"trade {t['n']}: {name} {r[col[name]]!r} contra {want!r}")
                break
    return {"corrida": run_id, "filas": len(body), "columnas": len(head), "problemas": bad[:8], "ok": not bad}


def sens_check(symbol, rule_raw):
    rule = rt.clean_rule(rule_raw)
    out = rt.sensitivity(symbol, rule_raw)
    if not out.get("success"):
        return {"error": out.get("message")}
    phase = next(p for p in rt.phases(symbol) if p["phase"] == 1)
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule["filters"] else None
    bad = []
    for row in out["rows"]:
        label = row["label"]
        variant = dict(rule)
        if label.startswith("Objetivo "):
            variant = {**rule, "exit": {**rule["exit"], "targetR": float(label.split()[1])}}
        elif label.startswith("Ventana "):
            variant = {**rule, "recipe": {**rule["recipe"], "window": int(label.split()[1])}}
        elif label.startswith("Margen del stop "):
            variant = {**rule, "stop": {**rule["stop"], "buffer": float(label.split()[3])}}
        elif label != "Regla actual":
            bad.append(f"variante sin recalcular: {label}")
            continue
        mine = rt.run(symbol, variant, span, phase, table, base=False)["summary"]
        if (mine.get("n"), mine.get("avgR")) != (row["n"], row["avgR"]):
            bad.append(f"{label}: {row['n']} y {row['avgR']} contra {mine.get('n')} y {mine.get('avgR')}")
    return {"variantes": len(out["rows"]), "problemas": bad, "ok": not bad}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--reglas", type=int, default=3)
    ap.add_argument("--sensibilidad", default="BTCUSDT")
    a = ap.parse_args()
    rep = {"todas": [], "csv": [], "sensibilidad": None}
    for digest, rows in candidates(a.reglas):
        rule = next(iter(rows.values()))["rule"]
        name = rule.get("name") or digest[:8]
        t = todas(rule)
        t["regla"] = name
        rep["todas"].append(t)
        print(f"Todas · {name}: {t.get('monedas')} monedas, {t.get('trades')} trades · resumen {'bien' if t.get('resumen', {}).get('ok') else t.get('resumen')}"
              f" · ventaja {'igual' if t.get('ventaja igual') else (t.get('ventaja de la app'), t.get('ventaja recalculada'))}"
              f" · filas {t.get('filas por moneda iguales')} · año {t.get('por año')} · lado {t.get('por lado')}"
              f" · positivas {t.get('monedas positivas')}/{t.get('positivas recalculadas')}", flush=True)
        for sym, r in list(rows.items())[:2]:
            c = csv_check(r["id"])
            rep["csv"].append(c)
            print(f"CSV {r['id']}: {c['filas']} filas, {c['columnas']} columnas · {'bien' if c['ok'] else c['problemas']}", flush=True)
    sens_rule = {**next(iter(candidates(1)[0][1].values()))["rule"]} if candidates(1) else None
    if sens_rule:
        rep["sensibilidad"] = sens_check(a.sensibilidad, sens_rule)
        print("Sensibilidad:", rep["sensibilidad"], flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "informes.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
