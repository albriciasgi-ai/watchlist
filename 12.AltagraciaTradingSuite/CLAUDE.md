# CLAUDE.md - Altagracia Trading Suite

Guía para Claude Code en esta carpeta. Comunicarse siempre en español con el usuario.

## Qué es

El conjunto nuevo que pidió el usuario el 10/11/2026: **dos apps**. Una es el Backtester (App 1), tal como está. La otra es esta: una sola app en tiempo real que va a unir watchlist, order flow, bot y journal, con el formato visual y el gráfico de App 1. Arrancó el 12/11/2026 con los pasos 1 y 3 del plan local.

**Estado (12/11/2026):**
- **Paso 1:** cáscara con los estilos de App 1, el bot como primer módulo y el gráfico de App 1 como pieza compartida.
- **Paso 2:** almacén de order flow en vivo con la finura de App 1: oficial + nube + PC.
- **Paso 3:** el gráfico en vivo con ese almacén.
- **Segunda ronda (12/11, pedidos del usuario):** Electron sin freno, todos los indicadores de App 1 (también Elementos OF), grabación propia de trades, el formato de la pestaña principal de App 1 (barra de dibujo, marcos y panel de trading), monedas nuevas, dos pestañas, panel de trading al bot real y la configuración del bot de App 10.
- **Paso 4, empezado el 12/11:** el bot endurecido (cuenta en tiempo real por su WebSocket privado, cerrar, mover SL/TP y cancelar, aviso de posiciones sin stop, guardado seguro) y, a pedido del usuario, las posiciones sobre el gráfico con su P&L, como en TradingView. Falta el journal (el Observador con trades reales).
- **Falta:** el journal del paso 4, el paso 5 (watchlist, con las alertas automáticas del Swing) y al final la mudanza a un servidor 24/7 con acceso protegido y celular.

## Reglas de diseño (fijadas con el usuario)

1. **Construir como si ya fuera el servidor:** nada que decida u opere vive en la ventana. Los ajustes van en el backend, las rutas y puertos en la configuración (`config/suite.json`, variables `SUITE_*`), y cada proceso arranca sin ventana.
2. **No copiar App 1:** el gráfico (`MiniChart`), los indicadores, los modales y los estilos se importan desde `1.Altagracia_Crypto_Backtester/Backtester/frontend/src` (alias `@app1`). Lo mismo los lectores del backend (`footprint_store.py`, `liq_store.py`). Lo nuevo del gráfico se hace en App 1.
3. **Requisitos del usuario** (memoria `unified-app-vision`): los indicadores de App 1 son los que van (el de Liquidaciones de App 1, no el del Analizador); footprints en todos los marcos como en App 1; herramientas de dibujo, nitidez y estilos de App 1; el journal será el Observador; Northflank sigue en el diseño; lo exclusivo de App 8 se deja atrás; las alertas de proximidad se harán al final, por confluencia de indicadores.
4. **El bot sigue siendo su propio proceso** (`3.TradingBot_Python`, puerto 5000). La suite lo lee y lo maneja por su API, del lado del servidor: el bot no acepta páginas de otros puertos, y así no hace falta abrirlo.

## Estructura

```
12.AltagraciaTradingSuite/
├── INICIAR_DESKTOP.bat    Uso diario: la app en Electron (ver "Escritorio")
├── INICIAR.bat            En el navegador: arma la página, levanta el servidor y abre http://127.0.0.1:13000
├── desktop/               Electron (main.cjs)
├── config/suite.example.json   Copiar a suite.json para cambiar puertos o carpetas (suite.json no va a git)
├── server/
│   ├── main.py            FastAPI, 127.0.0.1:13000
│   ├── candles.py         Velas de Bybit y validación de moneda y marco (compartido)
│   ├── market_routes.py   Indicadores de App 1 en vivo: OI, VWAP, S&R clásico, patrones, Elementos OF y setups
│   ├── bot_routes.py      Configuración, riesgo, cuentas y claves, orígenes, direcciones y órdenes del panel, con palabra de confirmación
│   ├── recorder.py        Graba los trades de las monedas de la suite (usa local_tape.py del 11000)
│   ├── official.py        Baja los días oficiales que faltan (ingest.py y build_store.py del panel)
│   ├── symbols.py         Lista de monedas (data/symbols.json)
│   ├── settings.py        Fábrica < config/suite.json < variables SUITE_*
│   └── tests/             run_checks.py (46) y bot_checks.py (52), sin conexión
└── web/                   React + Vite (desarrollo en 13001, con proxy de /api al 13000)
    ├── vite.config.js     Plugin app1Shared: el config.js de App 1 pasa a src/app1Config.js y los paquetes se resuelven aquí
    └── src/
        ├── SuiteApp.jsx   Módulos (Gráfico, Bot) y modal "Estilo" de App 1
        ├── ChartView.jsx  Formato de la pestaña principal de App 1: barra de dibujo, encabezado, un MiniChart por marco, indicadores y sus ⚙️
        ├── TradingPanel.jsx   Panel de trading en vivo: caja TP/SL, tamaño fijo o por riesgo, orden al bot
        ├── tabs.js        Pestaña 1 y 2: ajustes propios y dibujos compartidos (BroadcastChannel)
        ├── BotView.jsx    Estado, pausa, avisos críticos, posiciones, órdenes y alertas del bot
        ├── BotConfig.jsx  Configuración del bot como en App 10
        ├── BotAccounts.jsx    Cuentas de Bybit del bot: saldo, posiciones, agregar y cambiar la activa
        ├── botBook.js     Posiciones y órdenes de la cuenta activa (cada 2 s), líneas para el gráfico y acciones con confirmación
        └── botNotifications.js   Avisos de Windows del bot (solo la pestaña 1)
```

