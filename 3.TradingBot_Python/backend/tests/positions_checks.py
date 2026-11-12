# Pruebas sin conexion de la cuenta en tiempo real (WebSocket privado), y de cerrar posiciones, mover SL/TP y cancelar
# ordenes desde la suite. Un WebSocket falso en 127.0.0.1 hace de Bybit (comprueba la firma) y un cliente falso
# responde lo de REST: nunca se llama a Bybit ni se tocan las claves reales.
# Uso, desde 3.TradingBot_Python\backend:  C:\Python314\python.exe -B tests\positions_checks.py
import asyncio
import hashlib
import hmac
import json
import os
import shutil
import socket
import sys
import tempfile
import threading
import time
from decimal import Decimal
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="bot_positions_"))
CONFIG = TMP / "config"
CONFIG.mkdir()
SECRETS = {"clave_demo_1111": "secreto_demo", "clave_otra_2222": "secreto_otra"}
(CONFIG / "credentials.json").write_text(json.dumps({"api_key": "clave_demo_1111", "api_secret": "secreto_demo", "demo": True}))
(CONFIG / "trading_config.json").write_text(json.dumps({"coins": [
    {"symbol": "BTCUSDT", "category": "linear", "risk_amount": 3, "stop_loss_percent": 0.02, "take_profit_percent": 0.04,
     "leverage": 10, "step_size": "0.001", "tick_size": "0.1", "min_qty": "0.001", "max_qty": "100"}]}))
(CONFIG / "trading_directions.json").write_text(json.dumps({"directions": {"BTCUSDT": "BOTH"}}))

_s = socket.socket()
_s.bind(("127.0.0.1", 0))
PORT = _s.getsockname()[1]
_s.close()
os.environ["BOT_CONFIG_DIR"] = str(CONFIG)
os.environ["BOT_LOG_DIR"] = str(TMP / "logs")
os.environ["BOT_PRIVATE_WS_URL"] = f"ws://127.0.0.1:{PORT}"  # nunca el de Bybit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def wait_until(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        try:
            if cond():
                return True
        except Exception:
            pass
        time.sleep(0.05)
    return False


# ---------- WebSocket privado falso ----------
SERVER = {"auth": [], "subs": [], "conns": [], "reject": False, "loop": None}


async def ws_handler(ws):
    msg = json.loads(await ws.recv())
    SERVER["auth"].append(msg)
    key, expires, sig = msg["args"]
    secret = SECRETS.get(key, "")
    good = hmac.new(secret.encode(), f"GET/realtime{expires}".encode(), hashlib.sha256).hexdigest() == sig
    ok = good and not SERVER["reject"] and expires > time.time() * 1000
    await ws.send(json.dumps({"op": "auth", "success": ok, "ret_msg": "" if ok else "Invalid apikey"}))
    if not ok:
        return
    SERVER["subs"].append(json.loads(await ws.recv()))
    await ws.send(json.dumps({"op": "subscribe", "success": True}))
    SERVER["conns"].append(ws)
    async for raw in ws:
        if json.loads(raw).get("op") == "ping":
            await ws.send(json.dumps({"op": "pong", "success": True}))


def run_server(ready):
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    SERVER["loop"] = loop

    async def main_():
        from websockets.asyncio.server import serve
        async with serve(ws_handler, "127.0.0.1", PORT):
            ready.set()
            await asyncio.Future()
    loop.run_until_complete(main_())


def push(payload):
    ws = SERVER["conns"][-1]
    asyncio.run_coroutine_threadsafe(ws.send(json.dumps(payload)), SERVER["loop"]).result(5)


ready = threading.Event()
threading.Thread(target=run_server, args=(ready,), daemon=True).start()
ready.wait(10)

# ---------- Bybit falso por REST ----------
REST = {
    "positions": [
        {"symbol": "BTCUSDT", "side": "Buy", "size": "0.01", "avgPrice": "70000", "positionIdx": 0, "stopLoss": "0",
         "takeProfit": "0", "liqPrice": "60000", "createdTime": "1", "updatedTime": "1", "unrealisedPnl": "1"},
        {"symbol": "ETHUSDT", "side": "Sell", "size": "0.5", "avgPrice": "3000", "positionIdx": 0, "stopLoss": "3100",
         "takeProfit": "2800", "createdTime": "2", "updatedTime": "2"},
    ],
    "orders": [],
    "position_delay": 0.0,
    "calls": [],
    "last": Decimal("70500"),
}


