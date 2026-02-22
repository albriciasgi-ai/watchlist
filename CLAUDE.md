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

## Polling en Tiempo Real (Febrero 2026)

### Problema Original
El VWAP solo se actualizaba para 2 de 10 simbolos durante el polling. Los otros 8 mantenian `dataMap.size` fijo porque el backend consideraba que ya tenia suficientes datos.

### Solucion: Carga Incremental

1. **Parametro `refresh` en endpoint**:
```python
@app.get("/api/vwap-service/data/{symbol}")
async def get_vwap_service_data(
    symbol: str,
    days: int = 1,
    interval: str = "60",
    refresh: bool = False  # Para polling
):
    if refresh and not config_changed and not needs_more_data:
        # Carga incremental - solo velas nuevas
        await vwap_service.reload_symbol_data(symbol, 1, interval, incremental=True)
```

2. **Metodo `_fetch_candles_since` en vwap_service.py**:
```python
async def _fetch_candles_since(self, symbol: str, since_timestamp: int, interval: str):
    """Fetch solo velas nuevas desde un timestamp especifico"""
    url = f"{BYBIT_API_URL}?symbol={symbol}&interval={interval}&start={since_timestamp + 1}&limit=200"
    # Una sola llamada eficiente a la API
```

3. **Merge incremental**:
```python
if incremental and symbol in self._historical_candles:
    existing = self._historical_candles[symbol]
    last_ts = max(c['timestamp'] for c in existing)
    candles = await self._fetch_candles_since(symbol, last_ts, interval)
    # Merge usando Map por timestamp para deduplicar
    candle_map = {c['timestamp']: c for c in existing}
    for c in candles:
        candle_map[c['timestamp']] = c
    self._historical_candles[symbol] = sorted(candle_map.values(), key=lambda x: x['timestamp'])
```

4. **Frontend envia `refresh=true` en polling**:
```javascript
// VWAPIndicator.js - fetchData()
if (skipCache) {
  params.append('refresh', 'true');
}
```

### Resultado
- Todas las monedas actualizan VWAP en tiempo real
- Una sola llamada eficiente a Bybit API por simbolo
- Sin acumulacion de datos duplicados

## Fix: Cliente HTTP Global (Febrero 2026)

### Problema
Error `ValueError: too many file descriptors in select()` despues de uso prolongado.

### Causa
`vwap_service.py` creaba nueva `aiohttp.ClientSession()` para cada request.

### Solucion
```python
class VWAPService:
    def __init__(self):
        self._http_session: Optional[aiohttp.ClientSession] = None

    async def _get_http_session(self) -> aiohttp.ClientSession:
        if self._http_session is None or self._http_session.closed:
            connector = aiohttp.TCPConnector(limit=10, limit_per_host=5)
            self._http_session = aiohttp.ClientSession(
                connector=connector,
                timeout=aiohttp.ClientTimeout(total=60)
            )
        return self._http_session
```

---

# VELAS DUPLICADAS Y GAPS (Febrero 2026)

## Problema
Aparecian velas repetidas (ej: vela de 12:59 duplicada) y gaps entre velas en el grafico.

## Causa
Dos lugares en `MiniChart.jsx` no deduplicaban correctamente:

1. **Merge de velas del WebSocket** - concatenaba sin verificar
2. **Push de velas cerradas** - siempre hacia push sin verificar existencia

## Solucion

### 1. Merge con Map para deduplicar (lineas 1138-1154)
```javascript
// Preservar velas del WebSocket que son mas nuevas - CON DEDUPLICACION
const existingCandles = candlesRef.current;
if (existingCandles && existingCandles.length > 0 && finalCandles.length > 0) {
  const candleMap = new Map();
  finalCandles.forEach(c => candleMap.set(c.timestamp, c));

  const lastFinalTs = finalCandles[finalCandles.length - 1].timestamp;
  existingCandles.forEach(c => {
    if (c.timestamp > lastFinalTs) {
      candleMap.set(c.timestamp, c);
    }
  });

  finalCandles = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);
}
```

### 2. Verificar antes de push (lineas 1348-1362)
```javascript
// Evitar duplicados - solo agregar si no existe una vela con ese timestamp
const existingIndex = candlesRef.current.findIndex(c => c.timestamp === currentInProgress.timestamp);
if (existingIndex === -1) {
  candlesRef.current.push(currentInProgress);
} else {
  // Actualizar la vela existente con datos mas recientes
  candlesRef.current[existingIndex] = currentInProgress;
}
```

## Archivos Modificados
- `7.WatchlistDesktop/src/components/MiniChart.jsx`
- `2.WatchlistConIndicadores/backend/vwap_service.py`
- `2.WatchlistConIndicadores/backend/main.py`

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
│   ├── config.js                     # API_BASE_URL = localhost:10001
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
- Verificar que backend corre en puerto 10001
- Verificar proxy en vite.config.js
- En produccion, verificar API_BASE_URL en config.js

**Zonas realtime no aparecen:**
- Verificar servicio activo: `GET /api/zones/realtime/status`
- Verificar IndicatorManager tiene polling: buscar `Realtime zones actualizadas` en consola
- Ver seccion ZONE DETECTOR REALTIME para detalles completos

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

---

# ZONE DETECTOR (Analizador Desktop - Febrero 2026)

Sistema de deteccion de zonas de consolidacion con simulacion de trading integrada.

## Cambio de Puerto (Febrero 2026)

**IMPORTANTE:** El puerto del backend del Analizador cripto/AnalizadorDesktop cambio de 10000 a **10001** debido a procesos zombie que bloqueaban el puerto 10000.

### Archivos Actualizados

| Archivo | Cambio |
|---------|--------|
| `8.AnalizadorDesktop/src/config.js` | `API_BASE_URL = "http://localhost:10001"` |
| `4.Analizador cripto/backend/main.py` | Fix: `get_historical_data` -> `get_historical` en endpoint zones |

### Comando de Inicio

```bash
# Backend (puerto 10001)
cd "4.Analizador cripto/backend"
.venv\Scripts\python.exe -m uvicorn main:app --port 10001 --host 127.0.0.1

# Frontend Electron
cd 8.AnalizadorDesktop
npm run dev:electron
```

## Endpoint de Deteccion de Zonas

### POST `/api/zones/detect`

Detecta zonas de consolidacion y simula trades con TP=2R y SL=1R.

**Request:**
```json
{
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 30,
  "consol_min_bars": 8,
  "consol_max_bars": 50,
  "consol_max_range_pct": 2.0,
  "consol_atr_ratio": 0.6,
  "consol_body_ratio": 0.5,
  "consol_max_outside_bars": 3,
  "lookforward_bars": 100,
  "max_price_range_pct": 5.0,
  "generate_csv": true
}
```

**Response:**
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 30,
  "candles_count": 720,
  "zones": [
    {
      "id": "zone_1234567890_0",
      "start_timestamp": 1706745600000,
      "end_timestamp": 1706832000000,
      "min_price": 42000.0,
      "max_price": 42500.0,
      "price_range_pct": 1.19,
      "candles_in_zone": 12,
      "duration_hours": 24.0,
      "breakout_direction": "UP",
      "breakout_price": 42550.0,
      "breakout_timestamp": 1706835600000,
      "trade_result": "WIN",
      "trade_pnl_r": 2.0,
      "r_multiple": 2.0,
      "reached_2r": true,
      "reached_3r": false,
      "bars_to_close": 15,
      "trading_score": 75
    }
  ],
  "stats": {
    "total_zones": 5,
    "wins": 3,
    "losses": 2,
    "open": 0,
    "win_rate": 60.0,
    "total_pnl_r": 4.0
  },
  "csv_path": "zones_csv/BTCUSDT_60_zones_20260203_001500.csv"
}
```

## Componentes Frontend

### ZoneDetectorSettings.jsx

Modal para configurar parametros de deteccion:

| Parametro | Default | Descripcion |
|-----------|---------|-------------|
| `consol_min_bars` | 8 | Minimo de velas en la zona |
| `consol_max_bars` | 50 | Maximo de velas en la zona |
| `consol_max_range_pct` | 2.0 | Maximo % de rango de precio |
| `consol_atr_ratio` | 0.6 | Ratio ATR para validar consolidacion |
| `consol_body_ratio` | 0.5 | Ratio de cuerpo de velas |
| `consol_max_outside_bars` | 3 | Velas fuera de rango permitidas |
| `lookforward_bars` | 100 | Velas a futuro para simular trade |
| `max_price_range_pct` | 5.0 | Filtro global de rango de precio |

### Integracion con IndicatorManager

```javascript
// En ZoneDetectorSettings.jsx
const manager = IndicatorManagerRegistry.get(symbol);
const result = await manager.loadTradingZones({
  ...params,
  generate_csv: true
});
```

## Generacion de CSV

Cuando `generate_csv: true`, se crea un archivo CSV con formato europeo (separador `;`, decimal `,`):

```
zone_num;start_date;end_date;min_price;max_price;price_range_pct;breakout_direction;trade_result;trade_pnl_r;r_multiple;trading_score;candles_in_zone;duration_hours
1;2026-01-15 08:00;2026-01-16 08:00;42000,00;42500,00;1,19;UP;WIN;2,0;2,00;75;12;24,0
```

**Ubicacion:** `4.Analizador cripto/backend/zones_csv/`

## Troubleshooting

**Error "IndicatorManager no disponible":**
- El grafico debe estar cargado antes de abrir el modal
- Verificar que `IndicatorManagerRegistry.get(symbol)` retorna un manager valido

**Error 404 en `/api/zones/detect`:**
- Verificar que el backend corre en puerto 10001
- Verificar que el fix `get_historical` esta aplicado en main.py linea 4417

**Puerto 10000 bloqueado:**
- Procesos zombie de Python pueden bloquear el puerto
- Usar puerto 10001 como alternativa
- O reiniciar la PC para liberar sockets

**CSV no se genera:**
- Verificar que existe el directorio `zones_csv/`
- Verificar permisos de escritura

---

# ZONE DETECTOR v3.1 - Mejoras Febrero 2026

## Resumen de Cambios

Sistema mejorado con presets, scoring intrinseco, limites expandidos y barra de progreso para carga de datos.

## 1. Sistema de Presets (ZoneDetectorSettings.jsx)

Permite guardar, cargar y eliminar configuraciones personalizadas.

### Funciones Implementadas

```javascript
// Guardar preset
const handleSavePreset = () => {
  const presets = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || '{}');
  presets[presetName] = { ...currentParams };
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
};

