"""
Protocolo (21/11/2026), R12: el Gaussian Channel (elemento GC y su salida por el canal) recalculado aparte.

Desde la documentación (CLAUDE.md de App 1, "Gaussian Channel, GC"), sin usar gaussian_channel.py para calcular:
- filtro gaussiano de Ehlers de `poles` polos sobre (máximo + mínimo + cierre) / 3, y bandas a `mult` rangos verdaderos
  filtrados. Aquí el filtro de N polos se arma como N filtros de un polo en cascada con el mismo alfa (la forma de
  Ehlers), no con la recursión binomial del motor: son la misma cuenta escrita de otra manera;
- "el filtro arranca con el primer dato": cada etapa empieza en el primer valor;
- alfa: beta = (1 − cos(2π/period)) / (1.414^(2/poles) − 1), alfa = −beta + raíz(beta² + 2·beta);
- GC alcista: la vela cierra sobre la banda superior y la anterior no, con la línea central subiendo; las primeras
  2 × period velas (contando las previas a la fase) no dan señales;
- salida "band": al cerrar de vuelta dentro de la banda (un largo, bajo la banda superior); sale en la apertura
  siguiente. Stop en la línea central de la señal (borde lejano de la zona, margen 0).
Compara el canal con el del motor, las señales de la fase con los trades, y la salida de cada trade.

Uso: python -B tests/audit/gc_check.py <id de la corrida>
"""
import datetime as dt
import gzip
import json
import math
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import comparar  # noqa: E402
import gaussian_channel  # noqa: E402  (solo para comparar los números, no para calcular)

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"


def day(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def cascade(values, alpha, poles):
    """N filtros de un polo en cascada: y = alfa·x + (1 − alfa)·y[−1], cada etapa empezando en el primer valor."""
    out = list(values)
    for _ in range(poles):
        y = out[0]
        stage = []
        for x in out:
            y = alpha * x + (1.0 - alpha) * y
            stage.append(y)
        stage[0] = out[0]
        out = stage
    return out


def my_channel(bars, period, poles, mult):
    src = [(b["h"] + b["l"] + b["c"]) / 3.0 for b in bars]
    tr = [bars[0]["h"] - bars[0]["l"]] + [max(bars[i]["h"] - bars[i]["l"], abs(bars[i]["h"] - bars[i - 1]["c"]),
                                              abs(bars[i]["l"] - bars[i - 1]["c"])) for i in range(1, len(bars))]
    beta = (1.0 - math.cos(2.0 * math.pi / period)) / (1.414 ** (2.0 / poles) - 1.0)
    alpha = -beta + math.sqrt(beta * beta + 2.0 * beta)
    mid = cascade(src, alpha, poles)
    width = cascade(tr, alpha, poles)
    return mid, [m + w * mult for m, w in zip(mid, width)], [m - w * mult for m, w in zip(mid, width)]


def check(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    rule = res["rule"]
    gc = rule["gc"]
    cap = comparar.capture(res["symbol"], rule, phase=1, base=False)
    warm, bars = cap["span"].get("warm") or [], cap["span"]["bars"]
    allb = warm + bars
    period, poles, mult = int(gc["period"]), int(gc["poles"]), float(gc["mult"])
    mid, hi, lo = my_channel(allb, period, poles, mult)
    emid, ehi, elo = gaussian_channel.channel(allb, period, poles, mult)
    rel = max(max(abs(a - b) / abs(b) for a, b in zip(mid, emid) if b), max(abs(a - b) / abs(b) for a, b in zip(hi, ehi) if b))
    print(f"{run_id}: {len(warm)} velas antes de la fase y {len(bars)} en la fase ({day(allb[0]['t'])} a {day(allb[-1]['t'])}); "
          f"canal en cascada contra el del motor: diferencia relativa máxima {rel:.2e}")
    side_ok = {"both": (1, -1), "long": (1,), "short": (-1,)}.get((rule.get("recipe") or {}).get("side", "both"), (1, -1))
    mine = []
    for i in range(max(2, 2 * period), len(allb)):
        if i < len(warm):
            continue
        c, before = allb[i]["c"], allb[i - 1]["c"]
        if 1 in side_ok and c > hi[i] and before <= hi[i - 1] and mid[i] > mid[i - 1]:
            mine.append((i, 1))
        if -1 in side_ok and c < lo[i] and before >= lo[i - 1] and mid[i] < mid[i - 1]:
            mine.append((i, -1))
    print(f"  señales GC recalculadas en la fase ({'solo largos' if side_ok == (1,) else 'los dos lados'}): {len(mine)}: "
          + ", ".join(f"{day(allb[i]['t'])[:10]} {'↑' if s > 0 else '↓'}" for i, s in mine))
    tf_ms = rule["tf"] * 60000
    index = {b["t"]: i for i, b in enumerate(allb)}
    taken = set()
    for t in res["trades"]:
        k = index.get(t["signal"])
        taken.add(k)
        side = t["dir"]
        ei = index.get(t["entry_t"])
        ok_sig = (k, side) in mine
        stop_want = mid[k]
        want = None
        for j in range(ei, len(allb)):
            b = allb[j]
            if (side > 0 and b["l"] <= t["stop"]) or (side < 0 and b["h"] >= t["stop"]):
                want = (j, "stop", t["stop"] if (b["o"] - t["stop"]) * side > 0 else b["o"])
                break
            if j + 1 < len(allb) and ((side > 0 and b["c"] < hi[j]) or (side < 0 and b["c"] > lo[j])):
                want = (j + 1, "sale del canal", allb[j + 1]["o"])
                break
        got_bar = index.get(t["exit_t"]) if t["reason"] == "sale del canal" else (t["exit_t"] // tf_ms * tf_ms in index and index[t["exit_t"] // tf_ms * tf_ms])
        same = want and want[0] == got_bar and want[1] == t["reason"] and abs(want[2] - t["exit"]) <= 1e-9 * abs(t["exit"])
        print(f"  #{t['n']} {'largo' if side > 0 else 'corto'}: señal {day(t['signal'])[:10]} {'es GC' if ok_sig else '⚠ no es GC recalculada'}; "
              f"entrada {day(t['entry_t'])} a {t['entry']} (apertura {allb[ei]['o']}); stop {t['stop']} (línea central {stop_want:.6f}"
              f"{'' if abs(stop_want - t['stop']) <= 1e-6 * t['stop'] else ' ⚠'}); salida recalculada {day(allb[want[0]]['t']) if want else '—'} "
              f"por {want[1] if want else '—'} en {want[2] if want else '—'}; el motor {day(t['exit_t'])} por {t['reason']} en {t['exit']}"
              + ("" if same else "  ⚠"))
    print(f"  señales sin trade: {[day(allb[i]['t'])[:10] for i, s in mine if i not in taken]} (posición abierta o abierta al final: ver el embudo)")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    check(sys.argv[1])
