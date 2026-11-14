# Radar Doppler: cálculos

**1. Desplazamiento Doppler** f_d = 2·v·f0/c (blanco que se aleja o acerca en línea recta)

| Módulo | λ cm | Hz por m/s | Hz por mph | Hz por km/h |
| :--- | ---: | ---: | ---: | ---: |
| HB100 10.525 GHz | 2.85 | 70.22 | 31.39 | 19.50 |
| CDM324 24.125 GHz | 1.24 | 160.94 | 71.95 | 44.71 |

**2. Frecuencias Doppler** (Hz, incidencia frontal)

| Caso | Velocidad | HB100 10.525 GHz | CDM324 24.125 GHz |
| :--- | ---: | ---: | ---: |
| Palo, aficionado lento | 30.0 m/s = 67 mph | 2,106 | 4,828 |
| Palo, aficionado | 42.0 m/s = 94 mph | 2,949 | 6,760 |
| Palo, PGA driver (115 mph) | 51.4 m/s = 115 mph | 3,610 | 8,274 |
| Palo, máximo pedido | 55.0 m/s = 123 mph | 3,862 | 8,852 |
| Bola, wedge | 35.0 m/s = 78 mph | 2,458 | 5,633 |
| Bola, hierro 7 PGA (123 mph) | 55.0 m/s = 123 mph | 3,861 | 8,850 |
| Bola, driver PGA (171 mph) | 76.4 m/s = 171 mph | 5,368 | 12,303 |
| Bola, máximo pedido | 85.0 m/s = 190 mph | 5,968 | 13,680 |

**3. ¿Alcanza el audio?** (bola a 85 m/s; banda útil = 0.45·fs, supuesto de filtro antialias típico)

| fs | Nyquist kHz | Banda útil kHz | HB100 10.525 GHz: f máx | CDM324 24.125 GHz: f máx |
| :--- | ---: | ---: | ---: | ---: |
| 44.1 kHz | 22.05 | 19.8 | 5.97 kHz → sí (margen 70%) | 13.68 kHz → sí (margen 31%) |
| 48.0 kHz | 24.00 | 21.6 | 5.97 kHz → sí (margen 72%) | 13.68 kHz → sí (margen 37%) |
| 96.0 kHz | 48.00 | 43.2 | 5.97 kHz → sí (margen 86%) | 13.68 kHz → sí (margen 68%) |

**4. STFT** — separación de bins Δf = 1/T (la ventana Hann tiene un lóbulo principal de −6 dB de 2 bins); velocidad por bin; y cuántas ventanas independientes (sin solape) caben en un vuelo de 2.5–3.0 m

| Ventana ms | Δf Hz | Δv/bin HB100 10.525 GHz | Δv/bin CDM324 24.125 GHz | Ventanas en 2.5–3 m, driver 75 m/s | Ventanas en 2.5–3 m, hierro 7 55 m/s | Ventanas en 2.5–3 m, wedge 45 m/s |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1000 | 14.24 m/s | 6.21 m/s | 33.3–40.0 | 45.5–54.5 | 55.6–66.7 |
| 2 | 500 | 7.12 m/s | 3.11 m/s | 16.7–20.0 | 22.7–27.3 | 27.8–33.3 |
| 5 | 200 | 2.85 m/s | 1.24 m/s | 6.7–8.0 | 9.1–10.9 | 11.1–13.3 |
| 10 | 100 | 1.42 m/s | 0.62 m/s | 3.3–4.0 | 4.5–5.5 | 5.6–6.7 |
| 20 | 50 | 0.71 m/s | 0.31 m/s | 1.7–2.0 | 2.3–2.7 | 2.8–3.3 |
| 40 | 25 | 0.36 m/s | 0.16 m/s | 0.8–1.0 | 1.1–1.4 | 1.4–1.7 |

Duración del vuelo hasta la red (ms):

| Golpe | 2.5–3.0 m |
| :--- | ---: |
| driver 75 m/s | 33.3–40.0 |
| hierro 7 55 m/s | 45.5–54.5 |
| wedge 45 m/s | 55.6–66.7 |

