# Plan: Sistema Híbrido de Detección de Patrones en Backend

**Fecha**: 2026-01-16
**Objetivo**: Mover la detección de patrones del frontend al backend para eliminar la dependencia del navegador y garantizar alertas 24/7.

---

## Contexto del Problema

El navegador Chrome suspende JavaScript cuando la pestaña está inactiva o la pantalla se apaga, causando:
- Gaps en las velas del gráfico
- Velas que llegan en desorden al reactivarse
- Alertas perdidas durante la suspensión

**Solución**: Backend robusto que detecta patrones independientemente del navegador.

---

## Paso 0: Preparación (5 min)

1. Restaurar cambios del stash (cooldown + colores descartados):
   ```bash
   git stash pop stash@{0}
   ```

2. **Revertir solo los cambios de MiniChart.jsx** que causaron el problema del gap (la lógica de preservación de velas)

3. Rebuild del frontend:
   ```bash
   cd frontend
   npm run build
   ```

---

## Paso 1: WebSocket Manager - Conexión a Bybit (1 hora)

**Crear `backend/websocket_manager.py`:**

```python
# Funcionalidades requeridas:
- Conexión única a wss://stream.bybit.com/v5/public/linear
- Suscripción a klines de los 30 símbolos (configurable)
- Soportar múltiples timeframes simultáneos
- Reconexión automática con backoff exponencial (1s, 2s, 4s... max 60s)
- Heartbeat/ping cada 20 segundos
- Buffer de velas por símbolo/timeframe
- Callbacks para notificar cuando cierra una vela
```

**Dependencia a agregar en requirements.txt:**
```
websockets>=12.0
```

**Estructura básica:**
```python
class WebSocketManager:
    def __init__(self, symbols: list, intervals: list):
        self.symbols = symbols
        self.intervals = intervals
        self.candle_buffers = {}  # {symbol: {interval: [candles]}}
        self.on_candle_close_callbacks = []

    async def connect(self):
        # Conexión a Bybit con reconexión automática

    async def subscribe(self):
        # Suscribir a kline.{interval}.{symbol} para cada combinación

    def add_candle_close_callback(self, callback):
        # Registrar callback para cuando cierra una vela

    async def _handle_message(self, message):
        # Procesar mensaje, detectar cierre de vela, llamar callbacks
```

**Test**: Verificar que recibe datos de BTCUSDT en consola

---

## Paso 2: Migrar Detectores de Patrones (1.5 horas)

### 2a. Extender `backend/rejection_detector.py`:

Agregar:
- Detección de SWING_LOW/SWING_HIGH (migrar de `LocalPatternDetector.js`)
- Filtro Volume Z-Score
- Soporte para zonas manuales

### 2b. Crear `backend/double_topbottom_detector.py`:

Migrar lógica completa desde `frontend/src/components/indicators/DoubleTopBottomIndicator.js`:

```python
class DoubleTopBottomDetector:
    def __init__(self, config: dict):
        self.config = config

    def detect_patterns(self, candles: list) -> list:
        # Detectar Double Top y Double Bottom

    def _find_extremes(self, candles, lookback):
        # Encontrar máximos y mínimos locales

    def _validate_pattern(self, extreme1, extreme2, candles):
        # Validar que cumple criterios de precio y tiempo

    def _calculate_strategy(self, pattern, candles):
        # Calcular Entry, SL, TP
```

**Parámetros a migrar:**
- lookbackCandles: 50
- candlesPerExtreme: 5
- priceMarginPercent: 2.0
- minCandlesBetween: 5
- maxCandlesBetween: 50
- maxBreakoutPercent: dinámico por timeframe

**Test**: Pasar datos mock y verificar que detecta patrones conocidos

---

## Paso 3: Sistema de Estado y Persistencia (30 min)

**Crear `backend/pattern_state_manager.py`:**

