"""
Protocolo (21/11/2026), etapa 3: invariantes (sección 7) y pruebas metamórficas (sección 8) del motor con una regla de
prueba (R01 de fábrica: FVG nuevo de 0.3 ATR, a mercado, stop 1.5 ATR, 3R). Usa `rule_tester.run` solo para correr la
regla; lo que se comprueba se calcula aquí, desde la documentación.

  I-01  corte: la regla con las velas cortadas en 5 fechas al azar (semilla fija). Los trades que salieron antes del
        corte, y las señales conocidas antes de él, tienen que ser los mismos.
  I-07  una posición a la vez: ningún trade empieza antes de que salga el anterior, y el enfriamiento se respeta.
  I-08  fase: ninguna señal ni entrada fuera de la fase, ninguna salida después de su última vela.
  I-09  embudo: señales = trades + cada motivo + con posición abierta + abiertas al final.
  I-10  repetible: la regla en la moneda X, después en otra Y y otra vez en X (en el mismo proceso) da lo mismo.
  I-11  cuentas: el resumen recalculado desde la lista de trades.
  M-01  espejo: con los precios reflejados (p' = A − p) y sin minutos, cada largo es un corto en la misma vela, con el
        mismo R bruto.
  M-02  escala: con los precios por 10 y sin minutos, las mismas señales y el mismo R.
  M-07  caché en frío: sin los cachés de elementos en memoria, lo mismo.

Uso (desde backend/): python -B tests/audit/invariantes.py BTCUSDT [--regla R01] [--fase 1] [--otra ETHUSDT]
"""
import argparse
import collections
import copy
import json
import math
import os
import random
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
import rule_tester as rt  # noqa: E402
import reglas_prueba as rp  # noqa: E402

