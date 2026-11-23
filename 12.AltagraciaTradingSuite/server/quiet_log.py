# quiet_log.py - El registro del servidor sin el ruido de cada pedido (23/11/2026).
#
# La app de escritorio guarda todo lo que escribe el servidor en data/servidor_desktop.log, y uvicorn anota cada
# pedido. La pagina pregunta por precios, el bot, el scanner y demas cada pocos segundos: el 23/11 el registro pesaba
# 221 MB en 11 dias (unos 20 MB por dia). El 76% eran pedidos que salieron bien y el 24%, 503 del bot apagado
# (sobre todo /api/bot/positions y /api/bot/orders/open, que la pagina pide cada pocos segundos).
#
#   - quiet_access(): los pedidos que salen bien (codigo menor que 400) no se anotan. De los que dan error se anota el
#     primero, y los iguales (mismo metodo, ruta y codigo) a lo sumo una vez cada REPEAT_S, con una linea que dice
#     cuantos no se anotaron. SUITE_ACCESS_LOG=1 vuelve a anotarlos todos, para diagnosticar.
#   - install(app): un pedido que tarda SLOW_S segundos o mas se anota con su ruta, su codigo y lo que tardo, y
#     quiet_access() corre al arrancar el servidor (uvicorn ya armo su registro).
#
# La app de escritorio, ademas, guarda como .1 el registro que pasa de 20 MB al lanzar el servidor (desktop/main.cjs).
import logging
import os
import time

SLOW_S = 5.0          # un pedido que tarda esto o mas se anota como lento
REPEAT_S = 600.0      # un mismo error se anota a lo sumo una vez cada 10 min
MAX_KEYS = 500        # errores distintos que se recuerdan (rutas por moneda incluidas)


class QuietAccess(logging.Filter):
    """Filtro para el registro de acceso de uvicorn: sin los pedidos que salen bien y sin repetir un mismo error."""

    def __init__(self, repeat_s: float = None, clock=time.monotonic, wall=time.time, out=print):
        super().__init__()
        self.repeat_s = REPEAT_S if repeat_s is None else repeat_s
        self._clock, self._wall, self._out = clock, wall, out
        self._seen = {}   # (metodo, ruta, codigo) -> [ultima vez anotado (reloj), no anotados desde entonces, hora]

    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        if not (isinstance(args, tuple) and len(args) == 5):
            return True   # otro mensaje de uvicorn.access: pasa
        try:
            status = int(args[4])
        except (TypeError, ValueError):
            return True
        if status < 400:
            return False
        key = (str(args[1]), str(args[2]).split("?", 1)[0], status)
        now = self._clock()
        seen = self._seen.get(key)
        if seen and now - seen[0] < self.repeat_s:
            seen[1] += 1
            return False
        if seen and seen[1]:
            since = time.strftime("%H:%M", time.localtime(seen[2]))
            self._out(f"[SUITE] {seen[1]} pedidos iguales sin anotar desde las {since}: {key[0]} {key[1]} {status}")
        if len(self._seen) >= MAX_KEYS:
            self._seen.clear()
        self._seen[key] = [now, 0, self._wall()]
        return True


def quiet_access() -> bool:
    """Pone el filtro en el registro de acceso de uvicorn (una sola vez). Con SUITE_ACCESS_LOG=1, no."""
    if os.environ.get("SUITE_ACCESS_LOG") == "1":
        return False
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, QuietAccess) for f in logger.filters):
        logger.addFilter(QuietAccess(out=lambda text: print(text, flush=True)))
    return True


def install(app):
    """Los pedidos lentos al registro, y el filtro de acceso al arrancar."""
    @app.middleware("http")
    async def _slow_requests(request, call_next):
        began = time.perf_counter()
        response = await call_next(request)
        took = time.perf_counter() - began
        if took >= SLOW_S:
            path = request.url.path + (f"?{request.url.query}" if request.url.query else "")
            print(f"[SUITE] pedido lento: {request.method} {path} {response.status_code} en {took:.1f} s", flush=True)
        return response

    app.add_event_handler("startup", quiet_access)
