# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a cryptocurrency trading platform watchlist application with advanced Volume Profile visualization. The system displays real-time cryptocurrency prices with technical indicators including Volume Delta, CVD (Cumulative Volume Delta), and dynamic/fixed Volume Profile analysis.

**Stack:**
- Frontend: React 18 + Vite (development), uPlot (charting)
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)

---

## 🚨 ESTADO ACTUAL - SESIÓN OCTUBRE 22, 2026

### Problema en Curso: Descarga de Datos de Backtesting

**Síntomas:**
- Frontend muestra: "❌ Fecha muy reciente. Los datos terminan el 19/5/2023"
- Backend no muestra mensajes de descarga después del startup
- IndexedDB del navegador tiene datos antiguos (mayo 2023)

**Causa Raíz Identificada:**
1. **Dos procesos del backend** corriendo simultáneamente (PIDs 16516 y 12084) en puerto 9000 → conflictos de peticiones
2. **Caché de navegador** con código JavaScript antiguo que no ejecuta los fixes aplicados
3. **IndexedDB** con datos corruptos de mayo 2023 que pasan validaciones antiguas

### Fixes Aplicados en Esta Sesión (NO PROBADOS AÚN)

#### 1. Backend: Sistema de Reintentos para Errores de Bybit

**Archivo:** `backend/main.py` líneas 2153-2195

**Problema:** Bybit retornaba errores temporales `"svc error: Get kline failed"` que detenían la descarga:
- 1m: solo 33,000 de 1,051,200 velas (3%)
- 5m: solo 89,000 de 525,600 velas (17%)

**Solución:**
```python
# Sistema de reintentos (máximo 3 intentos)
max_retries = 3
retry_count = 0

while retry_count < max_retries and not success:
    try:
        r = await client.get(url)
        data = r.json()

        if "Get kline failed" in error_msg or "svc error" in error_msg:
            retry_count += 1
            if retry_count < max_retries:
                print(f"[RETRY {symbol}] Error temporal - Reintento {retry_count}/{max_retries}")
                await asyncio.sleep(2)  # Espera 2s antes de reintentar
                continue
```

#### 2. Backend: Aumento de Límite de Requests

**Archivo:** `backend/main.py` línea 2150

**ANTES:**
```python
max_requests = min(600, (total_candles_needed // 1000) + 10)
# Para 1m: min(600, 1061) = 600 → solo 600,000 velas
```

**DESPUÉS:**
```python
max_requests = min(1200, (total_candles_needed // 1000) + 10)
# Para 1m: min(1200, 1061) = 1061 → todas las 1,051,200 velas
```

#### 3. Frontend: Descarga de TODOS los Timeframes

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` línea 899

**ANTES:**
```javascript
data = await loadBacktestingData(symbol, false, activeTimeframe);
// Solo descargaba 1 timeframe (ej: solo 15m)
```

**DESPUÉS:**
```javascript
data = await loadBacktestingData(symbol, false, null);
// Descarga todos los timeframes (1m, 5m, 15m, 1h, 4h)
```

#### 4. Frontend: Validación de Datos Recientes

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` líneas 812-835

**Problema:** Aceptaba caché con datos antiguos de 2023 porque tenían >30 días de datos

**Solución:**
```javascript
// Nueva validación: rechazar si última vela es más antigua de 30 días
const lastCandleAge = now - lastCandle.timestamp;
const lastCandleAgeDays = lastCandleAge / (1000 * 60 * 60 * 24);
const maxAllowedAgeDays = 30;
const hasRecentData = lastCandleAgeDays <= maxAllowedAgeDays;

if (!hasRecentData) {
  console.log(`[BacktestingApp] ❌ Cache con datos MUY ANTIGUOS (última vela: ${lastCandleAgeDays.toFixed(1)} días atrás)`);
  console.log(`[BacktestingApp] Forzando descarga completa del servidor...`);
  // No usar el cache
}
```

### Plan de Resolución (DESPUÉS DE REINICIAR PC)

1. **Reiniciar PC** → Mata procesos duplicados del backend
2. **Iniciar backend** → `cd backend && start_backend.bat`
3. **Iniciar frontend** → `cd frontend && npm run dev`
4. **Limpiar IndexedDB** → Ejecutar script en consola del navegador:
   ```javascript
   (async () => {
     const req = indexedDB.deleteDatabase('BacktestingDataDB');
     req.onsuccess = () => console.log('✅ IndexedDB eliminado');
   })();
   ```
5. **Recargar página** → F5
6. **Iniciar backtesting** → BTCUSDT, fecha 2026-10-01

### Archivos Creados para Referencia

- `frontend/CLEAR_CACHE.js` - Script completo para limpiar caché del navegador
- `SOLUCION_FINAL.md` - Instrucciones detalladas paso a paso

### Verificación de Éxito

**En consola del navegador:**
```
[BacktestingApp] ❌ No hay caché válido para 15m
[BacktestingApp] Cargando datos para BTCUSDT [todos]...
```

**En backend (DEBE APARECER):**
```
[BACKTESTING] ===== Procesando 1m (730 días) =====
[BACKTESTING] BTCUSDT @ 1m - Necesitamos 1051200 velas
[BACKTESTING] Permitiendo hasta 1061 requests
INFO:httpx:HTTP Request: GET https://api.bybit.com/v5/market/kline...
```

Si el backend NO muestra mensajes después de "Iniciar Backtesting":
- Verificar que solo hay 1 proceso en puerto 9000: `netstat -ano | findstr :9000`
- Si hay 2 procesos, matarlos: `taskkill /F /IM python.exe`

### Tiempo Estimado de Descarga (Primera Vez)

- 1m: ~8.8 minutos (1061 requests × 0.5s)
- 5m: ~4.4 minutos (526 requests × 0.5s)
- 15m: ~1.5 minutos (176 requests × 0.5s)
- 1h: ~22 segundos (44 requests × 0.5s)
- 4h: ~6 segundos (11 requests × 0.5s)

**Total:** ~15-20 minutos

---

## 🆕 FIX CRÍTICO: Sistema de Caché Permanente (Octubre 2026) ✅ RESUELTO

### Problema Original

La aplicación estaba rechazando el caché de backtesting en cada inicio, forzando descargas completas de 5 años de datos desde Bybit que tardaban **más de 30 minutos**. Esto hacía la app inviable para uso diario.

### Causa Raíz

El sistema tenía **3 validaciones incorrectas** que rechazaban cachés perfectamente válidos:

1. **Frontend - Validación de 80% muy estricta** (BacktestingApp.jsx:800-810)
   - Comparaba velas del caché contra el máximo absoluto configurado (1825 días)
   - Aunque el usuario necesitara solo 2 años de datos, rechazaba cachés con menos de 4 años (80% de 5 años)
   - Ejemplo: caché con 87,000 velas (perfectamente válido) vs esperadas 140,160 velas → ❌ RECHAZADO

2. **Frontend - Endpoint inexistente `/api/backtesting/update`** (BacktestingApp.jsx:816)
   - Llamaba a un endpoint que no existe en el backend
   - El error disparaba fallback que descargaba TODO desde cero
   - Aunque el caché fuera válido, se re-descargaba completo

3. **Backend - Validación de 80% duplicada** (main.py:2342-2370)
   - El backend también tenía validación estricta del 80%
   - Si el frontend pedía datos, el backend rechazaba su propio caché por la misma razón

### Solución Implementada

#### 1. Frontend: Validación Simplificada (BacktestingApp.jsx)

**ANTES:**
```javascript
// ❌ Rechazaba caché con menos del 80% del máximo configurado (5 años)
const expectedCandles = Math.floor((1825 * 24 * 60) / intervalMin);
const hasEnoughData = actualCandles >= expectedCandles * 0.8;
```

**DESPUÉS:**
```javascript
// ✅ Solo valida que tenga mínimo 30 días (suficiente para backtesting)
const minDaysRequired = 30;
const minCandlesRequired = Math.floor((minDaysRequired * 24 * 60) / intervalMin);
const hasMinimumData = actualCandles >= minCandlesRequired;

// Logging detallado:
console.log(`Cobertura: ${coveragePct}% del máximo configurado (${expectedDaysConfig} días)`);
console.log(`Mínimo requerido: ${minCandlesRequired} velas (${minDaysRequired} días)`);
console.log(`Tiene datos suficientes: ${hasMinimumData ? '✅ SÍ' : '❌ NO'}`);
```

#### 2. Frontend: Actualización Incremental Optimizada

**ANTES:**
```javascript
// ❌ Siempre llamaba a endpoint inexistente, causaba re-descarga completa
const updateResult = await checkForUpdates(symbol); // Endpoint no existe
```

**DESPUÉS:**
```javascript
// ✅ Solo verifica actualizaciones si caché > 1 hora
if (cacheAgeHours > 1.0) {
  const backendResponse = await fetch(`${API_BASE_URL}/api/backtesting/bulk-data/${symbol}`);
  // Compara último timestamp y solo actualiza si hay velas nuevas
  if (backendLastCandle.timestamp > lastCandle.timestamp) {
    console.log(`🆕 Hay ${backendCandles.length - actualCandles} velas nuevas`);
    // Actualiza caché completo (incluye velas nuevas + histórico existente)
  }
} else {
  // ⚡ Caché < 1h: usa directamente sin verificar (modo ultra-rápido)
  console.log(`⚡ Cache reciente (${cacheAgeHours.toFixed(1)}h) - usando directamente`);
}
```

#### 3. Backend: Validación Inteligente + Expansión Incremental Hacia Atrás (main.py)

**ANTES:**
```python
# ❌ Rechazaba caché con menos del 80% del máximo configurado
if actual_candles < expected_candles * 0.8:
    print(f"{tf_name}: NECESITA EXPANSION")
    cached_data = None  # Descarta TODO el caché → RE-DESCARGA 5 AÑOS COMPLETOS
```

**DESPUÉS:**
```python
# ✅ Sistema de 3 niveles inteligente:

# Nivel 1: < 30 días → Descarga completa (inevitable)
if actual_candles < min_candles_required:
    print(f"{tf_name}: muy pocas velas - DESCARGA COMPLETA")
    needs_full_download = True

# Nivel 2: 30 días - 95% del máximo → EXPANSIÓN HACIA ATRÁS (NUEVO ⭐)
elif actual_candles < expected_candles_config * 0.95:
    candles_missing = expected_candles_config - actual_candles
    days_missing = int((candles_missing * interval_minutes) / (24 * 60)) + 5

    print(f"{tf_name}: {coverage_pct:.1f}% - EXPANSIÓN HACIA ATRÁS")
    print(f"  → Solo descargará {days_missing} días faltantes (no 5 años completos)")

    # Descargar solo velas históricas desde before_first_candle hacia atrás
    historical_candles = await fetch_historical_candles_backwards(
        symbol, interval, first_candle_ts, days_missing
    )
    # Mergear: [histórico_nuevo] + [caché_existente]
    cached_data["main"] = historical_candles + cached_data["main"]

# Nivel 3: >= 95% del máximo → Actualización incremental (solo velas nuevas)
else:
    print(f"{tf_name}: cache completo - {coverage_pct:.1f}%")
    # Solo agregar velas nuevas si age > 1h
```

#### 4. Backend: Nueva Función `fetch_historical_candles_backwards()` ⭐

Función especializada para expandir el caché hacia atrás sin re-descargar todo:

```python
async def fetch_historical_candles_backwards(
    symbol: str,
    interval: str,
    before_timestamp_ms: int,  # Primera vela del caché existente
    days_needed: int            # Cuántos días hacia atrás descargar
):
    """
    Descarga velas HACIA ATRÁS desde un timestamp dado.

    Ejemplo:
    - Caché tiene: 2022-10-22 → 2026-10-22 (3 años, 87K velas)
    - Configurado: 5 años (175K velas)
    - Faltan: 2 años (88K velas)

    Esta función descarga:
    - Desde: 2020-10-22 (5 años atrás desde hoy)
    - Hasta: 2022-10-22 (antes de la primera vela del caché)
    - Resultado: Solo descarga ~2 años faltantes (~10 min)
    """

    # Calcular rango temporal hacia atrás
    end_ms = before_timestamp_ms - (interval_minutes * 60 * 1000)
    start_ms = end_ms - (days_needed * 24 * 60 * 60 * 1000)

    # Descargar desde Bybit filtrando por timestamp < before_timestamp_ms
    # ...

    # Retornar velas ordenadas cronológicamente
    return sorted_historical_candles
```

### Flujo de Caché Optimizado con Expansión Incremental ⭐

```
ESCENARIO 1: PRIMER INICIO (sin caché)
1. Frontend verifica IndexedDB → No existe
2. Frontend llama a backend → Backend verifica caché gzip → No existe
3. Backend descarga 5 años desde Bybit (~30 min) → Guarda en .json.gz
4. Frontend recibe datos → Guarda en IndexedDB
   Resultado: ⏳ 30 minutos (SOLO primera vez)

ESCENARIO 2: CACHÉ RECIENTE (< 1 hora)
1. Frontend verifica IndexedDB → ✅ Existe, edad 0.5h
2. Frontend valida: 87,000 velas > 2,880 velas (30 días mín) → ✅ VÁLIDO
3. Frontend usa caché DIRECTAMENTE sin verificar backend
   Resultado: ⚡ INSTANTÁNEO (~200ms)

ESCENARIO 3: CACHÉ ANTIGUO (> 1 hora, datos completos)
1. Frontend verifica IndexedDB → ✅ Existe, edad 3h
2. Frontend valida mínimo 30 días → ✅ VÁLIDO
3. Frontend verifica backend: última vela backend vs última vela caché
4. Si hay velas nuevas → Actualiza caché completo (~2 segundos)
   Si NO hay velas nuevas → Usa caché existente
   Resultado: ⚡ RÁPIDO (~2 segundos peor caso, instantáneo si no hay actualizaciones)

ESCENARIO 4: CACHÉ PARCIAL (ej: 3 años de 5) ⭐ NUEVO
1. Frontend verifica IndexedDB → ✅ Existe
2. Frontend valida mínimo 30 días → ✅ VÁLIDO (tiene 3 años)
3. Frontend llama a backend → Backend detecta: 87K velas vs 175K esperadas (50% cobertura)
4. Backend ejecuta EXPANSIÓN HACIA ATRÁS:
   - NO descarta los 3 años existentes
   - Calcula que faltan ~2 años de datos
   - Descarga SOLO desde 2020-10-22 hasta 2022-10-22 (antes del caché existente)
   - Mergea: [2_años_nuevos] + [3_años_existentes] = 5 años completos
5. Frontend recibe datos completos → Actualiza IndexedDB
   Resultado: ⚡ ~10 minutos (solo descarga lo faltante, NO 30 min completos)

ESCENARIO 5: EXPANSIÓN DE LÍMITES (config cambia de 3 años → 5 años)
1. Usuario tenía caché de 3 años (87K velas)
2. Developer actualiza MAX_DAYS_BY_INTERVAL de 1095 → 1825 días
3. Backend detecta: 87K velas vs 175K esperadas (50% cobertura)
4. Backend ejecuta EXPANSIÓN HACIA ATRÁS:
   - Descarga SOLO los 2 años faltantes más antiguos
   - Preserva los 3 años existentes
5. Resultado: ⚡ ~10 minutos en lugar de 30 min desde cero
```

### Archivos Modificados

| Archivo | Cambios | Líneas |
|---------|---------|--------|
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Validación simplificada (30 días mín), actualización incremental inteligente, logging detallado | 793-860 |
| `backend/main.py` | Sistema 3 niveles: descarga/expansión/actualización + nueva función `fetch_historical_candles_backwards()` | 2276-2405, 2470-2582 |

### Resultado Final

✅ **Primera carga (sin caché):** ~30 minutos (descarga completa desde Bybit)
✅ **Caché reciente (<1h):** ~200ms (usa caché directo, sin verificar backend)
✅ **Caché antiguo (>1h):** ~2 segundos (solo actualiza velas nuevas si existen)
✅ **Caché parcial (ej: 3 años de 5):** ~10 minutos ⭐ **NUEVO** (solo descarga lo faltante, NO todo desde cero)
✅ **Expansión de límites:** ~10 minutos (reutiliza datos existentes, expande hacia atrás)
✅ **Histórico completo disponible:** 5 años de datos para análisis técnico
✅ **Modo offline:** Si backend no responde, usa caché existente automáticamente

### Lecciones Aprendidas

1. **Validaciones deben ser razonables:** 80% del máximo configurado es demasiado estricto para datos históricos
2. **Logging detallado es crítico:** Sin logs, era imposible diagnosticar por qué se rechazaba el caché
3. **Caché temporal vs permanente:** Datos históricos inmutables no necesitan TTL estricto
4. **Evitar validaciones duplicadas:** Frontend y backend no deben repetir la misma lógica
5. **Expansión incremental es clave:** ⭐ Reutilizar datos existentes ahorra ~20 minutos (3x más rápido)
6. **Sistema de 3 niveles óptimo:** Descarga completa solo cuando es inevitable, expansión cuando falta poco, actualización cuando está completo

### Comparación de Rendimiento

| Escenario | ANTES (sin expansión) | DESPUÉS (con expansión) | Mejora |
|-----------|----------------------|------------------------|--------|
| Sin caché | 30 min | 30 min | - |
| Caché 3 años, config 5 años | ❌ 30 min (re-descarga todo) | ✅ 10 min (solo 2 años faltantes) | **3x más rápido** |
| Caché completo < 1h | 200ms | 200ms | - |
| Caché completo > 1h | 2 seg | 2 seg | - |

---

## 🔧 FIX CRÍTICO: Gráfico Congelado en Timeframe 5m (Octubre 2026) ✅ RESUELTO

**Noviembre 2026:** `subdivisions` ya no existe. Era copia exacta de `main`, así que MiniChart usa `main` en todos los marcos y la vela en formación sale de `formingCandle()`. Lo de abajo queda como historia.

### Problema

Al reproducir el backtesting en el timeframe de **5 minutos**, el gráfico se quedaba congelado:
- El indicador de fecha/hora avanzaba correctamente
- El TimeController enviaba actualizaciones de `currentTime` cada subdivisión (1 minuto)
- **PERO** el gráfico no se actualizaba visualmente, las velas permanecían estáticas

### Causa Raíz

El problema estaba en cómo `MiniChart.jsx` cargaba las velas en modo backtesting:

```javascript
// ANTES (INCORRECTO):
allCandlesRef.current = timeframeData.main;  // ❌ Solo velas de 5 minutos
```

**Flujo problemático:**

1. **TimeController** configurado con subdivisiones para 5m:
   ```javascript
   subdivisionConfig: {
     "5m": { interval: 1, count: 5 }  // 5 estados de 1min cada uno
   }
   ```

2. **TimeController** avanza `currentTime` en pasos de 1 minuto:
   ```
   10:00 → 10:01 → 10:02 → 10:03 → 10:04 → 10:05
   ```

3. **MiniChart** usa Binary Search en velas de 5 minutos:
   ```javascript
   // allCandlesRef tiene velas: [10:00, 10:05, 10:10, 10:15, ...]

   // Cuando currentTime = 10:01:
   const lastIndex = binarySearch(allCandles, currentTime);
   // lastIndex sigue siendo el mismo (vela de 10:00)

   // Cuando currentTime = 10:02, 10:03, 10:04:
   // lastIndex SIGUE siendo el mismo → ❌ NO SE ACTUALIZA EL GRÁFICO

   // Solo cuando currentTime = 10:05:
   // lastIndex avanza a la siguiente vela → Actualización visible
   ```

4. **Resultado**: El gráfico solo se actualiza cada 5 minutos, aunque el tiempo avanza cada 1 minuto.

### Solución Implementada

Modificar `MiniChart.jsx` para usar las **velas de subdivisión** (1 minuto) en lugar de las velas principales (5 minutos) cuando están disponibles:

```javascript
// DESPUÉS (CORRECTO):
const hasSubdivisions = timeframeData.subdivisions && timeframeData.subdivisions.length > 0;

if (hasSubdivisions) {
  console.log(`[MiniChart] Usando SUBDIVISIONES: ${timeframeData.subdivisions.length} velas`);
  allCandlesRef.current = timeframeData.subdivisions;  // ✅ Velas de 1 minuto
} else {
  console.log(`[MiniChart] Cargando ${timeframeData.main.length} velas principales`);
  allCandlesRef.current = timeframeData.main;
}
```

**Flujo corregido:**

```
1. TimeController avanza: 10:00 → 10:01 → 10:02 → ...

2. MiniChart usa Binary Search en velas de 1 minuto:
   allCandlesRef = [10:00, 10:01, 10:02, 10:03, 10:04, 10:05, ...]

3. Cada actualización de currentTime encuentra una nueva vela:
   currentTime = 10:01 → lastIndex avanza → ✅ GRÁFICO SE ACTUALIZA
   currentTime = 10:02 → lastIndex avanza → ✅ GRÁFICO SE ACTUALIZA
   ...

4. Resultado: El gráfico se actualiza suavemente en cada subdivisión
```

### Timeframes Afectados

Este fix beneficia a todos los timeframes con subdivisiones:

| Timeframe | Subdivisión | Velas Usadas | Beneficio |
|-----------|-------------|--------------|-----------|
| **5m** | 1min × 5 | Velas de 1min | ✅ Actualización cada 1 min (antes: congelado) |
| **15m** | 5min × 3 | Velas de 5min | ✅ Actualización cada 5 min |
| **1h** | 15min × 4 | Velas de 15min | ✅ Actualización cada 15 min |
| **4h** | 60min × 4 | Velas de 1h | ✅ Actualización cada 1h |
| **1m** | 1min × 1 | Velas de 1min | ✅ Sin cambio (ya usaba velas correctas) |

### Archivo Modificado

| Archivo | Cambio | Líneas |
|---------|--------|--------|
| `frontend/src/components/MiniChart.jsx` | Usar subdivisiones cuando disponibles | 2250-2261 |

### Resultado

✅ **Timeframe 5m ahora funciona correctamente:**
- El gráfico se actualiza cada 1 minuto durante el playback
- La reproducción es fluida y sincronizada con el TimeController
- Las velas aparecen progresivamente sin congelarse

### Verificación

Para verificar que el fix funciona, revisa los logs de la consola:

```javascript
[MiniChart BTCUSDT 5m] 📊 Usando SUBDIVISIONES: 730,000 velas (en lugar de 146,000 main)
```

Si ves este log, significa que está usando correctamente las velas de 1 minuto para el timeframe de 5 minutos.

---

## ORDER FLOW SOBRE LAS VELAS (Noviembre 2026)

Reemplaza el enfoque de overlays y panel lateral de la sección siguiente. `FootprintSidebar` sigue en el código, pero `onCandleClick` no está conectado en `MiniChart.jsx`.

### Flujo de datos

```
OrderFlowData/tape/{SYMBOL}/{AAAA}/{SYMBOL}_{dia}.tape        Trades de Bybit
        │  tools/build_store.py
        ▼
OrderFlowData/store/{SYMBOL}/{AAAA}/{SYMBOL}_{dia}.npz        Minuto × precio: compra, venta, trades
        │  backend/footprint_store.py
        ▼
GET /api/orderflow/historical/{symbol}?interval&start_timestamp&end_timestamp&known_until&step
GET /api/orderflow/profile/{symbol}?start_timestamp&end_timestamp&low&high&rows&known_until
GET /api/orderflow/coverage/{symbol}
```

`ORDERFLOW_STORE` cambia la carpeta del almacén. Sin `start_timestamp` y `end_timestamp`, el endpoint historical sigue leyendo el archivo anterior.

### Sin futuro

- `known_until` corta por minuto cerrado. `complete: false` marca una vela parcial
- `priceContext.knownUntil` es el `knownUntil` de la vela en formación, o la hora simulada si no hay vela en formación
- Al retroceder el tiempo, `OrderFlowIndicator` borra lo que aún no se conocía y descarta respuestas pendientes con `generation`
- Una vela cerrada se vuelve a pedir si su footprint quedó parcial

### Dibujo

| Ancho de vela | Se muestra |
|---------------|------------|
| Menos de 16px | Vela normal, líneas de stacked imbalance y rombos de delta contrario a la vela |
| 16px a 59px | Vela, celdas y perfil |
| Desde 60px | Además delta bajo la vela, con su propio tamaño (`deltaFontSize`, 13 px por defecto, de 8 a 24 en el modal). Las cifras por celda aparecen si la columna mide 30px y la celda 10px |

- Se piden footprints con hasta 1600 velas en pantalla (`MAX_CANDLES_TO_LOAD`), sin pasar de 70 días de trades (`MAX_DAYS_TO_LOAD`): en 4h, hasta 420 velas
  - Al desplazarse se pide media pantalla de más a cada lado, hasta 200 velas (`MAX_PAD_CANDLES`), y ningún pedido pasa de 70 días
  - Con más velas, lo ya cargado se sigue dibujando y el gráfico avisa "Order Flow: acerca el zoom para cargar los footprints"
  - Hasta el 9/11 el tope era 400 velas, unos 4 días en 15m, y sin aviso: al alejar la vista, las velas anteriores quedaban sin footprints aunque el almacén los tuviera. En el backend, 1600 velas de 15m tardan 0.3 a 0.6 s (3 MB); 1600 de 1h, 2 s la primera vez
- `step_size` se elige en la primera respuesta y se mantiene. Cambia solo si el precio se aleja 30%. En BTC cerca de 80,000: 1m 5, 5m y 15m 10, 1h 25, 4h 50
- Con step automático el frontend envía `max_levels` (`maxLevels`, 10 por defecto). `_level_group()` une niveles vecinos en grupos redondos, así que cada vela trae su propio `step_size`: 20, 50 o 100 en 15m. El step base no cambia
- Imbalance: mismo nivel, ratio 3 o más, ambos lados con volumen. Stacked: 3 o más niveles seguidos en la misma dirección. Igual que App 9
- Rombo de delta: delta contrario al color de la vela y al menos 20% de su volumen (`deltaMarkMinShare`)
- `bid_volume` es venta agresiva, `ask_volume` compra agresiva, `delta = ask - bid`
- MiniChart llama `renderOnChart()` después de los overlays: los footprints quedan encima de los perfiles. El indicador no tiene `renderOverlay`

### Perfil y delta reales

- `VolumeProfileFixedRangeIndicator` pide volumen real si el almacén cubre 99% de los minutos del rango y muestra `· real` junto al POC. Si no, usa el reparto por velas
- `VolumeIndicator` usa delta real solo si todas las velas pedidas lo tienen. El título cambia a "Volume Delta (trades reales)"
- VP dinámico y CVD siguen estimados

### Open Interest

- `backend/oi_store.py` lee `OrderFlowData/oi/{SYMBOL}_5min.csv` (BTC: agosto de 2020 a noviembre de 2026). `ORDERFLOW_OI` cambia la carpeta
- 15m, 1h y 4h salen de tomar el dato en el inicio de cada vela. Son los mismos valores que Bybit entrega por marco
- `GET /api/open-interest/{symbol}?interval&start_timestamp_ms&end_timestamp_ms&local_only=true` responde `source: "local"`, o `success: false` si el símbolo no tiene archivo
- `OpenInterestIndicator._loadVisibleRange()` pide la ventana visible con margen y la une a lo ya cargado. Sin archivo local queda lo que trae `bulk-data`
- `tools/oi_download.py` solo descarga hacia atrás: las fechas posteriores al último dato se ven planas

### Altura del gráfico

- `.mini-chart` mide el 100% del panel, sin scroll. Antes la altura salía de la proporción 2:1 del canvas: la mitad del ancho
- El precio recibe primero `priceChartRatio` del alto disponible (65% por defecto, 30% a 85% con el divisor). Volumen e indicadores se comprimen con la misma escala, con mínimos de 40px y 48px. Si todo cabe, lo que sobra va al precio
- `IndicatorManager.getPanelHeight()` da la altura real de cada panel. Los divisores se ubican con `priceAreaBottom`, el borde real del precio
- Un `ResizeObserver` redibuja al cambiar el tamaño de la ventana o del panel lateral

### Orden y altura de los paneles

- `indicators/panelLayout.js` guarda orden y alturas por símbolo en `indicator_panels_{symbol}`. Los marcos del símbolo comparten el mismo objeto, así un cambio les llega a todos
- Todo sigue en un solo canvas. `IndicatorManager.getPanels()` da el orden, `getRequestedHeight()` la altura pedida y `getPanelRects()` el lugar de cada panel. MiniChart ubica con eso los controles, que son HTML sobre el canvas
- ▲▼ en el margen derecho mueven el panel. `movePanel()` lo cambia con su vecino a la vista y los paneles apagados conservan su sitio
- Arrastrar el borde superior cambia solo ese panel. Con paneles comprimidos, subir su altura achicaría a los demás: por eso `resizePanel()` también mueve `priceChartRatio`, y el precio cede o recibe la diferencia
- El volumen queda fijo bajo el precio, con su divisor naranja
- Una altura escrita en el modal de OI-Volume Confluence reemplaza la arrastrada
- La lista de indicadores trae "Restablecer orden y altura de paneles"

### Parámetros

- `OrderFlowSettings.jsx` y `FVGSettings.jsx` se abren con el ⚙️ junto al indicador. Aplican a todos los marcos y se guardan por símbolo en `orderflow_settings_{symbol}` y `fvg_settings_{symbol}`
- `stepByMinutes` guarda el step por marco, en minutos. Sin valor es automático. Un step escrito se respeta: el backend lo ajusta a múltiplos de la celda guardada y solo lo sube si una vela pasaría de 200 niveles (`MAX_LEVELS_PER_CANDLE`)
- `/api/orderflow/historical` acepta `imbalance_ratio`, `imbalance_mode` (`level` o `diagonal`), `imbalance_min_volume`, `imbalance_candle_pct`, `imbalance_candle_bars`, `imbalance_cell_pct`, `imbalance_zero` y `stacked_levels`
- **Filtros relativos de imbalances (14/11, reemplazan el mínimo en monedas, `imbalanceMinVolume`, que ya no se envía):**
  - `imbalanceCandleVolumePct` y `imbalanceCandleVolumeBars` (20): una vela solo tiene imbalances si su volumen llega a ese % del promedio de las N velas anteriores. Sin velas anteriores no se filtra. Cada footprint trae `candle_volume_ratio`;
  - `imbalanceCellSharePct`: un imbalance suelto queda si su celda (compra + venta) tiene ese % del volumen de su vela; un stacked, si la suma de sus celdas lo tiene (`_share_filter` en `footprint_store.py`);
  - 0 es sin filtro
- **Área de valor de cada vela (14/11):** `showValueArea` (de fábrica) y `valueAreaPct` (70). `valueAreaRange()` suma desde el POC el nivel vecino con más volumen hasta ese %. Con Nítido sus barras van en `THEME.vpValueAreaRgb`; en Clásico, las de fuera en azul tenue
- **Perfil junto al footprint (14/11):** `profileMode` `volume`, `delta` o `both` (volumen y al lado el delta). `renderDeltaProfile` dibuja el delta de cada nivel desde la izquierda, largo según el mayor |delta| de la vela, en el color del lado que ganó
- **Franjas de stacked con zoom (14/11):** con el footprint a la vista, `renderStackedBands` dibuja, después de todas las velas, una franja por stacked desde su vela hacia la derecha (`stackedLineExtend` anchos de vela) con borde arriba y abajo. Con Nítido, un imbalance suelto lleva una barra de 2 px en su lado
- `OrderFlowIndicator.updateConfig()` descarta lo cargado solo si cambia algo que afecta la respuesta (`_dataRules()`)
- Diagonal: compra del nivel contra venta del nivel inferior, y venta contra compra del superior. Si un nivel cumple ambos, gana el ratio mayor
- FVG `fillMode`: `trim` se recorta, `touch` termina al primer toque, `whole` conserva su tamaño hasta cruzarlo

### Pruebas

```bash
cd frontend
node tests/replay.test.mjs
node tests/orderflow.test.mjs
node tests/fvg.test.mjs
node tests/oi.test.mjs
node tests/observer.test.mjs
node tests/leaks.test.mjs
node tests/journal.test.mjs
node tests/orders.test.mjs
node tests/sessions.test.mjs
node tests/response.test.mjs
node tests/panels.test.mjs
node tests/levels.test.mjs
node tests/swinglevels.test.mjs
node tests/clock.test.mjs
node tests/light.test.mjs
node tests/analysis.test.mjs
node tests/marketdata.test.mjs
node tests/liquidations.test.mjs
node tests/pixels.test.mjs
node tests/theme.test.mjs
node tests/positions.test.mjs
node tests/swing.test.mjs
node tests/rectangle.test.mjs
node tests/redrawPacer.test.mjs
node tests/liquiditymap.test.mjs
node tests/sustainedlevels.test.mjs
node tests/zonedefense.test.mjs
node tests/ruletester.test.mjs
node tests/horizontalranges.test.mjs
node tests/regimedetectors.test.mjs
node tests/williams.test.mjs
node tests/smc.test.mjs
node tests/williamssmc.parity.test.mjs
node tests/rulefacets.test.mjs
cd ../backend
.venv\Scripts\python.exe -m pytest tests/test_observer.py tests/test_measures.py tests/test_patterns.py tests/test_footprint_rules.py tests/test_dtb_known.py tests/test_rejection_known.py tests/test_screenshots.py tests/test_bulk_data.py tests/test_liq_store.py
```

`light.test.mjs` compara VWAP con `backend/vwap_calculator.py`: usa `BACKEND_PYTHON`, `backend/.venv` o un python con numpy.

### Días de la nube (12/11)

Para la app en tiempo real, que usará este lector (requisito 8 de la integración): `footprints`, `minutes`, `cells` y `profile` aceptan `live`. Con `live=True`, o `ORDERFLOW_USE_LIVE=1`, un día sin archivo oficial se lee de `OrderFlowData/live/store` (`ORDERFLOW_LIVE_STORE`), que arma `PanelOrderFlow/sync_nube.py` con lo que grabó el collector de Northflank.

- **Apagado por defecto.** App 1 no lo usa: el Observador, las medidas y los setups siguen solo con días oficiales, que no tienen huecos de grabación
- **El oficial manda:** si existe el día oficial, la nube no se lee
- **Huecos:** salen del `.json` que `sync_nube.py` guarda junto al `.tape` (cortes, reinicios y el tramo antes de `covered_from`). Una vela que toca uno lleva `gap: true`: su volumen está incompleto
- **Último guardado:** en un día sin cerrar, la nube solo tiene hasta `saved_at`. La vela que pasa de ahí queda `complete: false`
- Las velas de la nube llevan `source: "live"` y la respuesta `live_days` (día, `complete` y hasta dónde llega). Un día de la nube se vuelve a leer si cambia su archivo
- **Falta:** Elementos OF no lee `OrderFlowData/live/flow`, y ningún endpoint pide `live`
- Pruebas: `tests/test_footprint_live.py` (9)
- **Modo en vivo de `MiniChart` (12/11):** lo usa la suite (`12.AltagraciaTradingSuite`). La escala de precios sigue las velas a la vista, como en reproducción. Antes tomaba todas las velas cargadas y las aplastaba. App 1 no usa ese modo
- **Marcos con letra y WebSocket (12/11):** `getBybitInterval` y `getIntervalMilliseconds` no reconocían "1m", "5m", "1h" ni "4h" (los marcos de App 1) y caían en 15m. En vivo, cada gráfico pedía las velas de 15m. En App 1 cambia solo una cosa: los botones 1D, 3D y 1W ahora muestran ese tiempo en 1m, 5m, 1h y 4h (antes calculaban con velas de 15 minutos: 1D en 1h mostraba 4 días). `WebSocketManager.js` suscribe por moneda y marco, con ping cada 20 s
- **Suprimir (12/11):** solo responde el `MiniChart` a la vista y solo guarda si borró algo. Con un gráfico por marco, los ocultos guardaban su lista sin borrar a la vez
- **Footprint parcial (12/11):** con días en vivo, una vela que toca un hueco de grabación (`gap`) lleva "parcial" sobre su footprint. Los días oficiales no tienen huecos
- **Step parejo en vivo (12/11):** sin step escrito, el indicador envía `step_mode=uniform` en vez de `max_levels`, y el servidor de la suite da un solo step para todas las velas. El modal de Order Flow lo explica y oculta "Máximo de niveles por vela" en vivo. El campo del step acepta decimales (`step="any"`). En reproducción nada cambia
- **Pedidos en vivo (12/11), solo con `backtestingMode` falso:** la vela en curso se pide hasta la hora del gráfico; si la respuesta llega a menos de lo pedido (el almacén en vivo va detrás) se repide cada 10 s (`LIVE_LAG_WAIT_MS`); y cada minuto se repiden las velas sin datos o con hueco (`_liveRefresh`). En reproducción nada cambia
- **Posiciones reales en vivo (12/11):** `components/positionLines.js` dibuja las posiciones y órdenes de la cuenta del bot si quien monta `MiniChart` pasa `getPositionLines`, como en TradingView:
  - entrada con tamaño y P&L al último precio;
  - SL y TP con lo que se perdería o ganaría;
  - liquidación y entradas pendientes.
  
  `onPositionAction` recibe la × (cerrar, cancelar, quitar el TP) al soltar sobre ella, y el arrastre de la etiqueta del SL o del TP, solo con el cursor de selección. Quien da los datos confirma y envía; el gráfico solo dibuja y avisa. Lo usa la suite (`12.AltagraciaTradingSuite`, sección "Posiciones en el gráfico"). App 1 no pasa esas props: su reproducción no cambia. `getPositionTargets()` del ref da lo que responde al mouse, para revisar desde la consola. Fuera de la vista, la etiqueta dice su precio real y queda en el borde, bajo los botones del gráfico (`overlayButtonsRef`). ⇕ o un clic en ella activa `positionFitRef`: la escala incluye entrada, SL y TP (`positionPrices()`). El % es el ROI sobre el margen, como en Bybit. Prueba: `tests/positions.test.mjs` (13)

### Mantener el almacén

```bash
python -B C:\Users\inven\OrderFlowData\tools\build_store.py BTCUSDT
```

Omite los días ya creados. Mide cerca de 0.4 s y 0.3 MB por día.

---

## ELEMENTOS DE ORDER FLOW (Noviembre 2026)

Indicador "Elementos OF": los elementos de los setups de Orderflows Unlocked, detectados con los trades reales y dibujados como ayuda de lectura, no como señales. Las reglas salen de leer las láminas de los PDF y la calibración, de medirlas en BTC de 2020 a 2026: `C:\Users\inven\OrderFlowData\research\orderflows_unlocked\` (`LEEME.md`, `CALIBRACION.md`).

### Flujo

```
OrderFlowData/store (minuto × celda)
        │  backend/of_elements.py: detect()
        ▼
GET /api/orderflow/elements/{symbol}?interval&start_timestamp&end_timestamp&known_until&target&band_days&vol_filter
        ▼
OrderFlowElementsIndicator.js: franjas, celdas, contornos, glifos, EMA 14 y la tabla de la vela
```

### Detección (backend)

- **Step de análisis fijo:** `analysis_step()` toma la fracción de `footprint_store.STEP_BY_INTERVAL` (15m: 10 USD con BTC en 80,000), redondeada a 1, 2 o 5 y múltiplo de la celda. No agrupa niveles: el footprint que se dibuja usa `max_levels` y cada vela queda con su propio step, así que no sirve para detectar
- **Orientación:** índice 0 = extremo donde empieza la vela (mínimo en verde, máximo en roja). A = agresor a favor del color, P = lado contrario. Un doji no marca nada
- **Umbrales relativos:** por día, con las velas de los 30 días anteriores, para que cada elemento marque cerca de `target` de las velas (5% por defecto). Nunca usan el día en curso. Con menos de 100 velas de historia responde `warming` y solo da los elementos literales
- **Sin futuro:** solo velas cerradas antes de `known_until`. La VA abandonada lleva `known` = cierre de la vela siguiente. Un día completo queda en caché (`MAX_CACHED_DAYS`): la primera consulta tarda ~1 s en 15m y las siguientes ~0.3 s
- Cada evento: `code`, `dir`, `t` (vela), `t0` (primera vela de un contorno), `known`, `lo`, `hi`, `value`, `thr`. Además `bars` trae delta, volumen, Δ/Vol y delta acumulado del día UTC

| Código | Elemento | Forma | Regla |
|---|---|---|---|
| VA | VA abandonada | franja | la vela siguiente no entra en el área de valor (70% de a un nivel) |
| OG | Orderflows Gap | franja | áreas de valor sin solape, hueco ≥ umbral en ATR |
| AP / SL | POC alineado / Slingshot | franja | mismo POC en dos velas / dos velas del mismo color con el POC hacia atrás |
| RL | Absorción (propuesta propia) | franja | nivel ≥ p99.5 de 30 días con ≥40% pasivo. No es regla del libro |
| EX | Exhaustion Print | franja | lado pasivo del extremo casi en cero (umbral relativo) |
| ZP / DT | Zero Print / Delta Tail | celdas / franja | 0 en una de las dos celdas del inicio / delta contrario en el extremo y a favor en el resto |
| RS | Retail Suck | franja | pasivo del extremo decrece tres niveles, con tamaño relativo |
| DD / PD | Delta Divergence / Price Action Divergence | franja / celdas | extremo de 5 velas con delta del color / delta contra el color (relativo) |
| IV | Inverse Imbalance | celdas | dos desequilibrios contrarios seguidos en la mitad lejana (diagonal 4x) |
| AD | Acumulación/Distribución | franja | mayor celda en el lado contrario y en el tercio del inicio |
| SW / VL / SQ | Sweep / Vertical Liquidity / Sequencing | franja / celdas / celdas | rachas de niveles: sin contrapartida, con agresor ≥ p90 de 30 días, agresor creciente. Mínimos 3, 3 y 4 |
| DB / PW | Delta Breakout / POC Wave | contorno | salto de delta entre dos velas del mismo color sobre el volumen típico / tres velas como el libro |
| DV | Delta/Volume extremo | tabla | Δ/Vol a favor ≥ umbral relativo |

**Con filtro de volumen** (`vol_filter`, 2 por defecto): solo en velas con volumen ≥ 2 veces la mediana de las 20 anteriores. Sin el filtro marcan del 12% al 74% de las velas de 15m (`research/orderflows_unlocked/filtro_volumen.py`). Vienen apagados en el modal, que los marca con "vol.". Las tasas son las de BTC del 02/10 al 01/11/2025, con filtro 2:

| Código | Elemento | Forma | Regla | 15m | 1h |
|---|---|---|---|---|---|
| ST | Stacked Imbalance | franja | 3 desequilibrios diagonales 4x seguidos a favor del color | 11.7% | 5.4% |
| VI | Volume Imbalance | contorno | 3 o más desequilibrios a favor, seguidos o no | 17.2% | 11.4% |
| IR | Imbalance Reversal | franja | desequilibrio contrario en uno de los dos precios del inicio | 4.7% | 3.2% |
| RD | Imbalance Reload | franja | desequilibrio al mismo precio en dos velas seguidas del mismo color | 4.3% | 1.7% |
| VD | Volume Decline | celdas | pasivo crece del 1.º al 3.º precio desde el inicio | 8.1% | 11.8% |
| TP | Thin Print | celdas | nivel interior con contrapartida 0, hasta 3 por vela | 8.7% | 2.8% |
| OP | Open POC | franja | POC fuera del rango de las 5 velas previas por al menos 0.25 ATR | 7.5% | 7.4% |
| RX | Ratio de extremos | celdas | 2.º precio ÷ extremo, en el lado pasivo, < 0.70 o > 30 | 5.0% | 3.3% |

El filtro elige velas de mucho volumen más que elementos: Volume Imbalance, Volume Decline, Reversal y Ratio marcan casi la misma parte de esas velas que del total. Solo Stacked, Open POC y Thin Print se concentran en ellas.

**Con el almacén de flujo** (fase 2, 10/11): `OrderFlowData/flow/{SYMBOL}/{AAAA}/{SYMBOL}_{dia}.npz`, armado por `tools/build_flow.py` desde los `.tape` (`ORDERFLOW_FLOW` cambia la carpeta). `build_store.py` lo arma también al correr solo con la moneda, como lo lanza el panel. BTC completo: 2,416 días, 116 MB, unos 5 minutos en tres procesos.

- **Por minuto:** `dmx` y `dmn`, el máximo y el mínimo del delta dentro del minuto desde su inicio. El Max/Min Delta de una vela es exacto: `max_k(delta acumulado antes del minuto k + dmx_k)`. Medido en 30 días de BTC 15m, con resolución de 1 minuto Small Min/Max marcaba 30% de las velas contra 12% exacto y solo coincidía en 40% (`research/orderflows_unlocked/delta_exacto.py`)
- **Órdenes agresivas:** trades seguidos del mismo lado en el mismo instante son una orden. Se guardan las que cruzan 3 precios o más con 100,000 USD o más, y las de 250,000 USD o más (`ot` en ms, `os`, `oq`, `op0`, `op1`, `on` = precios cruzados)
- **Días sin órdenes:** del 07/12/2021 al 19/12/2022 Bybit publicó la hora en segundos y no se pueden separar órdenes (`info[2]` = 0). El delta exacto sí vale

| Código | Elemento | Forma | Regla | 15m | 1h |
|---|---|---|---|---|---|
| XD | Extreme Delta | tabla (celda Delta) | delta en 95% o más de su máximo o mínimo exacto, y \|Δ/Vol\| sobre el umbral relativo | 6.2% | 5.6% |
| SM | Small Min/Max Delta | tabla (celda ámbar) | el lado contrario al color apenas movió el delta: Mín Δ en una verde, Máx Δ en una roja, con umbral relativo | 6.4% | 5.4% |
| BR | Barrido real | franja | la mayor orden de la vela que cruzó 3 precios o más, con USD sobre el umbral relativo | 4.7% | 5.6% |
| GR | Orden grande | franja | la mayor orden de la vela, con USD sobre el umbral relativo | 4.5% | 6.1% |

Tasas de BTC del 02/10 al 01/11/2026. Los umbrales de XD y SM usan solo velas con flujo, y los de BR y GR solo velas de días con órdenes. La tabla de la vela suma las filas Máx Δ y Mín Δ (`maxd`, `mind` en `bars`; `null` sin flujo).

Queda fuera Market Weakness, sin regla en las láminas.

**Con el libro grabado (14/11, solo en la suite):** `AB` Absorción en el libro y `BL` Barrido del libro (nivel sostenido), franjas, y `LD` Libro delgado (poca liquidez a 0.25% del precio, bajo el percentil 5 de las 24 horas anteriores), celdas en el lado más delgado; con `book: true` en `ofElements.js`, encendidos de fábrica. Los calcula el servidor de la suite (`12.AltagraciaTradingSuite/server/book_events.py`) y los suma a su `/api/orderflow/elements`; App 1 no tiene libro de sus fechas y nunca los recibe.

### Setups como recetas (fase 3, 10/11)

Inspirado en el "Consenso" de Strategic Flows (strategicflows.com, el producto de Mike Valtos para NinjaTrader), que combina señales pero no trae backtest ni estadísticas. Aquí cada receta se evalúa en el histórico con costos.

```
ofSetups.js (biblioteca de 91, recetas propias, of_setups_{symbol})
        │  POST /api/orderflow/setups/{symbol}            coincidencias de las recetas activas
        │  POST /api/orderflow/setups/{symbol}/evaluate   una receta en los días anteriores a la hora simulada
        ▼
backend/of_setups.py: match_recipes() sobre los eventos de of_elements.detect()
```

- **Receta:** casillas (cada una con uno o más códigos: `SW|BR` acepta cualquiera), modo, ventana de 1 a 5 velas, lado y filtros
- **Modos:** `strict` (todas las casillas), `threshold` (al menos `min`), `groups` (mínimo por grupo) y `sequence` (grupos en orden: el último en la vela que dispara y los anteriores en velas previas). En todos, la vela que dispara aporta un voto
- **Sin futuro:** un voto cuenta en la vela con la que se conoce su elemento (la VA abandonada, en la siguiente). Con confirmación de entrada, el setup se conoce al cerrar la vela que avanzó a favor
- **Filtros:** swing (mínimo o máximo de N velas, hasta `flex` velas antes, opcionalmente con un voto en esa vela), momentum (EMA 14 con pendiente ≥ 0.25 ATR en 3 velas y el precio de su lado) y confirmación de entrada (`atr` ATR a favor dentro de `bars` velas)
- **Biblioteca:** los 91 setups en notación corta (`ofSetups.js`): `A+B` misma vela, `@3` ventana, `A>B` secuencia, ` m` momentum, ` s` swing. El orden y la ventana salen de las lecturas de las láminas. Los 15, 43, 53 y 70 llevan "sin Market Weakness". Vienen apagados
- **Evaluación:** entra al cierre de la vela con la que se conoce el setup, con stop de `stop_atr` ATR, objetivo de `target_r` R u horizonte de velas, y comisión taker de entrada y salida. Si stop y objetivo caen en la misma vela, cuenta el stop. La base son las velas del mismo color con las mismas reglas. Da casos, acierto con intervalo de Wilson, R neto, base y ventaja, y avisa con menos de 30 casos. Pide los elementos en tramos de 60 días (`_detect_span`): `detect()` no acepta más de 70 de una vez. 180 días de 15m tardan unos 22 s la primera vez
- **Gráfico:** un corchete bajo (alcista) o sobre (bajista) las velas que votaron, con la etiqueta `S2` o las iniciales de una receta propia. Se ofrece al menú "Incluir en el análisis" con los códigos que votaron
- **Modal "Setups de Order Flow":** se abre desde el modal de Elementos OF ("Setups (recetas)…"). Lista con filtro (todos, activos, giro, continuación, propios), "Evaluar" por receta o para toda la lista, orden por ventaja, editor de casillas y filtros, "Guardar como propia" y "Del libro" para deshacer lo editado

Medido el 10/11 en BTC 15m con la hora simulada en el 25/10/2026: S2 dio 23 casos, 34.8% de acierto, -0.24 R contra -0.41 de la base. Con tan pocos casos nada se distingue del azar. Esa medida cubrió solo 70 días: hasta la fase 4, `detect()` recortaba en silencio todo pedido más largo, así que "Días" pasaba de 70 sin efecto. Estos dos últimos necesitan el Max/Min Delta exacto: con 1 minuto, Small Min/Max acierta menos de la mitad (`delta_exacto.py`).

### Prueba manual (fase 4, 10/11)

Pedido del usuario: decidir las reglas de cada setup probando a mano, sin gastar las fechas con que se comprueba.

- **Periodo reservado:** "Fecha de corte (UTC)" en el modal, 2025-07-01 por defecto (`reserve` en `of_setups_{symbol}`). "Evaluar" envía `reserve_ms` y el backend nunca mira desde esa fecha, aunque la hora simulada sea posterior. Con la hora simulada a menos de 7 días después del corte no evalúa
- **Comprobación final:** botón por receta. Pide confirmar, dice cuántas veces ya se comprobó y con qué versión, y corre la receta solo en lo reservado: desde la fecha de corte hasta el último día del almacén (`validation: true`). Cada comprobación queda en `OrderFlowData/observer/setup_validations.jsonl` con la receta exacta, su versión, reglas y resultado; `GET /api/orderflow/setups/{symbol}/validations` las lista y el modal muestra la última bajo cada receta. De 2025-07-01 a noviembre de 2026 en 15m tarda alrededor de un minuto la primera vez
- **Versiones:** cada "Guardar" del editor, "Guardar como propia" y "Del libro" (si hubo versiones) suma una a `history[id]` con la fecha real y la receta (`withVersion()` en `ofSetups.js`, hasta 30 por receta, sin repetir una igual a la vigente). La fila muestra `v2` y el editor la lista. v0 es la del libro o la de antes de esta fase
- **Tus trades por setup:** `observer.report()` trae `setups`: por cada setup de Elementos OF elegido para el análisis de una orden cerrada (`levels` con `kind` "Setup S14 (...) alcista: ..."), acierto y R con y sin él. Una orden cuenta una vez cada setup. El informe del Observador lo muestra en "Tus trades por setup"; lo que hizo la receta sola sigue siendo "Evaluar"
- **Pruebas:** `test_el_ajuste_nunca_mira_las_fechas_reservadas`, `test_la_comprobacion_usa_todo_lo_reservado`, `test_rangos_largos_se_piden_por_tramos_sin_repetir_velas`, `test_informe_por_setup_cuenta_los_setups_elegidos` y dos en `ofsetups.test.mjs`. Probado en la copia aislada: 180 días de ajuste con corte el 01/07/2026 terminan el 30/06 y la comprobación cubre del 01/07 al 04/11
- **Falta:** la fecha al azar del modo oculto puede caer en lo reservado. Practicar a mano ahí no ajusta la receta, pero sí muestra esas velas

### Dibujo (frontend)

- `ofElements.js`: catálogo, grupos del modal (Zonas, Giro en la zona, Continuación, Tabla), parámetros y `bandEnd()`. Es lógica pura y se prueba en Node
- **Franjas:** desde la vela que las crea hasta la primera vela que empieza después de `known` y entra en su precio. Se cortan con `priceContext.knownCandles`, también con la vela en formación. Al retroceder se revisan de nuevo. Se dibujan las `maxBands` más recientes
- **Glifos:** ▲ bajo la vela si es alcista y ▼ sobre ella si es bajista, desde 4 px. Los códigos aparecen desde 16 px
- **Carga:** pide la vista con media pantalla de más (hasta 3 días) y `band_days` = 3. Si solo avanza la hora, pide desde cuatro velas antes de lo cargado. Con más de 60 días a la vista avisa que se acerque el zoom
- **Tabla de la vela:** panel con delta, Máx Δ, Mín Δ, Δ/Vol y delta acumulado del día. Delta se rellena con Extreme Delta, Máx o Mín Δ en ámbar con Small Min/Max, y Δ/Vol cuando es extremo. Con varios paneles queda baja: se agranda arrastrando su borde
- **EMA 14:** el "Momentum Strength" de las láminas. Se colorea si su pendiente pasa de 0.25 ATR en 3 velas
- `selectableLevels()` ofrece franjas, celdas, contornos y glifos al menú "Incluir en el análisis"
- Parámetros en `of_elements_settings_{symbol}`, para todos los marcos. Colores: compra y venta del estilo (`THEME.upRgb`, `THEME.downRgb`), o los de siempre en Clásico

### Pruebas

```bash
node tests/ofelements.test.mjs
node tests/ofsetups.test.mjs
node tests/blind.test.mjs
.venv\Scripts\python.exe -m pytest tests/test_of_elements.py tests/test_of_setups.py
```

La prueba del backend arma un almacén sintético de 34 días: reglas por vela, que lo conocido no cambie al avanzar la hora y que sin historia no haya umbrales relativos. Probado además en una copia aislada (backend 9300, Vite 9301) con BTC 15m: franjas que terminan al tocarse, códigos, modal, EMA, reproducción a 5000x (17 pedidos sin error) y el menú de análisis.

---

## SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11 (Noviembre 2026)

Pedidos del usuario el 11/11, después de la fase 4 de Elementos OF.

### Segundo gráfico en otra pestaña

- Botón "2.º gráfico" en el encabezado (con la simulación iniciada): abre `?grafico=2` en otra pestaña, que se puede llevar a otra pantalla. `main.jsx` monta `SecondaryChartApp` en vez de `BacktestingApp`
- Sigue la reproducción de la principal: `replayChannel.js` (BroadcastChannel `app1-replay`). La principal publica en cada cambio de hora, símbolo, marco o fecha oculta `{ symbol, currentTime, simulationStartTime, blindAnchor, blindScale, trades }`, y responde al `hello` que manda el segundo al abrirse
- Tiene su propio marco (1m a 4h) y su propia lista de indicadores, guardados en `app1_grafico2`. Los ajustes de cada indicador son los de la principal (las mismas claves de `localStorage`)
- No tiene reloj ni órdenes. Las velas salen de la IndexedDB que guardó la principal (`backtestingCache`), o del backend si no están: carga en segundos, pero ocupa otra vez la memoria de las velas
- Lo que se elige ahí para el análisis llega a la orden de la principal: `analysisLevels.js` escucha el evento `storage` de las otras pestañas
- No muestra los dibujos de la principal: en backtesting viven en la sesión, no en el backend. Con fecha oculta usa el mismo índice de precios
- **Cajas TP/SL** (12/11): la principal envía también las cajas de sus órdenes (`tradesForSecondary()`: lado, entrada, stop, objetivo, desde la ejecución o, si está pendiente, desde que se creó, hasta la salida). `MiniChart` las dibuja con `getTradeBoxes` usando `TPSLBox`, con la hora simulada como final mientras siguen vivas. Con la reproducción en pausa la principal reenvía órdenes y líneas cada segundo
- **Velas que se forman** (12/11): el reloj avanzaba con el paso del marco con que se creó (de 1h, 15 minutos), así que un 2.º gráfico de marco menor veía velas completas de golpe. El segundo avisa su marco (`hello` y `tf`, `bye` al cerrarse) y `TimeController.setStepTimeframes()` toma el paso del marco más fino a la vista, el activo o el del 2.º gráfico. Cambia solo la cantidad de estados intermedios, no la velocidad. Medido en la copia: con la principal en 1H y el segundo en 15M la hora pasó a avanzar de a 5 minutos; con la principal en 15m, la vela de 1H del segundo cambió cada 5 minutos simulados
- **Sin saltos con la principal atrás** (12/11): al mirar la pestaña del 2.º gráfico, la principal queda en segundo plano y el navegador frena sus `setInterval` a uno por segundo (a uno por minuto pasados 5 minutos). El reloj seguía bien la velocidad pero en saltos de un segundo: a 1000x, 16 minutos por salto; a 10000x, casi 3 horas. Ahora el tick lo marca un Worker (`startTicker()` en `TimeController.js`), cuyos temporizadores no se frenan, y el tick sigue corriendo en la página. Uno por reproducción, terminado al pausar; sin Worker queda `setInterval`. Medido en la copia a 10000x: el 2.º gráfico recibe la hora cada 120 ms, 20 minutos simulados por paso. El panel de pruebas no oculta las pestañas, así que el freno del navegador no se pudo reproducir allí
- **Una sola principal** (12/11): con dos pestañas principales abiertas (una vieja o una recargada), las dos respondían al `hello` y el 2.º gráfico saltaba entre sus horas. Cada principal manda `source` y el segundo sigue a una sola; pasa a otra solo cuando su hora avanza

### Ajustes propios del 2.º gráfico (12/11)

- La lista "Indicadores" del 2.º gráfico trae un ⚙️ por indicador con los mismos modales de la principal (los 15 que tienen ajustes, más "Setups (recetas)" desde Elementos OF). Aplican solo a ese gráfico
- `backtesting/secondaryStorage.js`: en la pestaña del 2.º gráfico, las claves de ajustes de los indicadores (`OWN_KEYS`: `orderflow_settings_`, `fvg_settings_`, `support_resistance_2_config_`, disposición de paneles, etc.) se leen y escriben con el prefijo `app1_g2:`. Mientras no se cambie nada ahí, se lee lo de la principal. "Restablecer" deja una marca y vuelve a fábrica, no a lo de la principal. Se instala desde `main.jsx`, antes que cualquier indicador, y desvía `Storage.prototype` solo para `localStorage`
- Siguen compartidos a propósito: lo elegido para el análisis, las velas fijadas de Liquidaciones, las recetas de los setups (`of_setups_`, una sola biblioteca) y el estilo
- El perfil de volumen guarda su configuración en `app1_grafico2`; VWAP, Swing y Confluencia OI no se guardan al recargar, igual que en la principal
- `installOwnSettings(storage, proto, prefix)` acepta otro prefijo (13/11): App 1 usa siempre `app1_g2:`, y la suite da `suite_p<n>:` a sus pestañas 3 a 5 (la 2 usa el de App 1)
- Prueba: `tests/secondarystorage.test.mjs` (7). Probado en la copia: los 15 modales abren en el 2.º gráfico, y un cambio en FVG quedó en `app1_g2:fvg_settings_BTCUSDT` sin tocar la clave de la principal

### 2.º gráfico fluido (12/11)

El 2.º gráfico seguía a saltos por encima de 1000x. Medido en la copia aislada con la principal en 1h y el segundo en 15m: recibía la hora solo cuando cambiaba la pantalla de la principal, 8.5 veces por segundo, y a 10000x cada aviso traía 20 minutos: más de una vela de 15m por dibujo. No era el navegador ni el costo del dibujo (2 a 4 ms).

- **Seguidor** (`backtesting/replayFollower.js`, lógica pura): en cada cuadro de la pantalla decide qué hora dibujar. Nunca una posterior a la última informada. Si un informe avanza más de un paso del reloj, recorre ese tramo a la velocidad de la reproducción, en minutos enteros; va un informe detrás, cerca de 0.1 s. En pausa, al retroceder, con un salto de más de 3 s de reproducción o sin velocidad informada va directo
- **La hora que viaja es la de la pantalla de la principal**, no la de su reloj, que va hasta 100 ms reales adelante: una orden toma su hora de la pantalla y el 2.º gráfico no debe mostrar más que eso. El `state` suma `playing`, `speed` y `step`, leídos del reloj
- **`SecondaryChartApp`**: un bucle de `requestAnimationFrame` (`runFrames`) pasa la hora del seguidor al estado `shownTime` solo cuando cambia, y se detiene cuando no queda tramo. `replay` guarda solo símbolo, inicio y fecha oculta. Al cambiar de simulación o de principal, la hora nueva entra en el mismo render que el símbolo y la fecha oculta. Trades y cajas van por refs y piden `redraw()` cuando cambian
- **Ritmo según el costo**: `MiniChart` mide sus dibujos por cambio de hora (`drawCost()`, baja de inmediato, sube de a poco y vence al segundo). El bucle deja entre dos avances 2.5 veces ese costo, hasta 250 ms: con miles de velas a la vista no satura el hilo
- **Paso de 1 minuto**: mientras un 2.º gráfico está a la vista, el reloj de la principal avanza de a 1 minuto (`stepTimeframes`, en minutos), o de a 5 si esa fecha no tiene velas de 1 minuto (`finestStep`). El segundo avisa cada 5 s mientras está visible (`hello`); sin aviso por 15 s la principal vuelve a su paso
- **Realineación**: si la hora quedó entre dos múltiplos del paso (se cerró el 2.º gráfico), el siguiente avance termina en el múltiplo y lo que faltó queda debido. Antes el reloj seguía corrido para siempre
- **Una sola principal** (`createSourcePicker`): cambia a otra si la seguida avisa que se cierra (`gone` en `pagehide`), lleva 15 s sin mensajes, o está en pausa y la otra avanza
- **De paso**: `days` memorizado; las velas se guardan con su símbolo; la clave del gráfico incluye el inicio de la simulación; las cajas TP/SL fuera de la vista no se arman; S&R clásico sin `console.log` por vela; la caché de `sessionProfile` saca el perfil menos usado
- **Medición a pedido**: `?grafico=2&medir=1` muestra en el encabezado horas recibidas y dibujadas por segundo, atraso y costo del dibujo

Medido con los cuadros reales del navegador, principal en 1h y segundo en 15m con 4 indicadores:

| Velocidad | Antes | Ahora |
|-----------|-------|-------|
| 1000x | 3.6 dibujos/s, 5 min cada uno | 16.5/s, 1 min |
| 10000x | 8.5/s, 20 min (1.3 velas) | 59/s, 3 min (0.2 velas) |
| 50000x | 9.5/s, 90 min (5.8 velas) | 59/s, 14 min (0.9 velas) |

Con 16 indicadores el dibujo cuesta 9 ms y queda en unos 32 por segundo. En ninguna corrida mostró una hora posterior a la de la principal ni retrocedió, y al pausar las dos pestañas quedaron en la misma hora.

**Pendiente:** al cambiar el paso, el reloj pierde el tiempo debido de menos de un paso; `liquidationPins.js` no escucha el evento `storage`, así que una vela fijada en una pestaña no llega a la otra sin recargar. Pruebas: `follower.test.mjs` (36) y `clock.test.mjs` (28).

### Observador en ventana aparte

- "Ventana aparte" en el encabezado del Observador. `PopupWindow.jsx`: la ventana se abre en el clic (`openPopup`) y el panel se dibuja en ella con un portal, así comparte estado y datos con la principal sin cargarlos otra vez
- Copia los estilos de la página (y los que Vite agrega después) y la clase y las variables del estilo, que viven en el body. Los modales del Observador (informe, visor de imágenes) se abren en esa ventana con `usePortalTarget()`, y el visor escucha el teclado en ella (`useHostDocument()`)
- La pestaña del Observador dice que está aparte y ofrece "Ir a la ventana" y "Traerlo aquí". Cerrarla a mano lo devuelve. "Ir al gráfico" trae al frente la principal
- El navegador puede bloquearla: hay que permitir las ventanas emergentes para la página

### Panel de trading en ventana aparte (12/11)

- Botón ⧉ en el encabezado del panel: sus pestañas y su contenido (`tradingPanelBody`) se dibujan en una ventana aparte con `PopupWindow`, compartiendo el estado. La barra lateral dice que está aparte y ofrece "Ir a la ventana" y "Traerlo aquí"
- La confirmación de orden y las imágenes del historial se abren en esa ventana (`usePortalTarget()`), y las flechas del historial escuchan su teclado (`useHostDocument()`)
- Probado con la ventana simulada por un marco: la orden se creó desde allí, su confirmación salió dentro de la ventana y "Traerlo aquí" devolvió el panel

### Más cosas para "Incluir en el análisis"

- **VWAP:** la línea y las bandas en cada vela a la vista (`VWAPIndicator.selectableLevels()`), como nivel que nace en esa vela. Con velas de menos de 3 px no se ofrecen
- **Paneles:** la columna de cada vela cerrada en Delta de volumen, CVD, Interés abierto, Confluencia OI y volumen y Volumen de Respuesta, con lo que el panel dice de ella (`panelReadings()` de cada indicador, `IndicatorManager.panelTargets()`). Llegan con `panel: true` y entran como marca en la vela, a su cierre: el aro se dibuja en el precio (`itemPositions`)
- **Volumen:** cada barra bajo el precio, con su volumen contra la media a la vista y si está en un cluster (`MiniChart`, `volumeBar: true`)
- `MiniChart` deja pasar los `panel` aunque estén fuera del área de las velas. Los paneles se ofrecen con lo dibujado en el cuadro anterior

### Caja de texto

- Botón "Texto" en la barra de dibujo. Al hacer clic en el gráfico la caja se crea, se abre para escribir y la herramienta vuelve al cursor. Doble clic sobre una caja la edita. Ctrl+Enter o salir del campo guarda; Esc cancela; vacío deja el texto anterior
- Con los estilos nuevos la caja toma el fondo del gráfico (blanco en los claros), borde gris oscuro (`THEME.textMuted`) y el texto del estilo, sin sombra; el Clásico conserva la nota amarilla. Una caja con colores propios en `style` los conserva (12/11)
- `TextBox.hitTest()` pedía `scaleConverter.canvas`, que no existe: daba error y la caja no se podía seleccionar ni arrastrar. Ahora mide con su propio lienzo

### Número de los trades

- `order.tradeNumber` se asigna al ejecutarse la orden (`nextTradeNumber`): una orden cancelada sin ejecutarse no gasta número. `order.id` sigue igual, porque une la orden con el registro, las imágenes y la caja TP/SL
- `tradeLabel()` lo muestra en historial, rendimiento, dashboard, Excel, visor de imágenes, líneas verticales y aviso del Observador. El registro lo guarda como `trade_number` (en la orden si es de mercado, o en el evento `fill`)
- Una sesión guardada antes se numera al cargarla (`numberTrades()`), por hora de ejecución

### VP de rango fijo con 400 niveles

- `VP_FIXED_ROWS` = 400 (antes 50) y el modal va de 50 a 1000, de a 10. Lo guardado antes con la escala vieja (sin `rowsV2`) pasa a 400; lo elegido después se respeta (`fixedRows()`)
- El reparto por velas recorre solo las franjas que toca cada vela: con 400 niveles recorrerlas todas costaría 8 veces más. Da lo mismo que antes

### Pruebas

`journal.test.mjs` (numeración), `levels.test.mjs` (400 niveles y reparto) y `observer.test.mjs` (`trade_number`). Probado en la copia aislada (9300/9301): caja de texto creada, escrita y editada; menú de análisis en volumen, delta, OI, confluencia y bandas del VWAP; segundo gráfico en otra pestaña, que avanzó con la principal (las dos en 12:50 tras reproducir a 1000x) y mostró lo elegido allá. El panel del navegador bloquea las ventanas emergentes: la del Observador se probó con `window.open` devolviendo un marco de la página (estilos copiados, informe abierto dentro y clics funcionando).

---

## INDICADORES SIN FUTURO (Noviembre 2026)

En backtesting, el parámetro `allCandles` de `renderOverlay` trae todo el historial, incluidas las velas futuras. Para calcular se usa `priceContext.knownCandles`, que llega hasta la hora simulada con la vela en formación al final. `priceContext.knownUntil` es la hora conocida y llega en cada dibujo, en cualquier pestaña.

| Indicador | Cuándo se ve | Cómo |
|-----------|--------------|------|
| VWAP | Velas cerradas: su punto. Vela en formación: con lo ocurrido | `_pointFor()` y `_formingPoint()`. El cálculo completo sigue usando `allCandles` porque repetirlo en cada vela sería muy lento, y un punto cerrado solo depende del pasado |
| Swing | `swingBars + 1` velas después de abrir la vela del swing | `_filterByPlaybackTime()`. `_getIntervalMs()` reconoce `1m` a `4h` |
| Rejection | Al cerrar la vela | `_closedCandlesToDetect()` y el salto de `in_progress` al dibujar |
| Rejection validado | Al cerrar la vela, y solo con niveles cuyo rango ya terminó | `_loadValidated()` en el frontend, `known_levels_only` en el backend |
| Double Top/Bottom | `knownAt`: cierre de la última vela que usa | `_set_known_times()`. Toma `candlesPerExtreme`, `postPatternValidationCandles` y `volumeWindowCandles` si ese filtro está activo |
| Flecha de entrada | `entrySignal.known_at`: cierre de su vela | Si `requireMomentum` está activo, el patrón completo espera a esa vela |
| Range Detection | Solo analiza velas cerradas al abrir o aplicar el modal | `closedCandles()` en `BacktestingApp`. Un rango automático guardado que termina después de `knownUntil` no se dibuja |

- **Duplicados de Double Top/Bottom:** `_deduplicate_by_zone()` decide en el orden en que se conocen. Si llega uno mejor, el anterior queda con `replacedAt` y se ve hasta esa hora. Antes un patrón podía desaparecer porque más adelante llegaba otro
- **Double Top/Bottom al activarlo:** `MiniChart` pasa sus velas a `updateIndicatorStates()`, que calcula al marcar la casilla y también si el indicador ya viene activo. `handleInitialize` no sirve para esto: corre antes de que existan los gráficos. Mientras calcula se ve "Double Top/Bottom: calculando...". El envío pesa cerca de 20 MB en 15m, 61 MB en 5m y 122 MB en 1m
- **Velas perdidas:** con `backtesting: true`, si `cache_key` no está en `DTB_CANDLES_CACHE` el endpoint responde `needsCandles` y el indicador las reenvía. Sin esa marca pediría velas recientes y daría patrones de otra fecha
- **Rejection validado:** `_loadValidated()` envía a `/api/rejection-patterns/detect` las velas cerradas visibles y las anteriores que necesita el Z-Score (21 por defecto), hasta 1,500 (`MAX_VALIDATED_CANDLES`). Hace una petición a la vez, con 400 ms entre ellas, y pide de nuevo si cierra una vela o cambian la vista, los contextos o los filtros
- **Niveles ya formados:** cuando llegan `candles`, el backend no pide velas recientes, usa `known_levels_only` y nunca envía alertas. `ReferenceLevel.known_from` es el `endTimestamp` del contexto: un contexto sin esa fecha no valida nada en simulación
- **VP dinámico como contexto:** queda fijo con los valores que tenía al agregarlo. No se actualiza en modo validado
- **Sin problema:** CVD, Volume Delta, OI y OI-Volume Confluence solo reciben las velas visibles

### Comprobar

```bash
cd frontend
node tests/leaks.test.mjs ruta\velas.json
```

Con el archivo compara Swing, VWAP y Rejection con velas reales, con y sin el futuro. El archivo trae `{ "5m": [...], "15m": [...], "1h": [...], "4h": [...] }`. `tests/test_dtb_known.py` compara Double Top/Bottom con todos los datos contra solo lo cerrado. `tests/test_rejection_known.py` comprueba que una vela no cambia con velas posteriores y que una simulación no avisa al bot.

---

## PROBADOR DE REGLAS DEL OBSERVADOR (17/11/2026)

Pedido del usuario: probar reglas sobre el histórico por fases, para que lo que se decide en la primera parte se compruebe con datos frescos en las otras dos. Sin reproducción: toda la fase en pantalla, con cada trade a la vista.

### Flujo

```
RuleTesterApp.jsx (?probador=1) + ruleTester.js          La regla, el informe y el gráfico
        │  POST /api/tester/run/{symbol}                   { rule, phase, confirm } → trabajo, o la corrida guardada
        │  GET  /api/tester/job/{id}                       Avance
        ▼
backend/rule_tester.py
   detect_span()   elementos de toda la fase (of_elements.detect por tramos de 60 días), en disco
   run()           of_setups.match_recipes() → simulate() por señal → resumen, cortes y azar
        ▼
OrderFlowData/observer/tester/   cache/*.npz (elementos por fase), runs/*.json.gz (cada corrida), runs.jsonl (registro)
        ▼
GET /api/tester/result/{id}  ·  /trade/{n} (medidas)  ·  /csv  ·  GET /api/tester/info/{symbol}  ·  POST /api/tester/sensitivity/{symbol}
```

### Fases

- `CUTS` = 2024-01-01 y 2025-07-01 (UTC). La fase 1 empieza 31 días después del primer día del almacén, por los umbrales de 30 días. La 3 empieza en el corte de los setups y termina en el último día del almacén.
- **Fase 1:** libre. Cada corrida queda en `runs.jsonl`: el historial dice cuántas variantes distintas se probaron.
- **Fases 2 y 3:** `start()` responde `needsConfirm` y la ventana pide confirmar. Una regla exacta ya corrida en esa fase no se recalcula: se devuelve la guardada (`gate()`, por `rule_hash()`, que no mira el nombre). La 3 exige que esa misma regla tenga corrida en la 2.
- El gráfico de las fases 2 y 3 queda tapado hasta que se pide verlo, y solo con una corrida hecha. Mientras tanto la hora del gráfico es el inicio de la fase.
- No hay días de separación entre fases. Lo que evita la fuga es que un trade abierto al final de la fase no cuenta (`open`): su salida está en la fase siguiente.

### Regla

- `clean_rule()` acota todo. La receta es la de `of_setups.clean_recipe()`: cada elemento elegido en la ventana es una casilla, con modo `strict` (todos) o `threshold` (al menos N), ventana, lado, swing, momentum y confirmación.
- **Entrada:** a mercado en la apertura de la vela siguiente a la que da a conocer la señal, o limit en la zona de los elementos que votaron (borde cercano, mitad o lejano), que se llena al cruzar y vence en N velas. Una limit del lado equivocado entra a mercado.
- **Stop**, con velas ya cerradas: último swing confirmado detrás de la entrada (`_pivot`, único extremo de su ventana), extremo desde la primera vela del elemento, borde lejano de la zona, o ATR. Más un margen en ATR. Una señal con el stop a más de `maxAtr` o menos de `minAtr` no se opera.
- **Salida:** objetivo en R, stop arrastrado al último swing confirmado a favor, cierre a las N velas y señal contraria. Sin ninguna, 96 velas.
- **Filtros:** hasta 3 medidas de `measures.py`, leídas a favor del trade en la última fila cerrada al conocerse la señal. Una señal sin medidas (antes del inicio de la tabla) no pasa un filtro.
- `invert` opera en contra del elemento. `oneAtATime` (de fábrica) salta las señales con una posición abierta; sin él cuentan todas.
- **Barrido de liquidaciones, LIQ (17/11, `liq_sweeps.py`).** No es de `of_elements`: lo calcula el probador al correr y no va al caché de la fase.
  - Swing: el único extremo de `swingBars` velas por lado (5). Barrido: la primera vela posterior que lo pasa; cada swing se barre una vez y deja de seguirse a los 30 días.
  - Zonas: la regla de `liquidationZones.js` (`buildZones` y `pickZones`: 30 días, franjas de 0.1%, 3 por lado a 6% o menos) con las celdas conocidas antes de abrir la vela del barrido y el precio de esa apertura. Una fuente por fecha, sin mezclar. Si esa regla cambia en el navegador, hay que cambiarla aquí.
  - LIQ: el swing cae en una zona mostrada, con 0.1% de margen. SWP: el mismo barrido sin zona; no se ofrece, es el control del informe (`result["control"]`).
  - `liq.what` (18/11): `swing` es lo anterior; `zone` barre la zona misma (`zone_sweeps`): el precio estuvo entero de un lado de una zona mostrada, que queda armada, y después una vela pasa su borde contrario. Bajar a través de la zona es alcista. Cada zona se barre una vez hasta que el precio vuelve a salir. La ventana abre con `zone`; una regla guardada sin `what` es `swing`. Calcula las zonas en cada vela: unos 30 s en la fase 1 de BTC 15m. SWP sigue siendo de swings.
  - **Lo que la regla vio, en el gráfico (18/11):** cada trade guarda `liq.zones` (las zonas mostradas en la vela del barrido: bajo, alto, USD, lado y si fue la barrida) y `marks` (código, hora y zona de cada elemento de la regla). Al elegir un trade, `tradeBands()` de `ruleTester.js` arma franjas, el nivel pasado y la marca del barrido, y `MiniChart` las dibuja debajo de las cajas con el prop opcional `getTradeBands`. Solo las del trade elegido. Las corridas anteriores no las traen: hay que volver a correr. El indicador Liquidaciones sigue mostrando las zonas del final de la fase.
  - `liq.variant`: `pierce` se conoce al cerrar la vela del barrido; `reclaim`, al cerrar la primera vela que cierra de vuelta, en `reclaimBars` velas o menos (3).
  - La zona del evento va del extremo del barrido al swing: el stop "Extremo de la vela del elemento" queda detrás del barrido.
  - Cada trade guarda `liq`: swing, antigüedad, extremo, profundidad en ATR, USD de la zona, lado liquidado, días desde su última liquidación y fuente. El CSV lo lleva en cinco columnas.
  - VH: vela con el doble del volumen medio de su misma hora en los 30 días anteriores, hacia su color.
- **Secuencia:** receta `sequence` con `sameBar` (solo del probador): el grupo 0 es el contexto (todos) y el grupo 1 el gatillo (al menos `groupMins[1]`), en la misma vela o después, dentro de `window` (hasta 10 en el probador; los setups siguen en 5).
- **Azar con stop del elemento:** con stop `candle` o `zone`, las entradas al azar usan un stop en ATR con la distancia mediana de los trades de la regla. Con el extremo de una sola vela salían con stops mínimos y -1.2 R por comisiones.
- **Ajustes de indicadores:** `ChartIndicatorSettings.jsx` abre los modales de la principal desde la lista "Indicadores" de la ventana. No usa `secondaryStorage`: lo cambiado vale también en la simulación manual. `SecondaryChartApp.jsx` conserva su propia copia de ese código.
- **Perfil por sesión, VR, VF y VX (18/11, `vp_sessions.py`).** Como LIQ, los calcula el probador al correr.
  - Perfil: la regla de `sessionProfile.js` (50 franjas entre el mínimo y el máximo de la sesión, POC en la de más volumen, área de valor del 70% creciendo hacia la vecina mayor), con las celdas reales del almacén. Sesiones en UTC, la semana desde el lunes; una sesión con menos del 90% de sus minutos no da niveles. Los niveles de la fase quedan en `tester/cache/vp_*.json` (15 a 20 s la primera vez).
  - Todo se mide contra la sesión inmediatamente anterior. `vp.accept` son minutos (30), que se pasan a velas del marco; `vp.failBars`, velas (3).
  - VR: la sesión abre fuera del valor y `accept` cierres seguidos quedan dentro; va al borde contrario; una vez por sesión. VF: con el cierre anterior dentro, una vela pasa el VAH o el VAL y en `failBars` velas una cierra de vuelta dentro; va al POC. VX: `accept` cierres seguidos fuera del mismo lado; sigue la salida; una vez por lado y sesión.
  - Zona del evento: VR y VF, del borde al extremo (el stop "borde lejano de la zona" queda detrás del extremo); VX, del POC al borde.
  - `targetAt`: `poc` o `edge` (borde contrario) en vez de R; solo con un elemento del perfil. Un objetivo a menos de 0.3 R o ya pasado no se opera. Las entradas al azar usan en R el objetivo mediano de los trades de la regla.
  - Cada trade guarda `vp` (POC, VAH, VAL, sesión, dónde abrió y extremo) y el gráfico dibuja ese valor al elegirlo.
  - **Forma del perfil anterior (18/11, `profile_shape`):** B con dos distribuciones (segundo pico con 60% del POC, a 15% del rango o más y un valle que baja al 60% del pico menor, sobre el perfil suavizado a 3 franjas); si no, por las colas fuera del área de valor: P con la cola de abajo más larga en 20% del rango o más, b con la de arriba, y D con las dos parecidas. La primera versión miraba solo el tercio del rango donde caía el POC y marcaba como D perfiles con dos nodos o con una cola larga: el usuario lo vio en pantalla. Va en `vp.shape` de cada trade. El informe corta por forma, por forma y lado, y por apertura de la sesión (`vpShape`, `vpShapeSide`, `vpOpen`); `vp.shapes` en la regla deja solo esas formas. En BTC 15m fase 1, sesiones de 1 día: 36% B, 29% D, 19% P y 16% b. El caché de niveles pasó a `vp3_*.json`.
  - **VE, extremo del valor (18/11):** para operar el rango tras un perfil D: la sesión abre dentro del valor anterior y el precio llega a un borde; compra en el VAL y vende en el VAH. `vp.veEntry`: `touch` sale al cerrar la primera vela que toca cada borde; `resting` sale al cerrar la sesión anterior (si cerró dentro de su valor) y fuerza la entrada a limit en el borde, válida toda la sesión. La zona va del borde al mínimo o máximo de la sesión anterior. `targetAt: "mid"` pone el objetivo en el centro de ese rango.
  - **Órdenes limit por orden de llenado:** con entrada limit y una posición a la vez, `run()` simula todas las señales y las toma por vela de llenado, no de señal (`defer`). Así conviven las dos órdenes de un rango y una señal posterior que se llena antes. Con entrada a mercado nada cambia.
  - VE en BTC 15m fase 1, sesiones de 1 día, orden esperando, stop detrás del extremo con máximo de 6 ATR: tras perfil D, al POC 270 trades, 59.6% y -0.09 R; al centro del rango 274 trades, 60.6% y -0.05 R (azar -0.13). Tras P, b y B, de -0.16 a -0.48 R. El perfil D separa, pero la regla no gana ni se distingue del azar. En sesiones de 8 h, -0.24 R tras D. Con la forma nueva, el indicio de VR tras P y b desapareció.
  - **Control con perfiles desplazados (18/11):** con un elemento del perfil, `run()` repite la regla 3 veces con `vp_sessions.shifted()` (los niveles de cada sesión movidos juntos, arriba o abajo, entre 30% y 100% de su rango; misma forma y distancias) y junta los trades en `result["vpControl"]`, con la diferencia y su margen. El informe lo muestra en "¿Aporta el perfil?". Suma unos segundos a cada corrida. Con VE y orden esperando el control tiene menos trades que la regla, porque pide que la sesión anterior cierre dentro del valor desplazado.
  - **Resultado en BTC 15m fase 1:** en ninguna de 18 combinaciones (VE, VR, VF y VX, sesiones de 1 día y de 8 h) el perfil real fue mejor que el desplazado con margen; en dos fue peor. VE tras perfil D: 59.6% y -0.09 R real contra 58.3% y -0.07 R desplazado. En la fase 2 el usuario comprobó VE: tras D 50.8% de acierto contra 36.0% tras las otras formas, pero -0.24 R contra -0.26, y peor que el azar (-0.16). Conclusión: los niveles del perfil por sesión no dan ventaja operable en BTC 15m con estas reglas.
  - Pendiente: POC sin tocar.
- **Cambio de carácter, CC (18/11, `structure.py`).** Pedido del usuario, de un setup de NQ en 4 horas que vio en un video: una tendencia de swings crecientes y una vela que cierra bajo su último mínimo abre un corto (al revés, un largo).
  - `cc.tf` es el marco de las velas de la estructura, que puede ser mayor que el de la regla (15, 30, 60, 240 o 1440 minutos, múltiplo del de la regla), y `cc.offset` los minutos desde las 00:00 UTC en que empiezan (810 = 13:30, la apertura de Nueva York en verano). Salen de unir las velas de la regla (`aggregate`). `cc.swing` (3) son las velas por lado del swing, el único extremo de su ventana, y `cc.legs` (2) cuántos máximos y mínimos seguidos van en la misma dirección.
  - El evento se conoce al cerrar la vela de estructura que rompe y cae en la vela de la regla que cierra a esa hora; una vela de estructura incompleta no dispara. Cada swing dispara una vez. La zona va del cierre de la ruptura al extremo de la tendencia: el stop "borde lejano de la zona" queda detrás del extremo, y con la estructura en 4 horas hay que subir `maxAtr`, que se mide en ATR de la regla.
  - Cada trade guarda `cc` (swing roto, extremo, marco) y el gráfico dibuja esas dos líneas al elegirlo.
- **Horario (18/11):** `hours` = `{from, to, weekdays}` en minutos del día UTC, sobre la hora en que se conoce la señal (el cierre de su vela, que es cuando se entra). Vale para cualquier regla; un horario que cruza la medianoche también. Lo que queda fuera va a `skipped` como "fuera de horario".
- **CC medido en BTC, fase 1** (regla de 15m, estructura de 4 h desde las 13:30 UTC, swing 3, 2 tramos, stop tras el extremo): con horario de 17:30 a 21:30 UTC de lunes a viernes, 49 trades, 59.2% y +0.15 R a 1R (azar -0.02, margen de la ventaja -0.11 a +0.45); a 2R, 44 trades y +0.30 R. Sin horario, 115 trades y -0.06 R. Con las velas de 4 h contadas desde las 00:00 UTC la sesión de Nueva York da +0.03 R. Operar al revés (seguir la tendencia) dio +0.28 R en una sola combinación y cambia de signo al mover el stop, el swing o el inicio de las velas: no se sostiene. Son 50 a 110 trades por variante: nada de esto pasa su margen.
- **CC en las tres fases y en otras monedas (18/11):** el usuario corrió la regla fija en BTC: fase 2, 23 trades, 65.2% y +0.27 R; fase 3, 21 trades, 23.8% y -0.52 R. Las tres juntas, 92 trades, 53.3% y +0.04 R: no se sostiene. La misma regla en la fase 1 de ARB, ETH, GALA, SOL, SUI y TRX: 124 trades, 52.4% y +0.02 R (±0.17). El resultado de la fase 1 de BTC fue suerte.
- **Monedas sin almacén de trades (18/11):** `has_store()` pide 60 días de almacén. Hoy lo tienen BTC, ETH, SOL, ARB y GALA, que corren con todos los elementos (la primera corrida de cada fase detecta los elementos: ETH 15m fase 1, unos 4.5 minutos). SUI y TRX no: sus fases salen del caché de velas de App 1 (`backtesting_cache/{moneda}_backtesting_data.json.gz`, `candle_bars()`, 30m uniendo las de 15m) y solo valen `CANDLE_CODES` (CC, VH y LIQ); `start()` rechaza una regla con otros elementos. Sin almacén no hay minuto a minuto: una vela dudosa sigue su recorrido supuesto (desde el 20/11; antes contaba el stop, ver "Azar con el minuto a minuto"). La ventana tiene un selector de moneda (`info.symbols`, las que tienen caché de velas) y apaga los elementos que no valen (`info.storeless`, `info.candleCodes`). `CANDLE_DIR` es relativa: el backend corre en `backend/`.
- **Patrones de rechazo como elementos (18/11):** `HM` (martillo alcista o estrella fugaz bajista), `EN` (envolvente) y `DJ` (doji libélula o lápida), con `candle_patterns.find_patterns()` sobre las velas de la regla: la misma regla del indicador Rejection Patterns. El lado lo da el patrón. `pat` = `{trend, trendBars, minZ, wick}`: tendencia previa (de fábrica sí, 5 velas), z-score mínimo del volumen de su vela contra las 20 anteriores (`None` = sin filtro) y mecha en cuerpos. La zona es la vela: el stop "extremo de la vela del elemento" queda detrás. Cada trade guarda `pat` (tipo y z). Solo necesitan velas: valen en las monedas sin almacén.
- **Filtros de línea (18/11), para cualquier regla:** `lines`, hasta dos, `{type: vwap|ema, period, mode: side|touch, slope}`. VWAP móvil: precio típico por volumen de las últimas N velas de la regla, con la vela incluida; EMA del cierre. Se miran en la vela que da a conocer la señal y a favor del trade: `side`, cierra del lado de la línea; `touch`, además su mecha la toca; `slope`, la línea va a favor en 5 velas. Sin línea todavía (menos de N velas) la señal no pasa. Lo descartado va a `skipped` como "filtro de VWAP o EMA". Cada trade guarda el valor de cada línea y el gráfico lo dibuja al elegirlo.
- **Patrones medidos en BTC, fase 1:** tras un patrón con volumen (z ≥ 2) el movimiento es 15 a 25% más grande que tras una vela cualquiera, pero sin dirección (a 16 velas de 15m, -0.25 ATR a favor del patrón). En 15m todas las variantes pierden igual o más que el azar. En 1h, con z ≥ 1: tocando la EMA 14, 291 trades y +0.01 R (azar -0.09); tocando el VWAP 200, 100 trades y -0.07 R; EMA 14 a favor con pendiente, 299 trades y 0.00 R. Ninguna pasa su margen, y lo que ganan lo ponen los largos.
- **Volumen de Respuesta como elementos (18/11, `response_volume.py`):** pedido del usuario tras estudiar el indicador. Usa `measures.py` (`zigzag`, `hour_volume`, `balance`, `equilibrium`), que repite `responseBalance.js`, con la ventana, las velas principales, el dominio y el equilibrio de fábrica. Todo se conoce al cerrar la vela.
  - `RF`, la flecha: vela con `rv.spike` veces (2) la mediana del volumen de su hora en 30 días. Su lado es el color de la vela. `rv.arrow`: `with` (de fábrica, la vela va a favor del tramo), `against` o `any`. La zona es la vela.
  - `RB`, el rombo: la respuesta iguala a la tendencia después de que esta dominó. `rv.rombo`: `turn` (de fábrica) lo opera contra el tramo, con la zona del cierre al extremo del tramo; `follow`, a favor, con la vela como zona.
  - `rv.leg` (2): ATR con que gira el tramo. Cada trade guarda `rv` (código, veces el volumen o extremo, y lado del tramo). Solo necesitan velas: están en `CANDLE_CODES`.
  - Las primeras velas de cada fase no dan flechas: el volumen por hora pide 5 días previos dentro de las velas de la fase.
  - **Estudio previo (scripts aparte, siete monedas, stop de 2 ATR):** el rombo no anticipa giro ni sirve para seguir el tramo, en 15m, 1h ni 4h, con ningún parámetro. La flecha a favor del tramo en 4h a 2R: fase 1, 657 trades, 38.2% y +0.12 R (±0.11); fase 2, sin tocarla, 549 trades, 41.5% y +0.21 R (±0.12), positiva en las siete monedas. Control, seguir el tramo en velas al azar con el mismo stop y objetivo: +0.04 R en la fase 1 (5 corridas) y +0.11 R en la fase 2 (8 corridas). La flecha queda de +0.07 a +0.10 R sobre el control, en el borde de su margen. La flecha contra el tramo no gana (-0.01 y -0.08 R). El elemento, por la ruta del probador, repite los 657 trades de la fase 1. La fase 3 no se gastó.
- **Todas las monedas (18/11, pedido del usuario):** `start_all(rule, phase, confirm)` y `consolidated(rule, phase)`, con `POST /api/tester/run-all` y `/api/tester/consolidated`.
  - `_plan()` dice qué pasa con cada moneda de `candle_symbols()`: `run`, `stored` (esa regla exacta ya corrió en esa fase; también en la fase 1, porque la corrida es determinista) o `skip` con su razón (sin datos de la fase, sin almacén para esos elementos, o falta la fase 2).
  - Un solo trabajo corre las monedas una tras otra y guarda cada corrida como una normal: queda en el Historial de su moneda. Una moneda que falla no detiene a las demás. El trabajo lleva `all`, `phase`, `plan`, `symbolsDone` y `symbolsTotal`.
  - Las fases 2 y 3 piden confirmar una vez, con la lista de lo que se va a correr. La 3 solo corre en las monedas con la 2 hecha.
  - `consolidated()` no guarda nada: junta las corridas guardadas de esa regla y fase. Da el resumen de todos los trades, la curva en orden de salida, por moneda (con su azar y su ventaja), por año, por lado y cuántas monedas quedan positivas. El azar conjunto es el de cada moneda pesado por los trades que la regla hizo en ella, con su margen.
  - En la ventana: botón bajo el de correr y pestaña "Todas". Un clic en una moneda abre su corrida (o cambia de moneda).
  - **Ver los trades (20/11, tras no encontrarlos el usuario):** Resumen, Trades y Patrones muestran la corrida de una moneda. Tras correr en todas, ninguna queda abierta, y esas pestañas lo dicen y señalan la tabla "Por moneda" de "Todas". La moneda de la ventana se abre ahí mismo. Otra moneda abre su ventana con la corrida en la dirección (`&run=`), que se abre sola con sus trades; antes quedaba en "Historial". El parámetro sale de la dirección al leerse, y solo vale una corrida de esa misma moneda. Probado con una copia del frontend y un backend aparte (9300) sobre una copia del registro: B5 en la fase 1, BTC con 119 trades y ETH con 112.
  - Las monedas con almacén detectan primero los elementos de la fase aunque la regla solo use velas: la primera vez son varios minutos por moneda y fase.
  - **Ventana con un solo elemento:** el campo solo se ve con dos o más elementos, y quedaba con el valor de una regla anterior (10 tras elegir LIQ). `toBackendRule()` envía 1 con un solo elemento.
- **Como cuenta (18/11, pedido del usuario tras preguntar por Sharpe y Sortino):** `accountStats(trades, riskPct)` en `ruleTester.js`, lógica pura. El selector `ModeSwitch` ("Por trade" o "Como cuenta", con el riesgo por trade) está en "Resumen" y en "Todas"; la elección y el riesgo quedan en `tester_view_v1`.
  - Cada trade arriesga `riskPct` % del capital que hay al entrar, y su resultado (R por lo arriesgado, ya con comisiones) entra a la cuenta al salir. A la misma hora, primero las salidas. Varias posiciones pueden estar abiertas a la vez: `maxOpen` y `maxOpenRisk`.
  - Retornos diarios en UTC, con los días sin cierres en cero. Sharpe = media ÷ desviación × √365; Sortino = media ÷ raíz de la media de los cuadrados de los días negativos × √365. Retorno anual compuesto, solo con 3 meses o más. Mayor caída sobre el capital en cada cierre. Meses positivos y peor mes.
  - Límite: el resultado entra al cerrar el trade, así que no se ve lo que se mueve una posición abierta: la caída real dentro del día puede ser mayor, y Sharpe y Sortino quedan algo altos. No cuenta financiamiento ni deslizamiento.
  - `consolidated()` suma `trades` (ternas entrada, salida y R) para esta vista. Un informe conjunto armado antes no las trae: se vuelve a pulsar el botón, que no recalcula nada.
  - Flecha de 4 horas (RF a favor del tramo, 2 ATR, 2R) en las siete monedas, 1% por trade: fase 1, +169% en 3.67 años (+31% anual), caída de 19.7%, Sharpe 1.21, Sortino 2.35, 29 de 45 meses positivos, hasta 7 posiciones a la vez; fase 2, +150% en 1.48 años (+85% anual), caída de 15.7%, Sharpe 1.99, Sortino 3.87, 13 de 18 meses. Solo BTC, 1%: +8.4% anual y Sharpe 0.82 en la fase 1; +11.1% y 1.00 en la fase 2. El riesgo por trade casi no cambia Sharpe ni Sortino: escala el retorno y la caída a la vez.
  - Prueba en `ruletester.test.mjs` (9). No se vio en pantalla: se comprobó que compila y se calculó con las corridas reales.
- **Botón de todas las monedas (18/11):** dice "Preparando…" desde el clic, y `start_all()` devuelve el trabajo que ya corre (`already`) en vez de lanzar otro. Antes un segundo clic corría todo dos veces.
- **Control "seguir el tramo al azar" (18/11, tras fallar la fase 3 de la flecha):** `_leg_baseline()` simula 3,000 entradas en velas al azar, siempre a favor del tramo en curso (`measures.zigzag` con `rv.leg`, o 2 ATR), con el mismo stop y la misma salida que el azar (`_random_rule()`). Va en `result["legBaseline"]` y `result["legEdge"]` (`_edge()`), en toda corrida con `base`.
  - `with_leg_baseline()` se lo pone a una corrida guardada antes, la primera vez que se pide (`/api/tester/result` y `consolidated()`), y la vuelve a guardar. No recalcula la regla ni sus trades: usa las velas de la fase ya en disco, y si faltan no hace nada. Unos 2 a 3 s por moneda en 4h.
  - `consolidated()` da el control conjunto, pesado por los trades de la regla en cada moneda, solo si lo tienen todas las monedas con trades. La tabla por moneda lleva "Vs. azar" y "Vs. tramo"; el azar y el tramo de cada una salen al pasar el mouse.
  - **Flecha de 4 horas con este control:** fase 1, tramo al azar -0.005 R y la flecha +0.151 por encima (de +0.05 a +0.26); fase 2, +0.031 R y +0.156 por encima (de +0.03 a +0.28). El control del estudio previo (+0.04 y +0.11 R) salió de unos 600 trades por corrida, tomados uno a la vez, y varió de -0.00 a +0.18: era ruido. La ventaja de las fases 1 y 2 era de la flecha, no del tramo.
  - **Fase 3 de la flecha (la corrió el usuario):** 491 trades, 35.0%, +0.009 R; azar -0.023; ventaja +0.032 (de -0.10 a +0.16); 4 de 7 monedas. Segundo semestre de 2025 +0.14 R y 2026 -0.06; largos -0.12 y cortos +0.13. Llegó a 1R en 47.7% contra 48.7% del azar. Como cuenta con 1%: -4.9% en 1.36 años, caída de 40.3%, Sharpe 0.09. No se sostiene: la regla queda descartada y no se ajusta con lo visto ahí.
  - Prueba en `test_response_volume.py` (6).
- **Barra horizontal del informe (18/11):** `.rt-equity` medía 100% más su borde, 2 px más que el panel, y con `overflow-y: auto` salía la barra en "Resumen" y "Todas". Ahora lleva `box-sizing: border-box`. En "Trades", "Patrones" e "Historial" la barra sigue cuando una tabla no cabe: ahí sirve para ver sus columnas.
- **Gaussian Channel, GC (18/11, `gaussian_channel.py`):** pedido del usuario: la estrategia estaba en el Strategy Builder de App 8 (`4.Analizador cripto/backend/strategy_engine.py`), que no se podía probar. Es el indicador de DonovanWall: filtro gaussiano de Ehlers de `poles` polos sobre (máximo + mínimo + cierre) / 3, con bandas a `mult` rangos verdaderos filtrados.
  - `gc` = `{period, poles, mult, trend, exit}`: 144, 4, 1.414, canal a favor y `band` de fábrica.
  - Entrada: la vela cierra sobre la banda superior y la anterior no (largo), o el espejo en la inferior (corto). Con `trend`, la línea central tiene que ir a favor. App 8 usaba una tolerancia de 0.05% que dejaba pasar cierres sin cruce; aquí el cruce es limpio, como en el guion original.
  - Salida propia (`gc.exit`): `band`, al cerrar de vuelta dentro de la banda; `mid`, al cerrar al otro lado de la línea central; `none`. Va por `ctx["exitAt"]` y `simulate()` la mira con la vela cerrada, así que también la usan las entradas al azar. Sale en la apertura siguiente, con motivo "sale del canal". Con ella no se impone el cierre a las 96 velas.
  - La zona va de la línea central a la banda: el stop "borde lejano de la zona" queda en la línea central. La estrategia original no trae stop; hace falta uno para medir en R.
  - El filtro arranca con el primer dato en vez de con ceros (App 8 saltaba a 5 veces el precio en las primeras velas), y las primeras `2 × period` velas de cada fase no dan señales: 48 días en 4h con periodo 144.
  - Cada trade guarda `gc` (línea central y bandas en la señal) y el gráfico las dibuja al elegirlo. Vale en las monedas sin almacén.
  - **Fase 1, siete monedas, sin objetivo ni cierre por tiempo:** 4h solo largos, stop en la línea central: 432 trades, 15.7%, +0.03 R; azar +0.19 (entrar largo al azar con la misma salida) y tramo +0.13; 2 de 7 monedas positivas, BTC +0.43. Con largos y cortos, 870 trades y 0.00 R. Con salida en la línea central, 192 trades y +0.19 R, por BTC (+1.33) y 5 trades de 2020. En 1h solo largos: 1,952 trades, 18.1%, +0.10 R, +0.15 sobre el azar (de +0.02 a +0.28), pero 3 de 7 monedas positivas, BTC +0.40 y 2022 en -0.10. Gana pocas veces y mucho: 16 a 18% de acierto.
  - No se probó en 1 día, que es donde más se cita: el probador llega a 4 horas. No se vio en pantalla.
- **Tope de desviaciones del VWAP (18/11, pedido del usuario):** `maxDev` en el filtro de línea `vwap`: la señal no pasa si la apertura de su vela queda a más de `maxDev` desviaciones del VWAP, del lado del trade (sobre la banda de arriba en un largo). `_vwap_dev()` da la desviación del precio típico alrededor del VWAP, pesada por volumen, en las mismas velas: la de las bandas del indicador VWAP en modo rolling. Solo entra a la regla si se pide, así una regla ya corrida conserva su `rule_hash`. Cada trade guarda `lines[].limit` y el gráfico dibuja ese tope al elegirlo. Lo descartado cuenta como "filtro de VWAP o EMA".
  - Flecha de 4 horas (RF a favor del tramo, 2 ATR, 2R), fase 1, siete monedas: sin filtro 757 trades y +0.146 R; VWAP 200 a favor, 612, 41.0% y +0.201 R (azar +0.01; BTC 133 y +0.35); con tope de 3 desviaciones 617 y +0.191; de 2, 553 y +0.157; de 1.5, 445 y +0.105; de 1, 332 y +0.097; de 0.5, 231 y -0.028. El tope no mejora: quita trades buenos. El VWAP a favor sí sube el R medio, dentro del margen (±0.12).
- **Caché de elementos por huella de las velas (18/11):** `_extra` guardaba los elementos de CC, patrones, RF/RB, GC, LIQ y perfil con `id(bars)` en la clave. Al soltarse una lista de velas, la de otra moneda podía recibir el mismo id y quedarse con los elementos de la anterior. Se vio con SOL: 20 trades en vez de 58 en una corrida de "todas las monedas", y 13 en vez de 47 en otra; 2 de 42 corridas. Ahora la clave es `_bars_key(bars)`: cantidad, primera y última hora, y sumas de máximos, mínimos, cierres y volumen. Las fases 1 y 2 de la flecha recalculadas moneda por moneda dan lo guardado (757 y 546 trades). La fase 3 del usuario no se recalculó: una corrida guardada con el fallo se queda así, porque una regla ya corrida no se recalcula. Pruebas: `test_structure.py` (9) y `test_response_volume.py` (7).
- **Marco de 1 día (18/11, pedido del usuario para el Gaussian Channel):** `TFS` suma 1440 (`DAILY`). `_on_candles(symbol, tf)` dice si la regla corre sobre velas: monedas sin almacén, y 1 día en todas. Ahí solo valen `CANDLE_CODES`; `start()` y `_plan()` rechazan lo demás, y la ventana apaga esos elementos (`candleOnly`).
  - `daily_bars()`: las velas de 4 horas del caché unidas por día UTC (`CANDLE_KEYS[1440]`; un primer día incompleto se descarta) y, antes de ellas, las del almacén de trades (`early_candles`). BTC: desde el 25/04/2020.
  - En 1 día el tramo lleva `warm`, las velas anteriores a la fase: `_gc_events()` y la salida por el canal calculan con ellas, así el canal no pierde sus primeras `2 × period` velas (288 días) en cada fase. Los demás elementos no las usan. En los otros marcos nada cambia.
  - El hueco que cierra un trade era fijo, 6 horas: con velas de 1 día ninguna señal entraba. Ahora es el mayor entre 6 horas y dos velas del marco.
  - El gráfico no tiene marco de 1 día: los trades se miran en 4h o menos.
  - **Gaussian Channel diario, fase 1, todas las monedas (144, 4, 1.414, canal a favor), sin objetivo ni cierre por tiempo:** solo largos, stop en la línea central, sale por la banda: 27 trades (BTC 4, ETH 12, TRX 6, SOL 4, GALA 1; ARB y SUI ninguno), 25.9%, +0.03 R; azar +0.27 y tramo +0.13. Saliendo por la línea central: 14 trades y -0.18 R. Largos y cortos: 87 trades y -0.01 R. Con stop de 3 ATR: 27 y -0.01 R. En la fase 1 de BTC el canal solo da señales desde febrero de 2021 (288 días de arranque desde abril de 2020). Muestra demasiado pequeña para concluir.
  - Solo se probó GC en 1 día; RF, LIQ, CC y los patrones corren pero no se revisaron. No se vio en pantalla. Prueba en `test_gaussian_channel.py` (6).
- **Velas anteriores al caché (18/11):** el caché de velas de App 1 guarda 5 años y la fase 1 empieza antes, así que los trades más viejos no se podían abrir en el gráfico (`focusOn` no encuentra la vela). `early_candles()` y `GET /api/tester/candles/{symbol}?tf=&before=` arman las velas del almacén de trades desde el inicio de la fase 1 hasta la primera del caché, y la ventana las antepone al cargar cada marco. Quedan en `tester/cache/velas_*.npz`. En BTC 15m son 54,718 velas y 7 s la primera vez. En 1m no se completan: serían millones.
- `cooldown` (17/11, 8 velas en la ventana, 0 en el backend): con una posición a la vez, velas de espera tras cerrar un trade; las señales de ese tramo quedan en `skipped` como "enfriamiento".
- `vaGap` (17/11, 0 de fábrica): hueco mínimo en ATR entre el área de valor y la vela que la abandona. La VA abandonada sigue la regla literal del libro y en BTC 15m marca el 9.1% de las velas; en el 43% el hueco es menor de 0.1 ATR y en el 51% el precio vuelve al área en 3 velas. Medido en la fase 1 con stop en el swing y 1R: pedir más hueco no mejora (0.25 ATR: -0.38 R contra -0.32 del azar).

### Simulación

- Comisión taker (0.055%) en entrada y salida; maker (0.02%) en una limit llenada. R neto = bruto − comisiones ÷ riesgo. Con stops muy cortos la comisión pesa mucho.
- Stop y objetivo en la misma vela, o stop en la vela en que se llena la limit: se mira minuto a minuto con `footprint_store.minutes`. En el mismo minuto cuenta el stop. Sin minutos de esa vela, su recorrido supuesto: apertura, el extremo más cerca de la apertura, el otro extremo y cierre (`_minute_path`, desde el 20/11; antes contaba el stop).
- Un hueco de datos de más de 6 horas cierra el trade en la última vela conocida.
- `reach`: lo máximo a favor en R antes de tocar el stop inicial, en 300 velas, sin importar la salida elegida. El informe da qué parte llegó a 1, 2, 3 y 5 R.
- **Azar:** 3,000 entradas en velas al azar con el mismo stop y la misma salida, a mercado y con la misma proporción de largos y cortos (el stop por zona pasa a vela), simuladas igual que la regla: con el minuto a minuto si la moneda lo tiene (desde el 20/11, ver "Azar con el minuto a minuto"). La ventaja es la diferencia de R medio, con margen de 1.96 errores estándar; `clear` solo si el margen no incluye el cero y hay 30 trades o más.

### Lo que guarda cada trade

- `votes` (elementos de la regla que dispararon), `present` (todos los elementos de su lado en la ventana, estén o no en la regla) y `against` (los del lado contrario).
- `measures`: las 58 medidas al decidir. No viajan con la lista: `/trade/{n}` las da y el CSV las trae todas.
- `_breakdowns()`: por año, lado, hora, salida y combinación; con y sin cada elemento de la regla, cada otro elemento presente y cada elemento en contra (al menos 5 trades por lado).
- `_winners_vs_losers()`: `patterns.compare_groups()` entre ganadores y perdedores.
- No se guardan los indicadores que solo calcula el navegador: VWAP, S&R, Swing, Double Top/Bottom y Rejection.

### Ventana

- `main.jsx` monta `RuleTesterApp` con `?probador=1&symbol=…`. La abre el botón "Probador de reglas" del Observador, en otra ventana, o el menú de inicio.
- **Menú de inicio con dos modos** (pedido del usuario el 17/11): "Simulación manual" (la reproducción de siempre, con su fecha de inicio) y "Backtesting global", que abre esta ventana en la misma pestaña. El modo elegido queda en `app1_start_mode`. "← Inicio" en el encabezado vuelve al menú. En la ventana el nombre a la vista es "Backtesting global".
- **Pestaña "Mis órdenes":** las órdenes manuales del símbolo, de todas las sesiones (`/api/observer/orders?limit=500`, con `registryChartView()`). Aquí no hay hora simulada: un clic cambia al marco de la orden, deja la fase y muestra el histórico completo (`ordersView`, hora del gráfico = final de la última fase) con la caja de cada orden. Eso deja ver fechas de las fases 2 y 3, y la pestaña lo avisa; "Volver a la fase" o elegir una fase lo quita. Muestra también las órdenes hechas con fecha oculta, con su fecha real.
- El gráfico es `MiniChart` en modo backtesting con `currentTime` = final de la fase: no hay reloj. Las cajas van por `getTradeBoxes` y el trade elegido por `getTradeBoundaries` y `focusOn()`.
- El marco del gráfico es aparte del de la regla (una regla de 30m se mira en 15m o 1h). Las velas salen del caché del navegador de la principal o, si faltan, se pide al backend solo ese marco.
- Los indicadores usan los ajustes de la principal. Las reglas guardadas quedan en `tester_rules_v1` y la vista en `tester_view_v1`.

### Lo que usó la regla en el trade elegido (20/11)

Pedido del usuario para depurar: al elegir un trade se veían la caja TP/SL y la del elemento, pero los indicadores de la regla solo se nombraban; no se veía cómo estaban ni con qué ajustes.

- **Backend:**
  - `run(..., trace=dict)` guarda el contexto de las velas, los elementos y qué pasó con cada señal:
    - el número de su trade;
    - o el motivo: posición abierta, enfriamiento, filtro de VWAP o EMA, filtro de CVD u OI, filtro de régimen, fuera de horario, filtro de contexto, limit sin llenar, abierta al final de la fase…

    Sin `trace` nada cambia (lo vigila una prueba).
  - `trade_context(run_id, n)` (`GET /api/tester/result/{id}/trade/{n}/context`) vuelve a correr la regla de la corrida guardada con `trace`, sin controles y con el tramo de la corrida (no el de hoy). Las últimas 3 quedan en memoria: en BTC 4h, fase 1, tarda 2 s la primera vez y después responde al instante.
  - Da una ventana de 150 velas antes de la señal y 60 después de la salida:
    - las líneas de la regla enteras: la EMA y el VWAP móvil, con su tope de desviaciones; el canal gaussiano, desde donde la regla lo puede usar;
    - todas las apariciones de sus elementos;
    - las cajas del detector del régimen;
    - una fila por filtro (líneas, CVD, OI, funding, OI sostenido, régimen, horario y medidas): si pasa en cada vela para el lado del trade, y su valor en la vela de la señal;
    - las señales con lo que pasó;
    - `same`: si al repetirla la señal da el mismo trade.
  - Todo sale de las mismas funciones de la prueba y sin nada que la regla no supiera en cada vela.
- **Ventana:**
  - `contextBands()` (`ruleTester.js`) arma las franjas, y `MiniChart` suma sus clases:
    - `line`: polilínea por el centro de cada vela de la regla, con su nombre;
    - `event`: aparición tenue de un elemento;
    - `ticks`: filas bajo las velas, verde pasa, rojo no pasa, gris sin dato;
    - `signal`: triángulo, relleno con trade y hueco sin entrar.
  - Van debajo de las de `tradeBands()`. Con las líneas enteras, se quita el tramo corto que marcaba su valor en la señal.
  - **La vela de la señal, de un vistazo** (pedido del usuario tras verlo: no se notaba si al abrir el trade se cumplía todo). `signalChecklist()` arma cada condición al cerrar la vela de la señal, que es cuando la regla decidió:
    - los elementos, con cuáles dispararon (✓ FVG nuevo ✗ Doji) y cómo se cumplía la receta (al menos 1 de 2, en 2 velas);
    - cada filtro de las filas, con su valor.

    En el gráfico (`checklistBand()`, clase `checklist`), encima de todo:
    - la vela de la señal resaltada de arriba abajo;
    - su casilla enmarcada en cada fila de filtros;
    - al lado, un cuadro con cada condición en ✓, ✗ o – y su valor.

    Un trade que se repite igual tiene todo en ✓: un ✗ dice que algo no cuadra.
  - **El recorrido del stop y la salida** (pedido del usuario al probar el trailing):
    - `simulate(..., path)` guarda el stop que rige en cada vela del trade. Se mueve al cerrar la vela y vale desde la siguiente.
    - `run(trace)` lo guarda por número de trade, y `trade_context` da `stopPath`, cada vela con su fase: inicial, entrada o arrastrado. Solo si la corrida repetida da el mismo trade. El recorrido no queda en la corrida guardada.
    - El gráfico lo dibuja en escalones (clase `steps`): rojo el inicial, gris a la entrada y naranja arrastrado. Cada fase lleva su nombre donde empieza.
    - La salida del trade elegido (clase `exit`, de `tradeBands()`) es una cruz verde o roja en su precio, con su motivo y su resultado: «Salida por tiempo · +22.87 R». La salida por tiempo, por señal contraria o por el canal va en el borde de la vela.
  - **Trades sin objetivo:** `tradeBoxes()` ya no usa la salida como TP.
    - Hasta el 20/11 la caja de un ganador salía con su zona verde hasta la salida y con el rótulo «TP», y la de uno que salió en la entrada o perdiendo, solo con la roja.
    - Ahora `noTarget` le dice a `MiniChart` que dibuje solo el riesgo (`TPSLBox.hideTarget`; los dibujos del usuario no lo usan), y la salida va como una marca al final de la caja.
  - Visto con la corrida del usuario con trailing (BTC 4h, fase 1, 114 trades, trailing a 3 ATR desde 1R, stop a la entrada en 1,5R y 24 velas):
    - trade 49: el stop pasó por las tres fases y estaba en 60,089 cuando salió por tiempo con +22.87R;
    - trade 25: el stop subió de 37,538 a 37,867 al llegar a +1R, pasó a la entrada en +1,5R y salió ahí con −0.03R.
  - **Detalle del trade:**
    - la casilla "Ver en el gráfico lo que usó la regla", de fábrica encendida, en `tester_view_v1`;
    - una tabla con cada condición al cerrar la vela de la señal (✓, ✗ o –, la condición y su valor), y si se cumplía todo;
    - las señales de la ventana que no entraron, con su motivo, en una lista plegable.
- **Probado:**
  - con la corrida de la B5 en BTC 4h, fase 1: sus 119 trades se repiten iguales; EMA 50, OI subiendo 2% en 6 velas, FVG y doji, y señales;
  - con corridas del registro que usan régimen (TRX), CVD (ZEC) y VWAP (TRX);
  - con una corrida armada en TRX con canal gaussiano, VWAP con tope, funding, OI sostenido y horario: 61 trades iguales;
  - en pantalla, en el backtesting global con la B5 en BTC.

  Pruebas: `tests/test_trade_context.py` (5, una para el recorrido del stop) y tres más en `ruletester.test.mjs` (12; la de las cajas, al comportamiento nuevo). La vela de la señal resaltada, su cuadro y la tabla se vieron en pantalla con el trade 2 de la B5 en BTC: los tres en ✓ (FVG nuevo; EMA 50 en 11698.7 con cierre en 11305.5; OI +6.89% en 6 velas).
- **Reglas en secuencia (20/11, después):** `trade_context` fallaba con ellas (KeyError): del disco, los mínimos por grupo de la receta vuelven con llaves de texto ("1") y `of_setups` las busca como números. `saved_rule(result)` las vuelve números antes de repetir la regla. Prueba en `test_trade_context.py` (6).
- **Los indicadores de la regla (21/11, pedido del usuario):** al elegir un trade se veían las marcas de sus elementos y las filas de sus filtros, pero no los indicadores. Con «Ver en el gráfico lo que usó la regla» marcado, el gráfico los enciende un rato, sin tocar la lista guardada.
  - **Cuáles** (`ruleIndicators()` de `ruleTester.js`):
    - de Williams: los sabios encienden «Tres sabios»; la barra divergente, el Alligator y el AO; el AO de tres barras, el AO; la ruptura de fractal, «Fractales» y el Alligator (si mira los dientes). Además, cada filtro el suyo: Alligator, zona, AO, AC, Gator y MFI;
    - la estructura SMC, con sus elementos, sus filtros o el objetivo en el rango;
    - los paneles de los datos que leen los filtros de flujo: CVD, «Open Interest» y «OI-Volume Confluence».

    Las líneas (EMA, VWAP, canal), las cajas y las demás marcas las sigue dibujando el contexto.
  - **Con los ajustes de la regla:** los de Williams y la estructura SMC calculan como el backend (`ruleWilliamsConfig`, `ruleSmcConfig`).
    - Williams: el Alligator, el AO y el AC con los de fábrica (los de `williams.py`), y los sabios con los de la regla. «Tres sabios» muestra solo los de la regla, y la entrada stop espera lo de la regla.
    - SMC: las longitudes de la estructura, el order block y los iguales de la regla, con premium/discount a la vista si la regla lo usa.

    Los colores y lo que se muestra siguen siendo los del gráfico. `MiniChart` recibe `indicatorOverrides` y los aplica a su `IndicatorManager` cada vez que lo crea; al quitarlos vuelven los guardados.
  - **En el marco de la regla:** al elegir el trade, el gráfico pasa a ese marco, porque en otro serían otros indicadores.
    - En otro marco, el detalle avisa y ofrece «Ver en 4H».
    - Una regla de 30m o 1D no tiene marco en el gráfico, y el detalle lo dice.
  - **Probado en pantalla** con una copia aislada y la regla de las corridas del usuario (los tres sabios, al menos 1, cierre del lado de los dientes) en BTC 4h, desde el gráfico en 15M o 1H:
    - fase 1, trade 215; fase 2, trade 6; fase 3, trade 2;
    - las líneas del Alligator, los sabios, los fractales y el panel del AO;
    - desmarcar la casilla vuelve a los indicadores de siempre.

    Prueba en `ruletester.test.mjs` (15).

### Objetivo arrastrado (20/11)

Pedido del usuario al probar el trailing: «un trailing take profit como lo haría un trading bot: que tenga un take profit fijo, que se active el trailing antes de llegar a él y arrastre el take profit hasta que se devuelva y se cierre en el valor nuevo».

- **Regla:** `exit.tpTrail` = `{start, dist, unit}` (`_tp_trail`), solo con el objetivo en R (`targetR`; con `targetAt` no entra) y solo si se pide: una regla sin él conserva su `rule_hash`.
  - `start`: R a favor en que se activa, recortado al objetivo (antes de él o en él, como 3Commas).
  - `dist` y `unit`: la distancia al mejor precio. `r`, del riesgo del trade; `atr`, el de la vela de la señal, fijo en todo el trade; `pct`, % del mejor precio, como el retroceso de un bot.
- **Simulación** (`simulate`):
  - Con `tpTrail` el objetivo fijo nunca cierra el trade (`goal` es None): el trailing se activa antes o en él y desde ahí lo arrastra. El trade guarda su objetivo fijo (`target`, para su caja) y `tp_on`, la vela en que se activó (None si nunca).
  - Desde la vela que llega al arranque, se mira dentro de la vela como una orden trailing del exchange: minuto a minuto o, sin minutos, el recorrido supuesto (`_minute_path`).
  - En cada minuto se mira primero si el precio toca el nivel más cercano (el stop vigente o el objetivo arrastrado) y después si el mejor precio sube el objetivo. Sale en ese nivel, o en la apertura si la vela abre más allá. En el minuto del llenado de una limit o stop solo cuenta el stop.
  - Motivo de salida: «objetivo arrastrado».
  - **Atajo:** si el extremo en contra de la vela no llega ni al nivel de antes ni al que deja su mejor precio, nada la puede cerrar, sea cual sea el orden de sus precios: se mueve el mejor precio sin leer sus minutos. Da lo mismo que mirar todo (40 variantes, 2,684 trades iguales, BTC con minutos y TRX sin ellos, a mercado y con limit, R, ATR y %).
  - El trailing del stop (`trail`, `breakEven`) sigue igual, al cerrar cada vela, y puede ir junto.
- **Minutos guardados** (`_minutes_of`): los minutos de cada vela quedan en el contexto de la corrida (`MINUTES_KEEP` = 1000, solo minuto, máximo y mínimo; se vacía si cambia el lector). En BTC 4h, fase 1, con el objetivo arrastrado, 3,202 lecturas eran de 852 velas a unos 5 ms cada una: la corrida con controles pasó de 20 a 10 s. Sirve también a las dos órdenes stop y a las limit.
- **Azar y otros:** `_random_rule` conserva `tpTrail`: el azar y el tramo usan la misma salida. La caja propia de la Revisión (`candidate_review._own_trade`) lo quita: sale en su objetivo. La sensibilidad mueve el arranque (×0.5, ×0.75, ×1.25, con tope en el objetivo) y la distancia (×0.5, ×1.5, ×2) en vez del objetivo.
- **Contexto del trade elegido:** el recorrido guarda por vela `[hora, stop, objetivo arrastrado al cerrarla o al salir]`. `trade_context` da `tpStart` (precio, R y vela en que se activó) y `tpPath`. `contextBands()` dibuja:
  - la línea del arranque, desde la entrada hasta que se activa (o hasta la salida, «no llegó»), con su rótulo arriba en un largo y abajo en un corto (`labelBelow`), donde no hay velas antes de activarse;
  - el objetivo arrastrado en escalones verdes (fase `objetivo` de la clase `steps`), con su rótulo solo si dura más de una vela: si no, la salida ya lo dice.

  El cuadro de la vela de la señal (`checklist`) va abajo, sobre las filas de filtros, en un largo (`below`): arriba tapaba el objetivo arrastrado.
- **Ventana:** "Arrastrar el objetivo desde [2.5] R, a [0.5] [R/ATR/%]" bajo "Objetivo" (solo con el objetivo en R), con una nota que explica cómo sale. El detalle del trade dice cuándo se activó. `describeRule`: «3R arrastrado desde 2.5R a 0.5R».
- **Medido** con la B5 de 108 trades del usuario (BTC 4h, fase 1, stop a la entrada en 1.5R), R por trade y azar:

| Salida | Trades | R | Azar |
|---|---|---|---|
| Trailing del stop a 3 ATR desde 1R (la del usuario) | 108 | +0.71 | +0.20 |
| Objetivo fijo 3R | 115 | +0.44 | +0.01 (margen +0.09 a +0.76) |
| 3R arrastrado desde 2.5R a 0.5R | 115 | +0.37 | +0.00 |
| 3R arrastrado desde 2R a 1R | 115 | +0.27 | +0.03 |
| 3R arrastrado desde 2.5R a 1.5 ATR | 112 | +0.48 | +0.10 |
| 3R arrastrado desde 2.5R a 3 ATR | 109 | +0.75 | +0.18 |

  Con 0.5R casi todos se cierran en la vela en que se activan: en 4h el precio se devuelve más que eso dentro de una vela. El arrastre amplio gana como el trailing del stop, y su azar también: es la tendencia de 4h. El margen de la ventaja solo deja de tocar el cero con el objetivo fijo. Es la fase 1 de una moneda.
- **Pruebas:** `tests/test_tp_trail.py` (12):
  - identidad;
  - el fijo cierra y el arrastrado sigue;
  - se devuelve antes del objetivo;
  - no llega al arranque;
  - se activa y sale en la misma vela;
  - los minutos mandan;
  - apertura más allá del nivel;
  - corto;
  - ATR y %;
  - recorrido por vela;
  - azar y Revisión;
  - contexto.

  Además, dos en `ruletester.test.mjs` (14). Probado en pantalla con una copia aislada: trades 3, 22 y 57 de dos corridas de la B5 (a 0.5R y a 1.5 ATR) y la sensibilidad. Seis corridas guardadas del usuario se repiten trade por trade con el motor nuevo.

### Panel de la regla más claro (20/11)

Pedido del usuario tras una corrida de 7 trades que parecía tener trailing y filtros que no eran. Los tenía, heredados de la B5 (EMA 50, OI subiendo 2% en 6 velas y trailing a 3 ATR), y en el formulario no se notaba. Eligió las ocho ideas que se le propusieron; las fichas de los elementos quedan como estaban.

- **`ruleFacets.js`** (lógica pura). `ruleFacets()` da las piezas activas de una regla en palabras, por sección (`FACETS`). Lee igual la regla del formulario (`toBackendRule`) que la de una corrida guardada (que pasó por `clean_rule`), y de ella salen:
  - `sectionSummary`: el resumen de cada sección plegada;
  - `facetPhrase`: las fichas de «Vas a correr»;
  - `ruleDifferences`: lo que cambió entre el formulario y la corrida (el nombre no cuenta);
  - `loadedSummary`: lo que trae una regla al cargarla;
  - `OFF_PATCH`: cómo apaga cada × su pieza;
  - `signalFunnel`: el embudo de señales;
  - `exitScale`: la escala en R de la salida.

  El cierre a las 96 velas que pone el backend sin otra salida (`DEFAULT_HORIZON`, también con solo la señal contraria) sale marcado `implicit`.
- **Formulario** (`RuleTesterApp.jsx`):
  - **Componentes:**
    - `Switch`;
    - `Opt`: una opción con su interruptor. Encendida resalta y muestra sus valores; apagada es una línea gris. Su ancla es `rt-opt-<pieza>`;
    - `Section`: plegable, con su cuenta y, plegada, su resumen. Su ancla es `rt-sec-<sección>`;
    - `ExitScale` y `Funnel`.

    Las secciones abiertas y «Vas a correr» quedan en `tester_view_v1` (`sections`, `planOpen`).
  - **Filtros:**
    - Tendencia: VWAP móvil, EMA y régimen;
    - Flujo: CVD, OI, multitud y OI sostenido;
    - Forma de la señal: extremo, momentum y confirmación;
    - Horario y medidas.
  - **Salida:**
    - el stop inicial, siempre;
    - el objetivo, con su arrastre colgando;
    - el trailing del stop, con su arranque;
    - el stop a la entrada, el cierre por tiempo y la señal contraria;
    - la salida por el canal del Gaussian Channel, que estaba junto a sus parámetros;
    - la escala en R;
    - en "Operación", una posición a la vez.
  - **Memoria de los interruptores:** un interruptor con modo recuerda el que tenía al apagarse (`lastModes`). Valen así VWAP, EMA, OI, multitud, régimen, canal, trailing y las medidas.
- **«Vas a correr»**, sobre el botón de correr, solo en la pestaña Regla.
  - La regla va en una línea. Debajo, una ficha por filtro, entrada, stop y salida. También salen la detección, si no es la de fábrica, y "todas las señales", si no va una a la vez.
  - La × apaga la pieza (`turnOff`).
  - Un clic lleva a su control (`goTo`): abre su sección, salta sin animación y lo resalta con `rt-flash`. Con animación no avanzaba con la ventana en segundo plano.
  - Plegado, queda una línea con la cuenta de filtros y salidas.
- **Aviso de la corrida** en Resumen y Trades: si el formulario ya no es la regla de la corrida a la vista, «Esta corrida usó: …». Cada diferencia lleva un enlace a su control, y el botón «Cargar la de la corrida» la pone en el formulario.
- **Embudo** en el Resumen (`Funnel`): las señales, las que se saltaron con una posición abierta, lo que quitó cada motivo de `skipped`, las abiertas al final de la fase y los trades cerrados.
- **«Regla nueva»**, tras confirmar: lo de fábrica, sin elementos ni filtros, con el mismo marco.
- **Al cargar una regla** (guardada, del Historial, del tablero o de la búsqueda; `loadBackendRule` y `loadFormRule`), un aviso con lo que trae.
- `describeRule` en secuencia: «A → 2 de B, C, D» en vez de «A → B + C + D».
- **Comprobado con el registro del usuario:**
  - de 887 reglas distintas, 848 cargadas en el formulario dan las mismas palabras que su corrida. Las otras 39 son reglas viejas de un elemento con ventana 10, que el formulario ya no permite: el aviso lo muestra;
  - la regla del formulario dice lo mismo antes y después de `clean_rule` en 915 reglas: las 887 y 28 variantes.
- **Pruebas:** `tests/rulefacets.test.mjs` (8).
- **En pantalla,** con una copia aislada, a 1366×700 y 840×700 y en Nítido y Oscuro.

### Medido y probado

- BTC 15m, fase 1 (1,346 días, 129,214 velas): 179 s la primera vez; después la corrida tarda segundos y la sensibilidad (8 variantes) 26 s. Fase 2, cerca de 90 s la primera vez.
- VA abandonada, stop en el swing de 5 velas, 2R, 200 velas: fase 1, 2,154 trades, 35.6% y -0.201 R contra -0.276 del azar (ventaja +0.075, entre -0.009 y +0.159). Fase 2, 863 trades, -0.221 R contra -0.324 (entre -0.007 y +0.213). No se distingue del azar.
- Pruebas: `backend/tests/test_rule_tester.py` (14: entrada, comisiones, minutos, limit al cruzar, sin objetivo, una posición, trade abierto, invertir, elementos presentes, swing confirmado, que lo cerrado no cambie con velas posteriores, azar, identidad de la regla y fases) y `frontend/tests/ruletester.test.mjs` (8).
- Probado en la copia aislada con el almacén real: fases 1 y 2 en 15m desde la ventana (gráfico, lista, patrones, CSV y candado), y por la ruta una regla de 30m con dos elementos, limit, sin objetivo, stop arrastrado y un filtro (105 trades). No se probó 5m, la fase 3 ni el botón desde el Observador.

### Trailing, dos órdenes stop, Impulso y Compresión (19/11)

Pedido del usuario: un bot de cripto que vio entraba hacia donde el precio empezaba a moverse con fuerza, con stop fijo y la ganancia con trailing; le funcionaba con fuerza y en horizontal salía casi siempre por el stop. Pidió el trailing primero y, además de entrar a mercado, probar las dos órdenes stop activas a la vez.

- **Trailing** (`exit.trail`): además de `swing`, `atr` (el stop a `trailAtr` ATR del mejor precio desde la entrada) y `pct` (a `trailPct` %). `trailStart`: empieza al llegar a tantos R a favor. `breakEven`: al llegar a tantos R el stop pasa a la entrada (motivo "stop en la entrada"). Se actualiza con cada vela cerrada y solo se acerca. Los campos solo entran a la regla si se usan (`_trail_extra`): una regla ya corrida conserva su identidad.
- **Dos órdenes stop** (`entry.type: "straddle"`, `from` `zone` o `close`, `offset` ATR, `expiry` velas): al cierre de la vela de la señal se pone una orden stop arriba y otra abajo (por fuera de la zona del elemento, o a `offset` ATR del cierre). Se llena la primera que el precio cruza, en su precio o en la apertura si salta por encima, y la otra se cancela (`_straddle_fill`); si las dos se tocan en la misma vela decide el minuto a minuto y, sin minutos, el recorrido supuesto de la vela. La dirección la pone el precio, no el elemento. Los filtros que miran el lado (VWAP, EMA, CVD, OI y las medidas) deciden qué órdenes se ponen. Cada trade guarda `trigger_atr`; el control al azar pone las dos órdenes en velas al azar a esa distancia mediana del cierre, y el del tramo solo la orden a favor del tramo.
- **Impulso, IM** (`fvg_swing.py`, `im` = `{bars, atr, range}`): el cierre avanzó al menos `atr` ATR en `bars` velas, hacia donde va; un evento al empezar el impulso; con `range`, la vela mide además ese alto. La zona va del mínimo al máximo del impulso.
- **Compresión, CP** (`box_elements.py`, `cp.maxHeight`): la vela en que se detecta una caja de la eficiencia con caja. Sin dirección: sale hacia los dos lados y va con las dos órdenes stop por fuera de la caja.
- **Medido.** Primero la salida sola, con 3,000 entradas al azar por moneda (fase 1, 4h, siete monedas; antes de 2023 · 2023): objetivo 2R, −0.03 · −0.03; 3R, +0.01 · −0.02; trailing a 1 ATR, −0.06 · −0.03; a 2 ATR, −0.03 · −0.05; a 3 ATR, −0.02 · −0.02; **stop 2 ATR y trailing a 4 ATR, +0.10 · +0.04** (a favor del tramo, +0.11 · +0.09). El trailing ajustado pierde por comisiones y salidas tempranas; el amplio gana algo solo porque en 4h hubo tendencias. Después, las reglas por el probador (azar y tramo de toda la fase):

| Regla | Antes de 2023 | 2023 | Azar · tramo | Monedas |
|---|---|---|---|---|
| Impulso ≥ 2 ATR en 3, stop 1.5, objetivo 3R | 415, +0.13 (±0.17) | 292, +0.22 (±0.21) | +0.01 · +0.03 | 6 |
| Impulso ≥ 2 ATR, stop 2, trailing 4 ATR | 395, +0.09 (±0.19) | 280, +0.37 (±0.37) | +0.12 · +0.17 | 5 |
| Igual, stop a la entrada en 1.5R | 402, +0.09 | 287, +0.34 | +0.10 · +0.15 | 6 |
| Impulso ≥ 3 ATR, trailing 4 | 121, +0.45 (±0.45) | 106, +0.64 (±0.69) | +0.14 · +0.18 | 4 |
| Impulso ≥ 2 ATR, trailing 4, fuera de las cajas | 214, +0.22 (±0.29) | 157, +0.69 (±0.62) | +0.17 · +0.23 | 6 |
| Compresión, dos stops a 0.2 ATR de la caja, trailing 4 | 216, +0.05 (±0.26) | 157, +0.45 (±0.55) | +0.21 · +0.31 (decía 0.00 · −0.03) | 4 |
| Igual, cajas ≤ 5.5 ATR | 197, +0.05 | 143, +0.47 | +0.21 · +0.32 (decía −0.01 · −0.04) | 4 |
| Compresión, dos stops, stop 1.5, objetivo 3R | 228, +0.09 (±0.23) | 161, +0.08 (±0.28) | +0.03 · +0.08 (decía −0.36 · −0.42) | 4 |
| Compresión, dos stops, stop al otro lado de la caja, trailing 4 | 203, +0.05 | 145, +0.22 | +0.11 · +0.20 | 4 |
| Ruptura de caja, EMA 200, caja ≤ 5.5, trailing 4 | 194, +0.33 (±0.34) | 139, +0.52 (±0.74) | +0.13 · +0.17 | 4 |
| FVG nuevo ≥ 0.3 ATR, trailing 4 | 562, +0.14 (±0.16) | 410, +0.33 (±0.29) | +0.12 · +0.17 | 5 |

  - Con trailing amplio todo sube, también los controles (+0.10 a +0.23): buena parte es la tendencia de 4h, no la entrada. Antes de 2023 casi ninguna regla con trailing supera a su control; en 2023 ganan más, pero con márgenes de ±0.3 a ±0.7, porque lo deciden pocos trades muy grandes. Con objetivo fijo de 3R la ventaja sobre el control es más clara y más estable: Impulso, Ruptura de caja con EMA y FVG nuevo.
  - **Corregido el 20/11:** las dos órdenes stop en velas al azar no pierden más que otra entrada: con objetivo 3R, +0.03 R. Este informe decía −0.36 R ("el precio toca una orden con el ruido y se da vuelta, lo mismo que el usuario vio en horizontal") y que la compresión se separaba del azar con margen: las dos cosas salieron del azar simulado sin minuto a minuto (ver "Azar con el minuto a minuto"). La tabla ya va con las dos correcciones de ese día, y en SUI y TRX cambia también lo de la regla. Con el azar corregido, las dos órdenes por fuera de una compresión no superan a ningún control, y con trailing quedan por debajo de los dos. La columna de monedas cuenta las que quedan sobre el azar corregido. En las monedas con almacén lo de la regla no cambia: siempre usó los minutos.
  - Se probaron 11 reglas más sobre los mismos datos: ninguna pasa a la fase 2 solo por esto.
  - Pruebas: `tests/test_trailing_straddle.py` (7).

### Azar con el minuto a minuto (20/11)

La primera búsqueda genética de la noche del 20/11 dio 5 finalistas que ganaban de +0.33 a +0.94 R sobre el azar en 2023 y perdían en las 43 monedas nuevas. Las cinco entraban con dos órdenes stop a 1 ATR del cierre, con stop de 1 ATR y sin objetivo.

- **El fallo:** la regla se simulaba con el minuto a minuto de la moneda (BTC, ETH, SOL, ARB, GALA y XRP lo tienen) y los dos controles al azar, sin él (`"minutes": None` en `_baseline`, `_leg_baseline` y el `_control` de la búsqueda). Sin minutos, una vela dudosa cuenta el stop. Con dos órdenes a 1 ATR del cierre y stop de 1 ATR, el stop queda en la apertura de la vela del llenado y su mínimo casi siempre lo toca: en el azar casi todo llenado en esa vela era una pérdida, y en la regla los minutos mostraban que el mínimo fue antes del llenado. La búsqueda encontró esa diferencia y la explotó. Pasa igual, en menor medida, con una entrada limit, cuya vela del llenado también se mira minuto a minuto.
- **Medido en la fase 1 de BTC:** la finalista 2 (Volumen alto con CVD y OI sostenido) da +0.86 R por trade con minutos y −0.42 sin ellos; el azar con sus mismas órdenes, +0.57 R con minutos y −0.36 sin ellos. Su ventaja real en BTC es de unos +0.29 R, no de +1.2. En ETH, +0.27 contra un azar de +0.10. Una regla a mercado (FVG nuevo con 1.5 ATR y 3R) no cambia: 0.00 en BTC y +0.02 en ETH.
- **La corrección:** los dos controles del probador y los de la búsqueda se simulan con el mismo lector de minutos que la regla. Sin minutos (las monedas nuevas salvo XRP, SUI, TRX y las acciones), los dos siguen el mismo recorrido supuesto de la vela (abajo). El azar con minutos tarda unos 7 s por cada 3,000 entradas con dos órdenes stop; a mercado casi no cambia.
- **Motor 3** (`ENGINE`): cada corrida nueva lo anota, con las dos correcciones (el azar con minutos y el recorrido supuesto). Las anteriores conservan lo suyo. En el registro del usuario las tocadas son 60 corridas con entrada limit en monedas con almacén (VA abandonada y las finalistas 1 y 5 de la búsqueda del 18/11); ninguna con dos órdenes stop. Ninguna de esas pasó una fase, así que ninguna conclusión a favor depende del fallo.
- **Sin minutos, el recorrido supuesto de la vela.** Contar siempre el stop no era solo pesimista. En una vela dudosa sin minutos el precio pasa ahora por la apertura, el extremo más cerca de la apertura, el otro extremo y el cierre: el supuesto del emulador de TradingView (`_minute_path`). Se comprobó contra los minutos reales en las seis monedas que los tienen, fase 1 en 4h, con la regla y sus dos controles en la misma suposición:

| Regla | Ventaja con los minutos reales | Contando siempre el stop | Con el recorrido supuesto |
|---|---|---|---|
| Dos órdenes a 1 ATR, stop 1, sin objetivo (finalista A2) | −0.16 (regla +0.38) | −0.07 (regla −0.45) | −0.18 (regla +0.41) |
| Compresión, dos órdenes, stop 1.5, 3R | −0.01 | **+0.13** | −0.03 |
| FVG nuevo con limit en la mitad, stop tras el hueco, 2R | +0.10 | +0.04 | +0.09 |
| FVG nuevo a mercado, stop 1.5, 3R | +0.21 | +0.20 | +0.21 |

  Contar siempre el stop erraba hasta 0.8 R por trade con dos órdenes, y con la compresión inventaba una ventaja de +0.13 R. El recorrido supuesto queda a 0.03 R o menos de la ventaja real en las cuatro (el recorrido por el color de la vela da casi lo mismo). Donde hay minutos, mandan los minutos. Por la ventaja real, la finalista A2 queda por debajo de seguir el tramo al azar con sus mismas órdenes: no era ventaja.
- Prueba: `test_sin_minutos_la_vela_dudosa_sigue_su_recorrido_supuesto_y_los_minutos_mandan` en `tests/test_trailing_straddle.py`: el recorrido en los dos sentidos, los minutos sobre el recorrido y los tres controles con los minutos de la regla.

### Acciones de Alpaca en el probador (20/11)

Pedido del usuario: probar reglas en acciones, con más historia, y cruzar mercados (elegir en uno y comprobar en el otro). Las velas las baja otra sesión ("Acciones de Alpaca en App 1", `alpaca_candles.py`, rama `claude/app1-acciones-alpaca-43f491`) a `OrderFlowData/alpaca/candles/{acción}.json.gz` (`ALPACA_CANDLES` cambia la carpeta): 99 acciones, velas de 15 minutos, 1 hora, 4 horas y 1 día desde 2016 (o desde que salieron a bolsa), solo de la sesión regular, ajustadas por splits. Aquí solo se leen.

- **Grupo "acciones"** (`candle_symbols("stocks")`, `stock_symbols`, `is_stock`). "Todas" sigue siendo todas las monedas: las acciones son otro mercado. Selector "Monedas: las acciones" en "Correr en todas las monedas", el grupo A en el tablero (comprobación en todas sus fases, como las monedas nuevas) y "y en las acciones" en la búsqueda (`checkStocks`: cada finalista se corre también en las acciones, en su fase 1).
- **Velas con su hora** (`_stock_bars`): las de 1h y 4h empiezan a las 09:30 de Nueva York (la última de 1h dura 30 minutos y la segunda de 4h, 2.5 horas) y el día a la medianoche de Nueva York. Se leen tal como vienen; llevarlas a la hora en punto, como se hace con las monedas, adelantaría lo que se sabe de cada vela.
- **Noches y fines de semana:** en acciones un salto de hasta 5 días no es un hueco de datos (`STOCK_GAP_MS`, por `ctx["gap"]`). El trade sigue abierto, y una apertura más allá del stop sale en la apertura.
- **Costos:** 0.02% por lado (`STOCK_FEE`), sin comisión, solo el spread. No cuenta el costo de pedir prestadas acciones para el corto.
- **Elementos:** solo los de velas, menos el barrido de liquidaciones (`codes_for`). El CVD se estima con cada vela; los filtros de OI y de funding no pasan, porque las acciones no tienen esos datos. `has_store` es falso para las acciones aunque exista su almacén de trades de Alpaca, que es del gráfico de la otra sesión.
- **Fases** con los mismos cortes: la fase 1 va de 2016 a 2023.
- **Gráfico de la ventana:** las monedas nuevas y las acciones piden sus velas a `/api/tester/chart-candles/{símbolo}`, que las lee del disco. Antes, una moneda nueva abierta en el gráfico se pedía a `/api/backtesting/bulk-data`, que la bajaba de Bybit y la guardaba en `backtesting_cache`: esa carpeta está en git y decide cuáles son las monedas de siempre. Las monedas nuevas tienen 1H y 4H; las acciones, 15M, 1H y 4H.
- **Medido:** el Impulso (≥ 2 ATR en 3 velas, stop 1.5 ATR, 3R) en las 99 acciones, fase 1 en 4h: 12,102 trades y +0.004 R por trade, contra −0.027 del azar (ventaja +0.03 ±0.03), positivo en 50 de 99. La regla más constante de cripto no muestra ventaja en acciones. Las 99 corren en 79 s.
- **Régimen medido en 1D (20/11, tras un informe del usuario: 0 trades en las 99 acciones):** el filtro armaba cada día con las velas de la regla y solo aceptaba días de 24 horas. Una acción tiene 2 velas de 4 horas por sesión (7 de 1 hora): nunca había un día completo y el filtro descartaba todas las señales. Ahora, en acciones, cuenta cada día de sesión (`_sessions`) y cada vela usa el día de sesión anterior al suyo, así un día solo se usa cuando ya terminó. En las monedas nada cambia.
  - Las corridas de acciones hechas antes con ese filtro no se reusan, no se cuentan y no se listan: cada corrida anota su versión del motor (`ENGINE` = 2, `_stale`). Las de antes siguen en el disco.
  - En las 99 acciones, fase 1 en 4h, la Ruptura de caja con EMA 200 y CVD, solo cortos y solo fuera del rango mayor medido en 1D: 115 trades, 26.1% y −0.06 R, contra −0.19 del azar (ventaja +0.13, de −0.21 a +0.47) y +0.01 sobre el tramo. El filtro de 1D casi nunca deja pasar la ruptura de una caja de 4 horas: en las monedas, fase 1, esa variante dio 48 trades.
  - Sin el régimen: 1,724 trades y −0.18 R, +0.09 sobre el azar (de +0.00 a +0.17) y −0.14 bajo el tramo (de −0.23 a −0.06).
- Pruebas: `tests/test_stocks.py` (6).

### Multitud, OI sostenido y constancia por trimestre (20/11)

Salió de entender por qué la Ruptura de caja con EMA 200 y CVD cayó en la fase 3 (análisis aparte, sin tocar la app):
- su ventaja venía de 4 trimestres de 23;
- pausar por resultados propios empeoraba todo;
- el régimen de BTC, la volatilidad, la amplitud de la señal y el nivel del OI no separaban los episodios;
- en 8 reglas y 50 monedas, **ir con la multitud** (funding) suele ser lo peor (contra − con, +0.10 R en la mediana, 11 de 14 casos);
- que **el OI venga subiendo de forma sostenida** ayuda un poco (+0.05 R, también en la fase 3);
- el Impulso era la regla más pareja por trimestre.

El usuario pidió llevar a la app las tres piezas que se repitieron.

- **Funding** (`funding_update.py`, `OrderFlowData/funding/{moneda}.json`; `TESTER_FUNDING` cambia la carpeta). Sin argumentos actualiza las que tienen archivo y las monedas del probador. `flow_filters.funding_3d()`: la suma de los 3 días anteriores al cierre ÷ 9, en equivalente por 8 horas aunque la moneda liquide cada 4 u 1 hora.
- **Filtro de la multitud** (`flow.crowd`): contra la multitud es un corto con funding > 0.01% o un largo con funding < 0; con la multitud, al revés; entre medio, neutro (`flow_filters.crowd`). `nocon` deja todo menos con la multitud; `contra`, solo contra ella. Sin funding no pasa. Cada trade guarda `flow.funding` y `flow.crowd`.
- **OI sostenido** (`flow.steady`, `steadyDays` 14, `steadyMin` 0.52): la parte de los pasos de 4 horas del OI de esos días en que subió (`flow_filters.oi_steady`), siempre con la serie de 4 horas (también en BTC, para que el umbral sea el mismo), y en cualquier marco de la regla. Con huecos (menos del 80% de los pasos) no pasa. 0.52 es el tercio alto medido en 50 monedas.
- Los dos van en "Filtros de flujo", solo entran a la regla si se piden, y los controles al azar entran donde ellos dejan, como el CVD y el OI. En la búsqueda son los genes `crowd` y `steady`, que empiezan apagados.
- **Constancia por trimestre:**
  - **Azar por trimestre:** el azar de cada corrida guarda su reparto por trimestre y lado (`baseline.quarters`). Una corrida guardada antes lo recibe la primera vez que se pide (`with_quarter_baseline`), sin cambiar la regla ni su azar de la fase; las del Gaussian Channel se quedan con el azar de la fase. De paso, los controles que se rearman (también el del tramo) ya respetan el régimen y los filtros de flujo (`_control_context`).
  - **Cálculo:** `quarter_rows()` mide cada trade contra el azar de su trimestre y lado; `consistency()` da los trimestres sobre el azar (solo los de 20 trades o más), la mediana de la ventaja por trade y qué parte de la ventaja ponen los 4 mejores.
  - **Informe "Todas":** sección "Constancia por trimestre", con un aviso si los 4 mejores ponen el 80% o más.
  - **Tablero:** columna "Trimestres +", un punto en la lectura y la cuenta en el porqué de "Las más sólidas" (`run_stats_v3`: la primera vez rearma el azar por trimestre de las corridas viejas, en segundo plano).
  - **Búsqueda:** "Elegir por: constancia por trimestre" (`fitness`), que usa la mediana de la ventaja de cada trimestre del tramo de búsqueda (con 4 trimestres o más). Cada finalista muestra la constancia de los dos tramos.
- **Ojo:** en la fase 1 de las monedas nuevas, la Ruptura de caja se veía bastante constante (9 de 11 trimestres, mediana +0.15, 4 mejores 78%); su dependencia de pocos episodios se veía recién con todas las fases. La constancia ayuda, no es infalible.
- Pruebas: `tests/test_crowd_constancy.py` (6).

### Tablero de estrategias (19/11)

Pedido del usuario: "no recuerdo cómo salieron las anteriores y dependo de Claude para saberlo", y que la app compare las métricas y diga cuál es más ganadora y por qué, como la lectura que se hacía con cada captura.

- **Pestaña "Estrategias"** del backtesting global (`StrategiesTab.jsx`) y `backend/strategy_board.py`, con `GET /api/tester/strategies` y `POST /api/tester/strategies/note`.
- **Una estrategia** es una regla exacta sin contar su nombre (`rule_hash` con un símbolo fijo); la misma guardada con dos nombres es una, y lleva los dos. Cada celda fase × grupo (las de siempre, S; las nuevas, N) junta la última corrida de cada moneda igual que el informe "Todas": mismo R, mismo azar pesado por trades y el tramo solo si lo tienen todas las monedas con trades. Comprobado con la copia del registro: da los números de los informes (por ejemplo 1,566 trades, +0.247 y ventaja de +0.135 a +0.320).
- **Pasa** (✓): ventaja sobre los dos controles con margen que no toca el cero, como se acordó, y además R medio positivo: perder menos que el azar no es ganar.
- **Lectura** (`analyze`): cada fase con su veredicto; si la ventaja se achica al pasar a datos frescos; si la pone un lado (con la sugerencia de probar solo ese lado); si una moneda pone el 40% o más del R; cuántas monedas ganan; años que pierden; pocos trades. "Comprobación" es todo lo que no se usó para elegir la regla: las fases 2 y 3, y cualquier fase de las monedas nuevas. Veredicto: cayó en tal fase, pasa todas, pasa N y le falta la fase 3, solo explorada, o no pasa ni la exploración.
- **"Las más sólidas"** (`rank`): solo reglas corridas en 2 monedas o más; primero las que no cayeron en ninguna comprobación, luego las que pasan más, y entre iguales la de peor margen inferior más alto, con el porqué en una línea.
- **Estado y nota** del usuario por estrategia (`strategy_notes.json` junto al registro). Un clic en una fase abre su informe "Todas" (con el grupo de monedas), y "Cargar en la pestaña Regla" la deja lista.
- **Resumen de cada corrida** en `cache/run_stats_v2.json` (con sus años). La primera vez se arma en segundo plano y la pestaña muestra el avance: con 430 corridas tardó unos 4 minutos, sobre todo por las viejas que reciben ahí el control del tramo. Después responde en décimas de segundo.
- Pruebas: `tests/test_strategy_board.py` (4). Probado en la copia aislada con una copia del registro real: tabla, orden, detalle, ancho del panel (sin barra horizontal) y nota guardada.

### Monedas nuevas y búsqueda con todas las piezas (19/11)

Pedido del usuario tras caer en la fase 3 la Ruptura de caja con EMA 200 y CVD: unas 50 monedas, para tener datos frescos, y que la búsqueda genética combine los elementos, el régimen, el trailing y las dos órdenes nuevas.

- **Velas** (`candles_update.py`): 1h y 4h de Bybit (futuros lineales USDT) desde 2020, en `OrderFlowData/candles/{moneda}.json.gz` (`TESTER_CANDLES` cambia la carpeta), fuera del repositorio: `backtesting_cache` está en git. `--pick 43` elige las 43 de más volumen en 24 h que cotizan desde antes de 2022, para que tengan las tres fases; sin argumentos actualiza las que ya tienen archivo. Elegidas el 19/11: XRP, ZEC, NEAR, DOGE, AAVE, ADA, UNI, AVAX, XMR, LINK, LTC, BNB, HBAR, XLM, BCH, ICP, CRV, DOT, FIL, DASH, ATOM, SHIB1000, STX, ETC, SAND, ALGO, AR, CRO, EGLD, VET, DYDX, RUNE, COTI, SNX, BICO, AXS, DUSK, BAT, THETA, GRT, COMP, BSV y ENS.
- **Grupos** (`rule_tester.candle_symbols(group)`): `base`, las 7 con caché de App 1, con las que se han elegido todas las reglas; `new`, las nuevas; `all`. `candle_bars()` lee el archivo nuevo cuando la moneda no tiene caché de App 1 (1h, 4h y 1D, que une las de 4h). XRP tiene además almacén de trades: corre con todos los elementos. Las demás, solo con los de velas.
- **Ventana:** selector "Monedas" junto a "Correr en todas las monedas" (`group` en `/api/tester/run-all` y `/api/tester/consolidated`); el informe "Todas" dice qué grupo es. Las fases se cuentan igual por fecha, y cada moneda tiene su propio candado de fases. Una regla elegida con las de siempre se puede comprobar en las nuevas en cualquier fase: ninguna regla se eligió mirándolas.
- **Búsqueda:** suma a los genes los elementos Ruptura y Borde de caja, Compresión, FVG nuevo, Swing e Impulso con sus parámetros; la entrada con dos órdenes stop (por fuera de la zona o a 0.2, 0.5 o 1 ATR del cierre; la Compresión siempre va con ellas); el trailing a 3 o 4 ATR o al 5%, con arranque en 1R y stop a la entrada en 1.5R; los filtros de CVD (20 o 50 velas) y OI (sube, confluencia o sin confluencia en contra), y el régimen (dentro, fuera o tras romper, con o sin el rango mayor). Cada pieza nueva empieza "apagada" y las opciones nuevas van al final de cada lista: un genoma guardado antes da la misma regla. Casillas para quitar cada grupo de piezas. **Los controles de la búsqueda entran en las mismas velas que deja el régimen y del lado que deja el filtro de flujo**, como los del probador. La complejidad cuenta también los filtros de flujo y el régimen.
- **Monedas nuevas al terminar** (`checkNew`, de fábrica): cada finalista se corre también en las monedas nuevas, en su fase 1, con los mismos dos tramos; no elige nada y solo se muestra al final.
- Pruebas: `tests/test_new_coins.py` (2).

### Ruptura de fractal sin futuro y monedas nuevas en 15m y 5m (21/11)

Pedido del usuario: una corrida de los sabios en 15m, fase 1, «en todas las monedas» tomó solo 8 y daba cifras prometedoras (684 trades, 52.9%, +0.21 R, 8 de 8 monedas positivas). Regla: Barra divergente → AO tres barras + Ruptura de fractal en 10 velas, a mercado, stop 2 ATR y 2.2R arrastrado desde 1.5R a 0.5R.

- **La ruptura de fractal miraba el futuro.** `williams.events()` fecha el 3.er sabio en la vela en que se supo el fractal y solo lo da si el precio lo pasa después. Eso sirve para la orden stop, que espera en el fractal (`info["expiry"]`) y se cancela si llega otro, como en el libro. Con entrada a mercado, limit o dos órdenes stop, la regla entraba antes de la ruptura sabiendo que ocurriría: en los 684 trades decidió antes de romperse el fractal y en 682 entró del lado de antes.
  - Ahora `events(..., at_hit=True)` lo fecha en la vela que pasa el fractal (`info["atHit"]`), y `_williams_events()` lo pide así salvo con la orden stop. La suite ya lo hacía bien (`wise_smc_watch.py`, `known_at` en la ruptura).
  - **Motor 4** (`ENGINE`): `_stale()` deja fuera las corridas anteriores con la ruptura de fractal y otra entrada que no sea la orden stop. Siguen en el disco, pero no se reusan ni se cuentan en "Todas" ni en el tablero.
  - La misma regla corregida, fase 1 en 15m, las mismas 8 monedas: 1,531 trades, 41.4% y −0.105 R, como el azar en cada moneda (ventajas de −0.18 a +0.03).
  - Prueba: `test_sin_orden_stop_la_ruptura_de_fractal_se_sabe_al_romperlo` en `test_williams_smc.py`.
- **Las monedas nuevas no tenían 15m.** `candles_update.py` bajaba solo 1h y 4h, y "Correr en todas las monedas" en 15m corría las 7 de siempre más XRP (que tiene almacén). Las otras 42 quedaban "para correr" en el plan y daban 0 trades sin decir por qué.
  - `candles_update.py --tf 15,5` baja también 15m y 5m desde 2020, cada marco en su carpeta (`OrderFlowData/candles/15/{moneda}.json.gz` y `.../5/`), para no hacer más lenta la lectura de 1h y 4h. Sin `--tf` actualiza los marcos finos que la moneda ya tenga. Reintenta un pedido que falla hasta 4 veces.
  - `candle_bars()` lee 5m, 15m y 30m (dos de 15m) de esas carpetas (`EXTRA_KEYS`, `EXTRA_FINE`). `has_candles()` dice sin abrir el archivo si una moneda nueva tiene ese marco, y `_plan()` salta la que no lo tiene con su motivo.
  - Sin almacén de trades, en esos marcos corren solo los elementos de velas, y una vela dudosa sigue su recorrido supuesto (sin minuto a minuto).
  - DOGE en 15m: 191,604 velas desde el 02/06/2021, 3 MB, 2:46 min.
  - Prueba: `test_las_monedas_nuevas_se_leen_aparte_de_las_de_siempre` en `test_new_coins.py`.

### Nombres de los elementos (19/11)

Pedido del usuario: las iniciales costaban. La ventana muestra un nombre corto en español en las casillas, la descripción de la regla (historial, "Todas", búsqueda), la lista y el detalle de los trades, los cortes por elemento y por combinación, la revisión y las notas: "Ruptura de caja", "FVG nuevo", "Desequilibrios apilados". El código y el nombre largo (el del libro) salen al pasar el mouse. Los nombres viven en `elementLabels.js`; los mensajes del backend usan los mismos (`rule_tester.LABELS`, que hay que cambiar junto con ese archivo). **Los códigos no cambian:** siguen siendo la identidad de las reglas y corridas guardadas. El indicador Elementos OF del gráfico principal sigue con sus códigos en los triángulos.

### Falta

- Modos de grupos y secuencia de las recetas, y casillas con códigos alternativos, en el editor de la ventana.
- Abrir la reproducción de la principal unas velas antes de una señal, con fecha oculta.
- Guardar por trade lo que marcan los indicadores del navegador.

## REVISIÓN DE CANDIDATOS POR SESIONES (18/11/2026)

Pedido del usuario: sus trades manuales (24 cerrados, 42% de acierto y +0.26 R ±0.71 al 18/11) rinden más que las reglas del probador, y cree que es por intuición que una regla rígida no recoge. Esto lo mide: una regla floja propone y él decide. Además notó que en una corrida de trades seguidos los primeros le salen peor, porque va leyendo el mercado: por eso las sesiones son un tramo seguido y en orden, no momentos sueltos.

```
RuleTesterApp.jsx, pestaña "Revisión" + candidateReview.js
        │  POST /api/review/start    { symbol, rule, days, anySymbol }
        │  POST /api/review/decide   { session, i, action, stop, target, seconds }
        │  POST /api/review/end      ·  GET /api/review/active/{symbol}  ·  GET /api/review/report
        ▼
backend/candidate_review.py → OrderFlowData/observer/review/sessions.jsonl   (solo se agregan líneas: session, decision, end)
```

- **Sesión:** una moneda y un tramo seguido de la **fase 1** (nunca de la 2 ni de la 3), de 7 a 120 días (28 de fábrica), elegido al azar, a 10 días o más del inicio de la fase y sin pisar un tramo ya usado si se puede. Entre 8 y 60 candidatos; con menos busca otro tramo.
- **Candidatos:** la regla de la pestaña "Regla" con `_generator()`: cada señal cuenta (sin una posición a la vez ni enfriamiento) y a mercado. Salen de `rule_tester.run()` sobre la fase 1, con lo que la regla habría hecho en cada uno. En una moneda con almacén la regla tiene que haber corrido antes en la fase 1 (`_ready()`): la revisión no detecta elementos.
- **Decisión** (`decide`): `rule` (como propone la regla), `long` o `short` con stop y objetivo propios, o `skip`. Solo sobre el candidato a la vista. El trade propio entra en la apertura de la vela siguiente y se simula con `rule_tester.simulate()` (comisiones, minuto a minuto, cierre por tiempo de la regla), con el stop como ATR y el objetivo en R equivalentes.
- **Sin futuro:** `public()` es lo único que sale del servidor. Del candidato a la vista da hora, lado, entrada, stop y objetivo propuestos. El resultado de una decisión (`r`) y lo que hizo la regla ahí (`ruleR`) salen solo si su salida es anterior a la hora del candidato a la vista, o al terminar la sesión. `report()` aplica lo mismo a una sesión sin terminar.
- **Ventana:** el gráfico llega hasta el cierre de la vela del candidato (`chartTime`), con fecha y precio ocultos (`blindClock`, índice fijado por el id de la sesión) y solo las cajas de las decisiones de la sesión. Se puede retroceder, cambiar de marco y usar los indicadores. "Dibujar caja larga" y "Dibujar caja corta" activan la herramienta TP/SL; `boxDecision()` lee la última caja libre (`latestFreeBox`) y avisa si su stop o su objetivo no cuadran con la entrada real. Al decidir, `MiniChart.followLatest()` (nuevo en su ref) vuelve a la última vela. Una sesión sin terminar se retoma al abrir la ventana de esa moneda. Con "moneda al azar" la ventana cambia a la moneda elegida.
- **Informe** (`_summary`): tus trades; esos mismos como la regla; los que dejaste pasar (con el resultado de la regla); la regla en todos. `selection` = lo tomado menos lo dejado, los dos medidos como la regla: lo que agrega elegir. `overRule` = tus trades menos tomar todos: el criterio completo (elegir, lado, stop y objetivo). Cada diferencia con su margen, y `clear` solo con 30 por grupo. Por lugar en la sesión (1 a 5, 6 a 10, 11 a 20, 21 en adelante) con la mediana de segundos por decisión; tras un trade ganado y tras uno perdido (el último ya cerrado al decidir).
- **Seguir el trade (pedido tras la primera sesión):** con `follow` (casilla "Tras entrar, seguir hasta que el trade cierre", marcada de fábrica), el candidato siguiente es el primero posterior a la salida del trade más `AFTER_BARS` (8) velas. Los candidatos de ese tramo quedan con la acción `passed`: no cuentan como tomados ni como dejados (`_summary` los saca y da `passed`). Así se ve cómo terminó el trade y qué hizo el precio después, que es lo que le da al usuario la lectura del mercado. Una sesión terminada muestra el gráfico hasta `until` (lo último decidido y la salida de cada trade con esas velas), no hasta el final de la fase.
- **La caja entra como limit (pedido tras ver que un trade de 2 a 1 contaba +0.68 R):** la caja se tomaba a mercado en la apertura de la vela siguiente, con solo su stop y su objetivo, y el riesgo beneficio real era otro (0.74 a 1 en ese trade). Ahora, con "Entrar en el precio de mi caja (limit)" (de fábrica), `decide(..., entry=precio)` deja una limit en la entrada de la caja: espera `LIMIT_BARS` (12) velas y se llena al cruzar, con comisión maker; si la apertura siguiente ya es mejor que ese precio, entra a mercado. Una limit que no se llena queda con `unfilled` (su hora de vencimiento): no es un trade ni un "no entro" y el informe la cuenta aparte. Sin "seguir", una limit que aún no se sabe si se llenó sale como `pending`. Los trades anteriores a este cambio quedaron a mercado. Pruebas: 8.
- **Una caja a la vez (pedido del usuario: todas juntas agobian):** el gráfico muestra solo la caja del último trade de la sesión, o la del trade elegido en la lista de decisiones (`reviewPick`). La caja dibujada con que se decidió sale del gráfico al decidir: queda la del trade simulado.
- **La orden sin llenar se sigue viendo:** cada decisión propia guarda `plan` (lado, entrada, stop y objetivo pedidos). Si la limit no se llena, el gráfico dibuja esa caja desde el candidato hasta su vencimiento (`expired`), para ver que el precio no llegó. La espera de la limit se elige en la ventana ("y esperar N velas", 48 de fábrica, hasta 500, guardado en `tester_view_v1`; `wait` en `decide`).
- **Dibujo:** botón "Dibujo" en la barra de la ventana (no solo en revisión) con las herramientas de la simulación manual, deshacer, rehacer y borrar todos. Los dibujos se guardan en `drawingsRef` y se devuelven al gráfico cuando se monta de nuevo al cambiar de marco (`keepDrawings`, `chartKey`); se pierden al cerrar la ventana, y una sesión nueva empieza sin ellos.
- **Límites:** el nombre de la moneda se ve. El trade propio no usa la salida por el canal del Gaussian Channel ni stop arrastrado. La regla que propone decide qué se llega a ver: lo que el usuario habría operado fuera de esos momentos no se mide. No guarda todavía las medidas ni los elementos presentes de cada candidato (falta para armar una puntuación).
- **Pruebas:** `tests/test_candidate_review.py` (6) y `frontend/tests/candidatereview.test.mjs` (3). Probado en la copia aislada con BTC 4h y la flecha: sesión de 23 candidatos, decisiones, caja corta propia, retomar tras recargar, terminar e informe. No se probó la moneda al azar, 15m ni una sesión completa.

## BÚSQUEDA GENÉTICA DE REGLAS (18/11/2026)

Pedido del usuario tras leer los artículos de algoritmos genéticos en trading (Brabazon y O'Neill, Ruggiero): usar la "gramática" que ya tiene el probador para que un algoritmo genético busque combinaciones en la fase 1, con reglas contra el sobreajuste, y llevar a la fase 2 solo lo prometedor.

```
RuleSearchTab.jsx (pestaña "Búsqueda")
        │  POST /api/search/start   { config } o { resume: id }
        │  POST /api/search/stop/{id}  ·  GET /api/search/{id}  ·  GET /api/search/list
        ▼
backend/rule_search.py → rule_tester.run() de cada moneda, sin controles propios del probador
        ▼
OrderFlowData/observer/tester/search/{id}.json   (RULE_SEARCH_DIR cambia la carpeta)
```

- **Genoma:** un índice por gen sobre opciones fijas (`GENES`): marco (1h, 4h, 1D, los elegidos), hasta 3 elementos de `CANDLE_CODES` (LIQ fuera de fábrica, es lento), todos o todos menos uno, ventana, invertir, parámetros de RF/RB, patrones, CC, GC y LIQ, entrada (mercado o limit cerca o a la mitad), stop (1, 1.5, 2 o 3 ATR, swing de 3 o 5, vela del elemento, borde de la zona; `maxAtr` 8), objetivo (1 a 5 R o ninguno), stop arrastrado, cierre por tiempo, señal contraria y un filtro de línea (VWAP 50 o 200 a favor, EMA 14 tocando, EMA 50 o 200 a favor, con pendiente opcional). `decode()` lo pasa por `clean_rule()`: cada individuo es una regla válida. Los genes que la regla no usa no cambian su identidad (`rule_hash`), así no se cuenta dos veces.
- **Solo velas:** la regla corre en las siete monedas con `detect_span` de la fase 1, igual que el probador. En 1h, las monedas con almacén detectan los elementos de la fase la primera vez (varios minutos cada una).
- **Partición de la fase 1:** `split` (01/01/2023 de fábrica, entre 01/06/2021 y tres meses antes del fin de la fase). Tramo de búsqueda: trades que salen antes de `split`. Validación: trades que entran desde `split`. Un trade que cruza la fecha no cuenta. La validación se calcula para cada regla, pero no entra en la aptitud ni en la selección, y `summary()` no la entrega hasta que la búsqueda terminó.
- **Controles:** por moneda y tramo, 1,000 entradas al azar con el mismo stop y salida (`_random_rule`), guardadas por lado y mezcladas con la proporción de largos de cada regla, y 1,000 a favor del tramo en curso. Se usa el mejor de los dos. Se guardan por stop y salida, así los comparten las reglas que solo difieren en la entrada. Se simulan con el minuto a minuto de la moneda, como la regla: hasta el 20/11 iban sin él, y la primera búsqueda de esa noche convergió en dos órdenes stop que solo ganaban por esa diferencia (ver "Azar con el minuto a minuto").
- **Aptitud:** ventaja = R de la regla − control, pesada por los trades de cada moneda; aptitud = ventaja − su error estándar − 0.02 R por pieza extra − 0.05 R por moneda que falte para `minCoins` a favor (monedas con 10 trades o más). Con menos de `minTrades` queda por debajo de -1.
- **Algoritmo:** población (60), generaciones (25), torneo de 3, cruce uniforme, mutación por gen (0.1), 4 élites y un 10% de reglas nuevas al azar por generación. Las reglas ya probadas no se vuelven a correr. El estado se guarda al terminar cada generación; "Detener" corta al terminar la regla en curso y "Retomar" sigue desde la última generación guardada (también si se reinició el backend).
- **Al terminar** (`_finish`): hasta 5 finalistas con 3 o más genes distintos entre sí, de las que llegan al mínimo de trades; para cada una, sus vecinas (cada gen activo movido a la opción de al lado), marcadas `origin: "neighbor"`. Veredicto: "Candidata a la fase 2" con 30 trades o más en la validación, ventaja positiva ahí y el 60% de las vecinas con ventaja; si no, "frágil", "no se sostiene" o "pocos trades". El informe suma el umbral de suerte (mediana del error estándar × √(2 ln N), con N reglas probadas, vecinas incluidas), la validación del 10% con mejor aptitud contra la de todas, y la correlación por rangos entre tramo y validación.
- **Lo que no hace:** no toca las fases 2 y 3 ni anota nada en `runs.jsonl`. Una finalista se carga con "Cargar en la pestaña Regla" (`fromBackendRule`) y desde ahí se corre como cualquier regla. La receta lleva `swing.flex` 1, como la manda la ventana, para que la regla cargada conserve su identidad (lo vigila una prueba con node).
- **Costo:** sin tokens, todo en el backend. En 4h, una regla en las siete monedas tarda 2 a 4 s (la mitad son los controles); la primera vez, 23 s más por las zonas de liquidaciones que usa VH. 60 × 25 son una a dos horas, en el mismo proceso del backend: las demás rutas siguen respondiendo, más lentas.
- **Pruebas:** `tests/test_rule_search.py` (6): genomas válidos, genes inactivos, aptitud, que la validación no cambia el tramo de búsqueda (cortar las velas en la fecha deja lo mismo), una búsqueda completa con su archivo, y la ida y vuelta por la ventana.
- **Probado** en la copia aislada (backend 9300, Vite 9301) con una búsqueda de 10 × 2 en 4h: 87 reglas, ninguna candidata; la pestaña, el avance, el resultado y "Cargar en la pestaña Regla". No se probó en 1h ni en 1D, ni una búsqueda larga.
- **Búsquedas anteriores arriba (20/11, pedido del usuario):** la lista estaba al final del panel, bajo el informe de la búsqueda abierta, y no la encontraba. Ahora va al principio de la pestaña, antes de "Búsqueda nueva". "Ver" abre la búsqueda y lleva el panel a su informe (`scrollIntoView`), y la fila de la búsqueda abierta dice "Abierta". Una búsqueda copiada a `tester/search` aparece en la lista sin reiniciar nada: `history()` lee la carpeta en cada pedido. Probado con una copia del frontend en el 9002 y el backend del usuario.

### Noche de búsquedas y fase 2 (20/11)

Pedido del usuario: varias búsquedas seguidas, sin intervenir, y probar de una vez en la fase 2 las mejores. La selección se fijó antes de ver resultados (`PLAN.md`): candidata en la búsqueda, ventaja > 0 en la fase 1 de las 43 monedas nuevas, hasta 3 por búsqueda. El criterio para la fase 3 es el acordado: en la fase 2 de las monedas de siempre, ventaja sobre el azar y sobre seguir el tramo con margen por encima de cero, y R positivo. Todo en 4h, 60 × 25, tramo hasta el 31/12/2022 y validación en 2023, con el motor 3. Resultados, reglas y registros propios en `OrderFlowData/research/busqueda_genetica/2026-11-20/`; el registro del usuario no se tocó.

| Búsqueda | Elegir por | Reglas | Candidatas | 2023: el 10% con mejor aptitud · todas |
|---|---|---|---|---|
| A | constancia, semilla 2611 | 1,483 | 0 (las 5 son envolventes) | −0.12 · −0.05 |
| B | promedio, semilla 2611 | 1,493 | 5 (todas con el FVG nuevo de 0.6 ATR o más) | +0.10 · +0.01 |
| C | constancia, semilla 1120 | 1,498 | 0 (rombos y envolventes) | −0.24 · −0.06 |

- **Constancia contra promedio.** Con la constancia por trimestre, las reglas con mejor aptitud fueron peores que el promedio en 2023: se sobreajustaron. Con el promedio siguieron arriba. La correlación por rangos entre el tramo de búsqueda y 2023 fue de 0.56, contra 0.34 y 0.06 con la constancia.
- **Fase 2, en las 50 monedas:** fueron B1, B5 y B3. B2 y B4 no ganaban en las monedas nuevas.

| Fase 2 | Siempre: trades, R | vs azar | vs tramo | Nuevas: trades, R | vs azar | vs tramo |
|---|---|---|---|---|---|---|
| B5 | 308, +0.17 | +0.24 (+0.08 a +0.40) | +0.20 (+0.04 a +0.36) | 1,560, +0.08 | +0.17 (+0.10 a +0.24) | +0.11 (+0.04 a +0.18) |
| B1 | 218, +0.19 | +0.20 (+0.01 a +0.40) | +0.17 (−0.03 a +0.37) | 1,180, +0.15 | +0.15 (+0.07 a +0.23) | +0.10 (+0.02 a +0.19) |
| B3 | 134, +0.02 | +0.04 (−0.12 a +0.21) | +0.03 (−0.14 a +0.20) | 772, +0.04 | +0.05 (−0.02 a +0.12) | +0.04 (−0.03 a +0.11) |

- **B5, pasa el criterio.**
  - **Regla:** FVG nuevo de 0.6 ATR o más, o un doji tras tendencia (2% de los trades), a favor de la EMA 50 y con el OI subiendo 2% en 6 velas. Entra a mercado, con el stop en el extremo de la vela del elemento. Sale en 2R, con trailing a 3 ATR, stop a la entrada en 1.5R, a las 24 velas o con la señal contraria.
  - **Fase 2:** positiva en 6 de las 7 monedas de siempre y en 29 de las 43 nuevas, en 2024 y en 2025.
  - **Fase 1 de las nuevas:** pierde en absoluto (−0.02 R). Su ventaja ahí sale de que el azar pierde más.
  - **Stop corto:** el riesgo mediano es 1.5% del precio y el 40% de los trades sale en su primera vela. Con 0.05% de deslizamiento por lado, que el probador no cuenta, la fase 2 baja a +0.07 R en las de siempre y a +0.01 en las nuevas.
- **B1, en el borde.**
  - **Regla:** FVG nuevo de 0.6 ATR o más con volumen alto en 2 velas, la EMA 50 a favor con pendiente, sin confluencia OI-volumen en contra y sin ir con la multitud. Stop de 1 ATR; sale en 2R, con trailing a 4 ATR desde 1R, o a las 96 velas.
  - **Deslizamiento:** con 0.05% por lado queda en +0.14 y +0.12.
  - **Parecido con B5:** comparte con ella una tercera parte de sus trades.
- **El recorrido supuesto no las infla.** En las seis monedas con minutos, resolver las velas dudosas con él deja a B5 entre 0.02 y 0.03 R peor que los minutos reales, y a B1 casi igual.
- **Fuera del plan:** las envolventes A1 y A2 (tras tendencia, con volumen, dentro de un rango, stop de 1 ATR y salida por swing) fallaron 2023 en las monedas de siempre, con 127 a 141 trades. En cambio ganaron en las 43 nuevas en las dos partes de la fase 1: A2, +0.31 y +0.19 R sobre el control.
- **La fase 3 no se corrió.**

## REGÍMENES: TENDENCIA U HORIZONTALIDAD (19/11/2026)

Pedido del usuario tras fallar en la fase 2 las finalistas de la búsqueda: los mercados pasan cerca del 25% del tiempo en tendencia y el resto en horizontal, y una misma estrategia no sirve para los dos. Pidió revisar y afinar los indicadores que ya había para eso (Range Detection, el TTM y el BandWidth del VWAP, y el "Progresivo (D creciente)" de las VP Zones de App 8) con corridas en la fase 1, sin estrategias, y verlo en el gráfico para comprobarlo a ojo.

```
RegimeTab.jsx (pestaña "Régimen" del backtesting global)
        │  GET /api/regime/catalog  ·  GET /api/regime/{symbol}?tf&detector&params&window&min_run&detect_tf
        ▼
regime.py (referencia y velas de la fase 1) + regime_detectors.py (detectores, calificación y vista)
```

- **Referencia** (`regime.truth`), que mira el futuro a propósito: es la vara para calificar, no algo operable. Para cada vela, la eficiencia de su ventana centrada (avance neto de cierre a cierre ÷ lo recorrido). La cuarta parte del tiempo con más eficiencia es tendencia, con su signo; el resto, horizontal. Los tramos de menos de `min_run` velas se unen al vecino más largo. De fábrica, 48 velas y 8 de tramo mínimo: en 4h la tendencia queda en 23% del tiempo, con tramos de unos 4 días en la mediana y rangos de unos 12.
- **Velas** (`phase_bars`): las del almacén de trades antes del caché de velas y después las del caché, solo de la fase 1. Si el caché se está reescribiendo (App 1 lo guarda sin archivo temporal), la lectura espera y repite.
- **Detectores**, todos sin futuro (una prueba corta las velas y comprueba que lo ya cerrado no cambia):
  - `atr_range`: el Range Detection de App 1 (estilo LuxAlgo). Corregido: la media en la vela actual (iba una vela atrás) y sin unir rangos de fechas distintas solo por compartir precio (`mergeOverlappingRanges` los unía).
  - `vwap_bw`: el BandWidth del VWAP de sesión de App 1, con sus umbrales de "consolidación" por marco.
  - `ttm`: TTM Squeeze clásico (Bollinger de 20 a 2σ dentro de Keltner de 20). App 1 lo calcula con las bandas del VWAP; aquí va el de los libros.
  - `bbwp`: percentil del ancho de Bollinger.
  - `vp_prog`: el "Progresivo (D creciente)" de App 8, con su forma y su d_score sin cambios. Corregido: se publica en la vela en que se detecta y crece con el área de valor de cada vela, no con la mejor ni la final (en App 8 la zona y sus niveles se decidían al terminar). Suma `range_atr`: el rango máximo en ATR en vez de en %; con 1.5% en 4h casi nunca se activaba.
  - `er_box`: nuevo. Entra cuando la eficiencia de las últimas `n` velas queda baja y sale en el primer cierre a más de `buffer` ATR de la caja, que queda fija, o cuando la eficiencia sube.
  - `adx` y `er`: referencias simples, para saber si los afinados ganan.
- **Calificación** (`score`): parte del tiempo que marca, precisión (contra la parte horizontal de todo el tiempo), rango hallado, tendencia confundida con rango (el error caro) y J = rango hallado − tendencia confundida (0 es azar, 1 perfecto).
- **Medido** en la fase 1, siete monedas, referencia de 48 velas; se afinó con lo anterior a 2023 y se calificó en 2023. J en 2023:

| Detector | 4h, de fábrica | 4h, afinado | 1h, afinado |
|---|---|---|---|
| Eficiencia con caja | — | 0.32 (n 20, < 0.2, margen 0.5, salida 0.5) | — |
| Eficiencia (referencia) | — | 0.31 (20, < 0.3) | 0.32 (30, < 0.25) |
| VP progresivo | 0.00 (no se activa) | 0.25 (20 velas, 5 ATR, d ≥ 45) | 0.25 |
| TTM | 0.11 | 0.22 (Keltner 2) | 0.23 |
| ADX (referencia) | 0.12 (< 20) | 0.21 (< 30) | 0.20 |
| Range Detection | 0.09 | 0.19 (30, ATR 50, ×2) | 0.24 (20, ATR 50, ×1.5) |
| BBWP | 0.05 | 0.13 (126, < 50) | 0.19 |
| BandWidth del VWAP | 0.00 | 0.01 | 0.07 |

  - El techo lo pone la demora, no los detectores: la referencia misma, conocida 12 velas tarde, da J 0.49 en 4h; 24 velas tarde, 0.19. La eficiencia equivale a conocerla unas 17 velas tarde (casi 3 días en 4h).
  - Juntar ER, TTM, VP y ADX en un voto no mejora (0.30 con 2 de 4).
  - **Detectar en un marco menor** (pedido del usuario, `detect_tf`, `on_frame`): una vela del gráfico es rango si el detector lo decía en la última vela chica que cierra con ella. Contra la referencia de 4h separa peor: la eficiencia da 0.27 en 1h con 80 velas y 0.08 en 15m, y el TTM, 0.03 en 1h y 15m. En velas chicas, un retroceso dentro de una tendencia ya parece rango.
  - En pantalla (BTC 4h, marzo de 2022) se ve el desacuerdo típico: la referencia marca la subida como tendencia y el detector pone cajas en sus escalones. Si una pausa dentro de una tendencia cuenta como horizontalidad es una decisión del usuario.
- **Ventana:** elige detector, parámetros ("Afinados" son los de 4h; "De fábrica", como estaban en App 1 o App 8), marco de detección y la referencia. Dibuja arriba la referencia (barra verde o roja y fondo tenue en tendencia, nada en horizontal) y abajo una barra morada mientras el detector dice rango, con la caja de cada rango: punteada antes de que se pudiera saber y continua desde la vela en que se supo. Lista las zonas con la parte de su tiempo que fue horizontal y "Ver" lleva el gráfico ahí. El gráfico tiene que estar en 15m, 1h o 4h.
- **Rango mayor** (19/11, pedido del usuario tras verlo: un rango de semanas salía partido en cajas de pocos días): casilla "Construir el rango mayor" (`major`, `major_atr`, `major_buffer`, `major_out`). Empieza con una caja del detector en la vela en que se supo; las cajas que aparecen mientras sigue lo agrandan si el conjunto no pasa de `max_atr` ATR (si pasa, empieza otro); termina tras `closes_out` cierres seguidos a más de `buffer` ATR de su caja. Sin futuro. Va en naranja, con su barra encima de la morada. Medido en 4h, siete monedas, sobre la eficiencia con caja: con 1 cierre dura como las cajas (unas 19 velas en la mediana); con 3, unas 33 (J 0.25 en 2023, contra 0.32 de las cajas); con 6, 47 a 72 (J 0.17 a 0.21). Contra una referencia de 96 velas todos quedan cerca de 0.18. Alargarlo cubre más tendencia: si sirve se juzga a ojo y, después, por lo que cambia en las estrategias.
- **Filtro de régimen en el probador** (19/11, pedido del usuario): `regime` en la regla (`clean_rule`), solo si se pide (una regla sin él conserva su identidad). `mode`: `inside` (la vela de la señal dentro de un rango), `outside` (fuera) o `breakout` (en las `after` velas desde la que rompe un rango, mientras no empiece otro); `major` usa el rango mayor con `majorOut` cierres, si no, las cajas. El detector es la eficiencia con caja afinada, en el marco de la regla (`rule_tester.regime_mask`, en caché por las velas). Lo descartado va a `skipped` como "filtro de régimen". **Las entradas al azar de los dos controles se toman solo de las velas permitidas** (`_allowed`): si no, la ventaja mezclaría el régimen con la señal. En la pestaña Regla, "Régimen" junto al horario.
- **Comparación en la fase 1** (4h, siete monedas, R neto; con una posición a la vez, dentro y fuera no suman el total porque filtrar libera señales):

| Regla | Todos | Dentro del rango mayor | Fuera del rango mayor | 6 velas tras romper | Dentro de las cajas | Fuera de las cajas |
|---|---|---|---|---|---|---|
| Flecha (RF a favor, 2 ATR, 2R) | 720, +0.15 | 685, +0.09 | 241, +0.14 | 153, +0.25 | 508, +0.01 | 550, +0.16 |
| Finalista 1 (VH + VWAP 200, 1 ATR, 5R) | 686, +0.39 | 571, +0.35 | 203, +0.32 | 107, +0.24 | 333, +0.33 | 457, +0.41 |
| Envolvente tras tendencia (vela, 1.5R) | 1605, −0.07 | 1391, −0.04 | 286, −0.17 | 133, −0.14 | 1197, −0.06 | 517, −0.05 |
| Rombo como giro (2 ATR, 1.5R) | 368, −0.13 | 270, −0.04 | 121, −0.24 | 35, −0.24 | 216, −0.07 | 179, −0.16 |

  - La dirección es la esperada: la flecha gana fuera de las cajas (+0.16) y no dentro (+0.01), y tras romper un rango mayor (+0.25); las de giro pierden menos dentro de los rangos. Pero los márgenes (±0.11 a ±0.46) se tocan en casi todos los pares, y la finalista 1 no cambia con el régimen.
  - Seguir el tramo al azar (2 ATR, 2R) dentro y fuera del rango mayor, por año: fuera gana más en 2021 (+0.09 contra +0.02), pierde en 2020 (−0.04 contra +0.05) y empata en 2022 y 2023; por moneda, 3 a favor y 4 en contra. Tras romper: −0.18 en 2020 y +0.09 en 2023. **En la fase 1, este detector no separa de forma estable cuándo conviene seguir el tramo.**
- **Régimen medido en 1D** (19/11, pedido del usuario): `regime.tf = 1440` (casilla "medido en 1D" en la pestaña Regla). Las velas de la regla se unen por día UTC (solo días completos) y cada vela de la regla usa el régimen del último día cerrado; `after` cuenta en días. Las primeras 20 velas del marco en que se mide no tienen régimen (`ok` en falso). En acciones cuenta cada día de sesión y cada vela usa el anterior al suyo (ver "Acciones de Alpaca en el probador"). Medido en 1D separa peor que en 4h: J de −0.05 a 0.10 contra la referencia, y seguir el tramo al azar fuera de sus rangos no gana más que dentro (1 a 3 de 4 años). Con cajas de 20 días llega tarde.
- **Bloques de construcción** (19/11, `regime_study.py`, fase 1, 4h, siete monedas, cajas de la eficiencia con caja; se mira con lo anterior a 2023 y se comprueba en 2023):
  - *Ruptura*: la vela que cierra fuera de la caja y la termina. Trade a favor, stop de 1.5 ATR y 3R. 784 rupturas: +0.13 R (búsqueda) y +0.10 (2023), contra +0.02 y −0.07 de seguir el tramo al azar con el mismo trade, y +0.06 y −0.01 al azar fuera de las cajas. El 48% vuelve adentro en 6 velas (esas, −0.62 R; las demás, +0.79). Lo que se repite en los dos tramos: **a favor de la EMA 200** (+0.21 y +0.15, contra −0.15 y −0.07 en contra); caja estrecha (≤ 4 ATR, +0.29 pero +0.06 en 2023); BBWP alto. El volumen alto en la ruptura no se sostuvo (+0.26 y +0.05). A favor del tramo, caja ≤ 5.5 ATR y volumen ≥ 1.4×: +0.25 y +0.15, 4 de 7 monedas. Ningún margen deja de tocar el cero.
  - *Borde*: dentro de una caja vigente, la vela que llega al quinto de arriba o de abajo (un evento por llegada). Trade hacia el centro, stop a 0.5 ATR tras el borde. 2,106: −0.08 y −0.11 R. Lo que se repite: entrar contra una vela grande (cuerpo > 1 ATR) es lo peor (−0.20 y −0.22); que la vela cierre lejos del borde (rechazo) deja cerca de 0 (−0.00 y +0.04); objetivo a 1R o menos, cerca de 0; delta a favor, +0.03 y +0.01. Nada gana claro.
- **Elementos BX y BE del probador** (19/11, `box_elements.py`, en `CANDLE_CODES`: valen en todas las monedas). Las cajas son las de la eficiencia con caja afinada, en el marco de la regla. **BX**: la vela que cierra fuera de una caja vigente y la termina, a favor de la ruptura; `bx.maxHeight` deja solo cajas de hasta tantos ATR. **BE**: dentro de una caja vigente, la vela que llega a su borde (`be.share`, 0.2), hacia el centro, con cuerpo de hasta `be.maxBody` ATR (1; 0 sin límite) y cierre a `be.rejection` o más del borde en su vela (0.6; 0 sin filtro); su zona va del borde a su quinto, y `exit.targetAt: "mid"` pone el objetivo en el centro de la caja (por `ctx["vp"]`). Cada trade guarda `box` y el gráfico dibuja la caja y su centro. Por el probador, fase 1, 4h, siete monedas: BX con stop de 1.5 ATR y 3R, +0.07 R antes de 2023 y +0.06 en 2023; a favor de la EMA 200, +0.19 y +0.13; además con cajas de hasta 5.5 ATR, +0.24 y +0.21 (controles, +0.01 a +0.02). BE con stop a 0.5 ATR tras el borde y objetivo al centro, +0.04 y −0.02; sin filtros de vela, −0.07 y −0.15.
- **OI, CVD, confluencia, FVG, patrones y swing** (19/11, pedido del usuario: los indicadores que no se habían usado en estas fases). Primero medidos en las rupturas y los bordes del estudio (`regime_study.py`, con OI de 4 horas de Bybit alineado al cierre de cada vela) y después como piezas del probador.
  - *En el estudio*, con y sin cada uno, antes de 2023 y en 2023. En las rupturas, **CVD de 20 velas a favor**: +0.23 y +0.30 R, contra +0.04 y −0.30 sin él (solo monedas con almacén). La confluencia OI-volumen en contra resta (−0.07 y −0.26, con 35 y 20 casos). El OI que sube o baja, el FVG, el patrón y pasar el último swing no se repiten de un tramo al otro. En los bordes, el patrón a favor y la confluencia a favor dejan cerca de 0, contra −0.10 sin ellos; el patrón en contra, −0.25.
  - **Filtros de flujo** (`flow_filters.py`, `flow` en la regla, solo si se pide): `cvd` = N velas (la delta de esas velas sobre su volumen, a favor del trade; real con almacén, estimada por el cierre en la vela sin él); `oi` = `rise` o `fall` (más de `oiPct` % en `oiBars` velas), `conf` (confluencia OI-volumen a favor: volumen con signo y cambio del OI, en z de 20 velas, los dos a favor) o `noconf` (no los dos en contra). El OI es el conocido al cierre de la vela: BTC con su serie de 5 minutos (`oi_store`), las demás con `OrderFlowData/oi/{moneda}_4h.json`, que baja `oi_update.py` (desde 2020 o desde que cotiza, hasta hoy); con la de 4 horas el filtro solo vale en 4h y 1D. Una vela sin OI no pasa. **Las entradas al azar de los dos controles solo entran donde el filtro deja entrar a ese lado.** Lo descartado va a `skipped` como "filtro de CVD u OI"; cada trade guarda `flow` (CVD y OI en la señal).
  - **BE con patrón** (`be.pattern`): además la vela es un martillo, envolvente o doji a favor con tendencia previa.
  - **FV y SP** (`fvg_swing.py`, en `CANDLE_CODES`). **FV**: la vela deja un hueco con la de dos antes (la regla del indicador FVG), de al menos `fv.minAtr` ATR (0.3); la zona es el hueco. **SP**: un mínimo o máximo único de `sp.bars` velas por lado (5), como el indicador Swing, con volumen z ≥ `sp.minZ` si se pide; se conoce al cerrar la última vela de su derecha, a favor del giro; la zona es su vela. Cada trade guarda `fs`.
  - *Por el probador*, fase 1, 4h, siete monedas (antes de 2023 · 2023 · azar y tramo de toda la fase):

| Regla | Antes de 2023 | 2023 | Azar · tramo | Monedas sobre el azar |
|---|---|---|---|---|
| BX (1.5 ATR, 3R) | 361, +0.07 | 258, +0.06 | +0.01 · +0.02 | 5 |
| BX con CVD 20 a favor | 307, +0.09 | 220, +0.10 | +0.05 · +0.07 | 5 |
| BX sin confluencia OI-vol en contra | 335, +0.11 | 251, +0.09 | +0.03 · +0.05 | 4 |
| BX, EMA 200 y caja ≤ 5.5 ATR | 207, +0.24 | 144, +0.21 | +0.01 · +0.02 | 4 |
| BX, EMA 200, caja ≤ 5.5 y CVD 20 | 160, +0.32 (±0.29) | 120, +0.32 (±0.34) | +0.06 · +0.07 | 6 |
| BE (al centro) | 193, +0.04 | 116, −0.02 | −0.03 · −0.04 | 3 |
| BE con patrón | 49, +0.03 | 25, −0.11 | −0.03 · −0.04 | 3 |
| BE con confluencia a favor | 56, −0.03 | 34, +0.16 | −0.03 · −0.04 | 3 |
| BE con CVD 20 a favor | 73, −0.04 | 36, +0.19 | 0.00 · −0.02 | 4 |
| FV a mercado, hueco ≥ 0.3, 1.5 ATR, 2R | 809, +0.15 (±0.10) | 549, +0.09 (±0.12) | −0.02 · −0.03 | 7 |
| FV igual, 3R | 595, +0.23 (±0.15) | 421, +0.31 (±0.18) | +0.01 · +0.02 | 6 |
| FV con cualquier hueco, 2R | 1007, +0.06 | 690, −0.02 | −0.02 · −0.03 | 3 |
| FV con CVD 20 a favor, 2R | 613, +0.16 | 448, +0.10 | +0.02 · +0.01 | 5 |
| FV a favor de la EMA 200, 2R | 612, +0.14 | 457, +0.03 | −0.02 · −0.03 | 4 |
| FV invertida, 2R | 780, −0.08 | 581, −0.13 | −0.03 · −0.03 | 2 |
| FV limit en la mitad del hueco, stop tras él, 2R | 967, −0.06 | 660, −0.01 | −0.15 · −0.17 | 5 |
| SP (stop tras la vela, 2R) | 1656, −0.12 | 1366, −0.20 | −0.13 · −0.15 | 2 |
| SP con volumen z ≥ 1 | 715, −0.12 | 632, −0.20 | −0.13 · −0.15 | 2 |

  - Lo que se sostiene en los dos tramos: el CVD a favor sobre BX (+0.08 y +0.11 sobre BX con EMA y caja, con márgenes que se tocan) y **FV a mercado con hueco de 0.3 ATR o más**, que sigue el hueco: a 3R sus márgenes no tocan el cero en ninguno de los dos tramos, y al revés pierde. Pero se probaron seis variantes de FV y diecisiete reglas en total sobre los mismos datos: es una candidata para la fase 2, no un resultado. El swing del detector pierde como el azar; en BE nada se repite.
- **MiniChart:** dos formas nuevas en `getTradeBands`, `strip` (tramo de tiempo) y `outline` (caja solo con contorno). Sin ellas, nada cambia.
- **Pruebas:** `tests/test_regime.py` (20) y `tests/test_flow_elements.py` (5: FV y SP sin futuro, CVD real y estimado, OI conocido al cierre, identidad de la regla con la ida y vuelta por la ventana, y que el filtro de CVD vale para la regla y los controles). Probado en la copia aislada con BTC 4h: la pestaña, el dibujo y la lista. No se probó en 15m ni en otras monedas en pantalla.
- **Falta:** valores afinados por marco en la ventana (hoy son los de 4h), y decidir con el usuario si las pausas dentro de una tendencia son rango.
- **El Range Detection (atr_range) repinta** (hallado el 20/11 al pasarlo a JS): los cierres fuera de la caja que no alcanzan a terminar el rango (hasta `max_out` seguidos) no son rango en ese momento, pero si el precio vuelve, `z.end` los pasa y quedan como rango hacia atrás. En BTC 4h y 15m, cortando cada 7 velas, solo él cambia velas ya cerradas (16 y 32 con los afinados): su J de 0.19 mira un poco el futuro. Los otros siete y el rango mayor no cambian nada ya cerrado. No se corrigió en Python.

## SMART MONEY CONCEPTS E INDICADORES DE BILL WILLIAMS (20/11/2026)

Pedido del usuario: un indicador de Smart Money Concepts, con el gratuito de LuxAlgo para TradingView (`SMC_LUXALGO.txt`) como referencia, y los indicadores de Bill Williams de *Trading Chaos* (2.ª ed., el PDF de esta carpeta), en App 1 y en la suite. Tras el análisis eligió "todo, por fases" y pidió sumar los demás de Williams de conocimiento general (AC, zonas, Gator y MFI). Tres fases: los indicadores, las piezas del probador con una corrida contra el azar, y la detección en vivo en la suite.

**El código de LuxAlgo no se copió:** su licencia es CC BY-NC-SA 4.0 (no comercial) y la suite puede venderse. Las reglas son propias, escritas a partir de las ideas.

### Fase 1: los indicadores

- **Lógica pura, sin dibujo** (`components/indicators/`):
  - `williams.js`: Alligator, AO, AC, Gator, MFI, zonas, fractales y los tres sabios. Las reglas están en su encabezado. Ajustes en `williams_settings_{símbolo}`, un objeto por indicador (`defaultWilliamsConfig`).
  - `smcStructure.js`: pivotes de tramo, estructura interna (5 velas) y mayor (50), BOS y CHoCH, order blocks con su vida, breakers, máximos y mínimos iguales con su barrido, rango premium/discount con extremo fuerte y débil, y niveles del día, la semana y el mes anteriores. Ajustes en `smc_settings_{símbolo}` (`defaultSmcConfig`).
  - `smcExtras.js`: el POC y el delta reales de la vela de cada order block, del almacén de trades (`ObVolume`), y lo liquidado cerca de cada nivel de iguales, a 0.15% o menos (`EqLiquidations`, del indicador Liquidaciones).
- **Indicadores** (`WilliamsIndicators.js` y `SMCIndicator.js`): Alligator (líneas, su proyección a la derecha y una tira de estado), Fractales, Tres sabios (numerados, con su entrada y su stop), Zonas de Williams (colorean las velas o una tira), AO, AC, Gator y MFI (paneles; el squat del MFI también sobre el precio) y "Estructura SMC".
  - Todo sale de velas cerradas. Lo que se sabe después de su vela (un fractal, un pivote, un order block) va punteado hasta la vela en que se supo (`showBefore`).
  - Se calculan por ventanas, como Rangos horizontales: velas de calentamiento antes de la vista, bordes en bloques de 200 y caché por clave (`WilliamsHub`).
- **Modales:** `WilliamsSettings.jsx` (uno por indicador) y `SMCSettings.jsx`. Están en la simulación manual, el 2.º gráfico (con ajustes propios: `secondaryStorage.js`), el backtesting global (`ChartIndicatorSettings.jsx`) y la suite.
- **Diferencias con LuxAlgo:**
  - un pivote de 50 velas se sabe 50 velas después: aquí se dibuja punteado hasta entonces;
  - el order block lleva su volumen real (POC · Δ) cuando la moneda tiene almacén;
  - los iguales dicen lo liquidado cerca;
  - premium/discount viene apagado de fábrica;
  - cada pieza se puede elegir para el análisis del trade.
- **Probado en pantalla** con una copia aislada en BTC 4h:
  - el Alligator con su tira y su proyección, los fractales y los sabios numerados;
  - los order blocks, BOS y CHoCH, un EQH con sus liquidaciones, POC · Δ real, PDH/PDL y premium/discount;
  - los paneles AO, AC, Gator y MFI, y las zonas coloreando las velas;
  - los modales aplican: apagar el 2.º sabio lo quitó.

### Fase 2: el probador de reglas

- **Python con paridad:** `backend/williams.py` y `backend/smc.py` repiten `williams.js` y `smcStructure.js`, con las mismas operaciones en el mismo orden. `tests/williamssmc.parity.test.mjs` los compara bit a bit con 1,500 y 3,000 velas al azar: 1,493 señales de los sabios, 229 rupturas, 229 order blocks y 59 iguales.
- **Elementos nuevos** (en `CANDLE_CODES`: valen en todas las monedas, en 1D y en las acciones):
  - **WD**, barra divergente (1.er sabio), y **WA**, tres barras del AO (2.º sabio): la zona es su vela;
  - **WF**, ruptura de fractal (3.er sabio): el evento cae en la vela en que se supo el fractal, con la orden esperando hasta que el precio lo pasa (`info.expiry`). Solo los fractales que el precio pasa del lado correcto de los dientes;
  - **BS**, ruptura de estructura: zona del nivel roto al cierre; `smc.break` elige BOS, CHoCH o los dos;
  - **OB**, order block: nace con la ruptura y su zona es el OB (con entrada limit espera el regreso);
  - **BK**, breaker: el OB roto, del lado contrario;
  - **EQ**, barrido de iguales: contra el lado barrido; con `reclaim` la vela cierra de vuelta.

  Parámetros: `wise` {lookback, angBars, minGapAtr, requireAo, teeth} y `smc` {scope (mayor o interna), swing, internal, break, pick, area, mitigation, eqLength, eqThreshold, reclaim}. Solo entran a la regla si están sus elementos.
- **Entrada "Orden stop a favor"** (`entry.type: "stop"`, `{offset, expiry, cancel}`): una compra stop en el borde de arriba de la zona del elemento más `offset` ATR (una venta, en el de abajo). Espera `expiry` velas (WF: hasta que el precio pasa su fractal). Con `cancel`, se cancela si antes el precio pasa el otro borde. Se llena al cruzar, o en la apertura si salta. Si una vela toca los dos bordes decide el minuto a minuto (o el recorrido supuesto). Las limit y las stop se toman en el orden en que se llenan. El azar pone la orden stop en velas al azar, a la distancia mediana del cierre que tuvieron las de la regla.
- **Salida "bajo el mínimo de las últimas N velas"** (`exit.trail: "bars"`, `trailBars`): la del libro, de 3 a 5 velas; solo se acerca.
- **Objetivo en el rango SMC** (`targetAt: "weak"`): el máximo (largo) o el mínimo (corto) del rango mayor en la vela de la señal, donde espera la liquidez del lado débil. A menos de 0.3 R o ya pasado, no se opera. El azar usa en R el objetivo mediano de los trades.
- **Filtros nuevos**, para cualquier regla, en el grupo "Williams y SMC" de la sección Filtros:
  - `bwf.alligator`: `awake` (despierto a favor), `side` (el cierre del lado de los dientes) o `sleeping` (dormido, para operar rangos);
  - `bwf.zone`: la zona de Williams a favor;
  - `smcf.pd`: un largo solo en discount y un corto solo en premium;
  - `smcf.bias`: a favor de la estructura mayor (de `smcf.swing` velas).

  **Los controles al azar entran solo donde estos filtros dejan** (`_sided`, `_side_ok`), como con el CVD y el OI. El azar del tramo, también.
- **Arreglos de paso:**
  - `clean_rule()` perdía un objetivo de nivel (POC, borde, centro o rango SMC) al limpiar una regla ya limpia, que lo lleva arriba: quedaba con el cierre a las 96 velas. Pasaba al correr en todas las monedas una regla de la búsqueda. Ahora limpiar dos veces da lo mismo.
  - El rango SMC se guarda por configuración (`_smc_range`): un contexto compartido entre reglas no devuelve el de otra.
- **Ventana:** parámetros de los sabios y de la estructura, la orden stop, el objetivo en el rango y la salida de Williams en la pestaña Regla. Nombres cortos en `elementLabels.js` y `rule_tester.LABELS`. Piezas en `ruleFacets.js` (`wise`, `smc`, `alligator`, `zonaWilliams`, `premium`, `sesgo`) y textos en `describeRule`.
- **Búsqueda genética** (`rule_search.py`, pestaña Búsqueda):
  - los siete elementos;
  - la orden stop (al final de `ENTRIES`) y la salida de Williams (al final de `TRAILS`, con `trailBars` 5 o 3);
  - los parámetros de los sabios y de la estructura;
  - los cuatro filtros y el objetivo en el rango. Empiezan apagados: un genoma guardado antes da la misma regla.

  Casillas "orden stop a favor" y "filtros de Williams y SMC" (`stopEntry`, `williams`). La complejidad cuenta los cuatro filtros, y los controles de la búsqueda también respetan los filtros nuevos.
- **Medido: fase 1, 4h, las siete monedas de siempre** (corridas en una copia del registro, no en el del usuario). Ninguna regla supera a los dos controles con margen:

| Regla | Trades | Acierto | R | Azar | Ventaja (IC 95%) | Vs. tramo | Monedas + |
|---|---|---|---|---|---|---|---|
| Barra divergente como el libro: orden stop, stop en su extremo, bajo el mínimo de 5 velas | 1,669 | 30.3% | −0.06 | +0.01 | −0.07 (−0.16 a +0.02) | −0.09 | 1 de 7 |
| Barra divergente con 2R | 1,426 | 29.5% | −0.17 | −0.05 | −0.11 (−0.19 a −0.04), peor que el azar | −0.10 | 0 de 7 |
| AO tres barras como el libro | 1,607 | 25.1% | −0.02 | +0.03 | −0.04 (−0.18 a +0.09) | −0.06 | 3 de 7 |
| Ruptura de fractal como el libro | 2,101 | 31.8% | +0.08 | +0.02 | +0.06 (−0.05 a +0.16) | −0.02 | 5 de 7 |
| Los tres sabios juntos, como el libro | 2,694 | 28.2% | −0.04 | +0.01 | −0.05 (−0.13 a +0.04) | −0.11 | 2 de 7 |
| Ruptura de fractal con el Alligator despierto a favor, 1.5 ATR y 3R | 757 | 27.7% | +0.07 | +0.07 | +0.01 (−0.13 a +0.14) | −0.00 | 4 de 7 |
| Order block interno, limit, 2R | 775 | 31.4% | −0.09 | −0.03 | −0.06 (−0.16 a +0.04) | −0.04 | 1 de 7 |
| Order block mayor de 20 velas, limit, 2R | 193 | 28.0% | −0.19 | −0.03 | −0.16 (−0.36 a +0.03) | −0.18 | 1 de 7 |
| Order block interno en discount o premium, objetivo en el rango | 225 | 15.6% | −0.02 | −0.12 | +0.09 (−0.24 a +0.43) | +0.10 | 2 de 7 |
| Ruptura de estructura mayor de 20, 1.5 ATR y 2R | 478 | 34.5% | −0.01 | −0.02 | +0.02 (−0.12 a +0.14) | +0.02 | 2 de 7 |
| Breaker interno, limit, 2R | 728 | 34.8% | +0.01 | −0.04 | +0.05 (−0.06 a +0.16) | +0.06 | 4 de 7 |
| Barrido de iguales con regreso, 2R | 197 | 33.5% | −0.08 | −0.06 | −0.02 (−0.22 a +0.18) | +0.00 | 1 de 7 |

  Las dos con filtros de Williams o SMC van con el azar que respeta esos filtros. Con el azar sin filtrar, la del Alligator daba +0.03 sobre un azar de +0.05, y la del order block −0.01 sobre uno de −0.01: el filtro solo movía al azar.

  La ruptura de fractal es lo único sobre el azar, y queda bajo seguir el tramo al azar: su ventaja es la tendencia. El breaker es lo más cercano a algo, sin margen. Son 12 reglas sobre los mismos datos: el umbral de suerte sube.
- **Pruebas:** `tests/williams.test.mjs` (12), `tests/smc.test.mjs` (11), `tests/williamssmc.parity.test.mjs` (2), `tests/rulefacets.test.mjs` (9) y `backend/tests/test_williams_smc.py` (9). `test_new_coins.py` apaga también las casillas nuevas, y la búsqueda de `test_rule_search.py` corre sin ellas, con hasta 300 s de espera: en este PC tarda de 100 a 130 s, casi todo en los controles de las vecinas.
  - **Todas las del backend** (20/11): 497 pasan. Fallan 2 que ya fallaban antes: `test_endpoints.py` espera la versión 2.7.0 y el servidor dice 2.6.0, y `test_lru_cache.py::test_clear` cuenta los fallos del caché que la propia prueba provoca.
  - **Las de la página:** de 44 archivos, solo falla `liquidations.test.mjs`, como desde el 13/11. Pide que Liquidaciones sea el primer indicador; desde el 13/11 el primero es el mapa de liquidez, y ahora además van antes las Zonas de Williams, que repintan las velas.

### Fase 3: en la suite

La detección en el servidor al cierre de cada vela (sin enviar nada), su panel en la Watchlist, los order blocks en la defensa de zona y las medidas en el journal: ver `12.AltagraciaTradingSuite/CLAUDE.md`, "Sabios de Williams y estructura SMC".

### Después (21/11): AO, AC, Gator y MFI como filtros, y menús en dos columnas

Pedidos del usuario tras probarlo:
- el menú desplegable de los indicadores era largo y parte no se veía;
- en el backtesting global no aparecían los sabios, el AO ni el AC para armar reglas: de Williams solo estaban el Alligator y las zonas. Quería probar el AO de tres barras.

- **Por qué no aparecían los sabios:** la lista de elementos de la regla la da el backend (`/api/tester/info`); los filtros del Alligator y la zona están en la página. En el 9000 respondía un backend viejo, de antes de la actualización, que seguía vivo sin ventana a la vista junto al que el usuario abrió después; su consola de `1.start_backtester.bat` quedaba abierta, y con ella otras cuatro vacías de días anteriores. Con el backend nuevo salen «Barra divergente», «AO tres barras» y «Ruptura de fractal». Para verlo: `Get-NetTCPConnection -LocalPort 9000` y los procesos `uvicorn` y `spawn_main` con su hora de inicio.
- **Filtros nuevos** en `bwf`, en el grupo "Williams y SMC". Se miran en la vela de la señal y solo entran a la regla si se piden: una regla de antes conserva su identidad.
  - `ao` y `ac`: `color` (su barra a favor: verde, sube, en un largo; roja en un corto), `zero` (del lado del cero a favor) o `both`;
  - `gator`: `eating` (sus dos barras crecen: la boca se abre), `open` (al menos una crece) o `sleeping` (las dos se achican). No mira el lado: va bien junto al Alligator despierto a favor;
  - `mfi`: el tipo de vela del MFI, `green` (verde), `squat`, `volume` (verde o squat: sube el volumen) o `notFake` (todo menos fake). No mira el lado.

  Una vela sin el dato que pide el filtro no pasa (`williams.filter_ok`). Los controles al azar entran solo donde dejan.
- **Gator y MFI en el backend:** `williams.compute(..., v=)` da las dos barras del Gator con su dirección y, con el volumen, el MFI y su tipo de vela, como `williams.js` (paridad bit a bit en `williamssmc.parity.test.mjs`).
- **Trade elegido:** una fila por cada filtro de Williams y SMC bajo las velas y en el cuadro de la vela de la señal, con su valor en la señal: «AO en 1853.29, sube», «barra de arriba crece, la de abajo se achica», «vela verde», «tendencia alcista» (`_bw_rows`, `williams.filter_known` para el gris). Hasta el 21/11 el Alligator, la zona y los filtros SMC no tenían la suya.
- **Búsqueda:** genes `bwAo`, `bwAc`, `bwGator` y `bwMfi`, apagados de fábrica (un genoma de antes da la misma regla), con la casilla "filtros de Williams y SMC". La complejidad los cuenta.
- **Textos:** las fichas de «Vas a correr» dicen el nombre de cada filtro de Williams («AO del lado del cero a favor»; antes el Alligator decía solo «despierto a favor»). El resumen de la regla (`describeRule`) dice la angulación y el AO en contra solo si está la barra divergente: con el AO de tres barras confundían. Además, los detalles de la flecha y el rombo de volumen nunca salían: el resumen buscaba sus códigos entre los nombres.
- **Menús de indicadores en dos columnas**, leídos de arriba abajo, en la simulación manual (`BacktestingApp.jsx`), el 2.º gráfico, el backtesting global y el gráfico de la suite. Si la ventana es más baja, el menú se desplaza.
  - El ícono de ajustes va en la línea del nombre: es un bloque (`uiIcons.jsx`) y bajaba a una línea propia, que alargaba la lista.
  - Con Oscuro, el selector del modo del interés abierto salía negro sobre negro (el panel se invierte); ahora lleva su color.
  - A 1366×768 los cuatro caben enteros.
- **Probado en pantalla** con una copia aislada, a 1366×768, en Nítido y en Oscuro:
  - los cuatro menús;
  - en el backtesting global, la regla «AO tres barras» en BTC 4h, fase 1, con orden stop, stop en la vela, 2R y los filtros AO del lado del cero, Gator despierto y MFI verde o squat. Dio 951 señales; el filtro de Williams quitó 846 y quedaron 52 trades, con 23.1% de acierto y −0.37 R. Es una prueba de pantalla, no un estudio;
  - el trade 39 con sus tres filas bajo las velas y su cuadro en ✓.
- **Pruebas:** `test_williams_smc.py` suma 5 (14), `rulefacets.test.mjs` suma 1 (10) y la paridad compara el Gator y el MFI. Todas las del backend: 502 pasan y fallan las 2 de siempre. En la página solo falla `liquidations.test.mjs`, como desde el 13/11. En la suite pasan `wise_smc_checks.py` (40), `book_defense_checks.py` (21) y `journal_checks.py` (89), que usan `williams.py`.

### Falta

- Un control con order blocks desplazados, como el del perfil por sesión, para medir si la zona del OB importa.
- Un detector de régimen "Alligator dormido" en la pestaña Régimen (hoy está como filtro).

## RANGOS HORIZONTALES (20/11/2026)

Pedido del usuario: un indicador con los métodos y parámetros de la pestaña Régimen, para la simulación manual, el backtesting global y la suite, con el método elegido en un modal.

- **Cálculo en el navegador:** `components/indicators/regimeDetectors.js` repite `regime_detectors.py` (los ocho detectores, `major`, `PARAMS` con afinados y de fábrica, `cleanParams` y `runDetector`), con las cuentas en el orden de numpy (sumas de a pares, `std` poblacional, `round` al par). `tests/regimedetectors.test.mjs` lo compara con Python en BTC 4h, 1h y 15m y GALA: 26,960 zonas iguales al bit (35 pruebas, unos 35 s, casi todo Python leyendo los cachés). Con 10,000 velas cada detector tarda menos de 8 ms.
- **Indicador** "Rangos horizontales" (`HorizontalRangesIndicator.js`): se dibuja sobre las velas (`height = 0`), apagado de fábrica, en el lugar 5 del administrador (debajo de los elementos, perfiles y footprints).
  - **Sin futuro:** calcula solo con velas cerradas (`priceContext.knownCandles`, o las del gráfico en vivo, sin la vela en formación). Cada caja va tenue y punteada desde su primera vela hasta la vela en que se supo, y marcada desde ahí; una que sigue viva llega hasta la última vela cerrada.
  - **Ventana:** la vista más 600 velas antes (el arranque más largo es el BBWP de fábrica, 272), con bordes de a 200 velas; solo recalcula si cambia la ventana, cierra una vela o cambian los ajustes. Un cálculo de más de 40 ms se repite a lo sumo cada 400 ms (nunca pasó en las pruebas). No dibuja con más de 3,000 velas a la vista.
  - **Rango mayor:** como `regime_detectors.view`, con las cajas del método en la vela en que se supo cada una (`partsFromZones`), en naranja con su barra encima de la morada.
  - `selectableLevels()`: techo, mitad y suelo de cada caja a la vista, para "Incluir en el análisis"; con el perfil, también su POC, VAH y VAL (ver abajo).
- **Modal** (`HorizontalRangesSettings.jsx`): el método (los ocho, con su explicación y su J en 4h), sus parámetros con "Afinados (4h)" y "De fábrica", el rango mayor (alto máximo, margen y cierres fuera, 8, 0.5 y 6 de fábrica) y lo que se muestra (cajas, tramo punteado, barra y opacidad). Cada método guarda sus parámetros: al volver a él vuelven los suyos. `cleanHorizontalRangesSettings` (en el indicador) acota los valores. Ajustes por símbolo en `horizontal_ranges_settings_{símbolo}`, para todos los marcos; en `OWN_KEYS`, así el 2.º gráfico y las pestañas 2 a 5 de la suite guardan lo suyo.
- **Dónde está:** la simulación manual (`BacktestingApp`, con `applyToAllTimeframes`), el 2.º gráfico (`SecondaryChartApp`), el backtesting global (`RuleTesterApp` y `ChartIndicatorSettings`) y el gráfico principal de la suite (`ChartView.jsx`). Los ajustes del backtesting global son los de la simulación manual.
- **Atr_range repinta** (ver el punto de arriba): en el indicador no mira el futuro, porque recalcula con lo conocido, pero una caja suya puede alargarse hacia atrás al avanzar. El modal lo dice.
- **Arreglado en el backtesting global (20/11):** cambiar el marco del gráfico antes de que terminara su primera carga dejaba el aviso "Completando las velas de…" del marco anterior y el gráfico tapado para siempre: el pedido viejo ponía su aviso sin estar ya vigente y, al terminar, no lo quitaba. Ahora los avisos solo salen del pedido vigente.
- **Pruebas:** `tests/horizontalranges.test.mjs` (8, y 17 con las del perfil): las cajas son las del detector en horas; lo conocido no cambia con velas posteriores (todos menos atr_range, y el rango mayor); la vela en formación no cuenta; el arreglo corrido de la suite da lo mismo; el modal acota; el registro en el administrador. `secondarystorage.test.mjs` suma la clave. Las de paneles, fugas, niveles, estilo, FVG y probador siguen pasando; liquidaciones sigue en 38 de 39, la que ya fallaba (pide Liquidaciones en el primer lugar, donde está el mapa de liquidez).
- **Probado** en el backtesting global con una copia del frontend y un backend aparte: BTC 4h con la eficiencia con caja (22 cajas, 1.5 ms por cálculo) y con TTM y el rango mayor desde el modal (29 cajas y 14 rangos mayores, guardados), con los colores contados en el lienzo. Las páginas de App 1 y de la suite se arman (`vite build`). **No se probó en pantalla** la simulación manual, el 2.º gráfico ni la suite en vivo.

### Perfil de volumen sobre cada rango (20/11)

Pedido del usuario: dibujar el volume profile sobre el rango detectado, que crezca con el rango a medida que avanza el tiempo, en App 1 y en la suite.

- **Opción del modal** "Perfil de volumen", apagada de fábrica: el indicador se ve como antes hasta encenderla. Con el rango mayor armado, el perfil va sobre él (`profileOn: 'major'`, de fábrica) o sobre las cajas (`'boxes'`); sin él, sobre las cajas. Solo sobre lo que se dibuja: con las cajas ocultas no hay perfil de cajas, y el modal lo avisa (`profileTargets()`). Franjas de precio (`profileRows`, 50, de 10 a 400), área de valor (`profileVa`, 70%), largo de la barra mayor (`profileWidth`, 30% del ancho del rango), línea del POC, líneas del VAH y el VAL, y el precio del POC en los rangos de 90 px o más.
- **El perfil** (`indicators/rangeProfiles.js`): el de las velas cerradas del rango, desde su primera vela (`start`) hasta la última que cerró dentro de su caja (`profileSpan`), con la regla de VP Periodic (`buildProfile` de `sessionProfile.js`: franjas iguales entre el mínimo y el máximo de esas velas, POC en la de más volumen, área de valor creciendo hacia la vecina mayor). El de un rango vivo crece con cada vela que cierra dentro; la vela en formación no entra, porque abre después de la última del rango (`lastOpen`, que `computeRanges` da ahora en cada zona). Los perfiles armados quedan en caché (300), por sus velas y sus franjas. Cada perfil lleva `until` (el cierre de su última vela) y `dropped` (las velas de la ruptura que no cuentan).
- **Sin la ruptura** (pedido del usuario el 20/11, al ver el perfil de los rangos mayores con otra forma que la D): las velas del final que cierran fuera de la caja no cuentan.
  - **Qué velas son:** en el rango mayor, los N − 1 cierres seguidos fuera con que sigue vivo hasta terminar. En la eficiencia con caja, los cierres fuera de la caja pero dentro de su margen. En un rango vivo, la ruptura que todavía puede terminarlo.
  - **Si el precio vuelve:** si una vela vuelve a cerrar dentro, la salida fue falsa y esas velas cuentan.
  - **Qué no cambia:** la caja se dibuja igual, hasta su última vela, y al menos va su primera vela. En los métodos cuya caja es el máximo y el mínimo de sus velas (TTM, BBWP, ADX, eficiencia, VWAP y VP progresivo) ningún cierre queda fuera, así que nada cambia.
  - **Medido en 5 años de BTC 4h:**
    - rango mayor con 6 cierres: el 82% de 176 rangos traía la ruptura dentro (5.7 velas en promedio), y el volumen del perfil fuera de la caja bajó de 14.6% a 3.0%;
    - con 3 cierres: de 10.1% a 2.8%;
    - cajas de la eficiencia: de 3.4% a 2.4%.

    Lo que queda fuera son mechas de velas del rango.
- **Volumen real:** `/api/orderflow/profile` con el inicio del rango, el cierre de la última vela del perfil como fin y como `known_until` (nada posterior), y el mínimo, el máximo y las franjas del estimado, así las dos rejillas coinciden. Se usa si el almacén cubre el 99% de los minutos, como VP Fixed Range y VP Periodic; la etiqueta dice «real» y los niveles para el análisis, «(real)». Un rango vivo cambia de fin con cada vela: su pedido sale cuando el fin queda quieto 0.8 s (en una reproducción rápida, al pausar), y de cada rango solo queda pedido su fin más reciente. Un pedido a la vez, 0.2 s entre pedidos, hasta 60 en cola, el más reciente primero. `dispose()` (al destruir el administrador) detiene los pedidos. La suite usa su propia ruta, con los días de la nube (`live=True`).
- **Dibujo:** desde la primera vela del rango (o el borde izquierdo, si empieza fuera de la vista) hacia la derecha, encima de las cajas. Las franjas del área de valor en `THEME.vpValueAreaRgb` y las demás en `THEME.vpOutsideRgb`, más opacas cuanto más volumen; POC en `THEME.vpPoc` y VAH y VAL punteados en `THEME.vpVahVal`, hasta la última vela del rango. En Clásico, los colores de fábrica del VP de rango fijo. La etiqueta del POC va en el extremo derecho de su línea, con `priceText` (índice con fecha oculta) y los decimales de la moneda.
- **Para el análisis:** POC, VAH y VAL de cada perfil a la vista, como "Perfil del rango, POC" o "Perfil del rango mayor, VAL", desde la primera vela del rango hasta la última, y sabidos al cierre de la última (`time` = fin). Su id lleva el precio: en un rango vivo cambian con cada vela.
- **Pruebas** (9 más en `horizontalranges.test.mjs`, 17 en total):
  - el perfil de cada rango es el de sus velas hasta la última que cerró dentro, con todo su volumen (40 rangos de BTC 4h en tres métodos, con rangos mayores que traen su ruptura);
  - las velas del final que cierran fuera no cuentan, y cuentan si el precio vuelve a cerrar dentro (velas armadas a mano);
  - el de un rango vivo, cajas y rango mayor, suma la vela que cierra dentro, no cambia con una que cierra fuera de la misma caja y no usa las posteriores;
  - la vela en formación no entra, ni al perfil ni al dibujo;
  - el volumen real se pide hasta el cierre de la última vela del perfil (antes de la ruptura), con su misma rejilla, y solo se usa si cubre el 99%;
  - de un rango vivo se pide solo su fin más reciente, y nada tras `dispose()`;
  - sobre qué rangos va;
  - el dibujo y los niveles para el análisis;
  - el modal acota las opciones.
- **Probado** con una copia aislada (backend en 9300, página en 9301), BTC 4h:
  - en el backtesting global, encendido desde el modal: 2 rangos a la vista con su perfil y volumen real (un pedido por rango, unos 45 ms), y con el rango mayor, el perfil sobre él;
  - en la simulación manual desde el 08/12/2023 a 5000x: el rango vivo desde el 05/12 sumó una vela cada 3 s y su perfil creció con ella (de 559,941 a 743,338 BTC), con el volumen real al quedar quieto cada fin.
  - La página de la suite se arma con el código nuevo (`vite build`). **No se probó en pantalla** la suite en vivo ni el 2.º gráfico.
  - Sin la ruptura, en el backtesting global con el rango mayor de 6 cierres: los de noviembre de 2023 dejaron fuera sus 5 velas de ruptura y el perfil quedó en su caja, salvo las mechas.

## ACCIONES DE ALPACA: ALMACÉN Y VELAS (19/11/2026)

Pedido del usuario: acciones de la NYSE y el NASDAQ en App 1. Primero con footprints y Elementos OF de unos días recientes; después, velas profundas para el probador.

### Almacén de order flow (`alpaca_store.py`)

```
12.AltagraciaTradingSuite/server/alpaca_data.py (conector, importado sin copiar)
        │  trades SIP con el lado del agresor (regla del tick; Lee-Ready opcional)
        ▼
OrderFlowData/alpaca/trades/<SIM>/<día>_<método>.npz     crudos del día
        │  alpaca_store.py: solo 09:30-16:00 de Nueva York
        ▼
OrderFlowData/alpaca/store/<SIM>/<AAAA>/<SIM>_<día>.npz  minuto × precio, como tools/build_store.py
OrderFlowData/alpaca/flow/<SIM>/<AAAA>/<SIM>_<día>.npz   delta dentro del minuto y órdenes, como build_flow.py
```

- **Formato:**
  - precio con 4 decimales (escala 10,000), porque hay trades a fracciones de centavo;
  - celda de 0.01 USD;
  - cantidad con 2 decimales, porque hay fracciones de acción;
  - un trade sin lado (el primero del día con la regla del tick) va mitad y mitad.
- **Órdenes:** en acciones, un barrido toca varios mercados con horas distintas, de microsegundos. Por eso una orden son los trades seguidos del mismo lado separados por 1 ms o menos (`ORDER_GAP_US`). Se guardan las que cruzan 3 precios con 100,000 USD o más, y las de 500,000 USD o más.
- **Lectores:** `footprint_store.is_stock(símbolo)` es verdadero para un símbolo sin USDT con carpeta en `alpaca/store`, y `store_root()` elige la carpeta. `of_elements._flow_path()` hace lo mismo con el flujo. `ALPACA_STORE` y `ALPACA_FLOW` cambian las carpetas. Para las monedas nada cambia.
- **Uso:** `python -B alpaca_store.py AAPL,SPY,NVDA 2026-10-07 2026-11-18 [tick|lee_ready] [--rebuild]`. Las claves están en el `config/suite.json` de la suite; desde otra copia, se pasa su ruta con `SUITE_CONFIG`. Hoy tiene AAPL, SPY y NVDA, 31 días cada una.
- **Límite:** las velas de 1h y 4h de los footprints se cuentan desde la hora en punto UTC, así que la primera de 1h del día dura 30 minutos.

### Velas históricas (`alpaca_candles.py`)

- **Qué guarda:** `OrderFlowData/alpaca/candles/<SIM>.json.gz` (`ALPACA_CANDLES` cambia la carpeta), con las claves `"15"`, `"60"`, `"240"` y `"1440"`. Cada fila es `[ms, o, h, l, c, v, trades, vwap]`; las 6 primeras siguen el formato de `candles_update.py`. Son 99 acciones (`GROUPS`: índices, tech, consumo y volátiles) y 206 MB.
- **Sesión regular:**
  - la base son velas de 15 minutos;
  - 1h y 4h salen de unirlas desde las 09:30 de Nueva York (`alpaca_data.candle_keys(t, tf, "rth")`): la última de 1h dura 30 minutos y la segunda de 4h, 2.5 horas;
  - el día empieza a la medianoche de Nueva York;
  - solo cuentan velas cerradas.
- **Calendario de Alpaca** (`/v2/calendar`): deja los cierres tempranos (09:30 a 13:00) y quita los feriados. Sin calendario, en los cierres tempranos se colaba el horario extendido.
- **Días casi vacíos:** un día con menos de la mitad de sus velas (`MIN_DAY_SHARE`) se quita y queda como hueco, porque algunas acciones de la NYSE traían días con una sola vela.
- **Ajuste por splits** (`adjustment=split`): al actualizar se piden otra vez los últimos 7 días (`OVERLAP_DAYS`), y si sus precios cambiaron (un split nuevo), la acción se baja entera.
- **Tickers que fueron de otra empresa:** Alpaca pasa la historia al nombre nuevo (`asof`). `START` fija desde cuándo cuenta cada uno: NIO desde 2018-09-12, DKNG desde 2020-04-24 y RIOT desde 2017-10-04. XYZ trae la historia de SQ, que es la misma empresa.
- **Uso:** `python -B alpaca_candles.py [ACCIONES] [--rebuild]`. Sin acciones, actualiza todas. Bajar las 99 tarda unos 68 minutos (190 pedidos por minuto); actualizar, unos 2. El plan gratis da el SIP con 15 minutos de atraso, así que la descarga termina el día anterior.
- **Revisadas:** 83 empiezan en 2016 y el resto en su salida a bolsa o en `START`.
  - SMCI no tiene 349 días (de 2018-08 a 2020-01, cuando estuvo fuera del Nasdaq).
  - ROKU termina el 2026-11-06, porque Alpaca la da como inactiva.
  - GE quedó fuera: sus spin-offs (2023-01-04 y 2024-04-02) dejan caídas que el ajuste por splits no corrige.
- **Probador:** las lee "Acciones de Alpaca en el probador (20/11)", en la sección del probador.

### Pruebas

`tests/test_alpaca_store.py` (9) y `tests/test_alpaca_candles.py` (6), sin conexión:
- sesión regular en invierno y en verano;
- marcos mayores desde la apertura de Nueva York;
- actualización que suma lo nuevo y rehace la acción tras un split;
- cierre temprano y feriado;
- días casi vacíos;
- `START`.

## ESTADO PARA EL ENTRENADOR (17/11/2026)

Pedido del usuario: entrenar con el skill `/entrenar` y que Claude vea lo que tiene en App 1, no solo una captura. Claude lo lee con el navegador integrado de la app de Claude o con la extensión Claude in Chrome, ejecutando JavaScript en la pestaña de App 1.

- `backtesting/coachState.js` instala `window.__app1Coach` desde `BacktestingApp` (al montar; se quita al desmontar). Es de solo lectura: nada cambia la app ni su estilo.
  - `state()`: moneda, marco, hora a la vista, reproducción, precio, velas a la vista con las últimas 30, indicadores encendidos con sus ajustes, lo elegido para el análisis (`knownLevels`, hasta la hora a la vista), órdenes vivas, las últimas 5 cerradas y la caja TP/SL libre (`latestFreeBox`). `query` lleva `symbol`, `interval_minutes`, `known_until` y el rango a la vista, para pedir al backend.
  - `footprints(n)` y `elements(n)`: piden `/api/orderflow/historical` y `/api/orderflow/elements` de las velas a la vista con `known_until`, y devuelven delta, volumen, POC, niveles, imbalances, stacked y marcas.
  - `get(path, params)`: otra ruta GET `/api/` del backend; `price()`, `volume()` y `time()` convierten lo que devuelva a lo que ve el usuario.
- **Sin futuro:** las velas se filtran a la hora a la vista (`currentTime`), y los pedidos llevan `known_until`.
- **Fecha oculta:** horas como "Día N HH:MM", precio como índice y volumen en la escala oculta (`blindClock.js`), sin P&L en dólares, y las horas guardadas en los ajustes salen "(oculto)". Solo `query` trae horas reales.
- `MiniChart` suma `getVisibleCandles()` en su ref: las velas del último dibujo.
- Prueba: `tests/coach.test.mjs` (7).

## REJECTION PATTERNS: REGLA CORREGIDA (16/11/2026)

Pedido del usuario: revisar si el indicador identifica bien los patrones. Una auditoría con 1000 velas reales de BTC por marco encontró:
- **el envolvente del servidor nunca salía:** en cripto cada vela abre donde cerró la anterior, y la regla pedía superar los dos bordes del cuerpo anterior de forma estricta. Daba 0 en 15m, 1h y 4h;
- **el envolvente del navegador salía en el 26% de las velas:** aceptaba empates, sin cuerpo mayor ni mínimo, y también con dojis;
- **la mecha contraria se medía contra el cuerpo y no contra el rango:** se perdía casi la mitad de los martillos y estrellas de libro;
- **ninguno miraba la tendencia previa:** un martillo después de una subida (hanging man) se marcaba igual;
- **"requireVolumeSpike" no filtraba:** solo sumaba confianza;
- **el modo validado medía la distancia al nivel con el cierre y sin lado:** un martillo que cerró 0.72% bajo un VAL contaba como "cerca".

**Ahora:** una sola regla en `indicators/candlePatterns.js` (navegador, modo "todos") y `backend/candle_patterns.py` (servidor, modo "validado" y la suite), línea por línea.
- **Formas (Nison, Bulkowski),** con rango = máximo − mínimo:
  - doji: cuerpo de hasta 5% del rango; libélula con la mecha de arriba de hasta 10%, lápida con la de abajo de hasta 10%;
  - martillo: cuerpo de hasta 33% del rango, mecha de abajo de al menos `minWickRatio` cuerpos (2) y mecha de arriba de hasta 10% del rango. La estrella fugaz, al revés;
  - envolvente: colores opuestos, la anterior con cuerpo de al menos 10% de su rango, la actual con al menos 30% del suyo, el cuerpo más grande y cubriendo el anterior (un empate en un borde vale);
  - una vela tiene a lo sumo un patrón: doji, si no envolvente, si no martillo o estrella.
- **Tendencia previa** (`filters.requireTrend`, de fábrica sí; `filters.trendBars`, 5): los alcistas piden que el cierre anterior esté bajo el de 5 velas antes, y los bajistas, sobre él. Se apaga en el modal.
- **Volumen:** el filtro es `volumeZScore` (z-score contra las velas anteriores, sin la vela) y ahora vale en los dos modos. `requireVolumeSpike` sigue sumando confianza en el validado, con su texto corregido en el modal.
- **Solo velas cerradas,** también en el servidor (`in_progress`).
- **Validado:** el rechazo se mide en la mecha que toca el nivel (el mínimo en un patrón alcista, el máximo en uno bajista) y la vela tiene que cerrar de su lado. La proximidad suma el peso del nivel por lo cerca que lo tocó.
- **Medido** con 999 velas cerradas de BTC (15m, 1h y 4h), con la tendencia:
  - en 15m: 29 martillos, 19 estrellas y 130 envolventes (antes: 0 en el servidor y 271 en el navegador). El 18% de las velas lleva un patrón;
  - 17% de las velas en 1h y 14.5% en 4h.
  En cripto el envolvente es frecuente porque cada vela abre en el cierre anterior.
- **Pruebas:** `backend/tests/test_candle_patterns.py` (9, con la paridad contra el navegador en 30,000 velas al azar), `test_rejection_known.py` (13) y `leaks.test.mjs` (43).

## OBSERVADOR (Noviembre 2026)

Mide cada operación manual contra la regla del laboratorio, sin mostrar esa lectura antes de decidir.

### Flujo

```
TradingControls: orden nueva, con los niveles elegidos en el gráfico
        │  onOrderCreated → BacktestingApp.observeOrder()
        ▼
observer.js → POST /api/observer/orders                 Responde solo { id }
        ▼
backend/observer.py: read_at() → journal.jsonl          La lectura queda en disco
        ▼
OrderManager: llenado, cierre o cancelación → POST /api/observer/orders/{id}/events
        ▼
GET /api/observer/orders                                Trae la comparación solo si la orden terminó
GET /api/observer/report                                Informe de todo lo registrado
```

### Registro

- `OrderFlowData/observer/journal.jsonl`. `ORDERFLOW_OBSERVER` cambia la carpeta
- Una línea por evento: `order`, `fill`, `close`, `cancel`, `marks` y `blind`. Las líneas solo se agregan. `trades()` arma el estado de cada orden
- `order.observerId` une los eventos y viaja con la sesión guardada. Una orden sin ese campo no envía eventos
- `observer.js` envía en cola: el cierre nunca llega antes que la orden

### Lectura

- `read_at()` repite `readAt()` de `research/lab/engine.js`, con las reglas de `research/REGLAS_RONDA3.md` en el diccionario `RULE`
- Usa minutos anteriores a la hora de la orden, velas cerradas y cada dato de OI 5 minutos después de su marca
- Lee 45 días hacia atrás (`LOOKBACK_DAYS`). Sin trades en el almacén para esa fecha guarda `available: false`
- Con las celdas del laboratorio no tiene diferencias. Con el almacén, que tiene celdas más finas, contexto, movimientos y OI son iguales y algunos bordes de cluster cambian un poco
- `read_at(..., live=None, oi=None)` (13/11): el journal de la suite (`12.AltagraciaTradingSuite/server/journal_reading.py`) lee trades reales con `live=True` (días oficiales y, donde faltan, los de la nube y el PC) y `oi`, la serie de 5 minutos local más lo reciente de Bybit (`_oi_window(symbol, t, series)`). App 1 no los pasa: llama al almacén como siempre, sin `live`, y las pruebas que reemplazan `footprint_store.minutes` con tres argumentos siguen sirviendo

### Oculto hasta terminar

- `record_order()` nunca devuelve la lectura. `public_trade()` quita `reading` siempre y agrega `comparison` solo en órdenes cerradas o canceladas
- Si un cambio necesita mostrar algo antes, debe pasar por `public_trade()`. La prueba `test_la_lectura_no_sale_mientras_la_orden_sigue_viva` lo vigila

### Ver una orden del registro en el gráfico (17/11)

El panel lista las órdenes de todas las sesiones (`journal.jsonl`), pero el gráfico solo dibujaba las de la sesión abierta, y nunca pasa de la hora simulada. Al abrir una orden de otra sesión se veía su información y nada en el gráfico.

- Cada orden tiene "Ver en el gráfico" (`registryChartView()` en `observer.js`, `showRegistryTrade` en `BacktestingApp`): cambia a su marco, lleva la vista a su entrada con `focusOn()` y dibuja su línea (`getTradeBoundaries`) y su caja de entrada, stop y objetivo (`getTradeBoxes`). No mueve la hora simulada.
- Solo si la simulación ya pasó por la entrada. Si no, el botón dice la fecha de la orden, la hora simulada y desde qué fecha hay que iniciar para verla. Si la orden termina después de la hora simulada, la caja llega hasta ahí.
- Con fecha oculta no muestra órdenes de otras sesiones. Una orden de otro símbolo avisa cuál abrir. La caja de una orden de la sesión abierta no se repite: ya está entre los dibujos.
- Se dibuja una orden a la vez, y deja de dibujarse si se retrocede antes de ella. Prueba en `observer.test.mjs`. No se probó en pantalla.

### Retrocesos y fecha oculta

- `maxSimTimeRef` guarda hasta dónde llegó la simulación. Una orden anterior a ese punto queda con `rewound: true` y el informe la excluye salvo que se pida
- `blindClock.js` guarda el inicio oculto. `maskDate()` muestra `Día 3 14:30` en el encabezado, eje, cruz, historial, rendimiento, dashboard y perfiles fijos
- `blind_start()` elige un día de cualquier tramo sin huecos del almacén (`footprint_store.continuous_runs()`), 45 días después de su inicio y 14 antes de su final, separado 14 días de las fechas ya usadas. Hasta el 18/11 solo miraba el último tramo: al faltar el día 14/11/2026 de BTC, ese tramo medía dos días y respondía "No quedan fechas sin usar"
- **Precio como índice** (fase 4, 10/11, pedido del usuario: lo que importa son los porcentajes). Al iniciar con fecha oculta, `scaleFromCandles()` fija la escala: el cierre de la última vela antes del inicio vale `base`, al azar entre 80 y 120 con 3 decimales, y todo precio se muestra como `precio × base / ref`. Los porcentajes no cambian. El volumen, el delta, el CVD, el OI y las cantidades en monedas se multiplican por `1000 / volRef`, la mediana de las 96 velas previas: así la vela típica del inicio vale 1,000
  - Solo cambia lo que se lee. Órdenes, registro, sesión e informe del backend siguen en precios reales. La escala viaja en la sesión (`blindScale`); una sesión oculta guardada antes la arma con sus velas. "Revelar fecha" la quita
  - `blindClock.js`: `maskPrice`, `unmaskPrice`, `priceText` (índice con 3 decimales), `priceLabel` (sin `$` en el índice), `maskVolume` y `quantityText`. Sin fecha oculta devuelven lo de siempre
  - Cubre: eje (pasos redondos del índice), leyenda, cruz, último precio, encabezado, menú de niveles, niveles elegidos, perfiles (POC, VAH, VAL y volumen), S&R, S&R v2, VP fijo y periódico, footprint y su delta, tabla de Elementos OF, paneles de volumen, CVD y OI, dibujos (línea, Fibonacci, caja TP/SL, rectángulo y medición), panel de trading, confirmación, pendientes, rendimiento, historial, dashboard, Excel, Observador, rangos fijos, velas fijadas y contextos de Rechazos
  - El campo "Precio de entrada" se escribe en el índice y se convierte con la escala con que se escribió, aunque luego se revele la fecha. Probado: 81.000 en el índice quedó como 59,077.37 en el registro, con el mercado en 81.696 = 59,585
  - Quedan con números reales: el JSON de exportar sesión, las notificaciones de Double Top/Bottom y la tarjeta de footprint del panel lateral, que no está conectada. El aviso "Bybit no tiene datos tan antiguos" del OI dice que la fecha es vieja

### Informe

- `report()` separa órdenes cerradas, sin terminar, canceladas, con fecha oculta y tras retroceder
- Por condición de la regla y por marca: presencia, acierto y R con y sin ella. R es neto de costos y necesita stop
- Incluye cuánto se sigue cada parte de la regla (`RULE_PARTS`), tú contra la regla, zona contra azar y mejor tercio contra peor tercio
- `small_sample` avisa con menos de 30 órdenes cerradas. El intervalo del acierto es Wilson al 95%

### Comprobar contra el laboratorio

```bash
cd C:\Users\inven\OrderFlowData\research\lab
node observer_dump.js
"...\Backtester\backend\.venv\Scripts\python.exe" -B observer_parity.py
```

Debe decir `diferencias con celdas del laboratorio {}` y detectar cada error metido a propósito.

---

## REGISTRO AUTOMÁTICO (Noviembre 2026)

Cada orden queda medida sola, sin llenar nada antes de entrar. Sirve para encontrar qué tienen en común las entradas y cuáles de esas condiciones se sostienen en el histórico.

### Flujo

```
MiniChart: clic en un nivel o una marca → analysisLevels.js (papel y nota)
BacktestingApp.observeOrder(): drawingsForOrder() + takeLevels()   Lo elegido pasa a la orden y sale de la lista
        ▼
observer.js → POST /api/observer/orders                 Hechos de la orden, dibujos y niveles
        ▼
measures.py: una fila por vela de 15m cerrada
patterns.py: reading() cruza la orden con esa tabla
        ▼
GET  /api/observer/orders                               Medidas solo si la orden terminó
GET  /api/observer/patterns/{symbol}                    Entradas contra momentos sin entrada
POST /api/observer/rule-test/{symbol}                   Regla en fechas no operadas
GET  /api/observer/export/{symbol}                      CSV de todo el registro
```

### Tabla de medidas

- `measures.py` arma `OrderFlowData/observer/measures/{symbol}.npz` desde el caché de velas. BTC: 176,633 filas, 25 s, 22 MB
- 58 medidas de 15m, 1h y 4h en `MEASURES`: contexto, tramo, volumen, Volumen de Respuesta, volatilidad, FVG, perfil, OI, delta y hora UTC. La sesión del mercado se quitó porque cripto opera 24/7. Una tabla hecha antes conserva esa columna sin usarla hasta reconstruirse: por eso `VERSION` no cambió
- Sale siempre del mismo cálculo, sin importar los indicadores en pantalla. Por eso una orden vieja se puede releer y una regla se puede probar en todo el histórico
- Una fila solo usa lo conocido al cierre de su vela: agregar velas no cambia las filas ya calculadas
- Distancias en ATR y volumen contra la mediana de su hora en 30 días, para comparar fechas distintas
- `column()` lee cada medida a favor de la orden. El último elemento de `MEASURES` dice cómo: `1` cambia el signo, `0` no cambia, `"mirror"` da la vuelta a una posición de 0 a 1 y un par elige la columna de cada lado
- `table_for()` no bloquea. Si falta la tabla, o una orden queda después de su final y el caché es más nuevo, `_start_build()` la prepara en otro proceso y devuelve lo que haya. El panel lo avisa y vuelve a preguntar
- `flow_columns()` salta los días del almacén fuera de las velas (12/11): el resultado es el mismo y una tabla de pocas semanas no lee los miles de días de BTC. Lo usa el journal de la suite (`12.AltagraciaTradingSuite/server/journal_measures.py`), que llama a `compute()` con velas de Bybit para las medidas de cada trade real
- `compute(symbol, frames, oi=None, live=None)` (13/11, para la suite): `oi` es la serie de OI que usar en lugar de la local (`oi_columns(..., series)`), y con `live=True` el delta lee también los días de la nube y el PC donde falta el oficial (`flow_columns(..., live)`). De esos días no cuentan las velas que tocan un hueco de 10 s o más (`LIVE_GAP_TOLERANCE_MS`) ni las posteriores al último guardado. Las reconexiones de 5.8 s no dejan su vela sin delta: medidas contra Bybit, dejaron el volumen de 0.1% a 0.6% bajo, y una vez 6.4%. Un día de la nube ilegible se salta. App 1 no los pasa: su tabla sigue igual y `VERSION` no cambió
- `_cache_path()` usa una ruta relativa: el proceso debe correr en `backend/`
- `reading()` se calcula al pedirla: no se guarda en el registro, así que una tabla nueva relee las órdenes viejas sin hacer nada
- **Medidas del libro (14/11, pedido del usuario):** `backend/book_reading.py` importa `book_measures.py` de la suite (`12.AltagraciaTradingSuite/server`, sin copiarlo) y suma a `decision` sus 9 medidas, en el grupo "Libro": liquidez a ±0.5% y su percentil, desequilibrio, liquidez en tu entrada y su persistencia, cambio entre tu entrada y tu stop, y al llenarse lo retirado y lo negociado en tu entrada. Lee el libro que graba la suite (`OrderFlowData/live/book` y `live/book_cloud`), que existe desde el 13/11/2026 a las 14:00 UTC (`BOOK_SINCE_MS`): una orden simulada en una fecha anterior no las tiene, y sin la suite nada cambia. `/api/observer/measures` suma su catálogo, `_labels()` sus nombres, y el informe las compara solo entre ganadoras y perdedoras (los momentos sin entrada no tienen libro). Una por orden y estado queda en memoria. Prueba: `tests/test_book_reading.py` (4)

### Lectura de cada orden

- `reading()` da `decision` (última vela cerrada al crearla), `fill` (al llenarse, si cambió de vela), `order`, `references` y `outcome`
- `order_measures()`: lo que se decidió en la orden, en ATR
- `outcome()`: R neto, lo máximo a favor y en contra con velas de 5m, duración y espera. Una cancelada queda con `filled: false`
- `orders()` agrega `automatic` solo en órdenes cerradas o canceladas. Mientras sigue viva no sale ninguna medida

### Dibujos y niveles

- `drawingsForOrder()` guarda línea horizontal, línea vertical, tendencia, rectángulo y Fibonacci (0, 27, 61.8 y 100%) trazados en las últimas 100 velas (`DRAWING_WINDOW_CANDLES`) o que tocan esas velas. Quedan fuera TP/SL, medición y texto
- `shape.createdAt` es la hora simulada del trazo. Un dibujo posterior a la orden, o anclado solo en su futuro, no cuenta. Los dibujos viejos sin esa hora se juzgan por sus anclas
- `selectableLevels()` de cada indicador dice qué se puede elegir: solo lo que está dibujado. VP Fixed y VP Periodic se alcanzan dentro de sus horas. S&R respeta sus casillas de resistencias y soportes. El Volume Profile oculto por `hideWhenFixedRanges` no ofrece nada
- FVG ofrece borde alto, 50% y borde bajo de cada gap a la vista, desde su vela. Order Flow, solo con footprints a la vista, ofrece el POC de cada vela, sus stacked y, con cifras, sus imbalances sueltos; con velas angostas, la línea de stacked y el rombo de delta contrario. No dibuja nada para eso: el gráfico no se satura
- Marcas: rombos y flechas de Volumen de Respuesta, señales de Swing, entradas de Double Top/Bottom, rechazos y delta contrario. Desde el 11/11 también la línea y las bandas del VWAP, las barras de volumen y la columna de cada vela en los paneles (ver "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11"). Llegan con `mark: true` y su lugar ya calculado en el dibujo (`x`, `y`, `r`). Una zona llega con `left`, `right`, `top` y `bottom`
- `levelTargets()` da el lugar en pantalla y deja tal cual lo que el indicador ya ubicó. `levelsNear()` alcanza una línea a 6 px, una marca dentro de su círculo y una zona en su alto con 3 px de margen. Con varios cerca, el menú los lista todos
- Al marcar la casilla aparece su papel: Soporte, Resistencia, Entrada u Objetivo. Un nivel entra como resistencia si está arriba del precio y como soporte si está abajo; una marca entra como "Solo marca". También lleva una nota: por qué es importante
- **Solo dato (12/11, pedido del usuario al probar la suite):** todo nivel de cualquier indicador ofrece además "Solo dato" (`DATA_ONLY = 'data'`, `roleOptions()`): el VWAP o un POC que se mira sin usarlo de soporte, resistencia, entrada ni objetivo. Sigue siendo un precio de referencia: se dibuja y `references()` lo cuenta, con el papel "Solo dato". Una marca sigue con "Solo marca"
- **Orden cancelada sin llenarse (12/11):** lo elegido para ella vuelve a la lista con su papel y su nota (`restoreLevels()`, en el aviso `orderCancelled`), para la orden que la reemplace. Antes quedaba solo en la orden cancelada. Lo que ya está en la lista no se repite
- **Con números (12/11, pedido del usuario; `chosenStyle="numbers"` de `MiniChart`):** en lugar de la etiqueta morada, cada elegido lleva un círculo pequeño con su lugar en la lista, y la etiqueta sale al pasar el mouse (`chosenNumbers`, `drawChosenTooltip`). El número de un nivel va donde nace su línea, sin tapar las últimas velas. Así quedaron la principal (`BacktestingApp.jsx`), el 2.º gráfico (`SecondaryChartApp.jsx`) y la suite. La lista "Niveles y marcas en análisis" del panel de trading lleva los mismos números (`AnalysisLevels` con `numbered`)
- **Caja TP/SL en monedas baratas (12/11):** sus precios llevaban siempre 2 decimales, y un SL de 0.14702 decía "0.15". Ahora `boxPriceDigits` deja 2 decimales desde 10 (sin cambios en BTC, ETH ni SOL) y por debajo los que dan unas 5 cifras: 1.0346, 0.14702, 0.067012
- **Imágenes de las órdenes en App 1:** llevan solo las líneas tenues y los aros (`captureChosenStyle="lines"`, `bare` en `drawChosenLevels`). El visor del Observador les pone encima sus números azules, que son los mismos (lugar en `order.analysisItems`). Antes la imagen traía además la etiqueta morada. Las imágenes ya tomadas no cambian. La suite sí dibuja los números en la imagen: su journal no tiene ese visor
- Un elegido guarda precio, `selectedAt` con la hora simulada, papel (`role`), nota y, si nace en una vela, `time`, `low`, `high` y `mark`. Nunca su lugar en pantalla. Al retroceder no aparecen los elegidos después. La lista se guarda en `analysis_levels_v2_{symbol}` y la comparten los marcos. La de antes, `analysis_levels_{symbol}`, juntaba lo elegido para todos los trades y no se carga. Un nivel elegido antes de los papeles queda como "Nivel"
- Lo elegido vale para un solo trade. Al crear la orden, `takeLevels()` lo pasa a `order.analysisItems` y lo quita de la lista: el trade siguiente empieza sin nada elegido y el menú lo muestra sin marcar. La orden conserva su copia, con papel y nota, y con ella van el registro, el Observador, el historial y las imágenes. Lo elegido después de la hora de la orden, que solo existe tras retroceder el reloj, sigue en la lista
- `references()` mide cada referencia desde la entrada en ATR, con positivo detrás de la entrada. A 0.25 ATR o menos cuenta como "en el nivel" (`NEAR_ATR`). Una marca sin papel no es una referencia. `ref_entry_atr` y `ref_target_atr` miden la entrada contra el nivel de papel Entrada más cercano y el objetivo contra el de papel Objetivo; van al informe y al CSV
- Al escribir una nota, Delete no borra el dibujo seleccionado y las flechas no cambian de trade
- Lo que nace en una vela lleva su marco en el id (`candleItemId(..., interval)`): el rombo de 1h no es el de 15m. Los bordes de un FVG usan los precios con que nació el gap, así siguen siendo el mismo cuando se recorta, y valen en todos los marcos
- Al retroceder, el menú solo da por elegido lo elegido hasta esa hora (`chosenLevel(symbol, id, time)`). Elegirlo antes reemplaza al elegido después, sin su papel ni su nota. "Quitar todos" solo quita lo que se ve
- Lo elegido en otro marco se ubica en la vela de este marco que contiene su hora (`candleCenterX`), en el gráfico y en las imágenes
- El menú se acomoda al crecer para no salirse del gráfico, y las marcas del visor siguen a la imagen cuando cambia la ventana

### Informe y reglas

- `control_rows()`: 10 momentos sin entrada por orden, a 7 días o menos y a más de 120 minutos de cualquier entrada. La semilla sale del id, así que no cambian entre lecturas
- `compare_groups()`: mide con AUC y marca `clear` solo si supera el umbral de 300 permutaciones sobre todas las medidas juntas. Con menos de 5 datos por grupo no compara
- `small_sample` avisa con menos de 30 entradas. La hora no se compara como número
- `rule_test()`: hasta 3 condiciones, entrando al cierre de la vela. Excluye las fechas operadas con un día de margen, para no probar una idea en los datos que la sugirieron. Stop 1.5 ATR, objetivo 2R, horizonte 96 velas y 16 velas entre señales por defecto. Si stop y objetivo caen en la misma vela cuenta el stop. Costos de taker a la entrada y la salida
- Compara contra la base: la misma simulación con todas las velas permitidas. Sin esa base, un resultado positivo puede ser solo la tendencia del periodo

### Lo que no hace

- Los resultados son del histórico y no anticipan el futuro. Con pocas órdenes el informe solo describe
- Los motivos son opcionales: `ObserverReading` los pide al terminar la orden y se guardan como evento `marks`
- Las órdenes guardadas antes de este cambio no traen dibujos ni niveles

### Si cambia una fórmula

Subir `VERSION` en `measures.py`: `_load()` rechaza la tabla vieja y se reconstruye sola. `balance()`, `equilibrium()` y `hour_volume()` repiten `responseBalance.js` y `research/response_volume/engine.py`. Si cambia esa regla, hay que cambiar los tres.

---

## ÓRDENES (Noviembre 2026)

`TradingControls.jsx` usa `orderPlan.js`, que repite la lógica de `8.AnalizadorDesktop/src/components/trading/OrderForm.jsx`.

- **Caja:** `latestFreeBox()` toma la última caja dibujada que no sea de una orden. Da entrada, stop, objetivo y lado. La casilla "Usarla" vuelve a los campos del panel
- **Tamaño:** monto fijo, o por riesgo con `cantidad = riesgo / |entrada - stop|`. El riesgo no incluye comisiones: con 10 USDT y stop de 0.77% la pérdida fue 10.98. El modo elegido se guarda en `localStorage`
- **Automática:** a 0.1% o menos del precio es market. Más lejos, `limit` si el precio debe volver a la entrada y `stop` si debe avanzar hasta ella. App 8 siempre envía limit: aquí una limit en el lado equivocado se llenaría de inmediato
- **Una orden que usa la caja:** queda en `order.tpslBoxId`. `anchorTPSLBox()` mueve la caja a la entrada real al abrir y `extendTPSLBox()` la termina en la salida. Cancelar la orden deja la caja libre
- **Caja nueva:** `defaultBoxSize()` da 45 px de riesgo, 130 px de ancho y riesgo beneficio 2, sin salirse del gráfico. Sin escala usa 0.5%
- **Precio del momento:** `orderEntry()` da la entrada: la de la caja o, con "Usar precio actual", el precio de ese momento. Antes salía del campo del panel, que copia el precio un dibujo después: un clic en ese intervalo dejaba la orden automática pendiente como stop o limit al precio anterior
- **Caja de una orden viva:** `boxesFollowOrders()` corre en cada cambio de dibujos y devuelve la caja de una orden pendiente o abierta a su entrada (la ejecutada si ya abrió), su stop y su objetivo. Para cambiar una orden pendiente se cancela: su caja queda libre
- **Llenado de las limit (13/11, pedido del usuario tras el informe del price ladder):**
  - una limit se llena solo si el precio pasa más allá de su precio: la de compra, cuando el mínimo de la vela queda por debajo; la de venta, cuando el máximo queda por encima (`limitFilled()` en `OrderManager.js`);
  - antes bastaba con tocarlo (`candleLow <= entryPrice`). En el mercado, si hay cola delante, el precio puede tocar tu precio y rebotar sin llenarte, y esos son los mejores trades: los resultados con limit salían inflados;
  - cuando el precio negocia más allá, todo lo que había en ese precio ya se negoció o se retiró, así que la orden se llenó. Se llena a su precio y paga maker, como antes;
  - el ruido de coma flotante (1e-9 del precio) cuenta como toque;
  - el stop de entrada, el SL y el TP siguen al tocar: en Bybit son órdenes condicionales que salen a mercado al llegar el precio;
  - cada limit llenada guarda su regla en `order.fillRule` (`'cross'`), y el Observador la recibe en el evento `fill` (`fill_rule`). Las órdenes de antes no la tienen: se llenaron al tocar;
  - `localStorage.setItem('limit_fill_rule', 'touch')` y recargar vuelve a la regla anterior, para comparar en el Observador; `removeItem` la deshace;
  - pruebas en `replay.test.mjs` (20), `journal.test.mjs` (45), `observer.test.mjs` (43) y `test_observer.py`.
  
  La suite (`12.AltagraciaTradingSuite`) no simula llenados: sus limit son reales y las llena Bybit.

---

## SESIONES (Noviembre 2026)

`indicators/sessionProfile.js` da las sesiones y sus perfiles a VP Periodic. Hay una instancia de `SessionProfiles` por marco.

- `sessionStart()` usa hora UTC. La semana empieza el lunes
- Un perfil empieza estimado con las velas. Solo una sesión terminada pide volumen real a `/api/orderflow/profile`, cortado en su final, y se usa si el almacén cubre 99% de sus minutos. La sesión en curso sigue estimada
- **VP Periodic:** un perfil por sesión con POC, VAH y VAL. Solo usa `priceContext.knownCandles`

---

## VOLUMEN DE RESPUESTA (Noviembre 2026)

Concepto del usuario, por observación propia. Al empezar un movimiento sube el volumen vertical. Mientras avanza, las velas a favor pesan más que las de contratendencia. Cerca de una pausa o un giro, el volumen de la retracción se equipara al de la tendencia.

`indicators/responseBalance.js` lo calcula y `ResponseVolumeIndicator.js` lo dibuja. El estudio está en `OrderFlowData/research/response_volume/`, con el resultado en `INFORME.md`.

### Regla

| Parámetro | Fábrica | Significado |
|-----------|---------|-------------|
| `legAtr` | 2 | El tramo gira cuando un cierre se aleja 2 ATR del extremo |
| `window` | 10 | Velas comparadas, sin pasar del inicio del tramo |
| `top` | 5 | Velas principales de cada lado |
| `adjustHour` | sí | Cada vela dividida por la mediana de su hora en los 30 días anteriores |
| `dominance` | 2 | D desde el que se arma la señal |
| `balance` | 1 | D en el que aparece la señal |
| `spikeMultiple` | 2 | Veces lo normal de su hora para marcar una flecha |

`D = T / R`, con el promedio de las velas principales de la tendencia y de la respuesta. El lado sale del color de la vela. D queda entre 0.1 y 10.

### Dibujo

- Panel: `presión = dirección × log2(D)`. Arriba de cero pesa la compra y abajo la venta, con tope en cuatro veces. Las líneas punteadas marcan el dominio
- Precio: flecha en velas de agresión y rombo en la señal, del lado del extremo del tramo
- Con menos de 2px por vela no hay marcas. La vela en formación no tiene barra ni marca

### Sin futuro

- `ResponseSeries.update()` recibe `priceContext.knownCandles` y solo procesa las velas cerradas que le faltan. Agregar velas nunca cambia lo calculado
- Al retroceder no recalcula: `known` limita lo que se muestra
- Cambiar una regla reinicia la serie y cambiar marcas no. 15m completo tarda 0.7 s

### Evidencia

Elegida con datos hasta 2024 y medida una sola vez en 2025 y 2026, contra velas a la misma distancia del extremo y con la misma edad del tramo:

| Marco | Señales | Nuevo extremo con señal | Sin señal | IC 95% |
|-------|---------|-------------------------|-----------|--------|
| 15m | 1,156 | 29.2% | 34.8% | [−8.4, −2.7] pts |
| 1h | 260 | 21.2% | 31.7% | [−16.6, −4.6] pts |
| 4h | 62 | 32.3% | 36.4% | [−17.8, +12.1] pts |

- Avisa de menos continuidad. No anticipa dirección: el movimiento neto a 20 velas no se distingue
- No detecta techos ni suelos: cerca del final de un movimiento hay señal casi con la misma frecuencia que al azar
- Sin ajuste por hora la idea no se sostiene. El delta real no mejora al color de la vela
- Réplica con la misma regla en ETH y SOL: el signo se repite en los 6 casos. Se sostiene en 1h (−5.5 y −5.8 puntos) y en ETH 4h, y es débil en 15m. Detalle en `research/response_volume/INFORME_OTROS_SIMBOLOS.md`

### Comprobar contra el estudio

```bash
cd C:\Users\inven\OrderFlowData\research\response_volume
"...\backend\.venv\Scripts\python.exe" -B export_parity.py ruta\response_parity.json
cd ...\frontend
node --max-old-space-size=4096 tests/response.test.mjs ruta\response_parity.json
```

Debe dar diferencia máxima 0. `responseBalance.js` repite `engine.py`: si cambia una regla, hay que cambiar los dos.

---

## REPRODUCCIÓN LIGERA (Noviembre 2026)

Cada tick debe costar lo mismo con 1,000 o con 1,000,000 de velas. Medido en la app con 15m, cinco indicadores y S&R v2 con z=1.5 a 10000x: de 4.5 ticks por segundo y 9 s bloqueados de cada 10 a la velocidad pedida exacta, 60 cuadros por segundo y 9% del navegador. En 1m, de 60% a 4%.

### Reloj (TimeController.js)

- Cuenta el tiempo simulado que debió pasar. Si un tick llega tarde, o la velocidad pide más de lo que da un intervalo de 16 ms, avanza varias subdivisiones
- Tras un bloqueo largo no recupera más de 1 s de tiempo real
- Las subdivisiones salen del marco con que se creó el reloj, no del marco activo, salvo que un marco más fino esté a la vista (`setStepTimeframes()`)
- El tick lo marca un Worker: en una pestaña oculta los `setInterval` de la página quedan en uno por segundo (ver "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11")

### Tick (BacktestingApp.handleTimeUpdate)

- `settleOrders()` corre en cada tick. Una orden nunca depende de cuánto se redibuje
- `setCurrentTime` y `setCurrentPrice` corren cada `SCREEN_UPDATE_MS` (100 ms) mientras reproduce, y siempre al pausar, detener o saltar
- Una orden nueva baja `settledTimeRef` a su hora, porque la pantalla puede ir un poco detrás del reloj
- El efecto de `currentTime` solo liquida con el reloj detenido y en su misma hora (`tickAlreadySettled`). Con una hora vieja repasaría velas: una orden recién llena se cerraba con velas anteriores a su entrada
- `updateOrders` ignora en una orden abierta las velas que cierran antes de `executedAt`, también al retroceder de verdad
- Al cambiar la velocidad la hora se publica enseguida: a 1x el siguiente tick tarda 5 minutos reales
- `observerViewer` toma lo vivido del reloj y no de la pantalla, o el Observador ocultaría una orden recién cerrada. `maxSimTimeRef` sigue a la pantalla porque `rewound` compara contra ella

### Gráfico (MiniChart.jsx)

- Solo el marco visible (`isActive`) sigue la hora. Los demás se ponen al día al mostrarse
- `syncKnownCandles()` cambia `candlesRef` en sitio: `knownCandles` es el mismo arreglo entre ticks. Un indicador que lo guarde lo verá cambiar, y uno que quiera detectar un cambio debe mirar largo y timestamps
- Las velas se validan al cargarlas. `drawChart` no copia ni filtra en reproducción
- El límite de 33 ms actúa desde el segundo dibujo y siempre dibuja lo último pedido
- En vivo, cada precio de Bybit pide un dibujo (unas 10 veces por segundo por moneda). La prop `liveRedrawMs` (13/11) los junta con `redrawPacer.js`: a lo sumo un dibujo cada tantos ms, y al cambiar el valor lo pendiente se dibuja ya. La usa la Watchlist de la suite: 500 ms a la vista y 30 s fuera de ella. Sin la prop, como siempre: uno por cuadro. App 1 no la usa
- Dos props para el análisis post-trade de la suite (13/11); App 1 no las pasa y nada cambia:
  - `drawingsSource` = `{ key, load(), save(shapes) }`: otra capa de dibujos en lugar de `/api/drawings/{símbolo}`. Al cambiar su `key` (o al quitarla) el gráfico vacía los dibujos y carga los de la capa nueva: nunca se mezclan, y lo dibujado se guarda solo en la capa a la vista. Un guardado que termina después de cambiar de capa no se avisa a `onDrawingsChange`;
  - `chosenItems`: lo elegido que se muestra en lugar de la lista del panel (lo de un trade). Mientras está, un clic no abre el menú de niveles, que cambiaría esa lista.
- `captureScreenshot` dibuja la imagen sin la selección ni el resaltado de un dibujo (13/11), como ya lo hacía sin la cruz del mouse. Vale también para las imágenes de las órdenes de App 1
- **Fondo de los indicadores (13/11):** un indicador con `renderBackground(ctx, bounds, visibleCandles, allCandles, priceContext)` se dibuja antes de las velas, recortado al área del precio. `priceToY` y `timeToX` se arman antes de las velas para eso, y son los mismos que reciben los overlays. Hoy solo lo tiene "Mapa de liquidez" (`indicators/LiquidityMapIndicator.js`, con `liquidityMap.js`). Lo enciende la pestaña "Mapa" de la suite, con el libro que graba la suite: App 1 no tiene libro de sus fechas y no lo ofrece. `IndicatorManager.hasBackgrounds()` y `renderBackgrounds()` lo llaman; sin indicadores con fondo, el dibujo es el de siempre. Prueba: `tests/liquiditymap.test.mjs` (12)
- **Compra y venta por separado (14/11):** con `sides` (de fábrica en la suite), `liquidityMap.js` guarda las dos y pinta cada precio con el lado que más tiene, en los colores del interés abierto del estilo (`THEME.oiUp` compra, `THEME.oiDown` venta; `sideRamp`, `hexRgb`)
- **Niveles sostenidos (14/11):** `indicators/SustainedLevelsIndicator.js` (con `sustainedLevels.js`) también se dibuja de fondo, encima del mapa: los niveles de liquidez sostenida que calcula la suite (`/api/book/levels`), con cómo terminó cada uno. Lo enciende el botón "Niveles" de la pestaña "Mapa" de la suite; App 1 no lo ofrece. Prueba: `tests/sustainedlevels.test.mjs` (5)
- **Defensa de zona (14/11):** `indicators/ZoneDefenseIndicator.js` (con `zoneDefense.js`), encima de las velas: qué hizo la liquidez cuando el precio llegó a las líneas y rectángulos de la moneda (`/api/book/defense` de la suite). Lo enciende el botón "Defensa" de la pestaña "Mapa"; App 1 no lo ofrece. Prueba: `tests/zonedefense.test.mjs` (4)
- **Línea horizontal con texto (14/11):** `drawing/shapes/HorizontalLine.js` acepta `label` (texto arriba a la izquierda, con fondo) y conserva `tape` al guardar. La suite los usa para las órdenes de su cinta; una línea sin texto se ve igual que antes. También acepta `style.opacity`, `style.labelSize` y `style.labelBg` (opcionales). Las líneas con `tape` en firme se ofrecen al menú "Incluir en el análisis" (`tapeDrawingLevels` de `analysisLevels.js`), y un clic sobre ellas, que las selecciona como dibujo, también abre ese menú (`openTapeMenu` en `MiniChart`). Prueba: `tests/tapelevels.test.mjs` (1)
- La prop `viewOnly` (13/11) deja el gráfico solo para mirar: el arrastre mueve las velas y la rueda acerca, pero los dibujos no se eligen, mueven, editan ni borran (el clic va directo al paneo), un clic no abre el menú de niveles y no se dibujan los divisores de altura ni los ▲▼ de los paneles. La usa la Watchlist de la suite, cuyas celdas muestran los dibujos y las alturas de la moneda que usa su gráfico principal. App 1 no la usa

### Indicadores

- Nada recorre todo el historial en un dibujo: `countBefore`, `timestampIndex` y `candlesBetween` de `replayClock.js` buscan por timestamp
- VWAP arma las bandas de sesión y ancladas con sumas acumuladas. Antes bloqueaba 2 s en 15m y 23 s en 5m al activarse. La ventana móvil se suma directo: es corta, y en un tramo tranquilo las sumas de todo el historial no alcanzan a medir su variación
- La ventana de las bandas de sesión empieza en la primera vela de la sesión (`session_start`), igual que `backend/vwap_calculator.py`, también en la vela en formación. Las sumas se reinician en cada sesión, centradas en su primer precio. Antes empezaba el día anterior y la banda salía de 2.5 a 3.7 veces más ancha
- `volatilityDefaults()` da por marco los umbrales de BandWidth, el Keltner del TTM y `minSessionCandles`. Se calibraron con BTC para que cada estado salga tan seguido como con la ventana vieja y el TTM tanto como el clásico. Antes de `minSessionCandles` las tres lecturas quedan en gris. Aun así marcan más squeeze al inicio de la sesión que al final
- `Swing._checkVWAPFilter` lee `upper_N` y `lower_N` de las bandas elegidas. El margen es la parte de la distancia de la banda al VWAP que el precio puede quedar por dentro, como en los backends de Swing
- El filtro actúa dentro de los rectángulos del gráfico (`_rectangleZones()`, con el `DrawingToolManager` que entrega `IndicatorManager.getDrawingManager`) y solo con el indicador VWAP activo. No son lista blanca: afuera las señales no cambian. No cuentan los rectángulos que definen un VP Fixed (`getProfileRectIds`). Entre bandas la señal se descarta
- El caché del Swing se rehace con la geometría de los rectángulos y con `VWAPIndicator.calculations`, que sube con cada cálculo del VWAP. Mientras un rectángulo se arrastra o cambia de tamaño siguen los de antes: se recalcula una vez al soltarlo. Un cálculo sin señales también queda guardado
- Una vela que es swing alto y bajo a la vez (barre los dos lados) queda como swing alto, con su máximo como precio: el de su flecha (12/11). Antes tomaba el mínimo, y las zonas y el filtro VWAP revisaban ese swing alto con el precio de abajo. En velas de prueba de 1m con `swingBars` 2 pasaba en 10 de 226 señales
- La misma regla corre en el servidor de la suite (`12.AltagraciaTradingSuite/server/swing_rules.py`), que detecta el Swing en vivo. Un cambio de `detectSwings()` se hace en los dos archivos y se corre `12.AltagraciaTradingSuite/server/tests/swing_checks.py`, que ejecuta este indicador en node y compara los dos
- `setExternalSignals(lista)` hace que el indicador dibuje señales calculadas afuera en lugar de las suyas (13/11): la suite le pasa las de su servidor, solo con velas cerradas. `null` vuelve al cálculo propio. En reproducción App 1 no lo usa y el indicador calcula como siempre; si se usara, las de afuera también esperan su confirmación (`_filterByPlaybackTime`)
- Un preset de VWAP guarda su marco. Cargado en otro marco, sin marco o anterior a esta ronda, conserva los umbrales, el Keltner y `minSessionCandles` del marco actual (`withTimeframeValues`)
- Un indicador apagado cuesta 0.03 ms por tick en total. Quitar indicadores no acelera nada
- En vivo, el VWAP repide cada 30 s (`startAutoRefresh`). `IndicatorManager.destroy()` llama `dispose()` de cada indicador que lo tiene (13/11): el VWAP detiene la repetición, y un pedido que llega después no la vuelve a arrancar. Antes, al cambiar de moneda en la suite, la moneda anterior seguía pidiendo en los cinco marcos hasta cerrar la página. En reproducción no hay repetición. Prueba en `leaks.test.mjs`
- `Double Top/Bottom` costaba 69 a 280 ms por dibujo; S&R v2 con filtro, 233 a 938 ms por tick

### Backend

- `subdivisions` ya no viaja: era copia exacta de `main` en los 5 marcos. `drop_duplicate_subdivisions()` la quita al cargar el caché solo si es idéntica, y el frontend la descarta con `withoutSubdivisions()` al recibir datos y al leer o guardar IndexedDB. La respuesta de BTCUSDT bajó de 422 a 238 MB. Lo más lento que queda es `jsonable_encoder`, unos 26 s
- La expansión hacia atrás sigue con la actualización de velas nuevas y guarda una sola vez. `fetch_historical_candles_backwards` devuelve si Bybit ya no tiene velas más viejas, y el marco guarda `first_available_ts` para no repetirla. El OI nuevo se suma por hora al guardado en vez de reemplazarlo
- La tabla de medidas sigue escribiendo la columna `session` sin usarla, para que el código anterior con `VERSION` 1 la lea
- Footprints, perfil real y OI van en un hilo. Los footprints también se serializan ahí: `jsonable_encoder` corre en el loop

### Pruebas

`node tests/clock.test.mjs`, `node tests/light.test.mjs` y `node tests/swinglevels.test.mjs`. Cada atajo se compara contra el cálculo largo que reemplaza.

---

## JOURNAL DE TRADES (Noviembre 2026)

Cada trade guarda una imagen del gráfico al abrir y otra varias velas después de cerrar, y queda completo en la sesión. Una orden limit o stop guarda además lo que se veía al dejarla en espera.

### Flujo

```
Orden limit o stop nueva → captureDecision()                   order.decisionScreenshotPath

OrderManager: tradeOpened (mercado al crearla, limit y stop al ejecutarse)
        │  CaptureHold: reloj detenido y 150 ms después (ENTRY_CAPTURE_DELAY_MS)
        ▼
MiniChart.captureScreenshot() → POST /api/screenshots/session/{sesión}
        ▼
backend/screenshots/sessions/{sesión}/order_{hora}.png        order.screenshotPath
        ▼
saveTradeSession() → SessionManager.mergeSession() → IndexedDB

OrderManager: tradeClosed → order.exitCaptureAt = salida + 10 velas del marco activo
        │  BacktestingApp revisa exitCapturesDue() cada vez que avanza la hora simulada
        ▼
MiniChart.captureScreenshot(..., { showFrom: entrada })       order.exitScreenshotPath
        ▼
saveTradeSession()

TradeHistory: 📸 abre ScreenshotModal, con Decisión, Apertura y Cierre. La fila y 📍 llevan la vista a la entrada, sin mover la hora simulada
Observador: TradeImages muestra las miniaturas y abre ScreenshotModal con las medidas al lado
```

### Reglas

- La espera deja que la vela y la caja TP/SL se dibujen. `CaptureHold` detiene el reloj en ese momento, porque a 10000x 150 ms son 25 minutos simulados. Lo suelta al copiar el gráfico, sin esperar la subida ni el guardado, y con varias imágenes espera a la última. El marco se elige al tomar la imagen, no antes. La imagen de apertura es el gráfico activo tal como se ve, sin la cruceta, y vuelve a la última vela solo si quien opera se había alejado (`keepInView`)
- La de decisión y la de apertura muestran unas 5 veces las velas a la vista (`context: true`, `contextBarWidth()`), con la vela de la derecha en su lugar y el precio ajustado solo. Nunca bajan de 3 px por vela ni acercan la vista. La vista de quien opera vuelve igual al copiar la imagen. La de cierre sigue encuadrando el trade completo (`showFrom`)
- Cada imagen va al registro con un evento `image`: ruta, hora simulada, marco y `markers`. Las órdenes anteriores la toman de su sesión la primera vez que se abre el Observador (`withSessionImages`)
- Cada imagen dibuja los niveles y marcas de su orden, no la lista del panel: `captureScreenshot` recibe `items` y los dibuja por `captureItemsRef` solo en ese cuadro. La imagen de una limit que se llena después no muestra lo elegido para el trade siguiente. Una orden de una sesión vieja, sin `analysisItems`, sale sin ninguno
- Cada imagen muestra todo lo elegido para su orden. El precio abarca cada nivel, con 12 px de aire para su etiqueta (`priceRangeWith`). La vista se aleja hasta la vela de cada marca y alcanza el inicio de cada nivel, sin perder lo que mostraba y con 16 px de aire junto a la marca (`framedTimes`, `viewIncluding`, `frameItems`). Crece hasta 3 veces sus velas (`ITEM_FRAME_MAX_GROWTH`): más lejos, la de cierre dejaría el trade en un rincón. Un nivel que nace antes no la aleja, porque su línea se ve desde el borde izquierdo. Antes un objetivo fuera del precio de la imagen no se dibujaba, y un nivel nacido antes de su primera vela o una marca fuera de la vista quedaban sin número
- `markers` dice dónde quedó en esa imagen cada nivel o marca de la orden (`order.analysisItems`), como fracción del ancho y del alto. Sale de `itemPositions(..., { edges: true })`: en la marca que el indicador dibujó, o en su vela y precio, o junto al borde derecho para un nivel sin vela. Lo que nace antes o después de la vista queda junto al borde de ese lado, a su precio: un nivel se ve desde ahí, y el número de una marca que la imagen no alcanza dice que está más allá. En el gráfico, sin `edges`, una marca fuera de la vista no lleva aro
- En el Observador, `ScreenshotModal` pone cada marca numerada sobre la imagen. El número es su lugar en la lista de la orden y coincide con "Marcas y notas" de la lectura. Al pasar el mouse muestra papel y nota; con un clic aparece "Ir al gráfico". Los círculos y los números de la lectura son azul claro, para no confundirse con los aros morados que el gráfico dibuja en lo elegido y que salen en la imagen
- "Ir al gráfico" (`goToItem`) cambia al marco donde se eligió y llama `MiniChart.focusOn()`: mueve la vista, nunca la hora simulada, y marca la vela 15 s en azul claro. Un momento posterior a la hora simulada no se abre. Un nivel sin vela va a la hora en que se eligió
- El historial (fila, 📍 y flechas) también usa `focusOn()`, sin la marca: el trade ya tiene su línea. Las velas posteriores siguen a la vista y la hora simulada no cambia. Un trade posterior a la hora simulada, después de retroceder el reloj, no se abre
- `imageBlock()` no muestra una imagen que pase de lo que esta corrida ya vivió (`maxSimTimeRef`, no la hora actual: el reloj se puede retroceder) ni, con fecha oculta, una con fechas reales. "Ver igual" la muestra
- Si un trade entero cabe en un tick, la apertura sale después del cierre: el rótulo lo avisa
- Con el gráfico oculto no se toman imágenes: `toBlob` copiaría un momento anterior. La de cierre espera a que vuelva
- La imagen de cierre espera `EXIT_CAPTURE_CANDLES` (10) velas del marco activo al cerrar. La hora queda en `order.exitCaptureAt`, así sigue pendiente al cargar una sesión. Al tomarla pasa a `null` y no se repite
- `showFrom` muestra el trade completo: `frameChartFrom()` va a la vela más reciente y aleja si no caben las velas de `candlesToFrame()`. Después de `toBlob()`, que copia la imagen en ese momento, la vista vuelve antes de pintarse la pantalla
- Si la simulación no llega a esa hora, la imagen queda pendiente y el botón Cierre del visor sale desactivado. En el visor, ← → cambia de imagen y no mueve la simulación
- Todo dato de un trade va en la orden: `exportToJSON()` lo lleva a la sesión sin más código. `screenshotPath` guarda la imagen y `tpslBoxId` la caja
- Las líneas verticales no tienen estado propio: `tradeBoundaries()` las arma desde las órdenes en cada dibujo, con `executedAt`. MiniChart las recibe con `getTradeBoundaries`
- Un trade abierto justo al iniciar una vela cae a la derecha de la última: la línea se marca en el borde hasta que aparece esa vela
- `saveTradeSession()` corre al crear, ejecutar, cerrar y cancelar, en cola. La primera operación crea la sesión `session_{símbolo}_{hora}`. No corre con cada avance del tiempo: la hora simulada guardada es la del último evento
- `mergeSession()` conserva nombre, fecha de creación, etiquetas y notas, y actualiza trades y win rate. El auto-guardado también la usa
- `public_trade`, informe y CSV no usan la lectura ni las imágenes de una orden viva. Con fecha oculta el CSV deja vacías las fechas de esas órdenes y las pone al final (`hide_dates`), y el Excel las enmascara
- Controles del informe y reglas reciben `until`, la hora más lejana de la corrida: no usan velas que todavía no se vivieron. Por eso la tabla por año de una regla termina en el año simulado, y con fecha oculta no se muestra (`yearsToShow`)
- `orderAhead()` oculta el resultado de una orden que terminó después de lo vivido, para cuando se repiten fechas
- Al pedir una imagen, la extensión se separa antes de `sanitize_filename()`, que quita los puntos
- Borrar una sesión no borra sus imágenes. `DELETE /api/screenshots/session/{id}` existe, pero la app no lo llama
- Las sesiones viven en IndexedDB del navegador y las imágenes en disco
- Una imagen sale con el doble de píxeles que la pantalla, como mínimo (`CAPTURE_DENSITY`): el gráfico se redibuja a esa densidad solo para copiarla y vuelve antes de pintarse. Pesa unos 250 KB. `markers` se mide contra el tamaño CSS del lienzo (`drawnSizeRef`), no contra sus píxeles, y `screenshotMetadata` guarda los píxeles de la imagen. En el visor, "Ver a tamaño real" la muestra al doble del gráfico

---

## DASHBOARD DE TRADING, COMPARTIDO CON LA SUITE (13/11/2026)

Los widgets de `components/backtesting/dashboard/` también los usa el journal de la suite (`12.AltagraciaTradingSuite/web/src/JournalDashboard.jsx`), con trades reales. Para eso tienen opciones nuevas; App 1 no las pasa y se ve como siempre:

- `themed` (curva, P&L por trade y los dos medidores): colores y letra del estilo elegido, de `dashboardPalette.js`. Sin `themed`, o con el Clásico, `CLASSIC_PALETTE`: los colores escritos a mano hasta el 13/11. Cada widget llama `useUiTheme()` y se vuelve a pintar al cambiar el estilo
- `modes` (curva y P&L por trade): los botones de modo. El modo `r` usa el R de cada trade (`trade.r`): la curva lo acumula
- `summary` (curva): el pie en lugar de saldo inicial y final, que la suite no tiene (es dinero real)
- `formatPrice` y `tooltipExtra` (P&L por trade), `formatPrice`, `formatQuantity`, `extraColumns` e `idSortKey` (tabla), y `mainText` y `subText` (tarjetas de riesgo y recompensa)
- `uiTheme.js` suma `readableOn(color, fondo, ratio)`: un color legible como texto sobre un fondo, en cualquier estilo
- Las tarjetas, textos y tablas siguen con las variables `--dash-*` de `dashboard_styles.css`: la suite las cambia en su contenedor
- **"Exportar a Excel"** (`ExportExcelButton`, 13/11): la suite lo usa en su dashboard con tres opciones que App 1 no pasa:
  - `addSheets(workbook)` pone sus hojas de datos en lugar de "Trades" y "Métricas", que salen del OrderManager (ahora en `addBacktestSheets`);
  - `fileName`;
  - `imageBackground`, el fondo de las imágenes (`#FFFFFF` si no se pasa).

  Las imágenes de los gráficos siguen saliendo con los mismos `id`.
- **Imágenes del Excel con los gráficos terminados** (13/11, también en App 1): antes de copiar cada elemento, el botón termina sus gráficos de Chart.js (`chart.stop()` y `update('none')`). Chart.js anima al abrirse y con cada cambio de datos o de modo, y el lienzo tiene el último cuadro dibujado. Exportando en ese momento, la imagen salía en blanco o con la curva anterior: en la prueba de la suite, con la curva recién pasada a R, salió la de dólares. Ahora sale el estado final, sin cambio a la vista en la página. Los medidores (SVG) no se tocan

## NITIDEZ DEL GRÁFICO (Noviembre 2026)

Pedido del usuario el 8/11: el gráfico se veía borroso y en monitores más grandes no mejoraba. Su portátil es de 15.3" a 1366x768 y escala 100%. Colores, letras y disposición no cambian.

### Causas

- El lienzo tenía tantos píxeles como píxeles CSS. Con escala de Windows (125% o 150%, comunes en monitores 1440p y 4K) o zoom del navegador distinto de 100%, el navegador lo estiraba
- Velas, mechas de 1 px, líneas y celdas caían entre dos píxeles y se pintaban a medio tono en los dos. Pasaba también a 100%
- El texto del lienzo usaba suavizado gris; el HTML usa ClearType

### Cómo funciona

- `drawChart` da al lienzo los píxeles reales que ocupa en pantalla (`devicePixelContentBoxSize` del `ResizeObserver`, o el tamaño CSS por la densidad) y dibuja en píxeles CSS con `setTransform`. Mouse, márgenes, tolerancias de clic, `priceContext` y `selectableLevels()` siguen en píxeles CSS
- El `ResizeObserver` mira `device-pixel-content-box`: también avisa si cambia la densidad, al cambiar el zoom del navegador o pasar la ventana a otro monitor
- Lienzo opaco (`getContext('2d', { alpha: false })`): el texto sale con ClearType. El fondo blanco se pinta entero en cada cuadro
- `components/chartPixels.js`:
  - `installCrispRects(ctx)`: `fillRect` y `strokeRect` de ese lienzo llevan sus bordes a píxeles enteros. Un lado de menos de un píxel real queda como estaba, para que miles de velas angostas no se vean más densas. `strokeRect` centra el borde en la orilla: dos zonas que comparten orilla (TP y SL de una caja) pintan en el mismo lugar. Un borde más fino que un píxel real se dibuja de un píxel con la misma tinta
  - `alignY(y, grosor)` y `alignX(x, grosor)`: centro de una línea horizontal o vertical para que su grosor caiga entero. Van con `crispWidth(grosor, eje)`, que redondea el grosor a píxeles reales
  - `candleColumns()` y `snapSpanY()`: mecha y cuerpo de una vela con la mecha centrada. Con velas de menos de un píxel real `drawChart` las dibuja como antes
  - `rectEdge()`: dónde pinta `strokeRect` una orilla, para trazar otra línea encima (la punteada del rectángulo)
  - `pixelRatio()`: para `shadowBlur` y `shadowOffset`, que no siguen la escala del lienzo
- Footprint (`levelRow()` en `OrderFlowIndicator.js`): cada celda y cada barra del perfil de la vela van del borde de su nivel al del siguiente, con un hueco parejo de 1 px
- Una línea fina semitransparente (VAL del perfil dinámico, separadores) antes repartía su tinta en dos filas; ahora cae en una y se ve más definida

### Interruptor

- `localStorage.chart_pixel_ratio = "off"` y recargar: dibujo anterior, lienzo transparente y sin alinear. `removeItem` lo deshace
- Un número de 0.5 a 4 fija la densidad sin recargar: muestra en este equipo lo que se ve en un monitor con escala, a costa de que la pantalla lo reduzca

### Para indicadores nuevos

- `fillRect` y `strokeRect` no necesitan nada
- Línea horizontal: `ctx.lineWidth = crispWidth(w)` y `moveTo(x1, alignY(y, w))`, `lineTo(x2, alignY(y, w))`. Vertical: `crispWidth(w, 'x')` y `alignX(x, w)`
- Curvas y diagonales (VWAP, tendencia, flujo de OI) se dejan como están
- No usar `canvas.width` como tamaño del gráfico: son píxeles reales. En CSS es `canvas.clientWidth` o `getBoundingClientRect()`

### Medido

Vista 1366x700 (lienzo 1164x658), BTCUSDT 15m con Volume Delta, VP, OI, OI-Volume Confluence, Order Flow, FVG, VP Periodic, Volumen de Respuesta, Liquidaciones y S&R v2:

| | Antes | Ahora |
|---|---|---|
| Redibujo al mover el mouse, mediana | 3.9 ms | 3.8 ms a 1x, 3.9 a 1.5x, 3.5 a 2.25x, 3.9 a 3x |
| Reproducción 10000x | 60 fps, sin tareas largas | igual a 1x, 1.5x, 2.25x y 3x (lienzo de 6.9 Mpx) |
| Imagen de trade | unos 110 KB, al tamaño de la pantalla | unos 250 KB, al doble |
| Memoria del lienzo | 3 MB | 3 MB a 100%; unos 10 MB en 1440p a 125% y 22 MB en 4K a 150% |

- Con miles de velas a la vista (10,890 en 15m) el redibujo tarda de 140 a 230 ms con o sin esta mejora: ya era así
- La tarjeta gráfica del portátil (Radeon integrada) no frenó en ninguna prueba

### Pruebas

`node tests/pixels.test.mjs` (11): alineación de líneas a 7 densidades, mecha centrada, rectángulos vecinos, bordes compartidos, bordes finos, traslado y giro, y el interruptor apagado. Detecta una mecha sin centrar, un borde impar sin medio píxel y un relleno angosto alineado.

---

## ESTILO NÍTIDO (Noviembre 2026)

Pedido el 8/11. El usuario comparó App 1 con ATAS abierto en su PC y la encontró menos profesional. La causa no era el modo claro: App 1 no tenía un tema central. Cada parte traía sus propios colores y letras: 115 colores en el CSS y 124 en el código, de estilos iPhone, Material, TradingView y un degradado de plantillas. Además usaba tres letras y 69 emojis como íconos. Probó cinco paletas en una copia, eligió "Nítido" y pidió poder cambiar cada color. Autorizó cambiar estilos para esto.

### Qué hace

- **Cinco estilos** (desde el 9/11; ver "Oscuro, Personalizado y Muhammad"):
  - Nítido es el que abre por defecto, con colores fijos.
  - Oscuro, Personalizado y Muhammad usan el mismo dibujo con otros colores, y el usuario los puede cambiar: cada uno guarda lo suyo.
  - Clásico es el aspecto anterior: idéntico, 0 píxeles distintos en el gráfico y en el footprint, comparado con el código anterior en la misma vista.
- **Letra:** Segoe UI en la interfaz y el lienzo. El texto de los indicadores escrito en "Inter" sube a 11 y 12 px. Las cifras que se ajustan a una celda no cambian de tamaño.
- **Ejes:** precios redondos (pasos de 1, 2, 2.5 o 5) cada ~56 px, con los decimales de la moneda. Horas redondas en hora de Colombia, al menos cada 90 px, con el día en negrita al cambiar.
- **Leyenda:** O, H, L, C, cambio y volumen de la vela bajo la cruz, o de la última.
- **Último precio:** etiqueta en el eje del color de la vela, con una línea punteada.
- **Cruz:** de 1 px, con etiquetas en la misma letra.
- **Volumen:** barras planas, más tinta con más volumen, sin brillo.
- **Footprint** (`renderFootprintGraded`):
  - el color de cada celda crece con su volumen;
  - cifras sin contorno, grises si son chicas;
  - desequilibrios en negrita oscura;
  - stacked como barra de 2 px en el lado que empuja;
  - un marco fino por footprint;
  - el POC del perfil en el color de acento.
- **Perfil de volumen:** área de valor y resto en sus colores, POC en línea fina y etiquetas "Perfil dinámico / POC / VAH / VAL".
- **Interfaz:** íconos SVG de línea (`components/uiIcons.jsx`) en lugar de emojis. Barra de dibujo con íconos y nombres, que se contrae a solo íconos. Botones neutros sobre el gráfico (el botón VP ya no queda encima de los otros). Pestaña angosta para el panel lateral y paneles con títulos en español.

### Archivos

- `components/uiTheme.js`:
  - el estado (`isNewTheme()`, `setTheme`, `setThemeColors`, `resetThemeColors`) y los colores por defecto (`DEFAULT_COLORS`, `COLOR_GROUPS`);
  - `THEME`, que son los colores activos con los derivados: texto legible, tintes y variables CSS;
  - la letra del lienzo (`installThemeFonts`) y las ayudas de ejes (`niceStep`, `niceTimeStep`, `timeTick`, `crossTime`, `priceDecimals`).
  - No usa React, así que las pruebas de Node lo importan sin problema: sin navegador dibuja en clásico.
- `components/useUiTheme.js`: gancho que vuelve a pintar al cambiar estilo o color.
- `components/ThemeSettings.jsx` y `.css`: el modal.
- `src/theme_nitido.css`: reglas bajo `body.theme-nitido`, con colores de las variables `--t-*` que pone `uiTheme.js`.
- Ramas `isNewTheme()` en:
  - `MiniChart.jsx`: ejes, leyenda, último precio, cruz, volumen y fondo;
  - `OrderFlowIndicator.js`, `VolumeProfileIndicator.js`, `VolumeIndicator.js`, `OpenInterestIndicator.js` y `OIVolumeConfluenceIndicator.js`;
  - `DrawingSidebar.jsx` y el encabezado de `BacktestingApp.jsx`.

### Modal "Estilo y colores"

- **Dónde:** botón "Estilo" en el encabezado (🎨 en clásico).
- **Qué cambia:** elige uno de los cinco estilos y muestra sus 21 colores en seis grupos: velas y volumen, footprint (compra, venta, POC y perfil), perfil de volumen (área de valor, fuera del área, POC y clusters), gráfico (fondo, rejilla, cruz y etiquetas), interfaz (barras, acento y textos) y paneles. Se pueden cambiar con Oscuro, Personalizado y Muhammad; con Nítido quedan grises y una nota dice cómo cambiarlos.
- **Cómo se aplica:**
  - el cambio se ve al instante y se guarda por estilo, solo con lo distinto a su paleta: `ui_theme_colors` (Personalizado), `ui_theme_colors_oscuro` y `ui_theme_colors_muhammad`;
  - cada color cambiado tiene su botón para volver al de su estilo (Personalizado vuelve al de Nítido), y además está "Volver a los colores de …".
- **Contraste:** avisa si un color de datos casi no se ve sobre el fondo. Los textos derivados (`upText`, `downText`, desequilibrios) se oscurecen solos hasta 4.5:1 o 7:1 de contraste.

### Oscuro, Personalizado y Muhammad (9/11)

Pedido del usuario el 9/11: un modo oscuro; un Personalizado basado en Nítido, que guarde los colores cambiados sin tocar el Nítido original; y Muhammad, basado en Nítido con una paleta del arte islámico investigada a fondo.

- **Paletas** en `uiTheme.js`:
  - `DEFAULT_COLORS` es Nítido;
  - `DARK_COLORS` es Oscuro;
  - `MUHAMMAD_COLORS` es Muhammad;
  - Personalizado parte de Nítido (`PALETTES`).
  - Oscuro, Personalizado y Muhammad suman lo que el usuario cambió, cada uno en su clave (`EDITABLE_KEYS`): el 9/11 el usuario pidió que todos se puedan cambiar menos Nítido.
  - `themeEditable()` es verdadero con esos tres y `themeBaseColors()` da la paleta a la que vuelve un color. `STYLES` da el orden y los textos del modal.
  - `THEME.dark` sale del fondo: si en Oscuro se aclara el fondo deja de ser oscuro, y un estilo claro con fondo oscuro pasa a serlo.
- **Lo cambiado antes del 9/11** en el modal se guardaba como cambios de Nítido en `ui_theme_colors`. Ahora esos mismos cambios son los de Personalizado, y Nítido muestra siempre sus colores de fábrica.
- **Oscuro:**
  - fondo `#131722`, barras `#1E222D`, texto `#D1D4DC` (12:1 sobre el fondo) y secundario `#8B93A5` (5.8:1);
  - velas como Nítido (5:1 y 4.6:1 sobre el fondo) y acento `#5B8CFF`.
  - `THEME.dark` sale del fondo. Con él, lo que se deriva para leerse se aclara en vez de oscurecerse (`readable()` va hacia el blanco), las celdas vacías del footprint son claras sobre oscuro y `THEME.labelBg` toma el fondo del gráfico.
- **Oscuro fuera del lienzo:** `body.theme-dark`, con `color-scheme: dark` para barras de desplazamiento y controles del sistema.
  - Lo que ya usa las variables (encabezado, pestañas, barra de dibujo, botones del gráfico, el modal de estilo) toma los colores del estilo.
  - El panel de trading, la lista de indicadores, el menú ☰, el menú de niveles, la pantalla de inicio y los modales tienen colores escritos a mano. Se oscurecen con `filter: invert(1) hue-rotate(180deg) contrast(0.8)`, que invierte la luz y devuelve el tono: un botón verde sigue verde.
  - Fotos, videos y selectores de color llevan el filtro contrario (`contrast(1.25) hue-rotate(180deg) invert(1)`) y se ven como son. La sombra de lo filtrado se quita: invertida sería un halo claro.
  - Un elemento con posición fija dentro de algo filtrado queda encerrado en su caja. Por eso la confirmación de orden (`OrderConfirmationModal`) y el modal "Nuevo VP Fixed Range" van al body con `createPortal`, como ya iban las imágenes del historial y el informe del Observador.
  - La lista de indicadores lleva la clase `indicator-list-panel` y los botones ▲▼ de los paneles `panel-move-btn`.
- **Oscuro en el lienzo:** CVD, Volumen de Respuesta, Interés abierto (modos acumulado y flujo y el aviso sin datos), Liquidaciones, S&R, S&R v2 y los bordes del rango del perfil tomaban blanco, negro o grises fijos. Ahora, con Oscuro, usan los del estilo. Con los estilos claros y el clásico quedan iguales: `THEME.labelBg` es el mismo blanco y `chartInk()` solo cambia algo con fondo oscuro.
- **Comprobado** contra el código de antes, en Edge sin ventana, con ocho indicadores (CVD, FVG, VWAP, Liquidaciones, Volumen de Respuesta, S&R, S&R v2 y Order Flow):
  - Nítido y Clásico, 0 píxeles distintos en la vista general y en el footprint;
  - Personalizado guarda el color cambiado (`{"up":"#2563EB"}`), el gráfico lo usa, y al pasar a Nítido vuelven sus colores de fábrica sin poder cambiarlos.
- **Muhammad:** ver "Paleta Muhammad".

### Paleta Muhammad

Investigada el 9/11 en museos y textos académicos. Por cómo se obtuvo cada color:
- **Medidos:** los de la Alhambra y un santuario safávida, que son piezas desgastadas y se ven más apagadas que el original.
- **De fotos:** los de Iznik salen del color dominante que publica el Art Institute of Chicago (AIC).
- **Aproximados:** los demás, desde descripciones del V&A, la colección Khalili y el Ashmolean.

| Color | Hex | Origen |
|---|---|---|
| Sube y compra | `#0E8794` | Turquesa de cobre (iljaní, Iznik). Más azul que en Nítido: con daltonismo rojo-verde se separa mejor del rojo |
| Baja y venta | `#B8352B` | Rojo bol "tomate" de Iznik, desde 1557 |
| POC del footprint e interés abierto sube | `#1251CE` | Cobalto de Iznik (AIC 6762) |
| Perfil de la vela | `#B6CFE7` | Azul nazarí medido en la Alhambra, aclarado |
| Área de valor | `#C4A23B` | Oro de iluminación (shamsa iraní, AIC 187831) |
| Fuera del área | `#859EB4` | Azul nazarí medido |
| Línea del POC | `#475D53` | Verde nazarí medido |
| Clusters | `#6F4A7E` | Morado de manganeso de Iznik |
| Fondo y barras | `#FBF9F4` | Papel marfil bruñido de los manuscritos persas |
| Rejilla y cruz | `#E6E1D6`, `#8A847A` | Tinta diluida |
| Etiquetas de la cruz | `#2C2925` | Negro de tinta; el texto blanco encima da 14.5:1 |
| Acento | `#1D6B4C` | Verde esmeralda de Iznik, el verde del Paraíso en el Corán (18:31, 76:21) |
| Texto y secundario | `#1F1C18`, `#5E574E` | Negro de tinta (16:1) y tinta sepia (6.8:1) |
| Interés abierto baja | `#B85A1C` | Minio de la pintura persa |
| Divergencia | `#A6850C` | Oro u ocre timúrida (3.3:1, el más justo) |

- **Contraste** sobre el fondo: texto 16:1, secundario 6.8:1 y colores de datos 3.3:1 o más. `theme.test.mjs` lo exige.
- **Daltonismo:** sube y baja se distinguen mejor que en Nítido con protanopía y deuteranopía (ΔE2000 de 32.7 y 37.5, contra 17.3 y 22.8). El par más débil es baja contra divergencia con deuteranopía.
- **Alternativa no aplicada:** si no se quiere verde en los botones, el acento puede ser lapislázuli `#2B4C9B`.
- **Fuentes:**
  - Martínez-Domingo et al., Sensors 24:3872 (2024), zócalo nazarí medido;
  - Fahim, Ghasemi y Hosseini Zori, Adv. Ceram. Prog. 8(1) (2022), azulejo safávida;
  - API del Art Institute of Chicago (campo `color`);
  - V&A 242-1876, 725-1893 y 139-1891; Khalili POT 1290; Ashmolean (Iznik y el tratado de Abu'l-Qasim);
  - Purinton y Watters, JAIC 30(2) (1991), pigmentos de la pintura persa;
  - Cardell et al., Bol. Soc. Esp. Cerám. Vidr. (2026), esmaltes nazaríes.

### Ajustes propios en el modal de cada indicador (9/11)

Pedido el 8/11: con Nítido, un color cambiado en el modal del perfil de volumen no se veía, y desde "Estilo" sí. El usuario quiere que el estilo ponga los colores de todo, pero que lo cambiado en el modal de cada indicador se respete, también el degradado y las intensidades de los perfiles.

- **Regla:** cada indicador guarda en su configuración `customVisual`, la lista de ajustes visuales que el usuario cambió en su modal.
  - Con Nítido, lo que está en la lista se dibuja como el usuario lo dejó y el resto toma el color del estilo.
  - Con Clásico se dibuja con lo del modal, como siempre.
  - Una configuración guardada antes de la lista cuenta como propia si difiere del valor de fábrica del indicador. Desde que existe la lista, manda la lista (`isCustom()`, `markCustom()` y `customList()` en `uiTheme.js`).
- **Qué cubre:**
  - Perfil de volumen y VP de rango fijo: colores de base, área de valor, POC, VAH/VAL y clusters, y el degradado.
  - Order Flow: color del stacked de compra y de venta, y tamaño de las cifras.
  - Confluencia OI y volumen: colores alcista y bajista. Su configuración sigue sin guardarse al recargar, como antes.
  - Volumen: cambiar intensidad, opacidad, degradado o brillo vuelve al dibujo con degradado. Los colores de cluster elegidos se respetan.
- **El modal muestra lo que se dibuja:** con Nítido, el color del estilo mientras el usuario no elija otro.
- **Volver al estilo:**
  - "Usar los del estilo" en el perfil de volumen y en la confluencia, con cuántos ajustes son propios;
  - "Restaurar Defecto" en el VP fijo, "Restablecer" en Order Flow y "Restaurar Valores por Defecto" en el volumen.
- **Perfil de volumen por marco:** el modal editaba un estado que los gráficos no leían, y por eso nada cambiaba. Ahora cambia el marco activo, y los ajustes visuales pasan a todos los marcos (`handleVpConfigChange` en `BacktestingApp.jsx`).

**Fallos anteriores corregidos en la misma ronda:**
- **Área de valor del perfil dinámico:** App 1 le pasaba 70 donde el indicador esperaba 0.70. El área de valor abarcaba todo el perfil, con VAH y VAL en sus extremos.
  - Ahora acepta las dos formas. En BTC 15m al 25/10: antes VAH 81472.96 y VAL 79186.95, ahora 81057.32 y 79925.86.
  - También cambia el Clásico, y es su único cambio.
  - Un VAH o VAL del perfil dinámico elegido para un trade anterior quedó en el extremo del perfil. La validación de Rejection con el contexto "VP Dinámico" usaba esos mismos VAH y VAL.
- **VP de rango fijo:** el modal mandaba el ancho y el área de valor como fracción, y el perfil los espera como porcentaje.
  - "Restaurar Defecto" dejaba el ancho en 0.25% y las barras no se veían.
  - Ahora el modal manda porcentajes y el perfil acepta las dos formas.
- **Volumen:**
  - "Restaurar Valores por Defecto" borraba los colores de cluster, y una vela en cluster rompía el dibujo del gráfico hasta recargar. Ahora usa `VOLUME_VISUAL_DEFAULTS`.
  - Cada cambio del modal se dibujaba con el valor anterior. Ahora el gráfico se redibuja al cambiar `volumeVisualParams`.

**Comprobado en Edge sin ventana, con el gráfico visible:**
- Con Nítido:
  - el color propio del área de valor del VP fijo pasó de 19 a 1567 píxeles verdes;
  - el alcista propio de la confluencia, de 3 a 139 magenta;
  - el stacked de compra propio, de 162 a 1636 amarillos;
  - con intensidad propia, el volumen pasó de 2 a 30 colores, por el degradado.
- Cada uno volvió al estilo con su botón.
- Clásico contra el código anterior: 0 píxeles distintos sin el perfil de volumen, en la vista general y en el footprint. Con el perfil activo cambia solo el área de valor.
- Hay un MiniChart por marco montado en la página: una prueba debe buscar los botones entre los elementos visibles.

### Para indicadores nuevos

- Al dibujar, preguntar `isNewTheme()` y tomar los colores de `THEME` (`THEME.up`, `THEME.upRgb`, `THEME.textMuted`, `THEME.grid`, etc.). Con el clásico, dibujar como siempre.
- Escribir el texto con la familia "Inter" o con `THEME.font`. Con Nítido, el lienzo cambia la familia a Segoe UI y "bold" a 600.
- Para un color nuevo configurable: agregarlo a `DEFAULT_COLORS` y a `COLOR_GROUPS`. La prueba exige que estén los mismos en los dos.
- Un botón o panel HTML nuevo usa las variables `--t-*` bajo `body.theme-nitido`.
- Para que se vea bien con Oscuro:
  - el fondo de un panel propio es `isNewTheme() ? THEME.chartBg : <su color>`;
  - el fondo de una etiqueta sobre el gráfico es `THEME.labelBg`, que con los estilos claros es el mismo blanco;
  - un texto o una línea de color fijo pasa por `chartInk(color)`, que solo lo aclara con fondo oscuro;
  - un gris fijo usa `THEME.dark ? THEME.textMuted : <su gris>`;
  - un modal con posición fija que se abre dentro del panel de trading o de otro modal va al body con `createPortal`; si no, el filtro de Oscuro lo encierra en su caja.
- Si su modal tiene colores o ajustes visuales:
  - exportar sus valores de fábrica, como `VP_FACTORY`, `VP_FIXED_FACTORY`, `OF_FACTORY` u `OIVOL_FACTORY`;
  - en el modal, agregar a `customVisual` con `markCustom()` lo que el usuario cambia, y ofrecer cómo volver al estilo;
  - al dibujar con Nítido, `isCustom(config, clave, fábrica)` decide entre lo del modal y `THEME`.

### Pruebas

`node tests/theme.test.mjs` (20) cubre:
- colores de Personalizado cambiados, inválidos y restablecidos, sin tocar Nítido;
- Oscuro y Muhammad editables, cada uno con lo suyo y de vuelta a su paleta, y Nítido sin aceptar cambios;
- que un fondo aclarado u oscurecido cambie `THEME.dark`;
- que cada estilo traiga los 21 colores válidos y que uno desconocido vuelva a Nítido;
- contraste de Oscuro y Muhammad (texto, secundario, datos y etiquetas de la cruz) y que con Oscuro lo derivado se aclare;
- contraste del texto derivado;
- pasos redondos, horas de Colombia y decimales;
- que el modal ofrezca cada color una vez;
- ajustes propios: manda la lista, las configuraciones anteriores cuentan si difieren de fábrica (también claves anidadas, mayúsculas y espacios) y un ajuste nuevo se suma sin perder los anteriores.

`node tests/levels.test.mjs` comprueba que los perfiles acepten el área de valor y el ancho como porcentaje o como fracción.

Detecta una hora de Colombia corrida, un texto sin oscurecer y un color inválido aceptado. La igualdad del clásico se midió con capturas del lienzo en Edge sin ventana.

---

## LIQUIDACIONES (Noviembre 2026)

Precios donde se liquidó mucho dinero en los últimos días, cerca del precio actual. El usuario los usa como zonas de barrido violento para estar alerta, no como entrada ni como imán. Lo pidió el 7/11 como "una especie de heatmap" con pocos niveles que cambien al avanzar el precio.

### Flujo

```
MarginPad, Coinalyze, Binance Coin-M, Bitfinex
        │  backend/liq_update.py (se corre a mano)
        ▼
OrderFlowData/liquidations/{SYMBOL}_{fuente}.csv     Un archivo por fuente. raw/ guarda lo bajado
        │  backend/liq_store.py
        ▼
GET /api/liquidations/{symbol}?start_timestamp&end_timestamp&known_until
        │  celdas [known, start, end, low, high, long, short, fuente] y el tramo de cada fuente
        ▼
indicators/LiquidationsIndicator.js + liquidationZones.js
```

### Fuentes

| Fuente | Qué es | Se conoce | BTC |
|--------|--------|-----------|-----|
| MarginPad | Todo el mercado, por día y precio real | Al cerrar el día UTC | 08/10/2026 a 07/11/2026 |
| Coinalyze | Perpetuos de todos los exchanges, por intervalo, con precio estimado | Al cerrar el intervalo | 01/07/2021 a 07/11/2026 |
| Binance Coin-M | Un solo mercado (contratos inversos), eventos con hora | En su hora | 25/06/2023 a 14/10/2024 |
| Bitfinex | Un mercado pequeño, eventos con hora | En su hora | 01/08 a 04/09/2021, 01 a 20/06/2023 y 01/02 a 06/03/2024 |

- Otras monedas, al 07/11/2026 (Coinalyze empieza cuando hay velas de Bybit):

| Moneda | MarginPad | Coinalyze | Binance Coin-M | Bitfinex |
|--------|-----------|-----------|----------------|----------|
| ETH | desde 10/10/2026 | desde 01/07/2021 | 25/06/2023 a 14/10/2024 | 3 tramos |
| SOL | desde 10/10/2026 | desde 15/10/2021 | 25/06/2023 a 14/10/2024 | 3 tramos |
| SUI | desde 10/10/2026 | desde 03/05/2023 | 19/09 a 14/10/2024 | no |
| TRX | desde 10/10/2026 | desde 31/08/2021 | 6 tramos | 4 tramos |
| ARB | desde 10/10/2026 | desde 23/03/2023 | no | 2 tramos |
| GALA | desde 10/10/2026 | desde 03/02/2022 | no | 2 tramos |
- **Automática:** manda la primera de la lista que cubre la fecha. Nunca se mezclan dos fuentes, porque sus montos no se comparan. ⚙️ permite fijar una para comparar fuentes en la misma fecha
- **Tramos:** `ranges` corta la cobertura donde pasan más de 7 días sin datos (`GAP_DAYS`). Una fuente no cubre las fechas que le faltan a su descarga
- **Coinalyze:** guarda de 1,500 a 2,000 puntos intradía por mercado y todo el diario. La historia intradía vieja trae solo algunos mercados (en BTC, 2 de 10 en diciembre de 2023): `_complete_days()` usa un intervalo fino solo en los días en que su suma coincide con la diaria (10%). BTC: diario hasta 16/10/2024, 12 h hasta 28/02/2026, 4 h hasta 31/08/2026, 1 h hasta 17/10/2026 y 15 min después
- **Precio estimado** (`attribute()`): con velas de 5 minutos de Bybit dentro del intervalo. Los largos se reparten entre los mínimos nuevos, cada uno según lo que bajó y su volumen. Los cortos, entre los máximos nuevos. Sin mínimos nuevos, por la mecha y su volumen. Cada tramo se parte en pedazos de 0.05% del precio
- **Clave de Coinalyze:** la creó el usuario y está en `OrderFlowData/liquidations/coinalyze_key.txt`, fuera del repositorio. Va en la cabecera `api_key` y nunca se imprime

### Comparación de fuentes (BTC)

Zonas que vería el usuario (3 por lado, 6%, 30 días), cada 3 o 6 horas. Dos zonas coinciden si se tocan con 0.15% de margen. El azar mueve las zonas candidatas a otro lugar dentro de la misma distancia.

| Referencia | Candidata | Período | Coinciden | Azar | Mismo lado |
|------------|-----------|---------|-----------|------|------------|
| MarginPad | Coinalyze, como se arma | 15/10 a 07/11/2026 | 76% | 33% | 100% |
| MarginPad | Coinalyze, solo diario | igual | 86% | 37% | 97% |
| Binance Coin-M | Coinalyze | 25/07/2023 a 14/10/2024 | 56% | 37% | 64% |
| Binance Coin-M | Coinalyze | febrero 2024 | 52% | 30% | 67% |
| Binance Coin-M | Bitfinex | febrero 2024 | 50% | 30% | 48% |

- Coinalyze reproduce bien las zonas de todo el mercado con precio real: por eso va antes que Binance y Bitfinex. Con Coin-M coincide menos porque Coin-M es un solo mercado: Coinalyze suma 18 veces más dinero en ese tramo
- Bitfinex acierta el lado como el azar y casi nunca la zona mayor (7%, Coinalyze 35%). Su descarga quedó parcial: con más de unas 10 consultas seguidas Bitfinex bloquea la IP, y todo el historial tomaría horas
- La única referencia de todo el mercado es un mes de MarginPad. Es buena evidencia, no prueba

### Zonas (`liquidationZones.js`)

- Franjas de 0.1% del precio redondeado (`niceStep`), nunca más finas que la celda de la fuente (MarginPad BTC: 50 USD). El ancho se mantiene hasta que el precio se aleja 30%
- Histograma suavizado (¼, ½, ¼). Cada pico es una zona: su núcleo, con las vecinas que tienen al menos la mitad del pico (`maxHalfBins` 1, `halfFraction` 0.5). Mide hasta 3 franjas
- Una zona nace cuando junta la mitad de su dinero (`birth`)
- `pickZones()`: de la mayor a la menor, 3 por lado a menos de 6%, con al menos 5% de la mayor de la ventana y 0.25% de espacio libre con las ya elegidas. Las que tienen el precio adentro también entran. Sin el espacio, un barrido ancho (30/10/2026: 317M entre 76,300 y 77,900) llenaba el gráfico de zonas pegadas
- Intensidad: raíz de su parte de la mayor zona de la ventana, de cualquier precio
- Cruzada (`CrossTracker`): el precio salió de la zona con un cierre y después pasó su borde contrario. La misma subida que formó la zona no la cruza. Se dibuja con la mitad de opacidad, línea punteada y "cruzada". Solo revisa las velas nuevas; la vela en formación se mira sin guardarse

### Sin futuro

- El backend nunca entrega una celda con `known` posterior a `known_until`. MarginPad se conoce a las 00:00 UTC del día siguiente. Coinalyze, al cerrar el intervalo, y su precio sale de las velas de ese intervalo. Los eventos, en su hora
- `_sync()` pide primero (hora − ventana − 2 días, hora] y después solo lo nuevo, (cargado, hora], con 5 minutos simulados y 400 ms reales de distancia. Con fuentes por día pregunta al pasar la medianoche, y sin fuente que pueda tener datos no pregunta
- Al retroceder quita lo conocido después, descarta las respuestas pendientes (`generation`) y el cruce empieza de cero
- La prueba con datos reales recorre BTC en las cuatro fuentes por partes y con retrocesos (5,823 momentos): las zonas son siempre las de calcular todo de una vez con lo conocido

### Dibujo

- Franja desde que nace hasta el borde derecho: rosada si se liquidaron largos (el precio bajó hasta ahí), celeste si fueron cortos. Línea en la franja con más dinero
- Etiqueta `L 85.2M · 2d` donde nace. Si nace en el 40% derecho del gráfico va a la izquierda, para no tapar las últimas velas. El otro lado se agrega si pesa al menos un cuarto
- `▲ 2 zonas · 3.4%` arriba y `▼` abajo: zonas elegidas fuera de la vista y distancia a la más cercana
- Arriba a la izquierda: fuente, ventana y avisos (datos desde, datos hasta, intervalos de 15 min, sin datos en esta fecha y qué tramos hay)
- Fecha oculta: sin fuente, sin fechas y con la parte de la mayor zona en vez del monto, porque cada fuente cubre una época
- Es el primer indicador de la lista: sus franjas quedan debajo de los demás dibujos

### Velas fijadas

Pedido del usuario el 8/11: elegir una vela del gráfico y dejar en su máximo las liquidaciones que hubo ahí, aunque sea de hace meses, porque los niveles de liquidaciones muy grandes se vuelven soportes y resistencias.

- Con el indicador activo, un clic en el máximo o el mínimo de una vela cerrada abre el menú de niveles con "Fijar liq. del máximo" o "Fijar liq. del mínimo" (`_offerCandles()`, id con `candleItemId(..., interval)`). Solo con 4 px o más por vela, y nunca la vela en formación. `offerCandles` lo apaga
- Una vela fijada va a su propia lista (`liquidationPins.js`, en `liquidation_pins_{symbol}`), que comparten los marcos. No es lo elegido para un trade: `takeLevels()` no la toca y sigue después de cada orden, hasta que se suelta desmarcándola en el menú, con × en el modal ⚙️ o con "Soltar todas". Guarda id, lado (`edge`), precio, vela (`time`, `low`, `high`, `open`, `close`), marco y `selectedAt`. Al retroceder antes de fijarla no aparece
- El menú reconoce estos elegibles por `choice` (`chosen(time)` y `toggle(time, timeframe)`): marcan la lista propia, sin papel ni nota. MiniChart redibuja con `subscribePins()`, también cuando se suelta desde el modal
- La franja de una vela fijada se ofrece al Observador como "Liq. de vela fijada" (id `Liquidaciones|Liq. de vela fijada|<id de la vela>`, con su lugar en el dibujo). Marcada, entra a lo elegido para el trade con papel y nota y pasa a la orden como cualquier nivel. La vela sigue fijada
- **Rango de precios** (`pinRange()`, pedido del usuario el 9/11): la mecha del lado elegido, del cuerpo al extremo. El máximo cuenta su mecha de arriba y el mínimo la de abajo.
  - Por fuera suma 0.1% del precio por redondeo (`PIN_PAD_PCT`).
  - Hacia adentro llega al menos a ese 0.1%: una vela que cerró en su extremo cuenta lo que pasó junto a él.
  - Y a lo sumo a `pinWickMaxPct`: "Alto máximo de la mecha (% del precio)" en el modal ⚙️, 0.5% por defecto, de 0.1 a 5.
  - Una vela fijada antes del 9/11 no guardó su cuerpo: cuenta la mitad de la vela, como antes, también con el tope.
  - Hasta el 9/11 se contaba siempre la mitad de la vela y la franja medía 0.2%.
- `_drawPins()` dibuja la franja en ese rango, desde la vela hasta el borde derecho, en `pinColor` (ámbar), con una línea en el precio. Una mecha de menos de 0.1% deja la franja de 0.2% de antes. Si el precio la cruza queda tenue y punteada
- La etiqueta dice lo contado hacia adentro: `Vela 1h · Coinalyze: C 4.0M + L 1.1M · rango 0.24%`, con `(tope)` si la mecha era más larga que el alto máximo
- `pinSummary()`: cuenta lo liquidado en ese rango, en celdas que se cruzan con la vela en el tiempo y tienen su precio medio en el rango, como las zonas. Una celda más larga que la vela (un día de MarginPad o un intervalo de Coinalyze) entra completa y la etiqueta dice `dato de 1 día`
- La fuente es la que cubre la fecha de la vela, no la de hoy: una vela de 2024 puede salir de Coinalyze o Binance Coin-M aunque hoy mande MarginPad
- Sin futuro: cada vela fijada pide aparte su ventana, `(vela − 1, cierre del día UTC en que termina la vela]`, cortada en la hora simulada. Mientras ese día no cierra, la etiqueta dice `parcial` y se vuelve a pedir cada 5 minutos simulados. Al retroceder se quita lo conocido después
- Fecha oculta: sin fuente y con la parte de cada lado en vez del monto. La lista del modal no muestra la fecha de la vela

### Observador

`selectableLevels()` ofrece cada zona dibujada con `left`, `right`, `top` y `bottom`, `price` en su pico, `low`, `high` y `time` en su nacimiento. Id `Liquidaciones|<tipo>|<pico>`. También ofrece el máximo y el mínimo de cada vela para fijarlos y la franja de cada vela fijada (ver "Velas fijadas").

### Parámetros

⚙️ junto al indicador (`LiquidationsSettings.jsx`, modal claro). Se guardan por símbolo en `liquidations_settings_{symbol}` y valen para todos los marcos. Solo se guarda lo que el modal muestra (`USER_KEYS`). `cleanLiquidationsSettings()` acota los números y vuelve a automática una fuente que no existe. Las velas fijadas no son parámetros: su lista va aparte y "Restablecer" no la toca.

### Velocidad

En la app de prueba, 15m a 10000x con Binance Coin-M: 60 cuadros por segundo y ninguna tarea larga, igual que con el indicador apagado. Una ventana de 5,000 celdas se calcula en 0.5 ms y solo cuando cambian las celdas de la ventana. Un cuadro cuesta 0.04 ms. `_trim()` suelta cada semana simulada lo que salió de la ventana, así una reproducción de meses no llena la memoria.

### Mantener los datos

MarginPad alcanza 30 días hacia atrás y Coinalyze unos 20 días en intervalos de 15 minutos: lo que no se baja a tiempo se pierde. Por eso hay una tarea programada de Windows, creada el 7/11/2026 a pedido del usuario:

- **"App1 Liquidaciones":** todos los días a las 7:30, con `backend\.venv\Scripts\pythonw.exe -B liq_auto.py` (sin ventana). Si el equipo estaba apagado corre apenas se encienda, solo con red y hasta 3 horas. Corre con la sesión del usuario abierta
- `liq_auto.py`: Coinalyze en cada corrida y MarginPad cuando el día más nuevo guardado tiene 5 días o más, para las 7 monedas de App 1. Bitfinex no. Un candado (`actualizacion.lock`) evita dos corridas a la vez. La corrida de prueba del 7/11 duró 22 minutos, casi todo esperando el límite de Coinalyze, y terminó sin errores
- Registro en `OrderFlowData\liquidations\actualizacion.log`. `python -B liq_auto.py --revisar` dice qué haría sin bajar nada
- Quitarla: `Unregister-ScheduledTask -TaskName "App1 Liquidaciones"` en PowerShell, o desde el Programador de tareas

A mano:

```bash
cd backend
python -B liq_update.py marginpad BTCUSDT ETHUSDT SOLUSDT SUIUSDT TRXUSDT ARBUSDT GALAUSDT
python -B liq_update.py coinalyze BTCUSDT ETHUSDT SOLUSDT SUIUSDT TRXUSDT ARBUSDT GALAUSDT
python -B liq_update.py bitfinex --tramo 2021-08-01 2023-06-01 BTCUSDT                       # reanuda Bitfinex
```

- Solo agrega: nunca borra ni cambia lo guardado. Coinalyze baja unos 15 minutos de velas por moneda la primera vez
- `coinalyze-armar` vuelve a estimar los precios con lo ya bajado

### Pruebas

`node tests/liquidations.test.mjs` (39) y `pytest tests/test_liq_store.py` (10).

---

## 🆕 NUEVO: ORDER FLOW INDICATOR (Octubre 2026) ✅ COMPLETADO

Sistema de visualización de Order Flow basado en footprints del OrderFlowDesktop (App 9), integrado en el Backtester.

### Estado: ✅ 100% FUNCIONAL

**Características implementadas:**
- ✅ Backend endpoint carga footprints desde archivo local
- ✅ Agregación de footprints 1min → 5min funcionando
- ✅ Visualización de imbalances históricos (desde sept 20)
- ✅ Imbalances se dibujan dinámicamente durante el playback
- ✅ Sistema de coincidencia por timestamps (no por índices)
- ✅ Optimización de performance (solo procesa footprints visibles)
- ✅ Soporte para 60 días de histórico en backtesting

### Arquitectura Implementada

```
┌─────────────────────────────────────────────────────────────────┐
│                     ORDER FLOW SYSTEM                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BACKEND (main.py)                                              │
│  ├─ GET /api/orderflow/historical/{symbol}                      │
│  │   ├─ Lee footprints desde archivo local                     │
│  │   │   5.Order_flow/backend/footprint_cache/{symbol}_{int}.json
│  │   ├─ Filtra por días solicitados                            │
│  │   └─ Retorna: {success, footprints[], count, step_size}     │
│  │                                                              │
│  FRONTEND                                                        │
│  ├─ OrderFlowIndicator.js (Overlay Indicator)                  │
│  │   ├─ fetchData(): Carga footprints del backend              │
│  │   ├─ getVisibleFootprints(): Anti-sesgo (solo hasta playback)
│  │   └─ renderOverlay(): 3 capas de visualización              │
│  │       ├─ Capa 1: Imbalance Coloring (bordes de velas)       │
│  │       ├─ Capa 2: POC Markers (puntos de control)            │
│  │       └─ Capa 3: Stacked Imbalances (grupos)                │
│  │                                                              │
│  ├─ FootprintCard.jsx (Componente de tarjeta)                  │
│  │   └─ Renderiza: Vela + Footprint + Volume Profile           │
│  │                                                              │
│  ├─ FootprintSidebar.jsx (Panel lateral)                       │
│  │   ├─ Muestra hasta 10 footprints pinneados                  │
│  │   └─ Click en tarjeta → navega al timestamp                 │
│  │                                                              │
│  └─ BacktestingApp.jsx (Integración)                           │
│      ├─ handlePinFootprint(candle)                             │
│      └─ handleNavigateToFootprint(timestamp)                   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Archivos Creados/Modificados

| Archivo | Tipo | Descripción |
|---------|------|-------------|
| `backend/main.py` | Modificado | Endpoint `/api/orderflow/historical/{symbol}` (líneas 4470-4550) |
| `frontend/src/components/indicators/OrderFlowIndicator.js` | Creado | Indicador overlay con 3 capas de visualización (~450 líneas) |
| `frontend/src/components/backtesting/FootprintCard.jsx` | Creado | Componente de tarjeta individual (~200 líneas) |
| `frontend/src/components/backtesting/FootprintSidebar.jsx` | Creado | Sidebar para footprints pinneados (~180 líneas) |
| `frontend/src/components/backtesting/FootprintSidebar.css` | Creado | Estilos del sidebar (~170 líneas) |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Modificado | Integración de callbacks y estado (líneas 2150-2200) |
| `frontend/src/components/indicators/IndicatorManager.js` | Modificado | Registro del indicador + getter (líneas 77, 92, ~1260) |

### Problemas Resueltos Durante la Implementación

#### 1. Error de Scope Variables (ReferenceError)

**Problema:** `allCandlesForCalculation is not defined` - 96 errores repetidos al mover el mouse.

**Causa:** Variables definidas dentro de un bloque `if (indicatorManagerRef.current)` que terminaba antes del loop de velas, se intentaban usar después del loop.

**Solución:** Reorganizar el código para que el renderizado de overlays tenga su propio bloque con todas las variables definidas:

```javascript
// DESPUÉS del loop de velas:
if (indicatorManagerRef.current) {
  const overlayBounds = { x: marginLeft, y: marginTop, width: chartWidth, height: priceChartHeight };
  const priceToY = (price) => marginTop + priceChartHeight - (price - minPrice) * yScale + verticalOffset;
  const timeToX = (timestamp) => { /* ... */ };
  const priceContext = { minPrice, maxPrice, priceRange, verticalZoom, verticalOffset, yScale, priceToY, timeToX };
  const allCandlesForCalculation = backtestingMode && allCandlesRef.current?.length > 0 ? allCandlesRef.current : displayCandles;

  indicatorManagerRef.current.renderOverlays(ctx, overlayBounds, visibleCandles, allCandlesForCalculation, priceContext);
}
```

**Archivo:** `MiniChart.jsx` (líneas 1037-1080)

#### 2. Lag Extremo por Procesamiento Excesivo

**Problema:** App extremadamente lenta al mover el mouse, procesando 7147 footprints en cada mousemove de 29,168 totales cuando solo había 225 velas visibles.

**Causa:**
1. Miles de `console.log()` por segundo
2. Filtrado ineficiente - solo filtraba por anti-sesgo, no por rango visible

**Solución:**

**A) Eliminar logs en hot path:**
```javascript
// ANTES: 4-5 logs por renderOverlay
console.log(`[${symbol}] 🎨 OrderFlow.renderOverlay called`);
console.log(`[${symbol}] 🎨 Renderizando ${visibleFootprints.length} footprints`);
console.log(`[${symbol}] 🟢 Capa 1: ${count} velas con imbalance`);
// ...

// DESPUÉS: Solo 1 log al inicio (con flag _renderLogged)
if (!this._renderLogged) {
  console.log(`[${symbol}] 🎨 OrderFlow renderOverlay:`, { ... });
  this._renderLogged = true;
}
```

**B) Filtrado optimizado por rango temporal:**
```javascript
// ANTES: Filtra TODOS los footprints hasta currentTime (7147)
const visibleFootprints = this.getVisibleFootprints(currentTime);

// DESPUÉS: Filtra solo footprints del rango visible (~225)
const firstVisibleTs = visibleCandles[0].timestamp;
const lastVisibleTs = visibleCandles[visibleCandles.length - 1].timestamp;

const visibleFootprints = this.footprints.filter(fp => {
  const fpTime = fp.candle_timestamp || fp.timestamp;
  return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs && fpTime <= currentTime;
});
```

**Resultado:** ~97% menos procesamiento (de 7147 a ~225 footprints por frame)

**Archivo:** `OrderFlowIndicator.js` (líneas 271-325)

#### 3. Overlays No Visibles (candleWidth undefined)

**Problema:** Los overlays se renderizaban pero no eran visibles en el gráfico.

**Causa:** El parámetro `candleWidth` se extraía de `bounds` con destructuring:
```javascript
const { candleWidth } = bounds;
```

Pero `bounds` solo tiene `{x, y, width, height}`, no `candleWidth`.

**Solución:** Calcular `candleWidth` a partir de bounds.width:
```javascript
const candleWidth = bounds.width / visibleCandles.length;
```

**Archivo:** `OrderFlowIndicator.js` (línea 285)

### Configuración del Indicador

```javascript
config = {
  showImbalanceColoring: true,      // Capa 1: Bordes de velas
  showPOCMarkers: true,              // Capa 2: Marcadores POC
  showStackedImbalances: true,       // Capa 3: Grupos de imbalances
  imbalanceThreshold: 1.5,           // Ratio mínimo bid/ask para considerar imbalance
  stackedImbalanceMinCount: 3,       // Mínimo de niveles consecutivos
  stackedImbalanceMinRatio: 2.0      // Ratio mínimo para grupo
}
```

### Estado Final (Octubre 21, 2026) - ✅ COMPLETADO

✅ **100% Funcional:**
- Backend endpoint carga footprints desde archivo local (orderflow_archive/BTCUSDT_1.json)
- Soporte para 60 días de histórico en backtesting mode
- OrderFlowIndicator muestra footprints históricos correctamente (desde sept 20)
- Imbalances se dibujan dinámicamente durante el playback
- Sistema de coincidencia por timestamps (Map-based, no índices)
- Renderizado optimizado (solo footprints visibles en pantalla)
- Agregación 1min → 5min funcionando

⏳ **Pendiente (futuras mejoras):**
- Testing de capas POC y Stacked Imbalances
- Testing del sidebar con footprints pinneados
- Ajuste fino de umbrales de detección

#### 5. Problema: Simulación Se Detiene y Resetea (Octubre 21)

**Síntomas:**
- La simulación avanza hasta octubre 5 y luego se resetea automáticamente a octubre 1
- No permite simular hasta la fecha actual (octubre 21)
- Mensaje en consola: "Estamos al final, reseteando al inicio de la simulación..."

**Investigación:**
1. TimeController resetea cuando `currentTime >= endTime` (línea 156)
2. `endTime` se establece con `lastCandle.timestamp` del caché
3. Caché de IndexedDB tenía velas hasta octubre 5 (desactualizado)
4. Archivo del servidor (`BTCUSDT_backtesting_data.json.gz`) SÍ tenía velas hasta octubre 21
5. Sistema tenía mecanismo `checkForUpdates()` pero se ejecutaba en segundo plano DESPUÉS de cargar el caché

**Causa Raíz:**
El sistema cargaba datos del caché de IndexedDB inmediatamente y verificaba actualizaciones en segundo plano. Esto causaba que:
- El TimeController se inicializara con `endTime` basado en velas antiguas (octubre 5)
- Las actualizaciones llegaban tarde, cuando el playback ya estaba en marcha
- El usuario no veía las velas nuevas hasta recargar completamente

**Solución Aplicada:**

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` (líneas 810-845)

Modificado el flujo para verificar actualizaciones ANTES de usar el caché:

```javascript
// ANTES: Usar caché inmediatamente, actualizar en segundo plano
shouldUseCachedData = true;
data = cachedResult.data;
setMarketData(data);
checkForUpdates(symbol).then(...); // Segundo plano

// DESPUÉS: Verificar actualizaciones PRIMERO
const updateResult = await checkForUpdates(symbol);

if (updateResult.new_candles_added > 0) {
  console.log(`🔄 ${updateResult.new_candles_added} velas nuevas agregadas`);
  data = await loadBacktestingData(symbol); // Recargar datos actualizados
} else {
  console.log('✅ Caché está actualizado');
  data = cachedResult.data; // Usar caché
}
```

**Resultado:**
✅ **PROBLEMA RESUELTO**
- El sistema ahora verifica actualizaciones ANTES de iniciar el backtesting
- Si hay velas nuevas, las descarga y actualiza el caché
- `lastCandle.timestamp` refleja la vela más reciente (octubre 21)
- La simulación puede avanzar hasta la fecha actual sin resetear prematuramente
- El caché se mantiene sincronizado automáticamente

**Lección Aprendida:**
- Las actualizaciones de caché deben ser síncronas (await) antes de usar los datos
- No ejecutar actualizaciones en segundo plano si afectan el estado inicial de la aplicación
- El `endTime` del TimeController es crítico - debe basarse en datos actualizados

#### 4. Problema: Solo Últimas 8 Horas de Footprints (Octubre 21)

**Síntomas:**
- Solo se mostraban footprints desde sept 30 (8 horas antes de oct 1)
- No se mostraban footprints más antiguos disponibles en el archivo (desde sept 20)
- Durante playback, no se dibujaban imbalances nuevos

**Investigación:**
1. Archivo local tenía solo 7 footprints (casi vacío)
2. Archivo correcto en App 5 tenía 43,169 footprints (sept 20 - oct 20)
3. Backend limitaba a "últimos 21 días desde HOY" en lugar de "desde simulationStartTime"
4. Frontend pedía solo 7-21 días de datos

**Solución aplicada:**

**A) Copiar archivo completo:**
```bash
copy "5.Order_flow\backend\orderflow_archive\BTCUSDT_1.json" "1.Altagracia_Crypto_Backtester\Backtester\backend\orderflow_archive\BTCUSDT_1.json"
```

**B) Backend - Priorizar end_timestamp sobre días desde HOY:**
```python
# Si se especificó end_timestamp, usarlo como referencia
if end_timestamp:
    footprints_1min = [fp for fp in footprints_1min if fp['candle_timestamp'] <= end_timestamp]

    if days > 0:
        cutoff_timestamp = end_timestamp - (days * 24 * 60 * 60 * 1000)
        footprints_1min = [fp for fp in footprints_1min if fp['candle_timestamp'] >= cutoff_timestamp]

# Si NO se especificó end_timestamp pero sí days, usar HOY
elif days > 0:
    now = int(time.time() * 1000)
    cutoff_timestamp = now - (days * 24 * 60 * 60 * 1000)
```

**C) Frontend - Pedir 60 días en backtesting mode:**
```javascript
// En backtesting, pedir 60 días (2 meses) para tener todo el histórico
const daysToRequest = this.backtestingMode ? 60 : this.days;

// NO enviar end_timestamp - queremos todos los footprints disponibles
if (!this.backtestingMode && endTimestamp) {
    params.append('end_timestamp', endTimestamp.toString());
}
```

**D) Frontend - Eliminar filtro temporal en renderizado:**
```javascript
// ANTES: Filtraba por currentTime (solo mostraba hasta donde había llegado el playback)
const visibleFootprints = this.footprints.filter(fp => {
  const fpTime = fp.candle_timestamp || fp.timestamp;
  return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs && fpTime <= currentTime;
});

// DESPUÉS: Solo filtra por velas visibles en pantalla
const visibleFootprints = this.footprints.filter(fp => {
  const fpTime = fp.candle_timestamp || fp.timestamp;
  return fpTime >= firstVisibleTs && fpTime <= lastVisibleTs;
});
```

**Resultado:**
- ✅ Footprints históricos desde sept 20 hasta oct 20 (60 días)
- ✅ Imbalances se dibujan dinámicamente durante el playback
- ✅ Performance óptima (solo procesa footprints visibles)

### Lecciones Aprendidas

1. **Scope de variables en canvas rendering:** Las variables deben estar en scope cuando se usan - no intentar "guardarlas" entre bloques
2. **Performance en hot paths:** Eliminar TODOS los logs de funciones que se ejecutan en mousemove
3. **Filtrado eficiente:** Filtrar por rango temporal visible, no por todo el dataset
4. **Calcular dimensiones:** Los overlays deben calcular sus propias dimensiones (candleWidth) a partir de bounds
5. **Sistema de coincidencia:** Usar Map con timestamps como keys, NO índices de array
6. **Verificar archivos fuente:** Si los datos parecen limitados, verificar el archivo fuente (puede estar vacío o desactualizado)
7. **Estructura de archivos JSON:** Los archivos de App 9 usan formato `{footprints: [...]}`, no array directo
8. **Backend vs Frontend filtering:** El filtrado temporal debe hacerse en el backend (límite de días), el frontend solo filtra por rango visible
9. **Backtesting mode:** Pedir MÁS datos en backtesting (60 días) que en producción (7-21 días) para tener histórico completo

## Development Commands

### Backend (FastAPI)

Start the backend server:
```bash
cd backend
start_backend.bat  # Windows - handles venv creation, dependency installation, and server startup
```

Or manually:
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 9000
```

Backend runs on `http://localhost:9000`

Dependencies:
- fastapi==0.115.0
- uvicorn[standard]==0.32.0
- httpx==0.27.2
- slowapi==0.1.9 (Rate Limiting)
- pytest==8.3.4 (Testing)
- pytest-asyncio==0.24.0 (Async Testing)

### Frontend (React + Vite)

Development server:
```bash
cd frontend
npm install
npm run dev
```

Build for production:
```bash
cd frontend
npm run build
```

Preview production build:
```bash
cd frontend
npm run preview
```

Frontend dev server runs on `http://localhost:9001` (default Vite port)

### Running Tests

```bash
cd backend
.\.venv\Scripts\Activate.ps1
python -m pytest -v
```

Tests include:
- `test_sanitize_filename.py` - Path Traversal prevention
- `test_lru_cache.py` - LRU Cache functionality
- `test_endpoints.py` - API endpoint tests

## Architecture

### Backend Architecture (backend/main.py)

**Core Responsibilities:**
1. **Historical Data Fetcher**: Fetches OHLCV candles from Bybit API with timeframe-specific limits
2. **Volume Delta Calculator**: Computes Volume Delta and CVD from candle data
3. **Caching Layer**: 30-minute file-based cache + LRU memory cache with limits
4. **Rate Limiting**: slowapi-based request limiting per IP
5. **Security**: Path Traversal prevention, CORS restrictions

**Key Endpoints:**
- `GET /api/status` - Server status and cache info
- `GET /api/historical/{symbol}?interval={interval}&days={days}` - Fetch OHLCV candles
- `GET /api/volume-delta/{symbol}?interval={interval}&days={days}` - Volume Delta + CVD data
- `POST /api/clear-cache` - Clear all cached data
- `POST /api/upload-cache/{symbol}` - Manually upload cache data
- `POST /api/rejection-patterns/detect` - Detect rejection patterns with context validation
- `GET /api/rejection-patterns/available-contexts/{symbol}` - Get available reference contexts

**Timeframe Limits (MAX_DAYS_BY_INTERVAL):**
- 1m, 3m, 5m: 5-10 days max
- 15m: 15 days max
- 30m: 30 days max
- 60m (1h): 120 days max
- 240m (4h): 300 days max
- D (daily): 730 days max
- W (weekly): 730 days max

**Critical Implementation Details:**
- All timestamps use Colombia timezone (UTC-5)
- Maximum 1000 candles per Bybit API request (pagination required for larger datasets)
- Cache stored in `backend/cache/` directory with format `{symbol}_{interval}_{indicator}.json`
- Volume Delta calculation: positive if close >= open, negative otherwise
- **LRU Memory Cache**: DTB_CANDLES (150MB max), DTB_PATTERNS (50MB max)
- **Rate Limits**: `/api/status` 100/min, `/api/historical` 60/min, `/api/double-topbottom/detect` 30/min
- **CORS**: Restricted to localhost:9001 only

### Frontend Architecture

**Component Hierarchy:**
```
main.jsx
└── Watchlist.jsx (root component)
    ├── VolumeProfileSettings.jsx (settings modal)
    ├── FixedRangeProfilesManager.jsx (manage fixed ranges)
    └── MiniChart.jsx (chart for each symbol)
        └── Uses IndicatorManager
```

**Indicator System (src/components/indicators/):**

The indicator architecture uses a manager pattern with specialized indicator classes:

- **IndicatorManager.js** - Central coordinator that:
  - Manages all indicators for a symbol
  - Handles WebSocket data distribution
  - Coordinates fixed range Volume Profile instances
  - Synchronizes persistent fixed ranges from localStorage

- **IndicatorBase.js** - Abstract base class for all indicators

- **Web Workers (src/workers/):**
  - `VolumeProfileWorker.js` - Volume Profile calculations off main thread
  - `PatternDetectionWorker.js` - Pattern detection off main thread
  - `WorkerPool.js` - Promise-based worker management

- **Specialized Indicators:**
  - `VolumeProfileIndicator.js` - Dynamic Volume Profile (recalculated as new candles arrive)
  - `VolumeProfileFixedRangeIndicator.js` - Fixed range Volume Profile (static period analysis)
  - `VolumeIndicator.js` - Volume bars
  - `CVDIndicator.js` - Cumulative Volume Delta
  - `OIVolumeConfluenceIndicator.js` - 🎯 **OI-Volume Confluence** (combina OI y Volumen con normalización Z-Score)
  - `ATRBasedRangeDetector.js` - Automatic range detection using ATR
  - `RejectionPatternIndicator.js` - Candlestick pattern detection (Hammer, Shooting Star, Engulfing, Doji)
  - `LocalPatternDetector.js` - Local pattern detection without context validation

- **Default Enabled Indicators:**
  - ✅ Volume Delta (visualización de volumen con z-score y clusters)
  - ✅ Volume Profile (perfil de volumen dinámico)
  - ✅ Open Interest (interés abierto)
  - ✅ OI-Volume Confluence (🎯 **NUEVO** - confluencia visual OI + Volumen)
  - ❌ CVD (deshabilitado por defecto)
  - ❌ Range Detection (deshabilitado por defecto)
  - ❌ Support & Resistance (deshabilitado por defecto)
  - ❌ S&R v2 (deshabilitado por defecto)
  - ❌ VWAP (deshabilitado por defecto)
  - ❌ Rejection Patterns (deshabilitado por defecto)
  - ❌ Double Top/Bottom (deshabilitado por defecto)
  - ❌ Swing Detector (deshabilitado por defecto)

**Key Frontend Patterns:**

1. **WebSocket Management (WebSocketManager.js)**:
   - Singleton pattern managing real-time Bybit WebSocket connections
   - Automatically subscribes to all symbols on the watchlist
   - Distributes tick updates to all MiniChart instances
   - Handles reconnection logic

2. **Data Flow**:
   - Historical data: Backend API → IndicatorManager → Individual Indicators
   - Real-time updates: Bybit WebSocket → WebSocketManager → IndicatorManager → Indicators
   - Volume Delta/CVD: Calculated in-memory from candle data (no separate API fetch)

3. **Volume Profile Modes**:
   - **Dynamic**: Recalculates on every candle update, shows current market structure
   - **Fixed Range**: User-defined time ranges, persisted to localStorage per symbol
   - Setting `hideWhenFixedRanges=true` hides dynamic VP when fixed ranges are active

4. **State Management**:
   - Watchlist-level state: timeframe, days, indicator toggles, VP config
   - Fixed ranges stored in localStorage: `volumeprofile_fixed_ranges_v2`
   - VP settings applied globally or per-symbol based on `vpApplyToAll` flag

### Configuration

**API Configuration (frontend/src/config.js):**
```javascript
export const API_BASE_URL = "http://localhost:9000";
```

**Symbols Watchlist (frontend/src/components/Watchlist.jsx:7-14):**
Hardcoded array of 30 crypto symbols (BTCUSDT, ETHUSDT, etc.)

## Important Implementation Notes

### Timeframe Day Limits

The frontend and backend MUST stay synchronized on MAX_DAYS_BY_INTERVAL. When modifying limits:
1. Update `MAX_DAYS_BY_INTERVAL` in backend/main.py:33-44
2. Update `MAX_DAYS_BY_INTERVAL` in frontend/src/components/Watchlist.jsx:17-25
3. Update `DAYS_OPTIONS_BY_INTERVAL` in frontend/src/components/Watchlist.jsx:28-36

### Volume Profile Implementation

The Volume Profile implementation is based on TradingView Pine Script research (see `VolumeProfile_tradingview.txt` and `Investigación_VolumeProfile/` folder). Key algorithms:
- Price binning across specified row count (default 100-200 bins)
- Value Area calculation (70% of volume by default)
- POC (Point of Control) - price level with highest volume
- Cluster detection using threshold-based contiguous bin analysis

### Cache Behavior

- Cache TTL: 30 minutes (CACHE_MAX_AGE in backend/main.py:30)
- Cache files persist in `backend/cache/` and `frontend/cache/`
- Volume Delta cache includes full kline data with computed volumeDelta and cvd
- Always check cache age before using cached data

### Fixed Range Profiles

Fixed ranges are stored per-symbol in localStorage and synchronized across all MiniChart instances:
- Created via UI by selecting start/end timestamps
- Each range gets unique `rangeId`
- Managed by `FixedRangeProfilesManager.jsx`
- Indicator instances created in `IndicatorManager.syncFixedRangeIndicators()`

### Real-time Updates

WebSocket updates only modify the current (in-progress) candle. Historical candles remain immutable unless a full refresh is triggered. The `in_progress` flag marks candles still forming.

### Rejection Pattern Detection System

The rejection pattern detection system identifies candlestick reversal patterns and validates them against reference contexts (Volume Profiles and detected ranges).

**Supported Patterns:**
- **Hammer** (🔨): Bullish pin bar with long lower wick
- **Shooting Star** (⭐): Bearish pin bar with long upper wick
- **Engulfing** (📈/📉): Bullish or bearish engulfing patterns
- **Doji** (🐉/🪦): Dragonfly and Gravestone doji patterns

**Visualization Modes:**
- **Show All**: Displays all locally detected patterns in historical data
- **Validated Only**: Shows only patterns validated against selected reference contexts (POC/VAH/VAL levels)

**Reference Contexts:**
- **Volume Profile Fixed Ranges**: User-created or auto-detected ranges
- **Volume Profile Dynamic**: Real-time Volume Profile (auto-updates with new candles)
- **Range Detector**: ATR-based detected consolidation zones

**Configuration (per symbol):**
- Pattern-specific settings (min wick ratio, etc.)
- Confidence filters (0-100)
- Proximity tolerance to key levels
- Volume Z-Score filters
- Alert settings (sends to port 5000)

**IndicatorManager Methods:**
- `getRejectionPatternIndicator()` - Get the rejection pattern indicator instance
- `getVolumeProfileIndicator()` - Get the dynamic Volume Profile indicator
- `hasDynamicVolumeProfile()` - Check if dynamic VP is active with calculated data
- `getDynamicVolumeProfileData()` - Get POC/VAH/VAL from dynamic VP

**Backend Module (backend/rejection_detector.py):**
- Pattern detection algorithms
- Context-based validation
- Confidence scoring (pattern quality, proximity, volume, size)
- Reference level extraction from contexts

### Range Detection System (ATR-Based)

Automatically detects consolidation zones using the ATR (Average True Range) indicator.

**Key Features:**
- ATR-based range boundaries
- Configurable parameters (min length, ATR multiplier, lookback period)
- Automatic Volume Profile creation for detected ranges
- Optional trend profiles between ranges
- Multi-timeframe support
- Alphabetical labeling (A, B, C...)

**Configuration:**
- `minRangeLength`: Minimum consecutive candles in range (default: 20)
- `atrMultiplier`: ATR multiplier for range width (default: 1.0)
- `atrLength`: ATR calculation period (default: 200)
- `maxBreakoutCandles`: Candles outside range before finalization (default: 5)
- `createTrendProfiles`: Create VP between ranges (default: false)
- `showOtherTimeframes`: Show ranges from other timeframes (default: false)

## Troubleshooting

**Backend won't start:**
- Ensure Python 3.10+ is installed
- Check that port 9000 is not in use
- Verify backend/.venv exists or run start_backend.bat

**Frontend chart not loading:**
- Verify backend is running on port 9000
- Check browser console for CORS errors
- Ensure symbols in watchlist exist on Bybit

**Data too old or stale:**
- Use POST /api/clear-cache to force refresh
- Check CACHE_MAX_AGE setting (30 minutes default)

**Volume Profile not appearing:**
- Verify "Volume Profile" indicator is enabled
- Check that sufficient historical data exists
- If using fixed ranges, ensure ranges are valid timestamps

**Rejection patterns not showing:**
- Verify "Rejection Patterns" indicator is enabled in Watchlist
- Check visualization mode: "Show All" vs "Validated Only"
- In "Validated Only" mode, ensure reference contexts are configured
- Verify Volume Profile or Range Detector is active with calculated levels
- Check pattern confidence threshold settings

**Range Detector not working:**
- Verify Range Detection is enabled in the settings modal
- Check ATR parameters are appropriate for the timeframe
- Increase `atrMultiplier` to detect wider ranges
- Decrease `minRangeLength` to detect shorter consolidation periods
- Verify sufficient historical data is loaded

**Alert service warnings:**
- Alert service on port 5000 is optional
- Alerts will be logged locally if service is unavailable
- To enable external alerts, start `alert_listener.py` separately

**Rate limit errors (429 Too Many Requests):**
- Wait 1 minute before retrying
- Limits: status 100/min, historical 60/min, DTB detect 30/min, bulk-data 10/min

**Tests failing:**
- Ensure venv is activated: `.\.venv\Scripts\Activate.ps1`
- Run: `python -m pytest -v`
- Check pytest is installed: `pip install pytest pytest-asyncio`

## Security Features (v2.7.0+)

### Path Traversal Prevention
All cache file operations sanitize inputs via `sanitize_filename()`:
```python
# Removes: ../, ..\, /, \, <, >, |, :, *, ?
# Only allows: a-zA-Z0-9_-
sanitize_filename("../../../etc/passwd")  # Returns: "etcpasswd"
```

### Rate Limiting
Implemented via slowapi to prevent abuse:

| Endpoint | Limit |
|----------|-------|
| `/api/status` | 100/min |
| `/api/historical/{symbol}` | 60/min |
| `/api/volume-delta/{symbol}` | 60/min |
| `/api/double-topbottom/detect` | 30/min |
| `/api/double-topbottom/chunk` | 60/min |
| `/api/backtesting/bulk-data/{symbol}` | 10/min |

### CORS Restrictions
Only allows requests from:
- `http://localhost:9001`
- `http://127.0.0.1:9001`

### LRU Memory Cache
Prevents unbounded memory growth:
- `DTB_CANDLES_CACHE`: 150MB max (~13 symbols)
- `DTB_PATTERNS_CACHE`: 50MB max
- Auto-evicts oldest entries when limit reached

## Performance Optimizations (v2.6.0+)

### Canvas Throttle
MiniChart.jsx throttles rendering to ~30fps to reduce CPU usage.

### Lazy Loading Indicators
Indicators defer `fetchData()` until explicitly enabled.

### Web Workers
Heavy calculations can be offloaded to workers:
```javascript
import { workerPool } from './workers';

// Calculate Volume Profile in background
const profile = await workerPool.calculateVolumeProfile(candles, 100, 70);

// Detect patterns in background
const patterns = await workerPool.detectRejectionPatterns(candles, config);
```

---

## ZOOM SYSTEM (Octubre 2026)

Sistema de zoom horizontal que permite comprimir velas hasta mostrar ~14,000 velas en pantalla.

### Arquitectura

El zoom usa `viewStateRef.current.zoom` como multiplicador sobre un ancho base de 8px:

```javascript
// Formula central aplicada en 4 ubicaciones criticas
const effectiveBarWidth = Math.max(0.1, Math.min(MAX_BAR_WIDTH, 8 * zoom));
const candlesPerScreen = Math.floor(chartWidth / effectiveBarWidth);
```

### Limites

| Parametro | Valor | Descripcion |
|-----------|-------|-------------|
| Min zoom | `0.01` | Zoom out extremo |
| Max zoom | `50` | Zoom in extremo (`MAX_ZOOM`) |
| Min ancho vela | `0.1px` | Compresion maxima |
| Max ancho vela | `400px` | Expansion maxima (`MAX_BAR_WIDTH`), para leer footprints |

**Capacidad:** En pantalla de 15" (~1422px utiles): `1422 / 0.1 = ~14,220 velas` visibles.

### Ubicaciones Criticas (MiniChart.jsx)

La formula `effectiveBarWidth` debe ser consistente en estas 4 ubicaciones:

1. **drawChart** (~linea 651): Calculo principal de velas visibles
2. **Wheel handler** (~linea 1600): Ajuste de offset post-zoom
3. **Pan handler** (~linea 1357): Calculo de desplazamiento durante paneo
4. **Auto-offset** (~linea 1839): Calculo de margen derecho automatico

### Historial de Cambios

El sistema original usaba un zoom minimo dinamico que limitaba artificialmente el zoom out:

```javascript
// ANTES (limitaba a ~2800 velas):
const dynamicMinZoom = (chartWidth / (8 * totalCandles)) * 0.8;
const newZoom = Math.max(dynamicMinZoom, Math.min(5, oldZoom * zoomFactor));

// DESPUES (permite ~14,000 velas):
const newZoom = Math.max(0.01, Math.min(5, oldZoom * zoomFactor));
```

Se adopto el patron de App 8 (AnalizadorDesktop) que usa limites fijos en lugar de dinamicos.

### Troubleshooting Zoom

**Zoom out no llega al maximo:**
- Verificar que las 4 ubicaciones usan `Math.max(0.1, ...)` (no 0.2 ni 0.5)
- Verificar que el wheel handler usa `Math.max(0.01, ...)` como min zoom

**Velas invisibles en zoom extremo:**
- A 0.1px por vela el detalle individual no es visible, pero la forma general del precio si
- Esto es comportamiento esperado (similar a TradingView en zoom out extremo)

**Pan no funciona correctamente en zoom extremo:**
- Verificar que pan handler usa `effectiveBarWidth` y no `8 * zoom` directo

---

## SISTEMA DE VISUALIZACIÓN DE VOLUMEN MEJORADO (Febrero 2026)

Sistema avanzado de visualización de volumen con análisis estadístico basado en z-score, parámetros configurables y detección de clusters de volumen consecutivo.

### Características Principales

1. **Análisis Z-Score**: Cada barra de volumen es evaluada usando z-score estadístico para identificar volúmenes anormalmente altos
2. **Intensidad y Opacidad Adaptativas**: Las barras se colorean dinámicamente según su desviación del volumen promedio
3. **Gradientes Dinámicos**: Gradientes verticales que varían según el z-score de cada barra
4. **Glow Effect**: Resaltado especial para volúmenes excepcionales (z-score > umbral)
5. **Detección de Clusters**: Identifica grupos de velas consecutivas con volumen alto acumulado
6. **Configuración Personalizable**: Modal con controles para ajustar todos los parámetros visuales

### Parámetros Configurables

Los parámetros se guardan por símbolo en localStorage (`volumeVisualParams_{symbol}`):

```javascript
{
  // Intensidad de color
  intensityMin: 0.3,           // Intensidad mínima (0.1-0.5)
  intensityMax: 1.0,           // Intensidad máxima (0.6-1.0)
  intensityDivisor: 3,         // Divisor de sensibilidad (1-6)

  // Opacidad adaptativa
  opacityMin: 0.4,             // Opacidad mínima (0.2-0.6)
  opacityMax: 0.9,             // Opacidad máxima (0.7-1.0)
  opacityBase: 0.5,            // Opacidad base (0.3-0.7)
  opacityDivisor: 4,           // Divisor z-score (2-8)

  // Gradiente
  gradientBottomMultiplier: 0.3, // Contraste inferior (0.1-0.8)

  // Efecto Glow
  glowThreshold: 2.0,          // Umbral z-score para glow (1.0-4.0)
  glowBlur: 8,                 // Intensidad del blur (2-20)

  // Detección de Clusters
  clusterDetection: true,          // Activar/desactivar detección
  clusterMinBars: 3,               // Mínimo de velas consecutivas (2-10)
  clusterThreshold: 0.5,           // Umbral promedio z-score (0.0-2.0)
  clusterColorBullish: '#4CAF50',  // Color para clusters alcistas (verde)
  clusterColorBearish: '#F44336'   // Color para clusters bajistas (rojo)
}
```

### Sistema de Detección de Clusters

Los clusters identifican grupos de velas consecutivas donde el volumen acumulado es significativo, aunque individualmente las barras no tengan volumen extremo.

**Algoritmo:**

```javascript
// 1. Calcular z-score para cada vela
const volumeZScores = visibleCandles.map(d =>
  (d.volume - avgVolume) / stdDevVolume
);

// 2. Detectar secuencias consecutivas con z-score >= threshold
const clusters = [];
let currentCluster = null;

volumeZScores.forEach((zScore, i) => {
  if (zScore >= clusterThreshold) {
    if (!currentCluster) {
      // Iniciar nuevo cluster
      currentCluster = { start: i, end: i, avgZScore: zScore, count: 1 };
    } else {
      // Extender cluster existente
      currentCluster.end = i;
      currentCluster.avgZScore =
        (currentCluster.avgZScore * currentCluster.count + zScore) /
        (currentCluster.count + 1);
      currentCluster.count++;
    }
  } else {
    // Finalizar cluster si cumple mínimo de barras
    if (currentCluster && currentCluster.count >= clusterMinBars) {
      clusters.push(currentCluster);
    }
    currentCluster = null;
  }
});

// 3. Determinar dirección de cada cluster
// Compara precio de apertura del inicio con precio de cierre del final
clusters.forEach(cluster => {
  const firstCandle = visibleCandles[cluster.start];
  const lastCandle = visibleCandles[cluster.end];
  const direction = lastCandle.close >= firstCandle.open ? 'bullish' : 'bearish';

  for (let i = cluster.start; i <= cluster.end; i++) {
    clusterIndices.add(i);
    clusterDirections.set(i, direction); // Guardar dirección por índice
  }
});

// 4. Las barras en clusters se resaltan con color según dirección
// NO se dibuja fondo invasivo en el gráfico de precio
```

**Visualización:**
- Las barras que forman parte de un **cluster alcista** se pintan con `clusterColorBullish` (verde por defecto)
- Las barras que forman parte de un **cluster bajista** se pintan con `clusterColorBearish` (rojo por defecto)
- Las barras normales usan verde (alcista) o rojo (bajista) estándar
- El glow effect NO se aplica a barras de clusters para evitar redundancia
- La dirección del cluster se determina comparando el precio de apertura de la primera vela con el precio de cierre de la última vela

### Modal de Configuración

Accesible mediante el botón ⚙️ en el divisor naranja del panel de volumen.

**Secciones del modal:**

1. **Intensidad de Color** (3 controles)
   - Mínimo, Máximo, Divisor de sensibilidad

2. **Opacidad Adaptativa** (4 controles)
   - Mínimo, Máximo, Base, Divisor Z-Score

3. **Gradiente** (1 control)
   - Contraste Inferior

4. **Efecto Glow** (2 controles)
   - Umbral Z-Score, Intensidad del Blur

5. **Detección de Clusters** (5 controles)
   - Checkbox activar/desactivar
   - Mínimo de velas consecutivas
   - Umbral promedio Z-Score
   - Selector de color alcista (input type="color") - verde por defecto
   - Selector de color bajista (input type="color") - rojo por defecto

6. **Botón Reset**
   - Restaura todos los valores a defaults

### Integración con Estado

```javascript
// Estado se inicializa con merge de valores guardados + defaults
const [volumeVisualParams, setVolumeVisualParams] = useState(() => {
  const defaults = { /* valores por defecto */ };
  const saved = localStorage.getItem(`volumeVisualParams_${symbol}`);
  if (saved) {
    const parsed = JSON.parse(saved);
    return { ...defaults, ...parsed }; // Merge para compatibilidad
  }
  return defaults;
});

// Todos los sliders actualizan estado + localStorage + redibujan
onChange={(e) => {
  const newParams = { ...volumeVisualParams, param: newValue };
  setVolumeVisualParams(newParams);
  localStorage.setItem(`volumeVisualParams_${symbol}`, JSON.stringify(newParams));
  if (candlesRef.current?.length > 0) {
    drawChart(candlesRef.current, lastPriceRef.current, null, null);
  }
}}
```

### Fórmulas Clave

**Z-Score de Volumen:**
```javascript
const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;
const stdDevVolume = Math.sqrt(
  volumes.reduce((sum, v) => sum + Math.pow(v - avgVolume, 2), 0) / volumes.length
);
const zScore = (volume - avgVolume) / stdDevVolume;
```

**Intensidad Adaptativa:**
```javascript
const intensity = Math.max(
  intensityMin,
  Math.min(intensityMax, (zScore + 1) / intensityDivisor)
);
```

**Opacidad Adaptativa:**
```javascript
ctx.globalAlpha = Math.max(
  opacityMin,
  Math.min(opacityMax, opacityBase + (zScore / opacityDivisor))
);
```

**Color de Barras:**
```javascript
const isInCluster = clusterIndices.has(i);
const baseColor = isInCluster
  ? clusterColor                           // Color del cluster
  : (d.close >= d.open ? bullColor : bearColor);  // Verde/Rojo normal
```

### Divisor Redimensionable

El divisor naranja entre el gráfico de precio y el volumen permite ajustar la altura del panel de volumen:

```javascript
// Posición: 5px después del gráfico de precio (donde inicia el volumen)
top: `calc(${priceChartRatio * 100}% + 5px)`

// Características:
// - Cursor: ns-resize
// - Color: naranja (#FF9800)
// - Hover: se resalta para facilitar el drag
// - Botón ⚙️ integrado para abrir modal
```

### Troubleshooting

**Modal se crashea al abrir:**
- Verificar que todas las propiedades existen en volumeVisualParams
- El sistema hace merge con defaults para manejar configuraciones antiguas

**Clusters no se ven:**
- Verificar que `clusterDetection` está en `true`
- Ajustar `clusterThreshold` más bajo (ej: 0.3)
- Reducir `clusterMinBars` (ej: 2)

**Colores no se actualizan:**
- Verificar que `drawChart()` se llama después de cambiar parámetros
- Limpiar localStorage y recargar si hay configuraciones corruptas

**Divisor no se puede arrastrar:**
- Verificar que el handler `handleVolumeDividerMouseDown` está conectado
- Verificar `z-index: 1000` del divisor

---

## HISTORIAL DE PROBLEMAS Y SOLUCIONES (Febrero 2026)

### Intento Fallido: IndicatorPanel con Drag-and-Drop

**Problema:** Se implementó un sistema de paneles de indicadores separados con drag-and-drop para reordenar, redimensionar y gestionar indicadores de manera independiente. El sistema incluía:
- `IndicatorPanel.jsx` - Componente de panel individual con drag handles
- `IndicatorPanel.css` - Estilos profesionales con animaciones
- Integración en `MiniChart.jsx` con estado `indicatorLayout` y ref `indicatorBoundsRef`

**Síntomas del fallo:**
- Los indicadores dejaron de aparecer completamente en el gráfico
- El canvas no mostraba ningún indicador después de la integración
- La lógica condicional para renderizar en IndicatorPanel vs canvas directo causaba conflictos

**Causa raíz:**
- El IndicatorPanel intentaba renderizar indicadores usando refs a canvas individuales
- La lógica condicional en `MiniChart.jsx` impedía el renderizado normal de indicadores
- El sistema de bounds y layout para paneles separados no se sincronizaba correctamente con el renderizado del canvas principal

**Solución aplicada:**
Se revirtieron TODOS los cambios relacionados con IndicatorPanel:

1. **MiniChart.jsx** - Eliminado:
   - Import de IndicatorPanel (línea 14)
   - Estado `indicatorLayout`
   - Ref `indicatorBoundsRef`
   - Lógica condicional para renderizado en IndicatorPanel
   - Componente JSX `<IndicatorPanel />`

2. **Restaurado renderizado simple:**
```javascript
// REVERTIDO A:
if (indicatorManagerRef.current && indicatorsHeight > 0) {
  const indicatorsBounds = {
    x: marginLeft,
    y: marginTop + priceChartHeight + volumeHeight + timeAxisHeight,
    width: chartWidth,
    height: indicatorsHeight
  };
  indicatorManagerRef.current.renderIndicators(ctx, indicatorsBounds, visibleCandles);
}
```

**Resultado:** Los indicadores volvieron a aparecer correctamente en el gráfico.

**Lección aprendida:**
- El renderizado de indicadores en canvas es sensible a la sincronización de bounds y contexts
- Separar indicadores en paneles independientes requiere una arquitectura más compleja
- La lógica condicional para alternar entre diferentes modos de renderizado puede causar race conditions
- Es mejor mantener un sistema de renderizado simple y centralizado para indicadores en canvas

---

### Fix: Open Interest Data Loading

**Problema:** Después de revertir los cambios de IndicatorPanel, el indicador de Open Interest no cargaba datos. Síntomas:
- UI mostraba "no hay datos de open interest para btcusdt"
- Backend no mostraba logs de fetch a Bybit API
- El indicador estaba habilitado pero no disparaba `fetchData()`

**Causa raíz:**
En `IndicatorManager.js`, el método `updateIndicatorStates()` tenía validación de datos incompleta para Open Interest en el bloque `else if (shouldBeEnabled && wasEnabled)`:

```javascript
// INCORRECTO (línea 332):
if (!indicator.dataMap || indicator.data.length === 0) {
  // Error: dataMap es un Map, no se puede verificar .length
  // Solo verificaba indicator.data, no indicator.dataMap.size
}
```

**Solución aplicada:**
Corregir la validación para verificar correctamente tanto `dataMap.size` como `data.length`:

```javascript
// CORRECTO:
if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
  console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
  promises.push(indicator.fetchData());
}
```

**Logging de diagnóstico agregado:**
Se agregaron logs detallados para rastrear el estado de Open Interest:

```javascript
// Estado inicial:
console.log(`%c[${symbol}] 📊 OI State Check`, 'background: #FF9800; ...', {
  shouldBeEnabled,
  wasEnabled,
  hasDataMap: !!indicator.dataMap,
  dataMapSize: indicator.dataMap?.size || 0,
  dataLength: indicator.data?.length || 0,
  isBackendIndicator: backendIndicators.includes(indicator.name)
});

// Validación de datos:
console.log(`%c[${symbol}] 🔍 OI Data Validation`, 'background: #FF9800; ...', {
  hasDataMap: !!indicator.dataMap,
  dataMapSize: indicator.dataMap?.size || 0,
  dataLength: indicator.data?.length || 0,
  hasData,
  willReload: !hasData
});
```

**Resultado:** Open Interest ahora carga datos correctamente al estar habilitado.

**Lección aprendida:**
- Los objetos Map requieren `.size` en lugar de `.length`
- La validación de datos debe ser exhaustiva para todos los campos relevantes
- Logging detallado es crucial para diagnosticar problemas de carga de datos
- Los indicadores con lazy loading necesitan validación explícita en el estado "ya habilitado pero sin datos"

---

### Patrón de Validación de Datos para Indicadores Backend

Todos los indicadores que requieren datos del backend deben seguir este patrón en `updateIndicatorStates()`:

```javascript
const backendIndicators = ["VWAP", "Open Interest", "Double Top/Bottom", "Support & Resistance", "Rejection Patterns"];

// En el bloque: else if (shouldBeEnabled && wasEnabled)
if (backendIndicators.includes(indicator.name)) {
  // Validación específica por tipo de indicador:

  // Para indicadores con arrays:
  if (indicator.name === "Support & Resistance") {
    if ((!indicator.resistances || indicator.resistances.length === 0) &&
        (!indicator.supports || indicator.supports.length === 0)) {
      promises.push(indicator.fetchData());
    }
  }

  // Para indicadores con Maps:
  else if (indicator.name === "Open Interest") {
    if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
      promises.push(indicator.fetchData());
    }
  }

  // Para indicadores con objetos:
  else if (indicator.name === "VWAP") {
    if (!indicator.vwapData || Object.keys(indicator.vwapData || {}).length === 0) {
      promises.push(indicator.fetchData());
    }
  }
}
```

Este patrón asegura que los indicadores siempre tengan datos cuando están habilitados, incluso si el lazy loading inicial no se ejecutó.

---

### Fix: Open Interest Cache Permanente No Se Reutilizaba (Octubre 2026)

**Problema:** El sistema de caché permanente de Open Interest no se estaba reutilizando correctamente entre diferentes requests, causando descargas masivas innecesarias de datos de Bybit.

**Síntomas:**
- Backtest con 4 años de datos descargaba OI correctamente
- Request posterior con 1 año NO reutilizaba el caché de 4 años
- Backend descargaba nuevamente desde Bybit aunque ya tenía los datos
- Desperdicio de tiempo y recursos (requests de 5-10 minutos)

**Causa raíz (5 problemas identificados):**

1. **Caché no se guardaba en bulk-data endpoint:**
   - El endpoint `/api/backtesting/bulk-data` descargaba OI pero NO lo guardaba en caché permanente
   - Solo el endpoint `/api/open-interest` guardaba caché
   - Resultado: datos descargados en backtesting se perdían

2. **Caché vacío no se validaba:**
   - Si el caché existía pero con `data: []`, se retornaba como válido
   - Backend pensaba que tenía datos pero estaban vacíos
   - Causaba mensaje "no hay datos de open interest"

3. **Logging de errores insuficiente:**
   - Cuando ocurría error, no se logueaban parámetros críticos
   - Difícil diagnosticar problemas (timestamps, días, intervalo, etc.)

4. **Frontend sin sistema de reintentos:**
   - Un error HTTP o de red fallaba inmediatamente
   - No había recuperación automática de errores transitorios

5. **Días hardcodeados en lugar de dinámicos:**
   - `BacktestingApp.jsx` tenía días hardcodeados por timeframe (1825 días para 5m)
   - Aunque el usuario configurara fecha de inicio reciente, descargaba 5 años completos
   - Desperdicio de ~60% de datos innecesarios

**Solución Implementada (5 Fixes):**

#### Fix 1: Guardar Caché en Bulk-Data Endpoint

**Archivo:** `backend/main.py` (líneas 2456-2478, 2693-2716)

Agregado `save_oi_permanent_cache()` en dos ubicaciones del endpoint bulk-data:

```python
# Primera carga de OI (línea 2478)
if oi_data:
    await save_oi_permanent_cache(symbol, oi_interval_str, oi_data)
    print(f"[BACKTESTING] ✅ OI guardado en cache permanente: {len(oi_data)} puntos")

# Actualización incremental de OI (línea 2710)
if new_oi:
    await save_oi_permanent_cache(symbol, str(main_interval), existing_oi)
    print(f"[BACKTESTING UPDATE] ✅ OI actualizado: {len(existing_oi)} puntos totales")
```

#### Fix 2: Validación de Caché Vacío

**Archivo:** `backend/main.py` (líneas 2046-2066)

```python
file_size_mb = cache_file.stat().st_size / (1024 * 1024)
data_points = len(data.get('data', []))

# NUEVO: Validar que el cache realmente tenga datos
if data_points == 0:
    print(f"[OI PERMANENT CACHE] ⚠️ Cache existe pero está VACÍO, forzando descarga")
    return None

print(f"[OI PERMANENT CACHE] ✅ Cargado {safe_symbol} @ {safe_interval} - {file_size_mb:.2f} MB ({data_points} puntos)")
```

#### Fix 3: Logging Estructurado de Errores

**Archivo:** `backend/main.py` (líneas 936-959)

```python
except Exception as e:
    # MEJORADO: Logging detallado para debugging
    print(f"\n{'='*80}")
    print(f"❌ ERROR CRÍTICO en get_open_interest")
    print(f"{'='*80}")
    print(f"Symbol: {symbol}")
    print(f"Interval solicitado: {interval}")
    print(f"Interval final (OI): {interval_final}")
    print(f"Days: {days}")
    print(f"Start timestamp: {start_timestamp_ms} ({datetime.fromtimestamp(start_timestamp_ms/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M') if start_timestamp_ms else 'None'})")
    print(f"End timestamp: {end_timestamp_ms} ({datetime.fromtimestamp(end_timestamp_ms/1000, tz=COLOMBIA_TZ).strftime('%Y-%m-%d %H:%M') if end_timestamp_ms else 'None'})")
    print(f"Exception type: {type(e).__name__}")
    print(f"Exception message: {str(e)}")
    print(f"{'='*80}\n")
    import traceback
    traceback.print_exc()
```

**Fix adicional - UnboundLocalError:** Variables de metadata inicializadas tempranamente (líneas 659-665):

```python
# 🔧 FIX: Inicializar variables de metadata ANTES de usarlas
# Esto previene UnboundLocalError si hay excepción temprana
oi_first_timestamp = None
oi_last_timestamp = None
oi_first_date = ""
oi_last_date = ""
oi_interval = ""
```

#### Fix 4: Sistema de Reintentos en Frontend

**Archivo:** `frontend/src/components/indicators/OpenInterestIndicator.js` (líneas 38-167)

Implementado sistema de retry con exponential backoff:

```javascript
async fetchData(skipCache = false, retryCount = 0) {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_MS = 2000; // 2s, 4s, 6s

  this._isFetching = true;
  this._fetchError = null;

  try {
    // ... fetch logic ...

    if (!result.success) {
      if (retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS * (retryCount + 1);
        console.warn(`[OI] ${this.symbol} - ⏳ Reintentando en ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchData(skipCache, retryCount + 1);
      }
      throw new Error(`OI fetch failed after ${MAX_RETRIES + 1} attempts`);
    }

  } catch (error) {
    this._fetchError = error;

    // Reintentar en errores de red
    if (retryCount < MAX_RETRIES &&
        (error.name === 'TypeError' || error.name === 'NetworkError')) {
      const delay = RETRY_DELAY_MS * (retryCount + 1);
      await new Promise(resolve => setTimeout(resolve, delay));
      return this.fetchData(skipCache, retryCount + 1);
    }

    throw error;
  } finally {
    this._isFetching = false;
  }
}
```

Estados de UI mejorados (líneas 967-998):

```javascript
renderNoDataMessage(ctx, bounds) {
  if (this._isFetching) {
    // Estado: Cargando
    ctx.fillStyle = "#FFA726";
    ctx.fillText("⏳ Descargando Open Interest de Bybit...", centerX, centerY);
  } else if (this._fetchError) {
    // Estado: Error
    ctx.fillStyle = "#EF5350";
    ctx.fillText("❌ Error cargando Open Interest", centerX, centerY);
  } else {
    // Estado: Sin datos
    ctx.fillStyle = "#FF9800";
    ctx.fillText(`No Open Interest data available for ${this.symbol}`, centerX, centerY);
  }
}
```

#### Fix 5: Días Dinámicos Basados en Fecha de Inicio

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` (líneas 2023-2054)

Reemplazado `daysMap` hardcodeado por cálculo dinámico:

```javascript
{['1m', '5m', '15m', '1h', '4h'].map(tf => {
  // 🔧 FIX: Calcular días dinámicamente basándose en simulationStartTime
  const calculateDaysNeeded = () => {
    // Límites máximos del backend (MAX_DAYS_BY_INTERVAL)
    const maxDaysMap = {
      '1m': 730, '5m': 1825, '15m': 1825, '1h': 1825, '4h': 1825
    };
    const maxDays = maxDaysMap[tf] || 1825;

    // Si hay fecha de inicio definida, calcular días reales necesarios
    if (simulationStartTime) {
      const now = Date.now();
      const daysNeeded = Math.ceil((now - simulationStartTime) / (24 * 60 * 60 * 1000));
      const result = Math.min(daysNeeded, maxDays);
      console.log(`[BacktestingApp] 📊 ${tf} OI days: daysNeeded=${daysNeeded}, usando=${result}`);
      return result;
    }

    return maxDays; // Sin fecha de inicio, usar máximo
  };

  const tfDays = calculateDaysNeeded();
```

**Resultado Verificado:**

Prueba con fecha inicio octubre 2024 (~741 días):

```
[BTCUSDT] OPEN INTEREST: days=741 (antes: 1825 hardcodeado)
[OI PERMANENT CACHE] ✅ CACHE HIT para BTCUSDT @ 60 (43800 puntos)
[OI PERMANENT CACHE] ✅ CACHE HIT para BTCUSDT @ 240 (11000 puntos)
```

**Impacto:**
- ⚡ **60% menos datos** cuando se usa fecha de inicio reciente
- 🚀 **Carga instantánea** con cache hit (0.51 MB en 1h, 0.13 MB en 4h)
- 💾 **Cache reutilizable** entre backtests
- 🎯 **Eficiencia óptima** - solo descarga lo necesario

**Archivos Modificados:**

| Archivo | Cambios |
|---------|---------|
| `backend/main.py` | save_oi_permanent_cache en bulk-data (2 ubicaciones), validación cache vacío, error logging, init variables metadata |
| `frontend/src/components/indicators/OpenInterestIndicator.js` | Sistema retry (3 intentos, exponential backoff), estados UI (loading/error/no-data) |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Días dinámicos basados en simulationStartTime |

**Lección aprendida:**
- Los sistemas de caché permanente deben guardar datos en TODOS los endpoints que los consumen
- La validación de datos debe verificar que realmente contienen información (no solo que el archivo existe)
- Los valores hardcodeados deben ser dinámicos cuando dependen del contexto del usuario
- El logging estructurado es crítico para diagnosticar problemas de caché
- Los sistemas de retry automático mejoran significativamente la robustez

---

# 🎯 OI-VOLUME CONFLUENCE INDICATOR (Febrero 2026)

## Concepto

Nuevo indicador que combina **Open Interest** y **Volumen** para identificar visualmente cuando un movimiento de precio está respaldado por ambos indicadores (movimiento fuerte) o cuando hay divergencia (movimiento débil).

## Objetivo

Resolver la pregunta: *"¿Este movimiento de precio es importante o no?"*

### Casos de Uso

| OI | Volumen | Visualización | Interpretación |
|-----|---------|---------------|----------------|
| ⬆️ Sube | ⬆️ Sube | 🟢 Verde intenso | Movimiento FUERTE - nuevo dinero entrando |
| ⬇️ Baja | ⬇️ Baja | 🔴 Rojo intenso | Distribución FUERTE - capital saliendo |
| ⬆️ Sube | ⬇️ Baja | 🟡 Naranja | DIVERGENCIA - OI sube sin volumen = movimiento débil |
| ⬇️ Baja | ⬆️ Sube | 🟡 Naranja | DIVERGENCIA - Volumen sin cambio en OI = trampa |
| ~ Neutral | ~ Neutral | ⚪ Gris | Sin confluencia clara |

## Implementación Técnica

### Archivo: `OIVolumeConfluenceIndicator.js`

**Algoritmo:**

1. **Obtener datos de indicadores existentes**:
   - Volume Delta desde `VolumeIndicator.calculateVolumeDelta()`
   - OI Delta desde `OpenInterestIndicator` (histogram o cumulative mode)

2. **Normalización con Z-Score**:
   ```javascript
   // Poner ambos indicadores en la misma escala
   volumeZScores = calculateZScore(volumeDeltas, lookbackPeriod=20)
   oiZScores = calculateZScore(oiDeltas, lookbackPeriod=20)
   ```

3. **Cálculo de Confluence Score**:
   ```javascript
   confluenceScore = volumeZScore × oiZScore

   // Si ambos positivos: score positivo (confluencia alcista)
   // Si ambos negativos: score positivo (confluencia bajista)
   // Si uno positivo y otro negativo: score negativo (divergencia)
   ```

4. **Clasificación**:
   ```javascript
   if (confluenceScore > threshold && volZ > 0 && oiZ > 0):
     → bullish_strong (verde)

   else if (confluenceScore > threshold && volZ < 0 && oiZ < 0):
     → bearish_strong (rojo)

   else if (confluenceScore < -threshold):
     → divergence (naranja)

   else:
     → neutral (gris)
   ```

5. **Visualización**:
   - Histograma con barras coloreadas según confluenceType
   - Opacidad variable según strength (intensidad del score)
   - Leyenda con 4 estados: Fuerte ▲, Fuerte ▼, Divergencia, Neutral

### Z-Score Calculation

```javascript
calculateZScore(values, lookbackPeriod = 20) {
  // Para cada valor:
  // 1. Tomar ventana de lookbackPeriod valores anteriores
  // 2. Calcular media y desviación estándar de la ventana
  // 3. Z-Score = (valor - media) / stdDev

  // Esto normaliza los valores para que:
  // - Z > 2: Muy por encima de lo normal
  // - Z > 1: Por encima de lo normal
  // - -1 < Z < 1: Dentro del rango normal
  // - Z < -1: Por debajo de lo normal
  // - Z < -2: Muy por debajo de lo normal
}
```

### Inyección de Dependencias

```javascript
// En IndicatorManager.js - initialize()
const volumeIndicator = new VolumeIndicator(...);
const confluenceIndicator = new OIVolumeConfluenceIndicator(...);

// Inyectar referencias
confluenceIndicator.setIndicators(volumeIndicator, this.openInterestIndicator);
```

Esto permite que el indicador de confluencia acceda a los datos calculados de otros indicadores sin duplicar lógica.

## Configuración

### Parámetros Ajustables

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `lookbackPeriod` | 20 | Velas para calcular Z-Score |
| `confluenceThreshold` | 0.5 | Umbral mínimo para considerar confluencia significativa |

### Estados por Defecto

- ✅ **Habilitado por defecto** en todos los timeframes
- Altura: 120px
- Muestra automáticamente al tener Volume Delta y Open Interest activos

## Esquema de Colores

```javascript
bullish_strong:  { r: 52,  g: 199, b: 89  }  // Verde (#34C759)
bearish_strong:  { r: 255, g: 59,  b: 48  }  // Rojo (#FF3B30)
divergence:      { r: 255, g: 152, b: 0   }  // Naranja (#FF9800)
neutral:         { r: 158, g: 158, b: 158 }  // Gris (#9E9E9E)

// Opacidad dinámica según strength:
alpha = Math.min(0.3 + (strength * 0.5), 0.9)
```

## Información Mostrada en UI

### Header
- Título: "OI-Volume Confluence"

### Leyenda (esquina inferior derecha)
- 🟢 Fuerte ▲
- 🔴 Fuerte ▼
- 🟡 Divergencia
- ⚪ Neutral

### Valor Actual (esquina inferior izquierda)
- Label principal: "FUERTE ▲" / "FUERTE ▼" / "DIVERGENCIA" / "NEUTRAL"
- Z-Scores detallados: `Vol Z: 1.23 | OI Z: 0.87`

### Mensaje de Error
Si Volume Delta u Open Interest no están activos:
```
"Requiere Volume Delta y Open Interest activos"
```

## Ejemplo de Interpretación

**Escenario 1 - Breakout Fuerte:**
```
Precio: $95k → $97k ⬆️
Volume Z-Score: +2.5 (volumen muy alto)
OI Z-Score: +1.8 (OI subiendo fuerte)
Confluence Score: +4.5 (positivo alto)
→ Visualización: BARRA VERDE INTENSA
→ Interpretación: Movimiento FUERTE, respaldado por nuevo dinero
```

**Escenario 2 - Trampa Alcista:**
```
Precio: $95k → $97k ⬆️
Volume Z-Score: +0.5 (volumen ligeramente alto)
OI Z-Score: -1.2 (OI bajando)
Confluence Score: -0.6 (negativo)
→ Visualización: BARRA NARANJA (divergencia)
→ Interpretación: Movimiento DÉBIL, OI baja = posibles cierres de posiciones
```

**Escenario 3 - Distribución Fuerte:**
```
Precio: $97k → $95k ⬇️
Volume Z-Score: -2.1 (volumen vendedor fuerte)
OI Z-Score: -1.5 (OI bajando)
Confluence Score: +3.15 (positivo)
→ Visualización: BARRA ROJA INTENSA
→ Interpretación: Distribución FUERTE, capital saliendo confirmado
```

## Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `frontend/src/components/indicators/OIVolumeConfluenceIndicator.js` | Nuevo archivo - Indicador completo |
| `frontend/src/components/indicators/IndicatorManager.js` | Import + instancia + inyección de dependencias |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Agregado a getDefaultIndicatorStates() y indicatorStates |
| `CLAUDE.md` | Documentación completa del indicador |

## Ventajas vs Visualizar OI y Volumen por Separado

1. **Síntesis visual inmediata**: No necesitas comparar mentalmente dos gráficos separados
2. **Normalización automática**: Z-Score pone ambos en la misma escala
3. **Color coding intuitivo**: Verde = fuerte, Rojo = fuerte bajista, Naranja = cuidado
4. **Detección de divergencias**: Resalta automáticamente cuando hay conflicto entre OI y Volumen

## Posibles Mejoras Futuras

- [ ] Configuración de thresholds desde UI
- [ ] Alertas cuando confluencia cruza de neutral a fuerte
- [ ] Historial de divergencias destacadas
- [ ] Overlay opcional en el chart principal (background coloring)
- [ ] Estadísticas de win rate basadas en señales de confluencia

---

## MEJORAS AL PANEL DE TRADING (Octubre 2026)

### 1. SL/TP en Porcentaje con Preview en USDT

**Problema:** Los usuarios debían ingresar valores absolutos en USDT para Stop Loss y Take Profit, lo cual era incómodo para calcular riesgo/recompensa.

**Solución:** Sistema de entrada basado en porcentajes con preview en tiempo real del valor equivalente en USDT.

**Archivo:** `frontend/src/components/backtesting/TradingControls.jsx`

**Cambios implementados:**

1. **Estado cambiado a porcentajes (líneas 5-12)**:
```javascript
// ANTES:
const [stopLoss, setStopLoss] = useState('');
const [takeProfit, setTakeProfit] = useState('');

// DESPUÉS:
const [stopLossPercent, setStopLossPercent] = useState('');
const [takeProfitPercent, setTakeProfitPercent] = useState('');
```

2. **Conversión automática en handleCreateOrder (líneas 69-110)**:
```javascript
// 🎯 NUEVO: Convertir porcentajes a precios USDT
const slPercent = stopLossPercent ? parseFloat(stopLossPercent) : null;
const tpPercent = takeProfitPercent ? parseFloat(takeProfitPercent) : null;

let sl = null;
let tp = null;

if (slPercent !== null) {
  sl = orderSide === 'long'
    ? price * (1 - slPercent / 100)
    : price * (1 + slPercent / 100);
}

if (tpPercent !== null) {
  tp = orderSide === 'long'
    ? price * (1 + tpPercent / 100)
    : price * (1 - tpPercent / 100);
}
```

3. **Inputs con preview en tiempo real (líneas 274-310)**:
```javascript
<div className="control-section">
  <label>Stop Loss % (Opcional)</label>
  <input
    type="number"
    step="0.1"
    min="0"
    value={stopLossPercent}
    onChange={(e) => setStopLossPercent(e.target.value)}
    placeholder="Ej: 2 (= 2%)"
  />
  {stopLossPercent && entryPrice && (
    <div className="price-hint">
      ${(orderSide === 'long'
        ? parseFloat(entryPrice) * (1 - parseFloat(stopLossPercent) / 100)
        : parseFloat(entryPrice) * (1 + parseFloat(stopLossPercent) / 100)
      ).toFixed(2)}
    </div>
  )}
</div>
```

**Funcionalidad:**
- Usuario ingresa porcentajes (ej: `2` para 2%, `4` para 4%)
- El sistema muestra automáticamente el valor equivalente en USDT debajo del input
- La conversión mantiene la lógica correcta según la dirección:
  - **LONG**: SL = precio × (1 - %) | TP = precio × (1 + %)
  - **SHORT**: SL = precio × (1 + %) | TP = precio × (1 - %)
- Botones rápidos (SL 2% / TP 4%, etc.) ahora establecen porcentajes directamente

**Validación:**
- Verifica que los porcentajes sean números válidos > 0
- Elimina validación de SL/TP vs precio (la conversión % siempre respeta direcciones correctas)

---

### 2. Botón de Maximizar Panel de Trading

**Problema:** El panel de trading no tenía opción de maximizar para ver mejor las métricas de rendimiento, aunque el backend ya soportaba fullscreen.

**Solución:** Agregado botón de maximizar en el header del panel con atajo de teclado.

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx`

**Cambios implementados:**

1. **Botón en el header del sidebar (líneas 2143-2165)**:
```javascript
{/* 🎯 OPTIMIZACIÓN UI: Header del panel con botones de maximizar y colapsar */}
<div className="sidebar-header">
  <span className="sidebar-title">Panel de Trading</span>
  <div style={{ display: 'flex', gap: '8px' }}>
    <button
      className="btn-collapse"
      onClick={() => setFullscreenPanel(prev => prev === 'trading' ? null : 'trading')}
      title={fullscreenPanel === 'trading' ? "Restaurar panel (ESC)" : "Maximizar panel (Shift+T)"}
      style={{ fontSize: '16px' }}
    >
      {fullscreenPanel === 'trading' ? '⛶' : '⛶'}
    </button>
    <button
      className="btn-collapse"
      onClick={() => setShowTradingPanel(false)}
      title="Ocultar panel (T o ESC)"
    >
      ✕
    </button>
  </div>
</div>
```

2. **Atajo de teclado Shift+T (líneas 378-393)**:
```javascript
// 🎯 NUEVO: F key: Toggle fullscreen del gráfico
if (e.key === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey && !isInputFocused) {
  e.preventDefault();
  setFullscreenPanel(prev => prev === 'chart' ? null : 'chart');
  console.log('[BacktestingApp] Toggle fullscreen del gráfico (F)');
}

// 🎯 NUEVO: Shift+T: Toggle fullscreen del panel de trading
if (e.key === 'T' && e.shiftKey && !e.ctrlKey && !e.metaKey && !isInputFocused) {
  e.preventDefault();
  setFullscreenPanel(prev => prev === 'trading' ? null : 'trading');
  console.log('[BacktestingApp] Toggle fullscreen del panel de trading (Shift+T)');
}

// 🎯 NUEVO: ESC: Salir de fullscreen del panel y ocultar panel trading
if (e.key === 'Escape') {
  e.preventDefault();
  if (fullscreenPanel) {
    setFullscreenPanel(null);
    console.log('[BacktestingApp] Saliendo de fullscreen del panel (ESC)');
  }
  if (showTradingPanel) {
    setShowTradingPanel(false);
    console.log('[BacktestingApp] Ocultando panel de trading (ESC)');
  }
}
```

**Funcionalidad:**
- Botón **⛶** en el header del panel de trading (junto al botón de cerrar)
- Click en el botón alterna entre maximizado y normal
- **Atajo de teclado**: `Shift+T` para maximizar/restaurar
- **ESC** sale del fullscreen y oculta el panel
- Usa el mismo sistema `fullscreenPanel` que el gráfico principal (`'chart'` | `'trading'` | `null`)

**Beneficio:** Permite ver las métricas de rendimiento (win rate, PnL, drawdown, historial) en pantalla completa para análisis detallado.

---

### 3. Fix: TP/SL Box en Órdenes Limit

**Problema:** Las órdenes limit no dibujaban la caja de TP/SL en el gráfico cuando se ejecutaban. Las market orders funcionaban correctamente, pero las limit/stop tenían este bug.

**Causa raíz:** El callback `onOrderCreated` solo creaba cajas TP/SL para órdenes market (`if (order && order.type === 'market' && ...`). Las órdenes limit se creaban como 'pending' y solo se ejecutaban cuando el precio las alcanzaba, pero no había lógica para dibujar la caja en ese momento.

**Solución:** Agregada lógica de creación de TP/SL box en el callback `onOrderExecuted`.

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx`

**Cambios implementados (líneas 838-858)**:
```javascript
// 🎯 NUEVO: Conectar callback para cuando una orden pendiente se ejecuta
orderManagerRef.current.onOrderExecuted = (executedOrder) => {
  console.log('[BacktestingApp] Orden pendiente ejecutada:', executedOrder);
  // El popup se mostrará automáticamente en TradingControls a través del callback onOrderCreated

  // 🎯 FIX: Crear caja TP/SL cuando limit/stop order se ejecuta
  if (executedOrder && (executedOrder.stopLoss || executedOrder.takeProfit)) {
    const miniChart = miniChartRefs.current[activeTimeframe];
    if (miniChart && miniChart.addTPSLBox) {
      miniChart.addTPSLBox(
        executedOrder.entryPrice,
        executedOrder.executedAt || currentTime,
        executedOrder.side, // 'long' o 'short'
        executedOrder.stopLoss,
        executedOrder.takeProfit,
        5 // 5 velas de ancho
      );
      console.log('[BacktestingApp] TP/SL box creada para limit order ejecutada');
    }
  }
};
```

**Flujo de eventos:**
1. Usuario crea orden limit con SL/TP configurados
2. Orden queda en estado 'pending'
3. Durante el playback, cuando precio alcanza el nivel limit:
   - `OrderManager` ejecuta la orden y cambia estado a 'open'
   - Llama al callback `onOrderExecuted(executedOrder)`
4. El callback verifica si la orden tiene SL/TP definidos
5. Si tiene, llama a `miniChart.addTPSLBox()` para dibujar la caja
6. La caja aparece en el gráfico mostrando entry, SL y TP

**Resultado:** Ahora las órdenes limit muestran correctamente la caja de TP/SL cuando se ejecutan, igual que las market orders.

---

## Atajos de Teclado Actualizados

| Atajo | Función |
|-------|---------|
| `T` | Mostrar/ocultar panel de trading |
| `F` | Maximizar/restaurar gráfico principal |
| `Shift+T` | Maximizar/restaurar panel de trading |
| `ESC` | Salir de fullscreen + ocultar panel trading |
| `Space` | Play/Pause del playback |
| `←` | Retroceder 1 vela |
| `→` | Avanzar 1 vela |

---

## Archivos Modificados en Esta Sesión

| Archivo | Cambios |
|---------|---------|
| `frontend/src/components/backtesting/TradingControls.jsx` | SL/TP en porcentaje, conversión automática, preview USDT |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | Botón maximizar panel, atajo Shift+T, fix TP/SL box limit orders |
| `CLAUDE.md` | Documentación completa de los 3 fixes |

---

## FIX: NAVEGACIÓN A TRADES HISTÓRICOS (Octubre 2026)

> Reemplazado el 7 de noviembre de 2026: ir a un trade ya no mueve la hora simulada. `handleNavigateToTrade` usa `focusOn()` (ver "JOURNAL DE TRADES"). `centerOnTimestamp` solo lo usa la lista de footprints anclados (`FootprintSidebar`), que hoy no se puede abrir: `MiniChart` nunca llama `onCandleClick`, así que nada ancla un footprint

### Problema

Al hacer click en el ícono 📍 en el historial de trades para navegar al gráfico en la fecha exacta del trade, la aplicación se iba a una fecha incorrecta que no coincidía con ningún trade. Todos los trades llevaban a la misma fecha incorrecta.

### Causa Raíz

El método `centerOnTimestamp` en `MiniChart.jsx` usaba `candlesRef.current` para buscar el timestamp del trade. Sin embargo:
- `candlesRef` solo contiene las velas **visibles del playback actual** (~500 velas alrededor del currentTime)
- Los trades históricos pueden estar **meses o años en el pasado**
- El timestamp del trade no existía en `candlesRef`, por lo que siempre navegaba a la última vela disponible

El fix anterior del "chart flip bug" había cambiado de usar `allCandlesRef` a `candlesRef` para evitar el volteo del gráfico, pero esto rompió la navegación a trades históricos.

### Solución

**Archivo:** `frontend/src/components/MiniChart.jsx` (líneas 364-420)

El fix correcto usa un enfoque híbrido:

1. **Para buscar el timestamp**: Usar `allCandlesRef` (todas las velas históricas) en modo backtesting
2. **Para actualizar el playback**: Llamar a `onRequestTimeChange(timestamp)` con el timestamp del trade
3. **Dejar que el sistema reconstruya**: El playback actualiza `currentTime` y reconstruye `candlesRef` automáticamente

```javascript
centerOnTimestamp: (timestamp, options = {}) => {
  // 🎯 FIX: En backtesting, usar allCandlesRef para buscar trades históricos
  const sourceCandles = backtestingMode && allCandlesRef.current?.length > 0
    ? allCandlesRef.current
    : candlesRef.current;

  // Buscar el índice de la vela más cercana al timestamp
  let targetIndex = -1;
  for (let i = 0; i < sourceCandles.length; i++) {
    if (sourceCandles[i].timestamp >= timestamp) {
      targetIndex = i;
      break;
    }
  }

  const targetCandle = sourceCandles[targetIndex];

  // 🎯 FIX: En backtesting, actualizar currentTime para reconstruir candlesRef
  if (backtestingMode && onRequestTimeChange) {
    console.log(`[MiniChart] 📍 Actualizando playback a: ${new Date(targetCandle.timestamp).toISOString()}`);
    onRequestTimeChange(targetCandle.timestamp);
    return; // El playback reconstruirá candlesRef automáticamente
  }

  // FALLBACK: Navegación visual si no estamos en backtesting
  // ... (código de animación visual)
}
```

### Ventajas de este Enfoque

1. **Evita el chart flip**: No manipulamos directamente el offset con arrays de diferentes tamaños
2. **Busca en todo el histórico**: `allCandlesRef` contiene todas las velas cargadas (hasta 5 años)
3. **Actualización limpia**: `onRequestTimeChange` dispara el flujo normal de actualización del playback
4. **Centrado automático**: El TimeController se encarga de centrar la vista después de actualizar currentTime

### Flujo Completo

```
1. Usuario hace click en 📍 de un trade en TradeHistory
   ↓
2. handleNavigateToTrade() llama a miniChart.centerOnTimestamp(order.entryTime)
   ↓
3. centerOnTimestamp() busca el timestamp en allCandlesRef (todas las velas)
   ↓
4. Encuentra la vela exacta (ej: índice 15234 de 43800 velas totales)
   ↓
5. Llama a onRequestTimeChange(targetCandle.timestamp)
   ↓
6. BacktestingApp actualiza currentTime state
   ↓
7. TimeController reconstruye candlesRef con ~500 velas alrededor del nuevo currentTime
   ↓
8. El gráfico se re-renderiza centrado en el trade
```

### Logging de Diagnóstico

El fix incluye logs detallados para debugging:

```javascript
console.log(`[MiniChart] 🔍 centerOnTimestamp: buscando ${timestamp} (${new Date(timestamp).toISOString()})`);
console.log(`[MiniChart] 🔍 Fuente: ${backtestingMode ? 'allCandlesRef (histórico completo)' : 'candlesRef (actual)'}`);
console.log(`[MiniChart] 🔍 Rango disponible: ${new Date(firstTs).toISOString()} → ${new Date(lastTs).toISOString()}`);
console.log(`[MiniChart] 🔍 Total velas: ${sourceCandles.length}`);
console.log(`[MiniChart] ✅ Vela encontrada en índice ${targetIndex}: ${new Date(targetCandle.timestamp).toISOString()}`);
console.log(`[MiniChart] 📍 Actualizando playback time a: ${new Date(targetCandle.timestamp).toISOString()}`);
```

### Resultado

✅ **Ahora funciona correctamente**: Click en cualquier trade del historial navega al gráfico en la fecha y hora exacta del trade, centrado en pantalla.

### Fix Adicional: "Baile del Gráfico" al Mover Mouse (Octubre 2026)

**Problema:** Después de implementar el fix inicial de navegación, apareció un nuevo issue: al hacer click en el ícono de un trade para navegar, el gráfico iba a la fecha correcta PERO al mover el mouse sobre el gráfico, este empezaba a "bailar" de izquierda a derecha, haciendo muy difícil la visualización.

**Causa raíz:** El `useEffect(currentTime)` (líneas 2210-2269) reconstruye `candlesRef` cada vez que cambia `currentTime`, y si `!manualPanRef.current`, recalcula automáticamente el `offset` (líneas 2246-2261). El flujo problemático era:

```
1. centerOnTimestamp() llama onRequestTimeChange(timestamp)
2. currentTime se actualiza en BacktestingApp
3. useEffect(currentTime) se dispara → reconstruye candlesRef
4. Recalcula offset automáticamente (líneas 2256-2260)
5. Usuario mueve el mouse → handleMouseMove (línea 1791) llama drawChart()
6. Pero el useEffect podría estar aún recalculando el offset
7. Esto causa el "baile" visual del gráfico
```

**Solución:** Marcar temporalmente `manualPanRef.current = true` durante 300ms al navegar a un trade. Esto previene que el `useEffect` recalcule automáticamente el offset mientras se reconstruye `candlesRef`, eliminando el "baile".

**Implementación (líneas 404-422 de MiniChart.jsx):**

```javascript
// 🎯 FIX NAVEGACIÓN A TRADES: En backtesting, actualizar currentTime
if (backtestingMode && onRequestTimeChange) {
  console.log(`[MiniChart ${symbol}] 📍 Actualizando playback time a: ${timestamp}`);

  // 🔧 FIX "BAILE DEL GRÁFICO": Marcar como paneo manual temporalmente
  // Esto evita que el useEffect(currentTime) recalcule el offset automáticamente
  const wasManualPan = manualPanRef.current;
  manualPanRef.current = true;

  onRequestTimeChange(targetCandle.timestamp);

  // Restaurar el estado original después de que el useEffect termine
  setTimeout(() => {
    manualPanRef.current = wasManualPan;
    console.log(`[MiniChart ${symbol}] 🔄 Restaurado manualPan=${wasManualPan}`);
  }, 300);

  return;
}
```

**Resultado:** El gráfico navega correctamente al trade Y se mantiene estable cuando el usuario mueve el mouse.

### Archivos Modificados (Octubre 2026)

| Archivo | Cambio |
|---------|--------|
| `frontend/src/components/MiniChart.jsx` | Fix centerOnTimestamp: usar allCandlesRef + actualizar playback time + prevenir recalculo de offset |
| `CLAUDE.md` | Documentación completa de ambos fixes |