# -*- coding: utf-8 -*-
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from contextlib import asynccontextmanager
import httpx
import asyncio
import time
import json
import sys
import numpy as np
from pathlib import Path
from datetime import datetime, timezone, timedelta
from collections import OrderedDict

# Rate Limiting
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

limiter = Limiter(key_func=get_remote_address)

# Configuración global
COLOMBIA_TZ = timezone(timedelta(hours=-5))
CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(exist_ok=True)
BACKTESTING_CACHE_DIR = Path("backtesting_cache")
BACKTESTING_CACHE_DIR.mkdir(exist_ok=True)


# =============================================================================
# LRU CACHE CON LÍMITE DE MEMORIA
# =============================================================================
class LimitedMemoryCache:
    """
    Caché LRU (Least Recently Used) con límite de memoria.
    Evicta entradas antiguas cuando se supera el límite.
    """

    def __init__(self, max_size_mb: int = 100, name: str = "cache"):
        self.cache = OrderedDict()
        self.max_bytes = max_size_mb * 1024 * 1024
        self.current_bytes = 0
        self.name = name
        self.hits = 0
        self.misses = 0

    def _estimate_size(self, value) -> int:
        """Estima el tamaño en bytes de un valor."""
        try:
            # Para listas/dicts, serializar a JSON es más preciso
            if isinstance(value, (dict, list)):
                return len(json.dumps(value, default=str).encode('utf-8'))
            return sys.getsizeof(value)
        except:
            return 1024  # Fallback: asumir 1KB

    def get(self, key: str):
        """Obtiene un valor del caché, moviéndolo al final (más reciente)."""
        if key in self.cache:
            self.cache.move_to_end(key)
            self.hits += 1
            return self.cache[key]
        self.misses += 1
        return None

    def set(self, key: str, value):
        """Guarda un valor en el caché, evictando si es necesario."""
        size = self._estimate_size(value)

        # Si el valor es más grande que el límite total, no almacenar
        if size > self.max_bytes:
            print(f"[{self.name}] WARN: Valor demasiado grande ({size / 1024 / 1024:.1f}MB > {self.max_bytes / 1024 / 1024:.0f}MB), no se almacena")
            return

        # Si la key ya existe, remover primero para recalcular tamaño
        if key in self.cache:
            old_size = self._estimate_size(self.cache[key])
            self.current_bytes -= old_size
            del self.cache[key]

        # Evictar entradas antiguas hasta que haya espacio
        evicted = 0
        while self.current_bytes + size > self.max_bytes and self.cache:
            old_key, old_val = self.cache.popitem(last=False)  # FIFO - remueve el más antiguo
            old_size = self._estimate_size(old_val)
            self.current_bytes -= old_size
            evicted += 1

        if evicted > 0:
            print(f"[{self.name}] Evicted {evicted} entries to make room (current: {self.current_bytes / 1024 / 1024:.1f}MB)")

        # Guardar el nuevo valor
        self.cache[key] = value
        self.current_bytes += size

    def __contains__(self, key: str) -> bool:
        """Permite usar 'key in cache'."""
        return key in self.cache

    def __getitem__(self, key: str):
        """Permite usar cache[key]."""
        value = self.get(key)
        if value is None:
            raise KeyError(key)
        return value

    def __setitem__(self, key: str, value):
        """Permite usar cache[key] = value."""
        self.set(key, value)

    def stats(self) -> dict:
        """Retorna estadísticas del caché."""
        total_requests = self.hits + self.misses
        hit_rate = (self.hits / total_requests * 100) if total_requests > 0 else 0
        return {
            "name": self.name,
            "entries": len(self.cache),
            "size_mb": round(self.current_bytes / 1024 / 1024, 2),
            "max_size_mb": self.max_bytes / 1024 / 1024,
            "hits": self.hits,
            "misses": self.misses,
            "hit_rate_percent": round(hit_rate, 1)
        }

    def clear(self):
        """Limpia todo el caché."""
        self.cache.clear()
        self.current_bytes = 0
        self.hits = 0
        self.misses = 0


# >> Caché en memoria para velas de DTB (evitar enviar 11MB cada vez)
# Límite: 150MB (aproximadamente 13-14 símbolos × timeframe)
DTB_CANDLES_CACHE = LimitedMemoryCache(max_size_mb=150, name="DTB_CANDLES")

# >> Caché en memoria para patrones DTB divididos por chunks (sin sesgo de supervivencia)
# Límite: 50MB (patrones son más pequeños que velas)
DTB_PATTERNS_CACHE = LimitedMemoryCache(max_size_mb=50, name="DTB_PATTERNS")
# Formato: { "BTCUSDT_15m": { "2023-Q1": [...], "2023-Q2": [...], ... } }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    from alert_sender import initialize_alert_sender
    await initialize_alert_sender()
    print("[STARTUP] Backend started successfully")
    print("[STARTUP] Alert sender initialized")
    print(f"[STARTUP] Backtesting cache directory: {BACKTESTING_CACHE_DIR.absolute()}")

    yield

    # Shutdown
    from alert_sender import shutdown_alert_sender
    await shutdown_alert_sender()
    print("[SHUTDOWN] Backend shutdown complete")


app = FastAPI(
    title="Crypto Watchlist Backend",
    description="Servidor backend para la Watchlist de criptomonedas con Bybit Futures",
    version="2.7.0 - Rate Limiting",
    lifespan=lifespan
)

# Rate Limiting: registrar en la app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# SEGURIDAD: CORS limitado a orígenes conocidos
# Backtester frontend corre en puerto 9001
ALLOWED_ORIGINS = [
    "http://localhost:9001",      # Backtester frontend (Vite)
    "http://127.0.0.1:9001",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
)

# Cache reducido a 30 minutos para datos más frescos
CACHE_MAX_AGE = 1800  # 30 minutos en segundos

# Límites máximos de días por timeframe
# NOTA: 1m y 5m tienen límites extendidos para backtesting
MAX_DAYS_BY_INTERVAL = {
    "1": 365,    # 1 minuto -> máx 1 año (525,600 velas) - BACKTESTING
    "3": 10,     # 3 min -> máx 10 días
    "5": 1095,   # 5 minutos -> máx 3 años (315,360 velas) - BACKTESTING
    "15": 730,   # 15 min -> máx 2 años (para backtesting)
    "30": 730,   # 30 min -> máx 2 años
    "60": 730,   # 1 hora -> máx 2 años
    "120": 730,  # 2 horas -> máx 2 años
    "240": 730,  # 4 horas -> máx 2 años
    "D": 730,    # 1 día -> máx 730 días
    "W": 730,    # 1 semana -> máx 730 días
}

def sanitize_filename(name: str) -> str:
    """
    Sanitiza un nombre para uso seguro en rutas de archivo.
    Previene Path Traversal eliminando caracteres peligrosos.
    """
    import re
    # Solo permite alfanuméricos, guiones y guiones bajos
    sanitized = re.sub(r'[^a-zA-Z0-9_\-]', '', name)
    # Previene nombres vacíos
    if not sanitized:
        sanitized = "invalid"
    return sanitized


