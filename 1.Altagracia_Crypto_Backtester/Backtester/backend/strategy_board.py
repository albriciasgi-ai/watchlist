"""
Tablero de estrategias del probador: todas las reglas que se han corrido, con su resultado por fase y por grupo de
monedas (las de siempre y las nuevas), para compararlas sin depender de la memoria de nadie.

- Una estrategia es una regla exacta, sin contar su nombre (rule_tester.rule_hash con un símbolo fijo): la misma regla
  guardada con dos nombres es una sola, y lleva los dos.
- Cada celda (fase × grupo) junta las corridas guardadas de esa regla, una por moneda (la más reciente), como el
  informe "Todas" (rule_tester.consolidated): R medio de todos los trades, el azar pesado por los trades de cada moneda
  y el tramo al azar solo si lo tienen todas las monedas con trades. Lo que da es el mismo número que ese informe.
- "Pasa" con el criterio acordado con el usuario el 19/11: la ventaja sobre los dos controles es positiva y su margen
  (1.96 errores) no toca el cero; y además la regla gana (R medio positivo): perder menos que el azar no es ganar.
  Sin el control del tramo se juzga solo contra el azar y la celda lo dice.
- Para no abrir todas las corridas en cada consulta, el resumen de cada una se guarda en cache/run_stats_v1.json la
  primera vez: una corrida guardada no cambia.
- El usuario anota en cada estrategia un estado (candidata, en prueba, descartada) y una nota (strategy_notes.json).
- Lectura automática (`analyze`) y orden (`rank`): lo que el usuario pidió que la app dijera sola, con las mismas
  comprobaciones que se hacían a mano con cada captura: si pasa cada fase, si la ventaja se achica al pasar a datos
  frescos, si depende de un lado, de una moneda o de un año, y si tiene pocos trades. "Comprobación" es todo lo que no
  se usó para elegir la regla: las fases 2 y 3, y cualquier fase de las monedas nuevas. La fase 1 de las monedas de
  siempre es exploración.
"""
import datetime as dt
import json
import math
import threading

import rule_tester as rt

STATUSES = ("", "candidata", "en prueba", "descartada")
_lock = threading.Lock()


_preparing = {"running": False, "done": 0, "total": 0}


def _stats_path():
    return rt.tester_dir() / "cache" / "run_stats_v2.json"


def _notes_path():
    return rt.tester_dir() / "strategy_notes.json"


def _read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return {}


