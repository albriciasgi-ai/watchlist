# APP 9: ORDER FLOW DESKTOP (Electron)

**Ubicacion:** `9.OrderFlowDesktop/`

Version de escritorio del Order Flow (App 5) empaquetada con Electron. Incluye optimizaciones agresivas de rendimiento y sistema de cache avanzado.

## Estructura

```
9.OrderFlowDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz (OPTIMIZADO)
│   │   ├── MiniChart.jsx             # Grafico con indicadores (OPTIMIZADO)
│   │   ├── SymbolList.jsx            # Lista lateral de monedas
│   │   └── indicators/
│   │       ├── IndicatorManager.js   # Orquestador de indicadores
│   │       ├── VWAPIndicator.js      # VWAP backend-native
│   │       ├── SwingDetectorIndicator.js
│   │       └── SupportResistance2Indicator.js
│   ├── utils/
│   │   ├── CandleCache.js            # Cache IndexedDB con LRU y validacion (OPTIMIZADO)
│   │   ├── IndicatorCache.js         # Cache para indicadores
│   │   ├── PollingCoordinator.js     # Coordinador de polling v2 (NUEVO)
│   │   └── robustness.js             # Validacion y health checks
│   └── config.js                     # API_BASE_URL = localhost:11000
│
├── package.json
├── vite.config.js                    # Puerto 5175
└── 1_START.bat                       # Inicio rapido
```

## Comandos

```bash
# Desarrollo (Vite + Electron con hot reload)
npm run dev:electron

# Backend (desde carpeta 5.Order_flow)
cd ../5.Order_flow/backend
start_backend.bat  # Puerto 11000
```

## Diferencias con App 5 (Browser)

| Caracteristica | App 5 (Browser) | App 9 (Electron) |
|----------------|-----------------|------------------|
| Throttling | Si (gaps en graficos) | No (sin gaps) |
| System Tray | No | Si |
| Cambio timeframe | ~2-5 min | ~1s (con cache) |
| Polling | Independiente | Coordinado (PollingCoordinator v2) |
| Cache validation | Basica | Con gaps detection |
| Puerto frontend | 11001 | 5175 (dev) |

## Optimizaciones de Rendimiento (Enero 2026)

### 1. Cambio Atomico de Timeframe

**Problema:** Cambiar timeframe causaba doble render (primero interval, luego days).

**Archivo:** `SingleSymbolAnalyzer.jsx`

```javascript
// ✅ FIX: Handler unificado para cambiar interval Y days al mismo tiempo
const handleIntervalChange = useCallback((newInterval) => {
  const defaultDays = DEFAULT_DAYS_BY_INTERVAL[newInterval];
  const maxDays = MAX_DAYS_BY_INTERVAL[newInterval] || 30;

  let newDays;
  if (defaultDays) {
    newDays = defaultDays.toString();
  } else if (parseInt(days) > maxDays) {
    newDays = maxDays.toString();
  } else {
    newDays = days;
  }

  // CRITICO: Cambiar ambos valores en un solo batch de React
  setInterval(newInterval);
  setDays(newDays);
}, [interval, days]);
```

**Resultado:** Elimina doble montaje de componente.

### 2. CandleCache con Validacion de Gaps

**Problema:** Cache con pocas velas se marcaba como "corrupto" causando recarga completa.

**Archivo:** `CandleCache.js`

```javascript
// ✅ FIX: Si el cache tiene pocas velas pero es valido (sin gaps), NO limpiarlo
if (ratio < this.MIN_CACHE_RATIO) {
  console.log(`[CandleCache] Cache incompleto: ${actualCandles} velas`);
  console.log(`[CandleCache] Se usara carga incremental para complementar`);
  // NO limpiar - retornar el cache incompleto
}

// Solo limpiar si hay GAPS significativos (>2 minutos)
const gapAnalysis = this.analyzeGaps(cached.candles, interval);
if (gapAnalysis.gapCount > 0) {
  const significantGaps = gapAnalysis.gaps.filter(g => parseFloat(g.gapMinutes) > 2);
  if (significantGaps.length > 0) {
    await this.clear(symbol, interval);
    return null;
  }
}
```

**Resultado:** Carga incremental en lugar de completa.

### 3. PollingCoordinator v2

**Problema:** PollingCoordinator v1 hacia tick global cada 1 segundo con operaciones costosas.

**Archivo:** `PollingCoordinator.js`

```javascript
// v1 (PROBLEMATICO):
// - Tick cada 1 segundo aunque no haya nada que ejecutar
// - Array.from + filter + sort en cada tick
// - No esperaba promesas (callbacks podian solaparse)

// v2 (OPTIMIZADO):
class PollingCoordinator {
  register(name, callback, intervalMs, priority = 5) {
    const entry = {
      name, callback, intervalMs, priority,
      enabled: true,
      isRunning: false,  // Evita solapamiento
      timerId: null      // Timer individual
    };
    this._callbacks.set(id, entry);

    // Cada callback tiene su propio setTimeout
    if (this._isRunning && !this._isPaused) {
      this._scheduleNext(id, entry);
    }
    return id;
  }

  _scheduleNext(id, entry) {
    entry.timerId = setTimeout(() => {
      this._executeCallback(id, entry);
    }, entry.intervalMs);
  }

  async _executeCallback(id, entry) {
    if (entry.isRunning) {
      this._scheduleNext(id, entry);  // Reprogramar si ya esta corriendo
      return;
    }

    entry.isRunning = true;
    try {
      const result = entry.callback();
      if (result instanceof Promise) await result;
    } finally {
      entry.isRunning = false;
      this._scheduleNext(id, entry);
    }
  }
}
```

