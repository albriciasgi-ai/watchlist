# CLAUDE.md - Altagracia Trading Suite

Guía para Claude Code en esta carpeta. Comunicarse siempre en español con el usuario.

## Qué es

El conjunto nuevo que pidió el usuario el 10/11/2026: **dos apps**. Una es el Backtester (App 1), tal como está. La otra es esta: una sola app en tiempo real que va a unir watchlist, order flow, bot y journal, con el formato visual y el gráfico de App 1. Arrancó el 12/11/2026 con los pasos 1 y 3 del plan local.

**Estado (12/11/2026):**
- **Paso 1:** cáscara con los estilos de App 1, el bot como primer módulo y el gráfico de App 1 como pieza compartida.
- **Paso 2:** almacén de order flow en vivo con la finura de App 1: oficial + nube + PC.
- **Paso 3:** el gráfico en vivo con ese almacén.
- **Segunda ronda (12/11, pedidos del usuario):** Electron sin freno, todos los indicadores de App 1 (también Elementos OF), grabación propia de trades, el formato de la pestaña principal de App 1 (barra de dibujo, marcos y panel de trading), monedas nuevas, dos pestañas, panel de trading al bot real y la configuración del bot de App 10.
- **Paso 4, empezado el 12/11:**
  - el bot endurecido: cuenta en tiempo real por su WebSocket privado; cerrar, mover SL/TP y cancelar; aviso de posiciones sin stop; guardado seguro;
  - a pedido del usuario, las posiciones sobre el gráfico con su P&L, como en TradingView;
  - el journal: los hechos de cada trade real y lo del Observador (imágenes, niveles elegidos, medidas, informe e ir al gráfico). Ver "Journal".
- **Paso 5, 12 y 13/11:** el servidor detecta el Swing con las reglas de App 1 y lo anota, sin enviar alertas (parte A); el indicador del gráfico dibuja lo que calcula el servidor (parte B), y la vista Watchlist muestra todas las monedas (parte C). Ver "Swing del servidor" y "Watchlist".
- **Tras probar la Watchlist (13/11):** sus gráficos se mueven y se acercan, las monedas se agregan desde ella, las pestañas 2 a 5 abren cualquier módulo y los indicadores son los mismos en los cinco marcos. Ver "Pedidos tras probar la Watchlist".
- **Dashboard del journal (13/11):** los widgets del dashboard de App 1 con los trades reales del bot y el estilo elegido. Ver "Journal".
- **Falta:**
  - del journal: delta y OI de los días recientes en las medidas, y la lectura de la regla del laboratorio;
  - las alertas del Swing quedan para la central de alertas de confluencia;
  - al final, la mudanza a un servidor 24/7 con acceso protegido y celular.

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
│   ├── journal_store.py   Journal: contexto de decisión, imágenes, medidas y lecturas guardadas (data/journal), unidos a los trades del bot
│   ├── journal_measures.py    Las 58 medidas de App 1 (measures.py) para un trade real, con velas de Bybit
│   ├── journal_reading.py     La lectura de la regla del laboratorio (observer.read_at de App 1) y el OI local + Bybit
│   ├── journal_routes.py  Imágenes (contrato de App 1), contexto, medidas, lectura de la regla e informe del journal
│   ├── recorder.py        Graba los trades de las monedas de la suite (usa local_tape.py del 11000)
│   ├── book_recorder.py   Graba el libro completo de Bybit (orderbook.full) de las monedas de la suite (ver "Libro completo")
│   ├── book_store.py      Formato y lectura del libro grabado (OrderFlowData/live/book, y live/book_cloud de la nube)
│   ├── book_cloud.py      Baja de la nube (Northflank) los minutos del libro que el PC no tiene completos
│   ├── book_measures.py   Medidas del libro de cada trade del journal (grupo "Libro")
│   ├── book_study.py      Medición de semanas: qué hace la liquidez al llegar el precio a tus zonas, contra zonas al azar
│   ├── official.py        Baja los días oficiales que faltan (ingest.py y build_store.py del panel)
│   ├── swing_rules.py     La regla del indicador Swing de App 1, en Python (sin red ni archivos)
│   ├── swing_watch.py     Swing del servidor: detecta al cierre de cada vela y anota en data/swing; nunca envía
│   ├── symbols.py         Lista de monedas (data/symbols.json)
│   ├── settings.py        Fábrica < config/suite.json < variables SUITE_*
│   └── tests/             run_checks.py (46), bot_checks.py (56), journal_checks.py (63), swing_checks.py (102), book_checks.py (60) y book_cloud_checks.py (16), sin conexión
└── web/                   React + Vite (desarrollo en 13001, con proxy de /api al 13000)
    ├── vite.config.js     Plugin app1Shared: el config.js de App 1 pasa a src/app1Config.js y los paquetes se resuelven aquí
    └── src/
        ├── SuiteApp.jsx   Módulos (Gráfico, Watchlist, Bot) y modal "Estilo" de App 1; abre el módulo que pide una pestaña nueva
        ├── ChartView.jsx  Formato de la pestaña principal de App 1: barra de dibujo, encabezado, un MiniChart por marco, indicadores y sus ⚙️
        ├── TradingPanel.jsx   Panel de trading en vivo: caja TP/SL, tamaño fijo o por riesgo, orden al bot
        ├── tabs.js        Pestañas 1 a 5: ajustes propios, y dibujos y monedas compartidos (BroadcastChannel)
        ├── TabsMenu.jsx   Menú "Pestañas": abre de la 2 a la 5 con el gráfico, la Watchlist, el journal o el bot
        ├── BotView.jsx    Estado, pausa, avisos críticos, posiciones, órdenes y alertas del bot
        ├── BotConfig.jsx  Configuración del bot como en App 10
        ├── BotAccounts.jsx    Cuentas de Bybit del bot: saldo, posiciones, agregar y cambiar la activa
        ├── botBook.js     Posiciones y órdenes de la cuenta activa (cada 2 s), líneas para el gráfico y acciones con confirmación
        ├── JournalView.jsx    Journal de trades reales (Bot > Journal): "Trades" o "Dashboard"
        ├── JournalDashboard.jsx   Dashboard del journal: los widgets del dashboard de App 1 con los trades reales y el estilo elegido
        ├── journalStats.js    Cálculos del dashboard (sin React): trades del bot para los widgets, cómo cerró cada uno, riesgo y recompensa
        ├── botNotifications.js   Avisos de Windows del bot (solo la pestaña 1)
        ├── openDecision.js    Lo elegido para un trade que se abre (su decisión en el journal), para la imagen de apertura
        ├── swingServer.js El Swing del gráfico con las señales y las reglas del servidor (lo usan el gráfico y la Watchlist)
        └── WatchlistView.jsx  La Watchlist: todas las monedas en una cuadrícula y el panel del Swing
    └── tests/             journalStats.test.mjs (9) y openDecision.test.mjs (5), con node
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
| `GET /api/bot/journal?days&symbol`, `POST /api/bot/journal/sync` | Trades reales del journal del bot; pedir ya los cierres a Bybit |
| `POST /api/bot/journal/{id}/note` | Nota de 1 a 4000 caracteres en un trade (no mueve dinero: sin palabra de confirmación) |
| `POST /api/screenshots/session/{sesión}`, `GET .../{sesión}/{archivo}` | Imágenes del gráfico (el contrato de App 1: `MiniChart.captureScreenshot` las sube aquí). Solo PNG de hasta 12 MB, en `data/journal/images` |
| `POST /api/journal/context` | Contexto del journal: `decision` (imagen, nota, niveles elegidos, orden, y desde el 12/11 `order_id`, `order_link_id` y `outcome` placed/unknown), `open`, `close` o `after` (imagen; `after` con `until`, entre el cierre y ahora). Se valida y se acota todo |
| `GET /api/journal/decision?order_id\|order_link_id` | La decisión guardada de una orden de Bybit: al cancelar una Limit del panel, lo elegido para ella vuelve a la lista |
| `GET /api/journal/measures/{id}`, `/api/journal/catalog` | Las 58 medidas de App 1 al decidir y lo máximo a favor y en contra; las de un trade cerrado quedan guardadas (versión 2 desde el 13/11: las anteriores se vuelven a calcular) |
| `GET /api/journal/reading/{id}` | La lectura de la regla del laboratorio al decidir (`observer.read_at` de App 1), con su comparación por bloques y sus condiciones. Solo de un trade cerrado: con el abierto responde `hidden`. Queda guardada cuando el almacén llegó a la hora de la decisión |
| `GET /api/journal/report?days` | Ganadoras contra perdedoras en cada medida (`patterns.compare_groups` de App 1) y, en `rule`, las tablas del informe del Observador con las lecturas completas. Calcula hasta 8 medidas y 8 lecturas que falten por pedido |
| `GET /api/bot/alerts?minutes` | Alertas recibidas por el bot |
| `POST /api/bot/pause` | Pausa o reanuda todo el trading. Exige `{"paused": bool, "confirm": "CAMBIAR_PAUSA"}` |
| `GET /api/suite/status` | Último día oficial, días en vivo, grabación (de la suite o del 11000), días oficiales, estado del bot y del Swing del servidor |
| `GET /api/swing/status`, `/config`, `/signals/{symbol}`, `/log`; `POST /api/swing/config`, `/profile-rects/{symbol}` | Swing del servidor: ver "Swing del servidor" |
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
- **Pedidos a Bybit (13/11):** a lo sumo 10 por segundo desde el servidor (`candles.bybit_turn()`), y con "Too many visits" se espera y se vuelve a pedir. Ver "Watchlist".
- **Bot sin respuesta (12/11):** 503 si no hubo conexión (el bot no recibió nada) y 504 si se envió y no llegó respuesta (una orden pudo salir). Antes los dos daban 503.
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
- **Formato:** el de la pestaña principal de App 1 (no el del 2.º gráfico): barra de dibujo a la izquierda (deshacer, rehacer, borrar), encabezado con moneda, "+", estado, marcos (`TimeframeTabs`), Pestañas, Watchlist, Bot, Estilo, Indicadores y el botón del panel. Un `MiniChart` por marco queda montado: cambiar de marco no recarga. Hasta el 13/11 cada marco tenía su lista de indicadores, como en App 1; ahora es una sola para los cinco (ver "Pedidos tras probar la Watchlist").
- **Pestañas** (dos hasta el 13/11, ahora de la 1 a la 5): el menú "Pestañas" abre `/?pestana=2` a `/?pestana=5` (en Electron, otra ventana). Cada una guarda su moneda y sus marcos (`suite_chart_<n>`); sus indicadores son los de la 1 hasta que se cambie uno en ella. Desvía los ajustes de los indicadores con un prefijo propio (`installOwnSettings` de `secondaryStorage.js`): la 2 el de App 1 (`app1_g2:`) y de la 3 a la 5 `suite_p<n>:`. Los dibujos son por moneda: al guardarlos en un marco pasan a los otros cuatro, a la Watchlist y a las otras pestañas que miran la misma moneda, por `BroadcastChannel('suite-drawings')`.
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

