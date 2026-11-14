# Pruebas sin conexion del mapa de liquidez (book_heatmap.py, 13/11/2026), con minutos de libro armados a mano:
#   - "toda" promedia la vela y "sostenida" deja solo lo que estuvo los ultimos N minutos;
#   - un muro fijo queda en su fila de precio; lo que aparece y desaparece se va en "sostenida";
#   - un minuto que falta deja sin dato lo sostenido que lo incluye, y baja la cobertura de su vela;
#   - el paso y la primera fila pedidos se respetan (para pedir despues solo las ultimas velas);
#   - la ruta valida lo que recibe.
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\book_heatmap_checks.py
import base64
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_heatmap_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_ORDERFLOW_DATA"] = str(TMP / "of")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
import book_heatmap  # noqa: E402
import book_store  # noqa: E402

results = []
MIN = 60_000
T0 = 1_800_000_000_000 - 1_800_000_000_000 % 86_400_000 + 86_400_000   # inicio de un dia UTC


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


# cubos de 20 USD (tick 0.1 x 200) alrededor de 70,000: kmid 3500 es el cubo de 70,000 a 70,020
TICK, STEP, KMID, N = 0.1, 200, 3500, 40
WALL_K, FLICK_K = 3490, 3510               # muro de compra en 69,800-69,820; venta que parpadea en 70,200-70,220


def write(base, sym, minutes, skip=()):
    raw = {}
    for m in minutes:
        if m in skip:
            continue
        i = (m - T0) // MIN
        bids = np.zeros(N, np.float32)
        asks = np.zeros(N, np.float32)
        bids[KMID - WALL_K] = 10.0                       # 10 BTC todo el tiempo
        asks[FLICK_K - KMID] = 4.0 if i % 2 == 0 else 0.0  # 4 BTC un minuto si y otro no
        h = {"v": 1, "s": sym, "t": m, "tick": TICK, "step": STEP, "kmid": KMID, "n": N, "cov": MIN, "gap": False,
             "samples": 60, "mid": 70010.0}
        raw.setdefault(book_store.day_path(base, sym, book_store.day_of(m), "bkm"), []).append(
            book_store.minute_block(m, h, bids, asks, bids, asks))
    for path, items in raw.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "ab") as fh:
            fh.write(b"".join(items))
    book_store._index.clear()


def cells(g):
    return np.frombuffer(base64.b64decode(g["cells"]), np.uint8).reshape(g["cols"], g["rows"])


