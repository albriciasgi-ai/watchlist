# CLAUDE.md - Watchlist Desktop

Este archivo proporciona contexto a Claude Code sobre la aplicacion Watchlist Desktop.

---

## Pruebas y Correcciones, Fases 1 y 2 (11 Noviembre 2026)

El usuario pidió probar App 7 "como la 8 y la 9" y, tras el diagnóstico, corregir las fases 1 y 2. App 7 usa el backend de App 2 (`2.WatchlistConIndicadores/backend`, puerto 8000), que era una versión vieja del de App 4 y 5. Se le trajo lo ya corregido en el backend de App 5 (11/11) y se arregló el frontend.

### Fase 1: dinero y seguridad

| Antes | Ahora | Dónde |
|-------|-------|-------|
| Abrir App 7 o cambiar de timeframe mandaba `POST /api/realtime/set-interval`: el WebSocket del backend pasaba a ese timeframe y el Swing (15m) se quedaba sin velas, sin avisar | App 7 ya no lo manda. Además el Swing fija sus canales (`require_channels`): ninguna página puede quitárselos | `Watchlist.jsx`, `websocket_manager.py` |
| Con "Swing Detector" marcado, cambiar timeframe o días mandaba `POST /api/swing/config {interval, days}`: el Swing de las 10 monedas pasaba a alertar en el timeframe del gráfico | El gráfico solo lee. En otro timeframe las flechas se calculan aparte (`displayOnly`). El backend solo cambia timeframe, monedas o encendido con `confirm: "CAMBIAR_ALERTAS"`, que manda el modal | `Watchlist.jsx`, `SwingDetectorIndicator.js`, `main.py` |
| No había forma explícita de cambiar el timeframe o las monedas de las alertas | Modal del Swing como en App 9: "Alertas al bot en Xm · el gráfico está en Ym" y botones con confirmación | `SwingDetectorSettings.jsx` |
| El Swing avisaba una vela tarde (o una antes), sin cooldown por moneda, sin relleno tras un corte y sin `sent_at` | Servicio Swing del backend de App 5 (índice por la vela cerrada, `BLOCKED_GAP/STALE/NO_VWAP`, cooldown por moneda guardado, espera de 120 s) con origen `WATCHLIST`. WebSocket con relleno tras cortes | `swing_service.py`, `websocket_manager.py` |
| `swing_config.json` cortado o con un campo nuevo dejaba el Swing en 1m, BTC y ETH, con alertas encendidas | Archivo ilegible: Swing sin alertas y copia `swing_config.ilegible-*.json`. Campo desconocido: se ignora ese campo | `swing_service.py` |
| "Test 1x" mandaba una alerta real sin preguntar; `/api/pattern-alert` mandaba con todo apagado y un tipo desconocido salía como LONG; `/api/rejection-patterns/detect` mandaba una alerta por cada patrón del historial | Pruebas con confirmación en la app y `?confirm=ENVIAR_ALERTA_REAL` en el backend. Alertas de patrones apagadas (`PATTERN_ALERTS_ENABLED = False`): DTB, Rejection, `/api/pattern-alert` (409) y avisos de resultado no llegan al bot. Tipo desconocido: no se envía | `Watchlist.jsx`, `main.py`, `alert_sender.py` |
| El interruptor "Alertas" nacía en OFF y leía una sola vez; encender activaba todas las configs de patrones; un cuerpo `{}` encendía | Estado desconocido ("Alertas ?") si no lee, se refresca cada 15 s y muestra lo que dice el backend. Solo maneja el Swing y exige `true` o `false` | `AlertToggle.jsx`, `main.py` |
| CORS `*`, sin revisar Origin ni Host; `START_PRODUCTION.bat` abría el 8000 a la red | Origin y Host como el bot; la Watchlist escucha en 127.0.0.1 | `main.py`, `START_PRODUCTION.bat` |

### Fase 2: datos y gráfico

