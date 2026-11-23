# Informe final del protocolo de pruebas del backtesting global (etapa 7)

22/11/2026. Protocolo: `PROTOCOLO_PRUEBAS_BACKTESTING_GLOBAL.md`. Detalle de cada prueba: `REGISTRO.md`. Cada hallazgo
con su evidencia: `DEFECTOS.md`. Capturas y revisiones: `revision_visual/`.

## 1. Veredicto

**El motor calcula bien los trades y su R.** Lo que hace con las velas que recibe coincide con dos oráculos escritos
aparte en más de 470,000 llamadas. Cada diferencia quedó explicada. Unos 55,000 trades se revisaron uno a uno con
captura: la pantalla dice lo mismo que la corrida guardada en todos, y los agentes revisores aparte no hallaron ningún
trade mal dibujado ni mal contado.

**Pero todavía no queda aprobado para probar estrategias** (criterios de la sección 15 del protocolo):
- queda abierto un defecto crítico, **F-16**: las franjas de liquidaciones usan datos del futuro;
- quedan 5 fallos mayores: F-02 y F-03 (velas de las monedas nuevas), F-07 (azar), F-08 (multitud) y F-09
  (confluencia OI-volumen);
- quedan 3 decisiones de diseño mayores (H1, H4 y H15) y las de los sesgos B-07 y B-08, que cambian veredictos.

**Tus conclusiones:**
- con el azar de la app, los 18 veredictos de tus reglas principales se repiten igual (etapa 5);
- con un azar más justo, que guarda la proporción de largos y cortos y respeta la línea y el horario, cambia uno: la
  ruptura de caja en la fase 1 de las monedas de siempre deja de pasar. La pasó después en la fase 2;
- con el azar de cada trimestre y lado (sesgo B-07), la ventaja de la Flecha con VWAP casi desaparece: de +0.19 a +0.04
  R en la fase 1 y de +0.12 a −0.005 en la fase 2. Las demás siguen sobre el azar, con menos ventaja;
- ninguna conclusión de las fases 2 y 3 cambia con los controles de la app;
- quedan por recalcular, después de corregir: tus 28 corridas de liquidaciones (todas de BTC, en la fase 1, ninguna pasó
  a la fase 2) por F-16, y lo de las 43 monedas nuevas por F-02 y F-03.

Ya está corregido **F-04** (crítico): el orden de las órdenes que se llenan en la misma vela (motor 5, 21/11). Está en
la rama del protocolo, sin commit.

## 2. Qué se probó

| Etapa | Qué | Resultado |
|---|---|---|
| 0 | Entorno aislado (backend 9300, página 9301, copia de tu registro) y pruebas existentes | 520 pasan; fallan las 2 de siempre del backend y `liquidations.test.mjs` |
| 1 | Datos contra la API pública de Bybit | F-02, F-03 y O-09 |
| 2 | Dos oráculos del ciclo del trade, escritos sin copiar el motor | 51 corridas y 324,399 llamadas comparadas: todas las diferencias explicadas |
| 3 | Motor: entradas, stops, salidas, comisiones, una posición a la vez, minutos (R01 a R15) | 7,639 trades con captura, ninguno mal; invariantes y pruebas metamórficas en 50 reglas; **F-04 corregido** |
| 4 | Elementos y filtros de prioridad 1, controles al azar e informes | 29 corridas, 9,778 trades con captura, ninguno mal; F-07, F-08, F-09, H19 |
| 5 | Tus corridas reales | Las 1,388 repetidas desde cero: todas explicadas. 5,987 trades de BTC con captura, ninguno mal. Tus 18 veredictos se repiten |
| 6 | Prioridad 2 (VPA, SMC, Williams, order flow, perfil, liquidaciones, marcos, acciones), 43 confusiones, 100 pasos y sesgos | 85 corridas, 31,556 trades con captura, ninguno mal; F-16 y los sesgos medidos |

