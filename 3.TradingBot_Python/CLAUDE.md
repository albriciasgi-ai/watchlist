# CLAUDE.md - Trading Bot Python

Bot de trading automatizado que ejecuta ordenes en Bybit basado en alertas de otros sistemas (Watchlist, SwingDetector, Analizador).

---

## ARQUITECTURA

### Por que NO necesita Electron

A diferencia de Watchlist y Analizador, el TradingBot **no sufre throttling del navegador** porque:

1. **El backend es un servidor Python** que corre independiente del navegador
2. Las alertas llegan directamente al **puerto 5000** via HTTP POST
3. El frontend solo es para visualizacion y configuracion - no procesa alertas

```
Watchlist/SwingDetector → POST localhost:5000 → Backend Python → Bybit API
                                                    ↑
                                          (siempre activo, sin throttling)
```

### Donde se hacen los calculos

**Todo en el backend (Python):**
- `risk_calculator.py` - Calcula cantidad basada en riesgo y SL%
- `order_manager.py` - Calcula precios de TP/SL, formatea cantidades
- `bybit_client.py` - Ejecuta las ordenes

El frontend es solo interfaz visual.

---

## ESTRUCTURA DE ARCHIVOS

```
3.TradingBot_Python/
├── backend/
│   ├── main.py                    # Servidor FastAPI (puerto 5000)
│   ├── trading/
│   │   ├── bybit_client.py        # Cliente API Bybit con connection pooling
│   │   ├── order_manager.py       # Gestor de secuencias de ordenes
│   │   ├── risk_calculator.py     # Calculadora de riesgo y cantidad
│   │   ├── rate_limiter.py        # Token Bucket rate limiter
│   │   ├── direction_manager.py   # Filtros LONG/SHORT/BOTH/DISABLED
│   │   └── alert_parser.py        # Parser de alertas ATAS
│   ├── logs/
│   │   └── alerts_received.log    # Log de alertas recibidas
│   └── requirements.txt
│
├── frontend/
│   └── src/
│       ├── App.jsx                # Componente raiz
│       └── components/
│           ├── CredentialsPanel.jsx   # Config credenciales + metodo ejecucion
│           ├── ConfigManager.jsx      # Gestion de simbolos (add/edit)
│           ├── DirectionManager.jsx   # Filtros de direccion
│           ├── AlertPanel.jsx         # Envio manual de alertas
│           ├── LogsPanel.jsx          # Visualizacion de logs
│           ├── PositionsPanel.jsx     # Posiciones abiertas
│           └── OrdersPanel.jsx        # Historial de ordenes
│
├── config/
│   ├── trading_config.json        # Configuracion de simbolos
│   ├── credentials.json           # API keys Bybit (generado en runtime)
│   ├── trading_directions.json    # Filtros de direccion por simbolo
│   ├── bot_settings.json          # Settings del bot (metodo ejecucion)
│   └── order_history.json         # Historial de ordenes ejecutadas
│
└── START_HERE.bat                 # Inicio automatico (backend + frontend)
```

---

## METODOS DE EJECUCION

### 1. Sequential (3 API calls) - Default

Ejecuta 3 llamadas separadas a Bybit:
1. Market Order → espera confirmacion
2. Stop Loss Order
3. Take Profit Order

**Ventajas:** Mas confiable, confirma cada paso
**Desventajas:** Mas lento (~2-3 segundos total)

### 2. Integrated (1 API call) - Opcional

Ejecuta 1 sola llamada con TP/SL incluidos:
```python
params = {
    "symbol": symbol,
    "side": side,
    "orderType": "Market",  # o "Limit"
    "qty": qty,
    "takeProfit": tp_price,
    "stopLoss": sl_price,
    "tpslMode": "Full"
}
```

**Ventajas:** Mas rapido (~500ms), soporta Limit orders con TP/SL
**Desventajas:** Si falla, no hay TP/SL

### Cambiar metodo

