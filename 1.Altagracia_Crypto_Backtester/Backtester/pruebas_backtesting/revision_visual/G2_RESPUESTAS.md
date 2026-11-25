# Galería 2 (Lector VPA): las respuestas del usuario (24/11/2026)

Marcas del usuario: **Sí 16 · No 12 · No sé 4 de 32** (4 casos por elemento). El texto que pegó está en
`evidencia/etapa7/galeria_marcas_2.txt`. Marcó "Sí" en todos los casos de la ruptura sin volumen.

Cada caso se revisó con su corrida, repetida en la copia aislada. Se midió:
- el volumen y el rango de la vela contra su hora, que es lo que usa la app;
- los mismos dos, contra las 20 velas anteriores, que es lo que ve el ojo en el gráfico;
- el medidor antes de la vela y en ella;
- las velas de alrededor.

Las horas van en hora de Colombia (UTC−5). Scripts en el scratchpad de la sesión: `g2_casos.py`, `g2_medidor.py`,
`vpa_proto.py` y `g2_propuesta.py`.

## Lo principal

**La mayoría de los "No" tiene una sola causa.** La app mide el volumen de cada vela contra la mediana de su misma hora
en los 30 días anteriores. En el gráfico, el volumen se compara con las velas de al lado. En 4h la hora pesa mucho: una
vela de una hora tranquila puede tener 1.6 veces lo de su hora y menos volumen que casi todas sus vecinas.
- Esfuerzo 21: 1.57 veces su hora, pero 15 de las 20 velas anteriores tuvieron más volumen.
- Clímax 14: 3.38 veces su hora, pero 0.67 veces la mediana de las 20 anteriores.

## En una línea por elemento

| Elemento | Casos | Qué es |
|---|---|---|
| Esfuerzo sin resultado | 21, 28, 48 (No) | 21: volumen alto solo para su hora. 28: la vela medía 1.48 ATR, con resultado. 48: es la pausa después de una vela ancha. Propuestas 1 y 2 |
| Ruptura con volumen | 103, 144, 185 (Sí, con nota) | En 103 y 144 la regla sí entró antes: la marubozu fue el trade 102 (+2.97 R) y la vela del t143 fue el trade 143 (stop). Lo del 185 es una idea de filtro, para medirla aparte |
| Ruptura sin volumen | todos Sí | — |
| Retroceso sin volumen | 19, 30, 34 (No sé) | El concepto va abajo. En el 34, y también en el 5, el "retroceso" es la vela siguiente a la ruptura. Propuesta 5 |
| Prueba de poco volumen | 16, 76, 121, 151 (No) | Tienes razón: las cuatro caen en tramos fuertes, de 5.7 a 11.8 ATR, sin consolidación. Propuesta 3 |
| Frenado o techo | 6, 25 (No) | 6: las mechas eran largas, pero en la captura la caja del elemento tapaba la segunda (O-37). 25: volumen alto solo para su hora. Propuestas 1 y 4 |
| Clímax | 8, 14 (No) | Volumen alto solo para su hora. Propuesta 1 |
| El medidor cruza el umbral | 75 (No), 88 (No sé) | 75: sí cruzó, de +0.73 a +2.01 con umbral 1, pero el panel salió muy bajo (O-37). 88: cómo se calcula, abajo. 125: propuesta 6 |

## Caso por caso

### Esfuerzo sin resultado (QA)

La regla de hoy: una vela con volumen alto para su hora y poco rango para ese volumen (grado de 50% o más). Se opera
contra el color de la vela.

- **21 (largo, 10/11/20 a las 23:00).**
  - La vela tuvo 1.57 veces el volumen de su hora, pero 0.66 veces la mediana de las 20 anteriores.
  - Las rojas que señalas son las del 09/11 a las 23:00 y las del 10/11 a las 03:00 y 07:00. Su volumen fue creciendo:
    0.5, 1.0 y 1.4 veces la mediana de las 20 anteriores. Ninguna llegó a 1 ATR de rango.
  - Ese esfuerzo de varias velas es otro elemento: la regla de hoy mira una vela a la vez.
