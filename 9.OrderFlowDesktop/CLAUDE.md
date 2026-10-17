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

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `FootprintArchiverElectron.js` | maxHoursPerRequest: 24 → 168 |
| `OrderFlowIndicator.js` | Agregado método `_aggregateFootprints()` |
| `OrderFlowIndicator.js` | `_loadFromArchive()` agrega automáticamente si interval != "1" |
| `OrderFlowIndicator.js` | Complemento con archivo sin restricción de interval |
| `electron/main.js` | IPC handler `download-footprints` |
| `electron/preload.js` | API `downloadFootprints()` expuesta a renderer |

### Beneficios

- **Timeframes mayores funcionales**: 5min, 15min, 1h, 4h ahora muestran datos históricos completos
- **Fallback robusto**: Si backend falla, usa archivo local automáticamente
- **Complemento inteligente**: Combina datos recientes del backend con históricos del archivo
- **Sin duplicación de almacenamiento**: Solo guarda 1min, agrega on-the-fly
- **Bypass CORS**: Descarga via Main Process (Node.js)

## Dependencias con Otras Apps

- **Backend:** Usa el mismo backend de App 5 (Order Flow) en puerto 11000
- **Indicadores:** Comparte codigo con App 4, 5 y 8
- **Cache:** Sistema propio de IndexedDB con validacion de gaps
- **Cloud Service:** Northflank footprint collector en https://p01--altagracia--rxv8nrbhxln9.code.run

---

