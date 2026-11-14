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

**Validación SIN ajuste — tabla clásica TrackMan** — Smits & Smith 1994: k_cd=1.000, k_cl=1.000, R1=2.00e-05; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 248.7 vs 275.0 (-26.3) | 36.4 vs 32.0 (+4.4) | 40.9 vs 38.0 (+2.9) | 6.99 | 2145 |
| Hierro 7 | 120 / 16.3 / 7097 | 180.7 vs 172.0 (+8.7) | 36.0 vs 32.0 (+4.0) | 44.8 vs 50.0 (-5.2) | 6.86 | 5989 |
| PW | 102 / 24.2 / 9304 | 142.2 vs 136.0 (+6.2) | 37.3 vs 29.0 (+8.3) | 48.8 vs 52.0 (-3.2) | 6.59 | 8083 |

**Validación SIN ajuste — promedios TrackMan 2024** — Smits & Smith 1994: k_cd=1.000, k_cl=1.000, R1=2.00e-05; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 252.6 vs 282.0 (-29.4) | 35.9 vs 35.0 (+0.9) | 40.5 (s/d) | 6.97 | 2026 |
| Hierro 7 | 123 / 16.1 / 7124 | 185.0 vs 176.0 (+9.0) | 37.7 (s/d) | 45.4 vs 51.0 (-5.6) | 7.01 | 5984 |

**SIN ajuste, aire a 25 °C — tabla clásica** — Smits & Smith 1994: k_cd=1.000, k_cl=1.000, R1=2.00e-05; aire: Nivel del mar, 25 °C: p=101.33 kPa, T=25.0 °C, HR=0%, rho=1.1839 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 254.4 vs 275.0 (-20.6) | 36.1 vs 32.0 (+4.1) | 40.1 vs 38.0 (+2.1) | 7.00 | 2135 |
| Hierro 7 | 120 / 16.3 / 7097 | 185.4 vs 172.0 (+13.4) | 36.0 vs 32.0 (+4.0) | 44.2 vs 50.0 (-5.8) | 6.88 | 5967 |
| PW | 102 / 24.2 / 9304 | 145.9 vs 136.0 (+9.9) | 37.4 vs 29.0 (+8.4) | 48.3 vs 52.0 (-3.7) | 6.61 | 8060 |

**Validación CON ajuste CD+CL — tabla clásica (ajuste)** — Smits & Smith 1994 ajustado: k_cd=0.942, k_cl=0.925, R1=2.00e-05; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 253.2 vs 275.0 (-21.8) | 34.5 vs 32.0 (+2.5) | 39.2 vs 38.0 (+1.2) | 6.82 | 2139 |
| Hierro 7 | 120 / 16.3 / 7097 | 185.5 vs 172.0 (+13.5) | 34.5 vs 32.0 (+2.5) | 43.5 vs 50.0 (-6.5) | 6.72 | 5973 |
| PW | 102 / 24.2 / 9304 | 147.0 vs 136.0 (+11.0) | 36.4 vs 29.0 (+7.4) | 47.9 vs 52.0 (-4.1) | 6.51 | 8060 |

**CON ajuste CD+CL — TrackMan 2024 (fuera del ajuste)** — Smits & Smith 1994 ajustado: k_cd=0.942, k_cl=0.925, R1=2.00e-05; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 257.2 vs 282.0 (-24.8) | 34.1 vs 35.0 (-0.9) | 38.8 (s/d) | 6.80 | 2020 |
| Hierro 7 | 123 / 16.1 / 7124 | 190.2 vs 176.0 (+14.2) | 36.1 (s/d) | 44.0 vs 51.0 (-7.0) | 6.88 | 5966 |

