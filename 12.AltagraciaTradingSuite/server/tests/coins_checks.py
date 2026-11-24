# Pruebas sin conexion del registro de monedas (coins.py) y de la historia del almacen (coin_history.py), 23/11/2026:
#   - el registro: lo de fabrica, lo elegido y un archivo danado que no se pisa;
#   - las listas de cada grabador al arrancar, y las monedas que pone al dia official.py;
#   - la historia con herramientas falsas en una carpeta temporal (nunca las de OrderFlowData): una descarga a la vez,
#     la espera mientras baja otra (del panel o de su cola), el avance, armar el almacen al terminar, no armarlo si
#     alguien escribe en el, si corre official.py o si esta apagado, un armado que falla, "Detener", un pedido que ya
#     empezo al reiniciar y una copia con SUITE_RECORD=0 que solo mira;
#   - lo que ocupa cada moneda y lo que escribe por dia;
#   - las rutas, y que main.py usa el registro.
# Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\coins_checks.py
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_coins_"))
OF = TMP / "OrderFlowData"            # carpeta de datos falsa: live/, candles/ y las herramientas falsas en tools/
os.environ.update({
    "SUITE_DATA_DIR": str(TMP / "data"), "SUITE_ORDERFLOW_DATA": str(OF), "SUITE_RECORD": "0", "SUITE_OFFICIAL": "0",
    "SUITE_SWING": "0", "SUITE_WSMC": "0", "SUITE_SCANNER": "0", "SUITE_DX": "0", "SUITE_BOOK_CLOUD": "0",
    "SUITE_HL_CLOUD": "0", "SUITE_MOBILE": "0",
    "SUITE_BOT_URL": "http://127.0.0.1:9", "SUITE_CLOUD_URL": "http://127.0.0.1:9",   # nadie escucha: nada sale
})
for k in ("SUITE_COIN_HISTORY", "ORDERFLOW_TOOLS", "SUITE_ACCESS_LOG"):
    os.environ.pop(k, None)
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import coin_history  # noqa: E402
import coins  # noqa: E402
from symbols import SymbolList  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def days_back(n, end="2026-11-22"):
    last = datetime.strptime(end, "%Y-%m-%d")
    return sorted((last - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(n))


FAKE_INGEST = r'''
import json, msvcrt, os, sys, time
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sym = sys.argv[1].upper()
(ROOT / "work").mkdir(parents=True, exist_ok=True)
lock = open(ROOT / "work" / f"{sym}.lock", "w")
try:
    msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
except OSError:
    print("Ya hay otra descarga activa de", sym)
    sys.exit(0)
(ROOT / "args.log").open("a").write(" ".join(sys.argv[1:]) + "\n")
remote = (ROOT / f"remote_{sym}.txt").read_text().split()
man = ROOT / "manifest" / f"{sym}.jsonl"
man.parent.mkdir(parents=True, exist_ok=True)
done = set()
if man.exists():
    done = {json.loads(l)["date"] for l in man.read_text().splitlines() if l.strip()}
pend = [d for d in reversed(remote) if d not in done]
delay = float(os.environ.get("FAKE_DELAY", "0.05"))
with open(man, "a") as mf:
    for day in pend:
        try:
            c = json.loads((ROOT / "control.json").read_text())
        except Exception:
            c = {}
        if c.get("stop"):
            break
        time.sleep(delay)
        out = ROOT / "tape" / sym / day[:4] / f"{sym}_{day}.tape"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(b"x" * 100)
        mf.write(json.dumps({"date": day, "status": "ok"}) + "\n")
        mf.flush()
        done.add(day)
        st = {"symbol": sym, "hechos": len(done), "pendientes": sum(1 for d in pend if d not in done), "mb_s": 1.0,
              "actualizado": "ahora", "ultimo_dia": day}
        (ROOT / f"status_{sym}.json").write_text(json.dumps(st))
'''

FAKE_BUILD = r'''
import sys
from pathlib import Path
ROOT = Path(__file__).resolve().parent.parent
sym = sys.argv[1]
if (ROOT / f"fail_build_{sym}").exists():
    print("fallo a proposito")
    sys.exit(1)
made = 0
for t in sorted((ROOT / "tape" / sym).glob("*/*.tape")):
    day = t.stem.rsplit("_", 1)[1]
    for sub in ("store", "flow"):
        dst = ROOT / sub / sym / day[:4] / f"{sym}_{day}.npz"
        if not dst.exists():
            dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(b"npz")
            made += 1
print("dias", made)
'''

HOLD_LOCK = r'''
import msvcrt, sys, time
from pathlib import Path
root, name = Path(sys.argv[1]), sys.argv[2]
(root / "work").mkdir(parents=True, exist_ok=True)
f = open(root / "work" / f"{name}.lock", "w")
msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
print("tomado", flush=True)
while not (root / f"release_{name}").exists():
    time.sleep(0.05)
'''

TOOLS = OF / "tools"
TOOLS.mkdir(parents=True, exist_ok=True)
(TOOLS / "ingest.py").write_text(FAKE_INGEST, encoding="utf-8")
(TOOLS / "build_store.py").write_text(FAKE_BUILD, encoding="utf-8")
(TMP / "hold_lock.py").write_text(HOLD_LOCK, encoding="utf-8")
(OF / "control.json").write_text(json.dumps({"limit_rate": "500K", "pause": False, "stop": False}, indent=1), encoding="utf-8")


def remote(sym, n, end="2026-11-22"):
    d = days_back(n, end)
    (OF / f"remote_{sym}.txt").write_text(" ".join(d), encoding="utf-8")
    return d


def tape_days(sym, days):
    for d in days:
        p = OF / "tape" / sym / d[:4] / f"{sym}_{d}.tape"
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"x" * 10)


