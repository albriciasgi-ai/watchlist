# sync_nube.py - Arma los dias que el almacen oficial todavia no tiene, con los trades grabados en la
# nube (collector de Northflank) y en este PC (backend de Order Flow, puerto 11000).
#
#   OrderFlowData/live/cloud/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape   bajado de la nube
#   OrderFlowData/live/local/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape   grabado por el backend local
#   OrderFlowData/live/tape/...   union de los dos (.tape y .json con huecos y hasta donde llega)
#   OrderFlowData/live/store/...  por minuto y precio, como store/ (build_store.py)
#   OrderFlowData/live/flow/...   Max/Min Delta y ordenes, como flow/ (build_flow.py)
#
# Union: cada fuente cubre desde su primer trade (o el inicio del dia) hasta su ultimo guardado,
# menos sus huecos. Donde cubre la nube manda la nube; lo que solo cubre el PC se toma del PC.
# Lo que ninguna cubre queda como hueco. Cuando el dia oficial existe, manda el oficial: ese dia
# no se arma. El lector de App 1 (footprint_store.py con live=True) lee live/store y el .json.
#
# Uso:
#   C:\Python314\python.exe -B sync_nube.py                 (nube y PC, todas las monedas, ultimos 10 dias)
#   C:\Python314\python.exe -B sync_nube.py --monedas BTCUSDT,ETHUSDT --dias 5
#   C:\Python314\python.exe -B sync_nube.py --sin-nube      (solo lo grabado en el PC; lo usa el backend)
#   C:\Python314\python.exe -B sync_nube.py --datos D:\prueba\OrderFlowData   (otra carpeta de datos)
import argparse
import datetime as dt
import importlib.util
import json
import os
import re
import shutil
import sys
import time
import urllib.request
from pathlib import Path

import numpy as np

