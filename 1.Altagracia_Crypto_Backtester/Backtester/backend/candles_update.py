"""
Velas de 1 hora y 4 horas de Bybit (futuros lineales USDT) para el probador, en OrderFlowData/candles/{moneda}.json.gz:
{"60": [[ms, o, h, l, c, volumen], ...], "240": [...]}. Son las monedas "nuevas" del probador: no tienen caché de App 1
ni almacén de trades, así que corren solo con los elementos hechos con velas (rule_tester.CANDLE_CODES).

    python -B candles_update.py --pick 43        elige las 43 de más volumen que cotizan desde antes de 2022 y las baja
    python -B candles_update.py                  actualiza las que ya tienen archivo
    python -B candles_update.py XRPUSDT DOGEUSDT las nombradas
"""
import gzip
import json
import os
import sys
import time
from pathlib import Path

import httpx

DIR = Path(os.environ.get("TESTER_CANDLES", r"C:\Users\inven\OrderFlowData\candles"))
BASE = "https://api.bybit.com/v5/market"
FIRST = 1577836800000          # 2020-01-01
LISTED_BEFORE = 1640995200000  # 2022-01-01: así la moneda tiene las tres fases del probador
SKIP = {"BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "GALAUSDT", "SUIUSDT", "TRXUSDT",  # Las de App 1
        "USDCUSDT", "USDEUSDT", "FDUSDUSDT", "DAIUSDT", "TUSDUSDT", "BUSDUSDT", "USTCUSDT", "PAXGUSDT", "XAUTUSDT"}
TFS = ("60", "240")


def _client():
    return httpx.Client(timeout=30, headers={"User-Agent": "app1-candles"})


def pick(n):
    """Las n monedas de más volumen en 24 h que cotizan desde antes de 2022."""
    with _client() as c:
        listed, cursor = {}, ""
        while True:
            r = c.get(f"{BASE}/instruments-info", params={"category": "linear", "limit": 1000, "cursor": cursor}).json()["result"]
            for x in r["list"]:
                if x["quoteCoin"] == "USDT" and x.get("contractType") == "LinearPerpetual" and x["status"] == "Trading":
                    listed[x["symbol"]] = int(x.get("launchTime") or 0)
            cursor = r.get("nextPageCursor") or ""
            if not cursor:
                break
        tickers = c.get(f"{BASE}/tickers", params={"category": "linear"}).json()["result"]["list"]
    ranked = sorted(tickers, key=lambda t: -float(t.get("turnover24h") or 0))
    return [t["symbol"] for t in ranked if t["symbol"] in listed and t["symbol"] not in SKIP and 0 < listed[t["symbol"]] < LISTED_BEFORE][:n]


def _load(symbol):
    path = DIR / f"{symbol}.json.gz"
    if not path.exists():
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def update(symbol, client):
    data = _load(symbol)
    now = int(time.time() * 1000)
    for tf in TFS:
        rows = {r[0]: r for r in data.get(tf, [])}
        step = int(tf) * 60000
        start = max(rows) + step if rows else FIRST
        while start < now:
            end = min(now, start + 1000 * step)
            found = client.get(f"{BASE}/kline", params={"category": "linear", "symbol": symbol, "interval": tf,
                                                        "start": start, "end": end, "limit": 1000}).json()
            lst = (found.get("result") or {}).get("list") or []
            for k in lst:
                t = int(k[0])
                rows[t] = [t, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])]
            start = end + 1 if not lst else max(int(k[0]) for k in lst) + step
            time.sleep(0.08)
        data[tf] = [rows[t] for t in sorted(rows)]
    DIR.mkdir(parents=True, exist_ok=True)
    partial = DIR / f"{symbol}.tmp"
    with gzip.open(partial, "wt", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    partial.replace(DIR / f"{symbol}.json.gz")
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    h4 = data.get("240") or []
    print(symbol, len(data.get("60") or []), len(h4), day(h4[0][0]) if h4 else "-", day(h4[-1][0]) if h4 else "-", flush=True)


if __name__ == "__main__":
    args = sys.argv[1:]
    if args[:1] == ["--pick"]:
        symbols = pick(int(args[1]) if len(args) > 1 else 43)
        print("Elegidas:", " ".join(symbols), flush=True)
    else:
        symbols = args or sorted(p.name.split(".")[0] for p in DIR.glob("*.json.gz"))
    with _client() as client:
        for s in symbols:
            try:
                update(s, client)
            except Exception as error:  # Una moneda que falla no detiene a las demás
                print(s, "falló:", error, flush=True)
