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
| `4.Analizador cripto/` | Analizador de un solo simbolo (optimizado) | 10000 | 10001 |
| `5.Order_flow/` | Analizador de Order Flow con Footprint | 11000 | 11001 |
| `6.Trading_Journal/` | Diario de trading con metricas y screenshots | 12000 | 12001 |
| `7.WatchlistDesktop/` | Watchlist version Electron (en desarrollo) | 8000 | Electron |
| `8.AnalizadorDesktop/` | **Analizador Desktop - Version Electron sin throttling** | 10000 | 5174 |
| `9.OrderFlowDesktop/` | **Order Flow Desktop - Version Electron optimizada** | 11000 | 5175 |
| `10.TradingBotDesktop/` | **Trading Bot Desktop - Version Electron** | 5000 | 5001 |
| `11.TradingJournalDesktop/` | **Trading Journal Desktop - Version Electron** | 12000 | 12002 |

**Stack comun:**
- Frontend: React 18 + Vite + uPlot
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)
- Desktop: Electron 33+ (Apps 7-11)

---

# APP 1: ALTAGRACIA CRYPTO BACKTESTER

**Ubicacion:** `1.Altagracia_Crypto_Backtester/Backtester/`

Sistema profesional de backtesting para criptomonedas con analisis avanzado de patrones, volumen y momentum.

## Estructura

```
Backtester/
├── backend/
│   ├── main.py                      # Servidor principal (94KB, ~2400 lineas)
│   ├── double_topbottom_detector.py # Detector DTB (60KB)
│   ├── rejection_detector.py        # Detector patrones rechazo (19KB)
│   ├── alert_sender.py              # Sistema alertas (10KB)
│   ├── vwap_calculator.py           # Calculador VWAP (13KB)
│   ├── cache/                       # Cache datos historicos
│   ├── backtesting_cache/           # Cache especifico backtesting
│   └── drawings/                    # Dibujos guardados (JSON)
│
├── frontend/
│   ├── src/components/
│   │   ├── backtesting/
│   │   │   ├── BacktestingApp.jsx   # Componente raiz (84KB)
│   │   │   ├── BacktestingChart.jsx # Grafico principal (43KB)
│   │   │   ├── TimeController.js    # Control temporal (12KB)
│   │   │   ├── OrderManager.js      # Gestor ordenes (18KB)
│   │   │   ├── TradingControls.jsx  # Controles trading (11KB)
│   │   │   ├── PerformancePanel.jsx # Metricas (11KB)
│   │   │   ├── TradeHistory.jsx     # Historial (7KB)
│   │   │   └── SessionManager.js    # Sesiones (9KB)
│   │   ├── indicators/              # Sistema indicadores (compartido)
│   │   ├── MiniChart.jsx            # Grafico con indicadores (92KB)
│   │   └── Watchlist.jsx            # Watchlist (13KB)
│   └── dist/                        # Build produccion
```

## Comandos

```bash
# Backend
cd 1.Altagracia_Crypto_Backtester/Backtester/backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000

# Frontend
cd 1.Altagracia_Crypto_Backtester/Backtester/frontend
npm install && npm run dev
```

## Funcionalidades

- **29 pares de criptomonedas** soportados
- **10 indicadores tecnicos** simultaneos
- **Deteccion automatica** de patrones (DTB, Rejection)
- **Backtesting realista** con ordenes market/limit/stop
- **TimeController** con subdivisiones intravela (1x, 2x, 5x, 10x)
- **Metricas**: win rate, drawdown, Sharpe ratio
- **Zoom dinamico v3.0** similar a TradingView
- **Exportacion**: Excel, CSV, PNG
- **Persistencia de sesiones**

## Endpoints Backend

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado servidor |
| `/api/historical/{symbol}` | GET | Datos OHLCV |
| `/api/volume-delta/{symbol}` | GET | Volume Delta + CVD |
| `/api/rejection-patterns/detect` | POST | Detecta patrones |
| `/api/double-topbottom/detect` | POST | Detecta DTB |
| `/api/double-topbottom/chunk` | GET | DTB por chunks |

---

# APP 2: WATCHLIST CON INDICADORES

**Ubicacion:** `2.WatchlistConIndicadores/`

Watchlist en tiempo real con indicadores avanzados y sistema de alertas.

## Estructura

```
2.WatchlistConIndicadores/
├── backend/
│   ├── main.py                       # Servidor principal (~3000 lineas)
│   ├── alert_sender.py               # Sistema alertas (puerto 5000)
│   ├── config_store.py               # Store configuracion
│   ├── double_topbottom_detector.py  # Detector DTB (63KB)
│   ├── rejection_detector.py         # Detector rechazo (28KB)
│   ├── realtime_pattern_service.py   # Orquestador deteccion (35KB)
│   ├── pattern_state_manager.py      # Estado patrones (14KB)
│   ├── websocket_manager.py          # WebSocket Bybit (15KB)
│   ├── vwap_calculator.py            # VWAP
│   ├── fibonacci_calculator.py       # Fibonacci
│   ├── cache/                        # Cache (30 min TTL)
│   ├── config/                       # Configuraciones
│   └── drawings/                     # Dibujos por simbolo
│
├── frontend/
│   ├── src/components/
│   │   ├── Watchlist.jsx             # Raiz (51KB)
│   │   ├── MiniChart.jsx             # Grafico (105KB)
│   │   ├── AlertHistoryPanel.jsx
│   │   ├── *Settings.jsx             # Configuraciones
│   │   ├── indicators/
│   │   │   ├── IndicatorManager.js   # Orquestador (56KB)
│   │   │   ├── RejectionPatternIndicator.js (114KB)
│   │   │   ├── DoubleTopBottomIndicator.js (96KB)
│   │   │   ├── VWAPIndicator.js (41KB)
│   │   │   ├── VolumeProfileIndicator.js
│   │   │   ├── CVDIndicator.js
│   │   │   └── ... (13 indicadores)
│   │   ├── drawing/
│   │   ├── ProximityAlerts/
│   │   └── SlidingAlertPanel/
│   ├── hooks/useGlobalAlerts.js
│   └── utils/
```

## Comandos

```bash
# Backend
cd 2.WatchlistConIndicadores/backend
start_backend.bat  # O manual con uvicorn --port 8000

# Frontend
cd 2.WatchlistConIndicadores/frontend
npm install && npm run dev
```

## Funcionalidades

- **Tiempo real** via WebSocket Bybit
- **13 indicadores** activos simultaneos
- **Deteccion de patrones**: DTB, Rejection (Hammer, Shooting Star, Engulfing, Doji)
- **Sistema de alertas**: Backend, Browser Notifications, localStorage
- **Volume Profile**: dinamico y rangos fijos
- **VWAP** con bandas de desviacion
- **Range Detection** basado en ATR
- **Herramientas de dibujo** persistentes

## Patrones Detectados

| Patron | Emoji | Direccion |
|--------|-------|-----------|
| HAMMER | 🔨 | Alcista |
| SHOOTING_STAR | ⭐ | Bajista |
| ENGULFING_BULLISH | 📈 | Alcista |
| ENGULFING_BEARISH | 📉 | Bajista |
| DOJI_DRAGONFLY | 🐉 | Alcista |
| DOJI_GRAVESTONE | 🪦 | Bajista |
| DOUBLE_TOP | 🔻 | Bajista |
| DOUBLE_BOTTOM | 🔺 | Alcista |

## Limites de Timeframe

**CRITICO: Deben coincidir en backend Y frontend**

```python
MAX_DAYS_BY_INTERVAL = {
    "1": 5, "5": 30, "15": 90, "60": 360, "240": 720, "D": 1440, "W": 730
}
```

---

# APP 3: TRADING BOT PYTHON

**Ubicacion:** `3.TradingBot_Python/`

Bot de trading automatizado que ejecuta ordenes en Bybit basado en alertas.

**Ver documentacion completa en:** `3.TradingBot_Python/CLAUDE.md`

## Estructura

```
3.TradingBot_Python/
├── backend/
│   ├── main.py                  # Servidor FastAPI (~1500 lineas)
│   ├── trading/
│   │   ├── bybit_client.py      # Cliente API Bybit (~740 lineas)
│   │   ├── order_manager.py     # Gestor ordenes (~680 lineas)
│   │   ├── risk_calculator.py   # Calculadora riesgo
│   │   ├── rate_limiter.py      # Token Bucket rate limiter
│   │   ├── direction_manager.py # Filtros direccion
│   │   └── alert_parser.py      # Parser alertas ATAS
│   └── requirements.txt
│
├── frontend/
│   └── src/components/
│       ├── CredentialsPanel.jsx # Config credenciales + metodo ejecucion
│       ├── ConfigManager.jsx    # Gestion de simbolos
│       ├── DirectionManager.jsx # Filtros LONG/SHORT
│       └── ...
│
├── config/
│   ├── trading_config.json      # Config ~21 simbolos
│   ├── credentials.json         # API keys (runtime)
│   ├── trading_directions.json  # Direcciones permitidas
│   └── bot_settings.json        # Configuracion del bot (metodo ejecucion)
│
├── START_HERE.bat               # Inicio automatico
└── CLAUDE.md                    # Documentacion detallada
```

## Funcionalidades Principales

- **Dos metodos de ejecucion**: Sequential (3 calls) o Integrated (1 call con TP/SL)
- **Auto-precision**: Fetch automatico de step_size/tick_size desde Bybit
- **Cliente Bybit optimizado**: Connection pooling, rate limiting, retry automatico
- **21 simbolos** preconfigurados
- **Soporte Market y Limit orders** con TP/SL integrado

## Optimizaciones (Enero 2026)

- Token Bucket rate limiter
- Connection pooling con httpx
- Intelligent polling (no fixed sleeps)
- Auto-sync de precision desde Bybit API

---

# INTEGRACION ENTRE APLICACIONES

## Flujo Completo de Trading

```
1. BACKTESTER (App 1)
   - Desarrolla y prueba estrategias
   - Analiza patrones historicos
   - Optimiza parametros
   ↓
2. WATCHLIST (App 2)
   - Monitorea mercado en tiempo real
   - Detecta patrones configurados
   - Genera alertas automaticas
   ↓
3. TRADING BOT (App 3)
   - Recibe alertas de Watchlist (puerto 5000)
   - Ejecuta ordenes en Bybit
   - Gestiona SL/TP automaticamente
```

## Conexion Watchlist → Bot

La Watchlist envia alertas al puerto 5000:

```python
# En 2.WatchlistConIndicadores/backend/alert_sender.py
async def send_alert(alert_data):
    await httpx.post("http://localhost:5000/api/watchlist-alert", json=alert_data)
```

El Bot las recibe y ejecuta:

```python
# En 3.TradingBot_Python/backend/main.py
@app.post("/api/watchlist-alert")
async def process_watchlist_alert(alert: dict):
    # Ejecuta orden si pasa filtros
```

---

# AREAS DE MEJORA GLOBALES

## P0 - Critico

1. **Codigo duplicado en indicadores** ⏸️ DESCARTADO
   - Sistemas de alertas casi identicos en RejectionPatternIndicator y DoubleTopBottomIndicator
   - **Estado:** Indicadores deprecados, no se usaran mas

2. **Configuraciones duplicadas**
   - MAX_DAYS_BY_INTERVAL en backend Y frontend
   - Solucion: Endpoint API que retorne limites
   - **Estado:** Pendiente (bajo impacto)

3. **Archivos deprecated**
   - Multiples backups y versiones _1, _fixed, etc.
   - Solucion: Limpiar y usar git history

## P1 - Alto

1. **localStorage Management** ✅ RESUELTO
   - 91+ instancias sin centralizar
   - Solucion: `StorageManager.js` creado con debounce y cache
   - **Implementado:** Enero 2026

2. **Deteccion de patrones duplicada** ⏸️ DESCARTADO
   - Frontend y backend tienen logica similar
   - **Estado:** DTB y Rejection estan deprecados, ya no aplica

3. **Logging inconsistente**
   - Mezcla de console.log y Logger
   - Solucion: Usar siempre Logger
   - **Estado:** Pendiente (bajo impacto)

## P2 - Medio

1. **Performance** ✅ RESUELTO
   - Precarga deshabilitada, re-renders frecuentes
   - Solucion: React.memo, PollingScheduler, cache de calculos
   - **Implementado:** Enero 2026 (ver seccion OPTIMIZACIONES DE RENDIMIENTO)
   - **Resultado:** 90% idle, JS Heap estable 32-37 MB, sin memory leaks

2. **Web Workers** ⏸️ DESCARTADO
   - Calculos pesados en frontend
   - **Estado:** No necesario - DTB/Rejection deprecados, VWAP/Swing en backend, CVD con cache
   - **Justificacion:** 90% idle en pruebas confirma que no hay cuellos de botella

3. **Base de datos**
   - Todo en JSON, no hay DB real
   - Solucion: SQLite o PostgreSQL
   - **Estado:** Pendiente (fuera de scope actual)

4. **Tests**
   - Tests abandonados, no CI/CD
   - Solucion: Integrar en pipeline
   - **Estado:** Pendiente (fuera de scope actual)

---

# OPTIMIZACIONES DE RENDIMIENTO (Enero 2026)

## Resumen

Se implementaron 13 optimizaciones para reducir consumo de RAM y CPU ~50%.

## Backend - Optimizaciones Implementadas

### 1. HTTP Client Global con Connection Pooling
**Archivo:** `backend/main.py`

```python
_http_client: Optional[httpx.AsyncClient] = None

async def get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None:
        _http_client = httpx.AsyncClient(
            timeout=30,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10)
        )
    return _http_client
```

**Beneficio:** Reutiliza conexiones HTTP en lugar de crear nuevas cada request. Reduce latencia ~30%.

### 2. Cache Cleanup Automatico
**Archivo:** `backend/main.py`

