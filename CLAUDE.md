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
| `9.OrderFlowDesktop/` | **Order Flow Desktop - Version Electron optimizada** | 11000 | 5175 |
| `10.TradingBotDesktop/` | **Trading Bot Desktop - Version Electron** | 5000 | 5001 |
| `11.TradingJournalDesktop/` | **Trading Journal Desktop - Version Electron** | 12000 | 12002 |

**Stack comun:**
- Frontend: React 18 + Vite + uPlot
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)
- Desktop: Electron 33+ (Apps 7-11)

---

## HISTORIAL DE CAMBIOS RECIENTES

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
