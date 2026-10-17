# APP 4: ANALIZADOR CRIPTO (Single Symbol)

**Ubicacion:** `4.Analizador cripto/`

Aplicacion optimizada para analizar un solo simbolo a la vez con maxima fluidez y rendimiento.

## Estructura

```
4.Analizador cripto/
├── backend/
│   ├── main.py                    # Servidor FastAPI (puerto 10000)
│   ├── swing_service.py           # Detector de Swing H/L
│   ├── vwap_service.py            # Servicio VWAP backend-native
│   ├── config/                    # Configuraciones persistentes
│   ├── cache/                     # Cache de datos
│   └── logs/                      # Logs de alertas
│
├── frontend/
│   ├── src/components/
│   │   ├── SingleSymbolAnalyzer.jsx  # Componente raiz
│   │   ├── MiniChart.jsx             # Grafico principal
│   │   ├── SymbolList.jsx            # Lista lateral con prefetch
│   │   └── indicators/
│   │       ├── IndicatorManager.js   # Orquestador optimizado
│   │       ├── VWAPIndicator.js      # VWAP backend-native
│   │       └── SwingDetectorIndicator.js
│   ├── src/utils/
│   │   ├── CandleCache.js            # Cache IndexedDB con LRU
│   │   └── IndicatorCache.js         # Cache para indicadores
│   └── 1_START.bat                   # Inicio automatico
```

## Comandos

```bash
# Inicio rapido (Windows)
cd 4.Analizador cripto
1_START.bat

# Manual - Backend
cd backend
start_backend.bat  # Puerto 10000

# Manual - Frontend
cd frontend
npm run dev  # Puerto 10001
```

## Diferencias con App 2 (Watchlist)

| Caracteristica | App 2 (Watchlist) | App 4 (Analizador) |
|----------------|-------------------|---------------------|
| Simbolos simultaneos | Multiples | Uno solo |
| Puerto backend | 8000 | 10000 |
| Puerto frontend | 5173 | 10001 |
| Enfoque | Monitoreo multiple | Analisis profundo |
| Optimizaciones | Standard | Agresivas |

## Optimizaciones de Rendimiento (Enero 2026)

### 1. Eliminacion de React StrictMode
- **Archivo:** `frontend/src/main.jsx`
- **Beneficio:** Evita doble montaje de componentes en desarrollo
- **Impacto:** Reduce tiempo de carga inicial ~50%

### 2. Carga de Indicadores en Paralelo
- **Archivo:** `frontend/src/components/indicators/IndicatorManager.js`
- **Implementacion:** `Promise.all()` para todos los fetches
- **Beneficio:** Los indicadores cargan simultaneamente, no secuencialmente

```javascript
// En refresh()
const fetchPromises = [];
this.indicators.forEach(indicator => {
  if (indicator.fetchData) {
    fetchPromises.push(indicator.fetchData());
  }
});
await Promise.all(fetchPromises);
```

### 3. Lazy Loading de Indicadores
- **Archivo:** `frontend/src/components/indicators/IndicatorManager.js`
- **Implementacion:** Solo crear indicadores cuando `indicatorStates[name] === true`
- **Beneficio:** Ahorra memoria y CPU al no instanciar indicadores deshabilitados

```javascript
// En initialize()
if (indicatorStates['VWAP'] === true) {
  this.indicators.push(new VWAPIndicator(...));
}
```

### 4. Polling Diferido
- **Archivos:** `VWAPIndicator.js`, `SwingDetectorIndicator.js`, `MiniChart.jsx`
- **Implementacion:** Polling NO inicia en `fetchData()`, sino despues de carga completa
- **Metodo:** `startPollingIfReady()` llamado desde `IndicatorManager.startAllPolling()`

```javascript
// En MiniChart.jsx despues de refresh()
indicatorManagerRef.current.refresh().then(() => {
  indicatorManagerRef.current.startAllPolling();
  onChartLoaded();
});
```

### 5. Prefetch en Hover
- **Archivos:** `SymbolList.jsx`, `SingleSymbolAnalyzer.jsx`
- **Implementacion:** Precarga velas cuando el usuario hace hover sobre un simbolo
- **Debounce:** 300ms para evitar requests innecesarios
- **Cache:** Usa `CandleCache` (IndexedDB) para persistencia

