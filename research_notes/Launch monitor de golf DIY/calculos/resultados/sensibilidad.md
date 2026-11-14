# Sensibilidad y precisión necesaria

**Derivadas (modelo final)** — diferencias centrales con pasos de ±1 mph, ±0.5°, ±100 rpm, ±1° (entre paréntesis, promedio para 5°)

| Golpe · aire | Carry yd | dCarry/dV yd/mph | dCarry/dVLA yd/° | dCarry/dSpin yd/100 rpm | Offline/HLA yd/° (5°) | Curva/eje yd/° (5°) | Offline/eje yd/° | ΔCarry con eje 5° yd |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver PGA (TM 2024) · Nivel del mar | 281.8 | 2.04 | +2.69 | +0.62 | 4.92 (4.91) | 2.02 (2.01) | 2.02 | -0.4 |
| Hierro 7 PGA (TM 2024) · Nivel del mar | 177.8 | 1.83 | -0.22 | -0.46 | 3.10 (3.10) | 1.72 (1.71) | 1.72 | -0.1 |
| Driver aficionado (supuesto) · Nivel del mar | 209.5 | 2.42 | +2.43 | +0.40 | 3.66 (3.65) | 1.33 (1.33) | 1.33 | -0.3 |
| Hierro 7 aficionado (supuesto) · Nivel del mar | 136.5 | 2.08 | +0.50 | -0.19 | 2.38 (2.38) | 0.97 (0.97) | 0.97 | -0.1 |
| Driver PGA (TM 2024) · Bogotá | 290.5 | 2.79 | +5.95 | +1.48 | 5.07 (5.06) | 1.49 (1.49) | 1.49 | -0.5 |
| Hierro 7 PGA (TM 2024) · Bogotá | 193.4 | 2.39 | +1.19 | -0.16 | 3.38 (3.37) | 1.39 (1.39) | 1.39 | -0.2 |
| Driver aficionado (supuesto) · Bogotá | 208.7 | 2.76 | +4.71 | +0.82 | 3.64 (3.64) | 0.93 (0.93) | 0.93 | -0.3 |
| Hierro 7 aficionado (supuesto) · Bogotá | 142.6 | 2.43 | +1.61 | -0.00 | 2.49 (2.49) | 0.74 (0.74) | 0.74 | -0.2 |

**¿Cambian las derivadas con la variante del modelo?** (nivel del mar)

| Variante · golpe | Carry yd | yd/mph | yd/° VLA | yd/100 rpm | yd/° HLA | yd/° eje |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| A) final · Driver PGA (TM 2024) | 281.8 | 2.04 | +2.69 | +0.62 | 4.92 | 2.02 |
| A) final · Hierro 7 PGA (TM 2024) | 177.8 | 1.83 | -0.22 | -0.46 | 3.10 | 1.72 |
| B) cd3=0 · Driver PGA (TM 2024) | 281.1 | 1.98 | +2.88 | +0.51 | 4.91 | 2.17 |
| B) cd3=0 · Hierro 7 PGA (TM 2024) | 177.4 | 1.67 | -0.24 | -0.61 | 3.10 | 1.79 |
| C) cd3=+0.06 · Driver PGA (TM 2024) | 280.7 | 1.92 | +3.08 | +0.44 | 4.90 | 2.32 |
| C) cd3=+0.06 · Hierro 7 PGA (TM 2024) | 177.0 | 1.54 | -0.26 | -0.75 | 3.09 | 1.86 |

**Precisión necesaria (1σ) para ±2 yd** — 'sola / repartida': sola = única fuente de error; repartida = reparto igual entre velocidad, VLA y giro (carry) o entre HLA y eje (offline), sumadas en cuadratura

| Golpe · aire | Velocidad de bola | VLA | Giro | HLA (offline) | Eje de giro (offline) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Driver PGA (TM 2024) · Nivel del mar | 0.98 / 0.57 mph (0.33%) | 0.74° / 0.43° | 323 rpm / 186 rpm | 0.41 / 0.29° | 0.99 / 0.70° |
| Hierro 7 PGA (TM 2024) · Nivel del mar | 1.09 / 0.63 mph (0.51%) | > 5.00° / > 5.00° | 439 rpm / 254 rpm | 0.64 / 0.46° | 1.16 / 0.82° |
| Driver aficionado (supuesto) · Nivel del mar | 0.83 / 0.48 mph (0.35%) | 0.82° / 0.47° | 502 rpm / 290 rpm | 0.55 / 0.39° | 1.50 / 1.06° |
| Hierro 7 aficionado (supuesto) · Nivel del mar | 0.96 / 0.56 mph (0.56%) | 3.98° / 2.30° | 1061 rpm / 612 rpm | 0.84 / 0.59° | 2.06 / 1.46° |
| Driver PGA (TM 2024) · Bogotá | 0.72 / 0.41 mph (0.24%) | 0.34° / 0.19° | 135 rpm / 78 rpm | 0.39 / 0.28° | 1.34 / 0.95° |
| Hierro 7 PGA (TM 2024) · Bogotá | 0.84 / 0.48 mph (0.39%) | 1.67° / 0.97° | 1224 rpm / 707 rpm | 0.59 / 0.42° | 1.44 / 1.02° |
| Driver aficionado (supuesto) · Bogotá | 0.73 / 0.42 mph (0.31%) | 0.42° / 0.24° | 244 rpm / 141 rpm | 0.55 / 0.39° | 2.15 / 1.52° |
| Hierro 7 aficionado (supuesto) · Bogotá | 0.82 / 0.48 mph (0.48%) | 1.24° / 0.72° | > 3000 rpm / > 3000 rpm | 0.80 / 0.57° | 2.71 / 1.92° |

