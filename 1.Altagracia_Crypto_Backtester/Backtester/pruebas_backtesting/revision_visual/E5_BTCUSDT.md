# Revisión visual · Etapa 5 · Tus corridas reales en BTC

Son las corridas guardadas del usuario en BTC que sostienen sus conclusiones:
- cada regla en cada fase, con la variante de más corridas;
- las otras variantes con corrida en BTC;
- las dos de 15m: la ruptura de caja y los sabios.

En total, 25 corridas. Una no tiene trades en BTC: solo cortos con el régimen en 1D (`19408a92`), así que quedan
24 con trades. Cada una se abrió desde el Historial de la página aislada, como lo hace el usuario. En las fases 2 y 3 la
cola pide "Ver el gráfico de la fase N", porque el gráfico está tapado hasta pedirlo. Lista en
`evidencia/etapa5/corridas_btc.txt`; capturas en `evidencia/pantalla/E5_*`.

| Regla | Corrida | Trades | R medio | Capa A (oráculos) | Capa B (pantalla) | Capa C (capturas) |
|---|---|---|---|---|---|---|
| CAJA | `BTCUSDT_240_f2_1a4ac5c5997b8971_1795123575` | 35 | +0.433 | 6,104 llamadas: A igual · B igual | 35 de 35, 0 distintos | 35 de 35 bien |
| CAJA | `BTCUSDT_240_f3_1a4ac5c5997b8971_1795123745` | 32 | +0.063 | 6,039 llamadas: A igual · B igual | 32 de 32, 0 distintos | 32 de 32 bien |
| CAJA | `BTCUSDT_240_f1_1a4ac5c5997b8971_1795216541` | 70 | +0.719 | 6,089 llamadas: A igual · B igual | 70 de 70, 0 distintos | 70 de 70 bien |
| B5 | `BTCUSDT_240_f1_2277e57a0a6af67c_1795206016` | 113 | +0.261 | 6,115 llamadas: A igual · B bars 5 | 113 de 113, 0 distintos | 113 de 113 bien |
| B5 | `BTCUSDT_240_f2_2277e57a0a6af67c_1795191893` | 50 | +0.234 | 6,050 llamadas: A igual · B bars 1 | 50 de 50, 0 distintos | 50 de 50 bien |
| B5 | `BTCUSDT_240_f3_2277e57a0a6af67c_1795192647` | 53 | +0.035 | 6,053 llamadas: A igual · B bars 1 | 53 de 53, 0 distintos | 53 de 53 bien |
| B5 (variante 2) | `BTCUSDT_240_f1_bb0b79db619e9f85_1795207618` | 119 | -0.055 | 6,119 llamadas: A igual · B bars 3 | 119 de 119, 0 distintos | 119 de 119 bien |
| CAJA (variante 2) | `BTCUSDT_240_f1_c4505fc898bc9be3_1795131756` | 8 | -0.551 | 6,008 llamadas: A igual · B igual | 8 de 8, 0 distintos | 8 de 8 bien |
| CAJA-CORTOS (variante 2) | `BTCUSDT_240_f1_d4e84ccbfb75e15e_1795127127` | 34 | +0.720 | 6,057 llamadas: A igual · B igual | 34 de 34, 0 distintos | 34 de 34 bien |
| FVG 0.3 3R | `BTCUSDT_240_f1_2172c8db76189122_1795122302` | 266 | +0.305 | 6,267 llamadas: A igual · B igual | 266 de 266, 0 distintos | 266 de 266 bien |
| FVG 0.3 3R | `BTCUSDT_240_f2_2172c8db76189122_1795122621` | 111 | +0.067 | 6,112 llamadas: A igual · B igual | 111 de 111, 0 distintos | 111 de 111 bien |
| FVG nuevo 0.3 | `BTCUSDT_240_f2_fab061342fee1768_1795289206` | 111 | +0.067 | 6,112 llamadas: A igual · B igual | 111 de 111, 0 distintos | 111 de 111 bien |
| IMPULSO | `BTCUSDT_240_f2_23b21dce556d2563_1795288896` | 88 | +0.041 | 6,089 llamadas: A igual · B igual | 88 de 88, 0 distintos | 88 de 88 bien |
| VPA QB | `BTCUSDT_240_f1_bc688d3531d6a833_1795282951` | 197 | +0.068 | 6,197 llamadas: A igual · B igual | 197 de 197, 0 distintos | 197 de 197 bien |
| VPA QB | `BTCUSDT_240_f2_bc688d3531d6a833_1795282982` | 75 | +0.012 | 6,075 llamadas: A igual · B igual | 75 de 75, 0 distintos | 75 de 75 bien |
| VPA QB | `BTCUSDT_240_f3_bc688d3531d6a833_1795287031` | 77 | -0.294 | 6,079 llamadas: A igual · B igual | 77 de 77, 0 distintos | 77 de 77 bien |
| MIXTO Impulso | `BTCUSDT_240_f2_88b62b6f156f1ccd_1795289048` | 82 | +0.049 | 6,083 llamadas: A igual · B chain_on 6020 | 82 de 82, 0 distintos | 82 de 82 bien |
| CAJA 15m | `BTCUSDT_15_f1_0a7fe8a0876c1556_1795125199` | 1156 | -0.081 | 7,157 llamadas: A igual · B igual | 1156 de 1156, 0 distintos | 1156 de 1156 bien |
| MIXTO FVG | `BTCUSDT_240_f2_8b6f6ad7aee03e69_1795289368` | 109 | -0.077 | 6,110 llamadas: A igual · B chain_on 6047 | 109 de 109, 0 distintos | 109 de 109 bien |
| MIXTO Caja | `BTCUSDT_240_f2_3e3ab9707a79fd47_1795289572` | 35 | +0.547 | 6,104 llamadas: A igual · B chain_on 6035 | 35 de 35, 0 distintos | 35 de 35 bien |
| SABIOS 4h | `BTCUSDT_240_f1_e6ff561aeaac2240_1795241591` | 153 | +0.042 | 6,182 llamadas: A igual · B igual | 153 de 153, 0 distintos | 153 de 153 bien |
| FLECHA VWAP | `BTCUSDT_240_f1_7f537484b9453d78_1795015421` | 133 | +0.346 | 6,134 llamadas: A igual · B igual | 133 de 133, 0 distintos | 133 de 133 bien |
| FLECHA VWAP | `BTCUSDT_240_f2_7f537484b9453d78_1795015770` | 66 | +0.145 | 6,066 llamadas: A igual · B igual | 66 de 66, 0 distintos | 66 de 66 bien |
| SABIOS 15m | `BTCUSDT_15_f1_3a515e2cf8548d38_1795241539` | 2814 | -0.211 | 8,814 llamadas: A igual · B igual | 2814 de 2814, 0 distintos | 2814 de 2814 bien |