- **28 (corto, 05/02/21 a las 19:00).**
  - La vela tuvo 2.55 veces el volumen de su hora, y fue la de más volumen de las 20 anteriores.
  - Su rango fue de 1.48 ATR, 1.74 veces la mediana de las 20 anteriores, con un cuerpo del 74% que cerró arriba.
  - Para la app ese rango era poco para tanto volumen: el rango fue 1.14 veces lo de su hora y el volumen, 2.55.
  - A la vista es una vela grande, con resultado. Contra las 20 anteriores no cuenta como esfuerzo sin resultado.
- **48 (corto, 28/02/22 a las 11:00).**
  - La vela tuvo 1.83 veces el volumen de su hora y un rango de 0.67 ATR.
  - La anterior, la de las 07:00, tuvo 3.3 veces el volumen de las 20 anteriores y 2.6 ATR de rango: esfuerzo con
    resultado. La de la señal es su pausa.
  - La vela siguiente, la de las 15:00, subió 2.4 ATR con más volumen y tocó el stop.
- **68 (Sí).** La vela tuvo 4.74 veces el volumen de las 20 anteriores y 1.35 ATR de rango. Sigue con las propuestas.

### Ruptura con volumen (QB)

- **103.** La marubozu del 03/12/21 a las 11:00 fue el trade 102:
  - tuvo un cuerpo del 95% y 3.22 veces el volumen de su hora, y cerró 1.54 ATR bajo el mínimo de las 20 velas;
  - entró a las 15:00 y ganó +2.97 R en la vela del desplome.

  El 103 es la ruptura siguiente, la del desplome (14 veces el volumen de su hora), y tocó su stop.
- **144.** El triángulo "t143" es el trade 143. Tuvo su señal el 17/07/22 a las 23:00, entró y tocó su stop el 18/07 a
  las 11:00. El 144 es la segunda ruptura del mismo máximo.
- **185.** Tu idea es mirar si el volumen del movimiento anterior (las verdes) fue mayor que el del retroceso (las
  rojas). Es un filtro, para medirlo aparte.
  - La presión del Volumen de Respuesta de 4h estaba a favor del corto (+2.03), porque mira solo el tramo bajista en
    curso.
  - Para tu idea habría que medir el movimiento anterior.

### Retroceso sin volumen tras la ruptura (QR): el concepto

Primero hay una ruptura con volumen: una vela cierra fuera del rango de las 20 anteriores, con volumen alto. Después, en
las 8 velas siguientes:
- el precio vuelve hacia el nivel roto con poco volumen, porque nadie empuja en contra;
- una vela vuelve a cerrar a favor de la ruptura, y ahí se entra a favor de la ruptura.

Es la vuelta al nivel roto (el "retest"). Coulling la usa para confirmar la ruptura.

- **19 (corto).** La roja del 17/02/22 a las 15:00 rompió hacia abajo los 40,720, con 1.74 veces el volumen de su hora.
  La verde de las 19:00 volvió hacia el nivel con el volumen normal de su hora. La roja resaltada, la de las 23:00, cerró
  otra vez bajo el nivel con poco volumen (0.62 veces su hora). Ganó 3R.
- **30 (corto).** La roja del 06/12/22 a las 23:00 rompió hacia abajo los 16,855. Dos verdes volvieron al nivel, con 1.0
  y 0.7 veces el volumen de su hora. La roja resaltada, la del 07/12 a las 11:00, cerró bajo el nivel. Tocó su stop.
- **34 (largo).**
  - La barra roja grande de la mitad no es el retroceso: es una caída anterior, la del 27/03/23 a las 07:00.
  - La ruptura es la verde grande justo antes de la resaltada (29/03/23 a las 03:00, 2.73 veces el volumen de su hora),
    que pasó los 28,197.
  - La resaltada es el "retroceso": bajó cerca del nivel y cerró verde. Pero es la vela siguiente a la ruptura y casi no
    volvió. Lo mismo pasa en el 5.