## Correcciones tras la prueba del journal (12/11)

El usuario probó la suite con PAXGUSDT 15m y pidió, además de escribir siempre en español:

- **Última vela dos veces:** el gráfico recarga el histórico cada 5 minutos. Si la recarga caía justo después del cierre de una vela y antes de que el WebSocket mandara la siguiente (en una moneda con pocos trades eso tarda), esa vela quedaba entre las cerradas y también como vela en curso. Se dibujaba dos veces y, al empezar la siguiente, se agregaba otra vez. Ahora `liveCandles.js` de App 1 (`mergeHistory`, `applyKline`, `withForming`, con `tests/liveCandles.test.mjs`) deja la vela en curso solo si es posterior a la última cerrada, conserva lo que el WebSocket cerró mientras se pedía el histórico y nunca agrega dos veces la misma hora.
- **"Solo dato" (punto 1):** el VWAP solo ofrecía soporte, resistencia, entrada u objetivo. Ahora todo nivel de cualquier indicador ofrece "Solo dato" (`DATA_ONLY = 'data'` en `analysisLevels.js`): queda en el análisis como precio de referencia, sin papel en el trade. Las marcas siguen con "Solo marca". En App 1, `patterns.references` lo cuenta como referencia con el papel "Solo dato".
- **Números en vez de etiquetas (punto 2):** las etiquetas moradas grandes tapaban las velas. Con `chosenStyle="numbers"` (la suite y, desde la misma noche, también App 1) cada elegido lleva un círculo morado pequeño con su número:
  - en un nivel, donde nace su línea, que es más tenue; nunca en las últimas velas (48 px del borde derecho);
  - en una marca, arriba a la derecha de su aro.
  
  Al pasar el mouse sobre el número sale la etiqueta: número, papel, nombre, precio, fuente y nota. El panel de trading muestra la lista numerada (`AnalysisLevels` de App 1 con `numbered`), con su papel editable, su nota y "×". La confirmación de la orden dice lo que va para el análisis. La imagen de la decisión lleva los mismos números, y el journal los lista en ese orden.
- **Lo elegido que se borraba (punto 3):** el panel lo sacaba de la lista al enviar la orden. Si el bot la rechazaba, o se cancelaba la Limit para cambiarla, la orden que sí se abría salía sin nada, y el journal tomaba esa decisión vacía (la más reciente). Además una Limit que se llenaba más de 15 minutos después no se unía a su decisión. Ahora:
  - la imagen sale al enviar, pero lo elegido sale de la lista solo si la orden queda en Bybit (`dropLevels`, solo lo enviado);
  - si el bot dice que no (respuesta `failed`, 4xx, o bot sin conexión), lo elegido y la nota "Por qué entro" siguen para la orden corregida y no se guarda decisión;
  - si no se sabe qué pasó (sin respuesta, 5xx o `unknown`), la decisión se guarda con una copia y la lista sigue;
  - la decisión guarda la orden de Bybit (`order_id`, `order_link_id`) y se une al trade que esa orden abrió, a cualquier hora (`open_order_id` del bot). La de otra orden conocida, como una Limit cancelada, ya no pasa al trade;
  - al cancelar desde la suite una Limit sin llenar, lo elegido para ella vuelve a la lista con su papel y su nota (`restoreLevels`), con un aviso. App 1 hace lo mismo al cancelar una orden pendiente.
- **Limitación:** una orden rechazada deja su imagen de decisión en `data/journal/images` sin usar.

Probado el 12/11 en la copia aislada (bot falso con la clase real del journal y velas reales de Bybit):
- el VWAP real elegido con un clic: el menú ofreció "Solo dato" y lo guardó con su nota; la banda inferior 1 como soporte;
- los números 1 y 2 en el gráfico y en el panel, y la etiqueta al pasar el mouse ("1 · Solo dato · VWAP 72329.8" con la nota);
- un rechazo de Bybit y un 409 del bot: lo elegido y la nota siguieron;
- una Limit aceptada: la lista quedó vacía y la decisión guardó la orden, la nota, la imagen con números y lo elegido;
- al cancelarla, lo elegido volvió con su papel y su nota;
- la Limit que la reemplazó lo llevó, y al abrirse el trade el journal mostró su decisión y no la de la cancelada.

Nada se probó contra el bot real ni contra Bybit.

## Panel de trading

- A la derecha, como en App 1, con pestañas Trading y Posición. Envía al bot real por `/api/bot/trade`.
- Toma la caja TP/SL del gráfico tocada más recientemente (creada o movida, como App 9). Sin caja: lado, SL % y TP % (obligatorios) y SL/TP rápido.
- Tamaño por monto fijo o por riesgo (`orderPlan.js` de App 1), redondeado al paso de la moneda en el bot y con su mínimo. Muestra lo que pierde y gana, sin comisiones.
- Tipo automático: a 0.1% o menos del precio Market; más lejos Limit si el precio debe volver. Si pediría una orden stop no se envía: el bot no las tiene.
- Se bloquea, con el motivo, sin bot, sin credenciales, en pausa, con la moneda sin configurar en el bot, con SL o TP del lado equivocado o con una Limit que cruza el precio.
- Confirmación con moneda, lado, tipo, cantidad, stop, objetivo, pérdida/ganancia y lo elegido para el análisis (numerado); "Cuenta REAL" en rojo si el bot está en LIVE. El resultado dice si quedó sin stop o es desconocido, para no reintentar.
- Lista numerada de lo elegido en el gráfico, sobre el botón de comprar o vender (desde el 12/11): papel ("Solo dato", soporte, resistencia, entrada u objetivo; una marca, "Solo marca"), nombre, fuente, precio, nota y "×".
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

## Journal

Paso 4 (12/11): el journal será el Observador de App 1 con trades reales (requisito 5 del usuario). Primera parte, en Bot > "Journal" (`JournalView.jsx`), con los hechos que anota el bot (`10.TradingBotDesktop/CLAUDE.md`, sección "Journal de trades reales"):
- **Resumen:** trades cerrados, acierto, P&L neto de comisiones (de Bybit), R promedio (cuántos tenían SL) y abiertos. Con más de un origen, una tabla por origen (por ejemplo WATCHLIST · SWING_DETECTOR o MANUAL · MANUAL_TRADE).
- **Trades:** abiertos primero, con el P&L sin realizar de Bybit (precio marca). Cada fila trae apertura, moneda, lado, origen, tamaño, entrada, salida promedio, SL inicial, P&L, R, duración y estado:
  - "sin posición": el journal lo tiene abierto pero Bybit ya no;
  - "antes": ya estaba abierta cuando empezó el journal.
  
  Se puede ver 7, 30, 90 o 365 días, y "Pedir cierres a Bybit" no espera el minuto.