En la pantalla también se comprobaron los 100 pasos de la hoja Chequeo (todos dan lo que dice la guía) y las 43
confusiones (40 confirmadas y 3 que la app ya cambió). Los dos quedaron en `CHEQUEO_PRUEBAS_REGLAS.xlsx`.

## 3. Lo que se corrige sin decisión de diseño

Cada uno lleva su prueba de regresión. Los del motor suben su versión, y las corridas guardadas que cambian quedan fuera
(`_stale`), así el Historial, "Todas" y el tablero no las mezclan con las nuevas.

| ID | Qué pasa | Efecto medido | Corrección |
|---|---|---|---|
| **F-16** (S1) | El ancho de las franjas de liquidaciones sale del archivo entero, con celdas del futuro | ARB fase 1: 158 de 587 trades (barrido de swing) y 302 de 979 (barrido de zona) no tendrían evento; BTC: 741 de 2,204 y 872 de 2,130 | Usar solo las celdas ya conocidas en cada vela, en el motor y en el indicador. Motor nuevo; quedan fuera las corridas con liquidaciones (tus 28). Prueba: la de corte también recorta el archivo de liquidaciones |
| **F-02** (S2) | A las velas de las 43 monedas nuevas les falta una vela cada 1,000, y a veces una página entera | DOGE 1h: 47 huecos de una vela; ALGO 1h: 4,040 velas seguidas; RUNE, SHIB1000 y ATOM: 1,000 a 2,000 | Páginas de 1,000 velas exactas y reintento cuando Bybit responde sin lista; rellenar los huecos de las 43 monedas. Prueba con una API falsa |
| **F-03** (S2) | La vela abierta al actualizar queda guardada a medio formar | Una por moneda y marco en cada actualización, casi siempre en la fase 3: cierre hasta 1.3% distinto y volumen 30–80% más bajo | Guardar solo velas cerradas y empezar cada actualización por la última guardada; corregir las que quedaron así |
| **F-07** (S2) | Con filtros de lado (CVD, OI, multitud, on-chain), el azar no guarda la proporción de largos y cortos de la regla | Va para los dos lados: CVD y OI +0.44 → +0.37 R; B5 +0.46 → +0.49 | Azar estratificado: primero el lado con la proporción de la regla, después una vela donde el filtro deje ese lado |
| **F-08** (S2) | Con el funding justo en la tasa base, el filtro de multitud decide por redondeo | BTC 4h fase 1: quita 14 largos neutros y deja pasar 12 cortos neutros | Comparar con tolerancia. Ninguna corrida guardada tuya usa este filtro |
| **F-09** (S2) | La confluencia OI-volumen del filtro no es la del panel en los cortos | Cortos: 153 de 311 iguales al panel | Necesita tu decisión (sección 4). Ninguna corrida guardada tuya usa este filtro |

Después de F-02 y F-03 cambian las velas de las monedas nuevas. Como las corridas no guardan de qué datos salieron
(H20), propongo resolverlo con H20 (sección 4) y repetir tus veredictos de las monedas nuevas.

## 4. Decisiones que te tocan

Cada una con su efecto medido, lo que pasa con tus corridas guardadas y mi recomendación. Puedes aceptar todas las
recomendaciones o cambiar las que quieras. Las que solo tocan el control o el margen se recalculan sobre tus corridas
guardadas sin repetirlas; las que cambian trades dejan fuera las corridas afectadas, que se vuelven a correr.

### Las que cambian veredictos

