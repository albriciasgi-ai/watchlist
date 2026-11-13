/**
 * Altagracia Trading Suite - Escritorio (Electron)
 *
 * La pagina es la misma que sirve el servidor de la suite (http://127.0.0.1:13000/). Electron solo
 * la muestra sin el freno que el navegador pone a las pestanas en segundo plano, para que el grafico,
 * los sondeos y los avisos sigan al dia aunque la ventana este oculta o minimizada.
 *
 * Al arrancar:
 *   1. Si falta web/dist/index.html, arma la pagina (npm install + npm run build en web/) y muestra
 *      la salida en la ventana de carga.
 *   2. Si el servidor ya responde en /api/suite/status, lo usa y no lo toca. Si no, lo lanza sin
 *      ventana (python de config/suite.json o C:\Python314\python.exe) y lo cierra al salir.
 *   3. Abre la ventana principal. Cerrarla la oculta en la bandeja; "Salir" cierra de verdad.
 *
 * Puerto: SUITE_PORT > config/suite.json (o SUITE_CONFIG) > 13000. Python: SUITE_PYTHON > "python"
 * de config/suite.json > C:\Python314\python.exe. Las variables SUITE_* pasan tal cual al servidor.
 */

const { app, BrowserWindow, Menu, Tray, nativeImage, powerSaveBlocker, shell, dialog } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

// ---------- sin freno en segundo plano (antes de app.whenReady) ----------
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// ---------- configuracion ----------
const SUITE_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(SUITE_DIR, 'web');
const DIST_INDEX = path.join(WEB_DIR, 'dist', 'index.html');
const ICON = path.join(__dirname, 'icon.ico');
const APP_NAME = 'Altagracia Trading Suite';

function readConfig() {
  const file = process.env.SUITE_CONFIG || path.join(SUITE_DIR, 'config', 'suite.json');
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch (e) {
    console.error(`[DESKTOP] config ilegible (${file}): ${e.message}; se usan los valores de fabrica`);
  }
  return {};
}

const CFG = readConfig();
const PORT = parseInt(process.env.SUITE_PORT || CFG.port || 13000, 10);
const CFG_HOST = process.env.SUITE_HOST || CFG.host || '127.0.0.1';
// Escuchando en todas las interfaces o en localhost, la ventana entra por 127.0.0.1
const HOST = ['0.0.0.0', '::', '', 'localhost'].includes(CFG_HOST) ? '127.0.0.1' : CFG_HOST;
const BASE_URL = `http://${HOST}:${PORT}/`;
const BASE_ORIGIN = new URL(BASE_URL).origin;
const PYTHON = process.env.SUITE_PYTHON || CFG.python || 'C:\\Python314\\python.exe';
const DATA_DIR = process.env.SUITE_DATA_DIR || CFG.data_dir || path.join(SUITE_DIR, 'data');
const SERVER_LOG = path.join(DATA_DIR, 'servidor_desktop.log');
const DESKTOP_LOG = path.join(DATA_DIR, 'desktop.log');

// Lo que pasa en la app de escritorio queda en data/desktop.log (y en la consola)
function dlog(msg) {
  const line = `[DESKTOP] ${msg}`;
  console.log(line);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(DESKTOP_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* sin registro */ }
}

const START_TIMEOUT_MS = 120000; // el servidor importa los lectores de App 1: puede tardar
const BUILD_TIMEOUT_MS = 15 * 60000;

const WEB_PREFS = {
  backgroundThrottling: false,
  contextIsolation: true,
  nodeIntegration: false,
};

// ---------- estado ----------
let mainWindow = null;
let loadingWindow = null;
let tray = null;
let serverChild = null; // solo si lo lanzo esta app
let serverReady = false;
let quitting = false;
let trayHintShown = false;
const restarts = [];

// Nombre propio para Windows: la barra de tareas y los avisos muestran la app con su icono, no como "Electron"
if (process.platform === 'win32') app.setAppUserModelId('Altagracia.TradingSuite');