def _write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_suffix(".tmp")
    with open(partial, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
    partial.replace(path)


def _run_stats(run_id):
    """Sumas de una corrida guardada, con sus controles. None si el archivo no está."""
    result = rt.with_leg_baseline(rt.load_run(run_id))
    if result is None:
        return None
    trades = result.get("trades") or []
    rs = [t["r"] for t in trades]
    side = lambda d: [t["r"] for t in trades if t["dir"] == d]
    control = lambda b: {"avgR": b["avgR"], "seR": b.get("seR") or 0.0} if b and b.get("n") and b.get("avgR") is not None else None
    years = {}
    for t in trades:
        year = str(dt.datetime.fromtimestamp(t["entry_t"] / 1000, dt.timezone.utc).year)
        cell = years.setdefault(year, [0, 0.0])
        cell[0] += 1
        cell[1] += t["r"]
    return {"n": len(rs), "sum": sum(rs), "sumsq": sum(r * r for r in rs), "wins": sum(1 for r in rs if r > 0), "years": years,
            "longN": len(side(1)), "longSum": sum(side(1)), "shortN": len(side(-1)), "shortSum": sum(side(-1)),
            "base": control(result.get("baseline")), "leg": control(result.get("legBaseline"))}


def _pool(items):
    """Celda de una fase y un grupo: items = [(moneda, resumen)], una corrida por moneda."""
    n = sum(s["n"] for _, s in items)
    out = {"coins": len(items), "withTrades": sum(1 for _, s in items if s["n"]), "n": n,
           "symbols": sorted(sym for sym, _ in items)}
    if not n:
        return out
    total = sum(s["sum"] for _, s in items)
    mean = total / n
    var = (sum(s["sumsq"] for _, s in items) - n * mean * mean) / (n - 1) if n > 1 else 0.0
    se = math.sqrt(max(0.0, var) / n)
    out.update(avgR=round(mean, 3), totalR=round(total, 2), seR=round(se, 4), smallSample=n < rt.SMALL_SAMPLE,
               winRate=round(100 * sum(s["wins"] for _, s in items) / n, 1),
               positive=sum(1 for _, s in items if s["n"] and s["sum"] > 0))
    years = {}
    for _, st in items:
        for year, (k, r) in (st.get("years") or {}).items():
            cell = years.setdefault(year, [0, 0.0])
            cell[0] += k
            cell[1] += r
    out["years"] = [{"year": y, "n": k, "avgR": round(r / k, 3) if k else None} for y, (k, r) in sorted(years.items())]
    best = max(items, key=lambda it: it[1]["sum"])
    out["topCoin"] = {"symbol": best[0], "totalR": round(best[1]["sum"], 2), "share": round(best[1]["sum"] / total, 3) if total > 0 else None}
    for label, key_n, key_sum in (("long", "longN", "longSum"), ("short", "shortN", "shortSum")):
        m = sum(s[key_n] for _, s in items)
        out[label] = {"n": m, "avgR": round(sum(s[key_sum] for _, s in items) / m, 3) if m else None}
    traded = [s for _, s in items if s["n"]]
    for label, key in (("edge", "base"), ("legEdge", "leg")):
        weights = [(s["n"], s[key]) for s in traded if s[key]]
        if not weights or (key == "leg" and len(weights) < len(traded)):
            continue  # Como el informe "Todas": el tramo solo vale si lo tienen todas las monedas con trades
        w = sum(k for k, _ in weights)
        ctrl = sum(k * b["avgR"] for k, b in weights) / w
        ctrl_se = math.sqrt(sum((k * b["seR"]) ** 2 for k, b in weights)) / w
        edge, edge_se = mean - ctrl, math.sqrt(se ** 2 + ctrl_se ** 2)
        out[label] = {"r": round(edge, 3), "low": round(edge - 1.96 * edge_se, 3), "high": round(edge + 1.96 * edge_se, 3),
                      "control": round(ctrl, 3)}
    checks = [out[k]["low"] > 0 for k in ("edge", "legEdge") if k in out]
    out["pass"] = bool(checks) and all(checks) and mean > 0
    out["legMissing"] = "legEdge" not in out
    return out


def _prepare(missing):
    """Resume en segundo plano las corridas que faltan. Las viejas sin el control del tramo lo reciben aquí, y eso tarda."""
    try:
        for number, run_id in enumerate(missing, 1):
            found = _run_stats(run_id)
            with _lock:
                stats = _read(_stats_path())
                stats[run_id] = found or {"missing": True}
                _write(_stats_path(), stats)
                _preparing["done"] = number
    finally:
        with _lock:
            _preparing["running"] = False


def board():
    """Todas las estrategias corridas, la más reciente primero, con su lectura y el orden. Si faltan corridas por
    resumir, las prepara en segundo plano y responde con lo que hay (`preparing`)."""
    rows = rt.history(None)
    with _lock:
        stats = _read(_stats_path())
        missing = [row["id"] for row in rows if row["id"] not in stats]
        if missing and not _preparing["running"]:
            _preparing.update(running=True, done=0, total=len(missing))
            threading.Thread(target=_prepare, args=(missing,), daemon=True).start()
        preparing = dict(_preparing) if _preparing["running"] else None
    stats = {k: v for k, v in stats.items() if not v.get("missing")}
    notes = _read(_notes_path())
    base = set(rt.base_symbols())
    strategies = {}
    for row in rows:  # En orden de corrida: la última de cada moneda queda encima
        if row["id"] not in stats or not row.get("rule"):
            continue
        key = rt.rule_hash("TODAS", row["rule"])
        item = strategies.setdefault(key, {"key": key, "names": [], "runs": 0, "cells": {}})
        name = row.get("name") or row["rule"].get("name") or "Sin nombre"
        if name not in item["names"]:
            item["names"].append(name)
        item.update(name=name, rule=row["rule"], tf=row["rule"]["tf"], lastAt=row["at"])
        item["runs"] += 1
        group = "base" if row["symbol"] in base else "new"
        item["cells"].setdefault(str(row["phase"]), {}).setdefault(group, {})[row["symbol"]] = stats[row["id"]]
    out = []
    for item in strategies.values():
        item["cells"] = {phase: {group: _pool(sorted(coins.items())) for group, coins in groups.items()}
                         for phase, groups in item["cells"].items()}
        item.update(notes.get(item["key"]) or {"status": "", "note": ""})
        item["analysis"] = analyze(item)
        out.append(item)
    out.sort(key=lambda s: -s["lastAt"])
    return {"success": True, "strategies": out, "ranking": rank(out), "baseSymbols": sorted(base), "newSymbols": rt.new_symbols(),
            "preparing": preparing}


# ==================== LECTURA ====================

GROUP_NAME = {"base": "las de siempre", "new": "las nuevas"}
WIDE_TRADES = 100   # Con menos, el margen es amplio
SIDE_R = 0.1        # Un lado "pone la ventaja" si gana esto más que el otro


def _cells(item):
    """(fase, grupo, celda, es comprobación) de las celdas con trades, en orden."""
    out = []
    for phase in sorted(item["cells"], key=int):
        for group in ("base", "new"):
            cell = item["cells"][phase].get(group)
            if cell and cell["n"]:
                out.append((int(phase), group, cell, int(phase) > 1 or group == "new"))
    return out


def _fmt(x, digits=2):
    return "—" if x is None else f"{x:+.{digits}f}"


def analyze(item):
    """Lectura de una estrategia: veredicto y puntos, cada uno con su tono (good, warn, bad, info)."""
    cells = _cells(item)
    points = []
    if not cells:
        return {"verdict": "Sin trades", "tone": "info", "points": []}
    for phase, group, cell, fresh in cells:
        edge = cell.get("edge")
        if edge is None:
            continue
        leg = cell.get("legEdge")
        text = (f"Fase {phase} en {GROUP_NAME[group]} ({cell['withTrades']} monedas): {cell['n']:,} trades, {_fmt(cell['avgR'])} R por trade; "
                f"sobre el azar {_fmt(edge['r'])} (de {_fmt(edge['low'])} a {_fmt(edge['high'])})"
                + (f", sobre el tramo {_fmt(leg['r'])} (de {_fmt(leg['low'])} a {_fmt(leg['high'])})" if leg else ", sin el control del tramo")
                + (". Pasa." if cell["pass"] else ". No pasa."))
        points.append({"tone": "good" if cell["pass"] else ("bad" if fresh else "warn"), "text": text})
    explore = next((c for p, g, c, fresh in cells if not fresh), None)
    checks = [(p, g, c) for p, g, c, fresh in cells if fresh and c.get("edge")]
    # ¿Se achica al pasar a datos frescos?
    if explore and explore.get("edge") and checks:
        first, worst = explore["edge"]["r"], min(c["edge"]["r"] for _, _, c in checks)
        if first > 0 and worst < first * 0.5:
            points.append({"tone": "warn", "text": f"La ventaja se achica en los datos frescos: {_fmt(first)} en la exploración y {_fmt(worst)} en la peor comprobación. Parte de lo de la fase 1 era suerte."})
        elif first > 0 and worst >= first * 0.8:
            points.append({"tone": "good", "text": f"La ventaja no se achica en los datos frescos: {_fmt(first)} en la exploración y al menos {_fmt(worst)} en las comprobaciones."})
    # Lado, moneda, años y tamaño, en la comprobación más grande (o en la exploración si no hay)
    focus_phase, focus_group, focus = max(checks, key=lambda x: x[2]["n"]) if checks else (cells[0][0], cells[0][1], cells[0][2])
    where = f"fase {focus_phase} en {GROUP_NAME[focus_group]}"
    long_, short = focus.get("long") or {}, focus.get("short") or {}
    if long_.get("n") and short.get("n") and long_["avgR"] is not None and short["avgR"] is not None:
        if short["avgR"] - long_["avgR"] >= SIDE_R and long_["avgR"] <= 0.05:
            points.append({"tone": "warn", "text": f"La ventaja está en los cortos ({where}): cortos {_fmt(short['avgR'])} y largos {_fmt(long_['avgR'])}. Conviene probar la regla solo con cortos."})
        elif long_["avgR"] - short["avgR"] >= SIDE_R and short["avgR"] <= 0.05:
            points.append({"tone": "warn", "text": f"La ventaja está en los largos ({where}): largos {_fmt(long_['avgR'])} y cortos {_fmt(short['avgR'])}. Conviene probar la regla solo con largos."})
        elif long_["avgR"] <= 0 and short["avgR"] <= 0:
            points.append({"tone": "bad", "text": f"Pierden los dos lados ({where}): largos {_fmt(long_['avgR'])} y cortos {_fmt(short['avgR'])}."})
        else:
            points.append({"tone": "good", "text": f"Ganan los dos lados ({where}): largos {_fmt(long_['avgR'])} y cortos {_fmt(short['avgR'])}."})
    top = focus.get("topCoin") or {}
    if top.get("share") is not None and focus["withTrades"] >= 3:
        if top["share"] >= 0.4:
            points.append({"tone": "warn", "text": f"Depende de una moneda ({where}): {top['symbol'].replace('USDT', '')} pone {top['share'] * 100:.0f}% del R total."})
        share = focus["positive"] / max(1, focus["withTrades"])
        points.append({"tone": "good" if share >= 0.7 else "warn" if share >= 0.5 else "bad",
                       "text": f"Positiva en {focus['positive']} de {focus['withTrades']} monedas ({where})."})
    bad_years = [y for y in focus.get("years") or [] if y["n"] >= 30 and (y["avgR"] or 0) <= 0]
    good_years = [y for y in focus.get("years") or [] if y["n"] >= 30]
    if good_years:
        points.append({"tone": "warn" if bad_years else "good",
                       "text": (f"Pierde en {', '.join(y['year'] for y in bad_years)} ({where})." if bad_years
                                else f"Positiva en todos los años con 30 trades o más ({where}): " + ", ".join(f"{y['year']} {_fmt(y['avgR'])}" for y in good_years) + ".")})
    if focus["n"] < WIDE_TRADES:
        points.append({"tone": "warn", "text": f"Pocos trades ({focus['n']}): el margen es amplio y unos pocos trades grandes deciden."})
    # Veredicto
    failed = [(p, g) for p, g, c in checks if not c["pass"]]
    passed = [(p, g) for p, g, c in checks if c["pass"]]
    phase3 = [c for p, g, c in checks if p == 3]
    if failed:
        p, g = failed[0]
        verdict, tone = f"Cayó en la fase {p} en {GROUP_NAME[g]}: descartar tal cual", "bad"
    elif phase3 and all(c["pass"] for c in phase3):
        verdict, tone = "Pasa todas las comprobaciones, incluida la fase 3", "good"
    elif passed:
        verdict, tone = f"Pasa {len(passed)} comprobaci{'ones' if len(passed) > 1 else 'ón'} y le falta la fase 3", "good"
    elif explore and explore["pass"]:
        verdict, tone = "Pasa la exploración; falta comprobarla (fase 2 o monedas nuevas)", "info"
    else:
        verdict, tone = "No pasa ni en la exploración", "bad"
    return {"verdict": verdict, "tone": tone, "points": points, "passed": len(passed), "failed": len(failed)}


def rank(strategies, top=5):
    """Las estrategias corridas en 2 monedas o más, las más sólidas primero: más comprobaciones pasadas, ninguna caída, y el peor margen inferior más alto.
    Cada una con la razón en una línea."""
    scored = []
    for item in strategies:
        cells = _cells(item)
        checks = [c for p, g, c, fresh in cells if fresh and c.get("edge")]
        explore = next((c for p, g, c, fresh in cells if not fresh and c.get("edge")), None)
        if not checks and not (explore and explore["pass"]):
            continue  # Sin comprobaciones, solo entra si pasa la exploración
        if max(c["withTrades"] for _, _, c, _ in cells) < 2:
            continue  # Una regla corrida en una sola moneda no entra al orden: no dice si se repite
        failed = sum(1 for c in checks if not c["pass"])
        passed = sum(1 for c in checks if c["pass"])
        lows = [min(c["edge"]["low"], (c.get("legEdge") or c["edge"])["low"]) for c in checks]
        floor = min(lows) if lows else (explore["edge"]["low"] if explore else -9)
        trades = sum(c["n"] for c in checks)
        scored.append(((0 if failed else 1, passed, floor), item, passed, failed, floor, trades))
    scored.sort(key=lambda x: x[0], reverse=True)
    out = []
    for _, item, passed, failed, floor, trades in scored[:top]:
        if failed:
            why = f"cayó en {failed} comprobaci{'ones' if failed > 1 else 'ón'}"
        elif passed:
            why = f"pasa {passed} comprobaci{'ones' if passed > 1 else 'ón'} con {trades:,} trades; en la peor, la ventaja no baja de {_fmt(floor)} R"
        else:
            why = f"solo explorada: el margen inferior de su ventaja es {_fmt(floor)} R"
        out.append({"key": item["key"], "name": item["name"], "why": why, "verdict": item["analysis"]["verdict"], "tone": item["analysis"]["tone"]})
    return out


def set_note(key, status=None, note=None):
    """Estado y nota del usuario para una estrategia."""
    if not isinstance(key, str) or not key or len(key) > 40:
        return {"success": False, "message": "Estrategia no válida"}
    with _lock:
        notes = _read(_notes_path())
        entry = notes.get(key) or {"status": "", "note": ""}
        if status is not None:
            if status not in STATUSES:
                return {"success": False, "message": "Estado no válido"}
            entry["status"] = status
        if note is not None:
            entry["note"] = str(note)[:2000]
        notes[key] = entry
        _write(_notes_path(), notes)
    return {"success": True, **entry}