```javascript
// Handler con debounce
const handleSymbolHover = (sym) => {
  prefetchTimeoutRef.current = setTimeout(() => {
    prefetchSymbolData(sym);  // Fetch y guarda en CandleCache
  }, 300);
};
```

### 6. Endpoint Batch para Indicadores
- **Archivo:** `backend/main.py`
- **Endpoint:** `POST /api/indicators/batch`
- **Beneficio:** Una sola llamada HTTP para multiples indicadores

```python
# Request
{
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 1,
  "indicators": ["vwap", "swing", "support_resistance"]
}

# Response incluye timing por indicador
{
  "success": true,
  "data": { "vwap": {...}, "swing": {...} },
  "timing": { "vwap": 120, "swing": 85, "total": 150 }
}
```

### Sistema de Cache (CandleCache.js)

```
┌─────────────────────────────────────────────────────────────┐
│                     CANDLE CACHE SYSTEM                      │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐    │
│  │   MEMORIA   │────▶│  IndexedDB  │────▶│   BACKEND   │    │
│  │   (LRU 4)   │     │ (Persistente)│     │   (Bybit)   │    │
│  └─────────────┘     └─────────────┘     └─────────────┘    │
│                                                              │
│  Prioridad: Memoria > IndexedDB > Backend                    │
│  TTL: 24 horas para velas cerradas                           │
│  LRU: Maximo 4 entradas en memoria                           │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Resultados de Optimizacion

| Metrica | Antes | Despues |
|---------|-------|---------|
| Tiempo carga inicial | ~15s | ~4-6s |
| Cambio de simbolo (sin cache) | ~15s | ~4-6s |
| Cambio de simbolo (con cache) | ~15s | <1s |
| Uso de memoria | Alto | Reducido (lazy loading) |
| Requests HTTP iniciales | Secuenciales | Paralelos |

---

## Trading Panel (Enero 2026)

Panel lateral integrado para enviar ordenes directamente a Bybit via el TradingBot backend.

### Archivos

| Archivo | Descripcion |
|---------|-------------|
| `frontend/src/components/trading/TradingPanel.jsx` | Panel principal con conexion al TradingBot |
| `frontend/src/components/trading/TradingPanel.css` | Estilos con sistema de temas dinamico |
| `frontend/src/components/trading/OrderForm.jsx` | Formulario de orden con modos de cantidad |
| `frontend/src/components/trading/PositionCard.jsx` | Muestra posicion activa con PnL |
| `frontend/src/components/trading/index.js` | Exports del modulo |

### Funcionalidades

1. **Integracion con TPSLBox**: Lee Entry, SL, TP desde rectangulos dibujados en el chart
2. **Dos modos de cantidad**:
   - **Monto fijo**: Especifica USDT directamente
   - **Por riesgo**: Calcula cantidad basado en riesgo y % de SL
3. **Conexion al TradingBot**: Se conecta al backend en puerto 5000
4. **Visualizacion de posicion**: Muestra posicion activa con PnL en tiempo real
5. **Temas personalizables**: Selector de color (hue) + modo claro/oscuro

### Shortcut

- **Alt+T**: Abre/cierra el Trading Panel
- El panel tambien tiene boton en el header del chart

### Flujo de Orden

```
1. Usuario dibuja TPSLBox en el chart (Entry, SL, TP)
2. Presiona Alt+T para abrir Trading Panel
3. Panel carga datos de la caja automaticamente
4. Usuario selecciona modo de cantidad y confirma
5. Panel envia orden a TradingBot (puerto 5000)
6. TradingBot ejecuta: Market Order → SL → TP
7. Panel muestra posicion resultante
```

### Sistema de Temas

El panel usa CSS variables generadas dinamicamente basadas en un valor HSL (hue):

```javascript
// TradingPanel.jsx
const generateThemeColors = (hue, isDark = true) => {
  if (isDark) {
    return {
      bgPrimary: `hsl(${hue}, 15%, 12%)`,
      bgSecondary: `hsl(${hue}, 15%, 16%)`,
      // ... mas colores derivados
    };
  } else {
    // Modo claro con colores invertidos
  }
};
```

Controles en el header:
- **Slider de color**: 0-360 grados de hue
- **Boton sol/luna**: Alterna modo claro/oscuro

Persistencia en localStorage:
- `tradingPanelHue`: Valor del hue (0-360)
- `tradingPanelDarkMode`: "true" o "false"

### Conexion con TradingBot

El panel se comunica con el TradingBot backend:

```javascript
const TRADING_BOT_URL = 'http://localhost:5000';