### Prueba de poco volumen (QT)

Tienes razón en las cuatro: la prueba cae en medio de un tramo fuerte, sin consolidación. Los tramos eran de 11.8 ATR en
el 16, 5.9 en el 76, 5.7 en el 121 y 9.6 en el 151.

La regla de hoy solo pide una vela de poco volumen y con mecha que llegue al precio de una vela anterior de volumen alto
y de color contrario. El 76 es la misma vela que el retroceso 19: el retroceso la operó en corto, y ganó; la prueba, en
largo, y perdió.

### Frenado o techo (QS)

- **6 (corto, 20/10/20 a las 03:00).**
  - Las dos velas tenían mecha arriba de 0.96 y 1.39 ATR (el 79% y el 71% de su vela), con 2.36 y 4.68 veces el volumen
    de las 20 anteriores.
  - En la captura, la caja del elemento y los rótulos tapan la mecha de la vela resaltada (O-37).
  - La vela de la entrada subió con todavía más volumen (5.7 veces) y tocó el stop.
- **25 (largo, 24/02/22 a las 03:00).**
  - Las mechas medían 0.49 y 0.47 de su vela (0.60 y 0.47 ATR), y el volumen fue 1.48 veces el de las 20 anteriores.
  - La entrada que propones es una regla en secuencia: primero el frenado y después la vela con esfuerzo con resultado.
    Sería 2 velas después, con el stop en el swing anterior. Para eso hace falta la propuesta 7.
- **49 (Sí).** La verde de mecha larga de la derecha, donde tú habrías entrado, llega después de la señal.

### Clímax (QC)

- **8 (corto, 04/11/20 a las 15:00).** Las dos velas del clímax tuvieron 3.99 y 2.56 veces el volumen de su hora. Contra
  las 20 anteriores fueron 2.13 y 1.23 veces, y la verde del triángulo de la izquierda tuvo más.
- **14 (largo, 21/05/21 a las 23:00).** La vela tuvo 3.38 veces el volumen de su hora, pero 0.67 veces la mediana de las
  20 anteriores: 12 de ellas tuvieron más volumen. Esas 20 velas incluyen el desplome del 19/05.
- **17 y 30 (Sí).** Las velas del clímax tuvieron de 3 a 11 veces el volumen de las 20 anteriores. Siguen con las
  propuestas. Tu idea del 17, usarlo como contexto con otra vela de gatillo, es la propuesta 7.

### El medidor (QE)

**Cómo se calcula.** No es un MACD. Cada vela suma o resta evidencia según cinco lecturas:
1. la absorción: mucho volumen con poco rango, en contra del color de la vela;
2. la trampa: mucho rango con poco volumen;
3. la vela validada: volumen y rango a favor de su color;
4. las formas según el tramo: martillo, estrella y doji;
5. el esfuerzo que se agota: el precio avanza en 4 velas mientras el volumen de las 2 últimas cae bajo el 60% de las 2
   anteriores.

Lo de antes pesa un 25% menos en cada vela. Cruzar el umbral (±1) es juntar varias velas de evidencia del mismo lado.

- **75 (largo).** Sí cruzó: de +0.73 a +2.01.
  - La vela era roja, con 9.9 veces el volumen de su hora y una mecha larga abajo, al final de una caída de 9.8 ATR. Sumó
    +0.84 por absorción y +0.62 por martillo.
  - En la captura el panel salió muy bajo y no se ven el umbral ni el cruce (O-37).
  - El medidor ya era positivo: no cruzó el cero, que es lo que buscabas.
- **88 (No sé).** Lo que viste, las verdes con volumen cada vez menor, es lo que lo hizo cruzar. Esa vela restó 0.88: 0.80
  por el esfuerzo que se agota y 0.08 por la estrella.
- **125 (Sí).** Cruzó con +0.50 de una vela validada.

