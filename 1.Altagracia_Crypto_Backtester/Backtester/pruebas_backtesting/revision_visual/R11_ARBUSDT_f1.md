# Revisión visual · R11 · ARBUSDT · 4h · fase 1 · Salida VPA (E-06, fase 4 del VPA)

Entrada igual que en R08: FVG nuevo ≥ 0.3 ATR, a mercado, stop 1.5 ATR.

| | Salida | Corrida | Trades | R medio | Motivos | Revisión |
|---|---|---|---|---|---|---|
| R11a | VPA con las cinco lecturas, desde la entrada, sin objetivo | `…b53cac9f03d94acd_1795310578` | 83 | +0.025 | 23 stop; VPA: 22 se agota, 11 retroceso, 11 clímax, 8 medidor, 8 esfuerzo en contra | **83 de 83 bien** |
| R11b | 3R y VPA solo por clímax o frenado, armada desde 1R | `…8c72d667f47be542_1795310581` | 56 | −0.013 | 38 stop, 11 objetivo, 7 VPA clímax | **56 de 56 bien** |

Capturas: `evidencia/pantalla/R11a_ARBUSDT_f1/` y `R11b_ARBUSDT_f1/` (139).

- **Los avisos del VPA, rearmados aparte** (`tests/audit/vpa_exit_check.py` y `.mjs`, evidencia en
  `evidencia/capa_a/vpa_exit_*.json`): los oráculos de la capa A reciben del motor el mapa de avisos, así que no lo
  comprueban. Aquí se rearma con el lector del navegador (`vpa.js`, la otra implementación) sobre las mismas velas del
  motor y con lo que pide la documentación: clímax o frenado contra el lado del trade, esfuerzo sin resultado contra
  el color (contra el tramo en un doji), vela validada del color contrario, medidor en contra a `thr` o más, y el
  esfuerzo que se agota en un tramo del lado del trade, con el grado `fire` y en ese orden si caen en la misma vela.
  - R11a: 197 avisos a los largos y 195 a los cortos, **todos iguales** al motor, vela por vela y con el mismo motivo.
  - R11b: 18 y 15, todos iguales.
  - Con el medidor contado también en las velas que el lector aún no lee (los primeros 5 días) da lo mismo.
- **Cada trade con ese mapa:** stop u objetivo dentro de la vela primero; si no, al cierre el aviso, si el trade ya
  llegó a `fromR` a favor; sale en la apertura siguiente. Los 139 trades salen en la misma vela y por el mismo motivo
  que el motor (R11b tiene una vela dudosa, la del 14/07/23 16:00 UTC: los minutos dan el objetivo a las 16:04 y el
  stop a las 18:31; el motor sale por objetivo a las 16:04, `minutos_salida2.py`).
- **En pantalla** (`exitCheck` con la salida VPA, agregada al ayudante): con las velas del gráfico y el mapa de
  `vpa.js`, los 139 trades dan «salida igual». Las diferencias de precio de 0.006% a 0.041% (R11a #40 y R11b #27, la
  misma salida) son las de H11: la apertura oficial contra la del almacén.
- **Armada desde 1R (R11b):** un aviso antes de llegar a 1R no saca el trade. Se ve en R11b #35 (el trade #50 de
  R11a): en R11a sale por clímax a la apertura del 18/09/23 00:00 UTC; en R11b no había llegado a 1R y sale por stop.
- **Sin cierre a las 96 velas** con la salida VPA, como dice la documentación: ninguna salida por tiempo en las dos, y
  en R11b el trade #50 dura 106 velas y sale por stop.
- En el gráfico, la salida dice «Salida por el VPA (esfuerzo que se agota) · +0.53 R» y va en el borde de la vela.
- Una abierta al final de la fase en cada una (no cuenta, H6).
