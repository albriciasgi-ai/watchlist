# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en español con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en español.

### Perfil
Agente programador Python con experiencia en desarrollo de aplicaciones.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional, no mostrar borradores ni codigo parcial en el chat.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas, evitar refactors grandes.
5. **Analisis profundo**: Cuando se solicite, revisar archivos relacionados, dependencias, edge cases y posibles efectos secundarios.

### Limitaciones conocidas
- No puedo ejecutar codigo Python directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL DEL REPOSITORIO

Este repositorio contiene **11 aplicaciones relacionadas** para trading de criptomonedas:

| Carpeta | Aplicacion | Puerto Backend | Puerto Frontend |
|---------|------------|----------------|-----------------|
| `1.Altagracia_Crypto_Backtester/` | Backtester de estrategias | 9000 | 5173 |
| `2.WatchlistConIndicadores/` | Watchlist con indicadores en tiempo real | 8000 | 5173 |
| `3.TradingBot_Python/` | Bot de trading automatizado | 5000 | 3000 |
| `4.Analizador cripto/` | Analizador de un solo simbolo (optimizado) | 10001 | 10001 |
| `5.Order_flow/` | Analizador de Order Flow con Footprint | 11000 | 11001 |
| `6.Trading_Journal/` | Diario de trading con metricas y screenshots | 12000 | 12001 |
| `7.WatchlistDesktop/` | Watchlist version Electron (en desarrollo) | 8000 | Electron |
| `8.AnalizadorDesktop/` | **Analizador Desktop - Version Electron sin throttling** | 10001 | 5174 |
| `9.OrderFlowDesktop/` | **Order Flow Desktop - Version Electron optimizada** | 11000 | 11001 (Vite) |
| `10.TradingBotDesktop/` | **Trading Bot Desktop - Version Electron** | 5000 | 5001 |
| `11.TradingJournalDesktop/` | **Trading Journal Desktop - Version Electron** | 12000 | 12002 |

**Stack comun:**
- Frontend: React 18 + Vite + uPlot
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)
- Desktop: Electron 33+ (Apps 7-11)

---

## HISTORIAL DE CAMBIOS RECIENTES

### APP 1 (Backtester) - 10 Noviembre 2026: Prueba Manual de los Setups y Precio como Índice (fase 4)

**Pedido:** decidir a mano las reglas de cada setup sin gastar las fechas con que se comprueban. Además, con "Fecha al azar y oculta", que el precio tampoco delate la época: lo que importa son los porcentajes.

**Cambios:**
1. **Fecha de corte** en el modal de Setups (2025-07-01 por defecto): "Evaluar" nunca mira desde esa fecha, aunque la hora simulada sea posterior
2. **Comprobación final:** botón por receta que la corre solo en lo reservado, pide confirmar y queda registrada con su versión en `OrderFlowData/observer/setup_validations.jsonl`. El modal muestra cuántas veces se comprobó y el último resultado
3. **Versiones:** cada receta guardada suma una versión con fecha (`v1`, `v2`...)
4. **Tus trades por setup:** el informe del Observador da acierto y R de tus órdenes con cada setup elegido para el análisis, contra las que no lo tenían
5. **Precio como índice:** con fecha oculta el precio del inicio vale un número al azar entre 80 y 120 y el resto se mueve en el mismo porcentaje, con 3 decimales. Volumen, delta, CVD, OI y cantidades van en una escala donde la vela típica del inicio vale 1,000. Cubre gráfico, indicadores, dibujos, panel de trading, historial, dashboard, Excel y Observador. Las órdenes y el registro siguen en precios reales; "Revelar fecha" vuelve a mostrarlos
6. **Fallo de la fase 3:** "Evaluar" medía solo los últimos 70 días aunque pidiera 180. Ahora pide en tramos

**IMPORTANTE:** reiniciar el backend de App 1. Las evaluaciones anteriores a este cambio cubrieron 70 días como mucho. La comprobación final gasta lo reservado para esa receta: conviene usarla una vez, con las reglas ya decididas.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "ELEMENTOS DE ORDER FLOW" ("Prueba manual") y "OBSERVADOR" ("Retrocesos y fecha oculta")

---

### APP 1 (Backtester) - 10 Noviembre 2026: Setups de Order Flow como Recetas (fase 3)

**Problema:** los 91 setups de Orderflows Unlocked son combinaciones de elementos sin entrada, stop ni resultados. Strategic Flows, el producto del mismo autor, los combina con un "Consenso", pero no los mide.

**Cambios:**
1. **Recetas:** `backend/of_setups.py` combina los elementos de "Elementos OF":
   - modos: misma vela, al menos N, grupos con mínimo y secuencia en orden;
   - ventana de 1 a 5 velas;
   - filtros: swing, momentum (EMA 14) y confirmación de entrada.
   
   Cada voto cuenta en la vela con la que se conoce su elemento
2. **Biblioteca:** los 91 setups con el orden y la ventana leídos de las láminas, apagados de fábrica. Los cuatro que usan Market Weakness quedan marcados
3. **Gráfico:** corchete bajo o sobre las velas que votaron, con la etiqueta del setup, elegible para el análisis del trade
4. **Modal "Setups de Order Flow"** (desde el modal de Elementos OF): activar, evaluar una receta o toda la lista en los días anteriores a la hora simulada con costos y contra la base, ordenar por ventaja, editar y crear recetas propias

**IMPORTANTE:** reiniciar el backend de App 1. La evaluación usa solo lo ocurrido antes de la hora simulada; con menos de 30 casos avisa "muestra pequeña".

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE ORDER FLOW", "Setups como recetas"

---

### APP 1 (Backtester) - 10 Noviembre 2026: Elementos de Order Flow con Delta Exacto y Órdenes Reales (fase 2)

**Problema:** el almacén guarda compra y venta por minuto, así que el Max/Min Delta de una vela salía con resolución de 1 minuto. En BTC 15m eso marcaba Small Min/Max en 30% de las velas contra 12% exacto. Tampoco había forma de ver una orden que cruza varios precios ni las órdenes grandes.

**Cambios:**
1. **Almacén de flujo:** `OrderFlowData/tools/build_flow.py` guarda por minuto el máximo y el mínimo del delta dentro del minuto, y las órdenes agresivas de 3 precios o más (desde 100,000 USD) o de 250,000 USD o más. BTC completo: 2,416 días y 116 MB. `build_store.py` lo arma también para los días nuevos que descarga el panel
2. **Cuatro elementos nuevos en "Elementos OF":** Extreme Delta (XD) y Small Min/Max Delta (SM) en la tabla de la vela, barrido real (BR) y orden grande (GR) como franjas. Cada uno marca cerca del 5% de las velas
3. **Tabla de la vela:** suma Máx Δ y Mín Δ exactos

**IMPORTANTE:** reiniciar el backend de App 1. Del 07/12/2021 al 19/12/2022 Bybit publicó la hora en segundos: esos días tienen delta exacto, pero no barridos ni órdenes grandes.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE ORDER FLOW"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Elementos de Order Flow (fase 1)

**Problema:** los 91 setups de Orderflows Unlocked combinan unos 30 elementos de order flow, y App 1 solo dibujaba imbalances, stacked y delta. Los umbrales del libro son contratos del ES y en BTC marcan entre 30% y 90% de las velas.

**Cambios:**
1. **Lectura y calibración:** cinco agentes leyeron las 270 láminas de los PDF, y la fase 0 midió cada regla en BTC de 2020 a 2026. Todo quedó en `C:\Users\inven\OrderFlowData\research\orderflows_unlocked\`
2. **Motor:** `backend/of_elements.py` detecta 27 elementos con un step de análisis fijo por marco. Ocho de ellos (Stacked, Volume Imbalance, Reversal, Reload, Volume Decline, Thin Print, Open POC y ratio de extremos) solo aparecen en velas con volumen ≥ 2 veces la mediana de las 20 anteriores, ajustable en el modal. Los umbrales salen de los 30 días anteriores, para que cada elemento marque cerca del 5% de las velas. Solo usa velas cerradas antes de la hora simulada. Endpoint `/api/orderflow/elements/{symbol}`
3. **Indicador "Elementos OF":**
   - franjas que siguen hasta que el precio vuelve;
   - celdas marcadas, contornos de dos o tres velas y un triángulo con códigos;
   - panel "Tabla de la vela" (delta, Δ/Vol y delta acumulado del día) y EMA 14 opcional;
   - modal por grupos: Zonas, Giro en la zona y Continuación;
   - todo se puede elegir para el análisis del trade.
4. **Fuera por ahora:** Market Weakness, que las láminas no definen, y Extreme y Small Min/Max Delta, que necesitan el Max/Min Delta exacto (fase 2)

**IMPORTANTE:** reiniciar el backend de App 1 para aplicar los cambios. Son ayudas de lectura, no señales: el estudio de los 91 setups no encontró uno robusto. Solo BTC tiene almacén de trades.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE ORDER FLOW"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Estilos Oscuro, Personalizado y Muhammad

**Pedido:** tres estilos más:
- un modo oscuro;
- un Personalizado basado en Nítido que guarde los colores cambiados sin tocar el Nítido original;
- Muhammad, basado en Nítido con una paleta del arte islámico investigada a fondo.

**Cambios:**
1. **Cinco estilos** en el modal "Estilo": Nítido, Oscuro, Personalizado, Muhammad y Clásico. Oscuro, Personalizado y Muhammad dejan cambiar sus colores; Nítido queda fijo, con sus colores grises y una nota
2. **Colores propios por estilo:** cada estilo editable guarda solo lo distinto a su paleta: `ui_theme_colors` (Personalizado, que parte de Nítido), `ui_theme_colors_oscuro` y `ui_theme_colors_muhammad`. Cada color y cada estilo vuelven a su paleta con un botón. Lo que antes se cambiaba en Nítido queda ahora en Personalizado, y Nítido vuelve a sus colores de fábrica
3. **Oscuro, en el lienzo:** fondo `#131722`, barras `#1E222D`, texto con 12:1 de contraste y velas como Nítido. Los textos derivados se aclaran en vez de oscurecerse. CVD, Volumen de Respuesta, Interés abierto, Liquidaciones, S&R, S&R v2 y el perfil dejan sus blancos y negros fijos
4. **Oscuro, fuera del lienzo:**
   - el encabezado, las barras y los botones toman las variables del estilo;
   - el panel de trading, los menús, la pantalla de inicio y los modales se oscurecen con un filtro que invierte la luz y devuelve el tono, así un botón verde sigue verde;
   - fotos y selectores de color mantienen sus colores reales;
   - la confirmación de orden y "Nuevo VP Fixed Range" van al body, para que el filtro no los encierre