- **Detalle** (clic en una fila): cuenta, apalancamiento, SL y TP iniciales y actuales, riesgo, cada cierre parcial, los cambios de SL/TP y las notas, con un campo para agregar otra.
- **Lo del Observador** (12/11, segunda parte), con lo de App 1 sin copiarlo:
  - **Decisión:** al enviar una orden desde el panel se toma la imagen del gráfico a la vista (con contexto, como la de decisión de App 1, y con los números de lo elegido). Cuando el bot responde se guardan la imagen, lo elegido en el gráfico para el análisis (niveles y marcas con su papel y nota), la orden propuesta, su número en Bybit y la nota opcional "Por qué entro". Lo elegido sale de la lista solo si la orden quedó en Bybit (ver "Correcciones tras la prueba del journal"). No frena la orden.
  - **Apertura y cierre:** la página toma la imagen cuando ve abrirse o cerrarse una posición en cualquier moneda. Si es la moneda a la vista, la toma de ese gráfico 1.5 s después, para que se dibuje la línea.
  - **Lo elegido en la imagen de apertura** (13/11, como App 1): la imagen dibuja, con sus números, los niveles de la decisión de ese trade (`openDecision.js`). Los busca en el journal del bot: el trade abierto de esa moneda y lado, a 10 minutos o menos de la apertura y con la entrada a menos de 0.5%, con su decisión unida. La decisión se guarda cuando el bot responde a la orden, y la posición puede verse antes: pregunta hasta 4 veces, cada 2 s. Un trade sin decisión (de una alerta) no lleva nada elegido. Antes la imagen dibujaba la lista del panel, que tras enviar la orden ya es la del trade siguiente.
  - **Moneda que no está a la vista** (12/11, pedido del usuario), o el gráfico oculto en el módulo del bot: `OffscreenCapture.jsx` arma su gráfico fuera de la pantalla, en `document.body`, y toma la imagen. Usa el marco a la vista, los indicadores de esa moneda y el tamaño del gráfico, con las líneas de la posición. Espera las velas (hasta 25 s) y luego 6 s para indicadores y footprints. Tarda unos 10 s, una imagen a la vez, y después se quita. Quien opera no ve nada, no se abre ninguna ventana y su vista no cambia.
  - **Solo la pestaña 1** toma estas imágenes: las otras las repetirían. Un cambio de cuenta no cuenta como apertura ni como cierre.
  - **Imagen de cierre como en App 1** (12/11, pedido del usuario: "me gusta más como lo hace la app 1"). `closePlan` en `ChartView.jsx` busca el trade en el journal del bot: misma moneda y lado, abierto antes y con la entrada a menos de 0.5%. Con él, la imagen:
    - encuadra desde la apertura hasta la vela más reciente (`showFrom`), con velas antes como contexto;
    - dibuja la caja del trade (`getTradeBoxes`) con la entrada y el SL y el TP vigentes al cerrar, hasta el cierre. Si se movieron, salen los nuevos. Al probarlo, el usuario movió los de ARB y salían los iniciales. Los iniciales siguen en el journal, en "SL inicial" y en el R;
    - muestra lo elegido para el trade, con sus números (los niveles de su decisión);
    - ajusta la escala a la caja completa.
    
    Usa el marco a la vista si el trade cabe en 200 velas (`closeFrame`); si no, el primer marco mayor donde quepa, fuera de la pantalla. Nunca uno menor. En el gráfico a la vista la caja solo existe mientras se dibuja la imagen: tu vista no la muestra. Sin el trade en el journal, la imagen sale como antes. De una posición "anterior" la caja empieza cuando el bot la vio.
  - **"10 velas después"** (12/11, pedido del usuario, como la de cierre de App 1): la misma imagen, en el mismo marco, termina 10 velas después del cierre (`showUntil` de `captureScreenshot`). Así se ve lo que hizo el precio tras salir. En 15m son 2.5 horas.
    - Al cerrar queda en `localStorage` (`suite_after_shots`, de la pestaña 1), así sobrevive a cerrar o reiniciar la suite.
    - Las vencidas se toman fuera de la pantalla al abrir la página y cada 30 s. Una tomada tarde termina igual a las 10 velas.
    - Se descarta si venció hace más de 3 días o si la apertura ya no está en los días que carga el marco. Tres intentos sin imagen, también.
    - Se guarda como contexto `after`, con `at` = hora del cierre y `until` = final de la imagen. Se une al trade como la de cierre, y el journal la muestra como "10 velas después" con la hora en que termina.
  - **Unión:** el contexto se une al trade del bot de la misma moneda y lado. La decisión, por la orden que abrió el trade (`open_order_id` del bot) a cualquier hora; sin ella, la más reciente hasta 15 minutos antes de abrir que no sea de otra orden conocida. La imagen de apertura, hasta 5 minutos después, y la de cierre, hasta 15 minutos después.
  - **Medidas al decidir:** las 58 de App 1 (`measures.compute`, `row_at`, `read_row`) con velas de Bybit, en la última vela de 15m cerrada antes de decidir, vistas desde el lado del trade. Se calculan al abrir el detalle, unos 10 a 20 s; las de un trade cerrado quedan guardadas en `data/journal/measures`.
  - **Delta e interés abierto de los días recientes** (13/11, versión 2 de las medidas; las guardadas antes se vuelven a calcular). Antes salían "—" en los días sin almacén oficial.
    - **OI:** la serie local de App 1 (`OrderFlowData/oi`, hoy solo BTC hasta el 05/11) y, lo que le falta, Bybit REST de 5 minutos, desde 26 horas antes de decidir (`journal_reading.oi_series`). Cada dato se usa 5 minutos después de su marca, como en App 1.
    - **Delta:** donde falta el día oficial, el de la nube y el PC (`live/store`), sin las velas que tocan un hueco de 10 s o más de la grabación ni las posteriores al último guardado. Las reconexiones del WebSocket (la mitad de los huecos, de 5.8 s) no dejan su vela sin delta. En las 8 velas de 15m con una de ellas el volumen quedó entre 0.1% y 0.6% bajo el de Bybit, y en una de XRP 6.4%. Sin esto, el delta de 4 horas casi nunca tendría sus 16 velas.
  - **Lo máximo a favor y en contra,** en R del SL inicial, con velas de 5 minutos.
  - **Lectura de la regla del laboratorio** (13/11, como el Observador de App 1): `journal_reading.py` llama a `observer.read_at` de App 1, sin copiarlo, en el minuto de la decisión (o de la apertura, sin decisión), con la entrada planeada en el panel (o la del trade) y solo lo ocurrido antes.
    - Lee el almacén de trades con `live=True` (días oficiales y, donde faltan, nube + PC) y el OI de arriba.
    - El detalle muestra, bloque por bloque, lo que leía la regla: contexto de 4 horas y de 1 hora (a favor, en contra o sin dirección, con su eficiencia y el volumen en velas alcistas), el movimiento con volumen vigente de cada marco, la zona más cercana a la entrada (cluster de volumen o FVG, a qué % y lo que daría el azar), el OI en 4 horas y el volumen de la última vela de 15m. Abajo, cuántas de las 8 partes de la regla estaban.
    - Como en App 1, solo con el trade cerrado: con el abierto, la ruta responde `hidden` y el detalle lo explica. No hay columna "Tú": la suite no pide marcas.
    - **Parcial:** la regla mira 45 días antes de la decisión. Si la moneda tiene menos días seguidos de trades grabados, la lectura se ve con un aviso y no entra en el informe: un contexto o un movimiento que no alcanzó a ver contaría como ausente. Hoy son completas BTC, ETH, SOL y ARB (almacén oficial); las demás monedas tienen trades desde el 12/11 y serán completas desde fines de diciembre.
    - Se guarda en `data/journal/readings` cuando el almacén ya llegó a la hora de la decisión (la nube baja cada 15 minutos), o pasados 2 días. Mientras tanto se repite a lo sumo cada 5 minutos.
  - **Informe:** "Informe: qué distingue a las ganadoras" compara ganadoras y perdedoras en cada medida con `patterns.compare_groups` de App 1 ("Separa": en qué parte de los pares la ganadora tiene el valor mayor; "más que el azar" si supera el umbral de las permutaciones). Con menos de 30 trades o de 5 por grupo avisa que solo describe.
    - Desde el 13/11 suma "Lo que leía la regla del laboratorio", con las funciones del informe del Observador de App 1 y solo lecturas completas: acierto y R con y sin cada condición, cuánto sigues cada parte de la regla, entradas cerca de una zona contra el azar, y tus mejores trades contra los peores (desde 6 con R). Dice cuántas lecturas son parciales, cuántos trades no tienen lectura y cuántas faltan. El R es el del bot: P&L neto sobre (entrada − SL inicial) × cantidad cerrada.
    - Calcula hasta 8 medidas y 8 lecturas que falten por pedido. Unas medidas de la versión anterior que no alcanzan a recalcularse se usan igual: solo les falta el delta y el OI recientes.
  - **Ver en el gráfico:** cambia a la moneda del trade, lleva la vista a su apertura (`focusOn`) y dibuja su caja (`getTradeBoxes`) hasta "Quitar". La caja de un trade cerrado lleva el SL y el TP vigentes al cerrar, como su imagen de cierre. La de uno abierto lleva los iniciales: los vigentes ya están en las líneas de la posición.
  - **"Al TP" y "Al SL"** (12/11, pedido del usuario): columnas de la tabla de trades. Para los abiertos, cuánto debe moverse el precio marca de Bybit, en % del precio, para tocar el TP y el SL vigentes, del libro de posiciones (cada 2 s). Negativo: ya lo pasó. "sin TP" o "sin SL" si no tiene. Los cerrados muestran "—".
