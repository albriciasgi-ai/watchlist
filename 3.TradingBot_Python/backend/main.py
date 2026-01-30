"""
Trading Bot Backend - Main Application
FastAPI server with WebSocket support for real-time updates
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from decimal import Decimal
import json
import asyncio
from pathlib import Path
from datetime import datetime

from trading.bybit_client import BybitClient
from trading.order_manager import OrderManager
from trading.risk_calculator import RiskCalculator
from trading.direction_manager import DirectionManager
from trading.alert_parser import AlertParser

# Alert log file for received alerts
ALERT_LOG_DIR = Path(__file__).parent / "logs"
ALERT_RECEIVED_LOG = ALERT_LOG_DIR / "alerts_received.log"

def log_received_alert(symbol: str, side: str, pattern: str, price: float, confidence: float, result: str, source: str = "WATCHLIST"):
    """Write received alert to log file"""
    try:
        # Ensure logs directory exists
        ALERT_LOG_DIR.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conf_str = f"{confidence:.1f}%" if confidence else "N/A"
        log_line = f"{timestamp} | {result} | {source} | {symbol} | {side} | {pattern} | ${price:.2f} | {conf_str}\n"
        with open(ALERT_RECEIVED_LOG, "a", encoding="utf-8") as f:
            f.write(log_line)
    except Exception as e:
        print(f"[ERROR] Failed to write alert log: {e}")


# ==========================
# Pydantic Models
# ==========================

class AlertRequest(BaseModel):
    raw_alert: str = Field(..., description="Raw alert message from ATAS")


class ManualTradeRequest(BaseModel):
    symbol: str
    side: str  # "Buy" or "Sell"
    quantity: Optional[Decimal] = None  # If None, will calculate from risk
    current_price: Optional[Decimal] = None  # Optional if stopLoss/takeProfit provided
    stopLoss: Optional[Decimal] = None  # Custom SL price
    takeProfit: Optional[Decimal] = None  # Custom TP price


class ConfigUpdateRequest(BaseModel):
    symbol: str
    risk_amount: Optional[Decimal] = None
    stop_loss_percent: Optional[Decimal] = None
    take_profit_percent: Optional[Decimal] = None


class AddCoinRequest(BaseModel):
    symbol: str
    category: str = "linear"
    risk_amount: Decimal = Decimal("3.0")
    stop_loss_percent: Decimal = Decimal("0.022")
    take_profit_percent: Decimal = Decimal("0.045")
    leverage: int = 10
    # Precision values - OPTIONAL, will be auto-fetched from Bybit if not provided
    step_size: Optional[Decimal] = None
    tick_size: Optional[Decimal] = None
    min_qty: Optional[Decimal] = None
    max_qty: Optional[Decimal] = None


class DirectionUpdateRequest(BaseModel):
    symbol: str
    direction: str  # "LONG", "SHORT", "BOTH", "DISABLED"


class CredentialsRequest(BaseModel):
    api_key: str
    api_secret: str
    demo: bool = False  # True = Demo Trading, False = Real Trading


class WatchlistAlertRequest(BaseModel):
    """Alert from Watchlist in JSON format"""
    pattern: Optional[str] = Field(None, description="Pattern name (e.g., HAMMER (ABRIR LONG))")
    symbol: Optional[str] = Field(None, description="Trading symbol (e.g., BTCUSDT)")
    price: Optional[float] = Field(None, description="Current price")
    confidence: Optional[float] = Field(None, description="Pattern confidence (optional)")
    # SwingDetector format fields
    source: Optional[str] = Field(None, description="Alert source (e.g., SWING_DETECTOR)")
    interval: Optional[str] = Field(None, description="Timeframe interval")
    # Integrated TP/SL fields (optional)
    order_type: Optional[str] = Field("Market", description="Order type: Market or Limit")
    limit_price: Optional[float] = Field(None, description="Limit price (required if order_type is Limit)")


# ==========================
# Application Setup
# ==========================

app = FastAPI(
    title="Trading Bot Backend",
    description="Automated trading bot for Bybit with risk management",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ==========================
# Global State
# ==========================

class AppState:
    def __init__(self):
        self.bybit_client: Optional[BybitClient] = None
        self.order_manager: Optional[OrderManager] = None
        self.risk_calculator = RiskCalculator()
        self.direction_manager = DirectionManager()
        self.alert_parser = AlertParser()
        self.trading_config: Dict[str, Any] = {}
        self.ws_connections: List[WebSocket] = []
        self.logs: List[Dict[str, Any]] = []
        self.max_logs = 1000
        self.credentials_file = Path("../config/credentials.json")
        self.order_history_file = Path("../config/order_history.json")
        self.bot_settings_file = Path("../config/bot_settings.json")
        self.symbol_locks: Dict[str, asyncio.Lock] = {}  # Lock per symbol to prevent race conditions
        self.order_history: List[Dict[str, Any]] = []  # Store order history (persistent)
        # Bot settings - configurable execution method
        self.use_integrated_tpsl: bool = False  # False = 3-call method (default), True = integrated method

    def load_config(self):
        """Load trading configuration from JSON"""
        config_path = Path("../config/trading_config.json")
        if config_path.exists():
            with open(config_path, 'r') as f:
                data = json.load(f)
                self.trading_config = {
                    coin["symbol"]: coin for coin in data.get("coins", [])
                }
            self.log("info", f"Loaded configuration for {len(self.trading_config)} symbols")
        else:
            self.log("warning", "No trading_config.json found")

    def load_credentials(self):
        """Load API credentials from JSON"""
        if self.credentials_file.exists():
            try:
                with open(self.credentials_file, 'r') as f:
                    data = json.load(f)
                    api_key = data.get("api_key")
                    api_secret = data.get("api_secret")
                    demo = data.get("demo", False)  # Default to real trading

                    if api_key and api_secret:
                        self.bybit_client = BybitClient(
                            api_key=api_key,
                            api_secret=api_secret,
                            testnet=False,
                            demo=demo
                        )
                        self.order_manager = OrderManager(self.bybit_client)

                        # Set callback for critical alerts (SL/TP failures)
                        self.order_manager.set_critical_alert_callback(self._handle_critical_alert)

                        mode_str = "Demo Trading" if demo else "Real Trading"
                        self.log("success", f"Loaded credentials from file ({mode_str})")
            except Exception as e:
                self.log("error", f"Failed to load credentials: {str(e)}")

    async def _handle_critical_alert(self, alert: Dict[str, Any]):
        """Handle critical alerts from OrderManager (e.g., SL/TP failures)"""
        alert_type = alert.get("type", "UNKNOWN")
        symbol = alert.get("symbol", "UNKNOWN")
        message = alert.get("message", "")
        severity = alert.get("severity", "WARNING")

        # Log with emphasis
        if severity == "CRITICAL":
            self.log("error", f"[CRITICAL] {alert_type}: {symbol} - {message}")
        else:
            self.log("warning", f"[ALERT] {alert_type}: {symbol} - {message}")

        # Broadcast to WebSocket clients immediately
        await self.broadcast_event("critical_alert", alert)

    def save_credentials(self, api_key: str, api_secret: str, demo: bool = False):
        """Save API credentials to JSON"""
        try:
            self.credentials_file.parent.mkdir(parents=True, exist_ok=True)
            data = {
                "api_key": api_key,
                "api_secret": api_secret,
                "demo": demo
            }
            with open(self.credentials_file, 'w') as f:
                json.dump(data, f, indent=2)
            mode_str = "Demo Trading" if demo else "Real Trading"
            self.log("info", f"Credentials saved to file ({mode_str})")
        except Exception as e:
            self.log("error", f"Failed to save credentials: {str(e)}")

    def get_coin_config(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get configuration for a specific symbol"""
        return self.trading_config.get(symbol.upper())

    def get_symbol_lock(self, symbol: str) -> asyncio.Lock:
        """Get or create a lock for a specific symbol"""
        if symbol not in self.symbol_locks:
            self.symbol_locks[symbol] = asyncio.Lock()
        return self.symbol_locks[symbol]

    def load_order_history(self):
        """Load order history from JSON file"""
        if self.order_history_file.exists():
            try:
                with open(self.order_history_file, 'r') as f:
                    self.order_history = json.load(f)
                self.log("info", f"Loaded {len(self.order_history)} orders from history")
            except Exception as e:
                self.log("error", f"Failed to load order history: {str(e)}")
                self.order_history = []
        else:
            self.order_history = []

    def load_bot_settings(self):
        """Load bot settings from JSON file"""
        if self.bot_settings_file.exists():
            try:
                with open(self.bot_settings_file, 'r') as f:
                    settings = json.load(f)
                    self.use_integrated_tpsl = settings.get("use_integrated_tpsl", False)
                    method = "Integrated (1 call)" if self.use_integrated_tpsl else "Sequential (3 calls)"
                    self.log("info", f"Loaded bot settings: execution method = {method}")
            except Exception as e:
                self.log("error", f"Failed to load bot settings: {str(e)}")
                self.use_integrated_tpsl = False
        else:
            self.use_integrated_tpsl = False

    def save_bot_settings(self):
        """Save bot settings to JSON file"""
        try:
            self.bot_settings_file.parent.mkdir(parents=True, exist_ok=True)
            settings = {
                "use_integrated_tpsl": self.use_integrated_tpsl
            }
            with open(self.bot_settings_file, 'w') as f:
                json.dump(settings, f, indent=2)
        except Exception as e:
            self.log("error", f"Failed to save bot settings: {str(e)}")

    def save_order_history(self):
        """Save order history to JSON file"""
        try:
            self.order_history_file.parent.mkdir(parents=True, exist_ok=True)
            with open(self.order_history_file, 'w') as f:
                json.dump(self.order_history, f, indent=2)
        except Exception as e:
            self.log("error", f"Failed to save order history: {str(e)}")

    def add_order_to_history(self, order_data: Dict[str, Any]):
        """Add order to history and persist to disk"""
        order_entry = {
            "timestamp": datetime.now().isoformat(),
            **order_data
        }
        self.order_history.append(order_entry)

        # Save to disk immediately
        self.save_order_history()

    def clear_order_history(self):
        """Clear all order history"""
        self.order_history = []
        self.save_order_history()
        self.log("info", "Order history cleared by user")

    def log(self, level: str, message: str, data: Optional[Dict] = None):
        """Add log entry and broadcast to WebSocket clients"""
        log_entry = {
            "timestamp": datetime.now().isoformat(),
            "level": level,
            "message": message,
            "data": data
        }

        self.logs.append(log_entry)

        # Keep only last N logs
        if len(self.logs) > self.max_logs:
            self.logs = self.logs[-self.max_logs:]

        # Broadcast to WebSocket clients
        asyncio.create_task(self.broadcast_log(log_entry))

        # Also print to console
        prefix = {"info": "[INFO]", "success": "[OK]", "warning": "[WARNING]", "error": "[ERROR]"}.get(level, "[LOG]")
        print(f"{prefix} {message}")

    async def broadcast_log(self, log_entry: Dict):
        """Broadcast log to all connected WebSocket clients"""
        if not self.ws_connections:
            return

        message = json.dumps({"type": "log", "data": log_entry})

        for connection in self.ws_connections[:]:  # Copy list to avoid modification during iteration
            try:
                await connection.send_text(message)
            except:
                if connection in self.ws_connections:
                    self.ws_connections.remove(connection)

    async def broadcast_event(self, event_type: str, data: Any):
        """Broadcast generic event to WebSocket clients"""
        if not self.ws_connections:
            return

        message = json.dumps({"type": event_type, "data": data})

        for connection in self.ws_connections[:]:
            try:
                await connection.send_text(message)
            except:
                if connection in self.ws_connections:
                    self.ws_connections.remove(connection)


