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

@app.get("/api/historical/{symbol}")
@limiter.limit("60/minute")
async def get_historical(request: Request, symbol: str, interval: str = "15", days: int = 30):
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

# Configuración de timeframes y subdivisiones para backtesting
BACKTESTING_CONFIG = {
    "15m": {
        "interval": "15",
        "subdivisions": {
            "interval": "5",
            "count": 3  # 3 velas de 5 minutos forman 1 vela de 15 minutos
        }
    },
    "1h": {
        "interval": "60",
        "subdivisions": {
            "interval": "15",
            "count": 4  # 4 velas de 15 minutos forman 1 vela de 1 hora
        }
    },
    "4h": {
        "interval": "240",
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

        async with httpx.AsyncClient(timeout=60) as client:
            request_count = 0
            # Calcular max_requests basado en las velas necesarias
            # Cada request trae máximo 1000 velas
            max_requests = min(200, (total_candles_needed // 1000) + 10)
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
        days = 1095  # 3 años

        # Descargar datos para cada timeframe
        for tf_name, config in BACKTESTING_CONFIG.items():
            print(f"\n[BACKTESTING] ===== Procesando {tf_name} =====")

            # Descargar velas principales
            main_interval = config["interval"]
            main_candles = await fetch_backtesting_timeframe(symbol, main_interval, days)

            if not main_candles:
                print(f"[ERROR] No se pudieron obtener datos para {tf_name}")
                continue

            # Descargar subdivisiones
            subdivision_interval = config["subdivisions"]["interval"]
            subdivision_candles = await fetch_backtesting_timeframe(symbol, subdivision_interval, days)

            if not subdivision_candles:
                print(f"[ERROR] No se pudieron obtener subdivisiones para {tf_name}")
                continue

            # >> CORREGIDO: Calcular rango de timestamps de las velas para OI
            # Usar las velas principales para determinar el rango temporal exacto
            min_candle_ts = min(c["timestamp"] for c in main_candles)
            max_candle_ts = max(c["timestamp"] for c in main_candles)

            print(f"\n[BACKTESTING] Obteniendo Open Interest para {tf_name}...")
            print(f"[BACKTESTING] Rango de velas: {datetime.fromtimestamp(min_candle_ts/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M')} -> {datetime.fromtimestamp(max_candle_ts/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M')}")

            # >> CORREGIDO: Pasar timestamps exactos del rango de velas
            oi_response = await get_open_interest(
                symbol,
                str(main_interval),
                days,
                start_timestamp_ms=min_candle_ts,
                end_timestamp_ms=max_candle_ts
            )
            oi_data = oi_response.get("data", []) if oi_response.get("success") else []

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
        all_timestamps = []
        for tf_data in timeframes_data.values():
            all_timestamps.extend([c["timestamp"] for c in tf_data["main"]])

        if all_timestamps:
            min_ts = min(all_timestamps)
            max_ts = max(all_timestamps)

            start_date = datetime.fromtimestamp(min_ts / 1000, tz=COLOMBIA_TZ)
            end_date = datetime.fromtimestamp(max_ts / 1000, tz=COLOMBIA_TZ)
        else:
            start_date = end_date = datetime.now(COLOMBIA_TZ)

        metadata = {
            "cached_at": int(time.time() * 1000),
            "cached_at_colombia": datetime.now(COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S"),
            "date_range": {
                "start": start_date.strftime("%Y-%m-%d %H:%M:%S"),
                "end": end_date.strftime("%Y-%m-%d %H:%M:%S"),
                "days": days
            }
        }

        # Preparar respuesta
        response_data = {
            "symbol": symbol,
            "timeframes": timeframes_data,
            "metadata": metadata
        }

        # Guardar en caché
        save_backtesting_cache(symbol, response_data)

        print(f"\n[BACKTESTING] OK Datos completos para {symbol} listos")
        print(f"  - Timeframes: {list(timeframes_data.keys())}")
        print(f"  - Rango: {metadata['date_range']['start']} -> {metadata['date_range']['end']}")

        return {
            "success": True,
            "from_cache": False,
            **response_data
        }

    except Exception as e:
        print(f"[ERROR] Backtesting bulk data {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
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
        days = 1095  # 3 años por defecto

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
            historical = await get_historical(symbol, interval, days)

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


# ==================== MAIN ====================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )