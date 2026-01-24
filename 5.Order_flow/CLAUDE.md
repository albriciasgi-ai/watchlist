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

## ESTRUCTURA DEL PROYECTO

```
5.Order_flow/
├── backend/
│   ├── main.py                    # Servidor FastAPI (puerto 11000)
│   ├── websocket_manager.py       # WebSocket Bybit (klines + trades)
│   ├── trade_aggregator.py        # Acumula trades por vela
│   ├── footprint_calculator.py    # Calcula footprint con STEP SIZE ABSOLUTO
│   ├── footprint_storage.py       # Persistencia de footprints en disco (NUEVO)
│   ├── orderflow_service.py       # Servicio principal Order Flow
│   ├── alert_sender.py            # Sistema de alertas
│   ├── config/
│   │   └── orderflow_config.json  # Config persistente
│   ├── footprint_cache/           # Cache de footprints por simbolo (NUEVO)
│   │   ├── BTCUSDT_1.json
│   │   └── ETHUSDT_1.json
│   ├── cache/
│   └── logs/
│       └── orderflow_alerts.log
│
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── SingleSymbolAnalyzer.jsx
│   │   │   ├── MiniChart.jsx
│   │   │   ├── OrderFlowSettings.jsx     # Modal config con Step Size
│   │   │   └── indicators/
│   │   │       ├── IndicatorManager.js
│   │   │       └── OrderFlowIndicator.js # Renderiza footprint con priceToY absoluto
│   │   ├── config.js              # API_BASE_URL = localhost:11000
│   │   └── styles.css
│   └── vite.config.js             # Puerto 11001
│
├── CLAUDE.md                      # Este archivo
└── START.bat
```

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
FootprintCalculator (STEP SIZE ABSOLUTO)
        |
        v
OrderFlowService (singleton)
        |
        +---> FootprintStorage (persistencia en disco)
        |
        +---> REST API (GET /api/orderflow/footprint/{symbol})
        |
        +---> Alertas (POST localhost:5000/api/watchlist-alert)
```

### Interpretacion del Side (Bybit)

- `"Buy"` = Comprador agresivo (lift the ask) -> Suma a **ask_volume**
- `"Sell"` = Vendedor agresivo (hit the bid) -> Suma a **bid_volume**

---

## STEP SIZE ABSOLUTO (Concepto Clave - Enero 2026)

### Problema Original
El enfoque inicial divida el rango de cada vela en N niveles iguales (ej: 6 niveles).
Esto causaba que:
- Velas pequenas tenian niveles diminutos ilegibles
- Velas grandes tenian niveles enormes
- Los niveles NO estaban alineados entre velas (precio $95,010 aparecia en diferente posicion Y en cada vela)

### Solucion: Step Size Absoluto (como ATAS, Sierra Chart)

En lugar de dividir cada vela en N partes, usamos un **STEP SIZE fijo** en USD:

```python
# footprint_calculator.py
DEFAULT_STEP_SIZES = {
    "BTCUSDT": 10.0,     # $10 por nivel para BTC
    "ETHUSDT": 2.0,      # $2 por nivel para ETH
    "SOLUSDT": 0.5,      # $0.50 por nivel para SOL
    "BNBUSDT": 1.0,      # $1 por nivel para BNB
    "XRPUSDT": 0.005,    # $0.005 por nivel para XRP
    # ...
}
```

### Como Funciona

1. **Redondeo al grid**: Los precios se redondean al step size mas cercano
   ```python
   def round_price_to_step(price, step_size, direction="down"):
       if direction == "down":
           return math.floor(price / step_size) * step_size
       else:
           return math.ceil(price / step_size) * step_size
   ```

2. **Niveles con precios absolutos**: Cada nivel tiene `price_min` y `price_max` absolutos
   ```python
   # Vela de $95,000 a $95,050 con step=$10
   # Genera 5 niveles:
   # Nivel 0: $95,000 - $95,010
   # Nivel 1: $95,010 - $95,020
   # Nivel 2: $95,020 - $95,030
   # Nivel 3: $95,030 - $95,040
   # Nivel 4: $95,040 - $95,050
   ```

3. **Alineacion global**: El nivel $95,010-$95,020 SIEMPRE aparece en la misma posicion Y, sin importar el tamano de la vela

4. **Cantidad variable de niveles**: Velas grandes tienen MAS niveles, velas pequenas tienen MENOS (pero todos del mismo tamano)

### Renderizado Frontend con priceToY Absoluto

```javascript
// OrderFlowIndicator.js - renderCandleFootprint()
for (let i = 0; i < levels.length; i++) {
  const level = levels[i];

  // Usar precios ABSOLUTOS del nivel
  const levelTopY = priceToY(level.price_max);
  const levelBottomY = priceToY(level.price_min);
  const levelHeight = Math.abs(levelBottomY - levelTopY);

  // Renderizar con altura basada en precio real
  ctx.fillRect(footprintX, bgY, footprintWidth, levelHeight - levelGap);
}
```

### Endpoints de Step Size

```
GET /api/orderflow/step-size/{symbol}
  -> { step_size, default_step_size, is_custom, all_defaults }

