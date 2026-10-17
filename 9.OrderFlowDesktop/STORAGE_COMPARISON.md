# ⚖️ COMPARACIÓN: IndexedDB vs Electron File System

## 🎯 Tu Pregunta

> "Si se borra el caché, ¿se perdería la info?"

**Respuesta corta:** Con IndexedDB, **depende**. Con Electron File System, **NO**.

---

## 📊 Tabla Comparativa

| Aspecto | IndexedDB | Electron File System |
|---------|-----------|----------------------|
| **Persistencia básica** | ✅ Sobrevive al cerrar app | ✅ Sobrevive al cerrar app |
| **Borrar caché browser** | ✅ NO se borra (solo caché) | ✅ NO se borra |
| **Borrar "datos de sitios"** | ❌ SÍ se borra | ✅ NO se borra |
| **Desinstalar app** | ❌ SÍ se borra | ✅ NO se borra* |
| **Reinstalar app** | ❌ Datos perdidos | ✅ Datos intactos |
| **Capacidad** | ~Varios GB (límite navegador) | ✅ Ilimitado (disco duro) |
| **Acceso directo** | ❌ Solo vía código | ✅ Archivos .json visibles |
| **Backup manual** | ❌ Difícil | ✅ Copiar carpeta |
| **Portabilidad** | ❌ Solo en esa instalación | ✅ Copiar entre PCs |
| **Velocidad lectura** | 🟡 Rápida (índices) | 🟡 Rápida (cache OS) |
| **Velocidad escritura** | 🟡 Rápida (batch) | 🟢 Muy rápida |
| **Inspección en DevTools** | ✅ Sí (F12 > Application) | ❌ No |
| **Edición manual** | ❌ No | ✅ Sí (editor de texto) |

\* Con `userData`, persiste en `%APPDATA%` incluso después de desinstalar

---

## 🔍 Detalles de Cada Opción

### Opción 1: IndexedDB (Original)

**Ubicación de datos:**
```
Windows: C:\Users\USERNAME\AppData\Local\Chromium\User Data\Default\IndexedDB\
macOS: ~/Library/Application Support/Chromium/Default/IndexedDB/
Linux: ~/.config/Chromium/Default/IndexedDB/
```

**Pros:**
- ✅ No requiere permisos de archivo
- ✅ API estándar web (funciona en navegador también)
- ✅ Consultas rápidas con índices
- ✅ Transacciones atómicas

**Contras:**
- ❌ Se puede borrar si usuario limpia "datos de sitios web"
- ❌ Límite de capacidad (navegador decide)
- ❌ Se pierde al desinstalar la app
- ❌ No es portable entre instalaciones

**Casos donde se PIERDE:**
1. Usuario borra "Cookies y datos del sitio" en Chrome
2. Usuario usa herramientas de limpieza (CCleaner, etc)
3. Usuario desinstala la aplicación
4. Usuario borra manualmente carpeta de Chromium

---

### Opción 2: Electron File System (Recomendado)

**Ubicación de datos:**
```
Windows: C:\Users\USERNAME\AppData\Roaming\Order Flow Desktop\footprint_archive\
macOS: ~/Library/Application Support/Order Flow Desktop/footprint_archive/
Linux: ~/.config/Order Flow Desktop/footprint_archive/
```

**Pros:**
- ✅ **Persistencia garantizada** (no se borra con caché)
- ✅ **Sobrevive a desinstalación** (archivos en %APPDATA%)
- ✅ **Sin límites de capacidad** (solo espacio en disco)
- ✅ **Backup fácil** (copiar carpeta)
- ✅ **Portable** (copiar entre PCs)
- ✅ **Editable manualmente** (JSON legible)
- ✅ **Inspección directa** (abrir archivos)

**Contras:**
- 🟡 Requiere API de Electron (ya implementada)
- 🟡 Sin inspección en DevTools (pero puedes abrir archivos)

**Casos donde se PIERDE:**
- ❌ **SOLO si usuario elimina manualmente la carpeta** `%APPDATA%\Order Flow Desktop`

---

## 💾 Estructura de Archivos (Opción 2)

### Carpeta de Almacenamiento

```
C:\Users\TU_USUARIO\AppData\Roaming\Order Flow Desktop\
└── footprint_archive\
    ├── BTCUSDT_1.json        (~42 MB por mes)
    ├── ETHUSDT_1.json        (~42 MB por mes)
    ├── SOLUSDT_1.json        (~42 MB por mes)
    ├── XRPUSDT_1.json        (~42 MB por mes)
    └── ... (21 símbolos total)
```

### Formato de Archivo JSON

