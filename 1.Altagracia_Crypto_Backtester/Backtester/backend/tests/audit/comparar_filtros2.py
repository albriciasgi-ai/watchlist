"""
Protocolo (22/11/2026), etapa 6: los filtros de Williams y del horario del motor contra el oráculo independiente
(`filtros_a2.py`, escrito aparte desde la documentación, sin ver el motor).

Para cada filtro y modo: las señales de la regla sin él (FVG nuevo 0.3, sin "una posición a la vez") y, para cada una,
si el motor la deja pasar con el filtro (que no salga con el motivo del filtro) contra lo que dice el oráculo en esa vela
y ese lado. Las diferencias se muestran con los valores que mira el oráculo; las de las primeras ARRANQUE velas de la
fase (arranque en frío, H2) van aparte. Para lo que la documentación no decide, cuenta también cuántas señales iguala
cada lectura alternativa (filtros_a2.OPCIONES), una opción distinta de la natural cada vez.

Las reglas son las de la etapa 6 en `reglas_prueba.py` (FL-ALLa … FL-HORA3, y FL-HORA de la etapa 4) y dos horarios
armados aquí, con sus bordes justo en cierres de 4h.

Al final (salvo con --sin-series) compara también, en todas las velas de la fase, las series de Williams que da el
motor (la salida de `rule_tester._bw_series`, usada como caja negra: no se lee su código) con las del oráculo: dice qué
lectura sigue el motor donde las señales no alcanzan a distinguirlas (el ATR) y de dónde sale una diferencia.

Uso (desde backend/): python -B tests/audit/comparar_filtros2.py BTCUSDT [--tf 240] [--fase 1] [--sin-series]
Escribe evidencia/filtros/comparar_filtros2_<MONEDA>_<tf>_f<fase>.json
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

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\filtros")
ARRANQUE = 100            # Velas del principio de la fase cuyas diferencias se cuentan aparte (H2)
MOTIVOS = {"bwf": "filtro de Williams", "hours": "fuera de horario"}
CASOS = ["FL-ALLa", "FL-ALLs", "FL-ALLz", "FL-ZONE", "FL-AOc", "FL-AOz", "FL-AOb", "FL-ACc", "FL-ACz", "FL-ACb",
         "FL-GTe", "FL-GTo", "FL-GTs", "FL-MFIg", "FL-MFIs", "FL-MFIv", "FL-MFIn", "FL-HORA", "FL-HORA2", "FL-HORA3"]
EXTRA = {
    "HORA-bordes": ("FVG de 16:00 a 20:00 UTC (los dos bordes en cierres de 4h)",
                    {"hours": {"on": True, "from": 960, "to": 1200, "weekdays": False}}),
    "HORA-medianoche": ("FVG de 20:00 a 00:00 UTC (cruza la medianoche; los dos bordes en cierres de 4h)",
                        {"hours": {"on": True, "from": 1200, "to": 0, "weekdays": False}}),
}


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def regla_cruda(name, tf):
    if name in EXTRA:
        texto, extra = EXTRA[name]
        raw = rp.rule(f"{name} · {texto}", tf, rp.recipe("FV"), **rp.FV03, **copy.deepcopy(extra))
    elif name == "base":
        raw = rp.rule("FL-base · FVG 0.3 sin filtro", tf, rp.recipe("FV"), **rp.FV03)
    else:
        raw = copy.deepcopy(rp.RULES[name])
    raw["tf"] = tf
    raw["oneAtATime"] = False
    return raw


def correr(symbol, name, tf, phase):
    rule = rt.clean_rule(regla_cruda(name, tf))
    span = rt.detect_span(symbol, tf, phase, rule)
    trace = {}
    rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=False, trace=trace)
    return rule, span, trace


def alternativas(oracle, rule):
    """Las lecturas alternativas que tocan a este filtro: una opción distinta de la natural cada vez."""
    bwf = rule.get("bwf") or {}
    alts = []
    if bwf.get("alligator") in ("awake", "sleeping"):
        alts += [{"atr": a} for a in oracle.OPCIONES["atr"][1:]] + [{"abertura": "minima"}]
    if bwf.get("alligator") == "side":
        alts += [{"dientes": "sin_desplazar"}, {"side_pide": "alligator"}]
    if bwf.get("alligator") or bwf.get("gator"):
        alts.append({"smma": "primera"})
    if any(bwf.get(x) for x in ("zone", "ao", "ac", "gator", "mfi")):
        alts.append({"empate": "estricto"})
    if bwf.get("gator"):
        alts.append({"gator_pide": "la_que_hay"})
    if rule.get("hours"):
        alts += [{"desde": "excluido"}, {"hasta": "excluido"}, {"hora": "apertura"}]
    return alts


# Las series de Williams del motor, como caja negra (la salida de rule_tester._bw_series, sin leer su código), contra las
# del oráculo en todas las velas de la fase. Cómo las da el motor (visto en su salida): NaN sin valor; las direcciones con
# 0 sin dato; la zona NaN sin dato; el tipo del MFI 1 a 4 (green, fade, fake, squat) y 0 sin dato; la barra de abajo
# del Gator con su tamaño (positiva).
SERIES = [("jaw", "mandibula", "num"), ("teeth", "dientes", "num"), ("lips", "labios", "num"),
          ("atr", "atr", "num"), ("ao", "ao", "num"), ("ac", "ac", "num"), ("gUp", "gator_arriba", "num"),
          ("gDown", "gator_abajo", "abs"), ("mfi", "mfi", "num"), ("aoDir", "color_ao", "dir"), ("acDir", "color_ac", "dir"),
          ("gUpDir", "color_arriba", "dir"), ("gDownDir", "color_abajo", "dir"), ("zone", "zona", "zona"),
          ("state", "estado", "estado"), ("mfiType", "tipo_mfi", "mfi")]
MFI_MOTOR = {1: "green", 2: "fade", 3: "fake", 4: "squat"}


def _del_motor(x, tipo):
    if x is None or (isinstance(x, float) and x != x):
        return None
    if tipo == "num":
        return float(x)
    if tipo == "abs":
        return abs(float(x))
    if tipo == "dir":
        return None if int(x) == 0 else int(x)
    if tipo == "mfi":
        return MFI_MOTOR.get(int(x))
    return int(x)   # zona y estado: 0 es gris o dormido


def comparar_series(ws, bars, oracle):
    """Cada serie del motor contra la del oráculo (lectura natural; el ATR también con la lectura "primera")."""
    out = {}
    lecturas = {"": oracle.SeriesWilliams(bars), " (atr=primera)": oracle.SeriesWilliams(bars, {"atr": "primera"})}
    for clave, attr, tipo in SERIES:
        for sufijo, w in lecturas.items():
            if sufijo and clave not in ("atr", "state"):
                continue
            if attr == "zona":
                mia = [w.zona(k) for k in range(len(bars))]
            elif attr == "estado":
                mia = [w.estado(k)[0] for k in range(len(bars))]
            else:
                mia = getattr(w, attr)
            iguales, solo_motor, solo_oraculo, distintas, rel = 0, [], [], [], 0.0
            for k, (x, b) in enumerate(zip(ws[clave], mia)):
                a = _del_motor(x, tipo)
                if a is None and b is None:
                    iguales += 1
                elif b is None:
                    solo_motor.append((k, iso(bars[k]["t"]), a))
                elif a is None:
                    solo_oraculo.append((k, iso(bars[k]["t"]), b))
                elif isinstance(b, float):
                    d = abs(a - b) / max(abs(b), 1e-300)
                    rel = max(rel, d)
                    if d <= 1e-9:
                        iguales += 1
                    else:
                        distintas.append((k, iso(bars[k]["t"]), a, b))
                elif a == b:
                    iguales += 1
                else:
                    distintas.append((k, iso(bars[k]["t"]), a, b))
            out[clave + sufijo] = {"iguales": iguales, "de": len(bars), "dif. relativa máx": rel,
                                   "solo el motor tiene valor": len(solo_motor), "solo el oráculo": len(solo_oraculo),
                                   "distintas": len(distintas), "ejemplos": (solo_motor[:3] + solo_oraculo[:3] + distintas[:3])}
    return out


def _corto(x):
    if isinstance(x, float):
        return float(f"{x:.8g}")
    if isinstance(x, dict):
        return {k: _corto(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_corto(v) for v in x]
    return x


def _texto(p):
    return "pasa" if p is True else ("no" if p is False else "sin dato")


def comparar(symbol, name, tf, phase, signals, bars, base_what, oracle, cache):
    rule, span, trace = correr(symbol, name, tf, phase)
    if len(trace["ctx"]["bars"]) != len(bars):
        raise RuntimeError(f"{name}: las velas del motor ({len(trace['ctx']['bars'])}) no son las de la fase ({len(bars)})")
    reason = MOTIVOS["bwf"] if rule.get("bwf") else MOTIVOS["hours"]
    what = {(s["k"], s["dir"]): s.get("what") for s in trace["signals"]}
    counts = collections.Counter()
    difs, difs_arranque, otros = [], [], []
    alts = alternativas(oracle, rule)
    lecturas = {", ".join(f"{a}={b}" for a, b in o.items()): 0 for o in alts}
    pasan = collections.Counter()
    for k, side in signals:
        w = what.get((k, side), "falta en la corrida")
        engine = w != reason
        ok, det = oracle.evaluar_filtros(symbol, tf, bars, k, side, rule, cache=cache)
        mine = bool(ok)   # Sin dato no pasa, como en la app
        sin_dato = any(v.pasa is None for v in det.values())
        counts[(engine, mine)] += 1
        pasan["motor"] += engine
        pasan["oráculo"] += mine
        pasan["oráculo sin dato"] += sin_dato
        if base_what.get((k, side)) != "trade" or w not in (reason, "trade"):
            otros.append({"k": k, "lado": side, "base": base_what.get((k, side)), "con el filtro": w})
        for o in alts:
            ok2, _ = oracle.evaluar_filtros(symbol, tf, bars, k, side, rule, cache=cache, opciones=o)
            lecturas[", ".join(f"{a}={b}" for a, b in o.items())] += (bool(ok2) == engine)
        if engine != mine:
            item = {"k": k, "vela": iso(bars[k]["t"]), "cierre": iso(bars[k]["t"] + tf * 60000),
                    "lado": "largo" if side > 0 else "corto", "motor": _texto(engine), "oráculo": _texto(ok if not sin_dato else None),
                    "valores": {n: {"pasa": v.pasa, "valor": _corto(v.valor), "motivo": v.motivo} for n, v in det.items()}}
            (difs_arranque if k < ARRANQUE else difs).append(item)
    agree = counts[(True, True)] + counts[(False, False)]
    return {
        "filtro": name, "nombre": rule["name"], "bwf": rule.get("bwf"), "hours": rule.get("hours"), "motivo": reason,
        "señales": len(signals), "iguales": agree,
        "pasa motor, no oráculo": counts[(True, False)], "pasa oráculo, no motor": counts[(False, True)],
        "pasan en el motor": pasan["motor"], "pasan en el oráculo": pasan["oráculo"],
        "sin dato en el oráculo": pasan["oráculo sin dato"],
        "diferencias": difs, f"diferencias en las primeras {ARRANQUE} velas (H2)": difs_arranque,
        "lecturas alternativas (señales iguales al motor)": lecturas,
        "otros motivos": otros,
    }


def imprimir(row):
    n = row["señales"]
    d_arr = row[f"diferencias en las primeras {ARRANQUE} velas (H2)"]
    linea = f"{row['filtro']}: {row['iguales']} de {n} iguales (pasan: motor {row['pasan en el motor']}, oráculo {row['pasan en el oráculo']})"
    if row["iguales"] != n:
        linea += (f" · solo pasa en el motor {row['pasa motor, no oráculo']}, solo en el oráculo {row['pasa oráculo, no motor']}"
                  f" · {len(row['diferencias'])} después del arranque, {len(d_arr)} en las primeras {ARRANQUE} velas")
    print(linea, flush=True)
    alt = row["lecturas alternativas (señales iguales al motor)"]
    if alt:
        print("    lecturas alternativas: " + "; ".join(f"{a}: {v} de {n}" for a, v in alt.items()))
    for e in d_arr + row["diferencias"]:
        vals = "; ".join(f"{k}: {_texto(v['pasa'])} {json.dumps(v['valor'], ensure_ascii=False)}" for k, v in e["valores"].items())
        print(f"    k={e['k']} vela {e['vela']} (cierra {e['cierre']}) {e['lado']}: motor {e['motor']}, oráculo {e['oráculo']} · {vals}"[:700])
    if row["otros motivos"]:
        con = collections.Counter(o["con el filtro"] for o in row["otros motivos"])
        print(f"    señales que en la base no son trade ({len(row['otros motivos'])}), con el filtro: {dict(con)}")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=240)
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--solo", nargs="*", help="solo estos filtros (nombres de CASOS o de EXTRA)")
    ap.add_argument("--sin-series", action="store_true", help="sin comparar las series del motor (caja negra)")
    a = ap.parse_args()
    import filtros_a2 as oracle  # escrito aparte, sin ver el motor
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    rule0, span, base_trace = correr(a.symbol, "base", a.tf, phase)
    bars = span["bars"]   # las velas de la fase, desde su primera vela: el motor calcula los indicadores desde ahí
    if len(base_trace["ctx"]["bars"]) != len(bars) or base_trace["ctx"]["bars"][0]["t"] != bars[0]["t"]:
        raise RuntimeError("las velas del motor no son las de la fase")
    signals = [(s["k"], s["dir"]) for s in base_trace["signals"]]
    base_what = {(s["k"], s["dir"]): s.get("what") for s in base_trace["signals"]}
    print(f"{a.symbol} {a.tf} fase {a.fase} ({phase['from']} a {phase['to']}): {len(bars)} velas, {len(signals)} señales "
          f"del FVG 0.3 (la primera en la vela {signals[0][0] if signals else '—'}); motivos de la base: "
          f"{dict(collections.Counter(base_what.values()))}", flush=True)
    cache = {}
    out = {"moneda": a.symbol, "tf": a.tf, "fase": a.fase, "desde": phase["from"], "hasta": phase["to"], "velas": len(bars),
           "señales": len(signals), "arranque": ARRANQUE, "fábrica del oráculo": oracle.FABRICA, "filtros": []}
    for name in (a.solo or (CASOS + list(EXTRA))):
        row = comparar(a.symbol, name, a.tf, phase, signals, bars, base_what, oracle, cache)
        out["filtros"].append(row)
        imprimir(row)
    total = sum(r["señales"] for r in out["filtros"])
    iguales = sum(r["iguales"] for r in out["filtros"])
    print(f"En total: {iguales} de {total} comparaciones iguales en {len(out['filtros'])} filtros y modos")
    if not a.sin_series:
        try:
            _, _, tr = correr(a.symbol, "FL-ALLa", a.tf, phase)
            ws = rt._bw_series(tr["ctx"])
            out["series del motor (caja negra)"] = comparar_series(ws, bars, oracle)
            print("Series de Williams del motor (caja negra) contra el oráculo, en todas las velas:")
            for clave, r in out["series del motor (caja negra)"].items():
                extra = "" if r["iguales"] == r["de"] else f" · ejemplos {r['ejemplos'][:3]}"
                print(f"    {clave}: {r['iguales']} de {r['de']} iguales (dif. relativa máx {r['dif. relativa máx']:.2g}; "
                      f"solo el motor {r['solo el motor tiene valor']}, solo el oráculo {r['solo el oráculo']}, distintas {r['distintas']}){extra}"[:400])
        except Exception as e:  # la comparación de las series no detiene la de los filtros
            out["series del motor (caja negra)"] = {"error": repr(e)}
            print("No se pudieron comparar las series del motor:", repr(e))
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"comparar_filtros2_{a.symbol}_{a.tf}_f{a.fase}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print(f"Escrito {path}")


if __name__ == "__main__":
    main()
