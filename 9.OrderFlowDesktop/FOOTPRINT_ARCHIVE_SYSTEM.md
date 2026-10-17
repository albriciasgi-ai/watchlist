# SISTEMA DE ARCHIVO HISTÓRICO DE FOOTPRINTS

**Versión:** 1.0
**Fecha:** 16 Octubre 2026
**Aplicación:** 9.OrderFlowDesktop

---

## 📚 Descripción General

Sistema automatizado para descargar, almacenar y gestionar footprints históricos desde el Cloud Collector en Northflank. Permite construir una biblioteca local permanente de datos históricos para backtesting, análisis avanzado y desarrollo de estrategias.

### 🎯 Problema que Resuelve

Northflank tiene capacidad limitada (6 GB = ~6-7 meses de datos) y elimina footprints antiguos automáticamente. Este sistema:

1. ✅ **Descarga automática semanal** de nuevos footprints
2. ✅ **Almacenamiento local ilimitado** en IndexedDB
3. ✅ **Biblioteca histórica permanente** que crece con el tiempo
4. ✅ **Exportación a JSON** para backups externos
5. ✅ **Integración con backtesting** (futura feature)

---

## 🏗️ Arquitectura del Sistema

### Componentes Principales

```
9.OrderFlowDesktop/
├── src/
│   ├── services/
│   │   ├── FootprintArchiver.js      # Servicio de descarga y almacenamiento
│   │   └── ArchiveScheduler.js       # Programador automático
│   └── components/
│       ├── FootprintArchivePanel.jsx # UI de gestión
│       └── FootprintArchivePanel.css # Estilos
```

### Flujo de Datos

```
┌─────────────────────┐
│  Northflank Cloud   │
│  Footprint          │
│  Collector          │
└──────────┬──────────┘
           │ HTTPS API
           │ (weekly download)
           ↓
┌─────────────────────┐
│  FootprintArchiver  │
│  - Download         │
│  - Deduplicate      │
│  - Store            │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  IndexedDB          │
│  "FootprintArchive" │
│  - footprints       │
│  - metadata         │
│  - config           │
└──────────┬──────────┘
           │
           ↓
┌─────────────────────┐
│  Backtesting        │
│  Analysis           │
│  Strategy Dev       │
└─────────────────────┘
```

---

## 📦 FootprintArchiver.js

### Responsabilidades

1. **Descarga de footprints** desde Cloud Collector
2. **Almacenamiento en IndexedDB** con deduplicación
3. **Gestión de metadata** (timestamps, contadores)
4. **Consulta de datos archivados** para backtesting
5. **Exportación a JSON** para backups

### Base de Datos IndexedDB

**Nombre:** `FootprintArchive`
**Versión:** 1

#### Object Stores

**1. footprints**
- **KeyPath:** `['symbol', 'candle_timestamp']`
- **Indices:**
  - `symbol` - Búsqueda por símbolo
  - `timestamp` - Búsqueda por fecha
  - `symbol_timestamp` - Búsqueda combinada (único)
- **Contenido:** Footprints completos con estructura original

**2. metadata**
- **KeyPath:** `id`
- **Contenido:** Metadata de cada símbolo
  ```javascript
  {
    id: "BTCUSDT_archive",
    symbol: "BTCUSDT",
    lastDownload: 1697500800000,
    totalFootprints: 43200,
    lastAdded: 720,
    lastUpdated: 10,
    oldestTimestamp: 1694908800000,
    newestTimestamp: 1697500800000
  }
  ```

**3. config**
- **KeyPath:** `key`
- **Contenido:** Configuración y timestamps de ejecución
  ```javascript
  {
    key: "last_archive_run",
    timestamp: 1697500800000,
    successful: 10,
    failed: 0,
    totalAdded: 7200
  }
  ```

### API Principal

#### `archiveSymbol(symbol, hours = 168)`
Descarga y archiva footprints de un símbolo.

**Parámetros:**
- `symbol` (string) - Símbolo a archivar (ej: "BTCUSDT")
- `hours` (number) - Horas a descargar (default: 168 = 1 semana)

**Retorna:**
```javascript
{
  success: true,
  symbol: "BTCUSDT",
  downloaded: 720,
  added: 650,
  updated: 50,
  skipped: 20,
  oldestTimestamp: 1696896000000,
  newestTimestamp: 1697500800000
}
```

#### `archiveAll(hours = 168, progressCallback = null)`
Descarga todos los símbolos configurados.

