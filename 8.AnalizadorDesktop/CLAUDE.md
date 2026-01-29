# CLAUDE.md - Analizador Desktop (Electron)

Guia para Claude Code al trabajar con esta aplicacion de escritorio.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en espanol con el usuario.

### Perfil
Agente programador JavaScript/TypeScript con experiencia en Electron y React.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente salvo que se pida explicitamente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas.
5. **Encoding**: Evitar tildes y caracteres especiales en codigo fuente.

### Limitaciones conocidas
- No puedo ejecutar Electron directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL

**Analizador Desktop** es la version Electron del Analizador Cripto (App 4). Resuelve el problema de throttling del navegador que causa gaps en los graficos cuando el tab esta en segundo plano.

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `8.AnalizadorDesktop/` |
| Puerto Backend | 10000 (compartido con App 4) |
| Puerto Frontend Dev | 5174 |
| Electron | 33.x |
| Stack | React 18 + Vite + Electron |

---

## POR QUE ELECTRON?

Los navegadores aplican **throttling** a tabs en segundo plano:
- `setInterval`/`setTimeout` se ejecutan cada 1000ms minimo
- `requestAnimationFrame` se pausa completamente
- WebSockets pueden desconectarse por inactividad

Esto causa **gaps en los graficos** cuando el usuario cambia de tab.

**Electron desactiva estas restricciones** mediante flags de Chromium.

---

## ESTRUCTURA DEL PROYECTO

```
8.AnalizadorDesktop/
├── electron/
│   ├── main.js              # Proceso principal Electron
│   │                        # - Flags anti-throttling
│   │                        # - System tray
│   │                        # - Power save blocker
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz
│   │   ├── MiniChart.jsx             # Grafico principal (~2500 lineas)
│   │   ├── SymbolList.jsx            # Lista lateral de monedas
│   │   ├── SymbolSelector.jsx        # Selector de simbolo
│   │   ├── trading/
│   │   │   ├── TradingPanel.jsx      # Panel de trading
│   │   │   ├── OrderForm.jsx         # Formulario de orden
│   │   │   └── PositionCard.jsx      # Card de posicion
│   │   ├── indicators/
│   │   │   ├── IndicatorManager.js   # Orquestador (~1200 lineas)
│   │   │   ├── SwingDetectorIndicator.js
│   │   │   ├── VWAPIndicator.js
│   │   │   └── ... (13 indicadores)
│   │   ├── drawing/
│   │   │   ├── DrawingToolManager.js
│   │   │   ├── DrawingToolbar.jsx
│   │   │   └── shapes/*.js
│   │   ├── SlidingAlertPanel/
│   │   ├── ProximityAlerts/
│   │   └── *Settings.jsx             # Modales de configuracion
│   ├── utils/
│   │   ├── CandleCache.js            # Cache IndexedDB con validacion
│   │   ├── IndicatorCache.js
│   │   ├── Logger.js
│   │   └── PresetManager.js
│   ├── hooks/
│   │   └── useGlobalAlerts.js
│   ├── config.js                     # API_BASE_URL
│   ├── main.jsx                      # Entry point React
│   └── styles.css
│
├── assets/
│   └── icon.ico                      # Icono de la aplicacion
│
├── package.json                      # Scripts y config electron-builder
├── vite.config.js                    # Puerto 5174, proxy a backend
├── start_fast.bat                    # Inicio rapido
└── CLAUDE.md                         # Este archivo
```

---

## COMANDOS DE INICIO

### Desarrollo (recomendado)
```bash
npm run dev:electron
```
Inicia Vite en puerto 5174 + Electron apuntando a ese servidor.
Hot reload funciona para cambios en React.

### Produccion local
```bash
npm run start
```
Build de Vite + ejecuta Electron desde `dist/`.

### Build instalador
```bash
npm run build:electron      # Instalador .exe (NSIS)
npm run build:portable      # Portable sin instalacion
```
Output en `dist-electron/`.

---

## CONFIGURACION ANTI-THROTTLING

