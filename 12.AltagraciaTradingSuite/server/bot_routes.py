# bot_routes.py - Lo que App 10 hace con el bot, desde la suite: configuracion por moneda, riesgo,
# credenciales de Bybit, origenes de alertas, direcciones y ordenes manuales del panel de trading.
#
# El bot (3.TradingBot_Python) sigue siendo su propio proceso y no pide confirmacion en ninguna ruta.
# Aqui cada cambio exige una palabra en el cuerpo, para que ningun clic suelto ni pagina ajena lo haga:
#   CAMBIAR_CONFIG   configuracion de monedas, riesgo, metodo, origenes y direcciones
#   CAMBIAR_CLAVES   credenciales y cuentas de Bybit (nunca se guardan ni se escriben en el registro de la suite)
#   CAMBIAR_CUENTA   cambiar la cuenta activa del bot (alertas y ordenes pasan a operar en ella)
#   ENVIAR_ORDEN_REAL  orden manual: siempre con stop y objetivo, del lado correcto del precio
#   CERRAR_POSICION  cerrar una posicion a mercado
#   MOVER_STOP       mover el SL o el TP de una posicion (el SL nunca se quita)
#   CANCELAR_ORDEN   cancelar una orden de entrada pendiente
import re
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, Request

SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
ACCOUNT_RE = re.compile(r"^[a-f0-9]{12}$")
ORDER_ID_RE = re.compile(r"^[A-Za-z0-9-]{1,64}$")
TRADE_ID_RE = re.compile(r"^[A-Za-z0-9:._-]{1,160}$")
ORIGINS = {"ANALIZADOR", "WATCHLIST", "ORDERFLOW"}
DIRECTIONS = {"LONG", "SHORT", "BOTH", "DISABLED"}


def _symbol(value) -> str:
    s = str(value or "").upper()
    if not SYMBOL_RE.match(s):
        raise HTTPException(status_code=400, detail="simbolo invalido")
    return s


def _number(body: dict, key: str, *, required=True, positive=True, upper=None):
    value = body.get(key)
    if value is None or value == "":
        if required:
            raise HTTPException(status_code=400, detail=f"falta {key}")
        return None
    if isinstance(value, bool):
        raise HTTPException(status_code=400, detail=f"{key} invalido")
    try:
        number = float(Decimal(str(value)))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=400, detail=f"{key} invalido")
    if number != number or (positive and number <= 0) or (not positive and number < 0) or (upper is not None and number > upper):
        raise HTTPException(status_code=400, detail=f"{key} fuera de rango")
    return number


async def _body(request: Request, word: str) -> dict:
    try:
        body = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="cuerpo JSON invalido")
    if not isinstance(body, dict) or body.get("confirm") != word:
        raise HTTPException(status_code=400, detail=f'se necesita "confirm": "{word}"')
    return body


