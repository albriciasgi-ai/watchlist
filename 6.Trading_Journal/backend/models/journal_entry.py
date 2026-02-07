"""
Trading Journal - Data Models
Modelos de datos para el sistema de journal de trading.
"""

from dataclasses import dataclass, field, asdict
from typing import Optional, List, Dict, Any
from enum import Enum
from datetime import datetime
import json
import uuid


class TradeSource(str, Enum):
    """Fuente de la alerta/trade"""
    WATCHLIST = "watchlist"           # App 2 - Puerto 8000
    ANALIZADOR = "analizador"         # App 4 - Puerto 10000
    ORDER_FLOW = "order_flow"         # App 5 - Puerto 11000
    BACKTESTER = "backtester"         # App 1 - Puerto 9000
    MANUAL = "manual"                 # Trade manual sin alerta
    UNKNOWN = "unknown"


class TradeDirection(str, Enum):
    """Direccion del trade"""
    LONG = "long"
    SHORT = "short"


class TradeStatus(str, Enum):
    """Estado del trade"""
    OPEN = "open"
    CLOSED_TP = "closed_tp"           # Cerrado por Take Profit
    CLOSED_SL = "closed_sl"           # Cerrado por Stop Loss
    CLOSED_MANUAL = "closed_manual"   # Cerrado manualmente
    CLOSED_BE = "closed_be"           # Cerrado en Break Even
    CANCELLED = "cancelled"


class PatternType(str, Enum):
    """Tipos de patrones detectados"""
    # Rejection Patterns
    HAMMER = "hammer"
    SHOOTING_STAR = "shooting_star"
    ENGULFING_BULLISH = "engulfing_bullish"
    ENGULFING_BEARISH = "engulfing_bearish"
    DOJI_DRAGONFLY = "doji_dragonfly"
    DOJI_GRAVESTONE = "doji_gravestone"
    # Double Top/Bottom
    DOUBLE_TOP = "double_top"
    DOUBLE_BOTTOM = "double_bottom"
    # Swing
    SWING_HIGH = "swing_high"
    SWING_LOW = "swing_low"
    # Order Flow
    ABSORPTION = "absorption"
    IMBALANCE = "imbalance"
    DELTA_DIVERGENCE = "delta_divergence"
    # Otros
    SUPPORT_BOUNCE = "support_bounce"
    RESISTANCE_REJECTION = "resistance_rejection"
    BREAKOUT = "breakout"
    RANGE_PLAY = "range_play"
    CUSTOM = "custom"


