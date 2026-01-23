# CLAUDE.md - Order Flow Analyzer

Guia para Claude Code al trabajar con esta aplicacion.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en espanol con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en espanol.

### Perfil
Agente programador Python/JavaScript con experiencia en aplicaciones de trading y analisis de Order Flow.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente salvo que se pida explicitamente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas.
5. **Encoding**: Evitar tildes y caracteres especiales en codigo fuente para prevenir problemas de encoding.
6. **Iterativo**: Completar UNA tarea del IMPLEMENTATION_PLAN.md por iteracion, marcarla y actualizar estado.

### Limitaciones conocidas
- No puedo ejecutar codigo directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL

**Order Flow Analyzer** muestra el flujo de ordenes (compras vs ventas) por nivel de precio dentro de cada vela.
A diferencia de un chart tradicional que solo muestra OHLCV, el footprint revela:
- Donde estan comprando agresivamente (ask volume)
- Donde estan vendiendo agresivamente (bid volume)
- Imbalances que indican presion direccional

| Aspecto | Valor |
|---------|-------|
| Ubicacion | `5.Order_flow/` |
| Puerto Backend | 11000 |
| Puerto Frontend | 11001 |
| Stack | React 18 + Vite + FastAPI |
| Base copiada de | `4.Analizador cripto/` |
| Fuente de datos | Bybit WebSocket (publicTrade) |

---

## ESTRUCTURA DEL PROYECTO (OBJETIVO FINAL)

```
5.Order_flow/
├── backend/
│   ├── main.py                    # Servidor FastAPI (puerto 11000)
│   ├── websocket_manager.py       # WebSocket Bybit (klines + trades)
│   ├── trade_aggregator.py        # Acumula trades por vela (NUEVO)
│   ├── footprint_calculator.py    # Calcula footprint con 6 niveles (NUEVO)
│   ├── orderflow_service.py       # Servicio principal Order Flow (NUEVO)
│   ├── alert_sender.py            # Sistema de alertas
│   ├── config/
│   │   └── orderflow_config.json  # Config persistente (NUEVO)
│   ├── cache/
│   └── logs/
│       └── orderflow_alerts.log   # Log de alertas (NUEVO)
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── SingleSymbolAnalyzer.jsx
│   │   │   ├── MiniChart.jsx
│   │   │   ├── OrderFlowSettings.jsx     # Modal config (NUEVO)
│   │   │   └── indicators/
│   │   │       ├── IndicatorManager.js
│   │   │       └── OrderFlowIndicator.js # Renderiza footprint (NUEVO)
│   │   ├── config.js              # API_BASE_URL = localhost:11000
│   │   └── styles.css
│   └── vite.config.js             # Puerto 11001
│
├── specs/
│   └── ORDERFLOW_SPEC.md          # Especificaciones tecnicas detalladas
│
├── IMPLEMENTATION_PLAN.md         # Checklist de tareas (LEER PRIMERO)
├── AGENTS.md                      # Comandos de verificacion
├── CLAUDE.md                      # Este archivo
└── START.bat
```

---

## FLUJO DE TRABAJO CON IMPLEMENTATION_PLAN.md

**CRITICO**: Al iniciar cada iteracion:

1. Leer `IMPLEMENTATION_PLAN.md`
2. Identificar la tarea actual (la primera sin marcar `[x]`)
3. Completar SOLO esa tarea
4. Ejecutar la verificacion si aplica
5. Marcar `[x]` la tarea completada
6. Actualizar la seccion "Estado Actual"
7. Terminar la iteracion

**NO** avanzar multiples tareas en una sola iteracion.
**NO** modificar tareas que no esten en progreso.

---

## COMANDOS DE INICIO

### Inicio Manual
```batch
# Terminal 1 - Backend
cd 5.Order_flow/backend
.venv\Scripts\activate
uvicorn main:app --reload --port 11000

# Terminal 2 - Frontend
cd 5.Order_flow/frontend
npm install
npm run dev
```

### URLs
- **Frontend**: http://localhost:11001
- **Backend API**: http://localhost:11000
- **Docs API**: http://localhost:11000/docs

---

## ARQUITECTURA ORDER FLOW

### Fuente de Datos: Bybit WebSocket

```
wss://stream.bybit.com/v5/public/linear
Suscripcion: {"op": "subscribe", "args": ["publicTrade.BTCUSDT"]}
```

### Flujo de Datos

```
Bybit WebSocket (publicTrade)
        |
        v
TradeAggregator (acumula por vela)
        |
        v
FootprintCalculator (6 niveles, bid/ask)
        |
        v
OrderFlowService (singleton, memoria)
        |
        +---> REST API (GET /api/orderflow/footprint/{symbol})
        |
        +---> Alertas (POST localhost:5000/api/watchlist-alert)
```

### Estructura de Datos

```python
# FootprintLevel - Un nivel de precio dentro de una vela
@dataclass
class FootprintLevel:
    price_min: float      # Limite inferior
    price_max: float      # Limite superior
    bid_volume: float     # Vendedores agresivos
    ask_volume: float     # Compradores agresivos
    trade_count: int      # Cantidad de trades

# Footprint - Una vela completa con sus niveles
@dataclass
class Footprint:
    candle_timestamp: int
    symbol: str
    interval: str         # "1" o "5"
    candle_high: float
    candle_low: float
    candle_open: float
    candle_close: float
    levels: List[FootprintLevel]  # 6 niveles
```

### Interpretacion del Side (Bybit)

