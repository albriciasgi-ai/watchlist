# scan_follow.py - Seguimiento de los hallazgos del scanner (24/11/2026; plan en docs/PLAN_SEGUIMIENTO_SCANNER.md).
#
# Lee lo que el scanner ya anota en data/scanner (events/ y log/) y arma un hallazgo cada vez que una moneda entra a En
# juego, Tendencia o Rapidos sin estar en ninguna, y sin haber salido de todas en las 2 h anteriores. En cada vuelta del
# scanner suma 2 candidatas que no entraron a ninguna lista: el control. A las 24 h y 10 min pide a Bybit la historia de
# t0 - 24 h a t0 + 24 h (velas, OI, cuentas en largo y prima del funding, de 5 min, y las velas de 15 min de 35 dias) y mide:
#   - el movimiento importante (la primera vez a 3 ATR de 1 h del precio del hallazgo) y si sigue o gira;
#   - la carrera a 2 ATR y lo maximo a favor y en contra a 1, 4, 12 y 24 h;
#   - las variables al hallazgo y los elementos de velas del probador de App 1 (35 desde su motor 7), en 15 min y 1 h.
# Todo sale de la historia publica de Bybit: si la suite estuvo cerrada, se mide al abrirla y da lo mismo. Lo que anoto el
# scanner antes de encenderse esto (desde el 23/11) se arma igual. Nunca envia nada ni graba nada en vivo.
#
#   GET /api/follow/status         estado: abiertos, medidos, en espera y errores
#   GET /api/follow/episodes       la lista de los ultimos 14 dias (?days=, ?kind=hallazgo|control|todos, ?lista=,
#                                  ?startup=0|1)
#   GET /api/follow/episode/{id}   uno completo, con sus velas de 5 min y sus elementos (abierto: lo que va hasta ahora)
#   GET /api/follow/report         el informe del plan (?days= hasta 90, ?startup=1 suma los del arranque)
#
# Datos en data/scanner/follow, con un miembro gzip por linea como el registro del scanner: episodes/AAAA-MM-DD.jsonl.gz
# (la foto al abrirse), index/AAAA-MM-DD.jsonl.gz (lo medido, en corto: la lista y el informe) y closed/AAAA-MM-DD.jsonl.gz
# (lo medido completo de los hallazgos, con su serie en velas de 15 min); state.json y follow.lock (un solo proceso por
# carpeta). SUITE_FOLLOW=0 lo apaga; sin esa variable vale SUITE_SCANNER (y SUITE_SWING, que las
# pruebas ponen en 0). Las rutas siguen.
import asyncio
import gzip
import hashlib
import json
import logging
import math
import os
import re
import statistics
import time
import zlib
from collections import OrderedDict, deque
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.concurrency import run_in_threadpool

import scanner as scn
import swing_watch

logger = logging.getLogger("suite.follow")

MIN = 60_000
HOUR = 3_600_000
DAY = 86_400_000
STEP5 = 5 * MIN
WINDOW = 24 * HOUR             # lo que se mira despues del hallazgo (y antes, para la foto de la historia)
CLOSE_AFTER = WINDOW + 10 * MIN
REENTRY = 2 * HOUR             # volver a una lista antes de esto es el mismo hallazgo
BLIND = 30 * MIN               # sin mirar mas que esto antes de la vuelta: hallazgo del arranque
HOLD_EVENTS = 3 * MIN          # un evento se lee cuando la vuelta que lo dio ya escribio su registro
CONTROLS_PER_CYCLE = 2
BIG_ATR = 3.0
TOUCH_ATR = 2.0
HORIZONS = {"1h": 12, "4h": 48, "12h": 144, "24h": 288}   # velas de 5 min
FULL_BARS = HORIZONS["24h"]
WARM_DAYS = 35                 # velas de 15 min para los elementos: el Lector VPA y el volumen por hora miran 30 dias
LISTS = ("enjuego", "tendencia", "rapidos")
LIST_NAMES = {"enjuego": "En juego", "tendencia": "Tendencia", "rapidos": "Rápidos"}
TICK_S = 60
BACKLOG_S = 15                 # con hallazgos atrasados (al encenderse con lo ya anotado), la vuelta siguiente llega antes
START_DELAY_S = 45
CLOSES_PER_TICK = 3            # unos 11 pedidos a Bybit y 4 s de calculo cada uno
RETRY_MS = 10 * MIN
MAX_TRIES = 12
CYCLE_ATS_KEEP = 60
CYCLES_IN_MEMORY = 16
INDEX_DAYS = 14                # la lista: lo medido de estos dias queda en memoria (sin el detalle de sus elementos)
REPORT_DAYS = 90               # el informe lee lo medido del disco
REPORT_CACHE_S = 120
DETAIL_CACHE = 12
DETAIL_OPEN_S = 120            # lo de un hallazgo abierto se vuelve a pedir cada 2 min como mucho
BTC_SPAN = 1000 * STEP5        # tramos de velas de 5 min de BTC que se guardan en memoria
MIN_SIG = 8                    # en el informe, un elemento con menos casos no se mira
SIG_AT = (-60, 0)              # "al hallazgo": conocido en la hora anterior a t0 (minutos)
SIG_FIRST = (0, 60)            # en la primera hora despues
SYMBOL_RE = scn.SYMBOL_RE
ID_RE = re.compile(r"^[HC]-\d{8}-\d{6}-[A-Z0-9]{1,24}USDT$")
DAY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
SUMMARY_FIELDS = ("rvol_1h", "rvol_24h", "ret_1h", "ret_24h", "resid_24h", "resid_7d", "atr_1h", "oi_1h", "oi_4h",
                  "oi_24h", "funding_8h", "cost_r_1h", "er_7d", "break20", "above_ma20", "vol_exp", "turnover24h",
                  "spread_bps", "range_30d", "corr_7d", "beta_30d")
STATS = {"requests": 0}


def _now_ms() -> int:
    return int(time.time() * 1000)


def _env_off() -> bool:
    value = os.environ.get("SUITE_FOLLOW")
    if value is not None:
        return value == "0"
    return scn._env_off()


