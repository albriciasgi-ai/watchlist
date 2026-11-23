# Revisión visual · R04b · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, a mercado, **stop en el extremo de la vela del elemento** (margen 0.1 ATR), 3R.
Corrida aislada: `ARBUSDT_240_f1_7901f5b2c61cc5f0_1795307343` · 77 trades · +0.14 R por trade · 117 señales, 39 con una
posición abierta, 1 abierta al final. Capturas: `evidencia/pantalla/R04b_ARBUSDT_f1/`.

**Resultado: 77 de 77 bien.** Todos con "se cumplía todo".

- **Origen del stop** (`stopSourceCheck`): en los 77, el stop es el extremo de **la vela de la señal** (la tercera vela
  del FVG, la que completa el hueco) más o menos el margen. Nunca las dos velas anteriores del patrón: para el motor, la
  "vela del elemento" de un FVG es solo la que lo da a conocer (`ctx["i0"]` = la vela del voto). Queda como pregunta de
  diseño para el usuario: ¿la vela del elemento de un FVG debería ser la primera del patrón?
- Con esa vela el stop queda muy cerca: de 0.13 a 3.4 ATR, mediana cerca de 0.5. Con comisiones, las pérdidas llegan a
  −1.38 R (trade 34: stop a 0.216 ATR).
- **El FVG** (`fvgCheck`): en los 77 hay un hueco en la dirección del trade entre la vela de la señal y dos antes, en
  las velas del gráfico.
- Dos velas dudosas resueltas minuto a minuto, las dos al objetivo: 21 (20:03) y 70 (03:18).
- Entradas contra la apertura oficial (H11): diferencias de 0.0001 a 0.0004 en la mitad de los trades.
