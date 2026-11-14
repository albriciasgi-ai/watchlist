"""
Trading Bot Backend - Main Application
FastAPI server with WebSocket support for real-time updates

Noviembre 2026 (correcciones de la auditoria):
- Cada alerta trabaja sobre una COPIA de la configuracion de la moneda; a disco solo van los
  campos de configuracion (antes el SL/TP de una alerta quedaba para las siguientes)
- /api/alert y /api/watchlist-alert comparten la misma ejecucion: pausa, direccion, posicion,
  ordenes pendientes, tamano con el precio real, reserva del riesgo diario y metodo elegido
- El riesgo diario se reserva bajo un candado global ANTES de ejecutar y se devuelve si la orden
  no se envio; tambien cuenta las ordenes manuales
- Alertas viejas (sent_at) o repetidas se descartan
- API solo en 127.0.0.1, CORS y Origin limitados a apps locales, Host verificado
- Las credenciales se validan con un endpoint privado de solo lectura
- Interruptor para pausar todo el trading
"""

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.trustedhost import TrustedHostMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
from decimal import Decimal, ROUND_CEILING, ROUND_FLOOR, ROUND_HALF_UP
import json
import asyncio
import os
import re
import secrets
import time
from pathlib import Path
from datetime import datetime, date

from trading.bybit_client import BybitClient
from trading.order_manager import OrderManager
from trading.risk_calculator import RiskCalculator, DEFAULT_TAKER_FEE
from trading.direction_manager import DirectionManager
from trading.alert_parser import AlertParser
from trading.private_stream import PrivateStream, order_record
from trading.safe_io import write_json_atomic
from trading.trade_journal import TRADE_ID_RE, TradeJournal, now_ms

# Rutas absolutas: el backend funciona aunque se arranque desde otra carpeta
BACKEND_DIR = Path(__file__).resolve().parent
# BOT_CONFIG_DIR y BOT_LOG_DIR solo para pruebas: asi nunca tocan la configuracion ni las claves reales
CONFIG_DIR = Path(os.environ.get("BOT_CONFIG_DIR") or (BACKEND_DIR.parent / "config"))
TRADING_CONFIG_FILE = CONFIG_DIR / "trading_config.json"
# Journal de trades reales (paso 4): junto a config/, fuera de git. Con BOT_CONFIG_DIR de pruebas queda en su carpeta
JOURNAL_FILE = Path(os.environ.get("BOT_JOURNAL_DIR") or (CONFIG_DIR.parent / "journal")) / "trades.jsonl"

# Alert log file for received alerts
ALERT_LOG_DIR = Path(os.environ.get("BOT_LOG_DIR") or (BACKEND_DIR / "logs"))
ALERT_RECEIVED_LOG = ALERT_LOG_DIR / "alerts_received.log"

# Aplicaciones autorizadas a enviar alertas automaticas. Cualquier otro origen,
# o una alerta sin origen, se rechaza. Solo el Analizador arranca habilitado.
# OJO: el origen lo declara quien envia; es un filtro de enrutamiento, no una autenticacion.
DEFAULT_ALLOWED_ORIGINS = {"ANALIZADOR": True, "WATCHLIST": False, "ORDERFLOW": False}

# Campos que se guardan de cada moneda. Nada propio de una alerta (SL/TP, precio) se guarda.
CONFIG_FIELDS = ("symbol", "category", "risk_amount", "stop_loss_percent", "take_profit_percent",
                 "leverage", "step_size", "tick_size", "min_qty", "max_qty")

# Navegadores aceptados: apps locales en cualquier puerto y Electron empaquetado (file:// envia "null")
LOCAL_ORIGIN_REGEX = r"^(https?://(localhost|127\.0\.0\.1)(:\d+)?|null|file://.*)$"
ALLOWED_HOSTS = ["localhost", "127.0.0.1"]

MIN_SL_PERCENT = Decimal("0.0005")   # SL de la alerta por debajo de 0.05%: se usan SL y TP de la configuracion
MAX_SL_STRETCH = Decimal("2")        # SL absoluto: si el precio se alejo y la distancia real supera 2x la planeada, se rechaza
ALERT_MAX_AGE_S = 120                # alertas con sent_at mas viejo que esto se descartan
DEDUP_TTL_S = 24 * 3600              # misma senal (mismo timestamp) no se ejecuta dos veces en 24 h
DEDUP_TTL_NO_TS_S = 300              # sin timestamp: misma alerta exacta en 5 minutos

# Estado de la ejecucion -> texto en alerts_received.log
STATUS_LOG = {
    "success": "SUCCESS",
    "pending": "PENDING_LIMIT",
    "closed_unprotected": "CLOSED_NO_SL",
    "unprotected": "UNPROTECTED",
    "unknown": "UNKNOWN",
    "failed": "FAILED",
}


