"""
Filtros de flujo del probador, sin futuro, sobre las velas de la regla:

- CVD de N velas a favor: la suma de la delta de las últimas N velas (con la vela de la señal) sobre su volumen tiene
  el signo del trade. Con almacén de trades la delta es la real; sin él (o en 1 día) se estima por dónde cerró cada
  vela: volumen × (cierre − apertura) ÷ rango. `cvd_estimated` dice cuál se usó.
- OI: el Open Interest conocido al cierre de cada vela (el del instante de su cierre, o el último anterior).
  · `rise` / `fall`: el OI subió o bajó más de `pct` % en las últimas `bars` velas.
  · `conf` / `noconf`: confluencia OI-volumen como el indicador de App 1: el volumen con signo y el cambio del OI, en
    z-score de 20 velas, van los dos a favor del trade (`conf`), o no van los dos en contra (`noconf`).
  Fuente: `OrderFlowData/oi/{moneda}_5min.csv` (BTC) o `{moneda}_4h.json` (las demás, 4 horas). Con la serie de 4 horas
  el filtro solo vale en 4h y 1D: en marcos menores el OI no cambia dentro de la vela y no se puede medir.
  Una vela sin OI no pasa el filtro.

`oi_update.py` baja de Bybit el OI de 4 horas que falte.
"""
import json
from pathlib import Path

import numpy as np

import oi_store

Z_BARS = 20


def signed_volume(bars):
    """Delta de cada vela: la real si el almacén la trae, si no la estimada. Devuelve (valores, estimada)."""
    d = np.array([b.get("delta") or 0.0 for b in bars], dtype=float)
    if np.abs(d).sum() > 0:
        return d, False
    o, h, l, c, v = (np.array([b[k] for b in bars], dtype=float) for k in ("o", "h", "l", "c", "vol"))
    rng = np.where(h - l > 0, h - l, 1.0)
    return v * (c - o) / rng, True


def cvd(bars, n):
    """CVD de las últimas n velas sobre su volumen, en cada vela (NaN sin velas suficientes)."""
    d, est = signed_volume(bars)
    v = np.array([b["vol"] for b in bars], dtype=float)
    out = np.full(len(d), np.nan)
    if len(d) >= n:
        cd, cv = np.r_[0, np.cumsum(d)], np.r_[0, np.cumsum(v)]
        tot = cv[n:] - cv[:-n]
        out[n - 1:] = np.where(tot > 0, (cd[n:] - cd[:-n]) / np.where(tot > 0, tot, 1), np.nan)
    return out, est


def _zscore(x, n=Z_BARS):
    """z de cada valor contra las n anteriores, sin él."""
    out = np.full(len(x), np.nan)
    for i in range(n, len(x)):
        w = x[i - n:i]
        w = w[np.isfinite(w)]
        if len(w) >= n // 2 and np.isfinite(x[i]):
            sd = w.std()
            out[i] = (x[i] - w.mean()) / sd if sd > 0 else 0.0
    return out


def _json_series(symbol):
    path = Path(oi_store.OI_DIR) / f"{symbol}_4h.json"
    if not path.exists():
        return None
    rows = json.load(open(path, encoding="utf-8"))
    if not rows:
        return None
    rows.sort()
    return np.array([r[0] for r in rows], dtype=np.int64), np.array([r[1] for r in rows], dtype=float), 240


def source(symbol):
    """Serie de OI: (tiempos en ms, valores, minutos entre datos) o None."""
    pts = oi_store.points(symbol)
    if pts is not None and len(pts[0]):
        return np.asarray(pts[0], dtype=np.int64) * 60000, np.asarray(pts[1], dtype=float), oi_store.BASE_MINUTES
    return _json_series(symbol)


def oi_at_close(symbol, bars, tf):
    """OI conocido al cierre de cada vela; None si no hay serie o su paso es mayor que la vela."""
    src = source(symbol)
    if src is None or src[2] > tf:
        return None
    times, values, step_min = src
    close = np.array([b["t"] for b in bars], dtype=np.int64) + tf * 60000
    k = np.searchsorted(times, close, side="right") - 1
    out = np.where(k >= 0, values[np.clip(k, 0, None)], np.nan)
    # Un dato de hace más de 2 pasos de la serie (o de la vela) no vale: es un hueco
    age = close - np.where(k >= 0, times[np.clip(k, 0, None)], 0)
    out[age > 2 * max(step_min, tf) * 60000] = np.nan
    return out


def oi_ok(mode, oi, signed, k, side, bars_back=6, pct=2.0, zcache=None):
    """Si la vela k cumple el filtro de OI a favor del lado `side`."""
    if oi is None or not np.isfinite(oi[k]):
        return False
    if mode in ("rise", "fall"):
        j = k - bars_back
        if j < 0 or not np.isfinite(oi[j]) or oi[j] <= 0:
            return False
        change = (oi[k] / oi[j] - 1) * 100
        return change > pct if mode == "rise" else change < -pct
    vz, oz = zcache
    if not (np.isfinite(vz[k]) and np.isfinite(oz[k])):
        return False
    both_for = vz[k] * side > 0 and oz[k] > 0
    both_against = vz[k] * side < 0 and oz[k] < 0
    return both_for if mode == "conf" else not both_against


def z_pair(oi, signed):
    """z-score del volumen con signo y del cambio del OI, para la confluencia."""
    return _zscore(signed), _zscore(np.diff(oi, prepend=np.nan))
