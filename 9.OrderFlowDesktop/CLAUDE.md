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
