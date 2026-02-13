"""
Zone VP Service - Servicio realtime de deteccion de zonas por Volume Profile
=============================================================================
Escucha candle-close via WebSocket, ejecuta IncrementalVPScanner,
almacena zonas detectadas y envia alertas al TradingBot.
"""
import asyncio
import json
import time
import logging
from pathlib import Path
from typing import Optional, List, Dict
from dataclasses import asdict

import httpx

from zone_vp_scanner import (
    VPScannerConfig,
    IncrementalVPScanner,
    backtest_vp,
)

logger = logging.getLogger("zone_vp_service")

# Alert logger
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
_alert_logger = logging.getLogger("zone_vp_alerts")
if not _alert_logger.handlers:
    _fh = logging.FileHandler(LOG_DIR / "zone_vp_alerts.log", encoding="utf-8")
    _fh.setFormatter(logging.Formatter(
        "%(asctime)s | %(levelname)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    _alert_logger.addHandler(_fh)
    _alert_logger.setLevel(logging.INFO)

# Config persistence
CONFIG_DIR = Path("config")
CONFIG_DIR.mkdir(exist_ok=True)
CONFIG_FILE = CONFIG_DIR / "zone_vp_config.json"

# Bybit REST API
BYBIT_API_URL = "https://api.bybit.com/v5/market/kline"


class VPZoneService:
    """
    Servicio singleton para deteccion de zonas VP en tiempo real.

    Flujo:
    1. start() -> conecta al WebSocket, registra callback, carga historico
    2. _on_candle_close() -> alimenta IncrementalVPScanner
    3. Scanner detecta zonas D/P/b -> almacena + alerta al TradingBot
    4. Frontend hace polling a get_zones() cada 15s
    """

    def __init__(self):
        self.ws_manager = None
        self.config = VPScannerConfig()
        self.running = False

        # Scanners por simbolo
        self._scanners: Dict[str, IncrementalVPScanner] = {}

        # Zonas para polling del frontend
        self._recent_zones: Dict[str, List[Dict]] = {}
        self._max_zones_per_symbol = 100

        # Cooldowns por simbolo+direccion
        self._cooldowns: Dict[str, float] = {}

        # Stats
        self.stats = {
            "zones_detected": 0,
            "alerts_sent": 0,
            "alerts_blocked_cooldown": 0,
            "candles_processed": 0,
            "start_time": 0,
        }

        # HTTP client para alertas
        self._http_client: Optional[httpx.AsyncClient] = None

        # Cargar config
        self._load_config()

    # --------------------------------------------------
    # Config persistence
    # --------------------------------------------------

    def _load_config(self):
        """Carga configuracion desde archivo JSON."""
        if CONFIG_FILE.exists():
            try:
                with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                for key, val in data.items():
                    if hasattr(self.config, key):
                        setattr(self.config, key, val)
                logger.info(f"[VP_SERVICE] Config cargada: "
                            f"{len(self.config.symbols)} simbolos, "
                            f"interval={self.config.interval}")
            except Exception as e:
                logger.error(f"[VP_SERVICE] Error cargando config: {e}")
        else:
            logger.info("[VP_SERVICE] Sin config previa, usando defaults")

    def _save_config(self):
        """Guarda configuracion a archivo JSON."""
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(asdict(self.config), f, indent=2, ensure_ascii=False)
            logger.info("[VP_SERVICE] Config guardada")
        except Exception as e:
            logger.error(f"[VP_SERVICE] Error guardando config: {e}")

    def update_config(self, new_config: Dict):
        """Actualiza config y guarda."""
        for key, val in new_config.items():
            if hasattr(self.config, key):
                setattr(self.config, key, val)
        self._save_config()

    # --------------------------------------------------
    # Start / Stop
    # --------------------------------------------------

    async def start(self):
        """Inicia el servicio de deteccion VP en tiempo real."""
        if self.running:
            logger.info("[VP_SERVICE] Ya esta corriendo")
            return

        from websocket_manager import get_websocket_manager
        self.ws_manager = get_websocket_manager()

        self.running = True
        self.config.enabled = True
        self.stats["start_time"] = time.time()
        self._save_config()

        # HTTP client para alertas
        self._http_client = httpx.AsyncClient(timeout=15.0)

        # Registrar callback
        self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)

        # Suscribir simbolos/intervalos
        await self.ws_manager.add_subscriptions(
            self.config.symbols, [self.config.interval])

        # Crear scanners por simbolo
        for symbol in self.config.symbols:
            self._scanners[symbol] = IncrementalVPScanner(
                symbol=symbol, config=self.config)
            self._recent_zones[symbol] = []

        # Cargar historico en background
        asyncio.create_task(self._load_initial_data())

        logger.info(f"[VP_SERVICE] Iniciado - "
                    f"{len(self.config.symbols)} simbolos @ "
                    f"{self.config.interval}m, "
                    f"window={self.config.window_size}")

    async def stop(self):
        """Detiene el servicio."""
        if not self.running:
            return

        self.running = False
        self.config.enabled = False
        self._save_config()

        # Remover callback
        if self.ws_manager:
            self.ws_manager.remove_candle_close_listener(
                self._sync_candle_close_handler)

        # Cerrar HTTP client
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        # Limpiar scanners
        self._scanners.clear()

        logger.info("[VP_SERVICE] Detenido")

    # --------------------------------------------------
    # Initial data load
    # --------------------------------------------------

    async def _load_initial_data(self):
        """Carga historico para warmup de cada scanner."""
        for symbol in self.config.symbols:
            scanner = self._scanners.get(symbol)
            if not scanner:
                continue

            try:
                candles = await self._fetch_historical(
                    symbol, self.config.interval,
                    self.config.warmup_candles + self.config.window_size)

                if candles:
                    scanner.warmup(candles)
                    logger.info(f"[VP_SERVICE] {symbol}: Warmup con "
                                f"{len(candles)} velas")

                    # Ejecutar scan inicial para tener zonas base
                    # Procesar las ultimas window_size velas como si fuera realtime
                    for c in candles[-self.config.window_size:]:
                        events = scanner.process_candle(c)
                        self._handle_events(symbol, events)

                    # Actualizar zonas para frontend
                    self._update_recent_zones(symbol)

            except Exception as e:
                logger.error(f"[VP_SERVICE] Error cargando historico "
                             f"{symbol}: {e}")

    async def _fetch_historical(self, symbol: str, interval: str,
                                limit: int) -> List[Dict]:
        """Fetch velas historicas de Bybit API."""
        candles = []
        remaining = limit
        end_time = None

        while remaining > 0:
            batch_size = min(remaining, 1000)
            params = {
                "category": "linear",
                "symbol": symbol,
                "interval": interval,
                "limit": batch_size,
            }
            if end_time:
                params["end"] = end_time

            try:
                if not self._http_client or self._http_client.is_closed:
                    self._http_client = httpx.AsyncClient(timeout=30.0)

                resp = await self._http_client.get(BYBIT_API_URL, params=params)
                data = resp.json()

                if data.get("retCode") != 0:
                    logger.error(f"[VP_SERVICE] Bybit API error: "
                                 f"{data.get('retMsg')}")
                    break

                result_list = data.get("result", {}).get("list", [])
                if not result_list:
                    break

                batch = []
                for item in result_list:
                    batch.append({
                        "timestamp": int(item[0]),
                        "open": float(item[1]),
                        "high": float(item[2]),
                        "low": float(item[3]),
                        "close": float(item[4]),
                        "volume": float(item[5]),
                    })

                batch.sort(key=lambda c: c["timestamp"])
                candles = batch + candles
                remaining -= len(batch)

                if len(batch) < batch_size:
                    break

                end_time = batch[0]["timestamp"] - 1

            except Exception as e:
                logger.error(f"[VP_SERVICE] Fetch error {symbol}: {e}")
                break

        candles.sort(key=lambda c: c["timestamp"])
        return candles

    # --------------------------------------------------
    # Candle close callback
    # --------------------------------------------------

    def _sync_candle_close_handler(self, symbol: str, interval: str, candle):
        """Wrapper sincrono para callback del WebSocket."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._on_candle_close(symbol, interval, candle))
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._on_candle_close(symbol, interval, candle))
            except Exception as e:
                logger.error(f"[VP_SERVICE] No se pudo programar handler: {e}")

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Procesa cada cierre de vela."""
        if not self.running or not self.config.enabled:
            return
        if symbol not in self.config.symbols:
            return
        if interval != self.config.interval:
            return

        # Normalizar candle a dict
        if hasattr(candle, "timestamp"):
            candle_dict = {
                "timestamp": candle.timestamp,
                "open": candle.open,
                "high": candle.high,
                "low": candle.low,
                "close": candle.close,
                "volume": candle.volume,
            }
        elif isinstance(candle, dict):
            candle_dict = candle
        else:
            return

        self.stats["candles_processed"] += 1

        # Alimentar scanner
        scanner = self._scanners.get(symbol)
        if not scanner:
            return

        try:
            events = scanner.process_candle(candle_dict)
            self._handle_events(symbol, events)
            self._update_recent_zones(symbol)

        except Exception as e:
            logger.error(f"[VP_SERVICE] Error procesando {symbol}: {e}")

    def _handle_events(self, symbol: str, events: List[Dict]):
        """Procesa eventos del scanner."""
        for event in events:
            event_type = event.get('type', '')

            if event_type == 'zone_started':
                self.stats["zones_detected"] += 1
                _alert_logger.info(
                    f"ZONE_STARTED | {symbol} | "
                    f"score={event['zone'].get('d_score', 0)} | "
                    f"shape={event['zone'].get('shape_type', '')}")

            elif event_type == 'zone_complete':
                _alert_logger.info(
                    f"ZONE_COMPLETE | {symbol} | "
                    f"{event['zone'].get('id', '')} | "
                    f"candles={event['zone'].get('candle_count', 0)}")

            elif event_type == 'breakout':
                trade = event['trade']
                _alert_logger.info(
                    f"BREAKOUT | {symbol} | "
                    f"{trade.get('breakout_direction', '')} | "
                    f"entry={trade.get('entry_price', 0):.2f} | "
                    f"SL={trade.get('sl_price', 0):.2f} | "
                    f"TP={trade.get('tp_price', 0):.2f}")

                # Enviar alerta al TradingBot
                if self.config.alerts_enabled:
                    asyncio.create_task(
                        self._send_alert(symbol, trade))

            elif event_type in ('win', 'loss'):
                trade = event['trade']
                _alert_logger.info(
                    f"{event_type.upper()} | {symbol} | "
                    f"{trade.get('id', '')} | "
                    f"pnl={trade.get('trade_pnl_r', 0):.1f}R")

    def _update_recent_zones(self, symbol: str):
        """Actualiza la lista de zonas recientes para polling del frontend."""
        scanner = self._scanners.get(symbol)
        if not scanner:
            return

        zones = scanner.get_all_zones()
        # Ordenar por timestamp descendente (mas reciente primero)
        zones.sort(key=lambda z: z.get('start_timestamp', 0), reverse=True)
        # Limitar
        self._recent_zones[symbol] = zones[:self._max_zones_per_symbol]

    # --------------------------------------------------
    # Alert sending
    # --------------------------------------------------

    async def _send_alert(self, symbol: str, trade: Dict):
        """Envia alerta al TradingBot."""
        direction = trade.get('breakout_direction', 'UP')

        # Cooldown check
        cooldown_key = f"{symbol}_{direction}"
        now = time.time()
        last = self._cooldowns.get(cooldown_key, 0)
        if now - last < self.config.cooldown_minutes * 60:
            remaining = int(self.config.cooldown_minutes * 60 - (now - last))
            self.stats["alerts_blocked_cooldown"] += 1
            _alert_logger.info(
                f"BLOCKED_COOLDOWN | {symbol} | {direction} | "
                f"remaining={remaining}s")
            return

        alert_payload = {
            "source": "VP_ZONE_SCANNER",
            "symbol": symbol,
            "interval": self.config.interval,
            "pattern": {
                "patternType": f"VP_ZONE_{direction}",
                "price": trade.get('entry_price', 0),
                "confidence": trade.get('d_score', 50),
                "timestamp": trade.get('entry_timestamp', 0),
                "direction": "LONG" if direction == "UP" else "SHORT",
                "shape_type": trade.get('shape_type', 'D'),
            },
            "custom_stop_loss": trade.get('sl_price'),
            "custom_take_profit": trade.get('tp_price'),
        }

        try:
            if not self._http_client or self._http_client.is_closed:
                self._http_client = httpx.AsyncClient(timeout=15.0)

            resp = await self._http_client.post(
                self.config.alert_target_url,
                json=alert_payload,
                timeout=10.0)

            if resp.status_code == 200:
                self._cooldowns[cooldown_key] = now
                self.stats["alerts_sent"] += 1
                _alert_logger.info(
                    f"ALERT_SENT | {symbol} | {direction} | "
                    f"price={trade.get('entry_price', 0):.2f} | "
                    f"shape={trade.get('shape_type', 'D')}")
            else:
                _alert_logger.warning(
                    f"ALERT_FAILED | {symbol} | "
                    f"status={resp.status_code}")

        except Exception as e:
            _alert_logger.error(
                f"ALERT_ERROR | {symbol} | {e}")

    # --------------------------------------------------
    # API methods (llamados desde endpoints)
    # --------------------------------------------------

    def get_zones(self, symbol: str) -> List[Dict]:
        """Retorna zonas para polling del frontend."""
        return self._recent_zones.get(symbol, [])

    def get_status(self) -> Dict:
        """Retorna estado del servicio."""
        scanner_states = {}
        for sym, scanner in self._scanners.items():
            scanner_states[sym] = scanner.get_state()

        return {
            "running": self.running,
            "enabled": self.config.enabled,
            "config": asdict(self.config),
            "stats": self.stats,
            "scanners": scanner_states,
            "zones_count": {
                sym: len(zones)
                for sym, zones in self._recent_zones.items()
            },
        }

    async def reanalyze(self):
        """Reinicia scanners y recarga historico."""
        logger.info("[VP_SERVICE] Reiniciando scanners para re-analisis...")

        for symbol in self.config.symbols:
            self._scanners[symbol] = IncrementalVPScanner(
                symbol=symbol, config=self.config)
            self._recent_zones[symbol] = []

        await self._load_initial_data()
        logger.info("[VP_SERVICE] Re-analisis completado")


# ---------------------------------------------------------------------------
# Singleton
# ---------------------------------------------------------------------------

_vp_zone_service: Optional[VPZoneService] = None


def get_vp_zone_service() -> VPZoneService:
    """Retorna singleton del servicio VP."""
    global _vp_zone_service
    if _vp_zone_service is None:
        _vp_zone_service = VPZoneService()
    return _vp_zone_service
