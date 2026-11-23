"""
Barrido de señales del backtesting global (23/11/2026, pedido del usuario): un mapa de qué elementos traen algo, sin
entrada, stop ni objetivo que sesguen la lectura.

Para cada elemento (y, en un segundo paso, cada pareja de los elegidos), en cada señal se mira desde la apertura de la
vela siguiente:
- las excursiones: lo máximo que el precio fue a favor y en contra en las H velas siguientes (6, 12, 24 y 48), en ATR
  de la vela de la señal. Lo que cuenta es su diferencia: el volumen de una vela movida infla las dos por igual;
- llegar a +X antes que a −X (1, 2 y 3 ATR), con la misma distancia a los dos lados: sin ventaja es 50%, sea cual sea
  la volatilidad. Las dos metas en la misma vela, o ninguna en 48 velas, no cuentan.

Todo va contra el control: lo mismo en TODAS las velas del mismo trimestre y del mismo lado, en la misma moneda. Así
la unidad (el ATR) se cancela y no se premia a un elemento por aparecer en un mes en que todo subía. El margen agrupa
las señales por semana (las de una misma semana se mueven juntas, también entre monedas), como el del motor 6.

- Solo la fase 1, y solo sus dos primeros tramos del embudo (los de rule_search): la puerta no se mira aquí.
- Se ordena por el peor de los dos tramos. Un valor negativo y parejo dice que el elemento sirve al revés (de giro).
- El umbral sube con el número de pruebas: con N elementos, ganar con margen pide repartir el 5% entre 2N lecturas.
- Sin comisiones: es un mapa para saber dónde buscar, no un resultado. Cada barrido queda anotado.

Las señales de un elemento son sus eventos tal como los arma el probador con los ajustes de fábrica (los mismos de una
regla de un solo elemento, a mercado y sin filtros): una por vela y lado.
"""
import json
import math
import threading
import time
import uuid
from statistics import NormalDist

import numpy as np

import of_elements as oe
import rule_tester as rt

HORIZONS = (6, 12, 24, 48)
DISTANCES = (1.0, 2.0, 3.0)
MAIN_X = 2.0           # La lectura principal: llegar a +2 ATR antes que a −2 ATR
MAIN_H = 24
SWEEP_TFS = (5, 15, 60, 240, 1440)
MIN_SIGNALS = 50       # Por tramo: con menos, el elemento no se juzga
PAIR_WINDOW = 3        # Velas en que tienen que coincidir los dos elementos de una pareja
DAY_MS = 86400000
SKIP_CODES = ("LIQ",)  # El barrido de liquidaciones recalcula las zonas en cada vela: va aparte

_lock = threading.Lock()
_jobs = {}


def sweep_dir():
    return rt.tester_dir() / "sweep"


def clean_config(raw):
    raw = raw or {}
    tf = int(rt._num(raw.get("tf"), 240, 5, 1440))
    tf = tf if tf in SWEEP_TFS else 240
    group = raw.get("group") if raw.get("group") in ("new", "all") else "base"
    split = str(raw.get("split") or "2023-01-01")[:10]
    split1 = str(raw.get("split1") or "2022-01-01")[:10]
    try:
        if not rt._ms(split1) + 180 * DAY_MS <= rt._ms(split) <= rt._ms(rt.CUTS[0]) - 90 * DAY_MS:
            raise ValueError
    except ValueError:
        split1, split = "2022-01-01", "2023-01-01"
    codes = [c for c in (raw.get("codes") or []) if isinstance(c, str)]
    pairs = [c for c in (raw.get("pairs") or []) if isinstance(c, str)][:12]
    return {"tf": tf, "group": group, "split1": split1, "split": split, "gapDays": int(rt._num(raw.get("gapDays"), 30, 0, 60)),
            "flow": raw.get("flow") is not False, "codes": codes, "pairs": pairs,
            "minSignals": int(rt._num(raw.get("minSignals"), MIN_SIGNALS, 20, 2000))}


def bounds(cfg):
    """Los dos tramos del embudo en que trabaja el barrido: (inicio, fin) en ms; None = el comienzo de la fase 1."""
    first, second, gap = rt._ms(cfg["split1"]), rt._ms(cfg["split"]), cfg["gapDays"] * DAY_MS
    return {"a": (None, first), "b": (first + gap, second)}


# ==================== LO QUE HIZO EL PRECIO TRAS CADA VELA ====================

