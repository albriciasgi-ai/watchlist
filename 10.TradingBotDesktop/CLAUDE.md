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

