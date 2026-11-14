# -*- coding: utf-8 -*-
"""
Presupuesto de latencia del disparo (trigger) de la cámara/estroboscopio.

Disparos comparados: acústico (micrófono), barrera infrarroja y radar.
Para cada uno: latencia total, distancia que recorre la bola en ese
tiempo, y dónde debe empezar y terminar el campo de visión.

Las latencias de los detectores son SUPUESTOS de orden de magnitud
(marcados en las tablas); la propagación del sonido sí se calcula.

Uso:  python latencia_disparo.py   (escribe resultados/latencia_disparo.md)
"""
import math
import os

from comun import D_BOLA, M_BOLA, MPH, velocidad_sonido, tabla_md

DIR_RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados")

# Latencias de detección (s): (mínimo, máximo). SUPUESTOS.
DETECTOR = {
    "comparador analógico + interrupción de microcontrolador": (5e-6, 20e-6),
    "umbral sobre el frente del sonido del impacto": (20e-6, 100e-6),
    "fotodiodo + comparador": (1e-6, 5e-6),
    "fototransistor": (10e-6, 50e-6),
    "detección del tono Doppler en el microcontrolador (ventana 0.5-2 ms)": (0.5e-3, 2.0e-3),
    "pila de audio de PC o teléfono (búfer)": (5e-3, 50e-3),
}


def separacion_palo_bola(v_palo, smash, m_palo, vla_deg):
    """Velocidad con que la bola se separa de la cara del palo (m/s).

    Conservación del momento en 1D (supuesto): m_p·v_p = m_p·v_p' + m_b·v_b.
    La bola sube con el VLA y el palo sigue casi horizontal.
    """
    v_b = smash * v_palo
    v_p2 = v_palo - M_BOLA * v_b / m_palo
    th = math.radians(vla_deg)
    dx = v_b * math.cos(th) - v_p2
    dz = v_b * math.sin(th)
    return v_b, v_p2, math.hypot(dx, dz)


