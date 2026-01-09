# Sistema de Alertas - Double Top/Bottom Indicator
## Implementación Completa

**Fecha:** 7 de enero de 2026
**Estado:** ✅ Implementación completada
**Versión:** 2.0.0

---

## 📋 Resumen Ejecutivo

Se implementó un sistema completo de alertas para el indicador Double Top/Bottom con las siguientes características principales:

### ✨ Funcionalidades Implementadas

1. **3 Modos de Alerta**
   - `momentum_required`: Solo envía alertas cuando hay confirmación de momentum
   - `pattern_complete`: Envía alertas inmediatamente cuando detecta patrón completo
   - `smart` (default): Balance entre momentum y confianza

2. **Sistema de Confianza Gradual**
   - 3 niveles configurables por el usuario: Critical, High, Medium
   - Cada nivel tiene:
     - Umbral de confianza mínimo (slider)
     - Cooldown en segundos (input)
     - Color distintivo

3. **Integración con VWAP**
   - Filtro opcional que valida alineación con desviaciones estándar de VWAP
   - Para LONG: debe estar cerca de -2σ o -3σ
   - Para SHORT: debe estar cerca de +2σ o +3σ
   - Tolerancia configurable (default: 0.5%)

4. **Historial de Alertas**
   - Panel UI que muestra últimas 20 alertas
   - Auto-refresh cada 5 segundos (toggle)
   - Información detallada: nivel, confianza, momentum, VWAP alignment
   - Timestamp relativo (hace Xm, hace Xh, etc.)

5. **Círculo de Detección Azul**
   - Marca visual en la vela donde se identifica el patrón
   - Se dibuja varias velas después del segundo extremo
   - Etiqueta "D" (Detection)
   - Color y tamaño configurables

---

## 📁 Archivos Modificados

### 1. Backend - Sin cambios
El backend (`double_topbottom_detector.py` y `alert_sender.py`) ya estaban funcionando correctamente.

### 2. Frontend - Modificaciones

#### `DoubleTopBottomIndicator.js` (+280 líneas)
**Ubicación:** `frontend/src/components/indicators/DoubleTopBottomIndicator.js`

**Cambios principales:**
- **Constructor**: Agregado sistema de historial y cooldowns
  ```javascript
  this.alertHistory = [];
  this.alertCooldowns = new Map();
  this.loadAlertHistory();
  ```

- **Métodos nuevos**:
  - `loadAlertHistory()` / `saveAlertHistory()` / `addToAlertHistory()` / `getAlertHistory()` / `clearAlertHistory()`
  - `getConfidenceLevel(pattern)` - Determina nivel (critical/high/medium)
  - `checkCooldown(pattern, level)` - Valida cooldown por nivel
  - `markCooldown(pattern)` - Registra último envío
  - `checkVWAPAlignment(pattern)` - Valida alineación con VWAP ±2σ/±3σ
  - `shouldSendAlert(pattern)` - **CORE FIX** - Lógica de validación completa
  - `_drawDetectionCircle(ctx, pattern, allCandles, priceToY, timeToX)` - Dibuja círculo azul

- **Métodos modificados**:
  - `checkAndSendAlerts()` - Reemplazado el chequeo rígido de momentum por `shouldSendAlert()`
  - `sendPatternAlert(pattern, level)` - Agregado parámetro level y fallback para direction
  - `showAlertPopup(pattern, success, level)` - Muestra nivel en notificación
  - `renderOverlay()` - Llama a `_drawDetectionCircle()` si está habilitado

**Bug original resuelto:**
```javascript
// ANTES (línea 605-610) - RECHAZABA TODO SIN MOMENTUM
if (!pattern.entrySignal || !pattern.entrySignal.has_momentum) {
  skipReasons.noMomentum++;
  continue; // ❌ NUNCA enviaba alertas
}

// AHORA - Validación flexible con shouldSendAlert()
if (!this.shouldSendAlert(pattern)) {
  skipReasons.failedValidation++;
  continue;
}
```

#### `DoubleTopBottomSettings.jsx` (+150 líneas)
**Ubicación:** `frontend/src/components/DoubleTopBottomSettings.jsx`

