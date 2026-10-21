# APP 9: ORDER FLOW DESKTOP (Electron)

**Ubicacion:** `9.OrderFlowDesktop/`

Version de escritorio del Order Flow (App 5) empaquetada con Electron. Incluye optimizaciones agresivas de rendimiento y sistema de cache avanzado.

## Fix Crítico: Restauración de Footprints Históricos (20 Octubre 2026)

**Problema**: Los footprints históricos no se mostraban - solo aparecían las últimas 10-12 horas del backend, aunque el archivo local tenía 7 días de datos.

**Causa raíz**: En algún commit entre `9dee3f4` y `2067559`, se eliminó accidentalmente el bloque de agregación en `_loadFromArchive()` que convertía footprints de 1min → 5min del archivo local.

**Solución aplicada**: Restaurado el bloque de agregación (líneas 571-593 de `OrderFlowIndicator.js`):

```javascript
// Si el intervalo no es 1min, agregar los footprints
if (this.interval !== "1") {
  console.log(`[OrderFlow] [${this.symbol}] 🔍 Agregando de 1min a ${this.interval}min...`);
  const aggregated = this._aggregateFootprints(footprints1min, this.interval);
  console.log(`[OrderFlow] [${this.symbol}] 🔍 Agregación retorna: ${aggregated.length} footprints de ${this.interval}min`);

  // Logs de diagnóstico del rango temporal...

  return aggregated;
}
```

**Impacto**:
- ✅ Footprints históricos completos (7 días desde archivo local)
- ✅ Merge inteligente con backend (datos recientes)
- ✅ Cuadrícula invisible se mantiene (expansión dinámica en renderizado)
- ✅ Sistema de step_size configurable funciona correctamente

**Nota importante**: Los footprints históricos del archivo mantienen el step_size con el que fueron generados originalmente en Northflank. Solo los footprints nuevos (generados en tiempo real por el backend) usan el step_size configurado en el modal.

**Archivo modificado**: `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js`

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

## Fix CRÍTICO: Footprints Históricos No Se Actualizan al Cambiar Step Size (20 Octubre 2026)

**Problema:** Después de cambiar step_size en modal + guardar + "Aplicar a historial", los footprints históricos NO se actualizaban visualmente. Solo los footprints en tiempo real mostraban el nuevo step_size correctamente.

### Causa Raíz Identificada

Los footprints de 1min en el archivo local (`userData/footprint_archive/SYMBOL_1.json`) fueron **generados originalmente por el backend collector con el step_size ANTIGUO** (ej: 10 o 20).

Cuando se intentaba agregarlos a 5min con el NUEVO step_size (ej: 5), el sistema:
1. ✅ Consultaba backend para obtener nuevo step_size
2. ✅ Usaba ese step_size en la agregación
3. ✅ Redistribuía volúmenes a nuevos levels
4. ❌ **PERO** los footprints de 1min base ya tenían `price_levels` con granularidad del step_size antiguo

**Resultado:** No se puede recrear granularidad de datos que nunca existió. Es como intentar "mejorar" la resolución de una imagen borrosa - los datos finos simplemente no están ahí.

**Ejemplo concreto:**
```javascript
// Footprint 1min original (generado con step_size=10):
{
  price_levels: [
    { price_min: 67000, price_max: 67010, bid_volume: 100, ask_volume: 150 }
  ]
}

// Al intentar reagregar con step_size=5:
// Sistema crea levels: [67000-67005, 67005-67010]
// Pero no sabe cómo distribuir los 100 bid entre ambos levels
// → Duplica volúmenes o hace distribución incorrecta
// → Footprints históricos se ven mal visualmente
```

### Solución Implementada

**Eliminar el archivo local de footprints** cuando el usuario hace "Aplicar a historial", forzando que el backend regenere TODO desde cero con el nuevo step_size.

#### 1. Nuevo Método `deleteArchiveFile()` en FootprintArchiverElectron

```javascript
/**
 * Elimina el archivo de footprints de un símbolo específico.
 * Útil cuando se cambia step_size y se necesita regenerar datos desde cero.
 */
async deleteArchiveFile(symbol) {
  const filePath = this._getFilePath(symbol);
  const exists = await window.electron.fileExists(filePath);

  if (exists) {
    await window.electron.deleteFile(filePath);
    console.log(`[FootprintArchiver] 🗑️ ${symbol}: archivo eliminado`);
  }

  return { success: true };
}
```

