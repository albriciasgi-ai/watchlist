# book_recorder.py - La suite graba el libro completo de Bybit (orderbook.full) de sus monedas, desde el 13/11/2026.
#
# Por que: Bybit publica el libro completo desde el 11/08/2026 y su historia no se recupera despues: los archivos
# gratis de Bybit traen 200 niveles, que en BTC alcanzan +-0.05% (ver reports/Patrones del price ladder y
# cancelaciones.md). Lo grabado sirve para medir que hace la liquidez cuando el precio llega a una zona (book_study.py),
# para las medidas del libro en el journal (book_measures.py) y, mas adelante, el mapa de liquidez y el ladder.
#
# Como: WebSocket publico orderbook.full.{SIMBOLO} (solo cambios, cada 200 ms) y la foto REST
# /v5/market/full_orderbook al conectar. Los cambios se aplican con u de a 1; si u salta, se pide otra foto
# (resincronizacion: ese minuto queda incompleto). Con la hora de Bybit, cada segundo se toma lo que hay en cubos
# finos cerca del precio, y cada minuto la profundidad ponderada por tiempo y la minima en cubos gruesos hasta +-5%.
# Formato en book_store.py. Solo lectura: no se envia nada a Bybit fuera de las suscripciones y las fotos.
# Graba un solo proceso por carpeta (candado live/book/recorder.lock). SUITE_BOOK=0 lo apaga; sin SUITE_BOOK vale
# SUITE_RECORD, que las pruebas ponen en 0.
import asyncio
import json
import logging
import math
import os
import time
from pathlib import Path
from typing import Dict, List, Optional

import numpy as np
from fastapi import APIRouter, HTTPException

import book_store

logger = logging.getLogger("suite.book")
WS_URL = "wss://stream.bybit.com/v5/public/linear"
PING_SECONDS = 20
SILENCE_SECONDS = 30          # sin ningun mensaje en la conexion: se reconecta
GROUP_SIZE = 7                # monedas por conexion
FINE_FRACTION = 0.0001        # cubo fino ~0.01% del precio (en BTC 5 USD, el step del footprint de 1m)
COARSE_FRACTION = 0.0003      # cubo grueso ~0.03% (en BTC 20 USD, el de 15m)
FINE_BAND = 0.008             # cada segundo, hasta +-0.8% del precio al abrir el minuto
COARSE_BAND = 0.05            # cada minuto, hasta +-5%
KEEP_BAND = 0.20              # niveles que se guardan en memoria; mas lejos no se usan
RESYNC_MOVE = 0.10            # nueva foto si el precio se aleja 10% de la ultima
RESYNC_HOURS = 24             # y una vez al dia, escalonado por moneda
MAX_BUFFER = 3000             # cambios guardados mientras llega la foto (unos 10 minutos)
SAMPLE_LAG_MS = 1500          # el reloj de respaldo toma cada segundo con este atraso
LOCK_RETRY_SECONDS = 60
MINUTE = 60000


def enabled() -> bool:
    return os.environ.get("SUITE_BOOK", os.environ.get("SUITE_RECORD", "1")) != "0"


def nice_ticks(raw: float) -> int:
    """Cubo en ticks: 1, 2, 5, 10, 20, 25, 50, 100... el mas cercano (en escala logaritmica) a raw."""
    if raw <= 1:
        return 1
    exp = 10 ** math.floor(math.log10(raw))
    options = (1, 2, 5, 10) if exp == 1 else (1, 2, 2.5, 5, 10)
    values = sorted({int(round(m * exp)) for m in options if float(m * exp).is_integer()})
    return min(values, key=lambda v: abs(math.log(raw / v)))


def infer_tick(prices: List[float]) -> float:
    """Tick con los precios de la foto, si Bybit no lo dio: la menor diferencia, llevada a 1, 2 o 5 x 10^k."""
    ps = sorted(set(prices))
    diffs = [b - a for a, b in zip(ps, ps[1:]) if b - a > 0]
    if not diffs:
        return 0.01
    d = min(diffs)
    exp = 10 ** math.floor(math.log10(d))
    for m in (1, 2, 5, 10):
        if d <= m * exp * 1.0001:
            return float(f"{m * exp:.12g}")
    return float(f"{d:.12g}")