| Antes | Ahora | Dónde |
|-------|-------|-------|
| El WebSocket de los gráficos no se reconectaba nunca tras un corte | El de App 9 (reconexión, ping, vigilancia de 60 s, `online`) y, al volver, los gráficos visibles recargan su histórico. El cierre de una vela ya no se pierde en el búfer de 500 ms | `WebSocketManager.js`, `MiniChart.jsx` |
| Cada cambio de timeframe cargaba dos veces (días viejos y nuevos) y borraba una caché correcta; al abrir, 1 día y luego 90 | Timeframe y días en un solo paso; arranca con los días del timeframe | `Watchlist.jsx` |
| El VWAP recargaba de cero las 10 monedas en cada cambio de timeframe y se pedía tres veces por moneda | Servicio VWAP de App 8 (estado por moneda y timeframe) y pedidos iguales compartidos | `vwap_service.py`, `main.py`, `VWAPIndicator.js` |
| La pantalla completa no limpiaba nada al cerrarse | Se desuscribe y limpia su recarga y su RenderManager; devuelve el redibujo al gráfico normal | `MiniChart.jsx` |
| Una respuesta de otro timeframe podía quedar en pantalla y en su caché | Solo se aplica la carga vigente | `MiniChart.jsx` |
| La vela en curso de un gráfico pausado pisaba la vela buena del histórico y desaparecía; la semanal salía repetida de jueves a domingo | La vela anterior entra cerrada sin pisar la del histórico; la vela en curso sale de la marca `in_progress` del backend | `MiniChart.jsx` |
| Un archivo de dibujos ilegible respondía lista vacía y el gráfico la guardaba encima; `..\` salía de la carpeta; un sondeo fallido los borraba de la pantalla | El backend responde 500, valida el símbolo y guarda con temporal; la app no guarda si no pudo cargar (avisa) y conserva lo que se ve | `main.py`, `MiniChart.jsx`, `ChartModal.jsx` |

### Cómo se probó
- **Sin conexión:** `2.WatchlistConIndicadores/backend/tests/run_checks.py`, 114 pruebas (las 94 del backend de App 5 adaptadas y 20 propias: patrones apagados, interruptor, confirmaciones, config dañada y canales fijos). Se corren con el Python global:
  ```bash
  cd 2.WatchlistConIndicadores/backend
  C:\Python314\python.exe -B tests\run_checks.py
  ```
- **En vivo, copia aislada** (backend en 8300 con la config real del Swing, bot falso en 5996, App 7 por Vite en 8301 en el navegador):
  - al abrir: 0 POST, el WebSocket del backend siguió en 15m, VWAP una vez por moneda, gráficos en ~20 s (antes 51 s);
  - "Swing Detector" marcado y paso a 1m: 0 POST, el Swing siguió en 15m y 60 días; las flechas de 1h y 1m llegaron como `displayOnly`;
  - modal: cancelar no cambió nada; con confirmación el Swing pasó a 1m y recibió velas de 1m; quitar y agregar BTCUSDT pidió confirmación;
  - WebSocket cerrado a mano: reconectó a los 3 s y los gráficos visibles recargaron su histórico;
  - pantalla completa tres veces: oyentes 1 → 2 → 1 (antes 1, 2, 3...);
  - Test 1x: cancelar no envió; aceptar envió una alerta con `sent_at`; sin `confirm`, 400; página ajena 403; Host ajeno 400; `..\` 400;
  - dibujos dañados: la app avisó y no guardó; el archivo quedó intacto;
  - semanal un jueves UTC: cerradas hasta el 02/11 y la del 09/11 una sola vez.

### Ten en cuenta
- **Reiniciar** el backend (8000) y App 7.
- **El `.venv` del backend 2 está roto** (apunta a `WatchlistConIndicadores` sin el "2." y no tiene `aiohttp`): el backend corre con el Python global. No se cambió.
- **App 2 en el navegador** no se tocó: si se abre, su `set-interval` ya no deja al Swing sin velas, su sincronización del Swing solo cambia los días (historial) y sus botones de prueba quedan rechazados.
- **No se probó** dentro de Electron ni contra el bot o Bybit reales. Tampoco un corte real de red.
- **Fase 3 pendiente:** sondeo de dibujos cada 3 s por gráfico, arranque lento, instancia única y recuperación del renderer en Electron, servidor de capturas 5181 con CORS `*`.

---

## DESCRIPCION GENERAL

**Watchlist Desktop** es una aplicacion de escritorio construida con Electron + React que muestra graficos de criptomonedas en tiempo real. Es una migracion de la version web (App 2) a desktop para **eliminar los gaps en los graficos** causados por el throttling del navegador cuando la ventana esta inactiva.

### Objetivo Principal
Solucionar el problema de gaps en graficos cuando la aplicacion esta en segundo plano o minimizada.

### Stack Tecnologico
- **Frontend**: React 18 + Vite + uPlot
- **Desktop**: Electron 33
- **Backend**: FastAPI (puerto 8000) - **COMPARTIDO con App 2**
- **Data Source**: Bybit Futures API (REST + WebSocket)

---

## ARQUITECTURA

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP APP                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              React Frontend (Solo Display)             │  │
│  │  - Graficos con uPlot                                 │  │
│  │  - Sin calculos de indicadores                        │  │
│  │  - Anti-throttling activado                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                           ↕ HTTP/WebSocket                   │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│        BACKEND COMPARTIDO (FastAPI - Puerto 8000)            │
│  Ubicacion: 2.WatchlistConIndicadores/backend/               │
│  - Conexion WebSocket con Bybit                             │
│  - Calculos de indicadores (VWAP, Swing, S/R, etc.)         │
│  - Deteccion de patrones                                    │
│  - Envio de alertas al Trading Bot (puerto 5000)            │
└─────────────────────────────────────────────────────────────┘
```

**IMPORTANTE**: Esta aplicacion NO tiene backend propio. Usa el backend de `2.WatchlistConIndicadores/`.

---

## ESTRUCTURA DE ARCHIVOS

```
7.WatchlistDesktop/
├── electron/
│   ├── main.js              # Proceso principal Electron + anti-throttling
│   └── preload.js           # Bridge seguro para IPC
│
├── src/                     # Frontend React (copiado de App 2)
│   ├── main.jsx             # Entry point React
│   ├── App.jsx              # Componente raiz
│   ├── components/
│   │   ├── Watchlist.jsx    # Lista de simbolos + robustness init
│   │   ├── MiniChart.jsx    # Grafico principal con indicadores
│   │   ├── ConnectionStatus.jsx  # Indicador visual de conexion (NUEVO)
│   │   ├── indicators/      # Indicadores tecnicos
│   │   │   ├── IndicatorManager.js
│   │   │   ├── VWAPIndicator.js
│   │   │   ├── SwingDetectorIndicator.js
│   │   │   ├── SupportResistanceIndicator.js
│   │   │   ├── CVDIndicator.js
│   │   │   └── ...
│   │   ├── drawing/         # Herramientas de dibujo
│   │   └── *Settings.jsx    # Modales de configuracion
│   ├── hooks/
│   └── utils/
│       ├── robustness.js    # Sistema centralizado de robustez (NUEVO)
│       ├── CandleCache.js   # Cache IndexedDB con validacion
│       ├── PollingScheduler.js
│       ├── StorageManager.js
│       └── IndicatorCache.js
│
├── assets/
│   └── icon.ico             # Icono de la aplicacion
│
├── index.html               # HTML principal
├── vite.config.js           # Config de Vite con proxy al backend
├── package.json             # Dependencias y scripts
│
├── START_ALL.bat            # Inicio coordinado Backend + Electron (NUEVO)
├── 1_INSTALL.bat            # Instalar dependencias
├── 2_START_DEV.bat          # Iniciar en modo desarrollo
└── 3_BUILD.bat              # Crear ejecutable
```

---

## CONFIGURACION ANTI-THROTTLING

El archivo `electron/main.js` contiene las configuraciones criticas que eliminan el throttling:

