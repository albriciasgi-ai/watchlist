"""
Trading Journal - Metrics Service
Calcula métricas avanzadas de trading para el journal.
"""

import logging
from typing import Dict, List, Any, Optional
from datetime import datetime, timedelta
from dataclasses import dataclass
from collections import defaultdict
import math

from models.journal_entry import JournalEntry, TradeStatus, TradeSource, TradeDirection
from store.journal_store import JournalStore

logger = logging.getLogger(__name__)


@dataclass
class PerformanceMetrics:
    """Métricas de rendimiento"""
    # Básicas
    total_trades: int = 0
    winners: int = 0
    losers: int = 0
    breakeven: int = 0
    win_rate: float = 0.0

    # PnL
    total_pnl: float = 0.0
    gross_profit: float = 0.0
    gross_loss: float = 0.0
    avg_win: float = 0.0
    avg_loss: float = 0.0
    largest_win: float = 0.0
    largest_loss: float = 0.0

    # Ratios
    profit_factor: float = 0.0
    avg_rr_realized: float = 0.0
    expectancy: float = 0.0

    # R-Multiple
    total_r: float = 0.0
    avg_r: float = 0.0
    best_r: float = 0.0
    worst_r: float = 0.0

    # Streaks
    current_streak: int = 0
    best_win_streak: int = 0
    worst_loss_streak: int = 0

    # Risk
    max_drawdown_pct: float = 0.0
    max_drawdown_usd: float = 0.0
    sharpe_ratio: float = 0.0
    sortino_ratio: float = 0.0

    # Time
    avg_duration_minutes: float = 0.0
    avg_duration_winners: float = 0.0
    avg_duration_losers: float = 0.0

    def to_dict(self) -> Dict[str, Any]:
        return {
            'total_trades': self.total_trades,
            'winners': self.winners,
            'losers': self.losers,
            'breakeven': self.breakeven,
            'win_rate': round(self.win_rate, 2),
            'total_pnl': round(self.total_pnl, 2),
            'gross_profit': round(self.gross_profit, 2),
            'gross_loss': round(self.gross_loss, 2),
            'avg_win': round(self.avg_win, 2),
            'avg_loss': round(self.avg_loss, 2),
            'largest_win': round(self.largest_win, 2),
            'largest_loss': round(self.largest_loss, 2),
            'profit_factor': round(self.profit_factor, 2),
            'avg_rr_realized': round(self.avg_rr_realized, 2),
            'expectancy': round(self.expectancy, 2),
            'total_r': round(self.total_r, 2),
            'avg_r': round(self.avg_r, 2),
            'best_r': round(self.best_r, 2),
            'worst_r': round(self.worst_r, 2),
            'current_streak': self.current_streak,
            'best_win_streak': self.best_win_streak,
            'worst_loss_streak': self.worst_loss_streak,
            'max_drawdown_pct': round(self.max_drawdown_pct, 2),
            'max_drawdown_usd': round(self.max_drawdown_usd, 2),
            'sharpe_ratio': round(self.sharpe_ratio, 2),
            'sortino_ratio': round(self.sortino_ratio, 2),
            'avg_duration_minutes': round(self.avg_duration_minutes, 0),
            'avg_duration_winners': round(self.avg_duration_winners, 0),
            'avg_duration_losers': round(self.avg_duration_losers, 0)
        }