**Precisión necesaria (1σ) para ±3 yd** — 'sola / repartida': sola = única fuente de error; repartida = reparto igual entre velocidad, VLA y giro (carry) o entre HLA y eje (offline), sumadas en cuadratura

| Golpe · aire | Velocidad de bola | VLA | Giro | HLA (offline) | Eje de giro (offline) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Driver PGA (TM 2024) · Nivel del mar | 1.47 / 0.85 mph (0.50%) | 1.11° / 0.64° | 484 rpm / 279 rpm | 0.61 / 0.43° | 1.48 / 1.05° |
| Hierro 7 PGA (TM 2024) · Nivel del mar | 1.64 / 0.95 mph (0.77%) | > 5.00° / > 5.00° | 659 rpm / 380 rpm | 0.97 / 0.68° | 1.74 / 1.23° |
| Driver aficionado (supuesto) · Nivel del mar | 1.24 / 0.72 mph (0.53%) | 1.23° / 0.71° | 753 rpm / 434 rpm | 0.82 / 0.58° | 2.25 / 1.59° |
| Hierro 7 aficionado (supuesto) · Nivel del mar | 1.44 / 0.83 mph (0.83%) | > 5.00° / 3.44° | 1591 rpm / 919 rpm | 1.26 / 0.89° | 3.09 / 2.19° |
| Driver PGA (TM 2024) · Bogotá | 1.07 / 0.62 mph (0.36%) | 0.50° / 0.29° | 203 rpm / 117 rpm | 0.59 / 0.42° | 2.01 / 1.42° |
| Hierro 7 PGA (TM 2024) · Bogotá | 1.26 / 0.73 mph (0.59%) | 2.51° / 1.45° | 1836 rpm / 1060 rpm | 0.89 / 0.63° | 2.16 / 1.52° |
| Driver aficionado (supuesto) · Bogotá | 1.09 / 0.63 mph (0.47%) | 0.64° / 0.37° | 366 rpm / 211 rpm | 0.82 / 0.58° | 3.23 / 2.28° |
| Hierro 7 aficionado (supuesto) · Bogotá | 1.23 / 0.71 mph (0.71%) | 1.86° / 1.08° | > 3000 rpm / > 3000 rpm | 1.21 / 0.85° | 4.06 / 2.87° |

**Error de carry (1σ, yd, nivel del mar) que implican las especificaciones publicadas** (solo los datos que cada ficha declara)

| Especificación | Driver PGA | Hierro 7 PGA | Driver aficionado (supuesto) |
| :--- | ---: | ---: | ---: |
| Mevo+ (reseña): ±1 mph, ±0.5°, ±150 rpm | 2.6 | 2.0 | 2.8 |
| SkyTrak (afirmación antigua): ±1 mph, ±1° | 3.4 | 1.8 | 3.4 |
| TrackMan 4 (tabla secundaria): ±1 mph, ±50 rpm | 2.1 | 1.8 | 2.4 |
| Bushnell Launch Pro (ficha): ±2 mph | 4.1 | 3.7 | 4.8 |

**Efecto de la densidad del aire** (ΔCarry por +1% de densidad; y error en Bogotá si se usa la presión ISA en vez de la columna cálida, −1.8% de densidad)

| Variante · golpe | Nivel del mar yd/1% | Bogotá yd/1% | Bogotá con p ISA (yd) |
| :--- | ---: | ---: | ---: |
| A) final · Driver PGA (TM 2024) | -0.79 | +0.10 | -0.21 |
| A) final · Hierro 7 PGA (TM 2024) | -0.66 | -0.38 | +0.65 |
| B) cd3=0 · Driver PGA (TM 2024) | -1.04 | -0.53 | +0.90 |
| B) cd3=0 · Hierro 7 PGA (TM 2024) | -0.98 | -0.68 | +1.19 |
| C) cd3=+0.06 · Driver PGA (TM 2024) | -1.28 | -1.14 | +1.99 |
| C) cd3=+0.06 · Hierro 7 PGA (TM 2024) | -1.24 | -1.01 | +1.76 |
