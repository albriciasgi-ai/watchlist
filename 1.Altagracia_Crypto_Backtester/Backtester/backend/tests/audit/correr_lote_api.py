"""
Protocolo (22/11/2026), etapa 6: corre varias reglas de prueba en el backend AISLADO (9300) por su API, como la ventana,
una tras otra, y anota cada corrida (con su moneda) en un registro de la evidencia, una línea por corrida:
    <regla> <moneda> {"run": ..., "stored": ...} <segundos>s

Uso: python -B tests/audit/correr_lote_api.py <registro.log> BTCUSDT:1:E-QA,E-QF ARBUSDT:1:E-VA,...
"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import correr_api as ca  # noqa: E402

EV = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia")


def main(argv):
    sys.stdout.reconfigure(encoding="utf-8")
    log = EV / argv[0]
    for group in argv[1:]:
        symbol, phase, names = group.split(":")
        for name in names.split(","):
            t0 = time.time()
            try:
                out = ca.run(name, symbol, int(phase), confirm=True)
            except Exception as e:  # una corrida que falla no detiene a las demás
                out = {"error": repr(e)}
            line = f"{name} {symbol} {json.dumps(out, ensure_ascii=False)} {round(time.time() - t0)}s"
            print(line, flush=True)
            with open(log, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")


if __name__ == "__main__":
    main(sys.argv[1:])
