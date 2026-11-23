"""
Protocolo (22/11/2026), etapa 4: los filtros de prioridad 1 del motor contra el oráculo independiente (`filtros_a.py`,
escrito aparte desde la documentación y los datos crudos, sin ver el motor).

Para cada filtro: las señales de la regla sin él (FVG nuevo 0.3, sin "una posición a la vez") y, para cada una, si el
motor la deja pasar con el filtro (que no salga con el motivo del filtro) contra lo que dice el oráculo en esa vela y
ese lado. Las diferencias se muestran con el valor que mira el oráculo.

Uso (desde backend/): python -B tests/audit/comparar_filtros.py BTCUSDT [--tf 240] [--fase 1]
"""
import argparse
import collections
import copy
import datetime as dt
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402
from metamorficas import FILTERS  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
REASONS = {"filtro de VWAP o EMA", "filtro de CVD u OI"}
LINES_AND_FLOW = [name for name, extra in FILTERS.items() if "lines" in extra or "flow" in extra]


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def run(symbol, extra, tf, phase):
    raw = {"recipe": rp.recipe("FV"), "fv": {"minAtr": 0.3}, **copy.deepcopy(extra)}
    rule = rt.clean_rule(rp.rule("filtro", tf, raw.pop("recipe"), oneAtATime=False, **raw))
    span = rt.detect_span(symbol, tf, phase, rule)
    trace = {}
    rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=False, trace=trace)
    return rule, span, trace


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=240)
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--fuente-oi", default="auto")
    a = ap.parse_args()
    import filtros_a as oracle  # escrito aparte, sin ver el motor
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    _, span, base_trace = run(a.symbol, {}, a.tf, phase)
    signals = [(s["k"], s["dir"]) for s in base_trace["signals"]]
    bars = base_trace["ctx"]["bars"]
    out = []
    for name in LINES_AND_FLOW:
        rule, _, trace = run(a.symbol, FILTERS[name], a.tf, phase)
        what = {(s["k"], s["dir"]): s.get("what") for s in trace["signals"]}
        cache = {}
        counts = collections.Counter()
        examples = []
        for k, side in signals:
            engine = what.get((k, side)) not in REASONS
            ok, detail = oracle.evaluar_filtros(a.symbol, a.tf, bars, k, side, rule, fuente_oi=a.fuente_oi, cache=cache)
            mine = bool(ok) if ok is not None else False  # Sin dato no pasa, como en la app
            counts[(engine, mine)] += 1
            if engine != mine and len(examples) < 6:
                examples.append(f"{iso(bars[k]['t'])} {'↑' if side > 0 else '↓'} motor {'pasa' if engine else 'no'} · oráculo "
                                f"{'pasa' if mine else 'no'} · {{{', '.join(f'{n}: {v.pasa} {v.valor}' for n, v in detail.items())}}}"[:400])
        agree = counts[(True, True)] + counts[(False, False)]
        row = {"filtro": name, "señales": len(signals), "iguales": agree, "pasa motor, no oráculo": counts[(True, False)],
               "pasa oráculo, no motor": counts[(False, True)], "ejemplos": examples}
        out.append(row)
        print(f"{name}: {agree} de {len(signals)} iguales"
              + ("" if agree == len(signals) else f" · solo pasa en el motor {counts[(True, False)]}, solo en el oráculo {counts[(False, True)]}"), flush=True)
        for e in examples[:3]:
            print("    ", e)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"comparar_filtros_{a.symbol}_{a.tf}_f{a.fase}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