| ID | Qué pasa | Efecto medido | Tus corridas | Recomiendo |
|---|---|---|---|---|
| **B-07** | El azar de toda la fase no sabe en qué trimestres y de qué lado opera la regla, y la regla suele operar donde el azar también gana | Flecha con VWAP f1 +0.19 → +0.04 R y f2 +0.12 → −0.005; ruptura de caja f1 +0.26 → +0.10 y f2 +0.31 → +0.19; solo cortos f1 +0.45 → +0.33; B5 f1 +0.20 → +0.16 | Se recalcula: cada corrida ya guarda el azar de cada trimestre y lado | Que "pasa" pida ganarle también a ese azar, y mostrar las dos ventajas |
| **H1** | El azar no copia la línea (VWAP, EMA) ni el horario, y la ventaja incluye lo que pone el filtro | B5 +0.46 → +0.39; Flecha con VWAP +0.36 → +0.24; Impulso con EMA 200 y horario de Nueva York +0.43 → +0.23 | Se recalcula el azar de las que usan línea u horario | Que el azar entre solo donde dejan la línea y el horario, como ya hace con el régimen y los filtros de flujo |
| **B-08** | Los trades de una misma semana se mueven juntos y el margen de la ventaja sale más angosto de lo que es | El margen real es 1.02 a 1.43 veces más ancho | Se recalcula | Calcular el margen de "pasa" agrupando por semanas |
| **H15** | "Una posición a la vez", a mercado, salta la señal de la vela en que salió el trade anterior, aunque al decidir el trade ya había salido; con órdenes que esperan se cuenta distinto | R01 en las 7 monedas: 1,016 trades contra 1,079 (+6%), +0.259 contra +0.254 R. Con la orden stop de los fractales: 283 trades y +0.024 R contra 326 y +0.187 | Cambia los trades de casi todas (es la opción de fábrica) | Contar la salida antes de decidir, igual con todas las entradas, y dejar entrar una orden que se llena después del minuto de la salida |

### Las que mueven poco o solo cambian cómo se ve

| ID | Qué pasa | Efecto medido | Tus corridas | Recomiendo |
|---|---|---|---|---|
| H4 | Lo máximo a favor de la vela del llenado incluye precios de antes de entrar; con trailing lo arranca antes | R05e BTC: 21 de 350 trades, −0.36 R en total | Las de limit u orden stop con trailing o stop a la entrada | Medirlo desde el minuto del llenado, como el alcance |
| H2 | Arranque en frío: al comenzar cada fase no hay ATR, swings ni indicadores de antes | Se pierden de 0 a 6 trades por moneda y fase; el R se mueve hasta ±0.1 | Cambia el comienzo de todas | Calentar con las velas anteriores a la fase, sin operarlas (como ya hace el canal gaussiano en 1D) |
| H13 | Dos ATR en la misma regla (Wilder en los umbrales, media simple en el stop y el objetivo), los dos llamados "ATR" | Cambian de lado del umbral de 0.3 ATR el 3% de los FVG en ARB 4h, el 6% en BTC 4h y el 9% en BTC 15m | Unificarlos cambia todas; renombrarlos, ninguna | Nombrarlos distinto en la pantalla ("rango medio de 14" para stop y objetivo); unificarlos solo si quieres repetir todo |
| H18 | Los mínimos del stop (0.1 ATR) y del objetivo (0.3 R) no miran la comisión | VF: 32 de 605 trades pierden más de 2 R; barridos de liquidaciones: hasta −5.85 R y objetivos con R negativo | Las que tienen trades con stops diminutos (sobre todo 15m y 5m, stop en la vela) | Descartar la señal cuando la comisión de ida y vuelta pase de un tope en R (0.3 R de fábrica, ajustable) |
| H19 | Dos señales opuestas en la misma vela: entra siempre el largo | BTC 4h: 6 velas en el Swing y 10 en la ruptura de fractal | Pocas | No entrar: no hay forma de saber cuál fue primero |
| H20 | Una corrida guardada se reusa aunque cambien los datos de su moneda | SUI con almacén nuevo: 24 corridas, 1,086 trades distintos; SNX: 3 corridas | Las de las monedas cuyos datos cambiaron (y, con F-02, las 43 nuevas) | Guardar en cada corrida la fuente y la huella de sus datos, y dejarla fuera si cambian |
| H21 | Las corridas de antes del motor 3 siguen contando el stop en las velas dudosas sin minutos | 5 trades pasan del stop al objetivo (TRX 15m f1: −1.28 → +2.72 R) | Las de antes del 20/11 en monedas sin minutos | Dejarlas fuera, como las demás de motores viejos |
| H16 | "Extremo de la vela del elemento" en un FVG es solo la tercera vela | Stops de 0.13 a 3.4 ATR; pérdidas hasta −1.38 R | Las de FVG con ese stop | Usar las tres velas del patrón |
| H17 | Los topes del stop en ATR descartan la señal, no recortan el stop (así lo dice la documentación) | R04e: 101 de 117 señales descartadas | Ninguna | Dejarlo así y decirlo junto al control |
| H14 | La regla invertida con limit en la zona siempre entra a mercado | Borde cercano, mitad y lejano dan lo mismo | Ninguna | Avisarlo en la pantalla al invertir |
| H22 | El medidor VPA no es simétrico: el martillo invertido abajo de una bajada no suma | Medidor (E-QE): 13 de 138 trades cambian con los precios reflejados | Las del medidor VPA | Darle su lectura alcista, como la estrella arriba tiene la bajista |
| H23 | El barrido de la zona de liquidaciones queda armado sin límite de tiempo | 95 de 2,247 eventos en ARB y 222 de 3,128 en BTC no tocan la zona; armados de hasta 836 días | Ya quedan fuera por F-16 | Desarmarlo cuando la zona deja de mostrarse |
| F-09 | Confluencia OI-volumen en los cortos: el filtro pide OI subiendo y el panel, OI bajando | Cortos: 153 de 311 iguales | Ninguna tuya | Que el filtro diga lo mismo que el panel que ves |
| B-05 y B-06 | Deslizamiento y funding no se cuentan | −0.008 a −0.040 R por trade con 0.02–0.05% por lado; funding −0.003 a −0.015 R. Ningún veredicto cambia | Ninguna | Dos opciones en la regla (deslizamiento por lado y funding), apagadas de fábrica, y su efecto en "Todas" |

