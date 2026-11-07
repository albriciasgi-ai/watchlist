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

---