## Puertos

| Proceso | Puerto | Arranque |
|---|---|---|
| Servidor de la suite | 13000 | `C:\Python314\python.exe -B server\main.py` (o `INICIAR.bat`) |
| Frontend en desarrollo | 13001 | `cd web` y `npx vite` |
| Bot | 5000 | el de siempre |
| Backend de Order Flow (graba trades) | 11000 | el de siempre |

## Servidor

Las rutas del mercado responden igual que las del backend de App 1, para que el gráfico se use tal cual:

| Ruta | Qué hace |
|---|---|
| `GET /api/historical/{symbol}?interval&days` | Velas de Bybit. Días por marco: 1m 3, 5m 10, 15m 30, 1h 120, 4h 365. Caché de 5 s |
| `GET /api/orderflow/historical/{symbol}` | `footprint_store.footprints(..., live=True)`: días oficiales y, donde faltan, nube + PC. `known_until` nunca pasa de ahora |
| `GET /api/orderflow/profile/{symbol}` | Perfil real (VP Periodic y VP fijo), también con `live=True` |
| `GET /api/liquidations/{symbol}` | `liq_store.window` de App 1 (se actualiza con la tarea diaria "App1 Liquidaciones") |
| `GET/POST /api/drawings/{symbol}` | Dibujos por moneda en `data/drawings`, con temporal y reemplazo; un archivo dañado responde 500 |
| `GET /api/bot/overview` | Estado, avisos críticos y últimas 50 órdenes del bot (no consulta Bybit) |
| `GET /api/bot/positions` | Posiciones abiertas de todas las monedas (`all=true`). El bot las tiene al día por su WebSocket privado: la página las lee cada 2 s sin consultar Bybit |
| `GET /api/bot/orders/open?symbol`, `/executions`, `/stream` | Órdenes abiertas, ejecuciones recientes y estado del WebSocket privado del bot |
| `POST /api/bot/position/close` | Cierra a mercado una posición. Exige `"confirm": "CERRAR_POSICION"` y `side` Buy o Sell |
| `POST /api/bot/position/trading-stop` | Mueve el SL (positivo: no se quita) o el TP (0 lo quita). Exige `"confirm": "MOVER_STOP"` |
| `POST /api/bot/orders/cancel` | Cancela una orden de entrada pendiente. Exige `"confirm": "CANCELAR_ORDEN"` |
| `GET /api/bot/alerts?minutes` | Alertas recibidas por el bot |
| `POST /api/bot/pause` | Pausa o reanuda todo el trading. Exige `{"paused": bool, "confirm": "CAMBIAR_PAUSA"}` |
| `GET /api/suite/status` | Último día oficial, días en vivo, grabación (de la suite o del 11000), días oficiales y estado del bot |
| `GET/POST /api/suite/symbols`, `DELETE /api/suite/symbols/{symbol}` | Monedas de la suite. Una nueva se comprueba en Bybit (perpetuo USDT que cotiza) y empieza a grabarse |
| `GET /api/ticker/{symbol}` | Último precio de Bybit (caché de 1 s), para el panel de trading |
| `GET /api/bot/config`, `/settings`, `/directions`, `/credentials/check`, `/position/{symbol}`, `/logs` | Lectura del bot |
| `POST /api/bot/config/update`, `/config/add`, `/config/sync-precision/{symbol}`, `/config/update-risk-all`, `/settings/daily-risk-limit`, `/settings/daily-risk-reset`, `/settings/execution-method`, `/settings/allowed-origins`, `/directions/update` | Cambios del bot. Exigen `"confirm": "CAMBIAR_CONFIG"` y validan cada campo (SL hasta 50%, TP hasta 500%, apalancamiento hasta 100, orígenes y direcciones conocidos) |
| `POST /api/bot/credentials` | Claves de Bybit al bot. Exige `"confirm": "CAMBIAR_CLAVES"` y `demo` booleano. La suite no las guarda |
| `GET /api/bot/accounts`, `/accounts/{id}/summary` | Cuentas de Bybit del bot (sin el secreto; de la clave, los últimos 4 caracteres) y el patrimonio, el disponible y las posiciones de cada una |
| `POST /api/bot/accounts`, `/accounts/{id}/delete` | Agregar o borrar una cuenta. Exigen `"confirm": "CAMBIAR_CLAVES"`; agregar, además, nombre de 1 a 40 caracteres y `demo` booleano |
| `POST /api/bot/accounts/{id}/activate` | El bot pasa a operar con esa cuenta. Exige `"confirm": "CAMBIAR_CUENTA"` |
| `POST /api/bot/accounts/{id}/rename` | Renombrar. Exige `"confirm": "CAMBIAR_CONFIG"` |
| `POST /api/bot/trade` | Orden del panel a `/api/trade/manual`. Exige `"confirm": "ENVIAR_ORDEN_REAL"`, Market o Limit (el bot no tiene stop), cantidad, stop y objetivo a cada lado de la entrada, y una Limit que no cruce el precio |
| `GET /api/open-interest/{symbol}` | Serie local de 5 min (`oi_store`, `OrderFlowData/oi`) y, desde su final hasta ahora, Bybit REST `/v5/market/open-interest`. Con rango (`start_timestamp_ms`, `end_timestamp_ms`) o con `interval&days`. Lo de Bybit queda en memoria y su último tramo se repide pasados 60 s |
| `GET /api/vwap/{symbol}` | `vwap_calculator` de App 1 sobre las velas de Bybit, incluida la vela en curso (el indicador lo repide cada 30 s) |
| `GET /api/support-resistance/{symbol}` | Regla de App 1 (`sr_levels.py`), solo velas cerradas. El indicador además recalcula en la página |
| `POST /api/rejection-patterns/detect` | `RejectionDetector` de App 1 con las velas cerradas de Bybit (o las enviadas). Nunca envía alertas |
| `POST /api/double-topbottom/detect` y `/chunk` | `DoubleTopBottomDetector` de App 1 con velas cerradas. Devuelve `patterns` además de los tramos: es lo que lee el indicador en vivo |
| `GET /api/orderflow/elements/{symbol}` | `of_elements.detect(..., live=True)`: días oficiales y, donde faltan, nube + PC con su flujo de `live/flow`. Corta en el último minuto guardado |
| `POST /api/orderflow/setups/{symbol}` | `of_setups.setups(..., live=True)` |
| `POST /api/orderflow/setups/{symbol}/evaluate` | "Evaluar" con días oficiales, como App 1. La comprobación final responde que se hace en App 1 (allí queda registrada) |
| `GET /api/orderflow/setups/{symbol}/validations` | Las comprobaciones de App 1, solo lectura |

