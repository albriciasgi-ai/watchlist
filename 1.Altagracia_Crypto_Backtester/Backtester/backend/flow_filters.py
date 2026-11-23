"""
Filtros de flujo del probador, sin futuro, sobre las velas de la regla:

- CVD de N velas a favor: la suma de la delta de las últimas N velas (con la vela de la señal) sobre su volumen tiene
  el signo del trade. Con almacén de trades la delta es la real; sin él (o en 1 día) se estima por dónde cerró cada
  vela: volumen × (cierre − apertura) ÷ rango. `cvd_estimated` dice cuál se usó.
- OI: el Open Interest conocido al cierre de cada vela (el del instante de su cierre, o el último anterior).
  · `rise` / `fall`: el OI subió o bajó más de `pct` % en las últimas `bars` velas.
  · `conf` / `noconf`: confluencia OI-volumen como el indicador de App 1: el volumen con signo y el cambio del OI, en
    z-score de las 20 velas que terminan en la de la señal, van los dos a favor del trade (`conf`: en un largo los dos
    suben, en un corto los dos bajan, como el panel), o no van los dos en contra (`noconf`). Desde el 22/11 (F-09).
  Fuente: `OrderFlowData/oi/{moneda}_5min.csv` (BTC) o `{moneda}_4h.json` (las demás, 4 horas). Con la serie de 4 horas
  el filtro solo vale en 4h y 1D: en marcos menores el OI no cambia dentro de la vela y no se puede medir.
  Una vela sin OI no pasa el filtro.

- OI sostenido (19/11): la parte de los pasos de 4 horas de los últimos `days` días en que subió el OI, con la serie de
  4 horas de todas las monedas (también BTC, para que el umbral valga igual). Pasa con `min` o más (0.52 de fábrica, el
  tercio alto medido en 50 monedas). No depende del marco de la regla. Con huecos (menos del 80% de los pasos) no pasa.
  Medido en 8 reglas: subida sostenida del OI, +0.05 R por trade en la mediana, también en la fase 3.
- Multitud (19/11): el funding de los 3 días anteriores de la moneda, en equivalente por 8 horas (la suma ÷ 9, así vale
  igual si la moneda liquida cada 8, 4 o 1 hora). Contra la multitud: un corto con funding > 0.01% (los cargados son los
  largos) o un largo con funding < 0; con la multitud, al revés; entre medio, neutro. `nocon` deja todo menos con la
  multitud; `contra`, solo contra la multitud. Fuente: `OrderFlowData/funding/{moneda}.json`, de `funding_update.py`.
  Medido en 8 reglas: contra − con la multitud, +0.10 R por trade en la mediana; con la multitud suele ser lo peor.

`oi_update.py` baja de Bybit el OI de 4 horas que falte, y `funding_update.py`, el funding.
"""
import json
import os
from pathlib import Path

import numpy as np

import oi_store

Z_BARS = 20
DAY_MS = 86400000
FUNDING_DIR = Path(os.environ.get("TESTER_FUNDING", "C:/Users/inven/OrderFlowData/funding"))
NEUTRAL_FUNDING = 0.0001   # 0.01% por 8 horas: el funding normal de Bybit cuando nadie está cargado
CROWD_MODES = ("nocon", "contra")


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
    # Como el panel "OI-Volume Confluence": alcista con el volumen y el OI subiendo, bajista con los dos bajando.
    # Protocolo de pruebas, F-09 (22/11/2026): en los cortos el filtro pedía el OI subiendo y el panel lo muestra bajando
    both_for = vz[k] * side > 0 and oz[k] * side > 0
    both_against = vz[k] * side < 0 and oz[k] * side < 0
    return both_for if mode == "conf" else not both_against


def _zscore_with(x, n=Z_BARS):
    """z de cada valor contra las n últimas con él incluido (desviación de la población), como el panel de la
    confluencia (`calculateZScore`). NaN si alguna de las n falta o no hay n."""
    out = np.full(len(x), np.nan)
    for i in range(n - 1, len(x)):
        w = x[i - n + 1:i + 1]
        if np.isfinite(w).all():
            sd = w.std()
            out[i] = (x[i] - w.mean()) / sd if sd > 0 else 0.0
    return out


def z_pair(oi, signed):
    """z-score del volumen con signo y del cambio del OI, para la confluencia: con la vela incluida, como el panel (F-09)."""
    return _zscore_with(signed), _zscore_with(np.diff(oi, prepend=np.nan))


def oi_steady(symbol, bars, tf, days=14):
    """Parte de los pasos de 4 horas del OI en los `days` días anteriores al cierre de cada vela en que subió (NaN sin datos)."""
    src = _json_series(symbol)
    out = np.full(len(bars), np.nan)
    if src is None or not len(bars):
        return out
    times, values = src[0], src[1]
    up = np.r_[0, np.cumsum(np.diff(values) > 0)]  # up[i]: subidas entre los puntos 0..i
    close = np.array([b["t"] for b in bars], dtype=np.int64) + tf * 60000
    end = np.searchsorted(times, close, side="right") - 1               # Último punto conocido al cierre
    start = np.searchsorted(times, close - days * DAY_MS, side="left")  # Primer punto dentro de la ventana
    steps = end - start
    ok = (end >= 0) & (steps >= int(days * 6 * 0.8))
    out[ok] = (up[end[ok]] - up[start[ok]]) / steps[ok]
    return out


def funding_series(symbol):
    path = FUNDING_DIR / f"{symbol}.json"
    if not path.exists():
        return None
    rows = sorted(json.load(open(path, encoding="utf-8")))
    if not rows:
        return None
    return np.array([r[0] for r in rows], dtype=np.int64), np.array([r[1] for r in rows], dtype=float)


def funding_3d(symbol, bars, tf):
    """Funding de los 3 días anteriores al cierre de cada vela, en equivalente por 8 horas (NaN con menos de 3 liquidaciones)."""
    src = funding_series(symbol)
    out = np.full(len(bars), np.nan)
    if src is None or not len(bars):
        return out
    times, rates = src
    cum = np.r_[0.0, np.cumsum(rates)]
    close = np.array([b["t"] for b in bars], dtype=np.int64) + tf * 60000
    hi = np.searchsorted(times, close, side="right")
    lo = np.searchsorted(times, close - 3 * DAY_MS, side="right")
    ok = hi - lo >= 3
    out[ok] = (cum[hi[ok]] - cum[lo[ok]]) / 9
    return out


FUNDING_EPS = 1e-12  # Ruido de coma flotante en el funding de 3 días (F-08)


def crowd(funding, side):
    """contra, neutro o con la multitud para un trade de ese lado; None sin funding.
    Protocolo de pruebas, F-08 (22/11/2026): la tasa base (0.01% por 8 h) es neutra. funding_3d resta dos sumas
    acumuladas y deja la tasa base en 0.00010000000000000026 o 0.00009999999999999998, así que una vela neutra caía de un
    lado o del otro según el redondeo; ahora se compara con tolerancia."""
    if funding is None or not funding == funding:
        return None
    above, below = funding > NEUTRAL_FUNDING + FUNDING_EPS, funding < -FUNDING_EPS
    if side < 0:
        return "contra" if above else ("con" if below else "neutro")
    return "contra" if below else ("con" if above else "neutro")


def crowd_ok(mode, funding, side):
    label = crowd(funding, side)
    if label is None:
        return False
    return label == "contra" if mode == "contra" else label != "con"
