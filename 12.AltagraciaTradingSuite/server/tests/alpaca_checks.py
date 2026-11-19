# Pruebas sin conexion del conector de Alpaca (alpaca_data.py, 19/11/2026), con respuestas de Alpaca armadas a mano:
#   - horas de Alpaca (nanosegundos), horario de verano de Nueva York y sesion regular;
#   - lado del agresor: regla del tick, quote rule (quote estrictamente anterior) y Lee-Ready;
#   - condiciones del SIP que se sacan del order flow;
#   - footprints con la forma de App 1: niveles, delta, CVD, POC y lo sin clasificar mitad y mitad;
#   - bajada de un dia por paginas (trades y quotes), el corte de 15 minutos del SIP, reintento ante 429 y guardado;
#   - open interest: resumen, max pain, foto guardada y cambio contra la anterior;
#   - rutas: validan, no muestran las claves y piden bajar antes cuando faltan muchos dias.
# Uso, desde 12.AltagraciaTradingSuite\server:  C:\Python314\python.exe -B tests\alpaca_checks.py
import asyncio
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_alpaca_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_ORDERFLOW_DATA"] = str(TMP / "of")
os.environ["SUITE_ALPACA_KEY_ID"] = "PKTESTKEY"
os.environ["SUITE_ALPACA_SECRET_KEY"] = "SECRETTEST"
os.environ["SUITE_ALPACA_FEED"] = "sip"
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import httpx  # noqa: E402
import numpy as np  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import alpaca_data as A  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


async def _no_sleep(_s):
    return None


A.asyncio.sleep = _no_sleep     # los reintentos no esperan en las pruebas

# ---------- horas ----------
check("hora con nanosegundos", A.ts_us("2024-01-03T14:30:00.123456789Z") == 1704292200123456)
check("hora sin fraccion", A.ts_us("2024-01-03T14:30:00Z") == 1704292200000000)
check("hora con offset", A.ts_us("2024-01-03T09:30:00-05:00") == 1704292200000000)
s26, e26 = A.dst_bounds_ms(2026)
check("verano 2026 empieza el 8 de marzo 07:00 UTC", A.iso(s26).startswith("2026-03-08T07:00:00"))
check("verano 2026 termina el 1 de noviembre 06:00 UTC", A.iso(e26).startswith("2026-11-01T06:00:00"))
summer = A.day_ms("2026-07-15") + 13 * 3_600_000 + 30 * 60_000          # 09:30 EDT
winter = A.day_ms("2026-12-15") + 14 * 3_600_000 + 30 * 60_000          # 09:30 EST
m = A.session_mask(np.array([summer - 60_000, summer, winter - 60_000, winter,
                             A.day_ms("2026-07-15") + 20 * 3_600_000 - 1, A.day_ms("2026-07-15") + 20 * 3_600_000]), "rth")
check("sesion regular en verano e invierno", m.tolist() == [False, True, False, True, True, False], m.tolist())
sat = A.day_ms("2026-07-18") + 15 * 3_600_000                             # sabado
check("sabado fuera de la sesion regular", not A.session_mask(np.array([sat]), "rth")[0])
k = A.candle_keys(np.array([summer + 10 * 60_000, summer + 70 * 60_000]), 60, "rth")
check("velas de 1 h en rth desde las 09:30", k.tolist() == [summer, summer + 3_600_000], k.tolist())
k = A.candle_keys(np.array([summer + 5 * 60_000]), 1440, "all")
check("vela diaria desde la medianoche de Nueva York", k.tolist() == [A.day_ms("2026-07-15") + 4 * 3_600_000])

# ---------- lado del agresor ----------
tick = A.tick_rule(np.array([10.0, 10.0, 10.1, 10.1, 10.0, 10.0, 10.2]))
check("regla del tick", tick.tolist() == [0, 0, 1, 1, -1, -1, 1], tick.tolist())
qs = A.quote_side([100, 200, 300, 400, 50], [10.06, 10.0, 10.05, 10.01, 10.0],
                  [100, 250, 300], [10.0, 10.0, 0.0], [10.1, 10.1, 10.1])
