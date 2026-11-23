"""
Protocolo (22/11/2026), etapa 6, sección 9.9: las confusiones de la hoja "Confusiones" del Excel de chequeo que se
pueden probar con el motor (sin la pantalla), cada una con la prueba que dice la hoja o una equivalente. Las de la
pantalla se recorren en la página aislada.

Uso (desde backend/): python -B tests/audit/confusiones.py [--solo 3,5,7]
Escribe evidencia/etapa6/confusiones_motor.json y una línea por confusión.
"""
import argparse
import collections
import copy
import datetime as dt
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import of_setups as os_  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6")
CHECKS = {}


def check(n):
    def deco(fn):
        CHECKS[n] = fn
        return fn
    return deco


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def phase(symbol, n=1):
    return next(p for p in rt.phases(symbol) if p["phase"] == n)


def go(symbol, raw, n=1, base=False, trace=False):
    """La regla limpia, su tramo y su corrida (con la traza si se pide)."""
    rule = rt.clean_rule(copy.deepcopy(raw))
    ph = phase(symbol, n)
    span = rt.detect_span(symbol, rule["tf"], ph, rule)
    table = measures.table_for(symbol) if rule.get("filters") else None
    tr = {} if trace else None
    res = rt.run(symbol, rule, span, ph, table, base=base, trace=tr)
    return rule, span, res, tr


def reasons(res):
    return dict(collections.Counter(t["reason"] for t in res["trades"]))


@check(3)
def c03():
    """La secuencia da una vela menos: con ventana N el gatillo llega a lo sumo N − 1 velas después del contexto."""
    out = {}
    for window in (1, 2, 3):
        for same in (False, True):
            raw = copy.deepcopy(rp.RULES["R15c"])
            raw["recipe"]["window"], raw["recipe"]["sameBar"] = window, same
            raw["oneAtATime"] = False
            rule, span, res, tr = go("BTCUSDT", raw, trace=True)
            ms = os_.match_recipes(span["bars"], tr["events"], [rule["recipe"]], rule["tf"])
            tf_ms = rule["tf"] * 60000
            dist = collections.Counter()
            for m in ms:
                ctx = [t for c, t in m["votes"] if c == "BX"]
                trg = [t for c, t in m["votes"] if c == "FV"]
                if ctx and trg:
                    dist[(max(trg) - min(ctx)) // tf_ms] += 1
            out[f"ventana {window}{' · misma vela' if same else ''}"] = {"señales": len(ms), "velas del contexto al gatillo": dict(sorted(dist.items()))}
    w2 = out["ventana 2"]["velas del contexto al gatillo"]
    ok = bool(w2) and max(w2) <= 1
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa",
            "nota": "con ventana 2 el gatillo llega a lo sumo 1 vela después del contexto" if ok else "llega a 2 velas o más"}


@check(5)
def c05():
    """'Solo alcistas' con 'Invertir' da cortos."""
    raw = copy.deepcopy(rp.RULES["R15e"])
    raw["invert"] = True
    rule, span, res, _ = go("BTCUSDT", raw)
    dirs = collections.Counter(t["dir"] for t in res["trades"])
    stops_above = sum(1 for t in res["trades"] if t["dir"] < 0 and t["stop"] > t["entry"])
    ok = dirs and set(dirs) == {-1}
    return {"resultado": {"lados": dict(dirs), "cortos con el stop sobre la entrada": stops_above},
            "veredicto": "confirmada" if ok else "no pasa"}


@check(6)
def c06():
    """Con dos órdenes stop, 'Lado' no fija la dirección: 'Solo alcistas' da cortos."""
    raw = copy.deepcopy(rp.RULES["E-CP"])
    raw["recipe"]["side"] = "long"
    rule, span, res, _ = go("BTCUSDT", raw)
    dirs = collections.Counter(t["dir"] for t in res["trades"])
    return {"resultado": {"lados": dict(dirs)}, "veredicto": "confirmada" if dirs.get(-1) else "no pasa"}


