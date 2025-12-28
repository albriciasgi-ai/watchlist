# Crypto Watchlist - Backend

## Descripción

Backend FastAPI para la watchlist de criptomonedas. Proporciona:
- Datos históricos de Bybit
- Indicadores procesados (Volume Delta/CVD)
- WebSocket proxy para datos en tiempo real
- Sistema de cache

## Requisitos

- Python 3.10+
- pip

## Instalación

### Windows

1. Ejecuta el script de inicio:
```bash
start_backend.bat
```

Este script:
- Crea un entorno virtual (si no existe)
- Instala las dependencias automáticamente
- Inicia el servidor en http://localhost:8000

### Linux/Mac

```bash
# Crear entorno virtual
python3 -m venv venv
source venv/bin/activate

# Instalar dependencias
pip install -r requirements.txt

# Iniciar servidor
uvicorn main:app --reload --port 8000
```

## Endpoints

### Status
```
GET /api/status
```
Retorna el estado del servidor y zona horaria.

### Datos Históricos
```
GET /api/historical/{symbol}?interval=15&days=2
```
Obtiene datos históricos de Bybit.

**Parámetros:**
- `symbol`: Símbolo del par (ej: BTCUSDT)
- `interval`: Timeframe (5, 15, 30, 60, 240, D, W)
- `days`: Número de días históricos

### Volume Delta / CVD
```
GET /api/volume-delta/{symbol}?interval=15
```
Obtiene datos de Volume Delta y CVD.

**Parámetros:**
- `symbol`: Símbolo del par (ej: BTCUSDT)
- `interval`: Timeframe (5, 15, 30, 60, 240, D)

### Upload Cache (Manual)
```
POST /api/upload-cache/{symbol}?interval=15
```
Permite subir datos de volume delta manualmente.

## Sistema de Cache

Los datos de volume delta se almacenan en la carpeta `cache/`:

### Estructura de Archivos
```
cache/
├── BTCUSDT_5_volumedelta.json
├── BTCUSDT_15_volumedelta.json
├── BTCUSDT_30_volumedelta.json
├── BTCUSDT_60_volumedelta.json
├── BTCUSDT_240_volumedelta.json
└── BTCUSDT_D_volumedelta.json
```

### Formato de Datos
```json
{
  "symbol": "BTCUSDT",
  "timeframe": "15",
  "klines": [
    {
      "timestamp": 1234567890000,
      "open": 50000,
      "high": 50100,
      "low": 49900,
      "close": 50050,
      "volume": 123.45,
      "volumeDelta": 10.5
    }
  ]
}
```

### Campos Requeridos
- `timestamp`: Unix timestamp en milisegundos
- `open`, `high`, `low`, `close`: Precios
- `volume`: Volumen total
- `volumeDelta`: Diferencia entre volumen de compra y venta

## Cómo Agregar Datos de Volume Delta

### Opción 1: Archivos JSON
1. Prepara un archivo con el formato correcto
2. Guárdalo en `cache/` con el nombre: `{SYMBOL}_{INTERVAL}_volumedelta.json`

### Opción 2: API Upload
```bash
curl -X POST "http://localhost:8000/api/upload-cache/BTCUSDT?interval=15" \
  -H "Content-Type: application/json" \
  -d @tu_archivo.json
```

## Testing

```bash
# Probar endpoints
python test_backend.py

# Copiar datos de prueba
python copy_test_data.py
```

## CORS

El backend tiene CORS habilitado para permitir todas las origins. 
En producción, debes restringir esto.

## Puerto

El backend corre por defecto en el puerto **8000**.

Asegúrate de que este puerto esté disponible antes de iniciar.

## Logs

El servidor imprime logs detallados en la consola:
- Requests de clientes
- Errores de API
- Cache hits/misses
- Datos cargados

## Troubleshooting

### Puerto 8000 ocupado
```bash
# Windows
netstat -ano | findstr :8000
taskkill /PID <PID> /F

# Linux/Mac
lsof -ti:8000 | xargs kill -9
```

### Error de dependencias
```bash
pip install --upgrade pip
pip install -r requirements.txt --no-cache-dir
```

### Cache no encontrado
Verifica que los archivos JSON estén en `cache/` con el formato correcto.

## Arquitectura

```
Backend
├── FastAPI Server (main.py)
├── Bybit API Client (httpx)
├── Cache System (JSON files)
└── CORS Middleware
```

## Siguientes Pasos

- [ ] Implementar WebSocket server propio
- [ ] Agregar más indicadores (Open Interest, etc.)
- [ ] Sistema de autenticación
- [ ] Rate limiting
- [ ] Logging estructurado
- [ ] Base de datos persistente

## Notas de Seguridad

- El servidor acepta todas las origins (CORS: "*")
- No hay autenticación implementada
- Cache en archivos JSON (no escalable para producción)
- Considera usar Redis o PostgreSQL para producción

## Versión

**2.0.0** - Volume Delta Support

## Contacto

Backend desarrollado para Watchlist de Criptomonedas con sistema modular de indicadores.
