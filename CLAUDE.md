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
