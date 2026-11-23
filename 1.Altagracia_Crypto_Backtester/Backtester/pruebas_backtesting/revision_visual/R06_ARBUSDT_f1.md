# Revisión visual · R06 · ARBUSDT · 4h · fase 1 · Compresión con dos órdenes stop (E-05)

| | R06a | R06b |
|---|---|---|
| Órdenes | a 0.2 ATR por fuera de la caja | a 0.5 ATR del cierre de la vela de la señal |
| Corrida | `ARBUSDT_240_f1_4a2bbb7b6f6cb01f_1795310503` | `ARBUSDT_240_f1_300baba64a9c8ab1_1795310505` |
| Trades | 15 (−0.493 R por trade) | 26 (−0.259 R) |
| Señales | 68: 17 sin llenar, 2 con una posición abierta | 68: 7 con una posición abierta |
| Salidas | 13 stop, 2 objetivo | 21 stop, 5 objetivo |
| Revisión | **15 de 15 bien** | **26 de 26 bien** |

Stop 1.5 ATR y objetivo 3R. Capturas: `evidencia/pantalla/R06a_ARBUSDT_f1/` y `R06b_ARBUSDT_f1/`.

- **Las dos órdenes, recalculadas aparte** (`straddleCheck`, agregado al ayudante): con la zona de cada trade (de la
  corrida guardada) o el cierre de la vela de la señal en el gráfico, la orden de arriba y la de abajo; la primera vela
  de las 8 siguientes que toca una de las dos. En los 41 trades coinciden con el motor el lado, la vela y el precio de
  entrada. Esperaron de 0 a 7 velas (R06a: hasta 7).
- **Las dos tocadas en la misma vela: un caso, R06b trade 2.** La vela del 26/04/23 20:00 UTC toca la de abajo
  (1.3342) y la de arriba (1.387). Con los minutos del almacén, la de abajo se tocó a las 20:01 y la de arriba a las
  21:56: el motor entra en corto, bien.
- **El llenado con minutos** (`minutos_llenado.py`, los 41): en ninguno se tocó el stop o el objetivo después del
  llenado en la misma vela, salvo R06a trade 13, que se llena y toca el stop en el mismo minuto (12/11 02:12 UTC); el
  motor sale ahí, como dice su regla (en el mismo minuto cuenta el stop).
- **O-04:** el detalle de cada trade dice "(mercado)" aunque la entrada fue una orden stop (`order: "stop"`): la
  página rotula todo lo que no es limit como mercado (`RuleTesterApp.jsx:2021`). El precio de entrada no es la
  apertura de la vela (R06a trade 1: 1.46329857…, la orden de arriba). Sale además con ruido de coma flotante, como
  O-02.
- Las dos órdenes van por la regla de las limit para "una posición a la vez" (H15): R06b trade 2 toma la señal de la
  vela en que salió el trade 1.
