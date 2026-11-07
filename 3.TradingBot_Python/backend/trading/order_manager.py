"""
Order Manager
Handles complete order sequences: Market + Stop Loss + Take Profit

Optimizations (January 2026):
- Lock per symbol (not global) for parallel execution
- Intelligent polling instead of fixed sleeps
- Automatic retry for SL/TP with critical alerts
- Detailed timing logs

Robustez (Noviembre 2026):
- Precision real de Bybit (paso de cantidad, tick y minimo) en vez de una tabla fija
- La cantidad nunca se redondea hacia arriba: si no alcanza el minimo la orden no se envia
- Precios redondeados al tick hacia el lado que no aumenta el riesgo
- Metodo secuencial: entrada a mercado, precio real de llenado del lado operado y TP/SL de
  posicion (trading-stop). Si el SL no queda puesto, la posicion se cierra a mercado
- Metodo integrado: tras una entrada a mercado se verifica que la posicion tenga SL
- Respuesta perdida de Bybit: se comprueba la posicion antes de dar la orden por fallida
- Apalancamiento de la configuracion fijado en Bybit antes de abrir
"""

import asyncio
import time
import logging
from typing import Dict, Any, Optional, Callable, Tuple
from decimal import Decimal, ROUND_FLOOR, ROUND_CEILING
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

    # ------------------------------------------------------------------
    # Precision y formato
    # ------------------------------------------------------------------

    async def precision_for(self, symbol: str, config: Dict[str, Any]) -> Dict[str, Any]:
        """Paso, tick y minimo reales de Bybit; si no se pueden leer, los de la configuracion."""
        live = None
        try:
            live = await self.client.get_precision(symbol, config.get("category", "linear"))
        except Exception as e:
            logger.warning(f"[EXECUTE] Precision de Bybit no disponible para {symbol}: {e}")
        if live:
            return {"qty_step": live["qty_step"], "tick_size": live["tick_size"], "min_qty": live["min_qty"],
                    "max_qty": live.get("max_qty") or Decimal("0"), "source": "bybit"}
        logger.warning(f"[EXECUTE] {symbol}: usando la precision de trading_config.json")
        return {
            "qty_step": Decimal(str(config.get("step_size") or "0.001")),
            "tick_size": Decimal(str(config.get("tick_size") or "0.01")),
            "min_qty": Decimal(str(config.get("min_qty") or "0")),
            "max_qty": Decimal(str(config.get("max_qty") or "0")),
            "source": "config",
        }

    @staticmethod
    def _floor_to_step(value: Decimal, step: Decimal) -> Decimal:
        if step <= 0:
            return value
        return (value / step).to_integral_value(rounding=ROUND_FLOOR) * step

    @staticmethod
    def _round_to_tick(price: Decimal, tick: Decimal, rounding) -> Decimal:
        if tick <= 0:
            return price
        return (price / tick).to_integral_value(rounding=rounding) * tick

    @staticmethod
    def _fmt(value: Decimal, step: Decimal) -> str:
        """Texto con los decimales del paso (el valor ya debe ser multiplo del paso)."""
        exp = step.normalize().as_tuple().exponent if step > 0 else -8
        quantum = Decimal(1).scaleb(exp) if exp < 0 else Decimal(1)
        return format(value.quantize(quantum, rounding=ROUND_FLOOR), "f")

    def prepare_quantity(self, quantity: Any, prec: Dict[str, Any]) -> Tuple[Optional[Decimal], Optional[str], Optional[str]]:
        """Cantidad al paso real, sin redondear nunca hacia arriba. Devuelve (qty, texto, error)."""
        qty = self._floor_to_step(Decimal(str(quantity)), prec["qty_step"])
        max_qty = prec.get("max_qty") or Decimal("0")
        if max_qty > 0 and qty > max_qty:
            qty = self._floor_to_step(max_qty, prec["qty_step"])
        if qty <= 0 or (prec["min_qty"] > 0 and qty < prec["min_qty"]):
            return None, None, (f"Cantidad {quantity} por debajo del minimo de Bybit "
                                f"(minimo {prec['min_qty']}, paso {prec['qty_step']}): orden no enviada")
        return qty, self._fmt(qty, prec["qty_step"]), None

    def _round_entry(self, price: Decimal, side: str, tick: Decimal) -> Decimal:
        """Precio limite al tick sin empeorarlo: compra hacia abajo, venta hacia arriba."""
        return self._round_to_tick(price, tick, ROUND_FLOOR if side == "Buy" else ROUND_CEILING)

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

    def compute_sl_tp(self, entry_price: Decimal, side: str, config: Dict[str, Any], tick: Decimal):
        """
        SL y TP para una entrada, en este orden: distancia de la alerta, precio de la alerta o
        porcentaje de la configuracion. Redondea al tick hacia el lado que no aumenta el riesgo.
        Devuelve (sl, tp, origen_sl, origen_tp). Lanza ValueError si el SL queda en el precio.
        """
        sl_percent = Decimal(str(config.get("stop_loss_percent", "0.01")))
        tp_percent = Decimal(str(config.get("take_profit_percent", "0.02")))

        if config.get("sl_distance"):
            sl_dist = Decimal(str(config["sl_distance"]))
            sl_price = entry_price - sl_dist if side == "Buy" else entry_price + sl_dist
            sl_source = f"distance {sl_dist}"
        elif config.get("custom_stop_loss"):
            sl_price = Decimal(str(config["custom_stop_loss"]))
            sl_source = "custom"
        else:
            sl_price = self._calculate_sl_price(entry_price, side, sl_percent)
            sl_source = f"{sl_percent*100:.2f}%"

        if config.get("tp_distance"):
            tp_dist = Decimal(str(config["tp_distance"]))
            tp_price = entry_price + tp_dist if side == "Buy" else entry_price - tp_dist
            tp_source = f"distance {tp_dist}"
        elif config.get("custom_take_profit"):
            tp_price = Decimal(str(config["custom_take_profit"]))
            tp_source = "custom"
        else:
            tp_price = self._calculate_tp_price(entry_price, side, tp_percent)
            tp_source = f"{tp_percent*100:.2f}%"

        sl_valid, tp_valid = self._validate_tpsl_coherence(entry_price, side, sl_price, tp_price)
        if not sl_valid:
            logger.warning(f"[EXECUTE] SL {sl_price} invalido para {side} en {entry_price}: se usa {sl_percent*100:.2f}%")
            sl_price = self._calculate_sl_price(entry_price, side, sl_percent)
            sl_source = f"{sl_percent*100:.2f}% (recalculado)"
        if not tp_valid:
            logger.warning(f"[EXECUTE] TP {tp_price} invalido para {side} en {entry_price}: se usa {tp_percent*100:.2f}%")
            tp_price = self._calculate_tp_price(entry_price, side, tp_percent)
            tp_source = f"{tp_percent*100:.2f}% (recalculado)"

        # Redondeo al tick: SL hacia la entrada (menos riesgo), TP hacia la entrada (mas facil de alcanzar)
        if side == "Buy":
            sl_price = self._round_to_tick(sl_price, tick, ROUND_CEILING)
            tp_price = self._round_to_tick(tp_price, tick, ROUND_FLOOR)
        else:
            sl_price = self._round_to_tick(sl_price, tick, ROUND_FLOOR)
            tp_price = self._round_to_tick(tp_price, tick, ROUND_CEILING)

        sl_valid, tp_valid = self._validate_tpsl_coherence(entry_price, side, sl_price, tp_price)
        if not sl_valid:
            raise ValueError(f"El SL queda en el precio de entrada al redondear al tick {tick} (entrada {entry_price})")
        if not tp_valid:
            tp_price = self._round_to_tick(self._calculate_tp_price(entry_price, side, tp_percent), tick,
                                           ROUND_FLOOR if side == "Buy" else ROUND_CEILING)
            tp_source = f"{tp_percent*100:.2f}% (recalculado)"
        return sl_price, tp_price, sl_source, tp_source

    # ------------------------------------------------------------------
    # Posiciones
    # ------------------------------------------------------------------

    async def _side_size(self, symbol: str, side: str) -> Optional[Decimal]:
        """Tamano actual de la posicion de ese lado. None si Bybit no respondio."""
        pos = await self.client.get_position(symbol)
        if not pos.get("success"):
            return None
        total = Decimal("0")
        for p in pos.get("positions", []):
            if p.get("side") == side:
                total += Decimal(str(p.get("size", 0)))
        return total

    async def _wait_for_position(
        self,
        symbol: str,
        side: str,
        before: Optional[Decimal] = None,
        timeout_seconds: float = None
    ) -> Optional[Dict[str, Any]]:
        """
        Espera a que la posicion DEL LADO OPERADO crezca respecto de 'before'.
        En hedge no confunde la posicion nueva con la del lado contrario.
        """
        timeout = timeout_seconds or self.POSITION_POLL_TIMEOUT_S
        before = before or Decimal("0")
        start_time = time.monotonic()
        poll_count = 0

        while (time.monotonic() - start_time) < timeout:
            poll_count += 1
            pos = await self.client.get_position(symbol)
            if pos.get("success"):
                for p in pos.get("positions", []):
                    if p.get("side") == side and Decimal(str(p.get("size", 0))) > before:
                        elapsed_ms = (time.monotonic() - start_time) * 1000
                        logger.info(f"[EXECUTE] Position {side} confirmed in {elapsed_ms:.0f}ms ({poll_count} polls)")
                        return p
            await asyncio.sleep(self.POSITION_POLL_INTERVAL_MS / 1000.0)

        elapsed_ms = (time.monotonic() - start_time) * 1000
        logger.warning(f"[EXECUTE] Position poll TIMEOUT after {elapsed_ms:.0f}ms ({poll_count} polls)")
        return None

    async def _fill_info(self, symbol: str, order_result: Dict[str, Any], side: str,
                         before: Optional[Decimal], category: str):
        """
        Precio real de llenado de una orden a mercado.
        Devuelve (precio, estado) con estado "filled", "not_filled" o "unknown".
        """
        order_id = (order_result.get("result") or {}).get("orderId")
        info = order_result.get("order")
        if order_id and not (info and Decimal(str(info.get("cumExecQty") or "0")) > 0):
            info = await self.client.find_order(symbol, order_id=order_id, category=category, attempts=2, delay=0.3)
        if info:
            cum = Decimal(str(info.get("cumExecQty") or "0"))
            avg = Decimal(str(info.get("avgPrice") or "0"))
            if cum > 0 and avg > 0:
                return avg, "filled"
            if info.get("orderStatus") in ("Cancelled", "Rejected", "Deactivated", "PartiallyFilledCanceled") and cum == 0:
                return None, "not_filled"
        pos = await self._wait_for_position(symbol, side, before)
        if pos:
            return Decimal(str(pos.get("entryPrice") or "0")), "filled"
        return None, "unknown"

    async def close_position(self, symbol: str, side: str, category: str = "linear") -> Dict[str, Any]:
        """Cierra a mercado (reduce-only) la posicion de ese lado."""
        pos = await self.client.get_position(symbol, category)
        if not pos.get("success"):
            return {"closed": False, "error": pos.get("error", "No se pudo leer la posicion")}
        size_raw = None
        for p in pos.get("positions", []):
            if p.get("side") == side:
                size_raw = p.get("sizeRaw") or p.get("size")
                break
        if not size_raw or Decimal(str(size_raw)) <= 0:
            return {"closed": True, "note": "sin posicion abierta"}
        qty_str = format(Decimal(str(size_raw)).normalize(), "f")
        result = await self.client.place_market_order(symbol, self._get_opposite_side(side), qty_str, category, reduce_only=True)
        if result.get("retCode") == 0:
            return {"closed": True, "order": result}
        if result.get("outcome_unknown"):
            left = await self._side_size(symbol, side)
            if left is not None and left == 0:
                return {"closed": True, "order": result}
        return {"closed": False, "error": f"{result.get('retMsg')} (retCode={result.get('retCode')})"}

    @staticmethod
    def _sl_crossed(side: str, sl: Decimal, last: Decimal) -> bool:
        return last <= sl if side == "Buy" else last >= sl

    @staticmethod
    def _tp_crossed(side: str, tp: Decimal, last: Decimal) -> bool:
        return last >= tp if side == "Buy" else last <= tp

    async def _protect_position(self, symbol: str, side: str, sl: Decimal, tp: Optional[Decimal],
                                category: str, tick: Decimal) -> Dict[str, Any]:
        """
        Pone TP/SL de posicion. Si el SL no queda puesto tras los reintentos, o el precio ya lo
        cruzo, cierra la posicion a mercado. Nunca deja una posicion abierta sin SL sin avisar.
        """
        f_sl = self._fmt(sl, tick)
        f_tp = self._fmt(tp, tick) if tp is not None else None
        last_error = None
        for attempt in range(self.SL_TP_MAX_RETRIES):
            r = await self.client.set_trading_stop(symbol, side, take_profit=f_tp, stop_loss=f_sl, category=category)
            if r.get("retCode") == 0:
                return {"ok": True, "stop_loss": f_sl, "take_profit": f_tp}
            last_error = f"{r.get('retMsg')} (retCode={r.get('retCode')})"
            logger.warning(f"[EXECUTE] [SL/TP RETRY] Attempt {attempt + 1}/{self.SL_TP_MAX_RETRIES} failed: {last_error}")
            last = await self.client.get_last_price(symbol, category)
            if last is not None:
                if self._sl_crossed(side, sl, last):
                    last_error = f"el precio ({last}) ya cruzo el SL ({f_sl})"
                    break
                if f_tp is not None and self._tp_crossed(side, tp, last):
                    # El TP ya quedo atras: se protege solo con el SL
                    r2 = await self.client.set_trading_stop(symbol, side, stop_loss=f_sl, category=category)
                    if r2.get("retCode") == 0:
                        self._failed_tp_count += 1
                        await self._send_critical_alert(symbol, "TP_SKIPPED",
                                                        f"El precio ({last}) ya paso el TP ({f_tp}). La posicion queda solo con SL {f_sl}.")
                        return {"ok": True, "stop_loss": f_sl, "take_profit": None, "tp_skipped": True}
            if attempt < self.SL_TP_MAX_RETRIES - 1:
                await asyncio.sleep(self.SL_TP_RETRY_DELAY_MS / 1000.0)

        self._failed_sl_count += 1
        closed = await self.close_position(symbol, side, category)
        if closed.get("closed"):
            await self._send_critical_alert(symbol, "SL_FAILED_CLOSED",
                                            f"No se pudo poner el Stop Loss ({last_error}). La posicion se cerro a mercado.")
            return {"ok": False, "closed": True, "error": last_error}
        await self._send_critical_alert(symbol, "SL_FAILED",
                                        f"No se pudo poner el Stop Loss ({last_error}) ni cerrar la posicion "
                                        f"({closed.get('error')}). Position is UNPROTECTED! Cierrala en Bybit.")
        return {"ok": False, "closed": False, "error": last_error}

    async def _ensure_leverage(self, symbol: str, config: Dict[str, Any], result: Dict[str, Any]) -> None:
        leverage = config.get("leverage")
        if not leverage:
            return
        r = await self.client.ensure_leverage(symbol, leverage, config.get("category", "linear"))
        if r.get("retCode") != 0:
            result["leverage_warning"] = f"No se pudo fijar {leverage}x: {r.get('retMsg')}"
            logger.warning(f"[EXECUTE] {symbol}: {result['leverage_warning']}")

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
            "severity": "CRITICAL" if ("SL" in alert_type or "UNKNOWN" in alert_type) else "WARNING"
        }

        # Log prominently
        logger.critical(f"[EXECUTE] CRITICAL ALERT {alert_type}: {symbol} - {message}")

        # Call callback if set
        if self._critical_alert_callback:
            try:
                await self._critical_alert_callback(alert)
            except Exception as e:
                logger.error(f"[EXECUTE] Failed to send critical alert callback: {e}")

    @staticmethod
    def _new_result(symbol: str, side: str, method: str, order_type: str) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "side": side,
            "order_type": order_type,
            "method": method,
            "market_order": None,
            "integrated_order": None,
            "stop_loss": None,
            "take_profit": None,
            "entry_price": None,
            "qty": None,
            "status": "failed",
            "success": False,
            "timing": {}
        }

    def _finish(self, result: Dict[str, Any], status: str, start: float) -> Dict[str, Any]:
        result["status"] = status
        result["success"] = status in ("success", "pending")
        if result["success"]:
            self._successful_executions += 1
        result["timing"]["total_ms"] = (time.monotonic() - start) * 1000
        level = logging.INFO if result["success"] else logging.WARNING
        logger.log(level, f"[EXECUTE] {result['side']} {result['symbol']} -> {status} "
                          f"(entry={result.get('entry_price')} SL={result.get('stop_loss')} TP={result.get('take_profit')} "
                          f"qty={result.get('qty')}) {result.get('error') or ''}")
        return result

    async def _entry_outcome(self, symbol: str, side: str, order: Dict[str, Any], before: Optional[Decimal],
                             category: str, result: Dict[str, Any]) -> Tuple[Optional[Decimal], Optional[str]]:
        """
        Despues de enviar una entrada a mercado: precio real o el estado final si no hay posicion.
        Devuelve (precio, None) o (None, "failed"|"unknown").
        """
        if order.get("retCode") != 0:
            if not order.get("outcome_unknown"):
                result["error"] = f"Order failed: {order.get('retMsg', 'Unknown Bybit error')} (retCode={order.get('retCode')})"
                return None, "failed"
            # No se sabe si llego: la posicion lo dice
            pos = await self._wait_for_position(symbol, side, before, timeout_seconds=4.0)
            if not pos:
                result["error"] = (f"No se sabe si Bybit recibio la orden ({order.get('retMsg')}) y no aparece posicion. "
                                   f"Revisa Bybit.")
                await self._send_critical_alert(symbol, "ORDER_UNKNOWN", result["error"])
                return None, "unknown"
            result["recovered"] = True
            return Decimal(str(pos.get("entryPrice") or "0")), None

        price, state = await self._fill_info(symbol, order, side, before, category)
        if state == "filled" and price and price > 0:
            return price, None
        if state == "not_filled":
            result["error"] = "Bybit cancelo la orden a mercado sin llenarla"
            return None, "failed"
        result["error"] = "La orden fue aceptada pero no aparece la posicion. Revisa Bybit."
        await self._send_critical_alert(symbol, "ORDER_UNKNOWN", result["error"])
        return None, "unknown"

    # ------------------------------------------------------------------
    # Secuencias
    # ------------------------------------------------------------------

    async def execute_complete_sequence(
        self,
        symbol: str,
        side: str,
        quantity: Decimal,
        config: Dict[str, Any]
    ) -> Dict[str, Any]:
        """
        Metodo secuencial: entrada a mercado, precio real de llenado y TP/SL de posicion.
        Si el SL no se puede poner, la posicion se cierra a mercado.
        """
        symbol_lock = self._get_symbol_lock(symbol)

        async with symbol_lock:
            sequence_start = time.monotonic()
            self._total_executions += 1
            category = config.get("category", "linear")
            logger.info(f"[EXECUTE] ========== Sequential: {side} {symbol} ==========")
            result = self._new_result(symbol, side, "sequential", "Market")

            try:
                prec = await self.precision_for(symbol, config)
                qty, f_qty, err = self.prepare_quantity(quantity, prec)
                if err:
                    result["error"] = err
                    return self._finish(result, "failed", sequence_start)
                result["qty"] = f_qty
                logger.info(f"[EXECUTE] Quantity: {quantity} -> '{f_qty}' (step={prec['qty_step']}, {prec['source']})")

                await self._ensure_leverage(symbol, config, result)
                before = await self._side_size(symbol, side)
                if before is None:
                    result["error"] = "No se pudo leer la posicion antes de enviar la orden"
                    return self._finish(result, "failed", sequence_start)

                market_start = time.monotonic()
                market_result = await self.client.place_market_order(symbol=symbol, side=side, qty=f_qty, category=category)
                result["timing"]["market_order_ms"] = (time.monotonic() - market_start) * 1000
                result["market_order"] = market_result

                entry_price, final = await self._entry_outcome(symbol, side, market_result, before, category, result)
                if final:
                    return self._finish(result, final, sequence_start)
                result["entry_price"] = str(entry_price)
                logger.info(f"[EXECUTE] Real execution price: ${entry_price}")

                try:
                    sl_price, tp_price, sl_source, tp_source = self.compute_sl_tp(entry_price, side, config, prec["tick_size"])
                except ValueError as e:
                    result["error"] = str(e)
                    closed = await self.close_position(symbol, side, category)
                    await self._send_critical_alert(symbol, "SL_FAILED_CLOSED" if closed.get("closed") else "SL_FAILED",
                                                    f"{e}. {'Posicion cerrada a mercado.' if closed.get('closed') else 'No se pudo cerrar: cierrala en Bybit.'}")
                    result["sl_failed"] = True
                    return self._finish(result, "closed_unprotected" if closed.get("closed") else "unprotected", sequence_start)
                logger.info(f"[EXECUTE] SL={sl_price} ({sl_source}) | TP={tp_price} ({tp_source})")

                prot_start = time.monotonic()
                prot = await self._protect_position(symbol, side, sl_price, tp_price, category, prec["tick_size"])
                result["timing"]["tpsl_ms"] = (time.monotonic() - prot_start) * 1000
                result["stop_loss"] = prot.get("stop_loss") or self._fmt(sl_price, prec["tick_size"])
                result["take_profit"] = prot.get("take_profit")
                if not prot["ok"]:
                    result["sl_failed"] = True
                    result["error"] = f"Stop Loss no colocado: {prot.get('error')}"
                    return self._finish(result, "closed_unprotected" if prot.get("closed") else "unprotected", sequence_start)
                if prot.get("tp_skipped"):
                    result["tp_failed"] = True
                return self._finish(result, "success", sequence_start)

            except Exception as e:
                logger.error(f"[EXECUTE] Critical error in order sequence: {e}", exc_info=True)
                result["error"] = str(e)
                if (result.get("market_order") or {}).get("retCode") == 0:
                    await self._send_critical_alert(symbol, "PARTIAL_EXECUTION",
                                                    f"La entrada se envio pero fallo el resto de la secuencia: {e}. Revisa la posicion en Bybit.")
                    return self._finish(result, "unknown", sequence_start)
                return self._finish(result, "failed", sequence_start)

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
        Tras una entrada a mercado verifica que la posicion tenga SL (y lo pone si falta).

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
            category = config.get("category", "linear")
            is_limit = order_type.upper() == "LIMIT"
            logger.info(f"[EXECUTE] {'='*50}")
            logger.info(f"[EXECUTE] {order_type.upper()} + TP/SL: {side} {symbol}")
            result = self._new_result(symbol, side, "integrated", order_type)

            try:
                prec = await self.precision_for(symbol, config)
                tick = prec["tick_size"]
                qty, f_qty, err = self.prepare_quantity(quantity, prec)
                if err:
                    result["error"] = err
                    return self._finish(result, "failed", sequence_start)
                result["qty"] = f_qty
                logger.info(f"[EXECUTE] Quantity: {quantity} -> '{f_qty}' (step={prec['qty_step']}, {prec['source']})")

                formatted_limit = None
                if is_limit:
                    if not limit_price:
                        result["error"] = "limit_price required for Limit orders"
                        return self._finish(result, "failed", sequence_start)
                    entry_price = self._round_entry(Decimal(str(limit_price)), side, tick)
                    formatted_limit = self._fmt(entry_price, tick)
                    logger.info(f"[EXECUTE] LIMIT Entry Price: ${formatted_limit}")
                else:
                    real_market_price = await self.client.get_last_price(symbol, category)
                    if real_market_price and real_market_price > 0:
                        entry_price = real_market_price
                    else:
                        entry_price = Decimal(str(config.get("current_price", 0) or 0))
                        logger.warning(f"[EXECUTE] Fallback to alert price: ${entry_price} (Bybit price fetch failed)")

                if entry_price <= 0:
                    result["error"] = "No valid price for TP/SL calculation (price=0)"
                    return self._finish(result, "failed", sequence_start)

                try:
                    sl_price, tp_price, sl_source, tp_source = self.compute_sl_tp(entry_price, side, config, tick)
                except ValueError as e:
                    result["error"] = str(e)
                    return self._finish(result, "failed", sequence_start)
                formatted_sl = self._fmt(sl_price, tick)
                formatted_tp = self._fmt(tp_price, tick)
                logger.info(f"[EXECUTE] SL: ${formatted_sl} ({sl_source}) | TP: ${formatted_tp} ({tp_source})")

                await self._ensure_leverage(symbol, config, result)
                before = None
                if not is_limit:
                    before = await self._side_size(symbol, side)
                    if before is None:
                        result["error"] = "No se pudo leer la posicion antes de enviar la orden"
                        return self._finish(result, "failed", sequence_start)

                order_start = time.monotonic()
                order_result = await self.client.place_order_with_tpsl(
                    symbol=symbol,
                    side=side,
                    qty=f_qty,
                    order_type=order_type,
                    limit_price=formatted_limit,
                    take_profit=formatted_tp,
                    stop_loss=formatted_sl,
                    category=category
                )
                result["timing"]["order_ms"] = (time.monotonic() - order_start) * 1000
                result["integrated_order"] = order_result
                result["stop_loss"] = formatted_sl
                result["take_profit"] = formatted_tp

                if is_limit:
                    if order_result.get("retCode") == 0:
                        result["entry_price"] = formatted_limit
                        result["recovered"] = bool(order_result.get("recovered"))
                        return self._finish(result, "pending", sequence_start)
                    if order_result.get("outcome_unknown"):
                        result["error"] = (f"No se sabe si la orden limit llego a Bybit ({order_result.get('retMsg')}). "
                                           f"Revisa las ordenes abiertas.")
                        await self._send_critical_alert(symbol, "ORDER_UNKNOWN", result["error"])
                        return self._finish(result, "unknown", sequence_start)
                    result["error"] = f"Integrated order failed: {order_result.get('retMsg', 'Unknown error')} (retCode={order_result.get('retCode')})"
                    return self._finish(result, "failed", sequence_start)

                fill_price, final = await self._entry_outcome(symbol, side, order_result, before, category, result)
                if final:
                    return self._finish(result, final, sequence_start)
                result["entry_price"] = str(fill_price)

                # La posicion debe tener SL: si no lo tiene (o no se ve), se pone a nivel de posicion
                pos = await self._wait_for_position(symbol, side, before, timeout_seconds=3.0)
                if not pos or not pos.get("stopLoss"):
                    logger.warning(f"[EXECUTE] {symbol} {side}: la posicion no muestra SL, se pone con trading-stop")
                    prot = await self._protect_position(symbol, side, sl_price, tp_price, category, tick)
                    if not prot["ok"]:
                        result["sl_failed"] = True
                        result["error"] = f"Stop Loss no colocado: {prot.get('error')}"
                        return self._finish(result, "closed_unprotected" if prot.get("closed") else "unprotected", sequence_start)
                return self._finish(result, "success", sequence_start)

            except Exception as e:
                logger.error(f"[EXECUTE] Critical error in integrated sequence: {e}", exc_info=True)
                result["error"] = str(e)
                if (result.get("integrated_order") or {}).get("retCode") == 0 and not is_limit:
                    await self._send_critical_alert(symbol, "PARTIAL_EXECUTION",
                                                    f"La orden se envio pero fallo la verificacion: {e}. Revisa la posicion en Bybit.")
                    return self._finish(result, "unknown", sequence_start)
                return self._finish(result, "failed", sequence_start)

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
