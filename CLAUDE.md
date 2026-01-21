# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en español con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en español.

### Perfil
Agente programador Python con experiencia en desarrollo de aplicaciones.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional, no mostrar borradores ni codigo parcial en el chat.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas, evitar refactors grandes.
5. **Analisis profundo**: Cuando se solicite, revisar archivos relacionados, dependencias, edge cases y posibles efectos secundarios.

### Limitaciones conocidas
- No puedo ejecutar codigo Python directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL DEL REPOSITORIO

Este repositorio contiene **4 aplicaciones relacionadas** para trading de criptomonedas:

| Carpeta | Aplicacion | Puerto Backend | Puerto Frontend |
|---------|------------|----------------|-----------------|
| `1.Altagracia_Crypto_Backtester/` | Backtester de estrategias | 9000 | 5173 |
| `2.WatchlistConIndicadores/` | Watchlist con indicadores en tiempo real | 8000 | 5173 |
| `3.TradingBot_Python/` | Bot de trading automatizado | 5000 | 3000 |
| `4.Analizador cripto/` | Analizador de un solo símbolo (optimizado) | 10000 | 10001 |

**Stack comun:**
- Frontend: React 18 + Vite + uPlot
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)

---

# APP 1: ALTAGRACIA CRYPTO BACKTESTER

**Ubicacion:** `1.Altagracia_Crypto_Backtester/Backtester/`

Sistema profesional de backtesting para criptomonedas con analisis avanzado de patrones, volumen y momentum.

## Estructura

```
Backtester/
├── backend/
│   ├── main.py                      # Servidor principal (94KB, ~2400 lineas)
│   ├── double_topbottom_detector.py # Detector DTB (60KB)
│   ├── rejection_detector.py        # Detector patrones rechazo (19KB)
│   ├── alert_sender.py              # Sistema alertas (10KB)
│   ├── vwap_calculator.py           # Calculador VWAP (13KB)
│   ├── cache/                       # Cache datos historicos
│   ├── backtesting_cache/           # Cache especifico backtesting
│   └── drawings/                    # Dibujos guardados (JSON)
│
├── frontend/
│   ├── src/components/
│   │   ├── backtesting/
│   │   │   ├── BacktestingApp.jsx   # Componente raiz (84KB)
│   │   │   ├── BacktestingChart.jsx # Grafico principal (43KB)
│   │   │   ├── TimeController.js    # Control temporal (12KB)
│   │   │   ├── OrderManager.js      # Gestor ordenes (18KB)
│   │   │   ├── TradingControls.jsx  # Controles trading (11KB)
│   │   │   ├── PerformancePanel.jsx # Metricas (11KB)
│   │   │   ├── TradeHistory.jsx     # Historial (7KB)
│   │   │   └── SessionManager.js    # Sesiones (9KB)
│   │   ├── indicators/              # Sistema indicadores (compartido)
│   │   ├── MiniChart.jsx            # Grafico con indicadores (92KB)
│   │   └── Watchlist.jsx            # Watchlist (13KB)
│   └── dist/                        # Build produccion
```

## Comandos

```bash
# Backend
cd 1.Altagracia_Crypto_Backtester/Backtester/backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000

# Frontend
cd 1.Altagracia_Crypto_Backtester/Backtester/frontend
npm install && npm run dev
```

## Funcionalidades

- **29 pares de criptomonedas** soportados
- **10 indicadores tecnicos** simultaneos
- **Deteccion automatica** de patrones (DTB, Rejection)
- **Backtesting realista** con ordenes market/limit/stop
- **TimeController** con subdivisiones intravela (1x, 2x, 5x, 10x)
- **Metricas**: win rate, drawdown, Sharpe ratio
- **Zoom dinamico v3.0** similar a TradingView
- **Exportacion**: Excel, CSV, PNG
- **Persistencia de sesiones**

## Endpoints Backend

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado servidor |
| `/api/historical/{symbol}` | GET | Datos OHLCV |
| `/api/volume-delta/{symbol}` | GET | Volume Delta + CVD |
| `/api/rejection-patterns/detect` | POST | Detecta patrones |
| `/api/double-topbottom/detect` | POST | Detecta DTB |
| `/api/double-topbottom/chunk` | GET | DTB por chunks |

---

# APP 2: WATCHLIST CON INDICADORES

**Ubicacion:** `2.WatchlistConIndicadores/`

Watchlist en tiempo real con indicadores avanzados y sistema de alertas.

## Estructura

```
2.WatchlistConIndicadores/
├── backend/
│   ├── main.py                       # Servidor principal (~3000 lineas)
│   ├── alert_sender.py               # Sistema alertas (puerto 5000)
│   ├── config_store.py               # Store configuracion
│   ├── double_topbottom_detector.py  # Detector DTB (63KB)
│   ├── rejection_detector.py         # Detector rechazo (28KB)
│   ├── realtime_pattern_service.py   # Orquestador deteccion (35KB)
│   ├── pattern_state_manager.py      # Estado patrones (14KB)
│   ├── websocket_manager.py          # WebSocket Bybit (15KB)
│   ├── vwap_calculator.py            # VWAP
│   ├── fibonacci_calculator.py       # Fibonacci
│   ├── cache/                        # Cache (30 min TTL)
│   ├── config/                       # Configuraciones
│   └── drawings/                     # Dibujos por simbolo
│
├── frontend/
│   ├── src/components/
│   │   ├── Watchlist.jsx             # Raiz (51KB)
│   │   ├── MiniChart.jsx             # Grafico (105KB)
│   │   ├── AlertHistoryPanel.jsx
│   │   ├── *Settings.jsx             # Configuraciones
│   │   ├── indicators/
│   │   │   ├── IndicatorManager.js   # Orquestador (56KB)
│   │   │   ├── RejectionPatternIndicator.js (114KB)
│   │   │   ├── DoubleTopBottomIndicator.js (96KB)
│   │   │   ├── VWAPIndicator.js (41KB)
│   │   │   ├── VolumeProfileIndicator.js
│   │   │   ├── CVDIndicator.js
│   │   │   └── ... (13 indicadores)
│   │   ├── drawing/
│   │   ├── ProximityAlerts/
│   │   └── SlidingAlertPanel/
│   ├── hooks/useGlobalAlerts.js
│   └── utils/
```

