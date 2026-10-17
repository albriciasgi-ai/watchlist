/**
 * Order Flow Desktop - Main Process
 *
 * Este es el proceso principal de Electron que:
 * 1. Desactiva el throttling de Chromium (CRITICO para evitar gaps)
 * 2. Previene que el sistema entre en suspension
 * 3. Implementa system tray para ejecucion en background
 */

const { app, BrowserWindow, powerSaveBlocker, Tray, Menu, nativeImage, Notification, ipcMain, shell } = require('electron');
const path = require('path');

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
// CONFIGURACION DE RED (Optimizar conexiones concurrentes)
// ============================================================

// Aumentar limite de conexiones por host (default es 6, subimos a 64)
app.commandLine.appendSwitch('max-connections-per-host', '64');

// Aumentar sockets maximos por grupo
app.commandLine.appendSwitch('max-sockets-per-group', '64');

// Aumentar sockets maximos por proxy
app.commandLine.appendSwitch('max-sockets-per-proxy-server', '64');

// Ignorar limites de conexion del certificado
app.commandLine.appendSwitch('ignore-connections-limit', 'localhost');

// Aumentar memoria para JavaScript
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

// ============================================================
// VARIABLES GLOBALES
// ============================================================

let mainWindow = null;
let tray = null;
let powerSaveBlockerId = null;

// URL del servidor de desarrollo o archivo en produccion
const isDev = !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:11001';

// ============================================================
// FUNCIONES PRINCIPALES
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 800,
    title: 'Altagracia Order Flow, Allahu Akbar!!',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      // CRITICO: Desactivar throttling en background
      backgroundThrottling: false,

      // Preload script para comunicacion segura
      preload: path.join(__dirname, 'preload.js'),

      // Seguridad - relajada temporalmente para debugging
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,  // Desactivado para permitir mas conexiones de red

      // Permitir acceso a recursos locales
      webSecurity: false,  // TEMPORAL: Desactivado para debug de CORS
      allowRunningInsecureContent: true
    },
    // Estilo de ventana - tema oscuro para trading
    backgroundColor: '#0d1117',
    show: false // Mostrar cuando este listo
  });

  // Mostrar ventana cuando este lista (evita flash blanco)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // Cargar la aplicacion
  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    // Abrir DevTools en desarrollo
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Minimizar a tray en lugar de cerrar
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // Mostrar notificacion la primera vez
      if (Notification.isSupported()) {
        new Notification({
          title: 'Altagracia Order Flow, Allahu Akbar!!',
          body: 'La aplicacion sigue ejecutandose en segundo plano. El Order Flow continua activo.',
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
      label: 'Abrir Order Flow',
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

  tray.setToolTip('Order Flow Desktop - Analisis de flujo de ordenes');
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
// EVENTOS DE LA APLICACION
// ============================================================

// ============================================================
// IPC HANDLERS (para FootprintArchiver)
// ============================================================

ipcMain.handle('get-user-data-path', () => {
  return app.getPath('userData');
});

ipcMain.handle('open-folder', (event, folderPath) => {
  shell.openPath(folderPath);
});

// ============================================================
// FOOTPRINT DOWNLOADER (Main Process - Sin restricciones CORS)
// ============================================================

const fs = require('fs').promises;
const https = require('https');

/**
 * Descarga footprints desde el cloud usando Node.js https (sin CORS)
 */
ipcMain.handle('download-footprints', async (event, { symbol, hours, interval }) => {
  const CLOUD_URL = 'https://p01--altagracia--rxv8nrbhxln9.code.run';
  const url = `${CLOUD_URL}/api/footprints/${symbol}?hours=${hours}&interval=${interval}`;

  console.log(`[Main] Descargando ${symbol} desde: ${url}`);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('TIMEOUT después de 180 segundos'));
    }, 180000);

    https.get(url, { timeout: 180000 }, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        clearTimeout(timeout);

        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
          return;
        }

        try {
          const json = JSON.parse(data);
          const footprints = json.footprints || [];
          console.log(`[Main] ✅ ${symbol}: ${footprints.length} footprints descargados`);
          resolve(footprints);
        } catch (error) {
          reject(new Error(`Error parseando JSON: ${error.message}`));
        }
      });
    }).on('error', (error) => {
      clearTimeout(timeout);
      console.error(`[Main] ❌ Error descargando ${symbol}:`, error.message);
      reject(error);
    });
  });
});

// ============================================================
// INICIO DE LA APLICACION
// ============================================================

app.whenReady().then(() => {
  console.log('====================================');
  console.log('Order Flow Desktop - Iniciando...');
  console.log('====================================');
  console.log('[Config] Modo:', isDev ? 'Desarrollo' : 'Produccion');
  console.log('[Config] Anti-throttling: ACTIVADO');
  console.log('[Config] userData:', app.getPath('userData'));
  console.log('[Config] Backend esperado en: http://localhost:11000');

  // Iniciar PowerSaveBlocker
  startPowerSaveBlocker();

  // Crear ventana principal
  createWindow();

  // Crear system tray
  createTray();

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
