# Pruebas sin conexion del registro del servidor (quiet_log.py, 23/11/2026):
#   - el filtro del registro de acceso: sin los pedidos que salen bien, un mismo error a lo sumo una vez cada 10 min y
#     la linea con los que no se anotaron;
#   - con el registro de uvicorn tal como lo arma al arrancar;
#   - SUITE_ACCESS_LOG=1 lo deja todo, y el filtro se pone una sola vez;
#   - los pedidos lentos y que el servidor de la suite lo usa.
# Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\log_checks.py
import asyncio
import io
import logging
import logging.config
import os
import shutil
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_log_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
os.environ.pop("SUITE_ACCESS_LOG", None)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import uvicorn.config  # noqa: E402
import quiet_log  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def access(path, status, method="GET"):
    """Un registro como el que arma uvicorn para cada pedido."""
    return logging.LogRecord("uvicorn.access", logging.INFO, __file__, 0, '%s - "%s %s HTTP/%s" %d',
                             ("127.0.0.1:50000", method, path, "1.1", status), None)


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


try:
    # --- el filtro ---
    clock, said = Clock(), []
    f = quiet_log.QuietAccess(clock=clock, wall=lambda: 0, out=said.append)
    check("un pedido que sale bien no se anota", not f.filter(access("/api/bot/positions", 200)))
    check("tampoco una redirección o un 304", not f.filter(access("/", 304)))
    check("el primer error se anota", f.filter(access("/api/bot/positions", 503)))
    clock.t += 30
    check("el mismo error antes de 10 min no", not f.filter(access("/api/bot/positions", 503)))
    check("la ruta sin la consulta: con otros parámetros es el mismo", not f.filter(access("/api/bot/positions?x=1", 503)))
    check("otra ruta con el mismo código sí", f.filter(access("/api/bot/orders/open", 503)))
    check("la misma ruta con otro código sí", f.filter(access("/api/bot/positions", 504)))
    check("otro método sí", f.filter(access("/api/bot/positions", 503, method="POST")))
    clock.t += quiet_log.REPEAT_S
    check("pasados 10 min se anota otra vez", f.filter(access("/api/bot/positions", 503)))
    check("con una línea de los que no se anotaron", said == ["[SUITE] 2 pedidos iguales sin anotar desde las "
                                                              + __import__("time").strftime("%H:%M", __import__("time").localtime(0))
                                                              + ": GET /api/bot/positions 503"], said)
    said.clear()
    clock.t += quiet_log.REPEAT_S
    check("sin repetidos, sin esa línea", f.filter(access("/api/bot/positions", 503)) and said == [], said)
    other = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 0, "otro mensaje", None, None)
    check("otro mensaje del registro de acceso pasa", f.filter(other))
    odd = access("/x", 200)
    odd.args = ("a", "GET", "/x", "1.1", "raro")
    check("un código que no es número pasa", f.filter(odd))
    saved = quiet_log.MAX_KEYS
    quiet_log.MAX_KEYS = 3
    g = quiet_log.QuietAccess(clock=clock, out=said.append)
    for i in range(10):
        g.filter(access(f"/api/ticker/C{i}USDT", 503))
    check("recuerda a lo sumo MAX_KEYS errores distintos", len(g._seen) <= 3, len(g._seen))
    quiet_log.MAX_KEYS = saved

    # --- con el registro de uvicorn tal como lo arma al arrancar ---
    logging.config.dictConfig(uvicorn.config.LOGGING_CONFIG)
    acc = logging.getLogger("uvicorn.access")
    check("el filtro se pone", quiet_log.quiet_access() and sum(isinstance(x, quiet_log.QuietAccess) for x in acc.filters) == 1)
    quiet_log.quiet_access()
    check("una sola vez aunque se llame dos", sum(isinstance(x, quiet_log.QuietAccess) for x in acc.filters) == 1)
    buf = io.StringIO()
    for h in acc.handlers:
        h.setStream(buf)
    acc.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:1", "GET", "/api/ticker/BTCUSDT", "1.1", 200)
    acc.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:1", "GET", "/api/bot/overview", "1.1", 503)
    acc.info('%s - "%s %s HTTP/%s" %d', "127.0.0.1:1", "GET", "/api/bot/overview", "1.1", 503)
    lines = buf.getvalue().splitlines()
    check("con el formato de uvicorn: solo el primer 503", len(lines) == 1 and "/api/bot/overview" in lines[0]
          and "503" in lines[0], lines)
    acc.filters = [x for x in acc.filters if not isinstance(x, quiet_log.QuietAccess)]
    os.environ["SUITE_ACCESS_LOG"] = "1"
    check("SUITE_ACCESS_LOG=1 lo deja todo", quiet_log.quiet_access() is False
          and not any(isinstance(x, quiet_log.QuietAccess) for x in acc.filters))
    os.environ.pop("SUITE_ACCESS_LOG")

    # --- los pedidos lentos ---
    app = FastAPI()
    quiet_log.install(app)

    @app.get("/rapido")
    async def fast():
        return {"ok": True}

    @app.get("/lento")
    async def slow():
        await asyncio.sleep(0.08)
        return {"ok": True}

    saved = quiet_log.SLOW_S
    quiet_log.SLOW_S = 0.05
    out = io.StringIO()
    with redirect_stdout(out), TestClient(app) as client:
        client.get("/rapido")
        client.get("/lento?dias=2")
    quiet_log.SLOW_S = saved
    text = out.getvalue()
    check("un pedido lento se anota con su ruta, su código y lo que tardó",
          "[SUITE] pedido lento: GET /lento?dias=2 200 en " in text and "/rapido" not in text, text)
    check("el filtro se pone al arrancar", quiet_log.quiet_access in app.router.on_startup)

    # --- en el servidor de la suite ---
    import main  # noqa: E402
    names = [getattr(m.kwargs.get("dispatch"), "__name__", "") for m in main.app.user_middleware]
    check("el servidor de la suite tiene los pedidos lentos y el filtro", "_slow_requests" in names
          and quiet_log.quiet_access in main.app.router.on_startup, names)
    check("y la protección de los pedidos de afuera va antes", names.index("_local_only") < names.index("_slow_requests"), names)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pasan")
sys.exit(1 if failed else 0)