```python
async def cache_cleanup_loop():
    while True:
        await asyncio.sleep(10 * 60)  # Cada 10 minutos
        now = time.time()
        for cache_file in CACHE_DIR.glob("*.json"):
            mtime = cache_file.stat().st_mtime
            if now - mtime > CACHE_MAX_AGE:
                cache_file.unlink()
```

**Beneficio:** Elimina archivos de cache expirados automaticamente. Previene crecimiento ilimitado del disco.

### 3. ThreadPoolExecutor para I/O No-Bloqueante
**Archivo:** `backend/pattern_state_manager.py`

```python
self._lock = threading.RLock()  # Cambio de Lock a RLock
self._io_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="pattern_io")

def _save_alerted_patterns(self) -> None:
    data_copy = dict(self._alerted_patterns)
    self._io_executor.submit(self._write_json_file, ALERTED_PATTERNS_FILE, data_copy)
```

**Beneficio:** Las escrituras JSON no bloquean el event loop. Reduce CPU ~20%.

### 4. Limite de Callbacks en WebSocket
**Archivo:** `backend/websocket_manager.py`

```python
MAX_CALLBACKS = 5

def add_candle_close_listener(self, callback):
    if len(self._candle_close_callbacks) >= self.MAX_CALLBACKS:
        logger.warning(f"Max callbacks ({self.MAX_CALLBACKS}) reached, removing oldest")
        self._candle_close_callbacks.pop(0)
    self._candle_close_callbacks.append(callback)
```

**Beneficio:** Previene acumulacion infinita de callbacks. Memoria acotada.

### 5. Buffer Tracking y Cleanup
**Archivo:** `backend/websocket_manager.py`

```python
self._buffer_last_access: Dict[str, float] = {}  # Track ultimo acceso

def stop(self):
    # Limpieza de buffers no usados
    self._candle_buffers.clear()
    self._buffer_last_access.clear()
    self._candle_close_callbacks.clear()
```

**Beneficio:** Limpia recursos al detener. Reduce memoria ~40%.

### 6. Task Tracking con Cancelacion
**Archivo:** `backend/realtime_pattern_service.py`

```python
self._active_tasks: set = set()

# En _on_candle_close:
task = asyncio.create_task(self._detect_patterns(symbol, interval, candle))
self._active_tasks.add(task)
task.add_done_callback(self._active_tasks.discard)

# En stop():
for task in self._active_tasks:
    task.cancel()
```

**Beneficio:** Permite cancelar tareas pendientes al detener. Evita tareas huerfanas.

### 7. Preload No-Bloqueante
**Archivo:** `backend/realtime_pattern_service.py`

```python
# En start():
await self.ws_manager.start(self.symbols, self.intervals)
preload_task = asyncio.create_task(self._preload_historical_candles())
self._active_tasks.add(preload_task)
# NO esperamos - el servicio esta disponible inmediatamente
```

**Beneficio:** El servicio inicia inmediatamente. Preload corre en background.

### 8. Cola de Alertas con Limite
**Archivo:** `backend/alert_sender.py`

```python
MAX_QUEUE_SIZE = 100
self.alert_queue: asyncio.Queue = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)

try:
    self.alert_queue.put_nowait(alert_payload)
except asyncio.QueueFull:
    discarded = self.alert_queue.get_nowait()  # Descartar mas vieja
    self._discarded_count += 1
    self.alert_queue.put_nowait(alert_payload)
```

**Beneficio:** Memoria acotada. Politica FIFO con descarte de alertas viejas.

## Frontend - Optimizaciones Implementadas

### 9. React.memo con Comparador Custom
**Archivo:** `frontend/src/components/MiniChart.jsx`

```javascript
export default React.memo(MiniChart, (prevProps, nextProps) => {
  return (
    prevProps.symbol === nextProps.symbol &&
    prevProps.interval === nextProps.interval &&
    prevProps.days === nextProps.days &&
    prevProps.indicatorStates === nextProps.indicatorStates &&
    prevProps.isFullscreenChild === nextProps.isFullscreenChild &&
    prevProps.externalDrawingMode === nextProps.externalDrawingMode
  );
});
```

**Beneficio:** Evita re-renders innecesarios. Reduce renders ~50%.

### 10. Visibility Check en Polling
**Archivos:** `VWAPIndicator.js`, `SwingDetectorIndicator.js`

```javascript
_startPolling() {
  this._pollingInterval = setInterval(() => {
    if (document.visibilityState === 'hidden') {
      return;  // No hacer nada si tab oculto
    }
    if (this.enabled && !this._destroyed) {
      this.fetchData();
    }
  }, this.fetchIntervalMs);
}
```

**Beneficio:** Pausa polling cuando el tab no es visible. Ahorra CPU y red.

### 11. Cache de Calculos CVD
**Archivo:** `frontend/src/components/indicators/CVDIndicator.js`

```javascript
this._cvdCache = null;
this._cvdCacheKey = null;

calculateCVD(candles) {
  const lastCandle = candles[candles.length - 1];
  const cacheKey = `${candles.length}_${lastCandle?.timestamp}_${lastCandle?.close}`;

  if (this._cvdCacheKey === cacheKey && this._cvdCache) {
    return this._cvdCache;  // Retorna cache si no cambio
  }
  // ... calculo ...
  this._cvdCache = cvdData;
  this._cvdCacheKey = cacheKey;
  return cvdData;
}
```

**Beneficio:** Evita recalcular CVD en cada frame. Reduce CPU render ~80%.

### 12. PollingScheduler Centralizado
**Archivo:** `frontend/src/utils/PollingScheduler.js` (NUEVO)

```javascript
class PollingScheduler {
  constructor() {
    this._callbacks = new Map();
    this._mainTimer = null;
    this._tickIntervalMs = 1000;
  }

  register(callback, intervalMs, priority = 5) {
    const id = `poll_${++this._idCounter}`;
    this._callbacks.set(id, { callback, intervalMs, lastRun: 0, priority, enabled: true });
    return id;
  }

  _tick() {
    if (document.visibilityState === 'hidden') return;
    // Ejecuta callbacks segun su intervalo y prioridad
  }
}
```

**Beneficio:** Un solo timer en lugar de N timers. Reduce overhead ~70%.

### 13. StorageManager con Debounce
**Archivo:** `frontend/src/utils/StorageManager.js` (NUEVO)

```javascript
class StorageManager {
  constructor(namespace = 'watchlist') {
    this._cache = new Map();
    this._pendingWrites = new Map();
    this._debounceMs = 2000;  // 2 segundos
  }

  set(key, value) {
    this._cache.set(fullKey, value);  // Cache inmediato
    this._pendingWrites.set(fullKey, value);
    this._scheduleFlush();  // Debounce de escritura
  }

  flush() {
    for (const [fullKey, value] of this._pendingWrites) {
      localStorage.setItem(fullKey, JSON.stringify(value));
    }
    this._pendingWrites.clear();
  }
}
```

**Beneficio:** Reduce escrituras a localStorage ~90%. Cache en memoria para lecturas instantaneas.

## Tabla Resumen de Impacto

| Area | Problema | Solucion | Impacto |
|------|----------|----------|---------|
| HTTP | Sin pooling | httpx.AsyncClient global | -30% latencia |
| I/O | JSON bloqueante | ThreadPoolExecutor | -20% CPU |
| WebSocket | Callbacks ilimitados | MAX_CALLBACKS=5 | -40% memoria |
| Alertas | Queue sin limite | maxsize=100 | Memoria acotada |
| React | Re-renders | React.memo | -50% renders |
| Polling | N timers | PollingScheduler | -70% timers |
| localStorage | Writes sincronos | StorageManager debounce | -90% writes |
| CVD | Recalculo/frame | Cache fingerprint | -80% CPU render |

## Archivos Nuevos Creados

1. `frontend/src/utils/PollingScheduler.js` (~215 lineas)
2. `frontend/src/utils/StorageManager.js` (~313 lineas)

## Archivos Modificados

### Backend
- `main.py` - HTTP client, cache cleanup
- `pattern_state_manager.py` - RLock, ThreadPoolExecutor
- `websocket_manager.py` - Callback limits, buffer cleanup
- `realtime_pattern_service.py` - Task tracking, non-blocking preload
- `alert_sender.py` - Queue maxsize

### Frontend
- `MiniChart.jsx` - React.memo wrapper
- `VWAPIndicator.js` - Visibility check
- `SwingDetectorIndicator.js` - Visibility check
- `CVDIndicator.js` - Calculation cache
- `IndicatorManager.js` - Scheduler integration

## Indicadores Excluidos

Los siguientes indicadores fueron excluidos de modificaciones por estar deprecados:
- `RejectionPatternIndicator.js`
- `DoubleTopBottomIndicator.js`

## Verificacion de Mejoras

Para verificar el impacto:
1. DevTools → Performance → grabar 30 segundos de uso
2. Comparar CPU y memoria antes/despues
3. Network → verificar reutilizacion de conexiones
4. Console → logs de `[StorageManager]` y `[PollingScheduler]`

## Resultados de Pruebas (Enero 2026)

### Mejoras en Sistema Operativo
Ademas de las optimizaciones de la app, se desactivaron servicios innecesarios de Windows:

| Servicio Desactivado | RAM Liberada |
|---------------------|--------------|
| Omen Command Center | ~833 MB |
| Widgets de Windows | ~50-100 MB |
| SysMain/SuperFetch | ~200-500 MB |
| HP Telemetria | ~130 MB |
| Windows Search (opcional) | ~100-150 MB |

**Resultado:** RAM del sistema bajo de 80% a 40%, PC dejo de recalentarse.

### Performance Test de la Aplicacion

Prueba de 26 segundos con interacciones (dibujo, mover grafico, cambiar settings):

| Metrica | Valor | Estado |
|---------|-------|--------|
| **Idle time** | 90% | ✅ Excelente |
| **JS Heap** | 32.5 - 37.3 MB | ✅ Estable |
| **DOM Nodes** | 1,373 - 1,591 | ✅ Sin crecimiento |
| **Scripting** | 1,732 ms (6.7%) | ✅ Bajo |
| **Rendering** | 178 ms (0.7%) | ✅ Muy bajo |
| **CLS** | 0.02 | ✅ Excelente |
| **INP** | 55 ms | ✅ Responsivo |

### Conclusion

- **90% idle** confirma que la app no consume CPU innecesariamente
- **JS Heap estable** indica ausencia de memory leaks
- **Respuesta UI mejorada** segun feedback del usuario

## Decisiones de Arquitectura

### Web Workers - NO Implementado

Se evaluo implementar Web Workers para calculos pesados pero se descarto porque:

1. **DTB y Rejection Patterns** estan deprecados (eran los mas pesados)
2. **VWAP y Swing Detector** ya calculan en backend
3. **CVD** ya tiene cache optimizado
4. **Volume Profile** no es suficientemente pesado para justificar el esfuerzo

**Conclusion:** El 90% de idle en las pruebas confirma que no hay necesidad de Web Workers.

## Items Pendientes (Bajo Impacto)

| Item | Impacto | Estado |
|------|---------|--------|
| VolumeProfile throttle en mousemove | Bajo | Pendiente |
| Unificar logging (console.log vs Logger) | Bajo | Pendiente |
| MAX_DAYS_BY_INTERVAL en endpoint API | Bajo | Pendiente |

Estos items se pueden implementar si surge necesidad, pero no son criticos para el rendimiento actual.

---

# ESTADISTICAS GLOBALES

| Metrica | Backtester | Watchlist | Trading Bot | Analizador | Total |
|---------|------------|-----------|-------------|------------|-------|
| Python LOC | ~3,000 | ~3,000 | ~2,200 | ~3,500 | ~11,700 |
| React LOC | ~4,000 | ~15,000 | ~3,000 | ~15,000 | ~37,000 |
| Indicadores | 10 | 13 | - | 13 | 13 (compartidos) |
| Simbolos | 29 | 2 activos | 16 | 12 activos | 29 |
| Endpoints | 8 | 10 | 12 | 15 | 45 |
| Puerto Backend | 9000 | 8000 | 5000 | 10000 | - |

---

# ARQUITECTURA DE ALERTAS BACKEND (Watchlist → Trading Bot)

## Objetivo
El backend es el UNICO responsable de detectar patrones y enviar alertas al Trading Bot.
El frontend solo debe GRAFICAR patrones, nunca enviar alertas.

## Flujo de Alertas Backend

```
1. CONEXION WEBSOCKET
   websocket_manager.py → Binance/Bybit WebSocket
        ↓
   Recibe candles en tiempo real
        ↓
2. DETECCION (en realtime_pattern_service.py)
   _on_candle_close()
        ↓
   _detect_patterns() → Requiere minimo 50 velas
        ↓
   _detect_dbt_patterns() / _detect_rejection_patterns()
        ↓
   Verifica alertsEnabled en config (default: True)
        ↓
3. PROCESAMIENTO
   _process_dbt_pattern() / _process_rejection_pattern()
        ↓
   Filtros: minConfidence, cooldown, rate-limit, VWAP
        ↓
4. ENVIO (via alert_sender.py)
   _send_alert() → send_rejection_pattern_alert()
        ↓
   SISTEMA DE COLA ASINCRONA:
   - Encola el alert_payload
   - Retorna True inmediatamente
   - Proceso en background: _process_alert_queue()
        ↓
5. ENTREGA
   POST http://localhost:5000/api/watchlist-alert
        ↓
   Trading Bot recibe y ejecuta
```

## Archivos Clave

| Archivo | Responsabilidad |
|---------|-----------------|
| `realtime_pattern_service.py` | Orquestador de deteccion realtime |
| `websocket_manager.py` | Conexion WebSocket a exchange |
| `pattern_state_manager.py` | Deduplicacion y cooldown |
| `config_store.py` | Configs sincronizados desde frontend |
| `alert_sender.py` | Cola asincrona y envio HTTP |

## Configuracion por Defecto

