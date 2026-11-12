# Guia de Deployment en Northflank

## Paso 1: Crear cuenta en Northflank

1. Ve a https://northflank.com
2. Click en "Sign up free"
3. Puedes usar GitHub, GitLab o email
4. No requiere tarjeta de credito

## Paso 2: Crear un nuevo proyecto

1. En el dashboard, click en "Create new project"
2. Nombre: `footprint-collector`
3. Click "Create project"

## Paso 3: Crear el servicio

### Opcion A: Desde GitHub (Recomendado)

1. Sube la carpeta `cloud_collector` a un repo de GitHub
2. En Northflank: "Add service" > "Deploy from Git"
3. Conecta tu cuenta de GitHub
4. Selecciona el repositorio
5. Configura:
   - **Service name**: `footprint-collector`
   - **Service type**: Combined (web + worker)
   - **Build**: Dockerfile
   - **Dockerfile path**: `./Dockerfile`

### Opcion B: Desde Docker Hub

1. Construye y sube la imagen localmente:
   ```bash
   cd cloud_collector
   docker build -t tu-usuario/footprint-collector:latest .
   docker push tu-usuario/footprint-collector:latest
   ```

2. En Northflank: "Add service" > "Deploy image"
3. Imagen: `tu-usuario/footprint-collector:latest`

## Paso 4: Configurar recursos (Tier Gratuito)

En la seccion "Resources":
- **vCPU**: 0.5 (incluido en gratis)
- **Memory**: 512 MB (incluido en gratis)
- **Instances**: 1

## Paso 5: Agregar volumen persistente

1. En el servicio, ve a "Volumes"
2. Click "Add volume"
3. Configura:
   - **Name**: `footprint-data`
   - **Size**: 1 GB (incluido en gratis)
   - **Mount path**: `/data`
4. Click "Create volume"

## Paso 6: Configurar variables de entorno

En "Environment" > "Runtime variables":

```
DATA_DIR=/data
SYMBOLS=BTCUSDT,ETHUSDT,SOLUSDT,XRPUSDT,ADAUSDT
INTERVAL=1
MAX_DAYS=30
PORT=8000
```

## Paso 7: Configurar networking

1. Ve a "Networking"
2. Habilita "Public access"
3. Northflank te dara una URL como:
   `https://footprint-collector-xxxx.a]code.run`

## Paso 8: Deploy

1. Click "Deploy" o "Save and deploy"
2. Espera ~2-3 minutos a que construya y despliegue
3. Verifica en "Logs" que el servicio inicio correctamente

## Verificar funcionamiento

Una vez desplegado, prueba los endpoints:

```bash
# Health check
curl https://tu-url.code.run/health

# Ver simbolos
curl https://tu-url.code.run/api/symbols

# Ver estadisticas
curl https://tu-url.code.run/api/stats

# Obtener footprints (despues de unos minutos)
curl "https://tu-url.code.run/api/footprints/BTCUSDT?hours=1"
```

## Configurar tu app local

Una vez que el collector este funcionando, modifica tu backend local para obtener datos de ahi.

En `backend/main.py`, agrega:

```python
CLOUD_COLLECTOR_URL = "https://tu-url.code.run"

async def fetch_from_cloud(symbol: str, hours: int = 12):
    """Obtiene footprints del collector en la nube."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(
                f"{CLOUD_COLLECTOR_URL}/api/footprints/{symbol}",
                params={"hours": hours}
            )
            if response.status_code == 200:
                data = response.json()
                return data.get("footprints", [])
    except Exception as e:
        logger.warning(f"Error fetching from cloud: {e}")
    return []
```

## Monitoreo

- **Logs**: Northflank > tu servicio > Logs
- **Metricas**: Northflank > tu servicio > Metrics (CPU, RAM, Network)
- **Health**: El endpoint `/health` retorna estado y estadisticas

## Costos

Con el tier gratuito tienes:
- 0.5 vCPU
- 512 MB RAM
- 1 GB almacenamiento
- Trafico ilimitado dentro de limites razonables