def fields(ctx):
    """
    Para cada vela k, entrando en la apertura de la k+1 y visto para un largo (el corto es el espejo):
    up[h], down[h]: lo máximo arriba y abajo en las h velas siguientes, en ATR de la vela k;
    first[X]: 1 si llegó a +X ATR antes que a −X, 0 si al revés, NaN si las dos en la misma vela o ninguna en 48 velas.
    Las últimas 48 velas no tienen su ventana completa: quedan en NaN.
    """
    O, H, L, atr = (np.asarray(ctx[key], dtype=float) for key in ("O", "H", "L", "atr"))
    n = len(O)
    reach = max(HORIZONS)
    out = {"up": {}, "down": {}, "first": {}, "n": n}
    last = n - 1 - reach  # Última vela con su ventana completa
    if last < 0:
        for h in HORIZONS:
            out["up"][h] = out["down"][h] = np.full(n, np.nan)
        for x in DISTANCES:
            out["first"][x] = np.full(n, np.nan)
        return out
    ks = np.arange(last + 1)
    entry = O[ks + 1]
    unit = np.where(atr[ks] > 0, atr[ks], np.nan)
    run_max = np.full(last + 1, -np.inf)
    run_min = np.full(last + 1, np.inf)
    state = {x: np.zeros(last + 1, dtype=np.int8) for x in DISTANCES}  # 0 sin resolver, 1 arriba, -1 abajo, 2 las dos
    pad = np.full(n - last - 1, np.nan)
    for d in range(1, reach + 1):
        high, low = H[ks + d], L[ks + d]
        run_max = np.maximum(run_max, high)
        run_min = np.minimum(run_min, low)
        for x in DISTANCES:
            open_ = state[x] == 0
            hit_up = open_ & (high >= entry + x * unit)
            hit_down = open_ & (low <= entry - x * unit)
            state[x][hit_up & hit_down] = 2
            state[x][hit_up & ~hit_down] = 1
            state[x][hit_down & ~hit_up] = -1
        if d in HORIZONS:
            out["up"][d] = np.concatenate(((run_max - entry) / unit, pad))
            out["down"][d] = np.concatenate(((entry - run_min) / unit, pad))
    for x in DISTANCES:
        first = np.where(state[x] == 1, 1.0, np.where(state[x] == -1, 0.0, np.nan))
        first[~np.isfinite(unit)] = np.nan
        out["first"][x] = np.concatenate((first, pad))
    return out


def quarter_index(times):
    """Trimestre de cada vela como número (año × 4 + trimestre), para promediar el control por trimestre."""
    days = np.asarray(times, dtype="datetime64[ms]")
    years = days.astype("datetime64[Y]").astype(int) + 1970
    months = days.astype("datetime64[M]").astype(int) % 12
    return years * 4 + months // 3


def centered(values, quarters, usable):
    """Cada valor menos el promedio de su trimestre (entre las velas `usable`): lo que queda es lo que la vela hizo de
    más o de menos que una vela cualquiera de ese trimestre. Para un corto basta cambiarle el signo."""
    out = np.full(len(values), np.nan)
    ok = usable & np.isfinite(values)
    for q in np.unique(quarters[ok]):
        pick = ok & (quarters == q)
        out[pick] = values[pick] - values[pick].mean()
    return out


# ==================== SEÑALES ====================

def available_codes(symbol, tf, flow=True):
    """Los elementos que se pueden barrer en esa moneda y marco, en el orden del catálogo."""
    allowed = rt.codes_for(symbol, tf)
    candle = [c for c in rt.CANDLE_CODES if c not in SKIP_CODES]
    if allowed is not None:
        return [c for c in candle if c in allowed]
    of_codes = [c for c in oe.CATALOG if c not in candle and c not in SKIP_CODES] if flow else []
    return of_codes + candle


def element_signals(symbol, tf, span, ctx, codes):
    """Por elemento: {(vela, lado)} de sus señales, en la vela que las da a conocer. Los eventos son los del probador con
    los ajustes de fábrica; un elemento sin lado (la compresión) no entra."""
    tf_ms = tf * 60000
    index = {t: i for i, t in enumerate(ctx["T"])}
    lead = ctx.get("lead", 0)
    out = {}
    from_store = {}
    for e in span.get("events") or []:
        from_store.setdefault(e["code"], []).append(e)
    for code in codes:
        if code in from_store or code in oe.CATALOG and code not in rt.CANDLE_CODES:
            events = from_store.get(code, [])
        else:
            rule = rt.clean_rule({"tf": tf, "recipe": {"slots": [{"codes": [code]}]}})
            if rule is None:
                continue
            events = [e for e in rt._extra_events(symbol, rule, span, ctx) if e["code"] == code]
        found = set()
        for e in events:
            k = index.get(e["known"] - tf_ms)
            if k is not None and k >= lead and e["dir"] in (1, -1):
                found.add((k, int(e["dir"])))
        # Una vela con la señal hacia los dos lados no dice una dirección (la compresión): no entra
        out[code] = {(k, side) for k, side in found if (k, -side) not in found}
    return out


