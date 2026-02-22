# Protocolo de Pruebas - Strategy Builder

## Objetivo

Verificar que CADA parametro del Strategy Builder afecta los resultados del backtest de forma predecible. Cada prueba cambia UN SOLO parametro respecto al baseline y compara resultados.

---

## Configuracion General

| Parametro | Valor |
|-----------|-------|
| Simbolo | BTCUSDT |
| Intervalo | 60 (1 hora) |
| Dias | 90 |
| Hash checkbox | ACTIVADO (verificar determinismo) |

**IMPORTANTE:** Antes de iniciar las pruebas, ejecutar el baseline 2 veces y verificar que el hash y todos los resultados son identicos. Si no lo son, reiniciar el backend y repetir.

---

## BASELINE (Configuracion base para todas las pruebas)

Anotar estos valores como referencia para comparar:

### Niveles
- **VP Periodic**: ON
  - Period: 240
  - Bins: 50
  - POC: ON, VAH: ON, VAL: ON
  - Segmentos activos: 1
- Todos los demas: OFF

### Senal de Entrada
- **Price Touch**
  - Tolerancia: 0.15%

### Filtros de Contexto
- **Direction**: ON, allowed = both
- Todos los demas: OFF

### Riesgo
- SL: Below Level, Buffer 0.10%
- TP: R:R Fixed, RR = 2.0
- Max trades/segmento: 1
- Cooldown bars: 0

### Exit Rules
- Todas OFF

### Otros
- Confluencia: any
- VWAP Period: 20

**Resultado baseline esperado:** Anotar trades, WR%, PnL R, hash

---

## GRUPO A: Level Sources

Objetivo: Verificar que cada fuente de niveles genera resultados diferentes y que sus parametros afectan la deteccion.

### A1 - VP Periodic: Cambio de Period

**Cambio vs baseline:** VP Periodic period = 120 (en vez de 240)

**Efecto esperado:** Segmentos mas cortos = mas niveles = mas oportunidades de entrada. Los niveles POC/VAH/VAL se recalculan con ventanas mas pequenas, generando valores diferentes. Deberia cambiar el numero de trades y potencialmente las metricas.

**Que verificar:**
- Trades != baseline (si son iguales, el period NO esta funcionando)
- Niveles deberian ser mas (segmentos mas frecuentes)

---

### A2 - VP Periodic: Cambio de Bins

**Cambio vs baseline:** VP Periodic bins = 20 (en vez de 50)

**Efecto esperado:** Menos bins = resolucion mas baja del perfil de volumen = POC, VAH, VAL en precios ligeramente diferentes. Deberia cambiar trades.

**Que verificar:**
- Trades != baseline
- Si trades son iguales, bins NO afecta

---

### A3 - VP Periodic: Solo POC (sin VAH/VAL)

**Cambio vs baseline:** VAH = OFF, VAL = OFF (solo POC = ON)

**Efecto esperado:** Menos niveles (1 por segmento en vez de 3) = menos senales = menos trades. Los trades que quedan deberian ser un subconjunto del baseline.

**Que verificar:**
- Trades < baseline (debe haber MENOS)
- Si trades >= baseline, el toggle no funciona

---

### A4 - VP Periodic: Lookback Segments = 0

**Cambio vs baseline:** Segmentos activos = 0 (en vez de 1)

**Efecto esperado:** Lookback 0 = los niveles son validos PARA SIEMPRE (no expiran). Esto deberia generar mas senales porque niveles viejos siguen activos. Lookback 1 = el nivel solo vive un periodo.

**Que verificar:**
- Trades deberian ser diferentes (potencialmente mas)
- filter_stats.signals_generated deberia cambiar

---

### A5 - S&R v2 solo (sin VP Periodic)

**Cambio vs baseline:** VP Periodic = OFF, S&R v2 = ON (swing_bars=3, cluster_dist=0.3, min_touches=2, max_levels=10, recalc_every=100)

**Efecto esperado:** Fuente de niveles completamente diferente (swing points clusterizados vs volumen). Trades totalmente distintos.

**Que verificar:**
- Trades != baseline
- Niveles diferentes (fuentes SR en vez de VP)

---

### A6 - VWAP Bands solo (sin VP Periodic)

**Cambio vs baseline:** VP Periodic = OFF, VWAP Bands = ON

**Efecto esperado:** VWAP + bandas sigma como niveles dinamicos. Niveles cambian cada vela. Comportamiento completamente diferente al baseline.

