const { app, BrowserWindow, Tray, Menu, powerSaveBlocker, nativeImage } = require('electron');
const path = require('path');

// ===========================================
// ANTI-THROTTLING CONFIG (MUST BE BEFORE app.whenReady)
// ===========================================
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// GPU optimizations
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// V8 memory
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');

let mainWindow;
let tray;
let powerSaveId = null;

const isDev = process.env.NODE_ENV !== 'production' && !app.isPackaged;
const DEV_SERVER_URL = 'http://localhost:12002';

function createWindow() {
  // Start power save blocker
  powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
  console.log('[Electron] PowerSaveBlocker started:', powerSaveId);

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    title: 'Trading Journal Desktop',
    icon: path.join(__dirname, '../assets/icon.ico'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false, // Critical for real-time updates
    },
    show: false,
  });

  // Load app
  if (isDev) {
    mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // Show when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    console.log('[Electron] Window ready');
  });

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();

      // Show notification only first time
      if (tray && !app.minimizedBefore) {
        tray.displayBalloon({
          title: 'Trading Journal',
          content: 'La aplicacion sigue ejecutandose en segundo plano.'
        });
        app.minimizedBefore = true;
      }
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Create tray
  createTray();
}

function createTray() {
  const iconPath = path.join(__dirname, '../assets/icon.ico');

  try {
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  } catch (e) {
    console.warn('[Electron] Could not load tray icon:', e.message);
    tray = new Tray(nativeImage.createEmpty());
  }

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Abrir Trading Journal',
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
        app.isQuitting = true;
        app.relaunch();
        app.exit(0);
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

  tray.setToolTip('Trading Journal Desktop');
  tray.setContextMenu(contextMenu);

  // Double click to show window
  tray.on('double-click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

// Single instance lock
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  console.log('[Electron] App ready, creating window...');
  console.log('[Electron] Anti-throttling flags enabled');
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;

  // Stop power save blocker
  if (powerSaveId !== null) {
    powerSaveBlocker.stop(powerSaveId);
    console.log('[Electron] PowerSaveBlocker stopped');
  }
});

// Handle certificate errors (for development)
app.on('certificate-error', (event, webContents, url, error, certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
