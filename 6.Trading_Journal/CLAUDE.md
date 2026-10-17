# APP 6: TRADING JOURNAL

**Ubicacion:** `6.Trading_Journal/`

Sistema de registro automatico de trades con analisis de rendimiento, screenshots y metricas avanzadas.

## Estructura

```
6.Trading_Journal/
├── backend/
│   ├── main.py                      # Servidor FastAPI (puerto 12000)
│   ├── requirements.txt             # Dependencias Python
│   ├── models/
│   │   └── journal_entry.py         # Modelos de datos (JournalEntry, etc.)
│   ├── store/
│   │   └── journal_store.py         # Persistencia SQLite
│   ├── api/
│   │   └── routes.py                # Endpoints REST
│   ├── services/
│   │   ├── position_monitor.py      # Monitor de posiciones (polling TradingBot)
│   │   ├── screenshot_service.py    # Capturas Playwright + mplfinance
│   │   └── metrics_service.py       # Calculos de metricas avanzadas
│   ├── data/                        # Base de datos SQLite
│   └── screenshots/                 # Screenshots capturados
│
├── frontend/
│   ├── src/
│   │   ├── App.jsx                  # Componente raiz con navegacion
│   │   ├── components/
│   │   │   ├── Dashboard.jsx        # Resumen y metricas principales
│   │   │   ├── TradeList.jsx        # Lista de trades con filtros
│   │   │   ├── TradeDetail.jsx      # Detalle con screenshots y reflexion
│   │   │   └── Settings.jsx         # Configuracion del monitor
│   │   └── styles/                  # CSS
│   ├── package.json
│   └── vite.config.js
│
└── 1_START.bat                      # Inicio automatico
```

## Comandos

```bash
# Inicio rapido (Windows)
cd 6.Trading_Journal
1_START.bat

# Manual - Backend
cd backend
python -m venv .venv && .venv\Scripts\activate
pip install -r requirements.txt
python main.py  # Puerto 12000

# Manual - Frontend
cd frontend
npm install
npm run dev  # Puerto 12001
```

## Funcionalidades

- **Registro automatico** de trades desde TradingBot
- **Screenshots** automaticos al abrir/cerrar posiciones
- **Metricas avanzadas**: Win rate, Profit Factor, Sharpe, Sortino, Max Drawdown
- **R-Multiple** calculado automaticamente
- **Reflexiones** y lecciones aprendidas por trade
- **Analisis por**: periodo, simbolo, fuente, direccion, dia, hora
- **Curva de equity** visualizada
- **Export/Import** JSON para backup

## Modelos de Datos

### JournalEntry

```python
@dataclass
class JournalEntry:
    id: str                      # UUID unico
    symbol: str                  # Ej: BTCUSDT
    direction: TradeDirection    # LONG o SHORT
    status: TradeStatus          # OPEN, CLOSED, CANCELLED
    source: TradeSource          # watchlist, analizador, manual, etc.
    entry_time: str              # ISO datetime
    exit_time: Optional[str]
    entry_price: float
    exit_price: Optional[float]
    quantity: Optional[float]
    pnl_usd: float               # Ganancia/perdida en USD
    pnl_percent: float           # Porcentaje
    r_multiple: float            # Multiplo de riesgo
    screenshot_entry: Optional[str]
    screenshot_exit: Optional[str]
    market_context: MarketContext
    setup: TradeSetup
    execution: ExecutionQuality
    reflection: TradeReflection
```

### TradeSource (Enum)

| Valor | Descripcion |
|-------|-------------|
| `watchlist` | Alerta desde Watchlist (App 2) |
| `analizador` | Alerta desde Analizador (App 4) |
| `order_flow` | Alerta desde Order Flow (App 5) |
| `backtester` | Trade desde Backtester (App 1) |
| `manual` | Trade ejecutado manualmente |

## Endpoints API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/entries` | GET | Lista todos los trades |
| `/api/entries` | POST | Crear nuevo trade |
| `/api/entries/{id}` | GET | Obtener trade por ID |
| `/api/entries/{id}` | PUT | Actualizar trade |
| `/api/entries/{id}` | DELETE | Eliminar trade |
| `/api/entries/statistics` | GET | Estadisticas generales |
| `/api/entries/export` | GET | Exportar todos los trades |
| `/api/entries/import` | POST | Importar trades desde JSON |
| `/api/metrics/summary` | GET | Metricas avanzadas |
| `/api/metrics/equity-curve` | GET | Datos para curva de equity |
| `/api/metrics/by-symbol` | GET | Analisis por simbolo |
| `/api/metrics/by-source` | GET | Analisis por fuente |
| `/api/monitor/status` | GET | Estado del monitor |
| `/api/monitor/start` | POST | Iniciar monitor |
| `/api/monitor/stop` | POST | Detener monitor |
| `/api/screenshots/{path}` | GET | Servir screenshot |

## Arquitectura de Servicios

