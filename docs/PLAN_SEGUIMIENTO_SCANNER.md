# Seguimiento de los hallazgos del scanner (24/11/2026)

## El pedido

> «Quiero que miremos la posibilidad de tener compras basadas en lo que escaneamos y para eso necesitamos poder ver desde
> el momento en que encuentra una moneda, en qué punto ocurrió un movimiento importante luego, qué variables y/o
> indicadores se estaban activando en ese momento y que podamos definir un procedimiento para tomar las decisiones de
> compra.»

El concepto tiene 4 partes:

1. el seguimiento de cada hallazgo;
2. verlo en pantalla;
3. la historia del scanner de 2023 a 2026;
4. el procedimiento de compra.

El usuario aceptó empezar por el seguimiento («Sí, empieza», 24/11). Este plan es la parte 1, con la pantalla para
mirarla (la 2).

## Lo medido antes (24/11)

`OrderFlowData/research/scanner/2026-11-24/resumen.md`: 145 episodios del 23/11 13:20 UTC al 24/11 23:38 UTC, 55 del
arranque de la suite.

- Con los hallazgos en vivo, el movimiento grande llega antes que en las demás candidatas: a los 250 min contra 665
  (mediana).
- Pero casi con la misma frecuencia: 67% contra 62%.
- Y no dice hacia dónde: en la carrera a ±2 ATR, 24% siguió contra 34% del control.

Es un solo régimen (BTC −7.6% en la semana) y 42 casos con 24 h.

## Qué se anota (fijado antes de registrar)

### El hallazgo

- **Cuándo hay uno:** una moneda entra a En juego, Tendencia o Rápidos sin estar en ninguna de las tres, y sin haber
  salido de todas en las 2 h anteriores. Si ya estaba, o volvió antes de 2 h, es el mismo hallazgo.
- **Su hora (t0) y su precio (p0):** los que anotó el scanner en esa entrada.
- **Su lado:** el de la lista en la que entró.
  - En juego: el signo del movimiento propio de 24 h; sin él, el del retorno de 24 h.
  - Tendencia: la ruptura de 20 días.
  - Rápidos: el signo del cambio de precio que la hizo entrar.
- **Arranque:** en En juego y Tendencia, si el scanner no miró en los 30 min anteriores a la vuelta que la encontró (al
  abrir la suite o tras un corte). Esa moneda ya venía moviéndose y su hora no es la del hallazgo: se cuenta aparte.
  Rápidos nunca, porque necesita ver el cambio.
- **La foto:**
  - las 34 medidas de la vuelta del scanner en o antes de t0 (las de su registro, `data/scanner/log`);
  - el mercado y los motivos de la entrada.
- **Su lista:** a qué listas entró y cuándo salió en las 24 h siguientes, del registro de entradas y salidas.

### El control

En cada vuelta del scanner se eligen 2 candidatas, al azar pero fijas por la hora y la moneda. No pueden estar en una
lista, en un hallazgo abierto ni ser BTC.

Llevan las mismas medidas, y su lado es el signo del movimiento propio de 24 h. Sirven para saber cuánto de lo que se ve
pasa igual en una moneda cualquiera, en el mismo mercado.

### A las 24 h y 10 min

Se piden a Bybit las 48 h de t0 − 24 h a t0 + 24 h, en 5 min:

- velas;
- OI;
- proporción de cuentas en largo;
- prima del funding;
- velas de BTC.

Para los elementos, además, las velas de 15 min de los 35 días anteriores.

Todo está en la historia pública de Bybit. Si la suite está cerrada a esa hora, se mide al abrirla y da lo mismo.

**Medidas**, en ATR de 1 h de la foto (de p0), desde la primera vela de 5 min que empieza después de t0:

- **el movimiento importante:** la primera vez que el precio se aleja 3 ATR de p0 en 24 h, a qué hora y si sigue o gira
  respecto del lado;
- **la carrera:** si llega antes a +2 o a −2 ATR: sigue, gira, las dos en la misma vela o ninguna;
- **a 1, 4, 12 y 24 h:** lo máximo a favor, lo máximo en contra y el cierre;
- **antes:** lo que se movió en la hora, las 4 h y las 24 h anteriores;
- **de la historia, al hallazgo:**
  - el OI en la hora anterior y en las 1 y 4 h siguientes;
  - las cuentas en largo y su cambio en una hora;
  - la prima;
  - el volumen de la última hora contra las 23 anteriores;
  - BTC a 1, 4 y 24 h.