**Validación CON ajuste CD+CL+R1 — tabla clásica (ajuste)** — Smits & Smith 1994 ajustado: k_cd=0.940, k_cl=0.913, R1=5.00e-06; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 167 / 10.9 / 2686 | 254.0 vs 275.0 (-21.0) | 34.6 vs 32.0 (+2.6) | 39.1 vs 38.0 (+1.1) | 6.88 | 2537 |
| Hierro 7 | 120 / 16.3 / 7097 | 185.0 vs 172.0 (+13.0) | 34.3 vs 32.0 (+2.3) | 43.4 vs 50.0 (-6.6) | 6.73 | 6798 |
| PW | 102 / 24.2 / 9304 | 146.5 vs 136.0 (+10.5) | 36.2 vs 29.0 (+7.2) | 47.9 vs 52.0 (-4.1) | 6.50 | 8977 |

**CON ajuste CD+CL+R1 — TrackMan 2024 (fuera del ajuste)** — Smits & Smith 1994 ajustado: k_cd=0.940, k_cl=0.913, R1=5.00e-06; aire: Nivel del mar, ISA 15 °C: p=101.33 kPa, T=15.0 °C, HR=0%, rho=1.2250 kg/m³

| Palo | Bola mph / VLA° / rpm | Carry yd sim vs TM (err) | Altura máx yd sim vs TM (err) | Ángulo llegada ° sim vs TM (err) | Vuelo s | Giro al aterrizar rpm |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver | 171 / 10.4 / 2545 | 258.1 vs 282.0 (-23.9) | 34.2 vs 35.0 (-0.8) | 38.7 (s/d) | 6.85 | 2402 |
| Hierro 7 | 123 / 16.1 / 7124 | 189.6 vs 176.0 (+13.6) | 35.9 (s/d) | 44.0 vs 51.0 (-7.0) | 6.89 | 6816 |

**Resumen del ajuste (RMS de errores: carry yd / altura yd / llegada °)**

| Modelo | k_cd | k_cl | R1 | RMS tabla clásica (ajuste) | RMS TM 2024 (validación) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Sin ajuste | 1.000 | 1.000 | 2.00e-05 | 16.4 / 5.9 / 3.9 | 21.7 / 0.9 / 5.6 |
| CD+CL | 0.942 | 0.925 | 2.00e-05 | 16.1 / 4.7 / 4.5 | 20.2 / 0.9 / 7.0 |
| CD+CL+R1 | 0.940 | 0.913 | 5.00e-06 | 15.5 / 4.6 / 4.5 | 19.5 / 0.8 / 7.0 |

**Carry según la altitud (modelo ajustado CD+CL)**

| Aire | p kPa | ρ kg/m³ | Driver (TM 2024): carry yd (Δ%) · altura yd · llegada | Hierro 7 (TM 2024): carry yd (Δ%) · altura yd · llegada | PW (TM clásico): carry yd (Δ%) · altura yd · llegada |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Nivel del mar, ISA 15 °C | 101.3 | 1.225 | 257.2 (+0.0%) · h 34.1 · 39° | 190.2 (+0.0%) · h 36.1 · 44° | 147.0 (+0.0%) · h 36.4 · 48° |
| Medellín 1,495 m, ISA (5.3 °C) | 84.6 | 1.059 | 274.7 (+6.8%) · h 32.1 · 35° | 206.0 (+8.3%) · h 34.7 · 41° | 159.6 (+8.6%) · h 35.7 · 46° |
| Medellín 1,495 m, p ISA + 22 °C | 84.6 | 0.999 | 284.4 (+10.6%) · h 31.7 · 34° | 213.7 (+12.3%) · h 34.3 · 40° | 165.2 (+12.4%) · h 35.5 · 45° |
| Medellín 1,495 m, columna cálida + 22 °C | 85.5 | 1.009 | 283.1 (+10.1%) · h 31.8 · 34° | 212.6 (+11.8%) · h 34.5 · 40° | 164.4 (+11.9%) · h 35.6 · 45° |
| Bogotá 2,640 m, ISA (-2.2 °C) | 73.4 | 0.943 | 287.8 (+11.9%) · h 30.6 · 32° | 217.1 (+14.2%) · h 33.2 · 38° | 168.6 (+14.7%) · h 34.8 · 44° |
| Bogotá 2,640 m, p ISA + 14 °C | 73.4 | 0.890 | 297.2 (+15.6%) · h 30.1 · 31° | 224.0 (+17.8%) · h 32.8 · 37° | 173.6 (+18.1%) · h 34.6 · 43° |
| Bogotá 2,640 m, columna cálida + 14 °C | 74.7 | 0.906 | 295.1 (+14.7%) · h 30.4 · 31° | 222.4 (+16.9%) · h 33.0 · 38° | 172.3 (+17.2%) · h 34.7 · 43° |

