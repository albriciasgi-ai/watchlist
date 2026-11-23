"""
Protocolo (21/11/2026), R10: el objetivo mixto con los flujos on-chain (exit.chainTarget), recalculado aparte.

Desde lo documentado (CLAUDE.md de App 1, "FLUJOS ON-CHAIN"), sin usar onchain_flows.py:
- emisión de stablecoins en `days` días: (suma de USDT y USDC hoy − la de hace `days` días) / la de hace `days` días, con
  cada moneda solo si tiene los dos datos;
- z de cada día contra los 365 días anteriores (sin el día), con al menos 180;
- el dato del día D se usa desde D + 1 día + 6 h; sin un día publicado en 3 días, no hay dato;
- a favor: z × lado ≥ umbral. Con la emisión a favor el objetivo va en `r` R; si no, en targetR.
Compara, trade por trade, si el motor tomó el objetivo mayor (chain_on y el precio del objetivo). La desviación se prueba
de población (ddof 0) y muestral (ddof 1): la documentación no la dice.

Uso: python -B tests/audit/chain_check.py <id de la corrida>
"""
import gzip
import json
import math
import os
import sys
from pathlib import Path

DAY = 86400000
LAG = DAY + 6 * 3600000
RUNS = Path(os.environ.get("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")) / "tester" / "runs"
FILE = Path(r"C:\Users\inven\OrderFlowData\onchain\coinmetrics.json")


def series(days):
    raw = json.load(open(FILE, encoding="utf-8"))
    sup = {c: {int(t): float(v) for t, v in raw[c]["SplyCur"]} for c in ("usdt", "usdc")}
    all_days = sorted(set(sup["usdt"]) | set(sup["usdc"]))
    first, last = all_days[0], all_days[-1]
    grid = list(range(first, last + DAY, DAY))
    val = {}
    for d in grid:
        grown = base = 0.0
        seen = False
        for c in ("usdt", "usdc"):
            a, b = sup[c].get(d), sup[c].get(d - days * DAY)
            if a is not None and b is not None and b > 0:
                grown += a - b
                base += b
                seen = True
        if seen and base > 0:
            val[d] = grown / base * 100
    return grid, val


def zscores(grid, val, ddof):
    z = {}
    for i, d in enumerate(grid):
        if d not in val:
            continue
        w = [val[x] for x in grid[max(0, i - 365):i] if x in val]
        if len(w) < 180:
            continue
        m = sum(w) / len(w)
        var = sum((x - m) ** 2 for x in w) / (len(w) - ddof)
        sd = math.sqrt(var)
        z[d] = (val[d] - m) / sd if sd > 0 else 0.0
    return z


def at(grid, z, close):
    """El z del último día publicado al cierre `close` (D + 1 día + 6 h ≤ close), o None (sin dato o con hueco)."""
    usable = [d for d in grid if d + LAG <= close]
    if not usable:
        return None
    d = usable[-1]
    if close - (d + LAG) > 3 * DAY:
        return None
    return z.get(d)


def main(run_id):
    res = json.load(gzip.open(RUNS / f"{run_id}.json.gz", "rt", encoding="utf-8"))
    ex = res["rule"]["exit"]
    ct = ex["chainTarget"]
    base_r, big_r = float(ex["targetR"]), float(ct["r"])
    grid, val = series(int(ct["days"]))
    zs = {dd: zscores(grid, val, dd) for dd in (0, 1)}
    bad = {0: 0, 1: 0}
    tf = res["rule"]["tf"] * 60000
    for t in res["trades"]:
        close = t.get("known") or (t["signal"] + tf)
        side = t["dir"]
        line = [f"#{t['n']} {'largo' if side > 0 else 'corto'}"]
        for dd in (0, 1):
            zz = at(grid, zs[dd], close)
            on = zz is not None and zz * side >= float(ct["z"])
            want_r = big_r if on else base_r
            want_target = t["entry"] + side * want_r * t["risk"]
            ok = on == bool(t.get("chain_on")) and abs(want_target - t["target"]) <= 1e-9 * max(1.0, abs(t["target"]))
            bad[dd] += 0 if ok else 1
            line.append(f"ddof{dd}: z {None if zz is None else round(zz, 3)} -> {'5R' if on else '3R'}{'' if ok else ' ⚠'}")
        line.append(f"motor: chain_on {t.get('chain_on')}, objetivo {round((t['target'] - t['entry']) * side / t['risk'], 3)}R")
        print("  " + " · ".join(line))
    print(f"{run_id}: {len(res['trades'])} trades; distintos con ddof 0: {bad[0]}, con ddof 1: {bad[1]}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1])