**5. Monte Carlo** — bola a 75 m/s, fs = 48 kHz, ventana Hann con relleno ×8 e interpolación gaussiana; 400 pruebas por celda; SNR por muestra (A²/2)/σ²; 'atípicos' = error > 3 bins (pico equivocado), excluidos del RMS

| Módulo | Ventana ms | SNR dB | Bin m/s | Error RMS m/s (mph) | Cota CRB m/s | Atípicos |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| HB100 10.525 GHz | 2 | -20 | 7.12 | 11.434 (25.58 mph) | 4.007 | 46.0% |
| HB100 10.525 GHz | 2 | -10 | 7.12 | 5.812 (13.00 mph) | 1.267 | 17.5% |
| HB100 10.525 GHz | 2 | +0 | 7.12 | 0.631 (1.41 mph) | 0.401 | 0.0% |
| HB100 10.525 GHz | 2 | +10 | 7.12 | 0.200 (0.45 mph) | 0.127 | 0.0% |
| HB100 10.525 GHz | 2 | +20 | 7.12 | 0.063 (0.14 mph) | 0.040 | 0.0% |
| HB100 10.525 GHz | 5 | -20 | 2.85 | 3.792 (8.48 mph) | 1.014 | 69.8% |
| HB100 10.525 GHz | 5 | -10 | 2.85 | 0.748 (1.67 mph) | 0.321 | 9.8% |
| HB100 10.525 GHz | 5 | +0 | 2.85 | 0.162 (0.36 mph) | 0.101 | 0.0% |
| HB100 10.525 GHz | 5 | +10 | 2.85 | 0.047 (0.11 mph) | 0.032 | 0.0% |
| HB100 10.525 GHz | 5 | +20 | 2.85 | 0.016 (0.03 mph) | 0.010 | 0.0% |
| HB100 10.525 GHz | 10 | -20 | 1.42 | 1.567 (3.50 mph) | 0.358 | 74.8% |
| HB100 10.525 GHz | 10 | -10 | 1.42 | 0.171 (0.38 mph) | 0.113 | 0.8% |
| HB100 10.525 GHz | 10 | +0 | 1.42 | 0.056 (0.12 mph) | 0.036 | 0.0% |
| HB100 10.525 GHz | 10 | +10 | 1.42 | 0.018 (0.04 mph) | 0.011 | 0.0% |
| HB100 10.525 GHz | 10 | +20 | 1.42 | 0.005 (0.01 mph) | 0.004 | 0.0% |
| HB100 10.525 GHz | 20 | -20 | 0.71 | 0.452 (1.01 mph) | 0.127 | 64.5% |
| HB100 10.525 GHz | 20 | -10 | 0.71 | 0.062 (0.14 mph) | 0.040 | 0.0% |
| HB100 10.525 GHz | 20 | +0 | 0.71 | 0.020 (0.04 mph) | 0.013 | 0.0% |
| HB100 10.525 GHz | 20 | +10 | 0.71 | 0.006 (0.01 mph) | 0.004 | 0.0% |
| HB100 10.525 GHz | 20 | +20 | 0.71 | 0.002 (0.00 mph) | 0.001 | 0.0% |
| CDM324 24.125 GHz | 2 | -20 | 3.11 | 4.257 (9.52 mph) | 1.748 | 72.8% |
| CDM324 24.125 GHz | 2 | -10 | 3.11 | 2.765 (6.19 mph) | 0.553 | 40.8% |
| CDM324 24.125 GHz | 2 | +0 | 3.11 | 0.277 (0.62 mph) | 0.175 | 0.0% |
| CDM324 24.125 GHz | 2 | +10 | 3.11 | 0.084 (0.19 mph) | 0.055 | 0.0% |
| CDM324 24.125 GHz | 2 | +20 | 3.11 | 0.030 (0.07 mph) | 0.017 | 0.0% |
| CDM324 24.125 GHz | 5 | -20 | 1.24 | 1.729 (3.87 mph) | 0.442 | 81.8% |
| CDM324 24.125 GHz | 5 | -10 | 1.24 | 0.443 (0.99 mph) | 0.140 | 12.8% |
| CDM324 24.125 GHz | 5 | +0 | 1.24 | 0.068 (0.15 mph) | 0.044 | 0.0% |
| CDM324 24.125 GHz | 5 | +10 | 1.24 | 0.022 (0.05 mph) | 0.014 | 0.0% |
| CDM324 24.125 GHz | 5 | +20 | 1.24 | 0.007 (0.02 mph) | 0.004 | 0.0% |
| CDM324 24.125 GHz | 10 | -20 | 0.62 | 0.530 (1.19 mph) | 0.156 | 87.2% |
| CDM324 24.125 GHz | 10 | -10 | 0.62 | 0.080 (0.18 mph) | 0.049 | 0.5% |
| CDM324 24.125 GHz | 10 | +0 | 0.62 | 0.024 (0.05 mph) | 0.016 | 0.0% |
| CDM324 24.125 GHz | 10 | +10 | 0.62 | 0.007 (0.02 mph) | 0.005 | 0.0% |
| CDM324 24.125 GHz | 10 | +20 | 0.62 | 0.002 (0.01 mph) | 0.002 | 0.0% |
| CDM324 24.125 GHz | 20 | -20 | 0.31 | 0.158 (0.35 mph) | 0.055 | 73.5% |
| CDM324 24.125 GHz | 20 | -10 | 0.31 | 0.026 (0.06 mph) | 0.017 | 0.0% |
| CDM324 24.125 GHz | 20 | +0 | 0.31 | 0.009 (0.02 mph) | 0.006 | 0.0% |
| CDM324 24.125 GHz | 20 | +10 | 0.31 | 0.003 (0.01 mph) | 0.002 | 0.0% |
| CDM324 24.125 GHz | 20 | +20 | 0.31 | 0.001 (0.00 mph) | 0.001 | 0.0% |

