# CLAUDE.md - Order Flow Desktop

Guia para Claude Code al trabajar con esta aplicacion.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en espanol con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en espanol.

### Perfil
Agente programador JavaScript/Python con experiencia en aplicaciones de trading y Electron.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente salvo que se pida explicitamente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas.
5. **Encoding**: Evitar tildes y caracteres especiales en codigo fuente para prevenir problemas de encoding.

---

## VISION GENERAL

**Order Flow Desktop** es la version de escritorio (Electron) del analizador de Order Flow.
Resuelve el problema critico de throttling del navegador que causaba gaps en los graficos durante periodos de inactividad.

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `9.OrderFlowDesktop/` |
| Puerto Frontend Dev | 11001 |
| Puerto Backend | 11000 (usa backend de `5.Order_flow/`) |
| Stack | Electron 33 + React 18 + Vite 5 + uPlot |
| Base frontend | Copiado de `5.Order_flow/frontend/` |
| Base Electron | Copiado de `7.WatchlistDesktop/electron/` |

---

## PROBLEMA RESUELTO

### Antes (Browser)

| Problema | Causa |
|----------|-------|
| Gaps en graficos al minimizar | Chromium throttlea el renderer en background |
| Graficos congelados al apagar pantalla | Timer throttling reduce frecuencia de render |
| WebSocket se desconecta | Browser reduce conexiones de red en background |
| Datos desactualizados al volver | El browser "pausa" la app completamente |
| Alertas retrasadas | Calculos del frontend pausados |

### Ahora (Electron)

| Solucion | Implementacion |
|----------|----------------|
| Renderer siempre activo | `disable-renderer-backgrounding` |
| Timers sin pausar | `disable-background-timer-throttling` |
| Conexiones mantenidas | `backgroundThrottling: false` en webPreferences |
| PC no entra en suspension | `powerSaveBlocker.start('prevent-app-suspension')` |
| Ejecucion en segundo plano | System Tray con minimizar a bandeja |

### Resultado de Pruebas (Enero 2026)

- **Prueba de inactividad**: 10+ minutos con pantalla apagada
- **Resultado**: Graficos sin gaps, datos actualizados al volver
- **Footprints**: Continuaron procesandose cada minuto sin interrupcion
- **WebSocket**: Conexion mantenida durante toda la prueba

---

## ARQUITECTURA

```
┌─────────────────────────────────────────────────────────────────┐
│                    9.OrderFlowDesktop                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 ELECTRON (Main Process)                   │   │
│  │  - disable-renderer-backgrounding                        │   │
│  │  - disable-background-timer-throttling                   │   │
│  │  - powerSaveBlocker.start('prevent-app-suspension')      │   │
│  │  - System Tray para ejecucion en background              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↕ IPC                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 RENDERER (React + uPlot)                  │   │
│  │  - SingleSymbolAnalyzer.jsx (componente raiz)            │   │
│  │  - MiniChart.jsx (grafico principal)                     │   │
│  │  - OrderFlowIndicator.js (footprint overlay)             │   │
│  │  - backgroundThrottling: false en webPreferences         │   │
│  │  - Solo visualizacion, SIN calculos pesados              │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND (5.Order_flow - Puerto 11000)               │
│  ✅ SIN CAMBIOS - Reutiliza el backend existente                 │
│  - Trade Aggregator (acumula trades por vela)                   │
│  - Footprint Calculator (Step Size Absoluto)                    │
│  - Footprint Storage (Persistencia JSON)                        │
│  - WebSocket Bybit (publicTrade para 21 simbolos)               │
│  - Alert Sender → Trading Bot (puerto 5000)                     │
└─────────────────────────────────────────────────────────────────┘
```

---

## ESTRUCTURA DE ARCHIVOS

