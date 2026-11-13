# Pruebas sin conexion del Swing del servidor (paso 5, parte A):
#   - las reglas de swing_rules.py dan lo mismo que detectSwings() de App 1, corrido en node con los mismos casos;
#   - la deteccion al cierre anota cada senal una vez, con las velas cerradas y sin repetir tras reiniciar;
#   - la configuracion se toma de la Watchlist, se valida y no se pisa si esta danada;
#   - las rutas responden y nada se envia al bot.
# Bybit y el bot nunca se consultan. Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\swing_checks.py
import asyncio
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_swing_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import swing_rules  # noqa: E402
import swing_watch  # noqa: E402
from settings import CONFIG, REPO_DIR  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


MIN = 60_000
M15 = 900_000
H1 = 3_600_000


def make_candles(count, step, start, price, tick, seed, vol=1.0):
    """Velas con ruido, redondeadas al tick (asi hay empates de maximos y minimos, como en Bybit)."""
    rng = np.random.default_rng(seed)
    rows, close = [], price
    for i in range(count):
        o = close
        c = o * (1 + rng.normal(0, 0.002))
        hi = max(o, c) * (1 + abs(rng.normal(0, 0.0012)))
        lo = min(o, c) * (1 - abs(rng.normal(0, 0.0012)))
        o, c, hi, lo = (round(round(x / tick) * tick, 10) for x in (o, c, hi, lo))
        rows.append({"timestamp": start + i * step, "open": o, "high": max(hi, o, c), "low": min(lo, o, c),
                     "close": c, "volume": round(float(rng.lognormal(3, 0.7)) * vol, 3)})
        close = c
    return rows


T15 = 1_794_441_600_000  # 12/11/2026 00:00 UTC
C15 = make_candles(800, M15, T15 - 800 * M15, 80_000.0, 0.1, 11)
# Empates buscados: dos velas seguidas con el mismo maximo o el mismo minimo no son swing
for k in (50, 120, 333, 610):
    top = max(C15[k]["high"], C15[k + 1]["high"])
    C15[k]["high"] = C15[k + 1]["high"] = top
    bottom = min(C15[k + 2]["low"], C15[k + 3]["low"])
    C15[k + 2]["low"] = C15[k + 3]["low"] = bottom
# Una vela que es swing alto y bajo a la vez
around = C15[290:311]
C15[300]["high"] = round(max(c["high"] for c in around) * 1.01, 1)
C15[300]["low"] = round(min(c["low"] for c in around) * 0.99, 1)
# Volumen parejo: sin variacion el z-score es 0
for k in range(400, 431):
    C15[k]["volume"] = 0.0 if k < 415 else 25.0
C1 = make_candles(900, MIN, T15 - 900 * MIN, 81_000.0, 0.1, 5)
CH = make_candles(300, H1, T15 - 300 * H1, 0.0123, 0.000001, 7, vol=1e6)

