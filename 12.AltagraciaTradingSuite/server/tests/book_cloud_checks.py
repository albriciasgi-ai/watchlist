# Pruebas sin conexion del libro en la nube (13/11/2026):
#   - el collector (5.Order_flow/cloud_collector/main.py) lista los dias y entrega solo los minutos pedidos;
#   - la suite (book_cloud.py) baja solo lo que falta o esta incompleto en el PC, y no repite al volver a pasar;
#   - los lectores juntan PC y nube sin repetir minutos, con el bloque de mas cobertura;
#   - las copias de book_recorder.py y book_store.py de la nube son iguales a las de la suite;
#   - la limpieza borra solo los dias viejos.
# Ni Bybit ni Northflank se consultan: la nube corre en este mismo proceso (httpx.ASGITransport).
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\book_cloud_checks.py
import asyncio
import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_book_cloud_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_ORDERFLOW_DATA"] = str(TMP / "pc")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"
os.environ["DATA_DIR"] = str(TMP / "nube")           # la del collector
os.environ["SYMBOLS"] = "BTCUSDT,ETHUSDT"
HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
REPO = SERVER.parents[1]
CLOUD = REPO / "5.Order_flow" / "cloud_collector"
sys.path.insert(0, str(SERVER))
sys.path.append(str(CLOUD))

import httpx  # noqa: E402
import numpy as np  # noqa: E402
import book_cloud  # noqa: E402
import book_store  # noqa: E402