```json
{
  "symbol": "BTCUSDT",
  "interval": "1",
  "count": 43200,
  "oldestTimestamp": 1694908800000,
  "newestTimestamp": 1697500800000,
  "lastUpdated": 1697500800000,
  "footprints": [
    {
      "candle_timestamp": 1694908800000,
      "symbol": "BTCUSDT",
      "interval": "1",
      "candle_open": 27450.5,
      "candle_high": 27480.0,
      "candle_low": 27440.0,
      "candle_close": 27465.5,
      "step_size": 10.0,
      "levels": [...],
      "poc_price": 27465.0,
      "total_delta": -15.6,
      "total_volume": 245.8,
      "trade_count": 678
    },
    // ... miles de footprints más
  ]
}
```

---

## 🚀 Archivos Creados

### Versión IndexedDB (Original)
- ✅ `FootprintArchiver.js` - Usa IndexedDB

### Versión Electron (Nueva - Recomendada)
- ✅ `FootprintArchiverElectron.js` - Usa File System
- ✅ `electron/preload.js` - APIs de archivo actualizadas
- ✅ `electron/main.js` - IPC handlers agregados

---

## 📋 Recomendación Final

### 👉 USA LA VERSIÓN ELECTRON (File System)

**Razones:**

1. **Persistencia Garantizada**
   - Los datos **NO se pierden** con limpieza de caché
   - **Sobreviven** a desinstalación/reinstalación

2. **Sin Límites de Capacidad**
   - Puedes almacenar **años** de datos
   - Solo limitado por espacio en disco

3. **Backup Trivial**
   - Solo copia `%APPDATA%\Order Flow Desktop\footprint_archive`
   - Pega en otra PC y listo

4. **Debugging Fácil**
   - Abre archivos .json con editor de texto
   - Inspecciona datos directamente

5. **Profesional**
   - Todas las apps de escritorio serias usan File System
   - No IndexedDB (es para apps web)

---

## 🔄 Migración de IndexedDB a File System

Si ya tienes datos en IndexedDB y quieres migrarlos:

```javascript
// 1. Exportar desde IndexedDB
const oldArchiver = getFootprintArchiver(); // versión IndexedDB
const symbols = ['BTCUSDT', 'ETHUSDT', ...];

for (const symbol of symbols) {
  const footprints = await oldArchiver.getArchivedFootprints(symbol);

  // 2. Guardar en File System
  const newArchiver = getFootprintArchiverElectron(); // versión nueva
  await newArchiver._writeToFile(symbol, footprints);
}
```

---

## ✅ Checklist de Implementación

### Para usar Electron File System:

- [ ] Reemplazar `import { getFootprintArchiver } from './FootprintArchiver'`
- [ ] Por `import { getFootprintArchiver } from './FootprintArchiverElectron'`
- [ ] Verificar que `electron/preload.js` está actualizado
- [ ] Verificar que `electron/main.js` tiene IPC handlers
- [ ] Reiniciar app en modo desarrollo
- [ ] Probar descarga manual
- [ ] Verificar archivos en `%APPDATA%\Order Flow Desktop\footprint_archive`
- [ ] Configurar scheduler semanal
- [ ] (Opcional) Migrar datos de IndexedDB

---

## 🔧 Acceso a Carpeta de Datos

### Desde la UI

Agrega un botón en el `FootprintArchivePanel`:

```javascript
<button onClick={async () => {
  const archiver = getFootprintArchiver();
  await archiver.openStorageFolder();
}}>
  📁 Abrir Carpeta de Datos
</button>
```

### Desde Explorador de Windows

1. Presiona `Win + R`
2. Escribe: `%APPDATA%\Order Flow Desktop`
3. Enter
4. Abre carpeta `footprint_archive`

---

## 📈 Comparación de Capacidad Real

### IndexedDB
- **Límite típico:** ~5-10 GB (Chrome)
- **Datos 1 año (21 símbolos):** ~10.6 GB
- **Resultado:** ⚠️ Justo cabe (en el límite)

### Electron File System
- **Límite:** Espacio en disco
- **Datos 1 año (21 símbolos):** ~10.6 GB
- **Datos 5 años (21 símbolos):** ~53 GB
- **Resultado:** ✅ Sin problemas

---

## 💡 Conclusión

Para tu caso de uso (biblioteca histórica para backtesting):

**DEBES usar Electron File System** porque:

1. ✅ Necesitas años de datos (IndexedDB es limitado)
2. ✅ No puedes arriesgarte a perder datos (IndexedDB se puede borrar)
3. ✅ Quieres backups fáciles (File System = copiar carpeta)
4. ✅ Es una app de escritorio (File System es el estándar)

---

**Recomendación final:** Usa `FootprintArchiverElectron.js` y duerme tranquilo sabiendo que tus datos están seguros.
