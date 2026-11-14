# Resultados del simulador de trayectoria

Escenarios de aire:

- Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³
- Nivel del mar, 25 °C: p=101.33 kPa, T=25.0 °C, HR=0%, rho=1.1839 kg/m³
- Medellín 1,495 m, ISA (5.3 °C): p=84.61 kPa, T=5.3 °C, HR=0%, rho=1.0586 kg/m³
- Medellín 1,495 m, p ISA + 22 °C: p=84.61 kPa, T=22.0 °C, HR=0%, rho=0.9986 kg/m³
- Medellín 1,495 m, columna cálida + 22 °C: p=85.46 kPa, T=22.0 °C, HR=0%, rho=1.0087 kg/m³
- Bogotá 2,640 m, ISA (-2.2 °C): p=73.38 kPa, T=-2.2 °C, HR=0%, rho=0.9433 kg/m³
- Bogotá 2,640 m, p ISA + 14 °C: p=73.38 kPa, T=14.0 °C, HR=0%, rho=0.8902 kg/m³
- Bogotá 2,640 m, columna cálida + 14 °C: p=74.69 kPa, T=14.0 °C, HR=0%, rho=0.9061 kg/m³

**1) Modelo publicado, SIN ajuste — tabla clásica** — Smits & Smith 1994 (publicado): constantes publicadas; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 248.7 vs 275.0 (-26.3) | 36.4 vs 32.0 (+4.4) | 40.9 vs 38.0 (+2.9) | 6.99 | 2145 |
| Hierro 7 | 120 / 16.3 / 7097 | 180.7 vs 172.0 (+8.7) | 36.0 vs 32.0 (+4.0) | 44.8 vs 50.0 (-5.2) | 6.86 | 5989 |
| PW | 102 / 24.2 / 9304 | 142.2 vs 136.0 (+6.2) | 37.3 vs 29.0 (+8.3) | 48.8 vs 52.0 (-3.2) | 6.59 | 8083 |

**1) Modelo publicado, SIN ajuste — TrackMan 2024** — Smits & Smith 1994 (publicado): constantes publicadas; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 252.6 vs 282.0 (-29.4) | 35.9 vs 35.0 (+0.9) | 40.5 (s/d) | 6.97 | 2026 |
| Hierro 7 | 123 / 16.1 / 7124 | 185.0 vs 176.0 (+9.0) | 37.7 (s/d) | 45.4 vs 51.0 (-5.6) | 7.01 | 5984 |

**1b) Publicado, aire a 25 °C — tabla clásica** — Smits & Smith 1994 (publicado): constantes publicadas; aire: Nivel del mar, 25 °C: p=101.33 kPa, T=25.0 °C, HR=0%, rho=1.1839 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 254.4 vs 275.0 (-20.6) | 36.1 vs 32.0 (+4.1) | 40.1 vs 38.0 (+2.1) | 7.00 | 2135 |
| Hierro 7 | 120 / 16.3 / 7097 | 185.4 vs 172.0 (+13.4) | 36.0 vs 32.0 (+4.0) | 44.2 vs 50.0 (-5.8) | 6.88 | 5967 |
| PW | 102 / 24.2 / 9304 | 145.9 vs 136.0 (+9.9) | 37.4 vs 29.0 (+8.4) | 48.3 vs 52.0 (-3.7) | 6.61 | 8060 |

**2) Solo escalar CD y CL (2 factores, ajuste con ambas tablas) — tabla clásica** — Publicado con CD y CL escalados: k_cd=0.9351 (publ. 1), k_cl=0.9601 (publ. 1); aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 257.5 vs 275.0 (-17.5) | 36.6 vs 32.0 (+4.6) | 40.0 vs 38.0 (+2.0) | 7.05 | 2129 |
| Hierro 7 | 120 / 16.3 / 7097 | 187.3 vs 172.0 (+15.3) | 36.2 vs 32.0 (+4.2) | 44.0 vs 50.0 (-6.0) | 6.90 | 5957 |
| PW | 102 / 24.2 / 9304 | 147.6 vs 136.0 (+11.6) | 37.6 vs 29.0 (+8.6) | 48.1 vs 52.0 (-3.9) | 6.63 | 8048 |