## 5. El lote de menores y cosméticos (al final)

Van juntos, sin cambiar resultados salvo lo que se indica:
- **Motor, en los bordes:**
  - F-01: el enfriamiento empieza activo al comienzo de la fase;
  - F-13: "Alligator dormido" deja pasar las primeras 20 velas;
  - F-14, O-07, O-10 y O-25: comparaciones en un borde exacto que dependen del redondeo. O-25 sí mueve la hora de la
    salida de 2 trades de ARB 15m; propongo llevar stop y objetivo al tick de la moneda, como en el exchange;
  - F-17: el cambio de carácter con una vela de estructura incompleta;
  - F-06: la señal de la ruptura de fractal con orden stop depende de que el fractal se rompa después. No cambia
    trades, sí la cuenta de señales.
- **Embudo y registro:** F-05 (dos órdenes stop cuentan cada señal dos veces), O-27 (orden del embudo), F-12 (el
  contador de variantes), O-28 (id repetido), O-18 (la misma regla como dos estrategias), O-19 (variantes de
  sensibilidad que no cambian nada), F-11 (acciones en 5m y 30m) y O-30 (el contexto del trade guarda solo 3 corridas).
- **Pantalla del trade elegido:** F-10, O-16 y O-23 (los indicadores de la regla al cambiar de marco, y el Lector VPA),
  O-01 y O-14 (la línea y el cuadro que tapan la salida), O-22 (breakers e iguales viejos), O-29 (los trades vecinos) y
  O-17 (el último precio de la fase).
- **Textos:** O-02, O-04, O-08, O-11, O-12, O-13, O-15, O-26, O-31 y O-32.
- **Elementos que conviene explicar:** O-20 (en ARB, el barrido real y la orden grande son lo mismo), O-21 (a mercado,
  el order block y la ruptura de estructura dan los mismos trades) y O-24.
