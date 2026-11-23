"""
Protocolo (23/11/2026): la tabla de E-02 y E-08 con lo que dejó medir_e02_e08.py, cada lectura contra la del motor.

Uso (desde backend/): python -B tests/audit/resumen_e02_e08.py
Escribe evidencia/etapa7/e02_e08/RESUMEN.md
"""
import json
import sys
from pathlib import Path

DIR = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7\e02_e08")
ORDER = {"BE": ("actual", "primera", "cada"), "VF": ("abre", "cierre")}
GROUPS = {"base": "las de siempre", "new": "las nuevas"}


def edge(cell, key):
    e = cell.get(key) or {}
    return f"{e['r']:+.3f} ({e['low']:+.2f} a {e['high']:+.2f})" if e else "—"


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    runs = {}
    for path in sorted(DIR.glob("*.json")):
        d = json.loads(path.read_text(encoding="utf-8"))
        runs[(d["rule"], d["group"], d["mode"])] = d
    lines = ["# E-02 y E-08: cada lectura contra la del motor", "",
             "Medido con `tests/audit/medir_e02_e08.py` (el motor 6, sin cambiarlo: solo la función de los eventos en ese proceso).",
             "Ventajas: R por trade sobre el azar de la fase, sobre seguir el tramo y sobre el azar del trimestre y el lado,",
             "con el margen agrupado por semanas, como el tablero. Trades distintos: por moneda, la señal y el lado.", ""]
    for rule in sorted({k[0] for k in runs}):
        some = next(v for k, v in runs.items() if k[0] == rule)
        modes = ORDER[some["code"]]
        lines += [f"## {some['name']} ({some['code']})", ""]
        for group in ("base", "new"):
            present = [m for m in modes if (rule, group, m) in runs]
            if not present:
                continue
            lines += [f"**{GROUPS[group]}**", "",
                      "| Fase | Lectura | Eventos | Trades | R por trade | Contra el azar | Contra el tramo | Contra su trimestre | Pasa | Trades distintos del motor |",
                      "|---|---|---|---|---|---|---|---|---|---|"]
            ref = runs.get((rule, group, modes[0]))
            phases = sorted({p for m in present for p in runs[(rule, group, m)]["cells"]})
            for phase in phases:
                for mode in present:
                    d = runs[(rule, group, mode)]
                    cell = d["cells"].get(phase) or {}
                    if not cell:
                        continue
                    diff = "—"
                    if ref is not None and mode != modes[0]:
                        only_new = only_ref = 0
                        for key, trades in d["trades"].items():
                            if not key.endswith(phase):
                                continue
                            mine = {(t, s) for t, s, _ in trades}
                            theirs = {(t, s) for t, s, _ in ref["trades"].get(key, [])}
                            only_new += len(mine - theirs)
                            only_ref += len(theirs - mine)
                        diff = f"+{only_new} / −{only_ref}"
                    lines.append(f"| {phase} | {mode} | {cell.get('events')} | {cell.get('n')} | {cell.get('avgR'):+.3f} | {edge(cell, 'edge')} | "
                                 f"{edge(cell, 'legEdge')} | {edge(cell, 'quarterEdge')} | {'sí' if cell.get('pass') else 'no'} | {diff} |"
                                 if cell.get("avgR") is not None else f"| {phase} | {mode} | {cell.get('events')} | {cell.get('n')} | — | — | — | — | no | {diff} |")
            lines.append("")
    text = "\n".join(lines) + "\n"
    (DIR / "RESUMEN.md").write_text(text, encoding="utf-8")
    print(text)


if __name__ == "__main__":
    main()
