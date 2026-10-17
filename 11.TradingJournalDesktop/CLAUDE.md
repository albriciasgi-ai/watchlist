# APP 11: TRADING JOURNAL DESKTOP (Electron)

**Ubicacion:** `11.TradingJournalDesktop/`

Version de escritorio del Trading Journal (App 6) empaquetada con Electron. Resuelve el problema de throttling que pausaba el monitor de posiciones.

## Estructura

```
11.TradingJournalDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray, power blocker)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── Dashboard.jsx           # Metricas, equity curve, win rate
│   │   ├── TradeList.jsx           # Lista filtrable de trades
│   │   ├── TradeDetail.jsx         # Detalle con screenshots y reflexion
│   │   └── Settings.jsx            # Control del monitor, export/import
│   ├── styles/
│   │   └── App.css                 # Estilos de la app
│   ├── utils/
│   │   └── robustness.js           # Validacion, health checks, formatters
│   ├── config.js                   # API_BASE_URL = localhost:12000
│   ├── App.jsx                     # Componente raiz con navegacion
│   └── main.jsx
│
├── assets/
│   └── README.txt                  # Instrucciones para icon.ico
│
├── package.json                    # Scripts y config electron-builder
├── vite.config.js                  # Puerto 12002, proxy a backend
├── 1.START_ALL.bat                 # Inicio coordinado backend + Electron
├── 1_START.bat                     # Inicio con verificacion de backend
└── start_fast.bat                  # Inicio rapido
```

## Puertos

| Servicio | Puerto |
|----------|--------|
| Backend (Trading Journal) | 12000 |
| Frontend Electron (dev) | 12002 |

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

### Dashboard
- Metricas: Total P&L, Win Rate, Profit Factor, Max Drawdown
- Curva de equity visualizada
- Gauge de win rate
- Trades recientes

### Trade List
- Tabla filtrable por estado, simbolo, direccion, fuente
- Ordenamiento por columnas
- Badges de estado (OPEN, WIN, LOSS)

### Trade Detail
- P&L en USD, %, R-Multiple
- Screenshots de entrada y salida
- Reflexion editable con emociones y notas

### Settings
- Control del monitor (start/stop)
- Estado de conexiones
- Export/Import de datos

## Monitor de Posiciones

El backend hace polling al TradingBot cada 5 segundos:
1. Detecta nuevas posiciones → Crea JournalEntry + Screenshot
2. Detecta posiciones cerradas → Actualiza con exit_price, PnL + Screenshot
3. Match con alertas recientes para determinar source

## Diferencias con App 6 (Browser)

| Caracteristica | App 6 (Browser) | App 11 (Electron) |
|----------------|-----------------|-------------------|
| Throttling | Si (monitor se pausa) | No (monitor continuo) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Puerto frontend | 12001 | 12002 (dev) |

## Dependencias

- **Backend:** Usa el mismo backend de App 6 en puerto 12000
- **TradingBot:** Requiere TradingBot corriendo en puerto 5000 para el monitor
- **Screenshots:** Backend usa Playwright/mplfinance

---

# ZONE DETECTOR (Analizador Desktop - Febrero 2026)

Sistema de deteccion de zonas de consolidacion con simulacion de trading integrada.

## Cambio de Puerto (Febrero 2026)

**IMPORTANTE:** El puerto del backend del Analizador cripto/AnalizadorDesktop cambio de 10000 a **10001** debido a procesos zombie que bloqueaban el puerto 10000.

### Archivos Actualizados

| Archivo | Cambio |
|---------|--------|
| `8.AnalizadorDesktop/src/config.js` | `API_BASE_URL = "http://localhost:10001"` |
| `4.Analizador cripto/backend/main.py` | Fix: `get_historical_data` -> `get_historical` en endpoint zones |

### Comando de Inicio

```bash
# Backend (puerto 10001)
cd "4.Analizador cripto/backend"
.venv\Scripts\python.exe -m uvicorn main:app --port 10001 --host 127.0.0.1

# Frontend Electron
cd 8.AnalizadorDesktop
npm run dev:electron
```

## Endpoint de Deteccion de Zonas

### POST `/api/zones/detect`

Detecta zonas de consolidacion y simula trades con TP=2R y SL=1R.

**Request:**
```json
{
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 30,
  "consol_min_bars": 8,
  "consol_max_bars": 50,
  "consol_max_range_pct": 2.0,
  "consol_atr_ratio": 0.6,
  "consol_body_ratio": 0.5,
  "consol_max_outside_bars": 3,
  "lookforward_bars": 100,
  "max_price_range_pct": 5.0,
  "generate_csv": true
}
```

**Response:**
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 30,
  "candles_count": 720,
  "zones": [
    {
      "id": "zone_1234567890_0",
      "start_timestamp": 1706745600000,
      "end_timestamp": 1706832000000,
      "min_price": 42000.0,
      "max_price": 42500.0,
      "price_range_pct": 1.19,
      "candles_in_zone": 12,
      "duration_hours": 24.0,
      "breakout_direction": "UP",
      "breakout_price": 42550.0,
      "breakout_timestamp": 1706835600000,
      "trade_result": "WIN",
      "trade_pnl_r": 2.0,
      "r_multiple": 2.0,
      "reached_2r": true,
      "reached_3r": false,
      "bars_to_close": 15,
      "trading_score": 75
    }
  ],
  "stats": {
    "total_zones": 5,
    "wins": 3,
    "losses": 2,
    "open": 0,
    "win_rate": 60.0,
    "total_pnl_r": 4.0
  },
  "csv_path": "zones_csv/BTCUSDT_60_zones_20260203_001500.csv"
}
```

## Componentes Frontend

### ZoneDetectorSettings.jsx

Modal para configurar parametros de deteccion:

| Parametro | Default | Descripcion |
|-----------|---------|-------------|
| `consol_min_bars` | 8 | Minimo de velas en la zona |
| `consol_max_bars` | 50 | Maximo de velas en la zona |
| `consol_max_range_pct` | 2.0 | Maximo % de rango de precio |
| `consol_atr_ratio` | 0.6 | Ratio ATR para validar consolidacion |
| `consol_body_ratio` | 0.5 | Ratio de cuerpo de velas |
| `consol_max_outside_bars` | 3 | Velas fuera de rango permitidas |
| `lookforward_bars` | 100 | Velas a futuro para simular trade |
| `max_price_range_pct` | 5.0 | Filtro global de rango de precio |

### Integracion con IndicatorManager

```javascript
// En ZoneDetectorSettings.jsx
const manager = IndicatorManagerRegistry.get(symbol);
const result = await manager.loadTradingZones({
  ...params,
  generate_csv: true
});
```

## Generacion de CSV

Cuando `generate_csv: true`, se crea un archivo CSV con formato europeo (separador `;`, decimal `,`):

```
zone_num;start_date;end_date;min_price;max_price;price_range_pct;breakout_direction;trade_result;trade_pnl_r;r_multiple;trading_score;candles_in_zone;duration_hours
1;2026-01-15 08:00;2026-01-16 08:00;42000,00;42500,00;1,19;UP;WIN;2,0;2,00;75;12;24,0
```

**Ubicacion:** `4.Analizador cripto/backend/zones_csv/`

## Troubleshooting

**Error "IndicatorManager no disponible":**
- El grafico debe estar cargado antes de abrir el modal
- Verificar que `IndicatorManagerRegistry.get(symbol)` retorna un manager valido

**Error 404 en `/api/zones/detect`:**
- Verificar que el backend corre en puerto 10001
- Verificar que el fix `get_historical` esta aplicado en main.py linea 4417

**Puerto 10000 bloqueado:**
- Procesos zombie de Python pueden bloquear el puerto
- Usar puerto 10001 como alternativa
- O reiniciar la PC para liberar sockets

**CSV no se genera:**
- Verificar que existe el directorio `zones_csv/`
- Verificar permisos de escritura

---

# ZONE DETECTOR v3.1 - Mejoras Febrero 2026

## Resumen de Cambios

Sistema mejorado con presets, scoring intrinseco, limites expandidos y barra de progreso para carga de datos.

## 1. Sistema de Presets (ZoneDetectorSettings.jsx)

Permite guardar, cargar y eliminar configuraciones personalizadas.

### Funciones Implementadas

```javascript
// Guardar preset
const handleSavePreset = () => {
  const presets = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || '{}');
  presets[presetName] = { ...currentParams };
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
};

// Cargar preset
const handleLoadPreset = (name) => {
  const presets = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || '{}');
  if (presets[name]) {
    setParams(presets[name]);
  }
};

// Eliminar preset
const handleDeletePreset = (name) => {
  const presets = JSON.parse(localStorage.getItem(PRESETS_STORAGE_KEY) || '{}');
  delete presets[name];
  localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(presets));
};
```

### UI de Presets

- Dropdown para seleccionar preset guardado
- Input + boton "Guardar" para crear nuevo preset
- Boton "Eliminar" para borrar preset seleccionado
- Boton "Reset" para volver a valores por defecto

### Storage Key

```javascript
const PRESETS_STORAGE_KEY = 'zoneDetector_presets';
```

## 2. Scoring Intrinseco (Correccion de Sesgos)

El calculo del score de cada zona fue corregido para eliminar sesgos post-trade.

### Sesgos Corregidos

1. **Continuation Score**: Ahora es opcional via `use_continuation_score`
   - Solo aplica cuando `entry_mode = "swing_confirmation"`
   - No aplica para `breakout_close` (no hay forma de saber si velas futuras continuaran)

2. **Ajuste por Resultado**: Eliminado completamente
   - Antes: WIN +15, LOSS -10
   - Ahora: Score final = base_score (sin ajuste por resultado)

### Implementacion (zone_detector.py)

```python
@dataclass
class ZoneDetectionParams:
    # ... otros parametros ...
    use_continuation_score: bool = False  # Solo usar si entry_mode=swing_confirmation

# En calculo de score:
continuation_score = 0
if params.use_continuation_score and params.entry_mode == "swing_confirmation":
    continuation_score = min(continuation_bars * 5, 20)

# Score final = base_score (NO aplicamos ajuste por resultado WIN/LOSS)
trading_score = base_score
```

### UI (ZoneDetectorSettings.jsx)

Checkbox "Usar Continuation Score" solo visible cuando entry_mode = "swing_confirmation".

## 3. Limites de Dias Expandidos

### MAX_DAYS_BY_INTERVAL Actualizado

| Intervalo | Antes | Ahora |
|-----------|-------|-------|
| 1 min | 5 | 7 |
| 3 min | 10 | 21 |
| 5 min | 120 | **400** |
| 15 min | 90 | 180 |
| 30 min | 150 | 360 |
| 60 min | 360 | 730 |
| 120 min | 180 | 730 |
| 240 min | 720 | 1095 |
| D | 1440 | 2000 |
| W | 730 | 1000 |

### Archivos Actualizados

1. **Backend:** `4.Analizador cripto/backend/main.py` (linea 82)
2. **Frontend Settings:** `8.AnalizadorDesktop/src/components/ZoneDetectorSettings.jsx`
3. **Frontend Chart:** `8.AnalizadorDesktop/src/components/SingleSymbolAnalyzer.jsx`

### Limite de Requests Aumentado

En `get_historical()` (main.py linea 302):
```python
# Antes: max_requests = 50  (50k velas max)
# Ahora:
max_requests = 120  # 120 requests x 1000 velas = 120,000 velas max (~416 dias en 5min)
```

## 4. Barra de Progreso para Carga de Datos

Sistema SSE (Server-Sent Events) para mostrar progreso durante carga de datasets grandes.

### Backend - Endpoint SSE

```python
@app.get("/api/historical-stream/{symbol}")
async def get_historical_stream(symbol: str, interval: str = "15", days: int = 30):
    async def generate():
        # Enviar progreso mientras descarga
        yield f"data: {json.dumps({'type': 'progress', 'loaded': N, 'total': T, 'percent': P})}\n\n"
        # Enviar datos finales
        yield f"data: {json.dumps({'type': 'complete', 'total_candles': N, 'data': candles})}\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")