```
9.OrderFlowDesktop/
├── electron/
│   ├── main.js                    # Proceso principal Electron
│   │                              # - Anti-throttling configuration
│   │                              # - PowerSaveBlocker
│   │                              # - System Tray
│   │                              # - Window management
│   └── preload.js                 # Bridge seguro renderer ↔ main
│                                  # - electronAPI exposed
│                                  # - Notificaciones nativas
│
├── src/                           # Frontend React (copiado de 5.Order_flow)
│   ├── main.jsx                   # Entry point React
│   ├── config.js                  # API_BASE_URL = localhost:11000
│   ├── styles.css                 # Estilos globales
│   │
│   ├── components/
│   │   ├── SingleSymbolAnalyzer.jsx   # Componente raiz
│   │   ├── MiniChart.jsx              # Grafico principal con canvas
│   │   ├── SymbolList.jsx             # Lista lateral de simbolos
│   │   ├── SymbolSelector.jsx         # Selector de simbolo
│   │   │
│   │   ├── OrderFlowSettings.jsx      # Modal config Order Flow
│   │   ├── VWAPSettings.jsx           # Modal config VWAP
│   │   ├── SwingDetectorSettings.jsx  # Modal config Swing
│   │   ├── [otros]Settings.jsx        # Modales de indicadores
│   │   │
│   │   ├── indicators/
│   │   │   ├── IndicatorManager.js    # Orquestador de indicadores
│   │   │   ├── OrderFlowIndicator.js  # Renderiza footprint
│   │   │   ├── VWAPIndicator.js       # VWAP backend-native
│   │   │   ├── SwingDetectorIndicator.js
│   │   │   ├── CVDIndicator.js
│   │   │   └── [otros]Indicator.js
│   │   │
│   │   ├── drawing/
│   │   │   ├── DrawingToolManager.js  # Gestor de herramientas
│   │   │   ├── DrawingToolbar.jsx     # Barra de herramientas
│   │   │   └── shapes/                # Formas: Rectangle, Line, etc.
│   │   │
│   │   ├── trading/
│   │   │   ├── TradingPanel.jsx       # Panel de trading
│   │   │   ├── OrderForm.jsx          # Formulario de ordenes
│   │   │   └── PositionCard.jsx       # Tarjeta de posicion
│   │   │
│   │   ├── SlidingAlertPanel/         # Panel de alertas
│   │   └── ProximityAlerts/           # Sistema de alertas de proximidad
│   │
│   ├── hooks/
│   │   └── useGlobalAlerts.js         # Hook para alertas globales
│   │
│   └── utils/
│       ├── CandleCache.js             # Cache IndexedDB para velas
│       ├── IndicatorCache.js          # Cache para indicadores
│       ├── Logger.js                  # Sistema de logging
│       └── [otros].js
│
├── assets/
│   └── icon.ico                   # Icono de la aplicacion (opcional)
│
├── dist/                          # Build de produccion (generado)
├── dist-electron/                 # Instaladores (generado)
├── node_modules/                  # Dependencias (generado)
│
├── package.json                   # Configuracion npm + electron-builder
├── vite.config.js                 # Configuracion Vite
├── index.html                     # HTML principal
│
├── 1_INSTALL.bat                  # Script: npm install
├── 2_START_DEV.bat                # Script: npm run dev:electron
├── 3_BUILD.bat                    # Script: npm run build:electron
├── START_ALL.bat                  # Script: Inicia backend, espera, luego Electron
│
└── CLAUDE.md                      # Este archivo
```

---

## COMANDOS

### Instalacion (primera vez)

```batch
cd 9.OrderFlowDesktop
1_INSTALL.bat

# O manualmente:
npm install
```

### Desarrollo

```batch
# OPCION RECOMENDADA: Inicio automatico (backend + frontend)
cd 9.OrderFlowDesktop
START_ALL.bat
# Este script:
# 1. Inicia el backend si no esta corriendo
# 2. Espera a que responda (max 2 min)
# 3. Inicia Electron cuando el backend esta listo

# OPCION MANUAL: Dos terminales separadas
# Terminal 1 - Backend (REQUERIDO)
cd 5.Order_flow/backend
.venv\Scripts\activate
uvicorn main:app --reload --port 11000

# Terminal 2 - Electron + Vite
cd 9.OrderFlowDesktop
2_START_DEV.bat

# O manualmente:
npm run dev:electron
```

### Build para Produccion

```batch
cd 9.OrderFlowDesktop
3_BUILD.bat

# O manualmente:
npm run build:electron
```

**Output generado en `dist-electron/`:**
- `Order Flow Desktop Setup.exe` - Instalador NSIS (~150MB)
- `OrderFlowDesktop-Portable.exe` - Version portable

---

## CONFIGURACION ANTI-THROTTLING

### electron/main.js

```javascript
// ============================================================
// CONFIGURACION ANTI-THROTTLING (ANTES de app.whenReady)
// ============================================================

// Desactivar throttling del renderer en background
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Desactivar throttling de timers en background
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Desactivar throttling de ventanas ocultas
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ============================================================
// CONFIGURACION DE RED
// ============================================================

// Aumentar limite de conexiones (default es 6)
app.commandLine.appendSwitch('max-connections-per-host', '64');

// Aumentar memoria para JavaScript
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
```

### BrowserWindow webPreferences

```javascript
webPreferences: {
  backgroundThrottling: false,  // CRITICO: Desactiva throttling
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: false
}
```

### PowerSaveBlocker

```javascript
// Prevenir que el sistema entre en suspension
powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
```

---

## RELACION CON BACKEND

Esta aplicacion **NO tiene backend propio**. Reutiliza el backend de `5.Order_flow/`:

| Componente | Ubicacion | Puerto |
|------------|-----------|--------|
| Backend Order Flow | `5.Order_flow/backend/` | 11000 |
| Frontend Electron | `9.OrderFlowDesktop/` | 11001 (dev) |

### Endpoints Principales Consumidos

| Endpoint | Descripcion |
|----------|-------------|
| `GET /api/status` | Estado del servidor |
| `GET /api/orderflow/footprint/{symbol}` | Footprints de un simbolo |
| `GET /api/orderflow/config` | Configuracion Order Flow |
| `POST /api/orderflow/config` | Actualizar configuracion |
| `GET /api/orderflow/step-size/{symbol}` | Step size de un simbolo |
| `GET /api/historical/{symbol}` | Datos OHLCV |
| `GET /api/vwap-service/data/{symbol}` | Datos VWAP |
| `GET /api/swing/signals/{symbol}` | Senales Swing |

---

## FUNCIONALIDADES

### Heredadas de Order Flow (5.Order_flow)

- **Footprint con Step Size Absoluto**: Niveles de precio fijos ($10 BTC, $2 ETH)
- **Visualizacion de Imbalances**: Ratio >= 3x marcado en amarillo
- **Stacked Imbalances**: 3+ niveles consecutivos con imbalance
- **POC (Point of Control)**: Nivel con mayor volumen
- **Delta por Vela**: Diferencia ask - bid
- **Persistencia de Footprints**: JSON en disco, 12h de historial
- **21 Simbolos Soportados**: BTCUSDT, ETHUSDT, SOLUSDT, etc.

### Nuevas de Electron

- **Sin Gaps en Graficos**: Anti-throttling activo
- **Ejecucion en Background**: Minimiza a System Tray
- **Notificaciones Nativas**: Alertas del sistema operativo
- **PowerSaveBlocker**: PC no entra en suspension
- **Instalador Windows**: .exe con NSIS

---

## SIMBOLOS SOPORTADOS

```javascript
const SYMBOLS = [
  "BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "ADAUSDT",
  "TRXUSDT", "PAXGUSDT", "GALAUSDT", "SUIUSDT", "TRBUSDT",
  "DOGEUSDT", "AAVEUSDT", "AVAXUSDT", "ARBUSDT", "BNBUSDT",
  "INJUSDT", "KASUSDT", "SHIB1000USDT", "TONUSDT", "UNIUSDT",
  "LPTUSDT"
];
```

### Step Sizes por Defecto

| Simbolo | Step Size | Descripcion |
|---------|-----------|-------------|
| BTCUSDT | $10.0 | Bitcoin |
| ETHUSDT | $2.0 | Ethereum |
| SOLUSDT | $0.5 | Solana |
| BNBUSDT | $1.0 | Binance Coin |
| XRPUSDT | $0.005 | Ripple |
| DOGEUSDT | $0.001 | Dogecoin |

---

## TROUBLESHOOTING

### Backend no disponible

**Sintoma**: Error "Cannot connect to localhost:11000" o grafico vacio

**Solucion**:
1. Verificar que el backend esta corriendo:
   ```batch
   cd 5.Order_flow/backend
   .venv\Scripts\activate
   uvicorn main:app --reload --port 11000
   ```
2. Verificar que el puerto 11000 no esta en uso:
   ```batch
   netstat -ano | findstr :11000
   ```
3. Si hay conflicto, matar el proceso:
   ```batch
   taskkill /PID <PID> /F
   ```

### Graficos vacios o sin footprint

**Sintoma**: Velas se muestran pero sin datos de Order Flow

**Solucion**:
1. El backend necesita tiempo para acumular trades (esperar 1-2 minutos)
2. Verificar que Order Flow esta habilitado en el panel de indicadores
3. Revisar logs del backend buscando errores de WebSocket
4. Verificar que el simbolo tiene suficiente volumen

### Footprints faltan para las ultimas N velas

**Sintoma**: Footprints historicos se muestran pero las velas recientes no tienen footprint

**Causa**: Despues de un reinicio del backend, los footprints nuevos tardan en generarse.
Los footprints historicos se cargan desde archivos JSON en disco (`footprint_cache/`),
pero los footprints nuevos se generan solo cuando cierra cada vela (1 por minuto en timeframe 1m).

**Solucion**:
1. Esperar ~2-3 minutos para que se acumulen footprints de velas nuevas
2. Verificar estado del servicio:
   ```bash
   curl http://localhost:11000/api/orderflow/status
   ```
   Debe mostrar: `"running": true`, `"websocket_connected": true`
3. Verificar logs del backend buscando `[ORDERFLOW_SERVICE] Footprint completado`
4. Si el backend acaba de reiniciarse, refrescar la pagina de Electron (F5)

### Swing Detector no muestra senales

**Sintoma**: El modal del Swing Detector dice "service stopped" o no hay flechas en el grafico