```python
# _get_default_dbt_config() - linea 786
{
    'alertsEnabled': True,
    'filters': {'minConfidence': 60},
    'alertSettings': {
        'globalCooldown': {'enabled': True, 'minutes': 30}
    }
}

# _get_default_rejection_config() - linea 805
{
    'alertsEnabled': True,
    'filters': {'minConfidence': 50, 'requireNearLevel': False},
    'alertCooldown': {'enabled': True, 'minutes': 30}
}
```

## Sincronizacion de Timeframe

El backend inicia con `intervals=["60"]` (1 hora).
El frontend DEBE sincronizar su timeframe activo:

```javascript
// Cuando el usuario cambia timeframe:
fetch('/api/realtime/set-interval', {
    method: 'POST',
    body: JSON.stringify({ interval: "1" })  // 1 minuto
});
```

## Archivos de Estado (backend/config/)

| Archivo | Contenido |
|---------|-----------|
| `alert_history.json` | Historial de alertas enviadas |
| `cooldown_state.json` | Cooldowns activos por simbolo |
| `alerted_patterns.json` | Patrones ya alertados (deduplicacion) |

## Problema Conocido: TIMEOUT

Si aparece "TIMEOUT ERROR" al enviar al puerto 5000:
1. Verificar que Trading Bot esta corriendo
2. Verificar que escucha en puerto 5000
3. El backend encola y marca "sent" aunque falle el envio

---

# SWING DETECTOR (Nuevo - Enero 2026)

Sistema de deteccion de Swing Highs/Lows en tiempo real con alertas al Trading Bot.

## Archivos del Sistema

### Backend (2.WatchlistConIndicadores/backend/)

| Archivo | Descripcion |
|---------|-------------|
| `swing_detector.py` | Algoritmo de deteccion de swings (N-bar pivots) |
| `swing_service.py` | Servicio de orquestacion con WebSocket y alertas |
| `config/swing_config.json` | Configuracion persistente |
| `logs/swing_alerts.log` | Log de alertas enviadas/bloqueadas |

### Frontend (2.WatchlistConIndicadores/frontend/src/)

| Archivo | Descripcion |
|---------|-------------|
| `components/indicators/SwingDetectorIndicator.js` | Renderiza flechas y zonas en grafico |
| `components/SwingDetectorSettings.jsx` | Panel de configuracion del indicador |

## Configuracion (SwingServiceConfig)

```python
@dataclass
class SwingServiceConfig:
    enabled: bool = True
    symbols: List[str] = ["BTCUSDT", "ETHUSDT"]
    interval: str = "1"           # Timeframe
    days: int = 1                 # Dias de historico a analizar
    swingBars: int = 5            # N velas a cada lado para confirmar swing
    direction: str = "BOTH"       # LONG, SHORT, BOTH
    priceZones: List[Dict] = []   # Zonas de precio activas
    volumeFilter: Dict = {
        "enabled": True,
        "minZScore": 1.5,         # Umbral de z-score de volumen
        "lookbackBars": 20        # Velas para calcular media/std de volumen
    }
    cooldownMinutes: int = 30     # Cooldown entre alertas
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
```

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/swing/status` | GET | Estado del servicio y configuracion |
| `/api/swing/config` | POST | Actualizar configuracion |
| `/api/swing/signals/{symbol}` | GET | Senales detectadas para un simbolo |
| `/api/swing/reanalyze` | POST | Re-analizar historico con nueva config |
| `/api/swing/clear-cooldowns` | POST | Limpiar cooldowns (testing) |
| `/api/swing/add-zone` | POST | Agregar zona de precio |
| `/api/swing/zone/{id}` | DELETE | Eliminar zona de precio |

## Arquitectura y Flujo de Deteccion

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SWING DETECTOR SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌─────────────────┐     ┌──────────────────────────┐  │
│  │   BYBIT      │     │  WEBSOCKET      │     │    SWING SERVICE         │  │
│  │   EXCHANGE   │────▶│  MANAGER        │────▶│    (swing_service.py)    │  │
│  │              │     │                 │     │                          │  │
│  └──────────────┘     │ - Candle stream │     │ - _on_candle_close()     │  │
│                       │ - 200 candle    │     │ - Filtra timestamp       │  │
│                       │   buffer        │     │ - Cooldown check         │  │
│                       └─────────────────┘     └────────────┬─────────────┘  │
│                                                            │                 │
│                       ┌─────────────────┐                  │                 │
│                       │ SWING DETECTOR  │◀─────────────────┘                 │
│                       │ (swing_detector │                                    │
│                       │  .py)           │                                    │
│                       │                 │                                    │
│                       │ - N-bar pivot   │                                    │
│                       │ - Volume z-score│                                    │
│                       │ - Direction     │                                    │
│                       └────────┬────────┘                                    │
│                                │                                             │
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         SIGNAL ROUTING                                  ││
│  ├─────────────────────────────┬───────────────────────────────────────────┤│
│  │                             │                                           ││
│  │  HISTORICO                  │  TIEMPO REAL                              ││
│  │  (_analyze_historical)      │  (_on_candle_close)                       ││
│  │           │                 │           │                               ││
│  │           ▼                 │           ▼                               ││
│  │  _store_signal()            │  Filtrar por timestamp                    ││
│  │  (Solo visualizacion)       │  de vela recien confirmada                ││
│  │           │                 │  [-(swingBars+1)]                         ││
│  │           ▼                 │           │                               ││
│  │  Frontend fetch             │           ▼                               ││
│  │  /api/swing/signals         │  _process_signal()                        ││
│  │                             │           │                               ││
│  │                             │           ▼                               ││
│  │                             │  Cooldown check                           ││
│  │                             │  (por symbol + direction)                 ││
│  │                             │           │                               ││
│  │                             │           ▼                               ││
│  │                             │  _send_alert() ─────────────────────────┐ ││
│  │                             │                                         │ ││
│  └─────────────────────────────┴─────────────────────────────────────────┼─┘│
│                                                                          │  │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                           │
                              ┌────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TRADING BOT (Puerto 5000)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  POST /api/watchlist-alert                                                   │
│           │                                                                  │
│           ▼                                                                  │
│  Detectar source: "SWING_DETECTOR"                                          │
│           │                                                                  │
│           ▼                                                                  │
│  Parsear pattern.direction → side (Buy/Sell)                                 │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  VALIDACIONES                                                           ││
│  │  1. Direction filter (LONG/SHORT/BOTH/DISABLED)                         ││
│  │  2. Symbol config exists                                                ││
│  │  3. No position exists                                                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│           │                                                                  │
│           ▼                                                                  │
│  execute_complete_sequence()                                                 │
│  - Market Order                                                              │
│  - Stop Loss                                                                 │
│  - Take Profit                                                               │
│           │                                                                  │
│           ▼                                                                  │
│  Log to alerts_received.log                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Flujo Detallado

### 1. HISTORICO (al iniciar o reanalizar)
```
_analyze_historical()
    ↓
Calcula velas necesarias: calculate_candles_for_days(interval, days)
    ↓
Obtiene velas de WebSocket buffer o API Bybit (paginado, 200 por request)
    ↓
detector.detect() → Todas las senales historicas
    ↓
_store_signal() → Solo almacena para visualizacion (NO envia alertas)
```

### 2. TIEMPO REAL (en cada cierre de vela)
```
WebSocket candle close event
    ↓
_on_candle_close(symbol, interval, candle)
    ↓
Obtiene buffer de velas del WebSocket manager
    ↓
detector.detect() → Retorna TODAS las senales del buffer
    ↓
FILTRO CRITICO: Solo procesa senal con timestamp de vela en posicion -(swingBars+1)
    ↓
Si hay senal en esa posicion exacta:
    ↓
_process_signal() → Verifica cooldown por (symbol + direction)
    ↓
Si pasa cooldown: _send_alert() → POST al Trading Bot
```

### Logica del Filtro de Timestamp

Un swing necesita `swingBars` velas a cada lado para confirmarse:
- Con swingBars=5, el swing mas reciente confirmable esta en posicion -6
- Cuando cierra la vela actual (posicion -1), confirma el swing de la vela -6
- Solo alertamos swings que se ACABAN de confirmar con este cierre

```python
# En _on_candle_close():
just_confirmed_idx = -(swing_bars + 1)  # Ej: -6 para swingBars=5
just_confirmed_candle = candles[just_confirmed_idx]
just_confirmed_ts = just_confirmed_candle.timestamp

# Solo procesar senales de ESA vela especifica
new_signals = [s for s in signals if s.timestamp == just_confirmed_ts]
```

## Sistema de Cooldowns

- Cooldowns separados por simbolo + direccion
- Ejemplo: BTCUSDT_LONG y BTCUSDT_SHORT tienen cooldowns independientes
- Configurable en minutos desde el panel de settings
- Se puede limpiar manualmente para testing

## Formato de Alerta al Trading Bot

```json
{
    "source": "SWING_DETECTOR",
    "symbol": "BTCUSDT",
    "interval": "1",
    "pattern": {
        "patternType": "SWING_LOW",
        "price": 95000.50,
        "confidence": 75,
        "timestamp": 1705500000000,
        "direction": "LONG",
        "volumeZScore": 2.15
    }
}
```

## Archivos de Log

### Watchlist Backend: `backend/logs/swing_alerts.log`
```
2026-01-17 15:30:45 | INFO | SIGNAL_DETECTED | BTCUSDT | SWING_LOW | price=95000.50 | direction=LONG | volume_zscore=2.15
2026-01-17 15:30:45 | INFO | ALERT_SENT | BTCUSDT | SWING_LOW | price=95000.50 | direction=LONG | target=http://localhost:5000/api/watchlist-alert
2026-01-17 15:35:22 | INFO | BLOCKED_COOLDOWN | BTCUSDT | SWING_HIGH | remaining=1478s
2026-01-17 15:40:00 | ERROR | ALERT_TIMEOUT | ETHUSDT | Trading Bot not responding
```

### Trading Bot: `backend/logs/alerts_received.log`
```
2026-01-17 15:30:45 | SUCCESS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95000.50 | 75.0%
2026-01-17 15:35:22 | REJECTED_DIRECTION | SWING_DETECTOR | ETHUSDT | Sell | SWING_HIGH (SHORT) | $3200.50 | 80.0%
2026-01-17 15:40:00 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95100.00 | N/A
```

## Calculo de Velas por Dias

```python
def calculate_candles_for_days(interval: str, days: int) -> int:
    interval_minutes = {
        "1": 1, "3": 3, "5": 5, "15": 15, "30": 30,
        "60": 60, "120": 120, "240": 240, "360": 360, "720": 720,
        "D": 1440, "W": 10080,
    }
    minutes_per_candle = interval_minutes.get(interval, 1)
    return (days * 24 * 60) // minutes_per_candle

# Ejemplos:
# 1 dia en 1m = 1440 velas
# 1 dia en 5m = 288 velas
# 7 dias en 1h = 168 velas
```

## Panel de Settings (Frontend)

El panel SwingDetectorSettings.jsx permite configurar:

1. **Historical Days**: Slider 1-30 dias (muestra calculo de velas)
2. **Direction Filter**: BOTH / LONG / SHORT
3. **Swing Bars**: Slider 2-10 (sensibilidad del detector)
4. **Alert Cooldown**: Slider 1-120 minutos
5. **Volume Filter**:
   - Toggle enabled/disabled
   - Min Z-Score: 0-4 (0 = sin filtro)
   - Lookback Bars: 10-100
6. **Price Zones**: Lista con botones para agregar/eliminar
7. **Arrow Style**: Tamano, colores, mostrar z-score
8. **Acciones**: Re-analyze History, Clear Cooldowns, Refresh

## Integracion con Trading Bot

El Trading Bot (`3.TradingBot_Python/backend/main.py`) detecta automaticamente el formato SWING_DETECTOR:

```python
@app.post("/api/watchlist-alert")
async def process_watchlist_alert(request: Dict[str, Any]):
    source = request.get("source", "WATCHLIST")

    if source == "SWING_DETECTOR":
        # Extrae datos del objeto pattern anidado
        pattern_data = request.get("pattern", {})
        direction = pattern_data.get("direction", "").upper()
        side = "Buy" if direction == "LONG" else "Sell"
    else:
        # Formato original de Watchlist
        ...
```

### Fuentes de Alertas (Sources)

El Trading Bot reconoce diferentes sources de alertas:

| Source | Origen | Formato |
|--------|--------|---------|
| `SWING_DETECTOR` | `swing_service.py` | `{source, symbol, interval, pattern: {direction, ...}}` |
| `backend_realtime` | `realtime_pattern_service.py` | Formato Watchlist original |
| `WATCHLIST` (default) | Cualquier otro | Si no se especifica source |

**Nota:** Alertas con `source: 'backend_realtime'` (Double Top/Bottom, Rejection Patterns)
aparecen en logs como "WATCHLIST" porque el Trading Bot usa ese valor como default.

## Expansion a 12 Simbolos (22 Enero 2026)

El Swing Detector fue expandido para soportar los 12 simbolos configurados en el Trading Bot.

### Simbolos Soportados

```python
symbols = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT",
    "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT",
    "LINKUSDT", "TRXUSDT", "NEARUSDT", "GALAUSDT"
]
```

### Problema: Limite de WebSocket Bybit

**Sintoma:** Solo BTCUSDT y ETHUSDT generaban senales, los demas simbolos no.

**Causa:** Bybit WebSocket tiene un limite de **10 argumentos por mensaje de suscripcion**.
El codigo original enviaba todas las suscripciones en un solo mensaje, lo cual fallaba silenciosamente.

**Fix en `websocket_manager.py`:**
```python
# Subscribe to all channels (Bybit limits to 10 args per subscribe message)
if self.subscriptions:
    subs_list = list(self.subscriptions)
    batch_size = 10  # Bybit WebSocket limit per subscribe request
    total_batches = (len(subs_list) + batch_size - 1) // batch_size

    for i in range(0, len(subs_list), batch_size):
        batch = subs_list[i:i + batch_size]
        subscribe_msg = {"op": "subscribe", "args": batch}
        await self.ws.send(json.dumps(subscribe_msg))
        logger.info(f"[WS] Subscribed batch {i//batch_size + 1}/{total_batches}: {len(batch)} channels")
        await asyncio.sleep(0.1)  # Small delay between batches
