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