state = AppState()


# ==========================
# Startup/Shutdown Events
# ==========================

@app.on_event("startup")
async def startup():
    state.log("info", "Trading Bot Backend starting...")
    state.load_config()
    state.load_credentials()
    state.load_order_history()
    state.load_bot_settings()
    state.log("success", "Backend ready")


@app.on_event("shutdown")
async def shutdown():
    state.log("info", "Trading Bot Backend shutting down...")

    # Close HTTP client gracefully to release connection pool
    if state.bybit_client:
        try:
            await state.bybit_client.close()
            state.log("info", "Bybit client closed successfully")
        except Exception as e:
            state.log("warning", f"Error closing Bybit client: {e}")


# ==========================
# REST API Endpoints
# ==========================

@app.get("/api/status")
async def get_status():
    """Get system status with detailed statistics"""
    # Get statistics from components if available
    bybit_stats = None
    order_manager_stats = None

    if state.bybit_client:
        try:
            bybit_stats = state.bybit_client.get_statistics()
        except Exception:
            pass

    if state.order_manager:
        try:
            order_manager_stats = state.order_manager.get_statistics()
        except Exception:
            pass

    return {
        "status": "online",
        "timestamp": datetime.now().isoformat(),
        "credentials_configured": state.bybit_client is not None,
        "symbols_configured": len(state.trading_config),
        "active_connections": len(state.ws_connections),
        "bybit_client": bybit_stats,
        "order_manager": order_manager_stats
    }


