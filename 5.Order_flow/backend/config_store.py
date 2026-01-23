"""
Config Store for Real-time Pattern Detection

Stores synchronized configurations and calculated levels from the frontend.
Allows the backend to use the same config and levels for pattern detection.

Author: Claude Code
Date: 2025-01-16
"""

import json
import os
import time
import logging
from typing import Dict, Optional, Any
from dataclasses import dataclass, field, asdict
from threading import Lock

logger = logging.getLogger(__name__)

# Config directory
CONFIG_DIR = os.path.join(os.path.dirname(__file__), 'config')
CONFIG_FILE = os.path.join(CONFIG_DIR, 'realtime_configs.json')


@dataclass
class IndicatorConfig:
    """Configuration for a single indicator on a symbol/interval"""
    indicator_type: str  # 'doubleTopBottom' or 'rejection'
    config: Dict = field(default_factory=dict)
    calculated_levels: Dict = field(default_factory=dict)
    updated_at: float = 0

    def to_dict(self) -> Dict:
        return {
            'indicator_type': self.indicator_type,
            'config': self.config,
            'calculated_levels': self.calculated_levels,
            'updated_at': self.updated_at
        }


@dataclass
class SymbolConfig:
    """All configurations for a symbol across intervals"""
    symbol: str
    intervals: Dict[str, Dict[str, IndicatorConfig]] = field(default_factory=dict)
    # intervals[interval][indicator_type] = IndicatorConfig

    def to_dict(self) -> Dict:
        result = {'symbol': self.symbol, 'intervals': {}}
        for interval, indicators in self.intervals.items():
            result['intervals'][interval] = {}
            for ind_type, config in indicators.items():
                result['intervals'][interval][ind_type] = config.to_dict()
        return result