## Comandos

```bash
# Backend
cd 2.WatchlistConIndicadores/backend
start_backend.bat  # O manual con uvicorn --port 8000

# Frontend
cd 2.WatchlistConIndicadores/frontend
npm install && npm run dev
```

## Funcionalidades

- **Tiempo real** via WebSocket Bybit
- **13 indicadores** activos simultaneos
- **Deteccion de patrones**: DTB, Rejection (Hammer, Shooting Star, Engulfing, Doji)
- **Sistema de alertas**: Backend, Browser Notifications, localStorage
- **Volume Profile**: dinamico y rangos fijos
- **VWAP** con bandas de desviacion
- **Range Detection** basado en ATR
- **Herramientas de dibujo** persistentes

## Patrones Detectados

| Patron | Emoji | Direccion |
|--------|-------|-----------|
| HAMMER | 🔨 | Alcista |
| SHOOTING_STAR | ⭐ | Bajista |
| ENGULFING_BULLISH | 📈 | Alcista |
| ENGULFING_BEARISH | 📉 | Bajista |
| DOJI_DRAGONFLY | 🐉 | Alcista |
| DOJI_GRAVESTONE | 🪦 | Bajista |
| DOUBLE_TOP | 🔻 | Bajista |
| DOUBLE_BOTTOM | 🔺 | Alcista |

## Limites de Timeframe

**CRITICO: Deben coincidir en backend Y frontend**

```python
MAX_DAYS_BY_INTERVAL = {
    "1": 5, "5": 30, "15": 90, "60": 360, "240": 720, "D": 1440, "W": 730
}
```

---

# APP 3: TRADING BOT PYTHON

**Ubicacion:** `3.TradingBot_Python/`

Bot de trading automatizado que ejecuta ordenes en Bybit basado en alertas.

## Estructura

```
3.TradingBot_Python/
├── backend/
│   ├── main.py                  # Servidor FastAPI (1037 lineas)
│   ├── trading/
│   │   ├── bybit_client.py      # Cliente API Bybit (427 lineas)
│   │   ├── order_manager.py     # Gestor ordenes (282 lineas)
│   │   ├── risk_calculator.py   # Calculadora riesgo (121 lineas)
│   │   ├── direction_manager.py # Filtros direccion (126 lineas)
│   │   └── alert_parser.py      # Parser alertas ATAS (163 lineas)
│   └── requirements.txt
│
├── frontend/
│   └── src/                     # React UI
│
├── config/
│   ├── trading_config.json      # Config 16 simbolos
│   ├── credentials.json         # API keys (runtime)
│   └── trading_directions.json  # Direcciones permitidas
│
├── START_HERE.bat               # Inicio automatico
├── QUICKSTART.md
└── README.md
```

## Comandos

```bash
# Inicio automatico (Windows)
double-click START_HERE.bat

# Manual - Backend
cd 3.TradingBot_Python/backend
python -m venv venv && venv\Scripts\activate
pip install -r requirements.txt
python main.py  # Puerto 5000

# Frontend
cd 3.TradingBot_Python/frontend
npm install && npm run dev  # Puerto 3000
```

## Funcionalidades

- **Cliente Bybit** con firma HMAC-SHA256 y timestamp sync
- **3 ordenes secuenciales**: Market → Stop Loss → Take Profit
- **Calculo automatico** de cantidades basado en riesgo
- **16 simbolos** preconfigurados con StepSize/TickSize exactos
- **Parser de alertas** (3 formatos: ATAS, multi-linea, simple)
- **Filtros de direccion**: LONG/SHORT/BOTH/DISABLED
- **Prevencion de race conditions** con locks por simbolo
- **WebSocket** para logs en tiempo real
- **Modos**: Demo Trading, Live Trading, Testnet

## Endpoints Principales

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado servidor |
| `/api/credentials` | POST | Configura API keys |
| `/api/config` | GET | Lista simbolos |
| `/api/directions` | GET/POST | Filtros direccion |
| `/api/alert` | POST | Procesa alerta ATAS |
| `/api/watchlist-alert` | POST | Alerta JSON estructurado |
| `/api/trade/manual` | POST | Trade manual |
| `/api/position/{symbol}` | GET | Posicion actual |
| `/api/logs` | GET | Ultimos logs |
| `/api/orders/history` | GET | Historial ordenes |

## Flujo de Alerta

```
Alerta recibida → POST /api/alert
    ↓
Parsear con regex → alert_parser.py
    ↓
Validar formato
    ↓
Filtrar por direccion → direction_manager
    ↓
Obtener config del simbolo
    ↓
ADQUIRIR LOCK (por simbolo)
    ↓
Verificar posicion existente → bybit_client
    ↓
Calcular cantidad → risk_calculator
    ↓
EJECUTAR SECUENCIA → order_manager
    ├─ Market Order
    ├─ Wait 3s → Get real price
    ├─ Place SL (wait 1s)
    └─ Place TP (wait 1s)
    ↓
Guardar historial
    ↓
Broadcast WebSocket
```