## Propuestas al usuario

Se midieron en BTC 4h, fase 1, con una copia del lector que tiene cada propuesta como opción. Sin las opciones, la copia
da las mismas 1,420 señales que la app.

| # | Propuesta | Señales (fase 1) | Tus casos |
|---|---|---|---|
| 1 | Volumen alto: alto para su hora **y** frente a las 20 velas anteriores. Vale para los elementos; el medidor no cambia | esfuerzo 197 → 56; frenado 75 → 43; clímax 44 → 18; ruptura 374 → 350; prueba 430 → 378 | Salen 5 "No": esfuerzo 21 y 28, frenado 25, clímax 8 y 14. No cambia ningún "Sí" |
| 2 | Esfuerzo sin resultado: no cuenta si la vela anterior fue ancha (tuvo resultado) | esfuerzo 56 → 29 | Sale el 48 (No). El 68 (Sí) sigue |
| 3 | Prueba de poco volumen: dentro de una consolidación (las cajas del Régimen), en su mitad de abajo la de oferta y en la de arriba la de demanda, y después de un clímax o un frenado de su lado (20 velas) | prueba 378 → 10 | Salen los 4 "No". Solo con la caja quedan 189, pero el 76 y el 121 siguen; solo con el clímax o frenado, 22, y el 151 sigue |
| 4 | Frenado o techo: mecha de al menos media vela (hoy, un tercio) | frenado 43 → 30 | Ninguno cambia; el 25 ya sale con la 1 |
| 5 | Retroceso: al menos una vela que vuelva, en contra de la ruptura, antes de la que confirma | retroceso 44 → 38 | Salen el 34 (No sé) y el 5 (Sí) |
| 6 | Elemento nuevo "El medidor VPA gira": cruza el cero después de haber pasado el umbral del otro lado. El cruce del umbral sigue igual | 174 | — |
| 7 | Elemento nuevo "Esfuerzo con resultado": la vela validada, a favor de su color. Sirve de gatillo en una regla en secuencia, después de un clímax, un frenado o una prueba | 650 | — |

Se arregla sin preguntar (O-37): en las capturas que se repitan, el panel del Lector VPA más alto. Además, al pie de cada
caso:
- el volumen contra su hora y contra las 20 anteriores;
- el rango en ATR;
- el medidor antes y en la vela.

## Lo que decidió el usuario y lo que se hizo (24/11)

El usuario aceptó las siete propuestas ("Sí, todas"). Van al **motor 7** del probador, sin commit, como lo de la
galería 1.

**El lector** (`backend/vpa.py` y el indicador `vpa.js`, iguales al bit):
- cada propuesta es un parámetro, con el valor nuevo de fábrica:
  - `nearBars` 20;
  - `skipAfterWide`, `testBox`, `testAfter` y `pullBack` encendidos;
  - `stopWick` [0.4, 0.6];
- con los valores de antes repite el motor 6. En BTC 4h, fase 1, salen los mismos 1,488 elementos;
- la caja de la prueba es la de la pestaña Régimen, operación por operación (`vpa.boxes`, igual a `er_box` con sus
  parámetros);
- dos códigos nuevos: QV (esfuerzo con resultado) y QG (el medidor gira);
- el medidor no cambia, y tampoco la ruptura sin volumen ni el cruce del umbral.

**Medido en BTC 4h, fase 1** (señales, con el lector de la app):

| Elemento | Motor 6 | Motor 7 |
|---|---|---|
| Esfuerzo sin resultado | 197 | 29 |
| Esfuerzo con resultado (nuevo) | — | 650 |
| Ruptura con volumen | 374 | 350 |
| Ruptura sin volumen | 11 | 11 |
| Retroceso sin volumen | 45 | 38 |
| Prueba de poco volumen | 430 | 10 |
| Frenado o techo | 75 | 30 |
| Clímax | 44 | 18 |
| Cruce del umbral del medidor | 244 | 244 |
| El medidor gira (nuevo) | — | 174 |

