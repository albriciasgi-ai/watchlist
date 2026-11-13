# APP 10: TRADING BOT DESKTOP (Electron)

**Ubicacion:** `10.TradingBotDesktop/`

Version de escritorio del Trading Bot (App 3) empaquetada con Electron. Resuelve el problema de throttling del navegador que causa pausas en el monitoreo de alertas.

## Estructura

```
10.TradingBotDesktop/
├── electron/
│   ├── main.js              # Proceso principal (anti-throttling, tray, power blocker)
│   └── preload.js           # Bridge seguro renderer<->main
│
├── src/
│   ├── components/
│   │   ├── CredentialsPanel.jsx    # Config credenciales Bybit
│   │   ├── ConfigManager.jsx       # Gestion de simbolos
│   │   ├── DirectionManager.jsx    # Filtros LONG/SHORT
│   │   ├── AlertPanel.jsx          # Historial de alertas
│   │   ├── PositionsPanel.jsx      # Posiciones abiertas
│   │   ├── OrdersPanel.jsx         # Historial de ordenes
│   │   └── LogsPanel.jsx           # Logs del sistema
│   ├── utils/
│   │   └── robustness.js           # Validacion y health checks
│   ├── config.js                   # API_BASE_URL = localhost:5000
│   └── main.jsx
│
├── assets/
│   └── README.txt                  # Instrucciones para icon.ico
│
├── package.json                    # Scripts y config electron-builder
├── vite.config.js                  # Puerto 5001, proxy a backend
├── 1.START_ALL.bat                 # Inicio coordinado backend + Electron
├── 1_START.bat                     # Inicio con verificacion de backend
└── start_fast.bat                  # Inicio rapido
```

## Puertos

| Servicio | Puerto |
|----------|--------|
| Backend (TradingBot) | 5000 |
| Frontend Electron (dev) | 5001 |

## Comandos

```bash
# Inicio recomendado (backend + frontend)
1.START_ALL.bat

# Desarrollo manual
npm run dev:electron

# Build instalador Windows
npm run build:electron
```

## Configuracion Anti-Throttling

```javascript
// electron/main.js - ANTES de app.whenReady()
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

// BrowserWindow
webPreferences: { backgroundThrottling: false }
```

## Funcionalidades

- **Ejecucion de ordenes**: Market orders con SL/TP integrado
- **Dos metodos de ejecucion**: Sequential (3 calls) o Integrated (1 call)
- **Auto-precision**: Fetch automatico de step_size/tick_size desde Bybit
- **Rate limiting**: Token Bucket para respetar limites de API
- **21 simbolos** preconfigurados
- **Filtros de direccion**: LONG/SHORT/BOTH/DISABLED por simbolo
- **System Tray**: Minimiza a bandeja, corre en background
- **PowerSaveBlocker**: Previene suspension del sistema

## Diferencias con App 3 (Browser)

| Caracteristica | App 3 (Browser) | App 10 (Electron) |
|----------------|-----------------|-------------------|
| Throttling | Si (alertas retrasadas) | No (monitoreo continuo) |
| System Tray | No | Si |
| Power Blocker | No | Si |
| Puerto frontend | 3000 | 5001 (dev) |

## Dependencias

- **Backend:** Usa el mismo backend de App 3 en puerto 5000
- **Bybit API:** Requiere credenciales configuradas

## Correcciones de la auditoria (7 Noviembre 2026)

Informe original: `C:\Users\inven\AppData\Roaming\Claude\side-session-notes\local_7c0bdf13-3308-48ee-9ca5-eda27effc221\informe_bot_app10.md`

### Backend (`3.TradingBot_Python/backend/`)

