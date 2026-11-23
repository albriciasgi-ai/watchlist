# Revisión visual · R14 · ARBUSDT · fase 1 · Operación (E-09): todas las señales, enfriamiento y las dos limits del rango

| | Regla | Corrida | Trades | R medio | Motivos | Revisión |
|---|---|---|---|---|---|---|
| R14a | 4h · FVG nuevo ≥ 0.3 ATR, stop 1.5 ATR, 3R, **todas las señales** (varias posiciones a la vez) | `ARBUSDT_240_f1_d1426568d06e2a31_1795310596` | 114 | +0.160 | 34 objetivo, 80 stop | **114 de 114 bien** |
| R14b | la misma, **una a la vez con enfriamiento de 8 velas** | `ARBUSDT_240_f1_41371ad0cb7ff5bd_1795310598` | 40 | −0.334 | 7 objetivo, 33 stop | **40 de 40 bien en pantalla; F-01** |
| R14c | 15m · extremo del valor (VE) **con la orden esperando** en los dos bordes, solo tras perfil D, al centro del rango anterior | `ARBUSDT_15_f1_8d7a980a230deaa9_1795310632` | 49 | −0.046 | 30 objetivo, 19 stop | **49 de 49 bien** |

Capturas: `evidencia/pantalla/R14a_ARBUSDT_f1/` a `R14c_ARBUSDT_f1/`, con sus hojas de contactos. La comprobación de
cada captura dio «ok» en los 203.

## Todas las señales (R14a)

117 señales: 114 trades y 3 abiertas al final de la fase; ninguna descartada. 54 trades entran con otro abierto; en
las capturas las cajas se superponen.

## Enfriamiento (R14b)

Cada trade de R14b es una señal de R14a con la misma salida y el mismo R (40 de 40), así que la selección se puede
repetir aparte: recorrer las señales de R14a en orden y tomar una solo si la anterior ya salió y pasaron 8 velas.

- Con "la vela de la salida + 1 + 8" (lo de H15 más el enfriamiento), la repetición da los 40 trades de la corrida
  **solo si el enfriamiento ya está activo al empezar la fase**. Sin eso, el primer trade sería la señal del 23/04/23
  16:00 y no la del 26/04/23 00:00.
- El contexto del trade 1 lo confirma: las señales del 23/04/23 16:00 y 20:00 (velas 4 y 5 de la fase) salen
  "enfriamiento", sin ningún trade cerrado antes. **F-01** en DEFECTOS: el motor arranca cada fase como si un trade
  hubiera salido justo antes, y quita las señales de las primeras 8 velas.
- Embudo: 117 señales; 37 con posición abierta, 39 enfriamiento, 1 abierta al final, 40 trades.

## Las dos limits del rango (R14c)

`tests/audit/vp_check.py` (`evidencia/capa_a/vp_check_formas.log`):

- **Forma del perfil:** escrita desde la documentación (B por dos picos con valle, si no P, b o D por las colas), da
  la misma forma que el motor en los 832 trades de R13a, R13b, R13e y R14c. AMBIGUO en la especificación (se eligió y
  coincide): el suavizado es la media centrada de 3 franjas, el pico mayor se toma del perfil suavizado y "a 15% del
  rango" es la distancia entre los dos picos.
- **Señales:** al cerrar cada sesión que cerró dentro de su valor y con perfil D, una compra en el VAL y una venta en
  el VAH: 78 recalculadas contra 78 de la corrida.
- **Cada trade:** zona (del borde al mínimo o máximo de la sesión anterior), stop (más 0.1 ATR), objetivo (centro del
  rango de la sesión anterior) y entrada (el borde) iguales en los 49.
- **Llenados con minutos** (`minutos_llenado.py`): en 47 de 49 el motor sale en la vela y por el nivel que dicen los
  minutos. En #6 y #41 el objetivo se tocó en la misma vela del llenado (17:21 y 16:38) y el motor no lo mira en esa
  vela: sale después al mismo precio (17:30 y una hora más tarde). Es el punto de diseño ya medido en la capa A
  (variante "objetivo en la vela del llenado"); aquí no cambió el R, pero el trade quedó abierto de más.
