# -*- coding: utf-8 -*-
"""
Actualizacion automatica del almacen de liquidaciones. La corre la tarea programada de Windows
"App1 Liquidaciones" todos los dias a las 7:30, sin ventana (pythonw). Si el equipo estaba apagado,
corre apenas se pueda.

- Coinalyze: en cada corrida. Sus intervalos de 15 minutos solo alcanzan unos 20 dias hacia atras.
- MarginPad: cuando el dia mas nuevo guardado tiene MARGINPAD_EVERY_DAYS dias o mas. Alcanza 30 dias.
- Bitfinex no: es muy lento y aporta poco.

Todo se agrega: nunca borra ni cambia lo guardado. Registro en OrderFlowData/liquidations/actualizacion.log.
Si otra corrida sigue activa, no hace nada.

Uso, desde backend/:
  .venv\\Scripts\\pythonw.exe -B liq_auto.py            corrida normal (la de la tarea programada)
  .venv\\Scripts\\python.exe -B liq_auto.py --revisar   solo dice que haria, sin bajar nada
"""
import csv
import datetime as dt
import os
import sys
import time
import traceback
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import liq_update as L  # noqa: E402

SYMBOLS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "SUIUSDT", "TRXUSDT", "ARBUSDT", "GALAUSDT"]
MARGINPAD_EVERY_DAYS = 5
LOG = L.LIQ_DIR / "actualizacion.log"
LOCK = L.LIQ_DIR / "actualizacion.lock"
LOCK_STALE_S = 4 * 3600  # Un candado mas viejo es de una corrida que se corto
LOG_MAX_BYTES = 2_000_000


def newest_marginpad_day(symbol):
    path = L.days_path(symbol)
    if not path.exists():
        return None
    days = [row["date_utc"] for row in csv.DictReader(open(path, encoding="ascii"))]
    return dt.date.fromisoformat(max(days)) if days else None


def plan():
    """Que toca hacer hoy: MarginPad si algun simbolo tiene su ultimo dia muy atras, y si hay clave de Coinalyze"""
    today = dt.datetime.now(dt.timezone.utc).date()
    newest = {symbol: newest_marginpad_day(symbol) for symbol in SYMBOLS}
    late = [s for s, day in newest.items() if day is None or (today - day).days >= MARGINPAD_EVERY_DAYS]
    return {"newest": newest, "marginpad": late, "coinalyze": L.COINALYZE_KEY.exists()}


def lock_busy():
    return LOCK.exists() and time.time() - LOCK.stat().st_mtime < LOCK_STALE_S


def run():
    started = time.time()
    print(f"\n=== {dt.datetime.now():%Y-%m-%d %H:%M:%S} corrida automatica", flush=True)
    todo = plan()
    if todo["marginpad"]:
        print("MarginPad: atrasados", todo["marginpad"], flush=True)
        for symbol in SYMBOLS:
            try:
                L.marginpad(symbol)
            except Exception as error:
                print(symbol, "MarginPad error", repr(error), flush=True)
    else:
        print("MarginPad: al dia", {s: str(d) for s, d in todo["newest"].items()}, flush=True)

    if not todo["coinalyze"]:
        print("Coinalyze: falta la clave en", L.COINALYZE_KEY, flush=True)
    else:
        for symbol in SYMBOLS:
            try:
                L.coinalyze_download(symbol)
                L.coinalyze_build(symbol)
            except SystemExit as stop:  # Clave rechazada: no sirve seguir
                print("Coinalyze detenido:", stop, flush=True)
                break
            except Exception as error:  # Una moneda que falla no detiene las demas
                print(symbol, "Coinalyze error", repr(error), flush=True)
    print(f"=== terminada en {(time.time() - started) / 60:.1f} min", flush=True)


def main():
    if "--revisar" in sys.argv:
        todo = plan()
        print("Simbolos:", SYMBOLS)
        print("Ultimo dia de MarginPad:", {s: str(d) for s, d in todo["newest"].items()})
        print("MarginPad tocaria:", todo["marginpad"] or "no, esta al dia")
        print("Clave de Coinalyze:", "si" if todo["coinalyze"] else "falta")
        print("Otra corrida activa:", "si" if lock_busy() else "no")
        print("Registro:", LOG)
        return

    L.LIQ_DIR.mkdir(parents=True, exist_ok=True)
    if LOG.exists() and LOG.stat().st_size > LOG_MAX_BYTES:
        os.replace(LOG, LOG.with_suffix(".log.1"))
    with open(LOG, "a", encoding="utf-8") as log:
        sys.stdout = sys.stderr = log  # pythonw no tiene consola: todo va al registro
        if lock_busy():
            print(f"\n=== {dt.datetime.now():%Y-%m-%d %H:%M:%S} otra corrida sigue activa: no se hace nada", flush=True)
            return
        LOCK.write_text(str(os.getpid()), encoding="ascii")
        try:
            run()
        except Exception:
            traceback.print_exc()
        finally:
            LOCK.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
