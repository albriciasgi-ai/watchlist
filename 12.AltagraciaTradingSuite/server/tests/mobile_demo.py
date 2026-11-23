# Servidor de demostracion de la puerta movil: datos inventados, sin bot, sin Bybit y sin tocar los datos de la suite.
# Sirve para ver la app (13.AltagraciaMobile) en el navegador:
#   1. C:\Python314\python.exe -B tests\mobile_demo.py [puerto]     (13092 de fabrica, en 127.0.0.1)
#   2. en 13.AltagraciaMobile:  npm run dev   y abrir http://localhost:13010
#   3. en Ajustes de la app, pegar el codigo que imprime este programa
import json
import struct
import sys
import tempfile
import time
import zlib
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402
from fastapi import HTTPException  # noqa: E402
import mobile_devices  # noqa: E402
import mobile_events  # noqa: E402
import mobile_gate  # noqa: E402

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 13092
TMP = Path(tempfile.mkdtemp(prefix="suite_mobile_demo_"))
NOW = int(time.time() * 1000)
MIN, HOUR = 60_000, 3_600_000


def png(width: int, height: int, rgb) -> bytes:
    """Un PNG liso, para las capturas de mentira."""
    row = b"\x00" + bytes(rgb) * width
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))  # noqa: E731
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(row * height)) + chunk(b"IEND", b""))


class DemoJournal:
    def __init__(self, folder: Path):
        self.folder = folder
        for name, color in (("decision", (40, 60, 110)), ("open", (30, 90, 80)), ("close", (110, 50, 60)), ("after", (80, 70, 40))):
            (folder / "demo").mkdir(parents=True, exist_ok=True)
            (folder / "demo" / f"img_{name}.png").write_bytes(png(480, 300, color))

    def merge(self, trades):
        for t in trades:
            shots = [("open", t.get("opened_at"))]
            if t.get("status") == "closed":
                shots += [("close", t.get("closed_at")), ("after", t.get("closed_at"))]
            t["decision"] = None
            if t.get("origin") == "MANUAL":
                shots.insert(0, ("decision", t["opened_at"] - 2 * MIN))
                t["decision"] = {"note": "Barrido del minimo con volumen y regreso al valor.", "levels": [
                    {"label": "VAL", "source": "VP Periodic", "role": "support", "price": t["entry"] * 0.997, "note": "donde entro"},
                    {"label": "POC", "source": "VP Periodic", "role": "target", "price": t["entry"] * 1.012}]}
            t["images"] = [{"kind": k, "image": f"demo/img_{k}.png", "at": at, "frame": "15m", **({"until": at + 150 * MIN} if k == "after" else {})}
                           for k, at in shots]
        return trades

    def image_path(self, session, filename):
        path = self.folder / session / filename
        return path if session == "demo" and path.is_file() and ".." not in filename else None


def trade(tid, symbol, side, entry, sl, tp, opened, *, closed=None, pnl=None, r=None, exit_=None, origin="WATCHLIST", pattern="SWING_DETECTOR", size=1.0):
    return {"trade_id": tid, "symbol": symbol, "side": side, "size": size, "entry": entry, "stop_loss": sl, "take_profit": tp,
            "initial_stop_loss": sl, "initial_take_profit": tp, "leverage": "10", "opened_at": opened, "closed_at": closed,
            "status": "closed" if closed else "open", "pnl": pnl, "r": r, "exit": exit_, "pnl_estimated": False, "origin": origin,
            "pattern": pattern, "account": "Demo", "mode": "DEMO", "pre_existing": False, "notes": [], "closes": [], "changes": [],
            "duration_min": round((closed - opened) / MIN, 1) if closed else None}


TRADES = [
    trade("BTCUSDT-Sell-1", "BTCUSDT", "Sell", 79261.4, 82293.4, 65227.5, NOW - 30 * HOUR, size=0.003),
    trade("ARBUSDT-Buy-7", "ARBUSDT", "Buy", 0.14702, 0.1441, 0.1529, NOW - 40 * MIN, origin="MANUAL", pattern="MANUAL_TRADE", size=2000),
    trade("SOLUSDT-Buy-3", "SOLUSDT", "Buy", 81.35, 78.91, 85.42, NOW - 9 * HOUR, closed=NOW - 6 * HOUR, pnl=11.6, r=1.93, exit_=85.4, size=3),
    trade("DOGEUSDT-Sell-2", "DOGEUSDT", "Sell", 0.0985, 0.1003, 0.0949, NOW - 27 * HOUR, closed=NOW - 26 * HOUR, pnl=-4.9, r=-1.09, exit_=0.1003, size=2500),
    trade("ETHUSDT-Buy-5", "ETHUSDT", "Buy", 1850.2, 1822.0, 1906.0, NOW - 50 * HOUR, closed=NOW - 44 * HOUR, pnl=27.4, r=1.86, exit_=1905.1,
          origin="MANUAL", pattern="MANUAL_TRADE", size=0.5),
]
POSITIONS = [
    {"symbol": "BTCUSDT", "side": "Sell", "size": 0.003, "entryPrice": "79261.4", "markPrice": "71534", "unrealizedPnl": "23.18", "leverage": "10",
     "liqPrice": 86800.0, "stopLoss": 82293.4, "takeProfit": 65227.5},
    {"symbol": "ARBUSDT", "side": "Buy", "size": 2000, "entryPrice": "0.14702", "markPrice": "0.14655", "unrealizedPnl": "-0.94", "leverage": "10",
     "liqPrice": 0.1338, "stopLoss": None, "takeProfit": 0.1529},
]


async def demo_bot(method, path, **kw):
    if method != "GET":
        raise HTTPException(status_code=405, detail="la demostracion solo lee")
    if path == "/api/status":
        return {"status": "online", "mode": "DEMO", "account": {"name": "Demo"}, "trading_paused": False, "credentials_configured": True}
    if path == "/api/positions":
        return {"success": True, "positions": POSITIONS, "source": "stream", "account": {"name": "Demo"}}
    if path == "/api/journal/trades":
        return {"success": True, "trades": [dict(t) for t in TRADES]}
    if path == "/api/alerts/critical":
        return {"success": True, "alerts": []}
    raise HTTPException(status_code=404, detail="ruta desconocida")


devices = mobile_devices.DeviceStore(TMP)
watch = mobile_events.EventWatch(TMP, demo_bot, devices)
for kind, t, ago in (("trade_open", TRADES[2], 9 * HOUR), ("trade_close", TRADES[2], 6 * HOUR), ("trade_open", TRADES[1], 40 * MIN)):
    watch._emit(kind, **mobile_events.describe(kind, t), at=NOW - ago, trade_id=t["trade_id"], symbol=t["symbol"], side=t["side"],
                pnl=t["pnl"] if kind == "trade_close" else None, r=t["r"] if kind == "trade_close" else None)
watch._emit("critical", "Aviso critico: ARBUSDT", "ARBUSDT Buy lleva 20 s sin stop loss", at=NOW - 39 * MIN, symbol="ARBUSDT")

device = devices.pair("Demostracion")
qr = {"v": 1, "host": "127.0.0.1", "port": PORT, "id": device["id"], "secret": device["secret"], "name": device["name"]}
print("\nCodigo para pegar en Ajustes de la app (vale 10 minutos sin usar; es solo de esta demostracion):\n")
print(json.dumps(qr), "\n", flush=True)

app = mobile_gate.make_app(devices, watch, demo_bot, DemoJournal(TMP / "images"), "demo")
uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
