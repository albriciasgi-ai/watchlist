# footprint_reconstructor.py - Reconstruccion de footprints desde OHLCV
#
# Genera footprints estimados a partir de velas historicas cuando no hay
# datos de trades reales disponibles. Util para llenar el historico al
# iniciar el servicio.
#
# LIMITACION: Sin datos de trades reales, no podemos saber el bid/ask real.
# Usamos heuristicas basadas en la direccion de la vela:
# - Vela alcista (close > open): mas volumen en ask (compras)
# - Vela bajista (close < open): mas volumen en bid (ventas)
# - Distribucion proporcional al rango de precio de cada nivel

import asyncio
import logging
import time
import httpx
from typing import List, Dict, Optional, Tuple
from dataclasses import dataclass
from footprint_calculator import FootprintCalculator, get_default_step_size

logger = logging.getLogger(__name__)

# Bybit API
BYBIT_API_URL = "https://api.bybit.com"


@dataclass
class OHLCVCandle:
    """Representa una vela OHLCV."""
    timestamp: int  # ms
    open: float
    high: float
    low: float
    close: float
    volume: float


async def fetch_historical_candles(
    symbol: str,
    interval: str,
    hours: float = 12,
    limit: int = 1000
) -> List[OHLCVCandle]:
    """
    Obtiene velas historicas de Bybit.

    Args:
        symbol: Par de trading (ej: BTCUSDT)
        interval: Intervalo de vela (1, 5, 15, 60, etc)
        hours: Horas de historico a obtener
        limit: Maximo de velas por request

    Returns:
        Lista de velas ordenadas por timestamp ascendente
    """
    candles = []

    # Calcular timestamps
    now_ms = int(time.time() * 1000)
    start_ms = now_ms - int(hours * 60 * 60 * 1000)

    # Mapear intervalo a minutos
    interval_minutes = {
        "1": 1, "3": 3, "5": 5, "15": 15, "30": 30,
        "60": 60, "120": 120, "240": 240, "360": 360,
        "720": 720, "D": 1440, "W": 10080
    }

    minutes = interval_minutes.get(interval, 1)
    interval_ms = minutes * 60 * 1000

    # Cuantas velas necesitamos
    expected_candles = int((now_ms - start_ms) / interval_ms) + 1

    logger.info(
        f"[RECONSTRUCTOR] Fetching {expected_candles} candles for {symbol} @ {interval}m "
        f"(last {hours}h)"
    )

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            # Bybit usa paginacion hacia atras, empezamos desde ahora
            end_time = now_ms

            while len(candles) < expected_candles and end_time > start_ms:
                params = {
                    "category": "linear",
                    "symbol": symbol,
                    "interval": interval,
                    "end": end_time,
                    "limit": min(limit, 200)  # Bybit limit es 200 para klines
                }

                response = await client.get(
                    f"{BYBIT_API_URL}/v5/market/kline",
                    params=params
                )

                if response.status_code != 200:
                    logger.error(f"[RECONSTRUCTOR] API error: {response.status_code}")
                    break

                data = response.json()

                if data.get("retCode") != 0:
                    logger.error(f"[RECONSTRUCTOR] API error: {data.get('retMsg')}")
                    break

                klines = data.get("result", {}).get("list", [])

                if not klines:
                    break

                # Bybit retorna en orden descendente (mas reciente primero)
                for kline in klines:
                    ts = int(kline[0])

                    # Ignorar velas fuera del rango
                    if ts < start_ms:
                        continue
                    if ts >= now_ms:  # Ignorar vela en progreso
                        continue

                    candle = OHLCVCandle(
                        timestamp=ts,
                        open=float(kline[1]),
                        high=float(kline[2]),
                        low=float(kline[3]),
                        close=float(kline[4]),
                        volume=float(kline[5])
                    )
                    candles.append(candle)

                # Siguiente pagina: antes del timestamp mas antiguo obtenido
                if klines:
                    end_time = int(klines[-1][0]) - 1
                else:
                    break

                # Pequeno delay para no saturar API
                await asyncio.sleep(0.1)

        # Ordenar por timestamp ascendente
        candles.sort(key=lambda c: c.timestamp)

        logger.info(f"[RECONSTRUCTOR] Fetched {len(candles)} candles for {symbol}")
        return candles

    except Exception as e:
        logger.error(f"[RECONSTRUCTOR] Error fetching candles: {e}")
        return []


