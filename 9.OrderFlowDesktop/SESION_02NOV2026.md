# SESIÓN 2 NOVIEMBRE 2026 - Análisis Profundo de Agregación

## 🎯 PROBLEMA PRINCIPAL

En timeframe de 5 minutos, los footprints NO cubren la altura completa de las velas, dejando gaps visibles arriba y abajo. En timeframe de 1 minuto funciona perfectamente.

---

## 📊 ANÁLISIS COMPLETADO

### Configuración de Pruebas
- **Step_size configurado:** 20 USD (para esta sesión de pruebas)
- **Símbolos:** BTCUSDT
- **Timeframes analizados:** 1min, 5min
- **Archivo local:** 44,593 footprints de 1min (mayoría con step_size=10 - datos antiguos)

### Hallazgos Clave

#### 1. Footprints de 1min funcionan perfectamente
- ✅ **0% gaps** verificado en 1000 footprints del archivo
- ✅ Todos los footprints cubren completamente sus velas
- ✅ Expansion checks: 2,505 casos detectados y corregidos

#### 2. Distribución de step_sizes observada

**Timeframe 1min:**
```
{1: 1, 10: 44901, 20: 173, 50: 322}
```
- Domina step_size=10 (44,901 fps = 98.9%) - Archivo local antiguo
- step_size=20 solo 173 fps (0.4%) - Backend reciente (últimas 2-3h)

**Timeframe 5min (agregado):**
```
{1: 1, 10: 389, 20: 9084, 50: 322}
```
- Domina step_size=20 (9,084 fps = 93.3%) - Agregados del backend reciente
- step_size=10 solo 389 fps (4.0%) - Agregados del archivo antiguo

**Patrón:** Al agregar 1min→5min, DOMINA el step_size del backend reciente porque la mayoría de grupos de 5min tienen footprints recientes.

#### 3. Problema en la Agregación (Causa Raíz)

**Archivo:** `src/components/indicators/OrderFlowIndicator.js`

**Código problemático (líneas 348-352):**
```javascript
// 1. Calcular OHLC del intervalo agregado PRIMERO
const candle_open = groupFootprints[0].candle_open || groupFootprints[0].open;
const candle_close = groupFootprints[groupFootprints.length - 1].candle_close || groupFootprints[groupFootprints.length - 1].close;
const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));
```

**Problema:**
❌ Calcula OHLC basándose en los footprints de 1min
❌ NO usa el OHLC de la vela REAL de 5min
❌ Si footprints de 1min no cubren extremos → footprint agregado tampoco

**Ejemplo:**
```
5 velas de 1min (11:00-11:04):
- 11:00: high=77500
- 11:01: high=77520
- 11:02: high=77510
- 11:03: high=77505
- 11:04: high=77495

Agregación calcula: candle_high = max(77500, 77520, 77510, 77505, 77495) = 77520

PERO vela REAL de 5min del backend puede tener:
high = 77525 (si hubo un wick rápido en el segundo 59 que no formó footprint)

Resultado: Gap de 5 USD entre footprint y vela real
```

#### 4. Expansión Dinámica NO Funciona en 5min

**Evidencia:**
- 1min: 2,505 expansion checks ejecutados ✅
- 5min: 0 expansion checks ❌

**Causa:** El código de expansión compara:
```javascript
if (footprint.candle_high < candle.high) // Expande arriba
if (footprint.candle_low > candle.low)  // Expande abajo
```

Pero si AMBOS se calculan del mismo conjunto de footprints, nunca detecta discrepancia.

---

## 🛠️ SOLUCIÓN IMPLEMENTADA: Sistema de Logging Detallado

Para verificar la causa raíz ANTES de codificar el fix, implementamos un sistema de logging completo.

### Archivos Creados