**NO hay costos ocultos** si te mantienes en estos limites.

## Troubleshooting

### El servicio no inicia
- Revisa los logs en Northflank
- Verifica que el Dockerfile es correcto
- Asegurate que las dependencias estan en requirements.txt

### No hay datos de footprints
- Espera al menos 1-2 minutos despues del deploy
- Verifica en `/api/stats` que `trades_processed` > 0
- Revisa los logs por errores de conexion a Bybit

### Error de volumen
- Asegurate que el mount path es `/data` (igual que DATA_DIR)
- Verifica que el volumen esta attached al servicio

### Datos perdidos al redeploy
- Si configuraste el volumen correctamente, los datos persisten
- Si no hay volumen, se pierden al redeploy

## Trades en el formato del almacen de App 1 (12 Noviembre 2026)

Ademas de los footprints de 1 minuto (que App 9 sigue usando), el collector graba **todos los trades**
en el formato compacto del almacen de App 1 (`.tape`, el mismo que `OrderFlowData/tools/ingest.py`
arma desde public.bybit.com). De ahi `build_store.py` y `build_flow.py` sacan el almacen por minuto y
precio fino y el flujo, igual que de un dia oficial. Sirve para los dias que Bybit aun no publico.

- **Archivos:** `/data/tape/BTCUSDT/2026/BTCUSDT_2026-11-12.tape`, uno por moneda y dia UTC. Cada
  `TAPE_SNAPSHOT_SECONDS` (300 por defecto) los trades nuevos se suman al archivo del dia (temporal y
  reemplazo, una moneda a la vez). En memoria quedan solo los ultimos minutos: el servicio tiene
  512 MB y un dia de BTC pasa de 2 millones de trades. El dia en curso usa compresion 6 y el dia
  cerrado 9, como `ingest.py`.
- **Reinicios:** se anota el hueco desde el ultimo guardado; un dia anterior que quedo sin cerrar se
  cierra con su hueco hasta medianoche. Un archivo del dia ilegible se aparta (`.ilegible-...`).
- **Huecos:** los cortes del WebSocket y los reinicios quedan anotados en la cabecera (`gaps`). Un dia
  grabado desde su inicio y sin huecos queda `complete`.
- **Rutas nuevas:**
  - `GET /api/tape/days?symbol=BTCUSDT`: dias grabados, tamano, trades, `complete` y huecos.
  - `GET /api/tape/{symbol}/{day}`: el archivo `.tape` del dia.
- **Variables nuevas:** `TAPE_KEEP_DAYS` (30) y `TAPE_SNAPSHOT_SECONDS` (300).
- **Espacio:** un dia de BTC pesa unos 3 MB; las 21 monedas, del orden de 15 a 20 MB por dia
  (unos 0.5 GB con 30 dias), aparte de los footprints JSON.
- **`MAX_DAYS`:** `0` = sin limite (no se borran footprints), como se puso el 2/11 en la rama `deploy`.
- **Despliegue:** Northflank construye desde el repositorio `albriciasgi-ai/footprint-collector`,
  rama `deploy` (no desde este repositorio): hay que copiar ahi estos archivos. Construye solo al
  subir, pero el despliegue se hace a mano con "Deploy" en Builds.
- **`/health`** ya no descomprime todos los archivos (tardaba mas de un minuto).
- **En tu PC:** `PanelOrderFlow/sync_nube.py` baja esos dias a `OrderFlowData/live/` y arma su almacen.
- **Pruebas sin conexion:** `python -B tests/tape_checks.py` (22).

Probado en el PC con BTC, ETH y XRP: los 18 minutos completos grabados coincidieron exactos con las
velas de 1 minuto oficiales de Bybit en volumen y cierre, y un reinicio brusco recupero lo guardado y
anoto el hueco. Falta comparar un dia completo grabado en la nube contra el archivo oficial de Bybit.
