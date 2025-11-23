# 🤖 Integración con Trading Bot de Bybit

## 📋 Resumen

El sistema de Watchlist ahora envía alertas de patrones de rechazo directamente a tu bot de trading en el **puerto 5000** en un formato compatible para ejecución automática de órdenes en Bybit.

---

## 🎯 Formato de Alertas

### Formato Simple (Recomendado para el Bot)

Cada alerta incluye un campo `message` con el formato:

```
[2024-09-16 10:12:00] [BTCUSDT] ABRIR LONG 45000.50
```

**Estructura**: `[timestamp] [symbol] [action] [price]`

- **timestamp**: Fecha y hora del patrón detectado (formato: YYYY-MM-DD HH:MM:SS)
- **symbol**: Par de trading (ej: BTCUSDT, ETHUSDT, INJUSDT)
- **action**: `ABRIR LONG` o `ABRIR SHORT`
- **price**: Precio al que se detectó el patrón

### Payload JSON Completo

```json
{
  "message": "[2024-09-16 10:12:00] [BTCUSDT] ABRIR LONG 45000.50",
  "timestamp": "2024-09-16 10:12:00",
  "symbol": "BTCUSDT",
  "action": "ABRIR LONG",
  "price": 45000.5,
  "confidence": 85.5,
  "interval": "4h",

  "type": "REJECTION_PATTERN_ALERT",
  "severity": "HIGH",
  "priority": 1,
  "title": "🔨 BTCUSDT | 4h - Hammer",
  "description": "Hammer detected @ $45,000.50\nConfidence: 85.5%\nNear 2 key level(s)...",

  "data": {
    "patternType": "HAMMER",
    "confidence": 85.5,
    "price": 45000.5,
    "nearLevels": [...],
    "metrics": {...},
    "candle": {...},
    "contextScores": {...}
  }
}
```

---

## 📊 Mapeo de Patrones a Acciones

| Patrón | Tipo | Acción |
|--------|------|--------|
| **HAMMER** | Bullish Reversal | `ABRIR LONG` |
| **SHOOTING_STAR** | Bearish Reversal | `ABRIR SHORT` |
| **ENGULFING_BULLISH** | Bullish Engulfing | `ABRIR LONG` |
| **ENGULFING_BEARISH** | Bearish Engulfing | `ABRIR SHORT` |
| **DOJI_DRAGONFLY** | Bullish Doji | `ABRIR LONG` |
| **DOJI_GRAVESTONE** | Bearish Doji | `ABRIR SHORT` |

---

## 🔧 Configuración del Bot

### Endpoint del Bot

Tu bot debe estar escuchando en:

```
http://localhost:5000/api/alerts
```

Método: **POST**
Content-Type: **application/json**

### Implementación Básica (Ejemplo)

```python
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/alerts', methods=['POST'])
def receive_alert():
    try:
        alert = request.json

        # Opción 1: Usar el mensaje formateado simple
        message = alert.get('message')
        # Ejemplo: "[2024-09-16 10:12:00] [BTCUSDT] ABRIR LONG 45000.50"

        # Opción 2: Usar campos estructurados
        symbol = alert.get('symbol')      # "BTCUSDT"
        action = alert.get('action')      # "ABRIR LONG" o "ABRIR SHORT"
        price = alert.get('price')        # 45000.50
        confidence = alert.get('confidence')  # 85.5

        # Tu lógica de trading aquí
        if confidence >= 75:  # Filtrar por confianza mínima
            execute_trade(symbol, action, price)

        return jsonify({"success": True})

    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

def execute_trade(symbol, action, price):
    """Tu código de ejecución de órdenes en Bybit"""
    if action == "ABRIR LONG":
        # Lógica para abrir LONG
        pass
    elif action == "ABRIR SHORT":
        # Lógica para abrir SHORT
        pass

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
```

---

## 🚀 Cómo Funciona

### Flujo Completo