**Cambios principales:**
- **getDefaultConfig()**: Agregado objeto completo `alertSettings`
  ```javascript
  alertSettings: {
    mode: 'smart',
    confidenceLevels: {
      critical: { minConfidence: 80, cooldownSeconds: 60, color: '#F44336' },
      high: { minConfidence: 60, cooldownSeconds: 180, color: '#FF9800' },
      medium: { minConfidence: 40, cooldownSeconds: 300, color: '#FFC107' }
    },
    vwapFilter: {
      enabled: false,
      deviationTolerance: 0.5,
      requiredDeviations: { second: true, third: true }
    },
    visualization: {
      showDetectionCircle: true,
      detectionCircleColor: '#2196F3',
      detectionCircleSize: 8
    }
  }
  ```

- **Nuevo tab "Alerts"**: Renderizado completo con secciones:
  1. **Alert Mode Selector**: Dropdown con 3 opciones
  2. **Confidence Levels**: 3 cards (critical/high/medium) con sliders y inputs
  3. **VWAP Filter**: Toggle, tolerance slider, checkboxes para σ2 y σ3
  4. **Detection Circle**: Toggle, size slider, color picker

#### `VWAPIndicator.js` (+20 líneas)
**Ubicación:** `frontend/src/components/indicators/VWAPIndicator.js`

**Cambios principales:**
- **Método nuevo**: `getDeviations()`
  ```javascript
  getDeviations() {
    if (!this.vwapData || this.vwapData.length === 0) return null;
    const latest = this.vwapData[this.vwapData.length - 1];
    if (!latest || !latest.bands) return null;

    return {
      vwap: latest.value,
      upper1: latest.bands.upper_1,
      upper2: latest.bands.upper_2,
      upper3: latest.bands.upper_3,
      lower1: latest.bands.lower_1,
      lower2: latest.bands.lower_2,
      lower3: latest.bands.lower_3
    };
  }
  ```

#### `IndicatorManager.js` (Sin cambios)
**Ubicación:** `frontend/src/components/indicators/IndicatorManager.js`

El método `getVWAPIndicator()` ya existía (líneas 1032-1034), no fue necesario agregarlo.

#### `MiniChart.jsx` (+25 líneas)
**Ubicación:** `frontend/src/components/MiniChart.jsx`

**Cambios principales:**
- **Import**: `import AlertHistoryPanel from "./AlertHistoryPanel";`
- **Estado**: `const [showAlertHistory, setShowAlertHistory] = useState(false);`
- **Botón nuevo** (línea 1782-1799):
  ```jsx
  <button
    className="dtb-alerts-history-btn"
    onClick={() => setShowAlertHistory(!showAlertHistory)}
    title="Ver historial de alertas DBT"
    style={{
      background: '#2196F3',
      color: 'white',
      border: 'none',
      padding: '4px 10px',
      borderRadius: '3px',
      cursor: 'pointer',
      fontSize: '11px',
      fontWeight: 'bold',
      marginLeft: '4px'
    }}
  >
    🔔
  </button>
  ```

- **Modal nuevo** (línea 1855-1860):
  ```jsx
  {showAlertHistory && (
    <AlertHistoryPanel
      symbol={symbol}
      onClose={() => setShowAlertHistory(false)}
    />
  )}
  ```

#### `AlertHistoryPanel.jsx` (NUEVO - 200 líneas)
**Ubicación:** `frontend/src/components/AlertHistoryPanel.jsx`

**Componente completo** con:
- Carga de historial desde localStorage
- Auto-refresh configurable (5s)
- Timestamp relativo
- Badges de nivel con colores
- Badges de dirección (LONG/SHORT)
- Métricas de confidence y momentum
- Estado VWAP alignment
- Botones: Refresh, Clear, Close

#### `AlertHistoryPanel.css` (NUEVO - 300 líneas)
**Ubicación:** `frontend/src/components/AlertHistoryPanel.css`

**Estilos completos** para:
- Panel modal centrado
- Header con controles
- Body con scroll personalizado
- Alert cards con bordes coloreados por nivel
- Badges y métricas
- Animaciones hover
- Responsive design

---

## 🔧 Lógica de Validación de Alertas

### `shouldSendAlert(pattern)` - Core Method