// Verificar conexion
GET /api/status

// Cargar config del simbolo
GET /api/config  // Retorna { coins: [...] }

// Cargar posicion actual
GET /api/position/{symbol}

// Enviar orden
POST /api/trade/manual
{
  "symbol": "BTCUSDT",
  "side": "Buy",
  "quantity": 0.001,
  "stopLoss": 95000,
  "takeProfit": 100000
}
```

### Modificaciones al TradingBot

Para soportar ordenes desde el Analizador, se modifico:

**`3.TradingBot_Python/backend/main.py`:**
```python
class ManualTradeRequest(BaseModel):
    symbol: str
    side: str
    quantity: Optional[Decimal] = None
    current_price: Optional[Decimal] = None
    stopLoss: Optional[Decimal] = None      # NUEVO
    takeProfit: Optional[Decimal] = None    # NUEVO
```

**`3.TradingBot_Python/backend/trading/order_manager.py`:**
```python
# Usa SL/TP custom si se proporcionan
if config.get("custom_stop_loss"):
    sl_price = Decimal(str(config["custom_stop_loss"]))
else:
    sl_price = self._calculate_sl_price(real_price, side, sl_percent)
```

### Troubleshooting Trading Panel

**"Simbolo no configurado":**
- Verificar que el simbolo existe en `3.TradingBot_Python/config/trading_config.json`
- El panel busca en `data.coins` del endpoint `/api/config`

**"TradingBot no disponible":**
- Verificar que el backend del TradingBot esta corriendo en puerto 5000
- Comando: `cd 3.TradingBot_Python/backend && python main.py`

**Posicion no se muestra:**
- El endpoint `/api/position/{symbol}` devuelve datos directamente (no anidados)
- Campos: `hasPosition`, `size`, `side`, `entryPrice`, `unrealizedPnl`, `markPrice`

**Orden falla:**
- Revisar logs del TradingBot
- Verificar credenciales Bybit configuradas
- Verificar modo (Demo vs Live)

---

# TROUBLESHOOTING

**Backend no inicia:**
- Verificar Python 3.10+
- Verificar puerto no en uso (8000, 9000, 5000)
- Verificar .venv existe

**Frontend no carga graficos:**
- Verificar backend corriendo
- Revisar consola por errores CORS

**Alertas no llegan al Bot:**
- Verificar Bot corriendo en puerto 5000
- Verificar direccion del simbolo no es DISABLED

**Ordenes no se ejecutan:**
- Verificar credenciales Bybit
- Verificar modo (Demo vs Live)
- Revisar logs del Bot

**Datos desactualizados:**
- POST /api/clear-cache en backend correspondiente

**Modal VWAP opciones avanzadas no se expande:**
- Fix aplicado (Enero 2026): La condicion `showAdvanced && showBands && bandMultipliers` impedia mostrar contenido
- Solucion: Separar condicion - `showAdvanced` para mostrar panel, `showBands && bandMultipliers` solo para multiplicadores
- Archivo: `4.Analizador cripto/frontend/src/components/VWAPSettings.jsx`
- CSS: Aumentar `max-height` de 70vh a 85vh en `VWAPSettings.css`

**Carga muy lenta de graficos:**
- Reducir `days` en swing_config.json
- Verificar que no hay requests de 30+ dias en timeframe 1m
- Revisar logs del backend para ver cuantas velas se cargan

**VWAP no se actualiza al cambiar timeframe:**
- El indicador debe tener metodo `setInterval()`
- IndicatorManager.refresh() debe actualizar interval del VWAP

**Zonas de precio no filtran senales:**
- Reiniciar backend para cargar nueva config
- Verificar que `timeBound`, `timeStart`, `timeEnd` estan correctos
- Las zonas nuevas disparan re-analisis automatico

---

# ZONE DETECTOR 2.0 / STRATEGY TESTER (Enero 2026)

Sistema para detectar zonas de consolidación y crear estrategias de trading basadas en ellas.

**Plan completo:** Ver `1.Altagracia_Crypto_Backtester/STRATEGY_TESTER_PLAN.md`

## Estado Actual

### Completado - Phase 1: Zone Detector
- **Zone Detector 2.0**: 4 métodos de detección (pivot_cluster, atr_based, volume_profile, price_action)
- **Zone Evaluator**: Métricas de calidad de zonas
- **Zone Optimizer**: Grid search y walk-forward
- **UI ZoneDetectorTester**: Modal con tabs Detectar/Evaluar/Comparar/Optimizar
- **Visualización**: Zonas se renderizan en el gráfico
- **Anti-bias**: Zonas se calculan solo con datos anteriores a fecha de playback

### Completado - Phase 2: Strategy Builder (Enero 2026)
- **Strategy Model** (`strategy_model.py`): Dataclasses para Strategy, EntryRules, Conditions, RiskManagement
- **Strategy Store** (`strategy_store.py`): Persistencia JSON con CRUD completo
- **Strategy Executor** (`strategy_executor.py`): Motor de backtesting con detección de zonas
- **StrategyBuilder.jsx**: UI completa con 4 secciones (Básico, Entrada, Riesgo, Filtros)
- **ConditionEditor.jsx**: Editor dinámico de condiciones de entrada
- **StrategyList.jsx**: Lista de estrategias con filtro, duplicar, eliminar
- **BacktestResults.jsx**: Visualización de resultados con métricas, trades y equity curve
- **Templates**: 3 estrategias predefinidas (range_bounce, breakout, aggressive_scalp)
- **Endpoints API**: CRUD + backtest + quick-backtest

### En Refinamiento
- **Zone Detector**: Las zonas detectadas son algorítmicamente correctas pero pueden no coincidir con las expectativas visuales del trader. Ajuste continuo de parámetros.

## Archivos del Sistema

### Backend (`1.Altagracia_Crypto_Backtester/Backtester/backend/`)

| Archivo | Descripción |
|---------|-------------|
| `zone_detector.py` | 4 métodos de detección de zonas |
| `zone_evaluator.py` | Evaluación de calidad de zonas |
| `zone_optimizer.py` | Optimización de parámetros |
| `strategy_model.py` | Dataclasses: Strategy, EntryRules, Conditions, RiskManagement |
| `strategy_store.py` | Persistencia JSON de estrategias (CRUD) |
| `strategy_executor.py` | Motor de backtesting con Trade, Signal, BacktestResult |
| `main.py` (líneas 2690-3100) | Endpoints API de zonas |
| `main.py` (líneas 3120-3490) | Endpoints API de estrategias |
| `strategies/` | Directorio con estrategias guardadas en JSON |

### Frontend (`1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/`)

| Archivo | Descripción |
|---------|-------------|
| `ZoneDetectorTester.jsx` | Modal de testing de zonas |
| `ZoneDetectorTester.css` | Estilos del modal |
| `indicators/ZoneVisualizerIndicator.js` | Renderiza zonas en el gráfico |
| `strategy/StrategyBuilder.jsx` | UI para crear/editar estrategias |
| `strategy/StrategyList.jsx` | Lista de estrategias guardadas |
| `strategy/ConditionEditor.jsx` | Editor de condiciones de entrada |
| `strategy/BacktestResults.jsx` | Visualización de resultados del backtest |
| `strategy/StrategyBuilder.css` | Estilos del Strategy Builder |
| `strategy/BacktestResults.css` | Estilos del panel de resultados |
| `strategy/index.js` | Exports del módulo strategy |

## Endpoints API

### Zone Detector

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/zones/methods` | GET | Lista métodos disponibles |
| `/api/zones/detect` | POST | Detecta zonas con método especificado |
| `/api/zones/evaluate` | POST | Evalúa calidad de zonas detectadas |
| `/api/zones/compare-methods` | POST | Compara todos los métodos |
| `/api/zones/optimize` | POST | Optimiza parámetros (grid search) |

