"""
Pone al día, en segundo plano, los datos del probador que no salen del caché de App 1 (21/11):
velas de las monedas nuevas (1h, 4h, 15m y 5m, candles_update.py), OI de 4 horas (oi_update.py), funding
(funding_update.py) y, desde el 21/11, los flujos on-chain diarios de Coin Metrics (onchain_flows.py) y lo nuevo del OI
de 5 minutos de Bybit y Binance (oi_history.py; la bajada completa se corre a mano). Lo lanza el backend al arrancar
(main.py, start_in_background) en un proceso aparte.

- Una vez cada MIN_HOURS horas: con uvicorn --reload el backend arranca otra vez con cada cambio de código.
- Una a la vez: candado en OrderFlowData/candles/actualizacion.lock (vence a las LOCK_HOURS horas, por si se cortó).
- Registro en OrderFlowData/candles/actualizacion.log; la hora de la última vuelta completa en ultima_actualizacion.txt.
- TESTER_AUTO_UPDATE=0 lo apaga.

    python -B market_update.py           (respeta el intervalo)
    python -B market_update.py --force   (corre ya)
"""
import os
import subprocess
import sys
import time
from pathlib import Path

import candles_update

DIR = candles_update.DIR
LOCK = DIR / "actualizacion.lock"
STAMP = DIR / "ultima_actualizacion.txt"
LOG = DIR / "actualizacion.log"
MIN_HOURS = 2
LOCK_HOURS = 3


def _age_hours(path):
    try:
        return (time.time() - path.stat().st_mtime) / 3600
    except OSError:
        return None


def due():
    """Si toca correr: nada corriendo y la última vuelta hace MIN_HOURS horas o más."""
    if os.environ.get("TESTER_AUTO_UPDATE", "1") == "0" or not DIR.exists():
        return False
    lock = _age_hours(LOCK)
    if lock is not None and lock < LOCK_HOURS:
        return False
    last = _age_hours(STAMP)
    return last is None or last >= MIN_HOURS


def start_in_background():
    """Lanza esta herramienta en otro proceso, sin ventana, si toca. Nunca falla el arranque del backend."""
    try:
        if not due():
            return False
        flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) | getattr(subprocess, "DETACHED_PROCESS", 0)
        with open(LOG, "a", encoding="utf-8") as log:
            subprocess.Popen([sys.executable, "-B", str(Path(__file__).resolve())], cwd=str(Path(__file__).parent),
                             stdout=log, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL, creationflags=flags,
                             close_fds=True)
        return True
    except Exception as error:
        print("[STARTUP] No se pudo lanzar la actualización de datos:", error, flush=True)
        return False


def _take_lock():
    if LOCK.exists() and (_age_hours(LOCK) or 0) >= LOCK_HOURS:
        LOCK.unlink(missing_ok=True)  # Quedó de una vuelta cortada
    try:
        fd = os.open(LOCK, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    return True


def _step(name, symbols, fn):
    print(f"--- {name}: {len(symbols)}", flush=True)
    failed = 0
    for s in symbols:
        try:
            fn(s)
        except Exception as error:  # Una moneda que falla no detiene a las demás
            failed += 1
            print(s, "falló:", error, flush=True)
    return failed


def run():
    import funding_update
    import oi_update
    import rule_tester

    failed = 0
    coins = sorted(p.name.split(".")[0] for p in DIR.glob("*.json.gz"))
    with candles_update._client() as client:
        def candles(s):
            candles_update.update(s, client)
            for tf in candles_update.FINE:
                if candles_update._path(s, tf).exists():
                    candles_update.update_fine(s, tf, client)
        failed += _step("Velas", coins, candles)
    oi = sorted(p.name.split("_")[0] for p in Path(oi_update.oi_store.OI_DIR).glob("*_4h.json"))
    failed += _step("OI de 4 horas", oi, oi_update.update)
    import oi_history
    if oi_history.take_lock():  # Con la bajada completa corriendo, lo nuevo espera a la próxima vuelta
        oi_history.release_lock()

        def oi5(s):
            bad = oi_history.run([s]) or []
            if bad:
                raise RuntimeError("; ".join(f"{name}: {error}" for name, _, error in bad))
        failed += _step("OI de 5 minutos de Bybit y Binance (lo nuevo)", oi_history.coins(), oi5)
    else:
        print("--- OI de 5 minutos: la bajada completa sigue corriendo", flush=True)
    have = {p.stem for p in Path(funding_update.flow_filters.FUNDING_DIR).glob("*.json")}
    funding = sorted(have | set(rule_tester.candle_symbols("all")))
    with funding_update.httpx.Client(timeout=30, headers={"User-Agent": "app1-funding"}) as client:
        failed += _step("Funding", funding, lambda s: funding_update.update(s, client))
    import onchain_flows
    failed += _step("Flujos on-chain (Coin Metrics)", ["coinmetrics"], lambda _: onchain_flows.update())
    return failed


if __name__ == "__main__":
    force = "--force" in sys.argv
    if not force and not due():
        sys.exit(0)
    if not _take_lock():
        print(time.strftime("%Y-%m-%d %H:%M"), "otra actualización sigue corriendo", flush=True)
        sys.exit(0)
    try:
        t0 = time.time()
        print(f"=== {time.strftime('%Y-%m-%d %H:%M')} actualización de datos del probador", flush=True)
        failed = run()
        STAMP.write_text(time.strftime("%Y-%m-%d %H:%M:%S"), encoding="utf-8")
        print(f"=== terminada en {(time.time() - t0) / 60:.1f} min, {failed} fallas", flush=True)
    finally:
        LOCK.unlink(missing_ok=True)
