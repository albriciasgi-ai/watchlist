"""
Trading Journal - API Routes
Endpoints REST para el journal de trading.
"""

from fastapi import APIRouter, HTTPException, Query
from typing import Optional, List, Dict, Any
from pydantic import BaseModel
from datetime import datetime

from models.journal_entry import (
    JournalEntry,
    MarketContext,
    TradeSetup,
    ExecutionQuality,
    TradeReflection,
    TradeSource,
    TradeDirection,
    TradeStatus,
    PatternType
)
from store.journal_store import JournalStore

router = APIRouter()

# Store instance (se inicializa en main.py)
store: Optional[JournalStore] = None


def set_store(journal_store: JournalStore):
    """Configura el store a usar"""
    global store
    store = journal_store


# ==================== Pydantic Models ====================

class MarketContextInput(BaseModel):
    trend: str = "unknown"
    market_structure: str = "unknown"
    nearest_support: Optional[float] = None
    nearest_resistance: Optional[float] = None
    distance_to_support_pct: Optional[float] = None
    distance_to_resistance_pct: Optional[float] = None
    vwap_price: Optional[float] = None
    vwap_position: str = "unknown"
    rsi_value: Optional[float] = None
    volume_profile_poc: Optional[float] = None
    atr_value: Optional[float] = None
    atr_percent: Optional[float] = None
    bbw_percentile: Optional[float] = None
    session: str = "unknown"
    day_of_week: str = "unknown"
    hour_utc: int = 0


class TradeSetupInput(BaseModel):
    pattern_type: str = "custom"
    pattern_confidence: float = 0.0
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0
    risk_reward_ratio: float = 0.0
    risk_amount_usd: float = 0.0
    position_size: float = 0.0
    position_size_usd: float = 0.0
    timeframe: str = "1"
    key_level_entry: Optional[float] = None
    key_level_type: str = "unknown"
    setup_notes: str = ""


class ExecutionQualityInput(BaseModel):
    intended_entry: float = 0.0
    actual_entry: float = 0.0
    entry_slippage_pct: float = 0.0
    entry_timing: str = "unknown"
    exit_timing: str = "unknown"
    sl_moved: bool = False
    sl_moved_direction: str = "none"
    tp_moved: bool = False
    added_to_position: bool = False
    partial_close: bool = False
    fomo_entry: bool = False
    revenge_trade: bool = False
    overtrading: bool = False
    execution_score: int = 50


class TradeReflectionInput(BaseModel):
    what_went_well: str = ""
    what_went_wrong: str = ""
    lessons_learned: str = ""
    followed_plan: bool = True
    would_take_again: bool = True
    confidence_level: int = 5
    tags: List[str] = []
    ai_analysis: str = ""
    ai_suggestions: List[str] = []
    ai_pattern_detected: str = ""
    overall_rating: int = 3


class CreateEntryRequest(BaseModel):
    symbol: str
    direction: str = "long"
    source: str = "manual"
    source_alert_id: Optional[str] = None
    entry_time: str
    entry_price: float
    bybit_order_id: Optional[str] = None
    notes: str = ""
    market_context: Optional[MarketContextInput] = None
    setup: Optional[TradeSetupInput] = None
    execution: Optional[ExecutionQualityInput] = None


class UpdateEntryRequest(BaseModel):
    status: Optional[str] = None
    exit_time: Optional[str] = None
    exit_price: Optional[float] = None
    pnl_usd: Optional[float] = None
    entry_fee_usd: Optional[float] = None
    exit_fee_usd: Optional[float] = None
    screenshot_entry: Optional[str] = None
    screenshot_exit: Optional[str] = None
    notes: Optional[str] = None
    market_context: Optional[MarketContextInput] = None
    setup: Optional[TradeSetupInput] = None
    execution: Optional[ExecutionQualityInput] = None
    reflection: Optional[TradeReflectionInput] = None


class CloseEntryRequest(BaseModel):
    exit_price: float
    exit_time: Optional[str] = None
    status: str = "closed_manual"
    pnl_usd: float = 0.0
    exit_fee_usd: float = 0.0
    screenshot_exit: Optional[str] = None


class AlertReceivedRequest(BaseModel):
    source: str
    symbol: str
    direction: str
    pattern_type: Optional[str] = None
    price: Optional[float] = None
    raw_data: Optional[Dict[str, Any]] = None


# ==================== Health Check ====================

