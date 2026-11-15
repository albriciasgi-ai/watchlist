# Fichas del entrenamiento

Una ficha por habilidad del gimnasio (mismo id que en `STAGES` de `gimnasio.html`). Al empezar una sesión se lee solo la ficha de la habilidad de hoy. Al usuario se le da lo que necesite, atado a su imagen, nunca la ficha entera sin pedirla.

Cada ficha: **Qué es** (una frase), **En tu herramienta** (la regla real y dónde se ve), **Mira** (qué hay en la imagen), **Errores típicos**, **Tus datos** (lo medido; lo que no está medido se dice).

Fuentes: `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` ("ORDER FLOW SOBRE LAS VELAS", "ELEMENTOS DE ORDER FLOW"), `12.AltagraciaTradingSuite/CLAUDE.md` (mapa, ladder, cinta, niveles, defensa, libro), `C:\Users\inven\OrderFlowData\research\orderflows_unlocked\` (`LEEME.md`, `CALIBRACION.md`) y los informes del price ladder en `reports/` del worktree `price-ladder-orderflow`.

## Lo que vale para todas

- **Venta y compra:** en tus footprints, la columna de venta es la venta agresiva (órdenes a mercado que golpean las compras) y la de compra la compra agresiva. Delta = compra − venta. Nadie "vendió" sin que alguien comprara: el delta dice quién tuvo prisa.
- **Los umbrales del libro no sirven tal cual en BTC.** Orderflows Unlocked usa ES y 6E en velas de 1 minuto. Con sus cifras literales, en BTC 15m el Exhaustion Print marcaba 44% de las velas y el Stacked 28-45%. Por eso App 1 calibra cada elemento con los 30 días anteriores para que marque cerca del 5% de las velas.
- **Nada está validado como señal.** El estudio de los 91 setups de Orderflows Unlocked en BTC no encontró uno robusto. Los elementos son ayudas de lectura: la razón para estar en un precio viene antes (zona), el flujo confirma.
- **El footprint confirma, no da la razón para entrar.** Sin zona, un elemento aislado dice muy poco.

---

## f1 · ¿Quién ganó la vela?

- **Qué es:** leer en las celdas si dominó la compra o la venta agresiva, antes de ver el número del delta.
- **En tu herramienta:** App 1, Order Flow. Entre 16 y 59 px por vela se ven celdas y perfil sin el delta; desde 60 px aparece el delta bajo la vela. Con Nítido, cada celda toma más color con más volumen y los desequilibrios van en negrita.
- **Mira:** dónde están las celdas más cargadas de cada columna y en qué parte de la vela. Una vela con la venta grande en la mitad baja y la compra grande arriba puede terminar casi en empate.
- **Errores típicos:** juzgar por el color de la vela; contar celdas en vez de pesarlas (dos celdas enormes valen más que diez chicas); olvidar los extremos, donde suele haber mucho volumen.
- **Tus datos:** `verificar.py` da el delta exacto. Ejemplo real: BTC 15m del 14/11 a las 05:15, vela verde con delta −8.0 (venta ganó).

## f2 · Delta contra el color

- **Qué es:** velas que cierran a un lado (verde o roja) con el delta del lado contrario: "Price Action Divergence" en el libro.
- **En tu herramienta:** con menos de 16 px por vela, un rombo marca la vela cuyo delta va contra su color y pesa al menos el 20% de su volumen (`deltaMarkMinShare`). En Elementos OF es PD, con umbral relativo.
- **Mira:** velas verdes donde la columna de venta domina, o rojas donde domina la compra. Suele verse en mechas largas: el precio cerró lejos de donde se negoció la presión.
- **Errores típicos:** marcar cualquier delta contrario pequeño (el rombo pide 20% del volumen); leerlo como señal de giro: muchas veces es absorción que sigue, no giro.
- **Tus datos:** con la regla literal (≥20%) marca del 2% al 5% de las velas de BTC 15m según el año (2022-2026). No se midió si anticipa giros.

## f3 · Stacked: ¿la franja aguanta?

- **Qué es:** tres o más desequilibrios seguidos del mismo lado (ratio 3x o más). La idea del libro: donde un lado empujó con fuerza, al volver el precio, ese lado defiende.
- **En tu herramienta:** imbalance = mismo nivel (o diagonal si así está en el modal), ratio 3 o más, los dos lados con volumen. Stacked = 3 niveles seguidos. Con zoom, cada stacked deja una franja hacia la derecha ("Largo" del modal, 3 velas) con borde arriba y abajo; con poco zoom, una línea.
- **Mira:** si el stacked va a favor del movimiento (compra en una subida) y si el precio vuelve a él pronto o tarde. Un stacked en la mitad de una vela grande no es lo mismo que uno en su base.
- **Errores típicos:** tratar todos los stacked igual; olvidar que con los filtros de vela y celda (en %) del modal cambian cuántos ves.
- **Tus datos:** con la regla literal del libro (diagonal 4x) marcaba 28-45% de las velas de BTC 15m: es muy frecuente. Con el filtro de volumen de la vela (2 veces la mediana) baja a 11.7% en 15m. No se midió si la franja aguanta más que un precio al azar: esta habilidad junta esos casos.

## e1 · Encuentra el Exhaustion Print (EX)

- **Qué es:** en el extremo donde empieza la vela (mínimo en una verde, máximo en una roja), el lado pasivo casi en cero: nadie quiso seguir del otro lado.
- **En tu herramienta:** Elementos OF, código EX, franja. Umbral relativo: con el libro (≤6% del nivel promedio) marcaba 44% en 2026; calibrado queda en ≤0.15-0.2% del nivel promedio, casi un cero, cerca del 5% de las velas.
- **Mira:** las dos o tres celdas del extremo de inicio. Un número muy chico en el lado pasivo, al lado de uno normal en el agresivo.
- **Errores típicos:** mirar la mecha más larga en vez del extremo donde empieza la vela; confundirlo con Zero Print (ZP: un 0 exacto en una de las dos celdas del extremo).
- **Tus datos:** calibrado para marcar ~5% de las velas. Sin medición de qué hace el precio después.

## e2 · ¿Giro o sigue?

- **Qué es:** anticipar si una marca de giro (EX Exhaustion Print, DT Delta Tail, DD Delta Divergence, AD Acumulación/Distribución) termina en giro en las 3 velas siguientes.
- **En tu herramienta:**
  - DT: delta contrario en el extremo y a favor en el resto de la vela (raro, ~1%).
  - DD: extremo de 5 velas con delta a favor del color (~7-8% de las velas, regla literal).
  - AD: la celda más grande está del lado contrario y en el tercio del inicio.
  - Se conocen al cerrar la vela (la VA abandonada, en la siguiente).
- **Mira:** dónde aparece la marca. En una zona tuya (perfil de ayer, FVG, nivel) tiene una historia; en medio de la nada, poca.
- **Errores típicos:** juzgar el elemento por uno o dos casos; olvidar el contexto de 1h y 4h (contra una tendencia fuerte casi todo "falla").
- **Tus datos:** el estudio de los 91 setups no encontró ninguno robusto. Con 20 casos por código ya ves cuál te dice algo **a ti**; con 60 se puede comparar con el 50%.

## e3 · Barridos y órdenes grandes

- **Qué es:** franjas donde una orden agresiva cruzó varios precios de una vez (barrido) o fue muy grande.
- **En tu herramienta:** Elementos OF con el almacén de flujo:
  - BR barrido real: la mayor orden de la vela que cruzó 3 precios o más, con USD sobre el umbral relativo;
  - GR orden grande: la mayor orden de la vela, con USD sobre su umbral;
  - SW Market Sweep: racha de niveles sin contrapartida en el footprint.
  - Del 07/12/2021 al 19/12/2022 no hay órdenes (Bybit dio la hora en segundos).
- **Mira:** si la franja quedó en el extremo de la vela (alguien persiguió el precio) o en el medio, y si el precio volvió a ella.
- **Errores típicos:** suponer que una orden grande es alguien entrando: puede ser un cierre o una liquidación.
- **Tus datos:** BR y GR marcan ~5% de las velas de BTC (15m y 1h). Si el precio vuelve a la franja no se midió.

## b1 · Mapa: ¿rebota o cruza?

- **Qué es:** ver dónde espera la liquidez grande en el libro y si el precio reacciona al llegar.
- **En tu herramienta:** suite, pestaña Mapa. Cubos de ~0.03% del precio (BTC 20 USD). "Compra y venta": azul la compra, naranja la venta. "Solo la sostenida": el menor promedio de los últimos N minutos; si falta un minuto, la vela queda en blanco. "Solo lo grande" deja transparente lo de menos.
- **Mira:** el lado de la franja (azul debajo del precio, naranja encima) y cuánto lleva: una franja que aparece en el último minuto no es sostenida.
- **Errores típicos:** leer el mapa de "Una escala" (suma los dos lados: así pasó con BTC en 65,500 el 14/11, donde las compras se fueron a las 10:19 y aparecieron ventas en el mismo precio); confundir un hueco de grabación con falta de liquidez.
- **Tus datos:** primera lectura del libro (5 horas, 8 monedas): la liquidez es joven, antigüedad mediana de 7 a 8.5 minutos, y solo 9-11% estuvo toda la hora anterior. Nada concluyente.

## b2 · Ladder: ¿se queda o se retira?

- **Qué es:** mirar, precio por precio, lo que espera y lo que se agrega o retira, para anticipar si un muro estará cuando llegue el precio.
- **En tu herramienta:** suite, Ladder a la derecha del mapa. Columnas: Δ compra (agregado o retirado en 5 s), compra en espera, precio, venta en espera, Δ venta, y lo negociado en la ventana. En negrita, lo que pasa el percentil 95 de lo que espera a la vista.
- **Mira:** la columna Δ junto al muro mientras el precio se acerca. Rojo repetido = se está retirando.
- **Errores típicos:** dar por real un muro lejano: lo normal es que se cancele.
- **Tus datos:** del 97.6% al 99.8% de lo que sale del libro de Bybit cerca del precio se cancela; en acciones de EE. UU. también se cancela ~97%. Es market making normal, no necesariamente engaño. Retirarse lejos del precio es lo normal; lo que interesa es el retiro cerca (ver b4).

## b3 · Cinta: ¿la orden grande mueve?

- **Qué es:** las órdenes a mercado grandes, con los trades del mismo instante y lado juntos (como el Smart Tape de ATAS).
- **En tu herramienta:** suite, Cinta a la derecha del ladder. Mínimo automático = el 1% más grande de 30 minutos (en BTC, unos 38.8k USD al medirlo), o fijo. En negrita las de 3 veces el mínimo. Un rango de precios = barrido. Arriba, compra contra venta de 30 s. Clic en una fila = línea en el gráfico; "Dejar en firme" la guarda.
- **Mira:** si es barrido (rango) o un solo precio, y si llegan varias del mismo lado seguidas.
- **Errores típicos:** reaccionar a una sola orden; olvidar que puede ser un cierre o una liquidación.
- **Tus datos:** no se midió si mueve el precio. Esta habilidad junta esos casos.

## b4 · Defensa: ¿qué letra saldrá?

- **Qué es:** qué hizo la liquidez cuando el precio llegó a una zona tuya.
- **En tu herramienta:** suite, Capas → Defensa de zona. Zonas: tus líneas (±0.05%) y rectángulos, más POC/VAH/VAL de ayer, FVG de 1h y niveles del journal. Una visita empieza tras estar 1/4 de ATR de 15m lejos; aguanta si se aleja 1/2 ATR antes de pasarla por 1/4 ATR. Letras:
  - D defensa: aguanta con al menos la mitad de la liquidez;
  - A absorción: aguanta, la liquidez se queda y se negocia al menos lo que se veía;
  - B barrido: la perfora y vuelve;
  - R retiro y rebote: se retira la mitad o más y aun así aguanta;
  - X retiro y cruce: se retira y el precio pasa (lo esperable de un muro falso);
  - C consumida: la liquidez se queda, se negocia y el precio pasa.
- **Mira:** el estado antes de que llegue: "15× lo de hace 30 min" o "nueva de este lado".
- **Errores típicos:** usar la letra para entrar: se conoce tarde, cuando la visita se resuelve.
- **Tus datos:** primera lectura (pocas horas): tus zonas aguantaron 65.5% contra 57.4% del azar, +8 puntos con margen de −5.8 a +21.8 (no concluyente). En el 20% más cargado de tus zonas, 9 de cada 10 visitas fueron defensa (azar 59%). Caso real: la línea de 65,500 de BTC el 14/11, D a las 10:15, C a las 10:18 (12.6M negociados contra la compra) y después resistencia defendida.

## b5 · Libro delgado: ¿se mueve más?

- **Qué es:** poca liquidez cerca del precio: se puede mover con poco.
- **En tu herramienta:** Elementos OF, LD. En la vela, lo que espera a 0.25% del precio (compra debajo más venta encima) queda bajo el percentil 5 de las velas de las 24 horas anteriores. Celdas en el lado más delgado: alcista si son las ventas, bajista si son las compras.
- **Mira:** el lado marcado y si coincide con un retiro reciente (Niveles: "retiro cerca") o con una orden grande en la cinta.
- **Errores típicos:** leerlo como dirección: dice dónde hay menos resistencia, no hacia dónde irá el precio. En fin de semana se junta (el libro del sábado es más delgado que el del viernes y el umbral sale del día anterior).
- **Tus datos:** en 5m, 24 horas del 14/11: BTC 31 de 288 velas, ETH 42, SOL 46. No se midió si la vela siguiente tiene más rango.

## c1 · Zona primero, flujo después

- **Qué es:** el proceso completo: una razón para estar en el precio (zona) y el flujo como confirmación.
- **En tu herramienta:** App 1 con órdenes desde la caja TP/SL. Lo elegido en "Incluir en el análisis" va con la orden al Observador. El Observador guarda 58 medidas de cada orden y el informe compara ganadoras con perdedoras y entradas con momentos sin entrada. Las limit se llenan solo si el precio pasa más allá de su precio.
- **Mira:** que la zona estuviera antes de entrar (dibujada o automática), y qué 1 o 2 elementos te convencieron.
- **Errores típicos:** entrar porque apareció un elemento sin zona; mover el stop; juzgar el proceso por el resultado de un trade.
- **Tus datos:** con menos de 30 órdenes el informe solo describe. Cada 20, abre el informe del Observador.

## c2 · Mezcla

- **Qué es:** alternar 3 habilidades ya dominadas en una sesión.
- **En tu herramienta:** las mismas de cada habilidad.
- **Mira:** primero decide qué tipo de caso es, después léelo.
- **Errores típicos:** desanimarse porque baja el %: mezclar cuesta más y por eso sirve. Si una falla mucho, vuelve a ella sola un día.
- **Tus datos:** la investigación de aprendizaje dice que mezclar rinde menos al practicar pero más después, comparado con practicar por bloques.

## d1 · Un trade, bien hecho

- **Qué es:** llevar el proceso a la cuenta Demo, con dinero simulado pero ejecución real de Bybit.
- **En tu herramienta:** suite, panel de trading con la cuenta Demo. Toma la caja TP/SL (también la que dibuja el ladder), siempre con stop y objetivo, y pide confirmación. El journal guarda la decisión con lo elegido, las imágenes de apertura y cierre, y "10 velas después". El análisis post-trade dibuja en una capa del trade y guarda una imagen con su conclusión.
- **Mira:** que la cuenta diga DEMO antes de enviar, y que lo elegido esté en la lista del panel.
- **Errores típicos:** subir el tamaño tras ganar; dejar el análisis post-trade para después.
- **Tus datos:** el informe del journal compara ganadoras y perdedoras en cada medida (también las del libro y la regla del laboratorio). Con pocas operaciones, solo describe.