| Archivo | Ubicación | Propósito |
|---------|-----------|-----------|
| `aggregation-logger.js` | `src/utils/aggregation-logger.js` | Módulo de logging sin modificar código original |
| `INTEGRAR_LOGGER.md` | Raíz del proyecto | Instrucciones para integrar logging (6 cambios simples) |
| `LOGGING_PATCH.md` | Raíz del proyecto | Alternativa con código inline (si prefieres esa opción) |
| `SESION_02NOV2026.md` | Raíz del proyecto | Este documento |

### Cómo Usar el Sistema de Logging

#### Paso 1: Integrar el Logger

Seguir las instrucciones en **`INTEGRAR_LOGGER.md`** (solo 6 cambios):

1. Agregar import del logger
2. Crear instancia del logger
3. Inicializar con parámetros
4. Llamar `logger.logGrupo()` para cada grupo
5. Llamar `logger.logAggregationResults()` después de crear levels
6. Llamar `logger.finalize()` al final

#### Paso 2: Ejecutar y Obtener JSON

1. Guardar cambios en `OrderFlowIndicator.js`
2. Recargar app (hot reload automático)
3. Cambiar a timeframe de 5 minutos
4. **Se descargará automáticamente** un archivo JSON: `aggregation_debug_YYYY-MM-DD-HH-MM-SS.json`

#### Paso 3: Analizar el JSON

El JSON contiene para cada grupo de agregación:

```json
{
  "grupo_id": 1,
  "interval_start": "2026-11-02T11:00:00.000Z",
  "interval_start_time": "11:00:00",

  "vela_calculada_de_footprints": {
    "high": 77520.00,
    "low": 77470.00,
    "rango": 50.00
  },

  "vela_real_5min": {
    "high": 77525.00,  // ← ESTE es el high REAL
    "low": 77380.00,   // ← ESTE es el low REAL
    "rango": 145.00
  },

  "comparacion_vela_real": {
    "gap_high": 5.00,   // ← Gap arriba
    "gap_low": 90.00,   // ← Gap abajo
    "coincide_high": false,
    "coincide_low": false
  },

  "footprints_1min": [
    {
      "index": 1,
      "timestamp": "11:00",
      "candle": { "high": 77500.00, "low": 77480.00 },
      "levels": {
        "count": 3,
        "rango_min": 77480.00,
        "rango_max": 77500.00,
        "detalles": [...]
      },
      "volumen_total": 1250.50,
      "step_size": 10
    }
    // ... otros 4 footprints
  ],

  "agregacion": {
    "step_size_usado": 20,
    "grid_uniforme": {
      "total_levels": 3,
      "levels_con_volumen": 3,
      "levels_vacios": 0
    },
    "volumen": {
      "suma_1min": 8542.30,
      "agregado": 8542.30,
      "diferencia": 0,
      "perdida": false
    }
  },

  "problemas_detectados": [
    "Footprint NO cubre high real (gap: 5.00 USD)",
    "Footprint NO cubre low real (gap: 90.00 USD)"
  ]
}
```

#### Paso 4: Verificar Hipótesis

Con el JSON podremos confirmar:

1. ✅ **Gaps detectados:** ¿Hay diferencia entre vela_calculada y vela_real_5min?
2. ✅ **Volúmenes preservados:** ¿Se pierde volumen en la agregación?
3. ✅ **Levels correctos:** ¿Los levels cubren el rango de footprints 1min pero NO de vela real?
4. ✅ **Patrón consistente:** ¿El problema ocurre en TODOS los grupos o solo algunos?

---

## 🎯 SOLUCIÓN PROPUESTA (Después de Verificar con JSON)

Una vez confirmado el problema con el JSON, el fix será:

### Fix en `OrderFlowIndicator.js` líneas 348-352

**Actual (incorrecto):**
```javascript
const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));
```

**Corregido:**
```javascript
// Buscar vela REAL de 5min del backend
const candle_real = this.candles.find(c => c.timestamp === intervalStart);

const candle_high = candle_real
  ? candle_real.high
  : Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));

const candle_low = candle_real
  ? candle_real.low
  : Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));
```