POST /api/orderflow/step-size/{symbol}
  Body: { "step_size": 10.0 }
```

---

## PERSISTENCIA DE FOOTPRINTS (Enero 2026)

### Problema
Los footprints solo existian en memoria. Al reiniciar el backend, se perdian todos los datos.

### Solucion: FootprintStorage

```python
# footprint_storage.py
class FootprintStorage:
    """
    Guarda footprints en archivos JSON:
    footprint_cache/BTCUSDT_1.json
    footprint_cache/ETHUSDT_1.json
    """
```

### Flujo de Persistencia

```
1. Backend inicia
   -> Carga footprints de footprint_cache/*.json
   -> Los agrega a memoria

2. Nuevo footprint completado
   -> Guarda en memoria
   -> Guarda en disco (auto-save cada 30s)

3. Cada hora
   -> Limpia footprints > max_history_hours (default 12h)

4. Backend se detiene
   -> Flush final a disco
```

### Configuracion

```python
@dataclass
class OrderFlowConfig:
    max_history_hours: float = 12.0  # Horas de historial a mantener
    max_footprints_in_memory: int = 2880  # ~1 dia de velas 1min x 2 simbolos
```

### Endpoint con Filtro de Horas

```
GET /api/orderflow/footprint/BTCUSDT?interval=1&limit=2000&hours=12
```

---

## ESTRUCTURA DE DATOS

### FootprintLevel

```python
@dataclass
class FootprintLevel:
    price_min: float      # Limite inferior (precio absoluto)
    price_max: float      # Limite superior (precio absoluto)
    bid_volume: float     # Vendedores agresivos
    ask_volume: float     # Compradores agresivos
    trade_count: int      # Cantidad de trades

    @property
    def price_mid(self) -> float:
        return (self.price_min + self.price_max) / 2

    @property
    def delta(self) -> float:
        return self.ask_volume - self.bid_volume
```

### Footprint

```python
@dataclass
class Footprint:
    candle_timestamp: int
    symbol: str
    interval: str         # "1" o "5"
    candle_high: float
    candle_low: float
    candle_open: float
    candle_close: float
    step_size: float      # Step size usado para este footprint
    levels: List[FootprintLevel]
```

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

## ENDPOINTS API

| Endpoint | Metodo | Descripcion |
|----------|--------|-------------|
| `/api/status` | GET | Estado del servidor |
| `/api/orderflow/status` | GET | Estado del servicio Order Flow |
| `/api/orderflow/footprint/{symbol}` | GET | Footprints de un simbolo |
| `/api/orderflow/config` | GET | Configuracion actual |
| `/api/orderflow/config` | POST | Actualizar configuracion |
| `/api/orderflow/step-size/{symbol}` | GET | Step size de un simbolo |
| `/api/orderflow/step-size/{symbol}` | POST | Actualizar step size |

### Ejemplo de Respuesta Footprint

```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "1",
  "count": 720,
  "hours_requested": 12,
  "footprints": [
    {
      "candle_timestamp": 1672304400000,
      "candle_open": 94950.0,
      "candle_high": 95100.0,
      "candle_low": 94900.0,
      "candle_close": 95050.0,
      "step_size": 10.0,
      "num_levels": 20,
      "levels": [
        {
          "price_min": 94900.0,
          "price_max": 94910.0,
          "price_mid": 94905.0,
          "bid_volume": 150.5,
          "ask_volume": 302.1,
          "delta": 151.6,
          "trade_count": 45
        }
      ],
      "poc_index": 10,
      "poc_price": 95005.0,
      "total_delta": 450.2,
      "imbalances": [
        {"level_index": 5, "type": "BUY", "ratio": 3.5}
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
  "intervals": ["1"],
  "imbalance_threshold": 3.0,
  "stacked_min_levels": 3,
  "alerts_enabled": true,
  "alert_cooldown_minutes": 15,
  "max_footprints_in_memory": 2880,
  "max_history_hours": 12.0,
  "log_trades": false,
  "symbol_step_sizes": {}
}
```

---

## RENDERIZADO FRONTEND (Canvas)

### Estilo Visual (Similar a ATAS)

Cada nivel muestra:
- **Izquierda (rojo)**: BID volume (vendedores agresivos)
- **Derecha (verde)**: ASK volume (compradores agresivos)
- **Linea blanca**: POC (Point of Control)
- **Borde amarillo**: Imbalances

```
  |  BID  |  ASK  |
  +-------+-------+
  |  150  |  302  |  <- Verde (mas asks)
  |  200  |  180  |  <- Rojo (mas bids)
  |==450==|==890==|  <- POC (mayor volumen)
  |  120  |   80  |
  |   50  |  150  |
  +-------+-------+
      +152 (delta total)
```

### Colores

```javascript
const COLORS = {
  bidBgColor: 'rgba(183, 28, 28, 0.85)',   // Rojo oscuro para bids dominantes
  bidBgLight: 'rgba(239, 154, 154, 0.7)',  // Rojo claro
  askBgColor: 'rgba(27, 94, 32, 0.85)',    // Verde oscuro para asks dominantes
  askBgLight: 'rgba(165, 214, 167, 0.7)',  // Verde claro
  POC_LINE: 'rgba(255, 255, 255, 0.9)',    // Blanco
  IMBALANCE_BORDER: '#FFD600'              // Amarillo
};
```

---

## PROBLEMAS RESUELTOS Y LECCIONES APRENDIDAS

### 1. Velas Japonesas Tapaban el Footprint

**Problema**: El footprint se renderizaba detras de las velas japonesas.

**Solucion**: Renderizar el footprint DESPUES de las velas en MiniChart.jsx:
```javascript
// MiniChart.jsx - despues de dibujar velas japonesas
if (orderFlowIndicator?.enabled && orderFlowIndicator.hasFootprintData()) {
  orderFlowIndicator.renderOverlay(ctx, overlayBounds, visibleCandles, displayCandles, priceContext);
}
```

### 2. Niveles de Tamano Inconsistente

**Problema**: Dividir velas en N niveles causaba niveles de diferentes tamanos.

**Solucion**: Step Size Absoluto (ver seccion arriba).

### 3. Footprints se Perdian al Reiniciar

**Problema**: Sin persistencia, los datos se perdian.

**Solucion**: FootprintStorage con archivos JSON.

### 4. shouldReplaceCandles() Causaba Grafico Vacio

**Problema**: Retornar `true` en `shouldReplaceCandles()` ocultaba todas las velas, pero solo habia 1-2 footprints.

**Solucion**: Siempre retornar `false` y renderizar footprint como overlay:
```javascript
shouldReplaceCandles() {
  return false;  // Las velas se dibujan, footprint va encima
}
```

---

## LIMITES Y CONSIDERACIONES

| Aspecto | Limite | Razon |
|---------|--------|-------|
| Footprints en memoria | 2,880 | 1 dia de velas 1min x 2 simbolos |
| Historial en disco | 12 horas | Configurable via max_history_hours |
| Trades por segundo (pico) | ~1,000 | BTCUSDT en alta volatilidad |
| Niveles max por vela | 50 | Safety limit en footprint_calculator |
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
| Backtester | 9000 | 5173 |

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

### Niveles muy pequenos o muy grandes
- Ajustar step_size para el simbolo en el modal de settings
- BTC tipicamente usa $10, ETH $2, altcoins mas pequenos

### Footprints no persisten
- Verificar que existe `backend/footprint_cache/`
- Revisar logs por errores de escritura

---

## ARCHIVOS CLAVE

| Archivo | Descripcion |
|---------|-------------|
| `footprint_calculator.py` | Logica de step size absoluto y creacion de niveles |
| `footprint_storage.py` | Persistencia en JSON |
| `orderflow_service.py` | Orquestador principal |
| `OrderFlowIndicator.js` | Renderizado con priceToY absoluto |
| `OrderFlowSettings.jsx` | Modal de configuracion |

---

## HISTORIAL DE CAMBIOS

### Sesion Enero 2026 - Step Size Absoluto y Persistencia

**Problemas heredados de implementacion anterior:**
1. Niveles de tamano variable (dividir vela en N partes)
2. Sin alineacion entre velas
3. Sin persistencia de footprints

**Soluciones implementadas:**
1. **Step Size Absoluto**: Niveles de tamano fijo en USD ($10 para BTC)
2. **priceToY Absoluto**: Renderizado usando `level.price_min/price_max`
3. **FootprintStorage**: Persistencia en `footprint_cache/*.json`
4. **Historial configurable**: 12 horas por defecto, ajustable

**Archivos modificados:**
- `footprint_calculator.py` - Reescrito completamente
- `footprint_storage.py` - Creado desde cero
- `orderflow_service.py` - Integracion con storage
- `OrderFlowIndicator.js` - Renderizado absoluto
- `OrderFlowSettings.jsx` - Controles de step size y horas
- `main.py` - Nuevos endpoints