- **Dashboard** (13/11, pedido del usuario: "lo que tiene la app 1 como dashboard ... con los estilos escogidos por el usuario"). Botón "Dashboard" junto a "Trades"; la vista elegida se guarda por pestaña, y los días y "Pedir cierres a Bybit" valen para las dos. Son los widgets del dashboard de App 1, importados sin copiarlos (`JournalDashboard.jsx`; las opciones nuevas de los widgets, en `Backtester/CLAUDE.md`, "DASHBOARD DE TRADING, COMPARTIDO CON LA SUITE"):
  - **Equity Curve:** el P&L neto acumulado, o el R acumulado. Es dinero real, con depósitos y retiros: no hay saldo inicial ni %. El pie dice P&L neto, R acumulado y cuántos trades no tienen R (sin SL);
  - **Profit/Loss por Trade:** en dólares, en % (lo que se movió el precio a favor) o en R. El tooltip suma moneda, origen y R;
  - **Win Rate** y **Profit Factor** (ganancia promedio sobre pérdida promedio), como en App 1;
  - **Riesgo y Recompensa:** la mayor caída del P&L acumulado desde su pico y la mayor racha de ganadores seguidos, en dólares y en el R de esa misma caída o racha;
  - **Trades Detallados:** la tabla de App 1 con la moneda, el origen y el R. Ordena por número de trade y filtra por lado y resultado. Quitar un trade de la selección lo saca de los gráficos; uno que cierra después entra seleccionado. "Reason": TP o SL si la salida quedó cerca de ellos (a una décima de la distancia del SL inicial), liquidación si Bybit la marca, y si no "Manual": Bybit no dice qué orden cerró la posición;
  - **Filtros:** moneda, origen y cuenta (si hay más de una). Se guardan por pestaña con los modos;
  - **Estilo:** los gráficos, los medidores, las tarjetas y la tabla toman los colores y la letra del estilo elegido, y cambian al instante si se elige otro. Con el Clásico se ve como el de App 1;
  - solo trades cerrados. El journal se lee cada 15 s, y los gráficos cambian solo si cambiaron los trades (`signature`);
  - no trae "Exportar a Excel": el de App 1 depende de su simulación (saldo y métricas del OrderManager).
- **Paquetes de la página** (13/11): `chart.js`, `react-chartjs-2` y `react-gauge-chart`, los del dashboard de App 1. `react-gauge-chart` usa `prop-types` y `lodash` sin declararlos: van en `web/package.json` (sin ellos, el armado los deja afuera y la página no arranca). La app de escritorio instala los paquetes cuando `web/package.json` es más nuevo que lo instalado (ver "Escritorio").
Probado el 13/11 (regla, delta y OI recientes, lo elegido en la apertura) en la copia aislada, con el almacén real (solo lectura, sin grabar ni bajar días oficiales), un bot falso y el OI real de Bybit:
- **Lectura:** un long de BTC con decisión a las 10:05 UTC se leyó en ese minuto y con la entrada planeada (69176). Contextos, movimientos, zona y OI (+1.865% en 4 horas) iguales a una llamada directa a `observer.read_at` con el OI pedido aparte a Bybit.
- **Parcial:** un short de DOGE (trades desde el 12/11) salió con el aviso, sin contexto de 4 horas ni de 1 hora, y fuera del informe.
- **Medidas** del mismo BTC: OI 0.55%, 1.22% y 2.54% en 1, 4 y 24 horas, 3 bloques en alza, delta 0.05 en la última vela de 15m y 0.07 en 4 horas. Iguales al OI pedido aparte y al delta de las velas de `footprint_store` (0.048 y 0.071). Antes salían "—".
- **Informe:** 5 lecturas completas, 1 parcial y 1 trade sin lectura. "4 horas a favor" estaba solo en ETH (+1.86 R); sin ella, 2 de 4 con R +0.36, igual que a mano.
- **Imagen de apertura:** BTC a la vista y ETH, SOL y ADA fuera de la pantalla salieron con los dos niveles de su decisión numerados. DOGE, con la decisión guardada 3 s después de abrirse la posición, llevó el suyo; XRP, sin decisión, ninguno. La página vio la de DOGE cuando la decisión ya estaba: el navegador de pruebas corría en segundo plano y frenaba sus relojes. Los reintentos se probaron en `openDecision.test.mjs`.
- Una pestaña vieja de pruebas anteriores, también pestaña 1, repetía las imágenes con el código anterior. En la app de escritorio hay una sola pestaña 1.

Probado el 12/11 ("10 velas después") en la copia aislada con un bot falso:
- al cerrar un trade de BTC de 2 horas quedó programada en 15m, 150 minutos después del cierre y con su caja;
- una de SOL vencida hace 91 minutos se tomó al abrir la página. Terminó a las 19:07, 10 velas después del cierre, aunque ya eran las 20:35;
- salió de la lista de pendientes y el journal la mostró en el trade.

Probado el 12/11 (imagen de cierre) en la copia aislada con un bot falso:
- un trade de SOL de 3 horas, sin estar a la vista, se retrató en 15m. Salieron su caja con la entrada 81.35, el TP 85.42, el SL 78.91 y R/R, y el nivel elegido con su número;
- un short de BTC de 2 horas, a la vista, tuvo su caja en la imagen, y el gráfico quedó sin ella;
- un long de BTC de 3 días, con la vista en 15m, se retrató en 1h fuera de la pantalla.

Probado el 12/11 (imágenes fuera de la pantalla) en la copia aislada, con BTC a la vista:
- abrir y cerrar una posición falsa de ETH guardó sus imágenes de apertura y cierre en unos 10 s, con la línea, el SL y el TP en la de apertura. La vista siguió en BTC;
- con el módulo del bot a la vista, la apertura de BTC también se tomó fuera de la pantalla;
- dos aperturas a la vez (SOL y XRP) salieron una detrás de otra, cada una con su moneda.

Probado el 12/11 (segunda parte) en la copia aislada, con un bot falso y velas reales de Bybit:
- **Orden del panel con nota:** se guardó la decisión con la imagen (1646x1516 px), el marco 15m, la nota y la orden. Unida al trade abierto 10 s después, el detalle la mostró.
- **Medidas:** las 58, de la vela de 15m cerrada antes de decidir, en 10 s.
- **Informe:** respondió y avisó la muestra pequeña.
- **Ver en el gráfico:** cambió a SOLUSDT y llevó la vista a la apertura.
- **Imágenes automáticas:** al abrirse y cerrarse una posición de SOL a la vista se guardaron las de apertura y cierre.

Probado el 12/11 en la copia aislada con un bot falso que usa la clase real del journal:
- números revisados a mano: SOL 11.6 / 6 = 1.93 R; DOGE −4.9 / 4.5 = −1.09 R; total +12.40;
- la nota llegó al bot y apareció;
- "Pedir cierres" respondió.

## Módulo del bot

- Tarjetas: modo (LIVE, TESTNET o DEMO) con el nombre de la cuenta activa, pausa, credenciales, monedas, órdenes en el historial y ejecuciones desde que arrancó, con los SL y TP fallidos.
- Listas: avisos críticos, posiciones (en rojo las que no tienen SL), últimas 30 órdenes y alertas de 4 horas.
- La pausa pide confirmación en la página y la palabra en el servidor. La configuración está en "Configuración y riesgo" y las órdenes en el panel de trading.

## Swing del servidor (paso 5)

Del plan del paso 5, el usuario decidió el 12/11:
- **A:** el servidor detecta el Swing. Hecho.
- **B:** el indicador del gráfico muestra lo que detecta el servidor. Hecho el 13/11.
- **C:** la vista Watchlist. Los gráficos que no se ven no se pausan: se redibujan cada 30 s. Solo si la app se vuelve lenta, un máximo de 10 gráficos en vivo elegidos por el usuario. Hecho el 13/11, sin el límite: ver "Watchlist".
- **D:** las alertas no se envían por ahora. Quedan para una central de alertas de confluencia, cuando varios indicadores cumplan sus parámetros.

El Swing de la Watchlist (App 2) sigue siendo el que manda alertas al bot, con origen `WATCHLIST`.

- **Reglas** (`server/swing_rules.py`): las de `detectSwings()` del indicador Swing de App 1, la que se ve en el gráfico, línea por línea:
  - swing alto: el máximo de la vela supera el de las `swingBars` velas de cada lado (un empate no cuenta). Swing bajo, lo mismo con el mínimo. El precio de la señal es ese máximo o mínimo;
  - z-score del volumen contra las `lookbackBars` velas anteriores, con la desviación de la población. El filtro actúa con `minZScore` mayor que 0;
  - zonas de precio (`priceZones`): las que tienen hora mandan. Con zonas activas, una señal fuera de todas no cuenta;
  - filtro VWAP: solo dentro de los rectángulos de los dibujos de la moneda, menos los que definen un VP Fixed, con las bandas `upper_N` y `lower_N`. Afuera la señal no cambia.

  En el servidor el filtro VWAP actúa cuando está encendido, aunque el indicador VWAP esté apagado en el gráfico. Usa `vwap_calculator` de App 1, cargado por su ruta (el backend de Order Flow tiene otro con el mismo nombre), con las velas del gráfico y los ajustes de `vwap`.

  Un cambio de la regla se hace en los dos archivos. `tests/swing_checks.py` corre el indicador de App 1 en node (`tests/swing_parity.mjs`) y compara 15 casos.
- **Detección** (`server/swing_watch.py`): 4 s después del cierre de cada vela del marco, pide a Bybit las últimas velas de cada moneda (REST, solo lectura), deja fuera la vela en curso y anota las señales confirmadas desde la revisión anterior. Una señal se confirma al cerrar la última de las `swingBars` velas de su derecha (`known_at`).
  - Cada consulta trae 120 velas de más. Un corte de Bybit o una pausa del PC se recuperan al volver, con su demora en `delay_ms`. Una pausa más larga queda en `missed` del estado.
  - Si falta una vela entre las del swing, la señal lleva `gap: true`.
  - Un solo proceso detecta por carpeta de datos (`data/swing/detector.lock`). El que toma el relevo lee lo anotado y no lo repite. `SUITE_SWING=0` apaga la detección; las rutas siguen.
  - El VWAP se calcula solo con su filtro encendido y rectángulos en las horas revisadas: sin ellos el resultado es el mismo.