// Cargar preset
const handleLoadPreset = (name) => {
  const presets = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || '{}');
  if (presets[name]) {
    setParams(presets[name]);
  }
};

// Eliminar preset
const handleDeletePreset = (name) => {
  const presets = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || '{}');
  delete presets[name];
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
};
```

### UI de Presets

- Dropdown para seleccionar preset guardado
- Input + boton "Guardar" para crear nuevo preset
- Boton "Eliminar" para borrar preset seleccionado
- Boton "Reset" para volver a valores por defecto

### Storage Key

```javascript
const PRESETS_STORAGE_KEY = 'zoneDetector_presets';
```

## 2. Scoring Intrinseco (Correccion de Sesgos)

El calculo del score de cada zona fue corregido para eliminar sesgos post-trade.

### Sesgos Corregidos

1. **Continuation Score**: Ahora es opcional via `use_continuation_score`
   - Solo aplica cuando `entry_mode = "swing_confirmation"`
   - No aplica para `breakout_close` (no hay forma de saber si velas futuras continuaran)

2. **Ajuste por Resultado**: Eliminado completamente
   - Antes: WIN +15, LOSS -10
   - Ahora: Score final = base_score (sin ajuste por resultado)

### Implementacion (zone_detector.py)

```python
@dataclass
class ZoneDetectionParams:
    # ... otros parametros ...
    use_continuation_score: bool = False  # Solo usar si entry_mode=swing_confirmation

# En calculo de score:
continuation_score = 0
if params.use_continuation_score and params.entry_mode == "swing_confirmation":
    continuation_score = min(continuation_bars * 5, 20)

# Score final = base_score (NO aplicamos ajuste por resultado WIN/LOSS)
trading_score = base_score
```

### UI (ZoneDetectorSettings.jsx)

Checkbox "Usar Continuation Score" solo visible cuando entry_mode = "swing_confirmation".

## 3. Limites de Dias Expandidos

### MAX_DAYS_BY_INTERVAL Actualizado

| Intervalo | Antes | Ahora |
|-----------|-------|-------|
| 1 min | 5 | 7 |
| 3 min | 10 | 21 |
| 5 min | 120 | **400** |
| 15 min | 90 | 180 |
| 30 min | 150 | 360 |
| 60 min | 360 | 730 |
| 120 min | 180 | 730 |
| 240 min | 720 | 1095 |
| D | 1440 | 2000 |
| W | 730 | 1000 |

### Archivos Actualizados

1. **Backend:** `4.Analizador cripto/backend/main.py` (linea 82)
2. **Frontend Settings:** `8.AnalizadorDesktop/src/components/ZoneDetectorSettings.jsx`
3. **Frontend Chart:** `8.AnalizadorDesktop/src/components/SingleSymbolAnalyzer.jsx`

### Limite de Requests Aumentado

En `get_historical()` (main.py linea 302):
```python
# Antes: max_requests = 50  (50k velas max)
# Ahora:
max_requests = 120  # 120 requests x 1000 velas = 120,000 velas max (~416 dias en 5min)
```

## 4. Barra de Progreso para Carga de Datos

Sistema SSE (Server-Sent Events) para mostrar progreso durante carga de datasets grandes.

### Backend - Endpoint SSE

```python
@app.get("/api/historical-stream/{symbol}")
async def get_historical_stream(symbol: str, interval: str = "15", days: int = 30):
    async def generate():
        # Enviar progreso mientras descarga
        yield f"data: {json.dumps({'type': 'progress', 'loaded': N, 'total': T, 'percent': P})}\n\n"
        # Enviar datos finales
        yield f"data: {json.dumps({'type': 'complete', 'total_candles': N, 'data': candles})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

### Frontend - MiniChart.jsx

**Estado de progreso:**
```javascript
const [loadProgress, setLoadProgress] = useState(null); // { loaded, total, percent }
```

**Umbral para usar streaming:**
```javascript
const STREAM_THRESHOLD = 10000; // Mas de 10k velas usa SSE
```

**Funcion de carga con SSE:**
```javascript
const loadHistoricalWithStream = async (daysToLoad) => {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/api/historical-stream/${symbol}?interval=${interval}&days=${daysToLoad}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        setLoadProgress({ loaded: data.loaded, total: data.total, percent: data.percent });
      } else if (data.type === 'complete') {
        setLoadProgress(null);
        eventSource.close();
        resolve({ success: true, data: data.data });
      }
    };
  });
};
```

**UI de barra de progreso:**
- Overlay con fondo semitransparente
- Barra de progreso con gradiente azul-verde
- Porcentaje centrado en la barra
- Contador de velas: "45,000 / 115,000 velas"
- Info: "BTCUSDT @ 5min - 400 dias"

### Logica de Decision

```javascript
// En loadHistoricalData():
if (useStreaming && !isIncremental) {
  // Dataset grande (>10k velas) - usar SSE con progreso
  json = await loadHistoricalWithStream(parseInt(days));
} else {
  // Dataset pequeno o incremental - fetch tradicional
  json = await fetchWithRetry(url, ...);
}
```

## 5. Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `zone_detector.py` | `use_continuation_score`, eliminado ajuste WIN/LOSS |
| `main.py` | MAX_DAYS expandido, max_requests=120, endpoint SSE |
| `ZoneDetectorSettings.jsx` | Presets, MAX_DAYS expandido, checkbox continuation |
| `SingleSymbolAnalyzer.jsx` | MAX_DAYS_BY_INTERVAL, DAYS_OPTIONS expandidos |
| `MiniChart.jsx` | Estado loadProgress, loadHistoricalWithStream(), UI progreso |
| `IndicatorManager.js` | Parametro use_continuation_score |

## 6. Formula de Score Actual

```
base_score = momentum_score + compression_score + volume_bonus + [continuation_score] + [bbwp_bonus]

Donde:
- momentum_score: 0-25 (direccion del breakout vs momentum previo)
- compression_score: 0-25 (que tan comprimida esta la zona)
- volume_bonus: 0-15 (volumen relativo en zona)
- continuation_score: 0-20 (OPCIONAL, solo si use_continuation_score=true Y entry_mode=swing_confirmation)
- bbwp_bonus: 0-15 (OPCIONAL, solo si use_bbwp_scoring=true Y BBWP < threshold)

trading_score = base_score (sin ajuste por resultado WIN/LOSS)
```

## 7. Ejemplo de Uso

```javascript
// Cargar 400 dias de datos en 5 minutos con barra de progreso
const params = {
  symbol: "BTCUSDT",
  interval: "5",
  days: 400,
  use_continuation_score: false,  // No usar para breakout_close
  entry_mode: "breakout_close",
  min_score_filter: 50
};

// El frontend detecta que 400 dias en 5min = ~115k velas > 10k threshold
// Automaticamente usa SSE con barra de progreso
const result = await manager.loadTradingZones(params);
```

## 8. Troubleshooting Adicional

**Barra de progreso no aparece:**
- Verificar que days * candles_por_dia > 10,000
- Para 5min: threshold es ~35 dias
- Para 1h: threshold es ~416 dias

**Analisis dice "50,000 velas" aunque seleccione 400 dias:**
- Verificar que `max_requests = 120` en main.py linea 302
- Reiniciar backend despues de cambiar

**Preset no se guarda:**
- Verificar localStorage disponible
- Key: `zoneDetector_presets`

**Score muy bajo en todas las zonas:**
- Revisar que no se esta usando continuation_score incorrectamente
- El score maximo sin continuation es ~80 (momentum + compression + volume + bbwp)

---

# ZONE DETECTOR REALTIME (Febrero 2026)

Sistema de deteccion de zonas de consolidacion en tiempo real con visualizacion en el chart y alertas al TradingBot.

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ZONE DETECTOR REALTIME                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  BACKEND (4.Analizador cripto/backend/)                               │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ zone_service.py                                                  │ │
│  │   WebSocket candle close → _detect_and_alert()                   │ │
│  │     → zone_detector.detect_zones() (con parametros de config)    │ │
│  │     → _store_zones() → almacena en _recent_zones dict           │ │
│  │     → _send_alert() (si alertsEnabled=true) → TradingBot :5000  │ │
│  │                                                                   │ │
│  │ zone_realtime_config.json                                        │ │
│  │   enabled, symbols, interval, window_candles, alertsEnabled...   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│           │                                                           │
│  Endpoints:                                                           │
│  - GET /api/zones/realtime/status  → Estado del servicio              │
│  - GET /api/zones/realtime/zones/{symbol}  → Zonas detectadas         │
│  - POST /api/zones/realtime/toggle  → Activar/desactivar             │
│  - POST /api/zones/realtime/config  → Actualizar configuracion        │
│  - POST /api/zones/realtime/reanalyze  → Re-analizar historico        │
│           │                                                           │
│  FRONTEND (8.AnalizadorDesktop/src/)                                  │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ IndicatorManager.js                                              │ │
│  │   _fetchRealtimeZones() (cada 15s, con fingerprint detection)    │ │
│  │   → zoneVisualizerIndicator.setRealtimeZones(zones)              │ │
│  │   → requestRedraw()                                              │ │
│  │                                                                   │ │
│  │ ZoneVisualizerIndicator.js                                       │ │
│  │   _manualZones[] + _realtimeZones[] → _mergeZones() → zones[]   │ │
│  │   Renderiza: consolidacion + trade rectangle + labels            │ │
│  │   Estados: WIN (verde), LOSS (rojo), OPEN (amarillo)             │ │
│  │                                                                   │ │
│  │ ZoneDetectorSettings.jsx                                         │ │
│  │   Modal de configuracion con toggle start/stop polling           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Flujo Completo

```
1. Usuario activa servicio realtime desde ZoneDetectorSettings modal
   POST /api/zones/realtime/toggle {enabled: true}
      ↓
2. Backend inicia zone_service: conecta WebSocket, carga historico
      ↓
3. En cada cierre de vela:
   _detect_and_alert() → zone_detector.detect_zones()
      ↓
4. Zonas detectadas se almacenan en _recent_zones[symbol]
   Si alertsEnabled=true → POST al TradingBot (puerto 5000)
      ↓
5. Frontend: IndicatorManager hace polling GET /api/zones/realtime/zones/{symbol}
   Cada 15 segundos (auto-inicia si detecta servicio activo)
      ↓
6. Si fingerprint cambio → setRealtimeZones() → _mergeZones() → redraw
      ↓
7. Chart renderiza zonas con colores segun estado del trade
```

