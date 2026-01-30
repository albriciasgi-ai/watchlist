# Plan de Mejoras de Robustez - Aplicaciones de Trading

Este documento describe las mejoras de robustez implementadas en OrderFlowDesktop (App 9) y que deben replicarse en las demas aplicaciones desktop.

---

## PROBLEMA ORIGINAL

### Sintomas Reportados
1. **Gaps de 5+ minutos** en las velas al iniciar la aplicacion
2. **Indicadores tardaban ~10 minutos** en aparecer
3. **Cientos de errores** `ERR_CONNECTION_REFUSED` en consola
4. **Graficos congelados** al minimizar o apagar pantalla (solo browser)

### Causas Identificadas
1. Frontend (Electron) iniciaba **antes** de que el backend estuviera listo
2. Backend tarda ~1 minuto en cargar footprints/datos del disco
3. El **cache de IndexedDB** tenia gaps de sesiones anteriores
4. La carga incremental **no rellena gaps historicos**
5. Sin validacion de datos corruptos
6. Sin mecanismo de reconexion automatica

---

## SOLUCIONES IMPLEMENTADAS EN APP 9 (OrderFlowDesktop)

### Fase 1: Optimizaciones de Carga

#### 1.1 Cache en Backend con TTL
**Archivo:** `backend/main.py`

```python
HISTORICAL_CACHE = {}
HISTORICAL_CACHE_TTL = 300  # 5 minutos

# Endpoints:
# POST /api/cache/clear - Limpiar cache manualmente
# GET /api/cache/status - Ver estado del cache
```

**Beneficio:** Reduce carga repetida de datos historicos.

#### 1.2 Deteccion de Gaps en Cache Frontend
**Archivo:** `src/utils/CandleCache.js`

```javascript
// En getValidated(): detecta gaps y limpia cache si hay gaps >2 minutos
static async getValidated(symbol, interval, days) {
  const cached = await this.get(symbol, interval);
  // ...
  const gapAnalysis = this.analyzeGaps(cached.candles, interval, context);
  if (gapAnalysis.gapCount > 0) {
    const significantGaps = gapAnalysis.gaps.filter(g => parseFloat(g.gapMinutes) > 2);
    if (significantGaps.length > 0) {
      await this.clear(symbol, interval);  // Forzar recarga completa
      return null;
    }
  }
  // ...
}
```

**Beneficio:** Cache corrupto se detecta automaticamente y se fuerza recarga.

#### 1.3 MIN_CACHE_RATIO Aumentado
**Archivo:** `src/utils/CandleCache.js`

```javascript
// Antes: 0.1 (10%) - aceptaba cache casi vacio
// Ahora: 0.7 (70%) - requiere al menos 70% de velas esperadas
static MIN_CACHE_RATIO = 0.7;
```

**Beneficio:** Evita usar cache con datos insuficientes.

#### 1.4 Carga Secuencial de Indicadores
**Archivo:** `src/components/indicators/IndicatorManager.js`

```javascript
// Prioridad 1 (criticos): VWAP, Order Flow - cargan primero
// Prioridad 2 (secundarios): Swing Detector, S&R v2 - 100ms despues
// Prioridad 3 (opcionales): Volume Profile, DTB, Rejection - 100ms despues
```

**Beneficio:** Indicadores criticos aparecen rapido, los demas no bloquean.

#### 1.5 Prefetch Deshabilitado Inicialmente
**Archivo:** `src/components/SymbolList.jsx`

```javascript
// Prefetch de simbolos deshabilitado los primeros 10 segundos
// Debounce aumentado de 300ms a 1000ms
const PREFETCH_DELAY_INITIAL = 10000;
const PREFETCH_DEBOUNCE = 1000;
```

**Beneficio:** No compite por recursos durante carga inicial.

#### 1.6 Spinner de Carga
**Archivo:** `src/components/MiniChart.jsx`

```javascript
// Indicador visual mientras !isInitialized
{!isInitialized && (
  <div className="loading-overlay">
    <div className="spinner"></div>
    <span>Cargando datos...</span>
  </div>
)}
```

**Beneficio:** Usuario sabe que la app esta cargando, no que esta rota.

