# Pruebas sin conexion del seguimiento de los hallazgos del scanner (24/11/2026, docs/PLAN_SEGUIMIENTO_SCANNER.md):
#   - el lado, las lineas enteras y los miembros gzip cortados;
#   - lo medido: el movimiento importante, la carrera, los horizontes, las variables, los elementos y la serie;
#   - el hallazgo: una entrada sin estar en ninguna lista; la misma moneda en otra lista o de vuelta antes de 2 h es el
#     mismo; despues de 2 h, otro (con las horas desde el anterior); el arranque (sin mirar mas de 30 min) y Rapidos;
#   - la foto sale de la ultima vuelta en o antes de la entrada; los eventos de los ultimos 3 min y la linea a medias
#     esperan; un reinicio no repite nada;
#   - el control: 2 por vuelta, al azar pero siempre las mismas, fuera de las listas, sin BTC ni monedas de un hallazgo;
#   - a las 24 h y 10 min se mide con la historia; lo incompleto se reintenta y, tras 12 intentos, queda "sin datos";
#   - el informe, las rutas y que los elementos de App 1 no miren el futuro. Nada se envia.
# Bybit y el bot nunca se consultan: la historia es falsa. Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\follow_checks.py
import asyncio
import gzip
import json
import math
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_follow_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"   # tambien apaga el scanner y el seguimiento (siguen a SUITE_SWING)
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import numpy as np  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import scanner as scn  # noqa: E402
import scan_follow as sf  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


MIN, HOUR, DAY, STEP5 = sf.MIN, sf.HOUR, sf.DAY, sf.STEP5
DAY0 = 1_793_491_200_000          # 2026-11-01 00:00 UTC
C0 = DAY0 + 20_000                # la vuelta de 15 min empieza 20 s despues del cierre
CYC = 15 * MIN


def cyc(k):
    return C0 + k * CYC


# ==================== funciones sueltas ====================

check("lado de En juego: el movimiento propio de 24 h", sf.side_of("enjuego", {"resid_24h": -0.02, "ret_24h": 0.03}, []) == -1)
check("lado sin movimiento propio: el retorno de 24 h", sf.side_of("enjuego", {"resid_24h": None, "ret_24h": -0.01}, []) == -1)
check("lado de Tendencia: la ruptura de 20 dias", sf.side_of("tendencia", {"break20": -1, "resid_24h": 0.04}, []) == -1)
check("lado de Rapidos: el signo del cambio que la hizo entrar",
      sf.side_of("rapidos", {"resid_24h": 0.05}, ["−0.9% en 5 min", "OI +3%"]) == -1
      and sf.side_of("rapidos", {"resid_24h": -0.05}, ["+1.2% en 15 min"]) == 1)
check("lineas enteras: la ultima a medias no cuenta", sf.complete_lines(b'{"a":1}\r\n{"b":2}\n{"c"') == ['{"a":1}\r', '{"b":2}'])

gz = TMP / "miembros.jsonl.gz"
good = [gzip.compress((json.dumps({"n": i}) + "\n").encode()) for i in range(4)]
gz.write_bytes(good[0] + good[1] + good[2][:-9])
check("miembros gzip: el ultimo cortado espera", [r["n"] for r in sf.read_members(gz)] == [0, 1])
gz.write_bytes(good[0] + good[1][:12] + b"basura" + good[2] + good[3])
check("miembros gzip: uno cortado en el medio se salta y se sigue", [r["n"] for r in sf.read_members(gz)] == [0, 2, 3])

h15 = [{"t": DAY0 + i * 15 * MIN, "o": 1, "h": 2 + i, "l": 0.5, "c": 1.5, "delta": 0, "vol": 1} for i in range(10)]
hours = sf.bar_hour(h15[1:])
check("velas de 1 h: solo las horas completas", len(hours) == 1 and hours[0]["t"] == DAY0 + HOUR and hours[0]["h"] == 9
      and hours[0]["vol"] == 4)