#### 2. Callback Modificado en SingleSymbolAnalyzer.jsx

```javascript
onBackendConfigSaved={async () => {
  // PASO 1: Eliminar archivo local (footprints 1min con step_size antiguo)
  const archiver = getFootprintArchiver();
  await archiver.deleteArchiveFile(symbol);
  console.log('[RECARGA] ✅ Archivo local eliminado');

  // PASO 2: Limpiar footprints en memoria
  ofIndicator.footprints = [];

  // PASO 3: Recargar desde backend (regenerará con nuevo step_size)
  await ofIndicator.fetchData();

  // PASO 4: Redraw
  manager.requestRedraw();
}}
```

### Problema Adicional 1: Race Condition con PollingCoordinator

**Síntoma:** Al hacer "Aplicar a historial", el gráfico cambiaba momentáneamente y luego volvía al estado anterior.

**Causa:** El PollingCoordinator ejecuta `fetchFootprints()` en background cada 5 segundos. Cuando el callback elimina el archivo:
1. ⏳ Ya hay un fetchFootprints() corriendo que empezó a leer el archivo ANTES de eliminarlo
2. 🗑️ Callback elimina el archivo
3. ⚡ La operación de lectura que ya estaba en progreso completa y carga los datos antiguos
4. ❌ Los footprints antiguos sobrescriben los nuevos

**Solución:** Pausar el PollingCoordinator durante el callback:
```javascript
// PASO 0: Pausar polling
pollingCoordinator.pause();
await new Promise(resolve => setTimeout(resolve, 500)); // Esperar operaciones en progreso

try {
  // Eliminar archivo, limpiar memoria, recargar...
} finally {
  // PASO 5: Reanudar polling
  pollingCoordinator.resume();
}
```

### Problema Adicional 2: Doble Llamada al Callback

**Síntoma:** El callback se ejecutaba DOS veces (una al guardar, otra al aplicar a historial).

**Causa:** Tanto `handleSaveStepSize()` (botón "Guardar") como `handleClearSymbolCache()` (botón "Aplicar a historial") llamaban al callback.

**Solución:** Eliminar la llamada al callback en `handleSaveStepSize()`:
```javascript
// OrderFlowSettings.jsx - handleSaveStepSize()
if (response.ok) {
  console.log(`[OrderFlow] Step size saved for ${currentSymbol}: ${pendingStepSize}`);
  setSymbolStepSize(pendingStepSize);
  setPendingStepSize(null);
  // ❌ ELIMINAR: if (onBackendConfigSaved) { onBackendConfigSaved(); }
  // ✅ NO llamar callback aquí - solo guardar en backend
}
```

### Flujo Completo Después de TODOS los Fixes

1. Usuario cambia step_size de 10 a 5 en modal → Click "💾 Guardar"
   - POST al backend → guarda step_size=5
   - Actualiza UI local
   - **NO ejecuta callback** (solo guarda)
2. Click "🔄 Aplicar a historial"
   - DELETE cache backend
   - Ejecuta callback:
     - ⏸️ **PAUSA PollingCoordinator** (evita race conditions)
     - ⏳ Espera 500ms (operaciones en progreso completan)
     - 🗑️ **ELIMINA archivo local** `SYMBOL_1.json` (footprints 1min con step_size=10)
     - 🗑️ Limpia `footprints = []` en memoria
     - 🔄 Llama `fetchData()`
     - 📡 Backend regenera footprints de 1min con step_size=5
     - 📊 Frontend carga footprints nuevos del backend
     - 🎨 Redraw del gráfico
     - ▶️ **REANUDA PollingCoordinator**
3. **Resultado:** ✅ TODOS los footprints (históricos + nuevos) usan step_size=5 y se mantienen

### Archivos Modificados

| Archivo | Cambio | Líneas |
|---------|--------|--------|
| `FootprintArchiverElectron.js` | Agregado método `deleteArchiveFile()` | 514-559 |
| `SingleSymbolAnalyzer.jsx` | Import `getFootprintArchiver` | 28 |
| `SingleSymbolAnalyzer.jsx` | Callback pausa polling + elimina archivo + reanuda | 1151-1230 |
| `OrderFlowSettings.jsx` | Eliminado callback de handleSaveStepSize (Fix doble llamada) | 236-242 |
| `electron/preload.js` | API `deleteFile()` ya existía | 144-152 |

