# CLAUDE.md - Altagracia Trading Suite

Guía para Claude Code en esta carpeta. Comunicarse siempre en español con el usuario.

## Qué es

El conjunto nuevo que pidió el usuario el 10/11/2026: **dos apps**. Una es el Backtester (App 1), tal como está. La otra es esta: una sola app en tiempo real que va a unir watchlist, order flow, bot y journal, con el formato visual y el gráfico de App 1. Arrancó el 12/11/2026 con los pasos 1 y 3 del plan local.

**Estado (12/11/2026):**
- **Paso 1:** cáscara con los estilos de App 1, el bot como primer módulo y el gráfico de App 1 como pieza compartida.
- **Paso 2:** almacén de order flow en vivo con la finura de App 1: oficial + nube + PC.
- **Paso 3:** el gráfico en vivo con ese almacén.
- **Falta:** el paso 4 (journal = Observador con trades reales, y el bot endurecido), el paso 5 (watchlist) y al final la mudanza a un servidor 24/7 con acceso protegido y celular.

## Reglas de diseño (fijadas con el usuario)

1. **Construir como si ya fuera el servidor:** nada que decida u opere vive en la ventana. Los ajustes van en el backend, las rutas y puertos en la configuración (`config/suite.json`, variables `SUITE_*`), y cada proceso arranca sin ventana.
2. **No copiar App 1:** el gráfico (`MiniChart`), los indicadores, los modales y los estilos se importan desde `1.Altagracia_Crypto_Backtester/Backtester/frontend/src` (alias `@app1`). Lo mismo los lectores del backend (`footprint_store.py`, `liq_store.py`). Lo nuevo del gráfico se hace en App 1.
3. **Requisitos del usuario** (memoria `unified-app-vision`): los indicadores de App 1 son los que van (el de Liquidaciones de App 1, no el del Analizador); footprints en todos los marcos como en App 1; herramientas de dibujo, nitidez y estilos de App 1; el journal será el Observador; Northflank sigue en el diseño; lo exclusivo de App 8 se deja atrás; las alertas de proximidad se harán al final, por confluencia de indicadores.
4. **El bot sigue siendo su propio proceso** (`3.TradingBot_Python`, puerto 5000). La suite lo lee y lo maneja por su API, del lado del servidor: el bot no acepta páginas de otros puertos, y así no hace falta abrirlo.

## Estructura

```
12.AltagraciaTradingSuite/
├── INICIAR.bat            Arma la página la primera vez, levanta el servidor y abre http://127.0.0.1:13000
├── config/suite.example.json   Copiar a suite.json para cambiar puertos o carpetas (suite.json no va a git)
├── server/
│   ├── main.py            FastAPI, 127.0.0.1:13000
│   ├── settings.py        Fábrica < config/suite.json < variables SUITE_*
│   └── tests/run_checks.py    16 pruebas sin conexión
└── web/                   React + Vite (desarrollo en 13001, con proxy de /api al 13000)
    ├── vite.config.js     Plugin app1Shared: el config.js de App 1 pasa a src/app1Config.js y los paquetes se resuelven aquí
    └── src/
        ├── SuiteApp.jsx   Barra, módulos (Gráfico, Bot), modal "Estilo" de App 1 y barra de estado
        ├── ChartView.jsx  MiniChart de App 1 en modo en vivo, moneda, marco, indicadores y sus ⚙️
        └── BotView.jsx    Estado, pausa, avisos críticos, posiciones, órdenes y alertas del bot
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
| `GET /api/bot/positions` | Posiciones abiertas (el bot las pide a Bybit: la página las lee cada 15 s) |
| `GET /api/bot/alerts?minutes` | Alertas recibidas por el bot |
| `POST /api/bot/pause` | Pausa o reanuda todo el trading. Exige `{"paused": bool, "confirm": "CAMBIAR_PAUSA"}` |
| `GET /api/suite/status` | Último día oficial, días en vivo, grabación del 11000 y estado del bot |

- **Protección:** escucha en 127.0.0.1. Rechaza un Host o un Origin que no sean `localhost` o `127.0.0.1` (403), como el bot.
- **No existen** las rutas de alertas de App 1 (`/api/pattern-alert`, `/api/proximity-alerts/batch`): el gráfico nunca envía nada al bot desde aquí.
- Si existe `web/dist`, el servidor sirve la página en `/`: una sola dirección.

## Gráfico en vivo

- `MiniChart` con `backtestingMode={false}`: velas de `/api/historical` y el WebSocket de Bybit del navegador (`WebSocketManager.js` de App 1).
- **Footprints:** llegan hasta el último minuto armado del almacén. El backend 11000 lo arma cada minuto, así que van cerca de 1 minuto atrás. La vela en curso no tiene footprint completo.
- **Indicadores ofrecidos:** Volume Delta, Volume Profile, CVD, Order Flow, FVG, VP Periodic, Volumen de Respuesta, Liquidaciones y S&R v2.
- **Fuera por ahora:** Interés abierto, Confluencia OI, VWAP, S&R clásico, Elementos OF y los patrones. Piden rutas que el servidor aún no tiene (`/api/open-interest`, `/api/vwap`, `/api/support-resistance`, `/api/orderflow/elements` con `live/flow`).
- **Cambio en App 1 (12/11):** la escala de precios del modo en vivo seguía todas las velas cargadas, y con 30 días de BTC las velas quedaban aplastadas. Ahora sigue las velas a la vista, como en reproducción. App 1 no usa el modo en vivo, así que su reproducción no cambia.
- **Ajustes:** cada indicador guarda sus ajustes en el `localStorage` de esta página (puerto distinto al de App 1), con las mismas claves de App 1.
- En desarrollo, `window.__suiteChart` da acceso al gráfico desde la consola.

## Módulo del bot

- Tarjetas: modo (LIVE, TESTNET o DEMO), pausa, credenciales, monedas, órdenes en el historial y ejecuciones desde que arrancó, con los SL y TP fallidos.
- Listas: avisos críticos, posiciones (en rojo las que no tienen SL), últimas 30 órdenes y alertas de 4 horas.
- La pausa pide confirmación en la página y la palabra en el servidor. Lo demás (órdenes manuales, configuración, orígenes) sigue en App 10 por ahora.

## Pruebas

```bash
cd server
C:\Python314\python.exe -B tests\run_checks.py
```

Probado el 12/11 en una copia aislada:
- servidor en 13100 con una copia de los datos de la nube y del PC, frontend en 13101 y un bot falso en 59998;
- gráfico con velas en vivo y los footprints de App 1 sobre las velas grabadas;
- los 9 indicadores encendidos, sin errores;
- pausa confirmada: una sola llamada al bot falso;
- página armada servida por el propio servidor.

No se probó contra el bot real ni dentro de Electron.
