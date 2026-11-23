# Plan: scanner de monedas para la Watchlist de la suite

Pedido del usuario el 22/11/2026: un scanner que busque en Bybit las mejores monedas para operar según las condiciones
del mercado, para verlas en la Watchlist de la suite (App 12). Dio como referencia el Pump Screener de WunderTrading,
que busca pumps, sin que tenga que ser igual. Este archivo es la hoja de ruta. **El paso 1 está hecho (22/11/2026)**;
lo hecho en cada paso queda además en `12.AltagraciaTradingSuite/CLAUDE.md`, sección "Scanner".

## La pregunta, en tres partes

"La mejor moneda para operar" junta tres preguntas que no conviene sumar en un solo puntaje:

1. **¿Se puede operar?** Que la comisión, el spread y el deslizamiento no se coman la ventaja. Se mide en R del stop
   que uses, para tu tamaño de orden.
2. **¿Está en juego?** Que hoy pase en ella algo distinto de lo normal: volumen contra el de su hora, movimiento propio
   (sin la parte que pone BTC), volatilidad que se expande y OI que entra.
3. **¿Encaja con lo que operamos?** El marco, el régimen, las reglas que pasaron las fases, los datos que tenemos de
   ella y si el bot la tiene configurada.

Encima va **el estado del mercado** (BTC, amplitud, dispersión, correlación, funding y fin de semana), que dice qué
lista mirar primero.

## Lo que se encontró afuera

| Fuente | Qué dice | Para nosotros |
|---|---|---|
| Pump Screener de WunderTrading | Cambio de precio y de OI en 1, 5 o 15 min, en Binance, Bybit y Hyperliquid, con avisos por web y Telegram. Sus ejemplos: largo con 1% de precio y 4% de OI en 5 min; corto contra la subida con 10% y 1% en 15 min. No mira volumen, liquidez ni funding, y avisa que no es una señal | Una lista rápida dentro del scanner, con banderas de riesgo. Cuesta un solo pedido: el ticker de Bybit trae el precio y el OI de todas |
| Screeners de derivados (CoinGlass, Velo, Coinalyze, Hyblock, TradingView) | OI y su cambio (de 5 min a 24 h), OI contra capitalización, funding (ponderado por OI, anualizado y previsto), liquidaciones de 24 h por lado, proporción de largos y cortos, delta de volumen de 10 min a 24 h. Hyblock pinta un indicador en todas las monedas a la vez para ver las que se salen | Las columnas. Casi todo lo da Bybit gratis |
| Zarattini, Barbon y Aziz (2024), "Stocks in Play" | El ORB de 5 min en más de 7,000 acciones (2016-2023) rinde de verdad solo en las de volumen anormal: con las 20 de más volumen relativo del día (el de la apertura contra sus 14 días, al menos 100%), Sharpe 2.81 neto de costos. Es un documento de trabajo, con una réplica | La idea central: elegir por **volumen relativo**, no por volumen total. Hay que probarlo en cripto con nuestras reglas |
| Liu, Tsyvinski y Wu (Journal of Finance, 2022) | En cripto, el momentum de 1 a 4 semanas rinde de 2.5% a 4.1% por semana en la sección cruzada (versión de trabajo); mercado, tamaño y momentum lo explican casi todo. Su factor de volumen es otra cosa: las de menos volumen total rinden más | Fuerza relativa de días a semanas. No confundir su factor de volumen con el volumen relativo |
| CTREND (JFQA, 2024) | Señales de precio y de volumen de varios plazos, juntas, predicen la sección cruzada de cripto | Tendencia con volumen |
| Zarattini, Pagani y Barbon (2025), "Catching Crypto Trends" | Tendencia con canales de Donchian de varios plazos en las cripto líquidas, con una base sin sesgo de supervivencia y volatilidad objetivo. Las tendencias largas aguantan; las cortas se debilitaron en los últimos años | La lista de tendencia, y el cuidado con la supervivencia |
| Bianchi, Babiak y Dickerson (2022) | La reversión de corto plazo se concentra en las monedas de poco volumen | Un movimiento sin volumen tiende a volver. Va con el VPA y con que la ruptura con volumen (QB) pasó las fases 2 y 3 |
| Shen, Urquhart y Wang (2022); Caporale y Plastun (2020) | En BTC, el momentum dentro del día es más fuerte en las sesiones de más volumen o volatilidad. Tras un día de retorno anormal en BTC y ETH suele seguir el momentum, con casos de reversión | El movimiento anormal se lee junto al volumen relativo |
| Volumen anormal en spot (Binance) | Sin poder vender en corto, el volumen anormal predice retornos negativos (desacuerdo); con margen, desaparece | En perpetuos se puede vender en corto: no aplica igual |
| OI y funding | No hay un estudio serio de que el cambio del OI prediga el precio: su dirección es ambigua y algunos exchanges lo publican mal. El funding es sobre todo fuente de carry, que se comprimió desde 2024 | Contexto y filtro, no orden. **Lo nuestro (20/11, 8 reglas y 50 monedas):** ir con la multitud según el funding resta unos 0.10 R por trade, y el OI subiendo sostenido suma unos 0.05, también en la fase 3 |
| Kaiko | La liquidez se mide con la profundidad a ±1% (la de ±2% se infló cuando los rankings la publicaron). El deslizamiento es costo directo, y volumen ÷ profundidad delata volumen inflado | El costo con el libro y una bandera de volumen inflado |
| Pump and dump (Kamps y Kleinberg, 2018; La Morgia et al., 2021) | Saltos de precio y de volumen, y órdenes a mercado en ráfaga, sobre todo en monedas chicas | Banderas de riesgo, no una lista para perseguir |