try:
    # ---------- 1. Las mismas senales que App 1 ----------
    closes = sorted(c["close"] for c in C15)
    q = lambda f: closes[int(f * (len(closes) - 1))]  # noqa: E731
    zones = [
        {"id": "z_ambas", "min": q(0.2), "max": q(0.4), "direction": "BOTH", "enabled": True, "timeBound": False},
        {"id": "z_largos", "min": q(0.6), "max": q(0.75), "direction": "LONG", "enabled": True, "timeBound": False},
        {"id": "z_hora_cortos", "min": q(0.3), "max": q(0.8), "direction": "SHORT", "enabled": True, "timeBound": True,
         "timeStart": C15[200]["timestamp"], "timeEnd": C15[260]["timestamp"]},
        {"id": "z_rect", "min": q(0.1), "max": q(0.9), "direction": "BOTH", "enabled": True, "timeBound": True,
         "timeStart": C15[500]["timestamp"], "timeEnd": C15[560]["timestamp"], "sourceRectId": "r_zona"},
        {"id": "z_apagada", "min": 0, "max": 10 ** 9, "direction": "BOTH", "enabled": False, "timeBound": False},
        {"id": "z_otra_moneda", "min": 0, "max": 10 ** 9, "direction": "BOTH", "enabled": True, "timeBound": False,
         "symbol": "ETHUSDT"},
    ]
    base2 = swing_rules.detect(C15, swing_rules.clean_rules({"swingBars": 2}), "BTCUSDT")
    shapes = []
    for k, s in enumerate(base2[5::17][:6]):
        shapes.append({"type": "rectangle", "id": f"rect_{k}", "price1": s["price"] * 1.003, "time1": s["timestamp"] - 3 * M15,
                       "price2": s["price"] * 0.997, "time2": s["timestamp"] + 3 * M15, "label": "Zone"})
    shapes.append({"type": "rectangle", "id": "rect_grande", "price1": closes[0] * 0.9, "time1": C15[100]["timestamp"],
                   "price2": closes[-1] * 1.1, "time2": C15[220]["timestamp"], "label": "Zone"})
    shapes.append({"type": "rectangle", "id": "rect_sin_precio", "price1": closes[0], "time1": C15[0]["timestamp"],
                   "time2": C15[-1]["timestamp"], "label": "Zone"})
    shapes.append({"type": "horizontal_line", "id": "linea", "price": closes[400]})
    vwap = swing_watch.vwap_points(C15, swing_watch.DEFAULT_VWAP)
    vwap_holes = [p for i, p in enumerate(vwap) if i % 7]  # sin algunos puntos: se usa el anterior mas cercano

    cases = [
        {"name": "fabrica", "candles": "c15", "config": {}},
        {"name": "watchlist_btc", "candles": "c15", "config": {"swingBars": 2, "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}}},
        {"name": "volumen", "candles": "c15", "config": {"swingBars": 3, "volumeFilter": {"enabled": True, "minZScore": 1.0, "lookbackBars": 10}}},
        {"name": "largos", "candles": "c15", "config": {"swingBars": 2, "direction": "LONG"}},
        {"name": "cortos", "candles": "c15", "config": {"swingBars": 2, "direction": "SHORT"}},
        {"name": "zonas", "candles": "c15", "config": {"swingBars": 2, "priceZones": zones}},
        {"name": "vwap_rect", "candles": "c15", "vwap": vwap, "shapes": shapes,
         "config": {"swingBars": 2, "vwapFilter": {"enabled": True, "deviations": [1, 2, 3], "marginPercent": 20}}},
        {"name": "vwap_banda1_volumen", "candles": "c15", "vwap": vwap, "shapes": shapes,
         "config": {"swingBars": 2, "volumeFilter": {"enabled": True, "minZScore": 1.5, "lookbackBars": 20},
                    "vwapFilter": {"enabled": True, "deviations": [1], "marginPercent": 35, "skipVolumeInRectangle": True}}},
        {"name": "vwap_sin_vp_fixed", "candles": "c15", "vwap": vwap, "shapes": shapes, "profileRectIds": ["rect_grande", "rect_1"],
         "config": {"swingBars": 2, "vwapFilter": {"enabled": True, "deviations": [2, 3], "marginPercent": 10}}},
        {"name": "vwap_huecos", "candles": "c15", "vwap": vwap_holes, "shapes": shapes,
         "config": {"swingBars": 2, "vwapFilter": {"enabled": True, "deviations": [1, 2], "marginPercent": 20}}},
        {"name": "vwap_indicador_apagado", "candles": "c15", "shapes": shapes,
         "config": {"swingBars": 2, "vwapFilter": {"enabled": True, "deviations": [1], "marginPercent": 20}}},
        {"name": "vwap_zonas", "candles": "c15", "vwap": vwap, "shapes": shapes,
         "config": {"swingBars": 2, "priceZones": zones, "vwapFilter": {"enabled": True, "deviations": [1, 2, 3], "marginPercent": 20}}},
        {"name": "pocas_velas", "candles": "c15_corta", "config": {"swingBars": 5}},
        {"name": "1m_watchlist", "candles": "c1", "config": {"swingBars": 2, "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}}},
        {"name": "1h_moneda_barata", "candles": "ch", "config": {"swingBars": 4, "volumeFilter": {"enabled": True, "minZScore": 0.5, "lookbackBars": 30}}},
    ]
    for c in cases:
        c.setdefault("symbol", "BTCUSDT")
        c.setdefault("interval", "15")
    payload = {"candles": {"c15": C15, "c15_corta": C15[:10], "c1": C1, "ch": CH}, "cases": cases}
    src = Path(CONFIG["app1_backend"]).parent / "frontend" / "src"
    inp, out = TMP / "casos.json", TMP / "app1.json"
    inp.write_text(json.dumps(payload), encoding="utf-8")
    run = subprocess.run(["node", str(HERE / "swing_parity.mjs"), str(src), str(inp), str(out)],
                         capture_output=True, text=True, timeout=120)
    check("App 1 corre en node con los casos", run.returncode == 0 and out.exists(), run.stderr[-500:])
    app1 = json.loads(out.read_text(encoding="utf-8")) if out.exists() else {}
    worst = 0.0
    for c in cases:
        rules = swing_rules.clean_rules(c["config"])
        rects = swing_rules.rectangle_zones(c.get("shapes"), c.get("profileRectIds"))
        mine = swing_rules.detect(payload["candles"][c["candles"]], rules, c["symbol"], c.get("vwap"), rects)
        theirs = app1.get(c["name"], [])
        same = len(mine) == len(theirs)
        for a, b in zip(mine, theirs):
            for key in ("timestamp", "type", "price", "direction", "candleIndex", "zoneId", "isInRectangle"):
                if a[key] != b[key]:
                    same = False
            diff = abs(a["volumeZScore"] - b["volumeZScore"])
            worst = max(worst, diff)
            if diff > 1e-9 * max(1.0, abs(b["volumeZScore"])):
                same = False
        check(f"mismas senales que App 1: {c['name']} ({len(theirs)})", same and (len(theirs) > 0 or c["name"] == "pocas_velas"),
              f"servidor {len(mine)}, App 1 {len(theirs)}")
    check("z-score igual que App 1 hasta el ultimo decimal", worst == 0.0, f"diferencia maxima {worst}")

    # Los casos tocan lo que deben tocar
    def run_case(name):
        c = next(x for x in cases if x["name"] == name)
        return swing_rules.detect(payload["candles"][c["candles"]], swing_rules.clean_rules(c["config"]), "BTCUSDT",
                                  c.get("vwap"), swing_rules.rectangle_zones(c.get("shapes"), c.get("profileRectIds")))
    t300 = C15[300]["timestamp"]
    both = [s for s in run_case("watchlist_btc") if s["timestamp"] == t300]
    check("vela que es swing alto y bajo: queda como alto, con su maximo (como su flecha)",
          len(both) == 1 and both[0]["type"] == "SWING_HIGH" and both[0]["price"] == C15[300]["high"])
    check("empate de maximos no es swing", not any(s["timestamp"] in (C15[k]["timestamp"], C15[k + 1]["timestamp"]) and s["type"] == "SWING_HIGH"
                                                  for s in base2 for k in (50, 120, 333, 610)))
    no_filter = swing_rules.detect(C15, swing_rules.clean_rules({"swingBars": 2}), "BTCUSDT")
    with_vwap = run_case("vwap_rect")
    inside = [s for s in no_filter if swing_rules._inside_rectangle(s["price"], s["timestamp"], swing_rules.rectangle_zones(shapes))]
    kept = {s["timestamp"] for s in with_vwap}
    check("el filtro VWAP rechaza swings dentro de un rectangulo y deja otros", inside and any(s["timestamp"] not in kept for s in inside)
          and any(s["timestamp"] in kept for s in inside), f"{len(inside)} dentro")
    outside = [s for s in no_filter if s not in inside]
    check("afuera de los rectangulos las senales no cambian", all(s["timestamp"] in kept for s in outside))
    check("con el indicador VWAP apagado el filtro no actua", len(run_case("vwap_indicador_apagado")) == len(no_filter))
    check("las zonas filtran: solo quedan senales en alguna zona", 0 < len(run_case("zonas")) < len(no_filter))
    check("rectangulos sin precio y otras figuras no cuentan",
          {z["sourceRectId"] for z in swing_rules.rectangle_zones(shapes)} == {f"rect_{k}" for k in range(6)} | {"rect_grande"})

    # ---------- 2. Hora en que se conoce y huecos ----------
    check("se conoce al cierre de la ultima vela de su derecha", swing_rules.known_at(T15, 2, "15") == T15 + 3 * M15
          and swing_rules.known_at(T15, 3, "1") == T15 + 4 * MIN)
    holes = [c for i, c in enumerate(C1) if i != 450]
    sig_hole = swing_rules.detect(holes, swing_rules.clean_rules({"swingBars": 2}), "BTCUSDT")
    flagged = [s for s in sig_hole if swing_rules.gap_around(holes, s["candleIndex"], 2, "1")]
    check("un swing junto a una vela que falta queda marcado con hueco",
          flagged and all(abs(s["timestamp"] - C1[450]["timestamp"]) <= 3 * MIN for s in flagged), str(len(flagged)))

    # ---------- 3. Comparacion con el Swing de la Watchlist (App 2) ----------
    app2_path = REPO_DIR / "2.WatchlistConIndicadores" / "backend" / "swing_detector.py"
    if app2_path.exists():
        import importlib.util
        spec = importlib.util.spec_from_file_location("app2_swing_detector", app2_path)
        app2 = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(app2)
        cfg2 = {"enabled": True, "swingBars": 2, "direction": "BOTH", "priceZones": [],
                "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}, "vwapFilter": {"enabled": False}}
        theirs = app2.SwingDetector().detect("BTCUSDT", "1", C1, cfg2)
        mine = swing_rules.detect(C1, swing_rules.clean_rules({"swingBars": 2, "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}}), "BTCUSDT")
        check("con la configuracion de la Watchlist (sin filtros) salen los mismos swings que en la Watchlist",
              [(s.timestamp, s.signal_type) for s in theirs] == [(s["timestamp"], s["type"]) for s in mine], f"{len(theirs)} contra {len(mine)}")
        by_ts = {c["timestamp"]: c for c in C1}
        check("la Watchlist da el cierre como precio; el servidor, el maximo o el minimo como App 1",
              all(s.price == by_ts[s.timestamp]["close"] for s in theirs)
              and all(s["price"] == by_ts[s["timestamp"]]["high" if s["type"] == "SWING_HIGH" else "low"] for s in mine))

    # ---------- 4. Configuracion ----------
    wl = TMP / "watchlist_swing.json"
    wl.write_text(json.dumps({"enabled": True, "alertsEnabled": True, "interval": "1", "days": 60, "cooldownMinutes": 5,
                              "symbols": ["BTCUSDT", "ETHUSDT", "ARBUSDT"], "swingBars": 3, "direction": "BOTH",
                              "volumeFilter": {"enabled": False, "minZScore": 1, "lookbackBars": 10},
                              "vwapFilter": {"enabled": False, "deviations": [1, 2, 3], "marginPercent": 20, "skipVolumeInRectangle": False},
                              "priceZones": [], "alertTargetUrl": "http://localhost:5000/api/watchlist-alert",
                              "symbolConfigs": {"BTCUSDT": {"swingBars": 2, "days": 90, "cooldownMinutes": 20,
                                                            "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}},
                                                "ARBUSDT": {}}}), encoding="utf-8")
    w = swing_watch.SwingWatch(TMP / "cfg1", TMP / "dibujos", watchlist_config=wl)
    cfg = w.config
    check("la primera vez toma monedas, marco y reglas de la Watchlist", cfg["source"] == "watchlist" and cfg["interval"] == "1"
          and cfg["symbols"] == ["BTCUSDT", "ETHUSDT", "ARBUSDT"] and cfg["enabled"] is True)
    check("reglas por moneda de la Watchlist (sin dias ni cooldown)", w.rules_for("BTCUSDT")["swingBars"] == 2
          and w.rules_for("BTCUSDT")["volumeFilter"]["lookbackBars"] == 50 and w.rules_for("ETHUSDT")["swingBars"] == 3
          and "days" not in json.dumps(cfg["symbolRules"]) and "ARBUSDT" not in cfg["symbolRules"])
    check("no guarda la direccion de alertas de la Watchlist", "alertTargetUrl" not in json.dumps(cfg) and "5000" not in json.dumps(cfg))
    check("la configuracion queda guardada", (TMP / "cfg1" / "config.json").exists())
    w_missing = swing_watch.SwingWatch(TMP / "cfg2", TMP / "dibujos", watchlist_config=TMP / "no_existe.json")
    check("sin el archivo de la Watchlist usa su configuracion del 12/11", w_missing.config["source"] == "watchlist_12_11"
          and w_missing.config["interval"] == "1" and len(w_missing.config["symbols"]) == 11
          and w_missing.rules_for("ARBUSDT")["swingBars"] == 3 and w_missing.rules_for("ETHUSDT")["vwapFilter"]["deviations"] == [2, 3])
    bad_bodies = [({"rules": {"swingBars": 0}}, "swingBars 0"), ({"rules": {"direction": "UP"}}, "direccion"),
                  ({"rules": {"vwapFilter": {"deviations": [7]}}}, "banda 7"), ({"symbols": ["btc"]}, "moneda"),
                  ({"symbols": []}, "sin monedas"), ({"interval": "3"}, "marco 3"), ({"enviar": True}, "campo desconocido"),
                  ({"symbolRules": {"BTCUSDT": {"days": 3}}}, "dias por moneda"), ({"vwap": {"vwapType": "anchored"}}, "anclado sin hora"),
                  ({"rules": {"volumeFilter": {"minZScore": "1"}}}, "z como texto"), ({"enabled": "si"}, "enabled texto"),
                  ({"rules": {"priceZones": [{"id": "z", "min": 5, "max": 1}]}}, "zona al reves")]
    before = json.dumps(w.config, sort_keys=True)
    for body, name in bad_bodies:
        try:
            w.set_config(body)
            check(f"configuracion rechazada: {name}", False)
        except ValueError:
            check(f"configuracion rechazada: {name}", True)
    check("una configuracion rechazada no cambia nada", json.dumps(w.config, sort_keys=True) == before)
    w.set_config({"symbolRules": {"BTCUSDT": None, "ETHUSDT": {"volumeFilter": {"minZScore": 2}}}, "interval": "15m"})
    check("ajustes por moneda: null los quita y un campo suelto se suma a las reglas generales",
          "BTCUSDT" not in w.config["symbolRules"] and w.rules_for("ETHUSDT")["volumeFilter"] == {"enabled": False, "minZScore": 2.0, "lookbackBars": 10}
          and w.config["interval"] == "15")
    reread = swing_watch.SwingWatch(TMP / "cfg1", TMP / "dibujos", watchlist_config=wl)
    check("el cambio queda guardado", reread.config["interval"] == "15" and reread.rules_for("ETHUSDT")["volumeFilter"]["minZScore"] == 2.0)
    broken = TMP / "cfg3"
    broken.mkdir()
    (broken / "config.json").write_text("{esto no es json", encoding="utf-8")
    wb = swing_watch.SwingWatch(broken, TMP / "dibujos", watchlist_config=wl)
    check("configuracion danada: no detecta y no pisa el archivo", wb.config["enabled"] is False and wb.config_error
          and (broken / "config.json").read_text(encoding="utf-8") == "{esto no es json")
    wb.set_config({"enabled": True})
    copies = list(broken.glob("config.danado-*.json"))
    check("al guardar otra, la danada queda copiada aparte", len(copies) == 1 and copies[0].read_text(encoding="utf-8") == "{esto no es json"
          and json.loads((broken / "config.json").read_text(encoding="utf-8"))["enabled"] is True)

    # ---------- 5. Deteccion al cierre ----------
    SERIES = make_candles(1200, MIN, T15 - 1200 * MIN, 81_500.0, 0.1, 21)
    clock = {"now": 0}
    calls = {"recent": 0, "chart": 0, "fail": 0}

    def visible(rows):
        """Lo que daria Bybit a esta hora: las velas abiertas hasta ahora, la ultima en curso y con otros valores."""
        out = [dict(c) for c in rows if c["timestamp"] <= clock["now"]]
        if out and out[-1]["timestamp"] + MIN > clock["now"]:
            out[-1]["high"] = out[-1]["high"] * 1.05
            out[-1]["low"] = out[-1]["low"] * 0.95
        return out

    async def fake_recent(symbol, interval, limit):
        calls["recent"] += 1
        if calls["fail"]:
            calls["fail"] -= 1
            raise RuntimeError("Bybit no respondio")
        return visible(SERIES)[-limit:]

    async def fake_chart(symbol, interval):
        calls["chart"] += 1
        return visible(SERIES)

    wcfg = TMP / "watchlist_btc.json"
    wcfg.write_text(json.dumps({"interval": "1", "symbols": ["BTCUSDT"], "swingBars": 2,
                                "volumeFilter": {"enabled": False, "minZScore": 1.5, "lookbackBars": 50}}), encoding="utf-8")
    start = SERIES[300]["timestamp"] + 4000
    clock["now"] = start
    live = swing_watch.SwingWatch(TMP / "vivo", TMP / "dibujos", fetch_recent=fake_recent, fetch_chart=fake_chart,
                                  now=lambda: clock["now"], watchlist_config=wcfg)

    async def advance(watch, minutes):
        for _ in range(minutes):
            clock["now"] += MIN
            await watch.check_symbol("BTCUSDT")

    asyncio.run(live.check_symbol("BTCUSDT"))
    asyncio.run(advance(live, 200))
    rules = live.rules_for("BTCUSDT")
    end_close = (clock["now"] - 4000) // MIN * MIN   # cierre de la ultima vela cerrada
    expected = [(s["type"], s["timestamp"]) for s in swing_rules.detect([c for c in SERIES if c["timestamp"] + MIN <= clock["now"]], rules, "BTCUSDT")
                if start < swing_rules.known_at(s["timestamp"], 2, "1") <= end_close]
    logged = [(e["type"], e["timestamp"]) for e in sorted(live.log(limit=5000), key=lambda e: e["known_at"])]
    check("anota cada swing confirmado desde que arranco, una vez y en orden", logged == expected and len(expected) > 20,
          f"{len(logged)} anotadas, {len(expected)} esperadas")
    check("cada senal se anota al revisar el cierre que la confirma (4 s despues)", all(e["delay_ms"] == 4000 for e in live.log(limit=5000)))
    check("la vela en curso no cuenta", all(e["price"] in {c["high"] for c in SERIES} | {c["low"] for c in SERIES} for e in live.log(limit=5000)))
    day_files = list((TMP / "vivo" / "signals").glob("*.jsonl"))
    check("el registro queda en archivos por dia", day_files and sum(len(p.read_text().splitlines()) for p in day_files) == len(expected))
    st = live.status()
    check("estado: no envia, reglas de App 1, conteo por moneda", st["sends"] is False and st["rules"] == "app1"
          and st["by_symbol"]["BTCUSDT"]["signals"] == len(expected) and st["by_symbol"]["BTCUSDT"]["error"] is None)

    # Un reinicio no repite lo anotado
    again = swing_watch.SwingWatch(TMP / "vivo", TMP / "dibujos", fetch_recent=fake_recent, fetch_chart=fake_chart,
                                   now=lambda: clock["now"], watchlist_config=wcfg)
    check("al reiniciar trae lo anotado", len(again.log(limit=5000)) == len(expected))
    asyncio.run(again.check_symbol("BTCUSDT"))
    check("y no lo vuelve a anotar", len(again.log(limit=5000)) == len(expected))
    asyncio.run(advance(again, 60))
    keys = [(e["type"], e["timestamp"]) for e in again.log(limit=5000)]
    check("despues sigue anotando sin duplicados", len(keys) == len(set(keys)) and len(keys) > len(expected))

    # Bybit falla: no avanza y lo recupera en la siguiente vuelta
    fail_from = clock["now"]
    calls["fail"] = 10
    asyncio.run(advance(again, 10))
    check("con Bybit caido queda el error en el estado", again.status()["by_symbol"]["BTCUSDT"]["error"] is not None)
    asyncio.run(advance(again, 1))
    recovered = clock["now"]
    caught = [s for s in swing_rules.detect([c for c in SERIES if c["timestamp"] + MIN <= recovered], rules, "BTCUSDT")
              if fail_from < swing_rules.known_at(s["timestamp"], 2, "1") <= recovered]
    by_key = {(e["type"], e["timestamp"]): e for e in again.log(limit=5000)}
    check("al volver Bybit anota lo de los minutos caidos, con su demora",
          caught and all((s["type"], s["timestamp"]) in by_key for s in caught)
          and all(by_key[(s["type"], s["timestamp"])]["delay_ms"] == recovered - swing_rules.known_at(s["timestamp"], 2, "1") for s in caught)
          and again.status()["by_symbol"]["BTCUSDT"]["error"] is None, f"{len(caught)} en la caida")

    # Una pausa mas larga que la ventana queda dicha
    clock["now"] += 150 * MIN
    asyncio.run(again.check_symbol("BTCUSDT"))
    missed = again.status()["by_symbol"]["BTCUSDT"]["missed"]
    check("una pausa mas larga que lo que se recupera queda en el estado", missed is not None and missed["to"] > missed["from"])

    # Candado: un solo proceso detecta por carpeta
    a = swing_watch.SwingWatch(TMP / "candado", TMP / "dibujos", watchlist_config=wcfg)
    b = swing_watch.SwingWatch(TMP / "candado", TMP / "dibujos", watchlist_config=wcfg)
    first, second = a._take_lock(), b._take_lock()
    a._release_lock()
    third = b._take_lock()
    b._release_lock()
    check("solo un proceso detecta por carpeta de datos, y el otro toma el relevo", first and not second and third)

    # Filtro VWAP: el VWAP se calcula solo si hay rectangulos en las horas revisadas
    drawings = TMP / "dibujos_vwap"
    drawings.mkdir()
    vw = swing_watch.SwingWatch(TMP / "vwap", drawings, fetch_recent=fake_recent, fetch_chart=fake_chart,
                                now=lambda: clock["now"], watchlist_config=wcfg)
    vw.set_config({"rules": {"vwapFilter": {"enabled": True, "deviations": [1]}}, "symbolRules": {"BTCUSDT": None}})
    calls["chart"] = 0
    asyncio.run(vw.chart_signals("BTCUSDT", "1"))
    check("sin rectangulos no calcula el VWAP", calls["chart"] == 1)
    rows_now = [c for c in visible(SERIES) if c["timestamp"] + MIN <= clock["now"]]
    plain = swing_rules.detect(rows_now, vw.rules_for("BTCUSDT"), "BTCUSDT")
    picks = plain[-30::6]
    rects = [{"type": "rectangle", "id": f"r{k}", "price1": s["price"] * 1.002, "time1": s["timestamp"] - 5 * MIN,
              "price2": s["price"] * 0.998, "time2": s["timestamp"] + 5 * MIN} for k, s in enumerate(picks)]
    (drawings / "BTCUSDT.json").write_text(json.dumps({"symbol": "BTCUSDT", "shapes": rects}), encoding="utf-8")
    calls["chart"] = 0
    body = asyncio.run(vw.chart_signals("BTCUSDT", "1"))
    points = swing_watch.vwap_points(visible(SERIES), vw.config["vwap"])
    expected_vwap = swing_rules.detect(rows_now, vw.rules_for("BTCUSDT"), "BTCUSDT", points, swing_rules.rectangle_zones(rects))
    check("con rectangulos usa el VWAP de las velas del grafico y da lo mismo que la regla",
          body["vwap_used"] and calls["chart"] == 2 and [s["timestamp"] for s in body["signals"]] == [s["timestamp"] for s in expected_vwap])
    vw.set_profile_rects("BTCUSDT", ["r0", "r1", "r2", "r3", "r4"])
    body2 = asyncio.run(vw.chart_signals("BTCUSDT", "1"))
    check("los rectangulos de un VP Fixed no cuentan", len(body2["signals"]) >= len(body["signals"])
          and vw.config["profileRectIds"]["BTCUSDT"] == ["r0", "r1", "r2", "r3", "r4"])
    (drawings / "BTCUSDT.json").write_text("{roto", encoding="utf-8")
    try:
        asyncio.run(vw.chart_signals("BTCUSDT", "1"))
        check("dibujos ilegibles: error, no senales sin filtro", False)
    except ValueError:
        check("dibujos ilegibles: error, no senales sin filtro", True)

    # ---------- 6. Rutas ----------
    bot_calls = []

    async def no_bot(*args, **kwargs):
        bot_calls.append(args)
        raise AssertionError("el Swing no debe llamar al bot")

    main._bot = no_bot
    main.SWING._fetch_chart = fake_chart
    main.SWING._fetch_recent = fake_recent
    main.SWING._now = lambda: clock["now"]
    client = TestClient(main.app, base_url="http://127.0.0.1")
    r = client.get("/api/swing/status")
    check("GET /api/swing/status", r.status_code == 200 and r.json()["sends"] is False and r.json()["detecting"] is False)
    r = client.get("/api/swing/config")
    check("GET /api/swing/config con las reglas de cada moneda", r.status_code == 200
          and set(r.json()["effective"]) == set(r.json()["config"]["symbols"]))
    r = client.post("/api/swing/config", json={"rules": {"swingBars": 99}})
    check("POST /api/swing/config rechaza un valor fuera de rango", r.status_code == 400 and "swingBars" in r.json()["detail"])
    r = client.post("/api/swing/config", content=b"{no json", headers={"Content-Type": "application/json"})
    check("POST /api/swing/config rechaza un cuerpo que no es JSON", r.status_code == 400)
    r = client.post("/api/swing/config", json={"symbols": ["BTCUSDT", "ETHUSDT"], "interval": "1",
                                               "symbolRules": {"BTCUSDT": {"swingBars": 2}}})
    saved = json.loads((Path(os.environ["SUITE_DATA_DIR"]) / "swing" / "config.json").read_text(encoding="utf-8"))
    check("POST /api/swing/config guarda", r.status_code == 200 and saved["symbols"] == ["BTCUSDT", "ETHUSDT"]
          and saved["symbolRules"]["BTCUSDT"] == {"swingBars": 2})
    r = client.get("/api/swing/signals/BTCUSDT", params={"interval": "1m"})
    expected_route = swing_rules.detect(rows_now, main.SWING.rules_for("BTCUSDT"), "BTCUSDT")
    check("GET /api/swing/signals da las senales de la regla con su hora de confirmacion", r.status_code == 200
          and [s["timestamp"] for s in r.json()["signals"]] == [s["timestamp"] for s in expected_route]
          and all(s["known_at"] == s["timestamp"] + 3 * MIN for s in r.json()["signals"]) and r.json()["detected_live"] is True)
    check("GET /api/swing/signals de otro marco no es deteccion en vivo",
          client.get("/api/swing/signals/BTCUSDT", params={"interval": "15"}).json()["detected_live"] is False)
    check("GET /api/swing/signals con marco invalido: 400", client.get("/api/swing/signals/BTCUSDT", params={"interval": "7"}).status_code == 400)
    check("GET /api/swing/signals con moneda invalida: 400", client.get("/api/swing/signals/btc-usdt").status_code == 400)
    asyncio.run(main.SWING.check_symbol("BTCUSDT"))
    asyncio.run(advance(main.SWING, 30))
    r = client.get("/api/swing/log", params={"symbol": "BTCUSDT", "limit": 5})
    check("GET /api/swing/log, las mas nuevas primero", r.status_code == 200 and 0 < r.json()["count"] <= 5
          and r.json()["signals"] == sorted(r.json()["signals"], key=lambda e: e["known_at"], reverse=True))
    check("GET /api/swing/log con dia invalido: 400", client.get("/api/swing/log", params={"day": "ayer"}).status_code == 400)
    r = client.post("/api/swing/profile-rects/BTCUSDT", json={"ids": ["rectangle_1"]})
    check("POST /api/swing/profile-rects", r.status_code == 200 and main.SWING.config["profileRectIds"]["BTCUSDT"] == ["rectangle_1"])
    check("POST /api/swing/profile-rects sin lista: 400", client.post("/api/swing/profile-rects/BTCUSDT", json={"ids": "x"}).status_code == 400)
    check("las rutas rechazan otra pagina web", client.get("/api/swing/status", headers={"Origin": "http://otra.com"}).status_code == 403)
    check("el estado breve del Swing para la barra de la suite", set(main.SWING.brief()) >= {"detecting", "interval", "today", "errors"})
    check("el Swing nunca llamo al bot", not bot_calls)
    text = (HERE.parent / "swing_watch.py").read_text(encoding="utf-8") + (HERE.parent / "swing_rules.py").read_text(encoding="utf-8")
    check("el codigo del Swing no tiene a donde enviar", not any(word in text for word in ("bot_url", "watchlist-alert", "/api/alert", "_bot(")))
    path = Path(swing_watch._vwap_module.__file__).resolve()
    check("el VWAP es el de App 1, no el del backend de Order Flow", path == (Path(CONFIG["app1_backend"]) / "vwap_calculator.py").resolve())
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok}/{len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