- **los elementos:** los 33 de velas del probador de App 1, con sus ajustes de fábrica, en 15 min y 1 h. Cada uno va en
  la vela en que se conoce, de t0 − 24 h a t0 + 24 h. Quedan fuera:
  - el barrido de liquidaciones (LIQ), que necesita las liquidaciones;
  - la trampa y la purga de OI (TA y PO), que necesitan el OI de App 1.

### Lo que no es

- Nada se envía al bot ni se graba de Bybit en vivo.
- **El order flow no está** (delta, CVD, Elementos OF). Las monedas del scanner no se graban hasta agregarlas a la suite
  (decisión del 22/11). Se podría bajar al día siguiente de los archivos oficiales de Bybit, pero ocupa disco por cada
  moneda y día: es un paso aparte.

## El informe (fijado antes de mirar)

- **Bloques:** los hallazgos en vivo por lista, los del arranque y el control. En cada uno:
  - cuántos hay;
  - cuántos tuvieron el movimiento importante, y en cuánto tiempo;
  - cuántos siguieron;
  - la carrera;
  - lo máximo a favor y en contra.
- **Ocho cortes**, en los hallazgos en vivo y en el control:
  - el OI de 1 h sube;
  - ya se movió más de 6 ATR en 24 h;
  - volumen de 1 h ×5 o más;
  - funding del lado;
  - cuentas en largo del lado (más de la mitad en largo, con el lado hacia arriba, o al revés);
  - prima del lado;
  - el lado es hacia arriba;
  - ruptura de 20 días.
- **Los elementos al hallazgo** (conocidos en la hora antes de t0):
  - cuánto sigue la carrera con el elemento y sin él, en los hallazgos y en el control;
  - antes que la lista, el reparto: cuántos pasan de ±2 errores contra lo que da el azar.
- **Antes del movimiento importante:** qué elementos se encienden en la hora anterior más que en una hora cualquiera del
  mismo hallazgo. Solo describe.

Sirve para mirar y elegir hipótesis, no para operar. Una regla de compra se fija aparte, antes de correrla, y se juzga
en datos que no se miraron (partes 3 y 4).

## Datos

En `data/scanner/follow`, comprimido como el registro del scanner (un miembro gzip por línea):

- `episodes/AAAA-MM-DD.jsonl.gz`: la foto de cada hallazgo y control, al abrirse;
- `index/AAAA-MM-DD.jsonl.gz`: lo medido de cada uno, en corto, para la lista y el informe;
- `closed/AAAA-MM-DD.jsonl.gz`: lo medido completo de los hallazgos, con sus 48 h en velas de 15 min y sus elementos.
  Lo medido sale de las velas de 5 min;
- `state.json` y `follow.lock` (un solo proceso por carpeta).

Lo ya anotado por el scanner desde el 23/11 se arma igual al encenderse. `SUITE_FOLLOW=0` lo apaga; sin esa variable
vale `SUITE_SCANNER`.

## Pasos que siguen

1. Seguimiento y pantalla: hecho el 24/11 (`server/scan_follow.py` y el módulo «Seguimiento»; ver
   `12.AltagraciaTradingSuite/CLAUDE.md`, «Seguimiento del scanner (24/11)»).
2. El order flow del día siguiente para los hallazgos: bajar de Bybit solo esos días. Hay que decidir cuánto disco.
3. La historia del scanner de 2023 a 2026, con las monedas cerradas: miles de hallazgos en otros mercados. El usuario
   la eligió el 24/11 («La historia»): ver «Parte 3» abajo. Hecha el 25/11: las hipótesis H1 y H3 no pasan la fase 2.
4. El procedimiento: hipótesis fijadas antes, fases con controles y costos, y un registro en vivo sin órdenes antes del
   bot. El primer paso, las reglas de App 1 en las monedas del scanner, no pasó la fase 1 (25/11): ver «Parte 4» abajo.

## Parte 3: la historia del scanner (fijado antes de mirar, 24/11)

**Para qué:** los hallazgos en vivo son pocos y de un solo mercado (bajista). La historia da miles, en mercados
distintos, para elegir hipótesis de compra que después se juzgan aparte.

**Universo, sin sesgo de supervivencia:**