```

### Problema: Buffers Vacios al Iniciar

**Sintoma:** Despues del fix de batching, los buffers solo tenian 4-5 velas (insuficiente para deteccion).

**Causa:** El Swing Service cargaba velas historicas de la API pero no las preloadeaba al buffer del WebSocket.

**Fix en `swing_service.py`:**
```python
# If not enough candles, load more from Bybit API
if len(candles) < desired_candles:
    logger.info(f"[SWING_SERVICE] {symbol}: Loading extended history from API...")
    candles = await self._fetch_historical_candles(symbol, desired_candles)

    # IMPORTANT: Preload fetched candles to WebSocket buffer
    if candles:
        self.ws_manager.preload_historical(symbol, self.config.interval, candles)
        logger.info(f"[SWING_SERVICE] {symbol}: Preloaded {len(candles)} candles to WebSocket buffer")
```

### Endpoint de Debug

Se agrego endpoint para verificar estado del WebSocket:

```python
@app.get("/api/ws/debug")
async def get_websocket_debug():
    return {
        "connected": ws_manager.is_connected(),
        "running": ws_manager.is_running(),
        "subscriptions_count": len(ws_manager.subscriptions),
        "subscriptions": list(ws_manager.subscriptions),
        "subscribed_symbols": list(ws_manager._subscribed_symbols),
        "subscribed_intervals": list(ws_manager._subscribed_intervals),
        "callbacks_count": len(ws_manager._candle_close_listeners),
        "buffers": {
            symbol: {
                interval: len(candles)
                for interval, candles in intervals.items()
            }
            for symbol, intervals in ws_manager._candle_buffers.items()
        }
    }
```

### Verificacion Post-Fix

```bash
# Verificar suscripciones
curl http://localhost:10000/api/ws/debug

# Respuesta esperada:
{
  "subscriptions_count": 24,  # 12 simbolos x 2 intervalos
  "subscribed_symbols": ["BTCUSDT", "ETHUSDT", ...],  # 12 simbolos
  "buffers": {
    "BTCUSDT": {"1": 500, "60": 168},
    "ETHUSDT": {"1": 500, "60": 168},
    ...
  }
}
```

### Configuracion de Alertas (Enero 2026)

Para evitar alertas de indicadores no deseados, se desactivaron las alertas de:

- **Double Top/Bottom**: `alertsEnabled: false` en `realtime_configs.json`
- **Rejection Patterns**: `alertsEnabled: false` en `realtime_configs.json`

**Solo el Swing Detector envia alertas al Trading Bot.**

Los indicadores siguen funcionando para visualizacion, pero no generan alertas.

---

## Resultados de Pruebas (17 Enero 2026)

Sistema probado durante ~3 horas con resultados exitosos:

### Metricas de la Sesion de Prueba
```
Periodo: 15:42 - 18:59 (3+ horas)
Simbolos: BTCUSDT, ETHUSDT
Timeframe: 1 minuto
swingBars: 5

Alertas enviadas: ~30
Alertas duplicadas: 0
Alertas del historico: 0 (despues del fix)
Tasa de exito de envio: 100%
```

### Log de Ejemplo (Funcionamiento Correcto)
```
# Watchlist Backend (swing_alerts.log)
2026-01-17 18:18:00 | INFO | SIGNAL_DETECTED | BTCUSDT | SWING_LOW | price=95113.60 | direction=LONG
2026-01-17 18:18:00 | INFO | SIGNAL_DETECTED | ETHUSDT | SWING_LOW | price=3305.07 | direction=LONG
2026-01-17 18:18:02 | INFO | ALERT_SENT | BTCUSDT | SWING_LOW | price=95113.60 | direction=LONG
2026-01-17 18:18:03 | INFO | ALERT_SENT | ETHUSDT | SWING_LOW | price=3305.07 | direction=LONG

# Trading Bot (alerts_received.log)
2026-01-17 18:18:02 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95113.60
2026-01-17 18:18:03 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | ETHUSDT | Buy | SWING_LOW (LONG) | $3305.07
```

### Comportamiento Observado
- **1 senal por vela confirmada**: Maximo 1-2 senales por cierre de vela (una por simbolo)
- **Frecuencia**: ~1 alerta cada 2-5 minutos dependiendo de volatilidad
- **Latencia**: ~2-3 segundos desde deteccion hasta recepcion en Trading Bot
- **Sin spam**: Eliminado el problema de 20+ senales por segundo del historico

### Problemas Resueltos Durante Desarrollo

1. **Alertas del historico inundando el sistema**
   - Problema: Al iniciar, enviaba cientos de alertas de swings historicos
   - Solucion: Separar `_store_signal()` (historico) de `_process_signal()` (tiempo real)

2. **Multiples senales por cierre de vela**
   - Problema: Filtraba por "ultimas N velas" pero aun habia multiples swings
   - Solucion: Filtrar por timestamp EXACTO de la vela recien confirmada `[-(swingBars+1)]`

3. **Cooldown bloqueaba ambas direcciones**
   - Problema: Un LONG bloqueaba el siguiente SHORT del mismo simbolo
   - Solucion: Cooldown key = `{symbol}_{direction}` (ej: BTCUSDT_LONG, BTCUSDT_SHORT)

4. **WebSocket callbacks sobrescritos**
   - Problema: SwingService y RealtimePatternService competian por el mismo callback
   - Solucion: WebSocketManager ahora soporta multiples listeners con `add_candle_close_listener()`

5. **Ordenamiento de rutas en FastAPI (Enero 2026)**
   - Problema: La ruta `/api/swing/config/{symbol}` se definia ANTES de `/api/swing/config/apply-to-all`
   - FastAPI matchea rutas en orden de definicion
   - El path "apply-to-all" se interpretaba como un `{symbol}`, creando entrada corrupta en config
   - Solucion: Definir rutas especificas ANTES de rutas con parametros variables
   ```python
   # CORRECTO - ruta especifica primero
   @app.post("/api/swing/config/apply-to-all")  # Esta primero
   @app.post("/api/swing/config/{symbol}")       # Esta despues

   # INCORRECTO - la ruta con {symbol} captura "apply-to-all"
   @app.post("/api/swing/config/{symbol}")       # Captura todo
   @app.post("/api/swing/config/apply-to-all")   # Nunca se alcanza
   ```

## Troubleshooting

**No se ven flechas en el grafico:**
- Verificar que el indicador esta habilitado en Watchlist y en su modal
- Verificar que el backend tiene senales: GET /api/swing/signals/{symbol}
- Revisar consola del frontend por errores de fetch

**Muchas alertas repetidas:**
- El filtro de timestamp exacto debe estar activo
- Solo se procesa la senal de la vela en posicion `-(swingBars+1)`
- Cooldowns separan LONG y SHORT independientemente

**Alertas no llegan al Trading Bot:**
- Verificar que Trading Bot esta corriendo en puerto 5000
- Revisar `backend/logs/swing_alerts.log` para errores TIMEOUT
- Verificar direccion del simbolo no es DISABLED en Trading Bot

**Volume Z-Score siempre 0:**
- Verificar que volumeFilter.enabled = true
- Aumentar lookbackBars si hay pocas velas en el buffer

**SKIPPED_POSITION_EXISTS en todas las alertas:**
- Comportamiento esperado si ya tienes posiciones abiertas
- El bot solo ejecuta si no hay posicion existente en ese simbolo

**Solo algunos simbolos generan senales (ej: solo BTC/ETH):**
- Verificar suscripciones WebSocket: GET /api/ws/debug
- Bybit limita a 10 suscripciones por mensaje
- El fix en `websocket_manager.py` divide en batches de 10
- Verificar que todos los simbolos aparecen en `subscribed_symbols`

**Buffers con pocas velas al iniciar:**
- El Swing Service debe preloadear velas al buffer del WebSocket
- Verificar que `ws_manager.preload_historical()` se llama en `_analyze_historical()`
- Cada simbolo debe tener 500+ velas en buffer para interval "1"

**Alertas "WATCHLIST" aparecen sin tener la Watchlist corriendo:**
- Estas alertas vienen de `realtime_pattern_service` (Double Top/Bottom, Rejection Patterns)
- El Trading Bot usa "WATCHLIST" como source por defecto
- Para desactivar: poner `alertsEnabled: false` en `realtime_configs.json`

## Price Zones con Time-Bound (Enero 2026)

El Swing Detector ahora soporta zonas de precio con limite temporal derivadas de rectangulos dibujados en el grafico.

### Funcionalidad

1. **Zonas desde rectangulos del chart**: El usuario puede dibujar un rectangulo en el grafico y usarlo como zona de precio para validar senales
2. **Opcion Time-Bound**: Si se activa, la zona solo es valida dentro del rango temporal del rectangulo
3. **Re-analisis automatico**: Al agregar o eliminar una zona, las senales se recalculan automaticamente
4. **Zonas independientes por simbolo**: Cada zona tiene campo `symbol` y solo aplica a ese par

### Estructura de una Zona con Time-Bound

```json
{
  "id": "zone_rect_rectangle_123456_0.123",
  "symbol": "BTCUSDT",
  "min": 94860.96,
  "max": 95165.22,
  "direction": "LONG",
  "enabled": true,
  "sourceRectId": "rectangle_123456_0.123",
  "label": "Zone",
  "timeStart": 1768742160000,
  "timeEnd": 1768747080000,
  "timeBound": true
}
```

### Flujo de Uso

1. Usuario dibuja rectangulo en el chart (herramienta de dibujo)
2. Abre modal Swing Detector Settings → seccion "Price Zones"
3. Click en "📐 From Chart" para ver rectangulos disponibles
4. Activa checkbox "⏱️ Time-bound" si quiere limite temporal
5. Selecciona direccion: LONG / BOTH / SHORT
6. La zona se agrega y las senales se re-analizan automaticamente
7. Solo senales dentro del rango de precio Y tiempo (si time-bound) se muestran

### Sistema de Prioridad de Zonas Anidadas

Los rectangulos (time-bound) tienen **prioridad absoluta** sobre las zonas manuales cuando estan activos.

```
Ejemplo:
- Zona manual: $90,000 - $100,000, direction="BOTH"
- Rectangulo: $95,000 - $97,000, direction="LONG", timeStart=T1, timeEnd=T2

Escenarios:
1. Precio=$96,000, tiempo dentro de T1-T2:
   → Rectangulo ACTIVO, solo senales LONG permitidas

2. Precio=$96,000, tiempo fuera de T1-T2:
   → Rectangulo VENCIDO, cae a zona manual, senales BOTH permitidas

3. Precio=$94,000 (fuera del rectangulo), tiempo dentro de T1-T2:
   → Cae a zona manual, senales BOTH permitidas

4. Precio=$96,000, tiempo dentro, senal SHORT:
   → Rectangulo BLOQUEA la senal (no cae a zona manual)
```

### Logica de Validacion (Backend)

```python
# En swing_detector.py - _check_price_zones()

# 1. Separar zonas
time_bound_zones = [z for z in zones if z.get('timeBound')]
manual_zones = [z for z in zones if not z.get('timeBound')]

# 2. PRIORIDAD 1: Rectangulos activos
for zone in time_bound_zones:
    if price in zone AND timestamp in zone:
        if direction matches:
            return zone  # MATCH con rectangulo
        else:
            return None  # BLOQUEA (no cae a manual)

# 3. PRIORIDAD 2: Zonas manuales (solo si ningun rectangulo activo)
for zone in manual_zones:
    if price in zone AND direction matches:
        return zone  # MATCH con zona manual
```

### UI del Modal

- **Boton "📐 From Chart (N)"**: Muestra cantidad de rectangulos disponibles
- **Lista de rectangulos**: Muestra label, rango de precios, y estado
- **Checkbox "⏱️ Time-bound"**: Activa/desactiva limite temporal por rectangulo
- **Botones LONG/BOTH/SHORT**: Agregan la zona con la direccion seleccionada
- **Lista de zonas activas**: Muestra badges de estado (ACTIVE/EXPIRED/PENDING) para zonas time-bound

### Re-analisis Automatico

Los endpoints de zonas ahora llaman a `reanalyze_historical()` automaticamente:

```python
# POST /api/swing/add-zone
swing_service.config.priceZones.append(data)
swing_service._save_config()
await swing_service.reanalyze_historical()  # RE-ANALIZA

# DELETE /api/swing/zone/{zone_id}
swing_service.config.priceZones = [z for z in zones if z.id != zone_id]
swing_service._save_config()
await swing_service.reanalyze_historical()  # RE-ANALIZA
```

---

## Configuracion por Simbolo (Enero 2026)

El Swing Detector ahora soporta configuraciones independientes por simbolo.

### Estructura de Config

```json
{
  "enabled": true,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "interval": "1",
  "days": 1,
  "symbolConfigs": {
    "BTCUSDT": {
      "direction": "LONG",
      "swingBars": 3,
      "volumeFilter": {"enabled": true, "minZScore": 2.0}
    },
    "ETHUSDT": {
      "direction": "SHORT",
      "swingBars": 5
    }
  },
  "swingBars": 5,
  "direction": "BOTH",
  "priceZones": [],
  "volumeFilter": {...}
}
```

### Como Funciona

1. **Defaults globales**: `swingBars`, `direction`, `volumeFilter` aplican a todos los simbolos
2. **Override por simbolo**: `symbolConfigs[symbol]` sobreescribe los defaults
3. **Merge automatico**: `config.get_symbol_config(symbol)` fusiona defaults + especificos

### Endpoints

```
GET /api/swing/status?symbol=BTCUSDT
  → Incluye `symbolConfig` con config fusionada para ese simbolo

POST /api/swing/config/{symbol}
  Body: {"direction": "LONG", "swingBars": 3}
  → Actualiza config especifica del simbolo y re-analiza
