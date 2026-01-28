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