try:
    base = book_store.root(TMP / "of")
    minutes = [T0 + i * MIN for i in range(120)]
    write(base, "MAPAUSDT", minutes)
    srcs = book_store.sources(TMP / "of")
    wall_usd = 10.0 * (WALL_K + 0.5) * 20.0
    flick_usd = 4.0 * (FLICK_K + 0.5) * 20.0

    g = book_heatmap.grid(srcs, "MAPAUSDT", 15, T0, T0 + 120 * MIN, "toda")
    c = cells(g)
    r_wall, r_flick = WALL_K - g["row0"], FLICK_K - g["row0"]
    check("ocho velas de 15m, filas de 20 USD", g["cols"] == 8 and g["step"] == 20.0 and g["rows"] > 0, str((g["cols"], g["step"])))
    got_wall = book_heatmap.decode(c[:, r_wall])
    check("toda: el muro fijo queda en su fila con su USD (un byte es 15.5% de paso)",
          all(abs(x / wall_usd - 1) < 0.08 for x in got_wall), str(got_wall[:3]))
    got_flick = book_heatmap.decode(c[:, r_flick])
    check("toda: lo que parpadea queda en la mitad (promedio de la vela)",
          all(abs(x / (flick_usd * 8 / 15) - 1) < 0.1 or abs(x / (flick_usd * 7 / 15) - 1) < 0.1 for x in got_flick), str(got_flick[:3]))
    others = np.delete(c, [r_wall, r_flick], axis=1)
    check("toda: los demas precios quedan vacios", int(others.max()) == 0)
    check("toda: cobertura completa en cada vela", g["coverage"] == [100] * 8, str(g["coverage"]))

    s = book_heatmap.grid(srcs, "MAPAUSDT", 15, T0, T0 + 120 * MIN, "sostenida", 30)
    cs = cells(s)
    check("sostenida 30: las dos primeras velas no tienen 30 minutos antes de su cierre: sin dato",
          int(cs[0].max()) == 0 and int(cs[1].max()) > 0, str(cs[:3, r_wall]))
    check("sostenida 30: el muro fijo sigue con su USD", all(abs(book_heatmap.decode(np.array([x]))[0] / wall_usd - 1) < 0.08
                                                          for x in cs[1:, r_wall]), str(cs[:, r_wall]))
    check("sostenida 30: lo que parpadea desaparece", int(cs[:, r_flick].max()) == 0, str(cs[:, r_flick]))

    # un minuto que falta (el 50): lo sostenido de las velas que lo incluyen queda sin dato
    write(base, "HUECOUSDT", minutes, skip={T0 + 50 * MIN})
    hs = cells(book_heatmap.grid(srcs, "HUECOUSDT", 15, T0, T0 + 120 * MIN, "sostenida", 30))
    ht = book_heatmap.grid(srcs, "HUECOUSDT", 15, T0, T0 + 120 * MIN, "toda")
    # vela 3 (45-59) y 4 (60-74) incluyen el minuto 50 en sus ultimos 30; la 5 (75-89) ya no
    check("un minuto que falta deja sin dato lo sostenido que lo incluye",
          int(hs[3].max()) == 0 and int(hs[4].max()) == 0 and int(hs[5].max()) > 0, str(hs[:, WALL_K - book_heatmap.grid(srcs, "HUECOUSDT", 15, T0, T0 + 120 * MIN, "toda")["row0"]]))
    check("y baja la cobertura de su vela (14 de 15 minutos)", ht["coverage"][3] == 93 and ht["coverage"][2] == 100, str(ht["coverage"]))

    # el paso y la primera fila pedidos se respetan
    e = book_heatmap.grid(srcs, "MAPAUSDT", 15, T0 + 90 * MIN, T0 + 120 * MIN, "toda", low=69_000.0, high=71_000.0, step=40.0)
    check("con paso y precios pedidos: filas de 40 USD desde 69,000", e["step"] == 40.0 and e["row0"] == 69_000 // 40
          and e["rows"] == 50 and e["cols"] == 2, str((e["step"], e["row0"], e["rows"], e["cols"])))
    ce = cells(e)
    check("en filas de 40 USD el muro cae en su fila", int(ce[:, int((WALL_K + 0.5) * 20 // 40) - e["row0"]].min()) > 0)

    # demasiadas velas: se quedan las mas recientes
    big = book_heatmap.grid(srcs, "MAPAUSDT", 1, T0 - 2000 * MIN, T0 + 120 * MIN, "toda")
    check("a lo sumo 1,500 velas: las mas recientes, y lo avisa", big["cols"] == 1500 and big["truncated"]
          and big["t0"] == T0 + 120 * MIN - 1500 * MIN, str((big["cols"], big["truncated"])))
    empty = book_heatmap.grid(srcs, "NADAUSDT", 15, T0, T0 + 120 * MIN, "toda")
    check("sin libro grabado: sin filas y sin cobertura", empty["rows"] == 0 and empty["last_ms"] is None and sum(empty["coverage"]) == 0)

    # la ruta
    from fastapi.testclient import TestClient  # noqa: E402
    import main  # noqa: E402
    with TestClient(main.app, base_url="http://127.0.0.1") as client:
        ok = client.get("/api/book/heatmap/MAPAUSDT", params={"interval": "15m", "from_ms": T0, "to_ms": T0 + 120 * MIN,
                                                              "mode": "sostenida", "minutes": 30}).json()
        check("la ruta responde el mapa", ok.get("success") and ok["cols"] == 8 and ok["sustain"] == 30, str(ok)[:200])
        bad = [client.get("/api/book/heatmap/MAPAUSDT", params=p).status_code for p in (
            {"interval": "7m", "from_ms": T0, "to_ms": T0 + MIN},
            {"interval": "15m", "from_ms": T0, "to_ms": T0 + MIN, "mode": "otra"},
            {"interval": "15m", "from_ms": T0, "to_ms": T0 + MIN, "mode": "sostenida", "minutes": 7},
            {"interval": "15m", "from_ms": T0 + MIN, "to_ms": T0},
            {"interval": "15m", "from_ms": T0, "to_ms": T0 + MIN, "low": 70_000},
            {"interval": "15m", "from_ms": T0, "to_ms": T0 + MIN, "low": 71_000, "high": 70_000})]
        check("la ruta rechaza marco, modo, minutos, horas y precios invalidos (400)", bad == [400] * 6, str(bad))
        check("y una moneda mal escrita (404)", client.get("/api/book/heatmap/BTC-USDT", params={"from_ms": T0, "to_ms": T0 + MIN}).status_code == 404)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok}/{len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
