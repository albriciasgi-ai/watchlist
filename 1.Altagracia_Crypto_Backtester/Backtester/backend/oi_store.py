"""
Lee el Open Interest de Bybit guardado a 5 minutos en OrderFlowData/oi.

Bybit entrega 15 minutos, 1 hora y 4 horas con los mismos valores de la serie de 5 minutos,
asi que cada marco sale de tomar el dato en el inicio de su vela.
"""
import datetime as dt
import os
from pathlib import Path

import numpy as np

OI_DIR = Path(os.environ.get("ORDERFLOW_OI", r"C:\Users\inven\OrderFlowData\oi"))
COLOMBIA = dt.timezone(dt.timedelta(hours=-5))
BASE_MINUTES = 5

_series = {}


def _load(symbol):
    """Serie ordenada y sin repetidos. Se vuelve a leer solo si el archivo cambio."""
    path = OI_DIR / f"{symbol}_5min.csv"
    if not path.exists():
        return None

    stamp = path.stat().st_mtime
    cached = _series.get(symbol)
    if cached and cached[0] == stamp:
        return cached

    try:
        rows = np.loadtxt(path, delimiter=",", skiprows=1, ndmin=2)
    except ValueError:
        return cached  # El archivo se esta escribiendo: sigue valida la lectura anterior
    if len(rows) == 0:
        return None

    order = np.argsort(rows[:, 0], kind="stable")
    times = rows[order, 0].astype(np.int64)
    values = rows[order, 1]
    keep = np.r_[True, np.diff(times) > 0]
    _series[symbol] = (stamp, times[keep], values[keep])
    return _series[symbol]


def _date(timestamp_ms):
    return dt.datetime.fromtimestamp(timestamp_ms / 1000, COLOMBIA).strftime("%Y-%m-%d %H:%M:%S")


def points(symbol):
    """Toda la serie: marcas en minutos y valores, o None si no hay archivo."""
    loaded = _load(symbol)
    return None if loaded is None else (loaded[1] // 60000, loaded[2])


def series(symbol, interval, start_ms, end_ms):
    """Puntos del marco entre start_ms y end_ms, o None si no hay serie local para ese simbolo."""
    if not str(interval).isdigit():
        return None
    loaded = _load(symbol)
    if loaded is None:
        return None

    _, times, values = loaded
    first, stop = np.searchsorted(times, [start_ms, end_ms])
    window_times, window_values = times[first:stop], values[first:stop]

    minutes = max(int(interval), BASE_MINUTES)
    keep = window_times % (minutes * 60000) == 0

    return {
        "data": [
            {"timestamp": t, "openInterest": v}
            for t, v in zip(window_times[keep].tolist(), window_values[keep].tolist())
        ],
        "oi_first_timestamp": int(times[0]),
        "oi_last_timestamp": int(times[-1]),
        "oi_first_date": _date(int(times[0])),
        "oi_last_date": _date(int(times[-1])),
        "oi_interval": f"{minutes}min",
    }
