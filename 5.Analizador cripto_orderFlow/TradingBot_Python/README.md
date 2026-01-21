# 🚀 Trading Bot - Bybit Automation Platform

> **Aplicación completa de trading automatizado para Bybit con interfaz web moderna + Integración con Watchlist**

**Versión 1.1.0**

Reemplazo completo del bot de C# con una arquitectura moderna en Python + React, diseñado para ejecutar trades automáticos basados en alertas ATAS y alertas de watchlist con gestión de riesgo integrada.

---

## 📋 Tabla de Contenidos

- [Características](#-características)
- [Tecnologías](#-tecnologías)
- [Inicio Rápido](#-inicio-rápido)
- [Arquitectura](#-arquitectura)
- [Configuración](#-configuración)
- [Uso](#-uso)
- [API Reference](#-api-reference)
- [Troubleshooting](#-troubleshooting)

---

## ✨ Características

### Core Trading
- ✅ **Ejecución automática de órdenes**: Market + Stop Loss + Take Profit
- ✅ **Parser de alertas ATAS**: Extracción inteligente de símbolo, dirección y precio
- ✅ **Integración con Watchlist**: Recibe alertas automáticas en formato JSON
- ✅ **Gestión de riesgo**: Cálculo automático de cantidades basado en riesgo fijo
- ✅ **Filtros de dirección**: LONG/SHORT/BOTH/DISABLED por símbolo
- ✅ **Verificación de posiciones**: Prevención de posiciones duplicadas
- ✅ **StepSize/TickSize exactos**: Mapeo de 16 símbolos principales
- ✅ **Historial permanente**: Órdenes guardadas en disco indefinidamente

### Sistema de Órdenes
- **Market Orders** con captura de precio real de ejecución
- **Stop Loss** con trigger direccional correcto (LastPrice)
- **Take Profit** con órdenes limit y reduceOnly
- **Reintentos automáticos** (hasta 3 intentos con backoff)
- **Sincronización de timestamp** para prevenir errores 10002

### Interfaz Web
- 🎨 **Dark Theme profesional** con diseño responsive
- 📊 **Dashboard en tiempo real** con WebSocket
- 📈 **Panel de posiciones** con auto-refresh
- 🔔 **Panel de alertas** con procesamiento manual
- 📋 **Historial de órdenes** con persistencia permanente
- ⚙️ **Gestor de configuraciones** con edición inline
- 🎯 **Gestor de direcciones** con actualización instantánea
- 📜 **Logs en tiempo real** con colores por nivel
- 🗑️ **Control de historial** con botón Clear History

### Seguridad
- 🔐 Credenciales API configurables (Testnet/Live)
- 🛡️ Validación completa de inputs
- 🚫 Prevención de órdenes duplicadas
- ⚠️ Alertas de errores en tiempo real

---

## 🛠 Tecnologías

### Backend
- **FastAPI** 0.115.0 - Framework web async
- **Uvicorn** 0.32.0 - ASGI server
- **HTTPX** 0.27.2 - Cliente HTTP async
- **Pydantic** 2.9.2 - Validación de datos
- **WebSockets** 13.1 - Comunicación en tiempo real

### Frontend
- **React** 18.3.1 - UI library
- **Vite** 5.4.2 - Build tool
- **Lucide React** 0.460.0 - Iconos modernos

### Exchange
- **Bybit API v5** - Trading en USDT Perpetual Futures

---

## 🚀 Inicio Rápido

### Requisitos Previos

- **Python 3.10+** instalado
- **Node.js 18+** y npm instalado
- **Cuenta Bybit** con API keys (recomendado Testnet para pruebas)

### Instalación en 3 Pasos

#### 1️⃣ Doble clic en `START_HERE.bat`

Este script:
- Crea el entorno virtual de Python
- Instala dependencias del backend
- Instala dependencias del frontend
- Inicia ambos servidores automáticamente

#### 2️⃣ Accede a la aplicación

```
Frontend: http://localhost:3000
Backend:  http://localhost:5000
API Docs: http://localhost:5000/docs
```

#### 3️⃣ Configura tus credenciales

1. Ve a la pestaña "Dashboard"
2. En el panel "Credentials", ingresa:
   - **API Key** de Bybit
   - **API Secret** de Bybit
   - Selecciona **Testnet** (recomendado para pruebas)
3. Click en "Save Credentials"

¡Listo! 🎉

---

## 📐 Arquitectura

```
TradingBot_Python/
│
├── backend/                    # Backend FastAPI
│   ├── trading/               # Módulos de trading
│   │   ├── __init__.py
│   │   ├── bybit_client.py    # Cliente Bybit con firma HMAC
│   │   ├── order_manager.py    # Gestor de órdenes (Market/SL/TP)
│   │   ├── risk_calculator.py  # Calculadora de riesgo
│   │   ├── direction_manager.py # Filtros LONG/SHORT/BOTH
│   │   └── alert_parser.py     # Parser de alertas ATAS
│   ├── logs/                   # Logs del sistema
│   ├── main.py                 # Aplicación principal FastAPI
│   └── requirements.txt        # Dependencias Python
│
├── frontend/                   # Frontend React
│   ├── src/
│   │   ├── components/        # Componentes React
│   │   │   ├── CredentialsPanel.jsx
│   │   │   ├── DirectionManager.jsx
│   │   │   ├── ConfigManager.jsx
│   │   │   ├── AlertPanel.jsx
│   │   │   ├── LogsPanel.jsx
│   │   │   ├── PositionsPanel.jsx
│   │   │   └── components.css
│   │   ├── App.jsx            # Componente raíz
│   │   ├── App.css
│   │   ├── main.jsx
│   │   └── index.css
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── config/                     # Configuraciones
│   ├── trading_config.json    # Config por símbolo (Risk, SL%, TP%)
│   └── trading_directions.json # Direcciones permitidas
│
├── START_HERE.bat              # 🚀 Inicio rápido (doble click)
├── start_backend.bat           # Iniciar solo backend
├── start_frontend.bat          # Iniciar solo frontend
└── README.md                   # Este archivo
```

---

## ⚙️ Configuración

### 1. Configuración de Símbolos (`config/trading_config.json`)

Cada símbolo tiene su propia configuración:

```json
{
  "symbol": "BTCUSDT",
  "category": "linear",
  "risk_amount": 3.0,           // Riesgo por trade (USDT)
  "stop_loss_percent": 0.022,   // 2.2% stop loss
  "take_profit_percent": 0.045, // 4.5% take profit
  "leverage": 10,
  "step_size": 0.001,           // Precisión de cantidad
  "tick_size": 0.10,            // Precisión de precio
  "min_qty": 0.001,
  "max_qty": 100.0
}
```

**Editable desde la UI**: Pestaña "Configuration"

### 2. Direcciones de Trading (`config/trading_directions.json`)

Control de qué dirección está permitida por símbolo:

```json
{
  "BTCUSDT": "BOTH",      // Permite LONG y SHORT
  "ETHUSDT": "LONG",      // Solo LONG
  "SOLUSDT": "SHORT",     // Solo SHORT
  "ADAUSDT": "DISABLED"   // Deshabilitado
}
```

**Editable desde la UI**: Dashboard → Trading Directions

### 3. Credenciales API

**Configuración vía UI** (recomendado):
1. Dashboard → Credentials Panel
2. Ingresar API Key y Secret
3. Seleccionar Testnet/Live

---

## 📖 Uso

### Flujo de Trading Automático

#### 1. **Recibir Alerta ATAS**

Formato esperado:
```
[2025-01-20 14:30:00] [BTCUSDT] ABRIR LONG 95000
[2025-01-20 14:30:00] [ETHUSDT] OPEN SHORT 3500.5
```

#### 2. **Procesar Alerta**

En la pestaña "Alerts":
1. Pega la alerta en el textarea
2. Click "Process Alert"
3. El sistema automáticamente:
   - Parsea símbolo, dirección y precio
   - Valida con filtro de direcciones
   - Verifica posición existente
   - Calcula cantidad basada en riesgo
   - Ejecuta Market → SL → TP

#### 3. **Monitoreo**

- **Logs**: Ver ejecución en tiempo real
- **Positions**: Verificar posiciones abiertas
- **WebSocket**: Actualizaciones instantáneas

### Trade Manual

Si quieres ejecutar un trade manualmente:

1. Pestaña "Alerts" → Click "Manual Trade"
2. Completa el modal:
   - **Symbol**: BTCUSDT
   - **Side**: Buy/Sell
   - **Current Price**: 95000
3. Click "Execute Trade"

---

## 🔌 API Reference

### REST Endpoints

#### **Status**
```http
GET /api/status
```

Response:
```json
{
  "status": "online",
  "credentials_configured": true,
  "symbols_configured": 16,
  "active_connections": 2
}
```

#### **Set Credentials**
```http
POST /api/credentials
Content-Type: application/json

{
  "api_key": "your_api_key",
  "api_secret": "your_api_secret",
  "testnet": true
}
```

#### **Process Alert (ATAS Format)**
```http
POST /api/alert
Content-Type: application/json

{
  "raw_alert": "[2025-01-20] [BTCUSDT] ABRIR LONG 95000"
}
```

#### **Process Watchlist Alert** ⭐ NEW
```http
POST /api/watchlist-alert
Content-Type: application/json

{
  "pattern": "HAMMER (ABRIR LONG)",
  "symbol": "BTCUSDT",
  "price": 45000.5,
  "confidence": 85.5
}
```

Response:
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "side": "Buy",
  "price": 45000.5,
  "quantity": 0.0012,
  "pattern": "HAMMER (ABRIR LONG)",
  "confidence": 85.5,
  "result": { ... }
}
```

> 📖 Ver [WATCHLIST_INTEGRATION.md](WATCHLIST_INTEGRATION.md) para más detalles

#### **Get Configuration**
```http
GET /api/config
```

#### **Update Configuration**
```http
POST /api/config/update
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "risk_amount": 5.0,
  "stop_loss_percent": 0.025,
  "take_profit_percent": 0.05
}
```

#### **Get Trading Directions**
```http
GET /api/directions
```

#### **Update Direction**
```http
POST /api/directions/update
Content-Type: application/json

{
  "symbol": "BTCUSDT",
  "direction": "BOTH"  // LONG | SHORT | BOTH | DISABLED
}
```

#### **Get Position**
```http
GET /api/position/{symbol}
```

#### **Get Logs**
```http
GET /api/logs?limit=100
```

#### **Get Order History** ⭐ NEW
```http
GET /api/orders/history?limit=100
```

Response:
```json
{
  "success": true,
  "orders": [
    {
      "timestamp": "2025-01-23T15:30:45.123456",
      "symbol": "BTCUSDT",
      "side": "Buy",
      "entry_price": 45000.5,
      "quantity_coin": 0.0012,
      "quantity_usdt": 54.0,
      "stop_loss": 44000.0,
      "take_profit": 47000.0,
      "pattern": "HAMMER (ABRIR LONG)",
      "confidence": 85.5,
      "status": "success"
    }
  ],
  "total": 150
}
```

#### **Clear Order History** ⭐ NEW
```http
DELETE /api/orders/history
```

Response:
```json
{
  "success": true,
  "message": "Cleared 150 orders from history",
  "deleted_count": 150
}
```

> ⚠️ **Nota:** El historial se guarda permanentemente en `config/order_history.json` hasta que el usuario decida borrarlo.

### WebSocket

```javascript
const ws = new WebSocket('ws://localhost:5000/ws')

ws.onmessage = (event) => {
  const message = JSON.parse(event.data)

  if (message.type === 'log') {
    console.log(message.data)
  }

  if (message.type === 'trade_executed') {
    console.log('Trade executed:', message.data)
  }
}
```

---

## 🧮 Cálculo de Riesgo

### Fórmula

```
Investment = RiskAmount / StopLossPercent
Quantity = Investment / CurrentPrice
AdjustedQty = round(Quantity / StepSize) * StepSize
```

### Ejemplo

```python
RiskAmount = $3.00
StopLoss = 2.2% (0.022)
CurrentPrice = $95,000

Investment = $3.00 / 0.022 = $136.36
Quantity = $136.36 / $95,000 = 0.001435 BTC
AdjustedQty = 0.001 BTC (ajustado al StepSize)

TotalValue = 0.001 * $95,000 = $95
```

---

## 🐛 Troubleshooting

### Backend no inicia

**Síntoma**: Error al ejecutar `start_backend.bat`

**Solución**:
```bash
# Verificar Python instalado
python --version  # Debe ser 3.10+

# Reinstalar dependencias
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### Frontend no carga

**Síntoma**: Página en blanco en http://localhost:3000

**Solución**:
```bash
# Verificar Node instalado
node --version  # Debe ser 18+

# Limpiar e reinstalar
cd frontend
rmdir /s /q node_modules
del package-lock.json
npm install
npm run dev
```

### Error 10002 (Invalid timestamp)

**Síntoma**: Logs muestran "timestamp error"

**Solución**: El sistema tiene sincronización automática. Si persiste:
1. Verificar hora del sistema
2. Reiniciar backend
3. El offset se ajustará automáticamente

### Órdenes rechazadas por StepSize

**Síntoma**: "Invalid order quantity"

**Solución**: Verificar `trading_config.json`:
- `step_size` debe coincidir con Bybit
- Usar valores del README de Bybit para cada símbolo

### Posición duplicada

**Síntoma**: "Position already exists"

**Solución**:
- El sistema previene esto automáticamente
- Cerrar la posición existente primero
- O usar otra moneda

---

## 📊 Símbolos Configurados

| Símbolo | Risk ($) | SL (%) | TP (%) | StepSize | Leverage |
|---------|----------|--------|--------|----------|----------|
| BTCUSDT | 3.0 | 2.2% | 4.5% | 0.001 | 10x |
| ETHUSDT | 2.1 | 2.3% | 4.0% | 0.01 | 10x |
| SOLUSDT | 2.0 | 1.0% | 2.0% | 0.1 | 10x |
| ADAUSDT | 1.0 | 1.0% | 2.0% | 1.0 | 10x |
| AVAXUSDT | 1.0 | 1.0% | 2.0% | 0.1 | 10x |
| *...y 11 más* | | | | | |

**Total**: 16 símbolos configurados

---

## 🔐 Seguridad

### Mejores Prácticas

1. **Usar Testnet primero**: Probar todas las funciones antes de Live
2. **API Keys read+trade only**: No dar permisos de withdrawal
3. **Empezar con risk bajo**: $1-3 USD por trade
4. **Monitorear logs**: Revisar cada ejecución
5. **IP Whitelist**: Configurar en Bybit para mayor seguridad

### Gestión de Credenciales

- Credenciales **NO se guardan en disco**
- Se mantienen solo en memoria del backend
- Al reiniciar, debes reconfigurarlas

---

## 📝 Logs

Los logs se muestran en:
1. **UI**: Dashboard → Recent Logs (últimos 100)
2. **Console del backend**: Salida estándar
3. **WebSocket**: Broadcast en tiempo real

Niveles:
- `info` 🔵: Información general
- `success` ✅: Operación exitosa
- `warning` ⚠️: Advertencia (no crítico)
- `error` ❌: Error crítico

---

## 🎯 Próximos Pasos

### Después de Instalar

1. ✅ Ejecutar `START_HERE.bat`
2. ✅ Configurar credenciales (Testnet)
3. ✅ Habilitar 1-2 símbolos en Directions
4. ✅ Probar con una alerta de prueba
5. ✅ Verificar ejecución en Bybit Testnet
6. ✅ Ajustar configuraciones según resultados

### Migración desde Bot C#

Si vienes del bot de C#:
1. ✅ Copiar `trading_config.json` actual
2. ✅ Ajustar `trading_directions.json`
3. ✅ Probar primero en paralelo (ambos bots)
4. ✅ Migrar alertas ATAS a la nueva UI
5. ✅ Desactivar bot C# cuando estés seguro

---

## 🤝 Soporte

Si encuentras problemas:
1. Revisar [Troubleshooting](#-troubleshooting)
2. Verificar logs del backend
3. Revisar consola del navegador (F12)
4. Verificar que Bybit API esté operativa

---

## 📜 Licencia

Uso privado - Proyecto personal de trading

---

## 🎉 Créditos

Desarrollado completamente por **Claude Code** (Anthropic)

Arquitectura basada en el bot original de C# con mejoras:
- ✅ Stack moderno Python + React
- ✅ UI web profesional
- ✅ WebSocket para tiempo real
- ✅ Gestión de riesgo mejorada
- ✅ Logs estructurados
- ✅ Mejor manejo de errores

---

## 📚 Recursos Adicionales

- [Bybit API Documentation](https://bybit-exchange.github.io/docs/v5/intro)
- [FastAPI Documentation](https://fastapi.tiangolo.com/)
- [React Documentation](https://react.dev/)

---

**¡Feliz Trading! 🚀📈**
