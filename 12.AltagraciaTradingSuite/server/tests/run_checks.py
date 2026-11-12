# Pruebas sin conexion del servidor de la suite (no llaman a Bybit ni al bot).
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\run_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_checks_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"  # las pruebas nunca graban en el OrderFlowData real
os.environ["SUITE_OFFICIAL"] = "0"  # ni bajan dias oficiales
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


H = {"Host": "127.0.0.1:13000"}
bot_calls = []


async def fake_bot(method, path, **kw):
    bot_calls.append((method, path, kw.get("json")))
    if path == "/api/settings/trading-paused":
        return {"success": True, "trading_paused": kw["json"]["paused"]}
    return {"status": "online", "trading_paused": False, "alerts": [], "orders": [], "total": 0}


main._bot = fake_bot
captured = {}


def fake_footprints(*args, **kw):
    captured["args"], captured["kw"] = args, kw
    return {"footprints": [], "step_size": 10, "known_until": args[4]}


main.footprint_store.footprints = fake_footprints


# ---------- indicadores en vivo (market_routes): Bybit siempre falso ----------
mr = main.market_routes
NOW = int(main.time.time() * 1000)
M15 = 15 * 60_000


def fake_candles(n=400, tf_ms=M15, in_progress=True):
    """Velas de 15m que terminan ahora: zigzag con un maximo claro y volumen alto en el."""
    import math
    first = (NOW // tf_ms) * tf_ms - (n - 1) * tf_ms
    out = []
    for i in range(n):
        base = 100 + 10 * math.sin(i / 12)
        out.append({"timestamp": first + i * tf_ms, "open": base, "high": base + 1 + (5 if i == 200 else 0),
                    "low": base - 1, "close": base + (0.5 if i % 2 else -0.5),
                    "volume": 1000.0 + (9000 if i == 200 else (i * 37) % 500),
                    "in_progress": in_progress and i == n - 1})
    return out


kline_calls = []


async def fake_klines(symbol, interval, days):
    kline_calls.append((symbol, interval, days))
    return fake_candles()


oi_calls = []
OI_LOCAL_LAST = (NOW // M15) * M15 - 20 * M15  # la serie local termina 20 velas antes de ahora


async def fake_bybit_oi(symbol, oi_interval, start_ms, end_ms):
    oi_calls.append((symbol, oi_interval, start_ms, end_ms))
    first = -(-start_ms // M15) * M15
    return {t: 5000.0 + (t - first) / M15 for t in range(first, end_ms + 1, M15)}


def fake_oi_series(symbol, interval, start_ms, end_ms):
    if symbol != "BTCUSDT":
        return None
    first = -(-start_ms // M15) * M15
    data = [{"timestamp": t, "openInterest": 4000.0} for t in range(first, min(end_ms, OI_LOCAL_LAST) + 1, M15)]
    return {"data": data, "oi_first_timestamp": 1_600_000_000_000, "oi_last_timestamp": OI_LOCAL_LAST,
            "oi_first_date": "x", "oi_last_date": "y", "oi_interval": "15min"}


def market_checks(c):
    import sys as _sys
    main.candles.klines = fake_klines
    mr._bybit_oi = fake_bybit_oi
    mr.oi_store.series = fake_oi_series

    # Interes abierto: serie local + Bybit para lo que falta hasta ahora
    start = NOW - 10 * 86_400_000
    r = c.get(f"/api/open-interest/BTCUSDT?interval=15m&start_timestamp_ms={start}&end_timestamp_ms={NOW + 86_400_000}&local_only=true", headers=H)
    d = r.json()
    ts = [p["timestamp"] for p in d.get("data", [])]
    check("OI: local + Bybit hasta ahora", r.status_code == 200 and d.get("success") and d.get("source") == "local+bybit"
          and ts == sorted(set(ts)) and ts[-1] > OI_LOCAL_LAST and ts[-1] <= NOW, str(d)[:200])
    check("OI: la serie local manda donde existe",
          all(p["openInterest"] == 4000.0 for p in d["data"] if p["timestamp"] <= OI_LOCAL_LAST))
    check("OI: Bybit solo se pide desde el final de la serie local",
          len(oi_calls) == 1 and oi_calls[0][2] > OI_LOCAL_LAST and oi_calls[0][3] <= NOW + 1000 and oi_calls[0][1] == "15min")
    c.get(f"/api/open-interest/BTCUSDT?interval=15m&start_timestamp_ms={start}&end_timestamp_ms={NOW}", headers=H)
    check("OI: lo de Bybit queda en memoria (no repite el pedido)", len(oi_calls) == 1)
    r = c.get("/api/open-interest/ETHUSDT?interval=1h&days=5", headers=H).json()
    check("OI: sin serie local, todo de Bybit y 1h en 1h", r.get("success") and r.get("source") == "bybit"
          and oi_calls[-1][1] == "1h")

    async def broken_oi(*a, **k):
        raise main.HTTPException(status_code=502, detail="Bybit: caido")
    mr._bybit_oi = broken_oi
    r = c.get("/api/open-interest/SOLUSDT?interval=15&days=2", headers=H).json()
    check("OI: Bybit caido y sin serie local responde success false", r.get("success") is False and r.get("data") == [])
    mr._bybit_oi = fake_bybit_oi

    # VWAP con vwap_calculator de App 1
    r = c.get("/api/vwap/BTCUSDT?interval=15m&days=30&vwap_type=session&band_multipliers=1,2", headers=H).json()
    check("VWAP: un punto por vela con bandas", r.get("success") and len(r["data"]) == 400
          and "upper_1" in str(r["data"][-1]["bands"]) and r["data"][-1]["vwap"] > 0, str(r)[:200])
    r = c.get("/api/vwap/BTCUSDT?interval=15m&band_multipliers=x,y&vwap_type=raro", headers=H)
    check("VWAP: parametros invalidos vuelven a los de fabrica", r.status_code == 200 and r.json().get("vwap_type") == "session")

    # S&R clasico: solo velas cerradas, mismo formato que App 1
    r = c.get("/api/support-resistance/BTCUSDT?interval=15m&days=30&z_score_threshold=0&left_bars=5&right_bars=5", headers=H).json()
    data = r.get("data", {})
    check("S&R: niveles y precio actual", r.get("success") and data.get("resistances") and data.get("supports")
          and data["currentPrice"] == fake_candles()[-1]["close"], str(r)[:200])
    check("S&R: el maximo de la vela 200 es resistencia",
          any(abs(lv["price"] - fake_candles()[200]["high"]) < 1e-9 for lv in data.get("resistances", [])))
    check("S&R: un marco no soportado se rechaza", c.get("/api/support-resistance/BTCUSDT?interval=2h", headers=H).status_code == 400)

    # Patrones: nunca alertas, ni rutas de alertas
    r = c.post("/api/rejection-patterns/detect", headers=H, json={
        "symbol": "BTCUSDT", "interval": "15m", "days": 30, "config": {"enabled": True, "alertsEnabled": True},
        "referenceContexts": []}).json()
    check("Rejection: responde patrones con las velas de Bybit", r.get("success") and isinstance(r.get("patterns"), list), str(r)[:200])
    check("Rejection: alert_sender de App 1 nunca se carga", "alert_sender" not in _sys.modules)
    check("Rutas de alertas no existen",
          c.post("/api/pattern-alert", headers=H, json={}).status_code in (404, 405)
          and c.post("/api/proximity-alerts/batch", headers=H, json={}).status_code in (404, 405))
    check("Rejection: simbolo invalido rechazado",
          c.post("/api/rejection-patterns/detect", headers=H, json={"symbol": "../x", "interval": "15"}).status_code == 400)

    r = c.post("/api/double-topbottom/detect", headers=H, json={"symbol": "BTCUSDT", "interval": "15m", "days": 30,
                                                                 "config": {"enabled": True}}).json()
    check("DTB: devuelve patterns (lo que lee el indicador en vivo) y tramos",
          r.get("success") and isinstance(r.get("patterns"), list) and isinstance(r.get("chunks"), list), str(r)[:200])
    r2 = c.post("/api/double-topbottom/chunk", headers=H, json={"symbol": "BTCUSDT", "interval": "15m", "upTo": NOW}).json()
    check("DTB: /chunk con upTo devuelve los ya conocidos", r2.get("success") and len(r2["patterns"]) == len(
        [p for p in r["patterns"] if p.get("knownAt", 0) <= NOW]))
    seen = {}
    real = mr._double.detect_patterns
    mr._double.detect_patterns = lambda s, rows, cfg: seen.setdefault("rows", rows) and []
    c.post("/api/double-topbottom/detect", headers=H, json={"symbol": "BTCUSDT", "interval": "15m", "config": {}})
    mr._double.detect_patterns = real
    check("DTB: el detector no recibe la vela en curso",
          seen.get("rows") and not any(x.get("in_progress") for x in seen["rows"]) and len(seen["rows"]) == 399)

    # Elementos OF y setups: siempre con live=True y cortados en lo guardado
    got = {}

    def fake_detect(symbol, tf, start, end, cut, target, band_days, vol_filter, live=False):
        got.update(symbol=symbol, tf=tf, cut=cut, live=live)
        return {"events": [], "bars": [], "known_until": cut, "warming": False, "step": None}

    old_detect, old_until = mr.of_elements.detect, mr._store_until
    mr.of_elements.detect = fake_detect
    mr._store_until = lambda symbol, now: NOW - 90_000
    r = c.get(f"/api/orderflow/elements/BTCUSDT?interval=15&start_timestamp=1&end_timestamp={NOW}&known_until={NOW + 10 ** 9}", headers=H)
    check("Elementos OF: live=True", r.status_code == 200 and got.get("live") is True and r.json().get("catalog"))
    check("Elementos OF: corte en el ultimo minuto guardado, nunca despues de ahora", got.get("cut") == NOW - 90_000)
    check("Elementos OF: marco en texto rechazado", c.get("/api/orderflow/elements/BTCUSDT?interval=15m&start_timestamp=1&end_timestamp=2", headers=H).status_code == 400)
    mr._store_until = lambda symbol, now: None
    c.get("/api/orderflow/elements/BTCUSDT?interval=60&start_timestamp=1&end_timestamp=2", headers=H)
    check("Elementos OF: sin almacen en vivo el corte es ahora", NOW <= got.get("cut", 0) <= int(main.time.time() * 1000))

    seen_setups = {}

    def fake_setups(symbol, tf, start, end, cut, recipes, target, vol_filter, live=False):
        seen_setups.update(live=live, recipes=recipes)
        return {"matches": [], "known_until": cut, "warming": False}

    old_setups = mr.of_setups.setups
    mr.of_setups.setups = fake_setups
    r = c.post("/api/orderflow/setups/BTCUSDT", headers=H, json={"interval": "15", "start_timestamp": 1, "end_timestamp": 2,
                                                                  "known_until": NOW, "recipes": [{"id": "S2"}]})
    check("Setups: live=True", r.status_code == 200 and seen_setups.get("live") is True)
    r = c.post("/api/orderflow/setups/BTCUSDT/evaluate", headers=H, json={"interval": "15", "recipe": {}, "validation": True})
    check("Setups: la comprobacion final no se hace aqui (no escribe en OrderFlowData)",
          r.status_code == 200 and r.json().get("success") is False)
    mr.of_elements.detect, mr._store_until, mr.of_setups.setups = old_detect, old_until, old_setups
    check("Velas de Bybit: la cache corta evita pedir lo mismo varias veces", len(kline_calls) < 8, str(kline_calls))


try:
    with TestClient(main.app) as c:
        # Proteccion
        check("host ajeno rechazado", c.get("/api/suite/status", headers={"Host": "evil.example"}).status_code == 403)
        check("origen ajeno rechazado", c.get("/api/drawings/BTCUSDT", headers={**H, "Origin": "https://evil.example"}).status_code == 403)
        check("origen de este PC aceptado", c.get("/api/drawings/BTCUSDT", headers={**H, "Origin": "http://localhost:13001"}).status_code == 200)
        check("simbolo invalido rechazado", c.get("/api/drawings/bad..name", headers=H).status_code == 400)
        check("marco no soportado rechazado", c.get("/api/historical/BTCUSDT?interval=3m", headers=H).status_code == 400)
        check("marcos de App 1 aceptados", [main._interval(x) for x in ("1m", "15m", "1h", "4h", "60")] == ["1", "15", "60", "240", "60"])

        # Pausa del bot: solo con confirmacion explicita
        r = c.post("/api/bot/pause", headers=H, json={"paused": True})
        check("pausa sin confirmacion: no llama al bot", r.status_code == 400 and not bot_calls)
        r = c.post("/api/bot/pause", headers=H, json={"paused": "si", "confirm": "CAMBIAR_PAUSA"})
        check("pausa con valor no booleano: no llama al bot", r.status_code == 400 and not bot_calls)
        r = c.post("/api/bot/pause", headers=H, json={"paused": True, "confirm": "CAMBIAR_PAUSA"})
        check("pausa confirmada: una llamada al bot con el valor pedido",
              r.status_code == 200 and bot_calls == [("POST", "/api/settings/trading-paused", {"paused": True})])

        # Footprints: siempre con los dias de la nube y del PC, nunca despues de ahora
        r = c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&known_until=99999999999999", headers=H)
        check("footprints con live=True", r.status_code == 200 and captured["kw"].get("live") is True)
        check("known_until nunca pasa de ahora", captured["args"][4] <= int(main.time.time() * 1000))
        real_until = main.market_routes._store_until
        main.market_routes._store_until = lambda sym, now: now - 120_000  # almacen 2 min detras
        try:
            c.get("/api/orderflow/historical/BTCUSDT?interval=1&start_timestamp=1&end_timestamp=2&known_until=99999999999999", headers=H)
            lag = int(main.time.time() * 1000) - captured["args"][4]
            check("footprints: known_until es el ultimo minuto armado, no ahora", 110_000 <= lag <= 130_000, str(lag))
        finally:
            main.market_routes._store_until = real_until
        # Step parejo: mediana del rango de las velas / 10, redondeado; sin tope de niveles por vela
        real_klines = main.candles.cached_klines
        async def fake_uniform_klines(symbol, interval, days):
            return [{"high": 100 + r, "low": 100, "in_progress": False} for r in [150, 180, 200, 175, 190] * 10] +                    [{"high": 999, "low": 1, "in_progress": True}]
        main.candles.cached_klines = fake_uniform_klines
        main._uniform_steps.clear()
        try:
            c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&step_mode=uniform&max_levels=10", headers=H)
            check("step parejo: mediana 180 / 10 -> 20, sin tope por vela",
                  captured["args"][5] == 20 and captured["args"][7] is None, f"{captured['args'][5]} {captured['args'][7]}")
            c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&step_mode=uniform&step=25", headers=H)
            check("step parejo: un step pedido se respeta", captured["args"][5] == 25 and captured["args"][7] is None)
            c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&max_levels=10", headers=H)
            check("sin step parejo (App 1): tope de niveles por vela", captured["args"][5] is None and captured["args"][7] == 10)
            check("redondeo del step", [main.nice_step(x) for x in (18.0, 0.639, 0.0049, 75.6, 3.3)] == [20, 0.5, 0.005, 100, 2.5],
                  str([main.nice_step(x) for x in (18.0, 0.639, 0.0049, 75.6, 3.3)]))
        finally:
            main.candles.cached_klines = real_klines
        check("modo de imbalance desconocido vuelve a 'level'",
              c.get("/api/orderflow/historical/BTCUSDT?interval=15&start_timestamp=1&end_timestamp=2&imbalance_mode=x", headers=H).status_code == 200
              and captured["args"][6]["mode"] == "level")

        # Dibujos
        shapes = [{"id": "a", "type": "rectangle"}]
        r = c.post("/api/drawings/ETHUSDT", headers=H, json={"interval": "15", "shapes": shapes})
        back = c.get("/api/drawings/ETHUSDT", headers=H).json()
        check("dibujos guardados y leidos", r.status_code == 200 and back["shapes"] == shapes)
        check("dibujos sin temporales", not list((TMP / "data" / "drawings").glob("*.tmp")))
        check("dibujos con forma invalida rechazados", c.post("/api/drawings/ETHUSDT", headers=H, json={"shapes": "x"}).status_code == 400)
        (TMP / "data" / "drawings" / "SOLUSDT.json").write_text("{roto", encoding="utf-8")
        check("archivo de dibujos danado: error, no lista vacia", c.get("/api/drawings/SOLUSDT", headers=H).status_code == 500)

        market_checks(c)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)} de {len(results)} pruebas pasan")
sys.exit(1 if failed else 0)
