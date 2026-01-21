# CONTINUATION PATTERN INDICATOR - Guía Completa del Usuario

## TABLA DE CONTENIDOS
1. [Introducción](#1-introducción)
2. [Conceptos Fundamentales](#2-conceptos-fundamentales)
3. [Configuración Básica (Quick Start)](#3-configuración-básica-quick-start)
4. [Configuración Avanzada](#4-configuración-avanzada)
5. [Guía de Patrones](#5-guía-de-patrones)
6. [Tweaks por Timeframe](#6-tweaks-por-timeframe)
7. [Casos de Uso Prácticos](#7-casos-de-uso-prácticos)
8. [Troubleshooting](#8-troubleshooting)
9. [FAQ](#9-faq)
10. [Cheat Sheets](#10-cheat-sheets)

---

## 1. INTRODUCCIÓN

### ¿Qué es este indicador?

Este indicador detecta patrones de velas que señalan **CONTINUACIÓN de tendencia** o inicio de **MOMENTUM**, a diferencia de los patrones de rechazo que señalan reversiones.

### ¿Por qué es diferente?

- **Contextual**: El mismo patrón (ej. Hammer) se interpreta diferente según DÓNDE aparece
- **Sin lag**: Usa VWAP y estructura de mercado directa (no Moving Averages)
- **Adaptable**: Tú decides qué niveles usar (S/R, VWAP, Fibonacci, etc.)
- **Transparente**: Ves exactamente cómo se calcula el confidence score

### Tipos de señales que detecta:

1. **CONTINUACIÓN**: Patrones que confirman que la tendencia actual continuará
2. **INICIO DE TENDENCIA**: Breakouts de rango, comienzo de nueva tendencia
3. **MOMENTUM**: Velas fuertes consecutivas, movimiento explosivo
4. **REVERSIÓN CONTEXTUAL**: Patrones clásicos reclasificados según contexto

---

## 2. CONCEPTOS FUNDAMENTALES

### 2.1 Reversión vs Continuación

**MISMO PATRÓN, DIFERENTE CONTEXTO:**

```
HAMMER en EXTREMO de tendencia bajista:
│
│ Downtrend largo
│     ↓
│     ↓
│   [HAMMER] ← En soporte = REVERSIÓN ALCISTA ●
│     ↑
│     ↑

HAMMER en MEDIO de tendencia alcista:
│
│ Uptrend fuerte
│     ↑
│ [Pullback normal]
│     ↓
│   [HAMMER] ← En VWAP/MA = CONTINUACIÓN ALCISTA ◐
│     ↑
│     ↑ Retoma subida
```

**Clave**: El contexto (dónde aparece) determina el significado del patrón.

### 2.2 Estructura de Mercado

**UPTREND (Tendencia Alcista):**
```
Price
  ^
  |      HH (Higher High)
  |       /\
  |      /  \    HH
  |     /    \  /\
  |    /  HL   \/  \
  |   /  (Higher  \
  |  /    Low)     \
  | /               \
  |/________________\___> Time
    HL          HL
```
- Higher Highs (HH): Cada máximo es más alto que el anterior
- Higher Lows (HL): Cada mínimo es más alto que el anterior
- Trend Strength > 50

**DOWNTREND (Tendencia Bajista):**
```
Price
  ^
  |     LH (Lower High)
  |\      /\
  | \    /  \  LH
  |  \  /    \/\
  |   \/  LL   \
  |   (Lower    \
  |    Low)      \
  |_______________\___> Time
        LL    LL
```
- Lower Highs (LH): Cada máximo es más bajo que el anterior
- Lower Lows (LL): Cada mínimo es más bajo que el anterior
- Trend Strength > 50

**RANGE (Rango/Consolidación):**
```
Price
  ^
  |  ━━━━━━━━━━━━━━━━   ← Resistencia
  |   /\  /\    /\  /
  |  /  \/  \  /  \/
  |       \/  \/
  |  ━━━━━━━━━━━━━━━━   ← Soporte
  |___________________> Time
```
- Swings inconsistentes
- Precio oscila entre niveles horizontales
- Trend Strength < 30

### 2.3 Inside Bar (Patrón Clave)

**Anatomía:**
```
Mother Candle    Inside Bar
(Vela grande)    (Vela pequeña completamente dentro)

High ────┐
         │
  ┌──────┤
  │      ├──┐  ← Inside bar
  │      │  │
  │      └──┤
  │         │
Low ───────┘

Condiciones:
- Inside Bar High < Mother High
- Inside Bar Low > Mother Low
```

**Significado:**
- **Consolidación temporal**: El mercado "toma aire"
- **Volatilidad baja**: Precede expansión explosiva
- **En tendencia** = Continuación (52% efectividad)
- **En extremo** = Reversión (65-70% efectividad)

**Por qué funciona:**
1. Representa indecisión temporal o pausa
2. Traders están esperando dirección clara
3. Breakout del rango marca la decisión del mercado
4. En tendencias fuertes, usualmente rompe a favor de la tendencia

### 2.4 False Breakout (Trampa)

**Secuencia:**
```
1. Inside Bar se forma
2. Rompe en dirección CONTRARIA a la tendencia (trampa)
3. Revierte rápidamente en dirección DE la tendencia
4. Explosión en dirección original

Ejemplo en Uptrend:

  ↑  Tendencia alcista
  │
  │  ┌─┐ Inside bar
  │  └─┘
  │     ↓ Rompe abajo (TRAMPA para vendedores)
  │   ┌──┐
  │   └──┘
  │       ↑↑ Revierte y explota arriba → CONTINUACIÓN FUERTE
  │      ↗
```

**Interpretación:**
- Los vendedores (o compradores) intentan empujar el precio
- **Fracasan** (false breakout)
- Los compradores (o vendedores) retoman control con **FUERZA**
- Alta probabilidad de continuación explosiva (75% efectividad)

### 2.5 Momentum Pattern (Velas Fuertes)

**Definición:** 3+ velas fuertes consecutivas en la misma dirección

**Características:**
```
│███│ Cuerpo grande (> 60% del rango)
│███│ Sin mechas (o muy pequeñas < 30%)
│███│ Cierre cerca del extremo
│███│ 3+ velas consecutivas del mismo color
│███│ Volumen elevado (opcional pero recomendado)
│███│
 ▲▲▲  Ángulo pronunciado
```

**Señala:**
- Fuerza institucional entrando
- Momentum fuerte en una dirección
- Alta probabilidad de continuación
- Entrada agresiva de compradores/vendedores

**Variante con volumen:**
- Si volumen > 2× promedio, solo necesita 2 velas (configurable)
- Compensación de volumen: menos velas si hay volumen explosivo

### 2.6 VWAP (Volume Weighted Average Price)

**¿Qué es?**
VWAP = Σ(Precio Típico × Volumen) / Σ(Volumen)

Donde:
- Precio Típico = (High + Low + Close) / 3
- Σ = Suma acumulada desde inicio de sesión (o anchor point)

**Por qué es mejor que Moving Averages:**
1. **Integra volumen**: Refleja dónde REALMENTE se negoció
2. **Sin lag**: Cálculo en tiempo real, no promedio de precios históricos
3. **Institucional**: Grandes traders usan VWAP como benchmark
4. **Fair value**: Muestra el precio "justo" promedio de la sesión

**Interpretación:**
- Precio > VWAP = Mercado alcista (compradores pagando premium)
- Precio < VWAP = Mercado bajista (vendedores aceptando descuento)
- VWAP actúa como soporte/resistencia dinámica

**Bandas de Desviación Estándar:**
```
+3σ ━━━━━━━━━━━━━━  Muy sobr expandido (reversión probable)
+2σ ━━━━━━━━━━━━━━  Sobrecomprado
+1σ ━━━━━━━━━━━━━━  Resistencia leve
VWAP ━━━━━━━━━━━━━  Fair value
-1σ ━━━━━━━━━━━━━━  Soporte leve
-2σ ━━━━━━━━━━━━━━  Sobrevendido
-3σ ━━━━━━━━━━━━━━  Muy sobrevendido (rebote probable)
```

**Tipos de VWAP:**
- **Session VWAP**: Reset diario (midnight UTC), mejor para intraday
- **Anchored VWAP**: Desde evento específico (weekly, monthly), mejor para swing
- **Rolling VWAP**: Ventana fija (ej. 21 días), mejor para crypto 24/7

### 2.7 Sistema de Niveles Configurables

**Fuentes disponibles** (todas opcionales):

1. **Support & Resistance**: Niveles horizontales detectados por volumen
2. **Volume Profile**: POC, VAH, VAL (dinámico + fixed ranges)
3. **VWAP**: VWAP + bandas de desviación estándar
4. **Fibonacci**: Retracements + Extensions (auto o manual)
5. **Manual Levels**: Líneas horizontales dibujadas por usuario

**Confluencia:**
Cuando un patrón aparece cerca de múltiples niveles, su confidence aumenta significativamente.

Ejemplo:
```
Pattern at $42,150:
- S/R: $42,080 (distance 0.17%) → Score: 90
- VWAP: $42,100 (distance 0.12%) → Score: 95
- Fibonacci 50%: $42,145 (distance 0.01%) → Score: 100
→ Alta confluencia → Confidence: 88
```

---

## 3. CONFIGURACIÓN BÁSICA (QUICK START)

### 3.1 Setup Inicial (5 minutos)

**PASO 1: Habilitar el indicador**
```
1. Ir a Watchlist → Settings → Indicators
2. Buscar "Continuation Patterns"
3. Toggle ON
```

**PASO 2: Configuración mínima recomendada**
```
Level Sources (Qué niveles usar):
☑ Support & Resistance (RECOMENDADO)
☑ Volume Profile (RECOMENDADO)
☐ VWAP (Opcional - para traders avanzados)
☐ Fibonacci (Opcional - para swing traders)
☑ Manual Levels (Si dibujas líneas manualmente)

Patterns (Qué patrones detectar):
☑ Inside Bar (CLAVE para continuación)
☑ Momentum (Para detectar movimientos fuertes)
☑ Hammer (Con reclassify by context ON)
☑ Engulfing (Con reclassify by context ON)
☐ False Breakout (Más avanzado, habilitar después)

Filters (Filtros de calidad):
Min Confidence: 60 (Balance entre señales y calidad)
☑ Require Trend for Continuation (Recomendado)
```

**PASO 3: Aplicar y probar**
```
1. Click "Apply Settings"
2. Verás puntos/iconos en el gráfico
3. Hover sobre un punto para ver detalles
4. Diferentes colores = diferentes tipos
```

### 3.2 Interpretación Básica

**COLORES:**
- 🟢 **Verde**: Continuación alcista
- 🔴 **Rojo**: Continuación bajista
- 🟡 **Amarillo**: Inicio de tendencia (breakout)
- 🔥 **Naranja/Rojo intenso**: Momentum explosivo

**ICONOS:**
- **● Círculo lleno**: Reversión (patrones clásicos en extremos)
- **◐ Medio lleno**: Continuación (patrones en medio de tendencia)
- **★ Estrella**: Inicio de tendencia (breakout de rango)
- **▶▶▶ Triple flecha**: Momentum (velas fuertes consecutivas)

**CONFIDENCE (Confianza):**
- **0-50**: Baja - Ignorar
- **50-65**: Media - Precaución, combinar con otros factores
- **65-75**: Alta - Buena señal
- **75-85**: Muy alta - Excelente señal
- **85-100**: Excepcional - Máxima confluencia

**TOOLTIP (Al pasar el mouse):**
```
Inside Bar
Classification: CONTINUATION
Direction: BULLISH
Confidence: 78%
Trend Strength: 65
Near Levels:
  - S/R @ $42,080 (0.17%)
  - VWAP @ $42,100 (0.12%)
Entry: $42,160
Stop: $42,050
Target: $42,400
R:R: 1:2.2
```

### 3.3 Primer Trade Example

**Escenario:** BTC en 15m, uptrend confirmado

1. **Detección**: Inside bar verde aparece con ◐ (continuación)
2. **Verificación**:
   - Confidence: 72% ✓
   - Cerca de VWAP ✓
   - Trend Strength: 68 (uptrend fuerte) ✓
3. **Entry**: Breakout del inside bar al alza
4. **Stop**: Debajo del low del inside bar
5. **Target**: Próxima resistencia (del S/R indicator)
6. **Resultado**: Trade ganador R:R 1:2.5

---

## 4. CONFIGURACIÓN AVANZADA

### 4.1 Ajustar Sensibilidad por Timeframe

**1-Minute (Scalping):**
```yaml
Inside Bar:
  minMotherCandleSize: 0.3  # Más permisivo
  minConsecutiveCandles: 2  # Aceptar menos velas

Momentum:
  minConsecutiveCandles: 2
  requireVolumeConfirmation: true  # CRÍTICO en 1m
  minVolumeMultiplier: 1.5

Filters:
  minConfidence: 55  # Más señales, menos restrictivo
```

**5-15 Minute (Day Trading):**
```yaml
Inside Bar:
  minMotherCandleSize: 0.5  # Estándar
  minConsecutiveCandles: 1

Momentum:
  minConsecutiveCandles: 3
  requireVolumeConfirmation: true
  volumeCompensation.enabled: true  # 2 velas con volumen alto = válido

Filters:
  minConfidence: 65  # Balance calidad/cantidad
```

**1-4 Hour (Swing Trading):**
```yaml
Inside Bar:
  minMotherCandleSize: 0.7  # Más restrictivo
  minConsecutiveCandles: 2

Momentum:
  minConsecutiveCandles: 4
  minBodyRatio: 0.7  # Velas más fuertes
  requireVolumeConfirmation: true

Filters:
  minConfidence: 70  # Alta calidad
```

**Daily (Position Trading):**
```yaml
Inside Bar:
  minMotherCandleSize: 1.0
  # Usar anchored VWAP (weekly/monthly)

Momentum:
  minConsecutiveCandles: 5
  minBodyRatio: 0.75

Filters:
  minConfidence: 75
  # Activar Fibonacci para swings largos
```

### 4.2 Optimizar por Par

**BTC/ETH (Alta Liquidez):**
```
Level Sources:
☑ Todas las fuentes activas
  - S/R: Muy confiable
  - Volume Profile: Excelente
  - VWAP: Muy efectivo (alta liquidez)
  - Fibonacci: Funciona bien

Confidence: 65-70 (estándar)
```

**Altcoins Mid-Cap ($100M-$1B):**
```
Level Sources:
☑ S/R (prioridad)
☑ Volume Profile
☐ VWAP (menos confiable, menor liquidez)
☑ Fibonacci

Filters:
  minConfidence: 75  # Más restrictivo
```

**Altcoins Low-Cap (< $100M):**
```
Level Sources:
☑ S/R Manual (solo niveles importantes)
☑ Volume Profile Fixed Ranges
☐ VWAP (DESACTIVAR - no confiable)
☐ Fibonacci (DESACTIVAR - swings erráticos)
☑ Manual Levels (dibujar manualmente)

Filters:
  minConfidence: 80+  # MUY restrictivo
  requireVolumeConfirmation: true
```

### 4.3 Configuración de VWAP (Avanzado)

**Session VWAP (Intraday Trading):**
```yaml
anchorType: 'session'  # Reset diario a midnight UTC
showBands: true
stdDevMultipliers: [1, 2, 3]
cryptoAdjustment: 1.15  # Bandas más anchas para crypto
proximityThreshold: 0.5%  # Muy cerca = confluencia

Uso: 1m-4h timeframes
```

**Anchored VWAP (Swing Trading):**
```yaml
anchorType: 'weekly'  # O 'monthly'
showBands: true
stdDevMultipliers: [1, 2]  # Solo 1σ y 2σ
proximityThreshold: 1.0%  # Más permisivo

Uso: 4h-Daily timeframes
```

**VWAP Bands como Targets:**
- Compra cerca de VWAP → Target: +1σ o +2σ
- Venta cerca de VWAP → Target: -1σ o -2σ
- Reversión desde 3σ → Target: VWAP

### 4.4 Configuración de Fibonacci (Opcional)

**Auto-Detect (Recomendado):**
```yaml
autoDetectSwing: true
swingLookback: 100  # Buscar swing en últimas 100 velas
levels:
  retracement: [0.382, 0.5, 0.618]  # Niveles clave
  extension: []  # Desactivar extensions
proximityThreshold: 0.3%

Funciona bien en:
- Uptrends claros
- Downtrends claros

NO funciona en:
- Rangos
- Mercados choppy
```

**Manual Swing (Más preciso):**
```yaml
autoDetectSwing: false
manualSwingHigh: 43500  # Especificar manualmente
manualSwingLow: 40200
levels:
  retracement: [0.236, 0.382, 0.5, 0.618, 0.786]
  extension: [1.272, 1.618]  # Para targets agresivos
```

---

## 5. GUÍA DE PATRONES

### 5.1 Inside Bar

**Cuándo aparece:**
- Después de movimiento fuerte (impulso)
- Consolidación antes de continuar
- Pausa para tomar liquidez
- En medio de tendencia (continuación) o en extremo (reversión)

**Cómo tradear:**

**SETUP LONG (Uptrend Continuation):**
```
Condiciones:
1. Uptrend confirmado (Trend Strength > 50)
2. Inside bar se forma cerca de soporte (S/R, VWAP, MA)
3. Confidence > 65
4. Esperar breakout ARRIBA del inside bar

Entry: Breakout confirmado (cierre arriba del high)
Stop: Below low del inside bar (o mother candle)
Target: Próximo swing high o resistencia

Ejemplo:
Price @ $100
Inside Bar: High $100.50, Low $99.80
Entry: $100.55 (breakout confirmado)
Stop: $99.75 (below low)
Target: $102.00 (resistencia)
R:R = ($102 - $100.55) / ($100.55 - $99.75) = 1:1.8
```

**SETUP SHORT (Downtrend Continuation):**
```
(Inverso del long)

Entry: Breakout confirmado ABAJO del low
Stop: Above high del inside bar
Target: Próximo swing low o soporte
```

**Parámetros óptimos:**
- `minMotherCandleSize: 0.5-0.7` (% of ATR)
- `requireFullContainment: true` (más estricto, mejor calidad)
- `allowWicksTouch: false` (mechas NO deben tocar extremos)

**Errores comunes:**
- ❌ Entrar ANTES del breakout (esperar confirmación)
- ❌ Usar inside bars en rangos (baja efectividad, 40-45%)
- ❌ Ignorar el contexto de tendencia

### 5.2 False Breakout

**Cuándo aparece:**
- Inside bar rompe CONTRA la tendencia
- Traders contra-tendencia entran (caen en trampa)
- Precio revierte rápidamente A FAVOR de tendencia
- Señal MUY fuerte de continuación

**Cómo tradear:**

**SETUP (Bullish False Breakdown):**
```
Secuencia:
1. Uptrend establecido
2. Inside bar se forma
3. Precio rompe ABAJO (falsa ruptura bajista)
4. Vendedores atrapados
5. Precio REVIERTE y cierra ARRIBA del inside bar
6. Entry en la reversión

Ejemplo:
Uptrend @ $100
Inside Bar: High $100.50, Low $99.80
Breakout inicial: $99.60 (abajo - TRAMPA)
Reversión: Cierra @ $100.70 (arriba)
Entry: $100.75
Stop: $99.50 (low del false breakdown)
Target: $102.50 (next resistance)
R:R = 1:3.3 (excelente)
```

**Parámetros óptimos:**
- `lookforwardCandles: 2-3` (velas para confirmar reversión)
- `minReversalPercent: 0.5` (debe reversar al menos 50% del breakout)
- `requireVolumeOnReversal: true` (crítico - volumen confirma)
- `minReversalVolume: 1.2` (volumen > 1.2× promedio)

**Señales de confirmación:**
- ✓ Volumen alto en vela de reversión
- ✓ Cierre fuerte (cerca del high para long, low para short)
- ✓ Vela de reversión engulfa la vela de breakout
- ✓ Trend strength > 60 (tendencia fuerte)

**Errores comunes:**
- ❌ Entrar en el breakout inicial (caer en la trampa)
- ❌ No esperar confirmación de reversión
- ❌ Tradear false breakouts en rangos (ambiguo)

### 5.3 Momentum

**Cuándo aparece:**
- Inicio fuerte de movimiento (breakout de rango)
- Continuación explosiva de tendencia
- Institucionales/ballenas entrando agresivamente
- Noticias catalíticas (opcional)

**Características:**
```
3+ velas consecutivas:
- Cuerpos grandes (> 60% del rango)
- Mechas pequeñas (< 30%)
- Mismo color (verde o rojo)
- Volumen elevado (recomendado)
- Ángulo pronunciado
```

**Cómo tradear:**

**SETUP:**
```
Condiciones:
1. Detectar 3+ velas fuertes consecutivas
2. Esperar consolidación breve (1-3 velas)
3. Entry en breakout de consolidación
4. Stops ajustados (movimiento rápido)
5. Targets agresivos

Ejemplo:
Momentum: 3 velas verdes grandes ($100 → $102)
Consolidación: 2 velas pequeñas ($102-$102.50)
Entry: $102.60 (breakout de consolidación)
Stop: $102.00 (tight - debajo de consolidación)
Target: $105.00 (agresivo, siguiente resistencia)
R:R = 1:4
```

**Parámetros óptimos:**
- `minConsecutiveCandles: 3` (standard)
- `minBodyRatio: 0.65` (velas fuertes)
- `requireVolumeConfirmation: true`
- `minVolumeMultiplier: 1.5`
- `volumeCompensation.enabled: true` (si volumen > 2×, acepta 2 velas)

**Gestión especial para momentum:**
- **Stops más ajustados**: Movimiento rápido puede reversar bruscamente
- **Targets más ambiciosos**: Momentum puede ir muy lejos
- **Salidas parciales**: Tomar profit parcial en resistencias intermedias
- **Trailing stops agresivos**: Mover stop rápidamente con el precio

**Errores comunes:**
- ❌ Perseguir el precio (FOMO) - esperar consolidación
- ❌ Stops muy amplios (momentum puede reversar rápido)
- ❌ No tomar profits parciales
- ❌ Entrar tarde (después de 5+ velas, momentum agotado)

### 5.4 Hammer/Shooting Star (Reclassify by Context)

**Behavior clásico:**
- Hammer en soporte → Reversión alcista
- Shooting Star en resistencia → Reversión bajista

**Behavior con reclassify=true:**

**Hammer en MEDIO de uptrend:**
```
Clasificación: CONTINUATION (no reversión)
Interpretación: Pullback saludable, retoma subida
Entry: Breakout del high del hammer
Stop: Below low del hammer
Target: Swing high previo
```

**Shooting Star en MEDIO de downtrend:**
```
Clasificación: CONTINUATION (no reversión)
Interpretación: Rally fallido, retoma bajada
Entry: Breakdown del low del shooting star
Stop: Above high
Target: Swing low previo
```

**Cuándo desactivar reclassify:**
- Si quieres SOLO reversiones (trading contra-tendencia)
- Si tienes otra estrategia de continuación
- Si prefieres interpretación clásica siempre

### 5.5 Engulfing (Reclassify by Context)

**Bullish Engulfing:**

**En downtrend (clásico):**
- Clasificación: REVERSAL
- Interpretación: Capitulation, cambio de dirección
- Confidence alto si en soporte

**En uptrend (reclassify=true):**
- Clasificación: CONTINUATION
- Interpretación: Confirmación de fuerza alcista
- Entry: Encima del high del engulfing
- Señal: Compradores dominando completamente

**Parámetros:**
- `minBodyRatio: 1.1` (cuerpo actual >= 110% del previo)
- `requireFullEngulfment: true` (envuelve completamente, incluso mechas)

---

## 6. TWEAKS POR TIMEFRAME

### 6.1 1-Minute (Scalping Ultra-Rápido)

**Objetivo:** Múltiples trades pequeños, R:R 1:1.5+

**Config óptima:**
```yaml
Patterns:
  insideBar:
    enabled: true
    minMotherCandleSize: 0.3  # MUY permisivo
  momentum:
    enabled: true
    minConsecutiveCandles: 2  # Solo 2 velas
    requireVolumeConfirmation: true  # CRÍTICO
    minVolumeMultiplier: 1.8  # Volumen MUY alto

Level Sources:
  supportResistance: true
  volumeProfile: true  # Solo fixed ranges importantes
  vwap: true  # Session VWAP
  fibonacci: false  # NO confiable en 1m

Filters:
  minConfidence: 50-55  # Bajo (más señales)
  requireTrendForContinuation: false  # Desactivar

Trend Analysis:
  minTrendStrength: 40  # Permisivo
```

**Tips:**
- Operar solo en sesiones de alta liquidez (US/EU open)
- Usar VWAP como guía principal
- Entradas rápidas, salidas rápidas
- Stop loss ajustado (10-15 pips máximo)

### 6.2 5-15 Minute (Day Trading Standard)

**Objetivo:** 2-4 trades/día, R:R 1:2+

**Config óptima:**
```yaml
Patterns:
  insideBar:
    enabled: true
    minMotherCandleSize: 0.5  # Estándar
  falseBreakout:
    enabled: true  # Funciona MUY bien
  momentum:
    enabled: true
    minConsecutiveCandles: 3
    volumeCompensation.enabled: true

Level Sources:
  supportResistance: true
  volumeProfile: true
  vwap: true  # Muy efectivo
  fibonacci: false  # Opcional

Filters:
  minConfidence: 65  # Balance
  requireTrendForContinuation: true

Trend Analysis:
  minTrendStrength: 50  # Tendencias claras
```

**Estrategia:**
1. Esperar patrón cerca de VWAP o S/R
2. Trend strength > 50
3. Confidence > 70
4. Entry en breakout/confirmación
5. Stop detrás de nivel clave
6. Target: Próximo S/R (R:R mínimo 1:2)

### 6.3 1-4 Hour (Swing Trading)

**Objetivo:** 1-2 trades/semana, R:R 1:3+

**Config óptima:**
```yaml
Patterns:
  insideBar:
    enabled: true
    minMotherCandleSize: 0.7  # Más restrictivo
    minConsecutiveCandles: 2
  momentum:
    enabled: true
    minConsecutiveCandles: 4  # Velas más fuertes
  engulfing:
    enabled: true
    reclassifyByContext: true

Level Sources:
  supportResistance: true
  volumeProfile: true  # Fixed ranges importantes
  vwap: true  # Weekly anchored
  fibonacci: true  # MUY útil en swing

Filters:
  minConfidence: 70-75  # Alta calidad
  requireTrendForContinuation: true

Trend Analysis:
  minTrendStrength: 60  # Tendencias fuertes
```

**Estrategia:**
1. Esperar confluencia (3+ niveles coincidiendo)
2. Inside bar en Fibonacci 50% + VWAP + S/R
3. Trend strength > 60
4. Confidence > 80
5. Hold 3-7 días
6. Target: Fibonacci extensions o swing extremo

### 6.4 Daily (Position Trading)

**Objetivo:** Trades de semanas/meses, R:R 1:5+

**Config óptima:**
```yaml
Patterns:
  insideBar:
    enabled: true
    minMotherCandleSize: 1.0  # MUY restrictivo
  momentum:
    enabled: true
    minConsecutiveCandles: 5+
    minBodyRatio: 0.75

Level Sources:
  supportResistance: true  # Niveles mayores
  volumeProfile: false  # Menos útil en daily
  vwap: true  # Monthly anchored
  fibonacci: true  # Crítico para swing largos

Filters:
  minConfidence: 75-80  # Máxima calidad
  requireTrendForContinuation: true

Trend Analysis:
  minTrendStrength: 70  # Solo tendencias muy fuertes
```

**Estrategia:**
1. Análisis macro primero (weekly/monthly)
2. Esperar inside bar en nivel crítico
3. Confluencia de múltiples factores
4. Confidence > 85
5. Hold semanas/meses
6. Targets en niveles psicológicos mayores

---

## 7. CASOS DE USO PRÁCTICOS

### CASO 1: Day Trader (1h charts, BTC)

**Perfil:**
- Timeframe: 1h
- Par: BTCUSDT
- Sesión: US market hours
- Objetivo: 2-3 trades/día
- R:R mínimo: 1:2

**Config:**
```yaml
Level Sources:
  ☑ S/R
  ☑ Volume Profile (fixed ranges)
  ☑ VWAP (session)
  ☐ Fibonacci

Patterns:
  ☑ Inside Bar
  ☑ False Breakout
  ☑ Hammer (reclassify ON)

Filters:
  minConfidence: 65
  requireTrendForContinuation: true
  proximityPercent: 0.5%  # Muy cerca de niveles

Scoring Weights:
  vwap: Alta proximidad (threshold: 0.3%)
```

**Estrategia diaria:**
```
Morning (9-11 AM):
1. Verificar trend en 4h (higher timeframe)
2. Marcar niveles clave (S/R + VP fixed ranges)
3. Esperar patrones cerca de VWAP

Intraday (11 AM - 4 PM):
4. Patrón detectado con confidence > 70
5. Verificar confluencia (VWAP + S/R)
6. Entry en breakout confirmado
7. Stop detrás de VWAP o nivel
8. Target: Próximo S/R

Evening (4-6 PM):
9. Cerrar trades antes de close (o dejar con trailing stop)
10. Review: Qué funcionó, qué no
```

**Ejemplo de trade:**
```
Fecha: Hoy, 2:30 PM
Patrón: Inside Bar (◐ CONTINUATION)
Precio: $42,150
Confidence: 78%
Niveles cercanos:
  - S/R: $42,080 (0.17%)
  - VWAP: $42,100 (0.12%)
  - VP Fixed Range POC: $42,090 (0.14%)
Trend Strength: 72 (uptrend fuerte)

Decisión: LONG
Entry: $42,165 (breakout del inside bar)
Stop: $42,050 (debajo VWAP y low del IB)
Target: $42,400 (resistencia en VP)
R:R: ($42,400 - $42,165) / ($42,165 - $42,050) = 2.04

Resultado: ✓ Target alcanzado en 3 horas
```

### CASO 2: Swing Trader (4h charts, ETH)

**Perfil:**
- Timeframe: 4h
- Par: ETHUSDT
- Objetivo: 1-2 trades/semana
- R:R mínimo: 1:3
- Hold time: 3-7 días

**Config:**
```yaml
Level Sources:
  ☑ S/R (solo niveles mayores)
  ☑ Volume Profile (weekly fixed ranges)
  ☑ VWAP (weekly anchored)
  ☑ Fibonacci (auto-detect)

Patterns:
  ☑ Inside Bar
  ☑ Momentum
  ☑ Engulfing (reclassify ON)

Filters:
  minConfidence: 75
  requireTrendForContinuation: true

Fibonacci Config:
  autoDetectSwing: true
  swingLookback: 100
  levels: [0.382, 0.5, 0.618, 0.786]
```

**Estrategia semanal:**
```
Weekend:
1. Análisis de daily chart (estructura macro)
2. Marcar swings importantes
3. Fibonacci desde último swing mayor
4. Identificar zonas de confluencia

Week:
5. Esperar patrones en zonas de confluencia
6. Verificar: Fibonacci + VWAP + S/R coinciden?
7. Confidence > 80 required
8. Entry, hold 3-7 días
9. Target: Fibonacci extensions o swing extremo

Gestión:
- Revisar trades 1x/día (no intraday)
- Trailing stop cuando profit > 2R
- Cerrar parciales en resistencias intermedias
```

**Ejemplo de trade:**
```
Setup: ETH retroceso en uptrend
Precio actual: $3,200

Análisis:
- Swing High: $3,500 (hace 2 semanas)
- Swing Low: $2,900 (hace 1 mes)
- Fibonacci 50%: $3,200 ← ACTUAL
- VWAP Weekly: $3,180
- S/R: $3,150
→ CONFLUENCIA TRIPLE

Patrón detectado: Hammer (reclassified as CONTINUATION)
Confidence: 84%
Trend Strength: 68 (uptrend)

Decisión: LONG
Entry: $3,210 (confirmación)
Stop: $3,100 (debajo Fib 61.8% y VWAP)
Target 1: $3,400 (Fib 23.6%, cierre parcial 50%)
Target 2: $3,500 (Swing High, cierre total)
R:R: 1:3.6

Duración esperada: 5-7 días
```

### CASO 3: Scalper (5m charts, BTC)

**Perfil:**
- Timeframe: 5m
- Par: BTCUSDT
- Sesión: US open (9:30-11:30 AM)
- Objetivo: 5-10 trades/sesión
- R:R mínimo: 1:1.5

**Config:**
```yaml
Level Sources:
  ☑ S/R (solo niveles inmediatos)
  ☑ VWAP (session, critical)
  ☐ Volume Profile (demasiado lento)
  ☐ Fibonacci (no útil en 5m)

Patterns:
  ☑ Inside Bar (min 1 candle)
  ☑ Momentum (min 2 candles con volume)
  ☐ False Breakout (demasiado lento)

Filters:
  minConfidence: 55  # Permisivo
  requireTrendForContinuation: false
  requireVolumeConfirmation: true  # CRÍTICO

VWAP Config:
  showBands: true
  stdDevMultipliers: [1, 2]
  proximityThreshold: 0.2%  # MUY cerca
```

**Estrategia de sesión:**
```
Pre-market (9:00-9:30 AM):
1. Marcar VWAP del día
2. Identificar S/R de overnight

First hour (9:30-10:30 AM):
3. Operar rebotes/rechazos de VWAP
4. Momentum patterns con volumen > 2×
5. Entry rápida, exit rápida
6. Stop: 10-15 pips máximo

Second hour (10:30-11:30 AM):
7. Continuación de trends establecidos
8. Inside bars cerca de VWAP
9. Solo trades a favor de trend de 15m

Rules estrictas:
- Max 10 trades por sesión
- Stop después de 3 losses consecutivas
- No trades últimos 30 min antes de lunch
```

**Ejemplo de trade:**
```
Time: 10:05 AM
Patrón: Momentum (2 velas verdes grandes)
Precio: $42,100 (exactamente en VWAP)
Volumen: 2.3× promedio
Confidence: 72% (alto para 5m)

Decisión: LONG (rebote VWAP + momentum)
Entry: $42,105
Stop: $42,085 (20 pips, tight)
Target: $42,135 (30 pips, S/R)
R:R: 1:1.5

Duración: 15 minutos
Resultado: ✓ Target alcanzado
```

---

## 8. TROUBLESHOOTING

### PROBLEMA: Demasiadas señales (saturación)

**Síntomas:**
- 20+ patrones por día
- Difícil distinguir cuáles tradear
- Muchos falsos positivos

**Soluciones:**
1. **↑ minConfidence** (70-80)
2. **☑ requireTrendForContinuation** (solo en tendencias)
3. **↑ minConsecutiveCandles** (para momentum: 4-5)
4. **☑ requireVolumeConfirmation** (crítico)
5. **Desactivar** patrones menos efectivos (ej. Doji)
6. **Reducir** fuentes de niveles (solo S/R + 1 más)

**Config recomendada:**
```yaml
Filters:
  minConfidence: 75
  requireTrendForContinuation: true
  requireVolumeSpike: true

Patterns:
  # Solo los más efectivos
  insideBar: enabled
  falseBreakout: enabled
  # Desactivar el resto temporalmente
```

### PROBLEMA: Muy pocas señales (sequía)

**Síntomas:**
- 0-2 patrones por semana
- Oportunidades perdidas
- Config demasiado restrictiva

**Soluciones:**
1. **↓ minConfidence** (55-60)
2. **↓ minMotherCandleSize** (0.3-0.4)
3. **☐ requireTrendForContinuation** (desactivar temporalmente)
4. **Activar más** fuentes de niveles (S/R + VP + VWAP)
5. **↓ minConsecutiveCandles** (momentum: 2)
6. **Activar más patrones** (Hammer, Shooting Star, Engulfing)

**Config recomendada:**
```yaml
Filters:
  minConfidence: 55-60
  requireTrendForContinuation: false

Patterns:
  # Activar todos
  insideBar: enabled
  falseBreakout: enabled
  momentum: enabled
  hammer: enabled (reclassify: true)
  engulfing: enabled (reclassify: true)
```

### PROBLEMA: Muchos falsos positivos (losses)

**Síntomas:**
- Win rate < 45%
- Patrones detectados que fallan
- Confidence scores no coinciden con resultado

**Diagnóstico:**
1. **Verificar trend analysis** está enabled
2. **Revisar** si estás operando contra tendencia
3. **Verificar** timeframe (muy bajo = ruido)
4. **Revisar** par (low-cap = menos confiable)

**Soluciones:**
1. **☑ Trend Analysis enabled**
2. **↑ minTrendStrength** (50-60)
3. **Activar VWAP** para mejor contexto (si intraday)
4. **Solo tradear** con confluencia (2+ niveles cercanos)
5. **↑ proximityThreshold** para VWAP/Fib (más cerca)
6. **Verificar** que reclassifyByContext está ON para patrones clásicos

**Checklist de calidad:**
```
Antes de entrar un trade, verificar:
- [ ] Trend Strength > 50 (si continuation)
- [ ] Confidence > 70
- [ ] Al menos 2 niveles cercanos (confluencia)
- [ ] Volumen confirma (si configurable)
- [ ] Pattern hace sentido con contexto
- [ ] R:R mínimo 1:2
```

### PROBLEMA: VWAP no visible o no funciona

**Síntomas:**
- VWAP no se dibuja en gráfico
- VWAP no contribuye a confidence
- Bandas no aparecen

**Soluciones:**
1. **Verificar** VWAP está enabled en Level Sources
2. **Verificar** showBands está true (si quieres bandas)
3. **Revisar** anchorType:
   - 1m-4h → 'session'
   - 4h-Daily → 'weekly' o 'monthly'
4. **Check consola** para errores de cálculo
5. **Verificar** que hay suficientes datos (< 1000 candles OK)
6. **Refresh** indicador (Settings → Apply)

### PROBLEMA: Fibonacci levels incorrectos

**Síntomas:**
- Niveles Fibonacci en lugares extraños
- Auto-detect no encuentra swing
- Levels no coinciden con esperado

**Soluciones:**
1. **Desactivar autoDetectSwing**
2. **Configurar swing manualmente:**
   ```
   manualSwingHigh: [precio del top]
   manualSwingLow: [precio del bottom]
   ```
3. **↑ swingLookback** (150-200 para swings más grandes)
4. **Verificar** que hay uptrend o downtrend claro (Fibonacci no funciona en rangos)
5. **Usar solo** en timeframes 1h+ (no confiable en < 1h)

### PROBLEMA: Performance lento (lag)

**Síntomas:**
- Gráfico se congela
- Detección toma > 5 segundos
- Browser slow/unresponsive

**Soluciones:**
1. **↓ días de histórico** (15-30 días máximo)
2. **Desactivar** fuentes no usadas (Fibonacci si no lo usas)
3. **Reducir** stdDevMultipliers de VWAP ([1, 2] solo)
4. **Limpiar cache** (Settings → Clear Cache)
5. **Cerrar** otros símbolos (watchlist grande = más carga)
6. **Actualizar** browser
7. **Revisar** console para errores de loop infinito

---

## 9. FAQ

**Q: ¿Inside Bar vs False Breakout, cuál es mejor?**

A: **False Breakout** tiene mayor win rate (75% vs 55%) pero es menos frecuente. **Inside Bar** da más señales pero requiere mejor gestión. Recomendación: Usa ambos, prioriza false breakout cuando aparezca.

---

**Q: ¿VWAP es necesario?**

A: No es obligatorio, pero **mejora significativamente** la precisión en timeframes intraday (1m-4h). En daily+, VWAP anchored (weekly/monthly) aún útil pero no crítico. Si solo operas swing/position, puedes usar S/R + Fibonacci.

Recomendación:
- Day trading 1m-1h → **VWAP crítico**
- Swing 4h-Daily → **VWAP útil** (anchored)
- Position Weekly+ → **VWAP opcional**

---

**Q: ¿Cuántas fuentes de niveles debo usar?**

A: **Mínimo 2** para confluencia, **ideal 3**.

Combinaciones recomendadas:
- **Básico**: S/R + Volume Profile
- **Intermedio**: S/R + Volume Profile + VWAP
- **Avanzado**: S/R + Volume Profile + VWAP + Fibonacci
- **Máximo**: Todas (S/R + VP + VWAP + Fib + Manual)

Más fuentes = mejor confluencia, pero también más complejo. Comienza con 2-3.

---

**Q: ¿Puedo usar solo momentum patterns?**

A: **Sí**, pero con condiciones:
```yaml
Config para solo momentum:
  momentum:
    enabled: true
    minConsecutiveCandles: 3
    requireVolumeConfirmation: true  # CRÍTICO
    minVolumeMultiplier: 2.0  # Alto

  filters:
    minConfidence: 75  # Restrictivo
    requireVolumeSpike: true
```

Momentum solo funciona bien si:
- Volumen confirma (> 2× promedio)
- Confidence > 75
- En breakouts o inicio de tendencia

No uses solo momentum en mid-trend o rangos.

---

**Q: ¿Fibonacci automático es confiable?**

A: **Depende del contexto**:

**SÍ confiable cuando:**
- Uptrend claro (HH, HL consistentes)
- Downtrend claro (LH, LL consistentes)
- Swing reciente obvio (< 100 velas)
- Timeframe 1h+

**NO confiable cuando:**
- Mercado en rango (swings ambiguos)
- Choppy/errático
- Timeframe < 1h
- Sin swing claro en último lookback

**Recomendación**: Usa auto-detect en tendencias claras, manual en casos ambiguos.

---

**Q: ¿Cómo sé si un patrón es de alta calidad?**

A: Checklist de calidad:

**Alta calidad (Confidence 80+):**
- ✓ Confluencia de 3+ niveles (S/R + VWAP + Fib)
- ✓ Trend Strength > 60
- ✓ Volumen confirmatorio (> 1.5× promedio)
- ✓ Pattern cerca de nivel clave (< 0.5% distancia)
- ✓ Estructura de mercado clara (HH/HL o LH/LL)

**Media calidad (Confidence 65-80):**
- ✓ Confluencia de 2 niveles
- ✓ Trend Strength > 40
- ✓ Pattern cerca de nivel (< 1% distancia)

**Baja calidad (Confidence < 65):**
- Solo 1 nivel cercano
- Trend débil o rango
- Lejos de niveles clave

**Acción:**
- Alta calidad → Posición full (1-2% cuenta)
- Media → Posición reducida (0.5-1%)
- Baja → Skip (esperar mejor setup)

---

**Q: ¿Qué hacer si todos mis trades están perdiendo?**

A: **Proceso de diagnóstico:**

**Paso 1: Verificar configuración básica**
```
- [ ] Trend analysis enabled?
- [ ] minTrendStrength adecuado (> 40)?
- [ ] Estás esperando confluencia (2+ niveles)?
- [ ] requireTrendForContinuation = true?
```

**Paso 2: Revisar gestión de riesgo**
```
- [ ] R:R mínimo 1:2?
- [ ] Stops detrás de niveles clave?
- [ ] Tamaño de posición < 2% de cuenta?
- [ ] No más de 3 trades simultáneos?
```

**Paso 3: Analizar trades**
```
- ¿Dónde falló el trade?
  - Entry temprano → Esperar mejor confirmación
  - Stop muy tight → Usar nivel clave como stop
  - Target muy ambicioso → Reducir a S/R próximo
  - Contra tendencia → Solo operar a favor
```

**Paso 4: Volver a básico**
```
Resetear config a defaults
Operar SOLO:
- Inside Bar en S/R + VWAP
- Confidence > 75
- Trend Strength > 50
- R:R mínimo 1:2
- Max 1 trade/día

Rebuild confianza gradualmente
```

---

**Q: ¿Diferencia entre VWAP session vs anchored?**

A:

**VWAP Session (reset diario):**
- Reset: Midnight UTC cada día
- Mejor para: Intraday (1m-4h)
- Ventaja: Fresh cada día, institucionales lo usan
- Desventaja: Pierde contexto multi-día

**VWAP Anchored (desde evento):**
- Reset: Punto específico (weekly, monthly, custom)
- Mejor para: Swing (4h-Daily+)
- Ventaja: Contexto de largo plazo
- Desventaja: Puede estar muy lejos del precio actual

**Cuándo usar cada uno:**
```
Timeframe → VWAP Type
1m-15m   → Session (critical)
1h-4h    → Session (primary) + Weekly (secondary)
Daily    → Weekly (primary) + Monthly (secondary)
Weekly+  → Monthly + Quarterly
```

---

**Q: ¿Reclassify by context siempre ON?**

A: **Depende de tu estrategia:**

**ON cuando:**
- Quieres detectar continuación Y reversión
- Operas con la tendencia (trend following)
- Quieres máxima flexibilidad
- Confías en el trend analysis

**OFF cuando:**
- Solo quieres reversiones (contra-tendencia)
- Tienes otra estrategia de continuación
- Prefieres interpretación clásica fija
- Trend analysis desactivado

**Recomendación general**: **ON para Hammer y Engulfing**, OFF para Shooting Star y Doji (reversiones más claras).

---

**Q: ¿Cómo exportar mi configuración perfecta?**

A:
```
1. Ajusta todos los parámetros hasta estar satisfecho
2. Settings → Export Config button
3. Guarda archivo JSON
4. Para importar: Settings → Import Config → Select file
5. Puedes tener múltiples configs:
   - config_btc_1h.json (day trading BTC)
   - config_eth_4h.json (swing ETH)
   - config_scalp_5m.json (scalping)
```

**Tip**: Nombra tus configs descriptivamente:
- `continuation_daytrading_btc_1h_v2.json`
- `continuation_swing_eth_4h_conservative.json`

---

## 10. CHEAT SHEETS

### 10.1 Quick Reference: Pattern Types

| Pattern | Type | Best Timeframe | Min Confidence | Key Requirement | Win Rate |
|---------|------|----------------|----------------|-----------------|----------|
| **Inside Bar** | Continuation | 15m-4h | 65 | Near level (S/R, VWAP) | 52-55% |
| **False Breakout** | Continuation | 5m-1h | 75 | Volume on reversal | 70-75% |
| **Momentum** | Trend Start | 1m-1h | 70 | 3+ strong candles + volume | 60-65% |
| **Hammer (context)** | Continuation | 15m-4h | 65 | In middle of uptrend | 55-60% |
| **Engulfing (context)** | Continuation | 1h-4h | 70 | In trend + near level | 58-62% |

### 10.2 Quick Reference: Timeframe Settings

| Timeframe | minConfidence | minConsecutiveCandles | VWAP Type | Key Levels | Position Size |
|-----------|---------------|----------------------|-----------|------------|---------------|
| **1m** | 55-60 | 2 | Session | S/R + Volume | 0.5-1% |
| **5-15m** | 60-65 | 3 | Session | S/R + VP + VWAP | 1-1.5% |
| **1h** | 65-70 | 3-4 | Session | All sources | 1.5-2% |
| **4h** | 70-75 | 4-5 | Weekly | S/R + VP + VWAP + Fib | 2-3% |
| **Daily** | 75-80 | 5+ | Monthly | S/R + Fib | 3-5% |

### 10.3 Configuration Presets

**PRESET 1: Conservative (High Win Rate, Few Trades)**
```yaml
patterns:
  insideBar.minMotherCandleSize: 0.8
  momentum.minConsecutiveCandles: 4
  falseBreakout.enabled: true
filters:
  minConfidence: 75
  requireTrendForContinuation: true
  requireVolumeSpike: true
levelSources:
  supportResistance: true
  volumeProfile: true
  vwap: true
  fibonacci: true
```

**PRESET 2: Balanced (Medium Win Rate, Medium Trades)**
```yaml
patterns:
  insideBar.minMotherCandleSize: 0.5
  momentum.minConsecutiveCandles: 3
  falseBreakout.enabled: true
filters:
  minConfidence: 65
  requireTrendForContinuation: true
levelSources:
  supportResistance: true
  volumeProfile: true
  vwap: true
```

**PRESET 3: Aggressive (Lower Win Rate, Many Trades)**
```yaml
patterns:
  insideBar.minMotherCandleSize: 0.3
  momentum.minConsecutiveCandles: 2
  falseBreakout.enabled: false
filters:
  minConfidence: 55
  requireTrendForContinuation: false
levelSources:
  supportResistance: true
  vwap: true
```

### 10.4 Level Source Priority

**For Day Trading (1m-1h):**
```
Priority Order:
1. VWAP (session) - 🔴 Critical
2. Support & Resistance - 🔴 Critical
3. Volume Profile - 🟠 Important
4. Manual Levels - 🟡 Optional
5. Fibonacci - ⚪ Skip
```

**For Swing Trading (4h-Daily):**
```
Priority Order:
1. Support & Resistance - 🔴 Critical
2. Fibonacci - 🔴 Critical
3. VWAP (weekly/monthly) - 🟠 Important
4. Volume Profile Fixed - 🟡 Optional
5. Manual Levels - 🟡 Optional
```

### 10.5 Risk Management Cheat Sheet

```
Position Sizing by Confidence:
- Confidence 85-100: 2% of account
- Confidence 75-85:  1.5% of account
- Confidence 65-75:  1% of account
- Confidence < 65:   Skip or 0.5% max

R:R by Timeframe:
- 1-5m:    Min 1:1.5
- 15m-1h:  Min 1:2
- 4h:      Min 1:3
- Daily:   Min 1:5

Max Concurrent Trades:
- Scalping (1-5m):   1-2
- Day (15m-1h):      2-3
- Swing (4h-Daily):  3-5

Daily Loss Limit:
- Stop trading after 3 consecutive losses
- Max daily loss: 5% of account
- Take break, review what went wrong
```

### 10.6 Troubleshooting Quick Fix

| Problem | Quick Fix |
|---------|-----------|
| Too many signals | ↑ minConfidence to 75, ☑ requireTrend |
| Too few signals | ↓ minConfidence to 55, activate more patterns |
| Many false positives | ☑ VWAP, ↑ minTrendStrength to 60 |
| VWAP not working | Check anchorType, verify enabled |
| Fibonacci wrong | Use manual swing, not auto-detect |
| Performance slow | ↓ days to 15, disable unused sources |
| Pattern not detected | ↓ thresholds, check debug mode ON |

---

## FINAL NOTES

**Remember:**
1. **Contexto es REY**: Mismo patrón, diferente significado según dónde aparece
2. **VWAP > MAs**: Sin lag, más preciso para intraday
3. **Confluencia es poder**: 3+ niveles = alta probabilidad
4. **Volumen confirma**: Siempre busca volumen en patrones fuertes
5. **Trend es tu amigo**: Opera A FAVOR, no en contra

**Start Simple:**
- Solo S/R + VWAP
- Solo Inside Bar + Momentum
- Confidence > 70
- R:R mínimo 1:2
- 1 trade/día

**Build Up Gradually:**
- Agrega Fibonacci cuando domines básico
- Agrega False Breakout cuando entiendas Inside Bar
- Agrega más fuentes cuando veas confluencia funcionar

**Track Your Results:**
- Win rate por patrón
- Win rate por timeframe
- Win rate por nivel source
- Ajusta config basado en datos

---

**Good Luck & Happy Trading!** 🚀

*Este indicador es una herramienta. Tu gestión de riesgo y disciplina determinan el éxito.*
