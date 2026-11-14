# Pruebas sin conexion de la absorcion (AB) y el barrido del libro (BL) como Elementos OF (book_events.py, 14/11/2026),
# con minutos del libro y trades armados a mano.
# Uso, desde 12.AltagraciaTradingSuite/server:  python -B tests/book_events_checks.py
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import book_events  # noqa: E402
import book_store  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


MIN = 60000
FRAME = 5
T0 = 1_794_000_000_000 - 1_794_000_000_000 % (FRAME * MIN)
N, KMID = 40, 1005
CANDLES = 30


class FakeTrades:
    """Trades por dia como los da book_study.Trades._day: (t ms, precio, cantidad, lado, rpi). Lado -1 = venta agresiva."""
    def __init__(self, rows):
        rows = sorted(rows)
        self.data = (np.array([r[0] for r in rows], np.int64), np.array([r[1] for r in rows]), np.array([r[2] for r in rows]),
                     np.array([r[3] for r in rows]), np.zeros(len(rows)))
        self.days = {}

    def _day(self, day):
        return self.data


def book(rest_last_candle=10.0, mid_last=1002.5):
    """Compra de 10 en 1000 todo el tiempo; en la ultima vela termina en rest_last_candle. Precio medio 1002.5."""
    cols = []
    for m in range(CANDLES * FRAME):
        b = np.zeros(N, np.float32)
        a = np.zeros(N, np.float32)
        last_candle = m >= (CANDLES - 1) * FRAME
        b[KMID - 1000] = rest_last_candle if (last_candle and m == CANDLES * FRAME - 1) else 10.0
        h = {"t": T0 + m * MIN, "step": 1, "tick": 1.0, "kmid": KMID, "n": N, "mid": mid_last if last_candle else 1002.5,
             "gap": False}
        cols.append((h, {"twa_b": b, "twa_a": a}))
    return cols


def trades(big=50.0):
    rows = []
    for c in range(CANDLES):
        t = T0 + c * FRAME * MIN + 30000
        rows.append((t, 1000.5, big if c == CANDLES - 1 else 1.0 + 0.1 * c, -1))   # venta agresiva contra la compra de 1000
    return FakeTrades(rows)


end = T0 + CANDLES * FRAME * MIN
start = end - FRAME * MIN
ev = book_events.absorption(book(), trades(), FRAME, start, end, end)
check("absorcion: se vendio 5 veces lo que esperaba, se quedo y el precio no paso", len(ev) == 1 and ev[0]["code"] == "AB"
      and ev[0]["dir"] == 1 and ev[0]["lo"] == 1000.0 and ev[0]["hi"] == 1001.0, str(ev))
check("con lo negociado, el umbral y lo que esperaba", ev and ev[0]["value"] == round(50 * 1000.5)
      and ev[0]["rest"] == round(10 * 1000.5) and ev[0]["thr"] < ev[0]["value"], str(ev))
check("se conoce al cerrar la vela", ev and ev[0]["t"] == start and ev[0]["known"] == end, str(ev))
check("sin cerrar la vela no hay nada", book_events.absorption(book(), trades(), FRAME, start, end, end - MIN) == [])
check("si la compra se fue (no se repuso) no es absorcion",
      book_events.absorption(book(rest_last_candle=2.0), trades(), FRAME, start, end, end) == [])
check("si el precio cerro por debajo no es absorcion",
      book_events.absorption(book(mid_last=999.0), trades(), FRAME, start, end, end) == [])
check("si se negocio poco (menos del doble de lo que esperaba) no es absorcion",
      book_events.absorption(book(), trades(big=15.0), FRAME, start, end, end) == [])
check("sin velas anteriores para el umbral no marca", book_events.absorption(book()[-10 * FRAME:], trades(), FRAME, start, end, end) == [])
check("sin trades no marca", book_events.absorption(book(), None, FRAME, start, end, end) == [])

# barrido: un nivel sostenido que el precio consume
cols = []
for m in range(120):
    b = np.random.default_rng(m).uniform(1, 3, N).astype(np.float32)
    a = np.random.default_rng(1000 + m).uniform(1, 3, N).astype(np.float32)
    if 10 <= m < 80:
        b[KMID - 995] = 50.0
    cols.append(({"t": T0 + m * MIN, "step": 1, "tick": 1.0, "kmid": KMID, "n": N, "mid": 1005.5, "gap": False},
                 {"twa_b": b, "twa_a": a}))
bars = {T0 + m * MIN: (1006.0, 1005.0, 1005.5) for m in range(120)}
bars[T0 + 80 * MIN] = (1006.0, 994.0, 996.0)     # el precio baja hasta la compra de 995 y se la come
sw = book_events.sweeps(cols, bars, FRAME, T0, T0 + 120 * MIN, T0 + 120 * MIN)
check("barrido: el nivel sostenido consumido, bajista, en la vela en que se fue", len(sw) == 1 and sw[0]["code"] == "BL"
      and sw[0]["dir"] == -1 and sw[0]["t"] == T0 + 80 * MIN and sw[0]["lo"] == 995.0, str(sw))
check("el barrido se conoce al cerrar su vela", book_events.sweeps(cols, bars, FRAME, T0, T0 + 120 * MIN, T0 + 82 * MIN) == [])

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok} de {len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
