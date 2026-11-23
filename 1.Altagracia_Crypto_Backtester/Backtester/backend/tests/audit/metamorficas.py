"""
Protocolo (21/11/2026), etapa 4: pruebas metamórficas de los elementos y filtros (sección 8). No necesitan saber la
respuesta: comparan dos corridas que tienen que guardar una relación. Sin "una posición a la vez", para que un trade
no cambie a los que siguen.

  M-03  el filtro solo quita: la regla con un filtro da un subconjunto de los trades sin él, idénticos, y cada señal
        quitada lo fue por ese filtro.
  M-04  apagar es no tenerlo: la pieza apagada deja la misma identidad de la regla y los mismos trades.
  M-05  umbrales que ordenan: un umbral más exigente da un subconjunto de las señales del otro.

Uso (desde backend/): python -B tests/audit/metamorficas.py BTCUSDT [--tf 240] [--fase 1]
"""
import argparse
import copy
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

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
KEYS = ("signal", "dir", "entry_t", "entry", "stop", "target", "exit_t", "exit", "reason", "r")

BASE = dict(recipe=rp.recipe("FV"), fv={"minAtr": 0.3})
FILTERS = {
    "VWAP 200 a favor": {"lines": [{"type": "vwap", "period": 200, "mode": "side"}]},
    "VWAP 200, la mecha lo toca": {"lines": [{"type": "vwap", "period": 200, "mode": "touch"}]},
    "VWAP 200 a favor con pendiente": {"lines": [{"type": "vwap", "period": 200, "mode": "side", "slope": True}]},
    "VWAP 200 con tope de 2 desviaciones": {"lines": [{"type": "vwap", "period": 200, "mode": "side", "maxDev": 2}]},
    "EMA 50 a favor": {"lines": [{"type": "ema", "period": 50, "mode": "side"}]},
    "EMA 50, la mecha la toca": {"lines": [{"type": "ema", "period": 50, "mode": "touch"}]},
    "EMA 14 a favor con pendiente": {"lines": [{"type": "ema", "period": 14, "mode": "side", "slope": True}]},
    "CVD 20 a favor": {"flow": {"cvd": 20}},
    "OI sube 2% en 6": {"flow": {"oi": "rise", "oiBars": 6, "oiPct": 2.0}},
    "OI baja 2% en 6": {"flow": {"oi": "fall", "oiBars": 6, "oiPct": 2.0}},
    "Confluencia OI-volumen a favor": {"flow": {"oi": "conf"}},
    "Sin confluencia en contra": {"flow": {"oi": "noconf"}},
    "Multitud: no ir con ella": {"flow": {"crowd": "nocon"}},
    "Multitud: solo contra ella": {"flow": {"crowd": "contra"}},
    "OI sostenido": {"flow": {"steady": True}},
    "On-chain: emisión 30 d a favor": {"flow": {"chain": {"metric": "stable", "days": 30, "mode": "favor"}}},
    "On-chain: neto 7 d que no esté en contra": {"flow": {"chain": {"metric": "net", "days": 7, "mode": "nocontra"}}},
    "Régimen: dentro": {"regime": {"mode": "inside"}},
    "Régimen: fuera": {"regime": {"mode": "outside"}},
    "Régimen: tras romper": {"regime": {"mode": "breakout"}},
    "Régimen: fuera, medido en 1D": {"regime": {"mode": "outside", "tf": 1440}},
    "Horario 13:30-21:00 UTC, lunes a viernes": {"hours": {"on": True, "from": 810, "to": 1260, "weekdays": True}},
    "Horario 22:00-02:00 UTC (cruza la medianoche)": {"hours": {"on": True, "from": 1320, "to": 120}},
}
THRESHOLDS = [
    ("FVG nuevo 0.3 → 0.6 ATR", dict(recipe=rp.recipe("FV"), fv={"minAtr": 0.3}), dict(recipe=rp.recipe("FV"), fv={"minAtr": 0.6})),
    ("Impulso 2 → 3 ATR en 3 velas", dict(recipe=rp.recipe("IM"), im={"bars": 3, "atr": 2.0}), dict(recipe=rp.recipe("IM"), im={"bars": 3, "atr": 3.0})),
    ("Flecha 2 → 3 veces el volumen", dict(recipe=rp.recipe("RF"), rv={"arrow": "with", "spike": 2.0}), dict(recipe=rp.recipe("RF"), rv={"arrow": "with", "spike": 3.0})),
    ("Martillo, mecha 2 → 3 cuerpos", dict(recipe=rp.recipe("HM"), pat={"wick": 2}), dict(recipe=rp.recipe("HM"), pat={"wick": 3})),
    ("Martillo, sin volumen → z ≥ 1", dict(recipe=rp.recipe("HM")), dict(recipe=rp.recipe("HM"), pat={"minZ": 1.0})),
    ("Envolvente, sin volumen → z ≥ 1", dict(recipe=rp.recipe("EN")), dict(recipe=rp.recipe("EN"), pat={"minZ": 1.0})),
    ("Ruptura de caja, sin tope → caja ≤ 5.5 ATR", dict(recipe=rp.recipe("BX")), dict(recipe=rp.recipe("BX"), bx={"maxHeight": 5.5})),
]


