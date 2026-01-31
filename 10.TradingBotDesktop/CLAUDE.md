# CLAUDE.md - Trading Bot Desktop

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

**Trading Bot Desktop** es la version de escritorio (Electron) del Trading Bot automatizado.
Resuelve el problema critico de throttling del navegador que causaba pausas en el monitoreo de alertas.

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `10.TradingBotDesktop/` |
| Puerto Frontend Dev | 5001 |
| Puerto Backend | 5000 (usa backend de `3.TradingBot_Python/`) |
| Stack | Electron 33 + React 18 + Vite 5 |
| Base frontend | Migrado de `3.TradingBot_Python/frontend/` |

---

## PROBLEMA RESUELTO

### Antes (Browser)

| Problema | Causa |
|----------|-------|
| Alertas retrasadas al minimizar | Chromium throttlea el renderer en background |
| Polling pausado al apagar pantalla | Timer throttling reduce frecuencia |
| Posiciones no se actualizan | Browser "pausa" la app completamente |

### Ahora (Electron)

| Solucion | Implementacion |
|----------|----------------|
| Renderer siempre activo | `disable-renderer-backgrounding` |
| Timers sin pausar | `disable-background-timer-throttling` |
| PC no entra en suspension | `powerSaveBlocker.start('prevent-app-suspension')` |
| Ejecucion en segundo plano | System Tray con minimizar a bandeja |

---

## ARQUITECTURA

```
┌─────────────────────────────────────────────────────────────────┐
│                    10.TradingBotDesktop                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 ELECTRON (Main Process)                   │   │
│  │  - disable-renderer-backgrounding                        │   │
│  │  - disable-background-timer-throttling                   │   │
│  │  - powerSaveBlocker.start('prevent-app-suspension')      │   │
│  │  - System Tray para ejecucion en background              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              ↕ IPC                              │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                 RENDERER (React)                          │   │
│  │  - App.jsx (componente raiz con tabs)                    │   │
│  │  - CredentialsPanel.jsx (config Bybit API)               │   │
│  │  - ConfigManager.jsx (gestion de simbolos)               │   │
│  │  - DirectionManager.jsx (filtros LONG/SHORT)             │   │
│  │  - PositionsPanel.jsx (posiciones abiertas)              │   │
│  │  - AlertPanel.jsx (historial de alertas)                 │   │
│  │  - backgroundThrottling: false en webPreferences         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND (3.TradingBot_Python - Puerto 5000)         │
│  ✅ SIN CAMBIOS - Reutiliza el backend existente                 │
│  - Bybit Client (conexion API con rate limiting)                │
│  - Order Manager (ejecucion de ordenes)                         │
│  - Risk Calculator (calculo de tamano de posicion)              │
│  - Direction Manager (filtros LONG/SHORT por simbolo)           │
│  - Alert Parser (parsea alertas de Watchlist/Analizador)        │
└─────────────────────────────────────────────────────────────────┘
```

---

## ESTRUCTURA DE ARCHIVOS

```
10.TradingBotDesktop/
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
├── src/
│   ├── main.jsx                   # Entry point React
│   ├── config.js                  # API_BASE_URL = localhost:5000
│   ├── App.jsx                    # Componente raiz con tabs
│   ├── App.css                    # Estilos de la app
│   ├── index.css                  # Estilos globales
│   │
│   ├── components/
│   │   ├── CredentialsPanel.jsx   # Configuracion credenciales Bybit
│   │   ├── ConfigManager.jsx      # Gestion de simbolos y configs
│   │   ├── DirectionManager.jsx   # Filtros LONG/SHORT/BOTH/DISABLED
│   │   ├── AlertPanel.jsx         # Historial de alertas recibidas
│   │   ├── PositionsPanel.jsx     # Posiciones abiertas en Bybit
│   │   ├── OrdersPanel.jsx        # Historial de ordenes
│   │   ├── LogsPanel.jsx          # Logs del sistema
│   │   └── components.css         # Estilos de componentes
│   │
│   └── utils/
│       └── robustness.js          # Validacion y health checks
│
├── assets/
│   └── README.txt                 # Instrucciones para icon.ico
│
├── dist/                          # Build de produccion (generado)
├── dist-electron/                 # Instaladores (generado)
├── node_modules/                  # Dependencias (generado)
│
├── package.json                   # Configuracion npm + electron-builder
├── vite.config.js                 # Configuracion Vite (puerto 5001)
├── index.html                     # HTML principal
│
├── 1.START_ALL.bat                # Inicia backend + Electron coordinado
├── 1_START.bat                    # Inicio con verificacion de backend
├── start_fast.bat                 # Inicio rapido (solo Electron)
│
└── CLAUDE.md                      # Este archivo
```