### electron/main.js

```javascript
// CRITICO: Debe ir ANTES de app.whenReady()

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
  backgroundThrottling: false,  // CRITICO
  contextIsolation: true,
  nodeIntegration: false,
  preload: path.join(__dirname, 'preload.js'),
}
```

### Optimizaciones GPU

```javascript
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('ignore-gpu-blocklist');
```

---

## SYSTEM TRAY

La aplicacion se minimiza al tray en lugar de cerrarse:

```javascript
mainWindow.on('close', (event) => {
  if (!app.isQuitting) {
    event.preventDefault();
    mainWindow.hide();
    // Notificacion la primera vez
  }
});
```

Menu del tray:
- **Abrir Analizador**: Muestra la ventana
- **Reiniciar**: `app.relaunch() + app.quit()`
- **Cerrar**: Cierra completamente

---

## POWER SAVE BLOCKER

Previene que el sistema entre en suspension:

```javascript
const powerSaveBlockerId = powerSaveBlocker.start('prevent-app-suspension');
```

Se detiene automaticamente al cerrar la app.

---

## ARQUITECTURA RENDERER

### SingleSymbolAnalyzer.jsx

Componente raiz que maneja:
- Estado del simbolo actual
- Estado del timeframe (interval)
- Estado de dias historicos
- Estados de indicadores (toggle on/off)
- Modales de configuracion

**IMPORTANTE:** El setter de interval se llama `setIntervalState` (NO `setInterval`) para evitar conflicto con la funcion nativa de JavaScript.

```javascript
// CORRECTO
const [interval, setIntervalState] = useState("60");

// INCORRECTO - causa el bug "[object Promise]"
const [interval, setInterval] = useState("60");
```

### MiniChart.jsx

Componente mas grande (~2500 lineas). Responsabilidades:
- Renderizado del chart con canvas
- Carga de datos historicos (con cache)
- WebSocket para datos en tiempo real
- Sistema de zoom (horizontal y vertical)
- Sistema de dibujo (lineas, rectangulos, TPSL boxes)
- Integracion con IndicatorManager

**Refs importantes:**
- `candlesRef`: Datos de velas actuales
- `viewStateRef`: Estado de zoom y offset
- `drawingsRef`: Dibujos cargados del servidor
- `indicatorManagerRef`: Instancia del IndicatorManager

### Sistema de Zoom

```javascript
viewStateRef = {
  offset: 0,           // Desplazamiento horizontal
  zoom: 1,             // Factor de zoom (0.1 - 5)
  verticalOffset: 0,   // Desplazamiento vertical
  verticalZoom: 1,     // Zoom vertical
  userZoomed: false,   // True si el usuario hizo zoom manual
  zoomAutoFixed: false // True si el zoom fue auto-calculado
}
```

**Auto-correccion de zoom:**
```javascript
// Si mostramos menos del 20% de las velas disponibles, corregir
const showingTooFew = (displayCandles.length > 200 && preliminaryCandlesPerScreen < 200) ||
                      (displayCandles.length > 0 && preliminaryCandlesPerScreen < displayCandles.length * 0.2);

if (showingTooFew && !viewStateRef.current.userZoomed) {
  const targetCandles = Math.min(displayCandles.length * 0.6, 800);
  viewStateRef.current.zoom = chartWidth / (targetCandles * 8);
}
```

---

## CACHE DE VELAS (CandleCache.js)

Sistema de cache en IndexedDB para carga incremental:

```javascript
// Obtener velas (con validacion)
const cached = await CandleCache.getValidated(symbol, interval, days);

// Guardar velas
await CandleCache.set(symbol, interval, candles);

// Limpiar cache de un simbolo
await CandleCache.clear(symbol, interval);

// Limpiar todo el cache
await CandleCache.clearAll();
```

**Validacion automatica:**
Si el cache tiene menos del 10% de las velas esperadas, se limpia automaticamente.

---

## ATAJOS DE TECLADO

