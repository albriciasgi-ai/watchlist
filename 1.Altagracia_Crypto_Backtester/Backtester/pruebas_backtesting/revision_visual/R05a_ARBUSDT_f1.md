# Revisión visual · R05a · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, **limit en el borde cercano de la zona, vence en 8 velas**, stop 1.5 ATR, 3R.
Corrida aislada: `ARBUSDT_240_f1_8b0d176198760b8c_1795307349` · 48 trades · −0.272 R · 117 señales: 38 limit sin
llenar, 30 con una posición abierta, 1 abierta al final. Capturas: `evidencia/pantalla/R05a_ARBUSDT_f1/`.

**Resultado: 48 de 48 bien.** Todos con "se cumplía todo". Comprobado en cada trade con las velas del gráfico:
- el precio de la limit es el borde cercano del hueco del FVG (largo: el mínimo de la vela de la señal; corto: su
  máximo);
- se llena en la primera vela que **cruza** el precio (pasa más allá, no basta tocarlo) y ninguna vela anterior de la
  espera lo cruzaba;
- todas dentro de las 8 velas (el 5 y el 42 se llenaron en la octava);
- el stop sale de la limit: entrada ∓ 1.5 ATR de la vela de la señal.
- Los trades 17 y 20 salen en la misma vela del llenado, minuto a minuto y después del minuto del llenado.

Entrada y salida limit: comisión maker al entrar (las pérdidas quedan en −1.01 a −1.03 R).
