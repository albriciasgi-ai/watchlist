# 📡 Integración con Watchlist - Trading Bot

## 🎯 Resumen

El Trading Bot ahora escucha alertas en el **puerto 5000** y puede procesar alertas enviadas desde tu watchlist automáticamente.

---

## 🔌 Endpoints Disponibles

### Opción 1: Endpoint Watchlist (RECOMENDADO)

Este endpoint acepta el formato JSON estructurado de tu watchlist.

#### URL
```
POST http://localhost:5000/api/watchlist-alert
```

#### Headers
```
Content-Type: application/json
```

#### Body (JSON)
```json
{
  "pattern": "HAMMER (ABRIR LONG)",
  "symbol": "BTCUSDT",
  "price": 45000.5,
  "confidence": 85.5
}
```

---

### Opción 2: Endpoint ATAS (Formato Texto)

Este endpoint acepta alertas en formato ATAS tradicional.

#### URL
```
POST http://localhost:5000/api/alert
```

#### Headers
```
Content-Type: application/json
```

#### Body (JSON)
```json
{
  "raw_alert": "[2025-09-16 10:12:00] [INJUSDT] ABRIR LONG 12.46"
}
```

---

## 📝 Formato de Alertas Soportado

El bot parsea alertas en **formato ATAS**:

### Formato
```
[FECHA HORA] [SIMBOLO] ACCION DIRECCION PRECIO
```

### Ejemplos Válidos

**LONG:**
```
[2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 50000
[2025-09-16 10:12:00] [ETHUSDT] OPEN LONG 3500.5
[2025-09-16 10:12:00] [SOLUSDT] BUY 150.25
```

**SHORT:**
```
[2025-09-16 10:12:00] [BTCUSDT] ABRIR SHORT 50000
[2025-09-16 10:12:00] [ETHUSDT] OPEN SHORT 3500.5
[2025-09-16 10:12:00] [SOLUSDT] SELL 150.25
```

### Palabras Clave Reconocidas

**LONG:**
- `LONG`
- `BUY`
- `COMPRA`
- `ABRIR LONG`
- `OPEN LONG`

**SHORT:**
- `SHORT`
- `SELL`
- `VENTA`
- `ABRIR SHORT`
- `OPEN SHORT`

---

## 🚀 Cómo Enviar Alertas desde la Watchlist

### ⭐ Formato Watchlist (Recomendado)

#### cURL
```bash
curl -X POST http://localhost:5000/api/watchlist-alert \
  -H "Content-Type: application/json" \
  -d "{\"pattern\": \"HAMMER (ABRIR LONG)\", \"symbol\": \"BTCUSDT\", \"price\": 50000, \"confidence\": 85.5}"
```

#### Python
```python
import requests

url = "http://localhost:5000/api/watchlist-alert"

alert = {
    "pattern": "HAMMER (ABRIR LONG)",
    "symbol": "BTCUSDT",
    "price": 50000,
    "confidence": 85.5
}

response = requests.post(url, json=alert)
print(response.json())
```

#### JavaScript/Node.js
```javascript
const axios = require('axios');

const url = 'http://localhost:5000/api/watchlist-alert';
const alert = {
  pattern: 'HAMMER (ABRIR LONG)',
  symbol: 'BTCUSDT',
  price: 50000,
  confidence: 85.5
};

axios.post(url, alert)
  .then(response => console.log(response.data))
  .catch(error => console.error(error));
```

---

### Formato ATAS (Alternativo)

#### cURL
```bash
curl -X POST http://localhost:5000/api/alert \
  -H "Content-Type: application/json" \
  -d "{\"raw_alert\": \"[2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 50000\"}"
```

#### Python
```python
import requests

url = "http://localhost:5000/api/alert"
alert = {
    "raw_alert": "[2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 50000"
}

response = requests.post(url, json=alert)
print(response.json())
```

---

## 📊 Respuesta del Endpoint

### Endpoint Watchlist - Éxito (200 OK)
```json
{
  "success": true,
  "symbol": "BTCUSDT",
  "side": "Buy",
  "price": 50000.0,
  "quantity": 0.0012,
  "pattern": "HAMMER (ABRIR LONG)",
  "confidence": 85.5,
  "result": {
    "success": true,
    "market_order": {
      "orderId": "123456789",
      "avgPrice": "50001.5"
    },
    "stop_loss": {
      "orderId": "123456790",
      "stopPrice": "48900.0"
    },
    "take_profit": {
      "orderId": "123456791",
      "price": "52250.0"
    }
  },
  "partial": false
}
```

