# local_tape.py - Graba en este PC los trades de Bybit, con la finura del almacen de App 1.
#
# Usa el mismo grabador del collector de la nube (../cloud_collector/tape_recorder.py, sin copiarlo):
#   OrderFlowData/live/local/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape
# Cada LOCAL_TAPE_SECONDS (60) guarda lo nuevo y lanza en un proceso aparte
# PanelOrderFlow/sync_nube.py --sin-nube, que une lo del PC con lo ya bajado de la nube y arma
# OrderFlowData/live/store y live/flow. Cada LOCAL_TAPE_CLOUD_MINUTES (15) otro proceso baja la nube
# (--solo-nube), aparte: una nube lenta nunca frena el armado de cada minuto.
# El armado va en otro proceso para no frenar el Swing: un dia de BTC tarda cerca de 1.5 s.
#
# Variables: ORDERFLOW_DATA (carpeta de datos), ORDERFLOW_TOOLS (build_store.py y build_flow.py), LOCAL_TAPE=0 lo apaga, LOCAL_TAPE_SECONDS,
# LOCAL_TAPE_CLOUD_MINUTES (0 = no bajar de la nube), LOCAL_TAPE_PYTHON (python para el armado).
#
# Un solo proceso graba: el backend 11000 o el servidor de la suite (12.AltagraciaTradingSuite), el que tome
# primero el candado live/local/recorder.lock. El otro reintenta cada minuto y toma el relevo si el primero se cierra.
import asyncio
import logging
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "cloud_collector"))
from tape_recorder import TapeRecorder  # noqa: E402

logger = logging.getLogger(__name__)

DATA = Path(os.environ.get("ORDERFLOW_DATA", r"C:\Users\inven\OrderFlowData"))
TOOLS = Path(os.environ.get("ORDERFLOW_TOOLS", str(DATA / "tools")))
ENABLED = os.environ.get("LOCAL_TAPE", "1") != "0"
SECONDS = max(15, int(os.environ.get("LOCAL_TAPE_SECONDS", "60")))
CLOUD_MINUTES = int(os.environ.get("LOCAL_TAPE_CLOUD_MINUTES", "15"))
SYNC_SCRIPT = HERE.parents[1] / "PanelOrderFlow" / "sync_nube.py"
BUILD_TIMEOUT = 600
CLOUD_TIMEOUT = 3600

_recorder = None
_task = None
_lock_fh = None
_waiting = None
LOCK_RETRY_SECONDS = 60
_stats = {"builds": 0, "build_errors": 0, "last_build": None, "last_build_seconds": None, "last_error": None,
          "last_cloud": None, "cloud_errors": 0, "cloud_running": False, "last_cloud_error": None}
_cloud_task = None


def get_recorder():
    return _recorder


def _take_lock() -> bool:
    """Candado de un solo grabador. El sistema lo suelta solo si el proceso muere."""
    global _lock_fh
    if _lock_fh is not None:
        return True
    path = DATA / "live" / "local" / "recorder.lock"
    path.parent.mkdir(parents=True, exist_ok=True)
    fh = open(path, "a+b")
    try:
        fh.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        fh.close()
        return False
    _lock_fh = fh
    return True


async def start(ws_manager, symbols):
    """Empieza a grabar los trades que recibe ws_manager. No lanza excepciones.
    Si otro proceso ya graba, espera y reintenta cada minuto."""
    global _waiting
    if not ENABLED or _recorder is not None or _waiting is not None:
        return
    try:
        if _take_lock():
            await _start(ws_manager, symbols)
            return
    except Exception as e:
        logger.error(f"[LOCAL_TAPE] No se pudo tomar el candado: {e}")
    print("[STARTUP] Grabador local de trades: otro proceso ya graba; se reintenta cada minuto")
    _waiting = asyncio.create_task(_wait_lock(ws_manager, symbols))


async def _wait_lock(ws_manager, symbols):
    global _waiting
    while True:
        await asyncio.sleep(LOCK_RETRY_SECONDS)
        try:
            if _take_lock():
                _waiting = None
                await _start(ws_manager, symbols)
                return
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.error(f"[LOCAL_TAPE] No se pudo tomar el candado: {e}")


