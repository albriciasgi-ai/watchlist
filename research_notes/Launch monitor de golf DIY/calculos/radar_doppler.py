# -*- coding: utf-8 -*-
"""
Radar Doppler de onda continua (HB100 a 10.525 GHz, CDM324 a 24.125 GHz).

1. Desplazamiento Doppler por m/s y por mph.
2. Rangos de frecuencia para palo (hasta ~55 m/s) y bola (hasta ~85 m/s).
3. ¿Basta el muestreo de audio a 44.1/48 kHz?
4. Ventana de la STFT vs resolución vs estimaciones independientes en un
   vuelo de 2.5-3 m hasta la red.
5. Monte Carlo: precisión de velocidad con interpolación espectral y SNR.
6. SNR esperable (ecuación del radar, con supuestos explícitos).
7. Error del coseno según el ángulo de salida y la posición del radar.
8. Tiempo que la cabeza del palo pasa en los últimos 10 cm antes del impacto.

Uso:  python radar_doppler.py   (escribe resultados/radar_doppler.md)
"""
import math
import os

import numpy as np

from comun import C_LUZ, MPH, R_BOLA, tabla_md

DIR_RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultados")
F0 = {"HB100 10.525 GHz": 10.525e9, "CDM324 24.125 GHz": 24.125e9}
RNG = np.random.default_rng(20261114)


def doppler(v, f0, cos_ang=1.0):
    """Desplazamiento Doppler (Hz) de un blanco a velocidad radial v·cos."""
    return 2.0 * v * cos_ang * f0 / C_LUZ


def velocidad(fd, f0):
    return fd * C_LUZ / (2.0 * f0)


# ---------------------------------------------------------------------------
# Estimador de frecuencia: Hann + relleno con ceros + interpolación gaussiana
# ---------------------------------------------------------------------------
def estimar_frecuencias(x, fs, banda, relleno=8):
    """x: matriz (pruebas × muestras). Devuelve la frecuencia del pico (Hz)."""
    n = x.shape[1]
    w = np.hanning(n)
    nfft = relleno * n
    esp = np.abs(np.fft.rfft(x * w, n=nfft, axis=1)) + 1e-30
    f = np.fft.rfftfreq(nfft, 1.0 / fs)
    i0, i1 = np.searchsorted(f, banda[0]), np.searchsorted(f, banda[1])
    sub = esp[:, i0:i1]
    k = np.argmax(sub, axis=1) + i0
    k = np.clip(k, 1, esp.shape[1] - 2)
    filas = np.arange(x.shape[0])
    a, b, c = (np.log(esp[filas, k - 1]), np.log(esp[filas, k]), np.log(esp[filas, k + 1]))
    den = a - 2 * b + c
    p = np.where(np.abs(den) > 1e-12, 0.5 * (a - c) / den, 0.0)
    return (k + p) * fs / nfft


def monte_carlo(f0, v, fs, t_ventana, snr_db, n_pruebas=400, acel=0.0, am=0.0, f_am=0.0):
    """Error RMS de velocidad (m/s) para un tono real con ruido blanco.

    snr_db: SNR por muestra = (A²/2)/σ². acel: deceleración (m/s², chirp);
    am: modulación de amplitud (fracción) a f_am Hz (p. ej. el giro de la bola).
    La referencia es la velocidad en el centro de la ventana.
    """
    n = int(round(t_ventana * fs))
    t = np.arange(n) / fs
    eta = 10 ** (snr_db / 10.0)
    sigma = math.sqrt(0.5 / eta)
    v_c = v + RNG.uniform(-1.0, 1.0, size=(n_pruebas, 1))          # velocidad al centro
    vt = v_c - acel * (t - t[-1] / 2)                                 # decelera
    fase = 2 * np.pi * np.cumsum(doppler(vt, f0), axis=1) / fs + RNG.uniform(0, 2 * np.pi, (n_pruebas, 1))
    amp = 1.0 + am * np.sin(2 * np.pi * f_am * t + RNG.uniform(0, 2 * np.pi, (n_pruebas, 1)))
    x = amp * np.cos(fase) + RNG.normal(0.0, sigma, size=(n_pruebas, n))
    banda = (doppler(15.0, f0), min(doppler(95.0, f0), 0.49 * fs))
    f_est = estimar_frecuencias(x, fs, banda)
    err = velocidad(f_est, f0) - v_c[:, 0]
    bin_v = velocidad(fs / n, f0)
    atipicos = np.abs(err) > 3 * bin_v
    rms = math.sqrt(np.mean(err[~atipicos] ** 2)) if np.any(~atipicos) else float("nan")
    # Cota de Cramér-Rao para un tono real (aproximación de N grande)
    crb_f = fs / (2 * math.pi) * math.sqrt(12.0 / (eta * n * (n * n - 1)))
    return rms, float(np.mean(atipicos)), velocidad(crb_f, f0), bin_v