- **Registro:** `data/swing/signals/AAAA-MM-DD.jsonl`, por día UTC de la confirmación. Cada línea tiene:
  - moneda, marco, tipo, dirección y precio;
  - hora de la vela, `known_at`, `detected_at` y `delay_ms`;
  - z-score, zona, rectángulo y hueco;
  - `swing_bars` y `rules_id`.

  Cada conjunto de reglas queda una vez en `data/swing/rules.jsonl` con su id. En 1m con 11 monedas son unas 6,000 señales y 1.3 MB por día. No se borra nada.
- **Configuración** (`data/swing/config.json`, con temporal y reemplazo): `enabled`, `interval`, `symbols`, `rules` (generales), `symbolRules` (por moneda, solo lo distinto), `vwap` (como el indicador VWAP de App 1) y `profileRectIds`.
  - La primera vez se toma del Swing de la Watchlist (`2.WatchlistConIndicadores/backend/config/swing_config.json`, solo lectura): monedas, marco y reglas, sin alertas, cooldown ni días. Sin ese archivo usa sus valores del 12/11: 1m, 11 monedas, `swingBars` 3 y 2 en diez de ellas.
  - Cada campo se valida. `swingBars` va de 1 a 20, `lookbackBars` de 2 a 200, `minZScore` de 0 a 5 y las bandas de 1 a 6. El modal de App 1 es más estrecho.
  - Un archivo dañado no se pisa: no detecta hasta que se guarde otra configuración, y entonces el dañado queda copiado en `config.danado-<fecha>.json`.
  - Los ajustes de una moneda que llegan con `symbolRules` se suman a los que ya tenía: lo que no se manda queda igual. Se guarda solo lo que difiere de las reglas generales, y una moneda sin diferencias queda sin ajustes propios.
  - El filtro VWAP acepta cero bandas, como el modal de App 1: entonces descarta lo que cae dentro de un rectángulo.
- **Rutas:**

| Ruta | Qué hace |
|---|---|
| `GET /api/swing/status` | Si detecta, marco, monedas, última vuelta, señales de hoy y, por moneda, última revisión, señales, error y pausa no recuperada. `sends: false` |
| `GET /api/swing/config` | Configuración, reglas de cada moneda (`effective`), valores de fábrica y límites |
| `POST /api/swing/config` | Cambia `enabled`, `interval`, `symbols`, `rules`, `symbolRules` (null quita los de una moneda) o `vwap`. Un valor inválido o un campo desconocido: 400 y nada cambia. No mueve dinero: sin palabra de confirmación |
| `GET /api/swing/signals/{symbol}?interval` | Señales de las velas cerradas que tiene el gráfico (los mismos días por marco), con las reglas del servidor, `known_at` y `gap`. `detected_live` dice si es el marco y la moneda que se detectan en vivo. Una vela cuenta como cerrada 4 s después de su cierre. Las velas se piden completas la primera vez (con la caché de 5 s de `/api/historical`) y después solo las últimas 200, unidas a las de antes; cada 6 horas, o si faltan velas entre unas y otras, completas otra vez. `days`: los del gráfico que pregunta (la Watchlist pide menos), hasta los de `/api/historical` |
| `GET /api/swing/log?symbol&limit&day` | Señales anotadas en vivo, las más nuevas primero. Sin `day`, las de los últimos dos días en memoria |
| `POST /api/swing/profile-rects/{symbol}` | `{"ids": [...]}`: rectángulos que definen un VP Fixed, que no cuentan para el filtro VWAP. Los manda la página cuando cambian |

- **Con la Watchlist:** con su configuración actual (sin filtro de volumen, VWAP ni zonas) salen los mismos swings, en las mismas velas. Cambia el precio: la Watchlist usa el cierre de la vela y el servidor el máximo o el mínimo, como App 1. Además, la Watchlist avisa solo el swing recién confirmado y aplica su cooldown de 5 minutos; el servidor anota todos.
- **Arreglado en App 1 (12/11):** una vela que es swing alto y bajo a la vez queda como swing alto. Su precio era el mínimo y ahora es el máximo, el de su flecha. Las zonas y el filtro VWAP revisaban ese swing alto con el precio de abajo.
- **El gráfico (parte B, 13/11, `web/src/swingServer.js`):**
  - **Señales:** el indicador Swing de cada marco dibuja las que calcula el servidor, en cualquier marco, con las reglas de la moneda y solo velas cerradas. En el marco y las monedas que el servidor vigila son las mismas que anota en vivo; en los demás, solo para ver. App 1 recibe las señales con `setExternalSignals()`.
  - **Cuándo pide:** al armarse el gráfico, al cerrar cada vela de su marco (4 s después, cuando el servidor ya la da por cerrada) y al cambiar las reglas, los dibujos o los VP Fixed. Si el servidor todavía no trae la vela recién cerrada, vuelve a pedir a los 3 s. Mientras no llega nada, el indicador no dibuja: no calcula por su cuenta, porque lo haría con la vela en curso.
  - **La flecha nueva** aparece de 5 a 10 s después del cierre, según tarde Bybit en ese momento.
  - **Modal:** el ⚙️ del Swing abre el de App 1. Arriba dice que las señales vienen del servidor y si este marco es el que se vigila en vivo. Las reglas se guardan en el servidor para la moneda, medio segundo después del último cambio, y todos los marcos vuelven a pedir sus señales. Cambiar solo las flechas no escribe en el servidor.
  - **Opciones de las flechas** (tamaño, z-score y zonas): son de cada pestaña y se guardan con sus ajustes (`swingVisual` en `suite_chart_<pestaña>`).
  - **VP Fixed:** la página manda al servidor los rectángulos que definen uno (`profile-rects`) cuando cambian.
  - **Imágenes del journal fuera de la pantalla:** llevan las mismas señales; si el servidor no responde, sin flechas.
  - **En desarrollo:** `window.__suiteSwing` tiene lo último que dio el servidor por marco.
- **Arreglado en App 1 (13/11):** un rectángulo cambiado de tamaño (por un borde o una esquina) se veía bien pero se guardaba con el tamaño anterior: al recargar, al pasar a otro marco o a la otra pestaña volvía al de antes. Ahora se guarda el nuevo. Como los rectángulos son las zonas del filtro VWAP, la página y el servidor veían rectángulos distintos.
- **Probado (parte B, 13/11):** en la copia aislada con velas reales de Bybit, BTC en 1m y 15m:
  - el indicador tuvo las mismas señales que el servidor, una por una (1,034 en 1m y 541 en 15m). En 15m el indicador de App 1, calculado en el navegador con las mismas velas cerradas, también dio 541;
  - el modal guardó `swingBars` 3 para BTC: en el servidor quedó solo lo distinto a las generales y las flechas se actualizaron solas (731);
  - con el filtro VWAP encendido y un rectángulo sobre las últimas 3 horas, las señales cambiaron igual en el gráfico y en el servidor (727, 4 descartadas). Al apagarlo, BTC quedó sin ajustes propios;
  - el tamaño de las flechas siguió después de recargar;
  - la flecha nueva llegó 9 s después del cierre. Antes del arreglo de las velas, más de 12 s.

  En una prueba, con la página recargada varias veces seguidas y el servidor reiniciado, Bybit rechazó algunos pedidos de velas por exceso ("Too many visits"). Por eso la primera carga del Swing usa la caché del gráfico. En una carga normal no hubo rechazos. No se probaron las imágenes del journal fuera de la pantalla con el Swing encendido.
- **Probado (parte A):** en la copia aislada, en 1m con las 11 monedas de la Watchlist y velas reales de Bybit (solo lectura). En 7 minutos anotó 19 señales, las mismas que da la regla con esas velas, entre 4.0 y 5.7 s después del cierre que las confirma. Reiniciada, no repitió nada. Con las monedas pedidas a la vez, cada vuelta tarda 1 s y anota a unos 4.7 s del cierre. El filtro VWAP se probó con velas simuladas: en la configuración de la Watchlist está apagado.

## Watchlist (paso 5, parte C)

Pedido del plan del paso 5, con el cambio del usuario (12/11): los gráficos que no se ven no se pausan, se redibujan cada 30 s. Si la app se pusiera lenta, un máximo de 10 gráficos en vivo elegidos por él. Medido: no hace falta (ver "Medido").

- **Módulo** (`web/src/WatchlistView.jsx`): botón "Watchlist" en el encabezado del gráfico y en la barra del bot, o en otra pestaña con el menú "Pestañas". Se arma la primera vez que se abre y después queda armado aunque se mire otro módulo: sus gráficos siguen recibiendo velas y precios.
- **Cuadrícula:** todas las monedas de la suite (las agregadas aquí, en el gráfico principal o en otra pestaña aparecen al instante), cada una con el `MiniChart` de App 1 en vivo:
  - marco común (1m a 4h) y días comunes, menos que el gráfico principal: 1 en 1m, 3 en 5m, 5 en 15m, 14 en 1h y 60 en 4h por omisión. Así cada moneda es un solo pedido a Bybit (dos en 1m);
  - de 1 a 5 columnas;
  - orden manual: se arrastra el nombre de una moneda; hacia abajo queda después de la otra y hacia arriba, antes. Reordenar no vuelve a cargar ningún gráfico;
  - cada celda dice precio y cambio de 24 h (los precios del WebSocket que ya usa su gráfico, uno por segundo) y "Swing en vivo" si el servidor la vigila;
  - un clic en el nombre abre la moneda en el gráfico principal, en el marco de la cuadrícula y con todos los indicadores de ese gráfico. El gráfico de la celda se arrastra y se acerca, solo para mirar (desde el 13/11; antes no respondía al mouse). Ver "Pedidos tras probar la Watchlist".
