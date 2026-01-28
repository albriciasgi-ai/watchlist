"""
Pattern State Manager for Real-time Detection

Manages state for pattern detection including:
- Cooldown tracking (global per symbol/interval)
- Deduplication (avoid re-alerting same pattern)
- Alert history
- Persistence to JSON files

Author: Claude Code
Date: 2025-01-16

✅ OPTIMIZACIÓN: Usa asyncio.Lock en lugar de threading.Lock para no bloquear event loop
"""

import json
import os
import time
import asyncio
import logging
from typing import Dict, Set, Optional, List
from dataclasses import dataclass, field
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

# Config directory
CONFIG_DIR = os.path.join(os.path.dirname(__file__), 'config')
ALERTED_PATTERNS_FILE = os.path.join(CONFIG_DIR, 'alerted_patterns.json')
ALERT_HISTORY_FILE = os.path.join(CONFIG_DIR, 'alert_history.json')
COOLDOWN_STATE_FILE = os.path.join(CONFIG_DIR, 'cooldown_state.json')


@dataclass
class AlertRecord:
    """Record of a sent alert"""
    id: str
    timestamp: int  # When alert was sent
    symbol: str
    interval: str
    indicator: str  # 'DTB' or 'REJ'
    pattern_type: str
    direction: str  # 'LONG' or 'SHORT'
    price: float
    confidence: float
    status: str  # 'sent', 'failed'
    entry: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    outcome: str = 'PENDING'  # 'WIN', 'LOSS', 'PENDING'
    outcome_timestamp: Optional[int] = None
    config_hash: Optional[str] = None  # For sync validation

    def to_dict(self) -> Dict:
        return {
            'id': self.id,
            'timestamp': self.timestamp,
            'symbol': self.symbol,
            'interval': self.interval,
            'indicator': self.indicator,
            'patternType': self.pattern_type,
            'direction': self.direction,
            'price': self.price,
            'confidence': self.confidence,
            'status': self.status,
            'entry': self.entry,
            'stopLoss': self.stop_loss,
            'takeProfit': self.take_profit,
            'outcome': self.outcome,
            'outcomeTimestamp': self.outcome_timestamp,
            'configHash': self.config_hash
        }

    @classmethod
    def from_dict(cls, data: Dict) -> 'AlertRecord':
        return cls(
            id=data.get('id', ''),
            timestamp=data.get('timestamp', 0),
            symbol=data.get('symbol', ''),
            interval=data.get('interval', ''),
            indicator=data.get('indicator', ''),
            pattern_type=data.get('patternType', ''),
            direction=data.get('direction', ''),
            price=data.get('price', 0),
            confidence=data.get('confidence', 0),
            status=data.get('status', ''),
            entry=data.get('entry'),
            stop_loss=data.get('stopLoss'),
            take_profit=data.get('takeProfit'),
            outcome=data.get('outcome', 'PENDING'),
            outcome_timestamp=data.get('outcomeTimestamp'),
            config_hash=data.get('configHash')
        )


