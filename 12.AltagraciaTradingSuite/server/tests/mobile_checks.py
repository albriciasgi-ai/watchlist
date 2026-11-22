# Pruebas sin conexion de la puerta movil: celulares emparejados y firmas, rutas de solo lectura, vigilante de
# eventos y avisos. El bot real, Bybit y Firebase nunca reciben nada: los reemplazan fake_bot y FakeSender.
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\mobile_checks.py
import asyncio
import json
import secrets
import shutil
import socket
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="suite_mobile_checks_"))

import httpx  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import mobile_devices  # noqa: E402
import mobile_events  # noqa: E402
import mobile_gate  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


class Clock:
    def __init__(self):
        self.t = int(time.time() * 1000)

    def __call__(self):
        return self.t


clock = Clock()
MIN = 60_000


def signed(dev, method, target, body=b"", *, at=None, nonce=None, secret=None):
    at = str(at if at is not None else clock())
    nonce = nonce or secrets.token_urlsafe(16)
    return {"X-Device": dev["id"], "X-Time": at, "X-Nonce": nonce,
            "X-Sign": mobile_devices.signature(secret or dev["secret"], method, target, at, nonce, body)}


# ---------- bot falso ----------
bot = {"down": False, "paused": False, "trades": [], "alerts": [], "positions": [], "calls": []}


async def fake_bot(method, path, **kw):
    bot["calls"].append((method, path))
    if bot["down"]:
        raise HTTPException(status_code=503, detail="bot no disponible")
    if path == "/api/status":
        return {"status": "online", "mode": "DEMO", "account": {"name": "Demo"}, "trading_paused": bot["paused"], "credentials_configured": True}
    if path == "/api/journal/trades":
        return {"success": True, "trades": [dict(t) for t in bot["trades"]]}
    if path == "/api/alerts/critical":
        return {"success": True, "alerts": list(bot["alerts"])}
    if path == "/api/positions":
        return {"success": True, "positions": list(bot["positions"]), "source": "stream", "account": {"name": "Demo"}}
    raise HTTPException(status_code=404, detail="ruta desconocida")


def trade(tid, status="open", **kw):
    base = {"trade_id": tid, "symbol": "BTCUSDT", "side": "Buy", "entry": 70000.0, "stop_loss": 69000.0, "take_profit": 72000.0,
            "opened_at": clock() - 5000, "status": status, "origin": "WATCHLIST", "pattern": "SWING_DETECTOR", "account": "Demo",
            "mode": "DEMO", "pre_existing": False, "pnl": None, "r": None, "closed_at": None, "exit": None}
    base.update(kw)
    return base


class FakeSender:
    def __init__(self):
        self.sent, self.dead = [], set()

    def ready(self):
        return True

    def status(self):
        return {"configured": True}

    async def send(self, tokens, event):
        self.sent.append((list(tokens), event["type"], event["title"]))
        return [t for t in tokens if t in self.dead]


class FakeJournal:
    def __init__(self, folder):
        self.folder = folder

    def merge(self, trades):
        for t in trades:
            t["images"] = [{"kind": "open", "image": "s1/img_1.png"}]
        return trades

    def image_path(self, session, filename):
        p = self.folder / session / filename
        return p if p.is_file() and ".." not in filename else None


