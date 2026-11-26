"""
Protocolo de pruebas, galería 4 (26/11/2026): cuántas señales da cada elemento de order flow con el motor 8, contra el
motor 7, en BTC 15m, fase 1. El motor 7 sale del caché de la fase de la copia aislada (`_e2`); el motor 8 se detecta con
el código de hoy y queda en ese caché (`_a10_e3`), el mismo que usará el probador de la copia aislada. La absorción se
mide también con otras velas para el segundo intento.

Solo lee el almacén y escribe en el caché de la copia aislada. Uso, con el python del .venv de App 1:
    python -X utf8 -B tests/audit/medir_motor8.py [velas de la absorción...]
"""
import collections
import os
import sys
import time
from pathlib import Path

os.environ["ORDERFLOW_OBSERVER"] = r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado"
os.environ["TESTER_AUTO_UPDATE"] = "0"
BACKEND = Path(__file__).resolve().parents[2]
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))
sys.stdout.reconfigure(encoding="utf-8")

import numpy as np  # noqa: E402
import of_elements as oe  # noqa: E402
import rule_tester as rt  # noqa: E402

SYMBOL, TF = "BTCUSDT", 15
CHANGED = ("EX", "VD", "DT", "DD", "IV", "SQ", "VL", "AD", "RL", "RD")


def main():
    phase = next(p for p in rt.phases(SYMBOL) if p["phase"] == 1)
    rule = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["RL"]}]}})
    old_path = rt.tester_dir() / "cache" / f"{SYMBOL}_{TF}_f1_{phase['from']}_{phase['to']}_t0p05_v2p0_e2.npz"
    with np.load(old_path) as z:
        old = collections.Counter(str(c) for c in z["e_code"])
        old_rd = len({(int(t), int(d)) for c, t, d in zip(z["e_code"], z["e_t"], z["e_dir"]) if str(c) == "RD"})
    started = time.time()
    span = rt.detect_span(SYMBOL, TF, phase, rule)
    new = collections.Counter(e["code"] for e in span["events"])
    new_rd = len({(e["t"], e["dir"]) for e in span["events"] if e["code"] == "RD"})
    print(f"BTC 15m, fase 1 ({phase['from']} a {phase['to']}, {len(span['bars']):,} velas), detectada en {time.time() - started:.0f} s")
    print("Elemento · motor 7 · motor 8")
    for code in CHANGED:
        extra = f" (velas con recarga: {old_rd:,} y {new_rd:,})" if code == "RD" else ""
        print(f"  {code} {oe.CATALOG[code][0]}: {old[code]:,} · {new[code]:,}{extra}")
    others = [c for c in sorted(set(old) | set(new)) if c not in CHANGED and old[c] != new[c]]
    print("Otros que cambiaron:", ", ".join(f"{c} {old[c]} → {new[c]}" for c in others) or "ninguno")
    for bars_n in (int(x) for x in sys.argv[1:]):
        other = rt.clean_rule({"tf": TF, "recipe": {"slots": [{"codes": ["RL"]}]}, "absorbBars": bars_n})
        span_n = rt.detect_span(SYMBOL, TF, phase, other)
        print(f"  RL con {bars_n} velas: {sum(e['code'] == 'RL' for e in span_n['events']):,}")


if __name__ == "__main__":
    main()
