# 📝 RESUMEN DE SESIÓN - OCTUBRE 22, 2026

## Problema Principal

**App de Backtesting no descarga datos históricos correctamente**

Síntomas:
- Frontend muestra: "❌ Fecha muy reciente. Los datos terminan el 19/5/2023"
- Backend no muestra mensajes de descarga después del startup
- Usuario necesita datos desde octubre 2024 hasta octubre 2026

---

## Causa Raíz (Identificada)

1. **Backend:** Errores temporales de Bybit (`"svc error: Get kline failed"`) detenían descarga prematuramente
2. **Backend:** Límite de max_requests=600 insuficiente para timeframe 1m (necesita 1061)
3. **Frontend:** Solo descargaba 1 timeframe en lugar de los 5
4. **Frontend:** Aceptaba caché con datos antiguos (mayo 2023) como válidos
5. **Sistema:** Dos procesos del backend corriendo simultáneamente (PIDs 16516, 12084)

---

## Fixes Implementados (Sin Probar)

### 1. Sistema de Reintentos (Backend)

**Archivo:** `backend/main.py` líneas 2153-2195

```python
# Reintenta hasta 3 veces si Bybit falla temporalmente
max_retries = 3
while retry_count < max_retries:
    if "Get kline failed" in error_msg or "svc error" in error_msg:
        retry_count += 1
        await asyncio.sleep(2)  # Espera 2s
        continue
```

### 2. Aumento de Límite de Requests

**Archivo:** `backend/main.py` línea 2150

```python
# ANTES: max_requests = min(600, ...)
# DESPUÉS: max_requests = min(1200, ...)
```

Esto permite:
- 1m: 1061 requests → 1,051,200 velas completas
- 5m: 526 requests → 525,600 velas completas

### 3. Descarga de Todos los Timeframes

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` línea 899

```javascript
// ANTES: data = await loadBacktestingData(symbol, false, activeTimeframe);
// DESPUÉS: data = await loadBacktestingData(symbol, false, null);
```

### 4. Validación de Datos Recientes

**Archivo:** `frontend/src/components/backtesting/BacktestingApp.jsx` líneas 812-835

```javascript
// Nueva validación: rechazar caché si última vela > 30 días antigüedad
const lastCandleAgeDays = (now - lastCandle.timestamp) / (1000 * 60 * 60 * 24);
const hasRecentData = lastCandleAgeDays <= 30;

