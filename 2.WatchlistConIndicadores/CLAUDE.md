# APP 2: WATCHLIST CON INDICADORES

**Ubicacion:** `2.WatchlistConIndicadores/`

Watchlist en tiempo real con indicadores avanzados y sistema de alertas.

## Estructura

```
2.WatchlistConIndicadores/
├── backend/
│   ├── main.py                       # Servidor principal (~3000 lineas)
│   ├── alert_sender.py               # Sistema alertas (puerto 5000)
│   ├── config_store.py               # Store configuracion
│   ├── double_topbottom_detector.py  # Detector DTB (63KB)
│   ├── rejection_detector.py         # Detector rechazo (28KB)
│   ├── realtime_pattern_service.py   # Orquestador deteccion (35KB)
│   ├── pattern_state_manager.py      # Estado patrones (14KB)
│   ├── websocket_manager.py          # WebSocket Bybit (15KB)
│   ├── vwap_calculator.py            # VWAP
│   ├── fibonacci_calculator.py       # Fibonacci
│   ├── cache/                        # Cache (30 min TTL)
│   ├── config/                       # Configuraciones
│   └── drawings/                     # Dibujos por simbolo
│
├── frontend/
│   ├── src/components/
│   │   ├── Watchlist.jsx             # Raiz (51KB)
│   │   ├── MiniChart.jsx             # Grafico (105KB)
│   │   ├── AlertHistoryPanel.jsx
│   │   ├── *Settings.jsx             # Configuraciones
│   │   ├── indicators/
│   │   │   ├── IndicatorManager.js   # Orquestador (56KB)
│   │   │   ├── RejectionPatternIndicator.js (114KB)
│   │   │   ├── DoubleTopBottomIndicator.js (96KB)
│   │   │   ├── VWAPIndicator.js (41KB)
│   │   │   ├── VolumeProfileIndicator.js
│   │   │   ├── CVDIndicator.js
│   │   │   └── ... (13 indicadores)
│   │   ├── drawing/
│   │   ├── ProximityAlerts/
│   │   └── SlidingAlertPanel/
│   ├── hooks/useGlobalAlerts.js
│   └── utils/
```

## Comandos

```bash
# Backend
cd 2.WatchlistConIndicadores/backend
start_backend.bat  # O manual con uvicorn --port 8000

# Frontend
cd 2.WatchlistConIndicadores/frontend
npm install && npm run dev
```

## Funcionalidades

- **Tiempo real** via WebSocket Bybit
- **13 indicadores** activos simultaneos
- **Deteccion de patrones**: DTB, Rejection (Hammer, Shooting Star, Engulfing, Doji)
- **Sistema de alertas**: Backend, Browser Notifications, localStorage
- **Volume Profile**: dinamico y rangos fijos
- **VWAP** con bandas de desviacion
- **Range Detection** basado en ATR
- **Herramientas de dibujo** persistentes

## Patrones Detectados

| Patron | Emoji | Direccion |
|--------|-------|-----------|
| HAMMER | 🔨 | Alcista |
| SHOOTING_STAR | ⭐ | Bajista |
| ENGULFING_BULLISH | 📈 | Alcista |
| ENGULFING_BEARISH | 📉 | Bajista |
| DOJI_DRAGONFLY | 🐉 | Alcista |
| DOJI_GRAVESTONE | 🪦 | Bajista |
| DOUBLE_TOP | 🔻 | Bajista |
| DOUBLE_BOTTOM | 🔺 | Alcista |

## Limites de Timeframe

**CRITICO: Deben coincidir en backend Y frontend**

```python
MAX_DAYS_BY_INTERVAL = {
    "1": 5, "5": 30, "15": 90, "60": 360, "240": 720, "D": 1440, "W": 730
}
```

---

