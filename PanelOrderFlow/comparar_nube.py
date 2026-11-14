# comparar_nube.py - Compara un dia grabado en la nube (collector de Northflank) con el archivo oficial de Bybit,
# trade por trade, por minuto y por celda del footprint. Pedido del usuario el 13/11/2026: "Comparar un dia completo
# de la nube con el archivo oficial de Bybit".
#
# Solo lee OrderFlowData. El oficial sale de OrderFlowData/tape si ese dia ya esta en el almacen; si no, se baja de
# public.bybit.com a una carpeta aparte (--bajados, o una temporal que se borra al terminar).
#
# Compara dos fuentes contra el oficial:
#   - la nube sola (live/cloud/tape), en lo que la nube dice haber cubierto (sin sus huecos);
#   - la union nube + PC (live/tape), que es lo que leen la suite y App 1 con live=True.
#
# Uso:
#   C:\Python314\python.exe -I -B comparar_nube.py 2026-11-13 BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT
#   ... --bajados C:\carpeta\oficial       (deja ahi los .csv.gz oficiales, para no volver a bajarlos)
#   ... --salida informe.json              (el detalle completo)
#   ... --datos D:\prueba\OrderFlowData    (otra carpeta de datos)
import argparse
import datetime as dt
import importlib.util
import json
import shutil
import site
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.append(site.getusersitepackages())  # numpy tambien con python -I, como ingest.py
import numpy as np  # noqa: E402

REPO = Path(__file__).resolve().parents[1]
DEFAULT_DATA = Path(r"C:\Users\inven\OrderFlowData")
BASE = "https://public.bybit.com/trading/"
DAY_MS = 86_400_000
MIN_MS = 60_000


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def day_start(day: str) -> int:
    return int(dt.datetime.fromisoformat(day + "T00:00:00+00:00").timestamp() * 1000)


# ---------- tramos [inicio, fin) en ms (como sync_nube.py) ----------
def union(spans):
    out = []
    for s, e in sorted([list(x) for x in spans]):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def subtract(spans, holes):
    out = []
    holes = union(holes)
    for s, e in spans:
        cur = s
        for hs, he in holes:
            if he <= cur or hs >= e:
                continue
            if hs > cur:
                out.append([cur, hs])
            cur = max(cur, he)
        if cur < e:
            out.append([cur, e])
    return out


def inside(t10, spans):
    """Trades (hora en 1e-4 s) dentro de los tramos."""
    if not spans:
        return np.zeros(len(t10), dtype=bool)
    edges = np.array([x * 10 for span in spans for x in span], dtype=np.int64)
    return (np.searchsorted(edges, t10, side="right") % 2) == 1


def covered_minutes(spans, ds):
    """Minutos del dia (0 a 1439) que los tramos cubren enteros."""
    out = []
    for m in range(1440):
        a, b = ds + m * MIN_MS, ds + (m + 1) * MIN_MS
        if any(s <= a and b <= e for s, e in spans):
            out.append(m)
    return np.array(out, dtype=np.int64)


# ---------- lectura ----------
def official_trades(ingest, data: Path, sym: str, day: str, folder: Path, log):
    """El dia oficial: (t 1e-4 s, precio, cantidad, lado, rpi, escalas, de donde salio)."""
    tape = data / "tape" / sym / day[:4] / f"{sym}_{day}.tape"
    if tape.exists():
        meta, t, p, q, s, r = ingest.read_tape(tape)
        return dict(t=t, p=p, q=q, s=s, r=np.asarray(r, bool), ps=meta["price_scale"], qs=meta["qty_scale"],
                    origin=f"almacén oficial ({tape.name})")
    url = f"{BASE}{sym}/{sym}{day}.csv.gz"
    gz = folder / f"{sym}{day}.csv.gz"
    size = ingest.remote_size(url)
    if size is None:
        raise RuntimeError(f"Bybit todavía no publica {sym} {day}")
    if not gz.exists() or gz.stat().st_size != size:
        log(f"  bajando {url} ({size / 1e6:.1f} MB)...")
        t0 = time.perf_counter()
        part = gz.with_name(gz.name + ".part")
        subprocess.run(["curl", "-sSfL", "-m", "1800", "-o", str(part), url], check=True)
        if part.stat().st_size != size:
            part.unlink(missing_ok=True)
            raise RuntimeError(f"{sym} {day}: la descarga quedó incompleta")
        part.replace(gz)
        log(f"  bajado en {time.perf_counter() - t0:.0f} s")
    head, T, P, Q, S, R, maxdec, bad = ingest.parse(gz)
    if bad:
        log(f"  {bad} filas ilegibles en el oficial")
    order = np.argsort(T, kind="stable")
    T, P, Q, S, R = T[order], P[order], Q[order], S[order], R[order]
    Pi, ps = ingest.to_int(P, 0)
    Qi, qs = ingest.to_int(Q, 0)
    return dict(t=T, p=Pi, q=Qi, s=S, r=R > 0, ps=ps, qs=qs, origin=f"public.bybit.com ({gz.name}, {maxdec} decimales en la hora)")