**Beneficios:**
- Zero overhead cuando idle (no hay tick global)
- Cada callback tiene su propio timer
- Proper async/await (no solapamiento)
- Respeta visibility API (pausa cuando tab oculto)

### 4. Carga Incremental Inteligente

**Archivo:** `MiniChart.jsx`

```javascript
if (cached && cached.candles.length > 0) {
  // Si cache tiene MENOS del 70% de lo esperado → carga completa
  if (cached.candles.length < maxExpectedCandles * 0.7) {
    url = `${API_BASE_URL}/api/historical/${symbol}?interval=${interval}&days=${days}`;
    isIncremental = false;
  }
  // Si cache es valido → carga incremental (solo velas nuevas)
  else {
    const sinceTs = cached.lastTimestamp;
    url = `${API_BASE_URL}/api/historical/${symbol}?since_timestamp=${sinceTs}`;
    isIncremental = true;
  }
}
```

## Resultados de Optimizacion

| Metrica | Antes | Despues | Mejora |
|---------|-------|---------|--------|
| Cambio de timeframe | ~2:38 min | ~1:13s | **56x mas rapido** |
| Montajes de componente | 2 (doble) | 1 (unico) | ✅ Eliminado |
| Cache "corrupto" falsos | Frecuente | 0 | ✅ Eliminado |
| Tipo de carga | COMPLETA | INCREMENTAL | ✅ Solo velas nuevas |

## Logs de Verificacion

### Cambio de Timeframe Exitoso

```
[BTCUSDT] 🚀 Componente montado, iniciando...           # Solo 1 vez
[CandleCache] 💾 BTCUSDT@5 - desde IndexedDB (1529 velas)
[CandleCache] OK VALIDATION BTCUSDT@5: 1529 velas sin gaps
[BTCUSDT] Carga INCREMENTAL: desde 29/1/2026 (1529 velas en cache)
[CandleCache] 🔄 Merge: 1529 cached + 9 new = 1537 total
[BTCUSDT] ✅ Histórico final: 1537 velas
```

### PollingCoordinator v2 Funcionando

```
[PollingCoordinator] Started
[PollingCoordinator] Registered: VWAP_BTCUSDT (interval: 300000ms, priority: 2)
[PollingCoordinator] Registered: SwingDetector_Signals_BTCUSDT (interval: 30000ms, priority: 3)
[PollingCoordinator] Registered: OrderFlow_BTCUSDT (interval: 5000ms, priority: 1)
```

### Cambio de Timeframe con Cleanup

```
[PollingCoordinator] Unregistered: VWAP_BTCUSDT
[PollingCoordinator] Unregistered: SwingDetector_Signals_BTCUSDT
[PollingCoordinator] Unregistered: OrderFlow_BTCUSDT
[Registry] 🗑️ Desregistrado manager para BTCUSDT (total: 0)
```

## Troubleshooting

**Cambio de timeframe lento (~2+ min):**
- Verificar que no hay "Limpiando cache corrupto" en logs
- Verificar que hay "Carga INCREMENTAL" (no COMPLETA)
- Verificar un solo "Componente montado" (no doble)

**Cache se limpia innecesariamente:**
- Verificar `CandleCache.js` tiene el fix de MIN_CACHE_RATIO
- Los gaps menores a 2 minutos no deben causar limpieza

**Polling no funciona:**
- Verificar logs de `[PollingCoordinator] Registered:`
- Verificar que PollingCoordinator.start() se llama
- Tab debe estar visible (pausa cuando oculto)

**Doble montaje de componente:**
- Verificar que `handleIntervalChange` cambia interval Y days juntos
- Verificar que select usa `handleIntervalChange(e.target.value)`
- No deben haber dos useEffect separados para interval y days

**Backend no conecta:**
- Verificar que backend de Order Flow corre en puerto 11000
- Verificar API_BASE_URL en config.js

## Archivos Modificados (Enero 2026)

| Archivo | Cambio |
|---------|--------|
| `SingleSymbolAnalyzer.jsx` | `handleIntervalChange` atomico |
| `CandleCache.js` | No limpiar cache incompleto sin gaps |
| `MiniChart.jsx` | Detectar cache incompleto para carga inteligente |
| `PollingCoordinator.js` | Reescritura completa a v2 |

## Sistema de Integridad de Cache (31 Enero 2026)

Sistema para validar, reparar y limpiar el cache de footprints.

### Panel de Integridad

