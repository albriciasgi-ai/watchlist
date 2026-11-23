"""
Protocolo (22/11/2026), etapa 6, B-04 (H7, monedas sobrevivientes): las 43 monedas nuevas son las de más volumen HOY
entre las que cotizaban antes de 2022; ninguna es de las que Bybit dejó de listar. Aquí:

  bajar   la lista pública de perpetuos USDT cerrados de Bybit; los que empezaron antes de 2022 y cerraron después
          del 01/01/2022, con sus velas de 1h y 4h (API pública, sin datos del usuario), en una carpeta APARTE de la
          evidencia (no en OrderFlowData/candles, que usa la app del usuario). Se quedan las 20 de más volumen en 2022
          con al menos 120 días de velas.
  correr  tres reglas del usuario (Ruptura de caja con EMA 200 y CVD, Flecha con VWAP 200 e Impulso) en la fase 1 de
          esas monedas, con el probador apuntando a esa carpeta (TESTER_CANDLES), contra lo mismo en las 43 nuevas.

Uso (desde backend/): python -B tests/audit/sobrevivientes.py bajar | correr
"""
import gzip
import json
import os
import statistics
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
EV = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6")
FOLDER = EV / "velas_sobrevivientes_120d"  # la primera bajada (300 días) quedó en velas_sobrevivientes
Y2022, Y2023 = 1640995200000, 1672531200000
RULES = ("R16", "R19a", "E-IM")


def bajar():
    sys.path.insert(0, str(HERE))
    import bybit_api as ba
    rows, cursor = [], ""
    for _ in range(20):
        params = {"category": "linear", "status": "Closed", "limit": 1000}
        if cursor:
            params["cursor"] = cursor
        res = ba._get("/v5/market/instruments-info", params) or {}
        rows += res.get("list", [])
        cursor = res.get("nextPageCursor") or ""
        if not cursor:
            break
    perps = [x for x in rows if x.get("contractType") == "LinearPerpetual" and x.get("quoteCoin") == "USDT"
             and int(x.get("launchTime") or 0) < Y2022 and int(x.get("deliveryTime") or 0) > Y2022]
    print(f"cerrados: {len(rows)}; perpetuos USDT de antes de 2022 cerrados después: {len(perps)}", flush=True)
    FOLDER.mkdir(parents=True, exist_ok=True)
    got = []
    for x in perps:
        sym = x["symbol"]
        start, end = int(x["launchTime"]), int(x["deliveryTime"])
        try:
            h4 = ba.klines(sym, 240, start, end)
        except Exception as e:  # una moneda que falla no detiene a las demás
            print(sym, "sin velas:", e, flush=True)
            continue
        if not h4 or len(h4) < 120 * 6:  # 120 días: así entran las que se hundieron pronto, como LUNA (213 días)
            print(sym, "pocas velas", len(h4 or []), flush=True)
            continue
        turnover = sum(c[4] * c[5] for c in h4 if Y2022 <= c[0] < Y2023)
        got.append((turnover, sym, start, end, h4))
        print(sym, len(h4), "velas de 4h", round(turnover / 1e9, 2), "mil millones en 2022", flush=True)
    got.sort(reverse=True)
    keep = got[:20]
    listing = []
    for turnover, sym, start, end, h4 in keep:
        h1 = ba.klines(sym, 60, start, end)
        with gzip.open(FOLDER / f"{sym}.json.gz", "wt", encoding="utf-8") as fh:
            json.dump({"60": h1, "240": h4}, fh)
        listing.append({"symbol": sym, "desde": start, "hasta": end, "velas_4h": len(h4), "velas_1h": len(h1), "volumen_2022": turnover})
    (EV / "sobrevivientes_lista.json").write_text(json.dumps({"cerrados": len(rows), "candidatos": len(perps), "elegidos": listing},
                                                            ensure_ascii=False, indent=1), encoding="utf-8")
    print("elegidos:", [x["symbol"] for x in listing], flush=True)


def correr():
    # El probador lee las monedas nuevas de TESTER_CANDLES: en otro proceso, apuntando a la carpeta aparte
    code = f"""
import os, sys, json, statistics
sys.path.insert(0, r'{HERE}'); sys.path.insert(0, r'{HERE.parents[1]}'); os.chdir(r'{HERE.parents[1]}')
import reglas_prueba as rp, rule_tester as rt
out = {{}}
for name in {list(RULES)!r}:
    rule = rt.clean_rule(rp.RULES[name])
    for group in ("new",):
        rows = {{}}
        for sym in rt.candle_symbols(group):
            ph = next((p for p in rt.phases(sym) if p["phase"] == 1), None)
            if ph is None or not ph["available"]:
                continue
            span = rt.detect_span(sym, rule["tf"], ph, rule)
            res = rt.run(sym, rule, span, ph, None, base=True)
            if not res.get("success", True):
                continue
            s = res.get("summary") or {{}}
            rows[sym] = {{"trades": s.get("n"), "avgR": s.get("avgR"), "azar": (res.get("baseline") or {{}}).get("avgR"),
                          "tramo": (res.get("legBaseline") or {{}}).get("avgR"), "desde": ph["from"], "hasta": ph["to"],
                          "R": [t["r"] for t in res["trades"]]}}
        out[name] = rows
print(json.dumps(out))
"""
    results = {}
    for label, folder in (("sobrevivientes", str(FOLDER)), ("nuevas", r"C:\Users\inven\OrderFlowData\candles")):
        env = {**os.environ, "TESTER_CANDLES": folder, "TESTER_AUTO_UPDATE": "0",
               "ORDERFLOW_OBSERVER": r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado"}
        t0 = time.time()
        p = subprocess.run([sys.executable, "-X", "utf8", "-B", "-c", code], capture_output=True, text=True, env=env, encoding="utf-8")
        if p.returncode:
            print(label, "falló:", p.stderr[-2000:], flush=True)
            continue
        results[label] = json.loads(p.stdout.strip().splitlines()[-1])
        print(label, "listo en", round(time.time() - t0), "s", flush=True)
    summary = {}
    for name in RULES:
        for label, data in results.items():
            rows = data.get(name, {})
            rs = [x for r in rows.values() for x in r["R"]]
            pos = sum(1 for r in rows.values() if r["avgR"] is not None and r["avgR"] > 0)
            n = sum(r["trades"] or 0 for r in rows.values())
            az = sum((r["azar"] or 0) * (r["trades"] or 0) for r in rows.values()) / n if n else None
            summary[f"{name} · {label}"] = {"monedas": len(rows), "con R positivo": pos, "trades": len(rs),
                                           "R": round(statistics.fmean(rs), 4) if rs else None, "azar (pesado)": round(az, 4) if az is not None else None}
            print(name, label, json.dumps(summary[f"{name} · {label}"], ensure_ascii=False), flush=True)
    for data in results.values():
        for rows in data.values():
            for r in rows.values():
                r.pop("R", None)
    (EV / "sesgos_b04.json").write_text(json.dumps({"resumen": summary, "por moneda": results}, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    globals()[sys.argv[1]]()