**Causa**: El codigo de inicio del swing_service estaba comentado en `main.py`

**Solucion**:
1. Verificar que el servicio esta activo:
   ```bash
   curl http://localhost:11000/api/swing/status
   ```
   Debe mostrar: `"running": true`
2. Si `"running": false`, verificar en `5.Order_flow/backend/main.py` que el codigo
   de inicio del swing service NO esta comentado (lineas ~2486-2492):
   ```python
   # Start swing detector service
   if swing_service:
       try:
           await swing_service.start()
           print(f"[STARTUP] Swing detector service started")
       except Exception as e:
           print(f"[STARTUP] Warning: Could not start swing service: {e}")
   ```
3. Reiniciar el backend despues de descomentar

### Backend no responde despues de cambios

**Sintoma**: El hot-reload de uvicorn no aplica cambios correctamente

**Solucion**:
1. Matar todos los procesos Python:
   ```batch
   taskkill /F /IM python.exe /T
   ```
2. Reiniciar el backend:
   ```batch
   cd 5.Order_flow/backend
   .venv\Scripts\activate
   uvicorn main:app --reload --port 11000
   ```

### WebSocket timeout al iniciar

**Sintoma**: Logs muestran `WebSocket error: timed out during opening handshake`

**Causa**: Problema temporal de conexion con Bybit. Generalmente se resuelve solo.

**Solucion**:
1. Esperar 30-60 segundos, el servicio reintentara automaticamente
2. Si persiste, verificar conexion a internet
3. Reiniciar el backend si es necesario

### Electron no inicia

**Sintoma**: `npm run dev:electron` falla

**Solucion**:
1. Verificar que `npm install` se ejecuto correctamente
2. Verificar que Vite inicia en puerto 11001:
   ```batch
   npm run dev
   ```
3. Si Vite funciona, el problema es Electron. Verificar version de Node.js (recomendado 18+)

### Puerto 11001 en uso

**Sintoma**: Error "Port 11001 is already in use"

**Solucion**:
```batch
netstat -ano | findstr :11001
taskkill /PID <PID> /F
```

### Build falla

**Sintoma**: `npm run build:electron` da error

**Solucion**:
1. Ejecutar primero solo el build de Vite:
   ```batch
   npm run build
   ```
2. Si Vite falla, revisar errores de JSX/JavaScript
3. Si Vite pasa pero electron-builder falla:
   - Verificar que `assets/icon.ico` existe (o remover referencia en package.json)
   - Limpiar cache: `rmdir /s /q dist dist-electron`

### Gaps en graficos (si persisten)

**Sintoma**: A pesar de Electron, siguen apareciendo gaps

**Posibles causas**:
1. Backend se detuvo o reinicio
2. WebSocket de Bybit se desconecto (verificar logs del backend)
3. Problema de red o firewall

**Verificacion**:
```batch
# Ver logs del backend
# Buscar: "[WS] Connected to Bybit"
# Si hay: "[WS] Disconnected" - problema de conexion
```

### Notificaciones no aparecen

**Sintoma**: Alertas no muestran notificacion del sistema

**Solucion**:
1. Verificar que Windows permite notificaciones de la app
2. Configuracion de Windows > Sistema > Notificaciones
3. Asegurarse de que "Electron" o "Order Flow Desktop" esta habilitado

### Memoria alta o lentitud

**Sintoma**: La app consume mucha RAM o se vuelve lenta

**Solucion**:
1. Reducir dias de historial en configuracion
2. Deshabilitar indicadores no usados
3. Reducir cantidad de simbolos monitoreados
4. Reiniciar la app periodicamente (cada 24h recomendado)

### DevTools muestra errores

**Sintoma**: Errores en consola de DevTools al iniciar

**Errores normales (ignorar)**:
- `Unknown VE context: language-mismatch` - Error interno de DevTools
- `Request Autofill.enable failed` - Caracteristica no soportada
- Warnings de deprecation de Node.js

**Errores a investigar**:
- `Failed to fetch` - Problema de conexion al backend
- `WebSocket connection failed` - Problema con Bybit
- `Cannot read property of undefined` - Bug en el codigo

---

## COMPARACION: BROWSER VS ELECTRON

| Aspecto | Browser (5.Order_flow) | Electron (9.OrderFlowDesktop) |
|---------|------------------------|-------------------------------|
| Throttling en background | Si (causa gaps) | No (anti-throttling) |
| System Tray | No | Si |
| Notificaciones | Browser API | Nativas del OS |
| PowerSave | No control | powerSaveBlocker activo |
| Distribucion | URL localhost | Instalador .exe |
| Memoria | Compartida con browser | Dedicada |
| Inicio automatico | Manual | Puede configurarse |
| Actualizaciones | Automaticas (hot reload) | Requiere rebuild |

---

