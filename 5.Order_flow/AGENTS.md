# AGENTS.md - Comandos del Proyecto Order Flow

## Estructura del Proyecto
- **Backend**: `5.Order_flow/backend/` (Puerto 11000)
- **Frontend**: `5.Order_flow/frontend/` (Puerto 11001)
- **Base copiada de**: `4.Analizador cripto/`

---

## Comandos Backend

### Crear entorno virtual (solo primera vez)
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
```

### Iniciar servidor backend
```bash
cd backend
.venv\Scripts\activate
uvicorn main:app --reload --port 11000
```

### Verificar backend funcionando
```bash
curl http://localhost:11000/api/status
```
**Esperado**: JSON con `"status": "ok"`

### Verificar Order Flow status
```bash
curl http://localhost:11000/api/orderflow/status
```

### Verificar footprint data
```bash
curl http://localhost:11000/api/orderflow/footprint/BTCUSDT
```

---

## Comandos Frontend

### Instalar dependencias (solo primera vez)
```bash
cd frontend
npm install
```

### Iniciar servidor desarrollo
```bash
cd frontend
npm run dev
```

### Build de produccion (verificacion)
```bash
cd frontend
npm run build
```
**Esperado**: Sin errores, carpeta `dist/` generada

---

## Verificaciones por Fase

| Fase | Comando | Resultado Esperado |
|------|---------|-------------------|
| 1 | `curl http://localhost:11000/api/status` | `{"status": "ok"}` |
| 2 | Ver logs del backend | `[TRADE] BTCUSDT: Buy 0.001 @ 95000` |
| 3 | `curl http://localhost:11000/api/orderflow/footprint/BTCUSDT` | JSON con `levels` array |
| 4 | `curl http://localhost:11000/api/orderflow/config` | JSON con configuracion |
| 5 | `npm run build` | Exit code 0, sin errores |
| 6 | Ver logs del backend | `[ALERT] Sending to port 5000...` |

---

## Puertos del Ecosistema

| Aplicacion | Backend | Frontend |
|------------|---------|----------|
| Analizador Cripto | 10000 | 10001 |
| **Order Flow** | **11000** | **11001** |
| TradingBot | 5000 | 3000 |
| Watchlist | 8000 | 5173 |

---

## Troubleshooting

### Puerto en uso
```bash
netstat -ano | findstr :11000
taskkill /PID <PID> /F
```

### WebSocket no conecta
- Verificar que Bybit no este bloqueado
- Verificar logs: `[WS] Connected to Bybit`

### Trades no llegan
- Verificar suscripcion: `publicTrade.BTCUSDT`
- Bybit puede tardar 1-2 segundos en enviar primer trade
