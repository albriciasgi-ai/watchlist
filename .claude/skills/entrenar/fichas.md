# Fichas del entrenamiento

Una ficha por habilidad del gimnasio (mismo id que en `STAGES` de `gimnasio.html`). Al empezar una sesión se lee solo la ficha de la habilidad de hoy. Al usuario se le da lo que necesite, atado a su imagen, nunca la ficha entera sin pedirla.

Cada ficha: **Qué es** (una frase), **En tu herramienta** (la regla real y dónde se ve), **Mira** (qué hay en la imagen), **Errores típicos**, **Tus datos** (lo medido; lo que no está medido se dice).

Fuentes: `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` ("ORDER FLOW SOBRE LAS VELAS", "ELEMENTOS DE ORDER FLOW", "LECTOR VPA"), la guía `1.Altagracia_Crypto_Backtester/Backtester/GUIA_VPA.pdf`, `12.AltagraciaTradingSuite/CLAUDE.md` (mapa, ladder, cinta, niveles, defensa, libro), `C:\Users\inven\OrderFlowData\research\orderflows_unlocked\` (`LEEME.md`, `CALIBRACION.md`) y los informes del price ladder en `reports/` del worktree `price-ladder-orderflow`.

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

## Familias de Elementos OF (z1, z2, e1, e2, n1, e3, t1, b6)

Desde el 16/11 la etapa 2 va por familias, como las agrupa el modal de Elementos OF: zonas, giro, continuación y tabla de la vela; el libro (AB, BL, LD) está en la etapa 3. Las de **reconocer** tienen un **código de hoy** que rota con cada sesión anotada (`codes[n.º de sesiones de la habilidad % largo]`) y se guarda en la sesión (`code`). Las de **anticipar** usan el código de hoy como el elemento en el que fijarse. Qué es cada código, en "Códigos" al final; la regla completa y lo medido, en `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md`, "ELEMENTOS DE ORDER FLOW".

- **Lo común:** son ayudas de lectura, calibradas para marcar cerca del 5% de las velas con los 30 días anteriores (umbrales relativos); con menos de 100 velas de historia solo salen los literales. Solo velas cerradas. Los "vol." solo aparecen en velas con volumen ≥ 2 veces la mediana de las 20 anteriores y vienen apagados de fábrica.
- **Tus datos:** el estudio de los 91 setups de Orderflows Unlocked en BTC no encontró uno robusto. Ningún código está medido contra el azar como señal.

## z1 · Zonas: encuentra el elemento

- **Qué es:** reconocer dónde quedan zonas del footprint: VA, OG, AP, SL, OP y RL.
- **En tu herramienta:** franjas que siguen hasta que el precio vuelve. La VA abandonada se conoce al cerrar la vela siguiente.
- **Mira:** el área de valor (el 70% del volumen alrededor del POC) y el POC de cada vela, comparados con los de la vela de al lado.
- **Errores típicos:** buscarla en la vela en curso; confundir el POC de la vela con el del perfil del día.
- **Tus datos:** sin medición de qué hace el precio al volver.

## z2 · Zonas: ¿el precio la respeta?

- **Qué es:** anticipar si una franja de zona aguanta cuando el precio vuelve.
- **Mira:** si la franja es reciente, a favor de la tendencia de 1h, y si coincide con otra zona tuya (perfil, FVG, nivel).
- **Errores típicos:** dar el mismo peso a una franja de hace días que a una de hace una hora.
- **Tus datos:** no medido; esta habilidad junta esos casos.

## e1 · Giro: encuentra el elemento

- **Qué es:** reconocer los elementos de giro: EX, ZP, DT, RS, DD, PD, AD, IV e IR.
- **En tu herramienta:** casi todos miran el extremo donde empieza la vela (mínimo en una verde, máximo en una roja). EX: con el libro (≤6% del nivel promedio) marcaba 44% de las velas de BTC 15m en 2026; calibrado queda en un casi cero, cerca del 5%. DD: extremo de 5 velas con delta a favor del color, ~7-8% de las velas (literal). PD: delta contra el color, 2-5%. DT es raro (~1%).
- **Mira:** las dos o tres celdas del extremo de inicio y el delta de la vela.
- **Errores típicos:** mirar la mecha más larga en vez del extremo donde empieza la vela; confundir EX con ZP (un 0 exacto en una de las dos celdas del extremo).

## e2 · ¿Giro o sigue?

- **Qué es:** anticipar si una marca de giro termina en giro en las 3 velas siguientes.
- **Mira:** dónde aparece. En una zona tuya tiene una historia; en medio de la nada, poca.
- **Errores típicos:** juzgar por uno o dos casos; olvidar el contexto de 1h y 4h (contra una tendencia fuerte casi todo "falla").
- **Tus datos:** con 20 casos por código ya ves cuál te dice algo a ti; con 60 se puede comparar con el 50%.

## n1 · Continuación: encuentra el elemento

- **Qué es:** reconocer los elementos de continuación: SW, VL, SQ, DB, PW, ST, VI, RD, VD, TP, RX, BR y GR.
- **En tu herramienta:** BR y GR salen del almacén de flujo (órdenes reales; del 07/12/2021 al 19/12/2022 no hay) y marcan ~5% de las velas. ST, VI, RD, VD, TP y RX son "vol.": sin el filtro de volumen marcarían del 12% al 74% de las velas.
- **Mira:** rachas de niveles del mismo lado (SW, VL, SQ), desequilibrios (ST, VI, RD) y el delta entre velas seguidas (DB).
- **Errores típicos:** olvidar encender un "vol." para el ejercicio; tomar un empuje en el extremo de un rango como continuación segura.

## e3 · Continuación: ¿vuelve a la franja?

- **Qué es:** anticipar si el precio vuelve a una franja de continuación (barrido, orden grande, stacked…) en 10 velas.
- **Mira:** si la franja quedó en el extremo de la vela (alguien persiguió el precio) o en el medio.
- **Errores típicos:** suponer que una orden grande es alguien entrando: puede ser un cierre o una liquidación.
- **Tus datos:** no medido si el precio vuelve.

## t1 · Tabla de la vela: lee DV, XD y SM

- **Qué es:** anticipar, viendo la vela y su footprint, si la tabla marcará DV (Δ/Vol extremo), XD (delta en su extremo) o SM (el lado contrario casi no movió el delta).
- **En tu herramienta:** panel "Tabla de la vela": Delta en color con XD, Máx o Mín Δ en ámbar con SM. Máx y Mín Δ son exactos (almacén de flujo). Cada uno marca ~5-6% de las velas de BTC.
- **Mira:** una vela que cierra en su extremo con mucho delta (XD); una vela verde cuyo mínimo de delta casi no bajó de cero (SM).
- **Errores típicos:** confundir Δ/Vol (proporción) con el delta (tamaño).

## b6 · Libro: encuentra AB, BL o LD

- **Qué es:** reconocer los eventos del libro en Elementos OF de la suite.
- **En tu herramienta:** AB = se negoció contra un lado al menos el doble de lo que esperaba, se quedó y el precio no pasó (sobre el p90 de 24 h). BL = un nivel sostenido de 15 minutos o más consumido en la vela. LD = poca liquidez a 0.25% del precio (bajo el p5 de 24 h). Solo desde el 13/11/2026 y solo en la suite.
- **Mira:** el mapa y la cinta: AB suele coincidir con un muro que no se va; BL con un nivel de "Niveles" que termina "consumido".
- **Tus datos:** en BTC 5m, 12 horas: AB en 12 de 144 velas, BL 19; LD 31 de 288 en un día. Nada validado contra el azar.

## El VPA (v1 a v5)

- **La idea de Coulling:** el volumen es el esfuerzo y el rango de la vela el resultado. Si cuadran, el movimiento es genuino; si no, hay una anomalía. El libro no trae números: las reglas son propias, por grados de 0 a 100%.
- **Lo normal es de su hora:** cada vela se compara con la mediana de su misma hora en los 30 días anteriores (volumen y rango). Así una vela de la madrugada no se juzga contra la apertura de Nueva York.
- **El medidor** suma la evidencia de cada vela con signo (arriba fuerza, abajo debilidad) y cada vela se queda con el 75% de lo anterior.
- **Velas con ancho por volumen** (opción del modal): el cuerpo es más ancho con más volumen frente a lo normal de su hora; el ancho de siempre es el volumen normal y el doble llena el lugar.
- **Lo medido** (fase 1, 4h, siete monedas): solo la ruptura con volumen supera al azar (+0.12 a +0.14 R por trade, en el borde del margen); el esfuerzo sin resultado sirve para leer quién absorbe pero no anticipa el giro; la prueba de poco volumen y el cruce del medidor pierden; como salida, ninguna lectura supera al trailing.

## v1 · Esfuerzo y resultado

- **Qué es:** decir si una vela es esfuerzo sin resultado, resultado sin esfuerzo, validada o normal, antes de ver la lectura del lector.
- **En tu herramienta:** volumen relativo = volumen ÷ mediana de su hora; rango relativo igual. Esfuerzo sin resultado = volumen alto (desde 1.2 veces, del todo en 1.8) con un rango menor que el que pide ese volumen; resultado sin esfuerzo = rango ancho con volumen bajo (bajo de 0.95 veces); validada = rango ancho, volumen alto y proporcionados. El cuadro del panel dice cada grado.
- **Mira:** la barra de volumen contra las de la misma hora de días anteriores (no contra las vecinas) y el tamaño de la vela contra su ATR. Con «Velas con ancho por volumen», una vela ancha y corta es la imagen del esfuerzo sin resultado.
- **Errores típicos:** comparar con las velas de al lado; llamar esfuerzo sin resultado a una vela grande con mucho volumen (esa es validada); olvidar que en 1D se compara con los días anteriores.
- **Tus datos:** con el delta real de seis monedas, en las velas de esfuerzo sin resultado el lado contrario al color pesa más que en velas parecidas (15m: −0.042 en las verdes y +0.051 en las rojas). La lectura de Coulling se confirma en cripto.

## v2 · VPA: encuentra el elemento

- **Qué es:** encontrar los elementos del lector (QA, QB, QF, QR, QS, QC) antes de encender sus marcas.
- **En tu herramienta:** cada uno cuenta desde el grado 0.5. Ruptura: el primer cierre a más de 0.1 ATR fuera del máximo o el mínimo de las 20 velas anteriores, con ese rango de hasta 6 ATR. Retroceso: en 8 velas vuelve a ½ ATR del nivel con volumen bajo y cierra a favor. Frenado: 2 de las 3 últimas velas con mecha contra el tramo, cierre en su mitad de ese lado y volumen alto, en un tramo de 2 ATR o más. Clímax: 2 o más velas de volumen ultra alto (2 a 3 veces) con mecha contra el tramo, a menos de 1 ATR entre sí. Frenado y clímax salen una vez por tramo.
- **Mira:** dónde está el tramo (el zigzag de 2 ATR) y en qué parte de él cae la vela. Los elementos de giro salen al final de un tramo, no en el medio.
- **Errores típicos:** buscar el clímax en una sola vela (pide dos); marcar como ruptura un cierre dentro del margen de 0.1 ATR; olvidar que el retroceso necesita antes una ruptura con volumen.
- **Tus datos:** qué es cada código, en la tabla «Códigos».

## v3 · Ruptura: ¿con volumen sigue?

- **Qué es:** leer si la ruptura de un rango trae volumen y anticipar si el precio sigue.
- **En tu herramienta:** QB (▲) con volumen alto, QF (✕) con volumen bajo. La marca sale al cerrar la vela de la ruptura.
- **Mira:** el volumen de la vela de ruptura contra lo normal de su hora y si cierra lejos del nivel roto.
- **Errores típicos:** juzgar la ruptura por el tamaño de la vela y no por su volumen; esperar que siga siempre: gana pocas veces y gana grande.
- **Tus datos:** fase 1, 4h, siete monedas, a mercado con stop de 1.5 ATR y 3R: +0.14 R por trade (±0.13), +0.12 sobre los controles al azar, 6 de 7 monedas. Fase 2 (2024 a mediados de 2025), corrida el 21/11: en las monedas de siempre +0.16 R por trade (520 trades, +0.17 sobre el azar con margen, sobre seguir el tramo sin margen); en las 43 nuevas +0.21 R (2,985 trades, +0.22 y +0.18 sobre los dos controles con margen, 35 de 43 monedas). Pasa a la fase 3, que no se ha corrido. Detalle: `C:\Users\inven\OrderFlowData\research\vpa\FASE2_QB.md`. La ruptura sin volumen, operada en contra, no ganó.

## v4 · El medidor: ¿fuerza o debilidad?

- **Qué es:** sumar de cabeza la evidencia de las últimas velas y decir hacia dónde está el medidor.
- **En tu herramienta:** cada vela aporta con signo: esfuerzo sin resultado y resultado sin esfuerzo, contra el color; validada, a favor; estrella, martillo, hanging man, doji y esfuerzo que se agota, según el tramo. Lo anterior se multiplica por 0.75 en cada vela. El umbral de fábrica es ±1 (las líneas punteadas).
- **Mira:** la última anomalía fuerte y cuántas velas hace que fue.
- **Errores típicos:** leer el medidor como la tendencia; olvidar que se desvanece rápido (a las 5 velas queda menos de un cuarto).
- **Tus datos:** como filtro de entrada no mejoró al FVG nuevo ni a la ruptura de caja, y el cruce del umbral como señal perdió en las siete monedas. Es una ayuda de lectura.

## v5 · Clímax o frenado: ¿se acaba el tramo?

- **Qué es:** cuando sale un clímax (C) o un frenado (S), anticipar si el tramo ya hizo su extremo.
- **En tu herramienta:** los dos van contra el tramo, una vez por tramo, y se conocen al cerrar su última vela.
- **Mira:** cuánto llevaba el tramo (un clímax tras 1 ATR no es lo mismo que tras 6) y si las velas siguientes vienen con poco volumen.
- **Errores típicos:** tomarlo como señal de giro: avisa cansancio, no dirección.
- **Tus datos:** como entrada, el frenado dio +0.07 R y el clímax +0.04, dentro del margen. Como salida (fase 4), «clímax o frenado» rindió como un objetivo fijo de 3R y no superó al trailing de 4 ATR. No se midió si el tramo termina.

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

## Códigos

| Código | Qué es |
|---|---|
| VA | VA abandonada: la vela siguiente no entra en el área de valor (70%) |
| OG | Orderflows Gap: áreas de valor de dos velas sin tocarse, con hueco grande |
| AP / SL | POC alineado (mismo POC en dos velas) / Slingshot (dos velas del mismo color con el POC hacia atrás) |
| OP | Open POC (vol.): POC fuera del rango de las 5 velas anteriores |
| RL | Absorción (propuesta propia): nivel enorme del mes con ≥40% pasivo |
| EX | Exhaustion Print: lado pasivo del extremo de inicio casi en cero |
| ZP | Zero Print: un 0 en una de las dos celdas del extremo de inicio |
| DT | Delta Tail: delta en contra en el extremo y a favor en el resto |
| RS | Retail Suck: el pasivo del extremo baja tres niveles seguidos |
| DD | Delta Divergence: extremo de 5 velas con delta a favor del color |
| PD | Price Action Divergence: delta contra el color de la vela |
| AD | Acumulación/Distribución: la mayor celda del lado contrario, en el tercio del inicio |
| IV | Inverse Imbalance: dos desequilibrios contrarios seguidos en la mitad lejana |
| IR | Imbalance Reversal (vol.): desequilibrio contrario en uno de los dos precios del inicio |
| SW | Market Sweep: racha de niveles sin contrapartida |
| VL | Vertical Liquidity: racha de niveles con el agresor muy grande |
| SQ | Orderflows Sequencing: agresor creciente desde el extremo |
| DB | Delta Breakout: salto de delta entre dos velas del mismo color |
| PW | POC Wave: tres velas con el POC escalonado |
| ST | Stacked Imbalance (vol.): 3 desequilibrios diagonales seguidos a favor |
| VI | Volume Imbalance (vol.): 3 o más desequilibrios a favor |
| RD | Imbalance Reload (vol.): desequilibrio al mismo precio en dos velas del mismo color |
| VD | Volume Decline (vol.): el pasivo crece del 1.º al 3.º precio |
| TP | Thin Print (vol.): nivel interior con contrapartida 0 |
| RX | Ratio de extremos (vol.): 2.º precio ÷ extremo fuera de 0.70 a 30 |
| BR / GR | Barrido real (orden que cruzó 3 precios o más) / Orden grande |
| DV / XD / SM | Tabla: Δ/Vol extremo / delta en su extremo / Small Min/Max Delta |
| AB / BL / LD | Libro (solo la suite): absorción / barrido de un nivel sostenido / libro delgado |
| QA | VPA: esfuerzo sin resultado (mucho volumen para su hora, poco rango), contra el color |
| QB / QF | VPA: ruptura del rango de 20 velas con volumen / sin volumen (probable trampa) |
| QR | VPA: retroceso sin volumen tras una ruptura con volumen |
| QS / QC | VPA: frenado o techo / clímax, contra el tramo |