def make_router(bot) -> APIRouter:
    """bot(method, path, **kw) llama al bot y devuelve su JSON (o lanza HTTPException)."""
    r = APIRouter(prefix="/api/bot")

    # ---------- lectura ----------
    @r.get("/config")
    async def config():
        return await bot("GET", "/api/config")

    @r.get("/settings")
    async def settings():
        return await bot("GET", "/api/settings")

    @r.get("/directions")
    async def directions():
        return await bot("GET", "/api/directions")

    @r.get("/credentials/check")
    async def credentials_check():
        return await bot("GET", "/api/credentials/check")

    @r.get("/position/{symbol}")
    async def position(symbol: str):
        return await bot("GET", f"/api/position/{_symbol(symbol)}")

    @r.get("/logs")
    async def logs(limit: int = 200):
        return await bot("GET", "/api/logs", params={"limit": max(1, min(limit, 1000))})

    # ---------- configuracion por moneda ----------
    @r.post("/config/update")
    async def config_update(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        payload = {"symbol": _symbol(b.get("symbol"))}
        for key, upper in (("risk_amount", None), ("stop_loss_percent", 0.5), ("take_profit_percent", 5)):
            value = _number(b, key, required=False, upper=upper)
            if value is not None:
                payload[key] = value
        if len(payload) == 1:
            raise HTTPException(status_code=400, detail="nada que cambiar")
        return await bot("POST", "/api/config/update", json=payload)

    @r.post("/config/add")
    async def config_add(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        payload = {
            "symbol": _symbol(b.get("symbol")),
            "risk_amount": _number(b, "risk_amount"),
            "stop_loss_percent": _number(b, "stop_loss_percent", upper=0.5),
            "take_profit_percent": _number(b, "take_profit_percent", upper=5),
        }
        leverage = _number(b, "leverage", required=False, upper=100)
        if leverage is not None:
            payload["leverage"] = int(leverage)
        return await bot("POST", "/api/config/add", json=payload)

    @r.post("/config/sync-precision/{symbol}")
    async def sync_precision(symbol: str, request: Request):
        await _body(request, "CAMBIAR_CONFIG")
        return await bot("POST", f"/api/config/sync-precision/{_symbol(symbol)}")

    @r.post("/config/update-risk-all")
    async def risk_all(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        return await bot("POST", "/api/config/update-risk-all", json={"risk_amount": _number(b, "risk_amount")})

    # ---------- riesgo y ajustes ----------
    @r.post("/settings/daily-risk-limit")
    async def daily_limit(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        return await bot("POST", "/api/settings/daily-risk-limit",
                         json={"daily_risk_limit": _number(b, "daily_risk_limit", positive=False)})

    @r.post("/settings/daily-risk-reset")
    async def daily_reset(request: Request):
        await _body(request, "CAMBIAR_CONFIG")
        return await bot("POST", "/api/settings/daily-risk-reset")

    @r.post("/settings/execution-method")
    async def execution_method(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        if not isinstance(b.get("use_integrated"), bool):
            raise HTTPException(status_code=400, detail="use_integrated debe ser true o false")
        return await bot("POST", "/api/settings/execution-method",
                         params={"use_integrated": "true" if b["use_integrated"] else "false"})

    @r.post("/settings/allowed-origins")
    async def allowed_origins(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        if b.get("origin") not in ORIGINS or not isinstance(b.get("enabled"), bool):
            raise HTTPException(status_code=400, detail="origen desconocido o enabled no booleano")
        return await bot("POST", "/api/settings/allowed-origins", json={"origin": b["origin"], "enabled": b["enabled"]})

    @r.post("/directions/update")
    async def direction_update(request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        if b.get("direction") not in DIRECTIONS:
            raise HTTPException(status_code=400, detail="direccion invalida")
        return await bot("POST", "/api/directions/update", json={"symbol": _symbol(b.get("symbol")), "direction": b["direction"]})

    # ---------- credenciales ----------
    @r.post("/credentials")
    async def credentials(request: Request):
        b = await _body(request, "CAMBIAR_CLAVES")
        key, secret = b.get("api_key"), b.get("api_secret")
        if not isinstance(key, str) or not isinstance(secret, str) or not key.strip() or not secret.strip():
            raise HTTPException(status_code=400, detail="faltan api_key y api_secret")
        if not isinstance(b.get("demo"), bool):
            raise HTTPException(status_code=400, detail="demo debe ser true o false")
        return await bot("POST", "/api/credentials", json={"api_key": key.strip(), "api_secret": secret.strip(), "demo": b["demo"]})

    # ---------- cuentas de Bybit (una activa a la vez) ----------
    def _account(account_id: str) -> str:
        if not ACCOUNT_RE.match(account_id or ""):
            raise HTTPException(status_code=400, detail="id de cuenta invalido")
        return account_id

    @r.get("/accounts")
    async def accounts():
        return await bot("GET", "/api/accounts")

    @r.get("/accounts/{account_id}/summary")
    async def account_summary(account_id: str):
        return await bot("GET", f"/api/accounts/{_account(account_id)}/summary")

    @r.post("/accounts")
    async def add_account(request: Request):
        b = await _body(request, "CAMBIAR_CLAVES")
        name, key, secret = b.get("name"), b.get("api_key"), b.get("api_secret")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40:
            raise HTTPException(status_code=400, detail="nombre de 1 a 40 caracteres")
        if not isinstance(key, str) or not isinstance(secret, str) or not key.strip() or not secret.strip():
            raise HTTPException(status_code=400, detail="faltan api_key y api_secret")
        if not isinstance(b.get("demo"), bool):
            raise HTTPException(status_code=400, detail="demo debe ser true o false")
        return await bot("POST", "/api/accounts", json={"name": name.strip(), "api_key": key.strip(),
                                                       "api_secret": secret.strip(), "demo": b["demo"]})

    @r.post("/accounts/{account_id}/activate")
    async def activate_account(account_id: str, request: Request):
        await _body(request, "CAMBIAR_CUENTA")
        return await bot("POST", f"/api/accounts/{_account(account_id)}/activate")

    @r.post("/accounts/{account_id}/rename")
    async def rename_account(account_id: str, request: Request):
        b = await _body(request, "CAMBIAR_CONFIG")
        name = b.get("name")
        if not isinstance(name, str) or not name.strip() or len(name.strip()) > 40:
            raise HTTPException(status_code=400, detail="nombre de 1 a 40 caracteres")
        return await bot("PUT", f"/api/accounts/{_account(account_id)}", json={"name": name.strip()})

    @r.post("/accounts/{account_id}/delete")
    async def delete_account(account_id: str, request: Request):
        await _body(request, "CAMBIAR_CLAVES")
        return await bot("DELETE", f"/api/accounts/{_account(account_id)}")

    # ---------- posiciones y ordenes abiertas (grafico y panel) ----------
    def _side(value) -> str:
        if value not in ("Buy", "Sell"):
            raise HTTPException(status_code=400, detail="side debe ser Buy (long) o Sell (short)")
        return value

    @r.get("/orders/open")
    async def open_orders(symbol: str = None):
        return await bot("GET", "/api/orders/open", params={"symbol": _symbol(symbol)} if symbol else None)

    @r.get("/executions")
    async def executions(limit: int = 100, symbol: str = None):
        params = {"limit": max(1, min(limit, 500))}
        if symbol:
            params["symbol"] = _symbol(symbol)
        return await bot("GET", "/api/executions/recent", params=params)

    @r.get("/stream")
    async def stream():
        return await bot("GET", "/api/stream/status")

    @r.post("/position/close")
    async def position_close(request: Request):
        b = await _body(request, "CERRAR_POSICION")
        return await bot("POST", "/api/position/close", json={"symbol": _symbol(b.get("symbol")), "side": _side(b.get("side"))})

    @r.post("/position/trading-stop")
    async def position_trading_stop(request: Request):
        b = await _body(request, "MOVER_STOP")
        payload = {"symbol": _symbol(b.get("symbol")), "side": _side(b.get("side"))}
        stop = _number(b, "stop_loss", required=False)  # positivo: el SL no se quita
        target = _number(b, "take_profit", required=False, positive=False)  # 0 quita el TP
        if stop is None and target is None:
            raise HTTPException(status_code=400, detail="falta stop_loss o take_profit")
        if stop is not None:
            payload["stop_loss"] = stop
        if target is not None:
            payload["take_profit"] = target
        return await bot("POST", "/api/position/trading-stop", json=payload)

    @r.post("/orders/cancel")
    async def order_cancel(request: Request):
        b = await _body(request, "CANCELAR_ORDEN")
        order_id = str(b.get("order_id") or "")
        if not ORDER_ID_RE.match(order_id):
            raise HTTPException(status_code=400, detail="order_id invalido")
        return await bot("POST", "/api/orders/cancel", json={"symbol": _symbol(b.get("symbol")), "order_id": order_id})

    # ---------- journal de trades reales (paso 4) ----------
    @r.get("/journal")
    async def journal(days: int = 30, symbol: str = None):
        params = {"days": max(1, min(days, 3650))}
        if symbol:
            params["symbol"] = _symbol(symbol)
        return await bot("GET", "/api/journal/trades", params=params)

    @r.post("/journal/sync")
    async def journal_sync():
        return await bot("POST", "/api/journal/sync", params={"days": 7})

    @r.post("/journal/{trade_id}/note")
    async def journal_note(trade_id: str, request: Request):
        # Una nota no mueve dinero: no pide palabra (la protegen el Host y el Origin del servidor)
        if not TRADE_ID_RE.match(trade_id):
            raise HTTPException(status_code=400, detail="trade invalido")
        try:
            b = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="cuerpo JSON invalido")
        text = b.get("text") if isinstance(b, dict) else None
        if not isinstance(text, str) or not text.strip() or len(text) > 4000:
            raise HTTPException(status_code=400, detail="nota de 1 a 4000 caracteres")
        return await bot("POST", f"/api/journal/trades/{trade_id}/note", json={"text": text.strip()})

    # ---------- orden manual (panel de trading) ----------
    @r.post("/trade")
    async def trade(request: Request):
        b = await _body(request, "ENVIAR_ORDEN_REAL")
        symbol = _symbol(b.get("symbol"))
        side = b.get("side")
        if side not in ("Buy", "Sell"):
            raise HTTPException(status_code=400, detail="side debe ser Buy o Sell")
        order_type = b.get("order_type", "Market")
        if order_type not in ("Market", "Limit"):
            raise HTTPException(status_code=400, detail="order_type debe ser Market o Limit")
        quantity = _number(b, "quantity")
        stop, target = _number(b, "stop_loss"), _number(b, "take_profit")
        ref = _number(b, "limit_price") if order_type == "Limit" else _number(b, "current_price")
        long = side == "Buy"
        if (long and not (stop < ref < target)) or (not long and not (target < ref < stop)):
            raise HTTPException(status_code=400, detail="stop y objetivo deben quedar a cada lado del precio de entrada")
        if order_type == "Limit":
            current = _number(b, "current_price")
            if (long and ref >= current) or (not long and ref <= current):
                raise HTTPException(status_code=400, detail="una Limit asi cruza el precio y se llenaria a mercado")
        payload = {"symbol": symbol, "side": side, "quantity": quantity, "stopLoss": stop, "takeProfit": target,
                   "custom_stop_loss": stop, "custom_take_profit": target, "currentPrice": _number(b, "current_price"),
                   "order_type": order_type}
        if order_type == "Limit":
            payload["limit_price"] = ref
        return await bot("POST", "/api/trade/manual", json=payload)

    return r
