# -*- coding: utf-8 -*-
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx
import asyncio
import time
import json
from pathlib import Path
from datetime import datetime, timezone, timedelta

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
    "1": 5,      # 5 min -> máx 5 días
    "3": 10,     # 3 min -> máx 10 días
    "5": 5,      # 5 min -> máx 5 días
    "15": 15,    # 15 min -> máx 15 días
    "30": 30,    # 30 min -> máx 30 días
    "60": 120,   # 1 hora -> máx 120 días
    "120": 180,  # 2 horas -> máx 180 días
    "240": 300,  # 4 horas -> máx 300 días
    "D": 730,    # 1 día -> máx 730 días
    "W": 730,    # 1 semana -> máx 730 días
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
async def get_historical(symbol: str, interval: str = "15", days: int = 30):
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

        # CRÍTICO: Aplicar límite máximo por timeframe
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        days_to_fetch = min(days, max_days_allowed)
        
        print(f"[{symbol}] 📊 HISTORICAL: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

        interval_minutes = get_interval_minutes(interval_final)
        minutes_in_period = days_to_fetch * 24 * 60
        total_candles_needed = int(minutes_in_period / interval_minutes)
        
        # CRÍTICO: Limitar a 1000 velas por request (máximo de Bybit)
        limit_per_request = min(1000, total_candles_needed)
        
        now_ms = int(time.time() * 1000)
        # Buffer de 10 minutos al futuro
        end_ms = now_ms + (10 * 60 * 1000)
        start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)

        all_candles = []
        current_start = start_ms
        
        async with httpx.AsyncClient(timeout=30) as client:
            request_count = 0
            max_requests = 10
            
            while len(all_candles) < total_candles_needed and request_count < max_requests:
                request_count += 1
                candles_remaining = total_candles_needed - len(all_candles)
                fetch_limit = min(limit_per_request, candles_remaining)
                
                url = (
                    "https://api.bybit.com/v5/market/kline?"
                    f"category=linear&symbol={symbol}&interval={interval_final}"
                    f"&start={current_start}&limit={fetch_limit}"
                )
                
                r = await client.get(url)
                data = r.json()

                if data.get("retCode") != 0:
                    print(f"[ERROR {symbol}] Bybit error: {data.get('retMsg')}")
                    break

                batch_candles = data["result"]["list"]
                if not batch_candles:
                    break
                
                batch_candles.reverse()
                all_candles.extend(batch_candles)
                
                last_candle_ts = int(batch_candles[-1][0])
                current_start = last_candle_ts + (interval_minutes * 60 * 1000)
                
                if current_start >= end_ms:
                    break
                
                # Si ya tenemos suficientes velas, salir
                if len(all_candles) >= total_candles_needed:
                    break
                
                await asyncio.sleep(0.1)

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
        
        print(f"[{symbol}] Historical: ✅ Devolviendo {len(candles)} velas (esperadas: {total_candles_needed})")
        
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
            "days_requested": days,
            "days_fetched": days_to_fetch,
            "max_days_allowed": max_days_allowed
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
        
        print(f"[{symbol}] 📈 VOLUME DELTA: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")
        
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
                    
                    print(f"[CACHE HIT] ✅ {symbol} {interval_final} devolviendo {len(processed_data)} velas desde cache")
                    
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
                    print(f"[CACHE MISS] ❌ {symbol} {interval_final} - Cache insuficiente, recalculando...")
        
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

        print(f"[{symbol}] 📊 OPEN INTEREST: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

        # Intentar cargar del cache
        cached_data = load_cache(symbol, interval_final, "openinterest")

        if cached_data and cached_data.get("symbol") == symbol and cached_data.get("interval") == interval_final:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] ✅ {symbol} {interval_final} Open Interest desde cache (age: {cache_age:.0f}s)")

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

        # Calcular cuántos datos necesitamos
        interval_minutes = get_interval_minutes(interval_final)
        minutes_in_period = days_to_fetch * 24 * 60
        total_points_needed = int(minutes_in_period / interval_minutes)

        print(f"[CALCULATING] {symbol} {interval_final} Open Interest... necesitamos {total_points_needed} puntos")

        # Bybit Open Interest usa intervalos específicos
        # 5min, 15min, 30min, 1h, 4h, 1d
        oi_interval_map = {
            "5": "5min",
            "15": "15min",
            "30": "30min",
            "60": "1h",
            "120": "2h",
            "240": "4h",
            "D": "1d"
        }

        oi_interval = oi_interval_map.get(interval_final, "15min")

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

                print(f"[BYBIT API] Request {request_count}/{max_requests}: endTime={current_end} ({len(all_oi_data)}/{total_points_needed} puntos)")
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

            # Procesar datos
            # all_oi_data ya está en orden cronológico (ascendente)
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

        print(f"[REJECTION PATTERNS] ✅ Detected {len(patterns)} patterns for {symbol}")

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


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    from alert_sender import initialize_alert_sender
    await initialize_alert_sender()
    print("[STARTUP] Backend started successfully")
    print("[STARTUP] Alert sender initialized")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    from alert_sender import shutdown_alert_sender
    await shutdown_alert_sender()
    print("[SHUTDOWN] Backend shutdown complete")