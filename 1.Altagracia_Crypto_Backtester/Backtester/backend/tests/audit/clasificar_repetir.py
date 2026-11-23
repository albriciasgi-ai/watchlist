"""
Protocolo (22/11/2026), etapa 5: la causa de cada trade que cambió al repetir las corridas del usuario
(`repetir_corridas.py`), para que ninguno quede sin explicar.

Causas, en este orden:
  almacén nuevo       la moneda tiene hoy almacén de trades armado después de la corrida, y sin él la corrida sale igual
  abierto al final    un trade nuevo que en la guardada seguía abierto al terminar sus datos (la fase 3 crece)
  hueco al final      la guardada cerró el trade por un hueco de datos en sus últimos días; hoy los datos siguen
  vela dudosa         la misma entrada, otra salida en la misma vela: la guardada es de antes del motor 3 y contaba el stop
  inicio de fase      la fase 1 de la moneda empieza otro día que cuando se corrió (SNX: velas de 15m más cortas)
  ms                  solo la hora de la salida, en 1 a 3 ms (O-03)
  sin explicar        lo demás
Uso (desde backend/): python -B tests/audit/clasificar_repetir.py repetir_1388 [repetir_errores ...]
Escribe evidencia/etapa5/<primero>_causas.json y un resumen.
"""
import collections
import datetime as dt
import json
import os
import sys
from pathlib import Path

os.environ.setdefault("ORDERFLOW_OBSERVER", r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado")
os.environ.setdefault("TESTER_AUTO_UPDATE", "0")
HERE = Path(__file__).resolve().parent
os.chdir(HERE.parents[1])
sys.path.insert(0, str(HERE.parents[1]))
sys.path.insert(0, str(HERE))
import rule_tester as rt  # noqa: E402
import repetir_corridas as rc  # noqa: E402

OUT = rc.OUT


def phase_start(symbol, phase):
    return next((p["start"] for p in rt.phases(symbol) if p["phase"] == phase), None)


def cause_of(row, d, saved, start_now):
    end = rc.to_ms(saved.get("to"))
    end = end + 86400000 if end and isinstance(saved.get("to"), str) else end  # "to" es el último día: termina al final del día
    g, n = d.get("guardada") or {}, d.get("nueva") or {}
    tf_ms = (saved["rule"]["tf"] or 240) * 60000
    if d["tipo"] == "ms":
        return "ms"
    if d["tipo"] == "solo en la nueva" and end and n.get("exit_t", 0) >= end - tf_ms:
        return "abierto al final"
    if d["tipo"] == "salida" and g.get("reason") == "hueco de datos":
        return "hueco al final"
    if d["tipo"] == "salida" and (saved.get("engine") or 0) < 3 and g.get("reason") == "stop" and n.get("reason") == "objetivo" \
            and g["exit_t"] // tf_ms == n["exit_t"] // tf_ms:
        return "vela dudosa"
    from_saved = rc.to_ms(saved.get("from"))
    if start_now and from_saved and start_now != from_saved and (g.get("signal") or n.get("signal") or 0) < max(start_now, from_saved) + 60 * 86400000:
        return "inicio de fase"
    return "sin explicar"


def main(names):
    sys.stdout.reconfigure(encoding="utf-8")
    rows = []
    for name in names:
        rows += json.loads((OUT / f"{name}.json").read_text(encoding="utf-8"))
    by_id = {}
    for r in rows:
        by_id[r["id"]] = r  # el último archivo manda (las corridas repetidas después de un error)
    out, tally, runs = [], collections.Counter(), collections.Counter()
    for r in by_id.values():
        if r["veredicto"] != "DISTINTA":
            runs[r["veredicto"]] += 1
            continue
        saved = rt.load_run(r["id"])
        start_now = phase_start(r["moneda"], r["fase"])
        ce = r.get("como entonces (sin el almacén nuevo)")
        causes = collections.Counter()
        # Sin el almacén las velas son las de entonces, pero los minutos se siguen leyendo del almacén (`_context` pone
        # siempre fs.minutes): una salida que solo cambia de hora (mismo precio, motivo y R) también es del almacén nuevo
        # (o cuyo minuto de salida ahora sale de esos minutos: la vela dudosa la deciden los minutos reales)
        only_time = ce and all(d["tipo"] in ("ms", "salida") and (set(d.get("campos", [])) <= {"exit_t"} or
                                                                   (d["nueva"]["exit_t"] % 60000 == 0 and d["guardada"]["exit_t"] % 60000 != 0))
                               for d in ce["diferencias"])
        if ce and (ce["veredicto"] in ("igual", "igual salvo ms") or only_time):
            causes["almacén nuevo"] = sum(v for k, v in r["cuentas"].items() if k not in ("iguales", "nuevos después del final de la guardada"))
            detail = []
        else:
            diffs = ce["diferencias"] if ce else r["diferencias"]
            if ce:
                causes["almacén nuevo"] += 1  # además de lo que queda sin él
            detail = []
            for d in diffs:
                c = cause_of(r, d, saved, start_now)
                causes[c] += 1
                if c == "sin explicar":
                    detail.append(d)
        main_cause = "almacén nuevo" if "almacén nuevo" in causes else max(causes, key=causes.get)
        runs[main_cause] += 1
        tally.update(causes)
        out.append({"id": r["id"], "moneda": r["moneda"], "fase": r["fase"], "nombre": r["nombre"], "motor": r.get("motor guardado"),
                    "causas": dict(causes), "sin explicar": detail})
    path = OUT / f"{names[0]}_causas.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1, default=str), encoding="utf-8")
    print("corridas:", dict(runs))
    print("trades por causa:", dict(tally))
    for o in out:
        if o["sin explicar"]:
            print("SIN EXPLICAR", o["moneda"], o["fase"], o["nombre"], o["motor"], o["sin explicar"][:3])
    print("->", path)


if __name__ == "__main__":
    main(sys.argv[1:])
