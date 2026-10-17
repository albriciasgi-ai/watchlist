# GUÍA DE INTEGRACIÓN: SISTEMA DE ARCHIVO DE FOOTPRINTS

## 🚀 Integración Rápida (5 minutos)

### Paso 1: Agregar Botón en la UI

En tu archivo `SingleSymbolAnalyzer.jsx` (o donde quieras el botón):

```javascript
import React, { useState, useEffect } from 'react';
import FootprintArchivePanel from './components/FootprintArchivePanel';
import { getArchiveScheduler } from './services/ArchiveScheduler';

function SingleSymbolAnalyzer() {
  const [showArchivePanel, setShowArchivePanel] = useState(false);

  // Iniciar scheduler al montar el componente
  useEffect(() => {
    const scheduler = getArchiveScheduler();
    // El scheduler se auto-inicia si estaba habilitado previamente
  }, []);

  return (
    <div className="app">
      {/* Tu UI existente */}

      {/* Botón para abrir panel de archivo */}
      <button
        onClick={() => setShowArchivePanel(true)}
        style={{
          position: 'fixed',
          bottom: '20px',
          right: '20px',
          padding: '12px 20px',
          background: '#4CAF50',
          color: 'white',
          border: 'none',
          borderRadius: '6px',
          cursor: 'pointer',
          fontSize: '14px',
          fontWeight: '500',
          boxShadow: '0 2px 10px rgba(0,0,0,0.3)',
          zIndex: 1000
        }}
      >
        📚 Archivo Histórico
      </button>

      {/* Panel modal */}
      <FootprintArchivePanel
        isOpen={showArchivePanel}
        onClose={() => setShowArchivePanel(false)}
      />
    </div>
  );
}
```

### Paso 2: Instalar Dependencia

El sistema usa `idb` (IndexedDB wrapper). Si no está instalado:

```bash
npm install idb
```

### Paso 3: Probar

1. Inicia la aplicación
2. Click en "📚 Archivo Histórico"
3. Click en "Descargar Ahora"
4. Espera ~30-60 segundos
5. Ve las estadísticas actualizadas

---

## 📋 Configuración Inicial Recomendada

### 1. Primera Vez

**En el panel de archivo:**

1. **Descargar datos iniciales:**
   - Click "Descargar Ahora (Última Semana)"
   - Espera a que complete

2. **Configurar scheduler:**
   - Día: Domingo (o el que prefieras)
   - Hora: 3 (3:00 AM)
   - Período: 1 semana (168 horas)
   - Click "Guardar Configuración"

3. **Activar scheduler:**
   - Click en "Activar"
   - Verificar que dice "Próxima ejecución: ..."

### 2. Verificación

En la consola del navegador:

```javascript
// Ver estadísticas
const archiver = getFootprintArchiver();
const stats = await archiver.getArchiveStats();
console.log(stats);

// Ver estado del scheduler
const scheduler = getArchiveScheduler();
console.log(scheduler.getStatus());
```

---

## 🔗 Integración con Backtesting (Futura)

### Obtener Datos para Backtesting

```javascript
import { getFootprintArchiver } from './services/FootprintArchiver';

async function runBacktest(symbol, startDate, endDate) {
  const archiver = getFootprintArchiver();

  // Obtener footprints del rango de fechas
  const footprints = await archiver.getArchivedFootprints(
    symbol,
    startDate.getTime(),
    endDate.getTime()
  );

  console.log(`Footprints para backtesting: ${footprints.length}`);

  // Aquí irá tu lógica de backtesting
  footprints.forEach(fp => {
    // Analizar niveles, volumen, delta, POC, etc.
    const poc = fp.poc_price;
    const delta = fp.total_delta;
    const levels = fp.levels;

    // Tu estrategia aquí
  });
}

// Ejemplo de uso
const startDate = new Date('2026-09-01');
const endDate = new Date('2026-10-01');

runBacktest('BTCUSDT', startDate, endDate);
```

### Estructura de Footprint

Cada footprint tiene esta estructura:

```javascript
{
  candle_timestamp: 1697500800000,
  symbol: "BTCUSDT",
  interval: "1",
  candle_open: 27450.5,
  candle_high: 27480.0,
  candle_low: 27440.0,
  candle_close: 27465.5,
  step_size: 10.0,
  levels: [
    {
      price_min: 27440.0,
      price_max: 27450.0,
      price_mid: 27445.0,
      bid_volume: 12.5,
      ask_volume: 8.3,
      delta: -4.2,
      total_volume: 20.8,
      trade_count: 45
    },
    // ... más niveles
  ],
  num_levels: 15,
  poc_index: 7,
  poc_price: 27465.0,
  total_delta: -15.6,
  total_volume: 245.8,
  trade_count: 678,
  estimated: false
}
```

---

## 🎨 Personalización de la UI

### Cambiar Posición del Botón

```javascript
<button
  style={{
    position: 'fixed',
    top: '20px',        // Cambiar a top
    right: '20px',
    // ... resto de estilos
  }}
>
  📚 Archivo Histórico
</button>
```

### Integrar en Barra de Herramientas Existente