**Via Frontend:** Dashboard → Credentials → Toggle "Integrated TP/SL"

**Via API:**
```bash
# Ver configuracion actual
curl http://localhost:5000/api/settings

# Cambiar a integrado
curl -X POST "http://localhost:5000/api/settings/execution-method?use_integrated=true"

# Cambiar a secuencial
curl -X POST "http://localhost:5000/api/settings/execution-method?use_integrated=false"
```

---

## AUTO-PRECISION (Enero 2026)

El bot obtiene automaticamente los valores de precision desde Bybit API:
- `step_size` (qtyStep) - Incremento minimo de cantidad
- `tick_size` (tickSize) - Incremento minimo de precio
- `min_qty` - Cantidad minima
- `max_qty` - Cantidad maxima

### Al agregar una moneda

Solo necesitas especificar:
- Symbol (ej: SHIBUSDT)
- Risk Amount (USDT)
- Stop Loss %
- Take Profit %

La precision se obtiene automaticamente de Bybit.

### Sincronizar precision existente

```bash
# Sincronizar un simbolo
curl -X POST http://localhost:5000/api/config/sync-precision/BTCUSDT

# Sincronizar todos
curl -X POST http://localhost:5000/api/config/sync-all-precision
```

---

## ENDPOINTS API

### Status y Configuracion

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado del servidor y estadisticas |
| `/api/settings` | GET | Configuracion del bot (metodo ejecucion) |
| `/api/settings/execution-method` | POST | Cambiar metodo de ejecucion |
| `/api/credentials` | POST | Configurar API keys Bybit |
| `/api/credentials/check` | GET | Verificar si hay credenciales |

### Simbolos y Configuracion

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/config` | GET | Lista todos los simbolos configurados |
| `/api/config/add` | POST | Agregar nuevo simbolo (auto-precision) |
| `/api/config/update` | POST | Actualizar configuracion de simbolo |
| `/api/config/sync-precision/{symbol}` | POST | Sincronizar precision desde Bybit |
| `/api/config/sync-all-precision` | POST | Sincronizar todos los simbolos |

### Direcciones

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/directions` | GET | Lista direcciones por simbolo |
| `/api/directions/update` | POST | Cambiar direccion (LONG/SHORT/BOTH/DISABLED) |

### Trading

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/alert` | POST | Procesar alerta formato ATAS |
| `/api/watchlist-alert` | POST | Procesar alerta JSON (Watchlist/SwingDetector) |
| `/api/trade/manual` | POST | Ejecutar trade manual |
| `/api/position/{symbol}` | GET | Posicion actual de un simbolo |
| `/api/positions` | GET | Todas las posiciones abiertas |

### Historial

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/logs` | GET | Ultimos logs del sistema |
| `/api/orders/history` | GET | Historial de ordenes ejecutadas |
| `/api/orders/history` | DELETE | Limpiar historial |
| `/api/alerts/recent` | GET | Alertas recientes (para Journal) |

---

## FORMATO DE ALERTAS

### Desde SwingDetector

```json
{
  "source": "SWING_DETECTOR",
  "symbol": "BTCUSDT",
  "interval": "1",
  "pattern": {
    "patternType": "SWING_LOW",
    "price": 95000.50,
    "confidence": 75,
    "direction": "LONG"
  }
}
```

### Desde Watchlist (Rejection Patterns)

```json
{
  "source": "backend_realtime",
  "symbol": "ETHUSDT",
  "pattern": {
    "patternType": "HAMMER",
    "direction": "BULLISH",
    "price": 3200.50,
    "confidence": 80
  }
}
```

### Con Limit Order (Integrado)

```json
{
  "source": "SWING_DETECTOR",
  "symbol": "BTCUSDT",
  "pattern": {...},
  "order_type": "Limit",
  "limit_price": 94500.00
}
```

- Si `order_type` no se envia, usa **Market** por defecto
- Si es "Limit", **debe** incluir `limit_price`

