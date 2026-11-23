"""
Protocolo (22/11/2026), etapa 6: anota el resultado de los pasos de la hoja Chequeo y de las confusiones probadas en
pantalla, para pasarlos al Excel al final. Junta lo nuevo con lo que ya había.

Uso: python -B tests/audit/anotar.py pasos|confusiones '{"12": {"estado": "Pasa", "notas": "..."}}'
Escribe evidencia/etapa6/<pasos|confusiones>_pantalla.json
"""
import json
import sys
from pathlib import Path

OUT = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa6")


def main(kind, payload):
    path = OUT / f"{kind}_pantalla.json"
    data = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for key, value in json.loads(payload).items():
        data[str(key)] = value
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(data)} anotados en {path.name}")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main(sys.argv[1], sys.argv[2])