def bars5(t0, closes, start=None):
    """Velas de 5 min con esos cierres, la primera empezando en start (o en la vela que sigue a t0)."""
    first = start if start is not None else (t0 // STEP5 + 1) * STEP5
    out, prev = [], closes[0]
    for i, c in enumerate(closes):
        o = prev
        out.append([first + i * STEP5, o, max(o, c), min(o, c), c, 10.0, 1000.0])
        prev = c
    return out


T = C0
up = [100 + 0.1 * i for i in range(1, 289)]          # +0.1 por vela: 2 ATR a la vela 20, 3 ATR a la 30 (ATR = 1)
o = sf.outcome(bars5(T, up), T, 100.0, 1.0, 1)
first_end = round(((T // STEP5 + 1) * STEP5 + STEP5 - T) / MIN)
check("carrera: sigue a las 2 ATR", o["touch"] == "sigue" and o["touch_min"] == first_end + 19 * 5, o)
check("movimiento importante: sigue a las 3 ATR, con su minuto", o["big"]["way"] == "sigue" and o["big"]["min"] == first_end + 29 * 5, o["big"])
check("horizontes: a favor, en contra y cierre", o["1h"]["fav"] == 1.2 and o["1h"]["adv"] == 0.0 and o["24h"]["close"] == 28.8, o["1h"])
o = sf.outcome(bars5(T, up), T, 100.0, 1.0, -1)
check("con el lado al reves, gira", o["touch"] == "gira" and o["big"]["way"] == "gira" and o["1h"]["adv"] == 1.2)
flat = [100.0] * 288
o = sf.outcome(bars5(T, flat), T, 100.0, 1.0, 1)
check("sin moverse en 24 h: ninguna y sin movimiento importante", o["touch"] == "ninguna" and o["big"] is None and o["complete"])
o = sf.outcome(bars5(T, flat[:100]), T, 100.0, 1.0, 1)
check("sin las 24 h: la carrera sigue abierta", o["touch"] is None and not o["complete"] and o["24h"] is None and o["4h"])
wild = bars5(T, flat)
wild[5] = [wild[5][0], 100, 103.5, 96.5, 100, 10, 1000]
o = sf.outcome(wild, T, 100.0, 1.0, 1)
check("las dos en la misma vela", o["touch"] == "las dos" and o["big"]["both"])

# --- variables de la historia ---
k5 = bars5(T, [100.0] * 288, start=T - WINDOW if (WINDOW := sf.WINDOW) else 0)
data = {"k5": k5, "oi": [[T - HOUR, 1000.0], [T - 60_000, 1100.0], [T + HOUR, 1210.0]],
        "ls": [[T - HOUR - 1, 0.55], [T - 1, 0.62]], "prem": [[T - 2 * STEP5, 0, 0, 0, 0.0002], [T - STEP5 + 1, 0, 0, 0, 0.0009]],
        "btc": [[T - WINDOW - STEP5, 50.0], [T - STEP5 - 1, 60.0], [T + HOUR - STEP5, 66.0]]}
v = sf.variables(data, T, 101.0, 1.0, 1)
check("OI: la hora anterior y la siguiente", v["oi_pre1h"] == 0.1 and v["oi_1h"] == 0.1 and v["oi_4h"] is None, v)
check("cuentas en largo y su cambio en 1 h", v["long"] == 0.62 and v["long_chg1h"] == 0.07, v)
check("prima: la ultima vela de 5 min ya cerrada", v["prem_bps"] == 2.0, v)
check("BTC antes y despues", v["btc_pre24h"] == 0.2 and v["btc_1h"] == 0.1 and v["btc_24h"] is None, v)
check("lo que se movio antes, visto desde el lado", v["pre_1h"] == 1.0 and sf.variables(data, T, 101.0, 1.0, -1)["pre_1h"] == -1.0)

s = sf.signal_sets([["QB", 15, -30, 1], ["QB", 15, -90, 1], ["FV", 15, 10, -1], ["IM", 60, 120, 1], ["IM", 60, 125, 1]], 1, {"min": 150})
check("elementos: al hallazgo, en la primera hora y antes del movimiento",
      s["sa"] == ["QB|15|+"] and s["sf"] == ["FV|15|-"] and s["sb"] == ["IM|60|+"], s)
check("elementos: en cuantas horas del hallazgo", s["sh"] == {"FV|15|-": 1, "IM|60|+": 1, "QB|15|+": 2}, s["sh"])

# ==================== Bybit falso ====================
BTC = "BTCUSDT"
MOVER, FLAT, FAST, LATE, SHORT = "AAAUSDT", "BBBUSDT", "CCCUSDT", "DDDUSDT", "FFFUSDT"
CALLS = []
MOVE_AT = {}       # moneda -> hora desde la que sube 0.1% por vela de 5 min
CUT = {}           # moneda -> hasta donde da velas de 5 min (para lo incompleto)


def price(sym, t):
    base = 100.0
    start = MOVE_AT.get(sym)
    if start is not None and t > start:
        base *= 1 + 0.001 * ((t - start) // STEP5)
    return base


async def fake(path, params):
    CALLS.append((path, params.get("symbol")))
    sym = params.get("symbol")
    if path in ("/v5/market/kline", "/v5/market/premium-index-price-kline"):
        step = int(params["interval"]) * MIN
        lo, hi = int(params["start"]), int(params["end"])
        if path == "/v5/market/kline" and sym in CUT and params["interval"] == "5":
            hi = min(hi, CUT[sym])
        first = -(-lo // step) * step
        ts = list(range(first, hi + 1, step))[-int(params["limit"]):]
        rows = []
        for t in reversed(ts):
            if path == "/v5/market/kline":
                o, c = price(sym, t), price(sym, t + step - 1)
                rows.append([str(t), str(o), str(max(o, c) * 1.0002), str(min(o, c) * 0.9998), str(c), "10", "1000"])
            else:
                rows.append([str(t), "0.0001", "0.0001", "0.0001", "0.0001"])
        return {"list": rows}
    if path in ("/v5/market/open-interest", "/v5/market/account-ratio"):
        lo, hi = int(params["startTime"]), int(params["endTime"])
        ts = list(range(-(-lo // STEP5) * STEP5, hi + 1, STEP5))[::-1]
        start = int(params.get("cursor") or 0)
        page = ts[start:start + int(params["limit"])]
        if path == "/v5/market/open-interest":
            items = [{"openInterest": str(1e6 + (t - DAY0) / STEP5), "timestamp": str(t)} for t in page]
        else:
            items = [{"buyRatio": "0.6", "sellRatio": "0.4", "timestamp": str(t)} for t in page]
        more = start + len(page) < len(ts)
        return {"list": items, "nextPageCursor": str(start + len(page)) if more else ""}
    raise AssertionError(f"pedido inesperado {path}")


def fake_elements(sym, k15, t0):
    return [["QB", 15, -30, 1], ["FV", 15, 10, -1], ["IM", 60, 120, 1]]


# ==================== el registro del scanner, armado a mano ====================
SRC = TMP / "scanner"
FIELDS = list(scn.ROW_FIELDS)
COINS = {MOVER: {"resid_24h": 0.05}, FLAT: {"resid_24h": 0.02}, FAST: {"resid_24h": 0.03}, LATE: {"resid_24h": -0.04},
         "EEEUSDT": {"resid_24h": 0.01}, "GGGUSDT": {"resid_24h": -0.01}, "HHHUSDT": {"resid_24h": 0.02},
         SHORT: {"resid_24h": 0.01}, BTC: {"resid_24h": 0.0}}


def row(sym):
    base = {"price": 100.0, "atr_1h": 0.01, "ret_24h": 0.03, "rvol_1h": 6.0, "rvol_24h": 4.0, "oi_1h": 0.02,
            "funding_8h": 0.0001, "break20": 0, "turnover24h": 5e7, **COINS[sym]}
    return [base.get(f) for f in FIELDS]


def cycle(at, enjuego=(), tendencia=(), rapidos=()):
    return {"v": 1, "at": at, "market": {"reading": "mixto"}, "fields": FIELDS, "rows": {s: row(s) for s in COINS},
            "lists": {"enjuego": list(enjuego), "tendencia": list(tendencia), "rapidos": list(rapidos), "mias": []}}


def ev(at, lista, sym, kind, chips=None, gap=False):
    e = {"at": at, "list": lista, "symbol": sym, "type": kind, "chips": chips or ["vol ×4.0"], "price": 100.0}
    if gap:
        e["gap"] = True
    return e


CYCLES = [cycle(cyc(0), [MOVER]), cycle(cyc(1), [MOVER, FLAT], rapidos=[FAST]), cycle(cyc(2), [MOVER, FLAT], [MOVER], [FAST]),
          cycle(cyc(3), [MOVER], [MOVER]), cycle(cyc(4), [MOVER, FLAT], [MOVER]), cycle(cyc(5), [MOVER, FLAT], [MOVER]),
          cycle(cyc(6), [MOVER], [MOVER]), cycle(cyc(9), [MOVER, LATE], [MOVER])]   # de cyc(6) a cyc(9): 45 min sin mirar
EVENTS = [ev(cyc(0), "enjuego", MOVER, "entra"), ev(cyc(1), "enjuego", FLAT, "entra"),
          ev(cyc(1) + 2 * MIN, "rapidos", FAST, "entra", ["−0.9% en 5 min", "OI +3.1%"]),
          ev(cyc(2), "tendencia", MOVER, "entra"), ev(cyc(3), "enjuego", FLAT, "sale"), ev(cyc(4), "enjuego", FLAT, "entra"),
          ev(cyc(6), "enjuego", FLAT, "sale"), ev(cyc(9), "enjuego", LATE, "entra"),
          ev(cyc(9) + 30 * MIN, "rapidos", FAST, "sale")]
for e in EVENTS:
    if e["symbol"] == MOVER:
        MOVE_AT[MOVER] = cyc(0)   # sube desde el hallazgo


def write_scanner(cycles, events, tail=b""):
    (SRC / "log").mkdir(parents=True, exist_ok=True)
    (SRC / "events").mkdir(parents=True, exist_ok=True)
    by = {}
    for c in cycles:
        by.setdefault(sf._day(c["at"]), []).append(c)
    for day, items in by.items():
        (SRC / "log" / f"{day}.jsonl.gz").write_bytes(b"".join(gzip.compress((json.dumps(c) + "\n").encode()) for c in items))
    by = {}
    for e in events:
        by.setdefault(sf._day(e["at"]), []).append(e)
    for day, items in by.items():
        text = "".join(json.dumps(e, ensure_ascii=False) + "\r\n" for e in items).encode("utf-8")   # como el scanner en Windows
        (SRC / "events" / f"{day}.jsonl").write_bytes(text + tail)


CLOCK = [cyc(9) + 31 * MIN]    # el ultimo evento (la salida de FAST) tiene 1 min: espera


def tracker():
    return sf.FollowTracker(SRC, fetch=fake, now=lambda: CLOCK[0], elements=fake_elements, start_delay=0)


def run(coro):
    return asyncio.run(coro)


write_scanner(CYCLES, EVENTS, tail=b'{"at": 1, "list"')
tr = tracker()
run(tr.tick())
found = {r["symbol"]: r for r in tr.open.values() if r["kind"] == "hallazgo"}
ctrl = [r for r in tr.open.values() if r["kind"] == "control"]
check("un hallazgo por moneda que entra sin estar en ninguna lista", set(found) == {MOVER, FLAT, FAST, LATE}, sorted(found))
check("la misma moneda en otra lista es el mismo hallazgo", len([r for r in tr.open.values() if r["symbol"] == MOVER]) == 1)
check("volver antes de 2 h es el mismo hallazgo", len([r for r in tr.open.values() if r["symbol"] == FLAT and r["kind"] == "hallazgo"]) == 1)
check("la primera vuelta que se conoce es del arranque", found[MOVER]["startup"] and found[MOVER]["blind_min"] is None)
check("15 min despues de la anterior: en vivo", not found[FLAT]["startup"] and found[FLAT]["blind_min"] == 15)
check("45 min sin mirar: del arranque", found[LATE]["startup"] and found[LATE]["blind_min"] == 45)
check("Rapidos nunca es del arranque, y su lado es el del cambio", not found[FAST]["startup"] and found[FAST]["side"] == -1)
check("la foto sale de la ultima vuelta en o antes de la entrada",
      found[FAST]["cycle_at"] == cyc(1) and found[FAST]["f"]["atr_1h"] == 0.01 and found[FAST]["atr"] == 0.01)
check("id con la hora y la moneda", found[MOVER]["id"] == sf.make_id("hallazgo", cyc(0), MOVER) and sf.ID_RE.match(found[MOVER]["id"]))
check("2 controles por vuelta", len(ctrl) == 2 * len(CYCLES), len(ctrl))
listed = {s for c in CYCLES for name in sf.LISTS for s in c["lists"][name] if c["at"] == min(c["at"] for c in CYCLES)}
bad = [r for r in ctrl if r["symbol"] in {s for c in CYCLES if c["at"] == r["t0"] for n in sf.LISTS for s in c["lists"][n]}]
check("el control nunca esta en una lista de su vuelta", not bad, [r["id"] for r in bad])
check("el control nunca es BTC", all(r["symbol"] != BTC for r in ctrl))
check("el control nunca es una moneda con un hallazgo abierto",
      not [r for r in ctrl if r["symbol"] == FAST and cyc(1) + 2 * MIN <= r["t0"] < cyc(9) + 30 * MIN])
check("el control lleva su lado y su foto", all(r["side"] in (1, -1) and r["f"].get("price") == 100.0 and not r["startup"] for r in ctrl))
check("el evento de hace 1 min espera", tr.state["coins"].get(FAST, {}).get("in") == {"rapidos": cyc(1) + 2 * MIN})
check("lo leido de los eventos no cuenta lo que espera", tr.state["read"]["events"][sf._day(cyc(0))]["size"] == -1)
first_ids = set(tr.open)

CLOCK[0] = cyc(9) + 40 * MIN
run(tr.tick())
check("el evento se lee cuando ya pasaron 3 min", FAST not in tr.state["coins"] or not tr.state["coins"][FAST]["in"])
check("la linea a medias no se lee", tr.state["read"]["events"][sf._day(cyc(0))]["n"] == len(EVENTS))

# Vuelve FLAT 2 h 5 min despues de salir: otro hallazgo, con las horas desde el anterior
back = cyc(6) + 125 * MIN
CYCLES.append(cycle(back, [MOVER, FLAT], [MOVER]))
EVENTS.append(ev(back, "enjuego", FLAT, "entra"))
write_scanner(CYCLES, EVENTS)
CLOCK[0] = back + 10 * MIN
run(tr.tick())
flats = sorted((r for r in tr.open.values() if r["symbol"] == FLAT and r["kind"] == "hallazgo"), key=lambda r: r["t0"])
check("volver despues de 2 h es otro hallazgo", len(flats) == 2 and flats[1]["t0"] == back, [r["id"] for r in flats])
check("con las horas desde el anterior", flats[1]["prev_h"] == round((back - cyc(1)) / HOUR, 1), flats[1]["prev_h"])

# Un reinicio no repite nada (el proceso anterior suelta el candado al cerrarse)
other = tracker()
run(other.tick())
check("con el candado tomado por otro proceso no se lee nada", other.other_process and not other.open and not other.loaded)
tr._release_lock()
tr2 = tracker()
run(tr2.tick())
check("un reinicio retoma lo abierto sin repetir", set(tr2.open) == set(tr.open) and tr2.loaded, len(tr2.open))
check("sin fotos repetidas en el disco",
      len(sf.read_members(SRC / "follow" / "episodes" / f"{sf._day(cyc(0))}.jsonl.gz")) == len(tr.open))
check("los controles salen iguales al leer otra vez", {r["id"] for r in tr2.open.values() if r["kind"] == "control"}
      == {r["id"] for r in tr.open.values() if r["kind"] == "control"})
fresh = sf.FollowTracker(TMP / "otra" / "scanner", fetch=fake, now=lambda: CLOCK[0], elements=fake_elements)
shutil.copytree(SRC / "log", TMP / "otra" / "scanner" / "log")
shutil.copytree(SRC / "events", TMP / "otra" / "scanner" / "events")
run(fresh.tick())
check("otra carpeta con el mismo registro elige los mismos controles",
      {r["id"] for r in fresh.open.values()} == {r["id"] for r in tr.open.values()})

# ==================== a las 24 h ====================
mover_id = found[MOVER]["id"]
CLOCK[0] = cyc(0) + sf.CLOSE_AFTER - MIN
check("antes de las 24 h y 10 min no se mide", mover_id not in {r["id"] for r in tr2.due(CLOCK[0])})
CLOCK[0] = cyc(0) + sf.CLOSE_AFTER + MIN
check("a las 24 h y 10 min, por medir", mover_id in {r["id"] for r in tr2.due(CLOCK[0])})
CALLS.clear()
n = run(tr2.close_due(limit=1))
row_m = tr2.index.get(mover_id)
check("medido: queda en la lista y sale de lo abierto", n == 1 and row_m and mover_id not in tr2.open
      and mover_id not in tr2.state["open"], row_m and row_m.get("state"))
check("el movimiento importante y la carrera del que sube", row_m["o"]["big"]["way"] == "sigue" and row_m["o"]["touch"] == "sigue"
      and row_m["o"]["complete"], row_m["o"])
disk = {r["id"]: r for r in tr2._index_rows(30)}   # la fila completa queda en el disco; la lista en memoria va sin ellas
check("las listas de sus 24 h, del registro de entradas y salidas",
      [x[0] for x in disk[mover_id]["lists"]] == ["enjuego", "tendencia"] and "lists" not in row_m, disk[mover_id]["lists"])
check("lo que se encendio, en corto", row_m["s"]["sa"] == ["QB|15|+"], row_m["s"])
check("unos 11 pedidos a Bybit", 8 <= len(CALLS) <= 14, len(CALLS))
full = run(tr2.detail(mover_id))
CALLS.clear()
again = run(tr2.detail(mover_id))
check("el detalle de un hallazgo medido sale del disco, sin pedir nada", not CALLS and again["id"] == mover_id)
Q = 15 * MIN
i0 = (DAY0 - full["series"]["start"]) // Q   # la vela de 15 min que contiene el hallazgo
check("la serie de sus 48 h (y unas velas antes), en velas de 15 min, y sus elementos",
      full["series"]["step"] == Q and len(full["series"]["c"]) == len(full["series"]["oi"]) == 194
      and full["series"]["start"] == DAY0 - sf.WINDOW - Q and full["signals"] == fake_elements(None, None, None),
      (full["series"].get("step"), len(full.get("series", {}).get("c", []))))
check("la serie va en ATR desde el precio del hallazgo", abs(full["series"]["c"][i0]) < 0.5 and full["series"]["c"][i0 + 10] > 2.5,
      full["series"]["c"][i0:i0 + 2])
check("cada vela de 15 min con lo de sus tres de 5 min", full["series"]["h"][i0 + 1] == round(max(full["series"]["o"][i0 + 1],
      full["series"]["c"][i0 + 1]) * 1.0002 + 0.02, 3) or full["series"]["h"][i0 + 1] >= full["series"]["c"][i0 + 1])
check("lo que se movio en 24 h tiene su vela", full["h"]["pre_24h"] is not None and full["h"]["pre_1h"] is not None, full["h"])
check("las variables de la historia", full["h"]["long"] == 0.6 and full["h"]["oi_pre1h"] is not None and full["h"]["btc_1h"] == 0.0)

CLOCK[0] = cyc(9) + sf.CLOSE_AFTER + MIN
while run(tr2.close_due(limit=50)):
    pass
rows = tr2.rows(14, "todos")
check("todo lo vencido quedo medido", all(r["state"] == "medido" for r in rows if r["t0"] <= cyc(9)) and not tr2.due(CLOCK[0]),
      [r["state"] for r in rows][:5])
gzrecs = sf.read_members(SRC / "follow" / "closed" / f"{sf._day(cyc(0))}.jsonl.gz")
check("lo guardado va comprimido", not list((SRC / "follow").rglob("*.jsonl")) and list((SRC / "follow" / "index").glob("*.jsonl.gz")))
check("lo medido completo, solo de los hallazgos", gzrecs and all(r["kind"] == "hallazgo" for r in gzrecs)
      and len({r["id"] for r in gzrecs}) == len([r for r in rows if r["kind"] == "hallazgo" and r["state"] == "medido"]))
c_id = next(r["id"] for r in rows if r["kind"] == "control")
CALLS.clear()
cd = run(tr2.detail(c_id))
check("el detalle de un control se mide al pedirlo", CALLS and cd["series"]["c"] and cd["kind"] == "control")
fast = next(r for r in rows if r["symbol"] == FAST and r["kind"] == "hallazgo")
check("el que no se movio: ninguna", fast["o"]["touch"] == "ninguna" and fast["o"]["big"] is None, fast["o"])

# Lo incompleto se reintenta y, tras 12 intentos, queda sin datos
COINS[SHORT] = {"resid_24h": 0.01}
t_short = back + CYC
CYCLES.append(cycle(t_short, [MOVER, SHORT], [MOVER]))
EVENTS.append(ev(t_short, "enjuego", SHORT, "entra"))
write_scanner(CYCLES, EVENTS)
CLOCK[0] = t_short + 10 * MIN
run(tr2.tick())
sid = sf.make_id("hallazgo", t_short, SHORT)
CUT[SHORT] = t_short + 10 * HOUR
CLOCK[0] = t_short + sf.CLOSE_AFTER + MIN
run(tr2.close_due(limit=50))
check("Bybit sin las 24 h: se reintenta en 10 min", sid in tr2.open and tr2.state["tries"][sid]["n"] == 1
      and tr2.state["tries"][sid]["next"] == CLOCK[0] + sf.RETRY_MS, tr2.state["tries"].get(sid))
check("mientras tanto no se vuelve a pedir", sid not in {r["id"] for r in tr2.due(CLOCK[0] + MIN)})
for _ in range(sf.MAX_TRIES):
    CLOCK[0] += sf.RETRY_MS + MIN
    run(tr2.close_due(limit=50))
check("tras 12 intentos queda sin datos, con el motivo", tr2.index.get(sid, {}).get("state") == "sin datos"
      and "velas de 5 min" in (tr2.index[sid].get("err") or ""), tr2.index.get(sid))

# ==================== informe ====================
rep = run(tr2.report(30, False))
blocks = {b["id"]: b for b in rep["blocks"]}
live = [r for r in rows if r["kind"] == "hallazgo" and r["state"] == "medido" and not r["startup"]]
check("bloques: en vivo, por lista, del arranque y control", set(blocks) == {"live", "enjuego", "tendencia", "rapidos", "startup", "control"})
check("en vivo no cuenta los del arranque", blocks["live"]["n"] == len(live) and blocks["startup"]["n"] >= 1, (blocks["live"]["n"], len(live)))
check("los ocho cortes del plan", [s["id"] for s in rep["splits"]] == [k for k, _, _ in sf.SPLITS] and len(rep["splits"]) == 8)
rep2 = run(tr2.report(30, True))
check("con el arranque: el del arranque entra a los hallazgos", {b["id"] for b in rep2["blocks"]} == {"live", "enjuego", "tendencia", "rapidos", "control"}
      and next(b for b in rep2["blocks"] if b["id"] == "live")["n"] == blocks["live"]["n"] + blocks["startup"]["n"])
check("el informe lleva lo que falta medir", rep["open"] >= 0 and rep["no_data"] == 1)


def fake_row(touch, keys, side=1, kind="hallazgo", big=None, sh=None):
    return {"kind": kind, "state": "medido", "side": side, "startup": False, "list": "enjuego", "f": {}, "h": {},
            "o": {"complete": True, "touch": touch, "big": big, "1h": None, "4h": None, "24h": None},
            "s": {"sa": keys, "sf": [], "sb": keys if big else [], "sh": sh or {}}}


rs = [fake_row("sigue", ["QB|15|+"]) for _ in range(9)] + [fake_row("gira", ["QB|15|+"])] + \
     [fake_row("gira", []) for _ in range(9)] + [fake_row("sigue", [])]
tab = sf.signal_table(rs, [])
qb = tab["rows"][0]
check("elementos al hallazgo: sigue con y sin el elemento", qb["key"] == "QB|15|+" and qb["sigue_pct"] == 90.0 and qb["sin_pct"] == 10.0
      and qb["z"] > 2 and tab["tests"] == 1 and tab["pass"] == 1, qb)
check("menos de 8 casos no se mira", not sf.signal_table(rs[:7] + rs[10:], [])["rows"])
bb = sf.before_big([fake_row("sigue", ["IM|60|+"], big={"min": 100, "way": "sigue"}, sh={"IM|60|+": 2}) for _ in range(10)])
check("antes del movimiento: contra una hora cualquiera", bb["rows"][0]["pct"] == 100.0 and bb["rows"][0]["lift"] == 24.0, bb["rows"][:1])
b = sf.block([fake_row("sigue", [], big={"min": 30, "way": "sigue"}), fake_row("gira", [], big={"min": 90, "way": "gira"}),
              fake_row("ninguna", [])])
check("un bloque: movimiento importante, cuanto sigue y la carrera", b["n"] == 3 and b["big_pct"] == 66.7 and b["big_sigue_pct"] == 50.0
      and b["big_min"] == 60 and b["race_n"] == 2 and b["race_sigue_pct"] == 50.0, b)

# ==================== rutas ====================
app = FastAPI()
app.include_router(sf.make_router(tr2))
with TestClient(app, base_url="http://127.0.0.1:13000") as client:
    st = client.get("/api/follow/status").json()
    check("estado: no envia nada y cuenta lo medido", st["sends"] is False and st["measured"]["hallazgo"] >= 4, st["measured"])
    r = client.get("/api/follow/episodes?days=14").json()
    check("la lista: hallazgos, lo mas nuevo primero", r["rows"] and all(x["kind"] == "hallazgo" for x in r["rows"])
          and r["rows"][0]["t0"] >= r["rows"][-1]["t0"])
    check("la lista no lleva lo que solo usan el informe y el detalle",
          all(set((x.get("s") or {"sa": []})) == {"sa"} and "lists" not in x and "h" not in x for x in r["rows"]))
    r = client.get("/api/follow/episodes?days=14&kind=control").json()
    check("la lista del control", r["rows"] and all(x["kind"] == "control" for x in r["rows"]))
    r = client.get("/api/follow/episodes?days=14&lista=rapidos").json()
    check("la lista de una lista", [x["symbol"] for x in r["rows"]] == [FAST])
    r = client.get("/api/follow/episodes?days=14&startup=1").json()
    check("solo los del arranque", r["rows"] and all(x["startup"] for x in r["rows"]))
    check("kind invalido: 400", client.get("/api/follow/episodes?kind=otro").status_code == 400)
    check("lista invalida: 400", client.get("/api/follow/episodes?lista=mias").status_code == 400)
    check("startup invalido: 400", client.get("/api/follow/episodes?startup=2").status_code == 400)
    check("id invalido: 400", client.get("/api/follow/episode/H-1-BTC").status_code == 400)
    check("id que no existe: 404", client.get(f"/api/follow/episode/{sf.make_id('hallazgo', DAY0 - 5 * DAY, 'ZZZUSDT')}").status_code == 404)
    r = client.get(f"/api/follow/episode/{mover_id}").json()
    check("el detalle por la ruta", r["episode"]["id"] == mover_id and r["episode"]["series"]["c"])
    r = client.get("/api/follow/report?days=30").json()
    check("el informe por la ruta", r["success"] and r["report"]["blocks"])

with TestClient(main.app, base_url="http://127.0.0.1:13000") as client:
    check("la suite tiene las rutas del seguimiento", client.get("/api/follow/status").json()["success"])
    check("el estado de la suite trae el seguimiento", "follow" in client.get("/api/suite/status").json())
    check("apagado en las pruebas (SUITE_SWING=0)", client.get("/api/follow/status").json()["running"] is False)

source = Path(sf.__file__).read_text(encoding="utf-8").lower()
check("el modulo no tiene con que enviar al bot", "bot_url" not in source and "/api/bot" not in source and "_bot(" not in source)

# ==================== los elementos de App 1, sin futuro ====================
rng = np.random.default_rng(11)
k15, c = [], 50.0
start = DAY0 - 36 * DAY
for i in range(37 * 96):
    o_ = c
    c = o_ * (1 + rng.normal(0, 0.004) * (3 if rng.random() < 0.08 else 1))
    k15.append([start + i * 15 * MIN, o_, max(o_, c) * (1 + abs(rng.normal(0, 0.001))), min(o_, c) * (1 - abs(rng.normal(0, 0.001))),
                c, float(abs(rng.normal(1000, 300))), 0.0])
t0 = DAY0 + 20_000
sig = sf.app1_elements("TESTUSDT", k15, t0)
codes = set(sf.app1_codes())
check("los elementos de App 1 sobre velas de cualquier moneda", sig and all(s[0] in codes and s[1] in (15, 60) and s[3] in (1, -1)
                                                                            and -1440 <= s[2] <= 1440 for s in sig), sig[:3])
# 33 hasta el motor 7 de App 1 (25/11), que suma el esfuerzo con resultado (QV) y el medidor que gira (QG)
check("35 elementos de velas", len(codes) == 35 and {"QV", "QG"} <= codes, len(codes))
on_grid = all(abs(((t0 + s[2] * MIN) - DAY0) % (15 * MIN) - 0) <= 30_000 or abs(((t0 + s[2] * MIN) - DAY0) % (15 * MIN) - 15 * MIN) <= 30_000
              for s in sig)
check("cada uno en el cierre de su vela", on_grid)
cut = t0 + 6 * HOUR
short = [b for b in k15 if b[0] + 15 * MIN <= cut]
known = lambda items: sorted(tuple(s) for s in items if t0 + s[2] * MIN <= cut - MIN)   # noqa: E731
a, b2 = known(sf.app1_elements("TESTUSDT", short, t0)), known(sig)
check("lo que se conoce hasta una hora no cambia con las velas siguientes (sin futuro)", a == b2,
      f"{len(a)} contra {len(b2)}: {sorted(set(b2) ^ set(a))[:6]}")

shutil.rmtree(TMP, ignore_errors=True)
failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pasan")
sys.exit(1 if failed else 0)