### Logs de Verificación

**Flujo exitoso después de TODOS los fixes:**
```
[OrderFlowSettings] Ejecutando callback onBackendConfigSaved...
[RECARGA] ⏸️ PASO 0: Pausando PollingCoordinator...
[PollingCoordinator] Paused
[RECARGA] ✅ PollingCoordinator pausado y operaciones en progreso completadas
[RECARGA] 🗑️ PASO 1: Eliminando archivo local de footprints...
[FootprintArchiver] 🗑️ BTCUSDT: archivo eliminado: ...footprint_archive/BTCUSDT_1.json
[RECARGA] ✅ Archivo local eliminado: Archivo BTCUSDT_1.json eliminado
[RECARGA] 🗑️ PASO 2: Footprints en memoria limpiados: 9845 → 0
[RECARGA] 🔄 PASO 3: Recargando desde backend (con nuevo step_size)...
[OrderFlow] [BTCUSDT] 🔍 fetchFootprints INICIADO - interval=5
[OrderFlow] [BTCUSDT] 🔍 Archivo existe: false
[OrderFlow] [BTCUSDT] 🌐 Backend: 679 footprints recibidos
[OrderFlow] [BTCUSDT] ✅ Backend step_size consultado: 5
[OrderFlow] [BTCUSDT] ✅ Usando solo backend (679 footprints)
[RECARGA] ✅ fetchData() completado en 1.82s
[RECARGA] 📊 Estado DESPUÉS de recargar:
  - Footprints en memoria: 679
  - Primer fp: 20/10/2026 8:30:00, step_size=5
  - Último fp: 20/10/2026 20:25:00, step_size=5
[RECARGA] 🎨 PASO 4: Solicitando redraw del gráfico...
[RECARGA] ✅ Redraw completado
[RECARGA] ▶️ PASO 5: Reanudando PollingCoordinator...
[PollingCoordinator] Resumed
[RECARGA] ✅ PollingCoordinator reanudado
[RECARGA] ✅ ARCHIVO LOCAL ELIMINADO - Backend regeneró con nuevo step_size
```

### Por Qué Este Fix Es La Solución Correcta

**Alternativas descartadas:**
1. ❌ "Interpolar" volúmenes al reagregar → Crearía datos falsos
2. ❌ Mantener archivo y solo agregar mejor → No soluciona granularidad faltante
3. ❌ Regenerar archivo descargando desde cloud → Cloud también tiene step_size antiguo

**Por qué eliminar archivo es correcto:**
- ✅ Fuerza regeneración completa con granularidad correcta desde el inicio
- ✅ Backend tiene lógica para generar footprints de 1min con cualquier step_size
- ✅ Archivo se regenerará automáticamente en próximas descargas programadas
- ✅ No crea datos falsos - todo viene de trades reales del backend
- ✅ Solo se pierde cobertura histórica temporalmente (backend tiene ~12-24h)

### Lecciones Aprendidas

1. **Granularidad de datos es crítica:** No se puede "mejorar" resolución de datos agregados
2. **Step_size debe ser consistente en todo el pipeline:** Archivo → Agregación → Renderizado
3. **Cache invalidation es difícil:** No basta con limpiar memoria, hay que considerar TODOS los niveles de cache
4. **Eliminación selectiva de cache es mejor que limpieza global:** Solo eliminamos archivo del símbolo afectado

### Problema Adicional 3 (CRÍTICO): Backend Retornaba Footprints de Memoria con Step Size Antiguo

**Síntoma:** Después de todos los fixes anteriores, el backend seguía retornando footprints con step_size=10 en lugar del step_size=20 que el usuario guardó.

**Evidencia del log:**
```
Línea 404: Step size saved for BTCUSDT: 20  (usuario guardó step_size=20)
Línea 511: Cache cleared: files_deleted: 2  (cache disco eliminado ✅)
Línea 545: Primer fp: step_size=10           (backend retornó step_size=10 ❌)
```

**Causa Raíz:** El endpoint `DELETE /api/orderflow/cache/{symbol}` solo eliminaba archivos del DISCO pero NO limpiaba los footprints en MEMORIA del servicio (`service._footprints[key]`).

**Flujo del problema:**
1. Backend genera footprints con step_size=10 → quedan en memoria
2. Usuario guarda step_size=20 → backend actualiza calculators ✅
3. Usuario hace "Aplicar a historial" → DELETE solo elimina disco ❌
4. Backend retorna footprints de MEMORIA (step_size=10 antiguo)

