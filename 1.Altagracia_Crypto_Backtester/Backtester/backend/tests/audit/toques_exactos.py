"""
Protocolo (22/11/2026), etapa 6: toques exactos de un nivel y el ruido de coma flotante.

El espejo y la escala (M-01, M-02) cambiaron 2 de 2,761 trades de R35-5 en ARB y 1 de 440 de R34-60 en AAPL: en los
dos, un máximo de la vela es exactamente el stop o el objetivo (0.9602 contra 0.9601999999999998). El motor compara sin
tolerancia, así que un toque exacto cuenta o no según hacia dónde caiga el ruido del cálculo del nivel.

Este script cuenta, en las velas de cada trade (de la entrada a la salida, sin minutos), las que llegan al stop o al
objetivo a menos de 1e-9 relativo: las que el motor cuenta como toque y las que no (las que "se pierde").

Uso: python -B tests/audit/toques_exactos.py REGLA MONEDA [REGLA MONEDA ...]
Escribe evidencia/etapa6/toques_exactos.json (junta con lo que ya había)
"""
import bisect
import copy
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import rule_tester as rt  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import invariantes as inv  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6\toques_exactos.json")
TOL = 1e-9


def check(name, symbol):
    rule = rt.clean_rule(copy.deepcopy(rp.RULES[name]))
    phase = inv.phase_of(symbol, 1)
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    res = inv.run(symbol, rule, span, phase, no_minutes=True)
    T = [b["t"] for b in span["bars"]]
    idx = {t: i for i, t in enumerate(T)}
    H = [b["h"] for b in span["bars"]]
    L = [b["l"] for b in span["bars"]]
    counted, missed, examples = 0, 0, []
    for t in res["trades"]:
        # La vela que contiene cada hora (las acciones empiezan a las :30, no a la hora en punto)
        i0, i1 = bisect.bisect_right(T, t["entry_t"]) - 1, bisect.bisect_right(T, t["exit_t"]) - 1
        if i0 < 0 or i1 < i0:
            continue
        side = t["dir"]
        for i in range(i0, i1 + 1):
            for what, lv in (("stop", t["stop"]), ("objetivo", t.get("target"))):
                if lv is None:
                    continue
                ext = L[i] if (what == "stop") == (side > 0) else H[i]  # el extremo que llega al nivel
                if abs(ext - lv) <= TOL * abs(lv):
                    hit = (ext <= lv) if (what == "stop") == (side > 0) else (ext >= lv)
                    if hit:
                        counted += 1
                    else:
                        missed += 1
                        if len(examples) < 6:
                            examples.append({"n": t["n"], "dir": side, "vela": T[i], "nivel": what, "valor": lv, "extremo": ext,
                                             "salida": t["exit_t"], "motivo": t["reason"], "r": t["r"]})
    return {"regla": name, "moneda": symbol, "trades": len(res["trades"]), "toques_exactos_contados": counted,
            "toques_exactos_perdidos": missed, "ejemplos": examples}


def main(args):
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for name, symbol in zip(args[::2], args[1::2]):
        rep = check(name, symbol)
        data[f"{name}|{symbol}"] = rep
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"{name} {symbol}: {rep['trades']} trades · toques exactos contados {rep['toques_exactos_contados']}, perdidos {rep['toques_exactos_perdidos']}", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
