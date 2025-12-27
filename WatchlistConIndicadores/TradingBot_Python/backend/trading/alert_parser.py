"""
Alert Parser
Parses ATAS trading alerts and extracts symbol, side, and price
"""

import re
from typing import Optional, Dict, Any
from decimal import Decimal


class AlertParser:
    """
    Parses ATAS alert messages
    Format: [timestamp] [SYMBOL] ABRIR LONG/SHORT price
    """

    def __init__(self):
        pass

    def parse(self, raw_alert: str) -> Optional[Dict[str, Any]]:
        """
        Parse ATAS alert message

        Supported formats:
        1. [timestamp] [BTCUSDT] ABRIR LONG 95000
        2. BTCUSDT\nBuy\nPrice: 95000.00
        3. Simple: BTCUSDT Long 95000

        Args:
            raw_alert: Raw alert string

        Returns:
            Dict with symbol, side, price or None if parsing fails
        """
        if not raw_alert or not raw_alert.strip():
            print("⚠️ Empty alert received")
            return None

        original = raw_alert.strip()
        # Normalize: replace comma with dot for decimal parsing
        normalized = original.replace(",", ".")

        # Split by lines for multi-line format
        lines = [line.strip() for line in normalized.split('\n') if line.strip()]

        try:
            symbol = None
            side = None
            price = None

            # Try Format 1: Bracket format [timestamp] [SYMBOL] ABRIR LONG price
            bracket_matches = re.findall(r'\[(.*?)\]', normalized)
            if len(bracket_matches) >= 2:
                symbol = bracket_matches[1].strip().upper()
                # Detect side from text
                if re.search(r'\b(ABRIR\s+LONG|ABRIR\s+BUY|OPEN\s+LONG|BUY|LONG|BULLISH)\b', normalized, re.IGNORECASE):
                    side = "Buy"
                elif re.search(r'\b(ABRIR\s+SHORT|ABRIR\s+SELL|OPEN\s+SHORT|SELL|SHORT|BEARISH)\b', normalized, re.IGNORECASE):
                    side = "Sell"
                # Extract price (last number)
                number_matches = re.findall(r'[-+]?\d*\.?\d+', normalized)
                if number_matches:
                    price = Decimal(number_matches[-1])

            # Try Format 2: Multi-line format
            elif len(lines) >= 2:
                # Line 1: Symbol (e.g., BTCUSDT)
                potential_symbol = lines[0].upper()
                if 'USDT' in potential_symbol or 'BTC' in potential_symbol:
                    symbol = potential_symbol

                # Line 2 or text: Side (Buy/Sell/Long/Short)
                for line in lines[1:]:
                    if re.search(r'\b(BUY|LONG|BULLISH)\b', line, re.IGNORECASE):
                        side = "Buy"
                        break
                    elif re.search(r'\b(SELL|SHORT|BEARISH)\b', line, re.IGNORECASE):
                        side = "Sell"
                        break

                # Find price (look for "Price:" or last number)
                for line in lines:
                    if 'price' in line.lower():
                        # Extract number after "Price:"
                        price_match = re.search(r'price\s*:?\s*([\d.]+)', line, re.IGNORECASE)
                        if price_match:
                            price = Decimal(price_match.group(1))
                            break

                # If no "Price:" found, take last number in entire text
                if not price:
                    number_matches = re.findall(r'[-+]?\d*\.?\d+', normalized)
                    if number_matches:
                        price = Decimal(number_matches[-1])

            # Try Format 3: Simple single line (BTCUSDT Long 95000)
            else:
                # Find symbol (word with USDT)
                symbol_match = re.search(r'\b([A-Z]+USDT)\b', normalized, re.IGNORECASE)
                if symbol_match:
                    symbol = symbol_match.group(1).upper()

                # Detect side
                if re.search(r'\b(BUY|LONG|BULLISH)\b', normalized, re.IGNORECASE):
                    side = "Buy"
                elif re.search(r'\b(SELL|SHORT|BEARISH)\b', normalized, re.IGNORECASE):
                    side = "Sell"

                # Extract price
                number_matches = re.findall(r'[-+]?\d*\.?\d+', normalized)
                if number_matches:
                    price = Decimal(number_matches[-1])

            # Validate we got all required fields
            if not symbol:
                print(f"⚠️ Could not extract symbol from alert: {original}")
                return None

            if not side:
                print(f"⚠️ Could not detect side (Buy/Sell) in alert: {original}")
                return None

            if not price or price <= 0:
                print(f"⚠️ Could not extract valid price from alert: {original}")
                return None

            print(f"✅ Alert parsed: {side} {symbol} @ ${price}")

            return {
                "raw": original,
                "symbol": symbol,
                "side": side,
                "price": price
            }

        except Exception as e:
            print(f"❌ Error parsing alert: {e}")
            print(f"   Alert: {original}")
            import traceback
            traceback.print_exc()
            return None

    def validate_alert(self, alert: Dict[str, Any]) -> bool:
        """Validate parsed alert"""
        if not alert:
            return False

        required_fields = ["symbol", "side", "price"]
        for field in required_fields:
            if field not in alert:
                print(f"⚠️ Missing required field: {field}")
                return False

        if alert["price"] <= 0:
            print(f"⚠️ Invalid price: {alert['price']}")
            return False

        if alert["side"] not in ["Buy", "Sell"]:
            print(f"⚠️ Invalid side: {alert['side']}")
            return False

        return True
