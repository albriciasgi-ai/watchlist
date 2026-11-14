# Pruebas sin conexion del cambio de apalancamiento (13/11/2026, pedido desde la suite): el cliente de Bybit lo pide
# siempre al cambiarlo a mano (sin la memoria de la sesion) y la ruta /api/config/leverage lo guarda solo si Bybit lo
# acepto. Nunca se llama a Bybit: el cliente real responde con un _make_request falso y la ruta usa un cliente falso.
# Uso, desde 3.TradingBot_Python\backend:  C:\Python314\python.exe -B tests\leverage_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="bot_leverage_"))
CONFIG = TMP / "config"
CONFIG.mkdir()
(CONFIG / "credentials.json").write_text(json.dumps({"api_key": "clave_demo_1111", "api_secret": "secreto_demo", "demo": True}))
(CONFIG / "trading_config.json").write_text(json.dumps({"coins": [
    {"symbol": "BTCUSDT", "category": "linear", "risk_amount": 3, "stop_loss_percent": 0.02, "take_profit_percent": 0.04,
     "leverage": 10, "step_size": "0.001", "tick_size": "0.1", "min_qty": "0.001", "max_qty": "100"}]}))
(CONFIG / "trading_directions.json").write_text(json.dumps({"directions": {"BTCUSDT": "BOTH"}}))
os.environ["BOT_CONFIG_DIR"] = str(CONFIG)
os.environ["BOT_LOG_DIR"] = str(TMP / "logs")
os.environ["BOT_PRIVATE_STREAM"] = "0"  # sin WebSocket privado: nada sale a Bybit
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


try:
    # ---------- cliente real de Bybit con un _make_request falso ----------
    from trading.bybit_client import BybitClient  # noqa: E402

    sent, replies = [], []

    async def fake_request(method, endpoint, params=None, **kw):
        sent.append((endpoint, dict(params or {})))
        return replies.pop(0) if replies else {"retCode": 0, "result": {}}

    cli = BybitClient("clave", "secreto", testnet=False, demo=True)
    cli._make_request = fake_request

    async def unit():
        await cli.ensure_leverage("BTCUSDT", 10)
        await cli.ensure_leverage("BTCUSDT", 10)
        first = len(sent)
        await cli.set_leverage("BTCUSDT", 5)
        five = sent[-1][1]
        await cli.set_leverage("BTCUSDT", 10)  # de vuelta a 10: Bybit tiene 5, hay que pedirlo
        after_back = len(sent)
        await cli.ensure_leverage("BTCUSDT", 10)  # la orden siguiente: ya fijado
        cached = len(sent) == after_back
        await cli.ensure_leverage("BTCUSDT", 5)  # 5 se olvido al volver a 10
        forgot = len(sent) == after_back + 1
        replies.append({"retCode": 110043, "retMsg": "leverage not modified"})
        same = await cli.set_leverage("ETHUSDT", 3)
        replies.append({"retCode": 110013, "retMsg": "cannot set leverage beyond max"})
        refused = await cli.set_leverage("ETHUSDT", 99)
        return first, five, after_back, cached, forgot, same, refused

    first, five, after_back, cached, forgot, same, refused = asyncio.run(unit())
    check("ensure_leverage: el mismo valor se pide una sola vez por sesion", first == 1, str(sent))
    check("set_leverage: siempre va a Bybit, compra y venta, como texto", five == {"category": "linear", "symbol": "BTCUSDT",
                                                                                  "buyLeverage": "5", "sellLeverage": "5"}, str(five))
    check("de 10 a 5 y de vuelta a 10: se vuelve a pedir el 10", after_back == 3, str(sent))
    check("despues del cambio, la orden siguiente no lo repite", cached)
    check("el valor anterior de esa moneda se olvida", forgot)
    check("'leverage not modified' de Bybit cuenta como fijado", same.get("retCode") == 0, str(same))
    check("un rechazo de Bybit vuelve con su mensaje", refused.get("retCode") == 110013 and "beyond max" in refused.get("retMsg", ""), str(refused))

    # ---------- la ruta /api/config/leverage con un cliente falso ----------
    CALLS = []
    REPLY = {"value": {"retCode": 0, "result": {}}}

    class FakeClient:
        def __init__(self, api_key, api_secret, testnet=False, demo=False):
            self.api_key, self.api_secret, self.demo = api_key, api_secret, demo
            self.mode = "demo" if demo else "live"
            self.base_url = "simulado"
            self._position_mode = "one_way"

        def _get_timestamp(self):
            return int(time.time() * 1000)

        async def close(self):
            pass

        async def check_api_key(self):
            return {"valid": True, "readOnly": False}

        def get_statistics(self):
            return {}

        async def _make_request(self, method, endpoint, params=None, **kw):
            return {"retCode": 0, "result": {"list": [], "nextPageCursor": ""}}

        async def get_instrument_info(self, symbol, category="linear"):
            return {"success": False}

        async def set_leverage(self, symbol, leverage, category="linear"):
            CALLS.append((symbol, leverage, category))
            return dict(REPLY["value"])

    import main  # noqa: E402
    main.BybitClient = FakeClient
    from fastapi.testclient import TestClient  # noqa: E402

    H = {"Host": "127.0.0.1:5000"}

    def saved_leverage():
        coins = json.loads((CONFIG / "trading_config.json").read_text(encoding="utf-8"))["coins"]
        return next(c for c in coins if c["symbol"] == "BTCUSDT")["leverage"]

    with TestClient(main.app) as c:
        r = c.post("/api/config/leverage", headers=H, json={"symbol": "btcusdt", "leverage": 5})
        check("ruta: Bybit lo acepta, queda en la configuracion y en el archivo",
              r.status_code == 200 and r.json()["leverage"] == 5 and r.json()["before"] == 10 and CALLS == [("BTCUSDT", 5, "linear")]
              and main.state.trading_config["BTCUSDT"]["leverage"] == 5 and saved_leverage() == 5, r.text[:200])
        REPLY["value"] = {"retCode": 110013, "retMsg": "cannot set leverage beyond max"}
        r = c.post("/api/config/leverage", headers=H, json={"symbol": "BTCUSDT", "leverage": 90})
        check("ruta: Bybit lo rechaza, 502 con su mensaje y nada cambia",
              r.status_code == 502 and "beyond max" in r.json().get("detail", "") and main.state.trading_config["BTCUSDT"]["leverage"] == 5
              and saved_leverage() == 5, r.text[:200])
        REPLY["value"] = {"retCode": 0, "result": {}}
        check("ruta: moneda que el bot no tiene, 404", c.post("/api/config/leverage", headers=H, json={"symbol": "XRPUSDT", "leverage": 5}).status_code == 404)
        check("ruta: fuera de 1 a 100, 422", all(c.post("/api/config/leverage", headers=H, json={"symbol": "BTCUSDT", "leverage": v}).status_code == 422
                                                for v in (0, 101, -3)))
        main.state.account_switching = True
        n = len(CALLS)
        r = c.post("/api/config/leverage", headers=H, json={"symbol": "BTCUSDT", "leverage": 7})
        main.state.account_switching = False
        check("ruta: con la cuenta cambiando, 409 y nada sale a Bybit", r.status_code == 409 and len(CALLS) == n, r.text[:200])
        check("ruta: desde otra pagina, rechazada", c.post("/api/config/leverage", headers={**H, "Origin": "https://evil.example"},
                                                            json={"symbol": "BTCUSDT", "leverage": 7}).status_code == 403)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