def _day(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def make_id(kind: str, t0: int, sym: str) -> str:
    stamp = datetime.fromtimestamp(t0 / 1000, tz=timezone.utc).strftime("%Y%m%d-%H%M%S")
    return f"{'H' if kind == 'hallazgo' else 'C'}-{stamp}-{sym}"


def day_of_id(rid: str) -> str:
    d = rid[2:10]
    return f"{d[:4]}-{d[4:6]}-{d[6:8]}"


def _num(x):
    try:
        x = float(x)
    except (TypeError, ValueError):
        return None
    return x if math.isfinite(x) else None


def _rd(x, digits=3):
    x = _num(x)
    return None if x is None else round(x, digits)


def _sig(x, digits=4):
    """Pocas cifras significativas (volumenes en la serie guardada)."""
    x = _num(x)
    return None if x is None else float(f"{x:.{digits}g}")


def side_of(lista: str, f: dict, chips) -> int:
    """El lado del hallazgo: el de la lista en la que entro (plan, "Su lado")."""
    if lista == "tendencia" and f.get("break20"):
        return 1 if f["break20"] > 0 else -1
    if lista == "rapidos" and chips:
        text = str(chips[0]).strip()
        if text[:1] in ("-", "−"):
            return -1
        if text[:1] == "+":
            return 1
    move = f.get("resid_24h") if f.get("resid_24h") is not None else f.get("ret_24h")
    return 1 if (move or 0) >= 0 else -1


# ==================== lo que ya anoto el scanner ====================

def complete_lines(data: bytes) -> list:
    """Las lineas enteras de un archivo que otro proceso todavia puede estar escribiendo (la ultima puede ir a medias)."""
    return [p.decode("utf-8", "replace") for p in data.split(b"\n")[:-1]]


def read_members(path: Path) -> list:
    """Las lineas de un archivo de miembros gzip agregados uno a uno (el registro del scanner, lo medido). Un miembro
    cortado (el PC se apago al escribir) se salta y se sigue con el siguiente; el ultimo, a medias, espera."""
    try:
        data = Path(path).read_bytes()
    except OSError:
        return []
    out, pos, size = [], 0, len(data)
    while pos < size:
        d = zlib.decompressobj(wbits=31)
        try:
            chunk = d.decompress(data[pos:])
            ok = d.eof
        except zlib.error:
            chunk, ok = b"", False
        if not ok:
            nxt = data.find(b"\x1f\x8b\x08", pos + 1)
            if nxt < 0:
                break
            pos = nxt
            continue
        for line in chunk.decode("utf-8", "replace").splitlines():
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
        pos = size - len(d.unused_data)
    return out


def parse_event(line: str):
    try:
        e = json.loads(line)
    except ValueError:
        return None
    if not isinstance(e, dict) or not isinstance(e.get("at"), int) or e.get("type") not in ("entra", "sale"):
        return None
    if e.get("list") not in LISTS or not SYMBOL_RE.match(str(e.get("symbol") or "")):
        return None
    return e


def read_events(path: Path) -> list:
    try:
        data = path.read_bytes()
    except OSError:
        return []
    return [parse_event(line) for line in complete_lines(data)]   # None donde la linea no sirve (cuenta igual)


def bar_hour(bars: list) -> list:
    """Velas de 1 h con las de 15 min (solo las horas completas)."""
    out, group = [], []
    for b in bars:
        if group and group[0]["t"] // HOUR != b["t"] // HOUR:
            if len(group) == 4:
                out.append(_join(group))
            group = []
        group.append(b)
    if len(group) == 4:
        out.append(_join(group))
    return out


def _join(group):
    return {"t": group[0]["t"] // HOUR * HOUR, "o": group[0]["o"], "h": max(b["h"] for b in group),
            "l": min(b["l"] for b in group), "c": group[-1]["c"], "delta": 0.0, "vol": sum(b["vol"] for b in group)}


_CODES = None


def app1_codes() -> list:
    """Los elementos de velas del probador de App 1 que se pueden calcular con las velas de Bybit de cualquier moneda."""
    global _CODES
    if _CODES is None:
        import byko
        import rule_tester as rt
        import signal_sweep as sw
        _CODES = [c for c in rt.CANDLE_CODES if c not in sw.SKIP_CODES and c not in byko.OI_CODES]
    return _CODES


def app1_elements(symbol: str, k15: list, t0: int) -> list:
    """Los elementos del probador de App 1 (ajustes de fabrica, los del barrido) en 15 min y en 1 h, en la vela en que se
    conocen, de t0 - 24 h a t0 + 24 h: [codigo, marco, minutos desde t0, lado]."""
    import rule_tester as rt
    import signal_sweep as sw
    bars15 = [{"t": b[0], "o": b[1], "h": b[2], "l": b[3], "c": b[4], "delta": 0.0, "vol": b[5]} for b in k15]
    out = []
    for tf, bars in ((15, bars15), (60, bar_hour(bars15))):
        if len(bars) < 100:
            continue
        ctx = rt._context(symbol, tf, bars)
        ctx["bars"], ctx["lead"] = bars, 0
        span = {"bars": bars, "events": [], "lead": 0, "warm": []}
        found = sw.element_signals(symbol, tf, span, ctx, app1_codes())
        step = tf * MIN
        for code, signals in found.items():
            for k, side in signals:
                known = bars[k]["t"] + step
                if t0 - WINDOW <= known <= t0 + WINDOW:
                    out.append([code, tf, round((known - t0) / MIN), int(side)])
    out.sort(key=lambda s: (s[2], s[1], s[0]))
    return out


# ==================== medir ====================

def _last_before(series: list, t: int):
    """El valor de la ultima fila [t, valor] en o antes de t."""
    lo, hi = 0, len(series)
    while lo < hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= t:
            lo = mid + 1
        else:
            hi = mid
    return series[lo - 1][1] if lo else None


def _close_at(bars: list, t: int):
    """El cierre de la ultima vela de 5 min ([t, o, h, l, c, ...]) que termina en o antes de t."""
    lo, hi = 0, len(bars)
    while lo < hi:
        mid = (lo + hi) // 2
        if bars[mid][0] + STEP5 <= t:
            lo = mid + 1
        else:
            hi = mid
    return bars[lo - 1][4] if lo else None


def atr_from_15m(k15: list, t0: int):
    """ATR de 1 h (14 velas, en fraccion del precio) con las velas de 15 min anteriores a t0, como lo mide el scanner."""
    bars = [{"t": b[0], "o": b[1], "h": b[2], "l": b[3], "c": b[4], "delta": 0.0, "vol": b[5]} for b in k15 if b[0] + 15 * MIN <= t0]
    hourly = bar_hour(bars)
    if len(hourly) < 15:
        return None
    return scn.atr_pct(hourly)


def outcome(after: list, t0: int, p0: float, unit: float, side: int) -> dict:
    """Lo que hizo el precio desde p0 en las velas de 5 min que empiezan en o despues de t0, en ATR, visto desde el lado."""
    o = {"bars": len(after), "complete": len(after) >= FULL_BARS}
    for name, n in HORIZONS.items():
        seg = after[:n]
        if len(seg) < n:
            o[name] = None
            continue
        up = (max(b[2] for b in seg) - p0) / unit
        down = (p0 - min(b[3] for b in seg)) / unit
        close = (seg[-1][4] - p0) / unit
        fav, adv = (up, down) if side > 0 else (down, up)   # lo maximo a favor y en contra: nunca menos que cero
        o[name] = {"fav": _rd(max(0.0, fav)), "adv": _rd(max(0.0, adv)), "close": _rd(close * side)}
    big = touch = touch_min = None
    for b in after[:FULL_BARS]:
        hi, lo = (b[2] - p0) / unit, (p0 - b[3]) / unit
        minutes = round((b[0] + STEP5 - t0) / MIN)
        if touch is None:
            if hi >= TOUCH_ATR and lo >= TOUCH_ATR:
                touch = "las dos"
            elif hi >= TOUCH_ATR:
                touch = "sigue" if side > 0 else "gira"
            elif lo >= TOUCH_ATR:
                touch = "gira" if side > 0 else "sigue"
            if touch:
                touch_min = minutes
        if big is None and (hi >= BIG_ATR or lo >= BIG_ATR):
            way = 1 if hi >= lo else -1
            big = {"min": minutes, "way": "sigue" if way == side else "gira", "t": b[0], "both": hi >= BIG_ATR and lo >= BIG_ATR}
        if big and touch:
            break
    if touch is None and o["complete"]:
        touch = "ninguna"
    o["big"], o["touch"], o["touch_min"] = big, touch, touch_min
    return o


def variables(data: dict, t0: int, p0: float, unit: float, side: int) -> dict:
    """Lo que dice la historia de Bybit al hallazgo (y el OI y BTC despues, para describir)."""
    k5, oi, ls, prem = data.get("k5") or [], data.get("oi") or [], data.get("ls") or [], data.get("prem") or []
    btc = [[t, 0, 0, 0, c] for t, c in (data.get("btc") or [])]
    h = {}
    oi0 = _last_before(oi, t0)
    oi_end = oi[-1][0] if oi else 0
    then = _last_before(oi, t0 - HOUR)
    h["oi_pre1h"] = _rd(oi0 / then - 1, 4) if oi0 and then else None
    for key, dt in (("oi_1h", HOUR), ("oi_4h", 4 * HOUR)):
        later = _last_before(oi, t0 + dt) if t0 + dt <= oi_end else None
        h[key] = _rd(later / oi0 - 1, 4) if oi0 and later else None
    long0, long1 = _last_before(ls, t0), _last_before(ls, t0 - HOUR)
    h["long"] = _rd(long0, 4)
    h["long_chg1h"] = _rd(long0 - long1, 4) if long0 is not None and long1 is not None else None
    closed = [b for b in prem if b[0] + STEP5 <= t0]
    h["prem_bps"] = _rd(closed[-1][4] * 1e4, 2) if closed else None
    last12 = closed[-12:]
    h["prem1h_bps"] = _rd(sum(b[4] for b in last12) / len(last12) * 1e4, 2) if last12 else None
    last_hour = sum(b[6] for b in k5 if t0 - HOUR <= b[0] and b[0] + STEP5 <= t0)
    before = [b[6] for b in k5 if t0 - WINDOW <= b[0] and b[0] + STEP5 <= t0 - HOUR]
    h["vol_rel1h"] = _rd(last_hour / (sum(before) / (len(before) / 12)), 2) if before and sum(before) > 0 else None
    c0 = _close_at(btc, t0)
    btc_end = btc[-1][0] + STEP5 if btc else 0
    for key, dt in (("btc_pre24h", -WINDOW), ("btc_1h", HOUR), ("btc_4h", 4 * HOUR), ("btc_24h", WINDOW)):
        c = _close_at(btc, t0 + dt) if dt < 0 or t0 + dt <= btc_end else None
        h[key] = _rd(c0 / c - 1 if dt < 0 else c / c0 - 1, 4) if c0 and c else None
    for key, minutes in (("1h", 60), ("4h", 240), ("24h", 1440)):
        then = _close_at(k5, t0 - minutes * MIN)
        h[f"pre_{key}"] = _rd((p0 - then) / unit * side, 2) if then else None
    return h


SERIES_STEP = 15 * MIN         # la serie guardada (lo medido sale de las velas de 5 min)


def series(data: dict, t0: int, p0: float, unit: float, step: int = SERIES_STEP) -> dict:
    """Las 48 h para la pantalla, en velas de 15 min hechas con las de 5: precio en ATR desde p0 (arriba es arriba),
    volumen en USD, OI en % desde t0, cuentas en largo, prima en bps y BTC en % desde t0. Cada dato es el del cierre de su
    vela."""
    k5, oi, ls, prem = data.get("k5") or [], data.get("oi") or [], data.get("ls") or [], data.get("prem") or []
    if not k5:
        return {}
    btc = data.get("btc") or []
    oi0 = _last_before(oi, t0)
    pmap = {b[0]: b[4] for b in prem}
    bmap = {t: c for t, c in btc}
    c0 = _close_at([[t, 0, 0, 0, c] for t, c in btc], t0)
    groups = []
    for b in k5:
        start = b[0] // step * step
        if groups and groups[-1][0] == start:
            g = groups[-1]
            g[2], g[3], g[4], g[5], g[6] = max(g[2], b[2]), min(g[3], b[3]), b[4], g[5] + b[6], b[0]
        else:
            groups.append([start, b[1], b[2], b[3], b[4], b[6], b[0]])   # inicio, o, h, l, c, turnover, ultima de 5 min
    out = {"start": groups[0][0], "step": step, "o": [], "h": [], "l": [], "c": [], "v": [], "oi": [], "long": [], "prem": [], "btc": []}
    for start, o, h, lo, c, v, last in groups:
        end = start + step
        out["o"].append(_rd((o - p0) / unit))
        out["h"].append(_rd((h - p0) / unit))
        out["l"].append(_rd((lo - p0) / unit))
        out["c"].append(_rd((c - p0) / unit))
        out["v"].append(_sig(v, 3))
        x = _last_before(oi, end)
        out["oi"].append(_rd((x / oi0 - 1) * 100, 2) if x and oi0 else None)
        out["long"].append(_rd(_last_before(ls, end), 3))
        out["prem"].append(_rd(pmap[last] * 1e4, 1) if last in pmap else None)
        out["btc"].append(_rd((bmap[last] / c0 - 1) * 100, 2) if c0 and last in bmap else None)
    return out


def signal_sets(signals: list, side: int, big) -> dict:
    """Lo que se encendio, en corto para la lista y el informe. La llave es codigo|marco|+ (a favor del lado) o - (en contra):
    al hallazgo (sa), en la primera hora (sf), en la hora antes del movimiento importante (sb) y en cuantas de las 48
    horas del hallazgo (sh)."""
    sa, sf, sb, hours = set(), set(), set(), {}
    for code, tf, off, d in signals:
        key = f"{code}|{tf}|{'+' if d == side else '-'}"
        if SIG_AT[0] <= off <= SIG_AT[1]:
            sa.add(key)
        if SIG_FIRST[0] < off <= SIG_FIRST[1]:
            sf.add(key)
        if big and big["min"] - 60 <= off <= big["min"]:
            sb.add(key)
        bucket = math.floor(off / 60)
        if -24 <= bucket < 24:
            hours.setdefault(key, set()).add(bucket)
    return {"sa": sorted(sa), "sf": sorted(sf), "sb": sorted(sb), "sh": {k: len(v) for k, v in sorted(hours.items())}}


def measure(rec: dict, data: dict, timeline=None, elements=None, keep_series: bool = True) -> dict:
    """Lo medido de un hallazgo o control con su historia (plan, "A las 24 h y 10 min")."""
    t0, side, sym = rec["t0"], rec.get("side") or 1, rec["symbol"]
    k5 = data.get("k5") or []
    p0 = _num(rec.get("p0")) or _close_at(k5, t0)
    atr = _num(rec.get("atr")) or atr_from_15m(data.get("k15") or [], t0)
    full = dict(rec)
    full["lists"] = timeline if timeline is not None else rec.get("lists")
    full["measured_at"] = data.get("now")
    if not p0 or not atr or atr <= 0 or not k5:
        full["state"] = "sin datos"
        full["err"] = "sin velas de Bybit" if not k5 else "sin ATR de 1 h ni precio"
        return full
    unit = p0 * atr
    after = [b for b in k5 if b[0] >= t0]
    o = outcome(after, t0, p0, unit, side)
    full.update({"state": "medido" if o["complete"] else "en curso", "p0_used": p0, "atr_used": _rd(atr, 6), "o": o,
                 "h": variables(data, t0, p0, unit, side)})
    signals = elements(sym, data.get("k15") or [], t0) if elements else []
    full["s"] = signal_sets(signals, side, o.get("big"))
    if keep_series:
        full["series"] = series(data, t0, p0, unit)
        full["signals"] = signals
    return full


def summary(full: dict) -> dict:
    """La fila de la lista y del informe."""
    o = full.get("o") or {}
    f = full.get("f") or {}
    out = {k: full.get(k) for k in ("id", "kind", "symbol", "t0", "list", "lists", "side", "startup", "blind_min",
                                    "prev_h", "state", "err", "measured_at", "chips")}
    out["p0"] = full.get("p0_used") or full.get("p0")
    out["atr"] = full.get("atr_used") or full.get("atr")
    out["market"] = (full.get("market") or {}).get("reading")
    out["f"] = {k: f.get(k) for k in SUMMARY_FIELDS if f.get(k) is not None}
    out["o"] = {k: o.get(k) for k in ("big", "touch", "touch_min", "complete", "1h", "4h", "12h", "24h")} if o else None
    out["h"] = full.get("h")
    out["s"] = full.get("s")
    return out


def slim(row: dict) -> dict:
    """La fila para la lista en memoria: sin lo que solo usan el informe (que lee del disco) y el detalle: las llaves de
    los elementos, las variables de la historia y las listas de sus 24 h (una moneda que entra y sale lleva decenas)."""
    out = {k: v for k, v in row.items() if k not in ("h", "lists")}
    if row.get("s"):
        out["s"] = {"sa": row["s"].get("sa") or []}
    return out


def failed(rec: dict, why: str, now: int) -> dict:
    full = dict(rec)
    full.update({"state": "sin datos", "err": why[:200], "measured_at": now})
    return full


# ==================== informe ====================

def _share(items, pred):
    items = list(items)
    return round(100 * sum(1 for x in items if pred(x)) / len(items), 1) if items else None


def _med(values):
    values = [v for v in values if v is not None]
    return round(statistics.median(values), 2) if values else None


def block(rows: list) -> dict:
    """Las medidas de un grupo de hallazgos con sus 24 h."""
    rows = [r for r in rows if (r.get("o") or {}).get("complete")]
    big = [r for r in rows if r["o"].get("big")]
    raced = [r for r in rows if r["o"].get("touch") in ("sigue", "gira")]
    b = {"n": len(rows), "big_pct": _share(rows, lambda r: r["o"].get("big") is not None),
         "big_sigue_pct": _share(big, lambda r: r["o"]["big"]["way"] == "sigue"), "big_n": len(big),
         "big_min": _med([r["o"]["big"]["min"] for r in big]),
         "race_n": len(raced), "race_sigue_pct": _share(raced, lambda r: r["o"]["touch"] == "sigue")}
    for h in ("1h", "4h", "24h"):
        hs = [r["o"][h] for r in rows if r["o"].get(h)]
        b[h] = {"fav": _med([x["fav"] for x in hs]), "adv": _med([x["adv"] for x in hs]), "close": _med([x["close"] for x in hs])}
    return b


def _pre24(r):
    return abs(((r.get("h") or {}).get("pre_24h")) or 0)


SPLITS = (
    ("oi_up", "El OI de 1 h sube", lambda r: (r["f"].get("oi_1h") or 0) > 0),
    ("moved", "Ya se movió más de 6 ATR en 24 h", lambda r: _pre24(r) > 6),
    ("vol5", "Volumen de 1 h ×5 o más", lambda r: (r["f"].get("rvol_1h") or 0) >= 5),
    ("funding", "Funding del lado", lambda r: (r["f"].get("funding_8h") or 0) * r["side"] > 0),
    ("crowd", "Cuentas en largo del lado", lambda r: ((r.get("h") or {}).get("long") is not None
                                                      and ((r["h"]["long"] - 0.5) * r["side"]) > 0)),
    ("premium", "Prima del lado", lambda r: ((r.get("h") or {}).get("prem_bps") or 0) * r["side"] > 0),
    ("up", "El lado es hacia arriba", lambda r: r["side"] > 0),
    ("break20", "Ruptura de 20 días", lambda r: bool(r["f"].get("break20"))),
)


def _rate(rows):
    raced = [r for r in rows if r["o"].get("touch") in ("sigue", "gira")]
    return sum(1 for r in raced if r["o"]["touch"] == "sigue"), len(raced)


def _z(k1, n1, k2, n2):
    """Diferencia de dos proporciones en errores estandar (sin juntar; con poca muestra, el error de una moneda al aire)."""
    if n1 < 1 or n2 < 1:
        return None
    p1, p2 = k1 / n1, k2 / n2
    se = math.sqrt(max(p1 * (1 - p1), 0.25 / n1) / n1 + max(p2 * (1 - p2), 0.25 / n2) / n2)
    return round((p1 - p2) / se, 2) if se > 0 else None


def signal_table(live: list, control: list) -> dict:
    """Elementos al hallazgo: cuanto sigue la carrera con y sin el elemento, en los hallazgos y en el control, y el
    reparto (cuantos pasan de 2 errores contra lo que da el azar)."""
    raced = [r for r in live if r["o"].get("touch") in ("sigue", "gira") and r.get("s")]
    craced = [r for r in control if r["o"].get("touch") in ("sigue", "gira") and r.get("s")]
    keys = {}
    for r in raced:
        for key in r["s"]["sa"]:
            keys[key] = keys.get(key, 0) + 1
    rows = []
    for key, count in keys.items():
        if count < MIN_SIG:
            continue
        k1, n1 = _rate([r for r in raced if key in r["s"]["sa"]])
        k2, n2 = _rate([r for r in raced if key not in r["s"]["sa"]])
        c1, m1 = _rate([r for r in craced if key in r["s"]["sa"]])
        c2, m2 = _rate([r for r in craced if key not in r["s"]["sa"]])
        code, tf, rel = key.split("|")
        rows.append({"key": key, "code": code, "tf": int(tf), "rel": rel, "n": n1,
                     "sigue_pct": round(100 * k1 / n1, 1) if n1 else None, "sin_n": n2,
                     "sin_pct": round(100 * k2 / n2, 1) if n2 else None, "z": _z(k1, n1, k2, n2),
                     "control_n": m1, "control_pct": round(100 * c1 / m1, 1) if m1 else None,
                     "control_z": _z(c1, m1, c2, m2) if m1 >= MIN_SIG else None})
    tests = [r for r in rows if r["z"] is not None]
    rows.sort(key=lambda r: -abs(r["z"] or 0))
    return {"tests": len(tests), "pass": sum(1 for r in tests if abs(r["z"]) >= 2),
            "expected": round(len(tests) * 0.0455, 1), "rows": rows[:30], "min_n": MIN_SIG,
            "raced": len(raced), "control_raced": len(craced)}


def before_big(live: list) -> dict:
    """Lo que se enciende en la hora antes del movimiento importante, contra una hora cualquiera del mismo hallazgo."""
    big = [r for r in live if (r.get("o") or {}).get("big") and r.get("s")]
    counts = {}
    for r in big:
        for key in r["s"].get("sb") or []:
            counts[key] = counts.get(key, 0) + 1
    rows = []
    for key, count in counts.items():
        if count < MIN_SIG:
            continue
        share = count / len(big)
        anyh = sum(((r["s"].get("sh") or {}).get(key) or 0) / 48 for r in big) / len(big)
        code, tf, rel = key.split("|")
        rows.append({"key": key, "code": code, "tf": int(tf), "rel": rel, "n": count,
                     "pct": round(100 * share, 1), "any_pct": round(100 * anyh, 1),
                     "lift": round(share / anyh, 2) if anyh > 0 else None})
    rows.sort(key=lambda r: -(r["lift"] or 0))
    return {"n": len(big), "rows": rows[:25], "min_n": MIN_SIG}


def report(rows: list, startup: bool = False) -> dict:
    medidos = [r for r in rows if r.get("state") == "medido" and (r.get("o") or {}).get("complete")]
    found = [r for r in medidos if r["kind"] == "hallazgo"]
    control = [r for r in medidos if r["kind"] == "control"]
    live = [r for r in found if startup or not r.get("startup")]
    out = {"blocks": [{"id": "live", "label": "Hallazgos" + (" (con los del arranque)" if startup else " en vivo"), **block(live)}],
           "startup_included": startup}
    for name in LISTS:
        out["blocks"].append({"id": name, "label": LIST_NAMES[name], **block([r for r in live if r.get("list") == name])})
    if not startup:
        out["blocks"].append({"id": "startup", "label": "Del arranque", **block([r for r in found if r.get("startup")])})
    out["blocks"].append({"id": "control", "label": "Control", **block(control)})
    out["splits"] = []
    for key, label, pred in SPLITS:
        out["splits"].append({"id": key, "label": label, "yes": block([r for r in live if pred(r)]),
                              "no": block([r for r in live if not pred(r)]), "control_yes": block([r for r in control if pred(r)]),
                              "control_no": block([r for r in control if not pred(r)])})
    out["signals"] = signal_table(live, control)
    out["before_big"] = before_big(live)
    out["no_data"] = sum(1 for r in rows if r.get("state") == "sin datos")
    out["since"] = min((r["t0"] for r in medidos), default=None)
    return out


# ==================== el registro ====================

class FollowTracker:
    def __init__(self, scanner_folder, fetch=None, now=None, price_of=None, elements=None, start_delay: float = START_DELAY_S):
        self.src = Path(scanner_folder)
        self.folder = self.src / "follow"
        self._fetch = fetch or scn.bybit_get
        self._now = now or _now_ms
        self._price_of = price_of or (lambda s: None)
        self._elements = elements if elements is not None else app1_elements
        self.start_delay = start_delay
        self.state_error = None
        self.state = self._load_state()
        self.open = {}          # id -> la foto, de los que esperan su medida
        self.index = {}         # id -> lo medido en corto, de los ultimos INDEX_DAYS dias
        self.cycles = deque(maxlen=CYCLES_IN_MEMORY)   # las ultimas vueltas leidas, con sus filas (para la foto)
        self.loaded = False
        self.errors = deque(maxlen=20)
        self.busy = None
        self.last_tick = None
        self.closed_now = 0
        self._dirty = False
        self._lock_fh = None
        self.other_process = False
        self._tasks = []
        self._detail = OrderedDict()
        self._fotos = OrderedDict()
        self._closed_days = OrderedDict()
        self._btc = OrderedDict()
        self._report = {}

    # --- estado ---
    def _state_path(self) -> Path:
        return self.folder / "state.json"

    def _load_state(self) -> dict:
        base = {"v": 1, "read": {"events": {}, "log": {}}, "cycle_ats": [], "coins": {}, "open": {}, "tries": {}, "last_t0": {}}
        path = self._state_path()
        if not path.exists():
            return base
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("read"), dict):
                raise ValueError("estado con otra forma")
            for key, value in base.items():
                data.setdefault(key, value)
            return data
        except (OSError, ValueError) as e:
            # Un estado ilegible no se pisa: se guarda aparte y lo del scanner se vuelve a leer desde el principio. Lo ya
            # medido no se repite (su id esta en index/) y lo abierto se vuelve a abrir con la misma foto
            self.state_error = f"state.json ilegible: {e}"[:200]
            try:
                stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
                path.with_name(f"state.danado-{stamp}.json").write_bytes(path.read_bytes())
            except OSError:
                pass
            return base

    def _save_state(self, force: bool = False):
        if self._lock_fh is None or not (self._dirty or force):
            return
        try:
            swing_watch._write_atomic(self._state_path(), json.dumps(self.state, separators=(",", ":"), ensure_ascii=False))
            self._dirty = False
        except OSError as e:
            self._error("estado", e)

    def _error(self, where: str, e: Exception):
        text = f"{where}: {type(e).__name__}: {e}"[:240]
        self.errors.append({"at": self._now(), "text": text})
        logger.warning(f"[SEGUIMIENTO] {text}")

    # --- un solo proceso por carpeta ---
    def _take_lock(self) -> bool:
        if self._lock_fh is not None:
            return True
        path = self.folder / "follow.lock"
        path.parent.mkdir(parents=True, exist_ok=True)
        fh = open(path, "a+b")
        try:
            fh.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(fh.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            fh.close()
            return False
        self._lock_fh = fh
        return True

    def _release_lock(self):
        if self._lock_fh is not None:
            try:
                if os.name == "nt":
                    import msvcrt
                    self._lock_fh.seek(0)
                    msvcrt.locking(self._lock_fh.fileno(), msvcrt.LK_UNLCK, 1)
            except OSError:
                pass
            self._lock_fh.close()
            self._lock_fh = None

    # --- bucle ---
    async def start(self):
        if _env_off() or self._tasks:
            return
        self._tasks = [asyncio.create_task(self._loop())]

    async def stop(self):
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):
                pass
        self._tasks = []
        self._save_state()
        self._release_lock()

    async def _loop(self):
        await asyncio.sleep(self.start_delay)
        while True:
            backlog = False
            try:
                backlog = await self.tick()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                self._error("vuelta", e)
            await asyncio.sleep(BACKLOG_S if backlog else TICK_S)

    async def tick(self) -> bool:
        """Lee lo nuevo del scanner, abre hallazgos y controles, y mide los que cumplieron sus 24 h. True si quedan
        atrasados por medir."""
        if not self._take_lock():
            self.other_process = True
            return False
        self.other_process = False
        if not self.loaded:
            self._apply_load(await run_in_threadpool(self._read_saved))
        now = self._now()
        for day in await run_in_threadpool(self._days_with_news):
            self._process(await run_in_threadpool(self._read_new, day, now))
        self._forget(now)
        self._save_state()
        done = await self.close_due()
        self._save_state()
        self.last_tick = self._now()
        return done >= CLOSES_PER_TICK and bool(self.due(self._now()))

    # --- lo guardado ---
    def _read_saved(self) -> dict:
        """Al tomar el candado (en otro hilo, sin tocar el registro): las fotos de los abiertos, lo medido de los ultimos
        dias y las ultimas vueltas leidas."""
        fotos = {}
        for rid, day in list(self.state["open"].items()):
            if day not in fotos:
                fotos[day] = self._fotos_file(day)
        rows = self._index_rows(INDEX_DAYS)
        cycles = []
        done = self.state["read"]["log"]
        for day in sorted(done)[-2:]:
            records = read_members(self.src / "log" / f"{day}.jsonl.gz")[:(done[day] or {}).get("n", 0)]
            cycles += [self._cycle_of(rec) for rec in records if isinstance(rec, dict) and isinstance(rec.get("at"), int)]
        return {"fotos": fotos, "rows": rows, "cycles": cycles[-CYCLES_IN_MEMORY:]}

    def _apply_load(self, saved: dict):
        for rid, day in list(self.state["open"].items()):
            rec = (saved["fotos"].get(day) or {}).get(rid)
            if rec is None:
                self.state["open"].pop(rid, None)
                self._dirty = True
            else:
                self.open[rid] = rec
        for row in saved["rows"]:
            self.index[row["id"]] = slim(row)
            if self.open.pop(row["id"], None) is not None or self.state["open"].pop(row["id"], None) is not None:
                self._dirty = True
        for cyc in saved["cycles"]:
            self.cycles.append(cyc)
        self.loaded = True

    def _index_rows(self, days: int) -> list:
        """Lo medido de los ultimos dias, del disco (la ultima fila de cada id manda)."""
        folder = self.folder / "index"
        if not folder.exists():
            return []
        cut = _day(self._now() - days * DAY)
        found = {}
        for path in sorted(folder.glob("*.jsonl.gz")):
            if path.name[:10] < cut:
                continue
            for row in read_members(path):
                if isinstance(row, dict) and ID_RE.match(str(row.get("id") or "")) and isinstance(row.get("t0"), int):
                    found[row["id"]] = row
        return list(found.values())

    def _fotos_file(self, day: str) -> dict:
        return {rec["id"]: rec for rec in read_members(self.folder / "episodes" / f"{day}.jsonl.gz")
                if isinstance(rec, dict) and rec.get("id")}

    def _fotos_of(self, day: str) -> dict:
        """Las fotos de un dia (episodes/), con un cache de pocos dias."""
        got = self._fotos.get(day)
        if got is None:
            got = self._fotos_file(day)
            self._fotos[day] = got
            while len(self._fotos) > 3:
                self._fotos.popitem(last=False)
        return got

    def _append(self, folder: str, day: str, obj: dict):
        """Una linea mas, como un miembro gzip (un corte a medias no estropea lo anterior: read_members lo salta)."""
        path = self.folder / folder / f"{day}.jsonl.gz"
        path.parent.mkdir(parents=True, exist_ok=True)
        data = (json.dumps(obj, separators=(",", ":"), ensure_ascii=False, default=str) + "\n").encode("utf-8")
        with open(path, "ab") as fh:
            fh.write(gzip.compress(data))

    # --- leer lo nuevo del scanner ---
    def _days_with_news(self) -> list:
        """Los dias cuyos archivos del scanner cambiaron desde la ultima lectura (por tamano), del mas viejo al mas nuevo."""
        days = set()
        for kind, folder, pattern in (("events", "events", "*.jsonl"), ("log", "log", "*.jsonl.gz")):
            base = self.src / folder
            if not base.exists():
                continue
            seen = self.state["read"][kind]
            for path in base.glob(pattern):
                day = path.name[:10]
                if not DAY_RE.match(day):
                    continue
                try:
                    size = path.stat().st_size
                except OSError:
                    continue
                if (seen.get(day) or {}).get("size") != size:
                    days.add(day)
        return sorted(days)

    def _read_new(self, day: str, now: int) -> list:
        """Las vueltas y los eventos de un dia que no se leyeron, en orden de hora. Un evento de los ultimos 3 min espera,
        y los que siguen en su archivo tambien: lo leido es siempre el principio del archivo."""
        items = []
        log_path = self.src / "log" / f"{day}.jsonl.gz"
        seen = self.state["read"]["log"].get(day) or {}
        try:
            size = log_path.stat().st_size
        except OSError:
            size = None
        if size is not None and seen.get("size") != size:
            records = read_members(log_path)
            for rec in records[seen.get("n", 0):]:
                if isinstance(rec, dict) and isinstance(rec.get("at"), int):
                    items.append((rec["at"], 0, "log", day, rec))
            items.append((None, 9, "log_done", day, {"n": len(records), "size": size}))
        ev_path = self.src / "events" / f"{day}.jsonl"
        seen = self.state["read"]["events"].get(day) or {}
        try:
            data = ev_path.read_bytes()
        except OSError:
            data = None
        if data is not None and seen.get("size") != len(data):
            lines = complete_lines(data)
            taken = seen.get("n", 0)
            for line in lines[taken:]:
                e = parse_event(line)
                if e is not None and e["at"] > now - HOLD_EVENTS:
                    break
                taken += 1
                if e is not None:
                    items.append((e["at"], 1, "event", day, e))
            whole = taken == len(lines) and data.endswith(b"\n")
            items.append((None, 9, "events_done", day, {"n": taken, "size": len(data) if whole else -1}))
        items.sort(key=lambda x: (x[0] if x[0] is not None else float("inf"), x[1]))
        return items

    def _process(self, items: list):
        for _, _, kind, day, obj in items:
            if kind == "log":
                self._on_cycle(obj)
            elif kind == "event":
                self._on_event(obj)
            elif kind == "log_done":
                self.state["read"]["log"][day] = obj
            elif kind == "events_done":
                self.state["read"]["events"][day] = obj
            self._dirty = True

    @staticmethod
    def _cycle_of(rec: dict) -> dict:
        lists = rec.get("lists") or {}
        return {"at": rec["at"], "fields": rec.get("fields") or [], "rows": rec.get("rows") or {},
                "lists": {name: list(lists.get(name) or []) for name in LISTS}, "market": rec.get("market")}

    def _cycle_before(self, t: int):
        best = None
        for c in self.cycles:
            if c["at"] <= t and (best is None or c["at"] > best["at"]):
                best = c
        return best

    def _blind_min(self, cycle_at: int):
        """Minutos que el scanner no miro antes de esa vuelta (None si es la primera que se conoce)."""
        prev = [a for a in self.state["cycle_ats"] if a < cycle_at]
        return round((cycle_at - prev[-1]) / MIN) if prev else None

    def _on_cycle(self, rec: dict):
        cyc = self._cycle_of(rec)
        self.cycles.append(cyc)
        ats = self.state["cycle_ats"]
        if cyc["at"] not in ats:
            ats.append(cyc["at"])
            ats.sort()
            del ats[:-CYCLE_ATS_KEEP]
        self._pick_controls(cyc)

    def _attached(self, sym: str, t: int) -> bool:
        c = self.state["coins"].get(sym)
        return bool(c) and (bool(c["in"]) or (c.get("out") is not None and t - c["out"] < REENTRY))

    @staticmethod
    def _foto_fields(cyc, sym: str) -> dict:
        row = (cyc or {}).get("rows", {}).get(sym)
        if not isinstance(row, list):
            return {}
        return {k: v for k, v in zip(cyc["fields"], row)}

    def _pick_controls(self, cyc: dict):
        at = cyc["at"]
        listed = set()
        for name in LISTS:
            listed |= set(cyc["lists"].get(name) or [])
        pool = [s for s in cyc["rows"] if SYMBOL_RE.match(s) and s != "BTCUSDT" and s not in listed and not self._attached(s, at)]
        pool.sort(key=lambda s: hashlib.sha1(f"{at}:{s}".encode()).hexdigest())   # al azar, pero siempre las mismas
        blind = self._blind_min(at)
        picked = 0
        for sym in pool:
            if picked >= CONTROLS_PER_CYCLE:
                break
            f = self._foto_fields(cyc, sym)
            if not f.get("price"):
                continue
            picked += 1
            rid = make_id("control", at, sym)
            if rid in self.index or rid in self.open:
                continue
            self._open({"v": 1, "id": rid, "kind": "control", "symbol": sym, "t0": at, "p0": f.get("price"),
                        "atr": f.get("atr_1h"), "list": None, "lists": [], "side": side_of("enjuego", f, None),
                        "startup": False, "blind_min": blind, "prev_h": None, "cycle_at": at, "f": f, "chips": [],
                        "market": cyc.get("market")})

    def _on_event(self, e: dict):
        sym, lista, at = e["symbol"], e["list"], e["at"]
        coins = self.state["coins"]
        c = coins.get(sym)
        if e["type"] == "sale":
            if c:
                c["in"].pop(lista, None)
                if not c["in"]:
                    c["out"] = at
            return
        if c and (c["in"] or (c.get("out") is not None and at - c["out"] < REENTRY)):
            c["in"][lista] = at   # el mismo hallazgo
            return
        cyc = self._cycle_before(at)
        f = self._foto_fields(cyc, sym)
        blind = self._blind_min(cyc["at"]) if cyc else None
        startup = lista != "rapidos" and (blind is None or blind * MIN > BLIND)
        last = self.state["last_t0"].get(sym)
        rid = make_id("hallazgo", at, sym)
        coins[sym] = {"ep": rid, "in": {lista: at}, "out": None}
        self.state["last_t0"][sym] = at
        if rid in self.index or rid in self.open:
            return
        self._open({"v": 1, "id": rid, "kind": "hallazgo", "symbol": sym, "t0": at, "p0": e.get("price") or f.get("price"),
                    "atr": f.get("atr_1h"), "list": lista, "lists": [[lista, at, None, False]],
                    "side": side_of(lista, f, e.get("chips")), "startup": startup, "blind_min": blind,
                    "prev_h": round((at - last) / HOUR, 1) if last else None, "cycle_at": cyc["at"] if cyc else None,
                    "f": f, "chips": e.get("chips") or [], "market": cyc.get("market") if cyc else None})

    def _open(self, rec: dict):
        day = _day(rec["t0"])
        try:
            self._append("episodes", day, rec)
        except OSError as e:
            self._error("fotos", e)
            return
        self.open[rec["id"]] = rec
        self.state["open"][rec["id"]] = day
        self._fotos.pop(day, None)
        self._dirty = True

    def _forget(self, now: int):
        """Las monedas que ya no pueden volver al mismo hallazgo, y lo medido que sale de la lista."""
        coins = self.state["coins"]
        for sym in [s for s, c in coins.items() if not c["in"] and c.get("out") is not None and now - c["out"] >= REENTRY]:
            del coins[sym]
            self._dirty = True
        last = self.state["last_t0"]
        for sym in [s for s, t in last.items() if t < now - 3 * DAY]:
            del last[sym]
            self._dirty = True
        cut = now - INDEX_DAYS * DAY
        for rid in [r for r, row in self.index.items() if row["t0"] < cut]:
            del self.index[rid]

    # --- la historia de Bybit ---
    async def _get(self, path: str, params: dict) -> dict:
        STATS["requests"] += 1
        return await self._fetch(path, params)

    async def _klines(self, sym: str, interval: str, start: int, end: int, path: str = "/v5/market/kline") -> list:
        """Velas cerradas que empiezan de start a end: [t, o, h, l, c, volumen, turnover] (la prima: [t, o, h, l, c])."""
        step = int(interval) * MIN
        rows, cursor = {}, end
        for _ in range(16):
            res = await self._get(path, {"category": "linear", "symbol": sym, "interval": interval, "start": start,
                                         "end": cursor, "limit": 1000})
            part = res.get("list") or []
            for r in part:
                try:
                    rows[int(r[0])] = r
                except (TypeError, ValueError, IndexError):
                    continue
            if len(part) < 1000:
                break
            oldest = min(int(r[0]) for r in part)
            if oldest <= start:
                break
            cursor = oldest - 1
        now = self._now()
        out = []
        for t in sorted(rows):
            if t < start or t > end or t + step > now:
                continue   # la vela en curso no cuenta
            r = rows[t]
            try:
                bar = [t, float(r[1]), float(r[2]), float(r[3]), float(r[4])]
                if path == "/v5/market/kline":
                    bar += [float(r[5]), float(r[6]) if len(r) > 6 else 0.0]
            except (TypeError, ValueError, IndexError):
                continue
            out.append(bar)
        return out

    async def _paged(self, path: str, params: dict, start: int, end: int, limit: int, value: str) -> list:
        """OI o cuentas en largo de 5 min, de start a end: [[t, valor]]."""
        rows, cursor = {}, ""
        for _ in range(12):
            p = {"category": "linear", **params, "startTime": start, "endTime": end, "limit": limit}
            if cursor:
                p["cursor"] = cursor
            res = await self._get(path, p)
            part = res.get("list") or []
            for r in part:
                try:
                    rows[int(r["timestamp"])] = float(r[value])
                except (KeyError, TypeError, ValueError):
                    continue
            cursor = res.get("nextPageCursor") or ""
            if not cursor or not part:
                break
        return sorted([t, v] for t, v in rows.items() if start <= t <= end)

    async def _btc5(self, start: int, end: int) -> list:
        """Cierres de 5 min de BTC, por tramos de 83 h que se guardan en memoria (los usan todos los hallazgos de esos dias)."""
        now = self._now()
        out = []
        for k in range(start // BTC_SPAN, end // BTC_SPAN + 1):
            lo, hi = k * BTC_SPAN, (k + 1) * BTC_SPAN - STEP5
            got = self._btc.get(k)
            done = got and got[0] >= hi + STEP5 + 10 * MIN   # pedido con el tramo ya cerrado: no cambia
            if not got or not (done or now - got[0] < 5 * MIN):
                bars = await self._klines("BTCUSDT", "5", lo, min(hi, now))
                got = (now, [[b[0], b[4]] for b in bars])
                self._btc[k] = got
                while len(self._btc) > 8:
                    self._btc.popitem(last=False)
            out += [x for x in got[1] if start <= x[0] <= end]
        return out

    async def history(self, sym: str, t0: int, end: int) -> dict:
        """Las 48 h de Bybit alrededor de t0 (hasta end) y las velas de 15 min de 35 dias."""
        now = self._now()
        end = min(end, now)
        start = t0 - WINDOW - 15 * MIN   # unas velas antes de las 24 h: lo que se movio en 24 h necesita la de t0 - 24 h
        k5, oi, ls, prem, k15, btc = await asyncio.gather(   # cada pedido pasa por el limite de la suite (10 por segundo)
            self._klines(sym, "5", start, end),
            self._paged("/v5/market/open-interest", {"symbol": sym, "intervalTime": "5min"}, start, end, 200, "openInterest"),
            self._paged("/v5/market/account-ratio", {"symbol": sym, "period": "5min"}, start, end, 500, "buyRatio"),
            self._klines(sym, "5", start, end, path="/v5/market/premium-index-price-kline"),
            self._klines(sym, "15", t0 - WARM_DAYS * DAY, end),
            self._btc5(start, end))
        return {"k5": k5, "oi": oi, "ls": ls, "prem": prem, "k15": k15, "btc": btc, "end": end, "now": now}

    # --- medir ---
    def timeline(self, rec: dict) -> list:
        """A que listas entro y cuando salio en sus 24 h, del registro de entradas y salidas del scanner."""
        if rec["kind"] != "hallazgo":
            return []
        t0, sym = rec["t0"], rec["symbol"]
        events = []
        for day in sorted({_day(t0), _day(t0 + WINDOW)}):
            events += [e for e in read_events(self.src / "events" / f"{day}.jsonl")
                       if e and e["symbol"] == sym and t0 <= e["at"] <= t0 + WINDOW]
        events.sort(key=lambda e: e["at"])
        out, open_at = [], {}
        for e in events:
            if e["type"] == "entra" and e["list"] not in open_at:
                open_at[e["list"]] = len(out)
                out.append([e["list"], e["at"], None, False])
            elif e["type"] == "sale" and e["list"] in open_at:
                item = out[open_at.pop(e["list"])]
                item[2], item[3] = e["at"], bool(e.get("gap"))
        return out or rec.get("lists") or []

    def _measure(self, rec: dict, data: dict, keep_series: bool) -> dict:
        return measure(rec, data, self.timeline(rec), self._elements, keep_series)

    def due(self, now: int) -> list:
        tries = self.state["tries"]
        # Primero los hallazgos, del mas viejo al mas nuevo, y despues los controles: al encenderse con lo ya anotado, la
        # lista se llena antes
        return sorted((r for r in self.open.values() if now >= r["t0"] + CLOSE_AFTER and (tries.get(r["id"]) or {}).get("next", 0) <= now),
                      key=lambda r: (r["kind"] != "hallazgo", r["t0"]))

    async def close_due(self, limit: int = CLOSES_PER_TICK) -> int:
        done = 0
        for rec in self.due(self._now())[:limit]:
            self.busy = rec["id"]
            now = self._now()
            try:
                data = await self.history(rec["symbol"], rec["t0"], rec["t0"] + WINDOW + STEP5)
                full = await run_in_threadpool(self._measure, rec, data, rec["kind"] == "hallazgo")
                if full["state"] == "en curso":   # Bybit todavia no dio las 24 h: otra vez en 10 min
                    raise RuntimeError(f"Bybit dio {full['o']['bars']} de {FULL_BARS} velas de 5 min")
                if full["state"] == "sin datos" and full.get("err") == "sin velas de Bybit":
                    raise RuntimeError("Bybit no dio velas")
                self._closed(full)
                done += 1
            except asyncio.CancelledError:
                raise
            except Exception as e:
                tr = self.state["tries"].get(rec["id"]) or {}
                tr = {"n": tr.get("n", 0) + 1, "next": now + RETRY_MS, "err": f"{type(e).__name__}: {e}"[:200]}
                if tr["n"] >= MAX_TRIES:
                    try:
                        self._closed(failed(rec, tr["err"], now))
                        done += 1
                    except OSError:
                        pass
                else:
                    self.state["tries"][rec["id"]] = tr
                    self._dirty = True
            finally:
                self.busy = None
            await asyncio.sleep(0.2)
        self.closed_now += done
        return done

    def _closed(self, full: dict):
        rid, day = full["id"], _day(full["t0"])
        row = summary(full)
        try:
            if full["kind"] == "hallazgo" and full.get("state") == "medido":
                self._append("closed", day, full)
                self._closed_days.pop(day, None)
            self._append("index", day, row)
        except OSError as e:
            self._error("guardar lo medido", e)
            raise
        if row["t0"] >= self._now() - INDEX_DAYS * DAY:
            self.index[rid] = slim(row)
        self.open.pop(rid, None)
        self.state["open"].pop(rid, None)
        self.state["tries"].pop(rid, None)
        self._detail.pop(rid, None)
        self._report = {}
        self._dirty = True

    # --- lo que se muestra ---
    def _row_open(self, rec: dict, now: int) -> dict:
        row = slim(summary(rec))
        row["state"] = "abierto"
        coin = self.state["coins"].get(rec["symbol"]) or {}
        row["in_lists"] = sorted(coin.get("in") or {}) if coin.get("ep") == rec["id"] else []
        row["elapsed_min"] = round((now - rec["t0"]) / MIN)
        price, p0, atr = _num(self._price_of(rec["symbol"])), _num(rec.get("p0")), _num(rec.get("atr"))
        row["now_atr"] = _rd((price - p0) / (p0 * atr) * (rec.get("side") or 1), 2) if price and p0 and atr else None
        tr = self.state["tries"].get(rec["id"])
        if tr:
            row["err"] = tr.get("err")
        return row

    def rows(self, days: int = 7, kind: str = "hallazgo", lista: str = None, startup: str = None) -> list:
        now = self._now()
        cut = now - days * DAY
        out = [r for r in self.index.values() if r["t0"] >= cut]
        out += [self._row_open(r, now) for r in self.open.values() if r["t0"] >= cut]
        if kind in ("hallazgo", "control"):
            out = [r for r in out if r["kind"] == kind]
        if lista:
            out = [r for r in out if r.get("list") == lista]
        if startup in ("0", "1"):
            out = [r for r in out if bool(r.get("startup")) == (startup == "1")]
        out.sort(key=lambda r: -r["t0"])
        return out

    async def report(self, days: int = 30, startup: bool = False) -> dict:
        """El informe con lo medido de los ultimos dias (del disco), unos minutos en memoria."""
        key = (days, bool(startup))
        hit = self._report.get(key)
        now = self._now()
        if hit and now - hit[0] < REPORT_CACHE_S * 1000:
            return hit[1]

        def work():
            cut = now - days * DAY
            rows = [r for r in self._index_rows(days + 1) if r["t0"] >= cut]
            out = report(rows, startup)
            out["days"] = days
            return out

        out = await run_in_threadpool(work)
        out["open"] = sum(1 for r in self.open.values() if r["t0"] >= now - days * DAY)
        self._report[key] = (now, out)
        return out

    def _closed_full(self, rid: str):
        day = day_of_id(rid)
        found = self._closed_days.get(day)
        if found is None:
            found = {rec["id"]: rec for rec in read_members(self.folder / "closed" / f"{day}.jsonl.gz")
                     if isinstance(rec, dict) and rec.get("id")}
            self._closed_days[day] = found
            while len(self._closed_days) > 2:
                self._closed_days.popitem(last=False)
        return found.get(rid)

    async def detail(self, rid: str) -> dict:
        """Uno completo. Un hallazgo medido sale de closed/; uno abierto o un control se mide ahora con lo que va (y queda
        unos minutos en memoria)."""
        if not ID_RE.match(rid):
            raise ValueError("id invalido")
        if rid.startswith("H-") and rid not in self.open:
            full = await run_in_threadpool(self._closed_full, rid)
            if full:
                return full
        rec = self.open.get(rid)
        if rec is None:
            rec = (await run_in_threadpool(self._fotos_of, day_of_id(rid))).get(rid)
        if rec is None:
            raise KeyError(rid)
        now = self._now()
        hit = self._detail.get(rid)
        ttl = DETAIL_OPEN_S * 1000 if rid in self.open else 30 * MIN
        if hit and now - hit[0] < ttl:
            return hit[1]
        data = await self.history(rec["symbol"], rec["t0"], rec["t0"] + WINDOW + STEP5)
        full = await run_in_threadpool(self._measure, rec, data, True)
        if rid in self.open:
            full["state"] = "abierto"
            full["now_atr"] = self._row_open(rec, now).get("now_atr")
        row = self.index.get(rid)
        if row and row.get("state") == "sin datos":
            full["err"] = row.get("err")
        self._detail[rid] = (now, full)
        while len(self._detail) > DETAIL_CACHE:
            self._detail.popitem(last=False)
        return full

    def status(self) -> dict:
        now = self._now()
        kinds = lambda rows: {"hallazgo": sum(1 for r in rows if r["kind"] == "hallazgo"),   # noqa: E731
                              "control": sum(1 for r in rows if r["kind"] == "control")}
        index = list(self.index.values())
        return {"success": True, "sends": False, "enabled": not _env_off(), "env_off": _env_off(),
                "running": bool(self._tasks) and self._lock_fh is not None, "other_process": self.other_process,
                "loaded": self.loaded, "open": kinds(list(self.open.values())),
                "measured": kinds([r for r in index if r.get("state") == "medido"]),
                "no_data": sum(1 for r in index if r.get("state") == "sin datos"), "due": len(self.due(now)),
                "retrying": len(self.state["tries"]), "busy": self.busy, "last_tick": self.last_tick,
                "since": min([r["t0"] for r in index] + [r["t0"] for r in self.open.values()], default=None),
                "requests": STATS["requests"], "errors": list(self.errors)[-5:], "state_error": self.state_error,
                "rules": {"reentry_h": REENTRY / HOUR, "blind_min": BLIND / MIN, "big_atr": BIG_ATR, "touch_atr": TOUCH_ATR,
                          "controls_per_cycle": CONTROLS_PER_CYCLE, "window_h": WINDOW / HOUR, "index_days": INDEX_DAYS}}

    def brief(self) -> dict:
        s = self.status()
        return {"running": s["running"], "open": s["open"], "measured": s["measured"], "due": s["due"], "errors": len(s["errors"])}


def make_router(tracker: FollowTracker) -> APIRouter:
    router = APIRouter()

    @router.get("/api/follow/status")
    async def follow_status():
        return tracker.status()

    @router.get("/api/follow/episodes")
    async def follow_episodes(days: int = 7, kind: str = "hallazgo", lista: str = None, startup: str = None, limit: int = 1000):
        if kind not in ("hallazgo", "control", "todos"):
            raise HTTPException(400, "kind es hallazgo, control o todos")
        if lista is not None and lista not in LISTS:
            raise HTTPException(400, f"lista es {', '.join(LISTS)}")
        if startup is not None and startup not in ("0", "1"):
            raise HTTPException(400, "startup es 0 o 1")
        days = max(1, min(int(days), INDEX_DAYS))
        rows = tracker.rows(days, kind, lista, startup)
        return {"success": True, "rows": rows[:max(1, min(int(limit), 5000))], "total": len(rows), "lists": LIST_NAMES,
                "days": days}

    @router.get("/api/follow/episode/{rid}")
    async def follow_episode(rid: str):
        try:
            return {"success": True, "episode": await tracker.detail(rid)}
        except ValueError as e:
            raise HTTPException(400, str(e))
        except KeyError:
            raise HTTPException(404, "no hay un hallazgo con ese id")
        except RuntimeError as e:
            raise HTTPException(503, f"Bybit: {e}")

    @router.get("/api/follow/report")
    async def follow_report(days: int = 30, startup: int = 0):
        days = max(1, min(int(days), REPORT_DAYS))
        return {"success": True, "days": days, "report": await tracker.report(days, bool(startup))}

    return router
