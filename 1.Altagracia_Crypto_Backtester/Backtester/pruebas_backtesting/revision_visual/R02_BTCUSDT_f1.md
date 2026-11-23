# Revisión visual · R02 · BTCUSDT · 15m · fase 1 · R01 en 15 minutos, con minutos (E-08)

Regla: la de R01 (FVG nuevo de 0.3 ATR o más, a mercado, stop de 1.5 ATR y objetivo de 3R, una posición a la vez), en
velas de 15 minutos. BTC tiene almacén de trades: las velas dudosas se resuelven minuto a minuto.

| Corrida | Trades | R medio | Motivos | Lados | Revisión |
|---|---|---|---|---|---|
| `BTCUSDT_15_f1_043c5490620d22eb_1795319610` | 4,610 | −0.175 | 1,245 objetivo, 3,365 stop | 2,391 largos, 2,219 cortos | **4,610 de 4,610 bien** |

Una señal más quedó abierta al final de la fase (no cuenta, H6). 261 trades salen en la misma vela de la entrada.

- **Capa A** (lote 6, `capa_a/R02_BTCUSDT_f1.json`): las 10,611 llamadas (4,611 de la regla y 6,000 de los dos
  controles) iguales a los oráculos A y B, sin ninguna diferencia; la selección de "una posición a la vez" da los mismos
  4,610.
- **Capa B** (`capa_b_R02_BTCUSDT_f1.log`): lo que la pantalla dijo de los 4,610 trades es igual a la corrida guardada,
  y la regla corrida otra vez desde cero da los mismos 4,610.
- **Capa C:** una captura por trade (y la del inicio y la del final en los largos: 5,310 imágenes) en
  `evidencia/pantalla/R02_BTCUSDT_f1/`, con el gráfico en 15M. La comprobación de cada captura (la entrada en la
  apertura, el FVG en la vela de la señal, la salida recalculada con las velas del gráfico, su motivo y su precio, y la
  tabla de la vela de la señal en ✓) dio bien en los 4,610. Los trades 1375, 1394 y 1756 quedaron primero sin la tabla
  de la señal (el contexto del backend tardó tras un reinicio y tras otra corrida que lo desplazó) y se capturaron de
  nuevo, bien.
- **Hojas de contactos:** 193 hojas de 24 trades (`hoja_*.jpg`), revisadas por cinco agentes: ningún error grueso (sin
  cuadro de la señal o con ✗, franja de la señal fuera de lugar, lado invertido, cruz de salida fuera de la caja,
  gráfico vacío o en otro marco). Las dudas que dejaron son de tamaño: algunos cuadros que no se distinguen y escalas
  estiradas por una vela grande real (#725, #726); la tabla de esos trades ya está comprobada en texto.
- **H11:** del 22/10 al 05/12/2021 al archivo de trades de BTC le faltan trades (1.48% del volumen). El motor arma sus
  velas con el almacén y el gráfico muestra las oficiales; en ese tramo una vela del motor puede no llegar a un extremo
  que la oficial sí toca. En R02 la comprobación de cada trade no marcó ninguno (en las corridas de 4h hubo uno, el
  corto del 10/11/2021, con el mismo R).