def load_cache(symbol: str, interval: str, indicator: str):
    """Carga datos del cache si existen y son recientes"""
    # SEGURIDAD: Sanitizar inputs para prevenir Path Traversal
    safe_symbol = sanitize_filename(symbol)
    safe_interval = sanitize_filename(interval)
    safe_indicator = sanitize_filename(indicator)

    cache_file = CACHE_DIR / f"{safe_symbol}_{safe_interval}_{safe_indicator}.json"
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
    # SEGURIDAD: Sanitizar inputs para prevenir Path Traversal
    safe_symbol = sanitize_filename(symbol)
    safe_interval = sanitize_filename(interval)
    safe_indicator = sanitize_filename(indicator)

    data['timestamp'] = time.time()
    cache_file = CACHE_DIR / f"{safe_symbol}_{safe_interval}_{safe_indicator}.json"
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
@limiter.limit("100/minute")
def status(request: Request):
    now_utc = datetime.now(timezone.utc)
    now_colombia = now_utc.astimezone(COLOMBIA_TZ)

    cache_files = list(CACHE_DIR.glob("*_volumedelta.json"))

    return {
        "status": "ok",
        "time_utc": int(now_utc.timestamp()),
        "time_colombia": now_colombia.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "America/Bogota (UTC-5)",
        "cache_files": len(cache_files),
        "version": "2.6.0 - OPT: LRU Cache con límite de memoria",
        "cache_duration": "30 minutos",
        "cache_max_age_seconds": CACHE_MAX_AGE,
        "max_days_limits": MAX_DAYS_BY_INTERVAL,
        "memory_cache": {
            "dtb_candles": DTB_CANDLES_CACHE.stats(),
            "dtb_patterns": DTB_PATTERNS_CACHE.stats()
        }
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

async def _fetch_historical_internal(symbol: str, interval: str = "15", days: int = 30, skip_day_limit: bool = False):
    """
    Función interna para obtener datos históricos SIN rate limiting.
    Usada por otros endpoints internamente.

    Args:
        symbol: Par de trading (ej: BTCUSDT)
        interval: Timeframe (1, 5, 15, 60, D, etc)
        days: Días de datos a obtener
        skip_day_limit: Si True, no aplica MAX_DAYS_BY_INTERVAL (para backtesting)
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

        # Aplicar límite máximo por timeframe (opcional para backtesting)
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        if skip_day_limit:
            # Para backtesting, permitir hasta 1095 días (3 años)
            max_days_allowed = max(max_days_allowed, 1095)
        days_to_fetch = min(days, max_days_allowed)

        print(f"[{symbol}] [DATA] HISTORICAL: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

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

        # Para backtesting con muchos días, permitir más requests
        # 1m x 365 días = 525,600 velas = ~526 requests
        # 5m x 1095 días = 315,360 velas = ~316 requests
        max_requests = 600 if skip_day_limit else 10

        async with httpx.AsyncClient(timeout=120) as client:  # Timeout aumentado para cargas grandes
            request_count = 0

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

        print(f"[{symbol}] Historical: OK Devolviendo {len(candles)} velas (esperadas: {total_candles_needed})")

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


@app.get("/api/historical/{symbol}")
@limiter.limit("60/minute")
async def get_historical(request: Request, symbol: str, interval: str = "15", days: int = 30):
    """Endpoint HTTP para obtener datos históricos (con rate limiting)."""
    return await _fetch_historical_internal(symbol, interval, days)

@app.get("/api/volume-delta/{symbol}")
@limiter.limit("60/minute")
async def get_volume_delta(request: Request, symbol: str, interval: str = "15", days: int = 30):
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
        
        print(f"[{symbol}] [CHART] VOLUME DELTA: Recibido days={days}, aplicando límite -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")
        
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
                    
                    print(f"[CACHE HIT] OK {symbol} {interval_final} devolviendo {len(processed_data)} velas desde cache")
                    
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

        historical = await _fetch_historical_internal(symbol, interval_final, days_to_fetch)
        
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
async def get_open_interest(
    symbol: str,
    interval: str = "15",
    days: int = 30,
    start_timestamp_ms: int = None,  # >> NUEVO: timestamp de inicio opcional (para backtesting)
    end_timestamp_ms: int = None     # >> NUEVO: timestamp de fin opcional (para backtesting)
):
    """
    Endpoint para obtener Open Interest de Bybit Futures
    Calcula OI Flow Sentiment siguiendo el patrón LuxAlgo

    Parámetros opcionales para backtesting:
    - start_timestamp_ms: timestamp en milisegundos del inicio del rango
    - end_timestamp_ms: timestamp en milisegundos del fin del rango

    Si se proporcionan, se ignora el parámetro 'days' y se usa el rango exacto.
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

        print(f"[{symbol}] OPEN INTEREST: Recibido days={days}, aplicando limite -> days_to_fetch={days_to_fetch} (max: {max_days_allowed}) @ {interval_final}")

        # >> CORREGIDO: Intentar cargar del cache solo en modo LIVE (no backtesting)
        # En modo backtesting, el caché se maneja a nivel superior (backtesting cache)
        cached_data = None
        if start_timestamp_ms is None and end_timestamp_ms is None:
            cached_data = load_cache(symbol, interval_final, "openinterest")

        if cached_data and cached_data.get("symbol") == symbol and cached_data.get("interval") == interval_final:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] OK {symbol} {interval_final} Open Interest desde cache (age: {cache_age:.0f}s)")

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

        print(f"[OI CALCULATION] interval_final={interval_final} -> oi_interval={oi_interval} ({oi_interval_minutes} min)")
        print(f"[OI CALCULATION] {days_to_fetch} días × 24h × 60min / {oi_interval_minutes} min = {total_points_needed} puntos necesarios")

        # Bybit devuelve máximo 200 puntos por request
        limit_per_request = 200

        # Calcular timestamps
        # >> CORREGIDO: Si se proporcionan timestamps específicos (backtesting), usarlos
        if start_timestamp_ms is not None and end_timestamp_ms is not None:
            start_ms = start_timestamp_ms
            end_ms = end_timestamp_ms
            print(f"[OI BACKTESTING MODE] Usando rango específico: {start_ms} - {end_ms}")
            start_date = datetime.fromtimestamp(start_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            end_date = datetime.fromtimestamp(end_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d %H:%M")
            print(f"[OI BACKTESTING MODE] Rango: {start_date} -> {end_date}")
        else:
            # Modo normal: desde ahora hacia atrás
            now_ms = int(time.time() * 1000)
            end_ms = now_ms + (10 * 60 * 1000)  # Buffer de 10 minutos al futuro
            start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)
            print(f"[OI LIVE MODE] Obteniendo desde ahora hacia atrás: {days_to_fetch} días")

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
                # >> DEBUG: Log URL completa
                print(f"[OI DEBUG] Full URL: {url}")

                r = await client.get(url)
                data = r.json()

                # >> DEBUG: Log respuesta de Bybit
                print(f"[OI DEBUG] Bybit retCode={data.get('retCode')}, retMsg={data.get('retMsg', 'OK')}")
                if data.get("result"):
                    print(f"[OI DEBUG] Result list length: {len(data.get('result', {}).get('list', []))}")

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
                print(f"[BATCH] Recibidos {len(oi_batch)} puntos: {batch_oldest} -> {batch_newest}")

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

            # >> CORREGIDO: Guardar en cache solo en modo LIVE (no backtesting)
            if start_timestamp_ms is None and end_timestamp_ms is None:
                cache_data = {
                    "symbol": symbol,
                    "interval": interval_final,
                    "indicator": "openInterest",
                    "data": processed_data
                }
                save_cache(symbol, interval_final, "openinterest", cache_data)
                print(f"[CACHE SAVED] {symbol} {interval_final} Open Interest guardado ({len(processed_data)} puntos)")
            else:
                print(f"[BACKTESTING MODE] Saltando guardado de caché (datos se guardan en backtesting cache)")

            print(f"[SUCCESS] {symbol} {interval_final} Open Interest: {len(processed_data)} puntos")

            # >> DEBUG: Log de respuesta final
            if len(processed_data) > 0:
                print(f"[OI DEBUG FINAL] {symbol} interval={interval_final} oi_interval={oi_interval}")
                print(f"[OI DEBUG FINAL] First 3 items: {processed_data[:3]}")
                print(f"[OI DEBUG FINAL] Last 3 items: {processed_data[-3:]}")
            else:
                print(f"[OI DEBUG FINAL] {symbol} WARNING: processed_data is EMPTY")

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


# ==================== SUPPORT/RESISTANCE FUNCTIONS ====================

def calculate_z_score(values: list, period: int = 50):
    """
    Calcula el Z-Score para cada valor en la lista
    Z-Score = (valor - media) / desviación estándar

    Args:
        values: Lista de valores (ej: volúmenes)
        period: Período para calcular media y desviación estándar

    Returns:
        Lista de z-scores
    """
    import statistics

    z_scores = []

    for i in range(len(values)):
        # Tomar ventana de 'period' valores anteriores (incluyendo el actual)
        start_idx = max(0, i - period + 1)
        window = values[start_idx:i + 1]

        if len(window) < 2:
            z_scores.append(0.0)
            continue

        mean = statistics.mean(window)
        stdev = statistics.stdev(window)

        if stdev == 0:
            z_scores.append(0.0)
        else:
            z_score = (values[i] - mean) / stdev
            z_scores.append(z_score)

    return z_scores


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

        print(f"[{symbol}] [DATA] SUPPORT/RESISTANCE: interval={interval_final}, days={days}, z_threshold={z_score_threshold}")

        # Intentar cargar del cache
        cache_key = f"sr_{volume_method}_{z_score_threshold}_{z_score_period}_{left_bars}_{right_bars}_{min_touches}_{cluster_distance}"
        cached_data = load_cache(symbol, interval_final, cache_key)

        if cached_data and cached_data.get("symbol") == symbol:
            cache_age = time.time() - cached_data.get('timestamp', 0)
            print(f"[CACHE HIT] OK {symbol} {interval_final} S/R desde cache (age: {cache_age:.0f}s)")

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
        historical = await _fetch_historical_internal(symbol, interval_final, days)

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
from typing import Optional
from rejection_detector import RejectionDetector, serialize_pattern
from alert_sender import send_pattern_alert
from double_topbottom_detector import DoubleTopBottomDetector, serialize_pattern as serialize_double_pattern
from vwap_calculator import vwap_calculator

rejection_detector = RejectionDetector()
double_detector = DoubleTopBottomDetector()


# >> Helper function para dividir patrones en chunks trimestrales
def divide_patterns_into_chunks(patterns):
    """
    Divide patrones en chunks por trimestre para evitar sesgo de supervivencia

    Returns:
        dict: { "2023-Q1": [...], "2023-Q2": [...], ... }
    """
    from datetime import datetime
    from collections import defaultdict

    chunks = defaultdict(list)

    for pattern in patterns:
        # Obtener timestamp del patrón (usar segundo extremo como referencia)
        timestamp = pattern.get('secondExtreme', {}).get('timestamp', 0)

        # Convertir a fecha
        dt = datetime.fromtimestamp(timestamp / 1000)  # timestamp en ms

        # Determinar trimestre
        quarter = (dt.month - 1) // 3 + 1
        chunk_key = f"{dt.year}-Q{quarter}"

        chunks[chunk_key].append(pattern)

    # Convertir defaultdict a dict normal y ordenar por clave
    return dict(sorted(chunks.items()))


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
        historical = await _fetch_historical_internal(symbol, interval, days)

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

        print(f"[REJECTION PATTERNS] OK Detected {len(patterns)} patterns for {symbol}")

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


# ==================== BACKTESTING ENGINE ENDPOINTS ====================

@app.get("/api/backtesting/test-metadata")
async def test_backtesting_metadata():
    """
    Endpoint de diagnóstico para probar la generación de metadata
    sin tener que esperar la carga completa de datos
    """
    try:
        print("[TEST-METADATA] Iniciando prueba...")

        # Simular timeframes_data con datos mínimos
        timeframes_data = {
            "1m": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "5m": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "15m": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "1h": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []},
            "4h": {"main": [{"timestamp": 1704067200000}], "subdivisions": [], "open_interest": []}
        }

        print("[TEST-METADATA] PASO 1: Calculando timestamps...")
        all_timestamps = []
        for tf_data in timeframes_data.values():
            all_timestamps.extend([c["timestamp"] for c in tf_data["main"]])

        print(f"[TEST-METADATA] PASO 2: Total timestamps: {len(all_timestamps)}")

        if all_timestamps:
            min_ts = min(all_timestamps)
            max_ts = max(all_timestamps)
            print(f"[TEST-METADATA] PASO 3: min_ts={min_ts}, max_ts={max_ts}")

            start_date = datetime.fromtimestamp(min_ts / 1000, tz=COLOMBIA_TZ)
            end_date = datetime.fromtimestamp(max_ts / 1000, tz=COLOMBIA_TZ)
            print(f"[TEST-METADATA] PASO 4: Fechas calculadas OK")
        else:
            start_date = end_date = datetime.now(COLOMBIA_TZ)

        print("[TEST-METADATA] PASO 5: Construyendo days_info...")
        days_info = {tf: cfg.get("days", 730) for tf, cfg in BACKTESTING_CONFIG.items()}
        print(f"[TEST-METADATA] days_info = {days_info}")

        print("[TEST-METADATA] PASO 6: Construyendo metadata...")
        metadata = {
            "cached_at": int(time.time() * 1000),
            "cached_at_colombia": datetime.now(COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "date_range": {
                "start": start_date.strftime("%Y-%m-%d %H:%M:%S"),
                "end": end_date.strftime("%Y-%m-%d %H:%M:%S"),
                "days_by_timeframe": days_info
            }
        }

        print("[TEST-METADATA] PASO 7: TODO OK!")
        return {
            "success": True,
            "message": "Metadata generado correctamente",
            "metadata": metadata,
            "days_info": days_info
        }

    except Exception as e:
        import traceback
        import sys
        print(f"\n[TEST-METADATA ERROR] {type(e).__name__}: {str(e)}")
        traceback.print_exc()

        exc_type, exc_value, exc_tb = sys.exc_info()
        if exc_tb:
            while exc_tb.tb_next:
                exc_tb = exc_tb.tb_next
            print(f"  Linea: {exc_tb.tb_lineno}")
            print(f"  Funcion: {exc_tb.tb_frame.f_code.co_name}")

        return {
            "success": False,
            "error": str(e),
            "error_type": type(e).__name__
        }


# Configuración de timeframes y subdivisiones para backtesting
# NOTA: 1m y 5m tienen configuración especial con menos días pero más velas
BACKTESTING_CONFIG = {
    "1m": {
        "interval": "1",
        "days": 365,  # 1 año = 525,600 velas
        "subdivisions": {
            "interval": "1",  # Sin subdivisiones (avanza vela completa)
            "count": 1
        }
    },
    "5m": {
        "interval": "5",
        "days": 1095,  # 3 años = 315,360 velas
        "subdivisions": {
            "interval": "1",
            "count": 5  # 5 velas de 1 minuto forman 1 vela de 5 minutos
        }
    },
    "15m": {
        "interval": "15",
        "days": 730,  # 2 años
        "subdivisions": {
            "interval": "5",
            "count": 3  # 3 velas de 5 minutos forman 1 vela de 15 minutos
        }
    },
    "1h": {
        "interval": "60",
        "days": 730,  # 2 años
        "subdivisions": {
            "interval": "15",
            "count": 4  # 4 velas de 15 minutos forman 1 vela de 1 hora
        }
    },
    "4h": {
        "interval": "240",
        "days": 730,  # 2 años
        "subdivisions": {
            "interval": "60",
            "count": 4  # 4 velas de 1 hora forman 1 vela de 4 horas
        }
    }
}


def save_backtesting_cache(symbol: str, data: dict):
    """Guarda datos de backtesting en caché permanente"""
    # SEGURIDAD: Sanitizar symbol para prevenir Path Traversal
    safe_symbol = sanitize_filename(symbol)
    cache_file = BACKTESTING_CACHE_DIR / f"{safe_symbol}_backtesting_data.json"
    with open(cache_file, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"[BACKTESTING CACHE] Guardado {safe_symbol} - {cache_file.stat().st_size / (1024*1024):.2f} MB")


def load_backtesting_cache(symbol: str):
    """Carga datos de backtesting del caché"""
    # SEGURIDAD: Sanitizar symbol para prevenir Path Traversal
    safe_symbol = sanitize_filename(symbol)
    cache_file = BACKTESTING_CACHE_DIR / f"{safe_symbol}_backtesting_data.json"
    if cache_file.exists():
        try:
            with open(cache_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(f"[BACKTESTING CACHE] Cargado {safe_symbol} desde caché - {cache_file.stat().st_size / (1024*1024):.2f} MB")
                return data
        except Exception as e:
            print(f"[BACKTESTING CACHE ERROR] {safe_symbol}: {str(e)}")
    return None


async def fetch_backtesting_timeframe(symbol: str, interval: str, days: int = 1095):
    """
    Descarga datos históricos para un timeframe específico

    Args:
        symbol: Par de trading (ej: BTCUSDT)
        interval: Intervalo (5, 15, 60, 240)
        days: Días a descargar (default 1095 = 3 años)

    Returns:
        Lista de velas o None si hay error
    """
    try:
        interval_minutes = get_interval_minutes(interval)
        minutes_in_period = days * 24 * 60
        total_candles_needed = int(minutes_in_period / interval_minutes)

        print(f"[BACKTESTING] {symbol} @ {interval}m - Necesitamos {total_candles_needed} velas para {days} días")

        now_ms = int(time.time() * 1000)
        end_ms = now_ms + (10 * 60 * 1000)  # Buffer de 10 minutos
        start_ms = now_ms - (days * 24 * 60 * 60 * 1000)

        all_candles = []
        current_start = start_ms

        async with httpx.AsyncClient(timeout=180) as client:  # Timeout 3 min para cargas grandes
            request_count = 0
            # Calcular max_requests basado en las velas necesarias
            # Cada request trae máximo 1000 velas
            # 1m x 365 días = 525,600 velas = ~526 requests
            # 5m x 1095 días = 315,360 velas = ~316 requests
            max_requests = min(600, (total_candles_needed // 1000) + 10)
            print(f"[BACKTESTING] Permitiendo hasta {max_requests} requests para descargar todas las velas")

            while len(all_candles) < total_candles_needed and request_count < max_requests:
                request_count += 1
                candles_remaining = total_candles_needed - len(all_candles)
                fetch_limit = min(1000, candles_remaining)  # Bybit limit = 1000

                url = (
                    "https://api.bybit.com/v5/market/kline?"
                    f"category=linear&symbol={symbol}&interval={interval}"
                    f"&start={current_start}&limit={fetch_limit}"
                )

                r = await client.get(url)
                data = r.json()

                if data.get("retCode") != 0:
                    print(f"[ERROR {symbol}] Bybit error: {data.get('retMsg')}")
                    break

                batch_candles = data["result"]["list"]
                if not batch_candles:
                    print(f"[INFO {symbol}] No más datos disponibles")
                    break

                batch_candles.reverse()
                all_candles.extend(batch_candles)

                last_candle_ts = int(batch_candles[-1][0])
                current_start = last_candle_ts + (interval_minutes * 60 * 1000)

                if request_count % 10 == 0:
                    print(f"[BACKTESTING] {symbol} @ {interval}m - Descargadas {len(all_candles)}/{total_candles_needed} velas ({request_count} requests)")

                if current_start >= end_ms:
                    break

                if len(all_candles) >= total_candles_needed:
                    break

                await asyncio.sleep(0.1)  # Rate limiting

        # Procesar velas
        candles = []
        for c in all_candles:
            ts_ms = int(c[0])
            candles.append({
                "timestamp": ts_ms,
                "open": float(c[1]),
                "high": float(c[2]),
                "low": float(c[3]),
                "close": float(c[4]),
                "volume": float(c[5])
            })

        print(f"[BACKTESTING] OK {symbol} @ {interval}m - {len(candles)} velas descargadas")
        return candles

    except Exception as e:
        print(f"[ERROR] Backtesting fetch {symbol} @ {interval}m: {str(e)}")
        import traceback
        traceback.print_exc()
        return None


@app.get("/api/backtesting/bulk-data/{symbol}")
@limiter.limit("10/minute")
async def get_backtesting_bulk_data(request: Request, symbol: str, force_refresh: bool = False):
    """
    Descarga y cachea 3 años de datos para backtesting

    NUEVO: El cache NUNCA expira por antiguedad. Los datos historicos se mantienen indefinidamente.
    Solo se invalida con force_refresh=True

    Retorna:
    {
        "symbol": "BTCUSDT",
        "timeframes": {
            "15m": {
                "main": [...],  // Velas de 15 minutos
                "subdivisions": [...]  // Velas de 5 minutos
            },
            "1h": {
                "main": [...],
                "subdivisions": [...]  // Velas de 15 minutos
            },
            "4h": {
                "main": [...],
                "subdivisions": [...]  // Velas de 1 hora
            }
        },
        "metadata": {
            "cached_at": timestamp,
            "total_size_mb": float,
            "date_range": {
                "start": datetime,
                "end": datetime
            }
        }
    }
    """
    try:
        # Intentar cargar del caché si existe
        if not force_refresh:
            cached_data = load_backtesting_cache(symbol)
            if cached_data:
                # >> NUEVO: Caché NUNCA expira - siempre usar datos cacheados si existen
                cached_at = cached_data.get("metadata", {}).get("cached_at", 0)
                now_ms = int(time.time() * 1000)
                age_hours = (now_ms - cached_at) / (1000 * 60 * 60)

                print(f"[BACKTESTING CACHE] OK Usando caché existente ({age_hours:.1f} horas de antigüedad)")
                return {
                    "success": True,
                    "from_cache": True,
                    **cached_data
                }

        print(f"[BACKTESTING] Descargando datos completos para {symbol}...")

        timeframes_data = {}

        # Descargar datos para cada timeframe
        for tf_name, config in BACKTESTING_CONFIG.items():
            # Usar días específicos por timeframe (1m=365, 5m=1095, otros=730)
            tf_days = config.get("days", 730)
            print(f"\n[BACKTESTING] ===== Procesando {tf_name} ({tf_days} días) =====")

            # Descargar velas principales
            main_interval = config["interval"]
            main_candles = await fetch_backtesting_timeframe(symbol, main_interval, tf_days)

            if not main_candles:
                print(f"[ERROR] No se pudieron obtener datos para {tf_name}")
                continue

            # Descargar subdivisiones (usar mismos días que el timeframe principal)
            subdivision_interval = config["subdivisions"]["interval"]
            subdivision_candles = await fetch_backtesting_timeframe(symbol, subdivision_interval, tf_days)

            if not subdivision_candles:
                print(f"[ERROR] No se pudieron obtener subdivisiones para {tf_name}")
                continue

            # >> CORREGIDO: Calcular rango de timestamps de las velas para OI
            # Usar las velas principales para determinar el rango temporal exacto
            min_candle_ts = min(c["timestamp"] for c in main_candles)
            max_candle_ts = max(c["timestamp"] for c in main_candles)

            # Para 1m y 5m, saltar Open Interest (demasiados datos y no es crítico)
            oi_data = []
            if tf_name not in ["1m", "5m"]:
                print(f"\n[BACKTESTING] Obteniendo Open Interest para {tf_name}...")
                print(f"[BACKTESTING] Rango de velas: {datetime.fromtimestamp(min_candle_ts/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M')} -> {datetime.fromtimestamp(max_candle_ts/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M')}")

                # >> CORREGIDO: Pasar timestamps exactos del rango de velas
                oi_response = await get_open_interest(
                    symbol,
                    str(main_interval),
                    tf_days,
                    start_timestamp_ms=min_candle_ts,
                    end_timestamp_ms=max_candle_ts
                )
                oi_data = oi_response.get("data", []) if oi_response.get("success") else []
            else:
                print(f"\n[BACKTESTING] Saltando Open Interest para {tf_name} (demasiados datos)")

            timeframes_data[tf_name] = {
                "main": main_candles,
                "subdivisions": subdivision_candles,
                "subdivision_count": config["subdivisions"]["count"],
                "open_interest": oi_data  # >> AGREGADO
            }

            print(f"[BACKTESTING] {tf_name} completado:")
            print(f"  - Main: {len(main_candles)} velas de {main_interval}m")
            print(f"  - Subdivisions: {len(subdivision_candles)} velas de {subdivision_interval}m")
            print(f"  - Open Interest: {len(oi_data)} puntos")

        # Calcular metadata
        print(f"\n[BACKTESTING] PASO 1: Calculando metadata...")
        all_timestamps = []
        for tf_data in timeframes_data.values():
            all_timestamps.extend([c["timestamp"] for c in tf_data["main"]])

        print(f"[BACKTESTING] PASO 2: Total timestamps: {len(all_timestamps)}")

        if all_timestamps:
            min_ts = min(all_timestamps)
            max_ts = max(all_timestamps)
            print(f"[BACKTESTING] PASO 3: min_ts={min_ts}, max_ts={max_ts}")

            start_date = datetime.fromtimestamp(min_ts / 1000, tz=COLOMBIA_TZ)
            end_date = datetime.fromtimestamp(max_ts / 1000, tz=COLOMBIA_TZ)
            print(f"[BACKTESTING] PASO 4: start_date={start_date}, end_date={end_date}")
        else:
            start_date = end_date = datetime.now(COLOMBIA_TZ)
            print(f"[BACKTESTING] PASO 4: Sin timestamps, usando fecha actual")

        # Construir info de días por timeframe
        print(f"[BACKTESTING] PASO 5: Construyendo days_info...")
        days_info = {tf: cfg.get("days", 730) for tf, cfg in BACKTESTING_CONFIG.items()}
        print(f"[BACKTESTING] PASO 5: days_info = {days_info}")

        print(f"[BACKTESTING] PASO 6: Construyendo metadata dict...")
        metadata = {
            "cached_at": int(time.time() * 1000),
            "cached_at_colombia": datetime.now(COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "date_range": {
                "start": start_date.strftime("%Y-%m-%d %H:%M:%S"),
                "end": end_date.strftime("%Y-%m-%d %H:%M:%S"),
                "days_by_timeframe": days_info  # 1m=365, 5m=1095, otros=730
            }
        }
        print(f"[BACKTESTING] PASO 6: metadata construido OK")

        # Preparar respuesta
        print(f"[BACKTESTING] PASO 7: Preparando response_data...")
        response_data = {
            "symbol": symbol,
            "timeframes": timeframes_data,
            "metadata": metadata
        }
        print(f"[BACKTESTING] PASO 7: response_data listo, timeframes={list(timeframes_data.keys())}")

        # Guardar en caché
        print(f"[BACKTESTING] PASO 8: Guardando en caché...")
        save_backtesting_cache(symbol, response_data)
        print(f"[BACKTESTING] PASO 8: Caché guardado OK")

        print(f"\n[BACKTESTING] OK Datos completos para {symbol} listos")
        print(f"  - Timeframes: {list(timeframes_data.keys())}")
        print(f"  - Rango: {metadata['date_range']['start']} -> {metadata['date_range']['end']}")

        return {
            "success": True,
            "from_cache": False,
            **response_data
        }

    except Exception as e:
        import traceback
        import sys
        print(f"\n{'='*60}")
        print(f"[ERROR CRÍTICO] Backtesting bulk data {symbol}")
        print(f"[ERROR] Tipo: {type(e).__name__}")
        print(f"[ERROR] Mensaje: {str(e)}")
        print(f"[ERROR] Traceback completo:")
        print(f"{'='*60}")
        traceback.print_exc()

        # También imprimir info de la excepción con más detalle
        exc_type, exc_value, exc_tb = sys.exc_info()
        if exc_tb:
            print(f"\n[ERROR] Línea exacta del error:")
            while exc_tb.tb_next:
                exc_tb = exc_tb.tb_next
            print(f"  - Archivo: {exc_tb.tb_frame.f_code.co_filename}")
            print(f"  - Línea: {exc_tb.tb_lineno}")
            print(f"  - Función: {exc_tb.tb_frame.f_code.co_name}")
            print(f"  - Variables locales: {list(exc_tb.tb_frame.f_locals.keys())}")
        print(f"{'='*60}\n")

        return {
            "success": False,
            "error": str(e)
        }


@app.delete("/api/backtesting/cache/{symbol}")
async def delete_backtesting_cache(symbol: str):
    """Elimina el caché de backtesting para un símbolo específico"""
    try:
        cache_file = BACKTESTING_CACHE_DIR / f"{symbol}_backtesting_data.json"
        if cache_file.exists():
            cache_file.unlink()
            return {
                "success": True,
                "message": f"Caché de backtesting eliminado para {symbol}"
            }
        else:
            return {
                "success": False,
                "message": f"No existe caché para {symbol}"
            }
    except Exception as e:
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/backtesting/update/{symbol}")
async def update_backtesting_data(symbol: str):
    """
    >> NUEVO: Actualiza solo los datos nuevos desde la última vela cacheada

    Proceso:
    1. Lee el caché existente
    2. Obtiene el timestamp de la última vela
    3. Descarga solo las velas nuevas desde ese timestamp
    4. Concatena los datos nuevos al caché existente
    5. Actualiza el metadata

    Retorna:
    {
        "success": bool,
        "new_candles_added": int,
        "update_duration_seconds": float
    }
    """
    try:
        import time as time_module
        start_time = time_module.time()

        # Cargar caché existente
        cached_data = load_backtesting_cache(symbol)
        if not cached_data:
            return {
                "success": False,
                "error": "No existe caché para actualizar. Use bulk-data primero."
            }

        print(f"\n[BACKTESTING UPDATE] [UPDATE] Actualizando datos para {symbol}...")

        total_new_candles = 0

        # Actualizar cada timeframe
        for tf_name, tf_data in cached_data.get("timeframes", {}).items():
            main_candles = tf_data.get("main", [])
            subdivision_candles = tf_data.get("subdivisions", [])

            if not main_candles:
                print(f"[BACKTESTING UPDATE] [WARN] {tf_name}: Sin datos en caché, saltando...")
                continue

            # Obtener timestamp de la última vela
            last_candle_ts = main_candles[-1]["timestamp"]
            last_candle_date = datetime.fromtimestamp(last_candle_ts / 1000, tz=COLOMBIA_TZ)

            print(f"[BACKTESTING UPDATE] {tf_name}: Última vela en caché: {last_candle_date.strftime('%Y-%m-%d %H:%M:%S')}")

            # Descargar solo las velas nuevas
            config = BACKTESTING_CONFIG.get(tf_name)
            if not config:
                continue

            main_interval = config["interval"]
            subdivision_interval = config["subdivisions"]["interval"]

            # Calcular cuántos días han pasado
            now_ms = int(time.time() * 1000)
            days_since = (now_ms - last_candle_ts) / (1000 * 60 * 60 * 24)
            fetch_days = max(1, int(days_since) + 1)  # Al menos 1 día

            print(f"[BACKTESTING UPDATE] {tf_name}: Descargando últimos {fetch_days} días...")

            # Fetch nuevas velas principales
            new_main_candles = await fetch_backtesting_timeframe(symbol, main_interval, fetch_days)
            if new_main_candles:
                # Filtrar solo velas más nuevas que la última cacheada
                truly_new_main = [c for c in new_main_candles if c["timestamp"] > last_candle_ts]
                main_candles.extend(truly_new_main)
                total_new_candles += len(truly_new_main)
                print(f"[BACKTESTING UPDATE] {tf_name} main: +{len(truly_new_main)} velas nuevas")

            # Fetch nuevas subdivisiones
            new_subdivision_candles = await fetch_backtesting_timeframe(symbol, subdivision_interval, fetch_days)
            if new_subdivision_candles:
                last_subdivision_ts = subdivision_candles[-1]["timestamp"] if subdivision_candles else 0
                truly_new_subdivisions = [c for c in new_subdivision_candles if c["timestamp"] > last_subdivision_ts]
                subdivision_candles.extend(truly_new_subdivisions)
                print(f"[BACKTESTING UPDATE] {tf_name} subdivisions: +{len(truly_new_subdivisions)} velas nuevas")

            # Actualizar en cached_data
            cached_data["timeframes"][tf_name]["main"] = main_candles
            cached_data["timeframes"][tf_name]["subdivisions"] = subdivision_candles

            # Actualizar Open Interest (opcional - solo si hay datos nuevos)
            min_candle_ts = main_candles[0]["timestamp"] if main_candles else 0
            max_candle_ts = main_candles[-1]["timestamp"] if main_candles else 0

            oi_response = await get_open_interest(
                symbol,
                str(main_interval),
                fetch_days,
                start_timestamp_ms=min_candle_ts,
                end_timestamp_ms=max_candle_ts
            )
            oi_data = oi_response.get("data", []) if oi_response.get("success") else []

            # Mergear OI datos (evitar duplicados)
            existing_oi = tf_data.get("open_interest", [])
            existing_oi_timestamps = {item["timestamp"] for item in existing_oi}
            new_oi = [item for item in oi_data if item["timestamp"] not in existing_oi_timestamps]
            existing_oi.extend(new_oi)

            cached_data["timeframes"][tf_name]["open_interest"] = existing_oi
            print(f"[BACKTESTING UPDATE] {tf_name} OI: +{len(new_oi)} puntos nuevos")

        # Actualizar metadata
        all_timestamps = []
        for tf_data in cached_data["timeframes"].values():
            all_timestamps.extend([c["timestamp"] for c in tf_data.get("main", [])])

        if all_timestamps:
            min_ts = min(all_timestamps)
            max_ts = max(all_timestamps)
            start_date = datetime.fromtimestamp(min_ts / 1000, tz=COLOMBIA_TZ)
            end_date = datetime.fromtimestamp(max_ts / 1000, tz=COLOMBIA_TZ)
        else:
            start_date = end_date = datetime.now(COLOMBIA_TZ)

        cached_data["metadata"]["cached_at"] = int(time.time() * 1000)
        cached_data["metadata"]["cached_at_colombia"] = datetime.now(COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S")
        cached_data["metadata"]["date_range"]["start"] = start_date.strftime("%Y-%m-%d %H:%M:%S")
        cached_data["metadata"]["date_range"]["end"] = end_date.strftime("%Y-%m-%d %H:%M:%S")

        # Guardar caché actualizado
        save_backtesting_cache(symbol, cached_data)

        duration = time_module.time() - start_time
        print(f"\n[BACKTESTING UPDATE] OK Actualización completada en {duration:.1f}s")
        print(f"[BACKTESTING UPDATE] Total de velas nuevas agregadas: {total_new_candles}")

        return {
            "success": True,
            "new_candles_added": total_new_candles,
            "update_duration_seconds": round(duration, 2),
            "updated_at": cached_data["metadata"]["cached_at_colombia"]
        }

    except Exception as e:
        print(f"[ERROR] Backtesting update {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
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
    Los dibujos son globales para el símbolo (no por timeframe)
    """
    try:
        drawings_file = DRAWINGS_DIR / f"{symbol}.json"

        if drawings_file.exists():
            with open(drawings_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(f"[DRAWINGS] Loaded {len(data.get('shapes', []))} shapes for {symbol}")
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
      "interval": "15",
      "shapes": [...]
    }

    Los dibujos se guardan globalmente para el símbolo (no por timeframe)
    pero se puede usar el campo interval para referencia
    """
    try:
        body = await request.json()
        shapes = body.get('shapes', [])
        interval = body.get('interval', '')

        drawings_file = DRAWINGS_DIR / f"{symbol}.json"

        data = {
            "symbol": symbol,
            "interval": interval,  # Solo para referencia
            "shapes": shapes,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "total_shapes": len(shapes)
        }

        with open(drawings_file, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

        print(f"[DRAWINGS] OK Saved {len(shapes)} shapes for {symbol}")

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
            print(f"[DRAWINGS] OK Deleted all drawings for {symbol}")
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


# ==================== DOUBLE TOP/BOTTOM ENDPOINTS ====================

@app.post("/api/double-topbottom/detect")
@limiter.limit("30/minute")
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

        print(f"[DOUBLE TOP/BOTTOM] Detecting patterns for {symbol} {interval}")
        print(f"[DOUBLE TOP/BOTTOM] RELOADED V2 - detecting with updated algorithm")

        # >> Caché en memoria para velas (evitar enviar 11MB cada vez)
        cache_key = f"{symbol}_{interval}"
        candles = body.get('candles')

        if candles:
            # Guardar velas en caché
            DTB_CANDLES_CACHE[cache_key] = candles
            print(f"[DOUBLE TOP/BOTTOM] OK Guardadas {len(candles)} velas en caché para {cache_key}")
            if len(candles) > 0:
                print(f"[DOUBLE TOP/BOTTOM] Primera vela: timestamp={candles[0].get('timestamp')}")
                print(f"[DOUBLE TOP/BOTTOM] Última vela: timestamp={candles[-1].get('timestamp')}")
        elif cache_key in DTB_CANDLES_CACHE:
            # Usar velas del caché
            candles = DTB_CANDLES_CACHE[cache_key]
            print(f"[DOUBLE TOP/BOTTOM] [CACHE] Usando {len(candles)} velas del caché para {cache_key}")
        else:
            # Fetch desde Bybit API (modo normal)
            print(f"[DOUBLE TOP/BOTTOM] Fetching candles from Bybit API...")
            historical = await _fetch_historical_internal(symbol, interval, days)

            if not historical.get('success') or not historical.get('data'):
                return {
                    "success": False,
                    "error": "Could not fetch historical data"
                }

            candles = historical['data']

        # Detect patterns
        patterns = double_detector.detect_patterns(
            symbol,
            candles,
            config
        )

        # Serialize patterns
        serialized_patterns = [serialize_double_pattern(p) for p in patterns]

        print(f"[DOUBLE TOP/BOTTOM] [OK] Detected {len(patterns)} patterns for {symbol}")

        # >> Dividir patrones en chunks por trimestre y guardar en caché
        cache_key = f"{symbol}_{interval}"
        chunks = divide_patterns_into_chunks(serialized_patterns)
        DTB_PATTERNS_CACHE[cache_key] = chunks

        total_chunks = len(chunks)
        print(f"[DOUBLE TOP/BOTTOM] [CACHE] Patrones divididos en {total_chunks} chunks y guardados en caché")
        for chunk_key, chunk_patterns in list(chunks.items())[:3]:  # Mostrar primeros 3
            print(f"  - {chunk_key}: {len(chunk_patterns)} patrones")
        if total_chunks > 3:
            print(f"  - ... y {total_chunks - 3} chunks más")

        # Devolver metadata de chunks (no los patrones completos)
        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "cached": True,
            "totalPatterns": len(patterns),
            "chunks": list(chunks.keys()),
            "message": f"Patrones calculados y guardados en {total_chunks} chunks. Use /api/double-topbottom/chunk para obtenerlos."
        }

    except Exception as e:
        print(f"[ERROR] Double top/bottom detection: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


@app.post("/api/double-topbottom/chunk")
@limiter.limit("60/minute")
async def get_dtb_chunk(request: Request):
    """
    Obtiene un chunk específico de patrones DTB

    Body:
    {
      "symbol": "BTCUSDT",
      "interval": "15m",
      "chunk": "2023-Q1"  // o "upTo": timestamp para obtener todos hasta esa fecha
    }
    """
    try:
        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '15')
        chunk_key = body.get('chunk')
        up_to_timestamp = body.get('upTo')  # Timestamp límite

        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        cache_key = f"{symbol}_{interval}"

        # Verificar si hay patrones en caché
        if cache_key not in DTB_PATTERNS_CACHE:
            return {
                "success": False,
                "error": "No patterns in cache. Run /api/double-topbottom/detect first."
            }

        all_chunks = DTB_PATTERNS_CACHE[cache_key]

        # Opción A: Obtener chunk específico
        if chunk_key:
            if chunk_key not in all_chunks:
                return {
                    "success": False,
                    "error": f"Chunk {chunk_key} not found. Available: {list(all_chunks.keys())}"
                }

            patterns = all_chunks[chunk_key]
            print(f"[DTB CHUNK] Devolviendo {len(patterns)} patrones del chunk {chunk_key}")

            return {
                "success": True,
                "symbol": symbol,
                "interval": interval,
                "chunk": chunk_key,
                "patterns": patterns,
                "totalPatterns": len(patterns)
            }

        # Opción B: Obtener todos los patrones hasta cierta fecha
        if up_to_timestamp:
            from datetime import datetime

            result_patterns = []
            dt_limit = datetime.fromtimestamp(up_to_timestamp / 1000)
            limit_quarter = (dt_limit.month - 1) // 3 + 1
            limit_key = f"{dt_limit.year}-Q{limit_quarter}"

            # Recopilar chunks hasta el límite
            for chunk_name in sorted(all_chunks.keys()):
                if chunk_name <= limit_key:
                    chunk_patterns = all_chunks[chunk_name]
                    # Filtrar patrones individuales por timestamp
                    filtered = [
                        p for p in chunk_patterns
                        if p.get('secondExtreme', {}).get('timestamp', 0) <= up_to_timestamp
                    ]
                    result_patterns.extend(filtered)

            print(f"[DTB CHUNK] Devolviendo {len(result_patterns)} patrones hasta {datetime.fromtimestamp(up_to_timestamp/1000)}")

            return {
                "success": True,
                "symbol": symbol,
                "interval": interval,
                "upTo": up_to_timestamp,
                "patterns": result_patterns,
                "totalPatterns": len(result_patterns)
            }

        return {
            "success": False,
            "error": "Must provide either 'chunk' or 'upTo' parameter"
        }

    except Exception as e:
        print(f"[ERROR] DTB chunk retrieval: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "success": False,
            "error": str(e)
        }


# ==================== VWAP ENDPOINTS ====================

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
        historical = await _fetch_historical_internal(symbol, interval_final, days_to_fetch)

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


# =============================================================================
# ZONE DETECTOR 2.0 - Strategy Tester
# =============================================================================

# Imports movidos aquí para evitar problemas de orden
try:
    from zone_detector import ZoneDetector, ZoneDetectionParams, zone_detector
    from zone_evaluator import ZoneEvaluator, EvaluationParams, zone_evaluator
    from zone_optimizer import ZoneOptimizer, OptimizationConfig, zone_optimizer
    from zone_quality_analyzer import ZoneQualityAnalyzer, ZoneParameterOptimizer, BreakoutAnalysis
    print("[STARTUP] Zone Detector 2.0 modules loaded successfully")
    print("[STARTUP] Zone Quality Analyzer loaded successfully")
except ImportError as e:
    print(f"[STARTUP] Warning: Could not load Zone Detector modules: {e}")
    zone_detector = None
    zone_evaluator = None
    zone_optimizer = None


@app.post("/api/zones/detect")
@limiter.limit("30/minute")
async def detect_zones(request: Request):
    """
    Detecta zonas de consolidación usando el método especificado.

    Parámetros opcionales:
    - end_timestamp: Timestamp (ms) de la fecha límite para los datos.
                     Si se proporciona, solo se usan velas ANTES de esta fecha.
                     Esto es útil para backtesting donde queremos detectar zonas
                     solo con datos anteriores a la fecha de inicio de la simulación.
    """
    try:
        if zone_detector is None:
            return {"success": False, "error": "Zone Detector module not loaded"}

        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 365)
        method = body.get('method', 'pivot_cluster')
        params_dict = body.get('params', {})
        end_timestamp = body.get('end_timestamp')  # 🎯 NUEVO: Fecha límite para los datos

        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        # Obtener velas históricas (skip_day_limit=True para backtesting con años de datos)
        print(f"[ZONE_DETECTOR] Fetching {days} days of {interval}m candles for {symbol}...")
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)

        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']
        print(f"[ZONE_DETECTOR] Got {len(candles)} candles total")

        # 🎯 NUEVO: Filtrar velas si se proporciona end_timestamp
        # Solo usar velas ANTERIORES a la fecha de inicio de playback
        if end_timestamp:
            original_count = len(candles)
            candles = [c for c in candles if c['timestamp'] < end_timestamp]
            print(f"[ZONE_DETECTOR] Filtered to {len(candles)} candles (before playback start: {end_timestamp})")
            print(f"[ZONE_DETECTOR] Playback start date: {datetime.fromtimestamp(end_timestamp/1000).isoformat()}")

            if len(candles) == 0:
                return {"success": False, "error": f"No candles found before playback start date ({datetime.fromtimestamp(end_timestamp/1000).isoformat()})"}

        print(f"[ZONE_DETECTOR] Using {len(candles)} candles for detection")

        # Configurar parámetros
        params = ZoneDetectionParams()
        for key, value in params_dict.items():
            if hasattr(params, key):
                setattr(params, key, value)

        # Detectar zonas
        if method == "all":
            # Ejecutar todos los métodos
            all_results = zone_detector.detect_all_methods(candles, params)
            zones_by_method = {
                m: [z.to_dict() for z in zones]
                for m, zones in all_results.items()
            }
            total_zones = sum(len(zones) for zones in all_results.values())

            return {
                "success": True,
                "symbol": symbol,
                "interval": interval,
                "days": days,
                "candles_count": len(candles),
                "method": "all",
                "zones_by_method": zones_by_method,
                "total_zones": total_zones
            }
        else:
            zones = zone_detector.detect_zones(candles, method, params)

            return {
                "success": True,
                "symbol": symbol,
                "interval": interval,
                "days": days,
                "candles_count": len(candles),
                "method": method,
                "zones": [z.to_dict() for z in zones],
                "total_zones": len(zones)
            }

    except Exception as e:
        print(f"[ERROR] Zone detection: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/zones/evaluate")
@limiter.limit("30/minute")
async def evaluate_zones(request: Request):
    """
    Detecta y evalúa zonas usando datos históricos.
    """
    try:
        if zone_evaluator is None:
            return {"success": False, "error": "Zone Evaluator module not loaded"}

        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 365)
        method = body.get('method', 'pivot_cluster')
        detection_params_dict = body.get('detection_params', {})
        eval_params_dict = body.get('eval_params', {})
        end_timestamp = body.get('end_timestamp')  # 🎯 Fecha límite para los datos

        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        # Obtener velas históricas (skip_day_limit=True para backtesting con años de datos)
        print(f"[ZONE_EVALUATOR] Fetching {days} days of {interval}m candles for {symbol}...")
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)

        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']
        print(f"[ZONE_EVALUATOR] Got {len(candles)} candles total")

        # 🎯 Filtrar velas si se proporciona end_timestamp
        if end_timestamp:
            candles = [c for c in candles if c['timestamp'] < end_timestamp]
            print(f"[ZONE_EVALUATOR] Filtered to {len(candles)} candles (before playback: {datetime.fromtimestamp(end_timestamp/1000).isoformat()})")

        # Configurar parámetros de detección
        detection_params = ZoneDetectionParams()
        for key, value in detection_params_dict.items():
            if hasattr(detection_params, key):
                setattr(detection_params, key, value)

        # Configurar parámetros de evaluación
        eval_params = EvaluationParams()
        for key, value in eval_params_dict.items():
            if hasattr(eval_params, key):
                setattr(eval_params, key, value)

        # Dividir datos: 70% para detección, 30% para evaluación
        split_idx = int(len(candles) * 0.7)
        detection_candles = candles[:split_idx]

        print(f"[ZONE_EVALUATOR] Detection: {len(detection_candles)} candles, Evaluation: {len(candles) - split_idx} candles")

        # Detectar zonas
        zones = zone_detector.detect_zones(detection_candles, method, detection_params)
        print(f"[ZONE_EVALUATOR] Detected {len(zones)} zones with method '{method}'")

        # Evaluar zonas
        evaluations = zone_evaluator.evaluate_zones_batch(zones, candles, eval_params)

        # Calcular métricas agregadas
        tradeable = [e for e in evaluations if e.tradeable]
        total_bounces = sum(e.total_bounces for e in evaluations)
        successful_bounces = sum(e.successful_bounces for e in evaluations)

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "days": days,
            "method": method,
            "candles_total": len(candles),
            "candles_detection": len(detection_candles),
            "zones_detected": len(zones),
            "zones_tradeable": len(tradeable),
            "tradeable_rate": len(tradeable) / len(zones) if zones else 0,
            "total_bounces": total_bounces,
            "successful_bounces": successful_bounces,
            "overall_win_rate": successful_bounces / total_bounces if total_bounces > 0 else 0,
            "evaluations": [e.to_dict() for e in evaluations[:20]],  # Limitar a 20 para no sobrecargar
            "summary": {
                "avg_score": sum(e.overall_score for e in evaluations) / len(evaluations) if evaluations else 0,
                "avg_fakeout_rate": sum(e.fakeout_rate for e in evaluations) / len(evaluations) if evaluations else 0,
                "strategies": {
                    "range_trade_aggressive": sum(1 for e in evaluations if "aggressive" in e.recommended_strategy),
                    "range_trade_conservative": sum(1 for e in evaluations if "conservative" in e.recommended_strategy),
                    "breakout_trade": sum(1 for e in evaluations if "breakout" in e.recommended_strategy),
                    "avoid": sum(1 for e in evaluations if "avoid" in e.recommended_strategy)
                }
            }
        }

    except Exception as e:
        print(f"[ERROR] Zone evaluation: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/zones/compare-methods")
@limiter.limit("10/minute")
async def compare_zone_methods(request: Request):
    """
    Compara todos los métodos de detección de zonas.
    """
    try:
        if zone_evaluator is None:
            return {"success": False, "error": "Zone modules not loaded"}

        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 365)
        end_timestamp = body.get('end_timestamp')  # 🎯 Fecha límite para los datos

        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        # Obtener velas históricas (skip_day_limit=True para backtesting)
        print(f"[ZONE_COMPARE] Fetching {days} days of {interval}m candles for {symbol}...")
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)

        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']
        print(f"[ZONE_COMPARE] Got {len(candles)} candles total")

        # 🎯 Filtrar velas si se proporciona end_timestamp
        if end_timestamp:
            candles = [c for c in candles if c['timestamp'] < end_timestamp]
            print(f"[ZONE_COMPARE] Filtered to {len(candles)} candles (before playback: {datetime.fromtimestamp(end_timestamp/1000).isoformat()})")

        print(f"[ZONE_COMPARE] Comparing methods with {len(candles)} candles...")

        # Comparar métodos
        results = zone_evaluator.compare_methods(candles)

        # Encontrar mejor método
        best_method = max(
            results.keys(),
            key=lambda m: results[m].get('overall_win_rate', 0) * results[m].get('tradeable_rate', 0)
        )

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "days": days,
            "candles_count": len(candles),
            "best_method": best_method,
            "methods": results,
            "recommendation": f"Use '{best_method}' for best results on {symbol} {interval}m"
        }

    except Exception as e:
        print(f"[ERROR] Zone comparison: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/zones/optimize")
