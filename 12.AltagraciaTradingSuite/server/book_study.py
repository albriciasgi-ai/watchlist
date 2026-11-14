# book_study.py - Que hace la liquidez del libro cuando el precio llega a tus zonas, contra zonas al azar (13/11/2026).
#
# La medicion de "Patrones del price ladder y cancelaciones" (research_notes/.../medicion_llegada_del_precio_13nov.md),
# pensada para semanas de libro grabado por la suite (book_recorder.py) y con un aguante de tu horizonte:
#   - tus zonas: POC, VAH y VAL del perfil del dia anterior (almacen de trades), los FVG de 15m y 1h, y los niveles
#     que elegiste en el journal para tus ordenes;
#   - zonas al azar: por cada una, otras del mismo ancho, corridas entre 0.3% y 1.5% del precio, en las mismas horas;
#   - una visita empieza cuando el precio estuvo al menos 1/4 de ATR de 15m lejos de la zona y llega a ella;
#     aguanta si vuelve a alejarse 1/2 ATR antes de pasarla por 1/4 ATR; si no, la cruza;
#   - en cada visita: lo que habia en la zona al acercarse y al llegar (libro de cada segundo) y lo negociado en
#     ella contra ese lado (trades exactos del almacen).
# Desde el 13/11 (pedido del usuario), ademas:
#   - antiguedad: cuantos minutos seguidos, hasta 4 horas, la zona tuvo al menos la mitad de lo que tenia en el minuto
#     antes de acercarse el precio (promedio de cada minuto, libro de minutos), y que parte estuvo toda la hora anterior;
#   - velocidad de llegada: segundos en recorrer el ultimo 1/4 de ATR hasta la zona;
#   - patron de cada visita, con la misma regla para tus zonas y el azar: barrido (la perfora y vuelve), absorcion
#     (aguanta y se negocia todo lo que se veia), defensa (aguanta con la liquidez), retiro y rebote (se retira la
#     mitad o mas y aun asi aguanta), retiro y cruce (se retira y el precio pasa: lo esperable de un muro falso) y
#     consumida (la liquidez se queda, se negocia y el precio pasa).
# No es una senal: dice si tus zonas tienen liquidez distinta de un precio cualquiera y si esa liquidez las hace
# aguantar. Con pocas visitas no se distingue nada del azar: el informe lo avisa.
#
# Uso, desde 12.AltagraciaTradingSuite\server:
#   C:\Python314\python.exe -B book_study.py BTCUSDT,ETHUSDT 2026-11-14 2026-12-14 [salida.json]
import json
import math
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import book_store  # noqa: E402
from settings import CONFIG, REPO_DIR  # noqa: E402

MINUTE = 60000
DAY = 86400000
ARM_ATR, HOLD_ATR, CROSS_ATR = 0.25, 0.5, 0.25
POINT_ZONE = 0.0005           # un nivel (POC, VAH, VAL, journal) es su precio +-0.05%
FVG_MIN, FVG_MAX = 0.0005, 0.01
ZONE_DAYS = 3                 # un FVG o un nivel del journal vale hasta 3 dias (o hasta llenarse el FVG)
RANDOM_PER_ZONE = 3
RANDOM_SHIFT = (0.003, 0.015)
MAX_VISIT_MS = 4 * 3600000    # una visita que no se resuelve en 4 horas queda sin resolver
MIN_GROUP = 30
KEEP = 0.5                    # "se quedo": al menos la mitad de lo que habia al acercarse
AGE_MAX_MIN = 240             # la antiguedad se cuenta hasta 4 horas atras
HOUR_MIN = 60                 # lo sostenido se mide en la hora antes de acercarse
OLD_MIN, RECENT_MIN = 15, 5   # liquidez con antiguedad (15 minutos o mas) y reciente (menos de 5 minutos)
FAST_S, SLOW_S = 30, 300      # llegada rapida (el ultimo 1/4 de ATR en 30 s o menos) y lenta (mas de 5 minutos)
PATTERNS = ("barrido", "absorcion", "defensa", "retiro_y_rebote", "retiro_y_cruce", "consumida")


# ---------- datos ----------
def _app1():
    import os
    data = Path(CONFIG["orderflow_data"])
    os.environ.setdefault("ORDERFLOW_STORE", str(data / "store"))
    os.environ.setdefault("ORDERFLOW_LIVE_STORE", str(data / "live" / "store"))
    if CONFIG["app1_backend"] not in sys.path:
        sys.path.insert(0, CONFIG["app1_backend"])
    import footprint_store
    return footprint_store


