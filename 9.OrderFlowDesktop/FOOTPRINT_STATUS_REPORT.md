# REPORTE DE ESTADO: FOOTPRINTS EN NORTHFLANK

**Fecha de verificación:** 16 de Octubre de 2026
**Aplicación:** 9.OrderFlowDesktop
**Cloud Collector URL:** https://p01--altagracia--rxv8nrbhxln9.code.run

---

## 🔴 ESTADO ACTUAL: SERVIDOR NO DISPONIBLE

### Diagnóstico de Conectividad

**Resultado de pruebas:**
```
✅ DNS Resolution: OK (34.13.193.138)
✅ TCP Connection: OK (puerto 443)
✅ SSL Handshake: OK (HTTP/1.1)
❌ Application Response: TIMEOUT (30+ segundos sin respuesta)
```

**Conclusión:** El servidor está **INACTIVO** o en **COLD START**.

---

## 📊 ARQUITECTURA DEL SISTEMA

### Cloud Footprint Collector (Northflank)

**Ubicación:** `5.Order_flow/cloud_collector/`

**Componentes:**
- `main.py` - API REST con FastAPI
- `footprint_collector.py` - Recolector WebSocket de Bybit
- `Dockerfile` - Contenedor para Northflank
- `requirements.txt` - Dependencias Python
- `DEPLOY_NORTHFLANK.md` - Guía de deployment

**Funcionalidad:**
1. **Recolección 24/7:** Conecta al WebSocket de Bybit (`wss://stream.bybit.com/v5/public/linear`)
2. **Construcción de Footprints:** Procesa trades en tiempo real y construye footprints por vela
3. **Almacenamiento Persistente:** Guarda en disco comprimido (gzip) organizados por fecha
4. **API REST:** Endpoints para obtener footprints históricos

**Configuración (variables de entorno):**
```bash
DATA_DIR=/data                  # Volumen persistente
SYMBOLS=BTCUSDT,ETHUSDT,...     # Símbolos a recolectar
INTERVAL=1                      # Intervalo en minutos
MAX_DAYS=365                    # Días máximos a mantener (~2.5 GB para 21 símbolos)
PORT=8000                       # Puerto del servidor
```

**Estructura de almacenamiento:**
```
/data/
  BTCUSDT/
    2024-01-26.json.gz
    2024-01-27.json.gz
    ...
  ETHUSDT/
    2024-01-26.json.gz
    ...
```

---

## 🔌 ENDPOINTS DE LA API

### Health Check
```
GET /health
```
Retorna estado del collector y estadísticas.

### Obtener Footprints Históricos
```
GET /api/footprints/{symbol}?hours=12&interval=1
```
Retorna footprints de las últimas N horas.

**Parámetros:**
- `symbol`: Par de trading (ej: BTCUSDT)
- `hours`: Horas de histórico (default: 12, max: 24*MAX_DAYS)
- `interval`: Intervalo de vela (default: 1)

**Respuesta:**
```json
{
  "symbol": "BTCUSDT",
  "interval": "1",
  "hours_requested": 12,
  "count": 720,
  "oldest": 1640000000000,
  "newest": 1640043200000,
  "footprints": [...]
}
```

### Estadísticas
```
GET /api/stats
```
Retorna estadísticas del collector (trades procesados, footprints completados, etc.).

### Símbolos Disponibles
```
GET /api/symbols
```
Lista de símbolos siendo recolectados.

### Flush Manual
```
POST /api/flush
```
Fuerza guardado de datos en memoria a disco.

---

## 🔧 INTEGRACIÓN CON APP LOCAL

### Sistema de Integridad de Cache

**Ubicación:** `5.Order_flow/backend/cache_integrity_service.py`

**Servicio que:**
1. **Valida** cache local de footprints
2. **Detecta** gaps (velas faltantes)
3. **Repara** automáticamente desde cloud collector
4. **Reporta** estado de salud

**Endpoints en backend local (puerto 11000):**
```
GET  /api/orderflow/integrity/status       # Estado actual
POST /api/orderflow/integrity/validate     # Validar todos los símbolos
POST /api/orderflow/integrity/repair       # Reparar desde cloud
POST /api/orderflow/integrity/clear-cache  # Limpiar y recargar todo
DELETE /api/orderflow/cache/{symbol}       # Limpiar cache de un símbolo
```

**UI en aplicación:**
- `9.OrderFlowDesktop/src/components/IntegrityPanel.jsx` - Panel de integridad
- Badge de estado: verde (saludable), amarillo (reparando), rojo (problemas)
- Botones: Validar, Reparar, Limpiar Cache

---

## 🔍 VALIDACIÓN DE DATOS

### Criterios de Validación

**1. Estructura JSON:**
- Campos requeridos: `candle_timestamp`, `symbol`, `levels`
- Footprints con campos faltantes se marcan como inválidos

**2. Step Size:**
- Se compara `step_size` del footprint vs configuración actual
- **IMPORTANTE:** Step size diferente es solo **INFORMATIVO**, NO marca como problema
- Los footprints con step_size antiguo siguen siendo útiles

