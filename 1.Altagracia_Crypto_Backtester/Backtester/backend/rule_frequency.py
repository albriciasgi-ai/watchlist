"""
Informes de frecuencia del probador (23/11/2026, pedido del usuario tras el análisis de LuxAlgo Quant).

Una pregunta sin entrada ni salida: "cuando aparece la señal de esta regla, ¿cuántas veces el precio hace X en las N
velas siguientes?". Solo cuenta. Da la tasa con su muestra y su intervalo del 95%, por año, contando solo señales
separadas (sin ventanas que se pisen) y contra la tasa de una vela cualquiera del mismo lado.

- La señal es la de la regla: sus elementos, su receta y sus filtros (líneas, flujo, régimen, horario, medidas...), con
  el mismo código del probador (rule_tester.run con `trace`). La entrada, el stop y la salida de la regla no cuentan.
- Solo en la fase 1: un informe de frecuencia también es una mirada a los datos, y las fases 2 y 3 son para comprobar.
- Cada informe queda anotado en tester/frequency.jsonl: cuántas preguntas se hicieron es parte de la respuesta.
- Mide desde la apertura de la vela siguiente a la que da a conocer la señal, en ATR de la vela de la señal. Sin
  comisiones: no es un trade.
"""
import json
import math
import time
from datetime import datetime, timezone

import numpy as np

import measures
import rule_tester

KINDS = ("reach", "first", "close")
MAX_BARS = 300
SMALL = 30
# Lo que el probador anota de una señal que pasó todos sus filtros (lo demás es el motivo por el que no pasó)
PASSED = ("trade", "abierta al final de la fase", "posición abierta", "sin vela siguiente")


def clean_question(raw):
    """La pregunta, acotada. kind: reach (llega a `a` ATR a favor en `bars` velas), first (llega a `a` ATR a favor antes
    que a `b` ATR en contra, en `bars` velas) o close (a las `bars` velas cierra más de `a` ATR a favor; `a` 0 = a favor)."""
    raw = raw or {}
    kind = raw.get("kind") if raw.get("kind") in KINDS else "reach"
    low = 0.0 if kind == "close" else 0.05
    return {"kind": kind, "bars": int(rule_tester._num(raw.get("bars"), 10, 1, MAX_BARS)),
            "a": rule_tester._num(raw.get("a"), 0.0 if kind == "close" else 1.0, low, 50.0),
            "b": rule_tester._num(raw.get("b"), 1.0, 0.05, 50.0)}


def question_text(q):
    bars = f"{q['bars']} vela{'s' if q['bars'] != 1 else ''}"
    if q["kind"] == "reach":
        return f"llega a {q['a']:g} ATR a favor en las {bars} siguientes"
    if q["kind"] == "first":
        return f"llega a {q['a']:g} ATR a favor antes que a {q['b']:g} ATR en contra, en las {bars} siguientes"
    return f"a las {bars} cierra a favor" + (f" por más de {q['a']:g} ATR" if q["a"] > 0 else "")


def outcomes(ctx, ks, side, q):
    """Para cada vela de señal de `ks` (todas del lado `side`): si pasó lo que pregunta `q`, y si quedó dudoso (solo en
    `first`: las dos metas en la misma vela; se cuenta como que no, y se dice cuántas fueron)."""
    O, H, L, C, atr = (np.asarray(ctx[key], dtype=float) for key in ("O", "H", "L", "C", "atr"))
    ks = np.asarray(ks, dtype=np.int64)
    entry = O[ks + 1]
    unit = atr[ks]
    hit = np.zeros(len(ks), dtype=bool)
    doubt = np.zeros(len(ks), dtype=bool)
    if q["kind"] == "close":
        return side * (C[ks + q["bars"]] - entry) > q["a"] * unit, doubt
    goal = entry + side * q["a"] * unit
    wall = entry - side * q["b"] * unit
    dead = np.zeros(len(ks), dtype=bool)
    for d in range(1, q["bars"] + 1):
        j = ks + d
        favor = H[j] >= goal if side > 0 else L[j] <= goal
        if q["kind"] == "reach":
            hit |= favor
            continue
        against = L[j] <= wall if side > 0 else H[j] >= wall
        live = ~hit & ~dead
        both = live & favor & against
        doubt |= both
        dead |= both | (live & against)
        hit |= live & favor & ~against
    return hit, doubt


