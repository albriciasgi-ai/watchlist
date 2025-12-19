# 📖 Guía del Rejection Pattern Detector

## 🎯 Dos Modos de Operación

El Rejection Pattern Detector tiene **dos modos distintos** de operación que pueden confundirse fácilmente:

### 🔵 Modo "Show All" (Detección Local)
**Cómo activarlo:** Selector "Show All" en la parte superior del settings modal

**Características:**
- Detección 100% en el navegador (JavaScript)
- Usa **Level Sources** para obtener niveles de referencia
- Procesa los datos **en tiempo real** usando los indicadores activos en la aplicación
- **No requiere** tener Reference Contexts configurados
- Más rápido y responsive

**Fuentes de niveles disponibles (Level Sources):**
- ✅ Fixed Range Profiles (POC/VAH/VAL)
- ✅ Volume Clusters
- ✅ Support & Resistance
- ✅ Range Detection
- ✅ Manual Horizontal Lines
- ✅ Manual Price Zones

**Importante:** Estos indicadores deben estar **activos y visibles** en la aplicación para que el detector los use. Si tienes "Support & Resistance" desactivado en la UI, el detector no podrá usar esos niveles.

---

### 🟢 Modo "Validated Only" (Detección Backend)
**Cómo activarlo:** Selector "Validated Only" en la parte superior del settings modal

**Características:**
- Detección en el **servidor Python** (backend)
- Usa **Reference Contexts** que has guardado previamente
- Los contextos son "snapshots" estáticos de Volume Profiles o Ranges específicos
- Requiere tener al menos 1 Reference Context configurado
- Más lento (hace request al servidor)

**Cómo funcionan Reference Contexts:**
1. Click en "➕ Add Context" en la sección "Reference Contexts for Validation"
2. El sistema carga los Volume Profiles y Ranges disponibles
3. Seleccionas uno específico (ej: "Range A: 50000-52000")
4. Ese contexto queda **guardado como referencia estática**
5. El backend validará los patrones contra ese contexto específico

**Importante:** Los Reference Contexts son snapshots **fijos** en el tiempo. Si el precio se mueve y creas un nuevo Range, necesitas agregarlo manualmente como contexto.

---

## 🆚 Comparación Directa

| Aspecto | Show All (Local) | Validated Only (Backend) |
|---------|------------------|--------------------------|
| **Ubicación** | Navegador (JS) | Servidor (Python) |
| **Configuración** | Level Sources | Reference Contexts |
| **Indicadores** | Usa indicadores activos en tiempo real | Usa snapshots guardados |
| **Velocidad** | Muy rápido | Más lento (HTTP request) |
| **Datos dinámicos** | ✅ Sí, actualiza con cada vela | ❌ No, usa datos estáticos |
| **Zonas Manuales** | ✅ Soportadas directamente | ✅ Se convierten automáticamente a contextos |
| **Requiere backend** | ❌ No | ✅ Sí |

---

## ✅ SOLUCIONES A PROBLEMAS COMUNES

### Problema: "Level Sources no muestra niveles de otros indicadores"

**Causa:** Los indicadores (Support & Resistance, Range Detection, etc.) NO están activos en la aplicación.

**Solución:**
1. Ve al panel principal de la watchlist
2. Click en el ícono de settings del gráfico (⚙️)
3. Activa los indicadores que quieres usar:
   - Support & Resistance
   - Range Detection
   - Fixed Range Profiles
4. Verifica que los indicadores calculen y muestren datos en el gráfico
5. Ahora el Rejection Pattern Detector podrá usar esos niveles

**Logging útil:** Abre la consola del navegador (F12 → Console) y verás:
```
[BTCUSDT] 🔍 getAllReferenceLevels() called with sources: {fixedRanges: true, supportResistance: true...}
[BTCUSDT]   🔹 Checking Support & Resistance...
[BTCUSDT]     ✅ S&R Indicator found - Supports: 5, Resistances: 3
```

Si ves `⚠️ S&R Indicator not found or disabled`, significa que el indicador no está activo.

---

### Problema: "Las zonas manuales no aparecen en modo Validated"

**Causa:** Este problema ya está CORREGIDO en la última versión.

**Cómo funciona ahora:**
- Las zonas manuales se convierten **automáticamente** en Reference Contexts tipo "manual_zone"
- El backend las procesa y extrae 3 niveles: ZONE_TOP, ZONE_MIDDLE, ZONE_BOTTOM
- No necesitas hacer nada extra, simplemente crea las zonas en la UI

**Verificación:** En la consola verás:
```
[BTCUSDT] 🔧 Built 3 total contexts (0 regular + 3 manual zones)
📊 [BTCUSDT] Extracted 9 reference levels from 3 active contexts
  ✅ Manual Zone 'Resistencia Fuerte': 50000.00 - 51000.00 (3 levels)
```

---

### Problema: "No aparecen patrones en modo Validated"

**Causas posibles:**
1. No tienes Reference Contexts configurados
2. Los patrones están fuera del rango de proximidad configurado
3. La dirección de señal está filtrando los patrones

