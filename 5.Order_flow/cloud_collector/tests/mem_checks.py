# Pruebas sin conexion de la devolucion de memoria del collector (23/11/2026): trim_memory, mem_guard y /health.
# malloc_trim solo existe en Linux: aqui se prueba con un libc falso. Lo de verdad se mide en Northflank.
# Uso, desde 5.Order_flow/cloud_collector:  python -B tests/mem_checks.py
import asyncio
import importlib.util
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="collector_mem_"))
os.environ["DATA_DIR"] = str(TMP)
os.environ["SYMBOLS"] = "BTCUSDT"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import httpx  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


try:
    spec = importlib.util.spec_from_file_location("collector_main", HERE.parent / "main.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)   # sin lifespan: no conecta a Bybit

    if not sys.platform.startswith("linux"):
        check("fuera de Linux no hay malloc_trim y no falla", m._LIBC is None and m.trim_memory()["released"] is False)
        check("fuera de Linux la memoria del proceso es None", m.rss_mb() is None)

    class FakeLibc:
        def __init__(self):
            self.calls = []

        def malloc_trim(self, pad):
            self.calls.append(pad)
            return 1

    fake, rss = FakeLibc(), iter([340.0, 205.5])
    m._LIBC, m.rss_mb = fake, lambda: next(rss)
    m.mem_state.update(trims=0, last=None, freed_mb_total=0.0)
    r = m.trim_memory()
    check("llama a malloc_trim(0) y cuenta lo devuelto", fake.calls == [0] and r["released"] and r["freed_mb"] == 134.5
          and m.mem_state["trims"] == 1 and m.mem_state["freed_mb_total"] == 134.5, r)

    # El bucle: cada MEM_TRIM_SECONDS, sin romperse si malloc_trim falla
    class BadLibc:
        def malloc_trim(self, pad):
            raise OSError("roto")

    m._LIBC, m.rss_mb = BadLibc(), lambda: 300.0
    m.MEM_TRIM_SECONDS = 0.01

    async def loop_once():
        task = asyncio.create_task(m.mem_guard())
        await asyncio.sleep(0.1)
        alive = not task.done()
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
        return alive
    check("un malloc_trim que falla no detiene el bucle", asyncio.run(loop_once()))

    async def health():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=m.app), base_url="http://nube") as http:
            return (await http.get("/health")).json()
    h = asyncio.run(health())
    check("/health dice la memoria y la ultima devolucion", "memory" in h and h["memory"]["rss_mb"] == 300.0
          and h["memory"]["trims"] >= 1 and "trim_seconds" in h["memory"], h.get("memory"))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)} de {len(results)} pruebas pasaron")
sys.exit(1 if bad else 0)
