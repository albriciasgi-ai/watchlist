# tape_recorder.py - Graba los trades de Bybit en el formato del almacen de App 1 (.tape, OFT1)
#
# Un archivo por moneda y dia UTC: /data/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape
# Es el mismo formato que OrderFlowData/tools/ingest.py arma desde public.bybit.com, asi que
# build_store.py y build_flow.py sacan de el el almacen por minuto y precio y el flujo, igual
# que de un dia oficial. Sirve para los dias que Bybit aun no publico (o que no se han bajado).
#
# - En memoria quedan solo los trades desde el ultimo guardado. Cada SNAPSHOT_SECONDS se suman al
#   archivo del dia en disco (se lee, se une y se reescribe con temporal + reemplazo), una moneda a
#   la vez: asi la memoria no crece con el dia (el servicio tiene 512 MB y BTC pasa de 2 millones
#   de trades por dia).
# - Se anotan los huecos: cortes del WebSocket y reinicios del collector. Un dia sin huecos
#   y grabado desde su inicio queda "complete".
# - Al reiniciar se toma la cabecera del dia guardado y el hueco desde su ultimo guardado queda
#   anotado; un dia anterior que quedo sin cerrar se cierra con su hueco hasta el final del dia.
import asyncio
import datetime as dt
import json
import logging
import re
import time
import urllib.request
from array import array
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

from tape_format import read_meta, read_tape, write_tape

logger = logging.getLogger(__name__)

DAY_MS = 24 * 60 * 60 * 1000
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
LEVEL_OPEN = 6    # compresion del dia en curso: 4 veces mas rapida que 9 y 2% mas grande
LEVEL_FINAL = 9   # compresion del dia cerrado, como ingest.py


def day_of(ms: int) -> str:
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")


def day_start_ms(day: str) -> int:
    return int(dt.datetime.fromisoformat(day + "T00:00:00+00:00").timestamp() * 1000)


def decimals(s) -> int:
    s = str(s)
    return len(s.partition('.')[2].rstrip('0'))


def to_scaled_int(text: str, dec: int) -> Tuple[int, bool]:
    """'74462.5' con 2 decimales -> (7446250, True). False si el valor tiene mas decimales que la escala."""
    neg = text.startswith('-')
    if neg:
        text = text[1:]
    a, _, b = text.partition('.')
    b = b.rstrip('0')
    exact = len(b) <= dec
    frac = (b + '0' * dec)[:dec] if dec else ''
    v = int(a or '0') * 10 ** dec + (int(frac) if frac else 0)
    return (-v if neg else v), exact


class UnreadableDay(Exception):
    """El archivo del dia en disco no se puede leer."""


