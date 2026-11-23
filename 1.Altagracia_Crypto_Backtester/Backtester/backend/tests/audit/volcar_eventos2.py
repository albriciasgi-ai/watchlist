"""
Protocolo (22/11/2026), etapa 6: vuelca lo que el motor dice de las piezas de nivel C del VPA y de SMC, para
compararlo con sus indicadores en JavaScript (`comparar_js2.mjs`: vpa.js y smcStructure.js, que tienen sus propias
pruebas de paridad con Python):

- los eventos de QA, QF, QR, QT, QS, QC y QE (Lector VPA) y de BS, OB, BK y EQ (estructura SMC), con las reglas de
  prueba de la etapa 6 (`reglas_prueba.STAGE6`: E-QA a E-QE y E-BS a E-EQ, con los parámetros de fábrica);
- las señales del FVG nuevo 0.3 (sin "una posición a la vez") y cuáles deja pasar cada filtro: premium/discount y
  estructura a favor (SMC, FL-PD y FL-BIAS), y el medidor VPA a favor o que no esté en contra (FL-VPAf y FL-VPAn).
  Con cada señal va lo que el motor leyó en su vela (rango y tendencia SMC, medidor y volumen relativo), solo para
  explicar una diferencia: la comparación la hace el JS con su propio cálculo.
- aparte, las velas con que calcula el gráfico de la ventana (`chart_bars`): sus indicadores corren desde su primera
  vela, que puede ser anterior a la fase, y en las monedas de siempre son las del caché de App 1 (O-09). Sirven para
  ver lo que mostraría el gráfico, no para la comparación en las mismas velas.

Mismo patrón que `volcar_eventos.py` (etapa 4).
Uso (desde backend/): python -X utf8 -B tests/audit/volcar_eventos2.py BTCUSDT [--tf 240] [--fase 1]
Escribe evidencia/elementos/volcado2_<moneda>_<tf>_f<fase>.json
"""
import argparse
import copy
import gzip
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")

VPA_CODES = ("QA", "QF", "QR", "QT", "QS", "QC", "QE")
SMC_CODES = ("BS", "OB", "BK", "EQ")
# Un elemento por regla, como en la etapa 6
ELEMENT_RULES = {code: rp.STAGE6[f"E-{code}"] for code in VPA_CODES + SMC_CODES}
# Filtros sobre el FVG 0.3; "FV" es la misma regla sin filtro (las señales tienen que ser las mismas)
FILTER_RULES = {"FV": rp.RULES["R01"], "FL-PD": rp.STAGE6["FL-PD"], "FL-BIAS": rp.STAGE6["FL-BIAS"],
                "FL-VPAf": rp.STAGE6["FL-VPAf"], "FL-VPAn": rp.STAGE6["FL-VPAn"]}
FILTER_REASONS = {"FL-PD": "filtro SMC", "FL-BIAS": "filtro SMC", "FL-VPAf": "filtro VPA", "FL-VPAn": "filtro VPA"}


def clean(x):
    """NaN e infinitos a None: el JSON tiene que poder leerlo node."""
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, (list, tuple)):
        return [clean(v) for v in x]
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    return x


def engine_events(symbol, raw, tf, phase):
    rule = rt.clean_rule(copy.deepcopy({**raw, "tf": tf}))
    span = rt.detect_span(symbol, tf, phase, rule)
    ctx = rt._context(symbol, tf, span["bars"])
    ctx["bars"] = span["bars"]
    return rule, span, rt._extra_events(symbol, rule, span, ctx)