- **Documentación:** los 14 puntos E (E-01 a E-04, E-06 a E-12 y E-14 a E-16). E-02 (el VF en la primera vela de la
  sesión) y E-08 (una llegada al borde de caja que no pasa los filtros gasta el tramo) piden además que elijas cuál vale.

## 6. Plan de corrección y regresión

1. **F-16** (motor 6), con su prueba de corte. Después, repetir tus 28 corridas de liquidaciones y decir qué cambió.
2. **F-02 y F-03**: el descargador y el caché, y rellenar los datos. Va con **H20**, para que las corridas de las
   monedas nuevas hechas con los datos viejos queden fuera. Después, repetir tus veredictos de las monedas nuevas.
3. **F-07 y F-08**, más **F-09** según tu decisión, en el mismo motor.
4. **Las decisiones que apruebes**, una por una, cada una con su medida antes y después. Todo lo que cambia trades va junto en un solo motor nuevo, así tus corridas quedan fuera una sola vez y se repiten una sola vez; lo que solo toca el control o el margen se recalcula sobre las guardadas.
5. **El lote de menores, cosméticos y documentación.**
6. **Regresión:**
   - todas las pruebas del backend y de la página;
   - las comparaciones con los oráculos y las invariantes en las reglas de prueba (R01 a R35 y las 76 de la etapa 6);
   - tus 18 veredictos con los controles nuevos.
7. **Commits** por grupo en esta rama cuando me lo pidas. Tu App 1 no cambia hasta que pidas unirlo a main y reinicies
   su backend.

## 7. Criterios de aceptación (sección 15 del protocolo)

| Criterio | Hoy |
|---|---|
| Sin defectos S1 ni S2 abiertos | No: F-16; F-02, F-03, F-07, F-08 y F-09; H1, H4 y H15 por decidir |
| El motor igual al oráculo en el 100% de los trades, salvo diferencias explicadas y aceptadas | Sí: todas explicadas. Falta que aceptes las que son decisiones |
| Sin futuro (I-01) en todos los elementos y filtros | No: F-16. F-06 solo en la cuenta de señales |
| Pruebas metamórficas (espejo, escala y demás) donde aplican | Sí, salvo H19, H22 y los bordes de redondeo (O-10, O-25) |
| La pantalla igual a la corrida en el 100% de los trades leídos, y la revisión visual bien | Sí: unos 55,000 trades |
| Las 43 confusiones con estado final | Sí |
| Los sesgos B-01 a B-09 medidos y decididos contigo | Medidos; falta decidir B-05 a B-08 (sección 4) |

## 8. Después de las correcciones (22/11)

Aceptaste todas las recomendaciones. Todo lo que cambia trades o el azar quedó en el **motor 6**, en esta rama, sin
commit. Las corridas de antes quedan fuera: hay que volver a correrlas.

**Regresión** (detalle en `REGISTRO.md`, "Etapa 7 · Correcciones"):
- pasan 579 pruebas del backend (fallan las 2 de siempre); en la página solo falla `liquidations.test.mjs`, como desde
  el 13/11; las del servidor y de la página de la suite pasan con este App 1;
- invariantes en 296 combinaciones de reglas y monedas, todas bien: corte sin futuro, una posición a la vez, fase,
  embudo, cuentas, espejo, escala y caché;
- capa A (el motor contra el oráculo, con las reglas del motor 6) en R01, R04b, R05b y R07c: todas las llamadas iguales;
- las velas de las 43 monedas nuevas, reparadas: 117,624 velas sumadas o corregidas.

**Tus conclusiones con el motor 6:**
- de tus 18 veredictos pasaban 11; ahora pasan 2: B5 en las fases 1 y 2 de las monedas de siempre;
- en las de siempre, la ruptura de caja (f1 y f2), solo cortos (f1) y la flecha (f1) dejan de pasar sobre todo por H1:
  el azar que entra solo donde deja la línea (EMA 200 o VWAP) gana bastante;
