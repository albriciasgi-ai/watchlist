"""
Protocolo (22/11/2026), etapa 6: arma la lista de tramos del reparto común de las pestañas (`workInit` de capa_bc.js)
con lo que falta capturar o repetir de cada corrida.

Lee la salida de `pendientes_e6.py` (JSON) y, si se dan, los puntos exactos en que quedaron las pestañas que estaban
capturando (`--hecho carpeta=desde-hasta,...`: esos trades ya están, aunque `pendientes_e6.py` no los viera). Corta lo
que falta en tramos de `--tamano` trades (120) y las repeticiones sueltas en tramos `only`. Pone primero las corridas de
`--primero` (las que el backend tiene en memoria) y después las demás, cada corrida junta.

Uso: python -B tests/audit/reparto_e6.py pendientes.json [--hecho E6_R35-5_ARBUSDT_f1=111-480,...] [--primero E6_R35-5_ARBUSDT_f1,...]
     [--quitar E6_R35-1D_BTCUSDT_f1,...] [--rehacer E6_R35-30_ARBUSDT_f1,...] [--tamano 120] > tramos.json
"""
import json
import re
import sys

# Opciones de la captura por regla: las de la FVG (marcos R35 y filtros FL) comprueban el hueco
FVG_RULES = re.compile(r"^E6_(R35-|FL-)")


def ranges(ns):
    out, start = [], None
    for i, n in enumerate(ns):
        if start is None:
            start = n
        if i == len(ns) - 1 or ns[i + 1] != n + 1:
            out.append([start, n])
            start = None
    return out


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    pend = json.load(open(sys.argv[1], encoding="utf-8"))
    size = int(arg("--tamano", "120"))
    done = {}
    for part in filter(None, (arg("--hecho", "") or "").split(",")):
        folder, span = part.split("=")
        a, b = (int(x) for x in span.split("-"))
        done.setdefault(folder, set()).update(range(a, b + 1))
    first = [x for x in (arg("--primero", "") or "").split(",") if x]
    drop = set(x for x in (arg("--quitar", "") or "").split(",") if x)
    redo = set(x for x in (arg("--rehacer", "") or "").split(",") if x)
    chunks = []
    order = first + sorted(k for k in pend if k not in first)
    for folder in order:
        info = pend.get(folder)
        if not info or folder in drop:
            continue
        sym = folder.split("_")[2]
        opts = {"fvg": {}} if FVG_RULES.match(folder) else {}
        base = {"name": folder, "run": info["run"], "sym": sym, "opts": opts}
        if folder in redo:
            # toda la corrida otra vez (encuadre nuevo)
            missing = list(range(1, info["total"] + 1))
            repeat = []
        else:
            missing = sorted(n for a, b in info["rangos"] for n in range(a, b + 1) if n not in done.get(folder, set()))
            # Lo hecho después de leer los pendientes se mira otra vez al final (sus avisos aún no se conocen)
            repeat = [n for n in info["repetir"] if n not in done.get(folder, set())]
        for a, b in ranges(missing):
            for s in range(a, b + 1, size):
                chunks.append({**base, "from": s, "to": min(b, s + size - 1)})
        rep = sorted(set(repeat) - set(missing))
        for i in range(0, len(rep), 60):
            chunks.append({**base, "only": rep[i:i + 60]})
    print(json.dumps(chunks, ensure_ascii=False))
    total = sum((c["to"] - c["from"] + 1) if "from" in c else len(c["only"]) for c in chunks)
    print(f"{len(chunks)} tramos, {total} trades", file=sys.stderr)


if __name__ == "__main__":
    main()
