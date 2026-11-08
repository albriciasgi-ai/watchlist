# -*- coding: utf-8 -*-
"""
Arma el almacen de liquidaciones de App 1 en OrderFlowData/liquidations. Solo agrega: nunca borra
ni cambia lo que ya esta guardado, y no toca los archivos de research/liq.

Fuentes gratis, sin cuenta ni clave:
- Binance Coin-M (data.binance.vision, liquidationSnapshot): eventos con hora, lado, precio y tamano.
  Solo del 2023-06-25 al 2024-10-14 y solo los contratos inversos de Binance: es un mercado, no todos.
  Binance publica como maximo una liquidacion por segundo y mercado, asi que es un piso.
- MarginPad (/api/v1/liquidations/recent): volumen por precio de los ultimos 30 dias, de todo el
  mercado, sin hora. Restando ventanas que empiezan en medianoche UTC sale cada dia por precio, que
  se conoce al cerrar ese dia. Corriendolo cada pocas semanas se acumula historial.
- Bitfinex (/v2/liquidations/hist): eventos con hora desde 2019, pero de un mercado pequeno. Una sola
  descarga trae todas las monedas mezcladas. Cada posicion liquidada sale una vez, en la hora en que
  se disparo, al precio promedio de sus ventas a mercado.

Con cuenta y clave (la crea el usuario y la guarda en liquidations/coinalyze_key.txt):
- Coinalyze (/v1/liquidation-history): largos y cortos liquidados por intervalo en cada exchange, sin
  precio. Se suman los perpetuos de todos los exchanges. Guarda 1500 a 2000 puntos por intervalo
  intradia y todo el diario: cada corrida guarda lo nuevo, asi que conviene correrlo cada pocos dias.
  El precio se estima con las velas de 5 minutos de Bybit dentro de cada intervalo: los largos se
  liquidan donde el precio hizo minimos nuevos con volumen, y los cortos donde hizo maximos nuevos.

Uso, desde backend/:
  python -B liq_update.py importar                 BTC de research/liq (MarginPad del 08/10/2026)
  python -B liq_update.py binance BTCUSDT ETHUSDT  Eventos de Binance Coin-M
  python -B liq_update.py marginpad BTCUSDT ...    Dias completos que falten de los ultimos 30
  python -B liq_update.py bitfinex BTCUSDT ...     Baja lo que falte de Bitfinex y arma esas monedas
  python -B liq_update.py coinalyze BTCUSDT ...    Baja Coinalyze y las velas que falten, y estima precios
  python -B liq_update.py coinalyze-armar BTCUSDT  Solo vuelve a estimar los precios con lo ya bajado
"""
import bisect
import csv
import datetime as dt
import io
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

DATA = Path(os.environ.get("ORDERFLOW_DATA", r"C:\Users\inven\OrderFlowData"))
LIQ_DIR = Path(os.environ.get("ORDERFLOW_LIQ", str(DATA / "liquidations")))
RESEARCH = DATA / "research" / "liq"
UA = {"User-Agent": "app1-liquidations/1.0"}

EVENTS_HEADER = ["time_ms", "side", "price", "usd"]
DAYS_HEADER = ["date_utc", "price_low", "price_high", "long_usd", "short_usd", "events"]

CM_LIST = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision?delimiter=/&prefix=data/futures/cm/daily/liquidationSnapshot/{}/"
CM_FILE = "https://data.binance.vision/"
CM_CONTRACT_USD = {"BTCUSD_PERP": 100.0}  # Los demas contratos inversos de Binance valen 10 USD
MARGINPAD = "https://marginpad.io/api/v1/liquidations/recent?symbol={}&minutes={}"
MARGINPAD_MAX_MINUTES = 43200  # 30 dias: lo mas largo que acepta
BITFINEX = "https://api-pub.bitfinex.com/v2/liquidations/hist?start={}&limit=500&sort=1"
BITFINEX_FROM = int(dt.datetime(2021, 8, 1, tzinfo=dt.timezone.utc).timestamp() * 1000)  # Un mes antes del cache de App 1
BITFINEX_MATCH_WINDOW_MS = 120_000  # Una posicion sin venta a mercado toma el precio de la venta mas cercana
BITFINEX_PAUSE_S = 7.0  # Con 3 s acepta unas 10 consultas y despues bloquea la IP

