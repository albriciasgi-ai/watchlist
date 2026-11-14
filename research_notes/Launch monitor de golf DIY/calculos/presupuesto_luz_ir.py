# -*- coding: utf-8 -*-
"""
Presupuesto de luz del estroboscopio infrarrojo (orden de magnitud).

Cadena: LED (intensidad radiante I, W/sr) → irradiancia en la bola E = I/d²
→ bola lambertiana de reflectancia ρ → radiancia L = ρ·E/π → irradiancia
en el sensor E_s = π·L·T/(4·N²·(1+m)²) → energía por píxel en el pulso
→ fotones → electrones (eficiencia cuántica QE).

Dato citado: OSRAM SFH 4715AS, 900 mW/sr típico a 1 A, 860 nm, haz de 80°.
SUPUESTOS (explícitos en la salida): ρ de la bola, T de la lente, QE del
sensor en el IR cercano, intensidad proporcional a la corriente en pulsos
cortos, objetivo de electrones por píxel.

Uso:  python presupuesto_luz_ir.py   (escribe resultados/presupuesto_luz_ir.md)
"""
import math
import os

from comun import C_LUZ, H_PLANCK, tabla_md

DIR_RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados")

I_LED_1A = 0.900        # W/sr, SFH 4715AS típico a 1 A (dato citado)
LAMBDA = 860e-9         # m
RHO_BOLA = 0.8          # supuesto: cubierta blanca, reflexión difusa en el IR cercano
T_LENTE = 0.9           # supuesto
SAT_E = 10_636          # e-, saturación del IMX296 mono (informe EMVA de FLIR Firefly)


def electrones_por_pixel(i_total, d, n_f, t_p, pix, qe, f=6e-3):
    e_bola = i_total / d ** 2
    m = f / (d - f)
    e_sensor = RHO_BOLA * e_bola * T_LENTE / (4 * n_f ** 2 * (1 + m) ** 2)
    energia = e_sensor * pix ** 2 * t_p
    fotones = energia / (H_PLANCK * C_LUZ / LAMBDA)
    return fotones * qe