**Parámetros:**
- `hours` (number) - Horas a descargar por símbolo
- `progressCallback` (function) - Callback para reportar progreso
  ```javascript
  (progress) => {
    // progress = { symbol, progress, current, total }
  }
  ```

**Retorna:**
```javascript
{
  success: true,
  duration: 45320,  // ms
  successful: 10,
  failed: 0,
  totalDownloaded: 7200,
  totalAdded: 6500,
  results: [...]
}
```

#### `getArchivedFootprints(symbol, fromTimestamp, toTimestamp)`
Obtiene footprints del archivo local.

**Parámetros:**
- `symbol` (string) - Símbolo
- `fromTimestamp` (number) - Timestamp inicial (opcional)
- `toTimestamp` (number) - Timestamp final (opcional)

**Retorna:** `Promise<Array>` - Footprints ordenados

#### `getArchiveStats()`
Obtiene estadísticas del archivo completo.

**Retorna:**
```javascript
{
  symbolsArchived: 10,
  totalFootprints: 172677,
  oldestTimestamp: 1694908800000,
  newestTimestamp: 1697500800000,
  lastRun: { timestamp, successful, failed, totalAdded },
  symbolDetails: [...]
}
```

#### `exportToJSON(symbol, fromTimestamp, toTimestamp)`
Exporta footprints a JSON para backup externo.

**Retorna:** `Promise<Blob>` - Blob con datos JSON

---

## ⏰ ArchiveScheduler.js

### Responsabilidades

1. **Programación automática** de descargas semanales
2. **Gestión de configuración** (día, hora, período)
3. **Ejecución puntual** basada en calendario
4. **Persistencia de estado** en localStorage

### Configuración

```javascript
{
  dayOfWeek: 0,        // 0=Domingo, 1=Lunes, ..., 6=Sábado
  hour: 3,             // Hora del día (0-23)
  minute: 0,           // Minuto de la hora
  hoursToArchive: 168  // Horas a descargar (168 = 1 semana)
}
```

**Default:** Domingos a las 3:00 AM, descargar última semana

### API Principal

#### `start()`
Inicia el scheduler automático.

#### `stop()`
Detiene el scheduler.

#### `configure(newConfig)`
Actualiza configuración.

**Ejemplo:**
```javascript
const scheduler = getArchiveScheduler();

scheduler.configure({
  dayOfWeek: 0,     // Domingo
  hour: 3,          // 3:00 AM
  hoursToArchive: 168  // 1 semana
});

scheduler.start();
```

#### `runNow(hours = null)`
Ejecuta descarga manual inmediata.

#### `getStatus()`
Obtiene estado actual del scheduler.

**Retorna:**
```javascript
{
  enabled: true,
  config: { dayOfWeek, hour, hoursToArchive },
  lastRun: 1697500800000,
  lastRunDate: "16/10/2026, 21:00:00",
  nextRun: 1698105600000,
  nextRunDate: "23/10/2026, 3:00:00",
  daysUntilNextRun: 6
}
```

### Almacenamiento en localStorage

El scheduler persiste automáticamente su estado:

```javascript
localStorage.setItem('archiveSchedulerConfig', JSON.stringify(config));
localStorage.setItem('archiveSchedulerEnabled', 'true');
localStorage.setItem('archiveSchedulerLastRun', timestamp);
```

---

## 🎨 FootprintArchivePanel.jsx

### UI de Gestión

Panel modal con 4 secciones principales:

#### 1. Estadísticas del Archivo
- Total de símbolos archivados
- Total de footprints
- Rango de fechas (más antiguo → más reciente)
- Última descarga realizada

#### 2. Descarga Manual
- Botón "Descargar Ahora"
- Barra de progreso en tiempo real
- Resultado de la última operación

#### 3. Programación Automática
- Toggle ON/OFF del scheduler
- Configuración de día y hora
- Selector de período (1 semana, 2 semanas, 1 mes)
- Botón "Guardar Configuración"
- Información de próxima ejecución

#### 4. Detalles por Símbolo
- Tabla con todos los símbolos
- Footprints por símbolo
- Rangos de fechas
- Botón de exportación individual

### Integración en la App

En `SingleSymbolAnalyzer.jsx` o componente raíz:

```javascript
import FootprintArchivePanel from './components/FootprintArchivePanel';
import { getArchiveScheduler } from './services/ArchiveScheduler';

function App() {
  const [showArchivePanel, setShowArchivePanel] = useState(false);

  useEffect(() => {
    // Iniciar scheduler al cargar la app
    const scheduler = getArchiveScheduler();
    // El scheduler se inicia solo si estaba habilitado previamente
  }, []);

  return (
    <>
      {/* ... resto de la app ... */}

      <button onClick={() => setShowArchivePanel(true)}>
        📚 Archivo Histórico
      </button>

      <FootprintArchivePanel
        isOpen={showArchivePanel}
        onClose={() => setShowArchivePanel(false)}
      />
    </>
  );
}
```

---

## 🚀 Flujo de Uso

### Configuración Inicial

1. **Abrir Panel de Archivo**
   - Click en botón "📚 Archivo Histórico"

2. **Configurar Programación**
   - Seleccionar día de la semana (ej: Domingo)
   - Seleccionar hora (ej: 3:00 AM)
   - Seleccionar período (ej: 1 semana)
   - Click "Guardar Configuración"

3. **Activar Scheduler**
   - Click en "Activar" en la sección de Programación

4. **Primera Descarga Manual** (Opcional)
   - Click en "Descargar Ahora"
   - Esperar a que complete (~30-60 segundos)

### Uso Automático

Una vez configurado:

1. ✅ **Cada semana** (domingo a las 3 AM):
   - Scheduler se ejecuta automáticamente
   - Descarga últimos 7 días de footprints
   - Guarda en IndexedDB
   - Muestra notificación (si la app está abierta)

2. ✅ **Crecimiento del Archivo**:
   - Semana 1: 7 días de datos
   - Semana 2: 14 días de datos
   - Semana 4: 28 días de datos
   - Semana 12: 3 meses de datos
   - Semana 52: 1 año completo de datos

3. ✅ **Backup Externo** (Recomendado mensual):
   - Abrir panel de archivo
   - Click en 💾 junto a cada símbolo
   - Descargar JSON comprimido
   - Guardar en disco externo/cloud

---

## 💾 Gestión de Almacenamiento

### Capacidad de IndexedDB

IndexedDB no tiene límite fijo, depende del espacio disponible en disco:

**Estimaciones:**
- 1 mes de datos (21 símbolos): ~885 MB
- 1 año de datos (21 símbolos): ~10.6 GB
- 3 años de datos (21 símbolos): ~31.8 GB

**Navegadores modernos** permiten varios GB sin problema.

### Limpieza de Datos Antiguos

Para liberar espacio, usar el método `deleteOldFootprints()`:

```javascript
const archiver = getFootprintArchiver();

// Eliminar footprints de BTCUSDT anteriores a 1 año
const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
await archiver.deleteOldFootprints('BTCUSDT', oneYearAgo);

// Eliminar de todos los símbolos
await archiver.deleteOldFootprints(null, oneYearAgo);
```

### Backup y Restauración

**Backup (Exportar):**
```javascript
const archiver = getFootprintArchiver();
const blob = await archiver.exportToJSON('BTCUSDT');

// Descargar archivo
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'BTCUSDT_footprints.json';
a.click();
```

**Restauración (Importar):**
```javascript
// Leer archivo JSON
const file = document.getElementById('fileInput').files[0];
const text = await file.text();
const data = JSON.parse(text);

// Guardar footprints
const archiver = getFootprintArchiver();
await archiver._saveToArchive(data.symbol, data.footprints);
```

---

## 🔧 Configuración Avanzada

### Modificar Símbolos a Archivar

En `FootprintArchiver.js`, línea 12:

```javascript
this.config = {
  symbols: [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT',
    'TRXUSDT', 'DOGEUSDT', 'BNBUSDT', 'AVAXUSDT', 'ARBUSDT'
    // Agregar más símbolos aquí
  ],
  ...
};
```

### Modificar Timeout de Descarga

En `FootprintArchiver.js`, línea 17:

```javascript
timeout: 120000, // 2 minutos (aumentar si timeouts frecuentes)
```

### Modificar Intervalo del Scheduler

En `ArchiveScheduler.js`, línea 164:

```javascript
this.intervalId = setInterval(() => {
  this._tick();
}, 60 * 1000); // 1 minuto (no cambiar)
```

---

## 📊 Métricas y Monitoreo

### Ver Estadísticas

```javascript
const archiver = getFootprintArchiver();
const stats = await archiver.getArchiveStats();

console.log(`Símbolos archivados: ${stats.symbolsArchived}`);
console.log(`Total footprints: ${stats.totalFootprints}`);
console.log(`Desde: ${new Date(stats.oldestTimestamp)}`);
console.log(`Hasta: ${new Date(stats.newestTimestamp)}`);
```

