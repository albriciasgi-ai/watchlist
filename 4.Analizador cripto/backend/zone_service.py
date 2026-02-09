# zone_service.py
# Servicio de deteccion de zonas de consolidacion en tiempo real.
# Escucha candle-close via WebSocket, mantiene un buffer deslizante de velas,
# detecta consolidaciones y breakouts, y envia alertas al TradingBot.

import asyncio
import json
import time
import logging
import uuid
from pathlib import Path
from typing import Optional, List, Dict
from dataclasses import dataclass, field, asdict

import httpx

from zone_detector import ZoneDetector, ZoneDetectionParams, TradingZone
from pattern_state_manager import get_pattern_state_manager, AlertRecord

logger = logging.getLogger("zone_service")

# File-based alert log
LOG_DIR = Path("logs")
LOG_DIR.mkdir(exist_ok=True)
alert_log_file = LOG_DIR / "zone_alerts.log"
alert_logger = logging.getLogger("zone_alerts")
if not alert_logger.handlers:
    fh = logging.FileHandler(alert_log_file, encoding="utf-8")
    fh.setFormatter(logging.Formatter("%(asctime)s | %(levelname)s | %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    alert_logger.addHandler(fh)
    alert_logger.setLevel(logging.INFO)


# ============================================================
# Config
# ============================================================

CONFIG_DIR = Path("config")
CONFIG_DIR.mkdir(exist_ok=True)
CONFIG_FILE = CONFIG_DIR / "zone_realtime_config.json"

# Bybit REST API
BYBIT_API_URL = "https://api.bybit.com/v5/market/kline"


@dataclass
class ZoneServiceConfig:
    """Configuracion del servicio de deteccion de zonas en tiempo real."""
    enabled: bool = False  # Deshabilitado por defecto (activar desde el frontend)
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT"])
    interval: str = "5"  # Timeframe de las velas
    window_candles: int = 500  # Ventana de velas hacia atras para deteccion

    # Parametros de deteccion (subset mas relevante de ZoneDetectionParams)
    consol_min_bars: int = 8
    consol_max_bars: int = 50
    consol_max_range_pct: float = 2.0
    consol_atr_ratio: float = 0.6
    consol_body_ratio: float = 0.5
    consol_max_outside_bars: int = 3
    breakout_search_bars: int = 20
    entry_mode: str = "breakout_close"
    sl_mode: str = "zone_opposite"
    sl_poc_buffer_pct: float = 50.0
    swing_bars: int = 5
    min_score_filter: float = 0.0
    max_price_range_pct: float = 5.0
    vp_bins_per_zone: int = 30

    # Capas opcionales v3.0
    use_atr_band: bool = False
    atr_band_period: int = 200
    atr_band_multiplier: float = 1.0
    atr_band_ma_period: int = 20
    use_reentry: bool = False
    max_reentry_bars: int = 3
    use_ttm_prefilter: bool = False
    use_bbwp_scoring: bool = False
    use_inside_pct_filter: bool = False

    # Alertas
    alertsEnabled: bool = True
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
    cooldownMinutes: int = 30

    def to_dict(self) -> Dict:
        return asdict(self)


# ============================================================
# Service
# ============================================================

class ZoneService:
    """
    Servicio singleton que detecta zonas de consolidacion y breakouts en tiempo real.

    Flujo:
    1. Al iniciar: carga window_candles de historico, detecta zonas existentes.
    2. En cada cierre de vela (via WebSocket callback):
       - Agrega la vela al buffer (deslizante).
       - Re-ejecuta deteccion en el buffer completo.
       - Compara zonas nuevas vs conocidas.
       - Si hay breakout nuevo -> envia alerta al TradingBot.
    """

    def __init__(self):
        self.detector = ZoneDetector()
        self.ws_manager = None  # Se asigna en start()
        self.config = ZoneServiceConfig()
        self.running = False

        # Zonas conocidas por simbolo (evita re-alertar)
        self._known_zones: Dict[str, Dict[str, TradingZone]] = {}
        # Zonas recientes para consulta del frontend
        self._recent_zones: Dict[str, List[Dict]] = {}
        self._max_zones_per_symbol = 200

        # Cooldown por simbolo+direccion
        self._cooldowns: Dict[str, float] = {}

        # Trades abiertos (zonas con trade_result=OPEN que se monitorean vela a vela)
        self._open_trades: Dict[str, List[Dict]] = {}  # symbol -> list of zone dicts

        # Zonas pendientes de breakout (consolidaciones detectadas sin ruptura aun)
        # Cada entrada tiene: zone_high, zone_low, vah, val, poc, start_ts, end_ts, etc.
        self._pending_zones: Dict[str, List[Dict]] = {}  # symbol -> list of pending zone dicts

        # Stats
        self.stats = {
            "zones_detected": 0,
            "alerts_sent": 0,
            "alerts_blocked_cooldown": 0,
            "alerts_blocked_score": 0,
            "candles_processed": 0,
            "detections_run": 0,
            "last_candle_time": 0,
            "last_detection_zones": 0,
            "start_time": 0,
            "open_trades_resolved": 0,
            "pending_zones_current": 0,
            "pending_breakouts_detected": 0,
        }

        # HTTP client
        self._http_client: Optional[httpx.AsyncClient] = None

        # Candle buffers por simbolo (ventana deslizante)
        self._candle_buffers: Dict[str, List[Dict]] = {}

        # Cargar config persistente
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
                logger.info(f"[ZONE_SERVICE] Config cargada: {len(self.config.symbols)} simbolos, interval={self.config.interval}")
            except Exception as e:
                logger.error(f"[ZONE_SERVICE] Error cargando config: {e}")
        else:
            logger.info("[ZONE_SERVICE] Sin config previa, usando defaults")

    def _save_config(self):
        """Guarda configuracion a archivo JSON."""
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config.to_dict(), f, indent=2, ensure_ascii=False)
            logger.info("[ZONE_SERVICE] Config guardada")
        except Exception as e:
            logger.error(f"[ZONE_SERVICE] Error guardando config: {e}")

    # --------------------------------------------------
    # Start / Stop
    # --------------------------------------------------

    async def start(self):
        """Inicia el servicio de deteccion en tiempo real."""
        if self.running:
            logger.info("[ZONE_SERVICE] Ya esta corriendo")
            return

        from websocket_manager import get_websocket_manager
        self.ws_manager = get_websocket_manager()

        self.running = True
        self.stats["start_time"] = time.time()

        # HTTP client para alertas
        self._http_client = httpx.AsyncClient(timeout=15.0)

        # Registrar callback de candle close
        self.ws_manager.add_candle_close_listener(self._sync_candle_close_handler)

        # Asegurar que el WebSocket tiene nuestros simbolos/interval suscritos
        if self.ws_manager.is_connected():
            await self.ws_manager.add_subscriptions(self.config.symbols, [self.config.interval])

        # Cargar historico inicial (background, no bloquea)
        asyncio.create_task(self._load_initial_data())

        logger.info(f"[ZONE_SERVICE] Iniciado - {len(self.config.symbols)} simbolos @ {self.config.interval}m, ventana={self.config.window_candles}")

    async def stop(self):
        """Detiene el servicio."""
        if not self.running:
            return

        self.running = False

        # Remover callback
        if self.ws_manager:
            self.ws_manager.remove_candle_close_listener(self._sync_candle_close_handler)

        # Cerrar HTTP client
        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("[ZONE_SERVICE] Detenido")

    # --------------------------------------------------
    # Candle close callback (sync wrapper -> async task)
    # --------------------------------------------------

    def _sync_candle_close_handler(self, symbol: str, interval: str, candle):
        """Wrapper sincrono para el callback del WebSocket."""
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._on_candle_close(symbol, interval, candle))
        except RuntimeError:
            try:
                loop = asyncio.get_event_loop()
                loop.create_task(self._on_candle_close(symbol, interval, candle))
            except Exception as e:
                logger.error(f"[ZONE_SERVICE] No se pudo programar handler: {e}")

    async def _on_candle_close(self, symbol: str, interval: str, candle):
        """Procesa cada cierre de vela."""
        if not self.running or not self.config.enabled:
            return

        if symbol not in self.config.symbols:
            return
        if interval != self.config.interval:
            return

        # Convertir candle a dict si es necesario
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

        close_price = candle_dict.get("close", 0)
        self.stats["candles_processed"] += 1
        self.stats["last_candle_time"] = time.time()
        logger.debug(f"[ZONE_SERVICE] Candle cerrada: {symbol} @ {close_price} (total procesadas: {self.stats['candles_processed']})")

        # Agregar al buffer deslizante
        buffer = self._candle_buffers.get(symbol, [])
        # Evitar duplicados por timestamp
        candle_ts = candle_dict["timestamp"]
        if buffer and buffer[-1]["timestamp"] >= candle_ts:
            # Actualizar la ultima vela si es el mismo timestamp
            if buffer[-1]["timestamp"] == candle_ts:
                buffer[-1] = candle_dict
            return
        buffer.append(candle_dict)

        # Mantener ventana deslizante
        max_size = self.config.window_candles + 100  # margen extra
        if len(buffer) > max_size:
            buffer = buffer[-self.config.window_candles:]
        self._candle_buffers[symbol] = buffer

        if len(buffer) < max(50, self.config.consol_min_bars + 30):
            return  # Insuficientes velas

        # Actualizar trades abiertos con la nueva vela
        self._update_open_trades(symbol, candle_dict)

        # Chequear breakouts instantaneos en pending zones
        try:
            await self._check_pending_breakouts(symbol, candle_dict)
        except Exception as e:
            logger.error(f"[ZONE_SERVICE] Error chequeando pending breakouts para {symbol}: {e}")

        # Detectar zonas en el buffer (actualiza pending zones + zonas con breakout)
        try:
            await self._detect_and_alert(symbol, buffer)
        except Exception as e:
            logger.error(f"[ZONE_SERVICE] Error detectando zonas para {symbol}: {e}")

    # --------------------------------------------------
    # Open trade tracking
    # --------------------------------------------------

    def _update_open_trades(self, symbol: str, candle: Dict):
        """
        Verifica si la vela actual toca SL o TP de trades abiertos.
        Actualiza trade_result de OPEN a WIN/LOSS segun corresponda.
        """
        open_trades = self._open_trades.get(symbol, [])
        if not open_trades:
            return

        resolved = []
        for trade in open_trades:
            direction = trade.get("breakout_direction", "")
            entry_price = trade.get("entry_price", 0)
            sl_price = trade.get("sl_price", 0)
            tp_price = trade.get("tp_price", 0)
            r_distance = abs(entry_price - sl_price) if entry_price and sl_price else 0

            if not entry_price or not sl_price or not tp_price:
                continue

            high = candle.get("high", 0)
            low = candle.get("low", 0)
            close = candle.get("close", 0)

            if direction == "UP":
                tp_hit = high >= tp_price
                sl_hit = low <= sl_price
            else:
                tp_hit = low <= tp_price
                sl_hit = high >= sl_price

            if tp_hit and sl_hit:
                # Ambos tocados: inferir por direccion de la vela
                if direction == "UP":
                    result = "WIN" if close >= candle.get("open", 0) else "LOSS"
                else:
                    result = "WIN" if close <= candle.get("open", 0) else "LOSS"
            elif tp_hit:
                result = "WIN"
            elif sl_hit:
                result = "LOSS"
            else:
                # Sigue abierto - actualizar PnL parcial
                if r_distance > 0:
                    if direction == "UP":
                        pnl = (close - entry_price) / r_distance
                    else:
                        pnl = (entry_price - close) / r_distance
                    # Clamp entre -1 y 10
                    trade["trade_pnl_r"] = round(max(min(pnl, 10.0), -1.0), 2)
                trade["trade_close_timestamp"] = candle.get("timestamp", 0)
                continue

            # Trade resuelto - calcular PnL real en R
            if result == "WIN" and r_distance > 0:
                if direction == "UP":
                    win_pnl = (tp_price - entry_price) / r_distance
                else:
                    win_pnl = (entry_price - tp_price) / r_distance
            else:
                win_pnl = 2.0  # fallback

            trade["trade_result"] = result
            trade["trade_pnl_r"] = round(win_pnl, 2) if result == "WIN" else -1.0
            trade["trade_close_timestamp"] = candle.get("timestamp", 0)
            resolved.append(trade)

            alert_logger.info(
                f"TRADE_RESOLVED | {symbol} | {result} | dir={direction} | "
                f"entry={entry_price:.2f} | sl={sl_price:.2f} | tp={tp_price:.2f}"
            )
            self.stats["open_trades_resolved"] += 1

        # Actualizar _recent_zones con TODOS los cambios (abiertos + resueltos)
        # ANTES de remover los resueltos, para que el merge los encuentre
        self._merge_tracked_trades_to_recent(symbol, open_trades)

        # Remover trades resueltos de la lista de abiertos
        if resolved:
            self._open_trades[symbol] = [t for t in open_trades if t not in resolved]

    def _merge_tracked_trades_to_recent(self, symbol: str, tracked_trades: List[Dict]):
        """
        Sincroniza trades rastreados (abiertos y recien resueltos) con _recent_zones
        para que el frontend vea los cambios de trade_result en tiempo real.
        """
        if not tracked_trades:
            return

        recent = self._recent_zones.get(symbol, [])

        # Crear mapa de trades rastreados por key unica
        tracked_map = {}
        for t in tracked_trades:
            key = f"{t.get('start_timestamp', 0)}_{t.get('end_timestamp', 0)}_{t.get('breakout_direction', '')}"
            tracked_map[key] = t

        # Actualizar zonas existentes en recent
        updated_keys = set()
        for i, zone in enumerate(recent):
            key = f"{zone.get('start_timestamp', 0)}_{zone.get('end_timestamp', 0)}_{zone.get('breakout_direction', '')}"
            if key in tracked_map:
                # Actualizar con datos del tracking
                recent[i]["trade_result"] = tracked_map[key]["trade_result"]
                recent[i]["trade_pnl_r"] = tracked_map[key]["trade_pnl_r"]
                if "trade_close_timestamp" in tracked_map[key]:
                    recent[i]["trade_close_timestamp"] = tracked_map[key]["trade_close_timestamp"]
                updated_keys.add(key)

        # Agregar trades que no estan en recent (caso: zona salio de ventana de deteccion)
        for key, trade in tracked_map.items():
            if key not in updated_keys:
                recent.append(trade)

        self._recent_zones[symbol] = recent

    # --------------------------------------------------
    # Pending zone breakout monitoring
    # --------------------------------------------------

    async def _check_pending_breakouts(self, symbol: str, candle: Dict):
        """
        Verifica si la vela actual rompe alguna zona pendiente de breakout.
        Si rompe -> calcula entry/SL/TP inmediatamente y envia alerta.
        Esto da respuesta INSTANTANEA al breakout, sin esperar re-deteccion.
        """
        pending = self._pending_zones.get(symbol, [])
        if not pending:
            return

        close_price = candle.get("close", 0)
        high = candle.get("high", 0)
        low = candle.get("low", 0)
        candle_ts = candle.get("timestamp", 0)

        broken = []
        for pz in pending:
            breakout_upper = pz.get("breakout_upper", 0)
            breakout_lower = pz.get("breakout_lower", 0)

            if not breakout_upper or not breakout_lower:
                continue

            # Breakout UP: close por encima del limite superior
            if close_price > breakout_upper:
                direction = "UP"
            # Breakout DOWN: close por debajo del limite inferior
            elif close_price < breakout_lower:
                direction = "DOWN"
            else:
                continue

            # Breakout detectado instantaneamente
            entry_price = close_price
            zone_high = pz.get("zone_high", 0)
            zone_low = pz.get("zone_low", 0)
            zone_height = zone_high - zone_low if zone_high and zone_low else 0
            poc_price = pz.get("poc_price", 0)

            # Calcular SL/TP usando la misma logica que zone_detector
            sl_price, tp_price, r_distance = self._calculate_sl_tp(
                entry_price, direction, zone_high, zone_low, poc_price
            )

            if not sl_price or not tp_price:
                continue

            # Construir zona completa como dict para almacenar y alertar
            zone_dict = {
                "start_timestamp": pz.get("start_ts", 0),
                "end_timestamp": pz.get("end_ts", 0),
                "min_price": zone_low,
                "max_price": zone_high,
                "breakout_direction": direction,
                "breakout_price": close_price,
                "breakout_timestamp": candle_ts,
                "entry_mode": self.config.entry_mode,
                "entry_price": entry_price,
                "entry_timestamp": candle_ts,
                "entry_bar_offset": 0,
                "sl_price": sl_price,
                "tp_price": tp_price,
                "trade_result": "OPEN",
                "trade_pnl_r": 0.0,
                "trade_close_timestamp": 0,
                "trading_score": pz.get("trading_score", 50.0),
                "candles_in_zone": pz.get("candle_count", 0),
                "duration_hours": pz.get("duration_hours", 0),
                "vp_poc_price": poc_price,
                "vp_vah_price": pz.get("vah_price", 0),
                "vp_val_price": pz.get("val_price", 0),
                "timeline_index": 0,  # Se renumerara
                "method": "trading_zones",
            }

            # Verificar que no sea zona ya conocida
            zone_key = f"{pz.get('start_ts', 0)}_{pz.get('end_ts', 0)}_{direction}"
            known = self._known_zones.get(symbol, {})
            if zone_key in known:
                continue

            # Marcar como conocida
            known[zone_key] = zone_dict
            self._known_zones[symbol] = known

            broken.append(pz)
            self.stats["pending_breakouts_detected"] += 1
            self.stats["zones_detected"] += 1

            alert_logger.info(
                f"INSTANT_BREAKOUT | {symbol} | {direction} | "
                f"entry={entry_price:.2f} | sl={sl_price:.2f} | tp={tp_price:.2f} | "
                f"score={zone_dict['trading_score']:.1f} | mode=pending_monitor"
            )

            # Registrar como open trade para tracking SL/TP
            # (No agregar a _recent_zones aqui: _store_zones lo hara via _merge_tracked_trades_to_recent)
            self._register_open_trades(symbol, [zone_dict])

            # Filtro de score
            if self.config.min_score_filter > 0 and zone_dict["trading_score"] < self.config.min_score_filter:
                alert_logger.info(
                    f"BLOCKED_LOW_SCORE | {symbol} | score={zone_dict['trading_score']:.1f} < min={self.config.min_score_filter}"
                )
                self.stats["alerts_blocked_score"] += 1
                continue

            # Enviar alerta
            if self.config.alertsEnabled:
                # Crear un TradingZone temporal para _process_alert
                tz = TradingZone(
                    id=f"instant_{int(candle_ts)}_{direction}",
                    min_price=zone_low,
                    max_price=zone_high,
                    start_timestamp=pz.get("start_ts", 0),
                    end_timestamp=pz.get("end_ts", 0),
                    touches_support=0,
                    touches_resistance=0,
                    total_touches=0,
                    duration_hours=pz.get("duration_hours", 0),
                    avg_volume=0.0,
                    volume_score=0.0,
                    method="trading_zones",
                    score=zone_dict["trading_score"],
                    candles_in_zone=pz.get("candle_count", 0),
                    price_range_pct=0.0,
                    breakout_direction=direction,
                    breakout_price=close_price,
                    breakout_timestamp=candle_ts,
                    entry_mode=self.config.entry_mode,
                    entry_price=entry_price,
                    entry_timestamp=candle_ts,
                    sl_price=sl_price,
                    tp_price=tp_price,
                    trade_result="OPEN",
                    trading_score=zone_dict["trading_score"],
                )
                await self._process_alert(symbol, tz)

        # Remover zonas que ya rompieron de pending
        if broken:
            broken_set = set(id(pz) for pz in broken)
            self._pending_zones[symbol] = [
                pz for pz in pending if id(pz) not in broken_set
            ]
            self.stats["pending_zones_current"] = sum(
                len(v) for v in self._pending_zones.values()
            )

    def _calculate_sl_tp(self, entry_price: float, direction: str,
                         zone_high: float, zone_low: float,
                         poc_price: float) -> tuple:
        """
        Calcula SL y TP replicando la logica del zone_detector.
        Retorna (sl_price, tp_price, r_distance).
        """
        zone_height = zone_high - zone_low if zone_high and zone_low else 0
        if zone_height <= 0 or entry_price <= 0:
            return (0, 0, 0)

        tp_rr = 2.0  # Default TP = 2R

        if self.config.entry_mode == "va_breakout" and poc_price > 0:
            # SL basado en distancia Entry -> POC + buffer %
            dist_to_poc = abs(entry_price - poc_price)
            if dist_to_poc == 0:
                dist_to_poc = zone_height * 0.3
            buffer_mult = 1.0 + (self.config.sl_poc_buffer_pct / 100.0)
            r_distance = dist_to_poc * buffer_mult

            if direction == "UP":
                sl_price = entry_price - r_distance
                tp_price = entry_price + (r_distance * tp_rr)
            else:
                sl_price = entry_price + r_distance
                tp_price = entry_price - (r_distance * tp_rr)
        else:
            # SL basado en zone_height
            r_distance = zone_height
            if direction == "UP":
                sl_price = entry_price - zone_height
                tp_price = entry_price + (zone_height * tp_rr)
            else:
                sl_price = entry_price + zone_height
                tp_price = entry_price - (zone_height * tp_rr)

        # Validar coherencia
        if direction == "UP":
            if sl_price >= entry_price:
                sl_price = entry_price - zone_height
                r_distance = zone_height
                tp_price = entry_price + (zone_height * tp_rr)
        else:
            if sl_price <= entry_price:
                sl_price = entry_price + zone_height
                r_distance = zone_height
                tp_price = entry_price - (zone_height * tp_rr)

        return (round(sl_price, 2), round(tp_price, 2), round(r_distance, 2))

    # --------------------------------------------------
    # Detection logic
    # --------------------------------------------------

    async def _detect_and_alert(self, symbol: str, candles: List[Dict]):
        """
        Ejecuta deteccion de zonas con include_no_breakout=True para capturar:
        1) Zonas CON breakout real -> flujo de alerta existente
        2) Zonas SIN breakout real -> se guardan como pending zones para monitoreo vela a vela
        """
        params = self._build_detection_params()
        # Activar include_no_breakout para capturar zonas pendientes
        params.include_no_breakout = True

        # Solo usar la ventana configurada
        window = candles[-self.config.window_candles:] if len(candles) > self.config.window_candles else candles

        # Detectar usando metodo trading_zones
        zones = self.detector.detect_zones(window, method="trading_zones", params=params)

        self.stats["detections_run"] += 1
        self.stats["last_detection_zones"] = len(zones) if zones else 0

        if not zones:
            return

        # Separar zonas con breakout REAL vs breakout FAKE (pendientes)
        # El detector (_trading_zones_method) usa zone_high/zone_low para detectar breakout.
        # Cuando include_no_breakout=True, zonas SIN breakout real reciben un fake breakout
        # con breakout_price = last_candle['close'] que esta DENTRO de zone_high/zone_low.
        # Clasificacion: breakout_price fuera de zone = real, dentro de zone = fake.
        real_breakout_zones = []
        pending_candidates = []

        for zone in zones:
            if not isinstance(zone, TradingZone):
                continue

            # El detector siempre usa zone_high/zone_low como limites de breakout
            bp = zone.breakout_price
            if bp > zone.max_price or bp < zone.min_price:
                real_breakout_zones.append(zone)
            else:
                # Breakout fake -> candidata a pending zone
                pending_candidates.append(zone)

        # --- Procesar zonas pendientes ---
        self._update_pending_zones(symbol, pending_candidates, window)

        # --- Almacenar zonas para el frontend ---
        # Convertir zonas pendientes a dicts limpios (sin trade data ficticio)
        clean_pending_dicts = []
        for pz in pending_candidates:
            d = pz.to_dict()
            # Limpiar datos ficticios del simulador
            d["breakout_direction"] = ""
            d["breakout_price"] = 0.0
            d["breakout_timestamp"] = 0
            d["entry_price"] = 0.0
            d["entry_timestamp"] = 0
            d["sl_price"] = 0.0
            d["tp_price"] = 0.0
            d["trade_result"] = "PENDING"
            d["trade_pnl_r"] = 0.0
            d["bars_to_close"] = 0
            d["trade_close_timestamp"] = 0
            clean_pending_dicts.append(d)

        # Combinar: reales intactas + pendientes limpias
        all_zones = list(real_breakout_zones) + clean_pending_dicts
        self._store_zones(symbol, all_zones, real_breakout_zones=real_breakout_zones)

        # Timestamp de la ultima vela cerrada
        last_candle_ts = candles[-1]["timestamp"]
        # Ventana de "recencia": solo alertar breakouts recientes
        recency_window = max(self.config.breakout_search_bars, 20) + 10
        if len(candles) >= recency_window:
            recency_ts = candles[-recency_window]["timestamp"]
        else:
            recency_ts = candles[0]["timestamp"]

        # Filtrar solo breakouts recientes y nuevos
        known = self._known_zones.get(symbol, {})

        new_zones = []
        skipped_no_trade = 0
        skipped_no_entry = 0
        skipped_old = 0
        skipped_known = 0

        for zone in real_breakout_zones:
            # Solo zonas con resultado de trade valido
            if zone.trade_result in ("SKIPPED", "NO_ENTRY", ""):
                skipped_no_trade += 1
                continue
            if not zone.entry_price or not zone.sl_price or not zone.tp_price:
                skipped_no_entry += 1
                continue

            # Solo breakouts recientes
            if zone.breakout_timestamp < recency_ts:
                skipped_old += 1
                continue

            # No re-alertar zonas ya conocidas
            zone_key = f"{zone.start_timestamp}_{zone.end_timestamp}_{zone.breakout_direction}"
            if zone_key in known:
                skipped_known += 1
                continue

            # Marcar como conocida
            known[zone_key] = zone
            self._known_zones[symbol] = known

            self.stats["zones_detected"] += 1

            # Aplicar filtro de score
            if self.config.min_score_filter > 0 and zone.trading_score < self.config.min_score_filter:
                alert_logger.info(
                    f"BLOCKED_LOW_SCORE | {symbol} | score={zone.trading_score:.1f} < min={self.config.min_score_filter}"
                )
                self.stats["alerts_blocked_score"] += 1
                continue

            new_zones.append(zone)

        # Log detallado de filtrado
        total_real = len(real_breakout_zones)
        total_pending = len(pending_candidates)
        if total_real > 0 and not new_zones:
            logger.debug(
                f"[ZONE_SERVICE] {symbol}: {total_real} breakouts reales + {total_pending} pendientes, "
                f"0 nuevas para alertar (no_trade={skipped_no_trade}, no_entry={skipped_no_entry}, "
                f"old={skipped_old}, known={skipped_known})"
            )

        if not new_zones:
            return

        # Only alert the BEST zone per direction
        best_by_direction = {}
        for zone in new_zones:
            direction = zone.breakout_direction
            if direction not in best_by_direction or zone.trading_score > best_by_direction[direction].trading_score:
                best_by_direction[direction] = zone

        for direction, zone in best_by_direction.items():
            alert_logger.info(
                f"BREAKOUT_DETECTED | {symbol} | {zone.breakout_direction} | "
                f"entry={zone.entry_price:.2f} | sl={zone.sl_price:.2f} | tp={zone.tp_price:.2f} | "
                f"score={zone.trading_score:.1f} | mode={zone.entry_mode}"
            )
            if len(new_zones) > 1:
                alert_logger.info(
                    f"BEST_OF_{len(new_zones)} | {symbol} | {direction} | "
                    f"score={zone.trading_score:.1f} (filtered {len(new_zones) - len(best_by_direction)} lower-score zones)"
                )

            # Enviar alerta si habilitado
            if self.config.alertsEnabled:
                await self._process_alert(symbol, zone)

    def _update_pending_zones(self, symbol: str, candidates: List[TradingZone], candles: List[Dict]):
        """
        Actualiza las zonas pendientes de breakout para un simbolo.
        Reemplaza la lista completa en cada ciclo de deteccion porque las zonas
        se re-detectan con cada nueva vela (el buffer deslizante las mantiene).
        """
        # Construir mapa de pending zones existentes para preservar metadata
        existing_keys = {}
        for pz in self._pending_zones.get(symbol, []):
            key = f"{pz.get('start_ts', 0)}_{pz.get('end_ts', 0)}"
            existing_keys[key] = pz

        new_pending = []
        for zone in candidates:
            # Determinar limites de breakout segun entry_mode
            if self.config.entry_mode == "va_breakout":
                breakout_upper = zone.vp_vah_price if zone.vp_vah_price > 0 else zone.max_price
                breakout_lower = zone.vp_val_price if zone.vp_val_price > 0 else zone.min_price
            else:
                breakout_upper = zone.max_price
                breakout_lower = zone.min_price

            # Clave para dedup y tracking
            zone_key = f"{zone.start_timestamp}_{zone.end_timestamp}"

            # Verificar que no sea una zona ya conocida con breakout real
            # (puede pasar si la misma zona aparecio antes con breakout y ahora sin)
            for direction in ("UP", "DOWN"):
                full_key = f"{zone.start_timestamp}_{zone.end_timestamp}_{direction}"
                if full_key in self._known_zones.get(symbol, {}):
                    break
            else:
                # No hay breakout conocido para esta zona -> es genuinamente pendiente
                pz_dict = {
                    "start_ts": zone.start_timestamp,
                    "end_ts": zone.end_timestamp,
                    "zone_high": zone.max_price,
                    "zone_low": zone.min_price,
                    "breakout_upper": breakout_upper,
                    "breakout_lower": breakout_lower,
                    "poc_price": zone.vp_poc_price,
                    "vah_price": zone.vp_vah_price,
                    "val_price": zone.vp_val_price,
                    "trading_score": zone.trading_score,
                    "candle_count": zone.candles_in_zone,
                    "duration_hours": zone.duration_hours,
                    "first_seen": existing_keys.get(zone_key, {}).get("first_seen", time.time()),
                }
                new_pending.append(pz_dict)

        # Limitar cantidad de pending zones
        max_pending = 20
        if len(new_pending) > max_pending:
            # Mantener las mas recientes (por end_ts)
            new_pending.sort(key=lambda z: z["end_ts"], reverse=True)
            new_pending = new_pending[:max_pending]

        old_count = len(self._pending_zones.get(symbol, []))
        self._pending_zones[symbol] = new_pending
        new_count = len(new_pending)

        # Actualizar stat global
        self.stats["pending_zones_current"] = sum(
            len(v) for v in self._pending_zones.values()
        )

        # Loguear cambios significativos
        if new_count != old_count:
            logger.info(f"[ZONE_SERVICE] {symbol}: Pending zones: {old_count} -> {new_count}")

    def _build_detection_params(self) -> ZoneDetectionParams:
        """Construye ZoneDetectionParams desde la config del servicio."""
        return ZoneDetectionParams(
            consol_min_bars=self.config.consol_min_bars,
            consol_max_bars=self.config.consol_max_bars,
            consol_max_range_pct=self.config.consol_max_range_pct,
            consol_atr_ratio=self.config.consol_atr_ratio,
            consol_body_ratio=self.config.consol_body_ratio,
            consol_max_outside_bars=self.config.consol_max_outside_bars,
            breakout_search_bars=self.config.breakout_search_bars,
            entry_mode=self.config.entry_mode,
            sl_mode=self.config.sl_mode,
            sl_poc_buffer_pct=self.config.sl_poc_buffer_pct,
            swing_bars=self.config.swing_bars,
            min_score_filter=0,  # Filtramos despues para poder loguear
            max_price_range_pct=self.config.max_price_range_pct,
            vp_bins_per_zone=self.config.vp_bins_per_zone,
            lookforward_bars=50,  # En realtime no necesitamos mucho forward
            include_no_breakout=False,  # Solo zonas con breakout real
            position_mode="concurrent",  # En realtime cada zona se evalua independiente
            # Capas v3.0
            use_atr_band=self.config.use_atr_band,
            atr_band_period=self.config.atr_band_period,
            atr_band_multiplier=self.config.atr_band_multiplier,
            atr_band_ma_period=self.config.atr_band_ma_period,
            use_reentry=self.config.use_reentry,
            max_reentry_bars=self.config.max_reentry_bars,
            use_ttm_prefilter=self.config.use_ttm_prefilter,
            use_bbwp_scoring=self.config.use_bbwp_scoring,
            use_inside_pct_filter=self.config.use_inside_pct_filter,
        )

    # --------------------------------------------------
    # Alert processing
    # --------------------------------------------------

    async def _process_alert(self, symbol: str, zone: TradingZone):
        """Verifica cooldown y envia alerta."""
        direction = "LONG" if zone.breakout_direction == "UP" else "SHORT"
        cooldown_key = f"{symbol}_{direction}"

        # Verificar cooldown
        last_alert = self._cooldowns.get(cooldown_key, 0)
        cooldown_seconds = self.config.cooldownMinutes * 60
        now = time.time()

        if now - last_alert < cooldown_seconds:
            remaining = cooldown_seconds - (now - last_alert)
            alert_logger.info(f"BLOCKED_COOLDOWN | {symbol} | {direction} | remaining={remaining:.0f}s")
            self.stats["alerts_blocked_cooldown"] += 1
            return

        # Enviar alerta
        success = await self._send_alert(symbol, zone)

        if success:
            self._cooldowns[cooldown_key] = now
            self.stats["alerts_sent"] += 1
            alert_logger.info(
                f"ALERT_SENT | {symbol} | {direction} | "
                f"entry={zone.entry_price:.2f} | sl={zone.sl_price:.2f} | tp={zone.tp_price:.2f}"
            )

            # Registrar en pattern_state_manager para que aparezca en el historial de alertas
            try:
                state_manager = get_pattern_state_manager()
                alert_record = AlertRecord(
                    id=f"zone_{symbol}_{int(time.time()*1000)}_{uuid.uuid4().hex[:6]}",
                    timestamp=int(time.time() * 1000),
                    symbol=symbol,
                    interval=self.config.interval,
                    indicator="ZONE_DETECTOR",
                    pattern_type=f"ZONE_BREAKOUT_{zone.entry_mode.upper()}",
                    direction=direction,
                    price=float(zone.entry_price),
                    confidence=float(zone.trading_score),
                    status="sent",
                    entry=float(zone.entry_price),
                    stop_loss=float(zone.sl_price),
                    take_profit=float(zone.tp_price),
                    outcome="PENDING",
                )
                state_manager.add_alert_record(alert_record)
                logger.info(f"[ZONE_SERVICE] Alerta registrada en historial: {alert_record.id}")
            except Exception as e:
                logger.error(f"[ZONE_SERVICE] Error registrando alerta en historial: {e}")
        else:
            alert_logger.error(f"ALERT_FAILED | {symbol} | {direction} | entry={zone.entry_price:.2f} | (ver lineas anteriores para detalle)")

    async def _send_alert(self, symbol: str, zone: TradingZone) -> bool:
        """Envia HTTP POST al TradingBot."""
        if not self._http_client:
            logger.error("[ZONE_SERVICE] HTTP client no inicializado")
            return False

        direction = "LONG" if zone.breakout_direction == "UP" else "SHORT"

        payload = {
            "source": "ZONE_DETECTOR",
            "symbol": symbol,
            "interval": self.config.interval,
            "pattern": {
                "patternType": f"ZONE_BREAKOUT_{zone.entry_mode.upper()}",
                "price": float(zone.entry_price),
                "confidence": float(zone.trading_score),
                "direction": direction,
            },
            "custom_stop_loss": float(zone.sl_price),
            "custom_take_profit": float(zone.tp_price),
        }

        try:
            logger.info(f"[ZONE_SERVICE] Enviando alerta: {symbol} {direction} -> {self.config.alertTargetUrl}")
            response = await self._http_client.post(
                self.config.alertTargetUrl,
                json=payload,
            )
            if response.status_code == 200:
                result = response.json()
                success = result.get("success", False)
                if not success:
                    reason = result.get("message", result.get("detail", "unknown"))
                    alert_logger.info(f"ALERT_REJECTED | {symbol} | {direction} | reason={reason}")
                    logger.warning(f"[ZONE_SERVICE] TradingBot rechazo alerta: {reason}")
                return success
            else:
                body_text = response.text[:200] if response.text else "empty"
                alert_logger.error(f"ALERT_HTTP_ERROR | {symbol} | {direction} | status={response.status_code} | body={body_text}")
                logger.warning(f"[ZONE_SERVICE] Alerta rechazada: HTTP {response.status_code} - {body_text}")
                return False
        except httpx.ConnectError:
            alert_logger.error(f"ALERT_CONNECT_ERROR | {symbol} | {direction} | TradingBot no disponible en {self.config.alertTargetUrl}")
            logger.error("[ZONE_SERVICE] TradingBot no disponible (ConnectError)")
            return False
        except httpx.TimeoutException:
            alert_logger.error(f"ALERT_TIMEOUT | {symbol} | {direction}")
            logger.error("[ZONE_SERVICE] Timeout enviando alerta")
            return False
        except Exception as e:
            alert_logger.error(f"ALERT_EXCEPTION | {symbol} | {direction} | error={str(e)}")
            logger.error(f"[ZONE_SERVICE] Error enviando alerta: {e}")
            return False

    # --------------------------------------------------
    # Historical data loading
    # --------------------------------------------------

    async def _load_initial_data(self):
        """Carga datos historicos iniciales para cada simbolo."""
        await asyncio.sleep(1.0)  # Esperar que WebSocket se estabilice

        logger.info(f"[ZONE_SERVICE] Cargando historico para {len(self.config.symbols)} simbolos...")

        for symbol in self.config.symbols:
            try:
                await self._load_symbol_history(symbol)
            except Exception as e:
                logger.error(f"[ZONE_SERVICE] Error cargando historico de {symbol}: {e}")

        logger.info("[ZONE_SERVICE] Historico cargado para todos los simbolos")

    async def _load_symbol_history(self, symbol: str):
        """Carga historico de un simbolo desde el buffer de WebSocket o la API."""
        desired = self.config.window_candles

        # Intentar obtener del buffer de WebSocket primero
        candles = []
        if self.ws_manager:
            ws_candles = self.ws_manager.get_candles(symbol, self.config.interval)
            if ws_candles:
                # Convertir a dicts si son objetos
                for c in ws_candles:
                    if hasattr(c, "timestamp"):
                        candles.append({
                            "timestamp": c.timestamp,
                            "open": c.open,
                            "high": c.high,
                            "low": c.low,
                            "close": c.close,
                            "volume": c.volume,
                        })
                    elif isinstance(c, dict):
                        candles.append(c)

        # Si no hay suficientes, cargar de la API
        if len(candles) < desired:
            logger.info(f"[ZONE_SERVICE] {symbol}: Buffer WS tiene {len(candles)} velas, necesita {desired}. Cargando de API...")
            api_candles = await self._fetch_from_api(symbol, desired)
            if api_candles:
                # Merge: api_candles (mas antiguas) + ws candles (mas recientes)
                candle_map = {}
                for c in api_candles:
                    candle_map[c["timestamp"]] = c
                for c in candles:
                    candle_map[c["timestamp"]] = c  # WS sobrescribe si hay duplicado
                candles = sorted(candle_map.values(), key=lambda x: x["timestamp"])

        # Guardar en buffer
        self._candle_buffers[symbol] = candles[-desired:]

        # Precargar al buffer del WebSocket si es posible
        if self.ws_manager and candles:
            try:
                self.ws_manager.preload_historical(symbol, self.config.interval, candles[-desired:])
            except Exception:
                pass  # No critico

        logger.info(f"[ZONE_SERVICE] {symbol}: {len(self._candle_buffers.get(symbol, []))} velas cargadas")

        # Ejecutar deteccion inicial (sin alertas, solo para llenar zonas conocidas)
        buffer = self._candle_buffers.get(symbol, [])
        if len(buffer) >= 50:
            await self._initial_detection(symbol, buffer)

    async def _fetch_from_api(self, symbol: str, desired_candles: int) -> List[Dict]:
        """Fetch velas historicas desde Bybit API."""
        if not self._http_client:
            return []

        all_candles = []
        limit = 1000
        end_time = int(time.time() * 1000)

        requests_made = 0
        max_requests = 10  # Maximo 10 requests (10k velas)

        while len(all_candles) < desired_candles and requests_made < max_requests:
            try:
                url = (
                    f"{BYBIT_API_URL}?category=linear&symbol={symbol}"
                    f"&interval={self.config.interval}&limit={limit}&end={end_time}"
                )
                response = await self._http_client.get(url)
                if response.status_code != 200:
                    break

                data = response.json()
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

                # Bybit retorna en orden descendente
                batch.sort(key=lambda x: x["timestamp"])
                all_candles = batch + all_candles

                # Siguiente pagina: antes de la vela mas antigua
                end_time = batch[0]["timestamp"] - 1
                requests_made += 1

                if len(result_list) < limit:
                    break  # No hay mas datos

                await asyncio.sleep(0.1)  # Rate limit

            except Exception as e:
                logger.error(f"[ZONE_SERVICE] Error API fetch {symbol}: {e}")
                break

        # Deduplicar por timestamp
        seen = set()
        unique = []
        for c in all_candles:
            if c["timestamp"] not in seen:
                seen.add(c["timestamp"])
                unique.append(c)

        unique.sort(key=lambda x: x["timestamp"])
        return unique[-desired_candles:]

    async def _initial_detection(self, symbol: str, candles: List[Dict]):
        """Deteccion inicial para llenar zonas conocidas y pending zones (sin enviar alertas)."""
        params = self._build_detection_params()
        params.include_no_breakout = True  # Incluir zonas pendientes tambien

        zones = self.detector.detect_zones(candles, method="trading_zones", params=params)

        # Separar breakouts reales vs fake (pendientes)
        # Misma logica que _detect_and_alert: breakout_price fuera de zone = real
        known = {}
        pending_candidates = []

        for zone in zones:
            if not isinstance(zone, TradingZone):
                continue
            if not zone.breakout_direction:
                continue

            bp = zone.breakout_price
            if bp > zone.max_price or bp < zone.min_price:
                # Breakout real -> registrar como conocida
                zone_key = f"{zone.start_timestamp}_{zone.end_timestamp}_{zone.breakout_direction}"
                known[zone_key] = zone
            else:
                # Breakout fake -> candidata a pending
                pending_candidates.append(zone)

        self._known_zones[symbol] = known

        # Limpiar zonas pendientes para que no muestren trade data ficticio
        clean_pending_dicts = []
        for pz in pending_candidates:
            d = pz.to_dict()
            d["breakout_direction"] = ""
            d["breakout_price"] = 0.0
            d["breakout_timestamp"] = 0
            d["entry_price"] = 0.0
            d["entry_timestamp"] = 0
            d["sl_price"] = 0.0
            d["tp_price"] = 0.0
            d["trade_result"] = "PENDING"
            d["trade_pnl_r"] = 0.0
            d["bars_to_close"] = 0
            d["trade_close_timestamp"] = 0
            clean_pending_dicts.append(d)

        # Almacenar: reales con trade data + pendientes sin trade data
        all_zones_for_frontend = list(known.values()) + clean_pending_dicts
        # En initial_detection no registramos open trades (trades historicos ya tienen resultado)
        self._store_zones(symbol, all_zones_for_frontend, real_breakout_zones=None)

        # Llenar pending zones al inicio
        if pending_candidates:
            self._update_pending_zones(symbol, pending_candidates, candles)

        pending_count = len(self._pending_zones.get(symbol, []))
        logger.info(
            f"[ZONE_SERVICE] {symbol}: Deteccion inicial -> {len(zones)} zonas, "
            f"{len(known)} con breakout real, {pending_count} pendientes"
        )

    # --------------------------------------------------
    # Zone storage (for frontend queries)
    # --------------------------------------------------

    def _store_zones(self, symbol: str, zones, real_breakout_zones: list = None):
        """
        Almacena zonas para consulta del frontend.
        Solo registra trades OPEN de zonas con breakout REAL (no fake/pending).
        """
        zone_dicts = []
        for z in zones:
            if isinstance(z, TradingZone):
                zone_dicts.append(z.to_dict())
            elif isinstance(z, dict):
                zone_dicts.append(z)

        # Limitar cantidad
        if len(zone_dicts) > self._max_zones_per_symbol:
            zone_dicts = zone_dicts[:self._max_zones_per_symbol]

        self._recent_zones[symbol] = zone_dicts

        # Solo registrar trades OPEN de breakouts reales (no de fake breakouts)
        # Las zonas con fake breakout tienen trade_result=OPEN del simulador
        # pero el trade no es real -> no debemos rastrearlo
        if real_breakout_zones:
            real_dicts = []
            for z in real_breakout_zones:
                if isinstance(z, TradingZone):
                    real_dicts.append(z.to_dict())
                elif isinstance(z, dict):
                    real_dicts.append(z)
            self._register_open_trades(symbol, real_dicts)

        # Merge open trades para que el frontend vea trades que salieron de ventana
        open_trades = self._open_trades.get(symbol, [])
        if open_trades:
            self._merge_tracked_trades_to_recent(symbol, open_trades)

        # Re-numerar timeline_index para evitar duplicados despues del merge
        self._renumber_zones(symbol)

    def _register_open_trades(self, symbol: str, zone_dicts: List[Dict]):
        """
        Registra zonas con trade_result=OPEN en _open_trades para tracking vela a vela.
        Solo registra trades que no esten ya rastreados.
        """
        open_zones = [
            z for z in zone_dicts
            if z.get("trade_result") == "OPEN"
            and z.get("entry_price")
            and z.get("sl_price")
            and z.get("tp_price")
        ]

        if not open_zones:
            return

        existing = self._open_trades.get(symbol, [])
        existing_keys = {
            f"{t.get('start_timestamp', 0)}_{t.get('end_timestamp', 0)}_{t.get('breakout_direction', '')}"
            for t in existing
        }

        new_count = 0
        for trade in open_zones:
            key = f"{trade.get('start_timestamp', 0)}_{trade.get('end_timestamp', 0)}_{trade.get('breakout_direction', '')}"
            if key not in existing_keys:
                self._open_trades.setdefault(symbol, []).append(dict(trade))  # Copia independiente
                existing_keys.add(key)
                new_count += 1

        if new_count > 0:
            total = len(self._open_trades.get(symbol, []))
            logger.info(f"[ZONE_SERVICE] {symbol}: {new_count} nuevos trades OPEN registrados (total tracking: {total})")
            alert_logger.info(
                f"OPEN_TRADE_REGISTERED | {symbol} | +{new_count} trades | "
                f"total_tracking={total}"
            )

    def _renumber_zones(self, symbol: str):
        """
        Re-numera timeline_index de todas las zonas en _recent_zones
        para garantizar numeros unicos y cronologicos.
        """
        recent = self._recent_zones.get(symbol, [])
        if not recent:
            return

        # Ordenar por entry_timestamp (o start_timestamp si no tiene entry)
        recent.sort(key=lambda z: z.get("entry_timestamp", 0) or z.get("start_timestamp", 0))

        for i, zone in enumerate(recent):
            zone["timeline_index"] = i + 1  # 1-based

    def get_zones(self, symbol: str) -> List[Dict]:
        """Retorna zonas detectadas para un simbolo."""
        return self._recent_zones.get(symbol, [])

    def compute_per_candle_metrics(self, symbol: str, candles: List[Dict] = None,
                                    context_candles: List[Dict] = None,
                                    params: Dict = None) -> Dict:
        """
        Calcula metricas por candle para las barras de estado del frontend.
        Se adapta al metodo de deteccion seleccionado.

        Args:
          candles: Velas visibles (se calculan metricas para estas)
          context_candles: Velas de contexto mas amplio para calcular global_atr.
          params: Parametros del frontend (detection_method, consol_*, atr_dyn_*, etc.)
        """
        if candles is None:
            candles = self._candle_buffers.get(symbol, [])
        if len(candles) < 20:
            return {"timestamps": [], "primary": [],
                    "ttm_squeeze": [], "bbwp": [], "active_layers": {}}

        p = params or {}
        detection_method = p.get("detection_method", "trading_zones")

        n = len(candles)
        timestamps = [c["timestamp"] for c in candles]

        # --- Banda PRINCIPAL: depende del metodo de deteccion ---
        # Una sola banda que indica "aqui se cumplen las condiciones de zona"
        primary = [False] * n

        if detection_method == "atr_dynamic":
            # ATR Dynamic: replica exacta de _atr_dynamic_method
            # count_outside == 0 en ventana rolling de ma_period velas
            atr_period = int(p.get("atr_dyn_period", 200))
            ma_period = int(p.get("atr_dyn_ma_period", 20))
            mult = float(p.get("atr_dyn_multiplier", 1.0))

            sma_vals = self.detector._calculate_sma(candles, ma_period)
            atr_vals = self.detector._calculate_rolling_atr_for_trading(candles, atr_period)

            start_index = max(atr_period, ma_period)
            for i in range(start_index, n):
                if i >= len(atr_vals) or i >= len(sma_vals):
                    continue
                atr_val = atr_vals[i] * mult
                ma_val = sma_vals[i]
                if atr_val <= 0 or ma_val <= 0:
                    continue
                # Contar velas fuera en las ultimas ma_period velas
                count_outside = 0
                for j in range(max(0, i - ma_period + 1), i + 1):
                    deviation = abs(candles[j]['close'] - ma_val)
                    if deviation > atr_val:
                        count_outside += 1
                primary[i] = (count_outside == 0)

        else:
            # trading_zones: las 3 condiciones se cumplen simultaneamente
            ctx = context_candles if context_candles and len(context_candles) > len(candles) else candles
            ctx_n = len(ctx)
            global_atr = self.detector._calculate_atr(ctx, min(14, ctx_n // 4))

            win = int(p.get("consol_min_bars", self.config.consol_min_bars))
            atr_ratio_thresh = float(p.get("consol_atr_ratio", self.config.consol_atr_ratio))
            range_pct_thresh = float(p.get("consol_max_range_pct", self.config.consol_max_range_pct))
            body_ratio_thresh = float(p.get("consol_body_ratio", self.config.consol_body_ratio))

            for i in range(win, n + 1):
                window = candles[i - win:i]
                # Condicion 1: ATR ratio
                local_atr = self.detector._calculate_atr(window, min(5, len(window) // 2))
                ratio = local_atr / global_atr if global_atr > 0 else 1.0
                pass_atr = ratio <= atr_ratio_thresh
                # Condicion 2: Range %
                range_high = max(c['high'] for c in window)
                range_low = min(c['low'] for c in window)
                range_mid = (range_high + range_low) / 2
                range_pct = ((range_high - range_low) / range_mid) * 100 if range_mid > 0 else 100
                pass_range = range_pct <= range_pct_thresh
                # Condicion 3: Body ratio
                avg_body = self.detector._calculate_avg_body_ratio(window)
                pass_body = avg_body <= body_ratio_thresh
                # Las 3 deben cumplirse
                primary[i - 1] = pass_atr and pass_range and pass_body
            # Rellenar primeras velas
            if win < n:
                for i in range(win):
                    primary[i] = primary[win]

        # --- Capas opcionales ---
        use_ttm = bool(p.get("use_ttm_prefilter", self.config.use_ttm_prefilter))
        use_bbwp = bool(p.get("use_bbwp_scoring", self.config.use_bbwp_scoring))

        ttm_squeeze = [False] * n
        if use_ttm:
            bb_period = int(p.get("atr_band_ma_period", getattr(self.config, 'atr_band_ma_period', 20)))
            bb_sma = self.detector._calculate_sma(candles, bb_period)
            bb_std = self.detector._calculate_std_dev(candles, bb_period)
            kc_atr_length = int(p.get("ttm_atr_length", getattr(self.config, 'ttm_atr_length', 20)))
            kc_multiplier = float(p.get("ttm_kc_multiplier", getattr(self.config, 'ttm_kc_multiplier', 1.5)))
            ttm_squeeze = self.detector._calculate_ttm_squeeze_values(
                candles, bb_sma, bb_std, kc_atr_length, kc_multiplier
            )

        bbwp_pass = [False] * n
        if use_bbwp:
            bb_period = int(p.get("atr_band_ma_period", getattr(self.config, 'atr_band_ma_period', 20)))
            bb_sma = self.detector._calculate_sma(candles, bb_period)
            bb_std = self.detector._calculate_std_dev(candles, bb_period)
            lookback = int(p.get("bbwp_lookback", getattr(self.config, 'bbwp_lookback', 252)))
            threshold = float(p.get("bbwp_squeeze_threshold", getattr(self.config, 'bbwp_squeeze_threshold', 20)))
            bbwp_vals = self.detector._calculate_bbwp_values(
                candles, bb_sma, bb_std, lookback
            )
            bbwp_pass = [v <= threshold for v in bbwp_vals]

        method_label = "IN RANGE" if detection_method == "atr_dynamic" else "CONSOL"
        active_layers = {
            "primary": True,
            "ttm_squeeze": use_ttm,
            "bbwp": use_bbwp,
        }

        return {
            "timestamps": [int(t) for t in timestamps],
            "primary": [bool(v) for v in primary],
            "ttm_squeeze": [bool(v) for v in ttm_squeeze],
            "bbwp": [bool(v) for v in bbwp_pass],
            "active_layers": active_layers,
            "method_label": method_label,
        }

    # --------------------------------------------------
    # Config update
    # --------------------------------------------------

    def update_config(self, new_config: Dict) -> Dict:
        """Actualiza configuracion y persiste."""
        changed_keys = []
        for key, val in new_config.items():
            if hasattr(self.config, key):
                old_val = getattr(self.config, key)
                if old_val != val:
                    setattr(self.config, key, val)
                    changed_keys.append(key)

        if changed_keys:
            self._save_config()
            logger.info(f"[ZONE_SERVICE] Config actualizada: {changed_keys}")

        return {"updated": changed_keys}

    def get_status(self) -> Dict:
        """Retorna estado completo del servicio."""
        uptime = time.time() - self.stats["start_time"] if self.stats["start_time"] > 0 else 0

        buffer_info = {}
        for symbol, buf in self._candle_buffers.items():
            buffer_info[symbol] = len(buf)

        known_info = {}
        for symbol, known in self._known_zones.items():
            known_info[symbol] = len(known)

        # Calcular tiempo desde ultima vela procesada
        last_candle_ago = 0
        if self.stats["last_candle_time"] > 0:
            last_candle_ago = round(time.time() - self.stats["last_candle_time"])

        open_trades_info = {}
        for sym, trades in self._open_trades.items():
            open_trades_info[sym] = len(trades)

        pending_zones_info = {}
        for sym, pending in self._pending_zones.items():
            pending_zones_info[sym] = {
                "count": len(pending),
                "zones": [
                    {
                        "zone_high": pz.get("zone_high", 0),
                        "zone_low": pz.get("zone_low", 0),
                        "breakout_upper": pz.get("breakout_upper", 0),
                        "breakout_lower": pz.get("breakout_lower", 0),
                        "score": pz.get("trading_score", 0),
                        "candles": pz.get("candle_count", 0),
                    }
                    for pz in pending
                ]
            }

        return {
            "enabled": self.config.enabled,
            "running": self.running,
            "uptime_seconds": round(uptime),
            "config": self.config.to_dict(),
            "stats": self.stats.copy(),
            "last_candle_ago_seconds": last_candle_ago,
            "buffers": buffer_info,
            "known_zones": known_info,
            "open_trades": open_trades_info,
            "pending_zones": pending_zones_info,
            "cooldowns": {
                k: round(self.config.cooldownMinutes * 60 - (time.time() - v))
                for k, v in self._cooldowns.items()
                if time.time() - v < self.config.cooldownMinutes * 60
            },
        }

    def clear_cooldowns(self):
        """Limpia todos los cooldowns (para testing)."""
        self._cooldowns.clear()
        logger.info("[ZONE_SERVICE] Cooldowns limpiados")

    async def reanalyze(self):
        """Re-analiza historico con config actual. Limpia zonas conocidas."""
        self._known_zones.clear()
        self._recent_zones.clear()
        self._open_trades.clear()
        self._pending_zones.clear()
        self.stats["pending_zones_current"] = 0

        for symbol in self.config.symbols:
            buffer = self._candle_buffers.get(symbol, [])
            if len(buffer) >= 50:
                await self._initial_detection(symbol, buffer)

        logger.info("[ZONE_SERVICE] Re-analisis completado")


# ============================================================
# Singleton
# ============================================================

_zone_service_instance: Optional[ZoneService] = None


def get_zone_service() -> ZoneService:
    """Obtiene o crea la instancia singleton del ZoneService."""
    global _zone_service_instance
    if _zone_service_instance is None:
        _zone_service_instance = ZoneService()
    return _zone_service_instance