## PUERTOS DEL ECOSISTEMA

| Aplicacion | Backend | Frontend |
|------------|---------|----------|
| Backtester | 9000 | 5173 |
| Watchlist | 8000 | 5173 |
| Trading Bot | 5000 | 3000 |
| Analizador Cripto | 10000 | 10001 |
| Order Flow (browser) | 11000 | 11001 |
| **Order Flow Desktop** | 11000 (compartido) | 11001 (dev) |
| Trading Journal | 12000 | 12001 |

---

## HISTORIAL DE DESARROLLO

### Enero 2026 - Migracion a Electron

**Problema original**:
- Graficos con gaps al minimizar ventana o apagar pantalla
- WebSocket se desconectaba en background
- Datos desactualizados al volver de inactividad

**Solucion implementada**:
1. Crear nueva app Electron (`9.OrderFlowDesktop/`)
2. Copiar frontend de `5.Order_flow/frontend/src/`
3. Copiar configuracion Electron de `7.WatchlistDesktop/electron/`
4. Adaptar para puerto 11000/11001
5. Configurar anti-throttling completo
6. Probar con 10+ minutos de inactividad

**Resultado**:
- ✅ Graficos sin gaps
- ✅ Datos siempre actualizados
- ✅ WebSocket mantenido
- ✅ Footprints procesados continuamente

**Archivos creados**:
- `electron/main.js` - Proceso principal con anti-throttling
- `electron/preload.js` - Bridge seguro
- `package.json` - Scripts y electron-builder config
- `vite.config.js` - Build optimizado para Electron
- `index.html` - Con CSP para Electron
- `1_INSTALL.bat`, `2_START_DEV.bat`, `3_BUILD.bat`
- `CLAUDE.md` - Esta documentacion

### 28 Enero 2026 - Fix Swing Detector y Footprints

**Problemas reportados**:
1. Swing Detector no graficaba senales por ~5 horas, modal decia "service stopped"
2. Footprints faltaban para las ultimas 10 velas despues de reiniciar backend

**Diagnostico**:
1. El codigo de inicio del `swing_service.start()` estaba comentado en `5.Order_flow/backend/main.py` (lineas 2486-2492)
2. Los footprints se generan en tiempo real al cierre de cada vela; despues de un reinicio, los historicos se cargan del disco pero los nuevos tardan en acumularse

**Solucion aplicada**:
1. Descomentar el bloque de inicio del swing service:
   ```python
   if swing_service:
       try:
           await swing_service.start()
           print(f"[STARTUP] Swing detector service started")
       except Exception as e:
           print(f"[STARTUP] Warning: Could not start swing service: {e}")
   ```
2. Reiniciar el backend (hot-reload no aplicaba cambios correctamente, fue necesario matar procesos Python y reiniciar)
3. Esperar ~2-3 minutos para que se generaran footprints de velas nuevas

**Verificacion**:
```bash
# Verificar Swing Detector
curl http://localhost:11000/api/swing/status
# Debe mostrar: "running": true

# Verificar OrderFlow
curl http://localhost:11000/api/orderflow/status
# Debe mostrar: "running": true, "websocket_connected": true, "footprints_completed": N
```

**Archivos modificados**:
- `5.Order_flow/backend/main.py` - Descomentar inicio de swing_service
- `9.OrderFlowDesktop/index.html` - Cambiar titulo
- `9.OrderFlowDesktop/electron/main.js` - Cambiar titulo ventana y notificacion
- `9.OrderFlowDesktop/src/components/SingleSymbolAnalyzer.jsx` - Cambiar titulo h2

### 29 Enero 2026 - Optimizaciones de Rendimiento y Robustez

**Problemas reportados**:
1. Gaps de 5 minutos en las velas al iniciar
2. Indicadores tardaban ~10 minutos en aparecer
3. Cientos de errores `ERR_CONNECTION_REFUSED` en consola

**Diagnostico**:
1. El frontend (Electron) iniciaba antes de que el backend estuviera listo
2. El backend tarda ~1 minuto en cargar 29,000+ footprints del disco
3. Los gaps estaban en el cache de IndexedDB de sesiones anteriores
4. La carga incremental no rellena gaps historicos

**Soluciones implementadas**:

#### 1. Cache en Backend con TTL (5.Order_flow/backend/main.py)
```python
HISTORICAL_CACHE = {}
HISTORICAL_CACHE_TTL = 300  # 5 minutos

# Endpoints agregados:
# POST /api/cache/clear - Limpiar cache manualmente
# GET /api/cache/status - Ver estado del cache
```

