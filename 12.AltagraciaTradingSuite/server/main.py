# main.py - Servidor de Altagracia Trading Suite (puerto 13000 por defecto).
#
# Un solo servidor para la app en tiempo real:
#   - Mercado: velas de Bybit y, con los lectores de App 1, footprints, perfil real y liquidaciones.
#     Los footprints salen del almacen de order flow: dias oficiales, y donde faltan, lo que graban la
#     nube (Northflank) y el PC (backend 11000), unido por PanelOrderFlow/sync_nube.py.
#   - Bot: lee y maneja el bot (3.TradingBot_Python) por su API. El bot sigue siendo su propio proceso.
#   - Dibujos: guardados por moneda en data/drawings.
#   - Swing: detecta al cierre de cada vela con las reglas de App 1 y lo anota en data/swing (swing_watch.py).
#     No envia nada: las alertas quedan para la central de confluencia.
# Las rutas del mercado responden igual que las del backend de App 1, para que el grafico de App 1
# (MiniChart) se use tal cual, sin copiarlo.
#
# Uso:  C:\Python314\python.exe -B main.py      (o SUITE_PORT=13100 para otra copia)
import asyncio
import json
import math
import os
import re
import statistics
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

sys.path.insert(0, str(Path(__file__).resolve().parent))
from settings import CONFIG, SUITE_DIR  # noqa: E402

# Lectores de App 1: la pieza compartida. Sus carpetas salen de la configuracion de la suite
DATA = Path(CONFIG["orderflow_data"])
os.environ.setdefault("ORDERFLOW_STORE", str(DATA / "store"))
os.environ.setdefault("ORDERFLOW_LIVE_STORE", str(DATA / "live" / "store"))
os.environ.setdefault("ORDERFLOW_LIQ", str(DATA / "liquidations"))
sys.path.insert(0, CONFIG["app1_backend"])
import footprint_store  # noqa: E402
import liq_store  # noqa: E402
import candles  # noqa: E402  velas de Bybit, compartidas con market_routes
import market_routes  # noqa: E402  indicadores en vivo (OI, VWAP, S&R, Elementos OF, patrones)
import bot_routes  # noqa: E402  configuracion, riesgo, claves y ordenes del panel de trading
import journal_routes  # noqa: E402  journal (paso 4): imagenes, contexto de decision, medidas e informe
from journal_store import JournalStore  # noqa: E402
import official  # noqa: E402  dias oficiales que faltan, con las herramientas del panel
import recorder  # noqa: E402  grabacion propia de trades (live/local), un solo proceso a la vez
import book_recorder  # noqa: E402  libro completo de Bybit (live/book), un solo proceso a la vez
import book_cloud  # noqa: E402  tapa los huecos del libro con lo que graba la nube (live/book_cloud)
import book_heatmap  # noqa: E402  mapa de liquidez por vela y precio, para la pestana "Mapa"
import book_levels  # noqa: E402  niveles de liquidez sostenida, para la pestana "Mapa"
import book_defense  # noqa: E402  defensa de las zonas dibujadas, para la pestana "Mapa"
import ladder  # noqa: E402  price ladder de la pestana "Mapa", del libro en memoria
import swing_watch  # noqa: E402  Swing del servidor: detecta y anota, nunca envia
from symbols import SYMBOL_RE as COIN_RE, SymbolList  # noqa: E402

COLOMBIA_TZ = timezone(timedelta(hours=-5))
SYMBOL_RE = re.compile(r"^[A-Z0-9]{2,20}$")
INTERVALS = {"1": 1, "5": 5, "15": 15, "60": 60, "240": 240}
# Dias de velas por marco para el grafico en vivo (cada pedido a Bybit trae 1000 velas)
LIVE_DAYS = {"1": 3, "5": 10, "15": 30, "60": 120, "240": 365}
CANDLE_CACHE_SECONDS = 5
DRAWINGS_DIR = Path(CONFIG["data_dir"]) / "drawings"

app = FastAPI(title="Altagracia Trading Suite", version="0.1.0")
_http: Optional[httpx.AsyncClient] = None
_candle_cache = {}
app.include_router(market_routes.router)
app.include_router(book_recorder.make_router())
app.include_router(book_cloud.make_router())
app.include_router(book_heatmap.make_router())
app.include_router(ladder.make_router())
app.include_router(book_levels.make_router())
app.include_router(book_defense.make_router(DRAWINGS_DIR))
SWING = swing_watch.SwingWatch(Path(CONFIG["data_dir"]) / "swing", DRAWINGS_DIR)
app.include_router(swing_watch.make_router(SWING))