async def _start(ws_manager, symbols):
    global _recorder, _task
    try:
        rec = TapeRecorder(symbols, DATA / "live" / "local", keep_days=3, snapshot_seconds=SECONDS)
        await asyncio.to_thread(rec.load_scales)
        rec.resume_today()
        _recorder = rec
        ws_manager.tape = rec
        _task = asyncio.create_task(_loop(rec))
        logger.info(f"[LOCAL_TAPE] Grabando trades de {len(rec.scales)} monedas en {rec.root}")
        print(f"[STARTUP] Grabador local de trades: {len(rec.scales)} monedas en {rec.root}")
    except Exception as e:
        logger.error(f"[LOCAL_TAPE] No se pudo iniciar: {e}")
        print(f"[STARTUP] Warning: grabador local de trades no iniciado: {e}")


async def stop():
    global _task, _waiting, _cloud_task
    if _waiting:
        _waiting.cancel()
        _waiting = None
    if _cloud_task:
        _cloud_task.cancel()
        _cloud_task = None
    if _task:
        _task.cancel()
        _task = None
    if _recorder is not None:
        try:
            await _recorder.flush()
        except Exception as e:
            logger.error(f"[LOCAL_TAPE] Error al guardar al apagar: {e}")


async def _run_sync(mode: str, timeout: int) -> str:
    """mode: "--sin-nube" (unir y armar) o "--solo-nube" (bajar). Devuelve la salida o lanza RuntimeError."""
    python = os.environ.get("LOCAL_TAPE_PYTHON") or sys.executable
    args = [python, "-B", str(SYNC_SCRIPT), "--datos", str(DATA), "--herramientas", str(TOOLS), "--dias", "3", mode]
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, cwd=str(SYNC_SCRIPT.parent))
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"tardo mas de {timeout} s")
    text = out.decode("utf-8", "replace").strip()
    if proc.returncode != 0:
        raise RuntimeError(text[-500:] or f"codigo {proc.returncode}")
    return text


async def _build():
    t0 = time.time()
    text = await _run_sync("--sin-nube", BUILD_TIMEOUT)
    _stats["builds"] += 1
    _stats["last_build"] = int(time.time() * 1000)
    _stats["last_build_seconds"] = round(time.time() - t0, 1)
    for line in text.splitlines()[-25:]:
        logger.info(f"[LOCAL_TAPE] {line}")


async def _cloud_loop():
    """Baja la nube cada CLOUD_MINUTES, una vez a la vez. Lo bajado lo une el armado siguiente."""
    while True:
        try:
            if SYNC_SCRIPT.exists() and (TOOLS / "build_store.py").exists():
                _stats["cloud_running"] = True
                text = await _run_sync("--solo-nube", CLOUD_TIMEOUT)
                _stats["last_cloud"] = int(time.time() * 1000)
                for line in text.splitlines()[-25:]:
                    logger.info(f"[LOCAL_TAPE] nube: {line}")
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _stats["cloud_errors"] += 1
            _stats["last_cloud_error"] = str(e)[-300:]
            logger.error(f"[LOCAL_TAPE] nube: {e}")
        finally:
            _stats["cloud_running"] = False
        await asyncio.sleep(CLOUD_MINUTES * 60)


async def _loop(rec):
    global _cloud_task
    last_cleanup = 0.0
    if CLOUD_MINUTES > 0 and _cloud_task is None:
        _cloud_task = asyncio.create_task(_cloud_loop())
    while True:
        await asyncio.sleep(SECONDS)
        try:
            await rec.flush()
            if time.time() - last_cleanup > 6 * 3600:
                await asyncio.to_thread(rec.cleanup)
                last_cleanup = time.time()
            if not SYNC_SCRIPT.exists() or not (TOOLS / "build_store.py").exists():
                continue  # sin herramientas del almacen solo se graba
            await _build()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _stats["build_errors"] += 1
            _stats["last_error"] = str(e)[-300:]
            logger.error(f"[LOCAL_TAPE] {e}")


def status() -> dict:
    if _recorder is None:
        return {"enabled": ENABLED, "running": False, "other_process_records": _waiting is not None}
    return dict(enabled=ENABLED, running=True, root=str(_recorder.root), symbols=sorted(_recorder.scales),
                every_seconds=SECONDS, cloud_minutes=CLOUD_MINUTES, tape=_recorder.get_stats(), build=dict(_stats))
