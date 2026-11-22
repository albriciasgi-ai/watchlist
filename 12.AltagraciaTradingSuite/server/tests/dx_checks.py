# Pruebas sin conexion de DX en vivo (22/11/2026), el registro de la hipotesis de los apilados desplazados:
#   - el registro hecho vela a vela da los mismos trades que una corrida del probador sobre las mismas velas, desde since,
#     con cualquier ritmo de revisiones;
#   - no mira el futuro: lo anotado hasta una hora es lo mismo con o sin las velas posteriores, y lo visto no se recalcula;
#   - al reiniciar no repite nada, y cada orden pasa por sus pasos en orden;
#   - si el almacen va detras, espera la vela que falta;
#   - la ejecucion con la cinta: cuando se lleno la limit, el disparo del stop o del objetivo, el precio de la orden a
#     mercado y el R con la ejecucion medida;
#   - las rutas, la configuracion, las zonas de la defensa y que nada se envia al bot.
# Bybit, el bot y el almacen real nunca se consultan. Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\dx_checks.py
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_dx_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"   # tambien apaga DX (SUITE_DX sigue a SUITE_SWING)
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import book_defense  # noqa: E402
import dx_watch as dx  # noqa: E402
import rule_tester as rt  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


M30 = dx.STEP
DAY = dx.DAY
T0 = 1_767_225_600_000          # 2026-01-01 00:00 UTC
SINCE = T0 + 22 * DAY           # el registro arranca aqui: 22 dias de velas antes (20 de arranque y 2 de margen)
END = SINCE + 5 * DAY
SYM = "TESTUSDT"


def make_data(days=31, seed=11, start=T0, price=100.0):
    """Velas de 30 minutos con tramos y un desequilibrio apilado en el 30% de las velas, como los del almacen."""
    rng = np.random.default_rng(seed)
    bars, events, c, drift = [], [], price, 0.0
    for i in range(days * 48):
        if i % 96 == 0:
            drift = rng.normal(0, 0.0008)
        o = c
        c = o * (1 + drift + rng.normal(0, 0.003))
        h = max(o, c) * (1 + abs(rng.normal(0, 0.0015)))
        lo = min(o, c) * (1 - abs(rng.normal(0, 0.0015)))
        t = start + i * M30
        bars.append(dict(t=t, o=round(o, 6), h=round(h, 6), l=round(lo, 6), c=round(c, 6), delta=0.0,
                         vol=round(float(rng.lognormal(3, 0.5)), 3)))
        if rng.random() < 0.3:
            events.append(dict(code="ST", dir=1 if c >= o else -1, t=t, known=t + M30, lo=round(c * 0.9997, 6), hi=round(c * 1.0003, 6)))
    return bars, events


def fake_detect(data):
    bars, events = data

    def detect(symbol, start, end, known_until):
        return {"bars": [b for b in bars if start <= b["t"] < end and b["t"] + M30 <= known_until],
                "events": [e for e in events if start <= e["t"] < end and e["known"] <= known_until]}
    return detect


def watcher(folder, data, clock, lag=0):
    return dx.DxWatch(folder, TMP / "of", store_until=lambda symbol, now: now - lag, detect=fake_detect(data),
                      minutes=lambda symbol, a, b: None, now=lambda: clock[0], symbols=[SYM])


def run_schedule(folder, data, start, end, every=1, w=None):
    """Una revision cada `every` velas, 75 s despues de cada cierre, desde start; la ultima siempre en end."""
    clock = [start + 75_000]
    w = w or watcher(folder, data, clock)
    w._now = lambda: clock[0]
    t = start
    while True:
        clock[0] = t + 75_000
        w.check_symbol(SYM)
        if t >= end:
            break
        t = min(end, t + every * M30)
    return w


def outcome(o):
    return (o["armed_at"], o["dir"], o["status"], o.get("entry_t"), o.get("exit_t"), o.get("r"))


def book(w):
    return sorted(outcome(o) for o in w.orders(SYM))