**5b. Efectos que no son ruido** (CDM324, SNR 10 dB por muestra; referencia = velocidad en el centro de la ventana)

| Señal | Ventana 5 ms | 10 ms | 20 ms |
| :--- | ---: | ---: | ---: |
| tono puro | 0.021 m/s (0% atíp.) | 0.008 m/s (0% atíp.) | 0.003 m/s (0% atíp.) |
| deceleración 25 m/s² | 0.022 m/s (0% atíp.) | 0.008 m/s (0% atíp.) | 0.003 m/s (0% atíp.) |
| deceleración 60 m/s² | 0.021 m/s (0% atíp.) | 0.008 m/s (0% atíp.) | 0.004 m/s (0% atíp.) |
| AM 30% a 42 Hz (2,545 rpm) | 0.023 m/s (0% atíp.) | 0.008 m/s (0% atíp.) | 0.003 m/s (0% atíp.) |
| AM 50% a 119 Hz (7,124 rpm) | 0.023 m/s (0% atíp.) | 0.009 m/s (0% atíp.) | 0.003 m/s (0% atíp.) |

**6. SNR esperable, CDM324** (EIRP 16 dBm; ganancia de recepción ≈ 12.1 dBi por el haz 80°×32°; sección radar de la bola ≈ π·r² = 14.3 cm²; ruido térmico × cifra de ruido SUPUESTA; sin pérdidas ni ruido del amplificador/ADC)

| Cifra de ruido dB (supuesto) | Distancia m | P recibida dBm | SNR por muestra a 48 kHz dB | SNR en 100 Hz dB |
| :--- | ---: | ---: | ---: | ---: |
| 15 | 1 | -71.5 | +43.7 | +67.5 |
| 15 | 2 | -83.5 | +31.7 | +55.5 |
| 15 | 3 | -90.5 | +24.6 | +48.4 |
| 30 | 1 | -71.5 | +28.7 | +52.5 |
| 30 | 2 | -83.5 | +16.7 | +40.5 |
| 30 | 3 | -90.5 | +9.6 | +33.4 |

**7. Error del coseno** — radar detrás de la bola sobre la línea de objetivo, apuntando hacia la red. v_medida/v − 1 según la distancia recorrida por la bola

