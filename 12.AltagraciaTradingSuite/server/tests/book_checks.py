# Pruebas sin conexion de la grabacion del libro completo (book_recorder.py y book_store.py, 13/11/2026):
#   - los cubos y el mejor precio siguen exactos con miles de cambios al azar;
#   - un salto de u pide otra foto, y la foto se une con los cambios guardados mientras llegaba;
#   - cada segundo y cada minuto se toman con la hora de Bybit, iguales a recalcularlos desde cero;
#   - lo escrito se lee igual, y un bloque a medio escribir no rompe la lectura;
#   - las rutas responden sin grabar.
# Bybit nunca se consulta. Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\book_checks.py
import asyncio
import json
import os
import random
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_book_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_ORDERFLOW_DATA"] = str(TMP / "of")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
import book_recorder  # noqa: E402
import book_store  # noqa: E402
from book_recorder import Book, BookRecorder, nice_ticks  # noqa: E402

results = []
MIN = 60_000


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def snapshot(mid=69000.0, tick=0.1, levels=400, u=100, seed=1):
    rnd = random.Random(seed)
    b, a = [], []
    for i in range(levels):
        if rnd.random() < 0.6:
            b.append([f"{mid - tick * (i + 1):.1f}", f"{rnd.uniform(0.001, 5):.3f}"])
        if rnd.random() < 0.6:
            a.append([f"{mid + tick * i:.1f}", f"{rnd.uniform(0.001, 5):.3f}"])
    return {"s": "BTCUSDT", "b": b, "a": a, "u": u, "ts": 1_800_000_000_000}