### Position Monitor

El monitor hace polling al TradingBot cada 5 segundos:

```
┌─────────────────────────────────────────────────────────────┐
│                    POSITION MONITOR                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐     ┌─────────────────┐                    │
│  │ TRADING BOT │────▶│ GET /api/positions                   │
│  │  (5000)     │     │ GET /api/alerts/recent               │
│  └─────────────┘     └─────────────────┘                    │
│         │                     │                              │
│         │                     ▼                              │
│         │            ┌─────────────────┐                    │
│         │            │ Detectar cambios│                    │
│         │            │ - Nueva posicion│                    │
│         │            │ - Posicion cerrada                   │
│         │            └────────┬────────┘                    │
│         │                     │                              │
│         │    ┌────────────────┼────────────────┐            │
│         │    │                │                │            │
│         ▼    ▼                ▼                ▼            │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ Match Alert │    │Create Entry │    │Close Entry  │     │
│  │ → Source    │    │+ Screenshot │    │+ Screenshot │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Screenshot Service

Sistema hibrido con dos metodos:

1. **Playwright (primario)**: Captura del chart real del Analizador/Watchlist
2. **mplfinance (fallback)**: Genera chart estatico si Playwright falla

```python
# Ruta de screenshots
screenshots/{symbol}/{entry_id}_{event}_{timestamp}.png

# Ejemplo
screenshots/BTCUSDT/abc123_entry_20260128_153000.png
```

### Metrics Service

Calcula metricas avanzadas:

```python
@dataclass
class MetricsSummary:
    total_trades: int
    winning_trades: int
    losing_trades: int
    win_rate: float
    profit_factor: float
    avg_r: float
    total_r: float
    sharpe_ratio: float
    sortino_ratio: float
    max_drawdown: float
    avg_winner: float
    avg_loser: float
    best_trade: float
    worst_trade: float
    expectancy: float
```

## Integracion con TradingBot

El Journal se integra con el TradingBot mediante endpoints agregados:

### Endpoints agregados al TradingBot (puerto 5000)

```python
# GET /api/positions
# Retorna todas las posiciones abiertas
{
    "BTCUSDT": {
        "hasPosition": true,
        "size": 0.001,
        "side": "Buy",
        "entryPrice": 95000.0,
        "unrealizedPnl": 50.25
    },
    ...
}

# GET /api/alerts/recent?minutes=30
# Retorna alertas recientes para matching de source
[
    {
        "timestamp": "2026-01-28T15:30:00",
        "symbol": "BTCUSDT",
        "source": "SWING_DETECTOR",
        "direction": "LONG"
    },
    ...
]

# GET /api/position-history/{symbol}?limit=10
# Retorna historial de posiciones cerradas
```

## Flujo Completo

```
1. Usuario ejecuta trade via TradingBot (manual o alerta)
      ↓
2. Position Monitor detecta nueva posicion
      ↓
3. Match con alerta reciente → determina source
      ↓
4. Crea JournalEntry con estado OPEN
      ↓
5. Screenshot Service captura chart de entrada
      ↓
6. ... tiempo pasa ...
      ↓
7. Position Monitor detecta posicion cerrada
      ↓
8. Actualiza JournalEntry: exit_price, pnl, status=CLOSED
      ↓
9. Screenshot Service captura chart de salida
      ↓
10. Calcular R-multiple si hay SL definido
      ↓
11. Metrics Service recalcula estadisticas
```

## Frontend Components

### Dashboard
- Cards de metricas principales (Total P&L, Win Rate, Profit Factor, etc.)
- Curva de equity (SVG chart)
- Gauge de win rate
- Lista de trades recientes

### TradeList
- Tabla con todos los trades
- Filtros: estado, simbolo, direccion, fuente
- Ordenamiento por columnas
- Click para ver detalle

### TradeDetail
- Resumen de P&L (USD, %, R)
- Screenshots de entrada y salida
- Detalles del trade (precios, tiempos)
- Seccion de reflexion editable
- Calidad del setup (slider 1-10)
- Emociones antes/despues
- Notas y lecciones

### Settings
- Control del monitor (start/stop)
- Estado de conexiones
- Export/Import de datos
- Limpieza de screenshots

## Troubleshooting

**Monitor no detecta posiciones:**
- Verificar que TradingBot esta corriendo en puerto 5000
- Verificar endpoint `/api/positions` responde
- Revisar logs del backend Journal

**Screenshots no se capturan:**
- Verificar que Analizador o Watchlist esta abierto
- Playwright puede fallar si el browser no esta disponible
- El fallback mplfinance genera charts estaticos

**Source siempre es "manual":**
- El matching requiere alerta reciente (30 min window)
- Verificar que el sistema de alertas esta funcionando
- Revisar `/api/alerts/recent` en TradingBot

**Metricas no se actualizan:**
- Las metricas se recalculan al consultar
- Verificar que hay trades cerrados (no solo abiertos)

---

