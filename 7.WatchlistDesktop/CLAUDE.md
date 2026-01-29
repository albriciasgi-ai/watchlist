# CLAUDE.md - Watchlist Desktop

Este archivo proporciona contexto a Claude Code sobre la aplicacion Watchlist Desktop.

---

## DESCRIPCION GENERAL

**Watchlist Desktop** es una aplicacion de escritorio construida con Electron + React que muestra graficos de criptomonedas en tiempo real. Es una migracion de la version web (App 2) a desktop para **eliminar los gaps en los graficos** causados por el throttling del navegador cuando la ventana esta inactiva.

### Objetivo Principal
Solucionar el problema de gaps en graficos cuando la aplicacion esta en segundo plano o minimizada.

### Stack Tecnologico
- **Frontend**: React 18 + Vite + uPlot
- **Desktop**: Electron 33
- **Backend**: FastAPI (puerto 8000) - **COMPARTIDO con App 2**
- **Data Source**: Bybit Futures API (REST + WebSocket)

---

## ARQUITECTURA

```
┌─────────────────────────────────────────────────────────────┐
│                    ELECTRON DESKTOP APP                      │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              React Frontend (Solo Display)             │  │
│  │  - Graficos con uPlot                                 │  │
│  │  - Sin calculos de indicadores                        │  │
│  │  - Anti-throttling activado                           │  │
│  └───────────────────────────────────────────────────────┘  │
│                           ↕ HTTP/WebSocket                   │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│        BACKEND COMPARTIDO (FastAPI - Puerto 8000)            │
│  Ubicacion: 2.WatchlistConIndicadores/backend/               │
│  - Conexion WebSocket con Bybit                             │
│  - Calculos de indicadores (VWAP, Swing, S/R, etc.)         │
│  - Deteccion de patrones                                    │
│  - Envio de alertas al Trading Bot (puerto 5000)            │
└─────────────────────────────────────────────────────────────┘
```

**IMPORTANTE**: Esta aplicacion NO tiene backend propio. Usa el backend de `2.WatchlistConIndicadores/`.

---

## ESTRUCTURA DE ARCHIVOS

```
7.WatchlistDesktop/
├── electron/
│   ├── main.js              # Proceso principal Electron + anti-throttling
│   └── preload.js           # Bridge seguro para IPC
│
├── src/                     # Frontend React (copiado de App 2)
│   ├── main.jsx             # Entry point React
│   ├── App.jsx              # Componente raiz
│   ├── components/
│   │   ├── Watchlist.jsx    # Lista de simbolos
│   │   ├── MiniChart.jsx    # Grafico principal con indicadores
│   │   ├── indicators/      # Indicadores tecnicos
│   │   │   ├── IndicatorManager.js
│   │   │   ├── VWAPIndicator.js
│   │   │   ├── SwingDetectorIndicator.js
│   │   │   ├── SupportResistanceIndicator.js
│   │   │   ├── CVDIndicator.js
│   │   │   └── ...
│   │   ├── drawing/         # Herramientas de dibujo
│   │   └── *Settings.jsx    # Modales de configuracion
│   ├── hooks/
│   └── utils/
│       ├── PollingScheduler.js
│       ├── StorageManager.js
│       └── IndicatorCache.js
│
├── assets/
│   └── icon.ico             # Icono de la aplicacion
│
├── index.html               # HTML principal
├── vite.config.js           # Config de Vite con proxy al backend
├── package.json             # Dependencias y scripts
│
├── 1_INSTALL.bat            # Instalar dependencias
├── 2_START_DEV.bat          # Iniciar en modo desarrollo
└── 3_BUILD.bat              # Crear ejecutable
```

---

## CONFIGURACION ANTI-THROTTLING

El archivo `electron/main.js` contiene las configuraciones criticas que eliminan el throttling:

### Flags de Chromium (antes de app.whenReady)
```javascript
// Desactivar throttling del renderer en background
app.commandLine.appendSwitch('disable-renderer-backgrounding');

// Desactivar throttling de timers en background
app.commandLine.appendSwitch('disable-background-timer-throttling');

// Desactivar throttling de ventanas ocultas
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
```

### Configuracion de BrowserWindow
```javascript
new BrowserWindow({
  webPreferences: {
    backgroundThrottling: false,  // CRITICO
    // ...
  }
});
```

### PowerSaveBlocker
```javascript
// Prevenir que el sistema entre en suspension
powerSaveBlocker.start('prevent-app-suspension');
```

