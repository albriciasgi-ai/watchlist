# -*- coding: utf-8 -*-
"""
Cámara de obturador global + estroboscopio infrarrojo.

Sensores: Sony IMX296 (Raspberry Pi Global Shutter Camera, 1456×1088,
3.45 µm) y OmniVision OV9281 (1280×800, 3 µm). Lentes de 4, 6 y 8 mm.
Modelo de lente delgada (sin distorsión).

1. Campo de visión, mm/píxel y diámetro de la bola en píxeles (0.4-0.7 m).
2. Profundidad de campo según el número f.
3. Desenfoque por movimiento según el ancho del pulso (5-50 µs).
4. Separación de los destellos para 3-6 imágenes de la bola en el campo.
5. Rotación de la bola entre destellos (2,000-10,000 rpm) y precisión del giro.
6. Precisión del HLA por la profundidad deducida del tamaño de la bola.
7. Precisión de velocidad y VLA por el error del centroide.
8. Nivel 0: video en cámara lenta de un teléfono (supuestos explícitos).

Uso:  python camara_estroboscopio.py   (escribe resultados/camara_estroboscopio.md)
"""
import math
import os

from comun import D_BOLA, MPH, tabla_md

DIR_RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados")

SENSORES = {
    "IMX296": dict(nx=1456, ny=1088, pix=3.45e-6),
    "OV9281": dict(nx=1280, ny=800, pix=3.0e-6),
}
FOCALES = (4e-3, 6e-3, 8e-3)
DISTANCIAS = (0.4, 0.5, 0.6, 0.7)


def geometria(sensor, f, d):
    """mm por píxel en el plano de la bola, campo W×H (m) y bola en píxeles."""
    s = SENSORES[sensor]
    m_pix = s["pix"] * (d - f) / f          # m por píxel en el objeto
    return dict(mm_px=m_pix * 1000, w=s["nx"] * m_pix, h=s["ny"] * m_pix,
                bola_px=D_BOLA / m_pix,
                hfov=2 * math.degrees(math.atan(s["nx"] * s["pix"] / (2 * f))))


def profundidad_campo(f, d, n_f, coc):
    """Profundidad de campo total (m), lente delgada."""
    h = f * f / (n_f * coc) + f
    cerca = d * (h - f) / (h + d - 2 * f)
    lejos = d * (h - f) / (h - d) if d < h else float("inf")
    return lejos - cerca


def rango_dt(g, v, vla_deg, n_img, margen=0.25, separacion=1.25):
    """Intervalo de destellos admisible (s) para n_img imágenes separadas.

    El centro de la bola debe quedar dentro del campo con un margen de
    margen·D por lado; dos imágenes seguidas deben distar >= separacion·D.
    """
    th = math.radians(vla_deg)
    ux = g["w"] - D_BOLA * (1 + 2 * margen)
    uz = g["h"] - D_BOLA * (1 + 2 * margen)
    dt_min = separacion * D_BOLA / v
    lim = [ux / ((n_img - 1) * v * math.cos(th))]
    if math.sin(th) > 0:
        lim.append(uz / ((n_img - 1) * v * math.sin(th)))
    return dt_min, min(lim)


def factor_regresion(n):
    """σ de la pendiente de una recta con n puntos equiespaciados que
    abarcan una longitud L: σ_pendiente = σ_punto·factor/L."""
    return (n - 1) * math.sqrt(12.0 / (n * (n * n - 1)))