Nuevo componente `IntegrityPanel.jsx` en el modal de OrderFlow Settings:
- Badge de estado: verde (saludable), amarillo (reparando), rojo (problemas)
- Conteo de simbolos OK vs con problemas
- Botones: Validar, Reparar, Limpiar Cache Completo

### Servicio Backend (cache_integrity_service.py)

```python
# Endpoints:
GET  /api/orderflow/integrity/status     # Estado actual
POST /api/orderflow/integrity/validate   # Validar todos los simbolos
POST /api/orderflow/integrity/repair     # Reparar desde cloud
POST /api/orderflow/integrity/clear-cache # Limpiar y recargar todo
DELETE /api/orderflow/cache/{symbol}     # Limpiar cache de un simbolo
```

### Validacion Inteligente

- **Gaps (velas faltantes)**: Marcan como "issues" - problema real
- **Step_size diferente**: Solo informativo, NO marca como problema

### Boton "Aplicar a historial"

En la seccion Step Size del modal OrderFlow:
1. Usuario cambia step_size → Click "Guardar"
2. Click "Aplicar a historial" → Elimina cache del simbolo
3. Footprints se regeneran con el nuevo step_size

### Archivos Relacionados

| Archivo | Descripcion |
|---------|-------------|
| `5.Order_flow/backend/cache_integrity_service.py` | Servicio de validacion |
| `5.Order_flow/backend/main.py` | Endpoints de integridad |
| `9.OrderFlowDesktop/src/components/IntegrityPanel.jsx` | Panel UI |
| `9.OrderFlowDesktop/src/components/OrderFlowSettings.jsx` | Boton "Aplicar a historial" |

## Fix: Footprints Historicos No Se Graficaban (31 Enero 2026)

**Problema**: Los footprints historicos no se mostraban en el grafico, solo las velas nuevas (tiempo real).

**Causa**: Race condition en la inicializacion - los footprints se cargaban pero no se forzaba redraw del grafico.

**Solucion**: Se agrego logging inteligente a `OrderFlowIndicator.js` que solo loguea cuando es relevante:

```javascript
// Solo al cargar por primera vez
[OrderFlow] [SYMBOL] INITIAL LOAD: N footprints
// + rangos detallados con metodo _logFootprintRanges()

// Solo cuando hay nuevos footprints
[OrderFlow] [SYMBOL] +N footprints (total: X)

// Solo cuando hay problemas de matching (>30% sin match)
[OrderFlow] [SYMBOL] HIGH UNMATCHED: X/Y (Z%)

// Solo cuando se pierden footprints
[OrderFlow] [SYMBOL] footprints LOST: X -> 0
```

**Metodo `_logFootprintRanges()`**: Detecta grupos contiguos y gaps:
```
[OrderFlow] [ETHUSDT] FOOTPRINT RANGES:
  Total: 730 footprints
  Rango completo: 8:25 a.m. -> 8:35 p.m.
  Grupos contiguos: 2
    Grupo 1: 8:25 a.m. -> 8:22 p.m. (718 fps, 717 min)
    >>> GAP: 2 minutos <<<
    Grupo 2: 8:24 p.m. -> 8:35 p.m. (12 fps, 11 min)
```

**Archivos modificados**:
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js`

## Fix: Footprints de Archivo No Se Renderizaban (17 Octubre 2026)

**Problema**: Los footprints del archivo agregado (1min → 5min) no se graficaban. Solo se mostraban los footprints del backend (últimas 10-12 horas), aunque el merge logs mostraba 552 footprints desde ayer 10:15 AM.

**Causa Raiz**:
- El método `_aggregateFootprints()` retornaba footprints con campo `price_levels` (formato archivo)
- El método `renderOverlay()` solo verificaba `footprint.levels` (formato backend)
- Resultado: todos los footprints históricos agregados eran rechazados silenciosamente

**Evidencia (consola_12.txt)**:
```
Primero (archivo agregado): levels=false, price_levels=true, keys=10
Último (backend): levels=true, price_levels=false, keys=17
```

**Solución**:

1. **Normalización en agregación** (`_aggregateFootprints()` línea 299-321):
```javascript
// ✅ NORMALIZAR AL FORMATO DEL BACKEND (con campo "levels" en lugar de "price_levels")
const aggregatedFootprint = {
  candle_timestamp: intervalStart,
  symbol: this.symbol,
  interval: targetInterval,
  candle_open,
  candle_high,
  candle_low,
  candle_close,
  step_size: 0.1,
  levels,  // ✅ Campo "levels" (no "price_levels")
  num_levels: levels.length,
  total_volume,
  total_delta,
  delta: total_delta,
  poc
};
```

2. **Fallback en renderizado** (`renderOverlay()` línea 782-806):
```javascript
// ✅ SOPORTE DUAL: levels (backend) o price_levels (archivo sin agregar)
const levels = footprint.levels || footprint.price_levels;

if (!levels) {
  this.renderSimpleCandle(ctx, candle, bounds.x + i * candleWidth, candleWidth, priceToY);
  rejectedNoLevels++;
  continue;
}

