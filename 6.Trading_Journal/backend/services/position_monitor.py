"""
Trading Journal - Position Monitor Service
Monitorea posiciones en el TradingBot y crea/cierra entries automáticamente.
"""

import asyncio
import logging
from typing import Dict, List, Optional, Set
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


@dataclass
class PositionSnapshot:
    """Snapshot de una posición"""
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
        return cls(
            symbol=data.get('symbol', ''),
            side=data.get('side', ''),
            size=float(data.get('size', 0)),
            entry_price=float(data.get('entryPrice', 0)),
            mark_price=float(data.get('markPrice', 0)),
            unrealized_pnl=float(data.get('unrealizedPnl', 0)),
            stop_loss=float(data.get('stopLoss')) if data.get('stopLoss') else None,
            take_profit=float(data.get('takeProfit')) if data.get('takeProfit') else None,
            created_time=data.get('createdTime'),
            updated_time=data.get('updatedTime')
        )


class PositionMonitor:
    """
    Servicio que monitorea posiciones del TradingBot.

    Flujo:
    1. Polling cada N segundos a GET /api/positions del TradingBot
    2. Compara con estado anterior para detectar cambios
    3. Nueva posición → Crea JournalEntry + solicita screenshot de entrada
    4. Posición cerrada → Finaliza JournalEntry + solicita screenshot de salida
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
        self.screenshot_callback = screenshot_callback  # async def callback(symbol, event_type)

        # Estado interno
        self._running = False
        self._task: Optional[asyncio.Task] = None
        self._previous_positions: Dict[str, PositionSnapshot] = {}
        self._tracked_entries: Dict[str, str] = {}  # symbol -> journal_entry_id
        self._http_client: Optional[httpx.AsyncClient] = None

        # Configuración
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
            logger.info(f"Loaded {len(open_entries)} existing open entries from database")
        except Exception as e:
            logger.error(f"Failed to load open entries from database: {e}")

        # Iniciar loop de polling - la sincronización inicial se hará en el primer ciclo
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
            if current_positions:
                self._previous_positions = current_positions
                logger.info(f"Synced {len(current_positions)} positions from TradingBot")

                # Crear entries para posiciones que no tenemos tracking
                for symbol, position in current_positions.items():
                    if symbol not in self._tracked_entries:
                        logger.info(f"Found untracked position: {symbol}, creating entry...")
                        await self._handle_new_position(position)
            else:
                logger.info("No positions found in TradingBot (or bot not running)")
        except Exception as e:
            logger.error(f"Failed to sync with TradingBot: {e}")

    async def _poll_loop(self):
        """Loop principal de polling"""
        # Sincronización inicial en el primer ciclo
        first_run = True

        while self._running:
            try:
                if first_run:
                    # Primera ejecución: sincronizar con TradingBot
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
                return  # Error de conexión, skip este ciclo

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

            # Actualizar estado
            self._previous_positions = current_positions

        except Exception as e:
            logger.error(f"Error checking positions: {e}")

    async def _fetch_positions(self) -> Optional[Dict[str, PositionSnapshot]]:
        """Obtiene posiciones del TradingBot usando requests (más confiable en Windows)"""
        import requests
        try:
            # Usar requests con timeout más largo para Bybit API
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

            if positions:
                logger.info(f"Fetched {len(positions)} positions from TradingBot")
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
        """Maneja una nueva posición detectada"""
        logger.info(f"New position detected: {position.symbol} {position.side} @ {position.entry_price}")

        try:
            # Buscar alerta reciente que matchee
            source, source_alert_id, pattern_type = await self._find_matching_alert(
                position.symbol,
                position.side
            )

            # Determinar dirección
            direction = TradeDirection.LONG if position.side.upper() == "BUY" else TradeDirection.SHORT

            # Crear setup con información disponible
            setup = TradeSetup(
                entry_price=position.entry_price,
                stop_loss=position.stop_loss or 0,
                take_profit=position.take_profit or 0,
                position_size=position.size,
                position_size_usd=position.size * position.entry_price
            )

            # Calcular RR si tenemos SL y TP
            if setup.stop_loss and setup.take_profit:
                setup.risk_reward_ratio = setup.calculate_rr()
                # Calcular risk amount
                risk_per_unit = abs(setup.entry_price - setup.stop_loss)
                setup.risk_amount_usd = risk_per_unit * position.size

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

            logger.info(f"Created journal entry {created.id} for {position.symbol}")

            # Solicitar screenshot de entrada
            if self.screenshot_callback:
                try:
                    screenshot_path = await self.screenshot_callback(
                        symbol=position.symbol,
                        event_type="entry",
                        entry_id=created.id
                    )
                    if screenshot_path:
                        created.screenshot_entry = screenshot_path
                        self.store.update(created)
                        logger.info(f"Entry screenshot saved: {screenshot_path}")
                except Exception as e:
                    logger.error(f"Failed to capture entry screenshot: {e}")

        except Exception as e:
            logger.error(f"Error handling new position: {e}")

    async def _handle_closed_position(self, symbol: str):
        """Maneja una posición cerrada"""
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
                return

            # Obtener detalles del cierre desde Bybit (via TradingBot)
            close_details = await self._fetch_position_close_details(symbol)

            if close_details:
                exit_price = float(close_details.get('exitPrice', 0) or 0)
                pnl_usd = float(close_details.get('closedPnl', 0) or 0)

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
                # Usar último mark_price conocido
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
                        entry.screenshot_exit = screenshot_path
                        self.store.update(entry)
                        logger.info(f"Exit screenshot saved: {screenshot_path}")
                except Exception as e:
                    logger.error(f"Failed to capture exit screenshot: {e}")

            # Limpiar tracking
            del self._tracked_entries[symbol]

            logger.info(f"Closed journal entry {entry.id}: PnL ${pnl_usd:.2f} ({entry.pnl_percent:.2f}%)")

        except Exception as e:
            logger.error(f"Error handling closed position: {e}")

    async def _find_matching_alert(
        self,
        symbol: str,
        side: str
    ) -> tuple[TradeSource, Optional[str], Optional[str]]:
        """Busca una alerta reciente que matchee con la posición"""
        try:
            response = await self._http_client.get(
                f"{self.trading_bot_url}/api/alerts/recent",
                params={"minutes": self.alert_lookback_minutes}
            )

            if response.status_code != 200:
                return TradeSource.MANUAL, None, None

            data = response.json()
            alerts = data.get('alerts', [])

            # Buscar match por symbol y side
            for alert in alerts:
                if alert.get('symbol') == symbol and alert.get('side') == side:
                    # Determinar source
                    source_str = alert.get('source', '').lower()

                    if 'swing' in source_str:
                        source = TradeSource.ANALIZADOR
                    elif 'watchlist' in source_str:
                        source = TradeSource.WATCHLIST
                    elif 'order_flow' in source_str or 'orderflow' in source_str:
                        source = TradeSource.ORDER_FLOW
                    else:
                        source = TradeSource.UNKNOWN

                    pattern_type = alert.get('pattern', '')

                    logger.info(f"Matched alert: source={source.value}, pattern={pattern_type}")
                    return source, alert.get('timestamp'), pattern_type

            # No match encontrado
            return TradeSource.MANUAL, None, None

        except Exception as e:
            logger.error(f"Error finding matching alert: {e}")
            return TradeSource.MANUAL, None, None

    async def _fetch_position_close_details(self, symbol: str) -> Optional[Dict]:
        """Obtiene detalles del cierre de posición desde Bybit"""
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

    def get_status(self) -> Dict:
        """Retorna estado actual del monitor"""
        return {
            "running": self._running,
            "poll_interval": self.poll_interval,
            "tracked_positions": len(self._tracked_entries),
            "tracked_symbols": list(self._tracked_entries.keys()),
            "trading_bot_url": self.trading_bot_url
        }

    async def force_sync(self):
        """Fuerza una sincronización inmediata"""
        logger.info("Force sync requested")
        await self._check_positions()