### Endpoint Watchlist - Dirección Rechazada (200 OK)
```json
{
  "success": false,
  "message": "Direction filter rejected: BTCUSDT is set to DISABLED",
  "symbol": "BTCUSDT",
  "side": "Buy"
}
```

### Endpoint Watchlist - Posición Existente (200 OK)
```json
{
  "success": false,
  "message": "Position already exists for BTCUSDT",
  "symbol": "BTCUSDT",
  "skipped": true
}
```

---

### Endpoint ATAS - Éxito (200 OK)
```json
{
  "success": true,
  "total": 1,
  "successful": 1,
  "failed": 0,
  "alert": {
    "symbol": "BTCUSDT",
    "side": "Buy",
    "price": 50000.0,
    "timestamp": "2025-09-16 10:12:00"
  },
  "quantity": 0.0012,
  "message": "Processed 1 alerts: 1 successful, 0 failed"
}
```

### Error - Símbolo Deshabilitado (200 OK)
```json
{
  "success": false,
  "total": 1,
  "successful": 0,
  "failed": 1,
  "message": "Processed 1 alerts: 0 successful, 1 failed\n\nFailed alerts:\n• BTCUSDT: Alert rejected by direction filter"
}
```

### Error - Credenciales No Configuradas (400 Bad Request)
```json
{
  "detail": "Credentials not configured"
}
```

### Error - Parsing Fallido (200 OK)
```json
{
  "success": false,
  "total": 1,
  "successful": 0,
  "failed": 1,
  "message": "Processed 1 alerts: 0 successful, 1 failed\n\nFailed alerts:\n• Unknown: Failed to parse alert"
}
```

---

## 🔄 Flujo de Procesamiento

Cuando el bot recibe una alerta, ejecuta estos pasos:

1. ✅ **Parse de la alerta** (extrae symbol, side, price)
2. ✅ **Validación de formato**
3. ✅ **Verificación de dirección permitida** (LONG/SHORT/BOTH/DISABLED)
4. ✅ **Verificación de configuración** (símbolo configurado?)
5. ✅ **Verificación de posición existente** (ya hay una posición abierta?)
6. ✅ **Cálculo de cantidad** (basado en risk amount)
7. ✅ **Ejecución de Market Order**
8. ✅ **Colocación de Stop Loss**
9. ✅ **Colocación de Take Profit**
10. ✅ **Logging y notificación**

---

## ⚙️ Configuración Previa Requerida

Antes de enviar alertas, asegúrate de:

### 1. Backend Corriendo
```bash
# Iniciar el backend
cd backend
python main.py

# O usar el script
START_HERE.bat
```

### 2. Credenciales Configuradas
- Ir a http://localhost:3000
- Dashboard → Credentials
- Ingresar API Key y Secret
- Guardar

### 3. Símbolo Habilitado
- Dashboard → Trading Directions
- Cambiar símbolo de DISABLED a BOTH/LONG/SHORT

### 4. Configuración del Símbolo
- Configuration Tab
- Verificar risk_amount, stop_loss_percent, take_profit_percent

---

## 📤 Envío de Múltiples Alertas

El endpoint soporta múltiples alertas en una sola petición:

### Formato 1: Una alerta por línea con corchetes
```json
{
  "raw_alert": "[2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 50000\n[2025-09-16 10:12:00] [ETHUSDT] ABRIR SHORT 3500"
}
```

### Formato 2: Separadas por líneas en blanco
```json
{
  "raw_alert": "[2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 50000\n\n[2025-09-16 10:12:00] [ETHUSDT] ABRIR SHORT 3500"
}
```

**Ventaja:** Todas las alertas se procesan en **paralelo** (excepto las del mismo símbolo), acelerando la ejecución.

---

## 🔒 Prevención de Duplicados

El bot tiene protección contra ejecuciones duplicadas:

### Bloqueo por Símbolo
- Solo **una alerta por símbolo** se procesa a la vez
- Múltiples símbolos se procesan en **paralelo**
- Previene race conditions

### Verificación de Posición
- Antes de ejecutar, verifica si ya existe posición
- Si existe, **rechaza la alerta**
- Logs: "Position already exists for {SYMBOL}, skipping"