```

### Frontend

El modal SwingDetectorSettings:
- Obtiene status con `?symbol=currentSymbol`
- Guarda config via `POST /api/swing/config/${currentSymbol}`
- Muestra valores fusionados (symbolConfig > defaults)

---

# VWAP INDICATOR (Backend-Native - Enero 2026)

El indicador VWAP fue migrado a arquitectura backend-native (igual que SwingDetector).

## Arquitectura

- **Backend**: `vwap_service.py` - Calcula VWAP, bandas de desviacion, y volatilidad
- **Frontend**: `VWAPIndicator.js` - Solo renderiza datos del backend

## Endpoint Principal

```
GET /api/vwap-service/data/{symbol}?days=1&interval=60&vwapType=session&rollingPeriod=20
```

**Parametros:**
- `days`: Dias de historico (1-360 segun timeframe)
- `interval`: Timeframe ("1", "5", "15", "60", etc)
- `vwapType`: "session" (reset diario) o "rolling" (ventana movil)
- `rollingPeriod`: Periodo para rolling VWAP

## Sincronizacion con Chart

El frontend pasa `days` e `interval` del chart al backend:

```javascript
// VWAPIndicator.js
const params = new URLSearchParams({
  days: this.days,
  interval: this.interval,
  vwapType: this.vwapType,
  rollingPeriod: this.rollingPeriod
});
const url = `${API_BASE_URL}/api/vwap-service/data/${this.symbol}?${params}`;
```

## Indicadores de Volatilidad

El VWAP incluye barras horizontales de volatilidad:
- **BandWidth**: Ancho de bandas Bollinger (%)
- **BBWP**: Bollinger Band Width Percentile (0-100)
- **TTM Squeeze**: Indica compresion de volatilidad

Estos se calculan SIEMPRE en el backend (aunque no se muestren) para disponibilidad inmediata.

## Lifecycle y Cleanup

Para evitar race conditions cuando cambia el timeframe:

```javascript
// VWAPIndicator.js
constructor() {
  this._destroyed = false;
}

destroy() {
  this._destroyed = true;  // Previene fetch despues de unmount
}

async fetchData() {
  if (this._destroyed) return false;  // Skip si destruido
  // ... fetch ...
  if (this._destroyed) return false;  // Check despues de await
}
```

---

# LECCIONES APRENDIDAS (Enero 2026)

## Performance - Carga de Datos Historicos

### Problema
La carga de muchos dias de datos en timeframes pequenos causa lentitud extrema:
- 30 dias en 1m = 43,200 velas = ~5 minutos de carga

### Solucion
1. **Defaults conservadores**: `days=1` por defecto en configs
2. **Inicializacion no-bloqueante**: `asyncio.create_task(self._background_init())`
3. **Limites por timeframe**: 1m max 5 dias, 1h max 360 dias

### Archivos Criticos a Verificar
- `swing_config.json`: `days` debe ser bajo para 1m
- `vwap_service.py`: `historyDays` default
- `Watchlist.jsx`: `useState("1")` para days

## Race Conditions en Indicadores

### Problema
Cuando el usuario cambia timeframe rapidamente, solicitudes HTTP del timeframe anterior interfieren.

### Solucion
1. **Flag `_destroyed`**: Cada indicador tiene flag de lifecycle
2. **Verificacion post-await**: Despues de cada `await fetch()`, verificar si aun es valido
3. **IndicatorManager.destroy()**: Llama `destroy()` en todos los indicadores

```javascript
// IndicatorManager.js
destroy() {
  this.indicators.forEach(indicator => {
    if (indicator.destroy) indicator.destroy();
  });
}
```

## Singleton con Config Global (Anti-pattern)

### Problema
VWAPService singleton modificaba config global durante solicitudes concurrentes.

### Solucion
Metodo separado que acepta parametros explicitos sin modificar estado global:

```python
async def _fetch_historical_candles_with_params(self, symbol, days, interval):
    # Usa parametros locales, no modifica self.config durante fetch
```

## Zonas No Se Actualizan

### Problema
Al agregar/eliminar zonas de precio, las senales viejas permanecian.

### Solucion
Llamar `reanalyze_historical()` automaticamente en endpoints de zonas:

```python
@app.post("/api/swing/add-zone")
async def add_swing_zone(request):
    swing_service.config.priceZones.append(data)
    swing_service._save_config()
    await swing_service.reanalyze_historical()  # CRITICO
```

## Indicadores Deshabilitados que Consumen Recursos

### Problema
DTB y Rejection Patterns se creaban aunque estaban deshabilitados.

### Solucion
Solo crear si explicitamente habilitados:

```javascript
// IndicatorManager.js
if (indicatorStates['Rejection Patterns'] === true) {
  this.indicators.push(new RejectionPatternIndicator(...));
}
```

---

# APP 4: ANALIZADOR CRIPTO (Single Symbol)

**Ubicacion:** `4.Analizador cripto/`

Aplicacion optimizada para analizar un solo simbolo a la vez con maxima fluidez y rendimiento.

## Estructura

```
4.Analizador cripto/
├── backend/
│   ├── main.py                    # Servidor FastAPI (puerto 10000)
│   ├── swing_service.py           # Detector de Swing H/L
│   ├── vwap_service.py            # Servicio VWAP backend-native
│   ├── config/                    # Configuraciones persistentes
│   ├── cache/                     # Cache de datos
│   └── logs/                      # Logs de alertas
│
├── frontend/
│   ├── src/components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz
│   │   ├── MiniChart.jsx             # Grafico principal
│   │   ├── SymbolList.jsx            # Lista lateral con prefetch
│   │   └── indicators/
│   │       ├── IndicatorManager.js   # Orquestador optimizado
│   │       ├── VWAPIndicator.js      # VWAP backend-native
│   │       └── SwingDetectorIndicator.js
│   ├── src/utils/
│   │   ├── CandleCache.js            # Cache IndexedDB con LRU
│   │   └── IndicatorCache.js         # Cache para indicadores
│   └── 1_START.bat                   # Inicio automatico
```

## Comandos

```bash
# Inicio rapido (Windows)
cd 4.Analizador cripto
1_START.bat

# Manual - Backend
cd backend
start_backend.bat  # Puerto 10000

# Manual - Frontend
cd frontend
npm run dev  # Puerto 10001
```

## Diferencias con App 2 (Watchlist)

| Caracteristica | App 2 (Watchlist) | App 4 (Analizador) |
|----------------|-------------------|---------------------|
| Simbolos simultaneos | Multiples | Uno solo |
| Puerto backend | 8000 | 10000 |
| Puerto frontend | 5173 | 10001 |
| Enfoque | Monitoreo multiple | Analisis profundo |
| Optimizaciones | Standard | Agresivas |

## Optimizaciones de Rendimiento (Enero 2026)

### 1. Eliminacion de React StrictMode
- **Archivo:** `frontend/src/main.jsx`
- **Beneficio:** Evita doble montaje de componentes en desarrollo
- **Impacto:** Reduce tiempo de carga inicial ~50%

### 2. Carga de Indicadores en Paralelo
- **Archivo:** `frontend/src/components/indicators/IndicatorManager.js`
- **Implementacion:** `Promise.all()` para todos los fetches
- **Beneficio:** Los indicadores cargan simultaneamente, no secuencialmente

```javascript
// En refresh()
const fetchPromises = [];
this.indicators.forEach(indicator => {
  if (indicator.fetchData) {
    fetchPromises.push(indicator.fetchData());
  }
});
await Promise.all(fetchPromises);
```

### 3. Lazy Loading de Indicadores
- **Archivo:** `frontend/src/components/indicators/IndicatorManager.js`
- **Implementacion:** Solo crear indicadores cuando `indicatorStates[name] === true`
- **Beneficio:** Ahorra memoria y CPU al no instanciar indicadores deshabilitados

```javascript
// En initialize()
if (indicatorStates['VWAP'] === true) {
  this.indicators.push(new VWAPIndicator(...));
}
```

### 4. Polling Diferido
- **Archivos:** `VWAPIndicator.js`, `SwingDetectorIndicator.js`, `MiniChart.jsx`
- **Implementacion:** Polling NO inicia en `fetchData()`, sino despues de carga completa
- **Metodo:** `startPollingIfReady()` llamado desde `IndicatorManager.startAllPolling()`

```javascript
// En MiniChart.jsx despues de refresh()
indicatorManagerRef.current.refresh().then(() => {
  indicatorManagerRef.current.startAllPolling();
  onChartLoaded();
});
```

### 5. Prefetch en Hover
- **Archivos:** `SymbolList.jsx`, `SingleSymbolAnalyzer.jsx`
- **Implementacion:** Precarga velas cuando el usuario hace hover sobre un simbolo
- **Debounce:** 300ms para evitar requests innecesarios
- **Cache:** Usa `CandleCache` (IndexedDB) para persistencia

```javascript
// Handler con debounce
const handleSymbolHover = (sym) => {
  prefetchTimeoutRef.current = setTimeout(() => {
    prefetchSymbolData(sym);  // Fetch y guarda en CandleCache
  }, 300);
};
```

### 6. Endpoint Batch para Indicadores
- **Archivo:** `backend/main.py`
- **Endpoint:** `POST /api/indicators/batch`
- **Beneficio:** Una sola llamada HTTP para multiples indicadores

```python
# Request
{
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 1,
  "indicators": ["vwap", "swing", "support_resistance"]
}

# Response incluye timing por indicador
{
  "success": true,
  "data": { "vwap": {...}, "swing": {...} },
  "timing": { "vwap": 120, "swing": 85, "total": 150 }
}
```

### Sistema de Cache (CandleCache.js)

```
┌─────────────────────────────────────────────────────────────┐
│                     CANDLE CACHE SYSTEM                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐    │
│  │   MEMORIA   │────▶│  IndexedDB  │────▶│   BACKEND   │    │
│  │   (LRU 4)   │     │ (Persistente)│     │   (Bybit)   │    │
│  └─────────────┘     └─────────────┘     └─────────────┘    │
│                                                              │
│  Prioridad: Memoria > IndexedDB > Backend                    │
│  TTL: 24 horas para velas cerradas                           │
│  LRU: Maximo 4 entradas en memoria                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Resultados de Optimizacion

| Metrica | Antes | Despues |
|---------|-------|---------|
| Tiempo carga inicial | ~15s | ~4-6s |
| Cambio de simbolo (sin cache) | ~15s | ~4-6s |
| Cambio de simbolo (con cache) | ~15s | <1s |
| Uso de memoria | Alto | Reducido (lazy loading) |
| Requests HTTP iniciales | Secuenciales | Paralelos |

---

## Trading Panel (Enero 2026)

Panel lateral integrado para enviar ordenes directamente a Bybit via el TradingBot backend.

### Archivos

| Archivo | Descripcion |
|---------|-------------|
| `frontend/src/components/trading/TradingPanel.jsx` | Panel principal con conexion al TradingBot |
| `frontend/src/components/trading/TradingPanel.css` | Estilos con sistema de temas dinamico |
| `frontend/src/components/trading/OrderForm.jsx` | Formulario de orden con modos de cantidad |
| `frontend/src/components/trading/PositionCard.jsx` | Muestra posicion activa con PnL |
| `frontend/src/components/trading/index.js` | Exports del modulo |

### Funcionalidades

1. **Integracion con TPSLBox**: Lee Entry, SL, TP desde rectangulos dibujados en el chart
2. **Dos modos de cantidad**:
   - **Monto fijo**: Especifica USDT directamente
   - **Por riesgo**: Calcula cantidad basado en riesgo y % de SL
3. **Conexion al TradingBot**: Se conecta al backend en puerto 5000
4. **Visualizacion de posicion**: Muestra posicion activa con PnL en tiempo real
5. **Temas personalizables**: Selector de color (hue) + modo claro/oscuro

### Shortcut

- **Alt+T**: Abre/cierra el Trading Panel
- El panel tambien tiene boton en el header del chart

### Flujo de Orden

```
1. Usuario dibuja TPSLBox en el chart (Entry, SL, TP)
2. Presiona Alt+T para abrir Trading Panel
3. Panel carga datos de la caja automaticamente
4. Usuario selecciona modo de cantidad y confirma
5. Panel envia orden a TradingBot (puerto 5000)
6. TradingBot ejecuta: Market Order → SL → TP
7. Panel muestra posicion resultante
```

### Sistema de Temas

El panel usa CSS variables generadas dinamicamente basadas en un valor HSL (hue):

```javascript
// TradingPanel.jsx
const generateThemeColors = (hue, isDark = true) => {
  if (isDark) {
    return {
      bgPrimary: `hsl(${hue}, 15%, 12%)`,
      bgSecondary: `hsl(${hue}, 15%, 16%)`,
      // ... mas colores derivados
    };
  } else {
    // Modo claro con colores invertidos
  }
};
```

Controles en el header:
- **Slider de color**: 0-360 grados de hue
- **Boton sol/luna**: Alterna modo claro/oscuro

Persistencia en localStorage:
- `tradingPanelHue`: Valor del hue (0-360)
- `tradingPanelDarkMode`: "true" o "false"

### Conexion con TradingBot

El panel se comunica con el TradingBot backend:

```javascript
const TRADING_BOT_URL = 'http://localhost:5000';

// Verificar conexion
GET /api/status

// Cargar config del simbolo
GET /api/config  // Retorna { coins: [...] }

// Cargar posicion actual
GET /api/position/{symbol}

// Enviar orden
POST /api/trade/manual
{
  "symbol": "BTCUSDT",
  "side": "Buy",
  "quantity": 0.001,
  "stopLoss": 95000,
  "takeProfit": 100000
}
```

### Modificaciones al TradingBot

Para soportar ordenes desde el Analizador, se modifico:

**`3.TradingBot_Python/backend/main.py`:**
```python
class ManualTradeRequest(BaseModel):
    symbol: str
    side: str
    quantity: Optional[Decimal] = None
    current_price: Optional[Decimal] = None
    stopLoss: Optional[Decimal] = None      # NUEVO
    takeProfit: Optional[Decimal] = None    # NUEVO
```