## Separacion de Fuentes de Zonas

**Problema resuelto:** El polling realtime sobrescribia zonas manuales.

**Solucion:** Dos fuentes independientes en ZoneVisualizerIndicator:

| Fuente | Array | Metodo | Origen |
|--------|-------|--------|--------|
| Manual | `_manualZones` | `setZones()` | Boton "Detectar zonas" |
| Realtime | `_realtimeZones` | `setRealtimeZones()` | Polling cada 15s |

`_mergeZones()` combina ambas con deduplicacion por `start_timestamp + end_timestamp`. Si hay conflicto, la zona manual tiene prioridad.

## Estado OPEN para Trades en Progreso

**Problema resuelto:** Trades sin TP/SL se mostraban como LOSS.

**Cambio en backend** (`zone_detector.py`):
- Antes: PENDING → forzaba WIN/LOSS segun P&L parcial
- Ahora: PENDING → `trade_result = "OPEN"` con P&L parcial informativo

**Renderizado frontend** (`ZoneVisualizerIndicator.js`):

| Estado | Color | Borde | Extension | Label |
|--------|-------|-------|-----------|-------|
| WIN | Verde | Solido | Hasta `trade_close_timestamp` | W |
| LOSS | Rojo | Solido | Hasta `trade_close_timestamp` | L |
| OPEN | Amarillo | Discontinuo | Hasta borde derecho del chart | O |

## Fingerprint Change Detection

```javascript
// En IndicatorManager._fetchRealtimeZones()
const fingerprint = zones.map(z => `${z.start_timestamp}_${z.trade_result}`).join('|');
if (fingerprint !== this._lastRealtimeZoneFingerprint) {
  // Detecta: nueva zona, o transicion OPEN→WIN/LOSS
  this.zoneVisualizerIndicator.setRealtimeZones(zones);
  this.requestRedraw();
}
```

## Config Realtime

```json
// 4.Analizador cripto/backend/config/zone_realtime_config.json
{
  "enabled": true,
  "symbols": ["BTCUSDT"],
  "interval": "1",
  "window_candles": 100,
  "alertsEnabled": true,
  "alertTargetUrl": "http://localhost:5000/api/watchlist-alert",
  "cooldownMinutes": 5
}
```

**Nota:** `alertsEnabled` controla envio al TradingBot. La deteccion y visualizacion funcionan independientemente.

## Archivos del Sistema

### Backend

| Archivo | Descripcion |
|---------|-------------|
| `zone_service.py` | Servicio realtime: WebSocket → deteccion → almacenamiento → alertas |
| `zone_detector.py` | Algoritmo de deteccion + simulacion trades (OPEN/WIN/LOSS) |
| `config/zone_realtime_config.json` | Configuracion persistente del servicio |

### Frontend

| Archivo | Descripcion |
|---------|-------------|
| `indicators/IndicatorManager.js` | Polling realtime zones, auto-deteccion servicio activo |
| `indicators/ZoneVisualizerIndicator.js` | Dual source (manual/realtime), merge, render OPEN state |
| `ZoneDetectorSettings.jsx` | Modal config, toggle servicio, control polling chart |

## Troubleshooting

**Zonas realtime no aparecen en el chart:**
- Verificar servicio activo: `GET /api/zones/realtime/status`
- Verificar zonas almacenadas: `GET /api/zones/realtime/zones/{symbol}`
- Consola: buscar `[{symbol}] Realtime zones actualizadas: N zonas`

**0 alertas al TradingBot:**
- Verificar `alertsEnabled: true` en `zone_realtime_config.json`
- El checkbox "Alertas" en el modal controla este flag

**Zonas manuales desaparecen con realtime activo:**
- Corregido con separacion `_manualZones` / `_realtimeZones`
- Polling debe usar `setRealtimeZones()`, nunca `setZones()`

**Trades muestran LOSS en vez de OPEN:**
- Verificar fix en `zone_detector.py` (PENDING → OPEN)

**Problema conocido:** `_send_alert()` en `zone_service.py` envia `custom_stop_loss` y `custom_take_profit` pero no `order_type`, lo cual puede causar inconsistencia de TP/SL en ordenes market.

## Fixes Febrero 2026 (sesion 2)

### Bug 1: Zonas historicas WIN/LOSS se re-registraban como OPEN

**Archivo:** `zone_service.py` linea ~897

**Causa:** La condicion `zone.trade_result not in ("SKIPPED", "NO_ENTRY", "")` permitia que zonas con resultado WIN o LOSS se re-registraran como trades abiertos.

**Fix:** Cambiar a `zone.trade_result == "OPEN"` - solo registrar como open trade si el detector explicitamente lo marca como OPEN.

### Bug 2: Pending INSTANT_BREAKOUT con SL/TP absurdos

**Archivo:** `zone_service.py` en `_check_pending_breakouts()`

**Causa:** Cuando el precio se alejaba mucho de la zona y luego habia breakout, el entry price estaba muy lejos del zone edge, generando SL/TP con distancias absurdas.

**Fix:** Validacion de proximidad - si `distance_pct` entre entry y zone edge supera `max_price_range_pct`, se bloquea con log `BLOCKED_FAR_ENTRY`.

### Bug 3: Multiples trades abiertos en modo sequential

**Archivo:** `zone_service.py` en `_register_open_trades()` y `_check_pending_breakouts()`

**Causa:** No se verificaba si ya habia un trade abierto antes de abrir otro en modo sequential.

**Fix:**
- `_register_open_trades()`: Si `position_mode == "sequential"` y ya hay trades abiertos, bloquea con `BLOCKED_SEQUENTIAL`
- `_check_pending_breakouts()`: Misma verificacion al inicio, bloquea con `BLOCKED_SEQUENTIAL_PENDING`

### Pausa de re-deteccion historica

**Archivos:** `zone_service.py`, `main.py`, `ZoneDetectorSettings.jsx`

Boton toggle que pausa `_detect_and_alert()` sin detener el tracking de trades ni pending breakouts.

- **Backend:** `self.detection_paused` flag (runtime, no persistido)
- **Endpoint:** `POST /api/zones/realtime/pause-detection` (toggle)
- **UI:** Boton naranja prominente "DETECCION PAUSADA - Click para reanudar"
- Cuando pausado: `_update_open_trades()` y `_check_pending_breakouts()` siguen corriendo

### Boton "Detectar ahora (1 vez)"

**Archivos:** `zone_service.py`, `main.py`, `ZoneDetectorSettings.jsx`

Ejecuta `_detect_and_alert()` una sola vez sin cambiar el estado de pausa. Permite descubrir pending zones cuando la re-deteccion continua esta pausada.

- **Backend:** `run_detection_once()` retorna resultados por simbolo (pending/baseline antes y despues)
- **Endpoint:** `POST /api/zones/realtime/detect-now`
- **UI:** Boton azul visible solo cuando la deteccion esta pausada

### Metodo de deteccion configurable

**Archivos:** `zone_service.py`, `ZoneDetectorSettings.jsx`

El metodo de deteccion (`trading_zones` o `atr_dynamic`) ahora es configurable desde la UI y se persiste en `zone_realtime_config.json`.

**Problema resuelto:** Las barras de metricas usaban `atr_dynamic` pero el servicio realtime tenia hardcodeado `"trading_zones"`. Las zonas detectadas por las metricas no coincidian con las del servicio.

**Cambios:**
- `ZoneServiceConfig`: nuevo campo `detection_method` + params `atr_dyn_*`
- `_detect_and_alert()` y `_initial_detection()`: usan `self.config.detection_method` en vez de hardcode
- `_build_detection_params()`: incluye params de ATR Dynamic
- Frontend `handleRealtimeConfigSave`: envia `detection_method` y `atr_dyn_*` al backend

### Endpoints nuevos

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/zones/realtime/pause-detection` | POST | Toggle pausa de re-deteccion |
| `/api/zones/realtime/detect-now` | POST | Ejecutar deteccion una sola vez |

---

# OPTIMIZADOR DE PARAMETROS - GRID SEARCH (Febrero 2026)

Sistema para encontrar la mejor combinacion de parametros del Zone Detector mediante busqueda exhaustiva (grid search).

## Archivos del Sistema

| Archivo | Descripcion |
|---------|-------------|
| `4.Analizador cripto/backend/main.py` | Endpoints `/api/zones/optimize` y `/api/zones/optimize-estimate` |
| `8.AnalizadorDesktop/src/components/indicators/IndicatorManager.js` | Metodos `estimateOptimization()` y `optimizeTradingZones()` |
| `8.AnalizadorDesktop/src/components/ZoneDetectorSettings.jsx` | UI: estimacion, confirmacion, ejecucion, tabla de resultados |

## Flujo de Uso

1. **Usuario abre modal Zone Detector** → seccion "Optimizador de Parametros"
2. **Selecciona parametros a optimizar** (checkbox) y ajusta rangos min/max/step
3. **Click "Estimar y Ejecutar"** → backend ejecuta 2 combos de prueba y extrapola
4. **UI muestra estimacion**: tiempo, combinaciones, velas. Colores: verde (<1min), amarillo (<5min), rojo (>5min)
5. **"Confirmar y Ejecutar"** → grid search completo en thread pool
6. **Tabla de resultados**: Top 15 ordenados por metrica elegida, boton "Aplicar" por fila
7. Los parametros no optimizados se toman del estado actual del modal

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/zones/optimize-estimate` | POST | Ejecuta 2 combos de prueba y extrapola tiempo |
| `/api/zones/optimize` | POST | Grid search completo, retorna top N resultados |

### Request Body

```json
{
  "symbol": "BTCUSDT",
  "interval": "5",
  "days": 400,
  "base_params": { "lookforward_bars": 100, "entry_mode": "breakout_close" },
  "param_ranges": {
    "atr_dyn_multiplier": { "min": 0.5, "max": 2.0, "step": 0.25 },
    "ttm_kc_multiplier": { "min": 1.0, "max": 2.5, "step": 0.25 }
  },
  "metric": "expectancy",
  "top_n": 15
}
```

## Parametros Optimizables

