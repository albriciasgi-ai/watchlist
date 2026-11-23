"""
Protocolo (22/11/2026), etapa 6, confusión 9: el borde de caja gasta la llegada aunque la vela no pase los filtros.

`box_elements.events` pone `armed[side] = False` antes de mirar "cuerpo hasta" (maxBody) y "cierra a" (rejection): una
primera llegada que no pasa los filtros consume el arma, y en ese borde no hay otra señal hasta que el cierre vuelve al
tercio del centro. Este script cuenta, con los mismos datos y las mismas cajas, cuántos eventos habría si la llegada
solo se gastara al dar un evento (las velas posteriores de la misma llegada que sí pasan los filtros). Solo lee.

Uso: python -B tests/audit/borde_rearme.py BTCUSDT 240 [maxBody ...]
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import numpy as np  # noqa: E402
import rule_tester as rt  # noqa: E402
import invariantes as inv  # noqa: E402
import box_elements as be_mod  # noqa: E402
import regime  # noqa: E402
import regime_detectors as rd  # noqa: E402


def count(bars, share, max_body, rejection, spend_on_fail):
    a = be_mod._arrays(bars)
    atr = regime.atr(a["h"], a["l"], a["c"])
    zones = rd.er_box(a, **rd.PARAMS["er_box"]["params"])["zones"]
    o, h, l, c = a["o"], a["h"], a["l"], a["c"]
    n = 0
    for z in zones:
        height = z["high"] - z["low"]
        if height <= 0:
            continue
        mid = (z["low"] + z["high"]) / 2
        armed = {1: True, -1: True}
        for i in range(z["detected"] + 1, min(z["end"] + 1, len(c))):
            if abs(c[i] - mid) < height / 6:
                armed = {1: True, -1: True}
            for side, hit in ((1, l[i] <= z["low"] + share * height), (-1, h[i] >= z["high"] - share * height)):
                if not hit or not armed[side]:
                    continue
                if spend_on_fail:
                    armed[side] = False
                rng = max(h[i] - l[i], 1e-12)
                close_at = (c[i] - l[i]) / rng if side > 0 else (h[i] - c[i]) / rng
                if max_body and abs(c[i] - o[i]) > max_body * atr[i]:
                    continue
                if close_at < rejection:
                    continue
                armed[side] = False
                n += 1
    return n


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    symbol, tf = sys.argv[1], int(sys.argv[2])
    bodies = [float(x) for x in sys.argv[3:]] or [1.0, 0.5, 0.25]
    phase = inv.phase_of(symbol, 1)
    rule = rt.clean_rule({"name": "borde", "tf": tf, "recipe": {"slots": [{"codes": ["BE"]}], "mode": "strict", "window": 1, "side": "both"}})
    span = rt.detect_span(symbol, tf, phase, rule)
    bars = span["bars"]
    share, rejection = rule["be"]["share"], rule["be"]["rejection"]
    engine = [e for e in span["events"] if e["code"] == "BE"]
    print(f"{symbol} {tf}m f1: eventos BE del motor (de fábrica) {len(engine)}")
    for body in bodies:
        a = count(bars, share, body, rejection, True)
        b = count(bars, share, body, rejection, False)
        print(f"  cuerpo hasta {body} ATR: como el motor {a}; gastando la llegada solo con un evento {b} (+{b - a})")


if __name__ == "__main__":
    main()