```python
class PatternStateManager:
    def __init__(self, config_dir: str = "config"):
        self.alerted_patterns = {}  # {pattern_id: timestamp}
        self.last_alert_timestamp = {}  # {symbol: timestamp}
        self.alert_history = []  # Últimas 100 alertas
        self.config_dir = config_dir

    def load_state(self):
        # Cargar desde JSON al iniciar

    def save_state(self):
        # Guardar a JSON (cada 5 min y al detectar)

    def is_pattern_alerted(self, pattern_id: str) -> bool:
        # Verificar si ya se alertó (con TTL 24h)

    def mark_pattern_alerted(self, pattern_id: str):
        # Marcar como alertado

    def is_in_cooldown(self, symbol: str, cooldown_minutes: int) -> bool:
        # Verificar cooldown por símbolo

    def update_last_alert(self, symbol: str):
        # Actualizar timestamp de última alerta

    def add_to_history(self, alert: dict):
        # Agregar al historial (max 100)

    def cleanup_old_patterns(self):
        # Limpiar patrones > 24h
```

**Archivos de persistencia:**
- `config/alerted_patterns.json`
- `config/alert_history.json`

**Test**: Reiniciar backend y verificar que recuerda alertas previas

---

## Paso 4: Servicio de Detección en Tiempo Real (30 min)

**Crear `backend/realtime_pattern_service.py`:**

```python
class RealtimePatternService:
    def __init__(self,
                 websocket_manager: WebSocketManager,
                 state_manager: PatternStateManager,
                 alert_sender: AlertSender):
        self.ws_manager = websocket_manager
        self.state_manager = state_manager
        self.alert_sender = alert_sender
        self.rejection_detector = RejectionDetector()
        self.dbt_detector = DoubleTopBottomDetector()

    async def start(self):
        # Registrar callback en WebSocket Manager
        self.ws_manager.add_candle_close_callback(self.on_candle_close)
        await self.ws_manager.connect()

    async def on_candle_close(self, symbol: str, interval: str, candles: list):
        # Llamado cuando cierra una vela
        await self._detect_and_alert(symbol, interval, candles)

    async def _detect_and_alert(self, symbol, interval, candles):
        # 1. Ejecutar detectores
        rejection_patterns = self.rejection_detector.detect(candles)
        dbt_patterns = self.dbt_detector.detect(candles)

        # 2. Filtrar por cooldown y duplicados
        for pattern in rejection_patterns + dbt_patterns:
            pattern_id = self._get_pattern_id(pattern)

            if self.state_manager.is_pattern_alerted(pattern_id):
                continue

            if self.state_manager.is_in_cooldown(symbol, 30):
                continue

            # 3. Enviar alerta
            await self.alert_sender.send_alert(pattern)

            # 4. Actualizar estado
            self.state_manager.mark_pattern_alerted(pattern_id)
            self.state_manager.update_last_alert(symbol)
            self.state_manager.add_to_history(pattern)
```

**Flujo de datos:**
```
Bybit WebSocket → WebSocket Manager → Pattern Service → Detectores → Alert Sender
```

**Test**: Esperar a que cierre una vela y verificar log de detección

---

## Paso 5: Integración con main.py (30 min)

**Modificar `backend/main.py`:**

```python
from websocket_manager import WebSocketManager
from realtime_pattern_service import RealtimePatternService
from pattern_state_manager import PatternStateManager

# Variables globales
ws_manager = None
pattern_service = None
state_manager = None

@app.on_event("startup")
async def startup_event():
    global ws_manager, pattern_service, state_manager

    # Lista de símbolos (misma que el frontend)
    symbols = ["BTCUSDT", "ETHUSDT", ...]  # 30 símbolos
    intervals = ["15", "60", "240"]  # Timeframes activos

    # Inicializar componentes
    state_manager = PatternStateManager()
    state_manager.load_state()

    ws_manager = WebSocketManager(symbols, intervals)
    pattern_service = RealtimePatternService(ws_manager, state_manager, alert_sender)

    # Iniciar servicio en background
    asyncio.create_task(pattern_service.start())

@app.on_event("shutdown")
async def shutdown_event():
    # Guardar estado antes de cerrar
    if state_manager:
        state_manager.save_state()
    if ws_manager:
        await ws_manager.disconnect()

# Nuevos endpoints
@app.get("/api/realtime/status")
async def get_realtime_status():
    return {
        "connected": ws_manager.is_connected if ws_manager else False,
        "symbols_active": len(ws_manager.symbols) if ws_manager else 0,
        "patterns_detected_today": len(state_manager.alert_history) if state_manager else 0,
        "last_alert": state_manager.alert_history[-1] if state_manager and state_manager.alert_history else None
    }

@app.get("/api/realtime/patterns/{symbol}")
async def get_patterns(symbol: str, limit: int = 50):
    # Retornar últimos patrones detectados para el símbolo
    pass

@app.post("/api/realtime/config")
async def update_config(config: dict):
    # Actualizar configuración de detectores
    pass
```

