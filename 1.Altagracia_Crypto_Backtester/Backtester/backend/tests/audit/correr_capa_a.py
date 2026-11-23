"""
Corre la capa A (oráculos contra el motor) de una regla de prueba y guarda el informe en la evidencia.

Uso (desde backend/, con el entorno de la copia aislada):
    python -B tests/audit/correr_capa_a.py R01 BTCUSDT 1 [--sin-b] [--sin-controles]
Las reglas de prueba están en reglas_prueba.py.
"""
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parents[1]))

import comparar as cmp  # noqa: E402
import reglas_prueba as rp  # noqa: E402

# AUDIT_OUT cambia la carpeta (etapa 7: evidencia/etapa7/capa_a, para no pisar la de las etapas 3 a 6)
OUT = cmp.oa.Path(os.environ.get("AUDIT_OUT", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\capa_a"))


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    name, symbol, phase = argv[0], argv[1], int(argv[2])
    use_b = "--sin-b" not in argv
    who = ("rule",) if "--sin-controles" in argv else ("rule", "control")
    if name.startswith("RUN:"):
        # Etapa 5: la regla de una corrida guardada del usuario (su moneda y su fase van en el id)
        run_id = name[4:]
        rule = cmp.rt.load_run(run_id)["rule"]
        name = "E5_" + run_id
    else:
        rule = rp.RULES[name]
    OUT.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    cap = cmp.capture(symbol, rule, phase)
    rep = cmp.compare_calls(cap, who=who, use_b=use_b)
    rep["atr"] = cmp.atr_check(cap)
    res = cap["result"]
    rep["summary"] = res.get("summary")
    rep["signals"], rep["skipped"], rep["busy"], rep["open"] = res.get("signals"), res.get("skipped"), res.get("busy"), res.get("open")
    # Selección: la misma regla sin "una posición a la vez" da todas las señales simuladas
    if cap["rule"].get("oneAtATime"):
        cap_all = cmp.capture(symbol, rule, phase, one_at_a_time=False, span=cap["span"], base=False)
        rep["selection"] = cmp.selection_check(cap_all, cap)
    # Variantes de diseño (solo trades de la regla)
    rep["variants"] = {}
    for vname, variant in (("h4", {"h4": True}), ("h5", {"h5": True}), ("fillbar_target", {"fillbar_target": True}), ("h12", {"h12": True})):
        changed, delta = 0, 0.0
        for call in cap["calls"]:
            if call["who"] != "rule" or call["out"] is None or "skip" in call["out"] or call["out"].get("open"):
                continue
            base = cmp.replay_call(cap, call)
            alt = cmp.replay_call(cap, call, variant)
            if base and alt and "r" in base and "r" in alt and abs(base["r"] - alt["r"]) > 1e-9:
                changed += 1
                delta += alt["r"] - base["r"]
        rep["variants"][vname] = {"trades_changed": changed, "sum_delta_r": round(delta, 4)}
    rep["seconds_total"] = round(time.time() - t0, 1)
    path = OUT / f"{name}_{symbol}_f{phase}.json"
    path.write_text(cmp.to_json(rep), encoding="utf-8")
    s = rep["summary"] or {}
    print(f"{name} {symbol} f{phase}: {s.get('n')} trades, avgR {s.get('avgR')}; llamadas {rep['calls']} {rep['by_who']}")
    print(f"  A distinto: {rep['mismatch_a'] or 'nada'}  B distinto: {rep['mismatch_b'] or ('nada' if use_b else 'sin B')}")
    print(f"  ATR máx. dif. relativa {rep['atr']['max_rel']:.2e}; selección: {rep.get('selection')}")
    print(f"  variantes: {rep['variants']}; {rep['seconds_total']} s -> {path}")


if __name__ == "__main__":
    main(sys.argv[1:])