class DayBuffer:
    """Trades de una moneda en un dia UTC que aun no estan en disco, mas el estado del dia."""

    def __init__(self, symbol: str, day: str, price_dec: int, qty_dec: int):
        self.symbol = symbol
        self.day = day
        self.price_dec = price_dec
        self.qty_dec = qty_dec
        self.t = array('q')
        self.p = array('q')
        self.q = array('q')
        self.side = array('b')
        self.rpi = array('b')
        self.gaps: List[List[int]] = []      # [inicio_ms, fin_ms] sin datos
        self.covered_from: Optional[int] = None  # primera hora grabada (ms)
        self.inexact = 0                     # precios o cantidades con mas decimales que la escala
        self.dirty = False
        self.saved = 0                       # trades del dia ya escritos en disco

    def add(self, t_ms: int, price: str, size: str, side: str, rpi: bool):
        p, ok_p = to_scaled_int(price, self.price_dec)
        q, ok_q = to_scaled_int(size, self.qty_dec)
        if not (ok_p and ok_q):
            self.inexact += 1
        self.t.append(t_ms * 10)  # unidades de 1e-4 s, como ingest.py
        self.p.append(p)
        self.q.append(q)
        self.side.append(1 if side == "Buy" else -1)
        self.rpi.append(1 if rpi else 0)
        if self.covered_from is None:
            self.covered_from = t_ms
        self.dirty = True

    def load_meta(self, meta):
        self.gaps = [list(g) for g in meta.get("gaps", [])]
        self.covered_from = meta.get("covered_from")
        self.inexact = int(meta.get("inexact", 0))
        self.saved = int(meta.get("n", 0))

    def take(self):
        """Saca los trades pendientes (quedan arreglos vacios para los que sigan llegando)."""
        out = (self.t, self.p, self.q, self.side, self.rpi)
        self.t, self.p, self.q, self.side, self.rpi = array('q'), array('q'), array('q'), array('b'), array('b')
        return out

    def give_back(self, taken):
        """Devuelve trades sacados con take() si no se pudieron escribir (van antes que los nuevos)."""
        cur = (self.t, self.p, self.q, self.side, self.rpi)
        for a, b in zip(taken, cur):
            a.extend(b)
        self.t, self.p, self.q, self.side, self.rpi = taken

    def meta(self, now_ms: int, final: bool) -> dict:
        start = day_start_ms(self.day)
        gaps = sorted([list(g) for g in self.gaps])
        # Grabado desde el comienzo del dia (con 1 minuto de tolerancia) y sin huecos
        complete = bool(final and self.covered_from is not None and self.covered_from - start <= 60_000 and not gaps)
        return dict(
            symbol=self.symbol, date=self.day,
            price_scale=10 ** self.price_dec, qty_scale=10 ** self.qty_dec,
            source="bybit-ws-collector", ts_decimals=3,
            covered_from=self.covered_from, saved_at=now_ms,
            gaps=gaps, complete=complete, final=final, inexact=self.inexact,
        )


