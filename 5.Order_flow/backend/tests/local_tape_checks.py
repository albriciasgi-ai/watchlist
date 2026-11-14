# Pruebas sin conexion del arranque del grabador local de trades (local_tape.py, 13/11/2026):
# si al arrancar no hay red (Bybit no responde los decimales de cada moneda), se reintenta sin frenar el arranque y,
# mientras tanto, el estado no dice que graba otro proceso. Antes quedaba sin grabar ni bajar la nube hasta reiniciar.
# Uso, desde 5.Order_flow/backend:  python -B tests/local_tape_checks.py
import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="local_tape_checks_"))
os.environ["ORDERFLOW_DATA"] = str(TMP)
HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import local_tape  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


class FakeWs:
    tape = None


try:
    calls = {"n": 0}

    def flaky(self):
        calls["n"] += 1
        if calls["n"] == 1:
            raise OSError("<urlopen error [Errno 11001] getaddrinfo failed>")
        self.scales = {s: (1, 3) for s in self.symbols}

    local_tape.TapeRecorder.load_scales = flaky
    local_tape.START_RETRY_SECONDS = 0.2
    local_tape.DATA = TMP
    local_tape._loop = lambda rec: asyncio.sleep(3600)   # sin guardar ni bajar la nube en la prueba

    async def scenario():
        ws = FakeWs()
        await asyncio.wait_for(local_tape.start(ws, ["BTCUSDT", "ETHUSDT"]), 2)   # no se queda esperando la red
        await asyncio.sleep(0.1)                                                   # el primer intento ya fallo
        first = local_tape.status()
        for _ in range(30):
            if local_tape._recorder is not None:
                break
            await asyncio.sleep(0.1)
        second = local_tape.status()
        await local_tape.stop()
        return first, second, ws.tape is not None

    first, second, attached = asyncio.run(scenario())
    check("sin red, el arranque no se frena y queda el motivo", first["running"] is False and "getaddrinfo" in (first.get("start_error") or ""),
          str(first))
    check("mientras espera la red no dice que graba otro proceso", first["other_process_records"] is False, str(first))
    check("al volver la red arranca solo y graba", second["running"] is True and attached and calls["n"] == 2, str(second))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok} de {len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