**Que verificar:**
- Trades != baseline
- Niveles son dinamicos (source = vwap_*)

---

### A7 - Swing Levels solo (sin VP Periodic)

**Cambio vs baseline:** VP Periodic = OFF, Swing Levels = ON (swing_bars=5)

**Efecto esperado:** Niveles basados en swing highs/lows individuales. Diferente a S&R v2 porque no agrupa en clusters.

**Que verificar:**
- Trades != baseline
- Trades != A5 (S&R v2 es diferente a Swing Levels)

---

### A8 - VP Periodic + S&R v2 juntos (confluence any)

**Cambio vs baseline:** S&R v2 = ON (ademas de VP Periodic que ya esta ON), confluence = any

**Efecto esperado:** Mas niveles disponibles = potencialmente mas senales. Trades >= baseline.

**Que verificar:**
- Trades >= baseline (mas fuentes de niveles = mas oportunidades)
- signals_generated >= baseline

---

### A9 - VP Periodic + S&R v2 (confluence score, min=30)

**Cambio vs baseline:** S&R v2 = ON, confluence = score, min_confluence_score = 30

**Efecto esperado:** Requiere que el precio este cerca de 2+ fuentes de niveles. Deberia filtrar muchas senales. Trades < A8.

**Que verificar:**
- Trades < A8 (el score filtra senales no confluentes)
- filter_stats.filtered_confluence > 0

---

## GRUPO B: Entry Signals

Objetivo: Verificar que cada tipo de senal genera trades diferentes.

### B1 - Price Touch: Tolerancia mayor

**Cambio vs baseline:** tolerance_pct = 0.50 (en vez de 0.15)

**Efecto esperado:** Tolerancia mayor = mas senales (acepta precios mas lejanos al nivel). Trades > baseline.

**Que verificar:**
- Trades > baseline
- signals_generated > baseline

---

### B2 - Price Touch: Tolerancia minima

**Cambio vs baseline:** tolerance_pct = 0.05

**Efecto esperado:** Tolerancia minima = menos senales (el precio debe tocar casi exactamente el nivel). Trades < baseline.

**Que verificar:**
- Trades < baseline
- signals_generated < baseline

---

### B3 - Breakout Close

**Cambio vs baseline:** Entry signal = breakout_close (tolerance=0.10)

**Efecto esperado:** Logica completamente diferente: busca cierres al OTRO lado del nivel en vez de toques. Cantidad de trades diferente.

**Que verificar:**
- Trades != baseline
- Direcciones pueden invertirse (breakout va EN CONTRA del nivel)

---

### B4 - Swing Confirm

**Cambio vs baseline:** Entry signal = swing_confirm (swing_bars=3, tolerance=0.30)

**Efecto esperado:** Requiere swing high/low confirmado cerca de nivel. Mucho mas restrictivo que price_touch. Trades < baseline.

**Que verificar:**
- Trades < baseline (confirmar swing requiere mas velas)
- signals_generated < baseline

---

### B5 - Rejection Candle

**Cambio vs baseline:** Entry signal = rejection_candle (tolerance=0.30, wick_body_ratio=2.0)

**Efecto esperado:** Busca velas con wicks largos rechazando niveles. Selectivo. Trades != baseline.

**Que verificar:**
- Trades != baseline
- Las velas de entrada deberian tener wicks prominentes

---

### B6 - Squeeze Release

**Cambio vs baseline:** Entry signal = squeeze_release

**Efecto esperado:** Solo entra cuando TTM Squeeze se libera. Completamente independiente de niveles como trigger (aunque necesita niveles para SL). Trades muy diferentes.

**Que verificar:**
- Trades != baseline
- Numero de trades potencialmente bajo (squeeze release es infrecuente)

---

### B7 - Pattern Match (Engulfing)

**Cambio vs baseline:** Entry signal = pattern_match (pattern_type=engulfing, tolerance=0.30)

**Efecto esperado:** Busca patrones engulfing cerca de niveles. Trades != baseline.

**Que verificar:**
- Trades != baseline

---

### B8 - CVD Divergence

**Cambio vs baseline:** Entry signal = cvd_divergence (lookback=20)

**Efecto esperado:** Busca divergencias precio vs CVD. Requiere que el precio haga lower low mientras CVD hace higher low (o viceversa). Trades != baseline.

**Que verificar:**
- Trades != baseline

---

## GRUPO C: Context Filters