# t=100: el quote de t=100 no vale (mismo instante) y no hay anterior -> 0; t=200: quote de 100, medio 10.05, bajo -> -1
# t=300: quote de 250, en el medio -> 0; t=400: quote de 300 sin bid -> 0; t=50: antes de todo -> 0
check("quote rule con el quote anterior", qs.tolist() == [0, -1, 0, 0, 0], qs.tolist())
qs = A.quote_side([200, 200], [10.08, 10.02], [100], [10.0], [10.1])
check("quote rule compra y venta", qs.tolist() == [1, -1], qs.tolist())
side = A.classify([1, 2, 3], [10.0, 10.1, 10.1], np.array([0, 0, -1], dtype=np.int8))
check("Lee-Ready: quote donde hay, tick donde no", side.tolist() == [0, 1, -1], side.tolist())

t, p, s = A._trade_rows([
    {"t": "2026-07-15T13:30:00Z", "p": 10, "s": 100, "c": ["@"]},
    {"t": "2026-07-15T13:30:01Z", "p": 10, "s": 100, "c": ["@", "W"]},
    {"t": "2026-07-15T13:30:02Z", "p": 10, "s": 5, "c": ["@", "I"]},
    {"t": "2026-07-15T13:30:03Z", "p": 10, "s": 100, "c": ["Z"]},
    {"t": "2026-07-15T13:30:04Z", "p": 10, "s": 0, "c": ["@"]},
])
check("condiciones: sale precio promedio y fuera de secuencia, queda odd lot", s == [100.0, 5.0], s)

# ---------- footprints ----------
T = summer
tt = np.array([T + 1000, T + 2000, T + 3000, T + 61_000, T + 62_000], dtype=np.int64) * 1000
pp = np.array([100.00, 100.02, 100.01, 100.05, 100.05])
ss = np.array([10.0, 20.0, 30.0, 40.0, 6.0])
sd = np.array([0, 1, -1, 1, -1], dtype=np.int8)
fp = A.build_footprints(tt, pp, ss, sd, 1, T, T + 120_000, step=0.02, rules={"ratio": 3.0})
f = fp["footprints"]
check("dos velas de 1 minuto", len(f) == 2, len(f))
c0 = f[0]
check("niveles sin huecos de 100.00 a 100.02", [round(x["price_min"], 2) for x in c0["levels"]] == [100.0, 100.02],
      [x["price_min"] for x in c0["levels"]])
check("lo sin clasificar va mitad y mitad", c0["levels"][0]["ask_volume"] == 5.0 and c0["levels"][0]["bid_volume"] == 35.0,
      c0["levels"][0])
check("delta de la vela", c0["delta"] == 5 + 20 - 5 - 30, c0["delta"])
check("OHLC de los trades", (c0["candle_open"], c0["candle_high"], c0["candle_low"], c0["candle_close"]) == (100.0, 100.02, 100.0, 100.01))
check("POC en el nivel de mas volumen", round(c0["poc_price"], 2) == 100.01, c0["poc_price"])
check("CVD acumulado", f[1]["cvd"] == c0["delta"] + 34, f[1]["cvd"])
check("forma de App 1", all(k in c0 for k in ("imbalances", "stacked_imbalances", "volume_zscore", "trade_count", "complete")))
auto = A.build_footprints(tt, pp, ss, sd, 1, T, T + 120_000)
check("step automatico redondo", auto["step_size"] in (0.002, 0.0025, 0.005), auto["step_size"])
check("sin trades: lista vacia", A.build_footprints(tt, pp, ss, sd, 1, T + 10**7, T + 10**7 + 1)["footprints"] == [])


# ---------- bajada con Alpaca de mentira ----------
DAY = "2026-07-15"
D0 = A.day_ms(DAY)
calls = []
fail_once = {"n": 0}


def q(ms, bid, ask):
    return {"t": A.iso(ms), "bp": bid, "ap": ask, "bs": 1, "as": 1}


def tr(ms, price, size, c=("@",)):
    return {"t": A.iso(ms), "p": price, "s": size, "c": list(c)}


T1 = D0 + 14 * 3_600_000
TRADES = [[tr(T1 + 1000, 10.08, 100), tr(T1 + 2000, 10.02, 50)],
          [tr(T1 + 5000, 10.20, 30), tr(T1 + 6000, 10.20, 10, ("W",))]]
