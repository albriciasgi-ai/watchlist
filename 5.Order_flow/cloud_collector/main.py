# main.py - Cloud Footprint Collector para Northflank
#
# Servidor que recolecta footprints de Bybit 24/7 y los almacena en disco.
# Tu aplicacion local puede obtener el historico via API REST.

import asyncio
import json
import logging
import os
import time
import gzip
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Optional
from contextlib import asynccontextmanager

import shutil

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse, Response

from footprint_collector import FootprintCollector
from tape_recorder import TapeRecorder, DAY_RE
# Libro completo (13/11/2026): copias exactas de 12.AltagraciaTradingSuite/server/book_recorder.py y book_store.py
import book_recorder
import book_store

# Configuracion de logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

# Directorio de almacenamiento (volumen persistente en Northflank)
DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DATA_DIR.mkdir(parents=True, exist_ok=True)

# Simbolos a recolectar
SYMBOLS = os.environ.get("SYMBOLS", "BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,ADAUSDT").split(",")

# Intervalo de footprint (1 minuto por defecto)
INTERVAL = os.environ.get("INTERVAL", "1")

# Dias maximos a mantener los footprints (limpieza automatica). 0 = sin limite: se guarda todo
# el historico (lo que pidio el usuario el 2/11/2026 en la rama deploy de footprint-collector)
MAX_DAYS = int(os.environ.get("MAX_DAYS", "0"))

# Trades en el formato del almacen de App 1 (.tape): dias a conservar y cada cuanto se guardan
TAPE_KEEP_DAYS = int(os.environ.get("TAPE_KEEP_DAYS", "30"))
TAPE_SNAPSHOT_SECONDS = int(os.environ.get("TAPE_SNAPSHOT_SECONDS", "300"))

# Libro completo de Bybit (orderbook.full): el mismo grabador de la suite, para tapar los huecos del PC.
# BOOK=0 lo apaga. BOOK_SYMBOLS cambia las monedas (sin rehacer la imagen: basta reiniciar el servicio).
# Ocupa unos 10 MB por moneda y dia: se guardan BOOK_KEEP_DAYS dias (7: el volumen es de 6 GB), y si queda
# con menos de BOOK_MIN_FREE_MB libres se borran los dias mas viejos del libro (nunca los trades ni los footprints).
BOOK_ON = os.environ.get("BOOK", "1") != "0"
BOOK_SYMBOLS = [s.strip().upper() for s in os.environ.get("BOOK_SYMBOLS", ",".join(SYMBOLS)).split(",") if s.strip()]
BOOK_KEEP_DAYS = int(os.environ.get("BOOK_KEEP_DAYS", "7"))
BOOK_MIN_FREE_MB = int(os.environ.get("BOOK_MIN_FREE_MB", "150"))
BOOK_ROOT = book_store.root(DATA_DIR)

# Instancia del collector
collector: Optional[FootprintCollector] = None
tape: Optional[TapeRecorder] = None
book_http = None
_book_slots: List[float] = []


async def book_turn():
    """A lo sumo 5 pedidos REST por segundo para las fotos del libro."""
    while True:
        now = time.monotonic()
        while _book_slots and now - _book_slots[0] >= 1.0:
            _book_slots.pop(0)
        if len(_book_slots) < 5:
            _book_slots.append(now)
            return
        await asyncio.sleep(0.2)


def book_free_space() -> int:
    """Si el volumen queda con poco espacio, borra los dias mas viejos del libro (nunca el de hoy). Devuelve cuantos."""
    deleted = 0
    today = book_store.day_of(int(time.time() * 1000))
    for day, files in book_store.oldest_days(BOOK_ROOT):
        if shutil.disk_usage(DATA_DIR).free >= BOOK_MIN_FREE_MB * 1024 * 1024 or day >= today:
            break
        for f in files:
            try:
                f.unlink()
                deleted += 1
            except OSError:
                pass
    return deleted