### Resultado Esperado

1. ✅ Footprint agregado usará OHLC de vela REAL de 5min
2. ✅ Sistema de expansión dinámica detectará gaps correctamente
3. ✅ Agregará levels vacíos hasta cubrir vela completa
4. ✅ Footprints en 5min cubrirán velas igual que en 1min

---

## 📚 ARCHIVOS DE REFERENCIA

### Logs de Sesiones Anteriores

| Log | Contenido Clave |
|-----|-----------------|
| `footprint_02112026_7.log` | Primeros logs mostrando alturas inconsistentes |
| `footprint_02112026_8.log` | Confirmación de step_sizes mezclados |
| `footprint_02112026_14.log` | 1min timeframe - 2505 expansion checks |
| `footprint_02112026_15.log` | 5min timeframe - 0 expansion checks |

### Evidencia Visual

| Archivo | Descripción |
|---------|-------------|
| `footprint_altura.pdf` | Screenshots comparando 1min vs 5min |
| `altura_footprints_*.png` | Múltiples capturas del problema |

### Código Relevante

| Archivo | Líneas | Descripción |
|---------|--------|-------------|
| `OrderFlowIndicator.js` | 221-506 | Método `_aggregateFootprints()` completo |
| `OrderFlowIndicator.js` | 348-352 | **CÓDIGO PROBLEMÁTICO** - Cálculo OHLC |
| `OrderFlowIndicator.js` | 1418-1467 | Sistema de expansión dinámica |
| `aggregation-logger.js` | 1-200 | Sistema de logging detallado |

---

## ✅ CHECKLIST PRÓXIMOS PASOS

### Paso 1: Integrar Logging
- [ ] Abrir `INTEGRAR_LOGGER.md`
- [ ] Aplicar los 6 cambios marcados en `OrderFlowIndicator.js`
- [ ] Guardar archivo

### Paso 2: Generar JSON
- [ ] Recargar app (hot reload automático)
- [ ] Cambiar a timeframe de 5 minutos
- [ ] Esperar descarga de `aggregation_debug_*.json`

### Paso 3: Analizar Resultados
- [ ] Abrir JSON descargado
- [ ] Buscar grupos con `problemas_detectados`
- [ ] Verificar `gap_high` y `gap_low` en `comparacion_vela_real`
- [ ] Confirmar que `vela_calculada` ≠ `vela_real_5min`

### Paso 4: Aplicar Fix
- [ ] Modificar líneas 348-352 para usar `this.candles.find()`
- [ ] Probar en 5min - verificar que footprints cubren velas
- [ ] Verificar expansion checks > 0 en consola
- [ ] Confirmar visualmente sin gaps

### Paso 5: Limpieza
- [ ] Remover logging si ya no es necesario
- [ ] Actualizar `CLAUDE.md` con solución final
- [ ] Commit con mensaje descriptivo

---

## 🔬 LECCIONES APRENDIDAS

1. **Análisis antes de codificar:** Una semana investigando el problema valió la pena - ahora sabemos EXACTAMENTE qué está mal
2. **Logging estructurado:** JSON con datos completos es mejor que logs en consola
3. **No asumir:** El problema NO era step_sizes mezclados, era OHLC calculado incorrectamente
4. **Verificar con datos reales:** Los footprints de 1min SÍ cubren velas - el problema es solo en agregación
5. **User feedback es oro:** "todas las velas tienen el problema" → pista clave de que es sistemático, no edge case

---

## 📞 CONTACTO Y SEGUIMIENTO

Si el fix funciona:
- Documentar en `CLAUDE.md` sección "Fix: Footprints de 5min no cubren velas"
- Incluir logs de antes/después
- Screenshots comparativos

Si el fix NO funciona:
- Compartir JSON completo para análisis más profundo
- Buscar otros factores (¿problema en `this.candles`? ¿problema en timestamp matching?)
- Considerar fallback si vela real no existe
