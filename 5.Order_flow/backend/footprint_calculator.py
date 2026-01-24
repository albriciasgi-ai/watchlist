"""
FootprintCalculator - Calcula footprints (order flow) para velas de trading.

Un footprint divide el rango de precio de una vela en niveles y acumula
el volumen de compras (ask) y ventas (bid) en cada nivel.
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional
import logging

logger = logging.getLogger(__name__)

# Numero de niveles por defecto para dividir cada vela
DEFAULT_NUM_LEVELS = 6


@dataclass
class FootprintLevel:
    """
    Un nivel de precio dentro de una vela.
    Acumula volumen de bid (ventas agresivas) y ask (compras agresivas).
    """
    price_min: float      # Limite inferior del nivel
    price_max: float      # Limite superior del nivel
    bid_volume: float = 0.0    # Volumen de vendedores agresivos
    ask_volume: float = 0.0    # Volumen de compradores agresivos
    trade_count: int = 0       # Cantidad de trades en este nivel

    @property
    def delta(self) -> float:
        """Diferencia entre compradores y vendedores agresivos."""
        return self.ask_volume - self.bid_volume

    @property
    def total_volume(self) -> float:
        """Volumen total del nivel."""
        return self.bid_volume + self.ask_volume

    @property
    def imbalance_ratio(self) -> float:
        """
        Ratio de imbalance entre bid y ask.
        Retorna infinito si el lado menor es 0.
        """
        min_vol = min(self.bid_volume, self.ask_volume)
        max_vol = max(self.bid_volume, self.ask_volume)
        return max_vol / min_vol if min_vol > 0 else float('inf')

    def to_dict(self) -> dict:
        """Serializa el nivel a diccionario."""
        return {
            "price_min": self.price_min,
            "price_max": self.price_max,
            "bid_volume": round(self.bid_volume, 4),
            "ask_volume": round(self.ask_volume, 4),
            "delta": round(self.delta, 4),
            "total_volume": round(self.total_volume, 4),
            "trade_count": self.trade_count,
            "imbalance_ratio": round(self.imbalance_ratio, 2) if self.imbalance_ratio != float('inf') else None
        }


@dataclass
class Footprint:
    """
    Footprint completo de una vela.
    Contiene los datos OHLC de la vela y los niveles de order flow.
    """
    candle_timestamp: int       # Timestamp de apertura de la vela (ms)
    symbol: str
    interval: str               # "1", "5", "15", etc
    candle_open: float
    candle_high: float
    candle_low: float
    candle_close: float
    levels: List[FootprintLevel] = field(default_factory=list)

    @property
    def poc_index(self) -> int:
        """
        Indice del nivel con mayor volumen total (Point of Control).
        Retorna -1 si no hay niveles.
        """
        if not self.levels:
            return -1
        return max(range(len(self.levels)),
                   key=lambda i: self.levels[i].total_volume)

    @property
    def total_delta(self) -> float:
        """Delta total de toda la vela."""
        return sum(level.delta for level in self.levels)

    @property
    def total_volume(self) -> float:
        """Volumen total de toda la vela."""
        return sum(level.total_volume for level in self.levels)

    def get_imbalances(self, threshold: float = 3.0) -> List[dict]:
        """
        Retorna niveles con imbalance >= threshold.

        Args:
            threshold: Ratio minimo para considerar imbalance (default 3.0)

        Returns:
            Lista de diccionarios con info de cada imbalance
        """
        result = []
        for i, level in enumerate(self.levels):
            ratio = level.imbalance_ratio
            # Skip infinite ratios (division by zero)
            if ratio == float('inf') or ratio == float('-inf'):
                continue
            if level.total_volume > 0 and ratio >= threshold:
                result.append({
                    "level_index": i,
                    "type": "BUY" if level.ask_volume > level.bid_volume else "SELL",
                    "ratio": round(ratio, 2),
                    "price_mid": round((level.price_min + level.price_max) / 2, 2)
                })
        return result

    def to_dict(self) -> dict:
        """Serializa el footprint a diccionario para la API."""
        return {
            "candle_timestamp": self.candle_timestamp,
            "symbol": self.symbol,
            "interval": self.interval,
            "candle_open": self.candle_open,
            "candle_high": self.candle_high,
            "candle_low": self.candle_low,
            "candle_close": self.candle_close,
            "levels": [level.to_dict() for level in self.levels],
            "poc_index": self.poc_index,
            "total_delta": round(self.total_delta, 4),
            "total_volume": round(self.total_volume, 4),
            "imbalances": self.get_imbalances()
        }


class FootprintCalculator:
    """
    Calcula footprints a partir de trades individuales.

    Uso tipico:
        calculator = FootprintCalculator(num_levels=6)
        calculator.set_candle(timestamp, symbol, interval, open, high, low, close)
        calculator.process_trade(price=95000.5, volume=0.1, side="Buy")
        calculator.process_trade(price=94950.0, volume=0.2, side="Sell")
        footprint = calculator.get_footprint()
    """

    def __init__(self, num_levels: int = DEFAULT_NUM_LEVELS, imbalance_threshold: float = 3.0):
        """
        Inicializa el calculador.

        Args:
            num_levels: Numero de niveles para dividir cada vela
            imbalance_threshold: Ratio minimo para detectar imbalances
        """
        self.num_levels = num_levels
        self.imbalance_threshold = imbalance_threshold
        self._current_footprint: Optional[Footprint] = None
        self._trade_count = 0

    def set_candle(self, candle_timestamp: int, symbol: str, interval: str,
                   candle_open: float, candle_high: float,
                   candle_low: float, candle_close: float) -> None:
        """
        Configura la vela actual y crea los niveles.
        Debe llamarse antes de procesar trades.

        Args:
            candle_timestamp: Timestamp de apertura de la vela (ms)
            symbol: Simbolo del par (ej: "BTCUSDT")
            interval: Intervalo de la vela (ej: "1", "5")
            candle_open: Precio de apertura
            candle_high: Precio maximo
            candle_low: Precio minimo
            candle_close: Precio de cierre
        """
        levels = self._create_levels(candle_high, candle_low)

        self._current_footprint = Footprint(
            candle_timestamp=candle_timestamp,
            symbol=symbol,
            interval=interval,
            candle_open=candle_open,
            candle_high=candle_high,
            candle_low=candle_low,
            candle_close=candle_close,
            levels=levels
        )
        self._trade_count = 0

    def _create_levels(self, candle_high: float, candle_low: float) -> List[FootprintLevel]:
        """
        Divide el rango HIGH-LOW en N niveles iguales.

        Args:
            candle_high: Precio maximo de la vela
            candle_low: Precio minimo de la vela

        Returns:
            Lista de FootprintLevel (vacios, listos para acumular trades)
        """
        # Caso especial: vela doji (high == low)
        if candle_high == candle_low:
            return [FootprintLevel(
                price_min=candle_low - 0.01,
                price_max=candle_high + 0.01,
                bid_volume=0.0,
                ask_volume=0.0,
                trade_count=0
            )]

        range_size = candle_high - candle_low
        level_size = range_size / self.num_levels

        levels = []
        for i in range(self.num_levels):
            levels.append(FootprintLevel(
                price_min=candle_low + (i * level_size),
                price_max=candle_low + ((i + 1) * level_size),
                bid_volume=0.0,
                ask_volume=0.0,
                trade_count=0
            ))

        return levels

    def _find_level_index(self, price: float) -> int:
        """
        Encuentra el indice del nivel donde cae el precio.

        Args:
            price: Precio del trade

        Returns:
            Indice del nivel (0 a num_levels-1), o -1 si no hay footprint activo
        """
        if not self._current_footprint or not self._current_footprint.levels:
            return -1

        levels = self._current_footprint.levels

        for i, level in enumerate(levels):
            if level.price_min <= price < level.price_max:
                return i

        # Precio en el high exacto -> ultimo nivel
        if price >= levels[-1].price_max:
            return len(levels) - 1

        # Precio por debajo del low -> primer nivel
        if price < levels[0].price_min:
            return 0

        return len(levels) - 1

    def process_trade(self, price: float, volume: float, side: str) -> bool:
        """
        Procesa un trade y lo agrega al nivel correspondiente.

        Args:
            price: Precio de ejecucion del trade
            volume: Volumen del trade
            side: "Buy" (comprador agresivo -> ask) o "Sell" (vendedor agresivo -> bid)

        Returns:
            True si el trade fue procesado, False si no hay footprint activo
        """
        if not self._current_footprint:
            logger.warning("process_trade called without active footprint")
            return False

        level_idx = self._find_level_index(price)
        if level_idx < 0:
            return False

        level = self._current_footprint.levels[level_idx]

        # Bybit: "Buy" = comprador agresivo (lift the ask) -> suma a ask_volume
        # Bybit: "Sell" = vendedor agresivo (hit the bid) -> suma a bid_volume
        if side == "Buy":
            level.ask_volume += volume
        else:
            level.bid_volume += volume

        level.trade_count += 1
        self._trade_count += 1

        return True

    def get_footprint(self) -> Optional[Footprint]:
        """
        Retorna el footprint actual.

        Returns:
            Footprint con todos los trades procesados, o None si no hay footprint activo
        """
        return self._current_footprint

    def get_poc(self) -> Optional[FootprintLevel]:
        """
        Retorna el nivel POC (Point of Control) - nivel con mayor volumen.

        Returns:
            FootprintLevel del POC, o None si no hay footprint activo
        """
        if not self._current_footprint:
            return None

        poc_idx = self._current_footprint.poc_index
        if poc_idx < 0:
            return None

        return self._current_footprint.levels[poc_idx]

    def detect_imbalances(self, threshold: Optional[float] = None) -> List[dict]:
        """
        Detecta niveles con imbalance significativo.

        Args:
            threshold: Ratio minimo (usa self.imbalance_threshold si no se especifica)

        Returns:
            Lista de diccionarios con info de cada imbalance
        """
        if not self._current_footprint:
            return []

        thresh = threshold if threshold is not None else self.imbalance_threshold
        return self._current_footprint.get_imbalances(thresh)

    def detect_stacked_imbalances(self, min_consecutive: int = 3,
                                   threshold: Optional[float] = None) -> List[dict]:
        """
        Detecta stacked imbalances: N+ niveles consecutivos con imbalance
        en la misma direccion.

        Args:
            min_consecutive: Minimo de niveles consecutivos (default 3)
            threshold: Ratio minimo para considerar imbalance

        Returns:
            Lista de stacked imbalances detectados
        """
        if not self._current_footprint:
            return []

        thresh = threshold if threshold is not None else self.imbalance_threshold
        levels = self._current_footprint.levels

        stacked = []
        current_streak = []
        current_direction = None

        for i, level in enumerate(levels):
            # Solo considerar niveles con volumen
            if level.total_volume == 0:
                # Sin volumen - cerrar streak si es valido
                if len(current_streak) >= min_consecutive:
                    stacked.append(self._create_stacked_result(
                        current_streak, current_direction, levels
                    ))
                current_streak = []
                current_direction = None
                continue

            ratio = level.imbalance_ratio
            # Skip infinite ratios
            if ratio == float('inf') or ratio == float('-inf'):
                if len(current_streak) >= min_consecutive:
                    stacked.append(self._create_stacked_result(
                        current_streak, current_direction, levels
                    ))
                current_streak = []
                current_direction = None
                continue

            if ratio >= thresh:
                direction = "BUY" if level.ask_volume > level.bid_volume else "SELL"

                if direction == current_direction:
                    current_streak.append(i)
                else:
                    # Nueva direccion - guardar streak anterior si es valido
                    if len(current_streak) >= min_consecutive:
                        stacked.append(self._create_stacked_result(
                            current_streak, current_direction, levels
                        ))
                    current_streak = [i]
                    current_direction = direction
            else:
                # Sin imbalance - cerrar streak si es valido
                if len(current_streak) >= min_consecutive:
                    stacked.append(self._create_stacked_result(
                        current_streak, current_direction, levels
                    ))
                current_streak = []
                current_direction = None

        # Cerrar ultimo streak
        if len(current_streak) >= min_consecutive:
            stacked.append(self._create_stacked_result(
                current_streak, current_direction, levels
            ))

        return stacked

    def _create_stacked_result(self, streak: List[int], direction: str,
                                levels: List[FootprintLevel]) -> dict:
        """Crea el diccionario de resultado para un stacked imbalance."""
        # Calcular ratio promedio
        ratios = [levels[i].imbalance_ratio for i in streak
                  if levels[i].imbalance_ratio != float('inf')]
        avg_ratio = sum(ratios) / len(ratios) if ratios else 0

        return {
            "type": "STACKED_IMBALANCE",
            "direction": direction,
            "levels": streak.copy(),
            "levels_count": len(streak),
            "start_price": round(levels[streak[0]].price_min, 2),
            "end_price": round(levels[streak[-1]].price_max, 2),
            "avg_ratio": round(avg_ratio, 2)
        }

    def reset(self) -> None:
        """Limpia el footprint actual."""
        self._current_footprint = None
        self._trade_count = 0

    def get_stats(self) -> dict:
        """Retorna estadisticas del calculador."""
        return {
            "has_footprint": self._current_footprint is not None,
            "num_levels": self.num_levels,
            "imbalance_threshold": self.imbalance_threshold,
            "trades_processed": self._trade_count,
            "footprint_symbol": self._current_footprint.symbol if self._current_footprint else None,
            "footprint_timestamp": self._current_footprint.candle_timestamp if self._current_footprint else None
        }