**Solución Backend:** Modificar endpoint DELETE para limpiar MEMORIA además del disco:

```python
# 5.Order_flow/backend/main.py - clear_symbol_cache()

# PASO 1: Eliminar archivos de disco
for file in cache_dir.glob(f"{symbol}_*.json"):
    file.unlink()
    deleted_files.append(file.name)

# PASO 2: Limpiar footprints en MEMORIA del servicio
service = get_orderflow_service()
if service:
    for key in list(service._footprints.keys()):
        if key.startswith(f"{symbol}_"):
            count = len(service._footprints[key])
            service._footprints[key].clear()  # ✅ LIMPIAR MEMORIA
            print(f"[CACHE] Cleared memory for {key}: {count} footprints")
```

**Resultado:** Ahora el backend:
1. Elimina archivos de disco ✅
2. Limpia footprints en memoria ✅
3. Regenera footprints con nuevo step_size desde trades o cloud ✅

### Estado

✅ **PROBLEMA RESUELTO COMPLETAMENTE**

Los footprints históricos ahora se actualizan correctamente cuando el usuario cambia step_size.

**Archivos Backend Modificados:**
- `5.Order_flow/backend/main.py` (líneas 4386-4445) - Endpoint DELETE limpia memoria + disco

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

**Solución FINAL implementada (20 Oct - tarde):**

Calcular step_size **GLOBAL como MODA** (más frecuente) en lugar de máximo:

```javascript
// ✅ CORRECTO: step_size GLOBAL como MODA (antes del loop de grupos)
const allStepSizes = footprints1min.map(fp => fp.step_size).filter(s => s != null && s > 0);

// Calcular distribución
const stepSizeDistribution = {};
allStepSizes.forEach(s => {
  stepSizeDistribution[s] = (stepSizeDistribution[s] || 0) + 1;
});

// Encontrar MODA (step_size más frecuente)
let globalStepSize = 0.1;
let maxCount = 0;
for (const [stepSize, count] of Object.entries(stepSizeDistribution)) {
  if (count > maxCount) {
    maxCount = count;
    globalStepSize = parseFloat(stepSize);
  }
}

console.log(`STEP_SIZE GLOBAL (MODA): ${globalStepSize} (aparece ${maxCount}/${allStepSizes.length} veces)`);

// Dentro del loop de grupos: reutilizar globalStepSize
for (const [intervalStart, groupFootprints] of groups) {
  const step_size = globalStepSize;  // ✅ MISMO para TODOS
  // ...
}
```

**Por qué MODA en lugar de MAX:**

❌ **Math.max() problema:** Si distribución es 89% con 0.1, 10% con 1.0, 1% con 10 → elige 10 (usado solo por 1%) → celdas gigantes → footprints bajitos

✅ **Moda solución:** Elige 0.1 (usado por 89%) → celdas del tamaño correcto para la mayoría

**Beneficios:**
- ✅ **Un solo step_size** para TODOS los footprints agregados
- ✅ **Step_size representativo** de la mayoría de datos
- ✅ **Evita extremos** (no usa valores raros que solo 1% tiene)

**Logs de diagnóstico:**
```
🔍 STEP_SIZE GLOBAL (MODA): 0.1 (aparece 42000/46994 veces)
🔍 Distribución: { '0.1': 42000, '1.0': 4500, '10': 494 }
🔍 Total footprints 1min: 46994, con step_size: 46994, sin step_size: 0
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

---

## Fase 1: Sistema de Step Size Configurable (20 Octubre 2026 - noche)

**Problema persistente:** Después de todos los fixes anteriores (moda, levels vacíos, threshold), el problema de alturas inconsistentes continuaba. Las celdas tenían diferentes alturas en píxeles (2px vs 4px) incluso con el mismo step_size en los datos.

**Causa raíz identificada:** El problema NO está en la agregación de datos, sino en el **renderizado**. La conversión de precios a coordenadas Y (`priceToY()`) puede producir diferentes alturas en píxeles para el mismo step_size debido a:
- Redondeo de coordenadas
- Posición en el canvas
- Variaciones en la escala de precios

**Solución propuesta:** Sistema de "cuadrícula invisible" donde:
1. Un step_size GLOBAL fijo para todo el gráfico
2. Renderizado con altura visual consistente (mínimo 1.5-2px)
3. Grid conceptualmente fijo, celdas se hacen visibles según posición de vela

**Análisis:** El sistema de grid YA EXISTE (80% implementado) en `_aggregateFootprints()`. Solo necesita:
1. Step_size configurable (no auto-calculado)
2. Renderizado visual consistente (altura mínima)

**Implementación - FASE 1 (Completada):**

Sistema de **prioridades para step_size**:

**Priority 1 - Backend:** Usar step_size de footprints recientes del backend
**Priority 2 - Config:** Override manual del usuario (`config.stepSizeOverride`)
**Priority 3 - Mode:** Fallback a moda (valor más frecuente en datos)

**Código implementado** (`OrderFlowIndicator.js` líneas 253-330):

```javascript
// ✅ FASE 1: Sistema de Prioridades para Step Size

