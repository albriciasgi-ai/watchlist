# Watchlist Desktop

Aplicacion de escritorio para monitoreo de criptomonedas en tiempo real, construida con Electron + React.

## Por que Electron?

El navegador tradicional tiene limitaciones que afectan aplicaciones de trading:

| Problema en Navegador | Solucion en Electron |
|----------------------|---------------------|
| Throttling en tabs inactivos | `disable-renderer-backgrounding` |
| Gaps en graficos al minimizar | `backgroundThrottling: false` |
| Sistema entra en suspension | `powerSaveBlocker` |
| Sin system tray | Tray nativo de Windows |

## Arquitectura

```
┌─────────────────────────────────────────┐
│           ELECTRON (Desktop App)         │
│  ┌─────────────────────────────────────┐│
│  │     React (Solo Visualizacion)      ││
│  │  - Graficos con uPlot               ││
│  │  - Sin calculos de indicadores      ││
│  │  - Sin throttling                   ││
│  └─────────────────────────────────────┘│
│                    ↕ HTTP/WebSocket      │
└─────────────────────────────────────────┘
                     ↕
┌─────────────────────────────────────────┐
│      BACKEND (FastAPI - Puerto 8000)     │
│  - Calculos de indicadores              │
│  - Deteccion de patrones                │
│  - Alertas al Trading Bot               │
└─────────────────────────────────────────┘
```

## Instalacion

### Requisitos
- Node.js 18+
- Backend de Watchlist corriendo en puerto 8000

### Pasos

1. **Instalar dependencias:**
   ```bash
   # Doble-click en:
   1_INSTALL.bat
   ```

2. **Modo desarrollo:**
   ```bash
   # Primero iniciar el backend (puerto 8000)
   # Luego doble-click en:
   2_START_DEV.bat
   ```

3. **Crear ejecutable:**
   ```bash
   # Doble-click en:
   3_BUILD.bat
   ```

## Estructura

```
7.WatchlistDesktop/
├── electron/
│   ├── main.js          # Proceso principal + anti-throttling
│   └── preload.js       # Bridge seguro
├── src/                 # App React (display only)
│   ├── components/      # Componentes UI
│   ├── hooks/           # Custom hooks
│   └── utils/           # Utilidades
├── assets/
│   └── icon.ico         # Icono de la app
├── dist/                # Build de React
├── dist-electron/       # Ejecutables Windows
└── package.json
```

## Configuracion Anti-Throttling

El archivo `electron/main.js` incluye las configuraciones criticas:

```javascript
// Desactivar throttling de Chromium
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Prevenir suspension del sistema
powerSaveBlocker.start('prevent-app-suspension');

// Ventana sin throttling
new BrowserWindow({
  webPreferences: {
    backgroundThrottling: false
  }
});
```

## System Tray

La aplicacion se minimiza al system tray en lugar de cerrarse:
- **Click derecho** en el icono: Menu contextual
- **Doble-click**: Restaurar ventana
- La app sigue ejecutandose en segundo plano

## Backend

Esta app requiere el backend de la Watchlist corriendo:

```bash
cd 2.WatchlistConIndicadores/backend
start_backend.bat
```

El backend maneja:
- Conexion WebSocket con Bybit
- Calculos de indicadores (VWAP, Swing, etc.)
- Deteccion de patrones
- Envio de alertas al Trading Bot

## Troubleshooting

### "Error: Cannot find module 'electron'"
```bash
npm install
```

### "ECONNREFUSED localhost:8000"
El backend no esta corriendo. Inicia el backend primero.

### La ventana no aparece
Revisa el system tray (bandeja del sistema) - la app puede estar minimizada ahi.

## Diferencias con App 2 (Navegador)

| Aspecto | App 2 (Browser) | App 7 (Electron) |
|---------|-----------------|------------------|
| Throttling | Si (gaps) | No |
| System Tray | No | Si |
| Notificaciones | Browser API | Nativas OS |
| Tamano | ~0 MB | ~150 MB |
| Requiere browser | Si | No |