def _fmt_num(value) -> str:
    """Precio legible tambien para monedas de centavos (0.001552 no se vuelve 0.00)."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if v == 0:
        return "0.00"
    if abs(v) >= 1:
        return f"{v:.2f}"
    return f"{v:.8f}".rstrip("0").rstrip(".")


def _positive(value) -> bool:
    try:
        return value is not None and float(value) > 0
    except (TypeError, ValueError):
        return False


def _to_float(value) -> Optional[float]:
    try:
        return float(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def log_received_alert(symbol: str, side: str, pattern: str, price: float, confidence: float, result: str, source: str = "WATCHLIST", origin: str = "N/A"):
    """Write received alert to log file"""
    try:
        # Ensure logs directory exists
        ALERT_LOG_DIR.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        conf_str = f"{confidence:.1f}%" if confidence else "N/A"
        log_line = f"{timestamp} | {result} | {source} | {symbol} | {side} | {pattern} | ${_fmt_num(price)} | {conf_str} | {origin}\n"
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
    currentPrice: Optional[Decimal] = None  # Alias que envian App 8 y App 9
    price: Optional[Decimal] = None  # Alias que enviaba App 10
    stopLoss: Optional[Decimal] = None  # Custom SL price
    takeProfit: Optional[Decimal] = None  # Custom TP price
    order_type: Optional[str] = "Market"  # "Market" or "Limit"
    limit_price: Optional[Decimal] = None  # Required if order_type is "Limit"
    custom_stop_loss: Optional[Decimal] = None  # Alias for stopLoss (compatibility)
    custom_take_profit: Optional[Decimal] = None  # Alias for takeProfit (compatibility)


class ConfigUpdateRequest(BaseModel):
    symbol: str
    risk_amount: Optional[Decimal] = None
    stop_loss_percent: Optional[Decimal] = None
    take_profit_percent: Optional[Decimal] = None


class LeverageRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    leverage: int = Field(ge=1, le=100)


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


class AccountAddRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    api_key: str = Field(min_length=1, max_length=200)
    api_secret: str = Field(min_length=1, max_length=200)
    demo: bool = False


class AccountRenameRequest(BaseModel):
    name: str = Field(min_length=1, max_length=40)


ACCOUNT_ID_RE = re.compile(r"^[a-f0-9]{12}$")


class AccountStore:
    """
    Cuentas de Bybit guardadas (pedido del usuario el 12/11/2026): varias claves, reales o demo, con nombre.
    El bot opera con UNA a la vez, la activa; sus claves siguen tambien en credentials.json, que es lo que
    carga al arrancar (App 10 y lo anterior no cambian). Mismo cuidado que credentials.json: archivo local,
    fuera de git. La primera vez, la clave de credentials.json pasa a ser la "Cuenta principal".
    """

    def __init__(self, path: Path, credentials_file: Path):
        self.path = path
        self.credentials_file = credentials_file

    def load(self) -> Dict[str, Any]:
        if self.path.exists():
            data = json.loads(self.path.read_text(encoding="utf-8"))  # ilegible: error, nunca una lista vacia
            if not isinstance(data, dict) or not isinstance(data.get("accounts"), list):
                raise ValueError("accounts.json no tiene el formato esperado")
            return data
        data = {"active": None, "accounts": []}
        if self.credentials_file.exists():
            creds = json.loads(self.credentials_file.read_text(encoding="utf-8"))
            if creds.get("api_key") and creds.get("api_secret"):
                acc = self.new_account("Cuenta principal", creds["api_key"], creds["api_secret"], bool(creds.get("demo")))
                data = {"active": acc["id"], "accounts": [acc]}
                self.save(data)
        return data

    def save(self, data: Dict[str, Any]) -> None:
        write_json_atomic(self.path, data)

    @staticmethod
    def new_account(name: str, api_key: str, api_secret: str, demo: bool) -> Dict[str, Any]:
        return {"id": secrets.token_hex(6), "name": name.strip(), "api_key": api_key.strip(), "api_secret": api_secret.strip(),
                "demo": bool(demo), "created_at": datetime.now().isoformat(timespec="seconds"),
                "validated": None, "validation_message": None}

    @staticmethod
    def find(data: Dict[str, Any], account_id: str) -> Optional[Dict[str, Any]]:
        return next((a for a in data["accounts"] if a.get("id") == account_id), None)

    @staticmethod
    def public(acc: Dict[str, Any], active_id: Optional[str]) -> Dict[str, Any]:
        """Lo que sale por la API: nunca el secreto, y de la clave solo los ultimos 4 caracteres."""
        key = acc.get("api_key") or ""
        return {"id": acc["id"], "name": acc.get("name"), "demo": bool(acc.get("demo")),
                "mode": "demo" if acc.get("demo") else "live", "key_hint": f"...{key[-4:]}" if key else None,
                "active": acc["id"] == active_id, "created_at": acc.get("created_at"),
                "validated": acc.get("validated"), "validation_message": acc.get("validation_message")}


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

# CORS: solo paginas servidas desde este PC (cualquier puerto) y Electron empaquetado
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Host verificado: bloquea paginas que apunten su dominio a 127.0.0.1 (DNS rebinding)
app.add_middleware(TrustedHostMiddleware, allowed_hosts=ALLOWED_HOSTS)


@app.middleware("http")
async def reject_foreign_origins(request: Request, call_next):
    """
    CORS no impide que un POST 'simple' de otra pagina llegue y se ejecute.
    Cualquier peticion que cambie algo y venga de un navegador con un Origin ajeno se rechaza.
    Las llamadas entre backends (httpx) no envian Origin y pasan.
    """
    origin = request.headers.get("origin")
    if origin and request.method not in ("GET", "HEAD", "OPTIONS") and not re.fullmatch(LOCAL_ORIGIN_REGEX, origin):
        return JSONResponse(status_code=403, content={"success": False, "detail": f"Origin not allowed: {origin}"})
    return await call_next(request)


# ==========================
# Global State
# ==========================

class AppState:
    def __init__(self):
        self.bybit_client: Optional[BybitClient] = None
        self.order_manager: Optional[OrderManager] = None
        self.risk_calculator = RiskCalculator()
        self.direction_manager = DirectionManager(str(CONFIG_DIR / "trading_directions.json"))
        self.alert_parser = AlertParser()
        self.trading_config: Dict[str, Any] = {}
        self.ws_connections: List[WebSocket] = []
        self.logs: List[Dict[str, Any]] = []
        self.max_logs = 1000
        self.credentials_file = CONFIG_DIR / "credentials.json"
        self.accounts = AccountStore(CONFIG_DIR / "accounts.json", self.credentials_file)
        self.active_account: Optional[Dict[str, Any]] = None  # id, nombre y modo de la cuenta activa
        self.accounts_lock = asyncio.Lock()  # una sola escritura de accounts.json a la vez
        # Mientras cambia la cuenta (o las claves) ninguna orden empieza, y una orden en curso impide el cambio:
        # asi una orden nunca revisa la posicion en una cuenta y se envia por otra
        self.account_switching: bool = False
        # Cuenta activa en tiempo real (WebSocket privado + foto por REST): posiciones, ordenes y ejecuciones
        self.stream: Optional[PrivateStream] = None
        # Posiciones sin SL: desde cuando se ven asi y a cuales ya se aviso (una vez por posicion)
        self.unprotected_since: Dict[str, float] = {}
        self.unprotected_alerted: set = set()
        # Journal: trades reales (apertura por el WebSocket, cierres de Bybit, notas)
        self.journal = TradeJournal(JOURNAL_FILE)
        self.journal_active: Dict[str, Dict[str, Any]] = {}  # posicion abierta -> {trade_id, last}
        self.stream_started_ms: int = 0
        self.order_history_file = CONFIG_DIR / "order_history.json"
        self.bot_settings_file = CONFIG_DIR / "bot_settings.json"
        self.symbol_locks: Dict[str, asyncio.Lock] = {}  # Lock per symbol to prevent race conditions
        self.order_history: List[Dict[str, Any]] = []  # Store order history (persistent)
        # Bot settings - configurable execution method
        self.use_integrated_tpsl: bool = False  # False = 3-call method (default), True = integrated method
        # Daily risk tracking
        self.daily_risk_limit: float = 0.0  # 0 = no limit
        self.daily_risk_used: float = 0.0  # accumulated risk today
        self.daily_risk_date: str = ""  # date string YYYY-MM-DD
        self.daily_risk_trades: int = 0  # trades count today
        self.risk_lock = asyncio.Lock()  # un solo candado para reservar riesgo diario
        # Alert origin filter
        self.allowed_origins: Dict[str, bool] = dict(DEFAULT_ALLOWED_ORIGINS)
        # Pausa global del trading
        self.trading_paused: bool = False
        # Comision taker usada para dimensionar (riesgo incluye entrada y salida)
        self.taker_fee_rate: Decimal = DEFAULT_TAKER_FEE
        # Alertas ya vistas (deduplicacion): clave -> expiracion
        self.recent_alerts: Dict[str, float] = {}
        # Avisos criticos recientes (para la interfaz tras reconectar)
        self.critical_alerts: List[Dict[str, Any]] = []

    def load_config(self):
        """Load trading configuration from JSON"""
        if TRADING_CONFIG_FILE.exists():
            with open(TRADING_CONFIG_FILE, 'r') as f:
                data = json.load(f)
            coins = data.get("coins", [])
            self.trading_config = {
                coin["symbol"].upper(): {k: coin[k] for k in CONFIG_FIELDS if k in coin}
                for coin in coins
            }
            stale = sorted({k for coin in coins for k in coin if k not in CONFIG_FIELDS})
            self.log("info", f"Loaded configuration for {len(self.trading_config)} symbols")
            if stale:
                # Restos de alertas viejas (SL/TP, precio): se descartan y se limpia el archivo
                self.log("warning", f"trading_config.json traia datos de alertas ({', '.join(stale)}): se descartan")
                self.save_trading_config()
        else:
            self.log("warning", "No trading_config.json found")

    def save_trading_config(self):
        """Guarda solo los campos de configuracion de cada moneda."""
        coins = [{k: c[k] for k in CONFIG_FIELDS if k in c} for c in self.trading_config.values()]
        write_json_atomic(TRADING_CONFIG_FILE, {"coins": coins})

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

        self.critical_alerts.append(alert)
        self.critical_alerts = self.critical_alerts[-100:]

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
            write_json_atomic(self.credentials_file, data)
            mode_str = "Demo Trading" if demo else "Real Trading"
            self.log("info", f"Credentials saved to file ({mode_str})")
        except Exception as e:
            self.log("error", f"Failed to save credentials: {str(e)}")

    def get_coin_config(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Copia de la configuracion de un simbolo (una alerta nunca modifica la compartida)."""
        cfg = self.trading_config.get(symbol.upper())
        return dict(cfg) if cfg else None

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
                    self.daily_risk_limit = settings.get("daily_risk_limit", 0.0)
                    self.trading_paused = settings.get("trading_paused", False) is True
                    try:
                        self.taker_fee_rate = Decimal(str(settings.get("taker_fee_rate", DEFAULT_TAKER_FEE)))
                    except Exception:
                        self.taker_fee_rate = DEFAULT_TAKER_FEE
                    saved_origins = settings.get("allowed_origins", {})
                    self.allowed_origins = {
                        origin: saved_origins.get(origin, default) is True
                        for origin, default in DEFAULT_ALLOWED_ORIGINS.items()
                    }
                    # Restore daily counters only if same day
                    saved_date = settings.get("daily_risk_date", "")
                    today = date.today().isoformat()
                    if saved_date == today:
                        self.daily_risk_used = settings.get("daily_risk_used", 0.0)
                        self.daily_risk_trades = settings.get("daily_risk_trades", 0)
                        self.daily_risk_date = saved_date
                    else:
                        self.daily_risk_date = today
                        self.daily_risk_used = 0.0
                        self.daily_risk_trades = 0
                    method = "Integrated (1 call)" if self.use_integrated_tpsl else "Sequential (3 calls)"
                    self.log("info", f"Loaded bot settings: execution method = {method}")
                    if self.daily_risk_limit > 0:
                        self.log("info", f"[RISK] Daily limit: ${self.daily_risk_limit:.2f} | "
                                 f"Used today: ${self.daily_risk_used:.2f} ({self.daily_risk_trades} trades)")
                    if self.trading_paused:
                        self.log("warning", "[PAUSA] El bot arranco EN PAUSA: no abrira operaciones")
            except Exception as e:
                self.log("error", f"Failed to load bot settings: {str(e)}")
                self.use_integrated_tpsl = False
        else:
            self.use_integrated_tpsl = False
            self.daily_risk_date = date.today().isoformat()

    def save_bot_settings(self):
        """Save bot settings to JSON file"""
        try:
            self.bot_settings_file.parent.mkdir(parents=True, exist_ok=True)
            settings = {
                "use_integrated_tpsl": self.use_integrated_tpsl,
                "daily_risk_limit": self.daily_risk_limit,
                "daily_risk_date": self.daily_risk_date,
                "daily_risk_used": self.daily_risk_used,
                "daily_risk_trades": self.daily_risk_trades,
                "allowed_origins": self.allowed_origins,
                "trading_paused": self.trading_paused,
                "taker_fee_rate": float(self.taker_fee_rate)
            }
            write_json_atomic(self.bot_settings_file, settings)
        except Exception as e:
            self.log("error", f"Failed to save bot settings: {str(e)}")

    def save_order_history(self):
        """Save order history to JSON file"""
        try:
            write_json_atomic(self.order_history_file, self.order_history)
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

    def _reset_daily_risk_if_new_day(self):
        """Reset daily risk counters if it's a new day"""
        today = date.today().isoformat()
        if self.daily_risk_date != today:
            if self.daily_risk_used > 0:
                self.log("info", f"[RISK] New day detected. Previous day ({self.daily_risk_date}): "
                         f"{self.daily_risk_trades} trades, ${self.daily_risk_used:.2f} risked")
            self.daily_risk_date = today
            self.daily_risk_used = 0.0
            self.daily_risk_trades = 0
            self.save_bot_settings()

    def check_daily_risk_limit(self, risk_amount: float) -> Dict[str, Any]:
        """Consulta (sin reservar) si una operacion cabe en el limite diario"""
        self._reset_daily_risk_if_new_day()
        if self.daily_risk_limit <= 0:
            return {"allowed": True}
        remaining = round(self.daily_risk_limit - self.daily_risk_used, 6)
        if round(float(risk_amount), 6) > remaining + 1e-6:
            return {
                "allowed": False,
                "limit": self.daily_risk_limit,
                "used": self.daily_risk_used,
                "remaining": remaining,
                "requested": risk_amount,
                "trades_today": self.daily_risk_trades
            }
        return {"allowed": True, "remaining": remaining - risk_amount}

    async def reserve_daily_risk(self, risk_amount: float) -> Dict[str, Any]:
        """
        Reserva el riesgo de una operacion ANTES de ejecutarla, bajo un candado global.
        Dos alertas simultaneas de simbolos distintos ya no pueden pasar las dos el limite.
        """
        async with self.risk_lock:
            check = self.check_daily_risk_limit(risk_amount)
            if not check["allowed"]:
                return check
            self.daily_risk_used = round(self.daily_risk_used + float(risk_amount), 6)
            self.daily_risk_trades += 1
            self.save_bot_settings()
            limit_str = f"${self.daily_risk_limit:.2f}" if self.daily_risk_limit > 0 else "sin limite"
            self.log("info", f"[RISK] Daily risk: ${self.daily_risk_used:.2f} / {limit_str} ({self.daily_risk_trades} trades)")
            return {"allowed": True, "reserved": float(risk_amount)}

    async def release_daily_risk(self, risk_amount: float):
        """Devuelve una reserva cuando la orden no llego a enviarse o Bybit la rechazo."""
        async with self.risk_lock:
            self.daily_risk_used = round(max(0.0, self.daily_risk_used - float(risk_amount)), 6)
            self.daily_risk_trades = max(0, self.daily_risk_trades - 1)
            self.save_bot_settings()

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
        try:
            asyncio.get_running_loop().create_task(self.broadcast_log(log_entry))
        except RuntimeError:
            pass  # sin event loop (arranque): solo consola

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

        message = json.dumps({"type": event_type, "data": data}, default=str)

        for connection in self.ws_connections[:]:
            try:
                await connection.send_text(message)
            except:
                if connection in self.ws_connections:
                    self.ws_connections.remove(connection)


state = AppState()


# ==========================
# Precision y arranque
# ==========================