def pair_signals(first, second, window=PAIR_WINDOW):
    """Las dos señales del mismo lado dentro de `window` velas: la señal de la pareja es la vela de la que llega después."""
    out = set()
    for a, b in ((first, second), (second, first)):
        by_side = {1: set(), -1: set()}
        for k, side in a:
            by_side[side].add(k)
        for k, side in b:
            if any((k - d) in by_side[side] for d in range(window)):
                out.add((k, side))
    return out


# ==================== MEDIDA ====================

def _stat(values, weeks):
    """Promedio de los valores con su error agrupado por semana y su t. None sin datos."""
    n = len(values)
    if n < 2:
        return None
    mean = float(np.mean(values))
    iid = float(np.std(values, ddof=1) / math.sqrt(n))
    groups = {}
    for v, w in zip(values, weeks):
        cell = groups.setdefault(int(w), [0, 0.0])
        cell[0] += 1
        cell[1] += float(v)
    se = rt.clustered_se(groups, mean, n, iid)
    return {"n": n, "mean": round(mean, 4), "se": round(se, 4), "t": round(mean / se, 2) if se > 0 else 0.0}


class Collector:
    """Junta, por prueba y tramo, lo que hizo el precio tras cada señal en todas las monedas."""

    def __init__(self, cfg):
        self.cfg = cfg
        self.bounds = bounds(cfg)
        self.rows = {}   # prueba → tramo → listas
        self.coins = {}  # prueba → monedas con señales

    def add_coin(self, symbol, ctx, signals):
        """signals: {prueba: {(vela, lado)}}. Calcula una vez los campos de la moneda y reparte."""
        T = np.asarray(ctx["T"], dtype=np.int64)
        tf_ms = ctx["tf"] * 60000
        lead = ctx.get("lead", 0)
        f = fields(ctx)
        reach = max(HORIZONS)
        usable = np.zeros(len(T), dtype=bool)
        usable[lead:max(lead, len(T) - reach)] = True
        quarters = quarter_index(T)
        asym = {h: centered(f["up"][h] - f["down"][h], quarters, usable) for h in HORIZONS}
        first = {x: centered(f["first"][x], quarters, usable) for x in DISTANCES}
        weeks = T // rt.WEEK_MS
        # El final de la ventana de cada vela: tiene que caer dentro de su tramo
        end = np.empty(len(T), dtype=np.int64)
        end[:len(T) - reach] = T[reach:] + tf_ms
        end[len(T) - reach:] = np.iinfo(np.int64).max
        for test, found in signals.items():
            if not found:
                continue
            ks = np.array([k for k, _ in found], dtype=np.int64)
            sides = np.array([s for _, s in found], dtype=float)
            for name, (start, stop) in self.bounds.items():
                pick = usable[ks] & (end[ks] < stop) & ((T[ks] >= start) if start is not None else True)
                if not pick.any():
                    continue
                k, s = ks[pick], sides[pick]
                cell = self.rows.setdefault(test, {}).setdefault(name, {"weeks": [], "side": [], "asym": {h: [] for h in HORIZONS},
                                                                         "first": {x: [] for x in DISTANCES}, "raw": {x: [] for x in DISTANCES},
                                                                         "mfe": {h: [] for h in HORIZONS}, "mae": {h: [] for h in HORIZONS}})
                cell["weeks"].append(weeks[k])
                cell["side"].append(s)
                for h in HORIZONS:
                    cell["asym"][h].append(s * asym[h][k])
                    up, down = f["up"][h][k], f["down"][h][k]
                    cell["mfe"][h].append(np.where(s > 0, up, down))
                    cell["mae"][h].append(np.where(s > 0, down, up))
                for x in DISTANCES:
                    cell["first"][x].append(s * first[x][k])
                    raw = f["first"][x][k]
                    cell["raw"][x].append(np.where(s > 0, raw, 1.0 - raw))
                self.coins.setdefault(test, set()).add(symbol)

    def result(self, tests):
        """La tabla: por prueba, cada tramo y los dos juntos, con la nota (el t del peor tramo de la lectura principal)."""
        rows = []
        for test in tests:
            data = self.rows.get(test["key"]) or {}
            row = {**test, "coins": len(self.coins.get(test["key"], ())), "parts": {}}
            merged = {}
            for name in list(self.bounds) + ["both"]:
                cells = [data[part] for part in self.bounds if part in data] if name == "both" else ([data[name]] if name in data else [])
                if not cells:
                    row["parts"][name] = {"n": 0}
                    continue
                weeks = np.concatenate([w for c in cells for w in c["weeks"]])
                part = {"n": int(len(weeks)), "longs": round(float(np.mean(np.concatenate([s for c in cells for s in c["side"]]) > 0)), 3),
                        "asym": {}, "first": {}, "mfe": {}, "mae": {}}
                for h in HORIZONS:
                    values = np.concatenate([v for c in cells for v in c["asym"][h]])
                    ok = np.isfinite(values)
                    part["asym"][h] = _stat(values[ok], weeks[ok])
                    part["mfe"][h] = round(float(np.nanmean(np.concatenate([v for c in cells for v in c["mfe"][h]]))), 3)
                    part["mae"][h] = round(float(np.nanmean(np.concatenate([v for c in cells for v in c["mae"][h]]))), 3)
                for x in DISTANCES:
                    values = np.concatenate([v for c in cells for v in c["first"][x]])
                    raw = np.concatenate([v for c in cells for v in c["raw"][x]])
                    ok = np.isfinite(values)
                    stat = _stat(values[ok], weeks[ok])
                    if stat:
                        # En puntos: la tasa de las señales, y cuánto queda sobre las velas de su trimestre y lado
                        stat = {**stat, "mean": round(stat["mean"] * 100, 2), "se": round(stat["se"] * 100, 2),
                                "rate": round(float(np.mean(raw[ok])) * 100, 1)}
                    part["first"][x] = stat
                row["parts"][name] = part
                merged[name] = part
            ts = [(merged[name]["first"][MAIN_X] or {}).get("t") if name in merged and merged[name]["n"] >= self.cfg["minSignals"] else None
                  for name in self.bounds]
            row["judged"] = all(t is not None for t in ts)
            # La nota: el t del peor tramo. Si los dos tramos van en sentidos contrarios, cero
            if row["judged"]:
                row["score"] = 0.0 if min(ts) < 0 < max(ts) else (min(ts) if min(ts) > 0 else max(ts))
            else:
                row["score"] = None
            rows.append(row)
        judged = [r for r in rows if r["judged"]]
        count = len(judged)
        need = gate(count)
        for r in rows:
            r["clear"] = bool(r["judged"] and need is not None and abs(r["score"]) >= need)
        rows.sort(key=lambda r: (r["score"] is None, -abs(r["score"] or 0)))
        # Lo primero que hay que leer: el reparto de todas las pruebas contra lo que da el azar. Con los dos tramos
        # juntos, sin ventaja en ninguna, el 4.6% pasa de ±2 errores
        pooled = [(r["parts"]["both"].get("first") or {}).get(MAIN_X) for r in judged]
        ts = [p["t"] for p in pooled if p]
        return {"rows": rows, "tests": count, "need": round(need, 2) if need else None, "scores": ts,
                "beyond2": sum(1 for t in ts if abs(t) >= 2), "expected2": round(len(ts) * 0.0455, 1),
                "clear": sum(1 for r in rows if r["clear"])}