@app.get("/api/credentials/check")
async def check_credentials():
    """Check if credentials are configured"""
    has_creds = state.bybit_client is not None

    return {
        "success": True,
        "configured": has_creds,
        "has_credentials": has_creds
    }


@app.post("/api/credentials")
async def set_credentials(req: CredentialsRequest):
    """Set Bybit API credentials"""
    try:
        # Close existing client if any
        if state.bybit_client:
            try:
                await state.bybit_client.close()
            except Exception:
                pass

        state.bybit_client = BybitClient(
            api_key=req.api_key,
            api_secret=req.api_secret,
            testnet=False,
            demo=req.demo
        )

        state.order_manager = OrderManager(state.bybit_client)
        # Set callback for critical alerts (SL/TP failures)
        state.order_manager.set_critical_alert_callback(state._handle_critical_alert)

        # Save credentials to file
        state.save_credentials(req.api_key, req.api_secret, req.demo)

        mode_str = "Demo Trading (api-demo.bybit.com)" if req.demo else "Real Trading (api.bybit.com)"
        state.log("success", f"[OK] Credentials configured: {mode_str}")

        # Test credentials with a simple API call
        try:
            test_result = await state.bybit_client._make_request("GET", "/v5/market/time")
            if test_result.get("retCode") == 0:
                state.log("success", f"Credentials validated successfully")
            else:
                state.log("warning", f"Credentials saved but validation returned: {test_result.get('retMsg')}")
        except Exception as e:
            state.log("warning", f"Credentials saved but validation failed: {str(e)}")

        return {
            "success": True,
            "message": "Credentials saved successfully",
            "mode": "demo" if req.demo else "live",
            "url": state.bybit_client.base_url
        }
    except Exception as e:
        state.log("error", f"Failed to set credentials: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/config")
async def get_config():
    """Get trading configuration"""
    return {
        "success": True,
        "coins": list(state.trading_config.values())
    }


@app.post("/api/config/update")
async def update_config(req: ConfigUpdateRequest):
    """Update configuration for a symbol"""
    try:
        symbol = req.symbol.upper()
        if symbol not in state.trading_config:
            raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")

        config = state.trading_config[symbol]

        if req.risk_amount is not None:
            config["risk_amount"] = float(req.risk_amount)
        if req.stop_loss_percent is not None:
            config["stop_loss_percent"] = float(req.stop_loss_percent)
        if req.take_profit_percent is not None:
            config["take_profit_percent"] = float(req.take_profit_percent)

        # Save to file
        config_path = Path("../config/trading_config.json")
        with open(config_path, 'w') as f:
            json.dump({"coins": list(state.trading_config.values())}, f, indent=2)

        state.log("success", f"Updated configuration for {symbol}")

        return {"success": True, "config": config}
    except Exception as e:
        state.log("error", f"Failed to update config: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/config/add")
async def add_coin(req: AddCoinRequest):
    """Add new coin configuration with auto-fetched precision from Bybit"""
    try:
        symbol = req.symbol.upper()

        # Check if already exists
        if symbol in state.trading_config:
            raise HTTPException(status_code=400, detail=f"Symbol {symbol} already exists")

        # Get precision values from Bybit if not provided
        step_size = req.step_size
        tick_size = req.tick_size
        min_qty = req.min_qty
        max_qty = req.max_qty

        # If any precision value is missing, fetch from Bybit
        if step_size is None or tick_size is None or min_qty is None or max_qty is None:
            state.log("info", f"Fetching precision info from Bybit for {symbol}...")

            if state.bybit_client is None:
                raise HTTPException(
                    status_code=400,
                    detail="Bybit client not initialized. Configure credentials first or provide precision values manually."
                )

            instrument_info = await state.bybit_client.get_instrument_info(symbol, req.category)

            if not instrument_info.get("success"):
                raise HTTPException(
                    status_code=400,
                    detail=f"Failed to get instrument info from Bybit: {instrument_info.get('error')}"
                )

            # Use fetched values, fallback to provided or defaults
            step_size = step_size or Decimal(str(instrument_info.get("qtyStep", "0.001")))
            tick_size = tick_size or Decimal(str(instrument_info.get("tickSize", "0.01")))
            min_qty = min_qty or Decimal(str(instrument_info.get("minOrderQty", "0.001")))
            # Prefer maxMktOrderQty for market orders
            max_qty_value = instrument_info.get("maxMktOrderQty") or instrument_info.get("maxOrderQty", "100")
            max_qty = max_qty or Decimal(str(max_qty_value))

            state.log("success", f"Auto-detected precision for {symbol}: "
                     f"step={step_size}, tick={tick_size}, min={min_qty}, max={max_qty}")

        # Create new config
        new_config = {
            "symbol": symbol,
            "category": req.category,
            "risk_amount": float(req.risk_amount),
            "stop_loss_percent": float(req.stop_loss_percent),
            "take_profit_percent": float(req.take_profit_percent),
            "leverage": req.leverage,
            "step_size": float(step_size),
            "tick_size": float(tick_size),
            "min_qty": float(min_qty),
            "max_qty": float(max_qty)
        }

        # Add to state
        state.trading_config[symbol] = new_config

        # Save to file
        config_path = Path("../config/trading_config.json")
        with open(config_path, 'w') as f:
            json.dump({"coins": list(state.trading_config.values())}, f, indent=2)

        # Add to direction manager with default DISABLED
        state.direction_manager.set_direction(symbol, "DISABLED")

        state.log("success", f"Added new coin: {symbol}")

        return {"success": True, "config": new_config, "auto_precision": step_size is None}
    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Failed to add coin: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/config/sync-precision/{symbol}")