1. **Configuracion por alerta:** `get_coin_config()` devuelve una copia. El SL/TP o el precio de una alerta ya no pasa a las siguientes. A `trading_config.json` solo van los campos de `CONFIG_FIELDS`, y al cargar se descartan los restos de alertas viejas
2. **Respuesta perdida:** `order/create` no se reenvia a ciegas (`retry_unsafe=False`). Si hay timeout, una respuesta ilegible o un `orderLinkId` duplicado, se busca la orden en `order/realtime` y `order/history` y se mira la posicion. Si no aparece, la operacion queda `unknown` y hay aviso critico
3. **Limit duplicados:** antes de operar se revisan las ordenes de entrada pendientes (`get_open_orders`). Un Limit automatico que ya cruza el mercado se rechaza
4. **Tamano:** a mercado se usa el ultimo precio de Bybit y no el de la alerta. El riesgo incluye la comision taker de entrada y de salida (`taker_fee_rate` en `bot_settings.json`, 0.00055). Si el minimo de Bybit arriesga mas que lo configurado, la orden se rechaza en vez de redondear hacia arriba. Con SL absoluto, si el precio se alejo y la distancia supera 2 veces la de la alerta, se rechaza
5. **Proteccion:** el metodo secuencial confirma el precio de llenado del lado operado y pone TP/SL de posicion con `/v5/position/trading-stop`. El integrado verifica que la posicion tenga SL y lo pone si falta. Si el SL no queda puesto, o el precio ya lo cruzo, la posicion se cierra a mercado (`closed_unprotected`) con aviso critico
6. **Precision real:** `OrderManager` usa qtyStep, tickSize y minimo de `instruments-info` (cache de 6 h) en vez de la tabla fija. Los precios se redondean al tick hacia el lado que no aumenta el riesgo. Al arrancar se sincroniza `trading_config.json`
7. **Modo de posicion:** nunca se llama a `switch-mode`. El modo se aprende del `positionIdx` que devuelve `position/list`. Solo el error "position idx not match" prueba el otro indice
8. **Apalancamiento:** se fija el `leverage` de la configuracion una vez por simbolo y sesion (`set-leverage`). El modo de margen de la cuenta no se toca
9. **Riesgo diario:** se reserva bajo un candado global antes de ejecutar y se devuelve si la orden no se envio. Aplica a `/api/watchlist-alert`, `/api/alert` y `/api/trade/manual`
10. **Alertas:** se descartan las que llegan con `sent_at` de hace mas de 120 s y las repetidas (por timestamp de la senal, 24 h). `/api/alert` usa el mismo flujo y el metodo elegido
11. **API:** escucha solo en `127.0.0.1`. CORS y `Origin` solo aceptan apps locales (cualquier puerto, `null`, `file://`) y el Host se verifica. El campo `origin` sigue siendo un filtro, no una autenticacion
12. **Pausa:** `GET/POST /api/settings/trading-paused` detiene todo el trading. Se guarda en `bot_settings.json`
13. **Credenciales:** se validan con `/v5/user/query-api` (privado, solo lectura) y la respuesta trae `validated`
14. **Historial:** guarda el precio de llenado, el SL y el TP como precios reales y el estado real (`success`, `pending`, `closed_unprotected`, `unprotected`, `unknown`)

### Interfaz

- `App.jsx`: notificacion del sistema para `critical_alert`, `daily_limit_reached` y `trading_paused`. Al reconectar recupera `/api/logs`
- `PositionsPanel.jsx`: muestra los dos lados en hedge y el SL/TP de cada posicion. Sin SL muestra "SIN STOP LOSS"
- `OrdersPanel.jsx`: `pending` en azul y los estados de falla en rojo. Los precios chicos se muestran con mas decimales
- `AlertPanel.jsx`: Manual Trade manda `current_price`, el lado por defecto es Buy y los errores se leen de `detail`
- `CredentialsPanel.jsx`: el badge dice DEMO o REAL y avisa si Bybit rechazo las claves
- `AlertOriginsPanel.jsx`: casilla "Pausar todo el trading"
- `electron/main.js`: la bandeja tiene "Pausar / reanudar bot" y "Cerrar interfaz (el bot sigue operando)"

### Otras apps

- **Analizador (App 4):** distancias y SL/TP de zonas sin `round(x, 2)`, `sent_at` en todas las alertas al bot, y el envio por lotes solo manda zonas `OPEN`
- **OrderFlow (App 5):** precio de las alertas sin `round(x, 2)` y `sent_at`
- **App 8 y App 9:** `OrderForm.jsx` lee `step_size`, que es lo que entrega el bot

