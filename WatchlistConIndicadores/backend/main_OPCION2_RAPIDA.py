# -*- coding: utf-8 -*-
# OPCIÓN 2: SOLUCIÓN RÁPIDA - AJUSTE DE LÍMITES DINÁMICOS
# Esta versión ajusta dinámicamente los límites de datos según el timeframe
# para asegurar que siempre se muestren TODAS las barras disponibles

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
    version="3.0.0 - OPCIÓN 2: Límites Dinámicos",
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

# ✅ OPCIÓN 2: Límites aumentados para timeframes grandes
# Esto asegura que siempre tengamos suficientes datos para llenar todas las barras
MAX_DAYS_BY_INTERVAL = {
    "1": 5,       # 1 min -> máx 5 días
    "3": 10,      # 3 min -> máx 10 días
    "5": 5,       # 5 min -> máx 5 días
    "15": 15,     # 15 min -> máx 15 días
    "30": 30,     # 30 min -> máx 30 días
    "60": 120,    # 1 hora -> máx 120 días
    "120": 240,   # 2 horas -> máx 240 días (AUMENTADO)
    "240": 500,   # 4 horas -> máx 500 días (AUMENTADO)
    "D": 1000,    # 1 día -> máx 1000 días (AUMENTADO)
    "W": 1000,    # 1 semana -> máx 1000 días (AUMENTADO)
}

