# mobile_gate.py - Puerta movil de la suite (21/11/2026): lo unico que ve el celular.
#
# Es otra aplicacion, en su propio puerto (mobile_port, 13002 de fabrica) y en la direccion que se configure
# (mobile_host: la IP de Tailscale del PC). Apagada de fabrica: sin mobile_host no escucha en ningun lado.
# El servidor de la suite (13000) y el bot (5000) siguen cerrados en 127.0.0.1.
#
# Todo pedido va firmado por un celular emparejado (mobile_devices.py). Fase 1, solo lectura:
#   GET  /m/hello            quien soy y la hora del servidor (activa el emparejamiento)
#   GET  /m/overview         estado del bot, cuenta activa, posiciones abiertas y P&L sin realizar
#   GET  /m/positions        posiciones abiertas (del WebSocket privado del bot)
#   GET  /m/trades?days      trades del journal con su decision y sus imagenes
#   GET  /m/image/{s}/{f}    una imagen del journal (decision, apertura, cierre, 10 velas despues)
#   GET  /m/events?after     eventos del vigilante (lo que se aviso)
#   POST /m/push-token       el token de avisos de este celular ({"token": ...}; null lo quita)
# No hay rutas de claves, configuracion ni ordenes. Cerrar una posicion llegara en la fase 3.
#
# En el servidor de la suite (solo este PC), make_local_router() da el estado, el emparejamiento y la revocacion.
import asyncio
import json
import socket
from contextlib import contextmanager
from typing import Any, Awaitable, Callable, Dict, Optional

from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse

from mobile_devices import AuthError, DeviceStore, DEVICE_RE, now_ms

MAX_BODY = 16 * 1024
BROKER = "bybit"  # cada posicion y cada trade lo llevan: cuando exista el trading de Alpaca entra por la misma puerta


def _num(value) -> float:
    try:
        v = float(value)
        return v if v == v else 0.0
    except (TypeError, ValueError):
        return 0.0