**`3.TradingBot_Python/backend/trading/order_manager.py`:**
```python
# Usa SL/TP custom si se proporcionan
if config.get("custom_stop_loss"):
    sl_price = Decimal(str(config["custom_stop_loss"]))
else:
    sl_price = self._calculate_sl_price(real_price, side, sl_percent)
```

### Troubleshooting Trading Panel

**"Simbolo no configurado":**
- Verificar que el simbolo existe en `3.TradingBot_Python/config/trading_config.json`
- El panel busca en `data.coins` del endpoint `/api/config`

**"TradingBot no disponible":**
- Verificar que el backend del TradingBot esta corriendo en puerto 5000
- Comando: `cd 3.TradingBot_Python/backend && python main.py`

**Posicion no se muestra:**
- El endpoint `/api/position/{symbol}` devuelve datos directamente (no anidados)
- Campos: `hasPosition`, `size`, `side`, `entryPrice`, `unrealizedPnl`, `markPrice`

**Orden falla:**
- Revisar logs del TradingBot
- Verificar credenciales Bybit configuradas
- Verificar modo (Demo vs Live)

---

# TROUBLESHOOTING

**Backend no inicia:**
- Verificar Python 3.10+
- Verificar puerto no en uso (8000, 9000, 5000)
- Verificar .venv existe

**Frontend no carga graficos:**
- Verificar backend corriendo
- Revisar consola por errores CORS

**Alertas no llegan al Bot:**
- Verificar Bot corriendo en puerto 5000
- Verificar direccion del simbolo no es DISABLED

**Ordenes no se ejecutan:**
- Verificar credenciales Bybit
- Verificar modo (Demo vs Live)
- Revisar logs del Bot

**Datos desactualizados:**
- POST /api/clear-cache en backend correspondiente

**Modal VWAP opciones avanzadas no se expande:**
- Fix aplicado (Enero 2026): La condicion `showAdvanced && showBands && bandMultipliers` impedia mostrar contenido
- Solucion: Separar condicion - `showAdvanced` para mostrar panel, `showBands && bandMultipliers` solo para multiplicadores
- Archivo: `4.Analizador cripto/frontend/src/components/VWAPSettings.jsx`
- CSS: Aumentar `max-height` de 70vh a 85vh en `VWAPSettings.css`

**Carga muy lenta de graficos:**
- Reducir `days` en swing_config.json
- Verificar que no hay requests de 30+ dias en timeframe 1m
- Revisar logs del backend para ver cuantas velas se cargan

**VWAP no se actualiza al cambiar timeframe:**
- El indicador debe tener metodo `setInterval()`
- IndicatorManager.refresh() debe actualizar interval del VWAP

**Zonas de precio no filtran senales:**
- Reiniciar backend para cargar nueva config
- Verificar que `timeBound`, `timeStart`, `timeEnd` estan correctos
- Las zonas nuevas disparan re-analisis automatico

---

# ZONE DETECTOR 2.0 / STRATEGY TESTER (Enero 2026)

Sistema para detectar zonas de consolidación y crear estrategias de trading basadas en ellas.

**Plan completo:** Ver `1.Altagracia_Crypto_Backtester/STRATEGY_TESTER_PLAN.md`

## Estado Actual

### Completado - Phase 1: Zone Detector
- **Zone Detector 2.0**: 4 métodos de detección (pivot_cluster, atr_based, volume_profile, price_action)
- **Zone Evaluator**: Métricas de calidad de zonas
- **Zone Optimizer**: Grid search y walk-forward
- **UI ZoneDetectorTester**: Modal con tabs Detectar/Evaluar/Comparar/Optimizar
- **Visualización**: Zonas se renderizan en el gráfico
- **Anti-bias**: Zonas se calculan solo con datos anteriores a fecha de playback

### Completado - Phase 2: Strategy Builder (Enero 2026)
- **Strategy Model** (`strategy_model.py`): Dataclasses para Strategy, EntryRules, Conditions, RiskManagement
- **Strategy Store** (`strategy_store.py`): Persistencia JSON con CRUD completo
- **Strategy Executor** (`strategy_executor.py`): Motor de backtesting con detección de zonas
- **StrategyBuilder.jsx**: UI completa con 4 secciones (Básico, Entrada, Riesgo, Filtros)
- **ConditionEditor.jsx**: Editor dinámico de condiciones de entrada
- **StrategyList.jsx**: Lista de estrategias con filtro, duplicar, eliminar
- **BacktestResults.jsx**: Visualización de resultados con métricas, trades y equity curve
- **Templates**: 3 estrategias predefinidas (range_bounce, breakout, aggressive_scalp)
- **Endpoints API**: CRUD + backtest + quick-backtest

### En Refinamiento
- **Zone Detector**: Las zonas detectadas son algorítmicamente correctas pero pueden no coincidir con las expectativas visuales del trader. Ajuste continuo de parámetros.

## Archivos del Sistema

### Backend (`1.Altagracia_Crypto_Backtester/Backtester/backend/`)

| Archivo | Descripción |
|---------|-------------|
| `zone_detector.py` | 4 métodos de detección de zonas |
| `zone_evaluator.py` | Evaluación de calidad de zonas |
| `zone_optimizer.py` | Optimización de parámetros |
| `strategy_model.py` | Dataclasses: Strategy, EntryRules, Conditions, RiskManagement |
| `strategy_store.py` | Persistencia JSON de estrategias (CRUD) |
| `strategy_executor.py` | Motor de backtesting con Trade, Signal, BacktestResult |
| `main.py` (líneas 2690-3100) | Endpoints API de zonas |
| `main.py` (líneas 3120-3490) | Endpoints API de estrategias |
| `strategies/` | Directorio con estrategias guardadas en JSON |

### Frontend (`1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/`)

| Archivo | Descripción |
|---------|-------------|
| `ZoneDetectorTester.jsx` | Modal de testing de zonas |
| `ZoneDetectorTester.css` | Estilos del modal |
| `indicators/ZoneVisualizerIndicator.js` | Renderiza zonas en el gráfico |
| `strategy/StrategyBuilder.jsx` | UI para crear/editar estrategias |
| `strategy/StrategyList.jsx` | Lista de estrategias guardadas |
| `strategy/ConditionEditor.jsx` | Editor de condiciones de entrada |
| `strategy/BacktestResults.jsx` | Visualización de resultados del backtest |
| `strategy/StrategyBuilder.css` | Estilos del Strategy Builder |
| `strategy/BacktestResults.css` | Estilos del panel de resultados |
| `strategy/index.js` | Exports del módulo strategy |

## Endpoints API

### Zone Detector

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/zones/methods` | GET | Lista métodos disponibles |
| `/api/zones/detect` | POST | Detecta zonas con método especificado |
| `/api/zones/evaluate` | POST | Evalúa calidad de zonas detectadas |
| `/api/zones/compare-methods` | POST | Compara todos los métodos |
| `/api/zones/optimize` | POST | Optimiza parámetros (grid search) |

### Strategy Builder

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/strategies` | GET | Lista todas las estrategias guardadas |
| `/api/strategies/templates` | GET | Lista templates disponibles |
| `/api/strategies/{id}` | GET | Obtiene una estrategia por ID |
| `/api/strategies` | POST | Crea nueva estrategia (o desde template) |
| `/api/strategies/{id}` | PUT | Actualiza estrategia existente |
| `/api/strategies/{id}` | DELETE | Elimina una estrategia |
| `/api/strategies/{id}/duplicate` | POST | Duplica una estrategia |
| `/api/strategies/validate` | POST | Valida sintaxis de estrategia |
| `/api/strategies/{id}/backtest` | POST | Ejecuta backtest de estrategia guardada |
| `/api/strategies/quick-backtest` | POST | Backtest sin guardar (inline strategy) |

### Parámetros Comunes

```json
{
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 365,
  "method": "pivot_cluster",
  "end_timestamp": 1704067200000,  // Opcional: fecha límite (playback)
  "params": {
    "max_price_range_pct": 5.0,
    "pivot_tolerance_pct": 0.3,
    "pivot_min_touches": 3
  }
}
```

## Métodos de Detección

| Método | Descripción | Mejor para |
|--------|-------------|------------|
| `pivot_cluster` | Agrupa pivots cercanos | Zonas de S/R tradicionales |
| `atr_based` | Detecta baja volatilidad | Consolidaciones/rangos |
| `volume_profile` | Identifica alto volumen | POC, VAH, VAL |
| `price_action` | Cuenta toques a niveles | Niveles psicológicos |

## Estructura de Estrategia

```python
Strategy:
  id: str
  name: str
  description: str
  zone_config:              # Config del detector de zonas
    method: str             # pivot_cluster, atr_based, etc
    params: dict            # Parámetros del método
  entry:
    trigger: str            # price_touches_zone, price_breaks_zone, etc
    direction: str          # LONG, SHORT, BOTH
    conditions: List[Condition]  # Condiciones adicionales
    require_all_conditions: bool
    confirmation_candles: int
  risk_management:
    sizing:
      method: str           # fixed_risk, fixed_amount, percent_equity
      risk_percent: float
    stop_loss:
      type: str             # below_zone, atr_multiple, fixed_percent
      buffer_percent: float
      use_trailing: bool
    take_profit:
      type: str             # risk_reward, opposite_zone, fixed_percent
      risk_reward_ratio: float
  filters:
    max_open_trades: int
    max_daily_trades: int
    min_time_between_trades: int  # minutos
    max_daily_loss_percent: float
    min_zone_score: int
```

## Flujo de Backtest

```
1. Frontend: StrategyBuilder → handleRunBacktest()
   ↓
2. POST /api/strategies/quick-backtest o /{id}/backtest
   Body: { symbol, strategy, current_time }
   ↓
3. Backend: Fetch candles históricos
   ↓
4. Zone Detector: Detectar zonas (usando zone_config de estrategia)
   ↓
5. Strategy Executor: Procesar velas una por una
   - Por cada vela:
     a) Actualizar zonas activas
     b) Gestionar trades abiertos (SL/TP)
     c) Verificar condiciones de entrada
     d) Ejecutar entrada si aplica
     e) Registrar equity
   ↓
6. Generar BacktestResult:
   - trades: Lista de trades ejecutados
   - signals: Señales de entrada/salida
   - metrics: win_rate, profit_factor, max_drawdown, etc
   - equity_curve: [{timestamp, equity}]
   ↓
7. Frontend: BacktestResults muestra resultados
```

## Integración con Playback

El parámetro `end_timestamp` evita survival bias:

```javascript
// ZoneDetectorTester.jsx
if (playbackStartTime) {
  requestBody.end_timestamp = playbackStartTime;
}
```

```python
# main.py - /api/zones/detect
if end_timestamp:
    candles = [c for c in candles if c['timestamp'] < end_timestamp]
```

## Troubleshooting

**Zonas no aparecen en el gráfico:**
- Verificar que ZoneVisualizerIndicator está habilitado
- Verificar que el callback `onZonesDetected` llama a `miniChart.setZones()`
- Revisar consola por errores de `priceToY`

**Zonas demasiado grandes:**
- Reducir `max_price_range_pct` (default 5%)
- Aumentar `pivot_min_touches` para zonas más validadas

**Detección no coincide con expectativas del trader:**
- El detector actual es algorítmico, puede no capturar contexto de mercado
- Considerar usar método `pivot_cluster` con parámetros más estrictos
- El refinamiento del detector es un trabajo en progreso

---

# DRAWING SYSTEM (MiniChart.jsx)

## Arquitectura de Dibujos

El sistema de dibujos tiene dos estados paralelos que deben mantenerse sincronizados:

1. **`drawingsRef`**: Array de shapes deserializados para renderizado readonly (fuera de modo dibujo)
2. **`DrawingToolManager`**: Instancia que gestiona shapes durante modo dibujo (edicion)

### Persistencia

Los dibujos se guardan en `backend/drawings/{symbol}.json` via:
```
POST /api/drawings/{symbol}
GET /api/drawings/{symbol}
```

### Flujo de Sincronizacion (Fix Enero 2026)

```
ENTRAR A MODO DIBUJO:
  1. Se crea DrawingToolManager (si no existe)
  2. loadDrawingsIntoManager() carga shapes desde servidor
  3. DrawingToolManager renderiza durante edicion

DURANTE MODO DIBUJO:
  - Cada cambio (crear, mover, eliminar) llama saveDrawingsInline()
  - saveDrawingsInline() sincroniza drawingsRef Y guarda al servidor

SALIR DE MODO DIBUJO:  ← FIX CRITICO
  1. useEffect detecta transicion drawingMode: true → false
  2. Sincroniza drawingsRef con shapes actuales del manager
  3. Guarda al servidor via saveDrawingsInline()
  4. Fuerza re-render con setDrawingsVersion()
```

### Problema Resuelto: Rectangulos Borrados Reaparecen

**Sintomas:**
- Rectangulos eliminados reaparecian al mover el mouse
- SwingDetectorSettings mostraba rectangulos que ya no existian
- Rectangulos usados como zona desaparecian pero reaparecian en modo dibujo

**Causa:**
Al salir del modo dibujo, los cambios en DrawingToolManager NO se guardaban al servidor.
El modal SwingDetectorSettings consultaba `/api/drawings/` que tenia datos desactualizados.

**Fix 1 - Guardar al salir** (MiniChart.jsx:343-356):
```javascript
// Detectar transicion de drawingMode: true -> false
const prevDrawingModeRef = useRef(drawingMode);
useEffect(() => {
  if (prevDrawingModeRef.current && !drawingMode) {
    if (drawingManagerRef.current) {
      // saveDrawingsInline() sincroniza drawingsRef, guarda al servidor y fuerza re-render
      saveDrawingsInline();
    }
  }
  prevDrawingModeRef.current = drawingMode;
}, [drawingMode]);
```