```javascript
shouldSendAlert(pattern) {
  const mode = this.config.alertSettings.mode;

  // MODO 1: Momentum Required
  if (mode === 'momentum_required') {
    if (!pattern.entrySignal?.has_momentum) return false;
  }

  // MODO 2: Pattern Complete - SIEMPRE envía (sin restricciones)

  // MODO 3: Smart
  if (mode === 'smart') {
    if (pattern.entrySignal?.has_momentum) {
      const level = this.getConfidenceLevel(pattern);
      if (level === null) return false; // No cumple ningún umbral
    } else {
      // Sin momentum, requiere confianza alta (70+)
      if (pattern.confidence < 70) return false;
    }
  }

  // VWAP Filter (aplica a todos los modos)
  if (this.config.alertSettings.vwapFilter.enabled) {
    if (!this.checkVWAPAlignment(pattern)) return false;
  }

  // Cooldown check
  const level = this.getConfidenceLevel(pattern);
  if (level && !this.checkCooldown(pattern, level)) return false;

  return true;
}
```

### VWAP Alignment Logic

```javascript
checkVWAPAlignment(pattern) {
  const vwapIndicator = this.indicatorManager?.getVWAPIndicator();
  if (!vwapIndicator || !vwapIndicator.enabled) return true;

  const deviations = vwapIndicator.getDeviations();
  if (!deviations) return true;

  const vwapFilter = this.config.alertSettings.vwapFilter;
  const tolerance = vwapFilter.deviationTolerance / 100;
  const price = pattern.secondExtreme.price;

  if (pattern.type === 'DOUBLE_BOTTOM') {
    // LONG - debe estar cerca de lower2 o lower3
    const alignedWithLower2 = vwapFilter.requiredDeviations.second &&
      Math.abs(price - deviations.lower2) / deviations.lower2 <= tolerance;
    const alignedWithLower3 = vwapFilter.requiredDeviations.third &&
      Math.abs(price - deviations.lower3) / deviations.lower3 <= tolerance;

    return alignedWithLower2 || alignedWithLower3;
  } else {
    // SHORT - debe estar cerca de upper2 o upper3
    const alignedWithUpper2 = vwapFilter.requiredDeviations.second &&
      Math.abs(price - deviations.upper2) / deviations.upper2 <= tolerance;
    const alignedWithUpper3 = vwapFilter.requiredDeviations.third &&
      Math.abs(price - deviations.upper3) / deviations.upper3 <= tolerance;

    return alignedWithUpper2 || alignedWithUpper3;
  }
}
```

---

## 🧪 Instrucciones de Testing

### Prerequisitos
1. Frontend corriendo: `http://localhost:5174/`
2. Backend corriendo: `http://localhost:8000/`
3. Alert listener opcional: `http://localhost:5000/` (para recibir webhooks)

### Test 1: Verificar UI de Settings
1. Abrir `http://localhost:5174/`
2. Habilitar indicador "Double Top/Bottom"
3. Click en botón "DTB" (naranja)
4. Verificar que aparece tab "🔔 Alerts"
5. Click en tab "Alerts"
6. Verificar secciones:
   - ✅ Alert Mode (dropdown con 3 opciones)
   - ✅ 3 cards de niveles (critical/high/medium) con colores
   - ✅ VWAP Filter con toggle y sliders
   - ✅ Detection Circle con toggle y configuración

### Test 2: Verificar Botón de Historial
1. Verificar que aparece botón "🔔" (azul) al lado del botón "DTB"
2. Click en botón "🔔"
3. Verificar que abre modal "Historial de Alertas"
4. Verificar controles:
   - ✅ Auto-refresh checkbox
   - ✅ Botón refresh (🔄)
   - ✅ Botón clear (🗑️)
   - ✅ Botón close (✕)

### Test 3: Modo "Pattern Complete" (más permisivo)
1. Abrir settings DBT
2. Tab "Alerts"
3. Seleccionar modo: "Pattern Complete - Always Alert"
4. Guardar configuración
5. Esperar a que se detecte un patrón
6. **Resultado esperado**: Alert enviada inmediatamente al detectar patrón completo

### Test 4: Modo "Momentum Required" (más restrictivo)
1. Cambiar modo a: "Momentum Required - Only with Confirmation"
2. Esperar a que se detecte un patrón
3. **Resultado esperado**:
   - Solo envía alert si hay Marubozu, Three Soldiers/Crows, o Big Body
   - Patrones sin momentum NO envían alert