@check(7)
def c07():
    """La señal contraria con un solo lado nunca ocurre, y con solo esa salida la regla cierra a las 96 velas."""
    out = {}
    for side in ("both", "long"):
        raw = copy.deepcopy(rp.RULES["R08g"])
        raw["recipe"]["side"] = side
        rule, span, res, _ = go("BTCUSDT", raw)
        out[side] = {"salidas": reasons(res), "horizonte": rule["exit"]["horizon"]}
    ok = "señal contraria" not in out["long"]["salidas"] and out["long"]["horizonte"] == rt.DEFAULT_HORIZON
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa"}


@check(8)
def c08():
    """Un patrón por vela: ninguna vela es dos patrones a la vez (doji, después envolvente, después martillo)."""
    raw = rp.rule("conf8", 240, rp.recipe("HM", "EN", "DJ", mode="threshold", minimum=1))
    rule, span, res, tr = go("BTCUSDT", raw, trace=True)
    by_bar = collections.defaultdict(set)
    for e in tr["events"]:
        if e["code"] in ("HM", "EN", "DJ"):
            by_bar[(e["t"], e["dir"])].add(e["code"])
    both = [k for k, v in by_bar.items() if len(v) > 1]
    counts = collections.Counter(e["code"] for e in tr["events"] if e["code"] in ("HM", "EN", "DJ"))
    return {"resultado": {"eventos": dict(counts), "velas con dos patrones": len(both)},
            "veredicto": "confirmada" if not both else "no pasa",
            "nota": "en los eventos ninguna vela trae dos patrones; que un martillo envolvente quede como envolvente se ve en pantalla"}


@check(10)
def c10():
    """La ruptura de caja sin cerrar fuera: el cierre de la vela de la señal dentro de la caja."""
    raw = copy.deepcopy(rp.RULES["E-BX"])
    raw["oneAtATime"] = False
    rule, span, res, tr = go("BTCUSDT", raw, trace=True)
    bars = {b["t"]: b for b in span["bars"]}
    inside, total, side_by_center = 0, 0, 0
    examples = []
    for e in tr["events"]:
        if e["code"] != "BX":
            continue
        b = bars.get(e["t"])
        if b is None:
            continue
        total += 1
        lo, hi = e["info"]["low"], e["info"]["high"]
        if lo <= b["c"] <= hi:
            inside += 1
            if len(examples) < 5:
                examples.append(f"{iso(e['t'])} {'↑' if e['dir'] > 0 else '↓'} cierre {b['c']} en la caja {lo}–{hi}")
        center = (lo + hi) / 2
        side_by_center += (1 if b["c"] > center else -1) == e["dir"]
    return {"resultado": {"rupturas": total, "cierran dentro de la caja": inside, "lado = cierre contra el centro": side_by_center,
                          "ejemplos": examples},
            "veredicto": "confirmada" if inside else "no pasa"}


@check(11)
def c11():
    """La compresión sale a los dos lados: a mercado y sin una posición a la vez, cada señal da un largo y un corto."""
    raw = copy.deepcopy(rp.RULES["E-CP"])
    raw["entry"] = {"type": "market", "at": "near", "expiry": 8}
    raw["oneAtATime"] = False
    rule, span, res, _ = go("BTCUSDT", raw)
    per = collections.Counter(t["signal"] for t in res["trades"])
    pairs = sum(1 for v in per.values() if v == 2)
    return {"resultado": {"trades": len(res["trades"]), "velas de señal": len(per), "con largo y corto": pairs},
            "veredicto": "confirmada" if pairs else "no pasa"}


@check(12)
def c12():
    """Cambio de carácter desde las 13:30: con la regla en 1h o 4h, ninguno."""
    out = {}
    for tf in (15, 60, 240):
        raw = copy.deepcopy(rp.RULES["E-CC15"])
        raw["tf"] = tf
        rule, span, res, _ = go("BTCUSDT", raw)
        out[f"regla {tf} min"] = {"offset guardado": rule["cc"]["offset"], "señales": res["signals"], "trades": len(res["trades"])}
    ok = out["regla 15 min"]["señales"] > 0 and out["regla 60 min"]["señales"] == 0 and out["regla 240 min"]["señales"] == 0
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa"}


