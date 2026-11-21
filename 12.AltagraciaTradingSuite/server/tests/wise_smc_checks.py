# Pruebas sin conexion de los sabios de Williams y la estructura SMC del servidor (20/11/2026):
#   - detect() da lo mismo que williams.events() y smc.events() de App 1, y la ruptura de fractal se sabe al pasarlo;
#   - lo que se sabe hasta una vela no cambia con velas posteriores;
#   - la deteccion al cierre anota cada senal una vez, solo lo que se supo desde que arranco, y no repite al reiniciar;
#   - la configuracion se valida, "all" son las monedas de la suite y un archivo danado no se pisa;
#   - las rutas responden y nada se envia al bot.
# Bybit y el bot nunca se consultan. Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\wise_smc_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_wsmc_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"   # tambien apaga los sabios y la estructura SMC (SUITE_WSMC sigue a SUITE_SWING)
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import smc  # noqa: E402
import williams  # noqa: E402
import wise_smc_watch as ws  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


H4 = 14_400_000
START = 1_767_225_600_000   # 2026-01-01 00:00 UTC


def make_candles(count, seed=7, start=START, price=50_000.0):
    """Velas de 4 horas con tramos: suben y bajan por rachas, asi hay estructura, order blocks y sabios."""
    rng = np.random.default_rng(seed)
    rows, close, drift = [], price, 0.0
    for i in range(count):
        if i % 60 == 0:
            drift = rng.normal(0, 0.004)
        o = close
        c = o * (1 + drift + rng.normal(0, 0.012))
        hi = max(o, c) * (1 + abs(rng.normal(0, 0.006)))
        lo = min(o, c) * (1 - abs(rng.normal(0, 0.006)))
        rows.append({"timestamp": start + i * H4, "open": round(o, 1), "high": round(hi, 1), "low": round(lo, 1),
                     "close": round(c, 1), "volume": round(float(rng.lognormal(3, 0.6)), 3)})
        close = c
    return rows


def bars_of(rows):
    return [{"t": r["timestamp"], "o": r["open"], "h": r["high"], "l": r["low"], "c": r["close"]} for r in rows]


def ident(e):
    return (e["code"], e["dir"], e["t"], (e.get("info") or {}).get("scope", ""))


CFG = json.loads(json.dumps(ws.DEFAULT_CONFIG))
ROWS = make_candles(1200)

