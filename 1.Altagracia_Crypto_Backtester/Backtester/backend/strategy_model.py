# strategy_model.py
# Modelo de datos para estrategias de trading basadas en zonas

from dataclasses import dataclass, field, asdict
from typing import List, Dict, Optional, Any
from enum import Enum
import json
import uuid
from datetime import datetime


class EntryTrigger(str, Enum):
    """Eventos que disparan evaluación de entrada"""
    PRICE_TOUCHES_ZONE = "price_touches_zone"
    PRICE_ENTERS_ZONE = "price_enters_zone"
    PRICE_BREAKS_ZONE = "price_breaks_zone"
    CANDLE_CLOSES_IN_ZONE = "candle_closes_in_zone"


class Direction(str, Enum):
    """Dirección permitida para trades"""
    LONG = "LONG"
    SHORT = "SHORT"
    BOTH = "BOTH"


class ConditionType(str, Enum):
    """Tipos de condiciones para entrada"""
    ZONE_QUALITY = "zone_quality"           # Score mínimo de la zona
    ZONE_TOUCHES = "zone_touches"           # Número de toques previos
    ZONE_AGE = "zone_age"                   # Edad de la zona en horas
    CANDLE_PATTERN = "candle_pattern"       # Patrón de vela (hammer, engulfing, etc)
    VOLUME = "volume"                       # Condición de volumen
    RSI = "rsi"                             # RSI en rango
    TREND = "trend"                         # Dirección de tendencia
    TIME_OF_DAY = "time_of_day"             # Horario de trading
    PRICE_DISTANCE = "price_distance"       # Distancia al extremo de zona


class SizingMethod(str, Enum):
    """Métodos para calcular tamaño de posición"""
    FIXED_RISK = "fixed_risk"               # % del capital a arriesgar
    FIXED_AMOUNT = "fixed_amount"           # Monto fijo en USD
    PERCENT_EQUITY = "percent_equity"       # % del equity actual


class StopLossType(str, Enum):
    """Tipos de stop loss"""
    BELOW_ZONE = "below_zone"               # Debajo/arriba de la zona
    ATR_MULTIPLE = "atr_multiple"           # Múltiplo de ATR
    FIXED_PERCENT = "fixed_percent"         # Porcentaje fijo
    SWING_POINT = "swing_point"             # Swing high/low previo


class TakeProfitType(str, Enum):
    """Tipos de take profit"""
    RISK_REWARD = "risk_reward"             # Ratio riesgo/beneficio
    OPPOSITE_ZONE = "opposite_zone"         # Zona opuesta
    FIXED_PERCENT = "fixed_percent"         # Porcentaje fijo
    ATR_MULTIPLE = "atr_multiple"           # Múltiplo de ATR


@dataclass
class Condition:
    """Una condición individual para entrada"""
    type: str
    operator: str = "gte"  # gte, lte, eq, between, in
    value: Any = None
    value2: Any = None  # Para operador "between"
    enabled: bool = True

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'Condition':
        return cls(**data)


