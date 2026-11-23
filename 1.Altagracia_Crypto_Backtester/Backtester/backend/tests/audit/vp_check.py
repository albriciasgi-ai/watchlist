"""
Protocolo (21/11/2026), R13a, R13b y R14c: el perfil por sesión (VR, VF y VE) recalculado aparte.

Desde la documentación (CLAUDE.md de App 1, "Perfil por sesión, VR, VF y VX" y "VE"), sin usar vp_sessions.py:
- perfil de cada sesión UTC con las celdas reales del almacén (footprint_store.cells, solo para leer): 50 franjas
  entre el mínimo y el máximo; POC en la franja de más volumen; área de valor del 70% que crece hacia la vecina mayor;
  los niveles en el centro de su franja (lo que muestran los trades guardados: se comprueba al comparar);
- todo contra la sesión inmediatamente anterior; `accept` en minutos pasado a velas del marco; `failBars` en velas;
- VR: la sesión abre fuera del valor y `accept` cierres seguidos quedan dentro; va al borde contrario; una vez por
  sesión. Zona del borde al extremo;
- VF: con el cierre anterior dentro, una vela pasa el VAH o el VAL y en `failBars` velas una cierra de vuelta dentro;
  va al POC. Zona del borde al extremo;
- VE con la orden esperando: al cerrar la sesión anterior (si cerró dentro de su valor), una limit de compra en el
  VAL y una de venta en el VAH, válidas toda la sesión; zona del borde al mínimo o máximo de la sesión anterior; con
  targetAt "mid", el objetivo en el centro de ese rango; `shapes` deja solo esas formas;
- stop: borde lejano de la zona más `buffer` ATR (Wilder 14 de las velas de la regla, en la vela de la señal);
- un objetivo a menos de 0.3 R o ya pasado no se opera.
Compara los niveles de cada trade (POC, VAH, VAL, máximo y mínimo de la sesión anterior), la señal, la zona, el
stop y el objetivo. Las velas son las del motor (comparar.capture), para no mezclar la diferencia H11.

Uso: python -B tests/audit/vp_check.py <id de la corrida>
"""
import datetime as dt
import gzip
import json
import math
from fractions import Fraction
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import comparar  # noqa: E402
import footprint_store as fs  # noqa: E402  (solo para leer las celdas)

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"
HOUR = 3600000
EXACT = os.environ.get("AUDIT_VP_EXACT") == "1"
MONDAY = 4 * 24 * HOUR   # la semana empieza el lunes 00:00 UTC (el 05/01/1970 fue lunes)


def sstart(t, hours):
    length = hours * HOUR
    anchor = MONDAY if hours == 168 else 0
    return (int(t) - anchor) // length * length + anchor


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


_cache = {}


def shape_of(vol, a, b, rows=50):
    """Forma del perfil según la documentación: B con dos distribuciones (segundo pico con 60% del POC, a 15% del
    rango o más y un valle que baja al 60% del pico menor, sobre el perfil suavizado a 3 franjas); si no, por las colas
    fuera del área de valor: P con la cola de abajo más larga en 20% del rango o más, b con la de arriba, y D con las
    dos parecidas. AMBIGUO (no lo dice): el suavizado es la media centrada de 3 franjas (2 en los bordes), el POC del
    perfil suavizado, un pico es un máximo local y "a 15% del rango" es la distancia entre los dos picos."""
    sm = []
    for i in range(rows):
        w = vol[max(0, i - 1):min(rows, i + 2)]
        sm.append(sum(w) / len(w))
    top = max(range(rows), key=lambda i: (sm[i], -i))
    for q in range(rows):
        if q == top:
            continue
        if not ((q == 0 or sm[q] >= sm[q - 1]) and (q == rows - 1 or sm[q] >= sm[q + 1])):
            continue
        if sm[q] < 0.6 * sm[top] or abs(q - top) < 0.15 * rows:
            continue
        x, y = sorted((q, top))
        if min(sm[x:y + 1]) <= 0.6 * min(sm[q], sm[top]):
            return "B"
    lower, upper = a / rows, (rows - 1 - b) / rows
    if lower - upper >= 0.2:
        return "P"
    if upper - lower >= 0.2:
        return "b"
    return "D"