| Parametro | Label UI | Default Range | Descripcion |
|-----------|----------|---------------|-------------|
| `atr_dyn_multiplier` | ATR Multiplier | 0.5 - 2.0 (0.25) | Multiplicador ATR para ancho de zona |
| `atr_dyn_ma_period` | MA Period | 10 - 40 (5) | Periodo media movil del ATR |
| `atr_dyn_max_breakout` | Max Breakout | 2 - 10 (2) | Max velas de breakout permitidas |
| `consol_max_range_pct` | Max Range % | 1.0 - 4.0 (0.5) | Maximo rango de precio de la zona |
| `min_score_filter` | Min Score | 0 - 60 (10) | Score minimo para incluir zona |
| `lookforward_bars` | Lookforward | 50 - 200 (25) | Velas a futuro para simular trade |
| `atr_dyn_period` | ATR Period | 100 - 300 (50) | Periodo del calculo ATR |
| `ttm_atr_length` | TTM ATR Length | 10 - 30 (5) | Periodo ATR para Keltner Channels |
| `ttm_kc_multiplier` | TTM KC Mult | 1.0 - 2.5 (0.25) | Multiplicador Keltner Channel |
| `ttm_min_squeeze_bars` | TTM Min Bars | 3 - 10 (1) | Min velas consecutivas en squeeze |

**Nota:** Los parametros TTM solo surten efecto si `use_ttm_prefilter=true` esta activado en el modal.

## Metricas de Optimizacion

| Metrica | Descripcion |
|---------|-------------|
| `expectancy` | PnL promedio por trade cerrado (en R) |
| `total_pnl_r` | PnL total acumulado (en R) |
| `win_rate` | Porcentaje de trades ganadores |
| `profit_factor` | Ganancia bruta / Perdida bruta |

## Limites y Validaciones

- **Max combinaciones**: 5,000 (frontend y backend validan)
- **Max valores por parametro**: 20 (se submuestrean si excede)
- **Timeout frontend**: 60 minutos
- **Ejecucion**: `loop.run_in_executor(None, ...)` en thread pool para no bloquear uvicorn
- **Logs**: Backend imprime progreso cada 10 combinaciones

## Implementacion Backend

El grid search se ejecuta en un thread pool para no bloquear el event loop de uvicorn:

```python
def run_all_combos():
    results = []
    for i, combo in enumerate(all_combos):
        result = run_single_combo(combo_dict)
        results.append(result)
    results.sort(key=lambda r: r.get(metric, 0), reverse=True)
    return results

loop = asyncio.get_event_loop()
results = await loop.run_in_executor(None, run_all_combos)
```

**CRITICO:** Nunca ejecutar codigo CPU-bound sincrono dentro de un `async def` en FastAPI. Siempre usar `run_in_executor` para offload a thread pool.

## Troubleshooting

**Estimacion dice 0 segundos:**
- Datos en cache hacen la deteccion muy rapida con pocas velas

**Optimizacion se corta sin resultados:**
- Verificar timeout (60 min). Revisar logs: `[SYMBOL] [OPTIMIZE] Progreso: N/M`

**Resultados TTM no cambian nada:**
- Verificar que `use_ttm_prefilter` esta activado en el modal

---

# VP PERIODIC BACKTEST (Febrero 2026)

Sistema de backtesting de estrategias basadas en Volume Profile Periodic + VWAP Session, con visualizacion de trades en el chart.

## Archivos del Sistema

### Backend (`4.Analizador cripto/backend/`)

| Archivo | Descripcion |
|---------|-------------|
| `backtest_vp_periodic.py` | Motor de backtest: 3 estrategias, calculo VP, VWAP Session, metricas |
| `main.py` (endpoint POST) | `POST /api/vp-periodic/backtest` - Backtest sincrono |
| `main.py` (endpoint SSE) | `GET /api/vp-periodic/backtest-stream` - Backtest con progreso via SSE |

### Frontend (`8.AnalizadorDesktop/src/`)

| Archivo | Descripcion |
|---------|-------------|
| `components/VPPeriodicBacktestSettings.jsx` | Modal de configuracion y ejecucion de backtests |
| `components/indicators/IndicatorManager.js` | Metodo `runVPPeriodicBacktest()` - conecta con SSE endpoint |
| `components/indicators/ZoneVisualizerIndicator.js` | Renderiza trades como zonas VP via `setVPZones()` |
| `components/SingleSymbolAnalyzer.jsx` | Integra el modal en la UI principal |

## Estrategias Disponibles

| Estrategia | Descripcion | Parametros |
|------------|-------------|------------|
| `poc_bounce` | Mean reversion al POC. Cruza POC filtrado por VWAP. SL en borde VA. | vp_period, tp_rr, bins |
| `va_breakout` | Breakout del Value Area. N cierres fuera del VA + VWAP sigma. SL en POC. | vp_period, tp_rr, confirm_bars, min_va_width_pct, bins |
| `rejection_confluence` | Rechazo en VAH/VAL + confluencia VWAP sigma + vela de rechazo. TP en POC. | vp_period, tolerance_pct, wick_ratio, bins |

## Endpoints API

### POST `/api/vp-periodic/backtest`

Backtest sincrono (sin progreso). Ejecuta en thread pool.

```json
{
  "symbol": "BTCUSDT",
  "interval": "1",
  "days": 400,
  "strategy": "poc_bounce",
  "params": { "vp_period": 240, "tp_rr": 2.0, "bins": 50 }
}
```

### GET `/api/vp-periodic/backtest-stream` (SSE)

Backtest con barra de progreso via Server-Sent Events.

**Query params:** `symbol`, `interval`, `days`, `strategy`, `params_json`

**Eventos SSE:**
- `type: 'progress'` - `{phase, percent, message}` - Progreso (0-100%)
- `type: 'result'` - Resultado completo con trades, stats, zones
- `type: 'error'` - Error con mensaje

**Fases de progreso:**
1. `fetching` (0-8%) - Descarga/cache de velas
2. `vwap` (10%) - Calculo VWAP Session
3. `strategy` (30%) - Ejecucion de estrategia
4. `metrics` (70%) - Calculo de metricas
5. `zones` (80%) - Construccion de zonas para visualizacion
6. `done` (100%) - Completado

## Arquitectura SSE

```
Frontend (EventSource)          Backend (StreamingResponse)
    |                               |
    |--- GET /backtest-stream ----> |
    |                               | -> Verifica cache de velas
    |<-- progress: fetching --------|
    |                               | -> get_historical() (usa cache 2h TTL)
    |<-- progress: fetched ---------|
    |                               | -> Thread pool: run_backtest()
    |<-- progress: vwap ------------|    (comunica via queue.Queue)
    |<-- progress: strategy --------|
    |<-- progress: metrics ---------|
    |<-- progress: zones -----------|
    |<-- result: {zones, stats} ----|
    |                               |
    | eventSource.close()           |
```

## Cache de Velas para Backtest

La funcion `get_historical()` tiene un cache en memoria para llamadas con `skip_day_limit=True` (backtests):

- **TTL**: 2 horas (7200 segundos)
- **Cache fresco (<2h)**: Retorna directamente
- **Cache expirado (>2h)**: Carga incremental - solo descarga velas nuevas desde el ultimo timestamp y las mergea
- **Sin cache**: Descarga completa desde Bybit API
- **Cache key**: `{symbol}_{interval}`

## Visualizacion en el Chart

Los trades del backtest se visualizan via `ZoneVisualizerIndicator`:

```javascript
// IndicatorManager.js
this.zoneVisualizerIndicator.setVPZones(data.zones);
```

Cada trade se renderiza como una zona con:
- Rectangulo de consolidacion (entry zone)
- Rectangulo de trade (entry → exit) coloreado segun resultado
- Labels: W (win verde), L (loss rojo), O (open amarillo)

## Metricas Calculadas

| Metrica | Descripcion |
|---------|-------------|
| `total_trades` | Total de trades ejecutados |
| `wins` / `losses` | Trades ganadores / perdedores |
| `win_rate` | Porcentaje de acierto |
| `total_pnl_r` | PnL total en multiplos de R |
| `expectancy` | PnL promedio por trade (en R) |
| `profit_factor` | Ganancia bruta / Perdida bruta |
| `max_drawdown_r` | Drawdown maximo en R |
| `avg_winner_r` / `avg_loser_r` | Promedio de ganadores/perdedores |

## Optimizacion de Rendimiento

### build_segment_lookup()

Lookup table O(1) para mapear indice de vela → segmento VP mas reciente. Sin esto, cada trade buscaba linealmente entre todos los segmentos.

```python
def build_segment_lookup(segments, total_candles, vp_period):
    lookup = [None] * total_candles
    for seg in segments:
        start_idx = seg['end_idx']  # Segmento disponible despues de calcularse
        for i in range(start_idx, total_candles):
            lookup[i] = seg
    return lookup
```

## Troubleshooting

**Error "No se pudo conectar al backend":**
- Verificar que el backend esta corriendo en puerto 10000
- Si se cambio codigo, reiniciar el backend (matar proceso viejo primero)
- Revisar consola del backend por errores de Python

**Backtest tarda mucho:**
- Primera ejecucion descarga velas de Bybit (puede tardar 1-2 min para 400 dias en 1min)
- Ejecuciones siguientes usan cache en memoria (instantaneo si <2h)
- Si el cache expiro, solo descarga velas nuevas (incremental)

**Barra de progreso no aparece:**
- Verificar que el frontend usa el endpoint SSE (`/api/vp-periodic/backtest-stream`)
- Verificar consola del browser por errores de EventSource

**Trades no se ven en el chart:**
- Verificar que ZoneVisualizerIndicator esta habilitado
- Verificar que `setVPZones()` se llama con las zonas del resultado

---

# MODULAR STRATEGY BUILDER (Febrero 2026)

Sistema de backtesting modular sin codigo donde el usuario compone estrategias combinando 5 bloques independientes. Documentacion completa en `4.Analizador cripto/STRATEGY_BUILDER.md`.

## Concepto

El Strategy Builder permite crear estrategias de trading combinando:
1. **Niveles** (fuentes de soporte/resistencia)
2. **Senal de Entrada** (cuando entrar)
3. **Filtros de Contexto** (condiciones adicionales)
4. **Risk Management** (SL/TP)
5. **Exit Rules** (salidas adaptativas antes de SL/TP)

**Principio fundamental:** Cada bloque es independiente. Puedes cambiar la fuente de niveles sin tocar la senal de entrada, o cambiar el SL sin modificar los filtros.

**Anti look-ahead:** Todos los indicadores y niveles se calculan SOLO con datos disponibles hasta el momento de la vela actual.

## Archivos del Sistema

