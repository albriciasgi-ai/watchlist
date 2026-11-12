# Pruebas sin conexion del journal de trades reales: aperturas (WebSocket), cierres de Bybit (closed-pnl), R, notas.
# Usa carpetas temporales (BOT_CONFIG_DIR, BOT_JOURNAL_DIR) y un Bybit simulado: nunca toca el journal ni las claves reales.
# Uso, desde 3.TradingBot_Python\backend:  C:\Python314\python.exe -B tests\journal_checks.py
import json
import os
import shutil
import sys
import tempfile
import time
from datetime import datetime, timedelta
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="bot_journal_"))
CONFIG = TMP / "config"
CONFIG.mkdir()
(CONFIG / "credentials.json").write_text(json.dumps({"api_key": "clave_demo_1111", "api_secret": "s", "demo": True}))
os.environ["BOT_CONFIG_DIR"] = str(CONFIG)
os.environ["BOT_LOG_DIR"] = str(TMP / "logs")
os.environ["BOT_JOURNAL_DIR"] = str(TMP / "journal")
os.environ["BOT_PRIVATE_STREAM"] = "0"  # el WebSocket privado nunca se conecta a Bybit en pruebas
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trading.trade_journal import TradeJournal  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


ACC = {"id": "aaaaaaaaaaaa", "name": "Cuenta principal", "mode": "demo"}
OTHER = {"id": "bbbbbbbbbbbb", "name": "Real", "mode": "live"}


def pos(symbol="BTCUSDT", side="Sell", size="0.01", entry="80000", sl="82000", tp="76000", updated=None):
    return {"symbol": symbol, "side": side, "size": size, "entryPrice": entry, "stopLoss": sl, "takeProfit": tp,
            "leverage": "10", "positionIdx": 0, "updatedTime": str(updated or int(time.time() * 1000))}


BASE_MS = int(time.time() * 1000)


def close_row(order_id, qty, exit_, pnl, symbol="BTCUSDT", closing_side="Buy", entry="80000", at=None):
    # Como en Bybit, cada registro trae su hora fija (orderId + updatedTime lo identifican)
    return {"symbol": symbol, "orderId": order_id, "side": closing_side, "closedSize": qty, "qty": qty, "avgEntryPrice": entry,
            "avgExitPrice": exit_, "closedPnl": pnl, "orderType": "Market", "execType": "Trade", "fillCount": "1",
            "leverage": "10", "updatedTime": str(at or BASE_MS + 60000)}