**La advertencia de siempre:** un scanner dice dónde está la actividad y cuánto cuesta operar ahí. Que eso dé más R con
nuestras reglas hay que probarlo (ver "Cómo saber si sirve").

## Lo medido en Bybit

Foto del domingo 22/11/2026 a las 21:27 de Colombia (02:27 UTC del 23/11), con la API pública y sin claves. Los
scripts y la foto están en `OrderFlowData/research/scanner/2026-11-22/` (`scan_snapshot.py`, `scan_concurrency.py` y
`foto/`). Por ser domingo, el volumen estaba bajo.

- **Universo:** 939 instrumentos lineales: 831 perpetuos USDT que cotizan, 68 en USDC y 40 futuros con fecha.
  - De los 831: 406 cripto (36 con la etiqueta ST, de riesgo), 110 de la zona de innovación, 245 acciones, 62 ETF,
    4 materias primas (oro, plata, Brent y crudo) y 4 de forex. Bybit los distingue con `symbolType` y `tags` de
    `instruments-info`.
  - Las cripto mueven el 86.6% del turnover; los ETF, el 4.5%; las acciones, el 3.8%; la innovación, el 2.9%, y las
    materias primas, el 1.7%. SOXL fue la 4.ª de todo Bybit (279 M USD) y el oro, la 9.ª.
  - Bybit da también los 321 perpetuos USDT ya cerrados, con su fecha de alta y de cierre, y sus velas se pueden pedir
    (probado con uno). Con eso se puede estudiar sin sesgo de supervivencia.
- **Concentración:** la mediana mueve 0.22 M USD por día. 99 pasan de 5 M, 58 de 10 M, 36 de 20 M y 14 de 50 M. Las 10
  primeras son el 81% del turnover y las 50 primeras, el 92%.
- **Las monedas de fábrica de la suite:** 8 de las 20 mueven menos de 10 M por día: ARB (9.5 M), TRX (5.8), PAXG
  (3.8), SHIB1000 (3.3), GALA (1.9), KAS (0.9), TRB (0.5) y LPT (0.1, puesto 617). La suite graba el libro y la cinta de
  todas. Entre las 10 primeras de Bybit hay cuatro cripto que no están: PIEVERSE (250 M), ZEC (199 M), HYPE (104 M) y
  NEAR (91 M).
- **Edad:** 30 se listaron hace menos de 30 días y 118, hace menos de 90.
- **Funding:** 454 liquidan cada 8 h, 372 cada 4 h y 5 cada hora, así que hay que llevarlo a una misma base. 107 están a
  ±0.05% por 8 h o más. INIT: −0.77% por hora, −6.2% por 8 h.
- **Fin de semana:** el turnover por hora del fin de semana es 0.66 del de entre semana (mediana de 96 monedas en 5
  semanas; en una de cada cuatro, 0.30 o menos). El volumen relativo de 24 h mediano daba 0.72 contra los 30 días y 0.84
  contra solo los días de fin de semana: hay que comparar con días del mismo tipo.