Si ya tienes una toolbar:

```javascript
<div className="toolbar">
  <button onClick={handleSomeAction}>Acción 1</button>
  <button onClick={handleSomeAction}>Acción 2</button>

  {/* Agregar aquí */}
  <button onClick={() => setShowArchivePanel(true)}>
    📚 Archivo
  </button>
</div>
```

### Customizar Símbolos

En `FootprintArchiver.js`, línea 12:

```javascript
this.config = {
  symbols: [
    'BTCUSDT',   // Tus símbolos favoritos
    'ETHUSDT',
    'SOLUSDT',
    // Agregar o quitar según necesites
  ],
  interval: '1',
  maxHoursPerRequest: 168,
  timeout: 120000,
};
```

---

## ⚡ Optimizaciones

### Reducir Tiempo de Descarga

Si las descargas son muy lentas, reduce el número de símbolos:

```javascript
// En vez de 21 símbolos, solo 5
symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'BNBUSDT']
```

O reduce el período:

```javascript
// En vez de 168 horas (1 semana), solo 84 (3.5 días)
hoursToArchive: 84
```

### Notificaciones Desktop

Para recibir notificaciones cuando complete, habilita permisos:

```javascript
// Al iniciar la app
if (window.Notification && Notification.permission === 'default') {
  Notification.requestPermission();
}
```

Las notificaciones se mostrarán automáticamente al completar una descarga automática.

---

## 🧪 Testing

### Test Manual

1. **Abrir DevTools** (F12)
2. **Ir a Application > IndexedDB**
3. **Buscar** `FootprintArchive`
4. **Verificar** que hay datos en:
   - `footprints`
   - `metadata`
   - `config`

### Test de Descarga

```javascript
// En consola del navegador
const archiver = getFootprintArchiver();

// Test con un símbolo
const result = await archiver.archiveSymbol('BTCUSDT', 24);
console.log(result);

// Verificar que se guardó
const footprints = await archiver.getArchivedFootprints('BTCUSDT');
console.log(`Footprints guardados: ${footprints.length}`);
```

### Test de Scheduler

```javascript
const scheduler = getArchiveScheduler();

// Configurar para ejecutar en 1 minuto
const now = new Date();
scheduler.configure({
  dayOfWeek: now.getDay(),
  hour: now.getHours(),
  minute: now.getMinutes() + 1
});

scheduler.start();

// Esperar 1 minuto y verificar logs
```

---

## 📊 Monitoreo y Logs

### Logs en Consola

El sistema genera logs automáticos:

```
[FootprintArchiver] IndexedDB inicializada
[FootprintArchiver] Descargando BTCUSDT: 168 horas desde cloud...
[FootprintArchiver] BTCUSDT: 720 footprints descargados
[FootprintArchiver] BTCUSDT: +650 nuevos, ~50 actualizados, =20 sin cambios
[FootprintArchiver] ✅ Archivo completado en 45.3s
[ArchiveScheduler] ✅ Scheduler iniciado
[ArchiveScheduler] Próxima ejecución: 22/10/2026, 3:00:00
```

### Verificar Tamaño de IndexedDB

En Chrome DevTools:

1. F12 > Application
2. Storage > IndexedDB > FootprintArchive
3. Ver tamaño total en la parte inferior

---

## 🔧 Troubleshooting Común

### "idb is not defined"

**Solución:**
```bash
npm install idb
```

### "Cannot read property 'objectStore' of null"

**Causa:** IndexedDB no inicializada

**Solución:** Espera a que se inicialice:
```javascript
const archiver = getFootprintArchiver();
await new Promise(resolve => setTimeout(resolve, 100));
// Ahora usar archiver
```

### "Quota Exceeded Error"

**Causa:** IndexedDB llena

**Solución:**
```javascript
// Limpiar datos viejos
const oneYearAgo = Date.now() - (365 * 24 * 60 * 60 * 1000);
await archiver.deleteOldFootprints(null, oneYearAgo);
```

---

## 📱 Uso en Producción

### Recomendaciones

1. **Backup Semanal:**
   - Exporta símbolos principales cada semana
   - Guarda en Google Drive / Dropbox

2. **Monitoreo:**
   - Verifica que scheduler ejecute correctamente
   - Revisa logs después de cada ejecución automática

3. **Limpieza:**
   - Elimina datos >2 años cada 6 meses
   - Mantén solo símbolos que uses activamente

4. **Performance:**
   - No descargues más de 21 símbolos simultáneamente
   - Usa período de 1 semana (168 horas) máximo

---

## ✅ Checklist de Integración

- [ ] Archivos copiados a proyecto
- [ ] Dependencia `idb` instalada
- [ ] Botón agregado en UI
- [ ] Scheduler iniciado en `useEffect`
- [ ] Primera descarga manual exitosa
- [ ] Scheduler configurado y activado
- [ ] Verificado en IndexedDB
- [ ] Notificaciones habilitadas (opcional)
- [ ] Backup externo configurado (opcional)

---

**¿Necesitas ayuda?** Revisa `FOOTPRINT_ARCHIVE_SYSTEM.md` para documentación completa.