### Strategy Builder

| Endpoint | Método | Descripción |
|----------|--------|-------------|
| `/api/strategies` | GET | Lista todas las estrategias guardadas |
| `/api/strategies/templates` | GET | Lista templates disponibles |
| `/api/strategies/{id}` | GET | Obtiene una estrategia por ID |
| `/api/strategies` | POST | Crea nueva estrategia (o desde template) |
| `/api/strategies/{id}` | PUT | Actualiza estrategia existente |
| `/api/strategies/{id}` | DELETE | Elimina una estrategia |
| `/api/strategies/{id}/duplicate` | POST | Duplica una estrategia |
| `/api/strategies/validate` | POST | Valida sintaxis de estrategia |
| `/api/strategies/{id}/backtest` | POST | Ejecuta backtest de estrategia guardada |
| `/api/strategies/quick-backtest` | POST | Backtest sin guardar (inline strategy) |

### Parámetros Comunes

```json
{
  "symbol": "BTCUSDT",
  "interval": "60",
  "days": 365,
  "method": "pivot_cluster",
  "end_timestamp": 1704067200000,  // Opcional: fecha límite (playback)
  "params": {
    "max_price_range_pct": 5.0,
    "pivot_tolerance_pct": 0.3,
    "pivot_min_touches": 3
  }
}
```