class Book:
    """Libro de una moneda: niveles en ticks, sumas por cubo y lo que se junta del minuto en curso."""

    def __init__(self, symbol: str, tick: Optional[float] = None):
        self.symbol = symbol
        self.tick = tick
        self.fine = self.coarse = None
        self.bids: Dict[int, float] = {}
        self.asks: Dict[int, float] = {}
        self.fb: Dict[int, float] = {}
        self.fa: Dict[int, float] = {}
        self.cb: Dict[int, float] = {}
        self.ca: Dict[int, float] = {}
        self.best_b = self.best_a = None
        self.u = None
        self.ready = False
        self.syncing = False
        self.buffer: List[tuple] = []
        self.keep_lo = self.keep_hi = None
        self.snap_mid = None
        self.snap_at = 0
        self.last_ts = None
        # minuto en curso
        self.minute = None
        self.next_sample = None
        self.cov_from = None
        self.kmid_f = self.kmid_c = None
        self.nf = self.nc = 0
        self.rows_b: List[list] = []
        self.rows_a: List[list] = []
        self.row_ts: List[int] = []
        self.row_bb: List[float] = []
        self.row_ba: List[float] = []
        self.acc_b: Dict[int, list] = {}
        self.acc_a: Dict[int, list] = {}
        self.out: List[tuple] = []  # (ruta relativa, bytes) listos para escribir
        self.stats = {"messages": 0, "resyncs": 0, "gaps": 0, "minutes": 0, "stale": 0, "outside": 0,
                      "last_gap": None, "last_resync_reason": None}

    # ---------- foto y cambios ----------
    def load_snapshot(self, result: dict, ts: int):
        if self.tick is None:
            self.tick = infer_tick([float(p) for p, _ in (result.get("b") or [])[:500]] +
                                   [float(p) for p, _ in (result.get("a") or [])[:500]])
        tick = self.tick
        bids = {round(float(p) / tick): float(q) for p, q in result.get("b") or [] if float(q) > 0}
        asks = {round(float(p) / tick): float(q) for p, q in result.get("a") or [] if float(q) > 0}
        if not bids or not asks:
            raise ValueError("foto sin compras o sin ventas")
        best_b, best_a = max(bids), min(asks)
        mid = (best_b + best_a) / 2
        if self.fine is None:
            price = mid * tick
            self.fine = nice_ticks(price * FINE_FRACTION / tick)
            self.coarse = nice_ticks(price * COARSE_FRACTION / tick)
            if self.coarse < self.fine:
                self.coarse = self.fine
        self.keep_lo, self.keep_hi = mid * (1 - KEEP_BAND), mid * (1 + KEEP_BAND)
        self.bids = {t: q for t, q in bids.items() if t >= self.keep_lo}
        self.asks = {t: q for t, q in asks.items() if t <= self.keep_hi}
        self.fb, self.fa, self.cb, self.ca = {}, {}, {}, {}
        for book, fine, coarse in ((self.bids, self.fb, self.cb), (self.asks, self.fa, self.ca)):
            for t, q in book.items():
                kf, kc = t // self.fine, t // self.coarse
                fine[kf] = fine.get(kf, 0.0) + q
                coarse[kc] = coarse.get(kc, 0.0) + q
        self.best_b, self.best_a = best_b, best_a
        self.u = int(result["u"])
        self.snap_mid = mid
        self.snap_at = ts
        self.last_ts = ts

    def _apply_side(self, levels, is_bid: bool, t_ms: int):
        book = self.bids if is_bid else self.asks
        fine = self.fb if is_bid else self.fa
        coarse = self.cb if is_bid else self.ca
        acc = self.acc_b if is_bid else self.acc_a
        tick, fstep, cstep = self.tick, self.fine, self.coarse
        lo, hi = self.keep_lo, self.keep_hi
        timing = self.minute is not None
        cov_from = self.cov_from
        touched = set() if timing else None
        top_added = None
        removed_best = False
        best = self.best_b if is_bid else self.best_a
        for p, q in levels:
            t = round(float(p) / tick)
            if t < lo or t > hi:
                self.stats["outside"] += 1
                continue
            q = float(q)
            old = book.get(t, 0.0)
            if q == old:
                continue
            if q > 0:
                book[t] = q
                if top_added is None or (t > top_added if is_bid else t < top_added):
                    top_added = t
            else:
                book.pop(t, None)
                if t == best:
                    removed_best = True
            d = q - old
            kf = t // fstep
            v = fine.get(kf, 0.0) + d
            if abs(v) < 1e-12:
                fine.pop(kf, None)
            else:
                fine[kf] = v
            kc = t // cstep
            prev = coarse.get(kc, 0.0)
            new = prev + d
            if abs(new) < 1e-12:
                coarse.pop(kc, None)
                new = 0.0
            else:
                coarse[kc] = new
            if timing and kc not in touched:
                # Lo ponderado por tiempo se suma con lo que habia antes de este mensaje. Varios niveles del mismo
                # cubo en un mensaje cambian a la vez: el minimo se mira despues, con el cubo ya completo
                touched.add(kc)
                a = acc.get(kc)
                if a is None:
                    acc[kc] = [prev * (t_ms - cov_from), t_ms, prev]
                else:
                    a[0] += prev * (t_ms - a[1])
                    a[1] = t_ms
        if touched:
            for kc in touched:
                v = coarse.get(kc, 0.0)
                a = acc[kc]
                if v < a[2]:
                    a[2] = v
        # mejor precio sin recorrer todo el libro
        if top_added is not None and (best is None or (top_added > best if is_bid else top_added < best)):
            best = top_added
            removed_best = False
        if removed_best or (best is not None and best not in book):
            best = self._scan_best(book, best, is_bid)
        if is_bid:
            self.best_b = best
        else:
            self.best_a = best

    @staticmethod
    def _scan_best(book: Dict[int, float], start: Optional[int], is_bid: bool) -> Optional[int]:
        if not book:
            return None
        if start is not None:
            step = -1 if is_bid else 1
            t = start
            for _ in range(20000):
                t += step
                if t in book:
                    return t
        return max(book) if is_bid else min(book)

    def apply(self, data: dict, ts: int):
        self._apply_side(data.get("b") or [], True, ts)
        self._apply_side(data.get("a") or [], False, ts)
        self.u = int(data["u"])
        self.last_ts = ts

    def mid_ticks(self) -> Optional[float]:
        if self.best_b is None or self.best_a is None:
            return None
        return (self.best_b + self.best_a) / 2

    # ---------- tiempo: segundos y minutos ----------
    def start_timing(self, at_ms: int):
        """Listo desde at_ms: se empieza a tomar desde el proximo minuto completo."""
        self.minute = None
        self.next_sample = (at_ms // MINUTE + 1) * MINUTE

    def advance(self, until_ms: int):
        """Toma cada segundo hasta until_ms con el libro como esta (antes de los cambios de until_ms)."""
        if not self.ready or self.next_sample is None:
            return
        while self.next_sample <= until_ms:
            s = self.next_sample
            minute = s - s % MINUTE
            if self.minute is not None and minute != self.minute:
                self.close_minute(self.minute + MINUTE)
            if self.minute is None:
                if minute != s:  # se entra a mitad de un minuto: se espera el siguiente
                    self.next_sample = minute + MINUTE
                    continue
                self.open_minute(minute)
            self._sample(s)
            self.next_sample = s + 1000

    def open_minute(self, minute: int):
        mid = self.mid_ticks()
        self.minute = minute
        self.cov_from = minute
        self.kmid_f = int(mid // self.fine)
        self.kmid_c = int(mid // self.coarse)
        self.nf = max(2, int(math.ceil(mid * FINE_BAND / self.fine)) + 1)
        self.nc = max(2, int(math.ceil(mid * COARSE_BAND / self.coarse)) + 1)
        self.rows_b, self.rows_a, self.row_ts, self.row_bb, self.row_ba = [], [], [], [], []
        self.acc_b, self.acc_a = {}, {}

    def _sample(self, s: int):
        fb, fa, k0, n = self.fb, self.fa, self.kmid_f, self.nf
        self.rows_b.append([fb.get(k0 - i, 0.0) for i in range(n)])
        self.rows_a.append([fa.get(k0 + i, 0.0) for i in range(n)])
        self.row_ts.append(s)
        self.row_bb.append(round(self.best_b * self.tick, 10) if self.best_b is not None else None)
        self.row_ba.append(round(self.best_a * self.tick, 10) if self.best_a is not None else None)

    def _column(self, coarse: Dict[int, float], acc: Dict[int, list], sign: int, t_end: int, span: int):
        twa = np.zeros(self.nc, np.float32)
        low = np.zeros(self.nc, np.float32)
        k0 = self.kmid_c
        for i in range(self.nc):
            k = k0 + sign * i
            value = coarse.get(k, 0.0)
            a = acc.get(k)
            if a is None:
                twa[i] = low[i] = value
            else:
                integral = a[0] + value * (t_end - a[1])
                twa[i] = integral / span if span > 0 else value
                low[i] = min(a[2], value)
        return twa, low

    def close_minute(self, t_end: int, gap: bool = False):
        """Cierra el minuto en curso (completo, o hasta t_end si se perdio la conexion) y deja sus bloques listos."""
        if self.minute is None:
            return
        minute = self.minute
        span = max(0, t_end - self.cov_from)
        day = book_store.day_of(minute)
        sym = self.symbol
        base_header = {"v": 1, "s": sym, "t": minute, "tick": self.tick}
        if self.row_ts:
            head = dict(base_header, step=self.fine, kmid=self.kmid_f, n=self.nf, ts=self.row_ts, bb=self.row_bb,
                        ba=self.row_ba, cov=span, gap=bool(gap))
            data = book_store.seconds_block(minute, head, np.array(self.rows_b, np.float32), np.array(self.rows_a, np.float32))
            self.out.append((f"{sym}/{day[:4]}/{sym}_{day}.bks", data))
        if span > 0:
            twa_b, min_b = self._column(self.cb, self.acc_b, -1, t_end, span)
            twa_a, min_a = self._column(self.ca, self.acc_a, 1, t_end, span)
            mid = self.mid_ticks()
            head = dict(base_header, step=self.coarse, kmid=self.kmid_c, n=self.nc, cov=span, gap=bool(gap),
                        samples=len(self.row_ts), mid=round(mid * self.tick, 10) if mid is not None else None)
            data = book_store.minute_block(minute, head, twa_b, twa_a, min_b, min_a)
            self.out.append((f"{sym}/{day[:4]}/{sym}_{day}.bkm", data))
        self.stats["minutes"] += 1
        self.minute = None
        self.rows_b, self.rows_a, self.row_ts, self.row_bb, self.row_ba = [], [], [], [], []
        self.acc_b, self.acc_a = {}, {}

    def lose(self, at_ms: Optional[int], reason: str):
        """Se pierde la continuidad: el minuto en curso se cierra hasta ahi y no se toma nada hasta la proxima foto."""
        if self.ready and self.minute is not None and at_ms is not None:
            self.close_minute(max(self.cov_from, min(at_ms, self.minute + MINUTE)), gap=True)
        self.ready = False
        self.minute = None
        self.next_sample = None
        self.stats["gaps"] += 1
        self.stats["last_gap"] = at_ms
        self.stats["last_resync_reason"] = reason

    # ---------- un mensaje del WebSocket ----------
    def on_delta(self, ts: int, data: dict) -> Optional[str]:
        """Devuelve 'resync' si hay que pedir otra foto."""
        self.stats["messages"] += 1
        u = data.get("u")
        if u is None:
            return None
        u = int(u)
        if not self.ready:
            if self.syncing:
                self.buffer.append((ts, data))
                if len(self.buffer) > MAX_BUFFER:
                    self.buffer = self.buffer[-MAX_BUFFER:]
            return None
        if u <= self.u:
            self.stats["stale"] += 1
            return None
        if u != self.u + 1:
            self.lose(ts, f"u salto de {self.u} a {u}")
            self.syncing = True
            self.buffer = [(ts, data)]
            return "resync"
        self.advance(ts)
        self.apply(data, ts)
        return None

    def finish_sync(self, result: dict, snap_ts: int) -> bool:
        """Aplica la foto y los cambios guardados mientras llegaba. False si faltan cambios (pedir otra foto)."""
        snap_u = int(result["u"])
        pending = sorted(self.buffer, key=lambda item: int(item[1]["u"]))
        newer = [item for item in pending if int(item[1]["u"]) > snap_u]
        if newer and int(newer[0][1]["u"]) != snap_u + 1:
            return False  # la foto es anterior a lo que se guardo y faltan cambios entre medio
        self.load_snapshot(result, snap_ts)
        for ts, data in newer:
            if int(data["u"]) != self.u + 1:
                return False
            self.apply(data, ts)
        self.buffer = []
        self.syncing = False
        self.ready = True
        self.start_timing(self.last_ts or snap_ts)
        self.stats["resyncs"] += 1
        return True

    def take_output(self) -> List[tuple]:
        out, self.out = self.out, []
        return out

    def depth_now(self, band: float = 0.005) -> Optional[dict]:
        """Lo que hay ahora en cubos finos hasta band del precio (para el ladder y para revisar)."""
        if not self.ready:
            return None
        mid = self.mid_ticks()
        n = max(1, int(math.ceil(mid * band / self.fine)))
        k0 = int(mid // self.fine)
        width = self.fine * self.tick
        return {"symbol": self.symbol, "ts": self.last_ts, "u": self.u, "tick": self.tick, "step": round(width, 10),
                "best_bid": round(self.best_b * self.tick, 10), "best_ask": round(self.best_a * self.tick, 10),
                "bids": [[round((k0 - i) * width, 10), round(self.fb.get(k0 - i, 0.0), 8)] for i in range(n)],
                "asks": [[round((k0 + i) * width, 10), round(self.fa.get(k0 + i, 0.0), 8)] for i in range(n)]}


class BookRecorder:
    def __init__(self, symbols: List[str], data_dir: Path, bybit_url: str = "https://api.bybit.com",
                 http=None, turn=None):
        self.symbols = list(dict.fromkeys(s.upper() for s in symbols))
        self.base = book_store.root(data_dir)
        self.bybit_url = bybit_url.rstrip("/")
        self.http = http
        self.turn = turn
        self.books: Dict[str, Book] = {s: Book(s) for s in self.symbols}
        self.ticks: Dict[str, float] = {}
        self.offset = None          # hora de Bybit menos hora del PC (ms), con la menor demora vista
        self._offsets: List[float] = []
        self.connections: Dict[int, dict] = {}
        self._tasks: List[asyncio.Task] = []
        self._syncs: Dict[str, asyncio.Task] = {}
        self._groups: List[List[str]] = []
        self._sockets: Dict[int, object] = {}
        self.write_errors = 0
        self.bytes_written = 0
        self.last_write_error = None
        self.started_at = None

    # ---------- arranque ----------
    async def start(self):
        self.started_at = int(time.time() * 1000)
        await self._load_ticks()
        self._groups = [self.symbols[i:i + GROUP_SIZE] for i in range(0, len(self.symbols), GROUP_SIZE)]
        for gi, group in enumerate(self._groups):
            self._tasks.append(asyncio.create_task(self._run_group(gi)))
        self._tasks.append(asyncio.create_task(self._clock_loop()))

    async def stop(self):
        for task in list(self._tasks) + list(self._syncs.values()):
            task.cancel()
        self._tasks, self._syncs = [], {}
        now = self.bybit_now()
        for book in self.books.values():
            if book.ready and book.minute is not None:
                book.lose(now, "servidor detenido")
        await asyncio.to_thread(self._write_all)

    async def add_symbol(self, symbol: str):
        symbol = symbol.upper()
        if symbol in self.books:
            return
        self.symbols.append(symbol)
        self.books[symbol] = Book(symbol, self.ticks.get(symbol))
        group = next((gi for gi, g in enumerate(self._groups) if len(g) < GROUP_SIZE), None)
        if group is None:
            self._groups.append([symbol])
            self._tasks.append(asyncio.create_task(self._run_group(len(self._groups) - 1)))
            return
        self._groups[group].append(symbol)
        ws = self._sockets.get(group)
        if ws is not None:
            try:
                self.books[symbol].syncing = True
                await ws.send(json.dumps({"op": "subscribe", "args": [f"orderbook.full.{symbol}"]}))
                self._schedule_sync(symbol, delay=0.5)
            except Exception:
                pass

    async def _load_ticks(self):
        """Tick de cada moneda (instruments-info, un solo pedido). Sin respuesta se deduce de la foto."""
        if self.http is None:
            return
        try:
            if self.turn:
                await self.turn()
            r = await self.http.get(f"{self.bybit_url}/v5/market/instruments-info",
                                    params={"category": "linear", "limit": 1000}, timeout=20)
            items = (r.json().get("result") or {}).get("list") or []
            for it in items:
                sym, tick = it.get("symbol"), (it.get("priceFilter") or {}).get("tickSize")
                if sym and tick:
                    self.ticks[sym] = float(tick)
        except Exception as e:
            logger.warning(f"[BOOK] sin ticks de Bybit ({e}); se deducen de cada foto")
        for sym, book in self.books.items():
            if book.tick is None and sym in self.ticks:
                book.tick = self.ticks[sym]

    # ---------- reloj de Bybit ----------
    def _clock(self, ts: int, recv_ms: float):
        self._offsets.append(ts - recv_ms)
        if len(self._offsets) > 400:
            self._offsets = self._offsets[-200:]
        self.offset = max(self._offsets[-200:])

    def bybit_now(self) -> int:
        return int(time.time() * 1000 + (self.offset or 0))

    # ---------- conexiones ----------
    async def _run_group(self, gi: int):
        import websockets
        while True:
            group = self._groups[gi]
            info = self.connections.setdefault(gi, {"connected": False, "reconnects": 0, "last_message": None, "error": None})
            try:
                async with websockets.connect(WS_URL, ping_interval=None, max_size=2 ** 24, max_queue=4096) as ws:
                    self._sockets[gi] = ws
                    for sym in group:
                        book = self.books[sym]
                        book.syncing, book.buffer = True, []
                    for i in range(0, len(group), 10):
                        await ws.send(json.dumps({"op": "subscribe", "args": [f"orderbook.full.{s}" for s in group[i:i + 10]]}))
                    info["connected"], info["error"] = True, None
                    for k, sym in enumerate(group):
                        self._schedule_sync(sym, delay=0.5 + 0.3 * k)
                    last_ping = last_msg = time.time()
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=5)
                        except asyncio.TimeoutError:
                            raw = None
                        now = time.time()
                        if now - last_ping >= PING_SECONDS:
                            await ws.send('{"op":"ping"}')
                            last_ping = now
                        if raw is None:
                            if now - last_msg > SILENCE_SECONDS:
                                raise ConnectionError("sin datos de Bybit")
                            continue
                        last_msg = now
                        info["last_message"] = int(now * 1000)
                        self._on_message(raw, now * 1000)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                info["error"] = str(e)[:200]
                logger.warning(f"[BOOK] conexion {gi} perdida: {e}")
            self._sockets.pop(gi, None)
            info["connected"] = False
            info["reconnects"] += 1
            at = self.bybit_now()
            for sym in self._groups[gi]:
                book = self.books[sym]
                if book.ready:
                    book.lose(at, "conexion perdida")
                book.syncing = False
                task = self._syncs.pop(sym, None)
                if task:
                    task.cancel()
            await asyncio.sleep(3)

    def _on_message(self, raw: str, recv_ms: float):
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        topic = msg.get("topic") or ""
        if not topic.startswith("orderbook.full."):
            return
        book = self.books.get(topic[15:])
        data, ts = msg.get("data") or {}, msg.get("ts")
        if book is None or ts is None:
            return
        ts = int(ts)
        self._clock(ts, recv_ms)
        if msg.get("type") == "snapshot" or data.get("u") == 1:
            # Bybit reinicio el libro: se toma como foto
            if book.ready:
                book.lose(ts, "Bybit envio una foto")
            try:
                book.syncing, book.buffer = True, []
                book.finish_sync(data, ts)
            except Exception as e:
                logger.warning(f"[BOOK] foto del WebSocket de {book.symbol} ilegible: {e}")
                self._schedule_sync(book.symbol)
            return
        if book.on_delta(ts, data) == "resync":
            self._schedule_sync(book.symbol)

    def _schedule_sync(self, symbol: str, delay: float = 0.5):
        old = self._syncs.get(symbol)
        if old and not old.done():
            return
        self._syncs[symbol] = asyncio.create_task(self._sync(symbol, delay))

    async def _sync(self, symbol: str, delay: float):
        book = self.books[symbol]
        await asyncio.sleep(delay)
        for attempt in range(8):
            try:
                if self.turn:
                    await self.turn()
                r = await self.http.get(f"{self.bybit_url}/v5/market/full_orderbook",
                                        params={"category": "linear", "symbol": symbol}, timeout=30)
                body = await asyncio.to_thread(json.loads, r.content)
                if body.get("retCode") not in (0, None):
                    raise ValueError(body.get("retMsg") or body.get("retCode"))
                result = body.get("result") or {}
                if not book.syncing:
                    return  # la conexion se cayo mientras tanto
                if book.finish_sync(result, int(result.get("ts") or self.bybit_now())):
                    self._syncs.pop(symbol, None)
                    return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"[BOOK] foto de {symbol} (intento {attempt + 1}): {e}")
            await asyncio.sleep(min(30, 1.5 * (attempt + 1)))
        logger.error(f"[BOOK] {symbol}: sin foto valida tras 8 intentos; se reintenta en un minuto")
        self._syncs.pop(symbol, None)
        await asyncio.sleep(60)
        if book.syncing:
            self._schedule_sync(symbol)

    # ---------- reloj de respaldo y escritura ----------
    async def _clock_loop(self):
        while True:
            await asyncio.sleep(1.0)
            try:
                if self.offset is None:
                    continue
                now = self.bybit_now()
                for k, book in enumerate(self.books.values()):
                    if not book.ready:
                        continue
                    book.advance(now - SAMPLE_LAG_MS)
                    mid = book.mid_ticks()
                    stagger = (k * 37 % 60) * MINUTE
                    moved = mid is not None and book.snap_mid and abs(mid / book.snap_mid - 1) > RESYNC_MOVE
                    old = now - book.snap_at > RESYNC_HOURS * 3600000 + stagger
                    if moved or old:
                        book.lose(now, "precio lejos de la foto" if moved else "foto de cada dia")
                        book.syncing, book.buffer = True, []
                        self._schedule_sync(book.symbol)
                if any(b.out for b in self.books.values()):
                    await asyncio.to_thread(self._write_all)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[BOOK] reloj: {e}")

    def _write_all(self):
        for book in list(self.books.values()):
            for rel, data in book.take_output():
                path = self.base / rel
                try:
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with open(path, "ab") as fh:
                        fh.write(data)
                    self.bytes_written += len(data)
                except OSError as e:
                    self.write_errors += 1
                    self.last_write_error = f"{rel}: {e}"
                    logger.error(f"[BOOK] no se pudo escribir {rel}: {e}")

    def status(self) -> dict:
        books = {}
        for sym, b in self.books.items():
            books[sym] = {"ready": b.ready, "syncing": b.syncing, "u": b.u, "last_ts": b.last_ts, "tick": b.tick,
                          "fine_step": round(b.fine * b.tick, 10) if b.fine and b.tick else None,
                          "coarse_step": round(b.coarse * b.tick, 10) if b.coarse and b.tick else None,
                          "levels": len(b.bids) + len(b.asks), **b.stats}
        return {"connections": {str(k): v for k, v in self.connections.items()}, "offset_ms": self.offset,
                "bytes_written": self.bytes_written, "write_errors": self.write_errors,
                "last_write_error": self.last_write_error, "started_at": self.started_at, "books": books}


# ---------- un grabador por servidor, con candado por carpeta ----------
_recorder: Optional[BookRecorder] = None
_waiting: Optional[asyncio.Task] = None
_lock_fh = None
_data_dir: Optional[Path] = None


def _take_lock(data_dir: Path) -> bool:
    """Un solo grabador por carpeta. El sistema suelta el candado si el proceso muere."""
    global _lock_fh
    if _lock_fh is not None:
        return True
    path = book_store.root(data_dir) / "recorder.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(path, "a+b")
    try:
        fh.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return False
    _lock_fh = fh
    return True


async def start(symbols, data_dir: Path, bybit_url: str, http, turn=None):
    """Arranca la grabacion del libro. No lanza excepciones. Si otro proceso ya graba, reintenta cada minuto."""
    global _recorder, _waiting, _data_dir
    if not enabled() or _recorder is not None or _waiting is not None:
        return
    _data_dir = Path(data_dir)

    async def begin():
        global _recorder
        rec = BookRecorder(symbols, _data_dir, bybit_url, http, turn)
        await rec.start()
        _recorder = rec
        print(f"[SUITE] Libro completo: grabando {len(rec.symbols)} monedas en {rec.base}")

    try:
        if _take_lock(_data_dir):
            await begin()
            return
    except Exception as e:
        logger.error(f"[BOOK] no se pudo iniciar: {e}")
        print(f"[SUITE] Grabador del libro no iniciado: {e}")
        return
    print("[SUITE] Libro completo: otro proceso ya graba esta carpeta; se reintenta cada minuto")

    async def wait():
        global _waiting
        while True:
            await asyncio.sleep(LOCK_RETRY_SECONDS)
            try:
                if _take_lock(_data_dir):
                    _waiting = None
                    await begin()
                    return
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.error(f"[BOOK] candado: {e}")

    _waiting = asyncio.create_task(wait())


async def stop():
    global _recorder, _waiting
    if _waiting is not None:
        _waiting.cancel()
        _waiting = None
    if _recorder is not None:
        await _recorder.stop()
        _recorder = None


async def add_symbol(symbol: str):
    if _recorder is not None:
        await _recorder.add_symbol(symbol)


def get_recorder() -> Optional[BookRecorder]:
    return _recorder


def brief() -> dict:
    """Resumen para /api/suite/status."""
    if _recorder is None:
        return {"enabled": enabled(), "running": False, "other_process_records": _waiting is not None}
    books = _recorder.books.values()
    return {"enabled": True, "running": True, "symbols": len(_recorder.symbols),
            "ready": sum(1 for b in books if b.ready), "connected": sum(1 for c in _recorder.connections.values() if c["connected"]),
            "bytes_written": _recorder.bytes_written, "write_errors": _recorder.write_errors,
            "gaps": sum(b.stats["gaps"] for b in books), "resyncs": sum(b.stats["resyncs"] for b in books)}


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/status")
    async def book_status():
        if _recorder is None:
            return {"success": True, **brief()}
        base = _recorder.base
        today = book_store.day_of(_recorder.bybit_now())
        usage = await asyncio.to_thread(book_store.disk_usage, base, today)
        return {"success": True, **brief(), **_recorder.status(), "bytes_today": usage, "folder": str(base)}

    @r.get("/api/book/depth/{symbol}")
    async def book_depth(symbol: str, band: float = 0.005):
        if _recorder is None:
            raise HTTPException(status_code=503, detail="el libro no se esta grabando en este servidor")
        book = _recorder.books.get(symbol.upper())
        if book is None:
            raise HTTPException(status_code=404, detail="moneda sin libro")
        depth = book.depth_now(max(0.0005, min(float(band), FINE_BAND)))
        if depth is None:
            raise HTTPException(status_code=503, detail="libro sincronizandose")
        return {"success": True, **depth}

    return r
