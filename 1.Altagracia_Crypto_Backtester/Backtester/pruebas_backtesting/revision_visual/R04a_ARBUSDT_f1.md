# Revisión visual · R04a · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, a mercado, **stop en el último swing de 5 velas** (margen 0.1 ATR, entre 0.1 y 6 ATR), 3R.
Corrida aislada: `ARBUSDT_240_f1_5bd24a27e6eacf3d_1795307342` · 17 trades · −0.542 R por trade · 117 señales, 97 con una
posición abierta (los stops son lejanos: los trades duran días o meses), 2 con el stop "muy largo", 1 abierta al final.
Capturas: `evidencia/pantalla/R04a_ARBUSDT_f1/` (los de más de 60 velas, con `_inicio` y `_fin`).

**Resultado: 17 de 17 cuadran con el motor; 1 muestra la H2.** Todos con "se cumplía todo".

Comprobación del swing con las velas del gráfico (`swingCheck`, reproduce `_stop_price`: el pivote más reciente con sus
5 velas de la derecha cerradas al cierre de la señal y detrás de la entrada, hasta 6 pivotes; si no, el extremo de las
últimas 21 velas):
- **trades 2 a 17:** el stop es el swing que se ve en el gráfico más o menos el margen (stops de 1.7 a 4.9 ATR);
- **trade 1 (H2, arranque en frío de la fase):** la fase 1 de ARB empieza el 23/04/2023 00:00 UTC y la señal es a las
  16:00, la quinta vela. El swing que se ve en el gráfico es el del 21/04 20:00 (1.5043), pero el motor no tiene velas
  antes de la fase: no encuentra pivote detrás de la entrada y usa el extremo de las velas que tiene, 1.4647 (la de las
  00:00 del 23/04), más el margen: stop 1.469928. Su ATR sale de 4 o 5 velas. El usuario ve en el gráfico un stop que
  no es el que usó la regla.

Entradas contra la apertura oficial (H11): diferencias de 0.0001 a 0.0003 en 7 trades.
