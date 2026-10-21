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

### APP 9 (OrderFlowDesktop) - 20 Octubre 2026: Fix Footprints Solo en Últimas 12h (Timeframe 5min)

**Problema:** Los footprints solo se mostraban en las últimas 12 horas en timeframe de 5 minutos, a pesar de tener 20-30 días de datos. En 1 minuto funcionaba correctamente.

**Causas raíz:**
1. **Price ranges colapsados en agregación**: Al agregar footprints 1min → 5min, `price_min === price_max`, causando `levelHeight = 0` → rechazaba todos los levels en renderizado
2. **Archivo desactualizado**: Gap de ~27.5h entre último footprint del archivo (17 Oct 22:40) y primeros del backend (20 Oct 02:08)

**Soluciones implementadas:**

1. **Preservar rangos de precio en agregación** (`_aggregateFootprints()` líneas 211-390):
```javascript
// ✅ Preservar y expandir price_min/price_max al combinar levels
if (level.price_min != null && level.price_min < combined.price_min) {
  combined.price_min = level.price_min;
}
if (level.price_max != null && level.price_max > combined.price_max) {
  combined.price_max = level.price_max;
}
```

2. **Auto-download de archivos desactualizados** (`_loadFromArchive()` líneas 442-460):
```javascript
// Si archivo >12h antiguo, descargar automáticamente
if (ageHours > 12) {
  this._autoDownloadArchive().catch(err => { ... });
}
```

3. **Timestamp tolerance** configuración: `timestampToleranceMs: 30000` (30s de tolerancia)

**Resultado:** ✅ **PROBLEMA RESUELTO**
- Verificado con 20 días en timeframe 5min
- Todas las velas tienen footprints (no solo últimas 12h)
- Auto-download cierra gaps automáticamente

**Segundo fix (mismo día):** Alturas inconsistentes de price levels en footprints
- **Problema 1:** Celdas individuales con alturas radicalmente diferentes
  - **Causa:** Combinar levels expandiendo rangos
  - **Solución:** Regenerar levels con step_size uniforme (grid fijo)
- **Problema 2:** Footprints incompletos (más bajos que velas)
  - **Causa:** Filtrar levels vacíos + threshold renderizado 2px muy alto
  - **Solución:** NO filtrar vacíos + threshold a 0.5px + color gris para vacíos
- **Problema 3 (CRÍTICO):** Algunos footprints con celdas más pequeñas que otros
  - **Causa:** Calcular step_size independientemente por cada grupo de 5min → si archivo tiene 90% footprints con step_size=0.1 y 10% con step_size=1.0, la mayoría de grupos usan 0.1 (footprints bajitos)
  - **Intento fallido 1:** Usar `Math.max()` por grupo → solo grupos "afortunados" con step_size=1.0 quedaban altos
  - **Intento fallido 2:** Usar `Math.max()` global → si distribución es 89% con 0.1, 10% con 1.0, 1% con 10 → elige 10 (usado solo por 1%) → celdas gigantes → mayoría de footprints bajitos
  - **Solución parcial:** Calcular step_size GLOBAL como **MODA** (valor más frecuente) y reutilizar para TODOS los grupos
- **Problema 4 (CRÍTICO):** Después de moda, el problema persistió - celdas con diferentes alturas en píxeles (2px vs 4px)
  - **Causa raíz:** El problema NO está en agregación sino en RENDERIZADO - `priceToY()` produce diferentes alturas visuales para mismo step_size debido a redondeo
  - **Solución - FASE 1:** Sistema de prioridades para step_size configurable
  - **Bug 1 detectado:** Sistema usaba step_size de footprints en memoria (incorrecto)
  - **Fix temporal:** Eliminada prioridad "backend", usar MODA
  - **Bug 2 detectado:** Configuración manual del usuario (modal) ignorada al agregar
  - **Fix FINAL:** Consultar backend antes de agregar para obtener step_size configurado
  - **Prioridades finales:**
    1. Backend (configurado vía modal/API) - consulta `GET /api/orderflow/step-size/${symbol}`
    2. Config localStorage (`stepSizeOverride`)
    3. Moda de footprints a agregar
    4. Default (0.1)
  - **Estado:** Fase 1 ✅ COMPLETA (con 2 fixes críticos)
