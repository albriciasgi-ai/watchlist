# Galería 4 · Order flow: lo que marcó el usuario y qué hacer

El usuario revisó la galería 4 (26/11/2026): **Sí 96 · No 14 · No sé 14** de 124 casos. Sus marcas, tal como las
copió, están en `OrderFlowData/research/pruebas_backtesting/2026-11-21/evidencia/etapa7/galeria_marcas_4.txt`.

Cada No y No sé se revisó con las celdas de su vela: `of_elements` sobre el almacén, con scripts del scratchpad de la
sesión (`g4_casos.py`, `g4_filas.py`, `g4_og.py`, `g4_dt.py` y `g4_rd593.py`). Las propuestas se midieron en BTC 15m,
fase 1 (132,244 velas, del 25/04/2020 al 31/12/2023), con `backend/tests/audit/medir_galeria4.py`,
`medir_galeria4_dt.py` y `medir_galeria4_imb.py`. Todo es solo lectura.

## 1. Lo que era de las imágenes (corregido; esos casos se vuelven a mirar)

| Elemento | Marca | Qué pasaba | Arreglo |
|---|---|---|---|
| Barrido real (4) y Orden grande (4) | No sé: «no se ve el footprint» | El footprint estaba, pero esas velas tienen cientos de celdas y sin imagen de cerca no se leen las cifras | Imagen de cerca con las cifras y un marco en el precio de la orden (`galeria_of.CLOSE_UP`) |
| Thin Print 3823 | No: «se ven balanceados» | El marco iba de la primera a la última de sus tres celdas y tomaba 15 celdas parejas de en medio. Las suyas son 28162 (4.75 \| 0), 28160 (6.76 \| 0) y 28128 (7.95 \| 0): venta sin compra | Un marco por celda (`opts.of.zones` acepta varias) |
| Imbalance Reload 593 y 2072 | Sí, con nota: el marco tomaba celdas que no son de la recarga | El elemento es una franja de la primera a la última celda compartida con la vela anterior | Un marco por celda compartida (`galeria_of.shared_rows`) |

Los 16 casos (barrido real, orden grande, Thin Print e Imbalance Reload) se capturaron otra vez el 26/11 y conservan
su clave: hay que volver a mirarlos.

**La recarga 593, celda por celda.** El usuario vio el desequilibrio solo en el 18.0 y el 8.5. La app cuenta cinco
celdas: en las dos velas, la venta (el agresor de una roja) contra la compra del nivel de arriba, de 4 a 1 o más.

| Celda | Vela anterior | Vela de la señal |
|---|---|---|
| 22580-22582 | 8.13 contra 0.06 | 8.46 contra 0 |
| 22584-22586 | 2.00 contra 0.04 | 17.98 contra 0 |
| 22616-22618 | 2.37 contra 0 | 0.48 contra 0.09 |
| 22620-22622 | 4.48 contra 0 | 1.35 contra 0.19 |
| 22628-22630 | 0.48 contra 0 | 9.64 contra 1.28 |

- Las tres de arriba cuentan porque el mínimo de un desequilibrio es bajo: el 5% del nivel medio de la vela, unos 0.25
  BTC aquí (`of_elements.MIN_IMB`).
- El footprint no marca uno frente a una celda vacía (el 18.0 y el 8.5); el detector sí (E-10). Pintarlos
  (`imbalanceCountZero`) llena el gráfico de franjas de apilados, así que se descartó (probado el 26/11): basta con el
  marco de cada celda.
- En la 22628 el footprint marca la compra (18.7 contra casi nada abajo) y no la venta (9.6 contra 1.3): en una celda
  con desequilibrio de los dos lados marca solo el mayor. El detector mira solo el lado del color.

En la recarga 2072 el footprint tampoco marca las suyas: en la vela de la señal, las tres van contra una celda vacía
(7.2, 6.5 y 6.1 BTC).

En la app, la franja del Imbalance Reload también va de la primera a la última celda compartida. Va como propuesta 9.

## 2. Propuestas para el motor 8 (las decide el usuario)

