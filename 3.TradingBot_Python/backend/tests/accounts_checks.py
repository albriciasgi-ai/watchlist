# Pruebas sin conexion de las cuentas de Bybit del bot (varias claves, una activa).
# Usan una carpeta de configuracion temporal (BOT_CONFIG_DIR) y un Bybit simulado: nunca tocan las claves
# reales ni llaman a Bybit.
# Uso, desde 3.TradingBot_Python\backend:  C:\Python314\python.exe -B tests\accounts_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
from decimal import Decimal
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="bot_accounts_"))
CONFIG = TMP / "config"
CONFIG.mkdir()
os.environ["BOT_CONFIG_DIR"] = str(CONFIG)
os.environ["BOT_LOG_DIR"] = str(TMP / "logs")
os.environ["BOT_PRIVATE_STREAM"] = "0"  # el WebSocket privado nunca se conecta a Bybit en pruebas
(CONFIG / "credentials.json").write_text(json.dumps({"api_key": "clave_vieja_1234", "api_secret": "secreto_viejo", "demo": True}))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


class FakeClient:
    instances = []

    def __init__(self, api_key, api_secret, testnet=False, demo=False):
        self.api_key, self.api_secret, self.demo = api_key, api_secret, demo
        self.mode = "demo" if demo else "live"
        self.base_url = "simulado"
        self._position_mode = None
        self.closed = False
        FakeClient.instances.append(self)

    async def close(self):
        self.closed = True

    async def check_api_key(self):
        if "mala" in self.api_key:
            return {"valid": False, "retCode": 10003, "retMsg": "API key is invalid."}
        if "lectura" in self.api_key:
            return {"valid": True, "readOnly": True}
        return {"valid": True, "readOnly": False}

    async def get_wallet_balance(self):
        return {"retCode": 0, "result": {"list": [{"totalEquity": "1000.5", "totalWalletBalance": "990", "totalAvailableBalance": "900"}]}}

    async def _make_request(self, method, endpoint, params=None, **kw):
        if endpoint == "/v5/position/list":
            return {"retCode": 0, "result": {"list": [
                {"symbol": "BTCUSDT", "side": "Buy", "size": "0.01", "avgPrice": "70000", "stopLoss": "69000", "takeProfit": "72000"},
                {"symbol": "ETHUSDT", "side": "", "size": "0"}]}}
        return {"retCode": 0, "result": {}}

    async def get_position(self, symbol, *a, **k):
        FakeClient.position_calls.append((self.api_key, symbol))
        return {"success": True, "positions": []}

    position_calls = []

    def get_statistics(self):
        return {}


main.BybitClient = FakeClient
H = {"Host": "127.0.0.1:5000"}


def accounts_file():
    return json.loads((CONFIG / "accounts.json").read_text(encoding="utf-8"))


def creds_file():
    return json.loads((CONFIG / "credentials.json").read_text(encoding="utf-8"))


