# Cambio de Puertos - Backtester

## ✅ PUERTOS ACTUALIZADOS

Para evitar conflictos con otras aplicaciones, los puertos han sido cambiados:

| Servicio | Puerto Anterior | Puerto Nuevo |
|----------|----------------|--------------|
| Backend  | 8000           | **9000** ✅  |
| Frontend | 5173           | **9001** ✅  |

---

## 🚀 CÓMO INICIAR LA APLICACIÓN

### Terminal 1 - Backend:
```bash
cd WatchlistConIndicadores/backend
python -m uvicorn main:app --reload --port 9000
```

### Terminal 2 - Frontend:
```bash
cd WatchlistConIndicadores/frontend
npm run dev
```

### Abrir en navegador:
```
http://localhost:9001
```

---

## 📝 ARCHIVOS MODIFICADOS

✅ `frontend/src/config.js` - API_BASE_URL actualizado a puerto 9000
✅ `frontend/vite.config.js` - Puerto del servidor cambiado a 9001 y proxy a 9000
✅ Toda la documentación actualizada (ENTREGA_FINAL.md, GUIA_RAPIDA_ZOOM.md, etc.)
✅ `para iniciar servidores.txt` actualizado

---

## ✅ ESTADO ACTUAL

**Servidores ya están corriendo:**
- ✅ Backend: http://localhost:9000
- ✅ Frontend: http://localhost:9001

**Todo funcionando correctamente con los nuevos puertos.**

---

## 📌 NOTA IMPORTANTE

Si necesitas cambiar los puertos en el futuro, modifica estos archivos:

1. **Backend (puerto 9000):**
   - Comando al iniciar: `--port 9000`

2. **Frontend (puerto 9001):**
   - `frontend/vite.config.js` → línea 7: `port: 9001`
   - `frontend/vite.config.js` → línea 10: `target: "http://127.0.0.1:9000"`
   - `frontend/src/config.js` → `API_BASE_URL = "http://localhost:9000"`

---

**Fecha:** 21 de Noviembre de 2025
**Estado:** ✅ Completado y verificado
