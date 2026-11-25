# Estudio del pump (24/11/2026)

Pedido del usuario: probar en App 1 lo que el scanner muestra como moneda «en juego», pensado como una estrategia de pump
(algo de impulso), para poder refinarlo. Sus condiciones:

- el volumen se compara además con el de las últimas N velas o de los últimos días;
- las monedas demasiado pequeñas no sirven: buscar las que permitan trades de unos 10,000 USDT;
- empezar por el estudio.

Este plan se fijó **antes de correr nada**. Lo que salga se anota al final, sin cambiar lo de arriba.

## Cómo detecta hoy el scanner, y en qué se diferencia el estudio

El scanner (`12.AltagraciaTradingSuite/server/scanner.py`, lista «En juego») pide:

- turnover de 24 h de 5 M USD o más, y libro suficiente para 1,000 USDT (20 bps de ida y vuelta);
- volumen relativo de 24 h de 1.5 o más, **o** de la última hora de 3 o más. El volumen relativo compara con la mediana
  de la misma ventana a la misma hora en los 30 días anteriores del mismo tipo (entre semana o fin de semana);
- **no pide que el precio se haya movido.** El lado sale del movimiento de 24 h descontado el de BTC.

El estudio usa la misma medida de volumen, y suma lo que el scanner no pide:

- el volumen contra las últimas N velas, como pidió el usuario;
- un avance del precio (el pump en sí);
- la liquidez para 10,000 USDT.

La regla del scanner tal cual va como un brazo más, para saber qué vale por sí sola.

## Datos

- **Universo:** todos los perpetuos USDT de Bybit de los grupos cripto e innovación, **también los cerrados** (837 el
  24/11/2026: 516 en operación y 321 cerrados). Sin las cerradas el resultado sale inflado.
- **Velas de 1 hora** de Bybit desde que lista cada moneda, en `OrderFlowData/research/pump/2026-11-24/candles/`.
  Si algo pasa su umbral se baja 15 minutos para afinar la entrada.
- **Tramos:** los del embudo de la fase 1. Tramo 1 hasta el 31/12/2021; tramo 2 del 31/01/2022 al 31/12/2022. La nota
  de cada prueba es el peor de los dos. El tramo 3 (2023, la puerta) y las fases 2 y 3 **no se miran**.

## Liquidez para 10,000 USDT

No hay libro histórico. Se calibra con una foto del libro de hoy de todas las monedas en operación: el deslizamiento de
ida y vuelta de 10,000 USDT a mercado contra el turnover de 24 h. El piso es el turnover desde el que al menos el 80% de
las monedas dan 10 bps o menos de ida y vuelta. En el histórico, una moneda pasa si la **mediana de su turnover diario
de los 30 días anteriores** al evento llega al piso (los días anteriores, para que el pump no se cuente a sí mismo).

**Foto del 24/11/2026 (516 monedas, antes de correr los eventos):**

| Turnover de 24 h | Monedas | Con 10 bps o menos | Mediana de ida y vuelta |
|---|---|---|---|
| menos de 1 M | 348 | 1% | 116 bps |
| 1 a 5 M | 93 | 2% | 45 a 68 bps |
| 5 a 10 M | 30 | 20% | 22 bps |
| 10 a 20 M | 18 | 39% | 11 bps |
| 20 a 50 M | 18 | 44% | 29 bps |
| 50 M o más | 9 | 100% | 2 a 3 bps |

- **El piso del plan sale en 31.7 M USD por día** (15 monedas hoy). Es el piso principal («32M»).
- **Sensibilidad declarada antes de correr: 10 M** (unas 45 a 50 monedas hoy; el 80% da 50 bps o menos). Va aparte y no
  cuenta entre las 14 pruebas.
- **Lo que mostró la foto:** las monedas que ese día estaban en pleno pump (BLESS, EVAA, ARIA, ELSA: 20 a 44 M de
  turnover) tenían libros finos, de 70 a 117 bps para 10,000 USDT. El turnover alto de un pump no trae libro. Por eso el
  piso mira los 30 días anteriores.