def filter_signals(symbol, tf, phase, raw):
    """Cada señal de la regla sin "una posición a la vez", con qué pasó; y lo que leyó el motor en su vela."""
    rule = rt.clean_rule(copy.deepcopy({**raw, "tf": tf, "oneAtATime": False}))
    span = rt.detect_span(symbol, tf, phase, rule)
    trace = {}
    rt.run(symbol, rule, span, phase, None, base=False, trace=trace)
    ctx = trace["ctx"]
    rng = rt._smc_range(rule, ctx) if rule.get("smcf") else None
    series = rt._vpa_series(rule, ctx) if rule.get("vpaf") else None
    out = []
    for s in trace["signals"]:
        k = s["k"]
        row = {"k": k, "t": ctx["T"][k], "dir": s["dir"], "what": s.get("what"), "trade": "trade" in s}
        if rng is not None:
            row["eng"] = {"top": rng["top"][k], "bottom": rng["bottom"][k], "bias": rng["bias"][k], "close": ctx["C"][k]}
        if series is not None:
            row["eng"] = {"meter": series["meter"][k], "rv": series["rv"][k]}
        out.append(row)
    return rule, out


CACHE_KEYS = {5: "5m", 15: "15m", 60: "1h", 240: "4h"}


def chart_bars(symbol, tf, phase):
    """Las velas que tiene el gráfico de la ventana hasta el final de la fase (su hora): en las monedas de siempre, las
    del caché de App 1 y, antes de su primera, las del almacén desde el inicio de la fase 1 (/api/tester/candles); en
    las nuevas, las del disco (/api/tester/chart-candles)."""
    if symbol in rt.base_symbols():
        d = json.load(gzip.open(Path("backtesting_cache") / f"{symbol}_backtesting_data.json.gz", "rt"))
        rows = [[int(c["timestamp"]), float(c["open"]), float(c["high"]), float(c["low"]), float(c["close"]), float(c["volume"])]
                for c in d["timeframes"][CACHE_KEYS[tf]]["main"]]
        early = rt.early_candles(symbol, tf, rows[0][0])
        pre = [[int(t), float(o), float(h), float(l), float(c), float(v)]
               for t, o, h, l, c, v in zip(early["t"], early["o"], early["h"], early["l"], early["c"], early["v"])]
        rows = [r for r in pre if r[0] < rows[0][0]] + rows
        source = "caché de App 1" + (f" y {len(pre)} velas del almacén antes" if pre else "")
    else:
        rows = [[b["t"], b["o"], b["h"], b["l"], b["c"], b["vol"]] for b in rt.candle_bars(symbol, tf)]
        source = "velas del disco (candle_bars)"
    return source, [r for r in rows if r[0] < phase["end"]]


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=240)
    ap.add_argument("--fase", type=int, default=1)
    a = ap.parse_args()
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    out = {"moneda": a.symbol, "tf": a.tf, "fase": a.fase, "fase_desde": phase["start"], "fase_hasta": phase["end"],
           "events": {}, "rules": {}, "filters": {}}
    for name, raw in ELEMENT_RULES.items():
        rule, span, evs = engine_events(a.symbol, raw, a.tf, phase)
        out["rules"][name] = rule
        out["events"][name] = evs
        if "bars" not in out:
            out["bars"] = [[b["t"], b["o"], b["h"], b["l"], b["c"], b.get("vol", b.get("v", 0))] for b in span["bars"]]
        print(name, len(evs), "eventos", flush=True)
    for name, raw in FILTER_RULES.items():
        rule, sig = filter_signals(a.symbol, a.tf, phase, raw)
        out["filters"][name] = {"rule": rule, "signals": sig}
        reason = FILTER_REASONS.get(name)
        passed = sum(1 for s in sig if s["what"] != reason)
        print("filtro", name, f"{passed} de {len(sig)} pasan", flush=True)
    source, rows = chart_bars(a.symbol, a.tf, phase)
    out["chart"] = {"source": source, "bars": rows}
    print("gráfico:", source, len(rows), "velas, la primera",
          rt._iso(rows[0][0]) if rows else "—", "· la fase empieza", rt._iso(phase["start"]), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"volcado2_{a.symbol}_{a.tf}_f{a.fase}.json"
    path.write_text(json.dumps(clean(out), ensure_ascii=False, default=str, allow_nan=False), encoding="utf-8")
    print("->", path)


if __name__ == "__main__":
    main()
