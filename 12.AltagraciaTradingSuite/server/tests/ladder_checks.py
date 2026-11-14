# Pruebas sin conexion del price ladder (ladder.py, 14/11/2026), con un libro armado a mano.
# Uso, desde 12.AltagraciaTradingSuite/server:  python -B tests/ladder_checks.py
import sys
from collections import deque
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import book_recorder  # noqa: E402
import ladder  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def make_book():
    book = book_recorder.Book("TESTUSDT", 0.1)
    # compras de 99.0 a 99.9 (1 cada una, 5 en 99.5), ventas de 100.0 a 100.9 (2 cada una, 7 en 100.3)
    b = [[f"{99 + i / 10:.1f}", "5" if i == 5 else "1"] for i in range(10)]
    a = [[f"{100 + i / 10:.1f}", "7" if i == 3 else "2"] for i in range(10)]
    book.load_snapshot({"b": b, "a": a, "u": 1}, 1000)
    book.ready = True
    return book


book = make_book()
v = ladder.view(book, "TESTUSDT", mult=1, rows=24, now_ms=10_000, trades=deque(), hist=deque())
rows = {r[0]: r for r in v["rows"]}
check("filas de mayor a menor precio, una por tick", [r[0] for r in v["rows"]][:3] == sorted([r[0] for r in v["rows"]], reverse=True)[:3]
      and len(v["rows"]) == 24, str([r[0] for r in v["rows"]][:5]))
check("mejor compra y mejor venta", v["best_bid"] == 99.9 and v["best_ask"] == 100.0, f"{v['best_bid']} {v['best_ask']}")
check("cantidad en espera en su precio", rows[99.5][1] == 5 and rows[100.3][2] == 7 and rows[99.9][2] == 0,
      str((rows.get(99.5), rows.get(100.3))))
check("el centro es el precio medio", v["rows"][0][0] >= 100.9 and v["rows"][-1][0] <= 99.0, f"{v['rows'][0][0]} {v['rows'][-1][0]}")

# step de 5 ticks (0.5): se suman los niveles del cubo
v5 = ladder.view(book, "TESTUSDT", mult=5, rows=6, now_ms=10_000, trades=deque(), hist=deque())
r5 = {r[0]: r for r in v5["rows"]}
check("step x5 suma el cubo", r5[99.5][1] == 9 and r5[99.0][1] == 5 and r5[100.0][2] == 15 and r5[100.5][2] == 10,
      str(v5["rows"]))
check("step automatico ~0.01% del precio en ticks", ladder.auto_mult(67000, 0.1) == 50 and ladder.auto_mult(100, 0.1) == 1,
      str((ladder.auto_mult(67000, 0.1), ladder.auto_mult(100, 0.1))))

# lo negociado: solo la ventana, por lado, en su cubo
trades = deque()
ladder_now = 1_000_000
trades.extend([(ladder_now - 400_000, 100.0, 9.0, True),     # fuera de la ventana de 300 s
               (ladder_now - 100_000, 100.0, 2.0, True),
               (ladder_now - 50_000, 100.04, 1.5, True),      # cae en el precio 100.0 redondeado al tick
               (ladder_now - 10_000, 99.9, 3.0, False)])
vt = ladder.view(book, "TESTUSDT", mult=1, rows=24, now_ms=ladder_now, trades=trades, hist=deque(), window_s=300)
rt = {r[0]: r for r in vt["rows"]}
check("negociado: compra agresiva de la ventana, sin lo viejo", abs(rt[100.0][3] - 3.5) < 1e-9 and rt[100.0][4] == 0, str(rt[100.0]))
check("negociado: venta agresiva en su precio", rt[99.9][4] == 3.0 and rt[99.9][3] == 0, str(rt[99.9]))
check("ultimo precio negociado", vt["last"] == 99.9, str(vt["last"]))

# agregado y retirado: contra el libro de hace ~5 s
hist = deque()
first = ladder.view(book, "TESTUSDT", mult=1, rows=24, now_ms=20_000, trades=deque(), hist=hist)
check("sin libro de hace 5 s todavia no hay cambios", first["changes"] is False and first["rows"][0][5] is None)
book.apply({"b": [["99.5", "1"], ["99.7", "4"]], "a": [["100.3", "0"]], "u": 2}, 21_000)
ladder.view(book, "TESTUSDT", mult=1, rows=24, now_ms=22_000, trades=deque(), hist=hist)
later = ladder.view(book, "TESTUSDT", mult=1, rows=24, now_ms=25_500, trades=deque(), hist=hist)
rl = {r[0]: r for r in later["rows"]}
check("retirado en compra y en venta", later["changes"] and rl[99.5][5] == -4 and rl[100.3][6] == -7, str((rl[99.5], rl[100.3])))
check("agregado en compra", rl[99.7][5] == 3 and rl[99.6][5] == 0, str(rl[99.7]))
check("la historia no crece sin limite", len(hist) == 3 and all(25_500 - e[0] <= ladder.HIST_KEEP_MS for e in hist), str(len(hist)))