**IMPORTANTE:** reiniciar el backend del bot (puerto 5000) y los de App 4 y App 5 para aplicar los cambios.

## Cuentas de Bybit (12 Noviembre 2026)

Pedido del usuario: guardar otras claves de Bybit, para trading real o de otras cuentas, y manejarlas todas desde la suite (`12.AltagraciaTradingSuite`, Bot > "Configuración y riesgo"). Eligió **una activa a la vez**: el bot opera solo con la activa.

- **Archivo:** `3.TradingBot_Python/config/accounts.json`. Guarda de cada cuenta el nombre, la clave, el secreto, si es demo, la fecha y el resultado de la validación. Va en texto plano como `credentials.json` y está en `.gitignore`. Se escribe con temporal y reemplazo, una escritura a la vez. Si está ilegible, las rutas responden 500 y no lo sobrescriben.
- **Migración:** la primera vez que arranca, el bot pasa la clave de `credentials.json` a la "Cuenta principal", activa.
- **`credentials.json` sigue siendo la clave activa:** el bot la carga al arrancar como siempre, y activar una cuenta la escribe ahí. Las claves puestas desde App 10 (`/api/credentials`) cambian las de la cuenta activa, o crean la "Cuenta principal" si no hay ninguna.
- **Rutas:**

| Ruta | Qué hace |
|---|---|
| `GET /api/accounts` | Las cuentas, sin el secreto; de la clave, solo los últimos 4 caracteres |
| `POST /api/accounts` | Agrega una cuenta, que no pasa a ser la activa. La valida en Bybit (`/v5/user/query-api`) y la guarda aunque falle, con el motivo. Clave o nombre repetidos: 409 |
| `POST /api/accounts/{id}/activate` | Valida la clave (rechaza una mala o de solo lectura) y el bot pasa a operar con ella: cliente nuevo, `credentials.json` y la sincronización de siempre |
| `PUT /api/accounts/{id}` | Renombrar |
| `DELETE /api/accounts/{id}` | Borrar. La activa no se puede borrar (409) |
| `GET /api/accounts/{id}/summary` | Patrimonio, saldo y disponible, y las posiciones abiertas con su SL y TP. Las cuentas que no son la activa usan un cliente aparte, que se cierra al terminar |

- **Estado:** `/api/status` trae `account` (id, nombre y modo de la activa) y el WebSocket avisa `account_changed`.
- **Cambio seguro:**
  - cambiar de cuenta, o las claves desde App 10, responde 409 si hay una orden ejecutándose;
  - mientras cambia, ninguna orden empieza: la alerta queda `REJECTED_ACCOUNT_SWITCH` y la orden manual responde 409;
  - una alerta que tomó el cliente antes del cambio y esperaba el candado de su moneda se descarta al tomarlo.

  Así una orden nunca revisa la posición en una cuenta y se envía por otra.
- **Compartido entre cuentas:** la configuración por moneda, las direcciones, los orígenes, la pausa y el riesgo diario son del bot y valen para la cuenta activa. Las posiciones de la cuenta anterior quedan en Bybit con su SL y TP, pero el bot deja de vigilarlas.
- **App 10:** no tiene la lista de cuentas. Su panel de credenciales cambia las claves de la cuenta activa.
- **Pruebas:** `3.TradingBot_Python/backend/tests/accounts_checks.py` corre 31 pruebas sin conexión, con carpetas temporales (`BOT_CONFIG_DIR`, `BOT_LOG_DIR`) y un Bybit simulado. Sin la revisión del cambio dentro de las órdenes, la orden manual llega a Bybit y la alerta sigue.

**IMPORTANTE:** reiniciar el bot (puerto 5000) para que cargue las cuentas. Conviene que cada clave tenga permiso de órdenes y posiciones y no de retiro. Nada se probó contra Bybit real.

## Cuenta en tiempo real y posiciones desde la suite (12 Noviembre 2026)