def main():
    os.makedirs(DIR_RES, exist_ok=True)
    partes = ["# Cámara y estroboscopio: cálculos\n"]

    # 1. Campo de visión
    filas = []
    for sensor in SENSORES:
        for f in FOCALES:
            for d in DISTANCIAS:
                g = geometria(sensor, f, d)
                filas.append([sensor, f"{f*1000:.0f}", f"{d:.1f}", f"{g['hfov']:.0f}",
                              f"{g['w']*1000:.0f} × {g['h']*1000:.0f}", f"{g['mm_px']:.3f}",
                              f"{g['bola_px']:.0f}"])
    partes.append("**1. Campo de visión** (lente delgada; distancia de la lente al plano de la "
                  "bola)\n")
    partes.append(tabla_md(["Sensor", "f mm", "Distancia m", "HFOV °", "Campo mm (ancho × alto)",
                            "mm/píxel", "Bola px"], filas))
    partes.append("")

    # 2. Profundidad de campo
    filas = []
    for sensor, coc_px in (("IMX296", 2.0), ("OV9281", 2.0)):
        coc = coc_px * SENSORES[sensor]["pix"]
        for f in FOCALES:
            for d in (0.4, 0.5, 0.7):
                fila = [sensor, f"{f*1000:.0f}", f"{d:.1f}"]
                for n_f in (1.4, 2.0, 2.8, 4.0):
                    fila.append(f"{profundidad_campo(f, d, n_f, coc)*100:.0f}")
                filas.append(fila)
    partes.append("**2. Profundidad de campo total (cm)** con círculo de confusión de 2 píxeles\n")
    partes.append(tabla_md(["Sensor", "f mm", "Distancia m", "f/1.4", "f/2", "f/2.8", "f/4"], filas))
    partes.append("")
    hla, largo, tee = 10.0, 0.40, 0.03
    lateral = 2 * (largo * math.tan(math.radians(hla)) + tee)
    partes.append(f"Recorrido en profundidad a cubrir (supuesto): HLA ±{hla:.0f}° a lo largo de "
                  f"{largo*100:.0f} cm de campo más ±{tee*100:.0f} cm de colocación del tee = "
                  f"{lateral*100:.0f} cm en total.\n")

    # 3. Desenfoque por movimiento
    filas = []
    for v in (40.0, 55.0, 75.0, 85.0):
        fila = [f"{v:.0f} m/s ({v/MPH:.0f} mph)"]
        for tp in (5e-6, 10e-6, 20e-6, 50e-6):
            mm = v * tp * 1000
            fila.append(f"{mm:.2f} mm = {mm/0.284:.1f} / {mm/0.5:.1f} px")
        filas.append(fila)
    partes.append("**3. Desenfoque por movimiento** — mm recorridos durante el pulso, y en píxeles "
                  "con 0.284 mm/px (IMX296, 6 mm a 0.5 m) / 0.5 mm/px\n")
    partes.append(tabla_md(["Velocidad", "5 µs", "10 µs", "20 µs", "50 µs"], filas))
    partes.append("")

    # 4. Separación de destellos
    configs = [("IMX296", 6e-3, 0.5), ("IMX296", 4e-3, 0.5), ("IMX296", 8e-3, 0.7),
               ("IMX296", 6e-3, 0.7), ("OV9281", 4e-3, 0.5), ("OV9281", 6e-3, 0.6)]
    golpes = [("Driver 75 m/s, 10°", 75.0, 10.0), ("Driver 75 m/s, 15°", 75.0, 15.0),
              ("Wedge 45 m/s, 25°", 45.0, 25.0), ("Wedge 45 m/s, 35°", 45.0, 35.0)]
    filas = []
    comun_txt = []
    for sensor, f, d in configs:
        g = geometria(sensor, f, d)
        etiqueta = f"{sensor} {f*1000:.0f} mm @ {d:.1f} m ({g['w']*1000:.0f}×{g['h']*1000:.0f} mm)"
        for n in (3, 4, 5, 6):
            fila = [etiqueta, f"{n}"]
            intervalos = []
            for _, v, vla in golpes:
                lo, hi = rango_dt(g, v, vla, n)
                intervalos.append((lo, hi))
                fila.append(f"{lo*1e6:.0f}–{hi*1e6:.0f}" if hi >= lo else f"no ({lo*1e6:.0f}>{hi*1e6:.0f})")
            lo_c = max(i[0] for i in intervalos)
            hi_c = min(i[1] for i in intervalos)
            fila.append(f"{lo_c*1e6:.0f}–{hi_c*1e6:.0f}" if hi_c >= lo_c else "no")
            filas.append(fila)
    partes.append("**4. Intervalo entre destellos (µs)** para que n imágenes separadas (≥ 1.25 D "
                  "entre centros) quepan en el campo con un margen de D/4 por lado. Supone que la "
                  "primera imagen cae en el borde del campo (ver latencia del disparo)\n")
    partes.append(tabla_md(["Configuración", "n"] + [gl[0] for gl in golpes] +
                           ["Común a los 4"], filas))
    partes.append("")

    # 5. Rotación por intervalo y precisión del giro
    filas = []
    for rpm in (2000, 2500, 3000, 5000, 7000, 9300, 10000):
        fila = [f"{rpm:,}"]
        for dt in (0.25e-3, 0.5e-3, 0.75e-3, 1.0e-3, 1.5e-3, 2.0e-3):
            fila.append(f"{6.0 * rpm * dt:.0f}")
        filas.append(fila)
    partes.append("**5. Rotación de la bola entre destellos (grados)**\n")
    partes.append(tabla_md(["rpm", "0.25 ms", "0.5 ms", "0.75 ms", "1.0 ms", "1.5 ms", "2.0 ms"],
                           filas))
    partes.append("")
    filas = []
    for etiqueta, rpm, dt, n in (("Driver 2,545 rpm", 2545, 0.7e-3, 4),
                                 ("Driver 2,545 rpm", 2545, 0.7e-3, 6),
                                 ("Hierro 7 7,124 rpm", 7124, 0.9e-3, 4),
                                 ("Wedge 9,300 rpm", 9300, 1.0e-3, 4)):
        total = 6.0 * rpm * dt * (n - 1)
        fila = [etiqueta, f"{dt*1e3:.2f}", f"{n}", f"{6*rpm*dt:.0f}°/{total:.0f}°"]
        for sig in (1.0, 2.0, 4.0):
            s_rpm = sig * math.sqrt(12.0 / (n * (n * n - 1))) / dt / 6.0
            s_eje = math.degrees(math.atan(sig / total))
            fila.append(f"±{s_rpm:.0f} rpm ({100*s_rpm/rpm:.1f}%) · eje ±{s_eje:.1f}°")
        filas.append(fila)
    partes.append("**5b. Precisión del giro y del eje** (orden de magnitud) si la orientación de la "
                  "bola en cada imagen se estima con un error σθ; regresión del ángulo con n "
                  "imágenes; eje ≈ σθ / rotación total\n")
    partes.append(tabla_md(["Golpe", "Δt ms", "n", "Rotación por intervalo / total",
                            "σθ = 1°", "σθ = 2°", "σθ = 4°"], filas))
    partes.append("")

    # 6. HLA por profundidad deducida del tamaño
    filas = []
    for sensor, f, d in (("IMX296", 6e-3, 0.5), ("IMX296", 8e-3, 0.7), ("OV9281", 4e-3, 0.5)):
        g = geometria(sensor, f, d)
        for sig_d in (0.1, 0.2, 0.3, 0.5, 1.0):
            sig_z = d * sig_d / g["bola_px"]
            fila = [f"{sensor} {f*1000:.0f} mm @ {d} m (bola {g['bola_px']:.0f} px)",
                    f"{sig_d:.1f}", f"{sig_z*1000:.2f}"]
            for n, largo in ((3, 0.25), (4, 0.30), (6, 0.30)):
                s_hla = math.degrees(sig_z * factor_regresion(n) / largo)
                fila.append(f"{s_hla:.2f}°")
            filas.append(fila)
    partes.append("**6. HLA por la profundidad deducida del diámetro aparente** (una cámara de "
                  "lado; Z = f·D/(d_px·p), σZ = Z·σd/d_px; pendiente de Z contra la distancia "
                  "recorrida)\n")
    partes.append(tabla_md(["Configuración", "σ diámetro px", "σZ por imagen mm",
                            "σHLA n=3, 25 cm", "n=4, 30 cm", "n=6, 30 cm"], filas))
    partes.append("")

    # 7. Velocidad y VLA por el centroide
    filas = []
    g = geometria("IMX296", 6e-3, 0.5)
    for sig_c in (0.1, 0.2, 0.5, 1.0):
        for n, largo in ((3, 0.25), (4, 0.30), (6, 0.30)):
            l_px = largo / (g["mm_px"] / 1000)
            fac = factor_regresion(n)
            rel = sig_c * fac / l_px
            filas.append([f"{sig_c:.1f}", f"{n}", f"{largo*100:.0f} cm = {l_px:.0f} px",
                          f"{100*rel:.3f}% ({rel*75/MPH:.2f} mph a 75 m/s)",
                          f"{math.degrees(rel):.3f}°"])
    partes.append("**7. Velocidad y VLA por el error del centroide** (IMX296, 6 mm a 0.5 m, "
                  f"{g['mm_px']:.3f} mm/px; solo el error aleatorio del centroide)\n")
    partes.append(tabla_md(["σ centroide px", "n", "Recorrido", "σ velocidad", "σ VLA"], filas))
    partes.append("")
    filas = []
    for fuente, rel in (("Escala: σZ/Z = 0.2 mm/500 mm (diámetro ±0.1 px)", 0.2 / 500),
                        ("Escala: σZ/Z = 1 mm/500 mm (diámetro ±0.5 px)", 1.0 / 500),
                        ("Escala: bola 10 mm fuera del plano calibrado, sin corregir", 10 / 500),
                        ("Reloj del destello: 1 µs sobre 2.1 ms (4 imágenes, driver)", 1e-6 / 2.1e-3),
                        ("Reloj del destello: 10 µs sobre 2.1 ms", 10e-6 / 2.1e-3)):
        filas.append([fuente, f"{100*rel:.3f}%", f"{rel*75/MPH:.2f} mph"])
    partes.append("Otras fuentes de error de la velocidad (se suman en cuadratura)\n")
    partes.append(tabla_md(["Fuente", "Error relativo", "A 75 m/s"], filas))
    partes.append("")

    # 8. Nivel 0: teléfono en cámara lenta (todo supuesto, verificar con el teléfono real)
    filas = []
    for fps in (120.0, 240.0, 960.0):
        for v in (45.0, 75.0):
            ancho_px, hfov, dist = 1920, 69.0, 1.5        # supuestos
            w = 2 * dist * math.tan(math.radians(hfov / 2))
            mm_px = w / ancho_px * 1000
            paso = v / fps
            n_cuadros = w / paso
            for exp in (1 / 2000, 1 / 8000):
                blur = v * exp * 1000
                sig_c = 2.0 + 0.1 * blur / mm_px         # supuesto: 2 px + 10% del barrido
                n = max(2, min(6, int(n_cuadros)))
                rel = sig_c * factor_regresion(n) / ((n - 1) * paso * 1000 / mm_px)
                filas.append([f"{fps:.0f}", f"{v:.0f}", f"{paso*1000:.0f} mm", f"{n_cuadros:.1f}",
                              f"1/{1/exp:.0f}", f"{blur:.0f} mm = {blur/mm_px:.0f} px",
                              f"{100*rel:.1f}%"])
    partes.append("**8. Nivel 0: teléfono en cámara lenta** — SUPUESTOS: video 1920 px de ancho, "
                  "HFOV 69°, teléfono a 1.5 m (≈ 1.1 mm/px), error de centroide 2 px + 10% del "
                  "barrido; sin obturador rodante ni compresión\n")
    partes.append(tabla_md(["fps", "Bola m/s", "Avance por cuadro", "Cuadros en el campo",
                            "Exposición", "Barrido", "σ velocidad (solo centroide)"], filas))
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "camara_estroboscopio.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