5. **Muhammad:** papel marfil de manuscrito, turquesa de cobre y rojo bol de Iznik en las velas, cobalto en el POC, oro de iluminación en el área de valor, azul y verde nazaríes medidos en la Alhambra, morado de manganeso, minio, tinta negra y acento verde esmeralda. Texto 16:1 y datos 3.3:1 o más. Fuentes: mediciones publicadas de la Alhambra y de un santuario safávida, fotos del Art Institute of Chicago, V&A, Khalili y Ashmolean

**IMPORTANTE:**
- Basta recargar la página: no hay cambios en el backend.
- Comparado con el código de antes en Edge sin ventana, con ocho indicadores, Nítido y Clásico dan 0 píxeles distintos en la vista general y en el footprint.
- Un indicador nuevo dibuja sus paneles con `THEME.chartBg`, sus etiquetas con `THEME.labelBg` y sus textos de color fijo con `chartInk()`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTILO NÍTIDO", "Oscuro, Personalizado y Muhammad" y "Paleta Muhammad"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Liquidaciones de Velas Fijadas en su Mecha

**Problema:** al fijar el máximo o el mínimo de una vela en el indicador Liquidaciones, se contaba lo liquidado en la mitad de la vela de ese lado, y la franja medía siempre 0.2%. El usuario preguntó si era solo el precio del máximo. Pidió contar el pabilo, como un rango de precios con un alto máximo en % que él pueda ajustar.

**Cambios:**
1. **Rango:** el máximo cuenta su mecha de arriba, del cuerpo al extremo; el mínimo, la de abajo. Suma 0.1% por fuera por redondeo, como antes
2. **Mínimo y tope:** hacia adentro toma al menos 0.1%, así una vela que cerró en su extremo cuenta lo de ese precio, y a lo sumo el "Alto máximo de la mecha (% del precio)" del modal ⚙️: 0.5% por defecto, de 0.1 a 5
3. **Franja y etiqueta:** la franja cubre el rango contado y la etiqueta lo dice (`rango 0.24%`), con `(tope)` si la mecha era más larga
4. **Velas fijadas antes:** no guardaron su cuerpo y cuentan la mitad de la vela, ahora con el tope. Para pasarlas a la mecha, soltarlas y fijarlas de nuevo

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. Probado en una copia con una vela de BTC 15m del 24/10 con mecha de 0.237%: la franja fue del cuerpo a 0.1% sobre el máximo. Con tope de 0.12% se acortó y la etiqueta dijo "(tope)". Con datos por día de MarginPad, el monto es el del día completo en esos precios, como antes.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LIQUIDACIONES", "Velas fijadas"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Footprints al Alejar la Vista

**Problema:** con la simulación iniciada el 01/01/2026, el Order Flow solo se dibujaba desde el 24/12/2025, aunque el almacén tiene todo 2025. El indicador dejaba de pedir footprints con más de 400 velas en pantalla, unos 4 días en 15m. Lo ya cargado se seguía viendo y lo anterior quedaba vacío, sin aviso.

**Cambios:**
1. **Más velas:** pide footprints con hasta 1600 velas en pantalla, sin pasar de 70 días de trades. En 4h queda casi igual: hasta 420 velas
2. **Pedidos acotados:** al desplazarse pide media pantalla de más a cada lado, hasta 200 velas, y ningún pedido pasa de 70 días
3. **Aviso:** con más velas, el gráfico dice "Order Flow: acerca el zoom para cargar los footprints", y lo ya cargado se sigue dibujando

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. Reproducido y probado en una copia: con 481 velas, el desplazamiento hacia atrás antes se detenía en el 21/12 y ahora carga hasta el 15/12. Medido en el backend: 1600 velas de 15m tardan 0.3 a 0.6 s (3 MB); 1600 de 1h, 2 s la primera vez.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ORDER FLOW SOBRE LAS VELAS", "Dibujo"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Colores Propios en los Modales de los Indicadores

**Problema:** con el estilo Nítido, un color cambiado en el modal del perfil de volumen no cambiaba nada; desde el modal "Estilo" sí. El usuario pidió que el estilo ponga los colores de todo, pero que lo cambiado en el modal de cada indicador se respete, incluidos el degradado y las intensidades de los perfiles.

**Cambios:**
1. **Regla:** cada indicador guarda en `customVisual` lo que el usuario cambió en su modal. Con Nítido eso se dibuja como lo dejó y el resto sigue el estilo. Una configuración anterior cuenta como propia si difiere del valor de fábrica
2. **Modales:**
   - perfil de volumen y VP de rango fijo: colores, clusters y degradado;
   - Order Flow: stacked de compra y de venta, y tamaño de las cifras;
   - confluencia OI y volumen: colores alcista y bajista;
   - volumen: intensidad, opacidad, degradado y brillo.
3. **Volver al estilo:** "Usar los del estilo" en el perfil y en la confluencia, y el botón de restablecer de los otros modales. Con Nítido, cada modal muestra el color que se dibuja
4. **Perfil de volumen:** el modal editaba un estado que los gráficos no leían. Ahora cambia el marco activo y sus colores pasan a todos los marcos. El modal "Estilo" suma el color "Clusters"
5. **Área de valor:** el perfil dinámico recibía 70 donde esperaba 0.70. Su área de valor abarcaba todo el perfil, con VAH y VAL en los extremos. En BTC 15m al 25/10 pasó de 81472.96 / 79186.95 a 81057.32 / 79925.86. Cambia también el Clásico
6. **VP de rango fijo:** el modal guardaba el ancho y el área de valor en otra unidad, y "Restaurar Defecto" dejaba las barras invisibles
7. **Volumen:** "Restaurar Valores por Defecto" borraba los colores de cluster y podía romper el dibujo hasta recargar. Además, cada cambio del modal se dibujaba con el valor anterior

**IMPORTANTE:**
- Basta recargar la página: no hay cambios en el backend.
- El Clásico da 0 píxeles distintos sin el perfil de volumen. Con el perfil activo, cambian solo el área de valor y sus líneas.
- Un VAH o VAL del perfil dinámico elegido para un trade anterior quedó en el extremo del perfil, y Rejection con el contexto "VP Dinámico" usaba esos mismos valores.
- La confluencia no guarda sus colores al recargar, como antes.
- Un indicador nuevo con colores en su modal sigue el patrón de `VP_FACTORY` con `isCustom()`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTILO NÍTIDO", "Ajustes propios en el modal de cada indicador"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Estilo Nítido con Colores Configurables

**Problema:** el usuario comparó App 1 con ATAS en su PC: App 1 se veía menos profesional. Mezclaba tres letras (el gráfico pedía "Inter", que no se carga y caía en Arial) y 240 colores sueltos de cuatro estilos distintos. Usaba 69 emojis como íconos, el eje de precios ponía valores sueltos y el footprint coloreaba oscuro el lado dominante aunque tuviera poco volumen. Pidió el cambio de estilo, eligió "Nítido" entre cinco paletas de prueba y pidió poder cambiar cada color.

**Cambios:**
1. **Estilo Nítido (por defecto):**
   - una sola letra, Segoe UI de 12 px;
   - velas #089981 y #F23645, con contraste parejo;
   - precios y horas redondos en los ejes, con el decimal de la moneda y la hora de Colombia;
   - leyenda con O, H, L, C, cambio y volumen de la vela bajo la cruz, y último precio en el eje;
   - sin brillo en el volumen.
