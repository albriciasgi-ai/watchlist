"""
private_stream.py - La cuenta activa de Bybit en tiempo real: posiciones, ordenes y ejecuciones (WebSocket privado v5).

Pedido del usuario (12/11/2026, paso 4 de la integracion): ver en el grafico de la suite cada posicion con su P&L,
y que el journal sepa cuando y a que precio se cierra de verdad cada trade.

- Solo lee: nunca envia ordenes.
- Al conectar y cada 60 s toma una foto por REST (position/list y order/realtime con settleCoin=USDT), asi el
  estado nunca depende solo de los mensajes del WebSocket. Lo que el WebSocket cambio despues de pedir la foto
  manda sobre la foto.
- Si el WebSocket no conecta, la foto por REST sigue cada 5 s: las posiciones llegan igual, con menos prisa.
- Reconecta solo, con espera creciente (5 s a 60 s; 5 min si Bybit rechaza la clave), y tambien si pasan 60 s
  sin ningun mensaje (Bybit responde el ping de cada 20 s).
"""
import asyncio
import hashlib
import hmac
import json
import logging
import time
from collections import deque
from typing import Any, Awaitable, Callable, Dict, List, Optional

from .bybit_client import BybitClient

logger = logging.getLogger("private_stream")

WS_URLS = {
    "live": "wss://stream.bybit.com/v5/private",
    "demo": "wss://stream-demo.bybit.com/v5/private",
    "testnet": "wss://stream-testnet.bybit.com/v5/private",
}
TOPICS = ["position", "order", "execution"]
OPEN_ORDER_STATUSES = {"New", "PartiallyFilled", "Untriggered"}


def _connect():
    try:
        from websockets.asyncio.client import connect  # websockets >= 13
    except ImportError:  # pragma: no cover - version vieja
        from websockets import connect
    return connect


def _num(value) -> Optional[float]:
    try:
        f = float(value)
    except (TypeError, ValueError):
        return None
    return f if f == f else None


def _price(value) -> Optional[float]:
    """Precio de Bybit: "0" o vacio significa que no hay."""
    f = _num(value)
    return f if f and f > 0 else None


def _flag(value) -> bool:
    return value in (True, "true", "True", 1, "1")


def position_record(p: Dict[str, Any]) -> Dict[str, Any]:
    """Misma forma que /api/positions (REST trae avgPrice; el WebSocket, entryPrice)."""
    return {
        "symbol": p.get("symbol"),
        "side": p.get("side") or "",
        "size": _num(p.get("size")) or 0.0,
        "sizeRaw": p.get("size"),
        "entryPrice": p.get("avgPrice") or p.get("entryPrice"),
        "markPrice": p.get("markPrice"),
        "unrealizedPnl": p.get("unrealisedPnl"),
        "leverage": p.get("leverage"),
        "liqPrice": _price(p.get("liqPrice")),
        "positionValue": p.get("positionValue"),
        "stopLoss": _price(p.get("stopLoss")),
        "takeProfit": _price(p.get("takeProfit")),
        "trailingStop": _price(p.get("trailingStop")),
        "positionIdx": p.get("positionIdx"),
        "tpslMode": p.get("tpslMode"),
        "createdTime": p.get("createdTime"),
        "updatedTime": p.get("updatedTime"),
    }


def order_record(o: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "orderId": o.get("orderId"),
        "orderLinkId": o.get("orderLinkId"),
        "symbol": o.get("symbol"),
        "side": o.get("side"),
        "orderType": o.get("orderType"),
        "orderStatus": o.get("orderStatus"),
        "price": _price(o.get("price")),
        "triggerPrice": _price(o.get("triggerPrice")),
        "qty": _num(o.get("qty")),
        "leavesQty": _num(o.get("leavesQty")),
        "takeProfit": _price(o.get("takeProfit")),
        "stopLoss": _price(o.get("stopLoss")),
        "stopOrderType": o.get("stopOrderType") or "",
        "reduceOnly": _flag(o.get("reduceOnly")),
        "closeOnTrigger": _flag(o.get("closeOnTrigger")),
        "positionIdx": o.get("positionIdx"),
        "createdTime": o.get("createdTime"),
        "updatedTime": o.get("updatedTime"),
        "entry": BybitClient.is_entry_order(o),  # abre o aumenta posicion (no es TP/SL ni reduce-only)
    }