def load_seconds(base: Path, symbol: str, start: int, end: int) -> Optional[dict]:
    """Cada segundo grabado entre start y end: hora, mejor compra y venta, y sus filas de cubos."""
    heads, bids, asks, ts, bb, ba, blk, row = [], [], [], [], [], [], [], []
    for header, b, a in book_store.second_rows(base, symbol, start, end):
        k = len(heads)
        heads.append(header)
        bids.append(b)
        asks.append(a)
        for r, (t, x, y) in enumerate(zip(header["ts"], header["bb"], header["ba"])):
            if start <= t < end and x is not None and y is not None:
                ts.append(t)
                bb.append(x)
                ba.append(y)
                blk.append(k)
                row.append(r)
    if not ts:
        return None
    return {"heads": heads, "bids": bids, "asks": asks, "ts": np.array(ts, np.int64), "bb": np.array(bb),
            "ba": np.array(ba), "blk": np.array(blk), "row": np.array(row)}


def load_minutes(base, symbol: str, start: int, end: int) -> Optional[dict]:
    """Los minutos grabados entre start y end (promedio y minimo de cada cubo), ordenados por hora."""
    cols = sorted(book_store.minute_columns(base, symbol, start, end), key=lambda hp: hp[0]["t"])
    if not cols:
        return None
    return {"t": np.array([h["t"] for h, _ in cols], np.int64), "cols": cols}


def zone_age(mins: Optional[dict], approach_ms: int, side: str, lo: float,
             hi: float) -> Tuple[Optional[int], Optional[float], Optional[float]]:
    """Antiguedad de la liquidez de la zona antes de acercarse el precio, con el libro de minutos.
    Usa el promedio ponderado por tiempo de cada minuto. La suma de los minimos de cada precio no sirve: cada precio
    baja en un segundo distinto, y en BTC, ETH, SOL y XRP del 13/11 daba en la mediana el 44% del promedio aunque
    nada se retirara. El promedio, en cambio, da el 91% de la foto de un segundo al acercarse.
    - referencia: el promedio de la zona en el ultimo minuto cerrado antes de acercarse;
    - antiguedad: minutos seguidos hacia atras, hasta AGE_MAX_MIN, con al menos KEEP de la referencia;
    - sostenido: lo que hubo siempre la hora entera (el menor promedio de esos 60 minutos), en USD y como parte
      de la referencia.
    Un minuto que falta, incompleto o que no alcanza la zona corta la cuenta: lo de antes no se sabe, asi que la
    antiguedad es "al menos" esa, y lo sostenido queda vacio si la hora no se vio completa."""
    if mins is None:
        return None, None, None
    expect = approach_ms - approach_ms % MINUTE - MINUTE      # el ultimo minuto cerrado antes de acercarse
    i = int(np.searchsorted(mins["t"], expect, side="right")) - 1
    ref, age, aging, low, seen = None, 0, True, None, 0
    while i >= 0 and seen < AGE_MAX_MIN and (aging or seen < HOUR_MIN):
        h, p = mins["cols"][i]
        if int(h["t"]) != expect or h.get("gap") or not book_store.covers(h, side, lo, hi):
            break
        usd = book_store.zone_depth(h, p[f"twa_{side}"], side, lo, hi)[1]
        if ref is None:
            ref = usd
            if ref <= 0:
                return None, None, None
        if aging:
            if usd >= KEEP * ref:
                age += 1
            else:
                aging = False
        if seen < HOUR_MIN:
            low = usd if low is None else min(low, usd)
        seen += 1
        i -= 1
        expect -= MINUTE
    if not seen:
        return None, None, None
    held = round(low) if seen >= HOUR_MIN else None
    return age, held, (round(low / ref, 3) if held is not None else None)


