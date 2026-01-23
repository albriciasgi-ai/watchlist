# IMPLEMENTATION_PLAN.md - Order Flow

> **INSTRUCCIONES PARA CLAUDE**:
> - Lee este archivo al inicio de cada iteracion
> - Completa UNA tarea por iteracion
> - Marca [x] cuando completes una tarea
> - Actualiza "Estado Actual" al final de cada iteracion
> - NO avances si la verificacion falla

---

## Fase 1: Estructura Base

- [ ] 1.1 Copiar carpeta `backend/` de `../4.Analizador cripto/backend/` a `./backend/`
- [ ] 1.2 Copiar carpeta `frontend/` de `../4.Analizador cripto/frontend/` a `./frontend/`
- [ ] 1.3 Modificar `backend/main.py`: cambiar puerto de 10000 a 11000 en comentarios
- [ ] 1.4 Modificar `frontend/vite.config.js`: cambiar puerto a 11001 y proxy a 11000
- [ ] 1.5 Modificar `frontend/src/config.js`: cambiar API_BASE_URL a puerto 11000
- [ ] 1.6 Crear `backend/requirements.txt` si no existe (copiar del original)
- [ ] 1.7 **VERIFICAR**: Backend inicia sin errores (`uvicorn main:app --port 11000`)

## Fase 2: WebSocket de Trades

- [ ] 2.1 En `websocket_manager.py`: agregar metodo `subscribe_trades(symbol)`
- [ ] 2.2 En `websocket_manager.py`: agregar callback `on_trade(symbol, trade_data)`
- [ ] 2.3 En `websocket_manager.py`: parsear mensaje de `publicTrade.{symbol}`
- [ ] 2.4 Crear `trade_aggregator.py`: clase TradeAggregator para acumular trades por vela
- [ ] 2.5 Conectar TradeAggregator al callback de trades
- [ ] 2.6 **VERIFICAR**: Logs muestran trades llegando (`[TRADE] BTCUSDT: Buy 0.001 @ 95000`)

## Fase 3: Calculo de Footprint

- [ ] 3.1 Crear `footprint_calculator.py` con clase FootprintCalculator
- [ ] 3.2 Implementar `_create_levels(candle)`: divide HIGH-LOW en 6 niveles
- [ ] 3.3 Implementar `_assign_trade_to_level(price, levels)`: encuentra nivel correcto
- [ ] 3.4 Implementar `process_trade(trade)`: agrega volumen al nivel correcto (bid/ask)
- [ ] 3.5 Implementar `get_footprint(candle_timestamp)`: retorna footprint completo
- [ ] 3.6 Implementar `_calculate_poc(levels)`: encuentra Point of Control
- [ ] 3.7 Implementar `_detect_imbalances(levels, threshold=3.0)`: detecta ratios altos
- [ ] 3.8 **VERIFICAR**: Test unitario de FootprintCalculator pasa

## Fase 4: Servicio y Endpoints REST

- [ ] 4.1 Crear `orderflow_service.py` con clase OrderFlowService (singleton)
- [ ] 4.2 Integrar FootprintCalculator y TradeAggregator en OrderFlowService
- [ ] 4.3 Implementar metodo `start(symbols, intervals)` para iniciar servicio
- [ ] 4.4 En `main.py`: agregar endpoint `GET /api/orderflow/status`
- [ ] 4.5 En `main.py`: agregar endpoint `GET /api/orderflow/footprint/{symbol}`
- [ ] 4.6 En `main.py`: agregar endpoint `GET /api/orderflow/config`
- [ ] 4.7 En `main.py`: agregar endpoint `POST /api/orderflow/config`
- [ ] 4.8 Crear `config/orderflow_config.json` con configuracion por defecto
- [ ] 4.9 **VERIFICAR**: `curl localhost:11000/api/orderflow/footprint/BTCUSDT` retorna JSON

## Fase 5: Frontend - Indicador

- [ ] 5.1 Crear `frontend/src/components/indicators/OrderFlowIndicator.js`
- [ ] 5.2 Implementar `constructor(symbol, interval, days)` heredando de IndicatorBase
- [ ] 5.3 Implementar `fetchData()`: GET /api/orderflow/footprint/{symbol}
- [ ] 5.4 Implementar `render(ctx, bounds, visibleCandles)`: renderiza footprint en Canvas
- [ ] 5.5 Implementar renderizado de niveles con colores (verde=compras, rojo=ventas)
- [ ] 5.6 Implementar renderizado de POC (linea horizontal)
- [ ] 5.7 Implementar renderizado de imbalances (resaltado)
- [ ] 5.8 En `IndicatorManager.js`: agregar OrderFlowIndicator a la lista de indicadores
- [ ] 5.9 **VERIFICAR**: `npm run build` sin errores

## Fase 6: Frontend - Settings y Alertas

- [ ] 6.1 Crear `frontend/src/components/OrderFlowSettings.jsx` (modal de configuracion)
- [ ] 6.2 Agregar controles: num_levels, imbalance_threshold, alerts_enabled
- [ ] 6.3 En `SingleSymbolAnalyzer.jsx`: agregar boton para abrir OrderFlowSettings
- [ ] 6.4 En `orderflow_service.py`: implementar deteccion de stacked imbalances
- [ ] 6.5 En `orderflow_service.py`: implementar `_send_alert()` al puerto 5000
- [ ] 6.6 Implementar cooldown de alertas (evitar spam)
- [ ] 6.7 Crear `logs/orderflow_alerts.log` para registro de alertas
- [ ] 6.8 **VERIFICAR**: Alertas se envian correctamente (ver logs)

---

## Estado Actual

```
Fase: 1
Tarea actual: 1.1 Copiar carpeta backend/
Ultima completada: Ninguna
Iteracion: 1
Bloqueos: Ninguno
```

---

## Notas de Progreso

> Escribe aqui notas importantes durante la implementacion

- (Iteracion 1): Iniciando proyecto...

---

## Bloqueos Encontrados

> Si encuentras un bloqueo que no puedes resolver, documentalo aqui

Ninguno hasta ahora.