- **Spread:** en las de 5 M o más, 2.5 bps de mediana; el 10% peor, más de 11.8.
- **Costo de operar** (60 monedas con el libro, orden a mercado de 10k USD):
  - deslizamiento de ida y vuelta (con el spread) de 5 bps o menos en 23, de 10 o menos en 37 y de 20 o menos en 41;
  - **en las grandes pesa más la comisión que el deslizamiento:** taker en las dos puntas (11 bps) es 0.14 ATR de 1 h en
    BTC y en ETH. Con un stop de 1 ATR de 1 h, el 14% del riesgo se va en comisión; con 1.5 ATR de 4 h (como QB), 0.028 R;
  - las más baratas en R son las líquidas que se mueven: PIEVERSE 0.018 R, ZEC 0.022, y SUI, ETH y HYPE 0.027 (stop de
    1.5 ATR de 4 h). Las tranquilas cuestan más aunque sean líquidas: oro 0.098 R y crudo 0.126. ACE, 0.146 R, por su
    libro;
  - la mediana es 0.17 ATR de 1 h, y solo 5 de 60 quedan en 0.10 o menos.
- **En juego, ese domingo:** ACE tenía 119 veces el volumen de su hora, el OI +263% en 24 h, funding de −1.24% por 8 h y
  un costo de 216 bps de ida y vuelta. PIEVERSE tenía 43 veces el suyo, con 250 M de turnover y 0.018 R de costo. Las
  dos estaban en juego; solo una era barata. El scanner tiene que separar las dos cosas.
- **Estado del mercado:** BTC −5.7% en 7 días y +1.3% en 24 h, con un ATR diario de 5.4%. Solo el 18% de las líquidas
  estaba sobre su promedio de 20 días. Correlación mediana con BTC: 0.50 en 30 días y 0.57 en 7.
- **Tiempos:**
  - el ticker de las 831 es un pedido de 2.7 s; `instruments-info`, 3.2 s;
  - velas de 1 h (1000) de 99 monedas, de a una: 118 s. Con 8 a la vez y 8 por segundo: 26 s, con 1.3 s de latencia
    mediana por pedido;
  - ningún "Too many visits" en unos 420 pedidos. El tope de Bybit es de 600 pedidos cada 5 s por IP, y pasarlo bloquea
    la IP 10 minutos, grabación de la suite incluida. La suite se limita a 10 por segundo: el scanner va dentro de ese
    límite.

## Diseño propuesto

### Dónde vive
- **Servidor:** `server/scanner.py`, como `swing_watch.py` y `dx_watch.py`. Arranca con el servidor, un solo proceso
  calcula por carpeta (`data/scanner/scanner.lock`), `SUITE_SCANNER=0` lo apaga y todo pedido a Bybit pasa por
  `candles.bybit_turn()`. Nunca envía nada al bot.
- **Página:** la Watchlist (fuente de la cuadrícula y "Panel del scanner"), con los estilos de App 1 que ya usa. Nada de
  lo que existe cambia: la fuente de fábrica sigue siendo "Mis monedas".

### Universo
- Todos los perpetuos USDT de Bybit que cotizan, con su grupo (cripto, innovación, acciones, ETF, materias primas y
  forex) y la etiqueta ST aparte.
- De fábrica: cripto e innovación (marcada), sin ST. Acciones, ETF y materias primas van en un grupo que se enciende
  aparte: su mercado de origen cierra, y el precio de Bybit puede saltar en la apertura de Nueva York.
- Siempre entran las monedas de la suite y las que fijes, aunque no pasen los filtros.

### Cómo calcula
1. **Cada 30 s, un pedido:** `/v5/market/tickers` de todas. Trae el precio, el de hace 1 h y el de hace 24 h, el turnover,
   el OI, el funding con su intervalo y la mejor compra y venta. Con eso salen:
   - los filtros duros;
   - la lista rápida: cambio de precio y de OI en 5 y 15 min, con las fotos guardadas en memoria;
   - las candidatas: las que pasan el piso de liquidez (de fábrica, 5 M USD en 24 h; el domingo, unas 70 entre cripto e
     innovación), más las de la suite y las fijadas.