#### 2. Deteccion de Gaps en Cache (CandleCache.js)
```javascript
// En getValidated(): detecta gaps y limpia cache si hay gaps >2 minutos
const gapAnalysis = this.analyzeGaps(cached.candles, interval, context);
if (gapAnalysis.gapCount > 0) {
  const significantGaps = gapAnalysis.gaps.filter(g => parseFloat(g.gapMinutes) > 2);
  if (significantGaps.length > 0) {
    await this.clear(symbol, interval);  // Forzar recarga completa
    return null;
  }
}
```

#### 3. MIN_CACHE_RATIO aumentado (CandleCache.js)
- Antes: 0.1 (10%) - aceptaba cache casi vacio
- Ahora: 0.7 (70%) - requiere al menos 70% de velas esperadas

#### 4. Carga Secuencial de Indicadores (IndicatorManager.js)
```javascript
// Prioridad 1 (criticos): VWAP, Order Flow
// Prioridad 2 (secundarios): Swing Detector, S&R v2
// Prioridad 3 (opcionales): Volume Profile, DTB, Rejection
// 100ms de delay entre batches
```

#### 5. Prefetch Deshabilitado Inicialmente (SymbolList.jsx)
- Prefetch de simbolos deshabilitado los primeros 10 segundos
- Debounce aumentado de 300ms a 1000ms

#### 6. Spinner de Carga (MiniChart.jsx)
- Indicador visual mientras `!isInitialized`

#### 7. Boton Reset para Indicadores (SingleSymbolAnalyzer.jsx)
- Constante `DEFAULT_INDICATORS` con valores por defecto
- Boton "Reset" para restaurar indicadores a valores iniciales

#### 8. Script de Inicio Coordinado (START_ALL.bat)
```batch
# Flujo:
# 1. Verifica si backend ya esta corriendo
# 2. Si no, inicia backend en ventana separada
# 3. Espera hasta que /api/status responda (max 2 min)
# 4. Inicia Electron solo cuando backend esta listo
```

**Archivos modificados**:
- `5.Order_flow/backend/main.py` - Cache con TTL, endpoints de cache
- `9.OrderFlowDesktop/src/utils/CandleCache.js` - Deteccion de gaps, MIN_CACHE_RATIO 70%
- `9.OrderFlowDesktop/src/components/indicators/IndicatorManager.js` - Carga secuencial
- `9.OrderFlowDesktop/src/components/SymbolList.jsx` - Prefetch diferido
- `9.OrderFlowDesktop/src/components/MiniChart.jsx` - Spinner de carga
- `9.OrderFlowDesktop/src/components/SingleSymbolAnalyzer.jsx` - Reset indicadores

**Archivos creados**:
- `9.OrderFlowDesktop/START_ALL.bat` - Inicio coordinado backend + frontend

**Resultado**:
- ✅ Sin gaps en graficos (cache corrupto se detecta y limpia automaticamente)
- ✅ Sin errores ERR_CONNECTION_REFUSED (Electron espera al backend)
- ✅ Carga percibida mucho mas rapida
- ✅ Indicadores aparecen en orden de prioridad

### 29 Enero 2026 - Mejoras de Robustez

**Objetivo**: Hacer la aplicacion mas resistente a fallos de red y datos corruptos.

**Soluciones implementadas**:

#### 1. Sistema de Robustez Centralizado (src/utils/robustness.js)

**Validacion de datos de velas:**
```javascript
import { validateCandles } from './robustness';

// Antes de guardar en cache, validar datos
const { validCandles, invalidCount } = validateCandles(candles, context);
// Descarta velas con campos faltantes, valores NaN, o OHLC invalido
```

**Health check periodico:**
```javascript
import { initRobustness, onConnectionChange } from './robustness';

// Se inicia automaticamente cada 30 segundos
initRobustness();

// Suscribirse a cambios de conexion
onConnectionChange((isConnected) => {
  // Actualizar UI
});
```

**Retry con backoff exponencial:**
```javascript
import { fetchWithRetry } from './robustness';

// Reintenta 3 veces con backoff 1s -> 2s -> 4s
const response = await fetchWithRetry(url, options, {
  maxRetries: 3,
  initialDelayMs: 1000,
  context: 'historical-BTCUSDT'
});
```

**Limpieza automatica de cache:**
```javascript
import { cleanupOldCache, getCacheStats } from './robustness';

// Se ejecuta automaticamente al iniciar (elimina >7 dias)
await cleanupOldCache(7);

// Ver estadisticas del cache
const stats = await getCacheStats();
```

#### 2. Indicador Visual de Conexion (ConnectionStatus.jsx)

- Punto verde/rojo en el header
- Tooltip con detalles (ultimo check, errores, intentos fallidos)
- Click para reintentar conexion manual
- Se actualiza automaticamente cada 30 segundos

#### 3. Integracion en Componentes

**CandleCache.js:**
- Valida velas antes de guardar en cache
- Descarta velas con datos invalidos

