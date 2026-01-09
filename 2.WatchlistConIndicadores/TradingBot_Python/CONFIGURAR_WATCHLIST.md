# 🔧 Configurar Watchlist para Trading Bot

## 🎯 Objetivo

Configurar tu watchlist para que envíe alertas automáticamente al Trading Bot en el puerto 5000.

---

## 📋 Pasos de Configuración

### 1. Verificar que el Trading Bot esté corriendo

```bash
# Desde TradingBot_Python/
START_HERE.bat
```

Verifica que el backend esté escuchando en puerto **5000**:
- Backend: http://localhost:5000
- Frontend: http://localhost:3000
- API Docs: http://localhost:5000/docs

---

### 2. Ubicar el Backend de la Watchlist

Basándonos en tu mensaje, tu watchlist está en:
```
C:\Users\inven\OneDrive\Documentos\GitHub\watchlist\WatchlistConIndicadores\backend
```

El backend de la watchlist usa el puerto **8000**.

---

### 3. Modificar la Watchlist

Busca en el código de tu watchlist donde se envían las alertas. Deberías encontrar algo similar a:

```python
# ANTES (configuración actual)
ALERT_SERVICE_URL = "http://localhost:5000"  # o alguna variable similar
```

Asegúrate de que:

#### A) La URL apunte al endpoint correcto:
```python
TRADING_BOT_URL = "http://localhost:5000/api/watchlist-alert"
```

#### B) El formato del payload sea:
```python
payload = {
    "pattern": f"{pattern_name} (ABRIR {direction})",  # ej: "HAMMER (ABRIR LONG)"
    "symbol": symbol,  # ej: "BTCUSDT"
    "price": current_price,  # ej: 45000.5
    "confidence": confidence  # ej: 85.5 (opcional)
}
```

#### C) El request sea POST con JSON:
```python
import requests

response = requests.post(
    TRADING_BOT_URL,
    json=payload,
    headers={"Content-Type": "application/json"},
    timeout=10
)
```

---

### 4. Ejemplo Completo de Integración

Si tienes un archivo como `alert_sender.py` o similar en tu watchlist, modifícalo así:

```python
import requests
import logging

class TradingBotNotifier:
    def __init__(self):
        self.trading_bot_url = "http://localhost:5000/api/watchlist-alert"
        self.enabled = True

    def send_alert(self, pattern_name, symbol, price, direction, confidence=None):
        """
        Envía alerta al Trading Bot

        Args:
            pattern_name (str): Nombre del patrón (ej: "HAMMER")
            symbol (str): Símbolo (ej: "BTCUSDT")
            price (float): Precio actual
            direction (str): "LONG" o "SHORT"
            confidence (float, optional): Confianza del patrón (0-100)
        """
        if not self.enabled:
            logging.info("Trading Bot notifier disabled")
            return None

        # Construir payload
        payload = {
            "pattern": f"{pattern_name} (ABRIR {direction})",
            "symbol": symbol,
            "price": price
        }

        if confidence is not None:
            payload["confidence"] = confidence

        try:
            logging.info(f"Sending alert to Trading Bot: {symbol} {direction} @ {price}")

            response = requests.post(
                self.trading_bot_url,
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=10
            )

            if response.status_code == 200:
                result = response.json()

                if result.get("success"):
                    logging.info(f"✅ Trading Bot executed: {symbol} {direction}")
                    return result
                else:
                    logging.warning(f"⚠️ Trading Bot rejected: {result.get('message')}")
                    return result
            else:
                logging.error(f"❌ Trading Bot error: {response.status_code}")
                return None

        except requests.exceptions.ConnectionError:
            logging.error("❌ Trading Bot not reachable (port 5000)")
            return None

        except Exception as e:
            logging.error(f"❌ Error sending alert: {str(e)}")
            return None

# Uso
notifier = TradingBotNotifier()

# Cuando detectes un patrón:
notifier.send_alert(
    pattern_name="HAMMER",
    symbol="BTCUSDT",
    price=45000.5,
    direction="LONG",
    confidence=85.5
)
```

---

### 5. Patrones Soportados

El Trading Bot puede parsear cualquier patrón que incluya la dirección:

#### Formato Válido:
```
"{NOMBRE_PATRON} (ABRIR {DIRECCION})"
```

#### Ejemplos:
- `"HAMMER (ABRIR LONG)"`
- `"SHOOTING STAR (ABRIR SHORT)"`
- `"DOJI (ABRIR LONG)"`
- `"ENGULFING (ABRIR SHORT)"`
- `"MORNING STAR (ABRIR LONG)"`

El bot extrae la dirección de la parte entre paréntesis.

#### Palabras Clave Reconocidas:
**LONG:**
- LONG
- BUY
- COMPRA
- ABRIR LONG
- OPEN LONG

**SHORT:**
- SHORT
- SELL
- VENTA
- ABRIR SHORT
- OPEN SHORT

---

### 6. Probar la Integración