### Flags de Chromium (antes de app.whenReady)
```javascript
// Desactivar throttling del renderer en background
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Desactivar throttling de timers en background
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Desactivar throttling de ventanas ocultas
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
```

### Configuracion de BrowserWindow
```javascript
new BrowserWindow({
  webPreferences: {
    backgroundThrottling: false,  // CRITICO
    // ...
  }
});
```

### PowerSaveBlocker
```javascript
// Prevenir que el sistema entre en suspension
powerSaveBlocker.start('prevent-app-suspension');
```

---

## COMANDOS

### Desarrollo
```bash
# 1. Instalar dependencias (solo primera vez)
npm install

# 2. Iniciar backend (en otra terminal)
cd ../2.WatchlistConIndicadores/backend
python -m uvicorn main:app --port 8000

# 3. Iniciar Electron + Vite
npm run dev:electron
```

### Produccion
```bash
# Crear instalador Windows
npm run build:electron

# Crear version portable
npm run build:portable
```

### Scripts disponibles
| Script | Descripcion |
|--------|-------------|
| `npm run dev` | Solo Vite (sin Electron) |
| `npm run dev:electron` | Vite + Electron concurrente |
| `npm run build` | Build de produccion React |
| `npm run build:electron` | Build + instalador Windows |
| `npm run build:portable` | Build + ejecutable portable |
| `npm run electron` | Solo Electron (requiere Vite corriendo) |

---

## DIFERENCIAS CON APP 2 (NAVEGADOR)

| Aspecto | App 2 (Browser) | App 7 (Electron) |
|---------|-----------------|------------------|
| Throttling en background | Si (gaps en graficos) | No |
| System Tray | No | Si |
| PowerSaveBlocker | No | Si |
| Notificaciones | Browser API | Nativas OS |
| Tamano | ~0 MB | ~150 MB |
| Requiere navegador | Si | No |
| Ejecucion 24/7 | Problematico | Optimo |

---

## CONEXIONES DE RED

### Proxy en desarrollo
El archivo `vite.config.js` configura un proxy para las llamadas API:

```javascript
proxy: {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
}
```

### Optimizaciones de conexion
```javascript
// En electron/main.js
app.commandLine.appendSwitch('max-connections-per-host', '64');
app.commandLine.appendSwitch('max-sockets-per-group', '64');
app.commandLine.appendSwitch('ignore-connections-limit', 'localhost');
```

---

## SYSTEM TRAY

La aplicacion se minimiza al system tray en lugar de cerrarse:

- **Click derecho** en icono: Menu contextual (Abrir, Reiniciar, Cerrar)
- **Doble-click** en icono: Restaurar ventana
- La app sigue ejecutandose en segundo plano
- Notificacion al minimizar por primera vez

---

## FIXES APLICADOS (Enero 2026)

### 1. Flickering de Indicadores
**Problema**: Los indicadores (especialmente VWAP) desaparecian y reaparecian intermitentemente.

**Causa**: En `VWAPIndicator.js`, se hacia `this.dataMap.clear()` antes de poblar los nuevos datos. Si un frame de render ocurria entre el `clear()` y el `forEach`, los indicadores se veian vacios.

**Solucion**: Reemplazo atomico del Map:
```javascript
// ANTES (problematico)
this.dataMap.clear();
data.forEach(point => this.dataMap.set(point.timestamp, point));

// DESPUES (correcto)
const newMap = new Map();
data.forEach(point => newMap.set(point.timestamp, point));
this.dataMap = newMap;
```

### 2. Swing Indicators no aparecian en BTCUSDT/ETHUSDT
**Problema**: Solo mostraban 3 y 30 senales respectivamente, mientras otros simbolos tenian 300+.

**Causa**: Configuracion restrictiva en `swing_config.json`:
- BTCUSDT tenia `volumeFilter.enabled: true` con `minZScore: 2`
- BTCUSDT tenia `swingBars: 5` (vs global de 3)
- Ambos tenian `days: 1` (solo 24 velas en 60m)

**Solucion**: Ajustar `2.WatchlistConIndicadores/backend/config/swing_config.json`:
```json
"BTCUSDT": {
  "volumeFilter": { "enabled": false },
  "days": 90
},
"ETHUSDT": {
  "days": 90
}
```

### 3. Grafico no seguia el precio (sin auto-scroll)
**Problema**: El grafico se actualizaba pero no hacia scroll automatico para seguir las nuevas velas. El precio se salia de la ventana visible.

**Causa**: En `MiniChart.jsx`, cuando llegaban nuevas velas via WebSocket, el `viewStateRef.current.offset` no se reseteaba, causando que el grafico mantuviera la posicion anterior en lugar de seguir el precio.

**Solucion**: Agregar logica de auto-scroll en el handler de WebSocket:
```javascript
// En handleWebSocketMessage, cuando se confirma una nueva vela:
} else if (candleTimestamp > currentInProgress.timestamp) {
  // AUTO-SCROLL: Si el usuario estaba viendo las ultimas velas, mantenerlo asi
  const wasAtLatest = viewStateRef.current.offset <= 1;

  candlesRef.current.push(currentInProgress);
  // ...

  // AUTO-SCROLL: Resetear offset si estaba viendo las ultimas velas
  if (wasAtLatest) {
    viewStateRef.current.offset = 0;
  }
}
```

**Comportamiento**:
- Si el usuario esta viendo el precio actual (offset = 0) → el grafico sigue las nuevas velas
- Si el usuario hizo scroll hacia atras → el grafico respeta esa posicion

### 4. VWAP no graficaba en tiempo real (Febrero 2026)

**Problema**: El indicador VWAP cargaba correctamente al inicio pero no se actualizaba en tiempo real. Solo la carga inicial funcionaba, el polling posterior no ocurria.

**Causa**: El `PollingScheduler` no estaba siendo iniciado. Era un singleton que se importaba pero nunca se llamaba `pollingScheduler.start()`.