// ---------- una sola instancia ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Abrirla otra vez: si el codigo cambio desde que arranco, se reinicia con la version nueva; si no, se muestra.
  // Cerrar con la X solo la oculta en la bandeja, asi que "cerrar y volver a abrir" mostraba la version vieja
  app.on('second-instance', () => {
    if (codeAtStart && newestCode() > codeAtStart) restartApp('codigo nuevo al volver a abrir');
    else showMain();
  });
  app.whenReady().then(start);
}

// ---------- utilidades ----------
function isSameOrigin(url) {
  try {
    return new URL(url).origin === BASE_ORIGIN;
  } catch {
    return false;
  }
}

function checkStatus(timeoutMs = 20000) {
  // Node pone Host: 127.0.0.1:<puerto>, el que el servidor acepta
  return new Promise((resolve) => {
    const req = http.get(`${BASE_ORIGIN}/api/suite/status`, { timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        let ok = false;
        try { ok = res.statusCode === 200 && JSON.parse(body).success === true; } catch { ok = false; }
        resolve({ up: true, ok, status: res.statusCode });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve({ up: false, ok: false }));
  });
}

function checkPage() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL, { timeout: 10000 }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolve(0));
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- ventana de carga ----------
const LOADING_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>${APP_NAME}</title>
<style>
body{margin:0;font:12px "Segoe UI",sans-serif;background:#f7f7f8;color:#1f2328;display:flex;flex-direction:column;height:100vh}
h1{font-size:14px;margin:14px 16px 4px}#msg{margin:0 16px 8px;color:#555}
#msg.err{color:#b42318;font-weight:600}
pre{flex:1;margin:0 16px 16px;padding:8px;background:#fff;border:1px solid #ddd;overflow:auto;font:11px Consolas,monospace;white-space:pre-wrap}
</style></head><body><h1>${APP_NAME}</h1><div id="msg">Iniciando...</div><pre id="log"></pre>
<script>
window.setMsg=(t,err)=>{const m=document.getElementById('msg');m.textContent=t;m.className=err?'err':''};
window.addLog=(t)=>{const p=document.getElementById('log');p.textContent+=t;if(p.textContent.length>200000)p.textContent=p.textContent.slice(-150000);p.scrollTop=p.scrollHeight};
</script></body></html>`;

let loadingReady = null;

function openLoading() {
  loadingWindow = new BrowserWindow({
    width: 760, height: 460, title: APP_NAME, icon: ICON, autoHideMenuBar: true,
    webPreferences: { ...WEB_PREFS },
  });
  loadingReady = loadingWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(LOADING_HTML)).catch(() => {});
  loadingWindow.on('closed', () => {
    loadingWindow = null;
    // Cerrar la carga antes de la ventana principal es salir
    if (!mainWindow && !quitting) app.quit();
  });
}

function loadingCall(fn, ...args) {
  if (!loadingWindow || loadingWindow.isDestroyed()) return;
  const code = `window.${fn}(${args.map((a) => JSON.stringify(a)).join(',')})`;
  loadingReady.then(() => {
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.webContents.executeJavaScript(code).catch(() => {});
  });
}
const setMsg = (t, err = false) => { dlog(t); loadingCall('setMsg', t, err); };
const addLog = (t) => loadingCall('addLog', t);

function fail(message) {
  setMsg(message, true);
  addLog(`\n${message}\n`);
  if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.show();
  dialog.showMessageBox(loadingWindow || undefined, { type: 'error', title: APP_NAME, message }).catch(() => {});
}

// ---------- armar la pagina ----------
function runCommand(label, args) {
  return new Promise((resolve) => {
    addLog(`\n> npm ${args.join(' ')}\n`);
    // npm es un .cmd en Windows: hace falta el shell
    const child = spawn('npm', args, { cwd: WEB_DIR, shell: true, windowsHide: true, env: process.env });
    const timer = setTimeout(() => child.kill(), BUILD_TIMEOUT_MS);
    child.stdout.on('data', (d) => addLog(d.toString()));
    child.stderr.on('data', (d) => addLog(d.toString()));
    child.on('error', (e) => { clearTimeout(timer); addLog(`${label}: ${e.message}\n`); resolve(false); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code === 0); });
  });
}

// Hora del archivo mas nuevo del codigo de la pagina: el de la suite y el de App 1, que la pagina importa
// Codigo que usa la app al correr: la pagina (abajo), el servidor y lo que el servidor importa
function newestCode() {
  const repo = path.join(SUITE_DIR, '..');
  const roots = [path.join(__dirname, 'main.cjs'), path.join(SUITE_DIR, 'server'),
    path.join(repo, '1.Altagracia_Crypto_Backtester', 'Backtester', 'backend'),
    path.join(repo, '5.Order_flow', 'backend', 'local_tape.py'), path.join(repo, '5.Order_flow', 'cloud_collector'),
    path.join(repo, 'PanelOrderFlow', 'sync_nube.py')];
  let newest = newestSource();
  const walk = (p, depth) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      if (depth > 1) return;  // carpetas de primer nivel: los .py del servidor y del backend de App 1
      for (const name of fs.readdirSync(p)) {
        if (!['node_modules', '__pycache__', '.venv', 'cache', 'backtesting_cache', 'screenshots', 'drawings', 'data', 'logs'].includes(name)) walk(path.join(p, name), depth + 1);
      }
    } else if (/\.(py|cjs|js|jsx|css|html)$/.test(p) && st.mtimeMs > newest) newest = st.mtimeMs;
  };
  roots.forEach(r => walk(r, 0));
  return newest;
}
let codeAtStart = 0;

function restartApp(reason) {
  dlog(`reiniciando: ${reason}`);
  app.relaunch({ args: [path.resolve(__dirname)] });
  quitForReal();
}

function newestSource() {
  const roots = [path.join(WEB_DIR, 'src'), path.join(WEB_DIR, 'vite.config.js'), path.join(WEB_DIR, 'package.json'),
    path.join(WEB_DIR, 'index.html'), path.join(WEB_DIR, 'public'),
    path.join(SUITE_DIR, '..', '1.Altagracia_Crypto_Backtester', 'Backtester', 'frontend', 'src')];
  let newest = 0;
  const walk = (p) => {
    let st;
    try { st = fs.statSync(p); } catch { return; }
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) if (name !== 'node_modules') walk(path.join(p, name));
    } else if (st.mtimeMs > newest) newest = st.mtimeMs;
  };
  roots.forEach(walk);
  return newest;
}

// Paquetes de la pagina que cambiaron (13/11: los graficos del dashboard del journal): web/package.json es mas nuevo
// que lo que instalo npm la ultima vez (node_modules/.package-lock.json). Sin instalarlos, el armado fallaria
function packagesChanged() {
  try {
    const wanted = fs.statSync(path.join(WEB_DIR, 'package.json')).mtimeMs;
    const lock = path.join(WEB_DIR, 'node_modules', '.package-lock.json');
    const installed = fs.statSync(fs.existsSync(lock) ? lock : path.join(WEB_DIR, 'node_modules')).mtimeMs;
    return wanted > installed;
  } catch {
    return false; // sin node_modules lo instala el primer armado
  }
}

async function ensureDist() {
  const built = fs.existsSync(DIST_INDEX);
  const stale = built && newestSource() > fs.statSync(DIST_INDEX).mtimeMs;
  if (built && !stale) return true;
  if (stale) {
    if (packagesChanged()) {
      setMsg('Instalando los paquetes nuevos de la pagina (npm install en web/)...');
      if (!(await runCommand('npm install', ['install', '--no-audit', '--no-fund']))) addLog('No se pudieron instalar los paquetes nuevos.\n');
    }
    // Codigo nuevo: se vuelve a armar. Si falla, sigue la pagina anterior
    setMsg('Armando la pagina con los cambios nuevos (npm run build en web/)...');
    if (await runCommand('npm run build', ['run', 'build'])) return true;
    addLog('No se pudo armar la pagina nueva; se usa la anterior.\n');
    return true;
  }
  setMsg('Armando la pagina por primera vez (npm install y npm run build en web/)...');
  if (!fs.existsSync(path.join(WEB_DIR, 'node_modules'))) {
    if (!(await runCommand('npm install', ['install', '--no-audit', '--no-fund']))) {
      fail('No se pudo instalar la pagina. Revisa que Node.js este instalado y corre a mano: cd web && npm install && npm run build');
      return false;
    }
  }
  if (!(await runCommand('npm run build', ['run', 'build'])) || !fs.existsSync(DIST_INDEX)) {
    fail('No se pudo armar la pagina. Corre a mano: cd web && npm install && npm run build');
    return false;
  }
  addLog('\nPagina armada.\n');
  return true;
}

// ---------- servidor ----------
function launchServer() {
  const script = path.join(SUITE_DIR, 'server', 'main.py');
  if (path.isAbsolute(PYTHON) && !fs.existsSync(PYTHON)) {
    throw new Error(`No existe el Python ${PYTHON}. Ponlo en "python" de config/suite.json o en SUITE_PYTHON.`);
  }
  try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch { /* el servidor la crea */ }
  const log = fs.createWriteStream(SERVER_LOG, { flags: 'a' });
  log.write(`\n===== ${new Date().toISOString()} servidor lanzado por la app de escritorio (puerto ${PORT}) =====\n`);
  const child = spawn(PYTHON, ['-B', script], {
    cwd: SUITE_DIR,
    windowsHide: true,
    env: { ...process.env, SUITE_PORT: String(PORT), PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const onData = (d) => {
    log.write(d);
    if (!serverReady) addLog(d.toString());
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('error', (e) => log.write(`[DESKTOP] error al lanzar: ${e.message}\n`));
  child.on('exit', (code, signal) => {
    log.write(`[DESKTOP] servidor terminado (codigo ${code}, senal ${signal})\n`);
    log.end();
    if (serverChild === child) serverChild = null;
    if (!quitting && serverReady) restartServer(code);
  });
  serverChild = child;
  return child;
}

async function waitServer(child) {
  const deadline = Date.now() + START_TIMEOUT_MS;
  let exited = false;
  child.once('exit', () => { exited = true; });
  while (Date.now() < deadline) {
    if (exited) return { ok: false, why: 'exited' };
    const s = await checkStatus(5000);
    if (s.ok) return { ok: true };
    await wait(700);
  }
  return { ok: false, why: 'timeout' };
}

// Si el servidor que lanzo esta app se cae, se vuelve a lanzar (hasta 5 veces en 10 minutos)
async function restartServer(code) {
  const now = Date.now();
  while (restarts.length && now - restarts[0] > 10 * 60000) restarts.shift();
  if (restarts.length >= 5) {
    trayBalloon(`El servidor se cayo 5 veces en 10 minutos y no se relanza. Revisa ${SERVER_LOG}`);
    return;
  }
  restarts.push(now);
  trayBalloon(`El servidor se cerro (codigo ${code}); se vuelve a lanzar.`);
  await wait(3000);
  if (quitting) return;
  const s = await checkStatus(5000);
  if (s.up) return; // otro lo levanto mientras tanto
  try {
    const child = launchServer();
    const r = await waitServer(child);
    if (r.ok) { reloadAll(); trayBalloon('Servidor de nuevo en linea.'); }
    else trayBalloon(`El servidor no volvio a arrancar. Revisa ${SERVER_LOG}`);
  } catch (e) {
    trayBalloon(e.message);
  }
}

function stopServer() {
  if (serverChild && serverChild.exitCode === null) {
    try { serverChild.kill(); } catch { /* ya cerrado */ }
  }
}

async function ensureServer() {
  setMsg(`Buscando el servidor en ${BASE_ORIGIN}...`);
  const s = await checkStatus();
  if (s.ok) {
    setMsg('El servidor ya estaba corriendo: se usa sin tocarlo.');
    return true;
  }
  if (s.up) {
    fail(`El puerto ${PORT} esta ocupado por algo que no es el servidor de la suite (respuesta ${s.status}). Cierralo o cambia "port" en config/suite.json.`);
    return false;
  }
  setMsg(`Lanzando el servidor (${PYTHON} -B server\\main.py, puerto ${PORT})...`);
  let child;
  try {
    child = launchServer();
  } catch (e) {
    fail(e.message);
    return false;
  }
  const r = await waitServer(child);
  if (!r.ok) {
    stopServer();
    fail(r.why === 'exited'
      ? `El servidor se cerro al arrancar. Mira la salida arriba o ${SERVER_LOG}.`
      : `El servidor no respondio en ${START_TIMEOUT_MS / 1000} s. Mira ${SERVER_LOG}.`);
    return false;
  }
  serverReady = true;
  setMsg('Servidor listo.');
  return true;
}

// ---------- ventanas ----------
function baseWindowOptions() {
  return {
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    title: APP_NAME, icon: ICON, show: false, backgroundColor: '#ffffff',
    webPreferences: { ...WEB_PREFS },
  };
}

function createMain(visible = true) {
  mainWindow = new BrowserWindow(baseWindowOptions());
  mainWindow.once('ready-to-show', () => {
    if (visible) mainWindow.show();
    if (loadingWindow && !loadingWindow.isDestroyed()) loadingWindow.destroy();
  });
  mainWindow.loadURL(BASE_URL);
  mainWindow.on('close', (e) => {
    if (quitting) return;
    // El proceso sigue en la bandeja: el grafico, los sondeos y los avisos no se pierden
    e.preventDefault();
    mainWindow.hide();
    dlog('ventana principal oculta en la bandeja');
    if (!trayHintShown) {
      trayHintShown = true;
      trayBalloon('La suite sigue en la bandeja. "Salir" la cierra de verdad.');
    }
  });
  mainWindow.on('closed', () => {
    mainWindow = null;
    if (quitting) return;
    // Cerrada sin pasar por 'close' (window.close() desde la pagina): se vuelve a abrir oculta,
    // para que la pagina siga al dia en la bandeja
    dlog('ventana principal cerrada desde la pagina: se abre de nuevo en la bandeja');
    setTimeout(() => { if (!quitting && !mainWindow) createMain(false); }, 500);
  });
}

function newWindow(url = BASE_URL) {
  const win = new BrowserWindow(baseWindowOptions());
  win.once('ready-to-show', () => win.show());
  win.loadURL(url);
  return win;
}

// Pestanas 2 a 5 (menu "Pestanas" de la pagina): una ventana propia por numero, creada aqui. Abierta por la pagina
// con window.open compartiria el hilo de la que la abrio: medido el 13/11, 1.5 s ocupados en la 2 detuvieron 1.5 s
// la principal. Pedirla otra vez la trae al frente con el modulo pedido
const MAX_TABS = 5;
const tabWindows = new Map();

function tabOf(url) {
  try {
    const u = new URL(url, BASE_URL);
    const n = parseInt(u.searchParams.get('pestana'), 10);
    return u.origin === BASE_ORIGIN && n >= 2 && n <= MAX_TABS ? n : null;
  } catch {
    return null;
  }
}

function openTabWindow(n, url) {
  const open = tabWindows.get(n);
  if (open && !open.isDestroyed()) {
    open.loadURL(url);
    if (open.isMinimized()) open.restore();
    open.show();
    open.focus();
    return open;
  }
  const win = newWindow(url);
  tabWindows.set(n, win);
  win.on('closed', () => { if (tabWindows.get(n) === win) tabWindows.delete(n); });
  dlog(`pestana ${n} abierta`);
  return win;
}

// "Nueva ventana" abre la primera pestana libre (de la 2 a la 5) con su ultimo modulo: una segunda pestana 1
// tomaria otra vez las imagenes del journal y daria los avisos dos veces. Con todas abiertas, trae la ultima.
// Antes de que el servidor este listo solo muestra la carga
function openExtra() {
  if (!serverReady || !mainWindow) {
    showMain();
    return;
  }
  for (let n = 2; n <= MAX_TABS; n += 1) {
    const open = tabWindows.get(n);
    if (!open || open.isDestroyed()) {
      openTabWindow(n, `${BASE_URL}?pestana=${n}`);
      return;
    }
  }
  const last = tabWindows.get(MAX_TABS);
  if (last.isMinimized()) last.restore();
  last.show();
  last.focus();
}

function showMain() {
  if (!mainWindow) {
    if (serverReady || !loadingWindow) createMain();
    else loadingWindow.show();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function reloadAll() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (w !== loadingWindow && isSameOrigin(w.webContents.getURL())) w.webContents.reload();
  }
}

// Ventanas extra: una pestana de la 2 a la 5 = su ventana propia (openTabWindow); otra del mismo origen (o en
// blanco, para las que la pagina llena con un portal) = ventana Electron con las mismas preferencias, que comparte
// la pagina que la abrio; lo externo, al navegador del sistema
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    const tab = url && isSameOrigin(url) ? tabOf(url) : null;
    if (tab) {
      openTabWindow(tab, url);
      return { action: 'deny' };
    }
    if (!url || url === 'about:blank' || isSameOrigin(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1300, height: 850, icon: ICON, backgroundColor: '#ffffff',
          webPreferences: { ...WEB_PREFS },
        },
      };
    }
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  // Si el proceso de una pagina se cae, se recarga: el grafico y los sondeos vuelven solos
  contents.on('render-process-gone', (_ev, details) => {
    dlog(`pagina caida (${details.reason}, codigo ${details.exitCode}): ${contents.getURL()}`);
    if (quitting || details.reason === 'clean-exit') return;
    setTimeout(() => { if (!contents.isDestroyed()) contents.reload(); }, 1500);
  });
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith('data:') || isSameOrigin(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url).catch(() => {});
  });
});

// ---------- bandeja y menu ----------
function trayBalloon(content) {
  dlog(content);
  if (tray && process.platform === 'win32') {
    try { tray.displayBalloon({ title: APP_NAME, content, iconType: 'info' }); } catch { /* sin globo */ }
  }
}

function quitForReal() {
  quitting = true;
  app.quit();
}

function createTray() {
  let icon = nativeImage.createFromPath(ICON);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip(`${APP_NAME} (${BASE_ORIGIN})`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Mostrar', click: showMain },
    { label: 'Nueva ventana', click: () => openExtra() },
    { label: 'Reiniciar', click: () => restartApp('pedido desde la bandeja') },
    // El servidor corre sin ventana (en el navegador se ve su terminal): aqui se ve lo que escribe
    { label: 'Registro del servidor', click: () => shell.openPath(SERVER_LOG) },
    { type: 'separator' },
    { label: 'Salir', click: quitForReal },
  ]));
  tray.on('click', showMain);
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: 'Suite',
      submenu: [
        { label: 'Nueva ventana', accelerator: 'CmdOrCtrl+N', click: () => openExtra() },
        { label: 'Ocultar en la bandeja', click: () => mainWindow && mainWindow.hide() },
        { label: 'Reiniciar', click: () => restartApp('pedido desde el menu') },
        { label: 'Registro del servidor', click: () => shell.openPath(SERVER_LOG) },
        { type: 'separator' },
        { label: 'Salir', accelerator: 'CmdOrCtrl+Q', click: quitForReal },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recargar' },
        { role: 'forceReload', label: 'Recargar sin cache' },
        { role: 'toggleDevTools', label: 'Herramientas de desarrollo' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Tamano normal' },
        { role: 'zoomIn', label: 'Acercar' },
        { role: 'zoomOut', label: 'Alejar' },
        { role: 'togglefullscreen', label: 'Pantalla completa' },
      ],
    },
  ]));
}

// ---------- arranque ----------
async function start() {
  codeAtStart = newestCode();
  powerSaveBlocker.start('prevent-app-suspension');
  createMenu();
  createTray();
  openLoading();
  if (!(await ensureDist())) return;
  if (!(await ensureServer())) return;
  const status = await checkPage();
  if (status !== 200) {
    fail(serverChild
      ? `El servidor no sirve la pagina (respuesta ${status}). Revisa que exista web/dist/index.html.`
      : `El servidor que ya corria no sirve la pagina (respuesta ${status}): arranco antes de armarla. Cierralo y abre de nuevo la app.`);
    return;
  }
  serverReady = true;
  createMain();
}

// Con la ventana oculta en la bandeja la app sigue; solo "Salir" (o el sistema) la cierra
app.on('window-all-closed', () => {
  if (quitting || !tray) app.quit();
});

app.on('before-quit', () => {
  if (!quitting) dlog('saliendo');
  quitting = true;
  stopServer();
});

process.on('exit', stopServer);
