# Guía de Testing - Indicadores VWAP, Fibonacci y Continuation Patterns

## Pre-requisitos

### Backend
```bash
cd backend
.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

✅ **Verificar:** Backend debe iniciar sin errores
✅ **Verificar:** Terminal debe mostrar `[DATA]`, `[OK]`, `[ERROR]` (NO emojis)

### Frontend
```bash
cd frontend
npm run dev
```

✅ **Verificar:** Frontend debe iniciar en `http://localhost:5173`
✅ **Verificar:** No errores de compilación

---

## Test Suite 1: Visualización de Indicadores

### Test 1.1: VWAP se muestra correctamente
**Pasos:**
1. Abrir aplicación en navegador
2. Marcar checkbox "VWAP"
3. Esperar 2-3 segundos

**Resultado Esperado:**
- ✅ Línea naranja/amarilla visible en todos los gráficos
- ✅ Console muestra: `[BTCUSDT] ✅ VWAP loaded: XXXX points`
- ✅ Bandas de desviación visibles (líneas punteadas)

**Console Check:**
```
[BTCUSDT] [DATA] VWAP: type=session, interval=60, days=7
[BTCUSDT] [OK] VWAP loaded: 2160 points
```

### Test 1.2: Fibonacci se muestra correctamente
**Pasos:**
1. Marcar checkbox "Fibonacci"
2. Esperar 2-3 segundos

**Resultado Esperado:**
- ✅ Líneas horizontales azules visibles
- ✅ Etiquetas con niveles (ej: "Fib 61.8% (42350.25)")
- ✅ Console muestra: `[BTCUSDT] ✅ Fibonacci loaded: uptrend`

**Console Check:**
```
[BTCUSDT] [DATA] FIBONACCI: interval=60, days=7, auto_detect=true
[BTCUSDT] [OK] Fibonacci loaded: uptrend
```

### Test 1.3: Continuation Patterns se muestran
**Pasos:**
1. Marcar checkbox "Continuation Patterns"
2. Esperar 2-3 segundos

**Resultado Esperado:**
- ✅ Iconos de patrones visibles (🚩, 🚀, 💪, etc.)
- ✅ Etiquetas con nombres de patrones
- ✅ Badges de confianza (ej: "75%")
- ✅ Console muestra: `[BTCUSDT] [OK] Pattern Analysis Complete: XX patterns detected`

**Console Check:**
```
[BTCUSDT] [SEARCH] PATTERN ANALYSIS: interval=60, days=7
[BTCUSDT] Analyzing 2160 candles for patterns
[BTCUSDT] Step 1: Analyzing trend...
[BTCUSDT] Trend: uptrend (strength: 75.5)
[BTCUSDT] Step 2a: Fetching VWAP levels...
[BTCUSDT] VWAP levels: 7
[BTCUSDT] Step 3: Detecting patterns...
[BTCUSDT] [OK] Pattern Analysis Complete: 25 patterns detected
```

---

## Test Suite 2: Zoom y Scroll Sincronización

### Test 2.1: VWAP se mueve con precio al hacer zoom
**Pasos:**
1. Activar VWAP
2. Usar scroll del mouse sobre un gráfico para hacer zoom
3. Observar movimiento de VWAP

**Resultado Esperado:**
- ✅ VWAP permanece alineada con precio
- ✅ Bandas se mueven correctamente
- ✅ No hay "saltos" o desplazamientos

### Test 2.2: Fibonacci se mueve con precio al hacer scroll
**Pasos:**
1. Activar Fibonacci
2. Hacer scroll horizontal con Shift+Scroll
3. Observar niveles de Fibonacci

**Resultado Esperado:**
- ✅ Niveles permanecen en mismos precios
- ✅ Etiquetas se mueven con las líneas
- ✅ No hay desfase

### Test 2.3: Continuation Patterns se mueven correctamente
**Pasos:**
1. Activar Continuation Patterns
2. Hacer zoom y scroll
3. Observar iconos de patrones

**Resultado Esperado:**
- ✅ Iconos permanecen sobre las velas correctas
- ✅ Etiquetas se mantienen alineadas
- ✅ Badges de confianza siguen los iconos

---

## Test Suite 3: Modales de Configuración

### Test 3.1: Modal VWAP abre correctamente
**Pasos:**
1. Activar indicador VWAP
2. Hacer clic en botón "VW" (naranja) en header del gráfico
3. Observar modal

**Resultado Esperado:**
- ✅ Modal aparece sobre el gráfico
- ✅ Título: "Configuración VWAP - BTCUSDT"
- ✅ Todos los controles visibles
- ✅ Valores actuales cargados correctamente

**Controles a Verificar:**
- Tipo de VWAP (select)
- Hora de reinicio (number input)
- Mostrar bandas (checkbox)
- Ajuste crypto (checkbox)
- Botón "Configuración avanzada"
- Multiplicadores de bandas (3 inputs)
- Selector de color