**Escalera de tamaño (pedido del usuario el 24/11, antes de correr los eventos):** empezar con trades de unos 2,500 USDT
e ir creciendo hasta 10,000, para no cerrar tanto el abanico al comienzo. Segunda foto del libro, con tres tamaños:

| Turnover de 24 h | Monedas | 2,500 USDT | 5,000 USDT | 10,000 USDT |
|---|---|---|---|---|
| 1 a 2 M | 52 | 29 bps | 41 bps | 66 bps |
| 2 a 5 M | 42 | 21 bps | 28 bps | 42 bps |
| 5 a 10 M | 31 | 11 bps | 15 bps | 20 bps |
| 10 a 20 M | 18 | 8 bps | 9 bps | 10 bps |
| 20 a 50 M | 18 | 13 bps | 19 bps | 26 bps |
| 50 M o más | 9 | 2 bps | 2 bps | 3 bps |

(Mediana del costo de ida y vuelta a mercado.) Con 10 bps o menos: 57 monedas para 2,500, 48 para 5,000 y 35 para
10,000.

Los tres escalones del estudio, por el turnover diario mediano de los 30 días anteriores:

- **5 M: trades de 2,500 USDT** (unos 11 bps de mediana; unas 75 monedas hoy). Es también el piso del scanner.
- **10 M: trades de 5,000 USDT** (unos 9 a 19 bps; unas 45 monedas hoy).
- **32 M: trades de 10,000 USDT** (el piso del plan; 15 monedas hoy).

Las 14 pruebas se leen en el escalón de 5 M, que es por donde se empieza; los otros dos dicen si lo que haya se
sostiene al crecer. La regla del 80% no sirve para 2,500 ni 5,000: la tumban las monedas en pleno pump del grupo de 20
a 50 M, así que los escalones salen de la mediana de cada grupo.

- Para medir, el ATR es el de las 14 velas hasta la del evento (lo que se sabe al cerrar); para detectar, el de las 14
  anteriores.

## Qué es un pump

En velas de 1 hora cerradas, sin futuro:

- `vh`: turnover de la vela contra la mediana de su misma hora en los 30 días anteriores;
- `vn`: turnover de la vela contra la mediana de las 24 velas anteriores;
- `mov`: retorno de la vela menos beta por el de BTC (beta de las 168 velas anteriores, entre 0 y 3), en ATR de 14
  velas anteriores.

**Pump (o caída):** `vh ≥ T` y `vn ≥ T` y `|mov| ≥ 2 ATR`, con T en 3, 5 y 10. El lado es el signo de `mov`. Subidas y
caídas van aparte. Cuenta el primero de cada episodio: sin otro evento de esa moneda en las 24 velas anteriores.

**Brazo del scanner:** volumen relativo de la última hora (4 velas de 15 min = 1 vela de 1 h) de 3 o más, sin pedir
avance; el lado, el signo del retorno de 24 h descontado BTC.

## Qué se mide

Como el barrido de señales, sin stop ni objetivo ni comisiones:

- si el precio llega a +2 ATR antes que a −2 ATR en el lado del evento, en 48 velas (sin ventaja es 50%);
- lo máximo a favor y en contra a 6, 12, 24 y 48 velas, en ATR.

Dos entradas:

- **inmediata:** la apertura de la vela siguiente. Nota positiva: sigue. Negativa y pareja: se devuelve;
- **retroceso:** una limit en la mitad de la vela del evento, válida 12 velas. Se mide desde el llenado.

## Controles

1. **Azar:** velas de la misma moneda y trimestre, con el mismo lado y el piso de liquidez.
2. **Sin volumen:** el mismo avance (≥ 2 ATR) con `vh` y `vn` bajo 1.5. ¿Aporta el volumen?
3. **Sin avance:** el mismo volumen con `|mov|` bajo 1 ATR, con el lado del color de la vela. ¿Aporta el avance?

