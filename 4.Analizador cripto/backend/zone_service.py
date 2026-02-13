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

    # Metodo de deteccion: "trading_zones" (consolidacion) o "atr_dynamic"
    detection_method: str = "trading_zones"

    # Parametros de ATR Dynamic method
    atr_dyn_period: int = 200
    atr_dyn_ma_period: int = 20
    atr_dyn_multiplier: float = 1.0
    atr_dyn_min_bars: int = 0
    atr_dyn_max_breakout: int = 5

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
    position_mode: str = "sequential"  # sequential o concurrent

    # Risk/Reward
    tp_rr_ratio: float = 1.0  # Take Profit = N * R (1.0 = 1:1, 2.0 = 2:1)

    # Capas opcionales v3.0
    use_atr_band: bool = False
    atr_band_period: int = 200
    atr_band_multiplier: float = 1.0
    atr_band_ma_period: int = 20
    use_reentry: bool = False
    max_reentry_bars: int = 3
    use_ttm_prefilter: bool = False
    ttm_atr_length: int = 20
    ttm_kc_multiplier: float = 1.5
    ttm_min_squeeze_bars: int = 5
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

        # Pausa de re-deteccion historica (toggle desde el UI)
        # Cuando True: NO ejecuta _detect_and_alert() en cada vela,
        # pero SI sigue actualizando open trades y chequeando pending breakouts.
        self.detection_paused = False

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

        # Baseline de zonas historicas (calculadas una vez al inicio o al cambiar parametros)
        # No se recalculan en cada vela para mantener estabilidad visual.
        self._baseline_zones: Dict[str, List[Dict]] = {}  # symbol -> list of zone dicts

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
                logger.info(f"[ZONE] Config cargada: {len(self.config.symbols)} simbolos, interval={self.config.interval}")
            except Exception as e:
                logger.error(f"[ZONE] Error cargando config: {e}")
        else:
            logger.info("[ZONE] Sin config previa, usando defaults")

    def _save_config(self):
        """Guarda configuracion a archivo JSON."""
        try:
            with open(CONFIG_FILE, "w", encoding="utf-8") as f:
                json.dump(self.config.to_dict(), f, indent=2, ensure_ascii=False)
            logger.info("[ZONE] Config guardada")
        except Exception as e:
            logger.error(f"[ZONE] Error guardando config: {e}")

    # --------------------------------------------------
    # Start / Stop
    # --------------------------------------------------

    async def start(self):
        """Inicia el servicio de deteccion en tiempo real."""
        if self.running:
            logger.info("[ZONE] Ya esta corriendo")
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
        # add_subscriptions() espera hasta 10s si WS aun no esta conectado
        await self.ws_manager.add_subscriptions(self.config.symbols, [self.config.interval])

        # Cargar historico inicial (background, no bloquea)
        asyncio.create_task(self._load_initial_data())

        logger.info(f"[ZONE] Iniciado - {len(self.config.symbols)} simbolos @ {self.config.interval}m, ventana={self.config.window_candles}")

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

        logger.info("[ZONE] Detenido")

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
                logger.error(f"[ZONE] No se pudo programar handler: {e}")

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
        high_price = candle_dict.get("high", 0)
        low_price = candle_dict.get("low", 0)
        candle_ts = candle_dict.get("timestamp", 0)
        self.stats["candles_processed"] += 1
        self.stats["last_candle_time"] = time.time()

        from datetime import datetime as _dt
        ts_str = _dt.fromtimestamp(candle_ts / 1000).strftime('%H:%M:%S') if candle_ts else '?'
        logger.info(
            f"[ZONE] === CANDLE CLOSE #{self.stats['candles_processed']} === "
            f"{symbol} @ {ts_str} | O={candle_dict.get('open',0):.2f} H={high_price:.2f} "
            f"L={low_price:.2f} C={close_price:.2f} V={candle_dict.get('volume',0):.0f}"
        )

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
            logger.info(f"[ZONE] {symbol}: Buffer insuficiente ({len(buffer)} velas, min={max(50, self.config.consol_min_bars + 30)})")
            return

        open_count = len(self._open_trades.get(symbol, []))
        pending_count = len(self._pending_zones.get(symbol, []))
        baseline_count = len(self._baseline_zones.get(symbol, []))
        logger.info(
            f"[ZONE] {symbol}: Estado pre-proceso: buffer={len(buffer)} velas | "
            f"baseline={baseline_count} | pending={pending_count} | open_trades={open_count}"
        )

        # Actualizar trades abiertos con la nueva vela
        self._update_open_trades(symbol, candle_dict)

        # Chequear breakouts instantaneos en pending zones
        try:
            await self._check_pending_breakouts(symbol, candle_dict)
        except Exception as e:
            logger.error(f"[ZONE] Error chequeando pending breakouts para {symbol}: {e}")

        # Detectar zonas en el buffer (actualiza pending zones + zonas con breakout)
        # Si detection_paused: solo sigue tracking trades y pending, NO re-detecta
        if self.detection_paused:
            logger.info(f"[ZONE] {symbol}: DETECCION PAUSADA - saltando _detect_and_alert()")
            # Reconstruir _recent_zones para que el frontend vea cambios de
            # _update_open_trades y _check_pending_breakouts (breakouts resueltos,
            # trades WIN/LOSS, PnL parcial) aunque no corra _detect_and_alert()
            self._rebuild_recent_zones(symbol)
        else:
            try:
                await self._detect_and_alert(symbol, buffer)
            except Exception as e:
                logger.error(f"[ZONE] Error detectando zonas para {symbol}: {e}")

        # Resumen post-proceso
        post_pending = len(self._pending_zones.get(symbol, []))
        post_baseline = len(self._baseline_zones.get(symbol, []))
        post_open = len(self._open_trades.get(symbol, []))
        recent_count = len(self._recent_zones.get(symbol, []))
        logger.info(
            f"[ZONE] {symbol}: Resultado: frontend_zones={recent_count} "
            f"(baseline={post_baseline} + pending={post_pending}) | open_trades={post_open}"
        )

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

        logger.info(f"[ZONE] {symbol}: Chequeando {len(open_trades)} trades abiertos vs candle H={candle.get('high',0):.2f} L={candle.get('low',0):.2f}")

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

        # Sincronizar cambios de trade result/PnL al baseline (para que persista)
        # Incluye trades resueltos (WIN/LOSS) y abiertos (PnL parcial)
        if open_trades:
            self._sync_trades_to_baseline(symbol, open_trades)

        # Remover trades resueltos de la lista de abiertos
        if resolved:
            self._open_trades[symbol] = [t for t in open_trades if t not in resolved]

    def _merge_tracked_trades_to_recent(self, symbol: str, tracked_trades: List[Dict]):
        """
        Sincroniza trades rastreados (abiertos y recien resueltos) con _recent_zones
        para que el frontend vea los cambios de trade_result en tiempo real.
        Usa matching con tolerancia temporal + solapamiento de precio.
        """
        if not tracked_trades:
            return

        recent = self._recent_zones.get(symbol, [])
        interval_ms = self._get_interval_ms()
        tolerance_ms = interval_ms * 5

        # Para cada trade rastreado, buscar match en recent (con tolerancia)
        matched_trade_indices = set()  # indices de trades ya matcheados
        for t_idx, trade in enumerate(tracked_trades):
            t_start = trade.get('start_timestamp', 0)
            t_dir = trade.get('breakout_direction', '')
            t_high = trade.get('max_price', 0)
            t_low = trade.get('min_price', 0)

            best_match_idx = -1
            best_overlap = 0.0
            for r_idx, zone in enumerate(recent):
                z_dir = zone.get('breakout_direction', '')
                # Direccion debe coincidir (o zona sin direccion = PENDING)
                if z_dir and z_dir != t_dir:
                    continue
                z_start = zone.get('start_timestamp', 0)
                if abs(t_start - z_start) > tolerance_ms:
                    continue
                z_high = zone.get('max_price', 0)
                z_low = zone.get('min_price', 0)
                ov = max(0, min(t_high, z_high) - max(t_low, z_low))
                mh = min(t_high - t_low, z_high - z_low) if t_high > t_low and z_high > z_low else 1
                ratio = ov / mh if mh > 0 else 0
                if ratio >= 0.6 and ratio > best_overlap:
                    best_match_idx = r_idx
                    best_overlap = ratio

            if best_match_idx >= 0:
                # Actualizar zona existente con datos del trade
                recent[best_match_idx]["trade_result"] = trade["trade_result"]
                recent[best_match_idx]["trade_pnl_r"] = trade.get("trade_pnl_r", 0)
                if "trade_close_timestamp" in trade:
                    recent[best_match_idx]["trade_close_timestamp"] = trade["trade_close_timestamp"]
                if trade.get("breakout_direction"):
                    recent[best_match_idx]["breakout_direction"] = trade["breakout_direction"]
                if trade.get("entry_price"):
                    recent[best_match_idx]["entry_price"] = trade["entry_price"]
                if trade.get("sl_price"):
                    recent[best_match_idx]["sl_price"] = trade["sl_price"]
                if trade.get("tp_price"):
                    recent[best_match_idx]["tp_price"] = trade["tp_price"]
                if trade.get("breakout_timestamp"):
                    recent[best_match_idx]["breakout_timestamp"] = trade["breakout_timestamp"]
                if trade.get("entry_timestamp"):
                    recent[best_match_idx]["entry_timestamp"] = trade["entry_timestamp"]
                matched_trade_indices.add(t_idx)
            else:
                # Trade no encontrado en recent -> agregar
                recent.append(trade)
                matched_trade_indices.add(t_idx)

        self._recent_zones[symbol] = recent

    def _sync_trades_to_baseline(self, symbol: str, resolved_trades: List[Dict]):
        """
        Sincroniza trades resueltos (WIN/LOSS) al baseline estable
        para que los datos persistan cuando _detect_and_alert() reescribe _recent_zones.
        Usa matching con tolerancia temporal + solapamiento de precio.
        """
        baseline = self._baseline_zones.get(symbol, [])
        if not baseline or not resolved_trades:
            return

        interval_ms = self._get_interval_ms()
        tolerance_ms = interval_ms * 5

        for trade in resolved_trades:
            t_start = trade.get('start_timestamp', 0)
            t_dir = trade.get('breakout_direction', '')
            t_high = trade.get('max_price', 0)
            t_low = trade.get('min_price', 0)

            for i, bz in enumerate(baseline):
                if bz.get('breakout_direction', '') != t_dir:
                    continue
                bz_start = bz.get('start_timestamp', 0)
                if abs(t_start - bz_start) > tolerance_ms:
                    continue
                bz_high = bz.get('max_price', 0)
                bz_low = bz.get('min_price', 0)
                ov = max(0, min(t_high, bz_high) - max(t_low, bz_low))
                mh = min(t_high - t_low, bz_high - bz_low) if t_high > t_low and bz_high > bz_low else 1
                if mh > 0 and ov / mh >= 0.6:
                    baseline[i]["trade_result"] = trade.get("trade_result", baseline[i].get("trade_result", ""))
                    baseline[i]["trade_pnl_r"] = trade.get("trade_pnl_r", baseline[i].get("trade_pnl_r", 0))
                    if "trade_close_timestamp" in trade:
                        baseline[i]["trade_close_timestamp"] = trade["trade_close_timestamp"]
                    break

    # --------------------------------------------------
    # Pending zone breakout monitoring
    # --------------------------------------------------

    async def _check_pending_breakouts(self, symbol: str, candle: Dict):
        """
        Verifica si la vela actual rompe alguna zona pendiente de breakout.
        Si rompe -> calcula entry/SL/TP inmediatamente y envia alerta.
        Esto da respuesta INSTANTANEA al breakout, sin esperar re-deteccion.

        MEJORA: Solo toma la MEJOR zona por direccion y elimina todas las
        pending zones con precio solapado para evitar breakouts duplicados.
        """
        pending = self._pending_zones.get(symbol, [])
        if not pending:
            return

        close_price = candle.get("close", 0)
        high = candle.get("high", 0)
        low = candle.get("low", 0)
        candle_ts = candle.get("timestamp", 0)

        logger.info(
            f"[ZONE] {symbol}: Chequeando {len(pending)} pending zones vs close={close_price:.2f}"
        )
        for i, pz in enumerate(pending):
            logger.info(
                f"[ZONE]   Pending[{i}]: range=[{pz.get('zone_low',0):.2f}-{pz.get('zone_high',0):.2f}] "
                f"breakout_upper={pz.get('breakout_upper',0):.2f} breakout_lower={pz.get('breakout_lower',0):.2f} "
                f"score={pz.get('trading_score',0):.1f}"
            )

        # Fase 1: Identificar TODAS las zonas que rompen, agrupadas por direccion
        candidates_by_direction = {}  # direction -> list of (pz, zone_dict, sl, tp)
        for pz in pending:
            breakout_upper = pz.get("breakout_upper", 0)
            breakout_lower = pz.get("breakout_lower", 0)

            if not breakout_upper or not breakout_lower:
                continue

            if close_price > breakout_upper:
                direction = "UP"
            elif close_price < breakout_lower:
                direction = "DOWN"
            else:
                continue

            # Verificar que no sea zona ya conocida (con tolerancia temporal)
            known = self._known_zones.get(symbol, {})
            interval_ms = self._get_interval_ms()
            pz_high = pz.get("zone_high", 0)
            pz_low = pz.get("zone_low", 0)
            if self._is_zone_known(known, pz.get('start_ts', 0), pz.get('end_ts', 0),
                                    pz_high, pz_low, interval_ms):
                continue

            entry_price = close_price
            zone_high = pz.get("zone_high", 0)
            zone_low = pz.get("zone_low", 0)
            poc_price = pz.get("poc_price", 0)

            # Validar proximidad: el entry no debe estar demasiado lejos de la zona
            # (evita SL/TP absurdos cuando el precio se alejo mucho)
            zone_edge = breakout_upper if direction == "UP" else breakout_lower
            if zone_edge > 0:
                distance_pct = abs(entry_price - zone_edge) / zone_edge * 100
                max_distance_pct = self.config.max_price_range_pct  # misma tolerancia que rango de zona
                if distance_pct > max_distance_pct:
                    alert_logger.info(
                        f"BLOCKED_FAR_ENTRY | {symbol} | {direction} | "
                        f"entry={entry_price:.2f} zone_edge={zone_edge:.2f} "
                        f"distance={distance_pct:.2f}% > max={max_distance_pct:.1f}%"
                    )
                    continue

            sl_price, tp_price, r_distance = self._calculate_sl_tp(
                entry_price, direction, zone_high, zone_low, poc_price
            )
            if not sl_price or not tp_price:
                continue

            if direction not in candidates_by_direction:
                candidates_by_direction[direction] = []
            candidates_by_direction[direction].append((pz, sl_price, tp_price, r_distance))

        if not candidates_by_direction:
            return

        # Check sequential mode: si ya hay un trade abierto, no abrir mas
        existing_open = self._open_trades.get(symbol, [])
        if self.config.position_mode == "sequential" and len(existing_open) > 0:
            for direction, candidates in candidates_by_direction.items():
                for pz, _, _, _ in candidates:
                    alert_logger.info(
                        f"BLOCKED_SEQUENTIAL_PENDING | {symbol} | {direction} | "
                        f"score={pz.get('trading_score',0):.1f} | "
                        f"reason=already {len(existing_open)} open trade(s)"
                    )
            return

        # Fase 2: Seleccionar la MEJOR zona por direccion (mayor score)
        broken = []
        for direction, candidates in candidates_by_direction.items():
            # Ordenar por score descendente -> tomar la mejor
            candidates.sort(key=lambda x: x[0].get("trading_score", 0), reverse=True)
            best_pz, sl_price, tp_price, r_distance = candidates[0]

            zone_high = best_pz.get("zone_high", 0)
            zone_low = best_pz.get("zone_low", 0)
            poc_price = best_pz.get("poc_price", 0)

            zone_dict = {
                "start_timestamp": best_pz.get("start_ts", 0),
                "end_timestamp": best_pz.get("end_ts", 0),
                "min_price": zone_low,
                "max_price": zone_high,
                "breakout_direction": direction,
                "breakout_price": close_price,
                "breakout_timestamp": candle_ts,
                "entry_mode": self.config.entry_mode,
                "entry_price": close_price,
                "entry_timestamp": candle_ts,
                "entry_bar_offset": 0,
                "sl_price": sl_price,
                "tp_price": tp_price,
                "trade_result": "OPEN",
                "trade_pnl_r": 0.0,
                "trade_close_timestamp": 0,
                "trading_score": best_pz.get("trading_score", 50.0),
                "candles_in_zone": best_pz.get("candle_count", 0),
                "duration_hours": best_pz.get("duration_hours", 0),
                "vp_poc_price": poc_price,
                "vp_vah_price": best_pz.get("vah_price", 0),
                "vp_val_price": best_pz.get("val_price", 0),
                "timeline_index": 0,
                "method": "trading_zones",
            }

            # Marcar como conocida (con end_ts actual y tambien solo start_ts
            # para capturar re-detecciones de la misma zona con end_ts expandido)
            zone_key = f"{best_pz.get('start_ts', 0)}_{best_pz.get('end_ts', 0)}_{direction}"
            start_only_key = f"{best_pz.get('start_ts', 0)}_*_{direction}"
            known = self._known_zones.get(symbol, {})
            known[zone_key] = zone_dict
            known[start_only_key] = zone_dict
            self._known_zones[symbol] = known

            self.stats["pending_breakouts_detected"] += 1
            self.stats["zones_detected"] += 1

            alert_logger.info(
                f"INSTANT_BREAKOUT | {symbol} | {direction} | "
                f"entry={close_price:.2f} | sl={sl_price:.2f} | tp={tp_price:.2f} | "
                f"score={zone_dict['trading_score']:.1f} | mode=pending_monitor"
            )

            # Registrar como open trade para tracking SL/TP
            self._register_open_trades(symbol, [zone_dict])

            # Agregar al baseline estable para que persista en el frontend
            # Solo si no hay zona similar ya en baseline (evitar duplicados)
            baseline = self._baseline_zones.get(symbol, [])
            _tol_ms = self._get_interval_ms() * 5
            already_in_baseline = False
            for bz in baseline:
                if bz.get('breakout_direction', '') != direction:
                    continue
                bz_start = bz.get('start_timestamp', 0)
                if abs(zone_dict['start_timestamp'] - bz_start) > _tol_ms:
                    continue
                bz_high = bz.get('max_price', 0)
                bz_low = bz.get('min_price', 0)
                ov = max(0, min(zone_dict['max_price'], bz_high) - max(zone_dict['min_price'], bz_low))
                mh = min(zone_dict['max_price'] - zone_dict['min_price'], bz_high - bz_low)
                if mh > 0 and ov / mh >= 0.6:
                    already_in_baseline = True
                    # Actualizar la zona existente con los datos del breakout
                    bz.update(zone_dict)
                    break
            if not already_in_baseline:
                baseline.append(dict(zone_dict))
            self._baseline_zones[symbol] = baseline

            # Marcar la mejor zona como rota
            broken.append(best_pz)

            # Marcar TODAS las otras zonas con precio solapado como rotas tambien
            for other_pz, _, _, _ in candidates[1:]:
                broken.append(other_pz)
                other_score = other_pz.get("trading_score", 0)
                alert_logger.info(
                    f"DEDUP_REMOVED | {symbol} | {direction} | "
                    f"score={other_score:.1f} | overlapping zone removed (best={zone_dict['trading_score']:.1f})"
                )

            # Filtro de score
            if self.config.min_score_filter > 0 and zone_dict["trading_score"] < self.config.min_score_filter:
                alert_logger.info(
                    f"BLOCKED_LOW_SCORE | {symbol} | score={zone_dict['trading_score']:.1f} < min={self.config.min_score_filter}"
                )
                self.stats["alerts_blocked_score"] += 1
                continue

            # Enviar alerta
            if self.config.alertsEnabled:
                tz = TradingZone(
                    id=f"instant_{int(candle_ts)}_{direction}",
                    min_price=zone_low,
                    max_price=zone_high,
                    start_timestamp=best_pz.get("start_ts", 0),
                    end_timestamp=best_pz.get("end_ts", 0),
                    touches_support=0,
                    touches_resistance=0,
                    total_touches=0,
                    duration_hours=best_pz.get("duration_hours", 0),
                    avg_volume=0.0,
                    volume_score=0.0,
                    method=self.config.detection_method or "trading_zones",
                    score=zone_dict["trading_score"],
                    candles_in_zone=best_pz.get("candle_count", 0),
                    price_range_pct=0.0,
                    breakout_direction=direction,
                    breakout_price=close_price,
                    breakout_timestamp=candle_ts,
                    entry_mode=self.config.entry_mode,
                    entry_price=close_price,
                    entry_timestamp=candle_ts,
                    sl_price=sl_price,
                    tp_price=tp_price,
                    trade_result="OPEN",
                    trading_score=zone_dict["trading_score"],
                )
                await self._process_alert(symbol, tz)

        # Remover zonas rotas + eliminar pending zones con >50% solapamiento en precio
        if broken:
            broken_set = set(id(pz) for pz in broken)
            remaining = []
            for pz in pending:
                if id(pz) in broken_set:
                    continue
                # Eliminar pending zones con precio solapado a las rotas
                pz_high = pz.get("zone_high", 0)
                pz_low = pz.get("zone_low", 0)
                overlaps = False
                for bpz in broken:
                    b_high = bpz.get("zone_high", 0)
                    b_low = bpz.get("zone_low", 0)
                    overlap = min(pz_high, b_high) - max(pz_low, b_low)
                    if overlap > 0:
                        min_height = min(pz_high - pz_low, b_high - b_low)
                        if min_height > 0 and overlap / min_height > 0.5:
                            overlaps = True
                            break
                if overlaps:
                    alert_logger.info(
                        f"DEDUP_OVERLAP_REMOVED | {symbol} | pending zone removed (price overlap >50%)"
                    )
                else:
                    remaining.append(pz)
            self._pending_zones[symbol] = remaining
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

        tp_rr = self.config.tp_rr_ratio  # Configurable via zone_realtime_config.json

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
        Actualiza las zonas para el frontend usando el BASELINE estable.
        NO recalcula las zonas historicas en cada vela - solo actualiza pending zones.

        Flujo:
        1) Re-detecta con include_no_breakout=True para encontrar pending zones actualizadas
        2) Combina baseline historico (estable) + pending zones (dinamicas) + open trades
        3) Las alertas se envian SOLO desde _check_pending_breakouts()
        """
        params = self._build_detection_params()
        params.include_no_breakout = True

        # Solo usar la ventana configurada
        window = candles[-self.config.window_candles:] if len(candles) > self.config.window_candles else candles

        method = self.config.detection_method or "trading_zones"
        logger.info(f"[ZONE] {symbol}: _detect_and_alert() con {len(window)} velas (ventana={self.config.window_candles}, method={method})")

        # Detectar para encontrar pending zones actualizadas
        t0 = time.time()
        zones = self.detector.detect_zones(window, method=method, params=params)
        dt = (time.time() - t0) * 1000

        self.stats["detections_run"] += 1
        self.stats["last_detection_zones"] = len(zones) if zones else 0

        logger.info(f"[ZONE] {symbol}: detect_zones() retorno {len(zones) if zones else 0} zonas en {dt:.0f}ms")

        # Separar breakouts reales vs fake (pendientes)
        real_breakout_zones = []
        pending_candidates = []

        if zones:
            for zone in zones:
                if not isinstance(zone, TradingZone):
                    continue
                bp = zone.breakout_price
                is_real = bp > zone.max_price or bp < zone.min_price
                if is_real:
                    real_breakout_zones.append(zone)
                else:
                    pending_candidates.append(zone)

        logger.info(
            f"[ZONE] {symbol}: Separacion: {len(real_breakout_zones)} breakouts reales + "
            f"{len(pending_candidates)} pendientes (sin breakout)"
        )
        for z in real_breakout_zones:
            logger.info(
                f"[ZONE]   BREAKOUT: dir={z.breakout_direction} entry={z.entry_price:.2f} "
                f"sl={z.sl_price:.2f} tp={z.tp_price:.2f} result={z.trade_result} "
                f"score={z.trading_score:.1f} range=[{z.min_price:.2f}-{z.max_price:.2f}]"
            )
        for z in pending_candidates:
            logger.info(
                f"[ZONE]   PENDING: range=[{z.min_price:.2f}-{z.max_price:.2f}] "
                f"score={z.trading_score:.1f} candles={z.candles_in_zone}"
            )

        # --- Actualizar pending zones ---
        self._update_pending_zones(symbol, pending_candidates, window)

        # --- Agregar nuevos breakouts reales al baseline si no estan ---
        known = self._known_zones.get(symbol, {})
        baseline = self._baseline_zones.get(symbol, [])
        interval_ms = self._get_interval_ms()

        new_baseline_added = 0
        for zone in real_breakout_zones:
            zone_key = f"{zone.start_timestamp}_{zone.end_timestamp}_{zone.breakout_direction}"
            start_only_key = f"{zone.start_timestamp}_*_{zone.breakout_direction}"

            # Check si ya existe en baseline (con tolerancia temporal)
            already_in_baseline = False
            for bz in baseline:
                bz_start = bz.get('start_timestamp', 0)
                bz_dir = bz.get('breakout_direction', '')
                if bz_dir != zone.breakout_direction:
                    continue
                if abs(bz_start - zone.start_timestamp) <= interval_ms * 5:
                    # Solapamiento de precio
                    bz_high = bz.get('max_price', 0)
                    bz_low = bz.get('min_price', 0)
                    ov = max(0, min(zone.max_price, bz_high) - max(zone.min_price, bz_low))
                    mh = min(zone.max_price - zone.min_price, bz_high - bz_low)
                    if mh > 0 and ov / mh >= 0.6:
                        already_in_baseline = True
                        break
            if already_in_baseline:
                continue

            # Nuevo breakout real descubierto -> agregar al baseline
            if not self._is_zone_known(known, zone.start_timestamp, zone.end_timestamp,
                                        zone.max_price, zone.min_price, interval_ms):
                known[zone_key] = zone
                known[start_only_key] = zone
                self._known_zones[symbol] = known

            d = zone.to_dict() if isinstance(zone, TradingZone) else dict(zone)
            baseline.append(d)
            new_baseline_added += 1

            self.stats["zones_detected"] += 1

            alert_logger.info(
                f"BREAKOUT_DETECTED | {symbol} | {zone.breakout_direction} | "
                f"entry={zone.entry_price:.2f} | sl={zone.sl_price:.2f} | tp={zone.tp_price:.2f} | "
                f"result={zone.trade_result} | score={zone.trading_score:.1f} | mode={zone.entry_mode}"
            )

            # Registrar como open trade SOLO si el detector lo marca como OPEN
            # (zonas con result WIN/LOSS son historicas, NO deben re-abrirse)
            if zone.trade_result == "OPEN" and zone.entry_price and zone.sl_price and zone.tp_price:
                # Bug 3 fix: Solo abrir trade si el breakout es RECIENTE
                # (su breakout_timestamp esta dentro de las ultimas N velas)
                last_candle_ts = window[-1]["timestamp"] if window else 0
                breakout_age_candles = 0
                if zone.breakout_timestamp and last_candle_ts and interval_ms > 0:
                    breakout_age_candles = (last_candle_ts - zone.breakout_timestamp) / interval_ms
                if breakout_age_candles > self.config.breakout_search_bars:
                    alert_logger.info(
                        f"BLOCKED_STALE_BREAKOUT | {symbol} | {zone.breakout_direction} | "
                        f"entry={zone.entry_price:.2f} | age={breakout_age_candles:.0f} candles > max={self.config.breakout_search_bars}"
                    )
                    continue

                zone_dict = {
                    "start_timestamp": zone.start_timestamp,
                    "end_timestamp": zone.end_timestamp,
                    "min_price": zone.min_price,
                    "max_price": zone.max_price,
                    "breakout_direction": zone.breakout_direction,
                    "breakout_price": zone.breakout_price,
                    "breakout_timestamp": zone.breakout_timestamp,
                    "entry_mode": zone.entry_mode,
                    "entry_price": zone.entry_price,
                    "entry_timestamp": zone.entry_timestamp,
                    "sl_price": zone.sl_price,
                    "tp_price": zone.tp_price,
                    "trade_result": "OPEN",
                    "trade_pnl_r": 0.0,
                    "trade_close_timestamp": 0,
                    "trading_score": zone.trading_score,
                    "method": "trading_zones",
                }
                self._register_open_trades(symbol, [zone_dict])

        if new_baseline_added > 0:
            self._baseline_zones[symbol] = baseline
            logger.info(f"[ZONE] {symbol}: +{new_baseline_added} NUEVAS zonas al baseline (total: {len(baseline)})")
        else:
            logger.info(f"[ZONE] {symbol}: Sin nuevos breakouts (baseline={len(baseline)} sin cambios)")

        # --- Construir zonas para frontend: baseline estable + pending limpias ---
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

        # Combinar: baseline historico (copias para no mutar el baseline) + pendientes (dinamicas)
        all_zones = [dict(bz) for bz in baseline] + clean_pending_dicts
        logger.info(
            f"[ZONE] {symbol}: Frontend zones: {len(all_zones)} total "
            f"({len(baseline)} baseline + {len(clean_pending_dicts)} pending)"
        )
        self._store_zones(symbol, all_zones, real_breakout_zones=None)

        # NOTA: Las alertas al TradingBot SOLO se envian desde _check_pending_breakouts()
        # para garantizar que reaccionan en la vela exacta del breakout.
        # _detect_and_alert() solo registra zonas para visualizacion y tracking.

    def _find_matching_pending(self, existing_list: List[Dict], zone_start_ts: int,
                                zone_high: float, zone_low: float, interval_ms: int) -> Optional[Dict]:
        """
        Busca una pending zone existente que coincida con la zona candidata.
        Usa matching por SOLAPAMIENTO DE PRECIO (>60%) + PROXIMIDAD TEMPORAL de start_ts.

        Esto es robusto ante el deslizamiento del buffer que puede cambiar start_ts
        en ±1-3 intervalos cuando las velas mas antiguas salen del buffer.
        """
        tolerance_ms = interval_ms * 5  # Tolerancia: 5 candles de intervalo

        best_match = None
        best_overlap = 0.0

        for pz in existing_list:
            pz_start = pz.get('start_ts', 0)
            pz_high = pz.get('zone_high', 0)
            pz_low = pz.get('zone_low', 0)

            # Criterio 1: Proximidad temporal de start_ts
            ts_diff = abs(zone_start_ts - pz_start)
            if ts_diff > tolerance_ms:
                continue

            # Criterio 2: Solapamiento de precio > 60%
            overlap_high = min(zone_high, pz_high)
            overlap_low = max(zone_low, pz_low)
            overlap = max(0, overlap_high - overlap_low)
            zone_height = zone_high - zone_low
            pz_height = pz_high - pz_low
            min_height = min(zone_height, pz_height) if zone_height > 0 and pz_height > 0 else 1
            overlap_ratio = overlap / min_height if min_height > 0 else 0

            if overlap_ratio >= 0.6 and overlap_ratio > best_overlap:
                best_match = pz
                best_overlap = overlap_ratio

        return best_match

    def _get_interval_ms(self) -> int:
        """Retorna el intervalo actual en milisegundos."""
        interval_map = {
            "1": 60000, "3": 180000, "5": 300000, "15": 900000, "30": 1800000,
            "60": 3600000, "120": 7200000, "240": 14400000, "360": 21600000,
            "720": 43200000, "D": 86400000, "W": 604800000,
        }
        return interval_map.get(self.config.interval, 60000)

    def _is_zone_known(self, known: Dict, start_ts: int, end_ts: int,
                        zone_high: float, zone_low: float, interval_ms: int) -> bool:
        """
        Verifica si una zona ya esta en _known_zones usando tolerancia temporal
        y solapamiento de precio. Mas robusto que matching exacto de timestamps.
        """
        # Primero: check exacto rapido (la mayoria de veces funciona)
        for direction in ("UP", "DOWN"):
            exact_key = f"{start_ts}_{end_ts}_{direction}"
            start_key = f"{start_ts}_*_{direction}"
            if exact_key in known or start_key in known:
                return True

        # Segundo: check con tolerancia temporal + solapamiento de precio
        tolerance_ms = interval_ms * 5
        for key, kzone in known.items():
            if '_*_' in key:
                continue  # Skip wildcard entries
            parts = key.split('_')
            if len(parts) < 3:
                continue
            try:
                k_start = int(parts[0])
            except (ValueError, IndexError):
                continue

            if abs(start_ts - k_start) > tolerance_ms:
                continue

            # Check solapamiento de precio
            if isinstance(kzone, TradingZone):
                k_high = kzone.max_price
                k_low = kzone.min_price
            elif isinstance(kzone, dict):
                k_high = kzone.get('max_price', 0)
                k_low = kzone.get('min_price', 0)
            else:
                continue

            overlap_high = min(zone_high, k_high)
            overlap_low = max(zone_low, k_low)
            overlap = max(0, overlap_high - overlap_low)
            min_height = min(zone_high - zone_low, k_high - k_low)
            if min_height > 0 and overlap / min_height >= 0.6:
                return True

        return False

    def _update_pending_zones(self, symbol: str, candidates: List[TradingZone], candles: List[Dict]):
        """
        Actualiza las zonas pendientes de breakout para un simbolo.
        Reemplaza la lista completa en cada ciclo de deteccion porque las zonas
        se re-detectan con cada nueva vela (el buffer deslizante las mantiene).

        CRITICO: Los breakout_upper/breakout_lower se CONGELAN al valor de cuando
        la zona se registra por primera vez como pending. Si la zona se expande
        (end_ts cambia), los limites de breakout NO se actualizan para evitar
        el ciclo infinito: zona se expande -> breakout_upper sube -> nunca rompe.

        El matching usa SOLAPAMIENTO DE PRECIO + PROXIMIDAD DE start_ts en vez de
        igualdad exacta de start_ts, porque el buffer deslizante puede cambiar
        start_ts cuando las velas mas antiguas salen de la ventana.
        """
        existing_list = self._pending_zones.get(symbol, [])
        interval_ms = self._get_interval_ms()

        new_pending = []
        matched_existing_ids = set()  # Track cuales existing ya fueron matcheados

        for zone in candidates:
            # Determinar limites de breakout segun entry_mode
            if self.config.entry_mode == "va_breakout":
                breakout_upper = zone.vp_vah_price if zone.vp_vah_price > 0 else zone.max_price
                breakout_lower = zone.vp_val_price if zone.vp_val_price > 0 else zone.min_price
            else:
                breakout_upper = zone.max_price
                breakout_lower = zone.min_price

            # Verificar que no sea una zona ya conocida con breakout real
            known = self._known_zones.get(symbol, {})
            is_known = self._is_zone_known(known, zone.start_timestamp, zone.end_timestamp,
                                            zone.max_price, zone.min_price, interval_ms)
            if is_known:
                continue

            # Buscar match en pending zones existentes (tolerancia temporal + solapamiento precio)
            # Excluir las que ya fueron matcheadas para evitar que 2 zonas matcheen la misma pending
            available = [pz for pz in existing_list if id(pz) not in matched_existing_ids]
            existing = self._find_matching_pending(
                available, zone.start_timestamp, zone.max_price, zone.min_price, interval_ms
            )

            if existing:
                matched_existing_ids.add(id(existing))
                # ZONA YA CONOCIDA como pending: CONGELAR breakout_upper/breakout_lower
                pz_dict = {
                    "start_ts": zone.start_timestamp,
                    "end_ts": zone.end_timestamp,
                    "zone_high": zone.max_price,
                    "zone_low": zone.min_price,
                    "breakout_upper": existing["breakout_upper"],  # CONGELADO
                    "breakout_lower": existing["breakout_lower"],  # CONGELADO
                    "poc_price": zone.vp_poc_price,
                    "vah_price": zone.vp_vah_price,
                    "val_price": zone.vp_val_price,
                    "trading_score": zone.trading_score,
                    "candle_count": zone.candles_in_zone,
                    "duration_hours": zone.duration_hours,
                    "first_seen": existing.get("first_seen", time.time()),
                }
                logger.info(
                    f"[ZONE] {symbol}: Pending MATCHED (start_ts {existing.get('start_ts',0)}->{zone.start_timestamp}): "
                    f"breakout_upper={existing['breakout_upper']:.2f} (frozen) vs new_max={zone.max_price:.2f}"
                )
            else:
                # NUEVA zona pending: registrar con breakout_upper/lower actuales
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
                    "first_seen": time.time(),
                }
                logger.info(
                    f"[ZONE] {symbol}: Pending NEW: start={zone.start_timestamp} "
                    f"range=[{zone.min_price:.2f}-{zone.max_price:.2f}] "
                    f"breakout_upper={breakout_upper:.2f} breakout_lower={breakout_lower:.2f}"
                )
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
            logger.info(f"[ZONE] {symbol}: Pending zones: {old_count} -> {new_count}")

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
            position_mode=self.config.position_mode,
            # ATR Dynamic params
            atr_dyn_period=self.config.atr_dyn_period,
            atr_dyn_ma_period=self.config.atr_dyn_ma_period,
            atr_dyn_multiplier=self.config.atr_dyn_multiplier,
            atr_dyn_min_bars=self.config.atr_dyn_min_bars,
            atr_dyn_max_breakout=self.config.atr_dyn_max_breakout,
            # Capas v3.0
            use_atr_band=self.config.use_atr_band,
            atr_band_period=self.config.atr_band_period,
            atr_band_multiplier=self.config.atr_band_multiplier,
            atr_band_ma_period=self.config.atr_band_ma_period,
            use_reentry=self.config.use_reentry,
            max_reentry_bars=self.config.max_reentry_bars,
            use_ttm_prefilter=self.config.use_ttm_prefilter,
            ttm_atr_length=self.config.ttm_atr_length,
            ttm_kc_multiplier=self.config.ttm_kc_multiplier,
            ttm_min_squeeze_bars=self.config.ttm_min_squeeze_bars,
            use_bbwp_scoring=self.config.use_bbwp_scoring,
            use_inside_pct_filter=self.config.use_inside_pct_filter,
            tp_rr_ratio=self.config.tp_rr_ratio,
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
            sl_dist = abs(float(zone.entry_price) - float(zone.sl_price))
            tp_dist = abs(float(zone.tp_price) - float(zone.entry_price))
            alert_logger.info(
                f"ALERT_SENT | {symbol} | {direction} | "
                f"entry={zone.entry_price:.2f} | sl_dist={sl_dist:.2f} | tp_dist={tp_dist:.2f}"
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
                logger.info(f"[ZONE] Alerta registrada en historial: {alert_record.id}")
            except Exception as e:
                logger.error(f"[ZONE] Error registrando alerta en historial: {e}")
        else:
            alert_logger.error(f"ALERT_FAILED | {symbol} | {direction} | entry={zone.entry_price:.2f} | (ver lineas anteriores para detalle)")

    async def _send_alert(self, symbol: str, zone: TradingZone) -> bool:
        """Envia HTTP POST al TradingBot."""
        if not self._http_client:
            logger.error("[ZONE] HTTP client no inicializado")
            return False

        direction = "LONG" if zone.breakout_direction == "UP" else "SHORT"

        # Enviar distancias en vez de precios absolutos para que el TradingBot
        # aplique SL/TP sobre el precio REAL de ejecucion (no el precio de la alerta).
        sl_distance = abs(float(zone.entry_price) - float(zone.sl_price))
        tp_distance = abs(float(zone.tp_price) - float(zone.entry_price))

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
            "sl_distance": round(sl_distance, 2),
            "tp_distance": round(tp_distance, 2),
        }

        try:
            logger.info(f"[ZONE] Enviando alerta: {symbol} {direction} -> {self.config.alertTargetUrl}")
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
                    logger.warning(f"[ZONE] TradingBot rechazo alerta: {reason}")
                return success
            else:
                body_text = response.text[:200] if response.text else "empty"
                alert_logger.error(f"ALERT_HTTP_ERROR | {symbol} | {direction} | status={response.status_code} | body={body_text}")
                logger.warning(f"[ZONE] Alerta rechazada: HTTP {response.status_code} - {body_text}")
                return False
        except httpx.ConnectError:
            alert_logger.error(f"ALERT_CONNECT_ERROR | {symbol} | {direction} | TradingBot no disponible en {self.config.alertTargetUrl}")
            logger.error("[ZONE] TradingBot no disponible (ConnectError)")
            return False
        except httpx.TimeoutException:
            alert_logger.error(f"ALERT_TIMEOUT | {symbol} | {direction}")
            logger.error("[ZONE] Timeout enviando alerta")
            return False
        except Exception as e:
            alert_logger.error(f"ALERT_EXCEPTION | {symbol} | {direction} | error={str(e)}")
            logger.error(f"[ZONE] Error enviando alerta: {e}")
            return False

    # --------------------------------------------------
    # Historical data loading
    # --------------------------------------------------

    async def _load_initial_data(self):
        """Carga datos historicos iniciales para cada simbolo."""
        await asyncio.sleep(1.0)  # Esperar que WebSocket se estabilice

        logger.info(f"[ZONE] Cargando historico para {len(self.config.symbols)} simbolos...")

        for symbol in self.config.symbols:
            try:
                await self._load_symbol_history(symbol)
            except Exception as e:
                logger.error(f"[ZONE] Error cargando historico de {symbol}: {e}")

        logger.info("[ZONE] Historico cargado para todos los simbolos")

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
            logger.info(f"[ZONE] {symbol}: Buffer WS tiene {len(candles)} velas, necesita {desired}. Cargando de API...")
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

        logger.info(f"[ZONE] {symbol}: {len(self._candle_buffers.get(symbol, []))} velas cargadas")

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
                logger.error(f"[ZONE] Error API fetch {symbol}: {e}")
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
        """Deteccion inicial para llenar zonas conocidas y pending zones (sin enviar alertas).
        Las zonas historicas se almacenan como BASELINE estable que no se recalcula cada vela."""
        logger.info(f"[ZONE] ====== DETECCION INICIAL {symbol} ======")
        logger.info(f"[ZONE] {symbol}: {len(candles)} velas disponibles para deteccion inicial")

        params = self._build_detection_params()
        params.include_no_breakout = True  # Incluir zonas pendientes tambien

        method = self.config.detection_method or "trading_zones"
        logger.info(
            f"[ZONE] {symbol}: Params: method={method} min_bars={params.consol_min_bars} max_bars={params.consol_max_bars} "
            f"max_range={params.consol_max_range_pct}% atr_ratio={params.consol_atr_ratio} "
            f"body_ratio={params.consol_body_ratio} entry_mode={params.entry_mode} "
            f"sl_mode={params.sl_mode} position_mode={params.position_mode} "
            f"tp_rr={params.tp_rr_ratio}"
        )

        t0 = time.time()
        zones = self.detector.detect_zones(candles, method=method, params=params)
        dt = (time.time() - t0) * 1000
        logger.info(f"[ZONE] {symbol}: detect_zones() retorno {len(zones)} zonas en {dt:.0f}ms")

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
                # Breakout real -> registrar como conocida (clave exacta + wildcard)
                zone_key = f"{zone.start_timestamp}_{zone.end_timestamp}_{zone.breakout_direction}"
                known[zone_key] = zone
                start_only_key = f"{zone.start_timestamp}_*_{zone.breakout_direction}"
                known[start_only_key] = zone
            else:
                # Breakout fake -> candidata a pending
                pending_candidates.append(zone)

        self._known_zones[symbol] = known

        logger.info(f"[ZONE] {symbol}: Clasificacion: {len(known)} breakouts reales, {len(pending_candidates)} pendientes")
        for zk, z in known.items():
            zobj = z if isinstance(z, TradingZone) else z
            dir_str = zobj.breakout_direction if hasattr(zobj, 'breakout_direction') else zobj.get('breakout_direction', '?')
            result_str = zobj.trade_result if hasattr(zobj, 'trade_result') else zobj.get('trade_result', '?')
            entry_p = zobj.entry_price if hasattr(zobj, 'entry_price') else zobj.get('entry_price', 0)
            score_v = zobj.trading_score if hasattr(zobj, 'trading_score') else zobj.get('trading_score', 0)
            logger.info(
                f"[ZONE]   BASELINE: {dir_str} | result={result_str} | entry={entry_p:.2f} | score={score_v:.1f}"
            )
        for pz in pending_candidates:
            logger.info(
                f"[ZONE]   PENDING: range=[{pz.min_price:.2f}-{pz.max_price:.2f}] | "
                f"score={pz.trading_score:.1f} | candles={pz.candles_in_zone}"
            )

        # --- Guardar baseline de zonas historicas (ESTABLE, no cambia cada vela) ---
        baseline_dicts = []
        for zone_key, zone in known.items():
            d = zone.to_dict() if isinstance(zone, TradingZone) else dict(zone)
            baseline_dicts.append(d)
        self._baseline_zones[symbol] = baseline_dicts
        logger.info(f"[ZONE] {symbol}: Baseline guardado con {len(baseline_dicts)} zonas historicas")

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

        # Almacenar: baseline historico (copias para no mutar baseline) + pendientes limpias
        all_zones_for_frontend = [dict(bz) for bz in baseline_dicts] + clean_pending_dicts
        # En initial_detection no registramos open trades (trades historicos ya tienen resultado)
        self._store_zones(symbol, all_zones_for_frontend, real_breakout_zones=None)

        # Llenar pending zones al inicio
        if pending_candidates:
            self._update_pending_zones(symbol, pending_candidates, candles)

        pending_count = len(self._pending_zones.get(symbol, []))
        logger.info(
            f"[ZONE] {symbol}: Deteccion inicial -> {len(zones)} zonas, "
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

    def _register_open_trades(self, symbol: str, zone_dicts: List[Dict]) -> int:
        """
        Registra zonas con trade_result=OPEN en _open_trades para tracking vela a vela.
        Solo registra trades que no esten ya rastreados.
        En modo sequential: maximo 1 trade abierto por simbolo.
        Retorna la cantidad de trades efectivamente registrados.
        """
        open_zones = [
            z for z in zone_dicts
            if z.get("trade_result") == "OPEN"
            and z.get("entry_price")
            and z.get("sl_price")
            and z.get("tp_price")
        ]

        if not open_zones:
            return 0

        existing = self._open_trades.get(symbol, [])

        # En modo sequential: bloquear si ya hay un trade abierto
        if self.config.position_mode == "sequential" and len(existing) > 0:
            for z in open_zones:
                alert_logger.info(
                    f"BLOCKED_SEQUENTIAL | {symbol} | {z.get('breakout_direction','')} | "
                    f"entry={z.get('entry_price',0):.2f} | "
                    f"reason=already {len(existing)} open trade(s)"
                )
            return 0

        interval_ms = self._get_interval_ms()

        new_count = 0
        for trade in open_zones:
            # Check si ya existe un trade similar (tolerancia temporal + solapamiento precio)
            t_start = trade.get('start_timestamp', 0)
            t_dir = trade.get('breakout_direction', '')
            t_high = trade.get('max_price', 0)
            t_low = trade.get('min_price', 0)
            already_tracked = False
            for ex in existing:
                if ex.get('breakout_direction', '') != t_dir:
                    continue
                ex_start = ex.get('start_timestamp', 0)
                if abs(t_start - ex_start) > interval_ms * 5:
                    continue
                # Solapamiento de precio
                ov = max(0, min(t_high, ex.get('max_price', 0)) - max(t_low, ex.get('min_price', 0)))
                mh = min(t_high - t_low, ex.get('max_price', 0) - ex.get('min_price', 0))
                if mh > 0 and ov / mh >= 0.6:
                    already_tracked = True
                    break
            if already_tracked:
                continue

            self._open_trades.setdefault(symbol, []).append(dict(trade))  # Copia independiente
            new_count += 1

            # En modo sequential: solo 1 trade, salir despues del primero
            if self.config.position_mode == "sequential":
                break

        if new_count > 0:
            total = len(self._open_trades.get(symbol, []))
            logger.info(f"[ZONE] {symbol}: {new_count} nuevos trades OPEN registrados (total tracking: {total})")
            alert_logger.info(
                f"OPEN_TRADE_REGISTERED | {symbol} | +{new_count} trades | "
                f"total_tracking={total} | mode={self.config.position_mode}"
            )

        return new_count

    def _rebuild_recent_zones(self, symbol: str):
        """
        Reconstruye _recent_zones para el frontend combinando baseline + pending zones.
        Se usa cuando la deteccion esta pausada para que el frontend vea cambios de
        _update_open_trades (WIN/LOSS, PnL parcial) y _check_pending_breakouts
        (breakouts resueltos, zonas removidas de pending).
        """
        baseline = self._baseline_zones.get(symbol, [])
        pending = self._pending_zones.get(symbol, [])

        # Construir pending dicts limpios (sin datos de breakout)
        clean_pending = []
        for pz in pending:
            clean_pending.append({
                "start_timestamp": pz.get("start_ts", 0),
                "end_timestamp": pz.get("end_ts", 0),
                "min_price": pz.get("zone_low", 0),
                "max_price": pz.get("zone_high", 0),
                "breakout_direction": "",
                "breakout_price": 0.0,
                "breakout_timestamp": 0,
                "entry_price": 0.0,
                "entry_timestamp": 0,
                "sl_price": 0.0,
                "tp_price": 0.0,
                "trade_result": "PENDING",
                "trade_pnl_r": 0.0,
                "trade_close_timestamp": 0,
                "trading_score": pz.get("trading_score", 0),
                "candles_in_zone": pz.get("candle_count", 0),
                "duration_hours": pz.get("duration_hours", 0),
                "vp_poc_price": pz.get("poc_price", 0),
                "vp_vah_price": pz.get("vah_price", 0),
                "vp_val_price": pz.get("val_price", 0),
                "timeline_index": 0,
                "method": self.config.detection_method or "trading_zones",
            })

        # Combinar baseline (copias) + pending limpios, deduplicando
        all_zones = []
        seen_keys = set()
        interval_ms = self._get_interval_ms()
        tolerance_ms = interval_ms * 5

        for bz in baseline:
            key = f"{bz.get('start_timestamp', 0)}_{bz.get('breakout_direction', '')}"
            if key not in seen_keys:
                seen_keys.add(key)
                all_zones.append(dict(bz))
            else:
                # Check si es zona diferente con mismo key (diferente end_timestamp)
                is_dup = False
                for existing in all_zones:
                    if existing.get('breakout_direction', '') != bz.get('breakout_direction', ''):
                        continue
                    ex_start = existing.get('start_timestamp', 0)
                    bz_start = bz.get('start_timestamp', 0)
                    if abs(ex_start - bz_start) <= tolerance_ms:
                        ex_high = existing.get('max_price', 0)
                        ex_low = existing.get('min_price', 0)
                        bz_high = bz.get('max_price', 0)
                        bz_low = bz.get('min_price', 0)
                        ov = max(0, min(ex_high, bz_high) - max(ex_low, bz_low))
                        mh = min(ex_high - ex_low, bz_high - bz_low) if ex_high > ex_low and bz_high > bz_low else 1
                        if mh > 0 and ov / mh >= 0.6:
                            is_dup = True
                            break
                if not is_dup:
                    all_zones.append(dict(bz))

        all_zones.extend(clean_pending)

        self._recent_zones[symbol] = all_zones

        # Merge open trades para mantener PnL actualizado
        open_trades = self._open_trades.get(symbol, [])
        if open_trades:
            self._merge_tracked_trades_to_recent(symbol, open_trades)

        # Re-numerar
        self._renumber_zones(symbol)

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
            logger.info(f"[ZONE] Config actualizada: {changed_keys}")

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
            "detection_paused": self.detection_paused,
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
        logger.info("[ZONE] Cooldowns limpiados")

    async def run_detection_once(self) -> Dict:
        """
        Ejecuta _detect_and_alert() una sola vez para todos los simbolos,
        SIN cambiar el estado de detection_paused.
        Util para descubrir zonas pending cuando la re-deteccion continua esta pausada.
        """
        results = {}
        for symbol in self.config.symbols:
            buffer = self._candle_buffers.get(symbol, [])
            if len(buffer) < max(50, self.config.consol_min_bars + 30):
                results[symbol] = {"status": "skipped", "reason": f"buffer insuficiente ({len(buffer)} velas)"}
                continue

            pre_pending = len(self._pending_zones.get(symbol, []))
            pre_baseline = len(self._baseline_zones.get(symbol, []))

            try:
                await self._detect_and_alert(symbol, buffer)
            except Exception as e:
                results[symbol] = {"status": "error", "reason": str(e)}
                continue

            post_pending = len(self._pending_zones.get(symbol, []))
            post_baseline = len(self._baseline_zones.get(symbol, []))

            results[symbol] = {
                "status": "ok",
                "buffer_size": len(buffer),
                "pending_before": pre_pending,
                "pending_after": post_pending,
                "baseline_before": pre_baseline,
                "baseline_after": post_baseline,
            }

            logger.info(
                f"[ZONE] {symbol}: DETECT-NOW completado: "
                f"pending {pre_pending}->{post_pending}, baseline {pre_baseline}->{post_baseline}"
            )

        return results

    async def reanalyze(self):
        """Re-analiza historico con config actual. Limpia zonas conocidas y recalcula baseline."""
        self._known_zones.clear()
        self._recent_zones.clear()
        self._open_trades.clear()
        self._pending_zones.clear()
        self._baseline_zones.clear()
        self.stats["pending_zones_current"] = 0

        for symbol in self.config.symbols:
            buffer = self._candle_buffers.get(symbol, [])
            if len(buffer) >= 50:
                await self._initial_detection(symbol, buffer)

        logger.info("[ZONE] Re-analisis completado")


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