def make_app(devices: DeviceStore, events, bot: Callable[..., Awaitable[Any]], journal_store=None, version: str = "") -> FastAPI:
    app = FastAPI(title="Altagracia - puerta movil", docs_url=None, redoc_url=None, openapi_url=None)

    @app.exception_handler(AuthError)
    async def _auth_error(request: Request, exc: AuthError):
        body = {"success": False, "error": exc.detail}
        if exc.now is not None:
            body["now"] = exc.now
        return JSONResponse(body, status_code=exc.status)

    # La app corre en una pagina local del celular (Capacitor: https://localhost) o, en desarrollo, en localhost.
    # No es una barrera de seguridad (no hay cookies: cada pedido va firmado); solo deja que esas paginas lean
    app.add_middleware(CORSMiddleware, allow_origin_regex=r"^(https?|capacitor)://(localhost|127\.0\.0\.1)(:\d+)?$",
                       allow_methods=["GET", "POST"], allow_headers=["X-Device", "X-Time", "X-Nonce", "X-Sign", "Content-Type"],
                       max_age=600)

    async def device(request: Request) -> Dict[str, Any]:
        length = request.headers.get("content-length")
        if length and (not length.isdigit() or int(length) > MAX_BODY):
            raise AuthError(413, "cuerpo demasiado grande")
        body = await request.body()
        if len(body) > MAX_BODY:
            raise AuthError(413, "cuerpo demasiado grande")
        target = request.url.path + (f"?{request.url.query}" if request.url.query else "")
        peer = request.client.host if request.client else ""
        return devices.verify(request.headers, request.method, target, body, peer)

    r = APIRouter(prefix="/m", dependencies=[Depends(device)])

    @r.get("/hello")
    async def hello(dev=Depends(device)):
        return {"success": True, "device": dev["name"], "now": now_ms(), "version": version, "brokers": [BROKER],
                "can": {"close_position": False}}

    async def _positions():
        data = await bot("GET", "/api/positions", params={"all": "true"})
        if not isinstance(data, dict) or data.get("success") is False:
            raise HTTPException(status_code=503, detail=(data or {}).get("error") or "el bot no dio las posiciones")
        return [{**p, "broker": BROKER} for p in data.get("positions") or []], data

    @r.get("/overview")
    async def overview():
        status = await bot("GET", "/api/status")
        try:
            positions, raw = await _positions()
            error = None
        except HTTPException as e:
            positions, raw, error = [], {}, e.detail
        account = status.get("account")
        return {"success": True, "now": now_ms(),
                "bot": {"online": True, "mode": status.get("mode"), "account": account, "trading_paused": status.get("trading_paused"),
                        "credentials": status.get("credentials_configured")},
                "positions": {"count": len(positions), "error": error, "source": raw.get("source"),
                              "unrealized_pnl": round(sum(_num(p.get("unrealizedPnl")) for p in positions), 4),
                              "without_stop": sum(1 for p in positions if not _num(p.get("stopLoss")))},
                "watch": {k: events.status()[k] for k in ("last_ok", "bot_down")} if events else None}

    @r.get("/positions")
    async def positions():
        items, raw = await _positions()
        return {"success": True, "now": now_ms(), "positions": items, "account": raw.get("account"), "source": raw.get("source")}

    @r.get("/trades")
    async def trades(days: int = 30):
        data = await bot("GET", "/api/journal/trades", params={"days": max(1, min(days, 365))})
        items = data.get("trades") or [] if isinstance(data, dict) else []
        if journal_store is not None:
            journal_store.merge(items)
        for t in items:
            t["broker"] = BROKER
        return {"success": True, "now": now_ms(), "trades": items}

    @r.get("/image/{session}/{filename}")
    async def image(session: str, filename: str):
        path = journal_store.image_path(session, filename) if journal_store is not None else None
        if path is None:
            raise HTTPException(status_code=404, detail="imagen no encontrada")
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "private, max-age=86400"})

    @r.get("/events")
    async def event_list(after: Optional[str] = None, limit: int = 100):
        if after is not None and (len(after) > 40 or not after.replace("-", "").isdigit()):
            raise HTTPException(status_code=400, detail="after invalido")
        return {"success": True, "now": now_ms(), "events": events.since(after, limit) if events else []}

    @r.post("/push-token")
    async def push_token(request: Request, dev=Depends(device)):
        try:
            body = json.loads(await request.body() or b"{}")
            token = body.get("token") if isinstance(body, dict) else 0
            if token is not None and not isinstance(token, str):
                raise ValueError("token invalido")
            devices.set_push_token(dev["id"], token)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e) if "token" in str(e) else "cuerpo JSON invalido")
        return {"success": True, "push": token is not None}

    app.include_router(r)
    return app