Señales en BTC 15m, fase 1: las de hoy, las que daría la propuesta y cuántas de hoy siguen.

| # | Elemento | Lo que vio el usuario | Qué hace la app | Propuesta | Señales: hoy · propuesta · siguen | Sus casos |
|---|---|---|---|---|---|---|
| 1 | Exhaustion Print | 623 y 1037, No: «debe ubicarse en la mecha superior porque el precio va subiendo» | Mira el extremo donde empieza la vela (el mínimo de una verde) | Si la vela hace el máximo de 5 velas, mira arriba: compradores agotados, señal bajista. Si hace el mínimo, mira abajo: vendedores agotados, alcista. Si no hace ninguno, como hoy | 6,502 · 6,452 · 3,362 (es relativo: el umbral deja cerca del 5%) | Los 4 quedan como los marcó |
| 2 | Volume Decline | 157, No: «por ir bajando la tendencia, deberían analizarse en la parte de abajo» | Igual que el Exhaustion Print | La misma regla del extremo | 17,766 · 20,565 · 13,584 (sin el filtro de volumen) | Los 4 |
| 3 | Delta Tail | 29 y 43, No: falta la mecha. 127, No: el delta de la cola es chico. 113 y la vela de su derecha, Sí. La vela de la izquierda de la 127, «mejor» | Delta en contra del color en la celda del extremo y todas las demás a favor, sin mirar la mecha | Pedir mecha (20% del rango) y delta en la cola (10% del nivel medio); otra opción abajo | 1,720 · 284 · 284 | Los 4 (no toma las dos velas vecinas que señaló) |
| 4 | Delta Divergence | 1533, No: «al ocurrir en un high debería ser vela roja y con delta negativo» | Verde en el mínimo de 5 con delta positivo, o roja en el máximo con delta negativo. La 1533 hizo el máximo y el mínimo a la vez: envolvió las cuatro anteriores, y la app la tomó por el mínimo | Una vela que hace el máximo y el mínimo de 5 a la vez no cuenta | 10,542 · 9,655 · 9,655 | Los 4 |
| 5 | Inverse Imbalance | 2134, No: «el cuerpo debe ir a favor de donde apuntan los desequilibrios»; tenía 84% de mecha arriba y cerró al 16% de su rango | Desequilibrios del lado contrario en la mitad lejana, sin mirar el cierre | El cierre en la mitad del rango hacia la señal | 19,674 · 15,943 · 15,943 | Los 4 (cierres al 76%, 40% y 28%, del lado de su señal) |
| 6 | Orderflows Sequencing | 1, No: «los primeros 3 niveles están en 0». 1044 y 1566, No: «las ventas en cada nivel superan las compras» | Cuenta niveles donde el agresor crece, aunque sea de milésimas y aunque el otro lado gane | En cada nivel de la secuencia el agresor crece, le gana al lado contrario y tiene al menos el 5% del nivel medio | 6,221 · 354 · 309 | Salen los tres No. Sale también la 697, que marcó Sí: es una roja, y en sus dos primeros niveles casi no hay ventas (0 y 0.07) contra 2.8 y 11.2 de compras |
| 7 | Vertical Liquidity | 3072, No sé: «la mitad de los niveles están parejos» | Racha de niveles con el agresor en el 10% mayor de 30 días, sin mirar el otro lado | En cada nivel de la racha el agresor le gana al lado contrario | 10,114 · 10,177 · 8,042 (relativo) | En la 3072 la racha baja de 8 niveles a 3. Las tres Sí quedan con su racha entera |
| 8 | Acumulación/Distribución | 2332, Sí con nota: «la diferencia entre compradores y vendedores en ese nivel debe ser mayor» | La celda pasiva mayor, en el primer tercio, sin mirar su lado agresor | En ese nivel, el lado pasivo al menos 2 veces el agresor | 6,275 · 5,498 · 5,498 | La 2332 (1.6 veces) sale; las otras tres (6, 23 y 3,956 veces) siguen |
| 9 | Imbalance Reload | 593 y 2072, Sí con nota | Una franja de la primera a la última celda compartida | Una franja por celda compartida | No cambia las señales ni la zona del probador, que junta las celdas de la vela: cambia el dibujo (corregido el 26/11; antes decía que cambiaba la zona) | — |
| 10 | Absorción (propuesta propia) | 528 y 1583, No: «hay que mirar varias velas», «se debe abrir en contra del impulso». 2110 y 2374, Sí: «faltaría esperar varios intentos» | Una celda muy grande con 40% o más del lado pasivo, en una vela, a favor del color | Rehacerla como la describe el usuario: definición abajo, para confirmar antes de programarla | — | — |
| 11 | Ratio de extremos | Los 4, No sé: «lo podemos eliminar de la lista, no veo su utilidad» | — | Quitarlo de las listas: indicador, probador, barrido y búsqueda. El código queda, para abrir las corridas guardadas | — | — |

