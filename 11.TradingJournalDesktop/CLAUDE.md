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
| `GET /api/monitor/status` | Estado del monitor (running, tracked_positions, etc) |
| `POST /api/monitor/start` | Iniciar monitor de posiciones |
| `POST /api/monitor/stop` | Detener monitor de posiciones |
| `POST /api/monitor/reconcile` | Reconciliar entries huerfanas con TradingBot |
| `GET /api/entries` | Lista de trades |
| `GET /api/entries/{id}` | Detalle de un trade |
| `PUT /api/entries/{id}` | Actualizar trade (reflexion, SL, TP, etc) |
| `GET /api/entries/statistics` | Estadisticas generales |
| `GET /api/metrics/summary` | Metricas avanzadas |
| `GET /api/metrics/equity-curve` | Curva de equity |
| `GET /screenshots/{path}` | Servir screenshot (StaticFiles) |
| `GET /api/entries/export` | Exportar trades a JSON |
| `POST /api/entries/import` | Importar trades desde JSON |

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
- **Screenshots**: Imagen de entrada y salida (con manejo de errores)
- **Detalles del trade**: Precios, tiempos, cantidad
- **SL/TP editables**: Campos para editar Stop Loss y Take Profit manualmente
- **Reflexion editable**: Notas y lecciones aprendidas
- **Emociones**: Antes y despues del trade
- **Calidad del setup**: Slider 1-10
- **Seguir reglas**: Checkbox editable

### Settings
- **Control del monitor**: Start/Stop con indicador visual de estado
- **Posiciones rastreadas**: Cantidad de posiciones en seguimiento
- **Intervalo de polling**: Frecuencia de verificacion (default 5s)
- **Boton Reconciliar**: Sincroniza entries con TradingBot
- **Estado de conexiones**: Backend, TradingBot
- **Export/Import**: Backup de datos en JSON
- **Limpiar screenshots**: Eliminar todos los screenshots
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

### Screenshots no se muestran (imagen rota)

**Sintoma**: Icono de imagen rota en lugar del screenshot

**Solucion**:
1. El screenshot puede no existir (trade historico sin captura)
2. Verificar que la ruta tiene formato correcto en la DB
3. El frontend normaliza rutas Windows automaticamente
4. Revisar consola del navegador por errores 404

### R-Multiple muestra 0 o N/A

**Sintoma**: R-Multiple no se calcula

**Solucion**:
1. R-Multiple requiere Stop Loss definido
2. Editar el trade y agregar SL manualmente
3. El calculo es: `(exit_price - entry_price) / (entry_price - stop_loss)`

### Entries huerfanas (OPEN sin posicion real)

**Sintoma**: Trades marcados como OPEN pero ya fueron cerrados

**Solucion**:
1. Ir a Settings → Click en "Reconciliar"
2. Esto cierra automaticamente entries sin posicion activa
3. Alternativa: Editar manualmente el trade y cambiar estado

### Screenshots se capturan en blanco

**Sintoma**: Screenshot existe pero muestra pagina en blanco

**Solucion**:
1. AnalizadorDesktop debe estar completamente cargado
2. El simbolo del trade debe estar seleccionado en el Analizador
3. Playwright espera 3 segundos, puede no ser suficiente
4. Verificar que no hay errores en consola del Analizador

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

---

### Febrero 2026 - Mejoras de Screenshots, SL/TP y Reconciliacion

**Problemas identificados**:
1. Screenshots no se mostraban correctamente (rutas con backslashes)
2. SL/TP no se capturaban del TradingBot
3. R-Multiple no se calculaba
4. Entries huerfanas quedaban abiertas indefinidamente
5. No habia forma de editar SL/TP manualmente
6. Puertos de screenshot apuntaban a versiones web en lugar de Desktop

**Solucion implementada en 4 fases**:

#### Fase 1: Screenshots
- Normalizacion de rutas Windows (backslashes → forward slashes)
- Funcion `getScreenshotUrl()` corregida en TradeDetail.jsx
- Manejo de errores de carga con estado `screenshotErrors`
- Placeholder visual cuando la imagen no carga

#### Fase 2: Captura de SL/TP y R-Multiple
- Backend captura SL/TP desde TradingBot al crear entry
- Calculo automatico de R-Multiple cuando hay SL definido
- Mejora en matching de source con alertas recientes (ventana 30 min)

#### Fase 3: Reconciliacion de Entries
- Deteccion de cambios de direccion (cierra entry anterior, crea nueva)
- Endpoint `/api/monitor/reconcile` para limpiar entries huerfanas
- Cierra entries OPEN que no tienen posicion activa en TradingBot