async def sync_precision(symbol: str):
    """
    Sync precision values (step_size, tick_size, min_qty, max_qty) from Bybit API
    for an existing symbol. Useful when Bybit updates their trading rules.
    """
    try:
        symbol = symbol.upper()

        if symbol not in state.trading_config:
            raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found in configuration")

        if state.bybit_client is None:
            raise HTTPException(
                status_code=400,
                detail="Bybit client not initialized. Configure credentials first."
            )

        config = state.trading_config[symbol]
        category = config.get("category", "linear")

        # Fetch from Bybit
        state.log("info", f"Syncing precision from Bybit for {symbol}...")
        instrument_info = await state.bybit_client.get_instrument_info(symbol, category)

        if not instrument_info.get("success"):
            raise HTTPException(
                status_code=400,
                detail=f"Failed to get instrument info from Bybit: {instrument_info.get('error')}"
            )

        # Store old values for comparison
        old_values = {
            "step_size": config.get("step_size"),
            "tick_size": config.get("tick_size"),
            "min_qty": config.get("min_qty"),
            "max_qty": config.get("max_qty")
        }

        # Update config with new values
        config["step_size"] = float(instrument_info.get("qtyStep", config.get("step_size")))
        config["tick_size"] = float(instrument_info.get("tickSize", config.get("tick_size")))
        config["min_qty"] = float(instrument_info.get("minOrderQty", config.get("min_qty")))
        max_qty_value = instrument_info.get("maxMktOrderQty") or instrument_info.get("maxOrderQty")
        if max_qty_value:
            config["max_qty"] = float(max_qty_value)

        new_values = {
            "step_size": config["step_size"],
            "tick_size": config["tick_size"],
            "min_qty": config["min_qty"],
            "max_qty": config["max_qty"]
        }

        # Save to file
        config_path = Path("../config/trading_config.json")
        with open(config_path, 'w') as f:
            json.dump({"coins": list(state.trading_config.values())}, f, indent=2)

        state.log("success", f"Synced precision for {symbol}: "
                 f"step={new_values['step_size']}, tick={new_values['tick_size']}, "
                 f"min={new_values['min_qty']}, max={new_values['max_qty']}")

        return {
            "success": True,
            "symbol": symbol,
            "old_values": old_values,
            "new_values": new_values
        }
    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Failed to sync precision for {symbol}: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/config/sync-all-precision")
async def sync_all_precision():
    """
    Sync precision values for ALL configured symbols from Bybit API.
    Useful for initial setup or after Bybit updates trading rules.
    """
    try:
        if state.bybit_client is None:
            raise HTTPException(
                status_code=400,
                detail="Bybit client not initialized. Configure credentials first."
            )

        results = []
        errors = []

        for symbol, config in state.trading_config.items():
            category = config.get("category", "linear")

            try:
                instrument_info = await state.bybit_client.get_instrument_info(symbol, category)

                if instrument_info.get("success"):
                    old_step = config.get("step_size")
                    old_tick = config.get("tick_size")

                    config["step_size"] = float(instrument_info.get("qtyStep", config.get("step_size")))
                    config["tick_size"] = float(instrument_info.get("tickSize", config.get("tick_size")))
                    config["min_qty"] = float(instrument_info.get("minOrderQty", config.get("min_qty")))
                    max_qty_value = instrument_info.get("maxMktOrderQty") or instrument_info.get("maxOrderQty")
                    if max_qty_value:
                        config["max_qty"] = float(max_qty_value)

                    results.append({
                        "symbol": symbol,
                        "step_size": config["step_size"],
                        "tick_size": config["tick_size"],
                        "changed": old_step != config["step_size"] or old_tick != config["tick_size"]
                    })
                else:
                    errors.append({"symbol": symbol, "error": instrument_info.get("error")})
            except Exception as e:
                errors.append({"symbol": symbol, "error": str(e)})

        # Save to file
        config_path = Path("../config/trading_config.json")
        with open(config_path, 'w') as f:
            json.dump({"coins": list(state.trading_config.values())}, f, indent=2)

        state.log("success", f"Synced precision for {len(results)} symbols, {len(errors)} errors")

        return {
            "success": True,
            "synced": len(results),
            "errors": len(errors),
            "results": results,
            "error_details": errors if errors else None
        }
    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Failed to sync all precision: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/settings")
async def get_bot_settings():
    """Get bot settings including execution method"""
    return {
        "success": True,
        "use_integrated_tpsl": state.use_integrated_tpsl,
        "execution_method": "integrated" if state.use_integrated_tpsl else "sequential",
        "description": "Integrated sends Market/Limit + TP/SL in 1 API call. Sequential sends 3 separate calls."
    }


@app.post("/api/settings/execution-method")
async def set_execution_method(use_integrated: bool):
    """
    Set the execution method for orders.

    - use_integrated=False (default): 3 separate API calls (Market + SL + TP)
    - use_integrated=True: 1 API call with integrated TP/SL

    The integrated method is faster but may have different behavior
    during high volatility. Sequential is more reliable but slower.
    """
    try:
        old_method = "integrated" if state.use_integrated_tpsl else "sequential"
        state.use_integrated_tpsl = use_integrated
        state.save_bot_settings()

        new_method = "integrated" if use_integrated else "sequential"
        state.log("success", f"Execution method changed: {old_method} -> {new_method}")

        return {
            "success": True,
            "use_integrated_tpsl": state.use_integrated_tpsl,
            "execution_method": new_method,
            "message": f"Execution method set to {new_method}"
        }
    except Exception as e:
        state.log("error", f"Failed to set execution method: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/directions")
async def get_directions():
    """Get trading directions"""
    return {
        "success": True,
        "directions": state.direction_manager.get_all_directions(),
        "stats": state.direction_manager.get_stats()
    }


@app.post("/api/directions/update")
async def update_direction(req: DirectionUpdateRequest):
    """Update trading direction for a symbol"""
    try:
        valid_directions = ["LONG", "SHORT", "BOTH", "DISABLED"]
        if req.direction not in valid_directions:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid direction. Must be one of: {valid_directions}"
            )

        state.direction_manager.set_direction(req.symbol, req.direction)

        state.log("success", f"Set {req.symbol} direction to {req.direction}")

        return {
            "success": True,
            "symbol": req.symbol,
            "direction": req.direction
        }
    except Exception as e:
        state.log("error", f"Failed to update direction: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/alert")