### Delta Tail (propuesta 3)

Hoy la regla mira solo la celda del extremo donde empieza la vela: delta en contra del color ahí y todas las demás a
favor. No pide mecha.

| Caso | Marca | Mecha | Celda del extremo, en contra | Mecha entera, delta | Cuerpo, delta | Hoy | A | B |
|---|---|---|---|---|---|---|---|---|
| 29 | No | 0% | 487% del nivel medio | −10.7 | +35.1 | sí | no | no |
| 43 | No | 2% | 7% | −2.9 | +137.2 | sí | no | no |
| 113 | Sí | 58% | 23% | +33.9 | +46.8 | sí | sí | sí |
| 127 | No | 45% | 6% | +60.7 | +73.2 | sí | no | no |
| Derecha de la 113: «también estaría bien» | — | 80% | 2% | −87.5 | +97.9 | no | no | sí |
| Izquierda de la 127: «está mejor» | — | 61% | 15% | +7.5 | +72.7 | no | no | sí |

- **A (la propuesta):** como hoy, más una mecha de al menos el 20% del rango en ese extremo y el delta en contra de su
  celda de al menos el 10% del nivel medio. **1,720 señales → 284**, todas de las de hoy. Respeta los cuatro casos
  marcados, pero no toma las dos velas que el usuario señaló como buenas: en cada una, alguna otra celda va en contra.
- **B (opción):** sin pedir que todas las demás celdas vayan a favor. Basta la mecha de al menos el 20%, el cuerpo con
  delta a favor y la mecha con delta en contra: en su celda del extremo (10% del nivel medio) o sumada entera. Toma
  las seis como las ve el usuario, pero así sola da **43,349 señales**, un tercio de las velas. Le falta un umbral
  sobre cuánto delta en contra lleva la mecha, por ejemplo el 5% mayor de 30 días, como los elementos relativos. Se
  mide si el usuario elige esta.

### Absorción en varias velas (propuesta 10, por confirmar)

Es la idea del usuario: una barrera que aguanta varios intentos, y la señal en contra de esos intentos.

- **Intento:** una vela llega a un nivel con mucho volumen agresivo en esa celda y no cierra más allá. Mucho volumen
  es el 5% mayor de las celdas de los 30 días anteriores. El volumen agresivo es la compra si llega desde abajo y la
  venta si llega desde arriba.
- **Absorción:** dos o más intentos al mismo nivel (con una celda de margen) en 10 velas, sin un cierre más allá.
- **Señal:** al cerrar el segundo intento, en contra de los intentos: bajista si compraban contra el nivel.
- **Se cancela** si una vela cierra más allá del nivel.

## 3. Notas que no cambian nada por ahora

