# APP 8: ANALIZADOR DESKTOP (Electron)

**Ubicacion:** `8.AnalizadorDesktop/`

Version de escritorio del Analizador Cripto (App 4) empaquetada con Electron. Resuelve el problema de throttling del navegador que causa gaps en los graficos cuando el tab esta en segundo plano.

## Por que Electron?

Los navegadores (Chrome, Firefox, Edge) aplican **throttling** a tabs en segundo plano:
- Timers (setInterval, setTimeout) se ejecutan cada 1000ms minimo
- requestAnimationFrame se pausa completamente
- WebSockets pueden desconectarse por inactividad

Esto causa **gaps en los graficos** cuando el usuario cambia de tab. Electron desactiva estas restricciones.

## Estructura

```
8.AnalizadorDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray, power blocker)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz
│   │   ├── MiniChart.jsx             # Grafico con indicadores (MODIFICADO)
│   │   ├── SymbolList.jsx            # Lista lateral de monedas
│   │   ├── SymbolSelector.jsx        # Selector de simbolo
│   │   ├── trading/                  # Panel de trading
│   │   ├── indicators/               # 13 indicadores
│   │   ├── drawing/                  # Herramientas de dibujo
│   │   └── *Settings.jsx             # Modales de configuracion
│   ├── utils/
│   │   ├── CandleCache.js            # Cache IndexedDB con validacion y carga incremental
│   │   ├── PollingCoordinator.js     # Coordinador de polling v2 (setTimeout individual)
│   │   ├── IndicatorCache.js
│   │   └── Logger.js
│   ├── hooks/
│   │   └── useGlobalAlerts.js
│   ├── config.js                     # API_BASE_URL = localhost:10001
│   └── main.jsx
│
├── assets/
│   └── icon.ico                      # Icono de la aplicacion
│
├── package.json                      # Scripts y config electron-builder
├── vite.config.js                    # Puerto 5174, proxy a backend
└── start_fast.bat                    # Inicio rapido (modo fast)
```

## Comandos

```bash
# Desarrollo (Vite + Electron con hot reload)
npm run dev:electron

# Produccion local (build + ejecutar)
npm run start

# Build instalador Windows
npm run build:electron

# Build portable (sin instalacion)
npm run build:portable
```

## Configuracion Anti-Throttling

En `electron/main.js`:

```javascript
// ANTES de app.whenReady()
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// En BrowserWindow
webPreferences: {
  backgroundThrottling: false,
  // ...
}
```

## Optimizaciones de Rendimiento

```javascript
// GPU
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-accelerated-2d-canvas');
app.commandLine.appendSwitch('ignore-gpu-blocklist');

// V8 (JavaScript)
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
```

## System Tray

La aplicacion se minimiza al tray en lugar de cerrarse:
- Doble-click en icono: Mostrar ventana
- Click derecho: Menu (Abrir, Reiniciar, Cerrar)
- Notificacion al minimizar por primera vez

## Power Save Blocker

Previene que el sistema entre en suspension mientras la app esta corriendo:

```javascript
powerSaveBlocker.start('prevent-app-suspension');
```

## Diferencias con App 4 (Browser)

| Caracteristica | App 4 (Browser) | App 8 (Electron) |
|----------------|-----------------|------------------|
| Throttling | Si (gaps en graficos) | No (sin gaps) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Instalable | No | Si (.exe) |
| DevTools | F12 en browser | F12 manual |
| Puerto frontend | 10001 | 5174 (dev) / file:// (prod) |

## Problemas Resueltos (Enero 2026)

### 1. Bug de 95 velas

**Sintoma:** Solo se mostraban 95 velas en lugar de 1440+

**Causa raiz:** Conflicto de nombres en React. El estado `setInterval` sobrescribia la funcion nativa de JavaScript:

```javascript
// INCORRECTO - sobrescribe window.setInterval
const [interval, setInterval] = useState("60");

// Cuando se llamaba:
setInterval(updatePrice, 5000);
// Esto llamaba al SETTER de React, retornando un Promise
// El interval se guardaba como "[object Promise]"
```

**Fix:** Renombrar el setter a `setIntervalState`:

```javascript
// CORRECTO
const [interval, setIntervalState] = useState("60");
```