@router.get("/status")
async def get_status():
    """Estado del servidor"""
    return {
        "status": "ok",
        "service": "Trading Journal",
        "version": "1.0.0",
        "timestamp": datetime.utcnow().isoformat()
    }


# ==================== Journal Entries CRUD ====================

@router.post("/entries")
async def create_entry(request: CreateEntryRequest):
    """Crea una nueva entrada en el journal"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    try:
        # Convertir direction a enum
        direction = TradeDirection(request.direction.lower())
    except ValueError:
        direction = TradeDirection.LONG

    try:
        # Convertir source a enum
        source = TradeSource(request.source.lower())
    except ValueError:
        source = TradeSource.MANUAL

    # Crear la entrada
    entry = JournalEntry(
        symbol=request.symbol.upper(),
        direction=direction,
        source=source,
        source_alert_id=request.source_alert_id,
        entry_time=request.entry_time,
        entry_price=request.entry_price,
        bybit_order_id=request.bybit_order_id,
        notes=request.notes
    )

    # Aplicar sub-modelos si se proporcionan
    if request.market_context:
        entry.market_context = MarketContext(**request.market_context.model_dump())

    if request.setup:
        setup_data = request.setup.model_dump()
        try:
            setup_data['pattern_type'] = PatternType(setup_data['pattern_type'])
        except ValueError:
            setup_data['pattern_type'] = PatternType.CUSTOM
        entry.setup = TradeSetup(**setup_data)
        entry.setup.risk_reward_ratio = entry.setup.calculate_rr()

    if request.execution:
        entry.execution = ExecutionQuality(**request.execution.model_dump())
        entry.execution.entry_slippage_pct = entry.execution.calculate_slippage()

    # Guardar
    created = store.create(entry)

    return {
        "success": True,
        "entry": created.to_dict()
    }


@router.get("/entries")
async def list_entries(
    limit: int = Query(default=50, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    status: Optional[str] = None,
    symbol: Optional[str] = None,
    source: Optional[str] = None,
    direction: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    order_by: str = "entry_time",
    order_dir: str = "DESC"
):
    """Lista entries con filtros"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    # Convertir strings a enums
    status_enum = None
    if status:
        try:
            status_enum = TradeStatus(status)
        except ValueError:
            pass

    source_enum = None
    if source:
        try:
            source_enum = TradeSource(source)
        except ValueError:
            pass

    direction_enum = None
    if direction:
        try:
            direction_enum = TradeDirection(direction)
        except ValueError:
            pass

    entries = store.list_all(
        limit=limit,
        offset=offset,
        status=status_enum,
        symbol=symbol.upper() if symbol else None,
        source=source_enum,
        direction=direction_enum,
        start_date=start_date,
        end_date=end_date,
        order_by=order_by,
        order_dir=order_dir
    )

    total = store.count(status=status_enum, symbol=symbol, source=source_enum)

    return {
        "success": True,
        "entries": [e.to_dict() for e in entries],
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.get("/entries/open")
async def get_open_entries():
    """Obtiene todas las entradas abiertas"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    entries = store.get_open_entries()

    return {
        "success": True,
        "entries": [e.to_dict() for e in entries],
        "count": len(entries)
    }


@router.get("/entries/{entry_id}")
async def get_entry(entry_id: str):
    """Obtiene una entrada por ID"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    entry = store.get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    return {
        "success": True,
        "entry": entry.to_dict()
    }


