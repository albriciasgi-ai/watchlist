"""
Protocolo (23/11/2026), decisiones E-02 y E-08: cuánto cambian las reglas que usan el fallo fuera del valor (VF) y el
borde de caja (BE) con cada lectura. No cambia el motor: reemplaza la función de los eventos solo en este proceso.

E-08, borde de caja (BE). Una llegada al quinto de arriba o de abajo de una caja vigente:
  actual   la primera vela que toca el borde gasta la llegada, pase o no los filtros de cuerpo y cierre (el motor);
  primera  la llegada se gasta al dar un evento: cuenta la primera vela de la llegada que pasa los filtros;
  cada     sin llegadas: cada vela que toca el borde y pasa los filtros (lo literal del Excel).
E-02, fallo fuera del valor (VF), en la primera vela de una sesión:
  abre     mira si la sesión abrió dentro del valor (el motor);
  cierre   mira si cerró dentro la vela anterior (lo literal de la documentación).

En el modo del motor, cada llamada se compara con la función original: tienen que dar lo mismo.
VF corre solo donde ya están en disco los elementos de la fase (BTC 15m fases 1 a 3, ARB y ETH 15m fase 1; en 1h,
la fase 1 de las tres): en las demás monedas habría que detectarlos primero, que son horas. No guarda corridas.

Uso (desde backend/): python -B tests/audit/medir_e02_e08.py --regla E-BE --modo primera --grupo base --fases 1,2,3
Escribe evidencia/etapa7/e02_e08/<regla>_<modo>_<grupo>.json
"""
import argparse
import inspect
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
import box_elements  # noqa: E402
import vp_sessions  # noqa: E402
import rule_tester as rt  # noqa: E402
import strategy_board as sb  # noqa: E402
import reglas_prueba as rp  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7\e02_e08")
MODES = {"BE": ("actual", "primera", "cada"), "VF": ("abre", "cierre")}
MODULES = {"BE": box_elements, "VF": vp_sessions}
ORIGINAL = {"BE": box_elements.events, "VF": vp_sessions.events}
COUNTS = {}
CURRENT = [None]


def _patch(module, old, new):
    """La función de los eventos con estos reemplazos, compilada en su módulo (el resto del código, el mismo)."""
    src = inspect.getsource(module.events)
    for a, b in zip(old, new):
        assert src.count(a) == 1, (module.__name__, a)
        src = src.replace(a, b)
    exec(compile(src, module.__file__, "exec"), module.__dict__)


def patch(code, mode):
    if code == "BE":
        box_elements._BE_EARLY = mode == "actual"
        box_elements._BE_LATE = mode == "primera"
        _patch(box_elements,
               ["                    armed[side] = False\n                    rng = ",
                "                    lo, hi = (z[\"low\"], z[\"low\"] + share * height) if side > 0"],
               ["                    armed[side] = armed[side] and not _BE_EARLY\n                    rng = ",
                "                    if _BE_LATE:\n                        armed[side] = False\n"
                "                    lo, hi = (z[\"low\"], z[\"low\"] + share * height) if side > 0"])
    else:
        vp_sessions._VF_CLOSE = mode == "cierre"
        _patch(vp_sessions, ['"prev_in": where == 0}'],
               ['"prev_in": (i > 0 and prior["val"] <= bars[i - 1]["c"] <= prior["vah"]) if _VF_CLOSE else where == 0}'])
    module, inner, check = MODULES[code], MODULES[code].events, mode == MODES[code][0]

    def events(*args, **kw):
        out = inner(*args, **kw)
        if check:
            assert out == ORIGINAL[code](*args, **kw), "el reemplazo cambió el modo del motor"
        # La primera llamada de cada corrida es la de la regla; las siguientes, las del control con perfiles desplazados
        COUNTS.setdefault(CURRENT[0], sum(1 for e in out if e["code"] == code))
        return out
    module.events = events


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--regla", required=True)
    ap.add_argument("--modo", required=True)
    ap.add_argument("--grupo", default="base")
    ap.add_argument("--fases", default="1,2,3")
    a = ap.parse_args()
    rule = rt.clean_rule(rp.RULES.get(a.regla) or rp.STAGE6[a.regla])
    codes = {c for s in rule["recipe"]["slots"] for c in s["codes"]}
    code = "BE" if "BE" in codes else "VF"
    assert a.modo in MODES[code], f"{code} va con {MODES[code]}"
    patch(code, a.modo)
    out = {"rule": a.regla, "name": rule["name"], "code": code, "mode": a.modo, "group": a.grupo, "cells": {}, "coins": [], "trades": {}}
    started = time.time()
    for n in [int(x) for x in a.fases.split(",")]:
        items = []
        for symbol in rt.candle_symbols(a.grupo):
            phase = next((p for p in rt.phases(symbol) if p["phase"] == n), None)
            if phase is None or not phase["available"] or not rt.has_candles(symbol, rule["tf"]):
                continue
            if code == "VF" and (not rt.has_store(symbol) or not rt._span_path(symbol, rule["tf"], phase, rule).exists()):
                continue
            CURRENT[0] = (symbol, n)
            span = rt.detect_span(symbol, rule["tf"], phase, rule)
            res = rt.run(symbol, rule, span, phase, None, base=True)
            if not res.get("success"):
                continue
            rt.load_run = lambda run_id, res=res: res  # _run_stats lee la corrida por su id: aquí, la recién hecha
            items.append((symbol, sb._run_stats("x")))
            closed = [t for t in res.get("trades") or [] if t.get("r") is not None]
            out["coins"].append({"symbol": symbol, "phase": n, "events": COUNTS.get((symbol, n)), "n": len(closed),
                                 "avgR": round(sum(t["r"] for t in closed) / len(closed), 4) if closed else None})
            out["trades"][f"{symbol} f{n}"] = [[t["signal"], t["dir"], round(t["r"], 4)] for t in closed]
        cell = sb._pool(items) if items else {}
        row = {k: cell.get(k) for k in ("n", "avgR", "seR", "seWeeks", "edge", "legEdge", "quarterEdge", "pass", "withTrades", "positive")}
        row["events"] = sum(c["events"] or 0 for c in out["coins"] if c["phase"] == n)
        row["coins"] = len(items)
        out["cells"][f"f{n}"] = row
        print(a.regla, a.modo, a.grupo, f"f{n}", json.dumps(row, ensure_ascii=False), f"{time.time() - started:.0f} s", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{a.regla}_{a.modo}_{a.grupo}.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
