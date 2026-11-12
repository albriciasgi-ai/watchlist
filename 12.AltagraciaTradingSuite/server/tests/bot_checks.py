# Pruebas sin conexion de las rutas del bot (configuracion, riesgo, claves y ordenes del panel de trading),
# de la lista de monedas y del candado de un solo grabador. El bot real nunca recibe nada: lo reemplaza fake_bot.
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\bot_checks.py
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
TMP = Path(tempfile.mkdtemp(prefix="suite_bot_checks_"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import bot_routes  # noqa: E402
from symbols import SymbolList, DEFAULT_SYMBOLS  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


calls = []


async def fake_bot(method, path, **kw):
    calls.append((method, path, kw.get("json"), kw.get("params")))
    return {"success": True, "status": "success"}


app = FastAPI()
app.include_router(bot_routes.make_router(fake_bot))
c = TestClient(app)

GOOD = {"symbol": "BTCUSDT", "side": "Buy", "order_type": "Market", "quantity": 0.01, "stop_loss": 99000,
        "take_profit": 103000, "current_price": 100000, "confirm": "ENVIAR_ORDEN_REAL"}

try:
    # Orden: palabra, lados y tipo
    r = c.post("/api/bot/trade", json={**GOOD, "confirm": "x"})
    check("orden sin la palabra: no llega al bot", r.status_code == 400 and not calls)
    for name, change in (
        ("sin stop", {"stop_loss": None}),
        ("sin objetivo", {"take_profit": None}),
        ("stop del lado equivocado", {"stop_loss": 101000}),
        ("objetivo del lado equivocado (short)", {"side": "Sell", "stop_loss": 101000, "take_profit": 100500}),
        ("cantidad cero", {"quantity": 0}),
        ("lado desconocido", {"side": "long"}),
        ("orden stop (el bot no la tiene)", {"order_type": "Stop"}),
        ("limit que cruza el precio", {"order_type": "Limit", "limit_price": 100500, "take_profit": 104000}),
        ("simbolo invalido", {"symbol": "btc/usdt"}),
        ("cantidad booleana", {"quantity": True}),
    ):
        r = c.post("/api/bot/trade", json={**GOOD, **change})
        check(f"orden rechazada: {name}", r.status_code == 400 and not calls, r.text)
    r = c.post("/api/bot/trade", json=GOOD)
    sent = calls[-1] if calls else None
    check("orden valida: una llamada a /api/trade/manual con stop y objetivo propios",
          r.status_code == 200 and len(calls) == 1 and sent[1] == "/api/trade/manual"
          and sent[2]["custom_stop_loss"] == 99000 and sent[2]["custom_take_profit"] == 103000 and sent[2]["quantity"] == 0.01)
    calls.clear()
    r = c.post("/api/bot/trade", json={**GOOD, "order_type": "Limit", "limit_price": 99500, "stop_loss": 99000, "take_profit": 101000})
    check("limit valida lleva su precio", r.status_code == 200 and calls[-1][2].get("limit_price") == 99500 and calls[-1][2]["order_type"] == "Limit")
    calls.clear()

    # Configuracion
    check("cambio de config sin palabra: no llega", c.post("/api/bot/config/update", json={"symbol": "BTCUSDT", "risk_amount": 5}).status_code == 400 and not calls)
    check("stop de 80% rechazado", c.post("/api/bot/config/update", json={"symbol": "BTCUSDT", "stop_loss_percent": 0.8, "confirm": "CAMBIAR_CONFIG"}).status_code == 400 and not calls)
    r = c.post("/api/bot/config/update", json={"symbol": "btcusdt", "risk_amount": 5, "confirm": "CAMBIAR_CONFIG"})
    check("config valida: solo los campos pedidos", r.status_code == 200 and calls[-1][2] == {"symbol": "BTCUSDT", "risk_amount": 5.0})
    r = c.post("/api/bot/config/add", json={"symbol": "LINKUSDT", "risk_amount": 3, "stop_loss_percent": 0.02, "take_profit_percent": 0.04, "leverage": 5, "confirm": "CAMBIAR_CONFIG"})
    check("agregar moneda con apalancamiento", r.status_code == 200 and calls[-1][2]["leverage"] == 5)
    check("origen desconocido rechazado", c.post("/api/bot/settings/allowed-origins", json={"origin": "X", "enabled": True, "confirm": "CAMBIAR_CONFIG"}).status_code == 400)
    check("origen con enabled no booleano rechazado", c.post("/api/bot/settings/allowed-origins", json={"origin": "WATCHLIST", "enabled": "si", "confirm": "CAMBIAR_CONFIG"}).status_code == 400)
    r = c.post("/api/bot/settings/execution-method", json={"use_integrated": False, "confirm": "CAMBIAR_CONFIG"})
    check("metodo de ejecucion va como parametro", r.status_code == 200 and calls[-1][3] == {"use_integrated": "false"})
    check("direccion invalida rechazada", c.post("/api/bot/directions/update", json={"symbol": "BTCUSDT", "direction": "UP", "confirm": "CAMBIAR_CONFIG"}).status_code == 400)
    check("limite diario negativo rechazado", c.post("/api/bot/settings/daily-risk-limit", json={"daily_risk_limit": -1, "confirm": "CAMBIAR_CONFIG"}).status_code == 400)

    # Claves: su propia palabra
    calls.clear()
    check("claves con la palabra de config: no llegan", c.post("/api/bot/credentials", json={"api_key": "a", "api_secret": "b", "demo": True, "confirm": "CAMBIAR_CONFIG"}).status_code == 400 and not calls)
    check("claves sin demo booleano: no llegan", c.post("/api/bot/credentials", json={"api_key": "a", "api_secret": "b", "confirm": "CAMBIAR_CLAVES"}).status_code == 400 and not calls)
    r = c.post("/api/bot/credentials", json={"api_key": " a ", "api_secret": "b", "demo": True, "confirm": "CAMBIAR_CLAVES"})
    check("claves validas llegan limpias", r.status_code == 200 and calls[-1][2] == {"api_key": "a", "api_secret": "b", "demo": True})

    # Cuentas de Bybit
    calls.clear()
    AID = "0123456789ab"
    check("agregar cuenta sin la palabra: no llega", c.post("/api/bot/accounts", json={"name": "Real", "api_key": "k", "api_secret": "s", "demo": False, "confirm": "CAMBIAR_CONFIG"}).status_code == 400 and not calls)
    check("agregar cuenta sin nombre: no llega", c.post("/api/bot/accounts", json={"name": " ", "api_key": "k", "api_secret": "s", "demo": False, "confirm": "CAMBIAR_CLAVES"}).status_code == 400 and not calls)
    check("agregar cuenta sin demo booleano: no llega", c.post("/api/bot/accounts", json={"name": "R", "api_key": "k", "api_secret": "s", "confirm": "CAMBIAR_CLAVES"}).status_code == 400 and not calls)
    r = c.post("/api/bot/accounts", json={"name": " Real ", "api_key": " k ", "api_secret": "s", "demo": False, "confirm": "CAMBIAR_CLAVES"})
    check("agregar cuenta: llega limpia", r.status_code == 200 and calls[-1][1] == "/api/accounts" and calls[-1][2] == {"name": "Real", "api_key": "k", "api_secret": "s", "demo": False})
    calls.clear()
    check("activar sin la palabra: no llega", c.post(f"/api/bot/accounts/{AID}/activate", json={"confirm": "CAMBIAR_CONFIG"}).status_code == 400 and not calls)
    check("activar con id invalido: no llega", c.post("/api/bot/accounts/xyz/activate", json={"confirm": "CAMBIAR_CUENTA"}).status_code == 400 and not calls)
    r = c.post(f"/api/bot/accounts/{AID}/activate", json={"confirm": "CAMBIAR_CUENTA"})
    check("activar: una llamada al bot", r.status_code == 200 and calls == [("POST", f"/api/accounts/{AID}/activate", None, None)])
    calls.clear()
    r = c.post(f"/api/bot/accounts/{AID}/delete", json={"confirm": "CAMBIAR_CLAVES"})
    check("borrar cuenta: DELETE al bot", r.status_code == 200 and calls == [("DELETE", f"/api/accounts/{AID}", None, None)])
    calls.clear()
    r = c.post(f"/api/bot/accounts/{AID}/rename", json={"name": "Real BTC", "confirm": "CAMBIAR_CONFIG"})
    check("renombrar cuenta: PUT al bot", r.status_code == 200 and calls == [("PUT", f"/api/accounts/{AID}", {"name": "Real BTC"}, None)])
    calls.clear()

    # Posiciones desde el grafico: cerrar, mover SL/TP y cancelar, cada uno con su palabra
    calls.clear()
    check("cerrar posicion sin la palabra: no llega", c.post("/api/bot/position/close", json={"symbol": "BTCUSDT", "side": "Buy", "confirm": "MOVER_STOP"}).status_code == 400 and not calls)
    check("cerrar posicion con lado invalido: no llega", c.post("/api/bot/position/close", json={"symbol": "BTCUSDT", "side": "long", "confirm": "CERRAR_POSICION"}).status_code == 400 and not calls)
    r = c.post("/api/bot/position/close", json={"symbol": "btcusdt", "side": "Sell", "confirm": "CERRAR_POSICION"})
    check("cerrar posicion: una llamada al bot", r.status_code == 200 and calls == [("POST", "/api/position/close", {"symbol": "BTCUSDT", "side": "Sell"}, None)])
    calls.clear()
    check("quitar el SL (0): no llega", c.post("/api/bot/position/trading-stop", json={"symbol": "BTCUSDT", "side": "Buy", "stop_loss": 0, "confirm": "MOVER_STOP"}).status_code == 400 and not calls)
    check("mover sin SL ni TP: no llega", c.post("/api/bot/position/trading-stop", json={"symbol": "BTCUSDT", "side": "Buy", "confirm": "MOVER_STOP"}).status_code == 400 and not calls)
    check("mover el stop con la palabra de cerrar: no llega", c.post("/api/bot/position/trading-stop", json={"symbol": "BTCUSDT", "side": "Buy", "stop_loss": 99000, "confirm": "CERRAR_POSICION"}).status_code == 400 and not calls)
    r = c.post("/api/bot/position/trading-stop", json={"symbol": "BTCUSDT", "side": "Buy", "stop_loss": "99000.5", "take_profit": 0, "confirm": "MOVER_STOP"})
    check("mover SL y quitar TP: llega con los dos", r.status_code == 200 and calls == [("POST", "/api/position/trading-stop", {"symbol": "BTCUSDT", "side": "Buy", "stop_loss": 99000.5, "take_profit": 0.0}, None)], str(calls))
    calls.clear()
    check("cancelar con id raro: no llega", c.post("/api/bot/orders/cancel", json={"symbol": "BTCUSDT", "order_id": "../x", "confirm": "CANCELAR_ORDEN"}).status_code == 400 and not calls)
    r = c.post("/api/bot/orders/cancel", json={"symbol": "BTCUSDT", "order_id": "1a2b-3c", "confirm": "CANCELAR_ORDEN"})
    check("cancelar orden: una llamada al bot", r.status_code == 200 and calls == [("POST", "/api/orders/cancel", {"symbol": "BTCUSDT", "order_id": "1a2b-3c"}, None)])
    calls.clear()
    c.get("/api/bot/orders/open?symbol=ethusdt")
    check("ordenes abiertas de una moneda", calls == [("GET", "/api/orders/open", None, {"symbol": "ETHUSDT"})], str(calls))
    calls.clear()

    # Journal
    c.get("/api/bot/journal?days=99999&symbol=btcusdt")
    check("journal: dias acotados y moneda limpia", calls == [("GET", "/api/journal/trades", None, {"days": 3650, "symbol": "BTCUSDT"})], str(calls))
    calls.clear()
    check("nota vacia: no llega", c.post("/api/bot/journal/BTCUSDT-Sell-1/note", json={"text": "  "}).status_code == 400 and not calls)
    check("nota a un id raro: no llega", c.post("/api/bot/journal/x y/note", json={"text": "hola"}).status_code in (400, 404) and not calls)
    r = c.post("/api/bot/journal/close:abc-1:1794/note", json={"text": " Entre tarde "})
    check("nota: llega limpia al bot", r.status_code == 200 and calls == [("POST", "/api/journal/trades/close:abc-1:1794/note", {"text": "Entre tarde"}, None)], str(calls))
    calls.clear()

    # Lista de monedas
    sl = SymbolList(TMP / "data")
    check("monedas de fabrica sin archivo", sl.load() == DEFAULT_SYMBOLS)
    sl.add("LINKUSDT")
    check("moneda agregada queda guardada", SymbolList(TMP / "data").load()[-1] == "LINKUSDT" and not list((TMP / "data").glob("*.tmp")))
    sl.remove("LINKUSDT")
    check("moneda quitada", "LINKUSDT" not in sl.load())
    (TMP / "data" / "symbols.json").write_text("{roto", encoding="utf-8")
    try:
        sl.load()
        check("archivo de monedas danado: error, no lista de fabrica", False)
    except ValueError:
        check("archivo de monedas danado: error, no lista de fabrica", True)

    # Dias oficiales pendientes: solo monedas con almacen, hasta ayer UTC
    import official  # noqa: E402
    from datetime import date  # noqa: E402
    store = TMP / "store"
    for sym, day in (("BTCUSDT", "2026-11-04"), ("ETHUSDT", "2026-11-11")):
        (store / sym / "2026").mkdir(parents=True, exist_ok=True)
        (store / sym / "2026" / f"{sym}_{day}.npz").write_bytes(b"")
    todo = official.pending(store, ["BTCUSDT", "ETHUSDT", "XRPUSDT"], today=date(2026, 11, 12))
    check("dias oficiales pendientes", todo == {"BTCUSDT": "2026-11-05"}, str(todo))

    # Candado de un solo grabador: otro proceso no lo puede tomar mientras este lo tiene
    os.environ["ORDERFLOW_DATA"] = str(TMP / "of")
    backend = HERE.parents[1] / "5.Order_flow" / "backend"
    sys.path.insert(0, str(backend))
    import local_tape  # noqa: E402
    check("este proceso toma el candado", local_tape._take_lock())
    probe = ("import os,sys; sys.path.insert(0, r'%s'); os.environ['ORDERFLOW_DATA']=r'%s'; import local_tape; "
             "print('TOMA' if local_tape._take_lock() else 'OCUPADO')") % (backend, TMP / "of")
    out = subprocess.run([sys.executable, "-B", "-c", probe], capture_output=True, text=True, timeout=60).stdout.strip()
    check("otro proceso no lo toma mientras este graba", out.endswith("OCUPADO"), out)
    local_tape._lock_fh.close()
    local_tape._lock_fh = None
    out = subprocess.run([sys.executable, "-B", "-c", probe], capture_output=True, text=True, timeout=60).stdout.strip()
    check("al soltarlo, otro proceso lo toma", out.endswith("TOMA"), out)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