## Métodos de Detección

| Método | Descripción | Mejor para |
|--------|-------------|------------|
| `pivot_cluster` | Agrupa pivots cercanos | Zonas de S/R tradicionales |
| `atr_based` | Detecta baja volatilidad | Consolidaciones/rangos |
| `volume_profile` | Identifica alto volumen | POC, VAH, VAL |
| `price_action` | Cuenta toques a niveles | Niveles psicológicos |

## Estructura de Estrategia

```python
Strategy:
  id: str
  name: str
  description: str
  zone_config:              # Config del detector de zonas
    method: str             # pivot_cluster, atr_based, etc
    params: dict            # Parámetros del método
  entry:
    trigger: str            # price_touches_zone, price_breaks_zone, etc
    direction: str          # LONG, SHORT, BOTH
    conditions: List[Condition]  # Condiciones adicionales
    require_all_conditions: bool
    confirmation_candles: int
  risk_management:
    sizing:
      method: str           # fixed_risk, fixed_amount, percent_equity
      risk_percent: float
    stop_loss:
      type: str             # below_zone, atr_multiple, fixed_percent
      buffer_percent: float
      use_trailing: bool
    take_profit:
      type: str             # risk_reward, opposite_zone, fixed_percent
      risk_reward_ratio: float
  filters:
    max_open_trades: int
    max_daily_trades: int
    min_time_between_trades: int  # minutos
    max_daily_loss_percent: float
    min_zone_score: int
```

## Flujo de Backtest

```
1. Frontend: StrategyBuilder → handleRunBacktest()
   ↓
2. POST /api/strategies/quick-backtest o /{id}/backtest
   Body: { symbol, strategy, current_time }
   ↓
3. Backend: Fetch candles históricos
   ↓
4. Zone Detector: Detectar zonas (usando zone_config de estrategia)
   ↓
5. Strategy Executor: Procesar velas una por una
   - Por cada vela:
     a) Actualizar zonas activas
     b) Gestionar trades abiertos (SL/TP)
     c) Verificar condiciones de entrada
     d) Ejecutar entrada si aplica
     e) Registrar equity
   ↓
6. Generar BacktestResult:
   - trades: Lista de trades ejecutados
   - signals: Señales de entrada/salida
   - metrics: win_rate, profit_factor, max_drawdown, etc
   - equity_curve: [{timestamp, equity}]
   ↓
7. Frontend: BacktestResults muestra resultados
```

## Integración con Playback

El parámetro `end_timestamp` evita survival bias:

```javascript
// ZoneDetectorTester.jsx
if (playbackStartTime) {
  requestBody.end_timestamp = playbackStartTime;
}
```

