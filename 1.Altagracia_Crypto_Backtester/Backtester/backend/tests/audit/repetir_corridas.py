"""
Protocolo (22/11/2026), etapa 5, sección 12: las corridas reales del usuario, corridas de nuevo desde cero con el motor
de hoy y comparadas trade por trade con las guardadas (copia aislada del registro).

Para cada corrida guardada de las reglas elegidas: la misma regla, la misma moneda y la misma fase; se compara cada
trade por su señal y lado (entrada, salida, precios, motivo y R a 4 decimales). Los trades que caen después del último
día de la guardada (la fase 3 crece con los datos) van aparte.

Cada diferencia se clasifica:
  ms        solo cambia la hora de la salida en 1 a 3 ms (el punto del recorrido supuesto de la vela, O-03);
  salida    la misma entrada y el mismo stop, otra salida (por ejemplo una vela dudosa sin minutos: hasta el motor 3
            contaba el stop, desde el motor 3 sigue el recorrido supuesto);
  entrada   cambia la entrada o el stop (otras velas o elementos);
  solo en la guardada / solo en la nueva.
Si la moneda tiene hoy almacén de trades armado después de la corrida (como SUI, armado el 21-22/11), la regla se corre
otra vez sin el almacén, como cuando se hizo, y se compara también ("como entonces").

Uso (desde backend/): python -B tests/audit/repetir_corridas.py [--nombres "A,,B"] [--ids id1,id2] [--salida nombre]
Escribe evidencia/etapa5/<salida>.json cada 25 corridas y al final, y una línea por corrida.
"""
import argparse
import collections
import datetime as dt
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

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa5")
STORE = Path(r"C:\Users\inven\OrderFlowData\store")
FIELDS = ("entry_t", "exit_t", "entry", "exit", "stop", "reason", "r")
_store_born = {}


def iso(ms):
    return dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d %H:%M") if ms else "—"


