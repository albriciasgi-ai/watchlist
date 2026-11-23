# Revisión visual · R05e · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, **limit en el borde cercano de la zona, vence en 8 velas**, stop 1.5 ATR, **sin objetivo**,
**trailing a 2 ATR desde 1R**, **stop a la entrada en 1R** y **cierre a las 48 velas**.
Corrida aislada: `ARBUSDT_240_f1_926ece82eb63df9c_1795307355` · 57 trades (25 largos y 32 cortos) · −0.003 R por
trade (−0.17 R; 21 ganan, 36.8%) · 117 señales: 38 limit sin llenar, 21 con una posición abierta, 1 abierta al final.
Azar −0.033 R y tramo −0.036 R: no se distingue de ninguno. Salidas: 28 en el stop, 21 en el stop arrastrado, 7 en
la entrada y 1 por tiempo. Capturas: `evidencia/pantalla/R05e_ARBUSDT_f1/`.

**Resultado: 57 de 57 bien en precios, llenados y salidas.** Todos con "se cumplía todo".

- **La limit:** en los 57 es el borde cercano del hueco, se llena en la primera vela que cruza el precio dentro de
  las 8, y ninguna vela anterior de la espera lo cruzaba.
- **El trailing, recalculado aparte con las velas del gráfico** (`trailCheck`, agregado al ayudante en esta revisión:
  al cerrar cada vela, el mejor precio desde la entrada menos 2 veces el ATR de esa vela, solo si queda más cerca y la
  vela cerró más allá; desde 1R, el stop a la entrada si la vela cerró a favor; el cierre al completar 48 velas): da
  la misma vela, el mismo motivo y el mismo precio de salida que el motor en los 54 trades que no salen en la vela
  del llenado.
- **Los otros tres (9, 22 y 25) entran y salen en la vela del llenado.** Con los minutos del almacén, el llenado fue
  antes del stop en los tres: 00:46 y 03:36, 18:30 y 18:42, 00:38 y 02:31 UTC; la hora del stop es la del motor.
- **El trailing usa el ATR de cada vela cerrada**, no el de la señal (el objetivo arrastrado sí usa el de la señal).
  Con 2 ATR desde 1R, el primer stop arrastrado puede quedar del lado perdedor de la entrada: el trade 40 sale "en el
  stop arrastrado" con −0.22 R. Es lo que pide la regla (2 ATR es más que el riesgo de 1.5 ATR); el stop a la entrada
  solo se pone si la vela cierra a favor.
- **Trade 29, salida por tiempo:** al cierre de la vela 48 contando la de la entrada (la del 25/08/23 00:00 UTC), en
  0.9603. La hora de la salida es la del cierre de esa vela.
- **H4 en pantalla, trade 2** (largo): la limit 1.362 se llenó a las 19:47 UTC, al fondo de una vela roja grande. Su
  máximo, 1.489 (+1.89 R), fue antes del llenado; desde el llenado llegó a +0.32 R. El motor mide lo "a favor" con la
  vela entera: arrancó el trailing (pide 1R) y el trade salió en el stop arrastrado con +0.19 R. Con la variante h4
  sale en la entrada con −0.02 R. En esta corrida H4 cambia 3 trades (2, 35 y 40): −1.01 R en total, de −0.003 a
  −0.021 R por trade (`medir_h4.py`). Ver DEFECTOS, H4.
- **Ayudante corregido durante la revisión:** la salida por tiempo lleva la hora del cierre de su vela, y el ayudante
  buscaba la vela con esa hora: marcaba el 29 como distinto. Se repitió su comprobación, ya igual.