**MiniChart.jsx:**
- Usa `fetchWithRetry` para cargar datos historicos
- Reintenta automaticamente si falla la conexion

**SingleSymbolAnalyzer.jsx:**
- Inicializa sistema de robustez al montar
- Muestra ConnectionStatus en el header

**Archivos creados:**
- `src/utils/robustness.js` - Utilidades centralizadas
- `src/components/ConnectionStatus.jsx` - Indicador visual

**Archivos modificados:**
- `src/utils/CandleCache.js` - Validacion de velas
- `src/components/MiniChart.jsx` - fetchWithRetry
- `src/components/SingleSymbolAnalyzer.jsx` - Integracion

**Beneficios:**
- ✅ Reconexion automatica cuando backend vuelve
- ✅ Datos corruptos se detectan y descartan
- ✅ Reintentos automaticos reducen fallos por red inestable
- ✅ Cache viejo se limpia automaticamente
- ✅ Usuario ve estado de conexion en tiempo real

### 29 Enero 2026 - Mejora del Crosshair (Etiqueta de Tiempo)

**Problema reportado:**
- El crosshair mostraba tiempo interpolado al mover el mouse entre velas
- Ejemplo: entre las 10:00 y 11:00 mostraba 10:32, 10:45, etc.
- Esto confundia al usuario sobre el timeframe actual
- Ademas, la etiqueta parpadeaba al cambiar de vela

**Solucion implementada:**

1. **Tiempo sin interpolacion**: La etiqueta muestra el timestamp exacto de la vela actual
   - Ya no calcula fracciones de tiempo entre velas
   - El tiempo "salta" de vela en vela (ej: 10:00 → 11:00 en timeframe 1h)

2. **Etiqueta siempre visible**: La etiqueta sigue la posicion horizontal del mouse
   - Garantiza visibilidad continua mientras el mouse este en el grafico
   - Elimina el parpadeo al cambiar de vela

3. **Clamp a bordes**: Si el mouse esta fuera del rango de velas visibles
   - A la izquierda: muestra tiempo de la primera vela
   - A la derecha: muestra tiempo de la ultima vela

**Archivo modificado:**
- `src/components/MiniChart.jsx` - Seccion del crosshair (lineas ~1058-1098)

**Codigo clave:**
```javascript
// Calcular indice de vela (sin interpolacion)
const mousePositionInChart = (mouseX - marginLeft) / barWidth;
let candleIdx = Math.floor(mousePositionInChart);

// Clamp al rango de velas visibles
if (candleIdx < 0) candleIdx = 0;
if (candleIdx >= visibleCandles.length) candleIdx = visibleCandles.length - 1;

// Obtener timestamp de la vela (no interpolar)
const candleTimestamp = visibleCandles[candleIdx].timestamp;

// La etiqueta sigue al mouse pero muestra el tiempo de la vela
const labelX = mouseX - textWidth / 2;
```

**Resultado:**
- ✅ Tiempo muestra valores discretos del timeframe (10:00, 11:00, 12:00)
- ✅ Sin parpadeo al moverse entre velas
- ✅ Etiqueta siempre visible en el area del grafico

### 31 Enero 2026 - Sistema de Integridad de Cache de Footprints

**Objetivo**: Validar, reparar y limpiar el cache de footprints para mantener datos consistentes.

**Problema original**:
- Footprints con step_size antiguo mezclados con los nuevos
- Al cambiar step_size en el modal, solo afectaba a velas nuevas
- Sin forma facil de aplicar cambios a historial

**Soluciones implementadas**:

#### 1. Panel de Integridad (IntegrityPanel.jsx)

Nuevo panel en el modal de OrderFlow Settings que muestra:
- Estado de salud del cache (verde=OK, amarillo=reparando, rojo=problemas)
- Conteo de simbolos saludables vs con problemas
- Lista de problemas detectados (gaps)
- Botones: Validar, Reparar, Limpiar Cache Completo

#### 2. Servicio de Integridad (cache_integrity_service.py)

```python
# Valida footprints detectando:
# - Gaps de datos (velas faltantes) - ESTO SI es un problema
# - Step_size diferente al actual - Solo informativo, NO es problema

# Endpoints:
GET  /api/orderflow/integrity/status    # Estado actual
POST /api/orderflow/integrity/validate  # Validar todos
POST /api/orderflow/integrity/repair    # Reparar desde cloud
POST /api/orderflow/integrity/clear-cache  # Limpiar y recargar
GET  /api/orderflow/integrity/progress  # Progreso de reparacion
```

#### 3. Boton "Aplicar a historial" en Step Size

Cuando el usuario cambia el step_size de un simbolo:
1. Click "Guardar" guarda la nueva configuracion
2. Click "Aplicar a historial" elimina cache del simbolo
3. Los footprints se regeneran automaticamente con el nuevo step_size

