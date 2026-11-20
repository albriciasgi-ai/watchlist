"""
Velas históricas de acciones de EE. UU. (Alpaca) para el probador, sin footprints (19/11/2026).

Pedido del usuario: un histórico más hondo que el almacén de trades (alpaca_store.py), sin su peso, para probar
las reglas de la búsqueda genética en acciones. El probador corre esas reglas en las monedas "nuevas" solo con
velas (rule_tester.CANDLE_CODES), y el filtro de CVD estima la delta con la vela cuando no hay trades
(flow_filters.signed_volume). Las acciones no tienen OI.

Fuente: el conector de la suite (12.AltagraciaTradingSuite/server/alpaca_data.py, importado sin copiarlo), velas
de 15 minutos del SIP desde 2016, ajustadas por splits (adjustment=split: NVDA, TSLA, AAPL o GOOGL tienen splits
en el tramo y sin ajuste el gráfico salta). Solo la sesión regular (09:30 a 16:00 de Nueva York).

Archivo por acción: OrderFlowData/alpaca/candles/<SIM>.json.gz
  {"symbol", "source", "feed", "adjustment", "session", "updated",
   "15": [[ms, o, h, l, c, volumen, trades, vwap], ...], "60": [...], "240": [...], "1440": [...]}
Las seis primeras columnas son las de candles_update.py (las monedas nuevas). Los marcos mayores se arman con las
velas de 15 minutos como en los gráficos de acciones (alpaca_data.candle_keys): 1h y 4h desde
las 09:30 de Nueva York (la última vela de 1h dura 30 minutos y la segunda de 4h, 2.5 horas) y el día desde la
medianoche de Nueva York. Es otra carpeta: el probador no las ve como monedas nuevas.

La sesión de cada día sale del calendario de mercado de Alpaca (/v2/calendar): los días de cierre temprano terminan
a las 13:00 y los feriados no tienen velas.

Al actualizar se vuelven a pedir los últimos días: si cambiaron (un split nuevo reajusta todo lo anterior), la
acción se baja entera otra vez.

Uso (claves de Alpaca en el config/suite.json de la suite, o SUITE_CONFIG con su ruta):
  python -B alpaca_candles.py                         las 100 de fábrica (STOCKS); las que ya están se actualizan
  python -B alpaca_candles.py AAPL,MSFT [--rebuild]   las nombradas
"""
import asyncio
import datetime as dt
import gzip
import json
import os
import sys
import time
from pathlib import Path

import numpy as np

from alpaca_store import DATA, _suite

DIR = Path(os.environ.get("ALPACA_CANDLES", str(DATA / "alpaca" / "candles")))
FIRST = "2016-01-01"          # Alpaca da el SIP histórico desde 2016
BASE_MIN = 15
TFS = (60, 240, 1440)
OVERLAP_DAYS = 7              # Lo que se vuelve a pedir al actualizar, para notar un split nuevo
ADJUSTMENT = "split"
MIN_DAY_SHARE = 0.5           # Un día con menos de la mitad de sus velas queda fuera
# Las 100 de fábrica, por grupo. Las primeras 20 (19/11) eran los índices y las de más volumen en dólares que cotizan
# desde antes de 2016; las otras 80 (20/11, pedido del usuario) suman tecnológicas y del Nasdaq, marcas de consumo y
# acciones volátiles, parecidas a las cripto. Varias volátiles salieron a bolsa después de 2016 y tienen menos historia.
GROUPS = {
    "indices": ("SPY", "QQQ", "IWM", "DIA", "TQQQ", "SOXL"),  # TQQQ y SOXL: apalancados x3
    "tech": ("AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "AVGO", "NFLX", "AMD",
             "ORCL", "CRM", "ADBE", "INTC", "CSCO", "QCOM", "TXN", "MU", "AMAT", "LRCX", "KLAC", "ADI", "MRVL",
             "IBM", "NOW", "INTU", "PYPL", "SHOP", "PANW", "ANET", "SNPS", "ADSK", "EBAY", "BKNG", "SMCI",
             "CMCSA", "TMUS", "AMGN", "ISRG"),
    "consumo": ("JPM", "BAC", "XOM", "UNH", "COST", "WMT",
                "NKE", "KO", "PEP", "MCD", "SBUX", "DIS", "HD", "LOW", "TGT", "PG", "JNJ", "PFE", "MRK", "LLY",
                "V", "MA", "GS", "WFC", "C", "BA", "CAT", "GE", "F", "GM", "CVX"),
    "volatiles": ("TSLA", "MSTR", "COIN", "MARA", "RIOT", "PLTR", "ROKU", "XYZ", "SNAP", "UPST", "AFRM", "HOOD",
                  "SOFI", "RIVN", "NIO", "CVNA", "GME", "AMC", "ENPH", "PLUG", "DKNG", "CRWD", "NET", "TTD", "BABA"),
}
# Desde cuándo vale cada una, si el ticker fue antes de otra empresa: NIO salió a bolsa el 12/09/2018 (antes el ticker
# era de otra y el precio cae 80% en el cambio), DKNG era la SPAC con que se fusionó hasta el 24/04/2020 y RIOT se
# llamaba Bioptix hasta el 04/10/2017, casi sin negociarse
START = {"NIO": "2018-09-12", "DKNG": "2020-04-24", "RIOT": "2017-10-04"}
STOCKS = tuple(s for g in GROUPS.values() for s in g)
GROUP_OF = {s: g for g, syms in GROUPS.items() for s in syms}


