# Protocolo de pruebas del backtesting global (App 1)

**Estado:** propuesta para aprobación, 21/11/2026. Todavía no se ha corrido nada.
**Código que se prueba:** el de App 1 en `main` 507fe341 (motor 4), el mismo que corre tu backend en el 9000.
**Especificación que se usa:** `GUIA_PRUEBAS_REGLAS.pdf`, `CHEQUEO_PRUEBAS_REGLAS.xlsx` (100 pasos, 104 controles y 43 confusiones), `GUIA_PRUEBAS_ORDER_FLOW.pdf`, `GUIA_VPA.pdf` y la sección "PROBADOR DE REGLAS DEL OBSERVADOR" de `Backtester/CLAUDE.md`.

---

## 1. Objetivo

Comprobar con datos reales, y de forma que se pueda repetir, que:

1. cada pieza que se elige en la regla hace en la simulación lo que dice la pantalla;
2. cada trade entra en la vela correcta y al precio correcto, y sale por el primer evento que de verdad ocurrió;
3. nada usa datos que todavía no existían al decidir. En la app a esto se le ha llamado "sesgo de supervivencia": ver un patrón antes de que exista. También se mide el sesgo de supervivencia clásico: un universo de monedas que solo tiene a las que sobrevivieron;
4. el R de cada trade y cada cifra de los informes salen de cuentas correctas;
5. los dos controles al azar son una comparación justa.

Hasta que el protocolo pase, conviene leer los resultados de las estrategias con reserva.

**Lo que ya muestra el trade elegido no basta.** Esa vista sale del mismo motor que simuló la corrida: `trade_context()` repite la regla con `run(..., trace)`. Confirma que la pantalla y el motor dicen lo mismo, pero no que el motor tenga razón: si un elemento estuviera mal calculado, el gráfico lo dibujaría igual de mal. Por eso este protocolo agrega una fuente de verdad aparte, el oráculo (sección 5).

Los indicadores del gráfico escritos en JavaScript sí son otra implementación y sirven de segunda opinión visual: Williams, SMC, VPA, patrones, régimen y Volumen de Respuesta.

## 2. Alcance

**Entra:**

- la pestaña Regla completa:
  - los 65 elementos: 31 de order flow y 34 del probador;
  - los filtros;
  - las cuatro entradas y los cuatro stops;
  - todas las salidas;
  - la detección: todos, al menos N, en secuencia, ventana, lado, invertir, extremo, momentum y confirmación;
  - la operación: una posición a la vez y enfriamiento;
- la simulación: llenados, vela dudosa con minutos o con el recorrido supuesto, huecos y comisiones;
- los dos controles: entradas al azar y seguir el tramo al azar;
- los informes: Resumen, Trades, Patrones, Contra el azar, Como cuenta, Sensibilidad, Todas, Estrategias, Historial y CSV;
- las fases y su candado;
- el gráfico del trade elegido;
- los tres grupos de monedas (las 7 de siempre, las 43 nuevas y las 99 acciones) y los seis marcos (5m, 15m, 30m, 1h, 4h y 1D).

**Solo en lo que comparten con el motor:** la Búsqueda genética (su control y "Cargar en la pestaña Regla"), la Revisión (la caja propia) y el Régimen (el filtro).

**No entra:** la simulación manual, el 2.º gráfico, Mis órdenes y la suite.

## 3. Lo que encontré al leer el código

Son hipótesis concretas. Cada una tiene su prueba en este protocolo; ninguna está medida todavía.