COINALYZE = "https://api.coinalyze.net/v1/"
COINALYZE_KEY = LIQ_DIR / "coinalyze_key.txt"
# Del mas fino al mas grueso: en cada hora se usa el mas fino que la cubre
COINALYZE_INTERVALS = {"15min": 900, "1hour": 3600, "4hour": 14400, "12hour": 43200, "daily": 86400}
COINALYZE_FROM = int(dt.datetime(2021, 7, 1, tzinfo=dt.timezone.utc).timestamp())  # Un mes antes del cache de App 1
COINALYZE_CALLS_PER_MINUTE = 40  # Cada simbolo de un pedido cuenta como una llamada
SPANS_HEADER = ["start_ms", "end_ms", "price_low", "price_high", "long_usd", "short_usd", "interval"]
PIECE_PCT = 0.05  # Un tramo estimado se reparte en pedazos de 0.05% del precio
BYBIT_KLINE = "https://api.bybit.com/v5/market/kline?category=linear&symbol={}&interval={}&start={}&limit=1000"


def events_path(symbol, source="binance_cm"):
    return LIQ_DIR / f"{symbol}_{source}.csv"


def days_path(symbol):
    return LIQ_DIR / f"{symbol}_marginpad.csv"


def get(url, attempts=5, timeout=40):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as response:
                return response.read()
        except OSError:
            if attempt == attempts - 1:
                raise
            time.sleep(3 * (attempt + 1))