- los perpetuos USDT de Bybit de cripto e innovación, también los 321 cerrados, desde su alta hasta su cierre;
- sin acciones, ETF, materias primas ni forex, como el scanner de fábrica;
- la etiqueta ST no se usa: no se sabe cuándo la tuvo cada moneda;
- los cerrados cuentan como cripto.

**Datos de Bybit** (en `OrderFlowData/scanner_history`, fuera del repositorio):

- velas de 15 min desde el 25/11/2022: 35 días antes del 1/1/2023, para las ventanas de 30 días;
- el funding liquidado.

**Unos 45 mil pedidos**, en segundo plano y que se retoman si se cortan, a lo sumo 10 por segundo. Ocupa cerca de 1 GB.
Sin OI en esta primera pasada: sus cortes quedan vacíos hasta bajarlo.

**El scanner, vuelta a vuelta, cada 15 min:**

- las mismas medidas de `scanner.py` (volumen relativo por hora y tipo de día, retornos, ATR, beta y movimiento propio
  contra BTC, eficiencia, ruptura de 20 días) con la configuración de fábrica:
  - piso de 5 M USD en 24 h y hasta 150 candidatas;
  - En juego con volumen de 24 h ×1.5 o de 1 h ×3;
  - Tendencia con la ruptura de 20 días, la eficiencia de 7 días en el tercio alto y el movimiento propio a favor;
  - salen tras 60 min sin cumplir.
- **Lo que no se puede reconstruir:**
  - el libro: toda candidata cuenta como operable, y el costo se estima con la comisión;
  - el funding de ese momento: se usa el último liquidado;
  - Rápidos, que necesita el precio y el OI de cada 30 s.
- **Se comprueba antes de usarla:** en los días en que el scanner corrió en vivo (desde el 23/11), las medidas y las
  listas reconstruidas se comparan con las de su registro.

**Hallazgos, control y medidas:** los de la parte 1 (mismo hallazgo si vuelve antes de 2 h, el lado de su lista y 2
controles por vuelta). Se miden en velas de 15 min, desde la que empieza al cierre de la vuelta. Los elementos del
probador de App 1, primero solo en la fase 1.

**Fases**, como las del probador de App 1:

| Fase | Fechas | Uso |
|---|---|---|
| 1, exploración | 2023 | se mira todo y se eligen las hipótesis |
| 2, validación | 1/1/2024 al 30/6/2025 | las hipótesis fijadas se miden una vez |
| 3, final | desde el 1/7/2025 | solo lo que pase la 2 |

En esta pasada solo se reconstruye y se mira la fase 1. Las fases 2 y 3 se reconstruyen, pero no se informan hasta
tener las hipótesis fijadas.

**El informe de la fase 1:** el de la parte 1 (bloques, cortes y elementos contra el control), más por trimestre y por
mercado (BTC sobre o bajo su promedio de 20 días).

**Estado (25/11):** la fase 1 está reconstruida, comprobada y medida. Los resultados y las hipótesis candidatas están en
`OrderFlowData/research/scanner/historia/resumen.md`, con los scripts en esa carpeta.

- **Contra el scanner en vivo:**
  - las medidas coinciden en el 99.3 % al 100 % de 1,260 filas;
  - en las listas, encuentra el 98 % de En juego, quitando las monedas de la suite y el libro, que no se reconstruyen.

  La historia lleva cerca de un tercio más de miembros, por las de libro caro.
- **2023:** 25,192 hallazgos. Se mueven más y antes que el control (3 ATR en el 70.4 % contra el 66.1 %, en 8 h contra
  10 h), sin dirección (la carrera sigue en el 49.6 %). Lo estirado gira: con más de 10 ATR a favor en 24 h, la carrera
  sigue en el 33 %.
- **Elementos:** 32 de 127 pasan de ±2 errores (por azar, 5.8), con efectos de 2 a 6 puntos, del orden del costo
  (0.11 ATR de 1 h).

### Las hipótesis de la fase 2 (fijadas el 25/11, antes de mirarla)

El usuario eligió H1 y H3 («H1 y H3», 25/11). H1b queda fuera: el costo se lleva casi todo.

**La apuesta, igual en las dos:**

- **Entrada:** al cierre de la vuelta que encuentra la moneda, a su precio (el cierre de esa vela de 15 min). Cada
  hallazgo es un trade, también si la misma moneda tiene otro abierto.