- **Protección:** escucha en 127.0.0.1. Rechaza un Host o un Origin que no sean `localhost` o `127.0.0.1` (403), como el bot.
- **No existen** las rutas de alertas de App 1 (`/api/pattern-alert`, `/api/proximity-alerts/batch`): el gráfico nunca envía nada al bot desde aquí.
- Si existe `web/dist`, el servidor sirve la página en `/`: una sola dirección.

## Gráfico en vivo

- `MiniChart` con `backtestingMode={false}`: velas de `/api/historical` y el WebSocket de Bybit del navegador (`WebSocketManager.js` de App 1).
- **Footprints:** llegan hasta el último minuto armado del almacén, cerca de 1 minuto atrás. La vela en curso no tiene footprint completo.
- **Por qué no se veían (12/11):** el 11000 no estaba corriendo, así que no había nada grabado en vivo, y el almacén oficial de BTC llegaba al 04/11. Ahora la suite graba sola (`recorder.py`) y baja los días oficiales que faltan (`official.py`).
- **Grabación:** un solo proceso graba en `OrderFlowData/live/local` (candado `recorder.lock` en `local_tape.py`): la suite o el 11000, el que arranque primero; el otro reintenta cada minuto. Cada minuto se une con lo ya bajado de la nube (`sync_nube.py --sin-nube`) y se arman `live/store` y `live/flow`. La nube se baja aparte cada 15 minutos (`--solo-nube`), así una nube lenta no frena el armado. `SUITE_RECORD=0` lo apaga.
- **Días oficiales:** cada 6 horas (10 min después de arrancar), para las monedas que ya tienen almacén (BTC, ETH, SOL), corre `ingest.py --desde <día siguiente>` y `build_store.py`, que tienen su propio candado por moneda. `SUITE_OFFICIAL=0` lo apaga. La historia completa de una moneda nueva se baja desde el panel.
- **Step parejo (12/11, pedido del usuario):** todas las velas usan el mismo step, como en su App 1. Sin step escrito en el ⚙️ de Order Flow, el indicador pide `step_mode=uniform` y el servidor (`_uniform_step` en `main.py`) toma la mediana del rango de las últimas 500 velas cerradas del marco y la divide por 10, redondeada a 1, 2, 2.5 o 5 × 10^k. Se recalcula cada 6 horas, y la página lo mantiene mientras el precio no se aleje 30%. Hoy da en BTC 5 en 1m, 10 en 5m, 20 en 15m (lo que usa el usuario en App 1), 25 en 1h y 100 en 4h. ETH da 0.5 en 15m, SOL 0.025 y XRP 0.0005. Un step escrito en el modal manda. Antes el automático de App 1 daba a cada vela hasta 10 niveles, así que una vela ancha tenía celdas más grandes.
- **Indicadores:** los 18 de App 1 con todos sus modales: Volume Delta, Volume Profile, CVD, Interés abierto, Confluencia OI, Order Flow, FVG, VP Periodic, Volumen de Respuesta, Liquidaciones, Elementos OF (y sus setups), VWAP, Range Detection, Rejection, Double Top/Bottom, S&R, S&R v2 y Swing Detector.
- **Cambios en App 1 para el vivo (12/11), sin efecto en reproducción:** Interés abierto da por pedido solo hasta ahora y vuelve a pedir al abrir una vela nueva; `MiniChart` en vivo avisa `onDrawingsChange` al guardar dibujos. Double Top/Bottom y Rejection los vuelve a pedir la suite cada 5 minutos. Double Top/Bottom con "alertas" encendidas intenta `POST /api/pattern-alert`, que aquí no existe (queda un error en la consola, no se envía nada).
- **Cambio en App 1 (12/11):** la escala de precios del modo en vivo seguía todas las velas cargadas, y con 30 días de BTC las velas quedaban aplastadas. Ahora sigue las velas a la vista, como en reproducción. App 1 no usa el modo en vivo, así que su reproducción no cambia.
- **Ajustes:** cada indicador guarda sus ajustes en el `localStorage` de esta página (puerto distinto al de App 1), con las mismas claves de App 1.
- **Formato:** el de la pestaña principal de App 1 (no el del 2.º gráfico): barra de dibujo a la izquierda (deshacer, rehacer, borrar), encabezado con moneda, "+", estado, marcos (`TimeframeTabs`), 2.ª pestaña, Bot, Estilo, Indicadores y el botón del panel. Un `MiniChart` por marco queda montado: cambiar de marco no recarga. Cada marco tiene su lista de indicadores, como en App 1.
- **Dos pestañas:** "2.ª pestaña" abre `/?pestana=2` (en Electron, otra ventana). Cada una guarda sus marcos e indicadores (`suite_chart_1`, `suite_chart_2`), y la 2 desvía los ajustes de los indicadores con el prefijo de App 1 (`installOwnSettings` de `secondaryStorage.js`). Los dibujos son por moneda: al guardarlos en un marco pasan a los otros cuatro y a la otra pestaña por `BroadcastChannel('suite-drawings')`, si mira la misma moneda.
- **Monedas:** "+" agrega una moneda de Bybit (se comprueba en el servidor y se graba desde ese momento). Lista en `data/symbols.json`.
- En desarrollo, `window.__suiteCharts` da acceso a los gráficos desde la consola.

