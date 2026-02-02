"""
Trading Journal - Position Monitor Service
Monitorea posiciones en el TradingBot y crea/cierra entries automaticamente.

Mejoras v2.0 (Febrero 2026):
- Captura robusta de SL/TP desde TradingBot
- Calculo de R-Multiple incluso sin SL (usa DEFAULT_RISK_PERCENT)
- Normalizacion de rutas de screenshots (Windows -> Unix)
- Mejor matching de source para alertas
- Deteccion de cambios de direccion en posiciones
- Reconciliacion de entries huerfanas
"""

import asyncio
import logging
from typing import Dict, List, Optional, Set, Tuple
from datetime import datetime
from dataclasses import dataclass
import httpx

from models.journal_entry import (
    JournalEntry,
    TradeSource,
    TradeDirection,
    TradeStatus,
    TradeSetup,
    MarketContext
)
from store.journal_store import JournalStore

logger = logging.getLogger(__name__)

# Riesgo por defecto cuando no hay SL definido (2% del position_size_usd)
DEFAULT_RISK_PERCENT = 2.0


@dataclass
class PositionSnapshot:
    """Snapshot de una posicion"""
    symbol: str
    side: str
    size: float
    entry_price: float
    mark_price: float
    unrealized_pnl: float
    stop_loss: Optional[float]
    take_profit: Optional[float]
    created_time: Optional[str]
    updated_time: Optional[str]

    @classmethod
    def from_api_response(cls, data: Dict) -> 'PositionSnapshot':
        """Parsea respuesta del TradingBot con manejo robusto de SL/TP"""
        # Parseo robusto de SL - puede venir como string, float, None, 0, "0"
        sl_raw = data.get('stopLoss') or data.get('stop_loss') or data.get('sl')
        sl_value = None
        if sl_raw is not None:
            try:
                sl_float = float(sl_raw)
                if sl_float > 0:
                    sl_value = sl_float
            except (ValueError, TypeError):
                pass

        # Parseo robusto de TP - puede venir como string, float, None, 0, "0"
        tp_raw = data.get('takeProfit') or data.get('take_profit') or data.get('tp')
        tp_value = None
        if tp_raw is not None:
            try:
                tp_float = float(tp_raw)
                if tp_float > 0:
                    tp_value = tp_float
            except (ValueError, TypeError):
                pass

        return cls(
            symbol=data.get('symbol', ''),
            side=data.get('side', ''),
            size=float(data.get('size', 0)),
            entry_price=float(data.get('entryPrice') or data.get('entry_price', 0)),
            mark_price=float(data.get('markPrice') or data.get('mark_price', 0)),
            unrealized_pnl=float(data.get('unrealizedPnl') or data.get('unrealized_pnl', 0)),
            stop_loss=sl_value,
            take_profit=tp_value,
            created_time=data.get('createdTime') or data.get('created_time'),
            updated_time=data.get('updatedTime') or data.get('updated_time')
        )

    def get_direction(self) -> TradeDirection:
        """Retorna la direccion del trade basada en side"""
        return TradeDirection.LONG if self.side.upper() in ("BUY", "LONG") else TradeDirection.SHORT


