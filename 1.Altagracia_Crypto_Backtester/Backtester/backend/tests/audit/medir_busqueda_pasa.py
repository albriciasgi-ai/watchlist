"""
Protocolo (23/11/2026), pregunta pendiente: ¿la búsqueda genética debe elegir y juzgar con el "pasa" del tablero?

Hoy la búsqueda (rule_search.Evaluator) mide cada regla contra el mejor de dos controles (el azar de la fase y seguir
el tramo), con el margen de trades independientes, y da "Candidata a la fase 2" si en la validación (2023) la ventaja
es positiva y sus vecinas aguantan. El tablero, desde el motor 6, pide ganarles también al azar del trimestre y el lado
de cada trade (B-07), con el margen agrupado por semanas (B-08).

Este script repite las finalistas de búsquedas guardadas con el motor 6 y el Evaluator de la búsqueda (las 7 monedas
de siempre, la fase 1 partida en 2023), y da para cada una, en la búsqueda (antes de 2023) y en la validación (2023):
- como hoy: la ventaja contra el mejor de los dos controles, su margen de trades independientes y la aptitud;
- como el tablero: las tres ventajas por separado con el margen agrupado por semanas, si las tres quedan sobre cero
  con margen ("pasa") y si las tres quedan sobre cero (sin margen), y la aptitud con el control más exigente de los
  tres y el margen por semanas.
No mira las vecinas (la búsqueda las mira solo para sus finalistas). No guarda corridas.

Uso (desde backend/): python -B tests/audit/medir_busqueda_pasa.py 20261120_034002_7224 20261118_230455_3fcb ...
Escribe evidencia/etapa7/busqueda_pasa.json
"""
import json
import math
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
import numpy as np  # noqa: E402
import rule_search as rs  # noqa: E402
import rule_tester as rt  # noqa: E402

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7")


class Medidor(rs.Evaluator):
    def rows(self, rule):
        """Cada trade de la regla, por tramo: (R, azar de la fase, tramo, azar de su trimestre y lado, salida, moneda)."""
        out = {"train": [], "hold": []}
        codes = {c for slot in rule["recipe"]["slots"] for c in slot["codes"]}
        for symbol in self.symbols():
            allowed = rt.codes_for(symbol, rule["tf"])
            if allowed is not None and codes - allowed:
                continue
            item = self.load(symbol, rule["tf"], rule)
            if item is None:
                continue
            result = rt.run(symbol, rule, item["span"], item["phase"], None, base=False)
            if not result.get("success"):
                continue
            trades = result["trades"]
            for segment in ("train", "hold"):
                picked = [t for t in trades if t["exit_t"] < self.split] if segment == "train" else [t for t in trades if t["entry_t"] >= self.split]
                if not picked:
                    continue
                rnd, leg = [self._control(symbol, rule["tf"], item, rule, picked, segment, kind) for kind in ("random", "leg")]
                base = rnd["avgR"] if rnd and rnd["avgR"] is not None else None
                legr = leg["avgR"] if leg and leg["avgR"] is not None else None
                by_q = (rnd or {}).get("q") or {}
                for t in picked:
                    mean, n = by_q.get((rt.quarter_of(t["entry_t"]), t["dir"]), (None, 0))
                    quarter = mean if n >= rt.QUARTER_MIN_RANDOM else base
                    out[segment].append((t["r"], base, legr, quarter, t["exit_t"], symbol))
        return out