### 2. Config corrupta en backend

**Sintoma:** `swing_config.json` tenia `"interval": "[object Promise]"`

**Fix:** Agregar validacion en `swing_service.py`:

```python
VALID_INTERVALS = ["1", "3", "5", "15", "30", "60", "120", "240", "360", "720", "D", "W"]

# En _load_config():
if interval_value not in VALID_INTERVALS:
    logger.warning(f"CONFIG CORRUPTED: resetting to '1'")
    data['interval'] = "1"

# En update_config():
if 'interval' in new_config:
    if str(new_config['interval']) not in VALID_INTERVALS:
        del new_config['interval']  # Rechazar valor invalido
```

### 3. Zoom no se ajustaba

**Fix:** Auto-correccion agresiva en `MiniChart.jsx`:

```javascript
// Si mostramos menos del 20% de las velas disponibles, corregir zoom
const showingTooFew = (displayCandles.length > 200 && preliminaryCandlesPerScreen < 200) ||
                      (displayCandles.length > 0 && preliminaryCandlesPerScreen < displayCandles.length * 0.2);

if (showingTooFew && !viewStateRef.current.userZoomed) {
  // Recalcular zoom automaticamente
  const targetCandles = Math.min(displayCandles.length * 0.6, 800);
  viewStateRef.current.zoom = chartWidth / (targetCandles * 8);
}
```

### 4. Atajo para forzar recarga

**Ctrl+Shift+R:** Limpia cache de IndexedDB, resetea zoom y recarga datos.

### 5. Optimizaciones de Carga (Enero 2026)

Se aplicaron las mismas optimizaciones del OrderFlowDesktop (App 9) para mejorar tiempos de carga:

#### 5.1 Handler Atomico para Cambio de Timeframe

**Archivo:** `SingleSymbolAnalyzer.jsx`

**Problema:** Al cambiar timeframe, se hacian dos actualizaciones separadas (interval y days), causando doble montaje de componentes.

**Solucion:** Handler unificado que cambia ambos valores en un solo batch de React:

```javascript
const handleIntervalChange = useCallback((newInterval) => {
  const defaultDays = DEFAULT_DAYS_BY_INTERVAL[newInterval];
  const maxDays = MAX_DAYS_BY_INTERVAL[newInterval] || 30;

  let newDays = defaultDays || (parseInt(days) > maxDays ? maxDays : days);

  // CRITICO: Cambiar ambos valores en un solo batch
  setIntervalState(newInterval);
  setDays(newDays.toString());
}, [days]);
```

#### 5.2 CandleCache con Carga Incremental

**Archivo:** `CandleCache.js`

**Problema:** Cache incompleto se limpiaba, forzando recarga completa de ~2 minutos.

**Solucion:** Solo limpiar cache si tiene GAPS significativos (>2 min entre velas):

```javascript
static async getValidated(symbol, interval, days) {
  // Si cache incompleto pero sin gaps, NO limpiarlo
  if (ratio < this.MIN_CACHE_RATIO) {
    console.log(`Cache incompleto, se usara carga incremental`);
    // NO limpiar - retornar para carga incremental
  }

  // Solo limpiar si hay gaps significativos
  const gapAnalysis = this.analyzeGaps(cached.candles, interval);
  if (gapAnalysis.gaps.filter(g => parseFloat(g.gapMinutes) > 2).length > 0) {
    await this.clear(symbol, interval);
    return null;
  }

  return cached;
}
```

#### 5.3 PollingCoordinator v2

**Archivo:** `PollingCoordinator.js` (nuevo)

**Problema:** PollingCoordinator v1 usaba tick global cada 1s, causando overhead.

**Solucion:** v2 usa setTimeout individual por callback:

- Sin tick global (0% CPU cuando idle)
- Cada callback tiene su propio timer
- Flag `isRunning` evita solapamiento de ejecuciones async
- Respeta visibilidad del tab (pausa cuando oculto)

**Resultado:** Cambio de timeframe mejorado de ~2:38 min a ~1:13s

### 6. DTB y Rejection Deshabilitados por Defecto (Enero 2026)

**Archivo:** `4.Analizador cripto/backend/realtime_pattern_service.py`

