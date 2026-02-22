# CLAUDE.md - Analizador Desktop (Electron)

Guia para Claude Code al trabajar con esta aplicacion de escritorio.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en espanol con el usuario.

### Perfil
Agente programador JavaScript/TypeScript con experiencia en Electron y React.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente salvo que se pida explicitamente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas.
5. **Encoding**: Evitar tildes y caracteres especiales en codigo fuente.

### Limitaciones conocidas
- No puedo ejecutar Electron directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL

**Analizador Desktop** es la version Electron del Analizador Cripto (App 4). Resuelve el problema de throttling del navegador que causa gaps en los graficos cuando el tab esta en segundo plano.

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `8.AnalizadorDesktop/` |
| Puerto Backend | 10000 (compartido con App 4) |
| Puerto Frontend Dev | 5174 |
| Electron | 33.x |
| Stack | React 18 + Vite + Electron |

---

## POR QUE ELECTRON?

Los navegadores aplican **throttling** a tabs en segundo plano:
- `setInterval`/`setTimeout` se ejecutan cada 1000ms minimo
- `requestAnimationFrame` se pausa completamente
- WebSockets pueden desconectarse por inactividad

Esto causa **gaps en los graficos** cuando el usuario cambia de tab.

**Electron desactiva estas restricciones** mediante flags de Chromium.

---

## ESTRUCTURA DEL PROYECTO

```
8.AnalizadorDesktop/
├── electron/
│   ├── main.js              # Proceso principal Electron
│   │                        # - Flags anti-throttling
│   │                        # - System tray
│   │                        # - Power save blocker
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz + robustness init
│   │   ├── MiniChart.jsx             # Grafico principal (~2500 lineas)
│   │   ├── SymbolList.jsx            # Lista lateral de monedas
│   │   ├── SymbolSelector.jsx        # Selector de simbolo
│   │   ├── ConnectionStatus.jsx      # Indicador visual de conexion (NUEVO)
│   │   ├── trading/
│   │   │   ├── TradingPanel.jsx      # Panel de trading
│   │   │   ├── OrderForm.jsx         # Formulario de orden
│   │   │   └── PositionCard.jsx      # Card de posicion
│   │   ├── indicators/
│   │   │   ├── IndicatorManager.js   # Orquestador (~1200 lineas) + realtime zone polling
│   │   │   ├── ZoneVisualizerIndicator.js # Renderiza zonas (manual + realtime)
│   │   │   ├── SwingDetectorIndicator.js
│   │   │   ├── VWAPIndicator.js
│   │   │   └── ... (13 indicadores)
│   │   ├── drawing/
│   │   │   ├── DrawingToolManager.js
│   │   │   ├── DrawingToolbar.jsx
│   │   │   └── shapes/*.js
│   │   ├── SlidingAlertPanel/
│   │   ├── ProximityAlerts/
│   │   └── *Settings.jsx             # Modales de configuracion
│   ├── utils/
│   │   ├── robustness.js             # Sistema centralizado de robustez
│   │   ├── PollingCoordinator.js     # Coordinador de polling para indicadores
│   │   ├── CandleCache.js            # Cache IndexedDB con validacion
│   │   ├── IndicatorCache.js
│   │   ├── Logger.js
│   │   └── PresetManager.js
│   ├── hooks/
│   │   └── useGlobalAlerts.js
│   ├── config.js                     # API_BASE_URL
│   ├── main.jsx                      # Entry point React
│   └── styles.css
│
├── assets/
│   └── icon.ico                      # Icono de la aplicacion
│
├── package.json                      # Scripts y config electron-builder
├── vite.config.js                    # Puerto 5174, proxy a backend
├── START_ALL.bat                     # Inicio coordinado Backend + Electron (NUEVO)
├── start_fast.bat                    # Inicio rapido
└── CLAUDE.md                         # Este archivo
```

---

## COMANDOS DE INICIO

### Desarrollo (recomendado)
```bash
npm run dev:electron
```
Inicia Vite en puerto 5174 + Electron apuntando a ese servidor.
Hot reload funciona para cambios en React.

### Produccion local
```bash
npm run start
```
Build de Vite + ejecuta Electron desde `dist/`.

### Build instalador
```bash
npm run build:electron      # Instalador .exe (NSIS)
npm run build:portable      # Portable sin instalacion
```
Output en `dist-electron/`.

---

## CONFIGURACION ANTI-THROTTLING

### electron/main.js

```javascript
// CRITICO: Debe ir ANTES de app.whenReady()

// Desactivar throttling del renderer en background
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Desactivar throttling de timers en background
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Desactivar throttling de ventanas ocultas
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
```

### BrowserWindow webPreferences

```javascript
webPreferences: {
  backgroundThrottling: false,  // CRITICO
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(__dirname, 'preload.js'),
}
```

### Optimizaciones GPU

```javascript
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
```

---

## SYSTEM TRAY

La aplicacion se minimiza al tray en lugar de cerrarse:

```javascript
mainWindow.on('close', (event) => {
  if (!app.isQuitting) {
    event.preventDefault();
    mainWindow.hide();
    // Notificacion la primera vez
  }
});
```

Menu del tray:
- **Abrir Analizador**: Muestra la ventana
- **Reiniciar**: `app.relaunch() + app.quit()`
- **Cerrar**: Cierra completamente

---

## POWER SAVE BLOCKER

Previene que el sistema entre en suspension:

```javascript
const powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
```

Se detiene automaticamente al cerrar la app.

---

## ARQUITECTURA RENDERER

### SingleSymbolAnalyzer.jsx

Componente raiz que maneja:
- Estado del simbolo actual
- Estado del timeframe (interval)
- Estado de dias historicos
- Estados de indicadores (toggle on/off)
- Modales de configuracion

**IMPORTANTE:** El setter de interval se llama `setIntervalState` (NO `setInterval`) para evitar conflicto con la funcion nativa de JavaScript.

```javascript
// CORRECTO
const [interval, setIntervalState] = useState("60");

// INCORRECTO - causa el bug "[object Promise]"
const [interval, setInterval] = useState("60");
```

### MiniChart.jsx

Componente mas grande (~2500 lineas). Responsabilidades:
- Renderizado del chart con canvas
- Carga de datos historicos (con cache)
- WebSocket para datos en tiempo real
- Sistema de zoom (horizontal y vertical)
- Sistema de dibujo (lineas, rectangulos, TPSL boxes)
- Integracion con IndicatorManager

**Refs importantes:**
- `candlesRef`: Datos de velas actuales
- `viewStateRef`: Estado de zoom y offset
- `drawingsRef`: Dibujos cargados del servidor
- `indicatorManagerRef`: Instancia del IndicatorManager

### Sistema de Zoom

```javascript
viewStateRef = {
  offset: 0,           // Desplazamiento horizontal
  zoom: 1,             // Factor de zoom (0.1 - 5)
  verticalOffset: 0,   // Desplazamiento vertical
  verticalZoom: 1,     // Zoom vertical
  userZoomed: false,   // True si el usuario hizo zoom manual
  zoomAutoFixed: false // True si el zoom fue auto-calculado
}
```

**Auto-correccion de zoom:**
```javascript
// Si mostramos menos del 20% de las velas disponibles, corregir
const showingTooFew = (displayCandles.length > 200 && preliminaryCandlesPerScreen < 200) ||
                      (displayCandles.length > 0 && preliminaryCandlesPerScreen < displayCandles.length * 0.2);

if (showingTooFew && !viewStateRef.current.userZoomed) {
  const targetCandles = Math.min(displayCandles.length * 0.6, 800);
  viewStateRef.current.zoom = chartWidth / (targetCandles * 8);
}
```

---

## CACHE DE VELAS (CandleCache.js)

Sistema de cache en IndexedDB para carga incremental:

```javascript
// Obtener velas (con validacion)
const cached = await CandleCache.getValidated(symbol, interval, days);

// Guardar velas
await CandleCache.set(symbol, interval, candles);

// Limpiar cache de un simbolo
await CandleCache.clear(symbol, interval);

// Limpiar todo el cache
await CandleCache.clearAll();
```

**Validacion automatica:**
Si el cache tiene menos del 70% de las velas esperadas, se limpia automaticamente.

---

## ATAJOS DE TECLADO

| Atajo | Accion |
|-------|--------|
| F12 | Abrir/cerrar DevTools |
| Ctrl+Shift+R | Forzar recarga (limpiar cache, resetear zoom) |
| Alt+T | Abrir/cerrar Trading Panel |
| ESC | Cerrar modo dibujo o cancelar operacion |
| Delete | Eliminar shape seleccionado |
| Ctrl+Z | Deshacer (en modo dibujo) |
| Ctrl+Y | Rehacer (en modo dibujo) |
| Flechas | Navegar lista de simbolos |

---

## DIFERENCIAS CON APP 4 (Browser)

| Caracteristica | App 4 (Browser) | App 8 (Electron) |
|----------------|-----------------|------------------|
| Throttling | Si (gaps) | No (sin gaps) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Instalable | No | Si (.exe) |
| Puerto frontend | 10001 | 5174 (dev) |
| DevTools | F12 browser | F12 manual |
| Recarga forzada | No | Ctrl+Shift+R |

