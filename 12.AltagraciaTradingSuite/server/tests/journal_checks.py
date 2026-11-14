# Pruebas sin conexion del journal de la suite (paso 4): imagenes, contexto de decision, union con los trades del bot,
# medidas de App 1 con velas simuladas, lectura de la regla del laboratorio e informe. El bot real y Bybit nunca
# reciben nada, y el almacen de order flow es una carpeta temporal (el real no se lee).
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\journal_checks.py
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_journal_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_ORDERFLOW_DATA"] = str(TMP / "OrderFlowData")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_SWING"] = "0"  # el Swing del servidor no consulta Bybit en las pruebas
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import footprint_store  # noqa: E402
import journal_measures  # noqa: E402
import journal_reading  # noqa: E402
import market_routes  # noqa: E402
import observer  # noqa: E402
from journal_store import JournalStore  # noqa: E402

# El OI de Bybit, falso: sube de a 1 cada 5 minutos desde 1000
OI_CALLS = []


async def fake_bybit_oi(symbol, interval, start_ms, end_ms):
    OI_CALLS.append((symbol, interval, start_ms, end_ms))
    step = 5 * 60000
    first = -(-start_ms // step) * step
    return {t: 1000.0 + (t - first) / step for t in range(first, end_ms + 1, step)}


market_routes._bybit_oi = fake_bybit_oi

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

    # ---------- decision unida por su orden de Bybit (12/11/2026) ----------
    so = JournalStore(TMP / "orders")
    lv = [{"id": "VWAP|VWAP|100.00", "kind": "VWAP", "source": "VWAP", "price": 100.0, "role": "data"}]
    placed = NOW - 3 * 3600000
    # Limit A (con lo elegido) cancelada; Limit B la reemplaza con lo mismo; B se llena 2 horas despues
    so.add_context({"kind": "decision", "symbol": "ADAUSDT", "side": "Buy", "at": placed, "levels": lv, "order_id": "oid-A",
                    "order_link_id": "bot_A", "outcome": "placed"})
    so.add_context({"kind": "decision", "symbol": "ADAUSDT", "side": "Buy", "at": placed + 5 * MIN, "levels": lv, "note": "la buena",
                    "order_id": "oid-B", "outcome": "placed"})
    filled = placed + 2 * 3600000
    merged = so.merge([{"trade_id": "ADA-1", "symbol": "ADAUSDT", "side": "Buy", "opened_at": filled, "pre_existing": False,
                        "open_order_id": "oid-B"}])[0]
    check("Limit llenada 2 horas despues: su decision por la orden, con lo elegido",
          merged["decision"] and merged["decision"]["order_id"] == "oid-B" and merged["decision"]["levels"][0]["role"] == "data", str(merged))
    # Otra Limit (C) se llena 3 minutos despues de poner una orden D que no es la suya: la decision de D no pasa a C
    so.add_context({"kind": "decision", "symbol": "ADAUSDT", "side": "Buy", "at": filled + 60 * MIN, "order_id": "oid-D", "outcome": "placed"})
    other = so.merge([{"trade_id": "ADA-2", "symbol": "ADAUSDT", "side": "Buy", "opened_at": filled + 63 * MIN, "pre_existing": False,
                       "open_order_id": "oid-C"}])[0]
    check("la decision de otra orden conocida no pasa al trade", other["decision"] is None, str(other.get("decision")))
    # Sin numero de orden en el trade (externa o bot viejo): por hora como antes
    old = so.merge([{"trade_id": "ADA-3", "symbol": "ADAUSDT", "side": "Buy", "opened_at": filled + 62 * MIN, "pre_existing": False}])[0]
    check("trade sin orden conocida: decision por hora", old["decision"] and old["decision"]["order_id"] == "oid-D")
    # Una decision de resultado desconocido (sin numero) se une por hora aunque el trade traiga su orden
    so.add_context({"kind": "decision", "symbol": "SOLUSDT", "side": "Sell", "at": NOW - 30 * MIN, "outcome": "unknown", "note": "sin respuesta"})
    unk = so.merge([{"trade_id": "SOL-1", "symbol": "SOLUSDT", "side": "Sell", "opened_at": NOW - 29 * MIN, "pre_existing": False,
                     "open_order_id": "oid-S"}])[0]
    check("decision sin numero (resultado desconocido): por hora", unk["decision"] and unk["decision"]["note"] == "sin respuesta")
    check("la decision de una orden se encuentra por su numero", so.decision_for("oid-A")["order_link_id"] == "bot_A"
          and so.decision_for(order_link_id="bot_A")["order_id"] == "oid-A" and so.decision_for("nada") is None)
    for bad in ({"order_id": "../x"}, {"order_link_id": "a" * 80}, {"order_id": 5}):
        try:
            so.clean_context({"kind": "decision", "symbol": "ADAUSDT", "side": "Buy", "at": NOW, **bad})
            check(f"numero de orden invalido rechazado: {bad}", False)
        except ValueError:
            check(f"numero de orden invalido rechazado: {bad}", True)
    # Imagen 10 velas despues del cierre: se une como la de cierre (por la hora del cierre) y va despues de ella
    sa = JournalStore(TMP / "after")
    closed_at = NOW - 3 * 3600000
    sa.add_context({"kind": "close", "symbol": "DOTUSDT", "side": "Sell", "at": closed_at + 2000, "image": path, "frame": "15m"})
    sa.add_context({"kind": "after", "symbol": "DOTUSDT", "side": "Sell", "at": closed_at + 2000, "until": closed_at + 2000 + 10 * 15 * MIN,
                    "image": path, "frame": "15m"})
    dot = sa.merge([{"trade_id": "DOT-1", "symbol": "DOTUSDT", "side": "Sell", "opened_at": closed_at - 3600000, "closed_at": closed_at,
                     "pre_existing": False}])[0]
    check("imagen 10 velas despues: unida al trade despues de la de cierre, con hasta donde muestra",
          [i["kind"] for i in dot["images"]] == ["close", "after"] and dot["images"][1]["until"] == closed_at + 2000 + 150 * MIN, str(dot["images"]))
    for bad, name in (({"until": closed_at - 5000}, "antes del cierre"), ({"until": NOW + 3600000}, "en el futuro"), ({}, "sin until")):
        try:
            sa.clean_context({"kind": "after", "symbol": "DOTUSDT", "side": "Sell", "at": closed_at, **bad})
            check(f"imagen 10 velas despues rechazada: {name}", False)
        except ValueError:
            check(f"imagen 10 velas despues rechazada: {name}", True)
    check("resultado desconocido o raro: solo placed y unknown quedan",
          so.clean_context({"kind": "decision", "symbol": "ADAUSDT", "side": "Buy", "at": NOW, "outcome": "x"}).get("outcome") is None)

    # ---------- analisis post-trade (13/11/2026): imagen con conclusion, unida por el numero del trade ----------
    san = JournalStore(TMP / "analysis")
    shut = NOW - 5 * 86400000  # un trade cerrado hace 5 dias: el analisis se hace despues, a cualquier hora
    san.add_context({"kind": "close", "symbol": "BTCUSDT", "side": "Buy", "at": shut + 3000, "image": path})
    san.add_context({"kind": "analysis", "symbol": "BTCUSDT", "side": "Buy", "at": NOW - 60000, "trade_id": "BTC-AN-1", "image": path,
                     "frame": "1h", "note": "  Entré antes de la confirmación  "})
    san.add_context({"kind": "analysis", "symbol": "BTCUSDT", "side": "Buy", "at": NOW - 120000, "trade_id": "BTC-AN-1", "image": path, "frame": "15m"})
    san.add_context({"kind": "analysis", "symbol": "BTCUSDT", "side": "Buy", "at": NOW, "trade_id": "BTC-OTRO", "image": path})
    an = san.merge([{"trade_id": "BTC-AN-1", "symbol": "BTCUSDT", "side": "Buy", "opened_at": shut - 3600000, "closed_at": shut,
                     "pre_existing": False}])[0]
    kinds = [(i["kind"], i.get("frame"), i.get("note")) for i in an["images"]]
    check("analisis unido por el numero del trade, dias despues del cierre, en el orden tomado y con su conclusion",
          kinds == [("close", None, None), ("analysis", "15m", None), ("analysis", "1h", "Entré antes de la confirmación")], str(kinds))
    for bad, name in (({}, "sin trade_id"), ({"trade_id": "a b"}, "trade_id invalido"), ({"trade_id": "X-1", "image": None}, "sin imagen")):
        try:
            body = {"kind": "analysis", "symbol": "BTCUSDT", "side": "Buy", "at": NOW, "image": path, **bad}
            san.clean_context({k: v for k, v in body.items() if v is not None})
            check(f"analisis rechazado: {name}", False)
        except ValueError:
            check(f"analisis rechazado: {name}", True)
    # La capa de dibujos de cada trade
    check("dibujos del analisis: vacios al empezar", san.analysis_drawings_get("BTC-AN-1") == [])
    shapes = [{"id": "r1", "type": "rectangle", "time1": 1, "time2": 2, "price1": 100, "price2": 101}, {"id": "t1", "type": "text", "text": "Salí tarde"}]
    check("dibujos del analisis: se guardan y se leen", san.analysis_drawings_put("BTC-AN-1", shapes) == 2
          and san.analysis_drawings_get("BTC-AN-1") == shapes and san.analysis_drawings_get("BTC-OTRO") == [])
    for bad, name in (("x", "no es lista"), ([{"id": 1}], "dibujo sin type"), ([{"type": "line"}] * 301, "mas de 300"),
                      ([{"type": "text", "text": "x" * (3 * 1024 * 1024)}], "mas de 2 MB")):
        try:
            san.analysis_drawings_put("BTC-AN-1", bad)
            check(f"dibujos del analisis rechazados: {name}", False)
        except ValueError:
            check(f"dibujos del analisis rechazados: {name}", True)
    check("dibujos del analisis: un rechazo no toca lo guardado", san.analysis_drawings_get("BTC-AN-1") == shapes)

    # Borrar una imagen del analisis (13/11/2026): sale del journal y su PNG se borra; las demas no se tocan
    img_a = san.save_image("journal", PNG)
    img_b = san.save_image("journal", PNG)
    for img in (img_a, img_b):
        san.add_context({"kind": "analysis", "symbol": "SOLUSDT", "side": "Sell", "at": NOW - 30000, "trade_id": "SOL-AN-1", "image": img})
    san.add_context({"kind": "close", "symbol": "SOLUSDT", "side": "Sell", "at": NOW - 7200000 + 1000, "image": img_b})
    san.remove_analysis_image("SOL-AN-1", img_a)
    sol = san.merge([{"trade_id": "SOL-AN-1", "symbol": "SOLUSDT", "side": "Sell", "opened_at": NOW - 9000000, "closed_at": NOW - 7200000,
                      "pre_existing": False}])[0]
    check("imagen del analisis borrada: sale del journal y su PNG se borra",
          [(i["kind"], i["image"]) for i in sol["images"]] == [("close", img_b), ("analysis", img_b)]
          and san.image_path(*img_a.split("/")) is None, str(sol["images"]))
    san.remove_analysis_image("SOL-AN-1", img_b)
    sol = san.merge([{"trade_id": "SOL-AN-1", "symbol": "SOLUSDT", "side": "Sell", "opened_at": NOW - 9000000, "closed_at": NOW - 7200000,
                      "pre_existing": False}])[0]
    check("una imagen que otro contexto usa (la de cierre) queda en disco aunque se borre del analisis",
          [i["kind"] for i in sol["images"]] == ["close"] and san.image_path(*img_b.split("/")) is not None, str(sol["images"]))
    for args, error, name in (((("SOL-AN-1", img_a)), KeyError, "ya borrada"), (("SOL-AN-1", path), KeyError, "no es de ese analisis"),
                              (("SOL-AN-1", "../x.png"), ValueError, "ruta con .."), (("a b", img_a), ValueError, "trade invalido")):
        try:
            san.remove_analysis_image(*args)
            check(f"borrado rechazado: {name}", False)
        except error:
            check(f"borrado rechazado: {name}", True)
    check("un borrado no entra como contexto por la ruta publica", "removed" not in __import__("journal_store").KINDS)

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
    check("medidas de la version nueva, con el OI (falso) de Bybit donde falta el local",
          m.get("version") == journal_measures.MEASURES_VERSION and m["decision"].get("oi_chg_4h") is not None
          and m["decision"].get("oi_rises") == 3, str({k: m["decision"].get(k) for k in ("oi_chg_1h", "oi_chg_4h", "oi_rises")}))

    # ---------- interes abierto: la serie local y, lo que le falta, Bybit (13/11/2026) ----------
    HOUR = 3600000
    t_end = NOW // (5 * MIN) * (5 * MIN)
    local_minutes = (t_end - 26 * HOUR) // MIN + np.arange(0, 20 * 60, 5)  # 20 horas locales
    real_points = journal_reading.oi_store.points
    journal_reading.oi_store.points = lambda s: (local_minutes, np.full(len(local_minutes), 500.0)) if s == "LOCALUSDT" else None
    OI_CALLS.clear()
    series = asyncio.run(journal_reading.oi_series("LOCALUSDT", t_end - 26 * HOUR, t_end))
    check("OI: lo local primero y Bybit solo desde donde termina",
          series is not None and series[1][0] == 500.0 and series[1][-1] >= 1000 and len(OI_CALLS) == 1
          and OI_CALLS[0][2] == int(local_minutes[-1]) * MIN + 1 and int(series[0][-1]) * MIN == t_end, str(OI_CALLS))
    journal_reading.oi_store.points = lambda s: (local_minutes, np.full(len(local_minutes), 500.0))
    OI_CALLS.clear()
    asyncio.run(journal_reading.oi_series("LOCALUSDT", t_end - 26 * HOUR, int(local_minutes[-1]) * MIN + 10 * MIN))
    check("OI: con la serie local al dia no se pide nada a Bybit", OI_CALLS == [])
    journal_reading.oi_store.points = real_points

    # ---------- cobertura del almacen para la regla: 46 dias seguidos ----------
    DAY = 86400000
    last_day = NOW // DAY
    paths = []
    for k in range(48):  # 2 de mas: la decision de abajo puede caer el dia anterior (cerca de las 00:00 UTC)
        iso = journal_reading._day_iso(last_day - k)
        path = (footprint_store._live_path if k < 3 else footprint_store._day_path)("COVUSDT", iso)  # recientes en vivo
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez(path, m=np.array([], dtype=np.int64), buy=np.array([], dtype=np.int64), sell=np.array([], dtype=np.int64),
                 info=np.array([1, 1, 1]))  # dia sin trades: basta con que exista
        paths.append(path)
    cov = journal_reading.coverage("COVUSDT", NOW)
    check("cobertura: 46 dias seguidos (oficiales y en vivo) dan una lectura completa", cov["days"] == 46 and cov["complete"], str(cov))
    kept = paths[10].read_bytes()
    paths[10].unlink()
    cov = journal_reading.coverage("COVUSDT", NOW)
    check("cobertura: un dia faltante corta el tramo", cov["days"] == 10 and not cov["complete"], str(cov))
    paths[10].write_bytes(kept)

    # ---------- lectura de la regla con un observer.read_at falso (el de App 1 se prueba en App 1) ----------
    def reading_fake(state="up", near=True, oi_dir="up"):
        move = {"tf": 240, "d": 1, "lo": 99.0, "hi": 104.0, "t0": 1, "t1": 2, "first": 1, "known": 2, "ratio": 2.0, "atrs": 3.0, "score": 6.0}
        return {"available": True, "time": 0, "price": 103.0, "side": 1,
                "context": {"240": {"tf": 240, "bars": 30, "net": 4.0, "efficiency": 0.5, "up_volume": 0.6, "state": state},
                            "60": {"tf": 60, "bars": 48, "net": 1.0, "efficiency": 0.2, "up_volume": 0.55, "state": "range"}},
                "moves": {"240": {"count": 1, "chosen": move}, "60": {"count": 0, "chosen": None}, "15": {"count": 0, "chosen": None}},
                "zones": [{"typ": "HVN", "rank": 1, "x0": 101.0, "x1": 101.5, "tf": 240}],
                "entry": {"zone": {"typ": "HVN", "rank": 1, "x0": 101.0, "x1": 101.5, "tf": 240}, "gap": 0.0005 if near else 0.01,
                          "near": near, "chance": 0.2},
                "oi": {"dir": oi_dir, "change": 0.01, "rises": 3, "falls": 0, "blocks": [1.0, 2.0, 3.0, 4.0]},
                "volume": {"last_15m_ratio": float("nan")}}  # un valor no finito no llega a la respuesta

    READ_CALLS = []

    def fake_read_at(symbol, time_ms, side, entry=None, live=None, oi=None):
        READ_CALLS.append({"symbol": symbol, "time": time_ms, "side": side, "entry": entry, "live": live, "oi": oi is not None})
        return reading_fake() if symbol == "COVUSDT" else {"available": False, "missing": "trades", "time": int(time_ms)}

    observer.read_at = fake_read_at
    journal_reading._store_reach = lambda symbol, at: at // MIN - 1 if symbol == "COVUSDT" else None
    rt = {"trade_id": "COV-1", "symbol": "COVUSDT", "side": "Buy", "opened_at": NOW - 2 * HOUR, "status": "closed", "entry": 102.0,
          "initial_stop_loss": 100.0, "pnl": 4.0, "closed_qty": 1.0, "pre_existing": False,
          "decision": {"at": NOW - 2 * HOUR - 3 * MIN, "order": {"entry": 101.9}}}
    rd = asyncio.run(journal_reading.trade_reading(rt))
    call = READ_CALLS[-1]
    conditions = {c["id"]: c["value"] for c in rd.get("conditions", [])}
    check("lectura en el minuto de la decision, con la entrada planeada, los dias en vivo y el OI",
          call["time"] == rt["decision"]["at"] and call["entry"] == 101.9 and call["live"] is True and call["oi"] and call["side"] == 1, str(call))
    check("lectura con su comparacion por bloques y sus condiciones (las del informe de App 1)",
          rd["available"] and rd["complete"] and rd["final"] and [r["block"] for r in rd["rows"]] == ["context_240", "context_60", "move", "zone", "oi", "volume"]
          and conditions.get("ctx240_favor") is True and conditions.get("zone_near") is True and conditions.get("oi_up") is True
          and conditions.get("move60") is False, str(rd)[:300])
    check("un valor no finito de la lectura queda en None", rd["reading"]["volume"]["last_15m_ratio"] is None)
    pre_r = asyncio.run(journal_reading.trade_reading({**rt, "pre_existing": True, "decision": None}))
    check("posicion anterior al journal sin decision: sin lectura y ya no cambia", not pre_r["available"] and pre_r["final"] and "antes" in pre_r["reason"])
    late = asyncio.run(journal_reading.trade_reading({**rt, "symbol": "NUEVAUSDT"}))
    check("sin trades grabados y el almacen todavia sin llegar: sin lectura y sin guardar", not late["available"] and not late["final"], str(late))
    old = asyncio.run(journal_reading.trade_reading({**rt, "symbol": "NUEVAUSDT", "decision": None, "opened_at": NOW - 3 * DAY}))
    check("pasados 2 dias se guarda lo que haya", old["final"])
    adapter = journal_reading.as_observer_trade({**rt, "pnl": -1.0}, rd["reading"])
    check("el R de la regla sale igual que el del bot: P&L sobre (entrada - SL inicial) x cantidad cerrada",
          abs(observer.r_multiple(adapter) - (-0.5)) < 1e-9, str(observer.r_multiple(adapter)))

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
        c.post("/api/journal/context", headers=H, json={"kind": "decision", "symbol": "LINKUSDT", "side": "Buy", "at": NOW - MIN,
                                                        "order_id": "oid-LINK", "levels": [{"id": "x", "kind": "POC", "price": 10.0}]})
        r = c.get("/api/journal/decision?order_id=oid-LINK", headers=H)
        check("la decision de una orden por la ruta (para devolver lo elegido al cancelarla)",
              r.status_code == 200 and r.json()["decision"]["levels"][0]["kind"] == "POC", r.text[:200])
        check("ruta de la decision: numero invalido o ausente, 400",
              c.get("/api/journal/decision?order_id=../x", headers=H).status_code == 400
              and c.get("/api/journal/decision", headers=H).status_code == 400)
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
            main.JOURNAL.measures_put(tid, {"available": True, "complete": True, "version": journal_measures.MEASURES_VERSION,
                                            "decision": decision})
        rep = c.get("/api/journal/report?days=30", headers=H).json()
        first = rep["rows"][0] if rep.get("rows") else {}
        check("informe: ganadoras contra perdedoras, la medida que las separa primero",
              rep.get("winners") == 7 and rep.get("losers") == 6 and first.get("key") == key and first.get("share") > 0.9, str(rep)[:300])
        check("informe: avisa muestra pequena", rep.get("small_sample") is True)

        # Medidas guardadas de la version anterior (sin delta ni OI de los dias recientes): se vuelven a calcular
        main.JOURNAL.measures_put("ETHUSDT-Buy-1", {"available": True, "complete": True, "decision": {}})
        r = c.get("/api/journal/measures/ETHUSDT-Buy-1", headers=H).json()
        check("medidas de la version anterior: se vuelven a calcular y se guardan con la nueva",
              r.get("cached") is False and r.get("version") == journal_measures.MEASURES_VERSION
              and main.JOURNAL.measures_get("ETHUSDT-Buy-1").get("version") == journal_measures.MEASURES_VERSION, str(r)[:200])

        # Lectura de la regla por la ruta: oculta con el trade abierto, calculada y guardada con el cerrado
        BOT_TRADES.append({"trade_id": "COV-open", "symbol": "COVUSDT", "side": "Buy", "opened_at": NOW - HOUR, "status": "open",
                           "pre_existing": False})
        r = c.get("/api/journal/reading/COV-open", headers=H).json()
        check("lectura de un trade abierto: oculta, como en App 1",
              r.get("hidden") is True and not r.get("available") and main.JOURNAL.readings_get("COV-open") is None, str(r)[:200])
        BOT_TRADES.append(dict(rt))
        r = c.get("/api/journal/reading/COV-1", headers=H).json()
        check("lectura de un trade cerrado: calculada y guardada",
              r.get("available") and r.get("cached") is False and main.JOURNAL.readings_get("COV-1") is not None, str(r)[:200])
        check("la segunda vez sale guardada", c.get("/api/journal/reading/COV-1", headers=H).json().get("cached") is True)
        check("lectura: trade desconocido 404 e id invalido 400", c.get("/api/journal/reading/NADA-1", headers=H).status_code == 404
              and c.get("/api/journal/reading/a%20b", headers=H).status_code == 400)

        # Analisis post-trade por las rutas: la capa de dibujos del trade y su imagen en el journal
        tid = "ETHUSDT-Buy-1"
        r = c.get(f"/api/journal/analysis/{tid}/drawings", headers=H)
        check("ruta de dibujos del analisis: vacia al empezar", r.status_code == 200 and r.json()["shapes"] == [], r.text[:200])
        r = c.post(f"/api/journal/analysis/{tid}/drawings", headers=H, json={"shapes": [{"id": "a", "type": "trendline"}]})
        check("ruta de dibujos del analisis: guardados", r.status_code == 200 and r.json()["count"] == 1
              and c.get(f"/api/journal/analysis/{tid}/drawings", headers=H).json()["shapes"][0]["type"] == "trendline", r.text[:200])
        check("ruta de dibujos del analisis: invalidos 400, de otra pagina 403",
              c.post(f"/api/journal/analysis/{tid}/drawings", headers=H, json={"shapes": "x"}).status_code == 400
              and c.post("/api/journal/analysis/a%20b/drawings", headers=H, json={"shapes": []}).status_code == 400
              and c.post(f"/api/journal/analysis/{tid}/drawings", headers={**H, "Origin": "https://evil.example"},
                         json={"shapes": []}).status_code == 403)
        check("ruta de dibujos con un numero de trade con dos puntos (cierre sin apertura)",
              c.post("/api/journal/analysis/close%3Ao3%3A1/drawings", headers=H, json={"shapes": []}).status_code == 200)
        r = c.post("/api/journal/context", headers=H, json={"kind": "analysis", "symbol": "ETHUSDT", "side": "Buy", "at": NOW,
                                                            "trade_id": tid, "image": shot, "frame": "1h", "note": "Buen trade"})
        j = c.get("/api/bot/journal", headers=H).json()
        eth = next(t for t in j["trades"] if t["trade_id"] == tid)
        check("imagen del analisis guardada y en el journal del trade, con su conclusion",
              r.status_code == 200 and eth["images"][-1]["kind"] == "analysis" and eth["images"][-1]["note"] == "Buen trade", str(eth["images"])[:300])
        q = f"/api/journal/analysis/{tid}/image?image={shot}"
        check("borrar la imagen del analisis desde otra pagina: 403",
              c.delete(q, headers={**H, "Origin": "https://evil.example"}).status_code == 403)
        r = c.delete(q, headers=H)
        eth = next(t for t in c.get("/api/bot/journal", headers=H).json()["trades"] if t["trade_id"] == tid)
        check("ruta de borrado: la imagen del analisis sale del journal", r.status_code == 200
              and all(i["kind"] != "analysis" for i in eth["images"]), r.text[:200] + str(eth["images"])[:200])
        check("ruta de borrado: otra vez 404, y una ruta invalida 400", c.delete(q, headers=H).status_code == 404
              and c.delete(f"/api/journal/analysis/{tid}/image?image=../x.png", headers=H).status_code == 400)

        # Informe de la regla: 6 ganadoras con 4 horas a favor y cerca de una zona, 6 perdedoras en contra y lejos
        for i in range(12):
            tid = f"RULE-Buy-{i}"
            win = i < 6
            BOT_TRADES.append({"trade_id": tid, "symbol": "RULEUSDT", "side": "Buy", "opened_at": NOW - (i + 3) * HOUR,
                               "closed_at": NOW - (i + 2) * HOUR, "status": "closed", "pnl": 3.0 if win else -2.0, "entry": 100.0,
                               "initial_stop_loss": 99.0, "closed_qty": 1.0, "pre_existing": False})
            main.JOURNAL.readings_put(tid, {"version": journal_reading.READING_VERSION, "available": True, "complete": True, "final": True,
                                            "reading": reading_fake("up" if win else "down", near=win)})
        BOT_TRADES.append({"trade_id": "RULE-Buy-partial", "symbol": "RULEUSDT", "side": "Buy", "opened_at": NOW - 20 * HOUR,
                           "closed_at": NOW - 19 * HOUR, "status": "closed", "pnl": 1.0, "pre_existing": False})
        main.JOURNAL.readings_put("RULE-Buy-partial", {"version": journal_reading.READING_VERSION, "available": True, "complete": False,
                                                       "final": True, "reading": reading_fake()})
        rule = c.get("/api/journal/report?days=30", headers=H).json().get("rule") or {}
        row = next((x for x in rule.get("conditions", []) if x["id"] == "ctx240_favor"), {})
        # Con COV-1 (ganadora, a favor y cerca): 7 con la condicion, todas ganan; 6 sin ella, ninguna
        check("informe de la regla: con 4 horas a favor 7 de 7 ganan (R 20/7); sin ellas 0 de 6 (R -2)",
              rule.get("complete") == 13 and rule.get("partial") == 1 and row.get("with", {}).get("n") == 7
              and row["with"]["wins"] == 7 and abs(row["with"]["avg_r"] - 20 / 7) < 1e-9
              and row.get("without", {}).get("n") == 6 and row["without"]["wins"] == 0 and row["without"]["avg_r"] == -2.0,
              str({k: rule.get(k) for k in ("complete", "partial", "without", "pending")}) + " " + str(row)[:300])
        check("informe de la regla: entradas cerca de una zona (7 de 13) y lo que daria el azar",
              rule.get("zones", {}).get("orders") == 13 and rule["zones"]["near"] == 7 and abs(rule["zones"]["chance"] - 0.2) < 1e-9, str(rule.get("zones")))
        check("informe de la regla: avisa muestra pequena y trae habitos y mejores contra peores",
              rule.get("small_sample") is True and len(rule.get("habits", [])) == len(observer.RULE_PARTS) and isinstance(rule.get("best_worst"), list))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
