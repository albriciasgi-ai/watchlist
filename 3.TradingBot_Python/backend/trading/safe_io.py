"""Escritura segura de los archivos de estado del bot (paso 4 de la integracion, 12/11/2026)."""
import json
import os
import time
from pathlib import Path
from typing import Any


def write_json_atomic(path, data: Any, indent: int = 2) -> None:
    """
    Escribe en un temporal junto al archivo y lo reemplaza de una vez: un corte de luz o un cierre a mitad nunca
    deja el archivo a medias. En Windows el reemplazo falla si otro programa tiene el archivo abierto en ese
    instante (otra app que lo lee, OneDrive): se reintenta unas veces antes de dar error, y el archivo anterior
    queda intacto.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=indent)
        f.flush()
        os.fsync(f.fileno())
    for attempt in range(8):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 7:
                raise
            time.sleep(0.05 * (attempt + 1))
