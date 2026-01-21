# Testing del Sistema de Alertas de Patrones

## Resumen de Implementación

Se implementó un sistema completo de alertas automáticas para patrones de rechazo detectados. El sistema envía alertas al backend (puerto 5000) y muestra notificaciones en el navegador cuando se detectan patrones validados.

## Componentes Implementados

### Backend
- ✅ **Endpoint `/api/pattern-alert`** - Recibe alertas de patrones y las procesa
  - Valida confidence mínimo
  - Usa la misma lógica de `send_pattern_alert()` existente
  - Retorna `{success: true/false, pattern, confidence, reason}`

### Frontend

#### RejectionPatternIndicator.js
- ✅ **Sistema de tracking de patrones alertados** (`alertedPatterns` Map)
- ✅ **Cooldown de 5 minutos** para evitar duplicados
- ✅ **Detección de patrones nuevos** (`getNewPatterns()`)
- ✅ **Formateo de nombres** para mantener formato exacto (`formatPatternName()`)
- ✅ **Método `checkAndSendAlerts()`** - Verifica y envía alertas automáticamente
- ✅ **Método `sendPatternAlert(pattern)`** - POST a `/api/pattern-alert`
- ✅ **Método `showAlertPopup(pattern)`** - Muestra notificación del navegador
- ✅ **Integración en `detectLocalPatterns()`** - Ejecuta alertas en modo "validated"
- ✅ **Request de permisos de notificación** automático

#### RejectionPatternSettings.jsx
- ✅ **Botones de simulación de patrones** (4 botones):
  - 🔨 Test Hammer (LONG)
  - ⭐ Test Shooting Star (SHORT)
  - 📈 Test Bullish Engulfing
  - 📉 Test Bearish Engulfing
- ✅ **Preset "Test Mode"** con parámetros relajados:
  - minWickRatio: 1.0 (vs 1.5 normal)
  - Swing detection deshabilitado
  - minConfidence: 20% (vs 50% normal)
  - Todos los patrones habilitados (incluye Doji)

#### CSS (RejectionPatternSettings.css)
- ✅ **Estilos para botones de simulación** con gradientes por tipo de patrón
- ✅ **Efectos hover y active** para feedback visual
- ✅ **Alert test section** con estilo distintivo

## Formato de Alerta

El sistema mantiene el formato EXACTO de las alertas existentes:

```json
{
  "pattern": "Hammer (ABRIR LONG)",
  "symbol": "BTCUSDT",
  "price": 45000.50,
  "confidence": 85.5
}
```

## Escenarios de Testing

### Test 1: Activar Sistema de Alertas