@limiter.limit("5/minute")
async def optimize_zone_params(request: Request):
    """
    Optimiza parámetros de detección de zonas usando grid search.
    """
    try:
        if zone_optimizer is None:
            return {"success": False, "error": "Zone Optimizer module not loaded"}

        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 1095)  # Default: 3 años
        method = body.get('method', 'pivot_cluster')
        walk_forward = body.get('walk_forward', False)
        end_timestamp = body.get('end_timestamp')  # 🎯 Fecha límite para los datos

        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        # Obtener velas históricas (skip_day_limit=True para backtesting con 3 años)
        print(f"[ZONE_OPTIMIZER] Fetching {days} days of {interval}m candles for {symbol}...")
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)

        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']
        print(f"[ZONE_OPTIMIZER] Got {len(candles)} candles total")

        # 🎯 Filtrar velas si se proporciona end_timestamp
        if end_timestamp:
            candles = [c for c in candles if c['timestamp'] < end_timestamp]
            print(f"[ZONE_OPTIMIZER] Filtered to {len(candles)} candles (before playback: {datetime.fromtimestamp(end_timestamp/1000).isoformat()})")

        print(f"[ZONE_OPTIMIZER] Optimizing with {len(candles)} candles...")

        config = OptimizationConfig()

        if walk_forward:
            if method == "all":
                # Walk-forward para todos los métodos
                results = {}
                for m in ZoneDetector.METHODS:
                    print(f"[ZONE_OPTIMIZER] Walk-forward optimizing: {m}")
                    results[m] = zone_optimizer.walk_forward_optimize(candles, m, config)

                # Encontrar mejor método robusto
                robust_methods = [
                    m for m in results
                    if 'error' not in results[m] and results[m].get('degradation', {}).get('is_robust', False)
                ]

                if robust_methods:
                    best_method = max(
                        robust_methods,
                        key=lambda m: results[m]['out_of_sample']['avg_fitness']
                    )
                else:
                    valid_methods = [m for m in results if 'error' not in results[m]]
                    best_method = max(
                        valid_methods,
                        key=lambda m: results[m].get('out_of_sample', {}).get('avg_fitness', 0)
                    ) if valid_methods else None

                return {
                    "success": True,
                    "symbol": symbol,
                    "interval": interval,
                    "days": days,
                    "candles_count": len(candles),
                    "optimization_type": "walk_forward_all",
                    "best_method": best_method,
                    "best_params": results[best_method]['recommended_params'] if best_method else None,
                    "methods": results
                }
            else:
                # Walk-forward para un método específico
                result = zone_optimizer.walk_forward_optimize(candles, method, config)
                return {
                    "success": True,
                    "symbol": symbol,
                    "interval": interval,
                    "days": days,
                    "candles_count": len(candles),
                    "optimization_type": "walk_forward",
                    "method": method,
                    **result
                }
        else:
            # Optimización simple (grid search)
            if method == "all":
                result = zone_optimizer.optimize_all_methods(candles, config)
            else:
                result = zone_optimizer.optimize(candles, method, config)

            return {
                "success": True,
                "symbol": symbol,
                "interval": interval,
                "days": days,
                "candles_count": len(candles),
                "optimization_type": "grid_search",
                **result
            }

    except Exception as e:
        print(f"[ERROR] Zone optimization: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.get("/api/zones/methods")
async def get_zone_methods():
    """Retorna lista de métodos disponibles y sus parámetros"""
    if zone_detector is None:
        return {"success": False, "error": "Zone Detector not loaded", "methods": []}

    return {
        "success": True,
        "methods": ZoneDetector.METHODS,
        "parameters": {
            "pivot_cluster": {
                "pivot_tolerance_pct": {"default": 0.3, "range": [0.1, 1.0], "description": "% de distancia para agrupar pivots"},
                "pivot_min_touches": {"default": 3, "range": [2, 10], "description": "Mínimo de toques para zona válida"},
                "pivot_min_duration_hours": {"default": 4.0, "range": [1, 48], "description": "Duración mínima de zona en horas"},
                "pivot_swing_bars": {"default": 5, "range": [2, 15], "description": "Velas a cada lado para confirmar pivot"}
            },
            "atr_based": {
                "atr_period": {"default": 14, "range": [5, 30], "description": "Período para calcular ATR"},
                "atr_threshold": {"default": 0.7, "range": [0.3, 1.0], "description": "Multiplicador de ATR para baja volatilidad"},
                "atr_min_bars": {"default": 10, "range": [5, 30], "description": "Mínimo de velas en zona"}
            },
            "volume_profile": {
                "vp_value_area_pct": {"default": 70, "range": [50, 90], "description": "% de volumen para Value Area"},
                "vp_min_volume_ratio": {"default": 1.5, "range": [1.0, 3.0], "description": "Ratio mínimo de volumen vs promedio"},
                "vp_price_bins": {"default": 50, "range": [20, 100], "description": "Número de bins de precio"}
            },
            "price_action": {
                "pa_touch_tolerance_pct": {"default": 0.2, "range": [0.1, 0.5], "description": "Tolerancia para contar toques"},
                "pa_min_touches": {"default": 3, "range": [2, 10], "description": "Mínimo de toques en nivel"},
                "pa_lookback_bars": {"default": 100, "range": [50, 500], "description": "Velas de lookback"},
                "pa_min_separation_bars": {"default": 5, "range": [2, 20], "description": "Separación mínima entre toques"}
            },
            "consolidation": {
                "consol_min_bars": {"default": 8, "range": [5, 30], "description": "Mínimo de velas en consolidación"},
                "consol_max_bars": {"default": 50, "range": [20, 300], "description": "Máximo de velas en consolidación"},
                "consol_max_range_pct": {"default": 3.0, "range": [1.0, 10.0], "description": "Máximo % de rango de precio"},
                "consol_atr_ratio": {"default": 0.6, "range": [0.3, 2.0], "description": "ATR local/global (menor = menos volátil)"},
                "consol_body_ratio": {"default": 0.5, "range": [0.3, 0.8], "description": "Ratio cuerpo/rango de velas (menor = más indecisión)"},
                "consol_max_outside_bars": {"default": 3, "range": [1, 10], "description": "Velas fuera del rango antes de cerrar zona"}
            },
            "trading_zones": {
                "consol_min_bars": {"default": 8, "range": [3, 50], "description": "Mínimo de velas en consolidación"},
                "consol_max_bars": {"default": 50, "range": [10, 300], "description": "Máximo de velas en consolidación"},
                "consol_max_range_pct": {"default": 3.0, "range": [0.5, 10.0], "description": "Máximo % de rango de precio"},
                "consol_atr_ratio": {"default": 0.6, "range": [0.2, 2.0], "description": "ATR local/global (menor = menos volátil)"},
                "consol_body_ratio": {"default": 0.5, "range": [0.2, 0.9], "description": "Ratio cuerpo/rango (menor = más indecisión)"},
                "consol_max_outside_bars": {"default": 3, "range": [1, 10], "description": "Velas fuera del rango antes de cerrar"},
                "lookforward_bars": {"default": 100, "range": [20, 500], "description": "Velas hacia adelante para simular trade"},
                "breakout_search_bars": {"default": 20, "range": [5, 50], "description": "Velas para buscar breakout después de consolidación"},
                "include_no_breakout": {"default": True, "type": "boolean", "description": "Incluir zonas sin breakout claro"}
            }
        }
    }


# =============================================================================
# STRATEGY BUILDER - CRUD de Estrategias
# =============================================================================

try:
    from strategy_model import Strategy, get_template, list_templates
    from strategy_store import strategy_store
    print("[STARTUP] Strategy Builder modules loaded successfully")
except ImportError as e:
    print(f"[STARTUP] Warning: Could not load Strategy Builder modules: {e}")
    strategy_store = None


@app.get("/api/strategies")
async def list_strategies():
    """Lista todas las estrategias guardadas"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    strategies = strategy_store.list_all()
    return {
        "success": True,
        "strategies": strategies,
        "count": len(strategies)
    }


@app.get("/api/strategies/templates")
async def get_strategy_templates():
    """Lista templates de estrategias disponibles"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    templates = strategy_store.get_templates()
    return {
        "success": True,
        "templates": templates
    }


@app.get("/api/strategies/{strategy_id}")
async def get_strategy(strategy_id: str):
    """Obtiene una estrategia por ID"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    strategy = strategy_store.load(strategy_id)
    if strategy:
        return {
            "success": True,
            "strategy": strategy.to_dict()
        }
    return {"success": False, "error": "Strategy not found"}


@app.post("/api/strategies")
async def create_strategy(request: Request):
    """Crea una nueva estrategia"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    try:
        body = await request.json()

        # Si se especifica un template, crear desde template
        template_name = body.get("template")
        if template_name:
            strategy = strategy_store.create_from_template(template_name)
            if strategy:
                return {
                    "success": True,
                    "strategy": strategy.to_dict(),
                    "message": f"Strategy created from template '{template_name}'"
                }
            return {"success": False, "error": f"Template '{template_name}' not found"}

        # Crear estrategia desde datos
        strategy = Strategy.from_dict(body)
        if strategy_store.save(strategy):
            return {
                "success": True,
                "strategy": strategy.to_dict(),
                "message": "Strategy created successfully"
            }
        return {"success": False, "error": "Failed to save strategy"}

    except Exception as e:
        print(f"[ERROR] Create strategy: {e}")
        return {"success": False, "error": str(e)}


@app.put("/api/strategies/{strategy_id}")
async def update_strategy(strategy_id: str, request: Request):
    """Actualiza una estrategia existente"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    try:
        if not strategy_store.exists(strategy_id):
            return {"success": False, "error": "Strategy not found"}

        body = await request.json()
        body["id"] = strategy_id  # Asegurar que el ID no cambie

        strategy = Strategy.from_dict(body)
        if strategy_store.save(strategy):
            return {
                "success": True,
                "strategy": strategy.to_dict(),
                "message": "Strategy updated successfully"
            }
        return {"success": False, "error": "Failed to update strategy"}

    except Exception as e:
        print(f"[ERROR] Update strategy: {e}")
        return {"success": False, "error": str(e)}


@app.delete("/api/strategies/{strategy_id}")
async def delete_strategy(strategy_id: str):
    """Elimina una estrategia"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    if strategy_store.delete(strategy_id):
        return {
            "success": True,
            "message": "Strategy deleted successfully"
        }
    return {"success": False, "error": "Strategy not found or failed to delete"}


@app.post("/api/strategies/{strategy_id}/duplicate")
async def duplicate_strategy(strategy_id: str, request: Request):
    """Duplica una estrategia existente"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    try:
        body = await request.json()
        new_name = body.get("name")

        new_strategy = strategy_store.duplicate(strategy_id, new_name)
        if new_strategy:
            return {
                "success": True,
                "strategy": new_strategy.to_dict(),
                "message": "Strategy duplicated successfully"
            }
        return {"success": False, "error": "Failed to duplicate strategy"}

    except Exception as e:
        print(f"[ERROR] Duplicate strategy: {e}")
        return {"success": False, "error": str(e)}


@app.post("/api/strategies/validate")
async def validate_strategy(request: Request):
    """Valida la sintaxis de una estrategia sin guardarla"""
    if strategy_store is None:
        return {"success": False, "error": "Strategy module not loaded"}

    try:
        body = await request.json()
        strategy = Strategy.from_dict(body)

        # Validaciones básicas
        errors = []
        warnings = []

        if not strategy.name or len(strategy.name) < 3:
            errors.append("El nombre debe tener al menos 3 caracteres")

        if not strategy.entry.conditions:
            warnings.append("No hay condiciones de entrada definidas")

        if strategy.risk_management.sizing.risk_percent > 5:
            warnings.append("Riesgo por trade mayor a 5% es muy agresivo")

        if strategy.risk_management.take_profit.risk_reward_ratio < 1:
            warnings.append("Risk/Reward menor a 1:1 no es recomendado")

        if strategy.filters.max_daily_loss_percent > 10:
            warnings.append("Pérdida diaria máxima mayor a 10% es muy alta")

        return {
            "success": len(errors) == 0,
            "valid": len(errors) == 0,
            "errors": errors,
            "warnings": warnings,
            "strategy_preview": strategy.to_dict()
        }

    except Exception as e:
        return {
            "success": False,
            "valid": False,
            "errors": [f"Error de sintaxis: {str(e)}"],
            "warnings": []
        }


# =============================================================================
# STRATEGY EXECUTOR - Backtesting de estrategias
# =============================================================================

try:
    from strategy_executor import StrategyExecutor, create_executor
    print("[STARTUP] Strategy Executor module loaded successfully")
except ImportError as e:
    print(f"[STARTUP] Warning: Could not load Strategy Executor module: {e}")
    StrategyExecutor = None


@app.post("/api/strategies/{strategy_id}/backtest")
@limiter.limit("10/minute")
async def run_strategy_backtest(strategy_id: str, request: Request):
    """
    Ejecuta backtesting de una estrategia.

    Body:
    - symbol: Par de trading (ej: BTCUSDT)
    - interval: Timeframe (ej: 60 para 1h)
    - days: Días de datos históricos
    - start_timestamp: (opcional) Timestamp de inicio
    - end_timestamp: (opcional) Timestamp de fin
    - initial_capital: (opcional) Capital inicial (default 10000)
    """
    if strategy_store is None or StrategyExecutor is None:
        return {"success": False, "error": "Strategy modules not loaded"}

    try:
        body = await request.json()
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 365)
        start_timestamp = body.get('start_timestamp')
        end_timestamp = body.get('end_timestamp')
        initial_capital = body.get('initial_capital', 10000)

        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        # Cargar estrategia
        strategy = strategy_store.load(strategy_id)
        if not strategy:
            return {"success": False, "error": "Strategy not found"}

        print(f"[BACKTEST] Running strategy '{strategy.name}' on {symbol} {interval}m, {days} days")

        # Obtener datos históricos
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)
        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']
        print(f"[BACKTEST] Got {len(candles)} candles")

        # Filtrar por timestamps si se proporcionan
        if end_timestamp:
            candles = [c for c in candles if c['timestamp'] < end_timestamp]

        # Detectar zonas para la estrategia
        if zone_detector is None:
            return {"success": False, "error": "Zone Detector not loaded"}

        zone_params = ZoneDetectionParams()
        zone_config = strategy.zone_config
        for key, value in zone_config.params.items():
            if hasattr(zone_params, key):
                setattr(zone_params, key, value)

        zones = zone_detector.detect_zones(candles, zone_config.method, zone_params)
        zones_dict = [z.to_dict() for z in zones]
        print(f"[BACKTEST] Detected {len(zones)} zones using method '{zone_config.method}'")

        # Crear executor y correr backtest
        executor = StrategyExecutor(strategy, zones_dict, initial_capital)
        result = executor.run(candles, start_timestamp, end_timestamp)

        # Agregar info del símbolo
        result.symbol = symbol
        result.interval = interval

        return {
            "success": True,
            "result": result.to_dict(),
            "zones_used": len(zones_dict)
        }

    except Exception as e:
        print(f"[ERROR] Strategy backtest: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/strategies/quick-backtest")
@limiter.limit("10/minute")
async def quick_backtest(request: Request):
    """
    Backtest rápido sin guardar estrategia.
    Recibe la estrategia completa en el body.
    """
    if StrategyExecutor is None:
        return {"success": False, "error": "Strategy Executor not loaded"}

    try:
        body = await request.json()
        strategy_data = body.get('strategy')
        symbol = body.get('symbol')
        interval = body.get('interval', '60')
        days = body.get('days', 365)
        end_timestamp = body.get('end_timestamp')
        initial_capital = body.get('initial_capital', 10000)

        if not strategy_data:
            return {"success": False, "error": "Strategy data is required"}
        if not symbol:
            return {"success": False, "error": "Symbol is required"}

        # Crear estrategia desde datos
        strategy = Strategy.from_dict(strategy_data)

        print(f"[QUICK_BACKTEST] Running on {symbol} {interval}m, {days} days")

        # Obtener datos históricos
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)
        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']

        # Filtrar por timestamp
        if end_timestamp:
            candles = [c for c in candles if c['timestamp'] < end_timestamp]

        print(f"[QUICK_BACKTEST] Using {len(candles)} candles")

        # Detectar zonas
        if zone_detector is None:
            return {"success": False, "error": "Zone Detector not loaded"}

        zone_params = ZoneDetectionParams()
        zone_config = strategy.zone_config
        for key, value in zone_config.params.items():
            if hasattr(zone_params, key):
                setattr(zone_params, key, value)

        zones = zone_detector.detect_zones(candles, zone_config.method, zone_params)
        zones_dict = [z.to_dict() for z in zones]
        print(f"[QUICK_BACKTEST] Detected {len(zones)} zones")

        # Ejecutar
        executor = StrategyExecutor(strategy, zones_dict, initial_capital)
        result = executor.run(candles)

        result.symbol = symbol
        result.interval = interval

        return {
            "success": True,
            "result": result.to_dict(),
            "zones_used": len(zones_dict)
        }

    except Exception as e:
        print(f"[ERROR] Quick backtest: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


# =============================================================================
# ZONE QUALITY ANALYSIS - Optimización de parámetros
# =============================================================================

@app.post("/api/zones/quality-simulation")
@limiter.limit("2/minute")
async def run_zone_quality_simulation(request: Request):
    """
    Ejecuta simulación completa para encontrar parámetros óptimos de zonas de consolidación.

    Analiza zonas detectadas con diferentes parámetros y evalúa la calidad del breakout
    basándose en:
    - R-Multiple (distancia del movimiento vs altura de zona)
    - Momentum (fuerza y persistencia del breakout)
    - Volumen (acumulación pre-breakout y confirmación post-breakout)

    Retorna métricas detalladas y recomendaciones de parámetros.
    """
    try:
        body = await request.json()
        symbol = body.get('symbol', 'BTCUSDT')
        interval = body.get('interval', '5')  # Default 5 minutos
        days = body.get('days', 1095)  # Default 3 años
        quality_threshold = body.get('quality_threshold', 60.0)
        lookforward_bars = body.get('lookforward_bars', 100)

        # Modo de ejecución: "simultaneous" (múltiples trades) o "sequential" (un trade a la vez)
        trade_mode = body.get('trade_mode', 'simultaneous')

        # Grid de parámetros a probar
        param_grid = body.get('param_grid', {
            "consol_min_bars": [5, 8, 12, 15],
            "consol_max_bars": [30, 50, 80, 120],
            "consol_max_range_pct": [1.5, 2.0, 3.0, 4.0],
            "consol_atr_ratio": [0.4, 0.6, 0.8, 1.0],
            "consol_body_ratio": [0.4, 0.5, 0.6],
            "consol_max_outside_bars": [2, 3, 5, 8]
        })

        print(f"[QUALITY_SIM] Starting simulation for {symbol} {interval}m with {days} days...")

        # Obtener velas históricas
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)

        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']
        print(f"[QUALITY_SIM] Loaded {len(candles)} candles")
        print(f"[QUALITY_SIM] Date range: {datetime.fromtimestamp(candles[0]['timestamp']/1000)} to {datetime.fromtimestamp(candles[-1]['timestamp']/1000)}")

        # Crear optimizador
        optimizer = ZoneParameterOptimizer(candles)

        # Ejecutar grid search
        from itertools import product

        param_names = list(param_grid.keys())
        param_values = list(param_grid.values())
        combinations = list(product(*param_values))

        print(f"[QUALITY_SIM] Testing {len(combinations)} parameter combinations...")

        results = []
        progress_interval = max(1, len(combinations) // 10)

        for i, combo in enumerate(combinations):
            params_dict = dict(zip(param_names, combo))

            try:
                # Crear parámetros
                params = ZoneDetectionParams(**params_dict)

                # Detectar zonas
                zones = zone_detector.detect_zones(candles, method="consolidation", params=params)

                if len(zones) < 3:
                    continue

                # Convertir a diccionarios
                zones_dict = [z.to_dict() for z in zones]

                # Analizar calidad según el modo de ejecución
                sequential_stats = None
                if trade_mode == "sequential":
                    analyses, sequential_stats = optimizer.quality_analyzer.analyze_zones_sequential(zones_dict, lookforward_bars)
                else:
                    analyses = optimizer.quality_analyzer.analyze_multiple_zones(zones_dict, lookforward_bars)

                if len(analyses) < 3:
                    continue

                # Generar estadísticas
                stats = optimizer.quality_analyzer.generate_statistics(analyses, quality_threshold)

                result = {
                    "params": params_dict,
                    "total_zones": stats['total_zones'],
                    "quality_zones": stats['quality_zones'],
                    "avg_r_multiple": round(stats['avg_r_multiple'], 2),
                    "median_r_multiple": round(stats['median_r_multiple'], 2),
                    "pct_reached_2r": round(stats['pct_reached_2r'], 1),
                    "pct_reached_3r": round(stats['pct_reached_3r'], 1),
                    "avg_quality_score": round(stats['avg_quality_score'], 1),
                    "avg_bars_to_2r": round(stats['avg_bars_to_2r'], 0) if stats['avg_bars_to_2r'] else None,
                    "score_distribution": stats['score_distribution'],
                    # MÉTRICAS DE TRADING REAL (TP vs SL)
                    "real_win_rate": round(stats['real_win_rate'], 1),  # % donde TP(2R) hit antes que SL(1R)
                    "total_wins": stats['total_wins'],
                    "total_losses": stats['total_losses'],
                    "total_still_open": stats['total_still_open'],  # Trades sin cerrar aún
                    "total_pnl_r": round(stats['total_pnl_r'], 1),  # P&L total en R
                    "expectancy_r": round(stats['expectancy_r'], 3),  # Expectancy por trade
                    "is_profitable": stats['is_profitable'],  # True si expectancy > 0
                    # DURACIÓN DE TRADES
                    "avg_bars_to_close": round(stats['avg_bars_to_close'], 1) if stats.get('avg_bars_to_close') else None,
                    "avg_win_duration": round(stats['avg_win_duration'], 1) if stats.get('avg_win_duration') else None,
                    "avg_loss_duration": round(stats['avg_loss_duration'], 1) if stats.get('avg_loss_duration') else None,
                    # SECUENCIALIDAD (solo si trade_mode == "sequential")
                    "sequential_stats": sequential_stats
                }

                results.append(result)

            except Exception as e:
                print(f"[QUALITY_SIM] Error with params {params_dict}: {e}")
                continue

            if (i + 1) % progress_interval == 0:
                print(f"[QUALITY_SIM] Progress: {i + 1}/{len(combinations)} ({((i+1)/len(combinations)*100):.0f}%)")

        # Ordenar por mejor rendimiento de TRADING REAL
        # Priorizar: 1) Expectancy (E>0 = rentable), 2) Real Win Rate, 3) Avg quality score
        results.sort(key=lambda x: (x['expectancy_r'], x['real_win_rate'], x['avg_quality_score']), reverse=True)

        # Analizar parámetros de los mejores resultados
        top_results = results[:10] if len(results) >= 10 else results

        param_recommendations = {}
        if top_results:
            for param in param_names:
                values = [r['params'][param] for r in top_results]
                param_recommendations[param] = {
                    "recommended": float(np.median(values)),
                    "range": [float(min(values)), float(max(values))],
                    "values_in_top_10": values
                }

        print(f"[QUALITY_SIM] Completed. {len(results)} valid combinations found.")

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "days": days,
            "trade_mode": trade_mode,
            "candles_analyzed": len(candles),
            "combinations_tested": len(combinations),
            "valid_results": len(results),
            "quality_threshold": quality_threshold,
            "best_result": results[0] if results else None,
            "top_10_results": top_results,
            "all_results": results,
            "parameter_recommendations": param_recommendations,
            "summary": {
                # MÉTRICAS DE TRADING REAL
                "best_real_win_rate": max(r['real_win_rate'] for r in results) if results else 0,
                "best_expectancy_r": max(r['expectancy_r'] for r in results) if results else 0,
                "profitable_combinations": len([r for r in results if r['is_profitable']]),
                "unprofitable_combinations": len([r for r in results if not r['is_profitable']]),
                # DURACIÓN DE TRADES
                "avg_trade_duration_bars": np.mean([r['avg_bars_to_close'] for r in results if r.get('avg_bars_to_close')]) if results else None,
                "avg_win_duration_bars": np.mean([r['avg_win_duration'] for r in results if r.get('avg_win_duration')]) if results else None,
                "avg_loss_duration_bars": np.mean([r['avg_loss_duration'] for r in results if r.get('avg_loss_duration')]) if results else None,
                # Métricas auxiliares
                "best_pct_2r": max(r['pct_reached_2r'] for r in results) if results else 0,
                "best_avg_r": max(r['avg_r_multiple'] for r in results) if results else 0,
                "avg_zones_per_config": np.mean([r['total_zones'] for r in results]) if results else 0
            }
        }

    except Exception as e:
        print(f"[ERROR] Zone quality simulation: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.post("/api/zones/analyze-quality")
@limiter.limit("10/minute")
async def analyze_zones_quality(request: Request):
    """
    Analiza la calidad de zonas ya detectadas.

    Recibe zonas específicas y retorna métricas detalladas de cada breakout.
    Útil para visualizar zonas individuales en el gráfico.
    """
    try:
        body = await request.json()
        symbol = body.get('symbol', 'BTCUSDT')
        interval = body.get('interval', '5')
        days = body.get('days', 1095)
        zones = body.get('zones', [])  # Lista de zonas a analizar
        params = body.get('params', {})  # Si no se pasan zonas, detectar con estos params
        lookforward_bars = body.get('lookforward_bars', 100)
        quality_threshold = body.get('quality_threshold', 60.0)

        # Obtener velas
        historical = await _fetch_historical_internal(symbol, interval, days, skip_day_limit=True)

        if not historical.get('success') or not historical.get('data'):
            return {"success": False, "error": "Could not fetch historical data"}

        candles = historical['data']

        # Si no se pasan zonas, detectar con parámetros dados
        if not zones and params:
            zone_params = ZoneDetectionParams(**params)
            detected = zone_detector.detect_zones(candles, method="consolidation", params=zone_params)
            zones = [z.to_dict() for z in detected]

        if not zones:
            return {"success": False, "error": "No zones provided and no params to detect"}

        # Analizar cada zona
        analyzer = ZoneQualityAnalyzer(candles)
        analyses = analyzer.analyze_multiple_zones(zones, lookforward_bars)

        # Generar estadísticas
        stats = analyzer.generate_statistics(analyses, quality_threshold)

        # Convertir análisis a diccionarios con información para visualización
        analyses_dict = []
        for a in analyses:
            d = a.to_dict()
            # Añadir clasificación de calidad
            if a.quality_score >= 80:
                d['quality_class'] = 'excellent'
            elif a.quality_score >= 60:
                d['quality_class'] = 'good'
            elif a.quality_score >= 40:
                d['quality_class'] = 'average'
            else:
                d['quality_class'] = 'poor'
            analyses_dict.append(d)

        # Ordenar por quality_score descendente
        analyses_dict.sort(key=lambda x: x['quality_score'], reverse=True)

        return {
            "success": True,
            "symbol": symbol,
            "interval": interval,
            "zones_analyzed": len(analyses),
            "statistics": stats,
            "analyses": analyses_dict,
            "quality_zones": [a for a in analyses_dict if a['quality_score'] >= quality_threshold],
            "visualization_data": {
                "zones_by_quality": {
                    "excellent": [a for a in analyses_dict if a['quality_class'] == 'excellent'],
                    "good": [a for a in analyses_dict if a['quality_class'] == 'good'],
                    "average": [a for a in analyses_dict if a['quality_class'] == 'average'],
                    "poor": [a for a in analyses_dict if a['quality_class'] == 'poor']
                }
            }
        }

    except Exception as e:
        print(f"[ERROR] Zone quality analysis: {e}")
        import traceback
        traceback.print_exc()
        return {"success": False, "error": str(e)}


@app.get("/api/zones/quality-metrics")
async def get_quality_metrics_info():
    """
    Retorna información sobre las métricas de calidad disponibles.
    """
    return {
        "success": True,
        "metrics": {
            "r_multiple": {
                "description": "Ratio entre el movimiento del precio después del breakout y la altura de la zona",
                "formula": "MFE / zone_height",
                "interpretation": {
                    "< 1.0": "Breakout débil - no alcanzó ni siquiera 1x la altura de la zona",
                    "1.0 - 2.0": "Breakout aceptable - movimiento moderado",
                    "2.0 - 3.0": "Breakout bueno - movimiento significativo",
                    "> 3.0": "Breakout excelente - movimiento muy fuerte"
                }
            },
            "momentum_score": {
                "description": "Evalúa la fuerza y persistencia del breakout",
                "components": {
                    "breakout_body_ratio": "Tamaño del cuerpo de la vela de breakout vs ATR",
                    "continuation_bars": "Velas consecutivas en la dirección del breakout",
                    "pullback_depth": "Máximo retroceso antes de continuar"
                }
            },
            "volume_score": {
                "description": "Evalúa la confirmación de volumen",
                "components": {
                    "zone_volume_vs_avg": "Volumen de la zona vs promedio histórico",
                    "breakout_volume_spike": "Volumen de breakout vs promedio de la zona",
                    "volume_confirmation_bars": "Velas con volumen > promedio después del breakout"
                }
            },
            "quality_score": {
                "description": "Score compuesto ponderado",
                "formula": "40% R-Multiple + 35% Momentum + 25% Volume",
                "thresholds": {
                    "excellent": ">= 80",
                    "good": "60 - 80",
                    "average": "40 - 60",
                    "poor": "< 40"
                }
            }
        },
        "recommended_params_for_2r": {
            "consol_min_bars": "8-12 (zonas más formadas)",
            "consol_max_bars": "50-80 (evitar zonas muy largas)",
            "consol_max_range_pct": "2.0-3.0% (rangos compactos)",
            "consol_atr_ratio": "0.5-0.7 (baja volatilidad)",
            "consol_body_ratio": "0.4-0.5 (velas de indecisión)",
            "consol_max_outside_bars": "3-5 (tolerancia a wick)"
        }
    }


# ==================== MAIN ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=9000,
        log_level="info"
    )