| Atajo | Accion |
|-------|--------|
| F12 | Abrir/cerrar DevTools |
| Ctrl+Shift+R | Forzar recarga (limpiar cache, resetear zoom) |
| Alt+T | Abrir/cerrar Trading Panel |
| ESC | Cerrar modo dibujo o cancelar operacion |
| Delete | Eliminar shape seleccionado |
| Ctrl+Z | Deshacer (en modo dibujo) |
| Ctrl+Y | Rehacer (en modo dibujo) |
| Flechas | Navegar lista de simbolos |

---

## DIFERENCIAS CON APP 4 (Browser)

| Caracteristica | App 4 (Browser) | App 8 (Electron) |
|----------------|-----------------|------------------|
| Throttling | Si (gaps) | No (sin gaps) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Instalable | No | Si (.exe) |
| Puerto frontend | 10001 | 5174 (dev) |
| DevTools | F12 browser | F12 manual |
| Recarga forzada | No | Ctrl+Shift+R |

---

## PROBLEMAS CONOCIDOS Y SOLUCIONES

### 1. Bug de 95 velas (RESUELTO)

**Sintoma:** Solo se muestran 95 velas en lugar de 1440+

**Causa:** Conflicto de nombres `setInterval` con la funcion nativa de JavaScript.

**Solucion:** Renombrar a `setIntervalState` en SingleSymbolAnalyzer.jsx.

### 2. Config corrupta "[object Promise]" (RESUELTO)

**Sintoma:** `swing_config.json` tiene `"interval": "[object Promise]"`

**Causa:** El bug de `setInterval` causaba que se guardara el string del Promise.

**Solucion:**
1. Backend valida valores de interval al cargar y guardar config
2. Valores invalidos se rechazan o corrigen automaticamente

### 3. Zoom no se ajusta (RESUELTO)

**Sintoma:** Chart muestra pocas velas aunque hay muchas disponibles.

**Solucion:** Auto-correccion agresiva del zoom cuando `preliminaryCandlesPerScreen < displayCandles * 0.2`.

### 4. Cache corrupto (RESUELTO)

**Sintoma:** IndexedDB tiene pocas velas, carga incremental no funciona.

**Solucion:** `CandleCache.getValidated()` limpia automaticamente cache con menos del 10% de velas esperadas.

---

## TROUBLESHOOTING

### Graficos con gaps
1. Verificar que Electron esta corriendo (no el browser)
2. Verificar flags anti-throttling en `electron/main.js`
3. Verificar PowerSaveBlocker esta activo (log en consola)

### Solo 95 velas
1. Presionar **Ctrl+Shift+R** para forzar recarga
2. Verificar consola por logs de zoom
3. Verificar que `swing_config.json` tiene interval valido ("1", "5", "60", etc)

### Backend no conecta
1. Verificar que backend corre en puerto 10000
2. Verificar proxy en `vite.config.js` (solo modo dev)
3. En produccion, verificar `API_BASE_URL` en `config.js`

### Icono no aparece en tray
1. Verificar que existe `assets/icon.ico`
2. Formato debe ser .ico (no .png)

### DevTools no abre
1. Presionar F12 (atajo configurado en main.js)
2. O usar menu de Electron: View -> Toggle Developer Tools

---

## ARCHIVOS CRITICOS

Archivos que NO deben modificarse sin cuidado:

1. **electron/main.js** - Flags anti-throttling, tray, power blocker
2. **SingleSymbolAnalyzer.jsx** - NO renombrar `interval` ni `setIntervalState`
3. **MiniChart.jsx** - Logica de zoom y cache
4. **config.js** - URL del backend
5. **vite.config.js** - Proxy y puerto de desarrollo

---

## FLUJO DE DATOS

