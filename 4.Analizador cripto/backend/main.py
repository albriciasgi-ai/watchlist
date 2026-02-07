# -*- coding: utf-8 -*- # v7 - logging with timestamps for all loggers
import logging
import sys

# Configure logging FIRST before any other imports
LOG_FORMAT = '%(asctime)s - %(name)s - %(levelname)s - %(message)s'
LOG_DATE_FORMAT = '%Y-%m-%d %H:%M:%S'

# Create a formatter
formatter = logging.Formatter(LOG_FORMAT, datefmt=LOG_DATE_FORMAT)

# Configure root logger
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Remove existing handlers and add our own
for handler in root_logger.handlers[:]:
    root_logger.removeHandler(handler)

# Add stdout handler with our format
stdout_handler = logging.StreamHandler(sys.stdout)
stdout_handler.setFormatter(formatter)
root_logger.addHandler(stdout_handler)

# Also configure uvicorn loggers specifically
for logger_name in ['uvicorn', 'uvicorn.error', 'uvicorn.access']:
    uvicorn_logger = logging.getLogger(logger_name)
    uvicorn_logger.handlers = []
    uvicorn_logger.addHandler(stdout_handler)

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import httpx
import asyncio
import time
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from dataclasses import asdict

# Real-time pattern detection imports
from config_store import get_config_store
from pattern_state_manager import get_pattern_state_manager, AlertRecord
from realtime_pattern_service import get_realtime_pattern_service

# Swing detector imports
from swing_service import get_swing_service

# VWAP service imports
from vwap_service import get_vwap_service

# S&R v2 detector imports
from sr_detector import get_sr_detector

# Zone Detector imports
from zone_detector import ZoneDetector, ZoneDetectionParams

# Zone realtime service imports
from zone_service import get_zone_service

