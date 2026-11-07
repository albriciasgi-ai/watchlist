"""
Risk Calculator
Calculates position sizes based on risk parameters

Noviembre 2026:
- El riesgo incluye las comisiones de entrada y salida (taker, ambas a mercado)
- La cantidad nunca se redondea hacia arriba: si el minimo de Bybit arriesga mas que lo
  configurado, la operacion se rechaza
"""

from decimal import Decimal, ROUND_FLOOR
from typing import Dict, Any

# Comision taker VIP 0 de Bybit en perpetuos USDT (entrada a mercado y SL a mercado)
DEFAULT_TAKER_FEE = Decimal("0.00055")


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
        step_size: Decimal,
        fee_rate: Decimal = DEFAULT_TAKER_FEE
    ) -> Dict[str, Any]:
        """
        Calculate quantity based on risk parameters

        Formula:
        Costo por unidad al SL = StopLossPercent + 2 * comision taker (entrada y salida)
        Investment = RiskAmount / costo
        Quantity = Investment / CurrentPrice (al paso, hacia abajo)

        Args:
            risk_amount: Amount willing to risk (in USDT), comisiones incluidas
            stop_loss_percent: Stop loss percentage (e.g., 0.01 for 1%)
            current_price: Current price of the asset
            min_qty: Minimum allowed quantity
            max_qty: Maximum allowed quantity
            step_size: Step size for quantity adjustment
            fee_rate: comision taker por lado

        Returns:
            Dict with calculated quantity and validation info
        """
        try:
            risk_amount = Decimal(str(risk_amount))
            stop_loss_percent = Decimal(str(stop_loss_percent))
            current_price = Decimal(str(current_price))
            fee_rate = Decimal(str(fee_rate or 0))

            # Calculate investment based on risk
            if stop_loss_percent <= 0:
                return {
                    "success": False,
                    "error": "Stop loss percentage cannot be zero"
                }
            if current_price <= 0:
                return {
                    "success": False,
                    "error": "Price must be greater than zero"
                }

            cost_percent = stop_loss_percent + 2 * fee_rate
            investment = risk_amount / cost_percent
            base_quantity = investment / current_price

            # Adjust to step size (siempre hacia abajo)
            adjusted_quantity = self._adjust_to_step_size(base_quantity, step_size)

            if max_qty and adjusted_quantity > max_qty:
                adjusted_quantity = self._adjust_to_step_size(Decimal(str(max_qty)), step_size)
                print(f"[QTY] Quantity adjusted to maximum: {adjusted_quantity}")

            min_allowed = max(Decimal(str(min_qty or 0)), Decimal(str(step_size or 0)))
            if adjusted_quantity <= 0 or adjusted_quantity < min_allowed:
                min_risk = min_allowed * current_price * cost_percent
                return {
                    "success": False,
                    "error": (f"La cantidad minima de Bybit ({min_allowed}) arriesgaria ${min_risk:.2f} con un SL de "
                              f"{stop_loss_percent * 100:.2f}%, mas que el riesgo configurado (${risk_amount}). Orden no enviada."),
                    "quantity": adjusted_quantity,
                    "min_risk": min_risk
                }

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

            planned_risk = adjusted_quantity * current_price * cost_percent

            print(f"[RISK] Risk Calculation:")
            print(f"   Risk Amount: ${risk_amount} (incluye comisiones {fee_rate * 100:.3f}% x2)")
            print(f"   Stop Loss %: {stop_loss_percent * 100:.3f}%")
            print(f"   Investment: ${investment:.2f}")
            print(f"   Price: ${current_price}")
            print(f"   Base Qty: {base_quantity:.8f}")
            print(f"   Adjusted Qty: {adjusted_quantity}")
            print(f"   Total Value: ${total_value:.2f}")
            print(f"   Planned risk at SL: ${planned_risk:.4f}")

            return {
                "success": True,
                "quantity": adjusted_quantity,
                "investment": investment,
                "total_value": total_value,
                "risk_amount": risk_amount,
                "planned_risk": planned_risk,
                "stop_loss_percent": stop_loss_percent
            }

        except Exception as e:
            return {
                "success": False,
                "error": f"Risk calculation error: {str(e)}"
            }

    def _adjust_to_step_size(self, qty: Decimal, step_size: Decimal) -> Decimal:
        """Adjust quantity to valid step size (hacia abajo, nunca hacia arriba)"""
        step_size = Decimal(str(step_size or 0))
        if step_size == 0:
            return qty

        return (qty / step_size).to_integral_value(rounding=ROUND_FLOOR) * step_size

    def risk_for(self, quantity: Decimal, entry_price: Decimal, sl_price: Decimal,
                 fee_rate: Decimal = DEFAULT_TAKER_FEE) -> Decimal:
        """Perdida al SL de una cantidad dada, con comisiones de entrada y salida."""
        quantity = Decimal(str(quantity))
        entry_price = Decimal(str(entry_price))
        sl_price = Decimal(str(sl_price))
        fee_rate = Decimal(str(fee_rate or 0))
        return quantity * (abs(entry_price - sl_price) + (entry_price + sl_price) * fee_rate)

    def validate_order_value(self, quantity: Decimal, price: Decimal, min_value: Decimal = Decimal("5")) -> bool:
        """Validate that order value meets minimum requirement"""
        total_value = quantity * price
        return total_value >= min_value