#### Opción 1: Desde la Watchlist
Si ya tienes el código modificado, simplemente ejecuta tu watchlist y espera a que detecte un patrón.

#### Opción 2: Script de Prueba Manual
```bash
# Desde TradingBot_Python/
python test_watchlist_alert.py
```

Este script enviará alertas de prueba y mostrará las respuestas.

#### Opción 3: cURL Manual
```bash
curl -X POST http://localhost:5000/api/watchlist-alert \
  -H "Content-Type: application/json" \
  -d "{\"pattern\": \"HAMMER (ABRIR LONG)\", \"symbol\": \"BTCUSDT\", \"price\": 45000.5, \"confidence\": 85.5}"
```

---

### 7. Verificar que Funcione

Después de enviar una alerta:

1. **Ver logs en tiempo real:**
   - Abre http://localhost:3000
   - Dashboard → Recent Logs
   - Deberías ver: "📨 Watchlist alert received: BTCUSDT Buy @ 45000.5"

2. **Verificar ejecución:**
   - Si todo está bien, verás logs como:
     - "🔒 Acquired lock for BTCUSDT"
     - "🚀 Executing trade: Buy BTCUSDT qty=0.0012 @ 45000.5"
     - "✅ BTCUSDT: Trade completed successfully! Pattern: HAMMER (ABRIR LONG)"

3. **Verificar en Bybit:**
   - Ve a tu cuenta Bybit (Testnet o Live según configuración)
   - Revisa las posiciones abiertas
   - Deberías ver la orden ejecutada con SL y TP

---

## ⚙️ Configuración Previa del Trading Bot

Antes de enviar alertas, asegúrate de:

### 1. Credenciales Configuradas
- http://localhost:3000 → Dashboard → Credentials
- Ingresar API Key y Secret
- Seleccionar Demo/Live
- Click "Save Credentials"

### 2. Símbolos Habilitados
- Dashboard → Trading Directions
- Cambiar símbolos de DISABLED a:
  - **BOTH**: Acepta LONG y SHORT
  - **LONG**: Solo LONG
  - **SHORT**: Solo SHORT

### 3. Configuración de Risk
- Configuration Tab
- Ajustar `risk_amount`, `stop_loss_percent`, `take_profit_percent`

---

## 🔍 Troubleshooting

### "Trading Bot not reachable"
**Problema:** No se puede conectar al puerto 5000

**Solución:**
1. Verificar que el backend esté corriendo:
   ```bash
   netstat -ano | findstr :5000
   ```
2. Si no hay respuesta, ejecutar `START_HERE.bat`

### "Credentials not configured"
**Problema:** El bot no tiene credenciales de Bybit

**Solución:**
- Ir a http://localhost:3000
- Dashboard → Credentials
- Configurar API Key y Secret

### "Direction filter rejected"
**Problema:** El símbolo está DISABLED o la dirección no está permitida

**Solución:**
- Dashboard → Trading Directions
- Cambiar a BOTH/LONG/SHORT según necesites

### "No configuration for XXXUSDT"
**Problema:** El símbolo no está en `trading_config.json`

**Solución:**
- Configuration Tab → Add Coin
- O editar manualmente `config/trading_config.json`

### "Position already exists"
**Problema:** Ya hay una posición abierta para ese símbolo

**Comportamiento:** El bot rechaza la alerta automáticamente (esto es correcto)

**Solución:**
- Cerrar la posición existente en Bybit
- O esperar a que se cierre con SL/TP

---

## 📊 Flujo Completo

```
[Watchlist detecta patrón]
         ↓
[Envía POST a http://localhost:5000/api/watchlist-alert]
         ↓
[Trading Bot recibe alerta]
         ↓
[Parsea pattern → extrae dirección (LONG/SHORT)]
         ↓
[Verifica filtro de dirección]
         ↓
[Verifica posición existente]
         ↓
[Calcula cantidad basada en riesgo]
         ↓
[Ejecuta: Market Order → Stop Loss → Take Profit]
         ↓
[Logs en tiempo real en UI]
         ↓
[Orden visible en Bybit]
```

---

## ✅ Checklist de Configuración

- [ ] Trading Bot corriendo en puerto 5000
- [ ] Watchlist modificada para enviar a `/api/watchlist-alert`
- [ ] Formato de payload correcto (pattern, symbol, price, confidence)
- [ ] Credenciales del Trading Bot configuradas
- [ ] Símbolos habilitados en Trading Directions
- [ ] Prueba manual exitosa con `test_watchlist_alert.py`
- [ ] Logs del Trading Bot muestran "Watchlist alert received"
- [ ] Verificado en Bybit que las órdenes se ejecutan

---

## 📚 Recursos

- **Documentación completa:** [WATCHLIST_INTEGRATION.md](WATCHLIST_INTEGRATION.md)
- **API Swagger:** http://localhost:5000/docs
- **Frontend:** http://localhost:3000
- **Script de prueba:** `test_watchlist_alert.py`

---

**¡Listo para recibir alertas automáticas! 🚀**