@app.on_event("startup")
async def _startup():
    global _http
    _http = httpx.AsyncClient(timeout=httpx.Timeout(15.0, connect=5.0))
    candles.set_client(_http)
    DRAWINGS_DIR.mkdir(parents=True, exist_ok=True)
    try:
        coins = SYMBOLS.load()
    except Exception as e:
        print(f"[SUITE] lista de monedas ilegible ({e}); se graban las de fabrica")
        from symbols import DEFAULT_SYMBOLS
        coins = list(DEFAULT_SYMBOLS)
    await recorder.start(coins, DATA, SUITE_DIR.parent)
    await book_recorder.start(coins, DATA, CONFIG["bybit_url"], _http, candles.bybit_turn)
    book_cloud.start(DATA, os.environ.get("SUITE_CLOUD_URL", book_cloud.DEFAULT_URL), _official_symbols, _http)
    official.start(DATA, _official_symbols)
    await SWING.start()
    print(f"[SUITE] Servidor en http://{CONFIG['host']}:{CONFIG['port']} | almacen {DATA} | bot {CONFIG['bot_url']}")


@app.on_event("shutdown")
async def _shutdown():
    await SWING.stop()
    official.stop()
    await book_cloud.stop()
    await book_recorder.stop()
    await recorder.stop()
    if _http:
        await _http.aclose()


SYMBOLS = SymbolList(CONFIG["data_dir"])


def _official_symbols():
    try:
        return SYMBOLS.load()
    except Exception:
        return []