### Problema Resuelto: Dibujos Desaparecen en Modo Dibujo

**Sintomas:**
- Al entrar al modo dibujo por segunda vez, los shapes desaparecian
- TPSLBox y otros dibujos no se renderizaban al mover el mouse
- Al salir del modo dibujo, los shapes seguian sin aparecer

**Causa:**
El DrawingToolManager solo cargaba shapes del servidor la PRIMERA vez que se creaba.
En entradas subsecuentes al modo dibujo, el manager existia pero tenia shapes vacios/desactualizados.

**Fix 2 - Cargar siempre al entrar** (MiniChart.jsx:310-334):
```javascript
useEffect(() => {
  if (drawingMode && !externalDrawingManager) {
    if (!internalDrawingManagerRef.current) {
      // Primera vez: crear el manager
      internalDrawingManagerRef.current = new DrawingToolManager(...);
    }
    // 🔄 FIX: SIEMPRE cargar dibujos al entrar (no solo la primera vez)
    loadDrawingsIntoManager();
  }
}, [drawingMode, symbol, interval, externalDrawingManager]);
```

### Archivos Relacionados

| Archivo | Responsabilidad |
|---------|-----------------|
| `MiniChart.jsx` | Orquesta renderizado y sincronizacion |
| `DrawingToolManager.js` | Gestiona shapes durante edicion |
| `drawing/shapes/*.js` | Clases de cada tipo de shape |
| `backend/drawings/*.json` | Persistencia por simbolo |

### Troubleshooting Dibujos

**Rectangulos fantasma (despues del fix):**
- Limpiar localStorage y recargar pagina
- Verificar que `backend/drawings/{symbol}.json` tiene datos correctos
- El problema original fue resuelto guardando al salir del modo dibujo

**Dibujos no se guardan:**
- Verificar consola por errores en `saveDrawingsInline()`
- Verificar que backend esta corriendo y endpoint `/api/drawings/` responde

**Shapes se duplican:**
- Posible problema de doble renderizado
- Verificar que solo se usa drawingManagerRef.render() EN modo dibujo
- Fuera de modo dibujo, solo drawingsRef.current deberia renderizarse

**Dibujos desaparecen al entrar/salir del modo dibujo:**
- El fix actual (Enero 2026) resuelve esto cargando SIEMPRE al entrar y guardando al salir
- Si persiste: verificar que `loadDrawingsIntoManager()` se llama en cada entrada
- Revisar consola por errores de fetch en `/api/drawings/`

**Verificar optimizaciones de rendimiento (Enero 2026):**
- Consola: Buscar logs `[StorageManager]` y `[PollingScheduler]`
- StorageManager debe mostrar "Flushed N pending writes" cada 2 segundos
- PollingScheduler debe mostrar "Started" y callbacks registrados
- DevTools Performance: CPU debe bajar ~50% comparado con version anterior
- Network: Conexiones HTTP deben reutilizarse (ver Connection: keep-alive)

---

# APP 6: TRADING JOURNAL

**Ubicacion:** `6.Trading_Journal/`

Sistema de registro automatico de trades con analisis de rendimiento, screenshots y metricas avanzadas.

## Estructura

```
6.Trading_Journal/
├── backend/
│   ├── main.py                      # Servidor FastAPI (puerto 12000)
│   ├── requirements.txt             # Dependencias Python
│   ├── models/
│   │   └── journal_entry.py         # Modelos de datos (JournalEntry, etc.)
│   ├── store/
│   │   └── journal_store.py         # Persistencia SQLite
│   ├── api/
│   │   └── routes.py                # Endpoints REST
│   ├── services/
│   │   ├── position_monitor.py      # Monitor de posiciones (polling TradingBot)
│   │   ├── screenshot_service.py    # Capturas Playwright + mplfinance
│   │   └── metrics_service.py       # Calculos de metricas avanzadas
│   ├── data/                        # Base de datos SQLite
│   └── screenshots/                 # Screenshots capturados
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Componente raiz con navegacion
│   │   ├── components/
│   │   │   ├── Dashboard.jsx        # Resumen y metricas principales
│   │   │   ├── TradeList.jsx        # Lista de trades con filtros
│   │   │   ├── TradeDetail.jsx      # Detalle con screenshots y reflexion
│   │   │   └── Settings.jsx         # Configuracion del monitor
│   │   └── styles/                  # CSS
│   ├── package.json
│   └── vite.config.js
│
└── 1_START.bat                      # Inicio automatico
```

## Comandos

```bash
# Inicio rapido (Windows)
cd 6.Trading_Journal
1_START.bat

# Manual - Backend
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python main.py  # Puerto 12000

# Manual - Frontend
cd frontend
npm install
npm run dev  # Puerto 12001
```

## Funcionalidades

- **Registro automatico** de trades desde TradingBot
- **Screenshots** automaticos al abrir/cerrar posiciones
- **Metricas avanzadas**: Win rate, Profit Factor, Sharpe, Sortino, Max Drawdown
- **R-Multiple** calculado automaticamente
- **Reflexiones** y lecciones aprendidas por trade
- **Analisis por**: periodo, simbolo, fuente, direccion, dia, hora
- **Curva de equity** visualizada
- **Export/Import** JSON para backup

## Modelos de Datos

### JournalEntry

```python
@dataclass
class JournalEntry:
    id: str                      # UUID unico
    symbol: str                  # Ej: BTCUSDT
    direction: TradeDirection    # LONG o SHORT
    status: TradeStatus          # OPEN, CLOSED, CANCELLED
    source: TradeSource          # watchlist, analizador, manual, etc.
    entry_time: str              # ISO datetime
    exit_time: Optional[str]
    entry_price: float
    exit_price: Optional[float]
    quantity: Optional[float]
    pnl_usd: float               # Ganancia/perdida en USD
    pnl_percent: float           # Porcentaje
    r_multiple: float            # Multiplo de riesgo
    screenshot_entry: Optional[str]
    screenshot_exit: Optional[str]
    market_context: MarketContext
    setup: TradeSetup
    execution: ExecutionQuality
    reflection: TradeReflection
```

### TradeSource (Enum)

| Valor | Descripcion |
|-------|-------------|
| `watchlist` | Alerta desde Watchlist (App 2) |
| `analizador` | Alerta desde Analizador (App 4) |
| `order_flow` | Alerta desde Order Flow (App 5) |
| `backtester` | Trade desde Backtester (App 1) |
| `manual` | Trade ejecutado manualmente |

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/entries` | GET | Lista todos los trades |
| `/api/entries` | POST | Crear nuevo trade |
| `/api/entries/{id}` | GET | Obtener trade por ID |
| `/api/entries/{id}` | PUT | Actualizar trade |
| `/api/entries/{id}` | DELETE | Eliminar trade |
| `/api/entries/statistics` | GET | Estadisticas generales |
| `/api/entries/export` | GET | Exportar todos los trades |
| `/api/entries/import` | POST | Importar trades desde JSON |
| `/api/metrics/summary` | GET | Metricas avanzadas |
| `/api/metrics/equity-curve` | GET | Datos para curva de equity |
| `/api/metrics/by-symbol` | GET | Analisis por simbolo |
| `/api/metrics/by-source` | GET | Analisis por fuente |
| `/api/monitor/status` | GET | Estado del monitor |
| `/api/monitor/start` | POST | Iniciar monitor |
| `/api/monitor/stop` | POST | Detener monitor |
| `/api/screenshots/{path}` | GET | Servir screenshot |

## Arquitectura de Servicios

### Position Monitor

El monitor hace polling al TradingBot cada 5 segundos:

```
┌─────────────────────────────────────────────────────────────┐
│                    POSITION MONITOR                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────────┐                    │
│  │ TRADING BOT │────▶│ GET /api/positions                   │
│  │  (5000)     │     │ GET /api/alerts/recent               │
│  └─────────────┘     └─────────────────┘                    │
│         │                     │                              │
│         │                     ▼                              │
│         │            ┌─────────────────┐                    │
│         │            │ Detectar cambios│                    │
│         │            │ - Nueva posicion│                    │
│         │            │ - Posicion cerrada                   │
│         │            └────────┬────────┘                    │
│         │                     │                              │
│         │    ┌────────────────┼────────────────┐            │
│         │    │                │                │            │
│         ▼    ▼                ▼                ▼            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Match Alert │    │Create Entry │    │Close Entry  │     │
│  │ → Source    │    │+ Screenshot │    │+ Screenshot │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Screenshot Service

Sistema hibrido con dos metodos:

1. **Playwright (primario)**: Captura del chart real del Analizador/Watchlist
2. **mplfinance (fallback)**: Genera chart estatico si Playwright falla

```python
# Ruta de screenshots
screenshots/{symbol}/{entry_id}_{event}_{timestamp}.png

# Ejemplo
screenshots/BTCUSDT/abc123_entry_20260128_153000.png
```

### Metrics Service

Calcula metricas avanzadas:

```python
@dataclass
class MetricsSummary:
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    profit_factor: float
    avg_r: float
    total_r: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    avg_winner: float
    avg_loser: float
    best_trade: float
    worst_trade: float
    expectancy: float
```

## Integracion con TradingBot

El Journal se integra con el TradingBot mediante endpoints agregados:

### Endpoints agregados al TradingBot (puerto 5000)

```python
# GET /api/positions
# Retorna todas las posiciones abiertas
{
    "BTCUSDT": {
        "hasPosition": true,
        "size": 0.001,
        "side": "Buy",
        "entryPrice": 95000.0,
        "unrealizedPnl": 50.25
    },
    ...
}

# GET /api/alerts/recent?minutes=30
# Retorna alertas recientes para matching de source
[
    {
        "timestamp": "2026-01-28T15:30:00",
        "symbol": "BTCUSDT",
        "source": "SWING_DETECTOR",
        "direction": "LONG"
    },
    ...
]

# GET /api/position-history/{symbol}?limit=10
# Retorna historial de posiciones cerradas
```

## Flujo Completo

```
1. Usuario ejecuta trade via TradingBot (manual o alerta)
      ↓
2. Position Monitor detecta nueva posicion
      ↓
3. Match con alerta reciente → determina source
      ↓
4. Crea JournalEntry con estado OPEN
      ↓
5. Screenshot Service captura chart de entrada
      ↓
6. ... tiempo pasa ...
      ↓
7. Position Monitor detecta posicion cerrada
      ↓
8. Actualiza JournalEntry: exit_price, pnl, status=CLOSED
      ↓
9. Screenshot Service captura chart de salida
      ↓
10. Calcular R-multiple si hay SL definido
      ↓
11. Metrics Service recalcula estadisticas
```

## Frontend Components

### Dashboard
- Cards de metricas principales (Total P&L, Win Rate, Profit Factor, etc.)
- Curva de equity (SVG chart)
- Gauge de win rate
- Lista de trades recientes

### TradeList
- Tabla con todos los trades
- Filtros: estado, simbolo, direccion, fuente
- Ordenamiento por columnas
- Click para ver detalle

### TradeDetail
- Resumen de P&L (USD, %, R)
- Screenshots de entrada y salida
- Detalles del trade (precios, tiempos)
- Seccion de reflexion editable
- Calidad del setup (slider 1-10)
- Emociones antes/despues
- Notas y lecciones

### Settings
- Control del monitor (start/stop)
- Estado de conexiones
- Export/Import de datos
- Limpieza de screenshots

## Troubleshooting

**Monitor no detecta posiciones:**
- Verificar que TradingBot esta corriendo en puerto 5000
- Verificar endpoint `/api/positions` responde
- Revisar logs del backend Journal

**Screenshots no se capturan:**
- Verificar que Analizador o Watchlist esta abierto
- Playwright puede fallar si el browser no esta disponible
- El fallback mplfinance genera charts estaticos

**Source siempre es "manual":**
- El matching requiere alerta reciente (30 min window)
- Verificar que el sistema de alertas esta funcionando
- Revisar `/api/alerts/recent` en TradingBot

**Metricas no se actualizan:**
- Las metricas se recalculan al consultar
- Verificar que hay trades cerrados (no solo abiertos)

---

# APP 8: ANALIZADOR DESKTOP (Electron)

**Ubicacion:** `8.AnalizadorDesktop/`

Version de escritorio del Analizador Cripto (App 4) empaquetada con Electron. Resuelve el problema de throttling del navegador que causa gaps en los graficos cuando el tab esta en segundo plano.

## Por que Electron?

Los navegadores (Chrome, Firefox, Edge) aplican **throttling** a tabs en segundo plano:
- Timers (setInterval, setTimeout) se ejecutan cada 1000ms minimo
- requestAnimationFrame se pausa completamente
- WebSockets pueden desconectarse por inactividad

Esto causa **gaps en los graficos** cuando el usuario cambia de tab. Electron desactiva estas restricciones.

## Estructura

```
8.AnalizadorDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray, power blocker)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz
│   │   ├── MiniChart.jsx             # Grafico con indicadores (MODIFICADO)
│   │   ├── SymbolList.jsx            # Lista lateral de monedas
│   │   ├── SymbolSelector.jsx        # Selector de simbolo
│   │   ├── trading/                  # Panel de trading
│   │   ├── indicators/               # 13 indicadores
│   │   ├── drawing/                  # Herramientas de dibujo
│   │   └── *Settings.jsx             # Modales de configuracion
│   ├── utils/
│   │   ├── CandleCache.js            # Cache IndexedDB con validacion y carga incremental
│   │   ├── PollingCoordinator.js     # Coordinador de polling v2 (setTimeout individual)
│   │   ├── IndicatorCache.js
│   │   └── Logger.js
│   ├── hooks/
│   │   └── useGlobalAlerts.js
│   ├── config.js                     # API_BASE_URL = localhost:10000
│   └── main.jsx
│
├── assets/
│   └── icon.ico                      # Icono de la aplicacion
│
├── package.json                      # Scripts y config electron-builder
├── vite.config.js                    # Puerto 5174, proxy a backend
└── start_fast.bat                    # Inicio rapido (modo fast)
```

