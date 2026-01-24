# trade_aggregator.py - Acumula trades por vela para Order Flow
#
# Este modulo agrupa los trades recibidos del WebSocket en "buckets"
# correspondientes a cada vela (segun su timestamp de apertura).
# Cuando una vela se cierra, notifica a los listeners con todos los
# trades acumulados para esa vela.

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Dict, List, Callable, Optional, Any
from collections import defaultdict

logger = logging.getLogger(__name__)


@dataclass
class Trade:
    """Representa un trade individual recibido del WebSocket."""
    timestamp: int      # Timestamp del trade en ms
    symbol: str         # Ej: "BTCUSDT"
    side: str           # "Buy" o "Sell"
    price: float        # Precio de ejecucion
    volume: float       # Cantidad ejecutada
    trade_id: str       # ID unico del trade


@dataclass
class CandleBucket:
    """
    Contenedor de trades para una vela especifica.
    Agrupa todos los trades que ocurrieron dentro del timeframe de la vela.
    """
    candle_open_time: int           # Timestamp de apertura de la vela (ms)
    symbol: str
    interval: str                   # "1" o "5" (minutos)
    trades: List[Trade] = field(default_factory=list)

    # OHLC de los trades (para crear niveles)
    high: float = 0.0
    low: float = float('inf')
    open_price: float = 0.0
    close_price: float = 0.0

    def add_trade(self, trade: Trade):
        """Agrega un trade al bucket y actualiza OHLC."""
        self.trades.append(trade)

        # Actualizar OHLC basado en los trades
        if len(self.trades) == 1:
            self.open_price = trade.price

        self.close_price = trade.price

        if trade.price > self.high:
            self.high = trade.price
        if trade.price < self.low:
            self.low = trade.price

    @property
    def total_volume(self) -> float:
        return sum(t.volume for t in self.trades)

    @property
    def trade_count(self) -> int:
        return len(self.trades)

    def to_dict(self) -> dict:
        """Serializa el bucket para envio o logging."""
        return {
            "candle_open_time": self.candle_open_time,
            "symbol": self.symbol,
            "interval": self.interval,
            "high": self.high,
            "low": self.low if self.low != float('inf') else 0.0,
            "open": self.open_price,
            "close": self.close_price,
            "total_volume": self.total_volume,
            "trade_count": self.trade_count
        }