## Simbolos Configurados (16)

| Symbol | Risk | SL % | TP % | StepSize |
|--------|------|------|------|----------|
| BTCUSDT | $3.0 | 2.2% | 4.5% | 0.001 |
| ETHUSDT | $2.1 | 2.3% | 4.0% | 0.01 |
| SOLUSDT | $2.0 | 1.0% | 2.0% | 0.1 |
| ADAUSDT | $1.0 | 1.0% | 2.0% | 1.0 |
| ... (12 mas) |

---

# INTEGRACION ENTRE APLICACIONES

## Flujo Completo de Trading

```
1. BACKTESTER (App 1)
   - Desarrolla y prueba estrategias
   - Analiza patrones historicos
   - Optimiza parametros
   ↓
2. WATCHLIST (App 2)
   - Monitorea mercado en tiempo real
   - Detecta patrones configurados
   - Genera alertas automaticas
   ↓
3. TRADING BOT (App 3)
   - Recibe alertas de Watchlist (puerto 5000)
   - Ejecuta ordenes en Bybit
   - Gestiona SL/TP automaticamente
```

## Conexion Watchlist → Bot

La Watchlist envia alertas al puerto 5000:

```python
# En 2.WatchlistConIndicadores/backend/alert_sender.py
async def send_alert(alert_data):
    await httpx.post("http://localhost:5000/api/watchlist-alert", json=alert_data)
```

El Bot las recibe y ejecuta:

```python
# En 3.TradingBot_Python/backend/main.py
@app.post("/api/watchlist-alert")
async def process_watchlist_alert(alert: dict):
    # Ejecuta orden si pasa filtros
```

---

# AREAS DE MEJORA GLOBALES

## P0 - Critico

1. **Codigo duplicado en indicadores**
   - Sistemas de alertas casi identicos en RejectionPatternIndicator y DoubleTopBottomIndicator
   - Solucion: Crear `BaseIndicatorWithAlerts`

2. **Configuraciones duplicadas**
   - MAX_DAYS_BY_INTERVAL en backend Y frontend
   - Solucion: Endpoint API que retorne limites

3. **Archivos deprecated**
   - Multiples backups y versiones _1, _fixed, etc.
   - Solucion: Limpiar y usar git history

## P1 - Alto

1. **localStorage Management**
   - 91+ instancias sin centralizar
   - Solucion: Crear `StorageManager`

2. **Deteccion de patrones duplicada**
   - Frontend y backend tienen logica similar
   - Solucion: Centralizar en backend

3. **Logging inconsistente**
   - Mezcla de console.log y Logger
   - Solucion: Usar siempre Logger

## P2 - Medio

1. **Performance**
   - Precarga deshabilitada, re-renders frecuentes
   - Solucion: React.memo, Web Workers

2. **Base de datos**
   - Todo en JSON, no hay DB real
   - Solucion: SQLite o PostgreSQL

3. **Tests**
   - Tests abandonados, no CI/CD
   - Solucion: Integrar en pipeline

---

# ESTADISTICAS GLOBALES

| Metrica | Backtester | Watchlist | Trading Bot | Total |
|---------|------------|-----------|-------------|-------|
| Python LOC | ~3,000 | ~3,000 | ~2,200 | ~8,200 |
| React LOC | ~4,000 | ~15,000 | ~3,000 | ~22,000 |
| Indicadores | 10 | 13 | - | 13 (compartidos) |
| Simbolos | 29 | 2 activos | 16 | 29 |
| Endpoints | 8 | 10 | 12 | 30 |

---

# ARQUITECTURA DE ALERTAS BACKEND (Watchlist → Trading Bot)

## Objetivo
El backend es el UNICO responsable de detectar patrones y enviar alertas al Trading Bot.
El frontend solo debe GRAFICAR patrones, nunca enviar alertas.

## Flujo de Alertas Backend

```
1. CONEXION WEBSOCKET
   websocket_manager.py → Binance/Bybit WebSocket
        ↓
   Recibe candles en tiempo real
        ↓
2. DETECCION (en realtime_pattern_service.py)
   _on_candle_close()
        ↓
   _detect_patterns() → Requiere minimo 50 velas
        ↓
   _detect_dbt_patterns() / _detect_rejection_patterns()
        ↓
   Verifica alertsEnabled en config (default: True)
        ↓
3. PROCESAMIENTO
   _process_dbt_pattern() / _process_rejection_pattern()
        ↓
   Filtros: minConfidence, cooldown, rate-limit, VWAP
        ↓
4. ENVIO (via alert_sender.py)
   _send_alert() → send_rejection_pattern_alert()
        ↓
   SISTEMA DE COLA ASINCRONA:
   - Encola el alert_payload
   - Retorna True inmediatamente
   - Proceso en background: _process_alert_queue()
        ↓
5. ENTREGA
   POST http://localhost:5000/api/watchlist-alert
        ↓
   Trading Bot recibe y ejecuta
```

## Archivos Clave

| Archivo | Responsabilidad |
|---------|-----------------|
| `realtime_pattern_service.py` | Orquestador de deteccion realtime |
| `websocket_manager.py` | Conexion WebSocket a exchange |
| `pattern_state_manager.py` | Deduplicacion y cooldown |
| `config_store.py` | Configs sincronizados desde frontend |
| `alert_sender.py` | Cola asincrona y envio HTTP |

## Configuracion por Defecto

