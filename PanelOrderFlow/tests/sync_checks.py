# Pruebas sin conexion de la union nube + PC de sync_nube.py.
# Uso, desde PanelOrderFlow:  C:\Python314\python.exe -B tests\sync_checks.py
# La ultima parte arma el almacen con OrderFlowData/tools si existe (solo lee esa carpeta).
import json
import shutil
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HERE))
import sync_nube as sn  # noqa: E402

tf = sn.load_module(sn.TAPE_FORMAT, "tape_format")
results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


DAY = "2026-11-12"
D0 = sn.day_start(DAY)
MIN = 60_000


def tape(path, minutes, covered_from, saved_at, gaps=(), final=False, price=1000, scales=(10, 1000)):
    """Un trade por minuto (a los 30 s) en los minutos dados."""
    t = np.array([(D0 + m * MIN + 30_000) * 10 for m in minutes], dtype=np.int64)
    n = len(t)
    meta = dict(symbol="BTCUSDT", date=DAY, price_scale=scales[0], qty_scale=scales[1], ts_decimals=3,
                covered_from=covered_from, saved_at=saved_at, gaps=[list(g) for g in gaps], final=final,
                complete=False, inexact=0)
    path.parent.mkdir(parents=True, exist_ok=True)
    tf.write_tape(path, meta, t, np.full(n, price, dtype=np.int64), np.full(n, 5, dtype=np.int64),
                  np.ones(n, dtype=np.int8), np.zeros(n, dtype=np.int8))


