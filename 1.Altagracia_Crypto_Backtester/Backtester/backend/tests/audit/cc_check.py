"""
Protocolo (22/11/2026), etapa 6: el cambio de carácter (CC, nivel B), con sus condiciones necesarias recalculadas
aparte.

Desde la documentación (CLAUDE.md de App 1, "Cambio de carácter, CC (18/11, structure.py)" y lo medido debajo), sin
usar structure.py ni la parte del probador que arma los eventos de CC:
- velas de la estructura: las de la regla unidas en velas de `cc.tf` minutos que empiezan a `cc.offset` minutos de las
  00:00 UTC; una vela de estructura incompleta (le falta alguna vela de la regla) no dispara;
- swing: el único extremo de su ventana, `cc.swing` velas por lado; se conoce al cerrar la última de su derecha;
- tendencia: `cc.legs` máximos y mínimos seguidos en la misma dirección (swings crecientes: tendencia alcista);
- ruptura: la vela de estructura que cierra más allá del último swing contrario: bajo el último mínimo tras una
  tendencia alcista abre un corto; sobre el último máximo tras una bajista, un largo;
- el evento se conoce al cerrar esa vela de estructura y cae en la vela de la regla que cierra a esa hora;
- cada swing dispara una vez;
- zona: del cierre de la ruptura al extremo de la tendencia; el stop "borde lejano de la zona" queda detrás del extremo.

Lo que la documentación no decide se mide con cada lectura posible:
- `incompletas` (INCOMPLETE_MODES): "fuera" (las velas de estructura incompletas no entran a la serie), "dentro"
  (entran a los swings, pero no disparan), "final" (solo no dispara la que no llegó a su última vela de la regla) o
  "todas" (todas disparan). En los datos reales casi no hay incompletas, así que dos pruebas metamórficas (en las reglas
  con la estructura en un marco mayor) las crean: quitan de la vela de estructura de cada ruptura una vela de la regla
  de en medio, o la última, sin tocar su máximo ni su mínimo, y vuelven a correr el motor;
- `subidas`: con `legs` = 2, "legs-1" (dos máximos y dos mínimos crecientes: una subida de cada uno) o "legs" (dos
  subidas de cada uno, tres swings);
- `conocido`: los swings que cuentan en la ruptura son los confirmados al cerrar una vela anterior a la ruptura
  ("antes") o también los que confirma la misma vela de la ruptura ("al cierre");
- `disparo`: el swing dispara solo con el primer cierre más allá ("primero": si en ese cierre no hay tendencia, el swing
  se gasta) o con cualquier cierre más allá mientras siga siendo el último swing de su lado ("cualquiera");
- `alterna`: si hace falta que el último swing del otro lado sea posterior al swing roto (el último máximo después del
  último mínimo, en un corto);
- `extremo`: el más alto (en un corto) de las velas de estructura del swing roto a la ruptura, del swing roto a la vela
  anterior a la ruptura, el último máximo confirmado, o desde el primer swing de la tendencia.
La reconstrucción completa de los eventos con cada combinación dice cuál sigue el motor.

Las velas son las del motor (rule_tester.detect_span(...)["bars"]); los eventos, señales y trades, los de
rule_tester.run(..., trace={}) (solo para leerlos).

Uso (desde backend/): python -B tests/audit/cc_check.py BTCUSDT,ARBUSDT [--reglas E-CC,E-CC15] [--fase 1]
Escribe evidencia/elementos/cc_check_<MONEDA>_<tf>_f<fase>.json
"""
import argparse
import collections
import datetime as dt
import itertools
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402  (solo para correr la regla y leer sus velas, eventos, señales y trades)

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
MAX_EX = 12
TOL = 1e-9


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def same(a, b, tol=TOL):
    return a is not None and b is not None and abs(a - b) <= tol * max(1.0, abs(a), abs(b))


def side_text(d):
    return "largo" if d > 0 else "corto"