## Correcciones tras la primera prueba del usuario (12/11)

- **Footprints que no aparecían:** el primer armado esperaba la descarga de la nube, tardó más de 600 s y se cortó; cada armado siguiente volvía a esperarla, así que el almacén se actualizaba cada ~15 minutos y solo con lo del PC. Ahora el armado de cada minuto nunca baja la nube (ver "Grabación").
- **Descargas de la nube colgadas:** el collector guardaba sus footprints releyendo y reescribiendo el día comprimido dentro de su único bucle: se trababa hasta 30 s (`/health` tardaba de 1 a 30 s) y las descargas de `/api/tape` se quedaban a mitad. Corregido en el collector (ver `5.Order_flow/cloud_collector/DEPLOY_NORTHFLANK.md`) y desplegado el 12/11: las descargas llegan completas (BTC, 2 MB, en 48 a 93 s), aunque lentas, de 15 a 40 KB/s. `sync_nube.py` espera hasta 300 s sin datos por archivo: con 90 s, BTC (hasta 93 s) fallaba. Además baja con httpx: con `urllib`, que pide "Connection: close", el proxy de Northflank cerraba a mitad las descargas lentas (BTC: 0.68 de 2.08 MB, con un error de SSL), y por eso en el PC solo llegaban las monedas pequeñas. Medido en el PC: BTC y ETH completos, a unos 11 KB/s.
- **Velas de otro marco y saltos:** `getBybitInterval` de `MiniChart` no reconocía "1m", "1h" ni "4h" y los cinco gráficos pedían velas de 15m; el WebSocket compartido además tenía un solo marco. Ahora `WebSocketManager.js` suscribe por moneda y marco, y cada gráfico descarta velas de otro marco o anteriores a su última vela.
- **Dibujos que no se borraban:** los cinco gráficos escuchaban la tecla Suprimir; los ocultos guardaban su lista vieja al mismo tiempo y el dibujo volvía. Ahora solo responde el gráfico a la vista, y solo si borró algo.
- **Footprint "más bajo" que la vela:** era una vela que la grabación no cubrió entera (la app arrancó a mitad de la vela y la nube no llegaba). El footprint de una vela con hueco lleva encima "parcial".
- **Velas de Bybit:** `/api/historical` daba error 500 si Bybit tardaba; ahora reintenta tres veces y responde 503.
- **Footprints que nunca llegaban (segunda vuelta):** el servidor respondía `known_until` = ahora, y la página daba por vista una vela cuyos trades aún no estaban en el almacén (va 1-2 min detrás): quedaba vacía o parcial hasta recargar. En 1m pasaba con todas. Además la página nunca pedía la vela en curso. Ahora `/api/orderflow/historical` responde hasta el último minuto armado (`market_routes._live_cut`) y el indicador, solo en vivo, repide cada 10 s mientras el almacén va detrás, pide la vela en curso y cada minuto repide las velas sin datos o con hueco (la nube puede llenarlas después). Probado: los footprints de 1m aparecieron minuto a minuto sin recargar.
- **Días oficiales:** `official.py` bajó solo los días del 05 al 11/11 de BTC el mismo 12/11.