2. **Footprint graduado:** cada celda toma color según su volumen. Las cifras van sin contorno y los desequilibrios en negrita, sin recuadro amarillo. El POC del perfil va en el color de acento.
3. **Interfaz:**
   - íconos de línea en lugar de emojis;
   - barra de dibujo con íconos y nombres, que se contrae a solo íconos;
   - botones neutros sobre el gráfico;
   - paneles de Delta, Interés abierto y Confluencia con títulos en español.
4. **Modal "Estilo y colores":** botón "Estilo" en el encabezado. Elige Nítido o Clásico y cambia 20 colores en seis grupos. Se ve al instante, se guarda en `localStorage` (`ui_theme`, `ui_theme_colors`) y se restablece. Los colores de texto se oscurecen solos si no se leen.
5. **Clásico:** el aspecto anterior queda idéntico, 0 píxeles distintos en el gráfico y el footprint.

**IMPORTANTE:** el usuario autorizó este cambio de estilos el 8/11. Basta recargar la página: el backend no cambió. Un indicador nuevo pregunta `isNewTheme()` al dibujar y toma sus colores de `THEME` (`components/uiTheme.js`).

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTILO NÍTIDO"

---

### APP 9 (OrderFlowDesktop) - 8 Noviembre 2026: Pruebas y Correcciones de Datos, Trading y Footprints

**Problema:** las pruebas de App 9 encontraron fallos que perdían datos, arriesgaban dinero real o mostraban footprints equivocados. El archivo local de footprints no se actualizaba desde el 05/11: cada sondeo de 5 s lanzaba otra descarga de 48 h a la nube, y la nube terminaba cortándolas. En BTC 5m las celdas mostraban el doble del volumen real, y en las monedas baratas cada vela quedaba en una sola celda.

**Cambios:**
1. **Panel de Trading:** abrirlo ya no deja el timeframe en `[object Promise]`: el temporizador del panel llamaba al setter del timeframe. La caja TP/SL se vuelve a leer cada 5 s y al cambiar de moneda, así que una orden ya no puede salir con el SL/TP de otra moneda. El badge muestra LIVE, TESTNET o DEMO según el bot, y los precios usan el tick de la moneda. Si la posición queda sin stop o el resultado es desconocido, un aviso pide no reintentar
2. **Archivo local:** una sola descarga por moneda a la vez y un intento cada 15 min. Baja las horas que faltan (48 a 168), comprimida y con corte real a los 180 s. Escribe primero a un temporal y luego reemplaza el archivo, en JSON compacto: BTC pasó de 89 a 64 MB con más datos. Si el archivo existente no se puede leer, no se sobrescribe. Se relee del disco solo si cambió
3. **Aplicar a historial:** ya no borra el archivo local y pausa de verdad el sondeo de Order Flow. El backend también limpia su caché en memoria: antes devolvía lo mismo. El historial conserva el step con que se grabó
4. **Footprints de 5m:** cada nivel va entero a la celda de su precio medio. El step de cada vela es el mayor entre el configurado y el de sus datos, y se aceptan steps menores de 0.01 (antes pasaban a 0.1). Volumen y delta se conservan exactos. POC, imbalances, stacked y z-score siguen la regla del backend en 1m. Archivo y backend se unen por minuto antes de agregar, y las velas del archivo quedan en caché
5. **Sondeo al backend:** pide los footprints completos cada 60 s y, entre medio, solo los últimos 10
6. **Gráfico:** con poco zoom o pocos días, Order Flow, VWAP y los paneles usan el mismo ancho por vela que las velas; antes se estiraban. El delta va debajo de la vela y el perfil marca el POC aunque sea el primer nivel. El campo de step size acepta valores como 0.002
7. **WebSocket de velas:** se reconecta tras un corte, envía ping cada 20 s y reconecta si pasan 60 s sin datos o vuelve la red
8. **Backend (App 5):**
   - La caché de velas se refresca al vencer; antes devolvía la misma foto hasta reiniciar
   - La consulta a la nube va en segundo plano; antes congelaba todo el backend hasta 50 s
   - El DELETE de caché valida el símbolo
   - Rejection solo avisa al bot por patrones de la vela actual o la anterior, con la hora del patrón para que el bot no repita la señal
9. **Arranque:** `1.START_ALL_ultimo.bat` espera hasta 10 min al backend y lo levanta solo en 127.0.0.1

**IMPORTANTE:** reiniciar el backend (11000) y App 9 para aplicar los cambios. Todo se probó en una copia aislada: backend en 11300, frontend en 11301, Electron oculto con una copia del archivo y un bot falso. Nada se probó contra el bot ni contra Bybit real.

**Pendiente (fases 3 y 4):**
- Swing cambia la config global desde el gráfico
- Steps del collector en la nube (XRP sigue en 0.005: 1 o 2 celdas por vela)
- Imbalance diagonal y tope de 100 niveles
- El relleno desde la nube al arrancar no llega a la API
- Hueco de 41 h del 03/11 en el archivo de BTC: se rellena con "Descargar ahora" del panel de Archivo

**Ver:** `9.OrderFlowDesktop/CLAUDE.md` sección "Pruebas y Correcciones (8 Noviembre 2026)"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Referencias en las Tres Imágenes

**Problema:** en el Observador, algunas referencias de un trade faltaban en una o dos de sus imágenes (Decisión, Apertura y Cierre) y sí salían en las otras. Un nivel nacido antes del borde izquierdo de la imagen se dibujaba, pero quedaba sin número. Uno fuera del rango de precio de la imagen no se dibujaba, como un objetivo justo debajo de las velas. Una marca fuera de la vista tampoco tenía número.

**Cambios:**
1. **Precio:** cada imagen abarca el precio de todos los niveles de su orden, con aire para su etiqueta
2. **Niveles anteriores:** un nivel que nace antes de la primera vela de la imagen lleva su número en el borde izquierdo, donde empieza su línea
3. **Marcas:** la imagen se aleja hasta la vela de cada marca, sin perder lo que mostraba y hasta 3 veces sus velas. Más lejos la imagen no cambia, para no dejar el trade en un rincón, y el número de la marca queda en el borde izquierdo, a su precio
4. **Gráfico:** no cambia. Solo las imágenes de los trades nuevos usan esto

**IMPORTANTE:** las imágenes ya tomadas no cambian: les siguen faltando esos números. No hay cambios en el backend: basta recargar la página.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "JOURNAL DE TRADES"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Nitidez del Gráfico

**Problema:** el gráfico se veía borroso y en pantallas grandes no mejoraba. El lienzo no usaba la densidad de la pantalla: con escala de Windows o zoom del navegador distinto de 100% el navegador lo estiraba. Además velas, mechas, líneas y celdas del footprint caían entre dos píxeles y se pintaban a medio tono, incluso a 100%. Las imágenes de trades se guardaban al tamaño de la pantalla.

**Cambios:**
1. **Densidad real:** el lienzo tiene los píxeles reales de la pantalla y se dibuja en píxeles CSS con esa escala. Se ajusta solo al mover la ventana a otro monitor o cambiar el zoom del navegador
2. **Píxeles enteros:** `components/chartPixels.js` lleva rectángulos y líneas horizontales y verticales a píxeles reales enteros: velas, volumen, ejes, cruz, perfiles, footprints, paneles, niveles y dibujos. Las mechas quedan centradas en el cuerpo
3. **Texto:** el lienzo es opaco, así el texto del gráfico sale con ClearType como el resto de la pantalla
4. **Imágenes de trades:** con el doble de píxeles que la pantalla, como mínimo. "Ver a tamaño real" del visor deja leer las cifras del footprint. Las marcas del Observador siguen en su lugar
5. **Sin cambios de estilo:** mismos colores, tamaños de letra y disposición. Una línea fina semitransparente ahora cae en una sola fila de píxeles y se ve más definida
6. **Velocidad:** igual que antes: 60 cuadros por segundo a 10000x con el lienzo a 1x, 1.5x, 2.25x y 3x, sin tareas largas, y el redibujo cuesta lo mismo (unos 4 ms)

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. En la consola, `localStorage.setItem('chart_pixel_ratio', 'off')` y recargar vuelve al dibujo anterior; `removeItem` lo deshace. Un indicador nuevo dibuja sus líneas horizontales con `alignY` y `crispWidth`, y las verticales con `alignX`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "NITIDEZ DEL GRÁFICO"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Niveles Elegidos por Trade

**Problema:** los niveles y marcas elegidos para un trade seguían elegidos al abrir el siguiente, y cada orden nueva se los volvía a llevar. Valen solo para el caso en que se eligieron.

**Cambios:**
1. **Al crear la orden:** lo elegido pasa a ella con su papel y su nota (`takeLevels()`), y la lista del panel queda vacía para el trade siguiente. En el gráfico se quitan sus líneas y aros, y el menú los muestra sin marcar
2. **Registro:** la orden conserva su copia. El historial, el Observador y el informe la siguen usando igual
3. **Imágenes:** cada imagen dibuja los niveles de su orden, no la lista del panel. La de una limit que se llena después no muestra lo elegido para otro trade
4. **Lista anterior:** la lista guardada antes de este cambio juntaba lo elegido para todos los trades y ya no se carga (`analysis_levels_v2_`). Después de la actualización empieza vacía