@dataclass
class MarketContext:
    """Contexto del mercado al momento del trade"""
    # Estructura de mercado
    trend: str = "unknown"              # uptrend, downtrend, ranging
    market_structure: str = "unknown"   # HH-HL, LH-LL, consolidation

    # Niveles cercanos
    nearest_support: Optional[float] = None
    nearest_resistance: Optional[float] = None
    distance_to_support_pct: Optional[float] = None
    distance_to_resistance_pct: Optional[float] = None

    # Indicadores
    vwap_price: Optional[float] = None
    vwap_position: str = "unknown"      # above, below, at
    rsi_value: Optional[float] = None
    volume_profile_poc: Optional[float] = None

    # Volatilidad
    atr_value: Optional[float] = None
    atr_percent: Optional[float] = None
    bbw_percentile: Optional[float] = None  # Bollinger Band Width Percentile

    # Sesion
    session: str = "unknown"            # asian, london, ny, overlap
    day_of_week: str = "unknown"
    hour_utc: int = 0

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'MarketContext':
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class TradeSetup:
    """Configuracion del trade (entry, SL, TP)"""
    # Pattern que genero la senal
    pattern_type: PatternType = PatternType.CUSTOM
    pattern_confidence: float = 0.0

    # Precios
    entry_price: float = 0.0
    stop_loss: float = 0.0
    take_profit: float = 0.0

    # Calculados
    risk_reward_ratio: float = 0.0
    risk_amount_usd: float = 0.0
    position_size: float = 0.0
    position_size_usd: float = 0.0

    # Timeframe
    timeframe: str = "1"                # "1", "5", "15", "60", etc

    # Niveles relevantes
    key_level_entry: Optional[float] = None   # Nivel S/R usado para entrada
    key_level_type: str = "unknown"           # support, resistance, vwap, etc

    # Notas pre-trade
    setup_notes: str = ""

    # Calidad del setup (1-10)
    quality: int = 5

    def calculate_rr(self) -> float:
        """Calcula el Risk/Reward ratio"""
        if self.entry_price == 0 or self.stop_loss == 0 or self.take_profit == 0:
            return 0.0

        risk = abs(self.entry_price - self.stop_loss)
        reward = abs(self.take_profit - self.entry_price)

        if risk == 0:
            return 0.0

        return round(reward / risk, 2)

    def to_dict(self) -> Dict[str, Any]:
        result = asdict(self)
        result['pattern_type'] = self.pattern_type.value if isinstance(self.pattern_type, PatternType) else self.pattern_type
        return result

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TradeSetup':
        if 'pattern_type' in data and isinstance(data['pattern_type'], str):
            try:
                data['pattern_type'] = PatternType(data['pattern_type'])
            except ValueError:
                data['pattern_type'] = PatternType.CUSTOM
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class ExecutionQuality:
    """Calidad de ejecucion del trade"""
    # Slippage
    intended_entry: float = 0.0
    actual_entry: float = 0.0
    entry_slippage_pct: float = 0.0

    # Timing
    entry_timing: str = "unknown"       # early, perfect, late, chased
    exit_timing: str = "unknown"        # early, perfect, late, premature

    # Gestion durante el trade
    sl_moved: bool = False
    sl_moved_direction: str = "none"    # tightened, widened, none
    tp_moved: bool = False
    added_to_position: bool = False
    partial_close: bool = False

    # Emociones detectadas
    fomo_entry: bool = False
    revenge_trade: bool = False
    overtrading: bool = False

    # Score de ejecucion (0-100)
    execution_score: int = 50

    # Gestion manual
    followed_rules: bool = True
    notes: str = ""

    def calculate_slippage(self) -> float:
        """Calcula el slippage de entrada"""
        if self.intended_entry == 0:
            return 0.0
        return round(((self.actual_entry - self.intended_entry) / self.intended_entry) * 100, 4)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ExecutionQuality':
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class TradeReflection:
    """Reflexion post-trade (manual o generada por IA)"""
    # Notas del trader
    what_went_well: str = ""
    what_went_wrong: str = ""
    lessons_learned: str = ""

    # Preguntas de reflexion
    followed_plan: bool = True
    would_take_again: bool = True
    confidence_level: int = 5           # 1-10

    # Tags personalizados
    tags: List[str] = field(default_factory=list)

    # Feedback IA
    ai_analysis: str = ""
    ai_suggestions: List[str] = field(default_factory=list)
    ai_pattern_detected: str = ""       # Patron de comportamiento detectado

    # Rating general (1-5 estrellas)
    overall_rating: int = 3

    # Campos del frontend
    notes: str = ""
    lessons: str = ""
    emotions_before: str = ""
    emotions_after: str = ""

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'TradeReflection':
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