class PatternStateManager:
    """
    Manages state for pattern detection to ensure consistency and prevent spam.

    Features:
    - Global cooldown per symbol/interval (configurable, default 30 min)
    - Pattern deduplication (don't alert same pattern twice)
    - Alert history with persistence
    - Automatic cleanup of old data (>24 hours)
    """

    MAX_HISTORY = 100
    PATTERN_EXPIRY_MS = 24 * 60 * 60 * 1000  # 24 hours

    def __init__(self):
        # ✅ OPTIMIZACIÓN: Usar RLock para permitir re-entrada y evitar deadlocks
        # Las operaciones son rápidas (dict access) así que threading.RLock es suficiente
        # Para I/O usamos ThreadPoolExecutor para no bloquear el event loop
        import threading
        self._lock = threading.RLock()
        self._io_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pattern_io")

        # Alerted patterns: {pattern_id: timestamp_ms}
        self._alerted_patterns: Dict[str, int] = {}

        # Cooldown state: {symbol_interval: last_alert_timestamp_ms}
        self._cooldown_state: Dict[str, int] = {}

        # Alert history
        self._alert_history: List[AlertRecord] = []

        # Ensure config directory exists
        os.makedirs(CONFIG_DIR, exist_ok=True)

        # Load persisted state
        self._load_state()

        logger.info(f"PatternStateManager initialized with {len(self._alerted_patterns)} alerted patterns")

    def _get_cooldown_key(self, symbol: str, interval: str) -> str:
        """Generate key for cooldown tracking"""
        return f"{symbol}_{interval}"

    def _get_pattern_id(self, symbol: str, interval: str, pattern_type: str,
                        timestamp: int, price: float) -> str:
        """Generate unique pattern ID"""
        # Round price to avoid floating point issues
        price_rounded = round(price, 2)
        return f"{symbol}_{interval}_{pattern_type}_{timestamp}_{price_rounded}"

    def is_pattern_alerted(self, symbol: str, interval: str, pattern_type: str,
                           timestamp: int, price: float) -> bool:
        """Check if a pattern has already been alerted"""
        pattern_id = self._get_pattern_id(symbol, interval, pattern_type, timestamp, price)

        with self._lock:
            return pattern_id in self._alerted_patterns

    def mark_pattern_alerted(self, symbol: str, interval: str, pattern_type: str,
                             timestamp: int, price: float) -> str:
        """Mark a pattern as alerted, returns pattern_id"""
        pattern_id = self._get_pattern_id(symbol, interval, pattern_type, timestamp, price)

        with self._lock:
            self._alerted_patterns[pattern_id] = int(time.time() * 1000)
            self._save_alerted_patterns()

        logger.debug(f"Marked pattern as alerted: {pattern_id}")
        return pattern_id

    def is_in_cooldown(self, symbol: str, interval: str, cooldown_minutes: int) -> bool:
        """
        Check if we're in cooldown period for a symbol/interval.

        Args:
            symbol: Trading pair
            interval: Timeframe
            cooldown_minutes: Cooldown duration in minutes

        Returns:
            True if in cooldown (should NOT send alert)
        """
        if cooldown_minutes <= 0:
            return False

        key = self._get_cooldown_key(symbol, interval)
        cooldown_ms = cooldown_minutes * 60 * 1000
        now = int(time.time() * 1000)

        with self._lock:
            last_alert = self._cooldown_state.get(key, 0)
            elapsed = now - last_alert

            if elapsed < cooldown_ms:
                remaining_min = (cooldown_ms - elapsed) / 60000
                logger.debug(f"Cooldown active for {symbol}/{interval}: {remaining_min:.1f} min remaining")
                return True

            return False

    def get_cooldown_remaining(self, symbol: str, interval: str, cooldown_minutes: int) -> int:
        """Get remaining cooldown time in seconds (0 if not in cooldown)"""
        if cooldown_minutes <= 0:
            return 0

        key = self._get_cooldown_key(symbol, interval)
        cooldown_ms = cooldown_minutes * 60 * 1000
        now = int(time.time() * 1000)

        with self._lock:
            last_alert = self._cooldown_state.get(key, 0)
            elapsed = now - last_alert
            remaining = cooldown_ms - elapsed

            return max(0, int(remaining / 1000))

    def update_cooldown(self, symbol: str, interval: str) -> None:
        """Update cooldown timestamp after sending an alert"""
        key = self._get_cooldown_key(symbol, interval)
        now = int(time.time() * 1000)

        with self._lock:
            self._cooldown_state[key] = now
            self._save_cooldown_state()

        logger.debug(f"Updated cooldown for {symbol}/{interval}")

    def add_alert_record(self, record: AlertRecord) -> None:
        """Add an alert to history"""
        with self._lock:
            self._alert_history.insert(0, record)

            # Trim to max size
            if len(self._alert_history) > self.MAX_HISTORY:
                self._alert_history = self._alert_history[:self.MAX_HISTORY]

            self._save_alert_history()

        logger.debug(f"Added alert record: {record.id}")

    def get_alert_history(self, symbol: str = None, limit: int = None) -> List[Dict]:
        """Get alert history, optionally filtered by symbol"""
        with self._lock:
            history = self._alert_history

            if symbol:
                history = [r for r in history if r.symbol == symbol]

            if limit:
                history = history[:limit]

            return [r.to_dict() for r in history]

    def get_pending_alerts(self, symbol: str = None, interval: str = None) -> List['AlertRecord']:
        """
        Get alerts that are still PENDING (have entry/SL/TP but no outcome yet).
        Used by realtime service to evaluate trade outcomes.
        """
        with self._lock:
            pending = [r for r in self._alert_history
                      if r.outcome == 'PENDING'
                      and r.entry is not None
                      and r.stop_loss is not None
                      and r.take_profit is not None]

            if symbol:
                pending = [r for r in pending if r.symbol == symbol]

            if interval:
                pending = [r for r in pending if r.interval == interval]

            return pending

    def update_alert_outcome(self, alert_id: str, outcome: str, outcome_timestamp: int = None) -> bool:
        """Update the outcome (WIN/LOSS) of an alert"""
        with self._lock:
            for record in self._alert_history:
                if record.id == alert_id:
                    record.outcome = outcome
                    record.outcome_timestamp = outcome_timestamp or int(time.time() * 1000)
                    self._save_alert_history()
                    logger.info(f"Updated alert outcome: {alert_id} -> {outcome}")
                    return True
            return False

    def cleanup_old_data(self) -> int:
        """Remove patterns older than 24 hours, returns count removed"""
        now = int(time.time() * 1000)
        cutoff = now - self.PATTERN_EXPIRY_MS
        removed = 0

        with self._lock:
            old_count = len(self._alerted_patterns)
            self._alerted_patterns = {
                k: v for k, v in self._alerted_patterns.items()
                if v > cutoff
            }
            removed = old_count - len(self._alerted_patterns)

            if removed > 0:
                self._save_alerted_patterns()
                logger.info(f"Cleaned up {removed} old alerted patterns")

        return removed

    def get_stats(self) -> Dict:
        """Get statistics about current state"""
        with self._lock:
            return {
                'alerted_patterns_count': len(self._alerted_patterns),
                'active_cooldowns': len(self._cooldown_state),
                'alert_history_count': len(self._alert_history),
                'pending_outcomes': len([r for r in self._alert_history if r.outcome == 'PENDING']),
                'wins': len([r for r in self._alert_history if r.outcome == 'WIN']),
                'losses': len([r for r in self._alert_history if r.outcome == 'LOSS'])
            }

    def _load_state(self) -> None:
        """Load all persisted state from files"""
        self._load_alerted_patterns()
        self._load_cooldown_state()
        self._load_alert_history()

    def _load_alerted_patterns(self) -> None:
        """Load alerted patterns from file"""
        if not os.path.exists(ALERTED_PATTERNS_FILE):
            return

        try:
            with open(ALERTED_PATTERNS_FILE, 'r') as f:
                data = json.load(f)

            # Clean old patterns during load
            now = int(time.time() * 1000)
            cutoff = now - self.PATTERN_EXPIRY_MS

            self._alerted_patterns = {
                k: v for k, v in data.items()
                if v > cutoff
            }

            logger.info(f"Loaded {len(self._alerted_patterns)} alerted patterns")
        except Exception as e:
            logger.error(f"Failed to load alerted patterns: {e}")

    def _save_alerted_patterns(self) -> None:
        """Save alerted patterns to file (non-blocking via executor)"""
        try:
            # ✅ OPTIMIZACIÓN: Hacer copia para evitar race conditions
            data_copy = dict(self._alerted_patterns)
            self._io_executor.submit(self._write_json_file, ALERTED_PATTERNS_FILE, data_copy)
        except Exception as e:
            logger.error(f"Failed to save alerted patterns: {e}")

    def _write_json_file(self, filepath: str, data) -> None:
        """Write JSON file in background thread"""
        try:
            with open(filepath, 'w') as f:
                json.dump(data, f)
        except Exception as e:
            logger.error(f"Failed to write {filepath}: {e}")

    def _load_cooldown_state(self) -> None:
        """Load cooldown state from file"""
        if not os.path.exists(COOLDOWN_STATE_FILE):
            return

        try:
            with open(COOLDOWN_STATE_FILE, 'r') as f:
                self._cooldown_state = json.load(f)
            logger.info(f"Loaded {len(self._cooldown_state)} cooldown states")
        except Exception as e:
            logger.error(f"Failed to load cooldown state: {e}")

    def _save_cooldown_state(self) -> None:
        """Save cooldown state to file (non-blocking via executor)"""
        try:
            # ✅ OPTIMIZACIÓN: Hacer copia para evitar race conditions
            data_copy = dict(self._cooldown_state)
            self._io_executor.submit(self._write_json_file, COOLDOWN_STATE_FILE, data_copy)
        except Exception as e:
            logger.error(f"Failed to save cooldown state: {e}")

    def _load_alert_history(self) -> None:
        """Load alert history from file"""
        if not os.path.exists(ALERT_HISTORY_FILE):
            return

        try:
            with open(ALERT_HISTORY_FILE, 'r') as f:
                data = json.load(f)

            self._alert_history = [AlertRecord.from_dict(r) for r in data]
            logger.info(f"Loaded {len(self._alert_history)} alert records")
        except Exception as e:
            logger.error(f"Failed to load alert history: {e}")

    def _save_alert_history(self) -> None:
        """Save alert history to file (non-blocking via executor)"""
        try:
            # ✅ OPTIMIZACIÓN: Hacer copia para evitar race conditions
            data_copy = [r.to_dict() for r in self._alert_history]
            self._io_executor.submit(self._write_json_file_pretty, ALERT_HISTORY_FILE, data_copy)
        except Exception as e:
            logger.error(f"Failed to save alert history: {e}")

    def _write_json_file_pretty(self, filepath: str, data) -> None:
        """Write JSON file with indentation in background thread"""
        try:
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to write {filepath}: {e}")

    def clear_all(self) -> None:
        """Clear all state (use with caution!)"""
        with self._lock:
            self._alerted_patterns.clear()
            self._cooldown_state.clear()
            self._alert_history.clear()
            self._save_alerted_patterns()
            self._save_cooldown_state()
            self._save_alert_history()
        logger.warning("All pattern state cleared!")


# Singleton instance
_manager_instance: Optional[PatternStateManager] = None


def get_pattern_state_manager() -> PatternStateManager:
    """Get or create the singleton PatternStateManager instance"""
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = PatternStateManager()
    return _manager_instance
