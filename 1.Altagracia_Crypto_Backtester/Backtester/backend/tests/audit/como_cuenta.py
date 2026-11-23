"""
Protocolo (22/11/2026), etapa 4, sección 9.5: "Como cuenta" recalculado aparte, desde la documentación (CLAUDE.md de
App 1, "Como cuenta (18/11)"), contra `accountStats` de la página (`como_cuenta.mjs`, con node).

Cada trade arriesga riskPct % del capital que hay al entrar y su resultado (R por lo arriesgado) entra al salir; a la
misma hora, primero las salidas. Retornos diarios en UTC, con los días sin cierres en cero. Sharpe = media ÷ desviación
× √365; Sortino = media ÷ raíz de la media de los cuadrados de los días negativos × √365. Retorno anual compuesto con 3
meses o más. Mayor caída sobre el capital en cada cierre. Meses positivos y peor mes. Posiciones a la vez.

Uso (desde backend/): python -B tests/audit/como_cuenta.py [--riesgo 1]
"""
import argparse
import datetime as dt
import json
import math
import os
import subprocess
import sys
import tempfile
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import rule_tester as rt  # noqa: E402
from informes import candidates  # noqa: E402

DAY = 86400000
OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\informes")


def day_of(ms):
    return ms // DAY


def account(trades, risk_pct=1.0, sample_sd=True, downside_all_days=False):
    """trades: [(entrada, salida, r)]. Devuelve las cifras de la cuenta (variantes de las definiciones ambiguas)."""
    risk = risk_pct / 100
    # Un trade que sale a la misma hora en que entra sale 1 ms después (convención de la página): otro que entra en ese
    # mismo instante no ve su resultado
    events = sorted([(max(t[1], t[0] + 1), 0, i) for i, t in enumerate(trades)] + [(t[0], 1, i) for i, t in enumerate(trades)])
    equity, risked, open_now, max_open = 1.0, {}, 0, 0
    closes = []  # (hora, capital) en cada salida
    entered = set()
    for when, kind, i in events:  # a la misma hora, primero las salidas (kind 0), salvo la del propio trade
        if kind == 1 and i in entered:
            continue
        if kind == 1 or i not in entered:
            # Un trade que sale a la misma hora en que entra (stop en su primer minuto): entra antes de salir
            risked[i] = equity * risk
            entered.add(i)
            open_now += 1
            max_open = max(max_open, open_now)
            if kind == 1:
                continue
        equity += trades[i][2] * risked.pop(i)
        open_now -= 1
        closes.append((when, equity))
    first, last = day_of(min(t[0] for t in trades)), day_of(max(t[1] for t in trades))
    end_of_day, eq = {}, 1.0
    for when, value in closes:
        end_of_day[day_of(when)] = value
    returns, prev = [], 1.0
    for d in range(first, last + 1):
        value = end_of_day.get(d, prev)
        returns.append(value / prev - 1)
        prev = value
    n = len(returns)
    mean = sum(returns) / n
    var = sum((r - mean) ** 2 for r in returns) / ((n - 1) if sample_sd and n > 1 else n)
    neg = [r for r in returns if r < 0]
    down = math.sqrt(sum(r * r for r in neg) / (n if downside_all_days else max(1, len(neg)))) if neg else 0.0
    peak, dd = 1.0, 0.0
    for _, value in closes:
        peak = max(peak, value)
        dd = max(dd, (peak - value) / peak)
    months, cur, start_eq, month_returns = {}, None, 1.0, []
    eq_by_day = {}
    prev = 1.0
    for d in range(first, last + 1):
        prev = end_of_day.get(d, prev)
        eq_by_day[d] = prev
    for d in range(first, last + 1):
        key = dt.datetime.fromtimestamp(d * 86400, dt.timezone.utc).strftime("%Y-%m")
        months[key] = eq_by_day[d]
    prev = 1.0
    for key in sorted(months):
        month_returns.append(months[key] / prev - 1)
        prev = months[key]
    years = n / 365
    r2 = lambda x, k=2: round(x, k)  # noqa: E731
    return {"trades": len(trades), "days": n, "years": r2(years), "totalReturn": r2((equity - 1) * 100, 1),
            "annualReturn": r2((equity ** (1 / years) - 1) * 100, 1) if years >= 0.25 and equity > 0 else None,
            "sharpe": r2(mean / math.sqrt(var) * math.sqrt(365)) if var > 0 else None,
            "sortino": r2(mean / down * math.sqrt(365)) if down > 0 else None,
            "maxDrawdown": r2(dd * 100, 1), "worstDay": r2(min(returns) * 100), "bestDay": r2(max(returns) * 100),
            "maxOpen": max_open, "maxOpenRisk": r2(max_open * risk * 100), "months": len(month_returns),
            "positiveMonths": sum(1 for r in month_returns if r > 0), "worstMonth": r2(min(month_returns) * 100, 1)}


def page(trades, risk_pct):
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as fh:
        json.dump({"trades": trades, "riskPct": risk_pct}, fh)
        path = fh.name
    try:
        out = subprocess.run(["node", str(HERE / "como_cuenta.mjs"), path], capture_output=True, text=True, encoding="utf-8", check=True)
    finally:
        os.unlink(path)
    got = json.loads(out.stdout)
    got.pop("equity", None)
    return got


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--riesgo", type=float, default=1.0)
    a = ap.parse_args()
    rep = []
    for digest, rows in candidates(4):
        rule = next(iter(rows.values()))["rule"]
        out = rt.consolidated(rule, 1, "base")
        trades = out["trades"]
        js = page(trades, a.riesgo)
        variants = {"desviación muestral, bajista solo con días negativos": account(trades, a.riesgo, True, False),
                    "desviación muestral, bajista con todos los días": account(trades, a.riesgo, True, True),
                    "desviación poblacional, bajista solo con días negativos": account(trades, a.riesgo, False, False),
                    "desviación poblacional, bajista con todos los días": account(trades, a.riesgo, False, True)}
        best, diffs = None, None
        for label, mine in variants.items():
            d = {k: (js.get(k), v) for k, v in mine.items() if js.get(k) != v}
            if best is None or len(d) < len(diffs):
                best, diffs = label, d
        rep.append({"regla": rule.get("name"), "trades": len(trades), "página": js, "la que más coincide": best, "distintos": diffs})
        print(f"{rule.get('name')}: {len(trades)} trades · coincide con «{best}» · distintos {diffs if diffs else 'ninguno'}", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "como_cuenta.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1, default=str), encoding="utf-8")


if __name__ == "__main__":
    main()
