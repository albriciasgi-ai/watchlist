"""
Protocolo (21/11/2026), capa C: en cada trade de una corrida que entró con limit u orden stop (dos órdenes, sabios),
la vela del llenado se mira con los minutos del almacén: a qué minuto se llenó, y si el stop o el objetivo se tocaron
en esa vela después del llenado. Debe coincidir con lo que hizo el motor: si se tocó algo después del llenado, el trade
sale en esa vela y por ese nivel; si no, sale después.

Uso: python -B tests/audit/minutos_llenado.py <id de la corrida>
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
import footprint_store as fs  # noqa: E402
import rule_tester as rt  # noqa: E402

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"


def hm(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%m-%d %H:%M")


def main(run_id):
    sys.stdout.reconfigure(encoding="utf-8")
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    symbol, tf = res["symbol"], res["rule"]["tf"]
    tf_ms = tf * 60000
    checked = bad = 0
    for t in res["trades"]:
        if t.get("order") not in ("limit", "stop"):
            continue
        bar = t["entry_t"] // tf_ms * tf_ms
        m0 = bar // 60000
        d = fs.minutes(symbol, m0, m0 + tf)
        if d is None:
            print(f"#{t['n']}: sin minutos")
            continue
        side, entry, stop, target = t["dir"], t["entry"], t["stop"], t.get("target")
        if t["order"] == "limit":
            touch = [(l < entry) if side > 0 else (h > entry) for h, l in zip(d["h"], d["l"])]
        else:  # orden stop: se llena al tocar su precio (en la apertura si la vela abre más allá)
            touch = [(h >= entry) if side > 0 else (l <= entry) for h, l in zip(d["h"], d["l"])]
        if not any(touch):
            # Abrió más allá del precio (la orden se llena en la apertura): el primer minuto
            fill = 0 if abs(d["o"][0] - entry) / entry < 1e-6 else None
        else:
            fill = touch.index(True)
        if fill is None:
            print(f"#{t['n']}: ⚠ ningún minuto de la vela {hm(bar)} toca la entrada {entry}")
            bad += 1
            continue
        after = None
        for i in range(fill, len(d["m"])):
            hit_s = d["l"][i] <= stop if side > 0 else d["h"][i] >= stop
            hit_t = target is not None and (d["h"][i] >= target if side > 0 else d["l"][i] <= target)
            if hit_s or hit_t:
                after = (i, "stop" if hit_s and not hit_t else "objetivo" if hit_t and not hit_s else "los dos")
                break
        same_bar = t["exit_t"] // tf_ms * tf_ms == bar
        fill_t = int(d["m"][fill]) * 60000
        if after is None:
            ok = not same_bar
            what = "nada después del llenado en esa vela"
        else:
            exit_min = int(d["m"][after[0]]) * 60000
            ok = same_bar and (after[1] == "los dos" or after[1] == t["reason"]) and (t["exit_t"] // 60000 * 60000 == exit_min or after[1] == "los dos")
            what = f"{after[1]} a las {hm(exit_min)}"
        checked += 1
        if not ok:
            bad += 1
        if after is not None or not ok:
            print(f"#{t['n']} {('largo' if side > 0 else 'corto')} {t['order']} {entry}: llenado {hm(fill_t)}; {what}; "
                  f"el motor sale {hm(t['exit_t'])} por {t['reason']}" + ("" if ok else "  ⚠"))
    print(f"{run_id}: {checked} trades con limit u orden stop revisados con minutos; {bad} distintos")


if __name__ == "__main__":
    main(sys.argv[1])