**2) Solo escalar CD y CL (2 factores, ajuste con ambas tablas) — TrackMan 2024** — Publicado con CD y CL escalados: k_cd=0.9351 (publ. 1), k_cl=0.9601 (publ. 1); aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 261.6 vs 282.0 (-20.4) | 36.2 vs 35.0 (+1.2) | 39.7 (s/d) | 7.02 | 2011 |
| Hierro 7 | 123 / 16.1 / 7124 | 191.9 vs 176.0 (+15.9) | 37.9 (s/d) | 44.5 vs 51.0 (-6.5) | 7.06 | 5950 |

**3) Validación cruzada: 4 constantes ajustadas SOLO con la tabla clásica — tabla clásica** — Re-ajuste solo con la tabla clásica: cd2=0.27 (publ. 0.18), cd3=-0.06874 (publ. 0.06), cl1=0.4878 (publ. 0.54), p=0.5045 (publ. 0.4); aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 275.1 vs 275.0 (+0.1) | 32.4 vs 32.0 (+0.4) | 38.3 vs 38.0 (+0.3) | 6.64 | 2102 |
| Hierro 7 | 120 / 16.3 / 7097 | 173.9 vs 172.0 (+1.9) | 30.8 vs 32.0 (-1.2) | 46.4 vs 50.0 (-3.6) | 6.26 | 6041 |
| PW | 102 / 24.2 / 9304 | 130.3 vs 136.0 (-5.7) | 32.1 vs 29.0 (+3.1) | 52.0 vs 52.0 (+0.0) | 6.00 | 8189 |

**3) Validación cruzada: 4 constantes ajustadas SOLO con la tabla clásica — TrackMan 2024** — Re-ajuste solo con la tabla clásica: cd2=0.27 (publ. 0.18), cd3=-0.06874 (publ. 0.06), cl1=0.4878 (publ. 0.54), p=0.5045 (publ. 0.4); aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 281.1 vs 282.0 (-0.9) | 31.8 vs 35.0 (-3.2) | 37.5 (s/d) | 6.61 | 1983 |
| Hierro 7 | 123 / 16.1 / 7124 | 179.6 vs 176.0 (+3.6) | 32.6 (s/d) | 47.1 vs 51.0 (-3.9) | 6.44 | 6029 |

**4) MODELO FINAL: 4 constantes ajustadas con ambas tablas — tabla clásica** — Smits & Smith 1994 re-ajustado a TrackMan: cd2=0.2841 (publ. 0.18), cd3=-0.06699 (publ. 0.06), cl1=0.5002 (publ. 0.54), p=0.499 (publ. 0.4); aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 275.6 vs 275.0 (+0.6) | 33.7 vs 32.0 (+1.7) | 39.4 vs 38.0 (+1.4) | 6.78 | 2100 |
| Hierro 7 | 120 / 16.3 / 7097 | 172.4 vs 172.0 (+0.4) | 31.4 vs 32.0 (-0.6) | 47.1 vs 50.0 (-2.9) | 6.31 | 6046 |
| PW | 102 / 24.2 / 9304 | 128.5 vs 136.0 (-7.5) | 32.3 vs 29.0 (+3.3) | 52.5 vs 52.0 (+0.5) | 6.02 | 8199 |

**4) MODELO FINAL: 4 constantes ajustadas con ambas tablas — TrackMan 2024** — Smits & Smith 1994 re-ajustado a TrackMan: cd2=0.2841 (publ. 0.18), cd3=-0.06699 (publ. 0.06), cl1=0.5002 (publ. 0.54), p=0.499 (publ. 0.4); aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 281.8 vs 282.0 (-0.2) | 33.1 vs 35.0 (-1.9) | 38.6 (s/d) | 6.75 | 1980 |
| Hierro 7 | 123 / 16.1 / 7124 | 177.8 vs 176.0 (+1.8) | 33.2 (s/d) | 47.8 vs 51.0 (-3.2) | 6.49 | 6035 |

**Resumen (RMS de errores: carry yd / altura yd / ángulo de llegada °)**