**Solución:**
1. Verifica que tengas al menos 1 Reference Context O 1 zona manual creada
2. Revisa el "Proximity Percent" en Filters (debe ser ≥ 1.0%)
3. Verifica que "Signal Direction Filter" no esté filtrando los patrones que buscas
4. Mira la consola para ver cuántos niveles se extrajeron

---

## 🎨 Manual Price Zones - Uso Avanzado

Las zonas manuales funcionan **en ambos modos**:

### En modo "Show All":
- Se usan directamente como niveles de referencia
- Se extraen del config y procesan localmente
- Aparecen visualizadas en el gráfico con fondo semi-transparente

### En modo "Validated Only":
- Se convierten automáticamente a Reference Contexts tipo "manual_zone"
- Se envían al backend con la request
- El backend extrae 3 niveles: top, middle, bottom
- Los patrones se validan contra esos niveles

### Ejemplo de zona bien configurada:
```javascript
{
  name: "Resistencia Principal",
  minPrice: 50000,
  maxPrice: 51000,
  signalDirection: "SHORT",  // Solo patrones bearish
  color: "#FF5722",
  enabled: true
}
```

**Resultado:** Solo mostrará patrones bajistas (Shooting Star, Engulfing Bearish) dentro o cerca de esa zona.

---

## 🔍 Debugging con Console Logs

Ahora el sistema tiene **logging exhaustivo** para debugging. Abre la consola (F12) y verás:

```javascript
// Al detectar patrones localmente
[BTCUSDT] 🔍 getAllReferenceLevels() called with sources: {...}
[BTCUSDT] 📍 Current price: 50500
[BTCUSDT]   🔹 Checking VP Dynamic...
[BTCUSDT]     ⚠️ VP Dynamic not available or not calculated
[BTCUSDT]   🔹 Checking Fixed Range Profiles (2 ranges)...
[BTCUSDT]     ✅ Fixed Ranges: added 6 levels
[BTCUSDT]   🔹 Checking Support & Resistance...
[BTCUSDT]     ✅ S&R Indicator found - Supports: 3, Resistances: 2
[BTCUSDT]   🔹 Checking Manual Price Zones...
[BTCUSDT]     ✅ Found 1 enabled zones (1 total)
[BTCUSDT] 📊 getAllReferenceLevels() result:
  ✅ Total levels: 11 (2 highs, 3 lows, 6 pivots)

// Al detectar en modo validated
[BTCUSDT] 🔧 Built 3 total contexts (0 regular + 3 manual zones)
[BTCUSDT] 📊 Fetching patterns with 3 reference contexts: ["manual_zone", "manual_zone", "manual_zone"]
[BTCUSDT] ✅ Loaded 5 validated rejection patterns

// Backend Python
📊 [BTCUSDT] Extracted 9 reference levels from 3 active contexts
  ✅ Manual Zone 'Zona Alta': 51000.00 - 52000.00 (3 levels)
```

Este logging te permite ver **exactamente** qué está pasando en cada paso.

---

## 💡 Recomendaciones

### Para trading en tiempo real:
✅ Usa **Show All** con Level Sources
- Más rápido
- Datos en tiempo real
- Responde inmediatamente a nuevas velas

### Para análisis histórico:
✅ Usa **Validated Only** con Reference Contexts
- Validación consistente contra niveles específicos
- Útil para backtesting
- Resultados reproducibles

### Para zonas personalizadas:
✅ Usa **Manual Price Zones**
- Funcionan en ambos modos
- Override de dirección por zona
- Visualización en el gráfico

---

## 🚨 Troubleshooting Rápido

| Síntoma | Causa | Solución |
|---------|-------|----------|
| No aparecen patrones en "Show All" | Ningún Level Source tiene niveles | Activa indicadores en la UI principal |
| No aparecen patrones en "Validated" | No hay Reference Contexts | Agrega contextos o crea zonas manuales |
| Support & Resistance no funciona | Indicador desactivado | Actívalo en settings del gráfico |
| Solo patrones LONG/SHORT aparecen | Signal Direction filter activo | Cambia a "BOTH" |
| Zonas no visibles en gráfico | Zonas deshabilitadas | Marca checkbox en cada zona |
| Backend devuelve 0 patrones | Proximidad muy baja | Aumenta "Proximity Percent" a 2-3% |

---

## 📝 Changelog - Mejoras Implementadas

### ✅ Corregido
- Bug crítico: Support & Resistance ahora funciona correctamente en modo "Show All"
- Zonas manuales ahora funcionan en modo "Validated Only"
- Volume Profile Dinámico deshabilitado por defecto (solo Fixed Ranges activo)

### ✅ Nuevo
- Filtro de dirección de señales global (LONG/SHORT/BOTH)
- Filtro de dirección por nivel (override individual en cada zona)
- Zonas manuales de precio con visualización en gráfico
- Logging exhaustivo para debugging
- Documentación completa
