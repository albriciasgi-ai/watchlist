"""
Protocolo (22/11/2026), etapa 7, regresión: los 18 veredictos del usuario con el motor 6 y los controles nuevos.

Para cada regla exacta del usuario (la misma variante que la etapa 5, leída del registro aunque sus corridas sean de un
motor anterior) corre cada moneda del grupo en cada fase con sus controles, como la app, y junta las monedas como el
tablero de estrategias (strategy_board._pool): R, las tres ventajas (azar de la fase, tramo y azar del trimestre y lado),
con el margen agrupado por semanas, y si pasa. No guarda corridas.

Uso (desde backend/): python -B tests/audit/veredictos_etapa7.py --grupo base
Escribe evidencia/etapa7/veredictos_<grupo>.json
"""
import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import measures  # noqa: E402
import rule_tester as rt  # noqa: E402
import strategy_board as sb  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7")
NAMES = {"B5": "B5. 4h · 1 de FVG nuevo, Doji @2 · OI sube", "CAJA": "Ruptura de caja con EMA 200 y CVD",
         "CAJA-CORTOS": "Ruptura de caja con EMA 200 y CVD · solo cortos", "FLECHA": "Flecha_Volumen de respuesta_VWAP"}
# Las variantes del usuario (etapa 5) y las celdas de sus 18 veredictos
HASHES = {"B5": "2277e57a", "CAJA": "1a4ac5c5", "CAJA-CORTOS": "d4e84ccb", "FLECHA": "7f537484"}
CELLS = {"base": {"B5": (1, 2, 3), "CAJA": (1, 2, 3), "CAJA-CORTOS": (1,), "FLECHA": (1, 2)},
         "new": {"B5": (1, 2, 3), "CAJA": (1, 2, 3), "CAJA-CORTOS": (1, 2, 3)}}


def user_rule(key):
    """La regla exacta del usuario, del registro (también si sus corridas son de un motor anterior)."""
    for r in rt.history(None, stale=True):
        rule = r.get("rule") or {}
        if rule.get("name") == NAMES[key] and r.get("hash", "").startswith(HASHES[key]):
            return rt.clean_rule(rule)
    raise SystemExit(f"No está la regla {key} ({HASHES[key]}) en el registro")


def one(symbol, rule, phase_n):
    phase = next((p for p in rt.phases(symbol) if p["phase"] == phase_n), None)
    if phase is None or not phase["available"] or not rt.has_candles(symbol, rule["tf"]):
        return None
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    res = rt.run(symbol, rule, span, phase, measures.table_for(symbol) if rule.get("filters") else None, base=True)
    return res if res.get("success") else None


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--grupo", default="base")
    a = ap.parse_args()
    symbols = rt.candle_symbols(a.grupo)
    out, started = {}, time.time()
    for key, phases in CELLS[a.grupo].items():
        rule = user_rule(key)
        for phase_n in phases:
            items = []
            for symbol in symbols:
                res = one(symbol, rule, phase_n)
                if res is None:
                    continue
                rt.load_run = lambda run_id, res=res: res  # _run_stats lee la corrida por su id: aquí, la recién hecha
                items.append((symbol, sb._run_stats("x")))
            cell = sb._pool(items)
            row = {k: cell.get(k) for k in ("n", "avgR", "seR", "seWeeks", "edge", "legEdge", "quarterEdge", "pass", "withTrades", "positive")}
            out[f"{key} {a.grupo} f{phase_n}"] = row
            print(key, a.grupo, phase_n, json.dumps(row, ensure_ascii=False), f"{time.time() - started:.0f} s", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"veredictos_{a.grupo}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