def path_of(symbol):
    return DIR / f"{symbol}.json.gz"


def load(symbol):
    p = path_of(symbol)
    if not p.exists():
        return {}
    with gzip.open(p, "rt", encoding="utf-8") as fh:
        return json.load(fh)


async def market_calendar(ad):
    """Apertura y cierre de cada día de mercado, en minutos de Nueva York: {"2016-01-04": (570, 960), ...}.
    Sin él, los días de cierre temprano (13:00) se quedarían con el horario extendido de 13:00 a 16:00."""
    end = dt.date.today() + dt.timedelta(days=7)
    body = await ad._get(ad._trading_url(), "/v2/calendar", {"start": FIRST, "end": end.isoformat()})
    hm = lambda x: int(x[:2]) * 60 + int(x[3:5])
    return {c["date"]: (hm(c["open"]), hm(c["close"])) for c in body}


def in_session(t_ms, ad, cal=None):
    """Qué velas empiezan dentro de la sesión regular: la del calendario si lo hay, si no 09:30 a 16:00 de lunes a viernes."""
    t_ms = np.asarray(t_ms, dtype=np.int64)
    if not cal:
        return ad.session_mask(t_ms, "rth")
    local = t_ms + ad.ny_offset_ms(t_ms)
    minute = (local % ad.DAY_MS) // ad.MINUTE_MS
    days = (local // ad.DAY_MS).tolist()
    keep = np.zeros(len(t_ms), dtype=bool)
    for i, (d, m) in enumerate(zip(days, minute.tolist())):
        span = cal.get(dt.date.fromordinal(719163 + d).isoformat())
        keep[i] = span is not None and span[0] <= m < span[1]
    return keep


def drop_thin_days(base, ad, cal):
    """Quita los días con menos de MIN_DAY_SHARE de sus velas: Alpaca tiene días casi vacíos (JPM, BAC, XOM, UNH y WMT
    en 2021 y 2022, con una vela de 26) y una vela diaria armada con eso no es el día. Quedan como hueco."""
    if not base or not cal:
        return base, []
    t = np.array([r[0] for r in base], dtype=np.int64)
    local = t + ad.ny_offset_ms(t)
    days = [dt.date.fromordinal(719163 + int(d)).isoformat() for d in (local // ad.DAY_MS).tolist()]
    count = {}
    for d in days:
        count[d] = count.get(d, 0) + 1
    thin = {d for d, n in count.items() if d in cal and n < MIN_DAY_SHARE * (cal[d][1] - cal[d][0]) / BASE_MIN}
    return [r for r, d in zip(base, days) if d not in thin], sorted(thin)


def rth_rows(rows, ad, end_ms, cal=None):
    """Velas de 15 minutos de la sesión regular, ya cerradas antes de end_ms, como [ms, o, h, l, c, v, n, vw]."""
    if not rows:
        return []
    t = np.array([ad.ts_us(b["t"]) // 1000 for b in rows], dtype=np.int64)
    keep = in_session(t, ad, cal) & (t + BASE_MIN * ad.MINUTE_MS <= end_ms)
    return [[int(ti), float(b["o"]), float(b["h"]), float(b["l"]), float(b["c"]), float(b["v"]),
             int(b.get("n") or 0), float(b.get("vw") or 0)] for ti, b, k in zip(t.tolist(), rows, keep.tolist()) if k]


def aggregate(base, tf, ad):
    """Velas de tf minutos desde las de 15 minutos, con el inicio de los gráficos de acciones."""
    if not base:
        return []
    a = np.array(base, dtype=float)
    keys = ad.candle_keys(a[:, 0].astype(np.int64), tf, "rth")
    starts = np.r_[0, np.flatnonzero(np.diff(keys)) + 1]
    ends = np.r_[starts[1:], len(a)]
    out = []
    for s, e in zip(starts.tolist(), ends.tolist()):
        seg = a[s:e]
        v = seg[:, 5].sum()
        vw = float((seg[:, 7] * seg[:, 5]).sum() / v) if v > 0 else float(seg[-1, 4])
        out.append([int(keys[s]), float(seg[0, 1]), float(seg[:, 2].max()), float(seg[:, 3].min()), float(seg[-1, 4]),
                    float(v), int(seg[:, 6].sum()), round(vw, 4)])
    return out


async def fetch(symbol, start_ms, end_ms, ad, cal=None):
    params = {"timeframe": f"{BASE_MIN}Min", "start": ad.iso(start_ms), "end": ad.iso(end_ms), "limit": ad.PAGE_LIMIT,
              "feed": ad.feed(), "adjustment": ADJUSTMENT, "sort": "asc"}
    rows = []
    async for page in ad._pages(ad._data_url(), f"/v2/stocks/{symbol}/bars", params, "bars"):
        rows.extend(page)
    return rth_rows(rows, ad, end_ms, cal)


def save(symbol, base, ad):
    data = {"symbol": symbol, "source": "alpaca", "feed": ad.feed(), "adjustment": ADJUSTMENT, "session": "rth",
            "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%MZ"), str(BASE_MIN): base}
    for tf in TFS:
        data[str(tf)] = aggregate(base, tf, ad)
    DIR.mkdir(parents=True, exist_ok=True)
    tmp = DIR / f"{symbol}.tmp"
    with gzip.open(tmp, "wt", encoding="utf-8") as fh:
        json.dump(data, fh, separators=(",", ":"))
    os.replace(tmp, path_of(symbol))
    return data


async def update(symbol, ad, rebuild=False, cal=None):
    t0 = time.time()
    end_ms = int(time.time() * 1000) - ad.SIP_DELAY_MS
    old = [] if rebuild else (load(symbol).get(str(BASE_MIN)) or [])
    mode = "nueva"
    if old:
        since = old[-1][0] - OVERLAP_DAYS * ad.DAY_MS
        fresh = await fetch(symbol, since, end_ms, ad, cal)
        known = {r[0]: r for r in old if r[0] >= since}
        same = [r for r in fresh if r[0] in known]
        moved = any(abs(r[4] - known[r[0]][4]) > 1e-6 * max(1.0, abs(r[4])) or abs(r[5] - known[r[0]][5]) > 0.5
                    for r in same)
        if same and not moved:
            base = [r for r in old if r[0] < since] + fresh
            mode = "actualizada"
        else:
            old, mode = [], "rehecha (cambió el ajuste)"
    first_ms = ad.day_ms(max(FIRST, START.get(symbol, FIRST)))
    if not old:
        base = await fetch(symbol, first_ms, end_ms, ad, cal)
    base = [r for r in base if r[0] >= first_ms]
    if cal and base:  # También limpia lo bajado antes sin calendario
        base = [r for r, k in zip(base, in_session([r[0] for r in base], ad, cal).tolist()) if k]
    base, thin = drop_thin_days(base, ad, cal)
    data = save(symbol, base, ad)
    size = path_of(symbol).stat().st_size / 1e6
    days = len(data["1440"])
    first = ad.day_str(base[0][0]) if base else "-"
    last = ad.day_str(base[-1][0]) if base else "-"
    print(f"{symbol}: {mode}, {days} días ({first} a {last}), {len(base):,} velas de 15m, "
          f"{size:.1f} MB, {time.time() - t0:.0f} s" + (f", sin {len(thin)} días casi vacíos ({', '.join(thin)})" if thin else ""),
          flush=True)
    return data


async def run(symbols, rebuild=False):
    ad = _suite()
    if not ad.configured():
        sys.exit("Faltan las claves de Alpaca (config/suite.json de la suite, o SUITE_CONFIG con su ruta)")
    try:
        cal = await market_calendar(ad)
    except Exception as error:
        cal = None
        print(f"Sin el calendario de mercado ({error}): los días de cierre temprano quedan con su horario extendido", flush=True)
    failed = []
    for s in symbols:
        try:
            await update(s, ad, rebuild, cal)
        except Exception as error:  # Una acción que falla no detiene a las demás
            failed.append(s)
            print(f"{s}: falló: {error}", flush=True)
    if failed:
        print("Fallaron:", ",".join(failed), flush=True)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    syms = [s.strip().upper() for s in args[0].split(",") if s.strip()] if args else list(STOCKS)
    asyncio.run(run(syms, rebuild="--rebuild" in sys.argv))