@check(14)
def c14():
    """El control de las liquidaciones usa un swing oculto: en modo zona, cambiar las velas del swing cambia el control."""
    out = {}
    for bars_ in (5, 10):
        raw = copy.deepcopy(rp.RULES["E-LIQz"])
        raw["liq"]["swingBars"] = bars_
        rule, span, res, _ = go("ARBUSDT", raw, base=True)
        c = res.get("control") or {}
        out[f"swing de {bars_}"] = {"trades": len(res["trades"]), "R": (res.get("summary") or {}).get("avgR"),
                                    "control": {k: c.get(k) for k in ("n", "avgR") if k in c} or (c.get("summary") or {}), "hash": rt.rule_hash("ARBUSDT", rule)}
    a, b = out["swing de 5"], out["swing de 10"]
    ok = a["trades"] == b["trades"] and a["R"] == b["R"] and a["control"] != b["control"]
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa"}


@check(15)
def c15():
    """El stop de la vela del elemento empieza en el primer voto: con Swing, en la vela que confirma el swing."""
    raw = rp.rule("conf15", 240, rp.recipe("SP"), stop={"type": "candle", "buffer": 0.1})
    rule, span, res, tr = go("BTCUSDT", raw, trace=True)
    sw = {(e["dir"], e["known"]): e for e in tr["events"] if e["code"] == "SP"}
    above, total, ex = 0, 0, []
    tf_ms = 240 * 60000
    for t in res["trades"]:
        e = sw.get((t["dir"], t["signal"] + tf_ms))
        if e is None:
            continue
        total += 1
        price = e["info"]["price"]
        beyond = (t["stop"] > price) if t["dir"] > 0 else (t["stop"] < price)
        above += beyond
        if beyond and len(ex) < 4:
            ex.append(f"{iso(t['signal'])} {'largo' if t['dir'] > 0 else 'corto'}: swing {price}, stop {round(t['stop'], 2)}")
    return {"resultado": {"trades": total, "stop del lado de adentro del swing": above, "ejemplos": ex},
            "veredicto": "confirmada" if above else "no pasa"}


@check(22)
def c22():
    """Un solo motivo para cuatro filtros: la multitud y el OI sostenido descartan como 'filtro de CVD u OI'."""
    out = {}
    for name in ("FL-CROWD", "FL-STEADY"):
        rule, span, res, _ = go("BTCUSDT", rp.RULES[name])
        out[name] = res["skipped"]
    ok = all("filtro de CVD u OI" in v for v in out.values())
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa"}


@check(23)
def c23():
    """Medidas: sin tabla, todo fuera; con tabla, lo de antes de su inicio pasa sin filtrar."""
    out = {}
    rule, span, res, _ = go("BTCUSDT", rp.RULES["FL-MED"])
    start = int(measures.table_for("BTCUSDT")["close_time"][0])
    before = sum(1 for t in res["trades"] if t["known"] < start)
    out["BTC con la dirección de 4h ≥ 1"] = {"trades": len(res["trades"]), "antes del inicio de la tabla": before,
                                             "inicio de la tabla": iso(start), "sin medidas": sum(1 for t in res["trades"] if not t.get("measures"))}
    rule, span, res, _ = go("DOGEUSDT", rp.RULES["FL-MED3"])
    out["DOGE (sin tabla)"] = {"trades": len(res["trades"]), "descartes": res["skipped"]}
    ok = before > 0 and out["DOGE (sin tabla)"]["trades"] == 0
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa"}


@check(25)
def c25():
    """'velas' que son días: tras romper un rango, N velas medido en 1D son N días."""
    out = {}
    for tf in (None, 1440):
        raw = copy.deepcopy(rp.RULES["FL-BRK"])
        if tf:
            raw["regime"]["tf"] = tf
        raw["oneAtATime"] = False
        rule, span, res, _ = go("BTCUSDT", raw)
        out["medido en 1D" if tf else "medido en 4h"] = {"trades": len(res["trades"]), "descartes": res["skipped"]}
    return {"resultado": out, "veredicto": "por leer", "nota": "con 1D pasan más señales: la ventana de 6 es de 6 días"}


