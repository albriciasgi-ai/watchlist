# bot_routes.py - Lo que App 10 hace con el bot, desde la suite: configuracion por moneda, riesgo,
# credenciales de Bybit, origenes de alertas, direcciones y ordenes manuales del panel de trading.
#
# El bot (3.TradingBot_Python) sigue siendo su propio proceso y no pide confirmacion en ninguna ruta.
# Aqui cada cambio exige una palabra en el cuerpo, para que ningun clic suelto ni pagina ajena lo haga:
#   CAMBIAR_CONFIG   configuracion de monedas, riesgo, metodo, origenes y direcciones
#   CAMBIAR_CLAVES   credenciales de Bybit (nunca se guardan ni se escriben en el registro de la suite)
#   ENVIAR_ORDEN_REAL  orden manual: siempre con stop y objetivo, del lado correcto del precio
import re
from decimal import Decimal, InvalidOperation

from fastapi import APIRouter, HTTPException, Request

SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
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