def main():
    os.makedirs(DIR_RES, exist_ok=True)
    partes = ["# Latencia del disparo: cálculos\n"]

    # 1. Propagación del sonido
    filas = []
    for t_c in (14.0, 15.0, 22.0):
        c = velocidad_sonido(t_c + 273.15)
        fila = [f"{t_c:.0f} °C", f"{c:.1f}"]
        for d in (0.1, 0.3, 0.5, 1.0, 2.0):
            fila.append(f"{d/c*1000:.2f}")
        filas.append(fila)
    partes.append("**1. Tiempo de vuelo del sonido del impacto hasta el micrófono (ms)**\n")
    partes.append(tabla_md(["Aire", "c m/s", "0.1 m", "0.3 m", "0.5 m", "1.0 m", "2.0 m"], filas))
    partes.append("")

    # 2. Presupuestos por tipo de disparo
    c = velocidad_sonido(287.15)
    presupuestos = {
        "Acústico, micrófono a 0.3 m, detección analógica + MCU": (
            0.3 / c + DETECTOR["umbral sobre el frente del sonido del impacto"][0]
            + DETECTOR["comparador analógico + interrupción de microcontrolador"][0],
            0.3 / c + DETECTOR["umbral sobre el frente del sonido del impacto"][1]
            + DETECTOR["comparador analógico + interrupción de microcontrolador"][1]),
        "Acústico, micrófono a 0.1 m, detección analógica + MCU": (
            0.1 / c + 20e-6 + 5e-6, 0.1 / c + 100e-6 + 20e-6),
        "Acústico por la tarjeta de sonido del PC": (0.3 / c + 5e-3, 0.3 / c + 50e-3),
        "Radar: tono de la bola detectado en el MCU": (0.5e-3 + 5e-6, 2.0e-3 + 20e-6),
        "Radar procesado en el PC (audio)": (5e-3, 50e-3),
    }
    filas = []
    for nombre, (lo, hi) in presupuestos.items():
        fila = [nombre, f"{lo*1000:.2f}–{hi*1000:.2f}"]
        for v in (45.0, 75.0, 85.0):
            fila.append(f"{v*lo*1000:.0f}–{v*hi*1000:.0f}")
        filas.append(fila)
    for gap in (0.01, 0.02, 0.05):
        fila = [f"Barrera IR a {gap*100:.0f} cm delante de la bola (fotodiodo)", ""]
        tiempos = []
        for v in (45.0, 75.0, 85.0):
            t_lo = gap / v + 1e-6
            t_hi = gap / v + 5e-6
            tiempos.append((t_lo, t_hi))
            fila.append(f"{gap*1000 + v*1e-6*1000:.0f}–{gap*1000 + v*5e-6*1000:.0f}")
        fila[1] = (f"{min(t[0] for t in tiempos)*1000:.2f}–{max(t[1] for t in tiempos)*1000:.2f} "
                   "(según v)")
        filas.append(fila)
    partes.append("**2. Latencia total y distancia recorrida por la bola** (detectores: supuestos "
                  "de orden de magnitud; la barrera IR dispara por POSICIÓN: la bola siempre está "
                  "en la barrera)\n")
    partes.append(tabla_md(["Disparo", "Latencia ms", "Bola a 45 m/s: mm", "75 m/s: mm",
                            "85 m/s: mm"], filas))
    partes.append("")

    # 3. Separación entre la bola y el palo después del impacto
    filas = []
    for nombre, v_palo_mph, smash, m_palo, vla in (
            ("Driver PGA", 115.0, 1.49, 0.200, 10.4),
            ("Hierro 7 PGA", 92.0, 1.34, 0.260, 16.1),
            ("Wedge (PW PGA)", 83.0, 1.23, 0.290, 24.2)):
        v_b, v_p2, sep = separacion_palo_bola(v_palo_mph * MPH, smash, m_palo, vla)
        t_1d = D_BOLA / sep
        filas.append([nombre, f"{v_palo_mph:.0f} mph · {m_palo*1000:.0f} g", f"{v_b:.1f}",
                      f"{v_p2:.1f}", f"{sep:.1f}", f"{t_1d*1000:.2f}",
                      f"{v_b*t_1d*1000:.0f}"])
    partes.append("**3. ¿Cuándo se despega la bola del palo?** (momento lineal en 1D; masas de "
                  "cabeza SUPUESTAS; ignora los ~0.5 ms de contacto) — tiempo hasta que entre la "
                  "bola y la cara hay un diámetro de bola\n")
    partes.append(tabla_md(["Golpe", "Palo", "v bola m/s", "v palo después m/s",
                            "Separación m/s", "t para 1 D de luz ms", "Bola recorrió mm"], filas))
    partes.append("")

    # 4. Campo de visión necesario según el disparo
    filas = []
    n_img = 4
    casos = [("Driver", 75.0, 12.0), ("Wedge", 45.0, 30.0)]
    disparos = [
        ("Acústico 0.3 m + MCU, Δt fijo", 0.3 / c + 25e-6, 0.3 / c + 120e-6, False, None),
        ("Radar en MCU, Δt fijo", 0.505e-3, 2.02e-3, False, None),
        ("Barrera IR a 2 cm, Δt fijo", None, None, False, 0.02),
        ("Dos barreras IR (miden v), Δt adaptado", None, None, True, 0.02),
    ]
    retardo = 0.5e-3          # espera extra tras el disparo para despegar del palo (supuesto)
    dt_fijo = 1.3e-3          # dentro del rango común de 4 imágenes (camara_estroboscopio.py)
    recorrido_obj = 0.25      # recorrido deseado entre la 1.ª y la última imagen (adaptativo)
    for nombre, lat_lo, lat_hi, adaptativo, gap in disparos:
        xs = []
        for _, v, vla in casos:
            ct = math.cos(math.radians(vla))
            dt = (recorrido_obj / ((n_img - 1) * v * ct)) if adaptativo else dt_fijo
            if gap is not None:
                x1_lo = x1_hi = gap + D_BOLA / 2 + v * ct * retardo
            else:
                x1_lo = v * ct * (lat_lo + retardo)
                x1_hi = v * ct * (lat_hi + retardo)
            x_fin = x1_hi + (n_img - 1) * v * ct * dt
            xs.append((x1_lo, x_fin, dt))
        inicio = min(x[0] for x in xs) - D_BOLA / 2
        fin = max(x[1] for x in xs) + D_BOLA / 2
        filas.append([nombre,
                      " · ".join(f"{cn}: 1.ª {x[0]*1000:.0f} mm, última {x[1]*1000:.0f} mm, "
                                 f"Δt {x[2]*1e6:.0f} µs" for (cn, _, _), x in zip(casos, xs)),
                      f"{inicio*1000:.0f}", f"{fin*1000:.0f}", f"{(fin-inicio)*1000:.0f}"])
    partes.append(f"**4. Campo de visión necesario** para {n_img} imágenes de driver (75 m/s, 12°) y "
                  f"wedge (45 m/s, 30°) con la misma configuración; espera extra de "
                  f"{retardo*1e3:.1f} ms tras el disparo; Δt fijo = {dt_fijo*1e6:.0f} µs; con dos "
                  f"barreras el Δt se elige para {recorrido_obj*100:.0f} cm de recorrido. "
                  "Distancias horizontales desde la posición inicial del centro de la bola\n")
    partes.append(tabla_md(["Disparo", "Posiciones de la bola", "Campo desde mm",
                            "Campo hasta mm", "Ancho necesario mm"], filas))
    partes.append("")
    filas = []
    for sep in (0.03, 0.05, 0.08):
        fila = [f"{sep*100:.0f} cm"]
        for v in (45.0, 75.0, 85.0):
            t = sep / v
            err_reloj = 2e-6 / t          # 2 µs de incertidumbre del flanco (supuesto)
            fila.append(f"{t*1e6:.0f} µs → ±{100*err_reloj:.2f}%")
        filas.append(fila)
    partes.append("Dos barreras IR para medir la velocidad y adaptar el Δt: tiempo entre barreras y "
                  "error relativo con ±2 µs de incertidumbre de cada flanco (supuesto)\n")
    partes.append(tabla_md(["Separación", "45 m/s", "75 m/s", "85 m/s"], filas))
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "latencia_disparo.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
