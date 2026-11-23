"""
Protocolo (22/11/2026), etapa 6, F-01 (anotado en la etapa 3): con "esperar N velas tras cerrar" y una posición a la vez, ¿el enfriamiento
descarta señales del comienzo de la fase sin un trade antes? Corre R01 con esperar 8 y lista las señales descartadas
por enfriamiento antes del primer trade. Solo lee. Correr desde backend/.

Uso: python -B tests/audit/enfriamiento_inicio.py DOGEUSDT BTCUSDT ...
"""
import sys, copy, datetime as dt
sys.path.insert(0, "."); sys.path.insert(0, "tests/audit")
import rule_tester as rt, reglas_prueba as rp, invariantes as inv
sys.stdout.reconfigure(encoding="utf-8")
for sym in sys.argv[1:]:
    rule = copy.deepcopy(rp.RULES["R01"]); rule["cooldown"] = 8
    rule = rt.clean_rule(rule)
    phase = inv.phase_of(sym, 1)
    span = rt.detect_span(sym, rule["tf"], phase, rule)
    trace = {}
    res = inv.run(sym, rule, span, phase, trace=trace)
    T = [b["t"] for b in span["bars"]]
    first_trade_k = min((s["k"] for s in trace["signals"] if s.get("what") == "trade"), default=None)
    early = [(s["k"], s["dir"], s["what"]) for s in trace["signals"] if s["what"] == "enfriamiento" and (first_trade_k is None or s["k"] < first_trade_k)]
    print(sym, "cooldown", rule["cooldown"], "· enfriamiento antes del primer trade:", [(k, d, w, dt.datetime.utcfromtimestamp(T[k] / 1000).strftime("%Y-%m-%d %H:%M")) for k, d, w in early], "· primer trade en k", first_trade_k, "· trades", len(res["trades"]))