def estimate_footprint_from_candle(
    candle: OHLCVCandle,
    symbol: str,
    interval: str,
    step_size: float = None
) -> Dict:
    """
    Genera un footprint estimado a partir de una vela OHLCV.

    Heuristicas usadas:
    - Vela alcista: 60% ask, 40% bid
    - Vela bajista: 40% ask, 60% bid
    - Vela neutral: 50% ask, 50% bid
    - Volumen distribuido proporcionalmente al rango de cada nivel

    Args:
        candle: Vela OHLCV
        symbol: Simbolo
        interval: Intervalo
        step_size: Tamano del step (usa default si None)

    Returns:
        Diccionario con formato de footprint
    """
    if step_size is None:
        step_size = get_default_step_size(symbol)

    # Determinar direccion y proporcion bid/ask
    price_change = candle.close - candle.open

    if price_change > 0:  # Alcista
        ask_ratio = 0.60
        bid_ratio = 0.40
    elif price_change < 0:  # Bajista
        ask_ratio = 0.40
        bid_ratio = 0.60
    else:  # Neutral
        ask_ratio = 0.50
        bid_ratio = 0.50

    total_volume = candle.volume

    # Calcular niveles
    # Alinear precios al step size
    price_min_aligned = (candle.low // step_size) * step_size
    price_max_aligned = ((candle.high // step_size) + 1) * step_size

    # Crear niveles
    levels = []
    current_price = price_min_aligned
    num_levels = 0

    while current_price < price_max_aligned:
        level_min = current_price
        level_max = current_price + step_size
        level_mid = (level_min + level_max) / 2

        # Solo crear nivel si esta dentro del rango de la vela
        if level_max >= candle.low and level_min <= candle.high:
            num_levels += 1

        current_price += step_size

    if num_levels == 0:
        num_levels = 1

    # Volumen por nivel (distribucion uniforme por simplicidad)
    volume_per_level = total_volume / num_levels

    # Crear niveles con volumen
    current_price = price_min_aligned
    poc_volume = 0
    poc_index = 0

    while current_price < price_max_aligned:
        level_min = current_price
        level_max = current_price + step_size

        # Solo crear nivel si esta dentro del rango de la vela
        if level_max >= candle.low and level_min <= candle.high:
            level_mid = (level_min + level_max) / 2

            # Calcular bid/ask para este nivel
            level_ask = volume_per_level * ask_ratio
            level_bid = volume_per_level * bid_ratio
            level_delta = level_ask - level_bid
            level_total = level_ask + level_bid

            # POC: nivel con mas volumen (en este caso todos iguales, usamos el del medio)
            if level_total > poc_volume:
                poc_volume = level_total
                poc_index = len(levels)

            level = {
                "price_min": round(level_min, 2),
                "price_max": round(level_max, 2),
                "price_mid": round(level_mid, 2),
                "bid_volume": round(level_bid, 6),
                "ask_volume": round(level_ask, 6),
                "delta": round(level_delta, 6),
                "total_volume": round(level_total, 6),
                "trade_count": 0,  # No tenemos esta info
                "imbalance_ratio": None  # No calculamos imbalances en estimados
            }
            levels.append(level)

        current_price += step_size

    # Si no hay niveles, crear uno minimo
    if not levels:
        level_mid = (candle.low + candle.high) / 2
        levels.append({
            "price_min": round(candle.low, 2),
            "price_max": round(candle.high, 2),
            "price_mid": round(level_mid, 2),
            "bid_volume": round(total_volume * bid_ratio, 6),
            "ask_volume": round(total_volume * ask_ratio, 6),
            "delta": round(total_volume * (ask_ratio - bid_ratio), 6),
            "total_volume": round(total_volume, 6),
            "trade_count": 0,
            "imbalance_ratio": None
        })
        poc_index = 0

    # POC: usar el nivel mas cercano al precio de cierre
    for i, level in enumerate(levels):
        if level["price_min"] <= candle.close <= level["price_max"]:
            poc_index = i
            break

    # Construir footprint
    total_delta = total_volume * (ask_ratio - bid_ratio)

    footprint = {
        "candle_timestamp": candle.timestamp,
        "symbol": symbol,
        "interval": interval,
        "candle_open": candle.open,
        "candle_high": candle.high,
        "candle_low": candle.low,
        "candle_close": candle.close,
        "step_size": step_size,
        "levels": levels,
        "num_levels": len(levels),
        "poc_index": poc_index,
        "poc_price": levels[poc_index]["price_mid"] if levels else candle.close,
        "total_delta": round(total_delta, 6),
        "total_volume": round(total_volume, 6),
        "imbalances": [],  # No detectamos imbalances en estimados
        "estimated": True  # Marcar como estimado
    }

    return footprint


async def reconstruct_historical_footprints(
    symbol: str,
    interval: str,
    hours: float = 12,
    step_size: float = None,
    existing_timestamps: set = None
) -> List[Dict]:
    """
    Reconstruye footprints historicos para un simbolo.

    Args:
        symbol: Par de trading
        interval: Intervalo de vela
        hours: Horas de historico
        step_size: Step size para los niveles
        existing_timestamps: Set de timestamps que ya existen (para no duplicar)

    Returns:
        Lista de footprints estimados
    """
    if existing_timestamps is None:
        existing_timestamps = set()

    logger.info(
        f"[RECONSTRUCTOR] Reconstructing footprints for {symbol} @ {interval}m, "
        f"last {hours}h, {len(existing_timestamps)} already exist"
    )

    # Obtener velas historicas
    candles = await fetch_historical_candles(symbol, interval, hours)

    if not candles:
        logger.warning(f"[RECONSTRUCTOR] No candles fetched for {symbol}")
        return []

    # Generar footprints para velas que no existen
    footprints = []
    skipped = 0

    for candle in candles:
        if candle.timestamp in existing_timestamps:
            skipped += 1
            continue

        footprint = estimate_footprint_from_candle(
            candle, symbol, interval, step_size
        )
        footprints.append(footprint)

    logger.info(
        f"[RECONSTRUCTOR] Generated {len(footprints)} estimated footprints for {symbol} "
        f"(skipped {skipped} existing)"
    )

    return footprints