```python
# _get_default_dbt_config() - linea 786
{
    'alertsEnabled': True,
    'filters': {'minConfidence': 60},
    'alertSettings': {
        'globalCooldown': {'enabled': True, 'minutes': 30}
    }
}

# _get_default_rejection_config() - linea 805
{
    'alertsEnabled': True,
    'filters': {'minConfidence': 50, 'requireNearLevel': False},
    'alertCooldown': {'enabled': True, 'minutes': 30}
}
```

## Sincronizacion de Timeframe

El backend inicia con `intervals=["60"]` (1 hora).
El frontend DEBE sincronizar su timeframe activo:

```javascript
// Cuando el usuario cambia timeframe:
fetch('/api/realtime/set-interval', {
    method: 'POST',
    body: JSON.stringify({ interval: "1" })  // 1 minuto
});
```

## Archivos de Estado (backend/config/)

| Archivo | Contenido |
|---------|-----------|
| `alert_history.json` | Historial de alertas enviadas |
| `cooldown_state.json` | Cooldowns activos por simbolo |
| `alerted_patterns.json` | Patrones ya alertados (deduplicacion) |

## Problema Conocido: TIMEOUT

Si aparece "TIMEOUT ERROR" al enviar al puerto 5000:
1. Verificar que Trading Bot esta corriendo
2. Verificar que escucha en puerto 5000
3. El backend encola y marca "sent" aunque falle el envio

---

# SWING DETECTOR (Nuevo - Enero 2026)

Sistema de deteccion de Swing Highs/Lows en tiempo real con alertas al Trading Bot.

## Archivos del Sistema

### Backend (2.WatchlistConIndicadores/backend/)

| Archivo | Descripcion |
|---------|-------------|
| `swing_detector.py` | Algoritmo de deteccion de swings (N-bar pivots) |
| `swing_service.py` | Servicio de orquestacion con WebSocket y alertas |
| `config/swing_config.json` | Configuracion persistente |
| `logs/swing_alerts.log` | Log de alertas enviadas/bloqueadas |

### Frontend (2.WatchlistConIndicadores/frontend/src/)

| Archivo | Descripcion |
|---------|-------------|
| `components/indicators/SwingDetectorIndicator.js` | Renderiza flechas y zonas en grafico |
| `components/SwingDetectorSettings.jsx` | Panel de configuracion del indicador |

## Configuracion (SwingServiceConfig)

```python
@dataclass
class SwingServiceConfig:
    enabled: bool = True
    symbols: List[str] = ["BTCUSDT", "ETHUSDT"]
    interval: str = "1"           # Timeframe
    days: int = 1                 # Dias de historico a analizar
    swingBars: int = 5            # N velas a cada lado para confirmar swing
    direction: str = "BOTH"       # LONG, SHORT, BOTH
    priceZones: List[Dict] = []   # Zonas de precio activas
    volumeFilter: Dict = {
        "enabled": True,
        "minZScore": 1.5,         # Umbral de z-score de volumen
        "lookbackBars": 20        # Velas para calcular media/std de volumen
    }
    cooldownMinutes: int = 30     # Cooldown entre alertas
    alertTargetUrl: str = "http://localhost:5000/api/watchlist-alert"
```

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/swing/status` | GET | Estado del servicio y configuracion |
| `/api/swing/config` | POST | Actualizar configuracion |
| `/api/swing/signals/{symbol}` | GET | Senales detectadas para un simbolo |
| `/api/swing/reanalyze` | POST | Re-analizar historico con nueva config |
| `/api/swing/clear-cooldowns` | POST | Limpiar cooldowns (testing) |
| `/api/swing/add-zone` | POST | Agregar zona de precio |
| `/api/swing/zone/{id}` | DELETE | Eliminar zona de precio |

## Arquitectura y Flujo de Deteccion

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           SWING DETECTOR SYSTEM                              │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────────┐     ┌─────────────────┐     ┌──────────────────────────┐  │
│  │   BYBIT      │     │  WEBSOCKET      │     │    SWING SERVICE         │  │
│  │   EXCHANGE   │────▶│  MANAGER        │────▶│    (swing_service.py)    │  │
│  │              │     │                 │     │                          │  │
│  └──────────────┘     │ - Candle stream │     │ - _on_candle_close()     │  │
│                       │ - 200 candle    │     │ - Filtra timestamp       │  │
│                       │   buffer        │     │ - Cooldown check         │  │
│                       └─────────────────┘     └────────────┬─────────────┘  │
│                                                            │                 │
│                       ┌─────────────────┐                  │                 │
│                       │ SWING DETECTOR  │◀─────────────────┘                 │
│                       │ (swing_detector │                                    │
│                       │  .py)           │                                    │
│                       │                 │                                    │
│                       │ - N-bar pivot   │                                    │
│                       │ - Volume z-score│                                    │
│                       │ - Direction     │                                    │
│                       └────────┬────────┘                                    │
│                                │                                             │
│                                ▼                                             │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                         SIGNAL ROUTING                                  ││
│  ├─────────────────────────────┬───────────────────────────────────────────┤│
│  │                             │                                           ││
│  │  HISTORICO                  │  TIEMPO REAL                              ││
│  │  (_analyze_historical)      │  (_on_candle_close)                       ││
│  │           │                 │           │                               ││
│  │           ▼                 │           ▼                               ││
│  │  _store_signal()            │  Filtrar por timestamp                    ││
│  │  (Solo visualizacion)       │  de vela recien confirmada                ││
│  │           │                 │  [-(swingBars+1)]                         ││
│  │           ▼                 │           │                               ││
│  │  Frontend fetch             │           ▼                               ││
│  │  /api/swing/signals         │  _process_signal()                        ││
│  │                             │           │                               ││
│  │                             │           ▼                               ││
│  │                             │  Cooldown check                           ││
│  │                             │  (por symbol + direction)                 ││
│  │                             │           │                               ││
│  │                             │           ▼                               ││
│  │                             │  _send_alert() ─────────────────────────┐ ││
│  │                             │                                         │ ││
│  └─────────────────────────────┴─────────────────────────────────────────┼─┘│
│                                                                          │  │
└──────────────────────────────────────────────────────────────────────────┼──┘
                                                                           │
                              ┌────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TRADING BOT (Puerto 5000)                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  POST /api/watchlist-alert                                                   │
│           │                                                                  │
│           ▼                                                                  │
│  Detectar source: "SWING_DETECTOR"                                          │
│           │                                                                  │
│           ▼                                                                  │
│  Parsear pattern.direction → side (Buy/Sell)                                 │
│           │                                                                  │
│           ▼                                                                  │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │  VALIDACIONES                                                           ││
│  │  1. Direction filter (LONG/SHORT/BOTH/DISABLED)                         ││
│  │  2. Symbol config exists                                                ││
│  │  3. No position exists                                                  ││
│  └─────────────────────────────────────────────────────────────────────────┘│
│           │                                                                  │
│           ▼                                                                  │
│  execute_complete_sequence()                                                 │
│  - Market Order                                                              │
│  - Stop Loss                                                                 │
│  - Take Profit                                                               │
│           │                                                                  │
│           ▼                                                                  │
│  Log to alerts_received.log                                                  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Flujo Detallado

### 1. HISTORICO (al iniciar o reanalizar)
```
_analyze_historical()
    ↓
