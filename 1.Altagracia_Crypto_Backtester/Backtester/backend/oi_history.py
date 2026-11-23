"""
OI de 5 minutos de Bybit y de Binance para el probador (21/11/2026).

Pedido del usuario para las estrategias de Byko con el interés abierto: el OI de los dos exchanges con el detalle más
fino que dan. Los dos dan 5 minutos desde que listan cada moneda, y el OI es una foto: el de 15 minutos, 1 hora o
4 horas es el de 5 minutos en su marca. De aquí salen todos los marcos.

- Bybit (`/v5/market/open-interest`, `intervalTime=5min`): `openInterest`, en monedas, cuenta los dos lados (su
  `singleOpenInterest` es justo la mitad). BTC desde 2020-07; cada moneda desde que Bybit la lista.
- Binance (`data.binance.vision/data/futures/um/daily/metrics/{par}/`, un archivo por día): el OI de un lado
  (`sum_open_interest`, en monedas, y `sum_open_interest_value`, en USD). En el mismo archivo vienen además:
  · las proporciones de largos y cortos de las cuentas grandes, por cuentas y por posiciones;
  · la de todas las cuentas;
  · la de la compra contra la venta agresiva.
  BTC desde 2020-09-01; casi todas desde 2021-12-01. SHIB1000USDT es 1000SHIBUSDT; CROUSDT no está en Binance.

Se guarda en OrderFlowData/oi/5m/bybit/{moneda}.npz y OrderFlowData/oi/5m/binance/{moneda}.npz, fuera del repositorio
(TESTER_OI5M cambia la carpeta).

Sin futuro: cada dato se usa 5 minutos después de su marca (`LAG_MS`), por si la marca es el inicio de su intervalo.
`series(..., "sum")` suma los dos en monedas y de un lado: Binance + Bybit ÷ 2, solo en las marcas que tienen los dos.

    python -B oi_history.py --backfill [MONEDAS...]   toda la historia; si se corta, se retoma donde quedó
    python -B oi_history.py [MONEDAS...]              pone al día las que ya tienen archivo (lo que hace market_update)
    --source bybit | --source binance                 solo uno de los dos

Sin monedas: las 50 del probador (las que tienen OI de 4 horas).
"""
import io
import os
import re
import sys
import threading
import time
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from xml.etree import ElementTree

import httpx
import numpy as np

import oi_store

DIR = Path(os.environ.get("TESTER_OI5M", str(Path(oi_store.OI_DIR) / "5m")))
SOURCES = ("bybit", "binance")
STEP_MS = 5 * 60000
LAG_MS = STEP_MS
DAY_MS = 86400000
FIRST_MS = 1577836800000  # 2020-01-01: antes no hay nada en ninguno de los dos
LOCK_HOURS = 2            # El candado se renueva con cada guardado; uno sin renovar en 2 horas quedó de una bajada cortada

BYBIT_URL = "https://api.bybit.com/v5/market/open-interest"
BYBIT_PAGE = 200
BYBIT_RATE = 20       # Pedidos por segundo entre todas las monedas: la sexta parte del límite de Bybit por IP (600 cada 5 s)
BYBIT_WORKERS = 16    # Monedas a la vez en la bajada completa: cada una va de a una página (0.5 a 2 s cada una)
CHECKPOINT = 400      # Páginas de Bybit entre dos guardados de una moneda al ir hacia atrás (unos 9 meses)

BINANCE_LIST = "https://s3-ap-northeast-1.amazonaws.com/data.binance.vision"
BINANCE_FILES = "https://data.binance.vision"
BINANCE_PREFIX = "data/futures/um/daily/metrics/"
BINANCE_NAMES = {"SHIB1000USDT": "1000SHIBUSDT"}
BINANCE_RATE = 40
BINANCE_WORKERS = 24  # Archivos a la vez de una moneda: cada uno tarda más de 1 s en llegar, aunque pesa 12 KB
BINANCE_BATCH = 200   # Días entre dos guardados de una moneda
BINANCE_COLUMNS = {   # Campo guardado → columna del archivo
    "oi": "sum_open_interest", "usd": "sum_open_interest_value",
    "top_acc": "count_toptrader_long_short_ratio", "top_pos": "sum_toptrader_long_short_ratio",
    "ls_acc": "count_long_short_ratio", "taker": "sum_taker_long_short_vol_ratio"}
BINANCE_ORDER = ("create_time", "symbol", "sum_open_interest", "sum_open_interest_value",
                 "count_toptrader_long_short_ratio", "sum_toptrader_long_short_ratio", "count_long_short_ratio",
                 "sum_taker_long_short_vol_ratio")  # Orden de las columnas si un archivo no trae encabezado