2. **Para las candidatas (de 60 a 120):**
   - velas de 15 min de 35 días (la primera vez, 3 pedidos por moneda; después, uno cada 15 min), de las que salen las de
     1 h y 4 h, y velas diarias de 200 días, una vez por día;
   - el OI de Bybit cada 15 min (`/v5/market/open-interest`);
   - el libro (`/v5/market/orderbook`, 200 niveles) de las 40 primeras cada 5 min, para el deslizamiento;
   - en el paso 2, la proporción de cuentas (`account-ratio`), las liquidaciones (`allLiquidation`, por WebSocket, que no
     cuenta en el límite) y Hyperliquid (`metaAndAssetCtxs`: un pedido para todas las que lista; `hl_recorder.py` ya lo
     pide cada minuto).

   En promedio, menos de un pedido por segundo. La carga inicial, unos 400 pedidos, tarda menos de un minuto.
3. **Cada 6 h:** `instruments-info` (grupo, etiquetas, fecha de alta, tick e intervalo del funding) y los anuncios de
   Bybit (`/v5/announcements/index` con `type=delistings`; por ejemplo, "Delisting of AGIUSDT Perpetual Contract"), para
   marcar las que se van a cerrar.
4. **Sin futuro:** las medidas usan velas cerradas. Lo de la vela en curso (como el cambio de 1 h del ticker) dice "en
   curso".

### Medidas por moneda

| Grupo | Medida | Cómo |
|---|---|---|
| **Se puede operar** | Turnover de 24 h y su puesto | Del ticker |
| | Spread | Mediana de las fotos de la última hora, en bps |
| | Deslizamiento para tu tamaño | Una orden a mercado de 10k USD (de fábrica) contra el libro, en compra y en venta |
| | **Costo en R** | (comisión + spread + deslizamiento, de ida y vuelta) ÷ la distancia del stop. Dos columnas de fábrica: stop de 1 ATR de 1 h y de 1.5 ATR de 4 h (el de QB). Con entrada limit, la comisión de entrada es maker (0.02%) |
| | Tick | En bps del precio: un tick grueso da footprints de pocas celdas y stops a saltos |
| | Profundidad | A ±1% del precio, en USD, y turnover ÷ profundidad (volumen inflado) |
| | Funding | En una misma base (por 8 h), con su intervalo, y lo que cuesta o paga por día a un largo y a un corto |
| | Riesgo de la moneda | Edad, grupo, ST, anuncio de cierre, apalancamiento máximo y nocional mínimo |
| **Está en juego** | **Volumen relativo** | El turnover de la última hora, de las últimas 4 h y de las últimas 24 h cerradas, contra la mediana de la misma ventana a la misma hora en los 30 días anteriores, **del mismo tipo de día** (entre semana o fin de semana). Además, su percentil entre las candidatas |
| | Movimiento propio | Retorno − beta × retorno de BTC, en 1 h, 4 h, 24 h y 7 días; beta y correlación de 30 días con retornos de 1 h. También en ATR diarios |
| | Volatilidad | ATR de 1 h, 4 h y diario en %, y su expansión: el de hoy ÷ su mediana de 30 días |
| | OI | Cambio de 1 h, 4 h y 24 h, y el cuadrante con el precio (sube con OI: entran largos; sube sin OI: cierran cortos; y al revés) |
| | Lugar | En el rango de 30 días, máximo o mínimo nuevo de 20 días, y distancia al máximo y al mínimo del día anterior |
| **Posicionamiento** (paso 2) | | Funding contra el suyo de 30 días, proporción de cuentas largas, liquidaciones de 1 h y 24 h por lado, funding y OI de Hyperliquid y la diferencia de funding entre los dos |
| **Encaje** | Régimen | De 4 h, con el detector de la pestaña Régimen de App 1 que mejor separó (eficiencia con caja): dentro de una caja, fuera o rompiéndola |
| | Señales | Lo último de los detectores de la suite (Swing, sabios y SMC) y la ruptura con volumen (QB) de 4 h, la regla del VPA que pasó las fases 2 y 3 en las monedas nuevas |
| | Datos | Almacén de trades (footprints y Elementos OF), libro grabado, Hyperliquid e historia en App 1; si la suite la graba y si el bot la tiene configurada |

### Las listas, en vez de un puntaje
Cada lista dice su regla, y cada moneda dice por qué está ("vol ×6", "+8% vs BTC", "OI +30%", "0.03 R").

