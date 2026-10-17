# ✅ INTEGRACIÓN FOOTPRINT ARCHIVER - COMPLETADA

## 📋 Resumen

Se integró el sistema de archivo histórico de footprints en la aplicación OrderFlowDesktop utilizando almacenamiento en File System de Electron (persistencia garantizada).

---

## 🔧 Cambios Realizados

### 1. **FootprintArchiverElectron.js** - Adaptado para Browser

**Archivo:** `src/services/FootprintArchiverElectron.js`

**Cambios:**
- ✅ Eliminada dependencia de `import path from 'path'` (no disponible en browser)
- ✅ Eliminada dependencia de `import { openDB } from 'idb'` (IndexedDB no se usa)
- ✅ Cambio de `path.join()` por concatenación de strings con `/`
- ✅ Configuración simplificada (solo File System, sin IndexedDB)

**Antes:**
```javascript
import { openDB } from 'idb';
import path from 'path';

this.storageDir = path.join(userDataPath, 'footprint_archive');
```

**Después:**
```javascript
// Sin imports de Node.js

this.storageDir = userDataPath + '/footprint_archive';
```

---

### 2. **FootprintArchivePanel.jsx** - Actualizado Import

**Archivo:** `src/components/FootprintArchivePanel.jsx`

**Cambio:**
```javascript
// ANTES
import { getFootprintArchiver } from '../services/FootprintArchiver';

// DESPUÉS
import { getFootprintArchiver } from '../services/FootprintArchiverElectron';
```

---

### 3. **ArchiveScheduler.js** - Actualizado Import

**Archivo:** `src/services/ArchiveScheduler.js`

**Cambio:**
```javascript
// ANTES
import { getFootprintArchiver } from './FootprintArchiver';

// DESPUÉS
import { getFootprintArchiver } from './FootprintArchiverElectron';
```

---

### 4. **SingleSymbolAnalyzer.jsx** - Agregado Botón y Modal

**Archivo:** `src/components/SingleSymbolAnalyzer.jsx`

**Cambios:**

#### Import
```javascript
import FootprintArchivePanel from "./FootprintArchivePanel";
```

#### Estado
```javascript
const [showFootprintArchive, setShowFootprintArchive] = useState(false);
```

#### Botón en Header
```javascript
<button
  onClick={() => setShowFootprintArchive(true)}
  style={{
    padding: '8px 16px',
    backgroundColor: '#2c3e50',
    color: 'white',
    border: 'none',
    borderRadius: '4px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: 'bold',
    marginLeft: '10px'
  }}
  title="Archivo histórico de footprints"
>
  📚 Archivo
</button>
```

#### Modal
```javascript
{showFootprintArchive && (
  <FootprintArchivePanel
    isOpen={showFootprintArchive}
    onClose={() => setShowFootprintArchive(false)}
  />
)}
```

---

## 📁 Ubicación de Archivos

### Archivo Local (Persistente)

**Path:** `%APPDATA%\Order Flow Desktop\footprint_archive\`

**Ejemplo Windows:**
```
C:\Users\TU_USUARIO\AppData\Roaming\Order Flow Desktop\footprint_archive\
  ├── BTCUSDT_1.json
  ├── ETHUSDT_1.json
  ├── SOLUSDT_1.json
  └── ... (21 símbolos)