@router.put("/entries/{entry_id}")
async def update_entry(entry_id: str, request: UpdateEntryRequest):
    """Actualiza una entrada existente"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    entry = store.get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    # Actualizar campos basicos
    if request.status:
        try:
            entry.status = TradeStatus(request.status)
        except ValueError:
            pass

    if request.exit_time is not None:
        entry.exit_time = request.exit_time

    if request.exit_price is not None:
        entry.exit_price = request.exit_price

    if request.pnl_usd is not None:
        entry.pnl_usd = request.pnl_usd
        entry.pnl_percent = entry.calculate_pnl_percent()
        entry.r_multiple = entry.calculate_r_multiple()

    if request.entry_fee_usd is not None:
        entry.entry_fee_usd = request.entry_fee_usd

    if request.exit_fee_usd is not None:
        entry.exit_fee_usd = request.exit_fee_usd

    entry.total_fees_usd = entry.entry_fee_usd + entry.exit_fee_usd

    if request.screenshot_entry is not None:
        entry.screenshot_entry = request.screenshot_entry

    if request.screenshot_exit is not None:
        entry.screenshot_exit = request.screenshot_exit

    if request.notes is not None:
        entry.notes = request.notes

    # Actualizar sub-modelos
    if request.market_context:
        entry.market_context = MarketContext(**request.market_context.model_dump())

    if request.setup:
        setup_data = request.setup.model_dump()
        try:
            setup_data['pattern_type'] = PatternType(setup_data['pattern_type'])
        except ValueError:
            setup_data['pattern_type'] = PatternType.CUSTOM
        entry.setup = TradeSetup(**setup_data)

    if request.execution:
        entry.execution = ExecutionQuality(**request.execution.model_dump())

    if request.reflection:
        entry.reflection = TradeReflection(**request.reflection.model_dump())

    # Recalcular duration si hay exit_time
    if entry.exit_time:
        entry.duration_minutes = entry.calculate_duration()

    # Guardar
    updated = store.update(entry)

    return {
        "success": True,
        "entry": updated.to_dict()
    }


@router.post("/entries/{entry_id}/close")
async def close_entry(entry_id: str, request: CloseEntryRequest):
    """Cierra una entrada (atajo para actualizar con datos de cierre)"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    entry = store.get(entry_id)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    if entry.status != TradeStatus.OPEN:
        raise HTTPException(status_code=400, detail="Entry is not open")

    # Convertir status
    try:
        status = TradeStatus(request.status)
    except ValueError:
        status = TradeStatus.CLOSED_MANUAL

    # Finalizar el trade
    exit_time = request.exit_time or datetime.utcnow().isoformat()
    entry.finalize(
        exit_price=request.exit_price,
        exit_time=exit_time,
        status=status,
        pnl_usd=request.pnl_usd
    )

    entry.exit_fee_usd = request.exit_fee_usd
    entry.total_fees_usd = entry.entry_fee_usd + entry.exit_fee_usd

    if request.screenshot_exit:
        entry.screenshot_exit = request.screenshot_exit

    # Guardar
    updated = store.update(entry)

    return {
        "success": True,
        "entry": updated.to_dict()
    }


@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str):
    """Elimina una entrada"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    deleted = store.delete(entry_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Entry not found")

    return {
        "success": True,
        "message": f"Entry {entry_id} deleted"
    }


# ==================== Statistics ====================

@router.get("/statistics")
async def get_statistics(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    symbol: Optional[str] = None
):
    """Obtiene estadisticas de trading"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    stats = store.get_statistics(
        start_date=start_date,
        end_date=end_date,
        symbol=symbol.upper() if symbol else None
    )

    return {
        "success": True,
        "statistics": stats,
        "filters": {
            "start_date": start_date,
            "end_date": end_date,
            "symbol": symbol
        }
    }


