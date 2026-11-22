# Pruebas sin conexion de Hyperliquid en la nube (22/11/2026):
#   - la copia de hl_recorder.py del collector es igual a la de la suite;
#   - el collector (5.Order_flow/cloud_collector/main.py) lista los dias y entrega desde un byte, solo lineas enteras;
#   - la suite (hl_cloud.py) baja solo lo nuevo, no repite al volver a pasar y respeta el tope por vuelta;
#   - read_rows junta PC y nube sin repetir vueltas; la limpieza borra solo los dias viejos;
#   - el grabador lee el leaderboard por partes cuando el cliente tiene stream (httpx).
# Ni Hyperliquid ni Northflank se consultan: la nube corre en este mismo proceso (httpx.ASGITransport).
# Uso, desde 12.AltagraciaTradingSuite\server:  python -B tests\hl_cloud_checks.py
import asyncio
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_hl_cloud_"))
os.environ["DATA_DIR"] = str(TMP / "nube")           # la del collector
os.environ["SYMBOLS"] = "BTCUSDT,ETHUSDT"
HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
REPO = SERVER.parents[1]
CLOUD = REPO / "5.Order_flow" / "cloud_collector"
sys.path.insert(0, str(SERVER))
sys.path.append(str(CLOUD))

import httpx  # noqa: E402
import hl_cloud  # noqa: E402
import hl_recorder as hl  # noqa: E402

results = []
DAY_MS = 86_400_000


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


def line(t, **extra):
    return (json.dumps({"t": t, **extra}, separators=(",", ":")) + "\n").encode()