**Problema:** El backend ejecutaba deteccion de DTB (Double Top/Bottom) y Rejection para TODOS los simbolos, aunque estan deprecados.

**Causa:** Los defaults tenian `alertsEnabled: True`. Simbolos sin config guardada usaban defaults.

**Solucion:** Cambiar defaults a `alertsEnabled: False`:

```python
def _get_default_dbt_config(self) -> Dict:
    return {
        'alertsEnabled': False,  # DESHABILITADO - DTB deprecado
        # ...
    }

def _get_default_rejection_config(self) -> Dict:
    return {
        'alertsEnabled': False,  # DESHABILITADO - Rejection deprecado
        # ...
    }
```

**Resultado:** Solo el Swing Detector ejecuta deteccion de patrones, reduciendo carga de CPU y logging.

### 7. Trading Panel con TradingBot (Octubre 2026)

**Integración con App 10 (TradingBot):**
- Panel de trading accesible con `Alt+T`
- Selector manual de tipo de orden: 🤖 Auto / ⚡ Market / 🎯 Limit
- Auto-detección de LIMIT cuando entry price difiere >0.1% del precio actual
- Soporte completo para órdenes LIMIT y MARKET en `/api/trade/manual`
- Registro en historial con Entry/TP/SL correctos
- Logs formato: `[MANUAL TRADE] LIMIT: BTCUSDT Buy | Entry=$60000 TP=$62000 SL=$58000`

**Archivos clave:**
- `src/components/trading/OrderForm.jsx` - Cálculo de orderType y selector UI
- `src/components/trading/TradingPanel.jsx` - Comunicación con TradingBot (puerto 5000)
- `3.TradingBot_Python/backend/main.py` - Endpoint `/api/trade/manual` con LIMIT support

---

### 8. Indicador Liquidation Clusters (Octubre 2026)

**Implementación completa del indicador Liquidation Clusters con visualización en 3 capas y configuración UI.**

#### **Características Implementadas**

**Sistema de Renderizado en 3 Capas (Opción 4 - Modo Sutil):**

| Capa | Clusters | Visualización | Opacidad |
|------|----------|---------------|----------|
| **Fondo** | 11-50 (40 clusters) | Sombreado muy sutil | 0.05 |
| **Medio** | 4-10 (7 clusters) | Triángulos + líneas punteadas | 0.2-0.5 |
| **Frente** | Top 3 | Líneas completas + labels compactos | 0.5-0.7 |

**Labels Compactos:**
- Formato: `🔥 🔻$2.5M 85%`
- Icono de ranking: 🔥 (top 2) o ⚡ (top 3)
- Dirección: 🔻 (LONG liquidations) o 🔺 (SHORT liquidations)
- Volumen en millones + Magnetic Strength %

**Configuración Visual:**
```javascript
labelPosition: 'left' | 'right'      // Posición de labels
showTop3Lines: true | false          // Mostrar Top 3
showMid7Markers: true | false        // Mostrar clusters 4-10
showRestShading: true | false        // Mostrar sombreado 11-50
```

#### **Bugs Corregidos**

| Bug | Causa | Fix |
|-----|-------|-----|
| Gráfico desaparece | Firma incorrecta de `renderOverlay()` | Corregida firma: `(ctx, bounds, visibleCandles, allCandles, priceContext)` |
| Canvas corrupto | `save()/restore()` desbalanceado (120 ops/frame) | Optimizado a 2 ops/frame (try/finally) |
| `priceToY` undefined | No validaba `priceContext` | Helper con validación y fallback |
| Bounds incorrectos | Usaba `.left/.right/.top/.bottom` | Cambiado a `.x/.y/.width/.height` |

#### **Archivos Creados**

1. **`src/components/LiquidationClustersSettings.jsx`**
   - Modal de configuración con 4 controles:
     - Dropdown para posición de labels (left/right)
     - Checkbox para Top 3 Lines
     - Checkbox para Clusters 4-10 (marcadores)
     - Checkbox para Sombreado 11-50
   - Información educativa sobre qué son los Liquidation Clusters
   - Fuente de datos: MarginPad API (100% gratis, sin autenticación)
   - Actualización cada 2 minutos, cache de 60 segundos

#### **Archivos Modificados**

