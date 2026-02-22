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

from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from footprint_collector import FootprintCollector

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

# Dias maximos a mantener (limpieza automatica)
# 365 dias = ~2.5 GB para 21 simbolos a 1 min (cabe en volumen de 6 GB)
MAX_DAYS = int(os.environ.get("MAX_DAYS", "365"))

# Instancia del collector
collector: Optional[FootprintCollector] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Gestiona el ciclo de vida de la aplicacion."""
    global collector

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

    # Iniciar recoleccion en background
    collector_task = asyncio.create_task(collector.start())

    # Iniciar limpieza periodica (cada 6 horas)
    cleanup_task = asyncio.create_task(periodic_cleanup())

    yield

    # Shutdown
    logger.info("Deteniendo collector...")
    await collector.stop()
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
    stats = collector.get_stats() if collector else {}
    return {
        "status": "healthy",
        "timestamp": int(time.time() * 1000),
        "collector_running": collector is not None and collector.running,
        "stats": stats
    }


@app.get("/api/footprints/{symbol}")
async def get_footprints(
    symbol: str,
    hours: int = Query(default=12, ge=1, le=24*MAX_DAYS, description="Horas de historico"),
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
        footprints = collector.get_footprints(symbol, interval, hours)

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

    footprints = collector.get_footprints(symbol, INTERVAL, hours=1)

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

    return collector.get_stats()


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

    collector.flush_all()
    return {"status": "flushed", "timestamp": int(time.time() * 1000)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port)