@check(26)
def c26():
    """'Detección de los elementos' cuenta aunque no haga nada: en una moneda sin almacén cambia la identidad, no el resultado."""
    out = {}
    for target in (0.05, 0.02):
        raw = copy.deepcopy(rp.RULES["R01"])
        raw["target"] = target
        rule, span, res, _ = go("DOGEUSDT", raw)
        out[f"frecuencia {target}"] = {"hash": rt.rule_hash("DOGEUSDT", rule), "trades": len(res["trades"]), "R": (res.get("summary") or {}).get("avgR")}
    a, b = out["frecuencia 0.05"], out["frecuencia 0.02"]
    ok = a["hash"] != b["hash"] and a["trades"] == b["trades"] and a["R"] == b["R"]
    return {"resultado": out, "veredicto": "confirmada" if ok else "no pasa"}


@check(27)
def c27():
    """Casillas que no hacen nada con su control apagado: 'lunes a viernes' sin horario y 'pendiente' sin filtro de línea."""
    base = rt.clean_rule(copy.deepcopy(rp.RULES["R01"]))
    raw = copy.deepcopy(rp.RULES["R01"])
    raw["hours"] = {"on": False, "from": 0, "to": 1439, "weekdays": True}
    raw["lines"] = [{"type": "ema", "period": 50, "mode": "none", "slope": True}]
    with_boxes = rt.clean_rule(raw)
    same = rt.rule_hash("BTCUSDT", base) == rt.rule_hash("BTCUSDT", with_boxes)
    return {"resultado": {"misma identidad": same, "horario": with_boxes.get("hours"), "líneas": with_boxes.get("lines")},
            "veredicto": "confirmada" if same and not with_boxes.get("hours") and not with_boxes.get("lines") else "no pasa",
            "nota": "el motor las ignora y no cambian la identidad; si la pantalla las deja marcar se ve en la página"}


@check(34)
def c34():
    """Marcos que la moneda no tiene: el mensaje habla de almacén aunque la moneda no lo tenga."""
    out = {}
    for symbol, tf, group in (("DOGEUSDT", 15, "new"), ("DOGEUSDT", 5, "new"), ("AAPL", 5, "stocks"), ("AAPL", 30, "stocks")):
        raw = copy.deepcopy(rp.RULES["R01"])
        raw["tf"] = tf
        rule = rt.clean_rule(raw)
        has = rt.has_candles(symbol, tf)
        row = next((r for r in rt._plan(rule, 1, group) if r["symbol"] == symbol), None)
        got = {"tiene velas": has, "plan de todas": row and {k: row[k] for k in ("action", "reason")}}
        if not has:
            # Una moneda sola: start() responde antes de lanzar el trabajo cuando no hay velas
            try:
                st = rt.start(symbol, raw, 1)
                got["una moneda"] = {k: st.get(k) for k in ("success", "message", "error") if k in st}
                if st.get("job"):
                    got["una moneda"]["ojo"] = "lanzó un trabajo"
            except Exception as e:
                got["una moneda"] = repr(e)
        out[f"{symbol} {tf} min"] = got
    return {"resultado": out, "veredicto": "por leer"}


@check(36)
def c36():
    """'presentes' y 'en contra' miran el elemento: con Invertir, 'en contra' trae los del lado del trade."""
    rule, span, res, _ = go("BTCUSDT", rp.RULES["R15f"])
    rows = []
    for t in res["trades"][:300]:
        rows.append({"lado": t["dir"], "votos": t["votes"], "presentes": t["present"], "en contra": t["against"]})
    has_fv_present = sum(1 for r in rows if "FV" in r["presentes"])
    return {"resultado": {"trades mirados": len(rows), "con FV entre los presentes": has_fv_present, "ejemplos": rows[:3]},
            "veredicto": "confirmada" if has_fv_present == len(rows) else "por leer",
            "nota": "FV es del lado del elemento (el contrario al trade) y sale como presente, no en contra"}