class ConfigStore:
    """
    Thread-safe store for indicator configurations and calculated levels.

    Features:
    - Store configs per symbol/interval/indicator_type
    - Store calculated levels (VWAP, S/R, zones, fixed ranges)
    - Persist to JSON file
    - Auto-load on startup
    """

    def __init__(self):
        self._configs: Dict[str, SymbolConfig] = {}  # {symbol: SymbolConfig}
        self._lock = Lock()
        self._dirty = False  # Track if we need to save

        # Ensure config directory exists
        os.makedirs(CONFIG_DIR, exist_ok=True)

        # Load existing configs
        self._load_from_file()

        logger.info(f"ConfigStore initialized with {len(self._configs)} symbols")

    def update(self, symbol: str, interval: str, indicator_type: str,
               config: Dict = None, calculated_levels: Dict = None) -> None:
        """
        Update configuration for a symbol/interval/indicator.

        Args:
            symbol: Trading pair (e.g., "BTCUSDT")
            interval: Timeframe (e.g., "240")
            indicator_type: "doubleTopBottom" or "rejection"
            config: Full indicator configuration
            calculated_levels: Levels calculated by frontend (VWAP, S/R, etc.)
        """
        with self._lock:
            # Ensure symbol config exists
            if symbol not in self._configs:
                self._configs[symbol] = SymbolConfig(symbol=symbol)

            symbol_config = self._configs[symbol]

            # Ensure interval dict exists
            if interval not in symbol_config.intervals:
                symbol_config.intervals[interval] = {}

            # Get or create indicator config
            if indicator_type not in symbol_config.intervals[interval]:
                symbol_config.intervals[interval][indicator_type] = IndicatorConfig(
                    indicator_type=indicator_type
                )

            ind_config = symbol_config.intervals[interval][indicator_type]

            # Update fields if provided
            if config is not None:
                ind_config.config = config
            if calculated_levels is not None:
                # Merge calculated levels (don't replace entirely)
                ind_config.calculated_levels.update(calculated_levels)

            ind_config.updated_at = time.time()
            self._dirty = True

            logger.debug(f"Updated config: {symbol}/{interval}/{indicator_type}")

    def get(self, symbol: str, interval: str, indicator_type: str) -> Optional[IndicatorConfig]:
        """Get configuration for a symbol/interval/indicator"""
        with self._lock:
            symbol_config = self._configs.get(symbol)
            if not symbol_config:
                return None

            interval_config = symbol_config.intervals.get(interval)
            if not interval_config:
                return None

            return interval_config.get(indicator_type)

    def get_config(self, symbol: str, interval: str, indicator_type: str) -> Dict:
        """Get just the config dict (convenience method)"""
        ind_config = self.get(symbol, interval, indicator_type)
        return ind_config.config if ind_config else {}

    def get_levels(self, symbol: str, interval: str, indicator_type: str = None) -> Dict:
        """
        Get calculated levels for a symbol/interval.
        If indicator_type is None, merge levels from all indicators.
        """
        with self._lock:
            symbol_config = self._configs.get(symbol)
            if not symbol_config:
                return {}

            interval_config = symbol_config.intervals.get(interval)
            if not interval_config:
                return {}

            if indicator_type:
                ind_config = interval_config.get(indicator_type)
                return ind_config.calculated_levels if ind_config else {}

            # Merge levels from all indicators
            merged = {}
            for ind_config in interval_config.values():
                merged.update(ind_config.calculated_levels)
            return merged

    def get_all_symbols(self) -> list:
        """Get list of all configured symbols"""
        with self._lock:
            return list(self._configs.keys())

    def get_symbol_intervals(self, symbol: str) -> list:
        """Get list of configured intervals for a symbol"""
        with self._lock:
            symbol_config = self._configs.get(symbol)
            if not symbol_config:
                return []
            return list(symbol_config.intervals.keys())

    def get_active_configs(self) -> list:
        """
        Get list of all active (symbol, interval, indicator_type) tuples.
        Useful for knowing what to monitor.
        """
        with self._lock:
            result = []
            for symbol, symbol_config in self._configs.items():
                for interval, indicators in symbol_config.intervals.items():
                    for indicator_type in indicators.keys():
                        result.append((symbol, interval, indicator_type))
            return result

    def is_alerts_enabled(self, symbol: str, interval: str, indicator_type: str) -> bool:
        """Check if alerts are enabled for a specific config"""
        config = self.get_config(symbol, interval, indicator_type)
        return config.get('alertsEnabled', False)

    def save(self) -> None:
        """Save configs to file"""
        with self._lock:
            if not self._dirty:
                return

            try:
                data = {
                    symbol: config.to_dict()
                    for symbol, config in self._configs.items()
                }

                with open(CONFIG_FILE, 'w') as f:
                    json.dump(data, f, indent=2)

                self._dirty = False
                logger.debug(f"Saved configs to {CONFIG_FILE}")
            except Exception as e:
                logger.error(f"Failed to save configs: {e}")

    def _load_from_file(self) -> None:
        """Load configs from file"""
        if not os.path.exists(CONFIG_FILE):
            logger.info("No existing config file found")
            return

        try:
            with open(CONFIG_FILE, 'r') as f:
                data = json.load(f)

            for symbol, symbol_data in data.items():
                symbol_config = SymbolConfig(symbol=symbol)

                for interval, indicators in symbol_data.get('intervals', {}).items():
                    symbol_config.intervals[interval] = {}

                    for ind_type, ind_data in indicators.items():
                        symbol_config.intervals[interval][ind_type] = IndicatorConfig(
                            indicator_type=ind_data.get('indicator_type', ind_type),
                            config=ind_data.get('config', {}),
                            calculated_levels=ind_data.get('calculated_levels', {}),
                            updated_at=ind_data.get('updated_at', 0)
                        )

                self._configs[symbol] = symbol_config

            logger.info(f"Loaded configs for {len(self._configs)} symbols from file")
        except Exception as e:
            logger.error(f"Failed to load configs: {e}")

    def clear(self, symbol: str = None) -> None:
        """Clear configs (all or for a specific symbol)"""
        with self._lock:
            if symbol:
                if symbol in self._configs:
                    del self._configs[symbol]
            else:
                self._configs.clear()
            self._dirty = True

    def get_stats(self) -> Dict:
        """Get statistics about stored configs"""
        with self._lock:
            total_configs = 0
            symbols_with_alerts = 0

            for symbol, symbol_config in self._configs.items():
                has_alerts = False
                for interval, indicators in symbol_config.intervals.items():
                    for ind_type, ind_config in indicators.items():
                        total_configs += 1
                        if ind_config.config.get('alertsEnabled', False):
                            has_alerts = True
                if has_alerts:
                    symbols_with_alerts += 1

            return {
                'total_symbols': len(self._configs),
                'total_configs': total_configs,
                'symbols_with_alerts_enabled': symbols_with_alerts,
                'config_file': CONFIG_FILE
            }


# Singleton instance
_store_instance: Optional[ConfigStore] = None


def get_config_store() -> ConfigStore:
    """Get or create the singleton ConfigStore instance"""
    global _store_instance
    if _store_instance is None:
        _store_instance = ConfigStore()
    return _store_instance