---

## COMANDOS

### Desarrollo
```bash
# 1. Instalar dependencias (solo primera vez)
npm install

# 2. Iniciar backend (en otra terminal)
cd ../2.WatchlistConIndicadores/backend
python -m uvicorn main:app --port 8000

# 3. Iniciar Electron + Vite
npm run dev:electron
```

### Produccion
```bash
# Crear instalador Windows
npm run build:electron

# Crear version portable
npm run build:portable
```

### Scripts disponibles
| Script | Descripcion |
|--------|-------------|
| `npm run dev` | Solo Vite (sin Electron) |
| `npm run dev:electron` | Vite + Electron concurrente |
| `npm run build` | Build de produccion React |
| `npm run build:electron` | Build + instalador Windows |
| `npm run build:portable` | Build + ejecutable portable |
| `npm run electron` | Solo Electron (requiere Vite corriendo) |

---

## DIFERENCIAS CON APP 2 (NAVEGADOR)

| Aspecto | App 2 (Browser) | App 7 (Electron) |
|---------|-----------------|------------------|
| Throttling en background | Si (gaps en graficos) | No |
| System Tray | No | Si |
| PowerSaveBlocker | No | Si |
| Notificaciones | Browser API | Nativas OS |
| Tamano | ~0 MB | ~150 MB |
| Requiere navegador | Si | No |
| Ejecucion 24/7 | Problematico | Optimo |

---

## CONEXIONES DE RED

### Proxy en desarrollo
El archivo `vite.config.js` configura un proxy para las llamadas API:

```javascript
proxy: {
  "/api": {
    target: "http://127.0.0.1:8000",
    changeOrigin: true,
  },
}
```

### Optimizaciones de conexion
```javascript
// En electron/main.js
app.commandLine.appendSwitch('max-connections-per-host', '64');
app.commandLine.appendSwitch('max-sockets-per-group', '64');
app.commandLine.appendSwitch('ignore-connections-limit', 'localhost');
```

---

## SYSTEM TRAY

La aplicacion se minimiza al system tray en lugar de cerrarse:

- **Click derecho** en icono: Menu contextual (Abrir, Reiniciar, Cerrar)
- **Doble-click** en icono: Restaurar ventana
- La app sigue ejecutandose en segundo plano
- Notificacion al minimizar por primera vez

---

## FIXES APLICADOS (Enero 2026)

### 1. Flickering de Indicadores
**Problema**: Los indicadores (especialmente VWAP) desaparecian y reaparecian intermitentemente.

**Causa**: En `VWAPIndicator.js`, se hacia `this.dataMap.clear()` antes de poblar los nuevos datos. Si un frame de render ocurria entre el `clear()` y el `forEach`, los indicadores se veian vacios.

**Solucion**: Reemplazo atomico del Map:
```javascript
// ANTES (problematico)
this.dataMap.clear();
data.forEach(point => this.dataMap.set(point.timestamp, point));

// DESPUES (correcto)
const newMap = new Map();
data.forEach(point => newMap.set(point.timestamp, point));
this.dataMap = newMap;
```

### 2. Swing Indicators no aparecian en BTCUSDT/ETHUSDT
**Problema**: Solo mostraban 3 y 30 senales respectivamente, mientras otros simbolos tenian 300+.

**Causa**: Configuracion restrictiva en `swing_config.json`:
- BTCUSDT tenia `volumeFilter.enabled: true` con `minZScore: 2`
- BTCUSDT tenia `swingBars: 5` (vs global de 3)
- Ambos tenian `days: 1` (solo 24 velas en 60m)

**Solucion**: Ajustar `2.WatchlistConIndicadores/backend/config/swing_config.json`:
```json
"BTCUSDT": {
  "volumeFilter": { "enabled": false },
  "days": 90
},
"ETHUSDT": {
  "days": 90
}
```

### 3. Grafico no seguia el precio (sin auto-scroll)
**Problema**: El grafico se actualizaba pero no hacia scroll automatico para seguir las nuevas velas. El precio se salia de la ventana visible.

**Causa**: En `MiniChart.jsx`, cuando llegaban nuevas velas via WebSocket, el `viewStateRef.current.offset` no se reseteaba, causando que el grafico mantuviera la posicion anterior en lugar de seguir el precio.