El margen agrupa los eventos por semana.

## Criterio

Son 14 pruebas (3 umbrales × subida o caída × 2 entradas, más el brazo del scanner en sus dos lados). El umbral para
tomar una en serio es 2.9 errores sobre el azar en el peor de los dos tramos, y que les gane también a los controles 2
y 3. Lo que pase va a una regla en el probador, por el embudo, con comisiones y deslizamiento. Si nada pasa, se cierra.

Al lado de cada resultado va lo que cuesta la comisión taker de ida y vuelta (0.11%) en ATR de 1 hora de esos eventos.

## Resultado (25/11/2026)

Corrido con `OrderFlowData/research/pump/2026-11-24/estudio.py` sobre las velas de 1 hora de las 837 monedas (0 errores
al bajar, 240 MB). Tabla completa en `resultados.txt` de esa carpeta.

**Ninguna de las 14 pruebas pasa.** El umbral era 2.9 errores en el peor de los dos tramos; la que más se acerca queda
en 1.7.

- **Muestra:** solo 124 monedas tienen historia suficiente antes de 2023. En el escalón de 5 M entran de 17 a 77
  monedas según la prueba.
- **La subida con volumen no sigue: tiende a devolverse.** Es lo único con el mismo signo en los dos tramos. Escalón de
  5 M, puntos contra el azar de llegar a +2 ATR antes que a −2:

| Prueba | Tramo 1 | Tramo 2 |
|---|---|---|
| Subida, T = 3 | 260 eventos, −1.6 (−0.6 errores) | 676, −5.2 (−1.7) |
| Subida, T = 5 | 126, −5.0 (−1.3) | 444, −4.2 (−1.0) |
| Subida, T = 10 | 42, −10.3 (−1.7) | 175, −7.7 (−1.0) |
| Subida, T = 10, retroceso | 32, −8.0 (−1.0) | 131, −13.6 (−1.8) |

  No pasa el umbral, y en el escalón de 32 M desaparece.
- **La caída con volumen siguió cayendo en 2022** (T = 3: +9.6 puntos, 1.8 errores; en 32 M, +17.3 y 3.3 errores), pero
  no en el tramo 1 (+0.7). Es el año bajista, no una ventaja estable.
- **La regla del scanner sola no separa:** de −1.9 a +4.0 puntos, con el signo cambiando de un tramo al otro.
- **El volumen sin avance tampoco:** entre −2.2 y +4.1 puntos.
- **El control «avance sin volumen» no se pudo medir:** un avance de 2 ATR propio casi nunca ocurre sin volumen (de 1
  a 9 eventos).
- **Lo que sí cambia es la volatilidad:** tras una subida con volumen el precio recorre más a favor y más en contra que
  una vela cualquiera (3.3 ATR contra 2.8 en 24 velas), sin dirección.
- **Costo:** la comisión taker de ida y vuelta son 0.06 ATR en esos eventos (el ATR incluye la vela del pump). El
  deslizamiento va aparte y es mayor (ver la foto del libro).

**Límite del estudio:** con velas de 1 hora la entrada es al cierre de la hora del pump, que puede ser tarde. Entrar
antes, con velas de 15 minutos, sería otra hipótesis, con su plan fijado aparte y sobre los mismos tramos ya mirados.

## Segunda hipótesis: 15 y 5 minutos (fijada el 25/11/2026, antes de bajar los datos)

Pedido del usuario tras ver el resultado de 1 hora: los pumps son muy cortos en tiempo, probar en 15 y 5 minutos.

- **Datos:** velas de 5 minutos de Bybit de las monedas con historia antes de 2023, **bajadas solo hasta el
  31/12/2022** (`candles5/`). Las de 15 minutos salen de unir tres de 5. Los mismos dos tramos; el tramo 3 no se baja.
- **Pump:** la misma definición, en velas del marco: `vh ≥ T` (contra la misma hora del día en los 30 días anteriores),
  `vn ≥ T` (contra la mediana de las 24 velas anteriores) y `|mov| ≥ 2 ATR` descontado BTC (beta de las 168 horas
  anteriores). T en 3, 5 y 10. Cuenta el primero de cada episodio: sin otro en las 4 horas anteriores.
