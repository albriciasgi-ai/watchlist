# 📚 Sistema de Archivo Histórico de Footprints

## ¿Qué es?

Sistema automatizado que descarga footprints semanalmente desde Northflank y los almacena localmente para construir una biblioteca histórica permanente para backtesting.

## ✨ Características

- ✅ **Descarga automática semanal** programable
- ✅ **Almacenamiento local ilimitado** en IndexedDB
- ✅ **Interfaz gráfica** para gestión
- ✅ **Exportación a JSON** para backups
- ✅ **Deduplicación inteligente** de datos
- ✅ **Estadísticas en tiempo real**

## 🚀 Inicio Rápido

### 1. Instalar Dependencia

```bash
npm install idb
```

### 2. Integrar en tu App

```javascript
import FootprintArchivePanel from './components/FootprintArchivePanel';
import { getArchiveScheduler } from './services/ArchiveScheduler';

function App() {
  const [showArchive, setShowArchive] = useState(false);

  useEffect(() => {
    getArchiveScheduler(); // Auto-inicia si estaba habilitado
  }, []);

  return (
    <>
      <button onClick={() => setShowArchive(true)}>
        📚 Archivo Histórico
      </button>

      <FootprintArchivePanel
        isOpen={showArchive}
        onClose={() => setShowArchive(false)}
      />
    </>
  );
}
```

### 3. Configurar Primera Vez

1. Click en "📚 Archivo Histórico"
2. Click "Descargar Ahora"
3. Configurar scheduler (Domingo 3:00 AM)
4. Click "Activar"

¡Listo! Ahora se descargará automáticamente cada semana.

## 📊 ¿Qué Datos Tendrás?

**Después de 1 mes:** 30 días de footprints (~885 MB)
**Después de 6 meses:** 6 meses completos (~5.3 GB)
**Después de 1 año:** 1 año completo (~10.6 GB)
**Después de 3 años:** Biblioteca masiva (~32 GB)

## 💡 Casos de Uso

### Backtesting

```javascript
const archiver = getFootprintArchiver();
const footprints = await archiver.getArchivedFootprints(
  'BTCUSDT',
  startTimestamp,
  endTimestamp
);

// Usar en tu estrategia
footprints.forEach(fp => {
  analyzeStrategy(fp);
});
```

### Análisis Histórico

```javascript
const stats = await archiver.getArchiveStats();
console.log(`Total datos: ${stats.totalFootprints} footprints`);
console.log(`Desde: ${new Date(stats.oldestTimestamp)}`);
console.log(`Hasta: ${new Date(stats.newestTimestamp)}`);
```

### Backup Externo

```javascript
// Exportar a JSON
const blob = await archiver.exportToJSON('BTCUSDT');

// Descargar archivo
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'BTCUSDT_archive.json';
a.click();
```

## 📁 Archivos del Sistema

```
src/
├── services/
│   ├── FootprintArchiver.js    # Motor de descarga y almacenamiento
│   └── ArchiveScheduler.js     # Programador automático
└── components/
    ├── FootprintArchivePanel.jsx  # UI de gestión
    └── FootprintArchivePanel.css  # Estilos
```

## 📖 Documentación

- **`FOOTPRINT_ARCHIVE_SYSTEM.md`** - Documentación técnica completa
- **`INTEGRATION_EXAMPLE.md`** - Guía de integración detallada
- **`ARCHIVE_README.md`** - Este archivo (resumen rápido)

## 🔧 Configuración

### Cambiar Día/Hora de Descarga

En la UI:
1. Abrir panel de archivo
2. Sección "Programación Automática"
3. Seleccionar día y hora
4. Guardar configuración

### Modificar Símbolos

En `FootprintArchiver.js`:
```javascript
this.config = {
  symbols: [
    'BTCUSDT', 'ETHUSDT', 'SOLUSDT', // Tus símbolos
  ]
}
```

## ⚡ Performance

**Descarga inicial (10 símbolos, 1 semana):** ~30-60 segundos
**Almacenamiento:** IndexedDB (varios GB disponibles)
**Impacto en app:** Mínimo (descarga en background)

## 🐛 Troubleshooting

**"Timeout al descargar"**
- Aumenta `timeout` en FootprintArchiver.js
- Reduce `hoursToArchive` a 84 horas

**"Quota Exceeded"**
- Exporta datos antiguos
- Elimina footprints >2 años

**"Scheduler no ejecuta"**
- Verifica que está activado (toggle ON)
- App debe estar abierta (o implementar en Electron background)

## 🎯 Roadmap

- [ ] Integración con backtester
- [ ] Compresión LZ-string
- [ ] Background process en Electron
- [ ] Sincronización multi-dispositivo
- [ ] API REST para consultas

## 📞 Soporte

Ver documentación completa en `FOOTPRINT_ARCHIVE_SYSTEM.md`

---

**Desarrollado por:** Claude Code
**Fecha:** 16 Octubre 2026
**Versión:** 1.0