## Comandos

```bash
# Desarrollo (Vite + Electron con hot reload)
npm run dev:electron

# Produccion local (build + ejecutar)
npm run start

# Build instalador Windows
npm run build:electron

# Build portable (sin instalacion)
npm run build:portable
```

## Configuracion Anti-Throttling

En `electron/main.js`:

```javascript
// ANTES de app.whenReady()
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// En BrowserWindow
webPreferences: {
  backgroundThrottling: false,
  // ...
}
```

## Optimizaciones de Rendimiento

```javascript
// GPU
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// V8 (JavaScript)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
```

## System Tray

La aplicacion se minimiza al tray en lugar de cerrarse:
- Doble-click en icono: Mostrar ventana
- Click derecho: Menu (Abrir, Reiniciar, Cerrar)
- Notificacion al minimizar por primera vez

## Power Save Blocker

Previene que el sistema entre en suspension mientras la app esta corriendo:

```javascript
powerSaveBlocker.start('prevent-app-suspension');
```

## Diferencias con App 4 (Browser)

| Caracteristica | App 4 (Browser) | App 8 (Electron) |
|----------------|-----------------|------------------|
| Throttling | Si (gaps en graficos) | No (sin gaps) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Instalable | No | Si (.exe) |
| DevTools | F12 en browser | F12 manual |
| Puerto frontend | 10001 | 5174 (dev) / file:// (prod) |

## Problemas Resueltos (Enero 2026)

### 1. Bug de 95 velas

**Sintoma:** Solo se mostraban 95 velas en lugar de 1440+

**Causa raiz:** Conflicto de nombres en React. El estado `setInterval` sobrescribia la funcion nativa de JavaScript:

```javascript
// INCORRECTO - sobrescribe window.setInterval
const [interval, setInterval] = useState("60");

// Cuando se llamaba:
setInterval(updatePrice, 5000);
// Esto llamaba al SETTER de React, retornando un Promise
// El interval se guardaba como "[object Promise]"
```

**Fix:** Renombrar el setter a `setIntervalState`:

```javascript
// CORRECTO
const [interval, setIntervalState] = useState("60");
```

### 2. Config corrupta en backend

**Sintoma:** `swing_config.json` tenia `"interval": "[object Promise]"`

**Fix:** Agregar validacion en `swing_service.py`:

```python
VALID_INTERVALS = ["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W"]

# En _load_config():
if interval_value not in VALID_INTERVALS:
    logger.warning(f"CONFIG CORRUPTED: resetting to '1'")
    data['interval'] = "1"

# En update_config():
if 'interval' in new_config:
    if str(new_config['interval']) not in VALID_INTERVALS:
        del new_config['interval']  # Rechazar valor invalido
```

### 3. Zoom no se ajustaba

**Fix:** Auto-correccion agresiva en `MiniChart.jsx`:

```javascript
// Si mostramos menos del 20% de las velas disponibles, corregir zoom
const showingTooFew = (displayCandles.length > 200 && preliminaryCandlesPerScreen < 200) ||
                      (displayCandles.length > 0 && preliminaryCandlesPerScreen < displayCandles.length * 0.2);

if (showingTooFew && !viewStateRef.current.userZoomed) {
  // Recalcular zoom automaticamente
  const targetCandles = Math.min(displayCandles.length * 0.6, 800);
  viewStateRef.current.zoom = chartWidth / (targetCandles * 8);
}
```

### 4. Atajo para forzar recarga

**Ctrl+Shift+R:** Limpia cache de IndexedDB, resetea zoom y recarga datos.

### 5. Optimizaciones de Carga (Enero 2026)

Se aplicaron las mismas optimizaciones del OrderFlowDesktop (App 9) para mejorar tiempos de carga:

#### 5.1 Handler Atomico para Cambio de Timeframe

**Archivo:** `SingleSymbolAnalyzer.jsx`

**Problema:** Al cambiar timeframe, se hacian dos actualizaciones separadas (interval y days), causando doble montaje de componentes.

**Solucion:** Handler unificado que cambia ambos valores en un solo batch de React:

```javascript
const handleIntervalChange = useCallback((newInterval) => {
  const defaultDays = DEFAULT_DAYS_BY_INTERVAL[newInterval];
  const maxDays = MAX_DAYS_BY_INTERVAL[newInterval] || 30;

  let newDays = defaultDays || (parseInt(days) > maxDays ? maxDays : days);

  // CRITICO: Cambiar ambos valores en un solo batch
  setIntervalState(newInterval);
  setDays(newDays.toString());
}, [days]);
```

#### 5.2 CandleCache con Carga Incremental

**Archivo:** `CandleCache.js`

**Problema:** Cache incompleto se limpiaba, forzando recarga completa de ~2 minutos.

**Solucion:** Solo limpiar cache si tiene GAPS significativos (>2 min entre velas):

```javascript
static async getValidated(symbol, interval, days) {
  // Si cache incompleto pero sin gaps, NO limpiarlo
  if (ratio < this.MIN_CACHE_RATIO) {
    console.log(`Cache incompleto, se usara carga incremental`);
    // NO limpiar - retornar para carga incremental
  }

  // Solo limpiar si hay gaps significativos
  const gapAnalysis = this.analyzeGaps(cached.candles, interval);
  if (gapAnalysis.gaps.filter(g => parseFloat(g.gapMinutes) > 2).length > 0) {
    await this.clear(symbol, interval);
    return null;
  }

  return cached;
}
```

#### 5.3 PollingCoordinator v2

**Archivo:** `PollingCoordinator.js` (nuevo)

**Problema:** PollingCoordinator v1 usaba tick global cada 1s, causando overhead.

**Solucion:** v2 usa setTimeout individual por callback:

- Sin tick global (0% CPU cuando idle)
- Cada callback tiene su propio timer
- Flag `isRunning` evita solapamiento de ejecuciones async
- Respeta visibilidad del tab (pausa cuando oculto)

**Resultado:** Cambio de timeframe mejorado de ~2:38 min a ~1:13s

### 6. DTB y Rejection Deshabilitados por Defecto (Enero 2026)

**Archivo:** `4.Analizador cripto/backend/realtime_pattern_service.py`

**Problema:** El backend ejecutaba deteccion de DTB (Double Top/Bottom) y Rejection para TODOS los simbolos, aunque estan deprecados.

**Causa:** Los defaults tenian `alertsEnabled: True`. Simbolos sin config guardada usaban defaults.

**Solucion:** Cambiar defaults a `alertsEnabled: False`:

```python
def _get_default_dbt_config(self) -> Dict:
    return {
        'alertsEnabled': False,  # DESHABILITADO - DTB deprecado
        # ...
    }

def _get_default_rejection_config(self) -> Dict:
    return {
        'alertsEnabled': False,  # DESHABILITADO - Rejection deprecado
        # ...
    }
```

**Resultado:** Solo el Swing Detector ejecuta deteccion de patrones, reduciendo carga de CPU y logging.

## Troubleshooting

**Graficos con gaps:**
- Verificar que Electron esta corriendo (no el browser)
- Verificar flags anti-throttling en main.js
- Revisar que PowerSaveBlocker esta activo

**Solo 95 velas:**
- Presionar Ctrl+Shift+R para forzar recarga
- Verificar consola por logs de zoom
- Verificar que `swing_config.json` tiene interval valido

**Backend no conecta:**
- Verificar que backend corre en puerto 10000
- Verificar proxy en vite.config.js
- En produccion, verificar API_BASE_URL en config.js

**Icono no aparece en tray:**
- Verificar que existe `assets/icon.ico`
- Formato debe ser .ico (no .png)

---

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

## Dependencias con Otras Apps

- **Backend:** Usa el mismo backend de App 5 (Order Flow) en puerto 11000
- **Indicadores:** Comparte codigo con App 4, 5 y 8
- **Cache:** Sistema propio de IndexedDB con validacion de gaps

---

# APP 10: TRADING BOT DESKTOP (Electron)

**Ubicacion:** `10.TradingBotDesktop/`

Version de escritorio del Trading Bot (App 3) empaquetada con Electron. Resuelve el problema de throttling del navegador que causa pausas en el monitoreo de alertas.

## Estructura

```
10.TradingBotDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray, power blocker)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── CredentialsPanel.jsx    # Config credenciales Bybit
│   │   ├── ConfigManager.jsx       # Gestion de simbolos
│   │   ├── DirectionManager.jsx    # Filtros LONG/SHORT
│   │   ├── AlertPanel.jsx          # Historial de alertas
│   │   ├── PositionsPanel.jsx      # Posiciones abiertas
│   │   ├── OrdersPanel.jsx         # Historial de ordenes
│   │   └── LogsPanel.jsx           # Logs del sistema
│   ├── utils/
│   │   └── robustness.js           # Validacion y health checks
│   ├── config.js                   # API_BASE_URL = localhost:5000
│   └── main.jsx
│
├── assets/
│   └── README.txt                  # Instrucciones para icon.ico
│
├── package.json                    # Scripts y config electron-builder
├── vite.config.js                  # Puerto 5001, proxy a backend
├── 1.START_ALL.bat                 # Inicio coordinado backend + Electron
├── 1_START.bat                     # Inicio con verificacion de backend
└── start_fast.bat                  # Inicio rapido
```

## Puertos

| Servicio | Puerto |
|----------|--------|
| Backend (TradingBot) | 5000 |
| Frontend Electron (dev) | 5001 |

## Comandos

```bash
# Inicio recomendado (backend + frontend)
1.START_ALL.bat

# Desarrollo manual
npm run dev:electron

# Build instalador Windows
npm run build:electron
```

## Configuracion Anti-Throttling

```javascript
// electron/main.js - ANTES de app.whenReady()
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// BrowserWindow
webPreferences: { backgroundThrottling: false }
```

## Funcionalidades

- **Ejecucion de ordenes**: Market orders con SL/TP integrado
- **Dos metodos de ejecucion**: Sequential (3 calls) o Integrated (1 call)
- **Auto-precision**: Fetch automatico de step_size/tick_size desde Bybit
- **Rate limiting**: Token Bucket para respetar limites de API
- **21 simbolos** preconfigurados
- **Filtros de direccion**: LONG/SHORT/BOTH/DISABLED por simbolo
- **System Tray**: Minimiza a bandeja, corre en background
- **PowerSaveBlocker**: Previene suspension del sistema

## Diferencias con App 3 (Browser)

| Caracteristica | App 3 (Browser) | App 10 (Electron) |
|----------------|-----------------|-------------------|
| Throttling | Si (alertas retrasadas) | No (monitoreo continuo) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Puerto frontend | 3000 | 5001 (dev) |

## Dependencias

- **Backend:** Usa el mismo backend de App 3 en puerto 5000
- **Bybit API:** Requiere credenciales configuradas

---

# APP 11: TRADING JOURNAL DESKTOP (Electron)

**Ubicacion:** `11.TradingJournalDesktop/`

Version de escritorio del Trading Journal (App 6) empaquetada con Electron. Resuelve el problema de throttling que pausaba el monitor de posiciones.

## Estructura

```
11.TradingJournalDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray, power blocker)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx           # Metricas, equity curve, win rate
│   │   ├── TradeList.jsx           # Lista filtrable de trades
│   │   ├── TradeDetail.jsx         # Detalle con screenshots y reflexion
│   │   └── Settings.jsx            # Control del monitor, export/import
│   ├── styles/
│   │   └── App.css                 # Estilos de la app
│   ├── utils/
│   │   └── robustness.js           # Validacion, health checks, formatters
│   ├── config.js                   # API_BASE_URL = localhost:12000
│   ├── App.jsx                     # Componente raiz con navegacion
│   └── main.jsx
│
├── assets/
│   └── README.txt                  # Instrucciones para icon.ico
│
├── package.json                    # Scripts y config electron-builder
├── vite.config.js                  # Puerto 12002, proxy a backend
├── 1.START_ALL.bat                 # Inicio coordinado backend + Electron
├── 1_START.bat                     # Inicio con verificacion de backend
└── start_fast.bat                  # Inicio rapido
```

## Puertos

| Servicio | Puerto |
|----------|--------|
| Backend (Trading Journal) | 12000 |
| Frontend Electron (dev) | 12002 |

## Comandos

```bash
# Inicio recomendado (backend + frontend)
1.START_ALL.bat

# Desarrollo manual
npm run dev:electron

# Build instalador Windows
npm run build:electron
```

## Configuracion Anti-Throttling

```javascript
// electron/main.js - ANTES de app.whenReady()
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// BrowserWindow
webPreferences: { backgroundThrottling: false }
```

## Funcionalidades

### Dashboard
- Metricas: Total P&L, Win Rate, Profit Factor, Max Drawdown
- Curva de equity visualizada
- Gauge de win rate
- Trades recientes

### Trade List
- Tabla filtrable por estado, simbolo, direccion, fuente
- Ordenamiento por columnas
- Badges de estado (OPEN, WIN, LOSS)

### Trade Detail
- P&L en USD, %, R-Multiple
- Screenshots de entrada y salida
- Reflexion editable con emociones y notas

### Settings
- Control del monitor (start/stop)
- Estado de conexiones
- Export/Import de datos

## Monitor de Posiciones

El backend hace polling al TradingBot cada 5 segundos:
1. Detecta nuevas posiciones → Crea JournalEntry + Screenshot
2. Detecta posiciones cerradas → Actualiza con exit_price, PnL + Screenshot
3. Match con alertas recientes para determinar source

## Diferencias con App 6 (Browser)

| Caracteristica | App 6 (Browser) | App 11 (Electron) |
|----------------|-----------------|-------------------|
| Throttling | Si (monitor se pausa) | No (monitor continuo) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Puerto frontend | 12001 | 12002 (dev) |

## Dependencias

- **Backend:** Usa el mismo backend de App 6 en puerto 12000
- **TradingBot:** Requiere TradingBot corriendo en puerto 5000 para el monitor
- **Screenshots:** Backend usa Playwright/mplfinance
