"""
Trading Direction Manager
Manages allowed trading directions (LONG/SHORT/BOTH/DISABLED) per symbol
"""

import json
from pathlib import Path
from typing import Dict, Optional, Literal
from datetime import datetime


DirectionType = Literal["LONG", "SHORT", "BOTH", "DISABLED"]


class DirectionManager:
    """
    Manages trading direction filters for each symbol
    Prevents unwanted trades based on configured directions
    """

    def __init__(self, config_file: str = "../config/trading_directions.json"):
        self.config_file = Path(config_file)
        self.directions: Dict[str, DirectionType] = {}
        self.load()

    def load(self):
        """Load directions from JSON file"""
        if self.config_file.exists():
            try:
                with open(self.config_file, 'r') as f:
                    data = json.load(f)
                    self.directions = data.get("directions", {})
                    print(f"[OK] Loaded trading directions: {len(self.directions)} symbols configured")
            except Exception as e:
                print(f"[WARNING] Error loading trading directions: {e}")
                self.directions = {}
        else:
            print(f"[WARNING] No trading directions file found, all symbols disabled by default")
            self.directions = {}

    def save(self):
        """Save directions to JSON file"""
        try:
            self.config_file.parent.mkdir(parents=True, exist_ok=True)

            data = {
                "directions": self.directions,
                "last_updated": datetime.now().isoformat()
            }

            with open(self.config_file, 'w') as f:
                json.dump(data, f, indent=2)

            print(f"[OK] Trading directions saved")
        except Exception as e:
            print(f"[ERROR] Error saving trading directions: {e}")

    def set_direction(self, symbol: str, direction: DirectionType):
        """Set trading direction for a symbol"""
        symbol = symbol.upper()
        self.directions[symbol] = direction
        self.save()
        print(f"[OK] {symbol}: Direction set to {direction}")

    def get_direction(self, symbol: str) -> DirectionType:
        """Get trading direction for a symbol"""
        symbol = symbol.upper()
        return self.directions.get(symbol, "DISABLED")

    def is_alert_allowed(self, symbol: str, side: str) -> bool:
        """
        Check if an alert is allowed based on configured direction

        Args:
            symbol: Trading pair
            side: "Buy" or "Sell"

        Returns:
            True if alert is allowed, False otherwise
        """
        symbol = symbol.upper()
        direction = self.get_direction(symbol)

        # Symbol must be enabled
        if direction == "DISABLED":
            print(f"[REJECTED] Alert REJECTED: {symbol} is DISABLED")
            return False

        # Check direction match
        if direction == "BOTH":
            print(f"[ALLOWED] Alert ALLOWED: {symbol} accepts {side} (direction=BOTH)")
            return True
        elif direction == "LONG" and side == "Buy":
            print(f"[ALLOWED] Alert ALLOWED: {symbol} accepts Buy (direction=LONG)")
            return True
        elif direction == "SHORT" and side == "Sell":
            print(f"[ALLOWED] Alert ALLOWED: {symbol} accepts Sell (direction=SHORT)")
            return True
        else:
            print(f"[REJECTED] Alert REJECTED: {symbol} side={side} but direction={direction}")
            return False

    def enable_symbol(self, symbol: str, direction: DirectionType = "BOTH"):
        """Enable a symbol with specified direction"""
        self.set_direction(symbol, direction)

    def disable_symbol(self, symbol: str):
        """Disable trading for a symbol"""
        self.set_direction(symbol, "DISABLED")

    def get_stats(self) -> Dict[str, int]:
        """Get statistics about configured symbols"""
        stats = {
            "total": len(self.directions),
            "active": sum(1 for d in self.directions.values() if d != "DISABLED"),
            "long": sum(1 for d in self.directions.values() if d == "LONG"),
            "short": sum(1 for d in self.directions.values() if d == "SHORT"),
            "both": sum(1 for d in self.directions.values() if d == "BOTH"),
            "disabled": sum(1 for d in self.directions.values() if d == "DISABLED")
        }
        return stats

    def get_all_directions(self) -> Dict[str, DirectionType]:
        """Get all configured directions"""
        return self.directions.copy()
