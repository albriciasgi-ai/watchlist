# Pruebas sin conexion de las reglas en vivo (24/11/2026): Impulso, FVG nuevo y B1 del probador de App 1.
#   - el registro hecho vela a vela da los mismos trades que una corrida del probador sobre las mismas velas, desde since,
#     con cualquier ritmo de revisiones (tambien si la suite estuvo cerrada varias velas);
#   - al reiniciar no repite nada, y cada orden pasa por sus pasos en orden;
#   - la vela en curso no cuenta, y un hueco entre lo visto y lo que da Bybit queda como error sin anotar nada;
#   - B1 espera el OI o el funding de la vela sin frenar a las otras reglas, y no pide el dato mas de una vez cada 10 min;
#   - lo anotado como final no se reescribe: una diferencia queda como revision, una sola vez;
#   - el margen por semanas, las lecturas a los 3, 6 y 12 meses, la configuracion y las rutas; nada se envia.
# Bybit, el bot y los archivos de OI y funding reales nunca se consultan. Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\rule_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_rules_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"   # tambien apaga las reglas (SUITE_RULES sigue a SUITE_SWING)
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import rule_watch as rw  # noqa: E402
import rule_tester as rt  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


H4 = rw.STEP
T0 = 1_767_225_600_000          # 2026-01-01 00:00 UTC
WARM = 300                      # velas antes de que arranque el registro
LIVE = 240                      # velas registradas en vivo (40 dias)
SINCE = T0 + WARM * H4
END = SINCE + LIVE * H4
SYM = "TESTUSDT"


def make_bars(n=WARM + LIVE + 1, seed=7, price=100.0):
    """Velas de 4 horas con tramos y algunas velas grandes: dan impulsos y FVG."""
    rng = np.random.default_rng(seed)
    bars, c, drift = [], price, 0.0
    for i in range(n):
        if i % 18 == 0:
            drift = rng.normal(0, 0.006)
        o = c
        c = o * (1 + drift + rng.normal(0, 0.012) * (3 if rng.random() < 0.12 else 1))
        h = max(o, c) * (1 + abs(rng.normal(0, 0.003)))
        lo = min(o, c) * (1 - abs(rng.normal(0, 0.003)))
        bars.append(dict(t=T0 + i * H4, o=round(o, 6), h=round(h, 6), l=round(lo, 6), c=round(c, 6), delta=0.0,
                         vol=round(float(rng.lognormal(6, 0.6)), 3)))
    return bars


BARS = make_bars()


class Feed:
    """Bybit de mentira: las ultimas velas hasta la hora del reloj, con la vela en curso al final."""

    def __init__(self, bars):
        self.bars, self.now, self.calls, self.drop = bars, SINCE, 0, None

    async def recent(self, symbol, interval, limit):
        self.calls += 1
        rows = [b for b in self.bars if b["t"] <= self.now and b["t"] != self.drop][-limit:]
        return [dict(timestamp=b["t"], open=b["o"], high=b["h"], low=b["l"], close=b["c"], volume=b["vol"]) for b in rows]


def watch(folder, feed, ready=None, refresh=None, records=None):
    return rw.RuleWatch(folder, symbols_source=lambda: [SYM], fetch_recent=feed.recent, refresh=refresh or (lambda s: None),
                        ready=ready or (lambda s, b: True), now=lambda: feed.now, records=records)


def walk(w, feed, stops):
    for now in stops:
        feed.now = now
        asyncio.run(w.check_symbol(SYM, now))


def expected(record, until=END):
    """La corrida del probador sobre las mismas velas, desde since."""
    bars = [b for b in BARS if b["t"] + H4 <= until]
    trace = {}
    res = rt.run(SYM, rt.clean_rule(rw.RECORDS[record]["rule"]), {"bars": bars, "events": []},
                 {"phase": 0, "from": rw._iso(bars[0]["t"]), "to": rw._iso(until - 1)}, None, base=False, trace=trace,
                 since=SINCE, minutes=lambda *a, **k: None)
    return res