QUOTES = [[q(T1, 10.0, 10.1), q(T1 + 1500, 10.0, 10.1)],
          [q(T1 + 4000, 10.1, 10.3)]]            # el trade de T1+5000 esta en el medio (10.2): regla del tick -> compra


def handler(request: httpx.Request):
    calls.append(request)
    path = request.url.path
    token = request.url.params.get("page_token")
    if "/trades" in path:
        if fail_once["n"] == 0:
            fail_once["n"] = 1
            return httpx.Response(429, headers={"Retry-After": "0"}, json={"message": "too many"})
        page = 1 if token == "t2" else 0
        return httpx.Response(200, json={"trades": TRADES[page], "next_page_token": "t2" if page == 0 else None})
    if "/quotes" in path:
        page = 1 if token == "q2" else 0
        return httpx.Response(200, json={"quotes": QUOTES[page], "next_page_token": "q2" if page == 0 else None})
    if "/options/contracts" in path:
        return httpx.Response(200, json={"option_contracts": OPTIONS["now"], "next_page_token": None})
    return httpx.Response(404, json={"message": "no"})


A.set_client(httpx.AsyncClient(transport=httpx.MockTransport(handler)))
NOW = D0 + 2 * 86_400_000
data = asyncio.run(A.get_day("AAPL", DAY, "lee_ready", NOW))
check("trades de dos paginas sin el de precio promedio", data["s"].tolist() == [100.0, 50.0, 30.0], data["s"].tolist())
check("lados con quotes de dos paginas", data["side"].tolist() == [1, -1, 1], data["side"].tolist())
check("reintento tras 429", fail_once["n"] == 1 and sum("/trades" in c.url.path for c in calls) == 3)
check("claves en las cabeceras", calls[0].headers.get("APCA-API-KEY-ID") == "PKTESTKEY")
check("pide el feed sip", calls[0].url.params.get("feed") == "sip")
check("dia completo guardado", A._day_path("AAPL", DAY, "lee_ready").exists())
n = len(calls)
again = asyncio.run(A.get_day("AAPL", DAY, "lee_ready", NOW))
check("segunda vez sale del disco sin pedir", len(calls) == n and again["side"].tolist() == [1, -1, 1])