@dataclass
class JournalEntry:
    """Entrada principal del journal - representa un trade completo"""
    # Identificacion
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    created_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())
    updated_at: str = field(default_factory=lambda: datetime.utcnow().isoformat())

    # Trade basico
    symbol: str = ""
    direction: TradeDirection = TradeDirection.LONG
    status: TradeStatus = TradeStatus.OPEN
    source: TradeSource = TradeSource.UNKNOWN
    source_alert_id: Optional[str] = None   # ID de la alerta original

    # Timestamps
    entry_time: str = ""                    # ISO format
    exit_time: Optional[str] = None
    duration_minutes: int = 0

    # Resultados
    entry_price: float = 0.0
    exit_price: Optional[float] = None
    pnl_usd: float = 0.0
    pnl_percent: float = 0.0
    r_multiple: float = 0.0                 # PnL en terminos de R (risk units)

    # Fees
    entry_fee_usd: float = 0.0
    exit_fee_usd: float = 0.0
    total_fees_usd: float = 0.0

    # Screenshots
    screenshot_entry: Optional[str] = None  # Path a imagen de entrada
    screenshot_exit: Optional[str] = None   # Path a imagen de salida

    # Sub-modelos
    market_context: MarketContext = field(default_factory=MarketContext)
    setup: TradeSetup = field(default_factory=TradeSetup)
    execution: ExecutionQuality = field(default_factory=ExecutionQuality)
    reflection: TradeReflection = field(default_factory=TradeReflection)

    # Metadata
    bybit_order_id: Optional[str] = None
    notes: str = ""

    def calculate_duration(self) -> int:
        """Calcula la duracion del trade en minutos"""
        if not self.entry_time or not self.exit_time:
            return 0

        try:
            entry = datetime.fromisoformat(self.entry_time.replace('Z', '+00:00'))
            exit = datetime.fromisoformat(self.exit_time.replace('Z', '+00:00'))
            delta = exit - entry
            return int(delta.total_seconds() / 60)
        except Exception:
            return 0

    def calculate_r_multiple(self) -> float:
        """Calcula el R-multiple (PnL / Risk)"""
        if self.setup.risk_amount_usd == 0:
            return 0.0
        return round(self.pnl_usd / self.setup.risk_amount_usd, 2)

    def calculate_pnl_percent(self) -> float:
        """Calcula el PnL en porcentaje"""
        if self.entry_price == 0 or self.exit_price is None:
            return 0.0

        if self.direction == TradeDirection.LONG:
            return round(((self.exit_price - self.entry_price) / self.entry_price) * 100, 4)
        else:
            return round(((self.entry_price - self.exit_price) / self.entry_price) * 100, 4)

    def finalize(self, exit_price: float, exit_time: str, status: TradeStatus, pnl_usd: float):
        """Finaliza el trade con los datos de cierre"""
        self.exit_price = exit_price
        self.exit_time = exit_time
        self.status = status
        self.pnl_usd = pnl_usd
        self.pnl_percent = self.calculate_pnl_percent()
        self.duration_minutes = self.calculate_duration()
        self.r_multiple = self.calculate_r_multiple()
        self.updated_at = datetime.utcnow().isoformat()

    def to_dict(self) -> Dict[str, Any]:
        """Convierte a diccionario para JSON/DB"""
        return {
            'id': self.id,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
            'symbol': self.symbol,
            'direction': self.direction.value if isinstance(self.direction, TradeDirection) else self.direction,
            'status': self.status.value if isinstance(self.status, TradeStatus) else self.status,
            'source': self.source.value if isinstance(self.source, TradeSource) else self.source,
            'source_alert_id': self.source_alert_id,
            'entry_time': self.entry_time,
            'exit_time': self.exit_time,
            'duration_minutes': self.duration_minutes,
            'entry_price': self.entry_price,
            'exit_price': self.exit_price,
            'pnl_usd': self.pnl_usd,
            'pnl_percent': self.pnl_percent,
            'r_multiple': self.r_multiple,
            'entry_fee_usd': self.entry_fee_usd,
            'exit_fee_usd': self.exit_fee_usd,
            'total_fees_usd': self.total_fees_usd,
            'screenshot_entry': self.screenshot_entry,
            'screenshot_exit': self.screenshot_exit,
            'market_context': self.market_context.to_dict(),
            'setup': self.setup.to_dict(),
            'execution': self.execution.to_dict(),
            'reflection': self.reflection.to_dict(),
            'bybit_order_id': self.bybit_order_id,
            'notes': self.notes
        }

    def to_json(self) -> str:
        """Convierte a JSON string"""
        return json.dumps(self.to_dict(), indent=2)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'JournalEntry':
        """Crea instancia desde diccionario"""
        # Convertir enums
        if 'direction' in data and isinstance(data['direction'], str):
            try:
                data['direction'] = TradeDirection(data['direction'])
            except ValueError:
                data['direction'] = TradeDirection.LONG

        if 'status' in data and isinstance(data['status'], str):
            try:
                data['status'] = TradeStatus(data['status'])
            except ValueError:
                data['status'] = TradeStatus.OPEN

        if 'source' in data and isinstance(data['source'], str):
            try:
                data['source'] = TradeSource(data['source'])
            except ValueError:
                data['source'] = TradeSource.UNKNOWN

        # Convertir sub-modelos
        if 'market_context' in data and isinstance(data['market_context'], dict):
            data['market_context'] = MarketContext.from_dict(data['market_context'])

        if 'setup' in data and isinstance(data['setup'], dict):
            data['setup'] = TradeSetup.from_dict(data['setup'])

        if 'execution' in data and isinstance(data['execution'], dict):
            data['execution'] = ExecutionQuality.from_dict(data['execution'])

        if 'reflection' in data and isinstance(data['reflection'], dict):
            data['reflection'] = TradeReflection.from_dict(data['reflection'])

        # Filtrar solo campos validos
        valid_fields = {k: v for k, v in data.items() if k in cls.__dataclass_fields__}
        return cls(**valid_fields)

    @classmethod
    def from_json(cls, json_str: str) -> 'JournalEntry':
        """Crea instancia desde JSON string"""
        data = json.loads(json_str)
        return cls.from_dict(data)