S3_NS = "{http://s3.amazonaws.com/doc/2006-03-01/}"
SERIES = {"bybit": ("oi",), "binance": tuple(BINANCE_COLUMNS)}


def _print(message):
    print(message, flush=True)


# ---------------------------------------------------------------- Guardado

_cache = {}


def path(source, symbol):
    return DIR / source / f"{symbol}.npz"


def load(source, symbol):
    """Lo guardado de una moneda ({"t": ms, "oi": ..., ...}) o None. Se vuelve a leer solo si el archivo cambió."""
    p = path(source, symbol)
    try:
        stamp = p.stat().st_mtime_ns
    except OSError:
        return None
    hit = _cache.get(p)
    if hit and hit[0] == stamp:
        return hit[1]
    try:
        with np.load(p) as z:
            data = {k: z[k] for k in z.files}
    except (OSError, ValueError, zipfile.BadZipFile):
        return hit[1] if hit else None  # Se está escribiendo: sigue valiendo lo leído antes
    _cache[p] = (stamp, data)
    return data


def save(source, symbol, data):
    """Escribe con temporal y reemplazo; reintenta si un lector tiene el archivo abierto."""
    p = path(source, symbol)
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{symbol}.tmp.npz")
    np.savez_compressed(tmp, **data)
    error = None
    for _ in range(30):
        try:
            os.replace(tmp, p)
            return
        except PermissionError as e:
            error = e
            time.sleep(0.5)
    raise error


def merge(old, new, fields):
    """Une por tiempo lo guardado y lo nuevo: ordenado, sin marcas repetidas y con lo nuevo ganando."""
    parts = [x for x in (old, new) if x is not None and len(x["t"])]
    if not parts:
        return {"t": np.zeros(0, dtype=np.int64), **{f: np.zeros(0) for f in fields}}
    t = np.concatenate([x["t"] for x in parts]).astype(np.int64)
    order = np.argsort(t, kind="stable")
    t = t[order]
    last = np.r_[t[1:] != t[:-1], True]  # Con orden estable, de cada marca repetida queda la de lo nuevo
    out = {"t": t[last]}
    for f in fields:
        out[f] = np.concatenate([x[f] for x in parts])[order][last]
    return out


# ---------------------------------------------------------------- Una bajada a la vez

def _lock_path():
    return DIR / "descarga.lock"


def take_lock():
    lock = _lock_path()
    lock.parent.mkdir(parents=True, exist_ok=True)
    try:
        if time.time() - lock.stat().st_mtime >= LOCK_HOURS * 3600:
            lock.unlink(missing_ok=True)  # Quedó de una bajada cortada
    except OSError:
        pass
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        return False
    os.write(fd, str(os.getpid()).encode())
    os.close(fd)
    return True


def _touch_lock():
    try:
        os.utime(_lock_path())
    except OSError:
        pass


def release_lock():
    _lock_path().unlink(missing_ok=True)


# ---------------------------------------------------------------- Pedidos

class Pace:
    """Reparte los pedidos de todos los hilos a un ritmo fijo."""

    def __init__(self, per_second):
        self.gap = 1.0 / per_second
        self.lock = threading.Lock()
        self.next = 0.0

    def __call__(self):
        with self.lock:
            now = time.monotonic()
            turn = max(now, self.next)
            self.next = turn + self.gap
        if turn > now:
            time.sleep(turn - now)


class NotListed(Exception):
    """La moneda no existe en ese exchange."""


def _client():
    return httpx.Client(timeout=30, headers={"User-Agent": "app1-oi"}, follow_redirects=True)


def bybit_page(client, symbol, start, end, pace=None):
    """Hasta 200 datos entre start y end, los más nuevos primero. Reintenta si Bybit frena o falla la red."""
    error = None
    for attempt in range(8):
        if pace:
            pace()
        try:
            r = client.get(BYBIT_URL, params={"category": "linear", "symbol": symbol, "intervalTime": "5min",
                                              "startTime": int(start), "endTime": int(end), "limit": BYBIT_PAGE})
            if r.status_code == 200:
                data = r.json()
                code = data.get("retCode")
                if code == 0:
                    return (data.get("result") or {}).get("list") or []
                if code == 10001:  # Parámetros: la moneda no existe
                    raise NotListed(f"{symbol}: {data.get('retMsg')}")
                error = f"retCode {code}: {data.get('retMsg')}"  # 10006: demasiados pedidos
            else:
                error = f"HTTP {r.status_code}"
        except NotListed:
            raise
        except Exception as e:  # Red o respuesta rota
            error = str(e) or type(e).__name__
        time.sleep(min(60, 2 * 2 ** attempt))
    raise RuntimeError(f"{symbol} {start}-{end}: {error}")