#### 1.7 Script de Inicio Coordinado
**Archivo:** `START_ALL.bat`

```batch
# Flujo:
# 1. Verifica si backend ya esta corriendo (curl /api/status)
# 2. Si no, inicia backend en ventana separada
# 3. Espera hasta que /api/status responda (max 2 min)
# 4. Inicia Electron solo cuando backend esta listo
```

**Beneficio:** Elimina errores ERR_CONNECTION_REFUSED al iniciar.

---

### Fase 2: Mejoras de Robustez

#### 2.1 Sistema de Robustez Centralizado
**Archivo:** `src/utils/robustness.js` (NUEVO)

Contiene todas las utilidades de robustez en un solo lugar:

##### 2.1.1 Validacion de Datos de Velas

```javascript
export function validateCandle(candle) {
  // Valida campos requeridos: timestamp, open, high, low, close
  // Valida tipos numericos (no NaN)
  // Valida logica OHLC (high >= low, open/close dentro de rango)
  // Valida timestamp razonable (2020-2030)
  return { valid: boolean, errors: string[] };
}

export function validateCandles(candles, context) {
  // Filtra velas invalidas
  // Loguea errores (max 5)
  return { validCandles: Array, invalidCount: number, errors: string[] };
}
```

##### 2.1.2 Health Check del Backend

```javascript
// Estado global
let healthCheckState = {
  isConnected: true,
  lastCheck: null,
  lastError: null,
  consecutiveFailures: 0,
  listeners: new Set()
};

export function onConnectionChange(callback) {
  // Registra listener para cambios de conexion
  // Notifica estado actual inmediatamente
  return () => unsubscribe();
}

export async function checkBackendHealth() {
  // GET /api/status con timeout de 5s
  // Actualiza estado y notifica listeners
  return boolean;
}

export function startHealthCheck(intervalMs = 30000) {
  // Check inmediato + periodico cada 30s
}

export function stopHealthCheck() {
  // Detiene el intervalo
}
```

##### 2.1.3 Retry con Backoff Exponencial

```javascript
export async function withRetry(fn, options = {}) {
  // maxRetries: 3
  // initialDelayMs: 1000
  // maxDelayMs: 30000
  // backoffFactor: 2
  // shouldRetry: (error) => boolean
  // onRetry: (attempt, error, delay) => void
}

export async function fetchWithRetry(url, fetchOptions, retryOptions) {
  // Wrapper para fetch con retry automatico
  // Reintenta en errores de red o 5xx
  // No reintenta si fue cancelado (AbortError)
}
```

##### 2.1.4 Limpieza Automatica de Cache

```javascript
export async function cleanupOldCache(maxAgeDays = 7) {
  // Limpia cache de velas >7 dias
  // Limpia cache de indicadores >7 dias
  return { candlesRemoved, indicatorsRemoved, ... };
}

export async function getCacheStats() {
  // Retorna estadisticas del cache actual
  return { candles: {...}, indicators: {...} };
}
```

##### 2.1.5 Inicializacion

```javascript
export function initRobustness() {
  startHealthCheck(30000);  // Health check cada 30s
  cleanupOldCache(7);       // Limpiar cache >7 dias
  console.log('[Robustness] Initialized');
}

export function stopRobustness() {
  stopHealthCheck();
  console.log('[Robustness] Stopped');
}
```

#### 2.2 Indicador Visual de Conexion
**Archivo:** `src/components/ConnectionStatus.jsx` (NUEVO)

```jsx
// Punto verde/rojo en el header
// Tooltip con detalles (ultimo check, errores, intentos fallidos)
// Click para reintentar conexion manual
// Se actualiza automaticamente cada 30 segundos
```

#### 2.3 Integracion en Componentes

**CandleCache.js:**
```javascript
import { validateCandles } from './robustness';

static async set(symbol, interval, candles) {
  const validation = validateCandles(candles, `${symbol}@${interval}`);
  const validCandles = validation.validCandles;
  // Solo guarda velas validas
}
```