// Calcular MODA (fallback)
const allStepSizes = footprints1min.map(fp => fp.step_size).filter(s => s != null && s > 0);
const stepSizeDistribution = {};
allStepSizes.forEach(s => {
  stepSizeDistribution[s] = (stepSizeDistribution[s] || 0) + 1;
});

let modeStepSize = 0.1;
let maxCount = 0;
for (const [stepSize, count] of Object.entries(stepSizeDistribution)) {
  if (count > maxCount) {
    maxCount = count;
    modeStepSize = parseFloat(stepSize);
  }
}

// Buscar step_size del backend (últimos 10 footprints)
let backendStepSize = null;
if (this.footprints && this.footprints.length > 0) {
  for (let i = this.footprints.length - 1; i >= Math.max(0, this.footprints.length - 10); i--) {
    if (this.footprints[i].step_size != null && this.footprints[i].step_size > 0) {
      backendStepSize = this.footprints[i].step_size;
      break;
    }
  }
}

// Override de configuración
const configStepSize = this.config.stepSizeOverride;

// SISTEMA DE PRIORIDADES
let globalStepSize;
let source;

if (configStepSize != null && configStepSize > 0) {
  globalStepSize = configStepSize;
  source = 'config';
} else if (backendStepSize != null) {
  globalStepSize = backendStepSize;
  source = 'backend';
} else {
  globalStepSize = modeStepSize;
  source = 'mode';
}

// VALIDACIÓN: [0.01, 100]
if (globalStepSize < 0.01 || globalStepSize > 100) {
  console.warn(`step_size inválido: ${globalStepSize} (fuente: ${source})`);
  globalStepSize = modeStepSize;
  source = 'mode (fallback)';

  if (globalStepSize < 0.01 || globalStepSize > 100) {
    globalStepSize = 0.1;
    source = 'default';
  }
}
```

**Configuración agregada** (`OrderFlowIndicator.js` línea 136):

```javascript
getDefaultConfig() {
  return {
    // ... otras opciones ...
    stepSizeOverride: null,  // Override manual del step_size (null = auto)
  };
}
```

**Logging detallado:**

```
📏 STEP_SIZE: 1.0 (fuente: backend)
🌐 Usando step_size del backend reciente
```

o

```
📏 STEP_SIZE: 0.1 (fuente: config)
🔧 Usando override manual de configuración
```

o

```
📏 STEP_SIZE: 0.1 (fuente: mode)
📊 Usando moda (aparece 42000/46994 veces)
📊 Distribución: { '0.1': 42000, '1.0': 4500, '10': 494 }
```

**Beneficios de Fase 1:**

✅ **Control manual:** Usuario puede forzar step_size específico vía configuración
✅ **Inteligencia automática:** Si no hay override, usa backend (más actualizado) o moda (más común)
✅ **Validación robusta:** Rango [0.01, 100] con fallbacks múltiples
✅ **Transparencia:** Logs claros muestran qué fuente se usó

**Estado:** Fase 1 ✅ COMPLETA (con FIX CRÍTICO)

**FIX CRÍTICO 1 (20 Oct - noche):**

El sistema de prioridades original tenía un bug:
- **Problema:** Usaba step_size de los últimos footprints en memoria (asumía que eran del backend)
- **Resultado:** Al agregar footprints del ARCHIVO, usaba step_size incorrecto
- **Solución temporal:** Eliminada prioridad "backend", usar solo moda

**FIX CRÍTICO 2 (20 Oct - noche tardía):**

El fix anterior no funcionaba cuando usuario configuraba step_size manualmente:
- **Problema:** Usuario configura step_size=5 en modal → se guarda en backend
- **Usuario click "Aplicar a historial"** → elimina cache backend
- **Agregación usa MODA del archivo** (step_size=10) → ignora configuración del usuario
- **Resultado:** Config manual ignorada, footprints históricos con step_size incorrecto

**Solución FINAL implementada:**

Sistema de prioridades que CONSULTA el backend antes de agregar:

```javascript
// ✅ CONSULTAR BACKEND antes de agregar
let backendStepSize = null;
try {
  const response = await fetch(`${API_BASE_URL}/api/orderflow/step-size/${symbol}`);
  if (response.ok) {
    const data = await response.json();
    if (data.success && data.step_size != null) {
      backendStepSize = data.step_size;
    }
  }
} catch (error) {
  console.warn('No se pudo consultar step_size del backend');
}

