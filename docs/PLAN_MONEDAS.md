# Plan: un solo registro de monedas en la suite (23/11/2026)

**Pedido:** el usuario fijó en la Watchlist una moneda del scanner (RUNE) y preguntó qué hacía falta para que se bajara
de ella lo mismo que de las monedas guardadas. Después pidió centralizar la lista: que cada moneda que se quiera seguir
se incluya desde un menú de la suite (App 12), y escoger ahí lo que se guarda en Northflank, el almacén de trades y lo
demás.

## Hoy cada parte tiene su lista

| Lista | Dónde vive | Monedas el 23/11 | Cómo se cambia |
|---|---|---|---|
| La suite: Watchlist, gráfico, «Mis monedas» del scanner, sabios y SMC | `data/symbols.json` | 23 | «+ Moneda», el «+» del gráfico y «Agregar a la suite» del scanner |
| Grabación en el PC: trades, libro y Hyperliquid | las mismas de la suite | 23 | no se elige: se graban todas |
| Almacén: la historia de trades de Bybit | `OrderFlowData/store` | 12, y RUNE bajando | el panel de Order Flow |
| La nube (Northflank) | variable `SYMBOLS` del collector | 21: sin RUNE, MUBARAK ni ALGO, y con TON, que Bybit cerró | a mano en Northflank |
| App 1, probador | `backtesting_cache` y `OrderFlowData/candles` | 7 de siempre y 43 nuevas | scripts |
| Swing del servidor | `data/swing/config.json` | 12 | su panel en la Watchlist |
| DX en vivo | fija en `dx_watch.py` | 7 | no se cambia: es la regla que se está juzgando |
| Bot | `trading_config.json` del bot | 21 | Bot > Configuración y riesgo |

Lo que pasó con RUNE:
- al agregarla a la suite empezó a grabarse en el PC (libro, cinta y Hyperliquid), pero no tenía almacén y la nube no
  la graba;
- su historia se empezó a bajar desde el panel el 23/11 a las 15:53: 1,820 días, unas 4 horas;
- al terminar, el almacén solo se arma si el panel sigue abierto: lo arma el panel cuando ve que la descarga terminó.

## La idea

Un módulo «Monedas» en la suite, con una fila por moneda y lo que se guarda de ella:
- si está en la suite;
- grabar en el PC: los trades, el libro y Hyperliquid, cada uno aparte;
- su almacén: bajar la historia, ver cómo avanza y mantenerla al día;
- el Swing;
- como información: la nube, App 1, DX y el bot;
- lo que ocupa cada moneda en el disco y cuánto crece por día.

Un registro, `data/coins.json`, guarda lo elegido. Una moneda sin entrada sigue como hoy: se graba todo, y su almacén
se pone al día si ya tiene historia. El primer día no cambia nada.

## Decisiones (23/11)

- **Quitar nunca borra.** Quitar una moneda de la suite o apagar una grabación deja todo lo guardado. Borrar sigue
  siendo a mano.
- **Al agregar** una moneda desde el módulo: trades, libro y Hyperliquid en el PC, y su historia desde que cotiza en
  Bybit. La nube y App 1 quedan apagadas.
- **La nube, por una ruta con clave** (fase 2): el collector cambiaría sus monedas sin entrar a Northflank.
- **App 1, en un grupo aparte** (fase 3), «agregadas». Las 43 nuevas sirven de datos frescos porque ninguna regla se
  eligió con ellas. Sumarles las monedas que elige el scanner las contaminaría.

## Fase 1: el registro y el módulo, para el PC

**Hecha el 23/11**, con 94 pruebas del servidor (`coins_checks.py`) y 9 de la página (`coins.test.mjs`), y probada en
dos copias aisladas. Lo que hace y cómo se probó: `12.AltagraciaTradingSuite/CLAUDE.md`, «Monedas (23/11)».

**Servidor:**
1. `server/coins.py`: el registro y lo que el módulo muestra de cada moneda.
   - Las monedas que salen son las de la suite y las que tienen algo guardado o están en otra lista: el almacén, la
     nube, el Swing, DX y el bot.
   - Rutas: `GET /api/coins`, `POST /api/coins` (agregar con lo elegido) y `POST /api/coins/{moneda}` (cambiar una
     grabación o el almacén).
2. `server/coin_history.py`: la historia del almacén, con las herramientas del panel sin cambiarlas.
   - `tools/ingest.py MONEDA` baja los días. Se lanza aparte: sigue aunque se cierre la suite, como desde el panel.
   - Una descarga a la vez, como en el panel. Si baja otra (del panel, de su cola o de la suite), la pedida espera.
   - El avance sale de `status_MONEDA.json`, que `ingest.py` escribe tras cada día.
   - Al terminar una descarga, de quien sea, `tools/build_store.py MONEDA` arma el almacén si le faltan días.
     `build_store.py` no tiene candado: la suite no lo corre si otro está escribiendo en `store/` o `flow/` de esa
     moneda, ni mientras `official.py` la pone al día.
   - «Detener» hace lo mismo que el del panel (`control.json`): la descarga termina el día en curso y se cierra.
   - Rutas: `POST /api/coins/{moneda}/history` (pedirla), `DELETE` (sacarla de la espera) y
     `POST /api/coins/history/stop`.
3. `main.py`:
   - cada grabador arranca con las monedas que tienen encendida su grabación;
   - «Agregar a la suite», desde donde sea, enciende solo lo elegido para esa moneda;
   - `official.py` pone al día el almacén de las monedas que lo tienen encendido.

**Lo que vale al instante y lo que no:**
- encender una grabación vale al instante, como agregar una moneda hoy;
- apagarla vale al reiniciar la suite. Los grabadores del libro y de Hyperliquid son copias exactas de los del collector
  de la nube, y sacar una moneda en caliente sin dejar huecos mal anotados obligaría a cambiarlos en los dos lados;
- quitar una moneda de la suite, igual que hoy: se deja de grabar al reiniciar.

**Página:** el módulo «Monedas», en el menú «Pestañas» de cada módulo. Un botón en la barra de la Watchlist la partía
en dos líneas a 1366 px: no se puso.
- Una fila por moneda con sus casillas, el estado de su almacén, lo que ocupa y lo que crece por día.
- Arriba, la descarga en curso y las que esperan.
- «Agregar a la suite» del scanner abre el módulo con esa moneda, para elegir qué se guarda antes de agregarla.
- «+ Moneda» y el «+» del gráfico siguen como hoy: agregan con las tres grabaciones y sin bajar la historia.

## Fase 2: la nube

- El collector suma una ruta para cambiar sus monedas, con una clave que se guarda en `config/suite.json`. Sin la ruta,
  cambiar la variable en Northflank reinicia el servicio y deja un hueco en la grabación de todas sus monedas.
- Su límite es la memoria: 512 MB, con 181 MB en uso el 22/11. Cada moneda suma su libro y su cinta del día.
- La casilla «Nube» del módulo deja de ser solo información.

## Fase 3: App 1

- `candles_update.py` baja las velas de una moneda agregada a una carpeta aparte, el grupo «agregadas».
- El probador la lee como otro grupo, sin tocar los de siempre ni las nuevas.
- Lo que se haga con ese grupo sirve de exploración: se juzga después con datos frescos, como las demás.

## Lo que no hace

- No borra nada.
- No cambia las herramientas del almacén (`OrderFlowData/tools`) ni la cola del panel (`queue.txt`).
- No toca la grabación de la nube ni App 1 (fases 2 y 3).
- DX sigue con sus 7 monedas, el bot con su configuración y los sabios y SMC con las monedas de la suite.
