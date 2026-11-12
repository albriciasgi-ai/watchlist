# Pruebas sin conexion del journal de la suite (paso 4): imagenes, contexto de decision, union con los trades del bot,
# medidas de App 1 con velas simuladas e informe. El bot real y Bybit nunca reciben nada.
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\journal_checks.py
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_journal_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import journal_measures  # noqa: E402
from journal_store import JournalStore  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 200
MIN = 60000
NOW = int(time.time() * 1000)

# Velas simuladas (Bybit nunca se consulta): una tendencia con ruido, en la forma de candles.klines
rng = np.random.default_rng(3)


def fake_klines_factory():
    cache = {}

    async def fake_klines(symbol, interval, days):
        minutes = int(interval)
        end = NOW // (minutes * MIN) * (minutes * MIN)
        n = int(days * 1440 / minutes)
        key = (symbol, interval, n)
        if key not in cache:
            ts = end - np.arange(n)[::-1] * minutes * MIN
            close = 80000 + np.cumsum(rng.normal(0, 40 * (minutes / 15) ** 0.5, n))
            rows = []
            for i, t in enumerate(ts):
                o = close[i - 1] if i else close[i]
                c = close[i]
                rows.append({"timestamp": int(t), "open": float(o), "high": float(max(o, c) + 15), "low": float(min(o, c) - 15),
                             "close": float(c), "volume": float(100 + rng.random() * 50), "in_progress": t == ts[-1]})
            cache[key] = rows
        return cache[key]
    return fake_klines