### Test 3.2: Modal Fibonacci abre correctamente
**Pasos:**
1. Activar indicador Fibonacci
2. Hacer clic en botón "FIB" (azul)
3. Observar modal

**Resultado Esperado:**
- ✅ Modal aparece correctamente
- ✅ Título: "Configuración Fibonacci - BTCUSDT"
- ✅ Auto-detect checkbox marcado por defecto
- ✅ Lookback = 50
- ✅ Mostrar retracement marcado
- ✅ Mostrar extension desmarcado

**Controles a Verificar:**
- Auto-detectar (checkbox)
- Lookback (number)
- Mostrar retracements (checkbox)
- Mostrar extensions (checkbox)
- Posición etiquetas (select)
- Color picker
- Botón avanzado
- 5 niveles de retroceso editables
- 5 niveles de extensión editables

### Test 3.3: Modal Continuation Patterns abre correctamente
**Pasos:**
1. Activar indicador Continuation Patterns
2. Hacer clic en botón "CP" (verde)
3. Observar modal

**Resultado Esperado:**
- ✅ Modal aparece correctamente
- ✅ Título: "Configuración Continuation Patterns - BTCUSDT"
- ✅ 4 checkboxes de tipos de patrones
- ✅ Slider de confianza mínima
- ✅ Controles de visualización

**Controles a Verificar:**
- Continuation (checkbox, marcado)
- Trend Start (checkbox, marcado)
- Momentum (checkbox, marcado)
- Reversal (checkbox, desmarcado)
- Confianza mínima (number, default 60)
- Mostrar etiquetas (checkbox, marcado)
- Mostrar confianza (checkbox, marcado)
- Tamaño icono (number, default 16)
- Botón "Level Sources"

---

## Test Suite 4: Cambios de Configuración

### Test 4.1: Cambiar tipo de VWAP
**Pasos:**
1. Abrir modal VWAP
2. Cambiar "Tipo de VWAP" a "Rolling"
3. Ingresar período = 50
4. Cerrar modal
5. Observar gráfico

**Resultado Esperado:**
- ✅ VWAP se recalcula
- ✅ Console muestra: `[BTCUSDT] Updated VWAP config`
- ✅ Nueva línea VWAP visible

**Verificación Console:**
```
[BTCUSDT] [DATA] VWAP: type=rolling, interval=60, days=7
```

### Test 4.2: Ocultar bandas de VWAP
**Pasos:**
1. Abrir modal VWAP
2. Desmarcar "Mostrar bandas de desviación"
3. Cerrar modal

**Resultado Esperado:**
- ✅ Bandas desaparecen inmediatamente
- ✅ Solo VWAP principal visible

### Test 4.3: Cambiar niveles de Fibonacci
**Pasos:**
1. Abrir modal Fibonacci
2. Hacer clic en "Configuración avanzada"
3. Cambiar Nivel 1 de 0.236 a 0.25
4. Cerrar modal

**Resultado Esperado:**
- ✅ Nuevo nivel aparece en 25%
- ✅ Niveles se recalculan
- ✅ Etiquetas actualizadas

### Test 4.4: Filtrar patrones por tipo
**Pasos:**
1. Abrir modal Continuation Patterns
2. Desmarcar "Momentum"
3. Desmarcar "Trend Start"
4. Dejar solo "Continuation" marcado
5. Cerrar modal

**Resultado Esperado:**
- ✅ Solo patrones de continuación visibles (🚩)
- ✅ Otros iconos desaparecen
- ✅ Cambio inmediato sin refresh

### Test 4.5: Aumentar confianza mínima
**Pasos:**
1. Abrir modal Continuation Patterns
2. Cambiar confianza mínima de 60 a 80
3. Cerrar modal

**Resultado Esperado:**
- ✅ Menos patrones visibles (solo los de alta confianza)
- ✅ Todos los patrones mostrados tienen ≥80% confianza

---

## Test Suite 5: Modo Fullscreen

### Test 5.1: Modales funcionan en fullscreen
**Pasos:**
1. Hacer clic en botón de fullscreen de un chart
2. Activar VWAP, Fibonacci y CP
3. Hacer clic en botón "VW"

**Resultado Esperado:**
- ✅ Modal VWAP aparece sobre chart fullscreen
- ✅ Funcionalidad idéntica a modo mini
- ✅ Cerrar modal funciona correctamente

### Test 5.2: Cambios persisten al salir de fullscreen
**Pasos:**
1. En fullscreen, cambiar config de VWAP
2. Salir de fullscreen
3. Observar chart en modo mini

**Resultado Esperado:**
- ✅ Cambios de configuración persisten
- ✅ VWAP mantiene nueva configuración

---

## Test Suite 6: Edge Cases

### Test 6.1: Abrir múltiples modales simultáneamente
**Pasos:**
1. Abrir modal VWAP en BTCUSDT
2. SIN CERRAR, hacer clic en "FIB" de ETHUSDT

**Resultado Esperado:**
- ✅ Modal VWAP se cierra automáticamente
- ✅ Modal Fibonacci de ETHUSDT se abre
- ✅ No hay overlay duplicados