| ID | Qué pasa | Dónde | Por qué importa | Prioridad |
|---|---|---|---|---|
| H1 | **El azar no copia todos los filtros.** Copia el régimen, los de flujo (CVD, OI, multitud, OI sostenido, on-chain), los de Williams y SMC, y el medidor VPA. No copia VWAP ni EMA, la forma de la señal (extremo, momentum, confirmación), el horario, las medidas ni el hueco de la VA. Tampoco sale por la señal contraria (confusión 2, confirmada). | `_sided()` y `_baseline()` en `rule_tester.py` (1700 y 2156) | 1,141 de tus 1,861 corridas (61%) usan VWAP o EMA. En ellas, la "ventaja contra el azar" mezcla la señal con el filtro de tendencia. | Alta |
| H2 | **Arranque en frío en cada fase.** Las velas de cada corrida empiezan el primer día de la fase (salvo el canal gaussiano en 1D). La EMA, el VWAP, el tramo, el régimen, Williams, SMC y VPA se calculan desde cero en cada fase. La EMA 200 no existe en las primeras 200 velas (33 días en 4h) y después parte del primer cierre de la fase: tarda cientos de velas en ser la EMA 200 que muestra un gráfico. | `detect_span()` (728 y 745) y `_line()` (1382) | Se pierden señales al inicio de cada fase y cambian otras. Pesa más en la fase 3, la más corta (506 días en BTC). | Alta |
| H3 | **La ventana se gasta con señales que no pasan los filtros.** `match_recipes` salta las `ventana − 1` velas que siguen a una coincidencia antes de que el probador mire los filtros (VWAP o EMA, flujo, régimen, Williams, SMC, VPA, horario y medidas). Una señal válida en esas velas se pierde. | `of_setups.py` (152) contra `run()` (1929 a 1971) | Afecta a las reglas con ventana de 2 o más, como la B5 (FVG o doji en 2 velas) y la de los sabios (10 velas). | Alta |
| H4 | **La vela del llenado de una limit.** "A favor" cuenta el máximo de antes del llenado, y con ese valor se activan el trailing y el stop a la entrada. El stop puede moverse por un precio que ocurrió antes de entrar (amplía la confusión 38). | `simulate()` (1171, 1184, 1217 y 1224) | Cambia el R de los trades limit con trailing o con stop a la entrada. | Media |
| H5 | **Llenados del lado pesimista.** Una limit en una vela que abre más allá de su precio se llena en su precio, no en la apertura. Un objetivo saltado por la apertura sale en el objetivo. | `simulate()` (1011 y 1181) | Pequeño, y siempre en contra de la regla. Se mide. | Baja |
| H6 | **Censura al final de la fase.** Un trade abierto al final de la fase no cuenta. Fue una decisión mía del 17/11 que no se discutió contigo. Los que más quedan abiertos son los largos, como los de trailing sin objetivo. | `run()` (1995) | Puede quitar justo los mejores (o los peores) trades de cada fase. | Media |
| H7 | **Monedas sobrevivientes.** Las 43 nuevas son las de más volumen **hoy** entre las que cotizaban antes de 2022. No hay ninguna que Bybit dejó de listar (por ejemplo LUNA, que se hundió en mayo de 2022). Las 99 acciones son también las de hoy. | `candles_update.py --pick` | Infla lo que sale en las monedas nuevas, sobre todo en largos. | Media |
| H8 | Una entrada por orden stop se muestra como "mercado" en el detalle del trade (confusión 16, confirmada). | `RuleTesterApp.jsx` (2020) | Confunde al revisar. | Baja |
| H9 | **Las fases 2 y 3 no miran la versión del motor.** Se reusan por regla exacta: tras una corrección que cambia resultados, una corrida guardada de esas fases no se rehace, salvo que `_stale()` la marque. | `gate()` (2883) y `_stale()` (2496) | Define cómo se aplica cada corrección (sección 14). | Alta |
| H10 | **El margen supone trades independientes.** En "Todas" se juntan monedas que se mueven a la vez: el margen real es más ancho. | `_edge()` y `consolidated()` | Una regla puede "pasar" con un margen que no tiene. | Media |
| H11 | **Las velas de la regla no son las del gráfico.** En las monedas con almacén, la regla usa velas armadas con los trades: su apertura es el primer trade. El gráfico muestra las velas oficiales de Bybit: abren en el cierre anterior y sus extremos incluyen ese precio. Además, del 22/10 al 05/12/2021 el archivo de trades de BTC tiene 1.48% menos volumen que las velas oficiales. | `footprint_store.minutes()` y el caché de la ventana | En la revisión visual, la entrada y los toques pueden diferir un poco de lo que se ve. Los elementos de volumen y el CVD de esos 45 días quedan cortos. | Media |
| H12 | **Vela dudosa con minutos incompletos.** Si los minutos de una vela no llegan a su máximo o mínimo, una vela que tocó el stop puede no contarlo. Puede pasar en 1D (velas oficiales con minutos del almacén) y en las tres acciones con minutos. | `simulate()` (1148 a 1170) | Ignorar un stop tocado infla el resultado. | Media |

Además, las 43 confusiones de la hoja Confusiones (41 por comprobar) entran como pruebas C-01 a C-43 (sección 9.9).

## 4. Entorno de prueba

Todo en una **copia aislada**, para no tocar tu registro, tu tablero ni tus candados de fase.

- **Backend** en el 9300 (o el primer puerto libre), con el código de este worktree y el Python del `.venv` de tu copia principal, y además:
  - `ORDERFLOW_OBSERVER` apuntando a una carpeta de prueba con una **copia** de tu registro del probador (`runs.jsonl`, `runs/`, `cache/` y `search/`) y de `measures/`, unos 240 MB. Así se repiten tus corridas sin cambiar las tuyas;
  - `TESTER_AUTO_UPDATE=0`, para no lanzar otra actualización de velas sobre `OrderFlowData`;
  - `PYTHONIOENCODING=utf-8` y `PYTHONUTF8=1`.