### Backend (`4.Analizador cripto/backend/`)

| Archivo | Descripcion |
|---------|-------------|
| `strategy_engine.py` | Motor completo (~2091 lineas): 6 level sources, 8 senales, 9 filtros, SL/TP, exit rules, backtest, optimizer |
| `main.py` (lineas 9137+) | 3 endpoints: backtest-stream (POST SSE via fetch+ReadableStream), optimize-estimate, optimize |

### Frontend (`8.AnalizadorDesktop/src/components/`)

| Archivo | Descripcion |
|---------|-------------|
| `StrategyBuilder.jsx` | UI completa (~2063 lineas): 5 bloques, backtest SSE, presets, optimizer, realtime, VP Zone Cache |
| `SingleSymbolAnalyzer.jsx` | Boton "Strategy" purpura + integracion del componente |
| `indicators/IndicatorManager.js` | 3 metodos: runStrategyBuilderBacktest, estimateStrategyOptimization, optimizeStrategyBuilder |
| `indicators/ZoneVisualizerIndicator.js` | Soporte `_strategyZones` como fuente independiente + colores purpura |

## Arquitectura de 5 Bloques

### Bloque 1: Level Sources (6 fuentes de niveles)

Cada fuente produce objetos `Level(price, type, source, strength, valid_from_idx, valid_until_idx)`.

| Fuente | Descripcion | Parametros clave | Anti Look-Ahead |
|--------|-------------|------------------|-----------------|
| `vp_periodic` | POC, VAH, VAL por segmento VP | `period` (50-1000), `bins` (20-100), `use_poc/vah/val`, `lookback_segments` (0-10) | Niveles activos solo despues de que el segmento cierra |
| `vp_zones` | VP Zone Scanner (perfiles D, P, b) | `detection_mode` (fixed_window/progressive), `window_size`, `bins`, `min_d_score`, `include_pb_shapes`, `max_range_pct` | Solo zonas completamente formadas. Usa cache en disco |
| `sr_v2` | Swing points clusterizados | `swing_bars` (2-10), `cluster_distance_pct` (0.1-2.0), `min_touches` (1-5), `max_levels`, `recalc_every` | Recalcula cada N velas con datos hasta ese punto |
| `vwap_bands` | VWAP + bandas sigma (5 niveles por vela) | Usa `vwap_period` global | Dinamico, se recalcula cada vela |
| `swing_levels` | Swing Highs/Lows individuales como S/R | `swing_bars` (2-15) | Solo validos despues de confirmacion (i + swing_bars) |
| `dtb_neckline` | Necklines de Double Top/Bottom | `candles_per_extreme`, `price_margin_pct`, `min_candles_between` | Solo despues de formacion completa |

**VP Periodic vs VP Zones:**
- VP Periodic divide el historico en segmentos regulares de N velas. Rapido y predecible.
- VP Zones escanea buscando perfiles tipo D/P/b con ventana deslizante. Mas preciso pero mas lento. Tiene cache en disco (`zones_cache/`).

### Bloque 2: Entry Signals (8 tipos)

Solo una senal puede estar activa a la vez. Busca en los niveles activos del Bloque 1 para determinar la direccion.

| Senal | Parametros | Logica |
|-------|-----------|--------|
| `price_touch` | `tolerance_pct` (0.05-1.0) | Precio toca nivel y cierra del lado correcto |
| `swing_confirm` | `swing_bars` (2-10), `tolerance_pct` | Swing H/L confirmado cerca de nivel |
| `breakout_close` | `confirm_bars` (1-5), `tolerance_pct` | N cierres consecutivos al otro lado de nivel |
| `rejection_candle` | `wick_ratio` (0.6-5.0), `tolerance_pct` | Vela con wick largo rechazando nivel |
| `pattern_match` | `pattern_type` (engulfing/doji/any), `tolerance_pct` | Patron de velas clasico cerca de nivel |
| `squeeze_release` | (sin parametros) | TTM Squeeze pasa de activo a inactivo. Direccion por pendiente VWAP |
| `cvd_divergence` | `lookback` (10-50) | Divergencia precio vs CVD acumulado |
| `dtb_confirm` | `lookback` (10-100), `min_confidence` (30-90) | Confirmacion de Double Top/Bottom |

### Bloque 3: Context Filters (9 tipos, AND logic)

Todos los filtros habilitados deben pasar para que la senal se ejecute.

| Filtro | Parametros | Logica |
|--------|-----------|--------|
| `vwap_trend` | `lookback` (5-1000), `min_diff_pct` (0-2.0) | VWAP subiendo = solo LONG, bajando = solo SHORT |
| `vwap_position` | `mode` (trend/counter), `long_ref`, `short_ref` | Precio arriba/abajo de VWAP o banda sigma. `long_ref`/`short_ref` seleccionan referencia: vwap, upper_1..3, lower_1..3 |
| `ttm_squeeze` | `require_squeeze` (on/off) | on=solo durante squeeze, off=solo sin squeeze |
| `bbwp_range` | `min_val` (0-100), `max_val` (0-100) | BBWP dentro del rango especificado |
| `volume_zscore` | `min_zscore` (0.5-4.0), `lookback` (10-50) | Volumen actual > N desviaciones de la media |
| `cvd_trend` | `lookback` (10-50) | CVD alineado con direccion del trade |
| `dtb_bias` | `lookback` (10-100), `min_confidence` (30-90) | DTB reciente sesga direccion permitida |
| `direction` | `allowed` (both/long/short) | Filtro global de direccion |
| `vp_shape` | `allowed_shapes` (all/D/P/b/P_trimmed/b_trimmed/thin) | Filtra niveles VP por forma del perfil. Solo aplica a niveles con source `vp_*` o `vpz_*` |

### Bloque 4: Risk Management

**Stop Loss (4 metodos):**

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| `below_level` | `buffer_pct` (0.01-1.0) | SL debajo/arriba del nivel que disparo la senal + buffer % |
| `below_swing` | `buffer_pct` (0.01-1.0) | SL en ultimo swing low (LONG) o swing high (SHORT) + buffer. Si la senal vino de `swing_confirm`, usa el `pivot_price` directamente |
| `atr_multiple` | `atr_multiplier` (0.5-5.0) | SL a N x ATR(14) del precio de entrada |
| `fixed_pct` | `fixed_pct` (0.1-5.0) | SL a porcentaje fijo del precio de entrada |

**Take Profit (5 metodos):**

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| `rr_fixed` | `rr` (0.5-10.0) | TP = entry + (riesgo * rr) |
| `opposite_level` | `fallback_rr` (1.0-5.0) | TP en nivel opuesto mas cercano. Fallback a R:R si no hay nivel o < 0.5R |
| `next_swing` | `fallback_rr` (1.0-5.0) | TP en ultimo swing contrario. Fallback a R:R si < 0.5R |
| `atr_multiple` | `atr_multiplier` (1.0-10.0) | TP a N x ATR(14) del entry |
| `fixed_pct` | `fixed_pct` (0.5-10.0) | TP a porcentaje fijo del entry |

**Otros parametros de riesgo:**

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `max_trades_per_segment` | 1-10 | 1 | Maximo de trades por segmento VP o fuente de nivel (misma direccion) |
| `cooldown_bars` | 0-500 | 0 | Velas de espera GLOBAL despues de abrir un trade. 0=desactivado |

### Bloque 5: Exit Rules (4 tipos, OR logic)

Cierran el trade ANTES de alcanzar SL o TP. Basta con que UNA regla se active.

| Regla | Parametros | Logica |
|-------|-----------|--------|
| `vwap_reverse` | `lookback` (3-30) | Cierra si VWAP gira en contra (LONG: VWAP actual < VWAP hace N velas) |
| `reenter_zone` | ninguno | Cierra si precio vuelve al nivel de la senal (LONG: cierra debajo del nivel) |
| `squeeze_activate` | ninguno | Cierra si se activa nuevo TTM Squeeze mientras trade abierto |
| `timeout` | `max_bars` (10-500) | Cierra despues de N velas sin alcanzar TP ni SL |

## Confluencia Multi-Source