Coincide con el prototipo de las propuestas, elemento por elemento.

**También cambia:**
- **La salida VPA:** sus avisos "esfuerzo en contra" y "retroceso con volumen" leen los mismos grados que el esfuerzo sin
  resultado y el esfuerzo con resultado. El de "clímax o frenado" lee esos dos elementos;
- **el Observador:** su lectura del lector pasa a la versión 2, y las lecturas guardadas se vuelven a leer;
- **la ventana:** los dos elementos nuevos están en el probador, en la búsqueda y en el modal del Lector VPA. Vienen
  apagados en el gráfico, porque el esfuerzo con resultado sale en 1 de cada 12 velas;
- **el cuadro de cada vela** da el volumen contra su hora y contra las 20 anteriores.

**Corridas que quedan fuera:** las que usan uno de los elementos que cambiaron, o la salida VPA con alguno de esos
avisos. La ruptura sin volumen, el cruce del umbral y el filtro del medidor siguen valiendo.

**La galería:**
- los 8 elementos que cambiaron o son nuevos se corrieron con el motor 7 en la copia aislada
  (`galeria_corridas_m7.py 2`) y vuelven a la página 2 con 4 casos nuevos cada uno;
- **el cruce del medidor:** sus 4 casos de siempre se capturaron otra vez con el panel alto (O-37), y las imágenes de
  antes quedan como `_antes_O37`;
- la ruptura sin volumen y el cruce del medidor conservan sus marcas;
- todas las capturas nuevas llevan el panel del lector más alto y, al pie, sus cifras (`galeria_cifras.py m7`):
  - el volumen contra su hora y contra las 20 velas anteriores;
  - el medidor en la vela anterior y en la de la señal;
  - lo propio de cada elemento: las velas del frenado o del clímax con su mecha, la ruptura del retroceso, el frenado o
    clímax previo y la caja de la prueba, y el pico del medidor que gira.

**Para mirar en la galería:** el esfuerzo sin resultado 9 (17/04/21, 19:00) es una vela de 10 veces su rango normal con
20 veces el volumen. El lector la cuenta porque mide la proporción entre rango y volumen, no el tamaño de la vela. Lo
juzgó el usuario: ver la sección siguiente.

## El caso 2 del esfuerzo sin resultado (24/11, después)

**Lo que dijo el usuario:** la vela del 17/04/21 a las 19:00 sí tuvo resultado: se movió bastante y su cuerpo es grande.
Aunque tenga una mecha larga sigue siendo una vela grande, y las siguientes siguieron bajando. Es esfuerzo con resultado.

**Lo que se hizo** (parámetro `wideResult`, encendido de fábrica; apagado, la regla de antes):
- el esfuerzo sin resultado no cuenta si la vela misma es ancha. La medida es la misma de `skipAfterWide`: el rango
  contra su hora y contra las 20 velas anteriores, con la rampa de siempre (`spreadWide`). Deja de contar con más de 1.5
  veces lo normal en las dos;
- el esfuerzo con resultado es la vela ancha con volumen alto, a favor de su color. Ya no pide que el rango siga al
  volumen;
- en este paso el medidor no cambió: esa vela le seguía sumando como absorción, y por eso subía con una vela roja así
  (lo cambió el paso siguiente).

**Medido en BTC 4h, fase 1:**
- el esfuerzo sin resultado pasa de 29 a 25. Salen cuatro velas anchas:
  - 09/05/20 19:00: 12.5 veces su rango normal, con 33 veces su volumen;
  - la del 17/04/21;
  - 23/05/21 07:00 y 15/10/23 15:00: de 1.6 a 2.1 veces su rango normal;
- el caso 68 (Sí) sigue: su rango fue 1.26 veces el de su hora y 1.93 veces el de las 20 anteriores;
- el esfuerzo con resultado pasa de 650 a 1,066;
- las 416 velas que se suman siguieron más en su color que las de antes. A las 3 velas, 54% siguieron a favor y
  avanzaron +0.32 ATR en promedio, contra 47% y +0.11. Es una descripción, sin costos ni controles;