**Solucion en dos partes**:

1. **Watchlist.jsx** - Iniciar el scheduler en el componente raiz:
```javascript
import pollingScheduler from '../utils/PollingScheduler';

// En el useEffect de inicializacion:
useEffect(() => {
  initRobustness();
  pollingScheduler.start();  // <-- NUEVO
  log.info('[PollingScheduler] Started');

  return () => {
    stopRobustness();
    pollingScheduler.stop();  // <-- NUEVO
    log.info('[PollingScheduler] Stopped');
  };
}, []);
```

2. **VWAPIndicator.js** - Migrar de setInterval nativo a PollingScheduler:
```javascript
import pollingScheduler from '../../utils/PollingScheduler.js';

// Reemplazo de _pollingInterval por _pollingId
this._pollingId = null;

// Nuevo metodo _startPolling usando el scheduler
_startPolling() {
  if (this._pollingId) return;
  this._pollingId = pollingScheduler.register(
    async () => {
      if (this.enabled && !this._destroyed) {
        const updated = await this.fetchData(true);
        if (updated && this.indicatorManager?.requestRedraw) {
          this.indicatorManager.requestRedraw();
        }
      }
    },
    this.fetchIntervalMs,
    2  // Alta prioridad
  );
}

// Agregar llamada a _startPolling() despues de carga exitosa en fetchData()
if (!this._pollingId) {
  this._startPolling();
}
```

**Verificacion**:
- Consola debe mostrar: `[PollingScheduler] Started`
- Consola debe mostrar: `[PollingScheduler] Registered poll_N (interval: 60000ms)`
- El VWAP debe actualizarse automaticamente cada minuto

### 5. CandleCache entraba en ciclo infinito (Febrero 2026)

**Problema**: Cuando el backend no estaba corriendo, el CandleCache entraba en un ciclo infinito de:
1. Detectar cache como "corrupto" (pocas velas)
2. Limpiar cache
3. Intentar carga completa (falla porque backend esta caido)
4. WebSocket trae algunas velas
5. Guardar ~10 velas
6. Volver al paso 1

**Causa**: `getValidated()` limpiaba el cache cada vez que detectaba menos del 70% de velas esperadas, sin considerar que el problema era que el backend estaba caido.

**Solucion**: Agregar cooldown de 1 minuto para evitar limpiezas repetidas del mismo simbolo:

```javascript
// En CandleCache.js
static _lastCleanup = new Map();  // symbol@interval -> timestamp
static CLEANUP_COOLDOWN_MS = 60000;  // 1 minuto

// En getValidated(), antes de limpiar:
const lastCleanupTime = this._lastCleanup.get(cacheKey) || 0;
if (now - lastCleanupTime < this.CLEANUP_COOLDOWN_MS) {
  // En cooldown - usar las velas disponibles en lugar de limpiar
  return cached;
}
this._lastCleanup.set(cacheKey, now);
await this.clear(symbol, interval);
```

**Comportamiento**:
- Primera deteccion de cache corrupto: limpia y fuerza recarga
- Detecciones subsecuentes dentro de 1 minuto: usa las velas disponibles
- Esto previene el ciclo infinito cuando el backend esta caido

### 6. VWAP Solo Actualizaba en 2 de 10 Monedas (Febrero 2026)

**Problema**: El VWAP se graficaba correctamente al inicio pero durante el polling en tiempo real, solo BTCUSDT y ETHUSDT actualizaban. Las otras 8 monedas mantenian `dataMap.size` fijo en 7200.

**Causa raiz**: El endpoint `/api/vwap-service/data/{symbol}` verificaba:
```python
needs_more_data = len(current_data) < candles_needed * 0.9
```
Como ya habia suficientes datos, no recargaba. BTCUSDT/ETHUSDT funcionaban porque tenian WebSocket activo agregando velas.

**Solucion en 3 partes**:

1. **Backend `main.py`** - Agregar parametro `refresh`:
```python
@app.get("/api/vwap-service/data/{symbol}")
async def get_vwap_service_data(
    symbol: str,
    days: int = 1,
    interval: str = "60",
    refresh: bool = False  # NUEVO
):
    # Si refresh=true, hacer carga incremental
    if refresh and not config_changed and not needs_more_data:
        await vwap_service.reload_symbol_data(symbol, 1, interval, incremental=True)
```

2. **Backend `vwap_service.py`** - Carga incremental eficiente:
```python
async def reload_symbol_data(self, symbol, days, interval, incremental=False):
    if incremental and symbol in self._historical_candles:
        # Solo fetch velas nuevas desde ultimo timestamp conocido
        last_ts = max(c['timestamp'] for c in existing)
        candles = await self._fetch_candles_since(symbol, last_ts, interval)
        # Merge con existentes (Map por timestamp)
        candle_map = {c['timestamp']: c for c in existing}
        for c in candles:
            candle_map[c['timestamp']] = c
        self._historical_candles[symbol] = sorted(candle_map.values(), key=lambda x: x['timestamp'])

async def _fetch_candles_since(self, symbol, since_timestamp, interval):
    # Una sola llamada a Bybit API con start=since_timestamp+1
    url = f"{BYBIT_API_URL}?symbol={symbol}&interval={interval}&start={since_timestamp + 1}&limit=200"
```

3. **Frontend `VWAPIndicator.js`** - Enviar refresh en polling:
```javascript
if (skipCache) {
  params.append('refresh', 'true');
}
```

**Resultado**: Todas las 10 monedas actualizan VWAP en tiempo real con una sola llamada eficiente a la API.

### 7. Velas Duplicadas y Gaps (Febrero 2026)

**Problema**: Aparecian velas repetidas (ej: 12:59 duplicada) y gaps entre velas en el grafico.

**Causa**: Dos lugares en `MiniChart.jsx` no deduplicaban correctamente:

1. **Merge de velas del WebSocket** (lineas 1138-1154):
```javascript
// ANTES - concatenaba sin verificar duplicados
finalCandles = [...finalCandles, ...newerFromWs];
```

