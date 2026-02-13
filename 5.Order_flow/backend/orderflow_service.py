# orderflow_service.py - Servicio principal de Order Flow
#
# Singleton que orquesta el calculo de footprints integrando:
# - WebSocketManager: recibe trades en tiempo real
# - TradeAggregator: agrupa trades por vela
# - FootprintCalculator: calcula niveles y detecta patrones
#
# Uso:
#     service = OrderFlowService.get_instance()
#     await service.start(ws_manager, symbols=["BTCUSDT"], intervals=["1"])

import asyncio
import json
import logging
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any
from collections import defaultdict, deque

from footprint_calculator import FootprintCalculator, Footprint
from trade_aggregator import TradeAggregator, CandleBucket, Trade
from footprint_storage import get_footprint_storage, FootprintStorage
from footprint_reconstructor import reconstruct_historical_footprints

logger = logging.getLogger(__name__)


@dataclass
class OrderFlowConfig:
    """Configuracion del servicio Order Flow."""
    enabled: bool = True
    symbols: List[str] = field(default_factory=lambda: ["BTCUSDT", "ETHUSDT"])
    intervals: List[str] = field(default_factory=lambda: ["1"])
    imbalance_threshold: float = 3.0
    stacked_min_levels: int = 3
    alerts_enabled: bool = True
    alert_cooldown_minutes: int = 15
    max_footprints_in_memory: int = 2880  # 1 dia de velas 1min x 2 simbolos
    max_history_hours: float = 12.0  # Horas de historial a mantener en disco
    log_trades: bool = False
    # Step sizes por simbolo (tamano de cada nivel en USD)
    # Si no esta configurado, usa el default de footprint_calculator.py
    symbol_step_sizes: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "enabled": self.enabled,
            "symbols": self.symbols,
            "intervals": self.intervals,
            "imbalance_threshold": self.imbalance_threshold,
            "stacked_min_levels": self.stacked_min_levels,
            "alerts_enabled": self.alerts_enabled,
            "alert_cooldown_minutes": self.alert_cooldown_minutes,
            "max_footprints_in_memory": self.max_footprints_in_memory,
            "max_history_hours": self.max_history_hours,
            "log_trades": self.log_trades,
            "symbol_step_sizes": self.symbol_step_sizes
        }

    @classmethod
    def from_dict(cls, data: dict) -> "OrderFlowConfig":
        return cls(
            enabled=data.get("enabled", True),
            symbols=data.get("symbols", ["BTCUSDT", "ETHUSDT"]),
            intervals=data.get("intervals", ["1"]),
            imbalance_threshold=data.get("imbalance_threshold", 3.0),
            stacked_min_levels=data.get("stacked_min_levels", 3),
            alerts_enabled=data.get("alerts_enabled", True),
            alert_cooldown_minutes=data.get("alert_cooldown_minutes", 15),
            max_footprints_in_memory=data.get("max_footprints_in_memory", 2880),
            max_history_hours=data.get("max_history_hours", 12.0),
            log_trades=data.get("log_trades", False),
            symbol_step_sizes=data.get("symbol_step_sizes", {})
        )

    def get_step_size_for_symbol(self, symbol: str) -> Optional[float]:
        """
        Retorna el step size configurado para un simbolo.
        Si no esta configurado, retorna None (usara el default del calculator).
        """
        return self.symbol_step_sizes.get(symbol)

    def set_step_size_for_symbol(self, symbol: str, step_size: float) -> None:
        """Guarda step size personalizado para un simbolo."""
        if step_size > 0:
            self.symbol_step_sizes[symbol] = step_size


