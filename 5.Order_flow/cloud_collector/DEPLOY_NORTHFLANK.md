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


## Footprints guardados fuera del bucle (12/11/2026)

**Problema:** cada 10 footprints de una moneda, `_flush_to_disk` releia, ordenaba y reescribia todo el dia comprimido (JSON) dentro del bucle de asyncio. Con 20 monedas y poca CPU el bucle se trababa hasta 30 s: `/health` tardaba de 1 a 30 s y las descargas de `/api/tape/{symbol}/{day}` se quedaban a mitad (BTC: 0.36 de 1.9 MB en minutos). El grabador del PC nunca recibia la nube.

**Cambios** (`footprint_collector.py`, `main.py`):
- `_complete_footprint` solo marca la moneda; `_flush_loop` (cada 5 s) escribe en un hilo con `asyncio.to_thread`.
- Un footprint por linea, en miembros gzip agregados al final del archivo del dia: ya no se relee el dia al guardar. Nivel de compresion 6.
- Los archivos de antes (un arreglo JSON) se leen igual y se pasan a lineas la primera vez que se agrega. Un final cortado por un apagado se repara antes de agregar.
- `/api/footprints`, `/api/footprints/{s}/latest`, `/api/stats` y `/health` leen en un hilo; `/api/flush` guarda en un hilo.
- La respuesta de `/api/footprints` no cambia (App 9 sigue igual).
- Pruebas: `tests/footprint_storage_checks.py` (12) y las 22 de `tape_checks.py`.

**Desplegado el 12/11:** rama `deploy` de `albriciasgi-ai/footprint-collector`, commit baad6bc, build `abrupt-horn-9829` (botón "Deploy" en Builds, desde el navegador integrado con la sesión del usuario).

**Medido después:**
- `/health` responde en 0.9 a 2.4 s; antes tardaba de 1 a 30 s.
- Las descargas llegan completas: BTC (2 MB) en 48 a 93 s y SOL (0.44 MB) en 30 s.
- Siguen lentas, de 15 a 40 KB/s, también con HTTP/1.1. Puede ser el disco del volumen o la CPU de 0.2 vCPU; no se investigó más. El PC baja la nube aparte cada 15 minutos, así que ya no frena los footprints.


## Libro completo de Bybit (13/11/2026)

**Pedido:** la suite (`12.AltagraciaTradingSuite`) graba el libro completo solo mientras está abierta, y el usuario no puede tenerla abierta todas las semanas que necesita la medición. La nube lo graba todo el día y el PC baja lo que le falta.

- **Qué graba:** el mismo grabador de la suite. `book_recorder.py` y `book_store.py` son copias exactas de `12.AltagraciaTradingSuite/server`, y `tests/book_cloud_checks.py` de la suite comprueba que sigan iguales: un cambio se hace allá y se copia aquí.
  - WebSocket público `orderbook.full` de cada moneda y la foto REST al conectar, con la hora de Bybit;
  - cada segundo hasta ±0.8% (`.bks`) y cada minuto hasta ±5% (`.bkm`), en `/data/live/book/{SIMBOLO}/{AAAA}/`;
  - una moneda que Bybit no da como "Trading" (TONUSDT, cerrada) no se graba.
- **Variables nuevas** (se cambian sin rehacer la imagen: basta reiniciar el servicio):
  - `BOOK`: 1 por omisión; 0 lo apaga;
  - `BOOK_SYMBOLS`: las de `SYMBOLS` por omisión;
  - `BOOK_KEEP_DAYS`: 7 días;
  - `BOOK_MIN_FREE_MB`: 150.
