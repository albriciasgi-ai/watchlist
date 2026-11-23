"""
Velas de Bybit (futuros lineales USDT) para el probador. 1 hora y 4 horas en OrderFlowData/candles/{moneda}.json.gz:
{"60": [[ms, o, h, l, c, volumen], ...], "240": [...]}; 15 y 5 minutos (21/11), cada marco en su carpeta para no hacer
más lenta la lectura de las de 1h y 4h: candles/15/{moneda}.json.gz ({"15": [...]}) y candles/5/{moneda}.json.gz.
Son las monedas "nuevas" del probador: no tienen caché de App 1 ni almacén de trades, así que corren solo con los
elementos hechos con velas (rule_tester.CANDLE_CODES).

    python -B candles_update.py --pick 43        elige las 43 de más volumen que cotizan desde antes de 2022 y las baja
    python -B candles_update.py                  actualiza las que ya tienen archivo (1h y 4h, y 15m y 5m si los tienen)
    python -B candles_update.py XRPUSDT DOGEUSDT las nombradas
    python -B candles_update.py --tf 15,5        además de 1h y 4h, baja 15m y 5m (también con --pick o monedas nombradas)
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
FINE = ("15", "5")  # Cada uno en su carpeta


def _path(symbol, tf):
    return DIR / tf / f"{symbol}.json.gz" if tf in FINE else DIR / f"{symbol}.json.gz"


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


def _load(path):
    if not path.exists():
        return {}
    with gzip.open(path, "rt", encoding="utf-8") as fh:
        return json.load(fh)


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    with gzip.open(partial, "wt", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    partial.replace(path)


PAGE = 1000  # Velas por pedido: el máximo de Bybit


def _page(client, symbol, tf, start, end):
    """Las velas de [start, end] (ms, los dos incluidos). Reintenta si la conexión falla o si Bybit responde con un error
    ("Too many visits" llega como retCode, sin excepción); tras 4 intentos la moneda falla en vez de saltar la página."""
    for attempt in range(4):
        try:
            found = client.get(f"{BASE}/kline", params={"category": "linear", "symbol": symbol, "interval": tf,
                                                        "start": start, "end": end, "limit": PAGE}).json()
            if found.get("retCode") == 0:
                return (found.get("result") or {}).get("list") or []
            error = RuntimeError(f"Bybit respondió {found.get('retCode')}: {found.get('retMsg')}")
        except Exception as exc:
            error = exc
        if attempt == 3:
            raise error
        time.sleep(2 * (attempt + 1))


def _fetch(symbol, tf, rows, client, start=None, stop=None):
    """Suma a rows (hora → vela) las velas cerradas de start a stop (ms). Sin start, desde la última vela guardada (se
    vuelve a pedir: pudo quedar a medio formar) o desde 2020. Sin stop, hasta ahora.
    Protocolo de pruebas (22/11/2026): F-02, cada pedido iba de start a start + 1,000 velas (1,001) con límite 1,000, así
    que Bybit devolvía las 1,000 más recientes y la primera de cada página se perdía; y un error sin excepción saltaba la
    página entera. F-03, la vela en formación al actualizar quedaba guardada a medio formar y no se volvía a pedir."""
    now = int(time.time() * 1000)
    step = int(tf) * 60000
    if start is None:
        start = max(rows) if rows else FIRST
    stop = min(now, stop) if stop is not None else now
    while start < stop:
        end = min(stop, start + (PAGE - 1) * step)
        lst = _page(client, symbol, tf, start, end)
        for k in lst:
            t = int(k[0])
            if t + step <= now:  # Solo velas cerradas
                rows[t] = [t, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])]
        start = end + step
        time.sleep(0.08)
    for t in [t for t in rows if t + step > now]:
        del rows[t]


def gaps(rows, step):
    """Tramos [desde, hasta] (ms) de velas que faltan entre la primera y la última guardadas."""
    times = sorted(rows)
    return [(a + step, b - step) for a, b in zip(times, times[1:]) if b - a > step]


def repair(symbol, tf, client, since=None):
    """Rellena los huecos (F-02) y vuelve a pedir lo bajado desde `since` (ms; F-03: las velas que quedaron a medio
    formar en las actualizaciones). Devuelve cuántas velas se sumaron o cambiaron."""
    path = _path(symbol, tf)
    data = _load(path)
    rows = {r[0]: r for r in data.get(tf, [])}
    if not rows:
        return 0
    before = dict(rows)
    step = int(tf) * 60000
    for a, b in gaps(rows, step):
        _fetch(symbol, tf, rows, client, start=a, stop=b + step)
    if since is not None:
        _fetch(symbol, tf, rows, client, start=max(min(rows), since))
    changed = sum(1 for t, r in rows.items() if before.get(t) != r)
    if changed:
        data[tf] = [rows[t] for t in sorted(rows)]
        _save(path, data)
    return changed


def update_fine(symbol, tf, client):
    """15 o 5 minutos, en su archivo."""
    path = _path(symbol, tf)
    data = _load(path)
    rows = {r[0]: r for r in data.get(tf, [])}
    _fetch(symbol, tf, rows, client)
    _save(path, {tf: [rows[t] for t in sorted(rows)]})
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    print(symbol, f"{tf}m", len(rows), day(min(rows)) if rows else "-", day(max(rows)) if rows else "-", flush=True)


def update(symbol, client):
    data = _load(_path(symbol, "60"))
    for tf in TFS:
        rows = {r[0]: r for r in data.get(tf, [])}
        _fetch(symbol, tf, rows, client)
        data[tf] = [rows[t] for t in sorted(rows)]
    _save(_path(symbol, "60"), data)
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    h4 = data.get("240") or []
    print(symbol, len(data.get("60") or []), len(h4), day(h4[0][0]) if h4 else "-", day(h4[-1][0]) if h4 else "-", flush=True)


def _since(text):
    """AAAA-MM-DD a ms de la medianoche UTC."""
    import calendar
    return calendar.timegm(time.strptime(text, "%Y-%m-%d")) * 1000 if text else None


if __name__ == "__main__":
    args = sys.argv[1:]
    fine = ()
    if "--tf" in args:
        at = args.index("--tf")
        fine = tuple(tf for tf in (args[at + 1] if at + 1 < len(args) else "").split(",") if tf in FINE)
        args = args[:at] + args[at + 2:]
    if "--repair" in args:
        # python -B candles_update.py --repair [--since AAAA-MM-DD] [MONEDAS]: rellena los huecos de todo lo guardado y
        # vuelve a pedir desde --since (UTC) las velas que pudieron quedar a medio formar
        args.remove("--repair")
        since = None
        if "--since" in args:
            at = args.index("--since")
            since = _since(args[at + 1] if at + 1 < len(args) else "")
            args = args[:at] + args[at + 2:]
        symbols = args or sorted(p.name.split(".")[0] for p in DIR.glob("*.json.gz"))
        with _client() as client:
            for s in symbols:
                for tf in TFS + tuple(tf for tf in FINE if _path(s, tf).exists()):
                    try:
                        print(s, f"{tf}m", "corregidas", repair(s, tf, client, since), flush=True)
                    except Exception as error:
                        print(s, f"{tf}m", "falló:", error, flush=True)
        sys.exit(0)
    if args[:1] == ["--pick"]:
        symbols = pick(int(args[1]) if len(args) > 1 else 43)
        print("Elegidas:", " ".join(symbols), flush=True)
    else:
        symbols = args or sorted(p.name.split(".")[0] for p in DIR.glob("*.json.gz"))
    with _client() as client:
        for s in symbols:
            try:
                update(s, client)
                # Al actualizar sin --tf, también los marcos finos que la moneda ya tenga
                for tf in fine or tuple(tf for tf in FINE if _path(s, tf).exists()):
                    update_fine(s, tf, client)
            except Exception as error:  # Una moneda que falla no detiene a las demás
                print(s, "falló:", error, flush=True)