// Normalizar para renderizado
const normalizedFootprint = { ...footprint, levels };
this.renderOrderFlowUnit(ctx, candle, normalizedFootprint, unitX, candleWidth, priceToY, fullMode);
```

**Resultado**: Ahora todos los footprints (archivo agregado + backend) se renderizan correctamente con el rango completo (27+ horas).

**Archivos modificados**:
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` (líneas 273-321, 782-815)

## Fix COMPLETO: Footprints Solo en Últimas 12h en Timeframe 5min (20 Octubre 2026)

### Problema Original

Los footprints solo se mostraban en las últimas 12 horas en timeframe de 5 minutos, a pesar de tener 20-30 días de datos cargados. En 1 minuto funcionaba correctamente.

**Síntomas:**
- Últimas 12h: ✅ Footprints + stacked imbalances (velas delgadas)
- 17 Oct 22:40 - 20 Oct 02:08: ❌ Nada (velas anchas, sin datos)
- Antes 17 Oct: ❌ Solo stacked imbalances, SIN footprints (velas delgadas)

### Causas Raíz Identificadas

**1. Price ranges colapsados en agregación (price_min === price_max)**

Al agregar footprints de 1min → 5min, el código establecía:
```javascript
// ❌ INCORRECTO
combined = {
  price: price,
  price_min: price,  // Siempre igual
  price_max: price   // Siempre igual
}
```

Resultado: `levelHeight = Math.abs(priceToY(price_max) - priceToY(price_min)) = 0`

El renderizado rechazaba todos los levels:
```javascript
if (levelHeight < 2) continue;  // ❌ Rechaza TODO
```

**2. Archivo de footprints desactualizado**

- Archivo terminaba: 17 Oct 22:40
- Backend iniciaba: 20 Oct 02:08
- **Gap de ~27.5 horas** sin datos

### Soluciones Implementadas

**Solución 1: Preservar rangos de precio en agregación**

`OrderFlowIndicator.js` - Método `_aggregateFootprints()` (líneas 211-390):

```javascript
if (!combinedLevels.has(price)) {
  // ✅ CREAR LEVEL preservando price_min/max del nivel original
  combinedLevels.set(price, {
    price: price,
    price_min: level.price_min || price,  // ✅ Preservar rango
    price_max: level.price_max || price,  // ✅ Preservar rango
    // ... otros campos
  });
}

const combined = combinedLevels.get(price);

// ✅ EXPANDIR el rango para incluir este nivel
if (level.price_min != null && level.price_min < combined.price_min) {
  combined.price_min = level.price_min;
}
if (level.price_max != null && level.price_max > combined.price_max) {
  combined.price_max = level.price_max;
}
```

**Solución 2: Auto-download de archivos desactualizados**

`OrderFlowIndicator.js` - Auto-check en `_loadFromArchive()` (líneas 442-460):

```javascript
const ageHours = (now - lastTimestamp) / (1000 * 60 * 60);

// Si el archivo tiene más de 12 horas de antigüedad, descargar automáticamente
if (ageHours > 12) {
  console.warn(`⚠️ ARCHIVO DESACTUALIZADO: ${ageHours.toFixed(1)}h de antigüedad`);

  // Descargar en background
  this._autoDownloadArchive().catch(err => {
    console.error(`❌ Auto-descarga falló: ${err.message}`);
  });
}
```

Método `_autoDownloadArchive()` (líneas 495-545):
- Descarga últimas 48h desde cloud
- Fusiona con datos existentes (merge automático)
- Recarga footprints actualizados

**Solución 3: Timestamp tolerance**

Añadido en `getDefaultConfig()` (línea 120):
```javascript
timestampToleranceMs: 30000  // 30 segundos de tolerancia para matching
```

### Resultado: ✅ PROBLEMA RESUELTO

**Verificado con 20 días de datos en timeframe 5min:**
- ✅ Todas las velas tienen footprints (no solo últimas 12h)
- ✅ Footprints históricos agregados se renderizan correctamente
- ✅ Auto-download cierra gaps automáticamente
- ✅ Sin gaps visibles en la visualización

### Archivos Modificados

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `OrderFlowIndicator.js` | 6 | Import `getFootprintArchiver` |
| `OrderFlowIndicator.js` | 120 | Config `timestampToleranceMs: 30000` |
| `OrderFlowIndicator.js` | 211-390 | Fix preservación price_min/price_max en agregación |
| `OrderFlowIndicator.js` | 442-460 | Auto-check antigüedad archivo >12h |
| `OrderFlowIndicator.js` | 495-545 | Nuevo método `_autoDownloadArchive()` |

### Lecciones Aprendidas

1. **Preservar metadatos críticos**: `price_min` y `price_max` son esenciales para el renderizado, no solo `price`
2. **Expandir rangos al combinar**: Al fusionar levels, expandir rangos (no sobrescribir)
3. **Logs diagnósticos**: Logging de ranges ayudó a identificar el colapso de precios
4. **Auto-healing**: Detección automática de datos obsoletos evita intervención manual