Calcula velas necesarias: calculate_candles_for_days(interval, days)
    ↓
Obtiene velas de WebSocket buffer o API Bybit (paginado, 200 por request)
    ↓
detector.detect() → Todas las senales historicas
    ↓
_store_signal() → Solo almacena para visualizacion (NO envia alertas)
```

### 2. TIEMPO REAL (en cada cierre de vela)
```
WebSocket candle close event
    ↓
_on_candle_close(symbol, interval, candle)
    ↓
Obtiene buffer de velas del WebSocket manager
    ↓
detector.detect() → Retorna TODAS las senales del buffer
    ↓
FILTRO CRITICO: Solo procesa senal con timestamp de vela en posicion -(swingBars+1)
    ↓
Si hay senal en esa posicion exacta:
    ↓
_process_signal() → Verifica cooldown por (symbol + direction)
    ↓
Si pasa cooldown: _send_alert() → POST al Trading Bot
```

### Logica del Filtro de Timestamp

Un swing necesita `swingBars` velas a cada lado para confirmarse:
- Con swingBars=5, el swing mas reciente confirmable esta en posicion -6
- Cuando cierra la vela actual (posicion -1), confirma el swing de la vela -6
- Solo alertamos swings que se ACABAN de confirmar con este cierre

```python
# En _on_candle_close():
just_confirmed_idx = -(swing_bars + 1)  # Ej: -6 para swingBars=5
just_confirmed_candle = candles[just_confirmed_idx]
just_confirmed_ts = just_confirmed_candle.timestamp

# Solo procesar senales de ESA vela especifica
new_signals = [s for s in signals if s.timestamp == just_confirmed_ts]
```

## Sistema de Cooldowns

- Cooldowns separados por simbolo + direccion
- Ejemplo: BTCUSDT_LONG y BTCUSDT_SHORT tienen cooldowns independientes
- Configurable en minutos desde el panel de settings
- Se puede limpiar manualmente para testing

## Formato de Alerta al Trading Bot

```json
{
    "source": "SWING_DETECTOR",
    "symbol": "BTCUSDT",
    "interval": "1",
    "pattern": {
        "patternType": "SWING_LOW",
        "price": 95000.50,
        "confidence": 75,
        "timestamp": 1705500000000,
        "direction": "LONG",
        "volumeZScore": 2.15
    }
}
```

## Archivos de Log

### Watchlist Backend: `backend/logs/swing_alerts.log`
```
2026-01-17 15:30:45 | INFO | SIGNAL_DETECTED | BTCUSDT | SWING_LOW | price=95000.50 | direction=LONG | volume_zscore=2.15
2026-01-17 15:30:45 | INFO | ALERT_SENT | BTCUSDT | SWING_LOW | price=95000.50 | direction=LONG | target=http://localhost:5000/api/watchlist-alert
2026-01-17 15:35:22 | INFO | BLOCKED_COOLDOWN | BTCUSDT | SWING_HIGH | remaining=1478s
2026-01-17 15:40:00 | ERROR | ALERT_TIMEOUT | ETHUSDT | Trading Bot not responding
```

### Trading Bot: `backend/logs/alerts_received.log`
```
2026-01-17 15:30:45 | SUCCESS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95000.50 | 75.0%
2026-01-17 15:35:22 | REJECTED_DIRECTION | SWING_DETECTOR | ETHUSDT | Sell | SWING_HIGH (SHORT) | $3200.50 | 80.0%
2026-01-17 15:40:00 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95100.00 | N/A
```

## Calculo de Velas por Dias

```python
def calculate_candles_for_days(interval: str, days: int) -> int:
    interval_minutes = {
        "1": 1, "3": 3, "5": 5, "15": 15, "30": 30,
        "60": 60, "120": 120, "240": 240, "360": 360, "720": 720,
        "D": 1440, "W": 10080,
    }
    minutes_per_candle = interval_minutes.get(interval, 1)
    return (days * 24 * 60) // minutes_per_candle