## Panel de trading

- A la derecha, como en App 1, con pestañas Trading y Posición. Envía al bot real por `/api/bot/trade`.
- Toma la caja TP/SL del gráfico tocada más recientemente (creada o movida, como App 9). Sin caja: lado, SL % y TP % (obligatorios) y SL/TP rápido.
- Tamaño por monto fijo o por riesgo (`orderPlan.js` de App 1), redondeado al paso de la moneda en el bot y con su mínimo. Muestra lo que pierde y gana, sin comisiones.
- Tipo automático: a 0.1% o menos del precio Market; más lejos Limit si el precio debe volver. Si pediría una orden stop no se envía: el bot no las tiene.
- Se bloquea, con el motivo, sin bot, sin credenciales, en pausa, con la moneda sin configurar en el bot, con SL o TP del lado equivocado o con una Limit que cruza el precio.
- Confirmación con moneda, lado, tipo, cantidad, stop, objetivo y pérdida/ganancia; "Cuenta REAL" en rojo si el bot está en LIVE. El resultado dice si quedó sin stop o es desconocido, para no reintentar.
- El título del panel y el de la confirmación dicen el modo y la cuenta activa del bot ("Panel de Trading · LIVE · Real BTC").
- Posición (desde el 12/11): cada posición de la moneda con lado, tamaño, entrada, P&L al precio actual, SL ("SIN STOP" en rojo si no tiene), TP y liquidación. Trae "Mover SL…", "Mover TP…" o "Poner TP…", "Quitar TP…" y "Cerrar posición…". Las órdenes de entrada pendientes traen "Cancelar orden…". Es lo mismo que se hace en el gráfico (ver "Posiciones en el gráfico").

## Posiciones en el gráfico

Pedido del usuario (12/11): ver, como en TradingView, el estado y el P&L de cada posición sobre el gráfico de su moneda, moviéndose con el precio, como parte del servicio del bot.

- **Qué se ve** (`positionLines.js` de App 1, vía `getPositionLines` de `MiniChart`):
  - la entrada con "Long 0.01 | +12.34 USD (+0.25%) ×", al último precio del gráfico y sin comisiones;
  - el SL y el TP con lo que se perdería o ganaría ahí;
  - el precio de liquidación;
  - las órdenes de entrada pendientes ("Limit compra 0.01 ×"), con su SL y TP adjuntos;
  - cada línea con su precio en el eje;
  - el % es el ROI sobre el margen, como en Bybit (cambio del precio × apalancamiento). El P&L usa el último precio del gráfico; Bybit usa el precio marca, así que difieren unos centavos.
