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
3. La historia del scanner de 2023 a 2026, con las monedas cerradas: miles de hallazgos en otros mercados.
4. El procedimiento: hipótesis fijadas antes, fases con controles y costos, y un registro en vivo sin órdenes antes del
   bot.
