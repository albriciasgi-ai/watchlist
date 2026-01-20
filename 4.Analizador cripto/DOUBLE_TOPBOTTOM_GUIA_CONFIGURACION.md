# Double Top/Bottom - Guía de Configuración

**Versión:** 1.0.1
**Fecha:** 2025-12-25

---

## 🆕 v1.0.1 - Volume Divergence Support

Esta versión añade soporte para detectar **divergencia de volumen**, una señal clásica de reversión donde:
- El **primer extremo** tiene volumen ALTO (movimiento inicial fuerte)
- El **segundo extremo** tiene volumen BAJO (debilitamiento)

Ahora puedes configurar z-scores separados para cada extremo en el **High-Volume Extreme Filter**.

---

## 📖 Índice

1. [Acceso al Configurador](#acceso-al-configurador)
2. [Tab 1: Double Top/Bottom Detection](#tab-1-double-topbottom-detection)
3. [Tab 2: Volume Filtering](#tab-2-volume-filtering)
4. [Tab 3: Momentum Confirmation](#tab-3-momentum-confirmation)
5. [Tab 4: Filters](#tab-4-filters)
6. [Tab 5: Visualization](#tab-5-visualization)
7. [Presets Recomendados](#presets-recomendados)
8. [Troubleshooting](#troubleshooting)

---

## 🔧 Acceso al Configurador

1. Abre la watchlist en tu navegador
2. Busca el símbolo que quieres configurar (ej: BTCUSDT)
3. Click en el botón **"DBT"** (Double Top/Bottom) en la esquina del gráfico
4. Se abrirá el modal de configuración con 5 tabs

---

## Tab 1: Double Top/Bottom Detection

### 🎯 Parámetros de Detección Básica

#### **Lookback Candles** (10-200)
- **Qué hace:** Define cuántas velas analizar hacia atrás
- **Default:** 100
- **Nota:** En realidad usa TODO el histórico disponible, este parámetro es legacy
- **Recomendación:** Dejar en 100

#### **Candles Per Extreme** (1-30)
- **Qué hace:** Tamaño de la ventana para detectar highs/lows locales
- **Default:** 3
- **Valores bajos (1-3):** Detecta más extremos (más sensible)
- **Valores altos (10-30):** Solo extremos muy significativos (menos sensible)
- **Recomendación:**
  - Timeframes cortos (1m, 5m): 3-5
  - Timeframes medios (15m, 1h): 3-7
  - Timeframes largos (4h, D): 5-10

#### **Price Margin Percent** (0.1-10.0%)
- **Qué hace:** Tolerancia de diferencia de precio entre los dos picos
- **Default:** 5.0%
- **Valores bajos (0.5-2%):** Solo patrones muy precisos
- **Valores altos (5-10%):** Acepta más variación
- **Recomendación:**
  - Criptos volátiles: 3-5%
  - Criptos estables: 1-2%

#### **Min Candles Between** (1-50)
- **Qué hace:** Mínimo de velas entre los dos extremos
- **Default:** 3
- **Recomendación:** Mínimo 3 para evitar ruido

#### **Max Candles Between** (10-200)
- **Qué hace:** Máximo de velas entre los dos extremos
- **Default:** 80
- **Recomendación:**
  - Timeframe 1h: 50-80
  - Timeframe 4h: 20-40
  - Timeframe D: 10-30

### ✅ Rejection Patterns

Checkboxes para habilitar/deshabilitar patrones:

- **☑ Hammer:** Pin bar alcista (rechazo en bottom)
- **☑ Shooting Star:** Pin bar bajista (rechazo en top)
- **☑ Bullish Engulfing:** Vela alcista envuelve bajista anterior
- **☑ Bearish Engulfing:** Vela bajista envuelve alcista anterior

**Recomendación:** Dejar todos habilitados

---

## Tab 2: Volume Filtering

### 📊 Volume Filter (para scoring)

#### **☐ Enable Volume Filter**
- **Qué hace:** Agrega puntos de confianza si el volumen fue alto
- **Impacto:** +0-15 puntos de confidence
- **Cuándo usar:** Cuando quieres priorizar patrones con alto volumen
- **Default:** OFF

#### **Z-Score Threshold** (1.0-3.0)
- **Solo si Volume Filter está ON**
- **Qué hace:** Define qué tan alto debe ser el volumen
- **Default:** 1.5
- **Valores:**
  - 1.0-1.5: Volumen moderadamente alto
  - 1.5-2.0: Volumen alto
  - 2.0-3.0: Volumen muy alto (volume spikes)

#### **Z-Score Period** (10-100)
- **Solo si Volume Filter está ON**
- **Qué hace:** Ventana para calcular el z-score
- **Default:** 20
- **Recomendación:** 20-50 velas

---

### 🎯 High-Volume Extreme Filter (para filtrar)

⚠️ **IMPORTANTE:** Este filtro RECHAZA extremos con volumen bajo

#### **☐ Require High Volume at Extremes**
- **Qué hace:** Solo acepta highs/lows con volumen significativo
- **Impacto:** Menos patrones pero más confiables (big players involved)
- **Cuándo usar:**
  - Trading de alta probabilidad
  - Cuando solo quieres señales con institucionales
  - Para reducir falsos positivos
  - Para detectar divergencia de volumen (señal de reversión)
- **Default:** OFF

#### **Z-Score Threshold (First Extreme) 🔥** (0.5-3.0)
- **Solo si Require High Volume está ON**
- **Qué hace:** Mínimo z-score del volumen en el PRIMER extremo
- **Default:** 1.5
- **Valores recomendados:**
  - 1.0-1.5: Volumen alto (movimiento inicial fuerte)
  - 1.5-2.0: Volumen muy alto
  - 2.0-3.0: Solo volume spikes (institucionales)
- **Nota:** El primer extremo usualmente tiene mayor volumen (movimiento inicial fuerte)

#### **Z-Score Threshold (Second Extreme) 📉** (0.0-3.0)
- **Solo si Require High Volume está ON**
- **Qué hace:** Mínimo z-score del volumen en el SEGUNDO extremo
- **Default:** 0.5
- **Valores recomendados:**
  - 0.0-0.5: Permisivo (permite volumen bajo = divergencia)
  - 0.5-1.0: Moderado
  - 1.0-1.5: Estricto (ambos extremos con alto volumen)
  - 1.5-3.0: Muy estricto (poco común)
- **Nota:** El segundo extremo usualmente tiene menor volumen (debilitamiento/divergencia)

💡 **Volume Divergence:**
- Si `zScoreThresholdFirst` > `zScoreThresholdSecond`, detectarás patrones donde el volumen DISMINUYE en el segundo extremo
- Esta divergencia de volumen es una señal clásica de reversión en análisis técnico
- Ejemplo: First = 2.0, Second = 0.5 → Solo patrones con divergencia bajista de volumen

#### **Z-Score Period** (10-100)
- **Solo si Require High Volume está ON**
- **Default:** 20

### 🤔 ¿Cuál usar: Volume Filter o High-Volume Extreme Filter?

| Situación | Volume Filter | High-Volume Extreme Filter |
|-----------|---------------|----------------------------|
| Quiero más señales y rankearlas | ✅ ON | ❌ OFF |
| Quiero solo las mejores señales | ❌ OFF | ✅ ON |
| Quiero combinar ambos | ✅ ON (threshold alto) | ✅ ON (threshold bajo) |
| No me importa el volumen | ❌ OFF | ❌ OFF |

---

## Tab 3: Momentum Confirmation

**Estado:** Phase 2 - Opcional

#### **☐ Enable Momentum Confirmation**
- **Qué hace:** Busca patrones de momentum después del patrón para confirmar entrada
- **Default:** OFF
- **Nota:** Experimental, no es necesario para detección básica

Si está ON:
- Busca Marubozu, Three Soldiers/Crows, Big Body
- Genera señales de ENTRY (flechas verdes/rojas)

**Recomendación:** Dejar OFF por ahora

---

## Tab 4: Filters

### ⚙️ Filtros Básicos

#### **Min Confidence** (0-100)
- **Qué hace:** Mínimo score de confianza para mostrar el patrón
- **Default:** 20 (muy permisivo)
- **Valores recomendados:**
  - 10-30: Ver todas las posibilidades
  - 30-50: Solo patrones decentes
  - 50-70: Solo patrones buenos
  - 70-100: Solo patrones excelentes

#### **☐ Require Rejection at Both Extremes**
- **Qué hace:** Exige patrón de rechazo en AMBOS picos/valles
- **Default:** OFF (recomendado)
- **Si ON:** Muy pocos patrones detectados
- **Recomendación:** Dejar OFF

#### **Min Pattern Duration** (0-48 hours)
- **Qué hace:** Duración mínima del patrón
- **Default:** 1 hora
- **Recomendación:** 1-3 horas

#### **Max Pattern Duration** (24-336 hours)
- **Qué hace:** Duración máxima del patrón
- **Default:** 168 horas (7 días)
- **Recomendación:** Ajustar según timeframe

---

### 🔍 Post-Pattern Validation

#### **☐ Apply to Real-Time Signals**
- **Qué hace:** Decide si aplicar validación al patrón más reciente
- **Default:** OFF (recomendado para trading)

**⚠️ IMPORTANTE:**

**Si OFF (Modo Real-Time - Recomendado):**
- Patrón más reciente aparece INMEDIATAMENTE
- Patrones históricos SÍ se validan
- Ideal para trading en vivo

**Si ON (Modo Backtesting):**
- TODOS los patrones deben confirmar movimiento antes de aparecer
- Puede perder oportunidades de entrada
- Ideal para análisis histórico

#### **Validation Candles** (3-10)
- **Qué hace:** Cuántas velas verificar después del patrón
- **Default:** 5
- **Recomendación:** 3-7 velas

#### **Min Post-Pattern Move (%)** (0.1-5.0%)
- **Qué hace:** Movimiento mínimo requerido para confirmar
- **Default:** 0.5%
- **Valores:**
  - 0.1-0.5%: Permisivo
  - 0.5-1.5%: Moderado
  - 1.5-5.0%: Estricto

#### **Confidence Bonus** (0-50)
- **Qué hace:** Puntos adicionales si confirma movimiento
- **Default:** 20
- **Recomendación:** 15-25

---

### 🗂️ Duplicate Filtering

**Elimina patrones redundantes en la misma zona**

#### **Price Tolerance (%)** (0.5-10.0%)
- **Qué hace:** Tolerancia de precio para considerar duplicados
- **Default:** 2.0%
- **Valores bajos (0.5-1%):** Solo elimina casi idénticos
- **Valores altos (5-10%):** Elimina en zona amplia

#### **Time Tolerance (hours)** (6-72)
- **Qué hace:** Tolerancia de tiempo para considerar duplicados
- **Default:** 24 horas
- **Recomendación:** 12-48 horas según timeframe

---

## Tab 5: Visualization

### 🎨 Opciones de Visualización

#### **☑ Show Level Lines**
- Muestra líneas horizontales en el nivel del patrón

#### **☑ Show Rejection Icons**
- Muestra emojis en los extremos (🔨 ⭐ 📈 📉)

#### **☑ Show Momentum Icons**
- Muestra emojis de momentum (🚀 🔥 💥)
- Solo si Momentum Confirmation está ON

#### **☑ Show Entry Arrows**
- Muestra flechas de entrada (▲ ▼)
- Solo si Momentum Confirmation está ON

### 🎨 Colores

Configura los colores de:
- Línea Double Top (default: #FF5722 - Rojo)
- Línea Double Bottom (default: #4CAF50 - Verde)
- Icono de rechazo (default: #FFC107 - Amarillo)
- Entrada Long (default: #00E676 - Verde brillante)
- Entrada Short (default: #FF1744 - Rojo brillante)

### 📏 Estilo de Línea

- **Width:** Grosor de la línea (default: 2)
- **Dash:** Patrón de línea discontinua [10, 5]

---

## 🎯 Presets Recomendados

### Preset 1: "Conservador" (Alta Confianza)
```
Double Top/Bottom Detection:
✓ candlesPerExtreme: 5
✓ priceMarginPercent: 2.0
✓ minCandlesBetween: 5
✓ maxCandlesBetween: 50

Volume Filtering:
✓ Volume Filter: ON
✓ zScoreThreshold: 2.0
✓ High-Volume Extremes: ON
✓ zScoreThresholdFirst: 2.0  (volumen alto en primer extremo)
✓ zScoreThresholdSecond: 1.5 (volumen alto también en segundo)

Filters:
✓ minConfidence: 60
✓ requireBothRejections: true
✓ postPatternValidationCandles: 7
✓ minPostPatternMovePercent: 1.0

Resultado: Pocas señales, muy confiables
```

### Preset 2: "Moderado" (Balanceado)
```
Double Top/Bottom Detection:
✓ candlesPerExtreme: 3
✓ priceMarginPercent: 3.0
✓ minCandlesBetween: 3
✓ maxCandlesBetween: 80

Volume Filtering:
✓ Volume Filter: OFF
✓ High-Volume Extremes: OFF

Filters:
✓ minConfidence: 40
✓ requireBothRejections: false
✓ postPatternValidationCandles: 5
✓ minPostPatternMovePercent: 0.5

Resultado: Balance entre cantidad y calidad
```

### Preset 3: "Agresivo" (Máximas Señales)
```
Double Top/Bottom Detection:
✓ candlesPerExtreme: 3
✓ priceMarginPercent: 5.0
✓ minCandlesBetween: 3
✓ maxCandlesBetween: 100

Volume Filtering:
✓ Volume Filter: OFF
✓ High-Volume Extremes: OFF

Filters:
✓ minConfidence: 20
✓ requireBothRejections: false
✓ applyPostValidationToRealtimeSignals: false

Resultado: Muchas señales, filtrar manualmente
```

### Preset 4: "Big Players Only" (Solo Institucionales)
```
Double Top/Bottom Detection:
✓ candlesPerExtreme: 5
✓ priceMarginPercent: 2.5

Volume Filtering:
✓ Volume Filter: ON
✓ zScoreThreshold: 2.0
✓ High-Volume Extremes: ON
✓ zScoreThresholdFirst: 2.5   (volumen MUY alto en primer extremo)
✓ zScoreThresholdSecond: 2.0  (volumen alto en segundo extremo)

Filters:
✓ minConfidence: 50

Resultado: Solo patrones con alta participación institucional
```

### Preset 5: "Volume Divergence" (Divergencia de Volumen) 🆕
```
Double Top/Bottom Detection:
✓ candlesPerExtreme: 4
✓ priceMarginPercent: 3.0
✓ minCandlesBetween: 5
✓ maxCandlesBetween: 60

Volume Filtering:
✓ Volume Filter: OFF
✓ High-Volume Extremes: ON
✓ zScoreThresholdFirst: 2.0   (primer extremo con volumen MUY alto)
✓ zScoreThresholdSecond: 0.5  (segundo extremo permite volumen bajo)

Filters:
✓ minConfidence: 45
✓ requireBothRejections: false
✓ postPatternValidationCandles: 5
✓ minPostPatternMovePercent: 0.8

Resultado: Detecta reversiones con divergencia de volumen clásica
Interpretación: El precio alcanza el mismo nivel pero con MENOS fuerza
```

---

## 🔧 Troubleshooting

### Problema: No detecta ningún patrón

**Posibles causas:**
1. ✓ minConfidence demasiado alto → Bajar a 20
2. ✓ requireBothRejections = ON → Poner OFF
3. ✓ priceMarginPercent demasiado bajo → Subir a 5%
4. ✓ High-Volume Extremes demasiado estricto → Bajar threshold o deshabilitar

### Problema: Detecta demasiados patrones

**Soluciones:**
1. ✓ Subir minConfidence a 40-60
2. ✓ Habilitar High-Volume Extreme Filter con threshold 1.5
3. ✓ Reducir priceMarginPercent a 2-3%
4. ✓ Aumentar candlesPerExtreme a 5-7

### Problema: Patrones duplicados

**Solución:**
1. ✓ Verificar Duplicate Filtering está funcionando
2. ✓ Aumentar duplicatePriceTolerancePercent
3. ✓ Aumentar duplicateTimeToleranceHours

### Problema: Modal se crashea al abrir tab Filters

**Solución:**
1. ✓ Limpiar localStorage del navegador
2. ✓ Recargar la página
3. ✓ Click en "Reset to Defaults" en el modal

### Problema: Señales muy tardías

**Solución:**
1. ✓ Verificar applyPostValidationToRealtimeSignals = OFF
2. ✓ Reducir postPatternValidationCandles
3. ✓ Reducir minPostPatternMovePercent

---

## 💡 Tips y Mejores Prácticas

### 1. Empieza Permisivo
- Configura todo en valores permisivos
- Observa qué detecta
- Ajusta gradualmente hacia más estricto

### 2. Ajusta por Timeframe
- Timeframes cortos (1m, 5m): Parámetros más estrictos
- Timeframes largos (4h, D): Puedes ser más permisivo

### 3. Combina con Otros Indicadores
- No uses Double Top/Bottom aislado
- Combina con:
  - Volume Profile
  - RSI
  - MACD
  - Support/Resistance

### 4. Usa "Reset to Defaults"
- Si perdiste el rumbo, resetea todo
- Los defaults están bien calibrados

### 5. Guarda Configuraciones por Símbolo
- Cada símbolo tiene su propia configuración
- BTCUSDT puede necesitar settings diferentes a ETHUSDT

### 6. Modo Real-Time para Trading
- **SIEMPRE** deja applyPostValidationToRealtimeSignals = OFF
- Necesitas señales inmediatas para entrar a tiempo

### 7. Revisa el Histórico
- Mira los patrones detectados en el pasado
- Verifica si coinciden con movimientos reales
- Ajusta según resultados históricos

---

## 📞 Soporte

Si necesitas ayuda adicional:
1. Revisa `DOUBLE_TOPBOTTOM_RESUMEN_EJECUTIVO.md`
2. Revisa `DOUBLE_TOPBOTTOM_DOCUMENTACION_TECNICA.md`
3. Revisa `DOUBLE_TOPBOTTOM_CHANGELOG.md`

---

**Última actualización:** 2025-12-25
**Versión:** 1.0.1