| Variante | Constantes cambiadas | RMS tabla clásica | RMS TrackMan 2024 |
| :--- | ---: | ---: | ---: |
| 1) publicado | constantes publicadas | 16.4 / 5.9 / 3.9 | 21.7 / 0.9 / 5.6 |
| 2) escalar CD y CL | k_cd=0.9351 (publ. 1), k_cl=0.9601 (publ. 1) | 15.0 / 6.1 / 4.3 | 18.3 / 1.2 / 6.5 |
| 3) 4 const., tabla clásica | cd2=0.27 (publ. 0.18), cd3=-0.06874 (publ. 0.06), cl1=0.4878 (publ. 0.54), p=0.5045 (publ. 0.4) | 3.5 / 1.9 / 2.1 | 2.6 / 3.2 / 3.9 |
| 4) final, ambas tablas | cd2=0.2841 (publ. 0.18), cd3=-0.06699 (publ. 0.06), cl1=0.5002 (publ. 0.54), p=0.499 (publ. 0.4) | 4.3 / 2.2 / 1.9 | 1.3 / 1.9 / 3.2 |

**Banda de incertidumbre de la altitud: tres variantes que ajustan casi igual a nivel del mar** (carry a nivel del mar → Medellín / Bogotá, columna cálida con 22 °C y 14 °C)

| Variante | Constantes | RMS clásica · 2024 (yd/yd/°) | Driver yd | Hierro 7 yd | PW yd |
| :--- | ---: | ---: | ---: | ---: | ---: |
| A) final (cd3 ajustado) | cd2=0.2841 (publ. 0.18), cd3=-0.06699 (publ. 0.06), cl1=0.5002 (publ. 0.54), p=0.499 (publ. 0.4) | 4.3/2.2/1.9 · 1.3/1.9/3.2 | 282 → 289 (+2.5%) / 291 (+3.1%) | 178 → 188 (+5.8%) / 193 (+8.7%) | 129 → 139 (+8.5%) / 145 (+13.1%) |
| B) cd3 = 0 | cd1=0.1916 (publ. 0.24), cd2=0.3566 (publ. 0.18), cd3=0 (publ. 0.06), cl1=0.5102 (publ. 0.54), p=0.4801 (publ. 0.4) | 4.8/2.4/2.1 · 1.2/1.2/3.9 | 281 → 298 (+6.1%) / 305 (+8.5%) | 177 → 195 (+9.9%) / 203 (+14.4%) | 128 → 142 (+11.5%) / 150 (+17.2%) |
| C) cd3 = +0.06 (publicado) | cd1=0.1513 (publ. 0.24), cd2=0.419 (publ. 0.18), cl1=0.5197 (publ. 0.54), p=0.4644 (publ. 0.4) | 5.4/2.6/2.5 · 1.1/0.7/4.5 | 281 → 307 (+9.5%) / 319 (+13.5%) | 177 → 201 (+13.6%) / 212 (+19.7%) | 127 → 145 (+14.2%) / 153 (+21.1%) |

**Carry según la altitud (modelo final)**

| Aire | p kPa | ρ kg/m³ | Driver (TM 2024): carry yd (Δ%) · altura yd · llegada | Hierro 7 (TM 2024): carry yd (Δ%) · altura yd · llegada | PW (TM clásico): carry yd (Δ%) · altura yd · llegada |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Nivel del mar, ISA 15 °C | 101.3 | 1.225 | 281.8 (+0.0%) · h 33.1 · 39° | 177.8 (+0.0%) · h 33.2 · 48° | 128.5 (+0.0%) · h 32.3 · 52° |
| Medellín 1,495 m, ISA (5.3 °C) | 84.6 | 1.059 | 291.1 (+3.3%) · h 29.9 · 34° | 187.3 (+5.3%) · h 30.6 · 44° | 137.5 (+7.0%) · h 31.1 · 50° |
| Medellín 1,495 m, p ISA + 22 °C | 84.6 | 0.999 | 289.0 (+2.5%) · h 28.2 · 32° | 188.7 (+6.1%) · h 29.2 · 42° | 140.0 (+8.9%) · h 30.4 · 49° |
| Medellín 1,495 m, columna cálida + 22 °C | 85.5 | 1.009 | 288.9 (+2.5%) · h 28.5 · 33° | 188.2 (+5.8%) · h 29.4 · 42° | 139.5 (+8.5%) · h 30.5 · 49° |
| Bogotá 2,640 m, ISA (-2.2 °C) | 73.4 | 0.943 | 294.3 (+4.4%) · h 27.3 · 31° | 193.3 (+8.7%) · h 28.6 · 41° | 143.9 (+12.0%) · h 30.2 · 47° |
| Bogotá 2,640 m, p ISA + 14 °C | 73.4 | 0.890 | 290.3 (+3.0%) · h 25.7 · 29° | 194.0 (+9.1%) · h 27.3 · 39° | 146.2 (+13.7%) · h 29.5 · 46° |
| Bogotá 2,640 m, columna cálida + 14 °C | 74.7 | 0.906 | 290.5 (+3.1%) · h 26.1 · 29° | 193.4 (+8.7%) · h 27.6 · 39° | 145.3 (+13.1%) · h 29.7 · 47° |