@dataclass
class EntryRules:
    """Reglas de entrada"""
    trigger: str = EntryTrigger.PRICE_TOUCHES_ZONE.value
    direction: str = Direction.BOTH.value
    conditions: List[Condition] = field(default_factory=list)
    require_all_conditions: bool = True  # AND vs OR
    confirmation_candles: int = 1  # Velas de confirmación

    def to_dict(self) -> Dict:
        return {
            "trigger": self.trigger,
            "direction": self.direction,
            "conditions": [c.to_dict() for c in self.conditions],
            "require_all_conditions": self.require_all_conditions,
            "confirmation_candles": self.confirmation_candles
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'EntryRules':
        conditions = [Condition.from_dict(c) for c in data.get("conditions", [])]
        return cls(
            trigger=data.get("trigger", EntryTrigger.PRICE_TOUCHES_ZONE.value),
            direction=data.get("direction", Direction.BOTH.value),
            conditions=conditions,
            require_all_conditions=data.get("require_all_conditions", True),
            confirmation_candles=data.get("confirmation_candles", 1)
        )


@dataclass
class PositionSizing:
    """Configuración de tamaño de posición"""
    method: str = SizingMethod.FIXED_RISK.value
    risk_percent: float = 1.0       # Para FIXED_RISK
    fixed_amount: float = 100.0     # Para FIXED_AMOUNT
    equity_percent: float = 5.0     # Para PERCENT_EQUITY

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'PositionSizing':
        return cls(**data)


@dataclass
class StopLoss:
    """Configuración de stop loss"""
    type: str = StopLossType.BELOW_ZONE.value
    buffer_percent: float = 0.1     # Buffer adicional
    atr_multiple: float = 1.5       # Para ATR_MULTIPLE
    fixed_percent: float = 2.0      # Para FIXED_PERCENT
    use_trailing: bool = False
    trailing_activation: float = 1.0  # % de profit para activar trailing
    trailing_distance: float = 0.5    # Distancia del trailing

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'StopLoss':
        return cls(**data)


@dataclass
class TakeProfit:
    """Configuración de take profit"""
    type: str = TakeProfitType.RISK_REWARD.value
    risk_reward_ratio: float = 2.0  # Para RISK_REWARD
    fixed_percent: float = 4.0      # Para FIXED_PERCENT
    atr_multiple: float = 3.0       # Para ATR_MULTIPLE
    partial_exits: List[Dict] = field(default_factory=list)  # [{percent: 50, at_rr: 1.5}]

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'TakeProfit':
        return cls(**data)


@dataclass
class RiskManagement:
    """Gestión de riesgo de la estrategia"""
    sizing: PositionSizing = field(default_factory=PositionSizing)
    stop_loss: StopLoss = field(default_factory=StopLoss)
    take_profit: TakeProfit = field(default_factory=TakeProfit)

    def to_dict(self) -> Dict:
        return {
            "sizing": self.sizing.to_dict(),
            "stop_loss": self.stop_loss.to_dict(),
            "take_profit": self.take_profit.to_dict()
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'RiskManagement':
        return cls(
            sizing=PositionSizing.from_dict(data.get("sizing", {})),
            stop_loss=StopLoss.from_dict(data.get("stop_loss", {})),
            take_profit=TakeProfit.from_dict(data.get("take_profit", {}))
        )


@dataclass
class Filters:
    """Filtros adicionales de la estrategia"""
    max_open_trades: int = 1
    min_time_between_trades: int = 60  # minutos
    max_daily_trades: int = 5
    max_daily_loss_percent: float = 3.0
    trading_hours_start: Optional[int] = None  # 0-23, None = 24/7
    trading_hours_end: Optional[int] = None
    excluded_days: List[int] = field(default_factory=list)  # 0=Mon, 6=Sun
    min_zone_score: float = 50.0

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'Filters':
        return cls(**data)


@dataclass
class ZoneDetectorConfig:
    """Configuración del detector de zonas a usar"""
    method: str = "pivot_cluster"
    params: Dict = field(default_factory=lambda: {
        "pivot_tolerance_pct": 0.3,
        "pivot_min_touches": 3,
        "pivot_swing_bars": 5,
        "max_price_range_pct": 5.0
    })

    def to_dict(self) -> Dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict) -> 'ZoneDetectorConfig':
        return cls(**data)


@dataclass
class Strategy:
    """Modelo completo de una estrategia de trading"""
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    name: str = "Nueva Estrategia"
    description: str = ""
    version: str = "1.0"
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now().isoformat())

    # Configuración de zonas
    zone_config: ZoneDetectorConfig = field(default_factory=ZoneDetectorConfig)

    # Reglas de entrada
    entry: EntryRules = field(default_factory=EntryRules)

    # Gestión de riesgo
    risk_management: RiskManagement = field(default_factory=RiskManagement)

    # Filtros
    filters: Filters = field(default_factory=Filters)

    # Metadata
    tags: List[str] = field(default_factory=list)
    is_active: bool = True

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "name": self.name,
            "description": self.description,
            "version": self.version,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "zone_config": self.zone_config.to_dict(),
            "entry": self.entry.to_dict(),
            "risk_management": self.risk_management.to_dict(),
            "filters": self.filters.to_dict(),
            "tags": self.tags,
            "is_active": self.is_active
        }

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_dict(cls, data: Dict) -> 'Strategy':
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            name=data.get("name", "Nueva Estrategia"),
            description=data.get("description", ""),
            version=data.get("version", "1.0"),
            created_at=data.get("created_at", datetime.now().isoformat()),
            updated_at=data.get("updated_at", datetime.now().isoformat()),
            zone_config=ZoneDetectorConfig.from_dict(data.get("zone_config", {})),
            entry=EntryRules.from_dict(data.get("entry", {})),
            risk_management=RiskManagement.from_dict(data.get("risk_management", {})),
            filters=Filters.from_dict(data.get("filters", {})),
            tags=data.get("tags", []),
            is_active=data.get("is_active", True)
        )

    @classmethod
    def from_json(cls, json_str: str) -> 'Strategy':
        return cls.from_dict(json.loads(json_str))