### Test 6.2: Modal con indicador desactivado
**Pasos:**
1. Activar VWAP
2. Abrir modal VWAP
3. Desmarcar checkbox "VWAP" en sidebar
4. Observar modal

**Resultado Esperado:**
- ✅ Modal sigue abierto
- ✅ Cambios se aplican correctamente
- ✅ Al cerrar modal, VWAP sigue desactivado

### Test 6.3: Cambiar timeframe con modales abiertos
**Pasos:**
1. Abrir modal Fibonacci
2. Cambiar timeframe de 1h a 4h en sidebar
3. Observar modal y gráficos

**Resultado Esperado:**
- ✅ Modal se cierra automáticamente (o actualiza símbolo)
- ✅ Datos se recargan con nuevo timeframe
- ✅ Fibonacci se recalcula correctamente

---

## Test Suite 7: Errores y Validación

### Test 7.1: Backend caído
**Pasos:**
1. Detener backend (Ctrl+C)
2. Activar Continuation Patterns
3. Observar console

**Resultado Esperado:**
- ✅ Console muestra: `[BTCUSDT] ❌ Pattern fetch error: Failed to fetch`
- ✅ Mensaje de error NO bloquea aplicación
- ✅ Otros indicadores siguen funcionando

### Test 7.2: Datos insuficientes
**Pasos:**
1. Cambiar timeframe a 1m
2. Seleccionar days = 1 (muy pocos datos)
3. Activar Continuation Patterns

**Resultado Esperado:**
- ✅ Pocos o ningún patrón detectado
- ✅ Console muestra advertencia
- ✅ No hay crash

### Test 7.3: Input inválido en modal
**Pasos:**
1. Abrir modal Fibonacci
2. En lookback, ingresar "abc"
3. Intentar cerrar modal

**Resultado Esperado:**
- ✅ Input rechaza texto no numérico
- ✅ Valor se resetea a anterior válido
- ✅ No se guardan valores inválidos

---

## Checklist de Verificación Final

### Funcionalidad Básica
- [ ] VWAP se visualiza correctamente
- [ ] Fibonacci se visualiza correctamente
- [ ] Continuation Patterns se visualizan correctamente
- [ ] Console no muestra errores CORS
- [ ] Console no muestra errores de serialización

### Sincronización
- [ ] VWAP se mueve con zoom
- [ ] VWAP se mueve con scroll
- [ ] Fibonacci se mueve con zoom
- [ ] Fibonacci se mueve con scroll
- [ ] Patterns se mueven con zoom/scroll

### Modales
- [ ] Modal VWAP abre y cierra correctamente
- [ ] Modal Fibonacci abre y cierra correctamente
- [ ] Modal CP abre y cierra correctamente
- [ ] Modales funcionan en fullscreen
- [ ] Configuraciones se aplican inmediatamente

### Cambios de Config
- [ ] Cambiar tipo de VWAP funciona
- [ ] Ocultar bandas funciona
- [ ] Cambiar niveles Fibonacci funciona
- [ ] Filtrar patrones funciona
- [ ] Cambiar confianza mínima funciona

### Edge Cases
- [ ] Múltiples modales se manejan correctamente
- [ ] Backend caído no bloquea app
- [ ] Inputs inválidos se rechazan
- [ ] Cambio de timeframe funciona

### Performance
- [ ] Carga inicial < 5 segundos
- [ ] Cambios de config se aplican < 1 segundo
- [ ] Zoom/scroll fluido sin lag
- [ ] No memory leaks después de 10 minutos de uso

---

## Problemas Conocidos y Soluciones

### Problema: "Pattern fetch error"
**Causa:** Backend no está corriendo o numpy no instalado
**Solución:**
```bash
cd backend
.venv\Scripts\python.exe -m pip install numpy
.venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000
```

### Problema: "Indicators desfasados con zoom"
**Causa:** Versión anterior sin fix de priceToY
**Solución:** Hacer git pull para obtener última versión

### Problema: "Modal no se cierra"
**Causa:** Click fuera del modal no funciona
**Solución:** Usar botón "✕" en esquina superior derecha

---

## Reporte de Bugs

Si encuentras un bug, reportar con:
1. **Síntomas:** Qué viste que no funcionó
2. **Pasos para reproducir:** Cómo llegaste al bug
3. **Console logs:** Copiar mensajes relevantes
4. **Screenshot:** Si es visual
5. **Ambiente:** Navegador, OS, timeframe usado

**Ejemplo:**
```
BUG: VWAP no aparece en TRXUSDT

Pasos:
1. Seleccionar timeframe 15m
2. Marcar checkbox VWAP
3. Observar gráfico de TRXUSDT

Resultado: No hay línea VWAP visible

Console:
[TRXUSDT] [DATA] VWAP: type=session, interval=15, days=15
[TRXUSDT] ❌ VWAP error: Insufficient data

Screenshot: [adjuntar]

Navegador: Chrome 120.0
OS: Windows 11
```

---

¡Testing completo! ✅
