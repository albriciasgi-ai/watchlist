# Guía de Parámetros de Patrones de Rechazo

Esta guía explica en detalle cada patrón de vela de rechazo (candlestick reversal pattern) que detectamos en el sistema, junto con todos sus parámetros configurables.

---

## Índice

1. [Hammer (Martillo)](#1-hammer-martillo)
2. [Shooting Star (Estrella Fugaz)](#2-shooting-star-estrella-fugaz)
3. [Engulfing (Envolvente)](#3-engulfing-envolvente)
4. [Doji (Dragonfly y Gravestone)](#4-doji-dragonfly-y-gravestone)
5. [Swing Detection (Detección de Swings)](#5-swing-detection-detección-de-swings)
6. [Tabla de Comparación Rápida](#6-tabla-de-comparación-rápida)
7. [Casos de Uso por Timeframe](#7-casos-de-uso-por-timeframe)

---

## 1. Hammer (Martillo)

### ¿Qué es?

El **Hammer** es un patrón de reversión **alcista** que aparece en tendencias bajistas. Indica que los vendedores empujaron el precio hacia abajo, pero los compradores rechazaron esos precios bajos y cerraron cerca del máximo.

### Anatomía Visual

```
HAMMER PERFECTO (Bullish Reversal)

High ──────┬──
           │ │  ← Cuerpo pequeño en la parte superior
           └─┘    (puede ser verde o rojo)
            │
            │
            │   ← Mecha inferior LARGA (lower shadow)
            │     representa el rechazo de precios bajos
            │
            │
Low ────────┘

Características:
✓ Mecha inferior > 2x el cuerpo
✓ Cuerpo en el 50-70% superior del rango
✓ Mecha superior pequeña o inexistente
✓ Aparece después de tendencia bajista
```

### Parámetros Configurables

#### 1. **minWickRatio** (Ratio Mínimo de Mecha)

**Rango:** 1.0 - 5.0x
**Default:** 1.5x
**Tipo:** Slider

**Definición:** Cuántas veces más larga debe ser la mecha inferior comparada con el cuerpo.

**Fórmula:**
```javascript
wickRatio = lowerWick / bodySize

donde:
  lowerWick = min(open, close) - low
  bodySize = abs(close - open)
```

**Ejemplo Numérico:**
```
Vela:
├─ High: 100
├─ Close: 98
├─ Open: 96
└─ Low: 80

Cálculo:
  bodySize = |98 - 96| = 2
  lowerWick = 96 - 80 = 16
  wickRatio = 16 / 2 = 8.0x

Validación con minWickRatio = 1.5:
  8.0 > 1.5 → ✅ VÁLIDO (mecha suficientemente larga)
```

**Interpretación:**

| Valor | Significado | Uso |
|-------|-------------|-----|
| 1.0x | Muy permisivo - acepta casi cualquier mecha | Scalping rápido |
| 1.5x | **Estándar** - balance entre señales y calidad | Swing trading |
| 2.0x | Restrictivo - solo mechas muy pronunciadas | Position trading |
| 3.0x+ | Muy restrictivo - hammers excepcionales | Trading conservador |

**Visual Comparativo:**
```
minWickRatio = 1.0 (PERMISIVO)          minWickRatio = 2.5 (RESTRICTIVO)

  100 ──┬──                               100 ──┬──
        │█│                                     │█│
        └─┘                                     └─┘
         │                                       │
         │   ← Mecha corta ACEPTA                │
    90 ──┘                                       │
                                                 │   ← Mecha larga ACEPTA
    ✅ VÁLIDO                                    │
                                                 │
                                            80 ──┘

                                            ✅ VÁLIDO
```

---

#### 2. **maxUpperWickRatio** (Ratio Máximo de Mecha Superior)

**Rango:** 0.0 - 1.0x
**Default:** 0.3x
**Tipo:** Slider

**Definición:** Cuánto puede medir la mecha superior como máximo, relativa al cuerpo.

**Fórmula:**
```javascript
upperWickRatio = upperWick / bodySize

donde:
  upperWick = high - max(open, close)
  bodySize = abs(close - open)
```

**Ejemplo Numérico:**
```
Vela:
├─ High: 100
├─ Close: 98
├─ Open: 96
└─ Low: 80

Cálculo:
  bodySize = |98 - 96| = 2
  upperWick = 100 - 98 = 2
  upperWickRatio = 2 / 2 = 1.0x

Validación con maxUpperWickRatio = 0.3:
  1.0 > 0.3 → ❌ INVÁLIDO (mecha superior demasiado larga)
```

**Interpretación:**

| Valor | Significado | Patrón |
|-------|-------------|--------|
| 0.0x | No permite mecha superior | Hammer perfecto (casi imposible) |
| 0.2x | Muy restrictivo | Hammer fuerte |
| 0.3x | **Estándar** - tolera mecha pequeña | Balance ideal |
| 0.5x | Permisivo - acepta mecha moderada | Scalping |
| 1.0x | Muy permisivo | Cualquier configuración |

**Visual:**
```
maxUpperWickRatio = 0.1 (RESTRICTIVO)   maxUpperWickRatio = 0.5 (PERMISIVO)

       │                                      ────│────  ← Mecha larga
  100 ─┴─  ← Mecha muy corta                100  ─┴───
      ┌─┐                                        ┌─┐
      │█│                                        │█│
      └─┘                                        └─┘
       │                                          │
       │                                          │
   80 ─┘                                      80 ─┘

  ✅ VÁLIDO                                   ✅ VÁLIDO
```

**¿Por qué es importante?**
Un Hammer verdadero NO debe tener mecha superior larga. Si la tiene, significa que los precios altos también fueron rechazados, lo cual debilita la señal alcista.

---

#### 3. **minBodyPosition** (Posición Mínima del Cuerpo)

**Rango:** 0.0 - 1.0
**Default:** 0.5
**Tipo:** Slider

**Definición:** Dónde debe estar ubicado el cuerpo dentro del rango total de la vela. 0.0 = abajo (low), 1.0 = arriba (high).

**Fórmula:**
```javascript
bodyPosition = (min(open, close) - low) / (high - low)
```

**Ejemplo Numérico:**
```
Vela:
├─ High: 100
├─ Close: 98
├─ Open: 96
└─ Low: 80

Cálculo:
  totalRange = 100 - 80 = 20
  bodyBottom = 96 (el mínimo entre open y close)
  distanceFromLow = 96 - 80 = 16
  bodyPosition = 16 / 20 = 0.80

Validación con minBodyPosition = 0.5:
  0.80 > 0.5 → ✅ VÁLIDO (cuerpo en parte superior)
```

**Interpretación:**

| Valor | Ubicación del Cuerpo | Calidad del Hammer |
|-------|---------------------|-------------------|
| 0.0 | Cualquier posición | Muy permisivo |
| 0.3 | 30% superior | Hammer débil aceptado |
| 0.5 | **Mitad superior** | Estándar |
| 0.7 | 30% más alto | Hammer fuerte |
| 0.9 | Casi en el high | Muy restrictivo |

**Visual Comparativo:**
```
bodyPosition = 0.3 (DÉBIL)              bodyPosition = 0.8 (FUERTE)

HIGH ───┐                               HIGH ──┬──
        │                                      │█│  ← Cuerpo arriba
  0.5 ──┼──  ← 50% line                        └─┘
       ┌┴┐   ← Cuerpo aquí               0.5  ──┼──
       │█│                                      │
       └─┘                                      │
        │                                       │
LOW ────┘                               LOW ────┘

⚠️ DÉBIL                                ✅ FUERTE
```

**Regla práctica:**
Para un Hammer alcista fuerte, el cuerpo debe estar en el **tercio superior** (bodyPosition > 0.66).

---

#### 4. **debug** (Depuración Individual)

**Tipo:** Checkbox (boolean)
**Default:** false

**Función:** Activa logs detallados en la consola del navegador específicamente para patrones Hammer.

**Output en consola:**
```javascript
[HAMMER DEBUG] Vela analizada:
  Timestamp: 1699876543000
  OHLC: [100, 105, 98, 95]
  wickRatio: 2.3x (min: 1.5) ✅
  upperWickRatio: 0.4x (max: 0.3) ❌
  bodyPosition: 0.65 (min: 0.5) ✅
  RESULTADO: ❌ RECHAZADO (upperWick demasiado grande)
```

**Cuándo usarlo:**
- Estás calibrando parámetros y quieres ver por qué se rechazan ciertos patrones
- Estás backtesting y necesitas entender las detecciones
- Hay un patrón visual que crees que debería detectarse pero no lo hace

---

### Validación Completa de un Hammer

```javascript
function isValidHammer(candle, params) {
  const bodySize = Math.abs(candle.close - candle.open);
  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);
  const totalRange = candle.high - candle.low;

  // Check 1: Mecha inferior suficientemente larga
  const wickRatio = lowerWick / bodySize;
  if (wickRatio < params.minWickRatio) return false;

  // Check 2: Mecha superior no demasiado larga
  const upperWickRatio = upperWick / bodySize;
  if (upperWickRatio > params.maxUpperWickRatio) return false;

  // Check 3: Cuerpo en parte superior
  const bodyPosition = (Math.min(candle.open, candle.close) - candle.low) / totalRange;
  if (bodyPosition < params.minBodyPosition) return false;

  return true; // ✅ HAMMER VÁLIDO
}
```

---

## 2. Shooting Star (Estrella Fugaz)

### ¿Qué es?

El **Shooting Star** es un patrón de reversión **bajista** que aparece en tendencias alcistas. Es el opuesto del Hammer. Indica que los compradores empujaron el precio hacia arriba, pero los vendedores rechazaron esos precios altos y cerraron cerca del mínimo.

### Anatomía Visual

```
SHOOTING STAR PERFECTO (Bearish Reversal)

High ───────┐
            │
            │   ← Mecha superior LARGA (upper shadow)
            │     representa el rechazo de precios altos
            │
           ┌─┐
           │█│  ← Cuerpo pequeño en la parte inferior
Low ───────┴──    (puede ser verde o rojo)

Características:
✓ Mecha superior > 2x el cuerpo
✓ Cuerpo en el 30-50% inferior del rango
✓ Mecha inferior pequeña o inexistente
✓ Aparece después de tendencia alcista
```

### Parámetros Configurables

#### 1. **minWickRatio** (Ratio Mínimo de Mecha Superior)

**Rango:** 1.0 - 5.0x
**Default:** 1.5x
**Tipo:** Slider

**Definición:** Cuántas veces más larga debe ser la **mecha superior** comparada con el cuerpo.

**Fórmula:**
```javascript
wickRatio = upperWick / bodySize

donde:
  upperWick = high - max(open, close)
  bodySize = abs(close - open)
```

**Nota:** A diferencia del Hammer, aquí medimos la mecha **superior**, no la inferior.

**Ejemplo Numérico:**
```
Vela:
├─ High: 100
├─ Open: 84
├─ Close: 82
└─ Low: 80

Cálculo:
  bodySize = |82 - 84| = 2
  upperWick = 100 - 84 = 16
  wickRatio = 16 / 2 = 8.0x

Validación con minWickRatio = 1.5:
  8.0 > 1.5 → ✅ VÁLIDO
```

---

#### 2. **maxLowerWickRatio** (Ratio Máximo de Mecha Inferior)

**Rango:** 0.0 - 1.0x
**Default:** 0.3x
**Tipo:** Slider

**Definición:** Cuánto puede medir la mecha **inferior** como máximo, relativa al cuerpo.

**Fórmula:**
```javascript
lowerWickRatio = lowerWick / bodySize

donde:
  lowerWick = min(open, close) - low
  bodySize = abs(close - open)
```

**Ejemplo:**
```
Vela con mecha inferior excesiva:
├─ High: 100
├─ Open: 84
├─ Close: 82
└─ Low: 70  ← Muy abajo

Cálculo:
  bodySize = |82 - 84| = 2
  lowerWick = 82 - 70 = 12
  lowerWickRatio = 12 / 2 = 6.0x

Validación con maxLowerWickRatio = 0.3:
  6.0 > 0.3 → ❌ INVÁLIDO (mecha inferior demasiado larga)
```

**¿Por qué es importante?**
Un Shooting Star NO debe tener mecha inferior larga. Si la tiene, significa que también hubo rechazo de precios bajos, lo cual debilita la señal bajista.

---

#### 3. **minBodyPosition** (Posición Mínima del Cuerpo)

**Rango:** 0.0 - 1.0
**Default:** 0.5
**Tipo:** Slider

**Definición:** Para Shooting Star, medimos qué tan ABAJO está el cuerpo (inverso del Hammer).

**Fórmula (ajustada para Shooting Star):**
```javascript
bodyPosition = 1.0 - ((max(open, close) - low) / (high - low))

// O equivalentemente:
bodyPosition = (high - max(open, close)) / (high - low)
```

**Interpretación:**
- **0.5** = Cuerpo en mitad inferior (estándar)
- **0.7** = Cuerpo en 30% más bajo (shooting star fuerte)

**Visual:**
```
bodyPosition = 0.6 (FUERTE)

HIGH ───────┐
            │
            │
      0.5 ──┼──
            │
           ┌┴┐  ← Cuerpo abajo
           │█│
LOW ───────┴──

✅ SHOOTING STAR FUERTE
```

---

#### 4. **debug**

Igual que en Hammer, pero para Shooting Star.

---

## 3. Engulfing (Envolvente)

### ¿Qué es?

El **Engulfing** es un patrón de **dos velas** donde la segunda vela "engulle" completamente el cuerpo de la primera. Hay dos tipos:

1. **Bullish Engulfing** (Alcista): Reversión alcista
2. **Bearish Engulfing** (Bajista): Reversión bajista

### Anatomía Visual

#### Bullish Engulfing
```
Tendencia Bajista → Reversión Alcista

Vela 1      Vela 2
(Roja)      (Verde)

  ─┬─        ─────
   │         │   │
  ┌┴┐        │   │  ← Cuerpo verde más grande
  │█│        │   │    que engulle el cuerpo rojo
  └─┘        │   │
   │         └───┘
  ─┴─

Reglas:
✓ Vela 1: Bajista (roja/negra)
✓ Vela 2: Alcista (verde/blanca)
✓ El CUERPO de vela 2 > CUERPO de vela 1
✓ Vela 2 abre DEBAJO del cierre de vela 1
✓ Vela 2 cierra ARRIBA de la apertura de vela 1
```

#### Bearish Engulfing
```
Tendencia Alcista → Reversión Bajista

Vela 1      Vela 2
(Verde)     (Roja)

  ─┬─        ─────
   │         │   │  ← Cuerpo rojo más grande
  ┌┴┐        │   │    que engulle el cuerpo verde
  │█│        │   │
  └─┘        │   │
   │         └───┘
  ─┴─

Reglas:
✓ Vela 1: Alcista (verde/blanca)
✓ Vela 2: Bajista (roja/negra)
✓ El CUERPO de vela 2 > CUERPO de vela 1
✓ Vela 2 abre ARRIBA del cierre de vela 1
✓ Vela 2 cierra DEBAJO de la apertura de vela 1
```

### Parámetros Configurables

#### 1. **enabled** (Habilitado)

**Tipo:** Checkbox (boolean)
**Default:** true

**Función:** Activa/desactiva la detección de patrones Engulfing.

**Nota:** A diferencia de Hammer y Shooting Star, Engulfing NO tiene parámetros de ajuste fino porque su definición es binaria (o engulle completamente o no).

**Validación:**
```javascript
function isBullishEngulfing(prev, current) {
  // Vela anterior bajista
  if (prev.close >= prev.open) return false;

  // Vela actual alcista
  if (current.close <= current.open) return false;

  // Cuerpo actual engulle cuerpo anterior
  const prevBody = Math.abs(prev.close - prev.open);
  const currentBody = Math.abs(current.close - current.open);

  return (
    current.open < prev.close &&      // Abre debajo
    current.close > prev.open &&      // Cierra arriba
    currentBody > prevBody            // Cuerpo más grande
  );
}
```

---

## 4. Doji (Dragonfly y Gravestone)

### ¿Qué es?

Un **Doji** es una vela donde el precio de apertura y cierre son casi iguales, formando un cuerpo muy pequeño. Indica **indecisión** en el mercado. Hay dos tipos principales:

1. **Dragonfly Doji** (Libélula): Reversión alcista potencial
2. **Gravestone Doji** (Lápida): Reversión bajista potencial

### Anatomía Visual

#### Dragonfly Doji
```
DRAGONFLY DOJI (Bullish Reversal)

High ────┬──  ← Open ≈ Close (cuerpo mínimo)
         ─      Puede tener mecha superior corta
         │
         │
         │   ← Mecha inferior LARGA
         │     (rechazo de precios bajos)
         │
Low ─────┘

Características:
✓ Cuerpo muy pequeño (< 8% del rango total)
✓ Mecha inferior larga (> 50% del rango)
✓ Mecha superior corta o inexistente (< 15% del rango)
✓ Aparece en tendencia bajista
```

#### Gravestone Doji
```
GRAVESTONE DOJI (Bearish Reversal)

High ────┐
         │
         │   ← Mecha superior LARGA
         │     (rechazo de precios altos)
         │
         ─   ← Open ≈ Close (cuerpo mínimo)
Low ─────┴──   Puede tener mecha inferior corta

Características:
✓ Cuerpo muy pequeño (< 8% del rango total)
✓ Mecha superior larga (> 50% del rango)
✓ Mecha inferior corta o inexistente (< 15% del rango)
✓ Aparece en tendencia alcista
```

### Parámetros Configurables

#### 1. **maxBodyRatio** (Ratio Máximo del Cuerpo)

**Rango:** 0.0 - 0.3x
**Default:** 0.08x (8%)
**Tipo:** Slider

**Definición:** Qué tan grande puede ser el cuerpo como porcentaje del rango total de la vela.

**Fórmula:**
```javascript
bodyRatio = bodySize / totalRange

donde:
  bodySize = abs(close - open)
  totalRange = high - low
```

**Ejemplo Numérico:**
```
Vela:
├─ High: 100
├─ Close: 90.5
├─ Open: 89.5
└─ Low: 80

Cálculo:
  bodySize = |90.5 - 89.5| = 1
  totalRange = 100 - 80 = 20
  bodyRatio = 1 / 20 = 0.05 (5%)

Validación con maxBodyRatio = 0.08:
  0.05 < 0.08 → ✅ VÁLIDO (cuerpo suficientemente pequeño)
```

**Interpretación:**

| Valor | Tamaño del Cuerpo | Calidad del Doji |
|-------|------------------|------------------|
| 0.05 | ≤ 5% del rango | Doji perfecto (muy restrictivo) |
| 0.08 | ≤ 8% del rango | **Estándar** |
| 0.15 | ≤ 15% del rango | Doji débil |
| 0.30 | ≤ 30% del rango | Muy permisivo |

**Visual:**
```
maxBodyRatio = 0.05 (PERFECTO)      maxBodyRatio = 0.20 (DÉBIL)

HIGH ────┬──                        HIGH ────┬───
         ─  ← Cuerpo minúsculo              ┌┴┐  ← Cuerpo visible
         │                                  │█│
         │                                  └─┘
         │                                   │
LOW ─────┘                          LOW ─────┘

✅ DOJI PERFECTO                    ⚠️ DOJI DÉBIL
```

---

#### 2. **minLongWick** (Mecha Larga Mínima)

**Rango:** 0.0 - 1.0x
**Default:** 0.5x (50%)
**Tipo:** Slider

**Definición:** Qué tan larga debe ser la mecha principal (inferior para Dragonfly, superior para Gravestone) como porcentaje del rango total.

**Fórmula (Dragonfly):**
```javascript
longWickRatio = lowerWick / totalRange

donde:
  lowerWick = min(open, close) - low
  totalRange = high - low
```

**Ejemplo:**
```
Dragonfly Doji:
├─ High: 100
├─ Close: 90
├─ Open: 89
└─ Low: 70

Cálculo:
  lowerWick = 89 - 70 = 19
  totalRange = 100 - 70 = 30
  longWickRatio = 19 / 30 = 0.633 (63%)

Validación con minLongWick = 0.5:
  0.633 > 0.5 → ✅ VÁLIDO
```

**Interpretación:**

| Valor | Tamaño Mecha | Significado |
|-------|-------------|-------------|
| 0.4 | ≥ 40% | Permisivo |
| 0.5 | ≥ 50% | **Estándar** |
| 0.6 | ≥ 60% | Restrictivo (Doji fuerte) |
| 0.7 | ≥ 70% | Muy restrictivo |

---

#### 3. **maxShortWick** (Mecha Corta Máxima)

**Rango:** 0.0 - 1.0x
**Default:** 0.15x (15%)
**Tipo:** Slider

**Definición:** Qué tan larga puede ser la mecha secundaria (superior para Dragonfly, inferior para Gravestone) como porcentaje del rango total.

**Fórmula (Dragonfly):**
```javascript
shortWickRatio = upperWick / totalRange

donde:
  upperWick = high - max(open, close)
  totalRange = high - low
```

**Ejemplo:**
```
Dragonfly con mecha superior excesiva:
├─ High: 100
├─ Close: 90
├─ Open: 89
└─ Low: 70

Cálculo:
  upperWick = 100 - 90 = 10
  totalRange = 100 - 70 = 30
  shortWickRatio = 10 / 30 = 0.333 (33%)

Validación con maxShortWick = 0.15:
  0.333 > 0.15 → ❌ INVÁLIDO (mecha superior demasiado larga)
```

**¿Por qué importa?**
Un Dragonfly Doji debe tener mecha superior muy pequeña para ser válido. Si tiene mecha superior larga, se convierte en un patrón diferente (long-legged doji), que no es una señal clara de reversión.

---

#### 4. **debug**

Igual que en otros patrones.

---

## 5. Swing Detection (Detección de Swings)

### ¿Qué es?

Un **Swing** es un punto de reversión local en el precio (high o low local). Detectar swings ayuda a validar que el patrón de vela ocurre en un punto estructuralmente significativo.

### Anatomía Visual

```
SWING HIGH (Máximo Local)

        Vela 4 (swing high) ←─── Este es el punto más alto
           ▲                      en leftBars + rightBars
    Vela 3 │ Vela 5
      ▲    │    ▲
Vela 2│    │    │Vela 6
  ▲   │    │    │   ▲
Vela1 │    │    │   │Vela 7

  ← leftBars = 3 → ← rightBars = 3 →

Regla: Para que Vela 4 sea un Swing High:
  high[4] > high[1] AND
  high[4] > high[2] AND
  high[4] > high[3] AND
  high[4] > high[5] AND
  high[4] > high[6] AND
  high[4] > high[7]


SWING LOW (Mínimo Local)

Vela1 │    │    │   │Vela 7
  ▼   │    │    │   ▼
Vela 2│    │    │Vela 6
      ▼    │    ▼
    Vela 3 │ Vela 5
           ▼
        Vela 4 (swing low) ←─── Este es el punto más bajo

Regla: Para que Vela 4 sea un Swing Low:
  low[4] < low[1..3] AND low[4] < low[5..7]
```

### Parámetros Configurables

#### 1. **enabled** (Habilitado)

**Tipo:** Checkbox
**Default:** true

Activa/desactiva el cálculo de swings.

---

#### 2. **leftBars** (Barras a la Izquierda)

**Rango:** 1 - 30 barras
**Default:** 5
**Tipo:** Slider

**Definición:** Cuántas velas a la IZQUIERDA del candidato deben tener un high/low menor/mayor.

**Ejemplo con leftBars = 3:**
```
Candidato: Vela índice 10

Para ser Swing High, verificar:
  candle[10].high > candle[7].high  ← 3 barras atrás
  candle[10].high > candle[8].high  ← 2 barras atrás
  candle[10].high > candle[9].high  ← 1 barra atrás
```

---

#### 3. **rightBars** (Barras a la Derecha)

**Rango:** 1 - 30 barras
**Default:** 5
**Tipo:** Slider

**Definición:** Cuántas velas a la DERECHA del candidato deben tener un high/low menor/mayor.

**Ejemplo con rightBars = 3:**
```
Candidato: Vela índice 10

Para ser Swing High, verificar:
  candle[10].high > candle[11].high  ← 1 barra adelante
  candle[10].high > candle[12].high  ← 2 barras adelante
  candle[10].high > candle[13].high  ← 3 barras adelante
```

**⚠️ Nota Importante:**
Para detectar un swing en tiempo real, **debes esperar rightBars velas** después del candidato. Por eso los swings siempre se confirman con retraso.

---

#### 4. **required** (Requerido)

**Tipo:** Checkbox
**Default:** false

**Función:** Si `true`, el patrón SOLO se detecta si ocurre exactamente en un swing high/low.

**Ejemplo:**
```javascript
// Si required = true:
Hammer en swing low → ✅ VÁLIDO
Hammer NO en swing low → ❌ RECHAZADO

// Si required = false:
Hammer en swing low → ✅ VÁLIDO
Hammer NO en swing low → ✅ VÁLIDO (también acepta)
```

**Cuándo usar `required = true`:**
- Position trading (4h-1D): Quieres solo las señales más estructurales
- Baja tolerancia al riesgo
- Estrategia con pocas operaciones pero alta calidad

**Cuándo usar `required = false`:**
- Scalping (1-5m): Necesitas volumen de señales
- Quieres capturar reversiones intra-tendencia
- Estrategia activa con muchas operaciones

---

### Ajustes Recomendados por Timeframe

| Timeframe | leftBars | rightBars | required |
|-----------|----------|-----------|----------|
| 1m - 5m | 3 | 3 | false |
| 15m - 1h | 5 | 5 | false |
| 4h - 1D | 10 | 10 | true |
| Weekly | 15 | 15 | true |

**Regla general:**
Timeframe mayor = más barras para confirmar swing = señales más confiables pero menos frecuentes.

---

## 6. Tabla de Comparación Rápida

| Patrón | Dirección | Mecha Principal | Posición Cuerpo | Contexto Ideal |
|--------|-----------|----------------|----------------|----------------|
| **Hammer** | Alcista | Inferior larga | Superior | Después de bajada |
| **Shooting Star** | Bajista | Superior larga | Inferior | Después de subida |
| **Bullish Engulfing** | Alcista | N/A (2 velas) | Grande engulle pequeña | Después de bajada |
| **Bearish Engulfing** | Bajista | N/A (2 velas) | Grande engulle pequeña | Después de subida |
| **Dragonfly Doji** | Alcista | Inferior larga | Centro (cuerpo mínimo) | Después de bajada |
| **Gravestone Doji** | Bajista | Superior larga | Centro (cuerpo mínimo) | Después de subida |

---

## 7. Casos de Uso por Timeframe

### Scalping (1m - 5m)

**Configuración Recomendada:**
```yaml
Hammer/Shooting Star:
  minWickRatio: 1.2        # Más permisivo
  maxUpperWickRatio: 0.4   # Tolera más imperfección
  minBodyPosition: 0.4     # Acepta cuerpo más abajo/arriba

Doji:
  maxBodyRatio: 0.10       # Tolera cuerpo más grande
  minLongWick: 0.4         # Mecha puede ser más corta
  maxShortWick: 0.2        # Tolera mecha secundaria más larga

Swing Detection:
  leftBars: 3
  rightBars: 3
  required: false          # No exigir swing

Filters:
  minConfidence: 40%       # Umbral bajo
  requireNearLevel: false  # No validar contextos
```

**Filosofía:** Alta frecuencia de señales, filtrado manual posterior.

---

### Swing Trading (15m - 1h)

**Configuración Recomendada:**
```yaml
Hammer/Shooting Star:
  minWickRatio: 1.5        # Estándar
  maxUpperWickRatio: 0.3   # Estándar
  minBodyPosition: 0.5     # Estándar

Doji:
  maxBodyRatio: 0.08       # Estándar
  minLongWick: 0.5         # Estándar
  maxShortWick: 0.15       # Estándar

Swing Detection:
  leftBars: 5
  rightBars: 5
  required: false

Filters:
  minConfidence: 50%       # Balanceado
  requireNearLevel: true   # Validar contra VP/S&R
  volumeZScore: enabled    # Validar volumen
```

**Filosofía:** Balance entre cantidad y calidad.

---

### Position Trading (4h - 1D)

**Configuración Recomendada:**
```yaml
Hammer/Shooting Star:
  minWickRatio: 2.0        # Muy restrictivo
  maxUpperWickRatio: 0.2   # Solo mechas perfectas
  minBodyPosition: 0.6     # Cuerpo muy arriba/abajo

Doji:
  maxBodyRatio: 0.05       # Doji casi perfecto
  minLongWick: 0.6         # Mecha muy larga
  maxShortWick: 0.1        # Mecha secundaria muy corta

Swing Detection:
  leftBars: 10
  rightBars: 10
  required: true           # OBLIGATORIO estar en swing

Filters:
  minConfidence: 65%       # Umbral alto
  requireNearLevel: true   # Validar contextos
  volumeZScore: enabled
  minZScore: 1.5           # Volumen excepcional
```

**Filosofía:** Pocas señales pero muy confiables. Cada operación es significativa en capital y tiempo.

---

## Glosario de Términos

| Término | Definición |
|---------|------------|
| **Body (Cuerpo)** | Rectángulo entre open y close |
| **Wick (Mecha)** | Línea delgada entre body y high/low |
| **Upper Shadow** | Mecha superior (high - max(open, close)) |
| **Lower Shadow** | Mecha inferior (min(open, close) - low) |
| **Ratio** | Proporción matemática (X:Y o X/Y) |
| **Swing High** | Máximo local (punto de reversión bajista) |
| **Swing Low** | Mínimo local (punto de reversión alcista) |
| **Engulf** | Una vela "traga" completamente otra |
| **Rejection** | Precio rechazado (mecha larga) |
| **Indecision** | Cuerpo muy pequeño (Doji) |

---

## Recursos Adicionales

### Fórmulas de Referencia Rápida

```javascript
// Tamaños básicos
bodySize = abs(close - open)
upperWick = high - max(open, close)
lowerWick = min(open, close) - low
totalRange = high - low

// Ratios
wickRatio = wick / bodySize
bodyRatio = bodySize / totalRange
wickPercent = wick / totalRange

// Posiciones
bodyPosition = (min(open, close) - low) / totalRange
upperBodyPosition = (high - max(open, close)) / totalRange
```

### Checklist de Calibración

- [ ] Define tu timeframe principal
- [ ] Elige un preset base (scalping/swing/position)
- [ ] Ejecuta backtest con 3-6 meses de datos
- [ ] Mide: win rate, profit factor, drawdown
- [ ] Ajusta 1 parámetro a la vez
- [ ] Re-ejecuta backtest
- [ ] Compara métricas
- [ ] Itera hasta optimizar
- [ ] Valida con forward testing (paper trading)
- [ ] Implementa en real con capital reducido

---

**Versión:** 1.0
**Fecha:** 2025-12-09
**Autor:** Sistema de Trading con Indicadores - WatchlistConIndicadores
**Licencia:** Uso interno del proyecto