- **Fuera de la vista** (corregido el 12/11, al probarlo el usuario con un short de BTC a 79,261.4, SL 82,293.4 y TP 65,227.5, con el precio en 71,534):
  - la etiqueta queda en el borde con ▲ o ▼ y su precio real ("▲ Short 0.003 @ 79261.4"), apilada con las otras y sin línea. Antes no decía el precio y parecía estar en el del borde;
  - las de arriba van bajo los botones del gráfico (HTML), que las tapaban; una etiqueta a la altura de los botones se corre a su izquierda;
  - **⇕** en la etiqueta de la posición, o un clic en una etiqueta fuera de la vista, ajusta la escala para ver entrada, SL y TP con sus líneas hasta el eje. Otro clic en ⇕ vuelve a seguir las velas. Es solo de la vista: no llega al bot. Con niveles lejanos las velas quedan apretadas.
- **Qué se hace, solo con el cursor de selección:**
  - × de la posición la cierra a mercado; × de una orden la cancela; × del TP lo quita;
  - la etiqueta del SL o del TP se arrastra para moverlo. La línea sigue al mouse con lo que se perdería o ganaría, y dice "no válido" del lado equivocado del precio;
  - sin SL o sin TP, las etiquetas "SL" y "TP" junto a la entrada se arrastran para ponerlos.
- **Confirmación:** cada acción pide confirmar con la moneda, la cuenta (y si es REAL), el precio ya llevado al tick como lo dejará el bot y el P&L en ese precio. Mientras viaja, la línea queda punteada con "moviendo…". El resultado sale en un aviso sobre el gráfico.
- **Datos:** `botBook.js` lee `/api/bot/positions` y `/api/bot/orders/open` cada 2 s para toda la página, y el gráfico a la vista se redibuja cuando cambian. Las ×, el arrastre y el panel van a las rutas `CERRAR_POSICION`, `MOVER_STOP` y `CANCELAR_ORDEN`. El bot vuelve a validar todo con el precio de Bybit.
- **Avisos de Windows** (`botNotifications.js`, solo la pestaña 1): aviso crítico del bot (por ejemplo una posición sin stop), pausa o reanudación, y posición abierta o cerrada. En Electron la página sigue trabajando oculta en la bandeja.
- **Con un bot de antes:** las posiciones llegan, solo de las monedas configuradas; las órdenes pendientes y las acciones no (hay que reiniciar el bot).

Probado el 12/11 en la copia aislada con un bot falso y el precio real de BTC, con eventos de mouse sobre el lienzo:
- arrastrar el TP 30 px pidió 72745.5 (llevado al tick) con +14.07 USD, y llegó al bot falso una vez;
- un SL arrastrado sobre el precio de un long no pidió confirmación y avisó;
- × del TP, de la orden y de la posición llegaron una vez cada uno;
- en un short sin stop, el SL arrastrado desde la entrada pidió 72368.7 con −13.37 USD;
- el TP escrito en el panel llegó igual.

Nada se probó contra el bot real ni contra Bybit.

## Configuración del bot

En Bot > "Configuración y riesgo" (`BotConfig.jsx`), lo de App 10:
- **Riesgo:** riesgo diario usado y su reinicio, límite diario, riesgo por trade para todas las monedas y método de ejecución (integrado o secuencial).
- **Orígenes de alertas:** Analizador, Watchlist y Order Flow.
- **Monedas:** riesgo, SL %, TP %, dirección (DISABLED, LONG, SHORT, BOTH) y precisión de Bybit por moneda; agregar una con riesgo, SL, TP y apalancamiento. El apalancamiento solo se fija al agregarla: el bot no tiene ruta para cambiarlo.
- **Cuentas de Bybit:** ver la sección siguiente.
- Cada cambio pide confirmación en la página y la palabra en el servidor.

## Cuentas de Bybit

Pedido del usuario (12/11): agregar otras claves de Bybit, para trading real o de otras cuentas, y manejarlas todas desde la suite. Eligió **una activa a la vez**.

