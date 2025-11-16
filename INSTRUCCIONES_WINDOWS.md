# 🚨 INSTRUCCIONES PARA WINDOWS (PowerShell)

## ⚠️ IMPORTANTE: Estás en Windows PowerShell
Los comandos que te di antes eran para Linux/Mac. Aquí están los comandos correctos para Windows:

---

## ✅ SOLUCIÓN PASO A PASO (WINDOWS):

### 1️⃣ DETENER AMBOS PROCESOS
- Ve a las terminales donde corren backend y frontend
- Presiona `Ctrl+C` en AMBAS

### 2️⃣ LIMPIAR CACHÉ DE VITE (PowerShell)

```powershell
# Ve a la carpeta frontend:
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores\frontend

# Eliminar caché de Vite (COMANDOS DE POWERSHELL):
Remove-Item -Path ".vite" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "dist" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "node_modules\.vite" -Recurse -Force -ErrorAction SilentlyContinue

# Verificar que se eliminaron:
Get-ChildItem -Force
```

**Alternativa si da error:**
```powershell
# Eliminar manualmente en el Explorador de Windows:
# 1. Abre: C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores\frontend
# 2. Elimina las carpetas: .vite y dist (si existen)
# 3. Muestra archivos ocultos (Ver → Elementos ocultos)
```

### 3️⃣ REINICIAR BACKEND

```powershell
# Nueva terminal PowerShell:
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores\backend
python -m uvicorn main:app --reload --port 8000
```

**Verifica en los logs del backend:**
```
[OI CALCULATION] interval_final=...
[OI CALCULATION] ... días × 24h × 60min / ... min = ...
```

### 4️⃣ REINICIAR FRONTEND

```powershell
# Nueva terminal PowerShell:
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores\frontend
npm run dev
```

### 5️⃣ ABRIR NAVEGADOR EN MODO INCÓGNITO

**Chrome:**
- `Ctrl + Shift + N` (ventana incógnita)

**Edge:**
- `Ctrl + Shift + P` (ventana InPrivate)

**Firefox:**
- `Ctrl + Shift + P` (ventana privada)

Luego ve a: `http://localhost:5173` (o el puerto que muestre Vite)

### 6️⃣ VERIFICAR EN CONSOLA

1. Presiona `F12` para abrir DevTools
2. Ve a la pestaña "Console"
3. Busca este mensaje con **fondo azul**:

```
[OpenInterestIndicator] VERSION 2.0 LOADED - Azul/Naranja colors + Fullscreen selector
```

---

## 🔍 SI NO APARECE EL SELECTOR DE OPEN INTEREST:

### Opción A - Verificar errores en consola:

1. Abre DevTools (F12)
2. Ve a "Console"
3. Busca mensajes en **ROJO** (errores)
4. Copia TODO el contenido de la consola y mándamelo

### Opción B - Verificar que el checkbox existe:

En la consola del navegador (F12), ejecuta este comando:

```javascript
console.log("Checkbox OI:", document.querySelector('input[type="checkbox"]'));
console.log("All checkboxes:", document.querySelectorAll('input[type="checkbox"]').length);
```

Mándame lo que muestre.

---

## 📸 ALTERNATIVA - CAPTURA DE PANTALLA:

Si es más fácil, mándame screenshots de:

1. **La app completa** (para ver si hay selector o no)
2. **Consola del navegador** (F12 → Console tab)
3. **Terminal del frontend** (donde corre `npm run dev`)

---

## 🆘 SI SIGUE FALLANDO:

### Opción 1 - Reinstalar dependencias completo:

```powershell
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores\frontend

# Eliminar node_modules completo:
Remove-Item -Path "node_modules" -Recurse -Force
Remove-Item -Path "package-lock.json" -Force -ErrorAction SilentlyContinue

# Reinstalar:
npm install

# Ejecutar:
npm run dev
```

### Opción 2 - Verificar estado del repositorio:

```powershell
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist

# Verificar commits:
git log --oneline -3

# Verificar cambios locales:
git status

# Si hay cambios sin commitear, puedes resetear:
git reset --hard HEAD
```

---

## ⚡ COMANDO RÁPIDO (TODO EN UNO):

Si quieres hacerlo todo de una vez:

```powershell
# Detén backend y frontend primero (Ctrl+C), luego:

# Limpiar y reiniciar:
cd C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores

# Limpiar frontend:
Remove-Item -Path "frontend\.vite" -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -Path "frontend\dist" -Recurse -Force -ErrorAction SilentlyContinue

# Abrir 2 terminales PowerShell:

# Terminal 1 - Backend:
cd backend
python -m uvicorn main:app --reload --port 8000

# Terminal 2 - Frontend:
cd frontend
npm run dev
```

Luego abre modo incógnito y ve a localhost:5173

---

**Mándame el resultado que veas en la consola o cualquier error.**