def to_ms(x):
    """El final de la guardada: número en ms o una fecha en texto."""
    if x is None or isinstance(x, (int, float)):
        return x
    try:
        d = dt.datetime.fromisoformat(str(x).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return int(d.timestamp() * 1000)
    except ValueError:
        return None


def store_born(symbol):
    """Cuándo se armó el almacén de la moneda (el archivo más viejo), en segundos; None si no tiene."""
    if symbol not in _store_born:
        folder = STORE / symbol
        times = [p.stat().st_mtime for p in folder.rglob("*.npz")] if folder.exists() else []
        _store_born[symbol] = min(times) if times else None
    return _store_born[symbol]


def same(a, b, key):
    if key == "r":
        return a is not None and b is not None and abs(a - b) <= 1e-4 + 1e-12
    if isinstance(a, float) or isinstance(b, float):
        return a is not None and b is not None and abs(a - b) <= 1e-9 * max(1.0, abs(a), abs(b))
    return a == b


def brief(t):
    return {k: t.get(k) for k in ("signal", "dir", "entry_t", "exit_t", "entry", "stop", "exit", "reason", "r")}


def compare(saved, fresh, end_ms):
    key = lambda t: (t["signal"], t["dir"])  # noqa: E731
    S, F = {key(t): t for t in saved["trades"]}, {key(t): t for t in fresh["trades"]}
    out = collections.Counter()
    diffs = []
    r_saved = r_fresh = 0.0
    for k, t in S.items():
        f = F.get(k)
        r_saved += t["r"]
        if f is None:
            out["solo en la guardada"] += 1
            diffs.append({"tipo": "solo en la guardada", "guardada": brief(t)})
            continue
        r_fresh += f["r"]
        diff = [x for x in FIELDS if not same(t.get(x), f.get(x), x)]
        if not diff:
            out["iguales"] += 1
            continue
        if diff == ["exit_t"] and abs(t["exit_t"] - f["exit_t"]) <= 3:
            kind = "ms"
        elif all(same(t.get(x), f.get(x), x) for x in ("entry_t", "entry", "stop")):
            kind = "salida"
        else:
            kind = "entrada"
        out[kind] += 1
        diffs.append({"tipo": kind, "campos": diff, "guardada": brief(t), "nueva": brief(f)})
    for k, f in F.items():
        if k in S:
            continue
        if end_ms and f["signal"] >= end_ms:
            out["nuevos después del final de la guardada"] += 1
        else:
            out["solo en la nueva"] += 1
            r_fresh += f["r"]
            diffs.append({"tipo": "solo en la nueva", "nueva": brief(f)})
    return out, diffs, round(r_saved, 4), round(r_fresh, 4)


def verdict(counts):
    real = {k: v for k, v in counts.items() if k not in ("iguales", "nuevos después del final de la guardada")}
    if not real:
        return "igual"
    if set(real) == {"ms"}:
        return "igual salvo ms"
    return "DISTINTA"


def fresh_run(rec, rule, no_store=False):
    original = rt.has_store
    if no_store:
        rt.has_store = lambda s, _o=original: False if s == rec["symbol"] else _o(s)
    # El tramo de la fase queda en memoria con una llave que no dice si salió del almacén o de las velas: sin limpiarlo,
    # la corrida sin almacén reusaba el tramo armado con el almacén
    with rt._lock:
        rt._spans.clear()
    try:
        phase = next(p for p in rt.phases(rec["symbol"]) if p["phase"] == rec["phase"])
        span = rt.detect_span(rec["symbol"], rule["tf"], phase, rule)
        table = measures.table_for(rec["symbol"]) if rule.get("filters") else None
        return rt.run(rec["symbol"], rule, span, phase, table, base=False)
    finally:
        rt.has_store = original
        if no_store:
            with rt._lock:
                rt._spans.clear()


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--nombres", default="")
    ap.add_argument("--ids", default="")
    ap.add_argument("--limite", type=int, default=0)
    ap.add_argument("--salida", default="")
    a = ap.parse_args()
    names = [x.strip() for x in a.nombres.split(",,") if x.strip()]
    ids = {x.strip() for x in a.ids.split(",") if x.strip()}
    records = [r for r in rt.history(None) if (r["id"] in ids) or ((r.get("rule") or {}).get("name") in names)]
    if a.limite:
        records = records[:a.limite]
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{a.salida or 'repetir_' + dt.datetime.now().strftime('%Y%m%d_%H%M')}.json"
    rows = []
    for i, rec in enumerate(records, 1):
        t0 = time.time()
        try:
            saved = rt.load_run(rec["id"])
            rule = rt.saved_rule(saved)  # las recetas en secuencia vuelven del disco con llaves de texto
            end_ms = to_ms(saved.get("to"))
            fresh = fresh_run(rec, rule)
            counts, diffs, r_saved, r_fresh = compare(saved, fresh, end_ms)
            row = {"id": rec["id"], "nombre": rule.get("name"), "moneda": rec["symbol"], "fase": rec["phase"], "tf": rule["tf"],
                   "motor guardado": saved.get("engine"), "trades guardados": len(saved["trades"]), "trades nuevos": len(fresh["trades"]),
                   "cuentas": dict(counts), "veredicto": verdict(counts), "R guardada": r_saved, "R nueva (mismo tramo)": r_fresh,
                   "diferencias": diffs}
            born = store_born(rec["symbol"])
            run_time = int(rec["id"].rsplit("_", 1)[-1])
            if row["veredicto"] == "DISTINTA" and born and born > run_time and rt.has_store(rec["symbol"]):
                then = fresh_run(rec, rule, no_store=True)
                c2, d2, _, r2 = compare(saved, then, end_ms)
                row["como entonces (sin el almacén nuevo)"] = {"cuentas": dict(c2), "veredicto": verdict(c2), "R nueva": r2,
                                                              "diferencias": d2[:20],
                                                              "almacén armado": dt.datetime.fromtimestamp(born).strftime("%Y-%m-%d %H:%M")}
            row["s"] = round(time.time() - t0, 1)
        except Exception as e:  # una corrida que falla no detiene a las demás
            row = {"id": rec["id"], "nombre": (rec.get("rule") or {}).get("name"), "moneda": rec["symbol"], "fase": rec["phase"],
                   "veredicto": "ERROR", "error": repr(e)}
        rows.append(row)
        extra = ""
        if "como entonces (sin el almacén nuevo)" in row:
            ce = row["como entonces (sin el almacén nuevo)"]
            extra = f" · sin el almacén nuevo: {ce['veredicto']} {ce['cuentas']}"
        print(f"{row['moneda']} f{row['fase']} {row.get('nombre')} (motor {row.get('motor guardado')}): {row['veredicto']} "
              f"{row.get('cuentas', row.get('error'))} R {row.get('R guardada')} → {row.get('R nueva (mismo tramo)')}{extra} {row.get('s', '')} s", flush=True)
        for d in row.get("diferencias", [])[:3]:
            if d["tipo"] == "ms":
                continue
            g, n = d.get("guardada") or {}, d.get("nueva") or {}
            print(f"     {d['tipo']}: señal {iso(g.get('signal') or n.get('signal'))} {'↑' if (g.get('dir') or n.get('dir')) > 0 else '↓'} "
                  + ", ".join(f"{x} {g.get(x)} → {n.get(x)}" for x in d.get("campos", []) if x != "exit_t")
                  + (f"{g.get('reason')} {g.get('r')}" if d["tipo"] == "solo en la guardada" else "")
                  + (f"{n.get('reason')} {n.get('r')}" if d["tipo"] == "solo en la nueva" else ""), flush=True)
        if i % 25 == 0:
            path.write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    path.write_text(json.dumps(rows, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    tally = collections.Counter(r["veredicto"] for r in rows)
    print(f"fin: {len(rows)} corridas · {dict(tally)} → {path}", flush=True)


if __name__ == "__main__":
    main()