def profile(symbol, start, hours, rows=50, share=0.7):
    """POC, VAH, VAL, máximo y mínimo de la sesión [start, start + hours), con las celdas del almacén."""
    key = (symbol, start, hours)
    if key in _cache:
        return _cache[key]
    prices, volumes = fs.cells(symbol, start // 60000, (start + hours * HOUR) // 60000)
    out = None
    m = fs.minutes(symbol, start // 60000, (start + hours * HOUR) // 60000)
    covered = 0 if m is None else len(m["m"])   # "una sesión con menos del 90% de sus minutos no da niveles"
    if len(prices) and covered >= 0.9 * hours * 60:
        lo, hi = float(prices.min()), float(prices.max())
        if hi > lo:
            w = (hi - lo) / rows
            vol = [0.0] * rows
            for p, v in zip(prices.tolist(), volumes.tolist()):
                if EXACT:   # el borde exacto, con fracciones: un precio justo en el borde va a la franja de arriba
                    k = math.floor(rows * (Fraction(repr(p)) - Fraction(repr(lo))) / (Fraction(repr(hi)) - Fraction(repr(lo))))
                else:       # la misma cuenta en coma flotante del motor: el borde cae donde lo deje el redondeo
                    k = int((p - lo) / (hi - lo) * rows)
                vol[min(rows - 1, max(0, k))] += v
            poc = max(range(rows), key=lambda i: (vol[i], -i))   # la primera de más volumen
            total, got, a, b = sum(vol), vol[poc], poc, poc
            while got < share * total and (a > 0 or b < rows - 1):
                up = vol[b + 1] if b < rows - 1 else -1.0
                down = vol[a - 1] if a > 0 else -1.0
                if up >= down:
                    b += 1
                    got += vol[b]
                else:
                    a -= 1
                    got += vol[a]
            center = lambda i: lo + (i + 0.5) * w  # noqa: E731
            out = {"poc": center(poc), "vah": center(b), "val": center(a), "high": hi, "low": lo, "vol": vol, "w": w,
                   "shape": shape_of(vol, a, b, rows)}
    _cache[key] = out
    return out


def atr_of(H, L, C, n=14, kind="sma"):
    """ATR de las velas de la regla: media simple de los últimos n rangos verdaderos (la del stop en ATR, comprobada en
    la etapa 3 con stopSourceCheck), o la de Wilder."""
    tr = [H[0] - L[0]] + [max(H[i] - L[i], abs(H[i] - C[i - 1]), abs(L[i] - C[i - 1])) for i in range(1, len(C))]
    out, prev = [], None
    for i in range(len(C)):
        if kind == "sma":
            w = tr[max(0, i - n + 1):i + 1]
            out.append(sum(w) / len(w))
        else:
            prev = tr[i] if prev is None else prev + (tr[i] - prev) / n
            out.append(prev)
    return out


def close(a, b, tol=2e-5):
    return abs(a - b) <= tol * max(1.0, abs(b))


def check(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    symbol, rule = res["symbol"], res["rule"]
    vp = rule["vp"]
    hours, accept_min, fail_bars = int(vp["hours"]), int(vp["accept"]), int(vp["failBars"])
    tf_ms = rule["tf"] * 60000
    accept = max(1, round(accept_min * 60000 / tf_ms))
    code = rule["recipe"]["slots"][0]["codes"][0]
    cap = comparar.capture(symbol, rule, phase=1, base=False)
    ctx = cap["contexts"][next(c for c in cap["calls"] if c["who"] == "rule")["ctx"]]
    T, O, H, L, C = ([float(x) for x in ctx[k]] for k in ("T", "O", "H", "L", "C"))
    atr = atr_of(H, L, C, kind=os.environ.get('AUDIT_ATR', 'sma'))
    index = {int(t): i for i, t in enumerate(T)}
    length = hours * HOUR
    buf = float(rule["stop"].get("buffer") or 0.0)
    print(f"{run_id}: {code}, sesiones de {hours} h, aceptar {accept} velas, fallo en {fail_bars}; {len(res['trades'])} trades; "
          f"velas del motor {len(T)}")

    # 1) Niveles de la sesión anterior de cada trade
    bad_levels = 0
    for t in res["trades"]:
        s = int(t["vp"]["session"])
        prev = profile(symbol, s - length, hours)
        v = t["vp"]
        if prev is None:
            bad_levels += 1
            print(f"  #{t['n']}: sin perfil recalculado para la sesión {iso(s - length)}")
            continue
        diffs = [k for k in ("poc", "vah", "val", "high", "low") if not close(prev[k], float(v[k]))]
        if diffs:
            bad_levels += 1
            print(f"  ⚠ #{t['n']} sesión {iso(s - length)}: " + ", ".join(f"{k} recalculado {prev[k]:.6f} · trade {v[k]}" for k in diffs))
    print(f"  niveles: {len(res['trades']) - bad_levels} de {len(res['trades'])} trades con POC, VAH, VAL, máximo y mínimo iguales")
    shapes = [(t["n"], profile(symbol, int(t["vp"]["session"]) - length, hours), t["vp"].get("shape")) for t in res["trades"]]
    diff = [(n_, p_["shape"], s_) for n_, p_, s_ in shapes if p_ and s_ and p_["shape"] != s_]
    print(f"  forma del perfil anterior: {len(shapes) - len(diff)} de {len(shapes)} iguales" + (f"; distintas (recalculada · trade): {diff[:8]}" if diff else ""))

    # 2) Señales recalculadas en las velas del motor
    mine = {}   # índice de la vela de la señal -> (lado, zona, objetivo, sesión)
    i, n = 0, len(T)
    sessions_seen = {}
    for i in range(0, n):
        s = sstart(T[i], hours)
        prev = profile(symbol, s - length, hours)
        if prev is None:
            continue
        vah, val, poc = prev["vah"], prev["val"], prev["poc"]
        first = index.get(s)
        if first is None and sstart(T[0], hours) == s:
            first = 0   # la fase empieza a mitad de la sesión: el motor toma su primera vela como la apertura de la sesión
        if code == "VR":
            if first is None or s in sessions_seen:
                continue
            o = O[first]
            opened = 1 if o > vah else (-1 if o < val else 0)
            if opened == 0 or i - first + 1 < accept:
                continue
            run_in = all(val <= C[j] <= vah for j in range(i - accept + 1, i + 1)) and all(j >= first for j in range(i - accept + 1, i + 1))
            if run_in and not (val <= C[i - accept] <= vah and i - accept >= first):
                side = -opened
                ext = min(L[first:i + 1]) if opened < 0 else max(H[first:i + 1])
                edge = val if opened < 0 else vah
                zone = (min(ext, edge), max(ext, edge))
                target = vah if side > 0 else val
                mine[i] = (side, zone, target, s)
                sessions_seen[s] = i
        elif code == "VE":
            # Con la orden esperando: al cerrar la sesión anterior (si cerró dentro de su valor), una limit de compra en
            # el VAL y otra de venta en el VAH; la señal es la última vela de la sesión anterior
            if i == 0 or sstart(T[i - 1], hours) != s - length or not (val <= C[i - 1] <= vah):
                continue
            if vp.get("shapes") and prev["shape"] not in vp["shapes"]:
                continue
            mid = (prev["low"] + prev["high"]) / 2
            mine[(i - 1, 1)] = (1, (prev["low"], val), mid, s)
            mine[(i - 1, -1)] = (-1, (vah, prev["high"]), mid, s)
        elif code == "VF":
            # "Con el cierre anterior dentro". En la primera vela de la sesión, AUDIT_VF_FIRST=open toma si la sesión
            # abrió dentro (lo que hace el motor) y =close el cierre de la vela anterior (lo literal de la documentación)
            if i == first and os.environ.get("AUDIT_VF_FIRST", "open") == "open":
                if not (val <= O[i] <= vah):
                    continue
            elif i == 0 or not (val <= C[i - 1] <= vah):
                continue
            for side, pierced in ((-1, H[i] > vah), (1, L[i] < val)):
                if not pierced:
                    continue
                for j in range(i, min(n, i + fail_bars)):
                    if sstart(T[j], hours) != s:
                        break   # el fallo se mide en la misma sesión (ver el informe: un fallo que cruza a la sesión siguiente no cuenta con los niveles viejos)
                    if val <= C[j] <= vah:
                        if j not in mine:
                            ext = max(H[i:j + 1]) if side < 0 else min(L[i:j + 1])
                            edge = vah if side < 0 else val
                            mine[j] = (side, (min(ext, edge), max(ext, edge)), poc, s)
                        break
    print(f"  señales {code} recalculadas: {len(mine)}; la corrida dice {res.get('signals')} señales")

    # 3) Cada trade contra lo recalculado
    ok = bad = 0
    for t in res["trades"]:
        k = index.get(int(t["signal"]))
        got = mine.get((k, t["dir"])) if code == "VE" else mine.get(k)
        if got is None:
            bad += 1
            print(f"  ⚠ #{t['n']} {iso(t['signal'])}: la señal no sale recalculada")
            continue
        side, zone, target, s = got
        far = zone[0] if side > 0 else zone[1]
        want_stop = far - side * buf * atr[k]
        msgs = []
        if side != t["dir"]:
            msgs.append(f"lado {side} · trade {t['dir']}")
        if not (close(zone[0], t["zone"][0]) and close(zone[1], t["zone"][1])):
            msgs.append(f"zona {zone[0]:.6f}–{zone[1]:.6f} · trade {t['zone']}")
        if not close(want_stop, t["stop"], 1e-4):
            msgs.append(f"stop {want_stop:.6f} · trade {t['stop']}")
        if not close(target, t["target"]):
            msgs.append(f"objetivo {target:.6f} · trade {t['target']}")
        risk = abs(t["entry"] - t["stop"])
        if (t["target"] - t["entry"]) * t["dir"] < 0.3 * risk - 1e-12:
            msgs.append("objetivo a menos de 0.3 R")
        if msgs:
            bad += 1
            print(f"  ⚠ #{t['n']} {iso(t['signal'])}: " + "; ".join(msgs))
        else:
            ok += 1
    print(f"  trades: {ok} con la señal, la zona, el stop y el objetivo recalculados iguales; {bad} distintos")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for rid in sys.argv[1:]:
        check(rid)
