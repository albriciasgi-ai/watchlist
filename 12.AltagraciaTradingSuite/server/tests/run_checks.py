# Pruebas sin conexion del servidor de la suite (no llaman a Bybit ni al bot).
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\run_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_checks_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


H = {"Host": "127.0.0.1:13000"}
bot_calls = []


async def fake_bot(method, path, **kw):
    bot_calls.append((method, path, kw.get("json")))
    if path == "/api/settings/trading-paused":
        return {"success": True, "trading_paused": kw["json"]["paused"]}
    return {"status": "online", "trading_paused": False, "alerts": [], "orders": [], "total": 0}


main._bot = fake_bot
captured = {}


def fake_footprints(*args, **kw):
    captured["args"], captured["kw"] = args, kw
    return {"footprints": [], "step_size": 10, "known_until": args[4]}


main.footprint_store.footprints = fake_footprints

try:
    with TestClient(main.app) as c:
        # Proteccion
        check("host ajeno rechazado", c.get("/api/suite/status", headers={"Host": "evil.example"}).status_code == 403)
        check("origen ajeno rechazado", c.get("/api/drawings/BTCUSDT", headers={**H, "Origin": "https://evil.example"}).status_code == 403)
        check("origen de este PC aceptado", c.get("/api/drawings/BTCUSDT", headers={**H, "Origin": "http://localhost:13001"}).status_code == 200)
        check("simbolo invalido rechazado", c.get("/api/drawings/bad..name", headers=H).status_code == 400)
        check("marco no soportado rechazado", c.get("/api/historical/BTCUSDT?interval=3m", headers=H).status_code == 400)
        check("marcos de App 1 aceptados", [main._interval(x) for x in ("1m", "15m", "1h", "4h", "60")] == ["1", "15", "60", "240", "60"])

        # Pausa del bot: solo con confirmacion explicita
        r = c.post("/api/bot/pause", headers=H, json={"paused": True})
        check("pausa sin confirmacion: no llama al bot", r.status_code == 400 and not bot_calls)
        r = c.post("/api/bot/pause", headers=H, json={"paused": "si", "confirm": "CAMBIAR_PAUSA"})
        check("pausa con valor no booleano: no llama al bot", r.status_code == 400 and not bot_calls)
        r = c.post("/api/bot/pause", headers=H, json={"paused": True, "confirm": "CAMBIAR_PAUSA"})
        check("pausa confirmada: una llamada al bot con el valor pedido",
              r.status_code == 200 and bot_calls == [("POST", "/api/settings/trading-paused", {"paused": True})])

        # Footprints: siempre con los dias de la nube y del PC, nunca despues de ahora
        r = c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&known_until=99999999999999", headers=H)
        check("footprints con live=True", r.status_code == 200 and captured["kw"].get("live") is True)
        check("known_until nunca pasa de ahora", captured["args"][4] <= int(main.time.time() * 1000))
        check("modo de imbalance desconocido vuelve a 'level'",
              c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&imbalance_mode=x", headers=H).status_code == 200
              and captured["args"][6]["mode"] == "level")

        # Dibujos
        shapes = [{"id": "a", "type": "rectangle"}]
        r = c.post("/api/drawings/ETHUSDT", headers=H, json={"interval": "15", "shapes": shapes})
        back = c.get("/api/drawings/ETHUSDT", headers=H).json()
        check("dibujos guardados y leidos", r.status_code == 200 and back["shapes"] == shapes)
        check("dibujos sin temporales", not list((TMP / "data" / "drawings").glob("*.tmp")))
        check("dibujos con forma invalida rechazados", c.post("/api/drawings/ETHUSDT", headers=H, json={"shapes": "x"}).status_code == 400)
        (TMP / "data" / "drawings" / "SOLUSDT.json").write_text("{roto", encoding="utf-8")
        check("archivo de dibujos danado: error, no lista vacia", c.get("/api/drawings/SOLUSDT", headers=H).status_code == 500)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