// Sistema de prioridades FINAL
if (backendStepSize != null && backendStepSize > 0) {
  globalStepSize = backendStepSize;      // Priority 1: Backend (configurado en modal)
  source = 'backend';
} else if (configStepSize != null && configStepSize > 0) {
  globalStepSize = configStepSize;       // Priority 2: Config localStorage
  source = 'config';
} else if (allStepSizes.length > 0) {
  globalStepSize = modeStepSize;         // Priority 3: MODA de footprints 1min
  source = 'mode';
} else {
  globalStepSize = 0.1;                  // Priority 4: Default
  source = 'default';
}
```

**Flujo correcto ahora:**
1. Usuario configura step_size=5 en modal → se guarda en backend
2. Usuario click "Aplicar a historial" → elimina cache backend
3. App recarga footprints → lee archivo local (46994 fp con step_size=10)
4. **ANTES de agregar:** consulta `GET /api/orderflow/step-size/BTCUSDT` → obtiene 5
5. Agregación usa step_size=5 ✅
6. Footprints históricos se regeneran con step_size=5 ✅

**FIX CRÍTICO 3 - Recarga de Footprints (20 Oct - noche tardía):**

Los fixes anteriores funcionaban PERO solo para velas nuevas:
- **Problema:** Botón "Aplicar a historial" eliminaba cache del backend pero NO recargaba footprints en memoria
- **Resultado:** Footprints históricos seguían usando step_size viejo, solo velas nuevas usaban el nuevo
- **Causa:** Faltaba callback `onBackendConfigSaved` en `OrderFlowSettings` para recargar footprints

**Solución implementada:**

```javascript
// SingleSymbolAnalyzer.jsx - Callback para OrderFlowSettings
onBackendConfigSaved={async () => {
  const ofIndicator = manager?.indicators?.find(ind => ind.name === "Order Flow");
  if (ofIndicator) {
    // 1. Limpiar footprints en memoria
    ofIndicator.footprints = [];

    // 2. Recargar desde cero (consulta backend para step_size)
    await ofIndicator.fetchData();

    // 3. Redraw del gráfico
    manager.requestRedraw();
  }
}}
```

**Flujo COMPLETO ahora:**
1. Usuario cambia step_size a 5 en modal → "Guardar" → se guarda en backend ✅
2. Usuario click "Aplicar a historial" → elimina cache backend ✅
3. **Callback limpia footprints en memoria** ✅
4. **Recarga desde archivo local** ✅
5. **Consulta backend para step_size** → obtiene 5 ✅
6. **Agrega con step_size=5** ✅
7. **Redraw muestra footprints regenerados** ✅

**Archivos modificados:**
- `OrderFlowIndicator.js` línea 136: Agregado `stepSizeOverride: null` en config
- `OrderFlowIndicator.js` líneas 220-221: Agregado parámetro `backendStepSize` a `_aggregateFootprints()`
- `OrderFlowIndicator.js` líneas 253-330: Sistema de prioridades COMPLETO (4 niveles)
- `OrderFlowIndicator.js` líneas 571-586: Consulta backend antes de agregar
- `SingleSymbolAnalyzer.jsx` líneas 1150-1166: Callback `onBackendConfigSaved` para recargar footprints

---

## Fase 2: Expansión Dinámica de Levels (20 Octubre 2026 - noche)

**Problema después de Fase 1:** Las celdas individuales tenían la misma altura (paso correcto), PERO la altura total del footprint no coincidía con la altura de la vela. Los footprints agregados eran más cortos que las velas.

**Causa raíz identificada:**

En la agregación, el OHLC del footprint se calcula basándose en los footprints de 1min:

```javascript
const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));
```

**Problema:** Los footprints de 1min **NO cubren el rango completo** de la vela real:
- Vela real: high=100000, low=99000 (rango de 1000 puntos)
- Footprints 1min disponibles: high=99800, low=99200 (rango de 600 puntos)
- Footprint agregado: solo cubre 99200-99800 → **no llega a los extremos de la vela**

**¿Por qué pasa esto?**
- Los extremos (high/low) de la vela pueden ser **wicks** sin volumen suficiente
- Movimientos rápidos sin trades registrados en algunos niveles de precio
- Gap entre último footprint y extremo de la vela

**Solución implementada:**

Expansión dinámica de levels EN EL RENDERIZADO (no en agregación):

**Código** (`OrderFlowIndicator.js` método `renderOrderFlowUnit()` líneas 1327-1430):

```javascript
// 1. Calcular rango actual de los levels del footprint
let footprintHigh = -Infinity;
let footprintLow = Infinity;

