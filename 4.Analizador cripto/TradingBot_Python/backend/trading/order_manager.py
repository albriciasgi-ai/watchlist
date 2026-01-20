"""
Order Manager
Handles complete order sequences: Market + Stop Loss + Take Profit
"""

import asyncio
from typing import Dict, Any, Optional
from decimal import Decimal, ROUND_DOWN
from .bybit_client import BybitClient


class OrderManager:
    """
    Manages order execution sequences with proper formatting and error handling
    """

    # StepSize mapping from C# bot (CRITICAL for correct order placement)
    STEP_SIZES = {
        "BTCUSDT": Decimal("0.001"),
        "ETHUSDT": Decimal("0.01"),
        "SOLUSDT": Decimal("0.1"),
        "ADAUSDT": Decimal("1"),
        "AVAXUSDT": Decimal("0.1"),
        "GALAUSDT": Decimal("10"),
        "INJUSDT": Decimal("0.1"),
        "IOTAUSDT": Decimal("0.1"),
        "TRXUSDT": Decimal("1"),
        "UNIUSDT": Decimal("0.1"),
        "XRPUSDT": Decimal("0.1"),
        "CAKEUSDT": Decimal("0.01"),
        "POLUSDT": Decimal("1"),
        "MUBARAKUSDT": Decimal("1000"),
        "HIFIUSDT": Decimal("1"),
        "ARBUSDT": Decimal("1"),
    }

    def __init__(self, bybit_client: BybitClient):
        self.client = bybit_client
        self.execution_lock = asyncio.Lock()  # Prevent concurrent executions

    def _get_step_size(self, symbol: str) -> Decimal:
        """Get StepSize for symbol"""
        return self.STEP_SIZES.get(symbol, Decimal("0.01"))

    def _adjust_to_step_size(self, qty: Decimal, step_size: Decimal) -> Decimal:
        """Adjust quantity to valid StepSize"""
        if step_size == 0:
            return qty

        adjusted = (qty // step_size) * step_size

        # If adjusted is 0, use minimum step_size
        if adjusted == 0 and qty > 0:
            adjusted = step_size

        return adjusted

    def _format_quantity(self, qty: Decimal, step_size: Decimal) -> str:
        """Format quantity as string with correct decimals"""
        # Determine decimal places from step_size
        if step_size >= 1000:
            return f"{int(qty)}"
        elif step_size >= 100:
            return f"{int(qty)}"
        elif step_size >= 10:
            return f"{int(qty)}"
        elif step_size >= 1:
            return f"{int(qty)}"
        elif step_size >= Decimal("0.1"):
            return f"{qty:.1f}"
        elif step_size >= Decimal("0.01"):
            return f"{qty:.2f}"
        elif step_size >= Decimal("0.001"):
            return f"{qty:.3f}"
        elif step_size >= Decimal("0.0001"):
            return f"{qty:.4f}"
        else:
            return f"{qty:.8f}"

    def _adjust_price_to_tick_size(self, price: Decimal, tick_size: Decimal) -> Decimal:
        """Adjust price to valid TickSize"""
        if tick_size == 0:
            return price

        return (price // tick_size) * tick_size

    def _format_price(self, price: Decimal, tick_size: Decimal) -> str:
        """Format price as string with correct decimals"""
        if tick_size >= 1:
            return f"{int(price)}"
        elif tick_size >= Decimal("0.1"):
            return f"{price:.1f}"
        elif tick_size >= Decimal("0.01"):
            return f"{price:.2f}"
        elif tick_size >= Decimal("0.001"):
            return f"{price:.3f}"
        elif tick_size >= Decimal("0.0001"):
            return f"{price:.4f}"
        elif tick_size >= Decimal("0.00001"):
            return f"{price:.5f}"
        else:
            return f"{price:.8f}"

    def _get_opposite_side(self, side: str) -> str:
        """Get opposite side for closing position"""
        return "Sell" if side == "Buy" else "Buy"

    def _calculate_sl_price(
        self,
        entry_price: Decimal,
        side: str,
        sl_percent: Decimal
    ) -> Decimal:
        """Calculate stop loss price"""
        if side == "Buy":
            # LONG: SL below entry price
            return entry_price * (Decimal("1") - sl_percent)
        else:
            # SHORT: SL above entry price
            return entry_price * (Decimal("1") + sl_percent)

    def _calculate_tp_price(
        self,
        entry_price: Decimal,
        side: str,
        tp_percent: Decimal
    ) -> Decimal:
        """Calculate take profit price"""
        if side == "Buy":
            # LONG: TP above entry price
            return entry_price * (Decimal("1") + tp_percent)
        else:
            # SHORT: TP below entry price
            return entry_price * (Decimal("1") - tp_percent)

    async def execute_complete_sequence(
        self,
        symbol: str,
        side: str,
        quantity: Decimal,
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute complete trading sequence: Market Order + SL + TP

        Args:
            symbol: Trading pair
            side: "Buy" or "Sell"
            quantity: Quantity to trade
            config: Coin configuration with SL%, TP%, TickSize, etc.

        Returns:
            Dict with execution results
        """
        async with self.execution_lock:
            print(f"\n{'='*60}")
            print(f"[EXECUTE] Executing Complete Sequence: {side} {symbol}")
            print(f"{'='*60}")

            result = {
                "symbol": symbol,
                "side": side,
                "market_order": None,
                "stop_loss": None,
                "take_profit": None,
                "success": False
            }

            try:
                # Step 1: Format quantity
                step_size = self._get_step_size(symbol)
                adjusted_qty = self._adjust_to_step_size(quantity, step_size)
                formatted_qty = self._format_quantity(adjusted_qty, step_size)

                print(f"[QTY] Quantity: {quantity} -> {adjusted_qty} -> '{formatted_qty}' (step={step_size})")

                # Step 2: Execute Market Order
                market_result = await self.client.place_market_order(
                    symbol=symbol,
                    side=side,
                    qty=formatted_qty,
                    category=config.get("category", "linear")
                )

                result["market_order"] = market_result

                if market_result.get("retCode") != 0:
                    print(f"[ERROR] Market order failed, aborting sequence")
                    return result

                # Step 3: Wait for execution and get real price
                await asyncio.sleep(3)

                position = await self.client.get_position(symbol)
                if position.get("hasPosition"):
                    real_price = Decimal(position["entryPrice"])
                    print(f"[PRICE] Real execution price: ${real_price}")
                else:
                    print(f"[WARNING] Could not get real price, using config price")
                    real_price = Decimal(str(config.get("current_price", 0)))

                if real_price == 0:
                    print(f"[ERROR] Invalid real price, aborting SL/TP")
                    return result

                # Step 4: Calculate SL and TP prices
                tick_size = Decimal(str(config.get("tick_size", "0.01")))
                sl_percent = Decimal(str(config.get("stop_loss_percent", "0.01")))
                tp_percent = Decimal(str(config.get("take_profit_percent", "0.02")))

                sl_price = self._calculate_sl_price(real_price, side, sl_percent)
                tp_price = self._calculate_tp_price(real_price, side, tp_percent)

                sl_price = self._adjust_price_to_tick_size(sl_price, tick_size)
                tp_price = self._adjust_price_to_tick_size(tp_price, tick_size)

                formatted_sl = self._format_price(sl_price, tick_size)
                formatted_tp = self._format_price(tp_price, tick_size)

                print(f"[SL] Stop Loss: ${formatted_sl} ({sl_percent*100:.1f}% from entry)")
                print(f"[TP] Take Profit: ${formatted_tp} ({tp_percent*100:.1f}% from entry)")

                # Step 5: Place Stop Loss
                opposite_side = self._get_opposite_side(side)

                await asyncio.sleep(1)  # Small delay between orders

                sl_result = await self.client.place_stop_loss_order(
                    symbol=symbol,
                    side=opposite_side,
                    qty=formatted_qty,
                    trigger_price=formatted_sl,
                    category=config.get("category", "linear")
                )

                result["stop_loss"] = sl_result

                if sl_result.get("retCode") != 0:
                    print(f"[WARNING] Stop Loss placement failed")

                # Step 6: Place Take Profit
                await asyncio.sleep(1)

                tp_result = await self.client.place_take_profit_order(
                    symbol=symbol,
                    side=opposite_side,
                    qty=formatted_qty,
                    price=formatted_tp,
                    category=config.get("category", "linear")
                )

                result["take_profit"] = tp_result

                if tp_result.get("retCode") != 0:
                    print(f"[WARNING] Take Profit placement failed")

                # Determine overall success
                result["success"] = market_result.get("retCode") == 0

                print(f"\n{'='*60}")
                if result["success"]:
                    print(f"[SUCCESS] Sequence completed successfully!")
                else:
                    print(f"[WARNING] Sequence completed with warnings")
                print(f"{'='*60}\n")

                return result

            except Exception as e:
                print(f"[ERROR] Critical error in order sequence: {e}")
                import traceback
                traceback.print_exc()
                result["error"] = str(e)
                # Check if market order succeeded despite later errors
                if result.get("market_order", {}).get("retCode") == 0:
                    result["success"] = True
                    result["partial"] = True
                    print(f"[WARNING] Market Order succeeded, but SL/TP failed: {str(e)}")
                else:
                    result["success"] = False
                return result
