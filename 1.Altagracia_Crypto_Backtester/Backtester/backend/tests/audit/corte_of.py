"""
Protocolo (22/11/2026), etapa 4: prueba de corte (I-01) de los elementos de order flow. Se detectan otra vez con lo
conocido hasta una fecha al azar (`of_elements.detect` con `known_until` en el corte) y se comparan con los de la fase
entera conocidos antes del corte: tienen que ser los mismos (sin futuro ni repintado). Las reglas solo filtran los
eventos ya detectados; esto prueba el detector.

Uso (desde backend/): python -B tests/audit/corte_of.py BTCUSDT [--tf 15] [--fase 1] [--cortes 5] [--codigos ST,DT]
"""
import argparse
import datetime as dt
import json
import os
import random
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import of_elements as oe  # noqa: E402
import reglas_prueba as rp  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\elementos")
DAY = 86400000


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("symbol")
    ap.add_argument("--tf", type=int, default=15)
    ap.add_argument("--fase", type=int, default=1)
    ap.add_argument("--cortes", type=int, default=5)
    ap.add_argument("--codigos", default="")
    ap.add_argument("--dias", type=int, default=10)
    a = ap.parse_args()
    rule = rt.clean_rule(rp.rule("corte", a.tf, rp.recipe("ST")))
    phase = next(p for p in rt.phases(a.symbol) if p["phase"] == a.fase)
    span = rt.detect_span(a.symbol, a.tf, phase, rule)
    codes = set(a.codigos.split(",")) if a.codigos else None
    tf_ms = a.tf * 60000
    rnd = random.Random(2026)
    start, end = phase["start"] + 40 * DAY, phase["end"] - 2 * DAY
    out = []
    for _ in range(a.cortes):
        cut = (rnd.randrange(start, end) // tf_ms) * tf_ms
        lo = cut - a.dias * DAY
        part = oe.detect(a.symbol, a.tf, lo, cut - 1, cut, rule["target"], 0, rule["volFilter"])
        key = lambda e: (e["code"], e["dir"], e["t"], e["known"], round(e["lo"], 8), round(e["hi"], 8))  # noqa: E731
        mine = {key(e) for e in part["events"] if e["known"] <= cut and (codes is None or e["code"] in codes)}
        full = {key(e) for e in span["events"] if lo <= e["t"] < cut and e["known"] <= cut and (codes is None or e["code"] in codes)}
        only_full, only_cut = sorted(full - mine, key=lambda k: k[2]), sorted(mine - full, key=lambda k: k[2])
        by_code = {}
        for k in full | mine:
            by_code.setdefault(k[0], [0, 0, 0])
        for k in full:
            by_code[k[0]][0] += 1
        for k in mine:
            by_code[k[0]][1] += 1
        for k in full & mine:
            by_code[k[0]][2] += 1
        row = {"corte": iso(cut), "eventos fase": len(full), "eventos cortados": len(mine), "iguales": len(full & mine),
               "solo fase": [f"{k[0]} {iso(k[2])} {k[1]:+d}" for k in only_full[:6]], "solo cortados": [f"{k[0]} {iso(k[2])} {k[1]:+d}" for k in only_cut[:6]],
               "por código (fase, cortados, iguales)": by_code}
        out.append(row)
        bad = {c: v for c, v in by_code.items() if not (v[0] == v[1] == v[2])}
        print(f"corte {row['corte']}: fase {len(full)}, cortados {len(mine)}, iguales {len(full & mine)}"
              + ("" if not bad else f" · distintos {bad} · solo fase {row['solo fase'][:3]} · solo cortados {row['solo cortados'][:3]}"), flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"corte_of_{a.symbol}_{a.tf}_f{a.fase}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