- **Indicadores:** los mismos para todas las monedas, solo livianos: Swing (del servidor), Delta de volumen, CVD, FVG, S&R v2, Perfil de volumen y Volumen de Respuesta. Por omisión, el Swing. Los pesados (Order Flow, Elementos OF, VWAP, Interés abierto y patrones) quedan en el gráfico principal: con todas las monedas a la vez pedirían demasiado a Bybit.
- **Ritmo de dibujo** (`liveRedrawMs` de `MiniChart`, App 1): a la vista, a lo sumo un dibujo por precio cada 0.5 s; fuera de la vista (más abajo en la cuadrícula o con el módulo oculto), cada 30 s. Lo que se ve lo decide un `IntersectionObserver`. Al volver a verse se dibuja en el acto.
- **Carga escalonada:** un gráfico nuevo cada 0.4 s, en el orden de la cuadrícula. Cambiar el marco o los días los arma de nuevo.
- **Swing:** cada celda pide sus señales al servidor con los días de la cuadrícula (`/api/swing/signals?...&days=`), que comparte la caché de sus velas. Las pide al cerrar cada vela, de a 4 monedas a la vez; si cambian las reglas o los dibujos de una moneda en el gráfico principal, solo esa moneda vuelve a pedir (`notifySwingChanged`). Lo que no se ve muestra las flechas nuevas en su próximo dibujo.
- **Panel del Swing** (botón "Panel del Swing"; "Ocultar ›" en su encabezado lo cierra):
  - si detecta, y el botón para encenderla o apagarla;
  - el marco que vigila, con "Vigilar en <marco de la cuadrícula>" cuando difieren;
  - las monedas vigiladas, con una casilla por moneda (queda al menos una);
  - las últimas 40 señales anotadas, con la hora de Colombia; un clic abre la moneda en el gráfico.

  Se lee cada 30 s mientras se ve el módulo. No envía alertas.
- **Ajustes:** marco, días, columnas, orden, indicadores y panel se guardan por pestaña (`suite_watchlist_<pestaña>`).
- **Bybit:** el servidor deja pasar a lo sumo 10 pedidos por segundo (`candles.bybit_turn()`: velas, Swing, interés abierto, precio y monedas nuevas), y con "Too many visits" (retCode 10006) espera y vuelve a pedir. Bybit cuenta en una ventana de 1 s; al recargar varias veces seguidas la página había rechazado pedidos.
- **Medido (13/11, copia aislada, 21 monedas en 15m con 4 columnas, 12 a la vista):**
  - un dibujo de un gráfico de la cuadrícula cuesta 0.4 ms (mediana; 0.7 ms el 90%, 1.4 ms el más lento de 105). Uno del gráfico principal con Order Flow y Delta, 2.1 ms;
  - llegaron 101 precios y 14 velas por segundo para todas las monedas, a las 2 a. m. de Colombia. Sin el ritmo, cada celda se dibujaría unas 5 veces por segundo (hasta 10 en horas movidas): unos 44 ms de cada segundo (4%), y más en horas movidas;
  - con el ritmo: 12 a la vista × 2 dibujos × 0.4 ms y 9 fuera de la vista cada 30 s, unos 10 ms de cada segundo (1%), más el manejo de los mensajes;
  - memoria de la página: 28 MB solo con el gráfico principal y 34 MB con las 21 monedas armadas;
  - ningún rechazo de Bybit al armar las 21 ni al recargar.

  No se pudo ver la fluidez en vivo: el panel del navegador de las pruebas corría en segundo plano. El costo por dibujo y la memoria sí se midieron. Con estos números el límite de 10 gráficos no hace falta.
- **Probado** en la copia aislada con velas reales de Bybit:
  - las flechas de las celdas, a la vista y fuera de ella, iguales a las del servidor con los días de la cuadrícula (en 15m y en 1m);
  - el clic abrió ETH en el gráfico principal en 15m;
  - el orden al arrastrar (también al último lugar), 2 y 4 columnas (6 y 12 a la vista) y un indicador encendido y apagado en las 21 a la vez;
  - el panel: agregar y quitar LINK de las vigiladas, "Vigilar en 15m" y volver a 1m;
  - una regla cambiada para BTC hizo volver a pedir solo a BTC.

  En Electron no se probó.
- **En desarrollo:** `window.__suiteWatchlist` tiene los gráficos, lo que se ve y el Swing de cada moneda.

## Pedidos tras probar la Watchlist (13/11)

El usuario pidió seis cosas al probar la Watchlist.

1. **Mover y acercar los gráficos de la Watchlist,** con la compresión de velas de App 1:
   - se arrastran para ver otras velas y la rueda acerca o aleja. Ctrl + rueda cambia la escala de precios y un doble clic en el eje la devuelve. →| vuelve a la última vela; los demás botones del gráfico no se muestran;
   - la cuadrícula se desplaza con su barra o con la rueda sobre los nombres;
   - son solo para mirar (`viewOnly` de `MiniChart`, en App 1): los dibujos se ven pero no se eligen, mueven ni borran, y no hay divisores de altura ni menú de niveles. Sin eso, arrastrar sobre un dibujo lo movía y lo guardaba sin que el gráfico principal se enterara, y un divisor cambiaba la altura de los paneles de la moneda, que es la del gráfico principal;
   - un dibujo que cambia en el gráfico principal o en otra pestaña llega al instante a la celda de su moneda (`onAnyDrawings` de `tabs.js`).
2. **"+ Moneda" en la Watchlist:** como el "+" del gráfico, con la moneda comprobada en Bybit por el servidor. Una moneda agregada en cualquier lado aparece al instante en la Watchlist, en el gráfico y en las otras pestañas (`symbolsChanged` de `tabs.js`, `BroadcastChannel('suite-symbols')`).
3. **Pestañas:** menú "Pestañas" en el gráfico, la Watchlist y el bot (`TabsMenu.jsx`):
   - una fila por pestaña, de la 1 a la 5, con Gráfico, Watchlist, Journal y Bot. En la pestaña actual cambia el módulo. En otra la abre con ese módulo (`/?pestana=n&modulo=...`; en Electron, otra ventana), o la trae al frente si ya está abierta;
   - la pestaña nueva toma el módulo de la dirección, lo guarda y lo quita de ella: al recargar queda en el último módulo que se usó;
   - desde otra pestaña, la 1 no se vuelve a abrir: es la ventana principal, y solo ella toma las imágenes del journal y da los avisos de Windows;
   - cada una tiene su moneda, sus marcos y su Watchlist (`suite_chart_<n>`, `suite_watchlist_<n>`, `suite_module_<n>`). Sus indicadores encendidos son los de la 1 hasta que se cambie uno en ella (ver "Indicadores de las pestañas", abajo). Los ajustes de los indicadores llevan su prefijo: la 2 el de App 1 (`app1_g2:`) y de la 3 a la 5 `suite_p<n>:`. Mientras no se cambien, leen los de la 1;
   - el encabezado dice "Pestaña n", y la Watchlist y el bot "· pestaña n". El título de la ventana empieza con "Pestaña n" (barra de tareas);
   - varias pestañas con el gráfico dan hasta 5 monedas con su gráfico completo a la vez. Cada una pide sus velas a Bybit, como el gráfico principal;
   - **en Electron cada pestaña es una ventana con su propio hilo:** abierta por la página con `window.open`, compartía el hilo de la que la abrió (medido: 1.5 s ocupados en la 2 detuvieron 1505 ms la principal). Ahora `desktop/main.cjs` la crea él (`openTabWindow`), una por número: con lo mismo, la principal se detuvo 21 ms. En el navegador (`INICIAR.bat`) siguen compartiendo el hilo.
4. **Una moneda abierta desde la Watchlist** llega al gráfico principal en el marco de la cuadrícula, con todos los indicadores del gráfico, también los pesados (Order Flow, Elementos OF, VWAP, etc.): ya no dependen del marco (punto 5).
5. **Indicadores:**
   - un solo conjunto para los cinco marcos: encender uno lo enciende en todos. `vpConfig` y el modo del interés abierto siguen por marco;
   - la lista dice para quién valen y elige "Los mismos en todas las monedas" o "Propios de cada moneda". Con los propios, el primer cambio en una moneda le copia los comunes con ese cambio, y una moneda sin los suyos usa los comunes. Volver a "Los mismos" no borra los de cada moneda;
   - se guardan en `suite_chart_<pestaña>` (`indicators`, `indicatorMode` y `coinIndicators`). Lo guardado antes, por marco, pasa al conjunto común con los del marco que estaba a la vista;
   - las imágenes del journal fuera de la pantalla usan los de su moneda.
6. **Panel del Swing:** "Ocultar ›" en su encabezado y el botón "Panel del Swing" en la barra. Oculto, la cuadrícula toma su ancho: en 1366 px pasa de 1024 a 1339. Se guarda por pestaña.

