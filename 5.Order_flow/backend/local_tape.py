# local_tape.py - Graba en este PC los trades de Bybit, con la finura del almacen de App 1.
#
# Usa el mismo grabador del collector de la nube (../cloud_collector/tape_recorder.py, sin copiarlo):
#   OrderFlowData/live/local/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape
# Cada LOCAL_TAPE_SECONDS (60) guarda lo nuevo y lanza en un proceso aparte
# PanelOrderFlow/sync_nube.py --sin-nube, que une lo del PC con lo ya bajado de la nube y arma
# OrderFlowData/live/store y live/flow. Cada LOCAL_TAPE_CLOUD_MINUTES (15) baja tambien de la nube.
# El armado va en otro proceso para no frenar el Swing: un dia de BTC tarda cerca de 1.5 s.
#
# Variables: ORDERFLOW_DATA (carpeta de datos), ORDERFLOW_TOOLS (build_store.py y build_flow.py), LOCAL_TAPE=0 lo apaga, LOCAL_TAPE_SECONDS,
# LOCAL_TAPE_CLOUD_MINUTES (0 = no bajar de la nube), LOCAL_TAPE_PYTHON (python para el armado).
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

_recorder = None
_task = None
_stats = {"builds": 0, "build_errors": 0, "last_build": None, "last_build_seconds": None, "last_error": None,
          "last_cloud": None}


def get_recorder():
    return _recorder


async def start(ws_manager, symbols):
    """Empieza a grabar los trades que recibe ws_manager. No lanza excepciones."""
    global _recorder, _task
    if not ENABLED or _recorder is not None:
        return
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
    global _task
    if _task:
        _task.cancel()
        _task = None
    if _recorder is not None:
        try:
            await _recorder.flush()
        except Exception as e:
            logger.error(f"[LOCAL_TAPE] Error al guardar al apagar: {e}")


async def _build(cloud: bool):
    python = os.environ.get("LOCAL_TAPE_PYTHON") or sys.executable
    args = [python, "-B", str(SYNC_SCRIPT), "--datos", str(DATA), "--herramientas", str(TOOLS), "--dias", "3"]
    if not cloud:
        args.append("--sin-nube")
    t0 = time.time()
    proc = await asyncio.create_subprocess_exec(
        *args, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT, cwd=str(SYNC_SCRIPT.parent))
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), timeout=BUILD_TIMEOUT)
    except asyncio.TimeoutError:
        proc.kill()
        raise RuntimeError(f"el armado tardo mas de {BUILD_TIMEOUT} s")
    text = out.decode("utf-8", "replace").strip()
    if proc.returncode != 0:
        raise RuntimeError(text[-500:] or f"codigo {proc.returncode}")
    _stats["builds"] += 1
    _stats["last_build"] = int(time.time() * 1000)
    _stats["last_build_seconds"] = round(time.time() - t0, 1)
    if cloud:
        _stats["last_cloud"] = _stats["last_build"]
    for line in text.splitlines()[-25:]:
        logger.info(f"[LOCAL_TAPE] {line}")


async def _loop(rec):
    last_cloud = 0.0
    last_cleanup = 0.0
    while True:
        await asyncio.sleep(SECONDS)
        try:
            await rec.flush()
            if time.time() - last_cleanup > 6 * 3600:
                await asyncio.to_thread(rec.cleanup)
                last_cleanup = time.time()
            if not SYNC_SCRIPT.exists() or not (TOOLS / "build_store.py").exists():
                continue  # sin herramientas del almacen solo se graba
            cloud = CLOUD_MINUTES > 0 and time.time() - last_cloud >= CLOUD_MINUTES * 60
            await _build(cloud)
            if cloud:
                last_cloud = time.time()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            _stats["build_errors"] += 1
            _stats["last_error"] = str(e)[-300:]
            logger.error(f"[LOCAL_TAPE] {e}")


def status() -> dict:
    if _recorder is None:
        return {"enabled": ENABLED, "running": False}
    return dict(enabled=ENABLED, running=True, root=str(_recorder.root), symbols=sorted(_recorder.scales),
                every_seconds=SECONDS, cloud_minutes=CLOUD_MINUTES, tape=_recorder.get_stats(), build=dict(_stats))