- **Página** en el 9301: Vite con un proxy de `/api` al 9300.
- **Datos** de `OrderFlowData` (almacén, velas, OI, funding y on-chain) en solo lectura.
- **Navegador integrado** a 1366×768, tu pantalla, con el estilo Nítido.
- **Fases 2 y 3:** solo se corren en la copia. De las reglas de prueba en esas fases informo si la mecánica funciona, no su R: así no te llega información de datos frescos que pueda influir en tus estrategias.
- **Antes y después de cada bloque:** se revisan los puertos 9000 y 9001, para que tu App 1 siga igual.
- **Al terminar:**
  - se apagan los servidores de prueba;
  - se borra la carpeta de prueba por su nombre exacto;
  - se devuelve `backtesting_cache` del worktree con `git checkout` de cada archivo por su nombre.

## 5. Fuente de verdad: el oráculo

Es un programa aparte (`backend/tests/audit/`), escrito para este protocolo desde la especificación: las guías, `CLAUDE.md` y los textos de la pantalla. **No reusa el código de simulación del probador.**

### 5.1 Datos crudos verificados contra Bybit

Con pedidos públicos de velas, sin datos tuyos:

- **D-01:** las velas con que corre cada moneda, contra Bybit, en 50 fechas al azar por moneda y marco. En las monedas con almacén son las armadas con los trades; en las demás, las del caché (H11);
- **D-02:** las velas anteriores al caché, que salen del almacén de trades;
- **D-03:** los minutos del almacén en cada vela que decide un trade (stop y objetivo en la misma vela, llenados y dos órdenes) contra las velas de 1 minuto de Bybit, y si sus extremos llegan a los de la vela (H12);
- **D-04:** las de 30m (dos de 15m) y 1D (seis de 4h por día UTC) contra las de Bybit en ese marco;
- **D-05:** en las 43 nuevas, las velas que faltan y los saltos;
- **D-06 a D-08:** el OI de 4 horas (la hora del dato contra el cierre de la vela), el funding y el desfase del dato on-chain (06:00 UTC del día siguiente);
- **D-09:** en 3 acciones, el horario de la sesión y los splits.

### 5.2 El ciclo del trade, escrito dos veces

Señal, entrada, stop, objetivo, recorrido minuto a minuto, salida y R:

- una versión la escribo yo desde la especificación;
- otra la escribe aparte un agente que **no ve el código del motor**, solo la especificación.

Las dos se prueban primero con casos armados a mano, de respuesta conocida. Donde el motor y las dos versiones no coinciden, se investiga cuál dice lo que promete la pantalla. Si la especificación es ambigua, te lo pregunto.

### 5.3 Las piezas, por nivel de oráculo

- **A, se recalculan enteras:**
  - EMA, VWAP móvil y su desviación, y ATR;
  - CVD de N velas, OI, funding y multitud, OI sostenido y on-chain;
  - horario y hueco de la VA;
  - los filtros de Williams: Alligator, AO, AC, Gator y MFI;
  - los elementos de velas simples: Volumen alto, Flecha, FVG nuevo, Impulso, Swing y los patrones de vela.
- **B, se comprueban sus condiciones necesarias:**
  - las cajas (BX, BE y CP), el cambio de carácter y el canal gaussiano;
  - el perfil por sesión (VR, VF, VX y VE) y los sabios (WD, WA y WF);
  - los elementos literales de order flow (ZP, SW, ST, VI, TP…);
  - los filtros de medidas.
- **C, sin reescribirlos:** los de umbral relativo de order flow, SMC, VPA, régimen y liquidaciones. Para estos:
  - la prueba de corte (I-01);
  - las pruebas metamórficas (sección 8);
  - la comparación con su indicador en JavaScript, que ya tiene pruebas de paridad con Python;
  - la revisión visual.

### 5.4 Tolerancias

- Horas: exactas.
- Precios: error relativo de 1e-9 o menos.
- R: 0.0001 o menos (el motor redondea a 4 decimales).
- Cifras de los informes: a su redondeo.

## 6. Tres capas en cada corrida

**Capa A, el oráculo (el 100% de los trades).** Cada trade se recalcula y se compara campo por campo:
- la vela y la hora de la señal;
- los elementos que votaron;
- cada filtro en la vela de la señal;
- la vela y el precio de entrada;
- el stop, el objetivo, la salida y su motivo;
- el R bruto, las comisiones y el R neto.