#### Fase 4: UI Mejorada
- Indicador visual de estado del monitor (activo/inactivo con badge)
- Campos editables para SL/TP en TradeDetail
- Boton "Reconciliar" en Settings para sincronizacion manual
- Checkbox "Seguir reglas" editable

**Archivos modificados**:

| Archivo | Cambios |
|---------|---------|
| `src/components/TradeDetail.jsx` | `getScreenshotUrl()`, `screenshotErrors` state, `handleScreenshotError()`, campos editables SL/TP |
| `src/components/TradeDetail.css` | Estilo `.detail-input` para campos editables |
| `src/components/Settings.jsx` | Estado `reconciling`, funcion `handleReconcile()`, boton Reconciliar |
| `6.Trading_Journal/backend/services/screenshot_service.py` | Puertos actualizados a versiones Desktop |

**Cambio de puertos para Screenshots**:

El screenshot service ahora usa las versiones Desktop:

```python
# ANTES (versiones web)
"analizador": "http://localhost:10001"
"order_flow": "http://localhost:11001"

# DESPUES (versiones Desktop)
"analizador": "http://localhost:5174"   # AnalizadorDesktop
"order_flow": "http://localhost:5175"   # OrderFlowDesktop
```

**Resultado**:
- ✅ Screenshots se muestran correctamente
- ✅ SL/TP se capturan automaticamente
- ✅ R-Multiple calculado cuando hay SL
- ✅ Entries huerfanas se pueden reconciliar
- ✅ SL/TP editables manualmente
- ✅ Screenshots capturados desde apps Desktop

---

## SISTEMA DE SCREENSHOTS

### Como Funciona

El sistema de screenshots captura el grafico **en el momento** de abrir/cerrar una posicion:

1. **Al abrir posicion**: El backend detecta nueva posicion via polling al TradingBot
2. **Playwright navega** a la URL del AnalizadorDesktop (puerto 5174)
3. **Espera renderizado** del grafico (3 segundos)
4. **Captura screenshot** del elemento `.chart-container` o canvas
5. **Guarda en** `screenshots/{symbol}/{entry_id}_{event}_{timestamp}.png`

### Requisitos para Screenshots

| Requisito | Puerto | Descripcion |
|-----------|--------|-------------|
| AnalizadorDesktop | 5174 | Debe estar corriendo y visible |
| TradingBot | 5000 | Para detectar posiciones |
| Backend Journal | 12000 | Orquesta la captura |

### Limitaciones

- **Solo trades nuevos**: No puede generar screenshots para trades historicos
- **Requiere app abierta**: AnalizadorDesktop debe estar corriendo
- **Fallback mplfinance**: Si Playwright falla, genera chart estatico basico

### URLs de Frontend para Screenshots

```python
# En screenshot_service.py
self.frontend_urls = {
    "watchlist": "http://localhost:5173",      # App 2 (web)
    "analizador": "http://localhost:5174",     # App 8 AnalizadorDesktop
    "order_flow": "http://localhost:5175",     # App 9 OrderFlowDesktop
    "backtester": "http://localhost:5173"      # App 1 (web)
}
```

### Ruta de Screenshots

```
screenshots/
├── BTCUSDT/
│   ├── abc123_entry_20260201_153000.png
│   └── abc123_exit_20260201_160000.png
├── ETHUSDT/
│   └── def456_entry_20260201_154500.png
└── ...
```

### Normalizacion de Rutas

El frontend normaliza rutas Windows para URLs HTTP:

```javascript
const getScreenshotUrl = (path) => {
  if (!path) return null
  // Convertir backslashes a forward slashes
  let normalizedPath = path.replace(/\\/g, '/')
  // Remover prefijo "screenshots/" si existe
  normalizedPath = normalizedPath.replace(/^\/?screenshots\//, '')
  return `${API_BASE_URL}/screenshots/${normalizedPath}`
}
```

---

## ENDPOINT DE RECONCILIACION

### POST /api/monitor/reconcile

Sincroniza el estado del Journal con las posiciones reales del TradingBot:

```javascript
// Desde Settings.jsx
const handleReconcile = async () => {
  const res = await fetch(`${API_BASE_URL}/api/monitor/reconcile`, {
    method: 'POST'
  })
  const data = await res.json()
  // data.result.closed_orphans = entries cerradas
  // data.result.created_entries = entries creadas
}
```

### Que hace:

1. **Cierra entries huerfanas**: Entries con estado OPEN pero sin posicion activa en TradingBot
2. **Crea entries faltantes**: Posiciones activas en TradingBot sin entry en Journal
3. **Retorna resumen**: Cantidad de entries cerradas y creadas

### Cuando usarlo:

- Despues de reiniciar el backend
- Si hay desincronizacion entre Journal y TradingBot
- Para limpiar entries que quedaron "colgadas"