async def process_alert(req: AlertRequest):
    """Process trading alert(s) - supports multiple alerts separated by newlines"""
    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        # Split raw alert by detecting format
        # Format 1: Double newlines (blank line separator)
        # Format 2: Each line starting with [ is a separate alert (ATAS bracket format)
        # Format 3: Every 3 lines is one alert (multi-line format)

        raw_text = req.raw_alert.strip()

        # Try to detect format and split accordingly
        if '\n\n' in raw_text:
            # Format 1: Separated by blank lines
            raw_alerts = [a.strip() for a in raw_text.split('\n\n') if a.strip()]
        elif raw_text.count('[') >= 2:
            # Format 2: Bracket format - each line starting with [ is a separate alert
            lines = raw_text.split('\n')
            raw_alerts = []
            for line in lines:
                line = line.strip()
                if line and line.startswith('['):
                    raw_alerts.append(line)
        else:
            # Format 3: Multi-line format - group every 3-4 lines
            lines = [line.strip() for line in raw_text.split('\n') if line.strip()]
            raw_alerts = []
            i = 0
            while i < len(lines):
                # Group lines until we find a symbol-like line (contains USDT)
                alert_lines = []
                while i < len(lines):
                    alert_lines.append(lines[i])
                    i += 1
                    # If next line looks like a new symbol, break
                    if i < len(lines) and ('USDT' in lines[i] or lines[i].startswith('[')):
                        break
                if alert_lines:
                    raw_alerts.append('\n'.join(alert_lines))

        if len(raw_alerts) == 0:
            raise HTTPException(status_code=400, detail="No alerts found")

        state.log("info", f"Received {len(raw_alerts)} alert(s) to process")

        # Process all alerts in parallel
        async def process_single_alert(raw_alert_text):
            try:
                # Parse alert
                alert = state.alert_parser.parse(raw_alert_text)
                if not alert:
                    return {
                        "success": False,
                        "raw": raw_alert_text,
                        "error": "Failed to parse alert"
                    }

                # Validate alert
                if not state.alert_parser.validate_alert(alert):
                    return {
                        "success": False,
                        "alert": alert,
                        "error": "Invalid alert format"
                    }

                symbol = alert["symbol"]

                # Check direction filter (before acquiring lock - fast check)
                if not state.direction_manager.is_alert_allowed(symbol, alert["side"]):
                    return {
                        "success": False,
                        "alert": alert,
                        "message": f"Alert rejected by direction filter"
                    }

                # Get coin config (before acquiring lock - fast check)
                config = state.get_coin_config(symbol)
                if not config:
                    return {
                        "success": False,
                        "alert": alert,
                        "error": f"No configuration for {symbol}"
                    }

                # ACQUIRE LOCK FOR THIS SYMBOL to prevent race conditions
                # This ensures only ONE alert per symbol is processed at a time
                # But different symbols can still process in parallel
                lock = state.get_symbol_lock(symbol)
                async with lock:
                    state.log("info", f"Acquired lock for {symbol}, processing alert...")

                    # Check for existing position (inside lock to prevent race condition)
                    position = await state.bybit_client.get_position(symbol)
                    if not position.get("success"):
                        return {
                            "success": False,
                            "alert": alert,
                            "error": f"Failed to check position: {position.get('error', 'Unknown')}"
                        }

                    if position.get("hasPosition"):
                        state.log("warning", f"Position already exists for {symbol}, skipping")
                        return {
                            "success": False,
                            "alert": alert,
                            "message": "Position already exists",
                            "skipped": True
                        }

                    # Calculate quantity
                    risk_calc = state.risk_calculator.calculate_quantity(
                        risk_amount=Decimal(str(config["risk_amount"])),
                        stop_loss_percent=Decimal(str(config["stop_loss_percent"])),
                        current_price=alert["price"],
                        min_qty=Decimal(str(config["min_qty"])),
                        max_qty=Decimal(str(config["max_qty"])),
                        step_size=Decimal(str(config["step_size"]))
                    )

                    if not risk_calc.get("success"):
                        return {
                            "success": False,
                            "alert": alert,
                            "error": risk_calc.get("error")
                        }

                    quantity = risk_calc["quantity"]
                    config["current_price"] = float(alert["price"])

                    # Execute order sequence
                    state.log("info", f"Executing trade: {alert['side']} {symbol} qty={quantity}")

                    result = await state.order_manager.execute_complete_sequence(
                        symbol=symbol,
                        side=alert["side"],
                        quantity=quantity,
                        config=config
                    )

                    # Broadcast trade event
                    await state.broadcast_event("trade_executed", result)

                    success_status = result.get("success", False)
                    partial = result.get("partial", False)

                    # Enhanced logging
                    if success_status and partial:
                        state.log("warning", f"{symbol}: Market Order OK but SL/TP failed (network error)")
                    elif success_status:
                        state.log("success", f"{symbol}: Trade completed successfully")
                    else:
                        state.log("error", f"{symbol}: Trade failed - {result.get('error', 'Unknown error')}")

                    # Save successful orders to history
                    if success_status:
                        order_history_entry = {
                            "symbol": symbol,
                            "side": alert["side"],
                            "entry_price": float(alert["price"]),
                            "quantity_coin": float(quantity),
                            "quantity_usdt": float(quantity * alert["price"]),
                            "stop_loss": float(risk_calc.get("stop_loss_price", 0)),
                            "take_profit": float(risk_calc.get("take_profit_price", 0)),
                            "status": "partial" if partial else "success"
                        }
                        state.add_order_to_history(order_history_entry)

                    state.log("info", f"[LOCK] Released lock for {symbol}")

                    return {
                        "success": success_status,
                        "alert": alert,
                        "quantity": float(quantity),
                        "result": result,
                        "partial": partial
                    }

            except Exception as e:
                state.log("error", f"Error processing individual alert: {str(e)}")
                return {
                    "success": False,
                    "raw": raw_alert_text,
                    "error": str(e)
                }

        # Process all alerts in parallel using asyncio.gather
        results = await asyncio.gather(*[process_single_alert(raw) for raw in raw_alerts])

        # Summarize results
        successful = [r for r in results if r.get("success")]
        partial = [r for r in successful if r.get("partial")]
        failed = [r for r in results if not r.get("success")]

        summary_msg = f"Processed {len(results)} alerts: {len(successful)} successful"
        if partial:
            summary_msg += f" ({len(partial)} partial - Market Order OK, SL/TP failed)"
        summary_msg += f", {len(failed)} failed"

        state.log("info", summary_msg)

        # Return first alert info for UI compatibility + summary
        first_result = results[0] if results else {}

        # Build detailed message for UI
        ui_message = summary_msg

        # Add details about failures
        failed_details = []
        for r in results:
            if not r.get("success"):
                alert_info = r.get("alert", {})
                symbol = alert_info.get("symbol", "Unknown")
                reason = r.get("message") or r.get("error", "Unknown error")
                failed_details.append(f"{symbol}: {reason}")

        if failed_details:
            ui_message += "\n\nFailed alerts:\n" + "\n".join(f"- {detail}" for detail in failed_details)

        return {
            "success": len(successful) > 0,
            "total": len(results),
            "successful": len(successful),
            "failed": len(failed),
            "results": results,
            # For backward compatibility with single alert UI
            "alert": first_result.get("alert"),
            "quantity": first_result.get("quantity"),
            "message": ui_message
        }

    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Error processing alerts: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/watchlist-alert")