**IMPORTANTE:** no hay cambios en el backend: basta recargar la página.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "REGISTRO AUTOMÁTICO" y "JOURNAL DE TRADES"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Liquidaciones de Velas Fijadas

**Problema:** las zonas del indicador Liquidaciones solo miran 30 días hacia atrás, pero un barrido muy grande de hace meses puede seguir siendo soporte o resistencia.

**Cambios:**
1. **Fijar una vela:** con Liquidaciones activo, un clic en el máximo o el mínimo de una vela abre el menú de niveles con "Fijar liq. del máximo" o "Fijar liq. del mínimo"
2. **Franja propia:** queda una franja ámbar en ese precio, desde la vela hasta hoy, con lo liquidado en esa mitad de la vela y la fuente de su fecha. Si el precio la cruza queda tenue y punteada
3. **Lista propia:** las velas fijadas no son lo elegido para un trade. Siguen después de cada orden hasta que se sueltan, desde el menú o desde la lista del modal ⚙️ de Liquidaciones
4. **Análisis del trade:** un clic en la franja ofrece "Liq. de vela fijada", que entra con papel y nota a lo elegido y pasa a la orden como los demás niveles del Observador
5. **Sin futuro:** cada vela pide aparte sus liquidaciones, cortadas en la hora simulada. Con datos por día queda "parcial" hasta que cierra su día

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LIQUIDACIONES", "Velas fijadas"

---

### APP 1 (Backtester) - 7 Noviembre 2026: Indicador de Liquidaciones

**Problema:** el usuario usa las liquidaciones como zonas de barrido violento para estar alerta, y App 1 no tenía ese dato. Pidió "una especie de heatmap" con pocos niveles cerca del precio que cambien al avanzar la reproducción.

**Cambios:**
1. **Indicador "Liquidaciones":** hasta 3 zonas arriba y 3 abajo, a menos de 6%, con lo liquidado en 30 días. Rosada si se liquidaron largos y celeste si cortos, más opaca cuanto más dinero. Dos zonas mostradas dejan 0.25% de espacio, así un barrido ancho no llena el gráfico. Una zona que el precio atravesó queda tenue, punteada y marcada "cruzada"
2. **Fuentes:** MarginPad (todo el mercado, precio real por día), Coinalyze (todo el mercado, precio estimado con velas de 5 minutos), Binance Coin-M (un mercado) y Bitfinex (un mercado pequeño). En cada fecha manda la primera que la cubre, nunca se mezclan, y el gráfico dice cuál usa. En ⚙️ se puede fijar una
3. **Cobertura:** BTC tiene Coinalyze de julio 2021 a hoy, MarginPad del 08/10 al 07/11/2026, Coin-M de junio 2023 a octubre 2024 y Bitfinex en tramos sueltos. Las otras 6 monedas de App 1 tienen Coinalyze desde que Bybit tiene sus velas y MarginPad desde el 10/10/2026. Fuera de eso el indicador avisa y no dibuja nada
4. **Sin futuro:** el backend corta en la hora simulada. Un día de MarginPad se conoce al cerrar, un intervalo de Coinalyze también, y un evento en su hora. Con fecha oculta no muestra fuente, fechas ni montos
5. **Evidencia:** las zonas de Coinalyze coinciden con 76% de las de MarginPad, contra 33% por azar. Bitfinex acierta el lado como el azar, así que queda al final
6. **Velocidad:** a 10000x en 15m, 60 cuadros por segundo y ninguna tarea larga, igual que con el indicador apagado
7. **Datos:** `backend/liq_update.py` arma `OrderFlowData/liquidations`. La clave de Coinalyze la creó el usuario y está en `coinalyze_key.txt`, fuera del repositorio
8. **Actualización automática:** tarea programada de Windows "App1 Liquidaciones", todos los días a las 7:30 (`backend/liq_auto.py`, sin ventana). Coinalyze cada día y MarginPad cada 5 días. Registro en `OrderFlowData/liquidations/actualizacion.log`

**IMPORTANTE:** reiniciar el backend de App 1 para aplicar los cambios. MarginPad solo alcanza 30 días hacia atrás y Coinalyze unos 20 días en intervalos de 15 minutos: si la tarea deja de correr más de dos semanas, se pierde ese detalle.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LIQUIDACIONES"

---

### TradingBot + App 10 - 7 Noviembre 2026: Auditoría de Órdenes en Bybit

**Problema:** la auditoría de App 10 y del bot encontró 17 fallos que podían abrir operaciones sin stop, duplicarlas o darlas por fallidas cuando sí se ejecutaron. También fallaban el redondeo de precios en las alertas del Analizador y de OrderFlow, y el paso de cantidad en los formularios de App 8 y App 9.

**Cambios:**
1. **SL heredado:** cada alerta trabaja con una copia de la configuración (`get_coin_config()`), así que su SL o TP no pasa a la siguiente. Al cargar se limpian los restos guardados en `trading_config.json`
2. **Respuesta perdida:** `order/create` no se reenvía a ciegas. El bot busca la orden por su `orderLinkId` y revisa la posición. Si no la encuentra, queda `unknown` con aviso crítico
3. **Posiciones sin SL:** los dos métodos comprueban el SL de la posición. Si no se puede poner, la posición se cierra a mercado (`closed_unprotected`) con aviso crítico. El secuencial pone TP y SL sobre la posición
4. **Duplicados:** una alerta se salta si ya hay una entrada pendiente en la moneda. Un Limit automático que ya cruza el mercado se rechaza. Se descartan las alertas repetidas y las que llegan más de 120 s tarde (`sent_at`)
5. **Tamaño:** el riesgo incluye la comisión taker de entrada y salida, y a mercado se usa el último precio de Bybit. Si el mínimo de Bybit arriesga más que lo configurado, la orden no se envía. Paso, tick y mínimo salen de `instruments-info`
6. **Riesgo diario:** se reserva bajo un candado común antes de ejecutar, también en `/api/alert` y `/api/trade/manual`
7. **Apalancamiento:** se fija en Bybit el `leverage` de la configuración, una vez por moneda. El modo de posición y el de margen no se cambian
8. **API local:** escucha solo en `127.0.0.1` y rechaza peticiones de otras páginas web (CORS, `Origin` y Host)
9. **Pausa:** "Pausar todo el trading" en el panel de orígenes y en la bandeja (`/api/settings/trading-paused`)
10. **App 10:** notificación del sistema cuando una posición queda sin protección. En modo cobertura muestra los dos lados, cada uno con su SL y TP
11. **Otras apps:** el Analizador y OrderFlow ya no redondean a 2 decimales precios, distancias ni SL/TP, y mandan `sent_at`. El envío por lotes del Analizador solo manda zonas con el trade abierto. Los formularios de App 8 y App 9 leen `step_size`

**IMPORTANTE:** reiniciar el bot y los backends de App 4 y App 5 para aplicar los cambios. Las 26 pruebas pasan contra un Bybit simulado, y 25 fallan con el código anterior, pero nada se probó contra Bybit real: hay que confirmarlo en modo Demo antes de operar en real. Las copias de `TradingBot_Python` dentro de App 2, 4 y 5 no se tocaron y conservan los fallos.

**Ver:** `10.TradingBotDesktop/CLAUDE.md` sección "Correcciones de la auditoria"

---

### Panel Order Flow - 7 Noviembre 2026: Descargas de Bybit y Collector de App 9

**Cambios:**
1. **Descargas:** ventana tkinter en `PanelOrderFlow/` (doble clic en `Abrir panel.bat`). Descarga cualquier moneda, la pausa, la reanuda y la detiene, maneja la cola de `queue.txt` y arma el almacén de App 1
2. **Collector:** una segunda pestaña muestra el estado de la nube (Northflank), del backend local en el puerto 11000 y de la copia de App 9. "Buscar huecos" revisa las últimas 6 horas
3. **Qué toca:** solo escribe `control.json` y `queue.txt`, y lanza `ingest.py`, `build_store.py` y `queue_runner.py`. No modifica las herramientas ni borra archivos. "Detener ya" corta solo los procesos de esas herramientas

**IMPORTANTE:** del 2021-12-05 hacia atrás, Bybit entrega los archivos de BTC con las filas invertidas, y esos días quedan para "revisar": el volumen no cuadra en 180 a 270 de los 1,440 minutos. Falta investigarlo.

**Ver:** `PanelOrderFlow/LEEME.md`

---

### APP 1 (Backtester) - 7 Noviembre 2026: Filtro VWAP del Swing con Rectángulos, Imágenes con Contexto e Historial sin Retroceso

**Problema:** el filtro VWAP del Swing no actuaba en App 1. La primera imagen de cada trade salía con el zoom de leer footprints y mostraba pocas velas. Ir a un trade desde el historial retrocedía la hora simulada y ocultaba las velas posteriores. Los círculos del visor del Observador se confundían con los aros morados del gráfico.

