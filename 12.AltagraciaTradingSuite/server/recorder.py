# recorder.py - La suite graba sola los trades de sus monedas, sin depender del backend 11000.
#
# Usa el grabador del backend de Order Flow (5.Order_flow/backend/local_tape.py) sin copiarlo: escribe en
# OrderFlowData/live/local/tape y cada minuto une lo del PC con la nube y arma live/store y live/flow.
# Graba un solo proceso a la vez (candado en live/local/recorder.lock): si el 11000 ya graba, la suite espera
# y toma el relevo cuando se cierre. Esta conexion a Bybit es solo de lectura (publicTrade).
import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

logger = logging.getLogger("suite.recorder")
WS_URL = "wss://stream.bybit.com/v5/public/linear"
PING_SECONDS = 20
SILENCE_SECONDS = 60


class TradeFeed:
    """Lo minimo que local_tape espera de un ws_manager: el atributo tape, alimentado con publicTrade."""

    def __init__(self, symbols):
        self.symbols = list(dict.fromkeys(s.upper() for s in symbols))
        self.tape = None
        self.connected = False
        self.last_message = None
        self.reconnects = 0
        self._ws = None
        self._task = None

    def start(self):
        self._task = asyncio.create_task(self._run())

    async def stop(self):
        if self._task:
            self._task.cancel()
            self._task = None

    async def add_symbol(self, symbol: str):
        if symbol in self.symbols:
            return
        self.symbols.append(symbol)
        if self._ws is not None:
            try:
                await self._ws.send(json.dumps({"op": "subscribe", "args": [f"publicTrade.{symbol}"]}))
            except Exception:
                pass

    async def _run(self):
        import websockets
        while True:
            try:
                async with websockets.connect(WS_URL, ping_interval=None, max_size=2 ** 22) as ws:
                    self._ws = ws
                    for i in range(0, len(self.symbols), 10):
                        args = [f"publicTrade.{s}" for s in self.symbols[i:i + 10]]
                        await ws.send(json.dumps({"op": "subscribe", "args": args}))
                    self.connected = True
                    last_ping = time.time()
                    while True:
                        try:
                            raw = await asyncio.wait_for(ws.recv(), timeout=PING_SECONDS)
                        except asyncio.TimeoutError:
                            raw = None
                        now = time.time()
                        if now - last_ping >= PING_SECONDS:
                            await ws.send('{"op":"ping"}')
                            last_ping = now
                        if raw is None:
                            if self.last_message and now - self.last_message > SILENCE_SECONDS:
                                raise ConnectionError("sin datos de Bybit")
                            continue
                        self.last_message = now
                        self._handle(raw)
            except asyncio.CancelledError:
                raise
            except Exception as e:
                logger.warning(f"[RECORDER] conexion perdida: {e}")
            self._ws = None
            if self.connected and self.tape is not None:
                self.tape.mark_disconnected(int(self.last_message * 1000) if self.last_message else None)
            self.connected = False
            self.reconnects += 1
            await asyncio.sleep(3)

    def _handle(self, raw):
        try:
            msg = json.loads(raw)
        except ValueError:
            return
        topic = msg.get("topic") or ""
        if not topic.startswith("publicTrade.") or self.tape is None:
            return
        trades = msg.get("data") or []
        if not trades:
            return
        symbol = topic.split(".", 1)[1]
        try:
            if self.tape.disconnected_at is not None:
                self.tape.mark_connected(int(trades[0].get("T", 0)) or None)
            for t in trades:
                self.tape.add_trade(symbol, t)
        except Exception as e:
            logger.error(f"[RECORDER] trades de {symbol} descartados: {e}")


_feed = None
_local_tape = None


def _module(data_dir: Path, repo_dir: Path):
    os.environ.setdefault("ORDERFLOW_DATA", str(data_dir))
    backend = repo_dir / "5.Order_flow" / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    import local_tape  # noqa: E402
    return local_tape


async def start(symbols, data_dir: Path, repo_dir: Path):
    """Arranca la grabacion. Con SUITE_RECORD=0 no graba (por ejemplo en una copia de prueba)."""
    global _feed, _local_tape
    if os.environ.get("SUITE_RECORD", "1") == "0" or _feed is not None:
        return
    try:
        _local_tape = _module(Path(data_dir), Path(repo_dir))
        _feed = TradeFeed(symbols)
        _feed.start()
        await _local_tape.start(_feed, _feed.symbols)
    except Exception as e:
        logger.error(f"[RECORDER] no se pudo iniciar: {e}")
        print(f"[SUITE] Grabador de trades no iniciado: {e}")


async def stop():
    if _local_tape is not None:
        await _local_tape.stop()
    if _feed is not None:
        await _feed.stop()


async def add_symbol(symbol: str):
    """Moneda nueva: se suscribe y, si esta suite es la que graba, empieza a grabarla."""
    if _feed is None:
        return
    await _feed.add_symbol(symbol)
    rec = _local_tape.get_recorder() if _local_tape else None
    if rec is not None and symbol not in rec.scales:
        rec.symbols.append(symbol)
        await asyncio.to_thread(rec.load_scales)


def status() -> dict:
    if _feed is None:
        return {"enabled": os.environ.get("SUITE_RECORD", "1") != "0", "running": False}
    tape = _local_tape.status() if _local_tape else {}
    return {"enabled": True, "connected": _feed.connected, "symbols": len(_feed.symbols),
            "last_message": int(_feed.last_message * 1000) if _feed.last_message else None,
            "reconnects": _feed.reconnects, "records": bool(tape.get("running")),
            "other_process_records": bool(tape.get("other_process_records")),
            "last_build": (tape.get("build") or {}).get("last_build"), "build_errors": (tape.get("build") or {}).get("build_errors")}
