# API Reference - Trading Bot Backend

Este documento describe todos los endpoints que el backend debe implementar para que los componentes React funcionen correctamente.

## Base URL

```
http://localhost:5000
```

---

## 1. Credentials Endpoints

### Check Credentials Status
```http
GET /api/credentials/check
```

**Response (Success):**
```json
{
  "has_credentials": true,
  "is_testnet": true
}
```

**Response (No Credentials):**
```json
{
  "has_credentials": false
}
```

---

### Save Credentials
```http
POST /api/credentials
Content-Type: application/json
```

**Request Body:**
```json
{
  "api_key": "your-api-key",
  "api_secret": "your-api-secret",
  "testnet": true
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Credentials saved successfully"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid API credentials"
}
```

---

## 2. Directions Endpoints

### Get All Directions
```http
GET /api/directions
```

**Response:**
```json
{
  "directions": {
    "BTCUSDT": "long",
    "ETHUSDT": "short",
    "SOLUSDT": "both",
    "BNBUSDT": "disabled"
  }
}
```

**Possible values:** `"long"`, `"short"`, `"both"`, `"disabled"`

---

### Update Direction
```http
POST /api/directions/update
Content-Type: application/json
```

**Request Body:**
```json
{
  "symbol": "BTCUSDT",
  "direction": "long"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Direction updated successfully",
  "symbol": "BTCUSDT",
  "direction": "long"
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid direction value"
}
```

---

## 3. Configuration Endpoints

### Get All Configurations
```http
GET /api/config
```

**Response:**
```json
{
  "config": {
    "BTCUSDT": {
      "risk_amount": 100.0,
      "stop_loss_percent": 2.0,
      "take_profit_percent": 4.0
    },
    "ETHUSDT": {
      "risk_amount": 50.0,
      "stop_loss_percent": 2.5,
      "take_profit_percent": 5.0
    }
  }
}
```

---

### Update Configuration
```http
POST /api/config/update
Content-Type: application/json
```

**Request Body:**
```json
{
  "symbol": "BTCUSDT",
  "config": {
    "risk_amount": 150.0,
    "stop_loss_percent": 2.0,
    "take_profit_percent": 4.0
  }
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Configuration updated successfully",
  "symbol": "BTCUSDT",
  "config": {
    "risk_amount": 150.0,
    "stop_loss_percent": 2.0,
    "take_profit_percent": 4.0
  }
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid configuration values"
}
```

---

## 4. Alert Endpoints

### Process Alert
```http
POST /api/alert
Content-Type: application/json
```

**Request Body:**
```json
{
  "raw_alert": "BTCUSDT\nLong\nPrice: 45000.00"
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Alert processed successfully",
  "symbol": "BTCUSDT",
  "side": "long",
  "price": 45000.00
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Invalid alert format"
}
```

**Expected Alert Format:**
```
Line 1: SYMBOL (e.g., BTCUSDT)
Line 2: SIDE (Long or Short)
Line 3: Price: XXXXX.XX
```

---

### Manual Trade
```http
POST /api/trade/manual
Content-Type: application/json
```

**Request Body:**
```json
{
  "symbol": "BTCUSDT",
  "side": "long",
  "price": 45000.00
}
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Trade executed successfully",
  "order_id": "12345678",
  "symbol": "BTCUSDT",
  "side": "long",
  "price": 45000.00,
  "quantity": 0.01
}
```

**Response (Error):**
```json
{
  "success": false,
  "error": "Insufficient balance"
}
```

---

## 5. Position Endpoints

### Get Position by Symbol
```http
GET /api/position/{symbol}
```

**Example:**
```http
GET /api/position/BTCUSDT
```

**Response (Has Position):**
```json
{
  "has_position": true,
  "symbol": "BTCUSDT",
  "size": 0.01,
  "side": "Buy",
  "entry_price": 45000.00,
  "unrealized_pnl": 150.50,
  "leverage": 10
}
```

**Response (No Position):**
```json
{
  "has_position": false,
  "symbol": "BTCUSDT"
}
```

**Response (Error):**
```json
{
  "has_position": false,
  "error": "Failed to fetch position"
}
```

**Note:**
- `side` should be `"Buy"` for long positions and `"Sell"` for short positions
- This matches Bybit's API response format

---

## 6. WebSocket (Optional)

### WebSocket Connection
```
ws://localhost:5000/ws
```

**Message Format (Logs):**
```json
{
  "type": "log",
  "timestamp": "2025-11-20T19:00:00.000Z",
  "level": "info",
  "message": "Trade executed",
  "details": {
    "symbol": "BTCUSDT",
    "side": "long"
  }
}
```

**Message Format (Position Update):**
```json
{
  "type": "position_update",
  "symbol": "BTCUSDT",
  "has_position": true,
  "size": 0.01,
  "side": "Buy",
  "entry_price": 45000.00
}
```

---

## Error Handling

Todos los endpoints deben seguir este formato de error:

**HTTP Status Codes:**
- `200`: Success
- `400`: Bad Request (invalid parameters)
- `401`: Unauthorized (invalid credentials)
- `404`: Not Found
- `500`: Internal Server Error

**Error Response Format:**
```json
{
  "success": false,
  "error": "Descriptive error message",
  "details": "Optional additional details"
}
```

---

## CORS Configuration

El backend debe permitir requests desde el frontend:

```python
# Python Flask example
from flask_cors import CORS

app = Flask(__name__)
CORS(app, origins=['http://localhost:5173', 'http://localhost:3000'])
```