def minutes_of(t):
    return [int(x // 10 - D0) // MIN for x in t]


# Tramos
check("union de tramos", sn.union([[0, 5], [10, 20]], [[4, 12], [30, 40]]) == [[0, 20], [30, 40]])
check("resta de tramos", sn.subtract([[0, 100]], [[10, 20], [50, 60]]) == [[0, 10], [20, 50], [60, 100]])
check("cobertura: hasta el ultimo guardado menos el margen, sin huecos",
      sn.coverage(dict(covered_from=D0 + MIN, saved_at=D0 + 10 * MIN, gaps=[[D0 + 3 * MIN, D0 + 4 * MIN]]), DAY)
      == [[D0 + MIN, D0 + 3 * MIN], [D0 + 4 * MIN, D0 + 10 * MIN - sn.LAG_MS]])
check("cobertura de un dia cerrado: hasta medianoche",
      sn.coverage(dict(covered_from=D0, saved_at=D0 + 3 * MIN, final=True), DAY) == [[D0, D0 + 86_400_000]])

tmp = Path(tempfile.mkdtemp(prefix="sync_checks_"))
try:
    c, l = tmp / "c.tape", tmp / "l.tape"
    # Nube: minutos 0-59 con un corte de 20 a 30. PC: desde el minuto 15 hasta el 70
    tape(c, [m for m in range(60) if not 20 <= m < 30], D0, D0 + 60 * MIN, gaps=[[D0 + 20 * MIN, D0 + 30 * MIN]])
    tape(l, range(15, 70), D0 + 15 * MIN, D0 + 70 * MIN + 10_000, price=1001)
    meta, t, p, *_ = sn.merge_day(tf, c, l, "BTCUSDT", DAY)
    mins = minutes_of(t)
    src = {m: int(v) for m, v in zip(mins, p)}
    check("union: cada minuto una vez y en orden", mins == list(range(70)), str(mins))

    # Archivo de la nube cortado (descarga interrumpida): el dia se une con el PC y la nube se vuelve a bajar
    cut = tmp / "cut.tape"
    cut.write_bytes(c.read_bytes()[: len(c.read_bytes()) // 2])
    cut.with_suffix(".json").write_text("{}", encoding="utf-8")
    try:
        merged_cut = sn.merge_day(tf, cut, l, "BTCUSDT", DAY)
        check("nube cortada: el dia sale del PC", merged_cut is not None and merged_cut[0]["from_cloud"] == 0
              and merged_cut[0]["from_local"] == 55)
    except Exception as e:
        check("nube cortada: el dia sale del PC", False, str(e))
    check("nube cortada: se borra su estado para volver a bajarla", not cut.with_suffix(".json").exists())

    # Descarga que se corta antes de lo que anuncia Content-Length
    class _Resp:
        headers = {"Content-Length": "100"}
        def __init__(self): self.sent = False
        def read(self, n):
            if self.sent:
                return b""
            self.sent = True
            return b"x" * 40
        def __enter__(self): return self
        def __exit__(self, *a): return False
    real_urlopen, real_httpx = sn.urllib.request.urlopen, sn.USE_HTTPX
    sn.urllib.request.urlopen = lambda *a, **k: _Resp()
    sn.USE_HTTPX = False
    try:
        sn.download("http://nube/x", tmp / "d.tape")
        check("descarga incompleta rechazada (urllib)", False)
    except ValueError:
        check("descarga incompleta rechazada (urllib)", True)
    finally:
        sn.urllib.request.urlopen, sn.USE_HTTPX = real_urlopen, real_httpx

    # Con httpx (lo normal): completa se guarda, cortada se rechaza
    if sn.USE_HTTPX:
        class _Stream:
            def __init__(self, body, length): self.body, self.headers = body, {"content-length": str(length)}
            def raise_for_status(self): pass
            def iter_bytes(self, n): yield from (self.body[i:i + n] for i in range(0, len(self.body), n))
            def __enter__(self): return self
            def __exit__(self, *a): return False
        real_stream = sn.httpx.stream
        try:
            sn.httpx.stream = lambda *a, **k: _Stream(b"y" * 100, 100)
            ok = sn.download("http://nube/x", tmp / "e.tape").read_bytes() == b"y" * 100
            check("descarga completa con httpx", ok)
            sn.httpx.stream = lambda *a, **k: _Stream(b"y" * 40, 100)
            try:
                sn.download("http://nube/x", tmp / "f.tape")
                check("descarga incompleta rechazada (httpx)", False)
            except ValueError:
                check("descarga incompleta rechazada (httpx)", True)
        finally:
            sn.httpx.stream = real_stream
    check("donde cubre la nube manda la nube", all(src[m] == 1000 for m in range(20)) and all(src[m] == 1000 for m in range(30, 59)))
    check("el corte de la nube se llena con el PC", all(src[m] == 1001 for m in range(20, 30)))
    check("despues del ultimo guardado de la nube sigue el PC", all(src[m] == 1001 for m in range(60, 70)))
    check("sin huecos: los dos se cubren entre si", meta["gaps"] == [], str(meta["gaps"]))
    check("llega hasta el ultimo guardado del PC", meta["saved_at"] == D0 + 70 * MIN + 10_000 - sn.LAG_MS)
    check("cuenta de cada fuente", meta["from_cloud"] == 50 and meta["from_local"] == 20, f"{meta['from_cloud']} {meta['from_local']}")
    check("dia en curso: ni completo ni cerrado", meta["final"] is False and meta["complete"] is False)

    # Hueco que ninguna cubre
    tape(l, range(25, 70), D0 + 25 * MIN, D0 + 70 * MIN)
    meta2 = sn.merge_day(tf, c, l, "BTCUSDT", DAY)[0]
    check("lo que ninguna cubre queda como hueco", meta2["gaps"] == [[D0 + 20 * MIN, D0 + 25 * MIN]], str(meta2["gaps"]))

    # Solo el PC, empezado a mitad del dia
    meta3 = sn.merge_day(tf, tmp / "no.tape", l, "BTCUSDT", DAY)[0]
    check("solo el PC: cubre desde su primer trade", meta3["covered_from"] == D0 + 25 * MIN and meta3["from_cloud"] == 0)

    # Escalas distintas: se usa solo la nube
    tape(l, range(60, 70), D0 + 60 * MIN, D0 + 70 * MIN, scales=(100, 1000))
    meta4, t4 = sn.merge_day(tf, c, l, "BTCUSDT", DAY)[:2]
    check("escalas distintas: solo la nube", meta4["from_local"] == 0 and max(minutes_of(t4)) == 59)

    # Dia cerrado por la nube y completo
    tape(c, range(1440), D0, D0 + 86_400_000 + 120_000, final=True)
    meta5 = sn.merge_day(tf, c, tmp / "no.tape", "BTCUSDT", DAY)[0]
    check("dia cerrado sin huecos y desde su inicio: completo", meta5["final"] and meta5["complete"])

    # Una bajada a la vez (14/11): el candado no se toma dos veces; al soltarlo se vuelve a tomar
    lk = tmp / "lk" / sn.CLOUD_LOCK
    first = sn.take_lock(lk)
    second = sn.take_lock(lk)
    check("candado: otra bajada no lo toma mientras sigue la primera", first is not None and second is None)
    sn.release_lock(first)
    third = sn.take_lock(lk)
    check("candado: al terminar la primera se vuelve a tomar", third is not None)
    sn.release_lock(third)

    # Reemplazo con reintentos: el destino en uso unos segundos no hace perder la descarga
    src, dst = tmp / "r.descarga", tmp / "r.tape"
    src.write_bytes(b"nuevo")
    dst.write_bytes(b"viejo")
    real_replace, calls = sn.os.replace, {"n": 0}

    def busy_twice(a, b):
        calls["n"] += 1
        if calls["n"] <= 2:
            raise PermissionError(32, "en uso")
        real_replace(a, b)
    sn.os.replace = busy_twice
    try:
        ok = sn.replace_retry(src, dst, tries=5, wait=0)
    finally:
        sn.os.replace = real_replace
    check("reemplazo: reintenta mientras el archivo esta en uso", ok and dst.read_bytes() == b"nuevo" and calls["n"] == 3)
    src.write_bytes(b"otro")

    def always_busy(a, b):
        raise PermissionError(32, "en uso")
    sn.os.replace = always_busy
    try:
        ok2 = sn.replace_retry(src, dst, tries=3, wait=0)
    finally:
        sn.os.replace = real_replace
    check("reemplazo: si sigue en uso se rinde sin romper nada", ok2 is False and dst.read_bytes() == b"nuevo" and src.exists())
    sn.remove_quietly(tmp / "no-existe.descarga")
    check("borrar un temporal que no esta no falla", True)

    # Armado completo con las herramientas del almacen
    tools = Path(sn.DEFAULT_DATA) / "tools"
    if (tools / "build_store.py").exists():
        data = tmp / "OFD"
        tape(sn.day_path(data / "live" / "cloud" / "tape", "BTCUSDT", sn.dt.datetime.now(sn.dt.timezone.utc).strftime("%Y-%m-%d")).with_name("x"), [0], D0, D0)  # basura que no es un dia: se ignora
        today = sn.dt.datetime.now(sn.dt.timezone.utc).strftime("%Y-%m-%d")
        D0, DAY = sn.day_start(today), today
        tape(sn.day_path(data / "live" / "local" / "tape", "BTCUSDT", today), range(0, 30), D0, D0 + 30 * MIN + 5_000)
        res = sn.refresh(data, tools, symbols={"BTCUSDT"}, days_back=2, cloud=False, log=lambda *_: None)
        store = sn.day_path(data / "live" / "store", "BTCUSDT", today, ".npz")
        state = json.loads(sn.day_path(data / "live" / "tape", "BTCUSDT", today, ".json").read_text(encoding="utf-8"))
        check("armado: almacen del dia y estado para el lector", store.exists() and state["n"] == 30 and state["from_local"] == 30)
        check("sin cambios no se vuelve a armar",
              sn.refresh(data, tools, symbols={"BTCUSDT"}, days_back=2, cloud=False, log=lambda *_: None) == [])
        tape(sn.day_path(data / "live" / "local" / "tape", "BTCUSDT", today), range(0, 31), D0, D0 + 31 * MIN + 5_000)
        res2 = sn.refresh(data, tools, symbols={"BTCUSDT"}, days_back=2, cloud=False, log=lambda *_: None)
        check("con un minuto nuevo se rearma", len(res2) == 1 and res2[0][2] == 31)
        (data / "tape" / "BTCUSDT" / today[:4]).mkdir(parents=True)
        (data / "tape" / "BTCUSDT" / today[:4] / f"BTCUSDT_{today}.tape").write_bytes(b"x")
        tape(sn.day_path(data / "live" / "local" / "tape", "BTCUSDT", today), range(0, 32), D0, D0 + 32 * MIN + 5_000)
        check("con el dia oficial no se arma",
              sn.refresh(data, tools, symbols={"BTCUSDT"}, days_back=2, cloud=False, log=lambda *_: None) == [])
        check("no quedan carpetas temporales", not (data / "live" / "_armando").exists())
    else:
        print("(sin OrderFlowData/tools: se omite el armado)")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
