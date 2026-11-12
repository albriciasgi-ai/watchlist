# official.py - Mantiene al dia el almacen oficial (los archivos diarios de Bybit) de las monedas que ya lo tienen.
#
# Cada 6 horas (y 10 minutos despues de arrancar) mira el ultimo dia de OrderFlowData/store/<MONEDA>. Si falta
# alguno hasta ayer (UTC), corre en otro proceso las mismas herramientas que el panel de Order Flow:
#   tools/ingest.py MONEDA --desde <dia siguiente>     (baja y compacta los trades; tiene su propio candado)
#   tools/build_store.py MONEDA                          (arma store/ y flow/ de los dias nuevos)
# El dia oficial siempre manda sobre lo de la nube y el PC. SUITE_OFFICIAL=0 lo apaga.
import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

logger = logging.getLogger("suite.official")
FIRST_DELAY = 600
EVERY = 6 * 3600
TIMEOUT = 4 * 3600

_task = None
_state = {"enabled": os.environ.get("SUITE_OFFICIAL", "1") != "0", "running": None, "last_run": None, "last_result": {}}


def last_day(store: Path, symbol: str):
    days = sorted(p.stem.rsplit("_", 1)[1] for p in (store / symbol).glob("*/*.npz"))
    return days[-1] if days else None


def pending(store: Path, symbols, today=None):
    """Monedas con almacen oficial y el dia desde el que les falta, hasta ayer UTC."""
    today = today or datetime.now(timezone.utc).date()
    out = {}
    for sym in symbols:
        last = last_day(store, sym)
        if last is None:
            continue  # sin almacen: la historia completa se baja desde el panel, no aqui
        nxt = datetime.strptime(last, "%Y-%m-%d").date() + timedelta(days=1)
        if nxt < today:
            out[sym] = nxt.isoformat()
    return out


async def _run(args, cwd):
    proc = await asyncio.create_subprocess_exec(*args, cwd=str(cwd), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        return False, "tardo demasiado"
    text = out.decode("utf-8", "replace").strip()
    return proc.returncode == 0, text[-400:]


async def catch_up(data: Path, symbols_fn):
    tools, store = data / "tools", data / "store"
    if not (tools / "ingest.py").exists() or not (tools / "build_store.py").exists():
        return
    todo = pending(store, symbols_fn())
    for sym, since in todo.items():
        _state["running"] = sym
        ok, text = await _run([sys.executable, "-I", str(tools / "ingest.py"), sym, "--desde", since], tools)
        if ok:
            ok, text = await _run([sys.executable, "-I", str(tools / "build_store.py"), sym], tools)
        _state["last_result"][sym] = {"since": since, "ok": ok, "after": last_day(store, sym), "detail": text[-200:]}
        logger.info(f"[OFFICIAL] {sym} desde {since}: {'ok' if ok else 'fallo'} -> {last_day(store, sym)}")
    _state["running"] = None
    _state["last_run"] = int(time.time() * 1000)


async def _loop(data, symbols_fn):
    await asyncio.sleep(FIRST_DELAY)
    while True:
        try:
            await catch_up(data, symbols_fn)
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _state["running"] = None
            logger.error(f"[OFFICIAL] {e}")
        await asyncio.sleep(EVERY)


def start(data: Path, symbols_fn):
    global _task
    if _state["enabled"] and _task is None:
        _task = asyncio.create_task(_loop(Path(data), symbols_fn))


def stop():
    global _task
    if _task:
        _task.cancel()
        _task = None


def status() -> dict:
    return dict(_state)