- en las nuevas, B5 (f1), la ruptura de caja (f1 y f2) y solo cortos (f1 y f2) dejan de pasar por B-08. Sus ventajas
  casi no cambian, pero el margen por semanas es de 1.7 a 3.4 veces el de trades independientes: 43 monedas que salen
  la misma semana se mueven juntas. **Aquí este informe se quedó corto:** daba 1.0 a 1.4, medido en las 7 de siempre;
- tus 28 corridas con liquidaciones: ninguna pasa, y en ninguna las liquidaciones le ganan con margen a los barridos sin
  ellas. Su pérdida por trade baja de −0.42 a −0.17 R casi solo por el tope de la comisión.

**Encontrado y corregido en la regresión, fuera del plan:**
- la suite habría tomado como rupturas de fractal las órdenes que nunca se rompen (por F-06): esas órdenes quedan solo
  para el probador;
- la Revisión de candidatos rechazaba tu caja propia con un stop corto (por H18): ahora se simula con su comisión.

**Pruebas adicionales, antes de limpiar la copia aislada (22 y 23/11):**
- galería de los 67 elementos: 802 casos con el motor 6, todos con la tabla de la señal en ✓
  (`revision_visual/galeria/`). **Falta tu revisión:** es la que dice si cada elemento es lo que tú entiendes por él;
- los casos nuevos del motor 6 en pantalla (un trade que entra en la vela en que salió el anterior, las velas de antes
  de la fase), la simulación manual con el 2.º gráfico y tu tablero, igual a la regresión: bien;
- la búsqueda genética corta corrió entera con el motor 6 (146 reglas y 3 finalistas, con sus vecinas y las monedas
  nuevas). No dio candidatas, como se espera de una tan corta;
- E-02 y E-08, medidos: E-02 da lo mismo (3 señales de 12,340) y en E-08 ninguna lectura le da ventaja al borde de
  caja. Y el «pasa» del tablero en la búsqueda genética, con 18 finalistas: pidiendo el margen en 2023 no quedaría
  ninguna candidata (REGISTRO, pruebas adicionales). **Decidido el 23/11:** E-02 y E-08 quedan como están, y la
  búsqueda elige con los tres controles del tablero; el margen en la validación es una casilla, apagada de fábrica;
- hallado y corregido O-33: el contexto del trade repetía la misma corrida varias veces a la vez. Solo costaba
  tiempo; no cambia ningún resultado.

| Criterio | Después de la etapa 7 |
|---|---|
| Sin defectos S1 ni S2 abiertos | Sí: F-16, F-02, F-03, F-07, F-08 y F-09 corregidos; H1, H4 y H15 decididos y hechos |
| El motor igual al oráculo en el 100% de los trades, salvo diferencias explicadas y aceptadas | Sí, en las cuatro reglas repetidas con el oráculo al día |
| Sin futuro (I-01) en todos los elementos y filtros | Sí, en los 296 casos (F-16 y F-06 corregidos) |
| Pruebas metamórficas (espejo, escala y demás) donde aplican | Sí, en los 296 casos (H19, H22 y los bordes de redondeo, corregidos) |
| La pantalla igual a la corrida en el 100% de los trades leídos, y la revisión visual bien | Sí hasta el motor 5 (unos 55,000 trades). Con el motor 6, los 802 casos de la galería y los casos nuevos, con la tabla de la señal en ✓; no se repitió la captura de todos |
| Las 43 confusiones con estado final | Sí |
| Los sesgos B-01 a B-09 medidos y decididos contigo | Sí: B-05 y B-06 como opciones; B-07 y B-08 en "pasa" |

**Veredicto:** el probador queda en condiciones de probar estrategias con el motor 6. E-02 y E-08 quedaron como están
(decidido el 23/11). Te queda volver a correr tus estrategias.