# Ejemplos:
# 1 dia en 1m = 1440 velas
# 1 dia en 5m = 288 velas
# 7 dias en 1h = 168 velas
```

## Panel de Settings (Frontend)

El panel SwingDetectorSettings.jsx permite configurar:

1. **Historical Days**: Slider 1-30 dias (muestra calculo de velas)
2. **Direction Filter**: BOTH / LONG / SHORT
3. **Swing Bars**: Slider 2-10 (sensibilidad del detector)
4. **Alert Cooldown**: Slider 1-120 minutos
5. **Volume Filter**:
   - Toggle enabled/disabled
   - Min Z-Score: 0-4 (0 = sin filtro)
   - Lookback Bars: 10-100
6. **Price Zones**: Lista con botones para agregar/eliminar
7. **Arrow Style**: Tamano, colores, mostrar z-score
8. **Acciones**: Re-analyze History, Clear Cooldowns, Refresh

## Integracion con Trading Bot

El Trading Bot (`3.TradingBot_Python/backend/main.py`) detecta automaticamente el formato SWING_DETECTOR:

```python
@app.post("/api/watchlist-alert")
async def process_watchlist_alert(request: Dict[str, Any]):
    source = request.get("source", "WATCHLIST")

    if source == "SWING_DETECTOR":
        # Extrae datos del objeto pattern anidado
        pattern_data = request.get("pattern", {})
        direction = pattern_data.get("direction", "").upper()
        side = "Buy" if direction == "LONG" else "Sell"
    else:
        # Formato original de Watchlist
        ...
```

## Resultados de Pruebas (17 Enero 2026)

Sistema probado durante ~3 horas con resultados exitosos:

### Metricas de la Sesion de Prueba
```
Periodo: 15:42 - 18:59 (3+ horas)
Simbolos: BTCUSDT, ETHUSDT
Timeframe: 1 minuto
swingBars: 5

Alertas enviadas: ~30
Alertas duplicadas: 0
Alertas del historico: 0 (despues del fix)
Tasa de exito de envio: 100%
```

### Log de Ejemplo (Funcionamiento Correcto)
```
# Watchlist Backend (swing_alerts.log)
2026-01-17 18:18:00 | INFO | SIGNAL_DETECTED | BTCUSDT | SWING_LOW | price=95113.60 | direction=LONG
2026-01-17 18:18:00 | INFO | SIGNAL_DETECTED | ETHUSDT | SWING_LOW | price=3305.07 | direction=LONG
2026-01-17 18:18:02 | INFO | ALERT_SENT | BTCUSDT | SWING_LOW | price=95113.60 | direction=LONG
2026-01-17 18:18:03 | INFO | ALERT_SENT | ETHUSDT | SWING_LOW | price=3305.07 | direction=LONG

# Trading Bot (alerts_received.log)
2026-01-17 18:18:02 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95113.60
2026-01-17 18:18:03 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | ETHUSDT | Buy | SWING_LOW (LONG) | $3305.07
```

### Comportamiento Observado
- **1 senal por vela confirmada**: Maximo 1-2 senales por cierre de vela (una por simbolo)
- **Frecuencia**: ~1 alerta cada 2-5 minutos dependiendo de volatilidad
- **Latencia**: ~2-3 segundos desde deteccion hasta recepcion en Trading Bot
- **Sin spam**: Eliminado el problema de 20+ senales por segundo del historico

### Problemas Resueltos Durante Desarrollo

1. **Alertas del historico inundando el sistema**
   - Problema: Al iniciar, enviaba cientos de alertas de swings historicos
   - Solucion: Separar `_store_signal()` (historico) de `_process_signal()` (tiempo real)

2. **Multiples senales por cierre de vela**
   - Problema: Filtraba por "ultimas N velas" pero aun habia multiples swings
   - Solucion: Filtrar por timestamp EXACTO de la vela recien confirmada `[-(swingBars+1)]`

3. **Cooldown bloqueaba ambas direcciones**
   - Problema: Un LONG bloqueaba el siguiente SHORT del mismo simbolo
   - Solucion: Cooldown key = `{symbol}_{direction}` (ej: BTCUSDT_LONG, BTCUSDT_SHORT)

4. **WebSocket callbacks sobrescritos**
   - Problema: SwingService y RealtimePatternService competian por el mismo callback
   - Solucion: WebSocketManager ahora soporta multiples listeners con `add_candle_close_listener()`

5. **Ordenamiento de rutas en FastAPI (Enero 2026)**
   - Problema: La ruta `/api/swing/config/{symbol}` se definia ANTES de `/api/swing/config/apply-to-all`
   - FastAPI matchea rutas en orden de definicion
   - El path "apply-to-all" se interpretaba como un `{symbol}`, creando entrada corrupta en config
   - Solucion: Definir rutas especificas ANTES de rutas con parametros variables
   ```python
   # CORRECTO - ruta especifica primero
   @app.post("/api/swing/config/apply-to-all")  # Esta primero
   @app.post("/api/swing/config/{symbol}")       # Esta despues

   # INCORRECTO - la ruta con {symbol} captura "apply-to-all"
   @app.post("/api/swing/config/{symbol}")       # Captura todo
   @app.post("/api/swing/config/apply-to-all")   # Nunca se alcanza
   ```

## Troubleshooting

**No se ven flechas en el grafico:**
- Verificar que el indicador esta habilitado en Watchlist y en su modal
- Verificar que el backend tiene senales: GET /api/swing/signals/{symbol}
- Revisar consola del frontend por errores de fetch

**Muchas alertas repetidas:**
- El filtro de timestamp exacto debe estar activo
- Solo se procesa la senal de la vela en posicion `-(swingBars+1)`
- Cooldowns separan LONG y SHORT independientemente

**Alertas no llegan al Trading Bot:**
- Verificar que Trading Bot esta corriendo en puerto 5000
- Revisar `backend/logs/swing_alerts.log` para errores TIMEOUT
- Verificar direccion del simbolo no es DISABLED en Trading Bot

**Volume Z-Score siempre 0:**
- Verificar que volumeFilter.enabled = true
- Aumentar lookbackBars si hay pocas velas en el buffer

**SKIPPED_POSITION_EXISTS en todas las alertas:**
- Comportamiento esperado si ya tienes posiciones abiertas
- El bot solo ejecuta si no hay posicion existente en ese simbolo

## Price Zones con Time-Bound (Enero 2026)

El Swing Detector ahora soporta zonas de precio con limite temporal derivadas de rectangulos dibujados en el grafico.

### Funcionalidad

1. **Zonas desde rectangulos del chart**: El usuario puede dibujar un rectangulo en el grafico y usarlo como zona de precio para validar senales
2. **Opcion Time-Bound**: Si se activa, la zona solo es valida dentro del rango temporal del rectangulo
3. **Re-analisis automatico**: Al agregar o eliminar una zona, las senales se recalculan automaticamente
4. **Zonas independientes por simbolo**: Cada zona tiene campo `symbol` y solo aplica a ese par

### Estructura de una Zona con Time-Bound

```json
{
  "id": "zone_rect_rectangle_123456_0.123",
  "symbol": "BTCUSDT",
  "min": 94860.96,
  "max": 95165.22,
  "direction": "LONG",
  "enabled": true,
  "sourceRectId": "rectangle_123456_0.123",
  "label": "Zone",
  "timeStart": 1768742160000,
  "timeEnd": 1768747080000,
  "timeBound": true
}
```

### Flujo de Uso

1. Usuario dibuja rectangulo en el chart (herramienta de dibujo)
2. Abre modal Swing Detector Settings → seccion "Price Zones"
3. Click en "📐 From Chart" para ver rectangulos disponibles
4. Activa checkbox "⏱️ Time-bound" si quiere limite temporal
5. Selecciona direccion: LONG / BOTH / SHORT
6. La zona se agrega y las senales se re-analizan automaticamente
7. Solo senales dentro del rango de precio Y tiempo (si time-bound) se muestran

### Sistema de Prioridad de Zonas Anidadas

Los rectangulos (time-bound) tienen **prioridad absoluta** sobre las zonas manuales cuando estan activos.

```
Ejemplo:
- Zona manual: $90,000 - $100,000, direction="BOTH"
- Rectangulo: $95,000 - $97,000, direction="LONG", timeStart=T1, timeEnd=T2