---

## PROBLEMAS CONOCIDOS Y SOLUCIONES

### 1. Bug de 95 velas (RESUELTO)

**Sintoma:** Solo se muestran 95 velas en lugar de 1440+

**Causa:** Conflicto de nombres `setInterval` con la funcion nativa de JavaScript.

**Solucion:** Renombrar a `setIntervalState` en SingleSymbolAnalyzer.jsx.

### 2. Config corrupta "[object Promise]" (RESUELTO)

**Sintoma:** `swing_config.json` tiene `"interval": "[object Promise]"`

**Causa:** El bug de `setInterval` causaba que se guardara el string del Promise.

**Solucion:**
1. Backend valida valores de interval al cargar y guardar config
2. Valores invalidos se rechazan o corrigen automaticamente

### 3. Zoom no se ajusta (RESUELTO)

**Sintoma:** Chart muestra pocas velas aunque hay muchas disponibles.

**Solucion:** Auto-correccion agresiva del zoom cuando `preliminaryCandlesPerScreen < displayCandles * 0.2`.

### 4. Cache corrupto (RESUELTO)

**Sintoma:** IndexedDB tiene pocas velas, carga incremental no funciona.

**Solucion:** `CandleCache.getValidated()` limpia automaticamente cache con menos del 10% de velas esperadas.

---

## TROUBLESHOOTING

### Graficos con gaps
1. Verificar que Electron esta corriendo (no el browser)
2. Verificar flags anti-throttling en `electron/main.js`
3. Verificar PowerSaveBlocker esta activo (log en consola)

### Solo 95 velas
1. Presionar **Ctrl+Shift+R** para forzar recarga
2. Verificar consola por logs de zoom
3. Verificar que `swing_config.json` tiene interval valido ("1", "5", "60", etc)

### Backend no conecta
1. Verificar que backend corre en puerto 10000
2. Verificar proxy en `vite.config.js` (solo modo dev)
3. En produccion, verificar `API_BASE_URL` en `config.js`

### Icono no aparece en tray
1. Verificar que existe `assets/icon.ico`
2. Formato debe ser .ico (no .png)

### DevTools no abre
1. Presionar F12 (atajo configurado en main.js)
2. O usar menu de Electron: View -> Toggle Developer Tools

---

## ARCHIVOS CRITICOS

Archivos que NO deben modificarse sin cuidado:

1. **electron/main.js** - Flags anti-throttling, tray, power blocker
2. **SingleSymbolAnalyzer.jsx** - NO renombrar `interval` ni `setIntervalState`
3. **MiniChart.jsx** - Logica de zoom y cache
4. **config.js** - URL del backend
5. **vite.config.js** - Proxy y puerto de desarrollo

---