def write_rows(path, header, rows):
    """Escribe en un archivo temporal y lo cambia de una vez: el backend nunca lee uno a medias."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    with open(temporary, "w", newline="", encoding="ascii") as handle:
        writer = csv.writer(handle)
        writer.writerow(header)
        writer.writerows(rows)
    os.replace(temporary, path)


def read_days(path):
    if not path.exists():
        return {}
    days = {}
    for row in csv.DictReader(open(path, encoding="ascii")):
        days.setdefault(row["date_utc"], []).append(row)
    return days


def number(value, digits=10):
    """Precio sin ruido de coma flotante: 0.0010000000000000009 queda en 0.001."""
    return float(f"{float(value):.{digits}g}")


# ---------------------------------------------------------------- Binance Coin-M

def coin_m_symbol(symbol):
    return symbol.replace("USDT", "USD") + "_PERP"


def binance(symbol):
    contract = coin_m_symbol(symbol)
    raw = LIQ_DIR / "raw" / "binance_cm" / contract
    raw.mkdir(parents=True, exist_ok=True)

    keys, marker = [], ""
    while True:
        listing = get(CM_LIST.format(contract) + (f"&marker={marker}" if marker else "")).decode("utf-8")
        page = re.findall(r"<Key>([^<]+\.zip)</Key>", listing)
        keys += page
        if "<IsTruncated>true</IsTruncated>" not in listing or not page:
            break
        marker = page[-1]
    if not keys:
        print(symbol, "sin archivos en Binance Coin-M", contract)
        return

    usd_per_contract = CM_CONTRACT_USD.get(contract, 10.0)
    seen, rows = set(), []
    for key in keys:
        path = raw / os.path.basename(key)
        if not path.exists():
            path.write_bytes(get(CM_FILE + key))
            time.sleep(0.08)
        with zipfile.ZipFile(path) as archive:
            text = archive.read(archive.namelist()[0]).decode("utf-8")
        for row in csv.DictReader(io.StringIO(text)):
            fields = tuple(row.values())
            if fields in seen:
                continue
            seen.add(fields)
            if float(row["average_price"]) <= 0:
                continue
            # SELL cierra un largo y BUY un corto. El tamano va en contratos de valor fijo en USD
            side = "long" if row["side"] == "SELL" else "short"
            rows.append((int(row["time"]), side, number(row["average_price"]), round(float(row["original_quantity"]) * usd_per_contract, 2)))
    rows.sort()
    write_rows(events_path(symbol), EVENTS_HEADER, rows)
    first = dt.datetime.fromtimestamp(rows[0][0] / 1000, dt.timezone.utc).date()
    last = dt.datetime.fromtimestamp(rows[-1][0] / 1000, dt.timezone.utc).date()
    print(symbol, contract, "archivos", len(keys), "eventos", len(rows), "USD", round(sum(r[3] for r in rows)), "del", first, "al", last)


# ---------------------------------------------------------------- MarginPad

def marginpad(symbol):
    coin = symbol.replace("USDT", "")
    fetched = dt.datetime.now(dt.timezone.utc)
    raw = LIQ_DIR / "raw" / "marginpad" / symbol / fetched.strftime("%Y%m%d_%H%M")
    raw.mkdir(parents=True, exist_ok=True)

    today = fetched.replace(hour=0, minute=0, second=0, microsecond=0)
    windows = []
    for back in range(0, 31):
        start = today - dt.timedelta(days=back)
        # Se calcula al pedir, para que la ventana siga empezando en la medianoche aunque pase el tiempo
        minutes = math.floor((dt.datetime.now(dt.timezone.utc) - start).total_seconds() / 60)
        if minutes > MARGINPAD_MAX_MINUTES:
            break
        data = json.loads(get(MARGINPAD.format(coin, minutes)))
        (raw / f"win_{start.date().isoformat()}.json").write_text(json.dumps(data), encoding="utf-8")
        # El precio se redondea antes de medir el paso: 0.003361 y 0.003361000000000001 son la misma celda
        buckets = {number(b["price"]): (float(b.get("long", 0.0)), float(b.get("short", 0.0)), int(b.get("count", 0))) for b in data.get("buckets", [])}
        windows.append((start.date().isoformat(), buckets))
        time.sleep(1.3)  # MarginPad acepta 60 peticiones por minuto

    prices = sorted({p for _, buckets in windows for p in buckets})
    gaps = [number(b - a, 6) for a, b in zip(prices, prices[1:]) if number(b - a, 6) > 0]
    step = min(gaps) if gaps else 0.0

    stored = read_days(days_path(symbol))
    new_days, negatives, compared = {}, 0, []
    for (day, longer), (_, shorter) in zip(windows[1:], windows[:-1]):
        # Dia completo: la ventana que empieza ese dia menos la que empieza al dia siguiente
        rows = []
        for price in sorted(set(longer) | set(shorter)):
            a, b = longer.get(price, (0.0, 0.0, 0)), shorter.get(price, (0.0, 0.0, 0))
            lng, sht, cnt = a[0] - b[0], a[1] - b[1], a[2] - b[2]
            negatives += (lng < -1) + (sht < -1)
            lng, sht, cnt = max(0.0, lng), max(0.0, sht), max(0, cnt)
            if lng + sht > 0.5:
                low = number(price - step / 2)
                rows.append([day, low, number(low + step), round(lng, 2), round(sht, 2), cnt])
        if day in stored:
            # Ya guardado: se compara y no se cambia
            old = sum(float(r["long_usd"]) + float(r["short_usd"]) for r in stored[day])
            new = sum(r[3] + r[4] for r in rows)
            if old > 0:
                compared.append(abs(new - old) / old)
        elif rows:
            new_days[day] = rows

    merged = [[r["date_utc"], r["price_low"], r["price_high"], r["long_usd"], r["short_usd"], r["events"]] for day in stored for r in stored[day]]
    merged += [row for day in new_days for row in new_days[day]]
    merged.sort(key=lambda r: (r[0], float(r[1])))
    if new_days or not days_path(symbol).exists():
        write_rows(days_path(symbol), DAYS_HEADER, merged)
    days = sorted({r[0] for r in merged})
    print(symbol, "paso", step, "dias nuevos", sorted(new_days), "guardados", len(days), days[:1], days[-1:],
          "negativos", negatives, "diferencia maxima con lo ya guardado", f"{max(compared) * 100:.2f}%" if compared else "-")


# ---------------------------------------------------------------- Bitfinex

def _bitfinex_raw():
    return LIQ_DIR / "raw" / "bitfinex"


def _bitfinex_rows():
    """Filas guardadas, sin repetir. Cada archivo mensual tiene una fila JSON por linea."""
    seen, rows = set(), []
    for path in sorted(_bitfinex_raw().glob("*.jsonl")):
        for line in open(path, encoding="utf-8"):
            row = json.loads(line)
            key = json.dumps(row)
            if key not in seen:
                seen.add(key)
                rows.append(row)
    return rows


def _stored_newest(start_ms, end_ms):
    """Hora de la fila mas nueva ya guardada en [start_ms, end_ms), o None"""
    newest = None
    month = dt.datetime.fromtimestamp(start_ms / 1000, dt.timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    while month.timestamp() * 1000 < end_ms:
        path = _bitfinex_raw() / f"{month:%Y-%m}.jsonl"
        if path.exists():
            for line in open(path, encoding="utf-8"):
                t = json.loads(line)[2]
                if start_ms <= t < end_ms and (newest is None or t > newest):
                    newest = t
        month = (month + dt.timedelta(days=32)).replace(day=1)
    return newest


def bitfinex_download(start_ms=None, end_ms=None):
    """
    Baja [start_ms, end_ms) desde la ultima fila guardada en ese tramo. Si se corta, la siguiente corrida sigue
    desde ahi. Bitfinex acepta unas 20 consultas por minuto; pasado el limite bloquea la IP un minuto, y cada
    consulta durante el bloqueo lo alarga: por eso se espera sin reintentar.
    """
    raw = _bitfinex_raw()
    raw.mkdir(parents=True, exist_ok=True)
    start_ms = BITFINEX_FROM if start_ms is None else start_ms
    end_ms = int(time.time() * 1000) if end_ms is None else end_ms
    last = max(start_ms, _stored_newest(start_ms, end_ms) or start_ms)

    pages, total, written = 0, 0, set()
    while last < end_ms:
        try:
            page = json.loads(get(BITFINEX.format(last), attempts=1, timeout=40))
        except OSError as error:
            print("espera 75 s por", repr(error)[:80], flush=True)
            time.sleep(75)
            continue
        if isinstance(page, list) and page and page[0] == "error":
            print("espera 75 s por", page, flush=True)
            time.sleep(75)
            continue
        if not isinstance(page, list) or not page:
            break
        # Cada elemento trae una o mas listas de posicion; se guardan todas
        found = [inner for item in page if isinstance(item, list) for inner in item if isinstance(inner, list) and len(inner) > 11]
        rows = [row for row in found if row[2] < end_ms and json.dumps(row) not in written]
        passed_end = any(row[2] >= end_ms for row in found)
        if not rows:
            if passed_end or not found or max(row[2] for row in found) <= last:
                break  # Nada nuevo: se llego al final de los datos o del tramo
            last = max(row[2] for row in found)
            continue
        written = {json.dumps(row) for row in rows}  # La pagina siguiente repite la ultima hora
        by_month = {}
        for row in rows:
            month = dt.datetime.fromtimestamp(row[2] / 1000, dt.timezone.utc).strftime("%Y-%m")
            by_month.setdefault(month, []).append(row)
        for month, items in by_month.items():
            with open(raw / f"{month}.jsonl", "a", encoding="utf-8") as handle:
                handle.writelines(json.dumps(item) + "\n" for item in items)
        newest = max(row[2] for row in rows)
        pages, total = pages + 1, total + len(rows)
        if pages % 50 == 0:
            print("paginas", pages, "filas", total, "hasta", dt.datetime.fromtimestamp(newest / 1000, dt.timezone.utc).isoformat(), flush=True)
        if passed_end:
            break
        # La pagina siguiente empieza en la ultima hora: las repetidas no se vuelven a guardar
        last = newest if newest > last else last + 1
        time.sleep(BITFINEX_PAUSE_S)
    print("Bitfinex: paginas", pages, "filas", total, "tramo",
          dt.datetime.fromtimestamp(start_ms / 1000, dt.timezone.utc).date(), "a", dt.datetime.fromtimestamp(end_ms / 1000, dt.timezone.utc).date(), flush=True)


def _bitfinex_symbols(symbol):
    base = symbol.replace("USDT", "")
    # Perpetuo en USDt y margen contra USD o USDt. Nada cotizado en otra moneda
    return {f"t{base}F0:USTF0", f"t{base}USD", f"t{base}UST", f"t{base}:USD", f"t{base}:UST"}


def bitfinex_build(symbol, rows=None):
    """Una liquidacion por posicion: hora del disparo, lado, precio promedio de venta y USD."""
    rows = _bitfinex_rows() if rows is None else rows
    wanted = _bitfinex_symbols(symbol)
    positions = {}
    for row in rows:
        if row[0] != "pos" or row[4] not in wanted:
            continue
        positions.setdefault((row[4], row[1]), []).append(row)

    fills_by_symbol = {}
    events, unmatched = [], []
    for (market, _), items in positions.items():
        items.sort(key=lambda r: (r[2], r[8]))
        trigger = next((r for r in items if r[8] == 0), items[0])
        amount = float(trigger[5])
        matches = [r for r in items if r[8] == 1 and r[11]]
        if matches:
            # Cada venta trae lo que quedaba de la posicion: lo vendido es la diferencia con la siguiente
            left = [abs(float(r[5])) for r in matches]
            sizes = [max(0.0, a - b) for a, b in zip(left, left[1:])] + [left[-1]]
            if sum(sizes) <= 0:
                sizes = [1.0] * len(matches)
            price = sum(s * float(r[11]) for s, r in zip(sizes, matches)) / sum(sizes)
            for r in matches:
                fills_by_symbol.setdefault(market, []).append((r[2], float(r[11])))
            events.append([trigger[2], "long" if amount > 0 else "short", number(price), round(abs(amount) * price, 2)])
        else:
            unmatched.append((market, trigger[2], amount))

    # Sin venta a mercado no hay precio: toma el de la venta mas cercana del mismo mercado, si esta a 2 minutos o menos
    skipped = 0
    for market in fills_by_symbol:
        fills_by_symbol[market].sort()
    for market, t, amount in unmatched:
        fills = fills_by_symbol.get(market, [])
        times = [f[0] for f in fills]
        i = bisect.bisect_left(times, t)
        near = [fills[j] for j in (i - 1, i) if 0 <= j < len(fills) and abs(fills[j][0] - t) <= BITFINEX_MATCH_WINDOW_MS]
        if not near:
            skipped += 1
            continue
        price = min(near, key=lambda f: abs(f[0] - t))[1]
        events.append([t, "long" if amount > 0 else "short", number(price), round(abs(amount) * price, 2)])

    events.sort()
    if not events:
        print(symbol, "Bitfinex sin liquidaciones")
        return
    write_rows(events_path(symbol, "bitfinex"), EVENTS_HEADER, events)
    first = dt.datetime.fromtimestamp(events[0][0] / 1000, dt.timezone.utc).date()
    last = dt.datetime.fromtimestamp(events[-1][0] / 1000, dt.timezone.utc).date()
    print(symbol, "Bitfinex eventos", len(events), "sin precio", skipped, "USD", round(sum(e[3] for e in events)), "del", first, "al", last, flush=True)


# ---------------------------------------------------------------- Coinalyze

def _coinalyze_key():
    if not COINALYZE_KEY.exists():
        raise SystemExit(f"Falta la clave de Coinalyze en {COINALYZE_KEY}")
    return COINALYZE_KEY.read_text(encoding="utf-8-sig").strip()


def _coinalyze(path, params, key):
    """La clave va en la cabecera: nunca en la direccion ni en lo que se imprime."""
    url = COINALYZE + path + "?" + urllib.parse.urlencode(params)
    for attempt in range(8):
        try:
            request = urllib.request.Request(url, headers={**UA, "api_key": key})
            with urllib.request.urlopen(request, timeout=90) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as error:
            if error.code == 429:
                time.sleep(float(error.headers.get("Retry-After") or 10) + 1)
                continue
            if error.code in (401, 403):
                raise SystemExit(f"Coinalyze rechazo la clave (HTTP {error.code})")
            time.sleep(5 * (attempt + 1))
        except OSError:
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"Coinalyze no respondio a {path}")


def _coinalyze_markets(key):
    """Mercados perpetuos de Coinalyze, guardados un dia para no gastar llamadas."""
    path = LIQ_DIR / "raw" / "coinalyze" / "future_markets.json"
    if not path.exists() or time.time() - path.stat().st_mtime > 86400:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(_coinalyze("future-markets", {}, key)), encoding="utf-8")
    return json.loads(path.read_text(encoding="utf-8"))


def _series_path(symbol, interval):
    return LIQ_DIR / "coinalyze" / f"{symbol}_{interval}.csv"


def _read_series(symbol, interval):
    path = _series_path(symbol, interval)
    if not path.exists():
        return {}
    return {int(r["t_ms"]): (float(r["long_usd"]), float(r["short_usd"]), int(r["markets"])) for r in csv.DictReader(open(path, encoding="ascii"))}


def coinalyze_download(symbol):
    """Suma por intervalo los perpetuos de la moneda en todos los exchanges. Lo ya guardado no cambia."""
    key = _coinalyze_key()
    base = symbol.replace("USDT", "")
    markets = sorted(m["symbol"] for m in _coinalyze_markets(key) if m.get("base_asset") == base and m.get("is_perpetual"))
    if not markets:
        print(symbol, "Coinalyze sin mercados perpetuos")
        return
    now = int(time.time())
    raw = LIQ_DIR / "raw" / "coinalyze" / symbol / dt.datetime.now(dt.timezone.utc).strftime("%Y%m%d_%H%M")
    raw.mkdir(parents=True, exist_ok=True)

    for interval, seconds in COINALYZE_INTERVALS.items():
        start = COINALYZE_FROM if interval == "daily" else max(COINALYZE_FROM, now - 2100 * seconds)
        fresh = {}
        for first in range(0, len(markets), 20):
            group = markets[first:first + 20]
            data = _coinalyze("liquidation-history", {
                "symbols": ",".join(group), "interval": interval, "from": start, "to": now, "convert_to_usd": "true"
            }, key)
            (raw / f"{interval}_{first // 20}.json").write_text(json.dumps(data), encoding="utf-8")
            for item in data or []:
                for point in item.get("history") or []:
                    t = int(point["t"])
                    if t + seconds > now:
                        continue  # Intervalo todavia abierto
                    total = fresh.setdefault(t * 1000, [0.0, 0.0, 0])
                    total[0] += float(point.get("l") or 0)
                    total[1] += float(point.get("s") or 0)
                    total[2] += 1
            time.sleep(len(group) * 60 / COINALYZE_CALLS_PER_MINUTE + 0.5)

        stored = _read_series(symbol, interval)
        added = {t: v for t, v in fresh.items() if t not in stored}
        merged = {**{t: tuple(v) for t, v in added.items()}, **stored}
        rows = [[t, round(v[0], 2), round(v[1], 2), v[2]] for t, v in sorted(merged.items())]
        write_rows(_series_path(symbol, interval), ["t_ms", "long_usd", "short_usd", "markets"], rows)
        span = f"{dt.datetime.fromtimestamp(rows[0][0] / 1000, dt.timezone.utc):%Y-%m-%d} a {dt.datetime.fromtimestamp(rows[-1][0] / 1000, dt.timezone.utc):%Y-%m-%d}" if rows else "-"
        print(symbol, "Coinalyze", interval, "mercados", len(markets), "nuevos", len(added), "guardados", len(rows), span, flush=True)


def _klines(symbol, start_ms, end_ms):
    """Velas de 5 minutos de Bybit, guardadas en raw/candles. Solo baja lo que falta al final o al principio."""
    path = LIQ_DIR / "raw" / "candles" / f"{symbol}_5.csv"
    path.parent.mkdir(parents=True, exist_ok=True)
    candles = {}
    if path.exists():
        for r in csv.reader(open(path, encoding="ascii")):
            if r[0] != "t":
                candles[int(r[0])] = tuple(float(x) for x in r[1:])
    step = 300_000

    def page(t):
        # Bybit a veces responde sin velas (limite de consultas u otro error pasajero): se espera y se reintenta
        for attempt in range(6):
            body = json.loads(get(BYBIT_KLINE.format(symbol, 5, t)))
            if isinstance((body.get("result") or {}).get("list"), list):
                return body["result"]["list"]
            time.sleep(5 * (attempt + 1))
        raise RuntimeError(f"Bybit no entrego velas de {symbol}: {body.get('retCode')} {body.get('retMsg')}")

    def fetch(frm, to):
        t = frm
        while t < to:
            data = page(t)
            if not data:
                t += 1000 * step
                continue
            for x in data:
                candles[int(x[0])] = (float(x[1]), float(x[2]), float(x[3]), float(x[4]), float(x[6]))
            t = max(int(x[0]) for x in data) + step
            time.sleep(0.12)

    stored = sorted(candles)
    if not stored:
        fetch(start_ms, end_ms)
    else:
        if start_ms < stored[0]:
            fetch(start_ms, stored[0])
        if stored[-1] + step < end_ms:
            fetch(stored[-1] + step, end_ms)
    times = sorted(t for t in candles if t + step <= end_ms)
    write_rows(path, ["t", "open", "high", "low", "close", "turnover"], [[t, *candles[t]] for t in times])
    return times, candles


def _pieces(low, high, usd, price):
    """Reparte un tramo de precio en pedazos de PIECE_PCT del precio"""
    size = max(price * PIECE_PCT / 100, 1e-12)
    count = max(1, min(400, math.ceil((high - low) / size))) if high > low else 1
    width = (high - low) / count
    return [(low + k * width, low + (k + 1) * width, usd / count) for k in range(count)]


def attribute(long_usd, short_usd, candles):
    """
    Precio estimado de lo liquidado en un intervalo, con sus velas de 5 minutos (open, high, low, close, turnover).
    Los largos se reparten entre los minimos nuevos del intervalo, cada uno por lo que bajo y su volumen;
    los cortos entre los maximos nuevos. Sin minimos nuevos, por la mecha de abajo y su volumen.
    Devuelve (low, high, long, short) por pedazo.
    """
    if not candles:
        return []
    out = []
    for side, usd in (("long", long_usd), ("short", short_usd)):
        if usd <= 0:
            continue
        weights = []
        extreme = candles[0][0]
        for o, h, l, c, turnover in candles:
            if side == "long":
                weights.append((max(0.0, extreme - l) * turnover, (l, max(l, min(extreme, h)))))
                extreme = min(extreme, l)
            else:
                weights.append((max(0.0, h - extreme) * turnover, (min(h, max(extreme, l)), h)))
                extreme = max(extreme, h)
        if sum(w for w, _ in weights) <= 0:
            weights = []
            for o, h, l, c, turnover in candles:
                body = (min(o, c), max(o, c))
                wick = body[0] - l if side == "long" else h - body[1]
                band = (l, body[0]) if side == "long" else (body[1], h)
                weights.append((max(wick, 1e-9) * max(turnover, 1e-9), band))
        total = sum(w for w, _ in weights)
        for w, (low, high) in weights:
            if w <= 0:
                continue
            for a, b, part in _pieces(low, high, usd * w / total, (low + high) / 2):
                out.append((a, b, part if side == "long" else 0.0, 0.0 if side == "long" else part))
    return out


def _complete_days(series, interval):
    """
    Dias en que el intervalo intradia trae todos los mercados: su suma coincide con la diaria (10%), o el dia
    fue tranquilo y reporta tantos mercados como el diario. La historia intradia de Coinalyze no es igual de
    larga en todos los mercados: sus dias mas viejos traen solo algunos y suman mucho menos que el dia.
    """
    daily = series.get("daily") or {}
    if interval == "daily":
        return {t for t in daily}
    per_day = {}
    for t, (lng, sht, markets) in series[interval].items():
        day = per_day.setdefault(t // 86_400_000 * 86_400_000, [0.0, 0])
        day[0] += lng + sht
        day[1] = max(day[1], markets)
    complete = set()
    for day, (total, markets) in per_day.items():
        if day not in daily:
            continue
        reference = daily[day][0] + daily[day][1]
        if (reference > 0 and abs(total / reference - 1) <= 0.1) or (reference < 1e6 and markets >= daily[day][2]):
            complete.add(day)
    return complete


def coinalyze_build(symbol):
    """Tramos estimados: en cada hora el intervalo mas fino completo, sin contar dos veces."""
    series = {interval: _read_series(symbol, interval) for interval in COINALYZE_INTERVALS}
    if not any(series.values()):
        print(symbol, "Coinalyze sin series guardadas")
        return
    first = min(min(s) for s in series.values() if s)
    last = max(max(t + COINALYZE_INTERVALS[i] * 1000 for t in s) for i, s in series.items() if s)
    times, candles = _klines(symbol, first, last)

    covered = []  # Tramos [inicio, fin) ya tomados por un intervalo mas fino, ordenados
    rows = []
    for interval, seconds in COINALYZE_INTERVALS.items():
        width = seconds * 1000
        complete = _complete_days(series, interval)
        taken = []
        for t in sorted(series[interval]):
            if t // 86_400_000 * 86_400_000 not in complete:
                continue  # Dia incompleto en este intervalo: lo cubre uno mas grueso
            end = t + width
            i = bisect.bisect_right(covered, (t, math.inf)) - 1
            overlaps = (i >= 0 and covered[i][1] > t) or (i + 1 < len(covered) and covered[i + 1][0] < end)
            if overlaps:
                continue
            long_usd, short_usd, _ = series[interval][t]
            taken.append((t, end))
            if long_usd + short_usd <= 0:
                continue
            a, b = bisect.bisect_left(times, t), bisect.bisect_left(times, end)
            inside = [candles[k] for k in times[a:b]]
            pieces = {}
            for low, high, lng, sht in attribute(long_usd, short_usd, inside):
                key = (number(low), number(high))
                got = pieces.setdefault(key, [0.0, 0.0])
                got[0] += lng
                got[1] += sht
            for (low, high), (lng, sht) in sorted(pieces.items()):
                if lng + sht >= 0.5:
                    rows.append([t, end, low, high, round(lng, 2), round(sht, 2), interval])
        covered = sorted(covered + taken)
    rows.sort()
    write_rows(events_path(symbol, "coinalyze"), SPANS_HEADER, rows)
    used = {}
    for row in rows:
        used[row[6]] = used.get(row[6], 0) + 1
    print(symbol, "Coinalyze tramos", len(rows), "por intervalo", used, "USD", round(sum(r[4] + r[5] for r in rows)), flush=True)


# ---------------------------------------------------------------- Research

def importar():
    """MarginPad de BTC del 08/10/2026 en adelante: ese primer dia ya no se puede volver a pedir."""
    source = RESEARCH / "btc_liq_day_price.csv"
    if not source.exists():
        print("no existe", source)
        return
    rows = list(csv.DictReader(open(source, encoding="ascii")))
    prices = sorted({float(r["price"]) for r in rows})
    step = number(min(b - a for a, b in zip(prices, prices[1:]) if b - a > 0))
    stored = read_days(days_path("BTCUSDT"))
    merged = [[r["date_utc"], r["price_low"], r["price_high"], r["long_usd"], r["short_usd"], r["events"]] for day in stored for r in stored[day]]
    added = set()
    for r in rows:
        if r["date_utc"] in stored:
            continue
        low = number(float(r["price"]) - step / 2)
        merged.append([r["date_utc"], low, number(low + step), float(r["long_usd"]), float(r["short_usd"]), int(r["events"])])
        added.add(r["date_utc"])
    merged.sort(key=lambda r: (r[0], float(r[1])))
    write_rows(days_path("BTCUSDT"), DAYS_HEADER, merged)
    print("BTCUSDT MarginPad importado: dias nuevos", len(added), "paso", step)


if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in ("importar", "binance", "marginpad", "bitfinex", "bitfinex-armar", "coinalyze", "coinalyze-armar"):
        print(__doc__)
        sys.exit(1)
    command, symbols = sys.argv[1], [re.sub(r"[^A-Z0-9]", "", s.upper()) for s in sys.argv[2:]]
    if command == "importar":
        importar()
    if command.startswith("coinalyze"):
        for symbol in symbols:
            try:
                if command == "coinalyze":
                    coinalyze_download(symbol)
                coinalyze_build(symbol)
            except SystemExit:
                raise  # Sin clave o clave rechazada: no sirve seguir con las demas
            except Exception as error:  # Una moneda que falla no detiene las demas
                print(symbol, "error", repr(error), flush=True)
        sys.exit(0)
    if command == "bitfinex":
        # Opcional: --tramo AAAA-MM-DD AAAA-MM-DD baja solo ese tramo
        if len(symbols) >= 1 and sys.argv[2] == "--tramo":
            day = lambda text: int(dt.datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
            bitfinex_download(day(sys.argv[3]), day(sys.argv[4]))
            symbols = [re.sub(r"[^A-Z0-9]", "", s.upper()) for s in sys.argv[5:]]
        else:
            bitfinex_download()
    if command.startswith("bitfinex"):
        stored = _bitfinex_rows()
        for symbol in symbols:
            bitfinex_build(symbol, stored)
        sys.exit(0)
    for symbol in symbols:
        try:
            (binance if command == "binance" else marginpad)(symbol)
        except Exception as error:  # Una moneda que falla no detiene las demas
            print(symbol, "error", repr(error))
