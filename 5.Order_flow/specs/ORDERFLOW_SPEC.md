# ORDERFLOW_SPEC.md - Especificacion Tecnica

## 1. Vision General

Order Flow muestra el flujo de ordenes (compras vs ventas) por nivel de precio dentro de cada vela.
A diferencia de un chart tradicional que solo muestra OHLCV, el footprint revela:
- Donde estan comprando agresivamente (ask volume)
- Donde estan vendiendo agresivamente (bid volume)
- Imbalances que indican presion direccional

---

## 2. Fuente de Datos: Bybit WebSocket

### Endpoint
```
wss://stream.bybit.com/v5/public/linear
```

### Suscripcion
```json
{
  "op": "subscribe",
  "args": ["publicTrade.BTCUSDT", "publicTrade.ETHUSDT"]
}
```

### Formato de Trade Recibido
```json
{
  "topic": "publicTrade.BTCUSDT",
  "type": "snapshot",
  "ts": 1672304486868,
  "data": [
    {
      "T": 1672304486865,
      "s": "BTCUSDT",
      "S": "Buy",
      "v": "0.001",
      "p": "95000.50",
      "L": "PlusTick",
      "i": "20f43950-d8dd-5678-abcd-1234567890ab",
      "BT": false
    }
  ]
}
```

### Campos Importantes
| Campo | Tipo | Descripcion |
|-------|------|-------------|
| `T` | int | Timestamp del trade en milliseconds |
| `s` | string | Simbolo (BTCUSDT) |
| `S` | string | Side: "Buy" o "Sell" |
| `v` | string | Volumen del trade |
| `p` | string | Precio de ejecucion |

### Interpretacion del Side
- `"Buy"` = Comprador agresivo (lift the ask) → Suma a **ask volume**
- `"Sell"` = Vendedor agresivo (hit the bid) → Suma a **bid volume**

---

## 3. Estructura de Datos Interna

### FootprintLevel
```python
@dataclass
class FootprintLevel:
    price_min: float      # Limite inferior del nivel
    price_max: float      # Limite superior del nivel
    bid_volume: float     # Volumen de vendedores agresivos
    ask_volume: float     # Volumen de compradores agresivos
    trade_count: int      # Cantidad de trades en este nivel

    @property
    def delta(self) -> float:
        return self.ask_volume - self.bid_volume

    @property
    def total_volume(self) -> float:
        return self.bid_volume + self.ask_volume

    @property
    def imbalance_ratio(self) -> float:
        min_vol = min(self.bid_volume, self.ask_volume)
        max_vol = max(self.bid_volume, self.ask_volume)
        return max_vol / min_vol if min_vol > 0 else float('inf')
```

### Footprint (por vela)
```python
@dataclass
class Footprint:
    candle_timestamp: int           # Timestamp de la vela
    symbol: str
    interval: str                   # "1" o "5"
    candle_high: float
    candle_low: float
    candle_open: float
    candle_close: float
    levels: List[FootprintLevel]    # 6 niveles

    @property
    def poc_index(self) -> int:
        """Indice del nivel con mayor volumen total"""
        return max(range(len(self.levels)),
                   key=lambda i: self.levels[i].total_volume)

    @property
    def total_delta(self) -> float:
        return sum(level.delta for level in self.levels)

    def get_imbalances(self, threshold: float = 3.0) -> List[dict]:
        """Retorna niveles con imbalance >= threshold"""
        result = []
        for i, level in enumerate(self.levels):
            if level.imbalance_ratio >= threshold:
                result.append({
                    "level_index": i,
                    "type": "BUY" if level.ask_volume > level.bid_volume else "SELL",
                    "ratio": level.imbalance_ratio,
                    "price_mid": (level.price_min + level.price_max) / 2
                })
        return result
```

---

## 4. Algoritmo de Calculo de Niveles

### Crear Niveles (6 fijos por vela)
```python
NUM_LEVELS = 6

def create_levels(candle_high: float, candle_low: float) -> List[FootprintLevel]:
    """
    Divide el rango HIGH-LOW en 6 niveles iguales.
    Si la vela es doji (high == low), crear un solo nivel.
    """
    if candle_high == candle_low:
        # Vela doji - un solo nivel
        return [FootprintLevel(
            price_min=candle_low - 0.01,
            price_max=candle_high + 0.01,
            bid_volume=0,
            ask_volume=0,
            trade_count=0
        )]

    range_size = candle_high - candle_low
    level_size = range_size / NUM_LEVELS

    levels = []
    for i in range(NUM_LEVELS):
        levels.append(FootprintLevel(
            price_min=candle_low + (i * level_size),
            price_max=candle_low + ((i + 1) * level_size),
            bid_volume=0,
            ask_volume=0,
            trade_count=0
        ))

    return levels
```

### Asignar Trade a Nivel
```python
def find_level_index(price: float, levels: List[FootprintLevel]) -> int:
    """
    Encuentra el indice del nivel donde cae el precio.
    Retorna el ultimo nivel si el precio esta en el high exacto.
    """
    for i, level in enumerate(levels):
        if level.price_min <= price < level.price_max:
            return i

    # Precio en el high exacto → ultimo nivel
    return len(levels) - 1
```

### Procesar Trade
```python
def process_trade(trade: dict, footprint: Footprint):
    """
    Agrega el volumen del trade al nivel correspondiente.
    """
    price = float(trade['p'])
    volume = float(trade['v'])
    side = trade['S']  # "Buy" o "Sell"

    level_idx = find_level_index(price, footprint.levels)
    level = footprint.levels[level_idx]

    if side == "Buy":
        level.ask_volume += volume
    else:
        level.bid_volume += volume

    level.trade_count += 1
```

