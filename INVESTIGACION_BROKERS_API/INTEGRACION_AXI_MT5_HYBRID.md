# Integración Axi MT5 - Opción Híbrida (Multi-Broker)

**Documento Técnico de Implementación**
**Fecha:** 31 Octubre 2026
**Versión:** 1.0
**Autor:** Claude Code

---

## 📋 TABLA DE CONTENIDOS

1. [Resumen Ejecutivo](#resumen-ejecutivo)
2. [Arquitectura General](#arquitectura-general)
3. [Componentes del Sistema](#componentes-del-sistema)
4. [Flujo de Datos](#flujo-de-datos)
5. [Configuración del Servidor](#configuración-del-servidor)
6. [Código de Implementación](#código-de-implementación)
7. [Deployment en VPS](#deployment-en-vps)
8. [Operación Día a Día](#operación-día-a-día)
9. [Troubleshooting](#troubleshooting)
10. [Costos y Recursos](#costos-y-recursos)

---

## 📊 RESUMEN EJECUTIVO

### Objetivo

Integrar **Axi MT5** como broker adicional en las aplicaciones de trading existentes (Apps 8, 9, 10, 11), manteniendo **Bybit** como broker principal, permitiendo al usuario elegir dónde ejecutar cada operación.

### Características Principales

- ✅ **Multi-broker:** Bybit (API REST) + Axi (MetaTrader 5)
- ✅ **Interfaz unificada:** Mismo frontend para ambos brokers
- ✅ **100% automatizable:** Sin intervención manual necesaria
- ✅ **Operación 24/7:** Deployment en VPS con Docker
- ✅ **Sin dependencias de Claude:** Sistema completamente independiente
- ✅ **Costo bajo:** ~$7/mes de hosting

### Stack Tecnológico

| Componente | Tecnología | Propósito |
|------------|------------|-----------|
| **Frontend** | React 18 + Vite | Apps 8, 9, 10, 11 (sin cambios) |
| **Backend** | FastAPI + Python 3.11 | Backend actual (extendido) |
| **MT5 Bridge** | FastAPI + MetaTrader5 Library | Conexión con MT5 |
| **Terminal MT5** | Wine + Docker | Correr MT5 en Linux |
| **Reverse Proxy** | Nginx + Let's Encrypt | HTTPS y routing |
| **Hosting** | VPS Linux (Hetzner/Vultr) | Servidor 24/7 |

### Aclaración Importante: Claude NO es Requerido

**⚠️ IMPORTANTE:** Este sistema **NO requiere Claude** en absoluto.

- ❌ **NO necesitas** cuenta de Claude
- ❌ **NO necesitas** Claude Desktop
- ❌ **NO necesitas** Claude Code
- ❌ **NO necesitas** plan Pro de Claude
- ❌ **NO necesitas** ningún servicio de Anthropic

El término "MCP" aparece en el código solo porque usamos el estándar MCP (Model Context Protocol) que es **open source y gratuito**. Es como usar "REST API" - nadie te cobra por usar el estándar.

Claude es **100% opcional** y solo útil para debugging durante desarrollo (como usar Postman para probar APIs).

---

## 🏗️ ARQUITECTURA GENERAL

### Diagrama de Alto Nivel

```
┌─────────────────────────────────────────────────────────────┐
│                         USUARIO                              │
│                    (Navegador Web)                           │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTPS
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                    VPS LINUX (Docker)                        │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │                  NGINX (Reverse Proxy)                  │ │
│  │              SSL/TLS + Load Balancing                   │ │
│  └─────────┬──────────────────────────────┬────────────────┘ │
│            │                               │                  │
│            ↓                               ↓                  │
│  ┌─────────────────────┐       ┌──────────────────────────┐ │
│  │  FASTAPI BACKEND    │       │    MT5 BRIDGE SERVER     │ │
│  │  (Puertos múltiples)│←─────→│    (Puerto 8001)         │ │
│  │                     │       │                          │ │
│  │ • App 8: 10001      │       │ • FastAPI puro          │ │
│  │ • App 9: 11000      │       │ • MetaTrader5 Library   │ │
│  │ • App 10: 5000      │       │                          │ │
│  │ • App 11: 12000     │       │                          │ │
│  └─────────┬───────────┘       └────────────┬─────────────┘ │
│            │                                 │                │
│            │ API Bybit                       │ IPC            │
│            ↓                                 ↓                │
│  ┌─────────────────────┐       ┌──────────────────────────┐ │
│  │   BYBIT REST API    │       │  METATRADER 5 TERMINAL   │ │
│  │   (Externo)         │       │  (Wine Container)        │ │
│  └─────────────────────┘       │  • VNC: 6080             │ │
│                                 │  • noVNC Web GUI         │ │
│                                 └────────────┬─────────────┘ │
│                                              │                │
└──────────────────────────────────────────────┼────────────────┘
                                               │ Internet
                                               ↓
                                    ┌─────────────────────┐
                                    │  AXI BROKER         │
                                    │  (Servidores MT5)   │
                                    └─────────────────────┘
```

### Flujo de Selección de Broker

```
Usuario selecciona "Broker: Axi" en UI
    ↓
Frontend hace fetch('/api/trade/manual', { broker: 'axi', ... })
    ↓
FastAPI Backend detecta broker === 'axi'
    ↓
Backend llama a MT5 Bridge: POST http://mt5-bridge:8001/trading/order
    ↓
MT5 Bridge ejecuta mt5.order_send()
    ↓
MetaTrader5 envía orden a Axi
    ↓
Respuesta vuelve por la misma cadena hasta el frontend
    ↓
UI muestra confirmación: "✅ Orden ejecutada en Axi #123456789"
```

---

## 🧩 COMPONENTES DEL SISTEMA

### 1. MetaTrader 5 Terminal (Docker Container)

**Propósito:** Ejecutar la aplicación de escritorio MT5 en un entorno Linux headless.

**Tecnología:**
- Imagen Docker: `marketcalls/meta-docker`
- Wine (para correr app Windows en Linux)
- VNC/noVNC (acceso remoto GUI)

**Puertos:**
- `5900`: VNC (acceso directo con VNC client)
- `6080`: noVNC (acceso web browser)

**Variables de Entorno:**
```bash
MT5_ACCOUNT=12345678          # Número de cuenta Axi
MT5_PASSWORD=tu_password      # Contraseña MT5
MT5_SERVER=Axi-Demo           # Servidor (Demo o Real)
VNC_PASSWORD=vnc_pass         # Password para acceso VNC
```

**Volúmenes:**
- `mt5_data:/root/.wine` - Configuración de Wine
- `mt5_terminal:/root/.wine/drive_c/Program Files/MetaTrader 5` - Datos de MT5

---

### 2. MT5 Bridge Server (FastAPI)

**Propósito:** Servidor Python que actúa como puente entre tu backend y el terminal MT5.

**Archivo:** `mt5-bridge/mt5_api_bridge.py`

**Endpoints:**

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/health` | Health check del servidor |
| GET | `/account/balance` | Balance, equity, margin |
| GET | `/market/price/{symbol}` | Precio bid/ask actual |
| POST | `/trading/order` | Abrir posición |
| PATCH | `/trading/order/{ticket}` | Modificar SL/TP |
| DELETE | `/trading/order/{ticket}` | Cerrar posición |
| GET | `/trading/positions` | Listar posiciones abiertas |
| GET | `/trading/history` | Historial de trades |

**Dependencias:**
```txt
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
MetaTrader5>=5.0.45
python-dotenv>=1.0.0
```

---

### 3. FastAPI Backend (Extendido)

**Propósito:** Backend actual de tus apps, extendido para soportar múltiples brokers.

**Cambios necesarios:**

```python
# main.py - Agregar cliente HTTP para MT5 Bridge
import httpx

MT5_BRIDGE_URL = os.getenv("MT5_BRIDGE_URL", "http://mt5-bridge:8001")

class BrokerRouter:
    """Rutea requests al broker correcto"""

    async def execute_trade(self, broker: str, order: OrderRequest):
        if broker == "bybit":
            return await self._execute_bybit(order)
        elif broker == "axi":
            return await self._execute_axi(order)
        else:
            raise ValueError(f"Broker no soportado: {broker}")

    async def _execute_bybit(self, order: OrderRequest):
        # Lógica existente de Bybit
        return await bybit_service.place_order(order)

    async def _execute_axi(self, order: OrderRequest):
        # Nueva lógica para Axi via MT5 Bridge
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{MT5_BRIDGE_URL}/trading/order",
                json={
                    "symbol": order.symbol,
                    "side": order.side,
                    "volume": order.volume,
                    "sl": order.stop_loss,
                    "tp": order.take_profit
                },
                timeout=30.0
            )
            response.raise_for_status()
            return response.json()
```

---

### 4. Frontend (Sin Cambios Mayores)

**Cambio único:** Agregar selector de broker en UI.

```jsx
// src/components/trading/TradingPanel.jsx

const [selectedBroker, setSelectedBroker] = useState('bybit');

// Dropdown en UI
<select value={selectedBroker} onChange={e => setSelectedBroker(e.target.value)}>
  <option value="bybit">Bybit (Futures)</option>
  <option value="axi">Axi (MT5 CFDs)</option>
</select>

// Al ejecutar trade
const executeTrade = async () => {
  const response = await fetch('/api/trade/manual', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      broker: selectedBroker,  // ← Único cambio
      symbol: 'BTCUSDT',
      side: 'LONG',
      volume: 0.1,
      // ...
    })
  });
};
```

---

## 🔄 FLUJO DE DATOS

### Escenario 1: Usuario Ejecuta Trade en Axi

**Paso a Paso:**

```
1. FRONTEND (React)
   Usuario click "Ejecutar Trade" con broker="axi"
   ↓
   POST /api/trade/manual
   Body: { broker: "axi", symbol: "BTCUSDT", side: "LONG", ... }

2. NGINX (Reverse Proxy)
   Recibe request en puerto 443 (HTTPS)
   ↓
   Proxy a backend en puerto 5000

3. FASTAPI BACKEND
   @app.post("/api/trade/manual")
   ↓
   Detecta broker === "axi"
   ↓
   Llama a BrokerRouter._execute_axi()
   ↓
   POST http://mt5-bridge:8001/trading/order
   Body: { symbol: "BTCUSDT", side: "BUY", volume: 0.1, sl: 66800, tp: 68000 }

4. MT5 BRIDGE
   @app.post("/trading/order")
   ↓
   Prepara request de MT5:
   {
       "action": mt5.TRADE_ACTION_DEAL,
       "symbol": "BTCUSDT",
       "volume": 0.1,
       "type": mt5.ORDER_TYPE_BUY,
       "sl": 66800,
       "tp": 68000,
       ...
   }
   ↓
   result = mt5.order_send(request)
   ↓
   Retorna: { "ticket": 123456789, "price": 67250.0, "status": "success" }

5. METATRADER 5 TERMINAL
   Recibe orden via MetaTrader5 Python Library (IPC)
   ↓
   Envía orden a servidor de Axi (Internet)
   ↓
   Axi ejecuta en mercado
   ↓
   Retorna confirmación a MT5

6. RESPUESTA (de vuelta)
   MT5 → MT5 Bridge → FastAPI Backend → Nginx → Frontend
   ↓
   Frontend muestra:
   "✅ Orden ejecutada en Axi
    Ticket: #123456789
    Entry: $67,250.00"
```

**Tiempo total:** ~500ms - 2 segundos (dependiendo de latencia de Axi)

---

### Escenario 2: Monitoreo de Posiciones (Polling)

**Flujo de actualización automática cada 5 segundos:**

```javascript
// Frontend
useEffect(() => {
  const interval = setInterval(async () => {
    const positions = await fetch('/api/positions/all').then(r => r.json());
    setPositions(positions);
  }, 5000);

  return () => clearInterval(interval);
}, []);
```

**Backend agrega posiciones de ambos brokers:**

```python
@app.get("/api/positions/all")
async def get_all_positions():
    # Bybit (API REST directa)
    bybit_positions = await bybit_service.get_positions()

    # Axi (via MT5 Bridge)
    async with httpx.AsyncClient() as client:
        response = await client.get(f"{MT5_BRIDGE_URL}/trading/positions")
        axi_positions = response.json()

    # Combinar y normalizar formato
    all_positions = [
        *[{**pos, "broker": "bybit"} for pos in bybit_positions],
        *[{**pos, "broker": "axi"} for pos in axi_positions]
    ]

    return all_positions
```

---

## ⚙️ CONFIGURACIÓN DEL SERVIDOR

### docker-compose.yml

**Ubicación:** `/opt/trading-platform/docker-compose.yml`

```yaml
version: '3.8'

services:
  # ====== METATRADER 5 TERMINAL ======
  metatrader5:
    image: marketcalls/meta-docker:latest
    container_name: mt5-terminal
    hostname: mt5-terminal
    environment:
      - DISPLAY=:1
      - VNC_PASSWORD=${VNC_PASSWORD}
      - MT5_ACCOUNT=${MT5_ACCOUNT}
      - MT5_PASSWORD=${MT5_PASSWORD}
      - MT5_SERVER=${MT5_SERVER}
    ports:
      - "5900:5900"  # VNC
      - "6080:6080"  # noVNC (web)
    volumes:
      - mt5_data:/root/.wine
      - mt5_terminal:/root/.wine/drive_c/Program Files/MetaTrader 5
    restart: unless-stopped
    networks:
      - trading-network
    healthcheck:
      test: ["CMD", "pgrep", "-f", "terminal64.exe"]
      interval: 30s
      timeout: 10s
      retries: 3

  # ====== MT5 BRIDGE SERVER ======
  mt5-bridge:
    build:
      context: ./mt5-bridge
      dockerfile: Dockerfile
    container_name: mt5-bridge
    hostname: mt5-bridge
    environment:
      - MT5_HOST=metatrader5
      - LOG_LEVEL=INFO
    ports:
      - "8001:8001"
    depends_on:
      metatrader5:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - trading-network
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8001/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  # ====== FASTAPI BACKEND ======
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: fastapi-backend
    hostname: backend
    environment:
      - MT5_BRIDGE_URL=http://mt5-bridge:8001
      - BYBIT_API_KEY=${BYBIT_API_KEY}
      - BYBIT_API_SECRET=${BYBIT_API_SECRET}
      - DATABASE_URL=postgresql://trading:${DB_PASSWORD}@postgres:5432/trading
      - REDIS_URL=redis://redis:6379/0
    ports:
      - "8000:8000"   # App 2 (Watchlist)
      - "10001:10001" # App 8 (Analizador)
      - "11000:11000" # App 9 (Order Flow)
      - "5000:5000"   # App 10 (Trading Bot)
      - "12000:12000" # App 11 (Journal)
    depends_on:
      - mt5-bridge
      - postgres
      - redis
    volumes:
      - ./backend:/app
      - backend_data:/app/data
      - backend_logs:/app/logs
    restart: unless-stopped
    networks:
      - trading-network

  # ====== POSTGRESQL ======
  postgres:
    image: postgres:15-alpine
    container_name: postgres-db
    environment:
      - POSTGRES_USER=trading
      - POSTGRES_PASSWORD=${DB_PASSWORD}
      - POSTGRES_DB=trading
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped
    networks:
      - trading-network

  # ====== REDIS (Cache) ======
  redis:
    image: redis:7-alpine
    container_name: redis-cache
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    restart: unless-stopped
    networks:
      - trading-network

  # ====== NGINX REVERSE PROXY ======
  nginx:
    image: nginx:alpine
    container_name: nginx-proxy
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - nginx_logs:/var/log/nginx
    depends_on:
      - backend
    restart: unless-stopped
    networks:
      - trading-network

volumes:
  mt5_data:
    driver: local
  mt5_terminal:
    driver: local
  backend_data:
    driver: local
  backend_logs:
    driver: local
  postgres_data:
    driver: local
  redis_data:
    driver: local
  nginx_logs:
    driver: local

networks:
  trading-network:
    driver: bridge
```

---

### Archivo .env

**Ubicación:** `/opt/trading-platform/.env`

```bash
# MetaTrader 5
MT5_ACCOUNT=12345678
MT5_PASSWORD=tu_password_mt5
MT5_SERVER=Axi-Demo
VNC_PASSWORD=tu_password_vnc_seguro

# Bybit API
BYBIT_API_KEY=tu_api_key
BYBIT_API_SECRET=tu_api_secret

# Database
DB_PASSWORD=tu_password_db_seguro

# General
ENVIRONMENT=production
LOG_LEVEL=INFO
```

**⚠️ SEGURIDAD:** Nunca commitear este archivo a Git. Agregar a `.gitignore`.

---

## 💻 CÓDIGO DE IMPLEMENTACIÓN

### MT5 Bridge Server

**Archivo:** `mt5-bridge/mt5_api_bridge.py`

```python
"""
MT5 API Bridge Server
Servidor FastAPI que conecta a MetaTrader 5 y expone endpoints REST.
NO requiere Claude ni ningún servicio de Anthropic.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import MetaTrader5 as mt5
import os
import logging
from typing import Optional, List, Dict
from datetime import datetime

# Configurar logging
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# FastAPI app
app = FastAPI(
    title="MT5 Trading Bridge",
    description="Servidor de conexión a MetaTrader 5 para trading automatizado",
    version="1.0.0"
)

# CORS (permitir requests desde frontend)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # En producción, especificar dominios
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ====== MODELOS PYDANTIC ======

class OrderRequest(BaseModel):
    symbol: str
    side: str  # "BUY" o "SELL"
    volume: float
    sl: float = 0.0
    tp: float = 0.0
    comment: str = "API Trade"

class ModifyRequest(BaseModel):
    sl: Optional[float] = None
    tp: Optional[float] = None

# ====== ESTADO GLOBAL ======

_mt5_connected = False

# ====== FUNCIONES DE CONEXIÓN ======

def ensure_connection() -> bool:
    """Asegura que MT5 está conectado"""
    global _mt5_connected

    if _mt5_connected:
        # Verificar si sigue conectado
        if mt5.terminal_info() is not None:
            return True
        else:
            _mt5_connected = False

    # Intentar conectar
    logger.info("Conectando a MetaTrader 5...")

    if not mt5.initialize():
        logger.error(f"MT5 initialize() falló: {mt5.last_error()}")
        return False

    account = int(os.getenv("MT5_ACCOUNT"))
    password = os.getenv("MT5_PASSWORD")
    server = os.getenv("MT5_SERVER")

    if not mt5.login(account, password=password, server=server):
        logger.error(f"MT5 login() falló: {mt5.last_error()}")
        return False

    _mt5_connected = True
    logger.info(f"Conectado a MT5 - Cuenta: {account}, Servidor: {server}")
    return True

@app.on_event("startup")
async def startup_event():
    """Conectar a MT5 al iniciar el servidor"""
    if not ensure_connection():
        logger.warning("No se pudo conectar a MT5 en startup. Se reintentará en cada request.")

@app.on_event("shutdown")
async def shutdown_event():
    """Desconectar de MT5 al cerrar el servidor"""
    global _mt5_connected
    if _mt5_connected:
        mt5.shutdown()
        _mt5_connected = False
        logger.info("Desconectado de MT5")

# ====== ENDPOINTS ======

@app.get("/health")
def health_check():
    """Health check - Verifica estado del servidor y conexión MT5"""
    terminal_info = mt5.terminal_info()
    account_info = mt5.account_info()

    return {
        "status": "ok",
        "mt5_connected": terminal_info is not None,
        "mt5_terminal": terminal_info._asdict() if terminal_info else None,
        "account": account_info.login if account_info else None,
        "server": account_info.server if account_info else None,
        "timestamp": datetime.now().isoformat()
    }

@app.get("/account/balance")
def get_balance():
    """Obtiene balance, equity y margin de la cuenta MT5"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    info = mt5.account_info()
    if info is None:
        raise HTTPException(status_code=500, detail=f"Error obteniendo info: {mt5.last_error()}")

    return {
        "balance": info.balance,
        "equity": info.equity,
        "margin": info.margin,
        "free_margin": info.margin_free,
        "margin_level": info.margin_level,
        "profit": info.profit,
        "currency": info.currency,
        "leverage": info.leverage
    }

@app.get("/market/price/{symbol}")
def get_price(symbol: str):
    """Obtiene precio actual (bid/ask) de un símbolo"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    tick = mt5.symbol_info_tick(symbol)
    if tick is None:
        raise HTTPException(status_code=404, detail=f"Símbolo {symbol} no encontrado")

    return {
        "symbol": symbol,
        "bid": tick.bid,
        "ask": tick.ask,
        "last": tick.last,
        "volume": tick.volume,
        "time": tick.time,
        "spread": tick.ask - tick.bid
    }

@app.post("/trading/order")
def place_order(order: OrderRequest):
    """Abre una nueva posición"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    logger.info(f"Ejecutando orden: {order.symbol} {order.side} {order.volume}")

    # Obtener precio actual
    tick = mt5.symbol_info_tick(order.symbol)
    if tick is None:
        raise HTTPException(status_code=404, detail=f"Símbolo {order.symbol} no encontrado")

    # Determinar tipo de orden y precio
    if order.side.upper() == "BUY":
        order_type = mt5.ORDER_TYPE_BUY
        price = tick.ask
    elif order.side.upper() == "SELL":
        order_type = mt5.ORDER_TYPE_SELL
        price = tick.bid
    else:
        raise HTTPException(status_code=400, detail=f"Side inválido: {order.side}")

    # Preparar request
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": order.symbol,
        "volume": order.volume,
        "type": order_type,
        "price": price,
        "sl": order.sl,
        "tp": order.tp,
        "deviation": 20,
        "magic": 234000,
        "comment": order.comment,
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    # Enviar orden
    result = mt5.order_send(request)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        logger.error(f"Orden falló: {result.comment} (retcode: {result.retcode})")
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Orden falló",
                "comment": result.comment,
                "retcode": result.retcode
            }
        )

    logger.info(f"Orden ejecutada exitosamente: Ticket #{result.order}")

    return {
        "status": "success",
        "ticket": result.order,
        "volume": result.volume,
        "price": result.price,
        "comment": result.comment,
        "request_id": result.request_id
    }

@app.get("/trading/positions")
def get_positions():
    """Lista todas las posiciones abiertas"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    positions = mt5.positions_get()

    if positions is None:
        logger.warning(f"Error obteniendo posiciones: {mt5.last_error()}")
        return []

    if len(positions) == 0:
        return []

    return [
        {
            "ticket": pos.ticket,
            "symbol": pos.symbol,
            "type": "BUY" if pos.type == 0 else "SELL",
            "volume": pos.volume,
            "open_price": pos.price_open,
            "current_price": pos.price_current,
            "sl": pos.sl,
            "tp": pos.tp,
            "profit": pos.profit,
            "swap": pos.swap,
            "comment": pos.comment,
            "time": pos.time
        }
        for pos in positions
    ]

@app.patch("/trading/order/{ticket}")
def modify_position(ticket: int, modify: ModifyRequest):
    """Modifica SL/TP de una posición abierta"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    # Obtener posición
    positions = mt5.positions_get(ticket=ticket)
    if positions is None or len(positions) == 0:
        raise HTTPException(status_code=404, detail=f"Posición {ticket} no encontrada")

    position = positions[0]

    # Usar valores actuales si no se especifican nuevos
    new_sl = modify.sl if modify.sl is not None else position.sl
    new_tp = modify.tp if modify.tp is not None else position.tp

    # Preparar request de modificación
    request = {
        "action": mt5.TRADE_ACTION_SLTP,
        "symbol": position.symbol,
        "position": ticket,
        "sl": new_sl,
        "tp": new_tp
    }

    result = mt5.order_send(request)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Modificación falló",
                "comment": result.comment,
                "retcode": result.retcode
            }
        )

    logger.info(f"Posición {ticket} modificada: SL={new_sl}, TP={new_tp}")

    return {
        "status": "success",
        "ticket": ticket,
        "sl": new_sl,
        "tp": new_tp
    }

@app.delete("/trading/order/{ticket}")
def close_position(ticket: int, volume: Optional[float] = None):
    """Cierra una posición (total o parcialmente)"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    # Obtener posición
    positions = mt5.positions_get(ticket=ticket)
    if positions is None or len(positions) == 0:
        raise HTTPException(status_code=404, detail=f"Posición {ticket} no encontrada")

    position = positions[0]

    # Determinar volumen a cerrar
    close_volume = volume if volume else position.volume

    if close_volume > position.volume:
        raise HTTPException(
            status_code=400,
            detail=f"Volumen a cerrar ({close_volume}) mayor que posición ({position.volume})"
        )

    # Obtener precio actual
    tick = mt5.symbol_info_tick(position.symbol)
    if tick is None:
        raise HTTPException(status_code=500, detail="No se pudo obtener precio actual")

    # Preparar request de cierre
    request = {
        "action": mt5.TRADE_ACTION_DEAL,
        "symbol": position.symbol,
        "volume": close_volume,
        "type": mt5.ORDER_TYPE_SELL if position.type == 0 else mt5.ORDER_TYPE_BUY,
        "position": ticket,
        "price": tick.bid if position.type == 0 else tick.ask,
        "deviation": 20,
        "magic": 234000,
        "comment": "Close by API",
        "type_time": mt5.ORDER_TIME_GTC,
        "type_filling": mt5.ORDER_FILLING_IOC,
    }

    result = mt5.order_send(request)

    if result.retcode != mt5.TRADE_RETCODE_DONE:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "Cierre falló",
                "comment": result.comment,
                "retcode": result.retcode
            }
        )

    logger.info(f"Posición {ticket} cerrada: {close_volume} lotes, profit: {position.profit}")

    return {
        "status": "closed",
        "ticket": ticket,
        "volume": close_volume,
        "profit": position.profit,
        "close_price": result.price
    }

@app.get("/trading/history")
def get_history(days: int = 7):
    """Obtiene historial de trades de los últimos N días"""
    if not ensure_connection():
        raise HTTPException(status_code=503, detail="MT5 no disponible")

    from datetime import datetime, timedelta

    # Calcular rango de fechas
    to_date = datetime.now()
    from_date = to_date - timedelta(days=days)

    # Obtener deals (trades ejecutados)
    deals = mt5.history_deals_get(from_date, to_date)

    if deals is None:
        logger.warning(f"Error obteniendo historial: {mt5.last_error()}")
        return []

    if len(deals) == 0:
        return []

    return [
        {
            "ticket": deal.ticket,
            "order": deal.order,
            "symbol": deal.symbol,
            "type": "BUY" if deal.type == 0 else "SELL",
            "volume": deal.volume,
            "price": deal.price,
            "profit": deal.profit,
            "commission": deal.commission,
            "swap": deal.swap,
            "comment": deal.comment,
            "time": deal.time
        }
        for deal in deals
    ]

# ====== MAIN ======

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", 8001))

    logger.info(f"Iniciando MT5 Bridge Server en puerto {port}")

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=port,
        log_level=os.getenv("LOG_LEVEL", "info").lower()
    )
```

---

### Dockerfile del MT5 Bridge

**Archivo:** `mt5-bridge/Dockerfile`

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema
RUN apt-get update && apt-get install -y \
    gcc \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copiar requirements
COPY requirements.txt .

# Instalar dependencias Python
RUN pip install --no-cache-dir -r requirements.txt

# Copiar código
COPY mt5_api_bridge.py .

# Exponer puerto
EXPOSE 8001

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8001/health || exit 1

# Comando de inicio
CMD ["python", "mt5_api_bridge.py"]
```

**Archivo:** `mt5-bridge/requirements.txt`

```txt
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
MetaTrader5>=5.0.45
python-dotenv>=1.0.0
pydantic>=2.0.0
httpx>=0.25.0
```

---

### Extensión del Backend FastAPI

**Archivo:** `backend/routers/trading.py` (nuevo router)

```python
"""
Router de Trading - Multi-Broker
Soporta Bybit (API REST) y Axi (MT5 via Bridge)
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional, List, Literal
import httpx
import os
from datetime import datetime

router = APIRouter(prefix="/api/trading", tags=["trading"])

# URLs de los servicios
MT5_BRIDGE_URL = os.getenv("MT5_BRIDGE_URL", "http://mt5-bridge:8001")
BYBIT_API_URL = "https://api.bybit.com"

# ====== MODELOS ======

class OrderRequest(BaseModel):
    broker: Literal["bybit", "axi"]
    symbol: str
    side: Literal["LONG", "SHORT", "BUY", "SELL"]
    volume: float
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    comment: str = "Manual Trade"

class OrderResponse(BaseModel):
    status: str
    broker: str
    ticket: str
    symbol: str
    side: str
    volume: float
    price: float
    timestamp: datetime

# ====== BROKER ROUTER ======

class BrokerRouter:
    """Rutea operaciones al broker correcto"""

    @staticmethod
    async def execute_trade(order: OrderRequest) -> OrderResponse:
        """Ejecuta trade en el broker especificado"""
        if order.broker == "bybit":
            return await BrokerRouter._execute_bybit(order)
        elif order.broker == "axi":
            return await BrokerRouter._execute_axi(order)
        else:
            raise ValueError(f"Broker no soportado: {order.broker}")

    @staticmethod
    async def _execute_bybit(order: OrderRequest) -> OrderResponse:
        """Ejecuta trade en Bybit (lógica existente)"""
        # Aquí iría tu código actual de Bybit
        # Simplificado para el ejemplo:

        from services.bybit_service import BybitService

        bybit = BybitService()
        result = await bybit.place_order(
            symbol=order.symbol,
            side=order.side,
            qty=order.volume,
            stop_loss=order.stop_loss,
            take_profit=order.take_profit
        )

        return OrderResponse(
            status="success",
            broker="bybit",
            ticket=result["orderId"],
            symbol=order.symbol,
            side=order.side,
            volume=order.volume,
            price=result["price"],
            timestamp=datetime.now()
        )

    @staticmethod
    async def _execute_axi(order: OrderRequest) -> OrderResponse:
        """Ejecuta trade en Axi via MT5 Bridge"""

        # Normalizar side (LONG/SHORT → BUY/SELL)
        mt5_side = "BUY" if order.side in ["LONG", "BUY"] else "SELL"

        # Llamar al MT5 Bridge
        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                response = await client.post(
                    f"{MT5_BRIDGE_URL}/trading/order",
                    json={
                        "symbol": order.symbol,
                        "side": mt5_side,
                        "volume": order.volume,
                        "sl": order.stop_loss or 0.0,
                        "tp": order.take_profit or 0.0,
                        "comment": order.comment
                    }
                )
                response.raise_for_status()
                result = response.json()

                return OrderResponse(
                    status="success",
                    broker="axi",
                    ticket=str(result["ticket"]),
                    symbol=order.symbol,
                    side=order.side,
                    volume=result["volume"],
                    price=result["price"],
                    timestamp=datetime.now()
                )

            except httpx.HTTPStatusError as e:
                error_detail = e.response.json()
                raise HTTPException(
                    status_code=e.response.status_code,
                    detail=f"MT5 Bridge error: {error_detail.get('detail', str(e))}"
                )
            except httpx.RequestError as e:
                raise HTTPException(
                    status_code=503,
                    detail=f"No se pudo conectar al MT5 Bridge: {str(e)}"
                )

    @staticmethod
    async def get_positions(broker: str) -> List[dict]:
        """Obtiene posiciones abiertas del broker"""
        if broker == "bybit":
            return await BrokerRouter._get_positions_bybit()
        elif broker == "axi":
            return await BrokerRouter._get_positions_axi()
        else:
            raise ValueError(f"Broker no soportado: {broker}")

    @staticmethod
    async def _get_positions_bybit() -> List[dict]:
        """Obtiene posiciones de Bybit"""
        from services.bybit_service import BybitService

        bybit = BybitService()
        positions = await bybit.get_positions()

        # Normalizar formato
        return [
            {
                "broker": "bybit",
                "ticket": pos["positionIdx"],
                "symbol": pos["symbol"],
                "type": "LONG" if pos["side"] == "Buy" else "SHORT",
                "volume": float(pos["size"]),
                "open_price": float(pos["avgPrice"]),
                "current_price": float(pos["markPrice"]),
                "sl": float(pos.get("stopLoss", 0)),
                "tp": float(pos.get("takeProfit", 0)),
                "profit": float(pos["unrealisedPnl"])
            }
            for pos in positions
            if float(pos["size"]) > 0
        ]

    @staticmethod
    async def _get_positions_axi() -> List[dict]:
        """Obtiene posiciones de Axi via MT5 Bridge"""
        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                response = await client.get(f"{MT5_BRIDGE_URL}/trading/positions")
                response.raise_for_status()
                positions = response.json()

                # Ya viene en formato normalizado desde el bridge
                return [
                    {**pos, "broker": "axi"}
                    for pos in positions
                ]

            except Exception as e:
                # Si el bridge no está disponible, retornar lista vacía
                # (no romper el sistema si Axi está offline)
                print(f"Warning: No se pudieron obtener posiciones de Axi: {e}")
                return []

# ====== ENDPOINTS ======

@router.post("/manual", response_model=OrderResponse)
async def execute_manual_trade(order: OrderRequest):
    """
    Ejecuta una orden manual en el broker especificado.

    Soporta:
    - Bybit (Futures via API REST)
    - Axi (MT5 CFDs via Bridge)
    """
    try:
        result = await BrokerRouter.execute_trade(order)

        # Registrar en Trading Journal (si existe)
        # await journal_service.log_trade(result)

        return result

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error ejecutando trade: {str(e)}")

@router.get("/positions/all")
async def get_all_positions():
    """
    Obtiene todas las posiciones abiertas de todos los brokers.

    Combina posiciones de Bybit y Axi en una sola respuesta.
    """
    bybit_positions = await BrokerRouter.get_positions("bybit")
    axi_positions = await BrokerRouter.get_positions("axi")

    all_positions = bybit_positions + axi_positions

    # Calcular totales
    total_profit = sum(pos["profit"] for pos in all_positions)

    return {
        "positions": all_positions,
        "count": len(all_positions),
        "bybit_count": len(bybit_positions),
        "axi_count": len(axi_positions),
        "total_profit": total_profit
    }

@router.get("/positions/{broker}")
async def get_broker_positions(broker: Literal["bybit", "axi"]):
    """Obtiene posiciones de un broker específico"""
    positions = await BrokerRouter.get_positions(broker)

    return {
        "broker": broker,
        "positions": positions,
        "count": len(positions)
    }

@router.get("/balance/{broker}")
async def get_broker_balance(broker: Literal["bybit", "axi"]):
    """Obtiene balance de un broker específico"""
    if broker == "bybit":
        from services.bybit_service import BybitService
        bybit = BybitService()
        balance = await bybit.get_balance()
        return balance

    elif broker == "axi":
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{MT5_BRIDGE_URL}/account/balance")
            response.raise_for_status()
            return response.json()

@router.patch("/positions/{broker}/{ticket}")
async def modify_position(
    broker: Literal["bybit", "axi"],
    ticket: str,
    sl: Optional[float] = None,
    tp: Optional[float] = None
):
    """Modifica SL/TP de una posición"""
    if broker == "bybit":
        from services.bybit_service import BybitService
        bybit = BybitService()
        result = await bybit.modify_position(ticket, sl, tp)
        return result

    elif broker == "axi":
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.patch(
                f"{MT5_BRIDGE_URL}/trading/order/{ticket}",
                json={"sl": sl, "tp": tp}
            )
            response.raise_for_status()
            return response.json()

@router.delete("/positions/{broker}/{ticket}")
async def close_position(
    broker: Literal["bybit", "axi"],
    ticket: str,
    volume: Optional[float] = None
):
    """Cierra una posición"""
    if broker == "bybit":
        from services.bybit_service import BybitService
        bybit = BybitService()
        result = await bybit.close_position(ticket)
        return result

    elif broker == "axi":
        url = f"{MT5_BRIDGE_URL}/trading/order/{ticket}"
        if volume:
            url += f"?volume={volume}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.delete(url)
            response.raise_for_status()
            return response.json()
```

**Registrar el router en `main.py`:**

```python
# backend/main.py

from fastapi import FastAPI
from routers import trading  # nuevo import

app = FastAPI()

# Registrar router
app.include_router(trading.router)

# ... resto del código
```

---

## 🚀 DEPLOYMENT EN VPS

### Paso 1: Contratar VPS

**Proveedores recomendados:**

| Proveedor | Plan | Precio | Link |
|-----------|------|--------|------|
| **Hetzner** | CX21 (4GB RAM, 2 vCPU) | €5.83/mes | hetzner.com |
| **Vultr** | High Performance (4GB RAM) | $12/mes | vultr.com |
| **Contabo** | VPS S (8GB RAM) | $6.99/mes | contabo.com |

**Sistema operativo:** Ubuntu 22.04 LTS

---

### Paso 2: Configuración Inicial del VPS

```bash
# SSH al servidor
ssh root@tu_ip_vps

# Actualizar sistema
apt update && apt upgrade -y

# Instalar Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh

# Instalar Docker Compose
apt install docker-compose -y

# Verificar instalación
docker --version
docker-compose --version

# Crear usuario no-root (opcional pero recomendado)
adduser trading
usermod -aG sudo trading
usermod -aG docker trading

# Cambiar a usuario trading
su - trading
```

---

### Paso 3: Subir Código al VPS

**Opción A: Git (recomendado)**

```bash
# En el VPS
cd /opt
sudo mkdir trading-platform
sudo chown trading:trading trading-platform
cd trading-platform

# Clonar repo (si tienes el código en GitHub)
git clone https://github.com/tu-usuario/trading-platform.git .

# O crear estructura manual
mkdir -p mt5-bridge backend nginx
```

**Opción B: SCP (copiar archivos locales)**

```bash
# Desde tu PC local
scp -r ./trading-platform root@tu_ip_vps:/opt/
```

---

### Paso 4: Crear Archivos de Configuración

```bash
# En el VPS: /opt/trading-platform

# Crear .env
nano .env
# Pegar configuración (ver sección anterior)

# Crear docker-compose.yml
nano docker-compose.yml
# Pegar configuración (ver sección anterior)

# Crear estructura de directorios
mkdir -p mt5-bridge backend nginx/ssl logs
```

---

### Paso 5: Configurar SSL (Let's Encrypt)

```bash
# Instalar Certbot
apt install certbot python3-certbot-nginx -y

# Obtener certificado SSL
# IMPORTANTE: Tu dominio debe apuntar a la IP del VPS
certbot certonly --standalone -d trading.tudominio.com

# Certificados se guardan en:
# /etc/letsencrypt/live/trading.tudominio.com/fullchain.pem
# /etc/letsencrypt/live/trading.tudominio.com/privkey.pem

# Copiar a proyecto
cp /etc/letsencrypt/live/trading.tudominio.com/fullchain.pem nginx/ssl/cert.pem
cp /etc/letsencrypt/live/trading.tudominio.com/privkey.pem nginx/ssl/key.pem

# Auto-renovación (cron)
crontab -e
# Agregar:
# 0 3 * * * certbot renew --quiet && cp /etc/letsencrypt/live/trading.tudominio.com/*.pem /opt/trading-platform/nginx/ssl/
```

---

### Paso 6: Configurar Nginx

**Archivo:** `nginx/nginx.conf`

```nginx
events {
    worker_connections 1024;
}

http {
    upstream backend {
        server backend:10001;  # App 8
    }

    # Redirect HTTP to HTTPS
    server {
        listen 80;
        server_name trading.tudominio.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS
    server {
        listen 443 ssl http2;
        server_name trading.tudominio.com;

        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers HIGH:!aNULL:!MD5;

        # App 8 - Analizador
        location /analyzer/ {
            proxy_pass http://backend:10001/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # WebSocket support
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }

        # App 9 - Order Flow
        location /orderflow/ {
            proxy_pass http://backend:11000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # App 10 - Trading Bot
        location /bot/ {
            proxy_pass http://backend:5000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # App 11 - Journal
        location /journal/ {
            proxy_pass http://backend:12000/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # API endpoints
        location /api/ {
            proxy_pass http://backend:10001/api/;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
        }

        # MT5 noVNC (opcional, para configuración)
        location /mt5vnc/ {
            proxy_pass http://metatrader5:6080/;
            proxy_set_header Host $host;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }
}
```

---

### Paso 7: Iniciar Servicios

```bash
# En /opt/trading-platform

# Build de imágenes
docker-compose build

# Iniciar servicios
docker-compose up -d

# Ver logs
docker-compose logs -f

# Ver estado
docker-compose ps

# Deberías ver:
# metatrader5    running   0.0.0.0:6080->6080/tcp
# mt5-bridge     running   0.0.0.0:8001->8001/tcp
# backend        running   múltiples puertos
# nginx          running   0.0.0.0:80,443->80,443/tcp
# postgres       running
# redis          running
```

---

### Paso 8: Configurar MT5 por Primera Vez

```bash
# Acceder a noVNC en navegador
https://trading.tudominio.com/mt5vnc/

# O directamente a la IP:
http://tu_ip_vps:6080

# Password VNC: (el que pusiste en .env)

# En la interfaz de MT5:
1. Click en "File" → "Login to Trade Account"
2. Ingresar credenciales de Axi:
   - Login: 12345678
   - Password: tu_password
   - Server: Axi-Demo (o Axi-Real)
3. Click "OK"
4. Verificar conexión (esquina inferior derecha debe mostrar ping)
5. Habilitar auto-trading:
   - Tools → Options → Expert Advisors
   - Marcar "Allow automated trading"
   - Click "OK"
6. Cerrar ventana VNC (MT5 queda corriendo en background)
```

**IMPORTANTE:** Esta configuración solo se hace UNA VEZ. MT5 guardará las credenciales en el volumen Docker.

---

### Paso 9: Verificar Funcionamiento

```bash
# Test 1: Health check del MT5 Bridge
curl http://localhost:8001/health
# Debe retornar: {"status":"ok","mt5_connected":true,...}

# Test 2: Balance de Axi
curl http://localhost:8001/account/balance
# Debe retornar: {"balance":10000.0,"equity":10000.0,...}

# Test 3: Precio de BTCUSD
curl http://localhost:8001/market/price/BTCUSD
# Debe retornar: {"symbol":"BTCUSD","bid":67234.5,"ask":67236.2,...}

# Test 4: Backend conecta al bridge
curl http://localhost:10001/api/trading/balance/axi
# Debe retornar balance de Axi

# Test 5: Acceso externo (desde tu navegador)
https://trading.tudominio.com/analyzer/
# Debe cargar App 8
```

---

### Paso 10: Configurar Backups Automáticos

```bash
# Crear script de backup
nano /opt/trading-platform/backup.sh
```

```bash
#!/bin/bash

BACKUP_DIR="/backup/trading-$(date +%Y%m%d_%H%M%S)"
mkdir -p $BACKUP_DIR

echo "Iniciando backup: $BACKUP_DIR"

# Backup de volúmenes Docker
docker run --rm \
  -v trading-platform_mt5_data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/mt5_data.tar.gz -C /data .

docker run --rm \
  -v trading-platform_backend_data:/data \
  -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/backend_data.tar.gz -C /data .

# Backup de base de datos
docker exec postgres-db pg_dump -U trading trading | gzip > $BACKUP_DIR/postgres.sql.gz

# Backup de configuración
cp /opt/trading-platform/.env $BACKUP_DIR/.env.backup
cp /opt/trading-platform/docker-compose.yml $BACKUP_DIR/docker-compose.yml.backup

# Eliminar backups >7 días
find /backup -type d -mtime +7 -exec rm -rf {} \;

echo "Backup completado: $BACKUP_DIR"
```

```bash
# Dar permisos de ejecución
chmod +x /opt/trading-platform/backup.sh

# Programar backup diario a las 2 AM
crontab -e
# Agregar:
0 2 * * * /opt/trading-platform/backup.sh >> /var/log/trading-backup.log 2>&1
```

---

## 📅 OPERACIÓN DÍA A DÍA

### Flujo de Usuario Típico

#### 8:00 AM - Inicio del día

1. **Usuario abre navegador**
   ```
   https://trading.tudominio.com/analyzer/
   ```

2. **Dashboard muestra:**
   ```
   ┌─────────────────────────────────────────┐
   │ Balance Bybit:  $50,000.00  ✅          │
   │ Balance Axi:    $10,000.00  ✅          │
   │ Posiciones abiertas: 3                  │
   └─────────────────────────────────────────┘
   ```

3. **Frontend hace requests automáticos:**
   ```javascript
   // Cada 30s
   GET /api/trading/balance/bybit
   GET /api/trading/balance/axi

   // Cada 5s
   GET /api/positions/all
   ```

---

#### 10:30 AM - Señal de trading detectada

1. **App 9 (Order Flow) detecta imbalance**

2. **Usuario decide ejecutar en Axi:**
   - Click en selector: "Broker: Axi"
   - Click en "Ejecutar Trade"

3. **Frontend envía:**
   ```javascript
   POST /api/trading/manual
   {
     "broker": "axi",
     "symbol": "BTCUSDT",
     "side": "LONG",
     "volume": 0.1,
     "stop_loss": 66800,
     "take_profit": 68000
   }
   ```

4. **Backend procesa:**
   ```python
   # Detecta broker === "axi"
   → Llama a MT5 Bridge
   → MT5 Bridge ejecuta en MT5
   → MT5 envía orden a Axi
   → Axi ejecuta en mercado
   → Respuesta vuelve al frontend
   ```

5. **UI muestra confirmación:**
   ```
   ✅ Orden ejecutada en Axi
   Ticket: #123456789
   Entry: $67,250.00
   ```

---

#### 2:00 PM - Modificar Stop Loss

1. **Usuario en App 10 (Trading Bot Dashboard)**
   - Ve lista de posiciones
   - Click derecho en posición de Axi
   - "Modificar SL/TP"

2. **Modal se abre:**
   ```
   Nuevo SL: $67,250 (breakeven)
   Nuevo TP: $68,500 (extender)
   ```

3. **Click "Aplicar":**
   ```javascript
   PATCH /api/positions/axi/123456789
   { "sl": 67250, "tp": 68500 }
   ```

4. **Confirmación:**
   ```
   ✅ Posición modificada
   SL movido a breakeven
   ```

---

#### 4:30 PM - Take Profit alcanzado

1. **MT5 cierra posición automáticamente (servidor de Axi)**

2. **Backend polling detecta cierre (próximo check en 10s)**

3. **Frontend actualiza (próximo refresh en 5s)**

4. **Notificación push:**
   ```
   🎉 Take Profit Alcanzado
   BTCUSDT LONG cerrado @ $68,500
   Profit: +$125.00 (+1.86%)
   Broker: Axi
   ```

5. **Trading Journal se actualiza automáticamente**

---

#### 8:00 PM - Activar bot nocturno

1. **Usuario en App 10 → Settings:**
   ```
   Horario: 00:00 - 06:00 UTC
   Brokers: ☑️ Bybit  ☐ Axi (desactivar)
   Estrategia: Order Flow Imbalance
   Risk: 1% per trade
   Max Trades: 3
   ```

2. **Click "Activar Bot"**

3. **Bot opera automáticamente durante la noche en Bybit**
   - Usuario duerme
   - Bot detecta señales
   - Ejecuta trades en Bybit
   - Registra en Journal

---

### Actualizaciones Automáticas (Sin Intervención)

| Frecuencia | Acción | Endpoint |
|------------|--------|----------|
| **Cada 5s** | Actualizar posiciones abiertas | GET /api/positions/all |
| **Cada 10s** | Polling de MT5 (detectar cierres) | GET /trading/positions (MT5 Bridge) |
| **Cada 30s** | Actualizar balances | GET /api/trading/balance/{broker} |
| **Cada 60s** | Verificar salud de servicios | GET /health (todos) |
| **Cada 2min** | Backup incremental (logs) | Script interno |

---

### Mantenimiento Semanal (5 minutos)

```bash
# SSH al VPS
ssh trading@tu_ip_vps

# Ver logs de la semana
cd /opt/trading-platform
docker-compose logs --since 7d > logs/weekly_$(date +%Y%m%d).log

# Ver uso de recursos
docker stats --no-stream

# Verificar espacio en disco
df -h

# Ver backups recientes
ls -lh /backup | tail -10

# Restart de servicios (si necesario)
docker-compose restart mt5-bridge
```

---

## 🔧 TROUBLESHOOTING

### Problema 1: MT5 Bridge no conecta

**Síntomas:**
```
GET /health → {"mt5_connected": false}
```

**Diagnóstico:**
```bash
# Ver logs del bridge
docker logs mt5-bridge --tail 100

# Posibles causas:
# 1. MT5 terminal no está corriendo
# 2. Credenciales incorrectas
# 3. Servidor Axi offline
```

**Solución:**
```bash
# Reiniciar MT5 terminal
docker-compose restart metatrader5

# Esperar 30s y verificar
docker exec mt5-terminal pgrep -f terminal64.exe

# Si no hay proceso, acceder a VNC y revisar
# https://trading.tudominio.com/mt5vnc/
```

---

### Problema 2: Frontend no muestra posiciones de Axi

**Síntomas:**
```
Dashboard muestra:
Bybit: 2 posiciones ✅
Axi: 0 posiciones (pero hay 1 abierta en MT5)
```

**Diagnóstico:**
```bash
# Test directo al bridge
curl http://localhost:8001/trading/positions

# Si retorna vacío pero hay posición en MT5:
# Verificar que el symbol en MT5 coincide con el esperado
```

**Solución:**
```python
# Los símbolos en MT5 pueden tener sufijos
# Ejemplo: "BTCUSD" en MT5 vs "BTCUSDT" en Bybit

# Solución en mt5_api_bridge.py:
@app.get("/trading/positions")
def get_positions():
    positions = mt5.positions_get()

    return [
        {
            "symbol": pos.symbol.replace(".a", ""),  # Remover sufijos
            # ... resto
        }
        for pos in positions
    ]
```

---

### Problema 3: Orden de trading falla

**Síntomas:**
```
POST /api/trading/manual
→ 500 Error: "Orden falló: Invalid volume"
```

**Diagnóstico:**
```bash
# Ver logs del bridge
docker logs mt5-bridge --tail 50 | grep "Orden falló"

# Revisar detalles del error en MT5
```

**Causas comunes:**

| Error | Causa | Solución |
|-------|-------|----------|
| Invalid volume | Volumen mínimo no cumplido | Verificar specs del símbolo |
| Invalid stops | SL/TP muy cerca del precio | Aumentar distancia mínima |
| Not enough money | Balance insuficiente | Reducir volumen |
| Market closed | Mercado cerrado | Verificar horarios de trading |
| Trade not allowed | Auto-trading deshabilitado | Habilitar en MT5 Options |

**Solución (agregar validaciones):**
```python
# mt5_api_bridge.py - Agregar antes de order_send()

symbol_info = mt5.symbol_info(order.symbol)
if symbol_info is None:
    raise HTTPException(404, f"Símbolo {order.symbol} no encontrado")

# Validar volumen mínimo
if order.volume < symbol_info.volume_min:
    raise HTTPException(
        400,
        f"Volumen mínimo: {symbol_info.volume_min}, recibido: {order.volume}"
    )

# Validar distancia mínima de SL/TP
min_distance = symbol_info.trade_stops_level * symbol_info.point
if order.sl > 0:
    sl_distance = abs(price - order.sl)
    if sl_distance < min_distance:
        raise HTTPException(
            400,
            f"SL muy cerca. Mínimo: {min_distance}, actual: {sl_distance}"
        )
```

---

### Problema 4: VPS se queda sin espacio

**Síntomas:**
```bash
df -h
# /dev/vda1  40G  39G  0  100% /
```

**Diagnóstico:**
```bash
# Ver qué consume espacio
du -sh /opt/trading-platform/* | sort -h

# Posibles culpables:
# - Logs sin rotación
# - Backups antiguos no eliminados
# - Volúmenes Docker grandes
```

**Solución:**
```bash
# Limpiar logs antiguos
find /opt/trading-platform/logs -name "*.log" -mtime +7 -delete

# Limpiar backups antiguos (si cron falló)
find /backup -type d -mtime +7 -exec rm -rf {} \;

# Limpiar imágenes Docker sin usar
docker system prune -a

# Rotar logs de Docker
cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

systemctl restart docker
```

---

### Problema 5: Latencia alta en ejecución de órdenes

**Síntomas:**
```
Orden tarda 5-10 segundos en ejecutarse
```

**Diagnóstico:**
```bash
# Medir latencia de cada componente
time curl http://localhost:8001/health  # Bridge
time curl http://localhost:10001/api/trading/balance/axi  # Backend

# Ping a servidor de Axi
ping -c 5 axi-demo.axi.com
```

**Soluciones:**

1. **VPS en mala ubicación geográfica**
   ```
   Axi servers: Londres, UK
   Tu VPS: Nueva York, US
   Latencia: 70ms

   → Cambiar VPS a Europa (Hetzner Alemania: 10ms)
   ```

2. **MT5 Terminal sobrecargado**
   ```bash
   # Ver uso de CPU/RAM
   docker stats mt5-terminal

   # Si >90%, aumentar recursos del VPS
   # O reducir número de símbolos watchlist en MT5
   ```

3. **Backend hace requests síncronos**
   ```python
   # Cambiar de:
   result = await client.post(...)  # Bloquea

   # A:
   async with asyncio.TaskGroup() as tg:
       task = tg.create_task(client.post(...))
   ```

---

## 💰 COSTOS Y RECURSOS

### Costos Mensuales

| Item | Opción Básica | Opción Pro | Notas |
|------|---------------|------------|-------|
| **VPS** | Hetzner CX21: €5.83 | Vultr High Perf: $12 | 4GB RAM, 2 vCPU |
| **Dominio** | Namecheap: $1/mes | Mismo | .com o .io |
| **SSL** | Let's Encrypt: $0 | Mismo | Gratis, auto-renew |
| **Backup Storage** | En VPS: $0 | Backblaze B2: ~$1 | Opcional |
| **Monitoreo** | Docker logs: $0 | Datadog: $15 | Opcional |
| **CDN** | No necesario: $0 | Cloudflare Pro: $20 | Opcional |
| **TOTAL** | **~$7/mes** | **~$30/mes** | |

**Comparación con PC 24/7:**
- Consumo eléctrico PC: 100W × 24h × 30d × €0.15/kWh = €10.80/mes
- **VPS es más barato y profesional** ✅

---

### Recursos del Sistema

**Uso típico de recursos (4GB VPS):**

| Contenedor | RAM | CPU | Disco |
|------------|-----|-----|-------|
| metatrader5 | 800 MB | 15% | 2 GB |
| mt5-bridge | 150 MB | 5% | 50 MB |
| backend | 600 MB | 20% | 500 MB |
| postgres | 200 MB | 5% | 1 GB |
| redis | 50 MB | 2% | 100 MB |
| nginx | 50 MB | 3% | 10 MB |
| **Total** | **~2 GB** | **50%** | **~4 GB** |

**Margen de seguridad:** ✅ 50% RAM libre, 50% CPU libre

---

### Escalabilidad

**Si necesitas agregar más brokers:**

```yaml
# docker-compose.yml

# Agregar segundo terminal MT5 (IC Markets)
metatrader5-ic:
  image: marketcalls/meta-docker
  environment:
    - MT5_ACCOUNT=87654321
    - MT5_SERVER=ICMarkets-Demo
  ports:
    - "6081:6080"

# Agregar segundo bridge
mt5-bridge-ic:
  build: ./mt5-bridge
  environment:
    - MT5_HOST=metatrader5-ic
  ports:
    - "8002:8001"
```

**Costo adicional:** $0 (mismo VPS soporta 2-3 brokers MT5)

---

## 📚 ANEXOS

### A. Checklist de Implementación

```
☐ Día 1: Setup VPS
  ☐ Contratar VPS (Hetzner/Vultr)
  ☐ Instalar Docker + Docker Compose
  ☐ Configurar firewall (puertos 80, 443)
  ☐ Apuntar dominio a IP del VPS

☐ Día 2: Deployment
  ☐ Subir código al VPS (git clone o scp)
  ☐ Crear archivo .env con credenciales
  ☐ Obtener certificado SSL (certbot)
  ☐ docker-compose up -d

☐ Día 2: Configuración MT5
  ☐ Acceder a noVNC (puerto 6080)
  ☐ Login a cuenta de Axi
  ☐ Habilitar auto-trading
  ☐ Verificar conexión

☐ Día 3: Testing
  ☐ Test de health checks
  ☐ Test de balance
  ☐ Test de precio
  ☐ Test de orden (demo account)
  ☐ Test desde frontend

☐ Día 3: Extensión del Backend
  ☐ Agregar router de trading
  ☐ Implementar BrokerRouter
  ☐ Agregar endpoints multi-broker
  ☐ Testing de integración

☐ Día 4: Extensión del Frontend
  ☐ Agregar selector de broker en UI
  ☐ Modificar TradingPanel
  ☐ Actualizar dashboard de posiciones
  ☐ Testing end-to-end

☐ Día 5: Producción
  ☐ Configurar backups automáticos
  ☐ Configurar monitoreo
  ☐ Documentar runbooks
  ☐ Training del usuario
```

---

### B. Comandos Útiles

```bash
# ====== DOCKER ======

# Ver logs en tiempo real
docker-compose logs -f

# Ver logs de un servicio específico
docker-compose logs -f mt5-bridge

# Reiniciar un servicio
docker-compose restart mt5-bridge

# Rebuild de un servicio
docker-compose up -d --build mt5-bridge

# Ver estado de servicios
docker-compose ps

# Ver uso de recursos
docker stats

# Entrar a un contenedor
docker exec -it mt5-bridge bash

# Limpiar todo y empezar de cero
docker-compose down -v
docker-compose up -d

# ====== MT5 BRIDGE ======

# Health check
curl http://localhost:8001/health | jq

# Balance
curl http://localhost:8001/account/balance | jq

# Precio
curl http://localhost:8001/market/price/BTCUSD | jq

# Posiciones
curl http://localhost:8001/trading/positions | jq

# Ejecutar orden (test)
curl -X POST http://localhost:8001/trading/order \
  -H "Content-Type: application/json" \
  -d '{
    "symbol": "BTCUSD",
    "side": "BUY",
    "volume": 0.01,
    "sl": 66000,
    "tp": 70000
  }' | jq

# ====== NGINX ======

# Test de configuración
docker exec nginx-proxy nginx -t

# Reload de configuración (sin downtime)
docker exec nginx-proxy nginx -s reload

# Ver logs de acceso
docker exec nginx-proxy tail -f /var/log/nginx/access.log

# Ver logs de errores
docker exec nginx-proxy tail -f /var/log/nginx/error.log

# ====== SISTEMA ======

# Ver espacio en disco
df -h

# Ver uso de RAM
free -h

# Ver procesos que más consumen
top

# Ver tamaño de directorios
du -sh /opt/trading-platform/*

# Ver logs del sistema
journalctl -u docker -f

# ====== BACKUPS ======

# Backup manual
/opt/trading-platform/backup.sh

# Listar backups
ls -lh /backup

# Restaurar backup (ejemplo)
docker run --rm \
  -v trading-platform_mt5_data:/data \
  -v /backup/trading-20261031:/backup \
  alpine tar xzf /backup/mt5_data.tar.gz -C /data
```

---

### C. Recursos Adicionales

**Documentación oficial:**
- MetaTrader 5 Python: https://www.mql5.com/en/docs/python_metatrader5
- FastAPI: https://fastapi.tiangolo.com/
- Docker Compose: https://docs.docker.com/compose/
- Nginx: https://nginx.org/en/docs/

**Comunidad:**
- MetaTrader Forum: https://www.mql5.com/en/forum
- FastAPI Discord: https://discord.gg/fastapi
- Trading Discord: (tu comunidad)

**Herramientas:**
- Postman (testing API): https://www.postman.com/
- Portainer (Docker GUI): https://www.portainer.io/
- Grafana (monitoreo): https://grafana.com/

---

## ✅ CONCLUSIÓN

Este documento proporciona una guía completa para implementar la **Opción Híbrida** que permite integrar **Axi MT5** con tus aplicaciones de trading existentes.

**Puntos clave:**

1. ✅ **NO requiere Claude** - Sistema 100% independiente
2. ✅ **Multi-broker** - Bybit + Axi en misma UI
3. ✅ **100% automatizable** - Bots pueden operar 24/7
4. ✅ **Bajo costo** - ~$7/mes de hosting
5. ✅ **Escalable** - Fácil agregar más brokers MT5
6. ✅ **Profesional** - Docker, HTTPS, backups automáticos

**Tiempo de implementación:** 3-5 días de trabajo

**Próximos pasos:**
1. Leer este documento completo
2. Contratar VPS
3. Seguir checklist de implementación
4. Testing en cuenta demo
5. Deployment en producción

**Soporte:** Si encuentras problemas durante la implementación, revisar sección de Troubleshooting o consultar logs del sistema.

---

**Versión:** 1.0
**Última actualización:** 31 Octubre 2026
**Autor:** Claude Code
**Licencia:** Uso interno

---