# =============================================================================
# ESTRATEGIAS PREDEFINIDAS (Templates)
# =============================================================================

def create_range_bounce_strategy() -> Strategy:
    """Estrategia de rebote en zonas - conservadora"""
    return Strategy(
        name="Range Bounce (Conservador)",
        description="Entra en rebotes dentro de zonas de consolidación. Espera confirmación de vela.",
        entry=EntryRules(
            trigger=EntryTrigger.PRICE_TOUCHES_ZONE.value,
            direction=Direction.BOTH.value,
            conditions=[
                Condition(type=ConditionType.ZONE_QUALITY.value, operator="gte", value=70),
                Condition(type=ConditionType.ZONE_TOUCHES.value, operator="gte", value=3),
                Condition(type=ConditionType.CANDLE_PATTERN.value, operator="in",
                         value=["hammer", "engulfing", "doji"]),
            ],
            confirmation_candles=1
        ),
        risk_management=RiskManagement(
            sizing=PositionSizing(method=SizingMethod.FIXED_RISK.value, risk_percent=1.0),
            stop_loss=StopLoss(type=StopLossType.BELOW_ZONE.value, buffer_percent=0.2),
            take_profit=TakeProfit(type=TakeProfitType.RISK_REWARD.value, risk_reward_ratio=2.0)
        ),
        filters=Filters(max_open_trades=1, min_time_between_trades=60),
        tags=["range", "bounce", "conservative"]
    )


def create_breakout_strategy() -> Strategy:
    """Estrategia de breakout de zonas"""
    return Strategy(
        name="Zone Breakout",
        description="Entra cuando el precio rompe una zona con volumen alto.",
        entry=EntryRules(
            trigger=EntryTrigger.PRICE_BREAKS_ZONE.value,
            direction=Direction.BOTH.value,
            conditions=[
                Condition(type=ConditionType.ZONE_QUALITY.value, operator="gte", value=60),
                Condition(type=ConditionType.VOLUME.value, operator="gte", value="above_average"),
                Condition(type=ConditionType.ZONE_AGE.value, operator="gte", value=4),  # horas
            ],
            confirmation_candles=1
        ),
        risk_management=RiskManagement(
            sizing=PositionSizing(method=SizingMethod.FIXED_RISK.value, risk_percent=1.5),
            stop_loss=StopLoss(type=StopLossType.BELOW_ZONE.value, buffer_percent=0.1),
            take_profit=TakeProfit(type=TakeProfitType.ATR_MULTIPLE.value, atr_multiple=3.0)
        ),
        filters=Filters(max_open_trades=2, min_time_between_trades=30),
        tags=["breakout", "momentum"]
    )


def create_aggressive_scalp_strategy() -> Strategy:
    """Estrategia agresiva para scalping"""
    return Strategy(
        name="Aggressive Scalp",
        description="Entradas rápidas en toques de zona sin esperar confirmación.",
        entry=EntryRules(
            trigger=EntryTrigger.PRICE_TOUCHES_ZONE.value,
            direction=Direction.BOTH.value,
            conditions=[
                Condition(type=ConditionType.ZONE_QUALITY.value, operator="gte", value=50),
            ],
            confirmation_candles=0  # Sin confirmación
        ),
        risk_management=RiskManagement(
            sizing=PositionSizing(method=SizingMethod.FIXED_RISK.value, risk_percent=0.5),
            stop_loss=StopLoss(type=StopLossType.FIXED_PERCENT.value, fixed_percent=0.5),
            take_profit=TakeProfit(type=TakeProfitType.RISK_REWARD.value, risk_reward_ratio=1.5)
        ),
        filters=Filters(max_open_trades=3, min_time_between_trades=15, max_daily_trades=10),
        tags=["scalp", "aggressive", "high-frequency"]
    )


# Templates disponibles
STRATEGY_TEMPLATES = {
    "range_bounce": create_range_bounce_strategy,
    "breakout": create_breakout_strategy,
    "aggressive_scalp": create_aggressive_scalp_strategy,
}


def get_template(template_name: str) -> Optional[Strategy]:
    """Obtiene una estrategia template por nombre"""
    factory = STRATEGY_TEMPLATES.get(template_name)
    if factory:
        return factory()
    return None


def list_templates() -> List[Dict]:
    """Lista todos los templates disponibles"""
    return [
        {"id": name, "name": factory().name, "description": factory().description}
        for name, factory in STRATEGY_TEMPLATES.items()
    ]
