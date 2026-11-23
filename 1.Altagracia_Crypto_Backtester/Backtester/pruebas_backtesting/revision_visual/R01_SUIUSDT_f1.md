# Revisión visual · R01 · SUIUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, a mercado, stop 1.5 ATR, 3R. SUI no tiene almacén: corre sobre las velas del caché de App 1
(las mismas del gráfico) y una vela dudosa se resuelve con el recorrido supuesto.
Corrida aislada: `SUIUSDT_240_f1_bacb7aa3a3d52f71_1795305654` · 04/06/2023–31/12/2023 · 38 trades · +0.45 R · 92 señales,
53 con una posición abierta, **1 abierta al final de la fase** (no cuenta: H6).
Capturas: `evidencia/pantalla/R01_SUIUSDT_f1/` (los trades de más de 60 velas tienen además `_inicio` y `_fin`).

**Resultado: 38 de 38 bien.** Todos con "se cumplía todo" en la tabla de la señal.

**Capa B:** el texto de la pantalla de los 38 trades es igual a la corrida guardada, y la regla corrida otra vez desde
cero da los mismos 38 trades. **Capa A:** el oráculo da los mismos 38 trades y las mismas 6,039 simulaciones (regla y
controles), sin diferencias.

| Trades | Veredicto | Notas |
|---|---|---|
| 1–4, 6–25, 27–31, 34, 36, 37 | OK | El 1 sale en el objetivo en la vela siguiente a la entrada; el 5, 14 y 18 duran 12 a 30 días (capturas completas, de inicio y de fin) |
| 5 | OK | Al principio el encuadre dejaba fuera la entrada y la salida: era el ayudante (la función "ir al trade" fuerza velas de 6 px; 180 velas no entran). Corregido el ayudante; la captura completa y la del fin muestran la salida en el objetivo 0.6073 |
| 26, 32, 33 | OK (O-01) | La cruz cae en una vela cuya mecha llega al stop, tapada por la línea de la salida |
| 35 | OK (O-01) | **El caso más claro de O-01:** la vela del 11/12/2023 00:00 UTC tiene mínimo **0.591** (stop 0.6314); a la vista parece una vela roja de 0.693 a 0.663 y que el stop llega dos velas después |
| 38 | OK (O-01) | La vela del 26/12 16:00 UTC es verde (0.8297 → 0.8688) pero su mínimo es 0.7716 (stop 0.7725) |

La misma línea punteada tapa también la mecha de la vela de la **entrada** (visto en el trade 22).