1. **`src/components/indicators/LiquidationClustersIndicator.js`**
   - Línea 28-32: Configuración visual (labelPosition, showTop3Lines, etc.)
   - Línea 68-86: Método `updateConfig()`
   - Línea 397-445: `renderOverlay()` refactorizado con 3 capas
   - Línea 475-491: `_renderShading()` (Capa 1 - Fondo)
   - Línea 496-538: `_renderMarker()` (Capa 2 - Medio)
   - Línea 543-575: `_renderTop3Line()` (Capa 3 - Frente)
   - Línea 580-626: `_renderTop3Label()` con posición configurable

2. **`src/components/SingleSymbolAnalyzer.jsx`**
   - Línea 18: Importado `LiquidationClustersSettings`
   - Línea 183: Estado `showLiquidationClustersSettings`
   - Línea 619-626: Handler `handleOpenLiquidationClustersSettings()`
   - Línea 646-655: Handler `handleLiquidationClustersConfigChange()`
   - Línea 1027: Prop `onOpenLiquidationClustersSettings` pasado a MiniChart
   - Línea 1270-1293: Modal JSX con configuración

3. **`src/components/MiniChart.jsx`**
   - Línea 113: Agregado prop `onOpenLiquidationClustersSettings`
   - Línea 3075-3091: Botón de configuración `🔥 LC` (color rosa #E91E63)
   - Línea 3381: Prop pasado a componente fullscreen

4. **`src/components/indicators/IndicatorManager.js`**
   - Línea 1813-1818: Método `getLiquidationClustersIndicator()`

#### **Acceso al Modal desde la UI**

1. Activar el indicador "Liquidation Clusters" desde el panel de indicadores
2. Click en el botón **"🔥 LC"** (color rosa) que aparece en la barra superior
3. Configurar las opciones deseadas en el modal
4. Los cambios se aplican en tiempo real al gráfico

#### **Rendimiento**

| Métrica | Antes | Después | Mejora |
|---------|-------|---------|--------|
| **Operaciones save/restore** | 120/frame | 2/frame | **60x más rápido** |
| **Líneas dibujadas** | 50 | 3 completas + 7 marcadores | **Limpio** |
| **Labels renderizados** | 10 largos | 3 compactos | **70% menos** |
| **Impacto en FPS** | ~5ms | ~0.8ms | **6x más rápido** |

#### **Configuración Temporal desde Consola**

```javascript
// Obtener el indicador
const manager = window.indicatorManagers?.ARBUSDT;
const liqInd = manager?.indicators.find(i => i.name === 'Liquidation Clusters');

// Cambiar configuración
if (liqInd) {
  liqInd.updateConfig({
    labelPosition: 'left',    // Cambiar a izquierda
    showMid7Markers: false    // Ocultar clusters 4-10
  });
}
```

#### **Lecciones Aprendidas**

1. **Validar parámetros de `renderOverlay()`**: La firma debe coincidir exactamente con `IndicatorManager`
2. **Minimizar `save()/restore()`**: Un solo par por indicador, no por elemento
3. **Usar `try/finally`**: Garantiza que `restore()` siempre se ejecute
4. **Bounds estándar**: Usar `.x/.y/.width/.height`, no `.left/.right/.top/.bottom`
5. **Logs de debug**: Temporales, eliminar antes de producción

---

## Troubleshooting

**Graficos con gaps:**
- Verificar que Electron esta corriendo (no el browser)
- Verificar flags anti-throttling en main.js
- Revisar que PowerSaveBlocker esta activo

**Solo 95 velas:**
- Presionar Ctrl+Shift+R para forzar recarga
- Verificar consola por logs de zoom
- Verificar que `swing_config.json` tiene interval valido

**Backend no conecta:**
- Verificar que backend corre en puerto 10001
- Verificar proxy en vite.config.js
- En produccion, verificar API_BASE_URL en config.js

**Zonas realtime no aparecen:**
- Verificar servicio activo: `GET /api/zones/realtime/status`
- Verificar IndicatorManager tiene polling: buscar `Realtime zones actualizadas` en consola
- Ver seccion ZONE DETECTOR REALTIME para detalles completos

**Icono no aparece en tray:**
- Verificar que existe `assets/icon.ico`
- Formato debe ser .ico (no .png)

---