**Cambios:**
1. **Swing:** con su filtro VWAP encendido y el indicador VWAP activo, el filtro actúa dentro de los rectángulos dibujados en el gráfico. Afuera las señales no cambian: los rectángulos no son lista blanca. No cuentan los rectángulos que definen un VP Fixed. Entre bandas la señal se descarta; cerca de la banda inferior solo quedan mínimos y cerca de la superior solo máximos
2. **Caché del Swing:** se recalcula al cambiar un rectángulo (al soltarlo, no mientras se arrastra) y con cada cálculo nuevo del VWAP. En reproducción no se recalcula en cada tick
3. **Imágenes:** la de decisión y la de apertura muestran unas 5 veces las velas que había a la vista, sin bajar de 3 px por vela. Tu vista no cambia. La de cierre sigue encuadrando el trade completo
4. **Historial:** la fila y 📍 llevan la vista a la entrada del trade sin mover la hora simulada, con lo que pasó después a la derecha. Para volver al presente está "Ir a última vela". Un trade posterior a la hora simulada, después de retroceder el reloj, no se abre
5. **Observador:** los círculos numerados sobre las imágenes y los números de "Marcas y notas" son azul claro, igual que la marca de "Ir al gráfico". Los aros de lo elegido en el gráfico siguen morados

**IMPORTANTE:** no hay cambios en el backend: basta recargar la página.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "JOURNAL DE TRADES" y "REPRODUCCIÓN LIGERA"

---

### APP 1 (Backtester) - 7 Noviembre 2026: Niveles con Papel, Marcas con Nota y Carga sin Velas Duplicadas

**Problema:** las medidas del Observador no decían qué papel cumplía cada nivel ni por qué importaba una señal, y desde la imagen de un trade no se podía volver al punto exacto del gráfico. Además algunas órdenes no se abrían, la carga inicial enviaba cada vela dos veces y seguían pendientes las bandas de VWAP y el filtro del Swing.

**Cambios:**
1. **Papel:** al elegir un nivel con un clic se marca si es Soporte, Resistencia, Entrada u Objetivo, con una nota de por qué importa. Se ve en el menú, en el panel, en el gráfico y en la lectura de la orden
2. **Más niveles:** FVG (borde alto, 50% y borde bajo), la línea de Double Top/Bottom y Order Flow (POC de la vela, stacked e imbalances sueltos). Order Flow solo ofrece con footprints a la vista y no dibuja nada extra
3. **Marcas con nota:** rombos y flechas de Volumen de Respuesta, señales de Swing, extremos de Double Top/Bottom, rechazos y rombos de delta contrario. Entran como "Solo marca" y pueden recibir un papel
4. **Imágenes:** cada imagen guarda dónde quedó cada nivel o marca de la orden. En el Observador salen numeradas sobre la imagen, con su nota al pasar el mouse. "Ir al gráfico" lleva la vista a ese punto sin mover la hora simulada
5. **Delta:** debajo de los footprints a 13 px, con tamaño elegible en el modal de Order Flow
6. **Órdenes que no se abrían:** con "Automática" y "Usar precio actual", un clic justo cuando cambiaba el precio dejaba la orden pendiente al precio anterior: 1 de cada 6 a 10 clics con la app cargada. Ahora entra a mercado. La caja TP/SL de una orden viva se podía mover y la orden seguía en sus precios: ahora vuelve a los de la orden
7. **Carga inicial:** cada vela viajaba dos veces, porque `subdivisions` era copia de `main`. La respuesta bajó de 422 a 238 MB y la primera carga de unos 80 s a unos 60 s. Baja a unos 40 s cuando el caché del servidor se guarde sin la copia
8. **VWAP:** las bandas de sesión empiezan en la primera vela de su sesión, como el backend. Antes salían de 2.5 a 3.7 veces más anchas. BandWidth, BBWP y TTM se recalibraron por marco y las primeras velas de cada sesión quedan en gris
9. **Swing:** el filtro VWAP lee las bandas correctas. Actúa dentro de los rectángulos del gráfico desde la entrada "Filtro VWAP del Swing con Rectángulos, Imágenes con Contexto e Historial sin Retroceso"
10. **Observador:** sin análisis por sesión del mercado, porque cripto opera 24/7. La hora UTC se queda
11. **ARB, SUI y TRX:** no recibían velas nuevas desde el 22-23 de octubre. La expansión hacia atrás terminaba sin la actualización ni el guardado. Ahora sigue con las velas nuevas y guarda `first_available_ts` para no repetirla. El Open Interest nuevo se suma por hora al guardado: antes reemplazaba una serie larga por unas semanas
12. **Presets de VWAP:** uno guardado en otro marco, sin marco o antes de esta ronda conserva la calibración del marco donde se carga

**IMPORTANTE:** reiniciar el backend de App 1 para aplicar los cambios. Un indicador nuevo con ayudas visuales las ofrece en `selectableLevels()` con su lugar ya calculado en el dibujo (`x`, `y`, `r`, o `left`, `right`, `top`, `bottom`) y sin dibujar nada para eso.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "REGISTRO AUTOMÁTICO", "JOURNAL DE TRADES", "ÓRDENES", "REPRODUCCIÓN LIGERA" y "ORDER FLOW SOBRE LAS VELAS"

---

### APP 1 (Backtester) - 7 Noviembre 2026: Reproducción Ligera, S&R v2 Nuevo e Imágenes en el Observador

**Problema:** la reproducción se frenaba, el filtro z-score de S&R v2 no parecía hacer nada y las medidas del Observador no se podían confirmar a ojo.

**Cambios:**
1. **Reproducción:** con S&R v2 y z=1.5 en 15m pasó de 4.5 ticks por segundo y bloqueos de 475 ms a la velocidad pedida exacta, sin bloqueos y con 9% del navegador. El Observador no era la causa: cuesta 0.1 ms por tick
2. **Reloj:** si un tick llega tarde recupera el tiempo debido. Las velocidades sobre 18750x ya funcionan. Las órdenes se revisan en cada tick y la pantalla se actualiza 10 veces por segundo
3. **Gráfico:** solo trabaja el marco visible, no copia ni filtra todo el historial en cada dibujo, y el límite de 33 ms ya actúa al mover el mouse. Salieron unos 55 console.log por tick
4. **Indicadores:** Double Top/Bottom, Swing, VP Fixed y VWAP dejaron de recorrer todo el historial. VWAP en 5m bloqueaba 23 s al activarse
5. **S&R v2:** recorre las velas hacia adelante (`swingLevels.js`). Un nivel vale hasta que una vela cierra más allá de todos sus toques. El filtro ahora quita líneas y el modal muestra su efecto antes de aplicar. Se aplica a todos los marcos y se conserva al reiniciar. Un campo vacío no se aplica y un valor fuera de rango queda en el límite del modal
6. **S&R clásico:** ya no usa velas ni niveles futuros (caché, backend y vela final)
7. **Imágenes en el Observador:** miniaturas de Decisión, Apertura y Cierre. Al abrirlas se ven junto a las medidas. Cada imagen dice su marco y su hora simulada. Las limit y stop guardan además lo que se veía al decidir
8. **Sin futuro:** el reloj se detiene un momento para tomar cada imagen. Informe y CSV ya no usan la lectura de órdenes vivas. Controles del informe y reglas solo usan lo que la corrida ya vivió. Una imagen o un resultado no se muestran si pasan de lo vivido o si revelan la fecha oculta, salvo con "Ver igual". Ir a un trade de la vela en curso ya no adelanta el reloj. La línea vertical, el CSV y el Excel también ocultan la fecha. Con fecha oculta la prueba de reglas no muestra la tabla por año y el CSV deja esas órdenes al final
9. **Órdenes:** una orden ya no puede cerrarse antes de llenarse. Con el equipo cargado, el efecto de la hora repasaba velas viejas y la orden salía con un resultado que no ocurrió. El fallo ya existía antes de esta ronda
10. **Configurar:** el reloj anterior se detiene al iniciar otra vez, y el nuevo toma la velocidad del selector. Antes quedaba andando sin poder pausarlo

**Pendiente, anterior a esta ronda:** las bandas de VWAP de sesión y el filtro VWAP del Swing. Se corrigieron en la entrada "Niveles con Papel, Marcas con Nota y Carga sin Velas Duplicadas".

**IMPORTANTE:** medido en BTC contra niveles al azar, los niveles de S&R v2 no aguantan más que un precio cualquiera, con o sin filtro de volumen. Es un mapa de estructura. Un indicador nuevo no debe recorrer `knownCandles` entero en cada dibujo: usa búsqueda binaria o calcula al cerrar una vela.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "REPRODUCCIÓN LIGERA" y "JOURNAL DE TRADES", y `1.Altagracia_Crypto_Backtester/CLAUDE.md` sección S&R v2

---

### APP 1 (Backtester) - 6 Noviembre 2026: Registro Automático de Operaciones + Zone Detector Eliminado