try:
    # ================= dispositivos y firmas =================
    devices = mobile_devices.DeviceStore(TMP / "a", clock=clock)
    dev = devices.pair("Pixel de prueba")
    check("emparejar crea un dispositivo pendiente con su secreto", len(dev["secret"]) == 64 and dev["activated_at"] is None)
    check("la lista del PC no trae secretos ni tokens",
          all("secret" not in d and "push_token" not in d for d in devices.public()) and devices.public()[0]["expires_at"])
    check("el archivo se guarda con temporal y reemplazo", (TMP / "a" / "devices.json").exists() and not (TMP / "a" / "devices.json.tmp").exists())
    for bad_name in ("", " ", "x" * 41):
        try:
            devices.pair(bad_name)
            check(f"nombre invalido rechazado ({len(bad_name)})", False)
        except ValueError:
            check(f"nombre invalido rechazado ({len(bad_name)})", True)

    def verify(headers, method="GET", target="/m/hello", body=b"", store=None, peer="p"):
        try:
            return (store or devices).verify({k.lower(): v for k, v in headers.items()}, method, target, body, peer)
        except mobile_devices.AuthError as e:
            return e

    ok = verify(signed(dev, "GET", "/m/hello"))
    check("pedido bien firmado: entra y activa el emparejamiento", isinstance(ok, dict) and ok["first"] and devices.public()[0]["activated_at"])
    h = signed(dev, "GET", "/m/hello")
    check("el mismo pedido dos veces: la segunda no entra", isinstance(verify(h), dict) and getattr(verify(h), "status", 0) == 401)
    check("sin cabeceras: 401", getattr(verify({}), "status", 0) == 401)
    check("secreto equivocado: 401", getattr(verify(signed(dev, "GET", "/m/hello", secret="ab" * 32)), "status", 0) == 401)
    check("firma de otra ruta: 401", getattr(verify(signed(dev, "GET", "/m/positions")), "status", 0) == 401)
    check("firma de otro metodo: 401", getattr(verify(signed(dev, "POST", "/m/hello")), "status", 0) == 401)
    check("cuerpo cambiado: 401", getattr(verify(signed(dev, "POST", "/m/push-token", b'{"token":"a"}'), "POST", "/m/push-token", b'{"token":"b"}'), "status", 0) == 401)
    check("hora de hace 2 minutos: 401", getattr(verify(signed(dev, "GET", "/m/hello", at=clock() - 2 * MIN)), "status", 0) == 401)
    check("hora 2 minutos adelantada: 401", getattr(verify(signed(dev, "GET", "/m/hello", at=clock() + 2 * MIN)), "status", 0) == 401)
    check("dispositivo desconocido: 401", getattr(verify(signed({"id": "0123456789ab", "secret": dev["secret"]}, "GET", "/m/hello")), "status", 0) == 401)
    check("nonce corto: 401", getattr(verify(signed(dev, "GET", "/m/hello", nonce="abc")), "status", 0) == 401)
    skew = verify(signed(dev, "GET", "/m/hello", at=clock() - 10 * MIN))
    check("reloj corrido con firma buena: 401 con la hora del servidor, para que la app corrija", skew.status == 401 and skew.now == clock())
    check("firma mala: nunca dice la hora del servidor", verify(signed(dev, "GET", "/m/hello", at=clock() - 10 * MIN, secret="cd" * 32)).now is None)
    # 8 firmas malas arriba desde "p" (el reloj corrido de un celular emparejado no cuenta): con dos mas son 10
    verify({})
    verify({})
    check("diez firmas malas en un minuto: 429 tambien con firma buena", getattr(verify(signed(dev, "GET", "/m/hello")), "status", 0) == 429)
    check("otra direccion no queda bloqueada", isinstance(verify(signed(dev, "GET", "/m/hello"), peer="q"), dict))
    clock.t += 61_000
    check("pasado el minuto vuelve a entrar", isinstance(verify(signed(dev, "GET", "/m/hello")), dict))

    late = devices.pair("Tarde")
    clock.t += mobile_devices.PAIR_SECONDS * 1000 + 1
    check("emparejamiento vencido sin usar: 401", getattr(verify(signed(late, "GET", "/m/hello"), peer="r"), "status", 0) == 401)
    check("y sale de la lista; el activo sigue", [d["name"] for d in devices.public()] == ["Pixel de prueba"])

    again = mobile_devices.DeviceStore(TMP / "a", clock=clock)
    check("tras reiniciar, el celular activo sigue entrando", isinstance(verify(signed(dev, "GET", "/m/hello"), store=again, peer="s"), dict))

    token = "f" * 40 + ":APA91b-token_de.prueba"
    devices.set_push_token(dev["id"], token)
    other = devices.pair("Otro")
    verify(signed(other, "GET", "/m/hello"), peer="t")
    check("tokens de avisos: solo de celulares activos", devices.push_tokens() == [token])
    devices.set_push_token(other["id"], token)
    check("el mismo token en otro emparejamiento: queda en uno solo", devices.push_tokens() == [token]
          and [d["push"] for d in devices.public()] == [False, True])
    try:
        devices.set_push_token(dev["id"], "corto")
        check("token de avisos invalido rechazado", False)
    except ValueError:
        check("token de avisos invalido rechazado", True)
    devices.drop_push_token(token)
    check("token que Firebase ya no reconoce: se quita", devices.push_tokens() == [])
    check("revocar: sale y deja de entrar", devices.revoke(other["id"]) and not devices.revoke(other["id"])
          and getattr(verify(signed(other, "GET", "/m/hello"), peer="u"), "status", 0) == 401)

    (TMP / "bad").mkdir()
    (TMP / "bad" / "devices.json").write_text("{roto", encoding="utf-8")
    broken = mobile_devices.DeviceStore(TMP / "bad", clock=clock)
    check("archivo de dispositivos danado: nadie entra (503) y no se pisa",
          getattr(verify(signed(dev, "GET", "/m/hello"), store=broken), "status", 0) == 503
          and (TMP / "bad" / "devices.json").read_text(encoding="utf-8") == "{roto")

    # ================= vigilante de eventos =================
    sender = FakeSender()
    watch = mobile_events.EventWatch(TMP / "w", fake_bot, devices, sender=sender, clock=clock)
    devices.set_push_token(dev["id"], token)

    def poll(w=None):
        w = w or watch
        events = asyncio.run(w.poll())
        asyncio.run(w.deliver(events))
        return events

    bot["trades"] = [trade("OLD-1"), trade("OLD-2", status="closed", pnl=5.0, closed_at=clock() - 1000)]
    bot["alerts"] = [{"type": "POSITION_WITHOUT_SL", "symbol": "XRPUSDT", "message": "vieja"}]
    check("primera vuelta: linea de base, nada se avisa", poll() == [] and not sender.sent and watch.status()["baseline"])
    check("sin cambios: sin eventos", poll() == [])

    bot["trades"].append(trade("BTC-1"))
    ev = poll()
    check("trade nuevo: un evento de apertura con su aviso", len(ev) == 1 and ev[0]["type"] == "trade_open" and ev[0]["push"]
          and ev[0]["trade_id"] == "BTC-1" and ev[0]["broker"] == "bybit", str(ev))
    check("el aviso dice lado, moneda, entrada, SL, TP y origen", ev[0]["title"] == "Abierta: Long BTCUSDT"
          and all(x in ev[0]["body"] for x in ("70,000.00", "SL 69,000.00", "TP 72,000.00", "WATCHLIST", "Demo")), ev[0]["body"])
    check("salio un aviso al celular", sender.sent == [([token], "trade_open", "Abierta: Long BTCUSDT")])
    check("la misma apertura no se repite", poll() == [])

    bot["trades"][-1].update(status="closed", pnl=-12.5, r=-1.04, closed_at=clock(), exit=69010.0)
    ev = poll()
    check("cierre: evento con P&L y R", len(ev) == 1 and ev[0]["type"] == "trade_close" and ev[0]["pnl"] == -12.5 and ev[0]["r"] == -1.04
          and "-12.50 USD" in ev[0]["body"] and "-1.04 R" in ev[0]["body"], str(ev))

    bot["trades"].append(trade("ETH-1", symbol="ETHUSDT", side="Sell", stop_loss=None, take_profit=None, entry=0.14702))
    ev = poll()
    check("short sin stop: el aviso lo dice, y el precio barato conserva sus decimales",
          ev[0]["title"] == "Abierta: Short ETHUSDT" and "SIN STOP" in ev[0]["body"] and "0.14702" in ev[0]["body"], ev[0]["body"])

    bot["trades"].append(trade("LATE-1", opened_at=clock() - 40 * MIN))
    ev = poll()
    check("apertura vista 40 minutos tarde: se anota sin aviso", len(ev) == 1 and ev[0]["push"] is False and len(sender.sent) == 3, str(sender.sent))

    bot["trades"].append(trade("PRE-1", pre_existing=True))
    check("posicion que ya estaba abierta antes del journal: sin evento de apertura", poll() == [])
    bot["trades"].append(trade("close:abc", status="closed", pre_existing=True, opened_at=None, pnl=3.0, closed_at=clock()))
    ev = poll()
    check("cierre sin apertura anotada: solo el evento de cierre", [e["type"] for e in ev] == ["trade_close"])
    bot["trades"].append(trade("FAST-1", status="closed", pnl=1.0, r=0.5, closed_at=clock()))
    check("abierto y cerrado entre dos vueltas: los dos eventos, en orden", [e["type"] for e in poll()] == ["trade_open", "trade_close"])

    bot["alerts"].append({"type": "POSITION_WITHOUT_SL", "symbol": "SOLUSDT", "message": "SOLUSDT sin stop loss", "severity": "CRITICAL"})
    ev = poll()
    check("aviso critico nuevo: un evento, y el viejo no", len(ev) == 1 and ev[0]["type"] == "critical" and "SOLUSDT" in ev[0]["title"]
          and ev[0]["body"] == "SOLUSDT sin stop loss")
    check("el aviso critico no se repite", poll() == [])

    bot["paused"] = True
    check("pausa: evento", [e["type"] for e in poll()] == ["paused"])
    bot["paused"] = False
    check("reanudacion: evento", [e["type"] for e in poll()] == ["resumed"])

    bot["down"] = True
    quiet = [poll() for _ in range(mobile_events.DOWN_AFTER - 1)]
    check("bot sin responder menos de 30 s: nada", all(q == [] for q in quiet))
    check("a los 30 s: aviso de que el bot no responde, una vez", [e["type"] for e in poll()] == ["bot_down"] and poll() == [])
    bot["down"] = False
    bot["trades"].append(trade("SOL-1", symbol="SOLUSDT"))
    check("al volver: aviso y lo que paso mientras tanto", [e["type"] for e in poll()] == ["bot_up", "trade_open"])

    n_events = len(watch.events)
    restarted = mobile_events.EventWatch(TMP / "w", fake_bot, devices, sender=sender, clock=clock)
    check("tras reiniciar: los eventos siguen y nada se repite", len(restarted.events) == n_events and poll(restarted) == [])
    bot["trades"].append(trade("ADA-1", symbol="ADAUSDT"))
    check("y lo nuevo se avisa", [e["type"] for e in poll(restarted)] == ["trade_open"])
    poll()  # el primer vigilante tambien lo ve (en la suite hay uno solo)

    mid = watch.events[3]["id"]
    check("eventos despues de un id: solo los posteriores, en orden", [e["id"] for e in watch.since(mid)] == [e["id"] for e in watch.events[4:]]
          and len(watch.since(None, 2)) == 2)

    sender.dead.add(token)
    bot["trades"].append(trade("DOT-1", symbol="DOTUSDT"))
    poll()
    check("token muerto: se quita tras el envio", devices.push_tokens() == [])
    sent_before = len(sender.sent)
    bot["trades"].append(trade("LINK-1", symbol="LINKUSDT"))
    poll()
    check("sin celulares con avisos: el evento queda igual", watch.events[-1]["trade_id"] == "LINK-1" and len(sender.sent) == sent_before + 1
          and sender.sent[-1][0] == [])
    check("el vigilante solo lee el bot", {m for m, _ in bot["calls"]} == {"GET"})

    fcm = mobile_events.FcmSender("", lambda: None)
    check("Firebase sin configurar: no envia y dice por que", not fcm.ready() and "Firebase" in fcm.error
          and asyncio.run(fcm.send(["x" * 30], {"id": "1", "type": "t", "title": "a", "body": "b"})) == [])

    # ================= puerta movil =================
    images = TMP / "img"
    (images / "s1").mkdir(parents=True)
    (images / "s1" / "img_1.png").write_bytes(b"\x89PNG" + b"0" * 20)
    bot["positions"] = [{"symbol": "BTCUSDT", "side": "Buy", "size": 0.01, "unrealizedPnl": "12.5", "stopLoss": 69000.0},
                        {"symbol": "ETHUSDT", "side": "Sell", "size": 1, "unrealizedPnl": "-2.25", "stopLoss": None}]
    gate_app = mobile_gate.make_app(devices, watch, fake_bot, FakeJournal(images), "0.1.0")
    c = TestClient(gate_app)

    def get(path, **kw):
        return c.get(path, headers=signed(dev, "GET", path), **kw)

    clock.t += 61_000
    check("puerta: sin firma 401 en todas las rutas",
          all(c.get(p).status_code == 401 for p in ("/m/hello", "/m/overview", "/m/positions", "/m/trades", "/m/events", "/m/image/s1/img_1.png")))
    clock.t += 61_000
    r = get("/m/hello")
    check("puerta: hello firmado", r.status_code == 200 and r.json()["device"] == "Pixel de prueba" and r.json()["brokers"] == ["bybit"]
          and r.json()["can"]["close_position"] is False, r.text)
    r = get("/m/overview").json()
    check("puerta: resumen con cuenta, pausa, P&L abierto y posiciones sin stop", r["bot"]["mode"] == "DEMO" and r["positions"]["count"] == 2
          and r["positions"]["unrealized_pnl"] == 10.25 and r["positions"]["without_stop"] == 1, str(r))
    r = get("/m/positions").json()
    check("puerta: posiciones con su broker", [p["broker"] for p in r["positions"]] == ["bybit", "bybit"] and r["positions"][0]["symbol"] == "BTCUSDT")
    r = get("/m/trades?days=7").json()
    check("puerta: trades con sus imagenes y su broker", r["trades"] and all(t["broker"] == "bybit" and t["images"] for t in r["trades"]))
    r = get("/m/image/s1/img_1.png")
    check("puerta: imagen del journal", r.status_code == 200 and r.content.startswith(b"\x89PNG") and r.headers["content-type"] == "image/png")
    check("puerta: imagen que no existe 404", get("/m/image/s1/nada.png").status_code == 404)
    r = get(f"/m/events?after={mid}").json()
    check("puerta: eventos despues de un id", [e["id"] for e in r["events"]] == [e["id"] for e in watch.since(mid)])
    check("puerta: after raro 400", get("/m/events?after=abc").status_code == 400)
    check("puerta: firma de una consulta, pedida con otra: 401", c.get("/m/trades?days=30", headers=signed(dev, "GET", "/m/trades?days=7")).status_code == 401)

    def post(path, payload):
        body = json.dumps(payload).encode()
        return c.post(path, content=body, headers={**signed(dev, "POST", path, body), "Content-Type": "application/json"})

    check("puerta: token de avisos guardado", post("/m/push-token", {"token": token}).status_code == 200 and devices.push_tokens() == [token])
    check("puerta: token invalido 400", post("/m/push-token", {"token": 5}).status_code == 400 and post("/m/push-token", {"token": "x"}).status_code == 400)
    check("puerta: token null lo quita", post("/m/push-token", {"token": None}).status_code == 200 and devices.push_tokens() == [])
    calls_before = len(bot["calls"])
    codes = [post(p, {"symbol": "BTCUSDT", "side": "Buy", "confirm": "CERRAR_POSICION"}).status_code
             for p in ("/m/position/close", "/m/bot/trade", "/m/trade", "/api/bot/position/close", "/api/bot/credentials")]
    check("puerta: no existen rutas de ordenes, cierre ni claves", all(code in (404, 405) for code in codes) and len(bot["calls"]) == calls_before, str(codes))
    pre = {"Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "x-device,x-time,x-nonce,x-sign"}
    check("puerta: la pagina local de la app puede leer (CORS) y una pagina de internet no",
          c.options("/m/hello", headers={"Origin": "https://localhost", **pre}).headers.get("access-control-allow-origin") == "https://localhost"
          and c.options("/m/hello", headers={"Origin": "http://localhost:13010", **pre}).status_code == 200
          and "access-control-allow-origin" not in c.options("/m/hello", headers={"Origin": "https://ejemplo.com", **pre}).headers)
    skewed = c.get("/m/hello", headers=signed(dev, "GET", "/m/hello", at=clock() - 10 * MIN))
    check("puerta: reloj corrido responde 401 con la hora del servidor", skewed.status_code == 401 and skewed.json().get("now") == clock())
    check("puerta: sin documentacion publica", all(c.get(p).status_code == 404 for p in ("/docs", "/openapi.json", "/redoc")))
    big = b"x" * (mobile_gate.MAX_BODY + 1)
    check("puerta: cuerpo demasiado grande 413", c.post("/m/push-token", content=big, headers=signed(dev, "POST", "/m/push-token", big)).status_code == 413)
    bot["down"] = True
    clock.t += 61_000
    check("puerta: bot caido responde 503, no 500", get("/m/overview").status_code == 503 and get("/m/positions").status_code == 503)
    bot["down"] = False

    # ================= rutas del PC =================
    gate_off = mobile_gate.Gate(gate_app, "", 13002)
    local = FastAPI()
    local.include_router(mobile_gate.make_local_router(devices, gate_off, watch))
    lc = TestClient(local)
    check("PC: emparejar sin la palabra 400", lc.post("/api/mobile/pair", json={"name": "A"}).status_code == 400)
    check("PC: emparejar con la puerta apagada 409", lc.post("/api/mobile/pair", json={"name": "A", "confirm": "EMPAREJAR_CELULAR"}).status_code == 409)
    gate_on = mobile_gate.Gate(gate_app, "100.64.0.1", 13002)
    local = FastAPI()
    local.include_router(mobile_gate.make_local_router(devices, gate_on, watch))
    lc = TestClient(local)
    r = lc.post("/api/mobile/pair", json={"name": " Mi celular ", "confirm": "EMPAREJAR_CELULAR"})
    qr = r.json().get("qr", {})
    check("PC: emparejar da el QR con direccion, puerto, id y secreto", r.status_code == 200 and qr["host"] == "100.64.0.1" and qr["port"] == 13002
          and len(qr["secret"]) == 64 and qr["name"] == "Mi celular" and "secret" not in r.json()["device"], r.text)
    st = lc.get("/api/mobile/status").json()
    check("PC: el estado lista los celulares sin secretos", len(st["devices"]) == 2 and "secret" not in json.dumps(st) and qr["secret"] not in json.dumps(st)
          and st["gate"]["enabled"] and st["watch"]["baseline"])
    check("PC: el celular nuevo entra con el secreto del QR", c.get("/m/hello", headers=signed(qr, "GET", "/m/hello")).status_code == 200)
    check("PC: revocar sin la palabra 400 y con id raro 400", lc.post(f"/api/mobile/devices/{qr['id']}/revoke", json={}).status_code == 400
          and lc.post("/api/mobile/devices/xyz/revoke", json={"confirm": "REVOCAR_CELULAR"}).status_code == 400)
    check("PC: revocar", lc.post(f"/api/mobile/devices/{qr['id']}/revoke", json={"confirm": "REVOCAR_CELULAR"}).status_code == 200
          and c.get("/m/hello", headers=signed(qr, "GET", "/m/hello")).status_code == 401
          and lc.post(f"/api/mobile/devices/{qr['id']}/revoke", json={"confirm": "REVOCAR_CELULAR"}).status_code == 404)
    check("PC: aviso de prueba sin la palabra 400; sin celulares con avisos 409",
          lc.post("/api/mobile/test-push", json={}).status_code == 400
          and lc.post("/api/mobile/test-push", json={"confirm": "ENVIAR_AVISO_PRUEBA"}).status_code == 409)
    devices.set_push_token(dev["id"], token)
    sender.dead.clear()
    r = lc.post("/api/mobile/test-push", json={"confirm": "ENVIAR_AVISO_PRUEBA"})
    check("PC: aviso de prueba enviado", r.status_code == 200 and sender.sent[-1][1] == "test")

    # ================= la puerta en su puerto =================
    def free_port():
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
        s.close()
        return port

    async def real_gate():
        port = free_port()
        gate = mobile_gate.Gate(gate_app, "127.0.0.1", port)
        gate.start()
        out = {}
        try:
            for _ in range(100):
                if gate.listening:
                    break
                await asyncio.sleep(0.05)
            async with httpx.AsyncClient() as http:
                clock.t = int(time.time() * 1000)
                out["ok"] = (await http.get(f"http://127.0.0.1:{port}/m/hello", headers=signed(dev, "GET", "/m/hello"))).status_code
                out["plain"] = (await http.get(f"http://127.0.0.1:{port}/m/positions")).status_code
            out["status"] = gate.status()
        finally:
            await gate.stop()
        out["stopped"] = not gate.listening
        # Puerto ocupado: no se cae nada, queda el motivo y reintenta
        busy = socket.socket()
        busy.bind(("127.0.0.1", 0))
        busy.listen(1)
        gate2 = mobile_gate.Gate(gate_app, "127.0.0.1", busy.getsockname()[1])
        gate2.RETRY_SECONDS = 0.1
        gate2.start()
        await asyncio.sleep(0.3)
        out["busy"] = gate2.status()
        busy.close()
        for _ in range(100):
            if gate2.listening:
                break
            await asyncio.sleep(0.05)
        out["retried"] = gate2.listening
        await gate2.stop()
        off = mobile_gate.Gate(gate_app, "", port)
        off.start()
        out["off"] = off.status()
        await off.stop()
        return out

    out = asyncio.run(real_gate())
    check("puerta real: responde en su puerto a un pedido firmado y 401 a uno sin firma", out["ok"] == 200 and out["plain"] == 401, str(out))
    check("puerta real: el estado dice que escucha, y se detiene", out["status"]["listening"] and out["stopped"])
    check("puerta real: puerto ocupado no tumba nada y dice el motivo", not out["busy"]["listening"] and out["busy"]["error"], str(out["busy"]))
    check("puerta real: al liberarse el puerto, entra sola", out["retried"])
    check("sin mobile_host: apagada, no abre nada", out["off"] == {"enabled": False, "host": None, "port": out["off"]["port"], "listening": False, "error": None})
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pasan")
sys.exit(1 if failed else 0)
