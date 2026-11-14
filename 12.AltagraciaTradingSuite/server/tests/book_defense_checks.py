# Pruebas sin conexion de la defensa de zona (book_defense.py, 14/11/2026): zonas de los dibujos, visitas con la
# regla de book_study y el estado de las zonas cerca del precio, con un libro armado a mano.
# Uso, desde 12.AltagraciaTradingSuite/server:  python -B tests/book_defense_checks.py
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import book_defense  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


MIN = 60000
T0 = 1_794_000_000_000 - 1_794_000_000_000 % (15 * MIN)

# ---------- zonas de los dibujos ----------
shapes = [
    {"type": "horizontal", "id": "h1", "price": 1000.0},
    {"type": "rectangle", "id": "r1", "price1": 990.0, "price2": 995.0, "time1": T0 + 50 * MIN, "time2": T0},
    {"type": "rectangle", "id": "r2", "price1": 900.0, "price2": 1000.0, "time1": T0, "time2": T0 + MIN},   # 10%: no cuenta
    {"type": "rectangle", "id": "r3", "price1": 1001.0, "price2": 1001.1, "time1": T0, "time2": T0 + MIN},  # fino: como linea
    {"type": "tpsl", "id": "t1", "entryPrice": 1000.0},
    {"type": "horizontal", "id": "bad"},
]
zs = {z["id"]: z for z in book_defense.zones_from_drawings(shapes, T0, T0 + 300 * MIN)}
check("lineas y rectangulos; la caja TP/SL y lo ilegible no", sorted(zs) == ["h1", "r1", "r3"], str(sorted(zs)))
check("una linea es su precio +-0.05%", abs(zs["h1"]["lo"] - 999.5) < 1e-9 and abs(zs["h1"]["hi"] - 1000.5) < 1e-9, str(zs["h1"]))
check("un rectangulo vale desde su primera hora", zs["r1"]["from"] == T0 and zs["r1"]["lo"] == 990.0 and zs["r1"]["hi"] == 995.0)
check("un rectangulo muy fino se ensancha como una linea", zs["r3"]["hi"] - zs["r3"]["lo"] > 0.9, str(zs["r3"]))

# ---------- libro armado: 300 minutos ----------
# precio cerca de 1010 que se mueve 1008-1012 en cada vela de 15m (ATR ~4); en el minuto 240 baja a 1000.3, toca la
# compra de 1000 (50 por cubo) y vuelve a 1010. Tambien hay 30 de compra en 1005.
N, KMID = 40, 1005
heads, bids, asks, ts, bb, ba, blk, row = [], [], [], [], [], [], [], []
mins_t, mins_cols = [], []
for m in range(300):
    if m < 240 or m >= 250:
        base = 1010.0 + (2.0 if (m // 7) % 2 else -2.0)
    elif m < 245:
        base = 1010.0 - (m - 239) * 2.0          # 1008, 1006, ... 1000
    else:
        base = 1000.8 + (m - 245) * 2.5
    b = np.zeros((60, N), np.float32)
    b[:, KMID - 1000] = 50.0
    b[:, KMID - 1005] = 30.0
    a = np.zeros((60, N), np.float32)
    h = {"t": T0 + m * MIN, "step": 1, "tick": 1.0, "kmid": KMID, "n": N}
    heads.append(h)
    bids.append(b)
    asks.append(a)
    for s in range(60):
        px = base if m != 244 else (1000.3 if s >= 20 else 1002.0)
        ts.append(T0 + m * MIN + s * 1000)
        bb.append(px - 0.5)
        ba.append(px + 0.5)
        blk.append(m)
        row.append(s)
    mins_t.append(T0 + m * MIN)
    mins_cols.append((dict(h, gap=False), {"twa_b": b[0], "twa_a": a[0]}))
sec = {"heads": heads, "bids": bids, "asks": asks, "ts": np.array(ts, np.int64), "bb": np.array(bb), "ba": np.array(ba),
       "blk": np.array(blk), "row": np.array(row)}
mins = {"t": np.array(mins_t, np.int64), "cols": mins_cols}

zones = book_defense.zones_from_drawings([{"type": "horizontal", "id": "z1000", "price": 1000.0},
                                          {"type": "horizontal", "id": "z1005", "price": 1005.4},
                                          {"type": "horizontal", "id": "z960", "price": 960.0}], T0 + 220 * MIN, T0 + 300 * MIN)
res = book_defense.defense(sec, zones, None, mins)
v = [x for x in res["visits"] if x["id"] == "z1000"]
check("una visita a la compra de 1000: aguanto", len(v) == 1 and v[0]["side"] == "b" and v[0]["outcome"] == "aguanto", str(v))
check("defensa: la liquidez quedo entera al llegar", v and v[0]["pattern"] == "defensa" and v[0]["kept_pct"] == 100
      and v[0]["approach_usd"] == round(50 * 1000.5), str(v))
check("antiguedad de esa liquidez: todo lo grabado antes (hasta 4 h)", v and v[0]["aged_min"] == 240, str(v and v[0]["aged_min"]))
st = {x["id"]: x for x in res["status"]}
check("estado de la zona cerca del precio (1005.4, a 2 ATR o menos)", "z1005" in st and st["z1005"]["side"] == "b"
      and st["z1005"]["kept_pct"] == 100 and st["z1005"]["usd"] == round(30 * 1005.5), str(st))
check("la de 960, a mas de 2 ATR, sin estado; la de 1000 con su liquidez", "z960" not in st and st.get("z1000", {}).get("usd") == round(50 * 1000.5),
      str(st))
check("sin libro: nada", book_defense.defense(None, zones, None, mins) == {"zones": [], "visits": [], "status": []})

# ---------- la ruta ----------
import json  # noqa: E402
import tempfile  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="defense_checks_"))
(tmp / "XUSDT.json").write_text(json.dumps({"shapes": []}), encoding="utf-8")
app = FastAPI()
app.include_router(book_defense.make_router(tmp))
with TestClient(app) as client:
    empty = client.get("/api/book/defense/XUSDT", params={"from_ms": T0, "to_ms": T0 + MIN}).json()
    check("sin dibujos: lo dice y no lee el libro", empty.get("success") and empty["visits"] == [] and "sin lineas" in empty.get("note", ""),
          str(empty))
    bad = [client.get("/api/book/defense/XUSDT", params=p).status_code for p in ({"from_ms": 5, "to_ms": 1}, {})]
    check("rango invalido: 400", bad == [400, 400], str(bad))
    check("moneda invalida: 404", client.get("/api/book/defense/x-1", params={"from_ms": 1, "to_ms": 2}).status_code == 404)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok} de {len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
