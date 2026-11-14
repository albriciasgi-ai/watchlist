# -*- coding: utf-8 -*-
"""
Precisión esperada de cada nivel del diseño (Nivel 0, 1, 2 y 2+).

Propaga por Monte Carlo, a través del simulador (no lineal), el error de
cada dato de lanzamiento. Los σ de cada nivel salen de los cálculos de
radar_doppler.py y camara_estroboscopio.py, o son SUPUESTOS cuando el
nivel no mide ese dato (se usa un valor típico del palo y su dispersión).

Uso:  python niveles_diseno.py   (escribe resultados/niveles_diseno.md)
"""
import math
import os

import numpy as np

from comun import escenarios_atmosfera, tabla_md
import trayectoria as T

DIR_RES = T.DIR_RES
RNG = np.random.default_rng(14112026)
N_MC = 160

GOLPES = {
    "Driver PGA": dict(vb=171.0, vla=10.4, spin=2545.0),
    "Hierro 7 PGA": dict(vb=123.0, vla=16.1, spin=7124.0),
    "Driver aficionado (supuesto)": dict(vb=135.0, vla=13.0, spin=3000.0),
}

# σ (1 sigma) por nivel. vb en fracción; ángulos en grados; giro en rpm.
# Para cada dato: (σ driver, σ hierro 7). "no mide" = se usa un valor
# típico del palo con esa dispersión (SUPUESTO).
NIVELES = {
    "Nivel 0: teléfono 240 fps": dict(
        vb=(0.030, 0.030), vla=(1.0, 1.0), spin=(600.0, 1200.0), hla=(2.0, 2.0), eje=(4.0, 4.0),
        nota="vb: escala por el diámetro de ~40 px ±1 px (2.5%), centroide y obturador rodante; "
             "giro y eje no medidos"),
    "Nivel 1: solo radar": dict(
        vb=(0.0085, 0.013), vla=(2.0, 2.5), spin=(600.0, 1200.0), hla=(2.5, 2.5), eje=(4.0, 4.0),
        nota="vb: coseno corregido con un VLA supuesto por palo ±2-2.5° más 0.5% de geometría; "
             "VLA, giro, HLA y eje no medidos"),
    "Nivel 2: radar + cámara GS + estroboscopio": dict(
        vb=(0.003, 0.003), vla=(0.2, 0.2), spin=(150.0, 170.0), hla=(0.4, 0.4), eje=(3.0, 1.0),
        nota="una cámara de lado; HLA por el tamaño (σ diámetro 0.3-0.5 px); giro por 4-6 "
             "imágenes con σθ ≈ 1.5-2°"),
    "Nivel 2+: dos cámaras o base más larga": dict(
        vb=(0.002, 0.002), vla=(0.15, 0.15), spin=(100.0, 120.0), hla=(0.2, 0.2), eje=(1.5, 0.7),
        nota="estéreo o más imágenes del giro; supuesto optimista"),
}


def propagar(g, sig, idx, modelo, atm):
    """RMS y percentil 95 del error de carry y de offline (yd)."""
    base = T.simular(g["vb"], g["vla"], g["spin"], atm=atm, modelo=modelo)
    e_c, e_o = [], []
    for _ in range(N_MC):
        vb = g["vb"] * (1 + RNG.normal(0, sig["vb"][idx]))
        vla = g["vla"] + RNG.normal(0, sig["vla"][idx])
        spin = max(500.0, g["spin"] + RNG.normal(0, sig["spin"][idx]))
        hla = RNG.normal(0, sig["hla"][idx])
        eje = RNG.normal(0, sig["eje"][idx])
        r = T.simular(vb, vla, spin, hla_deg=hla, eje_deg=eje, atm=atm, modelo=modelo)
        e_c.append(r["carry_yd"] - base["carry_yd"])
        e_o.append(r["offline_yd"] - base["offline_yd"])
    e_c, e_o = np.array(e_c), np.array(e_o)
    return (math.sqrt(np.mean(e_c ** 2)), float(np.percentile(np.abs(e_c), 95)),
            math.sqrt(np.mean(e_o ** 2)), float(np.percentile(np.abs(e_o), 95)))


def main():
    esc = escenarios_atmosfera()
    modelo = T.modelo_final()
    partes = ["# Precisión esperada por nivel del diseño\n",
              f"Monte Carlo con {N_MC} golpes por celda a través del simulador (modelo final). "
              "Solo errores de los sensores: falta sumar el error del modelo de vuelo.\n"]
    filas_sup = []
    for nivel, sig in NIVELES.items():
        filas_sup.append([nivel, f"{100*sig['vb'][0]:.2f}% / {100*sig['vb'][1]:.2f}%",
                          f"{sig['vla'][0]} / {sig['vla'][1]}",
                          f"{sig['spin'][0]:.0f} / {sig['spin'][1]:.0f}",
                          f"{sig['hla'][0]} / {sig['hla'][1]}",
                          f"{sig['eje'][0]} / {sig['eje'][1]}", sig["nota"]])
    partes.append("**σ supuestos por nivel** (driver / hierro 7)\n")
    partes.append(tabla_md(["Nivel", "Velocidad", "VLA °", "Giro rpm", "HLA °", "Eje °", "Base"],
                           filas_sup))
    partes.append("")
    filas = []
    for atm_clave, atm_nombre in (("mar_isa", "Nivel del mar"), ("bog_calida", "Bogotá")):
        for nombre, g in GOLPES.items():
            idx = 1 if "Hierro" in nombre else 0
            for nivel, sig in NIVELES.items():
                rc, pc, ro, po = propagar(g, sig, idx, modelo, esc[atm_clave])
                filas.append([atm_nombre, nombre, nivel, f"{rc:.1f}", f"{pc:.1f}", f"{ro:.1f}",
                              f"{po:.1f}"])
    partes.append("**Error de carry y de offline por los sensores** (yd)\n")
    partes.append(tabla_md(["Aire", "Golpe", "Nivel", "Carry RMS", "Carry P95",
                            "Offline RMS", "Offline P95"], filas))
    partes.append("")
    partes.append("Error del modelo de vuelo (de trayectoria.py): RMS de carry 1.3-4.3 yd frente a "
                  "TrackMan a nivel del mar; en Bogotá la dependencia de Re deja una banda de "
                  "+3% a +13.5% (driver) y +9% a +20% (hierro 7) sin calibración local.")
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "niveles_diseno.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