- **Capa A** (`evidencia/capa_a/E5_*.json`): **las 150,215 llamadas de las 24 corridas son iguales al oráculo A** (la
  regla y sus dos controles, de 3,000 entradas cada uno). La selección de "una posición a la vez" da los mismos trades en
  todas. Con el oráculo B solo salen diferencias ya explicadas:
  - las velas de las salidas por señal contraria de la B5 (E-04);
  - el campo `chain_on` de los objetivos mixtos: B no lo da, y el objetivo, la salida y el R son iguales (R10, etapa 2).

  La VPA de la fase 3 se corrió hoy con 79 trades; la guardada tiene 77, porque la fase 3 creció.
- **Capa B** (`evidencia/etapa5/capa_b_etapa5.log`): en los 5,987 trades, la pantalla dice lo mismo que la corrida
  guardada. El comparador redondea ahora como la página (`js_fixed`); antes, un R de −1.125 exacto daba una diferencia
  que no era de la app.
- **Capa C:** las 5,987 capturas pasaron su comprobación automática:
  - la entrada en la apertura;
  - la salida recalculada con las velas del gráfico;
  - la tabla de la vela de la señal en ✓.

  Nueve agentes aparte revisaron 305 hojas de contactos: **ningún trade mal**. Sus dudas se cerraron con los números de
  la corrida o con la captura a tamaño real:
  - lados que no se distinguían (VPA f1 #106, flecha f1 #59): bien;
  - R fuera de lo común: stops de 0.04% a 0.3% del precio, donde la comisión vale de 1 a 2.7 R (más evidencia de H18;
    p. ej. sabios 15m #189, −3.65 R con un stop de 0.041%);
  - salidas por un hueco de datos al final de la fase 3 (VPA f3 #77): es la corrida guardada; hoy el trade sigue
    (repetición, "hueco al final");
  - el AO y el MFI no salen en las capturas porque se recorta el área del precio. En la página se encienden (visto en
    pantalla con el trade #4 de los sabios de 4h).
- **Hallado en esta revisión:**
  - **F-10:** al pasar el gráfico al marco de la regla, los sabios se dibujan con los ajustes guardados (1, 2 y 3), no con
    los de la regla (solo el 2). Afecta a las capturas de los sabios de 15m desde el #1801.
  - **O-18:** "FVG 0.3 · 3R" y "FVG nuevo 0.3 ATR, stop 1.5 ATR, 3R" son la misma regla y dan los mismos 111 trades en la
    fase 2; el tablero las cuenta como dos.
  - **O-19:** con el stop en ATR, la sensibilidad muestra tres variantes del margen del stop que no cambian nada.