def hold(name):
    proc = subprocess.Popen([sys.executable, "-B", str(TMP / "hold_lock.py"), str(OF), name], stdout=subprocess.PIPE, text=True)
    proc.stdout.readline()
    return proc


def release(name, proc):
    (OF / f"release_{name}").write_text("1")
    proc.wait(timeout=10)
    (OF / f"release_{name}").unlink()


try:
    # ---------- registro ----------
    reg = coins.CoinRegistry(TMP / "reg")
    check("registro: sin archivo esta vacio", reg.load() == {})
    d = coins.CoinRegistry.resolve(None, has_history=False)
    check("de fabrica: graba todo y sin historia el almacen apagado", d == {"trades": True, "book": True, "hl": True, "store": False}, d)
    check("de fabrica: con historia el almacen encendido", coins.CoinRegistry.resolve({}, True)["store"] is True)
    reg.set_options("RUNEUSDT", {"book": False})
    check("lo elegido se guarda y lo demas sigue de fabrica",
          coins.CoinRegistry.resolve(reg.load()["RUNEUSDT"], True) == {"trades": True, "book": False, "hl": True, "store": True})
    for bad, why in (({"nube": True}, "opcion desconocida"), ({"book": "no"}, "no es true o false"), ({}, "vacio")):
        try:
            reg.set_options("RUNEUSDT", bad)
            check(f"registro: rechaza {why}", False)
        except ValueError:
            check(f"registro: rechaza {why}", True)
    raw = reg.path.read_text(encoding="utf-8")
    reg.path.write_text("{roto", encoding="utf-8")
    try:
        reg.load()
        check("registro danado: lo dice", False)
    except coins.RegistryError as e:
        check("registro danado: lo dice", "no se pisa" in str(e), str(e))
    try:
        reg.set_options("RUNEUSDT", {"book": True})
    except coins.RegistryError:
        pass
    check("registro danado: no se pisa al cambiar algo", reg.path.read_text(encoding="utf-8") == "{roto")
    lists = coins.recording_lists(reg, ["BTCUSDT", "RUNEUSDT"], quiet=True)
    check("registro danado: se graba todo, como antes", all(v == ["BTCUSDT", "RUNEUSDT"] for v in lists.values()), lists)
    reg.path.write_text(raw, encoding="utf-8")
    lists = coins.recording_lists(reg, ["BTCUSDT", "RUNEUSDT"])
    check("listas al arrancar: sin el libro de RUNE", lists["book"] == ["BTCUSDT"] and lists["trades"] == ["BTCUSDT", "RUNEUSDT"], lists)

    # ---------- piezas de la historia ----------
    check("lista de Bybit: los dias de la pagina",
          coin_history.parse_listing('<a href="ABCUSDT2026-11-02.csv.gz">x</a><a href="ABCUSDT2026-11-01.csv.gz">', "ABCUSDT")
          == ["2026-11-01", "2026-11-02"])
    coin_history.write_control(OF, stop=True)
    c = json.loads((OF / "control.json").read_text(encoding="utf-8"))
    check("control.json: cambia stop y conserva el limite de velocidad", c == {"limit_rate": "500K", "pause": False, "stop": True}, c)
    coin_history.write_control(OF, stop=False)
    holder = hold("LCKUSDT")
    check("candado: tomado por otro proceso", coin_history.lock_busy(OF / "work" / "LCKUSDT.lock"))
    release("LCKUSDT", holder)
    check("candado: suelto al terminar el proceso", not coin_history.lock_busy(OF / "work" / "LCKUSDT.lock"))
    check("candado: sin archivo, libre", not coin_history.lock_busy(OF / "work" / "NADA.lock"))

    # ---------- la historia con herramientas falsas ----------
    coin_history.AFTER_DOWNLOAD_S = 0.6
    coin_history.QUIET_S = 0.4
    coin_history.BUILD_POLL_S = 0.05
    os.environ["FAKE_DELAY"] = "0.12"
    official = {"busy": None}
    store_flags = {}
    hreg = coins.CoinRegistry(TMP / "hdata")
    listings = {}

    async def fake_listing(sym):
        if sym not in listings:
            return []
        if listings[sym] is None:
            raise RuntimeError("sin red")
        return listings[sym]

    def make_mgr():
        m = coin_history.HistoryManager(OF, TMP / "hdata" / "coins" / "salidas", hreg, tools=TOOLS,
                                        official_busy=lambda: official["busy"],
                                        store_on=lambda s, f: store_flags.get(s, True), fetch_listing=fake_listing)
        return m

    async def until(mgr, cond, seconds=15, step=0.25):
        end = time.time() + seconds
        while time.time() < end:
            await mgr.tick()
            if cond():
                return True
            await asyncio.sleep(step)
        return False

    async def history_checks():
        quiet = make_mgr()
        check("SUITE_RECORD=0: la historia solo mira", quiet.enabled is False)
        try:
            await quiet.request("NEWUSDT")
            check("SUITE_RECORD=0: no se puede pedir la historia", False)
        except ValueError as e:
            check("SUITE_RECORD=0: no se puede pedir la historia", "solo se mira" in str(e), str(e))

        mgr = make_mgr()
        mgr.enabled = True
        listings["NEWUSDT"] = remote("NEWUSDT", 12)
        listings["OTHUSDT"] = remote("OTHUSDT", 4)
        listings["NONEUSDT"] = []
        listings["DOWNUSDT"] = None
        got = await mgr.request("NEWUSDT")
        check("pedir: dice cuantos dias faltan", got["days"] == 12 and got["missing"] == 12 and got["first"] == listings["NEWUSDT"][0], got)
        e1 = hreg.load()["NEWUSDT"]
        check("pedir: queda en el registro con el almacen encendido", e1["store"] is True and e1["history"]["requested_at"] > 0, e1)
        for sym, err, why in (("NONEUSDT", ValueError, "Bybit no publica"), ("DOWNUSDT", RuntimeError, "no se pudo leer")):
            try:
                await mgr.request(sym)
                check(f"pedir {sym}: error", False)
            except err as e:
                check(f"pedir {sym}: {why}", why in str(e), str(e))
        await asyncio.sleep(0.01)
        await mgr.request("OTHUSDT")
        check("pedir dos: en orden de llegada", mgr.waiting(hreg.load()) == ["NEWUSDT", "OTHUSDT"])

        # una descarga del panel ocupa: no empieza ninguna
        panel = hold("PNLUSDT")
        await mgr.tick()
        check("con otra descarga (del panel) no empieza ninguna", mgr.proc is None and mgr.waiting(hreg.load()) == ["NEWUSDT", "OTHUSDT"])
        st = mgr.state("NEWUSDT", True, hreg.load(), mgr.waiting(hreg.load()))
        check("la pedida dice que espera, primera", st["state"] == "en_espera" and st["queue_position"] == 1, st)
        check("la del panel sale como bajando", mgr.state("PNLUSDT", True, hreg.load(), [])["state"] == "bajando")
        release("PNLUSDT", panel)
        cola = hold("cola")
        await mgr.tick()
        check("con la cola del panel activa tampoco", mgr.proc is None)
        release("cola", cola)

        await mgr.tick()
        check("empieza la primera pedida", mgr.proc is not None and mgr.proc[0] == "NEWUSDT")
        for _ in range(100):
            if (OF / "args.log").exists():
                break
            await asyncio.sleep(0.05)
        check("la lanza con ingest.py y la moneda", (OF / "args.log").exists() and "NEWUSDT" in (OF / "args.log").read_text())
        check("el registro anota que empezo", hreg.load()["NEWUSDT"]["history"].get("started_at"))
        ok = await until(mgr, lambda: (mgr.facts.get("NEWUSDT") or {}).get("status") is not None, 8, 0.1)
        st = mgr.state("NEWUSDT", True, hreg.load(), mgr.waiting(hreg.load()))
        check("bajando: su avance de status_MONEDA.json", ok and st["state"] == "bajando" and st["progress"]["done"] >= 1
              and st["progress"]["pct"] is not None, st)
        await mgr.tick()
        check("una a la vez: la segunda espera", mgr.proc[0] == "NEWUSDT" and mgr.waiting(hreg.load()) == ["OTHUSDT"])
        try:
            mgr.cancel("NEWUSDT")
            check("la que baja no se saca de la espera", False)
        except ValueError:
            check("la que baja no se saca de la espera", True)
        ok = await until(mgr, lambda: mgr.proc is not None and mgr.proc[0] == "OTHUSDT", 15)
        check("al terminar, empieza la siguiente", ok)
        check("la que termino sale del registro", "history" not in hreg.load()["NEWUSDT"])
        check("se ve cuando termino", "NEWUSDT" in mgr.ended)
        ok = await until(mgr, lambda: (mgr.facts.get("NEWUSDT") or {}).get("store_days") == 12
                         and mgr.build_result.get("NEWUSDT") is not None, 15)
        check("al terminar se arma su almacen (store y flow)", ok and mgr.facts["NEWUSDT"]["missing_flow"] == 0,
              mgr.facts.get("NEWUSDT"))
        check("el armado queda anotado", (mgr.build_result.get("NEWUSDT") or {}).get("ok") is True, mgr.build_result.get("NEWUSDT"))
        await mgr.listing("NEWUSDT", fresh=True)
        st = mgr.state("NEWUSDT", True, hreg.load(), [])
        check("al dia: tiene todos los dias de Bybit", st["state"] == "al_dia" and st["missing_remote"] == 0, st)
        ok = await until(mgr, lambda: mgr.proc is None and (mgr.facts.get("OTHUSDT") or {}).get("store_days") == 4
                         and mgr.build_result.get("OTHUSDT") is not None and mgr.building is None, 15)
        check("la segunda tambien se baja y se arma", ok)

        # armar: lo que lo impide
        tape_days("BLDUSDT", days_back(3))
        official["busy"] = "BTCUSDT"
        await mgr.tick()
        check("no se arma mientras corre official.py", (mgr.facts["BLDUSDT"]["store_days"] == 0) and mgr.building is None
              and not (mgr._build_task and not mgr._build_task.done()))
        official["busy"] = None
        store_flags["BLDUSDT"] = False
        await mgr.tick()
        await asyncio.sleep(0.3)
        await mgr.tick()
        check("no se arma con el almacen apagado", mgr.facts["BLDUSDT"]["store_days"] == 0)
        check("por armar: lo dice", mgr.state("BLDUSDT", False, hreg.load(), [])["state"] == "por_armar")
        store_flags["BLDUSDT"] = True
        ok = await until(mgr, lambda: mgr.facts["BLDUSDT"]["store_days"] == 3 and mgr.build_result.get("BLDUSDT") is not None, 10)
        check("encendido, se arma", ok)

        tape_days("QUIUSDT", days_back(2))
        q = OF / "store" / "QUIUSDT" / "2026"
        q.mkdir(parents=True, exist_ok=True)
        (q / "QUIUSDT_2026-11-21.npz.tmp.npz").write_bytes(b"a medias")
        await mgr.tick()
        check("no se arma si alguien escribe en su almacen", mgr.build_result.get("QUIUSDT") is None
              and not (mgr._build_task and not mgr._build_task.done() and mgr.building == "QUIUSDT"))
        ok = await until(mgr, lambda: mgr.facts["QUIUSDT"]["store_days"] == 2 and mgr.build_result.get("QUIUSDT") is not None, 10)
        check("y si deja de escribir, se arma", ok)

        tape_days("FAIUSDT", days_back(2))
        (OF / "fail_build_FAIUSDT").write_text("1")
        ok = await until(mgr, lambda: mgr.build_result.get("FAIUSDT") is not None, 10)
        check("un armado que falla queda anotado", ok and mgr.build_result["FAIUSDT"]["ok"] is False
              and "fallo a proposito" in mgr.build_result["FAIUSDT"]["detail"], mgr.build_result.get("FAIUSDT"))
        first = mgr.build_result["FAIUSDT"]["at"]
        for _ in range(4):
            await mgr.tick()
            await asyncio.sleep(0.2)
        check("y no se repite enseguida", mgr.build_result["FAIUSDT"]["at"] == first)
        (OF / "fail_build_FAIUSDT").unlink()

        # Detener
        os.environ["FAKE_DELAY"] = "0.3"
        listings["STPUSDT"] = remote("STPUSDT", 40)
        listings["WAIUSDT"] = remote("WAIUSDT", 3)
        await mgr.request("STPUSDT")
        await asyncio.sleep(0.01)
        await mgr.request("WAIUSDT")
        ok = await until(mgr, lambda: mgr.proc is not None and mgr.proc[0] == "STPUSDT"
                         and (mgr.facts.get("STPUSDT") or {}).get("lock"), 8, 0.1)
        out = mgr.stop()
        check("detener: la que baja y cancela las que esperan", ok and out["stopping"] == ["STPUSDT"] and out["cancelled"] == ["WAIUSDT"], out)
        check("detener: escribe stop en control.json", json.loads((OF / "control.json").read_text())["stop"] is True)
        ok = await until(mgr, lambda: mgr.proc is None and not mgr.stop_requested, 15)
        check("detener: al cerrarse, stop vuelve a false", ok and json.loads((OF / "control.json").read_text())["stop"] is False)
        await mgr.tick()
        check("detener: no empieza la que esperaba", mgr.proc is None and "history" not in hreg.load().get("WAIUSDT", {}))
        st = mgr.state("STPUSDT", True, hreg.load(), [])
        check("detenida a medias: lo dice", st["state"] == "a_medias" and st["missing_remote"] > 2, st)
        got = await mgr.request("STPUSDT")
        check("seguir bajando: el tramo es el de lo que falta (los dias viejos), no todo lo publicado",
              got["first"] == listings["STPUSDT"][0] and got["last"] < listings["STPUSDT"][-1]
              and got["listed_last"] == listings["STPUSDT"][-1] and got["missing"] == st["missing_remote"], got)
        mgr.cancel("STPUSDT")
        try:
            mgr.stop()
            check("detener sin descarga: error", False)
        except ValueError:
            check("detener sin descarga: error", True)

        # Al reiniciar: un pedido que ya empezo y no sigue se da por cumplido, sin volver a lanzarlo
        c = hreg.load()
        c["RSTUSDT"] = {"store": True, "history": {"requested_at": 1, "started_at": 2}}
        hreg.save(c)
        again = make_mgr()
        again.enabled = True
        await again.tick()
        check("al reiniciar, el pedido que ya empezo se da por cumplido", again.proc is None and "history" not in hreg.load()["RSTUSDT"])
        busy = hold("BSYUSDT")
        await again.tick()
        check("official.py no toca la que baja otro (solo con su candado)", "BSYUSDT" in again.busy())
        check("la que baja otro sale en la lista aunque no tenga dias", again.state("BSYUSDT", False, hreg.load(), [])["state"] == "bajando")
        release("BSYUSDT", busy)
        await again.tick()
        check("al soltar el candado ya no esta ocupada", "BSYUSDT" not in again.busy())

    asyncio.run(history_checks())

    # ---------- lo que ocupa y lo que escribe por dia ----------
    now = datetime(2026, 11, 23, 12, 0, tzinfo=timezone.utc).timestamp()
    for i, day in enumerate(("2026-11-19", "2026-11-20", "2026-11-21", "2026-11-22", "2026-11-23")):
        b = OF / "live" / "book" / "BTCUSDT" / "2026"
        b.mkdir(parents=True, exist_ok=True)
        (b / f"BTCUSDT_{day}.bkm").write_bytes(b"m" * 1_048_576)
        (b / f"BTCUSDT_{day}.bks").write_bytes(b"s" * 1_048_576 * (i + 1))
        t = OF / "live" / "local" / "tape" / "BTCUSDT" / "2026"
        t.mkdir(parents=True, exist_ok=True)
        (t / f"BTCUSDT_{day}.tape").write_bytes(b"t" * 524_288)
    pd = coins.per_day(OF, "BTCUSDT", now)
    check("por dia: promedio de los 3 ultimos dias completos, sin hoy",
          pd["days"] == 3 and pd["book_mb"] == 4.0 and pd["trades_mb"] == 0.5 and pd["total_mb"] == 4.5 and not pd["estimate"], pd)
    b = OF / "live" / "book" / "NEWUSDT" / "2026"
    b.mkdir(parents=True, exist_ok=True)
    (b / "NEWUSDT_2026-11-23.bks").write_bytes(b"s" * 1_048_576)
    pd = coins.per_day(OF, "NEWUSDT", now)
    check("por dia: solo con hoy, lo de hoy llevado al dia entero", pd["estimate"] and pd["book_mb"] == 2.0, pd)
    check("por dia: sin nada, nada", coins.per_day(OF, "ZZZUSDT", now) is None)
    sz = coins.disk_and_rates(OF, OF, ["BTCUSDT"], now)["BTCUSDT"]
    check("lo que ocupa: lo grabado en vivo", sz["live_mb"] == round((5 + 15 + 2.5) , 1), sz)

    # ---------- el servicio y sus rutas ----------
    data2 = TMP / "data2"
    data2.mkdir()
    (data2 / "symbols.json").write_text(json.dumps({"symbols": ["BTCUSDT", "RUNEUSDT"]}), encoding="utf-8")
    app1 = TMP / "app1"
    (app1 / "backtesting_cache").mkdir(parents=True)
    (app1 / "backtesting_cache" / "BTCUSDT_backtesting_data.json.gz").write_bytes(b"x")
    (OF / "candles").mkdir(parents=True, exist_ok=True)
    (OF / "candles" / "RUNEUSDT.json.gz").write_bytes(b"x")

    class FakeSwing:
        config = {"symbols": ["BTCUSDT"], "interval": "1"}

    class FakeWsmc:
        def symbols(self):
            return ["BTCUSDT", "RUNEUSDT"]

    asked = []

    async def fake_bot(method, path, **kw):
        return {"coins": [{"symbol": "BTCUSDT"}, {"symbol": "CAKEUSDT"}]}

    async def fake_instrument(sym):
        asked.append(sym)
        return sym != "FAKEUSDT"

    async def fake_cloud():
        return ["BTCUSDT", "TONUSDT"]

    svc = coins.Coins(data2, OF, SymbolList(data2), swing=FakeSwing(), wsmc=FakeWsmc(), dx_symbols=("BTCUSDT",),
                      bot=fake_bot, instrument=fake_instrument, app1_backend=app1, tools=TOOLS, fetch_cloud=fake_cloud,
                      fetch_listing=fake_listing, now=lambda: now)   # hora fija: lo de "por dia" no depende del reloj
    app = FastAPI()
    app.include_router(coins.make_router(svc))
    with TestClient(app) as client:
        r = client.get("/api/coins")
        body = r.json()
        rows = {x["symbol"]: x for x in body.get("rows", [])}
        check("lista: 200", r.status_code == 200, r.text[:200])
        check("lista: primero las de la suite, en su orden", [x["symbol"] for x in body["rows"][:2]] == ["BTCUSDT", "RUNEUSDT"])
        check("lista: tambien las de la nube, el bot y el almacen", {"TONUSDT", "CAKEUSDT", "NEWUSDT"} <= set(rows), sorted(rows))
        check("lista: lo de cada lado", rows["BTCUSDT"]["swing"] and rows["BTCUSDT"]["dx"] and rows["BTCUSDT"]["bot"]
              and rows["BTCUSDT"]["cloud"] and rows["BTCUSDT"]["app1"] == "base" and rows["RUNEUSDT"]["app1"] == "nueva"
              and rows["RUNEUSDT"]["cloud"] is False and rows["RUNEUSDT"]["wsmc"], rows["RUNEUSDT"])
        check("lista: fuera de la suite", rows["TONUSDT"]["suite"] is False and rows["BTCUSDT"]["suite"] is True)
        check("lista: almacen de fabrica segun la historia",
              rows["NEWUSDT"]["options"]["store"] is True and rows["TONUSDT"]["options"]["store"] is False)
        check("lista: grabadores que no corren aqui", rows["BTCUSDT"]["recording"] == {"trades": None, "book": None, "hl": None}
              and body["recorders"]["trades"]["running"] is False)
        check("lista: lo que escribe por dia", (rows["BTCUSDT"]["per_day"] or {}).get("total_mb") == 4.5, rows["BTCUSDT"]["per_day"])
        check("lista: la historia, solo mira (SUITE_RECORD=0)", body["history"]["available"]["ok"] is False)

        r = client.post("/api/coins", json={"symbol": "linkusdt", "trades": True, "book": False, "hl": True, "history": False})
        check("agregar: 200 y en la suite", r.status_code == 200 and "LINKUSDT" in r.json()["symbols"], r.text[:200])
        check("agregar: consulta Bybit una vez", asked == ["LINKUSDT"])
        check("agregar: guarda lo elegido", svc.registry.load()["LINKUSDT"] == {"trades": True, "book": False, "hl": True})
        r = client.post("/api/coins", json={"symbol": "FAKEUSDT"})
        check("agregar: una que no cotiza, 404", r.status_code == 404, r.text[:200])
        r = client.post("/api/coins", json={"symbol": "RUNEUSDT", "history": True})
        check("agregar con historia apagada en esta copia: lo dice sin fallar",
              r.status_code == 200 and "solo se mira" in (r.json()["history_error"] or ""), r.text[:300])
        r = client.post("/api/coins", json={"symbol": "BTCUSDT", "history": "si"})
        check("agregar: history mal escrito, 400", r.status_code == 400)

        r = client.post("/api/coins/LINKUSDT", json={"book": True})
        check("cambiar: enciende el libro", r.status_code == 200 and svc.registry.load()["LINKUSDT"]["book"] is True, r.text[:200])
        r = client.post("/api/coins/LINKUSDT", json={"nube": True})
        check("cambiar: opcion desconocida, 400", r.status_code == 400)
        r = client.post("/api/coins/LINKUSDT", json={"book": 1})
        check("cambiar: valor que no es true o false, 400", r.status_code == 400)
        r = client.post("/api/coins/LINK", json={"book": True})
        check("cambiar: moneda mal escrita, 400", r.status_code == 400)
        r = client.post("/api/coins/RUNEUSDT/history")
        check("historia en esta copia: 400 con el motivo", r.status_code == 400 and "solo se mira" in r.json()["detail"], r.text[:200])
        r = client.post("/api/coins/history/stop")
        check("detener en esta copia: 409", r.status_code == 409)
        r = client.delete("/api/coins/RUNEUSDT/history")
        check("sacar de la espera sin pedido: 200, nada que sacar", r.status_code == 200 and r.json()["cancelled"] is False)

        good = svc.registry.path.read_text(encoding="utf-8")
        svc.registry.path.write_text("{roto", encoding="utf-8")
        r = client.get("/api/coins")
        check("registro danado: la lista sigue y lo dice", r.status_code == 200 and "no se pisa" in r.json()["errors"].get("registry", ""))
        r = client.post("/api/coins/LINKUSDT", json={"book": False})
        check("registro danado: cambiar da 500 y no se pisa", r.status_code == 500
              and svc.registry.path.read_text(encoding="utf-8") == "{roto", r.text[:200])
        r = client.post("/api/coins", json={"symbol": "ADAUSDT"})
        check("registro danado: agregar da 500 y no agrega", r.status_code == 500 and "ADAUSDT" not in SymbolList(data2).load())
        svc.registry.path.write_text(good, encoding="utf-8")

        svc.registry.set_options("NEWUSDT", {"store": False})
        so = svc.store_symbols()
        check("official.py: las del almacen encendido, sin las apagadas", "OTHUSDT" in so and "NEWUSDT" not in so, so)

    # ---------- main.py usa el registro ----------
    import main  # noqa: E402
    (TMP / "data").mkdir(exist_ok=True)
    (TMP / "data" / "symbols.json").write_text(json.dumps({"symbols": ["BTCUSDT", "ETHUSDT"]}), encoding="utf-8")
    main.COINS.registry.set_options("ETHUSDT", {"book": False})
    check("main: el libro de la nube, sin las del libro apagado", main._book_symbols() == ["BTCUSDT"], main._book_symbols())
    check("main: official.py con el registro", set(main._official_symbols()) >= {"OTHUSDT", "BLDUSDT"}, main._official_symbols())
    started = []

    async def fake_start(sym, opts):
        started.append((sym, dict(opts)))

    async def ok_instrument(sym):
        return True

    real_start, real_instrument = main.coins.start_recording, main._instrument
    main.coins.start_recording, main._instrument = fake_start, ok_instrument
    try:
        with TestClient(main.app, base_url="http://127.0.0.1:13000") as client:   # el servidor solo atiende este PC
            main.COINS.registry.set_options("SOLUSDT", {"hl": False})
            r = client.post("/api/suite/symbols", json={"symbol": "SOLUSDT"})
            check("«+ Moneda»: graba lo elegido antes en Monedas", r.status_code == 200
                  and started == [("SOLUSDT", {"trades": True, "book": True, "hl": False})], (r.text[:200], started))
            r = client.post("/api/suite/symbols", json={"symbol": "XRPUSDT"})
            check("«+ Moneda»: sin elegir nada, graba todo", started[-1] == ("XRPUSDT", {"trades": True, "book": True, "hl": True}))
            r = client.get("/api/coins")
            check("main: la ruta del modulo responde", r.status_code == 200 and r.json()["suite_count"] == 4, r.text[:200])
    finally:
        main.coins.start_recording, main._instrument = real_start, real_instrument
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
