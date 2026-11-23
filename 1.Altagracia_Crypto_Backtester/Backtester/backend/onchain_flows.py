"""
Flujos on-chain diarios de Coin Metrics (API comunitaria, gratis y sin clave; licencia CC BY-NC 4.0: solo uso no
comercial) para el filtro "Flujos on-chain" del probador (21/11/2026).

Datos, en OrderFlowData/onchain/coinmetrics.json ({activo: {métrica: [[ms del día UTC, valor], ...]}}):
- btc y eth: FlowInExNtv y FlowOutExNtv (lo que entra y sale de los exchanges, en monedas) y SplyExNtv (el saldo en
  exchanges). BTC desde 2011, ETH desde 2015.
- usdt y usdc: SplyCur, la emisión total (todas sus cadenas). La API gratis no da los flujos de stablecoins a exchanges.

Medidas, una por vela, en "a favor de un largo" (positivo = alcista):
- `net`: flujo neto de BTC o ETH a los exchanges de los últimos `days` días, en % del saldo en exchanges al empezar.
  Salir de los exchanges se lee alcista (menos para vender), así que la medida es −neto.
- `stable`: crecimiento de la emisión de USDT + USDC en `days` días, en %. Más dólares digitales se lee alcista.
  Cada stablecoin cuenta solo desde que tiene dato, para que la llegada de USDC en 2018 no parezca una emisión.
Cada medida se pasa a z-score contra los 365 días anteriores (sin el día), con al menos 180.

Sin futuro: el dato del día D lo publica Coin Metrics entre la 01:00 y las 04:00 UTC del día siguiente (visto en su
`status-time`). Se usa desde D + 1 día + 6 horas (`LAG_MS`). Los valores recientes son "flash" y pueden corregirse un
poco al revisarse: lo bajado hoy de fechas viejas ya está revisado.

    python -B onchain_flows.py      (baja todo de nuevo: son pocos datos y así entran las revisiones)
"""
import json
import os
import time
from pathlib import Path

import numpy as np

DIR = Path(os.environ.get("TESTER_ONCHAIN", "C:/Users/inven/OrderFlowData/onchain"))
FILE = DIR / "coinmetrics.json"
API = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
WANT = {"btc": ("FlowInExNtv", "FlowOutExNtv", "SplyExNtv"), "eth": ("FlowInExNtv", "FlowOutExNtv", "SplyExNtv"),
        "usdt": ("SplyCur",), "usdc": ("SplyCur",)}
DAY_MS = 86400000
LAG_MS = DAY_MS + 6 * 3600000
Z_DAYS, Z_MIN = 365, 180
METRICS = ("net", "stable")
ASSETS = ("auto", "btc", "eth")
MODES = ("favor", "nocontra")
NAMES = {"net": "flujo neto a los exchanges", "stable": "emisión de USDT y USDC"}


# ---------------------------------------------------------------- descarga

def _fetch(client, asset, metrics):
    rows, url = {m: [] for m in metrics}, API
    params = {"assets": asset, "metrics": ",".join(metrics), "frequency": "1d", "start_time": "2010-01-01",
              "page_size": 10000, "paging_from": "start"}
    for _ in range(50):
        data = client.get(url, params=params).json()
        for x in data.get("data") or []:
            day = int(np.datetime64(x["time"][:10], "ms").astype(np.int64))
            for m in metrics:
                if x.get(m) not in (None, ""):
                    rows[m].append([day, float(x[m])])
        url, params = data.get("next_page_url"), None
        if not url:
            break
        time.sleep(0.7)  # La API gratis deja 10 pedidos cada 6 s
    return rows


def update(client=None):
    """Baja todo y lo guarda con temporal y reemplazo. Devuelve {activo: (días, primer día, último día)}."""
    import httpx
    own = client is None
    client = client or httpx.Client(timeout=60, headers={"User-Agent": "app1-onchain"})
    try:
        out = {}
        for asset, metrics in WANT.items():
            out[asset] = _fetch(client, asset, metrics)
            time.sleep(0.7)
    finally:
        if own:
            client.close()
    if not any(v for rows in out.values() for v in rows.values()):
        raise RuntimeError("Coin Metrics no devolvió datos")
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = FILE.with_suffix(".tmp")
    json.dump(out, open(tmp, "w", encoding="utf-8"))
    tmp.replace(FILE)
    _load.cache = None
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    summary = {}
    for asset, rows in out.items():
        first = min((r[0][0] for r in rows.values() if r), default=None)
        last = max((r[-1][0] for r in rows.values() if r), default=None)
        summary[asset] = (max(len(r) for r in rows.values()), first and day(first), last and day(last))
        print("onchain", asset, *summary[asset], flush=True)
    return summary


# ---------------------------------------------------------------- series

def _load():
    """Los datos del disco, leídos una vez mientras no cambie el archivo."""
    try:
        stamp = FILE.stat().st_mtime
    except OSError:
        return None
    cached = getattr(_load, "cache", None)
    if cached and cached[0] == stamp:
        return cached[1]
    raw = json.load(open(FILE, encoding="utf-8"))
    data = {a: {m: np.array(sorted(v), dtype=float).reshape(-1, 2) for m, v in rows.items()} for a, rows in raw.items()}
    _load.cache = (stamp, data)
    return data


