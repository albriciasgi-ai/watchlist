# strategy_executor.py
# Motor de ejecución de estrategias para backtesting

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from datetime import datetime
from enum import Enum
import math

from strategy_model import Strategy, Direction


class TradeStatus(str, Enum):
    OPEN = "open"
    CLOSED = "closed"
    CANCELLED = "cancelled"


class TradeResult(str, Enum):
    WIN = "win"
    LOSS = "loss"
    BREAKEVEN = "breakeven"


@dataclass
class Trade:
    """Representa un trade ejecutado"""
    id: str
    strategy_id: str
    symbol: str
    side: str  # "long" or "short"
    entry_time: int  # timestamp
    entry_price: float
    quantity: float
    stop_loss: float
    take_profit: float

    exit_time: Optional[int] = None
    exit_price: Optional[float] = None
    status: str = TradeStatus.OPEN.value
    result: Optional[str] = None
    pnl: float = 0.0
    pnl_percent: float = 0.0
    fees: float = 0.0

    zone_id: Optional[str] = None  # Zona que disparó el trade
    entry_reason: str = ""
    exit_reason: str = ""

    def to_dict(self) -> Dict:
        return {
            "id": self.id,
            "strategy_id": self.strategy_id,
            "symbol": self.symbol,
            "side": self.side,
            "entry_time": self.entry_time,
            "entry_price": self.entry_price,
            "quantity": self.quantity,
            "stop_loss": self.stop_loss,
            "take_profit": self.take_profit,
            "exit_time": self.exit_time,
            "exit_price": self.exit_price,
            "status": self.status,
            "result": self.result,
            "pnl": self.pnl,
            "pnl_percent": self.pnl_percent,
            "fees": self.fees,
            "zone_id": self.zone_id,
            "entry_reason": self.entry_reason,
            "exit_reason": self.exit_reason
        }


@dataclass
class Signal:
    """Señal de entrada/salida generada por el executor"""
    timestamp: int
    type: str  # "entry_long", "entry_short", "exit"
    price: float
    zone_id: Optional[str] = None
    reason: str = ""
    conditions_met: List[str] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "timestamp": self.timestamp,
            "type": self.type,
            "price": self.price,
            "zone_id": self.zone_id,
            "reason": self.reason,
            "conditions_met": self.conditions_met
        }


@dataclass
class BacktestResult:
    """Resultado completo del backtesting"""
    strategy_id: str
    symbol: str
    interval: str
    start_time: int
    end_time: int

    # Trades
    trades: List[Trade] = field(default_factory=list)
    signals: List[Signal] = field(default_factory=list)

    # Métricas
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    win_rate: float = 0.0
    total_pnl: float = 0.0
    total_pnl_percent: float = 0.0
    max_drawdown: float = 0.0
    max_drawdown_percent: float = 0.0
    profit_factor: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    avg_trade: float = 0.0
    sharpe_ratio: float = 0.0
    sortino_ratio: float = 0.0
    avg_holding_time: float = 0.0  # en minutos

    # Equity curve
    equity_curve: List[Dict] = field(default_factory=list)  # [{timestamp, equity}]

    # Metadata
    initial_capital: float = 10000.0
    final_capital: float = 10000.0
    execution_time_ms: int = 0

    def to_dict(self) -> Dict:
        return {
            "strategy_id": self.strategy_id,
            "symbol": self.symbol,
            "interval": self.interval,
            "start_time": self.start_time,
            "end_time": self.end_time,
            "trades": [t.to_dict() for t in self.trades],
            "signals": [s.to_dict() for s in self.signals],
            "metrics": {
                "total_trades": self.total_trades,
                "winning_trades": self.winning_trades,
                "losing_trades": self.losing_trades,
                "win_rate": self.win_rate,
                "total_pnl": self.total_pnl,
                "total_pnl_percent": self.total_pnl_percent,
                "max_drawdown": self.max_drawdown,
                "max_drawdown_percent": self.max_drawdown_percent,
                "profit_factor": self.profit_factor,
                "avg_win": self.avg_win,
                "avg_loss": self.avg_loss,
                "avg_trade": self.avg_trade,
                "sharpe_ratio": self.sharpe_ratio,
                "sortino_ratio": self.sortino_ratio,
                "avg_holding_time": self.avg_holding_time
            },
            "equity_curve": self.equity_curve,
            "initial_capital": self.initial_capital,
            "final_capital": self.final_capital,
            "execution_time_ms": self.execution_time_ms
        }