```
1. Watchlist detecta patrón de rechazo (Hammer, Shooting Star, etc.)
   ↓
2. Valida el patrón contra contextos de referencia (Volume Profile, Range Detector)
   ↓
3. Calcula confidence score (0-100)
   ↓
4. Si cumple filtros (min confidence, proximidad a niveles), genera alerta
   ↓
5. AlertSender envía POST a http://localhost:5000/api/alerts
   ↓
6. Tu bot recibe la alerta y ejecuta la orden en Bybit
```

### Validación de Patrones

Las alertas solo se envían si el patrón:

✅ Se detecta **cerca de niveles clave** (POC, VAH, VAL, rangos)
✅ Tiene **confidence score** por encima del mínimo configurado (default: 60%)
✅ Cumple con **filtros de calidad** (volumen, tamaño relativo)

Esto reduce **falsos positivos** y mejora la tasa de éxito.

---

## ⚙️ Configuración de Alertas

### En el Frontend (Watchlist)

1. Click en botón **"Patterns"** del símbolo deseado
2. Habilitar patrones a detectar (Hammer, Shooting Star, etc.)
3. Configurar filtros:
   - **Min Confidence**: Confianza mínima (ej: 75%)
   - **Proximity**: Distancia máxima a niveles clave (ej: 1%)
   - **Require Near Level**: Solo alertar si hay nivel cercano
   - **Require Volume Spike**: Solo con volumen elevado
4. Seleccionar contextos de referencia:
   - Volume Profile (dinámico o rangos fijos)
   - Range Detector (rangos de consolidación)
5. **Habilitar "Send Alerts"** ✅

### Parámetros Recomendados

Para trading real:

- **Min Confidence**: 75-80%
- **Proximity**: 0.5-1.0%
- **Require Near Level**: Habilitado
- **Require Volume Spike**: Habilitado (reduce ruido)

---

## 📊 Niveles de Confidence

El sistema calcula confidence basándose en 4 factores:

1. **Pattern Quality** (30 puntos): Qué tan pronunciado es el patrón
2. **Proximity to Levels** (40 puntos): Cercanía a POC/VAH/VAL/rangos
3. **Volume** (15 puntos): Volumen relativo vs promedio
4. **Relative Size** (15 puntos): Tamaño de vela vs promedio

**Score Total**: 0-100

### Severidad

- **HIGH** (≥80%): Señales de alta calidad, ejecutar con confianza
- **MEDIUM** (65-79%): Señales válidas, considerar contexto adicional
- **LOW** (<65%): Señales débiles, posiblemente ignorar

---

## 🧪 Testing

### Método 1: Script Automático de Prueba (RECOMENDADO) ⭐

El sistema incluye un script de prueba completo que valida todo el flujo:

```bash
python test_send_alert.py
```

**Este script verifica:**
- ✅ Conexión al backend (puerto 8000)
- ✅ Envío de alerta via API
- ✅ Recepción por el bot (puerto 5000)
- ✅ Formato correcto del mensaje
- ✅ Mapeo de patrones a acciones

**Salida esperada:**

```
🤖 TRADING BOT ALERT SYSTEM TEST

======================================================================
🧪 TESTING ALERT SYSTEM
======================================================================

📡 Sending test alert via backend...
   Endpoint: http://localhost:8000/api/test-alert

✅ SUCCESS - Test alert sent!

📊 Alert Details:
   Pattern: HAMMER (ABRIR LONG)
   Symbol: BTCUSDT
   Price: $45000.5
   Confidence: 85.5%
   Target: http://localhost:5000

Expected format sent to bot:
   [2025-11-23 03:30:34] [BTCUSDT] ABRIR LONG 45000.50

💡 Check your bot logs on port 5000 to confirm receipt!

----------------------------------------------------------------------
🔧 ALTERNATIVE: Testing direct connection to bot
----------------------------------------------------------------------

📡 Sending test alert directly to bot...
   Endpoint: http://localhost:5000/api/alerts

✅ SUCCESS - Bot received the alert!

======================================================================
📊 TEST SUMMARY
======================================================================

Backend API test: ✅ PASSED
Direct bot test:  ✅ PASSED

🎉 ALL TESTS PASSED - System is ready for production!
```

