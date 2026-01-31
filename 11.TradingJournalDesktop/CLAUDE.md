# CLAUDE.md - Trading Journal Desktop

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

**Trading Journal Desktop** es la version de escritorio (Electron) del Trading Journal.
Resuelve el problema critico de throttling del navegador que causaba pausas en el monitoreo de posiciones.

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `11.TradingJournalDesktop/` |
| Puerto Frontend Dev | 12002 |
| Puerto Backend | 12000 (usa backend de `6.Trading_Journal/`) |
| Stack | Electron 33 + React 18 + Vite 5 |
| Base frontend | Migrado de `6.Trading_Journal/frontend/` |

---

## PROBLEMA RESUELTO

### Antes (Browser)

| Problema | Causa |
|----------|-------|
| Monitor de posiciones se pausa | Chromium throttlea el renderer en background |
| Screenshots se pierden | El tab estaba pausado cuando cerro la posicion |
| Metricas desactualizadas | Browser "pausa" la app completamente |

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
│                    11.TradingJournalDesktop                     │
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
│  │  - App.jsx (navegacion entre vistas)                     │   │
│  │  - Dashboard.jsx (metricas y equity curve)               │   │
│  │  - TradeList.jsx (lista filtrable de trades)             │   │
│  │  - TradeDetail.jsx (detalle con screenshots)             │   │
│  │  - Settings.jsx (control del monitor)                    │   │
│  │  - backgroundThrottling: false en webPreferences         │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP
┌─────────────────────────────────────────────────────────────────┐
│              BACKEND (6.Trading_Journal - Puerto 12000)          │
│  ✅ SIN CAMBIOS - Reutiliza el backend existente                 │
│  - Position Monitor (polling al TradingBot)                     │
│  - Journal Store (persistencia SQLite)                          │
│  - Screenshot Service (Playwright + mplfinance)                 │
│  - Metrics Service (calculos avanzados)                         │
└─────────────────────────────────────────────────────────────────┘
                              ↕ HTTP (polling)
┌─────────────────────────────────────────────────────────────────┐
│              TRADING BOT (Puerto 5000)                           │
│  - Posiciones abiertas                                          │
│  - Alertas recientes (para matching de source)                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## ESTRUCTURA DE ARCHIVOS

```
11.TradingJournalDesktop/
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
│   ├── config.js                  # API_BASE_URL = localhost:12000
│   ├── App.jsx                    # Componente raiz con navegacion
│   ├── index.css                  # Estilos globales
│   │
│   ├── styles/
│   │   └── App.css                # Estilos de la app
│   │
│   ├── components/
│   │   ├── Dashboard.jsx          # Metricas principales
│   │   ├── Dashboard.css          # Estilos dashboard
│   │   ├── TradeList.jsx          # Lista de trades
│   │   ├── TradeList.css          # Estilos lista
│   │   ├── TradeDetail.jsx        # Detalle de trade
│   │   ├── TradeDetail.css        # Estilos detalle
│   │   ├── Settings.jsx           # Configuracion
│   │   └── Settings.css           # Estilos settings
│   │
│   └── utils/
│       └── robustness.js          # Validacion, health checks, formatters
│
├── assets/
│   └── README.txt                 # Instrucciones para icon.ico
│
├── dist/                          # Build de produccion (generado)
├── dist-electron/                 # Instaladores (generado)
├── node_modules/                  # Dependencias (generado)
│
├── package.json                   # Configuracion npm + electron-builder
├── vite.config.js                 # Configuracion Vite (puerto 12002)
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
cd 11.TradingJournalDesktop
1.START_ALL.bat
# Este script:
# 1. Verifica si el backend ya esta corriendo en puerto 12000
# 2. Si no, inicia el backend en ventana separada
# 3. Espera hasta que responda (max 60 segundos)
# 4. Inicia Electron cuando el backend esta listo
```

### Desarrollo Manual

```batch
# Terminal 1 - Backend (REQUERIDO)
cd 6.Trading_Journal/backend
.venv\Scripts\activate
python main.py

# Terminal 2 - Electron + Vite
cd 11.TradingJournalDesktop
npm run dev:electron
```

### Build para Produccion

```batch
cd 11.TradingJournalDesktop
npm run build:electron
```

