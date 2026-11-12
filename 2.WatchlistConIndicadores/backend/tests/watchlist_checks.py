# Pruebas sin conexion propias del backend de la Watchlist (App 2 y App 7):
# alertas de patrones apagadas, interruptor global, confirmaciones del Swing, config danada
# y canales del WebSocket que el Swing necesita siempre.
# Se corren con run_checks.py, que las lanza sobre una copia temporal del backend.
import asyncio
import json
import os
import sys
import time
from pathlib import Path

TEST_DIR = Path(sys.argv[1]).resolve()
os.chdir(TEST_DIR)
sys.path.insert(0, str(TEST_DIR))

CONFIG_DIR = TEST_DIR / "config"
CONFIG_DIR.mkdir(exist_ok=True)
BASE_CONFIG = {
    "enabled": True, "symbols": ["BTCUSDT", "ETHUSDT"], "interval": "15", "days": 5,
    "swingBars": 3, "cooldownMinutes": 5, "alertsEnabled": True, "symbolConfigs": {},
    "alertTargetUrl": "http://localhost:5000/api/watchlist-alert",
}
(CONFIG_DIR / "swing_config.json").write_text(json.dumps(BASE_CONFIG), encoding="utf-8")

import main  # noqa: E402
import alert_sender as asend  # noqa: E402
import swing_service as ss  # noqa: E402
import websocket_manager as wm  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

assert Path(ss.CONFIG_DIR).resolve() == CONFIG_DIR

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond), detail))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


# Sin "with": no corre el arranque del backend (no abre el WebSocket ni llama a Bybit)
client = TestClient(main.app, base_url="http://localhost:8000")
svc = ss.get_swing_service()
svc._save_config = svc._save_config  # se guarda en la copia temporal


def drain_queue():
    q = asend.alert_sender.alert_queue
    items = []
    while not q.empty():
        items.append(q.get_nowait())
    return items


async def run_sender_checks():
    sender = asend.alert_sender
    drain_queue()
    ok = await sender.send_rejection_pattern_alert("BTCUSDT", "15", {"patternType": "HAMMER", "price": 100, "confidence": 90})
    check("patrones: un Hammer real no sale (alertas de patrones apagadas)", ok is False and drain_queue() == [])
    ok = await asend.send_pattern_alert("BTCUSDT", "15", {"patternType": "DOUBLE_TOP", "price": 100, "confidence": 90})
    check("patrones: send_pattern_alert tampoco sale", ok is False and drain_queue() == [])
    ok = await sender.send_rejection_pattern_alert("BTCUSDT", "4h", {"patternType": "HAMMER", "price": 100, "confidence": 90}, test=True)
    queued = drain_queue()
    check("prueba con confirmacion: si se encola, con sent_at",
          ok is True and len(queued) == 1 and abs(queued[0]["sent_at"] - time.time() * 1000) < 3000,
          str(queued))
    ok = await sender.send_rejection_pattern_alert("ETHUSDT", "15", {"patternType": "X", "direction": "SHORT", "price": 3000, "confidence": 99}, test=True)
    check("tipo desconocido: no sale como ABRIR LONG (ni en prueba)", ok is False and drain_queue() == [])


asyncio.run(run_sender_checks())

# --- Endpoints que antes mandaban alertas de patrones
r = client.post("/api/pattern-alert", json={"symbol": "ETHUSDT", "interval": "15",
                                             "pattern": {"patternType": "HAMMER", "price": 3000, "confidence": 99},
                                             "config": {"alertsEnabled": True}})
check("/api/pattern-alert: rechazada (409) con las alertas de patrones apagadas",
      r.status_code == 409 and r.json().get("reason") == "pattern_alerts_off", f"{r.status_code} {r.text[:120]}")

calls = []


async def fake_send(*args, **kwargs):
    calls.append(args)
    return True


async def fake_historical(symbol, interval="15", days=30, since_timestamp=None):
    t0 = 1_700_000_000_000
    candles = []
    for i in range(60):
        o = 100 + (i % 7)
        candles.append({"timestamp": t0 + i * 900_000, "open": o, "high": o + 3, "low": o - 6, "close": o + 2,
                        "volume": 10 + i, "in_progress": False})
    return {"success": True, "data": candles}


main.send_pattern_alert = fake_send
real_historical = main.get_historical
main.get_historical = fake_historical
r = client.post("/api/rejection-patterns/detect", json={
    "symbol": "BTCUSDT", "interval": "15", "days": 2, "referenceContexts": [],
    "config": {"alertsEnabled": True, "patterns": {"hammer": {"enabled": True}, "shootingStar": {"enabled": True},
                                                    "engulfing": {"enabled": True}},
               "filters": {"requireNearLevel": False, "minConfidence": 0}}})
check("/api/rejection-patterns/detect: solo detecta, no manda alertas", r.status_code == 200 and calls == [],
      f"{r.status_code} llamadas={len(calls)}")
main.get_historical = real_historical

# --- Interruptor global
r = client.post("/api/alerts/toggle-global", json={})
check("toggle-global sin 'enabled': 400 y no cambia nada", r.status_code == 400 and svc.config.alertsEnabled is True)
r = client.post("/api/alerts/toggle-global", json={"enabled": False})
check("toggle-global false: Swing apagado y guardado",
      r.json().get("alertsEnabled") is False and svc.config.alertsEnabled is False
      and json.loads((CONFIG_DIR / "swing_config.json").read_text(encoding="utf-8"))["alertsEnabled"] is False)