| Posición del radar | VLA ° | s = 0 m | 0.5 m | 1 m | 2 m | 3 m |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1.5 m atrás, 5 cm arriba | 10 | -2.2% | -1.2% | -0.8% | -0.4% | -0.2% |
| 1.5 m atrás, 5 cm arriba | 16 | -4.8% | -2.7% | -1.8% | -0.9% | -0.5% |
| 1.5 m atrás, 5 cm arriba | 24 | -10.1% | -5.7% | -3.7% | -1.9% | -1.1% |
| 1.5 m atrás, 5 cm arriba | 32 | -17.0% | -9.8% | -6.3% | -3.2% | -1.9% |
| 2.0 m atrás, 5 cm arriba | 10 | -2.0% | -1.3% | -0.9% | -0.5% | -0.3% |
| 2.0 m atrás, 5 cm arriba | 16 | -4.6% | -3.0% | -2.1% | -1.2% | -0.7% |
| 2.0 m atrás, 5 cm arriba | 24 | -9.7% | -6.3% | -4.4% | -2.5% | -1.6% |
| 2.0 m atrás, 5 cm arriba | 32 | -16.5% | -10.8% | -7.6% | -4.2% | -2.7% |
| 2.5 m atrás, 5 cm arriba | 10 | -1.9% | -1.3% | -1.0% | -0.6% | -0.4% |
| 2.5 m atrás, 5 cm arriba | 16 | -4.4% | -3.1% | -2.3% | -1.4% | -0.9% |
| 2.5 m atrás, 5 cm arriba | 24 | -9.5% | -6.7% | -4.9% | -3.0% | -2.0% |
| 2.5 m atrás, 5 cm arriba | 32 | -16.3% | -11.5% | -8.5% | -5.2% | -3.4% |
| 2.0 m atrás, 30 cm arriba | 10 | -5.2% | -3.4% | -2.3% | -1.3% | -0.8% |
| 2.0 m atrás, 30 cm arriba | 16 | -9.0% | -5.9% | -4.1% | -2.3% | -1.5% |
| 2.0 m atrás, 30 cm arriba | 24 | -15.7% | -10.3% | -7.2% | -4.0% | -2.6% |
| 2.0 m atrás, 30 cm arriba | 32 | -24.0% | -16.0% | -11.2% | -6.3% | -3.9% |

Corrección con un VLA supuesto por palo (sin cámara): error residual

| VLA real ° | VLA supuesto ° | Error | En velocidad |
| :--- | ---: | ---: | ---: |
| 8 | 11 | +0.88% | +1.48 mph a 75 m/s |
| 10 | 11 | +0.32% | +0.54 mph a 75 m/s |
| 12 | 11 | -0.35% | -0.59 mph a 75 m/s |
| 14 | 11 | -1.15% | -1.94 mph a 75 m/s |
| 20 | 24 | +2.86% | +2.88 mph a 45 m/s |
| 24 | 24 | +0.00% | +0.00 mph a 45 m/s |
| 28 | 24 | -3.35% | -3.37 mph a 45 m/s |
| 32 | 24 | -7.17% | -7.22 mph a 45 m/s |

Error del coseno por la dirección horizontal (HLA) si no se corrige

| HLA ° | Error |
| :--- | ---: |
| 2 | -0.06% |
| 5 | -0.38% |
| 10 | -1.52% |

**8. Cabeza del palo antes del impacto** — tiempo en los últimos 10/20/30 cm, muestras a 48 kHz, y resolución de un bin si solo se usaran los últimos 10 cm (HB100 / CDM324)

| Velocidad | Últimos 10 cm | 20 cm | 30 cm | Bin con 10 cm (Hz → m/s) |
| :--- | ---: | ---: | ---: | ---: |
| 30 m/s = 67 mph | 3.33 ms · 160 muestras | 6.67 ms · 320 muestras | 10.00 ms · 480 muestras | 300 Hz → 4.3 / 1.9 m/s |
| 40 m/s = 89 mph | 2.50 ms · 120 muestras | 5.00 ms · 240 muestras | 7.50 ms · 360 muestras | 400 Hz → 5.7 / 2.5 m/s |
| 45 m/s = 101 mph | 2.22 ms · 107 muestras | 4.44 ms · 213 muestras | 6.67 ms · 320 muestras | 450 Hz → 6.4 / 2.8 m/s |
| 50 m/s = 112 mph | 2.00 ms · 96 muestras | 4.00 ms · 192 muestras | 6.00 ms · 288 muestras | 500 Hz → 7.1 / 3.1 m/s |
| 55 m/s = 123 mph | 1.82 ms · 87 muestras | 3.64 ms · 175 muestras | 5.45 ms · 262 muestras | 550 Hz → 7.8 / 3.4 m/s |