**Output generado en `dist-electron/`:**
- `Trading Journal Desktop Setup.exe` - Instalador NSIS
- `TradingJournalDesktop-Portable.exe` - Version portable

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
// CRITICO para el monitor de posiciones
powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
```

---

## RELACION CON BACKEND

Esta aplicacion **NO tiene backend propio**. Reutiliza el backend de `6.Trading_Journal/`:

| Componente | Ubicacion | Puerto |
|------------|-----------|--------|
| Backend Trading Journal | `6.Trading_Journal/backend/` | 12000 |
| Frontend Electron | `11.TradingJournalDesktop/` | 12002 (dev) |

### Endpoints Principales Consumidos

| Endpoint | Descripcion |
|----------|-------------|
| `GET /api/monitor/status` | Estado del monitor |
| `POST /api/monitor/start` | Iniciar monitor |
| `POST /api/monitor/stop` | Detener monitor |
| `GET /api/entries` | Lista de trades |
| `GET /api/entries/{id}` | Detalle de un trade |
| `PUT /api/entries/{id}` | Actualizar trade (reflexion) |
| `GET /api/entries/statistics` | Estadisticas generales |
| `GET /api/metrics/summary` | Metricas avanzadas |
| `GET /api/metrics/equity-curve` | Curva de equity |
| `GET /api/screenshots/{path}` | Servir screenshot |
| `GET /api/entries/export` | Exportar trades |
| `POST /api/entries/import` | Importar trades |

---

## FUNCIONALIDADES

### Dashboard
- **Metricas principales**: Total P&L, Win Rate, Profit Factor, Max Drawdown
- **Curva de equity**: Visualizacion SVG del crecimiento
- **Gauge de win rate**: Indicador visual circular
- **Trades recientes**: Lista rapida de ultimos trades

### Trade List
- **Tabla completa**: Todos los trades registrados
- **Filtros**: Por estado, simbolo, direccion, fuente
- **Ordenamiento**: Click en columnas para ordenar
- **Badges de estado**: OPEN (amarillo), WIN (verde), LOSS (rojo)

### Trade Detail
- **Resumen de P&L**: USD, porcentaje, R-Multiple
- **Screenshots**: Imagen de entrada y salida
- **Detalles del trade**: Precios, tiempos, cantidad
- **Reflexion editable**: Notas y lecciones aprendidas
- **Emociones**: Antes y despues del trade
- **Calidad del setup**: Slider 1-10

### Settings
- **Control del monitor**: Start/Stop
- **Estado de conexiones**: Backend, TradingBot, Analizador
- **Export/Import**: Backup de datos en JSON
- **Version**: Indicador de version de la app

---

## MONITOR DE POSICIONES

El backend hace polling al TradingBot cada 5 segundos:

```
┌─────────────────────────────────────────────────────────────────┐
│                    POSITION MONITOR                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐     ┌─────────────────┐                        │
│  │ TRADING BOT │────▶│ GET /api/positions                       │
│  │  (5000)     │     │ GET /api/alerts/recent                   │
│  └─────────────┘     └─────────────────┘                        │
│         │                     │                                  │
│         │                     ▼                                  │
│         │            ┌─────────────────┐                        │
│         │            │ Detectar cambios│                        │
│         │            │ - Nueva posicion│                        │
│         │            │ - Posicion cerrada                       │
│         │            └────────┬────────┘                        │
│         │                     │                                  │
│         │    ┌────────────────┼────────────────┐                │
│         │    │                │                │                │
│         ▼    ▼                ▼                ▼                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐         │
│  │ Match Alert │    │Create Entry │    │Close Entry  │         │
│  │ → Source    │    │+ Screenshot │    │+ Screenshot │         │
│  └─────────────┘    └─────────────┘    └─────────────┘         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Flujo Completo

1. **Nueva posicion detectada**:
   - Match con alerta reciente para determinar source
   - Crear JournalEntry con estado OPEN
   - Capturar screenshot de entrada (Playwright o mplfinance)

2. **Posicion cerrada detectada**:
   - Actualizar JournalEntry con exit_price, PnL
   - Cambiar estado a CLOSED
   - Capturar screenshot de salida
   - Calcular R-Multiple si hay SL definido

