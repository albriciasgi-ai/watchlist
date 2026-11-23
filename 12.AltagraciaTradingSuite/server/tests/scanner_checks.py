# Pruebas sin conexion del scanner de monedas (22/11/2026, docs/PLAN_SCANNER.md, paso 1):
#   - lectura de instrumentos, tickers, velas y anuncios de cierre de Bybit;
#   - volumen relativo contra dias del mismo tipo, ATR, correlacion y beta, costo con un libro conocido y en R;
#   - candidatas por liquidez y grupo, listas con su regla, la lista rapida y la histeresis;
#   - registro de cada vuelta (gzip, tambien con un final cortado), eventos, liquidez de la suite y el candado;
#   - configuracion validada y rutas. Bybit y el bot nunca se consultan.
# Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B tests\scanner_checks.py
import asyncio
import json
import math
import os
import random
import shutil
import sys
import tempfile
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

TMP = Path(tempfile.mkdtemp(prefix="suite_scanner_"))
os.environ["SUITE_DATA_DIR"] = str(TMP / "data")
os.environ["SUITE_RECORD"] = "0"
os.environ["SUITE_OFFICIAL"] = "0"
os.environ["SUITE_SWING"] = "0"   # tambien apaga el scanner (SUITE_SCANNER sigue a SUITE_SWING)
os.environ["SUITE_BOT_URL"] = "http://127.0.0.1:9"  # nadie escucha: el bot real nunca recibe nada
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import main  # noqa: E402
import scanner as sc  # noqa: E402

results = []


def check(name, cond, detail=""):
    results.append((name, bool(cond)))
    print(("PASA  " if cond else "FALLA ") + name + (f"  [{detail}]" if detail and not cond else ""))


BAR = sc.BAR_MS
NOW = int(datetime(2026, 11, 18, 12, 0, 20, tzinfo=timezone.utc).timestamp() * 1000)   # miercoles, 20 s tras un cierre
LAST = NOW // BAR * BAR - BAR    # inicio de la ultima vela de 15 min cerrada (11:45)


class Clock:
    def __init__(self, t):
        self.t = t

    def now(self):
        return self.t


def make_bars(count, base_q, price0, seed, spike_last=0, spike_mult=1.0, drift=0.0, noise=0.002):
    """Velas de 15 min en el formato de Bybit ([inicio, apertura, maximo, minimo, cierre, volumen, turnover]), en orden,
    mas la vela en curso al final (no esta cerrada y el scanner la deja fuera)."""
    rng = random.Random(seed)
    rows, price = [], price0
    start = LAST - (count - 1) * BAR
    for i in range(count + 1):
        t = start + i * BAR
        o = price
        c = o * (1 + drift + rng.gauss(0, noise))
        h = max(o, c) * (1 + abs(rng.gauss(0, noise / 2)))
        lo = min(o, c) * (1 - abs(rng.gauss(0, noise / 2)))
        q = base_q * (1 + rng.uniform(-0.1, 0.1))
        if count - spike_last <= i < count:
            q *= spike_mult
        rows.append([t, o, h, lo, c, q / c, q])
        price = c
    return rows


def instrument(sym, symbol_type="", tags=None, launch_days=900, quote="USDT", kind="LinearPerpetual"):
    return {"symbol": sym, "contractType": kind, "quoteCoin": quote, "status": "Trading", "symbolType": symbol_type,
            "tags": tags or [], "launchTime": str(NOW - launch_days * 86_400_000), "fundingInterval": 480,
            "priceFilter": {"tickSize": "0.01"}, "leverageFilter": {"maxLeverage": "50"},
            "lotSizeFilter": {"minNotionalValue": "5"}}


INSTRUMENTS = [
    instrument("BTCUSDT"), instrument("AAAUSDT"), instrument("BBBUSDT"), instrument("THINUSDT"),
    instrument("STTUSDT", tags=["ST"]), instrument("STKUSDT", symbol_type="stock"), instrument("LOWUSDT"),
    instrument("NEWUSDT", symbol_type="innovation", launch_days=10), instrument("CCCUSDT"), instrument("TRDUSDT"),
    instrument("BTCPERP", quote="USDC"), instrument("BTCUSDT-26DEC26", kind="LinearFutures"),
]
KLINES = {
    "BTCUSDT": make_bars(3000, 4_000_000, 60_000, 1),
    "AAAUSDT": make_bars(3000, 200_000, 2.0, 2, spike_last=96, spike_mult=3.0, drift=0.0006),
    "BBBUSDT": make_bars(3000, 150_000, 5.0, 3),
    "THINUSDT": make_bars(3000, 60_000, 1.0, 4, spike_last=96, spike_mult=3.0),
    "STTUSDT": make_bars(3000, 90_000, 0.5, 5, spike_last=96, spike_mult=4.0),
    "STKUSDT": make_bars(3000, 300_000, 100.0, 6, spike_last=96, spike_mult=3.0),
    "LOWUSDT": make_bars(3000, 5_000, 0.2, 7),
    "NEWUSDT": make_bars(960, 120_000, 0.05, 8, spike_last=96, spike_mult=2.5),
    "CCCUSDT": make_bars(3000, 100_000, 8.0, 10),
    "TRDUSDT": make_bars(3000, 80_000, 3.0, 11, drift=0.0008, noise=0.0015),   # sube sostenida, sin volumen de mas
}
TURNOVER = {"BTCUSDT": 1e9, "AAAUSDT": 50e6, "BBBUSDT": 20e6, "THINUSDT": 10e6, "STTUSDT": 30e6, "STKUSDT": 40e6,
            "LOWUSDT": 1e6, "NEWUSDT": 12e6, "CCCUSDT": 15e6, "TRDUSDT": 8e6}