- **Salida:** objetivo y stop a 2 ATR de 1 h de la entrada, en velas de 15 min, durante 24 h.
  - Gana +2 ATR si toca primero el objetivo y pierde −2 si toca primero el stop.
  - Si los dos caen en la misma vela, cuenta como pérdida.
  - Si en 24 h no toca ninguno, sale al cierre de las 24 h.
- **Costo:** la comisión taker de ida y vuelta más 3 bps (14 bps), en ATR de 1 h de cada trade.
- **La cuenta:** en ATR de 1 h por trade (1 R = 2 ATR).

**H1, ir en contra de lo muy estirado:** los hallazgos de En juego o Tendencia que llevan 10 ATR de 1 h o más a favor de
su lado en las 24 h anteriores, del cierre de hace 24 h al precio del hallazgo. Se apuesta en contra del lado.

**H3, seguir con el canal gaussiano en contra:** los hallazgos con un canal gaussiano (GC) de 15 min en contra de su
lado, conocido en la hora anterior al hallazgo, con los ajustes de fábrica del probador. Se apuesta a favor del lado.

**Pasa** cada una por separado si cumple las dos cosas:

1. el resultado medio después del costo es positivo y su margen al 95 % queda entero sobre cero;
2. le gana con margen a la misma apuesta en los hallazgos que no cumplen la condición.

El margen agrupa los trades por semana UTC de entrada, como el probador (B-08). Con dos hipótesis, la probabilidad de
que una pase por suerte llega al 10 %: para eso está la fase 3.

**Se informa sin decidir:**

- el acierto antes del costo;
- el control con la misma condición;
- el resultado por trimestre, por lado y por lista;
- el resultado con los dos niveles en la misma vela contados en cero antes del costo.

De la fase 2 no se mira nada más: sus bloques, sus cortes y los demás elementos no se calculan. De los elementos solo
se calcula el canal gaussiano de 15 min.

**La fase 3**, solo con la que pase, con el mismo criterio y una sola vez.

**La fase 1 con esta misma cuenta** (`hipotesis.py`, en ATR de 1 h por trade):

| | Trades | Acierto | Antes del costo | Después del costo | Contra sin la condición |
|---|---|---|---|---|---|
| H1 | 265 | 62.5 % | +0.50 | +0.32 ± 0.40 | +0.43 ± 0.41 |
| H3 | 1,326 | 54.7 % | +0.18 | +0.03 ± 0.20 | +0.20 ± 0.18 |

- Con la regla exacta, en la fase 1 ninguna pasaría la condición 1: el margen toca el cero.
- Las dos le ganan con margen a la misma apuesta sin la condición.
- La tabla de candidatas daba más porque dejaba fuera dos tipos de trades y usaba el costo mediano:
  - los que tocan los dos niveles en la misma vela (17 de los 265 de H1);
  - los que no tocan ninguno en 24 h.

### El resultado de la fase 2 (25/11)

Medida una sola vez (`hipotesis.py 2`), con 50,545 hallazgos y 104,928 controles en 622 monedas (272 hoy cerradas). Por
vuelta, la mediana fue de 150 candidatas (el tope), 48 en En juego y 3 en Tendencia.

| | Trades | Acierto | Antes del costo | Después del costo | Contra sin la condición | Pasa |
|---|---|---|---|---|---|---|
| H1 | 511 | 50.0 % | 0.00 | −0.11 ± 0.37 | +0.03 ± 0.37 | no |
| H3 | 2,288 | 50.9 % | +0.04 | −0.07 ± 0.16 | −0.02 ± 0.17 | no |

- **Ninguna pasa, y no hay fase 3.** Las dos quedan en lo que da el azar: H1 acierta la mitad y H3 casi.
- **Sin decidir:**
  - el control con la misma condición da lo mismo: −0.09 ± 0.53 en H1 (99 trades) y −0.07 ± 0.10 en H3 (5,178);
  - por trimestre, H1 va de +0.56 a −0.62, y H3, de +0.24 a −0.31;
  - por lado, H1 da +0.08 en las de bajada y −0.45 en las de subida;
  - con los dos niveles en la misma vela contados en cero, H1 da +0.07 ± 0.40: los tocaron 44 de los 511.
- **Lo que queda:** el scanner encuentra monedas que se mueven más y antes, pero no dice hacia dónde. Ni ir en contra de
  lo estirado ni seguir con el canal gaussiano en contra dan esa dirección. Una compra basada en el scanner necesita otra
  hipótesis, fijada con la fase 1 y medida en la 2.