class StrategyExecutor:
    """
    Motor de ejecución de estrategias para backtesting.
    Procesa velas una por una y genera señales de trading.
    """

    def __init__(
        self,
        strategy: Strategy,
        zones: List[Dict],
        initial_capital: float = 10000.0,
        fee_percent: float = 0.1  # 0.1% fee por trade
    ):
        self.strategy = strategy
        self.zones = zones
        self.initial_capital = initial_capital
        self.fee_percent = fee_percent

        # Estado durante la ejecución
        self.capital = initial_capital
        self.equity = initial_capital
        self.open_trades: List[Trade] = []
        self.closed_trades: List[Trade] = []
        self.signals: List[Signal] = []
        self.equity_curve: List[Dict] = []

        # Contadores
        self.trade_counter = 0
        self.daily_trades = 0
        self.daily_loss = 0.0
        self.last_trade_time = 0

        # Estado de zonas
        self.active_zones = []  # Zonas actualmente activas

        print(f"[StrategyExecutor] Initialized with {len(zones)} zones, capital={initial_capital}")

    def run(
        self,
        candles: List[Dict],
        start_time: Optional[int] = None,
        end_time: Optional[int] = None
    ) -> BacktestResult:
        """
        Ejecuta la estrategia sobre las velas.

        Args:
            candles: Lista de velas OHLCV
            start_time: Timestamp de inicio (opcional)
            end_time: Timestamp de fin (opcional)

        Returns:
            BacktestResult con trades y métricas
        """
        import time
        exec_start = time.time()

        # Filtrar velas por rango de tiempo
        if start_time:
            candles = [c for c in candles if c['timestamp'] >= start_time]
        if end_time:
            candles = [c for c in candles if c['timestamp'] <= end_time]

        if not candles:
            print("[StrategyExecutor] No candles in range")
            return self._generate_result(candles[0]['timestamp'] if candles else 0, 0)

        print(f"[StrategyExecutor] Running on {len(candles)} candles...")

        # Procesar cada vela
        for i, candle in enumerate(candles):
            self._process_candle(candle, candles[:i+1])

            # Registrar equity
            self._update_equity(candle)

        # Cerrar trades abiertos al final
        if candles:
            self._close_all_trades(candles[-1], "end_of_backtest")

        exec_time = int((time.time() - exec_start) * 1000)

        result = self._generate_result(
            candles[0]['timestamp'],
            candles[-1]['timestamp'] if candles else 0
        )
        result.execution_time_ms = exec_time

        print(f"[StrategyExecutor] Completed in {exec_time}ms. Trades: {result.total_trades}, Win rate: {result.win_rate:.1f}%")

        return result

    def _process_candle(self, candle: Dict, history: List[Dict]):
        """Procesa una vela individual"""
        timestamp = candle['timestamp']
        close = candle['close']
        high = candle['high']
        low = candle['low']

        # 1. Actualizar zonas activas
        self._update_active_zones(candle)

        # 2. Gestionar trades abiertos (verificar SL/TP)
        self._manage_open_trades(candle)

        # 3. Verificar condiciones de entrada
        if self._can_open_trade(timestamp):
            entry_signal = self._check_entry_conditions(candle, history)
            if entry_signal:
                self._execute_entry(entry_signal, candle)

    def _update_active_zones(self, candle: Dict):
        """Actualiza lista de zonas activas según el precio actual"""
        close = candle['close']
        timestamp = candle['timestamp']

        self.active_zones = []
        for zone in self.zones:
            # Verificar que la zona fue creada antes de esta vela
            zone_start = zone.get('start_time', 0)
            if zone_start and zone_start > timestamp:
                continue

            # Verificar si el precio está cerca de la zona
            min_price = zone.get('min_price', 0)
            max_price = zone.get('max_price', 0)
            tolerance = (max_price - min_price) * 0.1  # 10% de tolerancia

            if min_price - tolerance <= close <= max_price + tolerance:
                self.active_zones.append(zone)

    def _manage_open_trades(self, candle: Dict):
        """Gestiona trades abiertos: verifica SL y TP"""
        high = candle['high']
        low = candle['low']
        timestamp = candle['timestamp']

        for trade in self.open_trades[:]:  # Copia para poder modificar
            hit_sl = False
            hit_tp = False
            exit_price = None

            if trade.side == "long":
                # Para long: SL si low <= stop_loss, TP si high >= take_profit
                if low <= trade.stop_loss:
                    hit_sl = True
                    exit_price = trade.stop_loss
                elif high >= trade.take_profit:
                    hit_tp = True
                    exit_price = trade.take_profit
            else:  # short
                # Para short: SL si high >= stop_loss, TP si low <= take_profit
                if high >= trade.stop_loss:
                    hit_sl = True
                    exit_price = trade.stop_loss
                elif low <= trade.take_profit:
                    hit_tp = True
                    exit_price = trade.take_profit

            if hit_sl or hit_tp:
                reason = "stop_loss" if hit_sl else "take_profit"
                self._close_trade(trade, exit_price, timestamp, reason)

    def _can_open_trade(self, timestamp: int) -> bool:
        """Verifica si se puede abrir un nuevo trade según los filtros"""
        filters = self.strategy.filters

        # Max trades abiertos
        if len(self.open_trades) >= filters.max_open_trades:
            return False

        # Max trades diarios
        if self.daily_trades >= filters.max_daily_trades:
            return False

        # Tiempo mínimo entre trades
        if self.last_trade_time > 0:
            min_time_ms = filters.min_time_between_trades * 60 * 1000
            if timestamp - self.last_trade_time < min_time_ms:
                return False

        # Max pérdida diaria
        if self.daily_loss >= filters.max_daily_loss_percent:
            return False

        return True

    def _check_entry_conditions(self, candle: Dict, history: List[Dict]) -> Optional[Signal]:
        """Verifica si se cumplen las condiciones de entrada"""
        if not self.active_zones:
            return None

        entry = self.strategy.entry
        close = candle['close']
        timestamp = candle['timestamp']

        # Para cada zona activa
        for zone in self.active_zones:
            # Determinar dirección según la posición en la zona
            zone_mid = (zone['max_price'] + zone['min_price']) / 2
            is_at_support = close < zone_mid
            is_at_resistance = close > zone_mid

            # Determinar side basado en trigger y posición
            side = None
            if entry.trigger == "price_touches_zone":
                if entry.direction in ["LONG", "BOTH"] and is_at_support:
                    side = "long"
                elif entry.direction in ["SHORT", "BOTH"] and is_at_resistance:
                    side = "short"
            elif entry.trigger == "price_breaks_zone":
                if entry.direction in ["LONG", "BOTH"] and close > zone['max_price']:
                    side = "long"
                elif entry.direction in ["SHORT", "BOTH"] and close < zone['min_price']:
                    side = "short"

            if not side:
                continue

            # Verificar condiciones adicionales
            conditions_met = []
            all_conditions_pass = True

            for condition in entry.conditions:
                if not condition.enabled:
                    continue

                passed = self._evaluate_condition(condition, zone, candle, history)
                if passed:
                    conditions_met.append(condition.type)
                elif entry.require_all_conditions:
                    all_conditions_pass = False
                    break

            if not entry.require_all_conditions and not conditions_met and entry.conditions:
                all_conditions_pass = False

            if all_conditions_pass:
                signal_type = f"entry_{side}"
                return Signal(
                    timestamp=timestamp,
                    type=signal_type,
                    price=close,
                    zone_id=zone.get('id'),
                    reason=f"Zone {entry.trigger}",
                    conditions_met=conditions_met
                )

        return None

    def _evaluate_condition(
        self,
        condition,
        zone: Dict,
        candle: Dict,
        history: List[Dict]
    ) -> bool:
        """Evalúa una condición individual"""
        cond_type = condition.type
        operator = condition.operator
        value = condition.value

        if cond_type == "zone_quality":
            zone_score = zone.get('score', 0)
            return self._compare(zone_score, operator, value)

        elif cond_type == "zone_touches":
            touches = zone.get('total_touches', 0)
            return self._compare(touches, operator, value)

        elif cond_type == "zone_age":
            # Edad en horas
            zone_start = zone.get('start_time', 0)
            if not zone_start:
                return True
            age_hours = (candle['timestamp'] - zone_start) / (1000 * 60 * 60)
            return self._compare(age_hours, operator, value)

        elif cond_type == "volume":
            # Comparar volumen actual vs promedio
            if len(history) < 20:
                return True
            avg_volume = sum(c['volume'] for c in history[-20:]) / 20
            current_volume = candle['volume']

            if value == "above_average":
                return current_volume > avg_volume
            elif value == "below_average":
                return current_volume < avg_volume
            elif value == "spike":
                return current_volume > avg_volume * 2
            elif value == "low":
                return current_volume < avg_volume * 0.5

        elif cond_type == "candle_pattern":
            # Simplificado: detectar patrones básicos
            patterns = value if isinstance(value, list) else [value]
            detected = self._detect_candle_pattern(candle, history)
            return any(p in detected for p in patterns)

        elif cond_type == "price_distance":
            # Distancia al extremo de la zona como %
            zone_mid = (zone['max_price'] + zone['min_price']) / 2
            zone_height = zone['max_price'] - zone['min_price']
            distance_pct = abs(candle['close'] - zone_mid) / zone_height * 100 if zone_height > 0 else 0
            return self._compare(distance_pct, operator, value)

        # Condición no reconocida: pasar
        return True

    def _compare(self, actual, operator: str, expected) -> bool:
        """Compara valores según operador"""
        if operator == "gte":
            return actual >= expected
        elif operator == "lte":
            return actual <= expected
        elif operator == "eq":
            return actual == expected
        elif operator == "gt":
            return actual > expected
        elif operator == "lt":
            return actual < expected
        return True

    def _detect_candle_pattern(self, candle: Dict, history: List[Dict]) -> List[str]:
        """Detecta patrones de vela simples"""
        patterns = []
        o, h, l, c = candle['open'], candle['high'], candle['low'], candle['close']
        body = abs(c - o)
        total_range = h - l if h > l else 0.0001

        # Doji
        if body / total_range < 0.1:
            patterns.append("doji")

        # Hammer (vela alcista con mecha inferior larga)
        if c > o:  # Vela verde
            upper_wick = h - c
            lower_wick = o - l
            if lower_wick > body * 2 and upper_wick < body:
                patterns.append("hammer")

        # Shooting star (vela bajista con mecha superior larga)
        if c < o:  # Vela roja
            upper_wick = h - o
            lower_wick = c - l
            if upper_wick > body * 2 and lower_wick < body:
                patterns.append("shooting_star")

        # Engulfing (requiere vela anterior)
        if len(history) >= 2:
            prev = history[-2]
            prev_body = abs(prev['close'] - prev['open'])

            # Bullish engulfing
            if c > o and prev['close'] < prev['open']:
                if o < prev['close'] and c > prev['open']:
                    patterns.append("engulfing")

            # Bearish engulfing
            if c < o and prev['close'] > prev['open']:
                if o > prev['close'] and c < prev['open']:
                    patterns.append("engulfing")

        return patterns

    def _execute_entry(self, signal: Signal, candle: Dict):
        """Ejecuta una entrada"""
        side = "long" if "long" in signal.type else "short"
        entry_price = candle['close']

        # Calcular SL y TP
        sl_config = self.strategy.risk_management.stop_loss
        tp_config = self.strategy.risk_management.take_profit

        # Stop loss
        if sl_config.type == "below_zone":
            zone = next((z for z in self.zones if z.get('id') == signal.zone_id), None)
            if zone:
                buffer = sl_config.buffer_percent / 100 * entry_price
                if side == "long":
                    stop_loss = zone['min_price'] - buffer
                else:
                    stop_loss = zone['max_price'] + buffer
            else:
                stop_loss = entry_price * (1 - sl_config.fixed_percent / 100) if side == "long" else entry_price * (1 + sl_config.fixed_percent / 100)
        elif sl_config.type == "fixed_percent":
            if side == "long":
                stop_loss = entry_price * (1 - sl_config.fixed_percent / 100)
            else:
                stop_loss = entry_price * (1 + sl_config.fixed_percent / 100)
        else:
            # Default: 2%
            stop_loss = entry_price * (1 - 0.02) if side == "long" else entry_price * (1 + 0.02)

        # Take profit
        risk = abs(entry_price - stop_loss)
        if tp_config.type == "risk_reward":
            reward = risk * tp_config.risk_reward_ratio
            if side == "long":
                take_profit = entry_price + reward
            else:
                take_profit = entry_price - reward
        elif tp_config.type == "fixed_percent":
            if side == "long":
                take_profit = entry_price * (1 + tp_config.fixed_percent / 100)
            else:
                take_profit = entry_price * (1 - tp_config.fixed_percent / 100)
        else:
            # Default: 2:1 RR
            reward = risk * 2
            take_profit = entry_price + reward if side == "long" else entry_price - reward

        # Calcular cantidad
        sizing = self.strategy.risk_management.sizing
        if sizing.method == "fixed_risk":
            risk_amount = self.capital * (sizing.risk_percent / 100)
            risk_per_unit = abs(entry_price - stop_loss)
            quantity = risk_amount / risk_per_unit if risk_per_unit > 0 else 0
        elif sizing.method == "fixed_amount":
            quantity = sizing.fixed_amount / entry_price
        else:
            quantity = (self.capital * sizing.equity_percent / 100) / entry_price

        # Crear trade
        self.trade_counter += 1
        trade = Trade(
            id=f"trade_{self.trade_counter}",
            strategy_id=self.strategy.id,
            symbol="",  # Se llena después
            side=side,
            entry_time=candle['timestamp'],
            entry_price=entry_price,
            quantity=quantity,
            stop_loss=stop_loss,
            take_profit=take_profit,
            zone_id=signal.zone_id,
            entry_reason=signal.reason
        )

        # Fees
        trade.fees = entry_price * quantity * (self.fee_percent / 100)

        self.open_trades.append(trade)
        self.signals.append(signal)
        self.last_trade_time = candle['timestamp']
        self.daily_trades += 1

        print(f"[StrategyExecutor] ENTRY {side.upper()} @ {entry_price:.2f}, SL={stop_loss:.2f}, TP={take_profit:.2f}")

    def _close_trade(self, trade: Trade, exit_price: float, exit_time: int, reason: str):
        """Cierra un trade"""
        trade.exit_price = exit_price
        trade.exit_time = exit_time
        trade.exit_reason = reason
        trade.status = TradeStatus.CLOSED.value

        # Calcular PnL
        if trade.side == "long":
            trade.pnl = (exit_price - trade.entry_price) * trade.quantity
        else:
            trade.pnl = (trade.entry_price - exit_price) * trade.quantity

        # Restar fees
        exit_fee = exit_price * trade.quantity * (self.fee_percent / 100)
        trade.fees += exit_fee
        trade.pnl -= trade.fees

        trade.pnl_percent = (trade.pnl / (trade.entry_price * trade.quantity)) * 100

        # Resultado
        if trade.pnl > 0:
            trade.result = TradeResult.WIN.value
        elif trade.pnl < 0:
            trade.result = TradeResult.LOSS.value
            self.daily_loss += abs(trade.pnl_percent)
        else:
            trade.result = TradeResult.BREAKEVEN.value

        # Actualizar capital
        self.capital += trade.pnl

        # Mover a cerrados
        self.open_trades.remove(trade)
        self.closed_trades.append(trade)

        # Señal de salida
        self.signals.append(Signal(
            timestamp=exit_time,
            type="exit",
            price=exit_price,
            zone_id=trade.zone_id,
            reason=reason
        ))

        print(f"[StrategyExecutor] EXIT {trade.side.upper()} @ {exit_price:.2f}, PnL={trade.pnl:.2f} ({trade.pnl_percent:.2f}%)")

    def _close_all_trades(self, candle: Dict, reason: str):
        """Cierra todos los trades abiertos"""
        for trade in self.open_trades[:]:
            self._close_trade(trade, candle['close'], candle['timestamp'], reason)

    def _update_equity(self, candle: Dict):
        """Actualiza equity curve"""
        # Equity = capital + valor de posiciones abiertas
        unrealized_pnl = 0
        for trade in self.open_trades:
            if trade.side == "long":
                unrealized_pnl += (candle['close'] - trade.entry_price) * trade.quantity
            else:
                unrealized_pnl += (trade.entry_price - candle['close']) * trade.quantity

        self.equity = self.capital + unrealized_pnl
        self.equity_curve.append({
            "timestamp": candle['timestamp'],
            "equity": self.equity
        })

    def _generate_result(self, start_time: int, end_time: int) -> BacktestResult:
        """Genera el resultado final del backtest"""
        result = BacktestResult(
            strategy_id=self.strategy.id,
            symbol="",
            interval="",
            start_time=start_time,
            end_time=end_time,
            trades=self.closed_trades,
            signals=self.signals,
            equity_curve=self.equity_curve,
            initial_capital=self.initial_capital,
            final_capital=self.capital
        )

        # Calcular métricas
        trades = self.closed_trades
        result.total_trades = len(trades)

        if trades:
            result.winning_trades = sum(1 for t in trades if t.result == TradeResult.WIN.value)
            result.losing_trades = sum(1 for t in trades if t.result == TradeResult.LOSS.value)
            result.win_rate = (result.winning_trades / result.total_trades) * 100

            wins = [t.pnl for t in trades if t.pnl > 0]
            losses = [t.pnl for t in trades if t.pnl < 0]

            result.total_pnl = sum(t.pnl for t in trades)
            result.total_pnl_percent = ((self.capital - self.initial_capital) / self.initial_capital) * 100

            result.avg_win = sum(wins) / len(wins) if wins else 0
            result.avg_loss = sum(losses) / len(losses) if losses else 0
            result.avg_trade = result.total_pnl / result.total_trades

            # Profit factor
            gross_profit = sum(wins)
            gross_loss = abs(sum(losses))
            result.profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')

            # Max drawdown
            peak = self.initial_capital
            max_dd = 0
            for point in self.equity_curve:
                eq = point['equity']
                if eq > peak:
                    peak = eq
                dd = peak - eq
                if dd > max_dd:
                    max_dd = dd
            result.max_drawdown = max_dd
            result.max_drawdown_percent = (max_dd / self.initial_capital) * 100

            # Holding time promedio
            holding_times = []
            for t in trades:
                if t.exit_time and t.entry_time:
                    holding_times.append((t.exit_time - t.entry_time) / (1000 * 60))  # minutos
            result.avg_holding_time = sum(holding_times) / len(holding_times) if holding_times else 0

        return result


# Instancia para uso global
strategy_executor = None


def create_executor(strategy: Strategy, zones: List[Dict], initial_capital: float = 10000.0) -> StrategyExecutor:
    """Crea un nuevo executor"""
    global strategy_executor
    strategy_executor = StrategyExecutor(strategy, zones, initial_capital)
    return strategy_executor