class PositionMonitor:
    """
    Servicio que monitorea posiciones del TradingBot.

    Flujo:
    1. Polling cada N segundos a GET /api/positions del TradingBot
    2. Compara con estado anterior para detectar cambios
    3. Nueva posicion -> Crea JournalEntry + solicita screenshot de entrada
    4. Posicion cerrada -> Finaliza JournalEntry + solicita screenshot de salida
    5. Cambio de direccion -> Cierra entry anterior, crea nueva
    """

    def __init__(
        self,
        store: JournalStore,
        trading_bot_url: str = "http://localhost:5000",
        poll_interval: float = 5.0,
        screenshot_callback=None
    ):
        self.store = store
        self.trading_bot_url = trading_bot_url
        self.poll_interval = poll_interval
        self.screenshot_callback = screenshot_callback  # async def callback(symbol, event_type, entry_id)

        # Estado interno
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._previous_positions: Dict[str, PositionSnapshot] = {}
        self._tracked_entries: Dict[str, str] = {}  # symbol -> journal_entry_id
        self._tracked_directions: Dict[str, TradeDirection] = {}  # symbol -> direction
        self._http_client: Optional[httpx.AsyncClient] = None
        self._trading_bot_connected = False

        # Configuracion
        self.alert_lookback_minutes = 30  # Minutos para buscar alertas que matcheen

    async def start(self):
        """Inicia el monitor"""
        if self._running:
            logger.warning("Position monitor already running")
            return

        self._running = True
        self._http_client = httpx.AsyncClient(timeout=10.0)

        # Cargar entries abiertas existentes del store local (esto no bloquea)
        try:
            open_entries = self.store.get_open_entries()
            for entry in open_entries:
                self._tracked_entries[entry.symbol] = entry.id
                self._tracked_directions[entry.symbol] = entry.direction
            logger.info(f"Loaded {len(open_entries)} existing open entries from database")
        except Exception as e:
            logger.error(f"Failed to load open entries from database: {e}")

        # Iniciar loop de polling - la sincronizacion inicial se hara en el primer ciclo
        self._task = asyncio.create_task(self._poll_loop())
        logger.info(f"Position monitor started (interval: {self.poll_interval}s)")

    async def stop(self):
        """Detiene el monitor"""
        self._running = False

        if self._task:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

        if self._http_client:
            await self._http_client.aclose()
            self._http_client = None

        logger.info("Position monitor stopped")

    async def _sync_with_trading_bot(self):
        """Sincroniza con posiciones actuales del TradingBot (llamado en primer ciclo)"""
        try:
            current_positions = await self._fetch_positions()
            if current_positions is not None:
                self._trading_bot_connected = True
                self._previous_positions = current_positions
                logger.info(f"Synced {len(current_positions)} positions from TradingBot")

                # Crear entries para posiciones que no tenemos tracking
                for symbol, position in current_positions.items():
                    if symbol not in self._tracked_entries:
                        logger.info(f"Found untracked position: {symbol}, creating entry...")
                        await self._handle_new_position(position)
            else:
                self._trading_bot_connected = False
                logger.info("No positions found in TradingBot (or bot not running)")
        except Exception as e:
            self._trading_bot_connected = False
            logger.error(f"Failed to sync with TradingBot: {e}")

    async def _poll_loop(self):
        """Loop principal de polling"""
        # Sincronizacion inicial en el primer ciclo
        first_run = True

        while self._running:
            try:
                if first_run:
                    # Primera ejecucion: sincronizar con TradingBot
                    await self._sync_with_trading_bot()
                    first_run = False
                else:
                    # Ciclos siguientes: detectar cambios
                    await self._check_positions()
            except Exception as e:
                logger.error(f"Error in poll loop: {e}")

            await asyncio.sleep(self.poll_interval)

    async def _check_positions(self):
        """Verifica posiciones y detecta cambios"""
        try:
            # Obtener posiciones actuales del TradingBot
            current_positions = await self._fetch_positions()

            if current_positions is None:
                self._trading_bot_connected = False
                return  # Error de conexion, skip este ciclo

            self._trading_bot_connected = True
            current_symbols = set(current_positions.keys())
            previous_symbols = set(self._previous_positions.keys())

            # Detectar nuevas posiciones
            new_positions = current_symbols - previous_symbols
            for symbol in new_positions:
                await self._handle_new_position(current_positions[symbol])

            # Detectar posiciones cerradas
            closed_positions = previous_symbols - current_symbols
            for symbol in closed_positions:
                await self._handle_closed_position(symbol)

            # Detectar cambios de direccion (posicion existente cambio de LONG a SHORT o viceversa)
            for symbol in current_symbols & previous_symbols:
                current_pos = current_positions[symbol]
                prev_pos = self._previous_positions[symbol]
                current_dir = current_pos.get_direction()
                prev_dir = prev_pos.get_direction()

                if current_dir != prev_dir:
                    logger.info(f"Direction change detected for {symbol}: {prev_dir.value} -> {current_dir.value}")
                    await self._handle_direction_change(symbol, prev_pos, current_pos)

            # Actualizar estado
            self._previous_positions = current_positions

        except Exception as e:
            logger.error(f"Error checking positions: {e}")

    async def _fetch_positions(self) -> Optional[Dict[str, PositionSnapshot]]:
        """Obtiene posiciones del TradingBot usando requests (mas confiable en Windows)"""
        import requests
        try:
            # Usar requests con timeout mas largo para Bybit API
            response = requests.get(
                f"{self.trading_bot_url}/api/positions",
                timeout=(5, 30)  # (connect_timeout, read_timeout) - Bybit puede tardar
            )

            if response.status_code != 200:
                logger.warning(f"TradingBot returned status {response.status_code}")
                return None

            data = response.json()

            if not data.get('success'):
                logger.warning(f"TradingBot error: {data.get('error')}")
                return None

            positions = {}
            for pos_data in data.get('positions', []):
                snapshot = PositionSnapshot.from_api_response(pos_data)
                positions[snapshot.symbol] = snapshot

                # Log detallado de SL/TP capturados
                if snapshot.stop_loss or snapshot.take_profit:
                    logger.debug(f"Position {snapshot.symbol}: SL={snapshot.stop_loss}, TP={snapshot.take_profit}")

            if positions:
                logger.debug(f"Fetched {len(positions)} positions from TradingBot")
            return positions

        except requests.exceptions.ConnectTimeout:
            logger.debug("TradingBot connection timeout - bot may not be running")
            return None
        except requests.exceptions.ReadTimeout:
            logger.warning("TradingBot read timeout")
            return None
        except requests.exceptions.ConnectionError:
            logger.debug("TradingBot not reachable - bot may not be running")
            return None
        except Exception as e:
            logger.error(f"Error fetching positions: {type(e).__name__}: {e}")
            return None

    async def _handle_new_position(self, position: PositionSnapshot):
        """Maneja una nueva posicion detectada"""
        logger.info(f"New position detected: {position.symbol} {position.side} @ {position.entry_price}")
        logger.info(f"  SL: {position.stop_loss}, TP: {position.take_profit}")

        try:
            # Buscar alerta reciente que matchee
            source, source_alert_id, pattern_type = await self._find_matching_alert(
                position.symbol,
                position.side
            )

            # Determinar direccion
            direction = position.get_direction()

            # Calcular position_size_usd
            position_size_usd = position.size * position.entry_price

            # Crear setup con informacion disponible
            setup = TradeSetup(
                entry_price=position.entry_price,
                stop_loss=position.stop_loss or 0,
                take_profit=position.take_profit or 0,
                position_size=position.size,
                position_size_usd=position_size_usd
            )

            # Calcular risk_amount_usd
            if position.stop_loss and position.stop_loss > 0:
                # Tenemos SL real - calcular riesgo exacto
                risk_per_unit = abs(position.entry_price - position.stop_loss)
                setup.risk_amount_usd = risk_per_unit * position.size
                logger.info(f"  Risk calculated from SL: ${setup.risk_amount_usd:.2f}")
            else:
                # Sin SL - usar riesgo por defecto (2% del position size)
                setup.risk_amount_usd = position_size_usd * (DEFAULT_RISK_PERCENT / 100)
                logger.info(f"  Risk estimated (no SL): ${setup.risk_amount_usd:.2f} ({DEFAULT_RISK_PERCENT}% of position)")

            # Calcular RR si tenemos SL y TP
            if setup.stop_loss > 0 and setup.take_profit > 0:
                setup.risk_reward_ratio = setup.calculate_rr()
                logger.info(f"  R:R ratio: {setup.risk_reward_ratio:.2f}")

            # Crear entry
            entry = JournalEntry(
                symbol=position.symbol,
                direction=direction,
                status=TradeStatus.OPEN,
                source=source,
                source_alert_id=source_alert_id,
                entry_time=position.created_time or datetime.utcnow().isoformat(),
                entry_price=position.entry_price,
                setup=setup
            )

            # Guardar en store
            created = self.store.create(entry)
            self._tracked_entries[position.symbol] = created.id
            self._tracked_directions[position.symbol] = direction

            logger.info(f"Created journal entry {created.id} for {position.symbol} (source: {source.value})")

            # Solicitar screenshot de entrada
            if self.screenshot_callback:
                try:
                    screenshot_path = await self.screenshot_callback(
                        symbol=position.symbol,
                        event_type="entry",
                        entry_id=created.id
                    )
                    if screenshot_path:
                        # Normalizar ruta (Windows backslash -> forward slash)
                        screenshot_path = screenshot_path.replace('\\', '/')
                        created.screenshot_entry = screenshot_path
                        self.store.update(created)
                        logger.info(f"Entry screenshot saved: {screenshot_path}")
                except Exception as e:
                    logger.error(f"Failed to capture entry screenshot: {e}")

        except Exception as e:
            logger.error(f"Error handling new position: {e}")
            import traceback
            logger.error(traceback.format_exc())

    async def _handle_closed_position(self, symbol: str):
        """Maneja una posicion cerrada"""
        logger.info(f"Position closed: {symbol}")

        try:
            # Obtener entry_id trackeado
            entry_id = self._tracked_entries.get(symbol)
            if not entry_id:
                logger.warning(f"No tracked entry for closed position {symbol}")
                return

            # Cargar entry
            entry = self.store.get(entry_id)
            if not entry:
                logger.warning(f"Entry {entry_id} not found in store")
                del self._tracked_entries[symbol]
                if symbol in self._tracked_directions:
                    del self._tracked_directions[symbol]
                return

            # Obtener detalles del cierre desde Bybit (via TradingBot)
            close_details = await self._fetch_position_close_details(symbol)

            if close_details:
                exit_price = float(close_details.get('exitPrice') or close_details.get('exit_price', 0) or 0)
                pnl_usd = float(close_details.get('closedPnl') or close_details.get('closed_pnl', 0) or 0)

                # Determinar status basado en PnL y SL/TP
                tp = float(entry.setup.take_profit or 0)
                sl = float(entry.setup.stop_loss or 0)
                if tp > 0 and abs(exit_price - tp) < (exit_price * 0.001):
                    status = TradeStatus.CLOSED_TP
                elif sl > 0 and abs(exit_price - sl) < (exit_price * 0.001):
                    status = TradeStatus.CLOSED_SL
                else:
                    status = TradeStatus.CLOSED_MANUAL
            else:
                # Usar ultimo mark_price conocido
                prev_pos = self._previous_positions.get(symbol)
                exit_price = float(prev_pos.mark_price) if prev_pos else float(entry.entry_price)
                pnl_usd = float(prev_pos.unrealized_pnl) if prev_pos else 0.0
                status = TradeStatus.CLOSED_MANUAL

            # Finalizar entry
            entry.finalize(
                exit_price=exit_price,
                exit_time=datetime.utcnow().isoformat(),
                status=status,
                pnl_usd=float(pnl_usd)
            )

            # Calcular R-Multiple
            if entry.setup.risk_amount_usd and entry.setup.risk_amount_usd > 0:
                entry.r_multiple = pnl_usd / entry.setup.risk_amount_usd
                logger.info(f"R-Multiple calculated: {entry.r_multiple:.2f}R")

            # Guardar
            self.store.update(entry)

            # Solicitar screenshot de salida
            if self.screenshot_callback:
                try:
                    screenshot_path = await self.screenshot_callback(
                        symbol=symbol,
                        event_type="exit",
                        entry_id=entry.id
                    )
                    if screenshot_path:
                        # Normalizar ruta (Windows backslash -> forward slash)
                        screenshot_path = screenshot_path.replace('\\', '/')
                        entry.screenshot_exit = screenshot_path
                        self.store.update(entry)
                        logger.info(f"Exit screenshot saved: {screenshot_path}")
                except Exception as e:
                    logger.error(f"Failed to capture exit screenshot: {e}")

            # Limpiar tracking
            del self._tracked_entries[symbol]
            if symbol in self._tracked_directions:
                del self._tracked_directions[symbol]

            logger.info(f"Closed journal entry {entry.id}: PnL ${pnl_usd:.2f} ({entry.pnl_percent:.2f}%) [{entry.r_multiple:.2f}R]")

        except Exception as e:
            logger.error(f"Error handling closed position: {e}")
            import traceback
            logger.error(traceback.format_exc())

    async def _handle_direction_change(self, symbol: str, prev_pos: PositionSnapshot, new_pos: PositionSnapshot):
        """Maneja un cambio de direccion (ej: LONG cerrado y SHORT abierto)"""
        # Primero cerrar la posicion anterior
        await self._handle_closed_position(symbol)

        # Luego crear nueva entry para la nueva direccion
        await self._handle_new_position(new_pos)

    async def _find_matching_alert(
        self,
        symbol: str,
        side: str
    ) -> Tuple[TradeSource, Optional[str], Optional[str]]:
        """Busca una alerta reciente que matchee con la posicion"""
        try:
            response = await self._http_client.get(
                f"{self.trading_bot_url}/api/alerts/recent",
                params={"minutes": self.alert_lookback_minutes}
            )

            if response.status_code != 200:
                logger.debug(f"Alert lookup failed with status {response.status_code}")
                return TradeSource.MANUAL, None, None

            data = response.json()
            alerts = data.get('alerts', [])

            # Normalizar side para comparacion
            side_normalized = side.upper()
            if side_normalized == "BUY":
                side_normalized = "LONG"
            elif side_normalized == "SELL":
                side_normalized = "SHORT"

            # Buscar match por symbol y side
            for alert in alerts:
                alert_symbol = alert.get('symbol', '')
                alert_side = alert.get('side', '').upper()

                # Normalizar alert side
                if alert_side == "BUY":
                    alert_side = "LONG"
                elif alert_side == "SELL":
                    alert_side = "SHORT"

                if alert_symbol == symbol and alert_side == side_normalized:
                    # Determinar source con matching mejorado
                    source_str = alert.get('source', '').lower()

                    if 'swing' in source_str or 'swing_detector' in source_str:
                        source = TradeSource.ANALIZADOR
                    elif 'watchlist' in source_str or 'backend_realtime' in source_str:
                        source = TradeSource.WATCHLIST
                    elif 'order_flow' in source_str or 'orderflow' in source_str or 'footprint' in source_str:
                        source = TradeSource.ORDER_FLOW
                    elif 'backtester' in source_str or 'backtest' in source_str:
                        source = TradeSource.BACKTESTER
                    elif 'manual' in source_str:
                        source = TradeSource.MANUAL
                    else:
                        # Default a ANALIZADOR si viene de un sistema automatico
                        source = TradeSource.ANALIZADOR if source_str else TradeSource.MANUAL

                    pattern_type = alert.get('pattern', '') or alert.get('patternType', '')

                    logger.info(f"Matched alert: source={source.value}, pattern={pattern_type}, raw_source={source_str}")
                    return source, alert.get('timestamp'), pattern_type

            # No match encontrado
            logger.debug(f"No matching alert found for {symbol} {side}")
            return TradeSource.MANUAL, None, None

        except Exception as e:
            logger.error(f"Error finding matching alert: {e}")
            return TradeSource.MANUAL, None, None

    async def _fetch_position_close_details(self, symbol: str) -> Optional[Dict]:
        """Obtiene detalles del cierre de posicion desde Bybit"""
        try:
            response = await self._http_client.get(
                f"{self.trading_bot_url}/api/position-history/{symbol}",
                params={"limit": 1}
            )

            if response.status_code != 200:
                return None

            data = response.json()
            history = data.get('history', [])

            if history:
                return history[0]

            return None

        except Exception as e:
            logger.error(f"Error fetching close details: {e}")
            return None

    async def reconcile(self) -> Dict:
        """
        Reconcilia entries huerfanas:
        - Cierra entries OPEN que no tienen posicion activa en TradingBot
        - Crea entries para posiciones sin tracking

        Retorna resumen de acciones tomadas.
        """
        logger.info("Starting reconciliation...")
        result = {
            "orphan_entries_closed": 0,
            "untracked_positions_created": 0,
            "errors": []
        }

        try:
            # Obtener posiciones actuales
            current_positions = await self._fetch_positions()
            if current_positions is None:
                result["errors"].append("Could not fetch positions from TradingBot")
                return result

            current_symbols = set(current_positions.keys())

            # Obtener entries abiertas del store
            open_entries = self.store.get_open_entries()

            # Cerrar entries huerfanas (OPEN pero sin posicion activa)
            for entry in open_entries:
                if entry.symbol not in current_symbols:
                    logger.info(f"Closing orphan entry {entry.id} for {entry.symbol}")
                    try:
                        entry.status = TradeStatus.CLOSED_MANUAL
                        entry.exit_time = datetime.utcnow().isoformat()
                        entry.exit_price = entry.entry_price  # Sin datos reales
                        entry.pnl_usd = 0.0
                        entry.pnl_percent = 0.0
                        self.store.update(entry)

                        if entry.symbol in self._tracked_entries:
                            del self._tracked_entries[entry.symbol]
                        if entry.symbol in self._tracked_directions:
                            del self._tracked_directions[entry.symbol]

                        result["orphan_entries_closed"] += 1
                    except Exception as e:
                        result["errors"].append(f"Failed to close {entry.id}: {str(e)}")

            # Crear entries para posiciones sin tracking
            tracked_symbols = set(self._tracked_entries.keys())
            for symbol in current_symbols - tracked_symbols:
                logger.info(f"Creating entry for untracked position: {symbol}")
                try:
                    await self._handle_new_position(current_positions[symbol])
                    result["untracked_positions_created"] += 1
                except Exception as e:
                    result["errors"].append(f"Failed to create entry for {symbol}: {str(e)}")

            logger.info(f"Reconciliation complete: {result}")
            return result

        except Exception as e:
            logger.error(f"Error during reconciliation: {e}")
            result["errors"].append(str(e))
            return result

    def get_status(self) -> Dict:
        """Retorna estado actual del monitor"""
        return {
            "running": self._running,
            "poll_interval": self.poll_interval,
            "tracked_positions": len(self._tracked_entries),
            "tracked_symbols": list(self._tracked_entries.keys()),
            "tracked_directions": {k: v.value for k, v in self._tracked_directions.items()},
            "trading_bot_url": self.trading_bot_url,
            "trading_bot_connected": self._trading_bot_connected
        }

    async def force_sync(self):
        """Fuerza una sincronizacion inmediata"""
        logger.info("Force sync requested")
        await self._check_positions()
