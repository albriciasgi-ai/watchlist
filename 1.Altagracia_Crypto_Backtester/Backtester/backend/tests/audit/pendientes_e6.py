"""
Protocolo (22/11/2026), etapa 6: qué trades de cada corrida falta capturar o repetir.

Para cada corrida de la etapa (las de `evidencia/corridas_etapa6.log` que van a la capa C) mira su carpeta
`evidencia/pantalla/E6_<regla>_<moneda>_f1`: los números de trade sin captura (`trade_NNNN.json`), y los que tienen
captura pero su última línea en `lineas*.json` trae aviso (⚠) o su captura salió sin la tabla de la señal.

Uso: python -B tests/audit/pendientes_e6.py   → imprime un JSON {carpeta: {run, total, faltan, repetir}}
"""
import gzip
import json
import re
import sys
from pathlib import Path

EV = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia")
RUNS = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado\tester\runs")
# Lo que no va a la capa C: las reglas de BTC 15m de order flow, perfil y liquidaciones (van en ARB) y las acciones en
# 5m y 30m (F-11)
SKIP = re.compile(r"^(E-(VR|VF|VX|VE|LIQs|LIQz|VA|VAg|OG|AP|SL|RL|EX|ZP|RS|DD|PD|IV|AD|SW|VL|SQ|DB|PW|DV|VI|IR|RD|VD|TP|OP|RX|XD|SM|BR|GR|ST|DT) BTCUSDT)")


def runs():
    out = {}
    for line in (EV / "corridas_etapa6.log").read_text(encoding="utf-8").splitlines():
        m = re.match(r"(\S+) (\S+) (\{.*\}) ", line)
        if not m:
            continue
        rule, sym, info = m.group(1), m.group(2), json.loads(m.group(3))
        if info.get("run") and not SKIP.match(f"{rule} {sym}"):
            out[f"E6_{rule}_{sym}_f1"] = info["run"]
    return out


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    res = {}
    for folder, run in runs().items():
        path = RUNS / f"{run}.json.gz"
        if not path.exists():
            continue
        total = len(json.load(gzip.open(path))["trades"])
        d = EV / "pantalla" / folder
        have = {int(m.group(1)) for f in d.glob("trade_*.json") if (m := re.match(r"trade_(\d+)\.json$", f.name))} if d.exists() else set()
        last = {}
        if d.exists():
            for f in sorted(d.glob("lineas*.json"), key=lambda p: (p.name != "lineas.json", p.stat().st_mtime)):
                try:
                    data = json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    continue
                for line in data.get("lines", []):
                    m = re.match(r"#(\d+) ", line)
                    if m:
                        last[int(m.group(1))] = line
        missing = [n for n in range(1, total + 1) if n not in have]
        redo = sorted(n for n, l in last.items() if "⚠" in l)
        # Una captura sin línea en ningún archivo: la pestaña se cerró antes de guardar sus líneas (cada 2 minutos) y
        # su comprobación automática no se conoce
        redo += [n for n in sorted(have) if n not in last]
        # Las líneas de las primeras colas no marcaban una captura sin la tabla de la señal: se mira en cada captura
        for n in sorted(have):
            if n in redo:
                continue
            try:
                t = json.loads((d / f"trade_{n:04d}.json").read_text(encoding="utf-8"))
            except Exception:
                continue
            if not t.get("table"):
                redo.append(n)
        res[folder] = {"run": run, "total": total, "faltan": len(missing), "rangos": ranges(missing), "repetir": sorted(set(redo))}
    print(json.dumps(res, ensure_ascii=False))


def ranges(ns):
    out, start = [], None
    for i, n in enumerate(ns):
        if start is None:
            start = n
        if i == len(ns) - 1 or ns[i + 1] != n + 1:
            out.append([start, n])
            start = None
    return out


if __name__ == "__main__":
    main()