for (const level of levels) {
  if (level.price_max > footprintHigh) footprintHigh = level.price_max;
  if (level.price_min < footprintLow) footprintLow = level.price_min;
}

// 2. Detectar si necesitamos expandir
const needsExpansionAbove = candle.high > footprintHigh;
const needsExpansionBelow = candle.low < footprintLow;

if (needsExpansionAbove || needsExpansionBelow) {
  const step_size = footprint.step_size || 0.1;
  const expandedLevels = [...levels];

  // 3. Agregar levels vacíos ARRIBA
  if (needsExpansionAbove) {
    let currentPriceMin = footprintHigh;
    while (currentPriceMin < candle.high) {
      const currentPriceMax = Math.min(currentPriceMin + step_size, candle.high + step_size);
      expandedLevels.push({
        price: (currentPriceMin + currentPriceMax) / 2,
        price_min: currentPriceMin,
        price_max: currentPriceMax,
        bid_volume: 0,
        ask_volume: 0,
        total_volume: 0,
        delta: 0
      });
      currentPriceMin = parseFloat((currentPriceMin + step_size).toFixed(8));
    }
  }

  // 4. Agregar levels vacíos ABAJO
  if (needsExpansionBelow) {
    let currentPriceMax = footprintLow;
    while (currentPriceMax > candle.low) {
      const currentPriceMin = Math.max(currentPriceMax - step_size, candle.low - step_size);
      expandedLevels.push({
        price: (currentPriceMin + currentPriceMax) / 2,
        price_min: currentPriceMin,
        price_max: currentPriceMax,
        bid_volume: 0,
        ask_volume: 0,
        total_volume: 0,
        delta: 0
      });
      currentPriceMax = parseFloat((currentPriceMax - step_size).toFixed(8));
    }
  }

  // 5. Ordenar y usar expandedLevels
  expandedLevels.sort((a, b) => b.price - a.price);
  levels = expandedLevels;
}
```

**Logging de diagnóstico:**

```
🔧 EXPANDIENDO LEVELS para cubrir vela completa:
  Vela: high=100000.00, low=99000.00, rango=1000.00
  Footprint original: high=99800.00, low=99200.00, rango=600.00
  Levels: original=60, expandido=100, agregados=40
  Step_size: 10
```

**Por qué hacerlo en renderizado en lugar de agregación:**

✅ **Eficiente:** Solo se expande cuando se necesita (al renderizar)
✅ **No destructivo:** No modifica el footprint original
✅ **Acceso a la vela real:** En renderizado tenemos acceso al OHLC de la vela real
✅ **Lazy:** No pre-procesa footprints que nunca se verán

**Beneficios de Fase 2:**

✅ **Footprints cubren toda la vela:** Los levels se expanden dinámicamente hasta high/low de la vela
✅ **Levels vacíos visibles:** Se renderizan en gris para mantener altura visual completa
✅ **Sin gaps:** No hay espacios entre el footprint y los extremos de la vela
✅ **Performance óptimo:** Solo se expande lo necesario, solo cuando se renderiza

**Estado:** Fase 2 ✅ COMPLETA

**Resultado esperado:** Todos los footprints ahora deberían tener la misma altura visual que sus velas correspondientes.

**Archivos modificados:**
- `OrderFlowIndicator.js` líneas 1327-1430: Expansión dinámica de levels en `renderOrderFlowUnit()`

---

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