# ---------- proteccion: solo paginas de este PC ----------
@app.middleware("http")
async def _local_only(request: Request, call_next):
    allowed = set(CONFIG["allowed_origin_hosts"])
    host = (request.headers.get("host") or "").rsplit(":", 1)[0].strip("[]")
    if host not in allowed:
        return JSONResponse({"success": False, "error": "host no permitido"}, status_code=403)
    origin = request.headers.get("origin")
    if origin and origin != "null":
        if (urlsplit(origin).hostname or "") not in allowed:
            return JSONResponse({"success": False, "error": "origen no permitido"}, status_code=403)
    response = await call_next(request)
    # La pagina (index.html) siempre se revisa: si no, Electron podia usar una vieja de su cache tras armarla
    # de nuevo. Los archivos de assets llevan su huella en el nombre y si se guardan
    if request.url.path == "/" or request.url.path.endswith(".html"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def _symbol(symbol: str) -> str:
    symbol = (symbol or "").upper()
    if not SYMBOL_RE.match(symbol):
        raise HTTPException(status_code=400, detail="simbolo invalido")
    return symbol


def _interval(interval: str) -> str:
    text = (interval or "").strip().lower()
    if text.endswith("h") and text[:-1].isdigit():
        text = str(int(text[:-1]) * 60)
    elif text.endswith("m") and text[:-1].isdigit():
        text = text[:-1]
    if text not in INTERVALS:
        raise HTTPException(status_code=400, detail="marco no soportado")
    return text


def _json(body) -> Response:
    return Response(content=json.dumps(body, allow_nan=False, separators=(",", ":")).encode("utf-8"),
                    media_type="application/json")


# ---------- mercado ----------
async def _klines(symbol: str, interval: str, days: int):
    """Velas de Bybit (candles.klines, compartido con market_routes)."""
    return await candles.klines(symbol, interval, days)


@app.get("/api/historical/{symbol}")
async def historical(symbol: str, interval: str = "15", days: int = 30):
    """Velas de Bybit, con la misma respuesta que el backend de App 1."""
    symbol, interval = _symbol(symbol), _interval(interval)
    days = max(1, min(int(days), LIVE_DAYS[interval]))
    key = (symbol, interval, days)
    hit = _candle_cache.get(key)
    if hit and time.time() - hit[0] < CANDLE_CACHE_SECONDS:
        candles = hit[1]
    else:
        candles = await _klines(symbol, interval, days)
        _candle_cache[key] = (time.time(), candles)
    return {"symbol": symbol, "interval": interval, "data": candles, "success": True,
            "total_candles": len(candles), "days_fetched": days, "max_days_allowed": LIVE_DAYS[interval],
            "updated": int(time.time() * 1000)}


# ---------- step parejo de los footprints ----------
# El usuario lo pidio el 12/11: celdas iguales en todas las velas, como su App 1 (BTC 15m, 20 USD por nivel).
# Regla: un step redondo (1, 2, 2.5, 5 x 10^k) que deja unos 10 niveles en la vela tipica del marco, con la
# mediana del rango (alto - bajo) de las ultimas 500 velas cerradas. Se calcula una vez cada 6 horas.
UNIFORM_LEVELS = 10
UNIFORM_TTL = 6 * 3600
_uniform_steps = {}


def nice_step(raw: float) -> float:
    power = 10 ** math.floor(math.log10(raw))
    return round(min((k * power for k in (1, 2, 2.5, 5, 10)), key=lambda v: abs(v - raw)), 12)


async def _uniform_step(symbol: str, interval: str) -> Optional[float]:
    hit = _uniform_steps.get((symbol, interval))
    if hit and time.time() - hit[0] < UNIFORM_TTL:
        return hit[1]
    try:
        data = await candles.cached_klines(symbol, interval, candles.LIVE_DAYS[interval])
    except HTTPException:
        return None  # sin velas de Bybit: el lector usa su step automatico
    ranges = [c["high"] - c["low"] for c in data if not c.get("in_progress")][-500:]
    ranges = [r for r in ranges if r > 0]
    if len(ranges) < 20:
        return None
    step = nice_step(statistics.median(ranges) / UNIFORM_LEVELS)
    _uniform_steps[(symbol, interval)] = (time.time(), step)
    return step


@app.get("/api/orderflow/historical/{symbol}")
async def orderflow_historical(
    symbol: str, interval: str = "1", start_timestamp: Optional[int] = None, end_timestamp: Optional[int] = None,
    known_until: Optional[int] = None, step: Optional[float] = None, imbalance_ratio: float = 3.0,
    imbalance_mode: str = "level", imbalance_min_volume: float = 0.0, imbalance_zero: bool = False,
    stacked_levels: int = 3, max_levels: Optional[int] = None, step_mode: Optional[str] = None,
    imbalance_candle_pct: float = 0.0, imbalance_candle_bars: int = 20, imbalance_cell_pct: float = 0.0,
):
    """Footprints del almacen (oficial, y nube + PC donde falta el oficial), como el backend de App 1.
    step_mode=uniform (el grafico en vivo): un solo step para todas las velas; sin step, el de _uniform_step."""
    symbol, interval = _symbol(symbol), _interval(interval)
    now = int(time.time() * 1000)
    if start_timestamp is None or end_timestamp is None:
        end_timestamp = now
        start_timestamp = now - 12 * 3_600_000
    # Hasta donde llega de verdad el almacen (ultimo minuto armado), no "ahora": asi la pagina vuelve a pedir
    # las velas recientes hasta que lleguen sus trades. Antes respondia "ahora" y las daba por vistas, vacias
    cut = await run_in_threadpool(market_routes._live_cut, symbol, known_until)
    rules = {"ratio": max(1.01, imbalance_ratio), "mode": imbalance_mode if imbalance_mode in ("level", "diagonal") else "level",
             "min_volume": max(0.0, imbalance_min_volume), "candle_volume_pct": max(0.0, imbalance_candle_pct),
             "candle_volume_bars": max(1, imbalance_candle_bars), "cell_share_pct": max(0.0, imbalance_cell_pct),
             "count_zero": imbalance_zero,
             "stacked_levels": max(2, stacked_levels)}
    limit = max(2, max_levels) if max_levels else None
    if step_mode == "uniform":
        limit = None
        if step is None:
            step = await _uniform_step(symbol, interval)

    def body():
        result = footprint_store.footprints(symbol, int(interval), start_timestamp, end_timestamp, cut, step, rules,
                                            limit, live=True)
        return {"success": True, "footprints": result["footprints"], "count": len(result["footprints"]),
                "step_size": result["step_size"], "cell_size": result.get("cell_size"),
                "known_until": result["known_until"], "interval": interval, "source": "store",
                "live_days": result.get("live_days", [])}

    return _json(await run_in_threadpool(body))


@app.get("/api/orderflow/profile/{symbol}")
async def orderflow_profile(symbol: str, start_timestamp: int, end_timestamp: int, low: float, high: float,
                            rows: int = 50, known_until: Optional[int] = None):
    symbol = _symbol(symbol)
    rows = max(1, min(rows, 2000))
    cut = min(known_until if known_until is not None else int(time.time() * 1000), int(time.time() * 1000))
    result = await run_in_threadpool(footprint_store.profile, symbol, start_timestamp, end_timestamp, cut, low, high,
                                     rows, True)
    return {"success": True, **result}


@app.get("/api/liquidations/{symbol}")
async def liquidations(symbol: str, start_timestamp: int, end_timestamp: int, known_until: Optional[int] = None):
    symbol = _symbol(symbol)
    return _json(await run_in_threadpool(lambda: {"success": True, **liq_store.window(symbol, start_timestamp, end_timestamp, known_until)}))


# ---------- dibujos ----------
@app.get("/api/drawings/{symbol}")
async def get_drawings(symbol: str):
    symbol = _symbol(symbol)
    path = DRAWINGS_DIR / f"{symbol}.json"
    if not path.exists():
        return {"symbol": symbol, "shapes": [], "updated_at": None}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"dibujos ilegibles: {e}")


