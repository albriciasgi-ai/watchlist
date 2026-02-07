/**
 * Analizador Desktop - Main Process
 *
 * Proceso principal de Electron que:
 * 1. Desactiva el throttling de Chromium (CRITICO para evitar gaps en graficos)
 * 2. Previene que el sistema entre en suspension
 * 3. Implementa system tray para ejecucion en background
 */

const { app, BrowserWindow, powerSaveBlocker, Tray, Menu, nativeImage, Notification, ipcMain } = require('electron');
const path = require('path');
const http = require('http');
const fs = require('fs');

// ============================================================
// CONFIGURACION ANTI-THROTTLING (DEBE IR ANTES DE app.whenReady)
// ============================================================

// Desactivar throttling del renderer cuando esta en background
// Esto es CRITICO para evitar gaps en los graficos
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Desactivar throttling de timers en background
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Desactivar throttling de ventanas ocultas
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ============================================================
// OPTIMIZACIONES DE RENDIMIENTO
// ============================================================

// Habilitar aceleracion por hardware (GPU)
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');

// Optimizar renderizado de canvas (uPlot usa canvas)
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');

// Usar GPU para composicion de capas
app.commandLine.appendSwitch('enable-gpu-compositing');

// Ignorar lista negra de GPU (forzar aceleracion)
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// Optimizar V8 (motor JavaScript)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// ============================================================
// VARIABLES GLOBALES
// ============================================================

let mainWindow = null;
let tray = null;
let powerSaveBlockerId = null;
let screenshotServer = null;
let currentSymbol = 'BTCUSDT'; // Simbolo actual mostrado en el chart
const SCREENSHOT_PORT = 5180;

// URL del servidor de desarrollo o archivo en produccion
// ELECTRON_DEV_MODE=1 fuerza modo desarrollo (usado por dev:electron)
// Sin esa variable, carga desde dist/ (modo produccion local)
// NOTA: En Windows, tambien verificamos si Vite esta corriendo en el puerto
const isDev = process.env.ELECTRON_DEV_MODE === '1' || process.env.npm_lifecycle_event === 'dev:electron';
const DEV_SERVER_URL = 'http://localhost:5174';