- **Medida:** entrada en la apertura de la vela siguiente; llegar a +2 ATR antes que a −2 ATR en 48 velas (4 horas en
  5m, 12 en 15m), y lo máximo a favor y en contra a 6, 12, 24 y 48 velas. Sin la entrada en el retroceso, que en 1 hora
  no aportó.
- **Controles:** el azar de la misma moneda, trimestre y lado, y el mismo volumen sin avance.
- **Escalones:** los mismos (5 M, 10 M y 32 M); se lee el de 5 M.
- **Criterio:** son 12 pruebas (2 marcos × 3 umbrales × subida o caída). Con las 14 de antes van 26 sobre los mismos
  tramos: el umbral sube a **3.1 errores** en el peor de los dos tramos. Una nota negativa y pareja dice que el pump se
  devuelve (se operaría al revés) y se juzga con el mismo umbral.
- **Costo:** en estos marcos 2 ATR es un recorrido corto. Al lado de cada resultado va la comisión taker de ida y
  vuelta en ATR; una ventaja menor que ese costo más el deslizamiento no sirve aunque pase el umbral.

### Resultado de 15 y 5 minutos (25/11/2026)

Velas de 5 minutos de las 124 monedas hasta el 31/12/2022 (`candles5/`, 191 MB, 0 errores), con `estudio_fino.py`.
Tablas en `resultados_15m.txt` y `resultados_5m.txt` (copiadas a `docs/RESULTADOS_PUMP.txt`).

**En ningún marco el pump sigue.** Una sola de las 12 pruebas pasa el umbral de 3.1, y pasa al revés: el movimiento se
devuelve. Lo que se devuelve es menos que la comisión.

- **15 minutos: nada.** Entre −9.8 y +3.3 puntos, con el signo cambiando; el peor tramo de cada prueba queda bajo 1.5
  errores.
- **5 minutos: las 12 pruebas salen negativas en los dos tramos** (escalón de 5 M, puntos contra el azar):

| Prueba | Tramo 1 | Tramo 2 |
|---|---|---|
| Caída, T = 3 | 2,609 eventos, −5.6 (−3.5 errores) | 7,913, −3.8 (−3.2) |
| Subida, T = 3 | 3,182, −3.1 (−2.4) | 8,105, −3.5 (−4.3) |
| Caída, T = 5 | 1,752, −4.3 (−2.4) | 5,929, −3.6 (−2.6) |
| Subida, T = 5 | 2,080, −3.8 (−2.1) | 5,925, −3.7 (−4.3) |
| Caída, T = 10 | 837, −2.7 (−1.0) | 3,129, −3.8 (−2.1) |
| Subida, T = 10 | 794, −4.4 (−1.5) | 2,835, −3.1 (−2.1) |

  Pasa la caída con T = 3 (3.2 errores en su peor tramo): tras una vela de 5 minutos con volumen y avance, el precio
  tiende a volver. Más volumen no lo agranda.
- **No alcanza para operar:** ir al revés acierta unos 4 puntos más que el azar, que a ±2 ATR son cerca de 0.15 ATR por
  trade. La comisión taker de ida y vuelta son 0.26 a 0.29 ATR en esos eventos, sin contar el deslizamiento.
- **El volumen sin avance no hace nada** en 5 minutos (de −1.3 a +2.4 puntos): lo que se devuelve es el avance con
  volumen.
- En los escalones de 10 M y 32 M el signo se mantiene y el efecto es igual o menor.

**Cierre:** con esta definición, en 1 hora, 15 y 5 minutos, entrar a favor de un pump no gana, y entrar en contra gana
menos que su costo. Fueron 26 pruebas sobre los tramos 1 y 2. La moneda «en juego» del scanner sirve para elegir dónde
mirar (se mueve más), no como señal.