def make_local_router(devices: DeviceStore, gate: "Gate", events=None) -> APIRouter:
    """Rutas del servidor de la suite (solo este PC, las protegen su Host y su Origin)."""
    r = APIRouter(prefix="/api/mobile")

    async def _body(request: Request, word: str) -> dict:
        try:
            body = await request.json()
        except Exception:
            raise HTTPException(status_code=400, detail="cuerpo JSON invalido")
        if not isinstance(body, dict) or body.get("confirm") != word:
            raise HTTPException(status_code=400, detail=f'se necesita "confirm": "{word}"')
        return body

    def _devices():
        try:
            return devices.public()
        except AuthError as e:
            raise HTTPException(status_code=e.status, detail=e.detail)

    @r.get("/status")
    async def status():
        return {"success": True, "gate": gate.status(), "devices": _devices(), "watch": events.status() if events else None}

    @r.post("/pair")
    async def pair(request: Request):
        """Crea un celular pendiente. Responde su secreto UNA sola vez, para el QR; despues ya no se puede leer."""
        body = await _body(request, "EMPAREJAR_CELULAR")
        if not gate.host:
            raise HTTPException(status_code=409, detail="la puerta movil esta apagada: falta mobile_host en config/suite.json")
        try:
            d = devices.pair(str(body.get("name") or ""))
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except AuthError as e:
            raise HTTPException(status_code=e.status, detail=e.detail)
        qr = {"v": 1, "host": gate.host, "port": gate.port, "id": d["id"], "secret": d["secret"], "name": d["name"]}
        return {"success": True, "device": {"id": d["id"], "name": d["name"], "expires_at": d["expires_at"]}, "qr": qr}

    @r.post("/devices/{device_id}/revoke")
    async def revoke(device_id: str, request: Request):
        await _body(request, "REVOCAR_CELULAR")
        if not DEVICE_RE.match(device_id):
            raise HTTPException(status_code=400, detail="dispositivo invalido")
        try:
            found = devices.revoke(device_id)
        except AuthError as e:
            raise HTTPException(status_code=e.status, detail=e.detail)
        if not found:
            raise HTTPException(status_code=404, detail="ese celular no esta emparejado")
        return {"success": True, "devices": _devices()}

    @r.post("/test-push")
    async def test_push(request: Request):
        """Un aviso de prueba a los celulares emparejados, para comprobar Firebase."""
        await _body(request, "ENVIAR_AVISO_PRUEBA")
        if not events or not events.sender:
            raise HTTPException(status_code=409, detail="el vigilante no esta corriendo")
        tokens = devices.push_tokens()
        if not tokens:
            raise HTTPException(status_code=409, detail="ningun celular emparejado tiene avisos activos")
        if not events.sender.ready():
            raise HTTPException(status_code=409, detail=events.sender.error)
        event = {"id": f"{now_ms()}-test", "type": "test", "title": "Aviso de prueba", "body": "Los avisos de la suite llegan a este celular."}
        dead = await events.sender.send(tokens, event)
        for token in dead:
            devices.drop_push_token(token)
        return {"success": True, "tokens": len(tokens), "dropped": len(dead), "push": events.sender.status()}

    return r


class Gate:
    """Levanta la puerta en su propio puerto, dentro del proceso del servidor. Si la direccion todavia no existe
    (Tailscale sin conectar), reintenta cada 30 s sin frenar ni tumbar la suite."""
    RETRY_SECONDS = 30

    def __init__(self, app: FastAPI, host: str, port: int):
        self.app, self.host, self.port = app, (host or "").strip(), int(port)
        self._task: Optional[asyncio.Task] = None
        self._server = None
        self.listening = False
        self.error: Optional[str] = None

    def status(self) -> Dict[str, Any]:
        return {"enabled": bool(self.host), "host": self.host or None, "port": self.port, "listening": self.listening, "error": self.error}

    def start(self) -> None:
        if self.host and self._task is None:
            self._task = asyncio.create_task(self._run())

    async def _run(self) -> None:
        import uvicorn

        class _Server(uvicorn.Server):
            # Las senales (Ctrl+C) son del servidor principal: este se detiene con stop()
            def install_signal_handlers(self) -> None:
                pass

            @contextmanager
            def capture_signals(self):
                yield

        while True:
            sock = None
            try:
                # Se abre aqui el puerto: si uvicorn no puede abrirlo llama a sys.exit, que tumbaria la suite
                family = socket.AF_INET6 if ":" in self.host else socket.AF_INET
                sock = socket.socket(family, socket.SOCK_STREAM)
                sock.bind((self.host, self.port))
                sock.set_inheritable(True)
            except OSError as e:
                if sock:
                    sock.close()
                self.listening, self.error = False, f"no se pudo abrir {self.host}:{self.port} ({e.strerror or e})"
                await asyncio.sleep(self.RETRY_SECONDS)
                continue
            self._server = _Server(uvicorn.Config(self.app, log_level="warning", access_log=False, server_header=False))
            self.listening, self.error = True, None
            print(f"[MOVIL] Puerta movil en http://{self.host}:{self.port}")
            try:
                await self._server.serve(sockets=[sock])
            finally:
                self.listening = False
                sock.close()
            if self._server.should_exit:
                return
            await asyncio.sleep(self.RETRY_SECONDS)

    async def stop(self) -> None:
        if self._server:
            self._server.should_exit = True
        if self._task and not self.listening:
            self._task.cancel()  # estaba esperando para reintentar
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=5)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
            self._task = None