async def book_guard():
    """Cada 10 minutos: dias viejos del libro y espacio libre."""
    while True:
        try:
            await asyncio.sleep(600)
            gone = await asyncio.to_thread(book_store.cleanup_days, BOOK_ROOT, BOOK_KEEP_DAYS, int(time.time() * 1000))
            gone += await asyncio.to_thread(book_free_space)
            if gone:
                logger.info(f"Libro: {gone} archivos viejos borrados")
            free_mb = shutil.disk_usage(DATA_DIR).free // (1024 * 1024)
            if free_mb < BOOK_MIN_FREE_MB and book_recorder.get_recorder() is not None:
                logger.error(f"Libro detenido: el volumen tiene {free_mb} MB libres y no hay dias viejos que borrar")
                await book_recorder.stop()
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Libro, limpieza: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gestiona el ciclo de vida de la aplicacion."""
    global collector, tape

    logger.info("=" * 60)
    logger.info("CLOUD FOOTPRINT COLLECTOR - Iniciando")
    logger.info(f"Simbolos: {SYMBOLS}")
    logger.info(f"Intervalo: {INTERVAL} minuto(s)")
    logger.info(f"Directorio datos: {DATA_DIR}")
    logger.info(f"Max dias a mantener: {MAX_DAYS}")
    logger.info("=" * 60)

    # Crear e iniciar el collector
    collector = FootprintCollector(
        symbols=SYMBOLS,
        interval=INTERVAL,
        data_dir=DATA_DIR,
        max_days=MAX_DAYS
    )

    # Grabador de trades (.tape). Si no puede leer las escalas de Bybit, el collector sigue sin el
    tape = TapeRecorder(SYMBOLS, DATA_DIR, keep_days=TAPE_KEEP_DAYS, snapshot_seconds=TAPE_SNAPSHOT_SECONDS)
    tape_task = None
    try:
        await asyncio.to_thread(tape.load_scales)
        tape.resume_today()
        collector.tape = tape
        tape_task = asyncio.create_task(tape.run())
        logger.info(f"Grabando trades en {tape.root} (cada {TAPE_SNAPSHOT_SECONDS} s, {TAPE_KEEP_DAYS} dias)")
    except Exception as e:
        logger.error(f"No se pudo iniciar el grabador de trades: {e}")
        tape = None

    # Iniciar recoleccion en background
    collector_task = asyncio.create_task(collector.start())

    # Iniciar limpieza periodica (cada 6 horas)
    cleanup_task = asyncio.create_task(periodic_cleanup())

    # Libro completo: si falla, el collector sigue con trades y footprints
    global book_http
    guard_task = None
    if BOOK_ON:
        try:
            import httpx
            book_http = httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=10.0),
                                          headers={"User-Agent": "footprint-collector-book/1.0"})
            await asyncio.to_thread(book_free_space)
            await book_recorder.start(BOOK_SYMBOLS, DATA_DIR, "https://api.bybit.com", book_http, book_turn)
            guard_task = asyncio.create_task(book_guard())
            logger.info(f"Libro completo: {len(BOOK_SYMBOLS)} monedas en {BOOK_ROOT} ({BOOK_KEEP_DAYS} dias)")
        except Exception as e:
            logger.error(f"No se pudo iniciar el libro: {e}")

    yield

    # Shutdown
    logger.info("Deteniendo collector...")
    if guard_task:
        guard_task.cancel()
    await book_recorder.stop()
    if book_http:
        await book_http.aclose()
    await collector.stop()
    if tape:
        if tape_task:
            tape_task.cancel()
        await tape.flush()
    collector_task.cancel()
    cleanup_task.cancel()
    logger.info("Collector detenido")


app = FastAPI(
    title="Cloud Footprint Collector",
    description="Recolecta y almacena footprints de Bybit 24/7",
    version="1.0.0",
    lifespan=lifespan
)

# CORS para permitir requests desde tu app local
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


async def periodic_cleanup():
    """Limpia archivos antiguos cada 6 horas."""
    while True:
        try:
            await asyncio.sleep(6 * 60 * 60)  # 6 horas
            if collector:
                deleted = collector.cleanup_old_files()
                if deleted > 0:
                    logger.info(f"Limpieza: {deleted} archivos antiguos eliminados")
            if tape:
                deleted = tape.cleanup()
                if deleted > 0:
                    logger.info(f"Limpieza: {deleted} dias de trades eliminados")
        except asyncio.CancelledError:
            break
        except Exception as e:
            logger.error(f"Error en limpieza: {e}")


@app.get("/")
async def root():
    """Informacion del servicio."""
    return {
        "service": "Cloud Footprint Collector",
        "status": "running",
        "symbols": SYMBOLS,
        "interval": INTERVAL,
        "data_dir": str(DATA_DIR)
    }


@app.get("/health")
async def health():
    """Health check para Northflank."""
    stats = await asyncio.to_thread(collector.get_stats) if collector else {}
    usage = shutil.disk_usage(DATA_DIR)
    return {
        "status": "healthy",
        "timestamp": int(time.time() * 1000),
        "collector_running": collector is not None and collector.running,
        "stats": stats,
        "tape": tape.get_stats() if tape else None,
        "book": book_recorder.brief(),
        "disk": {"total_mb": usage.total // (1024 * 1024), "free_mb": usage.free // (1024 * 1024)},
    }


# ---------- libro completo: estado, dias y bloques de minutos (los pide book_cloud.py de la suite) ----------
app.include_router(book_recorder.make_router())


@app.get("/api/book/days")
async def book_days(symbol: Optional[str] = None):
    """Dias del libro por moneda, con los minutos que tiene cada archivo (tramos [inicio, fin) en ms)."""
    def scan():
        out: Dict[str, dict] = {}
        if not BOOK_ROOT.exists():
            return out
        for sym_dir in sorted(p for p in BOOK_ROOT.iterdir() if p.is_dir()):
            if symbol and sym_dir.name != symbol.upper():
                continue
            for f in sorted(sym_dir.rglob("*.bk[sm]")):
                day, kind = f.stem.rsplit("_", 1)[-1], f.suffix[1:]
                out.setdefault(sym_dir.name, {}).setdefault(day, {})[kind] = {
                    "bytes": f.stat().st_size, "minutes": book_store.ranges(book_store.minutes_in(f))}
        return out
    return {"now": int(time.time() * 1000), "keep_days": BOOK_KEEP_DAYS, "symbols": await asyncio.to_thread(scan)}


@app.get("/api/book/{symbol}/{day}/{kind}")
async def book_blocks(symbol: str, day: str, kind: str, from_ms: int = 0, to_ms: int = 2 ** 62):
    """Bloques de un archivo del libro, tal cual, de los minutos en [from_ms, to_ms) (hasta 8 MB por pedido)."""
    symbol = symbol.upper()
    if not symbol.isalnum() or not DAY_RE.fullmatch(day) or kind not in ("bks", "bkm"):
        raise HTTPException(status_code=404, detail="Simbolo, dia o tipo invalido")
    path = book_store.day_path(BOOK_ROOT, symbol, day, kind)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No hay libro de {symbol} el {day}")
    data = await asyncio.to_thread(book_store.raw_blocks, path, from_ms, to_ms)
    return Response(content=data, media_type="application/octet-stream")


@app.get("/api/tape/days")
async def tape_days(symbol: Optional[str] = None):
    """
    Dias de trades grabados (.tape) por moneda, con su estado:
    complete = grabado desde el inicio del dia y sin huecos; gaps = tramos sin datos [inicio, fin] en ms.
    """
    if not tape:
        raise HTTPException(status_code=503, detail="Grabador de trades no iniciado")
    if symbol and symbol.upper() not in SYMBOLS:
        raise HTTPException(status_code=404, detail=f"Simbolo {symbol} no esta siendo recolectado")
    return await asyncio.to_thread(tape.list_days, symbol)


@app.get("/api/tape/{symbol}/{day}")
async def tape_file(symbol: str, day: str):
    """Archivo .tape de un dia (el dia en curso trae lo guardado hasta el ultimo guardado)."""
    symbol = symbol.upper()
    if not tape:
        raise HTTPException(status_code=503, detail="Grabador de trades no iniciado")
    if symbol not in SYMBOLS or not DAY_RE.fullmatch(day):
        raise HTTPException(status_code=404, detail="Simbolo o dia invalido")
    path = tape.path(symbol, day)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"No hay trades de {symbol} el {day}")
    return FileResponse(path, media_type="application/octet-stream", filename=path.name)


@app.get("/api/footprints/{symbol}")
async def get_footprints(
    symbol: str,
    hours: int = Query(default=12, ge=1, le=24*(MAX_DAYS or 3650), description="Horas de historico"),
    interval: str = Query(default="1", description="Intervalo de vela")
):
    """
    Obtiene footprints historicos para un simbolo.

    - **symbol**: Par de trading (ej: BTCUSDT)
    - **hours**: Horas de historico a obtener (default: 12)
    - **interval**: Intervalo de vela (default: 1)
    """
    symbol = symbol.upper()

    if symbol not in SYMBOLS:
        raise HTTPException(
            status_code=404,
            detail=f"Simbolo {symbol} no esta siendo recolectado. Disponibles: {SYMBOLS}"
        )

    if not collector:
        raise HTTPException(status_code=503, detail="Collector no inicializado")

    try:
        # En un hilo: leer varios dias de footprints no debe trabar el bucle (WebSocket y descargas)
        footprints = await asyncio.to_thread(collector.get_footprints, symbol, interval, hours)

        return {
            "symbol": symbol,
            "interval": interval,
            "hours_requested": hours,
            "count": len(footprints),
            "oldest": footprints[0]["candle_timestamp"] if footprints else None,
            "newest": footprints[-1]["candle_timestamp"] if footprints else None,
            "footprints": footprints
        }
    except Exception as e:
        logger.error(f"Error obteniendo footprints: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/footprints/{symbol}/latest")
async def get_latest_footprint(symbol: str):
    """Obtiene solo el footprint mas reciente."""
    symbol = symbol.upper()

    if not collector:
        raise HTTPException(status_code=503, detail="Collector no inicializado")

    footprints = await asyncio.to_thread(collector.get_footprints, symbol, INTERVAL, 1)

    if not footprints:
        return {"symbol": symbol, "footprint": None}

    return {
        "symbol": symbol,
        "footprint": footprints[-1]
    }


@app.get("/api/stats")
async def get_stats():
    """Estadisticas del collector."""
    if not collector:
        raise HTTPException(status_code=503, detail="Collector no inicializado")

    return await asyncio.to_thread(collector.get_stats)


@app.get("/api/symbols")
async def get_symbols():
    """Lista de simbolos siendo recolectados."""
    return {
        "symbols": SYMBOLS,
        "interval": INTERVAL
    }


@app.post("/api/flush")
async def flush_to_disk():
    """Fuerza guardado de datos en memoria a disco."""
    if not collector:
        raise HTTPException(status_code=503, detail="Collector no inicializado")

    await collector.flush_all_async()
    return {"status": "flushed", "timestamp": int(time.time() * 1000)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
