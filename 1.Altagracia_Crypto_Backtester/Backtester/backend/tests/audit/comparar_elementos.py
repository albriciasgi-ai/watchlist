"""
Protocolo (21/11/2026), etapa 4: los elementos de velas del motor contra el oráculo independiente (`elementos_a.py`,
escrito aparte desde la documentación, sin ver el motor). Para cada elemento, con sus parámetros de fábrica, compara
los eventos de toda la fase: lado, vela, cuándo se conoce y la zona. Las diferencias se muestran para buscar su causa.

Uso (desde backend/): python -B tests/audit/comparar_elementos.py BTCUSDT [--tf 240] [--fase 1] [--codigos FV,IM,...]
"""
import argparse
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
import rule_tester as rt  # noqa: E402
import reglas_prueba as rp  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
CODES = ("FV", "IM", "SP", "VH", "RF", "HM", "EN", "DJ")
# Lo que la regla de prueba pone para cada elemento (lo demás, de fábrica por clean_rule)
RAW = {"FV": {"fv": {"minAtr": 0.3}}, "RF": {"rv": {"arrow": "with"}}}
# Cómo se llaman sus parámetros en la regla limpia
PARAM_KEY = {"FV": "fv", "IM": "im", "SP": "sp", "RF": "rv", "HM": "pat", "EN": "pat", "DJ": "pat"}


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def phase_of(symbol, n):
    return next(p for p in rt.phases(symbol) if p["phase"] == n)


def engine_events(symbol, code, tf, phase_n):
    rule = rt.clean_rule(rp.rule(f"elemento {code}", tf, rp.recipe(code), **RAW.get(code, {})))
    phase = phase_of(symbol, phase_n)
    span = rt.detect_span(symbol, tf, phase, rule)
    ctx = rt._context(symbol, tf, span["bars"])
    ctx["bars"] = span["bars"]
    found = [e for e in rt._extra_events(symbol, rule, span, ctx) if e["code"] == code]
    return span["bars"], found, rule


def close(a, b, rel=1e-9):
    return abs(a - b) <= rel * max(1.0, abs(a), abs(b))


def compare(symbol, code, tf, phase_n, oracle):
    bars, eng, rule = engine_events(symbol, code, tf, phase_n)
    params = rule.get(PARAM_KEY[code]) if code in PARAM_KEY else None
    mine = oracle.events(code, bars, tf, params)
    key = lambda e: (e["dir"], e["t"], e["known"])  # noqa: E731
    e_map, m_map = {key(e): e for e in eng}, {key(e): e for e in mine}
    only_e, only_m = sorted(set(e_map) - set(m_map), key=lambda k: k[1]), sorted(set(m_map) - set(e_map), key=lambda k: k[1])
    zone = [k for k in set(e_map) & set(m_map) if not (close(e_map[k]["lo"], m_map[k]["lo"]) and close(e_map[k]["hi"], m_map[k]["hi"]))]
    fmt = lambda k, e: f"{iso(k[1])} {'↑' if k[0] > 0 else '↓'} conocido {iso(k[2])} zona {e['lo']:.6g}–{e['hi']:.6g}"  # noqa: E731
    return {"moneda": symbol, "tf": tf, "fase": phase_n, "codigo": code, "velas": len(bars), "motor": len(eng), "oraculo": len(mine),
            "iguales": len(set(e_map) & set(m_map)), "solo_motor": len(only_e), "solo_oraculo": len(only_m), "zona_distinta": len(zone),
            "ej_solo_motor": [fmt(k, e_map[k]) for k in only_e[:6]], "ej_solo_oraculo": [fmt(k, m_map[k]) for k in only_m[:6]],
            "ej_zona": [f"{fmt(k, e_map[k])} · oráculo {m_map[k]['lo']:.6g}–{m_map[k]['hi']:.6g}" for k in sorted(zone, key=lambda k: k[1])[:6]]}


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=240)
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--codigos", default=",".join(CODES))
    a = ap.parse_args()
    import elementos_a as oracle  # escrito aparte, sin ver el motor
    out = []
    for code in a.codigos.split(","):
        try:
            rep = compare(a.symbol, code.strip(), a.tf, a.fase, oracle)
        except Exception as error:  # Un elemento que falla no detiene los demás
            rep = {"codigo": code, "error": f"{type(error).__name__}: {error}"}
        out.append(rep)
        if "error" in rep:
            print(f"{code} {a.symbol} {a.tf}m: ERROR {rep['error']}", flush=True)
            continue
        ok = rep["solo_motor"] == rep["solo_oraculo"] == rep["zona_distinta"] == 0
        print(f"{code} {a.symbol} {a.tf}m f{a.fase}: motor {rep['motor']}, oráculo {rep['oraculo']}, iguales {rep['iguales']}"
              + ("" if ok else f" · solo motor {rep['solo_motor']}, solo oráculo {rep['solo_oraculo']}, zona distinta {rep['zona_distinta']}"), flush=True)
        for label in ("ej_solo_motor", "ej_solo_oraculo", "ej_zona"):
            for line in rep[label][:3]:
                print(f"    {label[3:]}: {line}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"comparar_{a.symbol}_{a.tf}_f{a.fase}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
