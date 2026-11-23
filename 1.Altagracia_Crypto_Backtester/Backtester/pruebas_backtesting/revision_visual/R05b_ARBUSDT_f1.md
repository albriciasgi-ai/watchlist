# Revisión visual · R05b · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, **limit en la mitad de la zona**, vence en 8 velas, stop 1.5 ATR, 3R.
Corrida aislada: `ARBUSDT_240_f1_3cea930800af0972_1795307350` · 40 trades · −0.222 R · 48 limit sin llenar, 28 con una
posición abierta, 1 abierta al final. Capturas: `evidencia/pantalla/R05b_ARBUSDT_f1/`.

**Resultado: 40 de 40 bien en precios, llenados y salidas** (mismas comprobaciones que R05a, con la mitad del hueco).

Hallado en esta corrida:
- **H4 con un caso concreto (trade 2):** la limit 1.40935 se llenó a las 19:35 UTC, al final de la vela de las 16:00; el
  máximo de la vela, 1.489, fue antes del llenado. El motor da "A favor" (mfe) **1.134 R**; desde el llenado el máximo
  fue **0.172 R**. "Alcance" da 0, porque empieza en la vela siguiente. Ver DEFECTOS, H4.
- **Trade 16:** la vela del llenado (14/07 16:00 UTC) pasa el objetivo, pero el trade sale después. Correcto: la limit se
  llenó a las 18:31 y el máximo de 1.3352 fue antes; después la vela solo llegó a 1.1963. (La comprobación automática lo
  marcaba; se ajustó para la vela del llenado.)
- **O-02:** la entrada sale con ruido de coma flotante en 6 de los 40 detalles ("1.4093499999999999").