| Lista | Regla | De dónde sale |
|---|---|---|
| **1. En juego** (la de fábrica) | Libro suficiente y volumen relativo de 24 h de 1.5 o más (del mismo tipo de día); ordena por volumen relativo. Se puede ordenar por el de 1 h | "Stocks in Play"; la reversión en poco volumen; el momentum de BTC con volumen |
| **2. Tendencia con fuerza** | Máximo o mínimo nuevo de 20 días, eficiencia de 7 días en su tercio alto y movimiento propio de 7 días a favor; ordena por el movimiento propio | Momentum de 1 a 4 semanas, CTREND y los canales de Donchian de Zarattini |
| **3. Compresión** (paso 2) | ATR y ancho de bandas en su 20% más bajo de 30 días, OI subiendo sostenido y cerca del borde de una caja. Para las rupturas (QB, ruptura de caja) | Lo nuestro del OI sostenido. La compresión como forma de elegir monedas no se ha probado |
| **4. Posicionamiento extremo** (paso 2) | Funding, proporción de cuentas u OI en sus extremos. Para mirar y para no ir con la multitud | Lo nuestro: con la multitud, −0.10 R |
| **5. Rápidos** | Cambio de precio y de OI en 5 o 15 min en todo el universo, con los ejemplos de WunderTrading de fábrica | El Pump Screener. Solo para mirar |
| **6. Mis monedas** | Las de la suite con sus medidas. "Candidata a quitar" si pasa una semana bajo el piso de liquidez | La foto: LPT, TRB y KAS casi no operan |

- **Libro suficiente** (filtro de fábrica de las listas 1 a 4): spread y deslizamiento de ida y vuelta de 20 bps o menos
  para tu tamaño. El domingo pasaban 41 de 60. El costo en R se ve aparte, con color, porque depende del stop de cada uno.
- **Banderas** en todas: innovación, ST, menos de 30 días, acción o ETF con su mercado cerrado, anuncio de cierre,
  funding extremo, libro fino y volumen inflado.
- **Sin saltos:** una moneda entra al cumplir la regla y sale después de una hora sin cumplirla.

### El estado del mercado
Arriba del panel:
- **BTC:** sobre o bajo su promedio de 20 días, eficiencia de 7 días y ATR diario contra el de su año;
- **amplitud:** parte de las líquidas sobre su promedio de 20 días y parte que sube en 24 h;
- **dispersión:** cuánto se separan los retornos de 24 h entre monedas (rango intercuartil);
- **correlación** mediana con BTC, de 7 y de 30 días: si sube, se mueven en bloque; si baja, hay rotación;
- **alts contra BTC:** parte de las líquidas con movimiento propio de 7 días positivo;
- **apalancamiento:** funding agregado (ponderado por OI) y cambio del OI total en 24 h;
- **actividad:** volumen relativo mediano, sesión (Asia, Europa o EE. UU.) y fin de semana.

**Qué lista mirar primero** (hipótesis, para probar con el registro y en el paso 3):
- en bloque (correlación alta y dispersión baja): BTC y ETH, o las de beta alta a favor de BTC. "En juego" da poco;
- cada una por su lado (dispersión alta): "En juego";
- BTC tranquilo para su año y muchas comprimidas: "Compresión";
- funding agregado extremo: cuidado con ir con la multitud.

### En la Watchlist
- **Fuente de la cuadrícula:** "Mis monedas" (como hoy), "Scanner: <lista>" o "Las dos". Con el scanner, las 12 primeras
  de la lista (de fábrica), con los mismos indicadores livianos: todos salen de las velas, así que sirven para cualquier
  moneda. La celda lleva los chips del porqué y las banderas.
- **Panel del scanner**, como el del Swing:
  - el estado del mercado;
  - la lista, con columnas que se ordenan;
  - los filtros: grupos, piso de liquidez, tamaño de orden y stop para el costo;
  - por moneda: abrir en el gráfico, fijar, "Agregar a la suite" y, si el bot no la tiene, el aviso con el camino a
    Bot > Configuración. El panel de trading ya la rechaza sin eso.
- **Las del scanner no se graban:** solo velas de Bybit. "Agregar a la suite" la suma a `symbols.json` y empieza a grabar
  libro, cinta y Hyperliquid: de 3 a 20 MB de libro por moneda y por día, con un tope de 60 monedas. La nube graba su
  propia lista (`SYMBOLS` en Northflank) y no las cubre.

### Registro (para poder juzgarlo)
- Cada 15 min, de cada candidata, las medidas principales y en qué listas está, y cada entrada y salida de una lista. En
  `data/scanner/log/AAAA-MM-DD.jsonl.gz`, unos 0.5 MB por día.