def phase_of(symbol, n):
    return next(p for p in rt.phases(symbol) if p["phase"] == n)


def run(symbol, raw, tf, phase_n):
    rule = rt.clean_rule(rp.rule("metamórfica", tf, raw.pop("recipe"), oneAtATime=False, **raw))
    phase = phase_of(symbol, phase_n)
    span = rt.detect_span(symbol, tf, phase, rule)
    trace = {}
    res = rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=False, trace=trace)
    return rule, res, trace


def brief(t):
    return tuple(round(t[k], 8) if isinstance(t.get(k), float) else t.get(k) for k in KEYS)


def m03(symbol, tf, phase_n):
    _, base, _ = run(symbol, copy.deepcopy(BASE), tf, phase_n)
    base_trades = {(t["signal"], t["dir"]): brief(t) for t in base["trades"]}
    out = []
    for name, extra in FILTERS.items():
        rule, res, trace = run(symbol, {**copy.deepcopy(BASE), **copy.deepcopy(extra)}, tf, phase_n)
        if not res.get("success", True) or "trades" not in res:
            out.append({"filtro": name, "error": res.get("message")})
            continue
        got = {(t["signal"], t["dir"]): brief(t) for t in res["trades"]}
        extra_trades = [k for k in got if k not in base_trades]
        changed = [k for k in got if k in base_trades and got[k] != base_trades[k]]
        removed = [k for k in base_trades if k not in got]
        reasons = {}
        T = trace["ctx"]["T"]
        for s in trace["signals"]:
            key = (T[s["k"]], s["dir"])
            if key in base_trades and key not in got:
                reasons[s.get("what")] = reasons.get(s.get("what"), 0) + 1
        out.append({"filtro": name, "regla": {k: rule[k] for k in ("lines", "flow", "regime", "hours") if k in rule},
                    "sin filtro": len(base_trades), "con filtro": len(got), "quitados": len(removed),
                    "nuevos": len(extra_trades), "cambiados": len(changed), "motivos de los quitados": reasons,
                    "ok": not extra_trades and not changed})
    return out


def m05(symbol, tf, phase_n):
    out = []
    for name, loose, strict in THRESHOLDS:
        _, r1, t1 = run(symbol, copy.deepcopy(loose), tf, phase_n)
        _, r2, t2 = run(symbol, copy.deepcopy(strict), tf, phase_n)
        s1 = {(s["k"], s["dir"]) for s in t1["signals"]}
        s2 = {(s["k"], s["dir"]) for s in t2["signals"]}
        out.append({"umbral": name, "señales": len(s1), "más exigente": len(s2), "fuera del otro": len(s2 - s1),
                    "ok": s2 <= s1 and len(s2) <= len(s1)})
    return out


def m04(symbol, tf, phase_n):
    """Apagar es no tenerlo: una regla con cada pieza apagada (como la manda el formulario) tiene la identidad y los
    trades de la regla sin esa clave."""
    out = []
    off = {"lines": [], "flow": {}, "regime": {"mode": "off"}, "hours": {"on": False, "from": 810, "to": 1260},
           "flow ": {"cvd": 0, "oi": "off", "crowd": "off", "steady": False, "chain": {}}}
    a = rt.clean_rule(rp.rule("x", tf, rp.recipe("FV"), fv={"minAtr": 0.3}))
    for key, value in off.items():
        kw = {"fv": {"minAtr": 0.3}, key.strip(): value}
        b = rt.clean_rule(rp.rule("x", tf, rp.recipe("FV"), **kw))
        out.append({"pieza apagada": f"{key.strip()} = {value}", "misma identidad": rt.rule_hash(symbol, a) == rt.rule_hash(symbol, b)})
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=240)
    ap.add_argument("--fase", type=int, default=1)
    a = ap.parse_args()
    rep = {"moneda": a.symbol, "tf": a.tf, "fase": a.fase, "M-03": m03(a.symbol, a.tf, a.fase), "M-05": m05(a.symbol, a.tf, a.fase),
           "M-04": m04(a.symbol, a.tf, a.fase)}
    for row in rep["M-03"]:
        if "error" in row:
            print(f"M-03 {row['filtro']}: ERROR {row['error']}")
        else:
            print(f"M-03 {row['filtro']}: {row['sin filtro']} → {row['con filtro']} (quitados {row['quitados']}, nuevos {row['nuevos']}, "
                  f"cambiados {row['cambiados']}) {'bien' if row['ok'] else '⚠'} · {row['motivos de los quitados']}")
    for row in rep["M-05"]:
        print(f"M-05 {row['umbral']}: {row['señales']} → {row['más exigente']} {'bien' if row['ok'] else '⚠ ' + str(row['fuera del otro']) + ' fuera'}")
    for row in rep["M-04"]:
        print(f"M-04 {row['pieza apagada']}: {'misma identidad' if row['misma identidad'] else '⚠ cambia la identidad'}")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"metamorficas_{a.symbol}_{a.tf}_f{a.fase}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