class MetricsService:
    """Servicio para cálculo de métricas de trading"""

    def __init__(self, store: JournalStore):
        self.store = store

    def calculate_metrics(
        self,
        entries: List[JournalEntry],
        initial_capital: float = 10000.0
    ) -> PerformanceMetrics:
        """Calcula métricas completas para una lista de entries"""
        metrics = PerformanceMetrics()

        # Filtrar solo trades cerrados
        closed = [e for e in entries if e.status != TradeStatus.OPEN]

        if not closed:
            return metrics

        # Ordenar por fecha de entrada
        closed.sort(key=lambda x: x.entry_time)

        # Básicas
        metrics.total_trades = len(closed)
        metrics.winners = len([e for e in closed if e.pnl_usd > 0])
        metrics.losers = len([e for e in closed if e.pnl_usd < 0])
        metrics.breakeven = len([e for e in closed if e.pnl_usd == 0])

        if metrics.total_trades > 0:
            metrics.win_rate = (metrics.winners / metrics.total_trades) * 100

        # PnL
        pnls = [e.pnl_usd for e in closed]
        win_pnls = [p for p in pnls if p > 0]
        loss_pnls = [p for p in pnls if p < 0]

        metrics.total_pnl = sum(pnls)
        metrics.gross_profit = sum(win_pnls) if win_pnls else 0
        metrics.gross_loss = abs(sum(loss_pnls)) if loss_pnls else 0

        if win_pnls:
            metrics.avg_win = sum(win_pnls) / len(win_pnls)
            metrics.largest_win = max(win_pnls)

        if loss_pnls:
            metrics.avg_loss = abs(sum(loss_pnls) / len(loss_pnls))
            metrics.largest_loss = abs(min(loss_pnls))

        # Profit Factor
        if metrics.gross_loss > 0:
            metrics.profit_factor = metrics.gross_profit / metrics.gross_loss
        elif metrics.gross_profit > 0:
            metrics.profit_factor = float('inf')

        # Expectancy (Expected Value per trade)
        if metrics.total_trades > 0:
            metrics.expectancy = metrics.total_pnl / metrics.total_trades

        # R-Multiple
        r_multiples = [e.r_multiple for e in closed if e.r_multiple != 0]
        if r_multiples:
            metrics.total_r = sum(r_multiples)
            metrics.avg_r = sum(r_multiples) / len(r_multiples)
            metrics.best_r = max(r_multiples)
            metrics.worst_r = min(r_multiples)

        # Average RR Realized
        if metrics.avg_loss > 0 and metrics.winners > 0:
            metrics.avg_rr_realized = metrics.avg_win / metrics.avg_loss

        # Streaks
        metrics.current_streak, metrics.best_win_streak, metrics.worst_loss_streak = \
            self._calculate_streaks(closed)

        # Duration
        durations = [e.duration_minutes for e in closed if e.duration_minutes > 0]
        winner_durations = [e.duration_minutes for e in closed if e.pnl_usd > 0 and e.duration_minutes > 0]
        loser_durations = [e.duration_minutes for e in closed if e.pnl_usd < 0 and e.duration_minutes > 0]

        if durations:
            metrics.avg_duration_minutes = sum(durations) / len(durations)
        if winner_durations:
            metrics.avg_duration_winners = sum(winner_durations) / len(winner_durations)
        if loser_durations:
            metrics.avg_duration_losers = sum(loser_durations) / len(loser_durations)

        # Drawdown
        metrics.max_drawdown_pct, metrics.max_drawdown_usd = \
            self._calculate_drawdown(closed, initial_capital)

        # Sharpe & Sortino
        if len(pnls) > 1:
            metrics.sharpe_ratio = self._calculate_sharpe(pnls)
            metrics.sortino_ratio = self._calculate_sortino(pnls)

        return metrics

    def _calculate_streaks(self, entries: List[JournalEntry]) -> tuple:
        """Calcula streaks de wins/losses"""
        if not entries:
            return 0, 0, 0

        current_streak = 0
        best_win_streak = 0
        worst_loss_streak = 0
        temp_win_streak = 0
        temp_loss_streak = 0

        for entry in entries:
            if entry.pnl_usd > 0:
                temp_win_streak += 1
                temp_loss_streak = 0
                best_win_streak = max(best_win_streak, temp_win_streak)
            elif entry.pnl_usd < 0:
                temp_loss_streak += 1
                temp_win_streak = 0
                worst_loss_streak = max(worst_loss_streak, temp_loss_streak)
            else:
                temp_win_streak = 0
                temp_loss_streak = 0

        # Current streak (positive = wins, negative = losses)
        if entries:
            last_entry = entries[-1]
            if last_entry.pnl_usd > 0:
                current_streak = temp_win_streak
            elif last_entry.pnl_usd < 0:
                current_streak = -temp_loss_streak

        return current_streak, best_win_streak, worst_loss_streak

    def _calculate_drawdown(
        self,
        entries: List[JournalEntry],
        initial_capital: float
    ) -> tuple:
        """Calcula máximo drawdown"""
        if not entries:
            return 0.0, 0.0

        equity = initial_capital
        peak = equity
        max_dd_usd = 0
        max_dd_pct = 0

        for entry in entries:
            equity += entry.pnl_usd

            if equity > peak:
                peak = equity

            dd_usd = peak - equity
            dd_pct = (dd_usd / peak) * 100 if peak > 0 else 0

            if dd_usd > max_dd_usd:
                max_dd_usd = dd_usd
                max_dd_pct = dd_pct

        return max_dd_pct, max_dd_usd

    def _calculate_sharpe(self, returns: List[float], risk_free_rate: float = 0.0) -> float:
        """Calcula Sharpe Ratio"""
        if len(returns) < 2:
            return 0.0

        avg_return = sum(returns) / len(returns)
        std_dev = math.sqrt(sum((r - avg_return) ** 2 for r in returns) / len(returns))

        if std_dev == 0:
            return 0.0

        # Annualized (assuming daily)
        return ((avg_return - risk_free_rate) / std_dev) * math.sqrt(252)

    def _calculate_sortino(self, returns: List[float], risk_free_rate: float = 0.0) -> float:
        """Calcula Sortino Ratio (solo downside deviation)"""
        if len(returns) < 2:
            return 0.0

        avg_return = sum(returns) / len(returns)
        downside_returns = [r for r in returns if r < 0]

        if not downside_returns:
            return float('inf') if avg_return > 0 else 0.0

        downside_dev = math.sqrt(sum(r ** 2 for r in downside_returns) / len(downside_returns))

        if downside_dev == 0:
            return 0.0

        return ((avg_return - risk_free_rate) / downside_dev) * math.sqrt(252)

    def get_metrics_by_period(
        self,
        period: str = "all",  # "day", "week", "month", "year", "all"
        symbol: Optional[str] = None
    ) -> Dict[str, Any]:
        """Obtiene métricas agrupadas por período"""
        # Determinar fecha de inicio
        now = datetime.utcnow()

        if period == "day":
            start_date = (now - timedelta(days=1)).isoformat()
        elif period == "week":
            start_date = (now - timedelta(weeks=1)).isoformat()
        elif period == "month":
            start_date = (now - timedelta(days=30)).isoformat()
        elif period == "year":
            start_date = (now - timedelta(days=365)).isoformat()
        else:
            start_date = None

        entries = self.store.list_all(
            start_date=start_date,
            symbol=symbol,
            limit=10000
        )

        metrics = self.calculate_metrics(entries)

        return {
            "period": period,
            "symbol": symbol,
            "start_date": start_date,
            "end_date": now.isoformat(),
            "metrics": metrics.to_dict()
        }

    def get_metrics_by_symbol(self) -> Dict[str, Dict[str, Any]]:
        """Obtiene métricas agrupadas por símbolo"""
        entries = self.store.list_all(limit=10000)

        # Agrupar por símbolo
        by_symbol = defaultdict(list)
        for entry in entries:
            by_symbol[entry.symbol].append(entry)

        result = {}
        for symbol, symbol_entries in by_symbol.items():
            metrics = self.calculate_metrics(symbol_entries)
            result[symbol] = metrics.to_dict()

        return result

    def get_metrics_by_source(self) -> Dict[str, Dict[str, Any]]:
        """Obtiene métricas agrupadas por fuente"""
        entries = self.store.list_all(limit=10000)

        # Agrupar por source
        by_source = defaultdict(list)
        for entry in entries:
            by_source[entry.source.value].append(entry)

        result = {}
        for source, source_entries in by_source.items():
            metrics = self.calculate_metrics(source_entries)
            result[source] = metrics.to_dict()

        return result

    def get_metrics_by_direction(self) -> Dict[str, Dict[str, Any]]:
        """Obtiene métricas agrupadas por dirección (LONG/SHORT)"""
        entries = self.store.list_all(limit=10000)

        longs = [e for e in entries if e.direction == TradeDirection.LONG]
        shorts = [e for e in entries if e.direction == TradeDirection.SHORT]

        return {
            "long": self.calculate_metrics(longs).to_dict(),
            "short": self.calculate_metrics(shorts).to_dict()
        }

    def get_metrics_by_day_of_week(self) -> Dict[str, Dict[str, Any]]:
        """Obtiene métricas agrupadas por día de la semana"""
        entries = self.store.list_all(limit=10000)

        # Agrupar por día
        by_day = defaultdict(list)
        for entry in entries:
            if entry.entry_time:
                try:
                    dt = datetime.fromisoformat(entry.entry_time.replace('Z', '+00:00'))
                    day_name = dt.strftime('%A')
                    by_day[day_name].append(entry)
                except:
                    pass

        result = {}
        for day, day_entries in by_day.items():
            metrics = self.calculate_metrics(day_entries)
            result[day] = metrics.to_dict()

        return result

    def get_metrics_by_hour(self) -> Dict[int, Dict[str, Any]]:
        """Obtiene métricas agrupadas por hora del día"""
        entries = self.store.list_all(limit=10000)

        # Agrupar por hora
        by_hour = defaultdict(list)
        for entry in entries:
            if entry.entry_time:
                try:
                    dt = datetime.fromisoformat(entry.entry_time.replace('Z', '+00:00'))
                    by_hour[dt.hour].append(entry)
                except:
                    pass

        result = {}
        for hour, hour_entries in by_hour.items():
            metrics = self.calculate_metrics(hour_entries)
            result[hour] = metrics.to_dict()

        return result

    def get_equity_curve(self, initial_capital: float = 10000.0) -> List[Dict[str, Any]]:
        """Genera datos para la curva de equity"""
        entries = self.store.list_all(limit=10000)

        # Filtrar y ordenar
        closed = [e for e in entries if e.status != TradeStatus.OPEN]
        closed.sort(key=lambda x: x.exit_time or x.entry_time)

        equity = initial_capital
        curve = [{
            "timestamp": closed[0].entry_time if closed else datetime.utcnow().isoformat(),
            "equity": equity,
            "pnl": 0,
            "trade_number": 0
        }]

        for i, entry in enumerate(closed):
            equity += entry.pnl_usd
            curve.append({
                "timestamp": entry.exit_time or entry.entry_time,
                "equity": round(equity, 2),
                "pnl": round(entry.pnl_usd, 2),
                "trade_number": i + 1,
                "symbol": entry.symbol,
                "direction": entry.direction.value
            })

        return curve

    def get_monthly_returns(self) -> Dict[str, Dict[str, float]]:
        """Obtiene retornos mensuales para heatmap"""
        entries = self.store.list_all(limit=10000)

        # Agrupar por año-mes
        monthly = defaultdict(float)
        for entry in entries:
            if entry.exit_time and entry.status != TradeStatus.OPEN:
                try:
                    dt = datetime.fromisoformat(entry.exit_time.replace('Z', '+00:00'))
                    key = f"{dt.year}-{dt.month:02d}"
                    monthly[key] += entry.pnl_usd
                except:
                    pass

        # Organizar por año
        result = defaultdict(dict)
        for key, pnl in monthly.items():
            year, month = key.split('-')
            month_name = datetime(2000, int(month), 1).strftime('%b')
            result[year][month_name] = round(pnl, 2)

        return dict(result)