OI0 = {s: 1_000_000.0 for s in KLINES}


def last_close(sym):
    return KLINES[sym][-2][4]


def tickers():
    out = []
    for sym in KLINES:
        p = last_close(sym)
        half = 0.0007 if sym == "NEWUSDT" else 0.00005   # NEW: 14 bps de spread en el ticker y un libro que alcanza
        out.append({"symbol": sym, "lastPrice": str(p), "bid1Price": str(p * (1 - half)), "ask1Price": str(p * (1 + half)),
                    "turnover24h": str(TURNOVER[sym]), "openInterest": str(OI0[sym] * (1.2 if sym == "AAAUSDT" else 1.0)),
                    "openInterestValue": str(OI0[sym] * p), "fundingRate": "0.0001", "fundingIntervalHour": "8",
                    "prevPrice1h": str(p), "prevPrice24h": str(p), "price24hPcnt": "0.01"})
    out.append({"symbol": "BTCPERP", "lastPrice": "60000", "turnover24h": "1"})   # USDC: queda fuera
    return out


def book(sym):
    p = last_close(sym)
    usd = 10 if sym == "THINUSDT" else 5000     # THIN: 50 niveles de 10 USD no alcanzan para 1,000 USDT
    asks = [[str(p * (1 + 0.00005 + i * 0.0005)), str(usd / p)] for i in range(50)]
    bids = [[str(p * (1 - 0.00005 - i * 0.0005)), str(usd / p)] for i in range(50)]
    return {"a": asks, "b": bids}