class Tally:
    """Cuenta por condición: cuántos cumplen de cuántos, con hasta MAX_EX ejemplos de cada falla."""

    def __init__(self):
        self.data = collections.OrderedDict()

    def add(self, name, ok, example=None):
        row = self.data.setdefault(name, {"cumplen": 0, "de": 0, "fallas": []})
        row["de"] += 1
        if ok:
            row["cumplen"] += 1
        elif example is not None and len(row["fallas"]) < MAX_EX:
            row["fallas"].append(example)

    def out(self):
        return {k: {"cumplen": v["cumplen"], "de": v["de"], **({"fallas": v["fallas"]} if v["fallas"] else {})}
                for k, v in self.data.items()}


def structure(bars, tf_rule, tf_struct, offset):
    """Velas de la estructura (todas, también las incompletas), en orden. complete: tiene todas sus velas de la regla."""
    size, off, step = tf_struct * 60000, offset * 60000, tf_rule * 60000
    need = tf_struct // tf_rule
    out, cur = [], None
    for b in bars:
        key = (b["t"] - off) // size * size + off
        if cur is None or cur["t"] != key:
            cur = {"t": key, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"], "n": 0, "last": b["t"]}
            out.append(cur)
        cur["h"] = max(cur["h"], b["h"])
        cur["l"] = min(cur["l"], b["l"])
        cur["c"] = b["c"]
        cur["n"] += 1
        cur["last"] = b["t"]
    for s in out:
        s["complete"] = s["n"] == need and s["last"] == s["t"] + size - step
        s["ends"] = s["last"] == s["t"] + size - step   # llegó a su última vela de la regla
    return out


def swings(series, n):
    """Índices de los máximos y mínimos que son el único extremo de su ventana de n velas por lado."""
    H = [s["h"] for s in series]
    L = [s["l"] for s in series]
    highs, lows = [], []
    for p in range(n, len(series) - n):
        w = H[p - n:p + n + 1]
        if H[p] == max(w) and w.count(H[p]) == 1:
            highs.append(p)
        w = L[p - n:p + n + 1]
        if L[p] == min(w) and w.count(L[p]) == 1:
            lows.append(p)
    return highs, lows


def rises(values, d):
    """Cuántas subidas (d = -1, tendencia alcista) o bajadas (d = 1, bajista) estrictas seguidas terminan en el último."""
    count = 0
    for a, b in zip(reversed(values[:-1]), reversed(values[1:])):
        if (b > a) if d < 0 else (b < a):
            count += 1
        else:
            break
    return count


def known_upto(idx, n, lim):
    """Los swings (índices ordenados) confirmados al cerrar la vela lim o antes."""
    return [p for p in idx if p + n <= lim]


INCOMPLETE_MODES = {
    "fuera": "las incompletas no entran a la serie",
    "dentro": "entran a los swings, pero no disparan",
    "final": "solo no dispara la que no llegó a su última vela de la regla (la que falta en medio no cuenta)",
    "todas": "cualquier vela de estructura dispara",
}


def rebuild(series, n, legs, mode, antes, need_rises, primero, alterna):
    """Todos los eventos CC con una combinación de lecturas: [(lado, vela de la ruptura, vela del swing)]."""
    ser = [s for s in series if s["complete"]] if mode == "fuera" else series
    H = [s["h"] for s in ser]
    L = [s["l"] for s in ser]
    C = [s["c"] for s in ser]
    highs, lows = swings(ser, n)
    out, fired, used = [], set(), set()
    kh, kl, ih, il = [], [], 0, 0
    for i in range(len(ser)):
        lim = i - 1 if antes else i
        while ih < len(highs) and highs[ih] + n <= lim:
            kh.append(highs[ih])
            ih += 1
        while il < len(lows) and lows[il] + n <= lim:
            kl.append(lows[il])
            il += 1
        if mode in ("fuera", "dentro") and not ser[i]["complete"]:
            continue  # Con "dentro", la vela incompleta da swings pero no dispara ni gasta un swing
        if mode == "final" and not ser[i]["ends"]:
            continue
        for d in (-1, 1):
            own = kl if d < 0 else kh        # el swing que se rompe: el último mínimo en un corto
            other = kh if d < 0 else kl
            if not own:
                continue
            p = own[-1]
            if (d, p) in fired or (d, p) in used:
                continue
            level = L[p] if d < 0 else H[p]
            if not (C[i] < level if d < 0 else C[i] > level):
                continue
            vals_own = [L[q] for q in own] if d < 0 else [H[q] for q in own]
            vals_other = [H[q] for q in other] if d < 0 else [L[q] for q in other]
            ok = rises(vals_own, d) >= need_rises and rises(vals_other, d) >= need_rises
            if ok and alterna:
                ok = bool(other) and other[-1] > p
            if ok:
                out.append((d, ser[i]["t"], ser[p]["t"]))
                fired.add((d, p))
            elif primero:
                used.add((d, p))
    return out


def compare_rebuild(full, n, legs, engine, modes=tuple(INCOMPLETE_MODES)):
    """Los eventos reconstruidos con cada combinación de lecturas contra los del motor, de la más parecida a la menos."""
    combos = []
    for mode, antes, rl, primero, alterna in itertools.product(modes, (True, False), ("legs-1", "legs"), (True, False), (False, True)):
        need = legs - 1 if rl == "legs-1" else legs
        mine = set(rebuild(full, n, legs, mode, antes, need, primero, alterna))
        only_mine, only_eng = sorted(mine - engine), sorted(engine - mine)
        combos.append({
            "lectura": {"incompletas": mode, "conocido": "antes" if antes else "al cierre", "subidas": rl,
                        "disparo": "primero" if primero else "cualquiera", "alterna": alterna},
            "recalculados": len(mine), "iguales": len(mine & engine), "solo_recalculados": len(only_mine), "solo_motor": len(only_eng),
            "ejemplos_solo_recalculados": [{"ruptura": iso(b), "lado": side_text(d), "swing": iso(p)} for d, b, p in only_mine[:MAX_EX]],
            "ejemplos_solo_motor": [{"ruptura": iso(b), "lado": side_text(d), "swing": iso(p)} for d, b, p in only_eng[:MAX_EX]],
        })
    combos.sort(key=lambda c: (c["solo_recalculados"] + c["solo_motor"], c["solo_motor"]))
    return combos


def metamorphic(symbol, rule, span, phase, events, full, which="middle"):
    """
    "Una vela de estructura incompleta no dispara", a prueba. En la vela de estructura de cada ruptura del motor se
    quita una vela de la regla que no tiene el máximo ni el mínimo de la vela de estructura:
    - which="middle": una de en medio (ni la primera ni la última): la vela de estructura conserva su apertura, máximo,
      mínimo y cierre, y solo queda incompleta;
    - which="last": la última, solo donde la penúltima también cierra más allá del swing (la ruptura sigue con el
      cierre nuevo): la vela de estructura no llega a su última vela de la regla.
    Según la documentación, ese evento desaparece. Se corre el motor con esas velas y se compara con la reconstrucción
    en cada lectura de las incompletas (las demás lecturas, todas).
    """
    tf_ms, S = rule["tf"] * 60000, rule["cc"]["tf"] * 60000
    bars = span["bars"]
    at = {b["t"]: b for b in bars}
    by_start = {s["t"]: s for s in full}
    drop, touched = set(), []
    for e in events:
        st = by_start.get(e["info"]["breakT"])
        if st is None or not st["complete"]:
            continue
        if which == "middle":
            for t in range(st["t"] + tf_ms, st["t"] + S - tf_ms, tf_ms):
                b = at.get(t)
                if b is not None and b["h"] < st["h"] and b["l"] > st["l"]:
                    drop.add(t)
                    touched.append(st["t"])
                    break
        else:
            last, prev = at.get(st["t"] + S - tf_ms), at.get(st["t"] + S - 2 * tf_ms)
            lv = e["info"]["level"]
            if last and prev and last["h"] < st["h"] and last["l"] > st["l"] and ((prev["c"] < lv) if e["dir"] < 0 else (prev["c"] > lv)):
                drop.add(last["t"])
                touched.append(st["t"])
    mod = [b for b in bars if b["t"] not in drop]
    tr = {}
    rt.run(symbol, rule, {"bars": mod, "events": []}, phase, None, base=False, trace=tr)
    ev2 = [e for e in tr["events"] if e["code"] == "CC"]
    engine2 = {(e["dir"], e["info"]["breakT"], e["info"]["levelT"]) for e in ev2}
    touched_set = set(touched)
    still = [e for e in ev2 if e["info"]["breakT"] in touched_set]
    mod_t = {b["t"] for b in mod}
    full2 = structure(mod, rule["tf"], rule["cc"]["tf"], rule["cc"]["offset"])
    combos = compare_rebuild(full2, rule["cc"]["swing"], rule["cc"]["legs"], engine2)
    return {
        "que_se_hizo": ("se quitó una vela de la regla de en medio" if which == "middle" else "se quitó la última vela de la regla")
        + " en la vela de estructura de cada ruptura del motor (sin tocar su máximo ni su mínimo)",
        "rupturas_tocadas": len(touched), "eventos_antes": len(events), "eventos_despues": len(ev2),
        "siguen_disparando_en_una_vela_tocada": len(still),
        "de_esos_con_su_vela_de_la_regla_en_las_velas": sum(1 for e in still if e["t"] in mod_t),
        "ejemplos_siguen": [{"ruptura": iso(e["info"]["breakT"]), "lado": side_text(e["dir"]), "nivel": e["info"]["level"],
                             "vela_del_evento": iso(e["t"]), "se_conoce": iso(e["known"]), "esa_vela_existe": e["t"] in mod_t}
                            for e in still[:MAX_EX]],
        "reconstruccion": combos[:8],
    }


def sma_atr(bars, n=14):
    tr = [bars[0]["h"] - bars[0]["l"]] + [max(bars[i]["h"] - bars[i]["l"], abs(bars[i]["h"] - bars[i - 1]["c"]), abs(bars[i]["l"] - bars[i - 1]["c"]))
                                           for i in range(1, len(bars))]
    out, total = [], 0.0
    for i, x in enumerate(tr):
        total += x
        if i >= n:
            total -= tr[i - n]
        out.append(total / min(i + 1, n))
    return out


def check(symbol, name, phase_number):
    raw = rp.RULES[name]
    rule = rt.clean_rule(raw)
    cc = rule["cc"]
    tf, S = rule["tf"], cc["tf"] * 60000
    tf_ms = tf * 60000
    n, legs, offset = cc["swing"], cc["legs"], cc["offset"]
    out = {"moneda": symbol, "regla": name, "fase": phase_number, "tf": tf, "cc": cc,
           "limpieza_offset": {"pedido": raw["cc"]["offset"], "queda": offset, "esperado": raw["cc"]["offset"] % cc["tf"],
                               "bien": offset == raw["cc"]["offset"] % cc["tf"]}}
    phase = next(p for p in rt.phases(symbol) if p["phase"] == phase_number)
    t0 = time.time()
    span = rt.detect_span(symbol, tf, phase, rule)
    tr = {}
    res = rt.run(symbol, rule, span, phase, None, base=False, trace=tr)
    bars = span["bars"]
    bar_index = {b["t"]: i for i, b in enumerate(bars)}
    events = [e for e in tr["events"] if e["code"] == "CC"]
    trades = res.get("trades") or []
    out["motor"] = {"velas": len(bars), "eventos": len(events), "señales": len(tr.get("signals") or []), "trades": len(trades),
                    "segundos": round(time.time() - t0, 1)}
    full = structure(bars, tf, cc["tf"], offset)
    incomplete = [s for s in full if not s["complete"]]
    out["estructura"] = {"velas": len(full), "incompletas": len(incomplete),
                         "ejemplos_incompletas": [{"inicio": iso(s["t"]), "velas_de_la_regla": s["n"]} for s in incomplete[:MAX_EX]]}

    tally = Tally()
    lect = Tally()   # lecturas: no son fallas, dicen qué lectura cumple cada evento
    by_series = {}
    for label, ser in (("fuera", [s for s in full if s["complete"]]), ("dentro", full)):
        highs, lows = swings(ser, n)
        by_series[label] = {"ser": ser, "idx": {s["t"]: i for i, s in enumerate(ser)}, "highs": highs, "lows": lows,
                            "hset": set(highs), "lset": set(lows)}
    feats = []
    seen = collections.Counter((e["dir"], e["info"]["levelT"]) for e in events)
    ev_key = {}
    for e in events:
        info, d = e["info"], e["dir"]
        ev_key[(d, e["known"])] = e
        ex = {"ruptura": iso(info["breakT"]), "lado": side_text(d), "nivel": info["level"], "swing": iso(info["levelT"]),
              "extremo": info["extreme"], "zona": [e["lo"], e["hi"]]}
        tally.add("marco, swing y tramos del evento = los de la regla", info["structTf"] == cc["tf"] and info["swing"] == n and info["legs"] == legs, ex)
        aligned = (info["breakT"] - offset * 60000) % S == 0
        tally.add("la vela de estructura empieza a offset minutos de las 00:00 UTC", aligned, ex)
        tally.add("se conoce al cerrar la vela de estructura (known = inicio + marco)", e["known"] == info["breakT"] + S, ex)
        tally.add("cae en la vela de la regla que cierra a esa hora (t = known - marco de la regla)",
                  e["t"] == e["known"] - tf_ms and e["t"] in bar_index, ex)
        sfull = by_series["dentro"]
        i_full = sfull["idx"].get(info["breakT"])
        tally.add("la vela de estructura de la ruptura está completa", i_full is not None and full[i_full]["complete"],
                  {**ex, "velas_de_la_regla": full[i_full]["n"] if i_full is not None else None})
        tally.add("cada swing dispara una vez (ningún otro evento con el mismo swing y lado)", seen[(d, info["levelT"])] == 1, ex)
        f = {"e": e}
        for label in ("fuera", "dentro"):
            sd = by_series[label]
            ser, idx = sd["ser"], sd["idx"]
            i, p = idx.get(info["breakT"]), idx.get(info["levelT"])
            if i is None or p is None:
                tally.add(f"[{label}] la ruptura y el swing están en la serie", False, ex)
                continue
            tally.add(f"[{label}] la ruptura y el swing están en la serie", True)
            H = [s["h"] for s in ser]
            L = [s["l"] for s in ser]
            C = [s["c"] for s in ser]
            kind_ok = (p in sd["lset"]) if d < 0 else (p in sd["hset"])
            price = L[p] if d < 0 else H[p]
            tally.add(f"[{label}] el nivel roto es un swing (único extremo de {2 * n + 1} velas de estructura) del lado que da el corto o el largo",
                      kind_ok and same(price, info["level"]), {**ex, "precio_de_la_vela": price, "es_swing": kind_ok})
            tally.add(f"[{label}] el swing estaba confirmado antes de la ruptura", p + n < i, {**ex, "velas_entre": i - p})
            closes = C[i] < info["level"] if d < 0 else C[i] > info["level"]
            tally.add(f"[{label}] la vela de estructura cierra más allá del swing (bajo un mínimo: corto; sobre un máximo: largo)",
                      closes, {**ex, "cierre": C[i]})
            first = not any((C[j] < info["level"]) if d < 0 else (C[j] > info["level"]) for j in range(p + 1, i))
            lect.add(f"[{label}] es el primer cierre más allá del swing", first, {**ex, "cierre_anterior": next(
                (iso(ser[j]["t"]) for j in range(p + 1, i) if ((C[j] < info["level"]) if d < 0 else (C[j] > info["level"]))), None)})
            for antes in (True, False):
                lim = i - 1 if antes else i
                own = known_upto(sd["lows"] if d < 0 else sd["highs"], n, lim)
                other = known_upto(sd["highs"] if d < 0 else sd["lows"], n, lim)
                tag = "antes" if antes else "al cierre"
                last = own[-1] if own else None
                lect.add(f"[{label}, conocido {tag}] el swing roto es el último de su lado", last == p,
                         {**ex, "ultimo": iso(ser[last]["t"]) if last is not None else None})
                r_own = rises([L[q] for q in own] if d < 0 else [H[q] for q in own], d)
                r_other = rises([H[q] for q in other] if d < 0 else [L[q] for q in other], d)
                f[(label, tag)] = (r_own, r_other, other[-1] > p if other else False)
                for need, lab in ((legs - 1, "legs-1"), (legs, "legs")):
                    lect.add(f"[{label}, conocido {tag}] tendencia con {need} subidas de máximos y de mínimos (lectura {lab})",
                             r_own >= need and r_other >= need, {**ex, "subidas_del_lado_roto": r_own, "subidas_del_otro": r_other})
                lect.add(f"[{label}, conocido {tag}] el último swing del otro lado es posterior al swing roto",
                         bool(other) and other[-1] > p, ex)
                if tag == "antes":
                    # Candidatos del extremo de la tendencia (en un corto, el más alto; en un largo, el más bajo)
                    pick = max if d < 0 else min
                    ext_vals = H if d < 0 else L
                    cand = {
                        "del swing roto a la ruptura": pick(ext_vals[p:i + 1]),
                        "del swing roto a la vela anterior a la ruptura": pick(ext_vals[p:i]),
                        "el último swing del otro lado": ext_vals[other[-1]] if other else None,
                    }
                    seq = own[-(legs):] + other[-(legs):]
                    if seq:
                        cand["desde el primer swing de la tendencia"] = pick(ext_vals[min(seq):i + 1])
                    for cname, val in cand.items():
                        lect.add(f"[{label}] extremo = {cname}", same(val, info["extreme"]), {**ex, "candidato": val})
            zone = (min(C[i], info["extreme"]), max(C[i], info["extreme"]))
            tally.add(f"[{label}] zona = del cierre de la ruptura al extremo", same(zone[0], e["lo"]) and same(zone[1], e["hi"]),
                      {**ex, "zona_recalculada": list(zone)})
            beyond = info["extreme"] >= max(C[i], info["level"]) if d < 0 else info["extreme"] <= min(C[i], info["level"])
            tally.add(f"[{label}] el extremo queda más allá del swing roto y del cierre (del lado de la tendencia)", beyond, ex)
        feats.append(f)

    # Señales: con una sola casilla CC, cada señal es un evento CC del motor
    sig_ok = 0
    what = collections.Counter()
    ev_t = {(e["dir"], e["t"]) for e in events}
    for s in tr.get("signals") or []:
        what[s.get("what")] += 1
        t = bars[s["k"]]["t"]
        side = s["dir"] * (-1 if rule["invert"] else 1)
        tally.add("cada señal es un evento CC del motor (misma vela y lado)", (side, t) in ev_t, {"vela": iso(t), "lado": side_text(side)})
    out["señales"] = dict(what)

    # Trades
    atr = sma_atr(bars)
    buf = float(rule["stop"].get("buffer") or 0.0)
    for t in trades:
        e = ev_key.get((t["dir"], t["known"]))
        ex = {"trade": t["n"], "señal": iso(t["signal"]), "lado": side_text(t["dir"]), "entrada": t["entry"], "stop": t["stop"]}
        tally.add("el trade sale de un evento CC (mismo lado y hora)", e is not None, ex)
        if e is None:
            continue
        tally.add("el trade guarda en cc lo del evento", t.get("cc") == e["info"], ex)
        tally.add("la zona del trade es la del evento", t.get("zone") is not None and same(t["zone"][0], e["lo"]) and same(t["zone"][1], e["hi"]),
                  {**ex, "zona_trade": t.get("zone"), "zona_evento": [e["lo"], e["hi"]]})
        tally.add("la señal del trade es la vela del evento", t["signal"] == e["t"], ex)
        k = bar_index.get(t["signal"])
        far = e["hi"] if t["dir"] < 0 else e["lo"]
        behind = t["stop"] > e["info"]["extreme"] if t["dir"] < 0 else t["stop"] < e["info"]["extreme"]
        tally.add("el stop queda detrás del extremo de la tendencia", behind, {**ex, "extremo": e["info"]["extreme"]})
        want = far - t["dir"] * buf * atr[k] if k is not None else None
        tally.add(f"stop = borde lejano de la zona + {buf} ATR (media simple de 14 en las velas de la regla)",
                  want is not None and same(want, t["stop"], 1e-9), {**ex, "stop_recalculado": want})

    # Reconstrucción de todos los eventos con cada combinación de lecturas
    engine = {(e["dir"], e["info"]["breakT"], e["info"]["levelT"]) for e in events}
    out["condiciones"] = tally.out()
    out["lecturas"] = lect.out()
    out["reconstruccion"] = compare_rebuild(full, n, legs, engine)
    if cc["tf"] > tf:
        out["metamorfica_incompletas"] = metamorphic(symbol, rule, span, phase, events, full, "middle")
        out["metamorfica_sin_la_ultima"] = metamorphic(symbol, rule, span, phase, events, full, "last")
    # Subidas de los eventos del motor (serie sin las incompletas, swings conocidos al cerrar la ruptura): cuántas
    # subidas seguidas tienen los swings del lado roto y los del otro lado (3 = 3 o más)
    dist = collections.Counter()
    for f in feats:
        v = f.get(("fuera", "al cierre"))
        if v:
            dist[f"{min(v[0], 3)}/{min(v[1], 3)}"] += 1
    out["subidas_lado_roto_y_otro"] = dict(sorted(dist.items()))
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbols")
    ap.add_argument("--reglas", default="E-CC,E-CC15")
    ap.add_argument("--fase", type=int, default=1)
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    for symbol in a.symbols.split(","):
        for name in a.reglas.split(","):
            got = check(symbol, name, a.fase)
            path = OUT / f"cc_check_{symbol}_{got['tf']}_f{a.fase}.json"
            path.write_text(json.dumps(got, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
            print(f"{name} {symbol} {got['tf']}m f{a.fase}: {got['motor']}")
            for k, v in got["condiciones"].items():
                print(f"  {'✓' if v['cumplen'] == v['de'] else '⚠'} {k}: {v['cumplen']} de {v['de']}")
            for k, v in got["lecturas"].items():
                print(f"  · {k}: {v['cumplen']} de {v['de']}")
            best = got["reconstruccion"][:6]
            for c in best:
                print(f"  reconstrucción {c['lectura']}: {c['iguales']} iguales, {c['solo_recalculados']} solo recalculados, {c['solo_motor']} solo del motor")
            print(f"  subidas (lado roto/otro): {got['subidas_lado_roto_y_otro']}")
            for key in ("metamorfica_incompletas", "metamorfica_sin_la_ultima"):
                m = got.get(key)
                if not m:
                    continue
                print(f"  {key}: {m['rupturas_tocadas']} rupturas tocadas; eventos {m['eventos_antes']} → {m['eventos_despues']}; "
                      f"siguen disparando en una vela tocada {m['siguen_disparando_en_una_vela_tocada']} "
                      f"({m['de_esos_con_su_vela_de_la_regla_en_las_velas']} con su vela de la regla)")
                for x in m["ejemplos_siguen"][:3]:
                    print(f"    sigue: {x}")
                for c in m["reconstruccion"][:4]:
                    print(f"    {c['lectura']}: {c['iguales']} iguales, {c['solo_recalculados']} solo recalculados, {c['solo_motor']} solo del motor")
            print(f"  → {path}")


if __name__ == "__main__":
    main()