**Probado** el 13/11 en la copia aislada con velas reales de Bybit:
- zoom con la rueda y arrastre en las celdas, sin abrir el gráfico principal; de los botones solo quedó →|;
- un rectángulo dibujado en el gráfico principal de SOL llegó a su celda y a los cinco marcos. Arrastrar sobre él en la celda movió las velas: el rectángulo quedó igual y no se guardó nada. Un clic no abrió el menú de niveles;
- LTCUSDT agregada desde la Watchlist apareció en la cuadrícula con su precio y en la lista del gráfico (después se quitó);
- CVD encendido en 15m quedó en los cinco marcos. Con "Propios de cada moneda", FVG solo para ETH: BTC siguió con los comunes y ETH lo conservó al volver;
- lo guardado por marco (1h a la vista, con CVD y VWAP) pasó a los cinco marcos;
- el menú pidió las pestañas 2 a 5 con su módulo (`window.open` simulado). Abiertas con su dirección: la 3 con el gráfico, "Pestaña 3" y sus propios ajustes (`suite_p3:`); la 2 con la Watchlist; la 4 con el journal;
- SOL abierta desde la Watchlist llegó en 15m con Delta de volumen y Order Flow.

**En Electron** (13/11, con la app del usuario cerrada): la app del worktree con un perfil propio (así su candado de una sola instancia no toca el de la app real), el servidor de prueba y el bot falso, con las ventanas fuera de la pantalla y manejadas por CDP:
- el menú abrió la pestaña 2 como ventana propia, y pedirla otra vez con la Watchlist reutilizó la misma ventana; la 3 abrió en el journal;
- cinco monedas a la vez (BTC, ETH, SOL, XRP y DOGE), cada una en su ventana con 8 indicadores (Order Flow, Delta, perfil, interés abierto, VWAP, S&R v2, FVG y Swing): las cinco se dibujaban en vivo y los temporizadores de la principal se retrasaron a lo sumo 22 ms;
- memoria: 15 a 22 MB de JavaScript por ventana y 1.1 GB de la app entera (cada ventana de gráfico, unos 140-150 MB);
- "Nueva ventana" del menú abrió la 2, la 3, la 2 de nuevo tras cerrarla, la 4 y la 5, y con todas abiertas ninguna más.

**Indicadores de las pestañas** (13/11, al probarlo el usuario): una moneda abierta desde la Watchlist salía con indicadores livianos. El registro del servidor de esa sesión mostró que el gráfico de la ventana principal sí cargaba los suyos (VWAP, Elementos OF, Order Flow y Liquidaciones). ETH, en cambio, se abrió en una pestaña de la 2 a la 5 con solo Order Flow y Liquidaciones: cada pestaña tenía los suyos, y una nueva empezaba con los de fábrica.
- Ahora las pestañas 2 a 5 usan los de la pestaña 1 (`mainIndicators()` lee `suite_chart_1`) y los siguen al instante: el evento `storage` llega cuando la 1 guarda. La lista lo dice: "Los de la pestaña 1, al día".
- El primer cambio en una pestaña (un indicador o el modo por moneda) le da los suyos, a partir de los de la 1. Se guarda `indicatorsCustom: true` en `suite_chart_<n>`. Su lista dice "Propios de esta pestaña" y trae "Usar los de la pestaña 1".
- Lo guardado antes en una pestaña no tiene esa marca y pasa a seguir a la 1.

**VWAP que no se detenía** (hallado en el mismo registro): al cambiar de moneda, el VWAP de la anterior seguía pidiendo sus datos cada 30 s, en los cinco marcos, hasta cerrar la página; XRP se pidió 117 veces. `IndicatorManager.destroy()` de App 1 no detenía su temporizador, y un pedido en camino lo volvía a arrancar al llegar. Arreglado en App 1 con `dispose()` del VWAP. Medido en la copia: tras pasar de BTC a ETH, ningún pedido del VWAP de BTC en 40 s.

## Libro completo (13/11)

Pedido del usuario el 13/11, tras los informes del price ladder (`reports/Price ladder en nuestro trading.md` y `reports/Patrones del price ladder y cancelaciones.md`, en el worktree `price-ladder-orderflow`): grabar el libro completo, medir con semanas de datos qué hace la liquidez cuando el precio llega a sus zonas, y llevar medidas del libro al journal. Bybit publica el libro completo de sus perpetuos desde el 11/08/2026. Su historia no se recupera: los archivos gratis de Bybit traen 200 niveles, que en BTC alcanzan ±0.05%.

- **Grabación** (`server/book_recorder.py`):
  - WebSocket público `orderbook.full.{SIMBOLO}` (solo cambios, cada 200 ms), una conexión cada 7 monedas;
  - la foto REST `/v5/market/full_orderbook` al conectar, unida a los cambios guardados mientras llega. Se pide 3 s después de suscribirse y con algún cambio ya guardado: sale de 1.5 a 3 s atrasada, y pedida antes podía ser anterior a los cambios. El 13/11, al abrir la suite, BTC tardó así 2.5 minutos en quedar lista; con la espera, las 20 monedas quedaron listas al primer intento, en 4 a 21 s. Un rechazo queda en el registro (`[BOOK]`) y en `/api/book/status` (`last_sync_note`, `sync_attempts`, `last_sync_seconds`);
  - los cambios se aplican con `u` de a 1; si `u` salta, otra foto, y ese minuto queda incompleto (`gap`). También hay otra foto si el precio se aleja 10% de la última, y una al día por moneda, escalonadas;
  - en memoria, solo los niveles a ±20% del precio;
  - el tick de cada moneda sale de `instruments-info` (un pedido); sin respuesta se deduce de la foto;
  - las monedas son las de la suite, y una nueva empieza a grabarse al agregarla;
  - un solo proceso por carpeta (`live/book/recorder.lock`). `SUITE_BOOK=0` lo apaga; sin esa variable vale `SUITE_RECORD`, que las pruebas ponen en 0. Solo lee: a Bybit no se le envía nada más que las suscripciones y las fotos;
  - una moneda que Bybit no da como "Trading" en `instruments-info` (TONUSDT, cerrada) no se graba ni se reintenta: su foto llega vacía. `/api/book/status` la muestra con `closed`.
- **Hora de Bybit:** cada segundo y cada minuto se toman con la hora de los mensajes (`ts`), no con la del PC (el 13/11 iba unos 2 s atrasada). Las monedas sin cambios se toman con un reloj de respaldo: la hora del PC más la diferencia medida, con 1.5 s de atraso.
- **Archivos** (`server/book_store.py`), en `OrderFlowData/live/book/{SIMBOLO}/{AAAA}/`, uno por moneda, día UTC y tipo:
  - `{SIMBOLO}_{día}.bks`: cada segundo, lo que había en cubos finos, de ~0.01% del precio (BTC 5 USD, ETH 0.2, SOL y XRP un tick), hasta ±0.8%, con la mejor compra y venta;
  - `{SIMBOLO}_{día}.bkm`: cada minuto, la profundidad ponderada por tiempo y la mínima del minuto, en cubos gruesos de ~0.03% (BTC 20 USD, como el step del footprint de 15m), hasta ±5%;
  - cantidades en la moneda, no en USD;
  - bloques de un minuto con zlib. Las filas de cada segundo van con XOR contra la anterior: sin pérdida, y lo que no cambia casi no ocupa. Un bloque cortado al final se ignora al leer.
- **Peso medido** (13/11, 12 minutos de las 20 monedas de fábrica, a las 14 h de Colombia): las 20 monedas, unos 200 MB por día y 6 GB por mes. Las que más ocupan: BTC unos 20 MB por día, ETH 19, XRP 18.5, ARB 13, SOL 12 y DOGE 10. Las que menos, de 3 a 7 MB. En horas movidas ocupará más.
- **Rutas:** `GET /api/book/status` (por moneda: lista, `u`, cubos, mensajes, huecos y resincronizaciones; bytes de hoy) y `GET /api/book/depth/{símbolo}?band=0.005` (lo que hay ahora en cubos finos, para un ladder). `/api/suite/status` trae `book`.
- **Nube** (13/11, pedido del usuario: la grabación corre solo con la suite abierta, y no la puede tener abierta todas esas semanas):
  - el collector de Northflank graba el libro completo todo el día, con copias exactas de `book_recorder.py` y `book_store.py`. Ver `5.Order_flow/cloud_collector/DEPLOY_NORTHFLANK.md`, "Libro completo de Bybit";
  - `server/book_cloud.py`, 90 s después de arrancar y luego cada 10 minutos, lista `/api/book/days` de la nube. De cada moneda de la suite y cada día baja solo los minutos que el PC no tiene completos, a `OrderFlowData/live/book_cloud`;
  - cada pedido trae 60 minutos, primero los segundos y después los minutos, hasta 40 MB por vuelta. Lo que no alcanza queda para la siguiente, que sigue a los 5 s. La nube entrega de 15 a 40 KB/s: un día completo de las 20 monedas tarda de 1.5 a 4 horas;
  - nunca toca lo grabado en el PC. Los lectores (`book_store.sources`) juntan las dos carpetas: de cada minuto, el bloque con más cobertura. Las medidas del journal y `book_study.py` leen las dos;
  - la nube guarda 3 días (`BOOK_KEEP_DAYS`): con el PC apagado más tiempo, lo más viejo se pierde;
  - `SUITE_CLOUD_URL` cambia la dirección (la de `sync_nube.py` por omisión). `SUITE_BOOK_CLOUD=0` lo apaga; sin esa variable sigue a `SUITE_BOOK` y luego a `SUITE_RECORD`;
  - `GET /api/book/cloud`: última vuelta, minutos y bytes bajados, lo pendiente y el último error. `/api/suite/status` trae `book_cloud`.