@app.post("/api/drawings/{symbol}")
async def save_drawings(symbol: str, request: Request):
    symbol = _symbol(symbol)
    body = await request.json()
    shapes = body.get("shapes")
    if not isinstance(shapes, list):
        raise HTTPException(status_code=400, detail="shapes debe ser una lista")
    data = {"symbol": symbol, "interval": str(body.get("interval", "")), "shapes": shapes,
            "updated_at": datetime.now(timezone.utc).isoformat(), "total_shapes": len(shapes)}
    path = DRAWINGS_DIR / f"{symbol}.json"
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)
    return {"success": True, "total_shapes": len(shapes)}


# ---------- bot ----------
async def _bot(method: str, path: str, **kw):
    # 503: no hubo conexion, el bot no recibio nada. 504: se envio y no llego respuesta: una orden pudo salir
    try:
        r = await _http.request(method, CONFIG["bot_url"] + path, **kw)
    except httpx.ConnectError as e:
        raise HTTPException(status_code=503, detail=f"bot no disponible: {type(e).__name__}")
    except httpx.HTTPError as e:
        raise HTTPException(status_code=504, detail=f"sin respuesta del bot ({type(e).__name__}): revisa Bybit antes de reintentar")
    try:
        data = r.json()
    except ValueError:
        raise HTTPException(status_code=502, detail=f"respuesta del bot no es JSON ({r.status_code})")
    if r.status_code >= 400:
        raise HTTPException(status_code=r.status_code, detail=data.get("detail") if isinstance(data, dict) else str(data))
    return data


@app.get("/api/bot/overview")
async def bot_overview():
    """Estado, pausa, avisos criticos y ultimas ordenes del bot. No consulta Bybit."""
    status, critical, orders = await asyncio.gather(
        _bot("GET", "/api/status"), _bot("GET", "/api/alerts/critical", params={"limit": 20}),
        _bot("GET", "/api/orders/history", params={"limit": 50}))
    return {"success": True, "status": status, "critical": critical.get("alerts", []),
            "orders": orders.get("orders", []), "orders_total": orders.get("total")}


@app.get("/api/bot/positions")
async def bot_positions():
    """Posiciones abiertas de todas las monedas. El bot las tiene al dia por su WebSocket privado (un bot viejo
    ignora `all` y da solo las configuradas)."""
    return await _bot("GET", "/api/positions", params={"all": "true"})


@app.get("/api/bot/alerts")
async def bot_alerts(minutes: int = 240):
    return await _bot("GET", "/api/alerts/recent", params={"minutes": max(1, min(minutes, 10_080))})


@app.post("/api/bot/pause")
async def bot_pause(request: Request):
    """Pausa o reanuda todo el trading del bot. Exige {"paused": bool, "confirm": "CAMBIAR_PAUSA"}."""
    body = await request.json()
    if body.get("confirm") != "CAMBIAR_PAUSA" or not isinstance(body.get("paused"), bool):
        raise HTTPException(status_code=400, detail='se necesita {"paused": true|false, "confirm": "CAMBIAR_PAUSA"}')
    return await _bot("POST", "/api/settings/trading-paused", json={"paused": body["paused"]})


JOURNAL = JournalStore(Path(CONFIG["data_dir"]) / "journal")
app.include_router(bot_routes.make_router(lambda *a, **kw: _bot(*a, **kw), journal_store=JOURNAL))  # _bot se busca al llamar (las pruebas lo cambian)
app.include_router(journal_routes.make_router(JOURNAL, lambda *a, **kw: _bot(*a, **kw)))