try:
    # --- detect() contra App 1 ---
    found = ws.detect(ROWS, "240", CFG)
    bars = bars_of(ROWS)
    wise = williams.events(bars, 240, CFG["wise"], ("WD", "WA", "WF"))
    struct = smc.events(bars, 240, {**CFG["smc"], "scope": "swing"}) + smc.events(bars, 240, {**CFG["smc"], "scope": "internal"}, ("BS", "OB", "BK"))
    index = {b["t"]: i for i, b in enumerate(bars)}
    expected = set()
    for e in wise:
        if e["code"] == "WF" and index[e["t"]] + e["info"]["expiry"] >= len(bars):
            continue
        expected.add(ident(e))
    expected |= {ident(e) for e in struct}
    codes = {e["code"] for e in found}
    check("detect() da lo mismo que los eventos de App 1", {ident(e) for e in found} == expected, f"{len(found)} contra {len(expected)}")
    check("salen las siete senales en 1,200 velas de 4 horas", codes == set(ws.CODES), str(sorted(codes)))
    wf = [e for e in found if e["code"] == "WF"]
    ok_wf = all(e["known_at"] == bars[index[e["t"]] + e["info"]["expiry"]]["t"] + H4 for e in wf)
    check("la ruptura de fractal se sabe al cerrar la vela que lo pasa", wf and ok_wf)
    hit_ok = all(bars[index[e["t"]] + e["info"]["expiry"]]["h" if e["dir"] > 0 else "l"] * e["dir"] >= e["info"]["level"] * e["dir"] for e in wf)
    check("en esa vela el precio pasa el fractal", hit_ok)
    check("las demas se saben al cerrar su vela", all(e["known_at"] == e["t"] + H4 for e in found if e["code"] != "WF"))
    check("las dos estructuras van marcadas", {e["info"]["scope"] for e in found if e["code"] in ("BS", "OB", "BK")} == {"swing", "internal"})
    check("los iguales salen una vez (no dependen de la estructura)",
          len([e for e in found if e["code"] == "EQ"]) == len([e for e in struct if e["code"] == "EQ"]))

    # --- sin futuro: lo sabido hasta una vela no cambia con las siguientes ---
    stable = True
    for k in (700, 850, 1000, 1150):
        cut = ROWS[k - 1]["timestamp"] + H4
        early = {ident(e) for e in ws.detect(ROWS[:k], "240", CFG) if e["known_at"] <= cut}
        late = {ident(e) for e in found if e["known_at"] <= cut}
        if early != late:
            stable = False
    check("lo que se sabe hasta una vela es lo mismo con mas velas", stable)
    check("menos de 60 velas no da nada", ws.detect(ROWS[:50], "240", CFG) == [])

    # --- textos ---
    texts = {e["code"]: ws.describe(e) for e in found}
    check("cada senal dice que es", all(texts[c] for c in ws.CODES) and "stop en" in texts["WD"] and " a " in texts["OB"])
    check("precios con los decimales de su tamano", ws._price(65432.12) == "65,432.1" and ws._price(2.34567) == "2.346"
          and ws._price(0.00012346) == "0.0001235")

    # --- deteccion al cierre ---
    clock = {"now": ROWS[900]["timestamp"] + 10_000}

    async def fetch(symbol, interval, limit):
        rows = [r for r in ROWS if r["timestamp"] <= clock["now"]]
        return rows[-limit:]

    folder = TMP / "wsmc"
    live = ws.WiseSmcWatch(folder, symbols_source=lambda: ["BTCUSDT"], fetch_recent=fetch, now=lambda: clock["now"])
    start_cut = live._since
    for i in range(901, 1100):
        clock["now"] = ROWS[i]["timestamp"] + 4_000    # 4 s despues del cierre de la vela i-1
        asyncio.run(live.check_symbol("BTCUSDT"))
    last_close = ROWS[1099]["timestamp"]
    # Lo esperado: lo de la ventana de 1,000 velas de cada revision, sabido entre el arranque y la ultima revision
    wanted = set()
    for i in range(901, 1100):
        window = ROWS[max(0, i + 1 - ws.CANDLES):i]   # las 1,000 que da Bybit, con la vela en curso, menos esa
        newest = ROWS[i - 1]["timestamp"] + H4
        prev = ROWS[i - 2]["timestamp"] + H4 if i > 901 else start_cut
        wanted |= {ident(e) for e in ws.detect(window, "240", CFG) if prev < e["known_at"] <= newest}
    logged = live.log(limit=5000)
    check("anota lo que se supo desde el arranque, una vez", {ident(e) for e in logged} == wanted and len(logged) == len(wanted),
          f"{len(logged)} anotadas contra {len(wanted)}")
    check("nada anterior al arranque", all(e["known_at"] > start_cut for e in logged))
    check("cada linea trae su texto, su demora y su zona", all(e["text"] and e["delay_ms"] == 4_000 and e["lo"] <= e["hi"] for e in logged))
    lines = sum(len(p.read_text(encoding="utf-8").splitlines()) for p in (folder / "signals").glob("*.jsonl"))
    check("queda en data/wsmc/signals, una linea por senal", lines == len(logged))
    st = live.status()
    check("el estado dice que no envia nada", st["sends"] is False and st["by_symbol"]["BTCUSDT"]["signals"] == len(logged))
    # Reiniciado (otro proceso con la misma carpeta, desde antes): no repite lo anotado
    clock["now"] = ROWS[1093]["timestamp"]   # arranco un dia antes de la ultima revision: lee los dos ultimos dias
    again = ws.WiseSmcWatch(folder, symbols_source=lambda: ["BTCUSDT"], fetch_recent=fetch, now=lambda: clock["now"])
    for i in range(1094, 1100):
        clock["now"] = ROWS[i]["timestamp"] + 4_000
        asyncio.run(again.check_symbol("BTCUSDT"))
    lines_again = sum(len(p.read_text(encoding="utf-8").splitlines()) for p in (folder / "signals").glob("*.jsonl"))
    check("al reiniciar no repite lo anotado", lines_again == lines)
    # Una pausa del PC: al volver anota lo que se supo mientras tanto, con su demora
    clock["now"] = ROWS[1100]["timestamp"] + 4_000
    paused = ws.WiseSmcWatch(TMP / "wsmc_pausa", symbols_source=lambda: ["BTCUSDT"], fetch_recent=fetch, now=lambda: clock["now"])
    asyncio.run(paused.check_symbol("BTCUSDT"))
    clock["now"] = ROWS[1130]["timestamp"] + 4_000      # 30 velas sin revisar
    asyncio.run(paused.check_symbol("BTCUSDT"))
    late = paused.log(limit=5000)
    gap_wanted = {ident(e) for e in ws.detect(ROWS[1131 - ws.CANDLES:1130], "240", CFG)
                  if ROWS[1099]["timestamp"] + H4 < e["known_at"] <= ROWS[1129]["timestamp"] + H4}
    check("tras una pausa anota lo que se supo en ella, con su demora", {ident(e) for e in late} == gap_wanted and
          all(e["delay_ms"] >= 4_000 for e in late))

    # Una moneda nueva despues de la primera vuelta anota desde ahora; un marco que se deja y se retoma, tambien
    coins = ["BTCUSDT"]
    later = ws.WiseSmcWatch(TMP / "wsmc_nueva", symbols_source=lambda: list(coins), fetch_recent=fetch, now=lambda: clock["now"])
    clock["now"] = ROWS[1000]["timestamp"] - 30 * H4 + 4_000
    later._since = clock["now"]
    asyncio.run(later.check_all())
    coins.append("ETHUSDT")
    clock["now"] = ROWS[1000]["timestamp"] + 4_000
    asyncio.run(later.check_all())
    eth = later.log("ETHUSDT", 5000)
    before = [e for e in ws.detect(ROWS[1001 - ws.CANDLES:1000], "240", CFG) if later._since < e["known_at"] <= ROWS[1000]["timestamp"]]
    check("una moneda agregada a la suite no anota lo de antes", len(before) > 0 and eth == [], f"{len(before)} de antes, {len(eth)} anotadas")
    clock["now"] = ROWS[1040]["timestamp"] + 4_000
    asyncio.run(later.check_all())
    eth = later.log("ETHUSDT", 5000)
    check("y desde ahi anota como las demas", len(eth) > 0 and all(ROWS[1000]["timestamp"] < e["known_at"] <= ROWS[1040]["timestamp"] for e in eth))
    later.set_config({"interval": "1h"})
    later.set_config({"interval": "4h"})
    check("un marco retomado empieza de nuevo", later._state == {})
    (TMP / "danada2").mkdir()
    (TMP / "danada2" / "config.json").write_text("{ roto", encoding="utf-8")
    fixed = ws.WiseSmcWatch(TMP / "danada2", fetch_recent=fetch)
    fixed.set_config({"enabled": True})
    copies = list((TMP / "danada2").glob("config.danado-*.json"))
    check("al guardar, el archivo danado queda copiado aparte", len(copies) == 1 and copies[0].read_text(encoding="utf-8") == "{ roto"
          and fixed.config_error is None)

    # --- configuracion ---
    cfg = ws.clean_config({"interval": "1h", "codes": ["OB", "WD"], "symbols": ["ETHUSDT", "ETHUSDT", "BTCUSDT"]}, CFG)
    check("la configuracion se limpia", cfg["interval"] == "60" and cfg["codes"] == ["WD", "OB"] and cfg["symbols"] == ["ETHUSDT", "BTCUSDT"])
    bad = []
    for body in ({"interval": "3m"}, {"codes": ["XX"]}, {"symbols": ["btc"]}, {"smc": {"internal": 60}}, {"wise": {"angBars": 0}},
                 {"enabled": "si"}, {"smc": {"pick": "otra"}}):
        try:
            ws.clean_config(body, CFG)
        except ValueError:
            bad.append(True)
    check("un valor invalido no pasa", len(bad) == 7)
    check('"all" son las monedas de la suite', live.symbols() == ["BTCUSDT"])
    (TMP / "danada").mkdir()
    (TMP / "danada" / "config.json").write_text("{ esto no es json", encoding="utf-8")
    broken = ws.WiseSmcWatch(TMP / "danada", fetch_recent=fetch)
    check("un archivo danado no se pisa y no detecta", broken.config["enabled"] is False and broken.config_error
          and (TMP / "danada" / "config.json").read_text(encoding="utf-8") == "{ esto no es json")

    # --- medidas del journal ---
    import journal_measures  # noqa: E402
    import wise_smc_measures as wm  # noqa: E402
    f4 = {"ts": np.array([r["timestamp"] for r in ROWS], dtype=np.int64),
          **{k: np.array([r[k] for r in ROWS], dtype=float) for k in ("open", "high", "low", "close", "volume")}}
    at = ROWS[1000]["timestamp"] + 7_200_000          # a mitad de la vela 1000: la ultima cerrada es la 999
    full = wm.frame_measures(f4, "4h", at, 1, None)
    cut = {k: v[:1000] for k, v in f4.items()}
    check("las medidas usan solo velas cerradas antes de decidir", wm.frame_measures(cut, "4h", at, 1, None) == full)
    s4 = williams.compute(f4["high"][:1000].tolist(), f4["low"][:1000].tolist(), f4["close"][:1000].tolist())
    r4 = smc.compute(*(f4[k][:1000].tolist() for k in ("open", "high", "low", "close")), {"internal": 5, "swing": 50})
    check("Alligator, zona y estructura desde el lado del trade", full["bw_alligator_4h"] == s4["state"][999]
          and wm.frame_measures(f4, "4h", at, -1, None)["bw_alligator_4h"] == -s4["state"][999]
          and full["smc_bias_4h"] == r4["bias"][999])
    short = wm.frame_measures(f4, "4h", at, -1, None)
    check("el lugar en el rango se lee desde el lado del trade", full["smc_place_4h"] is not None
          and abs(full["smc_place_4h"] + short["smc_place_4h"] - 1) < 0.002)
    dists = [wm.frame_measures(f4, "4h", ROWS[i]["timestamp"] + H4, sd, None)["smc_ob_atr_4h"] for i in range(400, 1200, 40) for sd in (1, -1)]
    check("la distancia al order block es positiva o cero, o vacia sin ninguno", all(d is None or d >= 0 for d in dists)
          and any(d is not None for d in dists))
    check("con pocas velas, vacias", all(v is None for v in wm.frame_measures(f4, "4h", ROWS[30]["timestamp"], 1, None).values()))
    keys = {item["key"] for item in journal_measures.catalog() if item["group"] == "Williams y SMC"}
    check("doce medidas en el grupo Williams y SMC del journal", len(keys) == 12 and keys == {k for k, _ in wm.CATALOG})
    check("el journal vuelve a calcular las guardadas", journal_measures.MEASURES_VERSION == 3)

    # --- rutas ---
    with TestClient(main.app, base_url="http://127.0.0.1:13000") as client:   # con el arranque (y el cliente de Bybit) de main
        status = client.get("/api/wsmc/status").json()
        check("/api/wsmc/status responde sin detectar en las pruebas", status["success"] and status["sends"] is False and status["env_off"] is True
              and status["detecting"] is False)
        conf = client.get("/api/wsmc/config").json()
        check("/api/wsmc/config da la configuracion y los nombres", conf["config"]["interval"] == "240" and conf["codes"]["OB"] == "Order block")
        r = client.post("/api/wsmc/config", json={"interval": "3m"})
        check("un cambio invalido responde 400 y nada cambia", r.status_code == 400 and main.WSMC.config["interval"] == "240")
        r = client.post("/api/wsmc/config", json={"interval": "1h", "enabled": False})
        saved = json.loads((Path(os.environ["SUITE_DATA_DIR"]) / "wsmc" / "config.json").read_text(encoding="utf-8"))
        check("un cambio valido se guarda", r.status_code == 200 and saved["interval"] == "60" and saved["enabled"] is False)
        check("/api/wsmc/log responde", client.get("/api/wsmc/log?limit=5").json()["success"])
        check("una moneda invalida en el registro: 400", client.get("/api/wsmc/log?symbol=btc").status_code == 400)
        check("/api/suite/status trae los sabios y la estructura", "wsmc" in client.get("/api/suite/status").json())
finally:
    shutil.rmtree(TMP, ignore_errors=True)

ok = sum(1 for _, passed in results if passed)
print(f"\n{ok}/{len(results)} pruebas pasan")
sys.exit(0 if ok == len(results) else 1)