@router.get("/statistics/by-symbol")
async def get_statistics_by_symbol(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Obtiene estadisticas agrupadas por simbolo"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    # Obtener todos los simbolos unicos
    entries = store.list_all(start_date=start_date, end_date=end_date, limit=10000)
    symbols = list(set(e.symbol for e in entries))

    result = {}
    for symbol in symbols:
        result[symbol] = store.get_statistics(
            start_date=start_date,
            end_date=end_date,
            symbol=symbol
        )

    return {
        "success": True,
        "statistics_by_symbol": result
    }


@router.get("/statistics/by-source")
async def get_statistics_by_source(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Obtiene estadisticas agrupadas por source"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    result = {}
    for source in TradeSource:
        entries = store.list_all(
            start_date=start_date,
            end_date=end_date,
            source=source,
            limit=10000
        )
        if entries:
            result[source.value] = store.get_statistics(
                start_date=start_date,
                end_date=end_date
            )
            # Re-calcular solo con entries de ese source
            closed = [e for e in entries if e.status != TradeStatus.OPEN]
            if closed:
                winners = [e for e in closed if e.pnl_usd > 0]
                result[source.value]['total_trades'] = len(closed)
                result[source.value]['win_rate'] = round((len(winners) / len(closed)) * 100, 2)
                result[source.value]['total_pnl_usd'] = round(sum(e.pnl_usd for e in closed), 2)

    return {
        "success": True,
        "statistics_by_source": result
    }


# ==================== Alerts ====================

@router.post("/alerts/received")
async def log_received_alert(request: AlertReceivedRequest):
    """Registra una alerta recibida (para tracking de source)"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    alert_data = {
        "source": request.source,
        "symbol": request.symbol.upper(),
        "direction": request.direction,
        "pattern_type": request.pattern_type,
        "price": request.price,
        "raw_data": request.raw_data or {}
    }

    alert_id = store.save_received_alert(alert_data)

    return {
        "success": True,
        "alert_id": alert_id
    }


@router.get("/alerts/recent")
async def get_recent_alerts(
    minutes: int = Query(default=30, ge=1, le=1440),
    symbol: Optional[str] = None
):
    """Obtiene alertas recientes"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    alerts = store.get_recent_alerts(
        minutes=minutes,
        symbol=symbol.upper() if symbol else None
    )

    return {
        "success": True,
        "alerts": alerts,
        "count": len(alerts)
    }


# ==================== Export/Import ====================

@router.post("/export")
async def export_entries(
    filepath: str = Query(default="data/export.json"),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
):
    """Exporta entries a JSON"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    count = store.export_to_json(
        filepath=filepath,
        start_date=start_date,
        end_date=end_date
    )

    return {
        "success": True,
        "exported_count": count,
        "filepath": filepath
    }


@router.post("/import")
async def import_entries(filepath: str):
    """Importa entries desde JSON"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    try:
        count = store.import_from_json(filepath)
        return {
            "success": True,
            "imported_count": count
        }
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ==================== Advanced Metrics ====================

# Note: MetricsService se inicializa en main.py y se pasa aquí
metrics_service = None

def set_metrics_service(service):
    """Configura el metrics service"""
    global metrics_service
    metrics_service = service


@router.get("/metrics")
async def get_full_metrics(
    period: str = Query(default="all", description="day, week, month, year, all"),
    symbol: Optional[str] = None,
    initial_capital: float = Query(default=10000.0)
):
    """Obtiene métricas completas de rendimiento"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    result = metrics_service.get_metrics_by_period(period=period, symbol=symbol)
    return {
        "success": True,
        **result
    }


@router.get("/metrics/by-symbol")
async def get_metrics_by_symbol():
    """Obtiene métricas agrupadas por símbolo"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "metrics_by_symbol": metrics_service.get_metrics_by_symbol()
    }


@router.get("/metrics/by-source")
async def get_metrics_by_source():
    """Obtiene métricas agrupadas por fuente de señal"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "metrics_by_source": metrics_service.get_metrics_by_source()
    }


@router.get("/metrics/by-direction")
async def get_metrics_by_direction():
    """Obtiene métricas agrupadas por dirección (LONG/SHORT)"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "metrics_by_direction": metrics_service.get_metrics_by_direction()
    }


@router.get("/metrics/by-day")
async def get_metrics_by_day_of_week():
    """Obtiene métricas agrupadas por día de la semana"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "metrics_by_day": metrics_service.get_metrics_by_day_of_week()
    }


@router.get("/metrics/by-hour")
async def get_metrics_by_hour():
    """Obtiene métricas agrupadas por hora del día"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "metrics_by_hour": metrics_service.get_metrics_by_hour()
    }


@router.get("/metrics/equity-curve")
async def get_equity_curve(initial_capital: float = Query(default=10000.0)):
    """Obtiene datos para la curva de equity"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "initial_capital": initial_capital,
        "curve": metrics_service.get_equity_curve(initial_capital)
    }


@router.get("/metrics/monthly-returns")
async def get_monthly_returns():
    """Obtiene retornos mensuales para heatmap"""
    if not metrics_service:
        raise HTTPException(status_code=500, detail="Metrics service not initialized")

    return {
        "success": True,
        "monthly_returns": metrics_service.get_monthly_returns()
    }


# ==================== Admin Endpoints ====================

@router.delete("/admin/clear-open-entries")
async def clear_open_entries():
    """Elimina todas las entries abiertas (para reset/debug)"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    try:
        open_entries = store.get_open_entries()
        deleted_count = 0
        for entry in open_entries:
            store.delete(entry.id)
            deleted_count += 1

        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} open entries"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/admin/clear-all-entries")
async def clear_all_entries():
    """Elimina TODAS las entries (para reset completo)"""
    if not store:
        raise HTTPException(status_code=500, detail="Store not initialized")

    try:
        # Eliminar en batches hasta que no quede nada
        deleted_count = 0
        while True:
            entries = store.list_all(limit=100)
            if not entries:
                break
            for entry in entries:
                store.delete(entry.id)
                deleted_count += 1

        return {
            "success": True,
            "deleted_count": deleted_count,
            "message": f"Deleted {deleted_count} entries"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