class OrderFlowService:
    """
    Servicio principal de Order Flow.

    Responsabilidades:
    - Gestionar suscripciones a trades de WebSocket
    - Coordinar TradeAggregator y FootprintCalculator
    - Almacenar footprints completados en memoria
    - Detectar patrones (imbalances, stacked imbalances)
    - Enviar alertas al TradingBot

    Singleton: usar OrderFlowService.get_instance()
    """

    _instance: Optional["OrderFlowService"] = None

    @classmethod
    def get_instance(cls) -> "OrderFlowService":
        """Retorna la instancia singleton del servicio."""
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    @classmethod
    def reset_instance(cls):
        """Reset del singleton (util para testing)."""
        if cls._instance:
            cls._instance._running = False
        cls._instance = None

    def __init__(self):
        """
        Inicializa el servicio.
        NOTA: Usar get_instance() en lugar de instanciar directamente.
        """
        self.config = OrderFlowConfig()
        self._config_path = Path(__file__).parent / "config" / "orderflow_config.json"

        # Cargar config persistente primero (para tener max_history_hours)
        self._load_config()

        # Storage para persistencia de footprints
        self._storage: FootprintStorage = get_footprint_storage(
            max_age_hours=self.config.max_history_hours
        )

        # WebSocket manager (se asigna en start())
        self._ws_manager = None

        # Aggregators por intervalo
        # { "1": TradeAggregator, "5": TradeAggregator }
        self._aggregators: Dict[str, TradeAggregator] = {}

        # Calculators por simbolo+intervalo
        # { "BTCUSDT_1": FootprintCalculator }
        self._calculators: Dict[str, FootprintCalculator] = {}

        # Footprints completados en memoria
        # { "BTCUSDT_1": deque([Footprint, ...]) }
        self._footprints: Dict[str, deque] = defaultdict(
            lambda: deque(maxlen=self.config.max_footprints_in_memory)
        )

        # Estado del servicio
        self._running = False
        self._start_time: Optional[float] = None
        self._trades_received = 0
        self._footprints_completed = 0
        self._alerts_sent = 0

        # Cooldowns de alertas
        # { "BTCUSDT_BUY": timestamp_last_alert }
        self._alert_cooldowns: Dict[str, float] = {}

        # Task de limpieza periodica
        self._cleanup_task: Optional[asyncio.Task] = None

        # Buffer de volumenes para calcular z-score (rolling 20 velas)
        # { "BTCUSDT_1": deque([vol1, vol2, ...], maxlen=20) }
        self._volume_buffers: Dict[str, deque] = defaultdict(lambda: deque(maxlen=20))

        logger.info("[ORDERFLOW_SERVICE] Inicializado")

    def _load_config(self):
        """Carga configuracion desde archivo JSON."""
        try:
            if self._config_path.exists():
                with open(self._config_path, 'r') as f:
                    data = json.load(f)
                self.config = OrderFlowConfig.from_dict(data)
                logger.info(f"[ORDERFLOW_SERVICE] Config cargada: {self._config_path}")
        except Exception as e:
            logger.error(f"[ORDERFLOW_SERVICE] Error cargando config: {e}")

    def _save_config(self):
        """Guarda configuracion a archivo JSON."""
        try:
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self._config_path, 'w') as f:
                json.dump(self.config.to_dict(), f, indent=2)
            logger.info(f"[ORDERFLOW_SERVICE] Config guardada: {self._config_path}")
        except Exception as e:
            logger.error(f"[ORDERFLOW_SERVICE] Error guardando config: {e}")

    def update_config(self, new_config: dict) -> bool:
        """
        Actualiza la configuracion del servicio.

        Args:
            new_config: Diccionario con nuevos valores

        Returns:
            True si se actualizo correctamente
        """
        try:
            # Merge con config actual
            current = self.config.to_dict()
            current.update(new_config)
            self.config = OrderFlowConfig.from_dict(current)

            # Actualizar max_footprints si cambio
            for key in self._footprints:
                self._footprints[key] = deque(
                    self._footprints[key],
                    maxlen=self.config.max_footprints_in_memory
                )

            self._save_config()
            return True
        except Exception as e:
            logger.error(f"[ORDERFLOW_SERVICE] Error actualizando config: {e}")
            return False

    def update_symbol_step_size(self, symbol: str, step_size: float) -> bool:
        """
        Actualiza el step size para un simbolo especifico.

        Args:
            symbol: Simbolo (ej: "BTCUSDT")
            step_size: Tamano del step en USD (ej: 10.0 para BTC)

        Returns:
            True si se actualizo correctamente
        """
        try:
            # Guardar en config
            self.config.set_step_size_for_symbol(symbol, step_size)
            self._save_config()

            # Actualizar calculators existentes para este simbolo
            for key, calculator in self._calculators.items():
                if key.startswith(f"{symbol}_"):
                    calculator.set_step_size(step_size)
                    logger.info(f"[ORDERFLOW_SERVICE] Step size actualizado para {key}: {step_size}")

            return True
        except Exception as e:
            logger.error(f"[ORDERFLOW_SERVICE] Error actualizando step size de {symbol}: {e}")
            return False

    def get_symbol_step_size(self, symbol: str) -> Optional[float]:
        """Retorna el step size configurado para un simbolo (None si usa default)."""
        return self.config.get_step_size_for_symbol(symbol)

    async def start(self, ws_manager, symbols: Optional[List[str]] = None,
                    intervals: Optional[List[str]] = None):
        """
        Inicia el servicio de Order Flow.

        Args:
            ws_manager: Instancia de WebSocketManager
            symbols: Lista de simbolos (usa config si no se especifica)
            intervals: Lista de intervalos (usa config si no se especifica)
        """
        if self._running:
            logger.warning("[ORDERFLOW_SERVICE] Servicio ya esta corriendo")
            return

        self._ws_manager = ws_manager
        self._start_time = time.time()
        self._running = True

        # Usar parametros o valores de config
        active_symbols = symbols or self.config.symbols
        active_intervals = intervals or self.config.intervals

        # Actualizar config con los simbolos/intervalos activos
        self.config.symbols = active_symbols
        self.config.intervals = active_intervals

        logger.info(
            f"[ORDERFLOW_SERVICE] Iniciando con "
            f"symbols={active_symbols}, intervals={active_intervals}"
        )

        # Crear aggregators para cada intervalo
        for interval in active_intervals:
            aggregator = TradeAggregator(interval=interval)
            aggregator.on_candle_complete = self._on_candle_complete
            self._aggregators[interval] = aggregator

        # Crear calculators para cada simbolo+intervalo
        for symbol in active_symbols:
            for interval in active_intervals:
                key = f"{symbol}_{interval}"
                # Usar step size especifico del simbolo si esta configurado
                symbol_step_size = self.config.get_step_size_for_symbol(symbol)
                self._calculators[key] = FootprintCalculator(
                    symbol=symbol,
                    step_size=symbol_step_size,  # None usa default del calculator
                    imbalance_threshold=self.config.imbalance_threshold
                )

        # Cargar footprints historicos desde disco
        await self._load_historical_footprints(active_symbols, active_intervals)

        # Suscribirse a trades del WebSocket
        if self._ws_manager:
            # Registrar callback para trades
            self._ws_manager.add_trade_listener(self._on_trade_received)

            # Suscribirse a trades de todos los simbolos (subscribe_trades espera una lista)
            await self._ws_manager.subscribe_trades(active_symbols)
            logger.info(f"[ORDERFLOW_SERVICE] Suscrito a trades de {active_symbols}")

        # Iniciar tarea de limpieza periodica (cada hora)
        self._cleanup_task = asyncio.create_task(self._periodic_cleanup())

        logger.info("[ORDERFLOW_SERVICE] Servicio iniciado correctamente")

    async def stop(self):
        """Detiene el servicio de Order Flow."""
        if not self._running:
            return

        logger.info("[ORDERFLOW_SERVICE] Deteniendo servicio...")

        # Cancelar tarea de limpieza
        if self._cleanup_task:
            self._cleanup_task.cancel()
            try:
                await self._cleanup_task
            except asyncio.CancelledError:
                pass
            self._cleanup_task = None

        # Flush de aggregators para no perder datos
        for aggregator in self._aggregators.values():
            await aggregator.flush_all()

        # Guardar footprints pendientes a disco
        self._storage.flush_all()

        self._running = False
        logger.info("[ORDERFLOW_SERVICE] Servicio detenido")

    async def _load_historical_footprints(self, symbols: List[str], intervals: List[str]):
        """
        Carga footprints historicos desde disco al iniciar.
        La reconstruccion de footprints faltantes se hace en background
        para no bloquear el inicio del servicio.
        """
        total_loaded = 0

        for symbol in symbols:
            for interval in intervals:
                key = f"{symbol}_{interval}"

                # Cargar desde storage
                historical = self._storage.load(symbol, interval)

                if historical:
                    # Agregar a la deque en memoria
                    for fp_dict in historical:
                        self._footprints[key].append(fp_dict)

                    total_loaded += len(historical)
                    logger.info(
                        f"[ORDERFLOW_SERVICE] Cargados {len(historical)} footprints historicos para {key}"
                    )

        if total_loaded > 0:
            logger.info(f"[ORDERFLOW_SERVICE] Total footprints cargados desde disco: {total_loaded}")

        # DESACTIVADO: Ya no usamos estimados, solo datos reales del cloud o tiempo real
        # La reconstruccion generaba footprints estimados con heuristica 60/40 bid/ask
        # que no son precisos. Ahora solo usamos:
        # 1. Footprints reales del Cloud Collector (Northflank)
        # 2. Footprints capturados en tiempo real via WebSocket
        #
        # asyncio.create_task(self._reconstruct_missing_footprints(symbols, intervals))
        logger.info("[ORDERFLOW_SERVICE] Reconstruccion de estimados DESACTIVADA - solo datos reales")

    async def _reconstruct_missing_footprints(self, symbols: List[str], intervals: List[str]):
        """
        Reconstruye footprints faltantes en background.
        Se ejecuta despues de que el servicio ya esta corriendo.
        """
        await asyncio.sleep(2)  # Esperar a que el servicio este estable

        logger.info("[ORDERFLOW_SERVICE] Iniciando reconstruccion de footprints en background...")
        total_reconstructed = 0

        for symbol in symbols:
            for interval in intervals:
                key = f"{symbol}_{interval}"

                try:
                    # Obtener timestamps existentes
                    existing_timestamps = set()
                    for fp_dict in self._footprints.get(key, []):
                        existing_timestamps.add(fp_dict.get("candle_timestamp", 0))

                    # Reconstruir faltantes
                    step_size = self.config.get_step_size_for_symbol(symbol)
                    reconstructed = await reconstruct_historical_footprints(
                        symbol=symbol,
                        interval=interval,
                        hours=self.config.max_history_hours,
                        step_size=step_size,
                        existing_timestamps=existing_timestamps
                    )

                    if reconstructed:
                        # Agregar a memoria y guardar en disco
                        for fp_dict in reconstructed:
                            self._footprints[key].append(fp_dict)
                            self._storage.save_footprint(fp_dict)

                        total_reconstructed += len(reconstructed)
                        logger.info(
                            f"[ORDERFLOW_SERVICE] Reconstruidos {len(reconstructed)} footprints para {key}"
                        )

                        # Ordenar por timestamp
                        sorted_fps = sorted(
                            self._footprints[key],
                            key=lambda x: x.get("candle_timestamp", 0)
                        )
                        self._footprints[key] = deque(sorted_fps, maxlen=self.config.max_footprints_in_memory)

                except Exception as e:
                    logger.error(f"[ORDERFLOW_SERVICE] Error reconstruyendo footprints para {key}: {e}")

                # Pequeno delay entre simbolos para no saturar
                await asyncio.sleep(0.5)

        if total_reconstructed > 0:
            logger.info(f"[ORDERFLOW_SERVICE] Reconstruccion completada: {total_reconstructed} footprints")

    async def _periodic_cleanup(self):
        """Tarea que limpia footprints antiguos cada hora."""
        while self._running:
            try:
                await asyncio.sleep(3600)  # Cada hora

                if not self._running:
                    break

                # Limpiar footprints antiguos
                removed = self._storage.cleanup_old()
                if removed > 0:
                    logger.info(f"[ORDERFLOW_SERVICE] Limpieza periodica: {removed} footprints eliminados")

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"[ORDERFLOW_SERVICE] Error en limpieza periodica: {e}")

    async def _on_trade_received(self, symbol: str, ws_trade):
        """
        Callback cuando se recibe un trade del WebSocket.

        Args:
            symbol: Simbolo del trade
            ws_trade: Objeto Trade de websocket_manager (tiene: timestamp, symbol, side, price, size, trade_id)
        """
        if not self._running or not self.config.enabled:
            return

        # Verificar que el simbolo esta activo
        if symbol not in self.config.symbols:
            return

        self._trades_received += 1

        # Convertir Trade de websocket_manager a Trade de trade_aggregator
        # ws_trade tiene: timestamp, symbol, side, price, size, trade_id
        trade = Trade(
            timestamp=ws_trade.timestamp,
            symbol=ws_trade.symbol,
            side=ws_trade.side,
            price=ws_trade.price,
            volume=ws_trade.size,  # websocket_manager usa 'size', trade_aggregator usa 'volume'
            trade_id=ws_trade.trade_id
        )

        # Log opcional de trades
        if self.config.log_trades:
            logger.debug(
                f"[TRADE] {symbol}: {trade.side} {trade.volume:.6f} @ {trade.price:.2f}"
            )

        # Agregar a todos los aggregators activos
        for interval, aggregator in self._aggregators.items():
            await aggregator.add_trade(trade)

    async def _on_candle_complete(self, bucket: CandleBucket):
        """
        Callback cuando una vela se completa en el aggregator.

        Args:
            bucket: CandleBucket con todos los trades de la vela
        """
        if not self._running:
            return

        symbol = bucket.symbol
        interval = bucket.interval
        key = f"{symbol}_{interval}"

        # Obtener calculator para este simbolo+intervalo
        calculator = self._calculators.get(key)
        if not calculator:
            logger.warning(f"[ORDERFLOW_SERVICE] No hay calculator para {key}")
            return

        # Configurar la vela en el calculator
        calculator.set_candle(
            candle_timestamp=bucket.candle_open_time,
            symbol=symbol,
            interval=interval,
            candle_open=bucket.open_price,
            candle_high=bucket.high,
            candle_low=bucket.low if bucket.low != float('inf') else bucket.open_price,
            candle_close=bucket.close_price
        )

        # Procesar cada trade del bucket
        for trade in bucket.trades:
            calculator.process_trade(
                price=trade.price,
                volume=trade.volume,
                side=trade.side
            )

        # Obtener footprint completado
        footprint = calculator.get_footprint()
        if footprint:
            # Serializar footprint
            footprint_dict = footprint.to_dict()

            # Calcular volume z-score (rolling 20 velas)
            vol = footprint_dict.get("total_volume", 0)
            vol_buf = self._volume_buffers[key]
            if len(vol_buf) >= 2:
                mean_v = sum(vol_buf) / len(vol_buf)
                std_v = (sum((v - mean_v) ** 2 for v in vol_buf) / len(vol_buf)) ** 0.5
                footprint_dict["volume_zscore"] = round((vol - mean_v) / std_v, 2) if std_v > 0 else 0.0
            else:
                footprint_dict["volume_zscore"] = 0.0
            vol_buf.append(vol)

            # Guardar en memoria
            self._footprints[key].append(footprint_dict)
            self._footprints_completed += 1

            # Persistir a disco
            self._storage.save_footprint(footprint_dict)

            logger.info(
                f"[ORDERFLOW_SERVICE] Footprint completado: {symbol} | "
                f"time={bucket.candle_open_time} | "
                f"trades={bucket.trade_count} | "
                f"delta={footprint.total_delta:.4f} | "
                f"poc={footprint.poc_index}"
            )

            # Detectar patrones y enviar alertas
            if self.config.alerts_enabled:
                await self._check_and_send_alerts(footprint)

    async def _check_and_send_alerts(self, footprint: Footprint):
        """
        Verifica patrones en el footprint y envia alertas si corresponde.

        Args:
            footprint: Footprint completado
        """
        # Detectar stacked imbalances
        stacked = self._detect_stacked_imbalances_from_footprint(footprint)

        for pattern in stacked:
            direction = pattern.get("direction", "")
            cooldown_key = f"{footprint.symbol}_{direction}"

            # Verificar cooldown
            if self._is_in_cooldown(cooldown_key):
                logger.debug(
                    f"[ORDERFLOW_SERVICE] Alerta bloqueada por cooldown: {cooldown_key}"
                )
                continue

            # Enviar alerta
            await self._send_alert(footprint, pattern)

            # Registrar cooldown
            self._alert_cooldowns[cooldown_key] = time.time()

    def _detect_stacked_imbalances_from_footprint(self, footprint: Footprint) -> List[dict]:
        """
        Detecta stacked imbalances en un footprint.
        Usa el calculator temporal para el analisis.
        """
        # Crear calculator temporal para detectar patrones
        key = f"{footprint.symbol}_{footprint.interval}"
        calculator = self._calculators.get(key)

        if calculator and calculator._current_footprint:
            return calculator.detect_stacked_imbalances(
                min_consecutive=self.config.stacked_min_levels,
                threshold=self.config.imbalance_threshold
            )

        return []

    def _is_in_cooldown(self, cooldown_key: str) -> bool:
        """Verifica si una alerta esta en cooldown."""
        last_alert = self._alert_cooldowns.get(cooldown_key)
        if last_alert is None:
            return False

        cooldown_seconds = self.config.alert_cooldown_minutes * 60
        return (time.time() - last_alert) < cooldown_seconds

    async def _send_alert(self, footprint: Footprint, pattern: dict):
        """
        Envia una alerta al TradingBot.

        Args:
            footprint: Footprint que genero la alerta
            pattern: Patron detectado (stacked imbalance)
        """
        # Calcular precio promedio del patron
        start_price = pattern.get("start_price", 0)
        end_price = pattern.get("end_price", 0)
        avg_price = (start_price + end_price) / 2 if start_price and end_price else 0

        # Calcular confidence basado en ratio y cantidad de niveles
        levels_count = pattern.get("levels_count", 0)
        avg_ratio = pattern.get("avg_ratio", 0)
        confidence = min(95, 50 + (levels_count * 10) + (avg_ratio * 5))

        alert_payload = {
            "source": "ORDER_FLOW",
            "symbol": footprint.symbol,
            "interval": footprint.interval,
            "pattern": {
                "patternType": pattern.get("type", "STACKED_IMBALANCE"),
                "direction": pattern.get("direction", ""),
                "price": round(avg_price, 2),
                "confidence": round(confidence, 1),
                "timestamp": footprint.candle_timestamp,
                "details": {
                    "levels_count": levels_count,
                    "avg_ratio": avg_ratio,
                    "start_price": start_price,
                    "end_price": end_price
                }
            }
        }

        # Log de la alerta
        self._log_alert(footprint, pattern, alert_payload)

        # Enviar al TradingBot (puerto 5000)
        try:
            import httpx
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.post(
                    "http://localhost:5000/api/watchlist-alert",
                    json=alert_payload
                )
                if response.status_code == 200:
                    self._alerts_sent += 1
                    logger.info(
                        f"[ORDERFLOW_SERVICE] Alerta enviada: "
                        f"{footprint.symbol} {pattern.get('direction')} "
                        f"@ {avg_price:.2f}"
                    )
                else:
                    logger.warning(
                        f"[ORDERFLOW_SERVICE] Error enviando alerta: "
                        f"status={response.status_code}"
                    )
        except Exception as e:
            logger.warning(f"[ORDERFLOW_SERVICE] Error enviando alerta: {e}")

    def _log_alert(self, footprint: Footprint, pattern: dict, payload: dict):
        """Registra la alerta en archivo de log."""
        try:
            log_path = Path(__file__).parent / "logs" / "orderflow_alerts.log"
            log_path.parent.mkdir(parents=True, exist_ok=True)

            timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S")
            direction = pattern.get("direction", "")
            pattern_type = pattern.get("type", "")
            avg_price = payload["pattern"]["price"]

            log_line = (
                f"{timestamp_str} | INFO | ALERT_SENT | "
                f"{footprint.symbol} | {pattern_type} | "
                f"direction={direction} | price={avg_price}\n"
            )

            with open(log_path, 'a') as f:
                f.write(log_line)
        except Exception as e:
            logger.error(f"[ORDERFLOW_SERVICE] Error escribiendo log: {e}")

    def get_footprints(self, symbol: str, interval: str = "1",
                       limit: int = 100, since_hours: float = None) -> List[dict]:
        """
        Retorna los footprints almacenados para un simbolo.

        Busca en este orden:
        1. Memoria local
        2. Disco local (footprint_cache/)
        3. Cloud Collector (Northflank) - si los datos locales son insuficientes

        Args:
            symbol: Simbolo a consultar
            interval: Intervalo de las velas
            limit: Cantidad maxima de footprints a retornar
            since_hours: Si se especifica, solo footprints de las ultimas N horas

        Returns:
            Lista de footprints serializados
        """
        key = f"{symbol}_{interval}"
        hours_to_fetch = since_hours or 12  # Default 12 horas

        # Si no hay datos en memoria, intentar cargar desde disco
        if key not in self._footprints or len(self._footprints[key]) == 0:
            logger.info(f"[ORDERFLOW_SERVICE] No hay footprints en memoria para {key}, cargando desde disco...")
            historical = self._storage.load(symbol, interval)
            if historical:
                for fp_dict in historical:
                    self._footprints[key].append(fp_dict)
                logger.info(f"[ORDERFLOW_SERVICE] Cargados {len(historical)} footprints desde disco para {key}")

        footprints = list(self._footprints.get(key, []))

        # Filtrar por tiempo si se especifica
        if since_hours:
            cutoff_ms = int((time.time() - since_hours * 3600) * 1000)
            footprints = [fp for fp in footprints if fp.get("candle_timestamp", 0) >= cutoff_ms]

        # Si tenemos pocos footprints, intentar obtener del Cloud Collector
        # Esperamos ~60 footprints por hora en intervalo 1min
        expected_footprints = int(hours_to_fetch * 60) if interval == "1" else int(hours_to_fetch * 12)
        min_threshold = expected_footprints * 0.3  # Al menos 30% de lo esperado

        if len(footprints) < min_threshold:
            logger.info(
                f"[ORDERFLOW_SERVICE] Pocos footprints para {key} ({len(footprints)}/{expected_footprints}), "
                f"intentando cargar del Cloud Collector..."
            )
            try:
                from footprint_storage import fetch_footprints_from_cloud_sync
                cloud_footprints = fetch_footprints_from_cloud_sync(symbol, interval, hours=int(hours_to_fetch))

                if cloud_footprints:
                    # Agregar footprints del cloud que no existan localmente
                    existing_timestamps = {fp.get("candle_timestamp") for fp in self._footprints[key]}
                    added = 0

                    for fp in cloud_footprints:
                        ts = fp.get("candle_timestamp")
                        if ts and ts not in existing_timestamps:
                            self._footprints[key].append(fp)
                            self._storage.save_footprint(fp)
                            existing_timestamps.add(ts)
                            added += 1

                    if added > 0:
                        # Reordenar por timestamp
                        sorted_fps = sorted(
                            self._footprints[key],
                            key=lambda x: x.get("candle_timestamp", 0)
                        )
                        self._footprints[key] = deque(sorted_fps, maxlen=self.config.max_footprints_in_memory)

                        logger.info(f"[ORDERFLOW_SERVICE] Agregados {added} footprints del Cloud para {key}")

                        # Actualizar lista de footprints a retornar
                        footprints = list(self._footprints.get(key, []))
                        if since_hours:
                            cutoff_ms = int((time.time() - since_hours * 3600) * 1000)
                            footprints = [fp for fp in footprints if fp.get("candle_timestamp", 0) >= cutoff_ms]

            except Exception as e:
                logger.warning(f"[ORDERFLOW_SERVICE] Error obteniendo del Cloud: {e}")

        # Enriquecer footprints que no tengan imbalances/stacked_imbalances calculados
        # (footprints historicos del disco o cloud pueden no tenerlos)
        threshold = self.config.imbalance_threshold
        min_levels = self.config.stacked_min_levels
        result = footprints[-limit:]
        enriched_count = 0
        for fp in result:
            if 'imbalances' not in fp or 'stacked_imbalances' not in fp:
                levels = fp.get('levels', [])
                if levels:
                    imb, stacked = self._calculate_imbalances_from_levels(
                        levels, threshold, min_levels
                    )
                    if 'imbalances' not in fp:
                        fp['imbalances'] = imb
                    if 'stacked_imbalances' not in fp:
                        fp['stacked_imbalances'] = stacked
                    enriched_count += 1
                else:
                    if 'imbalances' not in fp:
                        fp['imbalances'] = []
                    if 'stacked_imbalances' not in fp:
                        fp['stacked_imbalances'] = []

        if enriched_count > 0:
            logger.info(
                f"[ORDERFLOW_SERVICE] Enriched {enriched_count}/{len(result)} footprints "
                f"with imbalances/stacked for {key}"
            )

        return result

    @staticmethod
    def _calculate_imbalances_from_levels(
        levels: List[dict], threshold: float = 3.0, min_consecutive: int = 3
    ) -> tuple:
        """
        Calcula imbalances y stacked imbalances a partir de los niveles de un footprint.
        Usado para enriquecer footprints historicos que no tienen estos campos.

        Returns:
            (imbalances_list, stacked_imbalances_list)
        """
        imbalances = []
        # Pass 1: detect individual imbalances
        for i, level in enumerate(levels):
            bid = level.get('bid_volume', 0) or 0
            ask = level.get('ask_volume', 0) or 0
            total = bid + ask
            if total == 0:
                continue
            min_vol = min(bid, ask)
            max_vol = max(bid, ask)
            if min_vol <= 0:
                continue  # skip infinite ratio
            ratio = max_vol / min_vol
            if ratio >= threshold:
                direction = "BUY" if ask > bid else "SELL"
                imbalances.append({
                    "level_index": i,
                    "type": direction,
                    "ratio": round(ratio, 2),
                    "price_min": level.get('price_min'),
                    "price_max": level.get('price_max'),
                    "price_mid": level.get('price_mid',
                        (level.get('price_min', 0) + level.get('price_max', 0)) / 2)
                })

        # Pass 2: detect stacked imbalances (consecutive same-direction)
        stacked = []
        current_streak = []
        current_direction = None
        imb_set = {ib['level_index']: ib for ib in imbalances}

        for i, level in enumerate(levels):
            if i in imb_set:
                direction = imb_set[i]['type']
                if direction == current_direction:
                    current_streak.append(i)
                else:
                    if len(current_streak) >= min_consecutive:
                        stacked.append(
                            OrderFlowService._build_stacked_from_levels(
                                current_streak, current_direction, levels, imb_set
                            )
                        )
                    current_streak = [i]
                    current_direction = direction
            else:
                if len(current_streak) >= min_consecutive:
                    stacked.append(
                        OrderFlowService._build_stacked_from_levels(
                            current_streak, current_direction, levels, imb_set
                        )
                    )
                current_streak = []
                current_direction = None

        if len(current_streak) >= min_consecutive:
            stacked.append(
                OrderFlowService._build_stacked_from_levels(
                    current_streak, current_direction, levels, imb_set
                )
            )

        return imbalances, stacked

    @staticmethod
    def _build_stacked_from_levels(
        streak: list, direction: str, levels: list, imb_set: dict
    ) -> dict:
        """Construye dict de stacked imbalance desde niveles ya calculados."""
        ratios = [imb_set[i]['ratio'] for i in streak if i in imb_set]
        avg_ratio = sum(ratios) / len(ratios) if ratios else 0
        start_price = levels[streak[0]].get('price_min', 0)
        end_price = levels[streak[-1]].get('price_max', 0)
        return {
            "type": "STACKED_IMBALANCE",
            "direction": direction,
            "levels": streak.copy(),
            "levels_count": len(streak),
            "start_price": start_price,
            "end_price": end_price,
            "mid_price": round((start_price + end_price) / 2, 4),
            "avg_ratio": round(avg_ratio, 2)
        }

    def get_status(self) -> dict:
        """Retorna el estado del servicio."""
        uptime = time.time() - self._start_time if self._start_time else 0

        return {
            "status": "ok" if self._running else "stopped",
            "service": "orderflow",
            "enabled": self.config.enabled,
            "running": self._running,
            "symbols": self.config.symbols,
            "intervals": self.config.intervals,
            "websocket_connected": self._ws_manager.is_connected() if self._ws_manager else False,
            "trades_received": self._trades_received,
            "footprints_completed": self._footprints_completed,
            "footprints_in_memory": sum(len(fp) for fp in self._footprints.values()),
            "alerts_sent": self._alerts_sent,
            "uptime_seconds": round(uptime, 2),
            "max_history_hours": self.config.max_history_hours,
            "storage": self._storage.get_stats() if self._storage else None,
            "config": self.config.to_dict()
        }

    def get_config(self) -> dict:
        """Retorna la configuracion actual."""
        return self.config.to_dict()

    def clear_cooldowns(self):
        """Limpia todos los cooldowns (util para testing)."""
        self._alert_cooldowns.clear()
        logger.info("[ORDERFLOW_SERVICE] Cooldowns limpiados")


# Funcion de conveniencia para obtener la instancia
def get_orderflow_service() -> OrderFlowService:
    """Retorna la instancia singleton del servicio Order Flow."""
    return OrderFlowService.get_instance()