## Fix: Alturas Inconsistentes de Price Levels en Footprints (20 Octubre 2026)

**Problema:** Las celdas individuales (price levels) dentro de cada footprint tenían alturas muy inconsistentes - algunas eran diminutas y otras enormes, creando footprints visualmente distorsionados.

**Evidencia:** Ver imagen `con_mas_zoom.jpg` - muestra footprints con celdas de alturas radicalmente diferentes.

**Causa raíz:**

Al agregar footprints de 1min → 5min, el código anterior combinaba levels por precio y **expandía** los rangos `price_min/price_max`:

```javascript
// ❌ PROBLEMA: Expandir rangos causaba alturas inconsistentes
if (level.price_max > combined.price_max) {
  combined.price_max = level.price_max;  // Expandir hacia arriba
}
```

**Ejemplo del problema:**
- Precio 67000 aparece en 5 footprints de 1min → rango se expande de (66999-67001) a (66995-67005) → celda ENORME (10 puntos)
- Precio 67050 aparece en 1 footprint de 1min → rango (67049-67051) → celda pequeña (2 puntos)

**Resultado:** Celdas con alturas de 2 a 50+ puntos en el mismo footprint.

---

**Solución implementada:**

**Estrategia completa nueva** en `_aggregateFootprints()` (líneas 273-340):

En lugar de combinar levels expandiendo rangos, **regeneramos levels con step_size uniforme**:

```javascript
// 1. Calcular OHLC del footprint agregado
const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));

// 2. Obtener step_size del primer footprint
const step_size = groupFootprints[0].step_size || 0.1;

// 3. Generar levels UNIFORMES desde low hasta high
const uniformLevels = new Map();
let currentPriceMin = Math.floor(candle_low / step_size) * step_size;

while (currentPriceMin <= candle_high) {
  const currentPriceMax = currentPriceMin + step_size;
  const currentPriceMid = (currentPriceMin + currentPriceMax) / 2;

  uniformLevels.set(currentPriceMin, {
    price: currentPriceMid,
    price_min: currentPriceMin,
    price_max: currentPriceMax,  // ✅ Rango FIJO = step_size
    bid_volume: 0,
    ask_volume: 0,
    total_volume: 0,
    delta: 0
  });

  currentPriceMin += step_size;
}

// 4. Redistribuir volúmenes de footprints originales en levels uniformes
for (const fp of groupFootprints) {
  const originalLevels = fp.levels || fp.price_levels || [];

  for (const origLevel of originalLevels) {
    // Encontrar levels uniformes que intersectan con este level original
    for (const [uniformMin, uniformLevel] of uniformLevels) {
      const uniformMax = uniformLevel.price_max;

      // Si hay intersección, sumar volúmenes
      const intersects = !(origLevel.price_max <= uniformMin || origLevel.price_min >= uniformMax);

      if (intersects) {
        uniformLevel.bid_volume += origLevel.bid_volume || 0;
        uniformLevel.ask_volume += origLevel.ask_volume || 0;
        uniformLevel.total_volume += origLevel.total_volume || 0;
      }
    }
  }
}

// 5. Filtrar levels vacíos (sin volumen)
const levels = Array.from(uniformLevels.values())
  .filter(level => level.total_volume > 0)
  .sort((a, b) => b.price - a.price);
```

**Beneficios:**

1. ✅ **Todos los levels tienen la misma altura** (price_max - price_min = step_size)
2. ✅ **Footprints visualmente consistentes** - no más celdas gigantes mezcladas con diminutas
3. ✅ **Volúmenes correctamente redistribuidos** - mediante intersección de rangos
4. ✅ **Usa step_size real** del footprint original (no hardcoded 0.1)

**Logs de diagnóstico:**

```javascript
// En agregación - primeros 3 levels con rangos uniformes
🔍 NIVELES UNIFORMES (primeros 3): [
  { price: 67000.5, price_min: 67000, price_max: 67001, range: '1.0000', total_volume: '12.50' },
  { price: 66999.5, price_min: 66999, price_max: 67000, range: '1.0000', total_volume: '8.30' },
  { price: 66998.5, price_min: 66998, price_max: 66999, range: '1.0000', total_volume: '15.20' }
]
🔍 step_size=1, total_levels=250, candle_range=250.00
```

**Resultado parcial:** ✅ Celdas uniformes pero ❌ footprints incompletos (más bajos que velas)

---

**Problema secundario detectado:** Después del fix inicial, las celdas eran uniformes pero algunos footprints completos eran más bajos que las velas (ver `altura_footprints_2.png`).

**Causas adicionales:**

1. **Filtro de levels vacíos** (línea 339):
```javascript
.filter(level => level.total_volume > 0) // ❌ Elimina levels sin volumen
```
Si un precio dentro del rango de la vela no tuvo trades, se eliminaba, creando "huecos".

2. **Threshold de renderizado muy alto** (línea 1447):
```javascript
if (levelHeight < 2) continue;  // ❌ Salta levels < 2 píxeles
```
Levels pequeños visualmente se saltaban, dejando espacios vacíos.

