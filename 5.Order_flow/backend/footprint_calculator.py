"""
FootprintCalculator - Calcula footprints (order flow) para velas de trading.

ENFOQUE: Step Size Absoluto (como ATAS, Sierra Chart, Quantower)
- Los niveles se basan en un STEP SIZE fijo (ej: $10 para BTC)
- Los precios se redondean al step size mas cercano
- Los niveles estan ALINEADOS globalmente entre velas
- Una vela grande tiene MAS niveles, una pequena tiene MENOS (pero mismo tamano)
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional
import math
import logging

logger = logging.getLogger(__name__)

# Step sizes por defecto para diferentes simbolos (en USD)
# Este es el tamano de cada nivel de precio en el footprint
DEFAULT_STEP_SIZES = {
    "BTCUSDT": 10.0,     # $10 por nivel para BTC
    "ETHUSDT": 2.0,      # $2 por nivel para ETH
    "SOLUSDT": 0.5,      # $0.50 por nivel para SOL
    "BNBUSDT": 1.0,      # $1 por nivel para BNB
    "XRPUSDT": 0.005,    # $0.005 por nivel para XRP
    "ADAUSDT": 0.005,    # $0.005 por nivel para ADA
    "DOGEUSDT": 0.001,   # $0.001 por nivel para DOGE
    "TRXUSDT": 0.001,    # $0.001 por nivel para TRX
    "LINKUSDT": 0.1,     # $0.10 por nivel para LINK
    "AVAXUSDT": 0.2,     # $0.20 por nivel para AVAX
    "MATICUSDT": 0.005,  # $0.005 por nivel para MATIC
    "DOTUSDT": 0.05,     # $0.05 por nivel para DOT
    "LTCUSDT": 0.5,      # $0.50 por nivel para LTC
    "DEFAULT": 1.0       # Default $1 por nivel
}


def get_default_step_size(symbol: str, price: float = None) -> float:
    """
    Obtiene el step size por defecto para un simbolo.
    Si no esta en la lista, calcula uno basado en el precio (~0.01% del precio).
    """
    if symbol in DEFAULT_STEP_SIZES:
        return DEFAULT_STEP_SIZES[symbol]

    # Para simbolos desconocidos, usar ~0.01% del precio
    if price and price > 0:
        raw_step = price * 0.0001
        # Redondear a un numero "bonito"
        if raw_step >= 100:
            return round(raw_step / 10) * 10
        elif raw_step >= 10:
            return round(raw_step)
        elif raw_step >= 1:
            return round(raw_step, 1)
        elif raw_step >= 0.1:
            return round(raw_step, 2)
        elif raw_step >= 0.01:
            return round(raw_step, 3)
        else:
            return round(raw_step, 4)

    return DEFAULT_STEP_SIZES["DEFAULT"]


def round_price_to_step(price: float, step_size: float, direction: str = "down") -> float:
    """
    Redondea un precio al step size mas cercano.

    Args:
        price: Precio a redondear
        step_size: Tamano del step
        direction: "down" para floor, "up" para ceil

    Returns:
        Precio redondeado
    """
    if step_size <= 0:
        return price

    if direction == "down":
        return math.floor(price / step_size) * step_size
    else:
        return math.ceil(price / step_size) * step_size


@dataclass
class FootprintLevel:
    """
    Un nivel de precio dentro de una vela.
    El nivel tiene precios ABSOLUTOS (no relativos a la vela).
    """
    price_min: float      # Limite inferior del nivel (precio absoluto)
    price_max: float      # Limite superior del nivel (precio absoluto)
    bid_volume: float = 0.0    # Volumen de vendedores agresivos
    ask_volume: float = 0.0    # Volumen de compradores agresivos
    trade_count: int = 0       # Cantidad de trades en este nivel

    @property
    def price_mid(self) -> float:
        """Precio medio del nivel."""
        return (self.price_min + self.price_max) / 2

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
            "price_mid": self.price_mid,
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
    Los niveles tienen precios ABSOLUTOS alineados al step size global.
    """
    candle_timestamp: int       # Timestamp de apertura de la vela (ms)
    symbol: str
    interval: str               # "1", "5", "15", etc
    candle_open: float
    candle_high: float
    candle_low: float
    candle_close: float
    step_size: float           # Step size usado para este footprint
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
    def poc_price(self) -> Optional[float]:
        """Precio medio del POC."""
        if not self.levels or self.poc_index < 0:
            return None
        return self.levels[self.poc_index].price_mid

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
        """
        result = []
        for i, level in enumerate(self.levels):
            ratio = level.imbalance_ratio
            if ratio == float('inf') or ratio == float('-inf'):
                continue
            if level.total_volume > 0 and ratio >= threshold:
                result.append({
                    "level_index": i,
                    "type": "BUY" if level.ask_volume > level.bid_volume else "SELL",
                    "ratio": round(ratio, 2),
                    "price_min": level.price_min,
                    "price_max": level.price_max,
                    "price_mid": level.price_mid
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
            "step_size": self.step_size,
            "levels": [level.to_dict() for level in self.levels],
            "num_levels": len(self.levels),
            "poc_index": self.poc_index,
            "poc_price": self.poc_price,
            "total_delta": round(self.total_delta, 4),
            "total_volume": round(self.total_volume, 4),
            "imbalances": self.get_imbalances()
        }


class FootprintCalculator:
    """
    Calcula footprints usando STEP SIZE ABSOLUTO.

    Los niveles se crean basados en precios absolutos redondeados al step size,
    NO basados en dividir el rango de la vela en N partes.

    Esto significa:
    - Una vela de $95,000 a $95,050 con step=$10 tiene 5 niveles
    - Una vela de $95,000 a $95,020 con step=$10 tiene 2 niveles
    - Los niveles estan ALINEADOS entre velas (nivel $95,010-$95,020 siempre igual)
    """

    def __init__(self, symbol: str = None, step_size: float = None,
                 imbalance_threshold: float = 3.0):
        """
        Inicializa el calculador.

        Args:
            symbol: Simbolo del par (ej: "BTCUSDT")
            step_size: Tamano del step en USD (si None, usa default del simbolo)
            imbalance_threshold: Ratio minimo para detectar imbalances
        """
        self.symbol = symbol
        self._step_size = step_size  # Puede ser None, se calcula en set_candle
        self.imbalance_threshold = imbalance_threshold
        self._current_footprint: Optional[Footprint] = None
        self._trade_count = 0
        self._level_map: Dict[float, int] = {}  # price_min -> index en levels

    @property
    def step_size(self) -> float:
        """Retorna el step size actual."""
        return self._step_size or 1.0

    def set_step_size(self, step_size: float) -> None:
        """Actualiza el step size."""
        if step_size > 0:
            self._step_size = step_size

    def set_candle(self, candle_timestamp: int, symbol: str, interval: str,
                   candle_open: float, candle_high: float,
                   candle_low: float, candle_close: float) -> None:
        """
        Configura la vela actual y crea los niveles basados en step size absoluto.
        """
        self.symbol = symbol

        # Determinar step size
        if self._step_size is None:
            self._step_size = get_default_step_size(symbol, candle_close)

        step = self._step_size

        # Crear niveles basados en precios absolutos
        levels, level_map = self._create_absolute_levels(candle_high, candle_low, step)

        self._current_footprint = Footprint(
            candle_timestamp=candle_timestamp,
            symbol=symbol,
            interval=interval,
            candle_open=candle_open,
            candle_high=candle_high,
            candle_low=candle_low,
            candle_close=candle_close,
            step_size=step,
            levels=levels
        )
        self._level_map = level_map
        self._trade_count = 0

    def _create_absolute_levels(self, candle_high: float, candle_low: float,
                                 step_size: float) -> tuple:
        """
        Crea niveles basados en precios ABSOLUTOS alineados al step size.

        Args:
            candle_high: Precio maximo de la vela
            candle_low: Precio minimo de la vela
            step_size: Tamano del step

        Returns:
            (lista de FootprintLevel, diccionario price_min -> index)
        """
        if step_size <= 0:
            step_size = 1.0

        # Caso especial: vela doji
        if candle_high == candle_low:
            price_base = round_price_to_step(candle_low, step_size, "down")
            level = FootprintLevel(
                price_min=price_base,
                price_max=price_base + step_size,
                bid_volume=0.0,
                ask_volume=0.0,
                trade_count=0
            )
            return [level], {price_base: 0}

        # Calcular precio base (redondeado hacia abajo) y techo (redondeado hacia arriba)
        price_floor = round_price_to_step(candle_low, step_size, "down")
        price_ceil = round_price_to_step(candle_high, step_size, "up")

        # Asegurar que price_ceil es mayor que price_floor
        if price_ceil <= price_floor:
            price_ceil = price_floor + step_size

        levels = []
        level_map = {}

        current_price = price_floor
        index = 0

        while current_price < price_ceil:
            level = FootprintLevel(
                price_min=current_price,
                price_max=current_price + step_size,
                bid_volume=0.0,
                ask_volume=0.0,
                trade_count=0
            )
            levels.append(level)
            level_map[current_price] = index
            current_price += step_size
            index += 1

            # Safety: maximo 50 niveles por vela
            if index >= 50:
                logger.warning(f"Max levels reached for candle {candle_low}-{candle_high} with step {step_size}")
                break

        return levels, level_map

    def _find_level_index(self, price: float) -> int:
        """
        Encuentra el indice del nivel donde cae el precio.
        Usa el precio redondeado al step size para busqueda O(1).
        """
        if not self._current_footprint or not self._current_footprint.levels:
            return -1

        step = self._step_size or 1.0
        price_base = round_price_to_step(price, step, "down")

        # Busqueda directa en el mapa
        if price_base in self._level_map:
            return self._level_map[price_base]

        # Fallback: buscar el nivel que contenga el precio
        levels = self._current_footprint.levels
        for i, level in enumerate(levels):
            if level.price_min <= price < level.price_max:
                return i

        # Si el precio esta exactamente en el high, usar ultimo nivel
        if levels and price >= levels[-1].price_min:
            return len(levels) - 1

        # Si esta por debajo, usar primer nivel
        if levels and price < levels[0].price_max:
            return 0

        return -1

    def process_trade(self, price: float, volume: float, side: str) -> bool:
        """
        Procesa un trade y lo agrega al nivel correspondiente.
        """
        if not self._current_footprint:
            logger.warning("process_trade called without active footprint")
            return False

        level_idx = self._find_level_index(price)
        if level_idx < 0:
            return False

        level = self._current_footprint.levels[level_idx]

        # Bybit: "Buy" = comprador agresivo -> ask_volume
        # Bybit: "Sell" = vendedor agresivo -> bid_volume
        if side == "Buy":
            level.ask_volume += volume
        else:
            level.bid_volume += volume

        level.trade_count += 1
        self._trade_count += 1

        return True

    def get_footprint(self) -> Optional[Footprint]:
        """Retorna el footprint actual."""
        return self._current_footprint

    def get_poc(self) -> Optional[FootprintLevel]:
        """Retorna el nivel POC (Point of Control)."""
        if not self._current_footprint:
            return None

        poc_idx = self._current_footprint.poc_index
        if poc_idx < 0:
            return None

        return self._current_footprint.levels[poc_idx]

    def detect_imbalances(self, threshold: Optional[float] = None) -> List[dict]:
        """Detecta niveles con imbalance significativo."""
        if not self._current_footprint:
            return []

        thresh = threshold if threshold is not None else self.imbalance_threshold
        return self._current_footprint.get_imbalances(thresh)

    def detect_stacked_imbalances(self, min_consecutive: int = 3,
                                   threshold: Optional[float] = None) -> List[dict]:
        """Detecta N+ niveles consecutivos con imbalance en la misma direccion."""
        if not self._current_footprint:
            return []

        thresh = threshold if threshold is not None else self.imbalance_threshold
        levels = self._current_footprint.levels

        stacked = []
        current_streak = []
        current_direction = None

        for i, level in enumerate(levels):
            if level.total_volume == 0:
                if len(current_streak) >= min_consecutive:
                    stacked.append(self._create_stacked_result(
                        current_streak, current_direction, levels
                    ))
                current_streak = []
                current_direction = None
                continue

            ratio = level.imbalance_ratio
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
                    if len(current_streak) >= min_consecutive:
                        stacked.append(self._create_stacked_result(
                            current_streak, current_direction, levels
                        ))
                    current_streak = [i]
                    current_direction = direction
            else:
                if len(current_streak) >= min_consecutive:
                    stacked.append(self._create_stacked_result(
                        current_streak, current_direction, levels
                    ))
                current_streak = []
                current_direction = None

        if len(current_streak) >= min_consecutive:
            stacked.append(self._create_stacked_result(
                current_streak, current_direction, levels
            ))

        return stacked

    def _create_stacked_result(self, streak: List[int], direction: str,
                                levels: List[FootprintLevel]) -> dict:
        """Crea el diccionario de resultado para un stacked imbalance."""
        ratios = [levels[i].imbalance_ratio for i in streak
                  if levels[i].imbalance_ratio != float('inf')]
        avg_ratio = sum(ratios) / len(ratios) if ratios else 0

        return {
            "type": "STACKED_IMBALANCE",
            "direction": direction,
            "levels": streak.copy(),
            "levels_count": len(streak),
            "start_price": levels[streak[0]].price_min,
            "end_price": levels[streak[-1]].price_max,
            "avg_ratio": round(avg_ratio, 2)
        }

    def reset(self) -> None:
        """Limpia el footprint actual."""
        self._current_footprint = None
        self._trade_count = 0
        self._level_map = {}

    def get_stats(self) -> dict:
        """Retorna estadisticas del calculador."""
        return {
            "has_footprint": self._current_footprint is not None,
            "step_size": self._step_size,
            "symbol": self.symbol,
            "imbalance_threshold": self.imbalance_threshold,
            "trades_processed": self._trade_count,
            "num_levels": len(self._current_footprint.levels) if self._current_footprint else 0,
            "footprint_timestamp": self._current_footprint.candle_timestamp if self._current_footprint else None
        }
