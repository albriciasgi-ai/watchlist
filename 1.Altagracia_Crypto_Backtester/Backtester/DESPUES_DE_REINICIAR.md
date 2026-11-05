# 🚀 PASOS DESPUÉS DE REINICIAR EL PC

**Fecha:** Octubre 22, 2026
**Problema:** Descarga de datos de backtesting no funciona
**Causa:** Procesos duplicados del backend + caché corrupto

---

## ✅ EJECUTAR EN ORDEN:

### 1️⃣ Iniciar Backend

```bash
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\1.Altagracia_Crypto_Backtester\Backtester\backend

start_backend.bat
```

**Espera a ver:**
```
INFO:     Uvicorn running on http://127.0.0.1:9000 (Press CTRL+C to quit)
[STARTUP] Backend started successfully
```

### 2️⃣ Iniciar Frontend

```bash
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\1.Altagracia_Crypto_Backtester\Backtester\frontend

npm run dev
```

**Espera a ver:**
```
VITE v5.x.x  ready in XXX ms

➜  Local:   http://localhost:5173/
```

### 3️⃣ Abrir Navegador

1. Ve a: `http://localhost:5173`
2. Presiona **F12** (DevTools)
3. Ve a la pestaña **Console**

### 4️⃣ Limpiar IndexedDB

**Copia y pega esto en la consola del navegador:**

```javascript
(async () => {
  console.log('🗑️ Eliminando IndexedDB...');
  const req = indexedDB.deleteDatabase('BacktestingDataDB');
  req.onsuccess = () => console.log('✅ IndexedDB eliminado - Recarga la página (F5)');
  req.onerror = (e) => console.error('❌ Error:', e);
  req.onblocked = () => console.error('⚠️ BLOQUEADO - Cierra todas las pestañas de la app');
})();
```

**Espera a ver:**
```
✅ IndexedDB eliminado - Recarga la página (F5)
```

### 5️⃣ Recargar Página

Presiona **F5** en el navegador

### 6️⃣ Iniciar Backtesting

1. Ingresa:
   - **Símbolo:** `BTCUSDT`
   - **Fecha de inicio:** `2026-10-01`

2. Click en **"Iniciar Backtesting"**

### 7️⃣ Verificar Descarga

**En la consola del navegador (F12 → Console):**
```
[BacktestingApp] ❌ No hay caché válido para 15m
[BacktestingApp] 📥 Descargando histórico completo del servidor...
[BacktestingApp] Cargando datos para BTCUSDT [todos]...
```

**En la terminal del backend (CRÍTICO - DEBE APARECER):**
```
[BACKTESTING] Descargando solo 15m para BTCUSDT...

[BACKTESTING] ===== Procesando 15m (1825 días) =====
[BACKTESTING] BTCUSDT @ 15m - Necesitamos 175200 velas para 1825 días
[BACKTESTING] Permitiendo hasta 185 requests para descargar todas las velas
INFO:httpx:HTTP Request: GET https://api.bybit.com/v5/market/kline?category=linear&symbol=BTCUSDT&interval=15&start=...
```

---

## 🔴 SI EL BACKEND NO MUESTRA MENSAJES:

Significa que hay procesos duplicados. Ejecuta:

```powershell
# Verificar procesos en puerto 9000
netstat -ano | findstr :9000

# Si aparecen 2 procesos, matarlos
taskkill /F /IM python.exe

# Reiniciar backend
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\1.Altagracia_Crypto_Backtester\Backtester\backend
start_backend.bat
```

---

## ⏱️ Tiempo de Descarga (Primera Vez)

- **1m:** ~8.8 minutos
- **5m:** ~4.4 minutos
- **15m:** ~1.5 minutos
- **1h:** ~22 segundos
- **4h:** ~6 segundos

**Total:** ~15-20 minutos

Durante la descarga verás:

```
[BACKTESTING] BTCUSDT @ 1m - Descargadas 100000/1051200 velas (100 requests)
[BACKTESTING] BTCUSDT @ 1m - Descargadas 200000/1051200 velas (200 requests)
...
[BACKTESTING] OK BTCUSDT @ 1m - 1051200 velas descargadas

[BACKTESTING] ===== Procesando 5m (1825 días) =====
...
```

---

## ✅ Éxito Confirmado Cuando:

1. Backend muestra mensajes `[BACKTESTING] ===== Procesando...`
2. Todos los timeframes completan: `OK BTCUSDT @ Xm - XXXXX velas descargadas`
3. La app del navegador muestra gráfico con fecha **octubre 2026**

---

## 📞 Si Sigue Sin Funcionar:

Revisa:
- `SOLUCION_FINAL.md` - Guía completa de troubleshooting
- `CLAUDE.md` - Sección "ESTADO ACTUAL" con detalles técnicos
- `frontend/CLEAR_CACHE.js` - Script avanzado de limpieza

O reporta en una nueva sesión de Claude Code con:
1. Logs del backend (últimas 50 líneas)
2. Mensajes de la consola del navegador
3. Qué paso específico falló