**Capa B, la pantalla en texto (el 100% de los trades).** La página se maneja sola:
- se elige cada trade;
- se lee su detalle: entrada, stop, objetivo, salida, R y motivo;
- se lee la tabla de la vela de la señal, con ✓, ✗ o – y su valor;
- se compara con la corrida y con el oráculo.

**Capa C, revisión visual con captura.**
- En cada corrida principal: todos los trades si son 40 o menos. Si son más, 15:
  - el primero, el último, el mejor y el peor;
  - 5 al azar, con semilla fija;
  - todos los que marquen las capas A o B;
  - los casos borde: sale en la vela de la entrada, stop y objetivo en la misma vela, hueco de datos, cambio del trailing y último trade antes del fin de la fase.
- En las variantes (un filtro más o un parámetro movido): 5, los que el cambio agrega o quita.
- Cada trade revisado se anota con su veredicto.

**Lista de la revisión visual:**

- **V1:** la vela resaltada es la de la señal, y su hora coincide con el detalle. El detalle va en hora de Colombia; la regla decide en UTC.
- **V2:** cada elemento que votó tiene su marca en la vela en que se conoce y dentro de la ventana. Lo que tarda en saberse (fractal, swing, pivote SMC) va punteado hasta su vela.
- **V3:** cada fila de filtro está en verde en la vela de la señal, y su valor es el del oráculo.
- **V4:** las líneas de la regla (EMA, VWAP, canal) pasan por el valor del oráculo en la vela de la señal. El indicador del gráfico, con los ajustes de la regla, coincide con ellas (salvo lo de H2).
- **V5:** la caja empieza donde debe: la apertura de la vela siguiente (mercado), la vela que cruza la limit o la que toca la orden stop.
- **V6:** el stop inicial está donde dice su tipo, con su margen.
- **V7:** el objetivo está a N veces el riesgo.
- **V8:** entre la entrada y la salida, ninguna vela tocó antes el stop vigente o el objetivo. Si hay duda en una vela, se mira en 1M y con las velas de la regla, no solo con las del gráfico (H11).
- **V9:** la cruz de salida está en su precio y en su vela, con el motivo que se ve.
- **V10:** el stop en escalones solo se acerca y cambia al cerrar la vela.
- **V11:** el R del detalle es el que da la cuenta del oráculo.
- **V12:** nada a la derecha de la vela de la señal hacía falta para decidir.

## 7. Invariantes en todas las corridas

Se comprueban solas:

- **I-01, sin futuro (prueba de corte).** La regla se repite con las velas cortadas en 5 fechas al azar. Los trades que salieron antes del corte, y las señales conocidas antes de él, tienen que ser idénticos. Es la prueba más fuerte contra el futuro y el repintado, y vale igual para un elemento, un filtro o el motor.
- **I-02, vela de entrada:**
  - mercado, la vela siguiente a la señal;
  - limit, la primera que cruza su precio (no basta con tocarlo), dentro de su vencimiento;
  - orden stop, la primera que llega a su nivel;
  - dos órdenes, la primera que se llena (por minutos si las dos se tocan en la misma vela).
- **I-03, precio de entrada:** mercado, la apertura; limit, su precio; orden stop, su nivel, o la apertura si abrió más allá.
- **I-04:** stop y objetivo con lo conocido al cierre de la vela de la señal.
- **I-05, salida:** el primer evento en el tiempo entre las salidas encendidas. Dentro de la vela, por los minutos o por el recorrido supuesto: apertura, el extremo más cercano, el otro extremo y cierre.
- **I-06, R neto** = (salida − entrada) × lado ÷ riesgo − (comisión de entrada × entrada + comisión de salida × salida) ÷ riesgo. Comisiones: taker 0.055%, maker 0.02% en una limit llenada, y 0.02% por lado en acciones.
- **I-07, una posición a la vez:** ningún trade se superpone con otro de la misma moneda, y el enfriamiento se respeta.
- **I-08, fase:** ninguna señal ni entrada fuera de la fase, y ninguna salida con velas de la fase siguiente. Los abiertos al final se cuentan (H6).
- **I-09, embudo completo:** señales = trades + cada motivo + con posición abierta + abiertas al final + sin vela siguiente. Lo que hoy queda como "otros motivos" tiene que explicarse.
- **I-10, repetible:**
  - la misma regla dos veces, y en orden A, B, A con otra moneda en medio, da los mismos trades;
  - la corrida guardada es igual a la recalculada;
  - el trade elegido se repite igual (`same`).