- **Un desequilibrio más grande (medido, no se propone):** si el lado dominante tuviera que llegar a una parte mayor
  del nivel medio de la vela (hoy, el 5%), la recarga 593 quedaría más cerca de lo que vio el usuario. Pero salen
  casos que marcó Sí, y ningún valor deja solo el 18.0 y el 8.5: en la vela anterior, el 22584 tiene 2.00 BTC.
  Medido en BTC 15m, fase 1 (`medir_galeria4_imb.py`):

  | Mínimo | Apilados | Volume Imbalance | Reversal | Inverso | Recarga | Lo que pasa con los casos |
  |---|---|---|---|---|---|---|
  | 5% (hoy) | 17,038 | 23,279 | 11,648 | 19,674 | 8,580 | — |
  | 25% | 12,131 | 22,604 | 7,808 | 15,068 | 6,335 | la 593 queda con 3 celdas y la 2072 con 2; salen el apilado 3090, el Reversal 1978, la recarga 3255 y el inverso 2134 (este, un No) |
  | 50% | 7,613 | 21,198 | 5,084 | 10,666 | 4,149 | la 593 queda con 1 celda; salen además la 2072, la 2368 y los inversos 915 y 3048 |
  | 100% | 3,122 | 16,755 | 2,433 | 5,553 | 1,693 | salen 13 de los 20 casos de estos cinco elementos |

- **Zero Print 2513 (No sé):** la vela tenía 92% de mecha arriba y cerró al 8% de su rango. Pedir el cierre en su mitad
  la sacaría, pero también saca la 1676, que el usuario marcó Sí (una roja que cerró al 58%). No se propone.
- **Small Min/Max Delta 2800 (idea del usuario):** leer la dirección con la forma de la vela y el POC. Un Máx Δ enorme
  con mecha larga arriba y cierre bajo el POC es bajista. Es otra regla: se puede probar aparte como elemento nuevo.
- **Exhaustion Print 1866:** «mejor si varias velas cercanas del mismo color lo tienen». Sería una confluencia de
  varias velas, otra regla.
- **Orderflows Gap, preguntas del usuario:**
  - En el caso 3 (2361), la vela roja de las 10:15 de Colombia sí pasó el umbral (0.66 ATR contra 0.58) y la app la
    marca como otro Orderflows Gap. La imagen enmarca solo la señal de su trade.
  - En los casos 1 y 2, la app entra donde dice el usuario: la señal se conoce al cerrar la vela del hueco, y se entra
    en la apertura de la siguiente.
- **Inverse Imbalance 306 (cómo distinguirlo de los apilados):**
  - los apilados son desequilibrios del lado del color de la vela, tres o más seguidos. En la app son una franja que
    sigue a la derecha;
  - el inverso son desequilibrios del lado contrario, dos o más seguidos, en la mitad de la vela donde termina. En la
    app se marcan sus celdas.

## 4. Si se aplican

- Un **motor 8** del probador. Quedan fuera solo las corridas que usan un elemento que cambió.
- **El indicador Elementos OF de App 1 y de la suite** cambia igual, porque usa `of_elements`.
- **Los casos de esos elementos se vuelven a capturar.** Los que ya eran caso conservan su clave y la marca del usuario.

## 5. Lo que decidió el usuario y lo que se hizo (26/11)

**«Todas pero Delta Tail B. Absorción como dices, pero que se pueda ver en hasta 50 velas y que sea configurable por el
usuario».** Van en el **motor 8** del probador, en `of_elements.py`. No hay una copia en la página: el indicador
Elementos OF de App 1 y el de la suite piden los eventos al backend.

- **Delta Tail B, con su umbral medido** (`tests/audit/medir_galeria4_dtb.py`). B sola marcaba un tercio de las velas;
  un umbral relativo (el 5% mayor) sacaba la 113 y la vela izquierda de la 127, que el usuario quiere. Queda **la mecha
  donde empieza la vela, al menos la mitad de su rango**, con el cuerpo a favor y la mecha en contra: 14,540 señales
  (11% de las velas), y sus seis casos quedan como los ve el usuario.

  | B con | Señales | 29 · 43 · 113 · 127 · derecha de la 113 · izquierda de la 127 |
  |---|---|---|
  | sola (mecha del 20%) | 43,349 (33.5%) | no · no · sí · no · sí · sí |
  | mecha de la mitad o más | 14,540 (11.3%) | no · no · sí · no · sí · sí |
  | mecha del 55% o más | 11,259 (8.7%) | no · no · sí · no · sí · sí |
  | el delta en contra, el 5% mayor | 6,609 (5.1%) | no · no · no · no · no · no |