## FLUJO DE DATOS

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ANALIZADOR DESKTOP                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                                                   │
│  │   ELECTRON   │                                                   │
│  │   main.js    │ ─── Anti-throttling flags                         │
│  │              │ ─── Power save blocker                            │
│  │              │ ─── System tray                                   │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    RENDERER (React)                           │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │              SingleSymbolAnalyzer.jsx                    │ │  │
│  │  │  - Estado: symbol, interval, days, indicatorStates      │ │  │
│  │  │  - Modales de configuracion                              │ │  │
│  │  └────────────────────┬────────────────────────────────────┘ │  │
│  │                       │                                       │  │
│  │                       ▼                                       │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                   MiniChart.jsx                          │ │  │
│  │  │  - Canvas rendering                                      │ │  │
│  │  │  - WebSocket para precio en tiempo real                  │ │  │
│  │  │  - Sistema de zoom                                       │ │  │
│  │  │  - Sistema de dibujo                                     │ │  │
│  │  └────────────────────┬────────────────────────────────────┘ │  │
│  │                       │                                       │  │
│  │         ┌─────────────┼─────────────┐                        │  │
│  │         ▼             ▼             ▼                        │  │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │  │
│  │  │CandleCache│ │Indicator  │ │ Drawing   │                  │  │
│  │  │ IndexedDB │ │ Manager   │ │ Manager   │                  │  │
│  │  └───────────┘ └───────────┘ └───────────┘                  │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND (Puerto 10000)                            │
│                    (Compartido con App 4)                            │
│  - Datos historicos: /api/historical/{symbol}                       │
│  - Swing Detector: /api/swing/*                                      │
│  - VWAP Service: /api/vwap-service/*                                │
│  - Zone Detector: /api/zones/* (manual + realtime)                   │
│  - Dibujos: /api/drawings/{symbol}                                   │
│  - WebSocket: wss://stream.bybit.com                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## HISTORIAL DE CAMBIOS

### Febrero 2026 - Strategy Builder Realtime Service

1. **`strategy_realtime_service.py`** (nuevo, ~1317 lineas): Servicio completo de ejecucion en tiempo real de estrategias. Pre-calcula niveles una vez y los extiende incrementalmente por vela.
2. **6 endpoints en `main.py`**: toggle, status, config, signals/{symbol}, trades/{symbol}, clear-cooldowns.
3. **Startup/Shutdown**: Integrado en `startup_event()` y `shutdown_event()` de main.py con auto-inicio si `enabled=true`.
4. **UI en `StrategyBuilder.jsx`**: Boton "Realtime" en barra de acciones (naranja/verde), panel de estado con stats grid, niveles activos, trades abiertos con PnL, uptime y boton de limpiar cooldowns.
5. **Polling de estado**: Cada 5s cuando panel Realtime esta abierto, con auto-cleanup al cerrar.
6. **Alertas al TradingBot**: Formato `source: "STRATEGY_BUILDER"` con `custom_stop_loss` y `custom_take_profit`.
7. **Cooldowns**: Por `symbol_direction` (ej: BTCUSDT_LONG), configurable en minutos.
8. **6 fuentes de niveles soportadas**: vp_periodic, sr_v2, vwap_bands, swing_levels, dtb_neckline, vp_zones.
9. **Exit rules en tiempo real**: vwap_reverse, reenter_zone, squeeze_activate, timeout - evaluadas vela a vela.
10. **Log dedicado**: `logs/strategy_rt_alerts.log` con senales, alertas, cooldowns y trades cerrados.

### Febrero 2026 - Optimizador de Parametros (Grid Search)

1. **Endpoint `/api/zones/optimize`**: Grid search ejecutado en thread pool (`run_in_executor`) para no bloquear el event loop. Retorna JSON con top N resultados.
2. **Endpoint `/api/zones/optimize-estimate`**: Ejecuta 2 combos de prueba y extrapola el tiempo total. Permite al usuario decidir si ejecutar o no.
3. **IndicatorManager**: Metodos `estimateOptimization()` y `optimizeTradingZones()` con timeout de 60 minutos.
4. **UI de 2 pasos**: Click "Estimar y Ejecutar" → muestra estimacion (tiempo, combos, velas) con colores segun duracion → "Confirmar y Ejecutar" o "Cancelar".
5. **10 parametros optimizables**: atr_dyn_multiplier, atr_dyn_ma_period, atr_dyn_max_breakout, consol_max_range_pct, min_score_filter, lookforward_bars, atr_dyn_period, ttm_atr_length, ttm_kc_multiplier, ttm_min_squeeze_bars.
6. **Parametros fijos del modal**: Los parametros no seleccionados para optimizar se toman del estado actual del modal.
7. **Metricas objetivo**: expectancy, total_pnl_r, win_rate, profit_factor.
8. **Tabla de resultados**: Top 15 con WR%, W/L, PnL, Expectancy, Profit Factor, Max DD y boton "Aplicar".

### Febrero 2026 - Zone Detector Realtime + Fixes

1. **Realtime Zone Polling**: IndicatorManager ahora hace polling a `/api/zones/realtime/zones/{symbol}` cada 15s para renderizar zonas detectadas en tiempo real
2. **Separacion de fuentes de zonas**: ZoneVisualizerIndicator mantiene `_manualZones` y `_realtimeZones` separadas con `_mergeZones()` para deduplicacion (zonas manuales tienen prioridad)
3. **Estado OPEN para trades en progreso**: Trades que no han alcanzado TP/SL se muestran en amarillo/naranja con borde discontinuo y label "O", extendiendose hasta el borde derecho del chart
4. **Fix overwrite de zonas**: Antes el polling realtime sobrescribia las zonas manuales; ahora usan metodos separados (`setZones()` vs `setRealtimeZones()`)
5. **Fingerprint change detection**: El polling compara `start_timestamp_trade_result` para detectar transiciones OPEN->WIN/LOSS sin recargar todo
6. **Min lookback window**: Bajado de 100 a 5 velas en ZoneDetectorSettings.jsx

### Febrero 2026 - Fix VWAP tiempo real

1. **Fix PollingCoordinator**: Agregada inicializacion en SingleSymbolAnalyzer.jsx
2. **VWAPIndicator optimizado**: Logs reducidos a nivel warn, codigo limpio

### Enero 2026 - Creacion inicial

1. **Migracion desde App 4**: Copiado codigo base del Analizador Cripto
2. **Configuracion Electron**: main.js con anti-throttling y optimizaciones
3. **Bug 95 velas**: Corregido conflicto `setInterval` -> `setIntervalState`
4. **Validacion backend**: Agregada validacion de interval en swing_service.py
5. **Auto-zoom**: Implementada correccion automatica de zoom
6. **Force reload**: Atajo Ctrl+Shift+R para limpiar cache y resetear

---

## RELACION CON OTRAS APPS

```
8.AnalizadorDesktop
    │
    ├── Comparte backend con: 4.Analizador cripto (puerto 10000)
    │   - swing_service.py
    │   - vwap_service.py
    │   - Dibujos en backend/drawings/
    │
    ├── Comparte codigo frontend con: 4.Analizador cripto
    │   - Todos los indicadores (indicators/)
    │   - Sistema de dibujos (drawing/)
    │   - Componentes de settings (*Settings.jsx)
    │
    └── Se conecta a: 3.TradingBot_Python (puerto 5000)
        - Via Trading Panel
        - POST /api/trade/manual
```

---

## MEJORAS DE ROBUSTEZ (Enero 2026)

Se implementaron mejoras de robustez para mejorar la estabilidad y experiencia de usuario:

### Archivos nuevos creados

| Archivo | Descripcion |
|---------|-------------|
| `src/utils/robustness.js` | Sistema centralizado de robustez |
| `src/components/ConnectionStatus.jsx` | Indicador visual de conexion |
| `START_ALL.bat` | Script de inicio coordinado |

### Archivos modificados

| Archivo | Cambios |
|---------|---------|
| `src/utils/CandleCache.js` | Validacion de velas + MIN_CACHE_RATIO=0.7 + analyzeGaps() |
| `src/components/MiniChart.jsx` | fetchWithRetry para datos historicos |
| `src/components/SymbolList.jsx` | fetchWithRetry en prefetch |
| `src/components/SingleSymbolAnalyzer.jsx` | initRobustness + ConnectionStatus |

### Funcionalidades implementadas

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
   - Verifica si backend esta corriendo en puerto 10000
   - Inicia backend si es necesario
   - Espera hasta que responda (max 2 min)
   - Luego inicia Electron

### Verificacion

```bash
# Buscar en consola del frontend:
[Robustness] Initialized
[HealthCheck] Started (interval: 30000ms)
[CacheCleanup] Complete: X/Y candles, X/Y indicators removed
```

### Troubleshooting de robustez

**ConnectionStatus muestra "Offline" permanentemente:**
1. Verificar que el backend esta corriendo en puerto 10000
2. Click en el indicador rojo para forzar reconexion
3. Revisar consola por errores de health check

**Cache no se limpia / datos corruptos:**
1. Abrir DevTools (F12)
2. Application > IndexedDB > WatchlistCache
3. Borrar la base de datos
4. Recargar la aplicacion

**Error "uvicorn no se reconoce" en START_ALL.bat:**
- El script usa `python -m uvicorn` para compatibilidad

---

## FIX: VWAP NO GRAFICABA EN TIEMPO REAL (Febrero 2026)

### Problema

El indicador VWAP no se actualizaba en tiempo real. Solo mostraba datos al cargar inicialmente pero no hacia polling para actualizaciones.

### Causa Raiz

El `VWAPIndicator.js` usaba el `PollingCoordinator` para registrar callbacks de polling, pero el **PollingCoordinator nunca se iniciaba**. El archivo `SingleSymbolAnalyzer.jsx` no importaba ni llamaba a `pollingCoordinator.start()`.

### Diagnostico

Al revisar los logs de consola:
- NO aparecian mensajes `[VWAP]`
- NO aparecia `[PollingCoordinator] Started`
- Grep confirmo que `pollingCoordinator.start()` no se llamaba en ningun archivo

### Solucion

Se agrego la inicializacion del PollingCoordinator en `SingleSymbolAnalyzer.jsx`:

```javascript
// Import agregado (linea 26)
import pollingCoordinator from "../utils/PollingCoordinator";

// Inicializacion en useEffect (lineas 188-199)
useEffect(() => {
  initRobustness();
  pollingCoordinator.start();
  log.info('[PollingCoordinator] Started');

  return () => {
    stopRobustness();
    pollingCoordinator.stop();
    log.info('[PollingCoordinator] Stopped');
  };
}, []);
```

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `src/components/SingleSymbolAnalyzer.jsx` | Import y inicializacion de pollingCoordinator |
| `src/components/indicators/VWAPIndicator.js` | Limpieza de logs de debug (level: warn) |

### Leccion Aprendida

**CRITICO:** Cuando un indicador usa `PollingCoordinator.register()`, el coordinador DEBE iniciarse en el componente raiz con `pollingCoordinator.start()`. Sin esta llamada, los callbacks se registran pero los timers nunca se inician.

### Verificacion

Despues del fix, la consola debe mostrar:
```
[SingleSymbolAnalyzer] [PollingCoordinator] Started
[PollingCoordinator] Started
[PollingCoordinator] Registered: VWAP_BTCUSDT (interval: 60000ms, priority: 2)
```

---

## CHECKLIST DE DESARROLLO

Al modificar componentes React:
- [ ] Verificar que NO se usa `setInterval` como nombre de setter
- [ ] Verificar que zoom se resetea correctamente al cambiar simbolo
- [ ] Probar en modo desarrollo Y produccion
- [ ] Verificar que no hay memory leaks en indicadores

Al modificar Electron:
- [ ] Mantener flags anti-throttling ANTES de app.whenReady()
- [ ] No desactivar backgroundThrottling: false
- [ ] Probar minimizar a tray
- [ ] Probar power save blocker

Al agregar nuevas funcionalidades:
- [ ] Evitar tildes en strings (usar ASCII)
- [ ] Importar API_BASE_URL desde config.js
- [ ] Agregar logs de diagnostico donde sea util
- [ ] Probar en diferentes timeframes (1m, 1h, 1D)

---

## ZONE DETECTOR REALTIME (Febrero 2026)

Sistema que conecta la deteccion de zonas en tiempo real del backend con la visualizacion en el chart.

### Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                  ZONE DETECTOR REALTIME                       │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  BACKEND (zone_service.py)                                    │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ WebSocket candle close → _detect_and_alert()          │   │
│  │    → zone_detector.detect_zones()                     │   │
│  │    → _store_zones() → _recent_zones dict              │   │
│  │    → _send_alert() (si alertsEnabled=true)            │   │
│  └───────────────────────┬───────────────────────────────┘   │
│                          │                                    │
│  GET /api/zones/realtime/zones/{symbol}                       │
│                          │                                    │
│  FRONTEND                │                                    │
│  ┌───────────────────────┴───────────────────────────────┐   │
│  │ IndicatorManager._fetchRealtimeZones() (cada 15s)     │   │
│  │    → Compara fingerprint para detectar cambios        │   │
│  │    → zoneVisualizerIndicator.setRealtimeZones(zones)  │   │
│  │    → requestRedraw() fuerza repintado del chart       │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  ZoneVisualizerIndicator                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ _manualZones[] ← setZones() (boton "Detectar zonas") │   │
│  │ _realtimeZones[] ← setRealtimeZones() (polling)      │   │
│  │ zones[] = _mergeZones() (dedup, manual tiene prioridad)│   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `indicators/IndicatorManager.js` | Polling realtime zones, auto-deteccion servicio activo |
| `indicators/ZoneVisualizerIndicator.js` | Dual source (manual/realtime), estado OPEN, merge con dedup |
| `ZoneDetectorSettings.jsx` | Control start/stop polling al toggle, min window 5 |
| `4.Analizador cripto/backend/zone_detector.py` | PENDING → OPEN (no forzar WIN/LOSS) |

### IndicatorManager - Metodos de Realtime Zones

```javascript
// Auto-detecta si el servicio realtime esta activo al iniciar chart
async _checkAndStartRealtimeZonePolling()

// Inicia polling cada 15s (con respeto a visibility API)
startRealtimeZonePolling(intervalMs = 15000)

// Detiene polling
stopRealtimeZonePolling()

// Fetch y actualiza zonas (usa fingerprint para detectar cambios)
async _fetchRealtimeZones()
```

**Importante:** `startAllPolling()` llama a `_checkAndStartRealtimeZonePolling()` automaticamente. Si el servicio realtime esta activo, el polling comienza sin intervencion del usuario.

### ZoneVisualizerIndicator - Dual Source

```javascript
setZones(zones)         // Solo actualiza _manualZones
setRealtimeZones(zones) // Solo actualiza _realtimeZones
addZones(zones)         // Agrega a _manualZones (acumulativo)
clearZones()            // Limpia ambas fuentes
_mergeZones()           // Combina con dedup por start_timestamp + end_timestamp
```

**Deduplicacion:** Si una zona manual y una realtime tienen el mismo `start_timestamp` y `end_timestamp`, la zona manual tiene prioridad.

### Estados de Trade en Zonas

| Estado | Color | Borde | Extension | Label |
|--------|-------|-------|-----------|-------|
| WIN | Verde (`rgba(0,200,0,...)`) | Solido | Hasta `trade_close_timestamp` | W |
| LOSS | Rojo (`rgba(255,0,0,...)`) | Solido | Hasta `trade_close_timestamp` | L |
| OPEN | Amarillo (`rgba(255,180,0,...)`) | Discontinuo | Hasta borde derecho del chart | O |

### Fingerprint Change Detection

En lugar de comparar solo la cantidad de zonas, se usa un fingerprint para detectar cambios:

```javascript
const fingerprint = zones.map(z => `${z.start_timestamp}_${z.trade_result}`).join('|');
if (fingerprint !== this._lastRealtimeZoneFingerprint) {
  // Zonas cambiaron (ej: OPEN → WIN), actualizar chart
}
```

Esto permite detectar cuando un trade OPEN pasa a WIN/LOSS sin que cambie la cantidad de zonas.

### Config Realtime (zone_realtime_config.json)

```json
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

**Nota:** `alertsEnabled` controla si se envian alertas al TradingBot. La deteccion y visualizacion de zonas funciona independientemente de este flag.

### Troubleshooting Zone Detector Realtime

**Zonas realtime no aparecen en el chart:**
1. Verificar que el servicio realtime esta activo: `GET /api/zones/realtime/status`
2. Verificar que hay zonas almacenadas: `GET /api/zones/realtime/zones/{symbol}`
3. Buscar en consola: `[{symbol}] Realtime zones actualizadas: N zonas`
4. Si no hay logs de polling, verificar que PollingCoordinator esta iniciado

**Zonas manuales desaparecen al activar realtime:**
- Esto fue corregido con la separacion `_manualZones` / `_realtimeZones`
- Si persiste: verificar que el polling usa `setRealtimeZones()` (no `setZones()`)

**Trades siempre muestran LOSS en lugar de OPEN:**
- Verificar que el backend tiene el fix en `zone_detector.py` (PENDING → OPEN)
- El campo `trade_result` debe ser `"OPEN"` para trades no finalizados

**0 alertas aunque detecta zonas:**
- Verificar `alertsEnabled` en `zone_realtime_config.json`
- El checkbox "Alertas" en el modal ZoneDetectorSettings controla este flag

**Zonas con X que no deberian estar:**
- Puede ser una zona realtime que se solapa con zonas manuales
- La deduplicacion por `start_timestamp + end_timestamp` previene esto
- Si la zona tiene timestamps diferentes, ambas se muestran (correcto)

### Leccion Aprendida

**CRITICO:** Nunca usar `setZones()` para zonas realtime. Esto sobrescribe las zonas manuales. Siempre usar `setRealtimeZones()` para zonas del polling y `setZones()` solo para el boton "Detectar zonas".

### Fixes Febrero 2026 (sesion 2)

#### Bug 1: Zonas historicas WIN/LOSS re-registradas como OPEN

**Archivo:** `4.Analizador cripto/backend/zone_service.py` linea ~897

Condicion cambiada de `zone.trade_result not in ("SKIPPED", "NO_ENTRY", "")` a `zone.trade_result == "OPEN"`. Solo zonas marcadas explicitamente como OPEN se registran como trades abiertos.

#### Bug 2: Pending INSTANT_BREAKOUT con SL/TP absurdos

**Archivo:** `zone_service.py` en `_check_pending_breakouts()`

Validacion de proximidad: si la distancia entre entry price y zone edge supera `max_price_range_pct`, se bloquea (`BLOCKED_FAR_ENTRY`).

#### Bug 3: Multiples trades abiertos en modo sequential

**Archivo:** `zone_service.py` en `_register_open_trades()` y `_check_pending_breakouts()`

Verificacion de trades abiertos existentes antes de abrir nuevos en `position_mode == "sequential"`. Logs: `BLOCKED_SEQUENTIAL` y `BLOCKED_SEQUENTIAL_PENDING`.

#### Pausa de re-deteccion historica

Toggle que pausa `_detect_and_alert()` sin detener tracking de trades ni pending breakouts.

| Archivo | Cambio |
|---------|--------|
| `zone_service.py` | `self.detection_paused` flag + logica en `_on_candle_close` |
| `main.py` | `POST /api/zones/realtime/pause-detection` (toggle) |
| `ZoneDetectorSettings.jsx` | Boton naranja prominente + banner explicativo |

#### Boton "Detectar ahora (1 vez)"

Ejecuta `_detect_and_alert()` una sola vez SIN cambiar el estado de pausa.

| Archivo | Cambio |
|---------|--------|
| `zone_service.py` | Metodo `run_detection_once()` |
| `main.py` | `POST /api/zones/realtime/detect-now` |
| `ZoneDetectorSettings.jsx` | Boton azul visible solo cuando deteccion esta pausada |

#### Metodo de deteccion configurable

**Problema:** Las barras de metricas usaban `atr_dynamic` pero el servicio realtime tenia hardcodeado `"trading_zones"`. Las zonas detectadas no coincidian.

**Fix:** `detection_method` es ahora campo de `ZoneServiceConfig` y se persiste en `zone_realtime_config.json`. Tanto `_detect_and_alert()` como `_initial_detection()` usan el metodo configurado. Frontend envia `detection_method` y params `atr_dyn_*` al guardar config realtime.

#### Endpoints nuevos

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/zones/realtime/pause-detection` | POST | Toggle pausa de re-deteccion |
| `/api/zones/realtime/detect-now` | POST | Ejecutar deteccion una sola vez |

---

## OPTIMIZADOR DE PARAMETROS - GRID SEARCH (Febrero 2026)

Sistema para encontrar la mejor combinacion de parametros del Zone Detector mediante busqueda exhaustiva.

### Arquitectura

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPTIMIZER FLOW                                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. ESTIMAR                                                       │
│  ZoneDetectorSettings → IndicatorManager.estimateOptimization()  │
│      → POST /api/zones/optimize-estimate                          │
│      → Ejecuta 2 combos de prueba en thread pool                 │
│      → Retorna: avg_per_combo, estimated_seconds, total_combos   │
│                                                                   │
│  2. CONFIRMAR (usuario decide)                                    │
│  UI muestra: tiempo estimado, combos, velas                      │
│  Colores: verde (<1min), amarillo (<5min), rojo (>5min)          │
│                                                                   │
│  3. EJECUTAR                                                      │
│  ZoneDetectorSettings → IndicatorManager.optimizeTradingZones()  │
│      → POST /api/zones/optimize                                   │
│      → Grid search completo en thread pool (run_in_executor)     │
│      → Logs cada 10 combos en backend                            │
│      → Retorna top N resultados ordenados por metrica            │
│                                                                   │
│  4. RESULTADOS                                                    │
│  Tabla con top 15: params, WR%, W/L, PnL, Expect, PF, DD       │
│  Boton "Aplicar" por fila → carga params al modal               │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/zones/optimize-estimate` | POST | Ejecuta 2 combos de prueba y extrapola tiempo total |
| `/api/zones/optimize` | POST | Grid search completo, retorna top N resultados |

### Request Body (ambos endpoints)

```json
{
  "symbol": "BTCUSDT",
  "interval": "5",
  "days": 400,
  "base_params": { "lookforward_bars": 100, "entry_mode": "breakout_close", ... },
  "param_ranges": {
    "atr_dyn_multiplier": { "min": 0.5, "max": 2.0, "step": 0.25 },
    "ttm_kc_multiplier": { "min": 1.0, "max": 2.5, "step": 0.25 }
  },
  "metric": "expectancy",
  "top_n": 15
}
```

### Response de Estimacion

```json
{
  "success": true,
  "total_combos": 49,
  "candles": 115200,
  "fetch_time": 12.3,
  "avg_per_combo": 3.2,
  "estimated_seconds": 169.1,
  "sample_combos_run": 2
}
```

### Response de Optimizacion

```json
{
  "success": true,
  "total_combos": 49,
  "elapsed": 155.7,
  "fetch_time": 12.3,
  "candles": 115200,
  "metric": "expectancy",
  "results": [
    {
      "params": { "atr_dyn_multiplier": 1.0, "ttm_kc_multiplier": 1.5 },
      "total_zones": 25,
      "wins": 15, "losses": 8, "total_closed": 23,
      "win_rate": 65.2,
      "total_pnl_r": 22.0,
      "expectancy": 0.957,
      "profit_factor": 1.88,
      "max_drawdown_r": 4.0
    }
  ],
  "all_results_count": 49
}
```

### Parametros Optimizables

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

**Nota:** Los parametros TTM solo afectan si `use_ttm_prefilter=true` esta activado en el modal.

### Limites y Validaciones

- **Max combinaciones**: 5,000 (frontend y backend validan)
- **Max valores por parametro**: 20 (se submuestrean si excede)
- **Timeout frontend**: 60 minutos
- **Thread pool**: `run_in_executor(None, ...)` para no bloquear uvicorn

### Metricas de Optimizacion

| Metrica | Descripcion |
|---------|-------------|
| `expectancy` | PnL promedio por trade cerrado (en R) |
| `total_pnl_r` | PnL total acumulado (en R) |
| `win_rate` | Porcentaje de trades ganadores |
| `profit_factor` | Ganancia bruta / Perdida bruta |

### Archivos del Sistema

| Archivo | Responsabilidad |
|---------|-----------------|
| `4.Analizador cripto/backend/main.py` | Endpoints optimize + optimize-estimate |
| `src/components/indicators/IndicatorManager.js` | Metodos estimateOptimization() y optimizeTradingZones() |
| `src/components/ZoneDetectorSettings.jsx` | UI: estados, handlers, tabla de resultados |

### Leccion Aprendida: Event Loop Blocking

**CRITICO:** Nunca ejecutar codigo CPU-bound sincrono dentro de un `async def` en FastAPI/uvicorn. Esto bloquea el event loop completo, impidiendo que el servidor responda a cualquier request.

**Incorrecto:**
```python
@app.post("/api/endpoint")
async def handler():
    for combo in all_combos:  # BLOQUEA el event loop
        run_heavy_computation(combo)
```

**Correcto:**
```python
@app.post("/api/endpoint")
async def handler():
    def run_all():
        for combo in all_combos:
            run_heavy_computation(combo)
        return results

    loop = asyncio.get_event_loop()
    results = await loop.run_in_executor(None, run_all)  # Thread pool
```

### Troubleshooting

**Estimacion dice 0 segundos:**
- Puede ser que los datos estan en cache y la deteccion es muy rapida
- Verificar que hay velas suficientes: revisar `candles` en la respuesta

**Optimizacion se corta sin resultados:**
- Verificar timeout del frontend (60 min)
- Revisar logs del backend por errores en combos individuales
- Logs de progreso aparecen cada 10 combos: `[SYMBOL] [OPTIMIZE] Progreso: N/M`

**Error "name 'np' is not defined":**
- Ya corregido. La generacion de rangos usa Python puro (while loop) en vez de numpy

**Resultados TTM no cambian nada:**
- Verificar que `use_ttm_prefilter` esta activado en el modal
- Si esta desactivado, los parametros TTM se ignoran en la deteccion

---

## VP PERIODIC BACKTEST (Febrero 2026)

Sistema de backtesting de estrategias basadas en Volume Profile Periodic + VWAP Session.

### Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                  VP PERIODIC BACKTEST                         │
├──────────────────────────────────────────────────────────────┤
│                                                               │
│  FRONTEND                                                     │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ VPPeriodicBacktestSettings.jsx                        │   │
│  │   - Selector de estrategia (3 estrategias)            │   │
│  │   - Sliders de parametros por estrategia              │   │
│  │   - Barra de progreso visual (SSE)                    │   │
│  │   - Tabla de resultados (metricas)                    │   │
│  └───────────────────┬───────────────────────────────────┘   │
│                      │                                        │
│  ┌───────────────────┴───────────────────────────────────┐   │
│  │ IndicatorManager.runVPPeriodicBacktest()              │   │
│  │   - Conecta via EventSource (SSE)                     │   │
│  │   - Recibe progreso y resultado                       │   │
│  │   - Llama zoneVisualizerIndicator.setVPZones()        │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
│  BACKEND                                                      │
│  ┌───────────────────────────────────────────────────────┐   │
│  │ GET /api/vp-periodic/backtest-stream (SSE)            │   │
│  │   - Verifica cache de velas (2h TTL)                  │   │
│  │   - Ejecuta run_backtest() en thread pool             │   │
│  │   - Comunica progreso via queue.Queue                 │   │
│  │   - Envia eventos: progress, result, error            │   │
│  └───────────────────┬───────────────────────────────────┘   │
│                      │                                        │
│  ┌───────────────────┴───────────────────────────────────┐   │
│  │ backtest_vp_periodic.py                               │   │
│  │   - compute_vwap_session(): VWAP con bandas sigma     │   │
│  │   - compute_volume_profile(): POC, VAH, VAL           │   │
│  │   - strategy_poc_bounce()                             │   │
│  │   - strategy_va_breakout()                            │   │
│  │   - strategy_rejection_confluence()                   │   │
│  │   - calculate_metrics(): WR, PF, Expectancy, DD      │   │
│  └───────────────────────────────────────────────────────┘   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Archivos del Sistema

| Archivo | Descripcion |
|---------|-------------|
| `4.Analizador cripto/backend/backtest_vp_periodic.py` | Motor de backtest: 3 estrategias, VP, VWAP, metricas |
| `4.Analizador cripto/backend/main.py` (SSE endpoint) | `GET /api/vp-periodic/backtest-stream` con progreso |
| `src/components/VPPeriodicBacktestSettings.jsx` | Modal UI: estrategia, params, progreso, resultados |
| `src/components/indicators/IndicatorManager.js` | `runVPPeriodicBacktest()` via EventSource SSE |
| `src/components/indicators/ZoneVisualizerIndicator.js` | Renderiza trades como zonas VP via `setVPZones()` |

### Estrategias

| Estrategia | Logica | Parametros |
|------------|--------|------------|
| `poc_bounce` | Mean reversion al POC filtrado por VWAP | vp_period, tp_rr, bins |
| `va_breakout` | Breakout del Value Area + VWAP sigma | vp_period, tp_rr, confirm_bars, min_va_width_pct, bins |
| `rejection_confluence` | Rechazo VAH/VAL + confluencia VWAP + vela rechazo | vp_period, tolerance_pct, wick_ratio, bins |

### Endpoint SSE

```
GET /api/vp-periodic/backtest-stream?symbol=BTCUSDT&interval=1&days=400&strategy=poc_bounce&params_json={...}
```

**Eventos:**
- `progress`: `{phase, percent, message}` - Actualiza barra de progreso
- `result`: `{zones, stats, candles_count, elapsed_seconds}` - Resultado final
- `error`: `{message}` - Error

**Fases:** fetching(0-8%) → vwap(10%) → strategy(30%) → metrics(70%) → zones(80%) → done(100%)

### Cache de Velas

El endpoint usa `get_historical(skip_day_limit=True)` con cache en memoria:
- **TTL 2 horas**: Cache fresco retorna directo
- **Cache expirado**: Carga incremental (solo velas nuevas desde ultimo timestamp)
- **Sin cache**: Descarga completa de Bybit

### Frontend - Barra de Progreso

```jsx
// VPPeriodicBacktestSettings.jsx
{progress && (
  <div style={{ width: '100%', height: '22px', background: '#12122A', borderRadius: '11px' }}>
    <div style={{
      width: `${progress.percent}%`,
      background: 'linear-gradient(90deg, #1E88E5, #4FC3F7)',
      transition: 'width 0.4s ease',
    }} />
    <span>{progress.percent}%</span>
  </div>
)}
```

### Frontend - Conexion SSE

```javascript
// IndicatorManager.js - runVPPeriodicBacktest()
const eventSource = new EventSource(url);
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  if (data.type === 'progress') onProgress(data);
  else if (data.type === 'result') {
    eventSource.close();
    this.zoneVisualizerIndicator.setVPZones(data.zones);
    resolve({ success: true, ...data });
  }
};
```

### Troubleshooting

**Error "No se pudo conectar al backend":**
- Verificar backend corriendo en puerto 10000
- Si se modifico codigo, reiniciar backend (matar proceso viejo: `taskkill /F /IM python.exe`)
- Revisar consola backend por errores Python

**Backtest tarda mucho:**
- Primera ejecucion descarga velas de Bybit (~1-2 min para 400 dias en 1min)
- Siguientes usan cache en memoria (instantaneo si <2h)
- Cache expirado solo descarga velas nuevas (incremental)

**Barra de progreso no aparece:**
- Verificar que el frontend usa endpoint SSE (no POST)
- Revisar consola browser por errores EventSource

**Trades no se ven en el chart:**
- Verificar que ZoneVisualizerIndicator esta habilitado
- Las zonas VP usan `_source: 'vp'` para no mezclarse con zonas manuales/realtime

---

## MODULAR STRATEGY BUILDER (Febrero 2026)

Sistema de backtesting modular sin codigo. El usuario compone estrategias combinando 5 bloques independientes. Documentacion completa de parametros en `4.Analizador cripto/STRATEGY_BUILDER.md`.

### Archivos

| Archivo | Descripcion |
|---------|-------------|
| `4.Analizador cripto/backend/strategy_engine.py` | Motor completo (~2091 lineas): 6 level sources, 8 senales, 9 filtros, SL/TP, exit rules, backtest, optimizer |
| `src/components/StrategyBuilder.jsx` | UI completa (~2063 lineas): 5 bloques, backtest SSE, presets, optimizer, realtime, VP Zone Cache |
| `src/components/SingleSymbolAnalyzer.jsx` | Boton "Strategy" purpura + integracion del componente |
| `src/components/indicators/IndicatorManager.js` | 3 metodos: runStrategyBuilderBacktest, estimateStrategyOptimization, optimizeStrategyBuilder |
| `src/components/indicators/ZoneVisualizerIndicator.js` | Fuente `_strategyZones` como fuente independiente + colores purpura |

### 5 Bloques

1. **Level Sources** (6): vp_periodic, vp_zones, sr_v2, vwap_bands, swing_levels, dtb_neckline
2. **Entry Signals** (8): price_touch, swing_confirm, breakout_close, rejection_candle, pattern_match, squeeze_release, cvd_divergence, dtb_confirm
3. **Context Filters** (9, AND logic): vwap_trend, vwap_position, ttm_squeeze, bbwp_range, volume_zscore, cvd_trend, dtb_bias, direction, vp_shape
4. **Risk Management**: SL (4 metodos), TP (5 metodos), max_trades_per_segment, cooldown_bars
5. **Exit Rules** (4, OR logic): vwap_reverse, reenter_zone, squeeze_activate, timeout

### Bloque 1: Level Sources (Detalle)

| Fuente | Descripcion | Parametros clave |
|--------|-------------|------------------|
| `vp_periodic` | POC, VAH, VAL por segmento VP | `period` (50-1000), `bins` (20-100), `use_poc/vah/val`, `lookback_segments` (0-10) |
| `vp_zones` | VP Zone Scanner (perfiles D, P, b) | `detection_mode`, `window_size`, `bins`, `min_d_score`, `include_pb_shapes`, `max_range_pct`. Cache en disco (`zones_cache/`) |
| `sr_v2` | Swing points clusterizados | `swing_bars` (2-10), `cluster_distance_pct`, `min_touches`, `max_levels`, `recalc_every` |
| `vwap_bands` | VWAP + 5 niveles (central + 4 bandas sigma) | Usa `vwap_period` global |
| `swing_levels` | Swing Highs/Lows individuales | `swing_bars` (2-15). No agrupa en clusters |
| `dtb_neckline` | Necklines de Double Top/Bottom | `candles_per_extreme`, `price_margin_pct`, `min_candles_between` |

**Anti look-ahead en todos:** Los niveles solo son validos DESPUES de que la estructura se completa. VP Periodic tras cierre de segmento, Swing Levels tras confirmacion (i + swing_bars), etc.

### Bloque 2: Entry Signals (Detalle)

| Senal | Parametros | Logica |
|-------|-----------|--------|
| `price_touch` | `tolerance_pct` (0.05-1.0) | Precio toca nivel y cierra del lado correcto. LONG: low <= nivel + tol, close > nivel |
| `swing_confirm` | `swing_bars` (2-10), `tolerance_pct` | Swing H/L confirmado cerca de nivel. Entry en close de vela actual (no del pivot) |
| `breakout_close` | `confirm_bars` (1-5) | N cierres consecutivos al otro lado de nivel |
| `rejection_candle` | `wick_ratio` (0.6-5.0), `tolerance_pct` | Vela con wick largo rechazando nivel |
| `pattern_match` | `pattern_type` (engulfing/doji/any) | Hammer, Shooting Star, Engulfing, Doji cerca de nivel |
| `squeeze_release` | (sin params) | TTM Squeeze se libera. Direccion por pendiente VWAP ultimos 5 pasos |
| `cvd_divergence` | `lookback` (10-50) | Divergencia precio vs CVD: precio lower low + CVD higher low = LONG |
| `dtb_confirm` | `lookback` (10-100), `min_confidence` | Confirmacion DTB. Requiere `dtb_neckline` activo |

### Bloque 3: Context Filters (Detalle)

| Filtro | Parametros | Logica |
|--------|-----------|--------|
| `vwap_trend` | `lookback` (5-1000), `min_diff_pct` (0-2.0) | VWAP subiendo = LONG, bajando = SHORT. `min_diff_pct` descarta VWAP estancado |
| `vwap_position` | `mode` (trend/counter), `long_ref`, `short_ref` | `long_ref`/`short_ref` seleccionan banda de referencia: vwap, upper_1..3, lower_1..3 |
| `ttm_squeeze` | `require_squeeze` (on/off) | on = solo durante squeeze, off = solo sin squeeze |
| `bbwp_range` | `min_val`, `max_val` (0-100) | BBWP dentro del rango. 0-20 = compresion fuerte |
| `volume_zscore` | `min_zscore` (0.5-4.0), `lookback` | Volumen anomalo: > N desviaciones de la media |
| `cvd_trend` | `lookback` (10-50) | CVD neto positivo = LONG permitido, negativo = SHORT permitido |
| `dtb_bias` | `lookback`, `min_confidence` | Double Bottom reciente = solo LONG, Double Top = solo SHORT |
| `direction` | `allowed` (both/long/short) | Filtro global |
| `vp_shape` | `allowed_shapes` (multi-select: all/D/P/b/P_trimmed/b_trimmed/thin) | Solo filtra niveles VP (source `vp_*`/`vpz_*`). Otros niveles siempre pasan |

### Bloque 4: Risk Management (Detalle)

**Stop Loss (4 metodos):**

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| `below_level` | `buffer_pct` (0.01-1.0) | SL debajo/arriba del nivel + buffer %. El mas comun para S/R |
| `below_swing` | `buffer_pct` (0.01-1.0) | SL en ultimo pivot contrario + buffer. Usa `pivot_price` si senal fue `swing_confirm` |
| `atr_multiple` | `atr_multiplier` (0.5-5.0) | SL a N x ATR(14) del entry |
| `fixed_pct` | `fixed_pct` (0.1-5.0) | SL a % fijo del entry |

**Take Profit (5 metodos):**

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| `rr_fixed` | `rr` (0.5-10.0) | TP = entry + (riesgo * rr). Default: 2.0 |
| `opposite_level` | `fallback_rr` (1.0-5.0) | TP en nivel opuesto mas cercano. Fallback si no hay nivel o < 0.5R |
| `next_swing` | `fallback_rr` (1.0-5.0) | TP en ultimo swing contrario. Fallback si < 0.5R |
| `atr_multiple` | `atr_multiplier` (1.0-10.0) | TP a N x ATR(14) |
| `fixed_pct` | `fixed_pct` (0.5-10.0) | TP a % fijo |

**Otros:**
- `max_trades_per_segment` (1-10, default 1): Trades por segmento VP o fuente, misma direccion
- `cooldown_bars` (0-500, default 0): Espera GLOBAL despues de abrir trade. 0=desactivado

### Confluencia Multi-Source

- Modo `any`: Cualquier nivel individual dispara entrada
- Modo `score`: Score = min(100, fuentes_unicas_cerca * 15). Requiere `min_confluence_score`

### Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/strategy-builder/backtest-stream` | POST (SSE) | Backtest con progreso en tiempo real. Config va en body JSON, respuesta es SSE stream leido con fetch+ReadableStream (no EventSource) |
| `/api/strategy-builder/optimize-estimate` | POST | Estima tiempo del grid search (2 combos prueba) |
| `/api/strategy-builder/optimize` | POST | Grid search completo en thread pool |

### Cache de Velas (3 niveles)

1. **Memoria** (Dict Python, TTL 2h) → 2. **Disco** (`candle_cache/*.json.gz`, persistente) → 3. **Bybit API**

Primera ejecucion descarga de Bybit (1-2 min). Siguientes usan cache disco (~1-2s) o memoria (instantaneo). VP Zones tiene cache separado en `zones_cache/`.

### Sistema de Presets

Backend-based (no localStorage). Guardar/Cargar/Eliminar configuraciones completas de los 5 bloques.

### Filter Stats (Diagnostico)

El backtest retorna `filter_stats` con contadores de donde se pierden senales: `signals_generated`, `filtered_direction`, `filtered_confluence`, `filtered_max_trades_seg`, `filtered_cooldown`, `filtered_context.{tipo}`, `filtered_sl_invalid`, `filtered_tp_invalid`, `trades_opened`.

### Visualizacion en Chart

Zonas del Strategy Builder se renderizan con colores purpura (`_source: 'strategy'`).

ZoneVisualizerIndicator mantiene 4 fuentes independientes:
- `_manualZones` - Boton "Detectar zonas"
- `_realtimeZones` - Polling realtime
- `_vpZones` - VP Periodic Backtest
- `_strategyZones` - Strategy Builder

### Grid Search Optimizer

Parametros optimizables generados dinamicamente segun bloques activos. Formato path-based: `level.vp_periodic.period`, `entry.params.tolerance_pct`, `risk.tp_params.rr`, etc.

- **Flujo:** Estimar (2 combos prueba) → Confirmar → Ejecutar → Tabla Top 15 → "Aplicar"
- **Limites:** Max 5,000 combinaciones, max 20 valores por parametro. Timeout 60 min.
- **Metricas:** expectancy, total_pnl_r, win_rate, profit_factor

### Estructura de Config (JSON)

```json
{
  "level_sources": [
    {"source": "vp_periodic", "enabled": true, "params": {"period": 240, "bins": 50}},
    {"source": "vp_zones", "enabled": false, "params": {"detection_mode": "fixed_window"}}
  ],
  "entry_signal": {"signal_type": "price_touch", "params": {"tolerance_pct": 0.15}},
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

### Arquitectura Tecnica

**Backend (`strategy_engine.py`, ~2091 lineas):**
```
run_modular_backtest(candles, config, progress_callback, symbol, interval, days)
    ├── compute_vp_levels() / compute_vp_zone_levels() / compute_sr_levels()
    ├── compute_vwap_band_levels() / compute_swing_as_levels() / compute_dtb_levels()
    ├── Para cada vela:
    │   ├── Filtrar niveles validos → evaluar entry signal
    │   ├── Filtrar: direction, confluence, max_trades, cooldown, context filters
    │   ├── Calcular SL/TP → abrir trade si pasa todo
    ├── resolve_trade_with_exit_rules() para cada trade
    └── calculate_metrics() + construir zonas para chart
```

**Frontend (`StrategyBuilder.jsx`, ~2063 lineas):**
```
handleRunBacktest() → buildConfigPayload(~30 useState hooks)
    → manager.runStrategyBuilderBacktest() via fetch POST + ReadableStream (no EventSource)
    → progress events → result → setStrategyZones(zones)
```

### Bugs Corregidos (Febrero 2026)

1. **`resolve_trade` no existia** - Fix: reutilizar `resolve_trade_with_exit_rules()` con lista vacia.
2. **Zona visual min/max incorrectos para SHORT** - Fix: `min(sl, tp, entry)` y `max(sl, tp, entry)`.

### Troubleshooting Strategy Builder

**Boton "Strategy" no aparece:**
- Verificar import en `SingleSymbolAnalyzer.jsx`
- Verificar `showStrategyBuilder` state y `setShowStrategyBuilder` handler

**Backtest retorna 0 trades:**
- Activar al menos 1 Level Source
- Reducir tolerancia del entry signal
- Probar sin context filters primero
- Aumentar dias de datos
- Revisar `filter_stats` para diagnosticar donde se pierden senales

**Backtest tarda mucho:**
- Primera ejecucion descarga de Bybit (1-2 min). Siguientes usan cache disco (instantaneo)
- VP Zones es pesado - considerar VP Periodic
- Reducir dias para iteraciones rapidas

**Zonas purpura no aparecen:**
- Verificar que ZoneVisualizerIndicator esta habilitado
- Verificar `setStrategyZones()` se llama con zonas del resultado

**Leccion:** `resolve_trade_with_exit_rules()` funciona para ambos casos (con y sin exit rules). Pasar `exit_rules=[]` la hace funcionar como resolve_trade simple.

---

## STRATEGY BUILDER REALTIME SERVICE (Febrero 2026)

Servicio de ejecucion en tiempo real de estrategias del Strategy Builder. Permite activar una estrategia configurada y ejecutarla en vivo, generando alertas al TradingBot.

### Diferencia con Backtest

| Aspecto | Backtest | Realtime |
|---------|----------|----------|
| Ejecucion | Unica, sobre historico | Continua, vela a vela |
| Niveles | Sobre todo el dataset | Pre-calculados + incrementales |
| SL/TP | Lookforward (mira futuro) | Monitoreo vela a vela |
| Alertas | No envia | POST al TradingBot (5000) |

### Principio Arquitectonico

Los niveles NO se re-detectan en cada vela. Se pre-calculan al activar y se extienden incrementalmente:

| Fuente | Recalculo |
|--------|-----------|
| `vp_periodic` | Nuevo segmento completado (cada `period` velas) |
| `sr_v2` | Cada `sr_recalc_every` velas (default 100) |
| `vwap_bands` | Cada vela (VWAP es dinamico) |
| `swing_levels` | Cada N velas (check confirmacion) |
| `dtb_neckline` | Cada `dtb_recalc_every` velas (default 50) |
| `vp_zones` | Nuevo segmento VP (usa cache) |

### Archivos

| Archivo | Descripcion |
|---------|-------------|
| `4.Analizador cripto/backend/strategy_realtime_service.py` | Servicio completo (~1317 lineas) |
| `4.Analizador cripto/backend/config/strategy_rt_config.json` | Config persistente |
| `4.Analizador cripto/backend/logs/strategy_rt_alerts.log` | Log de alertas |
| `4.Analizador cripto/backend/main.py` (lineas 9530+) | 6 endpoints API |
| `src/components/StrategyBuilder.jsx` | UI: boton Realtime, panel, toggle, stats |

### Clases Principales

```python
@dataclass
class StrategyRTConfig:
    enabled: bool = False
    symbols: List[str] = ["BTCUSDT"]
    interval: str = "5"
    window_candles: int = 2000
    strategy: Dict = {}                 # Mismo formato que SB config
    alertsEnabled: bool = True
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
    cooldownMinutes: int = 30
    dtb_recalc_every: int = 50
    sr_recalc_every: int = 100

@dataclass
class RTLevel:
    price: float
    level_type: str       # 'support' | 'resistance'
    source: str           # 'vp_periodic' | 'sr_v2' | 'vwap_bands' | etc
    strength: float = 1.0
    valid_from_idx: int = 0
    valid_until_idx: Optional[int] = None
    extra: Dict = {}
```

### Flujo Completo

```
1. ACTIVACION: POST /api/strategy-builder/realtime/toggle {enabled: true, strategy: {...}}
      ↓
2. STARTUP: Registra WebSocket listener, suscribe simbolos
      ↓
3. INICIALIZACION (background):
   - Fetch historico (window_candles velas)
   - _precompute_levels() → calcula TODOS los niveles
      ↓
4. POR CADA CIERRE DE VELA:
   a) Agrega vela al buffer
   b) _update_levels_incremental() → recalcula solo lo necesario
   c) _check_open_trades() → verifica SL/TP hit
   d) _check_exit_rules() → reglas de salida adaptativas
   e) _evaluate_entry() → evalua senal contra niveles activos
      ↓
5. SI HAY SENAL: Calcula SL/TP → verifica cooldown → abre trade → alerta
      ↓
6. MONITOREO: Cada vela verifica SL/TP y exit rules para trades abiertos
```

### Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/strategy-builder/realtime/toggle` | POST | Activa/desactiva. Acepta strategy, symbols, interval |
| `/api/strategy-builder/realtime/status` | GET | Estado: running, stats, open trades, niveles, buffers |
| `/api/strategy-builder/realtime/config` | POST | Actualiza config. Si strategy cambio, reinicia |
| `/api/strategy-builder/realtime/signals/{symbol}` | GET | Senales recientes |
| `/api/strategy-builder/realtime/trades/{symbol}` | GET | Trades abiertos + historial (ultimos 50) |
| `/api/strategy-builder/realtime/clear-cooldowns` | POST | Limpia cooldowns (testing) |

### Formato de Alerta al TradingBot

```json
{
  "source": "STRATEGY_BUILDER",
  "symbol": "BTCUSDT",
  "interval": "5",
  "pattern": {
    "patternType": "STRATEGY_SIGNAL",
    "price": 95000.0,
    "confidence": 75,
    "direction": "LONG",
    "signalType": "price_touch",
    "levelSource": "vp_periodic",
    "levelPrice": 95050.0
  },
  "custom_stop_loss": 94500.0,
  "custom_take_profit": 96000.0
}
```

### Integracion Frontend (StrategyBuilder.jsx)

**Estado:**
```javascript
const [showRealtime, setShowRealtime] = useState(false);
const [rtStatus, setRtStatus] = useState(null);
const [rtLoading, setRtLoading] = useState(false);
const rtPollRef = useRef(null);
```

**Polling:** Cada 5s cuando panel Realtime esta abierto.

**Toggle:** Al activar envia estrategia actual (`buildConfigPayload()`), simbolo e intervalo.

**Panel Realtime muestra:**
- Stats grid: velas procesadas, senales, filtradas, alertas
- Niveles por simbolo: total y activos
- Trades abiertos: Entry, SL, TP, PnL parcial con colores
- Uptime del servicio
- Boton "Limpiar Cooldowns"

**Boton en barra de acciones:**
- Naranja cuando detenido, verde cuando activo
- Texto "RT ON" (activo) / "Realtime" (inactivo)

### Startup/Shutdown Backend

```python
# main.py - startup_event()
strat_rt = get_strategy_rt_service()
if strat_rt.config.enabled:
    await strat_rt.start()

# main.py - shutdown_event()
strat_rt = get_strategy_rt_service()
await strat_rt.stop()
```

### Troubleshooting

**Servicio no inicia:**
- Verificar que hay estrategia configurada (strategy no vacio en config)
- Revisar logs backend por `[STRAT_RT]`

**0 senales generadas:**
- Verificar niveles pre-calculados: status muestra `levels.total > 0`
- Probar con tolerancia mas amplia en entry signal
- Verificar filtros de contexto no estan bloqueando todo

**Alertas no llegan al TradingBot:**
- Verificar `alertsEnabled: true`
- Verificar TradingBot corriendo en puerto 5000
- Revisar `logs/strategy_rt_alerts.log`

**Stats "signals_filtered" alto:**
- Filtros de contexto bloqueando senales
- Desactivar filtros temporalmente para diagnosticar

---

## FIX: SEGUNDO BACKTEST BLOQUEA LA APP (Febrero 2026)

### Problema

El primer backtest del Strategy Builder se ejecutaba correctamente (~12.9s), pero al intentar un segundo backtest la aplicacion se congelaba completamente.

### Causa Raiz

**Cascada de fallos** que se acumulaban despues del primer backtest:

1. **Servicios no deseados corriendo**: Strategy RT y Real-time Pattern Detection auto-iniciaban en startup, consumiendo recursos del event loop
2. **Polling de drawings cada 3s**: Inundaba el backend con `GET /api/drawings/BTCUSDT` constantemente
3. **VWAP reload sin cooldown**: Despues del primer backtest, multiples reloads simultaneos a Bybit API causaban rate limit
4. **Fetches VWAP concurrentes**: Sin guard contra solapamiento, amplificaban el rate limit

### Fixes Aplicados

| Archivo | Cambio |
|---------|--------|
| `src/components/MiniChart.jsx` | Drawings polling 3s → 30s |
| `4.Analizador cripto/backend/main.py` | VWAP reload cooldown 30s por simbolo |
| `src/components/indicators/VWAPIndicator.js` | Guard `_fetching` contra fetches simultaneos |
| `4.Analizador cripto/backend/main.py` (startup) | Strategy RT force-disabled, Real-time pattern SKIPPED |

### Detalles de Implementacion

**1. Drawings polling (MiniChart.jsx linea 2567):**
```javascript
// 30s en vez de 3s - suficiente para sincronizacion
}, 30000);
```

**2. VWAP reload cooldown (main.py):**
```python
_vwap_reload_cooldown: Dict[str, float] = {}
_VWAP_RELOAD_COOLDOWN_SECS = 30

# En get_vwap_service_data():
if config_changed or needs_more_data:
    now = time.time()
    last_reload = _vwap_reload_cooldown.get(symbol, 0)
    if now - last_reload < _VWAP_RELOAD_COOLDOWN_SECS:
        pass  # En cooldown - retornar datos existentes
    else:
        _vwap_reload_cooldown[symbol] = now
        await vwap_service.reload_symbol_data(...)
```

**3. VWAP concurrent fetch guard (VWAPIndicator.js):**
```javascript
this._fetching = false; // En constructor

async fetchData(skipCache = false) {
  if (this._fetching) return false;
  this._fetching = true;
  try { /* ... */ }
  finally { this._fetching = false; }
}
```

**4. Startup services (main.py startup_event):**
```python
# Real-time pattern service - SKIPPED (deprecated)
print("[STARTUP] Real-time pattern detection service SKIPPED")