try:
    check("la copia de hl_recorder.py en la nube es igual a la de la suite",
          (CLOUD / "hl_recorder.py").read_bytes() == (SERVER / "hl_recorder.py").read_bytes())
    check("el Dockerfile del collector copia hl_recorder.py", "COPY hl_recorder.py" in (CLOUD / "Dockerfile").read_text())

    D0 = 1_800_000_000_000 - 1_800_000_000_000 % DAY_MS
    day, old_day = hl.day_of(D0), hl.day_of(D0 - 20 * DAY_MS)
    nube = hl.root(TMP / "nube")
    for kind in ("ctx", "positions", "fast"):
        (nube / kind).mkdir(parents=True, exist_ok=True)
    ctx = nube / "ctx" / f"{day}.jsonl"
    ctx.write_bytes(b"".join(line(D0 + i * 60_000, coins={"BTC": {"mark": 1.0 + i}}) for i in range(50)) + b'{"t": 99')  # la última a medias
    (nube / "positions" / f"{day}.jsonl").write_bytes(line(D0, positions=[]) + line(D0 + 900_000, positions=[]))
    (nube / "ctx" / f"{old_day}.jsonl").write_bytes(line(D0 - 20 * DAY_MS))
    whole = ctx.read_bytes()[:ctx.read_bytes().rfind(b"\n") + 1]

    check("tamaño completo: hasta la última línea entera", hl.complete_size(ctx) == len(whole))
    part = hl.read_from(nube, "ctx", day, 0, limit=500)
    check("un pedido con tope termina en una línea entera", part.endswith(b"\n") and len(part) <= 500 and whole.startswith(part))
    check("desde un byte, el resto sin la línea a medias", hl.read_from(nube, "ctx", day, len(part)) == whole[len(part):])
    try:
        hl.read_from(nube, "../x", day, 0)
        check("una carpeta inválida se rechaza", False)
    except ValueError:
        check("una carpeta inválida se rechaza", True)

    spec = importlib.util.spec_from_file_location("collector_main", CLOUD / "main.py")
    collector = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(collector)   # sin lifespan: no conecta a Hyperliquid ni a Bybit
    transport = httpx.ASGITransport(app=collector.app)
    pc = TMP / "pc"

    async def scenario():
        async with httpx.AsyncClient(transport=transport, base_url="http://nube") as http:
            listing = (await http.get("/api/hyperliquid/days")).json()
            bad = await http.get(f"/api/hyperliquid/file/otra/{day}")
            sync = hl_cloud.HlCloudSync(pc, "http://nube", http)
            first = await sync.run_once()
            first["mirror"] = (hl.cloud_root(pc) / "ctx" / f"{day}.jsonl").read_bytes()
            again = await sync.run_once()
            with open(ctx, "ab") as fh:              # la línea a medias se completa y llegan dos más
                fh.write(b"}\n" + line(D0 + 60 * 60_000) + line(D0 + 61 * 60_000))
            more = await sync.run_once()
            small = hl_cloud.HlCloudSync(TMP / "pc2", "http://nube", http)
            capped = await small.run_once(budget=100)
            return listing, bad.status_code, first, again, more, capped

    listing, bad, first, again, more, capped = asyncio.run(scenario())
    check("la nube lista sus días con los bytes completos", listing["files"]["ctx"][day] == len(whole)
          and listing["files"]["positions"][day] > 0 and listing["keep_days"] == collector.HL_KEEP_DAYS, listing)
    check("la nube rechaza una carpeta que no existe", bad == 404, bad)
    mirror = hl.cloud_root(pc) / "ctx" / f"{day}.jsonl"
    check("la primera vuelta baja todo lo entero", first["bytes"] > 0 and first.pop("mirror") == whole, first)
    check("la segunda vuelta no baja nada", again["bytes"] == 0, again)
    check("después baja solo lo nuevo, y el espejo es igual a la nube",
          0 < more["bytes"] < len(whole) and mirror.read_bytes() == ctx.read_bytes(), more)
    total = sum(v for days in listing["files"].values() for v in days.values())
    check("con tope por vuelta (se mira antes de cada pedido), deja lo demás pendiente",
          capped["pending"] and capped["bytes"] < total + 100, capped)

    # PC y nube juntos: manda el PC, la nube llena lo que el PC no tiene
    mine = hl.root(pc) / "ctx" / f"{day}.jsonl"
    mine.parent.mkdir(parents=True, exist_ok=True)
    mine.write_bytes(b"".join(line(D0 + i * 60_000 + 5_000, src="pc") for i in range(10)))   # las primeras 10 vueltas, 5 s después
    rows = hl.read_rows(pc, "ctx", day)
    ts = [r["t"] for r in rows]
    check("juntas: el PC donde tiene, la nube en lo demás, sin repetir ni desordenar",
          ts == sorted(ts) and sum(1 for r in rows if r.get("src") == "pc") == 10
          and len(rows) == 10 + (50 - 10) + 1 + 2, (len(rows), sum(1 for r in rows if r.get("src") == "pc")))

    # Limpieza: el día viejo se va, el de hoy queda
    gone = hl.cleanup_days(nube, 14, D0 + 3600_000)
    check("la limpieza borra solo los días viejos", gone == 1 and not (nube / "ctx" / f"{old_day}.jsonl").exists() and ctx.exists())
    check("con 0 días no borra nada", hl.cleanup_days(nube, 0, D0) == 0)

    # El grabador con un cliente que tiene stream: lee el leaderboard en pedazos
    ROWS = [{"ethAddress": f"0x{i:040x}", "accountValue": str(1000 + i),
             "windowPerformances": [["month", {"vlm": str(i % 7)}]]} for i in range(400)]
    raw = json.dumps({"leaderboardRows": ROWS}).encode()

    class StreamResp:
        def raise_for_status(self):
            pass

        async def aiter_bytes(self):
            for i in range(0, len(raw), 999):
                yield raw[i:i + 999]

    class StreamCtx:
        async def __aenter__(self):
            return StreamResp()

        async def __aexit__(self, *a):
            return False

    class StreamHttp:
        def __init__(self):
            self.calls = []

        def stream(self, method, url, timeout=None):
            self.calls.append((method, url))
            return StreamCtx()

    sh = StreamHttp()
    rec = hl.HlRecorder(["BTCUSDT"], TMP / "rec", sh)
    asyncio.run(rec.wallets_once())
    t, users = rec.wallets()
    check("con stream, el leaderboard se lee por partes y da las mismas cuentas",
          sh.calls == [("GET", hl.LEADERBOARD_URL)] and users == [w[0] for w in hl.top_wallets(ROWS)]
          and rec.state["wallets"]["rows"] == 400, (len(users), rec.state["wallets"]))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)} de {len(results)} pruebas pasaron")
sys.exit(1 if bad else 0)