class TapeRecorder:
    def __init__(self, symbols: List[str], data_dir: Path, keep_days: int = 30, snapshot_seconds: int = 300):
        self.symbols = [s.upper() for s in symbols]
        self.root = Path(data_dir) / "tape"
        self.keep_days = keep_days
        self.snapshot_seconds = snapshot_seconds
        self.scales: Dict[str, Tuple[int, int]] = {}
        self.buffers: Dict[Tuple[str, str], DayBuffer] = {}
        self.disconnected_at: Optional[int] = None
        self.started_at = int(time.time() * 1000)
        self.stats = {"trades": 0, "files_written": 0, "last_write": None, "write_errors": 0}
        self._lock = asyncio.Lock()

    # ---------- arranque ----------
    def load_scales(self):
        """Decimales de precio y cantidad de cada moneda (tickSize y qtyStep de Bybit), como ingest.py."""
        url = "https://api.bybit.com/v5/market/instruments-info?category=linear&limit=1000"
        cursor = ""
        found = {}
        for _ in range(10):
            with urllib.request.urlopen(url + (f"&cursor={cursor}" if cursor else ""), timeout=30) as r:
                res = json.load(r)["result"]
            for it in res.get("list", []):
                found[it["symbol"]] = (decimals(it.get("priceFilter", {}).get("tickSize", "0.01")),
                                       decimals(it.get("lotSizeFilter", {}).get("qtyStep", "0.001")))
            cursor = res.get("nextPageCursor") or ""
            if not cursor:
                break
        for s in self.symbols:
            if s in found:
                self.scales[s] = found[s]
            else:
                logger.error(f"[TAPE] {s}: Bybit no devolvio su tickSize/qtyStep; no se graba")
        logger.info(f"[TAPE] Escalas: {self.scales}")

    def resume_today(self):
        """Toma la cabecera del dia en curso guardado y anota el hueco desde su ultimo guardado.
        Un dia anterior que quedo abierto (el collector se detuvo antes de cerrarlo) se cierra
        con su hueco hasta el final del dia en el proximo guardado."""
        today = day_of(self.started_at)
        yesterday = day_of(day_start_ms(today) - 1)
        for day in (yesterday, today):
            for s in self.symbols:
                path = self.path(s, day)
                if s not in self.scales or not path.exists():
                    continue
                try:
                    meta = read_meta(path)
                    if day != today and meta.get("final"):
                        continue
                    pdec, qdec = self.scales[s]
                    if meta.get("price_scale") != 10 ** pdec or meta.get("qty_scale") != 10 ** qdec:
                        logger.warning(f"[TAPE] {s} {day}: escala distinta a la guardada; se empieza un archivo nuevo")
                        path.rename(path.with_name(path.stem + f".escala-{self.started_at}.tape"))
                        continue
                    buf = DayBuffer(s, day, pdec, qdec)
                    buf.load_meta(meta)
                    last = int(meta.get("saved_at") or self.started_at)
                    end = min(self.started_at, day_start_ms(day) + DAY_MS)
                    if end > last:
                        buf.gaps.append([last, end])
                    buf.dirty = True
                    self.buffers[(s, day)] = buf
                    logger.info(f"[TAPE] {s} {day}: {buf.saved} trades guardados; hueco desde {last}")
                except Exception as e:
                    logger.error(f"[TAPE] {s} {day}: no se pudo leer ({e}); se conserva el archivo aparte")
                    try:
                        path.rename(path.with_name(path.stem + f".ilegible-{self.started_at}.tape"))
                    except Exception:
                        pass

    # ---------- trades y conexion ----------
    def path(self, symbol: str, day: str) -> Path:
        return self.root / symbol / day[:4] / f"{symbol}_{day}.tape"

    def add_trade(self, symbol: str, trade: dict):
        if symbol not in self.scales:
            return
        try:
            t_ms = int(trade["T"])
            day = day_of(t_ms)
            buf = self.buffers.get((symbol, day))
            if buf is None:
                pdec, qdec = self.scales[symbol]
                buf = DayBuffer(symbol, day, pdec, qdec)
                if self.disconnected_at is None and self.started_at < day_start_ms(day):
                    # El collector ya escuchaba al empezar el dia: el dia esta cubierto desde su inicio
                    buf.covered_from = day_start_ms(day)
                self.buffers[(symbol, day)] = buf
            buf.add(t_ms, str(trade["p"]), str(trade["v"]), trade["S"], bool(trade.get("RPI")))
            self.stats["trades"] += 1
        except Exception as e:
            logger.error(f"[TAPE] trade de {symbol} descartado: {e}")

    def mark_disconnected(self, now_ms: Optional[int] = None):
        if self.disconnected_at is None:
            self.disconnected_at = now_ms or int(time.time() * 1000)

    def mark_connected(self, now_ms: Optional[int] = None):
        if self.disconnected_at is None:
            return
        start, end = self.disconnected_at, now_ms or int(time.time() * 1000)
        self.disconnected_at = None
        for (s, day), buf in self.buffers.items():
            ds = day_start_ms(day)
            if start < ds + DAY_MS and end > ds:
                buf.gaps.append([max(start, ds), min(end, ds + DAY_MS)])
                buf.dirty = True
        # Dias que empezaron durante el corte y aun no tienen buffer
        for day in {day_of(start), day_of(end)}:
            for s in self.scales:
                if (s, day) not in self.buffers and day_of(self.started_at) <= day:
                    buf = DayBuffer(s, day, *self.scales[s])
                    ds = day_start_ms(day)
                    buf.covered_from = ds
                    buf.gaps.append([max(start, ds), min(end, ds + DAY_MS)])
                    self.buffers[(s, day)] = buf

    # ---------- escritura ----------
    def _merge_write(self, path: Path, meta: dict, new, level: int) -> int:
        """Une lo ya guardado del dia con los trades nuevos, ordena por hora y reescribe. En otro hilo."""
        t, p, q, side, rpi = (np.frombuffer(a, dtype=np.int64 if a.typecode == 'q' else np.int8) for a in new)
        if path.exists():
            try:
                _, t0, p0, q0, s0, r0 = read_tape(path)
            except (OSError, MemoryError):
                raise
            except Exception as e:
                raise UnreadableDay(str(e)) from e
            t = np.concatenate([t0, t]); p = np.concatenate([p0, p]); q = np.concatenate([q0, q])
            side = np.concatenate([s0.astype(np.int8), side]); rpi = np.concatenate([r0.astype(np.int8), rpi])
            del t0, p0, q0, s0, r0
        if len(t) == 0:
            return 0
        order = np.argsort(t, kind="stable")  # estable: lo guardado antes queda primero en la misma hora
        write_tape(path, meta, t[order], p[order], q[order], side[order], rpi[order], level=level)
        return len(t)

    async def flush(self):
        """Suma al disco los trades pendientes. Un dia terminado hace 2 min se cierra y sale de memoria."""
        async with self._lock:
            for key in list(self.buffers):
                buf = self.buffers[key]
                now = int(time.time() * 1000)
                ended = now >= day_start_ms(buf.day) + DAY_MS + 120_000
                if not buf.dirty and not ended:
                    continue
                path = self.path(buf.symbol, buf.day)
                if len(buf.t) or path.exists():
                    taken = buf.take()
                    meta = buf.meta(now, final=ended)
                    try:
                        path.parent.mkdir(parents=True, exist_ok=True)
                        n = await asyncio.to_thread(self._merge_write, path, meta, taken,
                                                    LEVEL_FINAL if ended else LEVEL_OPEN)
                        buf.saved = n
                        self.stats["files_written"] += 1
                        self.stats["last_write"] = now
                        buf.dirty = bool(len(buf.t))
                    except Exception as e:
                        buf.give_back(taken)
                        self.stats["write_errors"] += 1
                        logger.error(f"[TAPE] {buf.symbol} {buf.day}: no se pudo escribir ({e})")
                        if isinstance(e, UnreadableDay):
                            # Archivo del disco ilegible: se aparta y lo que tenia queda como hueco
                            try:
                                path.rename(path.with_name(path.stem + f".ilegible-{now}.tape"))
                                buf.gaps.append([buf.covered_from or day_start_ms(buf.day), now])
                                buf.saved = 0
                            except Exception:
                                pass
                        continue
                if ended:
                    del self.buffers[key]
                    logger.info(f"[TAPE] {buf.symbol} {buf.day}: dia cerrado ({buf.saved} trades)")

    async def run(self):
        while True:
            await asyncio.sleep(self.snapshot_seconds)
            try:
                await self.flush()
            except Exception as e:
                logger.error(f"[TAPE] Error al guardar: {e}")

    def cleanup(self) -> int:
        cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=self.keep_days)).strftime("%Y-%m-%d")
        deleted = 0
        for f in self.root.glob("*/*/*.tape"):
            m = re.search(r"_(\d{4}-\d{2}-\d{2})", f.name)
            if m and m.group(1) < cutoff:
                f.unlink()
                deleted += 1
        return deleted

    # ---------- consulta ----------
    def list_days(self, symbol: Optional[str] = None) -> Dict[str, List[dict]]:
        out = {}
        for s in ([symbol.upper()] if symbol else self.symbols):
            days = []
            for f in sorted((self.root / s).glob(f"*/{s}_*.tape")):
                m = re.fullmatch(rf"{s}_(\d{{4}}-\d{{2}}-\d{{2}})\.tape", f.name)
                if not m:
                    continue
                try:
                    meta = read_meta(f)
                except Exception:
                    continue
                days.append(dict(day=m.group(1), size=f.stat().st_size, n=meta.get("n"),
                                 complete=meta.get("complete", False), final=meta.get("final", False),
                                 gaps=meta.get("gaps", []), covered_from=meta.get("covered_from"),
                                 saved_at=meta.get("saved_at")))
            out[s] = days
        return out

    def get_stats(self) -> dict:
        return dict(self.stats, days_in_memory=len(self.buffers),
                    trades_in_memory=sum(len(b.t) for b in self.buffers.values()),
                    trades_saved_open_days=sum(b.saved for b in self.buffers.values()),
                    disconnected=self.disconnected_at is not None)