# Strategy RT - NEVER auto-start
strat_rt = get_strategy_rt_service()
if strat_rt.config.enabled:
    strat_rt.config.enabled = False
    strat_rt._save_config()
```

### Leccion Aprendida

**CRITICO:** El backend debe reiniciarse para que cambios en `main.py` tomen efecto. Si el log muestra servicios que deberian estar desactivados, el backend NO fue reiniciado.

**Cascadas de rate limit:** Un endpoint sin cooldown que llama APIs externas (Bybit) puede causar cascada que bloquea toda la app. Siempre agregar cooldowns + guards contra requests concurrentes.

---

## FIX DEFINITIVO: BACKTESTS CONSECUTIVOS FALLAN (Febrero 2026)

### Problema

Despues de los fixes anteriores (cooldowns, guards, etc.), los backtests consecutivos seguian fallando. El 2do-5to backtest se quedaba en "Conectando con backend..." indefinidamente. El backend no recibia ningun request.

### Causa Raiz: Limite de 6 conexiones de Chromium

**`EventSource` (GET) compite por las mismas 6 conexiones HTTP por host** que el polling de indicadores (VWAP, Swing, drawings, realtime zones, etc.).

Flujo del problema:
1. Backtest #1 termina, `EventSource.close()` se llama
2. `pauseAllPolling()` detiene TIMERS pero NO cancela requests HTTP ya en vuelo
3. `resumeAllPolling()` reinicia polling → 6 slots se llenan con polling requests
4. Backtest #2 intenta abrir `new EventSource(url)` → queda en cola esperando slot libre
5. El request NUNCA llega al backend

`pauseAllPolling()` para timers futuros, pero las conexiones keep-alive de requests anteriores siguen ocupando slots. `EventSource` necesita un slot dedicado que no puede obtener.

### Solucion: Eliminar EventSource, usar fetch POST + ReadableStream

| Aspecto | Antes (EventSource) | Despues (fetch POST) |
|---------|--------------------|--------------------|
| Metodo HTTP | GET (config en URL) | POST (config en body JSON) |
| Lectura stream | `EventSource.onmessage` | `response.body.getReader()` + `TextDecoder` |
| Cancelacion | `.close()` (no siempre libera slot) | `AbortController.abort()` (inmediato) |
| Limite URL | Si (config grande = URL larga) | No (config en body) |
| Conexion persistente | Si (mantiene slot ocupado) | No (`fetch` libera al terminar) |

### Cambios Backend (`main.py`)

```python
# ANTES: GET con config en query params
@app.get("/api/strategy-builder/backtest-stream")
async def handler(request: Request, symbol: str = "BTCUSDT", ...):
    config_json = request.query_params.get("config", "{}")