2. **Push de velas cerradas** (linea 1353):
```javascript
// ANTES - siempre hacia push
candlesRef.current.push(currentInProgress);
```

**Solucion**:

1. **Merge con Map para deduplicar**:
```javascript
const candleMap = new Map();
finalCandles.forEach(c => candleMap.set(c.timestamp, c));
existingCandles.forEach(c => {
  if (c.timestamp > lastFinalTs) {
    candleMap.set(c.timestamp, c);
  }
});
finalCandles = Array.from(candleMap.values()).sort((a, b) => a.timestamp - b.timestamp);
```

2. **Verificar antes de push**:
```javascript
const existingIndex = candlesRef.current.findIndex(c => c.timestamp === currentInProgress.timestamp);
if (existingIndex === -1) {
  candlesRef.current.push(currentInProgress);
} else {
  candlesRef.current[existingIndex] = currentInProgress;
}
```

**Resultado**: Sin velas duplicadas ni gaps en los graficos.

### 8. Backend Error "too many file descriptors" (Febrero 2026)

**Problema**: El backend crasheaba con `ValueError: too many file descriptors in select()` despues de un tiempo de uso.

**Causa**: `vwap_service.py` creaba una nueva `aiohttp.ClientSession()` para cada request HTTP en lugar de reutilizar una sesion global.

**Solucion**: Agregar cliente HTTP global con connection pooling:
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

**Resultado**: Sin acumulacion de file descriptors, backend estable.

### 9. Open Interest Default y "Apply to All" (Enero 2026)

**Problema 1**: El Open Interest se mostraba en modo "histogram" por defecto en lugar de "cumulative".

**Problema 2**: No había forma de aplicar la configuración de OI a todas las monedas simultáneamente.

**Causa**: Tres capas de configuración desincronizadas:
1. `OpenInterestIndicator.js` constructor tenía default hardcodeado
2. `IndicatorManager.js` no pasaba config al crear el indicador
3. `Watchlist.jsx` tenía `oiMode` state en "histogram"

**Solución Aplicada**:

**Archivo 1: `OpenInterestIndicator.js`** (línea 12):
```javascript
// Aceptar config como parámetro opcional
constructor(symbol, interval, days = 30, config = {}) {
  super(symbol, interval, days);
  // Usar config con fallbacks
  this.mode = config.mode || "cumulative";
  this.smoothing = config.smoothing || 3;
  this.showPriceSentiment = config.showPriceSentiment || false;
}
```

**Archivo 2: `IndicatorManager.js`** (líneas 76-81):
```javascript
// Pasar config explícito al crear el indicador
if (indicatorStates['OpenInterest'] !== false) {
  this.openInterestIndicator = new OpenInterestIndicator(this.symbol, this.interval, this.days, {
    mode: 'cumulative',
    smoothing: 3,
    showPriceSentiment: false
  });
  this.indicators.push(this.openInterestIndicator);
}
```

**Archivo 3: `Watchlist.jsx`**:
```javascript
// Línea 152: Cambiar default del estado
const [oiMode, setOiMode] = useState("cumulative");

// Líneas 816-832: Sincronizar oiMode cuando cambia la config
const handleOpenInterestConfigChange = (config) => {
  const manager = indicatorManagers[selectedSymbolForOI]?.manager;
  if (manager) {
    const oiIndicator = manager.getOpenInterestIndicator();
    if (oiIndicator) {
      oiIndicator.updateConfig(config);
      // Sincronizar estado global
      if (config.mode) {
        setOiMode(config.mode);
      }
      // ... resto del handler
    }
  }
};

// Líneas 831-857: Handler "Apply to All"
const handleApplyOIToAll = (config) => {
  // Iterar todos los símbolos en IndicatorManagerRegistry
  Object.keys(indicatorManagers).forEach(sym => {
    const manager = indicatorManagers[sym]?.manager;
    if (manager) {
      const oiIndicator = manager.getOpenInterestIndicator();
      if (oiIndicator) {
        oiIndicator.updateConfig(config);
      }
    }
  });

  // Sincronizar estado global
  if (config.mode) {
    setOiMode(config.mode);
  }

  // Forzar redraw del chart actual
  if (miniChartRef.current?.redraw) {
    miniChartRef.current.redraw();
  }
};
```

**Archivo 4: `OpenInterestSettings.jsx`**:
```javascript
// Línea 5: Agregar prop onApplyToAll
export default function OpenInterestSettings({
  symbol,
  onConfigChange,
  onApplyToAll  // NUEVO
}) {

  // Líneas 18-22: Handler para el botón
  const handleApplyToAll = () => {
    if (onApplyToAll) {
      onApplyToAll(localConfig);
    }
  };

  // Líneas 138-147: Botón "Apply to All" en la UI
  <div className="oi-apply-all-container">
    <button
      className="oi-apply-all-btn"
      onClick={handleApplyToAll}
      title="Aplicar esta configuración a todas las monedas"
    >
      📋 Aplicar a todas las monedas
    </button>
  </div>
}
```

**Archivo 5: `OpenInterestSettings.css`** (líneas 267-292):
```css
.oi-apply-all-container {
  margin-top: 15px;
  padding-top: 15px;
  border-top: 1px solid #e0e0e0;
}

.oi-apply-all-btn {
  width: 100%;
  padding: 10px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.3s ease;
  box-shadow: 0 4px 15px rgba(102, 126, 234, 0.3);
}

.oi-apply-all-btn:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(102, 126, 234, 0.4);
}
```

**Resultado**:
- ✅ Open Interest muestra modo "cumulative" por defecto
- ✅ Default persiste al cambiar timeframe o símbolo
- ✅ Botón "Aplicar a todas las monedas" funciona correctamente
- ✅ Estado global sincronizado en las tres capas (Indicator, Manager, Watchlist)

### 9. Mejoras de Robustez (29 Enero 2026)