async def process_watchlist_alert(request: Dict[str, Any]):
    """
    Process alert from Watchlist or SwingDetector in JSON format
    Supports both formats:
    - Watchlist: {pattern, symbol, price, confidence}
    - SwingDetector: {source, symbol, interval, pattern: {patternType, price, direction, ...}}
    """
    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        # Detect source and parse accordingly
        source = request.get("source", "WATCHLIST")
        is_swing_detector = source == "SWING_DETECTOR"

        if is_swing_detector:
            # SwingDetector format: {source, symbol, interval, pattern: {patternType, price, direction, ...}}
            symbol = request.get("symbol", "").upper()
            pattern_data = request.get("pattern", {})
            pattern_type = pattern_data.get("patternType", "UNKNOWN")
            price = pattern_data.get("price", 0)
            confidence = pattern_data.get("confidence", 0)
            direction = pattern_data.get("direction", "").upper()

            # Determine side from direction
            if direction == "LONG":
                side = "Buy"
            elif direction == "SHORT":
                side = "Sell"
            else:
                state.log("error", f"SwingDetector: Invalid direction {direction}")
                raise HTTPException(status_code=400, detail=f"Invalid direction: {direction}")

            pattern = f"{pattern_type} ({direction})"
        else:
            # Original Watchlist format: {pattern, symbol, price, confidence}
            # Or backend_realtime format: {pattern: {patternType, direction, ...}, symbol, ...}
            pattern_raw = request.get("pattern", "")
            symbol = request.get("symbol", "").upper()

            # Handle pattern as dict (from backend_realtime) or string (original)
            if isinstance(pattern_raw, dict):
                pattern_type = pattern_raw.get("patternType", "UNKNOWN")
                direction = pattern_raw.get("direction", "").upper()
                price = pattern_raw.get("price", request.get("price", 0))
                confidence = pattern_raw.get("confidence", request.get("confidence", 0))
                pattern = f"{pattern_type} ({direction})"

                # Determine side from direction in pattern dict
                if direction == "LONG" or direction == "BULLISH":
                    side = "Buy"
                elif direction == "SHORT" or direction == "BEARISH":
                    side = "Sell"
                else:
                    state.log("error", f"Could not determine direction from pattern dict: {pattern_raw}")
                    raise HTTPException(status_code=400, detail=f"Invalid direction in pattern: {direction}")
            else:
                pattern = str(pattern_raw).upper()
                price = request.get("price", 0)
                confidence = request.get("confidence", 0)

                # Determine side from pattern string
                if any(word in pattern for word in ["LONG", "BUY", "COMPRA", "ABRIR LONG", "OPEN LONG"]):
                    side = "Buy"
                elif any(word in pattern for word in ["SHORT", "SELL", "VENTA", "ABRIR SHORT", "OPEN SHORT"]):
                    side = "Sell"
                else:
                    state.log("error", f"Could not determine direction from pattern: {pattern}")
                    raise HTTPException(status_code=400, detail=f"Could not determine direction from pattern: {pattern}")

        price = Decimal(str(price))

        # Log with explicit timestamp for debugging alert timing
        received_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state.log("info", f"[{received_at}] {source} alert: {symbol} {side} @ {price} | {pattern} | Conf: {confidence}%")

        # Check direction filter
        if not state.direction_manager.is_alert_allowed(symbol, side):
            state.log("warning", f"Alert rejected by direction filter: {symbol} {side}")
            log_received_alert(symbol, side, pattern, float(price), confidence, "REJECTED_DIRECTION", source)
            return {
                "success": False,
                "message": f"Direction filter rejected: {symbol} is set to {state.direction_manager.get_direction(symbol)}",
                "symbol": symbol,
                "side": side
            }

        # Get coin config
        config = state.get_coin_config(symbol)
        if not config:
            state.log("error", f"No configuration found for {symbol}")
            log_received_alert(symbol, side, pattern, float(price), confidence, "NO_CONFIG", source)
            raise HTTPException(status_code=404, detail=f"No configuration for {symbol}")

        # Acquire lock for this symbol
        lock = state.get_symbol_lock(symbol)
        async with lock:
            state.log("info", f"Acquired lock for {symbol}, processing {source} alert...")

            # Check for existing position
            position = await state.bybit_client.get_position(symbol)
            if not position.get("success"):
                error_msg = f"Failed to check position: {position.get('error', 'Unknown')}"
                state.log("error", error_msg)
                raise HTTPException(status_code=500, detail=error_msg)

            if position.get("hasPosition"):
                state.log("warning", f"Position already exists for {symbol}, skipping")
                log_received_alert(symbol, side, pattern, float(price), confidence, "SKIPPED_POSITION_EXISTS", source)
                return {
                    "success": False,
                    "message": f"Position already exists for {symbol}",
                    "symbol": symbol,
                    "skipped": True
                }

            # Calculate quantity
            risk_calc = state.risk_calculator.calculate_quantity(
                risk_amount=Decimal(str(config["risk_amount"])),
                stop_loss_percent=Decimal(str(config["stop_loss_percent"])),
                current_price=price,
                min_qty=Decimal(str(config["min_qty"])),
                max_qty=Decimal(str(config["max_qty"])),
                step_size=Decimal(str(config["step_size"]))
            )

            if not risk_calc.get("success"):
                error_msg = risk_calc.get("error", "Risk calculation failed")
                state.log("error", error_msg)
                raise HTTPException(status_code=400, detail=error_msg)

            quantity = risk_calc["quantity"]
            config["current_price"] = float(price)

            # Check for limit price in request
            order_type = request.get("order_type", "Market")
            limit_price_raw = request.get("limit_price")
            limit_price = Decimal(str(limit_price_raw)) if limit_price_raw else None

            # Validate limit order
            if order_type.upper() == "LIMIT" and not limit_price:
                raise HTTPException(status_code=400, detail="limit_price required for Limit orders")

            # Execute order sequence - use configured method
            execution_method = "integrated" if state.use_integrated_tpsl else "sequential"
            order_type_str = f"{order_type.upper()} " if order_type.upper() == "LIMIT" else ""
            state.log("info", f"[TRADE] Executing {order_type_str}trade ({execution_method}): {side} {symbol} qty={quantity} @ {price}")

            if state.use_integrated_tpsl:
                # Integrated method: 1 API call with TP/SL
                result = await state.order_manager.execute_integrated_sequence(
                    symbol=symbol,
                    side=side,
                    quantity=quantity,
                    config=config,
                    order_type=order_type,
                    limit_price=limit_price
                )
            else:
                # Sequential method: 3 separate API calls (original)
                result = await state.order_manager.execute_complete_sequence(
                    symbol=symbol,
                    side=side,
                    quantity=quantity,
                    config=config
                )

            # Broadcast trade event
            await state.broadcast_event("trade_executed", result)

            success_status = result.get("success", False)
            partial = result.get("partial", False)

            # Enhanced logging
            if success_status and partial:
                state.log("warning", f"[PARTIAL] {symbol}: Market Order executed but SL/TP failed")
                log_received_alert(symbol, side, pattern, float(price), confidence, "PARTIAL", source)
            elif success_status:
                state.log("success", f"[SUCCESS] {symbol}: Trade completed successfully! Pattern: {pattern}")
                log_received_alert(symbol, side, pattern, float(price), confidence, "SUCCESS", source)
            else:
                state.log("error", f"[FAILED] {symbol}: Trade failed - {result.get('error', 'Unknown error')}")
                log_received_alert(symbol, side, pattern, float(price), confidence, "FAILED", source)

            # Save to order history
            if success_status:
                order_history_entry = {
                    "symbol": symbol,
                    "side": side,
                    "entry_price": float(price),
                    "quantity_coin": float(quantity),
                    "quantity_usdt": float(quantity * price),
                    "stop_loss": float(risk_calc.get("stop_loss_price", 0)),
                    "take_profit": float(risk_calc.get("take_profit_price", 0)),
                    "pattern": pattern,
                    "confidence": confidence,
                    "source": source,
                    "status": "partial" if partial else "success"
                }
                state.add_order_to_history(order_history_entry)

            state.log("info", f"[LOCK] Released lock for {symbol}")

            return {
                "success": success_status,
                "symbol": symbol,
                "side": side,
                "price": float(price),
                "quantity": float(quantity),
                "pattern": pattern,
                "confidence": confidence,
                "source": source,
                "result": result,
                "partial": partial
            }

    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Error processing watchlist alert: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/trade/manual")