def closed(w, record):
    return {(o["armed_at"], o["dir"]): o["r"] for o in w.orders(record, SYM) if o["status"] == "cerrada"}


def log_lines(folder):
    return [json.loads(x) for p in sorted((Path(folder) / "log").glob("*.jsonl")) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]


try:
    # --- 1. vela a vela = el probador ---
    f1, feed = TMP / "a", Feed(BARS)
    w = watch(f1, feed)
    walk(w, feed, [SINCE + 60_000 + k * H4 for k in range(LIVE + 1)])
    st = w._state[SYM]
    check("el registro corre sin errores", st["error"] is None and st["errors"] == 0, st.get("error"))
    check("arranca en el cierre de la ultima vela cerrada", w.since() == SINCE, w.since())
    total = 0
    for record in ("impulso", "fvg", "b1"):
        res = expected(record)
        want = {(t["known"], t["dir"]): t["r"] for t in res["trades"]}
        got = closed(w, record)
        total += len(want)
        check(f"{record}: los trades cerrados son los del probador ({len(want)})", got == want, f"{len(got)} contra {len(want)}")
        want_open = {(t["known"], t["dir"]) for t in res.get("openTrades") or []}
        got_open = {(o["armed_at"], o["dir"]) for o in w.orders(record, SYM) if o["status"] == "abierta"}
        check(f"{record}: las abiertas son las del probador", got_open == want_open, f"{got_open} contra {want_open}")
    check("las velas de prueba dan trades de Impulso y de FVG", len(closed(w, "impulso")) >= 5 and len(closed(w, "fvg")) >= 5,
          f"{len(closed(w, 'impulso'))} y {len(closed(w, 'fvg'))}")
    check("ninguna senal anterior al arranque", all(o["armed_at"] > SINCE for o in w.orders()))
    events = log_lines(f1)
    check("ninguna revision ni anulada", not [e for e in events if e["type"] in ("revision", "anulada")])
    by_key = {}
    for e in events:
        by_key.setdefault((e["record"], e["key"]), []).append(e["type"])
    order_ok = all(seq[0] == "senal" and seq in (["senal"], ["senal", "entrada"], ["senal", "entrada", "salida"], ["senal", "no entra"],
                                                 ["senal", "no se opera"]) for seq in by_key.values())
    check("cada orden pasa por sus pasos en orden y una vez", order_ok, [s for s in by_key.values()][:3])
    check("la entrada se anota en la vela siguiente a la senal",
          all(o["entry_t"] == o["armed_at"] for o in w.orders() if o.get("entry_t")))

    # --- 2. otro ritmo: la suite cerrada varias velas ---
    f2, feed2 = TMP / "b", Feed(BARS)
    w2 = watch(f2, feed2)
    stops = [SINCE + 60_000] + [SINCE + 60_000 + k * H4 for k in (1, 2, 9, 10, 55, 56, 130, 200, LIVE)]
    walk(w2, feed2, stops)
    check("con la suite cerrada varias velas, el registro queda igual",
          all(closed(w2, r) == closed(w, r) for r in rw.RECORDS) and w2._state[SYM]["error"] is None)

    # --- 3. reiniciar no repite ---
    before = len(log_lines(f1))
    w3 = watch(f1, feed)
    walk(w3, feed, [feed.now, feed.now + 1000])
    check("al reiniciar no anota nada nuevo", len(log_lines(f1)) == before, f"{len(log_lines(f1))} contra {before}")
    check("al reiniciar lee lo anotado", closed(w3, "impulso") == closed(w, "impulso") and w3.since() == SINCE)
    calls = feed.calls
    check("la misma vela no se evalua dos veces", w3._state[SYM]["done"]["impulso"] == END)

    # --- 4. la vela en curso no cuenta; un hueco es un error ---
    f4, feed4 = TMP / "c", Feed(BARS)
    w4 = watch(f4, feed4)
    walk(w4, feed4, [SINCE + 60_000])
    check("la vela en curso no entra a lo visto", w4._span(SYM)["bars"][-1]["t"] == SINCE - H4)
    feed4.drop = SINCE + H4
    walk(w4, feed4, [SINCE + 60_000 + 3 * H4])
    check("faltan velas: error y nada anotado mas alla", "faltan velas" in (w4._state[SYM]["error"] or "")
          and w4._span(SYM)["bars"][-1]["t"] == SINCE - H4, w4._state[SYM]["error"])
    feed4.drop = None
    walk(w4, feed4, [SINCE + 60_000 + 3 * H4])
    check("al llegar la vela, sigue", w4._state[SYM]["error"] is None and w4._span(SYM)["bars"][-1]["t"] == SINCE + 2 * H4)

    # --- 5. B1 espera el OI o el funding ---
    f5, feed5 = TMP / "d", Feed(BARS)
    flow = {"ok": False, "refresh": 0}

    def refresh(symbol):
        flow["refresh"] += 1

    w5 = watch(f5, feed5, ready=lambda s, b: flow["ok"], refresh=refresh)
    feed5.now = SINCE + 60_000 + 20 * H4
    behind = asyncio.run(w5.check_symbol(SYM, feed5.now))
    s5 = w5._state[SYM]
    check("sin el dato, B1 espera y las otras se evaluan", behind and s5["waiting"] == ["b1"] and s5["done"].get("impulso") and "b1" not in s5["done"])
    asyncio.run(w5.check_symbol(SYM, feed5.now + 60_000))
    check("el dato no se vuelve a pedir antes de 10 minutos", flow["refresh"] == 1, flow["refresh"])
    asyncio.run(w5.check_symbol(SYM, feed5.now + rw.FLOW_RETRY_MS))
    check("a los 10 minutos se pide otra vez", flow["refresh"] == 2, flow["refresh"])
    flow["ok"] = True
    behind = asyncio.run(w5.check_symbol(SYM, feed5.now + rw.FLOW_RETRY_MS + 1000))
    check("al llegar el dato, B1 se evalua", not behind and w5._state[SYM]["done"].get("b1") == w5._state[SYM]["cut"])

    def boom(symbol):
        raise RuntimeError("sin red")
    w5b = watch(TMP / "e", feed5, ready=lambda s, b: False, refresh=boom)
    behind = asyncio.run(w5b.check_symbol(SYM, feed5.now))
    check("si poner al dia el dato falla, B1 espera sin error", behind and w5b._state[SYM]["error"] is None)

    # --- 6. lo final no se reescribe: una revision, una sola vez ---
    book = w3._book("impulso", SYM)
    victim = next(o for o in book.values() if o["status"] == "cerrada")
    real = victim["r"]
    victim["r"] = round(real + 1.0, 3)
    w3._save_orders("impulso", SYM)
    w6 = watch(f1, feed)
    for k in (1, 2, 3):
        w6._state.pop(SYM, None)
        walk(w6, feed, [feed.now + k])
    revs = [e for e in log_lines(f1) if e["type"] == "revision"]
    kept = w6._book("impulso", SYM)[victim["key"]]
    check("una diferencia con lo anotado queda como revision, una sola vez", len(revs) == 1 and revs[0]["key"] == victim["key"], len(revs))
    check("lo anotado como final se queda", kept["r"] == round(real + 1.0, 3) and revs[0]["now"]["r"] == real)

    # --- 7. margen por semanas y lecturas del plan ---
    week = rw.WEEK
    s = rw.stats([(1.0, week * 10 + 1), (1.0, week * 10 + 2), (-1.0, week * 11 + 1), (-1.0, week * 11 + 2)])
    plain = 1.96 * (np.std([1, 1, -1, -1], ddof=1) / 2)
    check("el margen agrupa por semana (mas ancho que trade a trade)", s["n"] == 4 and s["weeks"] == 2 and s["avgR"] == 0 and s["high"] > plain, s)
    check("sin trades, sin cifras", rw.stats([]) == {"n": 0})
    rep = w.report(now=SINCE + 4 * rw.MONTH)
    marks = rep["records"]["impulso"]["checkpoints"]
    check("a los 4 meses hay una lectura vencida, la de los 3", [m["due"] for m in marks] == [True, False, False] and marks[0]["verdict"] in ("sigue", "descartada"))
    check("la lectura de los 3 meses solo cuenta lo cerrado hasta ahi", marks[0]["stats"]["n"] == len(closed(w, "impulso")))
    rep = w.report(now=SINCE + 13 * rw.MONTH)
    check("a los 12 meses, pasa o no pasa", rep["records"]["fvg"]["checkpoints"][2]["verdict"] in ("pasa", "no pasa") and rep["sends"] is False)
    bad = {"x": {"name": "mala", "rule": dict(rw.RECORDS["impulso"]["rule"], tf=60)}}
    try:
        watch(TMP / "f", feed, records=bad)
        check("una regla que no es de 4 horas no se registra", False)
    except ValueError:
        check("una regla que no es de 4 horas no se registra", True)

    # --- 8. configuracion ---
    f8 = TMP / "g"
    w8 = watch(f8, Feed(BARS))
    check("de fabrica, encendido", w8.config == {"enabled": True})
    for body in ({}, {"enabled": "si"}, {"enabled": True, "rules": {}}, []):
        try:
            w8.set_config(body)
            check(f"configuracion invalida rechazada: {body}", False)
        except ValueError:
            check(f"configuracion invalida rechazada: {body}", True)
    w8.set_config({"enabled": False})
    check("apagar queda guardado", watch(f8, Feed(BARS)).config == {"enabled": False})
    (f8 / "config.json").write_text("{roto", encoding="utf-8")
    w8b = watch(f8, Feed(BARS))
    check("una configuracion ilegible apaga el registro y lo dice", w8b.config == {"enabled": False} and w8b.config_error)
    check("las reglas son las del plan", rw.RECORDS["impulso"]["rule"]["im"] == {"bars": 3, "atr": 2.0}
          and rw.RECORDS["fvg"]["rule"]["fv"] == {"minAtr": 0.3} and rw.RECORDS["b1"]["rule"]["flow"] == {"oi": "noconf", "crowd": "nocon"}
          and all(r["rule"]["tf"] == 240 for r in rw.RECORDS.values()))

    # --- 9. rutas ---
    with TestClient(main.app, base_url="http://127.0.0.1") as client:
        r = client.get("/api/rules/status").json()
        check("estado: no envia y no registra en las pruebas", r["sends"] is False and r["detecting"] is False and r["env_off"] is True
              and set(r["records"]) == {"impulso", "fvg", "b1"})
        r = client.get("/api/rules/config").json()
        check("la ruta de configuracion da las reglas", r["records"]["b1"]["rule"]["exit"]["targetR"] == 2 and r["sends"] is False)
        check("informe", set(client.get("/api/rules/report").json()["records"]) == {"impulso", "fvg", "b1"})
        check("registro vacio", client.get("/api/rules/log").json()["events"] == [])
        check("regla desconocida: 400", client.get("/api/rules/log?record=otra").status_code == 400)
        check("moneda invalida: 400", client.get("/api/rules/log?symbol=btc").status_code == 400)
        check("configuracion invalida: 400", client.post("/api/rules/config", json={"enabled": 1}).status_code == 400)
        check("cuerpo que no es JSON: 400", client.post("/api/rules/config", content=b"{x").status_code == 400)
        ok = client.post("/api/rules/config", json={"enabled": False})
        check("apagar por la ruta", ok.status_code == 200 and ok.json()["config"] == {"enabled": False})
        client.post("/api/rules/config", json={"enabled": True})
        check("el estado de la suite trae las reglas", "rules" in client.get("/api/suite/status").json())
    check("el modulo no tiene con que enviar al bot", "bot" not in Path(rw.__file__).read_text(encoding="utf-8").lower().replace("al bot", ""))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pasan")
sys.exit(1 if failed else 0)