def log_of(folder):
    out = []
    for path in sorted((Path(folder) / "log").glob("*.jsonl")):
        out += [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return out


DATA = make_data()

try:
    # --- El registro vela a vela contra una corrida del probador ---
    every_bar = run_schedule(TMP / "a", DATA, SINCE, END, every=2)
    final_cut = every_bar._spans[SYM]["cut"]
    bars, events = DATA
    span = {"bars": [b for b in bars if SINCE - dx.WARM_DAYS * DAY <= b["t"] and b["t"] + M30 <= final_cut],
            "events": [e for e in events if SINCE - dx.WARM_DAYS * DAY <= e["t"] and e["known"] <= final_cut]}
    ref = rt.run(SYM, dx.RULE, span, {"phase": 0, "from": "", "to": ""}, None, base=False, since=SINCE, minutes=lambda s, a, b: None)
    closed = sorted((o["armed_at"], o["dir"], o["entry_t"], o["exit_t"], o["r"]) for o in every_bar.orders(SYM) if o["status"] == "cerrada")
    expected = sorted((t["known"], t["dir"], t["entry_t"], t["exit_t"], t["r"]) for t in ref["trades"])
    check("el registro arranca en el primer cierre y guarda 20 dias de velas antes", every_bar._spans[SYM]["since"] == SINCE
          and every_bar._spans[SYM]["bars"][0]["t"] == SINCE - dx.WARM_DAYS * DAY)
    check("hay trades cerrados y ordenes que vencen sin llenarse", len(closed) >= 5
          and {o["status"] for o in every_bar.orders(SYM)} >= {"cerrada", "vencida"}, f"{len(closed)} {[o['status'] for o in every_bar.orders(SYM)]}")
    check("los trades cerrados son los de la corrida del probador desde since", closed == expected, f"{len(closed)} contra {len(expected)}")
    opened = [o for o in every_bar.orders(SYM) if o["status"] == "abierta"]
    check("la posicion abierta es la del probador", sorted((o["armed_at"], o["entry_t"]) for o in opened)
          == sorted((t["known"], t["entry_t"]) for t in ref.get("openTrades") or []))
    check("ninguna orden se armo antes de since", all(o["armed_at"] >= SINCE for o in every_bar.orders(SYM)))

    # Con otro ritmo de revisiones (cada 5 velas: cada una suma varias), lo mismo
    every_3 = run_schedule(TMP / "b", DATA, SINCE, END, every=5)
    check("con revisiones cada 5 velas, el mismo registro", book(every_3) == book(every_bar))

    # --- No mira el futuro ---
    mid = SINCE + 2 * DAY + 7 * M30
    cut_data = ([b for b in DATA[0] if b["t"] + M30 <= mid], [e for e in DATA[1] if e["known"] <= mid])
    full_to_mid = run_schedule(TMP / "c", DATA, SINCE, mid, every=3)
    cut_to_mid = run_schedule(TMP / "d", cut_data, SINCE, mid, every=3)
    check("lo anotado hasta una hora es igual con o sin las velas posteriores", book(full_to_mid) == book(cut_to_mid) and book(full_to_mid))
    strip = lambda e: {k: v for k, v in e.items() if k not in ("detected_at", "delay_ms")}
    check("y su registro de eventos tambien", [strip(e) for e in log_of(TMP / "c")] == [strip(e) for e in log_of(TMP / "d")])
    # Lo visto no se recalcula: si despues cambia una vela vieja (la nube tapa un hueco), lo anotado sigue igual
    seen = [dict(b) for b in full_to_mid._spans[SYM]["bars"]]
    changed = ([dict(b, h=b["h"] * 1.01) if b["t"] < mid else b for b in DATA[0]], DATA[1])
    full_to_mid._detect = fake_detect(changed)
    run_schedule(TMP / "c", changed, mid + M30, mid + DAY, every=4, w=full_to_mid)
    check("las velas ya vistas no cambian con datos nuevos del pasado", full_to_mid._spans[SYM]["bars"][:len(seen)] == seen)

    # --- Reinicio y pasos en orden ---
    first_half = run_schedule(TMP / "e", DATA, SINCE, mid, every=5)
    restarted = run_schedule(TMP / "e", DATA, mid + 5 * M30, END, every=5, w=watcher(TMP / "e", DATA, [0]))
    whole = every_3
    check("tras reiniciar, el registro sigue igual que sin reiniciar", book(restarted) == book(whole), f"{len(book(restarted))} {len(book(whole))}")
    events_e = log_of(TMP / "e")
    keys = {}
    for e in events_e:
        keys.setdefault(e["key"], []).append(e["type"])
    allowed = [["armada"], ["armada", "entrada"], ["armada", "entrada", "salida"], ["armada", "vencida"], ["armada", "no entra"],
               ["armada", "no se opera"]]
    check("cada orden pasa por sus pasos en orden y sin repetirse", keys and all(v in allowed for v in keys.values()),
          str([v for v in keys.values() if v not in allowed][:3]))
    check("ninguna revision con datos que no cambian", not any(e["type"] == "revision" for e in events_e))
    armada = [e for e in events_e if e["type"] == "armada"]
    check("cada orden armada dice su limit, su stop, su objetivo y hasta cuando vale",
          armada and all(e.get("limit") and e.get("stop") and e.get("target") and "vale hasta" in e["text"] for e in armada))
    goal = [o for o in whole.orders(SYM) if o["status"] == "cerrada"]
    check("el objetivo es 2R desde la limit", goal and all(abs(abs(o["target"] - o["entry"]) - 2 * o["risk"]) < 1e-9 for o in goal))

    # --- El almacen va detras ---
    clock = [SINCE + 75_000]
    lagging = watcher(TMP / "g", DATA, clock, lag=10 * 60_000)
    behind = lagging.check_symbol(SYM)
    check("con el almacen 10 minutos atras, espera: la vela que falta no entra", behind and lagging._spans[SYM]["cut"] == SINCE - M30)
    lagging._store_until = lambda symbol, now: now
    clock[0] = SINCE + 2 * 60_000
    check("cuando el almacen la tiene, la suma", not lagging.check_symbol(SYM) and lagging._spans[SYM]["cut"] == SINCE)

    # --- La ejecucion con la cinta ---
    D = T0 + 4 * DAY
    S = 10_000   # la cinta guarda la hora en 1e-4 s

    def tape_of(rows):
        t = np.array([int(ms * 10) for ms, _, _, _ in rows], np.int64)
        p = np.array([round(px * 100) for _, px, _, _ in rows], np.int64)
        q = np.array([round(qt * 1000) for _, _, qt, _ in rows], np.int64)
        s = np.array([sd for _, _, _, sd in rows], np.int8)
        return {"price_scale": 100, "qty_scale": 1000}, t, p, q, s, np.zeros(len(rows), bool)

    tapes = {}
    data2 = TMP / "of2"
    day_name = dx._day(D)
    tape_path = data2 / "live" / "tape" / SYM / day_name[:4] / f"{SYM}_{day_name}.tape"
    tape_path.parent.mkdir(parents=True, exist_ok=True)
    tape_path.write_bytes(b"")
    reader = lambda path: tapes[Path(path).name]
    meter = dx.DxWatch(TMP / "h", data2, read_tape=reader, symbols=[SYM])
    h = 3_600_000
    tapes[tape_path.name] = tape_of([
        (D + 11 * h + 300_000, 100.00, 1, -1),     # toca la limit
        (D + 11 * h + 301_000, 99.99, 1, -1),      # la pasa: se llena
        (D + 12 * h, 100.50, 1, 1),
        (D + 12 * h + 31 * 60_000 + 10_000, 98.99, 2, -1),   # primer trade en el stop o debajo: el disparo
        (D + 12 * h + 31 * 60_000 + 10_060, 98.98, 2, -1),   # ventas a mercado de los 100 ms siguientes
        (D + 12 * h + 31 * 60_000 + 10_070, 98.97, 5, 1),    # una compra: no cuenta para vender
        (D + 12 * h + 31 * 60_000 + 10_150, 98.90, 5, -1),   # pasados los 100 ms: no cuenta
    ])
    rec = {"key": "x", "symbol": SYM, "dir": 1, "armed_at": D + 10 * h, "entry_t": D + 11 * h, "entry": 100.0, "stop": 99.0,
           "target": 102.0, "risk": 1.0, "order": "limit", "status": "cerrada", "exit_t": D + 12 * h + 30 * 60_000, "reason": "stop", "r": -1.0}
    meter._measure(rec)
    ex = rec.get("exec") or {}
    fill = (98.99 * 2 + 98.98 * 2) / 4
    check("la limit se llena con el primer trade que la pasa, no con el que la toca",
          ex.get("fill_ms") == D + 11 * h + 301_000 and ex.get("touch_ms") == D + 11 * h + 300_000, str(ex))
    check("el stop se dispara con el primer trade en el nivel o debajo, y la venta a mercado es el promedio de los 100 ms",
          ex.get("trigger_ms") == D + 12 * h + 31 * 60_000 + 10_000 and abs(ex.get("exit_fill", 0) - fill) < 1e-9, str(ex))
    check("el deslizamiento es lo perdido contra el stop, en %", abs(ex.get("slip_pct", 0) - (99.0 - fill) / 99.0 * 100) < 1e-4 and ex.get("first") == "stop")
    r_exec = ((fill - 100.0) - (rt.MAKER_FEE * 100.0 + rt.TAKER_FEE * fill)) / 1.0
    check("el R con la ejecucion medida usa ese precio y las comisiones del probador", abs(rec.get("r_exec", 0) - round(r_exec, 4)) < 1e-9, str(rec.get("r_exec")))
    # Un corto que sale en el objetivo: la recompra a mercado, y si el precio paso el objetivo (una limit se llenaba)
    tapes[tape_path.name] = tape_of([
        (D + 11 * h + 300_000, 100.01, 1, 1),      # la limit de venta se llena al pasarla hacia arriba
        (D + 13 * h, 98.00, 1, -1),                # toca el objetivo: el disparo
        (D + 13 * h + 30, 98.01, 1, 1),            # compras a mercado de los 100 ms siguientes
        (D + 13 * h + 80, 98.03, 3, 1),
        (D + 13 * h + 20_000, 98.00, 1, -1),       # en el minuto siguiente no lo pasa
    ])
    meter._tapes.clear()
    short = {"key": "y", "symbol": SYM, "dir": -1, "armed_at": D + 10 * h, "entry_t": D + 11 * h, "entry": 100.0, "stop": 101.0,
             "target": 98.0, "risk": 1.0, "order": "limit", "status": "cerrada", "exit_t": D + 13 * h, "reason": "objetivo", "r": 1.9}
    meter._measure(short)
    ex = short.get("exec") or {}
    buy = (98.01 * 1 + 98.03 * 3) / 4
    check("en el objetivo de un corto, la recompra a mercado es el promedio de las compras",
          abs(ex.get("exit_fill", 0) - buy) < 1e-9 and ex.get("kind") == "objetivo", str(ex))
    check("solo lo toco: una limit en el objetivo no se habria llenado", ex.get("crossed") is False)
    tapes[tape_path.name] = tape_of([
        (D + 11 * h + 301_000, 99.99, 1, -1),                # se llena
        (D + 12 * h + 10_000, 98.99, 1, -1),                 # el disparo del stop
        (D + 12 * h + 10_050, 99.05, 4, -1),                 # la mecha se da vuelta: ventas mas arriba
    ])
    meter._tapes.clear()
    wick = dict(rec, key="z", exec={}, exit_t=D + 12 * h)
    meter._measure(wick)
    check("si la mecha se da vuelta, cuenta el disparo: el deslizamiento nunca sale a favor",
          abs((wick.get("exec") or {}).get("exit_fill", 0) - 98.99) < 1e-9 and wick["exec"]["slip_pct"] > 0, str(wick.get("exec")))
    check("sin la cinta de ese dia, no se mide", dx.DxWatch(TMP / "i", TMP / "nada", read_tape=reader, symbols=[SYM])._first(SYM, D, D + h, 1, 1.0, False) is None)

    # --- Informe y zonas de la defensa ---
    rep = whole.report(now=END + 75_000)
    check("el informe cuenta los cerrados con la cuenta del probador", rep["book"]["n"] == len(goal) and rep["sends"] is False)
    check("sin cinta, el R con la ejecucion medida es el del probador", rep["exec"].get("avgR") == rep["book"].get("avgR") and rep["measured"] == 0)
    late = whole.report(now=SINCE + 13 * dx.MONTH)
    check("a los 13 meses, las tres lecturas del plan tienen su veredicto",
          [m["months"] for m in late["checkpoints"]] == [3, 6, 12] and all(m["due"] and "verdict" in m for m in late["checkpoints"]))
    check("antes de los 3 meses, ninguna lectura", not any(m["due"] for m in rep["checkpoints"]))
    pending = [o for o in whole.orders(SYM) if o["status"] == "esperando"]
    zones = whole.zones(SYM, SINCE, END + DAY)
    price = whole._state[SYM]["last_close"]
    near = {f"dx:{o['key']}" for side in (1, -1)
            for o in sorted((o for o in pending if o["dir"] == side), key=lambda o: abs(o["limit"] - price))[:dx.ZONE_PENDING]}
    waiting_zones = {z["id"] for z in zones if z["id"] in {f"dx:{o['key']}" for o in pending}}
    check("las limit de DX van a la defensa de zona: de las que esperan, las 2 mas cerca del precio de cada lado",
          zones and all(z["kind"] == "dx" and z["label"].startswith("DX ") and z["hi"] > z["lo"] for z in zones)
          and waiting_zones == near, f"{len(pending)} esperando, {waiting_zones} contra {near}")
    near3 = whole.status()["by_symbol"][SYM]
    check("el estado muestra las 3 que esperan mas cerca del precio y cuenta todas",
          near3["pendingCount"] == len(pending) and len(near3["pending"]) == min(3, len(pending)))

    # --- Rutas, configuracion y que nada se envia ---
    with TestClient(main.app, base_url="http://127.0.0.1") as client:
        status = client.get("/api/dx/status").json()
        check("la ruta de estado responde, con las 7 monedas de la hipotesis y sin enviar nada",
              status["success"] and status["sends"] is False and status["symbols"] == list(dx.SYMBOLS), str(status)[:300])
        check("con SUITE_SWING=0 no registra", status["env_off"] and not status["detecting"])
        check("el informe y el registro responden", client.get("/api/dx/report").json()["success"] and client.get("/api/dx/log").json()["success"])
        check("una configuracion invalida se rechaza", client.post("/api/dx/config", json={"enabled": "si"}).status_code == 400
              and client.post("/api/dx/config", json={"enabled": True, "rule": {}}).status_code == 400)
        ok = client.post("/api/dx/config", json={"enabled": False})
        path = Path(os.environ["SUITE_DATA_DIR"]) / "dx" / "config.json"
        saved = json.loads(path.read_text(encoding="utf-8")) if path.exists() else None
        check("apagarlo se guarda", ok.status_code == 200 and saved == {"enabled": False}, f"{ok.status_code} {saved}")
        check("un dia mal escrito se rechaza", client.get("/api/dx/log?day=22-11-2026").status_code == 400)
        check("el estado de la suite trae DX", "dx" in client.get("/api/suite/status").json())
    check("la defensa de zona suma las zonas de DX", main.DX.zones in book_defense.ZONE_SOURCES)
    source = (HERE.parent / "dx_watch.py").read_text(encoding="utf-8")
    check("el modulo no habla con el bot ni con Bybit", "bot_url" not in source and "httpx" not in source and "/api/trade" not in source)
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [name for name, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pasan")
sys.exit(1 if failed else 0)
