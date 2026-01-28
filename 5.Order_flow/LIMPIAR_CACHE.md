# Limpieza de Cache - Order Flow

## Cuando usar este script

Ejecuta `LIMPIAR_CACHE.bat` cuando:

- Las velas japonesas muestran gaps (faltan velas recientes)
- El Order Flow no muestra footprints aunque el backend tiene datos
- Los indicadores muestran datos desactualizados
- Despues de cambios grandes en la configuracion
- Si la aplicacion se comporta de forma erratica

## Que limpia

### Backend
| Carpeta | Contenido |
|---------|-----------|
| `backend/cache/` | Cache de velas historicas de Bybit |
| `backend/footprint_cache/` | Cache de footprints locales |
| `backend/*.log` | Archivos de log |
| `backend/logs/*.log` | Logs en subcarpeta |

### Frontend (via navegador)
| Base de datos | Contenido |
|---------------|-----------|
| `IndexedDB: CandleCache` | Cache de velas para carga rapida |
| `IndexedDB: IndicatorCache` | Cache de calculos de indicadores |
| `IndexedDB: DrawingCache` | Cache de dibujos (opcional) |
| `localStorage` | Configuraciones de orderflow y cache |

## Instrucciones

1. **Cerrar la aplicacion** (frontend y backend)

2. **Ejecutar el script**
   ```
   Doble-click en: LIMPIAR_CACHE.bat
   ```

3. **Esperar la ventana del navegador**
   - Se abrira automaticamente
   - Mostrara el progreso de limpieza
   - Verificar que diga "Cache limpiado exitosamente!"

4. **Cerrar la ventana del navegador**

5. **Reiniciar la aplicacion**
   ```
   Doble-click en: START.bat
   ```

6. **Recargar el frontend** (F5) si ya estaba abierto

## Limpieza manual (alternativa)

### Backend (CMD)
```cmd
del /q backend\cache\*.*
del /q backend\footprint_cache\*.*
```

### Frontend (Consola del navegador - F12)
```javascript
// Limpiar IndexedDB
indexedDB.deleteDatabase('CandleCache');
indexedDB.deleteDatabase('IndicatorCache');

// Limpiar localStorage de orderflow
Object.keys(localStorage)
  .filter(k => k.includes('orderflow') || k.includes('cache'))
  .forEach(k => localStorage.removeItem(k));
```

## Notas

- Los dibujos guardados en `backend/drawings/` NO se eliminan
- Las configuraciones de indicadores en `backend/config/` NO se eliminan
- Solo se limpian datos temporales/cache que se regeneran automaticamente