- los demás elementos no cambian. Con todos los valores de antes, los 1,488 elementos del motor 6;
- con las velas reales, el navegador y el backend dan los mismos 2,027 elementos.

**La galería** (`galeria_corridas_m7.py 2 QA QV`):
- el esfuerzo sin resultado y el esfuerzo con resultado se corrieron de nuevo: 21 y 305 trades;
- cada vela que ya era caso y sigue siendo trade conserva su clave, y con ella la marca del usuario:
  - del esfuerzo sin resultado, las del 06/10/20, el 23/08/22 y el 09/03/23;
  - del esfuerzo con resultado, las del 16/12/20, el 02/01/21 y el 08/11/22;
- los casos nuevos empiezan sin marca:
  - en el esfuerzo sin resultado, el del 18/01/22, en lugar del 17/04/21;
  - en el esfuerzo con resultado, la vela del 17/04/21, que ahora es suya. Como trade tocó su stop (−1.02 R): el
    precio rebotó a las pocas velas. El del 09/11/22 ya no es trade de la corrida: otra señal ocupaba la posición;
- las capturas de antes quedan en `G7_QA/antes_ancha` y `G7_QV/antes_ancha`.

Después el usuario pidió lo mismo para el medidor: ver la sección siguiente.

## El medidor también lee así la vela ancha (24/11, después)

**Lo que dijo el usuario:** «Sí, también el medidor».

**Lo que se hizo** (parámetro `wideMeter`, encendido de fábrica; apagado, el medidor de antes):
- en la vela ancha con volumen alto, la misma de los elementos, el medidor ya no suma el esfuerzo sin resultado,
  contra el color de la vela;
- le suma como esfuerzo con resultado, a favor de su color, con el grado del elemento;
- en las demás velas no cambia: sigue con lo normal de su hora.

**Medido en BTC 4h, fase 1:**
- cambia lo que suma al medidor en 529 de las 8,076 velas, todas anchas;
- el medidor cambia de lado (a favor, neutro o en contra, desde ±0.3) en el 6.4% de las velas. Pasa o deja de pasar el
  umbral de ±1 en el 2.4%;
- la vela del 17/04/21 subía el medidor de +0.28 a +0.72; ahora lo baja a −0.29;
- el cruce del umbral pasa de 244 a 247: 168 siguen, 76 salen y 79 entran. El giro pasa de 174 a 183;
- **el caso 75 del cruce** (tu «No») ya no es un cruce. En el desplome de junio de 2022 las velas rojas con mucho
  volumen subían el medidor, que llegó a +2.01; ahora está en −0.26;
- los demás elementos no cambian. Con todos los valores de antes, el medidor es el del motor 6;
- con las velas reales, el navegador y el backend dan los mismos 2,037 elementos.

**Corridas que quedan fuera, además:** las del cruce del umbral, las del filtro del medidor (también leído en un marco
mayor, como el ripple de la ruptura con volumen) y las de la salida VPA por el medidor. La primera vez, el Observador
vuelve a leer el lector de las órdenes.

**La galería:**
- el cruce del umbral y el giro se corrieron de nuevo: 147 y 122 trades. El cruce pasa al motor 7 (`G7_QE`);
- siguen, con tu marca:
  - los cruces del 19/10/20, el 28/10/22 y el 17/09/23;
  - los giros del 30/11/20 y el 25/09/21;
- entran sin marca:
  - el cruce del 18/06/22, en lugar del 75;
  - los giros del 27/01/22 y el 09/09/22, en lugar de los del 30/09/22 y el 02/05/23, que ya no giran;
- todos los casos del lector, también los de la ruptura sin volumen, se capturaron otra vez con el medidor nuevo en el
  panel y en sus cifras. Las capturas de antes quedan en `antes_medidor`.