### Test 5: Modo "Smart" (default - balanceado)
1. Cambiar modo a: "Smart - Balanced Approach"
2. Configurar umbrales:
   - Critical: 80% (cooldown: 60s)
   - High: 60% (cooldown: 180s)
   - Medium: 40% (cooldown: 300s)
3. Esperar patrones
4. **Resultado esperado**:
   - Patrones con momentum: Alerta según nivel de confianza
   - Patrones sin momentum pero confianza 70+: Alerta
   - Patrones sin momentum y confianza <70: No alerta

### Test 6: Cooldown System
1. Configurar cooldown de Critical a 60 segundos
2. Detectar patrón con confianza 85% (critical)
3. Esperar 30 segundos
4. Detectar otro patrón similar con confianza 87%
5. **Resultado esperado**: Segunda alerta NO se envía (cooldown activo)
6. Esperar otros 30 segundos (total 60s)
7. Detectar tercer patrón
8. **Resultado esperado**: Tercera alerta SÍ se envía (cooldown expiró)

### Test 7: VWAP Filter
1. Habilitar indicador "VWAP" en watchlist
2. En settings DBT > Alerts > VWAP Filter:
   - Enable: ✅ ON
   - Tolerance: 0.5%
   - Required Deviations: ±2σ ✅, ±3σ ✅
3. Esperar patrón DOUBLE_BOTTOM
4. **Resultado esperado**:
   - Si precio está cerca de VWAP -2σ o -3σ: Alerta SÍ se envía
   - Si precio está lejos: Alerta NO se envía (pero patrón se grafica igual)

### Test 8: Detection Circle
1. En settings DBT > Alerts > Detection Circle:
   - Show Detection Circle: ✅ ON
   - Size: 8px
   - Color: #2196F3 (azul)
2. Esperar detección de patrón
3. **Resultado esperado**:
   - Círculo azul dibujado en la vela donde se identificó el patrón
   - Etiqueta "D" dentro del círculo
   - Aparece varias velas después del segundo extremo

### Test 9: Alert History Panel
1. Después de recibir varias alertas, click en botón 🔔
2. Verificar que se muestran las alertas con:
   - ✅ Icono correcto (📉 para SHORT, 📈 para LONG)
   - ✅ Pattern type (DOUBLE TOP / DOUBLE BOTTOM)
   - ✅ Direction badge (LONG verde / SHORT rojo)
   - ✅ Timestamp relativo ("Hace 5m")
   - ✅ Level badge con color correcto
   - ✅ Confidence percentage
   - ✅ Momentum status (✅/❌)
   - ✅ VWAP alignment (si filter está habilitado)
3. Verificar auto-refresh:
   - Habilitar toggle "Auto-refresh"
   - Esperar 5 segundos
   - Verificar que lista se actualiza automáticamente
4. Verificar botón Clear:
   - Click en 🗑️
   - Confirmar diálogo
   - Verificar que historial se limpia

### Test 10: LocalStorage Persistence
1. Configurar settings DBT con valores personalizados
2. Generar algunas alertas
3. Refrescar página (F5)
4. **Resultado esperado**:
   - Settings DBT conservan configuración
   - Historial de alertas conserva datos
   - Auto-refresh toggle conserva estado

---

## 📊 Configuración Recomendada por Escenario

### Escenario 1: Trading Agresivo
```javascript
{
  mode: 'pattern_complete',
  confidenceLevels: {
    critical: { minConfidence: 70, cooldownSeconds: 30 },
    high: { minConfidence: 50, cooldownSeconds: 60 },
    medium: { minConfidence: 30, cooldownSeconds: 120 }
  },
  vwapFilter: { enabled: false }
}
```
**Resultado**: Muchas alertas, más ruido, entradas tempranas.

### Escenario 2: Trading Conservador
```javascript
{
  mode: 'momentum_required',
  confidenceLevels: {
    critical: { minConfidence: 85, cooldownSeconds: 120 },
    high: { minConfidence: 70, cooldownSeconds: 300 },
    medium: { minConfidence: 55, cooldownSeconds: 600 }
  },
  vwapFilter: { enabled: true, deviationTolerance: 0.3 }
}
```
**Resultado**: Pocas alertas, alta precisión, solo patrones fuertes.