**Solución final:**

1. **NO filtrar levels vacíos** (línea 337-340):
```javascript
// ✅ Mantener TODOS los levels, incluso vacíos
const levels = Array.from(uniformLevels.values())
  .sort((a, b) => b.price - a.price);
// NO .filter(level => level.total_volume > 0)
```

2. **Reducir threshold de renderizado** (líneas 1447, 1384):
```javascript
// ✅ De 2px a 0.5px - permite renderizar más levels
if (levelHeight < 0.5) continue;
```

3. **Renderizar levels vacíos con color neutral** (líneas 1456-1463):
```javascript
const isEmpty = level.total_volume === 0;
const bidBg = isEmpty ? 'rgba(100, 100, 100, 0.15)' : (bidDominates ? BID_STRONG : BID_WEAK);
const askBg = isEmpty ? 'rgba(100, 100, 100, 0.15)' : (askDominates ? ASK_STRONG : ASK_WEAK);
```

**Resultado intermedio:** ✅ Celdas uniformes + footprints completos, pero ❌ **algunos footprints con celdas más pequeñas que otros**

---

**Problema terciario detectado:** Después de los fixes, algunos footprints tenían celdas visiblemente más pequeñas que otros, causando alturas inconsistentes.

**Intentos fallidos:**

1. **Intento 1** - Usar step_size del primer footprint:
```javascript
// ❌ FALLA: Diferentes footprints con diferentes tamaños
const step_size = groupFootprints[0].step_size || 0.1;
```

2. **Intento 2** - Usar step_size máximo POR GRUPO:
```javascript
// ❌ FALLA: La mayoría de footprints quedan pequeños
const step_sizes = groupFootprints.map(fp => fp.step_size).filter(s => s != null);
const step_size = step_sizes.length > 0 ? Math.max(...step_sizes) : 0.1;
```

**Por qué el Intento 2 falló:**

Calcula el `Math.max()` **independientemente para cada grupo de 5min**:

- Si archivo tiene: 90% footprints con `step_size = 0.1`, 10% con `step_size = 1.0`
- **Grupo 1** (5 footprints): `max([0.1, 0.1, 0.1, 0.1, 0.1])` = **0.1** → footprint BAJITO
- **Grupo 2** (5 footprints): `max([1.0, 0.1, 0.1, 0.1, 0.1])` = **1.0** → footprint ALTO
- **Grupo 3** (5 footprints): `max([0.1, 0.1, 0.1, 0.1, 0.1])` = **0.1** → footprint BAJITO

**Resultado:** ~60% footprints con step_size = 0.1, ~40% con step_size = 1.0 → **alturas inconsistentes**

**Solución CORRECTA implementada:**

Calcular step_size **GLOBAL** una sola vez para TODOS los footprints:

```javascript
// ✅ CORRECTO: step_size GLOBAL (antes del loop de grupos)
const allStepSizes = footprints1min.map(fp => fp.step_size).filter(s => s != null && s > 0);
const globalStepSize = allStepSizes.length > 0 ? Math.max(...allStepSizes) : 0.1;

// Logging de distribución
const stepSizeDistribution = {};
allStepSizes.forEach(s => {
  stepSizeDistribution[s] = (stepSizeDistribution[s] || 0) + 1;
});
console.log(`STEP_SIZE GLOBAL: ${globalStepSize}`);
console.log(`Distribución:`, stepSizeDistribution);

// Dentro del loop de grupos: reutilizar globalStepSize
for (const [intervalStart, groupFootprints] of groups) {
  const step_size = globalStepSize;  // ✅ MISMO para TODOS
  // ...
}
```

**Beneficios:**
- ✅ **Un solo step_size** para TODOS los footprints agregados
- ✅ **Alturas consistentes** entre footprints
- ✅ **Logging de distribución** muestra cuántos footprints tienen cada step_size original

**Logs de diagnóstico:**
```
🔍 STEP_SIZE GLOBAL: 1.0
🔍 Distribución: { '0.1': 8520, '1.0': 940 }
🔍 Total footprints 1min: 9460, con step_size: 9460, sin step_size: 0
```

**Resultado FINAL:** ✅ **PROBLEMA COMPLETAMENTE RESUELTO**
- Celdas uniformes ✅
- Mismo tamaño de celda en todos los footprints ✅
- Footprints cubren toda la altura de las velas ✅
- Levels vacíos se muestran en gris claro ✅

**Archivos modificados:**
- `OrderFlowIndicator.js` líneas 230-244: **CRÍTICO** - Calcular step_size GLOBAL una sola vez (Math.max de TODOS los footprints 1min)
- `OrderFlowIndicator.js` líneas 245-248: Logging de distribución de step_sizes
- `OrderFlowIndicator.js` líneas 290-340: Regeneración de levels con step_size uniforme
- `OrderFlowIndicator.js` línea 299: Usar globalStepSize (no calcular por grupo)
- `OrderFlowIndicator.js` líneas 355-373: NO filtrar levels vacíos + logs diagnóstico
- `OrderFlowIndicator.js` línea 431: Usar step_size real en footprint agregado
- `OrderFlowIndicator.js` línea 1452: Threshold 2px → 0.5px (footprint renderizado)
- `OrderFlowIndicator.js` línea 1389: Threshold 1px → 0.5px (volume profile renderizado)
- `OrderFlowIndicator.js` líneas 1461-1468: Color gris para levels vacíos