- **Dónde:** Bot > "Configuración y riesgo" (`BotAccounts.jsx`). Una fila por cuenta con nombre, DEMO o REAL, los últimos 4 caracteres de la clave, patrimonio, disponible y posiciones abiertas ("sin SL" en rojo si alguna no tiene stop). Botones "Usar esta…", "Renombrar" y "Borrar…" (la activa no se borra). Abajo, el formulario para agregar una (nombre, API key, secret y Demo) y "Actualizar saldos".
- **Una activa:** el bot opera solo con ella, en las alertas automáticas y en el panel de trading. La dicen el título del panel, la confirmación de cada orden y la tarjeta "Modo · cuenta activa" del módulo del bot.
- **Cambiar de cuenta:** pide confirmación y avisa que las posiciones de la cuenta anterior siguen en Bybit con su stop y su objetivo, pero el bot deja de vigilarlas. El bot valida la clave antes (rechaza una mala o de solo lectura). Responde 409 si hay una orden ejecutándose, y mientras cambia no empieza ninguna.
- **Agregar:** la cuenta no pasa a ser la activa. El bot la valida en Bybit y la guarda aunque falle, con el motivo (⚠ junto a la clave).
- **Claves:** van directo al bot (`3.TradingBot_Python/config/accounts.json`, fuera de git, como `credentials.json`). La suite no las guarda, no las escribe en su registro y no las muestra.
- **Compartido entre cuentas:** la configuración por moneda, las direcciones, los orígenes, la pausa y el riesgo diario son del bot y valen para la cuenta activa.
- **Detalle del bot:** `10.TradingBotDesktop/CLAUDE.md` sección "Cuentas de Bybit".

Probado el 12/11 en la copia aislada con un bot falso:
- tabla con dos cuentas y sus saldos;
- cambio a la real: el título del panel pasó a "Panel de Trading · LIVE · Real BTC";
- renombrar, agregar y borrar llegaron al bot con su palabra.

El bot se probó con un Bybit simulado (`accounts_checks.py`). Nada se probó contra Bybit real.

## Módulo del bot

- Tarjetas: modo (LIVE, TESTNET o DEMO) con el nombre de la cuenta activa, pausa, credenciales, monedas, órdenes en el historial y ejecuciones desde que arrancó, con los SL y TP fallidos.
- Listas: avisos críticos, posiciones (en rojo las que no tienen SL), últimas 30 órdenes y alertas de 4 horas.
- La pausa pide confirmación en la página y la palabra en el servidor. La configuración está en "Configuración y riesgo" y las órdenes en el panel de trading.

## Escritorio (Electron)

Pedido del usuario (12/11): que la app no se congele por inactividad (el navegador frena las pestañas en segundo plano) y no pierda datos ni alertas. La página es la misma que sirve el servidor; Electron solo la muestra sin ese freno.

- **Arranque:** `INICIAR_DESKTOP.bat` (instala Electron en `desktop/` la primera vez y lo abre). También `cd desktop` y `npm start`.
- **Archivos:** `desktop/package.json` (Electron 33, como Apps 9 y 10), `desktop/main.cjs` y `desktop/icon.ico`. `desktop/node_modules/` no va a git.
- **Ícono (12/11):** el usuario eligió el perfil de volumen azul y oro con fondo blanco ("P1": barras azules fuera del área de valor, doradas dentro y la línea del POC). Antes, ese mismo día, había elegido el monograma "A" verde, que queda como diseño `a`. `desktop/make_icon.py` lo dibuja con Pillow y escribe `desktop/icon.ico` (16 a 256 px), `desktop/icon.png` y `web/public/icon.svg` (ícono de la página). En 16 a 24 px usa barras más gruesas y el borde más marcado. `python -B make_icon.py a` vuelve al monograma. `app.setAppUserModelId('Altagracia.TradingSuite')` hace que la barra de tareas y los avisos muestren la app con su ícono y no como Electron. Si cambian `web/index.html` o `web/public`, la app también vuelve a armar la página.
- **Al abrir:**
  1. Si el código de la página (de la suite o de App 1) es más nuevo que `web/dist/index.html`, la vuelve a armar (si falla, sigue la anterior). Si falta, corre `npm install` (si falta `web/node_modules`) y `npm run build` en `web/`, con la salida en la ventana de carga.
  2. Pide `/api/suite/status`. Si responde, usa ese servidor y no lo toca. Si no, lo lanza sin ventana (`python -B server\main.py`, cwd en la suite) y espera hasta 120 s. Si se cierra al arrancar o no responde, la ventana de carga lo dice.
  3. Abre la ventana principal en `http://127.0.0.1:<puerto>/`. Si el servidor que ya corría no sirve la página (arrancó antes de armarla), avisa que hay que cerrarlo.