OUT = Path(os.environ.get("AUDIT_OUT", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\motor"))
KEYS = ("entry_t", "dir", "entry", "stop", "target", "exit_t", "exit", "reason", "r", "gross", "mfe", "mae", "bars")


def phase_of(symbol, n):
    return next(p for p in rt.phases(symbol) if p["phase"] == n)


def run(symbol, rule, span, phase, trace=None, no_minutes=False):
    """La regla limpia sobre un tramo, sin controles. no_minutes: el contexto sin lector de minutos. Con filtros de
    medidas, con la tabla de medidas de la moneda, como la corrida de la app (etapa 6: sin ella daba 0 trades)."""
    table = measures.table_for(symbol) if rule.get("filters") else None
    if not no_minutes:
        return rt.run(symbol, rule, span, phase, table, base=False, trace=trace)
    original = rt._context

    def ctx_sin_minutos(symbol_, tf, bars):
        ctx = original(symbol_, tf, bars)
        ctx["minutes"] = None
        return ctx
    rt._context = ctx_sin_minutos
    try:
        return rt.run(symbol, rule, span, phase, table, base=False, trace=trace)
    finally:
        rt._context = original


def brief(t, keys=KEYS):
    return tuple((round(t[k], 8) if isinstance(t.get(k), float) else t.get(k)) for k in keys)


def i01_corte(symbol, rule, span, phase, full, full_trace, seed=2026, cuts=5):
    bars, tf_ms = span["bars"], rule["tf"] * 60000
    rnd = random.Random(seed)
    out = []
    for c in sorted(rnd.sample(range(len(bars) // 10, len(bars) * 9 // 10), cuts)):
        cut_ms = bars[c - 1]["t"] + tf_ms  # cierre de la última vela que queda
        part = {**span, "bars": bars[:c], "events": [e for e in span["events"] if e["known"] <= cut_ms]}
        trace = {}
        res = run(symbol, rule, part, {**phase, "end": cut_ms}, trace=trace)
        if "signals" not in trace:
            # Etapa 6: un tramo cortado muy corto (la fase diaria de ARB tiene ~290 velas) no llega a correr la regla
            out.append({"corte": rt._iso(cut_ms) if hasattr(rt, "_iso") else cut_ms, "velas": c, "iguales": True,
                        "señales_distintas": [], "sin correr": res.get("message") or res.get("error") or "sin señales"})
            continue
        before = [brief(t) for t in full["trades"] if t["exit_t"] < cut_ms]
        mine = [brief(t) for t in res.get("trades", []) if t["exit_t"] < cut_ms]
        sig_full = {(s["k"], s["dir"]): s.get("what") for s in full_trace["signals"] if s["k"] < c - 1}
        sig_cut = {(s["k"], s["dir"]): s.get("what") for s in trace["signals"] if s["k"] < c - 1}
        # Una señal con trade en la corrida completa puede quedar "abierta al final" en la cortada (sale después del corte),
        # y una orden puesta poco antes del corte, "sin llenar" (se llenaría después). Lo que no vale: que la señal falte
        unfilled = ("limit sin llenar", "orden stop sin llenar", "ninguna orden stop se llenó")
        wait = max(int((rule.get("entry") or {}).get("expiry") or 0), 50) if rule["entry"]["type"] in ("limit", "stop", "straddle") else 0
        diff_sig = [key for key in set(sig_full) | set(sig_cut)
                    if sig_full.get(key) != sig_cut.get(key)
                    and not (sig_full.get(key) == "trade" and sig_cut.get(key) == "abierta al final de la fase")
                    and not (sig_cut.get(key) in unfilled and key[0] >= c - 1 - wait)]
        out.append({"corte": rt._iso(cut_ms) if hasattr(rt, "_iso") else cut_ms, "velas": c,
                    "trades_antes": len(before), "iguales": before == mine,
                    "solo_completa": [x for x in before if x not in mine][:3], "solo_cortada": [x for x in mine if x not in before][:3],
                    "señales": len(sig_full), "señales_distintas": [(k, sig_full.get(k), sig_cut.get(k)) for k in sorted(diff_sig)][:5]})
    return out


def i07_posicion(rule, trades):
    bad = []
    ordered = sorted(trades, key=lambda t: t["entry_t"])
    tf_ms = rule["tf"] * 60000
    for a, b in zip(ordered, ordered[1:]):
        # Motor 6 (H15): salir al cierre y entrar en la apertura siguiente es la misma hora; y una orden que espera puede
        # llenarse en la vela de la salida, después de la salida (su hora es la apertura de esa vela: el motor lo comprueba
        # con el minuto del llenado, test_motor6.py)
        same_bar = b.get("order") in ("limit", "stop") and b["entry_t"] == a["exit_t"] - a["exit_t"] % tf_ms
        if b["entry_t"] < a["exit_t"] and not same_bar:
            bad.append(("se superpone", a["n"], b["n"]))
        elif rule.get("cooldown") and b["entry_t"] < a["exit_t"] + rule["cooldown"] * tf_ms:
            bad.append(("enfriamiento", a["n"], b["n"]))
    return {"trades": len(ordered), "problemas": bad[:10], "ok": not bad}


def i08_fase(phase, span, trades):
    last_close = span["bars"][-1]["t"] + (span["bars"][1]["t"] - span["bars"][0]["t"])
    bad = [t["n"] for t in trades if not (phase["start"] <= t["signal"] < phase["end"] and phase["start"] <= t["entry_t"] < phase["end"]
                                          and t["exit_t"] <= min(phase["end"], last_close))]
    return {"ok": not bad, "fuera": bad[:10], "inicio": phase["start"], "fin": phase["end"]}


def i09_embudo(res, trace=None):
    # "sin vela siguiente" (la señal de la última vela de la fase) no va en los motivos del motor: sale de la traza,
    # como la cuenta el protocolo (etapa 6: R35-60 en BTC 1h quedaba con 1 señal sin cuadrar, la del 31/12/2023 23:00)
    no_next = sum(1 for s in (trace or {}).get("signals", []) if s.get("what") == "sin vela siguiente")
    total = len(res["trades"]) + sum(res["skipped"].values()) + res["busy"] + res["open"] + no_next
    return {"señales": res["signals"], "trades": len(res["trades"]), "motivos": res["skipped"], "posición abierta": res["busy"],
            "abiertas al final": res["open"], "sin vela siguiente": no_next, "suma": total, "ok": total == res["signals"]}


def wilson(wins, n, z=1.96):
    if not n:
        return None
    p = wins / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return [round(100 * (mid - half), 1), round(100 * (mid + half), 1)]


def i11_cuentas(res):
    """El resumen recalculado desde los trades (en orden de salida), comparado campo por campo."""
    ts = sorted(res["trades"], key=lambda t: (t["exit_t"], t["entry_t"]))
    rs = [t["r"] for t in ts]
    n = len(rs)
    wins = sum(r > 0 for r in rs)
    pos, neg = sum(r for r in rs if r > 0), -sum(r for r in rs if r < 0)
    mean = sum(rs) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in rs) / (n - 1)) if n > 1 else 0.0
    eq = peak = dd = 0.0
    w = l = bw = bl = 0
    for r in rs:
        eq += r
        peak = max(peak, eq)
        dd = max(dd, peak - eq)
        w, l = (w + 1, 0) if r > 0 else (0, l + 1)
        bw, bl = max(bw, w), max(bl, l)
    srt = lambda xs: sorted(xs)  # noqa: E731
    med = lambda xs: (srt(xs)[len(xs) // 2] if len(xs) % 2 else (srt(xs)[len(xs) // 2 - 1] + srt(xs)[len(xs) // 2]) / 2)  # noqa: E731
    mine = {"n": n, "wins": wins, "winRate": round(100 * wins / n, 1), "wilson": wilson(wins, n), "avgR": round(mean, 3),
            "totalR": round(sum(rs), 2), "seR": round(sd / math.sqrt(n), 4), "profitFactor": round(pos / neg, 2) if neg else None,
            "maxDrawdownR": round(dd, 2), "bestStreak": bw, "worstStreak": bl,
            "avgBars": round(sum(t["bars"] for t in ts) / n, 1), "medianMfe": round(med([t["mfe"] for t in ts]), 2),
            "medianMae": round(med([t["mae"] for t in ts]), 2)}
    theirs = res["summary"]
    bad = {k: (v, theirs.get(k)) for k, v in mine.items() if (abs(v - theirs.get(k)) > 1e-9 if isinstance(v, float) and isinstance(theirs.get(k), (int, float)) else v != theirs.get(k))}
    return {"ok": not bad, "distintos": bad, "campos": len(mine)}


def mirror_span(span, scale=None):
    """Las velas (y las de antes de la fase, si las hay) por `scale`, o reflejadas: p' = A − p."""
    bars = span["bars"]
    warm = span.get("warm") or []
    # Los precios transformados, redondeados a 10 decimales como los niveles del motor 6 (O-25): sin eso, A − p o p × 10
    # dejan ruido de coma flotante en las velas, y un toque exacto del original deja de serlo en la copia
    q = lambda x: round(x, 10)  # noqa: E731
    if scale is not None:
        f = lambda b: dict(b, o=q(b["o"] * scale), h=q(b["h"] * scale), l=q(b["l"] * scale), c=q(b["c"] * scale))  # noqa: E731
        ev = [dict(e, lo=q(e["lo"] * scale), hi=q(e["hi"] * scale)) for e in span["events"]]
    else:
        a = max(b["h"] for b in bars + warm) + min(b["l"] for b in bars + warm)
        f = lambda b: dict(b, o=q(a - b["o"]), h=q(a - b["l"]), l=q(a - b["h"]), c=q(a - b["c"]), delta=-b.get("delta", 0.0))  # noqa: E731
        ev = [dict(e, dir=-e["dir"], lo=q(a - e["hi"]), hi=q(a - e["lo"])) for e in span["events"]]
    out = {**span, "bars": [f(b) for b in bars], "events": ev}
    if "warm" in span:
        out["warm"] = [f(b) for b in warm]
    return out


def with_warm(symbol, rule, span, phase):
    """Las velas de antes de la fase en el tramo (motor 6, H2), para reflejarlas o escalarlas junto con las de la fase:
    sin esto el motor les ponía delante las reales."""
    if "warm" in span:
        return span
    return {**span, "warm": rt._warm_bars(symbol, rule["tf"], phase, rule)}


def m01_espejo(symbol, rule, span, phase):
    span = with_warm(symbol, rule, span, phase)
    # Sin el tope de la comisión (H18, motor 6): depende del nivel del precio, y el espejo lo cambia (en BTC, los precios
    # de 2020 pasan de unos 8,000 a unos 64,000 y la comisión en R se multiplica). La escala no lo toca
    rule = {**rule, "maxFeeR": 0}
    base = run(symbol, rule, span, phase, no_minutes=True)
    # Una regla de un solo lado se refleja también de lado (solo largos ↔ solo cortos)
    flip = {"long": "short", "short": "long"}
    rule_m = copy.deepcopy(rule)
    rule_m["recipe"]["side"] = flip.get(rule["recipe"].get("side"), rule["recipe"].get("side"))
    mir = run(symbol, rule_m, mirror_span(span), phase, no_minutes=True)
    # Cada trade con su pareja por la vela de entrada y su lugar en ella: desde el motor 6 (H15) dos trades pueden
    # entrar en la misma vela (el primero sale y una orden que se llena después entra). Con la vela sola, el segundo
    # tapaba al primero y el espejo daba distinto lo que era igual (etapa 7)
    def keyed(trades):
        seen, out = collections.Counter(), {}
        for t in trades:
            out[(t["entry_t"], seen[t["entry_t"]])] = t
            seen[t["entry_t"]] += 1
        return out
    by = keyed(mir["trades"])
    bad, ties = [], 0
    for key, t in keyed(base["trades"]).items():
        m = by.get(key)
        if m is None or m["dir"] != -t["dir"] or m["reason"] != t["reason"] or abs(m["gross"] - t["gross"]) > 1e-6 \
                or m["exit_t"] // 60000 != t["exit_t"] // 60000:
            bad.append({"n": t["n"], "dir": t["dir"], "entrada": t["entry_t"], "motivo": t["reason"], "bruto": t["gross"],
                        "espejo": None if m is None else {"dir": m["dir"], "motivo": m["reason"], "bruto": m["gross"], "salida": m["exit_t"]},
                        "salida": t["exit_t"]})
    mine = keyed(base["trades"])
    extra = [key[0] for key in by if key not in mine]
    return {"trades": len(base["trades"]), "espejo": len(mir["trades"]), "distintos": bad[:8], "n_distintos": len(bad),
            "solo_en_el_espejo": extra[:5], "ok": not bad and not extra}


def m02_escala(symbol, rule, span, phase):
    span = with_warm(symbol, rule, span, phase)
    base = run(symbol, rule, span, phase, no_minutes=True)
    big = run(symbol, rule, mirror_span(span, scale=10.0), phase, no_minutes=True)
    # El motor redondea el R a 4 decimales: una diferencia de una unidad en el último es redondeo (tolerancia del comparador)
    a = [(t["entry_t"], t["dir"], t["reason"], t["exit_t"]) for t in base["trades"]]
    b = [(t["entry_t"], t["dir"], t["reason"], t["exit_t"]) for t in big["trades"]]
    r_bad = [(x["entry_t"], x["r"], y["r"]) for x, y in zip(base["trades"], big["trades"])
             if abs(x["r"] - y["r"]) > 1.5e-4 or abs(x["gross"] - y["gross"]) > 1e-6]
    return {"trades": len(a), "escala": len(b), "ok": a == b and not r_bad, "solo_base": [x for x in a if x not in b][:5],
            "solo_escala": [x for x in b if x not in a][:5], "r_distinto": r_bad[:5]}


def m07_frio(symbol, rule, span, phase, full):
    for cache in ("_extra", "_spans"):
        if isinstance(getattr(rt, cache, None), dict):
            getattr(rt, cache).clear()
    res = run(symbol, rule, span, phase)
    return {"ok": [brief(t) for t in res["trades"]] == [brief(t) for t in full["trades"]], "trades": len(res["trades"])}


def external_data(rule):
    """El espejo y la escala no valen si la regla usa datos que no salen de las velas: el perfil por sesión (celdas del
    almacén), los flujos on-chain, el OI, el funding, el CVD del almacén o las medidas del Observador."""
    codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
    if codes - set(rt.CANDLE_CODES):
        return True  # Elementos de order flow: salen del almacén de trades, no de las velas
    return bool(codes & set(getattr(rt, "VP_CODES", ())) or rule["exit"].get("chainTarget") or rule.get("flow")
                or rule.get("filters") or rule.get("targetAt") in ("poc", "edge", "mid") or codes & {"LIQ"})


def check_rule(name, symbol, phase_n, other):
    rule = rt.clean_rule(copy.deepcopy(rp.RULES[name]))
    phase = phase_of(symbol, phase_n)
    t0 = time.time()
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    trace = {}
    full = run(symbol, rule, span, phase, trace=trace)
    rep = {"regla": name, "moneda": symbol, "fase": phase_n, "trades": len(full.get("trades", []))}
    if not full.get("success", True) or "trades" not in full:
        rep["error"] = full.get("message")
        return rep
    rep["I-01"] = i01_corte(symbol, rule, span, phase, full, trace)
    rep["I-07"] = i07_posicion(rule, full["trades"]) if rule.get("oneAtATime") else {"ok": True, "no aplica": "todas las señales"}
    rep["I-08"] = i08_fase(phase, span, full["trades"])
    rep["I-09"] = i09_embudo(full, trace)
    rep["I-11"] = i11_cuentas(full) if full["trades"] else {"ok": True, "no aplica": "sin trades"}
    # I-10: X, otra moneda, X otra vez (mismo proceso, cachés en memoria)
    if other:
        other_phase = phase_of(other, phase_n)
        run(other, rule, rt.detect_span(other, rule["tf"], other_phase, rule), other_phase)
        again = run(symbol, rule, rt.detect_span(symbol, rule["tf"], phase, rule), phase)
        rep["I-10"] = {"ok": [brief(t) for t in again["trades"]] == [brief(t) for t in full["trades"]], "otra": other}
    if external_data(rule):
        rep["M-01"] = rep["M-02"] = {"ok": True, "no aplica": "la regla usa datos que no salen de las velas"}
    else:
        ex = rule["exit"]
        if ex.get("trail") == "pct" or (ex.get("tpTrail") or {}).get("unit") == "pct":
            # Una distancia en % del precio no se conserva al reflejar (el precio reflejado es otro nivel); sí al escalar
            rep["M-01"] = {"ok": True, "no aplica": "distancia en % del precio"}
        else:
            rep["M-01"] = m01_espejo(symbol, rule, span, phase)
        rep["M-02"] = m02_escala(symbol, rule, span, phase)
    rep["M-07"] = m07_frio(symbol, rule, span, phase, full)
    rep["segundos"] = round(time.time() - t0, 1)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"invariantes_{name}_{symbol}_f{phase_n}.json"
    path.write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    return rep


def line(rep):
    if rep.get("error"):
        return f"{rep['regla']} {rep['moneda']}: ERROR {rep['error']}"
    bad = []
    for key in ("I-01", "I-07", "I-08", "I-09", "I-10", "I-11", "M-01", "M-02", "M-07"):
        val = rep.get(key)
        if val is None:
            continue
        if key == "I-01":
            bad += [f"I-01 {c['corte']}" for c in val if not (c["iguales"] and not c["señales_distintas"])]
        elif not val.get("ok"):
            bad.append(key)
    na = [k for k in ("I-07", "I-11", "M-01") if (rep.get(k) or {}).get("no aplica")]
    return (f"{rep['regla']} {rep['moneda']} f{rep['fase']}: {rep['trades']} trades · " + ("todo bien" if not bad else "⚠ " + ", ".join(bad))
            + (f" · no aplica: {', '.join(na)}" if na else "") + f" · {rep['segundos']} s")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--regla", default="R01", help="una o varias, separadas por comas")
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--otra", default="ETHUSDT")
    a = ap.parse_args()
    for name in a.regla.split(","):
        try:
            rep = check_rule(name.strip(), a.symbol, a.fase, a.otra)
            print(line(rep), flush=True)
        except Exception as error:  # Una regla que falla no detiene las demás
            print(f"{name} {a.symbol}: ERROR {type(error).__name__}: {error}", flush=True)


if __name__ == "__main__":
    main()