Escenarios:
1. Precio=$96,000, tiempo dentro de T1-T2:
   → Rectangulo ACTIVO, solo senales LONG permitidas

2. Precio=$96,000, tiempo fuera de T1-T2:
   → Rectangulo VENCIDO, cae a zona manual, senales BOTH permitidas

3. Precio=$94,000 (fuera del rectangulo), tiempo dentro de T1-T2:
   → Cae a zona manual, senales BOTH permitidas

4. Precio=$96,000, tiempo dentro, senal SHORT:
   → Rectangulo BLOQUEA la senal (no cae a zona manual)
```

### Logica de Validacion (Backend)

```python
# En swing_detector.py - _check_price_zones()

# 1. Separar zonas
time_bound_zones = [z for z in zones if z.get('timeBound')]
manual_zones = [z for z in zones if not z.get('timeBound')]

# 2. PRIORIDAD 1: Rectangulos activos
for zone in time_bound_zones:
    if price in zone AND timestamp in zone:
        if direction matches:
            return zone  # MATCH con rectangulo
        else:
            return None  # BLOQUEA (no cae a manual)

# 3. PRIORIDAD 2: Zonas manuales (solo si ningun rectangulo activo)
for zone in manual_zones:
    if price in zone AND direction matches:
        return zone  # MATCH con zona manual
```

### UI del Modal

- **Boton "📐 From Chart (N)"**: Muestra cantidad de rectangulos disponibles
- **Lista de rectangulos**: Muestra label, rango de precios, y estado
- **Checkbox "⏱️ Time-bound"**: Activa/desactiva limite temporal por rectangulo
- **Botones LONG/BOTH/SHORT**: Agregan la zona con la direccion seleccionada
- **Lista de zonas activas**: Muestra badges de estado (ACTIVE/EXPIRED/PENDING) para zonas time-bound

### Re-analisis Automatico

Los endpoints de zonas ahora llaman a `reanalyze_historical()` automaticamente:

```python
# POST /api/swing/add-zone
swing_service.config.priceZones.append(data)
swing_service._save_config()
await swing_service.reanalyze_historical()  # RE-ANALIZA

# DELETE /api/swing/zone/{zone_id}
swing_service.config.priceZones = [z for z in zones if z.id != zone_id]
swing_service._save_config()
await swing_service.reanalyze_historical()  # RE-ANALIZA
```

---

## Configuracion por Simbolo (Enero 2026)

El Swing Detector ahora soporta configuraciones independientes por simbolo.

### Estructura de Config

```json
{
  "enabled": true,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "interval": "1",
  "days": 1,
  "symbolConfigs": {
    "BTCUSDT": {
      "direction": "LONG",
      "swingBars": 3,
      "volumeFilter": {"enabled": true, "minZScore": 2.0}
    },
    "ETHUSDT": {
      "direction": "SHORT",
      "swingBars": 5
    }
  },
  "swingBars": 5,
  "direction": "BOTH",
  "priceZones": [],
  "volumeFilter": {...}
}
```

### Como Funciona

1. **Defaults globales**: `swingBars`, `direction`, `volumeFilter` aplican a todos los simbolos
2. **Override por simbolo**: `symbolConfigs[symbol]` sobreescribe los defaults
3. **Merge automatico**: `config.get_symbol_config(symbol)` fusiona defaults + especificos

### Endpoints

```
GET /api/swing/status?symbol=BTCUSDT
  → Incluye `symbolConfig` con config fusionada para ese simbolo