**3. Detección de Gaps:**
- Gaps mayores a 2 minutos entre velas consecutivas se reportan
- **ESTO SÍ es un problema real** que requiere reparación

**Ejemplo de validación:**
```javascript
// ❌ INCORRECTO (solo informativo, no es issue)
if (step_size !== expected_step) { mark_as_issue(); }

// ✅ CORRECTO (problema real)
if (gap_minutes > 2) { mark_as_issue(); }
```

---

## ⚠️ PROBLEMAS CONOCIDOS

### 1. Servidor en Cold Start
**Síntoma:** Timeout al acceder a endpoints
**Causa:** Northflank free tier pone servicios inactivos en sleep
**Solución:** Primer request "despierta" el servidor (~30-60 segundos)

### 2. Gaps en Footprints Históricos
**Síntoma:** "N gaps detectados (X minutos faltantes)"
**Causa:** Collector estuvo offline o perdió conexión WebSocket
**Solución:** Reparar desde cloud collector (si tiene datos)

### 3. Datos Perdidos al Redeploy
**Síntoma:** Cache se vacía después de redeploy
**Causa:** No hay volumen persistente configurado
**Solución:** Configurar volumen en Northflank (ver DEPLOY_NORTHFLANK.md)

---

## 📝 ACCIONES REQUERIDAS

### Opción A: Reactivar Servidor Existente

1. **Verificar estado en Northflank:**
   - Ir a https://northflank.com
   - Login con tu cuenta
   - Verificar proyecto `footprint-collector`
   - Revisar logs del servicio

2. **Despertar servidor:**
   - Hacer request al endpoint `/health`
   - Esperar 30-60 segundos
   - Verificar respuesta

3. **Verificar volumen persistente:**
   - En Northflank > Servicio > Volumes
   - Debe haber volumen de 1GB+ montado en `/data`
   - Si no existe, crear según DEPLOY_NORTHFLANK.md

### Opción B: Redeploy Completo

Si el servicio tiene problemas, redeploy completo:

```bash
cd 5.Order_flow/cloud_collector
# Seguir instrucciones en DEPLOY_NORTHFLANK.md
```

### Opción C: Funcionar Sin Cloud Collector

La aplicación puede funcionar **SIN** cloud collector:
- Solo tendrás footprints calculados localmente
- No habrá histórico persistente de footprints
- Se calcularán on-demand desde datos de velas

**Para deshabilitar cloud collector:**
```python
# En cache_integrity_service.py
CLOUD_COLLECTOR_URL = None  # Deshabilitar cloud
```

---

## 🧪 SCRIPT DE VERIFICACIÓN

Hemos creado un script para verificar el estado del servidor:

**Ubicación:** `9.OrderFlowDesktop/check_footprints.py`

**Uso:**
```bash
python check_footprints.py
```

**Output esperado:**
- Estado del servidor (healthy/down)
- Footprints disponibles por símbolo
- Gaps detectados
- Reporte JSON guardado en `footprint_response.json`

**Última ejecución:** 16 Octubre 2026
```
❌ CLOUD COLLECTOR NO DISPONIBLE
⚠️  El servidor no está disponible
```

---

## 📚 RECURSOS

### Documentación
- `5.Order_flow/cloud_collector/DEPLOY_NORTHFLANK.md` - Guía completa de deployment
- `5.Order_flow/backend/cache_integrity_service.py` - Código del servicio de integridad
- `9.OrderFlowDesktop/CLAUDE.md` - Documentación de la app (sección Sistema de Integridad)

### URLs Importantes
- **Cloud Collector:** https://p01--altagracia--rxv8nrbhxln9.code.run
- **Northflank Dashboard:** https://northflank.com
- **Bybit WebSocket:** wss://stream.bybit.com/v5/public/linear

### Archivos Clave
```
5.Order_flow/
  cloud_collector/
    main.py                      # API del servidor
    footprint_collector.py       # Lógica de recolección
    Dockerfile                   # Contenedor
    DEPLOY_NORTHFLANK.md         # Guía de deployment
  backend/
    cache_integrity_service.py   # Servicio de validación
    main.py                      # Endpoints de integridad (líneas 4138+)

9.OrderFlowDesktop/
  src/components/
    IntegrityPanel.jsx           # UI del panel de integridad
    OrderFlowSettings.jsx        # Botón "Aplicar a historial"
  check_footprints.py           # Script de verificación
```

---

## 🎯 PRÓXIMOS PASOS RECOMENDADOS

1. **Verificar cuenta de Northflank** - Confirmar que el servicio existe y revisar logs
2. **Despertar servidor** - Hacer request al endpoint `/health` y esperar
3. **Verificar volumen** - Asegurar que hay volumen persistente configurado
4. **Probar endpoints** - Usar script `check_footprints.py` una vez que el servidor responda
5. **Validar cache local** - Usar panel de integridad en la UI para verificar estado
6. **Decidir estrategia** - ¿Continuar con cloud collector o funcionar sin él?

---

**Generado:** 16 Octubre 2026
**Por:** Claude Code
**Versión:** 1.0
