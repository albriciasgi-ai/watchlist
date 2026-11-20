"""
Baja de Bybit el funding (futuros lineales USDT) que falte y lo guarda en OrderFlowData/funding/{moneda}.json
([[ms, tasa], ...]). Lo usa el filtro de la multitud del probador (flow_filters.py).

    python -B funding_update.py ETHUSDT SOLUSDT ...   (sin monedas: las que ya tienen archivo, más las del probador)
"""
import json
import sys
import time
from pathlib import Path

import httpx

import flow_filters

URL = "https://api.bybit.com/v5/market/funding/history"
FIRST = 1577836800000  # 2020-01-01


def update(symbol, client):
    path = Path(flow_filters.FUNDING_DIR) / f"{symbol}.json"
    rows = dict(map(tuple, json.load(open(path)))) if path.exists() else {}
    start = max(rows) + 1 if rows else FIRST
    end = int(time.time() * 1000)
    for _ in range(600):
        data = client.get(URL, params={"category": "linear", "symbol": symbol, "startTime": start, "endTime": end, "limit": 200}).json()
        found = (data.get("result") or {}).get("list") or []
        if not found:
            break
        for x in found:
            rows[int(x["fundingRateTimestamp"])] = float(x["fundingRate"])
        oldest = min(int(x["fundingRateTimestamp"]) for x in found)
        if oldest <= start or len(found) < 200:
            break
        end = oldest - 1  # Bybit da lo más nuevo primero: se sigue hacia atrás
        time.sleep(0.1)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    json.dump(sorted(rows.items()), open(partial, "w"))
    partial.replace(path)
    keys = sorted(rows)
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    print(symbol, len(keys), day(keys[0]) if keys else "-", day(keys[-1]) if keys else "-", flush=True)


if __name__ == "__main__":
    symbols = sys.argv[1:]
    if not symbols:
        import rule_tester
        have = {p.stem for p in Path(flow_filters.FUNDING_DIR).glob("*.json")}
        symbols = sorted(have | set(rule_tester.candle_symbols("all")))
    with httpx.Client(timeout=30, headers={"User-Agent": "app1-funding"}) as client:
        for s in symbols:
            try:
                update(s, client)
            except Exception as error:  # Una moneda que falla no detiene a las demás
                print(s, "falló:", error, flush=True)