Objetivo: Verificar que cada filtro reduce trades y que filter_stats reporta correctamente.

**CRITICO:** En cada prueba C, verificar `filter_stats` en la consola del backend. El filtro activado debe aparecer con contador > 0.

### C1 - Direction: Solo LONG

**Cambio vs baseline:** direction.allowed = long (en vez de both)

**Efecto esperado:** Solo trades LONG. Trades <= baseline/2 aproximadamente. Zero trades SHORT.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_direction > 0
- Todos los trades en el chart son verdes (LONG)

---

### C2 - Direction: Solo SHORT

**Cambio vs baseline:** direction.allowed = short

**Efecto esperado:** Solo trades SHORT. Complementario a C1.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_direction > 0
- C1.trades + C2.trades >= baseline.trades (deberian sumar ~igual al baseline)

---

### C3 - VWAP Trend

**Cambio vs baseline:** Activar filtro VWAP Trend (lookback=10, min_diff=0)

**Efecto esperado:** Solo permite LONG si VWAP sube y SHORT si VWAP baja. Filtra senales contra-tendencia. Trades < baseline.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_context.vwap_trend > 0

---

### C4 - TTM Squeeze: Requiere squeeze ON

**Cambio vs baseline:** Activar filtro TTM Squeeze (require_squeeze = ON)

**Efecto esperado:** Solo opera DURANTE squeeze (baja volatilidad). Filtra muchas senales. Trades << baseline.

**Que verificar:**
- Trades < baseline (potencialmente mucho menos)
- filter_stats.filtered_context.ttm_squeeze > 0

---

### C5 - TTM Squeeze: Requiere squeeze OFF

**Cambio vs baseline:** Activar filtro TTM Squeeze (require_squeeze = OFF)

**Efecto esperado:** Solo opera FUERA de squeeze. Complementario a C4.

**Que verificar:**
- Trades < baseline
- C4.trades + C5.trades ~= baseline.trades

---

### C6 - BBWP Range (0-30)

**Cambio vs baseline:** Activar filtro BBWP Range (min=0, max=30)

**Efecto esperado:** Solo opera en baja volatilidad (BBWP < 30). Filtra periodos de alta volatilidad. Trades < baseline.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_context.bbwp_range > 0

---

### C7 - Volume Z-Score

**Cambio vs baseline:** Activar filtro Volume Z-Score (min_zscore=1.5, lookback=20)

**Efecto esperado:** Solo opera cuando el volumen es anomalamente alto (1.5 desviaciones sobre media). Filtra velas de bajo volumen. Trades < baseline.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_context.volume_zscore > 0

---

### C8 - CVD Trend

**Cambio vs baseline:** Activar filtro CVD Trend (lookback=20)

**Efecto esperado:** LONG solo si CVD neto es positivo, SHORT solo si negativo. Filtra senales contra flujo de ordenes. Trades < baseline.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_context.cvd_trend > 0

---

### C9 - VWAP Position (trend mode)

**Cambio vs baseline:** Activar filtro VWAP Position (mode=trend, long_ref=vwap, short_ref=vwap)

**Efecto esperado:** LONG solo si precio > VWAP, SHORT solo si precio < VWAP. Trades < baseline.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_context.vwap_position > 0

---

### C10 - Dos filtros simultaneos (VWAP Trend + Volume Z-Score)

**Cambio vs baseline:** Activar VWAP Trend + Volume Z-Score (AND logic)

**Efecto esperado:** Ambos filtros deben pasar. Trades < C3 y < C7. Los filtros se aplican en AND.

**Que verificar:**
- Trades < min(C3.trades, C7.trades)
- Ambos filtros aparecen en filter_stats.filtered_context

---

## GRUPO D: Risk Management

Objetivo: Verificar que SL, TP, max_trades y cooldown funcionan.

### D1 - TP R:R = 1.0

**Cambio vs baseline:** tp_params.rr = 1.0 (en vez de 2.0)

**Efecto esperado:** TP mas cercano = mas WINs (mas facil de alcanzar), pero PnL por trade menor. WR deberia subir. Total PnL R puede bajar o subir.

**Que verificar:**
- WR% > baseline.WR% (TP mas facil de alcanzar)
- Numero de trades IGUAL al baseline (SL/TP no afecta cuantos trades se abren)

---

### D2 - TP R:R = 4.0

**Cambio vs baseline:** tp_params.rr = 4.0