- **Absorción:** como la definición de arriba, con una precisión para que dé lo mismo pedida de una vez o por tramos:
  la señal es la vela que intenta en un nivel donde ya hubo otro intento en las velas anteriores (sin un cierre más
  allá entre los dos), y **cada intento más vuelve a dar la señal**. Las velas del segundo intento: **10 de fábrica, de
  1 a 50**, en el modal de Elementos OF («Absorción: segundo intento en (velas)») y en el probador (sección Detección,
  con la absorción en la regla). Solo entran a la regla con la absorción y si no son 10, así las demás reglas conservan
  su identidad.
- **Imbalance Reload:** la corrección de la propuesta 9 (arriba): el probador ya juntaba las celdas de la vela, así que
  sus corridas no cambian.
- **Ratio de extremos:** fuera del modal, del probador y del barrido; un ajuste guardado con él encendido ya no lo
  dibuja. El código queda para abrir las corridas guardadas.

**Señales en BTC 15m, fase 1** (`tests/audit/medir_motor8.py`; el motor 7, del caché de la fase de la copia aislada):

| Elemento | Motor 7 | Motor 8 |
|---|---|---|
| Exhaustion Print | 6,597 | 6,552 |
| Volume Decline | 3,774 | 4,920 |
| Delta Tail | 1,720 | 14,540 |
| Delta Divergence | 10,542 | 9,655 |
| Inverse Imbalance | 19,674 | 15,943 |
| Orderflows Sequencing | 6,221 | 354 |
| Vertical Liquidity | 10,228 | 10,264 |
| Acumulación/Distribución | 6,365 | 5,573 |
| Absorción | 8,841 (la de una vela) | 4,020 con 10 velas; 5,078 con 50 |
| Imbalance Reload | 8,580 velas | las mismas 8,580 velas, en 23,515 franjas |

Ningún otro elemento cambió.

**Corridas que quedan fuera con el motor 8:** solo las que usan uno de los nueve que cambiaron (`_touched_by_engine8`).
Las de la recarga y del ratio no. El caché de los elementos de cada fase se vuelve a armar (`SPAN_VERSION` 3; BTC 15m,
fase 1, unos 4 minutos la primera vez).

**Pruebas:** `test_motor8.py` (13), una más en `test_of_elements.py` (la recarga por celda, el Delta Divergence y el
Inverse Imbalance sobre un almacén sintético) y en `test_signal_sweep.py`; en la página, `ofelements.test.mjs` (10),
`ruletester.test.mjs` y `rulefacets.test.mjs` (16); en la suite, `run_checks.py` (48). Todas las del backend: fallan solo
las 13 de siempre (las 2 de siempre y las 11 del oráculo A con los casos de B).

**La galería:** los nueve se corrieron otra vez en la copia aislada (`tests/audit/galeria_corridas_m8.py`) y se
capturaron en `G8_<código>` (`galeria_of.py cola8` y `cifras8`), con el footprint en las celdas del elemento y la imagen
de cerca; en la absorción, un marco en la celda de cada intento y la imagen de cerca desde el primero. Las velas que ya
eran caso y siguen siendo trade conservan su clave y la marca del usuario; las demás llevan claves nuevas. Con una
posición a la vez, una señal que sigue puede no ser trade (la 113 del Delta Tail no lo es en la corrida nueva). El ratio
de extremos sale de la página 4.

La página 4 quedó con **120 casos**. De los 36 de esos nueve elementos, **14 conservan la marca del usuario**:

| Elemento | Conservan la marca |
|---|---|
| Exhaustion Print | EX-10 y EX-2 |
| Volume Decline | VD-8 |
| Delta Divergence | DD-10, DD-3 y DD-9 |
| Inverse Imbalance | IV-11 y IV-4 |
| Vertical Liquidity | VL-10, VL-3 y VL-7 |
| Acumulación/Distribución | AD-10, AD-4 y AD-5 |

Los otros **22 son nuevos**, sin marca, entre ellos los cuatro del Delta Tail, del Sequencing y de la absorción.