def main():
    os.makedirs(DIR_RES, exist_ok=True)
    partes = ["# Presupuesto de luz del estroboscopio IR\n",
              f"Supuestos: ρ bola = {RHO_BOLA}, T lente = {T_LENTE}, λ = {LAMBDA*1e9:.0f} nm, "
              f"LED de referencia SFH 4715AS = {I_LED_1A:.2f} W/sr a 1 A (típico), intensidad "
              "proporcional a la corriente en pulsos (supuesto: revisar la corriente de pulso "
              "máxima en la hoja de datos). Saturación del IMX296 mono ≈ "
              f"{SAT_E:,} e-.\n"]

    # 1. Electrones por píxel con UN LED a 1 A
    filas = []
    for sensor, pix in (("IMX296", 3.45e-6), ("OV9281", 3.0e-6)):
        for qe in (0.10, 0.20, 0.35):
            for n_f in (1.4, 2.0, 2.8):
                fila = [sensor, f"{qe:.2f}", f"{n_f}"]
                for d in (0.4, 0.5, 0.7):
                    for t_p in (10e-6, 20e-6):
                        fila.append(f"{electrones_por_pixel(I_LED_1A, d, n_f, t_p, pix, qe):.0f}")
                filas.append(fila)
    partes.append("**1. Electrones por píxel en la bola con UN LED SFH 4715AS a 1 A** "
                  "(LED junto a la cámara)\n")
    partes.append(tabla_md(["Sensor", "QE (supuesto)", "f/#",
                            "0.4 m 10 µs", "0.4 m 20 µs", "0.5 m 10 µs", "0.5 m 20 µs",
                            "0.7 m 10 µs", "0.7 m 20 µs"], filas))
    partes.append("")

    # 2. Intensidad radiante necesaria para un objetivo de electrones
    filas = []
    pix = 3.45e-6
    for objetivo in (300, 1000):
        for qe in (0.10, 0.20, 0.35):
            for n_f in (1.4, 2.0):
                for t_p in (10e-6, 20e-6):
                    d = 0.5
                    e1 = electrones_por_pixel(1.0, d, n_f, t_p, pix, qe)
                    i_nec = objetivo / e1                      # W/sr
                    filas.append([f"{objetivo}", f"{qe:.2f}", f"{n_f}", f"{t_p*1e6:.0f}",
                                  f"{i_nec:.1f}", f"{i_nec/I_LED_1A:.0f}",
                                  f"{i_nec/(3*I_LED_1A):.0f}", f"{i_nec/(d*d):.0f}"])
    partes.append("**2. Intensidad radiante necesaria** (IMX296 a 0.5 m) para 300 e- (SNR de "
                  "ruido de disparo ≈ 17, mínimo con ganancia) o 1,000 e- (SNR ≈ 32, ~10% de "
                  "saturación)\n")
    partes.append(tabla_md(["Objetivo e-", "QE", "f/#", "Pulso µs", "I necesaria W/sr",
                            "N.º de LEDs a 1 A", "N.º de LEDs a 3 A (supuesto)",
                            "Irradiancia en la bola W/m²"], filas))
    partes.append("")

    # 3. Luz ambiente contra el destello
    filas = []
    n_led, corriente, d = 12, 3.0, 0.5
    e_led = n_led * corriente * I_LED_1A / d ** 2          # W/m² durante el pulso
    n_dest, t_p = 4, 20e-6
    energia_dest = e_led * n_dest * t_p
    for t_exp in (2e-3, 5e-3):
        for nombre, e_amb in (("Sol directo, filtro de 50 nm (≈1 W/m²/nm, referencia)", 50.0),
                              ("Luz de día indirecta, 1% del sol (supuesto)", 0.5),
                              ("Bombillo halógeno a 2 m (supuesto)", 0.2),
                              ("LED blanco de interior (casi sin IR, supuesto)", 0.002)):
            energia_amb = e_amb * t_exp
            filas.append([nombre, f"{t_exp*1e3:.0f}", f"{e_amb:g}",
                          f"{energia_amb/energia_dest:.2f}"])
    partes.append(f"**3. Luz ambiente contra el destello** — {n_led} LEDs a {corriente:.0f} A a "
                  f"{d} m dan {e_led:.0f} W/m² en la bola; {n_dest} destellos de {t_p*1e6:.0f} µs. "
                  "Cociente = energía ambiente / energía del destello que integra el píxel durante "
                  "toda la exposición (debe ser << 1)\n")
    partes.append(tabla_md(["Ambiente", "Exposición ms", "Irradiancia en banda W/m²",
                            "Ambiente / destello"], filas))
    partes.append("")

    # 4. Alimentación del destello
    filas = []
    for n_led, corriente in ((12, 1.0), (12, 3.0), (24, 3.0)):
        v_f = 1.65 * (corriente / 1.0) ** 0.15        # supuesto: V_F sube poco con la corriente
        potencia = n_led * corriente * v_f
        energia = potencia * 20e-6 * 4
        carga = corriente * 20e-6 * 4                  # cadena en serie
        caida_1000uf = carga / 1000e-6
        filas.append([f"{n_led} en serie", f"{corriente:.0f}", f"{n_led*v_f:.1f}",
                      f"{potencia:.0f}", f"{energia*1000:.1f}", f"{caida_1000uf:.2f}"])
    partes.append("**4. Alimentación** — una cadena en serie con un MOSFET; V_F ≈ 1.65 V a 1 A "
                  "(dato de catálogo del SFH 4715A); 4 destellos de 20 µs por golpe; condensador "
                  "local de 1,000 µF\n")
    partes.append(tabla_md(["LEDs", "Corriente A", "Tensión de la cadena V", "Potencia en el "
                            "pulso W", "Energía por golpe mJ", "Caída en 1,000 µF V"], filas))
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "presupuesto_luz_ir.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