async def sync_precision_for(symbol: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Actualiza step/tick/min/max de una moneda (endpoint publico de Bybit). Modifica la config compartida."""
    info = await state.bybit_client.get_instrument_info(symbol, config.get("category", "linear"))
    if not info.get("success"):
        return {"symbol": symbol, "error": info.get("error")}
    old_values = {k: config.get(k) for k in ("step_size", "tick_size", "min_qty", "max_qty")}
    if info.get("qtyStep"):
        config["step_size"] = float(info["qtyStep"])
    if info.get("tickSize"):
        config["tick_size"] = float(info["tickSize"])
    if info.get("minOrderQty"):
        config["min_qty"] = float(info["minOrderQty"])
    max_qty_value = info.get("maxMktOrderQty") or info.get("maxOrderQty")
    if max_qty_value:
        config["max_qty"] = float(max_qty_value)
    new_values = {k: config.get(k) for k in ("step_size", "tick_size", "min_qty", "max_qty")}
    return {"symbol": symbol, "old_values": old_values, "new_values": new_values,
            "changed": old_values != new_values, "status": info.get("status")}


async def sync_all_precision_internal() -> Dict[str, Any]:
    results, errors = [], []
    for symbol, config in state.trading_config.items():
        try:
            r = await sync_precision_for(symbol, config)
            if r.get("error"):
                errors.append({"symbol": symbol, "error": r["error"]})
                continue
            results.append(r)
            if r["changed"]:
                state.log("warning", f"[PRECISION] {symbol}: {r['old_values']} -> {r['new_values']}")
            if r.get("status") and r["status"] != "Trading":
                state.log("warning", f"[PRECISION] {symbol} esta '{r['status']}' en Bybit: sus alertas seran rechazadas")
        except Exception as e:
            errors.append({"symbol": symbol, "error": str(e)})
    if results:
        state.save_trading_config()
    return {"results": results, "errors": errors}


async def startup_sync():
    """Al arrancar o al cambiar credenciales: modo de posicion y precision real (solo lectura)."""
    client = state.bybit_client
    if not client:
        return
    try:
        first = next(iter(state.trading_config), None)
        if first:
            await client.get_position(first)  # cada entrada trae positionIdx: aprende hedge/one-way
            state.log("info", f"[BYBIT] Position mode: {client._position_mode or 'unknown'}")
        summary = await sync_all_precision_internal()
        state.log("info", f"[PRECISION] Synced {len(summary['results'])} symbols, {len(summary['errors'])} errors")
    except Exception as e:
        state.log("warning", f"Startup sync failed: {e}")
    await review_account()
    try:
        await journal_sync(days=7)  # lo cerrado la ultima semana (tambien con el bot apagado o en otra cuenta)
    except Exception as e:
        state.log("warning", f"[JOURNAL] {e}")


# ==========================
# Cuenta en tiempo real (paso 4 de la integracion, 12/11/2026)
# ==========================

def private_stream_enabled() -> bool:
    return os.environ.get("BOT_PRIVATE_STREAM", "1") != "0"


async def restart_stream() -> None:
    """El WebSocket privado sigue al cliente activo: al arrancar y al cambiar de cuenta o de claves."""
    old, state.stream = state.stream, None
    if old:
        await old.stop()
    state.unprotected_since.clear()
    state.journal_active = {}
    state.stream_started_ms = now_ms()
    if state.bybit_client and private_stream_enabled():
        state.stream = PrivateStream(state.bybit_client, on_event=on_stream_event,
                                     ws_url=os.environ.get("BOT_PRIVATE_WS_URL") or None)
        state.stream.start()


async def on_stream_event(kind: str, data: Any) -> None:
    """Lo del WebSocket privado va a las apps conectadas y, si son posiciones, al journal."""
    await state.broadcast_event(kind, data)
    if kind == "position_update":
        try:
            await journal_positions(data)
        except Exception as e:
            state.log("warning", f"[JOURNAL] No se pudo anotar: {e}")


def _position_key(p: Dict[str, Any]) -> str:
    return f"{p.get('symbol')}:{p.get('positionIdx')}:{p.get('side')}"


OPENING_EXEC_WINDOW_MS = 120_000  # la ejecucion que abrio una posicion es de los 2 minutos anteriores a verla


def _recent_entry(p: Dict[str, Any]) -> Dict[str, Any]:
    """La orden del historial del bot de esa moneda y lado en los 10 minutos anteriores (la regla de antes)."""
    limit = time.time() - 600
    for entry in reversed(state.order_history[-300:]):
        try:
            ts = datetime.fromisoformat(str(entry.get("timestamp"))).timestamp()
        except ValueError:
            continue
        if ts < limit:
            break
        if entry.get("symbol") == p.get("symbol") and entry.get("side") == p.get("side") and entry.get("status") != "failed":
            return {"origin": entry.get("origin"), "source": entry.get("source"), "pattern": entry.get("pattern")}
    return {}


def _opening_execution(p: Dict[str, Any], opened_ms: int) -> Optional[Dict[str, Any]]:
    """La ejecucion (WebSocket privado) que abrio la posicion: misma moneda y lado, sin cerrar nada, reciente."""
    stream = state.stream
    if not stream:
        return None
    for e in reversed(list(stream.executions)):
        if e.get("symbol") != p.get("symbol") or e.get("side") != p.get("side"):
            continue
        if (e.get("execType") or "Trade") != "Trade" or (e.get("closedSize") or 0) > 0:
            continue
        at = int(_num(e.get("execTime")) or 0)
        if at and at < opened_ms - OPENING_EXEC_WINDOW_MS:
            break  # las ejecuciones llegan en orden: de aqui hacia atras son de antes
        if e.get("orderId") or e.get("orderLinkId"):
            return e
    return None


def origin_for(p: Dict[str, Any], opened_ms: Optional[int] = None) -> Dict[str, Any]:
    """
    La orden que abrio la posicion: {"origin", "source", "pattern", "order_id", "order_link_id"} (lo que se sepa).
    Primero por su ejecucion: su orden en el historial del bot, aunque sea una Limit puesta hace horas (antes una
    Limit del panel llenada despues de 10 minutos quedaba "externa"). Sin la ejecucion, la orden del bot de esa
    moneda y lado en los 10 minutos anteriores.
    """
    execution = _opening_execution(p, opened_ms or now_ms())
    if not execution:
        return _recent_entry(p)
    order_id, link_id = execution.get("orderId") or None, execution.get("orderLinkId") or None
    ids = {"order_id": order_id, "order_link_id": link_id}
    for entry in reversed(state.order_history[-1000:]):
        if entry.get("symbol") != p.get("symbol"):
            continue
        if (order_id and entry.get("order_id") == order_id) or (link_id and entry.get("order_link_id") == link_id):
            return {"origin": entry.get("origin"), "source": entry.get("source"), "pattern": entry.get("pattern"),
                    "exact": True, **ids}
    # Una orden del historial sin numero (anterior a este cambio) se reconoce por la regla de los 10 minutos
    return {**_recent_entry(p), **ids}


async def journal_link_later(trade_id: str, p: Dict[str, Any], opened_ms: int, waits=(3, 7)) -> None:
    """
    La orden que abrio la posicion, buscada otra vez a los 3 y a los 10 s: su ejecucion puede llegar por el
    WebSocket despues que la posicion, y la orden del bot entra a su historial cuando termina de verificarla
    (una orden del panel a mercado quedaba "externa" por eso).
    """
    link = {}
    for wait in waits:
        await asyncio.sleep(wait)
        link = origin_for(p, opened_ms)
        if link.get("origin"):
            break
    if (link.get("origin") or link.get("order_id") or link.get("order_link_id")) and state.journal.record_link(trade_id, link):
        state.log("info", f"[JOURNAL] {p.get('symbol')} {p.get('side')}: abierta por la orden {link.get('order_id') or '?'}"
                  f" ({link.get('origin') or 'externa'})")


async def journal_positions(positions: List[Dict[str, Any]]) -> None:
    """
    Apertura: una posicion que el journal no seguia. Si ya habia un trade abierto anotado de esa moneda y lado
    (el bot se reinicio), se sigue ese. Una posicion que ya existia antes de arrancar el WebSocket queda como
    "anterior" (no se sabe cuando abrio). Cambios de SL, TP o tamano se anotan; si baja el tamano o la posicion
    desaparece, se piden los cierres a Bybit.
    """
    account = state.active_account
    account_id = (account or {}).get("id")
    current = {}
    for p in positions:
        key = _position_key(p)
        current[key] = p
        known = state.journal_active.get(key)
        if known is None:
            # Solo si es la misma posicion: con otra entrada, la anotada se cerro con el bot apagado y esta es nueva
            entry = _num(p.get("entryPrice")) or 0
            reuse = [t for t in state.journal.open_trades(p.get("symbol"), p.get("side"), account_id)
                     if t.get("entry") and entry and abs(t["entry"] - entry) / t["entry"] < 0.005]
            if reuse:
                trade = reuse[0]
                state.journal_active[key] = {"trade_id": trade["trade_id"],
                                             "last": {k: trade.get(k) for k in ("size", "entry", "stop_loss", "take_profit")}}
                known = state.journal_active[key]
            else:
                updated = int(_num(p.get("updatedTime")) or 0)
                pre_existing = bool(updated) and updated < state.stream_started_ms - 60000
                opened_ms = now_ms()
                link = {} if pre_existing else origin_for(p, opened_ms)
                trade_id = state.journal.record_open(p, origin=link.get("origin"), source=link.get("source"),
                                                     pattern=link.get("pattern"), account=account, pre_existing=pre_existing,
                                                     at=opened_ms, order_id=link.get("order_id"),
                                                     order_link_id=link.get("order_link_id"))
                state.journal_active[key] = {"trade_id": trade_id, "last": TradeJournal.snapshot(p)}
                state.log("info", f"[JOURNAL] Apertura anotada: {p.get('symbol')} {p.get('side')} {p.get('size')} @ {p.get('entryPrice')}"
                          f" ({'anterior al bot' if pre_existing else link.get('origin') or 'externa'})")
                if not pre_existing and not (link.get("origin") and (link.get("order_id") or link.get("order_link_id"))):
                    asyncio.create_task(journal_link_later(trade_id, p, opened_ms))
                continue
        now = state.journal.record_update(known["trade_id"], p, known["last"])
        if now:
            if (now.get("size") or 0) < (known["last"].get("size") or 0):
                asyncio.create_task(journal_sync(symbol=p.get("symbol"), days=1, delay=3))  # cierre parcial
            known["last"] = now
    for key in list(state.journal_active):
        if key not in current:
            state.journal_active.pop(key)
            asyncio.create_task(journal_sync(symbol=key.split(":")[0], days=1, delay=3))


async def journal_sync(symbol: Optional[str] = None, days: int = 1, delay: float = 0.0) -> int:
    """Cierres de Bybit (/v5/position/closed-pnl, neto de comisiones) de la cuenta activa. Devuelve cuantos nuevos."""
    if delay:
        await asyncio.sleep(delay)
    client = state.bybit_client
    if not client:
        return 0
    account = state.active_account
    params = {"category": "linear", "limit": 100, "startTime": now_ms() - min(max(days, 1), 7) * 86400000}
    if symbol:
        params["symbol"] = symbol
    rows, cursor = [], None
    for _ in range(10):
        query = dict(params)
        if cursor:
            query["cursor"] = cursor
        result = await client._make_request("GET", "/v5/position/closed-pnl", query)
        if result.get("retCode") != 0:
            state.log("warning", f"[JOURNAL] Bybit no dio los cierres: {result.get('retMsg')} (retCode={result.get('retCode')})")
            break
        body = result.get("result") or {}
        rows.extend(body.get("list") or [])
        cursor = body.get("nextPageCursor")
        if not cursor:
            break
    if client is not state.bybit_client:
        return 0  # la cuenta cambio mientras se pedian
    added = sum(1 for row in sorted(rows, key=lambda x: int(_num(x.get("updatedTime")) or 0))
                if state.journal.record_close(row, account))
    if added:
        state.log("info", f"[JOURNAL] {added} cierre(s) de Bybit anotado(s)")
        await state.broadcast_event("journal_update", {"added": added})
    return added


async def journal_loop() -> None:
    """Cada minuto, los cierres del ultimo dia (los de TP o SL que no pasaron por el bot tambien)."""
    while True:
        await asyncio.sleep(60)
        try:
            await journal_sync(days=1)
        except Exception as e:
            state.log("warning", f"[JOURNAL] {e}")


async def live_book():
    """
    Posiciones y ordenes abiertas de la cuenta activa: del WebSocket privado si esta al dia; si no, una foto
    por REST (dos llamadas, sin importar cuantas monedas haya). Devuelve (libro, fuente).
    """
    client = state.bybit_client
    if not client:
        raise HTTPException(status_code=400, detail="Credentials not configured")
    stream = state.stream
    if stream is not None and stream.client is client:
        if not stream.fresh():
            await stream.snapshot()
        if stream.ready:
            return stream, ("stream" if stream.connected else "rest")
    book = PrivateStream(client)
    if await book.snapshot():
        return book, "rest"
    raise HTTPException(status_code=502, detail=f"Bybit no respondio: {book.last_error}")


async def review_account() -> None:
    """Al arrancar y al cambiar de cuenta: que hay abierto en Bybit. Solo lee y avisa; no toca nada."""
    try:
        book, _ = await live_book()
    except Exception as e:
        state.log("warning", f"[REVISION] No se pudo revisar la cuenta: {getattr(e, 'detail', e)}")
        return
    positions = book.position_list()
    entries = [o for o in book.order_list() if o.get("entry")]
    state.log("info", f"[REVISION] En Bybit: {len(positions)} posiciones abiertas y {len(entries)} ordenes de entrada pendientes")
    await check_unprotected(positions, grace=0)


async def check_unprotected(positions: List[Dict[str, Any]], grace: float = 20.0) -> None:
    """
    Aviso critico, una vez por posicion, si sigue sin stop loss pasados `grace` segundos. El bot pone el SL en
    uno o dos segundos tras llenar; una posicion abierta a mano en Bybit sin SL tambien se avisa.
    """
    now = time.time()
    open_keys = set()
    for p in positions:
        key = f"{p.get('symbol')}:{p.get('side')}:{p.get('positionIdx')}:{p.get('createdTime')}"
        open_keys.add(key)
        if p.get("stopLoss"):
            state.unprotected_since.pop(key, None)
            continue
        since = state.unprotected_since.setdefault(key, now)
        if now - since >= grace and key not in state.unprotected_alerted:
            state.unprotected_alerted.add(key)
            await state._handle_critical_alert({
                "type": "POSITION_WITHOUT_SL", "symbol": p.get("symbol"), "severity": "CRITICAL", "timestamp": now,
                "message": f"Posicion {p.get('side')} de {p.get('size')} en Bybit sin stop loss (entrada {p.get('entryPrice')})",
            })
    for key in list(state.unprotected_since):
        if key not in open_keys:
            state.unprotected_since.pop(key, None)


async def unprotected_watch() -> None:
    """Cada 10 s revisa con lo que ya sabe el WebSocket privado (no consulta Bybit)."""
    while True:
        await asyncio.sleep(10)
        try:
            stream = state.stream
            if stream is not None and stream.ready:
                await check_unprotected(stream.position_list())
        except Exception as e:
            state.log("warning", f"[REVISION] {e}")


# ==========================
# Startup/Shutdown Events
# ==========================

@app.on_event("startup")
async def startup():
    state.log("info", "Trading Bot Backend starting...")
    state.load_config()
    state.load_credentials()
    refresh_active_account()  # migra credentials.json a la "Cuenta principal" la primera vez
    state.load_order_history()
    state.load_bot_settings()
    await restart_stream()
    asyncio.create_task(unprotected_watch())
    asyncio.create_task(journal_loop())
    if state.bybit_client:
        asyncio.create_task(startup_sync())
    state.log("success", "Backend ready")


@app.on_event("shutdown")
async def shutdown():
    state.log("info", "Trading Bot Backend shutting down...")
    if state.stream:
        await state.stream.stop()

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
        "mode": state.bybit_client.mode if state.bybit_client else None,
        "account": state.active_account,
        "trading_paused": state.trading_paused,
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
        "has_credentials": has_creds,
        "mode": state.bybit_client.mode if has_creds else None
    }


def refresh_active_account() -> None:
    """Nombre y modo de la cuenta activa para /api/status. Nunca lanza: sin cuentas queda en None."""
    try:
        data = state.accounts.load()
        acc = AccountStore.find(data, data.get("active") or "")
        state.active_account = ({"id": acc["id"], "name": acc.get("name"), "mode": "demo" if acc.get("demo") else "live"}
                                if acc else None)
    except Exception as e:
        state.active_account = None
        state.log("error", f"[CUENTAS] No se pudo leer accounts.json: {e}")


def sync_active_account(api_key: str, api_secret: str, demo: bool, validated: Optional[bool], message: Optional[str]) -> None:
    """Claves puestas por /api/credentials (App 10): actualizan la cuenta activa, o crean la "Cuenta principal"."""
    data = state.accounts.load()
    acc = AccountStore.find(data, data.get("active") or "")
    if acc is None:
        acc = next((a for a in data["accounts"] if a.get("api_key") == api_key.strip()), None)
        if acc is None:
            acc = AccountStore.new_account("Cuenta principal", api_key, api_secret, demo)
            data["accounts"].append(acc)
        data["active"] = acc["id"]
    acc.update(api_key=api_key.strip(), api_secret=api_secret.strip(), demo=bool(demo), validated=validated,
               validation_message=message)
    state.accounts.save(data)
    refresh_active_account()


def _begin_account_switch() -> None:
    """
    Marca el cambio de cuenta. Sin awaits entre la revision y la marca: o hay una orden en curso (409) o
    ninguna orden empieza hasta que termine el cambio (execute_trade y manual_trade lo revisan con el candado
    de su moneda tomado). Quien la llama la apaga en un finally.
    """
    if state.account_switching:
        raise HTTPException(status_code=409, detail="ya se esta cambiando la cuenta del bot")
    if any(lock.locked() for lock in state.symbol_locks.values()) or state.risk_lock.locked():
        raise HTTPException(status_code=409, detail="hay una orden ejecutandose: intenta de nuevo en unos segundos")
    state.account_switching = True


@app.post("/api/credentials")
async def set_credentials(req: CredentialsRequest):
    """Set Bybit API credentials (de la cuenta activa)"""
    async with state.accounts_lock:
        _begin_account_switch()
        try:
            result = await apply_credentials(req.api_key, req.api_secret, req.demo)
        finally:
            state.account_switching = False
        try:
            sync_active_account(req.api_key, req.api_secret, req.demo, result.get("validated"), result.get("validation_message"))
        except Exception as e:
            state.log("error", f"[CUENTAS] Claves aplicadas pero no se pudo guardar en accounts.json: {e}")
    return result


async def apply_credentials(api_key: str, api_secret: str, demo: bool) -> Dict[str, Any]:
    """Cambia el cliente de Bybit del bot, guarda credentials.json y valida (lo de siempre de /api/credentials)."""
    req = CredentialsRequest(api_key=api_key, api_secret=api_secret, demo=demo)
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
        await restart_stream()  # el WebSocket privado pasa a la cuenta nueva

        # Save credentials to file
        state.save_credentials(req.api_key, req.api_secret, req.demo)

        mode_str = "Demo Trading (api-demo.bybit.com)" if req.demo else "Real Trading (api.bybit.com)"
        state.log("success", f"[OK] Credentials configured: {mode_str}")

        # Validar con un endpoint PRIVADO de solo lectura (un endpoint publico responde aunque la clave sea mala)
        validated = False
        try:
            check = await state.bybit_client.check_api_key()
            if check.get("valid"):
                validated = True
                if check.get("readOnly"):
                    validation_message = "Clave valida pero de SOLO LECTURA: el bot no podra operar"
                    state.log("warning", validation_message)
                else:
                    validation_message = "Credentials validated successfully"
                    state.log("success", validation_message)
            else:
                validation_message = (f"Bybit rechazo las claves en {mode_str}: {check.get('retMsg')} "
                                      f"(retCode={check.get('retCode')})")
                state.log("error", validation_message)
        except Exception as e:
            validation_message = f"Credentials saved but validation failed: {str(e)}"
            state.log("warning", validation_message)

        if validated:
            asyncio.create_task(startup_sync())

        return {
            "success": True,
            "message": "Credentials saved successfully" if validated else f"Credentials saved, pero: {validation_message}",
            "validated": validated,
            "validation_message": validation_message,
            "mode": "demo" if req.demo else "live",
            "url": state.bybit_client.base_url
        }
    except Exception as e:
        state.log("error", f"Failed to set credentials: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


# ==========================
# Cuentas de Bybit (una activa a la vez)
# ==========================

def _account_or_404(data: Dict[str, Any], account_id: str) -> Dict[str, Any]:
    if not ACCOUNT_ID_RE.match(account_id or ""):
        raise HTTPException(status_code=400, detail="id de cuenta invalido")
    acc = AccountStore.find(data, account_id)
    if acc is None:
        raise HTTPException(status_code=404, detail="cuenta no encontrada")
    return acc


def _load_accounts() -> Dict[str, Any]:
    try:
        return state.accounts.load()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"accounts.json ilegible: {e}")


async def _check_keys(api_key: str, api_secret: str, demo: bool) -> Dict[str, Any]:
    """Valida unas claves con un cliente aparte (endpoint privado de solo lectura). No toca el cliente activo."""
    client = BybitClient(api_key=api_key, api_secret=api_secret, testnet=False, demo=demo)
    try:
        return await client.check_api_key()
    finally:
        try:
            await client.close()
        except Exception:
            pass


@app.get("/api/accounts")
async def list_accounts():
    data = _load_accounts()
    active = data.get("active")
    return {"success": True, "active": active, "accounts": [AccountStore.public(a, active) for a in data["accounts"]]}


@app.post("/api/accounts")
async def add_account(req: AccountAddRequest):
    """Guarda una cuenta nueva (no pasa a ser la activa). Se valida en Bybit y se guarda aunque falle, con el motivo."""
    async with state.accounts_lock:
        data = _load_accounts()
        if any(a.get("api_key") == req.api_key.strip() for a in data["accounts"]):
            raise HTTPException(status_code=409, detail="esa API key ya esta guardada")
        if any((a.get("name") or "").lower() == req.name.strip().lower() for a in data["accounts"]):
            raise HTTPException(status_code=409, detail="ya hay una cuenta con ese nombre")
        acc = AccountStore.new_account(req.name, req.api_key, req.api_secret, req.demo)
        try:
            check = await _check_keys(acc["api_key"], acc["api_secret"], acc["demo"])
            acc["validated"] = bool(check.get("valid"))
            if check.get("valid") and check.get("readOnly"):
                acc["validation_message"] = "Clave valida pero de SOLO LECTURA: el bot no podria operar con ella"
            elif check.get("valid"):
                acc["validation_message"] = "Clave valida"
            else:
                acc["validation_message"] = f"Bybit rechazo la clave: {check.get('retMsg')} (retCode={check.get('retCode')})"
        except Exception as e:
            acc["validated"] = None
            acc["validation_message"] = f"No se pudo validar: {e}"
        data["accounts"].append(acc)
        state.accounts.save(data)
    state.log("info", f"[CUENTAS] Cuenta agregada: {acc['name']} ({'demo' if acc['demo'] else 'REAL'}) - {acc['validation_message']}")
    return {"success": True, "account": AccountStore.public(acc, data.get("active"))}


@app.post("/api/accounts/{account_id}/activate")
async def activate_account(account_id: str):
    """El bot pasa a operar con esta cuenta (alertas y ordenes manuales). Antes se validan sus claves."""
    async with state.accounts_lock:
        data = _load_accounts()
        acc = _account_or_404(data, account_id)
        if data.get("active") == acc["id"] and state.bybit_client is not None:
            return {"success": True, "message": "ya es la cuenta activa", "account": AccountStore.public(acc, acc["id"])}
        _begin_account_switch()
        try:
            try:
                check = await _check_keys(acc["api_key"], acc["api_secret"], acc["demo"])
            except Exception as e:
                raise HTTPException(status_code=503, detail=f"no se pudo validar la cuenta en Bybit: {e}")
            if not check.get("valid"):
                raise HTTPException(status_code=400, detail=f"Bybit rechazo las claves de {acc['name']}: {check.get('retMsg')}")
            if check.get("readOnly"):
                raise HTTPException(status_code=400, detail=f"Las claves de {acc['name']} son de solo lectura: el bot no podria operar")
            result = await apply_credentials(acc["api_key"], acc["api_secret"], acc["demo"])
            acc["validated"] = result.get("validated")
            acc["validation_message"] = result.get("validation_message")
            data["active"] = acc["id"]
            state.accounts.save(data)
            refresh_active_account()
        finally:
            state.account_switching = False
    state.log("success", f"[CUENTAS] Cuenta activa: {acc['name']} ({'demo' if acc['demo'] else 'REAL'})")
    await state.broadcast_event("account_changed", state.active_account)
    return {"success": True, "account": AccountStore.public(acc, acc["id"]), "validated": result.get("validated"),
            "validation_message": result.get("validation_message")}


@app.put("/api/accounts/{account_id}")
async def rename_account(account_id: str, req: AccountRenameRequest):
    async with state.accounts_lock:
        data = _load_accounts()
        acc = _account_or_404(data, account_id)
        if any(a["id"] != acc["id"] and (a.get("name") or "").lower() == req.name.strip().lower() for a in data["accounts"]):
            raise HTTPException(status_code=409, detail="ya hay una cuenta con ese nombre")
        acc["name"] = req.name.strip()
        state.accounts.save(data)
        refresh_active_account()
    return {"success": True, "account": AccountStore.public(acc, data.get("active"))}


@app.delete("/api/accounts/{account_id}")
async def delete_account(account_id: str):
    async with state.accounts_lock:
        data = _load_accounts()
        acc = _account_or_404(data, account_id)
        if data.get("active") == acc["id"]:
            raise HTTPException(status_code=409, detail="no se puede borrar la cuenta activa: activa otra primero")
        data["accounts"] = [a for a in data["accounts"] if a["id"] != acc["id"]]
        state.accounts.save(data)
    state.log("info", f"[CUENTAS] Cuenta borrada: {acc['name']}")
    return {"success": True}


def _num(value) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


@app.get("/api/accounts/{account_id}/summary")
async def account_summary(account_id: str):
    """Saldo y posiciones de una cuenta (solo lectura). La activa usa el cliente del bot; las demas, uno aparte."""
    data = _load_accounts()
    acc = _account_or_404(data, account_id)
    active = data.get("active") == acc["id"] and state.bybit_client is not None
    client = state.bybit_client if active else BybitClient(api_key=acc["api_key"], api_secret=acc["api_secret"],
                                                           testnet=False, demo=acc["demo"])
    try:
        wallet = await client.get_wallet_balance()
        pos = await client._make_request("GET", "/v5/position/list", {"category": "linear", "settleCoin": "USDT"})
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"Bybit no respondio: {e}")
    finally:
        if not active:
            try:
                await client.close()
            except Exception:
                pass
    if wallet.get("retCode") != 0:
        return {"success": False, "error": f"Bybit: {wallet.get('retMsg')} (retCode={wallet.get('retCode')})"}
    w = ((wallet.get("result") or {}).get("list") or [{}])[0]
    positions = []
    if pos.get("retCode") == 0:
        for p in (pos.get("result") or {}).get("list") or []:
            if (_num(p.get("size")) or 0) > 0:
                positions.append({"symbol": p.get("symbol"), "side": p.get("side"), "size": p.get("size"),
                                  "entryPrice": p.get("avgPrice"), "markPrice": p.get("markPrice"),
                                  "unrealisedPnl": p.get("unrealisedPnl"), "leverage": p.get("leverage"),
                                  "stopLoss": p.get("stopLoss"), "takeProfit": p.get("takeProfit")})
    return {"success": True, "account": AccountStore.public(acc, data.get("active")),
            "balance": {"equity": _num(w.get("totalEquity")), "wallet": _num(w.get("totalWalletBalance")),
                        "available": _num(w.get("totalAvailableBalance"))},
            "positions": positions}


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
        state.save_trading_config()

        state.log("success", f"Updated configuration for {symbol}")

        return {"success": True, "config": config}
    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Failed to update config: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))


@app.post("/api/config/leverage")
async def update_leverage(req: LeverageRequest):
    """
    Cambia el apalancamiento de una moneda (13/11/2026, pedido desde la suite). Lo fija ya en Bybit para la cuenta
    activa (compra y venta) y solo si Bybit lo acepta lo guarda en la configuracion, que usan las ordenes siguientes.
    Con una posicion abierta Bybit cambia su margen y su precio de liquidacion, o lo rechaza: entonces no cambia nada.
    Toma el candado de la moneda: no corre a la vez que una orden de ella.
    """
    symbol = _symbol_or_400(req.symbol)
    if symbol not in state.trading_config:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found")
    client = state.bybit_client
    if not client:
        raise HTTPException(status_code=400, detail="Credentials not configured")
    config = state.trading_config[symbol]
    async with state.get_symbol_lock(symbol):
        _same_account(client)
        result = await client.set_leverage(symbol, req.leverage, config.get("category", "linear"))
        if result.get("retCode") != 0:
            state.log("error", f"[CONFIG] Bybit no acepto {req.leverage}x en {symbol}: {result.get('retMsg')}")
            raise HTTPException(status_code=502, detail=f"Bybit no acepto {req.leverage}x en {symbol}: {result.get('retMsg')}")
        before = config.get("leverage")
        config["leverage"] = req.leverage
        state.save_trading_config()
    state.log("success", f"[CONFIG] Apalancamiento de {symbol}: {before}x -> {req.leverage}x, fijado en Bybit")
    return {"success": True, "symbol": symbol, "leverage": req.leverage, "before": before, "config": config}


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
        state.save_trading_config()

        # Add to direction manager with default DISABLED
        state.direction_manager.set_direction(symbol, "DISABLED")

        state.log("success", f"Added new coin: {symbol}")

        return {"success": True, "config": new_config, "auto_precision": req.step_size is None}
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

        state.log("info", f"Syncing precision from Bybit for {symbol}...")
        r = await sync_precision_for(symbol, state.trading_config[symbol])
        if r.get("error"):
            raise HTTPException(
                status_code=400,
                detail=f"Failed to get instrument info from Bybit: {r['error']}"
            )

        state.save_trading_config()

        new_values = r["new_values"]
        state.log("success", f"Synced precision for {symbol}: "
                 f"step={new_values['step_size']}, tick={new_values['tick_size']}, "
                 f"min={new_values['min_qty']}, max={new_values['max_qty']}")

        return {
            "success": True,
            "symbol": symbol,
            "old_values": r["old_values"],
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

        summary = await sync_all_precision_internal()
        results = [
            {"symbol": r["symbol"], "step_size": r["new_values"]["step_size"],
             "tick_size": r["new_values"]["tick_size"], "changed": r["changed"]}
            for r in summary["results"]
        ]
        errors = summary["errors"]

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
    """Get bot settings including execution method and daily risk"""
    state._reset_daily_risk_if_new_day()
    return {
        "success": True,
        "use_integrated_tpsl": state.use_integrated_tpsl,
        "execution_method": "integrated" if state.use_integrated_tpsl else "sequential",
        "description": "Integrated sends Market/Limit + TP/SL in 1 API call. Sequential sends the market order and then sets TP/SL on the position.",
        "daily_risk_limit": state.daily_risk_limit,
        "daily_risk_used": state.daily_risk_used,
        "daily_risk_trades": state.daily_risk_trades,
        "daily_risk_date": state.daily_risk_date,
        "daily_risk_remaining": max(0, state.daily_risk_limit - state.daily_risk_used) if state.daily_risk_limit > 0 else None,
        "allowed_origins": state.allowed_origins,
        "trading_paused": state.trading_paused,
        "taker_fee_rate": float(state.taker_fee_rate)
    }


@app.post("/api/settings/allowed-origins")
async def set_allowed_origin(request: Request):
    """Enable or disable automatic alerts from one application."""
    body = await request.json()
    origin = str(body.get("origin") or "").strip().upper()
    enabled = body.get("enabled")

    if origin not in DEFAULT_ALLOWED_ORIGINS:
        raise HTTPException(status_code=400, detail=f"Unknown alert origin: {origin}")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail="enabled must be true or false")

    state.allowed_origins[origin] = enabled
    state.save_bot_settings()
    state.log("success", f"Alert origin {origin}: {'ALLOWED' if enabled else 'BLOCKED'}")
    return {"success": True, "allowed_origins": state.allowed_origins}


@app.get("/api/settings/trading-paused")
async def get_trading_paused():
    """Estado de la pausa global del trading."""
    return {"success": True, "trading_paused": state.trading_paused}


@app.post("/api/settings/trading-paused")
async def set_trading_paused(request: Request):
    """Pausa o reanuda TODO el trading (alertas automaticas, Process Alert y ordenes manuales)."""
    body = await request.json()
    paused = body.get("paused")
    if not isinstance(paused, bool):
        raise HTTPException(status_code=400, detail="paused must be true or false")
    state.trading_paused = paused
    state.save_bot_settings()
    if paused:
        state.log("warning", "[PAUSA] Trading PAUSADO: no se abriran operaciones nuevas (las abiertas siguen con su TP/SL)")
    else:
        state.log("success", "[PAUSA] Trading reanudado")
    await state.broadcast_event("trading_paused", {"paused": paused})
    return {"success": True, "trading_paused": state.trading_paused}


@app.post("/api/settings/execution-method")
async def set_execution_method(use_integrated: bool):
    """
    Set the execution method for orders.

    - use_integrated=False (default): orden a mercado y luego TP/SL de posicion (trading-stop)
    - use_integrated=True: 1 API call with integrated TP/SL

    In both methods the bot checks the position has a Stop Loss and closes it if it cannot set one.
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


@app.post("/api/settings/daily-risk-limit")
async def set_daily_risk_limit(request: Request):
    """Set the maximum daily risk amount in USDT. 0 = no limit."""
    try:
        body = await request.json()
        limit = float(body.get("daily_risk_limit", 0))
        old_limit = state.daily_risk_limit
        state.daily_risk_limit = max(0.0, limit)
        state.save_bot_settings()
        if state.daily_risk_limit > 0:
            state.log("success", f"[RISK] Daily risk limit set: ${state.daily_risk_limit:.2f} (was ${old_limit:.2f})")
        else:
            state.log("info", "[RISK] Daily risk limit disabled")
        return {
            "success": True,
            "daily_risk_limit": state.daily_risk_limit,
            "daily_risk_used": state.daily_risk_used,
            "daily_risk_trades": state.daily_risk_trades
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/settings/daily-risk-reset")
async def reset_daily_risk():
    """Manually reset daily risk counters"""
    async with state.risk_lock:
        old_used = state.daily_risk_used
        old_trades = state.daily_risk_trades
        state.daily_risk_used = 0.0
        state.daily_risk_trades = 0
        state.daily_risk_date = date.today().isoformat()
        state.save_bot_settings()
    state.log("info", f"[RISK] Daily risk counters reset manually (was ${old_used:.2f}, {old_trades} trades)")
    return {
        "success": True,
        "daily_risk_used": 0.0,
        "daily_risk_trades": 0,
        "message": "Daily risk counters reset"
    }


@app.post("/api/config/update-risk-all")
async def update_risk_amount_all(request: Request):
    """Update risk_amount for ALL configured symbols at once"""
    try:
        body = await request.json()
        risk_amount = float(body.get("risk_amount", 0))
        if risk_amount <= 0:
            raise HTTPException(status_code=400, detail="Risk amount must be > 0")
        updated = []
        for symbol, config in state.trading_config.items():
            config["risk_amount"] = risk_amount
            updated.append(symbol)
        # Save to file
        state.save_trading_config()
        state.log("success", f"[RISK] Risk amount set to ${risk_amount:.2f} for {len(updated)} symbols")
        return {
            "success": True,
            "risk_amount": risk_amount,
            "updated_symbols": updated,
            "count": len(updated)
        }
    except HTTPException:
        raise
    except Exception as e:
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


# ==========================
# Ejecucion comun de alertas
# ==========================

def _alert_identity(origin: str, source: str, symbol: str, side: str, pattern_type: str,
                    request: Dict[str, Any]):
    """Clave de una senal para no ejecutarla dos veces."""
    pattern = request.get("pattern") if isinstance(request.get("pattern"), dict) else {}
    ts = pattern.get("timestamp") or request.get("timestamp")
    if ts:
        return f"{origin}|{source}|{symbol}|{side}|{pattern_type}|{ts}", DEDUP_TTL_S
    price = pattern.get("price", request.get("price"))
    parts = [origin, source, symbol, side, pattern_type, price, request.get("order_type"), request.get("limit_price"),
             request.get("custom_stop_loss"), request.get("sl_distance")]
    return "|".join(str(p) for p in parts), DEDUP_TTL_NO_TS_S


def _seen_recently(key: str, ttl: float) -> bool:
    now = time.time()
    for k, expires in list(state.recent_alerts.items()):
        if expires < now:
            del state.recent_alerts[k]
    if key in state.recent_alerts:
        return True
    state.recent_alerts[key] = now + ttl
    return False


def _order_ids(result: Dict[str, Any]):
    """orderId y orderLinkId de la orden de entrada en Bybit (integrada o a mercado), si se enviaron."""
    order = result.get("integrated_order") or result.get("market_order") or {}
    body = order.get("result") if isinstance(order.get("result"), dict) else {}
    return (body.get("orderId") or order.get("orderId") or None,
            body.get("orderLinkId") or order.get("orderLinkId") or None)


def _history_entry(symbol: str, side: str, result: Dict[str, Any], quantity: Decimal, ref_price: Decimal,
                   sl_mode: str, pattern: str, confidence, source: str, origin: str, order_type: str) -> Dict[str, Any]:
    """Lo que de verdad quedo en Bybit: precio de llenado (o limite), SL y TP como precios, estado real.
    Con la orden de Bybit (order_id): el journal reconoce la apertura aunque una Limit se llene horas despues."""
    entry = _to_float(result.get("entry_price")) or float(ref_price)
    qty = _to_float(result.get("qty")) or float(quantity)
    order_id, order_link_id = _order_ids(result)
    return {
        "order_id": order_id,
        "order_link_id": order_link_id,
        "symbol": symbol,
        "side": side,
        "entry_price": entry,
        "quantity_coin": qty,
        "quantity_usdt": qty * entry,
        "stop_loss": _to_float(result.get("stop_loss")) or 0,
        "take_profit": _to_float(result.get("take_profit")) or 0,
        "sl_mode": sl_mode,
        "pattern": pattern,
        "confidence": confidence,
        "source": source,
        "origin": origin,
        "order_type": order_type,
        "method": result.get("method"),
        "status": result.get("status", "failed"),
        "error": result.get("error"),
    }


async def execute_trade(*, symbol: str, side: str, price: Decimal, source: str, origin: str, pattern: str,
                        confidence, extras: Dict[str, Any], automatic: bool) -> Dict[str, Any]:
    """
    Comun a /api/watchlist-alert y /api/alert: pausa, direccion, posicion, ordenes pendientes,
    tamano con el precio real, reserva del riesgo diario, ejecucion e historial.
    Devuelve el cuerpo de la respuesta. Lanza HTTPException en errores de validacion.
    """
    def reject(code: str, message: str, level: str = "warning", **extra) -> Dict[str, Any]:
        log_received_alert(symbol, side, pattern, float(price), confidence, code, source, origin)
        state.log(level, f"[{code}] [{origin}] {symbol} {side}: {message}")
        return {"success": False, "message": message, "symbol": symbol, "side": side, "reason": code, **extra}

    if state.trading_paused:
        return reject("REJECTED_PAUSED", "Bot en pausa: no se abren operaciones", skipped=True)

    # Check direction filter
    if not state.direction_manager.is_alert_allowed(symbol, side):
        return reject("REJECTED_DIRECTION",
                      f"Direction filter rejected: {symbol} is set to {state.direction_manager.get_direction(symbol)}")

    # Get coin config (copia: nada de esta alerta queda para la siguiente)
    config = state.get_coin_config(symbol)
    if not config:
        state.log("error", f"No configuration found for {symbol}")
        log_received_alert(symbol, side, pattern, float(price), confidence, "NO_CONFIG", source, origin)
        raise HTTPException(status_code=404, detail=f"No configuration for {symbol}")

    client = state.bybit_client
    lock = state.get_symbol_lock(symbol)
    async with lock:
        # La cuenta cambio (o esta cambiando) desde que llego la alerta: nunca mezclar dos cuentas en una orden
        if state.account_switching or client is not state.bybit_client:
            return reject("REJECTED_ACCOUNT_SWITCH", "La cuenta del bot esta cambiando: alerta descartada")
        state.log("info", f"Acquired lock for {symbol}, processing {source} alert...")

        # Posicion del MISMO lado (en hedge se permite LONG + SHORT)
        position = await client.get_position(symbol, side_filter=side)
        if not position.get("success"):
            error_msg = f"Failed to check position: {position.get('error', 'Unknown')}"
            state.log("error", error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        if position.get("hasPosition"):
            return reject("SKIPPED_POSITION_EXISTS",
                          f"Position already exists for {symbol} {side}: size={position.get('size')} "
                          f"entry=${position.get('entryPrice')} SL={position.get('stopLoss')} TP={position.get('takeProfit')}",
                          skipped=True)

        # Ordenes de entrada pendientes (un Limit sin llenar no es una posicion)
        open_orders = await client.get_open_orders(symbol)
        if open_orders is None:
            error_msg = f"Failed to check open orders for {symbol}"
            state.log("error", error_msg)
            raise HTTPException(status_code=500, detail=error_msg)
        hedge = client._position_mode == "hedge"
        pending = [o for o in open_orders if client.is_entry_order(o) and (not hedge or o.get("side") == side)]
        if pending:
            desc = ", ".join(f"{o.get('side')} {o.get('orderType')} {o.get('qty')} @ {o.get('price') or o.get('triggerPrice')}" for o in pending[:3])
            return reject("SKIPPED_PENDING_ORDER", f"Ya hay orden(es) de entrada pendiente(s) en {symbol}: {desc}", skipped=True)

        order_type = str(extras.get("order_type") or "Market")
        is_limit = order_type.upper() == "LIMIT"
        limit_price = Decimal(str(extras["limit_price"])) if _positive(extras.get("limit_price")) else None
        if is_limit and not limit_price:
            raise HTTPException(status_code=400, detail="limit_price required for Limit orders")

        # Precio de referencia para el tamano: el real de Bybit a mercado; el limite en Limit
        last_price = await client.get_last_price(symbol)
        if is_limit:
            ref_price = limit_price
            if automatic and last_price and ((side == "Buy" and limit_price >= last_price) or
                                             (side == "Sell" and limit_price <= last_price)):
                return reject("REJECTED_LIMIT_MARKETABLE",
                              f"Limit {side} a {limit_price} ya cruza el mercado ({last_price}): se llenaria al instante")
        else:
            ref_price = last_price or price
            if not last_price:
                state.log("warning", f"[RISK] {symbol}: sin precio de Bybit, se dimensiona con el de la alerta ({price})")

        sl_distance = extras.get("sl_distance")
        tp_distance = extras.get("tp_distance")
        custom_sl = extras.get("custom_stop_loss")
        custom_tp = extras.get("custom_take_profit")

        trade_config = dict(config)
        effective_sl_percent = Decimal(str(config["stop_loss_percent"]))
        sl_source_label = "config default"
        sl_mode = "percent"

        if _positive(sl_distance):
            pct = Decimal(str(sl_distance)) / ref_price
            if pct > MIN_SL_PERCENT:
                effective_sl_percent = pct
                sl_source_label = f"alert sl_distance ({float(pct)*100:.3f}%)"
                sl_mode = "distance"
                trade_config["sl_distance"] = float(sl_distance)
                if _positive(tp_distance):
                    trade_config["tp_distance"] = float(tp_distance)
            else:
                state.log("warning", f"[RISK] Alert SL% too small ({float(pct)*100:.4f}%): se usan SL y TP de la configuracion")
        elif _positive(custom_sl):
            csl = Decimal(str(custom_sl))
            dist = (ref_price - csl) if side == "Buy" else (csl - ref_price)
            if dist <= 0:
                return reject("REJECTED_SL_CROSSED", f"El SL de la alerta ({csl}) ya quedo del otro lado del precio ({ref_price})")
            planned = abs(price - csl)
            if not is_limit and planned > 0 and dist / planned > MAX_SL_STRETCH:
                return reject("REJECTED_SL_STRETCHED",
                              f"El precio se alejo de la alerta: el SL quedaria a {dist} (la alerta planeo {planned}, x{float(dist / planned):.2f})")
            pct = dist / ref_price
            if pct > MIN_SL_PERCENT:
                effective_sl_percent = pct
                sl_source_label = f"alert custom_sl ({float(pct)*100:.3f}% desde {ref_price})"
                sl_mode = "custom"
                trade_config["custom_stop_loss"] = float(csl)
                if _positive(custom_tp):
                    trade_config["custom_take_profit"] = float(custom_tp)
            else:
                state.log("warning", f"[RISK] Alert SL% too small ({float(pct)*100:.4f}%): se usan SL y TP de la configuracion")
        else:
            if _positive(tp_distance):
                trade_config["tp_distance"] = float(tp_distance)
            elif _positive(custom_tp):
                trade_config["custom_take_profit"] = float(custom_tp)

        risk_amount = Decimal(str(config["risk_amount"]))
        state.log("info", f"[RISK] Calculating qty: risk_amount=${risk_amount} "
                  f"sl%={float(effective_sl_percent)*100:.3f}% ({sl_source_label}) price={ref_price} "
                  f"fee={float(state.taker_fee_rate)*100:.3f}%x2 step_size={config['step_size']} "
                  f"min_qty={config['min_qty']} max_qty={config['max_qty']}")
        risk_calc = state.risk_calculator.calculate_quantity(
            risk_amount=risk_amount,
            stop_loss_percent=effective_sl_percent,
            current_price=ref_price,
            min_qty=Decimal(str(config["min_qty"])),
            max_qty=Decimal(str(config["max_qty"])),
            step_size=Decimal(str(config["step_size"])),
            fee_rate=state.taker_fee_rate
        )
        if not risk_calc.get("success"):
            error_msg = risk_calc.get("error", "Risk calculation failed")
            log_received_alert(symbol, side, pattern, float(price), confidence, "REJECTED_SIZE", source, origin)
            state.log("error", error_msg)
            raise HTTPException(status_code=400, detail=error_msg)

        quantity = risk_calc["quantity"]
        planned_risk = float(risk_calc["planned_risk"])
        state.log("info", f"[RISK] Result: qty={quantity} (value ~${float(quantity * ref_price):.2f} USDT, "
                  f"riesgo al SL con comisiones ~${planned_risk:.2f})")

        # Reserva del riesgo diario antes de enviar nada
        reservation = await state.reserve_daily_risk(planned_risk)
        if not reservation["allowed"]:
            msg = (f"Daily risk limit reached: ${reservation['used']:.2f} / ${reservation['limit']:.2f} "
                   f"({reservation['trades_today']} trades). Requested: ${float(reservation['requested']):.2f}")
            await state.broadcast_event("daily_limit_reached", {
                "symbol": symbol, "side": side, "limit": reservation["limit"],
                "used": reservation["used"], "trades": reservation["trades_today"]
            })
            return reject("BLOCKED_DAILY_LIMIT", msg, blocked_by="daily_risk_limit")

        trade_config["current_price"] = float(ref_price)
        use_integrated = state.use_integrated_tpsl or is_limit
        execution_method = "integrated" if use_integrated else "sequential"
        if is_limit and not state.use_integrated_tpsl:
            state.log("info", f"[TRADE] Limit order detected - forcing integrated method")
        state.log("info", f"[TRADE] Executing {'LIMIT ' if is_limit else ''}trade ({execution_method}): {side} {symbol} qty={quantity} @ {ref_price}")

        try:
            if use_integrated:
                result = await state.order_manager.execute_integrated_sequence(
                    symbol=symbol, side=side, quantity=quantity, config=trade_config,
                    order_type="Limit" if is_limit else "Market", limit_price=limit_price)
            else:
                result = await state.order_manager.execute_complete_sequence(
                    symbol=symbol, side=side, quantity=quantity, config=trade_config)
        except Exception:
            await state.release_daily_risk(planned_risk)
            raise

        status = result.get("status", "failed")
        if status == "failed":
            await state.release_daily_risk(planned_risk)  # nada quedo en Bybit

        await state.broadcast_event("trade_executed", result)

        timing = result.get("timing", {})
        state.log("info", f"[BYBIT] Order result: status={status} method={result.get('method', '?')} "
                  f"timing={timing.get('total_ms', 0):.0f}ms")

        code = STATUS_LOG.get(status, "FAILED")
        log_received_alert(symbol, side, pattern, float(price), confidence, code, source, origin)
        if status == "success":
            state.log("success", f"[SUCCESS] [{origin}] {symbol}: {side} qty={result.get('qty')} @ {result.get('entry_price')} "
                      f"| SL={result.get('stop_loss')} TP={result.get('take_profit')} | Pattern: {pattern}")
        elif status == "pending":
            state.log("success", f"[PENDING] [{origin}] {symbol}: Limit {side} qty={result.get('qty')} @ {result.get('entry_price')} "
                      f"| SL={result.get('stop_loss')} TP={result.get('take_profit')} (esperando llenado)")
        elif status == "failed":
            state.log("error", f"[FAILED] [{origin}] {symbol}: Trade failed - {result.get('error', 'Unknown error')}")
        else:
            state.log("error", f"[{code}] [{origin}] {symbol}: {result.get('error', '')}")

        if status != "failed":
            state.add_order_to_history(_history_entry(symbol, side, result, quantity, ref_price, sl_mode, pattern,
                                                      confidence, source, origin, "Limit" if is_limit else "Market"))

        state.log("info", f"[LOCK] Released lock for {symbol}")

        return {
            "success": result.get("success", False),
            "status": status,
            "symbol": symbol,
            "side": side,
            "price": float(price),
            "quantity": float(quantity),
            "pattern": pattern,
            "confidence": confidence,
            "source": source,
            "origin": origin,
            "result": result,
            "partial": status in ("closed_unprotected", "unprotected", "unknown"),
            "message": result.get("error") if status not in ("success", "pending") else f"{status}: {side} {symbol}"
        }


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

        # Process all alerts in parallel (cada simbolo con su candado; el riesgo diario con uno global)
        async def process_single_alert(raw_alert_text):
            alert = None
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

                symbol = alert["symbol"].upper()
                res = await execute_trade(
                    symbol=symbol, side=alert["side"], price=Decimal(str(alert["price"])),
                    source="ATAS", origin="MANUAL", pattern=f"ATAS {alert['side']}", confidence=None,
                    extras={}, automatic=False)
                out = {
                    "success": res.get("success", False),
                    "alert": alert,
                    "quantity": res.get("quantity"),
                    "result": res.get("result"),
                    "partial": res.get("partial", False),
                    "status": res.get("status"),
                }
                if not res.get("success"):
                    out["message"] = res.get("message")
                return out

            except HTTPException as e:
                return {"success": False, "alert": alert, "raw": raw_alert_text, "error": e.detail}
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
        partial = [r for r in results if r.get("partial")]
        failed = [r for r in results if not r.get("success")]

        summary_msg = f"Processed {len(results)} alerts: {len(successful)} successful"
        if partial:
            summary_msg += f" ({len(partial)} sin SL o con resultado desconocido: revisa Bybit)"
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
                alert_info = r.get("alert") or {}
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


def reject_alert_by_origin(request: Dict[str, Any], origin: str) -> JSONResponse:
    """Record an alert blocked by the origin filter and build its 403 response."""
    label = origin or "NONE"
    source = request.get("source", "WATCHLIST")
    symbol = request.get("symbol", "UNKNOWN")
    pattern_data = request.get("pattern")
    details = pattern_data if isinstance(pattern_data, dict) else request

    pattern = details.get("patternType") if isinstance(pattern_data, dict) else pattern_data
    side = details.get("direction") or "N/A"
    try:
        price = float(details.get("price") or 0)
        confidence = float(details.get("confidence") or 0)
    except (TypeError, ValueError):
        price = 0.0
        confidence = 0.0

    log_received_alert(symbol, side, str(pattern or "UNKNOWN"), price, confidence, f"BLOCKED_ORIGIN:{label}", source, label)

    state.log("warning", f"Alert blocked by origin filter: origin={label} source={source} symbol={symbol}")

    return JSONResponse(
        status_code=403,
        content={"success": False, "message": f"Alert origin not allowed: {label}", "symbol": symbol}
    )


@app.post("/api/watchlist-alert")
async def process_watchlist_alert(request: Dict[str, Any]):
    """
    Process alert from Watchlist or SwingDetector in JSON format
    Supports both formats:
    - Watchlist: {pattern, symbol, price, confidence}
    - SwingDetector: {source, symbol, interval, pattern: {patternType, price, direction, ...}}
    Every alert must declare an allowed "origin" application.
    Opcional: "sent_at" (ms) para descartar alertas que llegan tarde.
    """
    origin = str(request.get("origin") or "").strip().upper()
    if not state.allowed_origins.get(origin, False):
        return reject_alert_by_origin(request, origin)

    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        # Detect source and parse accordingly
        source = request.get("source", "WATCHLIST")
        is_swing_detector = source == "SWING_DETECTOR"
        is_zone_detector = source in ("ZONE_DETECTOR", "ZONE_DETECTOR_V2")

        if is_swing_detector or is_zone_detector:
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
                pattern_type = pattern
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

        # Guard: rechazar alertas con precio <= 0 (alertas fantasma o mal formadas)
        if price <= 0:
            state.log("warning", f"Alert rejected: {symbol} {side} price={price} (invalid price <= 0)")
            log_received_alert(symbol, side, pattern, float(price), confidence, "REJECTED_INVALID_PRICE", source, origin)
            return {
                "success": False,
                "message": f"Invalid price: {price} (must be > 0)",
                "symbol": symbol
            }

        # Alertas que llegan tarde (cola del emisor, reintentos, bot ocupado)
        sent_at = request.get("sent_at")
        if _positive(sent_at):
            age_s = time.time() - float(sent_at) / 1000.0
            if age_s > ALERT_MAX_AGE_S:
                log_received_alert(symbol, side, pattern, float(price), confidence, "REJECTED_STALE", source, origin)
                state.log("warning", f"[REJECTED_STALE] [{origin}] {symbol} {side}: la alerta llego {age_s:.0f}s tarde")
                return {"success": False, "message": f"Alerta vieja: enviada hace {age_s:.0f}s", "symbol": symbol,
                        "reason": "REJECTED_STALE"}

        # Misma senal dos veces (reenvio, doble clic, dos emisores)
        key, ttl = _alert_identity(origin, source, symbol, side, str(pattern_type), request)
        if _seen_recently(key, ttl):
            log_received_alert(symbol, side, pattern, float(price), confidence, "REJECTED_DUPLICATE", source, origin)
            state.log("warning", f"[REJECTED_DUPLICATE] [{origin}] {symbol} {side}: senal ya recibida")
            return {"success": False, "message": "Alerta repetida: ya se proceso esta senal", "symbol": symbol,
                    "reason": "REJECTED_DUPLICATE", "skipped": True}

        # Log with explicit timestamp for debugging alert timing
        received_at = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        state.log("info", f"[{received_at}] [{origin}] {source} alert: {symbol} {side} @ {price} | {pattern} | Conf: {confidence}%")

        extras = {k: request.get(k) for k in ("sl_distance", "tp_distance", "custom_stop_loss", "custom_take_profit",
                                             "order_type", "limit_price")}
        return await execute_trade(symbol=symbol, side=side, price=price, source=source, origin=origin,
                                   pattern=pattern, confidence=confidence, extras=extras, automatic=True)

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
        if state.trading_paused:
            raise HTTPException(status_code=423, detail="Bot en pausa: reanudalo para abrir operaciones")

        symbol = req.symbol.upper()
        side_map = {"buy": "Buy", "long": "Buy", "sell": "Sell", "short": "Sell"}
        side = side_map.get(str(req.side).strip().lower())
        if not side:
            raise HTTPException(status_code=400, detail=f"Invalid side: {req.side} (use Buy or Sell)")

        # Get config (copia)
        config = state.get_coin_config(symbol)
        if not config:
            raise HTTPException(status_code=404, detail=f"No configuration for {symbol}")

        # Check direction
        if not state.direction_manager.is_alert_allowed(symbol, side):
            raise HTTPException(status_code=403, detail="Direction not allowed")

        stop_loss_value = req.custom_stop_loss or req.stopLoss
        take_profit_value = req.custom_take_profit or req.takeProfit
        given_price = req.current_price or req.currentPrice or req.price

        # Determine order type and limit price
        order_type = (req.order_type or "Market").capitalize()
        is_limit = order_type == "Limit"
        limit_price = None
        if is_limit:
            # For limit orders, use limit_price if provided, otherwise use current_price
            limit_price = req.limit_price if req.limit_price else given_price
            if not limit_price:
                raise HTTPException(status_code=400, detail="limit_price required for Limit orders")

        client = state.bybit_client
        lock = state.get_symbol_lock(symbol)
        async with lock:
            # La cuenta cambio (o esta cambiando) mientras la orden esperaba: no se envia por otra cuenta
            if state.account_switching or client is not state.bybit_client:
                raise HTTPException(status_code=409, detail="La cuenta del bot esta cambiando: la orden no se envio, intentala de nuevo")
            # En one-way una orden contraria reduciria o daria vuelta la posicion abierta
            pos = await client.get_position(symbol)
            if not pos.get("success"):
                raise HTTPException(status_code=500, detail=f"Failed to check position: {pos.get('error')}")
            if client._position_mode != "hedge":
                for p in pos.get("positions", []):
                    if p.get("side") and p.get("side") != side:
                        raise HTTPException(status_code=409, detail=(
                            f"Hay una posicion {p.get('side')} abierta en {symbol} (cuenta en modo one-way): "
                            f"una orden {side} la reduciria. Cierrala primero."))

            last_price = await client.get_last_price(symbol)
            if is_limit:
                ref_price = Decimal(str(limit_price))
            elif last_price:
                ref_price = last_price
            elif given_price:
                ref_price = Decimal(str(given_price))
            elif stop_loss_value and take_profit_value:
                ref_price = (Decimal(str(stop_loss_value)) + Decimal(str(take_profit_value))) / 2
            else:
                raise HTTPException(status_code=400, detail="Either current_price or stopLoss/takeProfit required")

            trade_config = dict(config)
            trade_config["current_price"] = float(ref_price)
            if stop_loss_value:
                trade_config["custom_stop_loss"] = float(stop_loss_value)
            if take_profit_value:
                trade_config["custom_take_profit"] = float(take_profit_value)

            # Calculate or use provided quantity
            if req.quantity is None:
                if stop_loss_value:
                    sl_percent = abs(Decimal(str(stop_loss_value)) - ref_price) / ref_price
                else:
                    sl_percent = Decimal(str(config["stop_loss_percent"]))

                risk_calc = state.risk_calculator.calculate_quantity(
                    risk_amount=Decimal(str(config["risk_amount"])),
                    stop_loss_percent=sl_percent,
                    current_price=ref_price,
                    min_qty=Decimal(str(config["min_qty"])),
                    max_qty=Decimal(str(config["max_qty"])),
                    step_size=Decimal(str(config["step_size"])),
                    fee_rate=state.taker_fee_rate
                )

                if not risk_calc.get("success"):
                    raise HTTPException(status_code=400, detail=risk_calc.get("error"))

                quantity = risk_calc["quantity"]
            else:
                quantity = req.quantity

            # Riesgo planeado de lo que de verdad se enviara (cantidad al paso real y SL al tick)
            om = state.order_manager
            prec = await om.precision_for(symbol, config)
            qty, _, err = om.prepare_quantity(quantity, prec)
            if err:
                raise HTTPException(status_code=400, detail=err)
            try:
                sl_price, _, _, _ = om.compute_sl_tp(ref_price, side, trade_config, prec["tick_size"])
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            planned_risk = float(state.risk_calculator.risk_for(qty, ref_price, sl_price, state.taker_fee_rate))

            reservation = await state.reserve_daily_risk(planned_risk)
            if not reservation["allowed"]:
                await state.broadcast_event("daily_limit_reached", {
                    "symbol": symbol, "side": side, "limit": reservation["limit"],
                    "used": reservation["used"], "trades": reservation["trades_today"]
                })
                raise HTTPException(status_code=403, detail=(
                    f"Daily risk limit reached: ${reservation['used']:.2f} / ${reservation['limit']:.2f}. "
                    f"Esta orden arriesgaria ${planned_risk:.2f}"))

            state.log("info", f"[MANUAL TRADE] {order_type.upper()}: {symbol} {side} qty={qty} | Entry=${ref_price} "
                      f"SL=${stop_loss_value or 'config'} TP=${take_profit_value or 'config'} | riesgo ~${planned_risk:.2f}")

            # Execute using integrated method (supports both Market and Limit)
            use_integrated = state.use_integrated_tpsl or is_limit
            try:
                if use_integrated:
                    result = await om.execute_integrated_sequence(
                        symbol=symbol,
                        side=side,
                        quantity=qty,
                        config=trade_config,
                        order_type=order_type,
                        limit_price=Decimal(str(limit_price)) if limit_price else None
                    )
                else:
                    result = await om.execute_complete_sequence(
                        symbol=symbol,
                        side=side,
                        quantity=qty,
                        config=trade_config
                    )
            except Exception:
                await state.release_daily_risk(planned_risk)
                raise

            status = result.get("status", "failed")
            if status == "failed":
                await state.release_daily_risk(planned_risk)

        await state.broadcast_event("trade_executed", result)

        if status != "failed":
            state.add_order_to_history(_history_entry(
                symbol, side, result, qty, ref_price, "custom" if stop_loss_value else "default",
                f"MANUAL_{order_type.upper()}", 100, "MANUAL_TRADE", "MANUAL", order_type))

        if result.get("success"):
            state.log("success", f"[MANUAL TRADE] ✅ {order_type.upper()} {status}: {symbol} {side} qty={result.get('qty')} "
                      f"| Entry=${result.get('entry_price')} TP=${result.get('take_profit')} SL=${result.get('stop_loss')}")
        else:
            state.log("error", f"[MANUAL TRADE] {symbol} {side}: {status} - {result.get('error')}")

        order_id, order_link_id = _order_ids(result)
        return {
            "success": result.get("success", False),
            "status": status,
            "result": result,
            # La orden de Bybit: la suite une con ella la decision del journal y el trade que abra (12/11/2026)
            "order_id": order_id,
            "order_link_id": order_link_id,
            "message": f"{status}: {side} {symbol} qty={result.get('qty')}" if result.get("success") else result.get("error")
        }

    except HTTPException:
        raise
    except Exception as e:
        state.log("error", f"Manual trade error: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/position/{symbol}")
async def get_position(symbol: str, side: str = None):
    """Get current position for a symbol. In hedge mode, use ?side=Buy or ?side=Sell.
    'positions' trae todas las posiciones abiertas del simbolo (ambos lados en hedge)."""
    try:
        if not state.bybit_client:
            raise HTTPException(status_code=400, detail="Credentials not configured")

        position = await state.bybit_client.get_position(symbol.upper(), side_filter=side)
        return position
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/logs")
async def get_logs(limit: int = 100):
    """Get recent logs"""
    return {
        "success": True,
        "logs": state.logs[-limit:] if limit > 0 else state.logs
    }


@app.get("/api/alerts/critical")
async def get_critical_alerts(limit: int = 20):
    """Avisos criticos recientes (SL no colocado, orden con resultado desconocido...)."""
    return {"success": True, "alerts": state.critical_alerts[-limit:] if limit > 0 else state.critical_alerts}


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
async def get_all_positions(all_symbols: bool = Query(False, alias="all")):
    """
    Posiciones abiertas de la cuenta activa (las usan el Trading Journal y la suite). Ambos lados en hedge.
    Del WebSocket privado si esta al dia; si no, una foto por REST: dos llamadas a Bybit, no una por moneda.
    Por defecto solo las monedas configuradas en el bot, como antes; ?all=true trae todas las de USDT.
    """
    if not state.bybit_client:
        return {"success": False, "error": "Credentials not configured", "positions": []}
    try:
        book, source = await live_book()
    except HTTPException as e:
        return {"success": False, "error": e.detail, "positions": []}
    except Exception as e:
        state.log("error", f"Error getting all positions: {str(e)}")
        return {"success": False, "error": str(e), "positions": []}
    positions = [p for p in book.position_list() if all_symbols or p["symbol"] in state.trading_config]
    return {"success": True, "positions": positions, "count": len(positions), "source": source,
            "account": state.active_account, "timestamp": datetime.now().isoformat()}


# ==========================
# Posiciones y ordenes desde la suite (paso 4 de la integracion, 12/11/2026)
# ==========================

_SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")


class PositionCloseRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    side: str = Field(description="Lado de la POSICION: Buy (long) o Sell (short)")


class TradingStopRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    side: str
    stop_loss: Optional[Decimal] = None
    take_profit: Optional[Decimal] = None  # 0 = quitar el TP


class CancelOrderRequest(BaseModel):
    symbol: str = Field(min_length=2, max_length=20)
    order_id: str = Field(min_length=1, max_length=64)


def _symbol_or_400(value: Optional[str]) -> str:
    symbol = (value or "").upper()
    if not _SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail="simbolo invalido")
    return symbol


def _position_side(value: str) -> str:
    side = {"buy": "Buy", "long": "Buy", "sell": "Sell", "short": "Sell"}.get(str(value or "").strip().lower())
    if not side:
        raise HTTPException(status_code=400, detail="side debe ser Buy (long) o Sell (short)")
    return side


def _same_account(client) -> None:
    """Con el candado de la moneda tomado: si la cuenta cambio o esta cambiando, nada sale a Bybit."""
    if state.account_switching or client is not state.bybit_client:
        raise HTTPException(status_code=409, detail="La cuenta del bot esta cambiando: intentalo de nuevo")


@app.get("/api/orders/open")
async def get_open_orders_route(symbol: Optional[str] = None):
    """Ordenes abiertas de la cuenta activa. `entry` dice si abre o aumenta posicion (no es TP/SL ni reduce-only)."""
    if not state.bybit_client:
        return {"success": False, "error": "Credentials not configured", "orders": []}
    sym = _symbol_or_400(symbol) if symbol else None
    book, source = await live_book()
    orders = book.order_list(sym)
    return {"success": True, "orders": orders, "count": len(orders), "source": source}


@app.get("/api/executions/recent")
async def recent_executions(limit: int = 100, symbol: Optional[str] = None):
    """Ejecuciones recibidas por el WebSocket privado desde que arranco (las ultimas 500), mas viejas primero."""
    stream = state.stream
    rows = list(stream.executions) if stream else []
    if symbol:
        sym = _symbol_or_400(symbol)
        rows = [r for r in rows if r.get("symbol") == sym]
    return {"success": True, "executions": rows[-max(1, min(limit, 500)):], "streaming": bool(stream and stream.connected)}


@app.get("/api/stream/status")
async def stream_status():
    """Estado del WebSocket privado de la cuenta activa (sin claves)."""
    if not state.stream:
        return {"success": True, "enabled": private_stream_enabled(), "running": False}
    return {"success": True, "enabled": True, "running": True, **state.stream.status()}


@app.post("/api/position/close")
async def close_position_route(req: PositionCloseRequest):
    """Cierra a mercado (reduce-only) la posicion de ese lado. Funciona tambien con el bot en pausa: reduce riesgo."""
    symbol, side = _symbol_or_400(req.symbol), _position_side(req.side)
    client = state.bybit_client
    if not client or not state.order_manager:
        raise HTTPException(status_code=400, detail="Credentials not configured")
    async with state.get_symbol_lock(symbol):
        _same_account(client)
        result = await state.order_manager.close_position(symbol, side)
    if result.get("closed") and result.get("note"):
        raise HTTPException(status_code=404, detail=f"No hay posicion {side} abierta en {symbol}")
    if not result.get("closed"):
        state.log("error", f"[POSICION] No se pudo cerrar {symbol} {side}: {result.get('error')}")
        raise HTTPException(status_code=502, detail=(
            f"Bybit no confirmo el cierre: {result.get('error')}. Revisa la posicion en Bybit antes de reintentar"))
    order_id = ((result.get("order") or {}).get("result") or {}).get("orderId")
    state.log("success", f"[POSICION] {symbol} {side} cerrada a mercado a pedido (orden {order_id})")
    await state.broadcast_event("position_closed", {"symbol": symbol, "side": side, "orderId": order_id, "source": "manual"})
    if state.stream:
        asyncio.create_task(state.stream.snapshot())
    return {"success": True, "symbol": symbol, "side": side, "orderId": order_id}


@app.post("/api/position/trading-stop")
async def position_trading_stop(req: TradingStopRequest):
    """
    Mueve el SL o el TP de toda la posicion. El SL nunca se quita, solo se mueve; el TP se quita con 0.
    El SL de un long va bajo el precio actual y el TP encima (al reves en un short). El SL se lleva al tick hacia
    el precio, para no aumentar el riesgo.
    """
    symbol, side = _symbol_or_400(req.symbol), _position_side(req.side)
    if req.stop_loss is None and req.take_profit is None:
        raise HTTPException(status_code=400, detail="falta stop_loss o take_profit")
    if req.stop_loss is not None and req.stop_loss <= 0:
        raise HTTPException(status_code=400, detail="El stop loss no se quita: solo se mueve")
    if req.take_profit is not None and req.take_profit < 0:
        raise HTTPException(status_code=400, detail="take_profit invalido")
    client = state.bybit_client
    if not client:
        raise HTTPException(status_code=400, detail="Credentials not configured")
    long = side == "Buy"
    async with state.get_symbol_lock(symbol):
        _same_account(client)
        pos = await client.get_position(symbol)  # tambien aprende el modo (one-way o hedge) para el positionIdx
        if not pos.get("success"):
            raise HTTPException(status_code=502, detail=f"No se pudo leer la posicion: {pos.get('error')}")
        if not any(p.get("side") == side for p in pos.get("positions", [])):
            raise HTTPException(status_code=404, detail=f"No hay posicion {side} abierta en {symbol}")
        last = await client.get_last_price(symbol)
        if last is None:
            raise HTTPException(status_code=503, detail="Bybit no dio el precio actual: intentalo de nuevo")
        prec = await client.get_precision(symbol)
        tick = prec["tick_size"] if prec else Decimal("0")

        def fmt(value: Decimal) -> str:
            return OrderManager._fmt(value, tick) if tick > 0 else format(value.normalize(), "f")

        sl_txt = tp_txt = None
        if req.stop_loss is not None:
            sl = OrderManager._round_to_tick(Decimal(str(req.stop_loss)), tick, ROUND_CEILING if long else ROUND_FLOOR)
            if (long and sl >= last) or (not long and sl <= last):
                raise HTTPException(status_code=400, detail=(
                    f"El stop de un {'long' if long else 'short'} va {'por debajo' if long else 'por encima'} del precio actual ({last})"))
            sl_txt = fmt(sl)
        if req.take_profit is not None:
            tp = Decimal(str(req.take_profit))
            if tp == 0:
                tp_txt = "0"
            else:
                tp = OrderManager._round_to_tick(tp, tick, ROUND_HALF_UP)
                if (long and tp <= last) or (not long and tp >= last):
                    raise HTTPException(status_code=400, detail=(
                        f"El objetivo de un {'long' if long else 'short'} va {'por encima' if long else 'por debajo'} del precio actual ({last})"))
                tp_txt = fmt(tp)
        result = await client.set_trading_stop(symbol, side, take_profit=tp_txt, stop_loss=sl_txt)
    if result.get("retCode") != 0:
        raise HTTPException(status_code=502, detail=f"Bybit rechazo el cambio: {result.get('retMsg')} (retCode={result.get('retCode')})")
    changes = [f"SL {sl_txt}" if sl_txt else "", ("TP quitado" if tp_txt == "0" else f"TP {tp_txt}") if tp_txt else ""]
    state.log("success", f"[POSICION] {symbol} {side}: {', '.join(c for c in changes if c)}")
    if state.stream:
        asyncio.create_task(state.stream.snapshot())
    return {"success": True, "symbol": symbol, "side": side, "stop_loss": sl_txt, "take_profit": tp_txt}


@app.post("/api/orders/cancel")
async def cancel_order_route(req: CancelOrderRequest):
    """Cancela una orden de ENTRADA pendiente. Las de TP o SL de una posicion no: esas se mueven desde la posicion."""
    symbol = _symbol_or_400(req.symbol)
    client = state.bybit_client
    if not client:
        raise HTTPException(status_code=400, detail="Credentials not configured")
    async with state.get_symbol_lock(symbol):
        _same_account(client)
        orders = await client.get_open_orders(symbol)
        if orders is None:
            raise HTTPException(status_code=502, detail="Bybit no respondio: no se pudo revisar la orden")
        order = next((o for o in orders if o.get("orderId") == req.order_id), None)
        if order is None:
            raise HTTPException(status_code=404, detail="Esa orden ya no esta abierta")
        if not order_record(order)["entry"]:
            raise HTTPException(status_code=400, detail="Esa orden es el TP o el SL de una posicion: muevelo desde la posicion")
        result = await client.cancel_order(symbol, req.order_id)
        if result.get("retCode") != 0:
            # Un reintento tras un corte pudo cancelarla y Bybit responde que ya no existe: se mira de nuevo
            again = await client.get_open_orders(symbol)
            if again is None or any(o.get("orderId") == req.order_id for o in again):
                raise HTTPException(status_code=502, detail=f"Bybit no cancelo la orden: {result.get('retMsg')} (retCode={result.get('retCode')})")
    state.log("success", f"[ORDEN] {symbol}: orden {req.order_id} cancelada a pedido")
    if state.stream:
        asyncio.create_task(state.stream.snapshot())
    return {"success": True, "symbol": symbol, "orderId": req.order_id}


# ==========================
# Journal de trades reales (paso 4 de la integracion, 12/11/2026)
# ==========================

class JournalNoteRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@app.get("/api/journal/trades")
async def journal_trades(days: int = 30, symbol: Optional[str] = None, account: Optional[str] = None):
    """Trades reales: abiertos primero, despues cerrados de los ultimos `days` dias. Neto de comisiones (Bybit)."""
    sym = _symbol_or_400(symbol) if symbol else None
    trades = state.journal.trades(days=max(1, min(days, 3650)), symbol=sym, account=account)
    return {"success": True, "trades": trades, "count": len(trades), "account": state.active_account}


@app.post("/api/journal/trades/{trade_id}/note")
async def journal_note(trade_id: str, req: JournalNoteRequest):
    if not TRADE_ID_RE.match(trade_id) or not state.journal.exists(trade_id):
        raise HTTPException(status_code=404, detail="trade no encontrado")
    state.journal.add_note(trade_id, req.text.strip())
    return {"success": True}


@app.post("/api/journal/sync")
async def journal_sync_route(days: int = 7):
    """Pide ya los cierres a Bybit (hasta 7 dias), sin esperar el minuto."""
    if not state.bybit_client:
        raise HTTPException(status_code=400, detail="Credentials not configured")
    added = await journal_sync(days=max(1, min(days, 7)))
    return {"success": True, "added": added}


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
                                    "confidence": parts[7] if len(parts) > 7 else None,
                                    "origin": parts[8] if len(parts) > 8 else None
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
    origin = websocket.headers.get("origin")
    if origin and not re.fullmatch(LOCAL_ORIGIN_REGEX, origin):
        await websocket.close(code=1008)
        return

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
        if websocket in state.ws_connections:
            state.ws_connections.remove(websocket)
        state.log("info", f"WebSocket client disconnected (remaining: {len(state.ws_connections)})")
    except Exception as e:
        state.log("error", f"WebSocket error: {str(e)}")
        if websocket in state.ws_connections:
            state.ws_connections.remove(websocket)


if __name__ == "__main__":
    import uvicorn
    # Solo este PC: ningun otro equipo de la red puede enviar ordenes
    uvicorn.run(app, host="127.0.0.1", port=5000, log_level="info")
