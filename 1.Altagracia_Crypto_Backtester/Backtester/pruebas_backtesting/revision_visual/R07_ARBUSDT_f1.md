# Revisión visual · R07 · ARBUSDT · 4h · fase 1 · Los sabios con orden stop (E-04)

| | R07a | R07b | R07c |
|---|---|---|---|
| Regla | la del usuario (barra divergente → AO tres barras + ruptura de fractal, en 10 velas, cierre del lado de los dientes; stop 2 ATR; 2.2R arrastrado desde 1.5R a 0.5R), **con orden stop** en vez de a mercado | barra divergente sola; orden stop a 0.1 ATR del borde de la barra, 3 velas, se cancela si pasa el otro borde; stop en el otro borde; 3R | ruptura de fractal sola; orden stop en el fractal; stop 1.5 ATR; 3R |
| Corrida | `…b5a91609149e8c23_1795310507` | `…976181f30a89ecf4_1795310510` | `…89f3beb737f16d71_1795310549` |
| Trades | 1 (+0.98 R) | 53 (−0.138 R) | 61 (−0.250 R) |
| Señales | 6: 5 las quitó el filtro del Alligator | 152: 62 órdenes sin llenar, 36 con una posición abierta | 190: 128 con una posición abierta |
| Revisión | **1 de 1 bien** | **53 de 53 bien** | **61 de 61 bien** |

Capturas: `evidencia/pantalla/R07a_ARBUSDT_f1/`, `R07b_…/` y `R07c_…/`. La regla del usuario (89 corridas en su registro)
siempre corrió a mercado: la orden stop no la había usado.

- **La orden, recalculada aparte** (`stopOrderCheck`, agregado al ayudante): en el borde de la zona a favor más el
  margen, con la cancelación en el otro borde; la primera vela que la toca y ninguna cancelación antes. En los 115
  trades coinciden la vela y el precio de entrada.
- **R07b:** la orden va en el máximo de la barra divergente más 0.1 ATR (en el mínimo en los cortos) y el stop en el
  otro extremo de la barra, que es también donde se cancela. El stop queda de 0.64 a 2.84 ATR.
- **R07c, la espera propia del 3.er sabio:** la zona del fractal es un solo precio (sin cancelación) y la orden espera
  lo que dice el elemento, no las 5 velas de la regla: 12 de los 61 trades se llenaron después de la vela 5, hasta 14
  velas de espera (trade 44). Que esa espera sea la correcta (hasta que el precio pasa el fractal o llega otro) se
  revisa con el elemento en la etapa 4.
- **R07a:** la fila del filtro dice "despierto al alza" en un corto con el cierre bajo los dientes. Es correcto: en esa
  vela las líneas desplazadas del Alligator están en orden alcista (labios 1.137 > dientes 1.126 > mandíbula 1.117, por
  la subida anterior), y el filtro "del lado de los dientes" solo mira el cierre.
- **Llenados con minutos** (`minutos_llenado.py`, los 115): ninguno distinto; R07c trade 25 se llena a las 12:45 UTC y
  toca el stop a las 13:53 en la misma vela, como el motor.
- **O-04:** el detalle de los 115 dice "(mercado)" aunque la entrada fue una orden stop.
- **H15, la otra cara:** con orden stop (como con limit) la orden de una señal que llega con una posición abierta
  queda puesta y se llena si el precio llega después de la salida. R07c trade 30: su señal llegó con el trade 29
  abierto y la orden se llenó después de que el 29 salió; también los trades 40 y 61. A mercado esas señales se
  descartan.