---

## COMANDOS

### Inicio Recomendado (Backend + Frontend)

```batch
cd 10.TradingBotDesktop
1.START_ALL.bat
# Este script:
# 1. Verifica si el backend ya esta corriendo en puerto 5000
# 2. Si no, inicia el backend en ventana separada
# 3. Espera hasta que responda (max 60 segundos)
# 4. Inicia Electron cuando el backend esta listo
```

### Desarrollo Manual

```batch
# Terminal 1 - Backend (REQUERIDO)
cd 3.TradingBot_Python/backend
.venv\Scripts\activate
python main.py

# Terminal 2 - Electron + Vite
cd 10.TradingBotDesktop
npm run dev:electron
```

### Build para Produccion

```batch
cd 10.TradingBotDesktop
npm run build:electron
```

**Output generado en `dist-electron/`:**
- `Trading Bot Desktop Setup.exe` - Instalador NSIS
- `TradingBotDesktop-Portable.exe` - Version portable

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
```

### BrowserWindow webPreferences

```javascript
webPreferences: {
  backgroundThrottling: false,  // CRITICO: Desactiva throttling
  preload: path.join(__dirname, 'preload.js'),
  contextIsolation: true,
  nodeIntegration: false
}
```

### PowerSaveBlocker

```javascript
// Prevenir que el sistema entre en suspension
powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
```

---

## RELACION CON BACKEND

Esta aplicacion **NO tiene backend propio**. Reutiliza el backend de `3.TradingBot_Python/`:

| Componente | Ubicacion | Puerto |
|------------|-----------|--------|
| Backend Trading Bot | `3.TradingBot_Python/backend/` | 5000 |
| Frontend Electron | `10.TradingBotDesktop/` | 5001 (dev) |

### Endpoints Principales Consumidos

| Endpoint | Descripcion |
|----------|-------------|
| `GET /api/status` | Estado del bot |
| `GET /api/config` | Configuracion de simbolos |
| `POST /api/config` | Actualizar configuracion |
| `GET /api/positions` | Posiciones abiertas |
| `GET /api/credentials/status` | Estado de credenciales |
| `POST /api/credentials` | Guardar credenciales |
| `GET /api/directions` | Filtros de direccion |
| `POST /api/directions` | Actualizar direcciones |
| `POST /api/trade/manual` | Ejecutar orden manual |
| `POST /api/watchlist-alert` | Recibir alerta externa |

---

## FUNCIONALIDADES

### Heredadas del Trading Bot (3.TradingBot_Python)

- **Ejecucion de ordenes**: Market orders con SL/TP integrado
- **Dos metodos de ejecucion**: Sequential (3 calls) o Integrated (1 call)
- **Auto-precision**: Fetch automatico de step_size/tick_size desde Bybit
- **Rate limiting**: Token Bucket para respetar limites de API
- **21 simbolos** preconfigurados
- **Filtros de direccion**: LONG/SHORT/BOTH/DISABLED por simbolo

### Nuevas de Electron

- **Sin pausas en monitoreo**: Anti-throttling activo
- **Ejecucion en background**: Minimiza a System Tray
- **Notificaciones nativas**: Alertas del sistema operativo
- **PowerSaveBlocker**: PC no entra en suspension
- **Instalador Windows**: .exe con NSIS

---

## COMPONENTES PRINCIPALES

### CredentialsPanel.jsx
- Configuracion de API Key y Secret de Bybit
- Toggle Demo/Live mode
- Estado de conexion

### ConfigManager.jsx
- Lista de simbolos configurados
- Edicion de parametros por simbolo (SL%, TP%, cantidad)
- Agregar/eliminar simbolos

### DirectionManager.jsx
- Filtros LONG/SHORT/BOTH/DISABLED por simbolo
- Permite habilitar/deshabilitar trading por direccion

### PositionsPanel.jsx
- Posiciones abiertas actuales
- PnL en tiempo real
- Boton para cerrar posiciones

### AlertPanel.jsx
- Historial de alertas recibidas
- Source (Watchlist, Analizador, Swing Detector)
- Estado de ejecucion

---

## PUERTOS DEL ECOSISTEMA

| Aplicacion | Backend | Frontend |
|------------|---------|----------|
| Backtester | 9000 | 5173 |
| Watchlist | 8000 | 5173 |
| **Trading Bot (browser)** | 5000 | 3000 |
| **Trading Bot Desktop** | 5000 (compartido) | 5001 (dev) |
| Analizador Cripto | 10000 | 10001 |
| Order Flow | 11000 | 11001 |
| Trading Journal | 12000 | 12001 |

---

## TROUBLESHOOTING

### Backend no disponible

**Sintoma**: Error "Cannot connect to localhost:5000"

**Solucion**:
1. Usar `1.START_ALL.bat` que inicia backend automaticamente
2. O manualmente:
   ```batch
   cd 3.TradingBot_Python/backend
   .venv\Scripts\activate
   python main.py
   ```

### Credenciales no se guardan

**Sintoma**: Al reiniciar se pierden las credenciales

**Solucion**:
- Las credenciales se guardan en `3.TradingBot_Python/config/credentials.json`
- Verificar permisos de escritura en esa carpeta

### Ordenes no se ejecutan

**Sintoma**: Alertas llegan pero no se ejecutan ordenes

**Solucion**:
1. Verificar credenciales Bybit validas
2. Verificar modo correcto (Demo vs Live)
3. Verificar que el simbolo tiene direccion habilitada (no DISABLED)
4. Revisar logs del backend para errores de API

### Alertas no llegan

**Sintoma**: No aparecen alertas en el panel

**Solucion**:
1. Verificar que Watchlist/Analizador esta enviando al puerto 5000
2. Verificar que el simbolo esta configurado en el bot
3. Revisar logs del backend buscando "alert received"

### Electron no inicia

**Sintoma**: `npm run dev:electron` falla

**Solucion**:
1. Verificar que `npm install` se ejecuto correctamente
2. Verificar que Vite inicia en puerto 5001
3. Verificar version de Node.js (recomendado 18+)

---

## HISTORIAL DE DESARROLLO

### Enero 2026 - Migracion a Electron

**Problema original**:
- Alertas retrasadas cuando el tab estaba en background
- Polling de posiciones se pausaba al minimizar

**Solucion implementada**:
1. Crear nueva app Electron (`10.TradingBotDesktop/`)
2. Migrar frontend de `3.TradingBot_Python/frontend/`
3. Configurar anti-throttling completo
4. Agregar System Tray y PowerSaveBlocker
5. Crear script de inicio coordinado (`1.START_ALL.bat`)

**Archivos creados**:
- `electron/main.js` - Proceso principal con anti-throttling
- `electron/preload.js` - Bridge seguro
- `src/` - Frontend React migrado
- `package.json` - Scripts y electron-builder config
- `vite.config.js` - Puerto 5001
- `1.START_ALL.bat` - Inicio coordinado
- `CLAUDE.md` - Esta documentacion
