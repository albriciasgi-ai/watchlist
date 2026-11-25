# Registro de ejecución del protocolo de pruebas

Protocolo: `PROTOCOLO_PRUEBAS_BACKTESTING_GLOBAL.md`. Defectos: `DEFECTOS.md`. Evidencia pesada: `C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\`.

## Decisiones del usuario (21/11/2026)

1. Copia aislada (backend 9300, página 9301, copia del registro en `OrderFlowData\research\pruebas_backtesting\2026-11-21\observer_aislado`).
2. **Primero el informe completo y después las correcciones**: durante la ejecución no se cambia código de la app; los defectos se anotan.
3. **Captura de cada trade** de cada simulación que se pruebe (no una muestra).
4. Todo, en el orden del protocolo.
5. Las decisiones de diseño (H1, H2, H3, H6) se miden y se deciden con el usuario antes de cambiar nada.

## Entorno

| Pieza | Valor |
|---|---|
| Código | worktree `backtesting-test-protocol-745f1b`, rama `claude/backtesting-test-protocol-745f1b`, base `main` 507fe341 (motor 4) |
| Backend aislado | 9300, `scratchpad\iso\run_backend.py` (Python del `.venv` de la copia principal, `-X utf8`), `ORDERFLOW_OBSERVER` = copia, `TESTER_AUTO_UPDATE=0` |
| Página aislada | 9301, `frontend\vite.iso.config.mjs` (temporal), `config.js` → `""` y proxy de `/api` al 9300; `node_modules` es un enlace (junction) a la copia principal |
| Copia del registro | 1,861 corridas, `runs/`, `cache/`, `search/` y `measures/` (236 MB), copiadas el 21/11 a las 15:5x |
| App del usuario | 9000 y 9001, sin cambios |

**Al terminar hay que:** apagar los dos servidores de prueba; quitar el enlace `frontend\node_modules` con `cmd /c rmdir` (nunca borrar a través de él); borrar `frontend\vite.iso.config.mjs` y `.claude\launch.json` del worktree; devolver `backend\backtesting_cache` del worktree con `git checkout` de cada archivo por nombre; borrar `observer_aislado` por su nombre exacto.

## Avance por etapa

| Etapa | Estado | Notas |
|---|---|---|
| 0 · Entorno y pruebas existentes | hecha | 520 pasan y fallan las 2 de siempre; en la página solo `liquidations.test.mjs` |
| 1 · Datos contra Bybit | hecha | `etapa1_datos.py`: F-02, F-03 y O-09 (abajo) |
| 2 · Oráculo y su segunda versión | hecha | B pasa sus 64 casos; A, 53 (las 11 restantes explicadas); 51 corridas y 324,399 llamadas comparadas, todas las diferencias explicadas. Lote 6 terminado: R02 (BTC 15m, 4,610 trades, 10,611 llamadas) sin ninguna diferencia con A ni con B; en R13a, R13b, R13e y R14c de ARB (29, 268, 27 y 7) la misma señal descartada con otro texto del motivo (O-08) |
| 3 · Motor | hecha; **F-04 (S1) corregido** a pedido del usuario (motor 5) | capa A de R01 a R15; capa C de R01 a R15 (y R13e) y R03 en DOGE: 3,029 trades con captura, todos bien; invariantes y metamórficas en 50 reglas y 3 monedas. R02 en BTC 15m: 4,610 de 4,610 bien |
| 4 · Prioridad 1, controles e informes | hecha (22/11) | 29 corridas de prueba en BTC f1 (12 filtros, 16 elementos y el rombo): capa A sin diferencias (salvo O-05), capa B igual en todas, capa C con captura de los 9,778 trades, ningún trade mal. Oráculos de elementos, filtros, piezas B y C y order flow; controles, informes y metamórficas. Hallados F-07, F-08, F-09, H19, O-12 a O-17 y E-06 a E-11 |
| 5 · Corridas reales del usuario | hecha (22/11) | Las 1,388 repetidas desde cero: todas explicadas, ninguna diferencia del motor sin causa (datos nuevos de SUI y SNX, fase 3 que crece, motor 3). 25 corridas de BTC con capas A, B y C: 5,987 trades, ninguno mal. Tus 18 veredictos se repiten con el azar de la app; con el azar que guarda los lados y respeta la línea, cambia uno (ruptura de caja, fase 1 de las de siempre). Hallados F-10, H20, H21, E-12, O-18 y O-19 |
| 6 · Prioridad 2, confusiones, pasos y sesgos | hecha (22/11) | 85 corridas (76 reglas de la etapa, R35 y R34): 31,556 trades capturados uno a uno, capa B sin diferencias y 43 informes de revisores aparte sin ningún trade mal; 100 pasos y 43 confusiones en pantalla; sesgos B-01 a B-09 medidos. Ver "Etapa 6" abajo |
| 7 · Informe final, correcciones y regresión | hecha (22/11) | Informe: `INFORME_FINAL.md`. "Acepta todas": motor 6 (F-16, F-02, F-03, F-07 a F-09, H1, H2, H4, H15, H16, H18, H19, H22, B-05 a B-08 y el lote menor). Regresión: 579 pruebas del backend (las 2 de siempre fallan), invariantes en 296 casos y capa A de cinco reglas, todo bien; de tus 18 veredictos pasan 2 (B5 f1 y f2 de las de siempre), por H1 y B-08; tus 28 corridas con liquidaciones, ninguna pasa. Fuera del plan: la suite y la Revisión, corregidas. E-02 y E-08, por elegir |

## Detalle

### Etapa 0

- 21/11 ~18:55 (hora de Colombia): copia aislada en pie. `GET /api/tester/info/BTCUSDT` del 9300 responde con las fases (f1 25/04/2020–31/12/2023, f2 01/01/2024–30/06/2025, f3 01/07/2025–20/11/2026). El 9000 del usuario sigue respondiendo igual.
- Pruebas del backend (`pytest tests`, con `ORDERFLOW_OBSERVER` en una carpeta vacía): **520 pasan y fallan 2**, las de siempre: `test_endpoints::test_status_has_version` y `test_lru_cache::test_clear`. Registro: `evidencia/etapa0/pytest_backend.txt`.
- Pruebas de la página (`node tests/*.test.mjs`): **todas pasan salvo `liquidations.test.mjs`** (falla desde el 13/11; tardó 134 s). Registro: `evidencia/etapa0/node_tests.txt`.
- La página aislada abre la ventana `?probador=1` y pide las velas al 9300.
- Hallado de paso: el caché de velas de App 1 en git (`backtesting_cache`) termina el **23/10/2026** en SUI y TRX (`cached_at` de ese día). Esas dos monedas corren sobre él: su fase 3 termina un mes antes que la de BTC. Se mide en la etapa 1.

### Etapa 1 · Datos contra la API pública de Bybit (terminada el 21/11 ~23:00)

`etapa1_datos.py`, evidencia en `evidencia/etapa1/` (`spans.json`, `cache.json`, `agregadas.json`, `nuevas.json`,
`oi.json`, `funding.json`, `log.txt`).

- **Velas del motor en las monedas con almacén** (armadas con los trades): en las fases 2 y 3, iguales a las oficiales
  (cierre y volumen sin diferencias). En la fase 1, el volumen difiere en el 2–7% de las velas de BTC, ETH y SOL con la
  suma igual (99.98%), y las aperturas por un tick en la mitad de las velas (H11). **O-09.** Faltan velas sueltas: el
  06/04/2022 08:xx en 15m (BTC, ETH, GALA, SOL) y 71 velas de 5m de BTC en abril de 2020.
- **Caché de App 1** (SUI, TRX y las de siempre): igual a Bybit salvo la última vela guardada, a medio formar
  (**F-03**).
- **Monedas nuevas** (43, 774 ventanas): **F-02** (falta una vela cada 1,000 en 1h, 4h, 15m y 5m, y páginas enteras en
  ALGO, AR, AXS, RUNE, SHIB1000 y ATOM) y **F-03** (velas a medio formar en cada actualización).
- **Agregadas:** 30m (dos de 15m) hereda F-02 (DOGE, LINK); 1D de las de siempre (seis de 4h por día UTC y el almacén
  antes): volumen distinto en el 2–4% de los días.
- **OI** (4 h y 5 min) y **funding**: iguales a Bybit en todas las monedas revisadas.

### Etapa 2 · El oráculo y su segunda versión

- **Oráculo A** (`tests/audit/oraculo.py`): el ciclo del trade escrito desde `ESPECIFICACION_CICLO_TRADE.md`, sin
  importar ni copiar `simulate`, con su propio ATR y su propio lector de los minutos del almacén. Trae las variantes
  con que se miden las decisiones de diseño (H4, H5, objetivo en la vela del llenado y H12).
- **Oráculo B** (`oraculo_b.py`): lo escribió un agente aparte solo con la especificación, sin ver el motor ni el
  oráculo A. Sus **64 casos de respuesta conocida** (`test_oraculo_b_casos.py`, con el resultado calculado a mano en
  cada comentario) pasan los 64.
- **Los mismos 64 casos con el oráculo A** (`test_oraculo_a_casos.py`, un adaptador a la interfaz de B que no cambia
  ninguno de los dos): **53 pasan**. Las 11 que no, una por una:
  - 3 por la hora de una salida resuelta sin minutos, con 1 a 3 ms de más (O-03);
  - 3 por la vela de la salida y la duración en las salidas en la apertura siguiente: señal contraria, canal y VPA
    (E-04);
  - 1 por el desempate de las dos órdenes sin minutos: la especificación decía la cercanía y el motor (como dice su
    documentación) sigue el recorrido supuesto. Es un error de la especificación (E-05);
  - 4 por cómo informa el oráculo A, no por un trade: no da lo máximo a favor y en contra de un trade que queda
    abierto; sin "una posición a la vez" no anota "abierta al final de la fase"; y no quita la segunda señal de dos
    órdenes en la misma vela, que el motor ya quita antes de simular (`placed` en `run()`), así que en las corridas
    nunca le llega.
- **Cómo se compara** (`comparar.py`, `correr_capa_a.py`): se capturan todas las llamadas del motor a `simulate` en una
  corrida (las de la regla y las 6,000 de los dos controles al azar), se repiten con los dos oráculos con las mismas
  entradas y se comparan campo por campo: entrada, stop, objetivo, salida y su hora, motivo, R bruto y neto, lo máximo
  a favor y en contra, duración y alcance. La selección de "una posición a la vez" también se repite.
- **Lo que no es independiente:** los oráculos reciben del motor las señales, las zonas y los mapas de las salidas por
  aviso (señal contraria, VPA, canal, objetivo mixto y objetivos de nivel). Esas piezas se comprueban aparte en la
  etapa 3 (`vpa_exit_check`, `chain_check`, `gc_check`, `vp_check`, `smc_box_check` y `recipe_check`).

**Oráculo A contra el motor:** ninguna diferencia en ninguna corrida, salvo el texto del descarte de los objetivos de
nivel en R13c y R13d: la misma señal descartada, con "objetivo del perfil (o del rango) muy cerca" en el motor y
"objetivo muy cerca" en el oráculo (O-08).

**Oráculo B contra el motor:** todas las diferencias son de convención, y cada una está anotada:
- `exit_t` de 1 a 3 ms en las monedas sin minutos (R01 y R02x en SUI): O-03;
- `reach` en las entradas limit y orden stop (R05a, R05e, R06, R07b, R07c): O-05;
- `mfe` con el objetivo arrastrado (R07a y R09 en BTC y ARB): E-01;
- `bars` en las salidas en la apertura siguiente (R08g, R11a, R11b, R12): E-04;
- `chain_on` (R10): B no da ese campo; el objetivo, la salida y el R son iguales;
- `skip` en R13c y R13d: el texto, como en A;
- R06a y R06b: en el lote 4 corrieron con una versión del comparador que le pasaba al oráculo B un solo lado de las
  dos órdenes stop (el A los toma los dos por defecto; corregida a las 20:37); se repiten en el lote 6.

### Etapa 3 · Invariantes y pruebas metamórficas del motor (secciones 7 y 8)

`tests/audit/invariantes.py`: corre la regla con `rule_tester.run` y comprueba lo demás aparte. Las 50 reglas de prueba de
R01 a R15, en BTC 4h fase 1 (y 15m y 1h las que lo son); registro en `evidencia/motor/invariantes_todas_BTCUSDT_f1.log` y
un JSON por regla.

| Prueba | Qué compara | Resultado en BTC |
|---|---|---|
| I-01 corte | la regla con las velas cortadas en 5 fechas al azar: trades salidos y señales conocidas antes del corte | trades idénticos en las 50; en R07c faltan 3 señales antes del corte (**F-06**) |
| I-07 una posición | ningún trade empieza antes de que salga el anterior; enfriamiento | bien en todas (R14a corre con todas las señales: no aplica) |
| I-08 fase | señales, entradas y salidas dentro de la fase | bien en todas |
| I-09 embudo | señales = trades + motivos + con posición abierta + abiertas al final | bien salvo R06a y R06b: la mitad de las señales sin motivo (**F-05**) |
| I-10 repetible | X, otra moneda (ETH) y X otra vez, en el mismo proceso | bien en todas |
| I-11 cuentas | el resumen recalculado desde los trades (14 campos) | bien en todas |
| M-01 espejo | precios reflejados y sin minutos: cada largo es un corto en la misma vela, con el mismo R bruto | bien salvo R07c (**F-04**) y R04b (**O-10**). No aplica con datos que no salen de las velas (perfil, on-chain) ni con distancias en % (R08e, R09c); las de un solo lado se reflejan también de lado |
| M-02 escala | precios por 10, sin minutos: mismas señales y mismo R | bien en todas (el R con la tolerancia del comparador: el motor lo redondea a 4 decimales) |
| M-07 caché en frío | sin los cachés de elementos en memoria | bien en todas |

**En ARB (con almacén) y SUI (sin minutos)**, las mismas reglas (`invariantes_todas_ARBUSDT_f1.log` y `_SUIUSDT_f1.log`):
lo mismo que en BTC (F-05 en R06a y R06b, F-06 en R07c), más **O-11** (el nombre del aviso VPA en una salida de R11a, ARB).
En la prueba de corte, una orden puesta pocas velas antes del corte sale "sin llenar" en la corrida cortada porque se
llenaría después: eso se acepta (la orden no se puede resolver con lo que hay); que la señal falte, no.

**F-04 (S1), hallado con el espejo en R07c y medido aparte** (`tests/audit/medir_mismo_llenado.py`): con limit u orden
stop y una posición a la vez, cuando las órdenes de dos señales se llenan en la misma vela, el motor toma la de la señal
más vieja aunque los minutos digan que la otra se llenó antes. En BTC 4h f1, en todas las velas con dos llenados la
tomada fue la que se llenó después. Con limit favorece a la regla: ordenando por el minuto del llenado, el R medio de
R05a pasa de +0.241 a +0.200, R05b de +0.018 a +0.008, R05c de −0.124 a −0.150 y R05e de +0.044 a +0.025. Con orden
stop casi no cambia (R07b, R07c). La selección repetida aparte da exactamente los trades del motor, así que la medida es
del desempate y de nada más.

**H15 con órdenes que esperan:** si además una orden llenada después del minuto de la salida, en la misma vela, pudiera
entrar, R07c pasaría de 283 trades y +0.024 R a 326 y +0.187 R; R05e, de 350 y +0.044 a 379 y −0.010. Va a la decisión
de H15 (anotado en su fila).

**Los 64 casos de B con el oráculo A** (en la etapa 2, arriba) y estas pruebas cierran lo que el protocolo pide de la
etapa 3 para el motor.

### Punto de control de la etapa 3 y corrección de F-04 (21/11 noche)

En el punto de control (sección 13: "paro si hay fallos graves") el usuario eligió **corregir F-04 antes de seguir**.
Los demás defectos siguen la regla acordada: se anotan y se corrigen después del informe final.

- **Arreglo (motor 5):** `_fill_time()` en `rule_tester.py` da cuándo se llena cada orden en su vela (minutos o
  recorrido supuesto) y `run()` ordena por eso dentro de la vela del llenado; `_stale()` deja fuera las corridas
  anteriores con órdenes que esperan y una posición a la vez. La especificación (sección 9) y el oráculo A
  (`fill_time`, `select(fill_key=...)`, con sus propias velas y su lector de minutos) dicen lo mismo.
- **Pruebas:** `tests/test_fill_order.py` (11), que con el motor anterior falla (98.5 en vez de 99.4, con y sin
  minutos). `test_williams_smc.py` ajustada: una corrida vieja de la ruptura de fractal con orden stop y una posición a
  la vez ahora también queda fuera.
- **Medición repetida** (`medir_mismo_llenado.py`; las de antes en `*_motor4.json`): en las 6 reglas de BTC y las 2 de
  ARB, la orden tomada es siempre la primera en llenarse y el motor da exactamente la selección por minuto. R05a BTC
  +0.200 R (antes +0.241), R05b +0.008, R05c −0.150, R05e +0.025, R07b −0.156, R07c +0.032.
- **Invariantes repetidas** en las reglas con órdenes (BTC): el espejo de R07c ya cuadra; quedan F-05 (R06) y F-06 (R07c),
  que no tocan trades.
- **Capa A con el motor 5:** lote 7 (`lote7_motor5.log`), en curso.
- **Backend aislado:** el 9300 se arrancó sin recarga y sigue con el motor 4 mientras termina R02 (a mercado, no le
  toca). Hay que arrancarlo de nuevo antes de la etapa 4.

### Etapa 4 · Elementos y filtros de prioridad 1, controles e informes (hecha el 22/11)

**Pruebas metamórficas** (`tests/audit/metamorficas.py`, BTC 4h f1, FVG nuevo 0.3 sin "una posición a la vez";
`evidencia/elementos/metamorficas_BTCUSDT_240_f1.json`):
- **M-03, el filtro solo quita:** los 23 filtros de prioridad 1 (VWAP y EMA en sus modos, pendiente y tope de
  desviaciones; CVD; OI sube, baja, confluencia y sin confluencia en contra; multitud en sus dos modos; OI sostenido;
  on-chain; régimen dentro, fuera, tras romper y medido en 1D; horario, también cruzando la medianoche) dan un
  subconjunto de los 701 trades sin filtro, idénticos, y cada señal quitada lleva el motivo de su filtro.
- **M-04, apagar es no tenerlo:** líneas, flujo, régimen y horario apagados dejan la misma identidad de la regla.
- **M-05, umbrales que ordenan:** FVG 0.3 → 0.6 ATR, Flecha 2 → 3 veces el volumen, martillo con mecha de 3 cuerpos o
  con volumen, envolvente con volumen y la caja con tope de 5.5 ATR dan subconjuntos. El Impulso no, por definición:
  su evento es la vela en que empieza el impulso, y con 3 ATR esa vela es otra (más tarde) que con 2 ATR.

**Oráculo de los elementos de velas** (`tests/audit/elementos_a.py`, escrito por un agente aparte solo con la
documentación y el Excel de chequeo, sin ver el motor; sus 49 casos de respuesta conocida pasan) contra los eventos del
motor (`comparar_elementos.py`; `evidencia/elementos/`), con los parámetros de fábrica:
- **FVG nuevo, Impulso, Swing, Volumen alto, martillo, envolvente y doji: iguales evento por evento** (lado, vela,
  cuándo se conoce y zona) en BTC 4h y 1h, ARB, SUI y DOGE 4h, fase 1 (por ejemplo BTC 4h: 702, 303, 1,065, 746, 214,
  578 y 17; BTC 1h: 2,640, 1,236, 4,296, 3,475, 1,248, 2,754 y 107). Solo difieren 2 o 3 FVG y 1 Impulso en las
  primeras 9 velas de la fase en ARB y DOGE: el ATR del motor arranca con la primera vela (anotado en H2).
- **Flecha a favor del tramo:** las flechas (volumen de su hora) son las mismas; difiere el tramo. Con el zigzag del
  motor, iguales en BTC (880), ARB (166) y SUI (139). La documentación no dice cómo arranca ni cómo gira el tramo
  (**E-07**).

**Oráculo de los filtros** (`tests/audit/filtros_a.py`, escrito por otro agente sin ver el motor, solo con la
documentación y los datos crudos; sus 62 casos pasan) contra el motor (`comparar_filtros.py`): para cada una de las 702
señales del FVG 0.3 en BTC 4h f1, si el motor la deja pasar con el filtro y si el oráculo dice que pasa.
- **Iguales en las 702:** VWAP 200 (a favor, la mecha lo toca, con pendiente y con tope de 2 desviaciones), EMA 50 y
  14 (a favor, la mecha, con pendiente), CVD 20, OI sube y baja 2% en 6, OI sostenido y los dos on-chain.
- **Multitud: F-08.** Difieren 14 y 12 señales, todas con el funding de 3 días justo en la tasa base.
- **Confluencia OI-volumen: F-09.** El oráculo leyó la documentación como el panel del gráfico; el filtro hace otra
  cosa en los cortos (153 de 311 iguales a la regla del panel; en los largos, 387 de 391).

**Elementos de prioridad 1, un elemento por regla** (`reglas_prueba.py`, E-IM a E-DT; `invariantes.py` en BTC, 4h y 15m
para ST y DT): prueba de corte, embudo, fase, cuentas, repetible, espejo, escala y caché.
- Bien en Impulso, Volumen alto, Flecha, martillo, envolvente, doji, Ruptura y Borde de caja, ruptura con volumen (VPA),
  desequilibrios apilados (4,559 trades) y cola de delta (882).
- Compresión: F-05 (embudo). Swing y ruptura de fractal a mercado: el espejo muestra **H19** (dos señales opuestas en la
  misma vela: entra el largo).
- **Order flow sin futuro** (`corte_of.py`, BTC 15m f1): todos sus elementos detectados otra vez con los datos cortados
  en 5 fechas al azar (10 días antes de cada corte, de 1,740 a 2,505 eventos) salen idénticos a los de la fase entera.

**Piezas de nivel B y C contra su indicador en JavaScript** (`volcar_eventos.py` vuelca lo del motor y
`comparar_js.mjs` lo recalcula con `williams.js`, `regimeDetectors.js`, `responseBalance.js` y `vpa.js`, que tienen
sus propias pruebas de paridad con Python; BTC, ARB y DOGE 4h f1; `evidencia/elementos/comparar_js_*.json`):
- **Sabios, iguales evento por evento** (vela, lado, entrada, stop, nivel y fractal del tercero): BTC 843, 951 y 977;
  ARB 152, 186 y 190; DOGE 550, 676 y 654.
- **Cajas** (las de `erBox` con los valores afinados): **Compresión** (BTC 396, ARB 68, DOGE 246) y **Ruptura de caja**,
  con y sin el tope de 5.5 ATR (BTC 197 y 140), iguales, con su caja, su inicio y su alto en ATR de Wilder. **Borde de
  caja:** los 178 de BTC cumplen lo que dice la documentación, pero esa lectura da 834; con la regla del docstring de
  `box_elements.py` (un evento por llegada, que se rearma en el tercio del centro) son 178 de 178, y lo mismo en ARB
  (21) y DOGE (115): **E-08**.
- **Rombo** (giro y sigue) y **ruptura con volumen**: iguales (BTC 120 y 369, ARB 17 y 56, DOGE 65 y 208). En DOGE, 67
  rupturas guardan el nivel redondeado a 4 decimales: **O-12**.
- **Régimen:** en las 702 señales del FVG 0.3 de BTC (117 de ARB y 392 de DOGE), dentro, fuera y tras romper, con y sin
  el rango mayor, en 4h y medido en 1D: iguales en los 9 modos con tres precisiones que la documentación no dice
  (**E-09**): tras romper pide además estar fuera de un rango; en 1D cada vela usa el día que cerró con ella o antes; y
  las primeras 20 velas del marco del régimen (20 días en 1D) no tienen dato y no pasan (va con H2).

**Order flow de prioridad 1, condiciones necesarias** (`comparar_of.py`, BTC 15m f1, con las celdas del almacén
sumadas por vela y nivel y el step de la documentación; `evidencia/elementos/comparar_of_BTCUSDT_15_f1.json`):
- **Desequilibrios apilados:** los 17,038 de la fase cumplen todo: la zona cae en la grilla del step, el lado es el
  color, el volumen es 2 o más veces la mediana de las 20 velas anteriores y la racha tiene 3 o más diagonales de 4x.
  En 10,399 de ellos algún nivel es contra un 0: el motor lo cuenta (**E-10**).
- **Cola de delta:** las 1,720 cumplen todo: la zona es la celda del extremo de inicio, su delta va contra el color y
  el del resto a favor (sumado y nivel por nivel).
- El 06/04/2022 no hay velas de 08:30 y 08:45 en el almacén: Bybit no tuvo operaciones (sus velas de 15m de esa media
  hora tienen volumen 0). La mediana del volumen salta esas velas, como debe.

**Controles** (`tests/audit/controles.py`, BTC 4h f1; `evidencia/controles/`):
- **I-12** en 5 reglas (a mercado, stop en la zona, régimen, CVD y OI, dos órdenes): el azar y el tramo usan la regla
  que dice `_random_rule` (a mercado, el stop del elemento pasa a ATR con la distancia mediana), el mismo contexto y el
  mismo lector de minutos que la regla, y ninguna entrada cae fuera del régimen ni contra el filtro de lado. **Falla la
  proporción de lados con filtros de lado: F-07.**
- **El tramo sin futuro:** la dirección del zigzag no cambia al cortar las velas en 6 fechas al azar.
- **Cuántas entradas quedan:** el azar hace 3,000 intentos; quedan de 2,991 a 3,000 trades a mercado, pero con dos
  órdenes stop solo 1,185 (y el tramo, 628), porque muchas órdenes al azar no se llenan. Ver en la etapa 6 qué dice la
  pantalla (confusión 42).
- **H1 medido** en 6 reglas con línea: un azar que respeta la línea y el horario gana más que el de la app; la ventaja
  informada se achica de 0.04 a 0.20 R por trade (anotado en DEFECTOS, H1).

**Informes** (I-11; `tests/audit/informes.py`, `como_cuenta.py` y `.mjs`; `evidencia/informes/`), con 4 reglas del
usuario corridas en las 7 monedas de siempre (VA abandonada y tres de la Flecha, de 207 a 757 trades):
- **Todas:** recalculado desde las corridas de cada moneda, igual en todo: resumen de los trades juntos, azar pesado por
  los trades de cada moneda, ventaja y su margen, fila por moneda, por año, por lado y monedas positivas.
- **Como cuenta:** `accountStats` de la página (con node) contra un cálculo aparte desde la documentación: igual en las
  15 cifras de las 4 reglas, con dos convenciones que la documentación no dice: el Sortino mide la caída con todos los
  días (los positivos cuentan cero), no solo con los negativos (**E-06**), y un trade que sale a la misma hora en que
  entra sale 1 ms después.
- **CSV:** 8 corridas, cada fila y columna contra la corrida (horas en UTC, lado, motivo, R, velas): igual.
- **Constancia por trimestre de "Todas":** recalculada con los trades de cada moneda contra el azar de su trimestre y
  lado guardado en cada corrida: igual en las 4 reglas (13, 10, 6 y 3 trimestres de 20 trades o más), con dos
  convenciones que la documentación no dice (**E-11**).
- **Sensibilidad:** las 8 variantes de una regla, corridas aparte, dan lo mismo.
- **Estrategias:** 181 estrategias y 218 celdas; las 38 que pasan cumplen el criterio (ventaja sobre los dos controles
  con margen y R medio positivo), ninguna pasa sin el control del tramo, y ninguna marca contradice la regla.

**Corridas de la etapa 4 en pantalla, capas A, B y C** (BTC f1; ids en `evidencia/corridas_etapa4.log`; capturas en
`evidencia/pantalla/E4_*`; la cola de la página abre cada corrida desde el Historial y revisa trade por trade):
- 12 reglas con un filtro sobre el FVG 0.3 (FL-VWAP, EMA, CVD, OI, CONF, CROWD, STEADY, CHAIN, REG, REG1D, BRK y
  HORA; 1,706 trades) y 16 de un elemento (E-IM, SP, VH, RF, HM, EN, DJ, BX, BE, CP, QB, WF, WD y WA en 4h; DT y ST
  en 15m). Invariantes: todo bien en las 28 (WD 282 y WA 295 trades).
- Al cerrar esta nota: las 11 primeras con filtro capturadas, cada trade con su comprobación automática bien (salvo un
  error de red en el trade 109 de OI, a repetir); **capa B** de 9 de ellas: lo que dice la pantalla es lo de la corrida
  en todos los trades leídos, y cada una repetida desde cero da lo mismo. Las hojas de contactos las revisan agentes
  aparte; la capa A va en el lote 9 (`lote9_etapa4.log`).
- Avance (22/11, 3,297 s de cola): FL-HORA 142, E-IM 184, E-SP 266, E-HM 135 bien; E-VH 189 de 190 y E-RF 232 de 233.
  El aviso de las dos es el mismo trade (corto, señal 10/11/21 20:00 UTC): el gráfico abre 12.5 USD sobre la entrada del
  motor y toca el objetivo el 18/11 12:00 UTC, 4 h antes de la salida del motor. Cae en el hueco del archivo de trades
  de BTC (22/10 al 05/12/2021, H11): al almacén le faltan trades de los extremos. Mismo R; anotar en el informe cuántos
  trades toca ese tramo. Lote 8: capa A de R16, R19a, R19b y R20 sin diferencias (en R20, 5 `bars` de salidas por
  señal contraria: E-04). R19b agregado a la cola.
- **Actualización (22/11, mañana):**
  - **Capa A** (lote 9, `lote9_etapa4.log`): las 28 corridas sin ninguna diferencia con el oráculo A; con el B, solo
    el alcance de 4 trades de la compresión (O-05). Lote 7 (motor 5, órdenes que esperan, BTC y ARB): sin diferencias
    con A; con B, alcance (O-05) y lo "a favor" con objetivo arrastrado (E-01).
  - **Capa B** (`capa_b_etapa4.log` y la de las 9 primeras): 25 corridas, cada trade leído en pantalla igual a la
    corrida y cada una repetida desde cero igual. R02: 4,610 de 4,610 y repetida igual.
  - **Capa C:** capturadas las 25 corridas de 4h salvo WA (en curso) y el rombo, más la cola de delta (882, 15m); los
    desequilibrios apilados van repartidos entre las dos pestañas. Comprobación automática bien en todos los trades;
    los trades 1375, 1394 y 1756 de R02, que quedaron sin la tabla de la señal, repetidos bien. Las hojas de
    contactos de las 25 de 4h las revisaron siete agentes: **ningún trade mal** (cuadro en ✓, lado, entrada y salida
    con su signo). Lo que vieron: O-13 (texto del on-chain en los cortos), O-14 (el cuadro de la señal tapa a veces
    la salida; el nombre de la fila tapa sus primeras casillas), O-15 (CVD redondeado, pendiente que no se ve) y el
    F-08 a la vista (mismo funding mostrado, distinta clase). Las ✕ sueltas sin texto son marcas del Lector VPA, que
    quedó encendido en la página aislada desde la etapa 3: no son de los trades. Las dudas que dejaron por la
    resolución se cerraron con la captura o con los números (p. ej. EN #176 y WF #4: etiquetas del trade vecino).
- **Capturas repetidas (22/11):** las de la cola de delta (882) y los primeros 886 desequilibrios apilados salieron
  con el gráfico en 4H: la página no pasa al marco de la regla cuando la regla no tiene indicadores propios (**O-16**),
  y la comprobación automática anotaba "el gráfico no está en el marco de la regla" sin marcarlo como aviso, así que
  contaron como bien. Corregido en el ayudante: la cola pone el marco de la regla con su botón al abrir cada corrida, y
  cualquier comprobación sin velas o en otro marco es un aviso. Se repiten las dos corridas. R02 no se tocó: su
  pestaña estaba en 15M (lo confirman sus hojas y el "entrada=apertura" de su comprobación).
- **Repetidas en 15M (22/11):** la cola de delta (882) y los desequilibrios apilados (4,559, repartidos entre las dos
  pestañas) con la comprobación de cada trade bien y sin avisos; capa B igual en todos (y los apilados repetidos desde
  cero, iguales); 227 hojas revisadas por seis agentes: ningún trade mal. Sus dudas fueron trades con el stop muy
  corto, donde la comisión vale de 1 a 3.5 R (evidencia sumada a H18), y el último precio del final de la fase en el
  eje (O-17). Detalle en `revision_visual/E4_BTCUSDT_f1.md`.
- R16, R19a y R20 (las reglas exactas del usuario: ruptura de caja con EMA 200 y CVD, flecha con VWAP 200 y B5, misma
  identidad que 250, 14 y 151 corridas suyas) y R19b (rombo, giro): invariantes bien salvo el espejo del rombo en su
  primer trade (E-07); R16 pasa la capa A sin diferencias. Su revisión en pantalla va en la etapa 5, sobre sus
  corridas guardadas.

### Etapa 5 · Tus corridas reales (hecha el 22/11)

El usuario pidió seguir con la etapa 5 al cerrar la 4. En la copia del registro hay 1,388 corridas vigentes de las
reglas de la sección 12 (las que la app ya deja fuera por versión del motor no cuentan):

| Regla | Corridas | Grupos y fases |
|---|---|---|
| B5 (FVG o doji en 2, EMA 50, OI sube) | 209 (8 variantes) | siempre f1–f3, nuevas f1–f3 |
| Ruptura de caja con EMA 200 y CVD | 309 (5) | siempre f1 (4h y 15m), f2, f3; nuevas f1–f3; acciones f1 |
| Ruptura de caja · solo cortos | 285 (2) | siempre f1; nuevas f1–f3; acciones f1 |
| FVG 0.3 · 3R (dos nombres) | 64 | siempre f1, f2; nuevas f2 |
| Impulso 2 ATR en 3 · 3R | 50 | siempre f2; nuevas f2 |
| VPA: ruptura con volumen | 150 | siempre f1–f3; nuevas f1–f3 |
| Objetivos mixtos on-chain (Impulso, FVG y Ruptura de caja) | 150 | siempre f2; nuevas f2 |
| Sabios ("williams") | 58 (8) | siempre f1 en 15m, 1h, 4h y 1D; nuevas f1 |
| Flecha con VWAP | 113 (2) | siempre f1, f2; acciones f1 |

**Paso 1 · Las 1,388 repetidas desde cero, trade por trade** (`repetir_corridas.py`, `clasificar_repetir.py`;
`evidencia/etapa5/repetir_1388*.json`, `repetir_sui.json`, `repetir_errores.json`): **todas explicadas, ninguna diferencia
del motor sin causa.**

| Resultado | Corridas | Por qué |
|---|---|---|
| Idénticas | 1,294 | 2 de ellas fallaban en el script (las recetas en secuencia vuelven del disco con llaves de texto; con `saved_rule`, iguales) |
| Idénticas salvo la hora de la salida en 1 a 3 ms | 22 | O-03: corridas de antes del motor 3 |
| SUI con almacén nuevo | 24 | El almacén de SUI se armó el 21/11 23:56 a 22/11 03:45. Sin él, las 24 salen como las del usuario; una vela dudosa la deciden los minutos nuevos (E-12). 1,086 trades distintos: entradas de un tick, CVD real |
| Abiertos al final de la guardada | 38 | Fase 3 (y algún final de fase 1): trades que seguían abiertos y hoy cerraron |
| Vela dudosa | 5 | Corridas de antes del motor 3: contaban el stop, hoy el recorrido supuesto llega al objetivo (H21) |
| Inicio de fase | 3 | SNX: sus velas de 15m (bajadas el 22/11 01:15) empiezan 6 días después que las de 1h, y su fase 1 empieza ahí (H20) |
| Hueco al final | 2 | La guardada cerró por un hueco de datos en sus últimos días; hoy los datos siguen |

Hallado de paso: el script de repetición reusaba el tramo de la fase armado con el almacén (`_spans` no distingue la
fuente, H20) y el probador lee los minutos del almacén aunque corra sobre velas (E-12).

**Paso 3 · ¿Siguen en pie tus conclusiones?** (`conclusiones_etapa5.py`, `evidencia/etapa5/conclusiones_*.json` y
`conclusiones_comparadas.json`). Cada regla, en cada moneda y fase, corrida hoy con sus controles y con tres azares más,
con el mismo stop y la misma salida que el de la app: **lados** (guarda la proporción de largos y cortos de la regla,
F-07), **líneas** (entra solo donde dejan la línea y el horario, H1) y **ambos** (las dos cosas, el más justo). "Pasa" =
ventaja sobre el azar y sobre el tramo con margen que no toca el cero, y R positivo.

| Regla | Grupo · fase | Trades | R | Ventaja con el azar de la app | Ventaja con "ambos" | Pasa (app → ambos) |
|---|---|---|---|---|---|---|
| B5 | siempre · 1 | 413 | +0.194 | +0.197 (0.066 a 0.327) | +0.185 (0.054 a 0.315) | sí → sí |
| B5 | siempre · 2 | 294 | +0.212 | +0.227 (0.074 a 0.380) | +0.202 (0.050 a 0.355) | sí → sí |
| B5 | siempre · 3 | 263 | −0.016 | +0.031 (−0.120 a 0.182) | −0.017 (−0.168 a 0.134) | no → no |
| B5 | nuevas · 1 | 2,394 | +0.059 | +0.101 (0.049 a 0.152) | +0.087 (0.035 a 0.138) | sí → sí |
| B5 | nuevas · 2 | 1,506 | +0.072 | +0.097 (0.032 a 0.163) | +0.090 (0.024 a 0.155) | no (tramo) → no |
| B5 | nuevas · 3 | 1,465 | −0.004 | +0.027 (−0.037 a 0.092) | −0.011 (−0.076 a 0.054) | no → no |
| Ruptura de caja | siempre · 1 | 272 | +0.341 | +0.278 (0.050 a 0.506) | +0.175 (−0.053 a 0.403) | **sí → no** |
| Ruptura de caja | siempre · 2 | 199 | +0.407 | +0.330 (0.061 a 0.599) | +0.294 (0.025 a 0.563) | sí → sí |
| Ruptura de caja | siempre · 3 | 220 | +0.112 | −0.102 (−0.345 a 0.140) | −0.133 (−0.375 a 0.110) | no → no |
| Ruptura de caja | nuevas · 1 | 2,246 | +0.149 | +0.160 (0.084 a 0.236) | +0.143 (0.067 a 0.219) | sí → sí |
| Ruptura de caja | nuevas · 2 | 1,566 | +0.253 | +0.232 (0.139 a 0.325) | +0.265 (0.172 a 0.358) | sí → sí |
| Ruptura de caja | nuevas · 3 | 1,484 | +0.068 | −0.002 (−0.094 a 0.089) | −0.012 (−0.104 a 0.079) | no → no |
| Solo cortos | siempre · 1 | 149 | +0.414 | +0.455 (0.143 a 0.766) | +0.360 (0.049 a 0.672) | sí → sí |
| Solo cortos | nuevas · 1 | 1,131 | +0.353 | +0.293 (0.182 a 0.405) | +0.289 (0.178 a 0.401) | sí → sí |
| Solo cortos | nuevas · 2 | 853 | +0.423 | +0.301 (0.171 a 0.430) | +0.343 (0.213 a 0.473) | sí → sí |
| Solo cortos | nuevas · 3 | 848 | +0.163 | −0.006 (−0.130 a 0.117) | −0.055 (−0.178 a 0.069) | no → no |
| Flecha con VWAP | siempre · 1 | 612 | +0.201 | +0.193 (0.074 a 0.312) | +0.133 (0.014 a 0.252) | sí → sí |
| Flecha con VWAP | siempre · 2 | 512 | +0.117 | +0.120 (−0.008 a 0.247) | +0.104 (−0.024 a 0.232) | no → no |

- **Con el azar de la app, los 18 veredictos de hoy son los de las corridas guardadas.** Lo que cambió desde entonces es
  de los datos: la fase 3 creció (de 2 a 21 trades más), SUI tiene almacén y SNX perdió un trade. La variante de cada
  regla es la del usuario: B5 `2277e57a`, caja `1a4ac5c5`, solo cortos `d4e84ccb` y flecha `7f537484` (las de las
  acciones son otras).
- **Con el azar más justo cambia un solo veredicto: la ruptura de caja en la fase 1 de las monedas de siempre** deja de
  pasar. Su ventaja sobre un azar que respeta la EMA 200 y guarda los lados baja de +0.28 a +0.18 R. Fue la fase de
  exploración y la regla pasó después la fase 2 contra todos los controles.
- La flecha con VWAP pasa la fase 1, pero con un margen más chico (+0.19 → +0.13 R). Solo cortos, de +0.46 a +0.36 R
  en las monedas de siempre.
- Las conclusiones de las fases 2 y 3, que eran las de comprobación, no cambian con ningún control.

**Paso 2 · Capas A, B y C en las corridas de BTC** (25 corridas, 24 con trades, 5,987 trades;
`revision_visual/E5_BTCUSDT.md`, `evidencia/etapa5/corridas_btc.txt`, `evidencia/capa_a/E5_*`, `evidencia/pantalla/E5_*`):
- **Capa A:** las 150,215 llamadas (la regla y sus dos controles) son iguales al oráculo A en las 24 corridas, y "una
  posición a la vez" elige los mismos trades. Con el B solo salen E-04 (B5) y `chain_on` (objetivos mixtos, ya explicado
  con R10).
- **Capa B:** en los 5,987 trades, la pantalla es igual a la corrida guardada.
- **Capa C:** las 5,987 capturas pasaron su comprobación. Nueve agentes revisaron 305 hojas: ningún trade mal; las dudas
  se cerraron con los números o con la captura a tamaño real. Las fases 2 y 3 se abrieron pidiendo "Ver el gráfico de la
  fase N" (el ayudante lo hace solo desde esta etapa).
- **Hallado:** F-10 (al pasar al marco de la regla, los sabios se dibujan con los ajustes guardados), O-18 (dos reglas
  iguales con distinta identidad), O-19 (variantes del margen que no cambian nada en la sensibilidad), más evidencia para
  H18 (stops de 0.04% del precio) y O-17.

### Etapa 6 · Prioridad 2, confusiones, pasos y sesgos (hecha el 22/11)

**Plan.** Reglas de prueba en `tests/audit/reglas_prueba.py` (`STAGE6`, 76): un elemento o un filtro por regla, con el
ciclo de R01 (a mercado, stop 1.5 ATR, 3R) salvo donde la pieza trae su salida o su stop. Conteo en
`evidencia/etapa6/conteo_f1.json` (`contar_etapa6.py`).
- **Elementos de velas** (VPA, SMC, cambio de carácter, canal gaussiano): en BTC 4h f1, con las capas A, B y C.
- **Order flow, perfil por sesión y liquidaciones:** en BTC 15m f1 cada elemento da de 1,750 a 4,860 trades (los 29
  de order flow, unos 87,000). Para capturar cada trade se corren en ARB 15m f1 (253 días: de 300 a 980 trades por
  regla, unos 21,000 en total), como la capa C de R01 a R15 en la etapa 3; en BTC 15m van las comprobaciones de todos
  sus eventos (condiciones necesarias y corte) y las invariantes.
- **Filtros:** los 26 modos sobre el FVG 0.3 de BTC 4h f1 (Williams, SMC, medidor VPA, horario y medidas).
- Corridas en `evidencia/corridas_etapa6.log`; capturas en `evidencia/pantalla/E6_*`, cuatro pestañas a la vez (dos de
  BTC y dos de ARB; las de ARB necesitan un tamaño de ventana fijo: abiertas con el panel oculto quedaban en 0×0).

**Reglas corridas.** 76 de la etapa (`STAGE6`) más las de marcos y acciones: R35 (FVG 0.3 a 3R en 5m, 30m, 1h y 1D,
en BTC y ARB) y R34 (Impulso en AAPL y SPY, 1h y 4h). Ids en `evidencia/corridas_etapa6.log`.

**Invariantes** (`invariantes.py`, `evidencia/etapa6_invariantes_*.log` y `evidencia/motor/invariantes_*.json`):
- las 40 reglas de 4h de BTC, bien salvo el espejo del medidor VPA (**H22**);
- las 36 de 15m de BTC (order flow, perfil por sesión y liquidaciones) y las de ARB 15m, todo bien (el espejo y la
  escala no aplican al order flow);
- R35 y R34, bien salvo tres casos explicados:
  - R35-60 en BTC dejaba una señal sin cuadrar en el embudo: la de la última vela de la fase (31/12/2023 23:00), "sin
    vela siguiente", que el motor no cuenta entre los motivos y el protocolo sí; la herramienta ya la cuenta;
  - el espejo y la escala de R35-5 en ARB 5m (2 de 2,761 trades) y el espejo de R34-60 en AAPL (1 de 440): toques
    exactos de un nivel que cambian con el redondeo (**O-25**; en los datos reales, de 48 toques exactos en 47 reglas el motor pierde 5, en 2 trades de ARB 15m);
  - R35-1D en ARB: un corte de 55 velas diarias no llega a correr ("Sin velas suficientes"); la herramienta ya lo salta.
- La herramienta no le pasaba la tabla de medidas a las reglas con filtros de medidas y daba 0 trades: corregida (con
  la tabla, FL-MED 118, FL-MED2 126 y FL-MED3 201 trades, todo bien).

**Capa A** (`evidencia/etapa6/capa_a_4h.log` y `capa_a_arb15.log`; sin los controles, ya comparados en la etapa 4):
- las 44 reglas de 4h de BTC, iguales al oráculo A en todas las llamadas y en la selección de "una posición a la
  vez"; con el B, solo las velas de las 210 salidas por el canal de E-GC (**E-04**);
- ARB 15m: iguales a los dos oráculos, salvo el texto del descarte del objetivo del perfil en VR, VF y VE (29, 268 y
  42 señales; **O-08**).

**Comprobadores independientes**, escritos por agentes aparte desde la documentación, sin ver el motor:
- VPA y SMC contra sus indicadores en JavaScript (`comparar_js2.mjs`): iguales evento por evento en BTC, ARB y DOGE;
- Williams y el horario (`filtros_a2.py`): iguales en las 15,444 señales filtradas de BTC; en ARB, 2,571 de 2,574
  (**F-13**: el Alligator dormido deja pasar las primeras 20 velas de la fase);
- order flow literal (`comparar_of2.py`): BTC 15m sin fallas; en ARB, **F-14** (VA bajista por ruido de coma
  flotante) y **E-15** (umbral −∞ con pocos candidatos), y los puntos a precisar de **E-16**;
- cambio de carácter (`cc_check.py`): eventos 100% iguales (**F-17**, una vela de estructura sin una del medio sigue
  disparando, sin efecto en los datos);
- liquidaciones (`liq_check.mjs`): las zonas iguales a `liquidationZones.js`, pero el ancho de las franjas sale del
  archivo entero, con futuro (**F-16, S1**), y el armado del barrido no vence (**H23**).

**Pantalla.**
- **Los 100 pasos** (hoja Chequeo; `evidencia/etapa6/pasos_pantalla.json`): en la copia aislada (http://localhost:9301,
  otro origen para no tocar las pestañas que capturan) o, donde la prueba ya existía, con la evidencia de las etapas
  3 a 5. Los pasos 18, 49, 56, 66 y 72 se comprobaron en el motor (`pasos_motor.py`). Todos dan lo que dice la guía,
  con dos donde la app cambió desde que se escribió: el 14 (las monedas nuevas ya tienen 15m; el error sale con una
  acción en 5m) y el 71 (la nota del horario va bajo el horario).
- **Las 43 confusiones** (hoja Confusiones; `confusiones_pantalla.json`, `confusiones_motor.json`, `borde_rearme.py`):
  40 confirmadas con números o en pantalla y 3 que cambiaron (27: los interruptores esconden las casillas sin efecto;
  31: hay "Regla nueva", pero sigue abriendo con la última regla y "Borrar" no pregunta; 34: las monedas nuevas ya
  tienen 15m y 5m, las acciones en 5m y 30m fallan, **F-11**). La 9 con números: con "cuerpo hasta 1 ATR" el borde de
  caja da 178 señales en BTC 4h; si la llegada solo se gastara al dar un evento, 382.

**Capa C, cada trade en pantalla** (`revision_visual/E6_ETAPA6.md`, con la tabla por corrida):
- 85 corridas, 31,556 trades y 31,556 capturas, en 1,503 hojas de contactos;
- la capa B leyó los 31,556 en pantalla: iguales a su corrida, y cada corrida repetida desde cero da lo mismo;
- la comprobación automática deja 5 avisos, todos de O-25 (2 trades de ARB 15m repetidos en 5 reglas);
- 43 informes de revisores aparte (A1 a A10, B1 a B8 con B1b y B7b, C1 a C6, D1 a D15, S1 y S2): ningún trade mal.
- Las capturas que salieron incompletas (antes de cargar el detalle o la tabla) o sin su línea de comprobación
  (las sesiones que se cerraron) se repitieron. La regla diaria de BTC y de ARB y la de 30m se recapturaron con un
  encuadre nuevo. Las últimas 9,278 capturas se repartieron entre pestañas sin pasar de 3 corridas a la vez (O-30).
- En la herramienta: la capa B daba por buena la frase "no se cumplía todo", y las líneas no marcaban una captura
  "no lista". Las dos cosas ya se corrigieron. En todas las capturas de las etapas 3 a 6, esa frase solo aparece en
  los 118 trades de antes de la tabla de medidas de FL-MED, FL-MED2 y FL-MED3 (confusión 23, O-26), y solo 3 capturas
  salieron no listas; se repitieron.

**Hallado en la etapa:** H22, H23, F-11 a F-14, F-16 (S1), F-17, E-14 a E-16, O-20 a O-32. Más evidencia para F-01
(el enfriamiento activo al comienzo de cada fase, también en pantalla: paso 77) y para H18 (en el barrido de la zona de
liquidaciones, 20 de 979 trades salen en el objetivo con R negativo y 76 stops pierden más de 2 R; en el barrido de un
swing, 9 de 587 y 66), para O-25 (en los datos reales el motor pierde 5 de 48 toques exactos en 47 reglas, en 2
trades de ARB 15m) y para O-21 (a mercado, el order block y la ruptura de estructura dan los mismos 56 trades).

**Sesgos** (sección 10; `sesgos.py`, `evidencia/etapa6/sesgos_*.json`). Candidatas: las reglas exactas del usuario (B5,
Ruptura de caja con EMA 200 y CVD, su versión de solo cortos y la Flecha con VWAP) con sus corridas guardadas en las 7
monedas de siempre; para B-02 y B-03, las reglas de prueba equivalentes (R20, R16, R19a y otras), corridas aquí.

| Sesgo | Qué se midió | Resultado |
|---|---|---|
| B-01 mirar el futuro | La prueba de corte (I-01: cada regla corrida con las velas cortadas en 5 fechas al azar; lo cerrado antes del corte tiene que ser igual) en las 124 reglas de la etapa (BTC 4h y 15m, ARB 15m, R35 y R34), y la hora en que se conoce cada evento en los comprobadores independientes (VPA, SMC, Williams, order flow, cambio de carácter, liquidaciones) | **Un solo caso: F-16 (S1).** El ancho de las franjas de liquidaciones sale del archivo entero; con él, en ARB 15m f1 158 de 587 y 302 de 979 trades pierden su evento, y en BTC 741 de 2,204 y 872 de 2,130. Todo lo demás, sin futuro: la prueba de corte da lo mismo en todas las reglas |
| B-02 arranque en frío (H2) | Fases 2 y 3 de BTC, ETH y SOL en 4h, en frío (como la app) contra 600 velas de la fase anterior delante | Se pierden de 0 a 6 trades por moneda y fase, todos en las primeras 300 velas (50 días). El R de la moneda y fase se mueve hasta ±0.1 (FL-VWAP en SOL f2: +0.396 → +0.289; R16 en BTC f2: +0.433 → +0.352). Lo más afectado: VWAP 200, EMA 200 y la flecha; el régimen no cambia |
| B-04 monedas sobrevivientes (H7) | `sobrevivientes.py`: los perpetuos USDT de Bybit que empezaron antes de 2022 y cerraron después (25 de 1,077 cerrados; API pública), las 20 de más volumen en 2022 con 120 días o más de velas (LUNA, FTT, SRM, BIT, MATIC, FTM, EOS, KLAY…), en una carpeta aparte (`velas_sobrevivientes_120d`, el probador apuntando a ella); fase 1, tres reglas del usuario, contra las 43 nuevas | **No aparece la inflación.** Ruptura de caja con EMA 200 y CVD: +0.200 R en las cerradas (14 de 20 positivas, 861 trades) contra +0.148 en las nuevas (29 de 43); Flecha con VWAP: +0.037 contra +0.040; Impulso: +0.094 contra +0.085. Azar cerca de 0 en los dos grupos. LUNA dio +0.44 R (11 trades) en la ruptura de caja; FTT, −0.29 (27). Ojo: varias de las cerradas cambiaron de nombre (MATIC, FTM, EOS, RNDR), no se hundieron |
| B-03 censura (H6) | Fases 1 y 2, 7 monedas, 5 reglas: los trades abiertos al final, resueltos con las velas siguientes | 0 o 1 abierto por moneda y fase; su R va de −1.08 a +2.71 y mueve el R de la moneda y fase 0.05 como mucho (R19a en ARB f1: −0.051 → +0.003, un trade de +1.99) |
| B-05 deslizamiento | Las 4 candidatas, fases 1 a 3, con 0.02% y 0.05% por lado en cada llenado a mercado | −0.008 a −0.016 R por trade con 0.02%; −0.019 a −0.040 con 0.05%. Ningún veredicto cambia (B5 f2: +0.202 → +0.172; Ruptura de caja f2: +0.387 → +0.359) |
| B-06 funding | Las mismas, con el funding de cada liquidación con la posición abierta | De −0.003 a −0.015 R por trade (la Flecha f1, −0.015); los cortos cobran (solo cortos: +0.005) |
| B-07 azar repartido como la regla | El azar de cada trimestre y lado (el que guarda cada corrida) pesado por los trades de la regla, contra el azar de toda la fase | **El que más mueve.** La regla opera más en los trimestres y lados donde el azar gana: B5 f1, ventaja +0.198 → +0.155; Ruptura de caja f1 +0.257 → +0.099 y f2 +0.308 → +0.190; solo cortos f1 +0.448 → +0.330; **Flecha f1 +0.193 → +0.044 y f2 +0.120 → −0.005** |
| B-08 trades que se mueven juntos (H10) | Margen del R medio de "Todas" contra un bootstrap por semanas | El margen real es de 1.02 a 1.43 veces más ancho (Ruptura de caja f3: 1.43; Flecha f2: 1.36). Los márgenes que ya tocaban el cero lo tocan más; ninguno que pasaba deja de pasar en R medio |
| B-09 muchas variantes | Reglas distintas por moneda en el registro contra el contador de la pantalla | El contador no cuenta las corridas de motores viejos (**F-12**): BTC 182 reglas, dice 137 |

### Etapa 7 · Correcciones (22/11)

El usuario aceptó todas las recomendaciones de `INFORME_FINAL.md` ("Acepta todas", 22/11). Orden: F-16 → F-02, F-03 y
H20 → F-07, F-08 y F-09 → las decisiones que cambian trades, juntas en el motor 6 → controles (H1, B-07, B-08) → lote
menor → regresión. Cada corrección con su prueba.

| Paso | Estado | Qué se hizo | Prueba |
|---|---|---|---|
| F-16 | hecho | `liq_store.known_width()`: el ancho de celda con las celdas ya conocidas (`wmax`, máximo acumulado en orden de known); `liq_sweeps.zones_at` lo usa; `window()` lo manda al indicador con el corte; `_info` ya no da el de todo el archivo | `test_liq_sweeps.py` (+1) y `test_liq_store.py` (+1): 22 pasan |
| F-02 y F-03 | hecho; datos reparados (117,624 velas en las 43 monedas) | `candles_update._fetch`: páginas de 1,000 exactas, reintento con retCode de error (`_page`), vuelve a pedir la última guardada y no guarda la vela en formación; `repair()` y `--repair [--since]` rellenan huecos. `main.fetch_incremental_candles`: vuelve a pedir la última y no guarda la que se forma; solo se guarda el caché si algo cambió. Reparación de las 43 monedas desde el 19/11 con el candado de `market_update` (`evidencia/etapa7/reparar_velas.log`) | `test_candles_update.py` (4) |
| H20 | hecho | `data_mark()` en cada corrida (`data` en el resultado y en `runs.jsonl`); `same_data()` compara con las velas de hoy del tramo de la corrida; `gate()` y `_plan()` no reusan una corrida con otros datos (así tampoco entra en "Todas"). El tablero toma la última corrida guardada: se actualiza al volver a correr | `test_data_mark.py` (5) |
| F-07 | hecho | `_baseline`: con filtros de lado, primero el lado con la proporción de la regla y después una vela donde el filtro lo deje (`SIDED_TRIES`); sin filtros de lado, el azar es el mismo de antes. La búsqueda genética ya pesaba cada lado por la proporción de la regla | `test_flujo_azar.py` |
| F-08 | hecho | `flow_filters.crowd`: tolerancia `FUNDING_EPS` (1e-12): la tasa base es neutra | `test_flujo_azar.py` |
| F-09 | hecho | `flow_filters`: la confluencia como el panel: en un corto el volumen y el OI bajan; el z con la vela incluida y la desviación de la población (`_zscore_with`, como `calculateZScore`) | `test_flujo_azar.py` (4 en total) |
| H15 | hecho (motor 6) | A mercado, la señal de la vela de la salida entra (`busy_until` = la vela de la salida). Con órdenes que esperan, una que se llena en esa vela entra si se llenó después del momento de la salida (`_exit_moment`, con `_fill_time` desde el llenado si el trade entró en esa vela); en el mismo minuto, no. Arreglado de paso: la primera versión comparaba con la apertura de la vela y no dejaba entrar ninguna | `test_motor6.py` |
| F-01 | hecho (motor 6) | Sin trades, sin enfriamiento; su largo no cambia (la primera señal que entra es la de `cooldown + 1` velas después de la salida) | `test_motor6.py` |
| H19 | hecho (motor 6) | A mercado y una a la vez, una vela con señales de los dos lados no da ninguna ("señales opuestas en la misma vela") | `test_motor6.py` |
| H18 | hecho (motor 6) | `maxFeeR` (0.3 de fábrica, fuera de la identidad si es el de fábrica): "comisión muy alta para el riesgo" | `test_motor6.py` |
| H16 | hecho (motor 6) | El FVG lleva `first` (la primera de sus tres velas) y `i0` la usa | `test_motor6.py` |
| H4 | hecho (motor 6) | `since_fill`: en la vela del llenado, lo a favor y en contra desde el llenado (como la variante h4 del oráculo A) | `test_motor6.py` |
| H22 | hecho (motor 6) | La estrella abajo de un tramo bajista suma (`invh`), en `vpa.py` y `vpa.js`; la prueba del filtro del medidor pasó a "no en contra" (con "a favor" pasaba 1 de 45 señales) | `test_vpa.py` (+1, espejo) y `vpa.parity.test.mjs` (8, al bit) |
| H2 | hecho (motor 6) | `_warm_bars` y `_warmed`: las velas de antes de la fase delante (`lead`), sin señales ni azar en ellas; la huella de los datos las incluye. Medido con el FVG (1.5 ATR, 3R): BTC 4h f1 y f2, SUI 4h f1 y DOGE 1h f2, los mismos trades; el azar cambia de muestra (su semilla depende del largo) | `test_motor6.py` (+2) |
| Motor 6 | hecho | `ENGINE = 6`; `_stale()`: todo motor anterior queda fuera | `test_williams_smc.py`, `test_fill_order.py` y `test_stocks.py` al día |
| H1 | hecho (motor 6) | `_side_ok` mira la línea y `_allowed` el horario; en la búsqueda, la línea entra a la clave de sus controles | toda la batería |
| B-07 y B-08 | hecho | `quarter_control`, `edges`, `clustered_se`: tres ventajas con el margen por semanas en la corrida, "Todas" y el tablero; "pasa" pide las tres | `test_controles_b07_b08.py` (4) |
| B-05 y B-06 | hecho (motor 6) | `trade_costs` y `_with_costs`: `slip` y `funding` en cada trade; las opciones `slippage` y `funding` los descuentan de la regla y del azar; "Todas" dice su efecto | `test_motor6.py` (+1) y `rulefacets.test.mjs` |
| Lote menor del motor | hecho | F-05, F-06 (los mismos trades en BTC, SUI y ARB 4h f1; solo cambian las señales), F-11, F-12, F-13, F-14 (`_e2`), F-17, O-05, O-07 (`vp4_`), O-10, O-11, O-12, O-18, O-19, O-25, O-28, O-30 | `test_lote_menor.py` (5), `test_structure.py` (+1) |
| Pantalla y textos | hecho | F-10, H13, H14, H17, O-01, O-02, O-04, O-08, O-13, O-14 (el cuadro), O-15, O-16, O-17, O-22, O-23, O-26, O-27, O-29 (la caja), O-31, O-32. Visto en la copia aislada (BTC 4h f1, la ruptura con volumen y salida VPA): la sección Stop, las tres ventajas, el embudo, el trade 3 con una caja, el cuadro lejos de la salida, el Lector VPA y sin el último precio | `rulefacets.test.mjs` (13), `ruletester.test.mjs` (15) |
| Documentación | hecho | Especificación (motor 6, E-01, E-03, E-04), `CLAUDE.md` de App 1 ("Motor 6") y los estados de `DEFECTOS.md` | — |

**Regresión (22/11):**
- **Pruebas:** backend 579 pasan y fallan las 2 de siempre (`test_endpoints` por la versión y `test_lru_cache::test_clear`);
  en la página solo falla `liquidations.test.mjs`, como desde el 13/11. Las del protocolo (`tests/audit`): 294 pasan y
  fallan las 11 explicadas de los 64 casos con el oráculo A (etapa 2).
- **Invariantes** (`regresion_invariantes.py`, salida en `evidencia/etapa7/invariantes/`): R01 en BTC 4h f1, todas bien
  (corte, una posición a la vez, fase, embudo, repetible, cuentas, espejo, escala y caché en frío). Para eso el script
  refleja y escala también las velas de antes de la fase (`with_warm`), apaga el tope de la comisión en el espejo (depende
  del nivel del precio, y el espejo lo cambia: en BTC los precios de 2020 pasan de unos 8,000 a unos 64,000) e I-07 acepta
  la salida y la entrada a la misma hora (H15). La corrida de R01 en BTC pisó su archivo de la etapa 3 en
  `evidencia/motor/` (la de la etapa 3 está descrita más arriba).
  Después, **todas las reglas** en que se corrieron antes: 296 casos (las reglas de prueba de las etapas 3 a 6, en BTC,
  ARB, SUI, AAPL y SPY), **todos bien**. Ocho daban distinto el espejo, y ninguno era del motor:
  - siete (R05a, R05b, R05c, R05e y R07c en BTC; R05a y R05e en ARB) por la prueba: emparejaba los trades solo por su
    vela de entrada, y desde H15 dos trades pueden entrar en la misma vela (el primero sale por su stop y otra orden que
    se llena después entra). El segundo tapaba al primero. En los tres de R05a en BTC, el orden de los llenados y las
    salidas es el mismo en el original y en el espejo;
  - R34-60 en AAPL corrió con el script de antes, sin las velas de antes de la fase reflejadas.

  Con el emparejado por la vela y el lugar del trade en ella, los nueve repetidos dan todo bien
  (`evidencia/etapa7/invariantes_repetidas.log`).
- **Capa A, R01 en BTC 4h f1:** las 6,290 llamadas (regla y controles) iguales al oráculo A. La selección de antes daba
  266 trades contra 289; con la del motor 6 escrita aparte en el oráculo (`select_motor6`: H15, F-01 y H19), los mismos
  289. El archivo de la capa A de la etapa 3 de esa corrida también quedó pisado. R05b en ARB 4h f1 (limit en la mitad
  del FVG, con minutos): las 6,117 llamadas iguales y los mismos trades, con el oráculo al día (la variante h4 de fábrica,
  el tope de la comisión y la orden stop del 3.er sabio que se llena al pasar el fractal). También pisó su archivo de la
  etapa 3. Desde aquí la capa A escribe en `evidencia/etapa7/capa_a/` (`AUDIT_OUT`).
- **Tus veredictos, monedas de siempre** (`veredictos_etapa7.py`, `evidencia/etapa7/veredictos_base.json`; "pasa" =
  las tres ventajas con margen sobre cero y R positivo):

| Regla | Fase | Trades | R | Vs. azar | Vs. tramo | Vs. su trimestre y lado | Pasa (etapa 5 app → motor 6) |
|---|---|---|---|---|---|---|---|
| B5 | 1 | 432 | +0.178 | +0.182 (0.055 a 0.309) | +0.159 (0.032 a 0.286) | +0.195 (0.070 a 0.320) | sí → sí |
| B5 | 2 | 302 | +0.214 | +0.232 (0.060 a 0.404) | +0.183 (0.011 a 0.355) | +0.242 (0.077 a 0.407) | sí → sí |
| B5 | 3 | 273 | −0.013 | −0.012 | −0.030 | −0.026 | no → no |
| Ruptura de caja | 1 | 300 | +0.306 | +0.115 (−0.151 a 0.381) | +0.106 | +0.152 | **sí → no** |
| Ruptura de caja | 2 | 216 | +0.349 | +0.220 (−0.071 a 0.511) | +0.145 | +0.230 | **sí → no** |
| Ruptura de caja | 3 | 237 | +0.113 | −0.149 | −0.112 | −0.164 | no → no |
| Solo cortos | 1 | 168 | +0.346 | +0.244 (−0.112 a 0.599) | +0.117 | +0.263 | **sí → no** |
| Flecha con VWAP | 1 | 726 | +0.206 | +0.103 (−0.031 a 0.236) | +0.085 | +0.113 | **sí → no** |
| Flecha con VWAP | 2 | 623 | +0.140 | +0.124 | +0.066 | +0.107 | no → no |

  Lo que más mueve es H1: con la EMA 200 o el VWAP, el azar que entra solo donde deja la línea gana mucho (ruptura de
  caja: el azar de la fase pasa a +0.19 R en f1 y +0.13 en f2; la flecha, +0.10). Después B-08: el margen por semanas es
  de 1.0 a 1.4 veces el de antes. B5 no usa línea y sigue pasando.
- **Tus veredictos, monedas nuevas**, con las velas ya reparadas (F-02 y F-03; `evidencia/etapa7/veredictos_new.json`):

| Regla | Fase | Trades | R | Vs. azar | Vs. tramo | Vs. su trimestre y lado | Pasa (etapa 5 app → motor 6) |
|---|---|---|---|---|---|---|---|
| B5 | 1 | 2,480 | +0.056 | +0.079 (−0.012 a 0.169) | +0.065 (−0.026 a 0.155) | +0.067 (−0.016 a 0.150) | **sí → no** |
| B5 | 2 | 1,545 | +0.072 | +0.093 (−0.038 a 0.224) | +0.050 (−0.081 a 0.181) | +0.087 (−0.038 a 0.211) | no → no |
| B5 | 3 | 1,521 | −0.009 | −0.015 | −0.004 | −0.032 | no → no |
| Ruptura de caja | 1 | 2,420 | +0.128 | +0.123 (−0.046 a 0.292) | +0.100 (−0.069 a 0.269) | +0.138 (−0.019 a 0.295) | **sí → no** |
| Ruptura de caja | 2 | 1,719 | +0.230 | +0.256 (−0.020 a 0.532) | +0.217 (−0.059 a 0.493) | +0.274 (0.021 a 0.526) | **sí → no** |
| Ruptura de caja | 3 | 1,634 | +0.034 | −0.050 | −0.035 | −0.075 | no → no |
| Solo cortos | 1 | 1,219 | +0.336 | +0.263 (−0.026 a 0.551) | +0.304 (0.016 a 0.593) | +0.292 (0.019 a 0.564) | **sí → no** |
| Solo cortos | 2 | 956 | +0.363 | +0.297 (−0.113 a 0.707) | +0.349 (−0.062 a 0.759) | +0.297 (−0.094 a 0.688) | **sí → no** |
| Solo cortos | 3 | 920 | +0.127 | −0.063 | +0.056 | −0.120 | no → no |

  Las ventajas casi no cambian (ruptura de caja f2: +0.232 → +0.256; solo cortos f2: +0.301 → +0.297), y el azar de
  la fase sigue cerca de cero: H1 casi no mueve a las nuevas. **Lo que cambia es B-08.** Con 43 monedas juntas, los
  trades que salen la misma semana se mueven juntos: el margen por semanas es de 1.7 a 3.4 veces el de trades
  independientes (B5 f1: 1.80; ruptura de caja f2: 3.14; solo cortos f2: 3.39). En las 7 de siempre es de 1.00 a 1.45.
  **El informe final subestimó B-08 en las nuevas:** daba 1.0 a 1.4 con lo medido en las de siempre. Las ventajas
  siguen positivas y con muchas monedas a favor (solo cortos f1: 38 de 43), pero ya no se distinguen de cero con
  margen. La fase 3 de las nuevas sigue sin confirmarlas.
- **Los 18 veredictos, en suma:** pasaban 11 y con el motor 6 pasan 2, B5 en las fases 1 y 2 de las monedas de siempre.
  En las de siempre los cambia sobre todo H1; en las nuevas, B-08.
- **Tus 28 corridas con liquidaciones** (todas de BTC, fase 1; `liq_etapa7.py`, `liq_controles_etapa7.py` y
  `liq_atribucion_etapa7.py`, en `evidencia/etapa7/liq_*.json`), repetidas con el motor 6 y sus controles:
  - **ninguna pasa**, y en ninguna las liquidaciones le ganan con margen al mismo gatillo tras un barrido sin ellas:
    la conclusión de antes se mantiene. La mejor (1h, 408 trades, +0.060 R) queda +0.14 sobre el azar, en el borde
    (margen desde +0.00), y +0.09 sobre el tramo con el margen tocando el cero;
  - **de dónde viene el cambio:** sin el tope de la comisión, el motor 6 (F-16, H23, H15 y lo demás) casi no las mueve:
    18,171 trades y −0.419 R por trade guardados, 18,691 y −0.404. El tope (H18) descarta 8,057 señales con la
    comisión de ida y vuelta sobre 0.3 R, sobre todo en 5m y 15m: quedan 11,020 trades y −0.169 R. En la de 5m con más
    trades, de 6,656 a 2,124 y de −0.531 a −0.184 R.
- **Lo que comparte código con el motor y no estaba en el plan:**
  - **La suite** importa módulos y componentes de App 1. En su servidor, 3 de las 40 pruebas de los sabios fallaban con
    el `williams.py` nuevo. `wise_smc_watch.detect` lee la ruptura de fractal con `williams.events()`, y con F-06 esa
    función daba también las órdenes que el precio nunca rompe: en vivo habrían salido como rupturas falsas.
    Corregido: la orden por fractal queda solo para el probador (`events(..., orders=True)`), y la suite recibe lo de
    siempre. Ahora pasan las 13 pruebas de su servidor (40/40 la de los sabios) y las 6 de su página, y la página se
    arma con el App 1 del motor 6 (salida al scratchpad, sin tocar su `dist`).
  - **La Revisión de candidatos:** la caja propia se simulaba con la regla, y desde el motor 6 eso incluía el tope de
    la comisión. Con un stop corto, la decisión se rechazaba con "Ese trade no se pudo simular hasta su salida".
    Corregido: la caja propia no pasa por el tope, se simula con su comisión y con los costos que pida la regla,
    como los trades de la regla. Prueba nueva en `test_candidate_review.py` (9); sin el arreglo, ese caso se rechaza.
  - **El verificador del Gimnasio** (`verificar.py`) nombra el martillo invertido de H22.
- **El oráculo A y sus casos de respuesta conocida:** los 64 casos de B son de la especificación de antes del motor 6.
  Con las reglas nuevas en el oráculo daban 49; con `h4` y `o05` en False (la especificación de antes) vuelven a dar
  53, con las mismas 11 diferencias explicadas en la etapa 2. Casos nuevos a mano para el motor 6
  (`test_oraculo_a_motor6.py`, 6): lo a favor desde el llenado, el alcance de 300 velas, el tope de la comisión, la
  señal de la vela de la salida, el enfriamiento sin trades y las señales opuestas.
- **Capa A con el oráculo al día** (en `evidencia/etapa7/capa_a/`): R04b en BTC 4h f1 (stop en la vela del elemento),
  las 6,077 llamadas y los 75 trades iguales. R07c (ruptura de fractal con orden stop), los mismos 293 trades en BTC y
  60 en ARB; difería solo el alcance de 8 y 3 trades, porque el oráculo medía 299 velas y el motor 300 desde O-05. Con
  el oráculo al día (variante `o05`), las 8,357 llamadas de BTC y las 6,449 de ARB iguales.

### Pruebas adicionales tras la etapa 7 (22 y 23/11)

Antes de limpiar el entorno aislado, el usuario eligió "Las 5 de la copia" y pidió que la galería llevara todos los
elementos: "al terminar las pruebas comienzo a mezclar recetas para encontrar nuevas reglas y necesitamos que todos los
elementos de la galería funcionen bien". Todo en la copia aislada (backend 9300, página 9301), con el motor 6.

1. **Galería de todos los elementos** (`tests/audit/galeria_corridas.py` y `galeria_corridas2.py`, corridas en
   `evidencia/etapa7/galeria_corridas.json`; capturas en `evidencia/pantalla/G_<clave>/`; páginas con
   `galeria_html.py` en `revision_visual/galeria/`). Los 65 elementos del probador, más el rombo como giro y siguiendo
   el tramo y el barrido de liquidaciones de zona y de swing: 67 reglas de un elemento en BTC, fase 1 (4h; 15m para
   order flow, perfil por sesión y liquidaciones), y 12 casos de cada una repartidos a lo largo de la fase.
   - **802 casos** en 5 páginas por familia (velas y cajas 180, VPA 94, Williams y SMC 84, order flow 372 con el
     footprint encendido, perfil y liquidaciones 72). Cada elemento lleva cómo lo calcula la app y qué mirar; cada caso,
     "Sí, es lo que entiendo", "No" o "No sé" y una nota, con un botón que copia las marcas para el chat.
   - **23/11, 4 casos por elemento:** el usuario tardaba mucho y la mayoría se parecían. Quedan 268 (60, 32, 28, 124 y
     24 por página), repartidos en la fase y, si los hay, 2 largos y 2 cortos (`pick()` de `galeria_html.py`; su segundo
     argumento dice cuántos, 0 = los 12). Cada caso conserva su clave entre los 12, así las marcas ya hechas siguen, y
     «Copiar mis marcas» dice el trade de cada caso. Probado en el navegador con marcas de la versión de 12.
   - **23/11, el volumen a la vista:** el usuario no podía juzgar el volumen alto, porque la captura se recortaba bajo
     las velas. Los 48 casos a la vista de los 12 elementos de volumen (volumen alto, flecha, los dos rombos y los 8 del
     VPA) se capturaron otra vez con los paneles (`trade_NNNN_paneles.jpg`, en 4h, 30 velas antes de la señal y 8
     después): la barra de volumen y, en los del VPA, el Lector VPA; en la flecha y los rombos, el Volumen de Respuesta.
     Cada caso lleva al pie cuánto volumen tuvo (`galeria_cifras.py`): el del volumen alto se calcula aparte, con las
     velas de la corrida, y da de 2.0 a 9.3 veces el medio de su hora (ninguno bajo 2); la flecha y el VPA dicen lo que
     guardó su trade (veces la mediana de su hora, rango, medidor y grado). Las 48, sin avisos de la comprobación.
   - Todas las capturas pasan la comprobación automática (la tabla de la señal en ✓, sin avisos). La compresión
     necesita la opción de las dos órdenes stop de la captura (`straddle`), como sus corridas de la etapa 6.
   - **Encuadre:** la primera versión iba de la señal a la salida. En 95 trades largos el elemento quedaba chico, y en
     29 elementos el caso 1 era la primera vela de la fase, pegada al borde (el gráfico no tiene velas antes de la fase).
     Los trades largos se capturaron otra vez centrados en la señal (de 20 a 40 velas antes y 8 después) y los 29 casos 1
     se cambiaron por una señal unas horas o días después: 123 capturas nuevas, todas bien
     (`galeria_cola_recaptura*.json`); los apartados quedan en `G_<clave>/descartadas/`.
   - Fuera: los tres elementos del libro (absorción, barrido del libro y libro delgado): no hay libro en las fechas de
     las fases.
   - **Hallado: O-33** (el contexto del trade repetía la misma corrida varias veces a la vez), corregido. Con sus
     2 pruebas, las del backend quedan en 581 que pasan y las 2 de siempre que fallan; las del protocolo, 294 y las
     11 explicadas (`evidencia/etapa7/backend_pruebas_final.log`).
   - **Falta:** la revisión del usuario.
2. **Casos nuevos del motor 6 en pantalla** (`evidencia/pantalla/E7_R05a_misma_vela/` y `E7_B5_calentamiento/`): con
   R05a (limit), tres pares en que un trade entra en la vela en que salió el anterior, porque su orden se llenó después
   de la salida (52 y 53, 71 y 72, 157 y 158), y el embudo con las señales opuestas y el tope de la comisión en el orden
   del motor. B5 con las velas de antes de la fase (H2): sus dos primeros trades. Todo bien.
3. **Simulación manual y 2.º gráfico** (`evidencia/pantalla/etapa7_pantalla/`): reproducción a 1000x, una orden, los
   indicadores que tocó el motor 6 (Lector VPA, Liquidaciones, Estructura SMC y Tres sabios) y el 2.º gráfico siguiendo
   la hora y dibujando la caja del trade. Bien.
4. **Búsqueda genética corta** (`20261122_222813_a9ef`: 4h, población 10, 2 generaciones, todas las piezas y comprobación
   en las monedas nuevas). Se cortó al reiniciar el backend por O-33 y se retomó desde su última generación. Terminó
   entera el 23/11 a las 00:32: 146 reglas probadas (95 con 50 trades o más) y 3 finalistas con sus vecinas y su
   comprobación en las monedas nuevas. Ninguna candidata (mejor aptitud −0.09): las tres quedan en "No se sostiene
   en la validación". En 2023 la mejor da −0.49 R de ventaja y el promedio de todas, −0.26; en las monedas nuevas,
   de −0.13 a −0.04. Es lo esperable de una búsqueda tan corta: la prueba era que corriera entera con el motor 6.
5. **Tu tablero con el motor 6** (`tests/audit/tablero_etapa7.py`, `evidencia/etapa7/tablero.log` y `tablero.json`): tus
   17 estrategias que llegaron a la fase 2 o 3, corridas otra vez como en la app ("Correr en todas las monedas" por grupo
   y fase). Las 18 celdas de tus veredictos dan lo mismo que la regresión (`veredictos_*.json`): 0 distintas. Pasan solo
   B5 en las fases 1 y 2 de las monedas de siempre. El tablero de la copia lleva también las reglas de prueba del
   protocolo (con "PRUEBA" en el nombre), que no están en tu registro. Ojo al guardarlo: el tablero resume las corridas
   nuevas en segundo plano ("Resumiendo las corridas guardadas…"), y la primera copia de `tablero.json` se tomó con 29
   sin resumir (solo cortos, f1 nuevas, con 14 monedas); se volvió a guardar al terminar.
6. **E-02 y E-08, medidos para decidir** (`tests/audit/medir_e02_e08.py`; la tabla, en
   `evidencia/etapa7/e02_e08/RESUMEN.md`). Cada lectura se probó con el motor 6, cambiada solo dentro de la prueba; en
   la del motor, los eventos dieron lo mismo que la función original. Ninguna estrategia del usuario usa VF ni BE.
   - **E-02** (VF en la primera vela de la sesión): con el cierre de la vela anterior, en la fase 1 de BTC, ARB y ETH
     (15m, sesiones de un día) salen 3 señales más de 12,340 y cambian 5 trades de 3,174 (R por trade de −0.173 a
     −0.172). En las fases 2 y 3 de BTC y en el VF semanal, nada. Da lo mismo.
   - **E-08** (borde de caja): gastar la llegada solo al dar un evento da 2.3 veces las señales, y contar cada vela que
     pasa los filtros, 5.3 veces. En ninguna lectura, fase ni grupo pasa el borde. Con el objetivo al centro de la
     caja, las otras dos quedan peor que la del motor en las 6 celdas (de −0.01 a −0.12 R por trade); a mercado con 3R,
     mejor en 2 o 3 y peor en las demás, casi siempre dentro del margen (en la fase 2 de las de siempre, −0.17 contra
     +0.02).
7. **El «pasa» del tablero en la búsqueda genética** (`tests/audit/medir_busqueda_pasa.py`,
   `evidencia/etapa7/busqueda_pasa.json`): las 18 finalistas de cuatro búsquedas guardadas, con el motor 6 y el
   evaluador de la búsqueda (las 7 de siempre, la fase 1 partida en 2023), sin mirar las vecinas.
   - De las 14 que fueron candidatas, con el criterio de hoy (en 2023, sobre el mejor de los dos controles) siguen 7.
     Pidiendo en 2023 ganarles a los tres controles del tablero, también 7: sale una y entra otra. Pidiendo además su
     margen, ninguna: en 2023 hay de 85 a 423 trades, y en las búsquedas por promedio el margen de la ventaja va de
     ±0.17 a ±0.31 R.
   - La aptitud con los tres controles y el margen por semanas queda cerca de la de hoy (de 0.12 menos a 0.10 más) y casi no
     cambia el orden de las finalistas.
   - Con el motor 6, la aptitud de B5 (la finalista 5 de la búsqueda del 20/11) pasa de +0.10 a −0.07: la búsqueda la
     mide antes de 2023 y contra el mejor de los dos controles de cada moneda; el tablero, en toda la fase. En el
     tablero sigue pasando las fases 1 y 2.
8. **Decidido el 23/11 con el usuario:** E-02 y E-08 quedan como están. La búsqueda genética elige y juzga con los tres
   controles del tablero y el margen por semanas, y la validación pide el margen solo con la casilla "En la validación,
   pedir también el margen" (apagada de fábrica): el usuario prefirió no descartar reglas que podrían mejorarse.
   Pruebas: `test_rule_search.py` suma 3 (9).
9. **Galería 1 revisada por el usuario (23/11):** Sí 38, No 20, No sé 1 y 1 sin marcar de 60
   (`evidencia/etapa7/galeria_marcas_1.txt`). Cada caso se revisó con los datos de su corrida, repetida en la copia
   aislada (`revision_visual/G1_RESPUESTAS.md`):
   - dos fallos del motor: F-18 (ruptura tras una caja que termina por su eficiencia) y F-19 (rearme del borde de caja);
   - uno de pantalla, O-34 (las cajas de los elementos tapan la mecha), y el extremo del cambio de carácter (F-20);
   - O-35, O-36 y tres puntos a precisar (E-17 a E-19);
   - lo demás son diferencias de concepto que decide el usuario: los patrones de velas (tamaño y swing), el rombo del
     volumen de respuesta, el swing del cambio de carácter, el margen de la ruptura y el ancho del borde de caja.
   Los fallos del motor van juntos en un motor nuevo al terminar las cinco galerías.
   **Decidido la misma noche:** los patrones de velas, solo en un swing confirmado y con tamaño; el rombo, solo
   cuando sube la respuesta; la ruptura de caja, con el primer cierre afuera; el borde de caja, con el 5% de la caja
   (todo al motor nuevo). El cambio de carácter se le explica otra vez. O-34 se corrigió y las cinco galerías se
   capturaron otra vez (268 casos).
10. **Motor 7 (24/11):** el cambio de carácter rompe el swing que originó el tramo, con la tendencia confirmada por
    cierres (respuestas del usuario a la pregunta 3 y al trade 71), y el Gaussian Channel 42 quedó bien. Con lo decidido
    antes, el motor 7 cambia los patrones de velas, el rombo (también en el indicador y en la investigación del Volumen
    de Respuesta, con la paridad en 0), la ruptura y el borde de caja y el cambio de carácter, y corrige F-18, F-19 y
    F-20. Solo deja fuera las corridas que usan algo de eso. Detalle en el CLAUDE.md de App 1, "Motor 7". Los 8
    elementos se corrieron con el motor 7 en la copia aislada (`tests/audit/galeria_corridas_m7.py`) y volvieron a la
    galería 1 con casos nuevos.
11. **Galería 2 (Lector VPA) revisada por el usuario (24/11):** Sí 16, No 12 y No sé 4 de 32
    (`evidencia/etapa7/galeria_marcas_2.txt`). Cada caso se revisó con los datos de su corrida
    (`revision_visual/G2_RESPUESTAS.md`):
    - sin fallos del motor;
    - la causa de casi todos los "No": el volumen alto se mide contra su hora, y el usuario lo compara con las velas de al
      lado. Una vela de una hora tranquila puede tener mucho volumen para su hora y menos que casi todas sus vecinas;
    - en la prueba de poco volumen falta el contexto: el usuario la espera después de una consolidación, y las cuatro
      caen en tramos fuertes;
    - dos lecturas: en la ruptura con volumen la regla sí entró donde el usuario quería (trades 102 y 143), y el medidor
      75 sí cruzó el umbral;
    - O-37: el panel del lector, muy bajo en las capturas, y la caja del elemento sobre la mecha.

    Siete propuestas, medidas en BTC 4h fase 1 con una copia del lector que tiene cada una como opción (sin ellas da las
    mismas 1,420 señales):
    - volumen alto también frente a las 20 velas anteriores;
    - el esfuerzo sin resultado, no después de una vela ancha;
    - la prueba, dentro de una consolidación y después de un clímax o un frenado de su lado;
    - el frenado, con mecha de media vela;
    - el retroceso, con una vela que vuelve;
    - dos elementos nuevos: el medidor que gira y el esfuerzo con resultado.

    **Decidido el mismo día: "Sí, todas".** Van al motor 7, en `vpa.py` y `vpa.js`, iguales al bit:
    - cada propuesta es un parámetro, y con los valores de antes salen los mismos 1,488 elementos del motor 6;
    - el medidor no cambia;
    - en BTC 4h fase 1: el esfuerzo sin resultado pasa de 197 a 29, la prueba de 430 a 10, el frenado de 75 a 30 y el
      clímax de 44 a 18; el esfuerzo con resultado da 650 y el medidor que gira, 174.

    Los 8 elementos se corrieron otra vez en la copia aislada y vuelven a la página 2 con casos nuevos, el panel alto y
    sus cifras al pie (O-37). Los 4 casos del cruce del medidor se capturaron otra vez. Detalle en
    `revision_visual/G2_RESPUESTAS.md`, "Lo que decidió el usuario y lo que se hizo".

    **Pruebas:**
    - `test_motor7.py` suma 7 (16) y su prueba de las corridas que quedan fuera;
    - `test_vpa.py` (11), al día;
    - la paridad `vpa.parity.test.mjs` (12) compara el lector nuevo y el de antes. Además se comparó con las velas
      reales de BTC 4h: 1,601 elementos y todas las lecturas, iguales.

    Todas las del backend: 940 pasan. Fallan las 2 de siempre y las 11 diferencias ya explicadas del oráculo A con los
    casos de B (`test_oraculo_a_casos.py`).

    **Después, el caso 2 del esfuerzo sin resultado (24/11).** El usuario dijo que la vela del 17/04/21 sí tuvo
    resultado: 10 veces su rango normal y 20 veces su volumen, con cuerpo grande. Es esfuerzo con resultado. Va al
    motor 7 con el parámetro `wideResult`:
    - el esfuerzo sin resultado no cuenta en una vela ancha, contra su hora y contra las 20 anteriores, la misma medida
      de `skipAfterWide`;
    - el esfuerzo con resultado es la vela ancha con volumen alto, sin pedir que el rango siga al volumen;
    - el medidor no cambia.

    En BTC 4h fase 1, el esfuerzo sin resultado pasa de 29 a 25 y el esfuerzo con resultado, de 650 a 1,066.

    Las dos corridas de la galería se repitieron (21 y 305 trades):
    - las velas que ya eran caso conservan su clave y, con ella, la marca del usuario (`keys` en
      `galeria_corridas_m7.json`);
    - los casos nuevos llevan claves nuevas;
    - la vela del 17/04/21 es ahora un caso del esfuerzo con resultado.

    Detalle en `revision_visual/G2_RESPUESTAS.md`, "El caso 2 del esfuerzo sin resultado".

    **Pruebas:**
    - `test_motor7.py` suma 1 (17);
    - la paridad `vpa.parity.test.mjs` (12) mira también que ningún esfuerzo sin resultado caiga en una vela ancha;
    - con las velas reales, el navegador y el backend dan los mismos 2,027 elementos;
    - todas las del backend: 941 pasan y fallan las mismas 13. La del oráculo con la salida VPA ya fallaba con el valor
      de antes.

    **Y el medidor (24/11).** El usuario pidió que el medidor lea igual la vela ancha con volumen alto: «Sí, también el
    medidor». Va con el parámetro `wideMeter`:
    - en esa vela, el medidor ya no suma el esfuerzo sin resultado, contra su color;
    - le suma como esfuerzo con resultado, a favor, con el grado del elemento;
    - en las demás velas no cambia.

    En BTC 4h fase 1:
    - suma distinto en 529 de 8,076 velas y cambia de lado (±0.3) en el 6.4%;
    - el cruce del umbral pasa de 244 a 247 (76 salen y 79 entran) y el giro, de 174 a 183;
    - la vela del 17/04/21 ya no sube el medidor: lo baja de +0.28 a −0.29;
    - el caso 75 del cruce, un «No» del usuario, ya no es un cruce.

    Quedan fuera, además, las corridas con el cruce del umbral, el filtro del medidor (también leído en un marco mayor)
    o la salida por el medidor.

    La galería:
    - el cruce y el giro se corrieron de nuevo, con las claves de sus casos de antes (el cruce, con las de su página
      anterior: `QE_BEFORE` en `galeria_corridas_m7.py`);
    - todos los casos del lector se capturaron otra vez con el medidor nuevo. Las capturas de antes quedan en
      `antes_medidor`.

    Detalle en `revision_visual/G2_RESPUESTAS.md`, "El medidor también lee así la vela ancha".

    **Pruebas:**
    - `test_motor7.py` (17) y la paridad (12), al día;
    - con todos los valores de antes, el medidor es el del motor 6;
    - con las velas reales, el navegador y el backend dan los mismos 2,037 elementos;
    - `test_vpa.py`, `test_observer.py` y `observer.test.mjs` pasan;
    - todas las del backend: 941 pasan y fallan las mismas 13.
12. **Galerías 3 a 5: lo que faltaba en las capturas (25/11).** En la galería 3 el usuario vio que el 2.º sabio no traía
    el AO: «Revisa también si hay otras imágenes que les haga falta los indicadores que se necesitan para el análisis y
    corrígelos de una vez». Se revisaron los 31 + 7 + 6 elementos de las tres páginas (O-38 en `DEFECTOS.md`):
    - **Williams y SMC:** el AO quedaba fuera del recorte en el 1.º y el 2.º sabio (la barra divergente también lo pide,
      en rojo o en verde). Sus 8 casos se capturaron otra vez con los paneles y el AO alto. La ruptura de fractal y los
      cuatro del SMC ya mostraban lo suyo sobre las velas.
    - **Order flow:** faltaba casi todo. El footprint iba con unos 10 niveles por vela y sin cifras, y los elementos se
      calculan con el step de análisis (`of_elements.analysis_step`: de 1 a 10 USD en BTC 15m, según el precio), así que
      la celda que nombra el elemento no se veía. La tabla de la vela y el volumen quedaban fuera del recorte, y no se
      sabía cuánto daba el elemento contra su umbral relativo. Los 124 casos se capturaron otra vez
      (`tests/audit/galeria_of.py cola`, `capa_bc.js` con `opts.of`):
      - el footprint, con el step de análisis de la vela de la señal, y los desequilibrios del elemento (diagonal de 4 a 1)
        solo en los que los usan;
      - los Elementos OF, solo con el código del elemento;
      - abajo, el volumen y la tabla de la vela;
      - en los 16 elementos de celdas, una imagen de cerca: la zona del elemento ampliada, con las cifras de cada celda y
        un marco azul en las suyas;
      - al pie (`galeria_of.py cifras`), el valor contra su umbral, o el volumen contra la mediana de las 20 anteriores en
        los de vela de mucho volumen.

      En 8 de los 124 casos el servidor dibujó las celdas más grandes: alguna vela de lo pedido pasaba de 200 niveles
      (`footprint_store.MAX_LEVELS_PER_CANDLE`). Dos son de elementos de celdas: el apilado 773 y el Thin Print 3823,
      también de cerca.

      Después de O-39 se capturaron otra vez los 28 casos de esos 7 elementos con el tope por vela (`stepPerCandle` en
      `capa_bc.js`). Quedan 4 con las celdas agrupadas en múltiplos redondos: el hueco 526, el apilado 773 y el Volume
      Imbalance 843 y 1264. En ellos la vela misma de la señal pasaría de 200 niveles con las celdas del elemento, y el
      pie lo dice. Los demás, con el Thin Print 3823 y el barrido real 157, van con las celdas del elemento.

      De cerca, el ayudante vuelve a poner esas celdas después de desmarcar la casilla del contexto: desde O-39,
      desmarcarla devolvía el footprint a sus celdas automáticas.
    - **Perfil y liquidaciones:** el regreso al valor, el fallo y el extremo del valor se encuadran con el área de valor
      entera (`opts.fit`; el fallo, con el borde que pasa y el POC). En el regreso al valor se cortaban su objetivo, el
      borde contrario, y el POC. Las capturas de antes quedan en `antes_valor/`. Las liquidaciones ya mostraban sus
      zonas.
    - **Hallado en el ayudante de las capturas:**
      - el Historial lista solo las 200 corridas más recientes de la moneda, y las de la galería del 22/11 ya habían
        quedado fuera (O-40). `openRun` las abre ahora con el `loadRun` de la ventana;
      - con el panel del navegador oculto, `drawChart` deja a `requestAnimationFrame` un cuadro pedido a menos de 33 ms,
        y la escala se leía del dibujo anterior: una imagen de cerca salió ampliada en otro precio. `drawn()` pide dos
        dibujos separados antes de leerla;
      - de cerca, la etiqueta de la zona del trade elegido tapaba las cifras de su celda. Esa imagen va sin las franjas
        del trade, sin lo que dibuja la regla y sin la marca de los Elementos OF.
    - **O-39, corregido el mismo día** (el usuario dijo «Sí, hazlo»): en la app, el trade elegido de una regla de order
      flow no encendía el footprint ni los Elementos OF, y el footprint no usaba las celdas del elemento. Ahora:
      - los enciende;
      - el footprint va con el step de análisis del día de la señal, que da el contexto del trade;
      - el tope de 200 niveles es por vela (`step_cap=candle`). Antes una vela ancha subía el step de todas: en el
        trade 559 del Zero Print, las 162 velas salían con 2.5 en vez de 2. Ahora 161 van con 2 y la ancha, con 4;
      - los Elementos OF van solo con los de la regla.

      Detalle en el CLAUDE.md de App 1, «Los de order flow (25/11, O-39…)».
    - **Hallado al probarlo, O-41:** desde el motor 6 la ventana no abría la corrida de la dirección (`&run=`): el id
      termina en 4 cifras hexadecimales (O-28) y se pedían solo dígitos. Corregido (`isRunOf`).
    - Cada caso conserva su clave: las marcas del usuario siguen.

### Etapa 3 · R02, R03 y R06 a R15 (capa C, ARB salvo R02, R03 y R12)

| Regla | Qué prueba | Trades | Revisión | Hallado |
|---|---|---|---|---|
| R02 (BTC 15m) | R01 en 15m, con minutos (E-08) | 4,610 | 4,610 de 4,610 (capas A, B y C; hojas revisadas por cinco agentes) | H11 |
| R03 (DOGE 4h) | R01 en una moneda nueva, sin minutos | 139 | 139 de 139; capa B 139 = 139 y repetida igual | |
| R06a/b | compresión con dos órdenes stop | 15 + 26 | 41 de 41 | O-04 |
| R07a/b/c | los sabios con orden stop | 1 + 53 + 61 | 115 de 115 | |
| R08a–h | las salidas, de a una y en carrera | 470 | 470 de 470 | |
| R09a/b/c | objetivo arrastrado | 186 | 186 de 186 | E-01 |
| R10 | objetivo mixto con la emisión de stablecoins | 31 | 31 de 31 | |
| R11a/b | salida VPA | 83 + 56 | 139 de 139 | |
| R12 (BTC 1D) | canal gaussiano | 4 | 4 de 4 | O-06 |
| R13a/b/e | perfil por sesión: VR, VF y VF semanal | 54 + 605 + 124 | 783 de 783 | O-07, E-02, H18 |
| R13c/d | borde de caja al centro, order block al rango SMC | 15 + 9 | 24 de 24 | O-08 |
| R14a/b/c | todas las señales, enfriamiento, limits del rango | 114 + 40 + 49 | 203 de 203 | **F-01** |
| R15a–i | la receta: misma vela, al menos 2, secuencias, solo largos, invertida, extremo, momentum y confirmación | 240 | 240 de 240; señales recalculadas iguales en las 9 | E-03 (la separación de H3) |

Informes por regla en `revision_visual/`. Desde R11 cada regla lleva además una comprobación aparte de su pieza:
`vpa_exit_check` (contra `vpa.js`), `chain_check`, `gc_check`, `vp_check` (perfil, forma, VR, VF y VE),
`smc_box_check` (contra `smcStructure.js` y `regimeDetectors.js`) y la selección de R14b repetida desde R14a. Todas
dieron lo mismo que el motor salvo lo anotado. Desde R13 las capturas se revisan en hojas de contactos
(`tests/audit/hoja.py`) y la comprobación de cada una sale de `batch` del ayudante.

### Herramientas (etapas 2 y 3)

- `backend/tests/audit/`: `oraculo.py` (oráculo A: ciclo del trade desde la especificación, ATR propio y lector propio de los minutos del almacén), `comparar.py` (captura cada llamada a `simulate` del motor y la repite con los oráculos), `correr_capa_a.py`, `correr_api.py` (corre una regla de prueba en el 9300), `reglas_prueba.py`, `capa_bc.js` (en la página: elige cada trade, lee el detalle, encuadra y amplía el gráfico), `receptor.py` (9399: guarda en la evidencia lo que manda la página), `comparar_capa_b.py`, `etapa1_datos.py` y `bybit_api.py`.
- `pruebas_backtesting/ESPECIFICACION_CICLO_TRADE.md`: contrato para el oráculo B, que escribe un agente aparte sin ver el motor (en curso).

### R01 · FVG nuevo ≥ 0.3 ATR · a mercado · stop 1.5 ATR · 3R (E-01)

- **BTC 4h fase 1 (capa A):** 266 trades, +0.305 R. Oráculo A = motor en las **6,267 llamadas** (267 de la regla, 3,000 del azar y 3,000 del tramo), en todos los campos. ATR idéntico. La selección de "una posición a la vez" da los mismos 266.
- **ARB 4h fase 1** (corrida `ARBUSDT_240_f1_40c4a72fd708687c_1795304688`, 54 trades, −0.069 R):
  - capa A: 6,055 llamadas sin diferencias; selección 54 = 54;
  - capa B: **54 de 54** detalles leídos de la pantalla iguales a la corrida; la tabla de la señal dice "se cumplía todo" en los 54;
  - I-10: corrida otra vez desde cero, los mismos 54 trades;
  - capa C: **54 de 54 capturas revisadas, todas bien** (`revision_visual/R01_ARBUSDT_f1.md`). Observación **O-01**: la línea punteada de la salida tapa la mecha de la vela de la salida.
- Variantes H4, H5, H12 y objetivo en la vela del llenado: no cambian nada a mercado (esperado).

### R01 · SUI 4h fase 1 (sin almacén)

- Corrida `SUIUSDT_240_f1_bacb7aa3a3d52f71_1795305654`, 38 trades, +0.45 R, una abierta al final de la fase (no cuenta, H6).
- Capa A: 6,039 llamadas sin diferencias; selección 38 = 38. Capa B: 38 de 38 iguales y repetida desde cero, la misma.
- Capa C: 38 de 38 bien (`revision_visual/R01_SUIUSDT_f1.md`). El trade 35 es el caso más claro de O-01.
- Capa A también en DOGE (139 trades, 6,140 llamadas): sin diferencias.

### R02x · FVG ≥ 0.3 ATR · stop 0.5 ATR · objetivo 1R (velas dudosas a propósito, E-01 y E-08)

- **ARB 4h fase 1** (`ARBUSDT_240_f1_06704c1ccd50d290_1795305707`, 104 trades, −0.022 R): 72 salen en la vela de la
  entrada y **10 se resuelven minuto a minuto** (6 al objetivo y 4 al stop).
  - capa A: 6,104 llamadas sin diferencias, con el minuto a minuto; selección 104 = 104;
  - capa B: 104 de 104 iguales; repetida desde cero, la misma;
  - capa C: **104 de 104 bien** (`revision_visual/R02x_ARBUSDT_f1.md`); el 96 es una vela dudosa que pasa el stop por
    0.00004 y el minuto a minuto da el objetivo primero.
- **SUI 4h fase 1** (`SUIUSDT_240_f1_c8183a9dee2ca0e5_1795305708`, 84 trades, +0.043 R): **14 velas dudosas** resueltas
  por el recorrido supuesto (6 al stop y 8 al objetivo), todas como dice la regla del recorrido.
  - capa A: 6,084 llamadas sin diferencias; capa B: 84 de 84 y repetida igual; capa C: **84 de 84 bien**
    (`revision_visual/R02x_SUIUSDT_f1.md`).
- Desde el trade 9 de SUI cada captura lleva una comprobación automática con las velas del gráfico (`autocheck` en
  `capa_bc.js`): apertura, toques antes de la salida, toque en la vela de la salida y vela dudosa.

### R04 · los cuatro stops y sus topes (E-02) y R05 · limit en la zona (E-03), capa A en BTC 4h fase 1

| Regla | Trades | R medio | Llamadas | Motor = oráculo A |
|---|---|---|---|---|
| R04a swing 5 | 37 | −0.044 | 6,056 | sí |
| R04b vela del elemento | 432 | −0.026 | 6,433 | sí |
| R04c borde lejano de la zona | 197 | +0.149 | 6,198 | sí |
| R04d 8 ATR con máximo 6 | 0 | — | 702 | sí (las 702 señales, "stop muy largo") |
| R04e swing con mínimo 1 y máximo 2 ATR | 40 | −0.153 | 6,589 | sí |
| R05a limit cercano, vence en 8 | 217 | +0.241 | 6,702 | sí |
| R05b limit en la mitad | 202 | +0.018 | 6,702 | sí |
| R05c limit lejano | 172 | −0.124 | 6,702 | sí |
| R05d invertida, limit cercano | 299 | −0.162 | 6,702 | sí |
| R05e limit, trailing 2 ATR desde 1R, stop a la entrada en 1R, 48 velas | 350 | +0.044 | 6,702 | sí |

Medición de las decisiones de diseño con las variantes del oráculo (el motor no cambia):
- **H5** (limit llenada en la apertura si la vela abre más allá; objetivo saltado sale en la apertura): cambia 1 trade en
  R05a, R05b y R05c, +1.47, +1.62 y +1.76 R. La regla del motor es la conservadora.
- **H4** (en la vela del llenado, lo "a favor" y "en contra" solo con los precios después del llenado): el motor usa
  toda la vela del llenado para arrancar el trailing y el stop a la entrada, y puede usar precios de antes del llenado.
  Afecta a la regla con limit y no a sus controles al azar (que entran a mercado, en la apertura). Contado sobre los
  trades que quedan (`medir_h4.py`): R05e BTC **21 de 350, −0.36 R** (+0.044 → +0.043 R por trade); R05e ARB **3 de
  57, −1.01 R** (−0.003 → −0.021); R05b ARB, ninguno. (La primera cuenta, 27 y −3.46 R, era de las 702 señales
  simuladas, también las que no quedaron.) Va al informe como decisión H4.

### R04 y R05 en ARB 4h fase 1 (capa C: cada trade en pantalla)

| Regla | Corrida | Trades | R medio | Capa C | Notas |
|---|---|---|---|---|---|
| R04a swing 5 | `…5bd24a27e6eacf3d_1795307342` | 17 | −0.542 | 17 de 17 bien | trade 1: arranque en frío de la fase (H2) |
| R04b vela del elemento | `…7901f5b2c61cc5f0_1795307343` | 77 | +0.14 | 77 de 77 bien | el stop es solo la tercera vela del FVG (H16) |
| R04c borde lejano | `…0bcce60e8c4459ce_1795307345` | 47 | −0.104 | 47 de 47 bien | |
| R04e swing, mínimo 1 y máximo 2 ATR | `…7c7a70112129a5d1_1795307347` | 6 | +0.292 | 6 de 6 bien | los topes descartan la señal (H17) |
| R05a limit cercano | `…8b0d176198760b8c_1795307349` | 48 | −0.272 | 48 de 48 bien | |
| R05b limit en la mitad | `…3cea930800af0972_1795307350` | 40 | −0.222 | 40 de 40 bien | H4 en pantalla (trade 2); O-02 |
| R05c limit lejano | `…ac7c33d6884d2c8a_1795307352` | 34 | −0.201 | 34 de 34 bien | |
| R05d invertida, limit cercano | `…0664e60ef4f3509c_1795307354` | 48 | −0.115 | 48 de 48 bien | todas a mercado (H14); trade 43 dudosa, al stop con minutos |
| R05e limit, trailing, stop a la entrada, 48 velas | `…926ece82eb63df9c_1795307355` | 57 | −0.003 | 57 de 57 bien | trailing recalculado igual en 54; los otros 3 salen en la vela del llenado, bien con minutos; H4 en pantalla (trade 2) |

Informes por regla en `revision_visual/`.

**Capa B de las nueve** (`comparar_capa_b.py`, `evidencia/capa_b_r04_r05_arb.log`): lo que la pantalla dijo de cada
trade (374) es igual a la corrida guardada, y cada corrida repetida desde cero da los mismos trades.

**Hallado al revisar R05d (21/11, ~20:00):**
- **H14:** con la regla invertida, la limit en la zona del elemento siempre queda del lado contrario y entra a mercado;
  cercano, mitad y lejano dan los mismos 48 trades (`medir_invertida_limit.py`). La pantalla dice "limit".
- **H15:** "una posición a la vez" se cuenta distinto a mercado y con limit. A mercado se salta la señal de la vela en
  que salió el trade anterior; con limit (o stop, o dos órdenes) no. La invertida con limit y la invertida a mercado
  dan 48 y 41 trades en ARB (299 y 278 en BTC), y son iguales trade por trade cuando la de mercado se cuenta como la de
  limit (`medir_ocupada.py`, copia del motor en memoria). En R01, las siete monedas, 4h fase 1: 1,016 trades contra
  1,079 (+6%), +0.259 contra +0.254 R por trade. En pantalla: R04b ARB, trade 19 (entra y sale en la vela del
  02/06/23 08:00 UTC; la señal de esa vela sale "posición abierta").
- Las dos van a DEFECTOS con H16 y H17 (las preguntas de diseño de R04b y R04e).
