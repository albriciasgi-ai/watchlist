# Revisión visual · R02x · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, a mercado, **stop 0.5 ATR y objetivo 1R**. Está hecha para que el stop y el objetivo caigan
en la misma vela, así se prueba la resolución de las velas dudosas. ARB tiene almacén: una vela dudosa se mira minuto a
minuto.
Corrida aislada: `ARBUSDT_240_f1_06704c1ccd50d290_1795305707` · 24/04/2023–31/12/2023 · 104 trades · −0.022 R por trade
(−2.28 R en total; 56 ganan) · 117 señales, 13 con una posición abierta, ninguna abierta al final.
Capturas: `evidencia/pantalla/R02x_ARBUSDT_f1/` (una por trade, con el texto del detalle en el `.json`).

**Resultado: 104 de 104 bien.** Todos con "se cumplía todo" en la tabla de la señal.

| Cómo salió | Objetivo | Stop |
|---|---|---|
| En la vela de la entrada | 40 (4 por minuto) | 32 (3 por minuto) |
| En la vela siguiente | 11 (1 por minuto) | 11 |
| Dos velas o más después | 5 (1 por minuto) | 5 (1 por minuto) |

**Capa B:** el texto de la pantalla de los 104 trades es igual a la corrida guardada, y la regla corrida otra vez desde
cero da los mismos 104 trades.

## Lo revisado con las velas del gráfico

Cuando la mecha que toca el nivel no se ve en la captura, se leyeron las velas del gráfico (`__audit.bars`):

| Trade | Vela (UTC) | Nivel | Lo que muestra la vela | Veredicto |
|---|---|---|---|---|
| 50 | 14/08 04:00 y 08:00 | stop 1.146214 | la de la entrada llega a 1.1462, **justo debajo**; la siguiente a 1.147 | OK: sale en la siguiente |
| 52 | 17/08 04:00 | stop 1.066125 | máximo 1.0668 | OK (O-01) |
| 57 | 31/08 20:00 | objetivo 0.910304 | mínimo 0.9022 | OK (O-01) |
| 58 | 01/09 20:00 | stop 0.889121 | máximo 0.8935 | OK (O-01) |
| 68 | 28/09 20:00 | stop 0.882996 | mínimo 0.8802 | OK (O-01) |
| 70 | 02/10 04:00 | stop 0.953611 | mínimo 0.9452; el objetivo 0.974189 no llega (máx. 0.9706) | OK (O-01) |
| 71 | 02/10 20:00 | objetivo 0.920779 | mínimo 0.9154 | OK (O-01) |
| 75 | 17/10 20:00 a 18/10 04:00 | stop 0.793357 | toca en la tercera vela (máx. 0.7977); el objetivo 0.778643 quedó a 0.00006 del mínimo 0.7787 | OK |
| 76 | 20/10 08:00 | objetivo 0.800554 | máximo 0.8107 | OK (O-01) |
| 86 | 10/11 04:00 y 08:00 | stop 1.1683 | la de la entrada baja a 1.1716; la siguiente a 1.1495 | OK |
| 88 | 15/11 16:00 a 16/11 00:00 | objetivo 1.157525 | toca en la tercera vela (máx. 1.1644) | OK |
| 89, 91, 92 | 16/11, 26/11 y 01/12 | objetivo, stop, objetivo | máx. o mín. pasan el nivel | OK (O-01) |
| 96 | 12/12 12:00 | stop 1.136439 y objetivo 1.182161 | vela dudosa: mínimo 1.1364 (pasa el stop por 0.00004) y máximo 1.1849; el minuto a minuto da el objetivo a las 13:07 UTC | OK |
| 100 | 22/12 12:00 | stop 1.314814 y objetivo 1.355386 | vela dudosa (1.3082 a 1.3896); el minuto a minuto da el stop a las 12:13 UTC | OK |
| 104 | 31/12 16:00 y 20:00 | stop 1.552368 | la de la entrada baja a 1.5632; la siguiente, la última de la fase, a 1.5126 | OK |

Las diez salidas minuto a minuto (trades 19, 37, 51, 53, 65, 74, 96, 98, 100 y 102) caen en velas que tocan los dos
niveles. La pantalla no deja ver el orden dentro de la vela: lo comprueba la capa A con su propio lector de minutos.

**Entrada contra la apertura de la vela oficial (H11):** la entrada es la apertura de la vela armada con los trades (el
primer trade), y el gráfico muestra la vela oficial de Bybit, que abre en el cierre anterior. En 11 de los trades
mirados difieren 0.0001 a 0.0004 (el 96: 1.1593 contra 1.1589). No cambia ninguna salida.

Las pérdidas en el stop van de −1.05 a −1.30 R: con un riesgo de 0.5 ATR, las comisiones de entrada y salida pesan
0.05 a 0.30 R (el 50: riesgo 0.0042 y comisiones 0.0013, −1.30 R).
