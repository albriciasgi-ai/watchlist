"""
Protocolo (21/11/2026), capa C: las velas dudosas de salida con el stop VIGENTE (el inicial, a la entrada o arrastrado),
no solo el inicial como minutos_salida.py. El stop vigente en la vela de la salida sale del recorrido del stop que da
el contexto del trade (GET /api/tester/result/{id}/trade/{n}/context, backend aislado 9300); el trailing y el stop a la
entrada ya se recalcularon aparte con las velas del gráfico (exitCheck en capa_bc.js). Aquí solo se mira el orden dentro
de la vela: si la vela de la salida toca el stop vigente y el objetivo, los minutos del almacén dicen cuál fue primero
(en el mismo minuto, el stop), y el motor debe salir por ese y a esa hora.

Uso: python -B tests/audit/minutos_salida2.py <id de la corrida> [<id> ...]
"""
import datetime as dt
import gzip
import json
import os
import sys
import urllib.request
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
import footprint_store as fs  # noqa: E402

RUNS = Path(os.environ["ORDERFLOW_OBSERVER"]) / "tester" / "runs"
API = "http://127.0.0.1:9300"
STOPS = ("stop", "stop en la entrada", "stop arrastrado")


def hm(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%m-%d %H:%M")


def context(run_id, n):
    req = urllib.request.Request(f"{API}/api/tester/result/{run_id}/trade/{n}/context", headers={"User-Agent": "app1-audit/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)


def check(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    symbol, tf = res["symbol"], res["rule"]["tf"]
    tf_ms = tf * 60000
    seen = bad = 0
    for t in res["trades"]:
        target = t.get("target")
        if target is None or t["reason"] not in STOPS + ("objetivo",):
            continue
        bar = t["exit_t"] // tf_ms * tf_ms  # stop y objetivo salen a la hora del minuto que los toca, dentro de la vela
        m0 = bar // 60000
        d = fs.minutes(symbol, m0, m0 + tf)
        if d is None:
            continue
        side = t["dir"]
        hi, lo = max(d["h"]), min(d["l"])
        reach_t = (hi >= target) if side > 0 else (lo <= target)
        if not reach_t:
            continue
        fill_bar = t["entry_t"] // tf_ms * tf_ms == bar and t.get("order") in ("limit", "stop")
        if fill_bar:  # lo revisa minutos_llenado.py
            continue
        ctx = context(run_id, t["n"])
        path = {int(p[0]): (float(p[1]), p[2]) for p in (ctx.get("stopPath") or [])}
        if bar not in path:
            print(f"  #{t['n']}: sin el stop vigente de la vela {hm(bar)} en el contexto (same={ctx.get('same')})")
            continue
        stop, phase = path[bar]
        hit_s = [(l <= stop) if side > 0 else (h >= stop) for h, l in zip(d["h"], d["l"])]
        hit_t = [(h >= target) if side > 0 else (l <= target) for h, l in zip(d["h"], d["l"])]
        if not (any(hit_s) and any(hit_t)):
            continue
        i_s = hit_s.index(True)
        i_t = hit_t.index(True)
        want = "stop" if i_s <= i_t else "objetivo"
        when = int(d["m"][min(i_s, i_t)]) * 60000
        got = "stop" if t["reason"] in STOPS else "objetivo"
        ok = want == got and t["exit_t"] // 60000 * 60000 == when
        seen += 1
        bad += 0 if ok else 1
        print(f"  #{t['n']} {'largo' if side > 0 else 'corto'}: vela {hm(bar)}, stop vigente {stop} ({phase}) tocado {hm(int(d['m'][i_s]) * 60000)}, "
              f"objetivo {target} tocado {hm(int(d['m'][i_t]) * 60000)} -> {want} a las {hm(when)}; el motor: {t['reason']} a las {hm(t['exit_t'])}"
              + ("" if ok else "  ⚠"))
    print(f"{run_id}: {seen} velas dudosas de salida (stop vigente) revisadas con minutos; {bad} distintas")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    for rid in sys.argv[1:]:
        check(rid)