if (!hasRecentData) {
  console.log(`Cache con datos MUY ANTIGUOS (${lastCandleAgeDays} días)`);
  // Forzar descarga del servidor
}
```

---

## Estado de los Datos

### Caché Backend (Limpio)

```
C:\...\backend\backtesting_cache\
├── BTCUSDT_backtesting_data.json.gz  ❌ ELIMINADO (estaba corrupto)
├── BTCUSDT_1_oi.json.gz              ✅ OK
├── BTCUSDT_5_oi.json.gz              ✅ OK
├── BTCUSDT_15_oi.json.gz             ✅ OK
├── BTCUSDT_60_oi.json.gz             ✅ OK
└── BTCUSDT_240_oi.json.gz            ✅ OK
```

### Caché Frontend (Necesita Limpieza)

- **IndexedDB:** `BacktestingDataDB` tiene datos antiguos (mayo 2023)
- **Acción requerida:** Eliminar con script después de reiniciar

---

## Archivos Creados

1. **`DESPUES_DE_REINICIAR.md`** - Pasos exactos post-reinicio
2. **`SOLUCION_FINAL.md`** - Guía completa de troubleshooting
3. **`frontend/CLEAR_CACHE.js`** - Script avanzado para limpiar caché del navegador
4. **`RESUMEN_SESION_OCT22.md`** - Este archivo

---

## Archivos Modificados

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `backend/main.py` | 2150 | max_requests: 600 → 1200 |
| `backend/main.py` | 2153-2195 | Sistema de reintentos (3 intentos) |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | 899 | Descarga todos timeframes (null en lugar de activeTimeframe) |
| `frontend/src/components/backtesting/BacktestingApp.jsx` | 812-835 | Validación datos recientes (<30 días) |
| `CLAUDE.md` | 0-100 | Sección "ESTADO ACTUAL" agregada |
| `../../../CLAUDE.md` | 50-70 | Sección "SESIÓN ACTIVA" agregada |

---

## Plan de Acción (Próxima Sesión)

1. **Usuario reinicia PC** → Mata procesos duplicados
2. **Iniciar backend:** `start_backend.bat`
3. **Iniciar frontend:** `npm run dev`
4. **Limpiar IndexedDB** con script en consola del navegador
5. **Recargar app** (F5)
6. **Iniciar backtesting:** BTCUSDT, 2026-10-01

### Verificación de Éxito

**Backend DEBE mostrar:**
```
[BACKTESTING] ===== Procesando 1m (730 días) =====
[BACKTESTING] BTCUSDT @ 1m - Necesitamos 1051200 velas
[BACKTESTING] Permitiendo hasta 1061 requests
INFO:httpx:HTTP Request: GET https://api.bybit.com...
```

**Frontend DEBE mostrar:**
```
[BacktestingApp] ❌ No hay caché válido
[BacktestingApp] Cargando datos para BTCUSDT [todos]...
```

### Si Backend NO Muestra Mensajes

Significa que frontend sigue usando caché viejo:

1. Verificar código nuevo cargado: mensaje `"Datos recientes (< 30 días): ❌ NO"`
2. Si no aparece → rebuild frontend: `rmdir /s /q node_modules\.vite && npm run dev`
3. Hard refresh navegador: `Ctrl + Shift + R`

---

## Tiempo Estimado de Descarga

| Timeframe | Velas | Requests | Tiempo |
|-----------|-------|----------|--------|
| 1m | 1,051,200 | ~1061 | ~8.8 min |
| 5m | 525,600 | ~526 | ~4.4 min |
| 15m | 175,200 | ~176 | ~1.5 min |
| 1h | 43,800 | ~44 | ~22 seg |
| 4h | 10,950 | ~11 | ~6 seg |

**Total:** ~15-20 minutos (incluye reintentos por errores de Bybit)

---

## Comandos Útiles

### Verificar Procesos en Puerto 9000
```bash
netstat -ano | findstr :9000
```

### Matar Procesos Python
```bash
taskkill /F /IM python.exe
```

### Limpiar Caché de Vite (Frontend)
```bash
cd frontend
rmdir /s /q node_modules\.vite
npm run dev
```

### Script de Limpieza IndexedDB
```javascript
(async () => {
  const req = indexedDB.deleteDatabase('BacktestingDataDB');
  req.onsuccess = () => console.log('✅ Eliminado');
})();
```

---

## Notas Técnicas

### Rate Limiting de Bybit

- Delay entre requests: 500ms
- Si aún hay errores "Get kline failed", aumentar a 1000ms (1s)
- Bybit puede tener problemas temporales - los reintentos deberían manejar esto

### Estructura de Caché

```javascript
{
  symbol: "BTCUSDT",
  timeframes: {
    "1m": { main: [...], subdivisions: [...], open_interest: [...] },
    "5m": { main: [...], subdivisions: [...], open_interest: [...] },
    "15m": { main: [...], subdivisions: [...], open_interest: [...] },
    "1h": { main: [...], subdivisions: [...], open_interest: [...] },
    "4h": { main: [...], subdivisions: [...], open_interest: [...] }
  },
  metadata: { ... }
}
```

### Opción B (Subdivisiones = Main)

Las subdivisiones referencian el mismo array que main para evitar duplicación:
```javascript
"5m": {
  main: [vela1, vela2, ...],         // 525,600 velas
  subdivisions: [vela1, vela2, ...], // MISMA REFERENCIA
  subdivision_count: 1
}
```

Esto evita descargar datos adicionales para subdivisiones.

---

## Contacto para Próxima Sesión

Al reiniciar sesión de Claude Code, proporcionar:

1. **Este archivo:** `RESUMEN_SESION_OCT22.md`
2. **Logs del backend** (últimas 50 líneas si hay error)
3. **Consola del navegador** (mensajes relevantes)
4. **Qué paso funcionó/falló**

Archivos de referencia rápida:
- `DESPUES_DE_REINICIAR.md` - Lista de pasos
- `SOLUCION_FINAL.md` - Troubleshooting completo
- `CLAUDE.md` - Contexto técnico completo