Se implementaron mejoras de robustez para mejorar la estabilidad y experiencia de usuario:

**Archivos nuevos creados:**
- `src/utils/robustness.js` - Sistema centralizado de robustez
- `src/components/ConnectionStatus.jsx` - Indicador visual de conexion
- `START_ALL.bat` - Script de inicio coordinado

**Archivos modificados:**
- `src/utils/CandleCache.js` - Validacion de velas + deteccion de gaps
- `src/components/MiniChart.jsx` - fetchWithRetry para datos historicos
- `src/components/Watchlist.jsx` - Integracion de robustness + ConnectionStatus

**Funcionalidades implementadas:**

1. **Health Check del Backend**
   - Verificacion automatica cada 30 segundos
   - Indicador visual verde/rojo en el header
   - Click para reintentar conexion manual

2. **Validacion de Datos de Velas**
   - Valida campos requeridos (timestamp, OHLC)
   - Verifica logica OHLC (high >= low, etc.)
   - Descarta velas invalidas antes de guardar en cache

3. **Deteccion de Gaps en Cache**
   - MIN_CACHE_RATIO = 0.7 (70% minimo de velas esperadas)
   - Detecta gaps >2 minutos entre velas
   - Limpia cache corrupto automaticamente

4. **Retry con Backoff Exponencial**
   - 3 reintentos con delays de 1s, 2s, 4s
   - Solo reintenta en errores de red o 5xx
   - Log de reintentos para diagnostico

5. **Limpieza Automatica de Cache**
   - Elimina entradas >7 dias al iniciar
   - Previene crecimiento ilimitado de IndexedDB

6. **Inicio Coordinado (START_ALL.bat)**
   - Verifica si backend esta corriendo
   - Inicia backend si es necesario
   - Espera hasta que responda (max 2 min)
   - Luego inicia Electron

**Verificacion:**
```bash
# Buscar en consola del frontend:
[Robustness] Initialized
[HealthCheck] Started (interval: 30000ms)
[CacheCleanup] Complete: X/Y candles, X/Y indicators removed
```

**Detalles tecnicos de robustness.js:**

```javascript
// Validacion de velas individuales
validateCandle(candle) {
  // Campos requeridos: timestamp, open, high, low, close
  // Logica OHLC: high >= max(open,close), low <= min(open,close)
  // Valores positivos y finitos
}

// Deteccion de gaps en datos
analyzeGaps(candles, interval) {
  // MIN_CACHE_RATIO = 0.7 (70% minimo de velas esperadas)
  // Detecta gaps > 2 intervalos entre velas consecutivas
  // Retorna { hasGaps, gapCount, ratio }
}

// Retry con backoff exponencial
fetchWithRetry(url, options, retryConfig) {
  // maxRetries: 3
  // initialDelayMs: 1000 (luego 2000, 4000)
  // Solo reintenta en errores de red o HTTP 5xx
}
```

---

## TROUBLESHOOTING

### Backend no responde
```
Error: ECONNREFUSED localhost:8000
```
**Solucion**: Iniciar el backend primero:
```bash
cd 2.WatchlistConIndicadores/backend
python -m uvicorn main:app --port 8000
```

### Ventana no aparece
La app puede estar minimizada en el system tray. Buscar el icono en la bandeja del sistema y hacer doble-click.

### Gaps en graficos
Si aun hay gaps despues de la migracion:
1. Verificar que `backgroundThrottling: false` esta en main.js
2. Verificar que los flags de Chromium estan ANTES de `app.whenReady()`
3. Reiniciar Electron completamente

### Error "Cannot find module 'electron'"
```bash
npm install
```

### Indicadores no se muestran
1. Verificar que el backend esta corriendo
2. Abrir DevTools (Ctrl+Shift+I) y revisar consola
3. Verificar respuestas de API en Network tab

### Indicadores parpadean/desaparecen
El fix de reemplazo atomico ya fue aplicado. Si persiste:
1. Verificar que `VWAPIndicator.js` usa `const newMap = new Map()` en lugar de `this.dataMap.clear()`
2. Recargar la pagina (Ctrl+R)

### Configuracion de Swing no se aplica
El backend cachea la configuracion en memoria. Despues de editar `swing_config.json`:
1. Reiniciar el backend
2. O llamar a `/api/swing/config` via POST

### Memoria alta
1. Reducir `days` en la configuracion de indicadores
2. Deshabilitar indicadores no utilizados
3. El garbage collector de Electron deberia liberar memoria automaticamente

### Grafico no sigue el precio (se sale de la ventana)
El fix de auto-scroll ya fue aplicado. Si persiste:
1. Verificar que `MiniChart.jsx` tiene la logica `wasAtLatest` en el handler de WebSocket
2. Hacer doble-click en el eje de precios para resetear la vista
3. Usar el boton ">>|" en la barra de herramientas para ir a la ultima vela

### Error "uvicorn no se reconoce" en START_ALL.bat
El script usa `python -m uvicorn` para garantizar compatibilidad:
```batch
python -m uvicorn main:app --reload --port 8000
```
Si persiste, verificar que el entorno virtual existe en `2.WatchlistConIndicadores/backend/.venv`

### ConnectionStatus muestra "Offline" permanentemente
1. Verificar que el backend esta corriendo en puerto 8000
2. Click en el indicador rojo para forzar reconexion
3. Revisar consola por errores de health check
4. Verificar que `/api/status` responde correctamente

### Cache no se limpia / datos corruptos
El sistema de robustez limpia automaticamente:
- Entradas de cache >7 dias
- Datos que fallan validacion OHLC
- Gaps >70% de velas faltantes

Para forzar limpieza manual:
1. Abrir DevTools (F12)
2. Application > IndexedDB > localforage
3. Borrar la base de datos
4. Recargar la aplicacion

