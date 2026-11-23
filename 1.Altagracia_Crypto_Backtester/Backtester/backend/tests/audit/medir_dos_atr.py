"""
Medición del protocolo (21/11/2026): el FVG nuevo y el Impulso miden su umbral con el ATR de Wilder (fvg_swing._atr), y el
stop, el objetivo y lo demás del probador con la media simple de 14 rangos (of_setups._series). ¿Cuánto difieren, y
cuántas señales del FVG cambian si el umbral se midiera con el ATR del stop?

Uso: python -B tests/audit/medir_dos_atr.py ARBUSDT 240 1 [0.3]
"""
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))

import numpy as np  # noqa: E402
import rule_tester as rt  # noqa: E402
import of_setups as os_  # noqa: E402
import fvg_swing  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\motor")


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    symbol, tf, phase = argv[0], int(argv[1]), int(argv[2])
    min_atr = float(argv[3]) if len(argv) > 3 else 0.3
    sys.path.insert(0, str(HERE))
    import reglas_prueba as rp
    ph = next(p for p in rt.phases(symbol) if p["phase"] == phase)
    rule = rt.clean_rule({**rp.RULES["R01"], "tf": tf})
    bars = rt.detect_span(symbol, tf, ph, rule)["bars"]
    _, sma, _ = os_._series(bars)
    a = fvg_swing._arrays(bars)
    wil = fvg_swing._atr(a["h"], a["l"], a["c"])
    sma = np.array(sma)
    ratio = wil / np.where(sma > 0, sma, np.nan)
    h, l = a["h"], a["l"]
    both = only_w = only_s = 0
    rows = []
    for i in range(2, len(bars)):
        for side, lo, hi in ((1, h[i - 2], l[i]), (-1, h[i], l[i - 2])):
            gap = hi - lo
            if gap <= 0:
                continue
            w_ok, s_ok = gap >= min_atr * wil[i], gap >= min_atr * sma[i]
            if w_ok and s_ok:
                both += 1
            elif w_ok:
                only_w += 1
                rows.append({"t": int(bars[i]["t"]), "dir": side, "gapWil": round(gap / wil[i], 3), "gapSma": round(gap / sma[i], 3)})
            elif s_ok:
                only_s += 1
                rows.append({"t": int(bars[i]["t"]), "dir": side, "gapWil": round(gap / wil[i], 3), "gapSma": round(gap / sma[i], 3)})
    q = np.nanpercentile(ratio[30:], [1, 5, 25, 50, 75, 95, 99])
    first = [round(float(x), 3) for x in ratio[:40]]
    rep = {"symbol": symbol, "tf": tf, "phase": phase, "bars": len(bars), "minAtr": min_atr,
           "wilder_over_sma_percentiles_1_5_25_50_75_95_99": [round(float(x), 3) for x in q],
           "first40_ratio": first, "fvg_both": both, "fvg_only_wilder": only_w, "fvg_only_sma": only_s, "differ": rows[:200]}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"dos_atr_{symbol}_{tf}_f{phase}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{symbol} {tf} f{phase}: {len(bars)} velas; Wilder/simple (desde la vela 30) p1..p99 = {rep['wilder_over_sma_percentiles_1_5_25_50_75_95_99']}")
    print(f"  primeras 10 velas: {first[:10]}")
    print(f"  FVG ≥ {min_atr} ATR: con los dos {both}; solo con Wilder (el motor las toma) {only_w}; solo con el simple (el motor no las toma) {only_s}")


if __name__ == "__main__":
    main(sys.argv[1:])