def v_radial(t, v0, acel, vla_deg, atras, alto):
    """Velocidad radial vista por un radar en (−atras, 0, alto) de una bola que
    sale del origen en línea recta con deceleración constante."""
    th = math.radians(vla_deg)
    u = np.array([math.cos(th), 0.0, math.sin(th)])
    s = v0 * t - 0.5 * acel * t ** 2
    pos = np.outer(s, u)
    los = pos - np.array([-atras, 0.0, alto])
    los /= np.linalg.norm(los, axis=1)[:, None]
    return (v0 - acel * t) * (los @ u)


def sigma_vla_geometrica(v0, vla, atras, alto, tw, k, sigma_vr, acel_conocida, acel=20.0):
    """σ del VLA (°) por la matriz de información de Fisher."""
    t = (np.arange(k) + 0.5) * tw
    params = [v0, vla] if acel_conocida else [v0, vla, acel]

    def modelo(pr):
        a = acel if acel_conocida else pr[2]
        return v_radial(t, pr[0], a, pr[1], atras, alto)
    jac = []
    for i, pv in enumerate(params):
        h = 1e-4 * max(1.0, abs(pv))
        mas = list(params)
        menos = list(params)
        mas[i] += h
        menos[i] -= h
        jac.append((modelo(mas) - modelo(menos)) / (2 * h))
    jac = np.array(jac).T
    cov = sigma_vr ** 2 * np.linalg.inv(jac.T @ jac)
    return math.sqrt(cov[1, 1])


