"""
Protocolo (21/11/2026), R15: cómo se combinan los elementos de una regla (la receta), recalculado aparte.

Desde la documentación (CLAUDE.md de App 1, "Setups como recetas" y "Regla" del probador), sin usar of_setups.py:
- un voto cuenta en la vela con la que se conoce su elemento (la vela cuyo cierre es `known`);
- casillas con uno o más códigos; ventana de N velas (la vela de la señal y las N − 1 anteriores); la vela que dispara
  aporta un voto;
- modos: strict (todas las casillas), threshold (al menos `min`), sequence (grupo 0 = contexto, todas sus casillas;
  grupo 1 = gatillo, al menos `groupMins[1]`; el contexto antes del gatillo, o en la misma vela con `sameBar`);
- lado: both, long o short; `invert` opera en contra (no cambia las señales, solo el lado del trade);
- momentum: EMA 14 del cierre con pendiente ≥ 0.25 ATR en 3 velas, y el cierre de su lado;
- extremo (swing): la vela de la señal o hasta `flex` antes es el mínimo (largo) o máximo (corto) de `bars` velas;
- confirmación: el precio avanza `atr` ATR a favor desde el cierre de la señal dentro de `bars` velas; la señal se
  conoce al cerrar esa vela.
ATR: media simple de 14 rangos verdaderos (la de las recetas, H13). Se compara con la lista de señales del motor
(`run(..., trace)`, la misma que usa el contexto del trade). Las diferencias se muestran para buscar su causa.

Uso: python -B tests/audit/recipe_check.py <id de la corrida> [<id> ...]
"""
import datetime as dt
import gzip
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
import rule_tester as rt  # noqa: E402  (solo para repetir la corrida y leer sus señales y sus velas)

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def series(bars):
    c = [b["c"] for b in bars]
    tr = [bars[0]["h"] - bars[0]["l"]] + [max(bars[i]["h"] - bars[i]["l"], abs(bars[i]["h"] - c[i - 1]), abs(bars[i]["l"] - c[i - 1]))
                                           for i in range(1, len(bars))]
    atr = []
    for i in range(len(bars)):
        w = tr[max(0, i - 13):i + 1]
        atr.append(sum(w) / len(w))
    ema, k = [], 2 / 15
    for i, x in enumerate(c):
        ema.append(x if i == 0 else ema[-1] + k * (x - ema[-1]))
    return c, atr, ema


def my_signals(rule, bars, events, spacing=False):
    rec = rule["recipe"]
    tf_ms = rule["tf"] * 60000
    index = {b["t"]: i for i, b in enumerate(bars)}
    codes = {c for slot in rec["slots"] for c in slot["codes"]}
    votes = {1: {}, -1: {}}   # lado -> vela -> códigos
    for e in events:
        if e["code"] not in codes:
            continue
        i = index.get(e["known"] - tf_ms)
        if i is not None:
            votes[e["dir"]].setdefault(i, set()).add(e["code"])
    c, atr, ema = series(bars)
    window = max(1, int(rec.get("window") or 1))
    sides = {"both": (1, -1), "long": (1,), "short": (-1,)}[rec.get("side", "both")]
    out = []
    for d in sides:
        last = -10 ** 9
        for i in range(len(bars)):
            if spacing and i - last < window:
                continue
            here = votes[d].get(i, set())
            if not here:
                continue   # la vela que dispara aporta un voto

            def slot_ok(slot, lo, hi):
                return any(votes[d].get(j, set()) & set(slot["codes"]) for j in range(max(0, lo), hi + 1))
            slots = rec["slots"]
            mode = rec.get("mode", "strict")
            if mode == "strict":
                ok = all(slot_ok(s, i - window + 1, i) for s in slots)
            elif mode == "threshold":
                ok = sum(slot_ok(s, i - window + 1, i) for s in slots) >= int(rec.get("min") or 1)
            elif mode == "sequence":
                trig = [s for s in slots if int(s.get("group", 0)) == 1]
                ctxs = [s for s in slots if int(s.get("group", 0)) == 0]
                need = int((rec.get("groupMins") or {}).get("1", (rec.get("groupMins") or {}).get(1, 1)))
                trig_ok = sum(1 for s in trig if set(s["codes"]) & here) >= need
                hi = i if rec.get("sameBar") else i - 1
                ok = trig_ok and all(slot_ok(s, i - window + 1, hi) for s in ctxs)
            else:
                ok = False
            if not ok:
                continue
            if rec.get("momentum") and not (i >= 3 and (ema[i] - ema[i - 3]) * d >= 0.25 * atr[i] and (c[i] - ema[i]) * d > 0):
                continue
            sw = rec.get("swing") or {}
            if sw.get("on"):
                n, flex = int(sw.get("bars", 5)), int(sw.get("flex", 0))
                good = False
                for j in range(max(0, i - flex), i + 1):
                    w = bars[max(0, j - n + 1):j + 1]
                    if d > 0 and bars[j]["l"] <= min(b["l"] for b in w):
                        good = True
                    if d < 0 and bars[j]["h"] >= max(b["h"] for b in w):
                        good = True
                if not good:
                    continue
            known_i = i
            ent = rec.get("entry") or {}
            if ent.get("on"):
                goal = c[i] + d * float(ent["atr"]) * atr[i]
                known_i = None
                for j in range(i + 1, min(len(bars), i + 1 + int(ent["bars"]))):
                    if (d > 0 and bars[j]["h"] >= goal) or (d < 0 and bars[j]["l"] <= goal):
                        known_i = j
                        break
                if known_i is None:
                    continue
            out.append((i, d, known_i))
            last = i
    return sorted(out)


def check(run_id, spacing=False):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    res.setdefault("id", run_id)
    trace = rt._replay(res)
    bars, events = trace["span"]["bars"], trace["events"]   # todos los elementos de la corrida (los de velas los arma run)
    rule = rt.saved_rule(res)
    eng = sorted((s["k"], s["dir"]) for s in trace["signals"])
    side_of = lambda d: -d if rule.get("invert") else d  # noqa: E731
    mine = my_signals(rule, bars, events, spacing)
    mine_set = {(k, side_of(d)) for i, d, k in mine}   # con confirmación, la señal es la vela que confirma
    eng_set = set(eng)
    rec = rule["recipe"]
    print(f"{run_id} · {rec.get('mode')} · casillas {[s['codes'] for s in rec['slots']]} · ventana {rec.get('window')} · lado {rec.get('side')}"
          f"{' · invertida' if rule.get('invert') else ''}{' · momentum' if rec.get('momentum') else ''}"
          f"{' · extremo ' + str(rec['swing']) if (rec.get('swing') or {}).get('on') else ''}{' · confirmación ' + str(rec['entry']) if (rec.get('entry') or {}).get('on') else ''}")
    print(f"  señales del motor {len(eng)}, recalculadas {len(mine)}; iguales {len(mine_set & eng_set)}, solo recalculadas {len(mine_set - eng_set)}, solo del motor {len(eng_set - mine_set)}"
          + (" (con la separación de una ventana entre señales)" if spacing else ""))
    for i, d in sorted(mine_set - eng_set)[:6]:
        print(f"    solo recalculada: {iso(bars[i]['t'])} {'↑' if d > 0 else '↓'}")
    for i, d in sorted(eng_set - mine_set)[:6]:
        print(f"    solo del motor: {iso(bars[i]['t'])} {'↑' if d > 0 else '↓'}")
    return len(mine_set ^ eng_set)


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    spacing = "--separacion" in args
    for rid in [a for a in args if not a.startswith("--")]:
        check(rid, spacing)
