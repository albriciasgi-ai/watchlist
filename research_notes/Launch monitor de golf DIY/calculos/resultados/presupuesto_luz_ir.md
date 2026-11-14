# Presupuesto de luz del estroboscopio IR

Supuestos: ρ bola = 0.8, T lente = 0.9, λ = 860 nm, LED de referencia SFH 4715AS = 0.90 W/sr a 1 A (típico), intensidad proporcional a la corriente en pulsos (supuesto: revisar la corriente de pulso máxima en la hoja de datos). Saturación del IMX296 mono ≈ 10,636 e-.

**1. Electrones por píxel en la bola con UN LED SFH 4715AS a 1 A** (LED junto a la cámara)

| Sensor | QE (supuesto) | f/# | 0.4 m 10 µs | 0.4 m 20 µs | 0.5 m 10 µs | 0.5 m 20 µs | 0.7 m 10 µs | 0.7 m 20 µs |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| IMX296 | 0.10 | 1.4 | 26 | 52 | 17 | 33 | 9 | 17 |
| IMX296 | 0.10 | 2.0 | 13 | 25 | 8 | 16 | 4 | 8 |
| IMX296 | 0.10 | 2.8 | 6 | 13 | 4 | 8 | 2 | 4 |
| IMX296 | 0.20 | 1.4 | 52 | 103 | 33 | 67 | 17 | 34 |
| IMX296 | 0.20 | 2.0 | 25 | 51 | 16 | 33 | 8 | 17 |
| IMX296 | 0.20 | 2.8 | 13 | 26 | 8 | 17 | 4 | 9 |
| IMX296 | 0.35 | 1.4 | 90 | 181 | 58 | 116 | 30 | 60 |
| IMX296 | 0.35 | 2.0 | 44 | 89 | 29 | 57 | 15 | 29 |
| IMX296 | 0.35 | 2.8 | 23 | 45 | 15 | 29 | 7 | 15 |
| OV9281 | 0.10 | 1.4 | 20 | 39 | 13 | 25 | 6 | 13 |
| OV9281 | 0.10 | 2.0 | 10 | 19 | 6 | 12 | 3 | 6 |
| OV9281 | 0.10 | 2.8 | 5 | 10 | 3 | 6 | 2 | 3 |
| OV9281 | 0.20 | 1.4 | 39 | 78 | 25 | 50 | 13 | 26 |
| OV9281 | 0.20 | 2.0 | 19 | 38 | 12 | 25 | 6 | 13 |
| OV9281 | 0.20 | 2.8 | 10 | 20 | 6 | 13 | 3 | 6 |
| OV9281 | 0.35 | 1.4 | 68 | 137 | 44 | 88 | 23 | 45 |
| OV9281 | 0.35 | 2.0 | 33 | 67 | 22 | 43 | 11 | 22 |
| OV9281 | 0.35 | 2.8 | 17 | 34 | 11 | 22 | 6 | 11 |

**2. Intensidad radiante necesaria** (IMX296 a 0.5 m) para 300 e- (SNR de ruido de disparo ≈ 17, mínimo con ganancia) o 1,000 e- (SNR ≈ 32, ~10% de saturación)

| Objetivo e- | QE | f/# | Pulso µs | I necesaria W/sr | N.º de LEDs a 1 A | N.º de LEDs a 3 A (supuesto) | Irradiancia en la bola W/m² |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 300 | 0.10 | 1.4 | 10 | 16.2 | 18 | 6 | 65 |
| 300 | 0.10 | 1.4 | 20 | 8.1 | 9 | 3 | 32 |
| 300 | 0.10 | 2.0 | 10 | 33.1 | 37 | 12 | 133 |
| 300 | 0.10 | 2.0 | 20 | 16.6 | 18 | 6 | 66 |
| 300 | 0.20 | 1.4 | 10 | 8.1 | 9 | 3 | 32 |
| 300 | 0.20 | 1.4 | 20 | 4.1 | 5 | 2 | 16 |
| 300 | 0.20 | 2.0 | 10 | 16.6 | 18 | 6 | 66 |
| 300 | 0.20 | 2.0 | 20 | 8.3 | 9 | 3 | 33 |
| 300 | 0.35 | 1.4 | 10 | 4.6 | 5 | 2 | 19 |
| 300 | 0.35 | 1.4 | 20 | 2.3 | 3 | 1 | 9 |
| 300 | 0.35 | 2.0 | 10 | 9.5 | 11 | 4 | 38 |
| 300 | 0.35 | 2.0 | 20 | 4.7 | 5 | 2 | 19 |
| 1000 | 0.10 | 1.4 | 10 | 54.1 | 60 | 20 | 216 |
| 1000 | 0.10 | 1.4 | 20 | 27.1 | 30 | 10 | 108 |
| 1000 | 0.10 | 2.0 | 10 | 110.4 | 123 | 41 | 442 |
| 1000 | 0.10 | 2.0 | 20 | 55.2 | 61 | 20 | 221 |
| 1000 | 0.20 | 1.4 | 10 | 27.1 | 30 | 10 | 108 |
| 1000 | 0.20 | 1.4 | 20 | 13.5 | 15 | 5 | 54 |
| 1000 | 0.20 | 2.0 | 10 | 55.2 | 61 | 20 | 221 |
| 1000 | 0.20 | 2.0 | 20 | 27.6 | 31 | 10 | 110 |
| 1000 | 0.35 | 1.4 | 10 | 15.5 | 17 | 6 | 62 |
| 1000 | 0.35 | 1.4 | 20 | 7.7 | 9 | 3 | 31 |
| 1000 | 0.35 | 2.0 | 10 | 31.6 | 35 | 12 | 126 |
| 1000 | 0.35 | 2.0 | 20 | 15.8 | 18 | 6 | 63 |

**3. Luz ambiente contra el destello** — 12 LEDs a 3 A a 0.5 m dan 130 W/m² en la bola; 4 destellos de 20 µs. Cociente = energía ambiente / energía del destello que integra el píxel durante toda la exposición (debe ser << 1)

| Ambiente | Exposición ms | Irradiancia en banda W/m² | Ambiente / destello |
| :--- | ---: | ---: | ---: |
| Sol directo, filtro de 50 nm (≈1 W/m²/nm, referencia) | 2 | 50 | 9.65 |
| Luz de día indirecta, 1% del sol (supuesto) | 2 | 0.5 | 0.10 |
| Bombillo halógeno a 2 m (supuesto) | 2 | 0.2 | 0.04 |
| LED blanco de interior (casi sin IR, supuesto) | 2 | 0.002 | 0.00 |
| Sol directo, filtro de 50 nm (≈1 W/m²/nm, referencia) | 5 | 50 | 24.11 |
| Luz de día indirecta, 1% del sol (supuesto) | 5 | 0.5 | 0.24 |
| Bombillo halógeno a 2 m (supuesto) | 5 | 0.2 | 0.10 |
| LED blanco de interior (casi sin IR, supuesto) | 5 | 0.002 | 0.00 |

**4. Alimentación** — una cadena en serie con un MOSFET; V_F ≈ 1.65 V a 1 A (dato de catálogo del SFH 4715A); 4 destellos de 20 µs por golpe; condensador local de 1,000 µF

| LEDs | Corriente A | Tensión de la cadena V | Potencia en el pulso W | Energía por golpe mJ | Caída en 1,000 µF V |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 12 en serie | 1 | 19.8 | 20 | 1.6 | 0.08 |
| 12 en serie | 3 | 23.3 | 70 | 5.6 | 0.24 |
| 24 en serie | 3 | 46.7 | 140 | 11.2 | 0.24 |
