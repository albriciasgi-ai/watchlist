"""
Baja de Bybit el Open Interest de 4 horas que falte y lo guarda en OrderFlowData/oi/{moneda}_4h.json ([[ms, oi], ...]).
Lo usa el filtro de OI del probador (flow_filters.py) en las monedas sin serie de 5 minutos.

    python -B oi_update.py ETHUSDT SOLUSDT ...      (sin monedas: las que ya tienen archivo)
"""
import json
import sys
import time
from pathlib import Path

import httpx

import oi_store

URL = "https://api.bybit.com/v5/market/open-interest"
FIRST = 1577836800000  # 2020-01-01


def update(symbol):
    path = Path(oi_store.OI_DIR) / f"{symbol}_4h.json"
    rows = dict(map(tuple, json.load(open(path)))) if path.exists() else {}
    have = sorted(rows)
    end = int(time.time() * 1000)
    # Lo que falta al final y, si el archivo no empieza en lo más viejo, al principio
    spans = [(have[-1] + 1, end)] if have else [(FIRST, end)]
    if have and have[0] > FIRST + 14 * 86400000:
        spans.append((FIRST, have[0] - 1))
    with httpx.Client(timeout=20, headers={"User-Agent": "app1-oi"}) as client:
        for start, t1 in spans:
            for _ in range(400):
                data = client.get(URL, params={"category": "linear", "symbol": symbol, "intervalTime": "4h",
                                               "startTime": start, "endTime": t1, "limit": 200}).json()
                found = (data.get("result") or {}).get("list") or []
                if not found:
                    break
                for x in found:
                    rows[int(x["timestamp"])] = float(x["openInterest"])
                t1 = min(int(x["timestamp"]) for x in found) - 1
                if t1 <= start:
                    break
                time.sleep(0.12)
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    json.dump(sorted(rows.items()), open(partial, "w"))
    partial.replace(path)
    keys = sorted(rows)
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    print(symbol, len(keys), day(keys[0]) if keys else "-", day(keys[-1]) if keys else "-", flush=True)


if __name__ == "__main__":
    symbols = sys.argv[1:] or sorted(p.name.split("_")[0] for p in Path(oi_store.OI_DIR).glob("*_4h.json"))
    for s in symbols:
        update(s)