results = []
MIN = 60_000


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def write_minutes(base, sym, minutes, cov=MIN, value=1.0):
    """Bloques de segundos y de minuto armados a mano para esos minutos."""
    files = {}
    for m in minutes:
        n = 5
        ts = list(range(m, m + MIN, 1000))[: (cov // 1000) or 1]
        rows = np.full((len(ts), n), value, np.float32)
        hs = {"v": 1, "s": sym, "t": m, "tick": 0.1, "step": 50, "kmid": 13800, "n": n, "ts": ts,
              "bb": [69000.0] * len(ts), "ba": [69000.1] * len(ts), "cov": cov, "gap": cov < MIN}
        hm = {"v": 1, "s": sym, "t": m, "tick": 0.1, "step": 200, "kmid": 3450, "n": n, "cov": cov, "gap": cov < MIN,
              "samples": len(ts), "mid": 69000.0}
        day = book_store.day_of(m)
        files.setdefault(book_store.day_path(base, sym, day, "bks"), []).append(book_store.seconds_block(m, hs, rows, rows))
        col = np.full(n, value, np.float32)
        files.setdefault(book_store.day_path(base, sym, day, "bkm"), []).append(book_store.minute_block(m, hm, col, col, col, col))
    for path, items in files.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "ab") as fh:
            fh.write(b"".join(items))
    book_store._index.clear()


try:
    check("la copia de book_recorder.py en la nube es igual a la de la suite",
          (CLOUD / "book_recorder.py").read_bytes() == (SERVER / "book_recorder.py").read_bytes())
    check("la copia de book_store.py en la nube es igual a la de la suite",
          (CLOUD / "book_store.py").read_bytes() == (SERVER / "book_store.py").read_bytes())

    spec = importlib.util.spec_from_file_location("collector_main", CLOUD / "main.py")
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)   # sin lifespan: no conecta a Bybit
    D0 = 1_800_000_000_000 - 1_800_000_000_000 % 86_400_000 + 86_400_000   # inicio de un dia UTC
    day = book_store.day_of(D0)
    nube = book_store.root(TMP / "nube")
    pc = book_store.root(TMP / "pc")
    espejo = book_store.cloud_root(TMP / "pc")
    cloud_minutes = [D0 + i * MIN for i in range(120)]                       # la nube: dos horas seguidas
    write_minutes(nube, "BTCUSDT", cloud_minutes, value=2.0)
    write_minutes(pc, "BTCUSDT", [D0 + i * MIN for i in range(0, 30)], value=1.0)               # el PC: la primera media hora
    write_minutes(pc, "BTCUSDT", [D0 + 30 * MIN], cov=20_000, value=1.0)                         # y un minuto a medias
    write_minutes(nube, "ETHUSDT", [D0 + i * MIN for i in range(10)], value=3.0)                 # una moneda que la suite no tiene

    transport = httpx.ASGITransport(app=collector.app)

    async def scenario():
        async with httpx.AsyncClient(transport=transport, base_url="http://nube") as http:
            listing = (await http.get("/api/book/days")).json()
            btc = listing["symbols"]["BTCUSDT"][day]
            got = await http.get(f"/api/book/BTCUSDT/{day}/bkm", params={"from_ms": D0 + 10 * MIN, "to_ms": D0 + 13 * MIN})
            blocks = book_store.split_raw(got.content)
            bad = await http.get("/api/book/BTCUSDT/2026-13-99/bkm")
            sync = book_cloud.CloudSync(TMP / "pc", "http://nube", lambda: ["BTCUSDT", "SOLUSDT"], http)
            first = await sync.run_once(now_ms=D0 + 3 * 3600_000)
            again = await sync.run_once(now_ms=D0 + 3 * 3600_000)
            return btc, [m for m, _ in blocks], bad.status_code, first, again

    btc, mins, bad, first, again = asyncio.run(scenario())
    check("la nube lista el dia con sus minutos en tramos", btc["bkm"]["minutes"] == [[D0, D0 + 120 * MIN]] and btc["bks"]["bytes"] > 0,
          str(btc["bkm"]["minutes"]))
    check("la nube entrega solo los minutos pedidos", mins == [D0 + 10 * MIN, D0 + 11 * MIN, D0 + 12 * MIN], str(mins))
    check("un dia mal escrito no se busca", bad == 404)
    check("la suite baja solo lo que el PC no tiene completo (90 de 120 minutos)", first["minutes"] == 90, str(first))
    check("al volver a pasar no baja nada", again["minutes"] == 0 and again["bytes"] == 0, str(again))
    check("una moneda que la suite no graba no se baja", not book_store.day_path(espejo, "ETHUSDT", day, "bkm").exists())
    espejo_min = book_store.minutes_in(book_store.day_path(espejo, "BTCUSDT", day, "bkm"))
    check("el espejo tiene del minuto 30 al 119, sin repetir", espejo_min == [D0 + i * MIN for i in range(30, 120)])
    both = book_store.sources(TMP / "pc")
    cols = book_store.minute_columns(both, "BTCUSDT", D0, D0 + 120 * MIN)
    secs = book_store.second_rows(both, "BTCUSDT", D0, D0 + 120 * MIN)
    check("juntas, PC y nube dan 120 minutos, uno por minuto", len(cols) == 120 and len(secs) == 120)
    check("donde el PC tenia el minuto completo, se usa el del PC",
          all(float(p["twa_b"][0]) == 1.0 for h, p in cols if h["t"] < D0 + 30 * MIN))
    check("donde el PC lo tenia a medias, gana el de la nube (mas cobertura)",
          float([p for h, p in cols if h["t"] == D0 + 30 * MIN][0]["twa_b"][0]) == 2.0
          and len([h for h, _, _ in secs if h["t"] == D0 + 30 * MIN][0]["ts"]) == 60)
    check("el resto sale de la nube", all(float(p["twa_b"][0]) == 2.0 for h, p in cols if h["t"] > D0 + 30 * MIN))
    check("un minuto en curso no se pide", book_cloud.wanted([[D0, D0 + 5 * MIN]], {}, set(), D0 + 4 * MIN + 1) ==
          [D0, D0 + MIN, D0 + 2 * MIN])
    budget = book_cloud.CloudSync(TMP / "pc2", "http://nube", lambda: ["BTCUSDT"], None)

    async def limited():
        async with httpx.AsyncClient(transport=transport, base_url="http://nube") as http:
            budget.http = http
            return await budget.run_once(now_ms=D0 + 3 * 3600_000, budget=1)

    lim = asyncio.run(limited())
    check("con poco presupuesto baja un tramo y deja el resto para la vuelta siguiente",
          lim["minutes"] == 60 and lim["pending"] == 60, str(lim))
    # limpieza de la nube: borra los dias viejos y nunca el de hoy
    old = D0 - 5 * 86_400_000
    write_minutes(nube, "BTCUSDT", [old], value=1.0)
    deleted = book_store.cleanup_days(nube, 3, D0 + 3600_000)
    check("la limpieza borra solo los dias de mas de 3", deleted == 2 and book_store.day_path(nube, "BTCUSDT", day, "bks").exists()
          and not book_store.day_path(nube, "BTCUSDT", book_store.day_of(old), "bks").exists(), str(deleted))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok}/{len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