def source_trades(tf, path: Path):
    if not path.exists():
        return None
    meta, t, p, q, s, r = tf.read_tape(path)
    return dict(t=t, p=p, q=q, s=np.asarray(s, np.int8), r=np.asarray(r, bool), ps=meta["price_scale"], qs=meta["qty_scale"], meta=meta)


def rescale(a, ps, qs):
    """Lleva precio y cantidad a las escalas dadas (potencias de 10, iguales o mayores)."""
    if ps % a["ps"] or qs % a["qs"]:
        raise ValueError("escalas incompatibles")
    return dict(a, p=a["p"] * (ps // a["ps"]), q=a["q"] * (qs // a["qs"]), ps=ps, qs=qs)


def coverage(meta, day):
    """Lo que la fuente dice haber grabado del dia: de su comienzo a su ultimo guardado, sin sus huecos."""
    if not meta or meta.get("covered_from") is None:
        return []
    ds = day_start(day)
    start = max(int(meta["covered_from"]), ds)
    end = ds + DAY_MS if meta.get("final") else min(ds + DAY_MS, int(meta.get("saved_at") or 0) - 2_000)
    return subtract([[start, end]], meta.get("gaps", [])) if end > start else []


# ---------- comparaciones ----------
def multiset(a_cols, b_cols):
    """Cuantas filas tienen pareja exacta en la otra fuente (como multiconjuntos)."""
    A = np.stack(a_cols, axis=1)
    B = np.stack(b_cols, axis=1)
    if len(A) == 0 or len(B) == 0:
        return dict(matched=0, only_official=int(len(A)), only_source=int(len(B))), None, None
    uniq, inv = np.unique(np.concatenate([A, B]), axis=0, return_inverse=True)
    inv = inv.ravel()
    ca = np.bincount(inv[:len(A)], minlength=len(uniq))
    cb = np.bincount(inv[len(A):], minlength=len(uniq))
    both = np.minimum(ca, cb)
    return (dict(matched=int(both.sum()), only_official=int((ca - both).sum()), only_source=int((cb - both).sum())),
            (ca - both) > 0, uniq)


def per_minute(t10, p, q, s, ds, minutes):
    """n, volumen, compra, venta, maximo y minimo de cada minuto pedido."""
    m = (t10 // 10 - ds) // MIN_MS
    out = {}
    for name, w in (("n", np.ones(len(q), np.int64)), ("vol", q), ("buy", np.where(s > 0, q, 0)), ("sell", np.where(s < 0, q, 0))):
        out[name] = np.bincount(m, weights=w, minlength=1440)[minutes].round().astype(np.int64) if len(m) else np.zeros(len(minutes), np.int64)
    hi = np.full(1440, np.iinfo(np.int64).min, np.int64)
    lo = np.full(1440, np.iinfo(np.int64).max, np.int64)
    np.maximum.at(hi, m, p)
    np.minimum.at(lo, m, p)
    out["high"], out["low"] = hi[minutes], lo[minutes]
    return out


def cells(t10, p, s, q, ds, keep_minutes):
    """Footprint: (minuto, precio, lado) -> cantidad, en los minutos pedidos."""
    m = (t10 // 10 - ds) // MIN_MS
    ok = np.isin(m, keep_minutes)
    if not ok.any():
        return np.zeros((0, 3), np.int64), np.zeros(0, np.int64)
    keys = np.stack([m[ok], p[ok], s[ok].astype(np.int64)], axis=1)
    uniq, inv = np.unique(keys, axis=0, return_inverse=True)
    return uniq, np.bincount(inv.ravel(), weights=q[ok], minlength=len(uniq)).round().astype(np.int64)


def compare(off, src, spans, day, label):
    """Una fuente contra el oficial, en sus tramos cubiertos."""
    ds = day_start(day)
    o_in = inside(off["t"], spans)
    s_in = inside(src["t"], spans)
    # Trade por trade: (milisegundo, precio, cantidad, lado), y luego tambien con la marca RPI
    o_ms, s_ms = off["t"][o_in] // 10, src["t"][s_in] // 10
    o_cols = [o_ms, off["p"][o_in], off["q"][o_in], off["s"][o_in].astype(np.int64)]
    s_cols = [s_ms, src["p"][s_in], src["q"][s_in], src["s"][s_in].astype(np.int64)]
    exact, _, _ = multiset(o_cols, s_cols)
    with_rpi, _, _ = multiset(o_cols + [off["r"][o_in].astype(np.int64)], s_cols + [src["r"][s_in].astype(np.int64)])
    # Lo que no tuvo pareja exacta, con 1 ms de tolerancia en la hora
    near = None
    if exact["only_official"] and exact["only_source"]:
        o_keys = np.stack(o_cols, axis=1)
        s_keys = np.stack(s_cols, axis=1)
        o_left = left_over(o_keys, s_keys)
        s_left = left_over(s_keys, o_keys)
        found = 0
        for shift in (-1, 1):
            shifted = o_left.copy()
            shifted[:, 0] += shift
            m, _, _ = multiset([shifted[:, i] for i in range(4)], [s_left[:, i] for i in range(4)])
            found += m["matched"]
        near = dict(official_left=int(len(o_left)), source_left=int(len(s_left)), matched_within_1ms=int(found))
    minutes = covered_minutes(spans, ds)
    a = per_minute(off["t"], off["p"], off["q"], off["s"], ds, minutes)
    b = per_minute(src["t"], src["p"], src["q"], src["s"], ds, minutes)
    same = {k: int((a[k] == b[k]).sum()) for k in a}
    diff_vol = (b["vol"] - a["vol"]).astype(np.int64)
    worst = np.argsort(-np.abs(diff_vol))[:10]
    worst_minutes = [dict(minuto=dt.datetime.fromtimestamp((ds + int(minutes[i]) * MIN_MS) / 1000, dt.timezone.utc).strftime("%H:%M"),
                          oficial=int(a["vol"][i]), fuente=int(b["vol"][i]), trades_oficial=int(a["n"][i]), trades_fuente=int(b["n"][i]))
                     for i in worst if diff_vol[i] != 0]
    ka, va = cells(off["t"], off["p"], off["s"], off["q"], ds, minutes)
    kb, vb = cells(src["t"], src["p"], src["s"], src["q"], ds, minutes)
    allk = np.concatenate([ka, kb]) if len(ka) or len(kb) else np.zeros((0, 3), np.int64)
    cells_same = cells_total = 0
    if len(allk):
        uniq_c, inv_c = np.unique(allk, axis=0, return_inverse=True)
        inv_c = inv_c.ravel()
        qa = np.bincount(inv_c[:len(ka)], weights=va, minlength=len(uniq_c)).round()
        qb = np.bincount(inv_c[len(ka):], weights=vb, minlength=len(uniq_c)).round()
        cells_total = int(len(uniq_c))
        cells_same = int((qa == qb).sum())
    vol_o = int(off["q"][o_in].sum())
    vol_s = int(src["q"][s_in].sum())
    return dict(
        fuente=label,
        tramos=len(spans), ms_cubiertos=int(sum(e - s for s, e in spans)),
        trades=dict(oficial=int(o_in.sum()), fuente=int(s_in.sum()), **exact,
                    pareja_con_rpi=with_rpi["matched"], a_1ms=near),
        volumen=dict(oficial=vol_o / off["qs"], fuente=vol_s / off["qs"], diferencia_pct=(vol_s - vol_o) / vol_o * 100 if vol_o else None),
        minutos=dict(enteros=int(len(minutes)), iguales=same, peores=worst_minutes),
        footprint=dict(celdas=cells_total, iguales=cells_same),
    )


def left_over(a, b):
    """Filas de a sin pareja en b (multiconjunto), para buscarles pareja con tolerancia."""
    if len(a) == 0:
        return a
    if len(b) == 0:
        return a.copy()
    uniq, inv = np.unique(np.concatenate([a, b]), axis=0, return_inverse=True)
    inv = inv.ravel()
    ca = np.bincount(inv[:len(a)], minlength=len(uniq))
    cb = np.bincount(inv[len(a):], minlength=len(uniq))
    extra = ca - np.minimum(ca, cb)
    return np.repeat(uniq, extra, axis=0)


def missed(off, spans, day):
    """Lo que el oficial tiene fuera de lo cubierto por la fuente (sus huecos y lo que no alcanzo a grabar)."""
    ds = day_start(day)
    holes = subtract([[ds, ds + DAY_MS]], spans)
    o_out = ~inside(off["t"], spans)
    total_q = int(off["q"].sum())
    return dict(
        huecos=[dict(desde=dt.datetime.fromtimestamp(s / 1000, dt.timezone.utc).strftime("%H:%M:%S"),
                     hasta=dt.datetime.fromtimestamp(e / 1000, dt.timezone.utc).strftime("%H:%M:%S"), segundos=round((e - s) / 1000, 1))
                for s, e in holes],
        segundos=round(sum(e - s for s, e in holes) / 1000, 1),
        trades=int(o_out.sum()), volumen=int(off["q"][o_out].sum()) / off["qs"],
        pct_volumen=int(off["q"][o_out].sum()) / total_q * 100 if total_q else None,
    )


def run(day, symbols, data: Path, folder: Path, log=print):
    ingest = load_module(data / "tools" / "ingest.py", "ingest_tools")
    tf = load_module(REPO / "5.Order_flow" / "cloud_collector" / "tape_format.py", "tape_format")
    report = dict(dia=day, hecho=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"), monedas={})
    for sym in symbols:
        log(f"{sym} {day}")
        t0 = time.perf_counter()
        try:
            off = official_trades(ingest, data, sym, day, folder, log)
        except Exception as e:
            log(f"  sin oficial: {e}")
            report["monedas"][sym] = dict(error=str(e))
            continue
        entry = dict(oficial=dict(origen=off["origin"], trades=int(len(off["t"])), volumen=int(off["q"].sum()) / off["qs"]))
        for label, root in (("nube", data / "live" / "cloud" / "tape"), ("nube + PC", data / "live" / "tape")):
            src = source_trades(tf, root / sym / day[:4] / f"{sym}_{day}.tape")
            if src is None:
                entry[label] = dict(error="sin archivo")
                continue
            ps, qs = max(off["ps"], src["ps"]), max(off["qs"], src["qs"])
            o2, s2 = rescale(off, ps, qs), rescale(src, ps, qs)
            spans = coverage(src["meta"], day)
            res = compare(o2, s2, spans, day, label)
            res["fuera"] = missed(o2, spans, day)
            entry[label] = res
        entry["segundos"] = round(time.perf_counter() - t0, 1)
        report["monedas"][sym] = entry
        log(summary_line(sym, entry))
    return report


def summary_line(sym, e):
    lines = []
    for label in ("nube", "nube + PC"):
        r = e.get(label) or {}
        if "error" in r:
            lines.append(f"  {label}: {r['error']}")
            continue
        tr, mi, fp, out = r["trades"], r["minutos"], r["footprint"], r["fuera"]
        pct = tr["matched"] / tr["oficial"] * 100 if tr["oficial"] else 0
        lines.append(
            f"  {label}: {tr['matched']:,} de {tr['oficial']:,} trades del oficial con pareja exacta ({pct:.4f}%), "
            f"{tr['only_source']:,} de más; volumen {r['volumen']['diferencia_pct']:+.4f}%; "
            f"minutos enteros {mi['enteros']} (volumen igual en {mi['iguales']['vol']}, máximo y mínimo en "
            f"{min(mi['iguales']['high'], mi['iguales']['low'])}); celdas del footprint iguales {fp['iguales']:,} de {fp['celdas']:,}; "
            f"sin cubrir {out['segundos']:.0f} s ({out['pct_volumen']:.2f}% del volumen del día)")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="Compara un día de la nube con el archivo oficial de Bybit (solo lectura)")
    ap.add_argument("dia", help="AAAA-MM-DD (día UTC)")
    ap.add_argument("monedas", help="BTCUSDT,ETHUSDT,...")
    ap.add_argument("--datos", default=str(DEFAULT_DATA))
    ap.add_argument("--bajados", default=None, help="carpeta para los .csv.gz oficiales (se conservan)")
    ap.add_argument("--salida", default=None, help="archivo JSON con el detalle")
    a = ap.parse_args()
    folder = Path(a.bajados) if a.bajados else Path(tempfile.mkdtemp(prefix="oficial_bybit_"))
    folder.mkdir(parents=True, exist_ok=True)
    try:
        report = run(a.dia, [s.strip().upper() for s in a.monedas.split(",") if s.strip()], Path(a.datos), folder)
    finally:
        if not a.bajados:
            shutil.rmtree(folder, ignore_errors=True)
    if a.salida:
        Path(a.salida).write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"detalle en {a.salida}")


if __name__ == "__main__":
    main()