---

## FLUJO DE EJECUCION

### Metodo Sequential (default)

```
Alerta recibida → POST /api/watchlist-alert
    ↓
Validar formato y extraer datos
    ↓
Verificar filtro de direccion (LONG/SHORT/BOTH/DISABLED)
    ↓
Obtener configuracion del simbolo
    ↓
ADQUIRIR LOCK (por simbolo - evita race conditions)
    ↓
Verificar posicion existente (si existe, skip)
    ↓
Calcular cantidad → risk_calculator
    ↓
EJECUTAR SECUENCIA (order_manager.execute_complete_sequence)
    │
    ├─ 1. Market Order
    │      ↓
    ├─ 2. Intelligent Polling (esperar posicion, ~200-600ms)
    │      ↓
    ├─ 3. Obtener precio real de ejecucion
    │      ↓
    ├─ 4. Calcular SL/TP basado en precio real
    │      ↓
    ├─ 5. Place Stop Loss (con retry)
    │      ↓
    └─ 6. Place Take Profit (con retry)
    ↓
Guardar en historial
    ↓
Broadcast via WebSocket
```

### Metodo Integrated

```
Alerta recibida → POST /api/watchlist-alert
    ↓
(mismas validaciones...)
    ↓
EJECUTAR INTEGRADO (order_manager.execute_integrated_sequence)
    │
    └─ 1. Single API call con Market/Limit + TP + SL
    ↓
Guardar en historial
    ↓
Broadcast via WebSocket
```

---

## OPTIMIZACIONES IMPLEMENTADAS (Enero 2026)

### 1. Token Bucket Rate Limiter

**Archivo:** `trading/rate_limiter.py`

```python
class TokenBucketRateLimiter:
    def __init__(self, tokens_per_second: float = 10.0, max_tokens: int = 50):
        self.tokens_per_second = tokens_per_second
        self.max_tokens = max_tokens
        self.tokens = max_tokens
```

**Beneficio:** Previene errores 429 (Too Many Requests) de Bybit.

### 2. Connection Pooling

**Archivo:** `trading/bybit_client.py`

```python
self._http_client = httpx.AsyncClient(
    timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
    limits=httpx.Limits(max_connections=20, max_keepalive_connections=10)
)
```

**Beneficio:** Reutiliza conexiones HTTP, reduce latencia ~30%.

### 3. Intelligent Polling

**Archivo:** `trading/order_manager.py`

En lugar de `sleep(3)` fijo, hace polling cada 200ms hasta confirmar posicion:

```python
async def _wait_for_position(self, symbol: str, timeout_seconds: float = 5.0):
    while (time.monotonic() - start_time) < timeout:
        position = await self.client.get_position(symbol)
        if position.get("hasPosition"):
            return position
        await asyncio.sleep(0.2)  # Poll cada 200ms
```

**Beneficio:** Tipicamente confirma en 200-600ms vs 3000ms fijos.

### 4. Auto-Precision desde Bybit

**Archivo:** `trading/bybit_client.py`

```python
async def get_instrument_info(self, symbol: str, category: str = "linear"):
    # GET /v5/market/instruments-info (PUBLIC, no auth)
    # Retorna: qtyStep, tickSize, minOrderQty, maxOrderQty
```

**Beneficio:** No mas errores por precision incorrecta.

### 5. TP/SL Integrado

**Archivo:** `trading/bybit_client.py`

```python
async def place_order_with_tpsl(self, symbol, side, qty, order_type="Market",
                                 limit_price=None, take_profit=None, stop_loss=None):
    params = {
        "takeProfit": take_profit,
        "stopLoss": stop_loss,
        "tpslMode": "Full",
        "tpTriggerBy": "LastPrice",
        "slTriggerBy": "LastPrice"
    }
```

**Beneficio:** 1 API call vs 3, soporta Limit orders.

---