```python
# main.py - /api/zones/detect
if end_timestamp:
    candles = [c for c in candles if c['timestamp'] < end_timestamp]
```

## Troubleshooting

**Zonas no aparecen en el gráfico:**
- Verificar que ZoneVisualizerIndicator está habilitado
- Verificar que el callback `onZonesDetected` llama a `miniChart.setZones()`
- Revisar consola por errores de `priceToY`

**Zonas demasiado grandes:**
- Reducir `max_price_range_pct` (default 5%)
- Aumentar `pivot_min_touches` para zonas más validadas

**Detección no coincide con expectativas del trader:**
- El detector actual es algorítmico, puede no capturar contexto de mercado
- Considerar usar método `pivot_cluster` con parámetros más estrictos
- El refinamiento del detector es un trabajo en progreso

---

# ZOOM SYSTEM - BACKTESTER (Octubre 2026)

Sistema de zoom horizontal en el Backtester que permite comprimir velas hasta mostrar ~14,000 velas en pantalla.

## Arquitectura

El zoom usa `viewStateRef.current.zoom` como multiplicador sobre un ancho base de 8px:

```javascript
// Formula central aplicada en 4 ubicaciones criticas
const effectiveBarWidth = Math.max(0.1, Math.min(15, 8 * zoom));
const candlesPerScreen = Math.floor(chartWidth / effectiveBarWidth);
```

## Limites

| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| Min zoom | `0.01` | Zoom out extremo |
| Max zoom | `5` | Zoom in extremo |
| Min ancho vela | `0.1px` | Compresion maxima (~14,000 velas en 15") |
| Max ancho vela | `15px` | Expansion maxima |

## Ubicaciones Criticas (MiniChart.jsx del Backtester)

La formula `effectiveBarWidth` debe ser consistente en estas 4 ubicaciones:

1. **drawChart** (~linea 651): Calculo principal de velas visibles
2. **Wheel handler** (~linea 1600): Ajuste de offset post-zoom
3. **Pan handler** (~linea 1357): Calculo de desplazamiento durante paneo
4. **Auto-offset** (~linea 1839): Calculo de margen derecho automatico

## Diferencias con App 8 (AnalizadorDesktop)

| Aspecto | Backtester (App 1) | AnalizadorDesktop (App 8) |
|---------|-------------------|---------------------------|
| Min zoom | `0.01` | `0.02` |
| Min ancho vela | `0.1px` | `0.5px` |
| Max velas (~1422px) | ~14,220 | ~2,844 |
| Calculo min zoom | Fijo | Fijo |

El Backtester permite mayor compresion porque necesita mostrar hasta 5 anos de datos historicos en pantalla.

## Historial

- **v3.0**: Zoom dinamico con minimo calculado por total de velas (limitaba a ~2800 velas)
- **v4.0 (Octubre 2026)**: Limites fijos, effectiveBarWidth clamp, ~14,000 velas visibles

---

# DRAWING SYSTEM (MiniChart.jsx)

## Arquitectura de Dibujos

El sistema de dibujos tiene dos estados paralelos que deben mantenerse sincronizados:

1. **`drawingsRef`**: Array de shapes deserializados para renderizado readonly (fuera de modo dibujo)
2. **`DrawingToolManager`**: Instancia que gestiona shapes durante modo dibujo (edicion)

### Persistencia

Los dibujos se guardan en `backend/drawings/{symbol}.json` via:
```
POST /api/drawings/{symbol}
GET /api/drawings/{symbol}
```

### Flujo de Sincronizacion (Fix Enero 2026)

```
ENTRAR A MODO DIBUJO:
  1. Se crea DrawingToolManager (si no existe)
  2. loadDrawingsIntoManager() carga shapes desde servidor
  3. DrawingToolManager renderiza durante edicion

DURANTE MODO DIBUJO:
  - Cada cambio (crear, mover, eliminar) llama saveDrawingsInline()
  - saveDrawingsInline() sincroniza drawingsRef Y guarda al servidor

SALIR DE MODO DIBUJO:  ← FIX CRITICO
  1. useEffect detecta transicion drawingMode: true → false
  2. Sincroniza drawingsRef con shapes actuales del manager
  3. Guarda al servidor via saveDrawingsInline()
  4. Fuerza re-render con setDrawingsVersion()
```

### Problema Resuelto: Rectangulos Borrados Reaparecen

**Sintomas:**
- Rectangulos eliminados reaparecian al mover el mouse
- SwingDetectorSettings mostraba rectangulos que ya no existian
- Rectangulos usados como zona desaparecian pero reaparecian en modo dibujo

**Causa:**
Al salir del modo dibujo, los cambios en DrawingToolManager NO se guardaban al servidor.
El modal SwingDetectorSettings consultaba `/api/drawings/` que tenia datos desactualizados.

**Fix 1 - Guardar al salir** (MiniChart.jsx:343-356):
```javascript
// Detectar transicion de drawingMode: true -> false
const prevDrawingModeRef = useRef(drawingMode);
useEffect(() => {
  if (prevDrawingModeRef.current && !drawingMode) {
    if (drawingManagerRef.current) {
      // saveDrawingsInline() sincroniza drawingsRef, guarda al servidor y fuerza re-render
      saveDrawingsInline();
    }
  }
  prevDrawingModeRef.current = drawingMode;
}, [drawingMode]);
```

### Problema Resuelto: Dibujos Desaparecen en Modo Dibujo

**Sintomas:**
- Al entrar al modo dibujo por segunda vez, los shapes desaparecian
- TPSLBox y otros dibujos no se renderizaban al mover el mouse
- Al salir del modo dibujo, los shapes seguian sin aparecer

**Causa:**
El DrawingToolManager solo cargaba shapes del servidor la PRIMERA vez que se creaba.
En entradas subsecuentes al modo dibujo, el manager existia pero tenia shapes vacios/desactualizados.

**Fix 2 - Cargar siempre al entrar** (MiniChart.jsx:310-334):
```javascript
useEffect(() => {
  if (drawingMode && !externalDrawingManager) {
    if (!internalDrawingManagerRef.current) {
      // Primera vez: crear el manager
      internalDrawingManagerRef.current = new DrawingToolManager(...);
    }
    // 🔄 FIX: SIEMPRE cargar dibujos al entrar (no solo la primera vez)
    loadDrawingsIntoManager();
  }
}, [drawingMode, symbol, interval, externalDrawingManager]);
```

### Archivos Relacionados

| Archivo | Responsabilidad |
|---------|-----------------|
| `MiniChart.jsx` | Orquesta renderizado y sincronizacion |
| `DrawingToolManager.js` | Gestiona shapes durante edicion |
| `drawing/shapes/*.js` | Clases de cada tipo de shape |
| `backend/drawings/*.json` | Persistencia por simbolo |

### Troubleshooting Dibujos

**Rectangulos fantasma (despues del fix):**
- Limpiar localStorage y recargar pagina
- Verificar que `backend/drawings/{symbol}.json` tiene datos correctos
- El problema original fue resuelto guardando al salir del modo dibujo

**Dibujos no se guardan:**
- Verificar consola por errores en `saveDrawingsInline()`
- Verificar que backend esta corriendo y endpoint `/api/drawings/` responde

**Shapes se duplican:**
- Posible problema de doble renderizado
- Verificar que solo se usa drawingManagerRef.render() EN modo dibujo
- Fuera de modo dibujo, solo drawingsRef.current deberia renderizarse

**Dibujos desaparecen al entrar/salir del modo dibujo:**
- El fix actual (Enero 2026) resuelve esto cargando SIEMPRE al entrar y guardando al salir
- Si persiste: verificar que `loadDrawingsIntoManager()` se llama en cada entrada
- Revisar consola por errores de fetch en `/api/drawings/`

**Verificar optimizaciones de rendimiento (Enero 2026):**
- Consola: Buscar logs `[StorageManager]` y `[PollingScheduler]`
- StorageManager debe mostrar "Flushed N pending writes" cada 2 segundos
- PollingScheduler debe mostrar "Started" y callbacks registrados
- DevTools Performance: CPU debe bajar ~50% comparado con version anterior
- Network: Conexiones HTTP deben reutilizarse (ver Connection: keep-alive)

---