- **I-11, cuentas del informe:** cada cifra del Resumen, Patrones, Contra el azar, Como cuenta, Todas, Estrategias y el CSV se recalcula desde la lista de trades.
- **I-12, controles:** mismo stop, misma salida, mismo lector de minutos y la misma proporción de lados que la regla. Entran donde dejan el régimen y los filtros de lado. Lo que no copian (H1) se mide.

## 8. Pruebas metamórficas

No necesitan saber la respuesta: comparan dos corridas que tienen que guardar una relación.

- **M-01, espejo:** con los precios reflejados (p' = A − p), una regla de elementos de velas y filtros de precio da cada largo como corto, con el mismo R bruto. Encuentra errores del lado corto, como un signo o un `<` que debía ser `<=`.
- **M-02, escala:** con los precios multiplicados por 10, salen las mismas señales y el mismo R. Encuentra umbrales escondidos en dólares.
- **M-03, el filtro solo quita:** sin "una posición a la vez", la regla con un filtro da un subconjunto de las señales sin él. Cada señal quitada falla el filtro y cada una que queda lo cumple, con el valor del oráculo.
- **M-04, apagar es no tenerlo:** una pieza apagada deja la misma identidad de la regla y los mismos trades que no haberla tenido nunca.
- **M-05, umbrales que ordenan:** subir el mínimo del FVG, del impulso o del volumen da menos señales, y las de la regla más exigente están entre las de la otra.
- **M-06, invertir:** las mismas señales, del lado contrario, con el stop del otro lado.
- **M-07, caché:** en frío, sin el caché de elementos, sale igual que con caché.

## 9. Catálogo de pruebas por pieza

Cada pieza se prueba aislada, sobre una regla base con muchas señales: en BTC 4h, fase 1, si no se dice otra cosa, y las de order flow en BTC 15m. En cada una se mira:
- (a) su definición en la vela de la señal, contra el oráculo;
- (b) cuándo se conoce (I-01);
- (c) las pruebas metamórficas que le apliquen;
- (d) la revisión visual.

### 9.1 Motor

Va primero: todo lo demás depende de él.

| ID | Qué | Casos |
|---|---|---|
| E-01 | Entrada a mercado, stop en ATR y objetivo en R | Tu configuración más usada: 1,793 corridas a mercado y 1,717 con stop en ATR |
| E-02 | Stops | Swing de N velas con margen; extremo de la vela del elemento (conf. 15); borde lejano; ATR; mínimo y máximo (conf. 20 y 21) |
| E-03 | Limit | Borde cercano, mitad y lejano; vencimiento; del lado equivocado entra a mercado (conf. 17); llenado al cruzar; vela del llenado (H4, conf. 38) |
| E-04 | Orden stop de los sabios | Margen, espera propia del 3.er sabio y cancelación |
| E-05 | Dos órdenes stop | Desde el cierre y desde la zona; empate en la misma vela, con y sin minutos (conf. 18); el lado (conf. 6 y 37) |
| E-06 | Salidas, de a una | Objetivo; sin objetivo, con el cierre implícito a las 96 velas; cierre por tiempo; trailing al swing, a N velas, en ATR y en %, con su arranque; stop a la entrada; señal contraria (conf. 7); salida por el canal; salida VPA; objetivo arrastrado en R, ATR y %; objetivo mixto on-chain; objetivo en el POC, en el borde, en el centro y en el rango SMC |
| E-07 | Salidas en carrera | Las combinaciones que usas (objetivo + trailing + stop a la entrada + tiempo; objetivo arrastrado + trailing): sale por la primera |
| E-08 | Vela dudosa | Stop y objetivo en la misma vela, con minutos (BTC 15m) y sin ellos (DOGE 4h); apertura más allá del stop; hueco de datos; minutos incompletos (H12) |
| E-09 | Operación | Una posición a la vez, enfriamiento y orden de llenado de las limit |
| E-10 | Comisiones | Taker, maker y acciones |
| E-11 | Fin de la fase | Abiertos al final (H6) |
| E-12 | Detección | Todos; al menos N; en secuencia, con y sin la misma vela (conf. 3); ventana y su gasto (H3); lado e invertir (conf. 5); extremo; momentum; confirmación |

### 9.2 Elementos

La prioridad 1 son los que usan tus reglas candidatas.

| Familia | Códigos | Oráculo | Prioridad |
|---|---|---|---|
| Cajas | BX, BE, CP | B | 1 (BX está en 748 corridas) |
| Hueco, swing e impulso | FV, SP, IM | A | 1 |
| Volumen | VH, RF, RB | A | 1 |
| Patrones de vela | HM, EN, DJ | A | 1 |
| VPA | QB, y después QA, QF, QR, QT, QS, QC, QE | C | 1 para QB; 2 para el resto |
| Sabios de Williams | WD, WA, WF | B | 1 |
| SMC | BS, OB, BK, EQ | C | 2 |
| Estructura | CC | B | 2 |
| Canal gaussiano | GC | B | 2 |
| Perfil por sesión | VR, VF, VX, VE | B | 2 |
| Liquidaciones | LIQ | C | 2 |
| Order flow (31) | Zonas, giro, continuación, tabla y flujo | B o C | 1 para ST y DT; 2 para el resto |

### 9.3 Filtros

Cada uno con M-03, con su fila en el trade elegido y con la pregunta de si los controles lo copian (H1).

| Grupo | Piezas | Oráculo | Prioridad |
|---|---|---|---|
| Tendencia | VWAP móvil y EMA: cierra a favor, la mecha la toca, pendiente y tope de desviaciones. Régimen: dentro, fuera y tras romper, con el rango mayor y medido en 1D | A (líneas) y C (régimen) | 1 |
| Flujo | CVD de N velas; OI (sube, baja, confluencia y sin confluencia en contra); multitud; OI sostenido; on-chain (flujo neto y emisión, a favor y que no esté en contra) | A | 1 |
| Williams y SMC | Alligator, zona, AO, AC, Gator y MFI; premium/discount y estructura a favor | A (Williams) y C (SMC) | 2 |
| VPA | Medidor a favor, o que no esté en contra | C | 2 |
| Horario y medidas | Horario, también cruzando la medianoche y de lunes a viernes; medidas del Observador (conf. 23); hueco de la VA | A y B | 2 |

### 9.4 Controles

- I-12 en todas las corridas.
- **H1 medido:** en 6 de tus reglas con VWAP o EMA, el azar de la app contra un azar que además respete la línea y el horario, calculado por el oráculo. Dice cuánto de la ventaja informada pone el filtro.
- La semilla, la cantidad real de entradas (conf. 42) y que el tramo del zigzag no mira el futuro.

### 9.5 Informes

- I-11 en todas las corridas.
- **Como cuenta:** recalcular el retorno, la caída, Sharpe, Sortino, los meses positivos y las posiciones a la vez.
- **Todas:** que sea la unión de las corridas de cada moneda, con el azar pesado por trades y la constancia por trimestre.
- **Estrategias:** el "pasa" de cada celda, con el criterio acordado.
- **CSV:** cada columna contra la corrida, en UTC.
- **Sensibilidad:** cada variante corrida aparte da lo mismo.

### 9.6 Fases y candado

- Las fechas exactas de cada fase y sus bordes.
- La confirmación de las fases 2 y 3, y que la 3 pida la 2.
- Que lo guardado no se recalcule.
- Los campos que cambian la identidad de la regla sin hacer nada (conf. 28).
- La versión del motor (H9).

### 9.7 Monedas, marcos y datos

- D-01 a D-09.
- Una moneda sin almacén (DOGE), XRP (nueva, con almacén) y una acción en 1h y 4h (conf. 40).
- Los seis marcos, con 30m y 1D armados de otros marcos.

### 9.8 Gráfico del trade elegido

- Que el marco pase al de la regla.
- Los indicadores con los ajustes de la regla.
- Las líneas, las marcas, las filas de filtros y la tabla de la vela de la señal.
- El stop y el objetivo arrastrado en escalones, y la cruz de salida.
- Los avisos cuando una corrida no se repite igual.
- Lo que se ve y no es lo que vio la regla (conf. 35).

### 9.9 Las 43 confusiones de la guía

Cada una con la prueba de la hoja Confusiones. Al final, cada una queda en uno de tres estados: confirmada (con su arreglo o su aviso en pantalla), no pasa o corregida.

### 9.10 Los 100 pasos de la hoja Chequeo

Se recorren en pantalla como prueba de aceptación de la ventana, y se marca "Estado" en tu Excel.

## 10. Sesgos

- **B-01, futuro.** I-01 en cada elemento y filtro. Además, cuándo se conoce cada uno según su definición: fractal, swing, pivote SMC, VA abandonada, estructura en un marco mayor, perfil de la sesión anterior, régimen diario, dato on-chain, funding de 3 días, OI al cierre y fila de medidas.
- **B-02, arranque en frío (H2).** Para EMA 50 y 200, VWAP 200, tramo, régimen, SMC, VPA y Williams: cuántas señales se pierden en las primeras velas de cada fase, y cuánto difieren las demás de un cálculo con historia. Con los números decides si se arregla, dando a cada fase las velas anteriores para calentar sin operarlas.
- **B-03, censura al final de la fase (H6).** El R de los trades que quedaron abiertos, resueltos aparte con las velas siguientes.
- **B-04, monedas sobrevivientes (H7).** La lista de perpetuos de Bybit que cotizaban entre 2021 y 2023 y ya no cotizan. Si sus velas se pueden bajar, 3 reglas en ellas; si no, queda documentado y medido con lo que haya.
- **B-05, llenados (H5) y deslizamiento.** Qué cambia con la limit y el objetivo llenados en la apertura saltada, y con 0.02 a 0.05% de deslizamiento por lado, en tus candidatas.
- **B-06, funding no cobrado.** El probador no cobra el funding de las posiciones abiertas. Se mide en 3 candidatas con la serie de funding que ya está en `OrderFlowData/funding`.
- **B-07, un azar justo (H1).** La ventaja con tres azares: el de hoy; uno que copie también la línea y el horario; y uno repartido en el tiempo como los trades de la regla (por trimestre).
- **B-08, trades que se mueven juntos (H10).** El margen de "Todas" contra un bootstrap por semanas.
- **B-09, muchas variantes.** No es un fallo del motor: solo se comprueba que el contador de variantes del Historial cuadra con el registro.

## 11. Corridas de prueba

Unas 37 familias, casi todas en la fase 1. Tus reglas son la base, para probar lo que de verdad usas.

| # | Regla | Cubre |
|---|---|---|
| R01 | FVG nuevo ≥ 0.3 ATR, a mercado, stop 1.5 ATR, 3R, en BTC 4h | E-01, I-01 a I-11, M-01, M-02 y M-07 |
| R02 | R01 en BTC 15m | E-08 con minutos y D-03 |
| R03 | R01 en DOGE 4h | E-08 sin minutos y las monedas nuevas |
| R04 | R01 con los cuatro stops, margen, mínimo y máximo | E-02 |
| R05 | R01 con limit (cercano, mitad y lejano) y su versión invertida | E-03, H4 y H5 |
| R06 | Compresión con dos órdenes, desde la zona y desde el cierre | E-05 |
| R07 | Tu regla de los sabios, con orden stop | E-04, WD, WA y WF |
| R08 | Salidas de a una y en carrera | E-06 y E-07 |
| R09 | Objetivo arrastrado en R, ATR y % | E-06 |
| R10 | Objetivo mixto on-chain | E-06 y D-08 |
| R11 | Salida VPA | E-06 |
| R12 | Canal gaussiano en 1D | GC, salida por el canal y 1D |
| R13 | Objetivos de nivel: POC, borde, centro de la caja y rango SMC | E-06 |
| R14 | Una posición a la vez, enfriamiento y las dos limits del rango | E-09 |
| R15 | Detección: todos, al menos 2, secuencia, lado, invertir, extremo, momentum y confirmación | E-12 y H3 |
| R16 | Ruptura de caja con EMA 200 y CVD 20 | BX, EMA, CVD, H1 y H3 |
| R17 | Impulso de 2 ATR en 3 velas | IM |
| R18 | VPA: ruptura con volumen | QB |
| R19 | Flecha de volumen con VWAP 200, y rombo | RF, RB y VWAP |
| R20 | B5: FVG o doji en 2 velas, EMA 50 y OI subiendo | H1, H3 y OI |
| R21 | Martillo, envolvente y doji con tendencia y volumen | HM, EN y DJ (conf. 8) |
| R22 | Swing, Volumen alto y cambio de carácter con horario | SP, VH y CC (conf. 12) |
| R23 | Order flow en BTC 15m, por familia | Los 31 de order flow |
| R24 | SMC con sus filtros | BS, OB, BK y EQ |
| R25 | El resto del VPA, con el medidor | QA a QE |
| R26 | Barrido de liquidaciones con Volumen alto | LIQ (conf. 13 y 14) |
| R27 | Perfil por sesión, sus formas y su control | VR, VF, VX y VE |
| R28 a R33 | Cada filtro sobre una regla base (M-03) | Sección 9.3 |
| R34 | Impulso en acciones (AAPL y SPY), en 1h y 4h | Acciones (conf. 40) |
| R35 | Marcos de 5m, 30m, 1h y 1D | Sección 9.7 |
| R36 | Todas: las de siempre, las nuevas y las acciones | Sección 9.5 |
| R37 | Fases 2 y 3 con una regla de prueba | Sección 9.6 |

## 12. Repetición de tus corridas reales

En la copia aislada, con la copia de tu registro:
- la B5;
- la Ruptura de caja con EMA 200 y CVD, en las de siempre y en las nuevas;
- FVG 0.3 · 3R y el Impulso;
- la ruptura con volumen del VPA, en las fases 1 a 3;
- los objetivos mixtos de hoy;
- la de los sabios en 15m;
- la Flecha con VWAP.

Para cada una:
1. la regla guardada se corre de nuevo desde cero y se compara trade por trade con la guardada. Una diferencia dice que el motor cambió desde entonces o que algo no se repite;
2. las capas A y B en todos sus trades, y la C en su muestra;
3. al final, cuáles de tus conclusiones siguen en pie y cuáles cambian.

## 13. Orden de ejecución y puntos de control

| Etapa | Qué | Al terminar |
|---|---|---|
| 0 | Entorno y las pruebas que ya existen (backend y página), anotando las que ya fallaban: 2 del backend y `liquidations.test.mjs` | Te informo |
| 1 | Datos contra Bybit (D-01 a D-09) | Te informo |
| 2 | El oráculo, sus dos versiones y sus pruebas de respuesta conocida | Te informo |
| 3 | Motor (E-01 a E-12, con R01 a R15) | Te informo, **y paro si hay fallos graves** |
| 4 | Elementos y filtros de prioridad 1, controles e informes | Te informo |
| 5 | Tus corridas reales | Te informo |
| 6 | Prioridad 2, las 43 confusiones, los 100 pasos y los sesgos | Te informo |
| 7 | Informe final, correcciones y sus pruebas de regresión | Te informo |

**Tamaño aproximado:** 150 a 200 corridas y unas 500 a 900 revisiones visuales con captura; todo lo demás se revisa en texto. Lleva varias sesiones: el avance queda en el registro (sección 14), así una sesión nueva sigue donde quedó la anterior.

## 14. Registro, severidad y correcciones

**Registro**, en el repositorio, en este worktree:
- `pruebas_backtesting/REGISTRO.md`: cada prueba con su estado (pasa, falla o bloqueada), la corrida, los trades revisados y la fecha;
- `pruebas_backtesting/DEFECTOS.md`: cada defecto con su ID, severidad, cómo reproducirlo, la evidencia, la causa, el arreglo y su prueba;
- lo pesado va a `OrderFlowData/research/pruebas_backtesting/2026-11-21/`: las corridas de prueba, lo leído de la pantalla y los gráficos del oráculo en SVG;
- al final, en tu `CHEQUEO_PRUEBAS_REGLAS.xlsx`: el estado de las confusiones, de los pasos y de los controles ("Probado").

**Severidad:**
- **S1, crítico:** un trade o un R equivocado, una pieza que usa el futuro, o un control que favorece a la regla;
- **S2, mayor:** una pieza que no hace lo que dice la pantalla;
- **S3, menor:** un texto, un dibujo o un aviso equivocado que no cambia resultados;
- **S4:** cosmético.

**Correcciones:**
- **S1 y S2** se corrigen al encontrarlas, cada una con:
  - su prueba de regresión;
  - una versión nueva del motor (5, 6…);
  - `_stale()` para las corridas guardadas que esa corrección cambia, así el Historial, "Todas" y el tablero no las mezclan con las nuevas.
- **S3 y S4** van en un lote al final.
- **Decisiones de diseño** (H1, H2, H3, H6 y lo que salga): no se cambian sin tu visto bueno. Te las presento con su efecto medido.
- Todo va en la rama de este worktree, con commits por grupo. Tu App 1 no cambia hasta que pidas unirlo y reinicies.

## 15. Criterios de aceptación

El backtesting global queda aprobado para probar estrategias cuando:
- no quedan defectos S1 ni S2 abiertos;
- el motor coincide con el oráculo en el 100% de los trades de las corridas de prueba, salvo diferencias explicadas y aceptadas por ti;
- I-01 (sin futuro) pasa en todos los elementos y filtros;
- M-01 a M-07 pasan donde aplican;
- la pantalla coincide con la corrida en el 100% de los trades leídos, y la revisión visual sale bien en toda la muestra;
- las 43 confusiones tienen estado final;
- los sesgos B-01 a B-09 están medidos y decididos contigo.

## 16. Decisiones que necesito de ti

1. **Entorno:** copia aislada con una copia de tu registro (recomendado), o tu App 1 del 9000.
2. **Correcciones:** S1 y S2 sobre la marcha, cada una con su prueba (recomendado), o primero el informe completo y después las correcciones.
3. **Revisión visual con captura:** la muestra de la sección 6 (recomendado), o captura de cada trade de cada corrida (de 5 a 10 veces más capturas).
4. **Alcance:** todo, en el orden de la sección 13 (recomendado), o solo la prioridad 1.
5. **Decisiones de diseño** (H1, el azar que no copia la línea; H2, el arranque en frío; H3, la ventana gastada; H6, la censura): medir y decidir contigo (recomendado).