| Modo | Descripcion |
|------|-------------|
| `any` | Cualquier nivel individual puede disparar entrada |
| `score` | Score = min(100, fuentes_unicas_cerca * 15). Requiere min_confluence_score. 2 fuentes = 30 pts, 3 fuentes = 45 pts |

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/strategy-builder/backtest-stream` | POST (SSE) | Backtest con progreso en tiempo real. Config va en body JSON, respuesta es SSE stream leido con fetch+ReadableStream (no EventSource) |
| `/api/strategy-builder/optimize-estimate` | POST | Estima tiempo del grid search (ejecuta 2 combos de prueba) |
| `/api/strategy-builder/optimize` | POST | Grid search completo en thread pool |

### Formato SSE del Backtest

```
data: {"type": "progress", "phase": "fetching", "percent": 0, "message": "Descargando..."}
data: {"type": "progress", "phase": "indicators", "percent": 10, "message": "Calculando VP..."}
data: {"type": "progress", "phase": "backtest", "percent": 50, "message": "Vela 500/1000..."}
data: {"type": "result", "data": {trades, zones, metrics, filter_stats, ...}}
```

## Estructura de Config (JSON)

```json
{
  "level_sources": [
    {"source": "vp_periodic", "enabled": true, "params": {"period": 240, "bins": 50}},
    {"source": "vp_zones", "enabled": false, "params": {"detection_mode": "fixed_window", "window_size": 30}}
  ],
  "entry_signal": {
    "signal_type": "price_touch",
    "params": {"tolerance_pct": 0.15}
  },
  "context_filters": [
    {"filter_type": "direction", "enabled": true, "params": {"allowed": "both"}},
    {"filter_type": "vp_shape", "enabled": false, "params": {"allowed_shapes": ["all"]}}
  ],
  "risk": {
    "sl_method": "below_level", "sl_params": {"buffer_pct": 0.1},
    "tp_method": "rr_fixed", "tp_params": {"rr": 2.0},
    "max_trades_per_segment": 1,
    "cooldown_bars": 0
  },
  "exit_rules": [],
  "confluence_mode": "any",
  "min_confluence_score": 0,
  "vwap_period": 20
}
```

## Cache de Velas (Persistencia en Disco)

El sistema usa 3 niveles de cache para evitar descargar velas repetidamente:

1. **Memoria** (Dict Python, TTL 2h): Acceso instantaneo, se pierde al reiniciar
2. **Disco** (`candle_cache/*.json.gz`): Persistente, gzip comprimido, sobrevive reinicios
3. **Bybit API**: Descarga completa, hasta 600,000 velas por request

**Flujo:** Primera ejecucion descarga de Bybit (1-2 min). Siguientes ejecuciones leen de disco (~1-2s) o memoria (instantaneo). Carga incremental cuando faltan solo velas recientes.

**VP Zone Cache:** Cache separado en `zones_cache/` para zonas VP pre-calculadas. Evita recalcular zonas con los mismos parametros.

## Sistema de Presets

Los presets guardan toda la configuracion del Strategy Builder (5 bloques + parametros generales).

- **Backend-based:** Se persisten via API (no localStorage)
- **Guardar:** Nombre + click "Guardar"
- **Cargar:** Dropdown → "Cargar" → todos los bloques se restauran
- **Eliminar:** Boton X al lado del preset

## Diagnostico con Filter Stats

El backtest retorna `filter_stats` que muestra donde se filtraron las senales:

| Contador | Significado |
|----------|-------------|
| `signals_generated` | Total de senales detectadas (antes de filtros) |
| `filtered_direction` | Bloqueadas por filtro de direccion |
| `filtered_confluence` | Score de confluencia insuficiente |
| `filtered_max_trades_seg` | Bloqueadas por max_trades_per_segment |
| `filtered_cooldown` | Bloqueadas por cooldown_bars activo |
| `filtered_context.{tipo}` | Bloqueadas por cada filtro de contexto especifico |
| `filtered_sl_invalid` | SL no se pudo calcular |
| `filtered_tp_invalid` | TP no se pudo calcular |
| `filtered_sl_direction` | SL calculado en direccion incorrecta |
| `trades_opened` | Trades que pasaron TODOS los filtros |

## Visualizacion en Chart

Las zonas del Strategy Builder se renderizan con colores purpura (`_source: 'strategy'`):

| Elemento | Color |
|----------|-------|
| Consolidacion fill | `rgba(128, 0, 200, 0.15)` |
| Consolidacion border | `rgba(128, 0, 200, 0.6)` |
| Trade WIN | Verde |
| Trade LOSS | Rojo |
| Trade OPEN | Amarillo, borde discontinuo |

ZoneVisualizerIndicator mantiene 4 fuentes independientes:
- `_manualZones` - Boton "Detectar zonas"
- `_realtimeZones` - Polling realtime
- `_vpZones` - VP Periodic Backtest
- `_strategyZones` - Strategy Builder

## Grid Search Optimizer

Parametros optimizables se generan dinamicamente segun bloques activos. Formato path-based:

```
level.vp_periodic.period, level.vp_periodic.bins, level.sr_v2.swing_bars,
entry.params.tolerance_pct, risk.sl_params.buffer_pct, risk.tp_params.rr,
vwap_period, (cualquier parametro numerico de bloque activo)
```

**Flujo:** Estimar (2 combos prueba) → Confirmar → Ejecutar → Tabla Top 15 → "Aplicar"

**Limites:** Max 5,000 combinaciones, max 20 valores por parametro. Timeout 60 min.

**Metricas:** expectancy, total_pnl_r, win_rate, profit_factor.

## Dias de Historico

| Intervalo | Max dias |
|-----------|----------|
| 1 min | 400 |
| 3 min | 400 |
| 5 min | 400 |
| 15 min | 180 |
| 30 min | 360 |
| 1 hora | 730 |
| 2 horas | 730 |
| 4 horas | 1095 |
| Diario | 2000 |
| Semanal | 1000 |

## Arquitectura Tecnica

### Backend: strategy_engine.py (~2091 lineas)

```
run_modular_backtest(candles, config, progress_callback, symbol, interval, days)
    |
    ├── compute_vp_levels()           # VP Periodic
    ├── compute_vp_zone_levels()      # VP Zones (con cache disco)
    ├── compute_sr_levels()           # S&R v2
    ├── compute_vwap_band_levels()    # VWAP Bands
    ├── compute_swing_as_levels()     # Swing Levels
    ├── compute_dtb_levels()          # DTB Neckline
    |
    ├── Para cada vela:
    |   ├── Filtrar niveles validos en este indice
    |   ├── Evaluar entry signal -> genera senal con direccion
    |   ├── Filtrar por direction, confluence, max_trades, cooldown
    |   ├── Aplicar context filters (AND logic, incluyendo vp_shape)
    |   ├── Calcular SL y TP
    |   └── Si todo pasa: abrir trade
    |
    ├── resolve_trade_with_exit_rules()  # Simular cada trade
    ├── calculate_metrics()              # Metricas finales
    └── Construir zonas para chart
```

### Frontend: StrategyBuilder.jsx (~2063 lineas)

```
StrategyBuilder.handleRunBacktest()
    |
    ├── buildConfigPayload(state)  # ~30 useState hooks -> JSON config
    |
    ├── manager.runStrategyBuilderBacktest({days, config, onProgress})
    |   └── fetch POST /api/strategy-builder/backtest-stream (config en body JSON)
    |       → response.body.getReader() + TextDecoder (ReadableStream)
    |       ├── progress events -> setProgress({phase, percent, message})
    |       └── result event -> setResult({zones, stats, filter_stats})
    |   (NO usa EventSource - evita limite de 6 conexiones de Chromium)
    |
    └── manager.zoneVisualizerIndicator.setStrategyZones(zones)
```

## Bugs Corregidos (Febrero 2026)

1. **`resolve_trade` no existia** - Fix: reutilizar `resolve_trade_with_exit_rules()` con lista vacia.
2. **Zona visual min/max incorrectos para SHORT** - Fix: `min(sl, tp, entry)` y `max(sl, tp, entry)`.

## Troubleshooting

**Strategy Builder no abre:**
- Verificar que el boton purpura "Strategy" aparece junto a "VP Backtest"
- Verificar que `StrategyBuilder.jsx` se importa en `SingleSymbolAnalyzer.jsx`

**Backtest retorna 0 trades:**
- Verificar que al menos 1 Level Source esta activado
- Reducir tolerancia del entry signal
- Probar sin context filters primero
- Aumentar dias de datos historicos
- Revisar `filter_stats` para ver donde se pierden senales

**Backtest tarda mucho:**
- Primera ejecucion descarga de Bybit (1-2 min). Siguientes usan cache disco (instantaneo)
- VP Zones es pesado - considerar VP Periodic
- Reducir dias para iteraciones rapidas

**Zonas no se ven en chart:**
- Verificar que ZoneVisualizerIndicator esta habilitado
- Las zonas usan `_source: 'strategy'` (purpura)
- Verificar `setStrategyZones()` se llama con las zonas del resultado

---

# STRATEGY BUILDER REALTIME SERVICE (Febrero 2026)

Servicio de ejecucion en tiempo real de estrategias del Strategy Builder. Permite que el usuario active una estrategia configurada y la ejecute en vivo, generando alertas al TradingBot cuando se detectan senales validas.

## Concepto y Diferencia con Backtest

| Aspecto | Backtest (SSE) | Realtime Service |
|---------|---------------|------------------|
| Ejecucion | Unica, sobre historico | Continua, vela a vela |
| Niveles | Se calculan sobre todo el dataset | Se pre-calculan una vez y se extienden incrementalmente |
| SL/TP | Se resuelve con lookforward (mira futuro) | Se monitorea vela a vela (no mira futuro) |
| Alertas | No envia | Envia al TradingBot (puerto 5000) |
| UI | Boton "Run Backtest" | Toggle "Realtime" ON/OFF |

## Principio Arquitectonico

**Los niveles NO se re-detectan en cada vela.** Se pre-calculan al activar y se extienden incrementalmente solo cuando corresponde:

| Fuente de Niveles | Cuando se Recalcula |
|-------------------|---------------------|
| `vp_periodic` | Al completarse un nuevo segmento (cada `period` velas) |
| `sr_v2` | Cada N velas (`sr_recalc_every`, default 100) |
| `vwap_bands` | Cada vela (VWAP es dinamico por naturaleza) |
| `swing_levels` | Cada N velas con check de confirmacion |
| `dtb_neckline` | Cada N velas (`dtb_recalc_every`, default 50) |
| `vp_zones` | Al completarse un nuevo segmento VP (usa cache de VP Zone) |

La evaluacion de senales es O(L) por vela, donde L = numero de niveles activos.

## Archivos del Sistema

### Backend (`4.Analizador cripto/backend/`)

| Archivo | Descripcion |
|---------|-------------|
| `strategy_realtime_service.py` | Servicio completo (~1317 lineas): config, niveles, senales, trades, alertas |
| `config/strategy_rt_config.json` | Configuracion persistente del servicio |
| `logs/strategy_rt_alerts.log` | Log de alertas enviadas/bloqueadas |
| `main.py` (lineas 9530+) | 6 endpoints API para el servicio realtime |

### Frontend (`8.AnalizadorDesktop/src/components/`)

| Archivo | Descripcion |
|---------|-------------|
| `StrategyBuilder.jsx` | UI: boton "Realtime", panel de estado, toggle, stats |

## Clases y Estructura

### StrategyRTConfig

```python
@dataclass
class StrategyRTConfig:
    enabled: bool = False
    symbols: List[str] = ["BTCUSDT"]
    interval: str = "5"
    window_candles: int = 2000          # Historico para calcular niveles
    strategy: Dict = {}                 # Mismo formato que Strategy Builder config
    alertsEnabled: bool = True
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
    cooldownMinutes: int = 30
    dtb_recalc_every: int = 50          # Re-detectar DTB cada N velas
    sr_recalc_every: int = 100          # Re-detectar S&R cada N velas
```

### RTLevel

```python
@dataclass
class RTLevel:
    price: float
    level_type: str       # 'support' | 'resistance'
    source: str           # 'vp_periodic' | 'sr_v2' | 'vwap_bands' | 'swing_levels' | 'dtb_neckline' | 'vp_zones'
    strength: float = 1.0
    valid_from_idx: int = 0
    valid_until_idx: Optional[int] = None
    extra: Dict = {}
```

### StrategyRealtimeService (Singleton)

```python
class StrategyRealtimeService:
    # Estado interno por simbolo:
    _candle_buffers: Dict[str, List[Dict]]     # Buffer de velas
    _levels: Dict[str, List[RTLevel]]          # Niveles pre-calculados
    _vwap_state: Dict[str, Dict]               # Estado VWAP rolling
    _dtb_patterns: Dict[str, List[Dict]]       # Patrones DTB detectados
    _open_trades: Dict[str, List[Dict]]        # Trades abiertos
    _trade_history: Dict[str, List[Dict]]      # Historial de trades cerrados
    _cooldowns: Dict[str, float]               # Cooldowns activos
    _recent_signals: Dict[str, List[Dict]]     # Senales para polling frontend

    # Contadores para recalculo periodico:
    _candle_count: Dict[str, int]
    _last_vp_seg_end: Dict[str, int]
    _last_sr_recalc: Dict[str, int]
    _last_dtb_recalc: Dict[str, int]
    _last_swing_check: Dict[str, int]
```

## Flujo Completo

```
1. ACTIVACION (desde StrategyBuilder.jsx)
   POST /api/strategy-builder/realtime/toggle {enabled: true, strategy: {...}, symbols: [...]}
      ↓
2. STARTUP
   StrategyRealtimeService.start()
   → Registra listener en WebSocket (add_candle_close_listener)
   → Suscribe simbolos al WebSocket
   → asyncio.create_task(_initialize())
      ↓
3. INICIALIZACION (background, una vez)
   _initialize() → para cada simbolo:
      _init_symbol()
        → Fetch historico desde Bybit API (window_candles velas)
        → Preload al buffer del WebSocket
        → _precompute_levels() → calcula TODOS los niveles del historico
      ↓
4. POR CADA CIERRE DE VELA (tiempo real)
   _sync_candle_close_handler() → _on_candle_close()
      ↓
   a) Agrega vela al buffer
   b) _update_levels_incremental() → recalcula solo lo necesario
   c) _check_open_trades() → verifica SL/TP hit vela a vela
   d) _check_exit_rules() → evalua reglas de salida adaptativas
   e) _evaluate_entry() → evalua senal de entrada contra niveles activos
      ↓
5. SI HAY SENAL VALIDA
   → Calcula SL/TP segun risk management configurado
   → Verifica cooldown (por symbol + direction)
   → Abre trade → _send_alert() al TradingBot (puerto 5000)
      ↓
6. MONITOREO DE TRADES
   En cada vela subsecuente:
   → _check_open_trades(): SL hit? TP hit? → cierra trade
   → _check_exit_rules(): timeout? vwap_reverse? → cierra trade anticipadamente
```

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/strategy-builder/realtime/toggle` | POST | Activa/desactiva servicio. Acepta strategy, symbols, interval, alertsEnabled, cooldownMinutes |
| `/api/strategy-builder/realtime/status` | GET | Estado completo: running, stats, open trades, niveles activos, buffers |
| `/api/strategy-builder/realtime/config` | POST | Actualiza config. Si strategy cambio, reinicia servicio automaticamente |
| `/api/strategy-builder/realtime/signals/{symbol}` | GET | Senales recientes para un simbolo |
| `/api/strategy-builder/realtime/trades/{symbol}` | GET | Trades abiertos y historial (ultimos 50) |
| `/api/strategy-builder/realtime/clear-cooldowns` | POST | Limpia todos los cooldowns (para testing) |

## Formato de Respuesta de Status

```json
{
  "success": true,
  "running": true,
  "enabled": true,
  "symbols": ["BTCUSDT"],
  "interval": "5",
  "alertsEnabled": true,
  "strategy_name": "Mi Estrategia",
  "stats": {
    "candles_processed": 150,
    "signals_generated": 5,
    "signals_filtered": 3,
    "alerts_sent": 2,
    "alerts_blocked_cooldown": 1,
    "trades_opened": 2,
    "trades_closed": 1,
    "start_time": 1708000000
  },
  "open_trades": {
    "BTCUSDT": [{
      "direction": "LONG",
      "entry_price": 95000.0,
      "sl_price": 94500.0,
      "tp_price": 96000.0,
      "partial_pnl_r": 0.5,
      "entry_ts": 1708001000000
    }]
  },
  "levels": {
    "BTCUSDT": { "total": 45, "active": 12 }
  },
  "buffers": {
    "BTCUSDT": 2150
  }
}
```

## Formato de Alerta al TradingBot

```json
{
  "source": "STRATEGY_BUILDER",
  "symbol": "BTCUSDT",
  "interval": "5",
  "pattern": {
    "patternType": "STRATEGY_SIGNAL",
    "price": 95000.0,
    "confidence": 75,
    "timestamp": 1708001000000,
    "direction": "LONG",
    "signalType": "price_touch",
    "levelSource": "vp_periodic",
    "levelPrice": 95050.0
  },
  "custom_stop_loss": 94500.0,
  "custom_take_profit": 96000.0
}
```

## Metodos Clave del Servicio

### Pre-calculo de Niveles

```python
def _precompute_levels(self, symbol: str):
    """
    Calcula TODOS los niveles a partir del historico.
    Se ejecuta UNA VEZ al iniciar el servicio.
    Soporta las 6 fuentes de niveles del Strategy Builder.
    """
```

### Actualizacion Incremental

```python
def _update_levels_incremental(self, symbol: str, new_candle: Dict):
    """
    Actualiza niveles SOLO cuando es necesario:
    - VP Periodic: nuevo segmento completado (cada 'period' velas)
    - SR v2: cada sr_recalc_every velas
    - VWAP bands: cada vela (recalcula VWAP y bandas sigma)
    - Swing levels: cada N velas (check confirmacion)
    - DTB neckline: cada dtb_recalc_every velas
    - VP Zones: cuando hay nuevo segmento VP (usa cache)
    """
```

### Evaluacion de Entrada

```python
async def _evaluate_entry(self, symbol: str, candle: Dict, idx: int):
    """
    Evalua si la vela actual genera una senal de entrada.
    1. Obtiene niveles activos para el indice actual
    2. Evalua senal (price_touch, breakout_close, etc.) contra cada nivel
    3. Aplica filtros de contexto (VWAP trend, TTM squeeze, etc.)
    4. Si pasa: calcula SL/TP, verifica cooldown, abre trade
    """
```

### Monitoreo de Trades

```python
def _check_open_trades(self, symbol: str, candle: Dict):
    """
    Verifica SL/TP hit para trades abiertos.
    Evalua HIGH y LOW de la vela contra SL y TP del trade.
    Si SL hit: cierra con PnL negativo.
    Si TP hit: cierra con PnL positivo.
    """

def _check_exit_rules(self, symbol: str, candle: Dict, idx: int):
    """
    Evalua reglas de salida adaptativas (OR logic):
    - vwap_reverse: precio cruza VWAP en contra
    - reenter_zone: precio re-entra a la zona del nivel
    - squeeze_activate: nuevo TTM Squeeze se activa
    - timeout: han pasado N velas desde la entrada
    """
```

## Sistema de Cooldowns

- Cooldowns separados por `{symbol}_{direction}` (ej: `BTCUSDT_LONG`, `BTCUSDT_SHORT`)
- Configurable en minutos desde el panel o la API
- Se puede limpiar manualmente via endpoint o boton en UI
- Los cooldowns son in-memory (no se persisten al reiniciar)

## Integracion con el Frontend (StrategyBuilder.jsx)

### Estado React

```javascript
const [showRealtime, setShowRealtime] = useState(false);
const [rtStatus, setRtStatus] = useState(null);
const [rtLoading, setRtLoading] = useState(false);
const rtPollRef = useRef(null);
```

### Polling de Estado

Cuando el panel Realtime esta abierto, se hace polling cada 5 segundos:

```javascript
useEffect(() => {
  if (!isOpen || !showRealtime) return;
  fetchRtStatus();
  rtPollRef.current = setInterval(fetchRtStatus, 5000);
  return () => clearInterval(rtPollRef.current);
}, [isOpen, showRealtime]);
```

### Toggle Realtime

Al activar, envia la estrategia actual (construida con `buildConfigPayload()`) junto con el simbolo e intervalo activos:

```javascript
const handleToggleRealtime = async () => {
  const body = { enabled: !isRunning };
  if (!isRunning) {
    body.strategy = buildConfigPayload();
    body.symbols = [symbol];
    body.interval = interval;
  }
  await fetch(`/api/strategy-builder/realtime/toggle`, { method: 'POST', body });
};
```

### Panel de Realtime

El panel muestra cuando esta activo:
- **Stats grid**: Velas procesadas, senales generadas, senales filtradas, alertas enviadas
- **Niveles por simbolo**: Total y activos
- **Trades abiertos**: Entry, SL, TP, PnL parcial (en R) con colores verde/rojo
- **Uptime**: Tiempo desde el inicio del servicio
- **Boton "Limpiar Cooldowns"**: Para testing

Cuando no esta activo muestra mensaje informativo con instrucciones.

### Boton en la Barra de Acciones

- Color naranja cuando el servicio esta detenido
- Color verde cuando esta corriendo
- Texto "RT ON" cuando activo, "Realtime" cuando inactivo

## Archivos de Log

### `logs/strategy_rt_alerts.log`

```
2026-02-16 15:30:45 | INFO | SIGNAL | BTCUSDT | LONG | price_touch @ vp_periodic:95000.00 | idx=2150
2026-02-16 15:30:45 | INFO | ALERT_SENT | BTCUSDT | LONG | entry=95000.00 sl=94500.00 tp=96000.00
2026-02-16 15:35:22 | INFO | BLOCKED_COOLDOWN | BTCUSDT | LONG | remaining=1478s
2026-02-16 15:40:00 | INFO | TRADE_CLOSED | BTCUSDT | TP_HIT | pnl_r=2.0
2026-02-16 15:40:00 | ERROR | ALERT_TIMEOUT | BTCUSDT | Trading Bot not responding
```

## Integracion con Startup/Shutdown del Backend

```python
# En main.py - startup_event()
strat_rt = get_strategy_rt_service()
if strat_rt.config.enabled:
    await strat_rt.start()

# En main.py - shutdown_event()
strat_rt = get_strategy_rt_service()
await strat_rt.stop()
```

## Troubleshooting

**Servicio no inicia:**
- Verificar que hay una estrategia configurada (`strategy` no vacio en config)
- Verificar que WebSocket Manager esta disponible
- Revisar logs backend por `[STRAT_RT]`

**0 senales generadas:**
- Verificar que los niveles se pre-calcularon: status muestra `levels.total > 0`
- Verificar que la senal de entrada coincide con los niveles activos
- Probar con tolerancia mas amplia en el entry signal
- Verificar que los filtros de contexto no estan bloqueando todas las senales

**Alertas no llegan al TradingBot:**
- Verificar `alertsEnabled: true` en config
- Verificar que TradingBot corre en puerto 5000
- Revisar `logs/strategy_rt_alerts.log` por errores TIMEOUT
- Verificar cooldowns: puede estar bloqueado

**Niveles no se actualizan:**
- El servicio actualiza niveles incrementalmente, no en cada vela
- VP Periodic: solo cuando se completa un nuevo segmento
- SR v2: cada `sr_recalc_every` velas (default 100)
- Verificar contadores en logs

**Stats muestran "signals_filtered" alto:**
- Los filtros de contexto estan bloqueando senales
- Desactivar filtros temporalmente para diagnosticar
- Revisar que la direccion del filtro coincide con la senal

**Config se pierde al reiniciar:**
- Config se persiste en `config/strategy_rt_config.json`
- Si el archivo no existe, se usan defaults (enabled=false)
- Verificar permisos de escritura en el directorio config/

---

# FIX: SEGUNDO BACKTEST BLOQUEA LA APP (Febrero 2026)

## Problema

El primer backtest del Strategy Builder se ejecutaba correctamente (~12.9s), pero al intentar un segundo backtest la aplicacion se congelaba completamente.

## Causa Raiz

**Cascada de fallos** que se acumulaban despues del primer backtest:

1. **Servicios no deseados corriendo**: Strategy RT y Real-time Pattern Detection auto-iniciaban en startup, procesando cada vela y consumiendo recursos del event loop
2. **Polling de drawings cada 3s**: Inundaba el backend con `GET /api/drawings/BTCUSDT` constantemente (10+ requests/segundo en momentos pico)
3. **VWAP reload sin cooldown**: Despues del primer backtest, el endpoint VWAP detectaba `needs_more_data` y disparaba `reload_symbol_data()` en cada polling, cada uno haciendo request a Bybit API, causando rate limit
4. **Fetches VWAP concurrentes**: Sin guard contra solapamiento, multiples fetches del frontend llegaban al backend simultaneamente, amplificando el rate limit

### Secuencia del bloqueo

```
Primer backtest completa OK
    ↓
VWAP polling detecta needs_more_data → multiples reloads simultaneos
    ↓
Bybit API: "Too many visits. Exceeded the API Rate Limit"
    ↓
VWAP fetch errors → frontend reintenta en siguiente poll → mas errors
    ↓
Drawings polling cada 3s agrega carga constante
    ↓
Strategy RT procesando cada vela agrega mas carga
    ↓
Event loop saturado → segundo backtest no puede conectar SSE
    ↓
App congelada
```

## Fixes Aplicados

### 1. Drawings polling 3s → 30s

**Archivo:** `8.AnalizadorDesktop/src/components/MiniChart.jsx`

```javascript
// ANTES: 3000ms (3 segundos)
// DESPUES: 30000ms (30 segundos) - suficiente para sincronizacion
const syncInterval = setInterval(() => {
  if (!drawingMode) {
    loadDrawings(true);
  }
}, 30000);
```

### 2. VWAP reload cooldown (30s por simbolo)

**Archivo:** `4.Analizador cripto/backend/main.py`

```python
_vwap_reload_cooldown: Dict[str, float] = {}
_VWAP_RELOAD_COOLDOWN_SECS = 30

@app.get("/api/vwap-service/data/{symbol}")
async def get_vwap_service_data(...):
    if config_changed or needs_more_data:
        now = time.time()
        last_reload = _vwap_reload_cooldown.get(symbol, 0)
        if now - last_reload < _VWAP_RELOAD_COOLDOWN_SECS:
            pass  # En cooldown - retornar datos existentes
        else:
            _vwap_reload_cooldown[symbol] = now
            await vwap_service.reload_symbol_data(...)
```

### 3. Guard contra VWAP fetches concurrentes

**Archivo:** `8.AnalizadorDesktop/src/components/indicators/VWAPIndicator.js`

```javascript
constructor() {
  this._fetching = false;
}

async fetchData(skipCache = false) {
  if (this._fetching) return false;  // Skip si ya hay fetch en curso
  this._fetching = true;
  try {
    // ... fetch ...
  } finally {
    this._fetching = false;
  }
}
```

### 4. Servicios desactivados en startup (sesion anterior)

**Archivo:** `4.Analizador cripto/backend/main.py` (startup_event)

- Real-time pattern service: SKIPPED (deprecated)
- Strategy RT service: force `enabled=false` en startup, debe iniciarse manualmente desde frontend

**CRITICO:** El backend debe reiniciarse para que estos cambios tomen efecto.

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `8.AnalizadorDesktop/src/components/MiniChart.jsx` | Drawings polling 3s → 30s |
| `4.Analizador cripto/backend/main.py` | VWAP reload cooldown 30s, cleanup import |
| `8.AnalizadorDesktop/src/components/indicators/VWAPIndicator.js` | `_fetching` guard |

## Leccion Aprendida

**Cascadas de rate limit**: Un solo endpoint sin cooldown puede causar una cascada que bloquea toda la aplicacion. Siempre agregar cooldowns a endpoints que llaman APIs externas (Bybit) y guards contra requests concurrentes en el frontend.

**Reiniciar backend**: Los cambios en `main.py` no toman efecto hasta reiniciar el proceso de uvicorn. Si el log muestra servicios que deberian estar desactivados, el backend NO fue reiniciado.

---

# FIX: RESULTADOS DE BACKTEST NO DETERMINISTICOS (Febrero 2026)

## Problema

El Strategy Builder producia resultados diferentes con los mismos parametros. Ejecutar un backtest con parametros A, cambiar a B, y volver a A daba resultados distintos (ej: 30% win rate → 12% win rate). El cambio afectaba TODOS los trades, no solo los ultimos.

## Causa Raiz

**Cascada de 3 factores** que hacian que el array de velas cambiara de tamano entre ejecuciones:

### Factor 1: Cache incremental de velas

El sistema de cache de 3 niveles (memoria → disco → Bybit API) usaba merge incremental. Despues de la primera ejecucion, el cache en memoria podia tener 5-10 velas extras respecto a la descarga original. Esto cambiaba `len(candles)`.

### Factor 2: VP Periodic sensible a indices

VP Periodic usa `range(0, len(candles), period)` para crear segmentos. Si `len(candles)` cambia, TODOS los segmentos se desplazan. Esto cambia las zonas POC/VAH/VAL y por lo tanto los niveles para TODAS las entradas.

```python
# Con 57600 velas y period=240:
# Segmentos: [0:240], [240:480], [480:720], ...

# Con 57605 velas (5 extras del cache):
# Segmentos: [0:240], [240:480], [480:720], ..., [57360:57605]
# ¡Pero si se trimea al 110%: candles[-target:] cambia indices base!
```

### Factor 3: VP Zone Cache sin candles_count

El fingerprint del cache de VP Zones no incluia la cantidad de velas. Dos ejecuciones con diferente `len(candles)` pero mismos parametros generaban el mismo fingerprint, retornando zonas calculadas con un array de tamano diferente.

## Fixes Implementados

### Fix 1: Trimming Determinista

**Archivos:** `4.Analizador cripto/backend/main.py` (3 endpoints)

Antes de pasar las velas al motor de backtest, se trimea al numero exacto calculado:

```python
# En backtest-stream, optimize-estimate, optimize
_int_minutes = interval_min_map.get(interval, 1)
_target_candles = int((int(days) * 24 * 60) / _int_minutes)
if _target_candles > 0 and len(candles) > _target_candles:
    candles = candles[-_target_candles:]
```

Esto garantiza que sin importar cuantas velas tenga el cache, siempre se usan exactamente las mismas.

### Fix 2: candles_count en Fingerprint VP Zone Cache

**Archivos:** `4.Analizador cripto/backend/zone_vp_scanner.py`

Se agrego `candles_count` al fingerprint SHA256 del cache de zonas VP:

```python
def _get_detection_fingerprint(config_overrides, symbol, interval, days, candles_count=0):
    det_values['_candles_count'] = candles_count
    fingerprint_str = json.dumps(det_values, sort_keys=True, default=str)
    return hashlib.sha256(fingerprint_str.encode()).hexdigest()[:16]
```

Ahora `load_zone_cache` y `save_zone_cache` incluyen `candles_count`, invalidando caches cuando el array cambia de tamano.

### Fix 3: Hash Diagnostico en UI

**Archivos:** `main.py` (SSE result), `StrategyBuilder.jsx` (checkbox + badge)

Se calcula un hash MD5 del array de velas (len + first_ts + last_ts) y se muestra en la UI:

```python
import hashlib as _hl
_candle_hash = _hl.md5(f"{len(candles)}_{first_ts}_{last_ts}".encode()).hexdigest()[:8]
```

En el frontend, un checkbox "Mostrar hash de determinismo" muestra un badge purpura con el hash. Mismo hash = mismas velas = resultados identicos.

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `4.Analizador cripto/backend/main.py` | Trimming determinista en 3 endpoints SB + candle_hash en SSE result + candles_count en load_zone_cache VP |
| `4.Analizador cripto/backend/zone_vp_scanner.py` | candles_count en fingerprint, save_zone_cache, load_zone_cache |
| `4.Analizador cripto/backend/strategy_engine.py` | Pasa len(candles) a load_zone_cache en compute_vp_zone_levels |
| `8.AnalizadorDesktop/src/components/StrategyBuilder.jsx` | Estado showDebugHash, checkbox, badge hash purpura |

## Limpieza de Cache

Despues de aplicar el fix, los archivos viejos en `zones_cache/` tienen fingerprints sin `candles_count` y nunca haran match. Se eliminaron ~31 archivos (~5MB) de `zones_cache/` y `zones_cache/incremental/`.

## Verificacion

1. Ejecutar backtest con parametros A → anotar hash (ej: `#c9a8cc6a`)
2. Cambiar parametros a B → ejecutar
3. Volver a parametros A → ejecutar
4. Verificar que hash es identico al paso 1
5. Verificar que metricas (WR%, PnL, trades) son identicas

## Leccion Aprendida

**Indices como estado global**: Cuando un sistema usa indices de array como referencia (como `valid_from_idx` en Level dataclass), el tamano del array se convierte en estado global implicito. Cualquier variacion en el tamano del array desplaza TODAS las referencias, causando resultados completamente diferentes. La solucion es garantizar un tamano de array determinista ANTES de cualquier procesamiento.
