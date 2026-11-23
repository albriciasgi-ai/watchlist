"""
Los controles de "pasa" (protocolo de pruebas, 22/11/2026):
- B-07: cada trade contra el azar de su trimestre y su lado. La regla suele operar donde y cuando el azar también gana.
- B-08: el margen con los trades agrupados por la semana de su salida: los de una misma semana se mueven juntos.
Uso: python -m pytest tests/test_controles_b07_b08.py
"""
import math

import rule_tester as rt
import strategy_board as sb

WEEK = 7 * 86400000
Q1, Q3 = 1_704_067_200_000, 1_719_792_000_000  # 01/01/2024 (2024T1) y 01/07/2024 (2024T3)


def test_el_error_agrupado_por_semana_es_mas_ancho_si_la_semana_se_mueve_junta():
    # 40 trades en 4 semanas: dos semanas ganan todo y dos pierden todo
    rows = [(1.0 if w < 2 else -1.0, w * WEEK + i) for w in range(4) for i in range(10)]
    n, mean = len(rows), 0.0
    iid = math.sqrt(sum(r * r for r, _ in rows) / (n - 1) / n)
    groups = {}
    for r, t in rows:
        cell = groups.setdefault(rt.week_of(t), [0, 0.0])
        cell[0] += 1
        cell[1] += r
    assert rt.clustered_se(groups, mean, n, iid) > 3 * iid
    # Dentro de cada semana se compensan: el agrupado sería 0, y nunca baja del de trades independientes
    mixed = {w: [10, 0.0] for w in range(4)}
    assert rt.clustered_se(mixed, 0.0, 40, iid) == iid


def result_with(trades, quarters, base_avg=0.0):
    return {"trades": trades, "summary": rt.summary(sorted(trades, key=lambda t: t["exit_t"])),
            "baseline": {"n": 3000, "avgR": base_avg, "seR": 0.02, "quarters": quarters}}


def trades_where_the_random_also_wins():
    """Largos en 2024T1, donde el azar de los largos ganó +0.5 R; cortos en 2024T3, donde el de los cortos ganó +0.5 R.
    El azar de toda la fase dio 0: contra él la regla parece ganar +0.5 R por trade."""
    trades = []
    for i in range(60):
        start = (Q1 if i < 30 else Q3) + (i % 30) * 2 * 86400000  # Cada dos días, dentro de su trimestre
        trades.append({"r": 0.5 + (0.3 if i % 2 else -0.3), "dir": 1 if i < 30 else -1, "entry_t": start, "exit_t": start + 3600000,
                       "bars": 2, "mfe": 1.0, "mae": -0.5, "reach": 1.0, "reason": "objetivo"})
    quarters = {"2024T1": {"1": [500, 250.0], "-1": [500, -250.0]}, "2024T3": {"1": [500, -250.0], "-1": [500, 250.0]}}
    return trades, quarters


def test_contra_el_azar_de_su_trimestre_y_lado_la_ventaja_desaparece():
    trades, quarters = trades_where_the_random_also_wins()
    result = result_with(trades, quarters)
    out = rt.edges(rt.trade_rows(result), result["summary"], result["baseline"], None)
    assert out["edge"]["r"] == 0.5 and out["edge"]["low"] > 0
    assert out["quarterEdge"]["r"] == 0.0 and out["quarterEdge"]["low"] < 0 < out["quarterEdge"]["high"]
    # Con pocas entradas al azar en un trimestre se usa el azar de toda la fase
    thin = {"2024T1": {"1": [5, 2.5]}, "2024T3": {"-1": [5, 2.5]}}
    alone = rt.edges(rt.trade_rows(result_with(trades, thin)), result["summary"], result["baseline"], None)
    assert alone["quarterEdge"]["r"] == alone["edge"]["r"] == 0.5


def test_el_tablero_no_da_pasa_sin_ganarle_al_azar_de_su_trimestre_y_lado(monkeypatch):
    trades, quarters = trades_where_the_random_also_wins()
    result = {**result_with(trades, quarters), "legBaseline": {"n": 3000, "avgR": 0.0, "seR": 0.02}}
    monkeypatch.setattr(rt, "load_run", lambda run_id: result)
    stats = sb._run_stats("X")
    cell = sb._pool([("BTCUSDT", stats)])
    assert cell["edge"]["low"] > 0 and cell["legEdge"]["low"] > 0 and cell["avgR"] > 0
    assert cell["quarterEdge"]["r"] == 0.0 and not cell["pass"]
    # La misma regla con el azar de cada trimestre en 0: pasa
    flat = {q: {side: [500, 0.0] for side in ("1", "-1")} for q in quarters}
    result["baseline"]["quarters"] = flat
    assert sb._pool([("BTCUSDT", sb._run_stats("X"))])["pass"]


def test_el_margen_del_tablero_es_el_del_informe_todas(monkeypatch):
    """Los dos juntan las semanas de todas las monedas: el mismo margen."""
    trades, quarters = trades_where_the_random_also_wins()
    result = result_with(trades, quarters)
    monkeypatch.setattr(rt, "load_run", lambda run_id: {**result, "legBaseline": {"n": 3000, "avgR": 0.0, "seR": 0.02}})
    cell = sb._pool([("BTCUSDT", sb._run_stats("X"))])
    out = rt.edges(rt.trade_rows(result), result["summary"], result["baseline"], None)
    assert cell["seWeeks"] == out["seWeeks"]
    assert (cell["edge"]["low"], cell["quarterEdge"]["low"]) == (out["edge"]["low"], out["quarterEdge"]["low"])