**Test**: Llamar `/api/realtime/status` y ver estado activo

---

## Paso 6: Testing Integrado (1-2 horas)

### 6a. Tests automáticos:

```python
# test_websocket_manager.py
- test_connection()
- test_reconnection_after_disconnect()
- test_subscription_multiple_symbols()

# test_pattern_detection.py
- test_rejection_pattern_detection()
- test_double_top_detection()
- test_double_bottom_detection()

# test_state_manager.py
- test_cooldown()
- test_deduplication()
- test_persistence()
```

### 6b. Prueba manual extendida:

1. Iniciar backend: `python -m uvicorn main:app --reload --port 8000`
2. Verificar conexión: `curl http://localhost:8000/api/realtime/status`
3. Dejar corriendo 30-60 minutos
4. Verificar:
   - [ ] Alertas llegan correctamente
   - [ ] No hay duplicados
   - [ ] Cooldown funciona (30 min entre alertas del mismo símbolo)
   - [ ] Simular desconexión de red y verificar reconexión

---

## Estructura Final del Backend

```
backend/
├── main.py                        # FastAPI + inicialización del servicio
├── websocket_manager.py           # NUEVO - conexión Bybit
├── realtime_pattern_service.py    # NUEVO - orquestador
├── pattern_state_manager.py       # NUEVO - estado/persistencia
├── rejection_detector.py          # EXTENDIDO - +swings, +volume z-score
├── double_topbottom_detector.py   # NUEVO - migrado del frontend
├── alert_sender.py                # Existente (sin cambios)
├── requirements.txt               # + websockets>=12.0
└── config/
    ├── alerted_patterns.json      # NUEVO - patrones alertados
    └── alert_history.json         # NUEVO - historial
```

---

## Resultado Esperado

- ✅ Backend detecta patrones 24/7 independiente del navegador
- ✅ Frontend sigue funcionando para visualización (sin cambios críticos)
- ✅ Si Chrome se suspende, las alertas siguen llegando desde el backend
- ✅ Cooldown y deduplicación funcionan correctamente
- ✅ Estado persiste entre reinicios del backend
- ✅ Reconexión automática si Bybit se desconecta

---

## Tiempo Estimado

| Paso | Descripción | Tiempo |
|------|-------------|--------|
| 0 | Preparación | 5 min |
| 1 | WebSocket Manager | 1 hora |
| 2 | Migrar detectores | 1.5 horas |
| 3 | Estado y persistencia | 30 min |
| 4 | Servicio tiempo real | 30 min |
| 5 | Integración main.py | 30 min |
| 6 | Testing | 1-2 horas |
| **Total** | | **4-6 horas** |

---

## Participación del Usuario

| Momento | Acción | Tiempo |
|---------|--------|--------|
| Inicio | Aprobar plan | 2 min |
| Paso 1 | Verificar que recibe datos de Bybit | 5 min |
| Paso 5 | Verificar endpoint /api/realtime/status | 5 min |
| Paso 6 | Prueba extendida (30-60 min corriendo) | 30-60 min |
| **Total** | | **~1 hora** |

---

## Comandos Útiles

```bash
# Restaurar cambios del stash
git stash pop stash@{0}

# Ver qué hay en el stash
git stash show -p stash@{0}

# Instalar nueva dependencia
cd backend
pip install websockets>=12.0

# Iniciar backend
cd backend
python -m uvicorn main:app --reload --port 8000

# Verificar estado
curl http://localhost:8000/api/realtime/status

# Ver logs en tiempo real
# (los logs aparecen en la consola del uvicorn)
```

---

## Notas Importantes

1. **El frontend NO se modifica significativamente** - sigue funcionando para visualización
2. **Las alertas ahora vienen del backend** - más confiables
3. **La configuración de patrones** se puede sincronizar desde el frontend al backend via API
4. **Si el backend se reinicia**, carga el estado desde los archivos JSON
5. **Bybit permite** suscribirse a múltiples símbolos en una sola conexión WebSocket
