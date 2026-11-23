"""
Protocolo (22/11/2026), etapa 6: pasos de la hoja Chequeo que se comprueban mejor en el motor que a mano.

  p49  dos órdenes stop sin minutos (DOGE 4h f1, R06b): en las velas de llenado que tocan las dos órdenes, ¿entra la que
       el recorrido supuesto (apertura, extremo más cercano, el otro, cierre) toca primero? (confusión 18)
  p56  stop muy corto (DOGE 5m f1, martillo con stop en la vela del elemento): señales "stop muy corto" (confusión 20)
  p66  salida por la línea central del canal (BTC 4h f1, E-GC con exit "mid"): cada "sale del canal" sale en la apertura
       siguiente al primer cierre al otro lado de la línea central, recalculada con gaussian_channel.channel
  p72  OI de 4 horas en una regla de 15m (ETH 15m f1, FVG con OI que sube 2% en 6 velas): trades y descartes
  p18  frecuencia de los elementos relativos (ARB 15m f1, E-EX): eventos y trades con 0.05 y con 0.02

Uso: python -B tests/audit/pasos_motor.py p49 p56 p66 p72 p18
Escribe evidencia/etapa6/pasos_motor.json (junta con lo que ya había)
"""
import bisect
import copy
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import rule_tester as rt  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import invariantes as inv  # noqa: E402
import gaussian_channel as gch  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6\pasos_motor.json")


def corrida(name, symbol, tf=None, phase_n=1, edit=None, trace=None):
    rule = copy.deepcopy(rp.RULES[name])
    if tf is not None:
        rule["tf"] = tf
    if edit:
        edit(rule)
    rule = rt.clean_rule(rule)
    phase = inv.phase_of(symbol, phase_n)
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    res = inv.run(symbol, rule, span, phase, trace=trace)
    return rule, span, res


def p49():
    rule, span, res = corrida("R06b", "DOGEUSDT")
    bars = span["bars"]
    T = [b["t"] for b in bars]
    ctx = rt._context("DOGEUSDT", rule["tf"], bars)
    off = rule["entry"]["offset"]
    both, ok, bad = 0, 0, []
    for t in res["trades"]:
        k = bisect.bisect_right(T, t["signal"]) - 1
        j = bisect.bisect_right(T, t["entry_t"]) - 1
        up, dn = ctx["C"][k] + off * ctx["atr"][k], ctx["C"][k] - off * ctx["atr"][k]
        b = bars[j]
        if not (b["h"] >= up and b["l"] <= dn):
            continue
        both += 1
        # Recorrido supuesto: apertura, el extremo más cercano a la apertura, el otro, cierre
        path = [b["o"]] + ([b["h"], b["l"]] if b["h"] - b["o"] < b["o"] - b["l"] else [b["l"], b["h"]]) + [b["c"]]
        first = None
        if b["o"] >= up:
            first = 1
        elif b["o"] <= dn:
            first = -1
        else:
            for p in path[1:]:
                if p >= up:
                    first = 1
                    break
                if p <= dn:
                    first = -1
                    break
        if first == t["dir"]:
            ok += 1
        else:
            bad.append({"n": t["n"], "dir": t["dir"], "esperado": first, "vela": T[j], "o": b["o"], "h": b["h"], "l": b["l"], "arriba": up, "abajo": dn})
    return {"regla": "R06b", "moneda": "DOGEUSDT", "trades": len(res["trades"]), "velas_que_tocan_las_dos": both, "como_el_recorrido": ok, "distintas": bad[:10]}


def p56():
    # Con margen 0.1 ATR el riesgo nunca baja de 0.1 ATR (el mínimo): el "stop muy corto" solo puede salir con menos margen
    out = {}
    for buffer in (0.1, 0.0):
        def edit(rule, buffer=buffer):
            rule["stop"] = {"type": "candle", "buffer": buffer}
        for sym in ("DOGEUSDT", "ARBUSDT"):
            rule, span, res = corrida("E-HM", sym, tf=5, edit=edit)
            out[f"{sym} margen {buffer}"] = {"trades": len(res["trades"]), "señales": res["signals"], "motivos": res["skipped"], "minAtr": rule["stop"]["minAtr"]}
    return out


def p66():
    def edit(rule):
        rule["gc"]["exit"] = "mid"
    rule, span, res = corrida("E-GC", "BTCUSDT", edit=edit)
    bars = span["bars"]
    T = [b["t"] for b in bars]
    g = rule["gc"]
    mid, _, _ = gch.channel(span.get("warm", []) + bars, g["period"], g["poles"], g["mult"])
    mid = mid[len(span.get("warm", [])):]
    reasons = {}
    for t in res["trades"]:
        reasons[t["reason"]] = reasons.get(t["reason"], 0) + 1
    checked, ok, bad = 0, 0, []
    for t in res["trades"]:
        if t["reason"] != "sale del canal":
            continue
        checked += 1
        i0 = bisect.bisect_right(T, t["entry_t"]) - 1
        cross = next((j for j in range(i0, len(bars)) if (bars[j]["c"] < mid[j] if t["dir"] > 0 else bars[j]["c"] > mid[j])), None)
        want = T[cross + 1] if cross is not None and cross + 1 < len(bars) else None
        if want == t["exit_t"] and abs(t["exit"] - bars[cross + 1]["o"]) < 1e-9:
            ok += 1
        else:
            bad.append({"n": t["n"], "dir": t["dir"], "salida": t["exit_t"], "esperada": want, "precio": t["exit"]})
    return {"regla": "E-GC con salida en la línea central", "trades": len(res["trades"]), "motivos": reasons,
            "salidas_por_el_canal": checked, "iguales": ok, "distintas": bad[:10]}


def p72():
    out = {}
    for sym, tf in (("ETHUSDT", 15), ("BTCUSDT", 240)):
        rule, span, res = corrida("FL-OI", sym, tf=tf)
        out[f"{sym} {tf}m"] = {"trades": len(res["trades"]), "señales": res["signals"], "motivos": res["skipped"]}
    return out


def p18():
    out = {}
    for target in (0.05, 0.02):
        def edit(rule, target=target):
            rule["target"] = target
        t0 = time.time()
        rule, span, res = corrida("E-EX", "ARBUSDT", edit=edit)
        ev = sum(1 for e in span["events"] if e["code"] == "EX")
        out[str(target)] = {"eventos_EX": ev, "trades": len(res["trades"]), "señales": res["signals"], "segundos": round(time.time() - t0, 1)}
    return out


def main(args):
    sys.stdout.reconfigure(encoding="utf-8")
    data = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for name in args:
        t0 = time.time()
        rep = globals()[name]()
        data[name] = rep
        OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
        print(name, json.dumps(rep, ensure_ascii=False, default=str)[:900], f"· {time.time() - t0:.0f} s", flush=True)


if __name__ == "__main__":
    main(sys.argv[1:])