@check(37)
def c37():
    """Dos órdenes stop: las medidas del trade se leen para el largo aunque el trade sea corto."""
    raw = copy.deepcopy(rp.RULES["E-CP"])
    raw["filters"] = [{"key": "hour", "op": ">=", "value": 0}]  # un filtro que siempre pasa, para que el motor lea la tabla
    rule, span, res, _ = go("BTCUSDT", raw)
    table = measures.table_for("BTCUSDT")
    item = next(m for m in measures.MEASURES if m[0] == "ctx_4h")
    long_read = short_read = 0
    for t in res["trades"]:
        if t["dir"] > 0 or not t.get("measures") or t["measures"].get("ctx_4h") in (None, 0):
            continue
        row = measures.row_at(table, t["known"])
        if row is None:
            continue
        v_long = measures.value_at(table, item, row, 1)
        v_short = measures.value_at(table, item, row, -1)
        if abs(t["measures"]["ctx_4h"] - v_long) < 1e-9:
            long_read += 1
        elif abs(t["measures"]["ctx_4h"] - v_short) < 1e-9:
            short_read += 1
    return {"resultado": {"cortos leídos para el largo": long_read, "cortos leídos para el corto": short_read},
            "veredicto": "confirmada" if long_read and not short_read else "no pasa"}


@check(39)
def c39():
    """Medidas con el mismo nombre: 'Volumen alto' y 'Flecha de volumen' con 2 veces no marcan las mismas velas."""
    raw = rp.rule("conf39", 240, rp.recipe("VH", "RF", mode="threshold", minimum=1), rv={"arrow": "any"})
    rule, span, res, tr = go("BTCUSDT", raw, trace=True)
    vh = {(e["t"], e["dir"]) for e in tr["events"] if e["code"] == "VH"}
    rf = {(e["t"], e["dir"]) for e in tr["events"] if e["code"] == "RF"}
    return {"resultado": {"volumen alto": len(vh), "flecha": len(rf), "las dos": len(vh & rf), "solo volumen alto": len(vh - rf), "solo flecha": len(rf - vh)},
            "veredicto": "confirmada" if vh != rf else "no pasa"}


@check(40)
def c40():
    """Acciones: la última vela de 1h (30 minutos) 'cierra' a la hora completa."""
    bars = rt.candle_bars("AAPL", 60)
    if not bars:
        return {"veredicto": "sin datos"}
    rows = []
    for b in bars[-40:]:
        t = dt.datetime.fromtimestamp(b["t"] / 1000, dt.timezone.utc)
        rows.append(t.strftime("%m-%d %H:%M"))
    last_bar = [r for r in rows if r.endswith("19:30") or r.endswith("20:30")]
    return {"resultado": {"últimas velas de 1h (UTC)": rows[-10:], "velas de las 15:30 de Nueva York": last_bar[-3:],
                          "duración que usa el motor": "1 h (la señal se conoce al cierre: inicio + 60 min)"},
            "veredicto": "por leer"}


@check(43)
def c43():
    """Valores de fábrica del backend: no espera tras cerrar, dos órdenes a 1 ATR del cierre y cualquier hueco en el FVG."""
    r = rt.clean_rule({"recipe": {"slots": [{"codes": ["FV"], "group": 0}]}, "entry": {"type": "straddle"}})
    return {"resultado": {"cooldown": r["cooldown"], "entrada": r["entry"], "fv": r.get("fv")},
            "veredicto": "confirmada" if r["cooldown"] == 0 and r["entry"].get("offset") == 1.0 and r["entry"].get("from") == "close" and (r.get("fv") or {}).get("minAtr") == 0.0 else "no pasa"}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--solo", default="")
    a = ap.parse_args()
    only = {int(x) for x in a.solo.split(",") if x}
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / "confusiones_motor.json"
    out = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for n, fn in sorted(CHECKS.items()):
        if only and n not in only:
            continue
        t0 = time.time()
        try:
            got = fn()
        except Exception as e:  # una comprobación que falla no detiene a las demás
            got = {"veredicto": "error", "error": repr(e)}
        got["s"] = round(time.time() - t0, 1)
        out[str(n)] = got
        print(f"conf. {n}: {got.get('veredicto')} · {json.dumps(got.get('resultado'), ensure_ascii=False, default=str)[:600]}", flush=True)
        path.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