- Con semanas de registro se mide lo que pasó después de entrar a cada lista contra las demás líquidas a la misma hora.

### Lo que no hace
- No envía nada al bot, no opera, no agrega monedas sola y no cambia la configuración del bot.
- No promete ventaja: dice dónde está la actividad y cuánto cuesta operar ahí.

## Cómo saber si sirve
- **Seguro:** el costo en R se resta directo del resultado. Dejar fuera los libros finos y preferir las que se mueven
  mucho para lo que cuestan ayuda a cualquier regla.
- **Probable:** la volatilidad se agrupa: lo que hoy se mueve mucho suele seguir moviéndose. Moverse no es ganar.
- **Por probar:** que nuestras reglas den más R en las monedas en juego que en las demás.

**En App 1 (paso 3), con el criterio fijado antes de correr:**
1. Un filtro de sección cruzada en el probador: "solo en las N monedas en juego a esa hora" (volumen relativo por hora y
   tipo de día contra el universo de ese momento, solo velas cerradas). Su control: la misma regla en las que no estaban
   en juego, además de los controles al azar de siempre.
2. Universo: primero las 50 que ya tiene App 1 (rápido, pero con sesgo: se eligieron por su volumen de hoy y cotizan
   desde antes de 2022). Después, sin sesgo: las 831 que cotizan y las 321 cerradas, con velas de 1 h y 4 h desde 2020.
   Son unos 15 a 20 mil pedidos: de 1 a 2 horas en segundo plano, como la bajada del OI.
3. Reglas: QB de 4 h (la que pasó), Impulso, FVG nuevo, B5 y entradas al azar, en las tres fases.
4. El costo de esas fechas se estima con las velas, porque no hay libro: Amihud o el spread de Corwin y Schultz.
5. Criterio propuesto: pasa si en la fase 2 la regla en las monedas en juego le gana con margen (IC 95%) a la misma regla
   en las demás y a sus controles, en el universo sin sesgo. La fase 3, solo si pasa la 2.

**En la suite:** el registro del scanner y el journal: tus trades y los de los detectores en monedas del scanner, contra
los de las demás.

## Los pasos

### Paso 1 — El scanner en el servidor y en la Watchlist ✅ hecho el 22/11/2026

Detalle en `12.AltagraciaTradingSuite/CLAUDE.md`, sección "Scanner (22/11)". Lo que cambió respecto de lo de abajo:
- **Velas:** solo de 15 min, 31 días. Las de 1 h, 4 h y el día salen de ellas; BTC suma su diario de 400 días para el ATR
  contra su año. Se guardan en arreglos de números: con diccionarios, el servidor pasaba de 131 a 256 MB.
- **Entrar y salir:** para entrar a una lista hace falta el libro medido (con el estimado entraban libros finos que salían
  al medirse). Una que deja de cumplir su regla sigue una hora; una que ya no se puede operar sale en el acto.
- **Libros:** primero los de las listas, después los de las que cumplen una regla y después los de más volumen relativo.
- **Monedas de una letra** (H, A, B…): el scanner las mira; la suite todavía no las acepta.
- **Al paso 2:** la profundidad a ±1% y el volumen inflado (el libro de 50 niveles no llega a ±1% en las grandes).
- **Medido el 22/11 en una copia aislada:** 831 perpetuos y 77 candidatas; la primera vuelta, de 40 a 74 s con unos 310
  pedidos, sin rechazos de Bybit; las medidas, 1.3 s; unos 35 MB más de memoria.

Lo propuesto:
- `server/scanner.py`: universo y grupos, ticker cada 30 s, candidatas con velas de 15 min y diarias, OI, libro de las 40
  primeras y anuncios de cierre.
- Medidas: liquidez, costo en R, volumen relativo por tipo de día, movimiento propio contra BTC, volatilidad y su
  expansión, OI y funding en una misma base, lugar en el rango y banderas.
- Listas 1, 2, 5 y 6, con su histéresis, y el estado del mercado.
- Rutas: `GET /api/scanner/status`, `/api/scanner/list?lista=`, `/api/scanner/coin/{símbolo}`, `/api/scanner/market` y
  `GET/POST /api/scanner/config`. No mueven dinero: sin palabra de confirmación.