**Problema:** marcar motivos antes de entrar depende de la memoria y estorba la decisión. Para encontrar patrones en las operaciones hacían falta datos que se guardaran solos y momentos sin entrada con qué compararlas.

**Cambios:**
1. **Medidas:** `measures.py` arma una tabla con una fila por vela de 15m cerrada y 58 medidas de 15m, 1h y 4h: contexto, tramo, volumen contra lo normal de su hora, Volumen de Respuesta, volatilidad, FVG, perfil, OI, delta y hora UTC. Cada orden se lee ahí al decidir y al llenarse. Nada se muestra hasta que la orden termina
2. **Dibujos:** cada orden guarda los trazos hechos en las últimas 100 velas o que tocan esas velas. Los posteriores a la orden no cuentan
3. **Niveles:** clic sobre un POC, VAH, VAL, soporte o resistencia en el canvas abre un menú con la casilla "Incluir en el análisis". Sirve en Volume Profile, VP Fixed Range, VP Periodic, S&R y S&R v2. La lista queda en el panel de trading y viaja con cada orden
4. **Resultado:** R neto, lo máximo a favor y en contra, duración y espera. Las canceladas también cuentan
5. **Motivos:** salieron de la entrada. Son opcionales y se agregan cuando la orden termina
6. **Informe:** qué distingue las entradas de 10 momentos sin entrada por orden, qué separa ganadoras de perdedoras y referencias. Una diferencia se marca solo si supera lo que da el azar
7. **Reglas:** hasta 3 condiciones probadas en fechas no operadas, con costos, por año y contra la base sin condición. También hay CSV con todo el registro
8. **Zone Detector:** eliminado de App 1: pestaña Zonas, `ZoneDetectorTester`, `ZoneVisualizerIndicator`, `/api/zones/*`, `zone_*.py` y sus exportes. Las otras apps tienen el suyo y no dependían de este

**IMPORTANTE:** `measures.py` repite la regla de `responseBalance.js` y `research/response_volume/engine.py`. Si cambia una fórmula, hay que subir `VERSION` en `measures.py` para reconstruir la tabla.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REGISTRO AUTOMÁTICO"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Orden y Altura de Paneles + Estrategia Eliminada

**Cambios:**
1. **Orden:** cada panel de indicador tiene ▲▼ en el margen derecho
2. **Altura:** se arrastra el borde superior de cada panel. Solo cambia ese panel: el precio cede o recibe la diferencia
3. **Reparto:** se guarda por símbolo y lo comparten todos los marcos. La lista de indicadores trae un botón para restablecerlo
4. **Estrategia:** se quitaron la pestaña, `components/strategy/`, los endpoints `/api/strategies` y `strategy_*.py`. El panel Zonas no dependía de ella

**IMPORTANTE:** todo sigue en un solo canvas. El intento anterior con paneles separados dejó de dibujar los indicadores: los controles son HTML encima del canvas y el dibujo sigue centralizado en `renderIndicators()`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "Orden y altura de los paneles"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Volumen de Respuesta con Evidencia

**Problema:** el indicador usaba respuesta e iniciativa de Market Profile, que no es el concepto del usuario. Su idea viene de observación propia: cerca de una pausa o un giro, el volumen de la retracción se equipara al de la tendencia.

**Cambios:**
1. **Panel:** velas principales de compra contra las de venta. Arriba de cero pesa la compra y abajo la venta
2. **Señales:** rombo cuando la tendencia dominó y la respuesta la igualó. Flecha en velas con el doble o más del volumen normal de su hora
3. **Volumen por hora:** cada vela se compara con su misma hora en los 30 días anteriores. Sin ese ajuste la idea no se sostiene
4. **Evidencia:** en 2025 y 2026 el precio hizo nuevo extremo 5.6 pts menos en 15m y 10.6 menos en 1h que en situaciones iguales sin señal. En 4h no hay muestra. No anticipa dirección ni detecta techos o suelos
5. **Sin futuro:** `ResponseSeries` solo mira hacia atrás y se extiende con cada vela cerrada. 15m completo tarda 0.7 s

**IMPORTANTE:** `responseBalance.js` repite `research/response_volume/engine.py`. Si cambia la regla, hay que cambiar los dos y correr la paridad.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "VOLUMEN DE RESPUESTA" y `OrderFlowData/research/response_volume/INFORME.md`

---

### APP 1 (Backtester) - 6 Noviembre 2026: Órdenes por Riesgo, VP Periodic y Volumen de Respuesta

**Cambios:**
1. **Órdenes:** tamaño por monto fijo o por capital arriesgado, y tipo automático como en App 8. Toman entrada, stop y objetivo de la última caja TP/SL libre. Lejos del precio esperan: limit si el precio debe volver, stop si debe avanzar. Lógica en `orderPlan.js`
2. **Cajas TP/SL:** nacen con 45 px de riesgo, 130 px de ancho y riesgo beneficio 2, sin salirse del gráfico. Se miden en píxeles para verse igual en cualquier marco
3. **VP Periodic:** traído de App 8, con sesiones en hora UTC. Solo usa velas ya ocurridas y volumen real en sesiones terminadas
4. **Volumen de Respuesta:** ver la entrada "Volumen de Respuesta con Evidencia"
5. **Step:** con step automático una vela no pasa de 10 niveles (`maxLevels`). Una vela ancha une niveles y sube su propio step. Un step escrito a mano se respeta hasta 200 niveles
6. **Footprints:** se dibujan encima de los perfiles y demás indicadores
7. **Modales:** los de indicadores y el Observador quedaron en modo claro
8. **Pestaña Estrategia:** eliminada del frontend y del backend. Sus resultados dependían del futuro: detectaba las zonas con todas las velas antes de simular. También se borraron sus 8 estrategias guardadas, que siguen en el historial de git. El panel Zonas no dependía de ella

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "ÓRDENES", "SESIONES" y "ORDER FLOW SOBRE LAS VELAS"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Journal de Trades con Imagen

**Problema:** la imagen de cada trade nunca se pudo ver. El archivo se guardaba, pero al pedirlo `sanitize_filename()` le quitaba el punto y el backend buscaba `order_123png.png`. Además se tomaba al cerrar, y nada llegaba a la sesión sin guardarla a mano.

**Cambios:**
1. **Imagen de apertura:** se toma al abrir la posición, con indicadores y caja TP/SL. Mercado al crearla, limit y stop al ejecutarse. `OrderManager` ahora emite `tradeOpened` en los dos casos
2. **Imagen de cierre:** 10 velas después de cerrar (`EXIT_CAPTURE_CANDLES`), con el trade completo encuadrado sin cambiar la vista del usuario. Si la simulación no ha llegado, queda pendiente en `order.exitCaptureAt`, también al cargar la sesión
3. **Historial:** columna 📸 que abre las imágenes, con Apertura y Cierre. La fila y 📍 siguen llevando a la línea vertical
4. **Líneas verticales:** salen de las órdenes con `tradeBoundaries()`. Se ven en todos los marcos y vuelven al cargar una sesión. Antes solo existían en el marco activo y se perdían
5. **Navegación:** va a la ejecución del trade. En una orden limit iba a la hora en que se creó
6. **Sesión:** cada orden, ejecución, cierre y cancelación se guarda sola con `saveTradeSession()`. La primera operación crea la sesión si no existe. `mergeSession()` conserva nombre, fecha y notas
7. **Caja TP/SL:** su id queda en `order.tpslBoxId` y al cerrar termina en la hora de salida. `extendTPSLBox()` buscaba el tipo `tpslbox`, pero el tipo real es `tpsl`, así que nunca la encontraba

**IMPORTANTE:** todo dato nuevo de un trade va en la orden. `exportToJSON()` lo lleva a la sesión sin más código.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "JOURNAL DE TRADES"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Indicadores sin Futuro

**Problema:** VWAP, Swing, Rejection, Double Top/Bottom y Range Detection dejaban ver información que todavía no ocurría en la reproducción.

**Cambios:**
1. **VWAP:** la vela en formación salía de la vela final. En 4h eso anticipaba la dirección del resto de la vela en 81% de los casos. Ahora `_pointFor()` la calcula con lo ya ocurrido
2. **Swing:** no reconocía los marcos `1m` a `4h` y en 4h usaba 1 hora. Ahora una señal aparece al cerrar la última vela de su derecha
3. **Rejection:** marcaba la forma final de la vela mientras se formaba. Ahora solo marca velas cerradas y ya no analiza todo el historial en cada dibujo
4. **Double Top/Bottom:** todos los patrones aparecían 6 velas antes de poder conocerse. El detector entrega `knownAt` y `replacedAt`, y la flecha de entrada espera a que cierre su vela
5. **Range Detection:** el modal analizaba todas las velas, incluidas las futuras. Ahora recibe las cerradas y se ocultan rangos guardados que terminan después de la hora simulada
6. **Hora simulada:** Swing y Double Top/Bottom la leen de `priceContext.knownUntil` en cada dibujo. Antes solo la recibía la pestaña activa
7. **Double Top/Bottom al marcarlo:** calcula con la casilla, sin abrir ⚙️. Antes el precálculo corría cuando los gráficos aún no existían. Si el backend perdió las velas responde `needsCandles` y el indicador las reenvía. El detector ya no copia el historial por cada extremo: 15m completo tarda 0.7 s
8. **Rejection validado:** ahora sirve en backtesting. Envía las velas cerradas de la hora simulada y el backend valida cada vela solo con niveles cuyo rango ya terminó. Antes pedía velas recientes y el modal nunca le entregaba su configuración. Una simulación no envía alertas al bot

