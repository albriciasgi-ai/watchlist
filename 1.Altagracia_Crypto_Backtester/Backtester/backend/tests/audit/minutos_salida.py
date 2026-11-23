"""
Protocolo (21/11/2026), capa C: las velas dudosas de salida (las que tocan el stop y el objetivo a la vez) de una
corrida, mirando los minutos del almacén. Debe salir por el nivel que se tocó primero (en el mismo minuto, el stop) y
a esa hora. Solo los trades con objetivo fijo que salen por "stop" u "objetivo".

Uso: python -B tests/audit/minutos_salida.py <id de la corrida> [<id> ...]
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

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"


def hm(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%m-%d %H:%M")


def check(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    symbol, tf = res["symbol"], res["rule"]["tf"]
    tf_ms = tf * 60000
    seen = bad = 0
    for t in res["trades"]:
        target = t.get("target")
        if target is None or t["reason"] not in ("stop", "objetivo"):
            continue
        bar = t["exit_t"] // tf_ms * tf_ms
        m0 = bar // 60000
        d = fs.minutes(symbol, m0, m0 + tf)
        if d is None:
            continue
        side, stop = t["dir"], t["stop"]
        hit_s = [(l <= stop) if side > 0 else (h >= stop) for h, l in zip(d["h"], d["l"])]
        hit_t = [(h >= target) if side > 0 else (l <= target) for h, l in zip(d["h"], d["l"])]
        if not (any(hit_s) and any(hit_t)):
            continue
        fill_bar = t["entry_t"] // tf_ms * tf_ms == bar and t.get("order") in ("limit", "stop")
        start = 0
        if fill_bar:  # En la vela del llenado solo cuenta lo de después del llenado (lo revisa minutos_llenado.py)
            continue
        i_s = hit_s.index(True)
        i_t = hit_t.index(True)
        want = "stop" if i_s <= i_t else "objetivo"
        when = int(d["m"][min(i_s, i_t)]) * 60000
        ok = want == t["reason"] and t["exit_t"] // 60000 * 60000 == when
        seen += 1
        bad += 0 if ok else 1
        print(f"  #{t['n']} {'largo' if side > 0 else 'corto'}: vela {hm(bar)} toca stop {hm(int(d['m'][i_s]) * 60000)} y objetivo "
              f"{hm(int(d['m'][i_t]) * 60000)} -> {want} a las {hm(when)}; el motor: {t['reason']} a las {hm(t['exit_t'])}" + ("" if ok else "  ⚠"))
    print(f"{run_id}: {seen} velas dudosas de salida revisadas con minutos; {bad} distintas")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for rid in sys.argv[1:]:
        check(rid)