calls.clear()
fail_once["n"] = 1
late = D0 + 10 * 3_600_000
part = asyncio.run(A.fetch_day("AAPL", DAY, "tick", late))
end_param = calls[0].url.params.get("end")
check("corte de 15 minutos del SIP", A.ts_us(end_param) // 1000 == late - A.SIP_DELAY_MS, end_param)
check("dia en curso no queda completo", part["complete"] is False)

# ---------- open interest ----------
OPTIONS = {"now": [
    {"type": "call", "strike_price": "100", "open_interest": "500", "expiration_date": "2026-08-21", "open_interest_date": "2026-07-16"},
    {"type": "call", "strike_price": "110", "open_interest": "300", "expiration_date": "2026-08-21", "open_interest_date": "2026-07-16"},
    {"type": "put", "strike_price": "90", "open_interest": "400", "expiration_date": "2026-08-21", "open_interest_date": "2026-07-16"},
    {"type": "put", "strike_price": "100", "open_interest": "200", "expiration_date": "2026-09-18", "open_interest_date": "2026-07-16"},
    {"type": "put", "strike_price": "100", "open_interest": None, "expiration_date": "2026-09-18"},
]}
sm = A.summarize_oi(OPTIONS["now"])
check("OI de calls y puts", (sm["call_oi"], sm["put_oi"]) == (800, 600), (sm["call_oi"], sm["put_oi"]))
check("put/call", sm["put_call_ratio"] == 0.75, sm["put_call_ratio"])
check("por strike", [(r["strike"], r["total"]) for r in sm["by_strike"]] == [(90.0, 400), (100.0, 700), (110.0, 300)])
check("por vencimiento", [r["expiration"] for r in sm["by_expiration"]] == ["2026-08-21", "2026-09-18"])
check("max pain", sm["max_pain"] == 100.0, sm["max_pain"])
from datetime import date as _date  # noqa: E402
calls.clear()
first = asyncio.run(A.options_oi("AAPL", None, None, today=_date(2026, 7, 16)))
oi_call = [c for c in calls if "/options/contracts" in c.url.path][0]
check("sin fecha final pide 60 dias de vencimientos", oi_call.url.params.get("expiration_date_lte") == "2026-09-14"
      and first["window_days"] == 60 and first["expiration_to"] == "2026-09-14", oi_call.url.params)
check("primera foto sin cambio", first["change"] is None and first["oi_date"] == "2026-07-16")
check("foto guardada con la ventana", (A._oi_dir("AAPL") / "2026-07-16_60d.json").exists())
OPTIONS["now"] = [dict(c, open_interest_date="2026-07-17") for c in OPTIONS["now"]]
OPTIONS["now"][0]["open_interest"] = "650"
second = asyncio.run(A.options_oi("AAPL", None, None, today=_date(2026, 7, 17)))
check("cambio contra la foto anterior", second["change"] and second["change"]["call_oi"] == 150
      and second["change"]["since"] == "2026-07-16", second["change"] and second["change"]["call_oi"])
chg100 = [r for r in second["change"]["by_strike"] if r["strike"] == 100.0][0]
check("cambio por strike", chg100["call_oi"] == 150 and chg100["put_oi"] == 0, chg100)
calls.clear()
third = asyncio.run(A.options_oi("AAPL", "2026-08-01", "2026-12-31"))
p = [c for c in calls if "/options/contracts" in c.url.path][0].url.params
check("rango pedido se respeta", p.get("expiration_date_gte") == "2026-08-01" and p.get("expiration_date_lte") == "2026-12-31"
      and third["window_days"] is None and third["change"] is None, dict(p))
# ---------- rutas ----------
app = FastAPI()
app.include_router(A.make_router())
client = TestClient(app)
r = client.get("/api/alpaca/status")
check("estado configurado", r.status_code == 200 and r.json()["configured"] is True)
check("estado sin las claves", "PKTESTKEY" not in r.text and "SECRETTEST" not in r.text)
check("dias guardados en el estado", DAY + "_lee_ready" in r.json()["cached"].get("AAPL", []), r.json()["cached"])
check("simbolo invalido", client.get("/api/alpaca/footprints/aapl$").status_code in (400, 404))
check("simbolo con punto vale", A._symbol("brk.b") == "BRK.B")
check("metodo invalido", client.get("/api/alpaca/footprints/AAPL?method=x").status_code == 400)
check("sesion invalida", client.get("/api/alpaca/footprints/AAPL?session=x").status_code == 400)
check("fecha invalida", client.get("/api/alpaca/options/oi/AAPL?expiration_from=2026-13-01").status_code == 400)
check("dias del OI fuera de rango", client.get("/api/alpaca/options/oi/AAPL?days=0").status_code == 400
      and client.get("/api/alpaca/options/oi/AAPL?days=5000").status_code == 400)
start = A.day_ms("2026-06-01")
r = client.get(f"/api/alpaca/footprints/AAPL?interval=5&start_timestamp={start}&end_timestamp={start + 10 * 86_400_000}")
check("muchos dias sin bajar piden la bajada", r.status_code == 409 and "download" in r.text, r.text[:200])
r = client.get(f"/api/alpaca/footprints/AAPL?interval=1&start_timestamp={D0}&end_timestamp={D0 + 86_400_000}")
check("footprints del dia guardado", r.status_code == 200 and r.json()["count"] == 1
      and r.json()["footprints"][0]["trade_count"] == 3 and r.json()["footprints"][0]["delta"] == 100 - 50 + 30,
      r.text[:200])
check("rango demasiado largo", client.post("/api/alpaca/download?symbol=AAPL&start=2026-01-01&end=2026-03-01").status_code == 400)

os.environ.pop("SUITE_ALPACA_KEY_ID")
A.CONFIG["alpaca_key_id"] = ""
check("sin claves no baja", client.post("/api/alpaca/download?symbol=AAPL&start=2026-07-01&end=2026-07-02").status_code == 503)

shutil.rmtree(TMP, ignore_errors=True)
bad = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(bad)}/{len(results)} pruebas pasan")
sys.exit(1 if bad else 0)
