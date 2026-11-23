"""
Capa B del protocolo (21/11/2026): lo que la pantalla dijo de cada trade (guardado por el receptor) contra la corrida
guardada, y la corrida guardada contra la misma regla corrida otra vez desde cero (I-10, repetible).

Uso: python -B tests/audit/comparar_capa_b.py <carpeta de pantalla> <id de la corrida> [--sin-repetir]
"""
import datetime as dt
import gzip
import json
import os
import re
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import rule_tester as rt  # noqa: E402
import measures  # noqa: E402

PANTALLA = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\pantalla")
COL = dt.timezone(dt.timedelta(hours=-5))
TIME_RE = re.compile(r"(\d{2})/(\d{2})/(\d{2}), (\d{1,2}):(\d{2})\s*([ap])\.\s*m\.")


def stamp(ms):
    """La hora como la escribe la ventana (es-CO, America/Bogota): dd/mm/aa, hh:mm a. m."""
    d = dt.datetime.fromtimestamp(ms / 1000, COL)
    h = d.hour % 12 or 12
    return f"{d:%d/%m/%y}, {h:02d}:{d:%M} {'a' if d.hour < 12 else 'p'}. m."


def js_fixed(x, digits):
    """Como Number(x.toFixed(digits)) de la página: el valor exacto del número y, en un empate, hacia afuera (−1.125 → −1.13).
    round() de Python va al par (−1.12) y daba diferencias que no eran de la app."""
    from decimal import Decimal, ROUND_HALF_UP
    q = Decimal(abs(x)).quantize(Decimal(1).scaleb(-digits), rounding=ROUND_HALF_UP)
    return float(-q if x < 0 else q)


def num6(x):
    """Number(x.toFixed(6)) como texto."""
    s = f"{x:.6f}".rstrip("0").rstrip(".")
    return s


def parse(text):
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    head = re.match(r"Trade (\d+) · (Largo|Corto) · ([+\-−]?[\d.]+) R · (.+)$", lines[0])
    out = {"n": int(head.group(1)), "dir": 1 if head.group(2) == "Largo" else -1,
           "r": float(head.group(3).replace("−", "-").replace("+", "")), "reason": head.group(4).strip()}
    times = lines[1]
    m = re.match(r"Señal (.+?) · entrada (.+?) \((\w+)\) · salida (.+)$", times)
    out.update(signal=m.group(1), entry_t=m.group(2), order=m.group(3), exit_t=m.group(4))
    prices = lines[2]
    m = re.match(r"Entrada ([\d.]+) · stop ([\d.]+) \(([\d.]+) ATR\)(?: · objetivo ([\d.]+))? · salida ([\d.]+)", prices)
    out.update(entry=m.group(1), stop=m.group(2), stop_atr=float(m.group(3)), target=m.group(4), exit=m.group(5))
    # Etapa 6: "no se cumplía todo" también contiene "se cumplía todo" (lo halló un revisor en FL-MED: las señales de
    # antes de la tabla de medidas dicen "no se cumplía todo" y la comprobación las daba por buenas)
    out["all_ok"] = "se cumplía todo" in text and "no se cumplía todo" not in text
    return out


def compare_screen(folder, run):
    trades = {t["n"]: t for t in run["trades"]}
    rows, bad = [], []
    files = sorted((PANTALLA / folder).glob("trade_*.json"))
    for path in files:
        info = json.loads(path.read_text(encoding="utf-8"))
        n = info["n"]
        t = trades.get(n)
        if t is None:
            bad.append({"n": n, "why": "no está en la corrida"})
            continue
        try:
            p = parse(info["detail"])
        except Exception as error:
            bad.append({"n": n, "why": f"no se pudo leer el detalle: {error}"})
            continue
        expect = {
            "dir": t["dir"], "r": js_fixed(t["r"], 2), "reason": t["reason"],
            "signal": stamp(t["signal"]), "entry_t": stamp(t["entry_t"]), "exit_t": stamp(t["exit_t"]),
            "order": "limit" if t["order"] == "limit" else "mercado",
            "entry": str(t["entry"]).rstrip("0").rstrip(".") if isinstance(t["entry"], float) else str(t["entry"]),
            "stop": num6(t["stop"]), "stop_atr": t["stop_atr"], "target": num6(t["target"]) if t.get("target") is not None else None,
            "exit": num6(t["exit"]),
        }
        diffs = {}
        for key, want in expect.items():
            got = p.get(key)
            if key == "entry":
                ok = abs(float(got) - float(t["entry"])) < 1e-12
            elif key in ("r", "stop_atr"):
                ok = abs(float(got) - float(want)) < 1e-9
            else:
                ok = got == want
            if not ok:
                diffs[key] = {"pantalla": got, "corrida": want}
        if not p["all_ok"]:
            diffs["tabla"] = "la tabla de la señal no dice que se cumplía todo"
        rows.append(n)
        if diffs:
            bad.append({"n": n, "diffs": diffs})
    return {"read": len(rows), "trades": len(trades), "missing": sorted(set(trades) - set(rows)), "bad": bad}


def rerun(run):
    """La regla guardada, corrida otra vez desde cero en su tramo, contra sus trades guardados."""
    symbol, rule = run["symbol"], rt.saved_rule(run)
    phase = next(p for p in rt.phases(symbol) if p["phase"] == run["phase"])
    if phase["from"] != run["from"] or phase["to"] != run["to"]:
        phase = {**phase, "from": run["from"], "to": run["to"], "start": rt._ms(run["from"]), "end": rt._ms(run["to"]) + rt.DAY_MS}
    span = rt.detect_span(symbol, rule["tf"], phase, rule)
    fresh = rt.run(symbol, rule, span, phase, measures.table_for(symbol), base=False)
    key = lambda t: (t["entry_t"], t["dir"], round(t["entry"], 10), round(t["exit"], 10), t["exit_t"], round(t["r"], 4), t["reason"])
    a, b = [key(t) for t in run["trades"]], [key(t) for t in fresh["trades"]]
    return {"saved": len(a), "fresh": len(b), "same": a == b, "only_saved": [x for x in a if x not in b][:5],
            "only_fresh": [x for x in b if x not in a][:5]}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    folder, run_id = sys.argv[1], sys.argv[2]
    run = rt.load_run(run_id)
    rep = {"folder": folder, "run": run_id, "screen": compare_screen(folder, run)}
    if "--sin-repetir" not in sys.argv:
        rep["rerun"] = rerun(run)
    out = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\capa_b")
    out.mkdir(parents=True, exist_ok=True)
    (out / f"{folder}.json").write_text(json.dumps(rep, ensure_ascii=False, indent=1), encoding="utf-8")
    s = rep["screen"]
    print(f"{folder}: leídos {s['read']} de {s['trades']} trades; faltan {s['missing']}; con diferencias {len(s['bad'])}")
    for item in s["bad"][:10]:
        print("  ", item)
    if "rerun" in rep:
        print("  repetida desde cero:", rep["rerun"])