def _get(client, url, params=None, pace=None, tries=6):
    """La respuesta, o None si no existe (404). Reintenta lo demás."""
    error = None
    for attempt in range(tries):
        if pace:
            pace()
        try:
            r = client.get(url, params=params)
            if r.status_code == 200:
                return r
            if r.status_code == 404:
                return None
            error = f"HTTP {r.status_code}"
        except Exception as e:
            error = str(e) or type(e).__name__
        time.sleep(min(30, 1.5 * 2 ** attempt))
    raise RuntimeError(f"{url}: {error}")


# ---------------------------------------------------------------- Bybit

def _store_bybit(symbol, data, ts, vs, done):
    new = {"t": np.array(ts, dtype=np.int64), "oi": np.array(vs, dtype=np.float64)}
    out = merge(data, new, SERIES["bybit"])
    out["done"] = np.array(1 if done else 0, dtype=np.int8)
    save("bybit", symbol, out)
    _touch_lock()
    return out


def update_bybit(symbol, client, backfill=False, pace=None, log=_print):
    """
    Pone al día el OI de 5 minutos de Bybit de una moneda. Sin archivo solo empieza con `backfill`.

    Hacia atrás guarda cada CHECKPOINT páginas: lo guardado queda seguido, y la bajada siguiente sigue desde lo más
    viejo. Lo nuevo (desde el último dato) se guarda de una vez: un corte a medias dejaría un hueco sin rellenar.
    `done` dice que se llegó al primer dato de Bybit.
    """
    old = load("bybit", symbol)
    if old is None and not backfill:
        return None
    now = int(time.time() * 1000)
    done = bool(old is not None and int(old.get("done", 0)))
    spans = []
    if old is not None and len(old["t"]):
        spans.append((int(old["t"][-1]) + 1, now, False))
        if backfill and not done:
            spans.append((FIRST_MS, int(old["t"][0]) - 1, True))
    elif backfill:
        spans.append((FIRST_MS, now, True))
    data = old
    for start, end, back in spans:
        ts, vs = [], []
        t1 = end
        while t1 > start:
            rows = bybit_page(client, symbol, start, t1, pace)
            if not rows:
                break
            stamps = [int(x["timestamp"]) for x in rows]
            ts += stamps
            vs += [float(x["openInterest"]) for x in rows]
            t1 = min(stamps) - 1
            if back and len(ts) >= CHECKPOINT * BYBIT_PAGE:
                data = _store_bybit(symbol, data, ts, vs, done)
                ts, vs = [], []
        if back:
            done = True  # Página vacía o llegó a 2020: no hay nada más viejo
        if ts or back:
            data = _store_bybit(symbol, data, ts, vs, done)
    return data


# ---------------------------------------------------------------- Binance

def binance_symbol(symbol):
    return BINANCE_NAMES.get(symbol, symbol)


