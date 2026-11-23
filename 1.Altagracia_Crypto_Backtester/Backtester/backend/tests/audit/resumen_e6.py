"""
Protocolo (22/11/2026), etapa 6: tabla de la capa C por corrida, para `pruebas_backtesting/revision_visual/E6_*.md`.

Para cada carpeta `evidencia/pantalla/E6_*`:
- trades de la corrida (los de su archivo en el registro aislado) y capturas guardadas (`trade_NNNN.json`);
- la comprobación automática de cada trade: la última línea de cada número en `lineas*.json` (una repetición manda
  sobre la primera), con o sin aviso;
- la capa B: la última corrida de `comparar_capa_b.py` en `evidencia/etapa6/capa_b_lote*.log` (leídos, faltan, con
  diferencias y si repetida desde cero da lo mismo) y los trades que difieren;
- las hojas de contactos.

Uso: python -B tests/audit/resumen_e6.py [--md salida.md]
"""
import gzip
import json
import re
import sys
from pathlib import Path

EV = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia")
RUNS = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado\tester\runs")


def capa_b():
    """Por carpeta, lo de la última vez que se corrió la capa B (los lotes se leen en orden)."""
    out = {}
    logs = sorted((EV / "etapa6").glob("capa_b_lote*.log"), key=lambda p: int(re.sub(r"\D", "", p.stem) or 0))
    for log in logs:
        cur = None
        for line in log.read_text(encoding="utf-8", errors="replace").splitlines():
            m = re.match(r"== (\S+) (\S+)", line)
            if m:
                cur = out[m.group(1)] = {"run": m.group(2), "diffs": []}
                continue
            if cur is None:
                continue
            m = re.search(r"leídos (\d+) de (\d+) trades; faltan \[(.*?)\]; con diferencias (\d+)", line)
            if m:
                cur.update(read=int(m.group(1)), total=int(m.group(2)), missing=len([x for x in m.group(3).split(",") if x.strip()]),
                           ndiff=int(m.group(4)))
            m = re.search(r"\{'n': (\d+), 'diffs'", line)
            if m:
                cur["diffs"].append(int(m.group(1)))
            if "repetida desde cero" in line:
                cur["fresh_same"] = "'same': True" in line
            m = re.search(r"hojas: (\d+)", line)
            if m:
                cur["sheets"] = int(m.group(1))
    return out


def lines_of(folder):
    """La última línea de cada trade entre todos los archivos de líneas de la carpeta (los repetidos mandan)."""
    last = {}
    files = sorted(folder.glob("lineas*.json"), key=lambda p: (p.name != "lineas.json", p.stat().st_mtime))
    for f in files:
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue
        for line in data.get("lines", []):
            m = re.match(r"#(\d+) ", line)
            if m:
                last[int(m.group(1))] = line
    return last


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    out_md = sys.argv[sys.argv.index("--md") + 1] if "--md" in sys.argv else None
    cb = capa_b()
    rows = []
    for folder in sorted((EV / "pantalla").glob("E6_*")):
        if not folder.is_dir() or "PASO" in folder.name:
            continue
        info = cb.get(folder.name, {})
        run = info.get("run")
        total = None
        if run and (RUNS / f"{run}.json.gz").exists():
            total = len(json.load(gzip.open(RUNS / f"{run}.json.gz"))["trades"])
        shots = len(list(folder.glob("trade_*.json")))
        last = lines_of(folder)
        warn = sorted(n for n, l in last.items() if "⚠" in l)
        sheets = len(list(folder.glob("hoja_*.jpg")))
        rows.append({"carpeta": folder.name, "corrida": run, "trades": total, "capturas": shots, "con_linea": len(last),
                     "avisos": warn, "capa_b": {k: info.get(k) for k in ("read", "total", "missing", "ndiff", "fresh_same")},
                     "capa_b_diffs": info.get("diffs", []), "hojas": sheets})
    print(json.dumps(rows, ensure_ascii=False, indent=1))
    if out_md:
        md = ["| Carpeta | Trades | Capturas | Avisos de la comprobación | Capa B (leídos · distintos · repetida) | Hojas |",
              "|---|---|---|---|---|---|"]
        for r in rows:
            b = r["capa_b"]
            bt = "—" if b.get("read") is None else f"{b['read']} de {b['total']} · {b['ndiff']} · {'igual' if b.get('fresh_same') else 'distinta'}"
            md.append(f"| {r['carpeta']} | {r['trades'] or '—'} | {r['capturas']} | {len(r['avisos'])}"
                      + (f" ({', '.join(map(str, r['avisos'][:8]))}{'…' if len(r['avisos']) > 8 else ''})" if r["avisos"] else "")
                      + f" | {bt} | {r['hojas']} |")
        Path(out_md).write_text("\n".join(md) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