def pattern(v: dict) -> Optional[str]:
    """Que paso en la visita, con la misma regla para tus zonas y para el azar (None si no se resolvio o no hay libro)."""
    if v["outcome"] not in ("aguanto", "cruzo") or not v.get("approach_usd") or v.get("arrival_usd") is None:
        return None
    kept = v["arrival_usd"] >= KEEP * v["approach_usd"]
    if v["outcome"] == "aguanto":
        if v["pierced"]:
            return "barrido"            # la perforo (una limit ahi se lleno) y volvio
        if not kept:
            return "retiro_y_rebote"    # se fue la mitad o mas y aun asi aguanto
        traded = v.get("traded_usd")
        return "absorcion" if traded is not None and traded >= v["approach_usd"] else "defensa"
    return "consumida" if kept else "retiro_y_cruce"


def zone_usd(sec: dict, j: int, side: str, lo: float, hi: float) -> Optional[float]:
    header = sec["heads"][sec["blk"][j]]
    rows = sec["bids"] if side == "b" else sec["asks"]
    if not book_store.covers(header, side, lo, hi):
        return None
    return book_store.zone_depth(header, rows[sec["blk"][j]][sec["row"][j]], side, lo, hi)[1]


class Trades:
    """Trades exactos del almacen (oficial, nube + PC, o solo PC), por dia, con su hora en ms."""

    def __init__(self, symbol: str):
        sys.path.insert(0, str(REPO_DIR / "5.Order_flow" / "cloud_collector"))
        import tape_format
        self.read = tape_format.read_tape
        self.symbol = symbol
        self.days: Dict[str, Optional[tuple]] = {}
        data = Path(CONFIG["orderflow_data"])
        self.roots = [data / "tape", data / "live" / "tape", data / "live" / "local" / "tape"]

    def _day(self, day: str):
        if day not in self.days:
            while len(self.days) >= 2:  # un dia de BTC son millones de trades: quedan solo dos en memoria
                self.days.pop(next(iter(self.days)))
            got = None
            for root in self.roots:
                path = root / self.symbol / day[:4] / f"{self.symbol}_{day}.tape"
                if path.exists():
                    try:
                        meta, t, p, q, side, rpi = self.read(path)
                        got = (t // 10, p / meta["price_scale"], q / meta["qty_scale"], side, rpi)
                        break
                    except Exception:
                        continue
            self.days[day] = got
        return self.days[day]

    def against(self, start: int, end: int, lo: float, hi: float, zone_side: str) -> Optional[float]:
        """USD negociado en [lo, hi] entre start y end contra ese lado (ventas agresivas contra las compras)."""
        total, seen = 0.0, False
        for day in book_store.days_between(start, end):
            d = self._day(day)
            if d is None:
                continue
            seen = True
            t, p, q, side, rpi = d
            a, b = np.searchsorted(t, [start, end])
            pp, qq, ss = p[a:b], q[a:b], side[a:b]
            mask = (pp >= lo) & (pp <= hi) & (ss == (-1 if zone_side == "b" else 1))
            total += float((pp[mask] * qq[mask]).sum())
        return total if seen else None


def candles_from_seconds(sec: dict, frame_ms: int) -> Dict[str, np.ndarray]:
    """Velas del precio medio de cada segundo (para el ATR y los FVG si faltan trades)."""
    mid = (sec["bb"] + sec["ba"]) / 2
    bucket = sec["ts"] // frame_ms
    starts, idx = np.unique(bucket, return_index=True)
    ends = np.r_[idx[1:], len(mid)]
    high = np.array([mid[a:b].max() for a, b in zip(idx, ends)])
    low = np.array([mid[a:b].min() for a, b in zip(idx, ends)])
    close = np.array([mid[b - 1] for b in ends])
    return {"start": starts * frame_ms, "high": high, "low": low, "close": close}


def atr_series(c: Dict[str, np.ndarray], n: int = 14) -> np.ndarray:
    prev = np.r_[c["close"][0], c["close"][:-1]]
    tr = np.maximum(c["high"] - c["low"], np.maximum(abs(c["high"] - prev), abs(c["low"] - prev)))
    out = np.full(len(tr), np.nan)
    for i in range(len(tr)):
        if i + 1 >= n:
            out[i] = tr[i + 1 - n:i + 1].mean()
    return out


def candles_from_minutes(m: dict, frame_ms: int) -> Dict[str, np.ndarray]:
    """Velas de los trades del almacen (minutos de App 1)."""
    frame_min = frame_ms // MINUTE
    bucket = m["m"] // frame_min
    starts, idx = np.unique(bucket, return_index=True)
    ends = np.r_[idx[1:], len(bucket)]
    return {"start": starts * frame_ms, "high": np.array([m["h"][a:b].max() for a, b in zip(idx, ends)]),
            "low": np.array([m["l"][a:b].min() for a, b in zip(idx, ends)]),
            "close": np.array([m["c"][b - 1] for b in ends])}


def atr_at(sec: dict, frame_ms: int = 15 * MINUTE, minutes: Optional[dict] = None) -> np.ndarray:
    """ATR de la ultima vela de 15m cerrada antes de cada segundo. Con los minutos del almacen no depende de
    cuanto libro hay grabado; sin ellos sale del precio medio de cada segundo."""
    c = candles_from_minutes(minutes, frame_ms) if minutes is not None and len(minutes["m"]) else candles_from_seconds(sec, frame_ms)
    atr = atr_series(c)
    closed = np.searchsorted(c["start"] + frame_ms, sec["ts"], side="right") - 1
    out = np.where(closed >= 0, atr[np.clip(closed, 0, None)], np.nan)
    return out


# ---------- zonas ----------
def vp_zones(fs, symbol: str, day_start: int) -> List[dict]:
    """POC, VAH y VAL del dia anterior, con el volumen real del almacen."""
    prev = day_start - DAY
    m = fs.minutes(symbol, prev // MINUTE, day_start // MINUTE, live=True)
    if m is None or len(m["m"]) < 600:
        return []
    low, high = float(np.min(m["l"])), float(np.max(m["h"]))
    if not high > low:
        return []
    rows = int(min(1000, max(50, (high - low) / (high * 0.0002))))
    prof = fs.profile(symbol, prev, day_start, None, low, high, rows, live=True)
    vol = np.array(prof["buy"]) + np.array(prof["sell"])
    if vol.sum() <= 0:
        return []
    poc = int(vol.argmax())
    lo_i = hi_i = poc
    acc = vol[poc]
    while acc < 0.7 * vol.sum() and (lo_i > 0 or hi_i < rows - 1):
        down = vol[lo_i - 1] if lo_i > 0 else -1
        up = vol[hi_i + 1] if hi_i < rows - 1 else -1
        if up >= down:
            hi_i += 1
            acc += vol[hi_i]
        else:
            lo_i -= 1
            acc += vol[lo_i]
    h = (high - low) / rows
    price = {"POC": low + (poc + 0.5) * h, "VAH": low + (hi_i + 1) * h, "VAL": low + lo_i * h}
    return [{"kind": "perfil", "label": k, "lo": p * (1 - POINT_ZONE), "hi": p * (1 + POINT_ZONE),
             "from": day_start, "to": day_start + DAY} for k, p in price.items()]


def fvg_zones(fs, symbol: str, start: int, end: int, frame_min: int) -> List[dict]:
    """FVG de 15m o 1h con las velas de los trades: hueco entre la vela i-2 y la i, desde el cierre de la i."""
    m = fs.minutes(symbol, (start - ZONE_DAYS * DAY) // MINUTE, end // MINUTE, live=True)
    if m is None or not len(m["m"]):
        return []
    bucket = m["m"] // frame_min
    starts, idx = np.unique(bucket, return_index=True)
    ends = np.r_[idx[1:], len(bucket)]
    hi = np.array([m["h"][a:b].max() for a, b in zip(idx, ends)])
    lo = np.array([m["l"][a:b].min() for a, b in zip(idx, ends)])
    out = []
    for i in range(2, len(starts)):
        if starts[i] - starts[i - 2] != 2:
            continue  # velas que faltan: no se arma
        known = int((starts[i] + 1) * frame_min * MINUTE)
        if known >= end:
            break
        for kind, a, b in (("alcista", hi[i - 2], lo[i]), ("bajista", hi[i], lo[i - 2])):
            if b > a and FVG_MIN <= (b - a) / b <= FVG_MAX:
                # se llena cuando el precio lo cruza entero; hasta entonces, a lo sumo ZONE_DAYS
                after = np.arange(i + 1, len(starts))
                if kind == "alcista":
                    filled = after[lo[after] < a]
                else:
                    filled = after[hi[after] > b]
                stop = int(starts[filled[0]] * frame_min * MINUTE) if len(filled) else known + ZONE_DAYS * DAY
                out.append({"kind": f"fvg{frame_min}", "label": kind, "lo": float(a), "hi": float(b), "from": known,
                            "to": min(stop, known + ZONE_DAYS * DAY)})
    return [z for z in out if z["to"] > start]


def journal_zones(symbol: str, start: int, end: int) -> List[dict]:
    try:
        from journal_store import JournalStore
        store = JournalStore(Path(CONFIG["data_dir"]) / "journal")
        events = store.contexts()
    except Exception:
        return []
    out = []
    for e in events:
        if e.get("kind") != "decision" or e.get("symbol") != symbol or not e.get("at"):
            continue
        for level in e.get("levels") or []:
            p = level.get("price")
            if p and not level.get("mark"):
                out.append({"kind": "journal", "label": level.get("role") or level.get("kind") or "nivel",
                            "lo": p * (1 - POINT_ZONE), "hi": p * (1 + POINT_ZONE), "from": int(e["at"]),
                            "to": int(e["at"]) + ZONE_DAYS * DAY})
    return [z for z in out if z["to"] > start and z["from"] < end]


def random_zones(zones: List[dict], seed: int = 7) -> List[dict]:
    rnd = random.Random(seed)
    out = []
    for z in zones:
        mid, half = (z["lo"] + z["hi"]) / 2, (z["hi"] - z["lo"]) / 2
        for _ in range(RANDOM_PER_ZONE):
            shift = rnd.uniform(*RANDOM_SHIFT) * rnd.choice((-1, 1))
            c = mid * (1 + shift)
            out.append({**z, "kind": z["kind"] + "_azar", "lo": c - half, "hi": c + half})
    return out


# ---------- visitas ----------
def visits(sec: dict, atr: np.ndarray, zone: dict, trades: Optional[Trades], mins: Optional[dict] = None) -> List[dict]:
    ts, bb, ba = sec["ts"], sec["bb"], sec["ba"]
    a, b = np.searchsorted(ts, [zone["from"], zone["to"]])
    if b - a < 120:
        return []
    lo, hi = zone["lo"], zone["hi"]
    out = []
    stop = int(np.searchsorted(ts, zone["to"] + MAX_VISIT_MS))  # una visita puede resolverse despues de que la zona vence
    for side in ("b", "a"):
        sl = slice(a, stop)
        t, x, y, at = ts[sl], bb[sl], ba[sl], atr[sl]
        ok = np.isfinite(at)
        if side == "b":   # compras: la zona queda debajo del precio
            armed = ok & (x >= hi + ARM_ATR * at)
            arrive = x <= hi
            cross = y < lo - CROSS_ATR * at
            held = x >= hi + HOLD_ATR * at
            pierce = x < lo
        else:             # ventas: la zona queda arriba
            armed = ok & (y <= lo - ARM_ATR * at)
            arrive = y >= lo
            cross = x > hi + CROSS_ATR * at
            held = y <= lo - HOLD_ATR * at
            pierce = y > hi
        A, R, X, H = (np.flatnonzero(v) for v in (armed, arrive, cross, held))
        pos = 0
        while True:
            i = np.searchsorted(A, pos)
            if i >= len(A):
                break
            arm_i = A[i]
            r = np.searchsorted(R, arm_i)
            if r >= len(R):
                break
            j = R[r]
            if t[j] >= zone["to"]:
                break
            last_arm = A[np.searchsorted(A, j) - 1]
            kx = X[np.searchsorted(X, j)] if np.searchsorted(X, j) < len(X) else None
            kh = H[np.searchsorted(H, j)] if np.searchsorted(H, j) < len(H) else None
            k = min(v for v in (kx, kh) if v is not None) if (kx is not None or kh is not None) else None
            if k is None or t[k] - t[j] > MAX_VISIT_MS:
                outcome, k = "sin_resolver", min(len(t) - 1, j + int(MAX_VISIT_MS / 1000))
            else:
                outcome = "cruzo" if k == kx else "aguanto"
            span = np.diff(t[j - 1:k + 1]) if k > j else np.array([0])
            gi = a + last_arm, a + j - 1
            approach = zone_usd(sec, gi[0], side, lo, hi)
            arrival = zone_usd(sec, gi[1], side, lo, hi) if j > 0 else None
            traded = trades.against(int(t[j - 1]), int(t[k]), lo, hi, side) if trades and j > 0 else None
            aged, held_1h, held_frac = zone_age(mins, int(t[last_arm]), side, lo, hi)
            v = {
                "kind": zone["kind"], "label": zone["label"], "side": side, "at": int(t[j]), "outcome": outcome,
                "seconds": round((t[k] - t[j]) / 1000, 1), "gap": bool(span.max() > 5000) if len(span) else False,
                "approach_usd": approach, "arrival_usd": arrival, "traded_usd": traded,
                "pierced": bool(pierce[j:k + 1].any()), "atr_pct": round(float(at[j] / x[j] * 100), 4),
                "zone_pct": round((hi - lo) / hi * 100, 4), "lo": lo, "hi": hi,
                "approach_s": round(float(t[j] - t[last_arm]) / 1000, 1), "aged_min": aged, "sustained_1h_usd": held_1h,
                "sustained_frac": held_frac,
            }
            v["pattern"] = pattern(v)
            out.append(v)
            pos = k + 1
    return out


# ---------- resumen ----------
def _rate(items, outcome="aguanto"):
    done = [v for v in items if v["outcome"] in ("aguanto", "cruzo")]
    if not done:
        return None, 0
    k = sum(1 for v in done if v["outcome"] == outcome)
    return k / len(done), len(done)


def _diff_ci(p1, n1, p2, n2):
    if not n1 or not n2 or p1 is None or p2 is None:
        return None
    se = math.sqrt(p1 * (1 - p1) / n1 + p2 * (1 - p2) / n2)
    d = p1 - p2
    return [round(100 * (d - 1.96 * se), 1), round(100 * (d + 1.96 * se), 1)]


def summarize(items: List[dict]) -> dict:
    items = [v for v in items if not v["gap"]]
    hold, n = _rate(items)
    with_depth = [v for v in items if v["approach_usd"] and v["outcome"] != "sin_resolver"]
    surv = [v["arrival_usd"] / v["approach_usd"] for v in with_depth if v["arrival_usd"] is not None]
    traded = [v["traded_usd"] / v["approach_usd"] for v in with_depth if v["traded_usd"] is not None]
    out = {"visitas": len(items), "resueltas": n, "aguanto_pct": round(100 * hold, 1) if hold is not None else None,
           "llena_y_aguanta_pct": None, "mediana_usd_al_acercarse": None, "llegaba_de_lo_que_habia": None,
           "negociado_sobre_lo_que_habia": None, "cargadas_aguanto_pct": None, "resto_aguanto_pct": None,
           "patrones": None, "patrones_n": 0, "patrones_cargadas": None,
           "antigua_aguanto_pct": None, "antigua_n": 0, "reciente_aguanto_pct": None, "reciente_n": 0,
           "antiguedad_mediana_min": None, "sostenida_mediana": None,
           "rapida_aguanto_pct": None, "rapida_n": 0, "rapida_llegaba": None,
           "lenta_aguanto_pct": None, "lenta_n": 0, "lenta_llegaba": None,
           "muestra_pequena": n < MIN_GROUP}
    done = [v for v in items if v["outcome"] in ("aguanto", "cruzo")]
    if done:
        out["llena_y_aguanta_pct"] = round(100 * sum(1 for v in done if v["outcome"] == "aguanto" and v["pierced"]) / len(done), 1)
    if with_depth:
        usd = sorted(v["approach_usd"] for v in with_depth)
        out["mediana_usd_al_acercarse"] = round(float(np.median(usd)))
        cut = usd[int(len(usd) * 0.8)] if len(usd) >= 5 else None
        if cut is not None:
            top = [v for v in with_depth if v["approach_usd"] >= cut]
            rest = [v for v in with_depth if v["approach_usd"] < cut]
            ht, _ = _rate(top)
            hr, _ = _rate(rest)
            out["cargadas_aguanto_pct"] = round(100 * ht, 1) if ht is not None else None
            out["resto_aguanto_pct"] = round(100 * hr, 1) if hr is not None else None
    if surv:
        out["llegaba_de_lo_que_habia"] = round(float(np.median(surv)), 3)
    if traded:
        out["negociado_sobre_lo_que_habia"] = round(float(np.median(traded)), 3)

    def shares(sel):
        sel = [v for v in sel if v.get("pattern")]
        return {k: round(100 * sum(1 for v in sel if v["pattern"] == k) / len(sel), 1) for k in PATTERNS} if sel else None

    pats = [v for v in with_depth if v.get("pattern")]
    out["patrones"], out["patrones_n"] = shares(pats), len(pats)
    if with_depth and len(with_depth) >= 5:
        usd = sorted(v["approach_usd"] for v in with_depth)
        out["patrones_cargadas"] = shares([v for v in with_depth if v["approach_usd"] >= usd[int(len(usd) * 0.8)]])

    def rate_into(name, sel, survival=False):
        r, k = _rate(sel)
        out[f"{name}_aguanto_pct"] = round(100 * r, 1) if r is not None else None
        out[f"{name}_n"] = k
        if survival:
            s_ = [v["arrival_usd"] / v["approach_usd"] for v in sel if v["arrival_usd"] is not None]
            out[f"{name}_llegaba"] = round(float(np.median(s_)), 3) if s_ else None

    aged = [v for v in with_depth if v.get("aged_min") is not None]
    rate_into("antigua", [v for v in aged if v["aged_min"] >= OLD_MIN])
    rate_into("reciente", [v for v in aged if v["aged_min"] < RECENT_MIN])
    if aged:
        out["antiguedad_mediana_min"] = float(np.median([v["aged_min"] for v in aged]))
    fr = [v["sustained_frac"] for v in with_depth if v.get("sustained_frac") is not None]
    if fr:
        out["sostenida_mediana"] = round(float(np.median(fr)), 3)
    timed = [v for v in with_depth if v.get("approach_s") is not None]
    rate_into("rapida", [v for v in timed if v["approach_s"] <= FAST_S], survival=True)
    rate_into("lenta", [v for v in timed if v["approach_s"] > SLOW_S], survival=True)
    return out


def run(symbols: List[str], start: int, end: int, base: Optional[Path] = None, with_trades: bool = True,
        zones_for=None) -> dict:
    """Recorre los dias de [start, end) de cada moneda. zones_for(symbol, day_start, sec) reemplaza las zonas (pruebas)."""
    base = base or book_store.sources(CONFIG["orderflow_data"])  # lo grabado en el PC y lo bajado de la nube
    fs = None if zones_for else _app1()
    all_visits: List[dict] = []
    days_done = {}
    for symbol in symbols:
        trades = Trades(symbol) if with_trades else None
        day = start - start % DAY
        while day < end:
            a, b = max(start, day), min(end, day + DAY)
            # 4 horas antes: el ATR de 15m necesita 14 velas cerradas
            sec = load_seconds(base, symbol, a - 4 * 3600000, b + MAX_VISIT_MS)
            if sec is None:
                day += DAY
                continue
            mins = None if fs is None else fs.minutes(symbol, (a - DAY) // MINUTE, (b + MAX_VISIT_MS) // MINUTE, live=True)
            atr = atr_at(sec, minutes=mins)
            book_mins = load_minutes(base, symbol, a - (AGE_MAX_MIN + 2) * MINUTE, b + MAX_VISIT_MS)  # para la antiguedad
            if zones_for:
                zones = zones_for(symbol, day, sec)
            else:
                zones = vp_zones(fs, symbol, day) + fvg_zones(fs, symbol, a, b, 15) + fvg_zones(fs, symbol, a, b, 60) \
                        + journal_zones(symbol, a, b)
            zones = [dict(z, **{"from": max(z["from"], a), "to": min(z["to"], b)}) for z in zones if z["to"] > a and z["from"] < b]
            seed = (sum(map(ord, symbol)) * 1000003 + day // DAY) & 0xFFFFFFFF  # el mismo azar cada vez
            for z in zones + random_zones(zones, seed=seed):
                for v in visits(sec, atr, z, trades, book_mins):
                    all_visits.append(dict(v, symbol=symbol))
            days_done.setdefault(symbol, []).append(book_store.day_of(day))
            day += DAY
    groups: Dict[str, List[dict]] = {}
    for v in all_visits:
        groups.setdefault(v["kind"], []).append(v)
    real = [v for v in all_visits if not v["kind"].endswith("_azar")]
    rand = [v for v in all_visits if v["kind"].endswith("_azar")]
    out = {"desde": book_store.day_of(start), "hasta": book_store.day_of(end - 1), "dias": days_done,
           "reglas": {"llega_desde_atr": ARM_ATR, "aguanta_atr": HOLD_ATR, "cruza_atr": CROSS_ATR, "atr": "15m, 14 velas",
                      "nivel_pct": POINT_ZONE * 100, "azar_por_zona": RANDOM_PER_ZONE, "azar_corrida_pct": [x * 100 for x in RANDOM_SHIFT],
                      "se_quedo": KEEP, "antiguedad_hasta_min": AGE_MAX_MIN, "antigua_min": OLD_MIN,
                      "reciente_min": RECENT_MIN, "sostenida_en_min": HOUR_MIN,
                      "llegada_rapida_s": FAST_S, "llegada_lenta_s": SLOW_S,
                      "patrones": list(PATTERNS)},
           "tus_zonas": summarize(real), "al_azar": summarize(rand),
           "por_tipo": {k: summarize(v) for k, v in sorted(groups.items())}}
    p1, n1 = _rate([v for v in real if not v["gap"]])
    p2, n2 = _rate([v for v in rand if not v["gap"]])
    out["diferencia_aguante_pts"] = round(100 * (p1 - p2), 1) if p1 is not None and p2 is not None else None
    out["ic95_diferencia_pts"] = _diff_ci(p1, n1, p2, n2)
    out["visitas"] = all_visits
    return out


def _print(res: dict):
    def line(name, s):
        return (f"  {name:<14} visitas {s['visitas']:>5}  resueltas {s['resueltas']:>5}  aguanto {s['aguanto_pct']}%"
                f"  llena y aguanta {s['llena_y_aguanta_pct']}%  llegaba {s['llegaba_de_lo_que_habia']}"
                f"  negociado/habia {s['negociado_sobre_lo_que_habia']}  cargadas {s['cargadas_aguanto_pct']}%"
                f" / resto {s['resto_aguanto_pct']}%" + ("  (muestra pequeña)" if s["muestra_pequena"] else ""))
    print(f"Del {res['desde']} al {res['hasta']}: {', '.join(f'{k} {len(v)} días' for k, v in res['dias'].items()) or 'sin libro grabado'}")
    print(line("tus zonas", res["tus_zonas"]))
    print(line("al azar", res["al_azar"]))
    print(f"  diferencia en el aguante: {res['diferencia_aguante_pts']} pts, IC 95% {res['ic95_diferencia_pts']}")
    for k, s in res["por_tipo"].items():
        print(line(k, s))

    def pct(d, k):
        return f"{d[k]}%" if d and d.get(k) is not None else "-"

    for name, s in (("tus zonas", res["tus_zonas"]), ("al azar", res["al_azar"])):
        pats = s.get("patrones")
        print(f"  {name}: patrones en {s['patrones_n']} visitas: "
              + ("  ".join(f"{k.replace('_', ' ')} {pct(pats, k)}" for k in PATTERNS) if pats else "sin libro"))
        if s.get("patrones_cargadas"):
            print("    las mas cargadas: " + "  ".join(f"{k.replace('_', ' ')} {pct(s['patrones_cargadas'], k)}" for k in PATTERNS))
        print(f"    antiguedad de la liquidez: mediana {s['antiguedad_mediana_min']} min; con {OLD_MIN} min o mas aguanto"
              f" {s['antigua_aguanto_pct']}% ({s['antigua_n']}) | reciente, menos de {RECENT_MIN} min: {s['reciente_aguanto_pct']}%"
              f" ({s['reciente_n']}) | parte que estuvo toda la hora anterior: mediana {s['sostenida_mediana']}")
        print(f"    llegada rapida, {FAST_S} s o menos: aguanto {s['rapida_aguanto_pct']}% ({s['rapida_n']}), quedaba {s['rapida_llegaba']}"
              f" | lenta, mas de {SLOW_S // 60} min: {s['lenta_aguanto_pct']}% ({s['lenta_n']}), quedaba {s['lenta_llegaba']}")


def _ms(day: str) -> int:
    return int(datetime.strptime(day, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Uso: python -B book_study.py BTCUSDT,ETHUSDT AAAA-MM-DD AAAA-MM-DD [salida.json]")
        sys.exit(1)
    syms = [s.strip().upper() for s in sys.argv[1].split(",") if s.strip()]
    res = run(syms, _ms(sys.argv[2]), _ms(sys.argv[3]) + DAY)
    _print(res)
    if len(sys.argv) > 4:
        Path(sys.argv[4]).write_text(json.dumps(res, indent=1), encoding="utf-8")
        print("Guardado en", sys.argv[4])