try:
    # ---------- TradeJournal solo ----------
    j = TradeJournal(TMP / "unit" / "trades.jsonl")
    tid = j.record_open(pos(), origin="WATCHLIST", source="SWING_DETECTOR", pattern="SWING_HIGH", account=ACC, pre_existing=False)
    check("apertura anotada como trade abierto con su origen",
          [t["status"] for t in j.trades()] == ["open"] and j.trades()[0]["origin"] == "WATCHLIST")
    j.record_close(close_row("c1", "0.004", "78000", "7.5"), ACC)
    t = j.trades()[0]
    check("cierre parcial: sigue abierto, con su P&L", t["status"] == "open" and t["pnl"] == 7.5 and t["closed_qty"] == 0.004)
    j.record_close(close_row("c2", "0.006", "79000", "5.4"), ACC)
    t = j.trades()[0]
    check("cierre total: P&L sumado y salida promedio por cantidad",
          t["status"] == "closed" and abs(t["pnl"] - 12.9) < 1e-9 and abs(t["exit"] - 78600) < 1e-6, str(t))
    check("R sobre el riesgo del SL inicial: 12.9 / ((82000 - 80000) x 0.01) = 0.645", t["r"] == 0.645, str(t["r"]))
    check("el mismo cierre dos veces no se suma", not j.record_close(close_row("c2", "0.006", "79000", "5.4"), ACC) and
          TradeJournal(TMP / "unit" / "trades.jsonl").trades()[0]["pnl"] == t["pnl"])
    # Cierre sin apertura anotada y de otra cuenta
    j.record_close(close_row("x1", "1", "3000", "-4", symbol="ETHUSDT", closing_side="Sell", entry="3010"), OTHER)
    eth = next(x for x in j.trades() if x["symbol"] == "ETHUSDT")
    check("cierre sin apertura: trade 'sin apertura', lado contrario a la orden que cerro",
          eth["origin"] == "sin apertura" and eth["side"] == "Buy" and eth["status"] == "closed" and eth["account_id"] == OTHER["id"])
    check("cada cuenta por separado", [x["symbol"] for x in j.trades(account=ACC["id"])] == ["BTCUSDT"])
    # SL que llega despues de abrir (metodo secuencial)
    tid2 = j.record_open(pos(symbol="SOLUSDT", side="Buy", size="2", entry="150", sl="0", tp="0"), origin=None, source=None,
                         pattern=None, account=ACC, pre_existing=False)
    j.record_update(tid2, pos(symbol="SOLUSDT", side="Buy", size="2", entry="150", sl="147", tp="156"),
                    TradeJournal.snapshot(pos(symbol="SOLUSDT", side="Buy", size="2", entry="150", sl="0", tp="0")))
    j.record_close(close_row("s1", "2", "156", "11.6", symbol="SOLUSDT", closing_side="Sell", entry="150"), ACC)
    sol = next(x for x in j.trades() if x["symbol"] == "SOLUSDT")
    check("SL puesto despues de abrir cuenta como inicial: R = 11.6 / 6", sol["initial_stop_loss"] == 147 and sol["r"] == round(11.6 / 6, 3)
          and sol["origin"] == "externa", str(sol))
    # Notas y una linea cortada por un apagon
    j.add_note(tid, "Entre tarde, el swing ya habia corrido")
    with open(TMP / "unit" / "trades.jsonl", "a", encoding="utf-8") as f:
        f.write('{"type": "close", "close_id": "rot')  # linea a medias
    again = TradeJournal(TMP / "unit" / "trades.jsonl")
    btc = next(x for x in again.trades() if x["symbol"] == "BTCUSDT")
    check("una linea cortada se salta y la nota sigue", btc["notes"][0]["text"].startswith("Entre tarde") and len(again.trades()) == 3)

    # ---------- dentro del bot ----------
    CLOSED = []

    class FakeClient:
        def __init__(self, api_key, api_secret, testnet=False, demo=False):
            self.api_key, self.api_secret, self.mode = api_key, api_secret, "demo" if demo else "live"
            self.base_url = "simulado"
            self._position_mode = "one_way"

        async def close(self):
            pass

        async def check_api_key(self):
            return {"valid": True, "readOnly": False}

        def get_statistics(self):
            return {}

        async def get_position(self, symbol, *a, **k):
            return {"success": True, "positions": []}

        async def get_instrument_info(self, symbol, category="linear"):
            return {"success": False}

        async def _make_request(self, method, endpoint, params=None, **kw):
            if endpoint == "/v5/position/closed-pnl":
                rows = [r for r in CLOSED if not params.get("symbol") or r["symbol"] == params["symbol"]]
                return {"retCode": 0, "result": {"list": rows, "nextPageCursor": ""}}
            return {"retCode": 0, "result": {"list": []}}

    import main  # noqa: E402
    main.BybitClient = FakeClient
    from fastapi.testclient import TestClient  # noqa: E402
    H = {"Host": "127.0.0.1:5000"}
    with TestClient(main.app) as c:
        st = main.state
        check("el journal del bot queda en la carpeta de prueba", str(main.JOURNAL_FILE).startswith(str(TMP)))
        st.stream_started_ms = int(time.time() * 1000) - 5 * 60000  # el WebSocket arranco hace 5 minutos
        # Una orden del Swing hace un minuto en el historial del bot: es el origen de la apertura
        st.order_history.append({"timestamp": (datetime.now() - timedelta(minutes=1)).isoformat(), "symbol": "BTCUSDT",
                                 "side": "Sell", "origin": "WATCHLIST", "source": "SWING_DETECTOR", "pattern": "SWING_HIGH",
                                 "status": "success"})
        old = int(time.time() * 1000) - 3 * 3600 * 1000
        positions = [pos(), pos(symbol="ETHUSDT", side="Buy", size="0.1", entry="3000", sl="2950", tp="3100", updated=old)]
        c.portal.call(main.journal_positions, positions)
        d = c.get("/api/journal/trades", headers=H).json()
        btc = next(x for x in d["trades"] if x["symbol"] == "BTCUSDT")
        eth = next(x for x in d["trades"] if x["symbol"] == "ETHUSDT")
        check("posicion nueva: apertura con el origen de la orden del bot", btc["origin"] == "WATCHLIST" and btc["source"] == "SWING_DETECTOR"
              and btc["status"] == "open" and btc["account"] == "Cuenta principal", str(btc))
        check("posicion de antes de arrancar: 'anterior'", eth["origin"] == "anterior" and eth["pre_existing"], str(eth))
        # El bot se reinicia: la misma posicion no se anota dos veces
        st.journal_active = {}
        c.portal.call(main.journal_positions, positions)
        opens = sum(1 for line in Path(main.JOURNAL_FILE).read_text(encoding="utf-8").splitlines() if '"type": "open"' in line)
        check("tras reiniciar se sigue el trade anotado (sin otra apertura)", opens == 2, str(opens))
        # SL movido: se anota el cambio
        moved = [pos(sl="81500"), positions[1]]
        c.portal.call(main.journal_positions, moved)
        btc = next(x for x in c.get("/api/journal/trades", headers=H).json()["trades"] if x["symbol"] == "BTCUSDT")
        check("SL movido: cambio anotado, el SL inicial se conserva", btc["stop_loss"] == 81500 and btc["initial_stop_loss"] == 82000
              and btc["changes"] and btc["changes"][-1].get("stop_loss") == 81500, str(btc["changes"]))
        # Se cierra en Bybit por TP: el cierre llega de closed-pnl
        CLOSED.append(close_row("tp-1", "0.01", "76000", "39.2"))
        r = c.post("/api/journal/sync", headers=H)
        btc = next(x for x in c.get("/api/journal/trades", headers=H).json()["trades"] if x["symbol"] == "BTCUSDT")
        check("cierre de Bybit: trade cerrado con P&L neto y R", r.json().get("added") == 1 and btc["status"] == "closed"
              and btc["pnl"] == 39.2 and btc["r"] == round(39.2 / 20, 3), str(btc))
        check("pedir los cierres otra vez no repite", c.post("/api/journal/sync", headers=H).json().get("added") == 0)
        # Notas
        r = c.post(f"/api/journal/trades/{btc['trade_id']}/note", headers=H, json={"text": "  Buen trade: el swing en VAH  "})
        btc = next(x for x in c.get("/api/journal/trades", headers=H).json()["trades"] if x["symbol"] == "BTCUSDT")
        check("nota agregada (sin espacios de mas)", r.status_code == 200 and btc["notes"][-1]["text"] == "Buen trade: el swing en VAH")
        check("nota a un trade que no existe: 404", c.post("/api/journal/trades/no-existe/note", headers=H, json={"text": "x"}).status_code == 404)
        check("nota vacia: rechazada", c.post(f"/api/journal/trades/{btc['trade_id']}/note", headers=H, json={"text": ""}).status_code == 422)
        check("pagina ajena no escribe notas: 403", c.post(f"/api/journal/trades/{btc['trade_id']}/note",
                                                            headers={**H, "Origin": "https://evil.example"}, json={"text": "x"}).status_code == 403)
        check("filtro por moneda", [x["symbol"] for x in c.get("/api/journal/trades?symbol=ethusdt", headers=H).json()["trades"]] == ["ETHUSDT"])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
