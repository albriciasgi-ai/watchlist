"""
Risk Calculator
Calculates position sizes based on risk parameters
"""

from decimal import Decimal, ROUND_DOWN
from typing import Dict, Any


class RiskCalculator:
    """
    Calculates trading quantities based on risk management parameters
    """

    def __init__(self):
        pass

    def calculate_quantity(
        self,
        risk_amount: Decimal,
        stop_loss_percent: Decimal,
        current_price: Decimal,
        min_qty: Decimal,
        max_qty: Decimal,
        step_size: Decimal
    ) -> Dict[str, Any]:
        """
        Calculate quantity based on risk parameters

        Formula (from C# bot):
        Investment = RiskAmount / StopLossPercent
        Quantity = Investment / CurrentPrice

        Args:
            risk_amount: Amount willing to risk (in USDT)
            stop_loss_percent: Stop loss percentage (e.g., 0.01 for 1%)
            current_price: Current price of the asset
            min_qty: Minimum allowed quantity
            max_qty: Maximum allowed quantity
            step_size: Step size for quantity adjustment

        Returns:
            Dict with calculated quantity and validation info
        """
        try:
            # Calculate investment based on risk
            if stop_loss_percent == 0:
                return {
                    "success": False,
                    "error": "Stop loss percentage cannot be zero"
                }

            investment = risk_amount / stop_loss_percent
            base_quantity = investment / current_price

            # Adjust to step size
            adjusted_quantity = self._adjust_to_step_size(base_quantity, step_size)

            # Validate against min/max
            if adjusted_quantity < min_qty:
                adjusted_quantity = self._adjust_to_step_size(min_qty, step_size)
                print(f"📏 Quantity adjusted to minimum: {adjusted_quantity}")

            if adjusted_quantity > max_qty:
                adjusted_quantity = self._adjust_to_step_size(max_qty, step_size)
                print(f"📏 Quantity adjusted to maximum: {adjusted_quantity}")

            # Calculate total value
            total_value = adjusted_quantity * current_price

            # Validate minimum value ($5 USD minimum from C# bot)
            if total_value < Decimal("5"):
                return {
                    "success": False,
                    "error": f"Order value ${total_value:.2f} is below minimum $5",
                    "quantity": adjusted_quantity,
                    "total_value": total_value
                }

            print(f"🧮 Risk Calculation:")
            print(f"   Risk Amount: ${risk_amount}")
            print(f"   Stop Loss %: {stop_loss_percent * 100:.2f}%")
            print(f"   Investment: ${investment:.2f}")
            print(f"   Price: ${current_price}")
            print(f"   Base Qty: {base_quantity:.8f}")
            print(f"   Adjusted Qty: {adjusted_quantity}")
            print(f"   Total Value: ${total_value:.2f}")

            return {
                "success": True,
                "quantity": adjusted_quantity,
                "investment": investment,
                "total_value": total_value,
                "risk_amount": risk_amount,
                "stop_loss_percent": stop_loss_percent
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Risk calculation error: {str(e)}"
            }

    def _adjust_to_step_size(self, qty: Decimal, step_size: Decimal) -> Decimal:
        """Adjust quantity to valid step size"""
        if step_size == 0:
            return qty

        adjusted = (qty // step_size) * step_size

        # If adjusted is 0, use minimum step_size
        if adjusted == 0 and qty > 0:
            adjusted = step_size

        return adjusted

    def validate_order_value(self, quantity: Decimal, price: Decimal, min_value: Decimal = Decimal("5")) -> bool:
        """Validate that order value meets minimum requirement"""
        total_value = quantity * price
        return total_value >= min_value
