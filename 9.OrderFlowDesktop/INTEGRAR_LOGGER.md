# Integración del Logger de Agregación

## Instrucciones Simples (2 cambios)

### PASO 1: Agregar import al inicio del archivo

**Archivo:** `src/components/indicators/OrderFlowIndicator.js`

**Línea ~6 (después de los otros imports):**

```javascript
import { createAggregationLogger } from '../utils/aggregation-logger.js';
```

---

### PASO 2: Usar el logger en `_aggregateFootprints()`

**Buscar (línea ~322):**
```javascript
    console.log(`[OrderFlow] [${this.symbol}] 📊 Total footprints 1min: ${footprints1min.length}, con step_size: ${allStepSizes.length}, sin step_size: ${footprints1min.length - allStepSizes.length}`);

    // Agrupar por intervalo
    const groups = new Map();
```

**Reemplazar con:**
```javascript
    console.log(`[OrderFlow] [${this.symbol}] 📊 Total footprints 1min: ${footprints1min.length}, con step_size: ${allStepSizes.length}, sin step_size: ${footprints1min.length - allStepSizes.length}`);

    // ========== LOGGING DETALLADO ==========
    const logger = createAggregationLogger();
    // ========================================

    // Agrupar por intervalo
    const groups = new Map();
```

---

**Buscar (línea ~337, después de agrupar):**
```javascript
    }

    // Agregar cada grupo
    const aggregated = [];

    for (const [intervalStart, groupFootprints] of groups) {
```

**Reemplazar con:**
```javascript
    }

    // ========== INIT LOGGER ==========
    logger.init(this.symbol, targetInterval, globalStepSize, source, footprints1min.length, groups.size);
    // =================================

    // Agregar cada grupo
    const aggregated = [];

    for (const [intervalStart, groupFootprints] of groups) {
```

---

**Buscar (línea ~351, después de calcular OHLC):**
```javascript
      const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
      const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));

      // 2. ✅ USAR step_size GLOBAL (calculado una sola vez al inicio)
```

**Insertar ANTES del comentario "// 2. ✅ USAR step_size GLOBAL":**
```javascript
      // ========== LOG GRUPO ==========
      const { grupoData, vol_sum_1min } = logger.logGrupo(
        intervalStart,
        groupFootprints,
        candle_high,
        candle_low,
        candle_open,
        candle_close,
        this.candles
      );
      // ================================

      // 2. ✅ USAR step_size GLOBAL (calculado una sola vez al inicio)
```

---

**Buscar (línea ~412, después de crear levels):**
```javascript
      const levels = Array.from(uniformLevels.values())
        .sort((a, b) => b.price - a.price);

      // 🔍 DEBUG: Verificar estructura del nivel agregado uniforme (solo primer footprint)
```

**Insertar ANTES del comentario "// 🔍 DEBUG":**
```javascript
      // ========== LOG AGREGACION ==========
      logger.logAggregationResults(grupoData, vol_sum_1min, levels, step_size, groups.size);
      // ====================================

      // 🔍 DEBUG: Verificar estructura del nivel agregado uniforme (solo primer footprint)
```

---

**Buscar (línea ~505, antes del return):**
```javascript
    console.log(`[OrderFlow] [${this.symbol}] 🔍 DISTRIBUCIÓN STEP_SIZES AGREGADOS:`, aggregatedDistribution);

    return aggregated;
```

**Reemplazar con:**
```javascript
    console.log(`[OrderFlow] [${this.symbol}] 🔍 DISTRIBUCIÓN STEP_SIZES AGREGADOS:`, aggregatedDistribution);

    // ========== GUARDAR JSON ==========
    logger.finalize();
    // ==================================

    return aggregated;
```

---

## ¡Listo!

Después de aplicar estos 6 cambios:

1. Guardar el archivo
2. El dev server se recargará automáticamente
3. Cambiar a timeframe de 5 minutos en la app
4. Se descargará automáticamente un JSON con el análisis completo
5. Revisar el JSON para identificar la causa raíz

Los cambios son mínimos y no afectan la lógica existente, solo agregan logging.
