"""
Protocolo (22/11/2026), etapa 5, paso 2: la tabla de las corridas de BTC del usuario con sus capas A, B y C, armada con
lo que dejaron las herramientas (capa A en evidencia/capa_a/E5_*.json, capa B en etapa5/capa_b_etapa5.log, capturas en
pantalla/E5_*/lineas*.json). Imprime la tabla en Markdown para el informe.

Uso (desde backend/): python -B tests/audit/tabla_etapa5.py
"""
import json
import re
import sys
from pathlib import Path

EV = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia")


def capa_a(run_id):
    sym = run_id.split("_")[0]
    ph = run_id.split("_")[2][1:]
    path = EV / "capa_a" / f"E5_{run_id}_{sym}_f{ph}.json"
    if not path.exists():
        return None
    rep = json.loads(path.read_text(encoding="utf-8"))
    calls = rep.get("calls")
    a = rep.get("mismatch_a") or {}
    b = rep.get("mismatch_b") or {}
    sel = rep.get("selection") or {}
    text = f"{calls:,} llamadas: A " + ("igual" if not a else f"distinto {a}") + " · B " + ("igual" if not b else ", ".join(f"{k} {v}" for k, v in b.items()))
    if sel and not sel.get("same", True):
        text += " · selección distinta"
    return text


def capa_b(folder):
    log = (EV / "etapa5" / "capa_b_etapa5.log").read_text(encoding="utf-8")
    found = None
    for line in log.splitlines():
        m = re.match(rf"{re.escape(folder)}: leídos (\d+) de (\d+) trades; faltan (\[.*?\]); con diferencias (\d+)", line)
        if m:
            found = m  # la última línea de la carpeta manda (la de después de arreglar el redondeo)
    if not found:
        return None
    read, total, missing, diffs = found.groups()
    return f"{read} de {total}, {diffs} distintos" if missing == "[]" else f"{read} de {total}, faltan {missing}"


def capa_c(folder):
    lines = []
    for f in sorted((EV / "pantalla" / folder).glob("lineas*.json")):
        d = json.loads(f.read_text(encoding="utf-8"))
        lines += d["lines"]
    if not lines:
        return None
    bad = [l for l in lines if not l.endswith(" ok")]
    return f"{len(lines) - len(bad)} de {len(lines)} bien" + (f", {len(bad)} con aviso" if bad else "")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    tags = {}
    for line in (EV / "etapa5" / "corridas_btc.txt").read_text(encoding="utf-8").splitlines():
        tag, run_id = line.strip().split("|")
        tags[run_id] = tag
    print("| Regla | Corrida | Trades | R medio | Capa A (oráculos) | Capa B (pantalla) | Capa C (capturas) |")
    print("|---|---|---|---|---|---|---|")
    for line in (EV / "etapa5" / "carpetas_btc.txt").read_text(encoding="utf-8").splitlines():
        folder, run_id = line.strip().split("|")
        rep = None
        import gzip
        for p in (EV.parent / "observer_aislado" / "tester" / "runs").glob(f"{run_id}.json*"):
            opener = gzip.open if p.suffix == ".gz" else open
            with opener(p, "rt", encoding="utf-8") as fh:
                rep = json.load(fh)
        n = len(rep["trades"]) if rep else "?"
        avg = (rep.get("summary") or {}).get("avgR") if rep else None
        print(f"| {tags.get(run_id, '?')} | `{run_id}` | {n} | {avg:+.3f} | {capa_a(run_id) or 'pendiente'} | {capa_b(folder) or 'pendiente'} | {capa_c(folder) or 'pendiente'} |")


if __name__ == "__main__":
    main()
