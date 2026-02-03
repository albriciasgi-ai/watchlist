# Zone Quality Simulation - Documentación

Sistema de análisis y simulación de zonas de consolidación para optimizar parámetros de trading.

---

## Endpoint

```
POST /api/zones/quality-simulation
```

---

## 1. Parámetros del Request

| Parámetro | Tipo | Descripción | Ejemplo |
|-----------|------|-------------|---------|
| `symbol` | string | Par a analizar | `"BTCUSDT"` |
| `interval` | string | Timeframe en minutos | `"5"` = 5 min |
| `days` | int | Días de datos históricos | `90`, `365` |
| `quality_threshold` | int | Score mínimo para zona "de calidad" (0-100) | `60` |
| `lookforward_bars` | int | Velas a analizar después del breakout | `100` |
| `trade_mode` | string | Modo de ejecución de trades | `"simultaneous"` o `"sequential"` |
| `param_grid` | object | Grilla de parámetros a probar | Ver sección 2 |

### Ejemplo de Request

```json
{
  "symbol": "BTCUSDT",
  "interval": "5",
  "days": 90,
  "quality_threshold": 60,
  "lookforward_bars": 100,
  "trade_mode": "simultaneous",
  "param_grid": {
    "consol_min_bars": [8, 12],
    "consol_max_bars": [50],
    "consol_max_range_pct": [2.0, 3.0],
    "consol_atr_ratio": [0.6],
    "consol_body_ratio": [0.5],
    "consol_max_outside_bars": [3]
  }
}
```

---

## 2. Parámetros de Detección de Zonas (param_grid)

Estos parámetros controlan cómo se detectan las zonas de consolidación:

| Parámetro | Descripción | Valores típicos | Efecto |
|-----------|-------------|-----------------|--------|
| `consol_min_bars` | **Velas mínimas** dentro de la zona para confirmarla | `[8, 12]` | Mayor = zonas más consolidadas |
| `consol_max_bars` | **Velas máximas** (zonas muy largas son menos útiles) | `[50]` | Menor = filtra zonas viejas |
| `consol_max_range_pct` | **Altura máxima** de zona como % del precio | `[2.0, 3.0]` | Menor = zonas más comprimidas |
| `consol_atr_ratio` | **Ratio ATR**: volatilidad de zona vs ATR histórico | `[0.6]` | <1 = zona con baja volatilidad |
| `consol_body_ratio` | **Ratio de cuerpo**: cuerpos pequeños = indecisión | `[0.5]` | Menor = más velas de indecisión |
| `consol_max_outside_bars` | **Barras fuera permitidas** antes de invalidar zona | `[3]` | Mayor = más tolerante a spikes |

### Interpretación de Parámetros Clave

**consol_max_range_pct = 2.0%**
- Si BTC está en $100,000, la zona puede tener máximo $2,000 de altura
- Zonas más pequeñas = movimientos más comprimidos = breakouts más explosivos

**consol_atr_ratio = 0.6**
- Si el ATR histórico es $500, la volatilidad dentro de la zona debe ser ≤ $300
- Ratio bajo = acumulación/distribución en silencio

**consol_min_bars = 12**
- Necesita al menos 12 velas dentro de la zona
- En 5 minutos = 1 hora mínimo de consolidación

---

## 3. Lógica de Trading (TP/SL)

### Definición de R
```
R = altura de la zona = range_high - range_low

Ejemplo: Zona de $95,000 a $95,500
R = $500
```

### Take Profit (TP) = 2R
```
Breakout UP:  TP = breakout_price + (2 × zone_height)
Breakout DOWN: TP = breakout_price - (2 × zone_height)

Ejemplo: Breakout UP desde $95,500
TP = $95,500 + (2 × $500) = $96,500
```

### Stop Loss (SL) = 1R adverso
```
Breakout UP:  SL = breakout_price - zone_height (volver a entrar a la zona)
Breakout DOWN: SL = breakout_price + zone_height

Ejemplo: Breakout UP desde $95,500
SL = $95,500 - $500 = $95,000 (regreso a la zona)
```

### Resultado del Trade
- **WIN**: El precio toca TP (2R) ANTES de tocar SL (1R adverso) → +2R
- **LOSS**: El precio toca SL (1R adverso) ANTES de tocar TP → -1R
- **OPEN**: El trade no cerró durante el período de análisis → 0R

---

## 4. Modos de Trading

