# Corre las pruebas sin conexion del backend de la Watchlist (App 2 y App 7) sobre una copia temporal.
# No abre sockets, no llama a Bybit ni al bot y no toca config/, logs/ ni los caches reales:
# cada prueba trabaja dentro de la copia, que se borra al terminar.
#
# Uso, desde 2.WatchlistConIndicadores/backend:
#   C:\Python314\python.exe -B tests\run_checks.py  (el .venv de este backend no tiene aiohttp)
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
SCRIPTS = (
    "swing_service_checks.py",
    "swing_endpoints_checks.py",
    "vwap_service_checks.py",
    "backend_protection_checks.py",
    "watchlist_checks.py",
)


def main() -> int:
    code = 0
    env = {**os.environ, "PYTHONUTF8": "1", "PYTHONIOENCODING": "utf-8"}
    for script in SCRIPTS:
        # Una copia nueva por archivo de pruebas: ninguno hereda el estado del otro
        copy = Path(tempfile.mkdtemp(prefix="swing_checks_"))
        try:
            for source in BACKEND.glob("*.py"):
                shutil.copy2(source, copy / source.name)
            print(f"\n=== {script} ===", flush=True)
            result = subprocess.run(
                [sys.executable, "-B", str(HERE / script), str(copy)],
                env=env,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            lines = (result.stdout or "").splitlines()
            shown = [ln for ln in lines if ln.startswith(("PASA", "FALLA", "      (")) or "pruebas pasan" in ln]
            print("\n".join(shown) if shown else (result.stdout or "")[-2000:])
            if result.returncode != 0:
                code = result.returncode
                tail = (result.stderr or "").strip().splitlines()[-15:]
                if tail:
                    print("\n".join(tail))
        finally:
            shutil.rmtree(copy, ignore_errors=True)
    return code


if __name__ == "__main__":
    sys.exit(main())