def _rate(hits, n):
    return round(100.0 * hits / n, 2) if n else None


def _count(hits, n):
    low, high = rule_tester._wilson(hits, n) if n else (None, None)
    return {"n": int(n), "hits": int(hits), "rate": _rate(hits, n), "low": low, "high": high}


def _separated(ks, hit, gap):
    """Las señales que no se pisan: tras contar una, las de las `gap` velas siguientes no cuentan."""
    order = np.argsort(ks, kind="stable")
    last, keep = -10 ** 9, []
    for i in order:
        if ks[i] - last > gap:
            keep.append(i)
            last = ks[i]
    keep = np.asarray(keep, dtype=np.int64)
    return (int(hit[keep].sum()), len(keep)) if len(keep) else (0, 0)


def _signal_rule(rule):
    """La regla solo como señal: a mercado, todas las señales (sin esperar a que cierre un trade), una vela de vida y sin
    tope de comisión. Así el probador dice qué señales pasan sus filtros sin que la entrada, el stop o la salida quiten
    ninguna."""
    out = {key: value for key, value in rule.items() if key not in ("targetAt",)}
    out.update({
        "oneAtATime": False, "cooldown": 0, "maxFeeR": 0.0,
        "entry": {"type": "market", "at": "near", "expiry": 8},
        "stop": {"type": "atr", "bars": 5, "atr": 20.0, "buffer": 0.0, "minAtr": 0.0, "maxAtr": 100.0},
        "exit": {"targetR": None, "trail": "none", "trailBars": 5, "horizon": 1, "opposite": False},
    })
    if out.get("gc"):
        out["gc"] = {**out["gc"], "exit": "none"}
    return out


def measure(ctx, signals, q):
    """signals: [(vela, lado)] ya filtradas. Devuelve el informe (sin la moneda ni la regla): se prueba sin almacén."""
    n_bars, lead = len(ctx["T"]), ctx.get("lead", 0)
    last = n_bars - 1 - q["bars"]  # Última vela de señal con sus `bars` velas siguientes dentro de la fase
    seen, kept, unfinished = set(), [], 0
    for k, side in signals:
        if (k, side) in seen:
            continue
        seen.add((k, side))
        if k > last:
            unfinished += 1
        elif k >= lead and side in (1, -1):
            kept.append((k, side))
    parts, doubts = {}, 0
    for side in (1, -1):
        ks = np.array([k for k, s in kept if s == side], dtype=np.int64)
        if len(ks):
            hit, doubt = outcomes(ctx, ks, side, q)
            parts[side] = (ks, hit)
            doubts += int(doubt.sum())
    total = sum(len(ks) for ks, _ in parts.values())
    hits = sum(int(hit.sum()) for _, hit in parts.values())
    sep_hits, sep_n = 0, 0
    for ks, hit in parts.values():
        h, n = _separated(ks, hit, q["bars"])
        sep_hits, sep_n = sep_hits + h, sep_n + n

    by_year = {}
    for ks, hit in parts.values():
        for k, ok in zip(ks, hit):
            year = datetime.fromtimestamp(ctx["T"][k] / 1000, tz=timezone.utc).year
            row = by_year.setdefault(year, [0, 0])
            row[0] += int(ok)
            row[1] += 1
    sides = [{"side": "largos" if side > 0 else "cortos", **_count(int(hit.sum()), len(ks))} for side, (ks, hit) in sorted(parts.items(), reverse=True)]

    # La tasa de una vela cualquiera: todas las velas donde la regla podría dar señal (régimen y horario), de cada lado,
    # pesadas por la parte de largos y cortos de las señales
    allowed = rule_tester._allowed(ctx, n_bars)
    pool = np.arange(max(30, lead), last + 1) if allowed is None else allowed[allowed <= last]
    base, base_n = None, int(len(pool))
    if total and base_n:
        base = 0.0
        for side, (ks, _) in parts.items():
            base_hit, _ = outcomes(ctx, pool, side, q)
            base += (len(ks) / total) * float(base_hit.mean())
        base = round(100.0 * base, 2)

    rate = _rate(hits, total)
    sep_rate = _rate(sep_hits, sep_n)
    edge = None
    if base is not None and sep_n:
        p = sep_hits / sep_n
        margin = 196.0 * math.sqrt(max(p * (1 - p), 1e-9) / sep_n)
        diff = round(sep_rate - base, 2)
        edge = {"diff": diff, "margin": round(margin, 2), "clear": bool(sep_n >= SMALL and abs(diff) > margin)}
    return {
        "question": q, "text": question_text(q),
        "all": _count(hits, total),
        "separated": _count(sep_hits, sep_n),
        "sides": sides,
        "years": [{"year": year, **_count(row[0], row[1])} for year, row in sorted(by_year.items())],
        "base": {"rate": base, "n": base_n},
        "edge": edge,
        "doubts": doubts, "unfinished": unfinished,
        "small": sep_n < SMALL,
    }