app = FastAPI(
    title="Crypto Watchlist Backend",
    description="Servidor backend para la Watchlist de criptomonedas con Bybit Futures",
    version="2.5.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

COLOMBIA_TZ = timezone(timedelta(hours=-5))
CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(exist_ok=True)

# Cache reducido a 30 minutos para datos más frescos
CACHE_MAX_AGE = 1800  # 30 minutos en segundos

# Límites máximos de días por timeframe
MAX_DAYS_BY_INTERVAL = {
    "1": 7,       # 1 min -> max 7 dias
    "3": 21,      # 3 min -> max 21 dias
    "5": 400,     # 5 min -> max 400 dias (~115k velas) - con streaming SSE
    "15": 180,    # 15 min -> max 180 dias
    "30": 360,    # 30 min -> max 360 dias
    "60": 730,    # 1 hora -> max 730 dias (2 anios)
    "120": 730,   # 2 horas -> max 730 dias
    "240": 1095,  # 4 horas -> max 1095 dias (3 anios)
    "D": 2000,    # 1 dia -> max 2000 dias (~5.5 anios)
    "W": 1000,    # 1 semana -> max 1000 dias
}

def load_cache(symbol: str, interval: str, indicator: str):
    """Carga datos del cache si existen y son recientes"""
    cache_file = CACHE_DIR / f"{symbol}_{interval}_{indicator}.json"
    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                if 'timestamp' in data:
                    cache_age = time.time() - data['timestamp']
                    if cache_age < CACHE_MAX_AGE:
                        return data
                    else:
                        print(f"[CACHE EXPIRED] {symbol} {interval} {indicator} - {cache_age:.0f}s old")
        except Exception as e:
            print(f"[CACHE ERROR] {symbol} {interval} {indicator}: {str(e)}")
    return None

def save_cache(symbol: str, interval: str, indicator: str, data: dict):
    """Guarda datos en cache con timestamp"""
    data['timestamp'] = time.time()
    cache_file = CACHE_DIR / f"{symbol}_{interval}_{indicator}.json"
    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def calculate_volume_delta(candles_data):
    """Calcula Volume Delta y CVD a partir de datos de velas"""
    klines = []
    cvd = 0
    
    for candle in candles_data:
        open_price = candle['open']
        close_price = candle['close']
        volume = candle['volume']
        
        if close_price >= open_price:
            volume_delta = volume
        else:
            volume_delta = -volume
        
        cvd += volume_delta
        
        kline = {
            'timestamp': candle['timestamp'],
            'open': open_price,
            'high': candle['high'],
            'low': candle['low'],
            'close': close_price,
            'volume': volume,
            'volumeDelta': volume_delta,
            'cvd': cvd
        }
        klines.append(kline)
    
    return klines

@app.get("/api/status")
def status():
    now_utc = datetime.now(timezone.utc)
    now_colombia = now_utc.astimezone(COLOMBIA_TZ)

    cache_files = list(CACHE_DIR.glob("*_volumedelta.json"))

    return {
        "status": "ok",
        "time_utc": int(now_utc.timestamp()),
        "time_colombia": now_colombia.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "America/Bogota (UTC-5)",
        "cache_files": len(cache_files),
        "version": "2.5.0 - FIX: Volume Delta respeta límites por timeframe",
        "cache_duration": "30 minutos",
        "cache_max_age_seconds": CACHE_MAX_AGE,
        "max_days_limits": MAX_DAYS_BY_INTERVAL
    }


@app.get("/api/tickers")
async def get_tickers(symbols: str = None):
    """
    Obtiene precio actual y cambio 24h de multiples simbolos en una sola llamada.
    Mucho mas rapido que hacer multiples llamadas a historical.

    Parametros:
    - symbols: Lista de simbolos separados por coma (ej: BTCUSDT,ETHUSDT,SOLUSDT)
               Si no se provee, retorna todos los tickers disponibles.

    Retorna:
    - Lista de tickers con lastPrice, price24hPcnt, highPrice24h, lowPrice24h
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Bybit API: obtener todos los tickers de linear (futures perpetuos)
            url = "https://api.bybit.com/v5/market/tickers?category=linear"
            response = await client.get(url)
            data = response.json()

            if data.get("retCode") != 0:
                return {"success": False, "error": data.get("retMsg", "Unknown error")}

            tickers_list = data.get("result", {}).get("list", [])

            # Si se especificaron simbolos, filtrar
            if symbols:
                symbol_set = set(s.strip().upper() for s in symbols.split(","))
                tickers_list = [t for t in tickers_list if t.get("symbol") in symbol_set]

            # Formatear respuesta
            result = {}
            for ticker in tickers_list:
                symbol = ticker.get("symbol")
                result[symbol] = {
                    "lastPrice": float(ticker.get("lastPrice", 0)),
                    "price24hPcnt": float(ticker.get("price24hPcnt", 0)) * 100,  # Convertir a porcentaje
                    "highPrice24h": float(ticker.get("highPrice24h", 0)),
                    "lowPrice24h": float(ticker.get("lowPrice24h", 0)),
                    "volume24h": float(ticker.get("volume24h", 0)),
                    "turnover24h": float(ticker.get("turnover24h", 0)),
                }

            return {
                "success": True,
                "data": result,
                "count": len(result)
            }

    except Exception as e:
        print(f"[TICKERS ERROR] {str(e)}")
        return {"success": False, "error": str(e)}


INTERVAL_MAP = {
    "1": "1",
    "3": "3",
    "5": "5",
    "15": "15",
    "30": "30",
    "60": "60",
    "120": "120",
    "240": "240",
    "D": "D",
    "W": "W",
}

def get_interval_minutes(interval: str) -> int:
    if interval == "D":
        return 1440
    elif interval == "W":
        return 10080
    else:
        return int(interval)

@app.get("/api/historical/{symbol}")
async def get_historical(symbol: str, interval: str = "15", days: int = 30, since_timestamp: int = None):
    """
    Obtiene datos históricos de velas.

    Parámetros:
    - symbol: Par de trading (ej: BTCUSDT)
    - interval: Timeframe (1, 5, 15, 60, 240, D, W)
    - days: Días de histórico a obtener (si no se usa since_timestamp)
    - since_timestamp: (OPCIONAL) Timestamp en ms desde el cual obtener velas.
                       Si se provee, ignora 'days' y obtiene velas desde ese timestamp hasta ahora.
                       Útil para carga incremental (solo pedir datos nuevos).
    """
    try:
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "15")
        interval_minutes = get_interval_minutes(interval_final)

        now_ms = int(time.time() * 1000)
        # Buffer de 10 minutos al futuro
        end_ms = now_ms + (10 * 60 * 1000)

        # 🔄 CARGA INCREMENTAL: Si se provee since_timestamp, usar ese como inicio
        if since_timestamp is not None:
            start_ms = since_timestamp
            # Calcular cuántas velas necesitamos desde since_timestamp hasta ahora
            time_range_ms = now_ms - since_timestamp
            total_candles_needed = max(1, int(time_range_ms / (interval_minutes * 60 * 1000)) + 10)  # +10 de buffer
            days_to_fetch = None  # No aplica
            max_days_allowed = None
            print(f"[{symbol}] [DATA] HISTORICAL INCREMENTAL: desde {since_timestamp} (~{total_candles_needed} velas esperadas) @ {interval_final}")
        else:
            # Comportamiento original: usar days
            max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
            days_to_fetch = min(days, max_days_allowed)
            minutes_in_period = days_to_fetch * 24 * 60
            total_candles_needed = int(minutes_in_period / interval_minutes)
            start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)
            print(f"[{symbol}] [DATA] HISTORICAL: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

        # CRÍTICO: Limitar a 1000 velas por request (máximo de Bybit)
        limit_per_request = min(1000, total_candles_needed)

        all_candles = []
        current_start = start_ms
        
        async with httpx.AsyncClient(timeout=60) as client:
            request_count = 0
            max_requests = 120  # 120 requests x 1000 velas = 120,000 velas max (~416 dias en 5min)
            consecutive_errors = 0
            max_consecutive_errors = 3

            print(f"[{symbol}] [DATA] Necesita {total_candles_needed} velas, max_requests={max_requests}")

            while len(all_candles) < total_candles_needed and request_count < max_requests:
                request_count += 1
                candles_remaining = total_candles_needed - len(all_candles)
                fetch_limit = min(limit_per_request, candles_remaining)

                url = (
                    "https://api.bybit.com/v5/market/kline?"
                    f"category=linear&symbol={symbol}&interval={interval_final}"
                    f"&start={current_start}&limit={fetch_limit}"
                )

                try:
                    r = await client.get(url)
                    data = r.json()
                    consecutive_errors = 0  # Reset en exito
                except (httpx.ReadTimeout, httpx.ConnectTimeout, httpx.PoolTimeout) as te:
                    consecutive_errors += 1
                    print(f"[{symbol}] [DATA] Request #{request_count}: TIMEOUT ({type(te).__name__}) - error {consecutive_errors}/{max_consecutive_errors}")
                    if consecutive_errors >= max_consecutive_errors:
                        print(f"[{symbol}] [DATA] Demasiados errores consecutivos, usando {len(all_candles)} velas disponibles")
                        break
                    await asyncio.sleep(1)  # Esperar antes de reintentar
                    continue
                except Exception as e:
                    consecutive_errors += 1
                    print(f"[{symbol}] [DATA] Request #{request_count}: ERROR ({type(e).__name__}: {e}) - error {consecutive_errors}/{max_consecutive_errors}")
                    if consecutive_errors >= max_consecutive_errors:
                        print(f"[{symbol}] [DATA] Demasiados errores consecutivos, usando {len(all_candles)} velas disponibles")
                        break
                    await asyncio.sleep(1)
                    continue

                if data.get("retCode") != 0:
                    print(f"[ERROR {symbol}] Bybit error: {data.get('retMsg')}")
                    break

                batch_candles = data["result"]["list"]
                if not batch_candles:
                    print(f"[{symbol}] [DATA] Request #{request_count}: 0 velas (fin de datos)")
                    break

                batch_candles.reverse()
                all_candles.extend(batch_candles)

                if request_count <= 5 or request_count % 10 == 0:
                    print(f"[{symbol}] [DATA] Request #{request_count}: +{len(batch_candles)} velas (total: {len(all_candles)}/{total_candles_needed})")

                last_candle_ts = int(batch_candles[-1][0])
                current_start = last_candle_ts + (interval_minutes * 60 * 1000)

                if current_start >= end_ms:
                    print(f"[{symbol}] [DATA] Fin: alcanzado end_ms en request #{request_count}")
                    break

                # Si ya tenemos suficientes velas, salir
                if len(all_candles) >= total_candles_needed:
                    break

                await asyncio.sleep(0.1)

            print(f"[{symbol}] [DATA] Completado: {len(all_candles)} velas en {request_count} requests")

        candles = []
        current_time_utc = int(time.time() * 1000)
        
        for c in all_candles:
            ts_ms = int(c[0])
            
            open_ = float(c[1])
            high = float(c[2])
            low = float(c[3])
            close = float(c[4])
            volume = float(c[5])
            
            ts_seconds = ts_ms / 1000
            dt_utc = datetime.fromtimestamp(ts_seconds, tz=timezone.utc)
            dt_colombia = dt_utc.astimezone(COLOMBIA_TZ)
            
            time_diff_minutes = (current_time_utc - ts_ms) / (1000 * 60)
            is_in_progress = time_diff_minutes < interval_minutes
            
            candles.append({
                "timestamp": ts_ms,
                "open": open_,
                "high": high,
                "low": low,
                "close": close,
                "volume": volume,
                "in_progress": is_in_progress,
                "datetime_colombia": dt_colombia.strftime("%Y-%m-%d %H:%M:%S")
            })

        # CRÍTICO: Limitar resultado final al número exacto de velas solicitadas
        if len(candles) > total_candles_needed:
            candles = candles[-total_candles_needed:]

        now_colombia = datetime.now(COLOMBIA_TZ)

        # Información sobre el rango de datos retornado
        first_candle_ts = candles[0]["timestamp"] if candles else None
        last_candle_ts = candles[-1]["timestamp"] if candles else None

        print(f"[{symbol}] Historical: [OK] Devolviendo {len(candles)} velas (esperadas: {total_candles_needed})")

        return {
            "symbol": symbol,
            "interval": interval_final,
            "data": candles,
            "updated": int(time.time() * 1000),
            "updated_colombia": now_colombia.strftime("%Y-%m-%d %H:%M:%S"),
            "timezone": "America/Bogota (UTC-5)",
            "success": True,
            "total_candles": len(candles),
            "requested_candles": total_candles_needed,
            "days_requested": days if since_timestamp is None else None,
            "days_fetched": days_to_fetch,
            "max_days_allowed": max_days_allowed,
            # 🔄 Info para carga incremental
            "incremental": since_timestamp is not None,
            "since_timestamp": since_timestamp,
            "first_candle_timestamp": first_candle_ts,
            "last_candle_timestamp": last_candle_ts
        }

    except Exception as e:
        print(f"[ERROR {symbol}] {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "error": str(e),
            "success": False
        }


@app.get("/api/historical-stream/{symbol}")
async def get_historical_stream(symbol: str, interval: str = "15", days: int = 30):
    """
    Endpoint SSE para carga de datos historicos con progreso en tiempo real.
    Envia eventos de progreso mientras descarga velas de Bybit.
    """
    async def generate():
        try:
            interval_clean = (
                interval.replace("m", "")
                .replace("h", "")
                .replace("d", "D")
                .replace("w", "W")
            )
            if "h" in interval.lower() and interval_clean.isdigit():
                interval_clean = str(int(interval_clean) * 60)

            interval_final = INTERVAL_MAP.get(interval_clean, "15")
            interval_minutes = get_interval_minutes(interval_final)

            now_ms = int(time.time() * 1000)
            end_ms = now_ms + (10 * 60 * 1000)

            max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
            days_to_fetch = min(days, max_days_allowed)
            minutes_in_period = days_to_fetch * 24 * 60
            total_candles_needed = int(minutes_in_period / interval_minutes)
            start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)

            # Enviar info inicial
            yield f"data: {json.dumps({'type': 'start', 'total_expected': total_candles_needed, 'days': days_to_fetch})}\n\n"

            limit_per_request = min(1000, total_candles_needed)
            all_candles = []
            current_start = start_ms

            async with httpx.AsyncClient(timeout=60) as client:
                request_count = 0
                max_requests = 120  # 120 requests x 1000 = 120,000 velas max (~416 dias en 5min)
                consecutive_errors = 0
                max_consecutive_errors = 3

                while len(all_candles) < total_candles_needed and request_count < max_requests:
                    request_count += 1
                    candles_remaining = total_candles_needed - len(all_candles)
                    fetch_limit = min(limit_per_request, candles_remaining)

                    url = (
                        "https://api.bybit.com/v5/market/kline?"
                        f"category=linear&symbol={symbol}&interval={interval_final}"
                        f"&start={current_start}&limit={fetch_limit}"
                    )

                    try:
                        r = await client.get(url)
                        data = r.json()
                        consecutive_errors = 0
                    except Exception as e:
                        consecutive_errors += 1
                        if consecutive_errors >= max_consecutive_errors:
                            yield f"data: {json.dumps({'type': 'error', 'message': f'Demasiados errores: {str(e)}'})}\n\n"
                            break
                        await asyncio.sleep(1)
                        continue

                    if data.get("retCode") != 0:
                        yield f"data: {json.dumps({'type': 'error', 'message': data.get('retMsg', 'Error Bybit')})}\n\n"
                        break

                    batch_candles = data["result"]["list"]
                    if not batch_candles:
                        break

                    batch_candles.reverse()
                    all_candles.extend(batch_candles)

                    # Enviar progreso
                    progress_pct = min(100, int(len(all_candles) / total_candles_needed * 100))
                    yield f"data: {json.dumps({'type': 'progress', 'loaded': len(all_candles), 'total': total_candles_needed, 'percent': progress_pct, 'request': request_count})}\n\n"

                    last_candle_ts = int(batch_candles[-1][0])
                    current_start = last_candle_ts + (interval_minutes * 60 * 1000)

                    if current_start >= end_ms or len(all_candles) >= total_candles_needed:
                        break

                    await asyncio.sleep(0.05)  # Pequeña pausa para no saturar

            # Procesar velas
            candles = []
            current_time_utc = int(time.time() * 1000)

            for c in all_candles:
                ts_ms = int(c[0])
                candles.append({
                    "timestamp": ts_ms,
                    "open": float(c[1]),
                    "high": float(c[2]),
                    "low": float(c[3]),
                    "close": float(c[4]),
                    "volume": float(c[5]),
                    "in_progress": (current_time_utc - ts_ms) / (1000 * 60) < interval_minutes
                })

            if len(candles) > total_candles_needed:
                candles = candles[-total_candles_needed:]

            # Enviar datos finales
            yield f"data: {json.dumps({'type': 'complete', 'total_candles': len(candles), 'data': candles})}\n\n"

        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


@app.get("/api/volume-delta/{symbol}")
async def get_volume_delta(symbol: str, interval: str = "15", days: int = 30):
    """Endpoint para obtener Volume Delta con límites por timeframe"""
    try:
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )
        
        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)
        
        interval_final = INTERVAL_MAP.get(interval_clean, "15")
        
        # CRÍTICO: Aplicar límite máximo por timeframe (IGUAL QUE EN HISTORICAL)
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)
        
        print(f"[{symbol}] [UP] VOLUME DELTA: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")
        
        # CRÍTICO: Calcular cuántas velas necesitamos para days_to_fetch
        interval_minutes = get_interval_minutes(interval_final)
        minutes_in_period = days_to_fetch * 24 * 60
        expected_candles = int(minutes_in_period / interval_minutes)
        
        # Intentar cargar del cache
        cached_data = load_cache(symbol, interval_final, "volumedelta")
        
        if cached_data and cached_data.get("symbol") == symbol and cached_data.get("timeframe") == interval_final:
            klines = cached_data.get("klines", [])
            cache_age = time.time() - cached_data.get('timestamp', 0)
            
            if len(klines) > 0:
                print(f"[CACHE CHECK] {symbol} {interval_final} - Cache: {len(klines)} velas, Necesita: {expected_candles} velas, Age: {cache_age:.0f}s")
                
                # Si el cache tiene suficientes velas para days_to_fetch, usarlo
                if len(klines) >= expected_candles:
                    klines_to_return = klines[-expected_candles:]
                    
                    processed_data = []
                    for candle in klines_to_return:
                        processed_data.append({
                            "timestamp": candle["timestamp"],
                            "volumeDelta": candle.get("volumeDelta", 0),
                            "cvd": candle.get("cvd", 0),
                            "volume": candle["volume"]
                        })
                    
                    print(f"[CACHE HIT] [OK] {symbol} {interval_final} devolviendo {len(processed_data)} velas desde cache")
                    
                    return {
                        "symbol": symbol,
                        "interval": interval_final,
                        "indicator": "volumeDelta",
                        "data": processed_data,
                        "success": True,
                        "from_cache": True,
                        "cache_age_seconds": int(cache_age),
                        "total_points": len(processed_data),
                        "days_requested": days,
                        "days_fetched": days_to_fetch,
                        "max_days_allowed": max_days_allowed
                    }
                else:
                    print(f"[CACHE MISS] [ERROR] {symbol} {interval_final} - Cache insuficiente, recalculando...")
        
        # Recalcular - USAR days_to_fetch (limitado)
        print(f"[CALCULATING] {symbol} {interval_final} Volume Delta con {days_to_fetch} días")
        
        historical = await get_historical(symbol, interval_final, days_to_fetch)
        
        if not historical.get('success') or not historical.get('data'):
            print(f"[ERROR] No se pudieron obtener datos históricos para {symbol}")
            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "volumeDelta",
                "data": [],
                "success": False,
                "message": "No se pudieron obtener datos históricos"
            }
        
        candles_data = historical['data']
        print(f"[CALCULATING] Obtenidos {len(candles_data)} velas, calculando Volume Delta...")
        
        klines = calculate_volume_delta(candles_data)
        
        # Guardar en cache
        cache_data = {
            "symbol": symbol,
            "timeframe": interval_final,
            "klines": klines
        }
        save_cache(symbol, interval_final, "volumedelta", cache_data)
        print(f"[CACHE SAVED] {symbol} {interval_final} Volume Delta guardado ({len(klines)} velas)")
        
        processed_data = []
        for candle in klines:
            processed_data.append({
                "timestamp": candle["timestamp"],
                "volumeDelta": candle["volumeDelta"],
                "cvd": candle["cvd"],
                "volume": candle["volume"]
            })
        
        print(f"[SUCCESS] {symbol} {interval_final} Volume Delta: {len(processed_data)} puntos")
        
        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "volumeDelta",
            "data": processed_data,
            "success": True,
            "from_cache": False,
            "calculated": True,
            "total_points": len(processed_data),
            "days_requested": days,
            "days_fetched": days_to_fetch,
            "max_days_allowed": max_days_allowed
        }
        
    except Exception as e:
        print(f"[ERROR] Volume Delta {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "error": str(e),
            "success": False
        }

@app.post("/api/clear-cache")
async def clear_cache():
    """Endpoint para limpiar el cache manualmente"""
    try:
        cache_files = list(CACHE_DIR.glob("*.json"))
        deleted_count = 0
        
        for cache_file in cache_files:
            cache_file.unlink()
            deleted_count += 1
        
        return {
            "success": True,
            "message": f"Cache limpiado: {deleted_count} archivos eliminados",
            "deleted_files": deleted_count
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/api/upload-cache/{symbol}")
async def upload_cache(symbol: str, interval: str, data: dict):
    """Endpoint para subir datos al cache manualmente"""
    try:
        if "klines" not in data or "symbol" not in data or "timeframe" not in data:
            return {"success": False, "message": "Estructura inválida"}

        save_cache(symbol, interval, "volumedelta", data)

        return {
            "success": True,
            "message": f"Datos cargados para {symbol} {interval}",
            "candles": len(data["klines"])
        }

    except Exception as e:
        return {"success": False, "error": str(e)}


# ==================== REJECTION PATTERN ENDPOINTS ====================

from fastapi import Request
from rejection_detector import RejectionDetector, serialize_pattern
from alert_sender import send_pattern_alert

rejection_detector = RejectionDetector()


@app.post("/api/rejection-patterns/detect")
async def detect_rejection_patterns(request: Request):
    """
    Detects rejection patterns based on user configuration

    Body:
    {
      "symbol": "BTCUSDT",
      "interval": "4h",
      "days": 7,
      "config": { ... },  # Pattern configuration
      "referenceContexts": [ ... ]  # Reference contexts
    }
    """
    try:
        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '4h')
        days = body.get('days', 7)
        config = body.get('config', {})
        reference_contexts = body.get('referenceContexts', [])

        if not symbol:
            return {
                "success": False,
                "error": "Symbol is required"
            }

        print(f"[REJECTION PATTERNS] Detecting patterns for {symbol} {interval}")
        print(f"  - Active contexts: {len([c for c in reference_contexts if c.get('enabled', False)])}")

        # Get historical candles
        historical = await get_historical(symbol, interval, days)

        if not historical.get('success') or not historical.get('data'):
            return {
                "success": False,
                "error": "Could not fetch historical data"
            }

        candles = historical['data']

        # Detect patterns
        patterns = rejection_detector.detect_patterns(
            symbol,
            candles,
            config,
            reference_contexts
        )

        # Serialize patterns
        serialized_patterns = [serialize_pattern(p) for p in patterns]

        print(f"[REJECTION PATTERNS] [OK] Detected {len(patterns)} patterns for {symbol}")

        # Send alerts for high-confidence patterns
        if config.get('alertsEnabled', False):
            for pattern_data in serialized_patterns:
                if pattern_data['confidence'] >= config.get('filters', {}).get('minConfidence', 60):
                    await send_pattern_alert(
                        symbol,
                        interval,
                        pattern_data,
                        config
                    )

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "patterns": serialized_patterns,
            "totalPatterns": len(patterns),
            "activeContexts": len([c for c in reference_contexts if c.get('enabled', False)])
        }

    except Exception as e:
        print(f"[ERROR] Rejection patterns detection: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/rejection-patterns/available-contexts/{symbol}")
async def get_available_contexts(symbol: str, interval: str = "4h"):
    """
    Returns all available reference contexts for a symbol

    This is a placeholder implementation. In production, this would:
    1. Query active Volume Profiles from frontend state or cache
    2. Query fixed ranges from localStorage or database
    3. Query active ranges from Range Detector

    For now, we return a sample structure that the frontend can populate.
    """
    contexts = []

    # Note: This would need to integrate with your Volume Profile and Range Detector data
    # For now, returning empty to let frontend manage the contexts

    return {
        "success": True,
        "symbol": symbol,
        "interval": interval,
        "contexts": contexts,
        "message": "Frontend should populate contexts from active indicators"
    }


@app.post("/api/pattern-alert")
async def send_pattern_alert_endpoint(request: Request):
    """
    Receives a validated pattern from frontend and sends alert to port 5000
    Maintains EXACT format of existing test alerts

    Expected payload:
    {
        "symbol": "BTCUSDT",
        "interval": "4h",
        "pattern": {
            "patternType": "HAMMER",
            "price": 45000.50,
            "confidence": 85.5,
            "timestamp": 1234567890,
            "direction": "LONG"
        },
        "config": {
            "filters": {"minConfidence": 60},
            "alertsEnabled": true
        }
    }
    """
    import json
    from datetime import datetime

    print("\n" + "="*80)
    print("[BACKEND] PATTERN ALERT REQUEST RECEIVED")
    print("="*80)
    print(f"Timestamp: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")

    try:
        data = await request.json()

        print(f"\nSTEP 1: Parsing request payload")
        print(f"   Raw Payload Size: {len(json.dumps(data))} bytes")

        symbol = data.get('symbol')
        interval = data.get('interval')
        pattern = data.get('pattern')
        config = data.get('config', {})

        print(f"\nSTEP 2: Extracting fields")
        print(f"   Symbol: {symbol}")
        print(f"   Interval: {interval}")
        print(f"   Pattern Present: {pattern is not None}")
        print(f"   Config Present: {config is not None}")

        if not symbol or not pattern:
            print(f"\nSTEP 3: VALIDATION FAILED - Missing required fields")
            print(f"   Symbol provided: {symbol is not None}")
            print(f"   Pattern provided: {pattern is not None}")
            print("="*80 + "\n")
            return {
                "success": False,
                "error": "Missing required fields: symbol, pattern"
            }

        # Extract pattern details
        pattern_type = pattern.get('patternType', 'UNKNOWN')
        pattern_price = pattern.get('price', 0)
        pattern_confidence = pattern.get('confidence', 0)
        pattern_direction = pattern.get('direction', 'N/A')
        pattern_level = pattern.get('level', 'N/A')

        print(f"\nSTEP 3: Pattern Details")
        print(f"   Type: {pattern_type}")
        print(f"   Price: ${pattern_price:.2f}" if isinstance(pattern_price, (int, float)) else f"   Price: {pattern_price}")
        print(f"   Confidence: {pattern_confidence}%")
        print(f"   Direction: {pattern_direction}")
        print(f"   Level: {pattern_level}")

        # Validate minimum confidence
        min_confidence = config.get('filters', {}).get('minConfidence', 60)

        print(f"\nSTEP 4: Confidence Validation")
        print(f"   Pattern Confidence: {pattern_confidence}%")
        print(f"   Minimum Required: {min_confidence}%")

        if pattern_confidence < min_confidence:
            print(f"\nSTEP 5: CONFIDENCE CHECK FAILED")
            print(f"   Rejection Reason: Confidence too low")
            print(f"   Delta: {min_confidence - pattern_confidence:.1f}% below threshold")
            print("="*80 + "\n")
            return {
                "success": False,
                "reason": "confidence_too_low",
                "confidence": pattern_confidence,
                "required": min_confidence
            }

        print(f"   Confidence check PASSED ({pattern_confidence}% >= {min_confidence}%)")

        # Send alert using existing system
        print(f"\nSTEP 5: Sending alert to alert service (port 5000)")
        print(f"   Calling: send_pattern_alert()")
        print(f"   Symbol: {symbol}")
        print(f"   Interval: {interval}")
        print(f"   Pattern Type: {pattern_type}")

        success = await send_pattern_alert(symbol, interval, pattern, config)

        print(f"\nSTEP 6: Alert service response")
        print(f"   Success: {success}")

        if success:
            print(f"\nSTEP 7: Alert sent successfully!")
            print(f"   Pattern: {pattern_type}")
            print(f"   Symbol: {symbol}")
            print(f"   Price: ${pattern_price:.2f}" if isinstance(pattern_price, (int, float)) else f"   Price: {pattern_price}")
            print(f"   Confidence: {pattern_confidence}%")

            # STEP 8: Save alert to history
            print(f"\nSTEP 8: Saving alert to history")
            try:
                import uuid
                state_manager = get_pattern_state_manager()

                # Extract strategy data if present
                strategy = pattern.get('strategy', {})

                alert_record = AlertRecord(
                    id=str(uuid.uuid4()),
                    timestamp=int(time.time() * 1000),
                    symbol=symbol,
                    interval=interval or "unknown",
                    indicator='REJ',  # Rejection pattern
                    pattern_type=pattern_type,
                    direction=pattern_direction if pattern_direction != 'N/A' else ('LONG' if pattern_type in ['HAMMER', 'ENGULFING_BULLISH', 'DOJI_DRAGONFLY', 'DOUBLE_BOTTOM', 'SWING_LOW'] else 'SHORT'),
                    price=float(pattern_price) if isinstance(pattern_price, (int, float)) else 0,
                    confidence=float(pattern_confidence) if isinstance(pattern_confidence, (int, float)) else 0,
                    status='sent',
                    entry=strategy.get('entry'),
                    stop_loss=strategy.get('stopLoss'),
                    take_profit=strategy.get('takeProfit'),
                    outcome='PENDING'
                )

                state_manager.add_alert_record(alert_record)
                print(f"   Alert saved to history with ID: {alert_record.id}")
            except Exception as save_error:
                print(f"   [WARN] Failed to save alert to history: {save_error}")

            print("="*80 + "\n")

            return {
                "success": True,
                "pattern": pattern_type,
                "symbol": symbol,
                "price": pattern_price,
                "confidence": pattern_confidence
            }
        else:
            print(f"\n[WARN] STEP 7: Alert service returned failure")
            print(f"   Possible causes:")
            print(f"     - Alert listener not running on port 5000")
            print(f"     - Network connectivity issues")
            print(f"     - Alert service rejected the payload")
            print("="*80 + "\n")

            return {
                "success": False,
                "error": "Alert service failed to process alert",
                "pattern": pattern_type,
                "symbol": symbol
            }

    except Exception as e:
        print(f"\n[ERROR] STEP X: EXCEPTION OCCURRED")
        print(f"   Exception Type: {type(e).__name__}")
        print(f"   Exception Message: {str(e)}")
        print(f"\n[DEBUG] Stack Trace:")
        import traceback
        traceback.print_exc()
        print("="*80 + "\n")
        return {"success": False, "error": str(e)}



# ==================== DOUBLE TOP/BOTTOM ENDPOINTS ====================

from double_topbottom_detector import DoubleTopBottomDetector, serialize_pattern as serialize_double_pattern
from double_topbottom_detector_fixed import DoubleTopBottomDetectorFixed

# Instancias de ambos detectores
double_detector = DoubleTopBottomDetector()
double_detector_fixed = DoubleTopBottomDetectorFixed()


@app.post("/api/double-topbottom/detect")
async def detect_double_topbottom(request: Request):
    """
    Detects double top/bottom patterns

    Body:
    {
      "symbol": "BTCUSDT",
      "interval": "60",
      "days": 90,
      "config": {
        "doubleTopBottom": {
          "lookbackCandles": 50,
          "candlesPerExtreme": 5,
          "priceMarginPercent": 2.0,
          "minCandlesBetween": 5,
          "maxCandlesBetween": 50,
          "rejectionPatterns": {
            "hammer": true,
            "shootingStar": true,
            "bullishEngulfing": true,
            "bearishEngulfing": true
          },
          "volumeFilter": {
            "enabled": false,
            "zScoreThreshold": 1.5,
            "zScorePeriod": 20
          }
        },
        "momentumConfirmation": {
          "enabled": false,
          "patterns": {
            "marubozu": {"enabled": true, "minBodyRatio": 0.8},
            "soldiers_crows": {"enabled": true, "minBodyRatio": 0.6},
            "bigBody": {"enabled": true, "minBodyRatio": 0.7, "allowBigWick": true}
          },
          "lookbackAfterPattern": 10,
          "requireMomentum": false
        },
        "filters": {
          "minConfidence": 60,
          "requireBothRejections": true,
          "minPatternDuration": 3,
          "maxPatternDuration": 72
        }
      }
    }
    """
    try:
        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 90)
        config = body.get('config', {})

        if not symbol:
            return {
                "success": False,
                "error": "Symbol is required"
            }

        print(f"[DOUBLE TOP/BOTTOM] ===== REQUEST RECEIVED =====")
        print(f"[DOUBLE TOP/BOTTOM] Symbol: {symbol}, Interval: {interval}, Days: {days}")

        # Log configuration details
        filters = config.get('filters', {})
        dtb_config = config.get('doubleTopBottom', {})
        print(f"[DOUBLE TOP/BOTTOM] Config received:")
        print(f"  - minConfidence: {filters.get('minConfidence', 'NOT SET')}%")
        print(f"  - requireBothRejections: {filters.get('requireBothRejections', 'NOT SET')}")
        print(f"  - maxBreakoutPercent: {dtb_config.get('maxBreakoutPercent', 'NOT SET')}%")
        print(f"  - volumeFilter.enabled: {dtb_config.get('volumeFilter', {}).get('enabled', 'NOT SET')}")
        print(f"  - lookbackCandles: {dtb_config.get('lookbackCandles', 'NOT SET')}")

        # Get historical candles
        historical = await get_historical(symbol, interval, days)

        if not historical.get('success') or not historical.get('data'):
            return {
                "success": False,
                "error": "Could not fetch historical data"
            }

        candles = historical['data']
        print(f"[DOUBLE TOP/BOTTOM] Candles received: {len(candles)}")
        if candles:
            first_time = candles[0].get('timestamp')
            last_time = candles[-1].get('timestamp')
            import datetime
            first_date = datetime.datetime.fromtimestamp(first_time/1000).strftime('%Y-%m-%d %H:%M') if first_time else 'N/A'
            last_date = datetime.datetime.fromtimestamp(last_time/1000).strftime('%Y-%m-%d %H:%M') if last_time else 'N/A'
            print(f"[DOUBLE TOP/BOTTOM] Date range: {first_date} to {last_date}")

        # Select detector based on timeframe
        # Use fixed detector for short timeframes (1, 3, 5 minutes)
        if interval in ["1", "3", "5"]:
            print(f"[DOUBLE TOP/BOTTOM] Using FIXED detector for short timeframe ({interval} min)")
            detector_instance = double_detector_fixed
        else:
            print(f"[DOUBLE TOP/BOTTOM] Using ORIGINAL detector for timeframe ({interval})")
            detector_instance = double_detector

        # Detect patterns
        patterns = detector_instance.detect_patterns(
            symbol,
            candles,
            config,
            interval=interval,  # Pass interval to detector
            days=days  # Pass days to detector
        )

        # Serialize patterns
        serialized_patterns = [serialize_double_pattern(p) for p in patterns]

        print(f"[DOUBLE TOP/BOTTOM] ===== DETECTION COMPLETE =====")
        print(f"[DOUBLE TOP/BOTTOM] [OK] Detected {len(patterns)} patterns for {symbol}")

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "patterns": serialized_patterns,
            "totalPatterns": len(patterns)
        }

    except Exception as e:
        print(f"[ERROR] Double top/bottom detection: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


# ==================== SUPPORT & RESISTANCE ENDPOINTS ====================

def detect_pivots(candles: list, left_bars: int = 15, right_bars: int = 15,
                  z_scores: list = None, z_threshold: float = 1.5):
    """
    Detecta pivots (máximos y mínimos locales) con volumen significativo

    Args:
        candles: Lista de velas con formato {timestamp, open, high, low, close, volume}
        left_bars: Barras a la izquierda que deben ser menores
        right_bars: Barras a la derecha que deben ser menores
        z_scores: Lista de z-scores del volumen (si es None, acepta todos)
        z_threshold: Umbral de z-score para considerar volumen significativo

    Returns:
        Lista de pivots: {type, price, timestamp, volume, z_score, candle_index}
    """
    pivots = []

    # No podemos detectar pivots en los extremos
    for i in range(left_bars, len(candles) - right_bars):
        candle = candles[i]
        high = candle['high']
        low = candle['low']
        volume = candle['volume']

        # Verificar volumen significativo
        if z_scores and z_scores[i] < z_threshold:
            continue

        # Detectar pivot high (máximo local)
        is_pivot_high = True
        for j in range(i - left_bars, i):
            if candles[j]['high'] >= high:
                is_pivot_high = False
                break

        if is_pivot_high:
            for j in range(i + 1, i + right_bars + 1):
                if candles[j]['high'] >= high:
                    is_pivot_high = False
                    break

        if is_pivot_high:
            pivots.append({
                'type': 'pivot_high',  # [OK] FIX: Marcarlo como pivot_high, no como resistance aún
                'price': high,
                'timestamp': candle['timestamp'],
                'volume': volume,
                'z_score': z_scores[i] if z_scores else 0.0,
                'candle_index': i
            })

        # Detectar pivot low (mínimo local)
        is_pivot_low = True
        for j in range(i - left_bars, i):
            if candles[j]['low'] <= low:
                is_pivot_low = False
                break

        if is_pivot_low:
            for j in range(i + 1, i + right_bars + 1):
                if candles[j]['low'] <= low:
                    is_pivot_low = False
                    break

        if is_pivot_low:
            pivots.append({
                'type': 'pivot_low',  # [OK] FIX: Marcarlo como pivot_low, no como support aún
                'price': low,
                'timestamp': candle['timestamp'],
                'volume': volume,
                'z_score': z_scores[i] if z_scores else 0.0,
                'candle_index': i
            })

    return pivots


def cluster_levels(pivots: list, distance_pct: float = 0.5):
    """
    Agrupa pivots que están cercanos entre sí (clustering)

    Args:
        pivots: Lista de pivots detectados
        distance_pct: Distancia máxima en % para considerar niveles como iguales

    Returns:
        Lista de niveles agrupados con sus touches
    """
    if not pivots:
        return []

    # [OK] FIX: Separar pivot highs y pivot lows
    pivot_lows = [p for p in pivots if p['type'] == 'pivot_low']
    pivot_highs = [p for p in pivots if p['type'] == 'pivot_high']

    def cluster_group(group):
        if not group:
            return []

        # Ordenar por precio
        sorted_group = sorted(group, key=lambda x: x['price'])

        clusters = []
        current_cluster = [sorted_group[0]]

        for i in range(1, len(sorted_group)):
            pivot = sorted_group[i]
            cluster_avg_price = sum(p['price'] for p in current_cluster) / len(current_cluster)

            # Calcular distancia porcentual
            distance = abs(pivot['price'] - cluster_avg_price) / cluster_avg_price * 100

            if distance <= distance_pct:
                # Agregar a cluster actual
                current_cluster.append(pivot)
            else:
                # Crear nuevo cluster
                clusters.append(current_cluster)
                current_cluster = [pivot]

        # Agregar último cluster
        clusters.append(current_cluster)

        return clusters

    pivot_low_clusters = cluster_group(pivot_lows)
    pivot_high_clusters = cluster_group(pivot_highs)

    # Convertir clusters a niveles con metadata
    levels = []

    for cluster in pivot_low_clusters:
        avg_price = sum(p['price'] for p in cluster) / len(cluster)
        avg_volume = sum(p['volume'] for p in cluster) / len(cluster)
        avg_z_score = sum(p['z_score'] for p in cluster) / len(cluster)

        levels.append({
            'type': 'pivot_low',  # [OK] FIX: Mantener como pivot_low por ahora
            'price': avg_price,
            'touches': len(cluster),
            'touch_timestamps': [p['timestamp'] for p in cluster],
            'first_touch': min(p['timestamp'] for p in cluster),
            'last_touch': max(p['timestamp'] for p in cluster),
            'avg_volume': avg_volume,
            'avg_z_score': avg_z_score,
            'pivots': cluster
        })

    for cluster in pivot_high_clusters:
        avg_price = sum(p['price'] for p in cluster) / len(cluster)
        avg_volume = sum(p['volume'] for p in cluster) / len(cluster)
        avg_z_score = sum(p['z_score'] for p in cluster) / len(cluster)

        levels.append({
            'type': 'pivot_high',  # [OK] FIX: Mantener como pivot_high por ahora
            'price': avg_price,
            'touches': len(cluster),
            'touch_timestamps': [p['timestamp'] for p in cluster],
            'first_touch': min(p['timestamp'] for p in cluster),
            'last_touch': max(p['timestamp'] for p in cluster),
            'avg_volume': avg_volume,
            'avg_z_score': avg_z_score,
            'pivots': cluster
        })

    return levels


def reclassify_levels_by_price(levels: list, current_price: float):
    """
    [OK] FIX: Reclasifica los niveles como soporte o resistencia basándose en el precio actual

    Lógica:
    - pivot_high (máximo local):
        - Si precio actual < nivel → RESISTENCIA (precio está debajo, nivel resiste subidas)
        - Si precio actual > nivel → SOPORTE (nivel roto, ahora actúa como soporte)

    - pivot_low (mínimo local):
        - Si precio actual > nivel → SOPORTE (precio está arriba, nivel soporta caídas)
        - Si precio actual < nivel → RESISTENCIA (nivel roto, ahora actúa como resistencia)

    Args:
        levels: Lista de niveles con type='pivot_high' o 'pivot_low'
        current_price: Precio actual del activo

    Returns:
        Lista de niveles con type='support' o 'resistance' correctamente clasificados
    """
    for level in levels:
        level_price = level['price']
        pivot_type = level['type']

        # Reclasificar basándose en el precio actual
        if pivot_type == 'pivot_high':
            # Pivot high (máximo local)
            if current_price < level_price:
                level['type'] = 'resistance'  # Precio debajo = resistencia
            else:
                level['type'] = 'support'  # Precio arriba = soporte (nivel roto)

        elif pivot_type == 'pivot_low':
            # Pivot low (mínimo local)
            if current_price > level_price:
                level['type'] = 'support'  # Precio arriba = soporte
            else:
                level['type'] = 'resistance'  # Precio debajo = resistencia (nivel roto)

    return levels


def calculate_level_strength(level: dict, current_time_ms: int):
    """
    Calcula la fuerza de un nivel S/R

    Fórmula: Strength = (touches × avg_z_score × recency_factor) / time_spread

    Args:
        level: Diccionario con información del nivel
        current_time_ms: Timestamp actual en millisegundos

    Returns:
        Score de fuerza (0-10)
    """
    touches = level['touches']
    avg_z_score = level['avg_z_score']
    first_touch = level['first_touch']
    last_touch = level['last_touch']

    # Factor de recencia (más reciente = mejor)
    time_since_last_touch_days = (current_time_ms - last_touch) / (1000 * 60 * 60 * 24)
    recency_factor = max(0.1, 1.0 - (time_since_last_touch_days / 30))  # Decay over 30 days

    # Spread temporal (cuánto tiempo ha sido válido el nivel)
    time_spread_days = max(1, (last_touch - first_touch) / (1000 * 60 * 60 * 24))

    # Calcular strength raw
    strength_raw = (touches * avg_z_score * recency_factor) / max(1, time_spread_days)

    # Normalizar a escala 0-10
    # Asumimos que un strength_raw de 5+ es excelente
    strength = min(10.0, (strength_raw / 5.0) * 10.0)

    return round(strength, 2)


def detect_consolidation_zones(levels: list, min_levels: int = 3, max_distance_pct: float = 2.0):
    """
    Detecta zonas de consolidación (múltiples niveles S/R cercanos)

    Args:
        levels: Lista de niveles S/R
        min_levels: Mínimo de niveles para considerar una zona
        max_distance_pct: Distancia máxima en % entre el nivel más alto y más bajo

    Returns:
        Lista de zonas de consolidación
    """
    if len(levels) < min_levels:
        return []

    # Ordenar niveles por precio
    sorted_levels = sorted(levels, key=lambda x: x['price'])

    zones = []

    # Ventana deslizante para encontrar grupos de niveles cercanos
    for i in range(len(sorted_levels) - min_levels + 1):
        for j in range(i + min_levels - 1, len(sorted_levels)):
            window_levels = sorted_levels[i:j + 1]

            if len(window_levels) < min_levels:
                continue

            min_price = min(l['price'] for l in window_levels)
            max_price = max(l['price'] for l in window_levels)

            distance_pct = ((max_price - min_price) / min_price) * 100

            if distance_pct <= max_distance_pct:
                # Zona de consolidación encontrada
                avg_price = (min_price + max_price) / 2
                total_touches = sum(l['touches'] for l in window_levels)
                avg_strength = sum(l.get('strength', 0) for l in window_levels) / len(window_levels)

                zones.append({
                    'center_price': avg_price,
                    'min_price': min_price,
                    'max_price': max_price,
                    'range_pct': distance_pct,
                    'num_levels': len(window_levels),
                    'total_touches': total_touches,
                    'avg_strength': round(avg_strength, 2),
                    'levels': window_levels
                })

    # Eliminar zonas duplicadas/superpuestas (quedarse con las más fuertes)
    unique_zones = []
    for zone in sorted(zones, key=lambda x: x['avg_strength'], reverse=True):
        is_duplicate = False
        for existing_zone in unique_zones:
            # Verificar si hay superposición significativa
            if (zone['min_price'] <= existing_zone['max_price'] and
                zone['max_price'] >= existing_zone['min_price']):
                is_duplicate = True
                break

        if not is_duplicate:
            unique_zones.append(zone)

    return sorted(unique_zones, key=lambda x: x['center_price'])


def determine_level_status(level: dict, current_price: float, candles: list):
    """
    Determina el estado actual del nivel (active, broken, tested)

    Args:
        level: Nivel S/R
        current_price: Precio actual
        candles: Velas históricas para verificar si fue roto

    Returns:
        Estado: "active", "broken", "tested"
        break_volume: Z-score del volumen cuando fue roto (si aplica)
    """
    level_price = level['price']
    level_type = level['type']
    last_touch = level['last_touch']

    # Buscar si el nivel fue roto después del último touch
    break_volume = None
    was_broken = False

    for candle in candles:
        if candle['timestamp'] <= last_touch:
            continue

        # Verificar ruptura
        if level_type == 'resistance' and candle['close'] > level_price:
            was_broken = True
            break
        elif level_type == 'support' and candle['close'] < level_price:
            was_broken = True
            break

    # Determinar estado actual
    if was_broken:
        status = 'broken'
    elif level_type == 'resistance' and current_price < level_price:
        status = 'active'
    elif level_type == 'support' and current_price > level_price:
        status = 'active'
    else:
        status = 'tested'

    return status, break_volume


@app.get("/api/support-resistance/{symbol}")
async def get_support_resistance(
    symbol: str,
    interval: str = "15",
    days: int = 30,
    volume_method: str = "zscore",
    z_score_threshold: float = 1.5,
    z_score_period: int = 50,
    left_bars: int = 15,
    right_bars: int = 15,
    min_touches: int = 1,
    cluster_distance: float = 0.5,
    max_levels: int = 20
):
    """
    Endpoint para detectar niveles de Soporte y Resistencia con volumen significativo

    Parámetros:
        - symbol: Par a analizar (ej: BTCUSDT)
        - interval: Intervalo temporal (15, 60, 240, D, etc.)
        - days: Días históricos a analizar
        - volume_method: "zscore" o "simple"
        - z_score_threshold: Umbral de z-score para filtrar volumen (1.5 por defecto)
        - z_score_period: Período para calcular z-score (50 por defecto)
        - left_bars: Barras a la izquierda del pivot (15 por defecto)
        - right_bars: Barras a la derecha del pivot (15 por defecto)
        - min_touches: Mínimo de toques para considerar nivel válido (1 por defecto)
        - cluster_distance: Distancia en % para agrupar niveles (0.5 por defecto)
        - max_levels: Máximo de niveles a retornar (20 por defecto)
    """
    try:
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "15")

        print(f"[{symbol}] [DATA] SUPPORT/RESISTANCE: interval={interval_final}, days={days}, z_threshold={z_score_threshold}")

        # Intentar cargar del cache
        # [OK] FIX: Incluir 'days' en la cache key para evitar colisiones entre diferentes períodos
        cache_key = f"sr_{days}_{volume_method}_{z_score_threshold}_{z_score_period}_{left_bars}_{right_bars}_{min_touches}_{cluster_distance}"
        cached_data = load_cache(symbol, interval_final, cache_key)

        if cached_data and cached_data.get("symbol") == symbol:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] [OK] {symbol} {interval_final} S/R desde cache (age: {cache_age:.0f}s)")

            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "supportResistance",
                "data": cached_data.get("data", {}),
                "config": cached_data.get("config", {}),
                "success": True,
                "from_cache": True,
                "cache_age_seconds": int(cache_age)
            }

        # Obtener datos históricos
        historical = await get_historical(symbol, interval_final, days)

        if not historical.get('success') or not historical.get('data'):
            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "supportResistance",
                "data": {},
                "success": False,
                "error": "No se pudieron obtener datos históricos"
            }

        candles = historical['data']
        print(f"[{symbol}] Analizando {len(candles)} velas para S/R")

        # Calcular Z-Score del volumen
        volumes = [c['volume'] for c in candles]
        z_scores = None

        if volume_method == "zscore":
            z_scores = calculate_z_score(volumes, z_score_period)
            print(f"[{symbol}] Z-Scores calculados (period={z_score_period})")

        # Detectar pivots
        pivots = detect_pivots(candles, left_bars, right_bars, z_scores, z_score_threshold)
        print(f"[{symbol}] Pivots detectados: {len(pivots)}")

        # Agrupar niveles
        levels = cluster_levels(pivots, cluster_distance)
        print(f"[{symbol}] Niveles agrupados: {len(levels)}")

        # Filtrar por mínimo de touches
        levels = [l for l in levels if l['touches'] >= min_touches]
        print(f"[{symbol}] Niveles después de filtrar por min_touches: {len(levels)}")

        # [OK] FIX: Obtener precio actual ANTES de reclasificar
        current_time_ms = int(time.time() * 1000)
        current_price = candles[-1]['close']

        # [OK] FIX: Reclasificar niveles basándose en precio actual
        levels = reclassify_levels_by_price(levels, current_price)
        print(f"[{symbol}] [OK] Niveles reclasificados basándose en precio actual: ${current_price:.2f}")

        # Calcular strength para cada nivel

        for level in levels:
            level['strength'] = calculate_level_strength(level, current_time_ms)
            status, break_volume = determine_level_status(level, current_price, candles)
            level['status'] = status
            level['break_volume'] = break_volume

        # Ordenar por strength y limitar
        levels = sorted(levels, key=lambda x: x['strength'], reverse=True)[:max_levels]

        # Detectar zonas de consolidación
        consolidation_zones = detect_consolidation_zones(levels, min_levels=3, max_distance_pct=2.0)
        print(f"[{symbol}] Zonas de consolidación detectadas: {len(consolidation_zones)}")

        # Separar en soportes y resistencias
        resistances = [l for l in levels if l['type'] == 'resistance']
        supports = [l for l in levels if l['type'] == 'support']

        # Preparar respuesta
        response_data = {
            "resistances": [
                {
                    "price": r['price'],
                    "type": "resistance",
                    "strength": r['strength'],
                    "touches": r['touches'],
                    "avgVolume": r['avg_z_score'],
                    "firstTouch": r['first_touch'],
                    "lastTouch": r['last_touch'],
                    "status": r['status'],
                    "breakVolume": r['break_volume']
                }
                for r in resistances
            ],
            "supports": [
                {
                    "price": s['price'],
                    "type": "support",
                    "strength": s['strength'],
                    "touches": s['touches'],
                    "avgVolume": s['avg_z_score'],
                    "firstTouch": s['first_touch'],
                    "lastTouch": s['last_touch'],
                    "status": s['status'],
                    "breakVolume": s['break_volume']
                }
                for s in supports
            ],
            "consolidationZones": [
                {
                    "centerPrice": z['center_price'],
                    "minPrice": z['min_price'],
                    "maxPrice": z['max_price'],
                    "rangePct": z['range_pct'],
                    "numLevels": z['num_levels'],
                    "totalTouches": z['total_touches'],
                    "avgStrength": z['avg_strength']
                }
                for z in consolidation_zones
            ],
            "currentPrice": current_price,
            "volumeStats": {
                "method": volume_method,
                "zScoreThreshold": z_score_threshold if volume_method == "zscore" else None,
                "period": z_score_period if volume_method == "zscore" else None,
                "currentZScore": z_scores[-1] if z_scores else None
            }
        }

        config_used = {
            "volumeMethod": volume_method,
            "zScoreThreshold": z_score_threshold,
            "zScorePeriod": z_score_period,
            "leftBars": left_bars,
            "rightBars": right_bars,
            "minTouches": min_touches,
            "clusterDistance": cluster_distance,
            "maxLevels": max_levels
        }

        # Guardar en cache
        cache_data = {
            "symbol": symbol,
            "interval": interval_final,
            "data": response_data,
            "config": config_used
        }
        save_cache(symbol, interval_final, cache_key, cache_data)
        print(f"[CACHE SAVED] {symbol} {interval_final} S/R guardado")

        print(f"[SUCCESS] {symbol} {interval_final} S/R: {len(supports)} soportes, {len(resistances)} resistencias, {len(consolidation_zones)} zonas")

        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "supportResistance",
            "data": response_data,
            "config": config_used,
            "success": True,
            "from_cache": False
        }

    except Exception as e:
        print(f"[ERROR] Support/Resistance {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "supportResistance",
            "data": {},
            "success": False,
            "error": str(e)
        }


# ==================== REJECTION PATTERN ENDPOINTS ====================

from fastapi import Request
from rejection_detector import RejectionDetector, serialize_pattern
from alert_sender import send_pattern_alert

rejection_detector = RejectionDetector()
# ==================== PROXIMITY ALERTS ENDPOINTS ====================

def calculate_proximity_score(current_price: float, target_price: float, tolerance_pct: float = 1.0) -> dict:
    """
    Calcula el score de proximidad basado en la distancia al precio objetivo

    Args:
        current_price: Precio actual
        target_price: Precio objetivo
        tolerance_pct: Tolerancia en porcentaje (default 1.0%)

    Returns:
        dict con score (0-70), distance_pct, phase
    """
    distance_pct = abs(current_price - target_price) / target_price * 100

    # Definir zonas de proximidad (PRIORIZADO - hasta 70 puntos)
    if distance_pct <= 0.3:
        # Ultra Close
        score = 70
        phase = "active"
    elif distance_pct <= 0.5:
        # Close
        score = 55
        phase = "in_zone"
    elif distance_pct <= tolerance_pct:
        # Near (dentro de tolerancia)
        score = 40
        phase = "in_zone"
    elif distance_pct <= 2.0:
        # Approaching
        # Escala lineal de 40 a 25
        score = 40 - ((distance_pct - tolerance_pct) / (2.0 - tolerance_pct)) * 15
        phase = "approaching"
    else:
        # Far - escala descendente hasta 0
        score = max(0, 25 - (distance_pct - 2.0) * 2)
        phase = "idle"

    return {
        "score": round(score, 2),
        "distancePct": round(distance_pct, 4),
        "phase": phase
    }


def calculate_z_score(values: list, period: int = 50) -> list:
    """
    Calcula el z-score para una serie de valores usando una ventana móvil

    Args:
        values: Lista de valores numéricos
        period: Tamaño de la ventana para calcular media y desviación estándar

    Returns:
        Lista de z-scores (uno por cada valor)
    """
    import statistics

    z_scores = []

    for i in range(len(values)):
        # Usar ventana desde el inicio hasta el índice actual (máximo 'period' valores)
        start_idx = max(0, i - period + 1)
        window = values[start_idx:i + 1]

        if len(window) < 2:
            z_scores.append(0.0)
            continue

        # Calcular media y desviación estándar
        mean = statistics.mean(window)
        stdev = statistics.stdev(window)

        # Evitar división por cero
        if stdev == 0:
            z_scores.append(0.0)
        else:
            z_score = (values[i] - mean) / stdev
            z_scores.append(z_score)

    return z_scores


def calculate_volume_score(volumes: list, z_score_period: int = 50, threshold_zscore: float = 2.0) -> dict:
    """
    Calcula el score de volumen basado en z-score actual

    Args:
        volumes: Lista de volúmenes (últimas N velas)
        z_score_period: Período para calcular z-score
        threshold_zscore: Umbral de z-score configurado por usuario

    Returns:
        dict con score (0-30), current_zscore, trend
    """
    if len(volumes) < 2:
        return {
            "score": 0,
            "currentZScore": 0,
            "trend": "neutral"
        }

    # Calcular z-scores
    z_scores = calculate_z_score(volumes, z_score_period)
    current_zscore = z_scores[-1] if z_scores else 0

    # Calcular score basado en umbral (hasta 30 puntos)
    if current_zscore >= threshold_zscore:
        score = 30
    elif current_zscore >= threshold_zscore * 0.75:
        score = 22
    elif current_zscore >= threshold_zscore * 0.5:
        score = 15
    else:
        # Escala proporcional
        score = (current_zscore / (threshold_zscore * 0.5)) * 15
        score = max(0, min(15, score))

    # Detectar tendencia (últimas 3 velas)
    if len(z_scores) >= 3:
        recent_z = z_scores[-3:]
        if recent_z[-1] > recent_z[-2] > recent_z[-3]:
            trend = "increasing"
        elif recent_z[-1] < recent_z[-2] < recent_z[-3]:
            trend = "decreasing"
        else:
            trend = "neutral"
    else:
        trend = "neutral"

    return {
        "score": round(score, 2),
        "currentZScore": round(current_zscore, 2),
        "trend": trend
    }


@app.post("/api/proximity-alerts/calculate")
async def calculate_proximity_alert(request: Request):
    """
    Calcula el score de proximidad para una alerta específica

    Body:
    {
      "symbol": "BTCUSDT",
      "interval": "15",
      "targetPrice": 95000,
      "tolerancePct": 1.0,
      "volumeThresholdZScore": 2.0,
      "zScorePeriod": 50
    }

    Returns:
    {
      "success": true,
      "symbol": "BTCUSDT",
      "currentPrice": 95123.45,
      "targetPrice": 95000,
      "totalScore": 85,
      "proximityScore": 55,
      "volumeScore": 30,
      "phase": "in_zone",
      "distancePct": 0.13,
      "currentZScore": 2.5,
      "volumeTrend": "increasing"
    }
    """
    try:
        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '15')
        target_price = body.get('targetPrice')
        tolerance_pct = body.get('tolerancePct', 1.0)
        volume_threshold_zscore = body.get('volumeThresholdZScore', 2.0)
        z_score_period = body.get('zScorePeriod', 50)

        if not symbol or target_price is None:
            return {
                "success": False,
                "error": "symbol and targetPrice are required"
            }

        # Obtener datos históricos (últimos 2 días en 15min = 192 velas, suficiente para z-score)
        historical = await get_historical(symbol, interval, days=2)

        if not historical.get('success') or not historical.get('data'):
            return {
                "success": False,
                "error": "Could not fetch historical data"
            }

        candles = historical['data']
        current_price = candles[-1]['close']
        volumes = [c['volume'] for c in candles]

        # Calcular proximity score
        proximity_result = calculate_proximity_score(current_price, target_price, tolerance_pct)

        # Calcular volume score
        volume_result = calculate_volume_score(volumes, z_score_period, volume_threshold_zscore)

        # Score total
        total_score = proximity_result['score'] + volume_result['score']

        # Determinar fase final (puede upgradearse si volumen es muy alto)
        phase = proximity_result['phase']
        if total_score >= 75:
            phase = "active"
        elif total_score >= 50:
            if phase == "idle":
                phase = "approaching"

        return {
            "success": True,
            "symbol": symbol,
            "currentPrice": round(current_price, 2),
            "targetPrice": target_price,
            "totalScore": round(total_score, 2),
            "proximityScore": proximity_result['score'],
            "volumeScore": volume_result['score'],
            "phase": phase,
            "distancePct": proximity_result['distancePct'],
            "currentZScore": volume_result['currentZScore'],
            "volumeTrend": volume_result['trend'],
            "timestamp": int(time.time() * 1000)
        }

    except Exception as e:
        print(f"[ERROR] Proximity alert calculation: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/proximity-alerts/batch")
async def calculate_proximity_alerts_batch(request: Request):
    """
    Calcula scores para múltiples alertas en paralelo

    Body:
    {
      "alerts": [
        {
          "id": "uuid-1",
          "symbol": "BTCUSDT",
          "interval": "15",
          "targetPrice": 95000,
          "tolerancePct": 1.0,
          "volumeThresholdZScore": 2.0
        },
        ...
      ]
    }

    Returns:
    {
      "success": true,
      "results": [
        {
          "id": "uuid-1",
          "success": true,
          "totalScore": 85,
          ...
        },
        ...
      ]
    }
    """
    try:
        body = await request.json()
        alerts = body.get('alerts', [])

        if not alerts:
            return {
                "success": False,
                "error": "No alerts provided"
            }

        # Procesar todas las alertas
        results = []

        for alert_config in alerts:
            alert_id = alert_config.get('id')

            try:
                # Crear request simulado para reutilizar función
                class FakeRequest:
                    async def json(self):
                        return alert_config

                fake_req = FakeRequest()
                result = await calculate_proximity_alert(fake_req)

                result['id'] = alert_id
                results.append(result)

            except Exception as e:
                print(f"[ERROR] Processing alert {alert_id}: {str(e)}")
                results.append({
                    "id": alert_id,
                    "success": False,
                    "error": str(e)
                })

        return {
            "success": True,
            "results": results,
            "total": len(alerts),
            "timestamp": int(time.time() * 1000)
        }

    except Exception as e:
        print(f"[ERROR] Batch proximity alerts: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/open-interest/{symbol}")
async def get_open_interest(symbol: str, interval: str = "15", days: int = 30):
    """
    Endpoint para obtener Open Interest de Bybit Futures
    Calcula OI Flow Sentiment siguiendo el patrón LuxAlgo
    """
    try:
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "15")

        # Aplicar límite máximo por timeframe
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)

        print(f"[{symbol}] [DATA] OPEN INTEREST: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

        # Intentar cargar del cache
        cached_data = load_cache(symbol, interval_final, "openinterest")

        if cached_data and cached_data.get("symbol") == symbol and cached_data.get("interval") == interval_final:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] [OK] {symbol} {interval_final} Open Interest desde cache (age: {cache_age:.0f}s)")

            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "openInterest",
                "data": cached_data.get("data", []),
                "success": True,
                "from_cache": True,
                "cache_age_seconds": int(cache_age),
                "days_requested": days,
                "days_fetched": days_to_fetch,
                "max_days_allowed": max_days_allowed
            }

        # Bybit Open Interest usa intervalos específicos
        # Disponibles: 5min, 15min, 30min, 1h, 4h, 1d
        # NOTA: 2h NO está disponible, usar 1h en su lugar
        oi_interval_map = {
            "5": "5min",
            "15": "15min",
            "30": "30min",
            "60": "1h",
            "120": "1h",  # 2h no disponible, usar 1h
            "240": "4h",
            "D": "1d"
        }

        # Mapeo inverso: de Bybit interval a minutos
        oi_interval_to_minutes = {
            "5min": 5,
            "15min": 15,
            "30min": 30,
            "1h": 60,
            "4h": 240,
            "1d": 1440
        }

        oi_interval = oi_interval_map.get(interval_final, "15min")
        oi_interval_minutes = oi_interval_to_minutes.get(oi_interval, 15)

        # CRÍTICO: Calcular puntos necesarios basándose en el intervalo de OI, NO el de las velas
        # Porque podemos tener velas de 2h pero OI de 1h (el doble de puntos)
        minutes_in_period = days_to_fetch * 24 * 60
        total_points_needed = int(minutes_in_period / oi_interval_minutes)

        print(f"[OI CALCULATION] interval_final={interval_final} → oi_interval={oi_interval} ({oi_interval_minutes} min)")
        print(f"[OI CALCULATION] {days_to_fetch} días × 24h × 60min / {oi_interval_minutes} min = {total_points_needed} puntos necesarios")

        # Bybit devuelve máximo 200 puntos por request
        limit_per_request = 200

        # Calcular timestamps
        now_ms = int(time.time() * 1000)
        end_ms = now_ms + (10 * 60 * 1000)  # Buffer de 10 minutos al futuro
        start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)

        all_oi_data = []
        current_end = end_ms

        async with httpx.AsyncClient(timeout=30) as client:
            request_count = 0
            max_requests = 10

            # Hacer múltiples requests hasta obtener todos los datos necesarios
            while len(all_oi_data) < total_points_needed and request_count < max_requests:
                request_count += 1

                url = (
                    "https://api.bybit.com/v5/market/open-interest?"
                    f"category=linear&symbol={symbol}&intervalTime={oi_interval}"
                    f"&limit={limit_per_request}&endTime={current_end}"
                )

                # Convertir timestamp a fecha para debug
                end_date = datetime.fromtimestamp(current_end / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
                print(f"[BYBIT API] Request {request_count}/{max_requests}: endTime={current_end} ({end_date}) | {len(all_oi_data)}/{total_points_needed} puntos")
                r = await client.get(url)
                data = r.json()

                if data.get("retCode") != 0:
                    print(f"[ERROR {symbol}] Bybit OI error: {data.get('retMsg')}")
                    if request_count == 1:  # Solo error si es el primer request
                        return {
                            "symbol": symbol,
                            "interval": interval_final,
                            "indicator": "openInterest",
                            "data": [],
                            "success": False,
                            "error": data.get('retMsg', 'Unknown error')
                        }
                    break

                oi_batch = data["result"]["list"]

                if not oi_batch:
                    print(f"[INFO {symbol}] No más datos de OI disponibles en este request")
                    break

                # Log del batch recibido
                batch_oldest = datetime.fromtimestamp(int(oi_batch[-1]["timestamp"]) / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
                batch_newest = datetime.fromtimestamp(int(oi_batch[0]["timestamp"]) / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
                print(f"[BATCH] Recibidos {len(oi_batch)} puntos: {batch_oldest} → {batch_newest}")

                # oi_batch viene en orden descendente (más reciente primero)
                # Agregar al inicio de all_oi_data para mantener orden cronológico
                all_oi_data = oi_batch + all_oi_data

                # Actualizar current_end para el siguiente batch
                # El más antiguo de este batch es el último elemento
                oldest_item = oi_batch[-1]
                oldest_ts = int(oldest_item["timestamp"])

                # Si ya llegamos al inicio del periodo, salir
                if oldest_ts <= start_ms:
                    print(f"[INFO {symbol}] Alcanzamos el inicio del periodo solicitado")
                    break

                # Siguiente request debe terminar justo antes del más antiguo de este batch
                current_end = oldest_ts - 1

                # Si ya tenemos suficientes puntos, salir
                if len(all_oi_data) >= total_points_needed:
                    print(f"[INFO {symbol}] Tenemos suficientes puntos ({len(all_oi_data)}/{total_points_needed})")
                    break

                # Pequeña pausa entre requests
                await asyncio.sleep(0.1)

            if not all_oi_data:
                print(f"[ERROR {symbol}] No hay datos de Open Interest disponibles")
                return {
                    "symbol": symbol,
                    "interval": interval_final,
                    "indicator": "openInterest",
                    "data": [],
                    "success": False,
                    "error": "No Open Interest data available"
                }

            print(f"[INFO {symbol}] Total obtenido: {len(all_oi_data)} puntos en {request_count} requests")

            # IMPORTANTE: all_oi_data está en orden DESCENDENTE (más reciente primero)
            # porque Bybit devuelve descendente y agregamos al inicio
            # Necesitamos invertirlo a ASCENDENTE (más antiguo primero)
            all_oi_data.reverse()

            # Verificar orden
            if len(all_oi_data) >= 2:
                first_ts = int(all_oi_data[0]["timestamp"])
                last_ts = int(all_oi_data[-1]["timestamp"])
                print(f"[INFO {symbol}] Orden de datos: primer_ts={first_ts}, último_ts={last_ts}, orden_correcto={first_ts < last_ts}")

            # Procesar datos
            # all_oi_data ahora sí está en orden cronológico ascendente
            processed_data = []

            for item in all_oi_data:
                ts_ms = int(item["timestamp"])
                oi_value = float(item["openInterest"])

                # Convertir timestamp a datetime Colombia
                ts_seconds = ts_ms / 1000
                dt_utc = datetime.fromtimestamp(ts_seconds, tz=timezone.utc)
                dt_colombia = dt_utc.astimezone(COLOMBIA_TZ)

                processed_data.append({
                    "timestamp": ts_ms,
                    "openInterest": oi_value,
                    "datetime_colombia": dt_colombia.strftime("%Y-%m-%d %H:%M:%S")
                })

            # Guardar en cache
            cache_data = {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "openInterest",
                "data": processed_data
            }
            save_cache(symbol, interval_final, "openinterest", cache_data)
            print(f"[CACHE SAVED] {symbol} {interval_final} Open Interest guardado ({len(processed_data)} puntos)")

            print(f"[SUCCESS] {symbol} {interval_final} Open Interest: {len(processed_data)} puntos")

            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "openInterest",
                "data": processed_data,
                "success": True,
                "from_cache": False,
                "calculated": True,
                "total_points": len(processed_data),
                "days_requested": days,
                "days_fetched": days_to_fetch,
                "max_days_allowed": max_days_allowed,
                "api_requests_made": request_count
            }

    except Exception as e:
        print(f"[ERROR] Open Interest {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "openInterest",
            "data": [],
            "success": False,
            "error": str(e)
        }

@app.post("/api/clear-cache")


# ==================== ALERT TESTING ENDPOINT ====================

@app.post("/api/test-alert")
async def send_test_alert():
    """
    Sends a test alert to verify the alert system is working

    Returns:
        Success/failure status and connection info
    """
    try:
        from alert_sender import alert_sender
        import time

        # 📝 DEBUG LOG: Test alert initiated
        print("\n" + "="*80)
        print("[TEST ALERT] 🧪 Initiating test alert to trading bot...")
        print("="*80)

        # Create test pattern
        test_pattern = {
            "patternType": "HAMMER",
            "confidence": 85.5,
            "price": 45000.50,
            "timestamp": int(time.time() * 1000),
            "nearLevels": [],
            "metrics": {}
        }

        print(f"[TEST ALERT] Pattern Type: HAMMER (Bullish reversal)")
        print(f"[TEST ALERT] Symbol: BTCUSDT")
        print(f"[TEST ALERT] Price: $45,000.50")
        print(f"[TEST ALERT] Confidence: 85.5%")
        print(f"[TEST ALERT] Interval: 4h")
        print(f"[TEST ALERT] Target Endpoint: {alert_sender.alert_service_url}/api/watchlist-alert")
        print("-"*80)

        # Send test alert
        success = await alert_sender.send_rejection_pattern_alert(
            symbol="BTCUSDT",
            interval="4h",
            pattern=test_pattern,
            user_config=None
        )

        if success:
            print(f"[TEST ALERT] [OK] Test alert queued successfully")
            print(f"[TEST ALERT] [TIP] Check the alert_sender logs above for delivery status")
            print("="*80 + "\n")

            return {
                "success": True,
                "message": "Test alert sent successfully to /api/watchlist-alert",
                "endpoint": f"{alert_sender.alert_service_url}/api/watchlist-alert",
                "payload": {
                    "pattern": "Hammer (ABRIR LONG)",
                    "symbol": "BTCUSDT",
                    "price": 45000.50,
                    "confidence": 85.5
                },
                "note": "Check server logs for delivery confirmation"
            }
        else:
            print(f"[TEST ALERT] [ERROR] Failed to queue test alert")
            print("="*80 + "\n")

            return {
                "success": False,
                "message": "Failed to send test alert",
                "endpoint": f"{alert_sender.alert_service_url}/api/watchlist-alert"
            }

    except Exception as e:
        print(f"[TEST ALERT] [ERROR] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        print("="*80 + "\n")

        return {
            "success": False,
            "error": str(e),
            "message": "Error sending test alert"
        }


@app.post("/api/test-alert-batch")
async def send_test_alert_batch():
    """
    Sends multiple test alerts to simulate real trading scenario

    Returns:
        Success/failure status for each alert
    """
    try:
        from alert_sender import alert_sender
        import time
        import asyncio

        # Real trading data from user
        test_alerts = [
            {"symbol": "BTCUSDT", "price": 82500.0, "pattern": "HAMMER"},
            {"symbol": "ETHUSDT", "price": 2800.0, "pattern": "HAMMER"},
            {"symbol": "INJUSDT", "price": 12.46, "pattern": "ENGULFING_BULLISH"},
            {"symbol": "IOTAUSDT", "price": 0.1709, "pattern": "HAMMER"},
            {"symbol": "TRXUSDT", "price": 0.3385, "pattern": "DOJI_DRAGONFLY"},
            {"symbol": "UNIUSDT", "price": 8.012, "pattern": "HAMMER"},
            {"symbol": "XRPUSDT", "price": 2.956, "pattern": "ENGULFING_BULLISH"},
            {"symbol": "CAKEUSDT", "price": 2.785, "pattern": "HAMMER"},
            {"symbol": "POLUSDT", "price": 0.2258, "pattern": "HAMMER"},
            {"symbol": "HIFIUSDT", "price": 0.089, "pattern": "DOJI_DRAGONFLY"},
        ]

        results = []
        current_time = int(time.time() * 1000)
        errors = []

        # 📝 DEBUG LOG: Batch test initiated
        print("\n" + "="*80)
        print(f"[BATCH TEST] 🧪 Starting batch test: {len(test_alerts)} alerts")
        print("="*80)

        for i, alert_data in enumerate(test_alerts):
            try:
                # Create pattern for each alert
                test_pattern = {
                    "patternType": alert_data["pattern"],
                    "confidence": 75.0 + (i * 2),  # Varying confidence 75-93%
                    "price": alert_data["price"],
                    "timestamp": current_time + (i * 2000),  # 2 second intervals
                    "nearLevels": [],
                    "metrics": {}
                }

                print(f"\n[BATCH TEST] Alert {i+1}/{len(test_alerts)}")
                print(f"  Symbol: {alert_data['symbol']}")
                print(f"  Price: ${alert_data['price']}")
                print(f"  Pattern: {alert_data['pattern']}")
                print(f"  Confidence: {75.0 + (i * 2):.1f}%")

                # Send alert
                success = await alert_sender.send_rejection_pattern_alert(
                    symbol=alert_data["symbol"],
                    interval="4h",
                    pattern=test_pattern,
                    user_config=None
                )

                results.append({
                    "symbol": alert_data["symbol"],
                    "price": alert_data["price"],
                    "success": success
                })

                if not success:
                    errors.append(f"{alert_data['symbol']}: Failed to send")
                    print(f"[BATCH TEST] [WARNING] Failed to send alert for {alert_data['symbol']}")
                else:
                    print(f"[BATCH TEST] [OK] Alert sent for {alert_data['symbol']}")

                # Longer delay between alerts to give bot time to process (2s instead of 0.5s)
                await asyncio.sleep(2.0)

            except Exception as e:
                error_msg = f"{alert_data['symbol']}: {str(e)}"
                errors.append(error_msg)
                results.append({
                    "symbol": alert_data["symbol"],
                    "price": alert_data["price"],
                    "success": False,
                    "error": str(e)
                })
                print(f"[BATCH TEST] [ERROR] Exception for {alert_data['symbol']}: {str(e)}")

        successful = sum(1 for r in results if r.get("success", False))
        total = len(results)

        print(f"[BATCH TEST] Complete: {successful}/{total} alerts sent successfully")

        response_data = {
            "success": successful > 0,  # Success if at least one sent
            "message": f"Sent {successful}/{total} test alerts successfully",
            "endpoint": f"{alert_sender.alert_service_url}/api/watchlist-alert",
            "results": results,
            "total_sent": successful,
            "total_attempted": total,
            "errors": errors if errors else None
        }

        return response_data

    except Exception as e:
        print(f"[ERROR] Batch test alert failed: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e),
            "message": f"Error sending batch test alerts: {str(e)}",
            "total_sent": 0,
            "total_attempted": 0
        }


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    from alert_sender import initialize_alert_sender
    await initialize_alert_sender()
    print("[STARTUP] Backend started successfully")
    print("[STARTUP] Alert sender initialized")
    print("[STARTUP] Proximity alerts system ready")

    # Start swing detector service FIRST (it loads config with all symbols)
    swing_service = None
    try:
        swing_service = get_swing_service()
        # Get symbols from swing config - this is the master list
        swing_symbols = swing_service.config.symbols or ["BTCUSDT", "ETHUSDT"]
        swing_interval = swing_service.config.interval or "1"
        print(f"[STARTUP] Swing config loaded: {len(swing_symbols)} symbols, interval={swing_interval}m")
    except Exception as e:
        print(f"[STARTUP] Warning: Could not load swing config: {e}")
        swing_symbols = ["BTCUSDT", "ETHUSDT"]
        swing_interval = "1"

    # Start real-time pattern detection service with ALL symbols from swing config
    try:
        realtime_service = get_realtime_pattern_service()
        # Use swing symbols but start with 60m interval for realtime patterns
        # The swing service will add its own interval subscription
        intervals = ["60"]  # Realtime patterns use 1h, swing detector will add "1"
        await realtime_service.start(swing_symbols, intervals)
        print("[STARTUP] Real-time pattern detection service started")
        print(f"[STARTUP] Monitoring symbols: {swing_symbols}")
        print(f"[STARTUP] Initial interval: {intervals}")
    except Exception as e:
        print(f"[STARTUP] Warning: Could not start real-time service: {e}")
        print("[STARTUP] Real-time detection disabled - install websockets: pip install websockets>=12.0")

    # Now start swing detector service (WebSocket already running with all symbols)
    if swing_service and swing_service.config.enabled:
        try:
            await swing_service.start()
            print(f"[STARTUP] Swing detector service started - monitoring {len(swing_symbols)} symbols @ {swing_interval}m")
        except Exception as e:
            print(f"[STARTUP] Warning: Could not start swing service: {e}")

    # Start VWAP service
    try:
        from websocket_manager import get_websocket_manager
        ws_manager = get_websocket_manager()
        vwap_service = get_vwap_service()
        await vwap_service.start(ws_manager)
        print("[STARTUP] VWAP service started")
    except Exception as e:
        print(f"[STARTUP] Warning: Could not start VWAP service: {e}")

    # Start Zone Detector realtime service
    try:
        zone_service = get_zone_service()
        if zone_service.config.enabled:
            await zone_service.start()
            print(f"[STARTUP] Zone detector realtime service started - {len(zone_service.config.symbols)} symbols @ {zone_service.config.interval}m")
        else:
            print("[STARTUP] Zone detector realtime service disabled (enable from frontend)")
    except Exception as e:
        print(f"[STARTUP] Warning: Could not start zone realtime service: {e}")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    from alert_sender import shutdown_alert_sender
    await shutdown_alert_sender()

    # Stop real-time pattern detection service
    try:
        realtime_service = get_realtime_pattern_service()
        await realtime_service.stop()
        print("[SHUTDOWN] Real-time pattern detection service stopped")
    except Exception as e:
        print(f"[SHUTDOWN] Warning: Error stopping real-time service: {e}")

    # Stop swing detector service
    try:
        swing_service = get_swing_service()
        await swing_service.stop()
        print("[SHUTDOWN] Swing detector service stopped")
    except Exception as e:
        print(f"[SHUTDOWN] Warning: Error stopping swing service: {e}")

    # Stop VWAP service
    try:
        vwap_service = get_vwap_service()
        await vwap_service.stop()
        print("[SHUTDOWN] VWAP service stopped")
    except Exception as e:
        print(f"[SHUTDOWN] Warning: Error stopping VWAP service: {e}")

    # Stop Zone Detector realtime service
    try:
        zone_service = get_zone_service()
        await zone_service.stop()
        print("[SHUTDOWN] Zone detector realtime service stopped")
    except Exception as e:
        print(f"[SHUTDOWN] Warning: Error stopping zone realtime service: {e}")

    # Save config store
    try:
        config_store = get_config_store()
        config_store.save()
        print("[SHUTDOWN] Config store saved")
    except Exception as e:
        print(f"[SHUTDOWN] Warning: Error saving config store: {e}")

    print("[SHUTDOWN] Backend shutdown complete")


# ==================== VWAP ENDPOINTS ====================

from vwap_calculator import vwap_calculator


@app.get("/api/vwap/{symbol}")
async def get_vwap(
    symbol: str,
    interval: str = "60",
    days: int = 7,
    vwap_type: str = "session",
    reset_hour: int = 0,
    anchor_timestamp: Optional[int] = None,
    rolling_period: int = 20,
    band_multipliers: str = "1.0,2.0,3.0",
    apply_crypto_adjustment: bool = True
):
    """
    Calculate VWAP with standard deviation bands

    Args:
        symbol: Trading pair (e.g., BTCUSDT)
        interval: Candle interval (15, 60, 240, D)
        days: Historical data period
        vwap_type: Type of VWAP - 'session', 'anchored', or 'rolling'
        reset_hour: Hour (UTC) for session reset (default: 0 = midnight)
        anchor_timestamp: Timestamp (ms) for anchored VWAP (required if type='anchored')
        rolling_period: Period for rolling VWAP (default: 20)
        band_multipliers: Comma-separated multipliers (default: "1.0,2.0,3.0")
        apply_crypto_adjustment: Apply +15% volatility adjustment (default: True)

    Returns:
        VWAP data with bands for each candle
    """
    try:
        # Clean interval
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "60")

        # Apply max days limit
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)

        print(f"[{symbol}] [DATA] VWAP: type={vwap_type}, interval={interval_final}, days={days_to_fetch}")

        # Check cache
        cache_key = f"vwap_{vwap_type}_{days_to_fetch}_{reset_hour}_{anchor_timestamp}_{rolling_period}_{band_multipliers}"
        cached_data = load_cache(symbol, interval_final, cache_key)

        if cached_data and cached_data.get("symbol") == symbol:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] [OK] {symbol} {interval_final} VWAP desde cache (age: {cache_age:.0f}s)")

            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "vwap",
                "vwap_type": vwap_type,
                "data": cached_data.get("data", []),
                "success": True,
                "from_cache": True,
                "cache_age_seconds": int(cache_age)
            }

        # Get historical data
        historical = await get_historical(symbol, interval_final, days_to_fetch)

        if not historical.get('success') or not historical.get('data'):
            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "vwap",
                "data": [],
                "success": False,
                "error": "Could not fetch historical data"
            }

        candles = historical['data']
        print(f"[{symbol}] Calculating VWAP for {len(candles)} candles")

        # Parse band multipliers
        try:
            multipliers = [float(x.strip()) for x in band_multipliers.split(',')]
        except:
            multipliers = [1.0, 2.0, 3.0]

        # Build config
        config = {
            'reset_hour': reset_hour,
            'anchor_timestamp': anchor_timestamp,
            'rolling_period': rolling_period,
            'band_multipliers': multipliers,
            'apply_crypto_adjustment': apply_crypto_adjustment
        }

        # Calculate VWAP
        vwap_data = vwap_calculator.calculate_vwap_with_bands(
            candles,
            vwap_type,
            config
        )

        # Format response
        processed_data = []
        for point in vwap_data:
            processed_point = {
                'timestamp': point['timestamp'],
                'vwap': point['vwap'],
                'typical_price': point.get('typical_price'),
                'bands': point.get('bands', {})
            }

            # Add type-specific metadata
            if 'session_start' in point:
                processed_point['session_start'] = point['session_start']
            elif 'anchor_timestamp' in point:
                processed_point['anchor_timestamp'] = point['anchor_timestamp']
            elif 'window_size' in point:
                processed_point['window_size'] = point['window_size']

            processed_data.append(processed_point)

        # Save to cache
        cache_data = {
            "symbol": symbol,
            "interval": interval_final,
            "vwap_type": vwap_type,
            "data": processed_data
        }
        save_cache(symbol, interval_final, cache_key, cache_data)
        print(f"[CACHE SAVED] {symbol} {interval_final} VWAP guardado ({len(processed_data)} puntos)")

        print(f"[SUCCESS] {symbol} {interval_final} VWAP: {len(processed_data)} puntos")

        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "vwap",
            "vwap_type": vwap_type,
            "data": processed_data,
            "config": {
                "reset_hour": reset_hour,
                "anchor_timestamp": anchor_timestamp,
                "rolling_period": rolling_period,
                "band_multipliers": multipliers,
                "crypto_adjustment": apply_crypto_adjustment
            },
            "success": True,
            "from_cache": False,
            "total_points": len(processed_data)
        }

    except Exception as e:
        print(f"[ERROR] VWAP {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "vwap",
            "data": [],
            "success": False,
            "error": str(e)
        }


# ==================== FIBONACCI ENDPOINTS ====================

from fibonacci_calculator import fibonacci_calculator


@app.post("/api/fibonacci/calculate")
async def calculate_fibonacci(request: Request):
    """
    Calculate Fibonacci retracement and extension levels

    Body:
    {
      "symbol": "BTCUSDT",
      "interval": "60",
      "days": 30,
      "swing_high": null,  // Optional: manual swing high
      "swing_low": null,   // Optional: manual swing low
      "auto_detect": true,
      "lookback": 50,
      "include_extensions": false
    }

    Returns:
        Fibonacci levels with swing information
    """
    try:
        body = await request.json()

        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 30)
        swing_high = body.get('swing_high')
        swing_low = body.get('swing_low')
        auto_detect = body.get('auto_detect', True)
        lookback = body.get('lookback', 50)
        include_extensions = body.get('include_extensions', False)

        if not symbol:
            return {
                "success": False,
                "error": "symbol is required"
            }

        # Clean interval
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "60")

        # Apply max days limit
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)

        print(f"[{symbol}] [DATA] FIBONACCI: interval={interval_final}, days={days_to_fetch}, auto_detect={auto_detect}")

        # Check cache (only if auto-detect, manual swings shouldn't be cached)
        if auto_detect and swing_high is None and swing_low is None:
            cache_key = f"fibonacci_{days_to_fetch}_{lookback}_{include_extensions}"
            cached_data = load_cache(symbol, interval_final, cache_key)

            if cached_data and cached_data.get("symbol") == symbol:
                cache_age = time.time() - cached_data.get('timestamp', 0)
                print(f"[CACHE HIT] [OK] {symbol} {interval_final} Fibonacci desde cache (age: {cache_age:.0f}s)")

                return {
                    "symbol": symbol,
                    "interval": interval_final,
                    "indicator": "fibonacci",
                    "data": cached_data.get("data", {}),
                    "success": True,
                    "from_cache": True,
                    "cache_age_seconds": int(cache_age)
                }

        # Get historical data
        historical = await get_historical(symbol, interval_final, days_to_fetch)

        if not historical.get('success') or not historical.get('data'):
            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "fibonacci",
                "data": {},
                "success": False,
                "error": "Could not fetch historical data"
            }

        candles = historical['data']
        print(f"[{symbol}] Calculating Fibonacci for {len(candles)} candles")

        # Calculate Fibonacci levels
        fib_data = fibonacci_calculator.calculate_all_levels(
            candles,
            swing_high=swing_high,
            swing_low=swing_low,
            auto_detect=auto_detect,
            lookback=lookback,
            include_extensions=include_extensions
        )

        # Save to cache (only if auto-detected)
        if auto_detect and swing_high is None and swing_low is None:
            cache_key = f"fibonacci_{days_to_fetch}_{lookback}_{include_extensions}"
            cache_data = {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "fibonacci",
                "data": fib_data
            }
            save_cache(symbol, interval_final, cache_key, cache_data)
            print(f"[CACHE SAVED] {symbol} {interval_final} Fibonacci guardado")

        print(f"[SUCCESS] {symbol} {interval_final} Fibonacci: {len(fib_data.get('retracements', []))} retracements")

        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "fibonacci",
            "data": fib_data,
            "success": True,
            "from_cache": False,
            "config": {
                "lookback": lookback,
                "auto_detect": auto_detect,
                "include_extensions": include_extensions
            }
        }

    except Exception as e:
        print(f"[ERROR] Fibonacci {symbol if 'symbol' in locals() else 'unknown'}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol if 'symbol' in locals() else 'unknown',
            "interval": interval_final if 'interval_final' in locals() else 'unknown',
            "indicator": "fibonacci",
            "data": {},
            "success": False,
            "error": str(e)
        }


# ==================== PATTERN ANALYSIS ENDPOINTS ====================


@app.post("/api/patterns/analyze")
async def analyze_patterns(request: Request):
    """
    Analyze patterns with trend context and level sources

    Body:
    {
      "symbol": "BTCUSDT",
      "interval": "60",
      "days": 30,
      "include_vwap": true,
      "include_fibonacci": false,
      "vwap_config": {...},
      "fibonacci_config": {...}
    }

    Returns:
        Complete pattern analysis with trend context
    """
    try:
        # Import pattern detection modules
        from trend_analyzer import trend_analyzer
        from pattern_detector_extended import pattern_detector_extended

        body = await request.json()

        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 30)
        include_vwap = body.get('include_vwap', True)
        include_fibonacci = body.get('include_fibonacci', False)
        vwap_config = body.get('vwap_config', {})
        fibonacci_config = body.get('fibonacci_config', {})

        if not symbol:
            return {
                "success": False,
                "error": "symbol is required"
            }

        # Clean interval
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "60")

        # Apply max days limit
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)

        print(f"[{symbol}] [SEARCH] PATTERN ANALYSIS: interval={interval_final}, days={days_to_fetch}")

        # Get historical data
        historical = await get_historical(symbol, interval_final, days_to_fetch)

        if not historical.get('success') or not historical.get('data'):
            return {
                "symbol": symbol,
                "interval": interval_final,
                "data": {},
                "success": False,
                "error": "Could not fetch historical data"
            }

        candles = historical['data']
        print(f"[{symbol}] Analyzing {len(candles)} candles for patterns")

        # Step 1: Analyze trend
        print(f"[{symbol}] Step 1: Analyzing trend...")
        trend_analysis = trend_analyzer.analyze_trend(candles, lookback=100)
        trend_summary = trend_analyzer.get_trend_summary(trend_analysis)

        print(f"[{symbol}] Trend: {trend_summary['direction']} (strength: {trend_summary['strength']})")

        # Step 2: Collect level sources
        vwap_levels = None
        fibonacci_levels = None

        if include_vwap:
            print(f"[{symbol}] Step 2a: Fetching VWAP levels...")
            # Import vwap_calculator at function level (already imported globally)
            from vwap_calculator import vwap_calculator

            vwap_type = vwap_config.get('vwap_type', 'session')
            vwap_result = vwap_calculator.calculate_vwap_with_bands(
                candles,
                vwap_type=vwap_type,
                config=vwap_config
            )

            # Convert VWAP data to levels format
            if vwap_result and len(vwap_result) > 0:
                last_vwap = vwap_result[-1]
                vwap_levels = [
                    {'price': last_vwap['vwap'], 'type': 'vwap', 'strength': 90}
                ]

                # Add band levels
                if last_vwap.get('bands'):
                    for band_key, band_price in last_vwap['bands'].items():
                        strength = 70 if '1' in band_key else 85 if '2' in band_key else 95
                        vwap_levels.append({
                            'price': band_price,
                            'type': f'vwap_{band_key}',
                            'strength': strength
                        })

                print(f"[{symbol}] VWAP levels: {len(vwap_levels)}")

        if include_fibonacci:
            print(f"[{symbol}] Step 2b: Fetching Fibonacci levels...")
            from fibonacci_calculator import fibonacci_calculator

            auto_detect = fibonacci_config.get('auto_detect', True)
            lookback = fibonacci_config.get('lookback', 50)
            include_extensions = fibonacci_config.get('include_extensions', False)

            fib_result = fibonacci_calculator.calculate_all_levels(
                candles,
                swing_high=fibonacci_config.get('swing_high'),
                swing_low=fibonacci_config.get('swing_low'),
                auto_detect=auto_detect,
                lookback=lookback,
                include_extensions=include_extensions
            )

            # Convert Fibonacci data to levels format
            fibonacci_levels = []
            for level in fib_result.get('retracements', []):
                strength = 90 if level['level'] in [0.382, 0.5, 0.618] else 70
                fibonacci_levels.append({
                    'price': level['price'],
                    'type': 'fibonacci_retracement',
                    'level': level['level'],
                    'strength': strength
                })

            if include_extensions and 'extensions' in fib_result:
                for level in fib_result['extensions']:
                    fibonacci_levels.append({
                        'price': level['price'],
                        'type': 'fibonacci_extension',
                        'level': level['level'],
                        'strength': 70
                    })

            print(f"[{symbol}] Fibonacci levels: {len(fibonacci_levels)}")

        # Step 3: Detect patterns with context
        print(f"[{symbol}] Step 3: Detecting patterns...")

        # Extract pattern parameters from request
        pattern_params = body.get('pattern_params', {})

        patterns = pattern_detector_extended.detect_patterns(
            candles,
            trend_analysis=trend_summary,
            vwap_levels=vwap_levels,
            fibonacci_levels=fibonacci_levels,
            volume_profile_levels=None,  # Can be added later
            pattern_params=pattern_params  # Pass custom pattern parameters
        )

        # Convert patterns to dict format (dataclass to dict)
        patterns_dict = [asdict(p) for p in patterns]

        # Convert numpy types to native Python types for JSON serialization
        import numpy as np
        def convert_numpy_types(obj):
            """Recursively convert numpy types to native Python types"""
            if isinstance(obj, dict):
                return {k: convert_numpy_types(v) for k, v in obj.items()}
            elif isinstance(obj, list):
                return [convert_numpy_types(item) for item in obj]
            elif isinstance(obj, (np.integer, np.int64, np.int32)):
                return int(obj)
            elif isinstance(obj, (np.floating, np.float64, np.float32)):
                return float(obj)
            elif isinstance(obj, (np.bool_, np.bool)):
                return bool(obj)
            elif isinstance(obj, np.ndarray):
                return obj.tolist()
            else:
                return obj

        patterns_dict = convert_numpy_types(patterns_dict)

        # Also convert trend_summary
        trend_summary = convert_numpy_types(trend_summary)

        print(f"[{symbol}] [OK] Pattern Analysis Complete: {len(patterns_dict)} patterns detected")

        # Organize patterns by type
        patterns_by_type = {
            'continuation': [],
            'trend_start': [],
            'momentum': [],
            'reversal': []
        }

        for pattern in patterns_dict:
            pattern_type = pattern['pattern_type']
            if pattern_type in patterns_by_type:
                patterns_by_type[pattern_type].append(pattern)

        return {
            "symbol": symbol,
            "interval": interval_final,
            "success": True,
            "data": {
                "trend": trend_summary,
                "patterns": patterns_dict,
                "patterns_by_type": patterns_by_type,
                "level_sources": {
                    "vwap_enabled": include_vwap,
                    "fibonacci_enabled": include_fibonacci,
                    "vwap_levels": len(vwap_levels) if vwap_levels else 0,
                    "fibonacci_levels": len(fibonacci_levels) if fibonacci_levels else 0
                },
                "summary": {
                    "total_patterns": len(patterns_dict),
                    "continuation": len(patterns_by_type['continuation']),
                    "trend_start": len(patterns_by_type['trend_start']),
                    "momentum": len(patterns_by_type['momentum']),
                    "reversal": len(patterns_by_type['reversal'])
                }
            }
        }

    except Exception as e:
        print(f"[ERROR] Pattern Analysis {symbol if 'symbol' in locals() else 'unknown'}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol if 'symbol' in locals() else 'unknown',
            "interval": interval_final if 'interval_final' in locals() else 'unknown',
            "data": {},
            "success": False,
            "error": str(e)
        }


# ==================== DRAWING TOOLS ENDPOINTS ====================

DRAWINGS_DIR = Path("drawings")
DRAWINGS_DIR.mkdir(exist_ok=True)


@app.get("/api/drawings/{symbol}")
async def get_drawings(symbol: str):
    """
    Obtiene los dibujos guardados para un símbolo
    Los dibujos son globales para el símbolo (aparecen en todos los timeframes)
    """
    try:
        drawings_file = DRAWINGS_DIR / f"{symbol}.json"

        if drawings_file.exists():
            with open(drawings_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(f"[DRAWINGS] [OK] Loaded {len(data.get('shapes', []))} shapes for {symbol}")
                return data
        else:
            print(f"[DRAWINGS] No drawings found for {symbol}")
            return {
                "symbol": symbol,
                "shapes": [],
                "updated_at": None
            }

    except Exception as e:
        print(f"[ERROR] Loading drawings for {symbol}: {str(e)}")
        return {
            "symbol": symbol,
            "shapes": [],
            "error": str(e)
        }


@app.post("/api/drawings/{symbol}")
async def save_drawings(symbol: str, request: Request):
    """
    Guarda los dibujos para un símbolo

    Body:
    {
      "shapes": [...]
    }

    Los dibujos se guardan globalmente para el símbolo (aparecen en todos los timeframes)
    """
    try:
        body = await request.json()
        shapes = body.get('shapes', [])

        drawings_file = DRAWINGS_DIR / f"{symbol}.json"

        data = {
            "symbol": symbol,
            "shapes": shapes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "total_shapes": len(shapes)
        }

        with open(drawings_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"[DRAWINGS] [OK] Saved {len(shapes)} shapes for {symbol}")

        return {
            "success": True,
            "symbol": symbol,
            "shapes_saved": len(shapes),
            "updated_at": data['updated_at']
        }

    except Exception as e:
        print(f"[ERROR] Saving drawings for {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.delete("/api/drawings/{symbol}")
async def delete_drawings(symbol: str):
    """Elimina todos los dibujos de un símbolo"""
    try:
        drawings_file = DRAWINGS_DIR / f"{symbol}.json"

        if drawings_file.exists():
            drawings_file.unlink()
            print(f"[DRAWINGS] [OK] Deleted all drawings for {symbol}")
            return {
                "success": True,
                "message": f"Drawings deleted for {symbol}"
            }
        else:
            return {
                "success": True,
                "message": f"No drawings to delete for {symbol}"
            }

    except Exception as e:
        print(f"[ERROR] Deleting drawings for {symbol}: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


# ==================== REAL-TIME PATTERN DETECTION ENDPOINTS ====================

@app.post("/api/realtime/config/{symbol}")
async def update_realtime_config(symbol: str, request: Request):
    """
    Receive configuration and calculated levels from frontend.
    This allows the backend to detect patterns with the same logic
    the frontend would use.

    Body:
    {
        "interval": "240",
        "indicatorType": "doubleTopBottom" | "rejection",
        "config": { ... full indicator config ... },
        "calculatedLevels": {
            "vwap": { "vwap": 95000, "upper2": ..., "lower2": ... },
            "supportResistance": { "supports": [...], "resistances": [...] },
            "manualZones": [...],
            "fixedRanges": [...]
        }
    }
    """
    try:
        body = await request.json()
        interval = body.get('interval')
        indicator_type = body.get('indicatorType')
        config = body.get('config')
        calculated_levels = body.get('calculatedLevels', {})

        if not interval or not indicator_type:
            return {
                "success": False,
                "error": "Missing required fields: interval, indicatorType"
            }

        config_store = get_config_store()
        config_store.update(
            symbol=symbol,
            interval=interval,
            indicator_type=indicator_type,
            config=config,
            calculated_levels=calculated_levels
        )

        alerts_enabled = config.get('alertsEnabled', 'NOT_SET') if config else 'NO_CONFIG'
        print(f"[REALTIME] Config updated: {symbol}/{interval}/{indicator_type} (alertsEnabled={alerts_enabled})")

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "indicatorType": indicator_type,
            "message": "Configuration synchronized"
        }

    except Exception as e:
        print(f"[ERROR] Updating realtime config for {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/realtime/status")
async def get_realtime_status():
    """
    Get status of the real-time pattern detection service.

    Returns connection state, statistics, and buffer info.
    """
    try:
        realtime_service = get_realtime_pattern_service()
        status = realtime_service.get_status()

        return {
            "success": True,
            **status
        }

    except Exception as e:
        print(f"[ERROR] Getting realtime status: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "running": False
        }


@app.get("/api/realtime/patterns/{symbol}")
async def get_realtime_patterns(symbol: str, interval: str = "1", indicator: str = None, since: int = None):
    """
    Get patterns detected by the realtime service for a symbol/interval.
    Frontend should poll this endpoint to display patterns on chart.

    Query params:
        interval: Timeframe (e.g., "1", "60")
        indicator: Optional filter by indicator type ("doubleTopBottom" or "rejection")
        since: Optional timestamp (ms) to get only patterns newer than this

    Returns:
        patterns: Dict with 'doubleTopBottom' and 'rejection' pattern arrays
    """
    try:
        realtime_service = get_realtime_pattern_service()
        result = realtime_service.get_detected_patterns(
            symbol=symbol,
            interval=interval,
            indicator=indicator,
            since_timestamp=since
        )

        return {
            "success": True,
            **result
        }

    except Exception as e:
        print(f"[ERROR] Getting realtime patterns for {symbol}: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "patterns": {"doubleTopBottom": [], "rejection": []}
        }


@app.post("/api/realtime/set-interval")
async def set_active_interval(request: Request):
    """
    Set the active interval(s) to monitor.
    Called by frontend when user changes timeframe.

    Body:
        interval: string - Single interval to monitor (e.g., "60" for 1h)
        OR
        intervals: string[] - Multiple intervals to monitor

    Example:
        {"interval": "60"}  -> Monitor only 1h candles
        {"intervals": ["60", "240"]}  -> Monitor 1h and 4h candles
    """
    try:
        body = await request.json()
        interval = body.get('interval')
        intervals = body.get('intervals')

        # Normalize to list
        if interval:
            intervals_list = [interval]
        elif intervals:
            intervals_list = intervals
        else:
            return {
                "success": False,
                "error": "Missing required field: interval or intervals"
            }

        # Validate intervals
        valid_intervals = ["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W", "M"]
        for i in intervals_list:
            if i not in valid_intervals:
                return {
                    "success": False,
                    "error": f"Invalid interval: {i}. Valid: {valid_intervals}"
                }

        realtime_service = get_realtime_pattern_service()
        old_intervals = realtime_service.intervals.copy()

        success = await realtime_service.update_intervals(intervals_list)

        if success:
            print(f"[REALTIME] Active interval changed: {old_intervals} -> {intervals_list}")
            return {
                "success": True,
                "message": f"Now monitoring interval(s): {intervals_list}",
                "previous_intervals": old_intervals,
                "current_intervals": intervals_list,
                "subscriptions": realtime_service.ws_manager.get_current_subscriptions()
            }
        else:
            return {
                "success": False,
                "error": "Failed to update intervals",
                "current_intervals": realtime_service.intervals
            }

    except Exception as e:
        print(f"[ERROR] Setting active interval: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/realtime/alerts/history")
async def get_realtime_alerts_history(symbol: str = None, limit: int = 50):
    """
    Get history of alerts sent by the real-time service.

    Args:
        symbol: Optional filter by symbol
        limit: Maximum number of records (default 50)
    """
    try:
        state_manager = get_pattern_state_manager()
        history = state_manager.get_alert_history(symbol=symbol, limit=limit)

        return {
            "success": True,
            "count": len(history),
            "alerts": history
        }

    except Exception as e:
        print(f"[ERROR] Getting alerts history: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "alerts": []
        }


@app.post("/api/realtime/sync/{symbol}")
async def force_sync_symbol(symbol: str, request: Request):
    """
    Force re-sync of configuration for a symbol.
    Useful for debugging or manual intervention.
    """
    try:
        body = await request.json()
        interval = body.get('interval')

        if not interval:
            return {
                "success": False,
                "error": "Missing required field: interval"
            }

        config_store = get_config_store()
        existing = config_store.get(symbol, interval, body.get('indicatorType', 'doubleTopBottom'))

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "hasConfig": existing is not None,
            "config": existing.to_dict() if existing else None
        }

    except Exception as e:
        print(f"[ERROR] Force sync for {symbol}: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/realtime/config/stats")
async def get_config_stats():
    """Get statistics about synchronized configurations"""
    try:
        config_store = get_config_store()
        stats = config_store.get_stats()

        return {
            "success": True,
            **stats
        }

    except Exception as e:
        print(f"[ERROR] Getting config stats: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/realtime/cleanup")
async def cleanup_old_patterns():
    """Manually trigger cleanup of old pattern data"""
    try:
        state_manager = get_pattern_state_manager()
        removed = state_manager.cleanup_old_data()

        return {
            "success": True,
            "patterns_removed": removed,
            "message": f"Cleaned up {removed} old patterns"
        }

    except Exception as e:
        print(f"[ERROR] Cleanup: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================
# SWING DETECTOR ENDPOINTS
# ============================================================

@app.get("/api/swing/status")
async def get_swing_status(symbol: str = None):
    """
    Get swing detector service status.
    If symbol is provided, includes merged config for that symbol.
    """
    try:
        swing_service = get_swing_service()
        return {
            "success": True,
            **swing_service.get_status(symbol)
        }
    except Exception as e:
        print(f"[ERROR] Swing status: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/ws/debug")
async def get_websocket_debug():
    """
    DEBUG: Get WebSocket subscription status and buffer stats.
    Useful for debugging why certain symbols aren't receiving data.
    """
    try:
        from websocket_manager import get_websocket_manager
        ws_manager = get_websocket_manager()

        # Get buffer stats for each symbol/interval
        buffer_stats = {}
        for symbol, intervals in ws_manager.buffers.items():
            buffer_stats[symbol] = {}
            for interval, buffer in intervals.items():
                buffer_stats[symbol][interval] = {
                    'candle_count': len(buffer.candles),
                    'preloaded': buffer.preloaded,
                    'last_update': buffer.last_update
                }

        # Parse subscriptions to extract unique symbols and intervals
        subscribed_symbols = set()
        subscribed_intervals = set()
        for sub in ws_manager.subscriptions:
            parts = sub.split(".")
            if len(parts) == 3:
                _, interval, symbol = parts
                subscribed_symbols.add(symbol)
                subscribed_intervals.add(interval)

        return {
            "success": True,
            "websocket": {
                "connected": ws_manager.connected,
                "running": ws_manager.running,
                "subscriptions_count": len(ws_manager.subscriptions),
                "subscriptions": sorted(list(ws_manager.subscriptions)),
                "subscribed_symbols": sorted(list(subscribed_symbols)),
                "subscribed_intervals": sorted(list(subscribed_intervals)),
                "callbacks_count": len(ws_manager._candle_close_callbacks)
            },
            "buffers": buffer_stats
        }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/swing/config")
async def update_swing_config(request: Request):
    """
    Update swing detector configuration.

    Body example:
    {
        "enabled": true,
        "symbols": ["BTCUSDT", "ETHUSDT"],
        "interval": "1",
        "direction": "SHORT",
        "swingBars": 5,
        "priceZones": [
            {"min": 95000, "max": 96000, "direction": "SHORT", "enabled": true}
        ],
        "volumeFilter": {
            "enabled": true,
            "minZScore": 1.5,
            "lookbackBars": 20
        },
        "cooldownMinutes": 30
    }
    """
    try:
        data = await request.json()
        swing_service = get_swing_service()
        success = swing_service.update_config(data)

        if success:
            return {
                "success": True,
                "message": "Swing config updated",
                "config": swing_service.get_status()
            }
        else:
            return {
                "success": False,
                "error": "Failed to update config"
            }

    except Exception as e:
        print(f"[ERROR] Swing config update: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


# IMPORTANT: This route MUST be defined BEFORE /api/swing/config/{symbol}
# Otherwise FastAPI will match "apply-to-all" as a {symbol} parameter
@app.post("/api/swing/config/apply-to-all")
async def apply_swing_config_to_all_symbols(request: Request):
    """
    Apply configuration changes to ALL symbols at once.

    Useful when user wants to set the same volumeFilter, vwapFilter,
    swingBars, etc. across all monitored symbols.

    Body example:
    {
        "volumeFilter": {"enabled": true, "minZScore": 2.0},
        "swingBars": 5,
        "direction": "BOTH"
    }
    """
    try:
        data = await request.json()
        swing_service = get_swing_service()

        # Ensure symbolConfigs exists
        if not hasattr(swing_service.config, 'symbolConfigs') or swing_service.config.symbolConfigs is None:
            swing_service.config.symbolConfigs = {}

        # Get list of all symbols
        all_symbols = swing_service.config.symbols or []
        updated_symbols = []

        # Apply config to each symbol
        for symbol in all_symbols:
            if symbol not in swing_service.config.symbolConfigs:
                swing_service.config.symbolConfigs[symbol] = {}

            # Merge new settings into symbol config
            for key, value in data.items():
                swing_service.config.symbolConfigs[symbol][key] = value

            updated_symbols.append(symbol)

        # Save config
        swing_service._save_config()

        # Re-analyze to apply new settings
        print(f"[SWING] Config applied to ALL symbols ({len(updated_symbols)}): {list(data.keys())}")
        await swing_service.reanalyze_historical()

        return {
            "success": True,
            "message": f"Config applied to {len(updated_symbols)} symbols",
            "updated_symbols": updated_symbols,
            "applied_fields": list(data.keys())
        }

    except Exception as e:
        print(f"[ERROR] Swing apply to all: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/swing/config/{symbol}")
async def update_swing_symbol_config(symbol: str, request: Request):
    """
    Update swing detector configuration for a specific symbol.

    Body example:
    {
        "direction": "LONG",
        "swingBars": 3,
        "volumeFilter": {
            "enabled": true,
            "minZScore": 2.0
        }
    }
    """
    try:
        data = await request.json()
        swing_service = get_swing_service()

        # Ensure symbolConfigs exists
        if not hasattr(swing_service.config, 'symbolConfigs') or swing_service.config.symbolConfigs is None:
            swing_service.config.symbolConfigs = {}

        # Update or create symbol config
        if symbol not in swing_service.config.symbolConfigs:
            swing_service.config.symbolConfigs[symbol] = {}

        # ✅ FIX: Agregar símbolo a la lista principal si no existe
        if symbol not in swing_service.config.symbols:
            swing_service.config.symbols.append(symbol)
            print(f"[SWING] Added {symbol} to monitored symbols list")

        # Merge new settings into symbol config
        for key, value in data.items():
            swing_service.config.symbolConfigs[symbol][key] = value

        # Save config
        swing_service._save_config()

        # Re-analyze to apply new settings
        print(f"[SWING] Symbol config updated for {symbol} - Re-analyzing...")
        await swing_service.reanalyze_historical()

        return {
            "success": True,
            "message": f"Config updated for {symbol}",
            "symbolConfig": swing_service.config.get_symbol_config(symbol)
        }

    except Exception as e:
        print(f"[ERROR] Swing symbol config update: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/swing/signals/{symbol}")
async def get_swing_signals(symbol: str, since: int = None):
    """
    Get recent swing signals for a symbol.
    Frontend polls this to display signals on chart.

    Query params:
        since: Optional timestamp (ms) - only return signals newer than this
    """
    try:
        swing_service = get_swing_service()
        signals = swing_service.get_signals(symbol, since_timestamp=since)

        return {
            "success": True,
            "symbol": symbol,
            "signals": signals,
            "count": len(signals)
        }

    except Exception as e:
        print(f"[ERROR] Getting swing signals for {symbol}: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "signals": []
        }


@app.post("/api/swing/clear-cooldowns")
async def clear_swing_cooldowns():
    """Clear all swing detector cooldowns (for testing)"""
    try:
        swing_service = get_swing_service()
        swing_service.clear_cooldowns()

        return {
            "success": True,
            "message": "Cooldowns cleared"
        }

    except Exception as e:
        print(f"[ERROR] Clearing swing cooldowns: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/swing/reanalyze")
async def reanalyze_swing_signals():
    """
    Re-analyze historical data with current config.
    Useful after changing detection parameters to refresh all signals.
    """
    try:
        swing_service = get_swing_service()
        await swing_service.reanalyze_historical()

        return {
            "success": True,
            "message": "Historical data re-analyzed",
            "stats": swing_service.stats
        }

    except Exception as e:
        print(f"[ERROR] Re-analyzing swing signals: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/swing/add-zone")
async def add_swing_zone(request: Request):
    """
    Add a price zone to swing detector.

    Body:
    {
        "min": 95000,
        "max": 96000,
        "direction": "SHORT",  // or "LONG" or "BOTH"
        "enabled": true,
        "id": "zone_1",  // optional
        "timeBound": false,  // optional - if true, zone only valid within timeStart-timeEnd
        "timeStart": 1234567890000,  // optional - start timestamp (ms)
        "timeEnd": 1234567890000  // optional - end timestamp (ms)
    }
    """
    try:
        data = await request.json()
        swing_service = get_swing_service()

        # Add ID if not provided
        if 'id' not in data:
            data['id'] = f"zone_{int(time.time() * 1000)}"

        # Add to config
        swing_service.config.priceZones.append(data)
        swing_service._save_config()

        # Re-analyze signals with new zone configuration
        print(f"[SWING] Zone added: {data.get('id')} - Re-analyzing signals...")
        await swing_service.reanalyze_historical()

        return {
            "success": True,
            "message": "Zone added and signals re-analyzed",
            "zone": data,
            "totalZones": len(swing_service.config.priceZones)
        }

    except Exception as e:
        print(f"[ERROR] Adding swing zone: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.delete("/api/swing/zone/{zone_id}")
async def delete_swing_zone(zone_id: str):
    """Delete a price zone from swing detector"""
    try:
        swing_service = get_swing_service()

        # Find and remove zone
        original_count = len(swing_service.config.priceZones)
        swing_service.config.priceZones = [
            z for z in swing_service.config.priceZones
            if z.get('id') != zone_id
        ]

        if len(swing_service.config.priceZones) < original_count:
            swing_service._save_config()

            # Re-analyze signals with updated zone configuration
            print(f"[SWING] Zone deleted: {zone_id} - Re-analyzing signals...")
            await swing_service.reanalyze_historical()

            return {
                "success": True,
                "message": f"Zone {zone_id} deleted and signals re-analyzed",
                "totalZones": len(swing_service.config.priceZones)
            }
        else:
            return {
                "success": False,
                "error": f"Zone {zone_id} not found"
            }

    except Exception as e:
        print(f"[ERROR] Deleting swing zone: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


# ============================================================
# VWAP SERVICE ENDPOINTS
# ============================================================

@app.get("/api/vwap-service/status")
async def get_vwap_service_status():
    """Get VWAP service status and configuration"""
    try:
        vwap_service = get_vwap_service()
        return {
            "success": True,
            **vwap_service.get_status()
        }
    except Exception as e:
        print(f"[ERROR] VWAP service status: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/vwap-service/config")
async def update_vwap_service_config(request: Request):
    """
    Update VWAP service configuration.

    Body example:
    {
        "enabled": true,
        "symbols": ["BTCUSDT", "ETHUSDT"],
        "interval": "1",
        "vwapType": "session",
        "resetHour": 0,
        "rollingPeriod": 20,
        "showBands": true,
        "bandMultipliers": [1.0, 2.0, 3.0],
        "applyCryptoAdjustment": true,
        "showBandWidth": true,
        "showBBWP": false,
        "showTTMSqueeze": false,
        "bandWidthThresholds": {
            "squeeze": 2.0,
            "consolidation": 5.0,
            "normal": 10.0
        }
    }
    """
    try:
        data = await request.json()
        vwap_service = get_vwap_service()
        success = vwap_service.update_config(data)

        if success:
            return {
                "success": True,
                "message": "VWAP config updated",
                "config": vwap_service.get_status()
            }
        else:
            return {
                "success": False,
                "error": "Failed to update config"
            }

    except Exception as e:
        print(f"[ERROR] VWAP config update: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


@app.get("/api/vwap-service/data/{symbol}")
async def get_vwap_service_data(
    symbol: str,
    days: int = 1,
    interval: str = "60",
    vwapType: str = None,
    rollingPeriod: int = None
):
    """
    Get VWAP data for a symbol.
    Returns all VWAP points with bands and volatility indicators.
    Reloads if days/interval/vwapType differs from cached config.
    """
    try:
        vwap_service = get_vwap_service()

        # Max days per interval (matches frontend DAYS_OPTIONS_BY_INTERVAL)
        MAX_DAYS_BY_INTERVAL = {
            "1": 5,
            "3": 10,
            "5": 30,
            "15": 90,
            "30": 150,
            "60": 360,
            "120": 540,
            "240": 720,
            "D": 1440,
            "W": 730
        }

        max_days = MAX_DAYS_BY_INTERVAL.get(interval, 360)
        days_to_load = min(days, max_days)

        # Check current state
        current_interval = vwap_service.config.interval
        current_vwap_type = vwap_service.config.vwapType
        current_rolling = vwap_service.config.rollingPeriod
        current_data = vwap_service.get_vwap_data(symbol)

        interval_minutes = vwap_service._interval_to_minutes(interval)
        candles_needed = (days_to_load * 24 * 60) // interval_minutes

        # Determine if config changed
        config_changed = (
            current_interval != interval or
            (vwapType and current_vwap_type != vwapType) or
            (rollingPeriod and current_rolling != rollingPeriod)
        )

        needs_more_data = len(current_data) < candles_needed * 0.9

        if config_changed or needs_more_data:
            # Update config if params provided
            if vwapType:
                vwap_service.config.vwapType = vwapType
            if rollingPeriod:
                vwap_service.config.rollingPeriod = rollingPeriod

            print(f"[VWAP] {symbol}: Reloading - interval={interval}, days={days_to_load}, vwapType={vwap_service.config.vwapType}")
            await vwap_service.reload_symbol_data(symbol, days_to_load, interval)
            current_data = vwap_service.get_vwap_data(symbol)

        return {
            "success": True,
            "symbol": symbol,
            "data": current_data,
            "count": len(current_data),
            "interval": interval,
            "days_loaded": days_to_load,
            "vwapType": vwap_service.config.vwapType
        }

    except Exception as e:
        print(f"[ERROR] Getting VWAP data for {symbol}: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "data": []
        }


@app.get("/api/vwap-service/latest/{symbol}")
async def get_vwap_service_latest(symbol: str):
    """
    Get latest VWAP point for a symbol.
    Useful for real-time display without fetching all data.
    """
    try:
        vwap_service = get_vwap_service()
        latest = vwap_service.get_latest_vwap(symbol)

        if latest:
            return {
                "success": True,
                "symbol": symbol,
                "data": latest
            }
        else:
            return {
                "success": False,
                "error": f"No VWAP data for {symbol}",
                "data": None
            }

    except Exception as e:
        print(f"[ERROR] Getting latest VWAP for {symbol}: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "data": None
        }


@app.post("/api/vwap-service/recalculate")
async def recalculate_vwap_service():
    """
    Force recalculation of VWAP for all symbols.
    Useful after changing config parameters.
    """
    try:
        vwap_service = get_vwap_service()
        await vwap_service.recalculate()

        return {
            "success": True,
            "message": "VWAP data recalculated",
            "stats": vwap_service.stats
        }

    except Exception as e:
        print(f"[ERROR] Recalculating VWAP: {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


# ==================== BATCH INDICATOR ENDPOINT ====================

@app.post("/api/indicators/batch")
async def get_indicators_batch(request: Request):
    """
    🚀 Batch endpoint: obtiene datos de múltiples indicadores en una sola llamada.

    Body JSON:
    {
        "symbol": "BTCUSDT",
        "interval": "60",
        "days": 1,
        "indicators": ["vwap", "swing", "support_resistance"]
    }

    Indicadores soportados:
    - vwap: VWAP con bandas de desviación
    - swing: Swing High/Low signals
    - support_resistance: Niveles de soporte y resistencia

    Returns:
    {
        "success": true,
        "symbol": "BTCUSDT",
        "interval": "60",
        "data": {
            "vwap": {...},
            "swing": {...},
            "support_resistance": {...}
        },
        "timing": {
            "vwap": 120,
            "swing": 85,
            "total": 150
        }
    }
    """
    start_total = time.time()

    try:
        body = await request.json()
        symbol = body.get("symbol", "BTCUSDT")
        interval = body.get("interval", "60")
        days = body.get("days", 1)
        requested_indicators = body.get("indicators", ["vwap", "swing"])

        print(f"[BATCH] {symbol}@{interval} - indicators: {requested_indicators}")

        result = {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "data": {},
            "timing": {}
        }

        # Crear tasks para ejecutar en paralelo
        tasks = []
        indicator_names = []

        # VWAP
        if "vwap" in requested_indicators:
            async def fetch_vwap():
                start = time.time()
                vwap_service = get_vwap_service()
                data = await vwap_service.get_vwap_data(symbol, days, interval)
                return ("vwap", data, (time.time() - start) * 1000)
            tasks.append(fetch_vwap())
            indicator_names.append("vwap")

        # Swing Detector
        if "swing" in requested_indicators:
            async def fetch_swing():
                start = time.time()
                swing_service = get_swing_service()
                signals = swing_service.get_signals(symbol)
                zones = [z for z in swing_service.config.priceZones if z.get("symbol") == symbol]
                return ("swing", {"signals": signals, "zones": zones}, (time.time() - start) * 1000)
            tasks.append(fetch_swing())
            indicator_names.append("swing")

        # Support & Resistance
        if "support_resistance" in requested_indicators:
            async def fetch_sr():
                start = time.time()
                # Reutilizar lógica existente
                url = f"https://api.bybit.com/v5/market/kline?category=linear&symbol={symbol}&interval={interval}&limit=500"
                async with httpx.AsyncClient() as client:
                    response = await client.get(url)
                    if response.status_code == 200:
                        data = response.json()
                        if data.get("retCode") == 0 and data.get("result", {}).get("list"):
                            candles = data["result"]["list"]
                            # Calcular niveles básicos de S/R
                            highs = [float(c[2]) for c in candles]
                            lows = [float(c[3]) for c in candles]
                            closes = [float(c[4]) for c in candles]

                            max_high = max(highs)
                            min_low = min(lows)
                            avg_close = sum(closes) / len(closes)

                            levels = [
                                {"price": max_high, "type": "resistance", "strength": 1.0},
                                {"price": min_low, "type": "support", "strength": 1.0},
                                {"price": avg_close, "type": "pivot", "strength": 0.5}
                            ]
                            return ("support_resistance", {"levels": levels, "count": len(levels)}, (time.time() - start) * 1000)
                return ("support_resistance", {"levels": [], "count": 0}, (time.time() - start) * 1000)
            tasks.append(fetch_sr())
            indicator_names.append("support_resistance")

        # Ejecutar todas las tareas en paralelo
        if tasks:
            results = await asyncio.gather(*tasks, return_exceptions=True)

            for res in results:
                if isinstance(res, Exception):
                    print(f"[BATCH] Error en indicador: {str(res)}")
                    continue
                name, data, timing_ms = res
                result["data"][name] = data
                result["timing"][name] = round(timing_ms, 1)

        result["timing"]["total"] = round((time.time() - start_total) * 1000, 1)
        print(f"[BATCH] {symbol}@{interval} - completed in {result['timing']['total']}ms")

        return result

    except Exception as e:
        print(f"[BATCH ERROR] {str(e)}")
        return {
            "success": False,
            "error": str(e)
        }


# ==================== S&R v2 ENDPOINT (Swing-based) ====================

@app.get("/api/sr2/{symbol}")
async def get_support_resistance_v2(
    symbol: str,
    interval: str = "15",
    days: int = 30,
    swing_bars: int = 5,
    cluster_distance_pct: float = 0.3,
    min_touches: int = 2,
    max_levels: int = 10,
    price_range_pct: float = 5.0,
    min_volume_zscore: float = 0.0
):
    """
    Endpoint S&R v2 - Detecta niveles basados en Swing Points.

    A diferencia del S&R original que usa pivots con volumen alto individual,
    este detector:
    1. Encuentra TODOS los swing highs/lows (reversiones confirmadas)
    2. Los agrupa por precio (clustering)
    3. Calcula estadisticas del cluster (toques, volumen promedio, etc.)
    4. Filtra por cantidad minima de toques
    5. Ordena por "strength" y retorna los mas relevantes

    Parametros:
        - symbol: Par a analizar (ej: BTCUSDT)
        - interval: Intervalo temporal (1, 5, 15, 60, 240, D, etc.)
        - days: Dias historicos a analizar
        - swing_bars: Barras a cada lado para confirmar swing (default: 5)
        - cluster_distance_pct: % para agrupar swings cercanos (default: 0.3)
        - min_touches: Minimo de toques para nivel valido (default: 2)
        - max_levels: Maximo de niveles por tipo (default: 10)
        - price_range_pct: % arriba/abajo del precio actual (default: 5.0)
    """
    try:
        # Limpiar interval
        interval_clean = (
            interval.replace("m", "")
            .replace("h", "")
            .replace("d", "D")
            .replace("w", "W")
        )

        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)

        interval_final = INTERVAL_MAP.get(interval_clean, "15")

        print(f"[{symbol}] [SR2] interval={interval_final}, days={days}, swing_bars={swing_bars}, min_touches={min_touches}, min_vol_z={min_volume_zscore}")

        # Intentar cargar del cache
        cache_key = f"sr2_{days}_{swing_bars}_{cluster_distance_pct}_{min_touches}_{price_range_pct}_{min_volume_zscore}"
        cached_data = load_cache(symbol, interval_final, cache_key)

        if cached_data and cached_data.get("symbol") == symbol:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            # Cache valido por 5 minutos para S&R v2
            if cache_age < 300:
                print(f"[CACHE HIT] [OK] {symbol} {interval_final} SR2 desde cache (age: {cache_age:.0f}s)")
                return {
                    "symbol": symbol,
                    "interval": interval_final,
                    "indicator": "supportResistance_v2",
                    "data": cached_data.get("data", {}),
                    "success": True,
                    "from_cache": True,
                    "cache_age_seconds": int(cache_age)
                }

        # Obtener datos historicos
        historical = await get_historical(symbol, interval_final, days)

        if not historical.get('success') or not historical.get('data'):
            return {
                "symbol": symbol,
                "interval": interval_final,
                "indicator": "supportResistance_v2",
                "data": {},
                "success": False,
                "error": "No se pudieron obtener datos historicos"
            }

        candles = historical['data']
        print(f"[{symbol}] [SR2] Analizando {len(candles)} velas")

        # Detectar niveles S&R usando el nuevo detector
        sr_detector = get_sr_detector()
        result = sr_detector.detect_levels(
            candles=candles,
            swing_bars=swing_bars,
            cluster_distance_pct=cluster_distance_pct,
            min_touches=min_touches,
            max_levels=max_levels,
            price_range_pct=price_range_pct,
            min_volume_zscore=min_volume_zscore
        )

        print(f"[{symbol}] [SR2] Resultado: {len(result['resistances'])} R, {len(result['supports'])} S")

        # Guardar en cache
        cache_entry = {
            "symbol": symbol,
            "data": result,
            "timestamp": time.time()
        }
        save_cache(symbol, interval_final, cache_key, cache_entry)

        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "supportResistance_v2",
            "data": result,
            "config": {
                "swing_bars": swing_bars,
                "cluster_distance_pct": cluster_distance_pct,
                "min_touches": min_touches,
                "max_levels": max_levels,
                "price_range_pct": price_range_pct,
                "min_volume_zscore": min_volume_zscore
            },
            "success": True,
            "from_cache": False
        }

    except Exception as e:
        print(f"[{symbol}] [SR2 ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "indicator": "supportResistance_v2",
            "data": {},
            "success": False,
            "error": str(e)
        }


# =============================================================================
# ZONE DETECTOR - Detección de zonas de consolidación con simulación de trading
# =============================================================================

# Carpeta para guardar CSVs de zonas
ZONES_CSV_DIR = Path("zones_csv")
ZONES_CSV_DIR.mkdir(exist_ok=True)

@app.post("/api/zones/detect")
async def detect_trading_zones(request: Request):
    """
    Detecta zonas de consolidacion y simula trades con TP=2R, SL=1R.
    Soporta 5 capas opcionales v3.0 para mejorar deteccion.
    """
    try:
        body = await request.json()
        symbol = body.get("symbol", "BTCUSDT")
        interval = body.get("interval", "5")
        days = body.get("days", 120)
        params_dict = body.get("params", {})

        import time as _time
        _zone_start = _time.time()

        interval_min = {"1":1,"3":3,"5":5,"15":15,"30":30,"60":60,"120":120,"240":240,"D":1440,"W":10080}.get(interval, 60)
        expected_candles = int((days * 24 * 60) / interval_min)
        print(f"[{symbol}] [ZONES] === INICIO DETECCION v3.0 ===")
        print(f"[{symbol}] [ZONES] interval={interval}, days={days}, velas esperadas=~{expected_candles}")
        print(f"[{symbol}] [ZONES] Params: {params_dict}")

        # Validar dias contra maximo permitido
        max_days = MAX_DAYS_BY_INTERVAL.get(interval, 30)
        if days > max_days:
            print(f"[{symbol}] [ZONES] Days {days} > max {max_days}, ajustando")
            days = max_days
            expected_candles = int((days * 24 * 60) / interval_min)
            print(f"[{symbol}] [ZONES] Nuevas velas esperadas: ~{expected_candles}")

        # Obtener datos historicos
        _fetch_start = _time.time()
        print(f"[{symbol}] [ZONES] Descargando velas de Bybit...")
        historical = await get_historical(symbol, interval, days)
        _fetch_elapsed = _time.time() - _fetch_start

        if not historical.get('success') or not historical.get('data'):
            print(f"[{symbol}] [ZONES] ERROR: No se obtuvieron datos historicos ({_fetch_elapsed:.1f}s)")
            return {
                "success": False,
                "error": "No se pudieron obtener datos historicos",
                "zones": []
            }

        candles = historical['data']
        print(f"[{symbol}] [ZONES] {len(candles)} velas obtenidas en {_fetch_elapsed:.1f}s (esperadas: ~{expected_candles})")

        # Metodo de deteccion: "trading_zones" (actual) o "atr_dynamic" (nuevo basado en ATRBasedRangeDetector)
        detection_method = params_dict.get("detection_method", "trading_zones")

        # Configurar parametros de deteccion (clasicos + capas v3.0 + atr_dynamic)
        params = ZoneDetectionParams(
            consol_min_bars=params_dict.get("consol_min_bars", 8),
            consol_max_bars=params_dict.get("consol_max_bars", 50),
            consol_max_range_pct=params_dict.get("consol_max_range_pct", 2.0),
            consol_atr_ratio=params_dict.get("consol_atr_ratio", 0.6),
            consol_body_ratio=params_dict.get("consol_body_ratio", 0.5),
            consol_max_outside_bars=params_dict.get("consol_max_outside_bars", 3),
            lookforward_bars=params_dict.get("lookforward_bars", 100),
            max_price_range_pct=params_dict.get("max_price_range_pct", 5.0),
            entry_mode=params_dict.get("entry_mode", "breakout_close"),
            position_mode=params_dict.get("position_mode", "sequential"),
            swing_bars=params_dict.get("swing_bars", 5),
            sl_mode=params_dict.get("sl_mode", "zone_opposite"),
            # Capas v3.0
            use_atr_band=params_dict.get("use_atr_band", False),
            atr_band_period=params_dict.get("atr_band_period", 200),
            atr_band_multiplier=params_dict.get("atr_band_multiplier", 1.0),
            atr_band_ma_period=params_dict.get("atr_band_ma_period", 20),
            use_reentry=params_dict.get("use_reentry", False),
            max_reentry_bars=params_dict.get("max_reentry_bars", 3),
            use_ttm_prefilter=params_dict.get("use_ttm_prefilter", False),
            ttm_atr_length=params_dict.get("ttm_atr_length", 20),
            ttm_kc_multiplier=params_dict.get("ttm_kc_multiplier", 1.5),
            ttm_min_squeeze_bars=params_dict.get("ttm_min_squeeze_bars", 5),
            use_bbwp_scoring=params_dict.get("use_bbwp_scoring", False),
            bbwp_lookback=params_dict.get("bbwp_lookback", 252),
            bbwp_squeeze_threshold=params_dict.get("bbwp_squeeze_threshold", 20),
            use_inside_pct_filter=params_dict.get("use_inside_pct_filter", False),
            min_inside_pct=params_dict.get("min_inside_pct", 70.0),
            # ATR Dynamic Method (nuevo)
            atr_dyn_period=params_dict.get("atr_dyn_period", 200),
            atr_dyn_ma_period=params_dict.get("atr_dyn_ma_period", 20),
            atr_dyn_multiplier=params_dict.get("atr_dyn_multiplier", 1.0),
            atr_dyn_max_breakout=params_dict.get("atr_dyn_max_breakout", 5),
            atr_dyn_merge_overlap=params_dict.get("atr_dyn_merge_overlap", True),
            atr_dyn_min_bars=params_dict.get("atr_dyn_min_bars", 0),
            # Volume Profile por zona (para va_breakout)
            sl_poc_buffer_pct=params_dict.get("sl_poc_buffer_pct", 50.0),
            vp_bins_per_zone=params_dict.get("vp_bins_per_zone", 30),
            # Filtro de calidad
            min_score_filter=params_dict.get("min_score_filter", 0),
            # Score intrinseco (sin sesgos post-trade)
            use_continuation_score=params_dict.get("use_continuation_score", False),
        )

        print(f"[{symbol}] [ZONES] Metodo de deteccion: {detection_method}")

        # Detectar zonas con el metodo seleccionado
        _detect_start = _time.time()
        detector = ZoneDetector()
        zones = detector.detect_zones(candles, method=detection_method, params=params)
        _detect_elapsed = _time.time() - _detect_start

        _total_elapsed = _time.time() - _zone_start
        print(f"[{symbol}] [ZONES] {len(zones)} zonas detectadas en {_detect_elapsed:.1f}s (total: {_total_elapsed:.1f}s)")

        # Convertir a diccionarios para JSON
        zones_data = [zone.to_dict() for zone in zones]

        # Calcular estadisticas basicas
        wins = len([z for z in zones_data if z.get('trade_result') == 'WIN'])
        losses = len([z for z in zones_data if z.get('trade_result') == 'LOSS'])
        skipped = len([z for z in zones_data if z.get('trade_result') == 'SKIPPED'])
        no_entry = len([z for z in zones_data if z.get('trade_result') == 'NO_ENTRY'])
        total_pnl_r = sum(z.get('trade_pnl_r', 0) for z in zones_data)
        total_closed = wins + losses
        win_rate = (wins / total_closed * 100) if total_closed > 0 else 0
        expectancy = (total_pnl_r / total_closed) if total_closed > 0 else 0

        # Calcular metricas avanzadas: rachas y equity curve
        # Ordenar zonas por entry_timestamp (o start_timestamp si no tiene entry)
        active_trades = [z for z in zones_data if z.get('trade_result') in ('WIN', 'LOSS')]
        active_trades.sort(key=lambda z: z.get('entry_timestamp', 0) or z.get('start_timestamp', 0))

        max_consecutive_wins = 0
        max_consecutive_losses = 0
        current_wins = 0
        current_losses = 0
        equity = 0.0
        equity_curve = []

        for z in active_trades:
            result = z.get('trade_result')
            pnl = z.get('trade_pnl_r', 0)
            equity += pnl

            # Guardar punto de equity
            equity_curve.append({
                "timestamp": z.get('entry_timestamp', 0) or z.get('start_timestamp', 0),
                "equity": round(equity, 2),
                "result": result,
                "pnl": pnl
            })

            if result == 'WIN':
                current_wins += 1
                current_losses = 0
                max_consecutive_wins = max(max_consecutive_wins, current_wins)
            elif result == 'LOSS':
                current_losses += 1
                current_wins = 0
                max_consecutive_losses = max(max_consecutive_losses, current_losses)

        # Calcular max drawdown desde equity curve
        max_equity = 0.0
        max_drawdown = 0.0
        for point in equity_curve:
            eq = point['equity']
            if eq > max_equity:
                max_equity = eq
            drawdown = max_equity - eq
            if drawdown > max_drawdown:
                max_drawdown = drawdown

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "days": days,
            "candles_count": len(candles),
            "zones": zones_data,
            "stats": {
                "total_zones": len(zones_data),
                "wins": wins,
                "losses": losses,
                "open": 0,
                "skipped": skipped,
                "no_entry": no_entry,
                "win_rate": round(win_rate, 1),
                "total_pnl_r": round(total_pnl_r, 1),
                "expectancy": round(expectancy, 3),
                "max_consecutive_wins": max_consecutive_wins,
                "max_consecutive_losses": max_consecutive_losses,
                "max_drawdown_r": round(max_drawdown, 2),
                "entry_mode": params_dict.get("entry_mode", "breakout_close"),
                "position_mode": params_dict.get("position_mode", "sequential"),
            },
            "equity_curve": equity_curve,
            "params_used": params_dict
        }

    except Exception as e:
        print(f"[ZONES ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e),
            "zones": []
        }


@app.post("/api/zones/export-csv")
async def export_zones_csv(request: Request):
    """
    Genera CSV a partir de zonas ya detectadas (enviadas desde el frontend).
    Se invoca con un boton despues de la simulacion, no automaticamente.
    """
    try:
        body = await request.json()
        symbol = body.get("symbol", "BTCUSDT")
        interval = body.get("interval", "5")
        days = body.get("days", 120)
        zones_data = body.get("zones", [])
        params_dict = body.get("params", {})

        if not zones_data:
            return {"success": False, "error": "No hay zonas para exportar"}

        csv_path = _generate_zones_csv(symbol, interval, days, zones_data, params_dict)
        print(f"[{symbol}] [ZONES] CSV exportado: {csv_path}")

        return {
            "success": True,
            "csv_path": csv_path,
            "zones_exported": len(zones_data)
        }
    except Exception as e:
        print(f"[ZONES CSV ERROR] {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


def _generate_zones_csv(symbol: str, interval: str, days: int, zones: List[dict], params: dict) -> str:
    """
    Genera un archivo CSV con formato europeo (punto y coma, coma decimal).
    Incluye timestamp en el nombre para no sobreescribir.
    Las zonas se ordenan cronologicamente por entry_timestamp.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"{symbol}_{interval}m_{days}d_zones_{timestamp}.csv"
    filepath = ZONES_CSV_DIR / filename

    # Ordenar zonas cronologicamente por entry_timestamp (o start_timestamp)
    sorted_zones = sorted(
        zones,
        key=lambda z: z.get('entry_timestamp', 0) or z.get('start_timestamp', 0)
    )

    # Filtrar solo trades activos (WIN/LOSS) para calcular equity
    active_trades = [z for z in sorted_zones if z.get('trade_result') in ('WIN', 'LOSS')]

    # Calcular equity acumulado para cada trade
    equity_map = {}  # timestamp -> equity
    equity = 0.0
    for z in active_trades:
        pnl = z.get('trade_pnl_r', 0)
        equity += pnl
        ts_key = z.get('entry_timestamp', 0) or z.get('start_timestamp', 0)
        equity_map[ts_key] = equity

    # Headers del CSV
    headers = [
        "zona_num", "fecha_entrada", "fecha_cierre",
        "precio_min", "precio_max", "rango_pct",
        "direccion", "precio_breakout",
        "modo_entrada", "precio_entrada", "offset_barras",
        "sl_price", "tp_price",
        "resultado", "pnl_r", "equity_r",
        "r_multiple", "alcanzo_2r", "alcanzo_3r",
        "barras_cierre", "velas_en_zona", "duracion_horas", "score",
        "vp_poc", "vp_vah", "vp_val"
    ]

    with open(filepath, 'w', encoding='utf-8-sig') as f:
        # UTF-8 BOM (utf-8-sig lo incluye automaticamente)
        # Instruccion para Excel: usar ; como separador
        f.write("sep=;\n")

        # Escribir parametros usados como comentario
        f.write(f"# Parametros: {json.dumps(params)}\n")
        f.write(f"# Fecha: {datetime.now().isoformat()}\n")

        # Headers
        f.write(";".join(headers) + "\n")

        # Datos ordenados cronologicamente
        running_equity = 0.0
        for i, zone in enumerate(sorted_zones, 1):
            # Convertir timestamps a fechas legibles
            entry_ts = zone.get('entry_timestamp', 0) or zone.get('start_timestamp', 0)
            close_ts = zone.get('trade_close_timestamp', 0) or zone.get('end_timestamp', 0)

            entry_dt = datetime.fromtimestamp(entry_ts / 1000) if entry_ts else None
            close_dt = datetime.fromtimestamp(close_ts / 1000) if close_ts else None

            entry_mode_label = zone.get('entry_mode', '')
            if entry_mode_label == 'breakout_close':
                entry_mode_label = 'Close Breakout'
            elif entry_mode_label == 'va_breakout':
                entry_mode_label = 'VA Breakout'
            elif entry_mode_label == 'swing_confirmation':
                entry_mode_label = 'Swing Confirm'

            # Calcular equity para este trade
            result = zone.get('trade_result', '')
            if result in ('WIN', 'LOSS'):
                running_equity += zone.get('trade_pnl_r', 0)
                equity_str = str(round(running_equity, 2)).replace('.', ',')
            else:
                equity_str = "-"

            row = [
                str(i),
                entry_dt.strftime("%Y-%m-%d %H:%M") if entry_dt else "-",
                close_dt.strftime("%Y-%m-%d %H:%M") if close_dt else "-",
                str(zone.get('min_price', 0)).replace('.', ','),
                str(zone.get('max_price', 0)).replace('.', ','),
                str(round(zone.get('price_range_pct', 0), 2)).replace('.', ','),
                zone.get('breakout_direction', ''),
                str(zone.get('breakout_price', 0)).replace('.', ','),
                entry_mode_label,
                str(zone.get('entry_price', 0)).replace('.', ','),
                str(zone.get('entry_bar_offset', 0)),
                str(round(zone.get('sl_price', 0), 2)).replace('.', ','),
                str(round(zone.get('tp_price', 0), 2)).replace('.', ','),
                result,
                str(zone.get('trade_pnl_r', 0)).replace('.', ','),
                equity_str,
                str(round(zone.get('r_multiple', 0), 2)).replace('.', ','),
                "Si" if zone.get('reached_2r') else "No",
                "Si" if zone.get('reached_3r') else "No",
                str(zone.get('bars_to_close', 0)),
                str(zone.get('candles_in_zone', 0)),
                str(round(zone.get('duration_hours', 0), 1)).replace('.', ','),
                str(round(zone.get('trading_score', 0), 0)),
                str(round(zone.get('vp_poc_price', 0), 2)).replace('.', ','),
                str(round(zone.get('vp_vah_price', 0), 2)).replace('.', ','),
                str(round(zone.get('vp_val_price', 0), 2)).replace('.', ',')
            ]

            f.write(";".join(row) + "\n")

    return str(filepath)


# =============================================
# ZONE DETECTOR - ALERTAS AL TRADING BOT
# =============================================

@app.post("/api/zones/send-alert")
async def send_zone_alert(request: Request):
    """
    Envia una alerta de breakout de zona al TradingBot Desktop (puerto 5000).
    El frontend llama a este endpoint con los datos de la zona que tiene breakout.
    """
    try:
        body = await request.json()
        symbol = body.get("symbol", "").upper()
        direction = body.get("direction", "").upper()  # "UP" -> LONG, "DOWN" -> SHORT
        entry_price = body.get("entry_price", 0)
        sl_price = body.get("sl_price", 0)
        tp_price = body.get("tp_price", 0)
        confidence = body.get("confidence", 70)
        entry_mode = body.get("entry_mode", "breakout_close")
        trading_bot_url = body.get("trading_bot_url", "http://localhost:5000")
        order_type = body.get("order_type", "market").lower()  # "market" o "limit"

        if not symbol or not direction or not entry_price:
            return {"success": False, "error": "Faltan campos requeridos: symbol, direction, entry_price"}

        if order_type == "limit" and (not sl_price or not tp_price):
            return {"success": False, "error": "Se requieren sl_price y tp_price para ordenes Limit"}

        # Mapear direction: UP -> LONG, DOWN -> SHORT
        if direction in ("UP", "LONG"):
            pattern_direction = "LONG"
        elif direction in ("DOWN", "SHORT"):
            pattern_direction = "SHORT"
        else:
            return {"success": False, "error": f"Direccion invalida: {direction}"}

        # Construir payload en formato compatible con TradingBot
        alert_payload = {
            "source": "ZONE_DETECTOR",
            "symbol": symbol,
            "interval": "0",  # No aplica para zone detector
            "pattern": {
                "patternType": f"ZONE_BREAKOUT_{entry_mode.upper()}",
                "price": float(entry_price),
                "confidence": float(confidence),
                "direction": pattern_direction
            }
        }

        if order_type == "limit":
            # Limit: usar entry_price de la zona como precio limite, con TP/SL exactos
            alert_payload["order_type"] = "Limit"
            alert_payload["limit_price"] = float(entry_price)
            alert_payload["custom_stop_loss"] = float(sl_price)
            alert_payload["custom_take_profit"] = float(tp_price)
        else:
            # Market: NO enviar custom TP/SL, el TradingBot usara sus defaults
            alert_payload["order_type"] = "Market"

        # Enviar al TradingBot
        target_url = f"{trading_bot_url}/api/watchlist-alert"
        if order_type == "limit":
            print(f"[ZONE_ALERT] Enviando LIMIT: {symbol} {pattern_direction} @ {entry_price} | SL={sl_price} TP={tp_price} -> {target_url}")
        else:
            print(f"[ZONE_ALERT] Enviando MARKET: {symbol} {pattern_direction} (TP/SL defaults del bot) -> {target_url}")

        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.post(target_url, json=alert_payload)
            result = response.json()

        if response.status_code == 200 and result.get("success"):
            print(f"[ZONE_ALERT] OK: {symbol} {pattern_direction} - TradingBot respondio: {result.get('message', 'success')}")
            return {
                "success": True,
                "message": f"Alerta enviada: {symbol} {pattern_direction}",
                "trading_bot_response": result
            }
        else:
            error_msg = result.get("detail", result.get("message", f"HTTP {response.status_code}"))
            print(f"[ZONE_ALERT] REJECTED: {symbol} - {error_msg}")
            return {
                "success": False,
                "error": f"TradingBot rechazo la alerta: {error_msg}",
                "trading_bot_response": result
            }

    except httpx.ConnectError:
        print(f"[ZONE_ALERT] ERROR: No se pudo conectar al TradingBot en {trading_bot_url}")
        return {"success": False, "error": f"No se pudo conectar al TradingBot en {trading_bot_url}. Verifica que este corriendo."}
    except httpx.TimeoutException:
        print(f"[ZONE_ALERT] ERROR: Timeout al conectar con TradingBot")
        return {"success": False, "error": "Timeout al conectar con TradingBot (10s)"}
    except Exception as e:
        print(f"[ZONE_ALERT] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/zones/send-alerts-batch")
async def send_zone_alerts_batch(request: Request):
    """
    Envia alertas para multiples zonas con breakout al TradingBot.
    Solo envia zonas con trade_result != 'SKIPPED' y != 'NO_ENTRY' que tengan entry_price, sl_price y tp_price.
    """
    try:
        body = await request.json()
        zones = body.get("zones", [])
        symbol = body.get("symbol", "").upper()
        trading_bot_url = body.get("trading_bot_url", "http://localhost:5000")
        entry_mode = body.get("entry_mode", "breakout_close")
        order_type = body.get("order_type", "market").lower()  # "market" o "limit"

        if not zones or not symbol:
            return {"success": False, "error": "Se requieren zones y symbol"}

        # Filtrar zonas validas para alertas
        valid_zones = []
        for z in zones:
            trade_result = z.get("trade_result", "")
            if trade_result in ("SKIPPED", "NO_ENTRY", ""):
                continue
            if not z.get("entry_price"):
                continue
            # Para limit, necesitamos sl_price y tp_price
            if order_type == "limit" and (not z.get("sl_price") or not z.get("tp_price")):
                continue
            valid_zones.append(z)

        if not valid_zones:
            return {"success": False, "error": "No hay zonas validas para enviar alertas", "filtered": len(zones)}

        print(f"[ZONE_ALERT_BATCH] {symbol} | {len(valid_zones)} zonas validas | order_type={order_type.upper()}")

        results = []
        sent = 0
        failed = 0

        async with httpx.AsyncClient(timeout=10) as client:
            for z in valid_zones:
                direction = z.get("breakout_direction", "")
                if direction == "UP":
                    pattern_direction = "LONG"
                elif direction == "DOWN":
                    pattern_direction = "SHORT"
                else:
                    continue

                alert_payload = {
                    "source": "ZONE_DETECTOR",
                    "symbol": symbol,
                    "interval": "0",
                    "pattern": {
                        "patternType": f"ZONE_BREAKOUT_{entry_mode.upper()}",
                        "price": float(z["entry_price"]),
                        "confidence": float(z.get("trading_score", 70)),
                        "direction": pattern_direction
                    }
                }

                if order_type == "limit":
                    # Limit: entry_price como precio limite, TP/SL exactos de la simulacion
                    alert_payload["order_type"] = "Limit"
                    alert_payload["limit_price"] = float(z["entry_price"])
                    alert_payload["custom_stop_loss"] = float(z["sl_price"])
                    alert_payload["custom_take_profit"] = float(z["tp_price"])
                else:
                    # Market: sin custom TP/SL, el TradingBot usara sus defaults
                    alert_payload["order_type"] = "Market"

                try:
                    target_url = f"{trading_bot_url}/api/watchlist-alert"
                    response = await client.post(target_url, json=alert_payload)
                    result = response.json()
                    success = response.status_code == 200 and result.get("success")

                    results.append({
                        "zone_id": z.get("id", "?"),
                        "direction": pattern_direction,
                        "entry_price": z["entry_price"],
                        "success": success,
                        "message": result.get("message", "") if success else result.get("detail", result.get("message", ""))
                    })

                    if success:
                        sent += 1
                    else:
                        failed += 1

                except Exception as e:
                    results.append({
                        "zone_id": z.get("id", "?"),
                        "direction": pattern_direction,
                        "entry_price": z["entry_price"],
                        "success": False,
                        "message": str(e)
                    })
                    failed += 1

        print(f"[ZONE_ALERT_BATCH] {symbol}: {sent} enviadas, {failed} fallidas de {len(valid_zones)} validas")

        return {
            "success": sent > 0,
            "sent": sent,
            "failed": failed,
            "total_valid": len(valid_zones),
            "total_zones": len(zones),
            "results": results
        }

    except httpx.ConnectError:
        return {"success": False, "error": f"No se pudo conectar al TradingBot"}
    except Exception as e:
        print(f"[ZONE_ALERT_BATCH] ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =============================================
# ZONE DETECTOR - SERVICIO REALTIME
# =============================================

@app.get("/api/zones/realtime/status")
async def get_zone_realtime_status():
    """Estado del servicio de deteccion de zonas en tiempo real."""
    try:
        zone_service = get_zone_service()
        return {"success": True, **zone_service.get_status()}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/zones/realtime/config")
async def update_zone_realtime_config(request: Request):
    """Actualiza configuracion del servicio realtime de zonas."""
    try:
        body = await request.json()
        zone_service = get_zone_service()

        # Verificar si se necesita start/stop
        was_enabled = zone_service.config.enabled
        was_running = zone_service.running

        result = zone_service.update_config(body)

        now_enabled = zone_service.config.enabled

        # Si se acaba de habilitar y no estaba corriendo, iniciar
        if now_enabled and not was_running:
            await zone_service.start()
            print("[ZONE_REALTIME] Servicio iniciado via config update")

        # Si se acaba de deshabilitar y estaba corriendo, detener
        if not now_enabled and was_running:
            await zone_service.stop()
            print("[ZONE_REALTIME] Servicio detenido via config update")

        # Si cambio el interval o symbols y esta corriendo, reiniciar
        if was_running and now_enabled:
            restart_keys = {"interval", "symbols", "window_candles"}
            if restart_keys.intersection(set(result.get("updated", []))):
                await zone_service.stop()
                zone_service._known_zones.clear()
                zone_service._candle_buffers.clear()
                zone_service._recent_zones.clear()
                await zone_service.start()
                print("[ZONE_REALTIME] Servicio reiniciado por cambio de interval/symbols")

        return {"success": True, **result, "status": zone_service.get_status()}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/zones/realtime/start")
async def start_zone_realtime():
    """Inicia el servicio de deteccion de zonas en tiempo real."""
    try:
        zone_service = get_zone_service()
        if zone_service.running:
            return {"success": True, "message": "Ya esta corriendo"}
        zone_service.config.enabled = True
        zone_service._save_config()
        await zone_service.start()
        return {"success": True, "message": "Servicio iniciado", "status": zone_service.get_status()}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/zones/realtime/stop")
async def stop_zone_realtime():
    """Detiene el servicio de deteccion de zonas en tiempo real."""
    try:
        zone_service = get_zone_service()
        if not zone_service.running:
            return {"success": True, "message": "Ya esta detenido"}
        zone_service.config.enabled = False
        zone_service._save_config()
        await zone_service.stop()
        return {"success": True, "message": "Servicio detenido"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/zones/realtime/zones/{symbol}")
async def get_zone_realtime_zones(symbol: str):
    """Retorna zonas detectadas en tiempo real para un simbolo."""
    try:
        zone_service = get_zone_service()
        zones = zone_service.get_zones(symbol.upper())
        return {"success": True, "symbol": symbol.upper(), "count": len(zones), "zones": zones}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/zones/realtime/reanalyze")
async def reanalyze_zone_realtime():
    """Re-analiza el historico con la configuracion actual."""
    try:
        zone_service = get_zone_service()
        if not zone_service.running:
            return {"success": False, "error": "Servicio no esta corriendo"}
        await zone_service.reanalyze()
        return {"success": True, "message": "Re-analisis completado", "status": zone_service.get_status()}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/zones/realtime/clear-cooldowns")
async def clear_zone_realtime_cooldowns():
    """Limpia cooldowns del servicio de zonas (para testing)."""
    try:
        zone_service = get_zone_service()
        zone_service.clear_cooldowns()
        return {"success": True, "message": "Cooldowns limpiados"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.get("/api/zones/realtime/metrics/{symbol}")
async def get_zone_realtime_metrics(
    symbol: str,
    interval: str = "60",
    days: int = 1,
    detection_method: str = "trading_zones",
    consol_min_bars: int = 8,
    consol_atr_ratio: float = 0.6,
    consol_max_range_pct: float = 2.0,
    consol_body_ratio: float = 0.5,
    atr_dyn_period: int = 200,
    atr_dyn_ma_period: int = 20,
    atr_dyn_multiplier: float = 1.0,
    use_ttm_prefilter: bool = False,
    use_bbwp_scoring: bool = False,
    atr_band_ma_period: int = 20,
    ttm_atr_length: int = 20,
    ttm_kc_multiplier: float = 1.5,
    bbwp_lookback: int = 252,
    bbwp_squeeze_threshold: float = 20,
):
    """
    Retorna metricas por candle para las barras de estado del Zone Detector.
    Cada metrica es un bool por candle: True = condicion cumplida.
    Carga velas historicas directamente de Bybit API (no depende del buffer realtime).

    Para que el global_atr sea representativo (como en la deteccion real), se cargan
    datos extra de contexto (minimo 7 dias) aunque el chart solo muestre 1 dia.
    """
    try:
        zone_service = get_zone_service()

        # Construir dict de params para pasar al compute
        metrics_params = {
            "detection_method": detection_method,
            "consol_min_bars": consol_min_bars,
            "consol_atr_ratio": consol_atr_ratio,
            "consol_max_range_pct": consol_max_range_pct,
            "consol_body_ratio": consol_body_ratio,
            "atr_dyn_period": atr_dyn_period,
            "atr_dyn_ma_period": atr_dyn_ma_period,
            "atr_dyn_multiplier": atr_dyn_multiplier,
            "use_ttm_prefilter": use_ttm_prefilter,
            "use_bbwp_scoring": use_bbwp_scoring,
            "atr_band_ma_period": atr_band_ma_period,
            "ttm_atr_length": ttm_atr_length,
            "ttm_kc_multiplier": ttm_kc_multiplier,
            "bbwp_lookback": bbwp_lookback,
            "bbwp_squeeze_threshold": bbwp_squeeze_threshold,
        }

        # Normalizar interval
        interval_clean = interval.replace("m", "").replace("h", "").replace("d", "D").replace("w", "W")
        if "h" in interval.lower() and interval_clean.isdigit():
            interval_clean = str(int(interval_clean) * 60)
        interval_final = INTERVAL_MAP.get(interval_clean, "15")
        interval_minutes = get_interval_minutes(interval_final)

        # Calcular velas necesarias para el rango visible
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)
        visible_candles_count = int(days_to_fetch * 24 * 60 / interval_minutes)

        # Contexto extra para global_atr: minimo 7 dias o 500 velas
        context_days = max(days_to_fetch, 7)
        context_days = min(context_days, max_days_allowed)
        context_candles_count = int(context_days * 24 * 60 / interval_minutes)
        # Asegurar minimo 500 velas de contexto
        context_candles_count = max(context_candles_count, 500)
        total_to_fetch = max(visible_candles_count, context_candles_count)

        # Fetch de Bybit API
        now_ms = int(time.time() * 1000)
        start_ms = now_ms - (context_days * 24 * 60 * 60 * 1000)
        # Ajustar start para cubrir el total_to_fetch
        candles_start_ms = now_ms - int(total_to_fetch * interval_minutes * 60 * 1000)
        start_ms = min(start_ms, candles_start_ms)
        all_candles = []

        async with httpx.AsyncClient(timeout=30) as client:
            current_start = start_ms
            max_requests = 20
            for req_num in range(max_requests):
                remaining = total_to_fetch - len(all_candles)
                if remaining <= 0:
                    break
                fetch_limit = min(1000, remaining)
                url = (
                    "https://api.bybit.com/v5/market/kline?"
                    f"category=linear&symbol={symbol.upper()}&interval={interval_final}"
                    f"&start={current_start}&limit={fetch_limit}"
                )
                try:
                    r = await client.get(url)
                    data = r.json()
                except Exception:
                    break
                if data.get("retCode") != 0:
                    break
                batch = data["result"]["list"]
                if not batch:
                    break
                batch.reverse()
                all_candles.extend(batch)
                last_ts = int(batch[-1][0])
                current_start = last_ts + (interval_minutes * 60 * 1000)
                if current_start >= now_ms:
                    break
                await asyncio.sleep(0.05)

        # Convertir a formato dict
        all_dicts = []
        for c in all_candles:
            all_dicts.append({
                "timestamp": int(c[0]),
                "open": float(c[1]),
                "high": float(c[2]),
                "low": float(c[3]),
                "close": float(c[4]),
                "volume": float(c[5]),
            })

        # Separar: contexto completo vs rango visible
        context_candles = all_dicts  # Todas las velas para global_atr
        visible_candles = all_dicts[-visible_candles_count:] if len(all_dicts) > visible_candles_count else all_dicts

        metrics = zone_service.compute_per_candle_metrics(
            symbol.upper(), visible_candles,
            context_candles=context_candles,
            params=metrics_params
        )
        return {"success": True, "symbol": symbol.upper(), **metrics}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# ============================================================
# Zone Detector Presets (persistencia en archivo JSON)
# ============================================================

_ZONE_PRESETS_FILE = Path("config") / "zone_detector_presets.json"


def _load_zone_presets() -> dict:
    if _ZONE_PRESETS_FILE.exists():
        try:
            return json.loads(_ZONE_PRESETS_FILE.read_text(encoding="utf-8"))
        except Exception:
            return {}
    return {}


def _save_zone_presets(presets: dict):
    _ZONE_PRESETS_FILE.write_text(
        json.dumps(presets, indent=2, ensure_ascii=False), encoding="utf-8"
    )


@app.get("/api/zones/presets")
async def get_zone_presets():
    """Retorna todos los presets guardados."""
    try:
        presets = _load_zone_presets()
        return {"success": True, "presets": presets}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.post("/api/zones/presets/{name}")
async def save_zone_preset(name: str, request: Request):
    """Guarda o actualiza un preset."""
    try:
        body = await request.json()
        presets = _load_zone_presets()
        presets[name] = {
            "params": body.get("params", {}),
            "zoneDays": body.get("zoneDays"),
            "savedAt": body.get("savedAt", ""),
        }
        _save_zone_presets(presets)
        return {"success": True, "message": f"Preset '{name}' guardado"}
    except Exception as e:
        return {"success": False, "error": str(e)}


@app.delete("/api/zones/presets/{name}")
async def delete_zone_preset(name: str):
    """Elimina un preset por nombre."""
    try:
        presets = _load_zone_presets()
        if name not in presets:
            return {"success": False, "error": f"Preset '{name}' no existe"}
        del presets[name]
        _save_zone_presets(presets)
        return {"success": True, "message": f"Preset '{name}' eliminado"}
    except Exception as e:
        return {"success": False, "error": str(e)}