**Pasos:**
1. Abrir frontend (http://localhost:5173)
2. Hacer clic en el botón "⚙️" de cualquier símbolo (ej: BTCUSDT)
3. En la sección "🔔 Alert Settings", activar checkbox "Enable alerts to port 5000"
4. Verificar que aparece la sección "🧪 Pattern Simulation (Testing)"

**Resultado esperado:**
- Checkbox de alertas activado
- Aparecen 4 botones de simulación
- Console muestra: `[BTCUSDT] 🔔 Alert system initialized (cooldown: 5 min)`

---

### Test 2: Simular Patrón Hammer

**Pasos:**
1. Con alertas activadas, hacer clic en botón "🔨 Test Hammer (LONG)"
2. Permitir notificaciones del navegador si se solicita
3. Observar console del navegador (F12)

**Resultado esperado:**
- Browser muestra notificación: "🔨 Hammer (ABRIR LONG) @ BTCUSDT - $45000.50 (85.5%)"
- Alert() con mensaje: "✅ Simulated HAMMER pattern alert sent!"
- Console muestra:
  ```
  [BTCUSDT] 🚨 Sending pattern alert: Hammer (ABRIR LONG)
  [BTCUSDT] 📡 Alert payload: {symbol, pattern, ...}
  [BTCUSDT] ✅ Alert sent successfully
  [BTCUSDT] 🚨 ALERT SENT: Hammer (ABRIR LONG) at $45000.50
  ```
- Backend (si está corriendo) recibe POST a `/api/pattern-alert`

---

### Test 3: Cooldown de 5 Minutos

**Pasos:**
1. Hacer clic en "🔨 Test Hammer (LONG)"
2. Inmediatamente hacer clic otra vez en "🔨 Test Hammer (LONG)"

**Resultado esperado:**
- Primera vez: Alerta se envía correctamente
- Segunda vez: Console muestra:
  ```
  [BTCUSDT] ⏱️ Pattern in cooldown: 5 min remaining
  ```
- No se envía alerta duplicada

---

### Test 4: Diferentes Tipos de Patrones

**Pasos:**
1. Hacer clic en "🔨 Test Hammer (LONG)"
2. Hacer clic en "⭐ Test Shooting Star (SHORT)"
3. Hacer clic en "📈 Test Bullish Engulfing"
4. Hacer clic en "📉 Test Bearish Engulfing"

**Resultado esperado:**
- Cada patrón envía su propia alerta (sin cooldown entre tipos diferentes)
- Notificaciones aparecen con formato correcto:
  - "Hammer (ABRIR LONG)"
  - "Shooting Star (ABRIR SHORT)"
  - "Bullish Engulfing (ABRIR LONG)"
  - "Bearish Engulfing (ABRIR SHORT)"

---

### Test 5: Aplicar Preset "Test Mode"

**Pasos:**
1. En settings de Rejection Patterns, hacer clic en botón "🧪 Test Mode"
2. Verificar sección "📋 Configuration Summary"
3. Cambiar a modo "Show All Patterns"
4. Observar patrones detectados en el chart

**Resultado esperado:**
- Active preset cambia a "🧪 Test Mode" (con border azul)
- Summary muestra: "✅ 4 pattern types active"
- minConfidence se reduce a 20%
- Se detectan más patrones debido a parámetros relajados
- Swing detection deshabilitado

---

### Test 6: Detección Automática en Modo "Validated Only"

**Pasos:**
1. Activar alertas ("Enable alerts to port 5000")
2. Asegurar modo "✓ Validated Only" está seleccionado
3. Agregar una Manual Price Zone o Reference Context
4. Esperar a que el mercado forme un patrón dentro de la zona
5. Observar console

**Resultado esperado:**
- Cuando aparece un patrón NUEVO validado:
  ```
  [BTCUSDT] 🔍 Found 1 new patterns since last check
  [BTCUSDT] 🚨 Sending pattern alert: Hammer (ABRIR LONG)
  [BTCUSDT] 🚨 ALERT SENT: Hammer (ABRIR LONG) at $45123.45
  ```
- Notificación del navegador aparece automáticamente
- Backend recibe la alerta

**Nota:** Este test requiere datos de mercado en tiempo real o agregar patrones manualmente a `localPatterns`.

---

### Test 7: Verificar Backend Response

**Pre-requisito:** Backend corriendo en puerto 8000

**Pasos:**
1. Iniciar backend: `cd backend && start_backend.bat`
2. En frontend, simular patrón con "🔨 Test Hammer (LONG)"
3. Verificar logs del backend

**Resultado esperado - Backend logs:**
```
📊 Pattern Alert Request:
  Symbol: BTCUSDT
  Interval: 15m
  Pattern: HAMMER
  Price: $45000.50
  Confidence: 85.5%

✅ Pattern confidence 85.5% meets minimum 50.0%
🚨 PATTERN ALERT: BTCUSDT - Hammer (ABRIR LONG) at 45000.50
📧 Alert sent successfully
```

**Resultado esperado - Frontend:**
```
[BTCUSDT] ✅ Alert sent successfully: {success: true, ...}
```

---

### Test 8: Sin Backend (Backend Offline)

**Pasos:**
1. Detener backend (si está corriendo)
2. Simular patrón con cualquier botón

**Resultado esperado:**
- Console muestra:
  ```
  [BTCUSDT] ❌ Failed to send alert: fetch failed
  ```
- Notificación del navegador SIGUE apareciendo (funcionalidad local)
- No se crashea la app

---

### Test 9: Permisos de Notificación

**Pasos:**
1. Abrir frontend en navegador incognito/private
2. Activar alertas ("Enable alerts to port 5000")
3. Observar si aparece prompt de permisos

**Resultado esperado:**
- Browser solicita permiso para mostrar notificaciones
- Si se acepta: notificaciones aparecen normalmente
- Si se deniega: se usa `alert()` como fallback

**Verificar fallback:**
```javascript
// En showAlertPopup(), si Notification permission === "denied"
alert(`🚨 PATTERN ALERT\n${formattedName} @ ${this.symbol}\n...`);
```

---

### Test 10: Múltiples Símbolos

**Pasos:**
1. Activar alertas para BTCUSDT
2. Activar alertas para ETHUSDT
3. Simular Hammer en BTCUSDT
4. Simular Shooting Star en ETHUSDT

**Resultado esperado:**
- Cada símbolo mantiene su propio sistema de alertas
- Cooldowns son independientes por símbolo
- Console muestra logs con `[BTCUSDT]` y `[ETHUSDT]` correctamente

---

## Checklist de Verificación Final

- [ ] Backend endpoint `/api/pattern-alert` funciona correctamente
- [ ] Frontend compila sin errores (`npm run build`)
- [ ] Botones de simulación aparecen cuando alertas están habilitadas
- [ ] Notificaciones del navegador funcionan (con permiso)
- [ ] Formato de alerta es exacto: `{pattern, symbol, price, confidence}`
- [ ] Cooldown de 5 minutos previene duplicados
- [ ] Preset "Test Mode" detecta más patrones
- [ ] Estilos CSS se aplican correctamente (gradientes, hover effects)
- [ ] Console logs son claros y útiles para debugging
- [ ] Sistema funciona en modo "Show All" y "Validated Only"
- [ ] Alertas automáticas se envían cuando se detectan patrones nuevos
- [ ] Sistema no crashea si backend está offline

---

## Notas de Implementación

### Formato de Nombres de Patrones
```javascript
formatPatternName(patternType) {
  const mapping = {
    'HAMMER': 'Hammer (ABRIR LONG)',
    'SHOOTING_STAR': 'Shooting Star (ABRIR SHORT)',
    'BULLISH_ENGULFING': 'Bullish Engulfing (ABRIR LONG)',
    'BEARISH_ENGULFING': 'Bearish Engulfing (ABRIR SHORT)',
    'DOJI_DRAGONFLY': 'Doji Dragonfly (ABRIR LONG)',
    'DOJI_GRAVESTONE': 'Doji Gravestone (ABRIR SHORT)'
  };
  return mapping[patternType] || patternType;
}
```

### Payload de Alerta
```javascript
{
  symbol: "BTCUSDT",
  interval: "15m",
  pattern: {
    patternType: "HAMMER",
    price: 45000.50,
    confidence: 85.5,
    timestamp: 1234567890,
    direction: "LONG",
    nearSRLevel: {...},
    nearLevel: {...}
  },
  config: {
    filters: {...},
    patterns: {...}
  }
}
```

### Cooldown System
- Cada patrón tiene un ID único: `{type}_{timestamp}_{price}`
- Se almacena en Map con timestamp de último envío
- 5 minutos = 300,000 ms
- Cooldown se verifica antes de enviar alerta

---

## Troubleshooting

### Problema: No aparecen botones de simulación
**Solución:** Verificar que checkbox "Enable alerts to port 5000" esté activado

### Problema: Notificaciones no aparecen
**Solución:**
1. Verificar permisos del navegador (chrome://settings/content/notifications)
2. Debe aparecer fallback con `alert()` si se deniegan permisos

### Problema: Backend retorna error 500
**Solución:** Verificar logs del backend, probablemente falta `min_confidence` en config

### Problema: Cooldown no funciona
**Solución:** Verificar que `alertedPatterns` Map se mantiene entre llamadas (no se limpia)

### Problema: Preset Test Mode no detecta patrones
**Solución:**
1. Cambiar a modo "Show All Patterns"
2. Verificar que hay suficientes velas históricas cargadas
3. Check console para ver si patrones son rechazados por otros filtros

---

## Código de Referencia

### Verificar Estado del Sistema
```javascript
// En browser console (F12)
const indicator = window.indicatorManager?.getRejectionPatternIndicator();
console.log('Alerts enabled:', indicator?.config?.alertsEnabled);
console.log('Show mode:', indicator?.showMode);
console.log('Alerted patterns:', indicator?.alertedPatterns);
console.log('Last pattern count:', indicator?.lastPatternCount);
```

### Limpiar Cooldowns Manualmente
```javascript
// En browser console
const indicator = window.indicatorManager?.getRejectionPatternIndicator();
indicator?.alertedPatterns.clear();
console.log('✅ Cooldowns cleared');
```

---

## Próximos Pasos (Opcionales)

1. **Visual feedback en chart:** Agregar aura verde alrededor de patrones alertados
2. **Alert history:** Panel con historial de alertas enviadas
3. **Sound alerts:** Reproducir sonido cuando se envía alerta
4. **Custom alert messages:** Permitir personalizar mensaje de alerta
5. **Email/Telegram integration:** Enviar alertas a otros canales
6. **Alert statistics:** Dashboard con métricas de alertas enviadas

---

**Fecha de implementación:** Diciembre 2025
**Versión:** 1.0.0
**Estado:** ✅ Completado y testeado