def signals_of(symbol, rule, span, phase, table=None):
    """Las señales de la regla que pasan sus filtros: (contexto de las velas, [(vela, lado)], resultado del probador).
    El lado ya es el del trade (con la regla invertida, el contrario al elemento)."""
    trace = {}
    result = rule_tester.run(symbol, _signal_rule(rule), span, phase, table, base=False, trace=trace)
    if not result.get("success"):
        return None, [], result
    signals = [(s["k"], s["dir"]) for s in trace.get("signals", []) if s.get("what") in PASSED]
    return trace["ctx"], signals, result


def _log_path():
    return rule_tester.tester_dir() / "frequency.jsonl"


def asked(symbol=None):
    """Los informes de frecuencia ya pedidos (de una moneda o de todas), del más viejo al más nuevo."""
    path = _log_path()
    if not path.exists():
        return []
    rows = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            row = json.loads(line)
        except ValueError:
            continue
        if symbol is None or row.get("symbol") == symbol:
            rows.append(row)
    return rows


def report(symbol, raw_rule, raw_question):
    """El informe de frecuencia de la señal de una regla, en la fase 1 de una moneda."""
    rule = rule_tester.clean_rule(raw_rule)
    if rule is None:
        return {"success": False, "message": "La regla no tiene elementos conocidos"}
    phase = next((p for p in rule_tester.phases(symbol) if p["phase"] == 1), None)
    if phase is None or not phase["available"]:
        return {"success": False, "message": "No hay datos de la fase 1 para este símbolo"}
    allowed = rule_tester.codes_for(symbol, rule["tf"])
    if allowed is not None:
        codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
        if codes - allowed:
            return {"success": False, "message": f"Aquí solo se pueden usar {rule_tester._labels(sorted(allowed))}"}
    q = clean_question(raw_question)
    span = rule_tester.detect_span(symbol, rule["tf"], phase, rule)
    table = measures.table_for(symbol) if rule["filters"] else None
    ctx, signals, result = signals_of(symbol, rule, span, phase, table)
    if ctx is None:
        return {"success": False, "message": result.get("message") or "No se pudo leer la señal"}
    out = measure(ctx, signals, q)
    digest = rule_tester.rule_hash(symbol, rule)
    out.update({"success": True, "symbol": symbol, "tf": rule["tf"], "phase": 1, "hash": digest,
                "from": phase.get("from"), "to": phase.get("to"), "skipped": result.get("skipped") or {}})
    previous = asked(symbol)
    key = (digest, json.dumps(q, sort_keys=True))
    out["askedBefore"] = len({(r.get("hash"), json.dumps(r.get("question"), sort_keys=True)) for r in previous} | {key})
    out["askedThisSignal"] = len({json.dumps(r.get("question"), sort_keys=True) for r in previous if r.get("hash") == digest} | {key[1]})
    try:
        path = _log_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps({"at": int(time.time() * 1000), "symbol": symbol, "tf": rule["tf"], "hash": digest, "name": rule.get("name"),
                                     "question": q, "n": out["all"]["n"], "rate": out["all"]["rate"], "sepN": out["separated"]["n"],
                                     "sepRate": out["separated"]["rate"], "base": out["base"]["rate"]}, ensure_ascii=False) + "\n")
    except OSError:
        pass  # Sin disco el informe sale igual; solo no queda anotado
    return out