# un precio que no estaba en la vista de hace 5 s queda sin cambio (no se inventa lo agregado)
hist2 = deque()
ladder.view(book, "TESTUSDT", mult=1, rows=5, center=99.5, now_ms=40_000, trades=deque(), hist=hist2)
moved = ladder.view(book, "TESTUSDT", mult=1, rows=5, center=99.8, now_ms=46_000, trades=deque(), hist=hist2)
rm = {r[0]: r for r in moved["rows"]}
check("tras mover la vista: cambio solo donde se sabe", rm[100.0][6] is None and rm[99.7][5] == 0, str(moved["rows"]))

# centrado en otro precio
vc = ladder.view(book, "TESTUSDT", mult=1, rows=5, center=95.0, now_ms=30_000, trades=deque(), hist=deque())
check("centrado en el precio pedido", [r[0] for r in vc["rows"]] == [95.2, 95.1, 95.0, 94.9, 94.8], str([r[0] for r in vc["rows"]]))

# trades de Bybit: se guardan por moneda y se recortan
ladder._trades.clear()
ladder.add_trades("XUSDT", [{"T": 1, "p": "1.5", "v": "2", "S": "Buy"}, {"T": "x"}, {"T": ladder.TRADE_KEEP_MS + 10, "p": "1.6", "v": "1", "S": "Sell"}])
q = ladder._trades["XUSDT"]
check("add_trades guarda lo valido y recorta lo viejo", list(q) == [(ladder.TRADE_KEEP_MS + 10, 1.6, 1.0, False)], str(list(q)))

# cola de tus Limit: lo que espera y lo negociado en el precio exacto desde una hora
check("watch: lee precio:desde y descarta lo ilegible", ladder.parse_watch("99.5:1000,x,100.3:abc,99.9:2000") == [(99.5, 1000), (99.9, 2000)])
wb = make_book()
wt = deque([(500, 99.5, 9.0, False),     # antes de "desde": no cuenta
            (1500, 99.5, 2.0, False),    # venta agresiva contra las compras de 99.5
            (1600, 99.5, 0.5, True),
            (1700, 99.6, 3.0, False)])   # otro precio
w = ladder.watch(wb, "TESTUSDT", [(99.5, 1000), (100.3, 1000)], trades=wt)
check("watch: espera en el precio exacto y lo negociado desde esa hora", w[0]["bid"] == 5 and w[0]["sell"] == 2.0
      and w[0]["buy"] == 0.5 and w[1]["ask"] == 7 and w[1]["sell"] == 0, str(w))
check("watch: avisa si los trades guardados no llegan tan atras", w[0]["partial"] is False
      and ladder.watch(wb, "TESTUSDT", [(99.5, 400)], trades=wt)[0]["partial"] is True)

# cinta: los trades del mismo instante y lado son una orden; se muestran las grandes
od = deque()
for T, p_, v, b in [(1000, 100.0, 1.0, True), (1000, 100.1, 2.0, True), (1000, 100.2, 1.0, True),   # una compra que cruza 3 precios
                    (1000, 99.9, 0.5, False),                                                       # mismo instante, otro lado
                    (2000, 100.0, 0.1, True), (3000, 99.8, 0.2, False)]:
    ladder.add_order(od, T, p_, v, b)
check("cinta: mismo instante y lado es una orden", len(od) == 4 and od[0][2] == 4.0 and od[0][8] == 3
      and abs(od[0][3] - (100 + 200.2 + 100.2)) < 1e-9 and od[0][6] == 100.0 and od[0][7] == 100.2, str(list(od)))
tp = ladder.tape("X", min_usd=40, tick=0.1, orders=od, now_ms=3000)
check("cinta: solo las de USD sobre el minimo, la mas reciente primero", [o["usd"] for o in tp["orders"]] == [50, 400]
      and tp["orders"][0]["side"] == "sell"
      and tp["orders"][1]["levels"] == 3 and tp["orders"][1]["side"] == "buy", str(tp["orders"]))
check("cinta: compra y venta de los ultimos 30 s", tp["buy_30s"] == round(400.4 + 10) and tp["sell_30s"] == round(49.95 + 19.96),
      str((tp["buy_30s"], tp["sell_30s"])))
big = deque()
for k in range(200):
    ladder.add_order(big, k, 100.0, 10.0 if k == 150 else 1.0, k % 2 == 0)
auto = ladder.tape("X", tick=0.1, orders=big, now_ms=200)
check("cinta automatica: el percentil 99 de lo reciente deja solo las mas grandes", auto["auto"] and auto["min_usd"] is not None
      and [o["usd"] for o in auto["orders"]] == [1000], str(auto)[:200])
check("cinta sin trades: vacia", ladder.tape("NADA", orders=deque())["orders"] == [])

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok} de {len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