### Modo Simultáneo (`trade_mode: "simultaneous"`)

```
Zona 1 detectada → Abre Trade 1
Zona 2 detectada → Abre Trade 2 (Trade 1 sigue abierto)
Zona 3 detectada → Abre Trade 3 (Trade 1 y 2 siguen abiertos)
...
```

**Características:**
- Cada zona detectada abre un trade independiente
- Múltiples trades pueden estar abiertos simultáneamente
- Más operaciones = mayor P&L absoluto potencial
- Riesgo: trades correlacionados pueden perder juntos

### Modo Secuencial (`trade_mode: "sequential"`)

```
Zona 1 detectada → Abre Trade 1
Zona 2 detectada → SKIP (Trade 1 aún abierto)
Trade 1 cierra
Zona 3 detectada → Abre Trade 2
Zona 4 detectada → SKIP (Trade 2 aún abierto)
...
```

**Características:**
- Solo 1 trade activo a la vez
- Zonas que aparecen durante un trade activo se **saltan**
- Más realista para trading manual con capital limitado
- Mejor expectancy (filtra trades de peor calidad)
- Menos operaciones = menor P&L absoluto

---

## 5. Métricas de Análisis

### Métricas R-Multiple

| Métrica | Descripción |
|---------|-------------|
| `r_multiple` | MFE / zone_height → ¿Cuántas R alcanzó el precio? |
| `max_favorable_excursion` (MFE) | Máximo movimiento a favor del trade |
| `max_adverse_excursion` (MAE) | Máximo movimiento en contra antes del MFE |
| `reached_2r` | ¿El precio llegó a 2R? (objetivo) |
| `reached_3r` | ¿El precio llegó a 3R? |
| `bars_to_2r` | Velas hasta alcanzar 2R (None si no llegó) |

### Métricas de Trading Real

| Métrica | Descripción |
|---------|-------------|
| `tp_hit_first` | ¿TP se tocó antes que SL? → WIN |
| `sl_hit_first` | ¿SL se tocó antes que TP? → LOSS |
| `trade_result` | `"WIN"`, `"LOSS"`, o `"OPEN"` |
| `trade_pnl_r` | P&L del trade: +2 (WIN), -1 (LOSS), 0 (OPEN) |
| `bars_to_close` | Duración del trade en velas |
| `trade_close_ts` | Timestamp de cierre del trade |

### Métricas de Momentum

| Métrica | Descripción |
|---------|-------------|
| `breakout_candle_body_ratio` | Tamaño del cuerpo de la vela de breakout / ATR |
| `continuation_bars` | Velas consecutivas en dirección del breakout |
| `max_pullback_pct` | Máximo retroceso como % del movimiento |
| `pullback_reentered_zone` | ¿El pullback volvió a entrar a la zona? |

### Métricas de Volumen

| Métrica | Descripción |
|---------|-------------|
| `zone_volume_vs_avg` | Volumen de la zona vs promedio histórico |
| `breakout_volume_spike` | Volumen del breakout vs promedio de zona |
| `volume_confirmation_bars` | Barras con volumen > promedio post-breakout |

---

## 6. Métricas de Resultado Agregadas

| Métrica | Descripción | Ejemplo |
|---------|-------------|---------|
| `total_zones` | Zonas detectadas | 455 |
| `total_wins` | Trades ganadores (TP antes de SL) | 169 |
| `total_losses` | Trades perdedores (SL antes de TP) | 286 |
| `total_still_open` | Trades que no cerraron | 0 |
| `real_win_rate` | % de wins sobre total cerrados | 37.1% |
| `total_pnl_r` | P&L total en R | +52R |
| `expectancy_r` | Expectativa por trade | 0.114R |
| `avg_bars_to_close` | Duración promedio de todos los trades | 82.1 |
| `avg_win_duration` | Duración promedio de wins | 91.3 |
| `avg_loss_duration` | Duración promedio de losses | 76.7 |

### Fórmulas

```
real_win_rate = total_wins / (total_wins + total_losses) × 100

total_pnl_r = (total_wins × 2) - (total_losses × 1)

expectancy_r = (win_rate × 2) - (loss_rate × 1)
            = (0.371 × 2) - (0.629 × 1)
            = 0.742 - 0.629
            = 0.113R por trade
```

---

## 7. Ejemplo de Respuesta

