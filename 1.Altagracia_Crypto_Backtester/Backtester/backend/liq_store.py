"""
Lee el almacen de liquidaciones de OrderFlowData/liquidations, que arma liq_update.py.

Tres clases de fuente:
- events (Binance Coin-M, Bitfinex): cada liquidacion con su hora, se conoce en esa hora.
- days (MarginPad): dinero liquidado por dia y precio, sin hora. Un dia se conoce al cerrar,
  a las 00:00 UTC del dia siguiente.
- spans (Coinalyze): dinero liquidado por intervalo, con el precio estimado con velas de ese mismo
  intervalo. Se conoce al cerrar el intervalo.

Cada celda sale como [known, start, end, low, high, long_usd, short_usd, fuente]. Nunca se entrega
una celda con known posterior a known_until: lo que todavia no se conocia no sale del backend.
"""
import csv
import datetime as dt
import os
from pathlib import Path

import numpy as np

LIQ_DIR = Path(os.environ.get("ORDERFLOW_LIQ", r"C:\Users\inven\OrderFlowData\liquidations"))
DAY_MS = 86_400_000
MAX_SPAN_MS = 400 * DAY_MS  # Una ventana de 90 dias con margen cabe de sobra
MAX_CELLS = 250_000

# Orden de prioridad: la primera que cubre una hora es la que se usa. Nunca se mezclan
SOURCES = [
    {"id": "marginpad", "file": "{symbol}_marginpad.csv", "kind": "days", "label": "MarginPad", "scope": "todo el mercado"},
    {"id": "coinalyze", "file": "{symbol}_coinalyze.csv", "kind": "spans", "label": "Coinalyze", "scope": "todo el mercado, precio estimado"},
    {"id": "binance_cm", "file": "{symbol}_binance_cm.csv", "kind": "events", "label": "Binance Coin-M", "scope": "un solo mercado"},
    {"id": "bitfinex", "file": "{symbol}_bitfinex.csv", "kind": "events", "label": "Bitfinex", "scope": "un mercado pequeño"},
]

_loaded = {}


def _day_start(text):
    day = dt.datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
    return int(day.timestamp() * 1000)


def _parse(path, kind):
    """Columnas known, start, end, low, high, long, short ordenadas por known."""
    rows = []
    with open(path, encoding="ascii", newline="") as handle:
        for row in csv.DictReader(handle):
            if kind == "events":
                t, price, usd = int(row["time_ms"]), float(row["price"]), float(row["usd"])
                is_long = row["side"] == "long"
                rows.append((t, t, t, price, price, usd if is_long else 0.0, 0.0 if is_long else usd))
            elif kind == "spans":
                start, end = int(row["start_ms"]), int(row["end_ms"])
                rows.append((end, start, end, float(row["price_low"]), float(row["price_high"]), float(row["long_usd"]), float(row["short_usd"])))
            else:
                start = _day_start(row["date_utc"])
                end = start + DAY_MS
                rows.append((end, start, end, float(row["price_low"]), float(row["price_high"]), float(row["long_usd"]), float(row["short_usd"])))
    if not rows:
        return None
    rows.sort(key=lambda r: (r[0], r[3]))
    columns = list(zip(*rows))
    names = ("known", "start", "end", "low", "high", "long", "short")
    return {name: np.array(values, dtype=np.int64 if i < 3 else np.float64) for i, (name, values) in enumerate(zip(names, columns))}


GAP_DAYS = 7  # Mas de una semana sin un solo dato es un hueco de la descarga, no dias tranquilos


def _ranges(data):
    """Tramos con datos: se cortan donde pasan mas de GAP_DAYS dias sin ninguno"""
    days = np.unique(data["start"] // DAY_MS)
    cuts = np.flatnonzero(np.diff(days) > GAP_DAYS)
    starts = np.r_[days[0], days[cuts + 1]]
    stops = np.r_[days[cuts], days[-1]]
    return [[int(a) * DAY_MS, int(b + 1) * DAY_MS] for a, b in zip(starts, stops)]


def _info(source, data):
    """Tramo que cubre una fuente: del inicio de su primer dato al final del último, y sus partes con datos"""
    return {
        "id": source["id"],
        "label": source["label"],
        "scope": source["scope"],
        "kind": source["kind"],
        "first": int(data["start"].min()),
        "last": int(data["end"].max()),
        "ranges": _ranges(data),
        "days": int(len(np.unique(data["start"] // DAY_MS))),
        "count": int(len(data["known"])),
        "cell_width": float(np.max(data["high"] - data["low"])),
    }


def _sources(symbol):
    """(datos, tramo) de cada fuente con archivo, en orden de prioridad. Se relee solo si el archivo cambio."""
    found = []
    for source in SOURCES:
        path = LIQ_DIR / source["file"].format(symbol=symbol)
        if not path.exists():
            continue
        stamp = path.stat().st_mtime
        key = (symbol, source["id"])
        cached = _loaded.get(key)
        if not cached or cached[0] != stamp:
            try:
                data = _parse(path, source["kind"])
                cached = (stamp, data, _info(source, data) if data is not None else None)
            except (OSError, ValueError, KeyError):
                # El archivo se esta escribiendo: sigue la lectura anterior
                cached = (stamp, cached[1], cached[2]) if cached else (stamp, None, None)
            _loaded[key] = cached
        if cached[1] is not None:
            found.append((cached[1], cached[2]))
    return found


def coverage(symbol):
    """Fuentes del simbolo en orden de prioridad, con el tramo que cubren."""
    return [info for _, info in _sources(symbol)]


def window(symbol, start_ms, end_ms, known_until=None):
    """Celdas conocidas en (start_ms, min(end_ms, known_until)], de todas las fuentes, ordenadas por known."""
    cut = int(end_ms if known_until is None else min(end_ms, known_until))
    start_ms = int(max(start_ms, cut - MAX_SPAN_MS))
    sources = _sources(symbol)
    parts = []
    for index, (data, _) in enumerate(sources):
        first, stop = np.searchsorted(data["known"], [start_ms, cut], side="right")
        if stop > first:
            part = {name: values[first:stop] for name, values in data.items()}
            part["source"] = np.full(stop - first, index, dtype=np.int64)
            parts.append(part)

    cells = []
    truncated = False
    if parts:
        merged = {name: np.concatenate([part[name] for part in parts]) for name in parts[0]}
        order = np.argsort(merged["known"], kind="stable")
        if len(order) > MAX_CELLS:
            order, truncated = order[-MAX_CELLS:], True  # Se quedan las mas recientes
        columns = [merged[name][order].tolist() for name in ("known", "start", "end", "low", "high", "long", "short", "source")]
        cells = [[k, s, e, lo, hi, round(lg, 2), round(sh, 2), src] for k, s, e, lo, hi, lg, sh, src in zip(*columns)]
    return {
        "cells": cells,
        "sources": [info for _, info in sources],
        "start": start_ms,
        "known_until": cut,
        "truncated": truncated,
    }
