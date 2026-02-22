# STRATEGY BUILDER - Documentacion Completa

Sistema modular de backtesting sin codigo para crear estrategias de trading combinando 5 bloques independientes.

---

## Tabla de Contenidos

1. [Vision General](#vision-general)
2. [Acceso y Uso Basico](#acceso-y-uso-basico)
3. [Bloque 1: Level Sources (Fuentes de Niveles)](#bloque-1-level-sources)
4. [Bloque 2: Entry Signals (Senales de Entrada)](#bloque-2-entry-signals)
5. [Bloque 3: Context Filters (Filtros de Contexto)](#bloque-3-context-filters)
6. [Bloque 4: Risk Management (Gestion de Riesgo)](#bloque-4-risk-management)
7. [Bloque 5: Exit Rules (Reglas de Salida)](#bloque-5-exit-rules)
8. [Sistema de Confluencia](#sistema-de-confluencia)
9. [Parametros Generales](#parametros-generales)
10. [Sistema de Presets](#sistema-de-presets)
11. [Resultados del Backtest](#resultados-del-backtest)
12. [Optimizador de Parametros (Grid Search)](#optimizador-de-parametros)
13. [Visualizacion en el Chart](#visualizacion-en-el-chart)
14. [Servicio Realtime](#servicio-realtime)
15. [Diagnostico con Filter Stats](#diagnostico-con-filter-stats)
16. [Guia de Ajuste de Parametros](#guia-de-ajuste-de-parametros)
17. [Cache de Velas (Persistencia en Disco)](#cache-de-velas-persistencia-en-disco)
18. [Troubleshooting](#troubleshooting)

---

## Vision General

El Strategy Builder permite componer estrategias de trading modularmente combinando:

```
BLOQUE 1: NIVELES  -->  BLOQUE 2: SENAL  -->  BLOQUE 3: FILTROS  -->  BLOQUE 4: RIESGO  -->  BLOQUE 5: SALIDA
(De donde viene     (Cuando entrar)       (Condiciones extra)     (SL/TP/Sizing)         (Salidas adaptativas)
 el soporte/
 resistencia)
```

**Principio fundamental:** Cada bloque es independiente. Puedes cambiar la fuente de niveles sin tocar la senal de entrada, o cambiar el SL sin modificar los filtros. Esto permite iterar rapidamente sobre cada componente de la estrategia.

**Anti look-ahead:** Todos los indicadores y niveles se calculan SOLO con datos disponibles hasta el momento de la vela actual. No se usa informacion futura.

### Archivos del Sistema

| Archivo | Ubicacion | Descripcion |
|---------|-----------|-------------|
| `strategy_engine.py` | `4.Analizador cripto/backend/` | Motor de backtesting (~2091 lineas) |
| `StrategyBuilder.jsx` | `8.AnalizadorDesktop/src/components/` | Interfaz de usuario (~2062 lineas) |
| `IndicatorManager.js` | `8.AnalizadorDesktop/src/components/indicators/` | Comunicacion frontend-backend |
| `ZoneVisualizerIndicator.js` | `8.AnalizadorDesktop/src/components/indicators/` | Renderizado de trades en el chart |
| `main.py` | `4.Analizador cripto/backend/` | Endpoints API (POST SSE via fetch+ReadableStream + optimizer) |

---

## Acceso y Uso Basico

### Abrir el Strategy Builder

1. En el Analizador Desktop, buscar el boton purpura **"Strategy"** en el header del chart
2. Se abre un modal lateral con los 5 bloques configurables

### Flujo de Uso Tipico

1. **Seleccionar un simbolo y timeframe** en el chart principal
2. Abrir el Strategy Builder
3. **Configurar los 5 bloques** (o cargar un preset)
4. Ajustar **dias de historico** y **VWAP period**
5. Click en **"Run Backtest"**
6. Analizar los **resultados** (metricas + trades en el chart)
7. Iterar: ajustar parametros y volver a correr

### Conexion con el Backend

El backtest se ejecuta via **SSE (Server-Sent Events)** para mostrar progreso en tiempo real.
El frontend usa `fetch POST + ReadableStream` (NO `EventSource`) para evitar el limite de 6 conexiones de Chromium:

```
Frontend (fetch POST + ReadableStream) -----> POST /api/strategy-builder/backtest-stream
    body: { symbol, interval, days, config }        |
    signal: AbortController                    progress: 10% "Calculando VP..."
                                               progress: 50% "Vela 500/1000..."
    response.body.getReader() <-----           progress: 92% "Calculando metricas..."
    TextDecoder parsea lineas SSE              result: { trades, zones, metrics }
```

---

## Bloque 1: Level Sources

Las fuentes de niveles producen lineas de soporte y resistencia que seran usadas por la senal de entrada. Puedes activar multiples fuentes simultaneamente.

### 1.1 VP Periodic (Volume Profile Periodico)

Divide el historico en segmentos de N velas y calcula el perfil de volumen de cada segmento. Genera 3 niveles por segmento: POC, VAH y VAL.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `period` | 50-1000 | 240 | Cantidad de velas por segmento. Un period de 240 en 1min = 4 horas por segmento |
| `bins` | 20-100 | 50 | Resolucion del histograma de precio. Mas bins = mas precision pero mas ruido |
| `use_poc` | on/off | on | Incluir Point of Control (precio con mas volumen) |
| `use_vah` | on/off | on | Incluir Value Area High (borde superior del 70% del volumen) |
| `use_val` | on/off | on | Incluir Value Area Low (borde inferior del 70% del volumen) |
| `lookback_segments` | 0-10 | 1 | Cuantos segmentos futuros mantiene activos los niveles. 0=permanente, 1=solo el siguiente periodo |

**Niveles generados:**
- **POC** (strength=70): Precio mas negociado del segmento. Actua como iman
- **VAH** (strength=60, tipo resistencia): Borde superior del area de valor
- **VAL** (strength=60, tipo soporte): Borde inferior del area de valor

**Anti look-ahead:** Los niveles solo son validos DESPUES de que el segmento cierra. Si un segmento cubre velas 0-239, sus niveles son validos a partir de la vela 240.

**Cuando usarlo:** Estrategias de mean reversion (rebote al POC) o breakout (ruptura de VAH/VAL).

**Ajuste:**
- `period` bajo (50-100): Muchos segmentos cortos, niveles cambian frecuentemente. Bueno para scalping
- `period` alto (500-1000): Pocos segmentos largos, niveles mas estables. Bueno para swing
- `lookback_segments=0`: Los niveles de todos los segmentos pasados siguen activos (mas senales, mas ruido)
- `lookback_segments=1`: Solo el segmento mas reciente genera niveles activos (menos senales, mas limpias)

### 1.2 VP Zones (VP Zone Scanner)

Escanea el historico buscando zonas con perfiles de volumen tipo D, P y b. Es mas pesado computacionalmente que VP Periodic.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `detection_mode` | fixed_window / progressive | fixed_window | Metodo de deteccion |
| `window_size` | 10-100 | 30 | Tamano de ventana en velas (fixed_window) |
| `window_step` | 1-20 | 5 | Paso entre ventanas |
| `bins` | 20-100 | 50 | Resolucion del histograma |
| `va_percent` | 0.50-0.90 | 0.70 | Porcentaje del Value Area |
| `min_d_score` | 0-80 | 40 | Score minimo para perfiles tipo D |
| `include_pb_shapes` | on/off | on | Incluir perfiles P y b ademas de D |
| `max_range_pct` | 0.5-5.0 | 2.0 | Maximo rango de precio % en la zona |
| `use_poc/vah/val` | on/off | on | Que niveles incluir |

**Modos de deteccion:**
- `fixed_window`: Ventana deslizante de tamano fijo. Mas rapido y predecible
- `progressive`: Detecta zonas que crecen organicamente. Mas preciso pero mas lento

**Perfiles de volumen:**
- **D**: Distribucion normal (campana). Indica acuerdo de precio. Score alto
- **P**: Acumulacion en la parte superior. Indica presion compradora
- **b**: Acumulacion en la parte inferior. Indica presion vendedora
- **thin**: Perfil delgado sin estructura clara. Score bajo

**Cuando usarlo:** Cuando quieres niveles basados en estructura de mercado real (no solo swing points). Funciona bien combinado con VP Periodic.

**Nota:** Tiene cache en disco para no recalcular zonas identicas.

### 1.3 S&R v2 (Support & Resistance v2)

Detecta swing highs/lows y los agrupa en clusters para formar niveles de soporte y resistencia.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `swing_bars` | 2-10 | 3 | Velas a cada lado para confirmar un swing point |
| `cluster_distance_pct` | 0.1-2.0 | 0.3 | Distancia % para agrupar swings cercanos en un solo nivel |
| `min_touches` | 1-5 | 2 | Minimo de toques para que un nivel sea valido |
| `max_levels` | 3-20 | 10 | Maximo de niveles a retornar |
| `recalc_every` | 20-500 | 100 | Cada cuantas velas recalcular los niveles |

**Anti look-ahead:** Los niveles se recalculan cada `recalc_every` velas usando solo datos hasta ese punto. Cada recalculo genera niveles validos por las siguientes `recalc_every` velas.

**Ajuste:**
- `swing_bars` bajo (2): Detecta mas swings, niveles mas volatiles
- `swing_bars` alto (8-10): Solo detecta swings grandes, niveles mas estables
- `cluster_distance_pct` bajo (0.1): Niveles muy precisos, muchos niveles separados
- `cluster_distance_pct` alto (1.0-2.0): Agrupa niveles cercanos, menos niveles pero mas robustos
- `min_touches=1`: Cualquier swing es nivel (muchas senales, mucho ruido)
- `min_touches=3+`: Solo niveles testeados multiples veces (pocas senales, alta calidad)

### 1.4 VWAP Bands (VWAP + Bandas Sigma)

Usa el VWAP calculado con `vwap_period` como nivel central, mas bandas de desviacion estandar como niveles adicionales.

**No tiene parametros propios** - usa el `vwap_period` global del Strategy Builder.

**Niveles generados por cada vela:**

| Nivel | Tipo | Strength | Descripcion |
|-------|------|----------|-------------|
| `vwap` | soporte | 50 | Linea central del VWAP |
| `vwap_upper_1` | resistencia | 55 | +1 sigma |
| `vwap_upper_2` | resistencia | 60 | +2 sigma |
| `vwap_lower_1` | soporte | 55 | -1 sigma |
| `vwap_lower_2` | soporte | 60 | -2 sigma |

**Caracteristica especial:** Los niveles son **dinamicos** - cambian en cada vela. Son validos solo por 1 vela (`valid_until_idx = i+1`).

**Cuando usarlo:** Estrategias intraday donde el VWAP es importante (rebote al VWAP, ruptura de bandas sigma).

### 1.5 Swing Levels (Swing Highs/Lows como S/R)

Cada swing high se convierte en resistencia y cada swing low en soporte. A diferencia de S&R v2, NO agrupa en clusters - cada swing individual genera un nivel.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `swing_bars` | 2-15 | 5 | Velas a cada lado para confirmar el swing |

**Anti look-ahead:** Los niveles solo son validos despues de la confirmacion (`valid_from_idx = i + swing_bars`).

**Cuando usarlo:** Cuando quieres niveles de cada swing individual sin agrupamiento. Genera mas niveles que S&R v2 pero menos filtrados.

### 1.6 DTB Neckline (Double Top/Bottom Necklines)

Detecta patrones de Double Top y Double Bottom, y usa la neckline como nivel de soporte/resistencia.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `candles_per_extreme` | 3-15 | 5 | Velas para definir cada extremo del patron |
| `price_margin_pct` | 0.5-5.0 | 2.0 | Margen % para que dos extremos sean "iguales" |
| `min_candles_between` | 5-50 | 10 | Minimo de velas entre los dos picos/valles |

**Niveles generados:**
- Double Top neckline -> tipo soporte (si rompe, el precio cae)
- Double Bottom neckline -> tipo resistencia (si rompe, el precio sube)

**Dato adicional:** Tambien genera `dtb_patterns` que pueden ser usados por las senales `dtb_confirm` y filtro `dtb_bias`.

---

## Bloque 2: Entry Signals

La senal de entrada determina **cuando** abrir un trade. Solo una senal puede estar activa a la vez. La senal busca en los niveles activos (del Bloque 1) para determinar la direccion.

### 2.1 Price Touch

El precio de la vela actual toca un nivel (el low/high lo alcanza) pero cierra del lado correcto.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `tolerance_pct` | 0.05-1.0 | 0.15 | Tolerancia % alrededor del nivel para considerar "toque" |

**Logica:**
- **LONG:** `low <= nivel + tolerancia` Y `close > nivel` (toca soporte y cierra arriba)
- **SHORT:** `high >= nivel - tolerancia` Y `close < nivel` (toca resistencia y cierra abajo)

**Ajuste:**
- `tolerance_pct` bajo (0.05): Solo toques exactos al nivel. Pocas senales, alta precision
- `tolerance_pct` alto (0.5-1.0): Acepta toques lejanos. Muchas senales, menor precision

### 2.2 Swing Confirm

Un swing low/high confirmado (N velas despues del pivot) ocurre cerca de un nivel.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `swing_bars` | 2-10 | 3 | Velas a cada lado del pivot para confirmar |
| `tolerance_pct` | 0.05-1.0 | 0.3 | Distancia maxima del nivel al pivot |

**Logica:** Busca un pivot en posicion `idx - swing_bars`. Si es swing low cerca de soporte -> LONG. Si es swing high cerca de resistencia -> SHORT.

**El entry price es el close de la vela actual**, no el del pivot. Esto significa que la entrada ocurre N velas despues del swing real.

### 2.3 Breakout Close

N cierres consecutivos al otro lado de un nivel confirman un breakout.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `confirm_bars` | 1-5 (implicit) | 2 | Cierres consecutivos requeridos |
| `tolerance_pct` | 0.05-1.0 | 0.1 | No usado actualmente en la condicion |

**Logica:**
- **LONG:** N cierres consecutivos ARRIBA de una resistencia
- **SHORT:** N cierres consecutivos ABAJO de un soporte

**Ajuste:** `confirm_bars=1` es agresivo (cualquier cierre fuera). `confirm_bars=3+` es conservador (requiere confirmacion fuerte).

### 2.4 Rejection Candle

Vela con wick largo que rechaza un nivel (Hammer para soporte, Shooting Star para resistencia).

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `wick_ratio` | 0.6-5.0 | 2.0 | Ratio minimo del wick respecto al cuerpo de la vela |
| `tolerance_pct` | 0.05-1.0 | 0.3 | Distancia maxima del nivel a la mecha |

**Logica LONG:** wick inferior / rango_total >= threshold, la mecha toca soporte, cierre arriba del nivel.

### 2.5 Pattern Match

Detecta patrones clasicos de velas cerca de un nivel.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `pattern_type` | engulfing / doji / any | any | Tipo de patron a detectar |
| `tolerance_pct` | 0.1-1.0 | 0.3 | Distancia maxima al nivel |

**Patrones soportados:**
- **Hammer**: Wick inferior >= 2x cuerpo, wick superior < 0.5x cuerpo -> LONG
- **Shooting Star**: Wick superior >= 2x cuerpo, wick inferior < 0.5x cuerpo -> SHORT
- **Engulfing Bullish**: Vela anterior bajista, actual alcista con cuerpo mayor -> LONG
- **Engulfing Bearish**: Vela anterior alcista, actual bajista con cuerpo mayor -> SHORT
- **Doji**: Cuerpo < 10% del rango total -> direccion segun nivel cercano

### 2.6 Squeeze Release

TTM Squeeze pasa de activo a inactivo (la volatilidad se libera despues de compresion).

**Sin parametros** - usa los datos VWAP ya calculados.

**Direccion:** Determinada por la pendiente del VWAP en los ultimos 5 pasos:
- VWAP sube -> LONG
- VWAP baja -> SHORT

### 2.7 CVD Divergence

Divergencia entre el precio y el CVD (Cumulative Volume Delta) acumulado.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `lookback` | 10-50 | 20 | Ventana de velas para calcular el CVD |

**Logica:**
- **Divergencia alcista:** Precio hace lower low, CVD hace higher low -> LONG
- **Divergencia bajista:** Precio hace higher high, CVD hace lower high -> SHORT

### 2.8 DTB Confirm

Confirmacion de un patron Double Top/Bottom detectado previamente.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `lookback` | 10-100 | 50 | Velas atras para buscar patrones DTB |
| `min_confidence` | 30-90 | 50 | Confianza minima del patron |

**Requiere:** Que `dtb_neckline` este activado en Level Sources.

---

## Bloque 3: Context Filters

Los filtros de contexto agregan condiciones adicionales que DEBEN cumplirse para que la senal se ejecute. Usan logica **AND**: todos los filtros habilitados deben pasar.

### 3.1 VWAP Trend

Filtra por la tendencia del VWAP.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `lookback` | 5-1000 | 10 | Compara VWAP actual con VWAP hace N velas |
| `min_diff_pct` | 0-2.0 | 0 | Descarta senales cuando VWAP esta estancado (diff % < umbral). 0=desactivado |

**Logica:** VWAP subiendo = solo permite LONG. VWAP bajando = solo permite SHORT.

**Ajuste:** `lookback` alto (50-100) filtra por tendencia de largo plazo. `lookback` bajo (5-10) filtra por tendencia inmediata.

### 3.2 VWAP Position

Filtra por la posicion del precio respecto al VWAP o sus bandas.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `mode` | trend / counter | trend | `trend`=a favor, `counter`=contratendencia |
| `long_ref` | vwap / upper_1 / upper_2 / upper_3 / lower_1 / lower_2 / lower_3 | vwap | Referencia para trades LONG |
| `short_ref` | (mismas opciones) | vwap | Referencia para trades SHORT |

**Modo trend:**
- LONG: precio debe estar ARRIBA de `long_ref`
- SHORT: precio debe estar ABAJO de `short_ref`

**Modo counter:**
- LONG: precio debe estar ABAJO de `long_ref` (sobreventa)
- SHORT: precio debe estar ARRIBA de `short_ref` (sobrecompra)

**Ejemplo:** `mode=counter, long_ref=lower_2` -> Solo abre LONGs cuando el precio esta debajo de la banda -2 sigma del VWAP (zona de sobreventa extrema).

### 3.3 TTM Squeeze

Filtra por el estado del TTM Squeeze.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `require_squeeze` | on/off | on | `on`=solo entrar durante squeeze activo. `off`=solo entrar cuando NO hay squeeze |

**Cuando usarlo:**
- `require_squeeze=on`: Para estrategias de breakout (entrar durante compresion, esperar la explosion)
- `require_squeeze=off`: Para estrategias momentum (solo entrar cuando la volatilidad ya se libero)

### 3.4 BBWP Range

Filtra por el rango de BBWP (Bollinger Band Width Percentile, 0-100).

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `min_val` | 0-100 | 0 | Valor minimo de BBWP permitido |
| `max_val` | 0-100 | 50 | Valor maximo de BBWP permitido |

**BBWP:**
- 0-20: Volatilidad muy baja (compresion fuerte)
- 20-50: Volatilidad normal-baja
- 50-80: Volatilidad alta
- 80-100: Volatilidad extrema

**Ejemplo:** `min=0, max=30` -> Solo entrar durante periodos de baja volatilidad (precede a movimientos grandes).

### 3.5 Volume Z-Score

Filtra por volumen anomalo.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `min_zscore` | 0.5-4.0 | 1.5 | Z-score minimo del volumen actual |
| `lookback` | 10-50 | 20 | Velas para calcular media y desviacion estandar |

**Z-score > 1.5** significa que el volumen actual esta 1.5 desviaciones estandar por encima de la media. Indica interes inusual en el precio actual.

### 3.6 CVD Trend

CVD alineado con la direccion del trade.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `lookback` | 10-50 | 20 | Ventana de velas para calcular CVD |

**Logica:**
- LONG: CVD neto positivo en la ventana (mas compradores que vendedores)
- SHORT: CVD neto negativo (mas vendedores que compradores)

### 3.7 DTB Bias

Un patron Double Top/Bottom reciente sesga la direccion permitida.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `lookback` | 10-100 | 50 | Velas atras para buscar DTB |
| `min_confidence` | 30-90 | 50 | Confianza minima del patron |

**Logica:**
- Double Bottom reciente -> permite LONG, bloquea SHORT
- Double Top reciente -> permite SHORT, bloquea LONG
- Sin DTB relevante -> no filtra

### 3.8 Direction Filter

Filtro global de direccion.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `allowed` | both / long / short | both | Direcciones permitidas |

**Uso:** Util cuando quieres probar solo el lado LONG o SHORT de una estrategia.

### 3.9 VP Shape Filter

Filtra niveles VP por la forma del perfil de volumen.

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `allowed_shapes` | all / D / P / b / P_trimmed / b_trimmed / thin | all | Formas permitidas |

**Solo aplica a niveles VP** (source que empieza con `vp_` o `vpz_`). Los niveles de otras fuentes siempre pasan.

---

## Bloque 4: Risk Management

### Stop Loss (4 metodos)

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| **Below Level** | `buffer_pct` (0.01-1.0, default=0.1) | SL debajo/arriba del nivel que disparo la senal + buffer % |
| **Below Swing** | `buffer_pct` (0.01-1.0, default=0.1) | SL en el ultimo swing low (LONG) o swing high (SHORT) + buffer |
| **ATR Multiple** | `atr_multiplier` (0.5-5.0, default=1.5) | SL a N x ATR(14) del precio de entrada |
| **Fixed %** | `fixed_pct` (0.1-5.0, default=1.0) | SL a porcentaje fijo del precio de entrada |

**Below Level** es el mas comun para estrategias de soporte/resistencia. El buffer evita que el SL sea exactamente en el nivel (donde suele haber liquidez).

**Below Swing** busca el ultimo pivot contrario. Si la senal vino de `swing_confirm`, usa el `pivot_price` directamente. Sino, busca en las ultimas 50 velas.

### Take Profit (5 metodos)

| Metodo | Parametros | Logica |
|--------|-----------|--------|
| **R:R Fixed** | `rr` (0.5-10.0, default=2.0) | TP = entry + (risk * rr). Ejemplo: riesgo de $100 con rr=2 -> TP a +$200 |
| **Opposite Level** | `fallback_rr` (1.0-5.0, default=2.0) | TP en el nivel opuesto mas cercano. Fallback a R:R si no hay nivel o ofrece < 0.5R |
| **Next Swing** | `fallback_rr` (1.0-5.0, default=2.0) | TP en el ultimo swing contrario. Fallback a R:R si no hay swing o < 0.5R |
| **ATR Multiple** | `atr_multiplier` (1.0-10.0, default=3.0) | TP a N x ATR(14) del entry |
| **Fixed %** | `fixed_pct` (0.5-10.0, default=2.0) | TP a porcentaje fijo del entry |

### Otros Parametros de Riesgo

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `max_trades_per_segment` | 1-10 | 1 | Maximo de trades por segmento VP o fuente de nivel (misma direccion) |
| `cooldown_bars` | 0-500 | 0 | Velas de espera GLOBAL despues de abrir un trade. 0=desactivado |
| `trailing_stop` | on/off | off | Activar trailing stop (SL se mueve a favor del trade) |

**Cooldown bars:** Es GLOBAL - si abres un LONG, no puedes abrir ni LONG ni SHORT durante las siguientes N velas. Esto evita sobreoperar en zonas de mucha actividad.

**Max trades per segment:** Agrupa trades por la fuente que los genero. Para niveles VP, agrupa por segmento (`seg_start_idx`). Para otras fuentes, agrupa por `level_source`. Solo cuenta trades en la misma direccion.

---

## Bloque 5: Exit Rules

Reglas de salida adaptativa que cierran el trade ANTES de que alcance SL o TP. Usan logica **OR**: basta con que UNA regla se active.

| Regla | Parametros | Logica |
|-------|-----------|--------|
| **VWAP Reverse** | `lookback` (3-30, default=10) | Cierra si el VWAP gira en contra de la posicion (LONG: VWAP actual < VWAP hace N velas) |
| **Re-enter Zone** | ninguno | Cierra si el precio vuelve al nivel que genero la senal (LONG: cierra debajo del nivel) |
| **Squeeze Activate** | ninguno | Cierra si se activa un nuevo TTM Squeeze mientras el trade esta abierto |
| **Timeout** | `max_bars` (10-500, default=50) | Cierra despues de N velas sin alcanzar TP ni SL |

**Nota:** Si un exit rule cierra el trade, el PnL se calcula al precio de cierre de esa vela (no al SL ni TP).

---

## Sistema de Confluencia

La confluencia determina cuantas fuentes de niveles diferentes confirman un precio.

### Modos

| Modo | Descripcion |
|------|-------------|
| `any` | Cualquier nivel individual puede disparar entrada. No se calcula score |
| `score` | Se calcula un score de confluencia. La senal se descarta si score < `min_confluence_score` |

### Calculo del Score

1. Cuenta cuantos niveles activos estan dentro de `0.3%` del precio actual
2. Agrupa por fuente base (vp, sr, vwap, swing, dtb)
3. Score = `min(100, fuentes_unicas * 15)`

| Fuentes unicas cerca | Score |
|-----------------------|-------|
| 1 | 15 |
| 2 | 30 |
| 3 | 45 |
| 4 | 60 |
| 5+ | 75-100 |

**Ejemplo:** Si el precio esta cerca de un POC (vp), un nivel S&R (sr) y la banda -1 del VWAP (vwap), el score es 45 (3 fuentes * 15).

**Ajuste:** `min_confluence_score=30` requiere al menos 2 fuentes diferentes confirmando. Mas selectivo pero mas fiable.

---

## Parametros Generales

### Dias de Historico

Controla cuantos dias de datos se usan para el backtest.

| Intervalo | Max dias | Default |
|-----------|----------|---------|
| 1 min | 400 | 3 |
| 3 min | 400 | 10 |
| 5 min | 400 | 90 |
| 15 min | 180 | 30 |
| 30 min | 360 | 60 |
| 1 hora | 730 | 180 |
| 2 horas | 730 | 365 |
| 4 horas | 1095 | 730 |
| Diario | 2000 | 1000 |
| Semanal | 1000 | 500 |

**Nota:** El backend puede descargar hasta 600,000 velas por request (`max_requests=600`). Para 1 min con 400 dias = ~576,000 velas. La primera descarga puede tardar 1-2 minutos; las siguientes usan cache persistente en disco (ver seccion Cache de Velas).

### VWAP Period

| Parametro | Rango | Default | Que hace |
|-----------|-------|---------|----------|
| `vwap_period` | 5-6000 | 20 | Periodo para calcular el VWAP rolling y sus bandas sigma |

Afecta a:
- Level Source `vwap_bands` (genera niveles VWAP)
- Context Filter `vwap_trend` y `vwap_position`
- Context Filter `ttm_squeeze` y `bbwp_range`
- Exit Rule `vwap_reverse`

**Ajuste:** Un period bajo (5-20) genera un VWAP muy reactivo. Un period alto (100-500) genera un VWAP mas suave que actua como soporte/resistencia de largo plazo.

---

## Sistema de Presets

Los presets guardan **toda la configuracion** del Strategy Builder (5 bloques + parametros generales).

### Guardar Preset

1. Configurar todos los bloques como desees
2. Escribir un nombre en el campo de texto
3. Click en **"Guardar"**
4. El preset se guarda en el backend (persiste entre sesiones)

### Cargar Preset

1. Seleccionar el preset del dropdown
2. Click en **"Cargar"**
3. Todos los bloques se restauran exactamente como estaban al guardar

### Eliminar Preset

1. Seleccionar el preset del dropdown
2. Click en el boton **"X"** al lado

### Que se guarda

```
- Level Sources activos + sus parametros
- Entry Signal tipo + parametros
- Context Filters activos + sus parametros
- SL Method + parametros
- TP Method + parametros
- Max trades per segment, cooldown bars, trailing stop
- Exit Rules activos + parametros
- Confluence mode + min score
- VWAP Period
- Dias de historico
```

---

## Resultados del Backtest

Despues de ejecutar un backtest, se muestran:

### Metricas Principales

| Metrica | Descripcion |
|---------|-------------|
| **Total Trades** | Cantidad total de trades ejecutados |
| **Wins / Losses** | Trades ganadores y perdedores |
| **Win Rate** | Porcentaje de acierto (wins / total cerrados * 100) |
| **Total PnL (R)** | Ganancia/perdida total en multiplos de R |
| **Expectancy** | PnL promedio por trade cerrado (en R). Es la metrica mas importante |
| **Profit Factor** | Ganancia bruta / Perdida bruta. > 1.5 es bueno |
| **Max Drawdown (R)** | Mayor caida acumulada en R durante el backtest |

### Interpretacion

- **Expectancy > 0:** La estrategia es rentable en promedio
- **Expectancy > 0.5R:** La estrategia es robusta
- **Win Rate > 50% con RR >= 1:1:** Buena combinacion
- **Win Rate > 35% con RR >= 2:1:** Tambien viable
- **Profit Factor > 2.0:** Excelente
- **Max Drawdown < 10R:** Tolerable para la mayoria de traders

### Lista de Trades

Click en **"Ver trades"** para expandir la tabla con cada trade individual:
- Timestamp de entrada y salida
- Precio de entrada
- Direccion (LONG/SHORT)
- Resultado (WIN/LOSS/OPEN)
- PnL en R
- Velas en el trade
- Nivel y senal que lo disparo

---

## Optimizador de Parametros

El optimizador busca la mejor combinacion de parametros mediante grid search (busqueda exhaustiva).

### Flujo de Uso

1. Click en **"Optimizer"** para expandir la seccion
2. Activar los parametros a optimizar (checkbox)
3. Ajustar **Min**, **Max** y **Step** de cada parametro
4. Seleccionar la **metrica objetivo** (expectancy, total_pnl_r, win_rate, profit_factor)
5. Click en **"Estimar"**
6. Revisar la estimacion (tiempo, combinaciones)
7. Click en **"Ejecutar"**
8. Esperar resultados (puede tardar minutos)
9. Revisar tabla de **Top 15** resultados
10. Click en **"Aplicar"** en la fila deseada

### Parametros Optimizables

Se generan **dinamicamente** segun los bloques activos:

- **Level Sources activos:** Cada parametro slider del level source activo
- **Entry Signal:** Parametros de la senal activa (solo numericos)
- **SL/TP:** Parametros del metodo activo
- **VWAP Period:** Siempre disponible

**Formato de path:** `level.vp_periodic.period`, `entry.tolerance_pct`, `risk.sl_params.buffer_pct`, `risk.tp_params.rr`, `vwap_period`

### Metricas Objetivo

| Metrica | Descripcion | Cuando usarla |
|---------|-------------|---------------|
| `expectancy` | PnL promedio por trade (R) | Default. Balancea win rate y tamano de wins |
| `total_pnl_r` | PnL total acumulado (R) | Cuando quieres maximizar ganancia bruta |
| `win_rate` | % de acierto | Cuando priorizas consistencia sobre tamano de wins |
| `profit_factor` | Ganancia bruta / Perdida bruta | Buena metrica general de eficiencia |

### Limites

- **Max 5,000 combinaciones** (frontend y backend validan)
- **Max 20 valores por parametro** (se submuestrea si excede)
- **Timeout:** 60 minutos en el frontend

### Estimacion de Tiempo

La estimacion ejecuta 2 combinaciones de prueba y extrapola:

| Color | Significado |
|-------|-------------|
| Verde | < 1 minuto |
| Amarillo | 1-5 minutos |
| Rojo | > 5 minutos |

### Tabla de Resultados

Muestra los **Top 15** resultados ordenados por la metrica elegida:

| Columna | Descripcion |
|---------|-------------|
| # | Posicion en el ranking |
| WR% | Win Rate |
| PnL | Total PnL en R |
| Expect | Expectancy (PnL promedio por trade) |
| PF | Profit Factor |
| Trades | Total de trades |
| Aplicar | Boton para cargar esos parametros al modal |

---

## Visualizacion en el Chart

Los trades del backtest se renderizan directamente en el grafico como zonas coloreadas.

### Colores

| Elemento | Color |
|----------|-------|
| Zona de consolidacion (fill) | Purpura claro `rgba(128, 0, 200, 0.15)` |
| Zona de consolidacion (borde) | Purpura `rgba(128, 0, 200, 0.6)` |
| Trade WIN | Verde |
| Trade LOSS | Rojo |
| Trade OPEN | Amarillo, borde discontinuo |

### Fuentes Independientes

El chart mantiene 4 fuentes de zonas que no se interfieren:

| Fuente | Metodo | Origen |
|--------|--------|--------|
| `_manualZones` | `setZones()` | Boton "Detectar zonas" del Zone Detector |
| `_realtimeZones` | `setRealtimeZones()` | Polling del servicio realtime |
| `_vpZones` | `setVPZones()` | VP Periodic Backtest |
| `_strategyZones` | `setStrategyZones()` | Strategy Builder |

Las zonas del Strategy Builder usan `_source: 'strategy'` para identificarse y renderizarse con colores purpura.

---

## Servicio Realtime

El Strategy Builder tiene integracion con el servicio de deteccion en tiempo real. Este servicio corre en el backend y detecta senales de la estrategia configurada en cada cierre de vela.

**Nota:** El servicio realtime es una funcionalidad separada del backtest. El backtest analiza datos historicos; el servicio realtime opera en tiempo real.

---

## Diagnostico con Filter Stats

El backtest retorna `filter_stats` que muestra donde se filtraron las senales:

| Contador | Significado |
|----------|-------------|
| `signals_generated` | Total de senales detectadas (antes de filtros) |
| `filtered_direction` | Bloqueadas por filtro de direccion |
| `filtered_confluence` | Bloqueadas por score de confluencia insuficiente |
| `filtered_max_trades_seg` | Bloqueadas por max_trades_per_segment |
| `filtered_cooldown` | Bloqueadas por cooldown_bars activo |
| `filtered_context.{tipo}` | Bloqueadas por cada filtro de contexto especifico |
| `filtered_sl_invalid` | SL no se pudo calcular |
| `filtered_tp_invalid` | TP no se pudo calcular |
| `filtered_sl_direction` | SL calculado en direccion incorrecta |
| `trades_opened` | Trades que pasaron TODOS los filtros |

**Uso diagnostico:**
- Si `signals_generated` es alto pero `trades_opened` es 0, los filtros son demasiado estrictos
- Si `filtered_context.vwap_trend` es alto, considerar ajustar el lookback del VWAP trend
- Si `filtered_sl_invalid` es alto, el metodo de SL no funciona bien con esa configuracion
- Si `filtered_cooldown` es alto, reducir el cooldown_bars

---

## Guia de Ajuste de Parametros

### Estrategia de Mean Reversion (Rebote)

```
Level Sources: VP Periodic (period=240, bins=50, use_poc=on)
Entry Signal:  Price Touch (tolerance=0.15)
Filters:       VWAP Position (mode=counter, long_ref=lower_1)
               BBWP Range (min=0, max=30)
Risk:          SL=Below Level (buffer=0.15), TP=R:R Fixed (rr=2.0)
Exit Rules:    VWAP Reverse (lookback=10)
```

**Logica:** Busca toques al POC cuando el precio esta en la banda inferior del VWAP y la volatilidad es baja. Cierra si el VWAP gira.

### Estrategia de Breakout

```
Level Sources: VP Periodic (period=240, use_vah=on, use_val=on)
Entry Signal:  Breakout Close (confirm_bars=2)
Filters:       TTM Squeeze (require_squeeze=off)
               Volume Z-Score (min_zscore=1.5)
Risk:          SL=Below Level (buffer=0.2), TP=R:R Fixed (rr=2.5)
Exit Rules:    Timeout (max_bars=100)
               Squeeze Activate
```

**Logica:** Busca 2 cierres fuera del Value Area cuando el squeeze ya se libero y el volumen es alto. Cierra despues de 100 velas o si se activa nuevo squeeze.

### Estrategia de Swing con Confluencia

```
Level Sources: VP Periodic + S&R v2 + VWAP Bands (3 fuentes)
Entry Signal:  Swing Confirm (swing_bars=3)
Filters:       Direction (both)
               CVD Trend (lookback=20)
Confluence:    Mode=score, min_score=30
Risk:          SL=Below Swing (buffer=0.1), TP=Opposite Level (fallback_rr=2.0)
Exit Rules:    Re-enter Zone
```

**Logica:** Requiere confluencia de al menos 2 fuentes (score >= 30). Entra en swings confirmados con CVD alineado. TP en el nivel opuesto. Cierra si vuelve al nivel de entrada.

### Tips de Ajuste

1. **Empezar simple:** Activa 1 level source, 1 entry signal, sin filtros. Verificar que genera trades
2. **Agregar filtros uno a uno:** Cada filtro reduce trades. Verificar que los elimina correctamente
3. **Usar filter_stats:** Ver donde se pierden senales para diagnosticar
4. **Optimizar en fases:** Primero optimizar niveles (period, bins), luego entry, luego filtros
5. **Cuidado con overfitting:** Muchos filtros con datos pocos -> resultados no replicables
6. **Cooldown matters:** Un cooldown de 50-100 velas evita clusters de trades en la misma zona
7. **Max trades per segment:** Dejarlo en 1 evita que una zona mala genere multiples perdidas

---

## Troubleshooting

### "0 trades despues del backtest"

1. Verificar que al menos 1 Level Source esta activado
2. Probar sin Context Filters (pueden ser demasiado restrictivos)
3. Reducir `tolerance_pct` del entry signal
4. Aumentar dias de historico
5. Revisar `filter_stats` para ver donde se pierden senales

### "Backtest tarda mucho"

1. Primera ejecucion descarga velas de Bybit (1-2 min para 400 dias en 1min)
2. Ejecuciones siguientes usan cache persistente en disco (instantaneo)
3. VP Zones es computacionalmente pesado - considerar usar VP Periodic en su lugar
4. Reducir dias de historico para iteraciones rapidas

### "Barra de progreso no avanza"

1. Verificar que el backend esta corriendo en puerto 10001
2. Revisar consola del backend por errores Python
3. Si se modifico codigo, reiniciar el backend completamente

### "Zonas no aparecen en el chart"

1. Verificar que ZoneVisualizerIndicator esta habilitado en el chart
2. Las zonas del Strategy Builder son purpura (`_source: 'strategy'`)
3. Verificar que el backtest retorno `zones` no vacias

### "Optimizer no converge"

1. Verificar que max combinaciones < 5,000
2. Reducir el rango de parametros o aumentar el step
3. Si todos los resultados muestran 0 trades, el rango de parametros es inadecuado
4. Probar con menos parametros a la vez (2-3 max)

### "SL/TP invalidos"

- `filtered_sl_invalid` alto: El metodo de SL no puede calcular con esa config. Ej: `below_swing` sin swings en el historico
- `filtered_sl_direction` alto: El SL queda del lado equivocado (SL >= entry en LONG). Revisar buffer_pct
- `filtered_tp_invalid` alto: Sin niveles opuestos cercanos para `opposite_level`. Usar fallback_rr

---

## Cache de Velas (Persistencia en Disco)

El sistema usa un cache de 3 niveles para evitar descargar velas repetidamente:

```
┌─────────────────────────────────────────────────────────────┐
│                  JERARQUIA DE CACHE                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  1. MEMORIA (Dict Python)                                    │
│     - TTL: 2 horas                                          │
│     - Acceso: instantaneo                                   │
│     - Se pierde al reiniciar backend                        │
│                    ↓ (miss)                                  │
│  2. DISCO (candle_cache/*.json.gz)                           │
│     - TTL: indefinido (persistente)                         │
│     - Formato: JSON comprimido con gzip                     │
│     - Sobrevive reinicios del backend                       │
│     - Ubicacion: 4.Analizador cripto/backend/candle_cache/  │
│                    ↓ (miss)                                  │
│  3. BYBIT API (descarga completa)                           │
│     - Hasta 1000 velas por request                          │
│     - max_requests=600 (600,000 velas max)                  │
│     - Resultado se guarda en memoria Y disco                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### Funcionamiento

- **Primera ejecucion:** Descarga de Bybit (1-2 min para 400 dias en 1min). Guarda en memoria y disco.
- **Segunda ejecucion (< 2h):** Lee de memoria. Instantaneo.
- **Despues de reiniciar backend:** Lee de disco (gzip). ~1-2 segundos para 500K velas.
- **Carga incremental:** Si el cache tiene velas pero faltan las mas recientes, solo descarga las nuevas y las mergea.

### Archivos de Cache

```
candle_cache/
├── BTCUSDT_1.json.gz      # 576,000 velas de 1min
├── BTCUSDT_60.json.gz     # 17,520 velas de 1h
├── ETHUSDT_5.json.gz      # 115,200 velas de 5min
└── ...
```

Nombre: `{symbol}_{interval}.json.gz`

### VP Zone Cache

VP Zones tiene su propio cache en disco para no recalcular zonas identicas:

```
zones_cache/
├── BTCUSDT_5_30_5_50_0.7_40_True_2.0.json
└── ...
```

El nombre codifica todos los parametros de deteccion. Si los parametros cambian, se genera un archivo nuevo.

El panel "VP Zone Cache" en el Strategy Builder muestra:
- Archivos de cache disponibles
- Si el cache actual coincide con los parametros configurados (icono de match)
- Boton para limpiar cache

---

## Arquitectura Tecnica

### Backend: strategy_engine.py

```
run_modular_backtest(candles, config, progress_callback)
    |
    ├── compute_vp_levels()         # VP Periodic
    ├── compute_vp_zone_levels()    # VP Zones
    ├── compute_sr_levels()         # S&R v2
    ├── compute_vwap_band_levels()  # VWAP Bands
    ├── compute_swing_as_levels()   # Swing Levels
    ├── compute_dtb_levels()        # DTB Neckline
    |
    ├── Para cada vela:
    |   ├── Filtrar niveles validos en este indice
    |   ├── Evaluar entry signal -> genera senal con direccion
    |   ├── Filtrar por direction, confluence, max_trades, cooldown
    |   ├── Aplicar context filters (AND logic)
    |   ├── Calcular SL y TP
    |   └── Si todo pasa: abrir trade
    |
    ├── resolve_trade_with_exit_rules()  # Simular cada trade
    ├── calculate_metrics()              # Metricas finales
    └── Construir zonas para chart
```

### Frontend: StrategyBuilder.jsx -> IndicatorManager.js -> Backend SSE

```
StrategyBuilder.handleRunBacktest()
    |
    ├── buildConfigPayload(state)  # State -> JSON config
    |
    ├── manager.runStrategyBuilderBacktest({days, config, onProgress})
    |   |
    |   └── fetch POST /api/strategy-builder/backtest-stream (config en body JSON)
    |       → response.body.getReader() + TextDecoder (ReadableStream)
    |       ├── progress events -> setProgress({phase, percent, message})
    |       └── result event -> setResult({zones, stats, filter_stats})
    |   (NO usa EventSource - evita limite de 6 conexiones de Chromium)
    |
    └── manager.zoneVisualizerIndicator.setStrategyZones(zones)
```

---

*Documento generado para el repositorio Watchlist - Analizador Cripto*
*Ultima actualizacion: Febrero 2026*
