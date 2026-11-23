# Revisión visual · R02x · SUIUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, a mercado, **stop 0.5 ATR y objetivo 1R** (velas dudosas a propósito). SUI no tiene almacén:
corre sobre las velas del caché de App 1, las mismas del gráfico, y una vela dudosa sigue su recorrido supuesto
(apertura, el extremo más cerca de la apertura, el otro extremo y cierre).
Corrida aislada: `SUIUSDT_240_f1_c8183a9dee2ca0e5_1795305708` · 04/06/2023–31/12/2023 · 84 trades · +0.043 R por trade
(+3.61 R; 47 ganan) · 92 señales, 8 con una posición abierta, ninguna abierta al final.
Capturas: `evidencia/pantalla/R02x_SUIUSDT_f1/`.

**Resultado: 84 de 84 bien.** Todos con "se cumplía todo" en la tabla de la señal.

| Cómo salió | Objetivo | Stop |
|---|---|---|
| En la vela de la entrada | 28 | 25 |
| En la vela siguiente | 10 | 8 |
| Dos velas o más después | 9 | 4 |

**Comprobación automática con las velas del gráfico** (desde este trade, en cada captura): en los 84 la entrada es la
apertura de su vela, ninguna vela antes de la salida toca un nivel y la vela de la salida toca el suyo.

**Velas dudosas (las dos tocadas en la misma vela): 14**, todas resueltas como manda el recorrido supuesto:
- al stop, porque el extremo del lado del stop está más cerca de la apertura: 5, 8, 29, 46, 63 y 74;
- al objetivo: 17, 19, 37, 43, 49, 73, 76 y 83.

Ejemplo, trade 5 (largo): vela del 12/06 16:00 UTC, apertura 0.66528, máximo 0.68782 y mínimo 0.64374; el mínimo está
a 0.02154 y el máximo a 0.02254, así que primero el stop 0.64941.

**Capa B:** el texto de los 84 trades es igual a la corrida guardada, y repetida desde cero da los mismos 84.
**Capa A:** el oráculo da los mismos 84 trades y las mismas 6,084 simulaciones (regla y 6,000 controles).

**Ayudante corregido durante la revisión:** las capturas del 49 y el 53 salieron primero con el encuadre del trade
anterior: la ventana vuelve a enfocar el trade cuando le llega su contexto, después del encuadre del ayudante. Ahora el
ayudante comprueba el rango dibujado antes de copiar; las dos capturas se repitieron. No es un defecto de la app: con un
clic del usuario la ventana termina en su propio enfoque.