**Solucion**: Agregar logica de auto-scroll en el handler de WebSocket:
```javascript
// En handleWebSocketMessage, cuando se confirma una nueva vela:
} else if (candleTimestamp > currentInProgress.timestamp) {
  // AUTO-SCROLL: Si el usuario estaba viendo las ultimas velas, mantenerlo asi
  const wasAtLatest = viewStateRef.current.offset <= 1;

  candlesRef.current.push(currentInProgress);
  // ...

  // AUTO-SCROLL: Resetear offset si estaba viendo las ultimas velas
  if (wasAtLatest) {
    viewStateRef.current.offset = 0;
  }
}
```

**Comportamiento**:
- Si el usuario esta viendo el precio actual (offset = 0) → el grafico sigue las nuevas velas
- Si el usuario hizo scroll hacia atras → el grafico respeta esa posicion

---

## TROUBLESHOOTING

### Backend no responde
```
Error: ECONNREFUSED localhost:8000
```
**Solucion**: Iniciar el backend primero:
```bash
cd 2.WatchlistConIndicadores/backend
python -m uvicorn main:app --port 8000
```

### Ventana no aparece
La app puede estar minimizada en el system tray. Buscar el icono en la bandeja del sistema y hacer doble-click.

### Gaps en graficos
Si aun hay gaps despues de la migracion:
1. Verificar que `backgroundThrottling: false` esta en main.js
2. Verificar que los flags de Chromium estan ANTES de `app.whenReady()`
3. Reiniciar Electron completamente

### Error "Cannot find module 'electron'"
```bash
npm install
```

### Indicadores no se muestran
1. Verificar que el backend esta corriendo
2. Abrir DevTools (Ctrl+Shift+I) y revisar consola
3. Verificar respuestas de API en Network tab

### Indicadores parpadean/desaparecen
El fix de reemplazo atomico ya fue aplicado. Si persiste:
1. Verificar que `VWAPIndicator.js` usa `const newMap = new Map()` en lugar de `this.dataMap.clear()`
2. Recargar la pagina (Ctrl+R)

### Configuracion de Swing no se aplica
El backend cachea la configuracion en memoria. Despues de editar `swing_config.json`:
1. Reiniciar el backend
2. O llamar a `/api/swing/config` via POST

### Memoria alta
1. Reducir `days` en la configuracion de indicadores
2. Deshabilitar indicadores no utilizados
3. El garbage collector de Electron deberia liberar memoria automaticamente

### Grafico no sigue el precio (se sale de la ventana)
El fix de auto-scroll ya fue aplicado. Si persiste:
1. Verificar que `MiniChart.jsx` tiene la logica `wasAtLatest` en el handler de WebSocket
2. Hacer doble-click en el eje de precios para resetear la vista
3. Usar el boton ">>|" en la barra de herramientas para ir a la ultima vela

---

## INDICADORES DISPONIBLES

Los indicadores se calculan en el **backend** y se renderizan en el frontend:

| Indicador | Archivo Frontend | Endpoint Backend |
|-----------|------------------|------------------|
| VWAP | VWAPIndicator.js | /api/vwap-service/data/{symbol} |
| Swing Detector | SwingDetectorIndicator.js | /api/swing/signals/{symbol} |
| Support/Resistance | SupportResistanceIndicator.js | /api/support-resistance/{symbol} |
| CVD | CVDIndicator.js | Calculo local con datos de velas |
| Volume Profile | VolumeProfileIndicator.js | Calculo local |

---

## DEPENDENCIAS PRINCIPALES

| Paquete | Version | Proposito |
|---------|---------|-----------|
| electron | ^33.2.0 | Framework desktop |
| react | ^18.2.0 | UI framework |
| vite | ^5.4.0 | Build tool |
| uplot | ^1.6.21 | Graficos de alto rendimiento |
| localforage | ^1.10.0 | Storage persistente |
| concurrently | ^8.2.2 | Ejecutar Vite + Electron |
| wait-on | ^7.2.0 | Esperar a que Vite inicie |

---

## RESULTADOS DE LA MIGRACION

Despues de 1+ hora de pruebas con la aplicacion en segundo plano:

- **Sin gaps en graficos** al minimizar o cambiar de ventana
- **Datos en tiempo real** continuos via WebSocket
- **System tray** funcional para ejecucion 24/7
- **PowerSaveBlocker** previene suspension del sistema

**Objetivo cumplido**: La aplicacion desktop resuelve el problema de throttling del navegador.