r = client.post("/api/alerts/toggle-global", json={"enabled": True})
st = client.get("/api/alerts/global-status").json()
check("toggle-global true: Swing encendido y patrones siguen apagados",
      svc.config.alertsEnabled is True and st["alertsEnabled"] is True and st["services"]["patterns"]["enabled"] is False
      and st["services"]["patterns"]["dbt_enabled_count"] == 0, str(st))
r = client.post("/api/swing/toggle-alerts", json={})
check("swing/toggle-alerts sin 'enabled': 400 (antes encendia)", r.status_code == 400 and svc.config.alertsEnabled is True)

# --- /api/swing/config: timeframe y monedas solo con confirmacion
reanalyzed = []


async def fake_reanalyze():
    reanalyzed.append(1)


svc.reanalyze_historical = fake_reanalyze
r = client.post("/api/swing/config", json={"interval": "60", "days": 30, "symbols": ["XRPUSDT"],
                                           "alertTargetUrl": "http://127.0.0.1:9/robo", "alertsEnabled": False})
body = r.json()
check("sin confirmacion: interval, symbols, alertsEnabled y destino se ignoran",
      svc.config.interval == "15" and svc.config.symbols == ["BTCUSDT", "ETHUSDT"]
      and svc.config.alertsEnabled is True and svc.config.alertTargetUrl.endswith(":5000/api/watchlist-alert")
      and set(body.get("ignored", [])) == {"interval", "symbols", "alertTargetUrl", "alertsEnabled"}, str(body)[:200])
check("sin confirmacion: los dias si se aplican (solo historial)", svc.config.days == 30)


async def settle():
    await asyncio.sleep(0)


r = client.post("/api/swing/config", json={"interval": "60", "confirm": "CAMBIAR_ALERTAS"})
check("con confirmacion: el timeframe de las alertas cambia", svc.config.interval == "60", svc.config.interval)
r = client.post("/api/swing/config", json={"interval": "7", "confirm": "CAMBIAR_ALERTAS"})
check("intervalo invalido: rechazado aun con confirmacion", svc.config.interval == "60")

# --- Config danada o con campos de mas
(CONFIG_DIR / "swing_config.json").write_text('{"enabled": true, "symbols": ["BTCUSDT"', encoding="utf-8")
s2 = ss.SwingService()
backups = list(CONFIG_DIR.glob("swing_config.ilegible-*.json"))
check("config cortada: Swing SIN alertas y copia del archivo",
      s2.config.alertsEnabled is False and s2.get_status()["configError"] and len(backups) == 1,
      f"alertas={s2.config.alertsEnabled} copias={len(backups)}")
extra = dict(BASE_CONFIG, alertsEnabled=False, campoNuevo=1)
(CONFIG_DIR / "swing_config.json").write_text(json.dumps(extra), encoding="utf-8")
s3 = ss.SwingService()
check("campo desconocido: se ignora y se conserva el resto (alertas apagadas siguen apagadas)",
      s3.config.alertsEnabled is False and s3.config.interval == "15" and s3.get_status()["configError"] is None)
(CONFIG_DIR / "swing_config.json").write_text(json.dumps(dict(BASE_CONFIG, interval="7")), encoding="utf-8")
s4 = ss.SwingService()
check("intervalo invalido en el archivo: Swing sin alertas", s4.config.alertsEnabled is False and s4.get_status()["configError"])


# --- Canales del WebSocket que el Swing necesita siempre
class FakeSock:
    def __init__(self):
        self.sent = []

    async def send(self, text):
        self.sent.append(json.loads(text))


async def run_ws_checks():
    m = wm.WebSocketManager()
    m.ws = FakeSock()
    m.connected = True
    m.subscriptions = {f"kline.15.{s}" for s in ("BTCUSDT", "ETHUSDT")}
    m.require_channels("swing", ["BTCUSDT", "ETHUSDT"], ["15"])
    ok = await m.update_subscriptions(["BTCUSDT", "ETHUSDT"], ["60"])
    check("cambio de timeframe pedido por una pagina: el Swing conserva sus canales",
          ok and {"kline.15.BTCUSDT", "kline.15.ETHUSDT", "kline.60.BTCUSDT", "kline.60.ETHUSDT"} == m.subscriptions,
          str(sorted(m.subscriptions)))
    many = [f"C{i}USDT" for i in range(12)]
    m.sent = m.ws.sent = []
    await m.update_subscriptions(many, ["1"])
    check("suscripciones en lotes de 10 (limite de Bybit)",
          all(len(msg["args"]) <= 10 for msg in m.ws.sent), str([len(x["args"]) for x in m.ws.sent]))
    m2 = wm.WebSocketManager()
    m2.subscriptions = {"kline.15.BTCUSDT"}
    m2.require_channels("swing", ["BTCUSDT"], ["15"])
    ok2 = await m2.update_subscriptions(["BTCUSDT"], ["60"])
    check("cambio pedido sin conexion: se guarda para la reconexion",
          ok2 is True and m2.subscriptions == {"kline.15.BTCUSDT", "kline.60.BTCUSDT"}, str(m2.subscriptions))


asyncio.run(run_ws_checks())

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
