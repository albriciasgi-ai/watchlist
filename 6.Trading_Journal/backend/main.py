"""
Trading Journal - Main Server
Backend FastAPI para el sistema de journal de trading.

Puerto: 12000
"""

import os
import sys
import logging
from datetime import datetime
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Agregar el directorio actual al path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from store.journal_store import JournalStore
from api.routes import router, set_store, set_metrics_service
from services.position_monitor import PositionMonitor
from services.screenshot_service import ScreenshotService
from services.metrics_service import MetricsService

# ==================== Logging ====================

# Asegurar directorio de logs existe antes de configurar logging
os.makedirs("logs", exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('logs/journal.log', encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)

# ==================== Global Instances ====================

store = JournalStore(db_path="data/journal.db")
screenshot_service = ScreenshotService(screenshots_dir="screenshots")
metrics_service = MetricsService(store=store)
position_monitor: Optional[PositionMonitor] = None


# ==================== Screenshot Callback ====================

async def on_position_event(symbol: str, event_type: str, entry_id: str) -> Optional[str]:
    """Callback para capturas de pantalla cuando cambia una posición"""
    try:
        # Determinar source desde la entry
        entry = store.get(entry_id)
        source = entry.source.value if entry else "analizador"

        return await screenshot_service.capture(
            symbol=symbol,
            event_type=event_type,
            entry_id=entry_id,
            source=source
        )
    except Exception as e:
        logger.error(f"Screenshot callback error: {e}")
        return None


# ==================== Lifespan ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifecycle del servidor"""
    global position_monitor

    # Startup
    logger.info("=" * 60)
    logger.info("Trading Journal Backend starting...")
    logger.info(f"Database: data/journal.db")
    logger.info(f"Screenshots: screenshots/")
    logger.info("=" * 60)

    # Configurar store y metrics en routes
    set_store(store)
    set_metrics_service(metrics_service)

    # Asegurar directorios
    os.makedirs("screenshots", exist_ok=True)
    os.makedirs("logs", exist_ok=True)
    os.makedirs("data", exist_ok=True)

    # Inicializar servicios
    await screenshot_service.initialize()

    # Crear position monitor
    position_monitor = PositionMonitor(
        store=store,
        trading_bot_url="http://127.0.0.1:5000",
        poll_interval=5.0,
        screenshot_callback=on_position_event
    )
    # Iniciar monitor (ahora es no-bloqueante)
    await position_monitor.start()
    logger.info("Position monitor ENABLED")

    logger.info("All services started successfully")

    yield

    # Shutdown
    logger.info("Trading Journal Backend shutting down...")

    if position_monitor:
        await position_monitor.stop()

    await screenshot_service.shutdown()

    logger.info("Shutdown complete")


# ==================== FastAPI App ====================

app = FastAPI(
    title="Trading Journal API",
    description="Backend para el sistema de journal de trading",
    version="1.0.0",
    lifespan=lifespan
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Servir screenshots como archivos estaticos
os.makedirs("screenshots", exist_ok=True)
app.mount("/screenshots", StaticFiles(directory="screenshots"), name="screenshots")

# Incluir router principal
app.include_router(router, prefix="/api")


# ==================== Root Endpoint ====================

@app.get("/")
async def root():
    """Endpoint raiz"""
    return {
        "service": "Trading Journal",
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.utcnow().isoformat(),
        "endpoints": {
            "status": "/api/status",
            "entries": "/api/entries",
            "statistics": "/api/statistics",
            "monitor": "/api/monitor/status",
            "screenshots": "/api/screenshots/status",
            "docs": "/docs"
        }
    }


# ==================== Service Status Endpoints ====================

@app.get("/api/config")
async def get_config():
    """Configuracion del servicio"""
    return {
        "service": "Trading Journal",
        "version": "1.0.0",
        "database": "data/journal.db",
        "screenshots_dir": "screenshots/",
        "ports": {
            "trading_bot": 5000,
            "watchlist": 8000,
            "backtester": 9000,
            "analizador": 10000,
            "order_flow": 11000,
            "journal": 12000
        },
        "sources": ["watchlist", "analizador", "order_flow", "backtester", "manual"]
    }


@app.get("/api/health")
async def health_check():
    """Health check detallado"""
    # Verificar store
    store_ok = False
    entries_count = 0
    try:
        entries_count = store.count()
        store_ok = True
    except Exception as e:
        logger.error(f"Store health check failed: {e}")

    # Verificar directorios
    dirs_ok = all([
        os.path.exists("data"),
        os.path.exists("screenshots"),
        os.path.exists("logs")
    ])

    # Verificar servicios
    monitor_status = position_monitor.get_status() if position_monitor else {"running": False}
    screenshot_status = screenshot_service.get_status()

    return {
        "status": "healthy" if store_ok and dirs_ok else "unhealthy",
        "checks": {
            "database": {
                "status": "ok" if store_ok else "error",
                "entries_count": entries_count
            },
            "directories": {
                "status": "ok" if dirs_ok else "error",
                "data": os.path.exists("data"),
                "screenshots": os.path.exists("screenshots"),
                "logs": os.path.exists("logs")
            },
            "position_monitor": monitor_status,
            "screenshot_service": screenshot_status
        },
        "timestamp": datetime.utcnow().isoformat()
    }


# ==================== Position Monitor Endpoints ====================

@app.get("/api/monitor/status")
async def get_monitor_status():
    """Estado del position monitor"""
    if not position_monitor:
        return {"running": False, "error": "Monitor not initialized"}
    return position_monitor.get_status()


@app.post("/api/monitor/start")
async def start_monitor():
    """Inicia el position monitor"""
    if not position_monitor:
        return {"success": False, "error": "Monitor not initialized"}

    await position_monitor.start()
    return {"success": True, "status": position_monitor.get_status()}


@app.post("/api/monitor/stop")
async def stop_monitor():
    """Detiene el position monitor"""
    if not position_monitor:
        return {"success": False, "error": "Monitor not initialized"}

    await position_monitor.stop()
    return {"success": True, "status": position_monitor.get_status()}


@app.post("/api/monitor/sync")
async def force_sync():
    """Fuerza una sincronización inmediata"""
    if not position_monitor:
        return {"success": False, "error": "Monitor not initialized"}

    await position_monitor.force_sync()
    return {"success": True, "message": "Sync completed"}


@app.post("/api/monitor/reset")
async def reset_monitor():
    """Resetea el monitor: limpia tracking y hace sync fresco"""
    if not position_monitor:
        return {"success": False, "error": "Monitor not initialized"}

    # Limpiar tracking interno
    position_monitor._tracked_entries.clear()
    position_monitor._previous_positions.clear()

    # Recargar entries abiertas del store
    try:
        open_entries = store.get_open_entries()
        for entry in open_entries:
            position_monitor._tracked_entries[entry.symbol] = entry.id
    except Exception as e:
        pass

    # Hacer sync con TradingBot
    await position_monitor._sync_with_trading_bot()

    return {
        "success": True,
        "message": "Monitor reset completed",
        "status": position_monitor.get_status()
    }


@app.put("/api/monitor/config")
async def update_monitor_config(
    poll_interval: float = Query(default=5.0, ge=1.0, le=60.0),
    trading_bot_url: str = Query(default="http://localhost:5000")
):
    """Actualiza configuración del monitor"""
    if not position_monitor:
        return {"success": False, "error": "Monitor not initialized"}

    position_monitor.poll_interval = poll_interval
    position_monitor.trading_bot_url = trading_bot_url

    return {
        "success": True,
        "config": {
            "poll_interval": poll_interval,
            "trading_bot_url": trading_bot_url
        }
    }


# ==================== Screenshot Endpoints ====================

@app.get("/api/screenshots/status")
async def get_screenshot_status():
    """Estado del screenshot service"""
    return screenshot_service.get_status()


@app.post("/api/screenshots/capture")
async def capture_screenshot(
    symbol: str,
    event_type: str = "manual",
    entry_id: str = "manual",
    source: str = "analizador"
):
    """Captura un screenshot manualmente"""
    path = await screenshot_service.capture(
        symbol=symbol,
        event_type=event_type,
        entry_id=entry_id,
        source=source
    )

    if path:
        return {"success": True, "path": path}
    else:
        return {"success": False, "error": "Screenshot capture failed"}


@app.get("/api/screenshots/{entry_id}")
async def get_screenshots_for_entry(entry_id: str):
    """Obtiene screenshots de una entry"""
    screenshots = screenshot_service.get_screenshots_for_entry(entry_id)
    return {
        "success": True,
        "entry_id": entry_id,
        "screenshots": screenshots
    }


@app.delete("/api/screenshots/{entry_id}")
async def delete_screenshots_for_entry(entry_id: str):
    """Elimina screenshots de una entry"""
    deleted = screenshot_service.delete_screenshots_for_entry(entry_id)
    return {
        "success": True,
        "deleted_count": deleted
    }


# ==================== Main ====================

if __name__ == "__main__":
    import uvicorn

    print("\n" + "=" * 60)
    print("  TRADING JOURNAL - Backend")
    print("  Puerto: 12000")
    print("  Docs: http://localhost:12000/docs")
    print("=" * 60 + "\n")

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=12000,
        reload=True,
        log_level="info"
    )
