"""
Etapa 1 del protocolo de pruebas (21/11/2026): los datos con que corre el probador, contra la API pública de Bybit.

  D-01  velas de la regla: en las monedas con almacén, las armadas con los trades (spans del caché del probador); en las
        demás, las del caché de App 1 (SUI, TRX) o las de OrderFlowData/candles (las 43 nuevas)
  D-04  30m (dos de 15m) y 1D (seis de 4h por día UTC)
  D-05  velas que faltan
  D-06  OI de 4 horas y de 5 minutos
  D-07  funding

Uso: python -B tests/audit/etapa1_datos.py [parte ...]   (partes: spans, cache, nuevas, agregadas, oi, funding)
Corre desde backend/ con ORDERFLOW_OBSERVER en la copia aislada. Escribe en EVIDENCIA/etapa1.
"""
import gzip
import json
import random
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import bybit_api as bb  # noqa: E402
import rule_tester as rt  # noqa: E402
import flow_filters  # noqa: E402

OUT = bb.EVIDENCE / "etapa1"
OUT.mkdir(parents=True, exist_ok=True)
STORE_COINS = ("BTCUSDT", "ETHUSDT", "SOLUSDT", "ARBUSDT", "GALAUSDT")
FIELDS = ("o", "h", "l", "c", "v")
results = {}


def compare(label, rule_rows, official, tf, worst=8):
    """Compara velas [t, o, h, l, c, v] de la regla con las oficiales. Cuenta diferencias por campo y velas que faltan."""
    step = tf * 60000
    a = {int(r[0]): r for r in rule_rows}
    b = {int(r[0]): r for r in official}
    common = sorted(set(a) & set(b))
    only_rule = sorted(set(a) - set(b))
    only_official = sorted(t for t in set(b) - set(a) if (not a) or (min(a) <= t <= max(a)))
    out = {"tf": tf, "bars_rule": len(a), "bars_official": len(b), "common": len(common),
           "only_rule": len(only_rule), "missing_in_rule": len(only_official),
           "missing_examples": [rt._iso(t) + f" {int((t % 86400000) / 3600000):02d}h" for t in only_official[:5]],
           "fields": {}}
    if not common:
        results[label] = out
        print(label, "sin velas en común")
        return out
    ra = np.array([a[t][1:6] for t in common], dtype=float)
    rb = np.array([b[t][1:6] for t in common], dtype=float)
    for j, name in enumerate(FIELDS):
        denom = np.where(np.abs(rb[:, j]) > 0, np.abs(rb[:, j]), 1.0)
        rel = (ra[:, j] - rb[:, j]) / denom
        bad = np.abs(rel) > 1e-7
        idx = np.argsort(-np.abs(rel))[:worst]
        out["fields"][name] = {
            "differ": int(bad.sum()), "share": round(float(bad.mean()), 5),
            "over_1bp": int((np.abs(rel) > 1e-4).sum()), "over_10bp": int((np.abs(rel) > 1e-3).sum()),
            "max_rel": float(np.abs(rel).max()), "sum_rule": float(ra[:, j].sum()) if name == "v" else None,
            "sum_official": float(rb[:, j].sum()) if name == "v" else None,
            "worst": [[rt._iso(common[i]) + f" {int((common[i] % 86400000) / 3600000):02d}:{int((common[i] % 3600000) / 60000):02d}",
                       float(ra[i, j]), float(rb[i, j]), round(float(rel[i]), 6)] for i in idx if bad[i]],
        }
    # Apertura oficial = cierre anterior oficial (propiedad conocida de las klines de Bybit)
    prev_close = {t: b[t - step][4] for t in common if (t - step) in b}
    out["official_open_is_prev_close"] = round(float(np.mean([b[t][1] == prev_close[t] for t in prev_close])), 4) if prev_close else None
    results[label] = out
    f = out["fields"]
    print(f"{label}: {out['common']} velas; faltan en la regla {out['missing_in_rule']}; "
          + "; ".join(f"{k} {f[k]['differ']} ({100 * f[k]['share']:.2f}%, máx {f[k]['max_rel']:.2e})" for k in FIELDS), flush=True)
    return out


def span_files():
    cache = rt.tester_dir() / "cache"
    found = {}
    for path in sorted(cache.glob("*.npz")):
        parts = path.stem.split("_")
        if len(parts) < 5 or parts[0] not in STORE_COINS or not parts[2].startswith("f"):
            continue
        sym, tf, phase = parts[0], int(parts[1]), parts[2]
        found[(sym, tf, phase)] = path  # El último por nombre es el de fecha final mayor
    return found


def part_spans():
    """D-01 en las monedas con almacén: las velas armadas con los trades, contra las oficiales."""
    for (sym, tf, phase), path in sorted(span_files().items()):
        if tf not in bb.INTERVAL:
            continue
        with np.load(path, allow_pickle=False) as z:
            rows = [[int(t), float(o), float(h), float(l), float(c), float(v)]
                    for t, o, h, l, c, v in zip(z["t"], z["o"], z["h"], z["l"], z["c"], z["vol"])]
        if not rows:
            continue
        official = bb.klines(sym, tf, rows[0][0], rows[-1][0])
        compare(f"span {sym} {tf} {phase}", rows, official, tf)


def _cache_rows(sym, key):
    d = json.load(gzip.open(Path("backtesting_cache") / f"{sym}_backtesting_data.json.gz", "rt"))
    return [[c["timestamp"], c["open"], c["high"], c["low"], c["close"], c["volume"]] for c in d["timeframes"][key]["main"]]


