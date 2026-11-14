# Latencia del disparo: cálculos

**1. Tiempo de vuelo del sonido del impacto hasta el micrófono (ms)**

| Aire | c m/s | 0.1 m | 0.3 m | 0.5 m | 1.0 m | 2.0 m |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 14 °C | 339.7 | 0.29 | 0.88 | 1.47 | 2.94 | 5.89 |
| 15 °C | 340.3 | 0.29 | 0.88 | 1.47 | 2.94 | 5.88 |
| 22 °C | 344.4 | 0.29 | 0.87 | 1.45 | 2.90 | 5.81 |

**2. Latencia total y distancia recorrida por la bola** (detectores: supuestos de orden de magnitud; la barrera IR dispara por POSICIÓN: la bola siempre está en la barrera)

| Disparo | Latencia ms | Bola a 45 m/s: mm | 75 m/s: mm | 85 m/s: mm |
| :--- | ---: | ---: | ---: | ---: |
| Acústico, micrófono a 0.3 m, detección analógica + MCU | 0.91–1.00 | 41–45 | 68–75 | 77–85 |
| Acústico, micrófono a 0.1 m, detección analógica + MCU | 0.32–0.41 | 14–19 | 24–31 | 27–35 |
| Acústico por la tarjeta de sonido del PC | 5.88–50.88 | 265–2290 | 441–3816 | 500–4325 |
| Radar: tono de la bola detectado en el MCU | 0.51–2.02 | 23–91 | 38–152 | 43–172 |
| Radar procesado en el PC (audio) | 5.00–50.00 | 225–2250 | 375–3750 | 425–4250 |
| Barrera IR a 1 cm delante de la bola (fotodiodo) | 0.12–0.23 (según v) | 10–10 | 10–10 | 10–10 |
| Barrera IR a 2 cm delante de la bola (fotodiodo) | 0.24–0.45 (según v) | 20–20 | 20–20 | 20–20 |
| Barrera IR a 5 cm delante de la bola (fotodiodo) | 0.59–1.12 (según v) | 50–50 | 50–50 | 50–50 |

**3. ¿Cuándo se despega la bola del palo?** (momento lineal en 1D; masas de cabeza SUPUESTAS; ignora los ~0.5 ms de contacto) — tiempo hasta que entre la bola y la cara hay un diámetro de bola

| Golpe | Palo | v bola m/s | v palo después m/s | Separación m/s | t para 1 D de luz ms | Bola recorrió mm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver PGA | 115 mph · 200 g | 76.6 | 33.8 | 43.8 | 0.97 | 75 |
| Hierro 7 PGA | 92 mph · 260 g | 55.1 | 31.4 | 26.4 | 1.61 | 89 |
| Wedge (PW PGA) | 83 mph · 290 g | 45.6 | 29.9 | 22.1 | 1.93 | 88 |

**4. Campo de visión necesario** para 4 imágenes de driver (75 m/s, 12°) y wedge (45 m/s, 30°) con la misma configuración; espera extra de 0.5 ms tras el disparo; Δt fijo = 1300 µs; con dos barreras el Δt se elige para 25 cm de recorrido. Distancias horizontales desde la posición inicial del centro de la bola

| Disparo | Posiciones de la bola | Campo desde mm | Campo hasta mm | Ancho necesario mm |
| :--- | ---: | ---: | ---: | ---: |
| Acústico 0.3 m + MCU, Δt fijo | Driver: 1.ª 103 mm, última 396 mm, Δt 1300 µs · Wedge: 1.ª 55 mm, última 211 mm, Δt 1300 µs | 34 | 418 | 384 |
| Radar en MCU, Δt fijo | Driver: 1.ª 74 mm, última 471 mm, Δt 1300 µs · Wedge: 1.ª 39 mm, última 250 mm, Δt 1300 µs | 18 | 492 | 474 |
| Barrera IR a 2 cm, Δt fijo | Driver: 1.ª 78 mm, última 364 mm, Δt 1300 µs · Wedge: 1.ª 61 mm, última 213 mm, Δt 1300 µs | 39 | 385 | 346 |
| Dos barreras IR (miden v), Δt adaptado | Driver: 1.ª 78 mm, última 328 mm, Δt 1136 µs · Wedge: 1.ª 61 mm, última 311 mm, Δt 2138 µs | 39 | 349 | 310 |

Dos barreras IR para medir la velocidad y adaptar el Δt: tiempo entre barreras y error relativo con ±2 µs de incertidumbre de cada flanco (supuesto)

| Separación | 45 m/s | 75 m/s | 85 m/s |
| :--- | ---: | ---: | ---: |
| 3 cm | 667 µs → ±0.30% | 400 µs → ±0.50% | 353 µs → ±0.57% |
| 5 cm | 1111 µs → ±0.18% | 667 µs → ±0.30% | 588 µs → ±0.34% |
| 8 cm | 1778 µs → ±0.11% | 1067 µs → ±0.19% | 941 µs → ±0.21% |