### Solo se ven 4-10 velas por grafico (backend caido)
**Sintomas**:
- Los graficos muestran muy pocas velas (4-10)
- Consola muestra: `[CandleCache] Limpiando cache corrupto...` repetidamente
- Consola de errores muestra: `ERR_CONNECTION_REFUSED` para puerto 8000

**Causa**: El backend no esta corriendo. Las unicas velas disponibles vienen del WebSocket en tiempo real, no del endpoint de datos historicos.

**Solucion**:
1. Iniciar el backend:
```bash
cd 2.WatchlistConIndicadores/backend
python -m uvicorn main:app --port 8000
```
2. O usar `START_ALL.bat` que inicia el backend automaticamente

**Nota**: El fix de cooldown en CandleCache previene el ciclo infinito de limpieza, pero no soluciona el problema de raiz (falta de backend)

---

## SISTEMA DE ALERTAS GLOBALES (Enero 2026)

Sistema de protección que controla centralizadamente TODAS las alertas automáticas al Trading Bot.

### Objetivo

Prevenir trading automático accidental desde la Watchlist Desktop. Solo el Crypto Analyzer (App 4/8) debe enviar alertas de trading por defecto.

### Componentes del Sistema

#### **AlertToggle Component**
- **Ubicación**: `src/components/AlertToggle.jsx`
- **Funcionalidad**: Toggle visual en el header de la Watchlist
- **Estados**:
  - **OFF (default)**: 🔕 Alertas OFF - Indicador verde
  - **ON**: 🔔 Alertas ON - Indicador rojo pulsante + warning
- **Integración**: Importado en `Watchlist.jsx` línea 1261

#### **Backend Endpoints**

**1. GET /api/alerts/global-status**
```json
{
  "success": true,
  "alertsEnabled": false,
  "services": {
    "swing": {"enabled": false},
    "patterns": {
      "enabled": false,
      "dbt_enabled_count": 0,
      "rejection_enabled_count": 0
    }
  }
}
```

**2. POST /api/alerts/toggle-global**
```json
// Request
{"enabled": true}

// Response
{
  "success": true,
  "alertsEnabled": true,
  "message": "Global alerts enabled",
  "services": {
    "swing": {"success": true, "enabled": true},
    "patterns": {"success": true, "enabled": true, "configs_updated": 4}
  }
}
```

### Servicios Controlados

| Servicio | Archivo Config | Default | Qué Detecta |
|----------|---------------|---------|-------------|
| **Swing Detector** | `swing_config.json` | `alertsEnabled: false` | Swing Highs/Lows |
| **Double Top/Bottom** | `realtime_configs.json` | `alertsEnabled: false` | Dobles techos/suelos |
| **Rejection Patterns** | `realtime_configs.json` | `alertsEnabled: false` | Hammer, Shooting Star, Engulfing, Doji |

### Flujo de Alertas

