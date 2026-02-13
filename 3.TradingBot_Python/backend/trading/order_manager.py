"""
Order Manager
Handles complete order sequences: Market + Stop Loss + Take Profit

Optimizations (January 2026):
- Lock per symbol (not global) for parallel execution
- Intelligent polling instead of fixed sleeps
- Automatic retry for SL/TP with critical alerts
- Detailed timing logs
"""

import asyncio
import time
import logging
from typing import Dict, Any, Optional, Callable
from decimal import Decimal, ROUND_DOWN
from .bybit_client import BybitClient

logger = logging.getLogger("order_manager")


class OrderManager:
    """
    Manages order execution sequences with proper formatting and error handling

    Features:
    - Per-symbol locking for parallel execution of different symbols
    - Intelligent polling for position confirmation
    - Automatic retry for stop loss and take profit orders
    - Critical alerts when protection orders fail
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
        "DOGEUSDT": Decimal("1"),
        "DOTUSDT": Decimal("0.1"),
        "LINKUSDT": Decimal("0.01"),
        "NEARUSDT": Decimal("0.1"),
    }

    # Polling configuration
    POSITION_POLL_INTERVAL_MS = 200  # Poll every 200ms
    POSITION_POLL_TIMEOUT_S = 5.0    # Max 5 seconds to wait for position
    SL_TP_MAX_RETRIES = 3            # Retry SL/TP up to 3 times
    SL_TP_RETRY_DELAY_MS = 300       # Wait 300ms between retries

    def __init__(self, bybit_client: BybitClient):
        self.client = bybit_client

        # Per-symbol locks for parallel execution
        self._symbol_locks: Dict[str, asyncio.Lock] = {}

        # Callback for critical alerts (set by main.py)
        self._critical_alert_callback: Optional[Callable] = None

        # Statistics
        self._total_executions = 0
        self._successful_executions = 0
        self._failed_sl_count = 0
        self._failed_tp_count = 0

    def set_critical_alert_callback(self, callback: Callable) -> None:
        """Set callback for critical alerts (e.g., when SL fails)"""
        self._critical_alert_callback = callback

    def _get_symbol_lock(self, symbol: str) -> asyncio.Lock:
        """Get or create a lock for a specific symbol"""
        if symbol not in self._symbol_locks:
            self._symbol_locks[symbol] = asyncio.Lock()
        return self._symbol_locks[symbol]

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

    def _validate_tpsl_coherence(
        self,
        real_price: Decimal,
        side: str,
        sl_price: Decimal,
        tp_price: Decimal
    ) -> tuple:
        """
        Validate that custom SL/TP prices make sense relative to the real execution price.
        Returns (sl_valid, tp_valid) tuple.

        For LONG (Buy): SL must be below entry, TP must be above entry
        For SHORT (Sell): SL must be above entry, TP must be below entry
        """
        if side == "Buy":
            # LONG position
            sl_valid = sl_price < real_price
            tp_valid = tp_price > real_price
        else:
            # SHORT position
            sl_valid = sl_price > real_price
            tp_valid = tp_price < real_price

        return (sl_valid, tp_valid)

    async def _wait_for_position(
        self,
        symbol: str,
        timeout_seconds: float = None
    ) -> Optional[Dict[str, Any]]:
        """
        Intelligently poll for position confirmation.
        Much faster than fixed sleep - typically returns in 200-600ms.

        Args:
            symbol: Trading pair
            timeout_seconds: Max time to wait (default: POSITION_POLL_TIMEOUT_S)

        Returns:
            Position dict if found, None if timeout
        """
        timeout = timeout_seconds or self.POSITION_POLL_TIMEOUT_S
        start_time = time.monotonic()
        poll_count = 0

        while (time.monotonic() - start_time) < timeout:
            poll_count += 1
            position = await self.client.get_position(symbol)

            if position.get("hasPosition") and position.get("entryPrice"):
                elapsed_ms = (time.monotonic() - start_time) * 1000
                logger.info(f"[EXECUTE] Position confirmed in {elapsed_ms:.0f}ms ({poll_count} polls)")
                return position

            # Wait before next poll
            await asyncio.sleep(self.POSITION_POLL_INTERVAL_MS / 1000.0)

        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(f"[EXECUTE] Position poll TIMEOUT after {elapsed_ms:.0f}ms ({poll_count} polls)")
        return None

    async def _place_sl_with_retry(
        self,
        symbol: str,
        side: str,
        qty: str,
        trigger_price: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place stop loss with automatic retry.

        Returns:
            Result dict with success status
        """
        for attempt in range(self.SL_TP_MAX_RETRIES):
            result = await self.client.place_stop_loss_order(
                symbol=symbol,
                side=side,
                qty=qty,
                trigger_price=trigger_price,
                category=category
            )

            if result.get("retCode") == 0:
                return result

            # Log retry attempt
            error_msg = result.get("retMsg", "Unknown error")
            logger.warning(f"[EXECUTE] [SL RETRY] Attempt {attempt + 1}/{self.SL_TP_MAX_RETRIES} failed: {error_msg}")

            if attempt < self.SL_TP_MAX_RETRIES - 1:
                await asyncio.sleep(self.SL_TP_RETRY_DELAY_MS / 1000.0)

        # All retries failed - send critical alert
        self._failed_sl_count += 1
        await self._send_critical_alert(
            symbol=symbol,
            alert_type="SL_FAILED",
            message=f"Stop Loss placement failed after {self.SL_TP_MAX_RETRIES} retries! Position is UNPROTECTED!"
        )

        return result

    async def _place_tp_with_retry(
        self,
        symbol: str,
        side: str,
        qty: str,
        price: str,
        category: str = "linear"
    ) -> Dict[str, Any]:
        """
        Place take profit with automatic retry.

        Returns:
            Result dict with success status
        """
        for attempt in range(self.SL_TP_MAX_RETRIES):
            result = await self.client.place_take_profit_order(
                symbol=symbol,
                side=side,
                qty=qty,
                price=price,
                category=category
            )

            if result.get("retCode") == 0:
                return result

            # Log retry attempt
            error_msg = result.get("retMsg", "Unknown error")
            logger.warning(f"[EXECUTE] [TP RETRY] Attempt {attempt + 1}/{self.SL_TP_MAX_RETRIES} failed: {error_msg}")

            if attempt < self.SL_TP_MAX_RETRIES - 1:
                await asyncio.sleep(self.SL_TP_RETRY_DELAY_MS / 1000.0)

        # All retries failed - send critical alert (less urgent than SL)
        self._failed_tp_count += 1
        await self._send_critical_alert(
            symbol=symbol,
            alert_type="TP_FAILED",
            message=f"Take Profit placement failed after {self.SL_TP_MAX_RETRIES} retries."
        )

        return result

    async def _send_critical_alert(
        self,
        symbol: str,
        alert_type: str,
        message: str
    ) -> None:
        """Send critical alert via callback and log"""
        alert = {
            "type": alert_type,
            "symbol": symbol,
            "message": message,
            "timestamp": time.time(),
            "severity": "CRITICAL" if "SL" in alert_type else "WARNING"
        }

        # Log prominently
        logger.critical(f"[EXECUTE] CRITICAL ALERT {alert_type}: {symbol} - {message}")

        # Call callback if set
        if self._critical_alert_callback:
            try:
                await self._critical_alert_callback(alert)
            except Exception as e:
                logger.error(f"[EXECUTE] Failed to send critical alert callback: {e}")

    async def execute_complete_sequence(
        self,
        symbol: str,
        side: str,
        quantity: Decimal,
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Execute complete trading sequence: Market Order + SL + TP

        Now uses per-symbol locking for parallel execution and
        intelligent polling instead of fixed sleeps.

        Args:
            symbol: Trading pair
            side: "Buy" or "Sell"
            quantity: Quantity to trade
            config: Coin configuration with SL%, TP%, TickSize, etc.

        Returns:
            Dict with execution results
        """
        # Use per-symbol lock (allows parallel execution of different symbols)
        symbol_lock = self._get_symbol_lock(symbol)

        async with symbol_lock:
            sequence_start = time.monotonic()
            self._total_executions += 1

            logger.info(f"[EXECUTE] ========== Complete Sequence: {side} {symbol} ==========")

            result = {
                "symbol": symbol,
                "side": side,
                "market_order": None,
                "stop_loss": None,
                "take_profit": None,
                "success": False,
                "timing": {}
            }

            try:
                # Step 1: Format quantity
                step_size = self._get_step_size(symbol)
                adjusted_qty = self._adjust_to_step_size(quantity, step_size)
                formatted_qty = self._format_quantity(adjusted_qty, step_size)

                logger.info(f"[EXECUTE] Quantity: {quantity} -> {adjusted_qty} -> '{formatted_qty}' (step={step_size})")

                # Step 2: Execute Market Order
                market_start = time.monotonic()
                market_result = await self.client.place_market_order(
                    symbol=symbol,
                    side=side,
                    qty=formatted_qty,
                    category=config.get("category", "linear")
                )
                result["timing"]["market_order_ms"] = (time.monotonic() - market_start) * 1000

                result["market_order"] = market_result

                if market_result.get("retCode") != 0:
                    error_msg = market_result.get("retMsg", "Unknown Bybit error")
                    logger.error(f"[EXECUTE] Market order failed: retCode={market_result.get('retCode')}, retMsg={error_msg}")
                    result["error"] = f"Market order failed: {error_msg} (retCode={market_result.get('retCode')})"
                    return result

                # Step 3: Wait for position with intelligent polling (NOT fixed sleep)
                poll_start = time.monotonic()
                position = await self._wait_for_position(symbol)
                result["timing"]["position_poll_ms"] = (time.monotonic() - poll_start) * 1000

                if position and position.get("hasPosition"):
                    real_price = Decimal(position["entryPrice"])
                    logger.info(f"[EXECUTE] Real execution price: ${real_price}")
                else:
                    logger.warning(f"[EXECUTE] Could not get real price, using config price")
                    real_price = Decimal(str(config.get("current_price", 0)))

                if real_price == 0:
                    logger.error(f"[EXECUTE] Invalid real price (0), aborting SL/TP")
                    result["error"] = "Could not determine execution price (price=0)"
                    return result

                # Step 4: Calculate SL and TP prices
                tick_size = Decimal(str(config.get("tick_size", "0.01")))
                sl_percent = Decimal(str(config.get("stop_loss_percent", "0.01")))
                tp_percent = Decimal(str(config.get("take_profit_percent", "0.02")))

                # Use custom SL/TP if provided, otherwise calculate from percentages
                if config.get("custom_stop_loss"):
                    sl_price = Decimal(str(config["custom_stop_loss"]))
                    sl_source = "custom"
                else:
                    sl_price = self._calculate_sl_price(real_price, side, sl_percent)
                    sl_source = f"{sl_percent*100:.1f}%"

                if config.get("custom_take_profit"):
                    tp_price = Decimal(str(config["custom_take_profit"]))
                    tp_source = "custom"
                else:
                    tp_price = self._calculate_tp_price(real_price, side, tp_percent)
                    tp_source = f"{tp_percent*100:.1f}%"

                # Validate custom TP/SL coherence with real execution price
                # If execution price differs significantly, custom values may be invalid
                sl_valid, tp_valid = self._validate_tpsl_coherence(real_price, side, sl_price, tp_price)

                if not sl_valid:
                    old_sl = sl_price
                    sl_price = self._calculate_sl_price(real_price, side, sl_percent)
                    sl_source = f"{sl_percent*100:.1f}% (recalculated, custom ${old_sl} invalid for entry ${real_price})"
                    logger.warning(f"[EXECUTE] Custom SL ${old_sl} invalid for {side} at ${real_price}, recalculated to ${sl_price}")

                if not tp_valid:
                    old_tp = tp_price
                    tp_price = self._calculate_tp_price(real_price, side, tp_percent)
                    tp_source = f"{tp_percent*100:.1f}% (recalculated, custom ${old_tp} invalid for entry ${real_price})"
                    logger.warning(f"[EXECUTE] Custom TP ${old_tp} invalid for {side} at ${real_price}, recalculated to ${tp_price}")

                sl_price = self._adjust_price_to_tick_size(sl_price, tick_size)
                tp_price = self._adjust_price_to_tick_size(tp_price, tick_size)

                formatted_sl = self._format_price(sl_price, tick_size)
                formatted_tp = self._format_price(tp_price, tick_size)

                logger.info(f"[EXECUTE] SL=${formatted_sl} ({sl_source}) | TP=${formatted_tp} ({tp_source})")

                # Step 5: Place Stop Loss with retry
                opposite_side = self._get_opposite_side(side)

                sl_start = time.monotonic()
                sl_result = await self._place_sl_with_retry(
                    symbol=symbol,
                    side=opposite_side,
                    qty=formatted_qty,
                    trigger_price=formatted_sl,
                    category=config.get("category", "linear")
                )
                result["timing"]["stop_loss_ms"] = (time.monotonic() - sl_start) * 1000

                result["stop_loss"] = sl_result

                if sl_result.get("retCode") != 0:
                    logger.warning(f"[EXECUTE] Stop Loss placement failed after retries")
                    result["sl_failed"] = True

                # Step 6: Place Take Profit with retry
                tp_start = time.monotonic()
                tp_result = await self._place_tp_with_retry(
                    symbol=symbol,
                    side=opposite_side,
                    qty=formatted_qty,
                    price=formatted_tp,
                    category=config.get("category", "linear")
                )
                result["timing"]["take_profit_ms"] = (time.monotonic() - tp_start) * 1000

                result["take_profit"] = tp_result

                if tp_result.get("retCode") != 0:
                    logger.warning(f"[EXECUTE] Take Profit placement failed after retries")
                    result["tp_failed"] = True

                # Determine overall success
                result["success"] = market_result.get("retCode") == 0
                if result["success"]:
                    self._successful_executions += 1

                # Calculate total time
                total_time_ms = (time.monotonic() - sequence_start) * 1000
                result["timing"]["total_ms"] = total_time_ms

                if result["success"]:
                    logger.info(f"[EXECUTE] SUCCESS {side} {symbol} in {total_time_ms:.0f}ms "
                                f"(market={result['timing'].get('market_order_ms', 0):.0f}ms "
                                f"poll={result['timing'].get('position_poll_ms', 0):.0f}ms "
                                f"sl={result['timing'].get('stop_loss_ms', 0):.0f}ms "
                                f"tp={result['timing'].get('take_profit_ms', 0):.0f}ms)")
                else:
                    logger.warning(f"[EXECUTE] Sequence {side} {symbol} completed with WARNINGS in {total_time_ms:.0f}ms")

                return result

            except Exception as e:
                logger.error(f"[EXECUTE] Critical error in order sequence: {e}", exc_info=True)
                result["error"] = str(e)
                # Check if market order succeeded despite later errors
                if result.get("market_order", {}).get("retCode") == 0:
                    result["success"] = True
                    result["partial"] = True
                    logger.warning(f"[EXECUTE] Market Order succeeded, but SL/TP failed: {str(e)}")

                    # Send critical alert for partial execution
                    await self._send_critical_alert(
                        symbol=symbol,
                        alert_type="PARTIAL_EXECUTION",
                        message=f"Market order succeeded but SL/TP failed: {str(e)}"
                    )
                else:
                    result["success"] = False
                return result

    async def execute_integrated_sequence(
        self,
        symbol: str,
        side: str,
        quantity: Decimal,
        config: Dict[str, Any],
        order_type: str = "Market",
        limit_price: Optional[Decimal] = None
    ) -> Dict[str, Any]:
        """
        Execute trading with integrated TP/SL in a single API call.
        Much faster than execute_complete_sequence (1 call vs 3).

        Args:
            symbol: Trading pair
            side: "Buy" or "Sell"
            quantity: Quantity to trade
            config: Coin configuration with SL%, TP%, TickSize, etc.
            order_type: "Market" or "Limit"
            limit_price: Required if order_type is "Limit"

        Returns:
            Dict with execution results
        """
        symbol_lock = self._get_symbol_lock(symbol)

        async with symbol_lock:
            sequence_start = time.monotonic()
            self._total_executions += 1

            order_type_display = order_type.upper()
            logger.info(f"[EXECUTE] {'='*50}")
            logger.info(f"[EXECUTE] {order_type_display} + TP/SL: {side} {symbol}")
            logger.info(f"[EXECUTE] {'='*50}")

            result = {
                "symbol": symbol,
                "side": side,
                "order_type": order_type,
                "integrated_order": None,
                "success": False,
                "timing": {},
                "method": "integrated"
            }

            try:
                # Step 1: Format quantity
                step_size = self._get_step_size(symbol)
                adjusted_qty = self._adjust_to_step_size(quantity, step_size)
                formatted_qty = self._format_quantity(adjusted_qty, step_size)

                logger.info(f"[EXECUTE] Quantity: {quantity} -> {adjusted_qty} -> '{formatted_qty}' (step={step_size})")

                # Step 2: Calculate prices
                tick_size = Decimal(str(config.get("tick_size", "0.01")))

                # Determine entry price for TP/SL calculation
                if order_type.upper() == "LIMIT" and limit_price:
                    entry_price = limit_price
                    formatted_limit = self._format_price(
                        self._adjust_price_to_tick_size(entry_price, tick_size),
                        tick_size
                    )
                    logger.info(f"[EXECUTE] LIMIT Entry Price: ${formatted_limit}")
                else:
                    # For market orders, get REAL current price from Bybit
                    # (alert price may be historical and differ from current market)
                    logger.info(f"[EXECUTE] Fetching real market price from Bybit for {symbol}...")
                    real_market_price = await self.client.get_last_price(symbol, config.get("category", "linear"))
                    if real_market_price and real_market_price > 0:
                        entry_price = real_market_price
                        alert_price = Decimal(str(config.get("current_price", 0)))
                        slippage = abs(float(entry_price - alert_price)) if alert_price > 0 else 0
                        logger.info(f"[EXECUTE] Market price: ${entry_price} (alert was ${alert_price}, diff=${slippage:.2f})")
                    else:
                        entry_price = Decimal(str(config.get("current_price", 0)))
                        logger.warning(f"[EXECUTE] Fallback to alert price: ${entry_price} (Bybit price fetch failed)")
                    formatted_limit = None

                if entry_price == 0:
                    logger.error(f"[EXECUTE] No valid price for TP/SL calculation")
                    result["error"] = "No valid price for TP/SL calculation (price=0)"
                    return result

                # Calculate SL price
                sl_percent = Decimal(str(config.get("stop_loss_percent", "0.01")))
                tp_percent = Decimal(str(config.get("take_profit_percent", "0.02")))

                if config.get("sl_distance"):
                    # Distance-based SL: aplica la distancia al precio real de ejecucion
                    sl_dist = Decimal(str(config["sl_distance"]))
                    if side == "Buy":
                        sl_price = entry_price - sl_dist
                    else:
                        sl_price = entry_price + sl_dist
                    sl_source = f"distance {sl_dist}"
                elif config.get("custom_stop_loss"):
                    sl_price = Decimal(str(config["custom_stop_loss"]))
                    sl_source = "custom"
                else:
                    sl_price = self._calculate_sl_price(entry_price, side, sl_percent)
                    sl_source = f"{sl_percent*100:.1f}%"

                # Calculate TP price
                if config.get("tp_distance"):
                    # Distance-based TP: aplica la distancia al precio real de ejecucion
                    tp_dist = Decimal(str(config["tp_distance"]))
                    if side == "Buy":
                        tp_price = entry_price + tp_dist
                    else:
                        tp_price = entry_price - tp_dist
                    tp_source = f"distance {tp_dist}"
                elif config.get("custom_take_profit"):
                    tp_price = Decimal(str(config["custom_take_profit"]))
                    tp_source = "custom"
                else:
                    tp_price = self._calculate_tp_price(entry_price, side, tp_percent)
                    tp_source = f"{tp_percent*100:.1f}%"

                # Validate custom TP/SL coherence with entry price
                sl_valid, tp_valid = self._validate_tpsl_coherence(entry_price, side, sl_price, tp_price)

                if not sl_valid:
                    old_sl = sl_price
                    sl_price = self._calculate_sl_price(entry_price, side, sl_percent)
                    sl_source = f"{sl_percent*100:.1f}% (recalculated, custom ${old_sl} invalid for {side} at ${entry_price})"
                    logger.warning(f"[EXECUTE] Custom SL ${old_sl} invalid for {side} at ${entry_price}, recalculated to ${sl_price}")

                if not tp_valid:
                    old_tp = tp_price
                    tp_price = self._calculate_tp_price(entry_price, side, tp_percent)
                    tp_source = f"{tp_percent*100:.1f}% (recalculated, custom ${old_tp} invalid for {side} at ${entry_price})"
                    logger.warning(f"[EXECUTE] Custom TP ${old_tp} invalid for {side} at ${entry_price}, recalculated to ${tp_price}")

                sl_price = self._adjust_price_to_tick_size(sl_price, tick_size)
                tp_price = self._adjust_price_to_tick_size(tp_price, tick_size)

                formatted_sl = self._format_price(sl_price, tick_size)
                formatted_tp = self._format_price(tp_price, tick_size)

                r_distance = abs(float(entry_price - sl_price))
                rr_ratio = abs(float(tp_price - entry_price)) / r_distance if r_distance > 0 else 0
                logger.info(f"[EXECUTE] SL: ${formatted_sl} ({sl_source})")
                logger.info(f"[EXECUTE] TP: ${formatted_tp} ({tp_source})")
                logger.info(f"[EXECUTE] R={r_distance:.2f} RR={rr_ratio:.1f}x")

                # Step 3: Execute single integrated order
                order_start = time.monotonic()
                order_result = await self.client.place_order_with_tpsl(
                    symbol=symbol,
                    side=side,
                    qty=formatted_qty,
                    order_type=order_type,
                    limit_price=formatted_limit,
                    take_profit=formatted_tp,
                    stop_loss=formatted_sl,
                    category=config.get("category", "linear")
                )
                result["timing"]["order_ms"] = (time.monotonic() - order_start) * 1000

                result["integrated_order"] = order_result
                result["success"] = order_result.get("retCode") == 0

                if result["success"]:
                    self._successful_executions += 1

                # Calculate total time
                total_time_ms = (time.monotonic() - sequence_start) * 1000
                result["timing"]["total_ms"] = total_time_ms

                logger.info(f"[EXECUTE] {'='*50}")
                if result["success"]:
                    order_id = order_result.get("result", {}).get("orderId", "N/A")
                    logger.info(f"[EXECUTE] SUCCESS in {total_time_ms:.0f}ms | orderId={order_id}")
                    logger.info(f"[EXECUTE] API call: {result['timing'].get('order_ms', 0):.0f}ms")
                    logger.info(f"[EXECUTE] Bybit retCode={order_result.get('retCode')} retMsg={order_result.get('retMsg', '')}")
                else:
                    error_msg = order_result.get("retMsg", "Unknown error")
                    result["error"] = f"Integrated order failed: {error_msg} (retCode={order_result.get('retCode')})"
                    logger.error(f"[EXECUTE] FAILED: {result['error']}")
                    logger.error(f"[EXECUTE] Full Bybit response: {order_result}")
                logger.info(f"[EXECUTE] {'='*50}")

                return result

            except Exception as e:
                logger.error(f"[EXECUTE] Critical error in integrated sequence: {e}")
                import traceback
                traceback.print_exc()
                result["error"] = str(e)
                return result

    def get_statistics(self) -> Dict[str, Any]:
        """Get order manager statistics"""
        success_rate = (
            (self._successful_executions / self._total_executions * 100)
            if self._total_executions > 0 else 0
        )

        return {
            "total_executions": self._total_executions,
            "successful_executions": self._successful_executions,
            "success_rate": round(success_rate, 1),
            "failed_sl_count": self._failed_sl_count,
            "failed_tp_count": self._failed_tp_count,
            "active_symbol_locks": len(self._symbol_locks)
        }