- Watchlist: la fuente de la cuadrícula, los chips y el panel.
- Registro cada 15 min.
- Pruebas sin conexión (`tests/scanner_checks.py`), con tickers y velas armados a mano: volumen relativo por tipo de día,
  beta y movimiento propio, costo con un libro conocido, la histéresis, el registro y las rutas. Después, una copia
  aislada contra Bybit real, como siempre.

### Paso 2 — Posicionamiento, compresión y cierres
- Proporción de cuentas, liquidaciones de Bybit por WebSocket, Hyperliquid de todas las monedas que lista y la diferencia
  de funding.
- Listas 3 y 4. La caja y el régimen con `regime_detectors` de App 1, sin copiarlo.
- "Candidata a quitar" en Mis monedas.
- Opcional: el volumen de Binance de la misma moneda, para ver si el movimiento es solo de Bybit.

### Paso 3 — ¿Aporta? El estudio en App 1
Ver "Cómo saber si sirve". Las cifras y el criterio se fijan aquí antes de correr.

### Paso 4 — Con los detectores y la central de alertas
Si el paso 3 lo confirma: que el Swing y los sabios vigilen también las monedas del scanner, y que "en juego" sea una de
las piezas de la central de alertas de confluencia que está pendiente.

## Decidido con el usuario (22/11/2026)
1. **Tamaño de orden: 1,000 USDT de fábrica.** Opera con menos de 1,000 USDT; en la cuenta Demo prueba con cualquier
   monto, así que el tamaño se cambia en el panel. El costo en R va en las dos columnas (stop de 1 ATR de 1 h y de
   1.5 ATR de 4 h). Las cifras de costo de "Lo medido" son con 10k: con 1,000 el deslizamiento es menor y pesa todavía
   más la comisión.
2. **Universo de fábrica:** cripto e innovación (marcada), sin ST. Acciones, ETF y materias primas, en un grupo aparte.
3. **Grabación:** las monedas del scanner no se graban hasta "Agregar a la suite".
4. **Las que casi no operan:** LPT, TRB y KAS se quedan en la suite. GALA también (DX la usa).

## Fuentes
- WunderTrading, Pump Screener: https://wundertrading.com/en/pump-screener
- Zarattini, Barbon y Aziz, "A Profitable Day Trading Strategy For The U.S. Equity Market":
  https://ideas.repec.org/p/chf/rpseri/rp2498.html; réplica:
  https://www.quantconnect.com/research/18444/opening-range-breakout-for-stocks-in-play/
- Liu, Tsyvinski y Wu, "Common Risk Factors in Cryptocurrency": https://www.nber.org/papers/w25882.pdf
- CTREND (JFQA): https://www.cambridge.org/core/services/aop-cambridge-core/content/view/S0022109024000747
- Zarattini, Pagani y Barbon, "Catching Crypto Trends": https://ideas.repec.org/p/chf/rpseri/rp2580.html
- Reversión y volumen en cripto (Babiak y coautores): https://www.cerge-ei.cz/pdf/wp/Wp730.pdf
- Volumen anormal y restricciones a la venta en corto: https://biz.uiowa.edu/faculty/jgarfinkel/pubs/crypto_divop.pdf
- Shen, Urquhart y Wang, "Bitcoin intraday time-series momentum":
  https://research.birmingham.ac.uk/en/publications/bitcoin-intraday-time-series-momentum/
- Caporale y Plastun: https://cesifo.org/en/publications/2019/working-paper/momentum-effects-cryptocurrency-market-after-one-day-abnormal
- Perpetuos y funding: https://arxiv.org/pdf/2212.06888 y https://arxiv.org/pdf/2510.14435; OI mal publicado:
  https://arxiv.org/pdf/2310.14973
- Kaiko, liquidez: https://www.kaiko.com/resources/understanding-centralized-exchange-liquidity-data
- La Morgia et al., pump and dump: https://arxiv.org/html/2105.00733v2
- Screeners: https://www.coinglass.com/learn/guide-rookies-en, https://velodata.gitbook.io/velo-data/chart-page/table,
  https://coinalyze.net/coinalyze-custom-metrics.pdf, https://academy.hyblockcapital.com/tools/coin-screener
- Bybit: https://bybit-exchange.github.io/docs/v5/market/tickers, https://bybit-exchange.github.io/docs/v5/rate-limit,
  https://bybit-exchange.github.io/docs/v5/websocket/public/all-liquidation,
  https://bybit-exchange.github.io/docs/v5/announcement