def brute(book: Book, side: str, step: int):
    levels = book.bids if side == "b" else book.asks
    out = {}
    for t, q in levels.items():
        out[t // step] = out.get(t // step, 0.0) + q
    return out


def same_sums(a: dict, b: dict) -> bool:
    keys = set(a) | set(b)
    return all(abs(a.get(k, 0.0) - b.get(k, 0.0)) < 1e-6 for k in keys)


def random_delta(book: Book, rnd: random.Random, u: int, tick=0.1, n=30):
    mid = book.mid_ticks()
    bids, asks = [], []
    for _ in range(n):
        if rnd.random() < 0.5:
            t = int(mid - rnd.randint(1, 600))
            q = 0 if rnd.random() < 0.35 else round(rnd.uniform(0.001, 8), 3)
            bids.append([f"{t * tick:.1f}", f"{q}"])
        else:
            t = int(mid + rnd.randint(0, 600))
            q = 0 if rnd.random() < 0.35 else round(rnd.uniform(0.001, 8), 3)
            asks.append([f"{t * tick:.1f}", f"{q}"])
    # a veces se lleva el mejor precio, para probar que se busca el siguiente
    if book.best_b is not None and rnd.random() < 0.3:
        bids.append([f"{book.best_b * tick:.1f}", "0"])
    if book.best_a is not None and rnd.random() < 0.3:
        asks.append([f"{book.best_a * tick:.1f}", "0"])
    # quita los cruces: una compra no puede quedar sobre la mejor venta
    return {"s": "BTCUSDT", "b": bids, "a": asks, "u": u}


try:
    # ---------- cubos ----------
    check("cubos de BTC: 5 USD fino y 20 USD grueso", (nice_ticks(69000 * 0.0001 / 0.1), nice_ticks(69000 * 0.0003 / 0.1)) == (50, 200))
    check("cubos de ETH: 0.2 fino y 0.5 grueso", (nice_ticks(1940 * 0.0001 / 0.01), nice_ticks(1940 * 0.0003 / 0.01)) == (20, 50))
    check("con tick grande (SOL, XRP) el fino es un tick", nice_ticks(80 * 0.0001 / 0.01) == 1 and nice_ticks(1.025 * 0.0001 / 0.0001) == 1)
    check("los cubos son enteros en ticks", all(isinstance(nice_ticks(r), int) for r in (0.3, 1, 3, 7.5, 33, 250, 4100)))

    # ---------- libro con cambios al azar ----------
    book = Book("BTCUSDT", 0.1)
    book.load_snapshot(snapshot(), 1_800_000_000_000)
    rnd = random.Random(7)
    ok_sums = ok_best = True
    for k in range(2500):
        delta = random_delta(book, rnd, book.u + 1)
        book.apply(delta, 1_800_000_000_000 + k * 200)
        # el libro de prueba puede cruzarse; los mejores precios se comparan igual con el libro tal cual
        if k % 50 == 0:
            ok_sums &= same_sums(book.fb, brute(book, "b", book.fine)) and same_sums(book.ca, brute(book, "a", book.coarse))
        exp_b = max(book.bids) if book.bids else None
        exp_a = min(book.asks) if book.asks else None
        ok_best &= book.best_b == exp_b and book.best_a == exp_a
    check("las sumas por cubo siguen exactas tras 2,500 cambios", ok_sums)
    check("el mejor precio sigue exacto, tambien al quitarse el mejor", ok_best)

    # ---------- salto de u y resincronizacion ----------
    book = Book("BTCUSDT", 0.1)
    book.syncing = True
    book.on_delta(1, {"b": [["68990.0", "1"]], "a": [], "u": 105})
    book.on_delta(2, {"b": [["68991.0", "2"]], "a": [], "u": 106})
    check("mientras llega la foto los cambios se guardan", len(book.buffer) == 2 and not book.ready)
    old = snapshot(u=100)
    check("una foto anterior a lo guardado se rechaza (faltan cambios)", book.finish_sync(old, 0) is False and not book.ready)
    snap = snapshot(u=104)
    check("una foto que empalma se aplica con los cambios guardados", book.finish_sync(snap, 0) and book.ready and book.u == 106)
    check("los cambios guardados quedaron en el libro", book.bids.get(689910) == 2.0 and book.bids.get(689900) == 1.0)
    check("un cambio viejo (u repetido) no cambia nada", book.on_delta(3, {"b": [["68991.0", "9"]], "a": [], "u": 106}) is None
          and book.bids.get(689910) == 2.0)
    res = book.on_delta(4, {"b": [], "a": [], "u": 109})
    check("un salto de u pide otra foto y deja el libro sin tomar", res == "resync" and not book.ready and book.syncing and len(book.buffer) == 1)
    snap2 = snapshot(u=108, seed=2)
    check("tras el salto, una foto que empalma vuelve a dejarlo listo", book.finish_sync(snap2, 5) and book.ready and book.u == 109)
    newer = snapshot(u=130, seed=3)
    b3 = Book("BTCUSDT", 0.1)
    b3.syncing = True
    b3.on_delta(1, {"b": [], "a": [], "u": 120})
    check("una foto mas nueva que lo guardado se aplica y descarta lo viejo", b3.finish_sync(newer, 9) and b3.u == 130)
    check("despues siguen los cambios de la foto en adelante",
          b3.on_delta(10, {"b": [], "a": [], "u": 125}) is None and b3.on_delta(11, {"b": [], "a": [], "u": 131}) is None and b3.u == 131)

    # ---------- segundos y minutos con la hora de Bybit ----------
    T0 = 1_800_000_000_000 - (1_800_000_000_000 % MIN)  # empieza un minuto
    book = Book("BTCUSDT", 0.1)
    book.syncing = True
    snap = snapshot(u=500, seed=4)
    book.finish_sync(snap, T0 - 5_000)
    check("al quedar listo se espera el minuto siguiente", book.next_sample == T0)
    rnd = random.Random(11)
    timeline = []  # (ts, copia de los cubos gruesos de compra y venta despues del cambio)
    expected_rows = {}
    u = 500
    ts = T0 - 4_000
    # estado al empezar el minuto: lo que haya antes del primer cambio en T0 o despues
    while ts < T0 + 2 * MIN + 500:
        nxt = ts + rnd.choice((100, 200, 200, 300, 700))
        # antes de aplicar el cambio de nxt, las tomas pendientes ven el libro de ahora
        for s in range((ts // 1000 + 1) * 1000, nxt + 1, 1000):
            if T0 <= s < T0 + 2 * MIN:
                expected_rows[s] = (dict(book.fb), dict(book.fa))
        u += 1
        ts = nxt
        book.on_delta(ts, random_delta(book, rnd, u, n=12))
        timeline.append((ts, dict(book.cb), dict(book.ca)))
    book.advance(T0 + 2 * MIN)  # cierra el segundo minuto
    out = book.take_output()
    check("dos minutos dan dos bloques de segundos y dos de minuto", sorted(p.rsplit(".", 1)[1] for p, _ in out) == ["bkm", "bkm", "bks", "bks"])
    rows_ok, n_rows = True, 0
    for rel, data in out:
        if not rel.endswith(".bks"):
            continue
        mag, ver, minute, length = book_store.PREFIX.unpack(data[:book_store.PREFIX.size])
        header, arr = book_store.decode_payload(data[book_store.PREFIX.size:])
        bids, asks = book_store.split_seconds(header, arr)
        for r, s in enumerate(header["ts"]):
            fb, fa = expected_rows[s]
            exp_b = [fb.get(header["kmid"] - i, 0.0) for i in range(header["n"])]
            exp_a = [fa.get(header["kmid"] + i, 0.0) for i in range(header["n"])]
            rows_ok &= np.allclose(bids[r], exp_b, atol=1e-5) and np.allclose(asks[r], exp_a, atol=1e-5)
            n_rows += 1
    check("cada segundo es el libro de ese instante (120 tomas)", rows_ok and n_rows == 120, f"{n_rows} tomas")

    # el minuto: ponderado por tiempo y minimo, contra la linea de tiempo
    def expected_column(minute, header, side):
        start, end = minute, minute + MIN
        state = None
        for ts_, cb, ca in timeline:
            if ts_ < start:
                state = (cb, ca)
        idx = 0 if side == "b" else 1
        k0, n = header["kmid"], header["n"]
        ks = [k0 - i if side == "b" else k0 + i for i in range(n)]
        cur = {k: state[idx].get(k, 0.0) for k in ks}
        integral = {k: 0.0 for k in ks}
        low = dict(cur)
        last = start
        for ts_, cb, ca in timeline:
            if not (start <= ts_ < end):
                continue
            for k in ks:
                integral[k] += cur[k] * (ts_ - last)
            last = ts_
            src = cb if side == "b" else ca
            for k in ks:
                cur[k] = src.get(k, 0.0)
                low[k] = min(low[k], cur[k])
        for k in ks:
            integral[k] += cur[k] * (end - last)
        return np.array([integral[k] / MIN for k in ks]), np.array([low[k] for k in ks])

    cols_ok = True
    for rel, data in out:
        if not rel.endswith(".bkm"):
            continue
        header, arr = book_store.decode_payload(data[book_store.PREFIX.size:])
        parts = book_store.split_minute(header, arr)
        for side in ("b", "a"):
            twa, low = expected_column(header["t"], header, side)
            cols_ok &= np.allclose(parts[f"twa_{side}"], twa, rtol=1e-5, atol=1e-5) and np.allclose(parts[f"min_{side}"], low, atol=1e-5)
        cols_ok &= header["cov"] == MIN and header["samples"] == 60
    check("cada minuto: profundidad ponderada por tiempo y minima exactas", cols_ok)

    # ---------- perdida de conexion a mitad de minuto ----------
    book.on_delta(T0 + 2 * MIN + 30_000, {"b": [], "a": [], "u": u + 1})
    book.lose(T0 + 2 * MIN + 30_500, "conexion perdida")
    out2 = book.take_output()
    heads = [book_store.decode_payload(d[book_store.PREFIX.size:])[0] for _, d in out2]
    check("un corte a mitad de minuto deja ese minuto marcado e incompleto",
          len(heads) == 2 and all(h["gap"] for h in heads) and all(0 < h["cov"] < MIN for h in heads))
    check("tras el corte no se toma nada hasta la proxima foto", not book.ready and book.next_sample is None)

    # ---------- escritura y lectura ----------
    async def recorder_roundtrip():
        class FakeResponse:
            def __init__(self, body):
                self.content = json.dumps(body).encode()

            def json(self):
                return json.loads(self.content)

        class FakeHttp:
            def __init__(self):
                self.asked = []

            async def get(self, url, params=None, timeout=None):
                self.asked.append((url, params))
                if url.endswith("instruments-info"):
                    return FakeResponse({"retCode": 0, "result": {"list": [{"symbol": "BTCUSDT", "priceFilter": {"tickSize": "0.1"}}]}})
                return FakeResponse({"retCode": 0, "result": snapshot(u=700, seed=5)})

        http = FakeHttp()
        rec = BookRecorder(["BTCUSDT"], TMP / "of", "https://bybit.invalid", http)
        await rec._load_ticks()
        bk = rec.books["BTCUSDT"]
        bk.syncing = True
        start = T0 + 10 * MIN - 3_000
        for i in range(3):
            rec._on_message(json.dumps({"topic": "orderbook.full.BTCUSDT", "type": "delta", "ts": start + i * 200,
                                        "data": {"s": "BTCUSDT", "b": [], "a": [], "u": 701 + i}}), start + i * 200 - 2000)
        await rec._sync("BTCUSDT", 0)
        ready = bk.ready and bk.u == 703 and bk.tick == 0.1
        rnd2 = random.Random(3)
        u2, ts2 = 703, start + 600
        while ts2 < T0 + 13 * MIN + 200:
            u2 += 1
            ts2 += 200
            rec._on_message(json.dumps({"topic": "orderbook.full.BTCUSDT", "type": "delta", "ts": ts2,
                                        "data": random_delta(bk, rnd2, u2, n=10)}), ts2 - 2000)
        rec._write_all()
        return rec, ready, http

    rec, ready, http = asyncio.run(recorder_roundtrip())
    check("el grabador toma el tick de Bybit y empalma la foto con los cambios", ready)
    check("la foto se pide a full_orderbook de la moneda",
          any(u.endswith("/v5/market/full_orderbook") and p == {"category": "linear", "symbol": "BTCUSDT"} for u, p in http.asked))
    check("reloj de Bybit: diferencia con el PC medida", rec.offset == 2000)
    base = book_store.root(TMP / "of")
    secs = book_store.second_rows(base, "BTCUSDT", T0 + 10 * MIN, T0 + 13 * MIN)
    cols = book_store.minute_columns(base, "BTCUSDT", T0 + 10 * MIN, T0 + 13 * MIN)
    check("se leen los tres minutos completos de segundos y de minuto",
          [h["t"] for h, _, _ in secs] == [T0 + 10 * MIN, T0 + 11 * MIN, T0 + 12 * MIN] and len(cols) == 3
          and all(len(h["ts"]) == 60 for h, _, _ in secs))
    check("las horas de cada toma son los segundos exactos de Bybit",
          all(h["ts"] == list(range(h["t"], h["t"] + MIN, 1000)) for h, _, _ in secs))
    day = book_store.day_of(T0 + 10 * MIN)
    path = book_store.day_path(base, "BTCUSDT", day, "bks")
    size = path.stat().st_size
    with open(path, "ab") as fh:  # un bloque a medio escribir al final (corte de luz)
        fh.write(book_store.PREFIX.pack(b"BK", 1, T0 + 13 * MIN, 5000) + b"x" * 100)
    book_store._index.clear()
    secs2 = book_store.second_rows(base, "BTCUSDT", T0 + 10 * MIN, T0 + 14 * MIN)
    check("un bloque cortado al final se ignora y lo anterior se lee", len(secs2) == 3 and path.stat().st_size > size)
    h0, b0, a0 = secs[0]
    check("las filas leidas son iguales a las escritas (XOR sin perdida)", np.array_equal(b0, secs2[0][1]) and np.array_equal(a0, secs2[0][2]))

    # ---------- la foto espera un cambio y unos segundos; una foto vieja se anota y se pide otra ----------
    async def snapshot_timing():
        class FakeResponse:
            def __init__(self, body):
                self.content = json.dumps(body).encode()

            def json(self):
                return json.loads(self.content)

        class SlowHttp:
            def __init__(self, answers):
                self.answers, self.times = answers, []

            async def get(self, url, params=None, timeout=None):
                self.times.append(__import__("time").time())
                return FakeResponse({"retCode": 0, "result": self.answers.pop(0)})

        old_wait = book_recorder.SNAPSHOT_WAIT
        book_recorder.SNAPSHOT_WAIT = 0.4
        try:
            # 1) espera el primer cambio y SNAPSHOT_WAIT antes de pedir la foto
            http = SlowHttp([snapshot(u=900, seed=8)])
            rec = BookRecorder(["BTCUSDT"], TMP / "espera", "https://bybit.invalid", http)
            bk = rec.books["BTCUSDT"]
            bk.tick = 0.1
            bk.begin_sync()
            started = bk.sync_since

            async def feed():
                await asyncio.sleep(0.15)
                rec._on_message(json.dumps({"topic": "orderbook.full.BTCUSDT", "type": "delta", "ts": T0,
                                            "data": {"s": "BTCUSDT", "b": [], "a": [], "u": 899}}), T0)

            await asyncio.gather(rec._sync("BTCUSDT", 0), feed())
            waited = http.times[0] - started
            first = bk.ready and waited >= 0.39 and bk.stats["sync_attempts"] == 1 and bk.stats["last_sync_seconds"] is not None
            # 2) una foto anterior al primer cambio guardado se rechaza con su nota y se pide otra
            http2 = SlowHttp([snapshot(u=950, seed=9), snapshot(u=1000, seed=9)])
            rec2 = BookRecorder(["BTCUSDT"], TMP / "espera2", "https://bybit.invalid", http2)
            b2 = rec2.books["BTCUSDT"]
            b2.tick = 0.1
            b2.begin_sync()
            for u in (990, 991, 992):
                rec2._on_message(json.dumps({"topic": "orderbook.full.BTCUSDT", "type": "delta", "ts": T0 + u,
                                             "data": {"s": "BTCUSDT", "b": [], "a": [], "u": u}}), T0)
            await rec2._sync("BTCUSDT", 0)
            second = b2.ready and len(http2.times) == 2 and b2.stats["sync_attempts"] == 2 and b2.u == 1000
            return first, waited, second, b2.stats
        finally:
            book_recorder.SNAPSHOT_WAIT = old_wait

    first, waited, second, st2 = asyncio.run(snapshot_timing())
    check("la foto se pide tras el primer cambio y unos segundos (nunca antes)", first, f"espero {waited:.2f} s")
    check("una foto anterior a lo guardado se rechaza y la siguiente empalma", second, str(st2))

    # ---------- zonas ----------
    head = {"kmid": 1000, "n": 10, "step": 50, "tick": 0.1}
    row = np.arange(10, dtype=np.float32)
    qty, usd = book_store.zone_depth(head, row, "b", 4950 - 1e-9, 5000)  # cubos 990..999 de 5 USD: centros 4952.5...4997.5
    check("zona de compras: suma los cubos cuyo centro cae dentro", abs(qty - sum(range(10))) < 1e-6 and usd > 0)
    qty2, _ = book_store.zone_depth(head, row, "a", 5000, 5010)  # ventas: cubos 1000 y 1001, centros 5002.5 y 5007.5
    check("zona de ventas: cubos del lado de arriba", abs(qty2 - (0 + 1)) < 1e-6)
    check("una zona fuera del bloque no se da por cubierta", not book_store.covers(head, "b", 4900, 5000)
          and book_store.covers(head, "b", 4955, 4995))

    # ---------- medidas del libro para el journal, con libros armados a mano ----------
    import book_measures  # noqa: E402
    mbase = TMP / "medidas" / "live" / "book"
    tick, cstep, fstep, kmid_c, nc = 0.1, 200, 50, 690000 // 200, 173
    decide = T0 + 1500 * MIN + 30_000          # a mitad de un minuto: cuentan los minutos cerrados antes
    last_closed = decide - decide % MIN
    entry, stop = 68500.0, 67900.0             # long: compra en 68500, stop en 67900
    center = (kmid_c - np.arange(nc) + 0.5) * cstep * tick   # centro de cada cubo de compra
    in_zone = np.abs(center - entry) <= entry * 0.0005
    below_zone = (center >= stop) & (center < 68300)          # lejos de los cubos con que se compara la entrada
    band = (center >= stop) & (center <= entry)

    def write_minutes(sym, minutes, make):
        raw = {}
        for m in minutes:
            twa_b, twa_a, min_b, min_a = make(m)
            head = {"v": 1, "s": sym, "t": m, "tick": tick, "step": cstep, "kmid": kmid_c, "n": nc, "cov": MIN,
                    "gap": False, "samples": 60, "mid": 69000.0}
            raw.setdefault(book_store.day_path(mbase, sym, book_store.day_of(m), "bkm"), []).append(
                book_store.minute_block(m, head, np.float32(twa_b), np.float32(twa_a), np.float32(min_b), np.float32(min_a)))
        for path, items in raw.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            with open(path, "ab") as fh:
                fh.write(b"".join(items))
        book_store._index.clear()

    day_minutes = range(last_closed - 1440 * MIN, last_closed, MIN)
    ones = np.ones(nc)
    # 1) cerca del precio: el doble de lo habitual en los ultimos 5 minutos, con mas compras que ventas
    write_minutes("PCTUSDT", day_minutes, lambda m: ((2 if m >= last_closed - 5 * MIN else 1) * ones, ones, ones, ones))
    trade = {"symbol": "PCTUSDT", "side": "Buy", "entry": entry, "initial_stop_loss": stop, "opened_at": decide,
             "decision": {"at": decide}}
    got = book_measures.compute(trade, mbase, lambda *a: None)
    check("libro: la liquidez a +-0.5% de los 5 min previos sale del libro", bool(got["book_depth05"]) and got["book_depth05"] > 0)
    check("libro: el doble de lo habitual queda en el percentil 100", got["book_depth05_pct"] == 100.0, str(got["book_depth05_pct"]))
    check("libro: mas compras que ventas es desequilibrio a favor de un long",
          got["book_imbalance05"] is not None and got["book_imbalance05"] > 0)
    short = book_measures.compute({**trade, "side": "Sell"}, mbase, lambda *a: None)
    check("libro: el desequilibrio se ve desde el lado del trade (en un short, al reves)",
          short["book_imbalance05"] == -got["book_imbalance05"])

    # 2) tu entrada: el doble de lo tipico y nunca bajo de la mitad; la compra lejos bajo tu entrada se va a la mitad
    def zone_book(m):
        twa_b = np.where(in_zone, 2.0, 1.0)
        if m > last_closed - 10 * MIN:  # los 9 minutos antes de decidir
            twa_b = np.where(below_zone, 0.5, twa_b)
        return twa_b, ones, twa_b * 0.5, ones

    write_minutes("ZONAUSDT", day_minutes, zone_book)
    gz = book_measures.compute({**trade, "symbol": "ZONAUSDT"}, mbase, lambda *a: None)
    check("libro: liquidez en espera en tu entrada medida", bool(gz["book_entry_usd"]) and gz["book_entry_usd"] > 0)
    check("libro: tu entrada con el doble de lo tipico a esa distancia", gz["book_entry_rel"] == 2.0, str(gz["book_entry_rel"]))
    check("libro: persistencia = minimo / promedio (0.5)", gz["book_entry_hold"] == 0.5, str(gz["book_entry_hold"]))
    usd_before = float((np.where(in_zone, 2.0, 1.0) * center)[band].sum())
    usd_now = float((np.where(in_zone, 2.0, np.where(below_zone, 0.5, 1.0)) * center)[band].sum())
    expected = round(100 * (usd_now - usd_before) / usd_before, 1)
    check("libro: cambio de la compra entre tu entrada y tu stop en 10 min", gz["book_protect_chg"] == expected,
          f"{gz['book_protect_chg']} contra {expected}")

    # 3) el llenado: de 4 a 1 en tu entrada en los ultimos 30 s, y se negocio el doble de lo que habia
    fill = decide + 20 * MIN + 45_000
    kmid_f, nf = 685000 // fstep + 60, 111
    fcenter = (kmid_f - np.arange(nf) + 0.5) * fstep * tick
    fzone = np.abs(fcenter - entry) <= entry * 0.0005
    raw = {}
    for m in (fill - fill % MIN - MIN, fill - fill % MIN):
        ts = list(range(m, m + MIN, 1000))
        rows_b = np.zeros((60, nf), np.float32)
        for r, s in enumerate(ts):
            rows_b[r, fzone] = 4.0 if s <= fill - 30_000 else 1.0
        head = {"v": 1, "s": "FILLUSDT", "t": m, "tick": tick, "step": fstep, "kmid": kmid_f, "n": nf, "ts": ts,
                "bb": [68990.0] * 60, "ba": [69000.0] * 60, "cov": MIN, "gap": False}
        raw.setdefault(book_store.day_path(mbase, "FILLUSDT", book_store.day_of(m), "bks"), []).append(
            book_store.seconds_block(m, head, rows_b, np.zeros((60, nf), np.float32)))
    for path, items in raw.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"".join(items))
    book_store._index.clear()
    zone_usd = float((4.0 * fcenter)[fzone].sum())
    asked = []

    def fake_executed(symbol, minute, lo, hi, side):
        asked.append((symbol, minute, side))
        return 2.0 * zone_usd

    gf = book_measures.compute({**trade, "symbol": "FILLUSDT", "opened_at": fill}, mbase, fake_executed)
    check("libro: en los 30 s antes del llenado se retiro el 75%", gf["book_fill_pulled"] == 75.0, str(gf["book_fill_pulled"]))
    check("libro: lo negociado en tu entrada / lo que habia 30 s antes", gf["book_fill_exec"] == 2.0, str(gf["book_fill_exec"]))
    check("libro: lo negociado se pide del minuto del llenado, contra tu lado", asked == [("FILLUSDT", fill - fill % MIN, 1)], str(asked))

    empty = book_measures.compute({**trade, "symbol": "NADAUSDT"}, mbase, fake_executed)
    check("libro: sin libro de esas horas, todo queda vacio", all(v is None for v in empty.values()))
    keys = {k["key"] for k in book_measures.catalog()}
    check("libro: el catalogo trae cada medida una vez, en el grupo Libro",
          keys == set(got) and len(keys) == len(book_measures.catalog()) and all(k["group"] == "Libro" for k in book_measures.catalog()))

    # ---------- la medicion de semanas (book_study.py), con un camino del precio armado a mano ----------
    import book_study  # noqa: E402
    S0 = T0 + 3000 * MIN
    path = [100.5] * 60                                                     # lejos de la zona
    path += list(np.linspace(100.5, 100.05, 30)) + [100.05] * 20 + list(np.linspace(100.05, 100.4, 20))   # 1) aguanta
    path += [100.5] * 30 + list(np.linspace(100.5, 99.7, 40))               # 2) la cruza
    path += [99.7] * 20 + list(np.linspace(99.7, 100.5, 40)) + [100.5] * 30
    path += list(np.linspace(100.5, 99.85, 30)) + list(np.linspace(99.85, 100.4, 30))  # 3) la pasa y aguanta
    path += [100.5] * 60
    n_s = len(path)
    ts_s = S0 + 1000 * np.arange(n_s)
    bb_s = np.round(np.array(path) - 0.005, 3)
    ba_s = np.round(np.array(path) + 0.005, 3)
    head = {"kmid": 1006, "n": 20, "step": 1, "tick": 0.1, "ts": ts_s.tolist()}   # cubos de 0.1 desde 100.6 hacia abajo
    rows = np.zeros((n_s, 20), np.float32)
    rows[:, :] = 10.0
    near = bb_s < 100.15
    rows[near, :] = 5.0                                                     # justo antes de llegar quedaba la mitad
    sec = {"heads": [head], "bids": [rows], "asks": [np.zeros((n_s, 20), np.float32)], "ts": ts_s, "bb": bb_s, "ba": ba_s,
           "blk": np.zeros(n_s, int), "row": np.arange(n_s)}
    atr = np.full(n_s, 0.4)
    zone = {"kind": "perfil", "label": "POC", "lo": 99.9, "hi": 100.1, "from": S0, "to": S0 + n_s * 1000}

    class FakeTrades:
        def against(self, start, end, lo, hi, side):
            return 30.0 if side == "b" else 0.0

    vs = book_study.visits(sec, atr, zone, FakeTrades())
    bids = [v for v in vs if v["side"] == "b"]
    check("estudio: tres visitas a la zona de compras: aguanta, cruza y pasa-y-aguanta",
          [v["outcome"] for v in bids] == ["aguanto", "cruzo", "aguanto"], str([v["outcome"] for v in bids]))
    check("estudio: la que pasa la zona y aguanta queda marcada (una limit ahi se habria llenado)",
          [v["pierced"] for v in bids] == [False, True, True], str([v["pierced"] for v in bids]))
    ok_depth = all(abs(v["approach_usd"] - 2 * 10.0 * 100.0) < 30 and abs(v["arrival_usd"] - 2 * 5.0 * 100.0) < 15 for v in bids)
    check("estudio: lo que habia al acercarse y al llegar sale del libro de cada segundo", ok_depth,
          str([(v["approach_usd"], v["arrival_usd"]) for v in bids]))
    asks = [v for v in vs if v["side"] == "a"]
    # tras cruzarla, el precio vuelve desde 99.7 hasta 100.5: desde abajo la zona es de ventas, y la pasa de largo
    check("estudio: desde abajo, la misma zona es de ventas (y el precio la cruza al volver)",
          len(asks) == 1 and asks[0]["outcome"] == "cruzo", str([v["outcome"] for v in asks]))
    summ = book_study.summarize(bids)
    check("estudio: el resumen cuenta aguante, llenado que aguanta y lo que llegaba",
          summ["resueltas"] == 3 and summ["aguanto_pct"] == 66.7 and summ["llena_y_aguanta_pct"] == 33.3
          and summ["llegaba_de_lo_que_habia"] == 0.5 and summ["muestra_pequena"], str(summ))
    rz = book_study.random_zones([zone], seed=1)
    widths = {round(z["hi"] - z["lo"], 9) for z in rz}
    shifts = [abs((z["lo"] + z["hi"]) / 2 / 100.0 - 1) for z in rz]
    check("estudio: zonas al azar del mismo ancho, corridas 0.3% a 1.5%, en las mismas horas",
          len(rz) == 3 and widths == {0.2} and all(0.003 <= s <= 0.015 for s in shifts) and all(z["from"] == S0 for z in rz))

    class FakeStore:
        def minutes(self, symbol, a, b, live=None):
            m = np.arange(a, b)
            return {"m": m, "h": np.full(len(m), 110.0), "l": np.full(len(m), 90.0), "o": None, "c": None, "v": None}

        def profile(self, symbol, start, end, known, low, high, rows, live=None):
            vol = np.ones(rows)
            vol[rows // 2] = 50  # POC en el medio
            return {"buy": vol.tolist(), "sell": [0] * rows}

    vz = {z["label"]: z for z in book_study.vp_zones(FakeStore(), "TESTUSDT", T0)}
    poc_mid = (vz["POC"]["lo"] + vz["POC"]["hi"]) / 2
    check("estudio: POC, VAH y VAL del dia anterior, con el POC en su franja",
          set(vz) == {"POC", "VAH", "VAL"} and abs(poc_mid - 100.0) < 0.05 and vz["VAL"]["hi"] < poc_mid < vz["VAH"]["lo"]
          and vz["POC"]["from"] == T0 and vz["POC"]["to"] == T0 + 86400000, str({k: (z["lo"], z["hi"]) for k, z in vz.items()}))

    class GapStore:
        def minutes(self, symbol, a, b, live=None):
            m = np.arange(a, b)
            h, l = np.full(len(m), 100.2), np.full(len(m), 99.8)
            k = (m // 15) - (m[0] // 15)
            # tres velas de 15m: 99.8-100.2, 100.0-100.6 y 100.4-100.9 dejan un hueco alcista de 100.2 a 100.4
            for i, (lo_, hi_) in enumerate(((99.8, 100.2), (100.0, 100.6), (100.4, 100.9))):
                sel = k == 100 + i
                l[sel], h[sel] = lo_, hi_
            sel = k > 102
            l[sel], h[sel] = 100.5, 101.0
            return {"m": m, "h": h, "l": l}

    fz = book_study.fvg_zones(GapStore(), "TESTUSDT", T0, T0 + 86400000, 15)
    gap = [z for z in fz if z["label"] == "alcista" and abs(z["lo"] - 100.2) < 1e-9 and abs(z["hi"] - 100.4) < 1e-9]
    check("estudio: un FVG alcista de 15m nace al cerrar su vela y dura hasta llenarse o 3 dias", len(gap) == 1, str(fz[:3]))

    # ---------- rutas sin grabar ----------
    from fastapi.testclient import TestClient  # noqa: E402
    import main  # noqa: E402
    with TestClient(main.app, base_url="http://127.0.0.1") as client:
        st = client.get("/api/book/status").json()
        check("con SUITE_RECORD=0 el libro no se graba y la ruta lo dice", st.get("success") and st.get("running") is False and st.get("enabled") is False)
        check("la profundidad responde 503 sin grabador", client.get("/api/book/depth/BTCUSDT").status_code == 503)
        suite = client.get("/api/suite/status").json()
        check("el estado de la suite trae el libro", "book" in suite and suite["book"]["running"] is False)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok}/{len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
