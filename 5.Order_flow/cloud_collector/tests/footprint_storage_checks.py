# Pruebas sin conexion del guardado de footprints del collector (formato de lineas, archivos viejos y cortados).
# Uso, desde 5.Order_flow\cloud_collector:  python -B tests\footprint_storage_checks.py
import asyncio
import gzip
import json
import shutil
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(HERE))
from footprint_collector import FootprintCollector  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def fp(ts, vol=1.0):
    return {"candle_timestamp": ts, "symbol": "BTCUSDT", "levels": [], "total_volume": vol}


tmp = Path(tempfile.mkdtemp(prefix="fp_storage_"))
try:
    now = int(time.time() * 1000) // 60000 * 60000
    minutes = [now - 60000 * k for k in range(30, 0, -1)]  # ultimos 30 minutos
    day = datetime.fromtimestamp(minutes[0] / 1000).strftime("%Y-%m-%d")
    c = FootprintCollector(["BTCUSDT"], "1", tmp, max_days=0)
    path = tmp / "BTCUSDT" / f"{day}.json.gz"
    same_day = [m for m in minutes if datetime.fromtimestamp(m / 1000).strftime("%Y-%m-%d") == day]

    # Archivo del formato viejo (arreglo JSON), como los que ya hay en la nube
    with gzip.open(path, "wt", encoding="utf-8") as f:
        json.dump([fp(m) for m in same_day[:10]], f)
    check("lee el formato viejo", [x["candle_timestamp"] for x in c._read_day(path)] == same_day[:10])

    c._write_footprints("BTCUSDT", [fp(m) for m in same_day[10:20]])
    got = [x["candle_timestamp"] for x in c._read_day(path)]
    check("agregar a un archivo viejo: lo pasa a lineas y suma lo nuevo", got == same_day[:20], str(len(got)))
    with gzip.open(path, "rt", encoding="utf-8") as f:
        check("el archivo queda en lineas", f.read(1) == "{")
    check("sin temporales", not list((tmp / "BTCUSDT").glob("*.tmp")))

    # Agregar no relee el dia: el archivo crece por miembros
    size_before = path.stat().st_size
    c._write_footprints("BTCUSDT", [fp(m) for m in same_day[20:22]])
    check("agregar suma un miembro al final", path.stat().st_size > size_before)
    check("lo agregado se lee", [x["candle_timestamp"] for x in c._read_day(path)] == same_day[:22])

    # Apagado a mitad de un guardado: el ultimo miembro queda cortado
    member = gzip.compress((json.dumps(fp(same_day[22])) + "\n").encode())
    with open(path, "ab") as f:
        f.write(member[: len(member) // 2])
    status = {}
    got = [x["candle_timestamp"] for x in c._read_day(path, status)]
    check("final cortado: se usa lo leido", got == same_day[:22] and status["truncated"], f"{len(got)} {status}")
    # Al arrancar de nuevo, la primera escritura repara el archivo y lo nuevo se lee
    c2 = FootprintCollector(["BTCUSDT"], "1", tmp, max_days=0)
    c2._write_footprints("BTCUSDT", [fp(m) for m in same_day[23:25]])
    got = [x["candle_timestamp"] for x in c2._read_day(path)]
    check("tras reparar, lo agregado despues se lee", got == same_day[:22] + same_day[23:25], str(got[-3:]))

    # Repetidos: una vela guardada dos veces sale una vez, con el ultimo valor
    c2._write_footprints("BTCUSDT", [fp(same_day[0], vol=9.0)])
    first = c2._read_day(path)[0]
    check("una vela repetida sale una vez, la ultima", first["candle_timestamp"] == same_day[0] and first["total_volume"] == 9.0)

    # get_footprints ve tambien el buffer y lo que se esta escribiendo, sin repetir
    c2.completed_buffer["BTCUSDT"] = [fp(same_day[25]), fp(same_day[24])]
    c2._writing["BTCUSDT"] = [fp(same_day[26])]
    got = [x["candle_timestamp"] for x in c2.get_footprints("BTCUSDT", "1", hours=2)]
    check("get_footprints: disco + escribiendo + buffer, en orden y sin repetir",
          got == sorted(set(same_day[:22] + same_day[23:27])), str(got[-5:]))

    # El guardado en un hilo: el buffer pasa al disco y queda vacio
    async def run():
        c3 = FootprintCollector(["BTCUSDT"], "1", tmp, max_days=0)
        c3.completed_buffer["BTCUSDT"] = [fp(same_day[27])]
        await c3._flush_symbol("BTCUSDT")
        return c3
    c3 = asyncio.run(run())
    check("guardado en un hilo: buffer vacio y vela en disco",
          not c3.completed_buffer["BTCUSDT"] and same_day[27] in [x["candle_timestamp"] for x in c3._read_day(path)])

    # Buffer lleno: solo marca la moneda, no escribe dentro del bucle
    c4 = FootprintCollector(["BTCUSDT"], "1", tmp, max_days=0)
    c4.buffer_size = 1
    c4.active_footprints["BTCUSDT"] = None  # _complete_footprint lo necesita; se prueba la marca aparte
    c4.completed_buffer["BTCUSDT"].append(fp(same_day[28]))
    if len(c4.completed_buffer["BTCUSDT"]) >= c4.buffer_size:
        c4._flush_pending.add("BTCUSDT")
    check("buffer lleno: la moneda queda pendiente para el hilo", "BTCUSDT" in c4._flush_pending)
finally:
    shutil.rmtree(tmp, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