def _day_num(text):
    return int(datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() // 86400)


def _day_text(num):
    return time.strftime("%Y-%m-%d", time.gmtime(int(num) * 86400))


def binance_days(client, symbol, after=None, pace=None):
    """Días con archivo en Binance ('AAAA-MM-DD'); con `after`, solo los posteriores."""
    pair = binance_symbol(symbol)
    prefix = f"{BINANCE_PREFIX}{pair}/"
    marker = f"{prefix}{pair}-metrics-{after}.zip.CHECKSUM" if after else ""
    days = []
    while True:
        r = _get(client, BINANCE_LIST, {"delimiter": "/", "prefix": prefix, "marker": marker}, pace)
        if r is None:
            break
        root = ElementTree.fromstring(r.content)
        keys = [k.text or "" for k in root.iter(S3_NS + "Key")]
        days += [m.group(1) for k in keys if (m := re.search(r"-metrics-(\d{4}-\d{2}-\d{2})\.zip$", k))]
        if root.findtext(S3_NS + "IsTruncated") != "true" or not keys:
            break
        marker = root.findtext(S3_NS + "NextMarker") or keys[-1]
    return sorted(set(days))


def _ms(text):
    text = text.strip()
    if text.isdigit():
        value = int(text)
        return value * 1000 if value < 10 ** 11 else value
    return int(datetime.strptime(text[:19], "%Y-%m-%d %H:%M:%S").replace(tzinfo=timezone.utc).timestamp() * 1000)


def parse_metrics(blob):
    """Las filas de un archivo diario de Binance: {"t": ms en su marca de 5 minutos, "oi": ..., ...}."""
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        text = z.read(z.namelist()[0]).decode("utf-8", "replace")
    lines = [line for line in text.splitlines() if line.strip()]
    cols = list(BINANCE_ORDER)
    if lines and not lines[0][:1].isdigit():
        cols = [c.strip() for c in lines[0].split(",")]
        lines = lines[1:]
    at = {c: i for i, c in enumerate(cols)}
    t, values = [], {f: [] for f in BINANCE_COLUMNS}
    for line in lines:
        parts = line.split(",")
        try:
            stamp = _ms(parts[at["create_time"]])
        except (KeyError, IndexError, ValueError):
            continue
        t.append(stamp - stamp % STEP_MS)
        for f, column in BINANCE_COLUMNS.items():
            j = at.get(column)
            try:
                values[f].append(float(parts[j]) if j is not None and j < len(parts) and parts[j].strip() else np.nan)
            except ValueError:
                values[f].append(np.nan)
    out = {"t": np.array(t, dtype=np.int64)}
    for f in BINANCE_COLUMNS:
        out[f] = np.array(values[f], dtype=np.float64 if f in ("oi", "usd") else np.float32)
    return out


def update_binance(symbol, client, backfill=False, pace=None, log=_print):
    """
    Pone al día el OI de 5 minutos de Binance de una moneda. Sin archivo solo empieza con `backfill`.

    `days` son los días ya bajados; `bad`, los que Binance lista pero no se pudieron leer (la bajada completa los
    vuelve a pedir). Sin `backfill` solo se listan los días posteriores al último bajado.
    """
    old = load("binance", symbol)
    if old is None and not backfill:
        return None
    have = set(old["days"].tolist()) if old is not None else set()
    bad = set(old["bad"].tolist()) if old is not None and "bad" in old else set()
    after = _day_text(max(have | bad)) if (have | bad) and not backfill else None
    wanted = [d for d in binance_days(client, symbol, after, pace) if _day_num(d) not in have]
    if not wanted:
        if old is None:
            log(f"{symbol} binance: no está en Binance")
        return old
    pair = binance_symbol(symbol)
    local, made = threading.local(), []

    def fetch(day):
        if not hasattr(local, "client"):
            local.client = client if BINANCE_WORKERS == 1 else _client()
            if local.client is not client:
                made.append(local.client)
        r = _get(local.client, f"{BINANCE_FILES}/{BINANCE_PREFIX}{pair}/{pair}-metrics-{day}.zip", pace=pace)
        try:
            return day, (parse_metrics(r.content) if r is not None else None)
        except (zipfile.BadZipFile, KeyError, IndexError, ValueError):
            return day, None

    fields = SERIES["binance"]
    data = old
    try:
        with ThreadPoolExecutor(BINANCE_WORKERS) as pool:
            for i in range(0, len(wanted), BINANCE_BATCH):
                fresh = []
                for day, rows in pool.map(fetch, wanted[i:i + BINANCE_BATCH]):
                    if rows is not None and len(rows["t"]):
                        have.add(_day_num(day))
                        bad.discard(_day_num(day))
                        fresh.append(rows)
                    else:
                        bad.add(_day_num(day))
                batch = {"t": np.concatenate([x["t"] for x in fresh])} if fresh else None
                if batch is not None:
                    for f in fields:
                        batch[f] = np.concatenate([x[f] for x in fresh])
                data = merge(data, batch, fields)  # Una vez por tanda: ordenar todo en cada día sería lento
                data["days"] = np.array(sorted(have), dtype=np.int32)
                data["bad"] = np.array(sorted(bad), dtype=np.int32)
                save("binance", symbol, data)
                _touch_lock()
    finally:
        for c in made:
            c.close()
    return data


# ---------------------------------------------------------------- Lectura

def _valid(t, v, positive):
    ok = np.isfinite(v)
    if positive:
        ok &= v > 0
    return (t[ok], v[ok]) if ok.any() else None


def series(symbol, source="bybit", field="oi"):
    """
    (tiempos en ms, valores) de "bybit", "binance" o "sum" (Binance + Bybit ÷ 2, en monedas). None sin datos.

    Deja fuera los datos vacíos y, en el OI y su valor en USD, los ceros: Binance trae algunos sueltos (57 en ARB),
    y un cero no es un OI real. Sin ellos, la vela usa el dato anterior.
    """
    if source == "sum":
        a, b = load("bybit", symbol), load("binance", symbol)
        if a is None or b is None or not len(a["t"]) or not len(b["t"]):
            return None
        t, ia, ib = np.intersect1d(a["t"], b["t"], assume_unique=True, return_indices=True)
        if not len(t):
            return None
        x, y = a["oi"][ia], b["oi"][ib]
        ok = np.isfinite(x) & np.isfinite(y) & (x > 0) & (y > 0)
        return (t[ok], y[ok] + x[ok] / 2) if ok.any() else None
    d = load(source, symbol)
    if d is None or field not in d or not len(d["t"]):
        return None
    return _valid(d["t"], d[field], field in ("oi", "usd"))


def at_close(symbol, bars, tf, source="bybit", field="oi"):
    """
    El valor conocido al cierre de cada vela de `tf` minutos: el último dato con su marca + LAG_MS ≤ cierre.
    NaN sin serie, o si el último dato es más viejo que 2 pasos de la serie (o que 2 velas): es un hueco.
    """
    out = np.full(len(bars), np.nan)
    s = series(symbol, source, field)
    if s is None or not len(bars):
        return out
    times, values = s
    seen = np.array([b["t"] for b in bars], dtype=np.int64) + tf * 60000 - LAG_MS
    k = np.searchsorted(times, seen, side="right") - 1
    ok = k >= 0
    out[ok] = values[k[ok]]
    age = seen - np.where(ok, times[np.clip(k, 0, None)], 0)
    out[age > 2 * max(STEP_MS, tf * 60000)] = np.nan
    return out


def coins():
    """Las 50 monedas del probador: las que tienen OI de 4 horas."""
    return sorted(p.name.split("_")[0] for p in Path(oi_store.OI_DIR).glob("*_4h.json"))


def summary(source, symbol, data):
    if data is None or not len(data["t"]):
        return f"{symbol} {source}: sin datos"
    day = lambda ms: time.strftime("%Y-%m-%d", time.gmtime(ms / 1000))
    return f"{symbol} {source}: {len(data['t']):,} datos, {day(int(data['t'][0]))} a {day(int(data['t'][-1]))}"


# ---------------------------------------------------------------- Bajada

def run(symbols=None, sources=SOURCES, backfill=False, log=_print):
    """Baja (backfill) o pone al día las monedas. Devuelve las fallas [(fuente, moneda, error)], o None si otra bajada sigue."""
    if not take_lock():
        log("otra bajada del OI de 5 minutos sigue corriendo")
        return None
    failed = []
    try:
        symbols = list(symbols or coins())
        jobs = []
        if "bybit" in sources:
            pace = Pace(BYBIT_RATE)

            def by(s):
                with _client() as c:
                    return update_bybit(s, c, backfill, pace, log)
            jobs.append(("bybit", by, BYBIT_WORKERS if backfill else 2))
        if "binance" in sources:
            pace_b = Pace(BINANCE_RATE)

            def bn(s):
                with _client() as c:
                    return update_binance(s, c, backfill, pace_b, log)
            jobs.append(("binance", bn, 1))

        def side(name, fn, workers):
            def one(s):
                try:
                    d = fn(s)
                    if d is not None:
                        log(summary(name, s, d))
                except Exception as e:  # Una moneda que falla no detiene a las demás
                    failed.append((name, s, str(e)))
                    log(f"{s} {name} falló: {e}")
                _touch_lock()
            with ThreadPoolExecutor(workers) as pool:
                list(pool.map(one, symbols))

        threads = [threading.Thread(target=side, args=job) for job in jobs]
        for th in threads:
            th.start()
        for th in threads:
            th.join()
    finally:
        release_lock()
    return failed


if __name__ == "__main__":
    args = sys.argv[1:]
    backfill = "--backfill" in args
    sources = SOURCES
    if "--source" in args:
        i = args.index("--source")
        sources = (args[i + 1],)
        args = args[:i] + args[i + 2:]
    names = [a for a in args if not a.startswith("--")]
    t0 = time.time()
    _print(f"=== {time.strftime('%Y-%m-%d %H:%M')} OI de 5 minutos ({', '.join(sources)})"
           f"{', toda la historia' if backfill else ''}")
    bad = run(names or None, sources, backfill)
    if bad is None:
        sys.exit(0)
    _print(f"=== terminada en {(time.time() - t0) / 60:.1f} min, {len(bad)} fallas")
    for name, s, e in bad:
        _print(f"   {s} {name}: {e}")