```

### Frontend - MiniChart.jsx

**Estado de progreso:**
```javascript
const [loadProgress, setLoadProgress] = useState(null); // { loaded, total, percent }
```

**Umbral para usar streaming:**
```javascript
const STREAM_THRESHOLD = 10000; // Mas de 10k velas usa SSE
```

**Funcion de carga con SSE:**
```javascript
const loadHistoricalWithStream = async (daysToLoad) => {
  return new Promise((resolve, reject) => {
    const url = `${API_BASE_URL}/api/historical-stream/${symbol}?interval=${interval}&days=${daysToLoad}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'progress') {
        setLoadProgress({ loaded: data.loaded, total: data.total, percent: data.percent });
      } else if (data.type === 'complete') {
        setLoadProgress(null);
        eventSource.close();
        resolve({ success: true, data: data.data });
      }
    };
  });
};
```

**UI de barra de progreso:**
- Overlay con fondo semitransparente
- Barra de progreso con gradiente azul-verde
- Porcentaje centrado en la barra
- Contador de velas: "45,000 / 115,000 velas"
- Info: "BTCUSDT @ 5min - 400 dias"

### Logica de Decision

```javascript
// En loadHistoricalData():
if (useStreaming && !isIncremental) {
  // Dataset grande (>10k velas) - usar SSE con progreso
  json = await loadHistoricalWithStream(parseInt(days));
} else {
  // Dataset pequeno o incremental - fetch tradicional
  json = await fetchWithRetry(url, ...);
}
```

## 5. Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `zone_detector.py` | `use_continuation_score`, eliminado ajuste WIN/LOSS |
| `main.py` | MAX_DAYS expandido, max_requests=120, endpoint SSE |
| `ZoneDetectorSettings.jsx` | Presets, MAX_DAYS expandido, checkbox continuation |
| `SingleSymbolAnalyzer.jsx` | MAX_DAYS_BY_INTERVAL, DAYS_OPTIONS expandidos |
| `MiniChart.jsx` | Estado loadProgress, loadHistoricalWithStream(), UI progreso |
| `IndicatorManager.js` | Parametro use_continuation_score |

## 6. Formula de Score Actual

```
base_score = momentum_score + compression_score + volume_bonus + [continuation_score] + [bbwp_bonus]

Donde:
- momentum_score: 0-25 (direccion del breakout vs momentum previo)
- compression_score: 0-25 (que tan comprimida esta la zona)
- volume_bonus: 0-15 (volumen relativo en zona)
- continuation_score: 0-20 (OPCIONAL, solo si use_continuation_score=true Y entry_mode=swing_confirmation)
- bbwp_bonus: 0-15 (OPCIONAL, solo si use_bbwp_scoring=true Y BBWP < threshold)

trading_score = base_score (sin ajuste por resultado WIN/LOSS)
```

## 7. Ejemplo de Uso

```javascript
// Cargar 400 dias de datos en 5 minutos con barra de progreso
const params = {
  symbol: "BTCUSDT",
  interval: "5",
  days: 400,
  use_continuation_score: false,  // No usar para breakout_close
  entry_mode: "breakout_close",
  min_score_filter: 50
};

// El frontend detecta que 400 dias en 5min = ~115k velas > 10k threshold
// Automaticamente usa SSE con barra de progreso
const result = await manager.loadTradingZones(params);
```

## 8. Troubleshooting Adicional

**Barra de progreso no aparece:**
- Verificar que days * candles_por_dia > 10,000
- Para 5min: threshold es ~35 dias
- Para 1h: threshold es ~416 dias

**Analisis dice "50,000 velas" aunque seleccione 400 dias:**
- Verificar que `max_requests = 120` en main.py linea 302
- Reiniciar backend despues de cambiar

**Preset no se guarda:**
- Verificar localStorage disponible
- Key: `zoneDetector_presets`

**Score muy bajo en todas las zonas:**
- Revisar que no se esta usando continuation_score incorrectamente
- El score maximo sin continuation es ~80 (momentum + compression + volume + bbwp)

---

# ZONE DETECTOR REALTIME (Febrero 2026)

Sistema de deteccion de zonas de consolidacion en tiempo real con visualizacion en el chart y alertas al TradingBot.

## Arquitectura

```
┌──────────────────────────────────────────────────────────────────────┐
│                     ZONE DETECTOR REALTIME                            │
├──────────────────────────────────────────────────────────────────────┤
│                                                                       │
│  BACKEND (4.Analizador cripto/backend/)                               │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ zone_service.py                                                  │ │
│  │   WebSocket candle close → _detect_and_alert()                   │ │
│  │     → zone_detector.detect_zones() (con parametros de config)    │ │
│  │     → _store_zones() → almacena en _recent_zones dict           │ │
│  │     → _send_alert() (si alertsEnabled=true) → TradingBot :5000  │ │
│  │                                                                   │ │
│  │ zone_realtime_config.json                                        │ │
│  │   enabled, symbols, interval, window_candles, alertsEnabled...   │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│           │                                                           │
│  Endpoints:                                                           │
│  - GET /api/zones/realtime/status  → Estado del servicio              │
│  - GET /api/zones/realtime/zones/{symbol}  → Zonas detectadas         │
│  - POST /api/zones/realtime/toggle  → Activar/desactivar             │
│  - POST /api/zones/realtime/config  → Actualizar configuracion        │
│  - POST /api/zones/realtime/reanalyze  → Re-analizar historico        │
│           │                                                           │
│  FRONTEND (8.AnalizadorDesktop/src/)                                  │
│  ┌─────────────────────────────────────────────────────────────────┐ │
│  │ IndicatorManager.js                                              │ │
│  │   _fetchRealtimeZones() (cada 15s, con fingerprint detection)    │ │
│  │   → zoneVisualizerIndicator.setRealtimeZones(zones)              │ │
│  │   → requestRedraw()                                              │ │
│  │                                                                   │ │
│  │ ZoneVisualizerIndicator.js                                       │ │
│  │   _manualZones[] + _realtimeZones[] → _mergeZones() → zones[]   │ │
│  │   Renderiza: consolidacion + trade rectangle + labels            │ │
│  │   Estados: WIN (verde), LOSS (rojo), OPEN (amarillo)             │ │
│  │                                                                   │ │
│  │ ZoneDetectorSettings.jsx                                         │ │
│  │   Modal de configuracion con toggle start/stop polling           │ │
│  └─────────────────────────────────────────────────────────────────┘ │
│                                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

## Flujo Completo

```
1. Usuario activa servicio realtime desde ZoneDetectorSettings modal
   POST /api/zones/realtime/toggle {enabled: true}
      ↓
2. Backend inicia zone_service: conecta WebSocket, carga historico
      ↓
3. En cada cierre de vela:
   _detect_and_alert() → zone_detector.detect_zones()
      ↓
4. Zonas detectadas se almacenan en _recent_zones[symbol]
   Si alertsEnabled=true → POST al TradingBot (puerto 5000)
      ↓
5. Frontend: IndicatorManager hace polling GET /api/zones/realtime/zones/{symbol}
   Cada 15 segundos (auto-inicia si detecta servicio activo)
      ↓
6. Si fingerprint cambio → setRealtimeZones() → _mergeZones() → redraw
      ↓
7. Chart renderiza zonas con colores segun estado del trade
```

## Separacion de Fuentes de Zonas

**Problema resuelto:** El polling realtime sobrescribia zonas manuales.

**Solucion:** Dos fuentes independientes en ZoneVisualizerIndicator:

| Fuente | Array | Metodo | Origen |
|--------|-------|--------|--------|
| Manual | `_manualZones` | `setZones()` | Boton "Detectar zonas" |
| Realtime | `_realtimeZones` | `setRealtimeZones()` | Polling cada 15s |

`_mergeZones()` combina ambas con deduplicacion por `start_timestamp + end_timestamp`. Si hay conflicto, la zona manual tiene prioridad.

## Estado OPEN para Trades en Progreso

**Problema resuelto:** Trades sin TP/SL se mostraban como LOSS.

**Cambio en backend** (`zone_detector.py`):
- Antes: PENDING → forzaba WIN/LOSS segun P&L parcial
- Ahora: PENDING → `trade_result = "OPEN"` con P&L parcial informativo

**Renderizado frontend** (`ZoneVisualizerIndicator.js`):

| Estado | Color | Borde | Extension | Label |
|--------|-------|-------|-----------|-------|
| WIN | Verde | Solido | Hasta `trade_close_timestamp` | W |
| LOSS | Rojo | Solido | Hasta `trade_close_timestamp` | L |
| OPEN | Amarillo | Discontinuo | Hasta borde derecho del chart | O |

## Fingerprint Change Detection

```javascript
// En IndicatorManager._fetchRealtimeZones()
const fingerprint = zones.map(z => `${z.start_timestamp}_${z.trade_result}`).join('|');
if (fingerprint !== this._lastRealtimeZoneFingerprint) {
  // Detecta: nueva zona, o transicion OPEN→WIN/LOSS
  this.zoneVisualizerIndicator.setRealtimeZones(zones);
  this.requestRedraw();
}
```

## Config Realtime

```json
// 4.Analizador cripto/backend/config/zone_realtime_config.json
{
  "enabled": true,
  "symbols": ["BTCUSDT"],
  "interval": "1",
  "window_candles": 100,
  "alertsEnabled": true,
  "alertTargetUrl": "http://localhost:5000/api/watchlist-alert",
  "cooldownMinutes": 5
}
```

**Nota:** `alertsEnabled` controla envio al TradingBot. La deteccion y visualizacion funcionan independientemente.

## Archivos del Sistema

### Backend

| Archivo | Descripcion |
|---------|-------------|
| `zone_service.py` | Servicio realtime: WebSocket → deteccion → almacenamiento → alertas |
| `zone_detector.py` | Algoritmo de deteccion + simulacion trades (OPEN/WIN/LOSS) |
| `config/zone_realtime_config.json` | Configuracion persistente del servicio |

### Frontend

| Archivo | Descripcion |
|---------|-------------|
| `indicators/IndicatorManager.js` | Polling realtime zones, auto-deteccion servicio activo |
| `indicators/ZoneVisualizerIndicator.js` | Dual source (manual/realtime), merge, render OPEN state |
| `ZoneDetectorSettings.jsx` | Modal config, toggle servicio, control polling chart |

## Troubleshooting

**Zonas realtime no aparecen en el chart:**
- Verificar servicio activo: `GET /api/zones/realtime/status`
- Verificar zonas almacenadas: `GET /api/zones/realtime/zones/{symbol}`
- Consola: buscar `[{symbol}] Realtime zones actualizadas: N zonas`

**0 alertas al TradingBot:**
- Verificar `alertsEnabled: true` en `zone_realtime_config.json`
- El checkbox "Alertas" en el modal controla este flag

**Zonas manuales desaparecen con realtime activo:**
- Corregido con separacion `_manualZones` / `_realtimeZones`
- Polling debe usar `setRealtimeZones()`, nunca `setZones()`

**Trades muestran LOSS en vez de OPEN:**
- Verificar fix en `zone_detector.py` (PENDING → OPEN)

**Problema conocido:** `_send_alert()` en `zone_service.py` envia `custom_stop_loss` y `custom_take_profit` pero no `order_type`, lo cual puede causar inconsistencia de TP/SL en ordenes market.

## Fixes Febrero 2026 (sesion 2)

### Bug 1: Zonas historicas WIN/LOSS se re-registraban como OPEN

**Archivo:** `zone_service.py` linea ~897

**Causa:** La condicion `zone.trade_result not in ("SKIPPED", "NO_ENTRY", "")` permitia que zonas con resultado WIN o LOSS se re-registraran como trades abiertos.

**Fix:** Cambiar a `zone.trade_result == "OPEN"` - solo registrar como open trade si el detector explicitamente lo marca como OPEN.

### Bug 2: Pending INSTANT_BREAKOUT con SL/TP absurdos

**Archivo:** `zone_service.py` en `_check_pending_breakouts()`

**Causa:** Cuando el precio se alejaba mucho de la zona y luego habia breakout, el entry price estaba muy lejos del zone edge, generando SL/TP con distancias absurdas.

**Fix:** Validacion de proximidad - si `distance_pct` entre entry y zone edge supera `max_price_range_pct`, se bloquea con log `BLOCKED_FAR_ENTRY`.

### Bug 3: Multiples trades abiertos en modo sequential

**Archivo:** `zone_service.py` en `_register_open_trades()` y `_check_pending_breakouts()`

**Causa:** No se verificaba si ya habia un trade abierto antes de abrir otro en modo sequential.

**Fix:**
- `_register_open_trades()`: Si `position_mode == "sequential"` y ya hay trades abiertos, bloquea con `BLOCKED_SEQUENTIAL`
- `_check_pending_breakouts()`: Misma verificacion al inicio, bloquea con `BLOCKED_SEQUENTIAL_PENDING`

### Pausa de re-deteccion historica

**Archivos:** `zone_service.py`, `main.py`, `ZoneDetectorSettings.jsx`

Boton toggle que pausa `_detect_and_alert()` sin detener el tracking de trades ni pending breakouts.

- **Backend:** `self.detection_paused` flag (runtime, no persistido)
- **Endpoint:** `POST /api/zones/realtime/pause-detection` (toggle)
- **UI:** Boton naranja prominente "DETECCION PAUSADA - Click para reanudar"
- Cuando pausado: `_update_open_trades()` y `_check_pending_breakouts()` siguen corriendo

### Boton "Detectar ahora (1 vez)"

**Archivos:** `zone_service.py`, `main.py`, `ZoneDetectorSettings.jsx`

Ejecuta `_detect_and_alert()` una sola vez sin cambiar el estado de pausa. Permite descubrir pending zones cuando la re-deteccion continua esta pausada.

- **Backend:** `run_detection_once()` retorna resultados por simbolo (pending/baseline antes y despues)
- **Endpoint:** `POST /api/zones/realtime/detect-now`
- **UI:** Boton azul visible solo cuando la deteccion esta pausada

### Metodo de deteccion configurable

**Archivos:** `zone_service.py`, `ZoneDetectorSettings.jsx`

El metodo de deteccion (`trading_zones` o `atr_dynamic`) ahora es configurable desde la UI y se persiste en `zone_realtime_config.json`.

**Problema resuelto:** Las barras de metricas usaban `atr_dynamic` pero el servicio realtime tenia hardcodeado `"trading_zones"`. Las zonas detectadas por las metricas no coincidian con las del servicio.

**Cambios:**
- `ZoneServiceConfig`: nuevo campo `detection_method` + params `atr_dyn_*`
- `_detect_and_alert()` y `_initial_detection()`: usan `self.config.detection_method` en vez de hardcode
- `_build_detection_params()`: incluye params de ATR Dynamic
- Frontend `handleRealtimeConfigSave`: envia `detection_method` y `atr_dyn_*` al backend

### Endpoints nuevos

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/zones/realtime/pause-detection` | POST | Toggle pausa de re-deteccion |
| `/api/zones/realtime/detect-now` | POST | Ejecutar deteccion una sola vez |

---

# OPTIMIZADOR DE PARAMETROS - GRID SEARCH (Febrero 2026)

Sistema para encontrar la mejor combinacion de parametros del Zone Detector mediante busqueda exhaustiva (grid search).

## Archivos del Sistema

| Archivo | Descripcion |
|---------|-------------|
| `4.Analizador cripto/backend/main.py` | Endpoints `/api/zones/optimize` y `/api/zones/optimize-estimate` |
| `8.AnalizadorDesktop/src/components/indicators/IndicatorManager.js` | Metodos `estimateOptimization()` y `optimizeTradingZones()` |
| `8.AnalizadorDesktop/src/components/ZoneDetectorSettings.jsx` | UI: estimacion, confirmacion, ejecucion, tabla de resultados |

## Flujo de Uso

1. **Usuario abre modal Zone Detector** → seccion "Optimizador de Parametros"
2. **Selecciona parametros a optimizar** (checkbox) y ajusta rangos min/max/step
3. **Click "Estimar y Ejecutar"** → backend ejecuta 2 combos de prueba y extrapola
4. **UI muestra estimacion**: tiempo, combinaciones, velas. Colores: verde (<1min), amarillo (<5min), rojo (>5min)
5. **"Confirmar y Ejecutar"** → grid search completo en thread pool
6. **Tabla de resultados**: Top 15 ordenados por metrica elegida, boton "Aplicar" por fila
7. Los parametros no optimizados se toman del estado actual del modal

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/zones/optimize-estimate` | POST | Ejecuta 2 combos de prueba y extrapola tiempo |
| `/api/zones/optimize` | POST | Grid search completo, retorna top N resultados |

### Request Body

```json
{
  "symbol": "BTCUSDT",
  "interval": "5",
  "days": 400,
  "base_params": { "lookforward_bars": 100, "entry_mode": "breakout_close" },
  "param_ranges": {
    "atr_dyn_multiplier": { "min": 0.5, "max": 2.0, "step": 0.25 },
    "ttm_kc_multiplier": { "min": 1.0, "max": 2.5, "step": 0.25 }
  },
  "metric": "expectancy",
  "top_n": 15
}
```

## Parametros Optimizables

| Parametro | Label UI | Default Range | Descripcion |
|-----------|----------|---------------|-------------|
| `atr_dyn_multiplier` | ATR Multiplier | 0.5 - 2.0 (0.25) | Multiplicador ATR para ancho de zona |
| `atr_dyn_ma_period` | MA Period | 10 - 40 (5) | Periodo media movil del ATR |
| `atr_dyn_max_breakout` | Max Breakout | 2 - 10 (2) | Max velas de breakout permitidas |
| `consol_max_range_pct` | Max Range % | 1.0 - 4.0 (0.5) | Maximo rango de precio de la zona |
| `min_score_filter` | Min Score | 0 - 60 (10) | Score minimo para incluir zona |
| `lookforward_bars` | Lookforward | 50 - 200 (25) | Velas a futuro para simular trade |
| `atr_dyn_period` | ATR Period | 100 - 300 (50) | Periodo del calculo ATR |
| `ttm_atr_length` | TTM ATR Length | 10 - 30 (5) | Periodo ATR para Keltner Channels |
| `ttm_kc_multiplier` | TTM KC Mult | 1.0 - 2.5 (0.25) | Multiplicador Keltner Channel |
| `ttm_min_squeeze_bars` | TTM Min Bars | 3 - 10 (1) | Min velas consecutivas en squeeze |

**Nota:** Los parametros TTM solo surten efecto si `use_ttm_prefilter=true` esta activado en el modal.

## Metricas de Optimizacion

| Metrica | Descripcion |
|---------|-------------|
| `expectancy` | PnL promedio por trade cerrado (en R) |
| `total_pnl_r` | PnL total acumulado (en R) |
| `win_rate` | Porcentaje de trades ganadores |
| `profit_factor` | Ganancia bruta / Perdida bruta |

## Limites y Validaciones

- **Max combinaciones**: 5,000 (frontend y backend validan)
- **Max valores por parametro**: 20 (se submuestrean si excede)
- **Timeout frontend**: 60 minutos
- **Ejecucion**: `loop.run_in_executor(None, ...)` en thread pool para no bloquear uvicorn
- **Logs**: Backend imprime progreso cada 10 combinaciones

## Implementacion Backend

El grid search se ejecuta en un thread pool para no bloquear el event loop de uvicorn:

```python
def run_all_combos():
    results = []
    for i, combo in enumerate(all_combos):
        result = run_single_combo(combo_dict)
        results.append(result)
    results.sort(key=lambda r: r.get(metric, 0), reverse=True)
    return results

loop = asyncio.get_event_loop()
results = await loop.run_in_executor(None, run_all_combos)
```

**CRITICO:** Nunca ejecutar codigo CPU-bound sincrono dentro de un `async def` en FastAPI. Siempre usar `run_in_executor` para offload a thread pool.

## Troubleshooting

**Estimacion dice 0 segundos:**
- Datos en cache hacen la deteccion muy rapida con pocas velas

**Optimizacion se corta sin resultados:**
- Verificar timeout (60 min). Revisar logs: `[SYMBOL] [OPTIMIZE] Progreso: N/M`

**Resultados TTM no cambian nada:**
- Verificar que `use_ttm_prefilter` esta activado en el modal

---

# VP PERIODIC BACKTEST (Febrero 2026)

Sistema de backtesting de estrategias basadas en Volume Profile Periodic + VWAP Session, con visualizacion de trades en el chart.

## Archivos del Sistema

### Backend (`4.Analizador cripto/backend/`)

| Archivo | Descripcion |
|---------|-------------|
| `backtest_vp_periodic.py` | Motor de backtest: 3 estrategias, calculo VP, VWAP Session, metricas |
| `main.py` (endpoint POST) | `POST /api/vp-periodic/backtest` - Backtest sincrono |
| `main.py` (endpoint SSE) | `GET /api/vp-periodic/backtest-stream` - Backtest con progreso via SSE |

### Frontend (`8.AnalizadorDesktop/src/`)

| Archivo | Descripcion |
|---------|-------------|
| `components/VPPeriodicBacktestSettings.jsx` | Modal de configuracion y ejecucion de backtests |
| `components/indicators/IndicatorManager.js` | Metodo `runVPPeriodicBacktest()` - conecta con SSE endpoint |
| `components/indicators/ZoneVisualizerIndicator.js` | Renderiza trades como zonas VP via `setVPZones()` |
| `components/SingleSymbolAnalyzer.jsx` | Integra el modal en la UI principal |

## Estrategias Disponibles

| Estrategia | Descripcion | Parametros |
|------------|-------------|------------|
| `poc_bounce` | Mean reversion al POC. Cruza POC filtrado por VWAP. SL en borde VA. | vp_period, tp_rr, bins |
| `va_breakout` | Breakout del Value Area. N cierres fuera del VA + VWAP sigma. SL en POC. | vp_period, tp_rr, confirm_bars, min_va_width_pct, bins |
| `rejection_confluence` | Rechazo en VAH/VAL + confluencia VWAP sigma + vela de rechazo. TP en POC. | vp_period, tolerance_pct, wick_ratio, bins |

## Endpoints API

### POST `/api/vp-periodic/backtest`

Backtest sincrono (sin progreso). Ejecuta en thread pool.

```json
{
  "symbol": "BTCUSDT",
  "interval": "1",
  "days": 400,
  "strategy": "poc_bounce",
  "params": { "vp_period": 240, "tp_rr": 2.0, "bins": 50 }
}
```

### GET `/api/vp-periodic/backtest-stream` (SSE)

Backtest con barra de progreso via Server-Sent Events.

**Query params:** `symbol`, `interval`, `days`, `strategy`, `params_json`

**Eventos SSE:**
- `type: 'progress'` - `{phase, percent, message}` - Progreso (0-100%)
- `type: 'result'` - Resultado completo con trades, stats, zones
- `type: 'error'` - Error con mensaje

**Fases de progreso:**
1. `fetching` (0-8%) - Descarga/cache de velas
2. `vwap` (10%) - Calculo VWAP Session
3. `strategy` (30%) - Ejecucion de estrategia
4. `metrics` (70%) - Calculo de metricas
5. `zones` (80%) - Construccion de zonas para visualizacion
6. `done` (100%) - Completado

## Arquitectura SSE

```
Frontend (EventSource)          Backend (StreamingResponse)
    |                               |
    |--- GET /backtest-stream ----> |
    |                               | -> Verifica cache de velas
    |<-- progress: fetching --------|
    |                               | -> get_historical() (usa cache 2h TTL)
    |<-- progress: fetched ---------|
    |                               | -> Thread pool: run_backtest()
    |<-- progress: vwap ------------|    (comunica via queue.Queue)
    |<-- progress: strategy --------|
    |<-- progress: metrics ---------|
    |<-- progress: zones -----------|
    |<-- result: {zones, stats} ----|
    |                               |
    | eventSource.close()           |
```

## Cache de Velas para Backtest

La funcion `get_historical()` tiene un cache en memoria para llamadas con `skip_day_limit=True` (backtests):

- **TTL**: 2 horas (7200 segundos)
- **Cache fresco (<2h)**: Retorna directamente
- **Cache expirado (>2h)**: Carga incremental - solo descarga velas nuevas desde el ultimo timestamp y las mergea
- **Sin cache**: Descarga completa desde Bybit API
- **Cache key**: `{symbol}_{interval}`

## Visualizacion en el Chart

Los trades del backtest se visualizan via `ZoneVisualizerIndicator`:

```javascript
// IndicatorManager.js
this.zoneVisualizerIndicator.setVPZones(data.zones);
```

Cada trade se renderiza como una zona con:
- Rectangulo de consolidacion (entry zone)
- Rectangulo de trade (entry → exit) coloreado segun resultado
- Labels: W (win verde), L (loss rojo), O (open amarillo)

## Metricas Calculadas

| Metrica | Descripcion |
|---------|-------------|
| `total_trades` | Total de trades ejecutados |
| `wins` / `losses` | Trades ganadores / perdedores |
| `win_rate` | Porcentaje de acierto |
| `total_pnl_r` | PnL total en multiplos de R |
| `expectancy` | PnL promedio por trade (en R) |
| `profit_factor` | Ganancia bruta / Perdida bruta |
| `max_drawdown_r` | Drawdown maximo en R |
| `avg_winner_r` / `avg_loser_r` | Promedio de ganadores/perdedores |

## Optimizacion de Rendimiento

### build_segment_lookup()

Lookup table O(1) para mapear indice de vela → segmento VP mas reciente. Sin esto, cada trade buscaba linealmente entre todos los segmentos.

```python
def build_segment_lookup(segments, total_candles, vp_period):
    lookup = [None] * total_candles
    for seg in segments:
        start_idx = seg['end_idx']  # Segmento disponible despues de calcularse
        for i in range(start_idx, total_candles):
            lookup[i] = seg
    return lookup
```

## Troubleshooting

**Error "No se pudo conectar al backend":**
- Verificar que el backend esta corriendo en puerto 10000
- Si se cambio codigo, reiniciar el backend (matar proceso viejo primero)
- Revisar consola del backend por errores de Python

**Backtest tarda mucho:**
- Primera ejecucion descarga velas de Bybit (puede tardar 1-2 min para 400 dias en 1min)
- Ejecuciones siguientes usan cache en memoria (instantaneo si <2h)
- Si el cache expiro, solo descarga velas nuevas (incremental)

**Barra de progreso no aparece:**
- Verificar que el frontend usa el endpoint SSE (`/api/vp-periodic/backtest-stream`)
- Verificar consola del browser por errores de EventSource

**Trades no se ven en el chart:**
- Verificar que ZoneVisualizerIndicator esta habilitado
- Verificar que `setVPZones()` se llama con las zonas del resultado

---

# MODULAR STRATEGY BUILDER (Febrero 2026)

Sistema de backtesting modular sin codigo donde el usuario compone estrategias combinando 5 bloques independientes. Documentacion completa en `4.Analizador cripto/STRATEGY_BUILDER.md`.

## Concepto

El Strategy Builder permite crear estrategias de trading combinando:
1. **Niveles** (fuentes de soporte/resistencia)
2. **Senal de Entrada** (cuando entrar)
3. **Filtros de Contexto** (condiciones adicionales)
4. **Risk Management** (SL/TP)
5. **Exit Rules** (salidas adaptativas antes de SL/TP)

**Principio fundamental:** Cada bloque es independiente. Puedes cambiar la fuente de niveles sin tocar la senal de entrada, o cambiar el SL sin modificar los filtros.

**Anti look-ahead:** Todos los indicadores y niveles se calculan SOLO con datos disponibles hasta el momento de la vela actual.

## Archivos del Sistema

### Backend (`4.Analizador cripto/backend/`)

| Archivo | Descripcion |
|---------|-------------|
| `strategy_engine.py` | Motor completo (~2091 lineas): 6 level sources, 8 senales, 9 filtros, SL/TP, exit rules, backtest, optimizer |
| `main.py` (lineas 9137+) | 3 endpoints: backtest-stream (POST SSE via fetch+ReadableStream), optimize-estimate, optimize |

### Frontend (`8.AnalizadorDesktop/src/components/`)

| Archivo | Descripcion |
|---------|-------------|
| `StrategyBuilder.jsx` | UI completa (~2063 lineas): 5 bloques, backtest SSE, presets, optimizer, realtime, VP Zone Cache |
| `SingleSymbolAnalyzer.jsx` | Boton "Strategy" purpura + integracion del componente |
| `indicators/IndicatorManager.js` | 3 metodos: runStrategyBuilderBacktest, estimateStrategyOptimization, optimizeStrategyBuilder |
| `indicators/ZoneVisualizerIndicator.js` | Soporte `_strategyZones` como fuente independiente + colores purpura |

## Arquitectura de 5 Bloques

### Bloque 1: Level Sources (6 fuentes de niveles)

Cada fuente produce objetos `Level(price, type, source, strength, valid_from_idx, valid_until_idx)`.

| Fuente | Descripcion | Parametros clave | Anti Look-Ahead |
|--------|-------------|------------------|-----------------|
| `vp_periodic` | POC, VAH, VAL por segmento VP | `period` (50-1000), `bins` (20-100), `use_poc/vah/val`, `lookback_segments` (0-10) | Niveles activos solo despues de que el segmento cierra |
| `vp_zones` | VP Zone Scanner (perfiles D, P, b) | `detection_mode` (fixed_window/progressive), `window_size`, `bins`, `min_d_score`, `include_pb_shapes`, `max_range_pct` | Solo zonas completamente formadas. Usa cache en disco |
| `sr_v2` | Swing points clusterizados | `swing_bars` (2-10), `cluster_distance_pct` (0.1-2.0), `min_touches` (1-5), `max_levels`, `recalc_every` | Recalcula cada N velas con datos hasta ese punto |
| `vwap_bands` | VWAP + bandas sigma (5 niveles por vela) | Usa `vwap_period` global | Dinamico, se recalcula cada vela |
| `swing_levels` | Swing Highs/Lows individuales como S/R | `swing_bars` (2-15) | Solo validos despues de confirmacion (i + swing_bars) |
| `dtb_neckline` | Necklines de Double Top/Bottom | `candles_per_extreme`, `price_margin_pct`, `min_candles_between` | Solo despues de formacion completa |

**VP Periodic vs VP Zones:**
- VP Periodic divide el historico en segmentos regulares de N velas. Rapido y predecible.
- VP Zones escanea buscando perfiles tipo D/P/b con ventana deslizante. Mas preciso pero mas lento. Tiene cache en disco (`zones_cache/`).

### Bloque 2: Entry Signals (8 tipos)

Solo una senal puede estar activa a la vez. Busca en los niveles activos del Bloque 1 para determinar la direccion.

| Senal | Parametros | Logica |
|-------|-----------|--------|
| `price_touch` | `tolerance_pct` (0.05-1.0) | Precio toca nivel y cierra del lado correcto |
| `swing_confirm` | `swing_bars` (2-10), `tolerance_pct` | Swing H/L confirmado cerca de nivel |
| `breakout_close` | `confirm_bars` (1-5), `tolerance_pct` | N cierres consecutivos al otro lado de nivel |
| `rejection_candle` | `wick_ratio` (0.6-5.0), `tolerance_pct` | Vela con wick largo rechazando nivel |
| `pattern_match` | `pattern_type` (engulfing/doji/any), `tolerance_pct` | Patron de velas clasico cerca de nivel |
| `squeeze_release` | (sin parametros) | TTM Squeeze pasa de activo a inactivo. Direccion por pendiente VWAP |
| `cvd_divergence` | `lookback` (10-50) | Divergencia precio vs CVD acumulado |
| `dtb_confirm` | `lookback` (10-100), `min_confidence` (30-90) | Confirmacion de Double Top/Bottom |

### Bloque 3: Context Filters (9 tipos, AND logic)

Todos los filtros habilitados deben pasar para que la senal se ejecute.

| Filtro | Parametros | Logica |
|--------|-----------|--------|
| `vwap_trend` | `lookback` (5-1000), `min_diff_pct` (0-2.0) | VWAP subiendo = solo LONG, bajando = solo SHORT |
| `vwap_position` | `mode` (trend/counter), `long_ref`, `short_ref` | Precio arriba/abajo de VWAP o banda sigma. `long_ref`/`short_ref` seleccionan referencia: vwap, upper_1..3, lower_1..3 |
| `ttm_squeeze` | `require_squeeze` (on/off) | on=solo durante squeeze, off=solo sin squeeze |
| `bbwp_range` | `min_val` (0-100), `max_val` (0-100) | BBWP dentro del rango especificado |
| `volume_zscore` | `min_zscore` (0.5-4.0), `lookback` (10-50) | Volumen actual > N desviaciones de la media |
| `cvd_trend` | `lookback` (10-50) | CVD alineado con direccion del trade |
| `dtb_bias` | `lookback` (10-100), `min_confidence` (30-90) | DTB reciente sesga direccion permitida |
| `direction` | `allowed` (both/long/short) | Filtro global de direccion |
| `vp_shape` | `allowed_shapes` (all/D/P/b/P_trimmed/b_trimmed/thin) | Filtra niveles VP por forma del perfil. Solo aplica a niveles con source `vp_*` o `vpz_*` |

### Bloque 4: Risk Management

**Stop Loss (4 metodos):**

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| `below_level` | `buffer_pct` (0.01-1.0) | SL debajo/arriba del nivel que disparo la senal + buffer % |
| `below_swing` | `buffer_pct` (0.01-1.0) | SL en ultimo swing low (LONG) o swing high (SHORT) + buffer. Si la senal vino de `swing_confirm`, usa el `pivot_price` directamente |
| `atr_multiple` | `atr_multiplier` (0.5-5.0) | SL a N x ATR(14) del precio de entrada |
| `fixed_pct` | `fixed_pct` (0.1-5.0) | SL a porcentaje fijo del precio de entrada |

**Take Profit (5 metodos):**

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| `rr_fixed` | `rr` (0.5-10.0) | TP = entry + (riesgo * rr) |
| `opposite_level` | `fallback_rr` (1.0-5.0) | TP en nivel opuesto mas cercano. Fallback a R:R si no hay nivel o < 0.5R |
| `next_swing` | `fallback_rr` (1.0-5.0) | TP en ultimo swing contrario. Fallback a R:R si < 0.5R |
| `atr_multiple` | `atr_multiplier` (1.0-10.0) | TP a N x ATR(14) del entry |
| `fixed_pct` | `fixed_pct` (0.5-10.0) | TP a porcentaje fijo del entry |

**Otros parametros de riesgo:**

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `max_trades_per_segment` | 1-10 | 1 | Maximo de trades por segmento VP o fuente de nivel (misma direccion) |
| `cooldown_bars` | 0-500 | 0 | Velas de espera GLOBAL despues de abrir un trade. 0=desactivado |

### Bloque 5: Exit Rules (4 tipos, OR logic)

Cierran el trade ANTES de alcanzar SL o TP. Basta con que UNA regla se active.

| Regla | Parametros | Logica |
|-------|-----------|--------|
| `vwap_reverse` | `lookback` (3-30) | Cierra si VWAP gira en contra (LONG: VWAP actual < VWAP hace N velas) |
| `reenter_zone` | ninguno | Cierra si precio vuelve al nivel de la senal (LONG: cierra debajo del nivel) |
| `squeeze_activate` | ninguno | Cierra si se activa nuevo TTM Squeeze mientras trade abierto |
| `timeout` | `max_bars` (10-500) | Cierra despues de N velas sin alcanzar TP ni SL |

## Confluencia Multi-Source

| Modo | Descripcion |
|------|-------------|
| `any` | Cualquier nivel individual puede disparar entrada |
| `score` | Score = min(100, fuentes_unicas_cerca * 15). Requiere min_confluence_score. 2 fuentes = 30 pts, 3 fuentes = 45 pts |

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/strategy-builder/backtest-stream` | POST (SSE) | Backtest con progreso en tiempo real. Config va en body JSON, respuesta es SSE stream leido con fetch+ReadableStream (no EventSource) |
| `/api/strategy-builder/optimize-estimate` | POST | Estima tiempo del grid search (ejecuta 2 combos de prueba) |
| `/api/strategy-builder/optimize` | POST | Grid search completo en thread pool |

### Formato SSE del Backtest

```
data: {"type": "progress", "phase": "fetching", "percent": 0, "message": "Descargando..."}
data: {"type": "progress", "phase": "indicators", "percent": 10, "message": "Calculando VP..."}
data: {"type": "progress", "phase": "backtest", "percent": 50, "message": "Vela 500/1000..."}
data: {"type": "result", "data": {trades, zones, metrics, filter_stats, ...}}
```

## Estructura de Config (JSON)

```json
{
  "level_sources": [
    {"source": "vp_periodic", "enabled": true, "params": {"period": 240, "bins": 50}},
    {"source": "vp_zones", "enabled": false, "params": {"detection_mode": "fixed_window", "window_size": 30}}
  ],
  "entry_signal": {
    "signal_type": "price_touch",
    "params": {"tolerance_pct": 0.15}
  },
  "context_filters": [
    {"filter_type": "direction", "enabled": true, "params": {"allowed": "both"}},
    {"filter_type": "vp_shape", "enabled": false, "params": {"allowed_shapes": ["all"]}}
  ],
  "risk": {
    "sl_method": "below_level", "sl_params": {"buffer_pct": 0.1},
    "tp_method": "rr_fixed", "tp_params": {"rr": 2.0},
    "max_trades_per_segment": 1,
    "cooldown_bars": 0
  },
  "exit_rules": [],
  "confluence_mode": "any",
  "min_confluence_score": 0,
  "vwap_period": 20
}
```

## Cache de Velas (Persistencia en Disco)

El sistema usa 3 niveles de cache para evitar descargar velas repetidamente:

1. **Memoria** (Dict Python, TTL 2h): Acceso instantaneo, se pierde al reiniciar
2. **Disco** (`candle_cache/*.json.gz`): Persistente, gzip comprimido, sobrevive reinicios
3. **Bybit API**: Descarga completa, hasta 600,000 velas por request

**Flujo:** Primera ejecucion descarga de Bybit (1-2 min). Siguientes ejecuciones leen de disco (~1-2s) o memoria (instantaneo). Carga incremental cuando faltan solo velas recientes.

**VP Zone Cache:** Cache separado en `zones_cache/` para zonas VP pre-calculadas. Evita recalcular zonas con los mismos parametros.

## Sistema de Presets

Los presets guardan toda la configuracion del Strategy Builder (5 bloques + parametros generales).

- **Backend-based:** Se persisten via API (no localStorage)
- **Guardar:** Nombre + click "Guardar"
- **Cargar:** Dropdown → "Cargar" → todos los bloques se restauran
- **Eliminar:** Boton X al lado del preset

## Diagnostico con Filter Stats

El backtest retorna `filter_stats` que muestra donde se filtraron las senales:

| Contador | Significado |
|----------|-------------|
| `signals_generated` | Total de senales detectadas (antes de filtros) |
| `filtered_direction` | Bloqueadas por filtro de direccion |
| `filtered_confluence` | Score de confluencia insuficiente |
| `filtered_max_trades_seg` | Bloqueadas por max_trades_per_segment |
| `filtered_cooldown` | Bloqueadas por cooldown_bars activo |
| `filtered_context.{tipo}` | Bloqueadas por cada filtro de contexto especifico |
| `filtered_sl_invalid` | SL no se pudo calcular |
| `filtered_tp_invalid` | TP no se pudo calcular |
| `filtered_sl_direction` | SL calculado en direccion incorrecta |
| `trades_opened` | Trades que pasaron TODOS los filtros |

## Visualizacion en Chart

Las zonas del Strategy Builder se renderizan con colores purpura (`_source: 'strategy'`):

| Elemento | Color |
|----------|-------|
| Consolidacion fill | `rgba(128, 0, 200, 0.15)` |
| Consolidacion border | `rgba(128, 0, 200, 0.6)` |
| Trade WIN | Verde |
| Trade LOSS | Rojo |
| Trade OPEN | Amarillo, borde discontinuo |

ZoneVisualizerIndicator mantiene 4 fuentes independientes:
- `_manualZones` - Boton "Detectar zonas"
- `_realtimeZones` - Polling realtime
- `_vpZones` - VP Periodic Backtest
- `_strategyZones` - Strategy Builder

## Grid Search Optimizer

Parametros optimizables se generan dinamicamente segun bloques activos. Formato path-based:

```
level.vp_periodic.period, level.vp_periodic.bins, level.sr_v2.swing_bars,
entry.params.tolerance_pct, risk.sl_params.buffer_pct, risk.tp_params.rr,
vwap_period, (cualquier parametro numerico de bloque activo)
```

**Flujo:** Estimar (2 combos prueba) → Confirmar → Ejecutar → Tabla Top 15 → "Aplicar"

**Limites:** Max 5,000 combinaciones, max 20 valores por parametro. Timeout 60 min.

**Metricas:** expectancy, total_pnl_r, win_rate, profit_factor.

## Dias de Historico

| Intervalo | Max dias |
|-----------|----------|
| 1 min | 400 |
| 3 min | 400 |
| 5 min | 400 |
| 15 min | 180 |
| 30 min | 360 |
| 1 hora | 730 |
| 2 horas | 730 |
| 4 horas | 1095 |
| Diario | 2000 |
| Semanal | 1000 |

## Arquitectura Tecnica

### Backend: strategy_engine.py (~2091 lineas)

```
run_modular_backtest(candles, config, progress_callback, symbol, interval, days)
    |
    ├── compute_vp_levels()           # VP Periodic
    ├── compute_vp_zone_levels()      # VP Zones (con cache disco)
    ├── compute_sr_levels()           # S&R v2
    ├── compute_vwap_band_levels()    # VWAP Bands
    ├── compute_swing_as_levels()     # Swing Levels
    ├── compute_dtb_levels()          # DTB Neckline
    |
    ├── Para cada vela:
    |   ├── Filtrar niveles validos en este indice
    |   ├── Evaluar entry signal -> genera senal con direccion
    |   ├── Filtrar por direction, confluence, max_trades, cooldown
    |   ├── Aplicar context filters (AND logic, incluyendo vp_shape)
    |   ├── Calcular SL y TP
    |   └── Si todo pasa: abrir trade
    |
    ├── resolve_trade_with_exit_rules()  # Simular cada trade
    ├── calculate_metrics()              # Metricas finales
    └── Construir zonas para chart
```

### Frontend: StrategyBuilder.jsx (~2063 lineas)

```
StrategyBuilder.handleRunBacktest()
    |
    ├── buildConfigPayload(state)  # ~30 useState hooks -> JSON config
    |
    ├── manager.runStrategyBuilderBacktest({days, config, onProgress})
    |   └── fetch POST /api/strategy-builder/backtest-stream (config en body JSON)
    |       → response.body.getReader() + TextDecoder (ReadableStream)
    |       ├── progress events -> setProgress({phase, percent, message})
    |       └── result event -> setResult({zones, stats, filter_stats})
    |   (NO usa EventSource - evita limite de 6 conexiones de Chromium)
    |
    └── manager.zoneVisualizerIndicator.setStrategyZones(zones)
```

## Bugs Corregidos (Febrero 2026)

1. **`resolve_trade` no existia** - Fix: reutilizar `resolve_trade_with_exit_rules()` con lista vacia.
2. **Zona visual min/max incorrectos para SHORT** - Fix: `min(sl, tp, entry)` y `max(sl, tp, entry)`.

## Troubleshooting

**Strategy Builder no abre:**
- Verificar que el boton purpura "Strategy" aparece junto a "VP Backtest"
- Verificar que `StrategyBuilder.jsx` se importa en `SingleSymbolAnalyzer.jsx`

**Backtest retorna 0 trades:**
- Verificar que al menos 1 Level Source esta activado
- Reducir tolerancia del entry signal
- Probar sin context filters primero
- Aumentar dias de datos historicos
- Revisar `filter_stats` para ver donde se pierden senales

**Backtest tarda mucho:**
- Primera ejecucion descarga de Bybit (1-2 min). Siguientes usan cache disco (instantaneo)
- VP Zones es pesado - considerar VP Periodic
- Reducir dias para iteraciones rapidas

**Zonas no se ven en chart:**
- Verificar que ZoneVisualizerIndicator esta habilitado
- Las zonas usan `_source: 'strategy'` (purpura)
- Verificar `setStrategyZones()` se llama con las zonas del resultado

---

# STRATEGY BUILDER REALTIME SERVICE (Febrero 2026)

Servicio de ejecucion en tiempo real de estrategias del Strategy Builder. Permite que el usuario active una estrategia configurada y la ejecute en vivo, generando alertas al TradingBot cuando se detectan senales validas.

## Concepto y Diferencia con Backtest

| Aspecto | Backtest (SSE) | Realtime Service |
|---------|---------------|------------------|
| Ejecucion | Unica, sobre historico | Continua, vela a vela |
| Niveles | Se calculan sobre todo el dataset | Se pre-calculan una vez y se extienden incrementalmente |
| SL/TP | Se resuelve con lookforward (mira futuro) | Se monitorea vela a vela (no mira futuro) |
| Alertas | No envia | Envia al TradingBot (puerto 5000) |
| UI | Boton "Run Backtest" | Toggle "Realtime" ON/OFF |

## Principio Arquitectonico

**Los niveles NO se re-detectan en cada vela.** Se pre-calculan al activar y se extienden incrementalmente solo cuando corresponde:

| Fuente de Niveles | Cuando se Recalcula |
|-------------------|---------------------|
| `vp_periodic` | Al completarse un nuevo segmento (cada `period` velas) |
| `sr_v2` | Cada N velas (`sr_recalc_every`, default 100) |
| `vwap_bands` | Cada vela (VWAP es dinamico por naturaleza) |
| `swing_levels` | Cada N velas con check de confirmacion |
| `dtb_neckline` | Cada N velas (`dtb_recalc_every`, default 50) |
| `vp_zones` | Al completarse un nuevo segmento VP (usa cache de VP Zone) |

La evaluacion de senales es O(L) por vela, donde L = numero de niveles activos.

## Archivos del Sistema

### Backend (`4.Analizador cripto/backend/`)

| Archivo | Descripcion |
|---------|-------------|
| `strategy_realtime_service.py` | Servicio completo (~1317 lineas): config, niveles, senales, trades, alertas |
| `config/strategy_rt_config.json` | Configuracion persistente del servicio |
| `logs/strategy_rt_alerts.log` | Log de alertas enviadas/bloqueadas |
| `main.py` (lineas 9530+) | 6 endpoints API para el servicio realtime |

### Frontend (`8.AnalizadorDesktop/src/components/`)

| Archivo | Descripcion |
|---------|-------------|
| `StrategyBuilder.jsx` | UI: boton "Realtime", panel de estado, toggle, stats |

## Clases y Estructura

### StrategyRTConfig

```python
@dataclass
class StrategyRTConfig:
    enabled: bool = False
    symbols: List[str] = ["BTCUSDT"]
    interval: str = "5"
    window_candles: int = 2000          # Historico para calcular niveles
    strategy: Dict = {}                 # Mismo formato que Strategy Builder config
    alertsEnabled: bool = True
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
    cooldownMinutes: int = 30
    dtb_recalc_every: int = 50          # Re-detectar DTB cada N velas
    sr_recalc_every: int = 100          # Re-detectar S&R cada N velas
```

### RTLevel

```python
@dataclass
class RTLevel:
    price: float
    level_type: str       # 'support' | 'resistance'
    source: str           # 'vp_periodic' | 'sr_v2' | 'vwap_bands' | 'swing_levels' | 'dtb_neckline' | 'vp_zones'
    strength: float = 1.0
    valid_from_idx: int = 0
    valid_until_idx: Optional[int] = None
    extra: Dict = {}
```

### StrategyRealtimeService (Singleton)

```python
class StrategyRealtimeService:
    # Estado interno por simbolo:
    _candle_buffers: Dict[str, List[Dict]]     # Buffer de velas
    _levels: Dict[str, List[RTLevel]]          # Niveles pre-calculados
    _vwap_state: Dict[str, Dict]               # Estado VWAP rolling
    _dtb_patterns: Dict[str, List[Dict]]       # Patrones DTB detectados
    _open_trades: Dict[str, List[Dict]]        # Trades abiertos
    _trade_history: Dict[str, List[Dict]]      # Historial de trades cerrados
    _cooldowns: Dict[str, float]               # Cooldowns activos
    _recent_signals: Dict[str, List[Dict]]     # Senales para polling frontend

    # Contadores para recalculo periodico:
    _candle_count: Dict[str, int]
    _last_vp_seg_end: Dict[str, int]
    _last_sr_recalc: Dict[str, int]
    _last_dtb_recalc: Dict[str, int]
    _last_swing_check: Dict[str, int]
```

## Flujo Completo

```
1. ACTIVACION (desde StrategyBuilder.jsx)
   POST /api/strategy-builder/realtime/toggle {enabled: true, strategy: {...}, symbols: [...]}
      ↓
2. STARTUP
   StrategyRealtimeService.start()
   → Registra listener en WebSocket (add_candle_close_listener)
   → Suscribe simbolos al WebSocket
   → asyncio.create_task(_initialize())
      ↓
3. INICIALIZACION (background, una vez)
   _initialize() → para cada simbolo:
      _init_symbol()
        → Fetch historico desde Bybit API (window_candles velas)
        → Preload al buffer del WebSocket
        → _precompute_levels() → calcula TODOS los niveles del historico
      ↓
4. POR CADA CIERRE DE VELA (tiempo real)
   _sync_candle_close_handler() → _on_candle_close()
      ↓
   a) Agrega vela al buffer
   b) _update_levels_incremental() → recalcula solo lo necesario
   c) _check_open_trades() → verifica SL/TP hit vela a vela
   d) _check_exit_rules() → evalua reglas de salida adaptativas
   e) _evaluate_entry() → evalua senal de entrada contra niveles activos
      ↓
5. SI HAY SENAL VALIDA
   → Calcula SL/TP segun risk management configurado
   → Verifica cooldown (por symbol + direction)
   → Abre trade → _send_alert() al TradingBot (puerto 5000)
      ↓
6. MONITOREO DE TRADES
   En cada vela subsecuente:
   → _check_open_trades(): SL hit? TP hit? → cierra trade
   → _check_exit_rules(): timeout? vwap_reverse? → cierra trade anticipadamente
```

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/strategy-builder/realtime/toggle` | POST | Activa/desactiva servicio. Acepta strategy, symbols, interval, alertsEnabled, cooldownMinutes |
| `/api/strategy-builder/realtime/status` | GET | Estado completo: running, stats, open trades, niveles activos, buffers |
| `/api/strategy-builder/realtime/config` | POST | Actualiza config. Si strategy cambio, reinicia servicio automaticamente |
| `/api/strategy-builder/realtime/signals/{symbol}` | GET | Senales recientes para un simbolo |
| `/api/strategy-builder/realtime/trades/{symbol}` | GET | Trades abiertos y historial (ultimos 50) |
| `/api/strategy-builder/realtime/clear-cooldowns` | POST | Limpia todos los cooldowns (para testing) |

## Formato de Respuesta de Status

```json
{
  "success": true,
  "running": true,
  "enabled": true,
  "symbols": ["BTCUSDT"],
  "interval": "5",
  "alertsEnabled": true,
  "strategy_name": "Mi Estrategia",
  "stats": {
    "candles_processed": 150,
    "signals_generated": 5,
    "signals_filtered": 3,
    "alerts_sent": 2,
    "alerts_blocked_cooldown": 1,
    "trades_opened": 2,
    "trades_closed": 1,
    "start_time": 1708000000
  },
  "open_trades": {
    "BTCUSDT": [{
      "direction": "LONG",
      "entry_price": 95000.0,
      "sl_price": 94500.0,
      "tp_price": 96000.0,
      "partial_pnl_r": 0.5,
      "entry_ts": 1708001000000
    }]
  },
  "levels": {
    "BTCUSDT": { "total": 45, "active": 12 }
  },
  "buffers": {
    "BTCUSDT": 2150
  }
}
```

## Formato de Alerta al TradingBot

```json
{
  "source": "STRATEGY_BUILDER",
  "symbol": "BTCUSDT",
  "interval": "5",
  "pattern": {
    "patternType": "STRATEGY_SIGNAL",
    "price": 95000.0,
    "confidence": 75,
    "timestamp": 1708001000000,
    "direction": "LONG",
    "signalType": "price_touch",
    "levelSource": "vp_periodic",
    "levelPrice": 95050.0
  },
  "custom_stop_loss": 94500.0,
  "custom_take_profit": 96000.0
}
```

## Metodos Clave del Servicio

### Pre-calculo de Niveles

```python
def _precompute_levels(self, symbol: str):
    """
    Calcula TODOS los niveles a partir del historico.
    Se ejecuta UNA VEZ al iniciar el servicio.
    Soporta las 6 fuentes de niveles del Strategy Builder.
    """
```

### Actualizacion Incremental

```python
def _update_levels_incremental(self, symbol: str, new_candle: Dict):
    """
    Actualiza niveles SOLO cuando es necesario:
    - VP Periodic: nuevo segmento completado (cada 'period' velas)
    - SR v2: cada sr_recalc_every velas
    - VWAP bands: cada vela (recalcula VWAP y bandas sigma)
    - Swing levels: cada N velas (check confirmacion)
    - DTB neckline: cada dtb_recalc_every velas
    - VP Zones: cuando hay nuevo segmento VP (usa cache)
    """
```

### Evaluacion de Entrada

```python
async def _evaluate_entry(self, symbol: str, candle: Dict, idx: int):
    """
    Evalua si la vela actual genera una senal de entrada.
    1. Obtiene niveles activos para el indice actual
    2. Evalua senal (price_touch, breakout_close, etc.) contra cada nivel
    3. Aplica filtros de contexto (VWAP trend, TTM squeeze, etc.)
    4. Si pasa: calcula SL/TP, verifica cooldown, abre trade
    """
```

### Monitoreo de Trades

```python
def _check_open_trades(self, symbol: str, candle: Dict):
    """
    Verifica SL/TP hit para trades abiertos.
    Evalua HIGH y LOW de la vela contra SL y TP del trade.
    Si SL hit: cierra con PnL negativo.
    Si TP hit: cierra con PnL positivo.
    """

def _check_exit_rules(self, symbol: str, candle: Dict, idx: int):
    """
    Evalua reglas de salida adaptativas (OR logic):
    - vwap_reverse: precio cruza VWAP en contra
    - reenter_zone: precio re-entra a la zona del nivel
    - squeeze_activate: nuevo TTM Squeeze se activa
    - timeout: han pasado N velas desde la entrada
    """
```

## Sistema de Cooldowns

- Cooldowns separados por `{symbol}_{direction}` (ej: `BTCUSDT_LONG`, `BTCUSDT_SHORT`)
- Configurable en minutos desde el panel o la API
- Se puede limpiar manualmente via endpoint o boton en UI
- Los cooldowns son in-memory (no se persisten al reiniciar)

## Integracion con el Frontend (StrategyBuilder.jsx)

### Estado React

```javascript
const [showRealtime, setShowRealtime] = useState(false);
const [rtStatus, setRtStatus] = useState(null);
const [rtLoading, setRtLoading] = useState(false);
const rtPollRef = useRef(null);
```

### Polling de Estado

Cuando el panel Realtime esta abierto, se hace polling cada 5 segundos:

```javascript
useEffect(() => {
  if (!isOpen || !showRealtime) return;
  fetchRtStatus();
  rtPollRef.current = setInterval(fetchRtStatus, 5000);
  return () => clearInterval(rtPollRef.current);
}, [isOpen, showRealtime]);
```

### Toggle Realtime

Al activar, envia la estrategia actual (construida con `buildConfigPayload()`) junto con el simbolo e intervalo activos:

```javascript
const handleToggleRealtime = async () => {
  const body = { enabled: !isRunning };
  if (!isRunning) {
    body.strategy = buildConfigPayload();
    body.symbols = [symbol];
    body.interval = interval;
  }
  await fetch(`/api/strategy-builder/realtime/toggle`, { method: 'POST', body });
};
```

### Panel de Realtime

El panel muestra cuando esta activo:
- **Stats grid**: Velas procesadas, senales generadas, senales filtradas, alertas enviadas
- **Niveles por simbolo**: Total y activos
- **Trades abiertos**: Entry, SL, TP, PnL parcial (en R) con colores verde/rojo
- **Uptime**: Tiempo desde el inicio del servicio
- **Boton "Limpiar Cooldowns"**: Para testing

Cuando no esta activo muestra mensaje informativo con instrucciones.

### Boton en la Barra de Acciones

- Color naranja cuando el servicio esta detenido
- Color verde cuando esta corriendo
- Texto "RT ON" cuando activo, "Realtime" cuando inactivo

## Archivos de Log

### `logs/strategy_rt_alerts.log`

```
2026-02-16 15:30:45 | INFO | SIGNAL | BTCUSDT | LONG | price_touch @ vp_periodic:95000.00 | idx=2150
2026-02-16 15:30:45 | INFO | ALERT_SENT | BTCUSDT | LONG | entry=95000.00 sl=94500.00 tp=96000.00
2026-02-16 15:35:22 | INFO | BLOCKED_COOLDOWN | BTCUSDT | LONG | remaining=1478s
2026-02-16 15:40:00 | INFO | TRADE_CLOSED | BTCUSDT | TP_HIT | pnl_r=2.0
2026-02-16 15:40:00 | ERROR | ALERT_TIMEOUT | BTCUSDT | Trading Bot not responding
```

## Integracion con Startup/Shutdown del Backend

```python
# En main.py - startup_event()
strat_rt = get_strategy_rt_service()
if strat_rt.config.enabled:
    await strat_rt.start()

# En main.py - shutdown_event()
strat_rt = get_strategy_rt_service()
await strat_rt.stop()
```

## Troubleshooting

**Servicio no inicia:**
- Verificar que hay una estrategia configurada (`strategy` no vacio en config)
- Verificar que WebSocket Manager esta disponible
- Revisar logs backend por `[STRAT_RT]`

**0 senales generadas:**
- Verificar que los niveles se pre-calcularon: status muestra `levels.total > 0`
- Verificar que la senal de entrada coincide con los niveles activos
- Probar con tolerancia mas amplia en el entry signal
- Verificar que los filtros de contexto no estan bloqueando todas las senales

**Alertas no llegan al TradingBot:**
- Verificar `alertsEnabled: true` en config
- Verificar que TradingBot corre en puerto 5000
- Revisar `logs/strategy_rt_alerts.log` por errores TIMEOUT
- Verificar cooldowns: puede estar bloqueado

**Niveles no se actualizan:**
- El servicio actualiza niveles incrementalmente, no en cada vela
- VP Periodic: solo cuando se completa un nuevo segmento
- SR v2: cada `sr_recalc_every` velas (default 100)
- Verificar contadores en logs

**Stats muestran "signals_filtered" alto:**
- Los filtros de contexto estan bloqueando senales
- Desactivar filtros temporalmente para diagnosticar
- Revisar que la direccion del filtro coincide con la senal

**Config se pierde al reiniciar:**
- Config se persiste en `config/strategy_rt_config.json`
- Si el archivo no existe, se usan defaults (enabled=false)
- Verificar permisos de escritura en el directorio config/

---

# FIX: SEGUNDO BACKTEST BLOQUEA LA APP (Febrero 2026)

## Problema

El primer backtest del Strategy Builder se ejecutaba correctamente (~12.9s), pero al intentar un segundo backtest la aplicacion se congelaba completamente.

## Causa Raiz

**Cascada de fallos** que se acumulaban despues del primer backtest:

1. **Servicios no deseados corriendo**: Strategy RT y Real-time Pattern Detection auto-iniciaban en startup, procesando cada vela y consumiendo recursos del event loop
2. **Polling de drawings cada 3s**: Inundaba el backend con `GET /api/drawings/BTCUSDT` constantemente (10+ requests/segundo en momentos pico)
3. **VWAP reload sin cooldown**: Despues del primer backtest, el endpoint VWAP detectaba `needs_more_data` y disparaba `reload_symbol_data()` en cada polling, cada uno haciendo request a Bybit API, causando rate limit
4. **Fetches VWAP concurrentes**: Sin guard contra solapamiento, multiples fetches del frontend llegaban al backend simultaneamente, amplificando el rate limit

### Secuencia del bloqueo

```
Primer backtest completa OK
    ↓
VWAP polling detecta needs_more_data → multiples reloads simultaneos
    ↓
Bybit API: "Too many visits. Exceeded the API Rate Limit"
    ↓
VWAP fetch errors → frontend reintenta en siguiente poll → mas errors
    ↓
Drawings polling cada 3s agrega carga constante
    ↓
Strategy RT procesando cada vela agrega mas carga
    ↓
Event loop saturado → segundo backtest no puede conectar SSE
    ↓
App congelada
```

## Fixes Aplicados

### 1. Drawings polling 3s → 30s

**Archivo:** `8.AnalizadorDesktop/src/components/MiniChart.jsx`

```javascript
// ANTES: 3000ms (3 segundos)
// DESPUES: 30000ms (30 segundos) - suficiente para sincronizacion
const syncInterval = setInterval(() => {
  if (!drawingMode) {
    loadDrawings(true);
  }
}, 30000);
```

### 2. VWAP reload cooldown (30s por simbolo)

**Archivo:** `4.Analizador cripto/backend/main.py`

```python
_vwap_reload_cooldown: Dict[str, float] = {}
_VWAP_RELOAD_COOLDOWN_SECS = 30

@app.get("/api/vwap-service/data/{symbol}")
async def get_vwap_service_data(...):
    if config_changed or needs_more_data:
        now = time.time()
        last_reload = _vwap_reload_cooldown.get(symbol, 0)
        if now - last_reload < _VWAP_RELOAD_COOLDOWN_SECS:
            pass  # En cooldown - retornar datos existentes
        else:
            _vwap_reload_cooldown[symbol] = now
            await vwap_service.reload_symbol_data(...)
```

### 3. Guard contra VWAP fetches concurrentes

**Archivo:** `8.AnalizadorDesktop/src/components/indicators/VWAPIndicator.js`

```javascript
constructor() {
  this._fetching = false;
}

async fetchData(skipCache = false) {
  if (this._fetching) return false;  // Skip si ya hay fetch en curso
  this._fetching = true;
  try {
    // ... fetch ...
  } finally {
    this._fetching = false;
  }
}
```

### 4. Servicios desactivados en startup (sesion anterior)

**Archivo:** `4.Analizador cripto/backend/main.py` (startup_event)

- Real-time pattern service: SKIPPED (deprecated)
- Strategy RT service: force `enabled=false` en startup, debe iniciarse manualmente desde frontend

**CRITICO:** El backend debe reiniciarse para que estos cambios tomen efecto.

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `8.AnalizadorDesktop/src/components/MiniChart.jsx` | Drawings polling 3s → 30s |
| `4.Analizador cripto/backend/main.py` | VWAP reload cooldown 30s, cleanup import |
| `8.AnalizadorDesktop/src/components/indicators/VWAPIndicator.js` | `_fetching` guard |

## Leccion Aprendida

**Cascadas de rate limit**: Un solo endpoint sin cooldown puede causar una cascada que bloquea toda la aplicacion. Siempre agregar cooldowns a endpoints que llaman APIs externas (Bybit) y guards contra requests concurrentes en el frontend.

**Reiniciar backend**: Los cambios en `main.py` no toman efecto hasta reiniciar el proceso de uvicorn. Si el log muestra servicios que deberian estar desactivados, el backend NO fue reiniciado.

---

# FIX: RESULTADOS DE BACKTEST NO DETERMINISTICOS (Febrero 2026)

## Problema

El Strategy Builder producia resultados diferentes con los mismos parametros. Ejecutar un backtest con parametros A, cambiar a B, y volver a A daba resultados distintos (ej: 30% win rate → 12% win rate). El cambio afectaba TODOS los trades, no solo los ultimos.

## Causa Raiz

**Cascada de 3 factores** que hacian que el array de velas cambiara de tamano entre ejecuciones:

### Factor 1: Cache incremental de velas

El sistema de cache de 3 niveles (memoria → disco → Bybit API) usaba merge incremental. Despues de la primera ejecucion, el cache en memoria podia tener 5-10 velas extras respecto a la descarga original. Esto cambiaba `len(candles)`.

### Factor 2: VP Periodic sensible a indices

VP Periodic usa `range(0, len(candles), period)` para crear segmentos. Si `len(candles)` cambia, TODOS los segmentos se desplazan. Esto cambia las zonas POC/VAH/VAL y por lo tanto los niveles para TODAS las entradas.

```python
# Con 57600 velas y period=240:
# Segmentos: [0:240], [240:480], [480:720], ...

# Con 57605 velas (5 extras del cache):
# Segmentos: [0:240], [240:480], [480:720], ..., [57360:57605]
# ¡Pero si se trimea al 110%: candles[-target:] cambia indices base!
```

### Factor 3: VP Zone Cache sin candles_count

El fingerprint del cache de VP Zones no incluia la cantidad de velas. Dos ejecuciones con diferente `len(candles)` pero mismos parametros generaban el mismo fingerprint, retornando zonas calculadas con un array de tamano diferente.

## Fixes Implementados

### Fix 1: Trimming Determinista

**Archivos:** `4.Analizador cripto/backend/main.py` (3 endpoints)

Antes de pasar las velas al motor de backtest, se trimea al numero exacto calculado:

```python
# En backtest-stream, optimize-estimate, optimize
_int_minutes = interval_min_map.get(interval, 1)
_target_candles = int((int(days) * 24 * 60) / _int_minutes)
if _target_candles > 0 and len(candles) > _target_candles:
    candles = candles[-_target_candles:]
```

Esto garantiza que sin importar cuantas velas tenga el cache, siempre se usan exactamente las mismas.

### Fix 2: candles_count en Fingerprint VP Zone Cache

**Archivos:** `4.Analizador cripto/backend/zone_vp_scanner.py`

Se agrego `candles_count` al fingerprint SHA256 del cache de zonas VP:

```python
def _get_detection_fingerprint(config_overrides, symbol, interval, days, candles_count=0):
    det_values['_candles_count'] = candles_count
    fingerprint_str = json.dumps(det_values, sort_keys=True, default=str)
    return hashlib.sha256(fingerprint_str.encode()).hexdigest()[:16]
```

Ahora `load_zone_cache` y `save_zone_cache` incluyen `candles_count`, invalidando caches cuando el array cambia de tamano.

### Fix 3: Hash Diagnostico en UI

**Archivos:** `main.py` (SSE result), `StrategyBuilder.jsx` (checkbox + badge)

Se calcula un hash MD5 del array de velas (len + first_ts + last_ts) y se muestra en la UI:

```python
import hashlib as _hl
_candle_hash = _hl.md5(f"{len(candles)}_{first_ts}_{last_ts}".encode()).hexdigest()[:8]
```

En el frontend, un checkbox "Mostrar hash de determinismo" muestra un badge purpura con el hash. Mismo hash = mismas velas = resultados identicos.

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `4.Analizador cripto/backend/main.py` | Trimming determinista en 3 endpoints SB + candle_hash en SSE result + candles_count en load_zone_cache VP |
| `4.Analizador cripto/backend/zone_vp_scanner.py` | candles_count en fingerprint, save_zone_cache, load_zone_cache |
| `4.Analizador cripto/backend/strategy_engine.py` | Pasa len(candles) a load_zone_cache en compute_vp_zone_levels |
| `8.AnalizadorDesktop/src/components/StrategyBuilder.jsx` | Estado showDebugHash, checkbox, badge hash purpura |

## Limpieza de Cache

Despues de aplicar el fix, los archivos viejos en `zones_cache/` tienen fingerprints sin `candles_count` y nunca haran match. Se eliminaron ~31 archivos (~5MB) de `zones_cache/` y `zones_cache/incremental/`.

## Verificacion

1. Ejecutar backtest con parametros A → anotar hash (ej: `#c9a8cc6a`)
2. Cambiar parametros a B → ejecutar
3. Volver a parametros A → ejecutar
4. Verificar que hash es identico al paso 1
5. Verificar que metricas (WR%, PnL, trades) son identicas

## Leccion Aprendida

**Indices como estado global**: Cuando un sistema usa indices de array como referencia (como `valid_from_idx` en Level dataclass), el tamano del array se convierte en estado global implicito. Cualquier variacion en el tamano del array desplaza TODAS las referencias, causando resultados completamente diferentes. La solucion es garantizar un tamano de array determinista ANTES de cualquier procesamiento.

---

# FIX: CHART FLIP BUG EN BACKTESTER (Octubre 2026)

## Problema

Al hacer click o drag sobre el chart del backtester durante el playback, el grafico se "volteaba" mostrando velas historicas antiguas y ocultando las barras recientes del punto de playback, haciendo imposible analizar el grafico.

## Causa Raiz

Inconsistencia entre la fuente de datos para calcular offset y la fuente de datos para renderizar en `handleMouseMove` de `MiniChart.jsx`.

**Antes del fix:**
- `maxOffset` se calculaba con `allCandlesRef` (~4380 velas historicas)
- `drawChart()` recibia `allCandlesRef`
- Pero el offset almacenado estaba dimensionado para `candlesRef` (~500 velas de playback)

La formula `startIdx = displayCandles.length - candlesPerScreen - offset` producia indices incorrectos cuando `displayCandles.length` saltaba de ~500 a ~4380.

## Fix

**Archivo:** `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/MiniChart.jsx`

Linea 1350 - maxOffset durante drag:
```javascript
// ANTES: usaba allCandlesRef → offset excedia velas disponibles
const sourceForMax = backtestingMode && allCandlesRef.current ? allCandlesRef.current : candlesRef.current;
const maxOffset = Math.max(0, sourceForMax.length - candlesPerScreen);

// DESPUES: usa candlesRef consistentemente
const maxOffset = Math.max(0, candlesRef.current.length - candlesPerScreen);
```

Linea 1362 - drawChart durante drag:
```javascript
// ANTES: pasaba allCandlesRef → displayCandles.length saltaba a ~4380
const candlesToDraw = backtestingMode && allCandlesRef.current ? allCandlesRef.current : candlesRef.current;
drawChart(candlesToDraw, lastPriceRef.current, null, null);

// DESPUES: pasa candlesRef → displayCandles.length consistente con offset
drawChart(candlesRef.current, lastPriceRef.current, null, null);
```

**Nota:** `centerOnTimestamp` (navegacion a zonas) y `renderOverlays` (indicadores) siguen usando `allCandlesRef` correctamente - son casos de uso diferentes donde se necesita acceso al historial completo.

## Leccion Aprendida

**Consistencia de fuentes de datos en formulas de offset**: Cuando una formula usa `array.length` para calcular indices, TODAS las partes del flujo (calculo de offset, calculo de maxOffset, y el array pasado a la funcion de render) deben usar el MISMO array. Mezclar arrays de diferente tamano causa saltos en los indices calculados.

---

# EXPANSION A 5 ANOS DE DATOS - BACKTESTER (Octubre 2026)

El Backtester fue expandido de 2-3 anos a 5 anos de datos historicos para timeframes grandes, con cache gzip y carga incremental.

## Limites por Timeframe

| Timeframe | Antes | Ahora | Velas aproximadas |
|-----------|-------|-------|-------------------|
| 1m | 365 dias (1 ano) | 730 dias (2 anos) | ~1,051,200 |
| 5m | 1095 dias (3 anos) | 730 dias (2 anos) | ~210,240 |
| 15m | 730 dias (2 anos) | 1825 dias (5 anos) | ~175,200 |
| 1h | 730 dias (2 anos) | 1825 dias (5 anos) | ~43,800 |
| 4h | 730 dias (2 anos) | 1825 dias (5 anos) | ~10,950 |

## Configuracion Actualizada

```python
MAX_DAYS_BY_INTERVAL = {
    "1": 730, "3": 10, "5": 730, "15": 1825, "30": 1825,
    "60": 1825, "120": 1825, "240": 1825, "D": 1825, "W": 1825
}

BACKTESTING_CONFIG = {
    "1m": {"interval": "1", "days": 730, "subdivisions": {"interval": "1", "count": 1, "days": 730}},
    "5m": {"interval": "5", "days": 730, "subdivisions": {"interval": "1", "count": 5, "days": 730}},
    "15m": {"interval": "15", "days": 1825, "subdivisions": {"interval": "5", "count": 3, "days": 1825}},
    "1h": {"interval": "60", "days": 1825, "subdivisions": {"interval": "15", "count": 4, "days": 1825}},
    "4h": {"interval": "240", "days": 1825, "subdivisions": {"interval": "60", "count": 4, "days": 1825}}
}
```

## Cache Gzip

Los archivos de cache del backtester se comprimen con gzip (~90% reduccion de tamano):

```python
# Guardar cache comprimido
cache_file = BACKTESTING_CACHE_DIR / f"{symbol}_{interval}.json.gz"
with gzip.open(cache_file, 'wt', encoding='utf-8', compresslevel=6) as f:
    json.dump(candles, f)

# Leer cache comprimido
with gzip.open(cache_file, 'rt', encoding='utf-8') as f:
    candles = json.load(f)
```

**Ejemplo de compresion:**
- BTCUSDT 4h sin comprimir: ~15 MB
- BTCUSDT 4h con gzip: ~1.5 MB

## Carga Incremental

Si el cache existe pero tiene menos dias de los configurados, solo descarga las velas faltantes:

```python
if cached_candles:
    last_cached_ts = cached_candles[-1]['timestamp']
    # Solo descarga desde last_cached_ts hasta ahora
    new_candles = await fetch_from_bybit(symbol, interval, start=last_cached_ts)
    all_candles = cached_candles + new_candles
```

## Auto-deteccion de Cache Incompleto

Si el cache tiene menos dias de los configurados (ej: 730 dias cacheados pero 1825 configurados), detecta automaticamente que necesita re-descargar:

```python
configured_days = tf_config['days']  # 1825
cached_days = (now - first_cached_ts) / (24 * 3600 * 1000)
if cached_days < configured_days * 0.95:
    # Re-descargar completo
```

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `Backtester/backend/main.py` | MAX_DAYS_BY_INTERVAL, BACKTESTING_CONFIG, cache gzip, carga incremental |
| `Backtester/frontend/src/components/backtesting/BacktestingApp.jsx` | Nuevos limites, fecha inicio dinamica |
| `Backtester/frontend/src/components/backtesting/TimeframeTabs.jsx` | 5 tabs con nuevos limites |

---

# VP FIXED RANGE DESDE RECTANGULOS - BACKTESTER (Octubre 2026)

Permite crear Volume Profile Fixed Range directamente desde rectangulos dibujados en el chart del backtester.

## Flujo de Uso

1. Usuario dibuja un rectangulo en el chart (herramienta de dibujo)
2. Abre el panel "VP Fixed Ranges"
3. Click "Seleccionar" para ver rectangulos disponibles
4. Click "Usar" en el rectangulo deseado
5. Se crea un VP Fixed Range con el rango temporal del rectangulo
6. El rectangulo puede borrarse sin afectar el VP creado

## Implementacion

En `FixedRangeProfilesManager.jsx`, los rectangulos del chart se reciben via prop `chartRectangles`:

```javascript
const handleCreateFromRect = (rect) => {
    onCreateProfile(rect.timeStart, rect.timeEnd, false, rect.id);
};
```

En `MiniChart.jsx`, se extraen los rectangulos del DrawingToolManager:

```javascript
const getChartRectangles = useCallback(() => {
    const shapes = drawingManagerRef.current?.shapes || drawingsRef.current || [];
    return shapes
        .filter(s => s.type === 'rectangle')
        .map(s => ({
            id: s.id,
            time1: s.startTime, time2: s.endTime,
            price1: s.startPrice, price2: s.endPrice,
            label: s.label || null
        }));
}, []);
```

## Archivos Modificados

| Archivo | Cambio |
|---------|--------|
| `Backtester/frontend/src/components/FixedRangeProfilesManager.jsx` | Seccion "Desde rectangulo del chart" con lista de rectangulos |
| `Backtester/frontend/src/components/MiniChart.jsx` | Extrae rectangulos del DrawingToolManager y los pasa como prop |

---

# FIX: DELETE KEY NO BORRABA SHAPES - DRAWING SYSTEM (Octubre 2026)

## Problema

Al seleccionar un shape (rectangulo, linea, etc.) con el mouse y presionar Delete, el shape no se borraba. La unica opcion era "Limpiar todo" que eliminaba todos los dibujos del timeframe.

## Causa Raiz

**Referencias obsoletas despues de loadShapes()**: El polling de dibujos (cada 30s) llama a `loadShapes()` que reemplaza todo el array `this.shapes` con nuevas instancias deserializadas. Cuando `this.selectedShape` apunta a una instancia del array anterior, `this.shapes.indexOf(this.selectedShape)` retorna -1 porque las instancias son objetos diferentes (aunque representen el mismo shape).

```
Flujo del bug:
1. Usuario selecciona rectangulo → selectedShape = instancia_A
2. Polling 30s → loadShapes() → shapes = [instancia_B, instancia_C, ...]
3. instancia_A ya no esta en el array (fue reemplazada por instancia_B)
4. Delete → indexOf(instancia_A) → -1 → no borra nada
```

## Fixes Aplicados

**Archivo:** `Backtester/frontend/src/components/drawing/DrawingToolManager.js`

### 1. deleteSelected() - Fallback por ID

```javascript
deleteSelected() {
    if (this.selectedShape) {
        let index = this.shapes.indexOf(this.selectedShape);
        // Fallback: buscar por ID si la referencia es obsoleta
        if (index === -1 && this.selectedShape.id) {
            index = this.shapes.findIndex(s => s.id === this.selectedShape.id);
        }
        if (index !== -1) {
            this.shapes.splice(index, 1);
            this.selectedShape = null;
            this.saveToHistory();
        }
    }
}
```

### 2. loadShapes() - Preservar seleccion

```javascript
loadShapes(shapesData) {
    const prevSelectedId = this.selectedShape?.id || null;
    this.shapes = shapesData.map(data => this.deserializeShape(data)).filter(shape => shape !== null);
    if (prevSelectedId) {
        this.selectedShape = this.shapes.find(s => s.id === prevSelectedId) || null;
    }
}
```

### 3. restoreFromHistory() - Preservar seleccion en undo/redo

```javascript
restoreFromHistory() {
    const prevSelectedId = this.selectedShape?.id || null;
    const state = this.history[this.historyIndex];
    this.shapes = state.map(data => this.deserializeShape(data));
    if (prevSelectedId) {
        this.selectedShape = this.shapes.find(s => s.id === prevSelectedId) || null;
    } else {
        this.selectedShape = null;
    }
}
```

## Leccion Aprendida

**Nunca comparar instancias de objetos despues de deserializacion**: Cuando un sistema serializa/deserializa objetos (como al guardar/cargar dibujos), las nuevas instancias son objetos completamente diferentes aunque tengan los mismos datos. Usar `indexOf()` con la referencia original falla. La solucion es siempre usar identificadores unicos (IDs) para buscar y comparar objetos que pueden ser deserializados.

---

# INVESTIGACION PROP FIRMS CON ACCESO API (Febrero 2026)

Investigacion exhaustiva de prop firms con API para expandir opciones de integracion del AnalizadorDesktop mas alla de Bybit.

## Objetivo

Identificar las mejores 50 prop firms donde la aplicacion AnalizadorDesktop puede usarse con minima o media modificacion via conexion API, abarcando multiples mercados:
- Crypto (Bybit, Binance, OKX, Kraken, Hyperliquid)
- Forex (MetaTrader, cTrader, Match-Trader, DXTrade)
- Futures (Rithmic, NinjaTrader, Tradovate)
- Stocks/Equities

## Documentos Generados

### 1. Informe_PropFirms_API.md
Analisis inicial detallado de las primeras prop firms investigadas:
- HyroTrader, Mubite (Bybit Demo API)
- Klein Funding (Bybit Demo)
- Carrot Funding, Propr (Hyperliquid on-chain)
- Comparacion simulador vs trading real
- Integracion tecnica Bybit Demo vs Hyperliquid
- Ejemplos de codigo para cambio de endpoint
- Estimacion de esfuerzo de desarrollo (1 linea a 60-80 horas)

**Ubicacion:** `8.AnalizadorDesktop/Informe_PropFirms_API.md`

### 2. PropFirms_API_Completo_50.md
Lista expandida con 50 prop firms organizadas por mercado:

**Estructura:**
- **16 Crypto Prop Firms** (Tier 1-4 segun complejidad API)
- **15 Forex Prop Firms** (Tier 1-3 segun plataforma)
- **14 Futures Prop Firms** (Tier 1-3 segun API)
- **5 Multi-Asset Firms** (Stocks, Forex, Futures, Crypto)

**Contenido por firma:**
- Rating de calidad (⭐⭐⭐⭐⭐)
- Exchange/Plataforma
- Tipo de API y autenticacion
- Profit split y fees
- Tiempo estimado de desarrollo
- Ventajas y desventajas
- URL oficial

**Ubicacion:** `8.AnalizadorDesktop/PropFirms_API_Completo_50.md`

## Clasificacion por Complejidad de Integracion

| Complejidad | Firmas | Esfuerzo Dev | Descripcion |
|-------------|--------|--------------|-------------|
| ⭐ MUY FACIL | HyroTrader, Mubite, Klein | **1 linea** | Cambio endpoint: `api.bybit.com` → `api-demo.bybit.com` |
| ⭐⭐ FACIL | Tradeify, WenCrypto, BEM | 20-40h | DXTrade/Match-Trader integration |
| ⭐⭐⭐ MEDIA | FunderPro, FundedNext, TFT | 40-60h | cTrader Open API |
| ⭐⭐⭐⭐ DIFICIL | Lucid, Bulenox, TopStep | 50-70h | Rithmic/NinjaTrader API |
| ⭐⭐⭐⭐⭐ MUY DIFICIL | Carrot, Propr | 60-80h | Hyperliquid (blockchain L1 propia) |
| ❌ NO RECOMENDADO | FTMO, Audacity, etc. | N/A | MT4/MT5 (DLL local, no web API) |

## Hallazgos Principales

### APIs Recomendadas por Mercado

**Crypto:**
- **Bybit Demo:** HyroTrader, Mubite, Klein - Integracion inmediata (1 linea)
- **Hyperliquid:** Carrot, Propr - Trading real on-chain verificable

**Forex:**
- **cTrader Open API:** FunderPro, FundedNext, TFT - UNICA plataforma forex con API web nativa
- **Match-Trader/DXTrade:** BrightFunded, FundingPips - Complejidad media
- **MetaTrader 4/5:** FTMO, The5ers - ❌ NO recomendado (DLL local, sin web API)

**Futures:**
- **Rithmic API:** Lucid, Topstep, Bulenox - Ultra-low latency, mejor opcion
- **NinjaTrader TradeAPI:** MyFundedFutures, TradeDay - REST API mas simple

### Politicas Importantes (Cambios 2026)

⚠️ **Apex Trader Funding:** Bots PROHIBIDOS desde marzo 2026
⚠️ **Earn2Trade:** Rithmic bundled descontinuado junio 2026
⚠️ **FundedNext:** Bots permitidos en MT4/MT5 pero PROHIBIDOS en cTrader
❌ **MyForexFunds:** Cerrado por CFTC en septiembre 2023

### Modelo de Negocio

- **80-90% son simuladores:** Pagan desde pool de fees de evaluacion
- **5-10% trading real:** Solo Carrot y Propr (on-chain Hyperliquid)
- **Ninguna es broker regulado:** No tienen licencias financieras tradicionales

## Conceptos Tecnicos Clave

### DLL Local vs API Web

**DLL Local (MetaTrader 4/5):**
- Codigo que corre en tu PC, no en la nube
- Archivo `.dll` (Windows only) con funciones compiladas
- Requiere proceso de MT4/MT5 corriendo 24/7
- No hay REST/WebSocket API
- Comunicacion solo en memoria local
- Integracion requiere C++ complejo o workarounds fragiles

**API Web (Bybit, cTrader, Rithmic):**
- HTTP/HTTPS REST endpoints
- WebSocket para streaming en tiempo real
- Autenticacion estandar (HMAC, OAuth2, API tokens)
- Multiplataforma (Windows, Linux, Mac, cloud)
- Stateless, sin proceso corriendo
- Integrable desde cualquier lenguaje (JavaScript, Python, etc.)

**Por que esto importa:**
```
MetaTrader (DLL):
  AnalizadorDesktop → NO puede conectarse directamente
  Necesitas: MT4 corriendo + bridge/proxy custom + VPS Windows

cTrader/Bybit (API Web):
  AnalizadorDesktop → fetch('https://api.ctrader.com/...') → Listo ✅
```

### cTrader Open API

**Nombre oficial** de la API web de cTrader (plataforma forex moderna, lanzada 2011).

**Arquitectura:**
```
cTrader Open API = REST + WebSocket + Protocol Buffers
```

**Componentes:**
1. **REST API:** Account info, market data, orders, historical data
2. **WebSocket API:** Streaming tiempo real (ticks, orderbooks, account updates)
3. **Protocol Buffers:** Formato binario eficiente (mas rapido que JSON)
4. **OAuth2:** Autenticacion estandar (Client ID + Secret)

**SDKs Oficiales:**
- Python: `pip install ctrader_open_api`
- C#: NuGet package

**Ventajas sobre MetaTrader:**
| Aspecto | MetaTrader 4/5 | cTrader Open API |
|---------|----------------|------------------|
| API Web | ❌ No existe | ✅ Completa |
| Integracion | DLL local (Windows only) | REST + WebSocket (multiplataforma) |
| Autenticacion | No aplica | OAuth2 (estandar) |
| Lenguajes | MQL4/MQL5 (propietarios) | Python, C#, JavaScript, etc. |
| Hosting | Requiere PC/VPS con MT | Backend en la nube |

**Ejemplo de uso:**
```javascript
// Autenticacion OAuth2
const tokenResponse = await fetch('https://openapi.ctrader.com/oauth/token', {
  method: 'POST',
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'YOUR_CLIENT_ID',
    client_secret: 'YOUR_CLIENT_SECRET'
  })
});

// REST API - Account info
const accountInfo = await fetch('https://openapi.ctrader.com/v2/accounts', {
  headers: { 'Authorization': `Bearer ${access_token}` }
});

// WebSocket - Market data
const ws = new WebSocket('wss://openapi.ctrader.com/v2/websocket');
ws.send(JSON.stringify({
  payloadType: 'ProtoOASubscribeSpotsReq',
  symbolId: [1, 2, 3] // EURUSD, GBPUSD, etc.
}));
```

### Hyperliquid On-Chain

**Diferencia clave:** Trading real 100% verificable en blockchain vs simuladores.

**Arquitectura:**
- L1 blockchain propia (no Ethereum mainnet)
- Ejecucion on-chain (todas las ordenes en blockchain)
- Firma de wallet Ethereum (EIP-712)
- ethers.js para integracion

**Autenticacion:**
```javascript
const { ethers } = require('ethers');
const wallet = new ethers.Wallet(privateKey);
const signature = await wallet._signTypedData(domain, types, message);
```

**vs Bybit HMAC-SHA256:**
```javascript
const signature = crypto.createHmac('sha256', secret)
  .update(timestamp + apiKey + params)
  .digest('hex');
```

## Recomendaciones por Caso de Uso

### Quick Start (1-2 dias)
**HyroTrader o Mubite**
- Razon: 1 linea de codigo
- Costo: $59-99
- Limitacion: Trading simulado

### Trading Real (3-4 semanas)
**Carrot Funding o Propr**
- Razon: On-chain blockchain
- Costo: $200-500
- Ventaja: 100% transparente

### Forex Bots (2-3 semanas)
**FunderPro (cTrader)**
- Razon: Mejor API forex
- Costo: $79+
- SDK: Python `ctrader_open_api`

### Futures Bots (2-3 semanas)
**Topstep o Lucid Trading**
- Razon: Rithmic ultra-low latency
- Costo: $90-165
- Nota: Topstep permite bots, Lucid #1 ranked

### Multi-Exchange Crypto (1-2 semanas)
**Tradeify Crypto**
- Razon: Binance, Bybit, OKX
- Costo: $100-500
- Ventaja: Lanzado 2026, DXTrade moderno

### Algo Trader Sin Fee (1-2 semanas)
**Velotrade**
- Razon: API gratis incluido
- Costo: $0 evaluacion
- Para: Traders con estrategia validada

## Roadmap de Desarrollo

### Fase 1: Quick Start Bybit Demo (Semana 1-2)
1. Cambiar endpoint en `config.js` (1 dia)
2. Crear cuenta HyroTrader (1 dia)
3. Testing exhaustivo (3-5 dias)
4. Evaluacion opcional ($59)

### Fase 2: Expansion Forex cTrader (Semana 3-5)
1. Investigar cTrader Open API (2 dias)
2. Desarrollar adapter cTrader (5-7 dias)
3. Integracion dual-mode Bybit/cTrader (2-3 dias)
4. Testing con FunderPro demo (2-3 dias)

### Fase 3: Futures Rithmic/NinjaTrader (Semana 6-8)
1. Decision Rithmic vs NinjaTrader
2. Desarrollo adapter (7-10 dias)
3. Testing con Topstep (3-5 dias)

### Fase 4: On-Chain Hyperliquid (Semana 9-12)
1. Integrar ethers.js (2-3 dias)
2. Hyperliquid API (8-10 dias)
3. Testing en testnet (3-5 dias)
4. Evaluacion Carrot Funding ($200-500)

### Fase 5: Unificacion Multi-Exchange (Semana 13-16)
```javascript
// ExchangeFactory.js
class ExchangeFactory {
  static create(type, config) {
    switch(type) {
      case 'bybit': return new BybitAdapter(config);
      case 'bybit-demo': return new BybitDemoAdapter(config);
      case 'ctrader': return new CTraderAdapter(config);
      case 'rithmic': return new RithmicAdapter(config);
      case 'hyperliquid': return new HyperliquidAdapter(config);
    }
  }
}
```

## Estimaciones de Costos

**Opcion A: Solo Bybit Demo**
- Desarrollo: 1-2 dias (~$0)
- Evaluacion: $59-99
- Total: **$59-99**
- ROI: Inmediato

**Opcion B: Bybit + cTrader**
- Desarrollo: 2-3 semanas (~$0)
- Evaluacion: $59 + $79
- Total: **$138**
- ROI: 1-2 meses

**Opcion C: Completa Multi-Asset**
- Desarrollo: 3-4 meses (~$0)
- Evaluaciones: $59 + $79 + $165 + $200
- Total: **$503**
- ROI: 3-6 meses

**Opcion D: Externalizado**
- Freelancer: $5,000-10,000
- Evaluaciones: $503
- Total: **$5,503-10,503**
- ROI: 6-12 meses

## Recursos Documentacion

**Bybit:**
- REST: https://bybit-exchange.github.io/docs/v5/intro
- WebSocket: https://bybit-exchange.github.io/docs/v5/ws/connect

**Hyperliquid:**
- Gitbook: https://hyperliquid.gitbook.io/hyperliquid-docs
- SDK Python: https://github.com/hyperliquid-dex/hyperliquid-python-sdk

**cTrader:**
- Open API: https://help.ctrader.com/open-api/
- Python Package: https://pypi.org/project/ctrader_open_api/

**Rithmic:**
- Developer Portal: https://yyy3.rithmic.com/
- API Docs: https://www.rithmic.com/rithmic_protocol_api.html

**NinjaTrader:**
- TradeAPI: https://connect.ninjatrader.com/futures-trading-api/

## Consideraciones Legales

**Firmas US-Friendly:**
- E8 Markets, The Funded Trader, Apex, Topstep, Earn2Trade

**Firmas Internacionales (No US):**
- HyroTrader, Mubite, FTMO, FunderPro (Czech Republic/Internacional)

**Riesgos:**
1. Firma puede cerrar (ver MyForexFunds CFTC shutdown 2023)
2. Cambio de ToS (ver Apex banning bots 2026)
3. Payouts no garantizados

**Mitigaciones:**
1. Diversificar (no todo en una firma)
2. Backup de datos (logger exhaustivo)
3. Leer ToS cuidadosamente
4. Empezar con plan basico

## Top 3 Firmas por Categoria

**Facilidad de Integracion:**
1. HyroTrader - Bybit Demo, 1 linea
2. Mubite - Bybit Demo, 1 linea
3. Tradeify Crypto - DXTrade, ~20h

**Trading Real:**
1. Carrot Funding - Hyperliquid on-chain
2. Propr - Hyperliquid on-chain
3. *Resto son simuladores*

**API Quality Forex:**
1. FunderPro - cTrader Open API
2. The Funded Trader - cTrader US-approved
3. Alpha Capital Group - Pro-automation

**API Quality Futures:**
1. Lucid Trading - Rithmic (#1 ranked)
2. Topstep - Rithmic + TopstepX (bots permitidos)
3. Bulenox - Rithmic (100% primeros $10K)

## Estrategia Hibrida Recomendada

1. **Corto plazo:** HyroTrader ($59, 1-2 dias) - Validar concepto
2. **Medio plazo:** FunderPro cTrader ($79, 2-3 semanas) - Expandir a forex
3. **Largo plazo:** Carrot Funding Hyperliquid ($200, 1-2 meses) - Trading real

---

**Fecha investigacion:** 3 de febrero de 2026
**Firmas verificadas:** 50 total
**Fuentes:** Documentacion oficial, reviews verificados, testing APIs
**Preparado por:** Claude Code (Anthropic)
**Proyecto:** AnalizadorDesktop (Electron + React + Bybit API)

---

# VALIDACION API xSTOCKS BYBIT (Octubre 2026)

Sistema completo de validación de compatibilidad API para xStocks (acciones tokenizadas) en Bybit.

## Resumen Ejecutivo

**Estado Final**: ✅ 5/5 xStocks completamente compatibles con la infraestructura API actual.

**Conclusión**: Todos los xStocks activos en Bybit son 100% compatibles. No se requieren cambios en el código para soportarlos - funcionan exactamente igual que cualquier par spot tradicional. La implementación puede proceder inmediatamente.

## xStocks Validados (Activos en Bybit)

| Símbolo | Nombre | Multiplicador | Estado | Margin Trading | LONG/SHORT |
|---------|--------|---------------|--------|----------------|------------|
| AAPLXUSDT | Apple Inc. | 1.0033 | Trading | ✅ utaOnly | ✅ Ambos |
| NVDAXUSDT | NVIDIA Corp. | 1.0017 | Trading | ✅ utaOnly | ✅ Ambos |
| METAXUSDT | Meta Platforms | 1.0029 | Trading | ❌ none | ⚠️ Solo LONG |
| GOOGLXUSDT | Alphabet Inc. | 1.0024 | Trading | ✅ utaOnly | ✅ Ambos |
| MCDXUSDT | McDonald's | 1.0212 | Trading | ❌ none | ⚠️ Solo LONG |

### Capacidades de Trading por xStock

**✅ Con Margin Trading (LONG y SHORT disponibles):**
- **AAPLXUSDT** - Apple Inc.
- **NVDAXUSDT** - NVIDIA Corp.
- **GOOGLXUSDT** - Alphabet Inc.

**⚠️ Sin Margin Trading (Solo LONG):**
- **METAXUSDT** - Meta Platforms
- **MCDXUSDT** - McDonald's

### Requisitos para Operar SHORT en xStocks

Para hacer SHORT en los 3 xStocks que soportan margin trading (`marginTrading: "utaOnly"`):

1. **Cuenta UTA Activada**: Unified Trading Account de Bybit
2. **Margin Trading Habilitado**: En configuración de cuenta
3. **Colateral Suficiente**: Saldo en USDT para garantizar el préstamo
4. **Conocimiento del Riesgo**: El margin trading implica apalancamiento y riesgo de liquidación

### Cómo Funciona el SHORT en Spot Margin

```
1. Sistema pide prestado el xStock (ej: AAPLX)
2. Vende inmediatamente al precio actual
3. Esperas a que baje el precio
4. Recompras el xStock más barato
5. Devuelves el xStock prestado
6. Ganancia = Precio Venta - Precio Recompra - Intereses
```

**IMPORTANTE**: Los xStocks sin margin trading (META, MCD) **solo permiten operaciones LONG** (comprar y vender normalmente).

## Problema Original

**Fallo Inicial**: 0/8 símbolos pasaron las pruebas de validación

**Causas Raíz**:
1. **Formato de símbolo incorrecto**: Se usaba "AAPLX" en lugar del formato completo "AAPLXUSDT"
2. **Símbolos inexistentes**: 3 de los 8 símbolos originales no existen o no están activos (TSLAX, MSFX, MSTRx, COINx, SPYx)
3. **Lógica de validación con errores**: Extracción incorrecta de datos de la estructura JSON de la API

## Proceso de Diagnóstico

### 1. Análisis de Resultados Fallidos
Revisión del archivo `xstocks_validation_results.json` que mostraba 0/8 símbolos compatibles.

### 2. Script de Diagnóstico (diagnose_xstocks.py)
Creación de script con 11 variaciones de formato de símbolo:
- AAPLX, AAPLx
- AAPLXUSDT, AAPLxUSDT
- AAPLX/USDT, AAPLx/USDT
- AAPLX-USDT, AAPLx-USDT
- AAPL, AAPLUSDT, AAPL/USDT

### 3. Descubrimiento del Formato Correcto
**Formato correcto identificado**: Par completo "SYMBOLXUSDT" (ejemplo: AAPLXUSDT)

### 4. Listado Completo de Mercado
Descarga de todos los símbolos spot de Bybit: **527 símbolos totales**

### 5. Filtrado de xStocks (filter_xstocks.py)
Identificación mediante el campo `xstockMultiplier != "1"`: **5 xStocks activos** (no 8 como se creía)

### 6. Corrección de Validación
Ajuste de la lógica de extracción de datos de la estructura JSON anidada de la API.

### 7. Validación Exitosa
100% de compatibilidad confirmada para los 5 símbolos activos.

## Problemas Técnicos Resueltos

### 1. Error de Codificación Unicode
**Problema**: Windows console (cp1252) no soporta caracteres Unicode (✓, ✗, ℹ)
```
UnicodeEncodeError: 'charmap' codec can't encode character '\u2139'
```
**Solución**: Reemplazo por equivalentes ASCII: [OK], [ERROR], [INFO]

### 2. Formato de Símbolo
**Problema**: Se probaba "AAPLX" en lugar de "AAPLXUSDT"
**Solución**: Uso del formato completo del par trading

### 3. Validación de BaseCoin
**Problema**: Lógica incorrecta esperaba "AAPLXUSDT" cuando el campo baseCoin contiene "AAPLX"
**Solución**: Extracción correcta eliminando sufijo "USDT"
```python
expected_base = symbol.replace("USDT", "")  # AAPLXUSDT -> AAPLX
```

### 4. Estructura JSON de Respuesta API
**Problema**: El campo `category` está en `result.category`, no en cada instrumento individual
**Solución**: Extracción correcta desde el nivel superior de la respuesta
```python
category = result.get("category", "")
checks = {
    "Category": category == "spot",  # No instrument.get("category")
    # ...
}
```

### 5. Mapeo de Valores para Display
**Problema**: Los nombres de checks ("Symbol", "Category") no coincidían con las claves del objeto ("symbol", "category")
**Solución**: Creación de `value_map` para mapeo correcto
```python
value_map = {
    "Symbol": instrument.get("symbol", "N/A"),
    "Category": category,
    "BaseCoin": instrument.get("baseCoin", "N/A"),
    "QuoteCoin": instrument.get("quoteCoin", "N/A"),
    "xstockMultiplier": instrument.get("xstockMultiplier", "N/A"),
}
```

## Validación de Compatibilidad API

Todos los xStocks pasaron las **4 pruebas de compatibilidad**:

### ✅ Test 1: Instruments Info
- Symbol correcto
- Category = "spot"
- BaseCoin y QuoteCoin correctos
- Campo `xstockMultiplier` presente
- Campo `symbolType` = "xstocks"

### ✅ Test 2: Kline Data
- Datos históricos disponibles
- Formato de velas correcto (7 elementos: timestamp, open, high, low, close, volume, turnover)
- Lógica OHLC válida (high >= max(open, close), low <= min(open, close))

### ✅ Test 3: Ticker Data
- Precio en tiempo real disponible
- Datos 24h completos (high, low, volume)
- Bid/Ask/Spread funcional
- Spreads bajos: 0.029% - 0.224%

### ✅ Test 4: Multiple Intervals
- **6 intervalos soportados**: 1m, 5m, 15m, 60m, 240m, D
- Todos funcionan correctamente
- Sin restricciones especiales vs pares spot normales

## Estructura de Respuesta API

### Endpoint: GET /v5/market/instruments-info

```json
GET /v5/market/instruments-info?category=spot&symbol=AAPLXUSDT

Response:
{
  "retCode": 0,
  "retMsg": "OK",
  "result": {
    "category": "spot",
    "list": [
      {
        "symbolId": 1002,
        "symbol": "AAPLXUSDT",
        "baseCoin": "AAPLX",
        "quoteCoin": "USDT",
        "innovation": "0",
        "status": "Trading",
        "marginTrading": "utaOnly",
        "symbolType": "xstocks",
        "xstockMultiplier": "1.0032690125398187",
        "lotSizeFilter": {
          "basePrecision": "0.001",
          "quotePrecision": "0.00001",
          "minOrderQty": "0.001",
          "maxOrderQty": "270",
          "minOrderAmt": "5",
          "maxOrderAmt": "65000"
        },
        "priceFilter": {
          "tickSize": "0.01"
        }
      }
    ]
  }
}
```

### Campos Clave

| Campo | Descripción | Valor Ejemplo |
|-------|-------------|---------------|
| `symbolType` | Tipo de símbolo | "xstocks" |
| `xstockMultiplier` | Multiplicador del xStock | "1.0032690125398187" |
| `baseCoin` | Moneda base (sin USDT) | "AAPLX" |
| `quoteCoin` | Moneda de cotización | "USDT" |
| `status` | Estado del par | "Trading" |

## Datos de Mercado (Snapshot 14 Oct 2026, 23:00 UTC)

| Símbolo | Precio | 24h High | 24h Low | Vol 24h | Spread | Bid | Ask |
|---------|--------|----------|---------|---------|--------|-----|-----|
| AAPLXUSDT | $347.16 | $348.51 | $342.98 | 256 | 0.029% | $347.19 | $347.29 |
| NVDAXUSDT | $220.21 | $230.38 | $218.38 | 2,440 | 0.032% | $220.17 | $220.24 |
| METAXUSDT | $730.64 | $770.82 | $729.02 | 524 | 0.036% | $731.22 | $731.48 |
| GOOGLXUSDT | $343.73 | $360.15 | $342.47 | 414 | 0.038% | $343.68 | $343.81 |
| MCDXUSDT | $240.58 | $244.00 | $236.00 | 32 | 0.224% | $240.50 | $241.04 |

**Observaciones**:
- Spreads bajos (0.029% - 0.224%), indicando buena liquidez
- Volúmenes variables: NVDA más activo (2,440), MCD menos activo (32)
- Volatilidad 24h: NVDA ±5.2%, META ±5.7%

## Archivos del Sistema de Validación

### Scripts de Diagnóstico

| Archivo | Descripción | Líneas |
|---------|-------------|--------|
| `diagnose_xstocks.py` | Script de diagnóstico con 11 variaciones de formato | ~270 |
| `filter_xstocks.py` | Filtro para extraer xStocks del listado completo | ~16 |
| `debug_xstocks.py` | Script para ver respuesta RAW de la API | ~30 |
| `test_xstocks_api.py` | Script de validación completo corregido | ~500 |
| `check_xstocks_margin.py` | Verificación de capacidades de margin trading | ~80 |

### Archivos de Datos

| Archivo | Descripción | Tamaño |
|---------|-------------|--------|
| `xstocks_found.json` | 527 símbolos spot con metadata | ~450 KB |
| `xstocks_validation_results.json` | Resultados finales exitosos | ~1 KB |

### Presentación

| Archivo | Descripción |
|---------|-------------|
| `xStocks_Validation_Report.pptx` | Presentación PowerPoint profesional (12 slides) |
| `create_xstocks_presentation.py` | Script generador de presentación |

## Ejemplo de Uso del Script de Validación

```bash
# Ejecutar validación completa
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist
python test_xstocks_api.py

# Salida esperada:
# [OK] Fully Compatible: 5/5
# - AAPLXUSDT: 4/4 tests passed
# - NVDAXUSDT: 4/4 tests passed
# - METAXUSDT: 4/4 tests passed
# - GOOGLXUSDT: 4/4 tests passed
# - MCDXUSDT: 4/4 tests passed

# Verificar capacidades de margin trading
python check_xstocks_margin.py

# Salida esperada:
# AAPLXUSDT: Margin Trading: utaOnly (LONG y SHORT)
# NVDAXUSDT: Margin Trading: utaOnly (LONG y SHORT)
# METAXUSDT: Margin Trading: none (Solo LONG)
# GOOGLXUSDT: Margin Trading: utaOnly (LONG y SHORT)
# MCDXUSDT: Margin Trading: none (Solo LONG)
```

## Diagnóstico Rápido de xStocks

Para verificar si un símbolo es un xStock:

```python
import httpx
import asyncio

async def is_xstock(symbol):
    url = "https://api.bybit.com/v5/market/instruments-info"
    params = {"category": "spot", "symbol": symbol}

    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, timeout=10.0)
        data = response.json()

        if data.get("retCode") == 0:
            instruments = data.get("result", {}).get("list", [])
            if instruments:
                instrument = instruments[0]
                # Verificar campos característicos
                is_xstock = (
                    "xstockMultiplier" in instrument and
                    instrument.get("symbolType") == "xstocks"
                )
                return is_xstock, instrument.get("xstockMultiplier")
    return False, None

# Uso
asyncio.run(is_xstock("AAPLXUSDT"))
# Output: (True, "1.0032690125398187")
```

## Integración en Aplicaciones Existentes

### Paso 1: Agregar Símbolos a la Configuración

```python
# En cualquier archivo de configuración de símbolos
XSTOCKS_SYMBOLS = [
    "AAPLXUSDT",   # Apple Inc.
    "NVDAXUSDT",   # NVIDIA Corp.
    "METAXUSDT",   # Meta Platforms
    "GOOGLXUSDT",  # Alphabet Inc.
    "MCDXUSDT",    # McDonald's
]

# Agregar a lista completa de símbolos
ALL_SYMBOLS = CRYPTO_SYMBOLS + XSTOCKS_SYMBOLS
```

### Paso 2: Sin Cambios en el Código API

Los xStocks usan **exactamente los mismos endpoints** que los pares spot tradicionales:

```python
# Datos históricos - FUNCIONA SIN CAMBIOS
GET /v5/market/kline?category=spot&symbol=AAPLXUSDT&interval=60&limit=200

# Ticker en tiempo real - FUNCIONA SIN CAMBIOS
GET /v5/market/tickers?category=spot&symbol=NVDAXUSDT

# WebSocket - FUNCIONA SIN CAMBIOS
ws://stream.bybit.com/v5/public/spot
Subscribe: {"op": "subscribe", "args": ["kline.60.METAXUSDT"]}
```

### Paso 3: Consideraciones Especiales (Opcional)

Si quieres distinguir visualmente los xStocks:

```javascript
// Frontend - Ejemplo en React
function SymbolBadge({ symbol }) {
  const isXStock = symbol.includes('X') && symbol.endsWith('USDT') &&
                   !symbol.startsWith('BTC') && !symbol.startsWith('ETH');

  return (
    <div className={isXStock ? 'xstock-badge' : 'crypto-badge'}>
      {isXStock && <span className="icon">📈</span>}
      {symbol}
    </div>
  );
}
```

## Conclusiones Clave

1. **✅ 100% Compatibilidad Confirmada**
   - Todos los xStocks activos funcionan perfectamente con la API existente
   - No se detectaron limitaciones, restricciones o comportamientos especiales

2. **✅ Sin Cambios Arquitectónicos Necesarios**
   - Los xStocks usan los mismos endpoints que pares spot normales
   - WebSocket, REST API, y formatos de datos son idénticos
   - El código actual funciona sin modificaciones

3. **✅ Formato de Símbolo**
   - **Correcto**: "SYMBOLXUSDT" (ej: AAPLXUSDT)
   - **Incorrecto**: "SYMBOLX" (ej: AAPLX)
   - Siempre usar el par completo para llamadas API

4. **✅ Identificación de xStocks**
   - Campo `xstockMultiplier` presente en la respuesta
   - Campo `symbolType` = "xstocks"
   - Multiplicador diferente de 1 (ej: 1.0033)

5. **⚠️ Limitaciones de Trading Direccional**
   - **3/5 xStocks permiten SHORT** (AAPL, NVDA, GOOGL con margin trading)
   - **2/5 xStocks solo LONG** (META, MCD sin margin trading)
   - Verificar campo `marginTrading` antes de implementar estrategias SHORT
   - Requiere cuenta UTA para margin trading

## Implicaciones para Estrategias de Trading

### Para Aplicaciones con Soporte de Direcciones

Si tu aplicación permite configurar direcciones de trading (LONG/SHORT/BOTH):

```python
# Ejemplo: Configuración de direcciones por símbolo
XSTOCKS_TRADING_CONFIG = {
    "AAPLXUSDT": {
        "allowed_directions": ["LONG", "SHORT"],  # Margin disponible
        "requires_margin": True
    },
    "NVDAXUSDT": {
        "allowed_directions": ["LONG", "SHORT"],  # Margin disponible
        "requires_margin": True
    },
    "METAXUSDT": {
        "allowed_directions": ["LONG"],  # Sin margin - solo LONG
        "requires_margin": False
    },
    "GOOGLXUSDT": {
        "allowed_directions": ["LONG", "SHORT"],  # Margin disponible
        "requires_margin": True
    },
    "MCDXUSDT": {
        "allowed_directions": ["LONG"],  # Sin margin - solo LONG
        "requires_margin": False
    }
}
```

### Detección Automática de Capacidades

```python
async def get_trading_capabilities(symbol: str) -> dict:
    """
    Obtiene las capacidades de trading para un símbolo
    """
    url = f"{BYBIT_API_URL}/v5/market/instruments-info"
    params = {"category": "spot", "symbol": symbol}

    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params)
        data = response.json()

        if data.get("retCode") == 0:
            instrument = data["result"]["list"][0]
            margin_trading = instrument.get("marginTrading", "none")

            return {
                "symbol": symbol,
                "margin_enabled": margin_trading != "none",
                "margin_type": margin_trading,
                "can_long": True,  # Siempre disponible en spot
                "can_short": margin_trading == "utaOnly",  # Solo con margin
                "requires_uta": margin_trading == "utaOnly"
            }
```

### Filtros de Estrategia Recomendados

```python
# En tu sistema de alertas o trading bot
def validate_signal(symbol: str, direction: str) -> bool:
    """
    Valida que una señal de trading sea ejecutable
    """
    capabilities = XSTOCKS_TRADING_CONFIG.get(symbol)

    if not capabilities:
        return True  # No es xStock, permitir todo

    # Verificar que la dirección está permitida
    if direction not in capabilities["allowed_directions"]:
        logger.warning(
            f"Signal rejected: {symbol} {direction} - "
            f"Symbol only supports: {capabilities['allowed_directions']}"
        )
        return False

    # Advertir si requiere margin
    if capabilities["requires_margin"] and direction == "SHORT":
        logger.info(
            f"Signal {symbol} SHORT requires UTA margin account"
        )

    return True
```

## Próximos Pasos Recomendados

### 1. Implementación en Desarrollo
- Agregar los 5 símbolos xStocks a la configuración
- Probar en entorno de desarrollo/staging
- Verificar que indicadores técnicos funcionan correctamente

### 2. Testing de Integración
- Probar datos históricos (1m, 5m, 15m, 1h, 4h, D)
- Verificar WebSocket en tiempo real
- Confirmar que alertas y notificaciones funcionan

### 3. Monitoreo Pre-Producción
- Observar volúmenes y spreads durante 1-2 semanas
- Identificar horarios de mayor liquidez
- Evaluar si los spreads son aceptables para trading

### 4. Expansión Futura
- Monitorear si Bybit lista más xStocks
- Considerar agregar filtros específicos para stocks (ej: sector, mercado)
- Evaluar si se necesitan indicadores específicos para acciones tokenizadas

## Diferencias con Pares Crypto Tradicionales

| Aspecto | Crypto (BTCUSDT) | xStocks (AAPLXUSDT) |
|---------|------------------|---------------------|
| Horario | 24/7 | 24/7 (pero sigue precio de mercado US) |
| Spread | 0.01% - 0.05% | 0.03% - 0.22% |
| Volumen | Muy alto | Bajo-Medio |
| Volatilidad | Alta | Media (similar a stock real) |
| Trading LONG | ✅ Siempre | ✅ Siempre |
| Trading SHORT | ✅ Con futures | ⚠️ Solo 3/5 (requiere UTA margin) |
| Margin Trading | Opcional | 60% tienen (AAPL, NVDA, GOOGL) |
| API Endpoints | Standard spot | **Idénticos** |
| WebSocket | Standard spot | **Idéntico** |
| Formato de datos | Standard | **Idéntico** |

**Nota importante**: Aunque la API es idéntica, los xStocks **siguen el precio del mercado de acciones estadounidense** (NYSE/NASDAQ), por lo que su comportamiento de precio puede diferir de cryptos puras. Durante horarios de mercado cerrado US (weekends, holidays), el precio puede estar menos activo.

## Referencias y Documentación

### Documentación Oficial Bybit
- Instruments Info: https://bybit-exchange.github.io/docs/v5/market/instrument
- Kline Data: https://bybit-exchange.github.io/docs/v5/market/kline
- Ticker Data: https://bybit-exchange.github.io/docs/v5/market/tickers

### Archivos Locales
- Validación completa: `xstocks_validation_results.json`
- Lista completa de símbolos spot: `xstocks_found.json`
- Script de validación: `test_xstocks_api.py`
- Presentación: `xStocks_Validation_Report.pptx`

### Información Adicional sobre xStocks
Los xStocks son tokens en la blockchain de Solana que representan acciones fraccionadas de empresas estadounidenses. Permiten trading 24/7 de activos que normalmente solo operan durante horarios de mercado tradicionales.

**Ventajas**:
- Trading 24/7 de acciones
- Acceso sin necesidad de cuenta de broker tradicional
- Integración nativa con criptomonedas

**Limitaciones**:
- Volumen más bajo que crypto tradicional
- Spreads más amplios (0.2% vs 0.01%)
- Precio sigue mercado US (menor actividad fuera de horario)

---

**Fecha de validación:** 14 de Octubre de 2026
**xStocks validados:** 5 activos
**Compatibilidad:** 100%
**Estado:** ✅ Listo para implementación
**Autor:** Claude Code (Anthropic)

---

# TRADING DE ACCIONES US: ALPACA Y ALTERNATIVAS (Febrero 2026)

Sistema de trading de acciones estadounidenses reales (no tokenizadas) a través de brokers con API profesional.

## Resumen Ejecutivo

**Alpaca Securities** es un broker-dealer estadounidense regulado (FINRA/SIPC) con API-first design, ideal para integración con bots de trading algorítmico.

| Aspecto | Bybit xStocks | Alpaca Securities |
|---------|---------------|-------------------|
| Tipo de activos | 5 tokens (Solana) | 1,000+ acciones y ETFs reales |
| Regulación | No regulado | FINRA/SIPC (US) |
| Horario trading | 24/7 | 24/5 (pre-market, market, after-hours) |
| Moneda | USDT | USD (via ACH/wire) |
| Depósito mínimo | $0 | **$0** (cash account) |
| Comisiones | Maker/taker fees | **$0** (stocks y ETFs) |
| Trading SHORT | Solo 3/5 (margin) | ✅ Con margin account ($2,000 min) |
| Acciones fraccionadas | No | ✅ Desde $1 |
| API Python oficial | Bybit SDK | `alpaca-py` |
| Paper trading | No | ✅ Gratis con fondos virtuales |

**Conclusión:** Alpaca ofrece acceso a acciones reales estadounidenses con $0 de depósito mínimo y $0 de comisiones, perfecto para expandir el bot de trading más allá de crypto.

---

## Apertura de Cuenta Alpaca

### Timeline Completo
```
Día 1: Aplicación online (5-10 minutos)
  ↓ 1-3 días: Verificación KYC/AML
Día 2-4: Cuenta aprobada
  ↓ 3-5 días: Transferencia ACH inicial
Día 5-6: Fondos disponibles → Trading live
```

### Requisitos KYC
- Nombre completo
- Fecha de nacimiento
- Dirección residencial (US o internacional)
- SSN/ITIN (solo residentes US) o pasaporte (internacional)
- Experiencia de inversión (survey básico)
- Empleo e ingresos
- Ciudadanía (US citizens, US residents, o internacional)

### Tipos de Cuenta
| Tipo | Depósito Mínimo | Características |
|------|----------------|-----------------|
| Individual Cash | **$0** | No margin, solo LONG, settlement T+2 |
| Individual Margin | $2,000 | Margin trading, SHORT permitido, 4x day trading power |
| Paper Trading | **$0** | Virtual funds ($100K default), testing gratis |

**Recomendación inicial:** Empezar con **Paper Trading** gratis para validar el bot, luego migrar a **Cash Account** ($0 depósito) con fondos reales pequeños ($100-500).

---

## Configuración API

### 1. Obtener API Keys
```
Dashboard → API Keys → Generate New Key
  - Seleccionar scope: Trading, Account, Market Data
  - Copiar API Key y Secret Key (solo se muestra una vez)
  - Guardar en archivo seguro (NO subir a GitHub)
```

### 2. Instalación SDK Python
```bash
pip install alpaca-py
```

### 3. Configuración Básica
```python
from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

# API Keys (usar .env en producción)
ALPACA_API_KEY = "tu_api_key_aqui"
ALPACA_SECRET_KEY = "tu_secret_key_aqui"

# Cliente de trading
trade_client = TradingClient(
    api_key=ALPACA_API_KEY,
    secret_key=ALPACA_SECRET_KEY,
    paper=True  # True = Paper Trading, False = Live Trading
)

# Verificar conexión
account = trade_client.get_account()
print(f"Equity: ${account.equity}")
print(f"Buying Power: ${account.buying_power}")
```

---

## Tipos de Órdenes Soportadas

### 1. Market Order (Orden de Mercado)
Ejecuta inmediatamente al mejor precio disponible.

```python
def buy_market(symbol: str, qty: int):
    """Compra acciones a precio de mercado"""
    order_data = MarketOrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar 10 acciones de Apple
order = buy_market("AAPL", 10)
```

### 2. Notional Order (Por Monto en Dólares)
Compra por valor en dólares en lugar de cantidad de acciones.

```python
def buy_notional(symbol: str, usd_amount: float):
    """Compra acciones por valor en dólares (mínimo $1)"""
    order_data = MarketOrderRequest(
        symbol=symbol,
        notional=usd_amount,  # Mínimo $1.00
        side=OrderSide.BUY,
        time_in_force=TimeInForce.DAY
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar $50 de Tesla (acciones fraccionadas automáticas)
order = buy_notional("TSLA", 50.0)
```

### 3. Bracket Order (Orden con TP y SL)
Entrada + Take Profit + Stop Loss en una sola orden.

```python
from alpaca.trading.requests import MarketOrderRequest

def buy_with_bracket(symbol: str, qty: int, take_profit: float, stop_loss: float):
    """Compra con TP y SL automáticos"""
    order_data = MarketOrderRequest(
        symbol=symbol,
        qty=qty,
        side=OrderSide.BUY,
        time_in_force=TimeInForce.GTC,
        order_class="bracket",  # CRITICO
        take_profit={"limit_price": take_profit},
        stop_loss={"stop_price": stop_loss}
    )
    order = trade_client.submit_order(order_data=order_data)
    return order

# Ejemplo: Comprar con TP en $110 y SL en $90
order = buy_with_bracket("AAPL", 10, take_profit=110.0, stop_loss=90.0)
```

---

## Brokers Alternativos Recomendados

Para diversificar o comparar opciones, aquí están los 5 mejores brokers con API para trading algorítmico:

### 1. Alpaca ⭐⭐⭐⭐⭐ (MEJOR OPCIÓN)
- **Depósito mínimo:** $0
- **Comisiones:** $0
- **API:** REST + WebSocket + Python SDK oficial
- **Paper trading:** ✅ Gratis
- **Documentación:** ⭐⭐⭐⭐⭐ Excelente
- **Recomendado para:** Principiantes y trading algorítmico

### 2. Webull ⭐⭐⭐⭐
- **Depósito mínimo:** $0
- **Comisiones:** $0
- **API:** REST + WebSocket (oficial desde Ago 2026)
- **Paper trading:** ✅ Gratis
- **Ventajas únicas:** Acciones de Hong Kong, real-time data gratis
- **Documentación:** ⭐⭐⭐ Buena (nueva)
- **Recomendado para:** Trading Asia + US

### 3. Interactive Brokers ⭐⭐⭐⭐⭐
- **Depósito mínimo:** $0
- **Comisiones:** $0.005/acción (min $1)
- **API:** TWS API (Java/Python/C++)
- **Paper trading:** ✅ Gratis
- **Mercados:** 150+ países (stocks, forex, futures, options, bonds)
- **Documentación:** ⭐⭐⭐⭐ Muy completa pero compleja
- **Recomendado para:** Traders profesionales, multi-asset

### 4. Tradier ⭐⭐⭐⭐
- **Depósito mínimo:** $0
- **Comisiones:** $0 con plan Pro ($10/mes), o $0.35/trade
- **API:** REST + Streaming
- **Paper trading:** ✅ Gratis
- **Breakeven:** 29 trades/mes (29 × $0.35 = $10.15)
- **Documentación:** ⭐⭐⭐⭐ Muy buena
- **Recomendado para:** Traders activos (>30 trades/mes)

### 5. Schwab ⭐⭐⭐
- **Depósito mínimo:** $0
- **Comisiones:** $0
- **API:** Nueva API (fusión TD Ameritrade)
- **Paper trading:** ❌ No disponible
- **Documentación:** ⭐⭐ En desarrollo
- **Recomendado para:** NO recomendado aún (API muy nueva)

---

## Comparación Detallada

| Aspecto | Alpaca | Webull | IBKR | Tradier | Schwab |
|---------|--------|--------|------|---------|--------|
| **Depósito mínimo** | $0 | $0 | $0 | $0 | $0 |
| **Comisión stocks** | $0 | $0 | $0.005/sh | $0.35 | $0 |
| **API Python oficial** | ✅ | ✅ | ⚠️ Community | ✅ | ⚠️ Community |
| **Paper trading** | ✅ | ✅ | ✅ | ✅ | ❌ |
| **WebSocket API** | ✅ | ✅ | ✅ | ✅ | ⚠️ |
| **Real-time data** | Gratis (IEX) | Gratis (L2) | $10/mo | Gratis | Gratis |
| **Opciones** | ✅ ($0.65) | ✅ ($0.65) | ✅ ($0.65) | ✅ ($0.35) | ✅ ($0.65) |
| **Crypto** | ✅ | ✅ | ✅ | ❌ | ✅ |
| **Forex** | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Futures** | ❌ | ❌ | ✅ | ❌ | ✅ |
| **Acciones HK** | ❌ | ✅ | ✅ | ❌ | ❌ |
| **Margin trading** | ✅ ($2K) | ✅ ($2K) | ✅ ($2K) | ✅ ($2K) | ✅ ($25K) |
| **Documentación** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ |
| **Facilidad setup** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |
| **Regulación** | FINRA/SIPC | FINRA/SIPC | FINRA/SIPC | FINRA/SIPC | FINRA/SIPC |

---

## Estrategia Multi-Broker Recomendada

### Fase 1: Quick Start (Semana 1-2)
**Objetivo:** Validar integración sin riesgo
```
1. Crear cuenta Alpaca (1-3 días aprobación)
2. Configurar Paper Trading ($0 costo)
3. Integrar bot con alpaca_adapter.py
4. Testing exhaustivo 1-2 semanas
```

### Fase 2: Live Trading Inicial (Semana 3-4)
**Objetivo:** Operar con capital real pequeño
```
1. Migrar a cuenta Live Alpaca
2. Depositar $100-500 inicial (ACH gratis, 3-5 días)
3. Operar solo acciones de alta liquidez (AAPL, TSLA, NVDA)
4. Validar retornos reales 2-4 semanas
```

### Fase 3: Expansión Multi-Exchange (Mes 2-3)
**Objetivo:** Diversificar y acceder a más mercados
```
1. Agregar Webull para:
   - Acciones de Hong Kong
   - Real-time data de mejor calidad
   - Backup en caso de downtime Alpaca
2. Mantener Bybit para crypto 24/7
3. Total: 3 exchanges (Bybit crypto + Alpaca US + Webull HK/US)
```

### Fase 4: Pro Trader (Mes 6+)
**Objetivo:** Acceso global a todos los mercados
```
1. Evaluar agregar Interactive Brokers si necesitas:
   - Futures (ES, NQ, CL)
   - Forex (EUR/USD, GBP/USD)
   - Mercados europeos/asiáticos
   - Opciones avanzadas
2. Total: 4 exchanges (máximo recomendado para un solo bot)
```

---

## Recursos y Documentación

### Alpaca
- Documentación oficial: https://docs.alpaca.markets/
- Python SDK: https://github.com/alpacahq/alpaca-py
- API Reference: https://docs.alpaca.markets/reference/
- Community Forum: https://forum.alpaca.markets/

### Webull
- API Docs: https://webullcorporation.com/api
- Python SDK: https://github.com/webull-inc/openapi-python-sdk
- Model Context Protocol: https://webullcorporation.com/mcp

### Interactive Brokers
- TWS API: https://www.interactivebrokers.com/en/trading/tws-api.php
- Python Guide: https://ib-insync.readthedocs.io/
- API Reference: https://interactivebrokers.github.io/tws-api/

### Tradier
- Developer Docs: https://documentation.tradier.com/
- Python Examples: https://github.com/tradier/tradier-python-client

---

## Próximos Pasos Recomendados

1. **Abrir cuenta Alpaca Paper Trading** (hoy, gratis, 5 minutos)
2. **Integrar `alpaca_adapter.py`** en el bot actual (1-2 días)
3. **Testing exhaustivo** en paper trading (1-2 semanas)
4. **Abrir cuenta Live Alpaca** (mientras testeas paper)
5. **Depositar capital inicial** ($100-500, ACH gratis)
6. **Live trading con estrategia validada**
7. **Evaluar expandir a Webull** si necesitas HK stocks

---

**Documentación completa:** Ver `ALPACA_TRADING_GUIDE.md` y `BROKERS_API_COMPARISON.md`

**Fecha de investigación:** 3 de Febrero de 2026
**Brokers analizados:** 5 (Alpaca, Webull, IBKR, Tradier, Schwab)
**Mejor opción para empezar:** Alpaca ($0 depósito, $0 comisiones, API excelente)
**Autor:** Claude Code (Anthropic)