class TradeAggregator:
    """
    Agrega trades por vela (candle bucket) y notifica cuando una vela se cierra.

    Flujo:
    1. Recibe trades del WebSocket via add_trade()
    2. Los agrupa en buckets segun candle_open_time
    3. Cuando detecta un nuevo candle_open_time, cierra el bucket anterior
    4. Notifica a los listeners con el bucket cerrado

    Uso:
        aggregator = TradeAggregator(interval="1")
        aggregator.on_candle_complete = my_callback
        aggregator.add_trade(trade)  # Llamado desde WebSocket
    """

    def __init__(self, interval: str = "1"):
        """
        Args:
            interval: Timeframe de las velas ("1" = 1 min, "5" = 5 min)
        """
        self.interval = interval
        self._interval_ms = self._parse_interval_ms(interval)

        # Buckets activos por simbolo
        # {symbol: CandleBucket}
        self._active_buckets: Dict[str, CandleBucket] = {}

        # Callback cuando una vela se completa
        # Signature: async def on_candle_complete(bucket: CandleBucket)
        self._on_candle_complete: Optional[Callable[[CandleBucket], Any]] = None

        # Stats
        self._trades_processed = 0
        self._candles_completed = 0
        self._start_time = time.time()

        logger.info(f"[AGGREGATOR] Inicializado con interval={interval} ({self._interval_ms}ms)")

    def _parse_interval_ms(self, interval: str) -> int:
        """Convierte interval string a milisegundos."""
        interval_map = {
            "1": 60 * 1000,         # 1 minuto
            "3": 3 * 60 * 1000,     # 3 minutos
            "5": 5 * 60 * 1000,     # 5 minutos
            "15": 15 * 60 * 1000,   # 15 minutos
            "30": 30 * 60 * 1000,   # 30 minutos
            "60": 60 * 60 * 1000,   # 1 hora
            "240": 240 * 60 * 1000, # 4 horas
            "D": 24 * 60 * 60 * 1000,  # 1 dia
        }
        return interval_map.get(interval, 60 * 1000)

    def _get_candle_open_time(self, trade_timestamp: int) -> int:
        """
        Calcula el timestamp de apertura de la vela para un trade dado.

        Ejemplo con interval=1 (1 minuto):
        - Trade timestamp: 1672304486865 (10:21:26.865)
        - Candle open time: 1672304460000 (10:21:00.000)
        """
        return (trade_timestamp // self._interval_ms) * self._interval_ms

    @property
    def on_candle_complete(self) -> Optional[Callable]:
        return self._on_candle_complete

    @on_candle_complete.setter
    def on_candle_complete(self, callback: Callable):
        self._on_candle_complete = callback

    async def add_trade(self, trade: Trade):
        """
        Agrega un trade al bucket correspondiente.
        Si el trade pertenece a una nueva vela, cierra la anterior primero.

        Args:
            trade: Trade recibido del WebSocket
        """
        symbol = trade.symbol
        candle_open_time = self._get_candle_open_time(trade.timestamp)

        # Verificar si existe un bucket activo para este simbolo
        if symbol in self._active_buckets:
            active_bucket = self._active_buckets[symbol]

            # Si el trade pertenece a una nueva vela, cerrar la anterior
            if candle_open_time > active_bucket.candle_open_time:
                await self._close_bucket(symbol)

        # Crear nuevo bucket si no existe
        if symbol not in self._active_buckets:
            self._active_buckets[symbol] = CandleBucket(
                candle_open_time=candle_open_time,
                symbol=symbol,
                interval=self.interval
            )

        # Agregar trade al bucket
        self._active_buckets[symbol].add_trade(trade)
        self._trades_processed += 1

    async def _close_bucket(self, symbol: str):
        """
        Cierra el bucket activo para un simbolo y notifica a los listeners.
        """
        if symbol not in self._active_buckets:
            return

        bucket = self._active_buckets.pop(symbol)

        # Solo notificar si hay trades
        if bucket.trade_count > 0:
            self._candles_completed += 1

            logger.info(
                f"[AGGREGATOR] Vela cerrada: {symbol} | "
                f"time={bucket.candle_open_time} | "
                f"trades={bucket.trade_count} | "
                f"vol={bucket.total_volume:.4f} | "
                f"range={bucket.low:.2f}-{bucket.high:.2f}"
            )

            # Notificar callback
            if self._on_candle_complete:
                try:
                    result = self._on_candle_complete(bucket)
                    if asyncio.iscoroutine(result):
                        await result
                except Exception as e:
                    logger.error(f"[AGGREGATOR] Error en callback: {e}")

    async def flush_all(self):
        """
        Cierra todos los buckets activos.
        Util al detener el servicio para no perder datos.
        """
        symbols = list(self._active_buckets.keys())
        for symbol in symbols:
            await self._close_bucket(symbol)

    def get_active_bucket(self, symbol: str) -> Optional[CandleBucket]:
        """Retorna el bucket activo para un simbolo (si existe)."""
        return self._active_buckets.get(symbol)

    def get_stats(self) -> dict:
        """Retorna estadisticas del agregador."""
        uptime = time.time() - self._start_time
        return {
            "interval": self.interval,
            "interval_ms": self._interval_ms,
            "trades_processed": self._trades_processed,
            "candles_completed": self._candles_completed,
            "active_buckets": list(self._active_buckets.keys()),
            "active_bucket_counts": {
                sym: bucket.trade_count
                for sym, bucket in self._active_buckets.items()
            },
            "uptime_seconds": round(uptime, 2),
            "trades_per_second": round(self._trades_processed / max(uptime, 1), 2)
        }

    def reset_stats(self):
        """Reinicia las estadisticas (util para testing)."""
        self._trades_processed = 0
        self._candles_completed = 0
        self._start_time = time.time()


# Funcion de utilidad para crear Trade desde datos de Bybit
def create_trade_from_bybit(data: dict) -> Trade:
    """
    Crea un objeto Trade desde el formato de Bybit WebSocket.

    Formato Bybit:
    {
        "T": 1672304486865,  # timestamp
        "s": "BTCUSDT",      # symbol
        "S": "Buy",          # side
        "v": "0.001",        # volume (string)
        "p": "95000.50",     # price (string)
        "i": "abc123..."     # trade_id
    }
    """
    return Trade(
        timestamp=data.get("T", 0),
        symbol=data.get("s", ""),
        side=data.get("S", ""),
        price=float(data.get("p", 0)),
        volume=float(data.get("v", 0)),
        trade_id=data.get("i", "")
    )