def part_cache():
    """D-01 en SUI y TRX (corren sobre el caché de App 1) y el caché de las monedas con almacén (el gráfico)."""
    for sym in ("SUIUSDT", "TRXUSDT") + STORE_COINS:
        for key, tf in (("4h", 240), ("1h", 60), ("15m", 15)):
            rows = _cache_rows(sym, key)
            official = bb.klines(sym, tf, rows[0][0], rows[-1][0])
            compare(f"caché {sym} {key}", rows, official, tf)


def part_nuevas(sample_windows=8):
    """D-01 y D-05 en las 43 nuevas: 4h y 1h completas; 15m y 5m en ventanas al azar de 1000 velas."""
    rng = random.Random(20261121)
    for sym in rt.new_symbols():
        for tf in (240, 60):
            bars = rt.candle_bars(sym, tf)
            rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in bars]
            if rows:
                compare(f"nueva {sym} {tf}", rows, bb.klines(sym, tf, rows[0][0], rows[-1][0]), tf)
        for tf in (15, 5):
            if not rt.has_candles(sym, tf):
                results[f"nueva {sym} {tf}"] = {"tf": tf, "absent": True}
                continue
            bars = rt.candle_bars(sym, tf)
            if len(bars) < 2000:
                continue
            for w in range(sample_windows):
                i = rng.randrange(0, len(bars) - 1000)
                rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in bars[i:i + 1000]]
                compare(f"nueva {sym} {tf} ventana {w}", rows, bb.klines(sym, tf, rows[0][0], rows[-1][0]), tf)


def part_agregadas():
    """D-04: 30m de dos velas de 15m y 1D de seis de 4h, contra las oficiales de ese marco."""
    for sym in ("SUIUSDT", "TRXUSDT", "DOGEUSDT", "LINKUSDT"):
        for tf in (30, 1440):
            bars = rt.daily_bars(sym) if tf == 1440 else rt.candle_bars(sym, tf)
            rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in bars]
            if rows:
                compare(f"agregada {sym} {tf}", rows, bb.klines(sym, tf, rows[0][0], rows[-1][0]), tf)
    for sym in STORE_COINS:
        bars = rt.daily_bars(sym)
        rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in bars]
        if rows:
            compare(f"agregada {sym} 1440", rows, bb.klines(sym, 1440, rows[0][0], rows[-1][0]), 1440)


def part_oi(samples=6):
    """D-06: la serie de OI que usa el probador contra la de Bybit, en ventanas al azar."""
    rng = random.Random(7)
    out = {}
    for sym in STORE_COINS + ("SUIUSDT", "TRXUSDT", "DOGEUSDT", "XRPUSDT"):
        src = flow_filters.source(sym)
        if src is None:
            out[sym] = {"absent": True}
            continue
        times, values, step = src
        interval = {5: "5min", 15: "15min", 60: "1h", 240: "4h"}.get(int(step))
        rows = []
        for _ in range(samples):
            i = rng.randrange(0, max(1, len(times) - 300))
            lo, hi = int(times[i]), int(times[min(len(times) - 1, i + 150)])
            official = dict((t, v) for t, v in bb.open_interest(sym, interval, lo, hi))
            mine = {int(t): float(v) for t, v in zip(times[i:i + 151], values[i:i + 151])}
            both = sorted(set(official) & set(mine))
            rel = [abs(mine[t] - official[t]) / official[t] for t in both if official[t]]
            rows.append({"from": rt._iso(lo), "common": len(both), "only_mine": len(set(mine) - set(official)),
                         "max_rel": max(rel) if rel else None, "differ": sum(1 for x in rel if x > 1e-9)})
        out[sym] = {"step_min": int(step), "interval": interval, "first": rt._iso(int(times[0])), "last": rt._iso(int(times[-1])),
                    "windows": rows}
        print("OI", sym, out[sym]["interval"], [(r["common"], r["differ"], r["max_rel"]) for r in rows], flush=True)
    results["oi"] = out


def part_funding():
    """D-07: el funding guardado contra el de Bybit."""
    out = {}
    for sym in STORE_COINS + ("SUIUSDT", "TRXUSDT", "DOGEUSDT", "XRPUSDT", "LINKUSDT"):
        src = flow_filters.funding_series(sym)
        if src is None:
            out[sym] = {"absent": True}
            continue
        times, rates = src
        mine = {int(t): float(r) for t, r in zip(times, rates)}
        lo, hi = int(times[0]), int(times[-1])
        official = dict((t, v) for t, v in bb.funding(sym, lo, hi))
        both = sorted(set(official) & set(mine))
        differ = [t for t in both if abs(mine[t] - official[t]) > 1e-12]
        out[sym] = {"mine": len(mine), "official": len(official), "common": len(both), "differ": len(differ),
                    "only_mine": len(set(mine) - set(official)), "only_official": len(set(official) - set(mine)),
                    "first": rt._iso(lo), "last": rt._iso(hi),
                    "examples": [[rt._iso(t), mine[t], official[t]] for t in differ[:5]]}
        print("funding", sym, out[sym], flush=True)
    results["funding"] = out


PARTS = {"spans": part_spans, "cache": part_cache, "nuevas": part_nuevas, "agregadas": part_agregadas,
         "oi": part_oi, "funding": part_funding}

if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    chosen = sys.argv[1:] or list(PARTS)
    for name in chosen:
        print(f"===== {name} =====", flush=True)
        results.clear()
        try:
            PARTS[name]()
        finally:
            (OUT / f"{name}.json").write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
