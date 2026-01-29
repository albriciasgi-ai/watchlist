/**
 * Watchlist Desktop - Main Process
 *
 * Este es el proceso principal de Electron que:
 * 1. Desactiva el throttling de Chromium (CRITICO para evitar gaps)
 * 2. Previene que el sistema entre en suspension
 * 3. Implementa system tray para ejecucion en background
 */

const { app, BrowserWindow, powerSaveBlocker, Tray, Menu, nativeImage, Notification } = require('electron');
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
const DEV_SERVER_URL = 'http://localhost:5173';

// ============================================================
// FUNCIONES PRINCIPALES
// ============================================================

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    title: 'Watchlist Desktop',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      // CRITICO: Desactivar throttling en background
      backgroundThrottling: false,

      // Preload script para comunicacion segura
      preload: path.join(__dirname, 'preload.js'),

      // Seguridad - relajada temporalmente para debugging
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,  // Desactivado para permitir más conexiones de red

      // Permitir acceso a recursos locales
      webSecurity: true,
      allowRunningInsecureContent: false
    },
    // Estilo de ventana
    backgroundColor: '#1a1a2e',
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
          title: 'Watchlist Desktop',
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
      label: 'Abrir Watchlist',
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

  tray.setToolTip('Watchlist Desktop');
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

app.whenReady().then(() => {
  console.log('====================================');
  console.log('Watchlist Desktop - Iniciando...');
  console.log('====================================');
  console.log('[Config] Modo:', isDev ? 'Desarrollo' : 'Produccion');
  console.log('[Config] Anti-throttling: ACTIVADO');

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
