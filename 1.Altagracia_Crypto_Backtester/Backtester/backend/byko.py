"""
Los elementos de Byko (Bikotrading) para el probador (21/11/2026), con su firma y su control "sin la firma".

Las reglas y sus cifras quedaron fijadas antes de correrlas en docs/PLAN_ESTRATEGIAS_BYKO_DALE.md (paso 2). Las cajas son
las de la eficiencia con caja (regime_detectors.er_box), las mismas de la Ruptura de caja. Sin futuro: velas cerradas,
el ATR de la vela anterior y el OI que se conocía al cierre de cada vela (oi_history.at_close, 5 minutos después de su
marca).

- FB, falso rompimiento: una vela pasa el borde de una caja vigente (la anterior había cerrado dentro) y esa vela o una de
  las `back` siguientes cierra dentro. El evento es esa vela, en contra. Firma: llegada impulsiva (en las
  `approachBars` velas hasta la que perfora, el precio estuvo a `approachAtr` ATR o más del borde) y volumen (una vela
  entre la que perfora y la que vuelve con `vol` veces la mediana de su hora). Zona: del borde al extremo de la
  perforación. Se rearma cuando un cierre vuelve al tercio central.
- BA, ruptura tras acumulación: la vela que cierra fuera de la caja y la termina, a favor. Firma: las `bars` velas
  anteriores cerraron dentro y a `near` ATR o menos del borde que se rompe, con mínimos crecientes (el mínimo de la
  segunda mitad ≥ el de la primera; al revés en el piso). Zona: del borde al extremo de esas velas.
- TA, trampa de absorción: dentro de una caja, una vela llega al `share` de arriba (o de abajo) tras `rise` ATR desde el
  mínimo de las `riseBars` velas anteriores. Firma: el OI subió en `oiBars` velas con z ≥ `z` y el cierre avanzó
  `advance` ATR o menos en esas velas. Evento en contra; zona del cierre al extremo de esas velas.
- PO, purga de OI: el cierre recorrió `move` ATR en `bars` velas y la segunda mitad más que la primera (acelera), con
  `vol` veces el volumen de su hora. Firma: el OI cayó en `oiBars` velas con z ≤ −`z`. Evento en contra del movimiento;
  zona del cierre al extremo. Tras un candidato, `bars` velas sin otro.

El z del OI es el del cambio de `oiBars` velas (en logaritmo) contra los de los 30 días anteriores, sin el de la vela.
Un candidato de TA o PO sin OI no cuenta en ningún grupo. Cada candidato lleva `sig` en su `info`: events() da los que
cumplen la firma, y con `control` los que no (el control "sin la firma" de rule_tester.run).
"""
import json

import numpy as np

import measures
import oi_history

CODES = {"FB": "Falso rompimiento (Byko): perfora el borde de una caja con volumen y vuelve adentro",
         "BA": "Ruptura tras acumulación (Byko): rompe la caja tras pegarse al borde con mínimos crecientes",
         "TA": "Trampa de absorción (Byko): en el borde el OI salta y el precio no avanza",
         "PO": "Purga de OI (Byko): el OI cae de golpe al final de un movimiento acelerado"}
KEYS = {"FB": "fb", "BA": "ba", "TA": "ta", "PO": "po"}
OI_CODES = ("TA", "PO")  # Necesitan el OI de 5 minutos (oi_history)
OI_SOURCES = ("sum", "bybit", "binance")
Z_DAYS = 30

# Campo: (por defecto, mínimo, máximo, entero)
PARAMS = {
    "fb": {"back": (3, 0, 20, True), "approachBars": (4, 1, 50, True), "approachAtr": (2.0, 0.0, 20.0, False), "vol": (3.0, 0.0, 50.0, False)},
    "ba": {"bars": (6, 2, 100, True), "near": (1.0, 0.1, 20.0, False)},
    "ta": {"rise": (2.0, 0.0, 20.0, False), "riseBars": (10, 1, 200, True), "share": (0.2, 0.05, 0.5, False),
           "oiBars": (3, 1, 100, True), "z": (2.0, 0.0, 10.0, False), "advance": (0.5, -5.0, 20.0, False)},
    "po": {"move": (3.0, 0.5, 50.0, False), "bars": (6, 2, 100, True), "vol": (3.0, 0.0, 50.0, False),
           "oiBars": (2, 1, 100, True), "z": (2.0, 0.0, 10.0, False)},
}