---

## UTILIDADES DE ROBUSTEZ

`src/utils/robustness.js` incluye:

```javascript
// Retry con backoff exponencial
async function retryWithBackoff(fn, maxRetries = 3, delay = 1000)

// Health checks
async function checkBackendHealth()      // Verifica backend Journal (12000)
async function checkTradingBotConnection() // Verifica TradingBot (5000)

// Formatters
function formatCurrency(value)  // $1,234.56
function formatPercent(value)   // +12.34%
function formatR(value)         // 2.5R

// Connection tracker
class ConnectionTracker {
  static getInstance()
  checkAll()
  onStatusChange(callback)
}
```

---

## PUERTOS DEL ECOSISTEMA

| Aplicacion | Backend | Frontend |
|------------|---------|----------|
| Backtester | 9000 | 5173 |
| Watchlist | 8000 | 5173 |
| Trading Bot | 5000 | 3000/5001 |
| Analizador Cripto | 10000 | 10001 |
| Order Flow | 11000 | 11001 |
| **Trading Journal (browser)** | 12000 | 12001 |
| **Trading Journal Desktop** | 12000 (compartido) | 12002 (dev) |

---

## TROUBLESHOOTING

### Backend no disponible

**Sintoma**: Error "Cannot connect to localhost:12000"

**Solucion**:
1. Usar `1.START_ALL.bat` que inicia backend automaticamente
2. O manualmente:
   ```batch
   cd 6.Trading_Journal/backend
   .venv\Scripts\activate
   python main.py
   ```

### Monitor no detecta posiciones

**Sintoma**: Posiciones no se registran automaticamente

**Solucion**:
1. Verificar que TradingBot esta corriendo en puerto 5000
2. Verificar en Settings que el monitor esta "Running"
3. Revisar logs del backend Journal

### Screenshots no se capturan

**Sintoma**: Trades sin imagenes de entrada/salida

**Solucion**:
1. Verificar que Analizador o Watchlist esta abierto
2. Playwright puede fallar si el browser no esta disponible
3. El fallback mplfinance genera charts estaticos

### Source siempre es "manual"

**Sintoma**: Todos los trades muestran source "manual"

**Solucion**:
1. El matching requiere alerta reciente (ventana de 30 min)
2. Verificar que el sistema de alertas esta funcionando
3. Revisar endpoint `/api/alerts/recent` en TradingBot

### Metricas no se actualizan

**Sintoma**: Dashboard muestra datos viejos

**Solucion**:
1. Las metricas se recalculan al consultar
2. Verificar que hay trades cerrados (no solo abiertos)
3. Refrescar la pagina (F5)

### Electron no inicia

**Sintoma**: `npm run dev:electron` falla

**Solucion**:
1. Verificar que `npm install` se ejecuto correctamente
2. Verificar que Vite inicia en puerto 12002
3. Verificar version de Node.js (recomendado 18+)

---

## HISTORIAL DE DESARROLLO

### Enero 2026 - Migracion a Electron

**Problema original**:
- Monitor de posiciones se pausaba en background
- Screenshots se perdian cuando el tab estaba inactivo
- Metricas desactualizadas al volver

**Solucion implementada**:
1. Crear nueva app Electron (`11.TradingJournalDesktop/`)
2. Migrar frontend de `6.Trading_Journal/frontend/`
3. Configurar anti-throttling completo
4. Agregar System Tray y PowerSaveBlocker
5. Crear script de inicio coordinado (`1.START_ALL.bat`)

**Archivos creados**:
- `electron/main.js` - Proceso principal con anti-throttling
- `electron/preload.js` - Bridge seguro
- `src/` - Frontend React migrado con API_BASE_URL centralizado
- `src/utils/robustness.js` - Utilidades de conexion
- `package.json` - Scripts y electron-builder config
- `vite.config.js` - Puerto 12002
- `1.START_ALL.bat` - Inicio coordinado
- `CLAUDE.md` - Esta documentacion

**Resultado**:
- ✅ Monitor de posiciones continuo
- ✅ Screenshots capturados correctamente
- ✅ Metricas siempre actualizadas
- ✅ App corre en segundo plano via System Tray