## CONFIGURACION DE SIMBOLOS

### trading_config.json

```json
{
  "coins": [
    {
      "symbol": "BTCUSDT",
      "category": "linear",
      "risk_amount": 3.0,
      "stop_loss_percent": 0.022,
      "take_profit_percent": 0.045,
      "leverage": 10,
      "step_size": 0.001,
      "tick_size": 0.1,
      "min_qty": 0.001,
      "max_qty": 119.0
    }
  ]
}
```

**Nota:** `stop_loss_percent` y `take_profit_percent` son decimales (0.022 = 2.2%)

### Agregar nuevo simbolo via API

```bash
curl -X POST http://localhost:5000/api/config/add \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "SHIBUSDT",
    "risk_amount": 1.0,
    "stop_loss_percent": 0.02,
    "take_profit_percent": 0.04
  }'
```

La precision (step_size, tick_size, etc.) se obtiene automaticamente de Bybit.

---

## LOGS Y DEBUGGING

### alerts_received.log

```
2026-01-29 15:30:45 | SUCCESS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95000.50 | 75.0%
2026-01-29 15:35:22 | REJECTED_DIRECTION | SWING_DETECTOR | ETHUSDT | Sell | SWING_HIGH (SHORT) | $3200.50 | 80.0%
2026-01-29 15:40:00 | SKIPPED_POSITION_EXISTS | SWING_DETECTOR | BTCUSDT | Buy | SWING_LOW (LONG) | $95100.00 | N/A
```

### Consola del Backend

```
[BYBIT] Client initialized: https://api.bybit.com (mode: live)
[SYNC] Time synced: offset = -150ms
[ORDER+TPSL] Placing MARKET Order with TP/SL: Buy BTCUSDT qty=0.001
   Take Profit: 99225.0
   Stop Loss: 92910.0
[OK] MARKET Order with TP/SL placed: 1234567890 (positionIdx: 0)
[SUCCESS] Integrated order completed in 487ms
```

---

## TROUBLESHOOTING

### Orden no se ejecuta

1. Verificar direccion del simbolo no es DISABLED
2. Verificar que no hay posicion existente
3. Revisar logs para ver el motivo del rechazo

### Error de precision

```
Error: Order quantity is not valid
```

**Solucion:** Sincronizar precision desde Bybit:
```bash
curl -X POST http://localhost:5000/api/config/sync-precision/BTCUSDT
```

### Error 429 (Rate Limit)

El rate limiter deberia prevenirlo, pero si ocurre:
- Verificar que no hay multiples instancias del bot
- Reducir frecuencia de alertas

### TP/SL no se colocan (metodo sequential)

Si el Market Order pasa pero SL/TP fallan:
- El bot envia alerta critica via WebSocket
- Revisar logs para el error especifico
- Posible causa: precision de precio incorrecta

---

## INTEGRACION CON OTRAS APPS

### Recibe alertas de:

- **SwingDetector** (App 2/4/7/8): via `/api/watchlist-alert`
- **Rejection Patterns** (App 2): via `/api/watchlist-alert`
- **ATAS**: via `/api/alert` (formato texto)

### Provee datos a:

- **Trading Journal** (App 6):
  - `GET /api/positions` - Posiciones abiertas
  - `GET /api/alerts/recent` - Alertas recientes
  - `GET /api/position-history/{symbol}` - Historial cerrado

---

## COMANDOS RAPIDOS

```bash
# Iniciar backend
cd backend && python main.py

# Iniciar frontend
cd frontend && npm run dev

# Ver status
curl http://localhost:5000/api/status

# Ver configuracion
curl http://localhost:5000/api/config

# Ver direcciones
curl http://localhost:5000/api/directions

# Sincronizar precision de todos los simbolos
curl -X POST http://localhost:5000/api/config/sync-all-precision

# Cambiar a metodo integrado
curl -X POST "http://localhost:5000/api/settings/execution-method?use_integrated=true"
```