```
┌─────────────────────────────────────────────────────────────────────┐
│                        ANALIZADOR DESKTOP                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌──────────────┐                                                   │
│  │   ELECTRON   │                                                   │
│  │   main.js    │ ─── Anti-throttling flags                         │
│  │              │ ─── Power save blocker                            │
│  │              │ ─── System tray                                   │
│  └──────┬───────┘                                                   │
│         │                                                           │
│         ▼                                                           │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    RENDERER (React)                           │  │
│  │                                                               │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │              SingleSymbolAnalyzer.jsx                    │ │  │
│  │  │  - Estado: symbol, interval, days, indicatorStates      │ │  │
│  │  │  - Modales de configuracion                              │ │  │
│  │  └────────────────────┬────────────────────────────────────┘ │  │
│  │                       │                                       │  │
│  │                       ▼                                       │  │
│  │  ┌─────────────────────────────────────────────────────────┐ │  │
│  │  │                   MiniChart.jsx                          │ │  │
│  │  │  - Canvas rendering                                      │ │  │
│  │  │  - WebSocket para precio en tiempo real                  │ │  │
│  │  │  - Sistema de zoom                                       │ │  │
│  │  │  - Sistema de dibujo                                     │ │  │
│  │  └────────────────────┬────────────────────────────────────┘ │  │
│  │                       │                                       │  │
│  │         ┌─────────────┼─────────────┐                        │  │
│  │         ▼             ▼             ▼                        │  │
│  │  ┌───────────┐ ┌───────────┐ ┌───────────┐                  │  │
│  │  │CandleCache│ │Indicator  │ │ Drawing   │                  │  │
│  │  │ IndexedDB │ │ Manager   │ │ Manager   │                  │  │
│  │  └───────────┘ └───────────┘ └───────────┘                  │  │
│  │                                                               │  │
│  └───────────────────────────────────────────────────────────────┘  │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    BACKEND (Puerto 10000)                            │
│                    (Compartido con App 4)                            │
│  - Datos historicos: /api/historical/{symbol}                       │
│  - Swing Detector: /api/swing/*                                      │
│  - VWAP Service: /api/vwap-service/*                                │
│  - Dibujos: /api/drawings/{symbol}                                   │
│  - WebSocket: wss://stream.bybit.com                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## HISTORIAL DE CAMBIOS

### Enero 2026 - Creacion inicial

1. **Migracion desde App 4**: Copiado codigo base del Analizador Cripto
2. **Configuracion Electron**: main.js con anti-throttling y optimizaciones
3. **Bug 95 velas**: Corregido conflicto `setInterval` -> `setIntervalState`
4. **Validacion backend**: Agregada validacion de interval en swing_service.py
5. **Auto-zoom**: Implementada correccion automatica de zoom
6. **Force reload**: Atajo Ctrl+Shift+R para limpiar cache y resetear

---

## RELACION CON OTRAS APPS

```
8.AnalizadorDesktop
    │
    ├── Comparte backend con: 4.Analizador cripto (puerto 10000)
    │   - swing_service.py
    │   - vwap_service.py
    │   - Dibujos en backend/drawings/
    │
    ├── Comparte codigo frontend con: 4.Analizador cripto
    │   - Todos los indicadores (indicators/)
    │   - Sistema de dibujos (drawing/)
    │   - Componentes de settings (*Settings.jsx)
    │
    └── Se conecta a: 3.TradingBot_Python (puerto 5000)
        - Via Trading Panel
        - POST /api/trade/manual
```

---

## CHECKLIST DE DESARROLLO

Al modificar componentes React:
- [ ] Verificar que NO se usa `setInterval` como nombre de setter
- [ ] Verificar que zoom se resetea correctamente al cambiar simbolo
- [ ] Probar en modo desarrollo Y produccion
- [ ] Verificar que no hay memory leaks en indicadores

Al modificar Electron:
- [ ] Mantener flags anti-throttling ANTES de app.whenReady()
- [ ] No desactivar backgroundThrottling: false
- [ ] Probar minimizar a tray
- [ ] Probar power save blocker

Al agregar nuevas funcionalidades:
- [ ] Evitar tildes en strings (usar ASCII)
- [ ] Importar API_BASE_URL desde config.js
- [ ] Agregar logs de diagnostico donde sea util
- [ ] Probar en diferentes timeframes (1m, 1h, 1D)