def stats(rows, cfg, complexity):
    """Lo de hoy y lo del tablero para unos trades."""
    n = len(rows)
    if n < 2:
        return {"n": n}
    rs_ = [r for r, *_ in rows]
    # Como hoy: contra el mejor de los dos controles de su moneda, con el margen de trades independientes
    by_coin = {}
    for r, base, leg, _, _, symbol in rows:
        by_coin.setdefault(symbol, []).append((r, base, leg))
    today = []
    coins_up = coins_with = 0
    for items in by_coin.values():
        values = [v for v in (items[0][1], items[0][2]) if v is not None]
        ctrl = max(values) if values else 0.0
        today.extend(r - ctrl for r, _, _ in items)
        if len(items) >= rs.MIN_COIN_TRADES:
            coins_with += 1
            coins_up += float(np.mean([r for r, _, _ in items])) - ctrl > 0
    edge_today = float(np.mean(today))
    se_today = float(np.std(today, ddof=1) / math.sqrt(n))
    penalty = rs.COMPLEXITY_R * (complexity - 1) + rs.COIN_R * max(0, min(cfg["minCoins"], coins_with) - coins_up)

    def weekly(values):
        mean = float(np.mean(values))
        groups = {}
        for v, (_, _, _, _, exit_t, _) in zip(values, rows):
            cell = groups.setdefault(rt.week_of(exit_t), [0, 0.0])
            cell[0] += 1
            cell[1] += v
        iid = float(np.std(values, ddof=1) / math.sqrt(n))
        se = rt.clustered_se(groups, mean, n, iid)
        return {"r": round(mean, 3), "low": round(mean - 1.96 * se, 3), "high": round(mean + 1.96 * se, 3), "se": round(se, 4), "iid": round(iid, 4)}

    three = {}
    for name, k in (("edge", 1), ("legEdge", 2), ("quarterEdge", 3)):
        pairs = [(r, row[k]) for r, row in zip(rs_, rows) if row[k] is not None]
        if len(pairs) == n:
            three[name] = weekly([r - c for r, c in pairs])
    strict = [r - max(v for v in (base, leg, quarter) if v is not None) for r, base, leg, quarter, _, _ in rows]
    strict_w = weekly(strict)
    return {
        "n": n, "avgR": round(float(np.mean(rs_)), 3),
        "hoy": {"edge": round(edge_today, 3), "se": round(se_today, 4), "fitness": round(edge_today - se_today - penalty, 3)},
        "tablero": {**three, "pasa": bool(three) and all(v["low"] > 0 for v in three.values()) and float(np.mean(rs_)) > 0,
                    "sobreCero": bool(three) and all(v["r"] > 0 for v in three.values()),
                    "fitness": round(strict_w["r"] - strict_w["se"] - penalty, 3), "contraElPeor": strict_w},
    }


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out, started = [], time.time()
    for search_id in sys.argv[1:]:
        state = rs.load(search_id)
        cfg = state["config"]
        evaluator = Medidor(cfg)
        for number, fin in enumerate(state["report"]["finalists"], 1):
            rule = fin["rule"]
            rows = evaluator.rows(rule)
            complexity = rs.complexity(rule)
            item = {"search": search_id, "finalist": number, "verdictThen": fin["verdict"], "fitnessThen": fin["fitness"],
                    "desc": rt.describe_rule(rule) if hasattr(rt, "describe_rule") else rule.get("name"),
                    "train": stats(rows["train"], cfg, complexity), "hold": stats(rows["hold"], cfg, complexity)}
            hold = item["hold"]
            item["candidataHoy"] = bool(hold.get("n", 0) >= rs.MIN_HOLD_TRADES and hold["hoy"]["edge"] > 0)
            item["candidataSobreCero"] = bool(hold.get("n", 0) >= rs.MIN_HOLD_TRADES and hold["tablero"]["sobreCero"])
            item["candidataPasa"] = bool(hold.get("n", 0) >= rs.MIN_HOLD_TRADES and hold["tablero"]["pasa"])
            out.append(item)
            print(search_id, number, json.dumps({k: item[k] for k in ("verdictThen", "candidataHoy", "candidataSobreCero", "candidataPasa")}, ensure_ascii=False),
                  "| train", json.dumps(item["train"].get("hoy"), ensure_ascii=False), json.dumps({k: v["r"] for k, v in item["train"].get("tablero", {}).items() if isinstance(v, dict) and "r" in v}),
                  "| hold", json.dumps(item["hold"].get("hoy"), ensure_ascii=False), json.dumps({k: v["r"] for k, v in item["hold"].get("tablero", {}).items() if isinstance(v, dict) and "r" in v}),
                  f"{time.time() - started:.0f} s", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "busqueda_pasa.json").write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