class FakeClient:
    instances = []

    def __init__(self, api_key, api_secret, testnet=False, demo=False):
        self.api_key, self.api_secret, self.demo = api_key, api_secret, demo
        self.mode = "demo" if demo else "live"
        self.base_url = "simulado"
        self._position_mode = "one_way"
        self.closed = False
        FakeClient.instances.append(self)

    def _get_timestamp(self):
        return int(time.time() * 1000)

    async def close(self):
        self.closed = True

    async def check_api_key(self):
        return {"valid": True, "readOnly": False}

    def get_statistics(self):
        return {}

    async def _make_request(self, method, endpoint, params=None, **kw):
        if endpoint == "/v5/position/list":
            if REST["position_delay"]:
                await asyncio.sleep(REST["position_delay"])
            return {"retCode": 0, "result": {"list": [dict(p) for p in REST["positions"]], "nextPageCursor": ""}}
        if endpoint == "/v5/order/realtime":
            return {"retCode": 0, "result": {"list": [dict(o) for o in REST["orders"]], "nextPageCursor": ""}}
        return {"retCode": 0, "result": {}}

    async def get_position(self, symbol, category="linear", side_filter=None):
        mine = [p for p in REST["positions"] if p["symbol"] == symbol and float(p["size"]) > 0]
        described = [{"side": p["side"], "size": float(p["size"]), "sizeRaw": p["size"], "entryPrice": p["avgPrice"],
                      "stopLoss": float(p["stopLoss"]) or None} for p in mine]
        return {"success": True, "hasPosition": bool(mine), "positions": described}

    async def get_last_price(self, symbol, category="linear"):
        return REST["last"]

    async def get_precision(self, symbol, category="linear"):
        return {"qty_step": Decimal("0.001"), "tick_size": Decimal("0.1"), "min_qty": Decimal("0.001"), "max_qty": Decimal("100")}

    async def get_instrument_info(self, symbol, category="linear"):
        return {"success": False}

    async def set_trading_stop(self, symbol, position_side, take_profit=None, stop_loss=None, category="linear"):
        REST["calls"].append(("trading_stop", symbol, position_side, stop_loss, take_profit))
        return {"retCode": 0, "result": {}}

    async def place_market_order(self, symbol, side, qty, category="linear", reduce_only=False):
        REST["calls"].append(("market", symbol, side, qty, reduce_only))
        return {"retCode": 0, "result": {"orderId": "cierre-1"}}

    async def get_open_orders(self, symbol, category="linear"):
        return [dict(o) for o in REST["orders"] if o["symbol"] == symbol]

    async def cancel_order(self, symbol, order_id, category="linear"):
        REST["calls"].append(("cancel", symbol, order_id))
        if REST.get("cancel_error"):
            REST["orders"] = [o for o in REST["orders"] if o["orderId"] != order_id]  # ya se habia cancelado
            return {"retCode": 110001, "retMsg": "order not exists or too late to cancel"}
        return {"retCode": 0, "result": {"orderId": order_id}}


import main  # noqa: E402
main.BybitClient = FakeClient
from fastapi.testclient import TestClient  # noqa: E402
from trading.safe_io import write_json_atomic  # noqa: E402

H = {"Host": "127.0.0.1:5000"}


def positions(c, all_=True):
    return c.get("/api/positions" + ("?all=true" if all_ else ""), headers=H).json()


def calls(kind):
    return [x for x in REST["calls"] if x[0] == kind]


