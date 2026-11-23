# Revisión visual · R05d · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, **invertida** (opera en contra del hueco), **limit en el borde cercano de la zona, vence en 8
velas**, stop 1.5 ATR, 3R.
Corrida aislada: `ARBUSDT_240_f1_0664e60ef4f3509c_1795307354` · 48 trades (24 largos y 24 cortos) · −0.115 R por trade
(−5.5 R; 11 ganan, 22.9%) · 117 señales: 68 con una posición abierta, 1 abierta al final, ninguna limit sin llenar.
Azar −0.042 R y tramo −0.073 R: no se distingue de ninguno. Capturas: `evidencia/pantalla/R05d_ARBUSDT_f1/`.

**Resultado: 48 de 48 bien en precios y salidas.** Todos con "se cumplía todo".

- **La inversión:** en los 48, la vela de la señal tiene un FVG **contrario** al trade en las velas del gráfico
  (bajista en los largos, alcista en los cortos).
- **Ninguna limit:** los 48 entran "(mercado)" en la apertura de la vela siguiente a la señal, con comisión taker. Al
  invertir, la zona del FVG queda del lado contrario al trade (el hueco bajista está sobre el precio y el trade es un
  largo), así que la limit nunca espera. Con `medir_invertida_limit.py`, el borde cercano, la mitad y el borde lejano
  dan los mismos 48 trades. La pantalla dice "Entrada: limit en el borde cercano de la zona, vence en 8 velas" y no
  avisa. Ver DEFECTOS, **H14**.
- **Pero no da lo mismo que la regla invertida a mercado:** esa da 41 trades (en BTC, 299 contra 278). La diferencia
  está en cómo se cuenta "una posición a la vez" (DEFECTOS, **H15**): con limit, una señal de la vela en que salió el
  trade anterior se toma; a mercado se salta. Con el motor cargado en memoria con la regla de las limit también para
  mercado (`medir_ocupada.py`, la app sin tocar), la invertida a mercado da los mismos 48 trades, trade por trade, y
  en BTC los mismos 299.
- Ninguna vela antes de la salida toca el stop o el objetivo, y la vela de la salida toca el suyo: 37 stops y 11
  objetivos.
- **Una vela dudosa, trade 43** (corto): la vela del 04/12/23 08:00 UTC va de 1.1519 a 1.0054 (una caída brusca) y toca
  el stop 1.137664 y el objetivo 1.029407. Con los minutos del almacén, el stop se tocó a las 08:19 y el objetivo a las
  11:12: sale en el stop, como dice el motor. El recorrido supuesto daría lo mismo (el máximo está más cerca de la
  apertura).
- Entradas contra la apertura oficial (H11): 27 de 48 con diferencias de 0.0001 a 0.0003.