```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "interval": "5",
  "days": 90,
  "trade_mode": "simultaneous",
  "results": [
    {
      "params": {
        "consol_min_bars": 8,
        "consol_max_bars": 50,
        "consol_max_range_pct": 2.0,
        "consol_atr_ratio": 0.6,
        "consol_body_ratio": 0.5,
        "consol_max_outside_bars": 3
      },
      "total_zones": 455,
      "total_wins": 169,
      "total_losses": 286,
      "total_still_open": 0,
      "real_win_rate": 37.14,
      "total_pnl_r": 52.0,
      "expectancy_r": 0.114,
      "is_profitable": true,
      "avg_bars_to_close": 82.1,
      "avg_win_duration": 91.3,
      "avg_loss_duration": 76.7
    }
  ],
  "sequential_stats": null
}
```

### Respuesta con Modo Secuencial

```json
{
  "success": true,
  "trade_mode": "sequential",
  "results": [
    {
      "total_zones": 145,
      "total_wins": 61,
      "total_losses": 84,
      "real_win_rate": 42.07,
      "total_pnl_r": 38.0,
      "expectancy_r": 0.262
    }
  ],
  "sequential_stats": {
    "total_zones_available": 607,
    "trades_executed": 145,
    "trades_skipped": 398,
    "skip_rate_pct": 65.57
  }
}
```

---

## 8. Comparación de Modos (90 días, BTCUSDT 5m)

| Métrica | Simultáneo | Secuencial |
|---------|------------|------------|
| Zonas disponibles | 455 | 607 |
| Trades ejecutados | 455 | 145 |
| Trades saltados | 0 | 398 (65.6%) |
| **Real Win Rate** | **37.1%** | **42.1%** |
| **Expectancy** | **0.114R** | **0.262R** |
| **P&L Total** | **+52R** | **+38R** |
| Duración promedio | 82.1 velas | 102.7 velas |
| Duración wins | 91.3 velas | 112.9 velas |
| Duración losses | 76.7 velas | 95.4 velas |

### Interpretación

1. **Modo secuencial tiene mejor expectancy** (0.262R vs 0.114R)
   - Los trades que se saltan por estar en posición tenían peor calidad promedio
   - Actúa como filtro natural de calidad

2. **Los losses cierran más rápido que los wins**
   - El mercado tiende a moverse rápido contra posiciones perdedoras
   - Los wins necesitan más tiempo para desarrollarse

3. **P&L absoluto es mayor en simultáneo** (+52R vs +38R)
   - Más operaciones compensan la menor expectancy
   - Pero requiere más capital y gestión de múltiples posiciones

---

## 9. Recomendaciones de Uso

### Para Optimización de Parámetros
```json
{
  "days": 365,
  "trade_mode": "simultaneous",
  "param_grid": {
    "consol_min_bars": [6, 8, 10, 12],
    "consol_max_range_pct": [1.5, 2.0, 2.5, 3.0],
    "consol_atr_ratio": [0.4, 0.5, 0.6, 0.7]
  }
}
```

### Para Validación Realista
```json
{
  "days": 90,
  "trade_mode": "sequential",
  "param_grid": {
    "consol_min_bars": [12],
    "consol_max_range_pct": [2.0],
    "consol_atr_ratio": [0.6]
  }
}
```

### Para Backtesting Rápido
```json
{
  "days": 30,
  "lookforward_bars": 50,
  "trade_mode": "simultaneous"
}
```

---

## 10. Archivos Relacionados

| Archivo | Descripción |
|---------|-------------|
| `backend/zone_quality_analyzer.py` | Lógica de análisis y simulación |
| `backend/zone_detector.py` | Detección de zonas de consolidación |
| `backend/main.py` | Endpoint `/api/zones/quality-simulation` |

---

## 11. Notas Técnicas

### Sin Timeout
Los trades permanecen abiertos hasta que se toca TP o SL. No hay límite artificial de tiempo. Esto permite:
- Medir la duración real de los trades
- Identificar trades que nunca cierran (mercado lateral prolongado)

### Cálculo de Duración
```python
bars_to_close = índice_vela_cierre - índice_vela_breakout
```
En timeframe 5m: 100 bars = 500 minutos = 8.3 horas

### Quality Score
Score de 0-100 basado en:
- Fuerza del breakout (momentum)
- Confirmación de volumen
- Comportamiento post-breakout (pullback controlado)
- R-multiple alcanzado