def _on_days(series, days):
    """Los valores de una serie [[ms, v]] en la grilla de días `days` (NaN donde falta)."""
    out = np.full(len(days), np.nan)
    if series is None or not len(series):
        return out
    idx = np.searchsorted(days, series[:, 0].astype(np.int64))
    ok = (idx < len(days)) & (days[np.clip(idx, 0, len(days) - 1)] == series[:, 0].astype(np.int64))
    out[idx[ok]] = series[ok, 1]
    return out


def _grid(data):
    first = min(s[0, 0] for rows in data.values() for s in rows.values() if len(s))
    last = max(s[-1, 0] for rows in data.values() for s in rows.values() if len(s))
    return np.arange(int(first), int(last) + DAY_MS, DAY_MS, dtype=np.int64)


def _zscore(x):
    """z de cada día contra los Z_DAYS anteriores, sin él."""
    out = np.full(len(x), np.nan)
    for i in range(Z_MIN, len(x)):
        w = x[max(0, i - Z_DAYS):i]
        w = w[np.isfinite(w)]
        if len(w) >= Z_MIN and np.isfinite(x[i]):
            sd = w.std()
            out[i] = (x[i] - w.mean()) / sd if sd > 0 else 0.0
    return out


def daily(metric, asset, days):
    """(días, medida en %, z) de una medida diaria, o None sin datos. Positivo = a favor de un largo."""
    data = _load()
    if not data:
        return None
    key = ("daily", metric, asset, days)
    cache = getattr(daily, "cache", {})
    if getattr(daily, "stamp", None) is not _load.cache:
        cache, daily.stamp = {}, _load.cache
    if key in cache:
        return cache[key]
    grid = _grid(data)
    value = np.full(len(grid), np.nan)
    if metric == "net":
        rows = data.get(asset) or {}
        inflow, outflow = _on_days(rows.get("FlowInExNtv"), grid), _on_days(rows.get("FlowOutExNtv"), grid)
        balance = _on_days(rows.get("SplyExNtv"), grid)
        net = inflow - outflow
        csum = np.r_[0.0, np.cumsum(np.nan_to_num(net))]
        bad = np.r_[0, np.cumsum(~np.isfinite(net))]
        for i in range(days, len(grid)):
            if bad[i + 1] - bad[i + 1 - days] == 0 and np.isfinite(balance[i - days]) and balance[i - days] > 0:
                value[i] = -(csum[i + 1] - csum[i + 1 - days]) / balance[i - days] * 100
    elif metric == "stable":
        grown, base = np.zeros(len(grid)), np.zeros(len(grid))
        seen = np.zeros(len(grid), dtype=bool)
        for coin in ("usdt", "usdc"):
            s = _on_days((data.get(coin) or {}).get("SplyCur"), grid)
            prev = np.r_[np.full(days, np.nan), s[:-days]]
            ok = np.isfinite(s) & np.isfinite(prev) & (prev > 0)
            grown[ok] += s[ok] - prev[ok]
            base[ok] += prev[ok]
            seen |= ok
        value[seen & (base > 0)] = grown[seen & (base > 0)] / base[seen & (base > 0)] * 100
    cache[key] = (grid, value, _zscore(value))
    daily.cache = cache
    return cache[key]


def asset_for(asset, symbol):
    """El activo de la medida neta: `auto` usa ETH para las monedas de ETH y BTC para las demás."""
    if asset in ("btc", "eth"):
        return asset
    return "eth" if str(symbol).upper().startswith("ETH") else "btc"


def at_close(chain, symbol, bars, tf):
    """(medida en %, z) conocidos al cierre de cada vela, en arrays; NaN sin dato."""
    n = len(bars)
    nan = np.full(n, np.nan)
    src = daily(chain["metric"], asset_for(chain.get("asset", "auto"), symbol), chain["days"])
    if src is None or not n:
        return nan, nan.copy()
    grid, value, z = src
    close = np.array([b["t"] for b in bars], dtype=np.int64) + tf * 60000
    k = np.searchsorted(grid + LAG_MS, close, side="right") - 1   # Último día ya publicado al cierre
    ok = k >= 0
    kk = np.clip(k, 0, None)
    v, zz = np.where(ok, value[kk], np.nan), np.where(ok, z[kk], np.nan)
    stale = close - (grid[kk] + LAG_MS) > 3 * DAY_MS               # Sin datos nuevos en 3 días: es un hueco
    v[stale], zz[stale] = np.nan, np.nan
    return v, zz


def chain_ok(chain, z, side):
    """`favor`: el z va a favor del trade al menos `z`; `nocontra`: no va en contra más de `z`. Sin dato no pasa."""
    if not z == z:
        return False
    s = z * side
    return s >= chain["z"] if chain.get("mode", "favor") == "favor" else s > -chain["z"]


def describe(chain, symbol=None, side=None):
    """En palabras. Con `side` -1, la condición de un corto (O-13 del protocolo de pruebas: decía la del largo en todos)."""
    asset = asset_for(chain.get("asset", "auto"), symbol) if chain["metric"] == "net" else None
    what = f"{NAMES[chain['metric']]}{f' de {asset.upper()}' if asset else ''} en {chain['days']} d"
    if side is not None and side < 0:
        how = (f"a favor de un corto (z ≤ −{chain['z']:g})" if chain.get("mode", "favor") == "favor"
               else f"no en contra de un corto (z < {chain['z']:g})")
    else:
        how = f"a favor (z ≥ {chain['z']:g})" if chain.get("mode", "favor") == "favor" else f"no en contra (z > −{chain['z']:g})"
    return f"Flujos on-chain: {what}, {how}"


if __name__ == "__main__":
    update()