def gate(count):
    """El t que tiene que pasar la nota (el peor de dos tramos, en el mismo sentido) para no ser suerte entre `count`
    pruebas. Sin ventaja, los dos tramos pasan de z a la vez con probabilidad (1 − Φ(z))² por sentido: se reparte el 5%
    entre las `count` pruebas y sus dos sentidos. Con 49 pruebas son 2.0 errores en cada tramo; con una sola, 1.3."""
    if not count:
        return None
    return NormalDist().inv_cdf(1 - math.sqrt(0.05 / (2 * count)))


# ==================== CORRIDA ====================

def run(cfg, progress=None):
    """El barrido de un marco en un grupo de monedas. Devuelve la tabla y con qué se hizo."""
    tf = cfg["tf"]
    collector = Collector(cfg)
    symbols = [s for s in rt.candle_symbols(cfg["group"])]
    seen, used, skipped = [], [], []
    for number, symbol in enumerate(symbols, 1):
        phase = next((p for p in rt.phases(symbol) if p["phase"] == 1), None)
        if phase is None or not phase["available"] or (rt._on_candles(symbol, tf) and not rt.has_candles(symbol, tf)):
            skipped.append(symbol)
            continue
        if progress:
            progress(f"{symbol} ({number} de {len(symbols)})", number - 1, len(symbols))
        codes = available_codes(symbol, tf, cfg["flow"])
        if cfg["codes"]:
            codes = [c for c in codes if c in cfg["codes"]]
        codes = [c for c in codes if not cfg["pairs"] or c in cfg["pairs"]]
        base_rule = rt.clean_rule({"tf": tf, "recipe": {"slots": [{"codes": [codes[0]]}]}}) if codes else None
        if base_rule is None:
            skipped.append(symbol)
            continue
        span = rt._warmed(symbol, tf, phase, base_rule, rt.detect_span(symbol, tf, phase, base_rule))
        if len(span["bars"]) - span["lead"] < 200:
            skipped.append(symbol)
            continue
        ctx = rt._context(symbol, tf, span["bars"])
        ctx["bars"], ctx["lead"] = span["bars"], span["lead"]
        single = element_signals(symbol, tf, span, ctx, codes)
        if cfg["pairs"]:
            signals = {}
            for i, a in enumerate(cfg["pairs"]):
                for b in cfg["pairs"][i + 1:]:
                    if a in single and b in single:
                        signals[f"{a}+{b}"] = pair_signals(single[a], single[b])
        else:
            signals = single
        collector.add_coin(symbol, ctx, signals)
        used.append(symbol)
        for key in signals:
            if key not in seen:
                seen.append(key)
    tests = [{"key": key, "codes": key.split("+")} for key in seen]
    out = collector.result(tests)
    out.update({"config": cfg, "symbols": used, "skipped": skipped, "horizons": list(HORIZONS), "distances": list(DISTANCES),
                "mainX": MAIN_X, "mainH": MAIN_H, "pairWindow": PAIR_WINDOW, "names": {c: oe.CATALOG[c][0] for c in oe.CATALOG}})
    return out