# ---------- monedas y precio ----------
@app.get("/api/suite/symbols")
async def get_symbols():
    try:
        return {"success": True, "symbols": SYMBOLS.load()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"lista de monedas ilegible: {e}")


async def _instrument(symbol: str) -> bool:
    await candles.bybit_turn()
    r = await _http.get(CONFIG["bybit_url"] + "/v5/market/instruments-info", params={"category": "linear", "symbol": symbol})
    items = (r.json().get("result") or {}).get("list") or []
    return bool(items) and items[0].get("status") == "Trading" and items[0].get("quoteCoin") == "USDT"


@app.post("/api/suite/symbols")
async def add_symbol(request: Request):
    body = await request.json()
    symbol = str(body.get("symbol") or "").strip().upper()
    if not COIN_RE.match(symbol):
        raise HTTPException(status_code=400, detail="escribe una moneda como LINKUSDT")
    try:
        current = SYMBOLS.load()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"lista de monedas ilegible: {e}")
    if symbol not in current:
        try:
            ok = await _instrument(symbol)
        except (httpx.HTTPError, ValueError) as e:
            raise HTTPException(status_code=503, detail=f"no se pudo consultar Bybit: {type(e).__name__}")
        if not ok:
            raise HTTPException(status_code=404, detail=f"{symbol} no es un perpetuo USDT que cotice en Bybit")
    try:
        symbols = SYMBOLS.add(symbol)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    await recorder.add_symbol(symbol)
    await book_recorder.add_symbol(symbol)
    return {"success": True, "symbols": symbols}


@app.delete("/api/suite/symbols/{symbol}")
async def remove_symbol(symbol: str):
    try:
        return {"success": True, "symbols": SYMBOLS.remove(_symbol(symbol))}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


_tickers = {}


@app.get("/api/ticker/{symbol}")
async def ticker(symbol: str):
    """Ultimo precio de Bybit (cache de 1 s), para el panel de trading."""
    symbol = _symbol(symbol)
    hit = _tickers.get(symbol)
    if hit and time.time() - hit[0] < 1:
        return hit[1]
    try:
        await candles.bybit_turn()
        r = await _http.get(CONFIG["bybit_url"] + "/v5/market/tickers", params={"category": "linear", "symbol": symbol})
        item = ((r.json().get("result") or {}).get("list") or [{}])[0]
        price = float(item["lastPrice"])
    except (httpx.HTTPError, ValueError, KeyError, TypeError) as e:
        raise HTTPException(status_code=503, detail=f"sin precio de Bybit: {type(e).__name__}")
    out = {"success": True, "symbol": symbol, "price": price, "at": int(time.time() * 1000)}
    _tickers[symbol] = (time.time(), out)
    return out


# ---------- estado de la suite ----------
@app.get("/api/suite/status")
async def suite_status():
    def store_info():
        out = {}
        for sym in ("BTCUSDT", "ETHUSDT"):
            cov = footprint_store.coverage(sym)
            live_days = sorted(p.stem.rsplit("_", 1)[1] for p in (footprint_store.LIVE_DIR / sym).glob("*/*.npz"))
            out[sym] = {"official_last": cov.get("last"), "live_days": live_days[-5:]}
        return out

    async def local_tape():
        try:
            r = await _http.get("http://127.0.0.1:11000/api/orderflow/local-tape", timeout=3)
            d = r.json()
            return {"running": d.get("running"), "symbols": len(d.get("symbols", [])),
                    "last_build": (d.get("build") or {}).get("last_build")}
        except Exception:
            return {"running": None}

    async def bot():
        try:
            s = await _bot("GET", "/api/status")
            return {"online": True, "mode": s.get("mode"), "trading_paused": s.get("trading_paused")}
        except HTTPException:
            return {"online": False}

    store, tape, bot_state = await asyncio.gather(run_in_threadpool(store_info), local_tape(), bot())
    return {"success": True, "version": app.version, "now": int(time.time() * 1000), "store": store,
            "local_tape": tape, "bot": bot_state,
            "recorder": recorder.status(), "book": book_recorder.brief(), "book_cloud": book_cloud.brief(),
            "official": official.status(), "swing": SWING.brief()}


# Frontend ya armado (web/dist), servido desde aqui: una sola direccion para todo
_dist = SUITE_DIR / "web" / "dist"
if _dist.exists():
    from fastapi.staticfiles import StaticFiles
    app.mount("/", StaticFiles(directory=str(_dist), html=True), name="web")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=CONFIG["host"], port=int(CONFIG["port"]), log_level="info")