def execution_record(e: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "execId": e.get("execId"),
        "orderId": e.get("orderId"),
        "orderLinkId": e.get("orderLinkId"),
        "symbol": e.get("symbol"),
        "side": e.get("side"),
        "execType": e.get("execType"),
        "execPrice": _num(e.get("execPrice")),
        "execQty": _num(e.get("execQty")),
        "execFee": _num(e.get("execFee")),
        "closedSize": _num(e.get("closedSize")),
        "execPnl": _num(e.get("execPnl")),
        "orderType": e.get("orderType"),
        "stopOrderType": e.get("stopOrderType") or "",
        "isMaker": _flag(e.get("isMaker")),
        "execTime": e.get("execTime"),
    }


class AuthRejected(RuntimeError):
    """Bybit rechazo la clave: no tiene sentido reintentar seguido."""


class PrivateStream:
    def __init__(self, client, on_event: Optional[Callable[[str, Any], Awaitable[Any]]] = None,
                 ws_url: Optional[str] = None, snapshot_every: float = 60.0, fallback_every: float = 5.0):
        self.client = client
        self.ws_url = ws_url or WS_URLS.get(getattr(client, "mode", "live"), WS_URLS["live"])
        self.on_event = on_event
        self.snapshot_every = snapshot_every
        self.fallback_every = fallback_every
        self.positions: Dict[str, Dict[str, Any]] = {}  # "SYMBOL:positionIdx" -> posicion abierta
        self.orders: Dict[str, Dict[str, Any]] = {}     # orderId -> orden abierta
        self.executions: deque = deque(maxlen=500)
        self._exec_ids: deque = deque(maxlen=2000)
        self._touched: Dict[str, float] = {}            # clave -> ultima vez que el WebSocket la cambio (monotonic)
        self.connected = False   # WebSocket autenticado y suscrito
        self.ready = False       # hay al menos una foto por REST
        self.last_message_at: Optional[float] = None
        self.last_snapshot_at: Optional[float] = None
        self.last_error: Optional[str] = None
        self.reconnects = 0
        self._task: Optional[asyncio.Task] = None
        self._stopped = False
        self._snapshot_lock = asyncio.Lock()

    # ---------- ciclo ----------
    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.get_running_loop().create_task(self._run())

    async def stop(self) -> None:
        self._stopped = True
        task, self._task = self._task, None
        if task:
            task.cancel()
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self.connected = False

    async def _run(self) -> None:
        backoff = 5.0
        while not self._stopped:
            if not self.last_snapshot_at or time.time() - self.last_snapshot_at > 2:
                await self.snapshot()
            wait = backoff
            try:
                await self._listen()
                backoff = 5.0
            except asyncio.CancelledError:
                raise
            except AuthRejected as e:
                self.last_error = str(e)
                wait = 300.0
                logger.warning(f"[STREAM] {e}: se reintenta en 5 minutos")
            except Exception as e:
                self.last_error = f"{type(e).__name__}: {e}"
                logger.warning(f"[STREAM] WebSocket privado sin conexion: {self.last_error}")
            self.connected = False
            if self._stopped:
                break
            self.reconnects += 1
            # Mientras no hay WebSocket, la foto por REST sigue cada pocos segundos
            deadline = time.monotonic() + wait
            while not self._stopped and time.monotonic() < deadline:
                await asyncio.sleep(max(0.05, min(self.fallback_every, deadline - time.monotonic())))
                await self.snapshot()
            backoff = min(backoff * 2, 60.0)

    async def _listen(self) -> None:
        connect = _connect()
        async with connect(self.ws_url, ping_interval=None, open_timeout=10, close_timeout=2) as ws:
            now_ms = self.client._get_timestamp() if hasattr(self.client, "_get_timestamp") else int(time.time() * 1000)
            expires = int(now_ms) + 10000
            signature = hmac.new(self.client.api_secret.encode("utf-8"), f"GET/realtime{expires}".encode("utf-8"),
                                 hashlib.sha256).hexdigest()
            await ws.send(json.dumps({"op": "auth", "args": [self.client.api_key, expires, signature]}))
            reply: Dict[str, Any] = {}
            for _ in range(3):
                reply = json.loads(await asyncio.wait_for(ws.recv(), 10))
                if reply.get("op") == "auth":
                    break
            if reply.get("op") != "auth" or not reply.get("success"):
                raise AuthRejected(f"Bybit rechazo la autenticacion del WebSocket: {reply.get('ret_msg') or reply}")
            await ws.send(json.dumps({"op": "subscribe", "args": TOPICS}))
            self.connected = True
            self.last_error = None
            self.last_message_at = time.time()
            logger.info(f"[STREAM] WebSocket privado conectado ({self.ws_url})")
            await self.snapshot()  # lo que paso entre la foto anterior y la suscripcion
            last_ping = last_snap = time.monotonic()
            while not self._stopped:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=5)
                except asyncio.TimeoutError:
                    raw = None
                if raw is not None:
                    self.last_message_at = time.time()
                    try:
                        await self.handle(json.loads(raw))
                    except Exception as e:  # un mensaje raro no corta la conexion
                        logger.warning(f"[STREAM] Mensaje que no se pudo leer: {e}")
                now = time.monotonic()
                if now - last_ping >= 20:
                    await ws.send(json.dumps({"op": "ping"}))
                    last_ping = now
                if now - last_snap >= self.snapshot_every:
                    await self.snapshot()
                    last_snap = now
                if time.time() - self.last_message_at > 60:
                    raise RuntimeError("60 s sin mensajes de Bybit")

    # ---------- mensajes ----------
    async def handle(self, msg: Dict[str, Any]) -> None:
        topic = msg.get("topic") or ""
        if not topic:
            if msg.get("op") == "subscribe" and msg.get("success") is False:
                self.last_error = f"suscripcion rechazada: {msg.get('ret_msg')}"
                logger.warning(f"[STREAM] {self.last_error}")
            return
        data = msg.get("data") or []
        if isinstance(data, dict):
            data = [data]
        rows = [d for d in data if isinstance(d, dict) and (d.get("category") or "linear") == "linear"]
        if topic.startswith("position"):
            for p in rows:
                self._put_position(p)
            await self._emit("position_update", self.position_list())
        elif topic.startswith("order"):
            for o in rows:
                self._put_order(o)
            await self._emit("order_update", self.order_list())
        elif topic.startswith("execution"):
            new = []
            for e in rows:
                exec_id = e.get("execId")
                if exec_id and exec_id in self._exec_ids:
                    continue
                self._exec_ids.append(exec_id)
                record = execution_record(e)
                self.executions.append(record)
                new.append(record)
            if new:
                await self._emit("execution", new)

    @staticmethod
    def _position_key(p: Dict[str, Any]) -> str:
        return f"{p.get('symbol')}:{p.get('positionIdx', 0)}"

    def _put_position(self, p: Dict[str, Any]) -> None:
        key = self._position_key(p)
        record = position_record(p)
        self._touched["p:" + key] = time.monotonic()
        if record["size"] > 0 and record["side"]:
            self.positions[key] = record
        else:
            self.positions.pop(key, None)

    def _put_order(self, o: Dict[str, Any]) -> None:
        order_id = o.get("orderId")
        if not order_id:
            return
        self._touched["o:" + order_id] = time.monotonic()
        if o.get("orderStatus") in OPEN_ORDER_STATUSES:
            self.orders[order_id] = order_record(o)
        else:
            self.orders.pop(order_id, None)

    async def _emit(self, kind: str, data: Any) -> None:
        if self.on_event:
            try:
                await self.on_event(kind, data)
            except Exception as e:
                logger.warning(f"[STREAM] No se pudo avisar {kind}: {e}")

    # ---------- foto por REST ----------
    async def _pages(self, endpoint: str, params: Dict[str, Any], max_pages: int = 5) -> Optional[List[Dict[str, Any]]]:
        rows: List[Dict[str, Any]] = []
        cursor = None
        for _ in range(max_pages):
            query = dict(params)
            if cursor:
                query["cursor"] = cursor
            result = await self.client._make_request("GET", endpoint, query)
            if result.get("retCode") != 0:
                self.last_error = f"{endpoint}: {result.get('retMsg')} (retCode={result.get('retCode')})"
                return None
            body = result.get("result") or {}
            rows.extend(body.get("list") or [])
            cursor = body.get("nextPageCursor")
            if not cursor:
                break
        return rows

    def _merge(self, snap: Dict[str, Any], current: Dict[str, Any], prefix: str, started: float) -> Dict[str, Any]:
        """Lo que el WebSocket cambio despues de pedir la foto manda (tambien si lo quito)."""
        merged = {}
        for key in set(snap) | set(current):
            if self._touched.get(prefix + key, 0) > started:
                if key in current:
                    merged[key] = current[key]
            elif key in snap:
                merged[key] = snap[key]
        return merged

    async def snapshot(self) -> bool:
        async with self._snapshot_lock:
            started = time.monotonic()
            try:
                positions = await self._pages("/v5/position/list", {"category": "linear", "settleCoin": "USDT", "limit": 200})
                orders = await self._pages("/v5/order/realtime", {"category": "linear", "settleCoin": "USDT", "limit": 50})
            except Exception as e:
                self.last_error = f"foto por REST: {type(e).__name__}: {e}"
                return False
            if positions is None or orders is None:
                return False
            snap_pos = {}
            for p in positions:
                record = position_record(p)
                if record["size"] > 0 and record["side"]:
                    snap_pos[self._position_key(p)] = record
            snap_orders = {o["orderId"]: order_record(o) for o in orders
                           if o.get("orderId") and o.get("orderStatus") in OPEN_ORDER_STATUSES}
            new_pos = self._merge(snap_pos, self.positions, "p:", started)
            new_orders = self._merge(snap_orders, self.orders, "o:", started)
            pos_changed, orders_changed = new_pos != self.positions, new_orders != self.orders
            self.positions, self.orders = new_pos, new_orders
            self.ready = True
            self.last_snapshot_at = time.time()
            cutoff = time.monotonic() - 600
            self._touched = {k: t for k, t in self._touched.items() if t > cutoff}
        if pos_changed:
            await self._emit("position_update", self.position_list())
        if orders_changed:
            await self._emit("order_update", self.order_list())
        return True

    # ---------- lectura ----------
    def fresh(self, max_age: float = 15.0) -> bool:
        """Al dia: WebSocket conectado, o una foto de hace menos de max_age segundos."""
        return self.ready and (self.connected or (self.last_snapshot_at is not None and time.time() - self.last_snapshot_at < max_age))

    def position_list(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        return [p for p in self.positions.values() if not symbol or p["symbol"] == symbol]

    def order_list(self, symbol: Optional[str] = None) -> List[Dict[str, Any]]:
        return [o for o in self.orders.values() if not symbol or o["symbol"] == symbol]

    def status(self) -> Dict[str, Any]:
        return {
            "connected": self.connected,
            "ready": self.ready,
            "url": self.ws_url,
            "last_message_at": self.last_message_at,
            "last_snapshot_at": self.last_snapshot_at,
            "last_error": self.last_error,
            "reconnects": self.reconnects,
            "positions": len(self.positions),
            "orders": len(self.orders),
            "executions": len(self.executions),
        }