try:
    with TestClient(main.app) as c:
        st = main.state
        # Conexion: firma correcta y suscripcion a lo que importa
        check("WebSocket privado conectado con la clave activa", wait_until(lambda: st.stream and st.stream.connected))
        check("firma de autenticacion correcta y suscrito a position, order y execution",
              SERVER["auth"] and SERVER["auth"][-1]["args"][0] == "clave_demo_1111" and SERVER["subs"][-1]["args"] == ["position", "order", "execution"])
        check("ninguna llamada a Bybit real: el WebSocket es el local", st.stream.ws_url == f"ws://127.0.0.1:{PORT}")

        # Foto por REST: posiciones de todas las monedas en dos llamadas
        d = positions(c)
        btc = next((p for p in d.get("positions", []) if p["symbol"] == "BTCUSDT"), {})
        check("posiciones desde el WebSocket (al dia), con entrada de avgPrice y sin SL = None",
              d.get("source") == "stream" and d.get("count") == 2 and btc.get("entryPrice") == "70000" and btc.get("stopLoss") is None
              and btc.get("liqPrice") == 60000.0, str(d))
        check("sin ?all solo las monedas configuradas (como antes)", [p["symbol"] for p in positions(c, False)["positions"]] == ["BTCUSDT"])

        # Revision al arrancar: posicion sin SL, aviso critico una sola vez
        check("posicion sin SL al arrancar: aviso critico",
              wait_until(lambda: any(a.get("type") == "POSITION_WITHOUT_SL" and a.get("symbol") == "BTCUSDT" for a in st.critical_alerts)))
        check("la de ETH tiene SL: sin aviso", not any(a.get("symbol") == "ETHUSDT" for a in st.critical_alerts))
        n_alerts = len(st.critical_alerts)
        c.portal.call(lambda: main.check_unprotected(st.stream.position_list(), grace=0))
        check("el aviso no se repite", len(st.critical_alerts) == n_alerts)

        # Mensajes del WebSocket: SL nuevo, posicion cerrada, orden y ejecucion
        push({"topic": "position", "data": [{"category": "linear", "symbol": "BTCUSDT", "side": "Buy", "size": "0.01",
                                             "entryPrice": "70000", "positionIdx": 0, "stopLoss": "69000", "takeProfit": "72000",
                                             "createdTime": "1", "updatedTime": "5"}]})
        check("SL nuevo por WebSocket llega a /api/positions",
              wait_until(lambda: next(p for p in positions(c)["positions"] if p["symbol"] == "BTCUSDT")["stopLoss"] == 69000.0))
        push({"topic": "position", "data": [{"category": "linear", "symbol": "ETHUSDT", "side": "", "size": "0", "positionIdx": 0,
                                             "updatedTime": "6"}]})
        check("posicion cerrada por WebSocket desaparece", wait_until(lambda: positions(c)["count"] == 1))

        # Una foto por REST pedida antes del cierre no la revive (el WebSocket manda sobre lo viejo)
        REST["position_delay"] = 0.6
        fut = c.portal.start_task_soon(st.stream.snapshot)
        time.sleep(0.2)
        push({"topic": "position", "data": [{"category": "linear", "symbol": "BTCUSDT", "side": "", "size": "0", "positionIdx": 0, "updatedTime": "7"}]})
        fut.result(5)
        REST["position_delay"] = 0.0
        check("foto vieja no revive una posicion cerrada durante la consulta", not st.stream.position_list("BTCUSDT"),
              str(st.stream.position_list()))
        REST["positions"] = [p for p in REST["positions"] if p["symbol"] != "ETHUSDT"]  # Bybit ya no la tiene
        c.portal.call(st.stream.snapshot)
        check("foto nueva sin cambios del WebSocket: vuelve lo de Bybit", len(st.stream.position_list("BTCUSDT")) == 1)

        push({"topic": "order", "data": [{"category": "linear", "symbol": "BTCUSDT", "orderId": "ord-1", "side": "Buy",
                                          "orderType": "Limit", "price": "69500", "qty": "0.01", "orderStatus": "New",
                                          "takeProfit": "71000", "stopLoss": "69000", "reduceOnly": False, "stopOrderType": ""}]})
        check("orden de entrada nueva en /api/orders/open",
              wait_until(lambda: any(o["orderId"] == "ord-1" and o["entry"] and o["price"] == 69500.0
                                     for o in c.get("/api/orders/open?symbol=BTCUSDT", headers=H).json()["orders"])))
        push({"topic": "order", "data": [{"category": "linear", "symbol": "BTCUSDT", "orderId": "ord-1", "orderStatus": "Filled"}]})
        check("orden llena sale de las abiertas",
              wait_until(lambda: not c.get("/api/orders/open", headers=H).json()["orders"]))
        execution = {"category": "linear", "symbol": "BTCUSDT", "execId": "e-1", "orderId": "ord-1", "side": "Buy",
                     "execPrice": "69500", "execQty": "0.01", "execType": "Trade", "execTime": "8"}
        push({"topic": "execution", "data": [execution]})
        push({"topic": "execution", "data": [execution]})
        check("ejecucion registrada una vez aunque llegue repetida",
              wait_until(lambda: [e["execId"] for e in c.get("/api/executions/recent", headers=H).json()["executions"]] == ["e-1"]))
        check("estado del WebSocket sin claves", "secreto" not in c.get("/api/stream/status", headers=H).text
              and c.get("/api/stream/status", headers=H).json()["connected"] is True)

        # Cerrar una posicion: a mercado y reduce-only, tambien en pausa
        st.trading_paused = True
        REST["calls"].clear()
        r = c.post("/api/position/close", headers=H, json={"symbol": "btcusdt", "side": "Buy"})
        check("cerrar long: una orden Sell reduce-only por el tamano exacto, aunque el bot este en pausa",
              r.status_code == 200 and calls("market") == [("market", "BTCUSDT", "Sell", "0.01", True)], r.text)
        st.trading_paused = False
        REST["calls"].clear()
        r = c.post("/api/position/close", headers=H, json={"symbol": "BTCUSDT", "side": "Sell"})
        check("cerrar un lado sin posicion: 404 y nada sale", r.status_code == 404 and not calls("market"), r.text)
        check("lado invalido: 400", c.post("/api/position/close", headers=H, json={"symbol": "BTCUSDT", "side": "x"}).status_code == 400)
        st.account_switching = True
        r = c.post("/api/position/close", headers=H, json={"symbol": "BTCUSDT", "side": "Buy"})
        check("cerrar durante un cambio de cuenta: 409 y nada sale", r.status_code == 409 and not calls("market"), r.text)
        st.account_switching = False

        # Mover SL y TP
        REST["calls"].clear()
        bad = [({"stop_loss": 71000}, "SL de un long sobre el precio"), ({"stop_loss": 0}, "quitar el SL"),
               ({"take_profit": 70000}, "TP de un long bajo el precio"), ({}, "sin cambios"),
               ({"stop_loss": 70499.99}, "SL que al redondear toca el precio")]
        for change, name in bad:
            r = c.post("/api/position/trading-stop", headers=H, json={"symbol": "BTCUSDT", "side": "Buy", **change})
            check(f"rechazado: {name}", r.status_code == 400 and not calls("trading_stop"), r.text)
        r = c.post("/api/position/trading-stop", headers=H, json={"symbol": "BTCUSDT", "side": "Buy", "stop_loss": 69123.41, "take_profit": 72000.06})
        check("SL al tick hacia el precio (menos riesgo) y TP al tick mas cercano",
              r.status_code == 200 and calls("trading_stop") == [("trading_stop", "BTCUSDT", "Buy", "69123.5", "72000.1")], f"{r.text} {REST['calls']}")
        REST["calls"].clear()
        r = c.post("/api/position/trading-stop", headers=H, json={"symbol": "BTCUSDT", "side": "Buy", "take_profit": 0})
        check("quitar el TP manda 0 y no toca el SL", r.status_code == 200 and calls("trading_stop") == [("trading_stop", "BTCUSDT", "Buy", None, "0")], r.text)
        REST["calls"].clear()
        r = c.post("/api/position/trading-stop", headers=H, json={"symbol": "ETHUSDT", "side": "Sell", "stop_loss": 3100})
        check("mover el SL de una posicion que no existe: 404", r.status_code == 404 and not calls("trading_stop"), r.text)

        # Cancelar ordenes: solo de entrada
        REST["orders"] = [
            {"symbol": "BTCUSDT", "orderId": "ord-2", "side": "Buy", "orderType": "Limit", "price": "69000", "qty": "0.01",
             "orderStatus": "New", "reduceOnly": False, "stopOrderType": ""},
            {"symbol": "BTCUSDT", "orderId": "sl-1", "side": "Sell", "orderType": "Market", "triggerPrice": "69000", "qty": "0.01",
             "orderStatus": "Untriggered", "reduceOnly": True, "stopOrderType": "StopLoss"},
        ]
        REST["calls"].clear()
        r = c.post("/api/orders/cancel", headers=H, json={"symbol": "BTCUSDT", "order_id": "sl-1"})
        check("cancelar el SL de una posicion: 400 y nada sale", r.status_code == 400 and not calls("cancel"), r.text)
        r = c.post("/api/orders/cancel", headers=H, json={"symbol": "BTCUSDT", "order_id": "no-existe"})
        check("cancelar una orden que no esta: 404", r.status_code == 404 and not calls("cancel"), r.text)
        r = c.post("/api/orders/cancel", headers=H, json={"symbol": "BTCUSDT", "order_id": "ord-2"})
        check("cancelar una orden de entrada", r.status_code == 200 and calls("cancel") == [("cancel", "BTCUSDT", "ord-2")], r.text)
        REST["orders"].insert(0, dict(REST["orders"][0], orderId="ord-3"))
        REST["cancel_error"] = True
        r = c.post("/api/orders/cancel", headers=H, json={"symbol": "BTCUSDT", "order_id": "ord-3"})
        check("Bybit dice que ya no existe pero ya no esta abierta: se da por cancelada", r.status_code == 200, r.text)
        REST["cancel_error"] = False

        # Pagina ajena
        r = c.post("/api/position/close", headers={**H, "Origin": "https://evil.example"}, json={"symbol": "BTCUSDT", "side": "Buy"})
        check("pagina ajena no cierra posiciones: 403", r.status_code == 403)

        # Cambio de cuenta: el WebSocket pasa a la cuenta nueva
        r = c.post("/api/accounts", headers=H, json={"name": "Otra", "api_key": "clave_otra_2222", "api_secret": "secreto_otra", "demo": True})
        other = r.json()["account"]["id"]
        first_stream = st.stream
        r = c.post(f"/api/accounts/{other}/activate", headers=H)
        check("al cambiar de cuenta el WebSocket se reconecta con la clave nueva",
              r.status_code == 200 and wait_until(lambda: st.stream is not first_stream and st.stream.connected
                                                  and SERVER["auth"][-1]["args"][0] == "clave_otra_2222"), r.text)

        # Clave rechazada: no se reintenta seguido y las posiciones siguen por REST
        SERVER["reject"] = True
        c.portal.call(main.restart_stream)
        check("clave rechazada por el WebSocket: sin conexion y con el motivo",
              wait_until(lambda: st.stream.last_error and "rechazo" in st.stream.last_error and not st.stream.connected),
              str(st.stream.status()))
        d = positions(c)
        check("sin WebSocket las posiciones llegan por REST", d.get("success") and d.get("source") == "rest", str(d))
        SERVER["reject"] = False
finally:
    shutil.rmtree(TMP, ignore_errors=True)

# Guardado seguro
tmp = Path(tempfile.mkdtemp(prefix="bot_safe_io_"))
try:
    target = tmp / "estado.json"
    write_json_atomic(target, {"a": 1})
    check("guardado seguro: archivo valido y sin temporal", json.loads(target.read_text()) == {"a": 1} and not list(tmp.glob("*.tmp")))
    real_replace = os.replace

    def failing_replace(a, b):
        raise PermissionError("en uso")
    os.replace = failing_replace
    try:
        write_json_atomic(target, {"a": 2})
        failed = False
    except PermissionError:
        failed = True
    finally:
        os.replace = real_replace
    check("si no se puede reemplazar: error y el archivo anterior intacto", failed and json.loads(target.read_text()) == {"a": 1})
finally:
    shutil.rmtree(tmp, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.stdout.flush()
os._exit(1 if failed else 0)  # el WebSocket falso corre en otro hilo: se termina sin esperarlo