**IMPORTANTE:** un indicador nuevo que mire velas a la derecha debe decir cuándo se conoce cada señal. `allCandles` trae el futuro en backtesting: para calcular se usa `priceContext.knownCandles`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "INDICADORES SIN FUTURO"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Observador + Parámetros de Order Flow y FVG

**Problema:** faltaba poder cambiar step, imbalances y FVG, y faltaba medir cada operación manual contra la regla del laboratorio.

**Cambios:**
1. **Modal de Order Flow:** step por marco, ratio, comparación por nivel o diagonal, volumen mínimo, stacked, qué se muestra y zoom. El ⚙️ está junto al indicador. Aplica a todos los marcos y se guarda por símbolo
2. **Modal de FVG:** tamaño mínimo, cuándo deja de estar abierto, edad máxima, colores y opacidad
3. **Observador:** cada orden queda en `OrderFlowData/observer/journal.jsonl` con hora simulada, marco, perfiles, marcas y la lectura de la regla en ese minuto: contexto, movimiento, zona, OI y volumen
4. **Lectura oculta:** el backend no entrega la lectura hasta que la orden se cierra o se cancela. Ahí la pestaña 🔭 Observador muestra en qué coincidieron
5. **Informe:** qué condiciones se repiten, con y sin cada una, tú contra la regla, zona contra azar y mejores contra peores. Avisa si la muestra es pequeña
6. **Fecha oculta:** opción al iniciar. Elige un día al azar con trades descargados y muestra días relativos
7. **Retrocesos:** una orden creada después de retroceder el tiempo queda marcada y el informe la excluye por defecto

**IMPORTANTE:** `backend/observer.py` repite `readAt()` de `research/lab/engine.js`. Si cambia la regla, hay que cambiar los dos y correr `observer_parity.py`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "OBSERVADOR"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Reproducción sin Futuro + Footprints Reales sobre las Velas

**Problema:** la reproducción dejaba ver el futuro, la vista seguía 35% de pantalla detrás de la hora simulada y el order flow usaba un archivo de un mes. App 1 pasa a ser el puesto de trabajo manual, con los footprints de App 9 sobre las velas.

**Cambios:**
1. **Sin futuro:** `replayClock.js` arma la vela en formación con el marco más fino ya cerrado. Órdenes, VP y S/R solo usan lo ocurrido hasta la hora simulada
2. **Vista:** al seguir el precio, la vela más reciente queda a la vista (antes se escondían las últimas: unas 13 horas en 15m)
3. **Costos:** maker 0.02% y taker 0.055%, con TP y SL como taker, igual que el bot
4. **Almacén:** `OrderFlowData/store/` guarda por día, minuto y precio la compra y venta reales. `tools/build_store.py` lo crea desde `.tape` y `backend/footprint_store.py` lo lee
5. **Footprints:** `OrderFlowIndicator.js` usa el dibujo de App 9, pide solo las velas visibles y corta en `known_until`. Desde 16px el footprint reemplaza la vela, desde 60px hay cifras y delta; más angosto quedan líneas de stacked y marcas de delta contrario
6. **Zoom:** velas hasta 400px. Doble clic sobre una vela, con Order Flow activo, la acerca a 160px. El zoom vertical ahora se ancla al mouse con la escala real del dibujo
7. **Perfil y delta reales:** VP Fixed Range usa volumen real si el almacén cubre 99% del rango (muestra `· real` junto al POC). El panel Volume Delta usa delta real cuando todas las velas visibles lo tienen
8. **FVG:** indicador nuevo con la regla del laboratorio, solo con velas ya cerradas
9. **Caché:** si IndexedDB no puede guardar, la app sigue. Antes quedaba para siempre en "Cargando datos..."
10. **Open Interest:** `backend/oi_store.py` lee `OrderFlowData/oi/{SYMBOL}_5min.csv`, y el indicador pide solo la ventana visible. Antes solo había unos 22 días en caché
11. **Altura:** el gráfico llena la ventana sin scroll. El precio recibe primero su parte (`priceChartRatio`, 65% por defecto) y los paneles se comprimen hasta 48px. Antes el alto salía de la mitad del ancho

**IMPORTANTE:** después de descargar más días, correr `python -B C:\Users\inven\OrderFlowData\tools\build_store.py BTCUSDT`. Reiniciar el backend de App 1 para aplicar los cambios.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ORDER FLOW SOBRE LAS VELAS"

---

### TradingBot + Backends - 4 Noviembre 2026: Filtro de Alertas por Origen

**Problema:** Se atribuian al Analizador alertas que en realidad enviaba el backend de Order Flow (`5.Order_flow/backend`). Los backends 2, 4 y 5 usan la misma etiqueta `SWING_DETECTOR`, y la configuracion por simbolo ignoraba el apagado global.

**Cambios:**
1. **Filtro en el bot:** `/api/watchlist-alert` exige un campo `origin` permitido (`ANALIZADOR`, `WATCHLIST`, `ORDERFLOW`). Lo desconocido o sin origen responde 403 y se registra como `BLOCKED_ORIGIN:<origen>` en `alerts_received.log`
2. **Persistencia:** `allowed_origins` en `3.TradingBot_Python/config/bot_settings.json`. Por defecto solo `ANALIZADOR` esta habilitado
3. **UI:** panel "Alert Origins" en el dashboard de App 10 (`AlertOriginsPanel.jsx`)
4. **Swing (backends 4 y 5):** el apagado global tiene prioridad sobre la configuracion por simbolo
5. **Analizador:** `toggle-alerts` ya no detiene el servicio Swing, `/api/pattern-alert` respeta `alertsEnabled` y Rejection queda deshabilitado por defecto
6. **Watchlist:** DTB y Rejection siguen detectando con alertas apagadas; solo se omite el envio
7. **Order Flow:** `POST /api/swing/toggle-alerts` y un interruptor global de Swing en App 9, igual al del Analizador. Reemplaza la casilla por simbolo
8. **Swing en Analizador y Order Flow:** al cambiar de timeframe el servicio ahora se suscribe al nuevo intervalo (`reanalyze_historical`). Antes solo se suscribia al arrancar, y las velas en vivo se descartaban sin dejar rastro en `swing_alerts.log`
9. **Origen visible:** `origin` aparece en System Logs, como ultima columna de `alerts_received.log`, en `/api/alerts/recent` y en el historial de ordenes. La columna `source` no cambia porque la usa el Trading Journal
10. **Swing en Watchlist:** mismos limites del Analizador (`MAX_DAYS_BY_INTERVAL`, `MAX_CANDLES_ABSOLUTE`). Antes 1m con 90 dias pedia 129,600 velas por simbolo y congelaba el backend
11. **Watchlist, alertas:** el boton global usaba atributos inexistentes de `ConfigStore` y nunca confirmaba. El WebSocket arranca con los simbolos e intervalo del Swing (antes solo BTC y ETH). Bandas VWAP con sumas acumuladas (7200 velas: de 30s a 0.4s, mismo resultado), porque bloqueaban el backend y hacian caducar las alertas. El bot muestra cada bloqueo en System Logs

**IMPORTANTE:** Todo emisor nuevo hacia `/api/watchlist-alert` debe incluir `origin`, o el bot lo rechazara. Reiniciar el bot y los backends para aplicar los cambios.

---

### APP 9 (OrderFlowDesktop) - 4 Noviembre 2026: Limpieza de Rendimiento + Fix Footprints 5min

**Problema:** Aplicación muy lenta por exceso de console.log (151 en OrderFlowIndicator.js) y código debug acumulado.

**Cambios:**
1. **Limpieza de logs:** De 151 a 43 console.log/warn/error. Eliminados todos los logs per-frame, per-cell y per-second
2. **Eliminado aggregation-logger.js:** Módulo que escribía JSON a disco en cada agregación
3. **Eliminado debug rendering:** Columna de precios amarilla con sombras CSS costosas por celda por frame
4. **Fix footprints 5min recientes:** Backend retorna fps de 1min pero no se agregaban antes del merge. Agregado paso 2.5 en `fetchFootprints()` que agrega backend fps de 1min→5min antes del merge

