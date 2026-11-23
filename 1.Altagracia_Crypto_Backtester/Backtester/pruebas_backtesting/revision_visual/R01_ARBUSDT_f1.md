# Revisión visual · R01 · ARBUSDT · 4h · fase 1

Regla: FVG nuevo (hueco ≥ 0.3 ATR), a mercado, stop 1.5 ATR (margen 0.1, máx. 6), objetivo 3R, una posición a la vez.
Corrida aislada: `ARBUSDT_240_f1_40c4a72fd708687c_1795304688` · 54 trades · −0.069 R por trade.
Capa A (oráculo A, 6,055 llamadas: regla y azares): sin diferencias. Selección: 54 = 54.
Capturas y texto de cada trade: `evidencia/pantalla/R01_ARBUSDT_f1/trade_NNNN.jpg` y `.json`.

Lista V1–V12 del protocolo (sección 6). "OK" = todos los puntos que aplican se cumplen en la captura.
En R01 no aplican V3 (filtros), V4 (líneas) ni V10 (stop fijo).

| # | Lado | R | Salida | Veredicto | Notas |
|---|---|---|---|---|---|
| 1 | C | −1.02 | stop | OK | FVG [1.393, 1.431] entre la k y la k−2; la vela anterior a la salida no llega al stop |
| 2 | L | −1.02 | stop | OK | Toca el stop en la misma vela de la entrada (abrió sobre el stop: sin salto) |
| 3 | C | +2.98 | objetivo | OK | 71 velas; nunca vuelve al stop; el objetivo se toca en la vela de la cruz |
| 4 | C | −1.02 | stop | OK | Señal en la vela verde tras el impulso; la entrada abre en el cierre de la señal |
| 5 | C | −1.02 | stop | OK | |
| 6 | L | −1.03 | stop | OK | |
| 7 | C | −1.05 | stop | OK | |
| 8 | L | −1.04 | stop | OK | |
| 9 | C | −1.04 | stop | OK | La vela anterior a la salida queda bajo el stop (≈1.140 contra 1.151) |
| 10 | L | +2.96 | objetivo | OK | |
| 11 | C | −1.03 | stop | OK | |
| 12 | L | −1.03 | stop | OK | |
| 13 | C | +2.96 | objetivo | OK | Toca el objetivo en la segunda vela; la primera se queda en 1.10 |
| 14 | L | −1.02 | stop | OK, con observación O-01 | A primera vista la cruz está en una vela que no llega al stop. De cerca: la vela de la salida (07/06 08:00 UTC) baja hasta 1.1325 y toca el stop 1.1405, pero **la línea punteada vertical de la salida se dibuja sobre el centro de esa vela y tapa su mecha**. Además, la entrada es 1.1939 (apertura por trades) y la vela oficial del gráfico abre en 1.1938 (H11) |
| 15 | C | −1.03 | stop | OK | 10 días; ninguna vela pasa 1.07 antes de la salida |
| 16 | L | +2.96 | objetivo | OK | El mínimo más bajo (≈1.052) queda sobre el stop 1.0479 |
| 17 | L | −1.02 | stop | OK | |
| 18 | C | −1.02 | stop | OK | 15 días; el máximo previo (≈1.198) queda bajo el stop 1.2069 |
| 19 | L | +2.96 | objetivo | OK (O-01) | La vela de la salida toca el objetivo y el stop: la hora de salida es 11:04 (minuto a minuto, primero el objetivo). El oráculo A llega a lo mismo con su propio lector de minutos. La línea de la salida tapa la mecha de esa vela |
| 20 | L | −1.02 | stop | OK (O-01) | La cruz está en la vela de las 12:00 UTC; su mecha baja hasta el stop pero la tapa la línea de la salida |
| 21 | C | +2.95 | objetivo | OK | |
| 22 | C | −1.04 | stop | OK | |
| 23 | C | −1.10 | stop | OK | Stop corto (0.0126): la comisión pesa −0.10 R. La vela verde previa queda bajo el stop |
| 24 | C | +2.96 | objetivo | OK | |
| 25 | C | −1.04 | stop | OK (O-01) | Sale en la vela siguiente a la entrada; su mecha la tapa la línea de la salida |
| 26 | C | +2.97 | objetivo | OK | |
| 27 | L | −1.05 | stop | OK | |
| 28 | C | −1.05 | stop | OK | Una mecha temprana parece llegar al stop; con los números del gráfico llega a 0.9125 (stop 0.9169). La de la salida, 07/09 20:00 UTC, llega a 0.9203 |
| 29 | C | +2.95 | objetivo | OK | |
| 30 | C | −1.03 | stop | OK | |
| 31 | L | −1.03 | stop | OK | |
| 32 | C | −1.04 | stop | OK | Sale en la vela siguiente a la entrada |
| 33 | C | −1.03 | stop | OK | |
| 34 | L | +2.96 | objetivo | OK | |
| 35 | L | −1.03 | stop | OK | |
| 36 | C | +2.98 | objetivo | OK | |
| 37 | C | −1.04 | stop | OK | |
| 38 | C | −1.04 | stop | OK | |
| 39 | L | +2.95 | objetivo | OK | |
| 40 | L | −1.03 | stop | OK | |
| 41 | L | −1.02 | stop | OK | Sale en la vela siguiente a la entrada |
| 42 | L | −1.04 | stop | OK | |
| 43 | L | −1.02 | stop | OK | Sale en la vela siguiente a la entrada |
| 44 | C | −1.02 | stop | OK | |
| 45 | L | −1.02 | stop | OK | 6 días; sale en una vela con mecha larga hacia abajo (9/11) |
| 46 | L | −1.02 | stop | OK (O-01) | La vela de la salida es casi un doji; su mecha hasta el stop la tapa la línea de la salida |
| 47 | C | −1.02 | stop | OK | |
| 48 | C | −1.02 | stop | OK | 18 días |
| 49 | L | −1.02 | stop | OK | |
| 50 | C | −1.02 | stop | OK | |
| 51 | L | −1.02 | stop | OK (O-01) | |
| 52 | C | −1.03 | stop | OK (O-01) | |
| 53 | L | +2.97 | objetivo | OK | |
| 54 | L | −1.02 | stop | OK | Último trade de la fase; cerró el 26/12, antes del fin (31/12) |

## Resumen

- **54 de 54 trades revisados con captura: todos cumplen V1, V2, V5, V6, V8, V9, V11 y V12.** V7 (objetivo) se ve solo cuando el precio se acerca: con el objetivo lejos, la escala del gráfico no lo alcanza.
- **O-01 (pantalla, S3):** la línea punteada vertical de la salida se dibuja sobre el centro de la vela de la salida y tapa su mecha. En los trades 14, 19, 20, 25, 46, 51 y 52 eso hace parecer que la cruz cae en una vela que no toca el stop. Los números del gráfico confirman el toque (trade 14: mínimo 1.1325 contra stop 1.1405).
- **H11 visto:** la entrada del trade 14 es 1.1939 (apertura por trades) y la vela oficial del gráfico abre en 1.1938.