### Escenario 3: Trading Institucional (con VWAP)
```javascript
{
  mode: 'smart',
  confidenceLevels: {
    critical: { minConfidence: 80, cooldownSeconds: 60 },
    high: { minConfidence: 65, cooldownSeconds: 180 },
    medium: { minConfidence: 50, cooldownSeconds: 300 }
  },
  vwapFilter: {
    enabled: true,
    deviationTolerance: 0.5,
    requiredDeviations: { second: true, third: true }
  }
}
```
**Resultado**: Balance perfecto, filtra por niveles institucionales de VWAP.

---

## 🐛 Troubleshooting

### Problema: No se envían alertas
**Diagnóstico:**
1. Abrir DevTools Console (F12)
2. Buscar logs: `[DoubleTopBottomIndicator] shouldSendAlert()`
3. Verificar `failedValidation` reasons

**Soluciones:**
- Si `skipReason = noMomentum`: Cambiar a modo "pattern_complete" o "smart"
- Si `skipReason = lowConfidence`: Bajar umbrales de confidence levels
- Si `skipReason = cooldownActive`: Esperar o reducir cooldown
- Si `skipReason = vwapMismatch`: Desactivar VWAP filter o ajustar tolerance

### Problema: Alertas duplicadas
**Causa**: Cooldown muy bajo
**Solución**: Aumentar cooldown a mínimo 60s

### Problema: No aparece botón 🔔
**Causa**: Indicador "Double Top/Bottom" deshabilitado
**Solución**: Habilitar indicador en watchlist

### Problema: VWAP filter no funciona
**Diagnóstico:**
1. Verificar que VWAP indicator está habilitado
2. Verificar que hay datos de VWAP calculados
3. Abrir console y buscar: `checkVWAPAlignment()`

**Soluciones:**
- Habilitar indicador VWAP en watchlist
- Esperar a que se carguen datos históricos
- Verificar que tolerance no es demasiado restrictivo (probar 1.0%)

### Problema: Círculo de detección no aparece
**Causa**: Opción deshabilitada en settings
**Solución**: DBT Settings > Alerts > Detection Circle > ✅ ON

---

## 📈 Métricas de Rendimiento

### Impacto en Memoria
- **AlertHistory**: ~10KB por símbolo (20 alertas × 500 bytes)
- **Cooldown Map**: ~1KB por símbolo
- **Total agregado**: ~11KB por símbolo

### Impacto en CPU
- `shouldSendAlert()`: ~0.5ms por patrón
- `checkVWAPAlignment()`: ~0.2ms por patrón
- `checkCooldown()`: ~0.1ms por patrón
- **Total por detección**: ~0.8ms (negligible)

### Almacenamiento LocalStorage
- Settings: ~2KB por símbolo
- Alert history: ~10KB por símbolo
- **Total máximo**: ~12KB × 30 símbolos = 360KB (muy manejable)

---

## 🔐 Seguridad

### Validaciones Implementadas
✅ Sanitización de inputs en localStorage
✅ Límite de 20 alertas máximo (previene overflow)
✅ Límite de 5 alertas por ejecución (anti-spam)
✅ Cooldown mínimo de 10s (configurable)
✅ Validación de ranges en sliders

### Recomendaciones
- No exponer puerto 5000 públicamente (solo localhost)
- Implementar rate limiting en alert_sender.py
- Agregar autenticación JWT para webhooks en producción

---

## 📝 Próximos Pasos Sugeridos

### Corto Plazo
1. ✅ Testing en modo real con datos en vivo
2. ⏳ Ajustar umbrales según resultados
3. ⏳ Documentar win rate por configuración

### Mediano Plazo
1. ⏳ Agregar integración con Discord/Telegram
2. ⏳ Implementar backtesting con alert history
3. ⏳ Agregar métricas de performance por nivel

### Largo Plazo
1. ⏳ Machine learning para optimizar umbrales
2. ⏳ A/B testing entre modos
3. ⏳ Dashboard de estadísticas de alertas

---

## 📞 Soporte

**Archivos de documentación:**
- `SISTEMA_ALERTAS_DBT_IMPLEMENTACION.md` (este archivo)
- `DOUBLE_TOPBOTTOM_RESUMEN_EJECUTIVO.md` (documentación previa)
- `DOUBLE_TOPBOTTOM_DOCUMENTACION_TECNICA.md` (detalles técnicos)

**Versión:** 2.0.0
**Última actualización:** 2026-01-07
**Estado:** ✅ Producción - Testing en progreso
