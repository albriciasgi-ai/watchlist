# Revisión visual · R09 · ARBUSDT · 4h · fase 1 · Objetivo arrastrado (E-06)

Entrada igual que en R08: FVG nuevo ≥ 0.3 ATR, a mercado, stop 1.5 ATR. Objetivo de 3R que se arrastra.

| | Arrastre | Corrida | Trades | R medio | Motivos | Se activa | Revisión |
|---|---|---|---|---|---|---|---|
| R09a | desde 2.5R, a 0.5R | `…e6c9138dcc068f58_1795310568` | 60 | +0.066 | 42 stop, 18 arrastrado | 18 (12 salen en esa misma vela) | **60 de 60 bien** |
| R09b | desde 2.5R, a 1.5 ATR | `…0c8bfe385b6bc3ef_1795310570` | 58 | +0.054 | 40 stop, 18 arrastrado | 18 (7) | **58 de 58 bien** |
| R09c | desde 2R, a 1% del mejor precio | `…b3cbf52c79216af2_1795310574` | 68 | +0.094 | 44 stop, 24 arrastrado | 24 (22) | **68 de 68 bien** |

Capturas: `evidencia/pantalla/R09a_ARBUSDT_f1/` a `R09c_ARBUSDT_f1/` (186).

- **Exacto, minuto a minuto (capa A en ARB, `evidencia/capa_a/lote5_r09_arb.log`):** el oráculo A repite el motor en
  las 18,189 llamadas de las tres reglas: la regla, sus 3,000 entradas al azar y las 3,000 del tramo, que usan la
  misma salida. Coinciden en todos los campos, también el minuto y el precio de la salida por objetivo arrastrado.
  - El oráculo B coincide en todo menos en lo máximo a favor (`mfe`) de las salidas por objetivo arrastrado (1,494,
    1,029 y 1,881 llamadas). El B no cuenta el mejor precio dentro de la vela de la salida (lo marcó AMBIGUO: la
    especificación no lo dice). El motor y el A sí lo cuentan, hasta el minuto de la salida: en R09a, el trade del
    26/04/23 sale en 4.01R con lo máximo a favor en 4.525R, que es el mejor precio menos el arrastre de 0.5R.
  - No cambia ningún resultado: queda como un punto a precisar en la especificación, no como defecto del motor.
- **En pantalla, comprobación gruesa con las velas de 4h** (`tpCheck`, agregado al ayudante):
  - la vela en que el precio llega al arranque (2.5R o 2R);
  - que la salida esté entre el nivel con el mejor precio en el arranque y el nivel con el mejor extremo de las velas
    hasta la salida;
  - que la vela de la salida toque ese precio, y que el stop no se toque antes.

  En los 60 trades que salen por objetivo arrastrado se cumple. En los 126 que salen por stop, el precio nunca llegó
  al arranque.
- **El objetivo fijo no cierra el trade:** 12 trades siguieron más allá del 3R (en R09a, uno salió en +4.01R y otro
  en +3.57R), como pide el usuario («arrastre el take profit hasta que se devuelva»).
- **El arrastre corto sale casi siempre en la vela en que se activa** (R09a: 12 de 18; R09c: 22 de 24), como se midió
  el 20/11 en BTC: en 4h el precio se devuelve más que 0.5R o 1% dentro de una vela.
- En la pantalla, la línea «Se activa el trailing · 2.5R» (o «no llegó») y el objetivo arrastrado en escalones verdes
  se ven en los trades que lo activan.
- Una abierta al final de la fase en cada una (no cuenta, H6).