**Efecto esperado:** TP muy lejano = menos WINs (mas dificil de alcanzar), pero cada WIN vale 4R. WR deberia bajar.

**Que verificar:**
- WR% < baseline.WR%
- Numero de trades IGUAL al baseline

---

### D3 - SL ATR Multiple

**Cambio vs baseline:** sl_method = atr_multiple, atr_multiplier = 1.5

**Efecto esperado:** SL basado en volatilidad en vez de nivel. Distancia de SL diferente = distancia de TP diferente (si TP es R:R). Metricas cambian.

**Que verificar:**
- WR% != baseline.WR%
- Algunos trades pueden ser filtrados (SL invalido si ATR produce SL en direccion incorrecta)

---

### D4 - SL Fixed %

**Cambio vs baseline:** sl_method = fixed_pct, fixed_pct = 1.0

**Efecto esperado:** SL siempre al 1% del entry. Uniforme. Metricas cambian.

**Que verificar:**
- WR% != baseline.WR%

---

### D5 - TP Opposite Level

**Cambio vs baseline:** tp_method = opposite_level, fallback_rr = 2.0

**Efecto esperado:** TP en el siguiente nivel opuesto. Si no hay nivel, usa fallback_rr=2.0. Trades con TP variable (no uniforme como R:R fijo). Potencialmente distinto WR.

**Que verificar:**
- WR% != baseline.WR% (TPs a distancias variables)
- Algunos TPs deberian ser a distancias != 2R

---

### D6 - Max Trades por Segmento = 3

**Cambio vs baseline:** max_trades_per_segment = 3 (en vez de 1)

**Efecto esperado:** Permite 3 trades por segmento VP en la misma direccion. Trades >= baseline.

**Que verificar:**
- Trades >= baseline
- filter_stats.filtered_max_trades_seg < baseline.filtered_max_trades_seg

---

### D7 - Cooldown Bars = 100

**Cambio vs baseline:** cooldown_bars = 100 (en vez de 0)

**Efecto esperado:** Despues de cada trade, espera 100 velas (100 horas en TF 1h). Reduce drasticamente la cantidad de trades. Trades < baseline.

**Que verificar:**
- Trades < baseline
- filter_stats.filtered_cooldown > 0

---

### D8 - SL Below Swing

**Cambio vs baseline:** sl_method = below_swing, buffer_pct = 0.10

**Efecto esperado:** SL en ultimo swing low (LONG) o swing high (SHORT). Diferente a below_level. Metricas cambian.

**Que verificar:**
- WR% != baseline.WR%
- Distancias de SL son variables (dependen del swing mas reciente)

---

## GRUPO E: Exit Rules

Objetivo: Verificar que las exit rules cierran trades ANTES de TP/SL.

### E1 - Timeout 30 bars

**Cambio vs baseline:** Activar exit rule timeout (max_bars = 30)

**Efecto esperado:** Trades que no llegan a TP ni SL en 30 velas se cierran anticipadamente. Mas trades cerrados "antes de tiempo". Potencialmente WR diferente.

**Que verificar:**
- Algunos trades deberian tener bars_held <= 30
- WR% puede cambiar (trades cerrados por timeout pueden ser win o loss parciales)
- Numero de trades IGUAL al baseline (exit rules no afectan cuantos se abren)

---

### E2 - VWAP Reverse

**Cambio vs baseline:** Activar exit rule vwap_reverse (lookback=10)

**Efecto esperado:** Cierra trades cuando VWAP gira en contra. Protege ganancias parciales. WR puede subir o bajar.

**Que verificar:**
- Trades = baseline.trades (mismos trades se abren)
- WR% != baseline.WR% (se cierran antes de llegar a SL o TP)

---

### E3 - Re-enter Zone

**Cambio vs baseline:** Activar exit rule reenter_zone

**Efecto esperado:** Cierra trade si precio vuelve al nivel de entrada. Corta perdidas antes de SL.

**Que verificar:**
- WR% != baseline.WR%

---

### E4 - Squeeze Activate

**Cambio vs baseline:** Activar exit rule squeeze_activate

**Efecto esperado:** Cierra trade si se activa nuevo TTM Squeeze. Asume que squeeze indica indecision.

**Que verificar:**
- WR% != baseline.WR%

---

### E5 - Multiples Exit Rules

**Cambio vs baseline:** Activar timeout (30) + vwap_reverse (10) (OR logic)

**Efecto esperado:** Cualquiera de las dos reglas puede cerrar el trade. Mas cierres anticipados que E1 o E2 solos.

