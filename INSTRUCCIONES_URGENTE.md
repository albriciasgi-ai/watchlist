# 🚨 INSTRUCCIONES URGENTES - Frontend no carga cambios

## Problema
Los cambios SÍ están en el código (verificado en commits), pero el navegador está cargando una versión antigua en caché.

## ✅ SOLUCIÓN PASO A PASO:

### 1️⃣ DETENER TODO
```bash
# Detener AMBOS procesos:
# - Backend (puerto 8000)
# - Frontend (puerto 5173 o similar)
# Presiona Ctrl+C en ambas terminales
```

### 2️⃣ LIMPIAR COMPLETAMENTE
```bash
# En la carpeta del proyecto:
cd WatchlistConIndicadores/frontend

# Eliminar node_modules y reinstalar (OPCIONAL pero recomendado):
rm -rf node_modules
rm -rf .vite
npm install

# Si no quieres reinstalar, al menos elimina el caché de Vite:
rm -rf .vite
rm -rf dist
```

### 3️⃣ REINICIAR BACKEND
```bash
cd WatchlistConIndicadores/backend
python -m uvicorn main:app --reload --port 8000
```

Deberías ver en los logs:
```
[OI CALCULATION] interval_final=... → oi_interval=...
[OI CALCULATION] ... días × 24h × 60min / ... min = ... puntos necesarios
```

### 4️⃣ REINICIAR FRONTEND
```bash
cd WatchlistConIndicadores/frontend
npm run dev
```

### 5️⃣ LIMPIAR NAVEGADOR COMPLETAMENTE

**Opción A - Modo incógnito (RECOMENDADO):**
- Abre una ventana incógnita/privada
- Ve a http://localhost:5173 (o el puerto que use Vite)
- **Esto garantiza NO usar caché**

**Opción B - Limpiar caché:**
1. Abre DevTools (F12)
2. Click derecho en el botón de recargar → "Empty Cache and Hard Reload"
3. O usa: Ctrl + Shift + Delete → Limpiar TODO (últimas 24 horas)

### 6️⃣ VERIFICAR VERSIÓN CARGADA

Abre la consola del navegador (F12 → Console) y busca:

```
[OpenInterestIndicator] VERSION 2.0 LOADED - Azul/Naranja colors + Fullscreen selector
```

**Si ves este mensaje con fondo azul:**
✅ La versión correcta está cargada

**Si NO lo ves:**
❌ Sigue usando versión antigua - REPITE los pasos 2-5

---

## 🔍 QUÉ DEBERÍAS VER:

### Colores (Histogram y Cumulative):
- Positivo: **AZUL** (#1E88E5)
- Negativo: **NARANJA** (#F57C00)
- Si ves VERDE/ROJO → versión antigua

### Fullscreen:
- Click en botón **⛶** (fullscreen)
- Arriba-izquierda debe aparecer: "**Open Interest Mode:**" con selector
- Si NO aparece → versión antigua

### Timeframes 1h+:
- TODAS las barras visibles desde el inicio
- Si faltan ~50% de barras → backend no reiniciado

---

## 🆘 SI SIGUE SIN FUNCIONAR:

Copia y pega EXACTAMENTE este comando en la consola del navegador (F12):

```javascript
console.log("VERSION CHECK:", window.location.href, document.querySelector('script[src*="index"]')?.src);
```

Y mándame el resultado.

---

## 📝 ARCHIVOS LOG

El archivo `LOG_CONSOLE_16112025_4.txt` está en TU computadora, no en el repositorio de GitHub.

Para que yo pueda verlo, necesitas:
1. Copiarlo a la carpeta `WatchlistConIndicadores/logs/`
2. Hacer commit y push:
```bash
git add WatchlistConIndicadores/logs/LOG_CONSOLE_16112025_4.txt
git commit -m "Add console log for debugging"
git push
```

O simplemente copia y pega el contenido relevante en tu próximo mensaje.