try:
    with TestClient(main.app) as c:
        # Migracion: la clave de credentials.json pasa a ser la "Cuenta principal", activa
        r = c.get("/api/accounts", headers=H)
        d = r.json()
        check("migracion: una cuenta activa llamada Cuenta principal",
              r.status_code == 200 and len(d["accounts"]) == 1 and d["accounts"][0]["name"] == "Cuenta principal"
              and d["accounts"][0]["active"] and d["accounts"][0]["key_hint"] == "...1234", r.text)
        check("la API nunca devuelve el secreto ni la clave completa", "secreto" not in r.text and "clave_vieja_1234" not in r.text)
        principal = d["accounts"][0]["id"]
        check("estado del bot con la cuenta activa", c.get("/api/status", headers=H).json()["account"]["name"] == "Cuenta principal")

        # Agregar
        r = c.post("/api/accounts", headers=H, json={"name": "Real", "api_key": "clave_real_5678", "api_secret": "s2", "demo": False})
        real = r.json()["account"]
        check("agregar: validada y no activa", r.status_code == 200 and real["validated"] is True and not real["active"] and real["mode"] == "live", r.text)
        check("agregar la misma clave: 409", c.post("/api/accounts", headers=H, json={"name": "Otra", "api_key": "clave_real_5678", "api_secret": "x"}).status_code == 409)
        check("agregar el mismo nombre: 409", c.post("/api/accounts", headers=H, json={"name": "real", "api_key": "otra_9999", "api_secret": "x"}).status_code == 409)
        r = c.post("/api/accounts", headers=H, json={"name": "Mala", "api_key": "clave_mala_0000", "api_secret": "x", "demo": True})
        mala = r.json()["account"]
        check("clave rechazada por Bybit: se guarda con el motivo", mala["validated"] is False and "rechazo" in (mala["validation_message"] or ""), r.text)
        r = c.post("/api/accounts", headers=H, json={"name": "Lectura", "api_key": "clave_lectura_1111", "api_secret": "x"})
        lectura = r.json()["account"]

        # Activar
        before = creds_file()
        r = c.post(f"/api/accounts/{mala['id']}/activate", headers=H)
        check("activar una cuenta con clave mala: 400 y no cambia nada",
              r.status_code == 400 and creds_file() == before and accounts_file()["active"] == principal, r.text)
        r = c.post(f"/api/accounts/{lectura['id']}/activate", headers=H)
        check("activar una cuenta de solo lectura: 400", r.status_code == 400 and accounts_file()["active"] == principal, r.text)
        lock = main.state.symbol_locks.setdefault("BTCUSDT", asyncio.Lock())
        lock._locked = True  # una orden ejecutandose
        r = c.post(f"/api/accounts/{real['id']}/activate", headers=H)
        check("activar con una orden en curso: 409", r.status_code == 409 and accounts_file()["active"] == principal, r.text)
        lock._locked = False
        r = c.post(f"/api/accounts/{real['id']}/activate", headers=H)
        check("activar: el bot opera con la cuenta nueva",
              r.status_code == 200 and accounts_file()["active"] == real["id"] and main.state.bybit_client.api_key == "clave_real_5678"
              and creds_file() == {"api_key": "clave_real_5678", "api_secret": "s2", "demo": False}, r.text)
        st = c.get("/api/status", headers=H).json()
        check("estado: nombre y modo de la cuenta activa", st["account"] == {"id": real["id"], "name": "Real", "mode": "live"}, str(st.get("account")))

        # Borrar y renombrar
        check("borrar la cuenta activa: 409", c.delete(f"/api/accounts/{real['id']}", headers=H).status_code == 409)
        check("borrar otra cuenta", c.delete(f"/api/accounts/{mala['id']}", headers=H).status_code == 200
              and not any(a["id"] == mala["id"] for a in accounts_file()["accounts"]))
        r = c.put(f"/api/accounts/{real['id']}", headers=H, json={"name": "Real BTC"})
        check("renombrar actualiza el estado", r.status_code == 200 and c.get("/api/status", headers=H).json()["account"]["name"] == "Real BTC")
        check("id invalido: 400", c.delete("/api/accounts/../x", headers=H).status_code in (400, 404))
        check("id desconocido: 404", c.get("/api/accounts/aaaaaaaaaaaa/summary", headers=H).status_code == 404)

        # Saldo y posiciones de una cuenta que no es la activa: con un cliente aparte, que se cierra
        n_before = len(FakeClient.instances)
        r = c.get(f"/api/accounts/{principal}/summary", headers=H)
        d = r.json()
        temp = FakeClient.instances[-1]
        check("resumen de otra cuenta: saldo y solo posiciones abiertas",
              r.status_code == 200 and d["balance"]["equity"] == 1000.5 and len(d["positions"]) == 1 and d["positions"][0]["symbol"] == "BTCUSDT", r.text)
        check("resumen de otra cuenta: cliente aparte con sus claves, cerrado; el activo no cambia",
              len(FakeClient.instances) == n_before + 1 and temp.api_key == "clave_vieja_1234" and temp.closed
              and main.state.bybit_client.api_key == "clave_real_5678")
        n_before = len(FakeClient.instances)
        c.get(f"/api/accounts/{real['id']}/summary", headers=H)
        check("resumen de la activa: usa el cliente del bot", len(FakeClient.instances) == n_before)

        # Claves puestas desde App 10 (/api/credentials): actualizan la cuenta activa
        r = c.post("/api/credentials", headers=H, json={"api_key": "clave_nueva_4321", "api_secret": "s3", "demo": False})
        acc = next(a for a in accounts_file()["accounts"] if a["id"] == real["id"])
        check("App 10 cambia las claves de la cuenta activa", r.status_code == 200 and acc["api_key"] == "clave_nueva_4321"
              and len(accounts_file()["accounts"]) == 3)

        # Cambio de cuenta y ordenes: nunca a la vez (una orden no revisa en una cuenta y envia por otra)
        main.state.trading_config["BTCUSDT"] = {"symbol": "BTCUSDT", "category": "linear", "risk_amount": 3.0,
                                               "stop_loss_percent": 0.02, "take_profit_percent": 0.04, "leverage": 10,
                                               "step_size": "0.001", "tick_size": "0.1", "min_qty": "0.001", "max_qty": "100"}
        main.state.direction_manager.directions["BTCUSDT"] = "BOTH"
        bot_client = main.state.bybit_client
        lock._locked = True
        r = c.post("/api/credentials", headers=H, json={"api_key": "clave_otra_7777", "api_secret": "s4", "demo": True})
        check("App 10 cambia las claves con una orden en curso: 409 y nada cambia",
              r.status_code == 409 and main.state.bybit_client is bot_client and creds_file()["api_key"] == "clave_nueva_4321", r.text)
        lock._locked = False
        trade = {"symbol": "BTCUSDT", "side": "Buy", "quantity": "0.01", "current_price": "70000", "stopLoss": "69000", "takeProfit": "72000"}
        main.state.account_switching = True
        n_pos = len(FakeClient.position_calls)
        r = c.post("/api/trade/manual", headers=H, json=trade)
        check("orden manual durante un cambio de cuenta: 409 sin tocar Bybit",
              r.status_code == 409 and len(FakeClient.position_calls) == n_pos, r.text)
        check("dos cambios de cuenta a la vez: 409", c.post(f"/api/accounts/{principal}/activate", headers=H).status_code == 409)
        alert = dict(symbol="BTCUSDT", side="Buy", price=Decimal("70000"), source="PRUEBA", origin="ANALIZADOR",
                     pattern="PRUEBA", confidence=80, extras={}, automatic=True)
        res = c.portal.call(lambda: main.execute_trade(**alert))
        check("alerta durante un cambio de cuenta: descartada sin tocar Bybit",
              res.get("reason") == "REJECTED_ACCOUNT_SWITCH" and len(FakeClient.position_calls) == n_pos, str(res))
        main.state.account_switching = False

        async def alerta_que_espero_el_candado():
            sym_lock = main.state.get_symbol_lock("BTCUSDT")
            await sym_lock.acquire()  # una orden de BTC en curso
            task = asyncio.ensure_future(main.execute_trade(**alert))
            await asyncio.sleep(0.05)  # la alerta ya tomo el cliente y espera el candado
            main.state.bybit_client = FakeClient("clave_cambio_8888", "s", demo=True)  # la cuenta cambio mientras esperaba
            sym_lock.release()
            return await task

        res = c.portal.call(alerta_que_espero_el_candado)
        check("alerta que tomo el cliente antes del cambio: descartada al tomar el candado",
              res.get("reason") == "REJECTED_ACCOUNT_SWITCH" and len(FakeClient.position_calls) == n_pos, str(res))
        main.state.bybit_client = bot_client
        r = c.post("/api/trade/manual", headers=H, json=trade)
        check("sin cambio de cuenta la orden sigue (revisa la posicion en la cuenta activa)",
              r.status_code != 409 and FakeClient.position_calls[n_pos:] == [("clave_nueva_4321", "BTCUSDT")], f"{r.status_code} {r.text}")
        check("el cambio de cuenta queda libre al terminar", not main.state.account_switching and not main.state.accounts_lock.locked())

        # Proteccion: una pagina ajena no puede agregar cuentas
        r = c.post("/api/accounts", headers={**H, "Origin": "https://evil.example"}, json={"name": "X", "api_key": "k", "api_secret": "s"})
        check("pagina ajena: 403", r.status_code == 403)

        # Archivo danado: error, nunca una lista vacia, y no se sobrescribe
        (CONFIG / "accounts.json").write_text("{roto", encoding="utf-8")
        check("accounts.json ilegible: 500", c.get("/api/accounts", headers=H).status_code == 500)
        check("accounts.json ilegible: no se sobrescribe", (CONFIG / "accounts.json").read_text(encoding="utf-8") == "{roto")
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
