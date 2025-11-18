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

        # Detectar pivot high (resistencia)
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
                'type': 'resistance',
                'price': high,
                'timestamp': candle['timestamp'],
                'volume': volume,
                'z_score': z_scores[i] if z_scores else 0.0,
                'candle_index': i
            })

        # Detectar pivot low (soporte)
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
                'type': 'support',
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

    # Separar soportes y resistencias
    supports = [p for p in pivots if p['type'] == 'support']
    resistances = [p for p in pivots if p['type'] == 'resistance']

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

    support_clusters = cluster_group(supports)
    resistance_clusters = cluster_group(resistances)

    # Convertir clusters a niveles con metadata
    levels = []

    for cluster in support_clusters:
        avg_price = sum(p['price'] for p in cluster) / len(cluster)
        avg_volume = sum(p['volume'] for p in cluster) / len(cluster)
        avg_z_score = sum(p['z_score'] for p in cluster) / len(cluster)

        levels.append({
            'type': 'support',
            'price': avg_price,
            'touches': len(cluster),
            'touch_timestamps': [p['timestamp'] for p in cluster],
            'first_touch': min(p['timestamp'] for p in cluster),
            'last_touch': max(p['timestamp'] for p in cluster),
            'avg_volume': avg_volume,
            'avg_z_score': avg_z_score,
            'pivots': cluster
        })

    for cluster in resistance_clusters:
        avg_price = sum(p['price'] for p in cluster) / len(cluster)
        avg_volume = sum(p['volume'] for p in cluster) / len(cluster)
        avg_z_score = sum(p['z_score'] for p in cluster) / len(cluster)

        levels.append({
            'type': 'resistance',
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

        print(f"[{symbol}] 📊 SUPPORT/RESISTANCE: interval={interval_final}, days={days}, z_threshold={z_score_threshold}")

        # Intentar cargar del cache
        cache_key = f"sr_{volume_method}_{z_score_threshold}_{z_score_period}_{left_bars}_{right_bars}_{min_touches}_{cluster_distance}"
        cached_data = load_cache(symbol, interval_final, cache_key)

        if cached_data and cached_data.get("symbol") == symbol:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] ✅ {symbol} {interval_final} S/R desde cache (age: {cache_age:.0f}s)")

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

        # Calcular strength para cada nivel
        current_time_ms = int(time.time() * 1000)
        current_price = candles[-1]['close']

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

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    from alert_sender import initialize_alert_sender
    await initialize_alert_sender()
    print("[STARTUP] Backend started successfully")
    print("[STARTUP] Alert sender initialized")
    print("[STARTUP] Proximity alerts system ready")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    from alert_sender import shutdown_alert_sender
    await shutdown_alert_sender()
    print("[SHUTDOWN] Backend shutdown complete")