Cambio de la velocidad radial vista por un radar sobre la línea de objetivo, si la cabeza sigue un arco de radio 1.2 m (supuesto) y su velocidad en el impacto apunta al objetivo

| Distancia antes del impacto cm | Giro del vector velocidad ° | v_radial/v − 1 |
| :--- | ---: | ---: |
| 10 | 4.8 | -0.35% |
| 20 | 9.5 | -1.39% |
| 30 | 14.3 | -3.11% |
| 50 | 23.9 | -8.56% |

**9. VLA a partir de la forma de v_r(t)** (información de Fisher; parámetros: velocidad inicial, VLA y, si no se conoce, la deceleración; ventanas de 5 ms hasta 2.5 m; bola en un punto marcado y geometría del radar conocida; ignora la curvatura por gravedad)

| Radar | Golpe | Ventanas | σ de v_r por ventana m/s | Deceleración conocida | σ del VLA |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 2.0 m atrás, 5 cm | 11° a 75 m/s | 6 | 0.02 | sí | 0.14° |
| 2.0 m atrás, 5 cm | 11° a 75 m/s | 6 | 0.02 | no | 0.52° |
| 2.0 m atrás, 5 cm | 11° a 75 m/s | 6 | 0.05 | sí | 0.35° |
| 2.0 m atrás, 5 cm | 11° a 75 m/s | 6 | 0.05 | no | 1.31° |
| 2.0 m atrás, 5 cm | 11° a 75 m/s | 6 | 0.10 | sí | 0.70° |
| 2.0 m atrás, 5 cm | 11° a 75 m/s | 6 | 0.10 | no | 2.61° |
| 2.0 m atrás, 5 cm | 24° a 45 m/s | 11 | 0.02 | sí | 0.08° |
| 2.0 m atrás, 5 cm | 24° a 45 m/s | 11 | 0.02 | no | 0.25° |
| 2.0 m atrás, 5 cm | 24° a 45 m/s | 11 | 0.05 | sí | 0.20° |
| 2.0 m atrás, 5 cm | 24° a 45 m/s | 11 | 0.05 | no | 0.63° |
| 2.0 m atrás, 5 cm | 24° a 45 m/s | 11 | 0.10 | sí | 0.40° |
| 2.0 m atrás, 5 cm | 24° a 45 m/s | 11 | 0.10 | no | 1.25° |
| 2.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.02 | sí | 0.09° |
| 2.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.02 | no | 0.32° |
| 2.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.05 | sí | 0.22° |
| 2.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.05 | no | 0.81° |
| 2.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.10 | sí | 0.44° |
| 2.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.10 | no | 1.62° |
| 2.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.02 | sí | 0.06° |
| 2.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.02 | no | 0.19° |
| 2.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.05 | sí | 0.15° |
| 2.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.05 | no | 0.47° |
| 2.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.10 | sí | 0.31° |
| 2.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.10 | no | 0.93° |
| 1.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.02 | sí | 0.06° |
| 1.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.02 | no | 0.15° |
| 1.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.05 | sí | 0.15° |
| 1.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.05 | no | 0.37° |
| 1.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.10 | sí | 0.30° |
| 1.0 m atrás, 30 cm | 11° a 75 m/s | 6 | 0.10 | no | 0.75° |
| 1.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.02 | sí | 0.05° |
| 1.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.02 | no | 0.10° |
| 1.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.05 | sí | 0.12° |
| 1.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.05 | no | 0.25° |
| 1.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.10 | sí | 0.24° |
| 1.0 m atrás, 30 cm | 24° a 45 m/s | 11 | 0.10 | no | 0.50° |
