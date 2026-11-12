# sync_nube.py - Baja de la nube (collector de Northflank) los trades de los dias que el almacen
# oficial todavia no tiene, y arma con ellos el almacen y el flujo de esos dias.
#
#   OrderFlowData/live/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape   (trades grabados en la nube)
#   OrderFlowData/live/store/...                                   (por minuto y precio, como store/)
#   OrderFlowData/live/flow/...                                    (Max/Min Delta y ordenes, como flow/)
#
# Mismo formato y mismos nombres que tape/, store/ y flow/, en una carpeta aparte para que
# build_store.py y el lector de App 1 no se confundan. Cuando el dia oficial existe, manda el oficial:
# este script no baja ese dia.
#
# Uso:
#   C:\Python314\python.exe -B sync_nube.py                 (todas las monedas de la nube, ultimos 10 dias)
#   C:\Python314\python.exe -B sync_nube.py --monedas BTCUSDT,ETHUSDT --dias 5
#   C:\Python314\python.exe -B sync_nube.py --datos D:\prueba\OrderFlowData   (otra carpeta de datos)
import argparse
import datetime as dt
import importlib.util
import json
import os
import sys
import time
import urllib.request
from pathlib import Path

DEFAULT_DATA = r"C:\Users\inven\OrderFlowData"
DEFAULT_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"


def load_tool(tools_dir: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, str(tools_dir / f"{name}.py"))
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


def sync(base_url: str, data: Path, tools: Path, symbols=None, days_back=10, log=print):
    ing = load_tool(tools, "ingest")
    bs = load_tool(tools, "build_store")
    bf = load_tool(tools, "build_flow")
    live = data / "live"
    # build_day lee {DATA}/tape/...: apuntado a live/, arma los dias de la nube con el mismo codigo
    bs.DATA = str(live)
    bf.DATA = str(live)

    listing = get_json(f"{base_url}/api/tape/days")
    cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days_back)).strftime("%Y-%m-%d")
    summary = []
    for sym, days in sorted(listing.items()):
        if symbols and sym not in symbols:
            continue
        for d in days:
            day = d["day"]
            if day < cutoff:
                continue
            if (data / "tape" / sym / day[:4] / f"{sym}_{day}.tape").exists():
                continue  # el oficial manda
            tape = live / "tape" / sym / day[:4] / f"{sym}_{day}.tape"
            state = tape.with_suffix(".json")
            prev = json.loads(state.read_text(encoding="utf-8")) if state.exists() else {}
            if tape.exists() and prev.get("saved_at") == d.get("saved_at"):
                continue  # sin cambios en la nube
            tape.parent.mkdir(parents=True, exist_ok=True)
            tmp = download(f"{base_url}/api/tape/{sym}/{day}", tape)
            try:
                meta, t, p, q, s, _ = ing.read_tape(str(tmp))
                if meta.get("symbol") != sym or meta.get("date") != day or len(t) == 0:
                    raise ValueError(f"archivo inesperado: {meta.get('symbol')} {meta.get('date')} n={len(t)}")
            except Exception as e:
                tmp.unlink(missing_ok=True)
                log(f"{sym} {day}: descarga invalida ({e}); se conserva lo anterior")
                continue
            os.replace(tmp, tape)
            # El dia cambio: se rearman sus archivos (por nombre exacto) con build_store/build_flow
            for sub in ("store", "flow"):
                (live / sub / sym / day[:4] / f"{sym}_{day}.npz").unlink(missing_ok=True)
            bs.build_day(sym, day, str(live / "store"))
            bf.build_flow_day(sym, day, str(live / "flow"))
            state.write_text(json.dumps(dict(d, synced_at=int(time.time() * 1000))), encoding="utf-8")
            estado = "completo" if d.get("complete") else ("en curso" if not d.get("final") else f"con {len(d.get('gaps', []))} hueco(s)")
            log(f"{sym} {day}: {len(t)} trades ({estado})")
            summary.append((sym, day, len(t), estado))
    return summary


def main():
    ap = argparse.ArgumentParser(description="Baja de la nube los dias que el almacen oficial no tiene")
    ap.add_argument("--datos", default=DEFAULT_DATA)
    ap.add_argument("--herramientas", default=None, help="carpeta de ingest.py/build_store.py (por defecto <datos>\\tools)")
    ap.add_argument("--url", default=DEFAULT_URL)
    ap.add_argument("--monedas", default="")
    ap.add_argument("--dias", type=int, default=10)
    a = ap.parse_args()
    data = Path(a.datos)
    tools = Path(a.herramientas) if a.herramientas else data / "tools"
    symbols = {s.strip().upper() for s in a.monedas.split(",") if s.strip()} or None
    res = sync(a.url.rstrip("/"), data, tools, symbols, a.dias)
    print(f"listo: {len(res)} dia(s) actualizados")


if __name__ == "__main__":
    sys.exit(main())