### Ver Estado del Scheduler

```javascript
const scheduler = getArchiveScheduler();
const status = scheduler.getStatus();

console.log(`Scheduler activo: ${status.enabled}`);
console.log(`Próxima ejecución: ${status.nextRunDate}`);
console.log(`Última ejecución: ${status.lastRunDate}`);
```

---

## 🐛 Troubleshooting

### Problema: Descargas Fallan con Timeout

**Síntoma:** Error "Timeout descargando SYMBOL"

**Causa:** Cloud Collector tarda mucho en responder

**Solución:**
1. Aumentar `timeout` en `FootprintArchiver.js`
2. Reducir `hoursToArchive` en config (de 168 a 84 horas)
3. Verificar que Northflank esté activo

### Problema: IndexedDB Llena

**Síntoma:** Error "QuotaExceededError"

**Causa:** Espacio de IndexedDB agotado

**Solución:**
1. Exportar símbolos más antiguos a JSON
2. Eliminar datos antiguos con `deleteOldFootprints()`
3. Aumentar cuota del navegador (Chrome settings)

### Problema: Scheduler No Ejecuta

**Síntoma:** No hay descargas automáticas

**Causa:** Scheduler no está habilitado o app cerrada

**Solución:**
1. Verificar que scheduler está activo (toggle ON)
2. La app debe estar abierta para que funcione
3. Considerar implementar en proceso background (Electron)

### Problema: Datos Duplicados

**Síntoma:** Mismo footprint múltiples veces

**Causa:** Deduplicación falló

**Solución:**
- La deduplicación usa `symbol + candle_timestamp` como key única
- Verificar que footprints tienen `candle_timestamp` correcto
- No debería ocurrir, reportar si sucede

---

## 🔮 Mejoras Futuras

### 1. Integración con Backtesting

Conectar el archivo con el sistema de backtesting:

```javascript
// Obtener datos para backtesting
const archiver = getFootprintArchiver();
const footprints = await archiver.getArchivedFootprints(
  'BTCUSDT',
  startTimestamp,
  endTimestamp
);

// Usar en backtester
runBacktest(footprints, strategy);
```

### 2. Compresión de Datos

Implementar compresión LZ-string para reducir espacio:

```javascript
import LZString from 'lz-string';

// Antes de guardar
const compressed = LZString.compress(JSON.stringify(footprint));

// Al leer
const decompressed = JSON.parse(LZString.decompress(compressed));
```

### 3. Proceso Background en Electron

Mover scheduler a proceso principal de Electron para que corra incluso con app cerrada:

```javascript
// electron/main.js
const scheduler = new ArchiveScheduler();
scheduler.start();

// Ejecutar descarga en background
app.on('window-all-closed', () => {
  // No cerrar app, mantener scheduler corriendo
});
```

### 4. Sincronización Multi-Dispositivo

Sincronizar archivo entre múltiples máquinas:

```javascript
// Exportar cambios
const delta = await archiver.getChanges(lastSyncTimestamp);

// Enviar a servidor/cloud
await uploadDelta(delta);

// Importar en otro dispositivo
await archiver.importDelta(delta);
```

---

## 📝 Changelog

### v1.0 - 16 Octubre 2026
- ✅ Creación inicial del sistema
- ✅ FootprintArchiver con IndexedDB
- ✅ ArchiveScheduler automático
- ✅ UI completa con estadísticas
- ✅ Exportación a JSON
- ✅ Documentación completa

---

## 🙋 FAQ

**Q: ¿Puedo cambiar los símbolos después de iniciar?**
A: Sí, modifica `config.symbols` en FootprintArchiver.js

**Q: ¿Qué pasa si Northflank elimina datos viejos?**
A: Tu archivo local los mantiene permanentemente

**Q: ¿Cuánto espacio ocupará?**
A: ~885 MB/mes para 21 símbolos, ~10.6 GB/año

**Q: ¿Puedo usar los datos para backtesting?**
A: Sí, usa `getArchivedFootprints()` para obtener rangos específicos

**Q: ¿Funciona sin internet?**
A: El scheduler necesita internet, pero consultar el archivo local no

**Q: ¿Pierdo datos si cierro el navegador?**
A: No, IndexedDB persiste incluso después de cerrar

---

**Desarrollado por:** Claude Code
**Fecha:** 16 Octubre 2026
**Versión:** 1.0