```
┌─────────────────────────────────────────────────────────────────┐
│                    DETECCION DE PATRONES                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │ Swing        │  │ DTB          │  │ Rejection    │          │
│  │ Detector     │  │ Detector     │  │ Patterns     │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                  │                  │                  │
│         └──────────────────┴──────────────────┘                  │
│                            │                                     │
│                            ▼                                     │
│                  ┌─────────────────┐                            │
│                  │ alertsEnabled?  │                            │
│                  └────────┬────────┘                            │
│                           │                                     │
│          ┌────────────────┴────────────────┐                   │
│          │                                  │                   │
│         NO                                 YES                  │
│          │                                  │                   │
│          ▼                                  ▼                   │
│  ┌───────────────┐              ┌─────────────────┐            │
│  │ Solo graficar │              │ Enviar alerta   │            │
│  │ en el chart   │              │ Trading Bot     │            │
│  └───────────────┘              │ (puerto 5000)   │            │
│                                 └─────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

### UI del Toggle

**Estado OFF (Seguro):**
```
┌─────────────────────────────┐
│  🔕  Alertas OFF   🟢       │
└─────────────────────────────┘
```

**Estado ON (Advertencia):**
```
┌─────────────────────────────────────────────────────────┐
│  🔔  Alertas ON   🔴 (pulsante)                         │
├─────────────────────────────────────────────────────────┤
│  ⚠️ Las alertas están activas - Los detectores de      │
│  patrones (Swing, DTB, Rejection) enviarán órdenes al   │
│  Trading Bot                                            │
├─────────────────────────────────────────────────────────┤
│  [Swing] [DTB (2)] [Rejection (2)]                      │
└─────────────────────────────────────────────────────────┘
```

### Badges de Servicios

Cuando las alertas están ON, se muestran badges naranjas indicando qué servicios están activos:
- **Swing**: Swing Detector activo
- **DTB (N)**: N configuraciones de Double Top/Bottom activas
- **Rejection (N)**: N configuraciones de Rejection Patterns activas

### Archivos Modificados

#### Backend
1. **`realtime_pattern_service.py`**:
   - Línea 915: `alertsEnabled: False` en `_get_default_dbt_config()`
   - Línea 934: `alertsEnabled: False` en `_get_default_rejection_config()`

2. **`config/realtime_configs.json`**:
   - Todas las instancias de `alertsEnabled` cambiadas a `false`

3. **`main.py`**:
   - Línea ~3743: Endpoint `GET /api/alerts/global-status`
   - Línea ~3802: Endpoint `POST /api/alerts/toggle-global`

#### Frontend
1. **`AlertToggle.jsx`** (NUEVO):
   - Estado `alertsEnabled` y `serviceDetails`
   - Fetch de `/api/alerts/global-status`
   - Toggle via `/api/alerts/toggle-global`
   - Renderiza warning + badges cuando ON

2. **`AlertToggle.css`** (NUEVO):
   - Estilos para botón con estados enabled/disabled
   - Animación pulse-red para indicador ON
   - Estilos para `.alert-details` y `.service-badge`

3. **`Watchlist.jsx`**:
   - Línea 24: `import AlertToggle from "./AlertToggle"`
   - Línea 1261: `<AlertToggle />` en header

### Verificación

**Consola del navegador (Estado OFF):**
```
[AlertToggle] Alertas globales desactivadas
[AlertToggle] Servicios afectados: {
  swing: {success: true, enabled: false},
  patterns: {success: true, enabled: false, configs_updated: 4}
}
```

**Consola del navegador (Estado ON):**
```
[AlertToggle] Alertas globales activadas
[AlertToggle] Servicios afectados: {
  swing: {success: true, enabled: true},
  patterns: {success: true, enabled: true, configs_updated: 4}
}
```

### Troubleshooting

**Toggle no responde:**
1. Verificar que el backend está corriendo en puerto 8000
2. Verificar que los endpoints `/api/alerts/*` existen
3. Revisar consola del navegador por errores HTTP

**Alertas se siguen enviando con toggle OFF:**
1. Verificar que los archivos de configuración tienen `alertsEnabled: false`
2. Reiniciar el backend para cargar la nueva configuración
3. Verificar logs del backend que confirme estado OFF

**Badges no aparecen:**
1. Los badges solo aparecen cuando `alertsEnabled === true`
2. Verificar que `serviceDetails` tiene datos en el estado del componente
3. Revisar estilos CSS de `.alert-details` y `.service-badge`

---

## INDICADORES DISPONIBLES

Los indicadores se calculan en el **backend** y se renderizan en el frontend:

| Indicador | Archivo Frontend | Endpoint Backend |
|-----------|------------------|------------------|
| VWAP | VWAPIndicator.js | /api/vwap-service/data/{symbol} |
| Swing Detector | SwingDetectorIndicator.js | /api/swing/signals/{symbol} |
| Support/Resistance | SupportResistanceIndicator.js | /api/support-resistance/{symbol} |
| CVD | CVDIndicator.js | Calculo local con datos de velas |
| Volume Profile | VolumeProfileIndicator.js | Calculo local |

---

## DEPENDENCIAS PRINCIPALES

| Paquete | Version | Proposito |
|---------|---------|-----------|
| electron | ^33.2.0 | Framework desktop |
| react | ^18.2.0 | UI framework |
| vite | ^5.4.0 | Build tool |
| uplot | ^1.6.21 | Graficos de alto rendimiento |
| localforage | ^1.10.0 | Storage persistente |
| concurrently | ^8.2.2 | Ejecutar Vite + Electron |
| wait-on | ^7.2.0 | Esperar a que Vite inicie |

---

## RESULTADOS DE LA MIGRACION

Despues de 1+ hora de pruebas con la aplicacion en segundo plano:

- **Sin gaps en graficos** al minimizar o cambiar de ventana
- **Datos en tiempo real** continuos via WebSocket
- **System tray** funcional para ejecucion 24/7
- **PowerSaveBlocker** previene suspension del sistema

**Objetivo cumplido**: La aplicacion desktop resuelve el problema de throttling del navegador.

---

## INICIO RAPIDO

### Opcion 1: START_ALL.bat (Recomendado)
```batch
# Doble-click en START_ALL.bat
# - Verifica si backend esta corriendo
# - Inicia backend automaticamente si es necesario
# - Espera hasta que responda (max 2 min)
# - Inicia Electron + Vite
```

### Opcion 2: Manual
```batch
# Terminal 1 - Backend
cd 2.WatchlistConIndicadores/backend
.venv\Scripts\activate
python -m uvicorn main:app --reload --port 8000

# Terminal 2 - Electron
cd 7.WatchlistDesktop
npm run dev:electron
```

---

## RESUMEN DE MEJORAS IMPLEMENTADAS

### Robustez y Estabilidad

| Funcionalidad | Archivo | Descripcion |
|---------------|---------|-------------|
| Health Check | `robustness.js` | Ping al backend cada 30s |
| ConnectionStatus | `ConnectionStatus.jsx` | Indicador visual verde/rojo |
| Validacion OHLC | `robustness.js` | Valida integridad de velas |
| Gap Detection | `CandleCache.js` | Detecta datos faltantes (>30%) |
| Retry con Backoff | `robustness.js` | 3 reintentos: 1s, 2s, 4s |
| Cache Cleanup | `robustness.js` | Elimina entradas >7 dias |
| Inicio Coordinado | `START_ALL.bat` | Backend + Electron secuencial |
| HTTP Client Pool | `vwap_service.py` | Reutiliza conexiones HTTP |
| Cache Cooldown | `CandleCache.js` | Previene ciclos infinitos de limpieza |

### Indicadores y Configuración

| Funcionalidad | Archivo | Descripcion |
|---------------|---------|-------------|
| OI Default Cumulative | `OpenInterestIndicator.js` | Modo acumulativo por defecto |
| OI Apply to All | `OpenInterestSettings.jsx` | Aplicar config a todas las monedas |
| VWAP Flickering Fix | `VWAPIndicator.js` | Reemplazo atomico de Map |
| VWAP Polling Fix | `VWAPIndicator.js` | Integrado con PollingScheduler |
| Swing Config Fixed | `swing_config.json` | BTCUSDT/ETHUSDT con days=90 |
| Auto-scroll Grafico | `MiniChart.jsx` | Seguir precio en tiempo real |
| Velas Duplicadas Fix | `MiniChart.jsx` | Deduplicacion con Map |

### Sistema de Alertas

| Funcionalidad | Archivo | Descripcion |
|---------------|---------|-------------|
| AlertToggle Component | `AlertToggle.jsx` | Toggle visual global de alertas |
| Global Status Endpoint | `main.py` | GET /api/alerts/global-status |
| Global Toggle Endpoint | `main.py` | POST /api/alerts/toggle-global |
| Swing Alerts Default | `swing_config.json` | alertsEnabled: false |
| DTB Alerts Default | `realtime_pattern_service.py` | alertsEnabled: false |
| Rejection Alerts Default | `realtime_pattern_service.py` | alertsEnabled: false |
| Config Persistence | `realtime_configs.json` | Todos alertsEnabled: false |