- **Journal** (`server/book_measures.py`): las medidas del libro de cada trade real van con las 58 de App 1, en el grupo "Libro". Se ven en el detalle y entran al informe de ganadoras contra perdedoras:
  - liquidez a ±0.5% en los 5 minutos antes de decidir, y su percentil contra las 24 horas anteriores;
  - desequilibrio a ±0.5% a favor del trade;
  - liquidez en espera en tu entrada (±0.05%), contra lo típico a esa distancia, y su persistencia en 15 minutos (mínimo ÷ promedio);
  - cambio en 10 minutos de la liquidez entre tu entrada y tu stop;
  - al llenarse: lo retirado de tu entrada en los 30 s anteriores, y lo negociado ahí en ese minuto (footprints de 1 minuto, `live=True`) ÷ lo que había.
  
  Un trade anterior a la grabación queda con "—" en estas medidas.
- **Medición de semanas** (`server/book_study.py`): lo que la medición del 13/11 hizo con 15 minutos, para semanas de libro grabado:
  - tus zonas: POC, VAH y VAL del perfil del día anterior (almacén de trades), FVG de 15m y 1h, y los niveles elegidos en el journal;
  - zonas al azar: por cada una, tres del mismo ancho corridas entre 0.3% y 1.5%, en las mismas horas;
  - una visita empieza cuando el precio estuvo a 1/4 de ATR de 15m o más y llega a la zona. Aguanta si vuelve a alejarse 1/2 ATR antes de pasarla por 1/4 ATR; si no, la cruza. El ATR sale de los minutos del almacén de trades, así no depende de cuánto libro hay grabado;
  - en cada visita mide lo que había al acercarse y al llegar, lo negociado ahí contra ese lado (trades exactos) y si el precio la pasó (una limit ahí se habría llenado);
  - da el aguante de tus zonas y del azar, la diferencia con su IC 95%, el "llena y aguanta" y las cargadas contra el resto. Con menos de 30 visitas resueltas avisa muestra pequeña.
  
  Uso: `C:\Python314\python.exe -B server\book_study.py BTCUSDT,ETHUSDT 2026-11-14 2026-12-14 [salida.json]`.
- **Pruebas:** `tests/book_checks.py` (60) y `tests/book_cloud_checks.py` (16), sin conexión:
  - cubos y mejor precio exactos tras miles de cambios al azar;
  - una moneda cerrada en Bybit queda fuera;
  - la nube (el `main.py` del collector, corrido en el mismo proceso) lista sus días y entrega solo los minutos pedidos. La suite baja solo lo que le falta, no repite al volver a pasar y respeta el tope por vuelta;
  - PC y nube juntos dan un bloque por minuto, el de más cobertura, y las copias de la nube son iguales a las de la suite;
  - salto de `u` y foto que empalma o no;
  - cada segundo y cada minuto (ponderado y mínimo) iguales a recalcularlos desde cero;
  - escritura y lectura con un bloque cortado;
  - las medidas del journal con libros armados a mano;
  - las visitas del estudio con un camino del precio armado a mano.
- **Probado en vivo** (13/11, 12 minutos), en una carpeta temporal, con las 20 monedas de fábrica y Bybit real (solo lectura):
  - las 20 quedaron listas, sin huecos ni reconexiones, con 11 minutos completos cada una; tres conexiones y ningún error de escritura;
  - al final, el libro de BTC y el de ETH coincidieron con una foto nueva de Bybit más sus cambios siguientes, en el mismo `u`: 16,413 y 7,943 niveles a ±5%, sin una diferencia;
  - CPU: 4% de un núcleo para las 20;
  - `book_study.py` recorrió esos minutos en 0.3 s, con las zonas del almacén y los trades reales. Dio una sola visita: hacen falta semanas.

  No se probó dentro de la suite ni en Electron, ni con una caída de la conexión real (sí con las pruebas sin conexión).
- **Falta:**
  - el mapa de liquidez en App 1 y el ladder junto al panel de trading;
  - las monedas que se quitan de la suite siguen grabándose hasta reiniciar.

## Escritorio (Electron)

Pedido del usuario (12/11): que la app no se congele por inactividad (el navegador frena las pestañas en segundo plano) y no pierda datos ni alertas. La página es la misma que sirve el servidor; Electron solo la muestra sin ese freno.

- **Arranque:** `INICIAR_DESKTOP.bat` (instala Electron en `desktop/` la primera vez y lo abre). También `cd desktop` y `npm start`.
- **Archivos:** `desktop/package.json` (Electron 33, como Apps 9 y 10), `desktop/main.cjs` y `desktop/icon.ico`. `desktop/node_modules/` no va a git.
- **Ícono (12/11):** el usuario eligió el perfil de volumen azul y oro con fondo blanco ("P1": barras azules fuera del área de valor, doradas dentro y la línea del POC). Antes, ese mismo día, había elegido el monograma "A" verde, que queda como diseño `a`. `desktop/make_icon.py` lo dibuja con Pillow y escribe `desktop/icon.ico` (16 a 256 px), `desktop/icon.png` y `web/public/icon.svg` (ícono de la página). En 16 a 24 px usa barras más gruesas y el borde más marcado. `python -B make_icon.py a` vuelve al monograma. `app.setAppUserModelId('Altagracia.TradingSuite')` hace que la barra de tareas y los avisos muestren la app con su ícono y no como Electron. Si cambian `web/index.html` o `web/public`, la app también vuelve a armar la página.
- **Al abrir:**
  1. Si el código de la página (de la suite o de App 1, o `web/package.json`) es más nuevo que `web/dist/index.html`, la vuelve a armar (si falla, sigue la anterior). Antes, si `web/package.json` es más nuevo que lo que instaló npm (`node_modules/.package-lock.json`), corre `npm install` (13/11: los paquetes del dashboard). Si falta la página, corre `npm install` (si falta `web/node_modules`) y `npm run build` en `web/`, con la salida en la ventana de carga.
  2. Pide `/api/suite/status`. Si responde, usa ese servidor y no lo toca. Si no, lo lanza sin ventana (`python -B server\main.py`, cwd en la suite) y espera hasta 120 s. Si se cierra al arrancar o no responde, la ventana de carga lo dice.
  3. Abre la ventana principal en `http://127.0.0.1:<puerto>/`. Si el servidor que ya corría no sirve la página (arrancó antes de armarla), avisa que hay que cerrarlo.
- **Configuración:** puerto `SUITE_PORT` > `port` de `config/suite.json` (o `SUITE_CONFIG`) > 13000. Python `SUITE_PYTHON` > `python` de `config/suite.json` > `C:\Python314\python.exe`. Las variables `SUITE_*` pasan tal cual al servidor que lanza.
- **Sin freno:** `backgroundThrottling: false` en todas las ventanas, los switches `disable-renderer-backgrounding`, `disable-background-timer-throttling` y `disable-backgrounding-occluded-windows`, y `powerSaveBlocker.start('prevent-app-suspension')`.
- **Ventanas extra:** un `window.open` del mismo origen, o en blanco (las ventanas que App 1 llena con un portal), abre otra ventana Electron con las mismas preferencias, que comparte el hilo de la página que la abrió. Las pestañas 2 a 5 (`?pestana=n`, menú "Pestañas") no: desde el 13/11 la app crea su ventana propia, una por número y con su propio hilo (`openTabWindow`), y pedirla otra vez la trae al frente con el módulo pedido. Una URL externa va al navegador del sistema y no abre ventana; tampoco se navega fuera del origen.
- **Bandeja:** "Mostrar", "Nueva ventana" y "Salir". "Nueva ventana" abre la primera pestaña libre, de la 2 a la 5 (desde el 13/11; antes abría otra pestaña 1, que repetía las imágenes del journal y los avisos). Cerrar la ventana principal la oculta en la bandeja y la página sigue trabajando; si la página la cierra con `window.close()`, se vuelve a abrir oculta. Solo "Salir" cierra de verdad.
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
C:\Python314\python.exe -B tests\journal_checks.py
C:\Python314\python.exe -B tests\swing_checks.py
C:\Python314\python.exe -B tests\book_checks.py
C:\Python314\python.exe -B tests\book_cloud_checks.py
```

`swing_checks.py` necesita node: corre el indicador Swing de App 1 para compararlo con el servidor.

Los cálculos del dashboard del journal: `cd web` y `node tests/journalStats.test.mjs` (9). Lo elegido en la imagen de apertura: `node tests/openDecision.test.mjs` (5).

`journal_checks.py` pone `SUITE_ORDERFLOW_DATA` en una carpeta temporal y reemplaza el pedido de OI a Bybit por uno falso: la lectura de la regla y las medidas nunca leen el almacén real ni salen a la red.

Para probar la página en el navegador con una copia del servidor, mejor el armado (`npx vite build` en `web/` y abrir el servidor de prueba): el Vite 8 que toma `npx vite` desde la raíz del repositorio no carga `react-gauge-chart` en desarrollo ("Calling require for prop-types"). El de la suite (`web/node_modules`, 5.4) arma bien.

Las pruebas ponen `SUITE_RECORD=0`, `SUITE_OFFICIAL=0` y `SUITE_SWING=0`: nunca escriben en el `OrderFlowData` real ni consultan Bybit desde el Swing.

En App 1, `node tests/swing.test.mjs` prueba las señales que llegan de afuera y `node tests/rectangle.test.mjs` que un rectángulo cambiado de tamaño se guarde. Una copia de prueba del servidor debe usar `SUITE_ORDERFLOW_DATA` y `SUITE_DATA_DIR` temporales.

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