**MiniChart.jsx:**
```javascript
import { fetchWithRetry } from '../utils/robustness';

const res = await fetchWithRetry(url, {
  cache: 'no-cache',
  headers: { 'Cache-Control': 'no-cache' }
}, {
  maxRetries: 3,
  initialDelayMs: 1000,
  context: `historical-${symbol}`
});
```

**SingleSymbolAnalyzer.jsx:**
```javascript
import ConnectionStatus from "./ConnectionStatus";
import { initRobustness, stopRobustness } from '../utils/robustness';

useEffect(() => {
  initRobustness();
  return () => stopRobustness();
}, []);

// En el header:
<ConnectionStatus />
```

---

## CHECKLIST DE IMPLEMENTACION PARA OTRAS APPS

### Aplicaciones Objetivo
- [x] **App 7: WatchlistDesktop** (`7.WatchlistDesktop/`) - Completada 29 Enero 2026
- [x] **App 8: AnalizadorDesktop** (`8.AnalizadorDesktop/`) - Completada 29 Enero 2026

### Para Cada Aplicacion:

#### Fase 1: Optimizaciones de Carga
- [ ] 1.1 Verificar/agregar cache con TTL en backend (si aplica)
- [ ] 1.2 Copiar `CandleCache.js` con deteccion de gaps
- [ ] 1.3 Verificar MIN_CACHE_RATIO = 0.7
- [ ] 1.4 Implementar carga secuencial de indicadores en `IndicatorManager.js`
- [ ] 1.5 Deshabilitar prefetch inicial en `SymbolList.jsx`
- [ ] 1.6 Agregar spinner de carga en `MiniChart.jsx`
- [ ] 1.7 Crear `START_ALL.bat` con inicio coordinado

#### Fase 2: Mejoras de Robustez
- [ ] 2.1 Copiar `src/utils/robustness.js`
- [ ] 2.2 Copiar `src/components/ConnectionStatus.jsx`
- [ ] 2.3a Integrar validacion en `CandleCache.js`
- [ ] 2.3b Integrar fetchWithRetry en `MiniChart.jsx`
- [ ] 2.3c Integrar initRobustness en componente raiz
- [ ] 2.3d Agregar ConnectionStatus al header

#### Verificacion
- [ ] Iniciar con backend apagado - debe mostrar "Offline" y reconectarse
- [ ] Verificar consola: logs de `[Robustness]`, `[HealthCheck]`, `[CacheCleanup]`
- [ ] Verificar que gaps en cache se detectan y limpian
- [ ] Verificar que retry funciona (desconectar/reconectar backend)

---

## ARCHIVOS A COPIAR

Desde `9.OrderFlowDesktop/src/`:

```
utils/
  robustness.js          → Copiar completo
  CandleCache.js         → Copiar completo (incluye deteccion de gaps)

components/
  ConnectionStatus.jsx   → Copiar completo
```

---

## NOTAS IMPORTANTES

### Dependencias
- `localforage` - Para cache de IndexedDB (ya deberia estar instalado)

### Puertos por Aplicacion
| App | Backend | Frontend |
|-----|---------|----------|
| 7. WatchlistDesktop | 8000 | Electron |
| 8. AnalizadorDesktop | 10000 | Electron |
| 9. OrderFlowDesktop | 11000 | Electron |

### Config URLs
Verificar que `src/config.js` tenga el puerto correcto:
- App 7: `API_BASE_URL = "http://localhost:8000"`
- App 8: `API_BASE_URL = "http://localhost:10000"`
- App 9: `API_BASE_URL = "http://localhost:11000"`

---

## MEJORAS FUTURAS (No Implementadas)

### Pendientes de Evaluar
1. **Persistencia de sesion mejorada** - Guardar estado de zoom, posicion, indicadores activos
2. **Notificaciones de reconexion** - Toast o notificacion nativa cuando reconecta
3. **Modo offline** - Mostrar datos del cache cuando backend no disponible
4. **Diagnostico automatico** - Panel de debug con estado de todos los sistemas
5. **Auto-recovery de indicadores** - Reiniciar indicadores que fallen sin reiniciar app

---

*Documento creado: 29 Enero 2026*
*Ultima actualizacion: 29 Enero 2026*