**Carry según la altitud (modelo publicado, para comparar)**

| Aire | p kPa | ρ kg/m³ | Driver (TM 2024): carry yd (Δ%) · altura yd · llegada | Hierro 7 (TM 2024): carry yd (Δ%) · altura yd · llegada | PW (TM clásico): carry yd (Δ%) · altura yd · llegada |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Nivel del mar, ISA 15 °C | 101.3 | 1.225 | 252.6 (+0.0%) · h 35.9 · 41° | 185.0 (+0.0%) · h 37.7 · 45° | 142.2 (+0.0%) · h 37.3 · 49° |
| Medellín 1,495 m, ISA (5.3 °C) | 84.6 | 1.059 | 271.5 (+7.5%) · h 34.1 · 37° | 201.9 (+9.1%) · h 36.4 · 43° | 155.5 (+9.4%) · h 36.7 · 47° |
| Medellín 1,495 m, p ISA + 22 °C | 84.6 | 0.999 | 281.8 (+11.5%) · h 33.7 · 36° | 210.0 (+13.5%) · h 36.2 · 41° | 161.4 (+13.5%) · h 36.6 · 46° |
| Medellín 1,495 m, columna cálida + 22 °C | 85.5 | 1.009 | 280.4 (+11.0%) · h 33.8 · 36° | 208.8 (+12.9%) · h 36.3 · 42° | 160.6 (+12.9%) · h 36.7 · 46° |
| Bogotá 2,640 m, ISA (-2.2 °C) | 73.4 | 0.943 | 285.8 (+13.1%) · h 32.5 · 34° | 214.1 (+15.7%) · h 35.1 · 40° | 165.2 (+16.1%) · h 36.0 · 45° |
| Bogotá 2,640 m, p ISA + 14 °C | 73.4 | 0.890 | 295.9 (+17.1%) · h 32.1 · 33° | 221.5 (+19.7%) · h 34.6 · 39° | 170.5 (+19.9%) · h 35.7 · 44° |
| Bogotá 2,640 m, columna cálida + 14 °C | 74.7 | 0.906 | 293.6 (+16.2%) · h 32.3 · 33° | 219.7 (+18.8%) · h 34.9 · 39° | 169.2 (+18.9%) · h 35.9 · 44° |

**Driver TM 2024 a lo largo del vuelo (modelo final)**

| t s | V m/s | giro rpm | S | Re | CD | CL |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.00 | 76.4 | 2545 | 0.074 | 223k | 0.203 | 0.137 |
| 1.00 | 57.7 | 2392 | 0.093 | 168k | 0.203 | 0.153 |
| 2.00 | 44.9 | 2280 | 0.113 | 131k | 0.232 | 0.169 |
| 3.00 | 36.0 | 2196 | 0.136 | 105k | 0.263 | 0.185 |
| 4.00 | 30.4 | 2129 | 0.157 | 89k | 0.286 | 0.198 |
| 5.00 | 27.8 | 2072 | 0.167 | 81k | 0.297 | 0.205 |
| 6.75 | 28.5 | 1980 | 0.155 | 83k | 0.291 | 0.198 |

**Hierro 7 TM 2024 a lo largo del vuelo (modelo final)**

| t s | V m/s | giro rpm | S | Re | CD | CL |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.00 | 55.0 | 7124 | 0.289 | 161k | 0.262 | 0.269 |
| 1.00 | 39.7 | 6817 | 0.383 | 116k | 0.322 | 0.310 |
| 2.00 | 28.8 | 6604 | 0.512 | 84k | 0.391 | 0.358 |
| 3.00 | 21.9 | 6451 | 0.657 | 64k | 0.453 | 0.406 |
| 4.00 | 19.1 | 6330 | 0.742 | 56k | 0.485 | 0.431 |
| 5.00 | 19.6 | 6217 | 0.708 | 57k | 0.474 | 0.421 |
| 6.49 | 23.3 | 6035 | 0.578 | 68k | 0.427 | 0.380 |

