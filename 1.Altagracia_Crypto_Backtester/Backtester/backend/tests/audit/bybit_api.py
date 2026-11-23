"""
Auditoría del probador (protocolo del 21/11/2026): lectura de la API pública de Bybit, con caché en disco.

Solo pide datos de mercado públicos (velas, OI, funding); no envía nada del usuario. Cada respuesta queda guardada en
la carpeta de evidencia, así una comparación se puede repetir sin volver a pedir.
"""
import json
import os
import time
import urllib.parse
import urllib.request
from pathlib import Path

EVIDENCE = Path(os.environ.get("AUDIT_EVIDENCE", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia"))
CACHE = EVIDENCE / "bybit_cache"
BASE = "https://api.bybit.com"
INTERVAL = {1: "1", 5: "5", 15: "15", 30: "30", 60: "60", 240: "240", 1440: "D"}
_last_call = [0.0]


def _get(path, params, tries=5):
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    for attempt in range(tries):
        wait = 0.08 - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "app1-audit/1.0"})
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if data.get("retCode") == 0:
                return data["result"]
            if attempt == tries - 1:
                raise RuntimeError(f"Bybit {path}: {data.get('retCode')} {data.get('retMsg')}")
        except (OSError, ValueError) as error:
            if attempt == tries - 1:
                raise RuntimeError(f"Bybit {path}: {error}") from error
        time.sleep(1.5 * (attempt + 1))
    return None


def klines(symbol, tf_minutes, start_ms, end_ms, category="linear"):
    """Velas oficiales [t, o, h, l, c, v] con inicio en [start_ms, end_ms], en orden, sin repetir. Con caché."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / f"k_{symbol}_{tf_minutes}_{start_ms}_{end_ms}.json"
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    rows, end = {}, end_ms
    step = tf_minutes * 60000
    while end >= start_ms:
        res = _get("/v5/market/kline", {"category": category, "symbol": symbol, "interval": INTERVAL[tf_minutes],
                                         "start": start_ms, "end": end, "limit": 1000})
        got = res.get("list") or []
        if not got:
            break
        for r in got:
            t = int(r[0])
            if start_ms <= t <= end_ms:
                rows[t] = [t, float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])]
        oldest = min(int(r[0]) for r in got)
        if oldest <= start_ms or len(got) < 1000:
            break
        end = oldest - step
    out = [rows[t] for t in sorted(rows)]
    key.write_text(json.dumps(out), encoding="utf-8")
    return out


def open_interest(symbol, interval="4h", start_ms=None, end_ms=None):
    """OI [t, valor] de Bybit (la hora es la del dato: un registro de las 20:00 existe antes de las 24:00)."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / f"oi_{symbol}_{interval}_{start_ms}_{end_ms}.json"
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    rows, cursor = {}, None
    while True:
        params = {"category": "linear", "symbol": symbol, "intervalTime": interval, "limit": 200,
                  "startTime": start_ms, "endTime": end_ms}
        if cursor:
            params["cursor"] = cursor
        res = _get("/v5/market/open-interest", params)
        for r in res.get("list") or []:
            rows[int(r["timestamp"])] = float(r["openInterest"])
        cursor = res.get("nextPageCursor")
        if not cursor or not res.get("list"):
            break
    out = [[t, rows[t]] for t in sorted(rows)]
    key.write_text(json.dumps(out), encoding="utf-8")
    return out


def funding(symbol, start_ms, end_ms):
    """Funding [t, tasa] de Bybit entre start_ms y end_ms."""
    CACHE.mkdir(parents=True, exist_ok=True)
    key = CACHE / f"f_{symbol}_{start_ms}_{end_ms}.json"
    if key.exists():
        return json.loads(key.read_text(encoding="utf-8"))
    rows, end = {}, end_ms
    while end >= start_ms:
        res = _get("/v5/market/funding/history", {"category": "linear", "symbol": symbol, "startTime": start_ms,
                                                  "endTime": end, "limit": 200})
        got = res.get("list") or []
        if not got:
            break
        for r in got:
            rows[int(r["fundingRateTimestamp"])] = float(r["fundingRate"])
        oldest = min(int(r["fundingRateTimestamp"]) for r in got)
        if oldest <= start_ms or len(got) < 200:
            break
        end = oldest - 1
    out = [[t, rows[t]] for t in sorted(rows)]
    key.write_text(json.dumps(out), encoding="utf-8")
    return out