POST /api/swing/config/{symbol}
  Body: {"direction": "LONG", "swingBars": 3}
  → Actualiza config especifica del simbolo y re-analiza
```

### Frontend

El modal SwingDetectorSettings:
- Obtiene status con `?symbol=currentSymbol`
- Guarda config via `POST /api/swing/config/${currentSymbol}`
- Muestra valores fusionados (symbolConfig > defaults)

---

# VWAP INDICATOR (Backend-Native - Enero 2026)

El indicador VWAP fue migrado a arquitectura backend-native (igual que SwingDetector).

## Arquitectura

- **Backend**: `vwap_service.py` - Calcula VWAP, bandas de desviacion, y volatilidad
- **Frontend**: `VWAPIndicator.js` - Solo renderiza datos del backend

## Endpoint Principal

```
GET /api/vwap-service/data/{symbol}?days=1&interval=60&vwapType=session&rollingPeriod=20
```

**Parametros:**
- `days`: Dias de historico (1-360 segun timeframe)
- `interval`: Timeframe ("1", "5", "15", "60", etc)
- `vwapType`: "session" (reset diario) o "rolling" (ventana movil)
- `rollingPeriod`: Periodo para rolling VWAP

## Sincronizacion con Chart

El frontend pasa `days` e `interval` del chart al backend:

```javascript
// VWAPIndicator.js
const params = new URLSearchParams({
  days: this.days,
  interval: this.interval,
  vwapType: this.vwapType,
  rollingPeriod: this.rollingPeriod
});
const url = `${API_BASE_URL}/api/vwap-service/data/${this.symbol}?${params}`;
```

## Indicadores de Volatilidad

El VWAP incluye barras horizontales de volatilidad:
- **BandWidth**: Ancho de bandas Bollinger (%)
- **BBWP**: Bollinger Band Width Percentile (0-100)
- **TTM Squeeze**: Indica compresion de volatilidad

Estos se calculan SIEMPRE en el backend (aunque no se muestren) para disponibilidad inmediata.

## Lifecycle y Cleanup

Para evitar race conditions cuando cambia el timeframe:

```javascript
// VWAPIndicator.js
constructor() {
  this._destroyed = false;
}

destroy() {
  this._destroyed = true;  // Previene fetch despues de unmount
}

async fetchData() {
  if (this._destroyed) return false;  // Skip si destruido
  // ... fetch ...
  if (this._destroyed) return false;  // Check despues de await
}
```

---

# LECCIONES APRENDIDAS (Enero 2026)

## Performance - Carga de Datos Historicos

### Problema
La carga de muchos dias de datos en timeframes pequenos causa lentitud extrema:
- 30 dias en 1m = 43,200 velas = ~5 minutos de carga

### Solucion
1. **Defaults conservadores**: `days=1` por defecto en configs
2. **Inicializacion no-bloqueante**: `asyncio.create_task(self._background_init())`
3. **Limites por timeframe**: 1m max 5 dias, 1h max 360 dias

### Archivos Criticos a Verificar
- `swing_config.json`: `days` debe ser bajo para 1m
- `vwap_service.py`: `historyDays` default
- `Watchlist.jsx`: `useState("1")` para days

## Race Conditions en Indicadores

### Problema
Cuando el usuario cambia timeframe rapidamente, solicitudes HTTP del timeframe anterior interfieren.

### Solucion
1. **Flag `_destroyed`**: Cada indicador tiene flag de lifecycle
2. **Verificacion post-await**: Despues de cada `await fetch()`, verificar si aun es valido
3. **IndicatorManager.destroy()**: Llama `destroy()` en todos los indicadores

```javascript
// IndicatorManager.js
destroy() {
  this.indicators.forEach(indicator => {
    if (indicator.destroy) indicator.destroy();
  });
}
```

## Singleton con Config Global (Anti-pattern)

### Problema
VWAPService singleton modificaba config global durante solicitudes concurrentes.

### Solucion
Metodo separado que acepta parametros explicitos sin modificar estado global:

```python
async def _fetch_historical_candles_with_params(self, symbol, days, interval):
    # Usa parametros locales, no modifica self.config durante fetch
```

## Zonas No Se Actualizan

### Problema
Al agregar/eliminar zonas de precio, las senales viejas permanecian.

### Solucion
Llamar `reanalyze_historical()` automaticamente en endpoints de zonas:

```python
@app.post("/api/swing/add-zone")
async def add_swing_zone(request):
    swing_service.config.priceZones.append(data)
    swing_service._save_config()
    await swing_service.reanalyze_historical()  # CRITICO
```

## Indicadores Deshabilitados que Consumen Recursos

### Problema
DTB y Rejection Patterns se creaban aunque estaban deshabilitados.

### Solucion
Solo crear si explicitamente habilitados:

```javascript
// IndicatorManager.js
if (indicatorStates['Rejection Patterns'] === true) {
  this.indicators.push(new RejectionPatternIndicator(...));
}
```

---

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