try:
    # ---------- JournalStore ----------
    store = JournalStore(TMP / "unit")
    path = store.save_image("journal", PNG)
    check("imagen PNG guardada con su ruta", path.startswith("journal/img_") and store.image_path(*path.split("/")) is not None)
    for bad, name in ((b"GIF89a", "no es PNG"), (b"", "vacia")):
        try:
            store.save_image("journal", bad)
            check(f"imagen rechazada: {name}", False)
        except ValueError:
            check(f"imagen rechazada: {name}", True)
    check("ruta de imagen con .. no se sirve", store.image_path("journal", "..") is None and store.image_path("..", "x.png") is None)
    for bad, name in (({"kind": "x"}, "tipo"), ({"kind": "decision", "symbol": "btc/usdt", "side": "Buy", "at": NOW}, "simbolo"),
                      ({"kind": "decision", "symbol": "BTCUSDT", "side": "long", "at": NOW}, "lado"),
                      ({"kind": "decision", "symbol": "BTCUSDT", "side": "Buy", "at": NOW + 3600000}, "hora futura"),
                      ({"kind": "open", "symbol": "BTCUSDT", "side": "Buy", "at": NOW, "image": "../../x.png"}, "imagen con ..")):
        try:
            store.clean_context(bad)
            check(f"contexto rechazado: {name}", False)
        except ValueError:
            check(f"contexto rechazado: {name}", True)
    opened = NOW - 3600000
    store.add_context({"kind": "decision", "symbol": "BTCUSDT", "side": "Sell", "at": opened - 5 * MIN, "image": path,
                       "note": "  VAH con delta en contra  ", "levels": [{"kind": "VAH", "price": 81000, "role": "Resistencia",
                                                                          "note": "x" * 500, "junk": "no"}],
                       "order": {"type": "Limit", "qty": 0.01, "entry": 80100, "stop": 81200, "target": 78000}})
    store.add_context({"kind": "decision", "symbol": "BTCUSDT", "side": "Sell", "at": opened - 40 * MIN})  # muy vieja
    store.add_context({"kind": "open", "symbol": "BTCUSDT", "side": "Sell", "at": opened + MIN, "image": path})
    store.add_context({"kind": "close", "symbol": "BTCUSDT", "side": "Sell", "at": NOW - 9 * MIN, "image": path})
    trades = store.merge([
        {"trade_id": "BTCUSDT-Sell-1", "symbol": "BTCUSDT", "side": "Sell", "opened_at": opened, "closed_at": NOW - 10 * MIN, "pre_existing": False},
        {"trade_id": "BTCUSDT-Buy-1", "symbol": "BTCUSDT", "side": "Buy", "opened_at": opened, "pre_existing": False},
    ])
    d = trades[0]["decision"]
    check("decision unida al trade (la mas cercana antes de abrir), con la nota limpia y el nivel acotado",
          d and d["at"] == opened - 5 * MIN and d["note"] == "VAH con delta en contra" and len(d["levels"][0]["note"]) == 300
          and "junk" not in d["levels"][0], str(d))
    check("imagenes de decision, apertura y cierre en orden", [i["kind"] for i in trades[0]["images"]] == ["decision", "open", "close"])
    check("el otro lado no se mezcla", trades[1]["decision"] is None and trades[1]["images"] == [])
    with open(store.contexts_file, "a", encoding="utf-8") as f:
        f.write('{"kind": "decision", "symb')  # linea cortada
    check("una linea cortada se salta", len(JournalStore(TMP / "unit").contexts()) == 4)

    # ---------- medidas de App 1 con velas simuladas ----------
    journal_measures.candles.klines = fake_klines_factory()
    import asyncio
    trade = {"trade_id": "t1", "symbol": "TESTUSDT", "side": "Buy", "opened_at": NOW - 6 * 3600000, "closed_at": NOW - 2 * 3600000,
             "entry": 80000.0, "initial_stop_loss": 79800.0, "status": "closed", "pre_existing": False}
    m = asyncio.run(journal_measures.trade_measures(trade))
    measures_ok = m.get("available") and len(m["decision"]) == len(journal_measures.catalog()) and m["decision_candle"] <= trade["opened_at"]
    check("las 58 medidas de App 1 al decidir, de una vela ya cerrada", measures_ok, str({k: m.get(k) for k in ("available", "reason")}))
    check("lo maximo a favor y en contra en R", m.get("best_r") is not None and m.get("worst_r") is not None and m["best_r"] >= m["worst_r"])
    f5 = journal_measures.frame([{"timestamp": 0, "open": 1, "high": 2, "low": 1, "close": 2, "volume": 1, "in_progress": False},
                                 {"timestamp": 300000, "open": 2, "high": 5, "low": 0.5, "close": 3, "volume": 1, "in_progress": True}])
    check("la vela en curso no entra en las medidas", list(f5["ts"]) == [0])
    best, worst = journal_measures.excursion({"ts": np.array([0, 300000]), "high": np.array([102.0, 101.0]), "low": np.array([99.0, 97.0])},
                                             1, 100.0, 98.0, 0, 600000)
    check("excursion: long con riesgo 2, maximo 102 y minimo 97 = +1 R y -1.5 R", (best, worst) == (1.0, -1.5), str((best, worst)))
    pre = asyncio.run(journal_measures.trade_measures({**trade, "pre_existing": True}))
    check("posicion anterior al journal sin decision: sin medidas, con el motivo", not pre["available"] and "antes" in pre["reason"])

    # ---------- rutas de la suite ----------
    BOT_TRADES = []

    async def fake_bot(method, path, **kw):
        if path == "/api/journal/trades":
            return {"success": True, "trades": [dict(t) for t in BOT_TRADES]}
        return {"success": True}

    main._bot = fake_bot
    H = {"Host": "127.0.0.1:13000"}
    with TestClient(main.app) as c:
        r = c.post("/api/screenshots/session/journal", headers=H, files={"file": ("decision.png", PNG, "image/png")})
        shot = r.json().get("screenshotPath", "")
        g = c.get(f"/api/screenshots/session/{shot}", headers=H)
        check("imagen subida y servida (contrato de App 1)", r.status_code == 200 and g.status_code == 200 and g.content == PNG, r.text)
        check("imagen de otra pagina: 403", c.post("/api/screenshots/session/journal", headers={**H, "Origin": "https://evil.example"},
                                                   files={"file": ("x.png", PNG, "image/png")}).status_code == 403)
        t_open = NOW - 7200000
        r = c.post("/api/journal/context", headers=H, json={"kind": "decision", "symbol": "ethusdt", "side": "Buy", "at": t_open - MIN,
                                                            "image": shot, "note": "Swing en VAL"})
        check("contexto guardado", r.status_code == 200 and r.json()["context"]["symbol"] == "ETHUSDT", r.text)
        check("contexto invalido: 400", c.post("/api/journal/context", headers=H, json={"kind": "x"}).status_code == 400)
        BOT_TRADES.append({"trade_id": "ETHUSDT-Buy-1", "symbol": "ETHUSDT", "side": "Buy", "opened_at": t_open, "closed_at": NOW - 3600000,
                           "entry": 80000.0, "initial_stop_loss": 79800.0, "status": "closed", "pnl": 5.0, "pre_existing": False})
        j = c.get("/api/bot/journal", headers=H).json()
        check("el journal del bot llega con la decision y su imagen", j["trades"][0]["decision"]["note"] == "Swing en VAL"
              and j["trades"][0]["images"][0]["image"] == shot, str(j)[:300])
        r = c.get("/api/journal/measures/ETHUSDT-Buy-1", headers=H)
        check("medidas de un trade cerrado: calculadas y guardadas", r.status_code == 200 and r.json().get("available")
              and main.JOURNAL.measures_get("ETHUSDT-Buy-1") is not None, r.text[:200])
        check("la segunda vez salen guardadas", c.get("/api/journal/measures/ETHUSDT-Buy-1", headers=H).json().get("cached") is True)
        check("trade desconocido: 404", c.get("/api/journal/measures/NADA-Buy-1", headers=H).status_code == 404)
        # Informe: 6 ganadoras y 6 perdedoras con una medida que las separa
        catalog = journal_measures.catalog()
        key = catalog[0]["key"]
        for i in range(12):
            tid = f"X-Buy-{i}"
            win = i < 6
            BOT_TRADES.append({"trade_id": tid, "symbol": "XUSDT", "side": "Buy", "opened_at": NOW - (i + 3) * 3600000,
                               "closed_at": NOW - (i + 2) * 3600000, "status": "closed", "pnl": 3.0 if win else -2.0, "pre_existing": False})
            decision = {k["key"]: None for k in catalog}
            decision[key] = (1.0 if win else -1.0) + i * 0.01
            main.JOURNAL.measures_put(tid, {"available": True, "complete": True, "decision": decision})
        rep = c.get("/api/journal/report?days=30", headers=H).json()
        first = rep["rows"][0] if rep.get("rows") else {}
        check("informe: ganadoras contra perdedoras, la medida que las separa primero",
              rep.get("winners") == 7 and rep.get("losers") == 6 and first.get("key") == key and first.get("share") > 0.9, str(rep)[:300])
        check("informe: avisa muestra pequena", rep.get("small_sample") is True)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