Paso 4 de la integración: el bot endurecido, para que la suite muestre cada posición sobre el gráfico con su P&L (pedido del usuario, como en TradingView) y el journal sepa cuándo y a qué precio se cierra cada trade.

- **WebSocket privado** (`trading/private_stream.py`):
  - escucha la cuenta activa en Bybit: posiciones, órdenes y ejecuciones (`wss://stream.bybit.com/v5/private`, `stream-demo` en Demo);
  - solo lee: nunca envía órdenes;
  - al conectar y cada 60 s toma una foto por REST (`position/list` y `order/realtime` con `settleCoin=USDT`). Lo que el WebSocket cambió mientras se pedía la foto manda sobre ella, así una foto vieja no revive una posición cerrada;
  - sin WebSocket, la foto sigue cada 5 s;
  - reconecta solo (de 5 a 60 s; 5 minutos si Bybit rechaza la clave) y también tras 60 s sin mensajes;
  - sigue a la cuenta activa: se reinicia al cambiar de cuenta o de claves.
  
  `BOT_PRIVATE_STREAM=0` lo apaga y `BOT_PRIVATE_WS_URL` cambia la dirección (solo para pruebas).
- **`/api/positions`:** sale de ese WebSocket, o de una foto por REST si no está al día. Antes pedía a Bybit una posición por moneda configurada (21 llamadas). Por defecto sigue dando solo las monedas configuradas; `?all=true` da todas las de USDT. Suma `liqPrice`, `positionIdx`, `source` y `account`.
- **Rutas nuevas:**

| Ruta | Qué hace |
|---|---|
| `GET /api/orders/open?symbol` | Órdenes abiertas. `entry` dice si abre o aumenta posición (no es TP/SL ni reduce-only) |
| `GET /api/executions/recent?limit&symbol` | Las últimas 500 ejecuciones recibidas por el WebSocket, sin repetidas |
| `GET /api/stream/status` | Estado del WebSocket (sin claves) |
| `POST /api/position/close` | Cierra a mercado y reduce-only el lado pedido (`OrderManager.close_position`). Funciona con el bot en pausa, porque reduce riesgo. Sin posición, 404; si Bybit no confirma, 502 y "revisa antes de reintentar" |
| `POST /api/position/trading-stop` | Mueve el SL o el TP de toda la posición |
| `POST /api/orders/cancel` | Cancela una orden de entrada pendiente |

- **Reglas de `/api/position/trading-stop`:**
  - el SL nunca se quita, solo se mueve; el TP se quita con 0;
  - en un long el SL va bajo el último precio y el TP encima; al revés en un short. El precio se lee de Bybit en ese momento;
  - el SL se lleva al tick hacia el precio (menos riesgo) y el TP al tick más cercano. Si al redondear el SL toca el precio, se rechaza.
- **`/api/orders/cancel`:** la orden de TP o SL de una posición no se cancela (se mueve desde la posición). Si Bybit dice que la orden ya no existe y ya no está abierta, cuenta como cancelada.
- **Común a las tres acciones:** toman el candado de la moneda y no salen a Bybit si la cuenta cambia en medio (409).
- **Posiciones sin stop:**
  - al arrancar y al cambiar de cuenta, el bot dice en el registro qué hay abierto en Bybit;
  - cada posición sin SL da un aviso crítico `POSITION_WITHOUT_SL`, una vez por posición: al arrancar de inmediato y después si sigue así 20 s (el bot pone el SL en uno o dos segundos tras llenar). También avisa de una posición abierta a mano en Bybit;
  - solo avisa: no cierra ni toca nada.
- **Guardado seguro** (`trading/safe_io.py`): `trading_config.json`, `credentials.json`, `bot_settings.json`, `order_history.json`, `trading_directions.json` y `accounts.json` se escriben en un temporal que reemplaza al archivo. Si otro programa lo tiene abierto en ese instante (OneDrive, otra app), reintenta. Si no puede, el anterior queda intacto.
- **Pruebas:** `backend/tests/positions_checks.py` (38) usa un WebSocket falso en 127.0.0.1 que comprueba la firma y un Bybit simulado por REST. Probado también con el Python del bot (`.venv`, websockets 16). `accounts_checks.py` (31) apaga el WebSocket.