def clean(key, raw):
    """Los parámetros de un elemento, con sus valores de fábrica y dentro de rango."""
    raw = raw or {}
    out = {}
    for field, (default, low, high, whole) in PARAMS[key].items():
        try:
            value = float(raw.get(field, default))
        except (TypeError, ValueError):
            value = default
        if value != value:
            value = default
        value = max(low, min(high, value))
        out[field] = int(round(value)) if whole else value
    if key in ("ta", "po"):
        out["source"] = raw.get("source") if raw.get("source") in OI_SOURCES else "sum"
    return out


def oi_stamp(symbol, cfg):
    """Huella de los archivos de OI que usa la regla: el caché de elementos se rehace si cambian (la bajada sigue)."""
    sources = {(cfg.get(k) or {}).get("source") for k in ("ta", "po") if cfg.get(k)}
    files = set()
    for s in sources:
        files |= {"bybit", "binance"} if s == "sum" else {s}
    out = []
    for name in sorted(files):
        try:
            out.append((name, oi_history.path(name, symbol).stat().st_mtime_ns))
        except OSError:
            out.append((name, None))
    return json.dumps(out)


def oi_z(oi, k, tf, days=Z_DAYS):
    """z del cambio de k velas del OI (en logaritmo) contra los de los `days` días anteriores, sin el de la vela. NaN sin datos."""
    n = len(oi)
    x = np.full(n, np.nan)
    if n > k:
        with np.errstate(divide="ignore", invalid="ignore"):
            x[k:] = np.log(oi[k:] / oi[:-k])
    x[~np.isfinite(x)] = np.nan
    finite = np.isfinite(x)
    w = max(10, int(days * 1440 / tf))
    xs = np.where(finite, x, 0.0)
    c1, c2, cn = np.r_[0.0, np.cumsum(xs)], np.r_[0.0, np.cumsum(xs * xs)], np.r_[0, np.cumsum(finite)]
    idx = np.arange(n)
    lo = np.maximum(0, idx - w)
    cnt = cn[idx] - cn[lo]  # Los cambios de las velas lo..idx-1: la vela misma no entra
    s1, s2 = c1[idx] - c1[lo], c2[idx] - c2[lo]
    mean = s1 / np.maximum(cnt, 1)
    var = (s2 - cnt * mean * mean) / np.maximum(cnt - 1, 1)
    sd = np.sqrt(np.maximum(var, 0.0))
    z = np.full(n, np.nan)
    ok = finite & (cnt >= w // 2) & (sd > 0)
    z[ok] = (x[ok] - mean[ok]) / sd[ok]
    return z, x


def _box(t, z, i, atr):
    height = (z["high"] - z["low"]) / atr[i]
    return {"low": round(float(z["low"]), 8), "high": round(float(z["high"]), 8), "start": int(t[z["start"]]),
            "detected": int(t[z["detected"]]), "heightAtr": round(float(height), 2) if np.isfinite(height) else None}


def _event(code, side, t, i, step, lo, hi, info):
    return {"code": code, "dir": int(side), "t": int(t[i]), "known": int(t[i] + step), "lo": float(lo), "hi": float(hi), "info": info}


def _fb(t, h, l, c, atr, volx, zones, cfg, step):
    out, n = [], len(c)
    back, nb, need, vmin = cfg["back"], cfg["approachBars"], cfg["approachAtr"], cfg["vol"]
    for z in zones:
        top, bot = z["high"], z["low"]
        height = top - bot
        if height <= 0:
            continue
        mid = (top + bot) / 2
        armed = {1: True, -1: True}  # 1: perforación del techo (evento corto); -1: del piso (evento largo)
        for j in range(z["detected"] + 1, min(z["end"] + 2, n)):
            if abs(c[j] - mid) < height / 6:
                armed = {1: True, -1: True}
            for edge in (1, -1):
                beyond = h[j] > top if edge == 1 else l[j] < bot
                was_in = c[j - 1] <= top if edge == 1 else c[j - 1] >= bot
                if not (armed[edge] and beyond and was_in):
                    continue
                r = next((k for k in range(j, min(j + back + 1, n)) if (c[k] < top if edge == 1 else c[k] > bot)), None)
                if r is None:
                    continue  # No volvió: una ruptura, no un falso rompimiento
                armed[edge] = False
                a = atr[j - 1]
                start = max(0, j - nb + 1)
                run = (top - l[start:j + 1].min()) / a if edge == 1 else (h[start:j + 1].max() - bot) / a
                volume = float(volx[j:r + 1].max())
                extreme = float(h[j:r + 1].max()) if edge == 1 else float(l[j:r + 1].min())
                sig = bool(run >= need and volume >= vmin)
                info = {"box": _box(t, z, j, atr), "sig": sig, "approachAtr": round(float(run), 2), "volx": round(volume, 2),
                        "pierced": int(t[j]), "extreme": round(extreme, 8)}
                lo, hi = (top, extreme) if edge == 1 else (extreme, bot)
                out.append(_event("FB", -edge, t, r, step, lo, hi, info))
    return out


def _ba(t, h, l, c, atr, zones, cfg, step):
    out, n = [], len(c)
    m, near = cfg["bars"], cfg["near"]
    half = m // 2
    for z in zones:
        i = z["end"] + 1
        if i >= n or i - m < 0:
            continue
        top, bot = z["high"], z["low"]
        side = 1 if c[i] > top else -1 if c[i] < bot else 0
        if not side:
            continue  # La caja terminó por la eficiencia, sin cerrar fuera
        a = atr[i - 1]
        closes = c[i - m:i]
        if side == 1:
            hug = bool((closes <= top).all() and (closes >= top - near * a).all())
            rising = bool(l[i - half:i].min() >= l[i - m:i - half].min())
            lo, hi = float(l[i - m:i].min()), top
        else:
            hug = bool((closes >= bot).all() and (closes <= bot + near * a).all())
            rising = bool(h[i - half:i].max() <= h[i - m:i - half].max())
            lo, hi = bot, float(h[i - m:i].max())
        inside = i - m >= z["start"]
        sig = hug and rising and inside
        gap = (top - closes.min()) / a if side == 1 else (closes.max() - bot) / a
        info = {"box": _box(t, z, i, atr), "sig": sig, "nearAtr": round(float(gap), 2), "rising": rising}
        out.append(_event("BA", side, t, i, step, lo, hi, info))
    return out


def _ta(t, h, l, c, atr, zones, zoi, xoi, cfg, step):
    out, n = [], len(c)
    rise, rb, share, k, zmin, adv = cfg["rise"], cfg["riseBars"], cfg["share"], cfg["oiBars"], cfg["z"], cfg["advance"]
    for z in zones:
        top, bot = z["high"], z["low"]
        height = top - bot
        if height <= 0:
            continue
        mid = (top + bot) / 2
        armed = {1: True, -1: True}  # 1: llegada al techo (evento corto); -1: al piso (evento largo)
        for j in range(max(z["detected"] + 1, rb, k), min(z["end"] + 1, n)):
            if abs(c[j] - mid) < height / 6:
                armed = {1: True, -1: True}
            a = atr[j - 1]
            for edge in (1, -1):
                if not armed[edge]:
                    continue
                if edge == 1:
                    arrived = h[j] >= top - share * height and c[j] - l[j - rb:j].min() >= rise * a
                else:
                    arrived = l[j] <= bot + share * height and h[j - rb:j].max() - c[j] >= rise * a
                if not arrived:
                    continue
                armed[edge] = False
                if not np.isfinite(zoi[j]):
                    continue  # Sin OI no cuenta en ningún grupo
                advance = (c[j] - c[j - k]) * edge / a
                sig = bool(zoi[j] >= zmin and advance <= adv)
                extreme = float(h[j - k + 1:j + 1].max()) if edge == 1 else float(l[j - k + 1:j + 1].min())
                info = {"box": _box(t, z, j, atr), "sig": sig, "oiZ": round(float(zoi[j]), 2),
                        "oiPct": round(float(np.expm1(xoi[j]) * 100), 2), "advanceAtr": round(float(advance), 2)}
                lo, hi = (c[j], extreme) if edge == 1 else (extreme, c[j])
                out.append(_event("TA", -edge, t, j, step, lo, hi, info))
    return out


def _po(t, h, l, c, atr, volx, zoi, xoi, cfg, step):
    out, n = [], len(c)
    move, m, vmin, zmin = cfg["move"], cfg["bars"], cfg["vol"], cfg["z"]
    half = m // 2
    free = m
    for j in range(m, n):
        if j < free:
            continue
        a = atr[j - 1]
        total = c[j] - c[j - m]
        if abs(total) < move * a:
            continue
        d = 1 if total > 0 else -1
        last, first = c[j] - c[j - half], c[j - half] - c[j - m]
        if last * d <= 0 or abs(last) <= abs(first) or volx[j] < vmin:
            continue
        free = j + m  # Un candidato por movimiento
        if not np.isfinite(zoi[j]):
            continue
        sig = bool(zoi[j] <= -zmin)
        extreme = float(h[j - m + 1:j + 1].max()) if d > 0 else float(l[j - m + 1:j + 1].min())
        info = {"sig": sig, "oiZ": round(float(zoi[j]), 2), "oiPct": round(float(np.expm1(xoi[j]) * 100), 2),
                "moveAtr": round(float(abs(total) / a), 2), "volx": round(float(volx[j]), 2)}
        lo, hi = (c[j], extreme) if d > 0 else (extreme, c[j])
        out.append(_event("PO", -d, t, j, step, lo, hi, info))
    return out


def candidates(symbol, bars, tf, cfg, codes):
    """Todos los candidatos de los elementos pedidos, con su `sig`. cfg: {"fb": {...}, "ba": ..., ...} (clean)."""
    codes = set(codes) & set(CODES)
    if not bars or not codes:
        return []
    import regime  # Aquí y no arriba: regime importa rule_tester, que importa este módulo
    import regime_detectors as rd
    t = np.array([b["t"] for b in bars], dtype=np.int64)
    o, h, l, c, v = (np.array([b[k] for b in bars], dtype=float) for k in ("o", "h", "l", "c", "vol"))
    atr = regime.atr(h, l, c)
    atr = np.where(atr > 0, atr, np.nan)
    step = tf * 60000
    out = []
    zones = rd.er_box({"t": t, "o": o, "h": h, "l": l, "c": c, "v": v}, **rd.PARAMS["er_box"]["params"])["zones"] if codes & {"FB", "BA", "TA"} else []
    volx = measures.hour_volume(t, v) if codes & {"FB", "PO"} else None
    if "FB" in codes:
        out += _fb(t, h, l, c, atr, volx, zones, cfg["fb"], step)
    if "BA" in codes:
        out += _ba(t, h, l, c, atr, zones, cfg["ba"], step)
    for code, fn in (("TA", _ta), ("PO", _po)):
        if code not in codes:
            continue
        p = cfg[KEYS[code]]
        oi = oi_history.at_close(symbol, bars, tf, p["source"])
        zoi, xoi = oi_z(oi, p["oiBars"], tf)
        out += fn(t, h, l, c, atr, zones, zoi, xoi, p, step) if code == "TA" else fn(t, h, l, c, atr, volx, zoi, xoi, p, step)
    # Un ATR nulo (velas sin rango al principio) deja medidas en NaN: esos candidatos no cuentan
    return [e for e in out if all(not isinstance(x, float) or x == x for x in e["info"].values())]


def events(symbol, bars, tf, cfg, codes, control=False):
    """Los candidatos que cumplen la firma; con `control`, los que no."""
    return [e for e in candidates(symbol, bars, tf, cfg, codes) if e["info"]["sig"] != control]
