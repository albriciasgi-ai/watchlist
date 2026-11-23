# Revisión visual · R03 · DOGEUSDT · 4h · fase 1 · Una moneda nueva, sin minutos (E-08)

Regla: la de R01 (FVG nuevo de 0.3 ATR o más, a mercado, stop de 1.5 ATR y objetivo de 3R, una posición a la vez).
DOGE es una de las 43 monedas nuevas: sus velas salen de `OrderFlowData/candles` (no del caché de App 1) y no tiene
almacén de trades, así que una vela dudosa sigue su recorrido supuesto. El gráfico lee esas velas del disco
(`/api/tester/chart-candles`), un camino distinto del de las monedas de siempre.

| Corrida | Trades | R medio | Motivos | Lados | Revisión |
|---|---|---|---|---|---|
| `DOGEUSDT_240_f1_96202ed43a72e1d7_1795319591` | 139 | −0.019 | 35 objetivo, 104 stop | 74 largos, 65 cortos | **139 de 139 bien** |

Una señal más quedó abierta al final de la fase (no cuenta, H6).

- **Capa A** (lote 1): las 6,140 llamadas (140 de la regla y 6,000 de los dos controles) iguales al oráculo A; la
  selección de "una posición a la vez" da los mismos 139. El oráculo B se agrega en el lote 6.
- **Capa B** (`comparar_capa_b.py`): lo que la pantalla dijo de los 139 trades es igual a la corrida guardada, y la
  regla corrida otra vez desde cero da los mismos 139.
- **Capa C:** una captura por trade (y la del inicio y la del final en los largos) en `evidencia/pantalla/R03_DOGEUSDT_f1/`,
  con las hojas de contactos `hoja_0001_0048.jpg`, `hoja_0049_0096.jpg` y `hoja_0097_0139.jpg`, revisadas a la vista.
  La comprobación de cada captura (la entrada en la apertura, el FVG en la vela de la señal, la salida recalculada con
  las velas del gráfico, su motivo y su precio) dio «ok» en los 139. Ninguno salió por un hueco de datos, y ninguno en
  una vela dudosa: una salida resuelta por el recorrido supuesto lleva la hora de la vela más 1 a 3 ms (O-03), y no hay
  ninguna. 9 trades salen en la misma vela de la entrada. La vela dudosa sin minutos (E-08) se probó con R02x en SUI:
  14 velas resueltas por el recorrido supuesto, todas bien.
- **F-02 en esta moneda:** a las velas de las monedas nuevas les falta una cada 1,000 (etapa 1). En 4h un hueco de una
  vela son 8 horas, que no pasan del límite del motor para cerrar un trade (el mayor entre 6 horas y dos velas), así que
  ningún trade se cortó; lo que pasó en esa vela no se ve. El motor y el gráfico leen el mismo archivo, por eso la
  comprobación no lo detecta: lo mide la etapa 1 contra Bybit.