def _save(result):
    path = sweep_dir() / f"{result['id']}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    with open(partial, "w", encoding="utf-8") as fh:
        json.dump(result, fh, allow_nan=False, separators=(",", ":"), default=str)
    partial.replace(path)
    with open(sweep_dir() / "sweeps.jsonl", "a", encoding="utf-8") as fh:
        fh.write(json.dumps({"id": result["id"], "at": result["at"], "tf": result["config"]["tf"], "group": result["config"]["group"],
                             "pairs": bool(result["config"]["pairs"]), "tests": result["tests"], "clear": result["clear"]}) + "\n")


def history():
    """Los barridos hechos, del más nuevo al más viejo, y cuántas pruebas suman."""
    path = sweep_dir() / "sweeps.jsonl"
    rows = []
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            try:
                rows.append(json.loads(line))
            except ValueError:
                continue
    return {"sweeps": rows[::-1], "tests": sum(r.get("tests") or 0 for r in rows)}


def load(sweep_id):
    path = sweep_dir() / f"{sweep_id}.json"
    if not path.exists():
        return None
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def start(raw_config=None):
    cfg = clean_config(raw_config)
    with _lock:
        busy = next((j for j in _jobs.values() if j["state"] == "running"), None)
    if busy is not None:
        return {"success": True, "job": busy["id"], "already": True}
    job = {"id": uuid.uuid4().hex[:12], "state": "running", "stage": "Empezando", "done": 0, "total": 1, "error": None, "sweep": None}
    with _lock:
        _jobs[job["id"]] = job

    def work():
        try:
            result = run(cfg, lambda text, done, total: job.update(stage=text, done=done, total=total))
            result["id"] = time.strftime("%Y%m%d_%H%M%S") + "_" + uuid.uuid4().hex[:4]
            result["at"] = int(time.time() * 1000)
            result["testsBefore"] = history()["tests"]
            _save(result)
            job.update(state="done", sweep=result["id"])
        except Exception as error:  # El hilo no deja el trabajo colgado
            job.update(state="error", error=f"{type(error).__name__}: {error}")

    threading.Thread(target=work, daemon=True).start()
    return {"success": True, "job": job["id"]}


def job_status(job_id):
    with _lock:
        job = _jobs.get(job_id)
    return dict(job) if job else None
