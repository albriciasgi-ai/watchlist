# Pruebas sin conexion de los niveles de liquidez sostenida (book_levels.py, 14/11/2026), con minutos armados a mano.
# Uso, desde 12.AltagraciaTradingSuite/server:  python -B tests/book_levels_checks.py
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import book_levels  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


MIN = 60000
T0 = 1_794_000_000_000 - 1_794_000_000_000 % MIN
N = 50                    # cubos por lado; precio 1000, cubo de 1 USD


def make(walls, minutes=120, gaps=(), seed=3):
    """walls: (lado, precio, cantidad, desde, hasta) con hasta excluido."""
    rng = np.random.default_rng(seed)
    cols = []
    for m in range(minutes):
        b = rng.uniform(1, 3, N)
        a = rng.uniform(1, 3, N)
        for side, price, qty, s, e in walls:
            if s <= m < e:
                (b if side == "b" else a)[abs(price - 1000)] = qty
        h = {"t": T0 + m * MIN, "step": 1, "tick": 1.0, "n": N, "kmid": 1000, "mid": 1000.5, "gap": m in gaps}
        cols.append((h, {"twa_b": b.astype(np.float32), "twa_a": a.astype(np.float32)}))
    return cols


bars = {T0 + m * MIN: (1001.0, 1000.0, 1000.5) for m in range(120)}
bars[T0 + 80 * MIN] = (1005.5, 1000.0, 1004.0)    # sube hasta el muro de venta de 1005
bars[T0 + 100 * MIN] = (1001.0, 992.5, 999.0)     # baja hasta el muro de compra de 992, que sigue
walls = [("b", 990, 50, 10, 70),     # se va con el precio lejos: retirado
         ("a", 1005, 50, 20, 80),    # se va cuando el precio llega: consumido
         ("b", 995, 50, 40, 50),     # 10 minutos: no es sostenido
         ("b", 992, 40, 30, 120)]    # sigue al final, tocado una vez: activo
res = book_levels.levels(make(walls), bars, T0, T0 + 120 * MIN, 30)
by = {(lv["side"], lv["lo"]): lv for lv in res["levels"]}
check("solo los muros que duran 30 minutos, sin el ruido", sorted(by) == [("a", 1005.0), ("b", 990.0), ("b", 992.0)], str(sorted(by)))
w1 = by.get(("b", 990.0), {})
check("retirado: el precio no llego; dice a que distancia del borde del nivel (1000.5 a 991)", w1.get("reason") == "retirado" and abs(w1.get("dist_pct", 0) - 0.95) < 0.01,
      str(w1))
check("su principio, cuando se supo y su final", w1.get("start") == T0 + 10 * MIN and w1.get("known") == T0 + 40 * MIN
      and w1.get("end") == T0 + 70 * MIN and w1.get("minutes") == 60, str(w1))
check("USD promedio del nivel", abs(w1.get("usd", 0) - 50 * 990.5) < 1, str(w1.get("usd")))
w2 = by.get(("a", 1005.0), {})
check("consumido: se fue cuando el precio llego", w2.get("reason") == "consumido" and w2.get("dist_pct") is None, str(w2))
w4 = by.get(("b", 992.0), {})
check("activo al final, con el toque en que siguio", w4.get("reason") == "activo" and w4.get("end") is None and w4.get("touches") == 1,
      str(w4))
check("con 15 minutos no aparece el de 10", all(lv["lo"] != 995.0 for lv in book_levels.levels(make(walls), bars, T0, T0 + 120 * MIN, 15)["levels"]))

# un minuto suelto sin grabar (una reconexion) no corta el nivel
g1 = book_levels.levels(make(walls, gaps=(50,)), bars, T0, T0 + 120 * MIN, 30)
w1s = [lv for lv in g1["levels"] if lv["side"] == "b" and lv["lo"] == 990.0]
check("un minuto sin grabar no corta el nivel", len(w1s) == 1 and w1s[0]["reason"] == "retirado" and w1s[0]["minutes"] == 60, str(w1s))
# mas de 5 minutos seguidos sin grabar: termina "sin dato" donde empezo el hueco
g = book_levels.levels(make(walls, gaps=tuple(range(50, 57))), bars, T0, T0 + 120 * MIN, 30)
gb = {(lv["side"], lv["lo"], lv["start"]): lv for lv in g["levels"]}
w1g = gb.get(("b", 990.0, T0 + 10 * MIN), {})
check("hueco largo: el nivel termina 'sin dato' al empezar el hueco", w1g.get("reason") == "sin_dato" and w1g.get("end") == T0 + 50 * MIN, str(w1g))

# sin velas de 1 minuto no se sabe como termino
nb = book_levels.levels(make(walls), {}, T0, T0 + 120 * MIN, 30)
check("sin velas: 'sin precio' en vez de inventar", {lv["reason"] for lv in nb["levels"]} == {"sin_precio", "activo"},
      str({lv["reason"] for lv in nb["levels"]}))

# solo lo que toca el rango pedido
late = book_levels.levels(make(walls), bars, T0 + 75 * MIN, T0 + 120 * MIN, 30)
check("solo los niveles que tocan el rango pedido", sorted((lv["side"], lv["lo"]) for lv in late["levels"]) == [("a", 1005.0), ("b", 992.0)],
      str([(lv["side"], lv["lo"]) for lv in late["levels"]]))

# retiro cerca: con el precio a media ATR o menos. ATR de 15m con las velas de 1 minuto: cada minuto va de 1000 a
# 1003, ATR 3; la compra de 998-999 queda a 1.5 USD del cierre (1000.5) y se va sin que el precio llegue
near_bars = {T0 + m * MIN: (1003.0, 1000.0, 1000.5) for m in range(300)}
nr = book_levels.levels(make([("b", 998, 50, 220, 280)], minutes=300), near_bars, T0, T0 + 300 * MIN, 30)
nl = [lv for lv in nr["levels"] if lv["lo"] == 998.0]
check("retiro cerca: a media ATR o menos del precio", len(nl) == 1 and nl[0]["reason"] == "retirado" and nl[0]["near"]
      and nl[0]["dist_atr"] == 0.5, str(nl))
far = book_levels.levels(make([("b", 990, 50, 220, 280)], minutes=300), near_bars, T0, T0 + 300 * MIN, 30)
fl = [lv for lv in far["levels"] if lv["lo"] == 990.0]
check("a 9.5 USD (3 ATR) es retiro lejos", len(fl) == 1 and fl[0]["near"] is False and fl[0]["dist_atr"] > 3, str(fl))
check("sin ATR (menos de 14 velas de 15m) decide el 0.3%: 0.95% es lejos", w1.get("near") is False and w1.get("dist_atr") is None, str(w1))
check("sin velas nada es retiro cerca", all(not lv["near"] for lv in nb["levels"]))

# libro parejo: nada es grande
flat = book_levels.levels(make([]), bars, T0, T0 + 120 * MIN, 15)
check("un libro parejo no da niveles", flat["levels"] == [], str(len(flat["levels"])))

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok} de {len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