```javascript
// Endpoint para limpiar cache de un simbolo especifico
DELETE /api/orderflow/cache/{symbol}
// Elimina: BTCUSDT_1.json, BTCUSDT_5.json, etc.
```

#### 4. Validacion Inteligente

El sistema distingue entre:
- **Problemas reales (gaps)**: Marcan el simbolo como "issues"
- **Step_size diferente**: Solo informativo, NO marca como problema

```python
# Solo GAPS causan estado "issues", no step_size diferente
if gaps:
    status = IntegrityStatus.ISSUES
else:
    status = IntegrityStatus.HEALTHY
```

**Archivos creados/modificados**:
- `5.Order_flow/backend/cache_integrity_service.py` - Servicio de validacion
- `5.Order_flow/backend/main.py` - Endpoints de integridad + clear-cache
- `9.OrderFlowDesktop/src/components/IntegrityPanel.jsx` - UI del panel
- `9.OrderFlowDesktop/src/components/OrderFlowSettings.jsx` - Boton "Aplicar a historial"

**Resultado**:
- ✅ Panel visual de estado de integridad
- ✅ Deteccion automatica de gaps
- ✅ Reparacion desde cloud collector
- ✅ Boton para aplicar step_size a historial
- ✅ Step_size diferente no marca como error

### 31 Enero 2026 - Fix: Footprints Historicos No Se Graficaban

**Problema reportado**:
- Los footprints historicos no se mostraban en el grafico
- Solo las velas nuevas (tiempo real) mostraban footprint
- El backend tenia los datos (465+ footprints) pero no se renderizaban

**Diagnostico**:
- El backend retornaba correctamente los footprints
- Los timestamps coincidian entre velas y footprints
- El problema era que despues del fetch inicial, no se forzaba un redraw del grafico
- Las velas nuevas se veian porque el WebSocket de velas disparaba redraw

**Solucion implementada**:

Se agrego logging detallado a `OrderFlowIndicator.js` para diagnosticar el problema.
Durante la investigacion, el reinicio de la aplicacion con los cambios de logging resolvio el problema (posible race condition en la inicializacion).

**Logging inteligente agregado** (solo loguea cuando es relevante):

```javascript
// Solo al cargar por primera vez
console.log(`[OrderFlow] [SYMBOL] INITIAL LOAD: N footprints`);
// + rangos detallados de grupos contiguos

// Solo cuando hay nuevos footprints
console.log(`[OrderFlow] [SYMBOL] +N footprints (total: X)`);

// Solo cuando hay problemas de matching (>30% sin match)
console.warn(`[OrderFlow] [SYMBOL] HIGH UNMATCHED: X/Y (Z%)`);

// Solo cuando se pierden footprints
console.warn(`[OrderFlow] [SYMBOL] footprints LOST: X -> 0`);
```

**Metodo `_logFootprintRanges()`**: Analiza grupos contiguos de footprints y detecta gaps:
```
[OrderFlow] [ETHUSDT] FOOTPRINT RANGES:
  Total: 730 footprints
  Rango completo: 31/1/2026, 8:25:00 a.m. -> 31/1/2026, 8:35:00 p.m.
  Grupos contiguos: 2
    Grupo 1: 31/1/2026, 8:25:00 a.m. -> 31/1/2026, 8:22:00 p.m. (718 fps, 717 min)
    >>> GAP: 2 minutos <<<
    Grupo 2: 31/1/2026, 8:24:00 p.m. -> 31/1/2026, 8:35:00 p.m. (12 fps, 11 min)
```

**Archivos modificados**:
- `src/components/indicators/OrderFlowIndicator.js` - Logging inteligente y metodo `_logFootprintRanges()`
- `src/components/MiniChart.jsx` - Limpieza de logging verbose
- `src/components/indicators/IndicatorManager.js` - Limpieza de logging verbose

**Resultado**:
- ✅ Footprints historicos se grafican correctamente
- ✅ Logging util para diagnostico sin spam en consola
- ✅ Deteccion automatica de gaps en footprints
- ✅ Warnings solo cuando hay problemas reales

---

## MANTENIMIENTO

### Actualizar dependencias

```batch
cd 9.OrderFlowDesktop
npm update
```

### Sincronizar con cambios de 5.Order_flow

Si hay cambios importantes en el frontend de `5.Order_flow/`:

```batch
# Copiar archivos actualizados
xcopy /s /y "5.Order_flow\frontend\src\*" "9.OrderFlowDesktop\src\"

# Verificar que config.js mantiene puerto correcto
# API_BASE_URL debe ser "http://localhost:11000"
```

### Limpiar cache y rebuilds

```batch
cd 9.OrderFlowDesktop
rmdir /s /q node_modules dist dist-electron
npm install
npm run build:electron
```