**Archivos modificados:**
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` - Limpieza masiva de logs y debug
- `9.OrderFlowDesktop/src/utils/aggregation-logger.js` - **ELIMINADO**

**Ver:** `9.OrderFlowDesktop/CLAUDE.md` secciones "Limpieza de Rendimiento" y "Fix: Footprints no Cubren Velas en 5min Recientes"

---

### APP 8 (AnalizadorDesktop) - 20 Octubre 2026: Indicador Liquidation Clusters

**Implementación completa del indicador Liquidation Clusters con visualización en 3 capas y configuración UI.**

**Sistema de Renderizado en 3 Capas (Opción 4 - Modo Sutil):**
- **Top 3:** Líneas completas + labels compactos (opacidad 0.5-0.7)
- **Clusters 4-10:** Triángulos en borde + líneas punteadas (opacidad 0.2-0.5)
- **Clusters 11-50:** Sombreado muy sutil (opacidad 0.05)

**Labels Compactos:** Formato `🔥 🔻$2.5M 85%` (icono ranking + dirección + volumen + magnetic strength)

**Configuración Visual:**
- `labelPosition`: 'left' | 'right'
- `showTop3Lines`, `showMid7Markers`, `showRestShading`: true/false

**Bugs Corregidos:**
1. Gráfico desaparece → Firma incorrecta `renderOverlay()` → Corregida
2. Canvas corrupto → 120 `save()/restore()` por frame → Optimizado a 2
3. `priceToY` undefined → Sin validación `priceContext` → Helper con fallback
4. Bounds incorrectos → `.left/.right/.top/.bottom` → Cambiado a `.x/.y/.width/.height`

**Archivos modificados:**
- `src/components/indicators/LiquidationClustersIndicator.js` - Sistema 3 capas + updateConfig()
- `src/components/LiquidationClustersSettings.jsx` - Modal de configuración (NUEVO)
- `src/components/SingleSymbolAnalyzer.jsx` - Handlers + integración modal
- `src/components/MiniChart.jsx` - Botón config `🔥 LC` (rosa #E91E63)
- `src/components/indicators/IndicatorManager.js` - Getter `getLiquidationClustersIndicator()`

**Rendimiento:** 60x más rápido (de 5ms a 0.8ms por frame)

**Acceso:** Activar indicador → Click botón `🔥 LC` → Modal de configuración

**Ver documentación detallada:** `8.AnalizadorDesktop/CLAUDE.md` sección "Indicador Liquidation Clusters"

---

### APP 9 (OrderFlowDesktop) - 20 Octubre 2026: Fix Footprints Solo en Últimas 12h + Alturas Inconsistentes

**Problema:** Footprints solo se mostraban en las últimas 12h en timeframe 5min (20-30 días disponibles). Adicionalmente, celdas con alturas inconsistentes.

**Fixes implementados (todos resueltos):**
1. Preservar price_min/price_max en agregación (evita levelHeight=0)
2. Auto-download de archivos desactualizados (>12h)
3. Timestamp tolerance (30s)
4. Regenerar levels con step_size uniforme (grid fijo)
5. Step_size GLOBAL como MODA + sistema de 4 prioridades (backend > config > moda > default)
6. Expansión dinámica de levels en renderizado
7. Callback `onBackendConfigSaved` con pausa de PollingCoordinator + eliminación de archivo local
8. Backend DELETE endpoint limpia memoria + disco

**Ver documentación detallada:** `9.OrderFlowDesktop/CLAUDE.md`

---

### APP 1 (Backtester) - Octubre 2026: Header Fusionado + Fix Open Interest + UI Optimizations

**Cambios completados:**
1. **Header Fusionado (40px único)**: Eliminado header duplicado en main.jsx, consolidado todo en BacktestingApp.jsx con position fixed
2. **Fix Open Interest Endpoint**: Corrección de parámetros `Optional[int]` para start/end timestamps + import de typing
3. OI descarga datos a resolución real del timeframe (sin forward-fill/interpolación)
4. Mapeo directo: 1m→5min, 5m→5min, 15m→15min, 1h→1h, 4h→4h
5. MAX_OI_REQUESTS aumentado a 600 para máxima cobertura histórica
6. Backend retorna metadata de cobertura OI (fecha desde/hasta, intervalo)
7. Frontend muestra mensaje informativo con fecha exacta de disponibilidad
8. Helper `_getOICoverageMessage()` centraliza lógica en 3 modos de render

**Archivos modificados:**
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/main.jsx` - Eliminado header duplicado (50px)
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/backtesting/BacktestingApp.jsx` - Header único con icono, 40px
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/backtesting_styles.css` - Header position fixed, padding-top
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/backtesting/TimeframeTabs.css` - Tabs compactos (26px)
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/drawing/DrawingSidebar.css` - Alineado (top: 40px)
- `1.Altagracia_Crypto_Backtester/Backtester/backend/main.py` - Fix parámetros `Optional[int]` (líneas 5, 633-634)
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/indicators/OpenInterestIndicator.js` - metadata, cobertura

**IMPORTANTE**: Después de modificar `main.py`, es necesario **reiniciar el backend** para que los cambios tomen efecto (Ctrl+C y `start_backend.bat`).

### APP 1 (Backtester) - Febrero 2026: Reversion IndicatorPanel + Fix Open Interest Loading

**Problema 1: Intento Fallido de IndicatorPanel con Drag-and-Drop**

Se implementó un sistema de paneles de indicadores separados con funcionalidad de drag-and-drop para reordenar, redimensionar y gestionar indicadores de manera independiente:
- `IndicatorPanel.jsx` - Componente de panel individual con drag handles y resize
- `IndicatorPanel.css` - Estilos profesionales con animaciones y estados drag/drop
- Integración en `MiniChart.jsx` con estado `indicatorLayout` y ref `indicatorBoundsRef`

**Síntomas del fallo:**
- Los indicadores dejaron de aparecer completamente en el gráfico
- El canvas no mostraba ningún indicador después de la integración
- La lógica condicional para renderizar en IndicatorPanel vs canvas directo causaba conflictos
- El renderizado se intentaba hacer en refs de canvas individuales en lugar del canvas principal

**Solución aplicada:** Reversión completa de todos los cambios relacionados con IndicatorPanel

**Archivos revertidos:**
- `MiniChart.jsx`: Eliminado import, estado `indicatorLayout`, ref `indicatorBoundsRef`, lógica condicional, componente JSX
- Restaurado renderizado simple directo en canvas principal con `indicatorManagerRef.current.renderIndicators()`

**Resultado:** Los indicadores volvieron a aparecer correctamente.

**Lección aprendida:**
- El renderizado de indicadores en canvas es extremadamente sensible a la sincronización de bounds y contexts
- Separar indicadores en paneles independientes requiere arquitectura más compleja que la actual
- La lógica condicional para alternar modos de renderizado puede causar race conditions
- Es mejor mantener un sistema de renderizado simple y centralizado para indicadores en canvas

---

**Problema 2: Open Interest Data Loading**

Después de revertir los cambios de IndicatorPanel, el indicador de Open Interest no cargaba datos:
- UI mostraba "no hay datos de open interest para btcusdt"
- Backend no mostraba logs de fetch a Bybit API
- El indicador estaba habilitado pero no disparaba `fetchData()`

**Causa raíz:** Validación de datos incompleta en `IndicatorManager.js` método `updateIndicatorStates()`:

```javascript
// INCORRECTO (línea 332):
if (!indicator.dataMap || indicator.data.length === 0) {
  // Error: dataMap es un Map, necesita .size no .length
}
```

**Solución aplicada:**

```javascript
// CORRECTO:
if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
  console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
  promises.push(indicator.fetchData());
}
```

**Logging de diagnóstico agregado:**
- `OI State Check` - Verifica estado inicial del indicador
- `OI Data Validation` - Valida presencia de datos y decide si recargar

**Archivos modificados:**
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/indicators/IndicatorManager.js` - Fix validación Open Interest + logging

**Resultado:** Open Interest ahora carga datos correctamente al estar habilitado.

**Patrón de validación para indicadores backend:**

Todos los indicadores que requieren datos del backend deben validar correctamente en `updateIndicatorStates()`:

```javascript
const backendIndicators = ["VWAP", "Open Interest", "Double Top/Bottom", "Support & Resistance", "Rejection Patterns"];

// En bloque: else if (shouldBeEnabled && wasEnabled)
if (backendIndicators.includes(indicator.name)) {
  // Validación específica por tipo de estructura de datos:

  // Arrays:
  if (indicator.name === "Support & Resistance") {
    if ((!indicator.resistances || indicator.resistances.length === 0) &&
        (!indicator.supports || indicator.supports.length === 0)) {
      promises.push(indicator.fetchData());
    }
  }

  // Maps (usar .size):
  else if (indicator.name === "Open Interest") {
    if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
      promises.push(indicator.fetchData());
    }
  }

  // Objetos:
  else if (indicator.name === "VWAP") {
    if (!indicator.vwapData || Object.keys(indicator.vwapData || {}).length === 0) {
      promises.push(indicator.fetchData());
    }
  }
}
```

---

# APP 1: ALTAGRACIA CRYPTO BACKTESTER

**Ubicacion:** `1.Altagracia_Crypto_Backtester/Backtester/`

Sistema profesional de backtesting para criptomonedas con analisis avanzado de patrones, volumen y momentum.

## Estructura