---

## 5. Deteccion de Patrones

### Imbalance Simple
```python
def is_imbalance(level: FootprintLevel, threshold: float = 3.0) -> bool:
    """
    Un imbalance ocurre cuando un lado tiene >= threshold veces
    mas volumen que el otro.
    """
    return level.imbalance_ratio >= threshold
```

### Stacked Imbalance (3+ niveles consecutivos)
```python
def detect_stacked_imbalances(footprint: Footprint,
                               min_consecutive: int = 3,
                               threshold: float = 3.0) -> List[dict]:
    """
    Detecta cuando 3 o mas niveles consecutivos tienen imbalance
    en la misma direccion.
    """
    stacked = []
    current_streak = []
    current_direction = None

    for i, level in enumerate(footprint.levels):
        if level.imbalance_ratio >= threshold:
            direction = "BUY" if level.ask_volume > level.bid_volume else "SELL"

            if direction == current_direction:
                current_streak.append(i)
            else:
                # Nueva direccion - guardar streak anterior si es valido
                if len(current_streak) >= min_consecutive:
                    stacked.append({
                        "type": "STACKED_IMBALANCE",
                        "direction": current_direction,
                        "levels": current_streak.copy(),
                        "start_price": footprint.levels[current_streak[0]].price_min,
                        "end_price": footprint.levels[current_streak[-1]].price_max
                    })
                current_streak = [i]
                current_direction = direction
        else:
            # Sin imbalance - cerrar streak si es valido
            if len(current_streak) >= min_consecutive:
                stacked.append({
                    "type": "STACKED_IMBALANCE",
                    "direction": current_direction,
                    "levels": current_streak.copy(),
                    "start_price": footprint.levels[current_streak[0]].price_min,
                    "end_price": footprint.levels[current_streak[-1]].price_max
                })
            current_streak = []
            current_direction = None

    # Cerrar ultimo streak
    if len(current_streak) >= min_consecutive:
        stacked.append({
            "type": "STACKED_IMBALANCE",
            "direction": current_direction,
            "levels": current_streak.copy(),
            "start_price": footprint.levels[current_streak[0]].price_min,
            "end_price": footprint.levels[current_streak[-1]].price_max
        })

    return stacked
```

---

## 6. Formato de Respuesta API

### GET /api/orderflow/status
```json
{
  "status": "ok",
  "service": "orderflow",
  "enabled": true,
  "symbols": ["BTCUSDT", "ETHUSDT"],
  "intervals": ["1", "5"],
  "websocket_connected": true,
  "trades_received_total": 15234,
  "footprints_in_memory": 2880
}
```

### GET /api/orderflow/footprint/{symbol}?interval=1&limit=100
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
        },
        // ... 5 niveles mas
      ],
      "poc_index": 2,
      "total_delta": 450.2,
      "imbalances": [
        {"level_index": 0, "type": "BUY", "ratio": 2.01}
      ]
    }
    // ... mas footprints
  ]
}
```

### GET /api/orderflow/config
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
  "max_footprints_in_memory": 2880
}
```

---

## 7. Formato de Alerta

### Alerta al TradingBot (Puerto 5000)
```json
{
  "source": "ORDER_FLOW",
  "symbol": "BTCUSDT",
  "interval": "1",
  "pattern": {
    "patternType": "STACKED_IMBALANCE",
    "direction": "BUY",
    "price": 95000.0,
    "confidence": 85,
    "timestamp": 1672304486865,
    "details": {
      "levels_count": 3,
      "avg_ratio": 4.2,
      "start_price": 94950.0,
      "end_price": 95050.0
    }
  }
}
```

---

## 8. Renderizado Frontend (Canvas)

### Estructura Visual
```
  Precio  │    BID    │    ASK    │ Delta
  ────────┼───────────┼───────────┼───────
  95100   │    150    │    302    │ +152   ← Verde (compras dominan)
  95066   │    200    │    180    │  -20   ← Rojo suave
  95033   │    450    │    890    │ +440   ← Verde intenso (POC)
  95000   │    120    │     80    │  -40   ← Rojo
  94966   │     50    │    150    │ +100   ← Verde
  94933   │    180    │     60    │ -120   ← Rojo
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
  IMBALANCE_BORDER: '#FFD600'  // Borde amarillo para imbalances
};
```

### Algoritmo de Intensidad de Color
```javascript
function getColorForDelta(delta, totalVolume) {
  const ratio = delta / totalVolume;  // -1 a +1

  if (ratio > 0.5) return COLORS.BUY_STRONG;
  if (ratio > 0) return COLORS.BUY_WEAK;
  if (ratio < -0.5) return COLORS.SELL_STRONG;
  if (ratio < 0) return COLORS.SELL_WEAK;
  return COLORS.NEUTRAL;
}
```

---

## 9. Configuracion por Defecto

### config/orderflow_config.json
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

## 10. Limites y Consideraciones

| Aspecto | Limite | Razon |
|---------|--------|-------|
| Footprints en memoria | 2,880 | 1 dia de velas 1min × 2 simbolos |
| Trades por segundo (pico) | ~1,000 | BTCUSDT en alta volatilidad |
| Niveles por vela | 6 | Simplifica visualizacion |
| Cooldown alertas | 15 min | Evita spam |

### Limpieza de Memoria
```python
def cleanup_old_footprints(max_age_hours: int = 24):
    """
    Elimina footprints mas antiguos que max_age_hours.
    Ejecutar cada hora.
    """
    cutoff = time.time() * 1000 - (max_age_hours * 3600 * 1000)
    # Eliminar footprints con candle_timestamp < cutoff
```