---

## 🧪 Prueba de Integración

### Paso 1: Verificar que el Backend esté Corriendo
```bash
curl http://localhost:5000/api/status
```

Respuesta esperada:
```json
{
  "status": "online",
  "credentials_configured": true,
  "symbols_configured": 16
}
```

### Paso 2: Habilitar un Símbolo para Pruebas
```bash
curl -X POST http://localhost:5000/api/directions/update \
  -H "Content-Type: application/json" \
  -d "{\"symbol\": \"BTCUSDT\", \"direction\": \"BOTH\"}"
```

### Paso 3: Enviar Alerta de Prueba
```bash
curl -X POST http://localhost:5000/api/alert \
  -H "Content-Type: application/json" \
  -d "{\"raw_alert\": \"[2025-09-16 10:12:00] [BTCUSDT] ABRIR LONG 50000\"}"
```

### Paso 4: Verificar Logs
- Abrir http://localhost:3000
- Dashboard → Recent Logs
- Deberías ver la ejecución completa

---

## 🚨 Troubleshooting

### "Credentials not configured"
**Solución:** Configurar credenciales desde la UI (Dashboard → Credentials)

### "Alert rejected by direction filter"
**Solución:** Habilitar el símbolo (Dashboard → Trading Directions → BOTH)

### "No configuration for XXXUSDT"
**Solución:** Añadir el símbolo a `config/trading_config.json`

### "Position already exists"
**Solución:**
- Cerrar la posición existente en Bybit
- O enviar alerta para otro símbolo

### "Failed to parse alert"
**Solución:** Verificar formato de la alerta
- Debe tener corchetes: `[FECHA] [SIMBOLO]`
- Debe incluir dirección: LONG/SHORT/BUY/SELL
- Debe incluir precio al final

### Connection Refused (ECONNREFUSED)
**Solución:** Verificar que el backend esté corriendo en puerto 5000

---

## 📈 Ejemplo de Integración Completa

### Script Python para Watchlist
```python
import requests
import json
from datetime import datetime

class TradingBotIntegration:
    def __init__(self, bot_url="http://localhost:5000"):
        self.bot_url = bot_url
        self.alert_endpoint = f"{bot_url}/api/alert"

    def send_alert(self, symbol, side, price):
        """
        Envía una alerta al Trading Bot

        Args:
            symbol (str): Símbolo (ej: "BTCUSDT")
            side (str): "LONG" o "SHORT"
            price (float): Precio actual

        Returns:
            dict: Respuesta del bot
        """
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        alert = f"[{timestamp}] [{symbol}] ABRIR {side} {price}"

        payload = {"raw_alert": alert}

        try:
            response = requests.post(
                self.alert_endpoint,
                headers={"Content-Type": "application/json"},
                json=payload,
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()
                if result.get("success"):
                    print(f"✅ Alert sent successfully: {symbol} {side} @ {price}")
                else:
                    print(f"⚠️ Alert rejected: {result.get('message')}")
                return result
            else:
                print(f"❌ Error {response.status_code}: {response.text}")
                return None

        except requests.exceptions.RequestException as e:
            print(f"❌ Connection error: {e}")
            return None

# Uso
bot = TradingBotIntegration()

# Enviar alerta LONG
bot.send_alert("BTCUSDT", "LONG", 50000)

# Enviar alerta SHORT
bot.send_alert("ETHUSDT", "SHORT", 3500.5)
```

---

## 📚 Referencias

- **README Principal:** [README.md](README.md)
- **API Completa:** http://localhost:5000/docs (Swagger)
- **Frontend:** http://localhost:3000
- **Backend Status:** http://localhost:5000/api/status

---

## ✅ Checklist de Integración

Antes de producción:

- [ ] ✅ Backend corriendo en puerto 5000
- [ ] ✅ Credenciales configuradas
- [ ] ✅ Símbolos deseados habilitados (BOTH/LONG/SHORT)
- [ ] ✅ Prueba manual con cURL funciona
- [ ] ✅ Watchlist envía formato correcto
- [ ] ✅ Logs muestran ejecución completa
- [ ] ✅ Verificado en Bybit Testnet
- [ ] ✅ Monitoreo de logs activo

---

**¡Listo para recibir alertas automáticas! 🚀📈**