DAILY = [[(NOW // 86_400_000 - (400 - i)) * 86_400_000, 60000, 61000, 59000, 60000, 1, 60000] for i in range(400)]
ANNOUNCEMENTS = [{"title": "Delisting of BBBUSDT Perpetual Contract", "url": "https://example.invalid/a",
                  "dateTimestamp": NOW - 86_400_000},
                 {"title": "Delisting of OLDUSDT Perpetual Contract", "dateTimestamp": NOW - 90 * 86_400_000}]


class FakeBybit:
    def __init__(self):
        self.calls = []

    async def fetch(self, path, params):
        self.calls.append((path, dict(params)))
        if path == "/v5/market/instruments-info":
            return {"list": INSTRUMENTS, "nextPageCursor": ""}
        if path == "/v5/market/tickers":
            return {"list": tickers()}
        if path == "/v5/market/kline":
            if params["interval"] == "D":
                return {"list": [[str(x) for x in r] for r in reversed(DAILY)]}
            rows = [r for r in KLINES[params["symbol"]] if r[0] <= params.get("end", 10 ** 15)][-int(params["limit"]):]
            return {"list": [[str(x) for x in r] for r in reversed(rows)]}
        if path == "/v5/market/open-interest":
            sym = params["symbol"]
            grow = 0.2 if sym == "AAAUSDT" else 0.0
            pts = [{"openInterest": str(OI0[sym] * (1 + grow * (i / 99))), "timestamp": str(LAST - (99 - i) * BAR)} for i in range(100)]
            return {"list": list(reversed(pts))}
        if path == "/v5/market/orderbook":
            return book(params["symbol"])
        if path == "/v5/announcements/index":
            return {"list": ANNOUNCEMENTS}
        raise AssertionError(f"pedido inesperado: {path}")


def bars_of(rows):
    return sc.parse_klines([[str(x) for x in r] for r in reversed(rows)], NOW)


try:
    # --- lectura de Bybit ---
    inst = sc.parse_instruments(INSTRUMENTS)
    check("instrumentos: solo perpetuos USDT que cotizan", set(inst) == set(KLINES), sorted(inst))
    check("grupos de Bybit: acción, innovación y cripto", inst["STKUSDT"]["group"] == "acciones" and inst["NEWUSDT"]["group"] == "innovacion"
          and inst["AAAUSDT"]["group"] == "cripto")
    check("etiqueta ST", inst["STTUSDT"]["st"] and not inst["AAAUSDT"]["st"])
    check("monedas de una letra (HUSDT)", "HUSDT" in sc.parse_instruments([instrument("HUSDT")]))
    t = sc.parse_ticker(tickers()[1], inst["AAAUSDT"])
    check("ticker: spread en bps", abs(t["spread_bps"] - 1.0) < 1e-6, t["spread_bps"])
    check("ticker: intervalo del funding del instrumento", t["funding_min"] == 480)
    bars = bars_of(KLINES["AAAUSDT"])
    check("velas: la vela en curso queda fuera", len(bars) == 3000 and bars[-1]["t"] == LAST, (len(bars), bars[-1]["t"] - LAST))
    check("velas: turnover de Bybit", abs(bars[-1]["q"] - KLINES["AAAUSDT"][-2][6]) < 1e-6)
    merged = sc.merge_bars(bars[:-5], bars[-10:])
    check("velas: unir sin repetir", len(merged) == 3000 and merged == bars)
    store = sc.BarStore(bars)
    check("velas en arreglos: las mismas al volver a diccionarios", len(store) == 3000 and store.dicts() == bars
          and store.last_t() == LAST and not sc.BarStore())
    deli = sc.parse_delistings(ANNOUNCEMENTS, NOW)
    check("anuncios: el perpetuo del título, solo los recientes", set(deli) == {"BBBUSDT"}, deli)

    # --- volumen relativo por tipo de dia ---
    sunday = int(datetime(2026, 11, 22, 12, 0, tzinfo=timezone.utc).timestamp() * 1000)
    flat = []
    for i in range(3000):
        tt = sunday - (2999 - i) * BAR
        q = 50.0 if sc.is_weekend(tt) else 100.0
        flat.append({"t": tt, "o": 1, "h": 1, "l": 1, "c": 1, "q": q})
    value, how, count = sc.rvol(flat, 4)
    check("volumen relativo de un domingo contra domingos y sábados", how == "tipo" and abs(value - 1.0) < 1e-9 and count >= 8, (value, how, count))
    every = [w for w in [sum(x["q"] for x in flat[len(flat) - 1 - k * 96 - 3:len(flat) - k * 96]) for k in range(1, 31)]]
    check("contra todos los días daría la mitad", abs(4 * 50 / sorted(every)[15] - 0.5) < 1e-9)
    spike = [dict(x) for x in flat]
    for x in spike[-4:]:
        x["q"] *= 3
    check("la última hora con el triple de volumen", abs(sc.rvol(spike, 4)[0] - 3.0) < 1e-9)
    check("sin historia no hay volumen relativo", sc.rvol(flat[-200:], 96) == (None, None, 0))

    # --- ATR, eficiencia, correlacion y beta ---
    same = [{"t": LAST - (99 - i) * BAR, "o": 100, "h": 101, "l": 99, "c": 100, "q": 1} for i in range(100)]
    hourly = sc.aggregate(same, 60)
    check("velas de 1 h completas y alineadas", all(h["n"] == 4 and h["t"] % sc.HOUR_MS == 0 for h in hourly))
    check("ATR de 1 h en %", abs(sc.atr_pct(hourly) - 0.02) < 1e-12, sc.atr_pct(hourly))
    line = [{"t": i * sc.HOUR_MS, "o": 100 + i, "h": 100 + i, "l": 100 + i, "c": 100 + i} for i in range(200)]
    check("eficiencia de una línea recta", abs(sc.efficiency(line, 168) - 1.0) < 1e-12)
    rng = random.Random(9)
    rb = {i * sc.HOUR_MS: rng.gauss(0, 0.01) for i in range(800)}
    ra = {t: 2 * r for t, r in rb.items()}
    c, b = sc.corr_beta(ra, rb, 720, 200)
    check("correlación 1 y beta 2", abs(c - 1) < 1e-9 and abs(b - 2) < 1e-9, (c, b))

    # --- costo con un libro conocido ---
    bids = [(99.9, 5.0), (99.8, 10.0)]
    asks = [(100.1, 5.0), (100.2, 10.0)]
    cost = sc.book_cost(bids, asks, 1000)
    vwap_buy = 1000 / (5 + (1000 - 100.1 * 5) / 100.2)
    check("deslizamiento de compra desde el medio", abs(cost["buy_bps"] - (vwap_buy - 100) / 100 * 1e4) < 1e-9, cost)
    check("spread del libro", abs(cost["spread_bps"] - 20) < 1e-9)
    check("un libro que no alcanza da None", sc.book_cost(bids, asks, 10_000)["buy_bps"] is None)
    cfg = json.loads(json.dumps(sc.DEFAULT_CONFIG))
    m = {"atr_1h": 0.01, "atr_4h": 0.02, "spread_bps": 4.0}
    sc.apply_costs(m, {"at": NOW, "size": cfg["size_usdt"], "buy_bps": 10.0, "sell_bps": 10.0}, cfg, NOW)
    check("ida y vuelta: comisión taker más deslizamiento", abs(m["cost_rt_bps"] - 31) < 1e-9 and not m["cost_estimated"], m["cost_rt_bps"])
    check("costo en R de 1 ATR de 1 h y 1.5 ATR de 4 h", abs(m["cost_r_1h"] - 0.31) < 1e-9 and abs(m["cost_r_4h"] - 31 / 300) < 1e-9)
    check("con entrada limit: maker a la entrada", abs(m["cost_limit_bps"] - (2 + 5.5 + 10)) < 1e-9)
    check("libro suficiente con 20 bps", m["book_ok"])
    sc.apply_costs(m, {"at": NOW, "size": 50_000, "buy_bps": 1.0, "sell_bps": 1.0}, cfg, NOW)
    check("un libro de otro tamaño no cuenta: se estima con el spread", m["cost_estimated"] and abs(m["cost_rt_bps"] - 15) < 1e-9)
    sc.apply_costs(m, {"at": NOW - 20 * 60_000, "size": cfg["size_usdt"], "buy_bps": 1.0, "sell_bps": 1.0}, cfg, NOW)
    check("un libro viejo no cuenta", m["cost_estimated"])

    # --- bolsa de Nueva York ---
    mon = lambda h, mi=0: int(datetime(2026, 11, 23, h, mi, tzinfo=timezone.utc).timestamp() * 1000)  # noqa: E731
    check("bolsa abierta el lunes a las 10:00 de Nueva York", sc.us_market_open(mon(15)))
    check("cerrada antes de las 9:30", not sc.us_market_open(mon(14, 20)))
    check("cerrada el domingo", not sc.us_market_open(sunday))
    july = int(datetime(2026, 7, 6, 13, 45, tzinfo=timezone.utc).timestamp() * 1000)   # lunes de verano: 9:45 en Nueva York
    check("en verano abre a las 13:30 UTC", sc.us_market_open(july))

    # --- configuracion ---
    good = sc.clean_config({"size_usdt": 500, "groups": ["cripto", "acciones"], "fast": {"a_min": 3}}, cfg)
    check("configuración: cambia solo lo que viene", good["size_usdt"] == 500 and good["groups"] == ["cripto", "acciones"]
          and good["fast"]["a_min"] == 3 and good["fast"]["b_min"] == 15 and good["floor_usd"] == cfg["floor_usd"])
    for bad in ({"size_usdt": 0}, {"groups": ["nada"]}, {"groups": []}, {"enabled": "si"}, {"otra": 1},
                {"fast": {"a_min": 99}}, {"fast": {"x": 1}}, {"hold_min": 1.5}):
        try:
            sc.clean_config(bad, cfg)
            check(f"configuración inválida rechazada: {bad}", False)
        except ValueError:
            check(f"configuración inválida rechazada: {bad}", True)

    # --- el scanner completo con un Bybit falso ---
    clock = Clock(NOW)
    fake = FakeBybit()
    folder = TMP / "scan"
    scn = sc.Scanner(folder, symbols_source=lambda: ["BTCUSDT", "LOWUSDT"], fetch=fake.fetch, now=clock.now, start_delay=0)
    # La suite tuvo LOW bajo el piso los 7 dias anteriores
    scn.liq_days = {f"2026-11-{d:02d}": {"LOWUSDT": 900_000} for d in range(11, 18)}
    asyncio.run(scn.refresh_meta())
    asyncio.run(scn.refresh_tickers())
    check("universo: los perpetuos USDT del ticker", set(scn.tickers) == set(KLINES), sorted(scn.tickers))
    check("candidatas: piso de liquidez, grupos y siempre las de la suite",
          set(scn.candidates) == {"BTCUSDT", "AAAUSDT", "BBBUSDT", "THINUSDT", "NEWUSDT", "LOWUSDT", "CCCUSDT", "TRDUSDT"},
          scn.candidates)
    asyncio.run(scn.refresh_btc_daily())
    asyncio.run(scn.run_cycle())
    check("la vuelta carga las candidatas", all(s in scn.bars for s in scn.candidates) and scn.cycle["loaded"] == len(scn.candidates), scn.cycle)
    kline_calls = [c for c in fake.calls if c[0] == "/v5/market/kline" and c[1]["interval"] == "15"]
    check("tres páginas de velas por moneda la primera vez", len(kline_calls) == 3 * len(scn.candidates) - 2, len(kline_calls))
    mA, mB = scn.metrics["AAAUSDT"], scn.metrics["BBBUSDT"]
    check("volumen relativo de 24 h: triple contra normal", 2.6 < mA["rvol_24h"] < 3.4 and 0.85 < mB["rvol_24h"] < 1.15,
          (mA["rvol_24h"], mB["rvol_24h"]))
    check("volumen relativo contra días del mismo tipo", mA["rvol_base"] == "tipo")
    check("OI de 24 h", abs(mA["oi_24h"] - 0.2) < 0.02, mA["oi_24h"])
    check("cuadrante precio-OI", mA["oi_quadrant"] is not None and "entran largos" in mA["oi_quadrant"], (mA["ret_24h"], mA["oi_quadrant"]))
    check("BTC: movimiento propio cero", abs(scn.metrics["BTCUSDT"]["resid_24h"]) < 1e-12)
    check("funding en una misma base", abs(mA["funding_8h"] - 0.0001) < 1e-12 and abs(mA["funding_day"] - 0.0003) < 1e-12)
    check("una nueva con pocas velas avisa", any(f["code"] == "historia" for f in sc.flags_of(scn.metrics["NEWUSDT"], scn.config)))
    check("BBB marcada con su anuncio de cierre", any(f["code"] == "cierre" for f in sc.flags_of(mB, scn.config)))
    check("LOW: una semana bajo el piso", scn.metrics["LOWUSDT"]["low_week"])
    check("sin libro todavía, el costo se estima (una que no cumple ninguna regla)", mB["cost_estimated"] and mB["book_ok"],
          (mB["cost_estimated"], mB["book_ok"]))
    first_books = [c[1]["symbol"] for c in fake.calls if c[0] == "/v5/market/orderbook"]
    check("la vuelta mide el libro de las que cumplen una regla, y entran en esa misma vuelta",
          not mA["cost_estimated"] and "AAAUSDT" in scn.order["enjuego"] and "AAAUSDT" in first_books
          and "BBBUSDT" not in first_books and scn.book_extra and scn.book_round is None, (first_books, scn.book_extra))
    check("también la de 14 bps de spread en el ticker (el estimado la descartaba): su libro alcanza y entra",
          "NEWUSDT" in first_books and "NEWUSDT" in scn.order["enjuego"], (first_books, scn.order["enjuego"]))
    asyncio.run(scn.refresh_books())
    mA, mT = scn.metrics["AAAUSDT"], scn.metrics["THINUSDT"]
    check("con el libro, costo medido", not mA["cost_estimated"] and mA["book_ok"] and abs(mA["cost_rt_bps"] - 12.0) < 0.01, mA["cost_rt_bps"])
    thin_books = [c for c in fake.calls if c[0] == "/v5/market/orderbook" and c[1]["symbol"] == "THINUSDT"]
    check("libro que no alcanza: se vuelve a pedir con 500 niveles", [c[1]["limit"] for c in thin_books] == [50, 500])
    check("THIN: libro que no alcanza y bandera", mT["book_reach"] is False and not mT["book_ok"]
          and any(f["code"] == "libro" for f in sc.flags_of(mT, scn.config)))
    order = scn.order["enjuego"]
    check("en juego: la del volumen y libro suficiente", "AAAUSDT" in order and "NEWUSDT" in order, order)
    check("en juego: fuera la normal, la del libro fino, la ST y la acción",
          not {"BBBUSDT", "THINUSDT", "STTUSDT", "STKUSDT"} & set(order), order)
    check("en juego: ordena por volumen relativo", order.index("AAAUSDT") < order.index("NEWUSDT"), order)
    check("en juego: fuera las de volumen normal aunque suban", not {"CCCUSDT", "TRDUSDT"} & set(order), order)
    check("tendencia: la que sube sostenida y rompe su máximo de 20 días", "TRDUSDT" in scn.order["tendencia"]
          and scn.row("TRDUSDT", "tendencia")["chips"][0]["text"] == "máx. 20 d", (scn.order["tendencia"], scn.metrics["TRDUSDT"]["er_7d"]))
    check("mis monedas: las de la suite, de más a menos turnover", scn.order["mias"] == ["BTCUSDT", "LOWUSDT"])
    ev = [e for e in scn.events if e["list"] == "enjuego" and e["symbol"] == "AAAUSDT"]
    check("evento de entrada con su porqué", len(ev) == 1 and ev[0]["type"] == "entra" and any("vol ×" in c for c in ev[0]["chips"]), ev)
    row = scn.row("AAAUSDT", "enjuego")
    check("la fila trae chips, banderas y la entrada", row["chips"] and row["member"]["since"] == NOW and row["flags"] == [])
    check("el costo en R entre los chips", any(c["text"].endswith(" R") for c in row["chips"]), row["chips"])
    clock.t = NOW + 10_000
    check("entre dos revisiones no parece que sale", scn.row("AAAUSDT", "enjuego")["member"]["grace"] is False)
    clock.t = NOW
    mk = scn.market
    check("estado del mercado", mk and mk["coins"] >= 4 and mk["session"] and mk["reading"] in ("en bloque", "cada una por su lado", "mixto"), mk)
    check("BTC: ATR diario contra su año", mk["btc"]["atr_d_pctile_1y"] is not None)

    thin_out = [e for e in scn.events if e["symbol"] == "THINUSDT" and e["list"] == "enjuego"]
    check("THIN nunca entra: sin libro medido no se entra, y el suyo no alcanza", thin_out == [], thin_out)
    # Una que ya está y cuyo libro se vuelve fino sale en el acto, sin esperar la hora
    scn.books["AAAUSDT"] = {**scn.books["AAAUSDT"], "buy_bps": 40.0}
    sc.apply_costs(scn.metrics["AAAUSDT"], scn.books["AAAUSDT"], scn.config, NOW)
    scn._evaluate(NOW)
    check("libro que se vuelve fino: sale en el acto", "AAAUSDT" not in scn.order["enjuego"] and scn.events[-1]["type"] == "sale")
    scn.books["AAAUSDT"] = {**scn.books["AAAUSDT"], "buy_bps": 0.5}
    sc.apply_costs(scn.metrics["AAAUSDT"], scn.books["AAAUSDT"], scn.config, NOW)
    scn._evaluate(NOW)
    check("y vuelve cuando el libro alcanza", "AAAUSDT" in scn.order["enjuego"])

    # --- histeresis ---
    scn.metrics["AAAUSDT"]["rvol_24h"] = scn.metrics["AAAUSDT"]["rvol_1h"] = 1.0
    clock.t = NOW + 30 * 60_000
    scn._evaluate(clock.t)
    check("deja de cumplir: sigue en la lista una hora, marcada", "AAAUSDT" in scn.order["enjuego"]
          and scn.row("AAAUSDT", "enjuego")["member"]["grace"] is True)
    check("mientras tanto va después de las que cumplen", scn.order["enjuego"][-1] == "AAAUSDT", scn.order["enjuego"])
    clock.t = NOW + 61 * 60_000
    scn._evaluate(clock.t)
    check("después de una hora sale, con su evento", "AAAUSDT" not in scn.order["enjuego"]
          and scn.events[-1]["type"] == "sale" and scn.events[-1]["symbol"] == "AAAUSDT", list(scn.events)[-1])
    clock.t = NOW

    # --- lista rapida ---
    price0 = scn.tickers["BBBUSDT"]["price"] / 1.02
    oi0 = scn.tickers["BBBUSDT"]["oi"] / 1.05
    scn.snaps = deque([(NOW - 5 * 60_000, {"BBBUSDT": (price0, oi0), "AAAUSDT": (scn.tickers["AAAUSDT"]["price"], scn.tickers["AAAUSDT"]["oi"])})])
    hits = sc.fast_hits(scn.snaps, scn.tickers, {"BBBUSDT", "AAAUSDT"}, scn.config, NOW)
    check("rápidos: +2% y OI +5% en 5 min", set(hits) == {"BBBUSDT"} and hits["BBBUSDT"]["rule"] == "A", hits)
    scn._evaluate(NOW)
    check("rápidos: en la lista con su porqué", scn.order["rapidos"] == ["BBBUSDT"]
          and scn.row("BBBUSDT", "rapidos")["chips"][0]["text"].startswith("+2.0% en 5 min"), scn.row("BBBUSDT", "rapidos")["chips"])
    check("rápidos: la acción no entra aunque se mueva", "STKUSDT" not in sc.fast_hits(scn.snaps, scn.tickers, {"BBBUSDT"}, scn.config, NOW))

    # --- registro ---
    logs = sorted((folder / "log").glob("*.jsonl.gz"))
    lines = sc.Scanner.read_log(logs[0]) if logs else []
    check("registro de la vuelta, legible", len(lines) == 1 and "AAAUSDT" in lines[0]["rows"]
          and len(lines[0]["rows"]["AAAUSDT"]) == len(lines[0]["fields"]), [p.name for p in logs])
    check("el registro de la primera vuelta ya trae la lista (con los libros medidos)",
          lines and "AAAUSDT" in lines[0]["lists"]["enjuego"], lines[0]["lists"] if lines else None)
    clock.t = NOW + 15 * 60_000
    asyncio.run(scn.run_cycle())
    with open(logs[0], "ab") as fh:
        fh.write(b"\x1f\x8b\x08\x00cortado")   # un final cortado: el PC se apago al escribir
    lines = sc.Scanner.read_log(logs[0])
    check("registro: dos vueltas y un final cortado se ignora", len(lines) == 2, len(lines))
    incr = [c for c in fake.calls if c[0] == "/v5/market/kline" and c[1]["interval"] == "15" and c[1]["limit"] != 1000]
    check("la vuelta siguiente pide solo las velas nuevas", incr and all(c[1]["limit"] <= 10 for c in incr), [c[1]["limit"] for c in incr][:5])
    check("eventos en disco", sorted((folder / "events").glob("*.jsonl")))

    # --- el libro se mide primero para las que cumplen la regla de una lista ---
    saved_top = sc.BOOK_TOP
    sc.BOOK_TOP = 1
    for name in ("enjuego", "tendencia", "rapidos"):
        scn.order[name] = []
    scn.wanting = {"TRDUSDT"}
    n0 = len(fake.calls)
    asyncio.run(scn.refresh_books())
    asked = [c[1]["symbol"] for c in fake.calls[n0:] if c[0] == "/v5/market/orderbook"]
    check("con un solo libro, el de la que cumple una regla", asked == ["TRDUSDT"], asked)
    # Las listas llenas ya no dejan fuera a la que llega (el 23/11, con 40 libros para todo y las listas con más de 40
    # monedas, ninguna nueva se medía: ACE, con volumen x147, quedó fuera de En juego)
    def full_lists():   # dos en las listas (más que el tope de 1) y una que llega a cumplir una regla
        scn.order.update({"enjuego": ["AAAUSDT", "NEWUSDT"], "tendencia": [], "rapidos": []})
        scn.wanting = {"CCCUSDT"}

    full_lists()
    clock.t += 2 * 60_000
    n0 = len(fake.calls)
    asyncio.run(scn.refresh_books())
    asked = [c[1]["symbol"] for c in fake.calls[n0:] if c[0] == "/v5/market/orderbook"]
    check("listas llenas: también se mide la que llega a cumplir una regla", sorted(asked) == ["AAAUSDT", "CCCUSDT", "NEWUSDT"], asked)
    full_lists()   # la vuelta anterior las reordena al terminar
    n0 = len(fake.calls)
    asyncio.run(scn.refresh_books())
    check("un libro de hace menos de un minuto no se vuelve a pedir",
          not [c for c in fake.calls[n0:] if c[0] == "/v5/market/orderbook"], fake.calls[n0:])
    sc.BOOK_TOP = saved_top

    # --- un solo proceso por carpeta ---
    other = sc.Scanner(folder, fetch=fake.fetch, now=clock.now, start_delay=0)
    took = scn._take_lock()
    check("el candado lo toma uno solo", took and not other._take_lock())
    scn._release_lock()
    check("y se libera", other._take_lock())
    other._release_lock()

    # --- un reinicio no vacía las listas ni anota entradas de las que ya estaban (23/11) ---
    sfold = TMP / "estado"
    sclock = Clock(NOW)
    sfake = FakeBybit()

    def started(t):
        sclock.t = t
        return sc.Scanner(sfold, symbols_source=lambda: ["BTCUSDT"], fetch=sfake.fetch, now=sclock.now, start_delay=0)

    def disk_events():
        out = []
        for p in sorted((sfold / "events").glob("*.jsonl")):
            out += [json.loads(x) for x in p.read_text(encoding="utf-8").splitlines() if x.strip()]
        return out

    def state():
        return json.loads((sfold / "state.json").read_text(encoding="utf-8"))

    s1 = started(NOW)
    check("estado: sin archivo, arranca vacío", s1._hold_lock() and s1.restored is None and not any(s1.members.values()))
    for step in (s1.refresh_meta, s1.refresh_tickers, s1.refresh_btc_daily, s1.run_cycle):
        asyncio.run(step())
    st = state()
    check("estado: se guarda con las listas, su orden y los libros", "AAAUSDT" in st["members"]["enjuego"]
          and "AAAUSDT" in st["books"] and st["order"]["enjuego"] == s1.order["enjuego"], (st["members"], list(st["books"])))
    since = s1.members["enjuego"]["AAAUSDT"]["since"]
    entries1 = sum(1 for e in disk_events() if e["type"] == "entra")
    raw = (sfold / "state.json").read_bytes()
    intruder = started(NOW + 60_000)
    intruder._evaluate(NOW + 60_000)
    check("estado: un proceso sin el candado no lo pisa", (sfold / "state.json").read_bytes() == raw)
    s1._release_lock()

    s2 = started(NOW + 2 * 60_000)   # reiniciado dos minutos después
    check("estado: antes de tomar el candado no se lee", not any(s2.members.values()))
    s2._hold_lock()
    check("estado: al tomar el candado retoma las listas con su hora de entrada y su orden",
          s2.members["enjuego"].get("AAAUSDT", {}).get("since") == since and s2.order["enjuego"] == s1.order["enjuego"]
          and s2.restored["kept"]["enjuego"] == len(s1.members["enjuego"]), s2.restored)
    check("estado: y los libros de menos de 15 min", "AAAUSDT" in s2.books and s2.restored["books"] > 0, s2.restored)
    check("estado: lo retomado no aparece en espera", s2.row("AAAUSDT", "enjuego")["member"]["grace"] is False)
    asyncio.run(s2.refresh_meta())
    asyncio.run(s2.refresh_tickers())
    check("estado: el primer ticker, sin medidas todavía, no lo saca ni lo reordena", s2.order["enjuego"] == s1.order["enjuego"])
    asyncio.run(s2.refresh_btc_daily())
    asyncio.run(s2.run_cycle())
    entries2 = sum(1 for e in disk_events() if e["type"] == "entra")
    check("estado: la vuelta tras el reinicio no anota entradas de las que ya estaban",
          entries2 == entries1 and s2.members["enjuego"]["AAAUSDT"]["since"] == since, (entries1, entries2))
    raw = (sfold / "state.json").read_bytes()
    s2._evaluate(sclock.t + 60_000)   # nada entra ni sale
    unchanged = (sfold / "state.json").read_bytes() == raw
    s2._evaluate(sclock.t + 6 * 60_000)
    check("estado: sin cambios se guarda cada 5 min, no en cada revisión", unchanged and state()["at"] == sclock.t + 6 * 60_000)
    sclock.t += 7 * 60_000
    asyncio.run(s2.stop())
    check("estado: al cerrarse se guarda", state()["at"] == sclock.t and s2._lock_fh is None)

    st = state()
    s3 = started(st["at"] + 3 * sc.HOUR_MS)   # tres horas sin mirar
    s3._hold_lock()
    gap_out = [e for e in disk_events() if e.get("gap")]
    check("estado: tras más de una hora sin mirar, las listas empiezan vacías", not any(s3.members.values())
          and s3.restored["closed"] == sum(len(v) for v in st["members"].values()) and not s3.books, s3.restored)
    check("estado: y las que estaban salen a la hora en que se vieron por última vez, marcadas",
          gap_out and all(e["type"] == "sale" and e["at"] == st["at"] for e in gap_out)
          and {e["symbol"] for e in gap_out if e["list"] == "enjuego"} == set(st["members"]["enjuego"]), gap_out[:3])
    s3._release_lock()

    t0 = NOW + 5 * sc.HOUR_MS
    (sfold / "state.json").write_text(json.dumps({"v": 1, "at": t0, "members": {
        "enjuego": {"AAAUSDT": {"since": t0 - 600_000, "last_ok": t0, "dir": 1}}, "tendencia": {},
        "rapidos": {"BBBUSDT": {"since": t0 - 60_000, "last_ok": t0, "rule": "A", "minutes": 5, "dp": 0.02, "doi": 0.05, "dir": 1}}},
        "order": {"enjuego": ["AAAUSDT"], "rapidos": ["BBBUSDT"]}, "books": {}}), encoding="utf-8")
    s4 = started(t0 + 45 * 60_000)
    s4._hold_lock()
    check("estado: con 45 min sin mirar sigue En juego (espera de una hora) y no Rápidos (30 min)",
          list(s4.members["enjuego"]) == ["AAAUSDT"] and not s4.members["rapidos"]
          and any(e.get("gap") and e["symbol"] == "BBBUSDT" and e["list"] == "rapidos" for e in disk_events()), s4.restored)
    s4._release_lock()

    (sfold / "state.json").write_text("{roto", encoding="utf-8")
    s5 = started(NOW)
    check("estado: un archivo ilegible no detiene el arranque", s5._hold_lock() and not any(s5.members.values())
          and any("estado" in e["text"] for e in s5.errors), list(s5.errors))
    s5._release_lock()

    # --- rutas ---
    app = FastAPI()
    app.include_router(sc.make_router(scn))
    client = TestClient(app)
    s = client.get("/api/scanner/status").json()
    check("estado: no envía nada", s["success"] and s["sends"] is False and s["universe"] == len(KLINES), s)
    r = client.get("/api/scanner/list?lista=mias").json()
    check("lista por la ruta", r["success"] and [x["symbol"] for x in r["rows"]] == ["BTCUSDT", "LOWUSDT"] and r["rule"])
    check("lista inválida: 400", client.get("/api/scanner/list?lista=otra").status_code == 400)
    calls = len(fake.calls)
    c = client.get("/api/scanner/coin/LOWUSDT").json()
    check("detalle de una moneda con su libro al día", c["success"] and c["row"]["symbol"] == "LOWUSDT" and len(fake.calls) == calls + 1)
    check("una moneda que no existe: 404", client.get("/api/scanner/coin/ZZZUSDT").status_code == 404)
    check("una moneda mal escrita: 400", client.get("/api/scanner/coin/btc-usdt").status_code == 400)
    check("configuración inválida: 400 y nada cambia", client.post("/api/scanner/config", json={"size_usdt": -1}).status_code == 400
          and scn.config["size_usdt"] == 1000)
    r = client.post("/api/scanner/config", json={"size_usdt": 2000}).json()
    check("configuración válida: se guarda", r["config"]["size_usdt"] == 2000 and json.loads((folder / "config.json").read_text())["size_usdt"] == 2000)
    check("otro tamaño: los libros se vuelven a pedir", scn.book_at == 0 and scn.metrics["AAAUSDT"]["cost_estimated"])
    ev = client.get("/api/scanner/events?limit=5").json()
    check("eventos por la ruta", ev["success"] and len(ev["events"]) <= 5 and ev["events"][0]["at"] >= ev["events"][-1]["at"])
    check("eventos: día mal escrito, 400", client.get("/api/scanner/events?day=ayer").status_code == 400)
    # Un archivo de configuracion danado no se pisa y deja el scanner apagado
    (folder / "config.json").write_text("{roto", encoding="utf-8")
    broken = sc.Scanner(folder, fetch=fake.fetch, now=clock.now)
    check("configuración dañada: apagado y sin pisarla", broken.config_error and broken.config["enabled"] is False
          and (folder / "config.json").read_text() == "{roto")

    # --- en la suite ---
    check("el servidor de la suite tiene el scanner, apagado en las pruebas", isinstance(main.SCANNER, sc.Scanner)
          and not main.SCANNER.status()["running"] and main.SCANNER.status()["env_off"])
    check("nada se pidió fuera del Bybit falso", all(p.startswith("/v5/") for p, _ in fake.calls))
finally:
    shutil.rmtree(TMP, ignore_errors=True)

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)} de {len(results)} pasan")
sys.exit(1 if failed else 0)