**Que verificar:**
- WR% diferente a E1 y E2 individualmente

---

## GRUPO F: Determinismo y Edge Cases

### F1 - Determinismo (3 ejecuciones identicas)

**Config:** Exactamente el baseline

**Procedimiento:**
1. Ejecutar backtest → anotar hash, trades, WR, PnL
2. Ejecutar de nuevo → anotar hash, trades, WR, PnL
3. Ejecutar de nuevo → anotar hash, trades, WR, PnL

**Que verificar:**
- Las 3 ejecuciones tienen hash IDENTICO
- Las 3 ejecuciones tienen trades, WR, PnL IDENTICOS

---

### F2 - Determinismo despues de cambiar parametros

**Procedimiento:**
1. Ejecutar baseline → anotar hash, trades
2. Cambiar a period=120 → ejecutar
3. Cambiar de vuelta a period=240 → ejecutar
4. Comparar paso 1 con paso 3

**Que verificar:**
- Paso 1 y paso 3 tienen hash IDENTICO
- Paso 1 y paso 3 tienen resultados IDENTICOS

---

### F3 - Sin Level Sources (ninguno activado)

**Cambio vs baseline:** VP Periodic = OFF (y todos los demas OFF)

**Que verificar:**
- 0 trades (sin niveles no puede haber senales)
- No deberia dar error

---

### F4 - Timeframe diferente

**Cambio vs baseline:** Intervalo = 5 (5 min), Dias = 30

**Que verificar:**
- Resultados diferentes al baseline (mas velas, niveles diferentes)
- El backtest se ejecuta sin errores

---

### F5 - Simbolo diferente

**Cambio vs baseline:** Simbolo = ETHUSDT

**Que verificar:**
- Resultados completamente diferentes al baseline
- Hash diferente al baseline

---

## COMO REGISTRAR RESULTADOS

Para cada prueba, registrar en la hoja de calculo CSV:

1. **Test ID** (ej: A1, B3, C5)
2. **Trades** - numero total de trades
3. **WR%** - win rate
4. **PnL R** - PnL total en R
5. **Hash** - hash de determinismo
6. **Signals Gen** - signals_generated de filter_stats
7. **Filtered Dir** - filtered_direction
8. **Filtered Context** - filtros de contexto que bloquearon
9. **Filtered Cooldown** - filtered_cooldown
10. **PASS/FAIL** - segun el efecto esperado

### Como leer filter_stats

En la consola del backend (no del frontend), despues de cada backtest aparece:
```
[SB_BACKTEST] Filter stats: signals=XXX, dir=XXX, conf=XXX, maxSeg=XXX, context={...}, slInv=XXX, slDir=XXX, tpInv=XXX, opened=XXX
```

- `signals`: Total de senales detectadas ANTES de filtros
- `dir`: Bloqueadas por filtro de direccion
- `conf`: Bloqueadas por confluencia insuficiente
- `maxSeg`: Bloqueadas por max_trades_per_segment
- `context`: Dict con filtros de contexto que bloquearon y cuantas
- `slInv`: SL no se pudo calcular
- `slDir`: SL en direccion incorrecta (LONG con SL arriba del entry, etc)
- `tpInv`: TP no se pudo calcular
- `opened`: Trades que pasaron TODOS los filtros

---

## CRITERIOS DE APROBACION

Una prueba se considera **PASS** si:
1. El cambio de parametro produce un resultado DIFERENTE al baseline (excepto en pruebas de determinismo donde debe ser IGUAL)
2. La direccion del cambio es la esperada (ej: menos tolerancia = menos trades)
3. filter_stats reporta el filtro correcto cuando corresponde
4. No hay errores en consola

Una prueba se considera **FAIL** si:
1. El resultado es IDENTICO al baseline (el parametro NO tiene efecto)
2. La direccion del cambio es opuesta a la esperada
3. Hay errores en consola
4. filter_stats no muestra actividad del filtro probado

---

## ORDEN RECOMENDADO DE EJECUCION

1. **F1** (determinismo primero - si esto falla, nada mas tiene sentido)
2. **F2** (determinismo despues de cambios)
3. **A1-A9** (level sources)
4. **B1-B8** (entry signals)
5. **C1-C10** (context filters)
6. **D1-D8** (risk management)
7. **E1-E5** (exit rules)
8. **F3-F5** (edge cases)

Total: ~40 pruebas