async def manual_trade(req: ManualTradeRequest):
    """Execute manual trade with optional custom SL/TP"""
    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        # Get config
        config = state.get_coin_config(req.symbol)
        if not config:
            raise HTTPException(status_code=404, detail=f"No configuration for {req.symbol}")

        # Check direction
        if not state.direction_manager.is_alert_allowed(req.symbol, req.side):
            raise HTTPException(status_code=403, detail="Direction not allowed")

        # Determine current price - use provided or estimate from SL/TP
        if req.current_price:
            current_price = req.current_price
        elif req.stopLoss and req.takeProfit:
            # Estimate entry price as midpoint between SL and TP (rough approximation)
            # This will be replaced by real execution price after market order
            current_price = (req.stopLoss + req.takeProfit) / 2
        else:
            raise HTTPException(status_code=400, detail="Either current_price or stopLoss/takeProfit required")

        # Calculate or use provided quantity
        if req.quantity is None:
            # If custom SL provided, calculate SL percent from it
            if req.stopLoss:
                sl_percent = abs(float(req.stopLoss) - float(current_price)) / float(current_price)
            else:
                sl_percent = float(config["stop_loss_percent"])

            risk_calc = state.risk_calculator.calculate_quantity(
                risk_amount=Decimal(str(config["risk_amount"])),
                stop_loss_percent=Decimal(str(sl_percent)),
                current_price=current_price,
                min_qty=Decimal(str(config["min_qty"])),
                max_qty=Decimal(str(config["max_qty"])),
                step_size=Decimal(str(config["step_size"]))
            )

            if not risk_calc.get("success"):
                raise HTTPException(status_code=400, detail=risk_calc.get("error"))

            quantity = risk_calc["quantity"]
        else:
            quantity = req.quantity

        # Create modified config with custom SL/TP if provided
        trade_config = config.copy()
        trade_config["current_price"] = float(current_price)

        # Override SL/TP with custom values if provided
        if req.stopLoss:
            trade_config["custom_stop_loss"] = float(req.stopLoss)
        if req.takeProfit:
            trade_config["custom_take_profit"] = float(req.takeProfit)

        # Execute using configured method
        if state.use_integrated_tpsl:
            result = await state.order_manager.execute_integrated_sequence(
                symbol=req.symbol,
                side=req.side,
                quantity=quantity,
                config=trade_config,
                order_type="Market",
                limit_price=None
            )
        else:
            result = await state.order_manager.execute_complete_sequence(
                symbol=req.symbol,
                side=req.side,
                quantity=quantity,
                config=trade_config
            )

        await state.broadcast_event("trade_executed", result)

        return {"success": result.get("success", False), "result": result}

    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Manual trade error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/position/{symbol}")
