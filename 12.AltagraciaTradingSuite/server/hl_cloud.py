# hl_cloud.py - Baja de la nube lo que grabó de Hyperliquid (22/11/2026).
#
# El collector de Northflank (5.Order_flow/cloud_collector) graba Hyperliquid todo el día con el mismo grabador de la
# suite (hl_recorder.py es copia exacta), así hay historia aunque la suite esté cerrada. Cada 10 minutos se lista
# /api/hyperliquid/days de la nube y, de cada carpeta (ctx, positions, fast) y día, se baja solo lo que se agregó desde
# la vuelta anterior (los archivos solo crecen: se pide desde los bytes que ya hay), a OrderFlowData/live/hyperliquid_cloud.
# Nunca toca lo grabado en el PC; hl_recorder.read_rows junta las dos carpetas. La nube guarda HL_KEEP_DAYS días: con el
# PC apagado más tiempo, lo más viejo se pierde.
# SUITE_HL_CLOUD=0 lo apaga; sin esa variable sigue a SUITE_HL, y si no, a SUITE_RECORD.
import asyncio
import logging
import os
import time
from pathlib import Path
from typing import Optional

import httpx
from fastapi import APIRouter

import hl_recorder

logger = logging.getLogger("suite.hl_cloud")
FIRST_DELAY = 120             # segundos después de arrancar la suite
INTERVAL = 600                # una vuelta cada 10 minutos
PENDING_PAUSE = 5             # entre vueltas mientras quede algo por bajar
MAX_BYTES_PER_RUN = 40 << 20  # lo que no alcance queda para la vuelta siguiente
REQUEST_TIMEOUT = httpx.Timeout(120.0, connect=15.0)


def enabled() -> bool:
    return os.environ.get("SUITE_HL_CLOUD", os.environ.get("SUITE_HL", os.environ.get("SUITE_RECORD", "1"))) != "0"


def mirror_size(path: Path) -> int:
    try:
        return path.stat().st_size
    except OSError:
        return 0


class HlCloudSync:
    def __init__(self, data_dir: Path, url: str, http=None):
        self.mirror = hl_recorder.cloud_root(data_dir)
        self.url = (url or "").rstrip("/")
        self.http = http
        self.task: Optional[asyncio.Task] = None
        self.stats = {"runs": 0, "last_run": None, "last_ok": None, "last_error": None, "bytes": 0, "last_bytes": 0,
                      "last_files": 0, "last_seconds": None, "cloud_days": None, "keep_days": None, "pending": False}

    async def run_once(self, budget: int = MAX_BYTES_PER_RUN) -> dict:
        started = time.time()
        self.stats["runs"] += 1
        self.stats["last_run"] = int(started * 1000)
        r = await self.http.get(f"{self.url}/api/hyperliquid/days", timeout=REQUEST_TIMEOUT)
        r.raise_for_status()
        body = r.json()
        files = body.get("files") or {}
        self.stats["cloud_days"] = len({d for days in files.values() for d in days})
        self.stats["keep_days"] = body.get("keep_days")
        got = touched = 0
        pending = False
        for kind in sorted(k for k in files if k in hl_recorder.KINDS):
            for day, size in sorted(files[kind].items()):
                path = self.mirror / kind / f"{day}.jsonl"
                have = await asyncio.to_thread(mirror_size, path)
                if not isinstance(size, int) or size <= have:
                    continue          # al día (o la nube empezó el día de nuevo: lo bajado queda)
                while have < size:
                    if got >= budget:
                        pending = True
                        break
                    resp = await self.http.get(f"{self.url}/api/hyperliquid/file/{kind}/{day}",
                                               params={"offset": have}, timeout=REQUEST_TIMEOUT)
                    if resp.status_code == 404:
                        break
                    resp.raise_for_status()
                    data = resp.content
                    if not data or not data.endswith(b"\n"):
                        break         # nada nuevo, o una respuesta cortada: se vuelve a pedir en la vuelta siguiente
                    await asyncio.to_thread(self._append, path, have, data)
                    have += len(data)
                    got += len(data)
                touched += 1
        self.stats.update(last_ok=int(time.time() * 1000), last_error=None, last_bytes=got, last_files=touched,
                          last_seconds=round(time.time() - started, 1), pending=pending)
        self.stats["bytes"] += got
        return {"bytes": got, "files": touched, "pending": pending}

    @staticmethod
    def _append(path: Path, offset: int, data: bytes):
        """Agrega al final, solo si el archivo sigue del tamaño en que se pidió (si no, se pide otra vez)."""
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "ab") as fh:
            if fh.tell() != offset:
                raise RuntimeError(f"{path.name} cambió mientras se bajaba")
            fh.write(data)

    async def loop(self):
        await asyncio.sleep(FIRST_DELAY)
        while True:
            res = None
            try:
                res = await self.run_once()
                if res["bytes"]:
                    print(f"[SUITE] Hyperliquid de la nube: {res['bytes'] // 1024} KB en {res['files']} archivos"
                          + (", sigue en la próxima vuelta" if res["pending"] else ""))
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self.stats["last_error"] = f"{type(e).__name__}: {str(e)[:200]}"
                logger.warning(f"[HL_CLOUD] {self.stats['last_error']}")
            await asyncio.sleep(PENDING_PAUSE if res and res.get("pending") else INTERVAL)

    def start(self):
        if self.task is None:
            self.task = asyncio.create_task(self.loop())

    async def stop(self):
        if self.task is not None:
            self.task.cancel()
            self.task = None


_sync: Optional[HlCloudSync] = None


def start(data_dir: Path, url: str, http):
    global _sync
    if not enabled() or _sync is not None:
        return
    _sync = HlCloudSync(data_dir, url, http)
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

    @r.get("/api/hyperliquid/cloud")
    async def hl_cloud_status():
        return {"success": True, **brief()}

    return r