**Carry según la altitud (modelo SIN ajuste, para comparar)**

| Aire | p kPa | ρ kg/m³ | Driver (TM 2024): carry yd (Δ%) · altura yd · llegada | Hierro 7 (TM 2024): carry yd (Δ%) · altura yd · llegada | PW (TM clásico): carry yd (Δ%) · altura yd · llegada |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Nivel del mar, ISA 15 °C | 101.3 | 1.225 | 252.6 (+0.0%) · h 35.9 · 41° | 185.0 (+0.0%) · h 37.7 · 45° | 142.2 (+0.0%) · h 37.3 · 49° |
| Medellín 1,495 m, ISA (5.3 °C) | 84.6 | 1.059 | 271.5 (+7.5%) · h 34.1 · 37° | 201.9 (+9.1%) · h 36.4 · 43° | 155.5 (+9.4%) · h 36.7 · 47° |
| Medellín 1,495 m, p ISA + 22 °C | 84.6 | 0.999 | 281.8 (+11.5%) · h 33.7 · 36° | 210.0 (+13.5%) · h 36.2 · 41° | 161.4 (+13.5%) · h 36.6 · 46° |
| Medellín 1,495 m, columna cálida + 22 °C | 85.5 | 1.009 | 280.4 (+11.0%) · h 33.8 · 36° | 208.8 (+12.9%) · h 36.3 · 42° | 160.6 (+12.9%) · h 36.7 · 46° |
| Bogotá 2,640 m, ISA (-2.2 °C) | 73.4 | 0.943 | 285.8 (+13.1%) · h 32.5 · 34° | 214.1 (+15.7%) · h 35.1 · 40° | 165.2 (+16.1%) · h 36.0 · 45° |
| Bogotá 2,640 m, p ISA + 14 °C | 73.4 | 0.890 | 295.9 (+17.1%) · h 32.1 · 33° | 221.5 (+19.7%) · h 34.6 · 39° | 170.5 (+19.9%) · h 35.7 · 44° |
| Bogotá 2,640 m, columna cálida + 14 °C | 74.7 | 0.906 | 293.6 (+16.2%) · h 32.3 · 33° | 219.7 (+18.8%) · h 34.9 · 39° | 169.2 (+18.9%) · h 35.9 · 44° |

**Driver TM 2024 a lo largo del vuelo (modelo ajustado)**

| t s | V m/s | giro rpm | S | Re | CD | CL |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0.00 | 76.4 | 2545 | 0.074 | 223k | 0.288 | 0.177 |
| 1.00 | 51.8 | 2400 | 0.103 | 151k | 0.290 | 0.202 |
| 2.00 | 38.7 | 2301 | 0.133 | 113k | 0.269 | 0.223 |
| 3.00 | 31.2 | 2228 | 0.160 | 91k | 0.254 | 0.240 |
| 4.00 | 27.2 | 2168 | 0.178 | 80k | 0.247 | 0.250 |
| 5.00 | 26.2 | 2115 | 0.181 | 76k | 0.245 | 0.252 |
| 6.80 | 28.7 | 2020 | 0.157 | 84k | 0.247 | 0.238 |