## Parte 4, primer paso: las reglas de App 1 en las monedas del scanner (fijado el 25/11, antes de mirar)

**Pedido:** «Sí, pruébalo» (25/11): si las reglas del registro en vivo rinden más en las monedas del scanner. Es la
idea de "Stocks in Play": la misma regla, en las monedas que el mercado está mirando.

**Las reglas:** las tres del registro en vivo, exactas (`rule_watch.RECORDS`, `docs/PLAN_REGLAS_EN_VIVO.md`):
- Impulso, 3R;
- FVG nuevo, 3R;
- B1.

Van en 4 horas con el probador de App 1 (`rule_tester.run`), como el registro:
- sin minuto a minuto;
- comisión taker de 0.055 % por lado y tope de la comisión en 0.3 R;
- una posición a la vez por moneda y regla.

**Las monedas:** todas las de la historia que cotizan en la fase, también las cerradas, con sus velas de 4 horas armadas
de las de 15 min.
- B1 lee el OI de 4 horas y el funding de cada moneda, bajados de Bybit (`oi_hist.py`).
- Cada moneda empieza a contar 30 días después de su primera vela, para que el ATR, la EMA y el volumen por hora
  arranquen con historia.

**En el scanner:** una señal está en el scanner si su moneda está en En juego o en Tendencia en la vuelta del cierre de
la vela de la señal, cuando la regla decide. Cada trade cae en uno de tres grupos:
- **en el scanner;**
- **candidata sin lista:** está entre las candidatas de esa vuelta (5 M USD en 24 h, las 150 de más volumen), pero en
  ninguna lista;
- **fuera:** no es candidata. Solo se informa.

**Pasa** cada regla por separado si, con sus trades en el scanner, cumple las dos cosas:
1. el R por trade es positivo y su margen al 95 % queda entero sobre cero;
2. le gana con margen al R por trade de las candidatas sin lista.

El margen agrupa los trades por la semana de su salida, como el probador y el registro en vivo.

**Las fases:**
- la 1 (2023), con todo a la vista;
- pasa a la 2 (2024 a junio de 2025) la regla que en la fase 1 cumpla las dos condiciones. Ahí se mide una sola vez, con
  el mismo criterio;
- la 3, solo con la que pase la 2.

**Se informa sin decidir:**
- el R antes del costo, el acierto y el grupo «fuera»;
- por trimestre, por lado del trade y por lista;
- si el trade va hacia el mismo lado que la lista.

**Lo que no se puede reconstruir:**
- el libro: las monedas de libro caro están en la historia, y su costo real es mayor;
- Rápidos;
- los minutos dentro de la vela.

Los trades son los de la regla sin la condición del scanner: con una posición a la vez, una señal fuera del scanner
puede quitarle el lugar a una de adentro.

### El resultado de la fase 1 (25/11)

`reglas.py` en `OrderFlowData/research/scanner/historia/`:
- **Comprobado antes:** en cinco monedas del probador (SOL, ADA, DOGE, LINK y AVAX), las reglas sobre las velas de la
  historia dan los mismos trades que sobre las de App 1: 748 de 748, también B1.
- **La fase 1:** 31,757 trades en 301 monedas. 12 quedaron abiertos y 11 monedas listadas a fin de año no alcanzan a
  contar.

R por trade después del costo, con su margen:

| Regla | En el scanner | Candidatas sin lista | Diferencia | Fuera |
|---|---|---|---|---|
| Impulso | 4,270 trades, +0.05 ± 0.16 | 992, +0.04 ± 0.18 | +0.02 ± 0.18 | 6,220, +0.12 ± 0.19 |
| FVG nuevo | 5,274, −0.01 ± 0.14 | 2,041, +0.03 ± 0.20 | −0.04 ± 0.16 | 8,629, +0.03 ± 0.14 |
| B1 | 2,025, −0.08 ± 0.12 | 275, +0.04 ± 0.28 | −0.12 ± 0.23 | 2,031, 0.00 ± 0.16 |

- **Ninguna pasa:** estar en el scanner no cambia lo que rinden. Ninguna va a la fase 2, que esta prueba no tocó.
- **Sin decidir:**
  - en Impulso, los trades hacia el mismo lado de la lista dan +0.11 ± 0.16 (2,971) y los contrarios −0.09 ± 0.23
    (1,253): no se separan con margen;
  - el grupo «fuera» son monedas de poco volumen: su costo real es mayor que la comisión que se cuenta.