```

**Características:**
- ✅ **Persistente**: Sobrevive a reinstalación de la app
- ✅ **Backup fácil**: Copiar carpeta completa
- ✅ **Portable**: Copiar entre PCs
- ✅ **Editable**: Archivos JSON legibles

---

## 🚀 Cómo Usar

### 1. **Acceder al Panel de Archivo**

1. Abrir app OrderFlowDesktop
2. Click en botón **"📚 Archivo"** (arriba a la derecha, después de IntegrityStatus)
3. Se abre el panel de archivo

### 2. **Descarga Manual (Primera Vez)**

1. En el panel, sección **"Descarga Manual"**
2. Click **"Descargar Ahora"**
3. Esperar a que descargue ~10 símbolos (168 horas = 1 semana)
4. Ver progreso en tiempo real
5. Ver estadísticas actualizadas

### 3. **Configurar Scheduler Automático**

1. En el panel, sección **"Programación Automática"**
2. Seleccionar día de la semana (ej: Domingo)
3. Seleccionar hora (ej: 3 AM)
4. Click **"Guardar Configuración"**
5. Toggle **ON** para activar
6. La app descargará automáticamente cada semana

---

## 🧪 Próximos Pasos para Probar

### Test 1: Verificar Electron APIs

```bash
# Iniciar app en modo desarrollo
npm run dev:electron
```

**Verificar en consola:**
```
[FootprintArchiver] Storage dir: C:\Users\...\AppData\Roaming\Order Flow Desktop\footprint_archive
```

Si no aparece el log, significa que `window.electron` no está disponible.

---

### Test 2: Probar Descarga Manual

1. Click "📚 Archivo"
2. Click "Descargar Ahora"
3. Verificar logs en consola:

**Logs Esperados:**
```
[FootprintArchiver] 📥 Archivando BTCUSDT...
[FootprintArchiver] Descargando BTCUSDT: 168 horas desde cloud...
[FootprintArchiver] BTCUSDT: 10080 footprints descargados
[FootprintArchiver] BTCUSDT: guardados 10080 footprints en C:\Users\...\BTCUSDT_1.json
[FootprintArchiver] BTCUSDT: +10080 nuevos, ~0 actualizados, =0 sin cambios
```

**Logs de Error (si cloud no responde):**
```
[FootprintArchiver] Timeout descargando BTCUSDT
```

---

### Test 3: Verificar Archivo en Disco

**Windows:**
```bash
# Abrir Explorer
Win + R
%APPDATA%\Order Flow Desktop
```

**Verificar:**
- Carpeta `footprint_archive` existe
- Archivos `{SYMBOL}_1.json` existen
- Abrir un JSON y verificar estructura:

```json
{
  "symbol": "BTCUSDT",
  "interval": "1",
  "count": 10080,
  "oldestTimestamp": 1739241600000,
  "newestTimestamp": 1739846400000,
  "lastUpdated": 1739847262000,
  "footprints": [
    {
      "candle_timestamp": 1739241600000,
      "symbol": "BTCUSDT",
      "interval": "1",
      "candle_open": 98456.7,
      "levels": [...],
      "total_delta": -4.2,
      "total_volume": 245.8
    }
  ]
}
```

---

## ⚠️ Posibles Errores y Soluciones

### Error 1: "Storage directory no configurado"

**Causa:** `window.electron.getUserDataPath()` no está disponible

**Solución:**
1. Verificar que `electron/preload.js` expone `getUserDataPath`
2. Verificar que `electron/main.js` tiene IPC handler
3. Reiniciar app en modo Electron (no browser)

**Verificación:**
```javascript
// En consola del navegador:
console.log(window.electron);
// Debe mostrar objeto con getUserDataPath, fileExists, etc.
```

---

### Error 2: "Timeout descargando {SYMBOL}"

**Causa:** Cloud Collector en Northflank tarda >120s

**Solución:**
1. Verificar que Northflank está activo:
   ```
   https://p01--altagracia--rxv8nrbhxln9.code.run/health
   ```
2. Aumentar timeout en `FootprintArchiverElectron.js`:
   ```javascript
   this.config = {
     timeout: 180000  // 3 minutos en lugar de 2
   };
   ```

---

### Error 3: "Permission denied" al escribir archivo

**Causa:** Raro, pero puede pasar si %APPDATA% tiene permisos incorrectos

**Solución:**
1. Verificar permisos de `%APPDATA%`
2. Ejecutar app como administrador (solo para debug)

---

## 📊 Capacidad Esperada

**Por Símbolo (interval=1):**
- 1 semana (168h) = ~10,080 footprints = ~10 MB
- 1 mes (720h) = ~43,200 footprints = ~42 MB
- 1 año (8760h) = ~525,600 footprints = ~504 MB

**Total (21 símbolos):**
- 1 semana = ~210 MB
- 1 mes = ~882 MB
- 1 año = ~10.6 GB

**Descarga semanal automática:**
- Después de 1 año: ~10.6 GB
- Después de 3 años: ~32 GB

---

## 🔄 Flujo de Integración con Backend

**IMPORTANTE:** El archiver descarga del **Cloud Collector**, NO del backend local.

```
┌─────────────────────────────────────┐
│ FootprintArchiverElectron.js        │
│ (Frontend - Electron)               │
└───────────────┬─────────────────────┘
                │
                │ GET /api/footprints/{symbol}?hours=168&interval=1
                ▼
┌─────────────────────────────────────┐
│ Cloud Collector (Northflank)        │
│ https://p01--altagracia--...        │
│ /api/footprints/BTCUSDT             │
└───────────────┬─────────────────────┘
                │
                │ Returns JSON
                ▼
┌─────────────────────────────────────┐
│ Archivo Local (File System)         │
│ %APPDATA%\Order Flow Desktop\       │
│ footprint_archive\BTCUSDT_1.json    │
└─────────────────────────────────────┘
```

**NO se integra con:**
- ❌ Backend local (puerto 11000)
- ❌ `orderflow_service.py`
- ❌ `footprint_storage.py` (cache local del backend)

**Es independiente:**
- ✅ Descarga directa desde Cloud
- ✅ Almacena en userData de Electron
- ✅ No afecta el backend local

---

## 📝 Próximas Mejoras (Futuro)

1. **Integración con Backend Local**
   - Que el backend local pueda leer del archivo en userData
   - Endpoint: `GET /api/footprints/archived/{symbol}?from={ts}&to={ts}`

2. **Agregación de Intervalos Mayores**
   - Implementar `_aggregateFootprints()` en `OrderFlowIndicator.js`
   - Agregar 1m → 5m, 15m, etc. en frontend

3. **Compresión**
   - Comprimir archivos JSON con gzip
   - Reducir tamaño en disco (~70% ahorro)

4. **Exportación**
   - Botón para exportar a CSV
   - Botón para backup completo (ZIP)

5. **Sincronización Multi-PC**
   - Google Drive sync
   - Dropbox sync

---

## ✅ Checklist de Integración

- [x] Adaptar FootprintArchiverElectron.js sin dependencias Node.js
- [x] Actualizar imports en FootprintArchivePanel.jsx
- [x] Actualizar imports en ArchiveScheduler.js
- [x] Agregar import en SingleSymbolAnalyzer.jsx
- [x] Agregar estado showFootprintArchive
- [x] Agregar botón "📚 Archivo" en header
- [x] Agregar modal FootprintArchivePanel
- [ ] **Probar en app (PENDING - siguiente paso)**
- [ ] Configurar scheduler semanal
- [ ] Verificar archivos en userData

---

## 🎯 Siguiente Paso

**PROBAR LA INTEGRACIÓN:**

1. Reiniciar app en modo desarrollo:
   ```bash
   npm run dev:electron
   ```

2. Verificar que el botón "📚 Archivo" aparece en el header

3. Click en el botón y verificar que el panel se abre

4. Intentar descarga manual de 1 símbolo

5. Revisar logs en consola

6. Verificar que se creó el archivo en `%APPDATA%\Order Flow Desktop\footprint_archive\`

---

**Fecha:** 16 Octubre 2026
**Versión:** 1.0
**Status:** ✅ Integración completada, pendiente testing
