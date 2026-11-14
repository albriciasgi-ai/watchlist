# -*- coding: utf-8 -*-
"""
Corre todos los cálculos en orden y deja las tablas en resultados/.

Requisitos: Python 3.10+ con numpy y scipy (pip install numpy scipy).
Uso:        python ejecutar_todo.py      (unos 4-5 minutos)

trayectoria.py va primero: ajusta el modelo y guarda
resultados/modelo_ajustado.json, que usan sensibilidad.py y niveles_diseno.py.
"""
import contextlib
import io
import os
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, DIR)

import trayectoria            # noqa: E402
import sensibilidad           # noqa: E402
import radar_doppler          # noqa: E402
import camara_estroboscopio   # noqa: E402
import latencia_disparo       # noqa: E402
import presupuesto_luz_ir     # noqa: E402
import niveles_diseno         # noqa: E402

PASOS = [("trayectoria", trayectoria), ("sensibilidad", sensibilidad),
         ("radar_doppler", radar_doppler), ("camara_estroboscopio", camara_estroboscopio),
         ("latencia_disparo", latencia_disparo), ("presupuesto_luz_ir", presupuesto_luz_ir),
         ("niveles_diseno", niveles_diseno)]

if __name__ == "__main__":
    ruta_modelo = os.path.join(DIR, "resultados", "modelo_ajustado.json")
    if os.path.exists(ruta_modelo):
        os.remove(ruta_modelo)       # se vuelve a ajustar desde cero
    for nombre, modulo in PASOS:
        t0 = time.time()
        with contextlib.redirect_stdout(io.StringIO()):
            modulo.main()
        print(f"{nombre:22s} listo en {time.time()-t0:6.1f} s → resultados/{nombre}.md")