# ✅ OPCIÓN 2: Multiplicador de datos para asegurar cobertura completa
# En timeframes grandes, solicitamos más datos del necesario para compensar
# cualquier gap en los datos de la API
DATA_MULTIPLIER_BY_INTERVAL = {
    "1": 1.0,
    "3": 1.0,
    "5": 1.0,
    "15": 1.0,
    "30": 1.0,
    "60": 1.2,    # 20% más datos
    "120": 1.5,   # 50% más datos
    "240": 2.0,   # 100% más datos (CLAVE PARA 4H)
    "D": 2.5,     # 150% más datos (CLAVE PARA 1D)
    "W": 3.0,     # 200% más datos
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
    oi_cache_files = list(CACHE_DIR.glob("*_openinterest.json"))

    return {
        "status": "ok",
        "time_utc": int(now_utc.timestamp()),
        "time_colombia": now_colombia.strftime("%Y-%m-%d %H:%M:%S"),
        "timezone": "America/Bogota (UTC-5)",
        "cache_files": len(cache_files),
        "oi_cache_files": len(oi_cache_files),
        "version": "3.0.0 - OPCIÓN 2: Límites Dinámicos Aumentados",
        "cache_duration": "30 minutos",
        "cache_max_age_seconds": CACHE_MAX_AGE,
        "max_days_limits": MAX_DAYS_BY_INTERVAL,
        "data_multipliers": DATA_MULTIPLIER_BY_INTERVAL
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

# Mapeo de intervalos para Open Interest
OI_INTERVAL_MAP = {
    "1": "5min",
    "3": "5min",
    "5": "5min",
    "15": "15min",
    "30": "30min",
    "60": "1h",
    "120": "4h",
    "240": "4h",
    "D": "1d",
    "W": "1d",
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

        # ✅ OPCIÓN 2: Aplicar límite con multiplicador
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        multiplier = DATA_MULTIPLIER_BY_INTERVAL.get(interval_final, 1.0)
        days_to_fetch = min(int(days * multiplier), max_days_allowed)

        print(f"[{symbol}] 📊 HISTORICAL (OPCIÓN 2): Recibido days={days}, con multiplicador {multiplier}x -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

        interval_minutes = get_interval_minutes(interval_final)
        minutes_in_period = days_to_fetch * 24 * 60
        total_candles_needed = int(minutes_in_period / interval_minutes)

        limit_per_request = min(1000, total_candles_needed)

        now_ms = int(time.time() * 1000)
        end_ms = now_ms + (10 * 60 * 1000)
        start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)

        all_candles = []
        current_start = start_ms

        async with httpx.AsyncClient(timeout=30) as client:
            request_count = 0
            max_requests = 15  # ✅ Aumentado para timeframes grandes

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

        # ✅ OPCIÓN 2: Devolver los últimos datos hasta el número solicitado original
        # Esto asegura que mostramos todas las barras disponibles
        expected_for_original_days = int((days * 24 * 60) / interval_minutes)
        if len(candles) > expected_for_original_days:
            candles = candles[-expected_for_original_days:]

        now_colombia = datetime.now(COLOMBIA_TZ)

        print(f"[{symbol}] Historical: ✅ Devolviendo {len(candles)} velas (esperadas: {expected_for_original_days}, obtenidas: {len(all_candles)})")

        return {
            "symbol": symbol,
            "interval": interval_final,
            "data": candles,
            "updated": int(time.time() * 1000),
            "updated_colombia": now_colombia.strftime("%Y-%m-%d %H:%M:%S"),
            "timezone": "America/Bogota (UTC-5)",
            "success": True,
            "total_candles": len(candles),
            "requested_candles": expected_for_original_days,
            "fetched_candles": len(all_candles),
            "days_requested": days,
            "days_fetched": days_to_fetch,
            "max_days_allowed": max_days_allowed,
            "multiplier_applied": multiplier
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

# ... [El resto del código es idéntico a la Opción 1, incluyendo volume-delta y open-interest endpoints]
# ... [Se omite por brevedad pero debe incluir los mismos endpoints]

@app.get("/api/open-interest/{symbol}")
async def get_open_interest(symbol: str, interval: str = "15", days: int = 30):
    """
    OPCIÓN 2: Endpoint de Open Interest con límites dinámicos aumentados
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

        # ✅ OPCIÓN 2: Aplicar multiplicador para timeframes grandes
        max_days_allowed = MAX_DAYS_BY_INTERVAL.get(interval_final, 30)
        multiplier = DATA_MULTIPLIER_BY_INTERVAL.get(interval_final, 1.0)
        days_to_fetch = min(int(days * multiplier), max_days_allowed)

        print(f"[{symbol}] 📊 OPEN INTEREST (OPCIÓN 2): Recibido days={days}, multiplicador {multiplier}x -> days_to_fetch={days_to_fetch} (máx: {max_days_allowed}) @ {interval_final}")

        interval_minutes = get_interval_minutes(interval_final)
        minutes_in_period = days_to_fetch * 24 * 60
        expected_points = int(minutes_in_period / interval_minutes)

        # Cache check...
        cached_data = load_cache(symbol, interval_final, "openinterest")

        if cached_data and cached_data.get("symbol") == symbol and cached_data.get("timeframe") == interval_final:
            data_points = cached_data.get("data", [])
            cache_age = time.time() - cached_data.get('timestamp', 0)

            expected_for_original_days = int((days * 24 * 60) / interval_minutes)

            if len(data_points) >= expected_for_original_days:
                points_to_return = data_points[-expected_for_original_days:]

                print(f"[CACHE HIT] ✅ {symbol} {interval_final} Open Interest desde cache (age: {cache_age:.0f}s)")

                return {
                    "symbol": symbol,
                    "interval": interval_final,
                    "indicator": "openInterest",
                    "data": points_to_return,
                    "success": True,
                    "from_cache": True,
                    "cache_age_seconds": int(cache_age),
                    "total_points": len(points_to_return),
                    "days_requested": days,
                    "days_fetched": days_to_fetch,
                    "max_days_allowed": max_days_allowed
                }

        # Fetch desde API con días aumentados...
        print(f"[FETCHING] {symbol} {interval_final} Open Interest desde Bybit API con {days_to_fetch} días (multiplicador: {multiplier}x)")

        oi_interval = OI_INTERVAL_MAP.get(interval_final, "15min")

        now_ms = int(time.time() * 1000)
        end_ms = now_ms + (10 * 60 * 1000)
        start_ms = now_ms - (days_to_fetch * 24 * 60 * 60 * 1000)

        all_oi_data = []
        current_start = start_ms

        async with httpx.AsyncClient(timeout=30) as client:
            request_count = 0
            max_requests = 15  # ✅ Aumentado

            while len(all_oi_data) < expected_points and request_count < max_requests:
                request_count += 1
                remaining_points = expected_points - len(all_oi_data)
                fetch_limit = min(200, remaining_points)

                url = (
                    "https://api.bybit.com/v5/market/open-interest?"
                    f"category=linear&symbol={symbol}&intervalTime={oi_interval}"
                    f"&startTime={current_start}&endTime={end_ms}&limit={fetch_limit}"
                )

                r = await client.get(url)
                data = r.json()

                if data.get("retCode") != 0:
                    print(f"[ERROR {symbol}] Bybit OI error: {data.get('retMsg')}")
                    break

                batch_data = data.get("result", {}).get("list", [])
                if not batch_data:
                    break

                batch_data.reverse()

                for item in batch_data:
                    ts_ms = int(item["timestamp"])
                    oi_value = float(item["openInterest"])

                    all_oi_data.append({
                        "timestamp": ts_ms,
                        "openInterest": oi_value,
                        "datetime_colombia": datetime.fromtimestamp(ts_ms/1000, tz=COLOMBIA_TZ).strftime("%Y-%m-%d %H:%M:%S")
                    })

                if len(batch_data) > 0:
                    last_ts = int(batch_data[-1]["timestamp"])
                    current_start = last_ts + (interval_minutes * 60 * 1000)

                    if current_start >= end_ms:
                        break

                if len(all_oi_data) >= expected_points:
                    break

                await asyncio.sleep(0.1)

        # ✅ Devolver solo los datos del período original solicitado
        expected_for_original_days = int((days * 24 * 60) / interval_minutes)
        if len(all_oi_data) > expected_for_original_days:
            all_oi_data = all_oi_data[-expected_for_original_days:]

        # Guardar en cache
        cache_data = {
            "symbol": symbol,
            "timeframe": interval_final,
            "data": all_oi_data
        }
        save_cache(symbol, interval_final, "openinterest", cache_data)

        print(f"[SUCCESS] {symbol} {interval_final} Open Interest: ✅ Devolviendo {len(all_oi_data)} puntos (esperados: {expected_for_original_days})")

        return {
            "symbol": symbol,
            "interval": interval_final,
            "indicator": "openInterest",
            "data": all_oi_data,
            "success": True,
            "from_cache": False,
            "calculated": True,
            "total_points": len(all_oi_data),
            "days_requested": days,
            "days_fetched": days_to_fetch,
            "max_days_allowed": max_days_allowed,
            "multiplier_applied": multiplier
        }

    except Exception as e:
        print(f"[ERROR] Open Interest {symbol}: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "symbol": symbol,
            "error": str(e),
            "success": False
        }

# [El resto de endpoints se incluyen aquí igual que en la Opción 1]

from rejection_detector import RejectionDetector, serialize_pattern
from alert_sender import send_pattern_alert
from fastapi import Request

rejection_detector = RejectionDetector()

# [Incluir todos los endpoints de rejection patterns, etc.]

@app.on_event("startup")
async def startup_event():
    """Initialize services on startup"""
    from alert_sender import initialize_alert_sender
    await initialize_alert_sender()
    print("[STARTUP] Backend started - OPCIÓN 2: Límites Dinámicos Aumentados")
    print("[STARTUP] Alert sender initialized")

@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown"""
    from alert_sender import shutdown_alert_sender
    await shutdown_alert_sender()
    print("[SHUTDOWN] Backend shutdown complete")
