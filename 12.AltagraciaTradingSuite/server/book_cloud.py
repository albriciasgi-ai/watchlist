# book_cloud.py - Tapa con la nube los huecos del libro que graba la suite (13/11/2026).
#
# El collector de Northflank (5.Order_flow/cloud_collector) graba el libro completo todo el dia, con el mismo formato
# (book_recorder.py y book_store.py son copias exactas). Cada 10 minutos, para cada moneda y dia que tiene la nube, se
# piden solo los minutos que faltan en el PC, o que el PC tiene incompletos, y se guardan en OrderFlowData/live/book_cloud.
# Los lectores (book_store.sources) juntan las dos carpetas sin repetir minutos. Solo lee de la nube y nunca toca lo
# grabado en el PC. La nube guarda pocos dias (BOOK_KEEP_DAYS del collector): un hueco mas viejo ya no se tapa.
# SUITE_BOOK_CLOUD=0 lo apaga; sin esa variable sigue a la grabacion del libro (SUITE_BOOK, y si no, SUITE_RECORD).
import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Callable, Dict, List, Optional

import httpx
from fastapi import APIRouter

import book_store

logger = logging.getLogger("suite.book_cloud")
DEFAULT_URL = "https://p01--altagracia--rxv8nrbhxln9.code.run"   # la de PanelOrderFlow/sync_nube.py
FIRST_DELAY = 90              # segundos despues de arrancar la suite
INTERVAL = 600                # una vuelta cada 10 minutos
CHUNK_MINUTES = 60            # minutos por pedido: la nube entrega de 15 a 40 KB/s
MAX_BYTES_PER_RUN = 40 << 20  # lo que no alcance queda para la vuelta siguiente
PENDING_PAUSE = 5             # segundos entre vueltas mientras quede algo pendiente
MINUTE = 60000
# Un pedido que pasa 2 minutos sin recibir nada se da por perdido (13/11: uno hecho sin red quedo colgado 10 minutos)
REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=15.0)


def enabled() -> bool:
    return os.environ.get("SUITE_BOOK_CLOUD", os.environ.get("SUITE_BOOK", os.environ.get("SUITE_RECORD", "1"))) != "0"


def wanted(cloud: List[List[int]], local_cov: Dict[int, int], mirror: set, now_ms: int) -> List[int]:
    """Minutos de la nube que el PC no tiene completos ni bajo antes. El minuto en curso no se pide."""
    out = []
    last = now_ms - now_ms % MINUTE - MINUTE  # el minuto anterior puede estar escribiendose en la nube
    for a, b in cloud:
        for m in range(int(a), int(b), MINUTE):
            if m < last and local_cov.get(m, 0) < MINUTE and m not in mirror:
                out.append(m)
    return out


class CloudSync:
    def __init__(self, data_dir: Path, url: str, symbols: Callable[[], List[str]], http=None):
        self.local = book_store.root(data_dir)
        self.mirror = book_store.cloud_root(data_dir)
        self.url = (url or DEFAULT_URL).rstrip("/")
        self.symbols = symbols
        self.http = http
        self.task: Optional[asyncio.Task] = None
        self.stats = {"runs": 0, "last_run": None, "last_ok": None, "last_error": None, "minutes": 0, "bytes": 0,
                      "last_minutes": 0, "last_bytes": 0, "last_seconds": None, "cloud_symbols": None, "pending": 0}

    async def run_once(self, now_ms: Optional[int] = None, budget: int = MAX_BYTES_PER_RUN) -> dict:
        """Una vuelta: lista de la nube y descarga de lo que falta. Devuelve cuanto bajo."""
        started = time.time()
        now_ms = now_ms or int(time.time() * 1000)
        self.stats["runs"] += 1
        self.stats["last_run"] = int(started * 1000)
        r = await self.http.get(f"{self.url}/api/book/days", timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        listing = r.json().get("symbols") or {}
        self.stats["cloud_symbols"] = len(listing)
        mine = set(self.symbols() or [])
        got_minutes = got_bytes = pending = 0
        for sym in sorted(s for s in listing if s in mine):
            for day in sorted(listing[sym]):
                kinds = listing[sym][day]
                if "bkm" not in kinds:
                    continue
                local_cov = await asyncio.to_thread(book_store.minute_cov, book_store.day_path(self.local, sym, day, "bkm"))
                mirror_path = book_store.day_path(self.mirror, sym, day, "bkm")
                have = set(await asyncio.to_thread(book_store.minutes_in, mirror_path))
                todo = wanted(kinds["bkm"].get("minutes") or [], local_cov, have, now_ms)
                for a, b in book_store.ranges(todo):
                    for start in range(a, b, CHUNK_MINUTES * MINUTE):
                        end = min(b, start + CHUNK_MINUTES * MINUTE)
                        if got_bytes >= budget:
                            pending += (end - start) // MINUTE
                            continue
                        # primero los segundos: si se corta a mitad, el minuto no queda marcado como bajado
                        for kind in ("bks", "bkm"):
                            if kind not in kinds:
                                continue
                            resp = await self.http.get(f"{self.url}/api/book/{sym}/{day}/{kind}",
                                                       params={"from_ms": start, "to_ms": end}, timeout=REQUEST_TIMEOUT)
                            if resp.status_code == 404:
                                continue
                            resp.raise_for_status()
                            items = book_store.split_raw(resp.content)
                            path = book_store.day_path(self.mirror, sym, day, kind)
                            added = await asyncio.to_thread(book_store.append_blocks, path, items)
                            got_bytes += len(resp.content)
                            if kind == "bkm":
                                got_minutes += added
        self.stats.update(last_ok=int(time.time() * 1000), last_error=None, last_minutes=got_minutes, last_bytes=got_bytes,
                          last_seconds=round(time.time() - started, 1), pending=pending)
        self.stats["minutes"] += got_minutes
        self.stats["bytes"] += got_bytes
        return {"minutes": got_minutes, "bytes": got_bytes, "pending": pending}

    async def loop(self):
        await asyncio.sleep(FIRST_DELAY)
        while True:
            res = None
            try:
                res = await self.run_once()
                if res["minutes"]:
                    print(f"[SUITE] Libro de la nube: {res['minutes']} minutos bajados ({res['bytes'] // 1024} KB)"
                          + (f", {res['pending']} para la proxima vuelta" if res["pending"] else ""))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.stats["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                logger.warning(f"[BOOK_CLOUD] {self.stats['last_error']}")
            # con minutos pendientes (un PC que estuvo apagado), la vuelta siguiente sigue enseguida
            await asyncio.sleep(PENDING_PAUSE if res and res.get("pending") else INTERVAL)

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self.loop())

    async def stop(self):
        if self.task is not None:
            self.task.cancel()
            self.task = None


_sync: Optional[CloudSync] = None


def start(data_dir: Path, url: str, symbols: Callable[[], List[str]], http):
    global _sync
    if not enabled() or _sync is not None:
        return
    _sync = CloudSync(data_dir, url, symbols, http)
    _sync.start()


async def stop():
    global _sync
    if _sync is not None:
        await _sync.stop()
        _sync = None


def brief() -> dict:
    if _sync is None:
        return {"enabled": enabled(), "running": False}
    return {"enabled": True, "running": True, "url": _sync.url, **_sync.stats}


def make_router() -> APIRouter:
    r = APIRouter()

    @r.get("/api/book/cloud")
    async def book_cloud_status():
        return {"success": True, **brief()}

    return r