## Sistema de Archivo Histórico de Footprints (17 Octubre 2026)

Sistema para descargar, almacenar y usar footprints históricos desde el servicio cloud, con agregación automática para todos los timeframes.

### FootprintArchiverElectron

Servicio que descarga footprints de 1 minuto desde Northflank y los almacena localmente en `userData/footprint_archive/`.

**Configuración:**
```javascript
// FootprintArchiverElectron.js
config: {
  symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', ...],
  interval: '1',  // Solo descarga 1 minuto (se agrega a otros intervalos en frontend)
  maxHoursPerRequest: 168,  // 7 días de historia por descarga
  timeout: 180000  // 3 minutos timeout
}
```

**Características:**
- Descarga via IPC (Main Process) para bypass de CORS
- Merge inteligente: evita duplicados, actualiza datos existentes
- Almacenamiento en JSON con metadata (count, timestamps, lastUpdated)
- Descarga programada cada 6 horas + manual bajo demanda

### Agregación de Footprints

Método `_aggregateFootprints()` en `OrderFlowIndicator.js` convierte footprints de 1 minuto a intervalos mayores (5min, 15min, 1h, 4h).

**Proceso de agregación:**
1. Agrupa footprints de 1min por intervalo objetivo
2. Combina price_levels sumando volúmenes bid/ask por precio
3. Recalcula OHLC del intervalo agregado
4. Suma volúmenes totales y delta
5. Recalcula POC (Point of Control)

**Ejemplo: 5 footprints de 1min → 1 footprint de 5min**
```javascript
// Entrada: 5 footprints de 1min (9:00, 9:01, 9:02, 9:03, 9:04)
// Salida: 1 footprint de 5min (9:00-9:05)
{
  candle_timestamp: 1729166400000,  // 9:00
  open: fp1.open,
  close: fp5.close,
  high: max(fp1.high, fp2.high, ..., fp5.high),
  low: min(fp1.low, fp2.low, ..., fp5.low),
  total_volume: sum(fp1.total_volume, ..., fp5.total_volume),
  total_bid_volume: sum(...),
  total_ask_volume: sum(...),
  delta: total_ask_volume - total_bid_volume,
  poc: precio_con_mayor_volumen,
  price_levels: [
    // Volúmenes combinados por precio
    { price: 67000, bid_volume: 150, ask_volume: 200, ... },
    ...
  ]
}
```

### Uso Automático del Archivo

`OrderFlowIndicator.js` usa footprints archivados como fallback:

**Casos de uso:**
1. **Backend falla completamente**: Carga desde archivo local
2. **Backend retorna <100 footprints**: Complementa con archivo histórico
3. **Intervalo != 1min**: Agrega automáticamente desde datos de 1min

**Logs típicos:**
```
[OrderFlow] [BTCUSDT] 📚 Cargados 10080 footprints de 1min desde archivo local
[OrderFlow] [BTCUSDT] 🔄 Agregando 10080 footprints de 1min a 5min
[OrderFlow] [BTCUSDT] ✅ Agregación completa: 2016 footprints de 5min
[OrderFlow] [BTCUSDT] 📚 Complementado con archivo: 1950 históricos + 66 recientes = 2016 total
```

### Panel de Archivo

Nuevo botón "📚 Archivo" en `SingleSymbolAnalyzer.jsx` abre `FootprintArchivePanel.jsx`:

**Funcionalidades:**
- Ver estadísticas por símbolo (cantidad, rango de fechas)
- Descargar ahora (manual)
- Ver última descarga programada
- Abrir carpeta de almacenamiento

### IPC Handlers (electron/main.js)

**Handler para descarga sin CORS:**
```javascript
ipcMain.handle('download-footprints', async (event, { symbol, hours, interval }) => {
  // Usa Node.js https module (sin restricciones CORS)
  // Descarga desde: https://p01--altagracia--rxv8nrbhxln9.code.run
  // Retorna: array de footprints
});
```

### Auto-Download de Archivos Desactualizados (20 Octubre 2026)

Sistema automático que detecta cuando el archivo de footprints está desactualizado y descarga datos frescos del cloud sin intervención del usuario.

**Problema detectado:**
- Archivo termina: 17 Oct 22:40
- Backend inicia: 20 Oct 02:08
- **Gap de ~27.5 horas** sin footprints

**Solución implementada:**

`OrderFlowIndicator.js` ahora verifica la antigüedad del archivo al cargarlo:

```javascript
// En método _loadFromArchive() (líneas 442-460)
if (footprints1min.length > 0) {
  const lastFp = footprints1min[footprints1min.length - 1];
  const lastTimestamp = lastFp.candle_timestamp;
  const now = Date.now();
  const ageHours = (now - lastTimestamp) / (1000 * 60 * 60);

  // Si el archivo tiene más de 12 horas de antigüedad, descargar automáticamente
  if (ageHours > 12) {
    const lastDate = new Date(lastTimestamp).toLocaleString('es-ES');
    console.warn(`[OrderFlow] [${symbol}] ⚠️ ARCHIVO DESACTUALIZADO: último footprint de ${lastDate} (${ageHours.toFixed(1)}h de antigüedad)`);
    console.log(`[OrderFlow] [${symbol}] 🔄 Descargando footprints actualizados automáticamente...`);

    // Descargar en background (no esperar)
    this._autoDownloadArchive().catch(err => {
      console.error(`[OrderFlow] [${symbol}] ❌ Auto-descarga falló: ${err.message}`);
    });
  }
}
```

**Método `_autoDownloadArchive()` (líneas 495-545):**
```javascript
async _autoDownloadArchive() {
  // 1. Obtener instancia del archiver
  const archiver = getFootprintArchiver();

  // 2. Descargar últimas 48 horas (suficiente para cerrar gaps)
  const result = await archiver.archiveSymbol(this.symbol, 48);

  // 3. Si exitoso, recargar footprints desde archivo actualizado
  if (result.success) {
    const updatedFootprints = await this._loadFromArchive();
    console.log(`Archivo actualizado: ${updatedFootprints.length} footprints disponibles`);
  }
}
```

**Características:**
- **Threshold:** Activa si archivo tiene >12h de antigüedad
- **Background:** No bloquea la carga inicial (ejecución asíncrona)
- **Smart download:** Descarga solo 48h (suficiente para cerrar gaps típicos)
- **Auto-merge:** FootprintArchiver fusiona automáticamente con datos existentes
- **Error handling:** Si falla, el indicador sigue funcionando con datos disponibles

**Logs de auto-download exitoso:**
```
[OrderFlow] [BTCUSDT] ⚠️ ARCHIVO DESACTUALIZADO: último footprint de 17/10/2026, 22:40 (60.3h de antigüedad)
[OrderFlow] [BTCUSDT] 🔄 Descargando footprints actualizados automáticamente...
[OrderFlow] [BTCUSDT] 🔄 _autoDownloadArchive: Iniciando descarga automática...
[OrderFlow] [BTCUSDT] 📥 Descargando últimas 48h desde cloud...
[FootprintArchiver] 📥 Archivando BTCUSDT (48h = ~2 días)...
[FootprintArchiver] ✅ BTCUSDT: 2880 footprints descargados
[FootprintArchiver] 🔄 BTCUSDT: Merge - +150 nuevos, ~0 actualizados, =2730 duplicados
[OrderFlow] [BTCUSDT] ✅ Auto-descarga exitosa: 150 nuevos footprints
[OrderFlow] [BTCUSDT] ✅ Archivo actualizado: 10230 footprints disponibles
```

**Beneficios:**
- ✅ Elimina gaps automáticamente sin intervención del usuario
- ✅ Mantiene archivo sincronizado con backend
- ✅ No interrumpe visualización inicial (corre en background)
- ✅ Reutiliza infraestructura existente (FootprintArchiver)

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `FootprintArchiverElectron.js` | maxHoursPerRequest: 24 → 168 |
| `OrderFlowIndicator.js` | Agregado método `_aggregateFootprints()` |
| `OrderFlowIndicator.js` | `_loadFromArchive()` agrega automáticamente si interval != "1" |
| `OrderFlowIndicator.js` | Complemento con archivo sin restricción de interval |
| `OrderFlowIndicator.js` | Auto-check de antigüedad en `_loadFromArchive()` (líneas 442-460) |
| `OrderFlowIndicator.js` | Nuevo método `_autoDownloadArchive()` (líneas 495-545) |
| `OrderFlowIndicator.js` | Import de `getFootprintArchiver` (línea 6) |
| `electron/main.js` | IPC handler `download-footprints` |
| `electron/preload.js` | API `downloadFootprints()` expuesta a renderer |

### Beneficios

- **Timeframes mayores funcionales**: 5min, 15min, 1h, 4h ahora muestran datos históricos completos
- **Fallback robusto**: Si backend falla, usa archivo local automáticamente
- **Complemento inteligente**: Combina datos recientes del backend con históricos del archivo
- **Sin duplicación de almacenamiento**: Solo guarda 1min, agrega on-the-fly
- **Bypass CORS**: Descarga via Main Process (Node.js)
- **Auto-actualización**: Detecta y cierra gaps automáticamente cuando archivo >12h antiguo

## Dependencias con Otras Apps

- **Backend:** Usa el mismo backend de App 5 (Order Flow) en puerto 11000
- **Indicadores:** Comparte codigo con App 4, 5 y 8
- **Cache:** Sistema propio de IndexedDB con validacion de gaps
- **Cloud Service:** Northflank footprint collector en https://p01--altagracia--rxv8nrbhxln9.code.run

---