# DESPUES: POST con config en body JSON
@app.post("/api/strategy-builder/backtest-stream")
async def handler(request: Request):
    body = await request.json()
    symbol = body.get("symbol", "BTCUSDT")
    strategy_config = body.get("config", {})
```

La respuesta `StreamingResponse` con formato SSE es identica.

### Cambios Frontend (`IndicatorManager.js`)

```javascript
// ANTES: EventSource (GET, compite por 6 conexiones)
const url = `${API_BASE_URL}/api/strategy-builder/backtest-stream?symbol=...&config=...`;
const eventSource = new EventSource(url);
eventSource.onmessage = (event) => { ... };

// DESPUES: fetch POST + ReadableStream (no compite por conexiones)
const response = await fetch(`${API_BASE_URL}/api/strategy-builder/backtest-stream`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ symbol, interval, days, config }),
  signal: controller.signal,  // AbortController para cancelacion
});
const reader = response.body.getReader();
const decoder = new TextDecoder();
// Lee lineas SSE "data: {...}\n\n" del stream
```

### Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `4.Analizador cripto/backend/main.py` | Endpoint GET → POST, lee config de body |
| `src/components/indicators/IndicatorManager.js` | EventSource → fetch POST + ReadableStream |

### Leccion Aprendida

**CRITICO:** En Electron/Chromium, NUNCA usar `EventSource` para operaciones que compiten con polling HTTP. `EventSource` mantiene una conexion persistente que ocupa uno de los 6 slots por host. Si hay polling activo, los slots se agotan y `EventSource` queda en cola indefinidamente. Usar `fetch POST + ReadableStream` que no mantiene slot persistente y es cancelable con `AbortController`.

---

## FIX: RESULTADOS DE BACKTEST NO DETERMINISTICOS (Febrero 2026)

### Problema

El Strategy Builder producia resultados diferentes con los mismos parametros. Ejecutar backtest con params A → cambiar a B → volver a A daba resultados distintos (30% WR → 12% WR). Afectaba TODOS los trades.

### Causa Raiz

El array de velas cambiaba de tamano entre ejecuciones por cache incremental (+5-10 velas). Esto desplazaba TODOS los segmentos de VP Periodic (`range(0, len(candles), period)`) y los indices de niveles (`valid_from_idx`/`valid_until_idx`). Ademas, el VP Zone Cache no incluia `candles_count` en su fingerprint, retornando zonas calculadas con arrays de tamano diferente.

### Fixes

| Fix | Archivo | Cambio |
|-----|---------|--------|
| Trimming determinista | `main.py` (3 endpoints SB) | `candles = candles[-target_candles:]` antes de procesar |
| VP Zone fingerprint | `zone_vp_scanner.py` | `candles_count` en hash SHA256 de load/save |
| VP Zone pass-through | `strategy_engine.py` | `len(candles)` pasado a `load_zone_cache` |
| VP Zone load | `main.py` (VP Zone endpoint) | `_target_candles_vp` calculado y pasado a `load_zone_cache` |
| Hash diagnostico | `main.py` + `StrategyBuilder.jsx` | MD5 hash de velas visible en UI con checkbox |

### Verificacion

Checkbox "Mostrar hash de determinismo" en el Strategy Builder muestra badge purpura con hash. Mismo hash = mismas velas = resultados identicos. Click para copiar.

### Leccion

Cuando un sistema usa indices de array como referencia (`valid_from_idx`), el tamano del array es estado global implicito. Cualquier variacion desplaza TODAS las referencias. Garantizar tamano determinista ANTES de procesar.