```python
# Python FastAPI example
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=['http://localhost:5173', 'http://localhost:3000'],
    allow_credentials=True,
    allow_methods=['*'],
    allow_headers=['*'],
)
```

---

## Validation Requirements

### Credentials
- `api_key`: Required, string, min 10 characters
- `api_secret`: Required, string, min 10 characters
- `testnet`: Required, boolean

### Directions
- `symbol`: Required, string, must exist in config
- `direction`: Required, enum: `"long"`, `"short"`, `"both"`, `"disabled"`

### Configuration
- `symbol`: Required, string
- `risk_amount`: Required, float, > 0
- `stop_loss_percent`: Required, float, > 0
- `take_profit_percent`: Required, float, > 0

### Alerts
- `raw_alert`: Required, string, must match expected format

### Manual Trade
- `symbol`: Required, string
- `side`: Required, enum: `"long"`, `"short"`
- `price`: Required, float, > 0

---

## Example Implementation (Python Flask)

```python
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)

# Credentials
@app.route('/api/credentials/check', methods=['GET'])
def check_credentials():
    # Check if credentials exist in .env or config
    has_creds = check_credentials_exist()
    is_testnet = get_testnet_status()
    return jsonify({
        'has_credentials': has_creds,
        'is_testnet': is_testnet
    })

@app.route('/api/credentials', methods=['POST'])
def save_credentials():
    data = request.json
    api_key = data.get('api_key')
    api_secret = data.get('api_secret')
    testnet = data.get('testnet')

    if not api_key or not api_secret:
        return jsonify({'error': 'Missing credentials'}), 400

    # Save to .env file
    save_to_env(api_key, api_secret, testnet)

    return jsonify({
        'success': True,
        'message': 'Credentials saved successfully'
    })

# Directions
@app.route('/api/directions', methods=['GET'])
def get_directions():
    directions = load_directions_from_config()
    return jsonify({'directions': directions})

@app.route('/api/directions/update', methods=['POST'])
def update_direction():
    data = request.json
    symbol = data.get('symbol')
    direction = data.get('direction')

    if direction not in ['long', 'short', 'both', 'disabled']:
        return jsonify({'error': 'Invalid direction'}), 400

    update_direction_in_config(symbol, direction)

    return jsonify({
        'success': True,
        'message': 'Direction updated',
        'symbol': symbol,
        'direction': direction
    })

# Config
@app.route('/api/config', methods=['GET'])
def get_config():
    config = load_config()
    return jsonify({'config': config})

@app.route('/api/config/update', methods=['POST'])
def update_config():
    data = request.json
    symbol = data.get('symbol')
    config = data.get('config')

    if not validate_config(config):
        return jsonify({'error': 'Invalid configuration'}), 400

    save_config(symbol, config)

    return jsonify({
        'success': True,
        'message': 'Configuration updated',
        'symbol': symbol,
        'config': config
    })

# Alerts
@app.route('/api/alert', methods=['POST'])
def process_alert():
    data = request.json
    raw_alert = data.get('raw_alert')

    try:
        parsed = parse_atas_alert(raw_alert)
        return jsonify({
            'success': True,
            'message': 'Alert processed',
            'symbol': parsed['symbol'],
            'side': parsed['side'],
            'price': parsed['price']
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 400

# Positions
@app.route('/api/position/<symbol>', methods=['GET'])
def get_position(symbol):
    try:
        position = fetch_position_from_bybit(symbol)
        return jsonify(position)
    except Exception as e:
        return jsonify({
            'has_position': False,
            'error': str(e)
        }), 500

if __name__ == '__main__':
    app.run(debug=True, port=5000)
```

---

## Testing

Use estos comandos curl para testear los endpoints:

```bash
# Check credentials
curl http://localhost:5000/api/credentials/check

# Save credentials
curl -X POST http://localhost:5000/api/credentials \
  -H "Content-Type: application/json" \
  -d '{"api_key":"test","api_secret":"test","testnet":true}'

# Get directions
curl http://localhost:5000/api/directions

# Update direction
curl -X POST http://localhost:5000/api/directions/update \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","direction":"long"}'

# Get config
curl http://localhost:5000/api/config

# Update config
curl -X POST http://localhost:5000/api/config/update \
  -H "Content-Type: application/json" \
  -d '{"symbol":"BTCUSDT","config":{"risk_amount":100,"stop_loss_percent":2,"take_profit_percent":4}}'

# Process alert
curl -X POST http://localhost:5000/api/alert \
  -H "Content-Type: application/json" \
  -d '{"raw_alert":"BTCUSDT\nLong\nPrice: 45000.00"}'

# Get position
curl http://localhost:5000/api/position/BTCUSDT
```

---

## Security Considerations

1. **API Keys**: Never expose API keys in responses
2. **HTTPS**: Use HTTPS in production
3. **Rate Limiting**: Implement rate limiting
4. **Input Validation**: Always validate and sanitize inputs
5. **CORS**: Restrict origins in production
6. **Authentication**: Consider adding JWT auth for production
7. **Environment Variables**: Store sensitive data in .env files
8. **Error Messages**: Don't expose stack traces in production

---

## Production Checklist

- [ ] Implement all endpoints
- [ ] Add input validation
- [ ] Configure CORS properly
- [ ] Add error handling
- [ ] Test all endpoints
- [ ] Setup HTTPS
- [ ] Add authentication
- [ ] Implement rate limiting
- [ ] Add logging
- [ ] Setup monitoring
- [ ] Document API
- [ ] Create test suite