- **Problema 5 (CRÍTICO):** Después de Fase 1, celdas uniformes PERO altura total del footprint no coincide con vela
  - **Causa raíz:** Los footprints agregados calculan OHLC de los footprints 1min (no de la vela real) → footprints más pequeños que velas
  - **Solución - FASE 2:** Expansión dinámica de levels en renderizado:
    - Detecta si footprint no cubre rango completo de vela
    - Agrega levels vacíos (gris) arriba/abajo para cubrir gaps
    - Se hace en renderizado (eficiente, no modifica footprint original)
  - **Estado:** Fase 2 ✅ COMPLETA

- **Problema 6 (CRÍTICO):** Después de fixes anteriores, configuración manual funcionaba solo en velas nuevas
  - **Causa:** Botón "Aplicar a historial" eliminaba cache backend pero NO recargaba footprints en memoria
  - **Solución:** Callback `onBackendConfigSaved` que limpia footprints y recarga desde cero
  - **Estado:** ✅ RESUELTO

- **Problema 7 (CRÍTICO FINAL):** Después del Problema 6, footprints históricos SEGUÍAN sin actualizarse visualmente
  - **Síntomas:** Solo footprints en tiempo real mostraban nuevo step_size, históricos seguían con step_size antiguo. Al hacer "Aplicar a historial", gráfico cambiaba momentáneamente y luego volvía al estado anterior.
  - **Causa raíz 1 - Archivo local:** Archivo `userData/footprint_archive/SYMBOL_1.json` contenía footprints de 1min generados con step_size ANTIGUO (10 o 20). Al reagregarlos con nuevo step_size (5), NO se puede recrear granularidad que nunca existió.
  - **Causa raíz 2 - Race condition:** PollingCoordinator ejecutaba fetchFootprints() en background cada 5s. Al eliminar archivo, ya había una lectura en progreso que completaba DESPUÉS y sobrescribía los datos nuevos.
  - **Causa raíz 3 - Doble callback:** Tanto botón "Guardar" como "Aplicar a historial" ejecutaban el callback, causando dos recargas.
  - **Solución DEFINITIVA:**
    1. Agregado método `deleteArchiveFile(symbol)` en `FootprintArchiverElectron.js`
    2. Callback PAUSA PollingCoordinator → Espera 500ms → Elimina archivo → Recarga → REANUDA PollingCoordinator
    3. Eliminado callback de botón "Guardar" (solo ejecuta en "Aplicar a historial")
  - **Estado:** ✅ **PROBLEMA RESUELTO COMPLETAMENTE**

**Archivos modificados:**
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` (línea 136) - Config `stepSizeOverride`
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` (líneas 220-221) - Parámetro `backendStepSize`
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` (líneas 253-330) - Sistema de 4 prioridades
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` (líneas 571-586) - Consulta backend antes de agregar
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` (líneas 1327-1430) - Expansión dinámica de levels (Fase 2)
- `9.OrderFlowDesktop/src/components/SingleSymbolAnalyzer.jsx` (líneas 1151-1230) - Callback pausa polling + elimina archivo + reanuda (Problema 7)
- `9.OrderFlowDesktop/src/components/OrderFlowSettings.jsx` (líneas 236-242) - Eliminado callback de handleSaveStepSize (Problema 7)
- `9.OrderFlowDesktop/src/services/FootprintArchiverElectron.js` (líneas 514-559) - Método `deleteArchiveFile()` (Problema 7)
- **`5.Order_flow/backend/main.py` (líneas 4386-4445) - Endpoint DELETE limpia memoria + disco (Problema 7)** ← FIX BACKEND CRÍTICO
- `9.OrderFlowDesktop/CLAUDE.md` - Documentación completa de todos los fixes

**Ver documentación detallada:** `9.OrderFlowDesktop/CLAUDE.md` secciones:
- "Fix COMPLETO: Footprints Solo en Últimas 12h"
- "Fix: Alturas Inconsistentes de Price Levels en Footprints"
- "Fase 1: Sistema de Step Size Configurable" (incluye 3 FIXES CRÍTICOS)
- "Fase 2: Expansión Dinámica de Levels"
- "Fix CRÍTICO: Footprints Históricos No Se Actualizan al Cambiar Step Size" (Problema 7 - SOLUCIÓN DEFINITIVA)

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
