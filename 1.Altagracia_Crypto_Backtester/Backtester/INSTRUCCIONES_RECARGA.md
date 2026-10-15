# 🔄 INSTRUCCIONES PARA RECARGAR EL FRONTEND CON CAMBIOS

## Problema Identificado

El código nuevo está correctamente guardado en los archivos, pero el navegador está usando una **versión cacheada antigua** del JavaScript. Por eso no ves ninguno de los mensajes de consola que agregamos.

## Solución: Hard Reload del Frontend

Sigue estos pasos **EXACTAMENTE** en este orden:

### 1. Detener el servidor de desarrollo Vite

En la terminal donde está corriendo `npm run dev`, presiona:
```
Ctrl + C
```

### 2. Limpiar caché de Vite

```bash
cd frontend
rmdir /s /q node_modules\.vite
rmdir /s /q dist
```

### 3. Reiniciar el servidor de desarrollo

```bash
npm run dev
```

Espera a que aparezca el mensaje:
```
> vite
  VITE ready in XXX ms
  ➜  Local:   http://localhost:5173/
```

### 4. Hard Reload en el navegador

1. Abre el navegador en `http://localhost:5173`
2. Abre DevTools (F12)
3. Haz **clic derecho** en el botón de recargar del navegador
4. Selecciona **"Vaciar caché y recargar de manera forzada"** (Empty Cache and Hard Reload)

   O usa el atajo de teclado: **Ctrl + Shift + R**

### 5. Verificar que los cambios se cargaron

Abre la consola del navegador (F12 → pestaña Console) y busca este mensaje durante la carga inicial:

```
[BacktestingApp] 🎯 tradeBoxMapRef inicializado
```

Si ves ese mensaje, significa que el código nuevo se cargó correctamente.

### 6. Ejecutar un trade de prueba

1. Abre un trade (market o limit) con SL y TP configurados
2. Espera a que se ejecute (si es limit)
3. **BUSCA ESTOS MENSAJES EN LA CONSOLA:**
   ```
   [BacktestingApp] TP/SL box XXXXX asociada a trade #N
   ```

4. Cierra el trade
5. **BUSCA ESTOS MENSAJES EN LA CONSOLA:**
   ```
   [BacktestingApp] 🔍 Buscando box para extender: { tradeId: ..., boxId: ..., ... }
   [BacktestingApp] 📞 Llamando a extendTPSLBox con boxId=...
   [MiniChart BTCUSDT 15] 🔍 Intentando extender TP/SL box: { ... }
   [MiniChart BTCUSDT 15] ✅ Box encontrado: { ... }
   [MiniChart BTCUSDT 15] ✅ TP/SL box XXXXX extendido hasta ...
   ```

### 7. Si TODAVÍA no aparecen los mensajes

Entonces hay un error de JavaScript que está bloqueando la ejecución. En ese caso:

1. Ve a DevTools → pestaña Console
2. Busca mensajes de error en **ROJO**
3. Copia TODOS los errores que aparezcan
4. Guárdalos en un archivo `errores_javascript.txt`
5. Envíame ese archivo

## Resumen Visual

```
┌─────────────────────────────────────┐
│ 1. Ctrl+C en terminal (detener)    │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 2. Borrar caché Vite                │
│    rmdir /s /q node_modules\.vite   │
│    rmdir /s /q dist                 │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 3. npm run dev (reiniciar)          │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 4. Ctrl+Shift+R en navegador        │
│    (Hard Reload)                    │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│ 5. Ejecutar trade y verificar logs │
└─────────────────────────────────────┘
```

## ¿Por qué es necesario esto?

Los navegadores modernos (Chrome, Edge, Firefox) cachean agresivamente los archivos JavaScript para mejorar el rendimiento. Cuando hacemos cambios en el código React:

1. **Vite** compila los cambios → genera nuevo JavaScript
2. **Pero** el navegador sigue usando el JavaScript viejo del caché
3. Un **Hard Reload** fuerza al navegador a descargar la versión nueva

---

## Cambios Implementados (para referencia)

### Archivos modificados:
1. **`frontend/src/components/MiniChart.jsx`** (líneas 342-405)
   - Método `extendTPSLBox` agregado al `useImperativeHandle`

2. **`frontend/src/components/backtesting/BacktestingApp.jsx`**
   - Línea 212: `tradeBoxMapRef` para mapear tradeId → boxId
   - Líneas 856-873: Captura boxId en callback `onOrderExecuted` (limit orders)
   - Líneas 890-918: Lógica de extensión en evento `tradeClosed`
   - Líneas 2348-2364: Captura boxId en callback `onOrderCreated` (market orders)

### Funcionalidad esperada:
Cuando un trade se cierra, la caja TP/SL debe extenderse automáticamente desde el timestamp de apertura hasta el timestamp de cierre, en lugar de mantener un ancho fijo de 5 velas.