**IMPORTANTE:** reiniciar el bot para tenerlo. Nada se probó contra Bybit real: el WebSocket privado y las tres acciones conviene probarlos primero con una cuenta Demo. App 10 no tiene botones para estas acciones; las usa la suite.

## Journal de trades reales (12 Noviembre 2026)

Paso 4 de la integración: el journal de la suite será el Observador de App 1 con trades reales. Esta es su base, en el bot: los hechos de cada trade (`trading/trade_journal.py`).

- **Archivo:** `3.TradingBot_Python/journal/trades.jsonl`, fuera de git (`BOT_JOURNAL_DIR` lo cambia; con `BOT_CONFIG_DIR` de pruebas queda en esa carpeta). Eventos que solo se agregan: `open`, `update`, `close` y `note`. Una línea cortada por un apagón se salta al leer. Los trades se arman al pedirlos.
- **Apertura:** la ve el WebSocket privado (posición nueva). Anota tamaño, entrada, SL, TP, apalancamiento y cuenta.
  - **Origen:** la orden que la abrió (`origin`, `source`, `pattern`, por ejemplo WATCHLIST · SWING_DETECTOR · SWING_HIGH). Desde el 12/11 se busca por su ejecución en el WebSocket (`orderId`/`orderLinkId`, de los 2 minutos anteriores y sin cerrar nada) y su orden en el historial del bot, a cualquier hora. Sin la ejecución, la orden del bot de esa moneda y lado en los 10 minutos anteriores, como antes. El trade guarda la orden en `open_order_id` y `open_order_link_id`: la suite une con ella la decisión del journal.
  - **Búsqueda posterior** (`journal_link_later`, a los 3 y a los 10 s): la ejecución puede llegar después que la posición, y una orden del bot entra a su historial cuando termina de verificarla. Antes, una orden del panel a mercado y una Limit llenada pasados 10 minutos quedaban "externa". Lo hallado se anota como evento `link`: su origen reemplaza a "externa", y si salió de esa misma orden, también al de la regla de los 10 minutos.
  - **Historial y respuesta:** cada orden del historial guarda `order_id` y `order_link_id`, y `/api/trade/manual` los devuelve.
  - **"externa":** el bot no la abrió.
  - **"anterior":** ya estaba abierta antes de arrancar el WebSocket. De esta no se sabe cuándo abrió, así que no tiene duración.
  - Si el bot se reinicia, sigue el trade anotado de la misma posición (misma moneda, lado, cuenta y entrada a menos de 0.5%).
- **Cambios:** SL, TP, tamaño o entrada distintos se anotan. El SL inicial es el primero que tuvo: el método secuencial lo pone uno o dos segundos después de llenar.
- **Cierres:** de Bybit (`/v5/position/closed-pnl`), con cantidad, entrada y salida promedio y resultado neto de comisiones:
  - se piden al arrancar y al cambiar de cuenta (7 días), cada minuto (1 día), y 3 s después de que una posición baja o desaparece;
  - cada registro se anota una vez y se une al trade abierto de esa moneda, lado y cuenta;
  - el `side` de Bybit es el de la orden que cerró: la posición es la contraria;
  - un cierre sin apertura anotada (abierto antes del journal o con el bot apagado) queda como trade "sin apertura".
- **R:** el resultado neto sobre lo que arriesgaba el SL inicial por la cantidad cerrada.
- **Rutas:** `GET /api/journal/trades?days&symbol&account` (abiertos primero), `POST /api/journal/trades/{id}/note` y `POST /api/journal/sync` (pide ya los cierres, hasta 7 días).
- **Pruebas:** `backend/tests/journal_checks.py` (29), con un Bybit simulado y ejecuciones falsas del WebSocket.

**IMPORTANTE:** reiniciar el bot. Al arrancar trae los cierres de la última semana: los trades de antes quedan como "sin apertura" y las posiciones abiertas como "anterior". Las órdenes del historial anteriores al 12/11 no tienen número: sus trades se reconocen por la regla de los 10 minutos.

---