async def get_position(symbol: str):
    """Get current position for a symbol"""
    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        position = await state.bybit_client.get_position(symbol)
        return position
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs")
async def get_logs(limit: int = 100):
    """Get recent logs"""
    return {
        "success": True,
        "logs": state.logs[-limit:] if limit > 0 else state.logs
    }


@app.get("/api/orders/history")
async def get_order_history(limit: int = 100):
    """Get order history"""
    try:
        # Return orders in reverse chronological order (most recent first)
        orders = state.order_history[-limit:] if limit > 0 else state.order_history
        orders_reversed = list(reversed(orders))

        return {
            "success": True,
            "orders": orders_reversed,
            "total": len(state.order_history)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/orders/history")
async def clear_order_history():
    """Clear all order history"""
    try:
        total_before = len(state.order_history)
        state.clear_order_history()

        state.log("warning", f"Order history cleared: {total_before} orders deleted")

        return {
            "success": True,
            "message": f"Cleared {total_before} orders from history",
            "deleted_count": total_before
        }
    except Exception as e:
        state.log("error", f"Failed to clear order history: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================
# Journal Integration Endpoints
# ==========================

@app.get("/api/positions")
async def get_all_positions():
    """
    Get all open positions - Used by Trading Journal for position monitoring.
    Returns list of positions with details needed for journal entries.
    """
    try:
        if not state.bybit_client:
            return {
                "success": False,
                "error": "Credentials not configured",
                "positions": []
            }

        positions = []
        for symbol in state.trading_config.keys():
            try:
                position = await state.bybit_client.get_position(symbol)
                if position.get("success") and position.get("hasPosition"):
                    positions.append({
                        "symbol": symbol,
                        "side": position.get("side"),
                        "size": position.get("size"),
                        "entryPrice": position.get("entryPrice"),
                        "markPrice": position.get("markPrice"),
                        "unrealizedPnl": position.get("unrealizedPnl"),
                        "leverage": position.get("leverage"),
                        "positionValue": position.get("positionValue"),
                        "takeProfit": position.get("takeProfit"),
                        "stopLoss": position.get("stopLoss"),
                        "createdTime": position.get("createdTime"),
                        "updatedTime": position.get("updatedTime")
                    })
            except Exception as e:
                state.log("warning", f"Failed to get position for {symbol}: {e}")

        return {
            "success": True,
            "positions": positions,
            "count": len(positions),
            "timestamp": datetime.now().isoformat()
        }

    except Exception as e:
        state.log("error", f"Error getting all positions: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "positions": []
        }


@app.get("/api/alerts/recent")
async def get_recent_alerts(minutes: int = 30):
    """
    Get recent alerts received - Used by Trading Journal for source tracking.
    Reads from the alerts_received.log file.
    """
    try:
        alerts = []

        if ALERT_RECEIVED_LOG.exists():
            from datetime import timedelta

            cutoff_time = datetime.now() - timedelta(minutes=minutes)

            with open(ALERT_RECEIVED_LOG, "r", encoding="utf-8") as f:
                for line in f:
                    try:
                        parts = [p.strip() for p in line.strip().split("|")]
                        if len(parts) >= 7:
                            timestamp_str = parts[0]
                            timestamp = datetime.strptime(timestamp_str, "%Y-%m-%d %H:%M:%S")

                            if timestamp >= cutoff_time:
                                alerts.append({
                                    "timestamp": timestamp.isoformat(),
                                    "result": parts[1],
                                    "source": parts[2],
                                    "symbol": parts[3],
                                    "side": parts[4],
                                    "pattern": parts[5],
                                    "price": parts[6].replace("$", ""),
                                    "confidence": parts[7] if len(parts) > 7 else None
                                })
                    except Exception:
                        continue

        alerts.sort(key=lambda x: x["timestamp"], reverse=True)

        return {
            "success": True,
            "alerts": alerts,
            "count": len(alerts),
            "minutes": minutes
        }

    except Exception as e:
        state.log("error", f"Error getting recent alerts: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "alerts": []
        }


@app.get("/api/position-history/{symbol}")
async def get_position_history(symbol: str, limit: int = 10):
    """
    Get closed position history for a symbol from Bybit.
    Used by Trading Journal to detect position closes and calculate PnL.
    """
    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        result = await state.bybit_client._make_request(
            "GET",
            "/v5/position/closed-pnl",
            params={
                "category": "linear",
                "symbol": symbol.upper(),
                "limit": limit
            }
        )

        if result.get("retCode") != 0:
            return {
                "success": False,
                "error": result.get("retMsg", "Unknown error"),
                "history": []
            }

        history = result.get("result", {}).get("list", [])

        formatted = []
        for h in history:
            formatted.append({
                "symbol": h.get("symbol"),
                "side": h.get("side"),
                "qty": h.get("qty"),
                "entryPrice": h.get("avgEntryPrice"),
                "exitPrice": h.get("avgExitPrice"),
                "closedPnl": h.get("closedPnl"),
                "createdTime": h.get("createdTime"),
                "updatedTime": h.get("updatedTime"),
                "orderId": h.get("orderId"),
                "orderType": h.get("orderType"),
                "execType": h.get("execType"),
                "leverage": h.get("leverage")
            })

        return {
            "success": True,
            "history": formatted,
            "count": len(formatted)
        }

    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Error getting position history: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ==========================
# WebSocket Endpoint
# ==========================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket for real-time updates"""
    await websocket.accept()
    state.ws_connections.append(websocket)
    state.log("info", f"WebSocket client connected (total: {len(state.ws_connections)})")

    try:
        # Send initial state
        await websocket.send_text(json.dumps({
            "type": "connected",
            "data": {
                "message": "Connected to Trading Bot",
                "timestamp": datetime.now().isoformat()
            }
        }))

        # Keep connection alive
        while True:
            data = await websocket.receive_text()
            # Echo or process client messages if needed
            await websocket.send_text(json.dumps({"type": "echo", "data": data}))

    except WebSocketDisconnect:
        state.ws_connections.remove(websocket)
        state.log("info", f"WebSocket client disconnected (remaining: {len(state.ws_connections)})")
    except Exception as e:
        state.log("error", f"WebSocket error: {str(e)}")
        if websocket in state.ws_connections:
            state.ws_connections.remove(websocket)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=5000, log_level="info")