**Requisitos previos:**

1. Backend corriendo en puerto 8000:
   ```bash
   cd WatchlistConIndicadores/backend
   python -m uvicorn main:app --reload --port 8000
   ```

2. Tu bot de trading corriendo en puerto 5000

---

### Método 2: Test via API Endpoint

Enviar alerta de prueba directamente via endpoint:

```bash
curl -X POST http://localhost:8000/api/test-alert
```

Respuesta:

```json
{
  "success": true,
  "message": "Test alert sent successfully",
  "alert_service_url": "http://localhost:5000",
  "pattern": "HAMMER (ABRIR LONG)",
  "symbol": "BTCUSDT",
  "price": 45000.50,
  "confidence": 85.5
}
```

---

### Método 3: Test Manual con curl (Directo al Bot)

```bash
curl -X POST http://localhost:5000/api/alerts \
  -H "Content-Type: application/json" \
  -d '{
    "message": "[2024-09-16 10:12:00] [BTCUSDT] ABRIR LONG 45000.50",
    "symbol": "BTCUSDT",
    "action": "ABRIR LONG",
    "price": 45000.50,
    "confidence": 85.5
  }'
```

---

### Método 4: Validación de Formato (Sin envío)

Valida únicamente el formato sin enviar al bot:

```bash
python test_alert_format.py
```

Este script valida que:
- ✅ El formato de mensaje es correcto
- ✅ Los patrones se mapean a acciones correctas
- ✅ El payload JSON está bien estructurado

---

## 🔍 Monitoreo

### Dashboard de Alertas (Opcional)

Puedes usar `alert_listener.py` para monitorear alertas sin interferir con el bot:

```bash
python alert_listener.py
```

Abre: `http://localhost:5000` para ver dashboard en vivo.

**Nota**: Si usas el alert_listener, tu bot debe escuchar en **otro puerto** (ej: 5001) y actualizar la configuración.

### Logs

Las alertas se loguean en consola del backend:

```
✅ Alert sent: 🔨 BTCUSDT | 4h - Hammer
```

Si falla:

```
⚠️ Failed to send alert: 🔨 BTCUSDT | 4h - Hammer
❌ Cannot connect to alert service at http://localhost:5000
💡 Tip: Make sure alert listener is running on port 5000
```

---

## 🛠️ Troubleshooting

### Bot no recibe alertas

1. ✅ Verificar que el bot está corriendo en puerto 5000
2. ✅ Verificar que "Send Alerts" está habilitado en configuración de patrones
3. ✅ Verificar que hay contextos de referencia activos (VP o Range Detector)
4. ✅ Verificar logs del backend para errores de conexión

### Alertas duplicadas

El sistema **no previene duplicados** por diseño (cada vela puede generar nueva alerta).
Tu bot debe implementar lógica de deduplicación si es necesario.

### Demasiadas alertas

Ajustar filtros:
- Subir **Min Confidence** a 80%
- Reducir **Proximity** a 0.5%
- Habilitar **Require Volume Spike**
- Seleccionar solo contextos de alta calidad (rangos fijos, no dinámico)

---

## 📝 Próximos Pasos

Para producción, considera agregar a tu bot:

1. **Rate Limiting**: Máximo N órdenes por minuto/hora
2. **Position Sizing**: Calcular tamaño basado en risk management
3. **Stop-Loss/Take-Profit**: Usar niveles de referencia del `data.nearLevels`
4. **Database Logging**: Guardar historial de alertas y órdenes
5. **Backtesting**: Evaluar performance histórico
6. **Notificaciones**: Telegram/Discord cuando se ejecuta orden

---

## 🎯 Ejemplo Completo de Integración

Ver `test_alert_format.py` para ejemplos de payloads reales.

**¿Dudas o problemas?** Revisar logs en:
- Backend: Consola donde corre `uvicorn main:app`
- Bot: Logs de tu servicio en puerto 5000

---

**✅ Sistema listo para producción con tu bot de trading.**