def main():
    os.makedirs(DIR_RES, exist_ok=True)
    partes = ["# Radar Doppler: cálculos\n"]

    # 1. Constantes Doppler
    filas = []
    for nombre, f0 in F0.items():
        filas.append([nombre, f"{C_LUZ/f0*100:.2f}", f"{doppler(1.0, f0):.2f}",
                      f"{doppler(MPH, f0):.2f}", f"{doppler(1/3.6, f0):.2f}"])
    partes.append("**1. Desplazamiento Doppler** f_d = 2·v·f0/c (blanco que se aleja o "
                  "acerca en línea recta)\n")
    partes.append(tabla_md(["Módulo", "λ cm", "Hz por m/s", "Hz por mph", "Hz por km/h"], filas))
    partes.append("")

    # 2. Rangos de frecuencia
    filas = []
    casos = [("Palo, aficionado lento", 30.0), ("Palo, aficionado", 42.0),
             ("Palo, PGA driver (115 mph)", 115 * MPH), ("Palo, máximo pedido", 55.0),
             ("Bola, wedge", 35.0), ("Bola, hierro 7 PGA (123 mph)", 123 * MPH),
             ("Bola, driver PGA (171 mph)", 171 * MPH), ("Bola, máximo pedido", 85.0)]
    for nombre, v in casos:
        filas.append([nombre, f"{v:.1f} m/s = {v/MPH:.0f} mph"] +
                     [f"{doppler(v, f0):,.0f}" for f0 in F0.values()])
    partes.append("**2. Frecuencias Doppler** (Hz, incidencia frontal)\n")
    partes.append(tabla_md(["Caso", "Velocidad"] + list(F0.keys()), filas))
    partes.append("")

    # 3. Muestreo de audio
    filas = []
    for fs in (44_100.0, 48_000.0, 96_000.0):
        nyq = fs / 2
        util = 0.45 * fs          # banda de paso típica de un códec (supuesto)
        fila = [f"{fs/1000:.1f} kHz", f"{nyq/1000:.2f}", f"{util/1000:.1f}"]
        for f0 in F0.values():
            fmax = doppler(85.0, f0)
            fila.append(f"{fmax/1000:.2f} kHz → {'sí' if fmax < util else 'NO'} "
                        f"(margen {100*(1 - fmax/util):.0f}%)")
        filas.append(fila)
    partes.append("**3. ¿Alcanza el audio?** (bola a 85 m/s; banda útil = 0.45·fs, supuesto de "
                  "filtro antialias típico)\n")
    partes.append(tabla_md(["fs", "Nyquist kHz", "Banda útil kHz"] +
                           [f"{k}: f máx" for k in F0], filas))
    partes.append("")

    # 4. STFT: ventana vs resolución vs número de estimaciones
    filas = []
    vuelos = [("driver 75 m/s", 75.0), ("hierro 7 55 m/s", 55.0), ("wedge 45 m/s", 45.0)]
    for tw_ms in (1, 2, 5, 10, 20, 40):
        tw = tw_ms / 1000.0
        fila = [f"{tw_ms}", f"{1/tw:.0f}"]
        for f0 in F0.values():
            fila.append(f"{velocidad(1/tw, f0):.2f} m/s")
        for nombre, v in vuelos:
            n25 = (2.5 / v) / tw
            n30 = (3.0 / v) / tw
            fila.append(f"{n25:.1f}–{n30:.1f}")
        filas.append(fila)
    partes.append("**4. STFT** — separación de bins Δf = 1/T (la ventana Hann tiene un lóbulo "
                  "principal de −6 dB de 2 bins); velocidad por bin; y cuántas ventanas "
                  "independientes (sin solape) caben en un vuelo de 2.5–3.0 m\n")
    partes.append(tabla_md(["Ventana ms", "Δf Hz"] + [f"Δv/bin {k}" for k in F0] +
                           [f"Ventanas en 2.5–3 m, {n}" for n, _ in vuelos], filas))
    partes.append("")
    filas = []
    for nombre, v in vuelos:
        filas.append([nombre, f"{2.5/v*1000:.1f}–{3.0/v*1000:.1f}"])
    partes.append("Duración del vuelo hasta la red (ms):\n")
    partes.append(tabla_md(["Golpe", "2.5–3.0 m"], filas))
    partes.append("")

    # 5. Monte Carlo
    fs = 48_000.0
    filas = []
    for nombre, f0 in F0.items():
        for tw_ms in (2, 5, 10, 20):
            for snr in (-20, -10, 0, 10, 20):
                rms, out, crb, bin_v = monte_carlo(f0, 75.0, fs, tw_ms / 1000, snr)
                filas.append([nombre, f"{tw_ms}", f"{snr:+d}", f"{bin_v:.2f}",
                              f"{rms:.3f} ({rms/MPH:.2f} mph)", f"{crb:.3f}",
                              f"{100*out:.1f}%"])
    partes.append("**5. Monte Carlo** — bola a 75 m/s, fs = 48 kHz, ventana Hann con relleno ×8 e "
                  "interpolación gaussiana; 400 pruebas por celda; SNR por muestra (A²/2)/σ²; "
                  "'atípicos' = error > 3 bins (pico equivocado), excluidos del RMS\n")
    partes.append(tabla_md(["Módulo", "Ventana ms", "SNR dB", "Bin m/s",
                            "Error RMS m/s (mph)", "Cota CRB m/s", "Atípicos"], filas))
    partes.append("")
    # Efectos que no son ruido: deceleración y modulación por el giro
    filas = []
    f0 = F0["CDM324 24.125 GHz"]
    for etiqueta, kw in (("tono puro", {}), ("deceleración 25 m/s²", {"acel": 25.0}),
                         ("deceleración 60 m/s²", {"acel": 60.0}),
                         ("AM 30% a 42 Hz (2,545 rpm)", {"am": 0.3, "f_am": 2545 / 60}),
                         ("AM 50% a 119 Hz (7,124 rpm)", {"am": 0.5, "f_am": 7124 / 60})):
        fila = [etiqueta]
        for tw_ms in (5, 10, 20):
            rms, out, _, _ = monte_carlo(f0, 75.0, fs, tw_ms / 1000, 10, **kw)
            fila.append(f"{rms:.3f} m/s ({100*out:.0f}% atíp.)")
        filas.append(fila)
    partes.append("**5b. Efectos que no son ruido** (CDM324, SNR 10 dB por muestra; referencia = "
                  "velocidad en el centro de la ventana)\n")
    partes.append(tabla_md(["Señal", "Ventana 5 ms", "10 ms", "20 ms"], filas))
    partes.append("")

    # 6. SNR esperable con la ecuación del radar (supuestos explícitos)
    filas = []
    eirp_dbm = 16.0            # CDM324, potencia típica de un revendedor (dato citado)
    g_rx = 41253.0 / (80 * 32)  # ganancia aproximada por el ancho de haz 80°×32°
    k_b = 1.380649e-23
    for nf_db in (15.0, 30.0):     # cifra de ruido supuesta (mezclador + ruido 1/f)
        for r in (1.0, 2.0, 3.0):
            lam = C_LUZ / F0["CDM324 24.125 GHz"]
            sigma_rcs = math.pi * R_BOLA ** 2
            pr = (10 ** (eirp_dbm / 10) / 1000) * g_rx * lam ** 2 * sigma_rcs / ((4 * math.pi) ** 3 * r ** 4)
            ruido_24k = k_b * 290 * 24_000 * 10 ** (nf_db / 10)
            snr_muestra = 10 * math.log10(pr / ruido_24k)
            snr_100hz = 10 * math.log10(pr / (k_b * 290 * 100 * 10 ** (nf_db / 10)))
            filas.append([f"{nf_db:.0f}", f"{r:.0f}", f"{10*math.log10(pr*1000):.1f}",
                          f"{snr_muestra:+.1f}", f"{snr_100hz:+.1f}"])
    partes.append(f"**6. SNR esperable, CDM324** (EIRP 16 dBm; ganancia de recepción ≈ "
                  f"{10*math.log10(g_rx):.1f} dBi por el haz 80°×32°; sección radar de la bola ≈ "
                  f"π·r² = {math.pi*R_BOLA**2*1e4:.1f} cm²; ruido térmico × cifra de ruido "
                  "SUPUESTA; sin pérdidas ni ruido del amplificador/ADC)\n")
    partes.append(tabla_md(["Cifra de ruido dB (supuesto)", "Distancia m", "P recibida dBm",
                            "SNR por muestra a 48 kHz dB", "SNR en 100 Hz dB"], filas))
    partes.append("")

    # 7. Error del coseno
    filas = []
    for atras, alto in ((1.5, 0.05), (2.0, 0.05), (2.5, 0.05), (2.0, 0.30)):
        for vla in (10.0, 16.0, 24.0, 32.0):
            th = math.radians(vla)
            u = np.array([math.cos(th), 0.0, math.sin(th)])
            radar = np.array([-atras, 0.0, alto])
            fila = [f"{atras:.1f} m atrás, {alto*100:.0f} cm arriba", f"{vla:.0f}"]
            for s in (0.0, 0.5, 1.0, 2.0, 3.0):
                pos = s * u
                los = pos - radar
                los /= np.linalg.norm(los)
                fila.append(f"{100*(float(np.dot(u, los)) - 1):+.1f}%")
            filas.append(fila)
    partes.append("**7. Error del coseno** — radar detrás de la bola sobre la línea de objetivo, "
                  "apuntando hacia la red. v_medida/v − 1 según la distancia recorrida por la bola\n")
    partes.append(tabla_md(["Posición del radar", "VLA °", "s = 0 m", "0.5 m", "1 m", "2 m",
                            "3 m"], filas))
    partes.append("")
    filas = []
    for vla_real in (8.0, 10.0, 12.0, 14.0, 20.0, 24.0, 28.0, 32.0):
        for vla_sup in ((11.0,) if vla_real < 16 else (24.0,)):
            err = math.cos(math.radians(vla_real)) / math.cos(math.radians(vla_sup)) - 1
            filas.append([f"{vla_real:.0f}", f"{vla_sup:.0f}", f"{100*err:+.2f}%",
                          f"{err*75/MPH:+.2f} mph a 75 m/s" if vla_sup == 11 else
                          f"{err*45/MPH:+.2f} mph a 45 m/s"])
    partes.append("Corrección con un VLA supuesto por palo (sin cámara): error residual\n")
    partes.append(tabla_md(["VLA real °", "VLA supuesto °", "Error", "En velocidad"], filas))
    partes.append("")
    filas = []
    for hla in (2.0, 5.0, 10.0):
        filas.append([f"{hla:.0f}", f"{100*(math.cos(math.radians(hla))-1):+.2f}%"])
    partes.append("Error del coseno por la dirección horizontal (HLA) si no se corrige\n")
    partes.append(tabla_md(["HLA °", "Error"], filas))
    partes.append("")

    # 8. Palo: tiempo en los últimos 10 cm
    filas = []
    r_arco = 1.2   # radio del arco de la cabeza cerca del impacto (supuesto)
    for v in (30.0, 40.0, 45.0, 50.0, 55.0):
        fila = [f"{v:.0f} m/s = {v/MPH:.0f} mph"]
        for d in (0.10, 0.20, 0.30):
            t = d / v
            fila.append(f"{t*1000:.2f} ms · {t*48000:.0f} muestras")
        fila.append(f"{1/(0.10/v):.0f} Hz → {velocidad(1/(0.10/v), F0['HB100 10.525 GHz']):.1f} / "
                    f"{velocidad(1/(0.10/v), F0['CDM324 24.125 GHz']):.1f} m/s")
        filas.append(fila)
    partes.append("**8. Cabeza del palo antes del impacto** — tiempo en los últimos 10/20/30 cm, "
                  "muestras a 48 kHz, y resolución de un bin si solo se usaran los últimos 10 cm "
                  "(HB100 / CDM324)\n")
    partes.append(tabla_md(["Velocidad", "Últimos 10 cm", "20 cm", "30 cm",
                            "Bin con 10 cm (Hz → m/s)"], filas))
    partes.append("")
    filas = []
    for d in (0.10, 0.20, 0.30, 0.50):
        ang = d / r_arco
        filas.append([f"{d*100:.0f}", f"{math.degrees(ang):.1f}",
                      f"{100*(math.cos(ang)-1):+.2f}%"])
    partes.append(f"Cambio de la velocidad radial vista por un radar sobre la línea de objetivo, "
                  f"si la cabeza sigue un arco de radio {r_arco} m (supuesto) y su velocidad en el "
                  "impacto apunta al objetivo\n")
    partes.append(tabla_md(["Distancia antes del impacto cm", "Giro del vector velocidad °",
                            "v_radial/v − 1"], filas))
    partes.append("")

    # 9. ¿Se puede sacar el VLA de la forma de v_r(t) con un radar de un canal?
    filas = []
    for atras, alto in ((2.0, 0.05), (2.0, 0.30), (1.0, 0.30)):
        for vla, v0, dist in ((11.0, 75.0, 2.5), (24.0, 45.0, 2.5)):
            tw = 0.005
            k = int((dist / v0) / tw)
            for sig in (0.02, 0.05, 0.10):
                for a_conocida in (True, False):
                    sv = sigma_vla_geometrica(v0, vla, atras, alto, tw, k, sig, a_conocida)
                    filas.append([f"{atras:.1f} m atrás, {alto*100:.0f} cm", f"{vla:.0f}° a {v0:.0f} m/s",
                                  f"{k}", f"{sig:.2f}", "sí" if a_conocida else "no",
                                  f"{sv:.2f}°"])
    partes.append("**9. VLA a partir de la forma de v_r(t)** (información de Fisher; parámetros: "
                  "velocidad inicial, VLA y, si no se conoce, la deceleración; ventanas de 5 ms "
                  "hasta 2.5 m; bola en un punto marcado y geometría del radar conocida; ignora la "
                  "curvatura por gravedad)\n")
    partes.append(tabla_md(["Radar", "Golpe", "Ventanas", "σ de v_r por ventana m/s",
                            "Deceleración conocida", "σ del VLA"], filas))
    texto = "\n".join(partes)
    with open(os.path.join(DIR_RES, "radar_doppler.md"), "w", encoding="utf-8") as fh:
        fh.write(texto + "\n")
    print(texto)


if __name__ == "__main__":
    main()