- **Espacio:** unos 200 MB por día con 20 monedas (medido en el PC el 13/11: 73% los segundos y 27% los minutos), así que 7 días son unos 1.4 GB. El volumen real es de 6 GB NVMe (0.15 USD por GB al mes), no el de 1 GB del paso 5. Cada 10 minutos se borran los días del libro de más de `BOOK_KEEP_DAYS`. Si el volumen queda con menos de `BOOK_MIN_FREE_MB` libres, también los días más viejos del libro. Nunca se borran el día de hoy, los trades ni los footprints. Si aun así falta espacio, el libro deja de grabarse hasta reiniciar.
- **Pedidos a Bybit:** a lo sumo 5 fotos REST por segundo; solo lectura.
- **Memoria y CPU** (medido en el PC el 13/11, 4 minutos con las 21 monedas de `SYMBOLS`):
  - con el libro, 113 MB de memoria contra 69 MB sin él, y 5.1% de un núcleo contra 0.6%;
  - las 20 que cotizan quedaron listas en 15 s, y TONUSDT quedó fuera.

  En la nube, con 0.2 vCPU, eso puede ser la cuarta parte de su CPU.
- **Rutas nuevas:**
  - `GET /api/book/status`: por moneda, si está lista, huecos, resincronizaciones, las cerradas y los bytes de hoy;
  - `GET /api/book/depth/{simbolo}?band=0.005`: lo que hay ahora en cubos finos;
  - `GET /api/book/days?symbol=`: por moneda, día y tipo, los bytes y los tramos de minutos;
  - `GET /api/book/{simbolo}/{dia}/{bks|bkm}?from_ms&to_ms`: los bloques de esos minutos, tal cual están en el archivo.
- **`/health`** suma `book` (el resumen) y `disk` (total y libre del volumen, en MB).
- **En el PC:** `12.AltagraciaTradingSuite/server/book_cloud.py` baja cada 10 minutos solo los minutos que el PC no tiene completos, a `OrderFlowData/live/book_cloud`. Los lectores juntan las dos carpetas.
- **Pruebas sin conexión:** `tests/book_cloud_checks.py` de la suite (16) corre este `main.py` en el mismo proceso, con `httpx.ASGITransport`.
- **Despliegue:** copiar a la rama `deploy` de `albriciasgi-ai/footprint-collector` `main.py`, `Dockerfile`, `requirements.txt` (suma httpx), `book_recorder.py` y `book_store.py`.


## Trades sumados al final del día, sin quedarse sin memoria (13/11/2026)

**Problema:** al ir a desplegar el libro, Northflank mostraba el servicio con 4 reinicios en un día, el último "Out-of-Memory killed (OOMKilled)". Fueron hoy a las 12:51, 13:34 y 14:58 de Colombia, todos por la tarde UTC. El plan es `nf-compute-20`: 0.2 vCPU y 512 MB. Cada reinicio deja un hueco en los trades.

**Causa:** cada 5 minutos, `_merge_write` leía el archivo del día entero, lo unía con los trades nuevos, lo ordenaba y lo reescribía. Eso ponía en memoria varias copias del día. A las 15:00 de Colombia BTC tenía 2,705,109 trades: la unión ocupaba 260 MB, medidos con tracemalloc sobre el archivo real.

**Cambios:**
- `append_tape` en `tape_format.py`: suma los trades nuevos uniendo los planos de bytes de cada columna, sin decodificar el día. Ocupa 41 MB con ese mismo BTC.
  - El archivo queda byte a byte igual al de antes: el formato no cambia, y `ingest.py`, `build_store.py` y `sync_nube.py` lo leen igual.
  - Si un trade nuevo es anterior al último guardado, o la suma falla, se une y se ordena todo como antes.
- `ENV MALLOC_ARENA_MAX=2` en el Dockerfile: glibc retiene menos memoria entre los hilos de escritura.
- **Pruebas:** `tests/tape_append_checks.py` (13), byte a byte contra la unión de antes:
  - planos que crecen, horas iguales en el borde, trades desordenados, día que se cierra y trade atrasado;
  - el día real de BTC, si está en el PC.

  `tape_checks.py` sigue con 18 de 22. Las 4 que fallan ya fallaban antes: usan el 12/11 como día en curso.