- `"Buy"` = Comprador agresivo (lift the ask) -> Suma a **ask_volume**
- `"Sell"` = Vendedor agresivo (hit the bid) -> Suma a **bid_volume**

---

## CONCEPTOS CLAVE

### Imbalance
Cuando un lado tiene >= 3x mas volumen que el otro en un nivel:
```python
imbalance_ratio = max(bid, ask) / min(bid, ask)
is_imbalance = imbalance_ratio >= 3.0
```

### Stacked Imbalance
3+ niveles consecutivos con imbalance en la misma direccion.
Indica fuerte presion direccional.

### POC (Point of Control)
Nivel con mayor volumen total (bid + ask).
Representa el precio "justo" de la vela.

### Delta
```python
delta = ask_volume - bid_volume
# Positivo = compradores dominan
# Negativo = vendedores dominan
```

---

## ENDPOINTS API (OBJETIVO)

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado del servidor |
| `/api/orderflow/status` | GET | Estado del servicio Order Flow |
| `/api/orderflow/footprint/{symbol}` | GET | Footprints de un simbolo |
| `/api/orderflow/config` | GET | Configuracion actual |
| `/api/orderflow/config` | POST | Actualizar configuracion |

### Ejemplo de Respuesta Footprint

```json
{
  "symbol": "BTCUSDT",
  "interval": "1",
  "footprints": [
    {
      "candle_timestamp": 1672304400000,
      "candle_open": 94950.0,
      "candle_high": 95100.0,
      "candle_low": 94900.0,
      "candle_close": 95050.0,
      "levels": [
        {
          "price_min": 94900.0,
          "price_max": 94933.33,
          "bid_volume": 150.5,
          "ask_volume": 302.1,
          "delta": 151.6,
          "trade_count": 45
        }
      ],
      "poc_index": 2,
      "total_delta": 450.2,
      "imbalances": [
        {"level_index": 0, "type": "BUY", "ratio": 2.01}
      ]
    }
  ]
}
```

---

## CONFIGURACION POR DEFECTO

```json
{
  "enabled": true,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "intervals": ["1", "5"],
  "num_levels": 6,
  "imbalance_threshold": 3.0,
  "stacked_min_levels": 3,
  "alerts_enabled": true,
  "alert_cooldown_minutes": 15,
  "max_footprints_in_memory": 2880,
  "log_trades": false
}
```

---

## RENDERIZADO FRONTEND (Canvas)

### Estructura Visual por Vela
```
  Precio  |    BID    |    ASK    | Delta
  --------+-----------+-----------+-------
  95100   |    150    |    302    | +152   <- Verde
  95066   |    200    |    180    |  -20   <- Rojo suave
  95033   |    450    |    890    | +440   <- Verde intenso (POC)
  95000   |    120    |     80    |  -40   <- Rojo
  94966   |     50    |    150    | +100   <- Verde
  94933   |    180    |     60    | -120   <- Rojo
```

### Colores
```javascript
const COLORS = {
  BUY_STRONG: '#00C853',    // Delta > +50%
  BUY_WEAK: '#81C784',      // Delta > 0
  SELL_STRONG: '#FF1744',   // Delta < -50%
  SELL_WEAK: '#EF9A9A',     // Delta < 0
  NEUTRAL: '#FFEB3B',       // Delta ~0
  POC_LINE: '#FFFFFF',      // Linea del POC
  IMBALANCE_BORDER: '#FFD600'  // Borde para imbalances
};
```

---

## LIMITES Y CONSIDERACIONES

| Aspecto | Limite | Razon |
|---------|--------|-------|
| Footprints en memoria | 2,880 | 1 dia de velas 1min x 2 simbolos |
| Trades por segundo (pico) | ~1,000 | BTCUSDT en alta volatilidad |
| Niveles por vela | 6 | Simplifica visualizacion |
| Cooldown alertas | 15 min | Evita spam |

---

## RELACION CON OTRAS APPS

```
5.Order_flow (puerto 11000/11001)
    |
    +-- Base copiada de: 4.Analizador cripto
    |   - Estructura de archivos
    |   - Sistema de indicadores
    |   - Herramientas de dibujo
    |
    +-- Se conecta a: 3.TradingBot_Python (puerto 5000)
        - Envia alertas de stacked imbalances
        - POST /api/watchlist-alert
```

---

## PUERTOS DEL ECOSISTEMA

| Aplicacion | Backend | Frontend |
|------------|---------|----------|
| Analizador Cripto | 10000 | 10001 |
| **Order Flow** | **11000** | **11001** |
| TradingBot | 5000 | 3000 |
| Watchlist | 8000 | 5173 |

---

## TROUBLESHOOTING

### Puerto en uso
```bash
netstat -ano | findstr :11000
taskkill /PID <PID> /F
```

### WebSocket no conecta
- Verificar que Bybit no este bloqueado
- Verificar logs: `[WS] Connected to Bybit`

### Trades no llegan
- Verificar suscripcion: `publicTrade.BTCUSDT`
- Bybit puede tardar 1-2 segundos en enviar primer trade

### Footprint vacio
- Verificar que hay trades en el intervalo actual
- En horarios de baja actividad puede haber velas sin trades

---

## CHECKLIST ANTES DE CADA ITERACION

- [ ] Leer IMPLEMENTATION_PLAN.md
- [ ] Identificar tarea actual
- [ ] Verificar que la tarea anterior esta marcada [x]
- [ ] Completar SOLO la tarea actual
- [ ] Ejecutar verificacion si aplica
- [ ] Marcar [x] y actualizar "Estado Actual"