// ============================================================
// FUNCIONES PRINCIPALES
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1000,
    minHeight: 700,
    title: 'Analizador Desktop',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      // CRITICO: Desactivar throttling en background
      backgroundThrottling: false,

      // Preload script para comunicacion segura
      preload: path.join(__dirname, 'preload.js'),

      // Seguridad
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,  // Desactivar sandbox para mejor rendimiento

      // OPTIMIZACIONES DE RENDIMIENTO
      enableBlinkFeatures: 'CSSColorSchemeUARendering',
      spellcheck: false,  // Desactivar corrector ortografico
      v8CacheOptions: 'bypassHeatCheck',  // Cache V8 agresivo
    },
    // Estilo de ventana (tema claro como el Analizador original)
    backgroundColor: '#F7F9FB',
    show: false // Mostrar cuando este listo
  });

  // Mostrar ventana cuando este lista (evita flash blanco)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Cargar la aplicacion
  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    // DevTools: Desactivado por defecto para mejor rendimiento
    // Presiona F12 para abrir manualmente si lo necesitas
    // mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Atajo F12 para abrir/cerrar DevTools manualmente
  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12') {
      mainWindow.webContents.toggleDevTools();
    }
  });

  // Minimizar a tray en lugar de cerrar
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // Mostrar notificacion la primera vez
      if (Notification.isSupported()) {
        new Notification({
          title: 'Analizador Desktop',
          body: 'La aplicacion sigue ejecutandose en segundo plano',
          icon: path.join(__dirname, '../assets/icon.ico')
        }).show();
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray() {
  // Crear icono para el tray
  const iconPath = path.join(__dirname, '../assets/icon.ico');

  // Usar icono por defecto si no existe el archivo
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      // Crear icono simple si no hay archivo
      trayIcon = nativeImage.createEmpty();
    }
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Analizador',
      click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    {
      label: 'Reiniciar',
      click: () => {
        app.relaunch();
        app.quit();
      }
    },
    { type: 'separator' },
    {
      label: 'Cerrar',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);

  tray.setToolTip('Analizador Desktop');
  tray.setContextMenu(contextMenu);

  // Doble click para abrir
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function startPowerSaveBlocker() {
  // Prevenir que el sistema entre en suspension
  // Esto mantiene la CPU activa para recibir datos en tiempo real
  powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');

  console.log('[PowerSaveBlocker] Iniciado con ID:', powerSaveBlockerId);
  console.log('[PowerSaveBlocker] Esta activo:', powerSaveBlocker.isStarted(powerSaveBlockerId));
}

function stopPowerSaveBlocker() {
  if (powerSaveBlockerId !== null && powerSaveBlocker.isStarted(powerSaveBlockerId)) {
    powerSaveBlocker.stop(powerSaveBlockerId);
    console.log('[PowerSaveBlocker] Detenido');
  }
}

// ============================================================
// SCREENSHOT SERVER (HTTP para Trading Journal)
// ============================================================

function startScreenshotServer() {
  screenshotServer = http.createServer(async (req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${SCREENSHOT_PORT}`);

    // GET /status - Estado del servidor y simbolo actual
    if (url.pathname === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        available: true,
        currentSymbol: currentSymbol,
        windowReady: mainWindow !== null && !mainWindow.isDestroyed()
      }));
      return;
    }

    // GET /screenshot?symbol=BTCUSDT - Captura screenshot
    if (url.pathname === '/screenshot') {
      const requestedSymbol = url.searchParams.get('symbol');

      if (!mainWindow || mainWindow.isDestroyed()) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Window not available' }));
        return;
      }

      try {
        // Si el simbolo solicitado no coincide con el actual, informar
        const symbolMatch = !requestedSymbol || requestedSymbol === currentSymbol;

        // Dar un momento para que el chart se estabilice si es necesario
        await new Promise(resolve => setTimeout(resolve, 500));

        // Capturar la pagina completa del renderer
        const image = await mainWindow.webContents.capturePage();
        const pngBuffer = image.toPNG();

        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': pngBuffer.length,
          'X-Symbol-Match': symbolMatch ? 'true' : 'false',
          'X-Current-Symbol': currentSymbol
        });
        res.end(pngBuffer);

        console.log(`[ScreenshotServer] Screenshot capturado (symbol: ${currentSymbol}, requested: ${requestedSymbol || 'any'}, match: ${symbolMatch})`);

      } catch (err) {
        console.error('[ScreenshotServer] Error capturando screenshot:', err.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: err.message }));
      }
      return;
    }

    // Ruta no encontrada
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  screenshotServer.listen(SCREENSHOT_PORT, '127.0.0.1', () => {
    console.log(`[ScreenshotServer] Servidor de screenshots activo en http://127.0.0.1:${SCREENSHOT_PORT}`);
  });

  screenshotServer.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[ScreenshotServer] Puerto ${SCREENSHOT_PORT} en uso, reintentando...`);
      setTimeout(() => {
        screenshotServer.close();
        screenshotServer.listen(SCREENSHOT_PORT, '127.0.0.1');
      }, 1000);
    } else {
      console.error('[ScreenshotServer] Error del servidor:', err.message);
    }
  });
}

function stopScreenshotServer() {
  if (screenshotServer) {
    screenshotServer.close();
    console.log('[ScreenshotServer] Servidor detenido');
  }
}

// ============================================================
// IPC HANDLERS
// ============================================================

// El renderer reporta cual simbolo esta mostrando
ipcMain.on('report-current-symbol', (event, symbol) => {
  if (symbol && typeof symbol === 'string') {
    currentSymbol = symbol;
  }
});

// Handler para obtener el simbolo actual (desde renderer)
ipcMain.handle('get-current-symbol', () => {
  return currentSymbol;
});

// ============================================================
// EVENTOS DE LA APLICACION
// ============================================================

app.whenReady().then(() => {
  console.log('====================================');
  console.log('Analizador Desktop - Iniciando...');
  console.log('====================================');
  console.log('[Config] Modo:', isDev ? 'Desarrollo' : 'Produccion');
  console.log('[Config] Anti-throttling: ACTIVADO');
  console.log('[Config] Backend esperado en: http://localhost:10000');

  // Iniciar PowerSaveBlocker
  startPowerSaveBlocker();

  // Crear ventana principal
  createWindow();

  // Crear system tray
  createTray();

  // Iniciar servidor de screenshots para Trading Journal
  startScreenshotServer();

  app.on('activate', () => {
    // En macOS es comun recrear la ventana cuando se hace click en el dock
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('window-all-closed', () => {
  // En macOS las apps generalmente permanecen activas hasta que el usuario cierra explicitamente
  if (process.platform !== 'darwin') {
    // No cerrar - mantener en tray
    // app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopPowerSaveBlocker();
  stopScreenshotServer();
});

app.on('will-quit', () => {
  stopPowerSaveBlocker();
});

// ============================================================
// MANEJO DE ERRORES
// ============================================================

process.on('uncaughtException', (error) => {
  console.error('[Main Process] Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[Main Process] Promise rechazada:', reason);
});
