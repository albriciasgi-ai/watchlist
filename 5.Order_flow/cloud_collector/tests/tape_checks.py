# Pruebas sin conexion del grabador de trades (.tape) del collector.
# Uso, desde 5.Order_flow/cloud_collector:  python -B tests/tape_checks.py
import asyncio
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))

import tape_recorder as tr  # noqa: E402
from tape_format import read_tape  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


# Conversion exacta de texto a entero escalado
check("precio con menos decimales que la escala", tr.to_scaled_int("74462.5", 1) == (744625, True))
check("cantidad con ceros a la derecha", tr.to_scaled_int("0.0100", 3) == (10, True))
check("valor con mas decimales que la escala: se marca inexacto", tr.to_scaled_int("1.23456", 4)[1] is False)
check("entero sin decimales", tr.to_scaled_int("12", 2) == (1200, True))

DAY = "2026-11-12"
D0 = tr.day_start_ms(DAY)
tmp = Path(tempfile.mkdtemp(prefix="tape_checks_"))
try:
    rec = tr.TapeRecorder(["BTCUSDT"], tmp, snapshot_seconds=60)
    rec.scales = {"BTCUSDT": (1, 3)}

    # Collector corriendo desde antes del dia: el dia queda cubierto desde su inicio
    rec.started_at = D0 - 3_600_000
    rec.add_trade("BTCUSDT", {"T": D0 + 5_000, "p": "100.5", "v": "0.010", "S": "Buy"})
    rec.add_trade("BTCUSDT", {"T": D0 + 3_000, "p": "100.4", "v": "0.020", "S": "Sell", "RPI": True})
    buf = rec.buffers[("BTCUSDT", DAY)]
    check("dia cubierto desde su inicio si el collector ya escuchaba", buf.covered_from == D0)

    # Corte que cruza la medianoche: el hueco se reparte en los dos dias
    rec.mark_disconnected(D0 + 86_400_000 - 30_000)
    rec.mark_connected(D0 + 86_400_000 + 45_000)
    nxt = rec.buffers.get(("BTCUSDT", "2026-11-13"))
    check("corte a medianoche: hueco al final del dia", buf.gaps == [[D0 + 86_400_000 - 30_000, D0 + 86_400_000]], str(buf.gaps))
    check("corte a medianoche: hueco al inicio del dia siguiente",
          nxt is not None and nxt.gaps == [[D0 + 86_400_000, D0 + 86_400_000 + 45_000]], str(nxt.gaps if nxt else None))

    # Escritura: archivo legible, ordenado por hora y con las escalas de Bybit
    asyncio.run(rec.flush())
    meta, t, p, q, side, rpi = read_tape(rec.path("BTCUSDT", DAY))
    check("archivo ordenado por hora", list(t) == [(D0 + 3_000) * 10, (D0 + 5_000) * 10])
    check("precio, cantidad, lado y RPI exactos",
          list(p) == [1004, 1005] and list(q) == [20, 10] and list(side) == [-1, 1] and list(rpi) == [True, False])
    check("cabecera con escalas y unidad de hora", meta["price_scale"] == 10 and meta["qty_scale"] == 1000 and meta["t_unit"] == "1e-4s")
    check("dia en curso no queda completo", meta["complete"] is False and meta["final"] is False)

    # Dia terminado sin huecos y cubierto desde su inicio: completo
    rec2 = tr.TapeRecorder(["BTCUSDT"], tmp / "b", snapshot_seconds=60)
    rec2.scales = {"BTCUSDT": (1, 3)}
    rec2.started_at = D0 - 1
    rec2.add_trade("BTCUSDT", {"T": D0 + 1_000, "p": "1.0", "v": "1", "S": "Buy"})
    real_time = time.time
    tr.time.time = lambda: (D0 + 86_400_000 + 300_000) / 1000  # 5 min despues de terminar el dia
    try:
        asyncio.run(rec2.flush())
    finally:
        tr.time.time = real_time
    meta2 = read_tape(rec2.path("BTCUSDT", DAY))[0]
    check("dia terminado, sin huecos y desde su inicio: completo", meta2["complete"] is True and meta2["final"] is True)
    check("dia terminado sale de memoria", ("BTCUSDT", DAY) not in rec2.buffers)

    # Reinicio: recarga el dia y anota el hueco desde el ultimo guardado
    rec3 = tr.TapeRecorder(["BTCUSDT"], tmp, snapshot_seconds=60)
    rec3.scales = {"BTCUSDT": (1, 3)}
    rec3.started_at = meta["saved_at"] + 90_000
    real_day_of = tr.day_of
    tr.day_of = lambda ms: DAY if ms == rec3.started_at else real_day_of(ms)
    try:
        rec3.resume_today()
    finally:
        tr.day_of = real_day_of
    b3 = rec3.buffers.get(("BTCUSDT", DAY))
    check("reinicio: recupera los trades guardados", b3 is not None and len(b3.t) == 2)
    check("reinicio: hueco desde el ultimo guardado", b3 is not None and [meta["saved_at"], rec3.started_at] in b3.gaps)

    # Listado para el sincronizador
    days = rec.list_days()["BTCUSDT"]
    check("listado de dias con su estado", days and days[0]["day"] == DAY and days[0]["n"] == 2)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