DEFAULT_DATA = r"C:\Users\inven\OrderFlowData"
DEFAULT_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"
REPO = Path(__file__).resolve().parents[1]
TAPE_FORMAT = REPO / "5.Order_flow" / "cloud_collector" / "tape_format.py"
DAY_MS = 86_400_000
LAG_MS = 2_000  # un trade puede llegar hasta ~2 s despues de su hora: lo ultimo antes de guardar no se da por cubierto
DAY_FILE = re.compile(r"^([A-Z0-9]+)_(\d{4}-\d{2}-\d{2})\.tape$")


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(path))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def get_json(url: str, timeout=60):
    req = urllib.request.Request(url, headers={"User-Agent": "sync-nube"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def download(url: str, dst: Path, timeout=300):
    tmp = dst.with_name(dst.name + ".descarga")
    req = urllib.request.Request(url, headers={"User-Agent": "sync-nube"})
    with urllib.request.urlopen(req, timeout=timeout) as r, open(tmp, "wb") as f:
        while True:
            chunk = r.read(1 << 20)
            if not chunk:
                break
            f.write(chunk)
    return tmp


def day_path(root: Path, sym: str, day: str, ext=".tape") -> Path:
    return root / sym / day[:4] / f"{sym}_{day}{ext}"


def day_start(day: str) -> int:
    return int(dt.datetime.fromisoformat(day + "T00:00:00+00:00").timestamp() * 1000)


# ---------- tramos de tiempo [inicio, fin) en ms ----------
def union(a, b):
    out = []
    for s, e in sorted([list(x) for x in a] + [list(x) for x in b]):
        if out and s <= out[-1][1]:
            out[-1][1] = max(out[-1][1], e)
        else:
            out.append([s, e])
    return out


def subtract(spans, holes):
    out = []
    holes = union(holes, [])
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


def coverage(meta, day):
    """Tramos del dia que una fuente grabo: desde su primer trade hasta su ultimo guardado, sin sus huecos."""
    if not meta or meta.get("covered_from") is None:
        return []
    ds = day_start(day)
    start = max(int(meta["covered_from"]), ds)
    if meta.get("final"):
        end = ds + DAY_MS
    elif meta.get("saved_at") is None:
        return []
    else:
        end = min(ds + DAY_MS, int(meta["saved_at"]) - LAG_MS)
    if end <= start:
        return []
    return subtract([[start, end]], meta.get("gaps", []))


def inside(t_ms10, spans):
    """Trades (hora en 1e-4 s) dentro de los tramos."""
    if not spans:
        return np.zeros(len(t_ms10), dtype=bool)
    edges = np.array([x * 10 for span in spans for x in span], dtype=np.int64)
    return (np.searchsorted(edges, t_ms10, side="right") % 2) == 1


def merge_day(tf, cloud_path: Path, local_path: Path, sym: str, day: str):
    """Une la nube y el PC. Devuelve (meta, t, p, q, side, rpi) o None si no hay trades."""
    src = {}
    for name, path in (("cloud", cloud_path), ("local", local_path)):
        if path.exists():
            src[name] = tf.read_tape(path)
    if not src:
        return None
    if "cloud" in src and "local" in src:
        mc, ml = src["cloud"][0], src["local"][0]
        if (mc["price_scale"], mc["qty_scale"]) != (ml["price_scale"], ml["qty_scale"]):
            print(f"{sym} {day}: escalas distintas entre nube y PC; se usa solo la nube")
            del src["local"]
    cov_cloud = coverage(src["cloud"][0], day) if "cloud" in src else []
    cov_local_all = coverage(src["local"][0], day) if "local" in src else []
    cov_local = subtract(cov_local_all, cov_cloud)  # donde cubre la nube manda la nube
    parts = []
    for name, spans in (("cloud", cov_cloud), ("local", cov_local)):
        if name not in src or not spans:
            continue
        _, t, p, q, side, rpi = src[name]
        keep = inside(t, spans)
        parts.append((t[keep], p[keep], q[keep], np.asarray(side[keep], dtype=np.int8), np.asarray(rpi[keep], dtype=np.int8)))
    if not parts or sum(len(x[0]) for x in parts) == 0:
        return None
    t, p, q, side, rpi = (np.concatenate([x[i] for x in parts]) for i in range(5))
    order = np.argsort(t, kind="stable")
    t, p, q, side, rpi = t[order], p[order], q[order], side[order], rpi[order]

    covered = union(cov_cloud, cov_local_all)
    ds = day_start(day)
    covered_from, end = covered[0][0], covered[-1][1]
    gaps = subtract([[covered_from, end]], covered)
    final = any(m[0].get("final") for m in src.values()) and end >= ds + DAY_MS
    first = next(iter(src.values()))[0]
    meta = dict(
        symbol=sym, date=day, price_scale=first["price_scale"], qty_scale=first["qty_scale"],
        source="bybit-ws-merged", ts_decimals=3, covered_from=covered_from, saved_at=end, gaps=gaps,
        complete=bool(final and not gaps and covered_from - ds <= 60_000), final=bool(final),
        inexact=int(sum(int(m[0].get("inexact", 0)) for m in src.values())),
        sources={name: dict(n=int(m[0].get("n", 0)), covered_from=m[0].get("covered_from"),
                            saved_at=m[0].get("saved_at"), final=bool(m[0].get("final")))
                 for name, m in src.items()},
        from_cloud=int(len(parts[0][0])) if cov_cloud and "cloud" in src else 0,
    )
    meta["from_local"] = int(len(t)) - meta["from_cloud"]
    return meta, t, p, q, side, rpi


def file_sig(path: Path):
    try:
        st = path.stat()
        return [st.st_mtime_ns, st.st_size]
    except OSError:
        return None


def refresh(data: Path, tools: Path, base_url=DEFAULT_URL, symbols=None, days_back=10, cloud=True, log=print):
    """Baja de la nube lo que cambio (si cloud) y rearma los dias cuya nube o PC cambio."""
    tf = load_module(TAPE_FORMAT, "tape_format")
    bs = load_module(tools / "build_store.py", "build_store")
    bf = load_module(tools / "build_flow.py", "build_flow")
    live = data / "live"
    cloud_root, local_root, merged_root = live / "cloud" / "tape", live / "local" / "tape", live / "tape"
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days_back)).strftime("%Y-%m-%d")

    def official(sym, day):
        return day_path(data / "tape", sym, day).exists()

    if cloud:
        try:
            listing = get_json(f"{base_url}/api/tape/days")
        except Exception as e:
            listing = {}
            log(f"nube no disponible ({e}); se sigue con lo grabado en el PC")
        for sym, days in sorted(listing.items()):
            if symbols and sym not in symbols:
                continue
            for d in days:
                day = d["day"]
                if day < cutoff or official(sym, day):
                    continue
                tape = day_path(cloud_root, sym, day)
                state = tape.with_suffix(".json")
                prev = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
                if tape.exists() and prev.get("saved_at") == d.get("saved_at"):
                    continue  # sin cambios en la nube
                tape.parent.mkdir(parents=True, exist_ok=True)
                try:
                    tmp = download(f"{base_url}/api/tape/{sym}/{day}", tape)
                    meta = tf.read_meta(tmp)
                    if meta.get("symbol") != sym or meta.get("date") != day or not meta.get("n"):
                        raise ValueError(f"archivo inesperado: {meta.get('symbol')} {meta.get('date')} n={meta.get('n')}")
                except Exception as e:
                    Path(str(tape) + ".descarga").unlink(missing_ok=True)
                    log(f"{sym} {day}: descarga invalida ({e}); se conserva lo anterior")
                    continue
                os.replace(tmp, tape)
                state.write_text(json.dumps(dict(d, synced_at=int(time.time() * 1000))), encoding="utf-8")

    # Dias con datos de la nube o del PC
    days = set()
    for root in (cloud_root, local_root):
        for f in root.glob("*/*/*.tape"):
            m = DAY_FILE.match(f.name)
            if m and m.group(2) >= cutoff and (not symbols or m.group(1) in symbols):
                days.add((m.group(1), m.group(2)))

    bs.DATA = str(live)  # build_day lee {DATA}/tape: apuntado a live/, arma la union con el mismo codigo
    bf.DATA = str(live)
    build = live / "_armando"
    summary = []
    for sym, day in sorted(days):
        if official(sym, day):
            continue
        cpath, lpath = day_path(cloud_root, sym, day), day_path(local_root, sym, day)
        sig = {"cloud": file_sig(cpath), "local": file_sig(lpath)}
        state_path = day_path(merged_root, sym, day, ".json")
        try:
            prev = json.loads(state_path.read_text(encoding="utf-8"))
        except Exception:
            prev = {}
        if prev.get("inputs") == sig and day_path(live / "store", sym, day, ".npz").exists():
            continue
        try:
            merged = merge_day(tf, cpath, lpath, sym, day)
        except Exception as e:
            log(f"{sym} {day}: no se pudo unir ({e})")
            continue
        if merged is None:
            continue
        meta, t, p, q, side, rpi = merged
        out = day_path(merged_root, sym, day)
        out.parent.mkdir(parents=True, exist_ok=True)
        tf.write_tape(out, meta, t, p, q, side, rpi, level=9 if meta["final"] else 6)
        # Almacen y flujo en una carpeta aparte y despues reemplazo: el lector nunca ve un dia a medias
        shutil.rmtree(build, ignore_errors=True)
        try:
            bs.build_day(sym, day, str(build / "store"))
            bf.build_flow_day(sym, day, str(build / "flow"))
            for sub in ("store", "flow"):
                made = day_path(build / sub, sym, day, ".npz")
                if made.exists():
                    dst = day_path(live / sub, sym, day, ".npz")
                    dst.parent.mkdir(parents=True, exist_ok=True)
                    os.replace(made, dst)
        finally:
            shutil.rmtree(build, ignore_errors=True)
        state = {k: meta[k] for k in ("covered_from", "saved_at", "gaps", "complete", "final", "from_cloud", "from_local", "sources")}
        state.update(day=day, n=int(len(t)), inputs=sig, built_at=int(time.time() * 1000))
        tmp = state_path.with_name(state_path.name + ".tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        os.replace(tmp, state_path)
        estado = "completo" if meta["complete"] else ("en curso" if not meta["final"] else f"con {len(meta['gaps'])} hueco(s)")
        log(f"{sym} {day}: {len(t)} trades, {meta['from_cloud']} de la nube y {meta['from_local']} del PC ({estado})")
        summary.append((sym, day, int(len(t)), estado))
    return summary


def main():
    ap = argparse.ArgumentParser(description="Arma los dias que el almacen oficial no tiene, con la nube y el PC")
    ap.add_argument("--datos", default=DEFAULT_DATA)
    ap.add_argument("--herramientas", default=None, help="carpeta de ingest.py/build_store.py (por defecto <datos>\\tools)")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--monedas", default="")
    ap.add_argument("--dias", type=int, default=10)
    ap.add_argument("--sin-nube", action="store_true", help="no bajar de la nube, solo unir lo ya bajado con lo del PC")
    a = ap.parse_args()
    data = Path(a.datos)
    tools = Path(a.herramientas) if a.herramientas else data / "tools"
    symbols = {s.strip().upper() for s in a.monedas.split(",") if s.strip()} or None
    res = refresh(data, tools, a.url.rstrip("/"), symbols, a.dias, cloud=not a.sin_nube)
    print(f"listo: {len(res)} dia(s) actualizados")


if __name__ == "__main__":
    sys.exit(main())