- **Configuración:** puerto `SUITE_PORT` > `port` de `config/suite.json` (o `SUITE_CONFIG`) > 13000. Python `SUITE_PYTHON` > `python` de `config/suite.json` > `C:\Python314\python.exe`. Las variables `SUITE_*` pasan tal cual al servidor que lanza.
- **Sin freno:** `backgroundThrottling: false` en todas las ventanas, los switches `disable-renderer-backgrounding`, `disable-background-timer-throttling` y `disable-backgrounding-occluded-windows`, y `powerSaveBlocker.start('prevent-app-suspension')`.
- **Ventanas extra:** un `window.open` del mismo origen, o en blanco (las ventanas que App 1 llena con un portal), abre otra ventana Electron con las mismas preferencias. Una URL externa va al navegador del sistema y no abre ventana; tampoco se navega fuera del origen.
- **Bandeja:** "Mostrar", "Nueva ventana" y "Salir". Cerrar la ventana principal la oculta en la bandeja y la página sigue trabajando; si la página la cierra con `window.close()`, se vuelve a abrir oculta. Solo "Salir" cierra de verdad.
- **Al salir:** cierra el servidor solo si lo lanzó la app. Si ese servidor se cae mientras la app corre, lo vuelve a lanzar (hasta 5 veces en 10 minutos) y recarga las ventanas. Una página caída se recarga sola.
- **Una sola instancia:** abrirla otra vez muestra la ventana existente. Si el código cambió desde que arrancó (la página, el servidor, el backend de App 1, `local_tape.py`, `sync_nube.py` o `main.cjs`), se reinicia sola con la versión nueva (`newestCode()`, 51 ms). Antes, cerrar con la X y volver a abrir mostraba la versión vieja: el 12/11 el usuario probó así y ningún arreglo estaba corriendo. "Reiniciar" en la bandeja y en el menú Suite hace lo mismo a pedido. "Registro del servidor" abre `data/servidor_desktop.log`: en Electron el servidor corre sin ventana, mientras que `INICIAR.bat` sí abre su terminal. El servidor responde la página (`/` y `.html`) con `Cache-Control: no-cache`, para que Electron no muestre una página vieja de su caché.
- **Menú:** Suite (nueva ventana, ocultar, salir) y Ver (recargar, recargar sin caché, herramientas de desarrollo, zoom y pantalla completa).
- **Registros:** `data/desktop.log` (la app) y `data/servidor_desktop.log` (salida del servidor que lanzó), o en `SUITE_DATA_DIR`.

Probado el 12/11 con un servidor de prueba en 13200 (`SUITE_DATA_DIR` y `SUITE_ORDERFLOW_DATA` en carpetas temporales, `SUITE_BOT_URL=http://127.0.0.1:9`) y perfil de Electron aparte:
- lanzó el servidor, la ventana pidió `/`, los archivos de la página, velas y footprints;
- `window.open('/?pestana=2')` y `window.open('')` abrieron ventanas Electron;
- con la ventana cerrada (oculta en la bandeja), un `setInterval` de 50 ms dio 60 de 60 ticks en 3 s;
- `window.close()` desde la página la reabrió oculta; una segunda instancia mostró la existente;
- al salir cerró el servidor que lanzó; con un servidor ya corriendo lo usó y lo dejó vivo;
- al matar el servidor lo volvió a lanzar en 7 s.

No se probaron: el armado de `web/dist` desde la app (no se borró la página armada), los clics del menú de la bandeja, la apertura de una URL externa ni el bot real.

## Pruebas

```bash
cd server
C:\Python314\python.exe -B tests\run_checks.py
C:\Python314\python.exe -B tests\bot_checks.py
```

Las pruebas ponen `SUITE_RECORD=0` y `SUITE_OFFICIAL=0`: nunca escriben en el `OrderFlowData` real. Una copia de prueba del servidor debe usar `SUITE_ORDERFLOW_DATA` y `SUITE_DATA_DIR` temporales.

Probado el 12/11 (segunda ronda) en una copia aislada: servidor en 13100 con un `OrderFlowData` vacío en una carpeta temporal y grabando de verdad, frontend en 13101 y un bot falso en 59998:
- formato de la pestaña principal, cinco marcos montados y panel de trading;
- grabación de 21 monedas y footprints de 1m sobre lo grabado por el PC;
- los 18 indicadores encendidos sin errores, con Interés abierto (2,880 puntos), VWAP, S&R (18 niveles) y Double Top/Bottom (22 patrones);
- dibujos: guardados en 15m pasaron a los otros marcos y a la 2.ª pestaña;
- moneda nueva (LINKUSDT) agregada y una inexistente rechazada;
- orden del panel: una sola llamada a `/api/trade/manual` con su stop y objetivo; la caja TP/SL se tomó como Limit;
- configuración: cambiar el riesgo de BTCUSDT llegó al bot falso.

Hallado en la prueba: una descarga de la nube se cortó a mitad (0.67 de 1.8 MB) y `sync_nube.py` la guardaba igual, así que el día de BTC no se podía unir. Ahora rechaza una descarga incompleta, lee el archivo entero antes de reemplazar el anterior y, si un archivo de la nube es ilegible, une el día con lo del PC y lo vuelve a bajar.

No se probó contra el bot real, con claves reales ni con el 11000 grabando a la vez.
