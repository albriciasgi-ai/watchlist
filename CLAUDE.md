# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## REGLAS DEL PROYECTO

### Idioma
**IMPORTANTE**: Comunicarse SIEMPRE en español con el usuario. Todos los mensajes, explicaciones y comentarios deben ser en español.

### Perfil
Agente programador Python con experiencia en desarrollo de aplicaciones.

### Comportamiento
1. **Autonomia**: Trabajar sin preguntar. Entregar codigo completo y funcional, no mostrar borradores ni codigo parcial en el chat.
2. **Formato visual**: NO modificar estilos, CSS, layouts ni estructura visual existente.
3. **Honestidad**: Si algo no es posible o hay limitaciones, informar claramente.
4. **Calidad**: Revisar exhaustivamente antes de entregar. Ediciones pequenas y precisas, evitar refactors grandes.
5. **Analisis profundo**: Cuando se solicite, revisar archivos relacionados, dependencias, edge cases y posibles efectos secundarios.

### Limitaciones conocidas
- No puedo ejecutar codigo Python directamente para probar
- Las pruebas de funcionamiento las debe hacer el usuario

---

## VISION GENERAL DEL REPOSITORIO

Este repositorio contiene **11 aplicaciones relacionadas** para trading de criptomonedas, más la suite nueva que las irá reemplazando (carpeta 12):

| Carpeta | Aplicacion | Puerto Backend | Puerto Frontend |
|---------|------------|----------------|-----------------|
| `1.Altagracia_Crypto_Backtester/` | Backtester de estrategias | 9000 | 5173 |
| `2.WatchlistConIndicadores/` | Watchlist con indicadores en tiempo real | 8000 | 5173 |
| `3.TradingBot_Python/` | Bot de trading automatizado | 5000 | 3000 |
| `4.Analizador cripto/` | Analizador de un solo simbolo (optimizado) | 10001 | 10001 |
| `5.Order_flow/` | Analizador de Order Flow con Footprint | 11000 | 11001 |
| `6.Trading_Journal/` | Diario de trading con metricas y screenshots | 12000 | 12001 |
| `7.WatchlistDesktop/` | Watchlist version Electron (en desarrollo) | 8000 | Electron |
| `8.AnalizadorDesktop/` | **Analizador Desktop - Version Electron sin throttling** | 10001 | 5174 |
| `9.OrderFlowDesktop/` | **Order Flow Desktop - Version Electron optimizada** | 11000 | 11001 (Vite) |
| `10.TradingBotDesktop/` | **Trading Bot Desktop - Version Electron** | 5000 | 5001 |
| `11.TradingJournalDesktop/` | **Trading Journal Desktop - Version Electron** | 12000 | 12002 |
| `12.AltagraciaTradingSuite/` | **App nueva en tiempo real (gráfico de App 1 en vivo + bot), en construcción** | 13000 | 13001 (Vite) |
| `13.AltagraciaMobile/` | **App Android (Capacitor) para seguir los trades del bot, solo lectura** | puerta móvil de la suite, 13002 | 13010 (Vite, desarrollo) |

**Stack comun:**
- Frontend: React 18 + Vite + uPlot
- Backend: FastAPI + Uvicorn (Python 3.10+)
- Data Source: Bybit Futures API (REST + WebSocket)
- Desktop: Electron 33+ (Apps 7-11)

---

## HISTORIAL DE CAMBIOS RECIENTES

### Altagracia Trading Suite - 22 Noviembre 2026: DX en Vivo no Salta la Vela que Toca un Hueco

**Pedido:** al reiniciar la suite con DX ya en main, la vela de las 21:00 UTC no entró al registro: cada moneda siguió en 960 velas. El usuario pidió arreglarlo y llevarlo hasta la fusión.

**Causa:** el reinicio dejó 65 s sin grabar (21:27:30 a 21:28:36 UTC) en las 7 monedas. `of_elements` de App 1 no da una vela que toca un hueco hasta que la nube lo tapa. `dx_watch.py` avanzaba hasta donde decía el almacén, sin esa vela, y ya no volvía por ella.

**Cambios** (`12.AltagraciaTradingSuite/server/dx_watch.py`):
1. **Desde `since` no se salta ninguna vela.** La que falta (toca un hueco o pasa del último guardado) se espera hasta que la nube o el día oficial la completen, y las siguientes esperan con ella. El estado de la moneda dice cuál espera.
2. **Un registro que ya saltó una vela la vuelve a leer** (`_heal`). Lo anotado después se calcula otra vez:
   - la orden que esperaba o estaba abierta y con la vela completa no existe se anula, con un evento "anulada";
   - si algo final cambia, queda como estaba, con una revisión.
3. **Una vela que en dos días no llega se salta**, una sola vez, con un evento "hueco" en el registro.
4. **Panel:** las anuladas salen entre las últimas entradas y salidas de DX.
5. **Pruebas:** `dx_checks.py` suma 9 (48).

**IMPORTANTE:**
- La nube ya tapó el hueco del 22/11: al correr este código, el registro del usuario vuelve a leer desde la vela de las 21:00 UTC.
- **Probado en una copia de su registro** (el original no se tocó): en las 7 monedas vuelve a leer esa vela y quedan seguidas. Las órdenes que el hueco había armado una vela tarde (7) se anulan, y se arman en su vela. ARB, que tenía dos posiciones abiertas, queda con una.
- La suite del usuario corre lo de su carpeta principal: hay que ponerla al día con main y reiniciar la suite.
- Es cómo se leen los datos, no la regla ni el juicio de DX. Quedó anotado en `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`, "DX en vivo".

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "DX en vivo (22/11)"

---

### App 1 - 22 Noviembre 2026: Deslizamiento Real de QB con el Libro y Guía del VPA con Imágenes

**Pedido:** medir el deslizamiento real de la ruptura con volumen (QB), y una guía en PDF del VPA con imágenes reales de la app. Debe enseñar a usar lo programado y relacionarlo con el libro de Coulling, con un informe de las reglas corridas y recomendaciones.

**Cambios:**
1. **Deslizamiento real** (`OrderFlowData/research/vpa/deslizamiento_real_qb.py`, `DESLIZAMIENTO_REAL_QB.md`): órdenes a mercado simuladas sobre el libro completo grabado por la suite (13/11 al 22/11, 22 monedas), en la apertura de 4h y en la salida por el stop en movimientos rápidos.
   - A 10k USD cuesta de 0 R (BTC, ETH) a 0.04 R (GALA) por trade; RUNE, 0.12.
   - Fase 3, monedas nuevas con libro (546 trades): de +0.134 R a +0.120 con 10k, +0.107 con 50k y +0.069 con 250k.
   - El supuesto de 0.05% por lado (+0.104) era más duro que lo real hasta 50k.
   - Las de siempre siguen en negativo (−0.034 con 10k).
2. **Guía** `1.Altagracia_Crypto_Backtester/Backtester/GUIA_VPA.pdf` (21 páginas, reemplaza la del 21/11):
   - las ideas y la tabla «del libro al código»;
   - el tutorial con capturas reales: lector, panel, cuadro de la vela, modal, velas con ancho, probador, trade elegido, Observador;
   - el informe de todas las reglas;
   - qué explorar después.

**IMPORTANTE:**
- No cambió código de las apps: no hay que reiniciar nada.
- El libro cubre solo 9 días sin un desplome fuerte, aplicados a trades de otras fechas.
- Las capturas se tomaron en una copia aislada de App 1 con BTC.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LECTOR VPA", "Deslizamiento real con el libro" y "Guía en PDF"

---

### Altagracia Trading Suite + App 1 - 22 Noviembre 2026: DX en Vivo (paso 4 de las estrategias de Byko y Dale)

**Pedido:** seguir con el paso 4 del plan: llevar a la suite DX, la única regla de Byko y Dale que pasó las fases 2 y 3, como un detector en vivo que no envía nada al bot. El usuario pidió además entender la estrategia. Después opinó que le falta mirar la tendencia del mercado, y que podría servir refinando la lógica.

**Cambios:**
1. **Fijado antes de registrar,** en `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`, "DX en vivo":
   - la regla de las fases 2 y 3, sin cambiar nada, en las 7 monedas con almacén;
   - cómo se mide la ejecución con la cinta;
   - el juicio, con el R por trade de las 7 con la ejecución medida: a los 3 y a los 6 meses se descarta si su margen al 95% queda entero bajo cero; a los 12 meses pasa si queda entero sobre cero.
2. **Registro en vivo** (`12.AltagraciaTradingSuite/server/dx_watch.py`):
   - al cierre de cada vela de 30 minutos corre `rule_tester.run` de App 1 sobre lo visto en vivo;
   - anota las órdenes armadas, las entradas, las salidas con su R, las vencidas y las que se llenan con otra posición abierta;
   - cada vela se guarda como se vio y no se recalcula.
3. **La ejecución con la cinta:** en cada salida, el precio de una orden a mercado disparada en el stop o el objetivo, y con él el R con la ejecución medida. Además, si el precio pasó el objetivo.
   - Ese precio es el peor entre el trade del disparo y el promedio de los 100 ms siguientes.
   - Antes de registrar nada se corrigió el medio segundo que se había fijado primero: en una mecha de BTC tomaba precios de después de la vuelta.
4. **En la suite:** un panel en la Watchlist, debajo del Swing y de los sabios. Además, las limit de DX en la defensa de zona de la pestaña Mapa.
5. **App 1:** `rule_tester.run` suma `since` y `minutes` para el registro. Sin ellos, nada cambia.
6. **Pruebas:**
   - `dx_checks.py` de la suite (39): el registro vela a vela da los mismos trades que el probador, sin futuro, y al reiniciar no repite nada;
   - `test_dale.py` de App 1 suma 1 (13);
   - todas las del backend de App 1: 557 pasan y fallan las 2 de siempre. También pasan `run_checks.py`, `book_defense_checks.py` y `wise_smc_checks.py`.

**IMPORTANTE:**
- **El registro empieza cuando la suite corre este código.** La del usuario corre desde main: empieza al unir esta rama.
- **Probado con datos reales,** como si hubiera arrancado el 15/11, solo leyendo el almacén y la cinta. Esos días ya estaban en la fase 3: prueba el código, no la estrategia.
  - En las 7 monedas, lo anotado es igual a una corrida del probador.
  - 164 trades en 7.6 días: +0.27 R con la cuenta del probador y +0.26 con la ejecución medida.
  - Deslizamiento en los stops: 0.011% en la mediana; el 10% peor, más de 0.048%.
  - Una copia aislada del servidor registró en vivo, y el panel se vio en la Watchlist.
- **Zonas unidas:** si dos zonas se arman en la misma vela y del mismo lado, el probador las une. El stop queda lejos del 10% al 20% del ATR diario que pide Dale: 17 de 164 trades, con 2.8% del precio de riesgo y −0.32 R. Las fases 2 y 3 se corrieron así, y el registro lo conserva.
- **Confirmar la ventaja lleva tiempo:** las 7 monedas dan unos 650 trades por mes. Para confirmar con margen los +0.03 R de la fase 3 hace falta un año.
- **Una versión refinada** sería otra hipótesis: la tendencia a favor y una orden por zona. Se explora en la fase 1 y se juzga con su propio registro, sin tocar el de DX.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "DX en vivo (22/11)" y `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`, "DX en vivo"

---

### App 1 - 22 Noviembre 2026: Hipótesis de los Apilados Desplazados (DX), Juzgada en las Fases 2 y 3

**Pedido:** juzgar la curiosidad de la fase 1 de Dale (las zonas desplazadas de los apilados ganaban) como una hipótesis nueva, fijada antes de correrla y juzgada en las fases 2 y 3.

**Cambios:**
1. **Fijada antes de correrla** en `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`, "Hipótesis nueva: los apilados desplazados (DX)":
   - la regla, las 7 monedas con almacén juntas y el control;
   - el criterio: R por trade positivo con margen y ventaja con margen sobre el azar y el tramo;
   - la fase 3, solo si pasaba la 2.
2. **DX** en el probador (`backend/dale.py`): el control de DS como regla, con su misma semilla. Su control son las mismas zonas ancladas en velas al azar ("¿Aporta anclar en los apilados?").
3. **Ventana:** DX va con las zonas de Dale, con su nombre y su control.
4. **Pruebas:** `test_dale.py` suma 2 (12). Todas las del backend de App 1: 556 pasan y fallan las 2 de siempre. La página compila y sus pruebas pasan.

**IMPORTANTE:**
- **Pasa la fase 2 y la fase 3**, por poco:
  - fase 2: 10,747 trades y +0.056 R por trade (de +0.028 a +0.084);
  - fase 3: 11,416 trades y +0.030 R (de +0.003 a +0.057);
  - en las dos le gana con margen al azar y al tramo.

  Es la única regla de los PDF de Byko y Dale que pasa.
- **Lo que la debilita:**
  - la ventaja se achica: +0.099, +0.056 y +0.030 en las tres fases;
  - antes de comisiones es estable (+0.18 R), pero los stops son de 0.6% del precio y la comisión se lleva de 0.12 a 0.14 R;
  - BTC pierde en las dos fases, por la comisión;
  - en la fase 3 las zonas ancladas en velas al azar casi la igualan.
- **Con deslizamiento** (medido después, sin cambiar el veredicto) aguanta solo con el objetivo como orden limit y el stop deslizando 0.02% o menos. Con las dos salidas a mercado y 0.02%, se va.
- Se corrió con `OrderFlowData/research/dale/2026-11-22/dx.py` y `costes.py`, sin guardar corridas en el registro del usuario. Resumen en `resumen.md` de esa carpeta.
- **Lo que sigue** según el plan es el paso 4: un detector en vivo en la suite, sin enviar nada al bot. Serían los primeros datos frescos de verdad, con el llenado y el deslizamiento reales.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ZONAS DE TRADER DALE CON EL PRIMER REGRESO (21/11/2026)", "Hipótesis DX"

---

### App 1 - 22 Noviembre 2026: Zonas de Trader Dale con el Primer Regreso (paso 3 de las estrategias de Byko y Dale)

**Pedido:** "Sigue con Dale", tras cerrar Byko. La idea de *Order Flow Trading Setups*: una zona marcada por el volumen, el precio se aleja una o dos velas completas y se entra en el primer regreso. El probador nunca lo había probado: AP y GR no se habían corrido, y ST solo a mercado en la vela del evento.

**Cambios:**
1. **Cifras fijadas antes de correr**, en `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md` (paso 3):
   - la zona se arma con 2 velas completas seguidas del mismo lado, sin tocarla, en 200 velas como mucho;
   - limit en su borde cercano, válida 200 velas, y stop entre el 10% y el 20% del ATR diario, como pide Dale;
   - 2R, en 30 minutos, y las variantes declaradas;
   - la condición para ser candidata, la misma de Byko.
2. **Cinco elementos** en el probador (`backend/dale.py`):
   - **DS, apilados**, **DN, nodo doble** y **DG, orden grande:** las franjas de ST, AP y GR, en las monedas con almacén;
   - **DA, acumulación:** el POC de la caja que termina con una ruptura, tras un movimiento de 3 ATR;
   - **DC, cluster del tramo:** el pico de volumen del tramo, mirado cada 5 ATR que crece. Es también el proceso manual del usuario.
3. **Control "zonas desplazadas":** las mismas zonas movidas de 1 a 3 ATR, con la misma mecánica. El informe "Todas" lo junta.
4. **Ventana:** las fichas, sus parámetros, el botón «Entrada, stop y objetivo de Dale» y "¿Aporta dónde estuvo el volumen?".
5. **Arreglado en el probador:** el tramo de una moneda cuyo almacén se está armando ya no se guarda, y uno guardado antes de que se escribieran sus días se vuelve a detectar (`_store_settled`). Pasó con SUI durante la fase 1.
6. **Pruebas:** `tests/test_dale.py` (10) y una más en `test_rule_tester.py` (17). Todas las del backend de App 1: 554 pasan y fallan las 2 de siempre.

**IMPORTANTE:**
- Como con Byko, el backend del usuario corre desde main y no conoce estos elementos hasta que se una esta rama. La fase 1 se corrió con `OrderFlowData/research/dale/2026-11-21/fase1.py`, sin guardar corridas en su registro.
- **Fase 1: ninguna es candidata** (16 corridas):
  - **dónde estuvo el volumen no aporta:** ninguna zona le gana con margen a sus zonas desplazadas. Los apilados dan +0.01 R por trade en 16,703 trades, y sus zonas desplazadas, +0.10;
  - **la mecánica le gana al azar, pero pierde:** entrar con una limit en el primer regreso da más que entrar a mercado al azar en 15 de 16 corridas. Aun así, salvo los apilados, todas pierden de −0.07 a −0.19 R;
  - **el proceso del usuario** (el cluster del tramo con el OI sostenido) tampoco: −0.10 y −0.13 R.
- **Cierre:** las cinco zonas quedan descartadas. Resumen en `OrderFlowData/research/dale/2026-11-21/resumen.md`. Después, la curiosidad de los apilados desplazados pasó las fases 2 y 3 como hipótesis nueva (entrada de arriba).
- **SUI:** el panel armó su almacén mientras corría la fase 1. El tramo a medio armar que quedó guardado se borró, y DS, DN y DG se repitieron con SUI: dan lo mismo.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ZONAS DE TRADER DALE CON EL PRIMER REGRESO (21/11/2026)" y `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`

---

### App 1 - 22 Noviembre 2026: El Ripple entre Marcos del VPA (Estudio y Filtro)

**Pedido:** el «ripple» de Coulling (el marco mayor manda): primero un estudio y, después, el filtro.

**Cambios:**
1. **Estudio** (fase 1, QB en 1h y 4h, con el medidor de 4h y de 1 día en su última vela cerrada):
   - va al revés del libro: con el marco mayor fuerte a favor, QB pierde en los cuatro grupos (de −0.14 a −0.48 R);
   - con el mayor neutro suele rendir más.
2. **Filtro del medidor en un marco mayor** en el probador: «leído en» 1 hora, 4 horas o 1 día, sin futuro, y el modo nuevo «que no esté a favor más de».
3. **Por el probador**, sin entrar con el marco mayor fuerte a favor: QB 4h pasa de +0.063 a +0.073 R en las monedas nuevas y de +0.14 a +0.13 en las de siempre. QB 1h pierde con o sin el filtro. No mueve la ventaja: el ripple no se lleva a la fase 2.
4. **Pruebas:** `test_vpa.py` suma 2 (10) y `rulefacets.test.mjs` 1 (14).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- Las corridas de QB en 1h y con el filtro quedaron en el registro y en el tablero, solo en la fase 1.
- No se vio en pantalla: la página compila.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LECTOR VPA", "El ripple entre marcos" y `OrderFlowData/research/vpa/RIPPLE_QB.md`

---

### App 1 + Altagracia Trading Suite - 22 Noviembre 2026: Deslizamiento de la Ruptura con Volumen, el Observador contra el Lector VPA y Signos en el Modal

**Pedido:** medir el deslizamiento de la ruptura con volumen (QB), que el Observador compare las lecturas del usuario con las del lector VPA, y poner en el modal del lector, junto a cada casilla, el signo que se ve en el gráfico.

**Cambios:**
1. **Deslizamiento de QB** (`OrderFlowData/research/vpa/deslizamiento_qb.py`, sobre las corridas guardadas):
   - el stop de 1.5 ATR en 4h es ancho: 0.05% por lado cuesta 0.02 a 0.04 R por trade;
   - fase 3 en las 43 monedas nuevas: de +0.09 a +0.06 R con 0.05% (el margen apenas toca el cero) y +0.04 con 0.10%;
   - deja el R en cero con unos 0.18% por lado.
2. **Observador contra el lector:** cada orden guarda lo que decía el Lector VPA al decidir, en su marco, en 1 hora y en 4 horas: el medidor a favor, neutro o en contra (desde ±0.3) y los elementos Q de las 3 últimas velas. Las órdenes de antes se leen una vez y quedan en `observer/vpa_readings.json`.
   - En cada orden cerrada, la fila «Lector VPA»;
   - en el informe, «Tú contra el lector VPA» (acierto y R según el lector) y seis condiciones nuevas.
3. **Modal del Lector VPA:** cada elemento con su signo entre paréntesis: «Ruptura con volumen (▲)».
4. **Suite:** su journal muestra la fila del lector en los trades nuevos.
5. **Pruebas:** `test_observer.py` suma 3 (60), `observer.test.mjs` 1 (45) y `journal_checks.py` de la suite pasa (89).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página. La suite se reinicia sola al abrirla y arma la página nueva.
- La primera vez, el informe del Observador tarda unos 20 s mientras lee el lector de las órdenes anteriores.
- Con las 32 órdenes cerradas del usuario: con el lector a favor, 8 órdenes, 75% y +1.24 R; neutro, 19, 21% y −0.31 R; en contra, 5, 40% y −0.02 R. Son muy pocas para concluir.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LECTOR VPA", "Deslizamiento", "El Observador contra el lector" y "Signos en el modal"

---

### Altagracia Trading Suite + Collector de Northflank - 22 Noviembre 2026: Hyperliquid También en la Nube

**Pedido:** el usuario preguntó por el cupo de Northflank y si convenía una segunda cuenta para guardar Hyperliquid. Como es un prototipo, tiene que ser gratis: va dentro del collector que ya existe.

**Cambios:**
1. **Lista de cuentas por partes** (`hl_recorder.py`): el leaderboard (~38 MB) se lee a medida que llega, sin tenerlo entero en memoria. Con la lista real da las mismas 1,218 cuentas, con 1 MB de memoria contra 258 MB. Vale también en el PC.
2. **Collector de Northflank:** corre el mismo grabador (copia exacta) y guarda 14 días (`HL_KEEP_DAYS`), unos 180 MB. Rutas para bajar cada día desde un byte.
3. **Suite** (`hl_cloud.py`): cada 10 minutos baja lo nuevo a `OrderFlowData/live/hyperliquid_cloud`. `hl_recorder.read_rows` junta PC y nube.
4. **Pruebas:** `hl_checks.py` (34) y `hl_cloud_checks.py` (16).

**IMPORTANTE:**
- **Desplegado el 22/11** (build `clear-muscle-9783`, commit 0db5b61 de la rama `deploy`). En la nube: la lista de cuentas (46,409 filas, 1,217 cuentas) bajó en segundos y la primera vuelta completa tardó 226 s, con 1,009 posiciones. El servicio quedó en 181 de 512 MB. Antes de reiniciarlo, tras 8 días encendido, estaba en 362 MB.
- La suite se reinicia sola al abrirla y desde ahí baja lo de la nube. Probado contra la nube real, en una carpeta temporal: la primera vuelta bajó 126 KB y la segunda, nada.
- La página de Northflank tardó unos 3 minutos en cargar: su archivo principal baja a unos 25 KB/s.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Hyperliquid (21/11)", "En la nube (22/11)", y `5.Order_flow/cloud_collector/DEPLOY_NORTHFLANK.md` sección "Hyperliquid (22/11/2026)"

---

### App 1 - 21 Noviembre 2026: Elementos de Byko en el Probador (paso 2 de las estrategias de Byko y Dale)

**Pedido:** "Sigue con Byko", tras aprobar el concepto y bajar el OI de 5 minutos.

**Cambios:**
1. **Cifras fijadas antes de correr**, en `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md` (paso 2):
   - las reglas: 1 hora, las cajas de la pestaña Régimen, entrada a mercado, stop en el borde lejano de la zona con 0.1 ATR y objetivo de 3R;
   - las variantes declaradas;
   - la condición para ser candidata a la fase 2: R positivo, ventaja sobre el azar y el tramo, y diferencia positiva contra "sin la firma", las tres con margen.
2. **Cuatro elementos** en el probador (`backend/byko.py`):
   - **FB, falso rompimiento:** perfora el borde de una caja y vuelve adentro. Firma: llegada impulsiva y volumen 3 veces o más el de su hora;
   - **BA, ruptura tras acumulación:** firma, 6 velas pegadas al borde con mínimos crecientes;
   - **TA, trampa de absorción:** en el borde, el OI salta y el precio no avanza;
   - **PO, purga de OI:** el OI cae de golpe al final de un movimiento acelerado con volumen.
3. **Control "sin la firma":** cada corrida repite la regla con los candidatos que no la cumplen (como el barrido sin liquidaciones). El informe "Todas" lo junta para todas las monedas.
4. **Ventana:** las fichas, sus parámetros con las cifras del plan, «Vas a correr» y "¿Aporta la firma de Byko?".
5. **Pruebas:** `tests/test_byko.py` (9). `test_stocks.py` se ajustó: las acciones no tienen OI, así que tampoco trampa ni purga. Todas las del backend de App 1: pasan todas, salvo las 2 de siempre.

**IMPORTANTE:**
- El backend del usuario corre desde main y no conoce estos elementos hasta que se una esta rama. Por eso la fase 1 se corrió con un script aparte que no guarda corridas en su registro: `OrderFlowData/research/byko/2026-11-21/fase1.py`, con los resultados en `resultados.json` y `resumen.md` de esa carpeta.
- **Fase 1:**
  - el falso rompimiento no funciona: en 1 hora, con 6,135 trades, pierde como el azar, y en 4 horas la firma empeora;
  - la ruptura tras acumulación es candidata a la fase 2 solo en 4 horas y en las monedas nuevas: 95 trades, +0.58 R, con margen sobre el azar, el tramo y las rupturas sin la firma. La pone casi toda 2022 y los cortos, y fue una de 10 corridas.
- **Fase 2 de la ruptura en 4 horas** (aprobada por el usuario, con el criterio fijado antes): **no pasa y queda descartada.** En las monedas nuevas da 74 trades y −0.43 R, y pierde con margen contra los tres controles. En las de siempre, 11 trades y +0.07 R; en las acciones, 33 y −0.59 R.
- **Trampa y purga** (fase 1, al terminar la bajada del OI):
  - **trampa:** no es candidata. En 1 hora, en las monedas nuevas, el salto del OI separa algo (+0.29 R contra las llegadas sin él, con margen), pero no le gana al azar ni al tramo, y con el OI de Bybit solo se va;
  - **purga:** pierde como el azar.
- **Cierre:** ninguna de las cuatro reglas de Byko da ventaja (22 corridas de la fase 1 y una de la fase 2). Resumen en `OrderFlowData/research/byko/2026-11-21/resumen.md`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE BYKO EN EL PROBADOR (21/11/2026)"

---

### App 1 - 21 Noviembre 2026: OI de 5 Minutos de Bybit y Binance (paso 1 de las estrategias de Byko y Dale)

**Pedido:** leer tres PDF de estrategias aparte y dar un concepto para App 1 y la suite: dos de Byko (Bikotrading: tres firmas del OI, falso rompimiento y ruptura) y *Order Flow Trading Setups*, de Trader Dale. El usuario aprobó el concepto: dos experimentos, cómo llega el precio al borde y la zona con el primer regreso. Después preguntó por qué bajar el OI de 1 hora de Bybit y el de 5 minutos de Binance, en vez de los dos marcos de los dos.

**Cambios:**
1. **Plan:** `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`, con:
   - las reglas literales de los PDF y lo que falta fijar antes de correrlas;
   - los controles propios: el mismo borde sin la firma y zonas al azar con la misma mecánica;
   - cuatro pasos.
2. **OI de 5 minutos** de Bybit y de Binance, desde que listan cada moneda (`backend/oi_history.py`, en `OrderFlowData/oi/5m/`):
   - el OI es una foto: 15 minutos, 1 hora y 4 horas salen de tomar el de 5 minutos en su marca;
   - Binance trae, además, las proporciones de largos y cortos y la de compra contra venta agresiva;
   - la lectura no mira el futuro: cada dato se usa 5 minutos después de su marca;
   - da la suma de los dos: Binance + Bybit ÷ 2;
   - `market_update.py` pone al día lo nuevo al arrancar el backend.
3. **Pruebas:** `tests/test_oi_history.py` (14). Pasan también las de `test_market_update.py`.

**IMPORTANTE:**
- La nota "5min ~416 días (límites de Bybit)" era el tope del descargador viejo: Bybit da 5 minutos desde que lista cada moneda. Quedó corregida en `1.Altagracia_Crypto_Backtester/CLAUDE.md`.
- **Ningún filtro usa todavía esta serie**, así que ninguna regla ya corrida cambia. La usarán los elementos de Byko (paso 2).
- **La bajada completa de las 50 monedas** se lanzó aparte el 21/11. Si se corta, se retoma con `python -B oi_history.py --backfill`. Registro en `OrderFlowData/oi/5m/descarga.log`.
- **Comprobado en ARB:**
  - las 3,333 marcas de 4 horas son iguales a las de `ARBUSDT_4h.json`;
  - Binance trae ceros sueltos (57) y 4 huecos propios.
- El código está en la rama de esta sesión: la actualización automática llega al backend del usuario cuando se una a main.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "OI DE 5 MINUTOS DE BYBIT Y BINANCE (21/11/2026)" y `docs/PLAN_ESTRATEGIAS_BYKO_DALE.md`

---

### Altagracia Trading Suite + App 1 - 21 Noviembre 2026: Indicador "Liquidaciones Hyperliquid" y Grabación Cada Minuto

**Pedido:** tras ver el mapa de liquidaciones de Hyperliquid, el usuario eligió llevarlo como indicador al gráfico principal, y preguntó si se podía grabar minuto a minuto para el mapa.

**Cambios:**
1. **Indicador "Liquidaciones Hyperliquid"** en la lista del gráfico principal de la suite:
   - las 3 franjas más cargadas de cada lado: cortos arriba, largos abajo;
   - cada una con su USD, sus cuentas y a qué % del precio está;
   - se puede elegir para el análisis del trade;
   - se actualiza cada minuto.

   El código está en App 1 (`HyperliquidLiqIndicator.js`, `hlLiquidations.js`), que no lo ofrece.
2. **Grabación más fina:**
   - el estado de cada moneda pasa de cada 5 minutos a cada minuto;
   - nueva vuelta rápida cada minuto con las cuentas que tienen liquidaciones a menos de 10% del precio, hasta 200 (`fast/`);
   - las 1,200 cuentas siguen cada 15 minutos: la API no deja consultarlas todas cada minuto.
3. **Arreglado:** la primera vuelta de posiciones llegaba unos 20 minutos después de abrir la suite: si la lista de cuentas todavía bajaba, dormía la vuelta entera. Ahora reintenta cada 30 s.
4. **Pruebas:** `hl_checks.py` (29) y `hlliquidations.test.mjs` de App 1 (6). `liquidations.test.mjs` sigue con su falla de siempre.
5. **Probado en pantalla** en una copia aislada de la suite (BTC 15m y 4H): las franjas, sus etiquetas, el estado y el menú de análisis. No en Electron.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva. El indicador viene apagado: se enciende en "Indicadores".
- Las franjas son de cuentas concretas, a veces de una sola. No está validado contra el azar: el estudio necesita semanas de datos.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Hyperliquid (21/11)"

---

### App Android (carpeta 13) + Altagracia Trading Suite - 21 Noviembre 2026: App de Solo Lectura y Pantalla del QR (fase 2)

**Pedido:** seguir con la fase 2 de la app Android: la app de solo lectura, la pantalla del QR en la suite y ver las posiciones de Bybit con el PC apagado.

**Cambios:**
1. **App** (`13.AltagraciaMobile`, React + Vite + Capacitor 7):
   - inicio con la cuenta activa, el P&L abierto y las posiciones sin stop;
   - posiciones con P&L, stop, objetivo, "Al SL" y "Al TP";
   - trades de 30 días con su decisión y sus capturas;
   - avisos, guardados en el celular;
   - ajustes: emparejar por QR o pegando el código, avisos y claves del modo directo.
2. **Modo directo:** sin respuesta de la suite, la app lee posiciones y saldo directo de Bybit con una clave de solo lectura guardada en el celular. Solo hace GET.
3. **Suite:** Bot > "Configuración y riesgo" > "Celulares (app Android)": emparejar con QR, revocar y aviso de prueba.
4. **Puerta móvil:** corrige el reloj del celular y deja leer a la página local de la app.
5. **Pruebas:** `13.AltagraciaMobile/tests/app.test.mjs` (8) y `mobile_checks.py` de la suite (90).

**IMPORTANTE:**
- **El APK no se armó:** este PC no tiene Java ni el SDK de Android. Los pasos están en `13.AltagraciaMobile/CLAUDE.md`.
- **Probado en el navegador** a tamaño de celular, contra una puerta de demostración con datos inventados.
- **No probado:** en un celular, el lector de QR, los avisos push, el modo directo contra Bybit real ni la pantalla del QR de la suite en pantalla.
- La suite se reinicia sola al abrirla e instala el paquete nuevo de la página (`qrcode`).
- Falta la fase 3: cerrar una posición desde la app, con huella y confirmación.

**Ver:** `13.AltagraciaMobile/CLAUDE.md` y `12.AltagraciaTradingSuite/CLAUDE.md` sección "Puerta móvil"

---

### Altagracia Trading Suite - 21 Noviembre 2026: Puerta Móvil (fase 1 de la app Android)

**Pedido:** una app Android para seguir los trades que el bot abre en Bybit y, cuando exista, en Alpaca: aviso al abrirse una posición, las capturas de apertura y cierre, y cerrar una posición desde el celular. El usuario aceptó el concepto y pidió la fase 1. También pidió ver las posiciones de Bybit con el PC apagado.

**Cambios** (solo el servidor de la suite; la app todavía no existe):
1. **Puerta móvil** (`server/mobile_gate.py`): otra aplicación, en su propio puerto (13002), apagada de fábrica. Solo lectura: resumen, posiciones, trades con sus imágenes y eventos. Sin rutas de órdenes ni de claves.
2. **Celulares emparejados** (`server/mobile_devices.py`): el secreto se muestra una vez en el PC (para un QR) y cada pedido va firmado, con hora y número único.
3. **Vigilante y avisos** (`server/mobile_events.py`): lee el bot cada 5 s y anota aperturas, cierres con P&L y R, avisos críticos, pausa y bot sin responder. Los envía por Firebase cuando esté configurado.
4. **Pruebas:** `server/tests/mobile_checks.py` (86).

**IMPORTANTE:**
- **Nada cambia hasta encenderla:** hace falta `mobile_host` (la IP de Tailscale del PC) en `config/suite.json`.
- **Avisos push:** faltan el proyecto de Firebase del usuario y el paquete `google-auth`, que no está instalado.
- **Con el PC apagado** (fase 2): la app leerá las posiciones directo de Bybit con una clave de solo lectura guardada en el celular.
- **Alpaca:** el bot no opera ahí. Todo lleva el campo `broker` para sumarlo después.
- **No probado** con un celular, Tailscale, Firebase real ni el bot real.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Puerta móvil (21/11): fase 1 de la app Android"

---

### Altagracia Trading Suite - 21 Noviembre 2026: Grabación de Hyperliquid (paso 2 del plan on-chain)

**Pedido:** grabar Hyperliquid, el paso 2 de `docs/PLAN_INDICADORES_ONCHAIN.md`. Sus posiciones con precio de liquidación son públicas, pero su historia gratis empieza en 2025.

**Cambios:**
1. **`server/hl_recorder.py`:** arranca con el servidor de la suite y solo lee la API pública `info`. Graba en `OrderFlowData/live/hyperliquid/`:
   - el estado de cada moneda de la suite cada 5 minutos: interés abierto, funding, precio marca y de oráculo, prima y volumen;
   - una vez al día, las cuentas a seguir: 300 por capital y 1,000 por volumen del mes, unas 1,200;
   - sus posiciones, con su precio de liquidación, cada 15 minutos.
2. **Rutas:** `/api/hyperliquid/status`, `/ctx/{símbolo}` y `/liqmap/{símbolo}` (el USD que se liquidaría por franja de precio). `/api/suite/status` trae `hyperliquid`.
3. **Pruebas:** `server/tests/hl_checks.py` (22). Siguen pasando `run_checks.py` (46) y `book_checks.py` (69).

**IMPORTANTE:**
- La suite se reinicia sola al abrirla, y graba desde entonces. `SUITE_HL=0` lo apaga.
- Graba solo con la suite abierta: para semanas seguidas habría que llevarlo a Northflank.
- **Medido en vivo el 21/11:**
  - las cuentas a seguir tardan 2.5 minutos, una vez al día;
  - la vuelta de posiciones tarda 5 minutos;
  - en BTC, 150 M USD de largos y 170 M de cortos se liquidarían a menos de 25% del precio;
  - ocupa unos 6 MB por día.
- **Falta:** el indicador del mapa en el gráfico y, con semanas de datos, el estudio contra niveles al azar.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Hyperliquid (21/11)"

---

### App 1 - 21 Noviembre 2026: Objetivo Mixto con los Flujos On-Chain

**Pedido:** tras ver que el filtro de emisión de stablecoins no mejora la ventaja de las reglas, el usuario propuso usarlo para el objetivo: en los días que pasa, buscar un objetivo más alto porque el mercado da más, y en los demás dejar el de siempre. Después pidió confirmarlo con la regla mixta en la fase 1 y llevarlo a la app.

**Lo medido** (fase 1, 4h, Impulso, FVG nuevo y Ruptura de caja, las 7 monedas de siempre y las 43 nuevas):
1. **Con el filtro, los trades llegan más lejos.** De 3R a 5R el R por trade sube en las tres reglas. Sin el filtro, subir el objetivo empeora.
2. **La regla mixta** (5R con la emisión de 30 días a favor, 3R sin ella) en una corrida, con los controles usando la misma salida:
   - da el mayor R total en 5 de 6 casos. Impulso en las monedas nuevas: +623 R, contra +376 con 3R siempre y +548 con 5R siempre;
   - sube en 2021, 2022 y 2023.
   - Mejora la salida, no la entrada.

**Cambios:**
1. **Salida "Otro objetivo con los flujos on-chain a favor"** en el probador (`exit.chainTarget`). Solo va con el objetivo en R y sin arrastre. Los controles al azar y del tramo usan la misma salida. Cada trade guarda `chain_on`.
2. **Comprobado:** da los mismos números que el script del estudio.
3. **Pruebas:** `test_onchain_flows.py` suma 1 (7). `rulefacets.test.mjs` suma 1 (13).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- Es un hallazgo de la fase 1, que ya se miró. La prueba de la fase 2 quedó definida antes de mirar en `docs/PLAN_INDICADORES_ONCHAIN.md`.
- **Fase 2 (corrida el mismo día): no pasa.** En las monedas nuevas da menos R total en las tres reglas: Impulso +520 contra +608 con 3R siempre. Los días con el filtro fueron los peores, al revés que en la fase 1. La emisión queda como dato. Las tres reglas con 3R sí pasan la fase 2 contra los controles.
- No se vio en pantalla.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "FLUJOS ON-CHAIN (21/11/2026)" y `OrderFlowData/research/onchain/2026-11-21/`

---

### App 1 + Altagracia Trading Suite + Entrenamiento - 21 Noviembre 2026: Fase 2 de la Ruptura con Volumen, Velas con Ancho por Volumen y Etapa VPA del Gimnasio

**Pedido:** tres cosas: correr la fase 2 de la ruptura con volumen, las velas con ancho por volumen y una etapa del VPA en el Gimnasio.

**Cambios:**
1. **Fase 2 de la ruptura con volumen** (4h, a mercado, stop 1.5 ATR, 3R):
   - en las 43 monedas nuevas pasa en las dos fases: en la fase 2 da +0.21 R por trade, con 2,985 trades, +0.22 sobre el azar y +0.18 sobre el tramo, con margen, en 35 de 43 monedas;
   - en las 7 de siempre la fase 2 da +0.16 R: supera al azar con margen y al tramo sin él.

   Es la primera regla del VPA que pasa la fase 2. Las corridas quedaron en el registro y en el tablero.
2. **Velas con ancho por volumen**, una opción del Lector VPA:
   - el cuerpo es más ancho con más volumen frente a lo normal de su hora; con el volumen normal queda el ancho de siempre;
   - las velas no se mueven en el tiempo;
   - vale en la simulación manual, el 2.º gráfico, el backtesting global y la suite.
3. **Etapa «Leer el VPA»** del Gimnasio, que pasa a llamarse **Gimnasio Trading**, con cinco habilidades y sus fichas para `/entrenar`. El entrenador de la página ya conoce el lector, y `verificar.py` da la lectura VPA de la vela.
4. **Pruebas:** `vpa.parity.test.mjs` suma 1 (8).

**IMPORTANTE:**
- Basta recargar la página de App 1: el backend no cambió en esta entrada. La suite se reinicia sola al abrirla y arma la página nueva.
- El Gimnasio publicado ya tiene la etapa nueva. Las sesiones anotadas antes siguen igual.
- **Probado en pantalla** con una copia aislada en BTC 4h, midiendo los cuerpos de las velas con la opción apagada y encendida. App 1 y la suite compilan. La etapa del Gimnasio no se vio en pantalla: su código es válido.
- **Fase 3, corrida después:** en las 43 monedas nuevas pasa (+0.09 R por trade, 2,765 trades, +0.09 sobre el azar y +0.13 sobre el tramo, con margen, 31 de 43 monedas), con la ventaja a la mitad de la fase 2; en las 7 de siempre cae (−0.02 R). Ver `OrderFlowData/research/vpa/FASE3_QB.md`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LECTOR VPA" y `OrderFlowData/research/vpa/FASE2_QB.md`

---

### App 1 - 21 Noviembre 2026: Flujos On-Chain en el Backtesting Global (paso 1 del plan on-chain)

**Pedido:** evaluar indicadores de la actividad de las blockchains (como el flujo privado y el MEV) que avisen un movimiento del precio, y usarlos en el backtesting global con datos gratis de varios años. Después, dejar un plan con el paso a paso.

**Lo que se encontró:**
- el MEV y el flujo privado quedaron descartados: son efectos de segundos en los DEX;
- lo único gratis con años de historia son los datos diarios de Coin Metrics;
- Dune ya no es gratis para correr consultas;
- Hyperliquid solo tiene historia desde 2025, así que hay que grabarlo.

**Cambios:**
1. **Datos:** `backend/onchain_flows.py` baja de Coin Metrics a `OrderFlowData/onchain/`:
   - flujos de BTC y ETH a los exchanges y su saldo, desde 2011 y 2015;
   - la emisión de USDT y USDC;
   - `market_update.py` los pone al día al arrancar el backend.
2. **Filtro "Flujos on-chain (diarios)"** en el probador, con gen en la búsqueda genética, apagado de fábrica. Dos medidas en z-score contra el año anterior:
   - el flujo neto a los exchanges;
   - la emisión de stablecoins.
   Cada dato se usa desde las 06:00 UTC del día siguiente.
3. **Plan:** `docs/PLAN_INDICADORES_ONCHAIN.md`, con cinco pasos:
   - flujos diarios (hecho);
   - grabar Hyperliquid;
   - mempool de BTC;
   - stablecoins por hora, de pago, solo si algo muestra ventaja;
   - en vivo en la suite.
4. **Pruebas:** `test_onchain_flows.py` (6). `rulefacets.test.mjs` suma la pieza nueva (11).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- **Primer estudio** (fase 1, 4h, siete monedas):
  - la emisión de stablecoins a favor sube el Impulso de +0.16 a +0.38 R por trade, sobre los dos controles, en las 7 monedas;
  - pero son 137 días distintos, casi todo de 2022 y 2023: es candidata, no resultado.
- **Flujo neto:** mejora hasta las entradas al azar, pero no les suma a las reglas.
- **Licencia:** Coin Metrics es no comercial (CC BY-NC 4.0).
- **No se probó en pantalla.**

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "FLUJOS ON-CHAIN (21/11/2026)" y `docs/PLAN_INDICADORES_ONCHAIN.md`

---

### App 1 - 21 Noviembre 2026: VPA, Causa y Efecto y Salida VPA (Fases 3 y 4)

**Pedido:** seguir con las fases 3 y 4 de la propuesta del VPA, y una guía en PDF para usarlo.

**Cambios:**
1. **Fase 3, causa y efecto (solo estudio):** el largo y el alto de una congestión no predicen lo que recorre su ruptura (ρ de −0.08 a +0.08, 4h y 1h, en las monedas de siempre y en las nuevas). El objetivo medido no gana a uno fijo. No se agregó un objetivo por la congestión.
2. **Fase 4, salida VPA** en el probador: sale en la apertura siguiente al primer aviso en contra, con las lecturas que se marquen (clímax o frenado, esfuerzo en contra, retroceso con volumen, medidor en contra, esfuerzo que se agota) y armada desde N R. Los controles al azar usan la misma salida.
3. **Medido** (fase 1, 4h, tres entradas):
   - con todas las lecturas sale a las 2 o 3 velas y la ventaja casi desaparece;
   - con una sola queda como un objetivo de 3R;
   - ninguna supera al trailing de 4 ATR.
4. **Guía** `1.Altagracia_Crypto_Backtester/Backtester/GUIA_VPA.pdf`.
5. **Pruebas:** `test_vpa.py` suma 1 (8), `rulefacets.test.mjs` 1 (12) y `ruletester.test.mjs` una comprobación (15).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- **Probado en pantalla** con una copia aislada, en el backtesting global con BTC 4h: la salida VPA encendida, la corrida y un trade con su salida. Las del probador en el backend (76) pasan.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LECTOR VPA", "Fase 3" y "Fase 4"

---

### App 1 + Altagracia Trading Suite - 21 Noviembre 2026: Lector VPA (Volume Price Analysis de Anna Coulling)

**Pedido:** leer *A Complete Guide To Volume Price Analysis* de Anna Coulling y proponer qué aprovechar. La autora dice que VPA "es un arte" y no se automatiza; el usuario cree que sí, con algo difuso que se adapte. Eligió las fases 1 y 2 de la propuesta.

**Cambios:**
1. **Lector VPA** (`vpa.js` y `backend/vpa.py`, iguales al bit), con reglas propias: el libro no trae números.
   - Volumen y rango de cada vela contra la mediana de su misma hora en 30 días.
   - Cada lectura es un grado de 0 a 100%: esfuerzo sin resultado, resultado sin esfuerzo, validado, estrella, martillo, hanging man, doji y esfuerzo que se agota.
   - El tramo y lo que lleva recorrido pesan las lecturas de giro.
   - Un medidor de fuerza y debilidad suma la evidencia de cada vela y se desvanece: ninguna vela decide sola, como pide el libro.
2. **Indicador "Lector VPA"** en la simulación manual, el 2.º gráfico, el backtesting global y la suite (gráfico y Watchlist), con su modal: panel con el medidor, los elementos sobre las velas con su grado y el cuadro de cada vela para "Incluir en el análisis".
3. **Probador:**
   - ocho elementos: esfuerzo sin resultado, ruptura con volumen, ruptura sin volumen, retroceso sin volumen, prueba de poco volumen, frenado o techo, clímax y cruce del medidor;
   - el filtro del medidor (a favor, o que no esté en contra), con los controles al azar filtrados igual y su fila en el trade elegido;
   - la búsqueda genética lo suma apagado de fábrica.
4. **Estudio con el delta real** (fase 1, seis monedas): en las velas de esfuerzo sin resultado el lado contrario al color pesa más, como dice el libro. En la estrella con volumen alto pesan más los compradores agresivos: son los atrapados.
5. **Fase 1 por el probador** (4h, siete monedas):
   - la ruptura con volumen da +0.12 a +0.14 R por trade, +0.12 sobre los controles, 6 de 7 monedas, en el borde de su margen;
   - el esfuerzo sin resultado no anticipa el giro: seguir el color de la vela da +0.14;
   - la prueba de poco volumen (−0.23) y el cruce del medidor (−0.11) pierden en todas las monedas;
   - como filtro, el medidor no mejora al FVG nuevo ni a la ruptura de caja.
6. **Pruebas:** `test_vpa.py` (7), `vpa.parity.test.mjs` (7) y una más en `rulefacets.test.mjs` (11).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página. La suite se reinicia sola al abrirla y arma la página nueva.
- Son 16 reglas probadas sobre los mismos datos: la ruptura con volumen es candidata a la fase 2, no un resultado.
- **Probado en pantalla** con una copia aislada, en el backtesting global con BTC 4h: el panel, las marcas, el modal y una corrida con su trade elegido. No se vio la simulación manual, el 2.º gráfico ni la suite.
- Todas las del backend de App 1: 509 pasan y fallan las 2 de siempre. En la página solo falla `liquidations.test.mjs`, como desde el 13/11.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LECTOR VPA: VOLUME PRICE ANALYSIS DE COULLING (21/11/2026)" y `OrderFlowData/research/vpa/`

---

### App 1 - 21 Noviembre 2026: Ruptura de Fractal sin Futuro y Monedas Nuevas en 15m y 5m (Backtesting Global)

**Pedido:** una corrida de los sabios de Williams en 15m, fase 1, en todas las monedas, tomó solo 8 y daba cifras prometedoras (684 trades, +0.21 R por trade, 8 de 8 monedas positivas). El usuario pidió revisarla, y después bajar las velas de las monedas nuevas en los demás marcos.

**Cambios:**
1. **La ruptura de fractal miraba el futuro:**
   - con entrada a mercado, el evento iba en la vela en que se supo el fractal, pero solo existía si el precio lo rompía después;
   - en los 684 trades la regla decidió antes de la ruptura.

   Ahora, salvo con la orden stop (que espera en el fractal, como en el libro), va en la vela que lo rompe. La suite ya lo hacía bien.
2. **Motor 4:** las corridas anteriores con la ruptura de fractal y otra entrada no se reusan ni se cuentan.
3. **La regla corregida:** 1,531 trades, 41.4% y −0.105 R por trade, igual que el azar en cada moneda.
4. **Monedas nuevas en 15m, 30m y 5m:**
   - `candles_update.py --tf 15,5` baja esos marcos desde 2020, cada uno en su carpeta (`OrderFlowData/candles/15/` y `/5/`);
   - el probador las lee, y 30m sale de dos velas de 15m;
   - el plan de «todas las monedas» salta con su motivo la moneda sin velas de ese marco: antes quedaba para correr y daba 0 trades.
5. **Pruebas:** una nueva en `test_williams_smc.py` y otra ampliada en `test_new_coins.py`. Todas las del backend: 503 pasan y fallan las 2 de siempre.

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- La corrida de 684 trades sigue en el disco, pero queda fuera del tablero y de «Todas»: hay que volver a correr la regla.
- Sin almacén de trades, en 15m y 5m las monedas nuevas corren solo con los elementos de velas.
- **Después, automático:** al arrancar, el backend lanza en segundo plano `market_update.py`, que pone al día las velas de las monedas nuevas, el OI y el funding, como mucho cada 2 horas. Registro en `OrderFlowData/candles/actualizacion.log`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "PROBADOR DE REGLAS DEL OBSERVADOR", "Ruptura de fractal sin futuro y monedas nuevas en 15m y 5m (21/11)"

---

### App 1 - 21 Noviembre 2026: Los Indicadores de la Regla en el Trade Elegido (Backtesting Global)

**Pedido:** al hacer clic en un trade no se pintaban en el gráfico los indicadores que usó la regla. Se veían las marcas de sus elementos y las filas de sus filtros, pero no el Alligator, los fractales ni el AO, por ejemplo. El usuario lo probó en la fase 1 y no sabía si pasaba en las otras.

**Cambios:**
1. **Con «Ver en el gráfico lo que usó la regla» marcado,** el gráfico enciende un rato los indicadores de la regla, sin tocar la lista guardada:
   - los de Williams de sus elementos y filtros (Tres sabios, Alligator, Fractales, Zonas, AO, AC, Gator y MFI);
   - la estructura SMC;
   - los paneles de CVD e interés abierto de sus filtros de flujo.

   Al desmarcarla vuelven los de siempre.
2. **Con los ajustes de la regla:** los de Williams y SMC calculan como el backend, y «Tres sabios» muestra solo los de la regla. Los colores son los del gráfico. `MiniChart` recibe `indicatorOverrides`, que reemplazan los ajustes guardados mientras vienen.
3. **En el marco de la regla:** al elegir el trade, el gráfico pasa al marco de la regla, porque en otro serían otros indicadores.
   - En otro marco, el detalle avisa y ofrece volver.
   - Las reglas de 30m y 1D no tienen marco en el gráfico, y el detalle lo dice.
4. **Pruebas:** `ruletester.test.mjs` suma 1 (15).

**IMPORTANTE:**
- Basta recargar la página de App 1: no cambió el backend.
- **Probado en pantalla** con una copia aislada y la regla de las corridas del usuario (los tres sabios, con el cierre del lado de los dientes) en BTC 4h:
  - en las fases 1, 2 y 3, desde el gráfico en 15M o 1H, pasó a 4H con el Alligator, los sabios, los fractales y el panel del AO;
  - desmarcar la casilla los apagó.
- En la página solo falla `liquidations.test.mjs`, como desde el 13/11.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "PROBADOR DE REGLAS DEL OBSERVADOR", "Lo que usó la regla en el trade elegido (20/11)"

---

### App 1 + Altagracia Trading Suite - 21 Noviembre 2026: Menús de Indicadores en Dos Columnas y Filtros del AO, el AC, el Gator y el MFI

**Pedido:** tras probar los indicadores de Williams y SMC, dos cosas:
- el menú desplegable de los indicadores era largo y parte no se veía;
- en el backtesting global no aparecían los sabios, el AO ni el AC para armar reglas: de Williams solo estaban el Alligator y las zonas. El usuario quiere probar el AO de tres barras.

**Cambios:**
1. **Menús de indicadores en dos columnas**, leídos de arriba abajo: simulación manual, 2.º gráfico, backtesting global y gráfico de la suite. Si la ventana es más baja, se desplazan.
   - El ícono de ajustes va junto al nombre: bajaba a una línea propia.
   - Con Oscuro, el selector del modo del interés abierto se lee: salía negro sobre negro.
2. **Por qué no aparecían los sabios:** no faltaba en el código. En el 9000 respondía un backend de App 1 de antes de la actualización, que seguía vivo sin ventana a la vista junto al nuevo. La lista de elementos de la regla la da el backend; los filtros del Alligator y la zona, la página. Con el backend nuevo salen «Barra divergente», «AO tres barras» y «Ruptura de fractal».
3. **Filtros nuevos de Williams** en la regla, en la vela de la señal:
   - AO y AC: su barra a favor, del lado del cero a favor o las dos;
   - Gator: comiendo, despierto o dormido;
   - MFI: vela verde, squat, verde o squat, o todo menos fake.

   Los controles al azar entran solo donde dejan, y la búsqueda genética los suma apagados de fábrica.
4. **Trade elegido:** cada filtro de Williams y SMC tiene su fila bajo las velas y su línea en el cuadro de la vela de la señal, con su valor. Hasta hoy ninguno la tenía.
5. **Textos:**
   - las fichas de «Vas a correr» dicen el nombre de cada filtro de Williams;
   - el resumen de una regla con solo el AO de tres barras ya no menciona la angulación ni el «AO en contra», que son de la barra divergente;
   - el resumen de la flecha y el rombo de volumen dice sus detalles, que nunca salían.
6. **Pruebas:** `test_williams_smc.py` suma 5 (14) y `rulefacets.test.mjs` suma 1 (10); la paridad Python contra JavaScript compara también el Gator y el MFI.

**IMPORTANTE:**
- **El backend viejo:** hay que cerrar el backend de App 1 que quedó corriendo y abrirlo de nuevo con `1.start_backtester.bat`. Sus procesos se cierran desde PowerShell con `Stop-Process` y sus números (ver `Get-NetTCPConnection -LocalPort 9000`). Claude no tiene permiso para detener procesos.
- Reiniciar el backend de App 1 (9000) y recargar su página. La suite se reinicia sola al abrirla y arma la página nueva.
- **Probado en pantalla** con una copia aislada a 1366×768, en Nítido y en Oscuro:
  - los cuatro menús;
  - la regla «AO tres barras» con los filtros AO del lado del cero, Gator despierto y MFI verde o squat, en BTC 4h, fase 1: 52 trades (prueba de pantalla, no un estudio);
  - el trade elegido con sus filas.
- Todas las del backend de App 1: 502 pasan y fallan las 2 de siempre. En la página solo falla `liquidations.test.mjs`, como desde el 13/11. Las de la suite que usan `williams.py` pasan.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "SMART MONEY CONCEPTS E INDICADORES DE BILL WILLIAMS (20/11/2026)", "Después (21/11)"

---

### App 1 + Altagracia Trading Suite - 20 Noviembre 2026: Smart Money Concepts e Indicadores de Bill Williams

**Pedido:** un indicador de Smart Money Concepts, con el de LuxAlgo para TradingView como referencia, y los indicadores de Bill Williams de *Trading Chaos*, en App 1 y en la suite. Tras el análisis, el usuario eligió "todo, por fases" y pidió sumar los demás de Williams (AC, zonas, Gator y MFI).

**Cambios:**
1. **Nueve indicadores** en App 1 (simulación manual, 2.º gráfico y backtesting global) y en la suite, con sus modales: Alligator, Fractales, Tres sabios, Zonas de Williams, AO, AC, Gator, MFI y Estructura SMC.
   - **Estructura SMC:** estructura interna y mayor con BOS y CHoCH, order blocks con su vida y breakers, máximos y mínimos iguales con su barrido, premium/discount con extremo fuerte y débil, y niveles del día, la semana y el mes anteriores.
   - **Reglas propias:** el código de LuxAlgo tiene licencia no comercial y no se copió.
   - **Sin futuro:** lo que se sabe después de su vela (un pivote de 50 velas, un fractal) va punteado hasta la vela en que se supo.
   - El order block lleva el POC y el delta reales de su vela, y los iguales lo liquidado cerca.
2. **Probador de reglas:**
   - siete elementos: barra divergente, AO tres barras, ruptura de fractal, ruptura de estructura, order block, breaker y barrido de iguales;
   - la entrada con orden stop a favor, la salida bajo el mínimo de N velas y el objetivo en el rango SMC;
   - cuatro filtros: Alligator, zona de Williams, premium/discount y estructura a favor. Los controles al azar entran solo donde ellos dejan;
   - la búsqueda genética usa todo eso, apagado de fábrica.
3. **Fase 1 contra el azar** (4h, siete monedas, 12 reglas): ninguna supera a los dos controles con margen.
   - La ruptura de fractal del libro da +0.08 R por trade, sobre el azar (+0.02) pero bajo seguir el tramo al azar.
   - La barra divergente con 2R pierde más que el azar, con margen.
   - Los order blocks no se distinguen del azar.
4. **Suite:**
   - el servidor detecta las siete señales al cierre de cada vela (de fábrica en 4h, con todas las monedas) y las anota en `data/wsmc`, sin enviar nada; panel en la Watchlist;
   - los order blocks de 1h entran a la defensa de zona;
   - doce medidas nuevas en el journal, en el grupo "Williams y SMC".
5. **Arreglado:** `clean_rule()` perdía el objetivo de nivel (POC, borde o rango SMC) al limpiar otra vez una regla ya limpia, como al correr en todas las monedas una regla de la búsqueda. Quedaba con el cierre a las 96 velas.
6. **Pruebas:**
   - App 1: `williams.test.mjs` (12), `smc.test.mjs` (11), `williamssmc.parity.test.mjs` (2, Python igual a JavaScript bit a bit), `rulefacets.test.mjs` (9) y `test_williams_smc.py` (9);
   - suite: `wise_smc_checks.py` (40) y `book_defense_checks.py` (21).
   - todas las del backend de App 1: 497 pasan y fallan 2 que ya fallaban (`test_endpoints` por la versión y `test_lru_cache::test_clear`). En la página, `liquidations.test.mjs` sigue fallando en la prueba del orden de los indicadores, como desde el 13/11. Las de la suite pasan todas.

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página. La suite se reinicia sola al abrirla y arma la página nueva.
- Las medidas del journal pasan a la versión 3: las guardadas se vuelven a calcular, de a 8 por pedido.
- **Probado:**
  - en pantalla en App 1, con una copia aislada en BTC 4h: los nueve indicadores y sus modales;
  - en la suite, en una copia aislada del servidor con velas reales de Bybit: las 20 monedas revisadas en 3.4 s, las señales de los dos últimos días en el panel, y el clic que abre la moneda en 4h.

  Los order blocks de la defensa y las medidas del journal, solo con las pruebas. No se probó en Electron.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "SMART MONEY CONCEPTS E INDICADORES DE BILL WILLIAMS (20/11/2026)" y `12.AltagraciaTradingSuite/CLAUDE.md` sección "Sabios de Williams y estructura SMC (20/11)"

---

### App 1 - 20 Noviembre 2026: Panel de la Regla más Claro (Backtesting Global)

**Pedido:** una corrida de 7 trades parecía tener trailing y filtros que no eran. Los tenía, heredados de la B5, pero en el formulario no se notaba que estaban encendidos. El usuario pidió ideas para un panel más claro (las fichas de los elementos están bien) y eligió las ocho.

**Cambios:**
1. **Interruptores:** cada filtro y cada salida tiene el suyo.
   - Encendido, resalta y muestra sus valores; apagado, es una línea gris sin números.
   - Al volver a encenderlo recuerda su modo: el OI vuelve con la confluencia, si la tenía.
2. **Sección "Filtros"** con todo junto y la cuenta de los activos, en cuatro grupos:
   - Tendencia: VWAP, EMA y régimen;
   - Flujo: CVD, OI, multitud y OI sostenido;
   - Forma de la señal: extremo, momentum y confirmación;
   - Horario y medidas del Observador.

   Antes estaban mezclados con los elementos.
3. **Secciones plegables:** Elementos, Filtros, Entrada, Stop, Salida y Detección. Plegadas, dicen en una línea lo que tienen.
4. **«Vas a correr»**, sobre el botón de correr:
   - la regla en una línea: «Cambio de carácter → 2 de …, en 10 velas»;
   - una ficha por filtro, entrada, stop y salida. La × quita esa pieza, y un clic lleva a su control, resaltado;
   - punteado, el cierre a las 96 velas que pone el backend cuando no hay otra salida;
   - se pliega en una línea con la cuenta de filtros y salidas.
5. **Salida como carrera:** el trade sale por lo primero que ocurra entre lo encendido.
   - Opciones: el stop inicial, el objetivo (con su arrastre colgando), el trailing del stop (con su arranque), el stop a la entrada, el cierre por tiempo, la señal contraria y la salida por el canal del Gaussian Channel, que estaba entre los elementos.
   - Debajo, una escala en R.
   - «Una posición a la vez» pasa a "Operación".
6. **Aviso en Resumen y Trades** cuando el formulario ya no es la regla de la corrida a la vista:
   - «Esta corrida usó: EMA 50 a favor (en el formulario: sin filtro)»;
   - un enlace a cada control;
   - el botón «Cargar la de la corrida».
7. **Embudo de señales** en el Resumen: lo que quitó cada filtro o motivo. La corrida del usuario: 14 señales, el filtro de CVD u OI quitó 7 y quedaron 7 trades.
8. **«Regla nueva»** y, al cargar una regla (guardada, del Historial, del tablero o de la búsqueda), un aviso con lo que trae: «Trae: EMA 50 a favor · OI sube más de 2% en 6 velas · … · trailing del stop a 3 ATR del mejor precio, desde la entrada».
9. **Resumen de la regla:** en secuencia dice «2 de A, B, C». Con «A + B + C» se leía como "los tres".
10. **Pruebas:** `ruleFacets.js` (las piezas de una regla en palabras) con `rulefacets.test.mjs` (8).

**IMPORTANTE:**
- Basta recargar la página de App 1: no cambió el backend, y ninguna regla cambia su identidad.
- **Comparado con el registro del usuario:** de 887 reglas distintas, 848 cargadas en el formulario dicen lo mismo que su corrida. Las otras 39 son reglas viejas de un elemento con ventana 10, que el formulario ya no permite: el aviso lo muestra.
- **Probado en pantalla** con una copia aislada y la corrida de 7 trades del usuario, a 1366×700 y 840×700, en Nítido y Oscuro:
  - cargar desde el Historial;
  - las ×, volver a encender y el clic que lleva al control;
  - las secciones plegadas;
  - el aviso y «Cargar la de la corrida»;
  - el embudo y «Regla nueva»;
  - el cierre a las 96 velas y la salida por el canal.
- `liquidations.test.mjs` sigue fallando en una prueba desde el 13/11, sin relación con esto.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "PROBADOR DE REGLAS DEL OBSERVADOR", "Panel de la regla más claro (20/11)"

---

### App 1 - 20 Noviembre 2026: Objetivo Arrastrado (Trailing Take Profit) en el Backtesting Global

**Pedido:** un trailing take profit como el de un bot: un objetivo fijo; antes de llegar a él se activa el trailing, que arrastra el objetivo hasta que el precio se devuelve, y el trade se cierra en el valor nuevo del objetivo.

**Cambios:**
1. **Salida nueva** en la pestaña Regla, bajo "Objetivo": "Arrastrar el objetivo desde N R, a N R, ATR o % del mejor precio".
   - El objetivo queda fijo hasta que el precio llega al arranque, antes del objetivo o en él como máximo.
   - Desde ahí deja de ser fijo: sigue al mejor precio a esa distancia, y el trade se cierra cuando el precio vuelve hasta él, aunque haya pasado el objetivo.
   - La distancia en R es del riesgo del trade; en ATR, el de la vela de la señal; en %, del mejor precio, como el retroceso de un bot.
   - Solo con el objetivo en R. Una regla sin él conserva su identidad: sus corridas guardadas siguen valiendo.
2. **Dentro de la vela**, como una orden trailing del exchange: minuto a minuto o, sin minutos, el recorrido supuesto. Sale por el nivel que el precio toca primero: el stop vigente o el objetivo arrastrado.
   - Las entradas al azar usan la misma salida.
   - La caja propia de la Revisión, no: sale en su objetivo.
3. **En el trade elegido:**
   - la línea donde se activa: «Se activa el trailing · 2.5R»;
   - el objetivo arrastrado en escalones verdes;
   - la salida: «Salida en el objetivo arrastrado · +3.25 R»;
   - el detalle dice cuándo se activó.

   El cuadro de la vela de la señal va abajo en los largos: arriba tapaba el objetivo arrastrado.
4. **Sensibilidad:** con el objetivo arrastrado, mueve el arranque y la distancia en vez del objetivo.
5. **Más rápido:** los minutos ya leídos quedan en la corrida, hasta 1,000 velas: el azar volvía a leer las mismas velas. La B5 en BTC 4h con el objetivo arrastrado y sus controles pasó de 20 a 10 s.
6. **Arreglado:** el contexto del trade elegido fallaba con las reglas en secuencia, como Compresión → Delta Breakout o Delta/Volumen: del disco, los mínimos por grupo vuelven con llaves de texto.
7. **Pruebas:** `test_tp_trail.py` (12), una más en `test_trade_context.py` (6) y dos más en `ruletester.test.mjs` (14).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- **Medido** con la B5 de 108 trades (BTC 4h, fase 1, stop a la entrada en 1.5R):
  - trailing del stop a 3 ATR desde 1R, la del usuario: +0.71 R por trade, azar +0.20;
  - objetivo fijo en 3R: +0.44 R, azar +0.01, con margen;
  - objetivo de 3R arrastrado desde 2.5R a 0.5R: +0.37 R, porque casi todos se cierran en la misma vela en que se activa;
  - a 1.5 ATR: +0.48 R; a 3 ATR: +0.75 R, azar +0.18.

  El arrastre amplio gana como el trailing del stop, pero también su azar: es la tendencia de 4h. Solo la fase 1 de una moneda.
- **Probado:**
  - 40 variantes repetidas igual con la versión rápida;
  - 6 corridas guardadas del usuario repetidas trade por trade;
  - en pantalla, en el backtesting global con una copia aislada: trades 3, 22 y 57.
- `liquidations.test.mjs` falla en una prueba desde el 13/11: el mapa de liquidez quedó primero en IndicatorManager. No tiene que ver con este cambio.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "PROBADOR DE REGLAS DEL OBSERVADOR", "Objetivo arrastrado (20/11)"

---

### App 1 - 20 Noviembre 2026: Lo que Usó la Regla en el Trade Elegido (Backtesting Global)

**Pedido:** al elegir un trade en el backtesting global se veían la caja TP/SL y la del elemento, pero no los indicadores de la regla, que solo se nombraban. Para depurar hace falta verlos como estaban, con los ajustes de la prueba.

**Cambios:**
1. **Backend:** `trade_context()` vuelve a correr la regla de la corrida, sin controles (`run(..., trace)`), y da una ventana alrededor del trade con:
   - sus líneas enteras (EMA, VWAP móvil con su tope y canal gaussiano);
   - todas las apariciones de sus elementos;
   - las cajas del régimen;
   - una fila por filtro que dice si pasa en cada vela;
   - cada señal con lo que pasó: su trade o por qué no entró.

   Ruta `/api/tester/result/{id}/trade/{n}/context`.
2. **Gráfico:** las líneas con su nombre, los elementos tenues y, bajo las velas, una fila por filtro (verde pasa, rojo no pasa, gris sin dato). Los triángulos son las señales: rellenos los que dieron trade.
3. **Detalle del trade:**
   - la casilla "Ver en el gráfico lo que usó la regla";
   - una tabla con cada condición al cerrar la vela de la señal, que es cuando la regla decidió: ✓ o ✗, la condición y su valor (por ejemplo, "✓ OI sube más de 2% en 6 velas · OI +6.89% en 6 velas");
   - las señales que no entraron, con su motivo, en una lista plegable.
4. **La vela de la señal en el gráfico** (pedido tras verlo: no se notaba si al abrir el trade se cumplía todo): va resaltada de arriba abajo, con su casilla enmarcada en cada fila de filtros. Al lado lleva un cuadro con la misma lista de condiciones. Un trade que se repite igual tiene todo en ✓.
5. **El stop y la salida** (pedido al probar el trailing):
   - el trade elegido dibuja su stop vela a vela en escalones: rojo el inicial, gris a la entrada y naranja arrastrado;
   - su salida va con una cruz y su motivo: «Salida por tiempo · +22.87 R»;
   - un trade sin objetivo ya no pinta su salida como un TP: su caja es la del riesgo y la salida va como una marca al final.

   Antes, un ganador salía con su zona verde y uno que salió en la entrada o perdiendo, solo con la roja.
6. **Pruebas:** `test_trade_context.py` (5) y tres más en `ruletester.test.mjs` (12).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- La primera vez de cada corrida el backend repite la regla (2 s en BTC 4h, fase 1); los demás trades de esa corrida responden al instante.
- Si al repetirla hoy la señal no da el mismo trade, el detalle lo avisa: pasaría con una corrida de un motor anterior.
- **Probado:**
  - en la B5 de BTC 4h, fase 1, los 119 trades se repiten iguales;
  - corridas con régimen, CVD, VWAP con tope, canal gaussiano, funding, OI sostenido y horario;
  - en pantalla, en el backtesting global con una copia aislada.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "PROBADOR DE REGLAS DEL OBSERVADOR", "Lo que usó la regla en el trade elegido (20/11)"

---

### App 1 + Altagracia Trading Suite - 20 Noviembre 2026: Perfil de Volumen sobre los Rangos Horizontales

**Pedido:** que el indicador de rangos pueda dibujar el volume profile sobre cada rango detectado, y que el perfil crezca con el rango a medida que avanza el tiempo, en App 1 y en la suite.

**Cambios:**
1. **Opción "Perfil de volumen"** en el modal del indicador, apagada de fábrica:
   - va sobre las cajas o sobre el rango mayor;
   - se eligen las franjas (50), el área de valor (70%) y el largo de la barra mayor (30% del ancho del rango);
   - dibuja las líneas del POC, el VAH y el VAL, y el precio del POC.
2. **El perfil** es el de las velas cerradas del rango, de su primera vela a la última, con la regla de VP Periodic (`rangeProfiles.js`). El de un rango vivo crece con cada vela que cierra, y la vela en formación no entra.
3. **Sin la ruptura** (pedido tras verlo):
   - las velas del final que cierran fuera de la caja no cuentan;
   - el rango mayor sigue vivo hasta N cierres fuera, y esas velas le daban al perfil otra forma que la D;
   - si el precio vuelve a cerrar dentro, cuentan;
   - en 5 años de BTC 4h, con 6 cierres, el volumen del perfil fuera de la caja bajó de 14.6% a 3.0%.
4. **Volumen real** del almacén si cubre el 99% del rango; la etiqueta dice «real». Se pide hasta el cierre de la última vela del perfil, nunca después. En una reproducción rápida, el de un rango vivo se pide al pausar.
5. **Para el análisis:** el POC, el VAH y el VAL de cada perfil se ofrecen en "Incluir en el análisis".
6. **Pruebas:** `horizontalranges.test.mjs` suma 9 (17).

**IMPORTANTE:**
- Basta recargar App 1: no cambió el backend. La suite se reinicia sola al abrirla y arma la página nueva.
- **Probado** en BTC 4h con una copia aislada:
  - en el backtesting global, con volumen real, también sobre el rango mayor;
  - en la simulación manual a 5000x: el rango vivo sumó una vela cada 3 segundos y su perfil creció con ella;
  - sin la ruptura: los rangos mayores de noviembre de 2023 dejaron fuera sus 5 velas de ruptura.
- **Sin probar en pantalla:** la suite solo se armó; tampoco se vio el 2.º gráfico.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "RANGOS HORIZONTALES (20/11/2026)", "Perfil de volumen sobre cada rango (20/11)"

---

### App 1 + Altagracia Trading Suite - 20 Noviembre 2026: Rangos Horizontales y Guía de Pruebas de las Reglas

**Pedido:** primero, un tutorial como el de los Elementos OF (PDF y Excel con lista de chequeo) para depurar el backtesting global opción por opción. Después, un indicador de rangos horizontales con los métodos y parámetros de la pestaña Régimen, para la simulación manual, el backtesting global y la suite, con el método elegido en un modal.

**Cambios:**
1. **Guía de pruebas de las reglas:** `GUIA_PRUEBAS_REGLAS.pdf` (27 páginas) y `CHEQUEO_PRUEBAS_REGLAS.xlsx` en `1.Altagracia_Crypto_Backtester/Backtester/`, con el formato de la guía de los Elementos OF. El Excel trae 100 pasos de chequeo, los 104 controles de la pestaña Regla, los 50 elementos, 43 comportamientos que confunden al depurar (2 comprobados en el código, el resto "por comprobar") y un registro de corridas que calcula las ventajas y si pasa el criterio.
2. **Indicador "Rangos horizontales"** (`HorizontalRangesIndicator.js`, modal `HorizontalRangesSettings.jsx`): los ocho detectores de la pestaña Régimen y el rango mayor, calculados en el navegador con `regimeDetectors.js`, que da lo mismo que `regime_detectors.py` al bit (26,960 zonas comparadas). Solo con velas cerradas: punteado hasta la vela en que se supo, marcado desde ahí. Está en la simulación manual, el 2.º gráfico, el backtesting global y el gráfico principal de la suite.
3. **Hallado:** el Range Detection de la pestaña Régimen repinta (un cierre fuera que no termina el rango pasa a ser rango si el precio vuelve). Los otros siete detectores no.
4. **Arreglado en el backtesting global:** cambiar el marco del gráfico durante su primera carga dejaba el aviso "Completando las velas de…" y el gráfico tapado.
5. **Pruebas:** `horizontalranges.test.mjs` (8) y `regimedetectors.test.mjs` (35).

**IMPORTANTE:**
- Basta recargar App 1 (no cambió el backend). La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en el backtesting global con una copia aislada (BTC 4h, eficiencia con caja y TTM con rango mayor). No se probó en pantalla la simulación manual, el 2.º gráfico ni la suite en vivo; las dos páginas se arman.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "RANGOS HORIZONTALES (20/11/2026)"

---

### App 1 - 19 y 20 Noviembre 2026: Acciones de Alpaca (Almacén de Order Flow y Velas Históricas)

**Pedido:** llevar las acciones de EE. UU. de Alpaca a App 1, con footprints y Elementos OF de unos días recientes y, para el probador, velas históricas profundas de unas 100 acciones, sin la granularidad de los footprints.

**Cambios:**
1. **Almacén de order flow** (`alpaca_store.py`): los trades del conector de la suite (`alpaca_data.py`, importado sin copiarlo; SIP con el lado del agresor por la regla del tick), solo de la sesión regular, armados en el formato de App 1. Hay minuto × precio en `OrderFlowData/alpaca/store`, y delta dentro del minuto y órdenes en `OrderFlowData/alpaca/flow`. La celda es de 0.01 USD. Una orden son los trades del mismo lado separados por 1 ms o menos. Nunca escribe en el almacén de las monedas.
2. **Lectores:** `footprint_store.py` (`is_stock`, `store_root`) y `of_elements.py` (`_flow_path`) leen esas carpetas para un símbolo sin USDT con carpeta de acciones. Las monedas no cambian.
3. **Velas históricas** (`alpaca_candles.py`): 99 acciones en 4 grupos:
   - índices: 6, con TQQQ y SOXL apalancados;
   - tecnológicas: 38;
   - consumo y otros: 30;
   - volátiles: 25.

   Son velas de 15 minutos de la sesión regular desde 2016 (o desde su salida a bolsa), más las de 1 hora y 4 horas, que empiezan a las 09:30 de Nueva York, y el día. Están ajustadas por splits y usan el calendario de Alpaca, con los cierres tempranos y los feriados. Se guardan en `OrderFlowData/alpaca/candles`: 206 MB. El probador las lee desde la entrada 37 del Probador de Reglas.
4. **Pruebas:** `test_alpaca_store.py` (9) y `test_alpaca_candles.py` (6).

**IMPORTANTE:**
- **Cómo correrlo:** las claves de Alpaca están en `12.AltagraciaTradingSuite/config/suite.json`. Desde otra copia, pasar su ruta con `SUITE_CONFIG`.
  - Almacén: `python -B alpaca_store.py AAPL,SPY,NVDA 2026-10-07 2026-11-18`. Hoy tiene AAPL, SPY y NVDA, 31 días cada una.
  - Velas: `python -B alpaca_candles.py [ACCIONES] [--rebuild]`. Sin acciones, actualiza todas en unos 2 minutos; bajarlas todas desde cero tarda unos 68 minutos.
  - Al actualizar se repiten los últimos 7 días, y si cambiaron por un split nuevo, la acción se baja entera otra vez.
- **El plan gratis de Alpaca** da los datos con 15 minutos de atraso: no se pide lo de hoy.
- **Huecos conocidos:**
  - SMCI no tiene 349 días (de 2018-08 a 2020-01, cuando estuvo fuera del Nasdaq);
  - ROKU termina el 2026-11-06, porque Alpaca la da como inactiva;
  - NIO, DKNG y RIOT empiezan en la fecha en que el ticker pasó a ser de esa empresa (`START`).
- **GE quedó fuera:** sus spin-offs dejan caídas que el ajuste por splits no corrige.
- **El gráfico de la simulación manual no abre acciones:** pide sus velas a Bybit.
- **Probado** con datos reales de Alpaca: almacén de 3 acciones y velas de las 99, revisadas acción por acción (inicio, días que faltan y saltos grandes). No se probó en pantalla.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ACCIONES DE ALPACA: ALMACÉN Y VELAS (19/11/2026)"

---

### App 1 - 17 Noviembre 2026: Probador de Reglas del Observador

**Pedido:** la parte que sigue del Observador: probar sobre el histórico por fases, para que lo decidido en la primera parte se compruebe con datos frescos en la segunda y la tercera. Elegir elementos de order flow (varios a la vez), con stop y objetivo (o sin objetivo, para ver hasta dónde llega), ver todo en pantalla sin reproducción, contabilizar cada trade con un informe y guardar lo que había en cada trade aunque no esté en la regla. Marcos de 15 y 5 minutos, con 30 minutos, 1 hora y 4 horas habilitados, en ventana aparte.

**Cambios:**
1. **Ventana "Probador de reglas"** (`?probador=1`, botón en el Observador): a la izquierda la regla y el informe; a la derecha el gráfico de la fase completa, sin reproducción, con la caja de cada trade. Un clic en la lista, o las flechas, lleva al trade.
2. **Regla:** hasta 6 elementos (todos o al menos N, en una ventana de 1 a 5 velas), lado o invertida, entrada a mercado o limit en la zona del elemento, stop (swing anterior, vela del elemento, borde de la zona o ATR) y salida (objetivo en R, sin objetivo, stop arrastrado, tiempo o señal contraria). Hasta 3 filtros con las medidas del Observador.
3. **Tres fases por fecha:** 1 Exploración (hasta el 31/12/2023), 2 Validación (01/01/2024 al 30/06/2025) y 3 Final (desde el 01/07/2025). La 2 y la 3 piden confirmar, guardan el resultado por regla exacta y no lo recalculan; la 3 exige haber pasado por la 2, y su gráfico no se muestra hasta pedirlo.
4. **Informe:** acierto, R neto de comisiones, profit factor, caída, rachas, curva, contra entradas al azar con margen, hasta dónde llegó cada trade antes del stop, cortes por año, lado, hora y salida, aporte de cada elemento, sensibilidad a valores vecinos y CSV.
5. **Registro por trade:** todos los elementos presentes en su ventana (a favor y en contra) y las 58 medidas del Observador al decidir, con ganadores contra perdedores.
6. **Menú de inicio con dos modos** (pedido después de probarlo): "Simulación manual", la de siempre, y "Backtesting global", que abre esta ventana en la misma pestaña, con sus fechas fijas y sin depender de la reproducción.
7. **Órdenes manuales:** en el backtesting global, la pestaña "Mis órdenes" dibuja las órdenes del Observador de cualquier sesión, sea cual sea su fecha. En la simulación manual, cada orden del Observador tiene "Ver en el gráfico", que la dibuja si la simulación ya pasó por su fecha.
8. **Pruebas:** `test_rule_tester.py` (16), `ruletester.test.mjs` (8) y `observer.test.mjs` (44).
9. **Después de la primera prueba del usuario:** "Esperar N velas tras cerrar" (8 de fábrica) y, con la VA elegida, "hueco mínimo" en ATR entre el área de valor y la vela que la abandona (0 de fábrica: la regla literal del libro).
10. **Barrido de liquidaciones (LIQ):** elemento nuevo del probador. El precio pasa un swing que coincide con una zona del indicador Liquidaciones: barrer un mínimo es alcista y un máximo, bajista. Dos variantes: basta pasar el swing, o además una vela cierra de vuelta. Con LIQ la regla va "en secuencia": primero el contexto y después el gatillo, en la misma vela o hasta 10 velas después. El gatillo puede ser cualquier elemento o **VH**, volumen alto para su hora. El informe suma "¿Aportan las liquidaciones?": la misma regla tras barrer un swing sin liquidaciones. Cada trade guarda la zona barrida (`liq_sweeps.py`, `test_liq_sweeps.py`, 8).
11. **Ajustes de los indicadores** en el backtesting global: ⚙️ junto a cada indicador encendido, con los modales de la principal (`ChartIndicatorSettings.jsx`). Son los mismos ajustes de la simulación manual.
12. **Barrido de la zona y lo que la regla vio (18/11):** LIQ también como barrido de la zona de liquidaciones de lado a lado (de fábrica), además del swing dentro de una zona. Al elegir un trade, el gráfico dibuja las zonas de liquidaciones que había en su barrido, con la barrida resaltada, el nivel pasado y la zona de cada elemento de la regla.
13. **Perfil por sesión (18/11):** tres elementos contra el POC, el VAH y el VAL de la sesión anterior ya cerrada, con volumen real y el periodo del VP Periodic (4 h a 1 semana, en UTC): **VR** regreso al valor (la "regla del 80%"), **VF** fallo fuera del valor y **VX** aceptación fuera del valor. El objetivo puede ir en el POC anterior o en el borde contrario del valor. Al elegir un trade se dibuja el valor de la sesión anterior. Salieron de buscar las prácticas publicadas, que casi no traen pruebas (`vp_sessions.py`, `test_vp_sessions.py`, 7).
14. **Velas de toda la fase 1** en el gráfico: lo anterior al caché de velas (5 años) sale del almacén de trades, así se abren los trades más viejos.
15. **Cambio de carácter y horario (18/11):** elemento **CC** (una tendencia de swings crecientes y una vela que cierra bajo su último mínimo, o al revés), con la estructura en velas mayores que las de la regla y contadas desde la apertura de Nueva York, y un filtro de horario en UTC para cualquier regla (`structure.py`, `test_structure.py`, 5). En BTC, fase 1, estructura de 4 horas y señales de la sesión de Nueva York: 49 trades, 59.2% y +0.15 R a 1R; sin el horario, -0.06 R. Con tan pocos trades no pasa su margen.
16. **Otras monedas (18/11):** selector de moneda en el backtesting global. ETH, SOL, ARB y GALA tienen almacén de trades y corren con todos los elementos; SUI y TRX corren sobre sus velas guardadas, solo con CC, VH y LIQ. El cambio de carácter no pasó la fase 3 en BTC (92 trades en las tres fases, +0.04 R) ni se repite en las otras seis monedas (124 trades en la fase 1, +0.02 R).
17. **Patrones de rechazo y filtros de VWAP y EMA (18/11):** los patrones del indicador Rejection Patterns como elementos (**HM** martillo o estrella, **EN** envolvente, **DJ** doji), con tendencia previa y volumen mínimo, y dos filtros para cualquier regla: VWAP móvil de N velas y EMA de N velas (cierra a favor, o la mecha la toca, con pendiente opcional). `test_structure.py` (8). En BTC, fase 1: en 15m pierden; en 1h, con volumen y tocando la EMA 14, 291 trades y +0.01 R contra -0.09 del azar.

18. **Volumen de Respuesta como elementos (18/11):** **RF**, la flecha (vela con el doble o más del volumen de su hora), a favor del tramo, en contra o cualquiera, y **RB**, el rombo, operado como giro o siguiendo el tramo. Solo necesitan velas: valen en todas las monedas (`response_volume.py`, `test_response_volume.py`, 4). Estudio previo en las siete monedas, 4h, stop de 2 ATR y 2R: la flecha a favor del tramo dio +0.12 R en la fase 1 (657 trades) y +0.21 R en la fase 2 (549), pero seguir el tramo en velas al azar dio +0.04 y +0.11. El rombo no sirvió ni como giro ni para seguir.
19. **Todas las monedas (18/11):** botón "Correr en todas las monedas": corre la fase elegida en cada moneda con velas guardadas, una tras otra, y la pestaña "Todas" da el informe conjunto: trades juntos, contra el azar, hasta dónde llegó, por moneda, por año y por lado. Lo ya corrido no se repite; las fases 2 y 3 piden confirmar y la 3 exige la 2 en cada moneda. Además, con un solo elemento la ventana vale 1: quedaba escondida con el valor de una regla anterior.
20. **Como cuenta (18/11):** en "Resumen" y en "Todas", un selector "Por trade / Como cuenta". Como cuenta, cada trade arriesga un % del capital que hay al entrar (1% de fábrica): retorno total y anual, mayor caída en %, Sharpe y Sortino anuales con retornos diarios, meses positivos, posiciones a la vez y peor día. La flecha de 4 horas con 1% por trade en las siete monedas: fase 1, +31% anual, caída de 19.7%, Sharpe 1.21 y Sortino 2.35; fase 2, +85% anual, caída de 15.7%, Sharpe 1.99 y Sortino 3.87. El botón de todas las monedas avisa "Preparando…" y no lanza un segundo trabajo.
21. **La flecha no pasó la fase 3, y control del tramo (18/11):** el usuario corrió la fase 3 en las siete monedas: 491 trades, 35.0% y +0.01 R, sin distinguirse del azar; como cuenta con 1%, -3.6% anual y 40% de caída. El informe suma el control "Seguir el tramo al azar" (3,000 entradas por moneda, siempre a favor del tramo en curso) en "Contra el azar", en "Resumen" y en "Todas", con una columna "Vs. tramo" por moneda. Una corrida guardada antes lo recibe al abrirla, sin recalcular la regla. Con ese control, seguir el tramo de 4 horas dio -0.01 R en la fase 1 y +0.03 en la fase 2: la flecha quedó +0.15 R por encima en las dos, con margen. La curva del informe medía 2 px más que el panel y sacaba una barra horizontal: corregido.
22. **Gaussian Channel (18/11):** elemento **GC**, traído del Strategy Builder de App 8, que no funcionaba bien: una vela cierra fuera de la banda con el canal a favor (arriba, largo; abajo, corto), y la salida propia de la estrategia, al cerrar de vuelta dentro de la banda o al otro lado de la línea central. Periodo, polos y ancho ajustables (144, 4 y 1.414 de fábrica). Solo necesita velas: vale en todas las monedas (`gaussian_channel.py`, `test_gaussian_channel.py`, 5). Fase 1, siete monedas, solo largos con stop en la línea central: en 4h, 432 trades, 15.7% y +0.03 R, menos que entrar largo al azar con la misma salida (+0.19); en 1h, 1,952 trades, +0.10 R y +0.15 sobre el azar, pero casi todo lo pone BTC (3 de 7 monedas positivas).
23. **Tope de desviaciones del VWAP y caché de elementos (18/11):** con el filtro de VWAP móvil, "La vela abre a no más de N desviaciones del VWAP": no opera si la vela de la señal abrió más allá de esa banda, del lado del trade. La desviación es la de las bandas del indicador VWAP móvil. Flecha de 4 horas, fase 1, siete monedas: sin filtro, 757 trades y +0.15 R; con VWAP 200 a favor, 612 y +0.20 R; con tope de 2, 1.5, 1 y 0.5 desviaciones, +0.16, +0.11, +0.10 y -0.03 R: el tope quita trades buenos. Además se corrigió un fallo del caché de elementos del probador (CC, HM, EN, DJ, RF, RB, GC, LIQ y perfil): se guardaban por la dirección en memoria de las velas, y al correr varias monedas seguidas una podía recibir los elementos de otra. Pasó en 2 de 42 corridas de prueba. Las fases 1 y 2 de la flecha, recalculadas, dan lo mismo; la fase 3 del usuario no se recalculó.
24. **Marco de 1 día (18/11):** la regla puede ir en 1D, en todas las monedas. Corre sobre velas (las de 4 horas unidas por día UTC y, antes, las del almacén de trades), así que solo valen CC, VH, LIQ, HM, EN, DJ, RF, RB y GC. El Gaussian Channel arranca con las velas anteriores a la fase. El gráfico sigue en sus marcos, hasta 4h. Gaussian Channel diario, fase 1, solo largos, stop en la línea central y salida por la banda: 27 trades entre todas las monedas (BTC 4), 25.9% y +0.03 R, contra +0.27 de entrar largo al azar con la misma salida. Con tan pocos trades no dice nada. Solo se probó GC en 1D (`test_gaussian_channel.py`, 6).
25. **Revisión de candidatos por sesiones (18/11):** pestaña "Revisión" del backtesting global, pedida para medir lo que agrega el criterio del usuario sobre una regla. La regla de la pestaña "Regla" propone momentos de un tramo seguido de la fase 1 (28 días de fábrica), y el usuario decide en cada uno, en orden y con fecha y precio ocultos: entra como la regla, entra con su caja TP/SL (lado, stop y objetivo propios) o no entra. El gráfico avanza al candidato siguiente y el resultado de cada decisión sale solo cuando ya quedó atrás. El informe compara sus trades con lo que dejó pasar y con tomar todo como la regla, por lugar en la sesión (para ver si mejora al ir leyendo el mercado), tras ganar y tras perder, con los segundos por decisión. Registro en `OrderFlowData/observer/review/sessions.jsonl` (`candidate_review.py`, `candidateReview.js`; pruebas 5 y 3). Probado en la copia aislada con BTC 4h: sesión, decisiones, caja propia, retomar al recargar e informe. No se probó con moneda al azar ni en 15m. Después, el mismo día, tras la primera sesión del usuario: botón "Dibujo" en la barra del backtesting global con todas las herramientas (los dibujos siguen al cambiar de marco), y "Tras entrar, seguir hasta que el trade cierre" (de fábrica): el gráfico avanza hasta la salida del trade y 8 velas más, y los candidatos que caen ahí no se deciden, como al operar una posición a la vez.
26. **Búsqueda genética de reglas (18/11):** pestaña "Búsqueda" del backtesting global, pedida tras leer los artículos de algoritmos genéticos en trading. Un algoritmo genético arma reglas con las casillas del probador (elementos de velas CC, VH, HM, EN, DJ, RF, RB, GC y, si se elige, LIQ; ventana, invertir, parámetros de cada elemento, entrada, stop, salida y un filtro de VWAP o EMA), las corre en las siete monedas y cruza y muta las mejores. Solo usa la **fase 1**, partida por fecha (01/01/2023 de fábrica): la aptitud sale de lo anterior (ventaja sobre el mejor de los dos controles al azar, menos su error estándar, menos 0.02 R por pieza extra y 0.05 R por moneda que falte a favor), y lo posterior es una validación que no elige nada y solo se muestra al terminar. Al final da hasta 5 finalistas distintas con sus vecinas (cada valor movido al de al lado), un veredicto, el umbral de suerte por haber probado tantas y si las mejores superaron al resto en la validación. "Cargar en la pestaña Regla" la deja lista para correrla como cualquier otra. Corre en el backend sin gastar tokens, guarda cada generación y se retoma si se corta (`rule_search.py`, `RuleSearchTab.jsx`; `test_rule_search.py`, 6). Una regla tarda 2 a 4 s en las siete monedas en 4h: 60 × 25 son una a dos horas. Probado en la copia aislada con una búsqueda corta en 4h (87 reglas, ninguna candidata); no se probó en 1h ni en 1D, ni una búsqueda larga.
27. **Regímenes, tendencia u horizontalidad (19/11):** pestaña "Régimen" del backtesting global, pedida para no aplicar una misma estrategia en tendencia y en rango. Una referencia que mira el futuro a propósito (eficiencia de la ventana centrada de 48 velas: el 25% más derecho es tendencia) califica a los detectores, todos sin futuro: el Range Detection de App 1 y el "Progresivo (D creciente)" de App 8, corregidos; TTM, BBWP y el BandWidth del VWAP de sesión; una eficiencia con caja nueva, y ADX y eficiencia como referencias simples. Se dibujan en el gráfico de la fase 1: arriba la referencia, abajo una barra morada mientras el detector dice rango, con su caja. Afinados con lo anterior a 2023 y calificados en 2023 en las siete monedas: el mejor en 4h queda en J 0.32 (rango hallado − tendencia confundida); el TTM, 0.22; el VWAP de App 1, 0.01. El techo es la demora: conocer la referencia 12 velas tarde da 0.49. Detectar en 1h o 15m para calificar en 4h, pedido por el usuario, separa peor (`regime.py`, `regime_detectors.py`, `RegimeTab.jsx`; `test_regime.py`, 13).
28. **Rango mayor y filtro de régimen (19/11):** en la pestaña Régimen, la casilla "Construir el rango mayor" une las cajas del detector hasta un alto máximo en ATR y termina tras N cierres seguidos fuera (con 6, rangos de 8 a 12 días, que el usuario comparó a ojo con 3). En la pestaña Regla, "Régimen": solo dentro de un rango, solo fuera o solo tras romper uno, con los controles al azar en el mismo régimen. Comparado en la fase 1, 4h, siete monedas: la flecha gana fuera de las cajas (+0.16 R) y no dentro (+0.01), y las reglas de giro pierden menos dentro; pero los márgenes se tocan, y seguir el tramo al azar fuera de los rangos no gana de forma estable por año ni por moneda. El detector, así, no separa todavía cuándo conviene seguir el movimiento.
29. **Régimen en 1D y bloques de construcción (19/11):** el filtro puede medir el régimen en velas diarias (cada vela usa el último día cerrado); en 4h separa peor. `regime_study.py` registra indicadores en cada ruptura de caja y en cada llegada a un borde dentro de la caja, en la fase 1. Rupturas a favor (1.5 ATR, 3R): +0.13 R antes de 2023 y +0.10 en 2023, contra −0.07 a +0.06 del azar; lo que más se repite es ir a favor de la EMA 200 (+0.21 y +0.15). Bordes hacia el centro: pierden (−0.08 y −0.11); lo que más daña es entrar contra una vela grande. Ningún margen deja de tocar el cero.
30. **Ruptura y borde de caja como elementos (19/11):** **BX** (la vela que rompe una caja, a favor) y **BE** (la llegada al borde de una caja vigente, hacia el centro, con filtros de cuerpo y cierre) en el probador, en todas las monedas; el objetivo de BE puede ir al centro de la caja y cada trade dibuja su caja (`box_elements.py`). Fase 1, 4h, siete monedas: BX a favor de la EMA 200 con cajas de hasta 5.5 ATR, stop de 1.5 ATR y 3R, +0.24 R antes de 2023 y +0.21 en 2023, contra +0.02 de los controles; BE, cerca de 0.
31. **OI, CVD, FVG, patrones y swing (19/11):** medidos primero en rupturas y bordes de las cajas, y después como piezas del probador: filtros de **CVD de N velas a favor** y de **OI** (sube, baja, confluencia OI-volumen a favor o sin ella en contra; `flow_filters.py`, con los controles al azar en las mismas velas), "con patrón de rechazo" en BE y los elementos **FV** (FVG nuevo) y **SP** (swing del detector) (`fvg_swing.py`). `oi_update.py` baja el OI de 4 horas de Bybit (siete monedas, desde 2020 hasta hoy) a `OrderFlowData/oi`. Fase 1, 4h, siete monedas: BX con EMA 200, caja ≤ 5.5 ATR y CVD 20 a favor, +0.32 R antes de 2023 y +0.32 en 2023 (6 de 7 monedas); FV a mercado con hueco ≥ 0.3 ATR, 1.5 ATR y 3R, +0.23 y +0.31 (6 de 7), con controles cerca de 0. Se probaron 17 reglas en los mismos datos: son candidatas a la fase 2, no resultados. El OI solo, el swing y los filtros sobre BE no se repiten (`test_flow_elements.py`, 5).
37. **Acciones en el probador (20/11):** las 99 acciones de Alpaca que baja la otra sesión (`OrderFlowData/alpaca/candles`, desde 2016) son un grupo más del probador, del tablero (A) y de la comprobación de la búsqueda. Sus velas se leen con su hora de 09:30 de Nueva York; la noche y el fin de semana no cierran el trade (una apertura más allá del stop sale en la apertura); el costo es 0.02% por lado; solo valen los elementos de velas. El gráfico de la ventana lee del disco las velas de las monedas nuevas y de las acciones: antes, abrir una moneda nueva la bajaba de Bybit al caché de App 1, que está en git. El Impulso en las acciones, fase 1 en 4h: +0.004 R contra −0.027 del azar, sin ventaja clara (`test_stocks.py`, 6). Corregido el mismo día: el filtro de régimen medido en 1D descartaba todas las señales de las acciones, porque pedía días con 24 horas de velas. Las corridas de acciones hechas antes con él no se reusan ni se cuentan.
38. **Azar con el minuto a minuto (20/11):** la regla se simulaba con los minutos de la moneda (las que tienen almacén) y las entradas al azar sin ellos, donde en la duda cuenta el stop. Con dos órdenes stop cerca de la apertura casi todo llenado del azar era una pérdida, y la primera búsqueda de esa noche convergió en eso: 5 finalistas con +0.33 a +0.94 R sobre el azar que perdían en las monedas nuevas. Ahora el azar del probador y el de la búsqueda se simulan como la regla (motor 3). En la fase 1 de BTC, la finalista 2 da +0.86 R con minutos y el azar con sus órdenes +0.57 (sin minutos, −0.36): su ventaja era de unos +0.29 R, no de +1.2. Una regla a mercado casi no cambia. También queda corregido lo del 19/11: las dos órdenes en velas al azar con objetivo 3R dan +0.03 R, no −0.36, y la compresión no supera al azar. En el registro del usuario lo tocan 60 corridas con limit en monedas con almacén, ninguna de las cuales pasó una fase. Además, sin minutos una vela dudosa ya no cuenta siempre el stop. Sigue su recorrido supuesto (apertura, el extremo más cercano, el otro y cierre, como el emulador de TradingView). Comparado contra los minutos reales en las seis monedas que los tienen, la ventaja de cuatro reglas quedó a 0.03 R o menos. Contar siempre el stop erraba hasta 0.8 R por trade con dos órdenes y le inventaba +0.13 R a la compresión (`test_trailing_straddle.py`, 7).
39. **Noche de búsquedas y fase 2 (20/11):** tres búsquedas de 60 × 25 en 4h, con el azar corregido. Con la constancia por trimestre (A y C) no salió ninguna candidata, y las mejores se sobreajustaron. Con el promedio (B) salieron 5 candidatas, todas sobre el FVG nuevo de 0.6 ATR o más. De las tres llevadas a la fase 2 en las 50 monedas, la **B5** pasa el criterio para la fase 3. Es un FVG nuevo con la EMA 50 a favor y el OI subiendo, y en las monedas de siempre da +0.17 R por trade, +0.24 sobre el azar y +0.20 sobre el tramo, con margen; en las nuevas, +0.08. Su stop corto la hace sensible al deslizamiento: con 0.05% por lado baja a +0.07 y +0.01. La B1 queda en el borde (ventaja sobre el tramo de −0.03 a +0.37) y aguanta más el deslizamiento. La fase 3 no se corrió. Resultados en `OrderFlowData/research/busqueda_genetica/2026-11-20/`. Después, a pedido del usuario, "Búsquedas anteriores" pasó al principio de la pestaña Búsqueda: estaba al final, bajo el informe de la búsqueda abierta. Y tras correr en todas las monedas, Resumen, Trades y Patrones señalan la tabla "Por moneda" de "Todas", donde cada moneda abre su corrida con sus trades, también las de otra ventana.
36. **Multitud, OI sostenido y constancia (20/11):** tras entender por qué cayó la Ruptura de caja (su ventaja venía de 4 trimestres de 23; ir con la multitud según el funding resta unos 0.10 R por trade en 8 reglas; que el OI suba de forma sostenida suma unos 0.05), el probador suma el funding de Bybit (`funding_update.py`), el filtro "Multitud (funding)" (no ir con ella, o solo contra ella) y el filtro "OI sostenido", también como genes de la búsqueda, y la **constancia por trimestre** (cada trade contra el azar de su trimestre): en el informe "Todas", en el tablero y como forma de elegir de la búsqueda (`test_crowd_constancy.py`, 6).
35. **Tablero de estrategias (19/11):** pestaña "Estrategias" del backtesting global con cada regla corrida, su resultado por fase en las monedas de siempre y en las nuevas, si pasa (ventaja sobre los dos controles con margen y R positivo), una lectura automática (si se achica en datos frescos, si la pone un lado, una moneda o un año) y "Las más sólidas" con el porqué; estado y nota por estrategia (`strategy_board.py`, `StrategiesTab.jsx`, `test_strategy_board.py`, 4). Ese día, en las 43 monedas nuevas, la Ruptura de caja con EMA 200 y CVD pasó las fases 1 y 2 (fase 2: +0.25 R, ventaja +0.23, casi todo en los cortos) y su versión de solo cortos pasó la fase 2 (+0.42 R, ventaja +0.30) pero cayó en la fase 3 (+0.12 R contra +0.13 de vender al azar).
34. **Monedas nuevas y búsqueda con todas las piezas (19/11):** `candles_update.py` baja velas de 1h y 4h de Bybit de 43 monedas más (las de más volumen que cotizan desde antes de 2022) a `OrderFlowData/candles`, fuera del repositorio. En el probador son el grupo "nuevas": ninguna regla se eligió con ellas, así que sirven de datos frescos en todas sus fechas. Selector de grupo en "Correr en todas las monedas". La búsqueda genética suma los elementos nuevos, las dos órdenes stop, el trailing, los filtros de CVD y OI y el régimen, con los controles en las mismas velas que dejan los filtros, y al terminar corre cada finalista en las monedas nuevas (`test_new_coins.py`, 2). Antes, en las fases de las 7 monedas de siempre, la Ruptura de caja con EMA 200 y CVD pasó la fase 2 (+0.39 R, ventaja +0.31) y cayó en la fase 3 (+0.11 R contra +0.15 del azar), y las dos FVG no pasaron la fase 2.
33. **Trailing, dos órdenes stop, Impulso y Compresión (19/11):** pedido tras recordar un bot de cripto con stop fijo y la ganancia con trailing. El probador suma trailing a una distancia en ATR o en % del mejor precio (con arranque en R y stop a la entrada), la entrada con dos órdenes stop, una arriba y otra abajo, en la que entra la primera que se llena (con su control al azar), y los elementos **Impulso** (avanza varios ATR en pocas velas) y **Compresión** (se detecta una caja; va con las dos órdenes). Fase 1, 4h, siete monedas: con entradas al azar el trailing ajustado pierde y uno amplio (stop 2 ATR, trailing 4) gana solo +0.10 y +0.04 R, por la tendencia de 4h; con ese trailing todas las reglas suben, pero también sus controles, y antes de 2023 casi ninguna los supera. Impulso con objetivo 3R: +0.13 y +0.22 contra +0.01. Las dos órdenes en velas al azar pierden −0.36 R con 3R (el golpe en horizontal que vio el usuario); por fuera de una compresión quedan cerca de 0 (`test_trailing_straddle.py`, 6).
32. **Nombres de los elementos (19/11):** en el probador, cada elemento se lee con un nombre corto en español en lugar de sus iniciales (casillas, descripción de la regla, trades, cortes, búsqueda, revisión y mensajes del backend), con el código al pasar el mouse (`elementLabels.js`). Los códigos internos no cambian: las reglas y corridas guardadas siguen valiendo.

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página.
- Perfil por sesión en BTC 15m, fase 1, sin gatillo: VR de 1 día al borde contrario, 256 trades y -0.25 R contra -0.16 del azar; VF de 1 día al POC, 1,931 trades y -0.44 R contra -0.40; VX de 1 día a 2R con stop de 1.5 ATR, 1,336 trades y -0.17 R contra -0.26. Ninguna gana, y solo la última se separa del azar, por poco (+0.10 R, de 0.00 a 0.19).
- LIQ en BTC 15m, fase 1 (desde julio de 2021, cuando empiezan las liquidaciones): 3,239 barridos con liquidaciones y 4,221 sin ellas. Con volumen alto de gatillo, stop detrás del barrido y 2R: 607 trades, -0.20 R por trade, contra -0.22 del azar y -0.25 de los barridos sin liquidaciones. No se distingue de ninguno de los dos.
- La primera corrida de cada marco y fase detecta los elementos de todo el tramo: en BTC 15m, 3 minutos la fase 1 y cerca de 1.5 la fase 2. Las siguientes tardan segundos.
- BTC tiene historia para las tres fases desde 2020; ETH, SOL, ARB y GALA tienen almacén desde más tarde (ver el punto 16). Los elementos del libro (AB, BL, LD) no se pueden probar: el libro existe desde el 13/11/2026.
- Las medidas empiezan donde empieza la tabla de medidas (unos 5 años atrás): los trades de 2020 y parte de 2021 no las llevan. Los indicadores que solo calcula el navegador (VWAP, S&R, Swing, patrones) no se guardan por trade.
- Primera corrida real (VA abandonada, stop en el swing, 2R, BTC 15m): fase 1, 2,154 trades y -0.20 R por trade contra -0.28 del azar; fase 2, 863 trades y -0.22 R contra -0.32. En ninguna se distingue del azar.
- Probado en la copia aislada con el almacén real de BTC: fases 1 y 2 en 15m, gráfico con cajas, lista, patrones, CSV y el candado de las fases. También el menú de inicio y "Mis órdenes" con una copia del registro real (30 órdenes). No se probó en 5m, la fase 3, el botón desde el Observador ni "Ver en el gráfico" de la simulación manual.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "PROBADOR DE REGLAS DEL OBSERVADOR (17/11/2026)"

---

### App 1 + Entrenamiento - 17 Noviembre 2026: Claude Ve App 1 al Entrenar

**Pedido:** que en el entrenamiento Claude pueda mirar App 1 (indicadores, footprints, lo que está haciendo) y aconsejar cuando se le pida, no solo interpretar una captura.

**Cambios:**
1. **App 1:** `window.__app1Coach` (`coachState.js`), de solo lectura. `state()` da moneda, marco, hora, precio, velas a la vista, indicadores con sus ajustes, lo elegido para el análisis, órdenes y caja TP/SL. `footprints()` y `elements()` piden al backend lo que está a la vista, cortado en la hora simulada. Con fecha oculta todo sale como lo ve el usuario.
2. **Skill `/entrenar`:** cómo leerlo con el navegador integrado o con Claude in Chrome. Sin futuro, sin revelar la fecha oculta, la predicción primero y sin tocar la página.
3. **Pruebas:** `coach.test.mjs` (7). Las demás de App 1 siguen pasando.

**IMPORTANTE:**
- Basta recargar la página de App 1: no hay cambios en el backend ni en lo que se ve.
- Con Chrome, instalar la extensión Claude in Chrome y permitirle `localhost`. Claude usa la pestaña de App 1 que ya está abierta, sin recargarla.
- Probado en la copia aislada con BTC 15m: estado, footprints y Elementos OF, sin nada después de la hora simulada. La fecha oculta, solo con pruebas. No se probó con Chrome ni en una sesión de `/entrenar`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTADO PARA EL ENTRENADOR (17/11/2026)" y `.claude/skills/entrenar/SKILL.md`, "Ver App 1 en vivo"

---

### App 1 + Altagracia Trading Suite - 16 Noviembre 2026: Rejection Patterns con la Regla Corregida

**Pedido:** revisar si el indicador de patrones de rechazo identifica bien los patrones, y corregirlo.

**Hallado** con 1000 velas reales de BTC por marco:
- el envolvente del servidor nunca salía (en cripto la vela abre en el cierre anterior), y el del navegador salía en el 26% de las velas;
- la mecha contraria se medía contra el cuerpo: se perdía la mitad de los martillos;
- no se miraba la tendencia previa;
- el filtro de volumen no filtraba;
- el modo validado medía con el cierre y sin lado.

**Cambios:**
1. **Una sola regla** para los dos detectores: `candlePatterns.js` (navegador) y `candle_patterns.py` (servidor y suite), con las formas de Nison y Bulkowski.
2. **Tendencia previa** de fábrica, que se apaga en el modal. El filtro de volumen (Z-Score) vale en los dos modos. Solo velas cerradas.
3. **Validado:** cuenta la mecha que toca el nivel y que la vela cierre de su lado.
4. **Pruebas:** `test_candle_patterns.py` (9, con paridad navegador contra servidor), `test_rejection_known.py` (13) y `leaks.test.mjs` (43).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página. La suite se reinicia sola al abrirla.
- Con la tendencia, en BTC 15m marca 29 martillos, 19 estrellas y 130 envolventes en 999 velas; antes, 0 o 271 envolventes según el modo.
- Se verá distinto: menos envolventes, martillos que antes faltaban y ninguno tras una subida.
- Probado con velas reales y en la pantalla de la suite. No en Electron ni en la pantalla de App 1 (usa el mismo indicador).

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REJECTION PATTERNS: REGLA CORREGIDA (16/11/2026)"

---

### Altagracia Trading Suite + App 1 - 16 Noviembre 2026: Marcos 1D, 1W y 1M y Triángulos de Elementos OF Explicados

**Pedido:** los marcos de 1 día, 1 semana y 1 mes, y explicar en el modal de Elementos OF qué son los triángulos rojos y verdes.

**Cambios:**
1. **1D, 1W y 1M** en el gráfico principal y en la Watchlist de la suite, con velas de Bybit. La semana empieza el lunes y el mes el día 1 (UTC). Sus gráficos se arman la primera vez que se abren.
2. **Indicadores:** los de velas funcionan en los tres. Footprints y Elementos OF, solo en 1D. Interés abierto, con el diario de Bybit. Swing, en 1D y 1W.
3. **Modal de Elementos OF (App 1):** debajo de "Triángulo con los códigos", qué significa el ▲ verde y el ▼ rojo, desde qué zoom salen los códigos y que no son señales.
4. **App 1:** `TimeframeTabs` acepta los marcos que le pasen, y `MiniChart` y los indicadores conocen `1M`. App 1 sigue con sus cinco marcos.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- En 1W y 1M no hay footprints ni Elementos OF, y en 1M tampoco Swing.
- Probado en la copia aislada con velas reales de BTC. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Marcos de 1 día, 1 semana y 1 mes (16/11)"

---

### Altagracia Trading Suite - 16 Noviembre 2026: Hueco del Mapa Sostenido y Cinta que Titilaba

**Pedido:** el mapa tenía un hueco de unos 30 minutos, y la cinta titilaba al elegir una orden.

**Cambios:**
1. **Hueco del mapa:** el minuto de las 12:50 (17:50 UTC) de BTC quedó incompleto por una resincronización del libro. Con "Solo la sostenida 30 min", un solo minuto así dejaba en blanco las velas de los 30 minutos siguientes. Ahora se saltan los minutos que faltan mientras sean a lo sumo 5 seguidos y esté al menos el 80% de la ventana (`book_heatmap.py`). Con el libro real, las velas de 17:50 a 18:15 UTC ya tienen datos.
2. **Cinta:** los botones de la fila elegida no cabían y la lista se desbordaba de lado (249 contra 235 px). Ahora bajan de línea, la lista no se desborda, cada fila conserva su lugar al llegar órdenes nuevas y la cinta solo se redibuja si cambiaron sus líneas (`TapePanel.jsx`).
3. **Pruebas:** `book_heatmap_checks.py` (24). Las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- El titileo no se pudo ver en la copia aislada: se corrigió el desborde que lo causa con pocas filas. Si sigue titilando, avisar con una captura o un video corto.
- Las resincronizaciones del libro siguen ocurriendo (286 en las 22 monedas desde el 15/11); este cambio solo evita que un minuto suelto borre media hora del mapa.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` secciones "Mapa de liquidez" y "Órdenes de la cinta como líneas en el gráfico (14/11)"

---

### Entrenamiento - 14 Noviembre 2026: Gimnasio de Order Flow y Skill /entrenar

**Pedido:** un plan para aprender order flow (footprints, Elementos OF y el libro) practicando con las herramientas que ya hay, a pasos pequeños y sin mucha teoría.

**Cambios:**
1. **Gimnasio de Order Flow** (desde el 21/11 se llama **Gimnasio Trading**; artefacto privado, https://claude.ai/artifact/H8pzTyhuPvJcHheAEcQVho): 5 etapas y 21 habilidades (16/11: los Elementos OF por familias, zonas, giro, continuación, tabla y libro, con un código del día que rota y se anota en la sesión), cada una con su ejercicio "predice, revela y anota" en App 1 o en la suite, registro de sesiones, repasos a 1, 3, 7, 14 y 30 días y un entrenador. Fuente: `.claude/skills/entrenar/gimnasio.html`.
2. **Skill `/entrenar`** (`.claude/skills/entrenar/SKILL.md`): sesión de práctica con Claude Code sobre las capturas del usuario. Con una ficha por habilidad (`fichas.md`): qué es, cómo lo hace la herramienta, qué mirar, errores típicos y lo medido en sus datos. Se lee solo la del día; `/entrenar ficha LD` muestra una. Lee y anota el registro del gimnasio, y comprueba cada lectura con `verificar.py` (solo lectura: delta, volumen, POC, imbalances, Elementos OF con AB, BL y LD, y lo que hizo el precio después).

**IMPORTANTE:**
- El skill aparece en una sesión nueva de Claude Code abierta en el repositorio.
- Con "Fecha al azar y oculta" la captura no trae la fecha ni el precio real: ahí se corrige con lo que se ve.
- Probado: `verificar.py` con velas reales de BTC 15m, y escribir y borrar una sesión de prueba en el registro. El entrenador de la página y una sesión completa de `/entrenar` no se probaron.

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Libro Delgado y Medidas del Libro en el Observador

**Pedido:** lo que faltaba del plan del libro: el evento "libro delgado" (poca profundidad cerca del precio) y las medidas del libro en el Observador de App 1, que solo tenía el journal de la suite.

**Cambios:**
1. **Libro delgado (LD)** en Elementos OF: lo que espera a 0.25% del precio en la vela queda bajo el percentil 5 de las 24 horas anteriores. Marca con celdas el lado más delgado: alcista si son las ventas, bajista si son las compras. Lo calcula la suite (`book_events.py`); App 1 lo tiene en su catálogo, encendido de fábrica.
2. **Observador de App 1:** las 9 medidas del libro del journal en la lectura de cada orden (grupo "Libro") y en el informe de ganadoras contra perdedoras. `book_reading.py` importa `book_measures.py` de la suite sin copiarlo.
3. **Pruebas:** `book_events_checks.py` (18) y `test_book_reading.py` de App 1 (4). Las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva. **Reiniciar el backend de App 1 (9000)** para las medidas del libro.
- El libro existe desde el 13/11/2026: una orden de App 1 simulada en una fecha anterior queda sin estas medidas.
- LD marcó en 5m, en las 24 horas hasta el 14/11 a las 22 h, 31 de 288 velas en BTC, 42 en ETH y 46 en SOL, casi todas del sábado por la tarde. El umbral sale de las 24 horas anteriores, y el libro del sábado es más delgado que el del viernes. No está validado contra el azar.
- Probado en la copia aislada con el libro real: LD en la ruta de Elementos OF de BTC 15m y en el modal. Las medidas, con una orden de BTC de hace 3 horas (9 medidas en 0.25 s). No se probó con una orden real en la pantalla de App 1 ni en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Menú "Capas", filtro, zonas automáticas y absorción y barrido del libro (14/11)", "Después", y `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REGISTRO AUTOMÁTICO"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Líneas de la Cinta para el Análisis, sin Vencer y con Estilo

**Pedido:** que las líneas de la cinta en firme se puedan incluir en el análisis del trade (Observador), que no se borren con el tiempo sino solo a mano, y poder cambiar su estilo: se veían muy protagonistas.

**Cambios:**
1. **Análisis:** un clic sobre una línea en firme en el gráfico principal abre "Incluir en el análisis" ("Orden de venta 98k (16:00) · Cinta"). Entra a la lista del panel con su papel y va con la orden al journal y al Observador.
2. **"En firme (N)"** en la cinta: todas las líneas en firme de la moneda, aunque su orden ya salió de la cinta, con "Borrar".
3. **Estilo** (⚙ en la cinta): grosor, trazo, opacidad y texto (corto, completo o sin texto, con su tamaño), para todas. De fábrica, discretas: 1 px, 55% y texto corto.
4. **App 1:** `HorizontalLine.js` suma opacidad y tamaño y fondo del texto, opcionales; `tapeDrawingLevels` y el clic que abre el menú en `MiniChart`. Sin líneas de la cinta, nada cambia.
5. **Defensa de zona:** la línea de la cinta es una zona con su texto corto, y las demás líneas salen con su precio redondeado.
6. **Pruebas:** `tapelines.test.mjs` (6) y `tapelevels.test.mjs` de App 1 (1). Las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en la copia aislada con trades en vivo: estilo discreto, "En firme (1)", y el clic en la línea abrió el menú y la orden entró a la lista del panel. No se probó en Electron ni con una orden real.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Órdenes de la cinta como líneas en el gráfico (14/11)", "Después"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Órdenes de la Cinta como Líneas en el Gráfico

**Pedido:** al hacer clic en una orden de la cinta, verla en el gráfico como una línea horizontal con su información, y poder dejarla en firme o borrarla.

**Cambios:**
1. **Clic en la cinta:** pone una línea a su precio promedio, con el texto de la orden ("Cinta ▼ venta 1.16 · 76k · 14:47:19"), provisional y punteada. Una sola provisional por moneda.
2. **"Dejar en firme" y "Borrar"** en la fila. En firme queda continua; es un dibujo de la moneda y se ve en el mapa, el gráfico principal y la Watchlist (`tapeLines.js`).
3. **App 1:** `HorizontalLine.js` acepta un texto opcional (`label`). Sin texto se ve igual.
4. **Pruebas:** `tapelines.test.mjs` (4). Las demás de App 1 siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en la copia aislada con trades en vivo: provisional, en firme y borrada. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Órdenes de la cinta como líneas en el gráfico (14/11)"

---

### Altagracia Trading Suite - 14 Noviembre 2026: Stop y Objetivo desde el Ladder y Cinta de Operaciones Grandes

**Pedido:** sin una caja TP/SL dibujada, el clic en el ladder solo ponía el precio. El usuario pidió elegir en el ladder también el stop y el objetivo, que la app redibuje la caja, y la cinta de operaciones grandes.

**Cambios:**
1. **"Clic pone: Entrada · Stop · Objetivo"** en el ladder (`ladderPlan.js`), que avanzan solos. Con los tres, el ladder dibuja la caja TP/SL de la moneda (una, que se reemplaza), la guarda y la avisa a las otras pestañas; el panel la toma y la orden se confirma como siempre.
2. **Cinta de operaciones grandes** (`TapePanel.jsx`) a la derecha del ladder, con su opción en Capas. Muestra las órdenes a mercado grandes, con los trades del mismo instante y lado juntos: hora, lado, precio o rango (barrido), cantidad y USD. El mínimo puede ser automático (el 1% más grande de 30 minutos) o fijo. Arriba, compra contra venta de los últimos 30 s.
3. **Servidor:** `/api/book/tape/{símbolo}` (`ladder.py`), de los trades que ya recibe la suite.
4. **Pruebas:** `ladder_checks.py` (24), `ladderplan.test.mjs` (5) y `ladder.test.mjs` (12).

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en la copia aislada con el libro y los trades en vivo: la caja se dibujó y el panel de otra pestaña la tomó. No se probó en Electron ni con el bot.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Stop y objetivo desde el ladder, y cinta de operaciones grandes (14/11)"

---

### Altagracia Trading Suite - 14 Noviembre 2026: Ladder para Ejecutar

**Pedido:** el ladder para ejecutar.

**Cambios:**
1. **Clic en el ladder → panel de trading:** en Compra pone una Limit de compra a ese precio; en Venta, una de venta. El panel deja la caja TP/SL y avisa; el stop, el objetivo y el tamaño se revisan ahí, y enviarla sigue pidiendo la confirmación de siempre. El precio viaja entre pestañas y ventanas (`ladderPick.js`); si el panel estaba oculto, el gráfico de esa moneda lo abre.
2. **Cola estimada** de tus Limit en el ladder: "delante 0.5–2.0 · negoc. 1.0". Lo negociado en tu precio te acerca; lo retirado da un rango, porque no se sabe si estaba delante.
3. **Servidor:** `/api/book/ladder` con `watch=precio:desde` da lo que espera y lo negociado en el precio exacto.
4. **Pruebas:** `ladder_checks.py` (19) y `ladder.test.mjs` (12).

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en la copia aislada con el libro en vivo: el clic llegó al panel de otra pestaña. La cola solo con pruebas, sin órdenes reales. No se probó en Electron ni con el bot.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Ladder para ejecutar (14/11)"

---

### Altagracia Trading Suite + PanelOrderFlow - 14 Noviembre 2026: Una Bajada de la Nube a la Vez

**Pedido:** el registro de la suite tenía errores al bajar los trades de la nube ("el proceso no tiene acceso al archivo porque está siendo utilizado por otro proceso", ETH del 14/11). Tras un reinicio, la bajada anterior seguía corriendo y chocaba con la nueva.

**Cambios** (`PanelOrderFlow/sync_nube.py`, que usan la suite y el 11000):
1. **Candado** `live/cloud/descarga.lock`: una bajada a la vez; si otra sigue, esa vuelta no baja nada.
2. **Reemplazo con reintentos:** el archivo de la nube se reemplaza reintentando hasta 15 s, porque el armado de cada minuto puede estar leyéndolo.
3. **Temporal que no se puede borrar:** ya no corta la vuelta.
4. **Menú "Capas":** crece con su contenido, sin barra de desplazamiento (pedido del usuario).
5. **Pruebas:** `sync_checks.py` suma 5 (31).

**IMPORTANTE:** la suite se reinicia sola al abrirla. Una bajada vieja que siga corriendo no usa el candado: desde el siguiente reinicio todas lo usan.

**Ver:** `PanelOrderFlow/LEEME.md` sección "Días recientes: nube y PC", "Una bajada a la vez"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Menú Capas, Filtro, Zonas Automáticas y Absorción y Barrido del Libro

**Pedido:** tras probar:
- la defensa no mostraba nada en BTC;
- los minutos de Niveles no parecían cambiar el gráfico;
- un control para dejar solo lo significativo;
- absorción y barrido en los elementos del footprint;
- un menú para la barra llena.

**Cambios:**
1. **Menú "Capas ▾"** en la pestaña "Mapa": modo y minutos del mapa, colores, Niveles, Defensa, Ladder y seguir al gráfico principal. En la barra quedan la moneda, los marcos y el filtro.
2. **Filtro "Solo lo grande"** (0 a 100): en el mapa deja transparente lo de menos; en Niveles deja los de más USD.
3. **Defensa con zonas automáticas:** BTC no tenía dibujos. Ahora suma POC, VAH y VAL del día anterior, FVG de 1h y niveles del journal.
4. **Niveles:** los minutos sí cambian lo que se dibuja (BTC: 57 niveles con 15 min, 4 con 4 h). Las franjas gruesas son del mapa, que tiene sus propios minutos.
5. **Elementos OF con el libro** (`book_events.py`, solo en la suite): **AB** absorción en el libro y **BL** barrido de un nivel sostenido. En BTC 5m, 12 horas: AB en 12 de 144 velas, BL 19.
6. **Pruebas:** `book_events_checks.py` (11), `book_defense_checks.py` (15), y en App 1 `sustainedlevels.test.mjs` (6) y `liquiditymap.test.mjs` (14). Las demás siguen pasando, también las de Elementos OF.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en la copia aislada con el libro, los trades y el almacén reales de BTC y ETH; no se probó en Electron. Nada está validado contra el azar.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Menú "Capas", filtro, zonas automáticas y absorción y barrido del libro (14/11)"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Retiro Cerca y Defensa de Zona

**Pedido:** primero marcar aparte el nivel que se retira con el precio cerca, y después la defensa de las zonas: si una zona se sostiene hasta que el precio vuelve.

**Cambios:**
1. **Retiro cerca** en "Niveles": un retirado a media ATR de 15m o menos del precio lleva ✕ grande con su etiqueta, y el estado dice el último de la última hora. En 24 horas: BTC 2 de 11 retirados, ETH 0 de 14.
2. **Botón "Defensa"** en la pestaña "Mapa", con tus líneas horizontales y rectángulos:
   - en cada llegada del precio, la letra del patrón: D defensa, A absorción, B barrido, R retiro y rebote, X retiro y cruce, C consumida;
   - la última visita de cada zona dice cuánto quedó al llegar, lo negociado y la antigüedad;
   - las zonas cerca del precio dicen lo que hay de su lado contra hace 30 minutos.
3. **Servidor:** `/api/book/defense/{símbolo}` (`book_defense.py`) con la regla de `book_study.visits`, sin copiarla. `book_levels.py` suma `near` y `dist_atr`.
4. **App 1:** `ZoneDefenseIndicator.js` y `zoneDefense.js`. App 1 no lo ofrece.
5. **Pruebas:** `book_defense_checks.py` (13), `book_levels_checks.py` (16), y en App 1 `zonedefense.test.mjs` (4) y `sustainedlevels.test.mjs` (5). Las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Con el libro real, la línea de 65,500 de BTC: defensa a las 10:15, consumida a las 10:18 (12.6M negociados contra la compra) y después resistencia defendida. No es una señal ni está validado contra el azar.
- Probado en la copia aislada con el libro y los trades reales de BTC y ETH y zonas de prueba; no se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Retiro cerca y defensa de zona (14/11)"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Mapa con Compra y Venta por Separado

**Pedido:** en BTC, una franja naranja en 65,500 no se borró cuando el precio la pasó. En el libro grabado, las compras de ese precio se fueron a las 10:19 y en el mismo precio aparecieron ventas: el mapa sumaba los dos lados. El usuario pidió separarlos.

**Cambios:**
1. **"Compra y venta"** (de fábrica) o "Una escala" en la pestaña "Mapa". Cada precio va con el lado que más tiene, en los colores del interés abierto del estilo (Nítido: azul la compra y naranja la venta), con leyenda.
2. **Servidor:** `/api/book/heatmap` con `sides=1` da `cells_b` y `cells_a`, cada lado con su propio promedio o mínimo. Así un soporte roto desaparece y la resistencia en ese precio aparece cuando se sostiene.
3. **App 1:** `liquidityMap.js` guarda y pinta los dos lados (`sideRamp`, `hexRgb`). App 1 no tiene el mapa.
4. **Pruebas:** `book_heatmap_checks.py` (22) y `liquiditymap.test.mjs` de App 1 (12). Las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Probado en la copia aislada con el libro real de BTC, en los dos modos y con Nítido y Oscuro. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Mapa con compra y venta por separado (14/11)"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Niveles de Liquidez Sostenida

**Pedido:** de las ideas de indicadores con el mapa y el ladder, el usuario eligió los niveles sostenidos: como DOM Levels de ATAS, pero filtrados por tiempo y diciendo cómo terminó cada nivel.

**Cambios:**
1. **Botón "Niveles"** en la pestaña "Mapa", con "≥ 15 min" a "≥ 4 h". Una línea por nivel encima del mapa, verde si es compra y roja si es venta, punteada hasta que se sabe que es sostenido. Al final: ● consumido (el precio llegó), × retirado (se fue antes) o | sin dato. Los que siguen llevan su USD, cuánto llevan y sus toques.
2. **Servidor:** `/api/book/levels/{símbolo}` (`book_levels.py`), del libro de minutos. Grande = percentil 95 de su lado a ±2% y al menos 3 veces la mediana; sigue mientras tenga la mitad de lo que tenía al empezar. Solo usa lo ya ocurrido.
3. **App 1:** `SustainedLevelsIndicator.js` y `sustainedLevels.js`, dibujados de fondo. App 1 no lo ofrece.
4. **Pruebas:** `book_levels_checks.py` (12) y `sustainedlevels.test.mjs` de App 1 (4). Las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- El mapa suma compra y venta en cada precio. El 14/11, BTC tuvo compras en 65,500 desde las 07:52; a las 10:19 se fueron y aparecieron ventas en ese precio, y la franja del mapa siguió. "Niveles" separa los dos lados.
- La mayoría de los retirados están lejos del precio: no es carnada. Los umbrales no están validados contra el azar.
- Probado en la copia aislada con el libro real de BTC y ETH; con Oscuro las líneas se distinguen poco sobre un mapa cargado. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Niveles de liquidez sostenida (14/11)"

---

### Altagracia Trading Suite + App 1 - 14 Noviembre 2026: Franjas de Imbalances con Zoom, Filtros Relativos, Perfil de Delta y Cierres que Bybit no Da

**Pedido:**
- con zoom, no se veían las franjas de los imbalances en los footprints;
- el volumen mínimo del lado dominante, en % respecto a las velas anteriores en lugar de monedas;
- un perfil de delta junto al de volumen, o cualquiera de los dos;
- luego llevarlo a App 1.

**Cambios** (indicador Order Flow y modal de App 1, que la suite importa: valen en las dos):
1. **Franjas con zoom:** cada stacked deja una franja desde su vela hacia la derecha ("Largo" del modal, 3 velas), con borde arriba y abajo. Con Nítido, un imbalance suelto lleva una barra de 2 px en su celda.
2. **Filtros relativos** (tras la primera prueba, en lugar del % por nivel; los calcula `footprint_store.py`):
   - volumen de la vela en % del promedio de las N velas anteriores (1 a 100, 20 de fábrica), solo con velas anteriores;
   - volumen de la celda del imbalance en % de su vela; un stacked se mide por la suma de sus celdas.
3. **Perfil de delta:** "Perfil junto al footprint": Volumen, Delta, o Volumen y al lado el delta.
   Después, el **área de valor de cada vela** (70% de fábrica) en el perfil de volumen del footprint, en el color "Área de valor" del estilo.
4. **Pruebas:** `orderflow.test.mjs` (36) y `test_footprint_rules.py` (con `test_footprint_live.py`, 35). Las de la suite siguen pasando.
5. **Bot, trade que no llegaba al journal:** el TP de un short de BTC (abierto desde el 12/11) se ejecutó el 14/11 a las 10:25 en la cuenta Demo, pero Bybit nunca lo dio en `closed-pnl`, de donde el journal toma los cierres: quedó abierto. Ahora, si la posición lleva 3 minutos sin existir y `closed-pnl` no la cerró, el bot arma el cierre con las ejecuciones de la orden que cerró (`/v5/execution/list`): salida y comisión de cierre reales, apertura estimada. Queda marcado "≈" en la suite; si después llega la fila de `closed-pnl` de esa orden, la reemplaza. Los cierres se piden con 7 días cada minuto (antes 1). Pruebas: `journal_checks.py` del bot (37).

**IMPORTANTE:**
- Reiniciar el backend de App 1 (9000) y recargar su página. La suite se reinicia sola al abrirla.
- El mínimo en monedas guardado antes se ignora: empieza sin filtro.
- **Bot:** hay que cerrar el que corre (desde el 13/11 a las 14:42; un segundo arranque falla con "10048": el puerto 5000 ya está ocupado por él) y volver a abrirlo. Unos 4 minutos después de arrancar, el short de BTC queda cerrado con P&L aproximado.
- Probado en la copia aislada de la suite con el almacén real de BTC; App 1 usa el mismo dibujo y se probó su modo de 10 niveles en el almacén, no en su pantalla. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Footprints: franjas con zoom, mínimo relativo y perfil de delta (14/11)" y `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ORDER FLOW SOBRE LAS VELAS", "Parámetros"

---

### Altagracia Trading Suite - 14 Noviembre 2026: Price Ladder en la Pestaña del Mapa

**Pedido:** hacer el ladder en la misma pestaña del mapa, y revisar cómo va el mapa.

**Cambios:**
1. **Ladder** a la derecha del mapa (`LadderPanel.jsx`, `ladderLogic.js`), con el botón "Ladder" para mostrarlo u ocultarlo. Por precio:
   - lo agregado o retirado en los últimos 5 s, en compra y en venta;
   - la compra y la venta en espera, con los muros en negrita;
   - lo negociado en la ventana, de 1 a 30 minutos;
   - tus posiciones y órdenes;
   - step automático o de 1 a 1000 ticks, y "Centrar". La rueda lo mueve.
2. **Servidor:** `/api/book/ladder/{símbolo}` (`ladder.py`) lee el libro que el grabador ya tiene en memoria y los trades que ya recibe: no abre otra conexión a Bybit. Cada pedido tarda 5 a 7 ms.
3. **Huecos del mapa:** en "Solo la sostenida", una vela queda en blanco si falta un minuto de su ventana. En BTC son del 13/11 15:15 a 15:42 y el 13/11 22:12, un minuto incompleto en la nube mientras la suite estaba cerrada.
4. **Step en precio y por moneda:** cada opción dice el precio y los ticks ("2.5 · 250 ticks"), y cada moneda recuerda el suyo. Antes 10 ticks eran 0.1 USD en ETH y 1 USD en BTC.
5. **Pruebas:** `ladder_checks.py` (16) y `ladder.test.mjs` (8). Las demás de la suite siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- Solo para mirar: falta el clic que pone el precio en la Limit del panel y la cola estimada de tu Limit.
- Probado en la copia aislada con el libro real de BTC, en BTC 5m y en ETH 1m con Oscuro; las marcas de tus posiciones, solo en las pruebas. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Price ladder en la pestaña "Mapa" (14/11)"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Mapa de Liquidez en una Pestaña Aparte

**Pedido:** construir el mapa de liquidez como una opción del gráfico principal que abra una pestaña aparte. Así se mantiene la visualización original y sus datos sin mezclarlos con el mapa.

**Cambios:**
1. **Botón "Mapa"** en el encabezado del gráfico principal: abre el mapa en otra pestaña (en Electron, otra ventana), con la moneda y el marco a la vista. Usa la pestaña que ya lo muestra, o la primera libre de la 2 a la 5: cada pestaña anota cada 4 s que está abierta. El menú "Pestañas" suma "Mapa". El gráfico principal no cambia.
2. **Pestaña "Mapa"** (`LiquidityMapView.jsx`):
   - un gráfico solo con el mapa, detrás de las velas;
   - tus dibujos se ven sin editarse, y las posiciones del bot sin acciones;
   - "Solo la sostenida" (de 5 minutos a 4 horas) o "Toda la liquidez";
   - "Seguir al gráfico principal".
3. **Servidor:** `/api/book/heatmap/{símbolo}` (`book_heatmap.py`), por vela y precio, del libro grabado en el PC y bajado de la nube. Cada celda va en un byte.
4. **App 1:**
   - `MiniChart` suma un fondo para los indicadores (`renderBackground`), dibujado antes de las velas;
   - el indicador "Mapa de liquidez" (`LiquidityMapIndicator.js`, `liquidityMap.js`). App 1 no lo ofrece: no tiene libro de sus fechas. Sin él, nada cambia.
5. **Pruebas:** `book_heatmap_checks.py` de la suite (17) y `liquiditymap.test.mjs` de App 1 (10). Las demás siguen pasando.
6. **Tras la primera prueba del usuario:**
   - el mapa vuelve a pedir cada minuto las velas recientes incompletas, y lo que llega de la nube aparece sin recargar;
   - la grabación de trades reintenta si la suite abre sin red. Ese día no grabó ni bajó la nube, y faltaron footprints de más de una hora (`local_tape.py`; prueba `local_tape_checks.py`, 3);
   - un pedido del libro a la nube se da por perdido tras 2 minutos sin datos.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva.
- El mapa existe desde el 13/11 a las 14:43. Lo que no se grabó, como las 15:15 a 15:42, queda vacío.
- **Probado en la copia aislada con el libro real:**
  - BTC y ETH, en 15m y 1m, en los dos modos y con Nítido y Oscuro;
  - la pestaña siguió al gráfico principal;
  - ETH 1m de 2 horas pesó 36 KB y tardó 14 ms.

  El panel de pruebas abrió el mapa en la misma pestaña porque no abre ventanas. No se probó en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Mapa de liquidez" y `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REPRODUCCIÓN LIGERA", "Fondo de los indicadores"

---

### Altagracia Trading Suite + TradingBot + App 1 - 13 Noviembre 2026: Prueba en Demo, Apalancamiento, Nube contra el Oficial y Excel del Dashboard

**Pedido:** para cerrar la etapa, cuatro cosas:
- probar a fondo en Demo cerrar, mover el SL y el TP y cancelar órdenes;
- cambiar el apalancamiento desde la suite (el bot no tenía cómo);
- comparar un día completo de la nube con el archivo oficial de Bybit;
- "Exportar a Excel" en el dashboard del journal.

**Cambios:**
1. **Prueba en Demo**, con la suite, el bot y la cuenta Demo del usuario, en XRPUSDT con 20 XRP:
   - abrir, mover el SL y el TP, quitar y poner el TP, cerrar a mercado y cancelar una Limit llegaron a Bybit, cada uno con su confirmación;
   - se rechazaron, sin tocar la posición, quitar el SL, un SL del lado equivocado y cerrar sin la palabra;
   - el short de BTC del usuario no se tocó, y el trade quedó en el journal con una nota de prueba.
2. **Apalancamiento:**
   - **bot:** ruta `POST /api/config/leverage`. Lo fija en Bybit bajo el candado de la moneda y lo guarda solo si Bybit lo acepta;
   - **suite:** "Aplicar" en la celda de cada moneda, con la palabra `CAMBIAR_APALANCAMIENTO`.
3. **Nube contra el oficial:** `PanelOrderFlow/comparar_nube.py` compara trade por trade, minuto a minuto y celda por celda. Solo lee OrderFlowData y baja el oficial aparte. Resultado del 13/11, el primer día entero de la nube, en BTC, ETH, SOL y XRP:
   - fuera de los minutos que tocan un hueco, la nube fue idéntica al oficial y nunca tuvo un trade de más. Del 99.989% al 99.993% de los trades tuvo pareja exacta, y todos los minutos enteros y todas las celdas del footprint fueron iguales;
   - lo perdido pasa hasta 9 s el hueco anotado. Por eso la unión nube + PC dejó 2 o 3 minutos "enteros" por moneda con menos volumen, donde la nube volvía de un reinicio. El peor, SOL a las 17:51 UTC, tiene 40% menos;
   - arreglo posible, no hecho: ensanchar los huecos 10 s al unir. El usuario prefirió dejarlo así y volver a comparar en unos días, ya sin los reinicios del collector.
4. **Excel del dashboard:**
   - el botón de App 1 con las hojas del journal: trades, resumen, por origen y por moneda, más las imágenes de los gráficos;
   - exporta los trades seleccionados con los filtros puestos.

   App 1 suma `addSheets`, `fileName` e `imageBackground`, que App 1 no pasa. Además, el botón termina los gráficos de Chart.js antes de copiarlos: exportando durante su animación, la imagen salía en blanco o con la curva anterior. Esto vale también en App 1.
5. **Pruebas:**
   - `leverage_checks.py` del bot (13);
   - en la suite, `bot_checks.py` (59) y `journalExcel.test.mjs` (12).

   Las demás de la suite y del bot siguen pasando.

**IMPORTANTE:**
- **Reiniciar:** el bot (5000), para la ruta del apalancamiento. La suite se reinicia sola al abrirla. Los paquetes del Excel (`exceljs` y `html2canvas`) ya quedaron instalados en la copia principal.
- **Apalancamiento:** probado en la copia aislada con un bot falso, no en Demo.
- **Excel en Electron:** la descarga llegó a Electron con su nombre y su tamaño (probado en una ventana aparte). El diálogo para guardar no se vio.
- **Demo:** la página de prueba se abrió con `?tab=5` en lugar de `?pestana=5`, quedó como pestaña 1 y tomó una segunda imagen de cierre del trade de XRP.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` secciones "Posiciones en el gráfico", "Configuración del bot", "Nube contra el archivo oficial" y "Journal"; `10.TradingBotDesktop/CLAUDE.md` sección "Apalancamiento desde la suite y prueba en Demo"; `PanelOrderFlow/LEEME.md` sección "Nube contra el archivo oficial"; `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "DASHBOARD DE TRADING, COMPARTIDO CON LA SUITE"

---

### Altagracia Trading Suite - 13 Noviembre 2026: Medición del Libro con Antigüedad, Velocidad y Patrones

**Pedido:** saber si en sus zonas hay órdenes que se sostienen hasta que el precio vuelve, o una "carnada". El usuario pidió sumar a la medición la antigüedad de la liquidez, la velocidad de llegada y el patrón de cada visita.

**Cambios** (`server/book_study.py`):
1. **Antigüedad:** minutos seguidos, hasta 4 horas, en que la zona tuvo al menos la mitad de lo que tenía en el minuto antes de acercarse el precio, y qué parte estuvo toda la hora anterior. Usa el promedio de cada minuto. La suma de los mínimos de cada precio salía en la mediana al 44% del promedio aunque nada se retirara, porque cada precio baja en un segundo distinto.
2. **Velocidad de llegada:** segundos en recorrer el último 1/4 de ATR hasta la zona.
3. **Patrón de cada visita**, con la misma regla para tus zonas y el azar: barrido, absorción, defensa, retiro y rebote, retiro y cruce (lo esperable de un muro falso) y consumida.
4. **Pruebas:** `book_checks.py` suma 9 (69).

**IMPORTANTE:**
- **Primera lectura**, con unas 5 horas de libro en 8 monedas, que no permite concluir nada:
  - tus zonas aguantaron 8 puntos más que el azar, con un margen de −5.8 a +21.8;
  - la liquidez es joven: tiene 7 a 8.5 minutos de antigüedad mediana, y solo un 9-11% estuvo toda la hora anterior;
  - en el 20% más cargado de tus zonas, 9 de cada 10 visitas fueron defensa, contra el 59% en el azar.
- Se probó también una vista previa del mapa de liquidez con el BTC grabado, fuera del repositorio: toda la liquidez contra la que se sostuvo 30 minutos.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Libro completo", "Antigüedad, velocidad y patrones"

---

### Altagracia Trading Suite - 13 Noviembre 2026: Borrar Imágenes del Análisis y Volver al Journal

**Pedido:** tras probar el análisis post-trade: poder borrar una imagen desde la suite, y un botón en la barra del gráfico para volver al journal.

**Cambios:**
1. **"Volver al journal"** al final de la barra del trade, con o sin análisis. Quita el trade del gráfico y abre el journal en ese trade, con su detalle a la vista.
2. **"Borrar"** bajo cada imagen de análisis del trade, con confirmación. Solo las de análisis; los dibujos del análisis no se tocan. El archivo de contextos solo se agrega: una línea la quita del journal y el PNG se borra.
3. **Conclusión sin guardar:** "Terminar análisis", "Quitar" y "Volver al journal" preguntan antes de perderla (solo se guarda con la imagen).
4. **Barra centrada sobre el gráfico:** en una ventana angosta su comienzo quedaba bajo la barra de dibujo.
5. **Pruebas:** `journal_checks.py` (89). Las demás de la suite siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- Un borrado no se puede deshacer.
- Probado en la copia aislada con un bot falso y la ventana a 1024 px; no en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal", "Análisis post-trade"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Análisis Post-Trade desde el Journal

**Pedido:** desde "Ver en el gráfico" de un trade del journal, poder dibujar sobre el gráfico (por ejemplo conclusiones) y guardar una imagen en el journal: un análisis post-trade.

**Cambios:**
1. **"Análisis post-trade"** en la barra de "Ver en el gráfico". Mientras dura:
   - lo dibujado va a una capa del trade, no a los dibujos de la moneda;
   - los cinco marcos la muestran en lugar de los de la moneda;
   - no pasa al panel de trading, al Swing ni a las otras pestañas;
   - al volver a abrir el análisis del trade, sus dibujos siguen ahí y se pueden editar.
2. **Lo elegido:** el gráfico muestra los niveles de la decisión de ese trade, numerados, en lugar de la lista del panel.
3. **"Guardar imagen en el journal":** la imagen del marco a la vista, tal como se ve, con una conclusión opcional. El journal la muestra entre las imágenes del trade como "Análisis post-trade", con su conclusión. Se pueden guardar varias.
4. **Termina** con "Terminar análisis", "Quitar", otra moneda u otro trade: vuelven los dibujos de la moneda.
5. **App 1:** `MiniChart` suma dos props opcionales que App 1 no pasa: `drawingsSource`, otra capa de dibujos, y `chosenItems`, lo elegido a la vista. Sus imágenes ya no salen con la selección ni el resaltado de un dibujo.
6. **Pruebas:** `journal_checks.py` de la suite (79). Las demás de la suite y de App 1 siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- Una imagen guardada se borra desde el journal (agregado después, ver la entrada de arriba).
- Probado en la copia aislada con un bot falso y un trade de BTC con su decisión:
  - una línea de BTC dibujada antes desapareció en el análisis y volvió al terminarlo;
  - la línea y la caja de texto del análisis quedaron solo en el trade, también en 1H, y volvieron al abrirlo otra vez;
  - la imagen llevó la caja del trade, el ① de su VAL y lo dibujado, sin la línea de BTC, y salió en el journal con su conclusión.

  No se probó con trades reales ni en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal", "Análisis post-trade"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Pendientes del Journal (Regla del Laboratorio, Delta y OI Recientes, Lo Elegido en la Apertura)

**Pedido:** los tres pendientes del journal:
- la lectura de la regla del laboratorio, como en el Observador de App 1;
- el delta y el interés abierto de los días recientes en las medidas, que salían "—";
- lo elegido para el trade en la imagen de apertura, como App 1.

**Cambios:**
1. **Regla del laboratorio:** al abrir un trade cerrado, el detalle muestra lo que leía la regla en el minuto de la decisión: contexto de 4 horas y de 1 hora, movimiento con volumen, zona cerca de la entrada, OI y volumen. Usa `observer.read_at` de App 1 sin copiarlo (`journal_reading.py`), con lo ocurrido antes de decidir. Con el trade abierto no se ve, como en App 1.
2. **Lectura parcial:** la regla mira 45 días hacia atrás. Una moneda con menos días de trades grabados sale con aviso y no entra en el informe. Hoy son completas BTC, ETH, SOL y ARB; las demás tienen trades desde el 12/11.
3. **Informe:** suma "Lo que leía la regla", con las tablas del informe del Observador:
   - acierto y R con y sin cada condición;
   - cuánto se sigue cada parte de la regla;
   - entradas cerca de una zona contra el azar;
   - mejores trades contra peores.
4. **Delta y OI recientes** (medidas versión 2; las guardadas se recalculan):
   - **OI:** el de App 1 más lo que le falta, de Bybit;
   - **delta:** los días de la nube y el PC donde falta el oficial, sin las velas con un hueco de 10 s o más.
5. **Imagen de apertura:** dibuja, con sus números, los niveles de la decisión de ese trade (`openDecision.js`). La busca en el journal hasta 4 veces, porque la decisión se guarda cuando el bot responde. Un trade de una alerta no lleva nada elegido.
6. **App 1:** `read_at` y `compute` aceptan `live` y la serie de OI. App 1 no los pasa, así que no cambia.
7. **Pruebas:**
   - suite: `journal_checks.py` (63) y `openDecision.test.mjs` (5);
   - App 1: `test_observer.py` y `test_measures.py` suman 5 (163 con patrones y footprints en vivo);
   - las demás siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- El informe calcula hasta 8 medidas y 8 lecturas por pedido. Tras esta actualización conviene pedirlo varias veces: las medidas se recalculan.
- Las reconexiones del WebSocket (5.8 s) no dejan sin delta su vela. Comparado con Bybit, el volumen quedó entre 0.1% y 0.6% bajo, y una vez, en XRP, 6.4%.
- Probado en la copia aislada con el almacén real (solo lectura), un bot falso y el OI real de Bybit:
  - la lectura de un long de BTC fue igual a una llamada directa a App 1;
  - el OI y el delta de las medidas coincidieron con un cálculo aparte;
  - las imágenes de apertura de BTC, ETH, SOL, ADA y DOGE salieron con sus niveles numerados, y la de XRP, sin decisión, sin ninguno.

  No se probó con trades reales ni en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal" y `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "OBSERVADOR" y "REGISTRO AUTOMÁTICO"

---

### Altagracia Trading Suite + Collector de Northflank - 13 Noviembre 2026: Libro Completo También en la Nube y Collector sin Quedarse sin Memoria

**Pedido:** la grabación del libro corre solo con la suite abierta. El usuario no puede tenerla abierta todas las semanas que necesita la medición, y pidió llevarla a Northflank.

**Cambios:**
1. **Collector** (`5.Order_flow/cloud_collector`): graba todo el día el libro completo de sus monedas con el grabador de la suite (copias exactas de `book_recorder.py` y `book_store.py`).
   - Guarda 7 días (`BOOK_KEEP_DAYS`), unos 1.4 GB del volumen de 6 GB.
   - Si el volumen queda con menos de 150 MB libres, borra los días más viejos del libro, nunca los trades ni los footprints.
   - Rutas `/api/book/days` y `/api/book/{símbolo}/{día}/{tipo}`; `/health` dice el espacio libre.
2. **Suite** (`book_cloud.py`): cada 10 minutos baja de la nube solo los minutos que el PC no tiene completos, a `OrderFlowData/live/book_cloud`. El journal y la medición de semanas leen las dos carpetas sin repetir minutos.
3. **Monedas cerradas:** una moneda que Bybit no da como "Trading" (TONUSDT) no se graba ni se reintenta.
4. **Memoria del collector:** Northflank lo había reiniciado 4 veces en un día por falta de memoria ("OOMKilled", 512 MB), y cada reinicio deja un hueco en los trades.
   - **Causa:** cada 5 minutos reescribía el día de trades de cada moneda con varias copias en memoria. BTC, con 2.7 millones de trades por la tarde, ocupaba 260 MB.
   - **Ahora:** `append_tape` suma los nuevos al final sin decodificar el día y ocupa 41 MB. El archivo queda byte a byte igual, y el Dockerfile suma `MALLOC_ARENA_MAX=2`.
5. **Pruebas:**
   - de la suite: `book_cloud_checks.py` (16) y `book_checks.py` (60);
   - del collector: `tape_append_checks.py` (13), byte a byte contra la unión de antes y con el día real de BTC.

   Las demás siguen igual. Las 4 que fallan en `tape_checks.py` ya fallaban antes: usan el 12/11 como día en curso.

**IMPORTANTE:**
- **Desplegado el 13/11** en Northflank (build `composed-eggnog-3952`), con la sesión del usuario en el navegador integrado. En los primeros 10 minutos:
  - 0 reinicios; 167 MB de memoria y 14% de la CPU del plan, menos que antes sin el libro (226 MB y 22%);
  - las 20 monedas del libro listas;
  - los trades guardados con el método nuevo se leen bien y empiezan igual que la copia del PC;
  - las descargas pasaron de 15-40 KB/s a unos 620 KB/s.
- La suite baja la nube desde que se abre con este código. En la del usuario, al abrirla tras 3.5 horas cerrada, bajó 3,540 minutos en 82 s. El libro quedó seguido, de la nube hasta las 18:39 y del PC desde las 18:40. Entre las 15:15 y las 15:42 del 13/11 no se grabó en ningún lado.
- La nube guarda 7 días: con el PC apagado más tiempo, lo más viejo se pierde. Con lo medido, bajar un día completo de las 20 monedas tarda unos 6 minutos.
- Un cambio al grabador se hace en la suite y se copia al collector, y de ahí a la rama `deploy` de `footprint-collector`.

**Ver:** `5.Order_flow/cloud_collector/DEPLOY_NORTHFLANK.md` sección "Libro completo de Bybit" y `12.AltagraciaTradingSuite/CLAUDE.md` sección "Libro completo", "Nube"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Libro Completo Grabado y Limit que se Llenan al Cruzar

**Pedido:** tras los informes del price ladder (`reports/` del worktree `price-ladder-orderflow`):
- corregir el llenado de las limit en App 1, y en la suite si pasaba lo mismo;
- empezar a grabar el libro completo;
- preparar la medición con semanas de datos, tus zonas contra zonas al azar;
- llevar medidas del libro al journal.

**Cambios:**
1. **App 1, llenado de las limit:** una limit se llena solo si el precio pasa más allá de su precio; antes bastaba con tocarlo, y los resultados con limit salían inflados. El stop de entrada, el SL y el TP siguen al tocar. Cada limit guarda su regla (`fillRule`) y el Observador la recibe; `localStorage.setItem('limit_fill_rule', 'touch')` vuelve a la anterior.
2. **Suite:** no simula llenados (sus limit las llena Bybit), así que ahí no había nada que corregir.
3. **Suite, grabación del libro** (`book_recorder.py`, `book_store.py`):
   - el libro completo de Bybit (`orderbook.full` y la foto REST) de las monedas de la suite;
   - cada segundo, cubos finos hasta ±0.8%; cada minuto, profundidad ponderada por tiempo y mínima hasta ±5%;
   - en `OrderFlowData/live/book`, con la hora de Bybit;
   - un proceso por carpeta, y `SUITE_BOOK=0` lo apaga;
   - rutas `/api/book/status` y `/api/book/depth/{símbolo}`.
4. **Journal:** nueve medidas del libro por trade, en el grupo "Libro" del detalle y en el informe de ganadoras contra perdedoras. Son la liquidez cerca del precio y en tu entrada, su persistencia, el retiro entre tu entrada y tu stop, y al llenarse, lo retirado y lo negociado en tu entrada.
5. **Medición de semanas** (`book_study.py`):
   - tus zonas: perfil del día anterior, FVG de 15m y 1h, y los niveles del journal;
   - contra zonas al azar, con un aguante de 1/2 ATR de 15m;
   - en cada visita, lo que había al acercarse y al llegar, y lo negociado.
6. **Pruebas:** `book_checks.py` de la suite (57); en App 1, `replay.test.mjs` (20), `journal.test.mjs` (45), `observer.test.mjs` (43) y `test_observer.py`. Las demás de la suite y de App 1 siguen pasando.

**IMPORTANTE:**
- **Arranque:** la grabación empieza al reiniciarse la suite con este código. Ocupa unos 200 MB por día con 20 monedas, unos 6 GB por mes.
- **Probado en vivo** 12 minutos, en una carpeta temporal, con las 20 monedas de fábrica:
  - ningún hueco;
  - el libro de BTC y el de ETH, idénticos a una foto nueva de Bybit (16,413 y 7,943 niveles);
  - 4% de un núcleo.
- **Semanas:** la medición necesita semanas de libro; antes no distingue nada del azar.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Libro completo" y `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ÓRDENES"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Dashboard del Journal con el Estilo Elegido

**Pedido:** llevar al journal de la suite lo que tiene App 1 como dashboard (gráficos de trades, P&L, etc.), con los widgets en el estilo elegido por el usuario.

**Cambios:**
1. **Bot > Journal > "Dashboard"**, junto a "Trades". Son los widgets del dashboard de App 1, importados sin copiarlos, con los trades reales del bot:
   - **Equity Curve:** P&L neto acumulado o R acumulado. Es dinero real, sin saldo inicial: no hay %;
   - **Profit/Loss por Trade:** en dólares, en % a favor o en R;
   - **Win Rate** y **Profit Factor**;
   - **Riesgo y Recompensa:** mayor caída y mejor racha, en dólares y en R;
   - **Trades Detallados:** con moneda, origen y R, y selección que cambia los gráficos.

   Suma filtros por moneda, origen y cuenta. Los días y "Pedir cierres a Bybit" valen para las dos vistas.
2. **Estilo:** gráficos, medidores, tarjetas y tabla toman los colores y la letra del estilo elegido (Nítido, Oscuro, Personalizado o Muhammad), y cambian al instante al elegir otro. Con el Clásico se ve como el de App 1.
3. **App 1:** sus widgets suman opciones que App 1 no pasa (`themed`, modo R, pie, columnas y formatos), así que su dashboard no cambia. Lo nuevo:
   - `dashboardPalette.js`, con los colores de los widgets;
   - `readableOn()` en `uiTheme.js`, para un color legible como texto sobre un fondo.
4. **Paquetes:** la página de la suite suma `chart.js`, `react-chartjs-2` y `react-gauge-chart`, y además `prop-types` y `lodash`, que `react-gauge-chart` usa sin declararlos. La app de escritorio instala los paquetes cuando cambia `web/package.json`.
5. **Pruebas:** `12.AltagraciaTradingSuite/web/tests/journalStats.test.mjs` (9). Las de App 1 siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla y arma la página nueva. Los paquetes ya quedaron instalados en la copia principal.
- No trae "Exportar a Excel": el de App 1 depende de su simulación.
- "Reason" (TP, SL o Manual) se deduce de los precios: Bybit no dice qué orden cerró la posición.
- Probado en la copia aislada con 33 trades de prueba en el journal real del bot (bot falso). Los números coincidieron con un cálculo aparte:
  - P&L +40.99 y 21.24 R;
  - acierto 63.6% y Profit Factor 1.33;
  - mayor caída $5.66 y mejor racha $12.59.

  Se probaron los filtros, la selección, los modos y los estilos Nítido, Oscuro, Muhammad y Clásico, también cambiando en vivo. No se probó con trades reales ni en Electron.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal", "Dashboard"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Pestañas con los Indicadores del Gráfico Principal y VWAP que no se Detenía

**Pedido:** al abrir una moneda desde la Watchlist, el gráfico salía con indicadores livianos y no con los del gráfico principal.

**Causa:** según el registro del servidor de esa sesión, el gráfico de la ventana principal sí cargaba todo: VWAP, Elementos OF, Order Flow y Liquidaciones. ETH se abrió en una pestaña de la 2 a la 5 con solo Order Flow y Liquidaciones. Cada pestaña tenía sus propios indicadores, y una nueva empezaba con los de fábrica.

**Cambios:**
1. **Pestañas 2 a 5:** usan los indicadores de la pestaña 1 y los siguen al instante, hasta que se cambie uno en ellas. Desde ahí tienen los suyos; "Usar los de la pestaña 1", en la lista, las vuelve a sincronizar. Lo guardado antes en una pestaña pasa a seguir a la 1.
2. **VWAP (App 1):** al cambiar de moneda, el VWAP de la anterior seguía pidiendo sus datos cada 30 s, en los cinco marcos, hasta cerrar la página. En la sesión del usuario, XRP se pidió 117 veces. Ahora `IndicatorManager.destroy()` lo detiene con `dispose()`, y un pedido que llega después ya no lo vuelve a arrancar. En reproducción no cambia nada.
3. **Pruebas:** `leaks.test.mjs` de App 1 suma una (43); detecta los dos fallos del VWAP.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- Una pestaña configurada a propósito con otros indicadores ahora sigue a la 1: cambiar uno en ella le devuelve los suyos.
- Probado en la copia aislada:
  - una pestaña 4 guardada con Order Flow y Liquidaciones abrió ETH desde su Watchlist con los de la 1 (VWAP, Elementos OF, Order Flow y Delta) en los cinco marcos;
  - CVD encendido en la 1 llegó a la 4; al encender FVG en la 4, esta conservó sus indicadores aunque la 1 cambiara, y "Usar los de la pestaña 1" la volvió a sincronizar;
  - tras pasar de BTC a ETH, ningún pedido del VWAP de BTC en 40 s.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Pedidos tras probar la Watchlist (13/11)", "Indicadores de las pestañas"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Watchlist que se Mueve, Pestañas y los Mismos Indicadores en Todos los Marcos

**Pedido:** tras probar la Watchlist, el usuario pidió seis cosas:
1. mover y acercar sus gráficos, con la compresión de velas de App 1;
2. agregar monedas sin salir de la Watchlist;
3. abrir otras pestañas con la Watchlist, el journal o el bot y, si se podía, hasta 5 monedas con su gráfico completo;
4. que una moneda abierta desde la Watchlist llegue con todos los indicadores, también los pesados;
5. los mismos indicadores en todos los marcos, y elegir si todas las monedas los comparten o cada una tiene los suyos;
6. ocultar el panel lateral de la Watchlist.

**Cambios:**
1. **Gráficos de la Watchlist:** se arrastran y se acercan o alejan con la rueda, como en App 1; →| vuelve a la última vela. Son solo para mirar:
   - los dibujos se ven y llegan al instante si cambian en el gráfico principal, pero no se mueven;
   - no hay divisores de altura ni menú de niveles.

   Un clic en el nombre abre la moneda en el gráfico principal. App 1 suma `viewOnly` a `MiniChart`; sin él, todo sigue igual.
2. **"+ Moneda"** en la barra de la Watchlist. La moneda aparece al instante en la Watchlist, en el gráfico y en las otras pestañas.
3. **Menú "Pestañas":** abre de la 2 a la 5 (en Electron, ventanas) con el gráfico, la Watchlist, el journal o el bot.
   - Cada una tiene su moneda, sus marcos y sus indicadores; los dibujos son los mismos.
   - Varias con el gráfico dan varias monedas con su gráfico completo a la vez.
   - Solo la 1 toma las imágenes del journal y da los avisos de Windows.
   - En Electron cada una es una ventana con su propio hilo. Abierta por la página, compartía el de la principal: 1.5 s ocupados en la 2 la detuvieron 1505 ms. Ahora la crea `desktop/main.cjs`.
   - "Nueva ventana" de la bandeja abre la primera libre: antes abría otra pestaña 1, que repetía las imágenes y los avisos.
4. **Indicadores:** un solo conjunto para los cinco marcos. La lista elige "Los mismos en todas las monedas" o "Propios de cada moneda"; una moneda sin los suyos usa los comunes. Lo guardado antes toma los del marco que estaba a la vista. Una moneda abierta desde la Watchlist llega con ese conjunto completo.
5. **Panel del Swing:** "Ocultar ›" en su encabezado, y el botón "Panel del Swing" lo vuelve a abrir.
6. **App 1:** `installOwnSettings` acepta otro prefijo: las pestañas 3 a 5 usan `suite_p<n>:`. `secondarystorage.test.mjs` suma una prueba (7).

**IMPORTANTE:**
- La suite se reinicia sola al abrirla. En App 1 nada cambia a la vista.
- Sobre un gráfico de la Watchlist la rueda acerca y aleja: la cuadrícula se desplaza con su barra o con la rueda sobre los nombres. Ctrl + rueda cambia la escala de precios.
- Probado en la copia aislada con velas reales de Bybit:
  - zoom y arrastre en las celdas, sin abrir el gráfico principal;
  - un dibujo hecho en el gráfico principal llegó a la celda, y arrastrar sobre él en la celda movió las velas sin tocarlo;
  - LTCUSDT agregada desde la Watchlist, el panel oculto y vuelto a abrir;
  - CVD encendido en 15m quedó en los cinco marcos, y con "Propios de cada moneda" ETH tuvo FVG mientras BTC seguía con los comunes;
  - las pestañas 2, 3 y 4 abiertas con la Watchlist, el gráfico y el journal, cada una con sus ajustes;
  - SOL abierta desde la Watchlist llegó en 15m con Delta de volumen y Order Flow.
- En Electron, con la app real cerrada, se probó una copia con perfil propio:
  - cinco monedas a la vez, cada una en su ventana con 8 indicadores, se dibujaron en vivo;
  - la principal se retrasó a lo sumo 22 ms;
  - la app entera ocupó 1.1 GB, unos 140-150 MB por cada ventana de gráfico.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Pedidos tras probar la Watchlist (13/11)"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: Vista Watchlist (paso 5, parte C)

**Pedido:** la parte C del paso 5: la vista Watchlist con todas las monedas. El usuario pidió no pausar los gráficos que no se ven y redibujarlos cada 30 s, y medir si eso pone lenta la app; solo en ese caso, un límite de 10 gráficos en vivo elegidos por él.

**Cambios:**
1. **Módulo Watchlist:** todas las monedas de la suite en una cuadrícula con el gráfico de App 1 en vivo:
   - marco y días comunes, de 1 a 5 columnas y orden al arrastrar;
   - precio y cambio de 24 h en cada celda;
   - un clic abre la moneda en el gráfico principal.
2. **Indicadores livianos, para todas a la vez:** Swing del servidor (por omisión), Delta de volumen, CVD, FVG, S&R v2, Perfil de volumen y Volumen de Respuesta. Los pesados quedan en el gráfico principal.
3. **Nada se pausa:** los gráficos a la vista se dibujan a lo sumo cada 0.5 s y los que no se ven cada 30 s, con las velas siempre al día. App 1 suma `liveRedrawMs` a `MiniChart` (`redrawPacer.js`); sin él dibuja como siempre.
4. **Panel del Swing del servidor:** encenderlo o apagarlo, su marco, las monedas que vigila y las últimas señales. No envía alertas.
5. **Bybit:** el servidor deja pasar a lo sumo 10 pedidos por segundo y reintenta con "Too many visits". Las monedas de la cuadrícula se arman de a una.
6. **Pruebas:** `swing_checks.py` de la suite (102) y `redrawPacer.test.mjs` de App 1 (5). Las demás siguen pasando. En `run_checks.py`, dos comprobaciones del interés abierto comparaban con la hora del inicio de las pruebas y fallaban a veces: ahora usan la hora de la comprobación.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- Medido en la copia aislada con 21 monedas:
  - un dibujo de la cuadrícula cuesta 0.4 ms, contra 2.1 ms del gráfico principal;
  - con el ritmo, la cuadrícula ocupa cerca del 1% de cada segundo;
  - la memoria pasó de 28 a 34 MB.

  El límite de 10 gráficos no hizo falta. La fluidez en vivo no se pudo ver, porque el navegador de pruebas corría en segundo plano, y en Electron no se probó.
- Probado en la copia aislada con velas reales de Bybit: las flechas de las 21 monedas iguales a las del servidor, el clic al gráfico principal, el orden, las columnas, los indicadores y el panel.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Watchlist"

---

### Altagracia Trading Suite + App 1 - 13 Noviembre 2026: El Gráfico Muestra el Swing del Servidor (paso 5, parte B)

**Pedido:** seguir con la parte B del paso 5: que el indicador del gráfico muestre lo mismo que detecta el servidor, y arreglar el rectángulo que no guardaba su nuevo tamaño.

**Cambios:**
1. **Señales del servidor:** el indicador Swing de cada marco dibuja las que calcula el servidor, solo con velas cerradas. En el marco que el servidor vigila (1m) son las mismas que anota en vivo; en los otros, solo para ver. Las pide al cerrar cada vela y al cambiar las reglas, los dibujos o los VP Fixed.
2. **Configuración:** el modal del Swing guarda las reglas en el servidor para la moneda. El tamaño de las flechas se guarda en la pestaña.
3. **Servidor:**
   - cada actualización pide a Bybit solo las últimas 200 velas;
   - una vela cuenta como cerrada 4 s después de su cierre;
   - los ajustes de una moneda se suman a los que tenía.
4. **App 1:** el indicador Swing acepta señales de afuera (`setExternalSignals`); en reproducción no cambia nada. Un rectángulo cambiado de tamaño ahora se guarda con su tamaño nuevo: antes volvía al anterior al recargar o pasar a otro marco.
5. **Pruebas:** `swing_checks.py` de la suite (97), y `swing.test.mjs` (6) y `rectangle.test.mjs` (4) de App 1. Las demás de la suite y de App 1 siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- La flecha nueva aparece de 5 a 10 s después del cierre de la vela.
- Probado en la copia aislada con velas reales de Bybit: en 1m y 15m el gráfico y el servidor dieron las mismas señales, también al cambiar las reglas, encender el filtro VWAP y dibujar un rectángulo.
- Con recargas seguidas, Bybit llegó a rechazar pedidos de velas por exceso; la primera carga del Swing usa la caché del gráfico para no sumar pedidos.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Swing del servidor"

---

### Altagracia Trading Suite + App 1 - 12 Noviembre 2026: Swing en el Servidor (paso 5, parte A)

**Pedido:** del plan del paso 5, el usuario autorizó que el servidor detecte el Swing. Sus alertas no se usarán por ahora: irán a una central de alertas de confluencia. También aprobó que el gráfico muestre lo que detecta el servidor (B) y la vista Watchlist sin pausar los gráficos que no se ven (C).

**Cambios:**
1. **Reglas:** `server/swing_rules.py` es la regla del indicador Swing de App 1, la que se ve en el gráfico. Las pruebas corren el indicador de App 1 en node: en 15 casos dan las mismas señales, con el z-score idéntico.
2. **Detección:** 4 s después del cierre de cada vela, `server/swing_watch.py` pide las últimas velas a Bybit y anota las señales confirmadas. La vela en curso no cuenta. Un corte o una pausa del PC se recuperan con su demora, y un solo proceso detecta por carpeta.
3. **Nada se envía:** ni al bot ni a otro lado. Lo detectado queda en `data/swing/signals`, un archivo por día.
4. **Configuración:** la primera vez se toma del Swing de la Watchlist (1m, 11 monedas). Se cambia con `/api/swing/config`, que valida cada campo.
5. **Rutas** `/api/swing/*`: estado, configuración, señales para el gráfico, registro y rectángulos de un VP Fixed.
6. **App 1:** una vela que es swing alto y bajo a la vez tomaba el mínimo como precio de su swing alto. Ahora toma el máximo, el de su flecha.
7. **Pruebas:** `swing_checks.py` de la suite (84). Las otras de la suite y las 27 de App 1 siguen pasando.

**IMPORTANTE:**
- La suite se reinicia sola al abrirla.
- Con la configuración de la Watchlist salen los mismos swings que en ella. La Watchlist da el cierre como precio y la suite el máximo o el mínimo.
- Probado en la copia aislada, en 1m con las 11 monedas de la Watchlist y velas reales de Bybit (solo lectura). En 7 minutos anotó 19 señales, las mismas que da la regla con esas velas, entre 4.0 y 5.7 s después del cierre que las confirma. Reiniciada, no repitió nada. Con las monedas pedidas a la vez, cada vuelta tarda 1 s y anota a unos 4.7 s del cierre. El filtro VWAP se probó con velas simuladas: en la configuración de la Watchlist está apagado.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Swing del servidor"

---

### Altagracia Trading Suite + App 1 - 12 Noviembre 2026: "Al TP" y "Al SL" en el Journal y Caja con el SL y TP Movidos

**Pedido:**
- dos columnas en el journal con el % que le falta a cada trade para llegar al TP y al SL;
- al probar con ARB, el usuario movió el TP y el SL, y la imagen de cierre dibujó la caja con los valores iniciales.

**Cambios:**
1. **Columnas "Al TP" y "Al SL":** para los trades abiertos, cuánto debe moverse el precio marca, en % del precio, para tocar el TP o el SL vigentes. Negativo si ya lo pasó; "sin TP" o "sin SL" si no lo tiene.
2. **Caja de cierre:** lleva el SL y el TP vigentes al cerrar. Lo mismo la imagen "10 velas después" y "Ver en el gráfico" de un trade cerrado. Los iniciales siguen en "SL inicial" y en el R.
3. **App 1, caja TP/SL:** en monedas de menos de 10, sus precios llevan los decimales que hacen falta. Antes un SL de ARB en 0.14702 decía "0.15". Desde 10 sigue con 2.
4. **Pruebas:** `orders.test.mjs` de App 1 (34).

**IMPORTANTE:** la suite se reinicia sola al abrirla, o con "Reiniciar" en la bandeja. En App 1 basta recargar la página. Probado en la copia aislada con un bot falso, con un ARB al que se le movieron el SL y el TP.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal"

---

### Altagracia Trading Suite - 12 Noviembre 2026: Imagen 10 Velas Después del Cierre

**Pedido:** agregar, como en App 1, una imagen 10 velas después del cierre, para ver lo que hizo el precio después de salir.

**Cambios:**
1. **La imagen:** la de cierre (trade desde su apertura, con su caja y lo elegido) en el mismo marco, pero termina 10 velas después del cierre. En 15m son 2.5 horas. `captureScreenshot` de App 1 acepta `showUntil`; App 1 no lo usa.
2. **Programada:** al cerrar queda guardada en la página, así que se toma aunque la suite se cierre o se reinicie en ese tiempo. Las vencidas se toman fuera de la pantalla al abrir y cada 30 s. Una tomada tarde termina igual a las 10 velas.
3. **Journal:** contexto `after`, unido al trade como la de cierre. Se ve como "10 velas después" con la hora en que termina.
4. **Pruebas:** `journal_checks.py` de la suite (43).

**IMPORTANTE:** la suite se reinicia sola al abrirla, o con "Reiniciar" en la bandeja. Se descarta si venció hace más de 3 días. Probado en la copia aislada con un bot falso.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal", "10 velas después"

---

### Altagracia Trading Suite - 12 Noviembre 2026: Imagen de Cierre como en App 1

**Pedido:** que la imagen de cierre de un trade sea como la de App 1: el trade encuadrado desde su apertura, con su caja.

**Cambios:**
1. **Encuadre:** la imagen va desde la apertura del trade (del journal del bot) hasta la vela más reciente, con velas antes como contexto.
2. **Caja del trade:** entrada, SL y TP iniciales hasta el cierre, como la caja TP/SL de App 1. La escala la abarca completa.
3. **Lo elegido:** los niveles de su decisión, con sus números.
4. **Marco:** el que está a la vista si el trade cabe en 200 velas; si no, uno mayor, tomado fuera de la pantalla. Un trade de 3 días con la vista en 15m sale en 1h.
5. **App 1:** durante una imagen, la escala también abarca las cajas de `getTradeBoxes`. La principal de App 1 no pasa cajas, así que no cambia.

**IMPORTANTE:** la suite se reinicia sola al abrirla, o con "Reiniciar" en la bandeja. Sin el trade en el journal del bot, la imagen sale como antes. Probado en la copia aislada con un bot falso.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal", "Imagen de cierre como en App 1"

---

### App 1 + Altagracia Trading Suite - 12 Noviembre 2026: Números en App 1 e Imágenes de Monedas que no se Ven

**Pedido:**
- llevar a App 1 los números en lugar de las etiquetas de lo elegido;
- tomar las imágenes de apertura y cierre aunque la moneda no esté a la vista, sin invadir lo que se está mirando.

**Cambios:**
1. **App 1:** la principal y el 2.º gráfico muestran lo elegido con su número y su etiqueta al pasar el mouse. La lista del panel de trading lleva los mismos números. Las imágenes de las órdenes llevan solo las líneas: el visor del Observador les pone los números encima, los mismos.
2. **Suite:** cuando se abre o se cierra una posición de una moneda que no está a la vista, o con el gráfico oculto en el módulo del bot, se arma su gráfico fuera de la pantalla (`OffscreenCapture.jsx`) y se toma la imagen:
   - usa el marco a la vista, sus indicadores y las líneas de la posición;
   - tarda unos 10 s y toma una imagen a la vez;
   - no se abre ninguna ventana ni cambia la vista;
   - solo la pestaña 1 las toma, y un cambio de cuenta no cuenta.

**IMPORTANTE:** en App 1 basta recargar la página. La suite se reinicia sola al abrirla, o con "Reiniciar" en la bandeja. Lo de App 1 no se probó en su pantalla: usa el mismo dibujo probado en la suite, y sus pruebas pasan (`levels.test.mjs`, 54). Lo de la suite se probó en la copia aislada con un bot falso.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal" y `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REGISTRO AUTOMÁTICO"

---

### Altagracia Trading Suite + App 1 + TradingBot - 12 Noviembre 2026: Vela Repetida, "Solo Dato", Números y Lo Elegido que se Borraba

**Pedido:** al probar la suite con PAXGUSDT 15m, el usuario vio:
- la última vela dibujada dos veces;
- el VWAP sin opción de elegirse solo como dato, y pidió revisar los demás indicadores;
- las etiquetas de lo elegido muy encima del gráfico; pidió un número, como en las imágenes de App 1;
- lo elegido para la compra se borraba si se cambiaba algo en la orden, y no llegaba al análisis.

También pidió escribir todo en español.

**Cambios:**
1. **Vela repetida:** una recarga del histórico (cada 5 min) justo tras el cierre de una vela la dejaba entre las cerradas y además como vela en curso. `liveCandles.js` de App 1 (`mergeHistory`, `applyKline`, `withForming`) nunca repite una hora.
2. **"Solo dato":** todo nivel de cualquier indicador lo ofrece, en el menú y en las listas (`DATA_ONLY`). Queda como precio de referencia sin papel en el trade. Las marcas siguen con "Solo marca".
3. **Números:** en la suite cada elegido lleva un círculo pequeño con su número, sin tapar las últimas velas. La etiqueta sale al pasar el mouse. Los números son los mismos en:
   - la lista del panel;
   - la confirmación;
   - la imagen de la decisión;
   - el journal.

   App 1 siguió con etiquetas hasta la entrada siguiente, de la misma noche.
4. **Lo elegido no se pierde:**
   - sale de la lista solo si la orden queda en Bybit. Si el bot la rechaza, siguen lo elegido y la nota;
   - al cancelar una Limit sin llenar, lo elegido vuelve a la lista. App 1 hace lo mismo con una orden pendiente cancelada;
   - la decisión guarda la orden de Bybit y se une al trade que esa orden abrió, a cualquier hora.
5. **Bot:**
   - el journal guarda la orden que abrió cada trade, por su ejecución del WebSocket;
   - una Limit del panel llenada horas después y una orden a mercado ya no quedan "externa";
   - el historial y `/api/trade/manual` dan `order_id`.
6. **Pruebas:**
   - App 1: `liveCandles.test.mjs` (9) y `levels.test.mjs` (54); `test_patterns.py` suma una;
   - suite: `journal_checks.py` (39);
   - bot: `journal_checks.py` (29).

**IMPORTANTE:**
- Reiniciar el bot y la suite ("Reiniciar" en la bandeja). En App 1 basta recargar la página.
- Las órdenes del historial anteriores a este cambio no tienen número: sus trades se unen por hora, como antes.
- Una orden rechazada deja su imagen de decisión sin usar.
- Probado en la copia aislada con un bot falso y velas reales de Bybit. Nada se probó contra el bot real.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Correcciones tras la prueba del journal (12/11)", `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REGISTRO AUTOMÁTICO" y `10.TradingBotDesktop/CLAUDE.md` sección "Journal de trades reales"

---

### Altagracia Trading Suite - 12 Noviembre 2026: Journal con lo del Observador (paso 4, segunda parte)

**Pedido:** seguir con la parte del Observador del journal, con trades reales.

**Cambios** (con las piezas de App 1, sin copiarlas):
1. **Decisión:** al confirmar una orden en el panel se guardan:
   - la imagen del gráfico;
   - los niveles y marcas elegidos para el análisis, con su papel y nota;
   - la orden propuesta;
   - una nota opcional "Por qué entro".
2. **Apertura y cierre:** imágenes automáticas cuando se abre o se cierra una posición de la moneda a la vista.
3. **Medidas al decidir:** las 58 de App 1 (`measures.compute`) con velas de Bybit. También lo máximo a favor y en contra, en R.
4. **Informe:** qué distingue a las ganadoras de las perdedoras (`patterns.compare_groups`), con aviso de muestra pequeña.
5. **Ver en el gráfico:** la moneda del trade, la vista en su apertura y su caja con entrada, SL y TP.
6. **App 1:** `flow_columns()` salta los días del almacén fuera de las velas. El resultado es el mismo; antes una tabla corta leía los miles de días de BTC.
7. **Pruebas:** `server/tests/journal_checks.py` (28), y las de medidas y patrones de App 1 (96) siguen pasando.

**IMPORTANTE:**
- Reiniciar la suite ("Reiniciar" en la bandeja).
- De una moneda que no está a la vista no hay imagen de apertura ni cierre.
- Faltan la lectura de la regla del laboratorio, y el delta y el OI de los días recientes en las medidas.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal"

---

### Altagracia Trading Suite + TradingBot - 12 Noviembre 2026: Journal de Trades Reales (paso 4, primera parte)

**Pedido:** seguir con el journal del paso 4: el Observador de App 1 con trades reales.

**Cambios:**
1. **Bot** (`trading/trade_journal.py`, `journal/trades.jsonl` fuera de git):
   - **apertura:** la ve el WebSocket privado, con SL y TP iniciales y su origen (la orden del bot de esa moneda y lado en los 10 minutos anteriores: Swing, panel, etc.; "externa" si no la abrió el bot);
   - **cierres:** de Bybit (`closed-pnl`), con el resultado neto de comisiones: al arrancar los últimos 7 días, cada minuto, y al bajar o cerrarse una posición;
   - **R** sobre el riesgo del SL inicial;
   - **notas.**
2. **Suite**, Bot > "Journal":
   - resumen: acierto, P&L neto, R promedio y por origen;
   - trades abiertos con el P&L de Bybit y cerrados con salida, R y duración;
   - detalle con cierres parciales, cambios de SL/TP y notas.
3. **Pruebas:** `journal_checks.py` del bot (21) y `bot_checks.py` de la suite (56).

**IMPORTANTE:**
- Reiniciar el bot. Al arrancar trae los cierres de la última semana: los de antes quedan "sin apertura", y las posiciones ya abiertas, "anterior".
- Falta lo del Observador: medidas, imágenes de decisión, apertura y cierre, niveles elegidos, informe e ir al gráfico desde un trade.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Journal" y `10.TradingBotDesktop/CLAUDE.md` sección "Journal de trades reales"

---

### Altagracia Trading Suite + TradingBot - 12 Noviembre 2026: Posiciones en el Gráfico y Bot en Tiempo Real (paso 4)

**Pedido:** empezar el paso 4 de la integración (el journal con el bot endurecido). Se agregó al plan ver en el gráfico de cada moneda el estado y el P&L de las posiciones, como en TradingView, como parte del servicio del bot.

**Cambios:**
1. **Bot en tiempo real:** escucha la cuenta activa por el WebSocket privado de Bybit (posiciones, órdenes y ejecuciones), con una foto por REST al conectar, cada 60 s y cada 5 s si el WebSocket no conecta. `/api/positions` sale de ahí: antes pedía 21 posiciones a Bybit en cada consulta.
2. **Acciones nuevas del bot:**
   - cerrar una posición a mercado (también en pausa);
   - mover el SL o el TP: el SL nunca se quita y va al tick hacia el precio;
   - cancelar una orden de entrada pendiente.
   
   Cada una toma el candado de su moneda y valida contra el precio de Bybit.
3. **Posiciones sin stop:** aviso crítico al arrancar, al cambiar de cuenta, o si una posición sigue 20 s sin SL. Solo avisa, no toca nada.
4. **Guardado seguro:** los archivos de estado del bot se escriben con temporal y reemplazo.
5. **Gráfico** (`positionLines.js` de App 1, usado por la suite):
   - entrada con tamaño y P&L en vivo, SL y TP con lo que se perdería o ganaría, liquidación y órdenes pendientes;
   - × cierra o cancela; las etiquetas de SL y TP se arrastran para moverlos o ponerlos;
   - todo pide confirmación con el precio llevado al tick y el P&L ahí.
6. **Panel de trading:** la pestaña Posición tiene los mismos botones. La suite da avisos de Windows de alertas críticas, pausa y posiciones abiertas o cerradas.
7. **Tras la primera prueba del usuario (12/11):** su short de BTC tenía entrada, SL y TP lejos de las velas a la vista. Las etiquetas quedaban en el borde sin decir su precio y los botones del gráfico las tapaban. Ahora:
   - dicen su precio real ("@ 79261.4") y van bajo los botones;
   - ⇕ ajusta la escala para ver las líneas hasta el eje;
   - el % es el ROI como en Bybit.
   
   Los valores eran correctos: +23.18 USD contra +23.07 de Bybit, que usa el precio marca.
8. **Pruebas:**
   - `3.TradingBot_Python/backend/tests/positions_checks.py` (38), con un WebSocket falso local que comprueba la firma;
   - `bot_checks.py` de la suite (52);
   - `tests/positions.test.mjs` de App 1 (13).

**IMPORTANTE:**
- Reiniciar el bot (puerto 5000). La suite se reinicia sola al abrirla.
- Nada se probó contra Bybit real: conviene probar primero el WebSocket y las acciones con una cuenta Demo.
- Falta el journal del paso 4.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Posiciones en el gráfico" y `10.TradingBotDesktop/CLAUDE.md` sección "Cuenta en tiempo real y posiciones desde la suite"

---

### Altagracia Trading Suite + TradingBot - 12 Noviembre 2026: Varias Cuentas de Bybit

**Pedido:** agregar otras claves de Bybit, para trading real o de otras cuentas, y manejarlas todas desde la suite. El usuario eligió una cuenta activa a la vez.

**Cambios:**
1. **Bot** (`3.TradingBot_Python`):
   - cuentas con nombre en `config/accounts.json`, fuera de git;
   - rutas `/api/accounts` para listar, agregar, activar, renombrar, borrar y leer el saldo y las posiciones de cada cuenta;
   - la primera vez, la clave de `credentials.json` pasa a ser la "Cuenta principal".
   
   `credentials.json` sigue siendo la clave activa, así App 10 funciona igual.
2. **Cambio seguro:** con una orden ejecutándose, el cambio responde 409. Mientras cambia, ninguna orden empieza, así una orden nunca revisa en una cuenta y envía por otra. Vale también para las claves puestas desde App 10.
3. **Suite:** "Cuentas de Bybit" en Bot > "Configuración y riesgo":
   - patrimonio, disponible y posiciones de cada cuenta;
   - "Usar esta…", renombrar, borrar y agregar;
   - cada acción pide confirmación y una palabra en el servidor (`CAMBIAR_CUENTA`, `CAMBIAR_CLAVES`).
4. **Cuenta a la vista:** el panel de trading, su confirmación y el módulo del bot dicen la cuenta activa.
5. **Pruebas:** `3.TradingBot_Python/backend/tests/accounts_checks.py` (31) y `bot_checks.py` de la suite (42).

**IMPORTANTE:**
- Reiniciar el bot (puerto 5000) para que cargue las cuentas. La suite se reinicia sola al abrirla.
- La configuración por moneda, el riesgo diario, la pausa y los orígenes son del bot y valen para la cuenta activa.
- Las posiciones de la cuenta anterior quedan en Bybit con su SL y TP, pero el bot deja de vigilarlas.
- Probado con un bot falso y un Bybit simulado. Nada se probó contra Bybit real.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Cuentas de Bybit" y `10.TradingBotDesktop/CLAUDE.md` sección "Cuentas de Bybit"

---

### Altagracia Trading Suite (carpeta 12) - 12 Noviembre 2026: Correcciones tras la Primera Prueba

**Pedido:** al probar la suite, el usuario vio:
- sin footprints en 1m;
- un footprint de 15m más bajo que su vela;
- dibujos que no se borraban;
- Elementos OF vacíos;
- velas de otro tiempo al final del gráfico.

También pidió ver los íconos posibles para la app.

**Causas y cambios:**
1. **Footprints:** el armado de cada minuto esperaba la descarga de la nube, que se colgaba y pasaba de 600 s. Ahora la nube se baja aparte (`sync_nube.py --solo-nube`) y el armado de cada minuto nunca la espera.
2. **Nube:** el collector guardaba sus footprints releyendo el día entero dentro de su bucle y se trababa hasta 30 s, así que las descargas se quedaban a mitad. Ahora guarda en un hilo y por líneas, sin releer el día (rama `deploy` baad6bc, desplegado el 12/11 como build `abrupt-horn-9829`). Las descargas llegan completas, aunque lentas: BTC tarda de 48 a 93 s.
3. **Velas de otro marco:** `MiniChart` no reconocía "1m", "1h" ni "4h", y los cinco gráficos pedían velas de 15m por un WebSocket de un solo marco. Ahora hay un WebSocket por moneda y marco, y se descartan las velas ajenas.
4. **Dibujos:** los cinco gráficos respondían a Suprimir y los ocultos guardaban su lista vieja. Ahora solo responde el gráfico a la vista.
5. **Footprint parcial:** la grabación empezó a mitad de la vela y la nube no llegaba. Esas velas llevan "parcial".
6. **Elementos OF:** estaban vacíos por lo mismo, sin datos de esas horas. Los días oficiales del 05 al 11/11 de BTC ya se bajaron solos.
7. **Velas de Bybit:** el servidor reintenta tres veces en vez de dar error 500.
8. **App 1:** los botones 1D, 3D y 1W ahora muestran ese tiempo en 1m, 5m, 1h y 4h. Antes calculaban con velas de 15m.
9. **Después (12/11 en la tarde):**
   - **Footprints que llegan solos:** el servidor dice hasta qué minuto llega el almacén, y el gráfico vuelve a pedir lo que falta.
   - **Step parejo:** sale del rango típico de las velas, unos 10 niveles. En BTC 15m da 20, como la App 1 del usuario.
   - **Reabrir la app:** se reinicia sola si el código cambió. La X solo la ocultaba en la bandeja y seguía corriendo la versión vieja.
   - **Bandeja:** "Reiniciar" y "Registro del servidor".
   - **Nube en el PC:** `sync_nube.py` baja con httpx. Con `urllib`, el proxy de Northflank cortaba a mitad las descargas de BTC y ETH.

**IMPORTANTE:**
- Cerrar la suite desde la bandeja ("Salir") y abrirla de nuevo.
- Lo anterior a la apertura de la app llega de la nube en la siguiente bajada (cada 15 minutos).
- **Ícono:** el perfil de volumen azul y oro con fondo blanco (`desktop/make_icon.py`), elegido por el usuario.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md` sección "Correcciones tras la primera prueba del usuario"

---

### Altagracia Trading Suite (carpeta 12) - 12 Noviembre 2026: Segunda Ronda tras Probarla

**Pedido:** el usuario probó la suite y pidió ocho cosas:
1. Electron, para que no se congele ni pierda datos o alertas.
2. Los indicadores que faltaban, sobre todo Elementos OF.
3. Que se dibujen los footprints.
4. Las opciones del bot original.
5. El formato de la pestaña principal de App 1, con la herramienta de dibujo.
6. Agregar monedas.
7. Dos pestañas con sus propios indicadores y los mismos dibujos.
8. El panel de trading.

**Cambios:**
1. **Electron** (`desktop/`, `INICIAR_DESKTOP.bat`):
   - sin freno en segundo plano;
   - bandeja del sistema y una sola instancia;
   - lanza el servidor si no corre y lo relanza si se cae;
   - vuelve a armar la página si cambió el código.
2. **Footprints:** no se veían porque el 11000 no corría y el almacén oficial de BTC llegaba al 04/11.
   - La suite graba sola los trades de sus monedas con `local_tape.py`. Un candado deja grabar a un solo proceso, ella o el 11000.
   - Baja cada 6 horas los días oficiales que faltan, con las herramientas del panel.
3. **Indicadores:** los 18 de App 1, con rutas nuevas en el servidor (`market_routes.py`): Interés abierto, VWAP, S&R, patrones, Elementos OF y setups en vivo. `of_elements.py` de App 1 acepta `live`.
4. **Formato:** el de la pestaña principal: barra de dibujo, marcos en el encabezado, un gráfico por marco y el panel a la derecha. "+" agrega monedas.
5. **Dos pestañas:**
   - "2.ª pestaña" tiene sus propios marcos, indicadores y ajustes;
   - los dibujos son por moneda y pasan al instante a los otros marcos y a la otra pestaña.
6. **Panel de trading:**
   - toma la caja TP/SL;
   - tamaño fijo o por riesgo, y tipo Market o Limit automático;
   - siempre con stop y objetivo, y con confirmación;
   - va al bot por `/api/bot/trade` con `ENVIAR_ORDEN_REAL`.
7. **Bot:** "Configuración y riesgo" como App 10:
   - cada moneda con riesgo, SL, TP, dirección y precisión, y agregar monedas con apalancamiento;
   - riesgo diario y método de ejecución;
   - orígenes de alertas y claves de Bybit.
   
   Cada cambio pide confirmación y una palabra en el servidor.
8. **App 1, solo para el modo en vivo:** Interés abierto vuelve a pedir al abrir una vela nueva, y `MiniChart` avisa los dibujos guardados. La reproducción no cambia.
9. **`sync_nube.py`:** guardaba una descarga de la nube cortada a mitad, y el día ya no se podía unir. Ahora la rechaza, y si un archivo es ilegible une el día con lo del PC y lo vuelve a bajar.
10. **Pruebas:**
    - `server/tests/run_checks.py` (41) y `bot_checks.py` (33);
    - `test_of_elements_live.py` (10) en App 1;
    - `sync_checks.py`, que sube a 24.

**IMPORTANTE:**
- Se abre con `12.AltagraciaTradingSuite/INICIAR_DESKTOP.bat`. El bot debe correr para el panel y la configuración.
- Probado en una copia aislada que grabó de verdad, con un bot falso. Nada se probó contra el bot real, con claves reales ni con el 11000 grabando a la vez.
- El bot no tiene rutas para cerrar posiciones, mover el stop ni cambiar el apalancamiento después de agregar la moneda.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md`

---

### Altagracia Trading Suite (carpeta 12) - 12 Noviembre 2026: Cáscara, Bot y Gráfico en Vivo (pasos 1 y 3)

**Pedido:** crear la carpeta nueva y hacer los pasos 1 y 3 del plan local: la cáscara con los estilos de App 1, el bot como primer módulo y el gráfico de App 1 en vivo con el almacén de order flow.

**Cambios:**
1. **Servidor** (`12.AltagraciaTradingSuite/server`, 127.0.0.1:13000):
   - velas de Bybit, y footprints, perfil real y liquidaciones con los lectores de App 1 importados;
   - footprints con `live=True`: días oficiales y, donde faltan, nube + PC;
   - dibujos por moneda;
   - el bot leído y pausado por su API.

   Configuración en `config/suite.json` y variables `SUITE_*`. Rechaza Host u Origin ajenos
2. **Página** (`web`): el `MiniChart`, los indicadores, los modales y el modal "Estilo" son los de App 1, importados sin copiar. Un plugin de Vite cambia su `config.js` por el de la suite. Trae módulos Gráfico y Bot, y una barra de estado con el almacén, la grabación del 11000 y el bot
3. **Bot:** estado, pausa con confirmación (en la página y con `CAMBIAR_PAUSA` en el servidor), avisos críticos, posiciones, órdenes y alertas
4. **App 1:** en el modo en vivo de `MiniChart`, la escala sigue las velas a la vista. Antes las aplastaba con 30 días de historia. La reproducción de App 1 no cambia
5. **Pruebas:** `server/tests/run_checks.py` (16)

**IMPORTANTE:**
- Se abre con `12.AltagraciaTradingSuite/INICIAR.bat`. Para footprints recientes debe correr el backend 11000, reiniciado para que grabe; para el módulo del bot, el bot.
- Indicadores en vivo: Volume Delta, Volume Profile, CVD, Order Flow, FVG, VP Periodic, Volumen de Respuesta, Liquidaciones y S&R v2. Faltan Interés abierto, VWAP, Elementos OF y los patrones.
- Probado en una copia aislada con un bot falso. No se probó contra el bot real.

**Ver:** `12.AltagraciaTradingSuite/CLAUDE.md`

---

### Backend de Order Flow (11000) - 12 Noviembre 2026: Últimas Horas Grabadas en el PC (fase 4, integración)

**Pedido:** que las últimas horas tengan la misma finura de App 1, grabadas en el PC.

**Cambios:**
1. **Grabador local:** `5.Order_flow/backend/local_tape.py` usa el grabador de la nube (`cloud_collector/tape_recorder.py`, sin copiarlo) con las monedas del Swing. Escribe en `OrderFlowData/live/local/tape` y guarda cada 60 s. Los huecos empiezan con el último mensaje recibido y terminan con el primer trade tras reconectar
2. **Unión nube + PC:** `PanelOrderFlow/sync_nube.py` une cada día por tramos cubiertos: manda la nube y el PC llena lo demás. Lo que ninguna cubre queda como hueco. Arma `live/store` y `live/flow` aparte y los reemplaza
3. **Automático:** el backend corre la unión cada minuto en un proceso aparte, para no frenar el Swing: 1.5 s por moneda. Baja la nube cada 15 minutos. Estado en `/api/orderflow/local-tape`
4. **Pruebas:** `PanelOrderFlow/tests/sync_checks.py` (21) y las 94 del backend

**IMPORTANTE:**
- Reiniciar el backend (11000) para que empiece a grabar. `LOCAL_TAPE=0` lo apaga.
- Probado en vivo con el WebSocket real, sin el resto del backend y con un corte simulado: las 50 velas de 1 minuto completas y sin hueco de BTC, ETH y XRP coincidieron con Bybit, y el corte de 3 s quedó como hueco.
- El minuto en curso no está en el almacén: llega hasta el último minuto guardado.

**Ver:** `PanelOrderFlow/LEEME.md` sección "Días recientes: nube y PC"

---

### Collector de Northflank - 12 Noviembre 2026: Trades en el Formato del Almacén de App 1 (fase 4, integración)

**Pedido:** primer paso de la integración: que el order flow en vivo sea igual al de App 1. Un solo almacén (el de App 1, desde los archivos diarios de Bybit), el collector de la nube para los días recientes que el almacén aún no tiene, y el backend local para las últimas horas.

**Cambios:**
1. **Collector:** además de los footprints de 1 minuto (App 9 los sigue usando), graba todos los trades en `.tape`, el mismo formato de `OrderFlowData/tools/ingest.py`. Un archivo por moneda y día UTC, con los huecos anotados (cortes y reinicios). Cada 5 min los trades nuevos se suman al archivo del disco: en memoria quedan solo esos minutos, porque el servicio tiene 512 MB. Rutas `/api/tape/days` y `/api/tape/{symbol}/{day}`
2. **`/health`:** ya no descomprime todos los archivos en cada consulta
3. **`PanelOrderFlow/sync_nube.py`:** baja esos días a `OrderFlowData/live/` y arma su almacén y su flujo con `build_store.py` y `build_flow.py` sin cambios. El día oficial siempre manda
4. **Pruebas:** `5.Order_flow/cloud_collector/tests/tape_checks.py` (22 sin conexión)
5. **Desplegado el 12/11:** Northflank construye desde otro repositorio, `albriciasgi-ai/footprint-collector`, rama `deploy` (commit 89543a2), no desde este. Construye solo al subir, pero el despliegue se hace a mano con "Deploy" en Builds. `MAX_DAYS=0` sigue siendo sin límite

**IMPORTANTE:**
- La nube graba trades desde el 12/11 a las 06:56 UTC, 01:56 en Colombia (20 monedas; TONUSDT está cerrada en Bybit). Ese día queda incompleto por empezar a mitad.
- Probado en el PC (12 de 12 minutos y 18 de 18 antes) y en la nube (12 de 12): iguales a las velas oficiales de Bybit en volumen y cierre; XRP pasa de celdas de 0.005 a 0.0001. Falta comparar un día completo de la nube contra el archivo oficial.
- Un cambio al collector hay que copiarlo también a la rama `deploy` de `footprint-collector`.
- **Lector (12/11):** `footprint_store.py` de App 1 lee `OrderFlowData/live/store` cuando falta el día oficial, solo con `live=True` o `ORDERFLOW_USE_LIVE=1`. Está apagado: App 1 sigue solo con días oficiales y lo encenderá la app en tiempo real, que usará este lector. Sus velas llevan `source: "live"`, `gap` si tocan un hueco y `complete: false` si pasan del último guardado de la nube. En el PC, las 19 velas de 1 minuto completas y sin hueco de BTC y ETH bajadas de la nube coincidieron con Bybit. Faltan los Elementos OF (`OrderFlowData/live/flow`) y un endpoint que lo pida.

**Ver:** `5.Order_flow/cloud_collector/DEPLOY_NORTHFLANK.md` sección "Trades en el formato del almacen de App 1" y `PanelOrderFlow/LEEME.md`

---

### APP 1 (Backtester) - 12 Noviembre 2026: Ajustes Propios del 2.º Gráfico

**Pedido:** el 2.º gráfico podía encender indicadores pero no cambiar sus ajustes, y usaba los de la principal.

**Cambios:**
1. **⚙️ por indicador** en la lista "Indicadores" del 2.º gráfico, con los mismos modales de la principal
2. **Ajustes aparte:** `secondaryStorage.js` guarda en esa pestaña las claves de ajustes con el prefijo `app1_g2:`. Mientras no se cambien ahí, usa los de la principal; cambiarlos no toca la principal
3. **Compartido a propósito:** lo elegido para el análisis, las velas fijadas, las recetas de los setups y el estilo

**IMPORTANTE:** basta recargar las dos pestañas: no hay cambios en el backend.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11", "Ajustes propios del 2.º gráfico"

---

### APP 7 (WatchlistDesktop) + Backend de App 2 - 11 Noviembre 2026: Pruebas y Correcciones, Fases 1 y 2

**Pedido:** probar App 7 como App 8 y App 9 antes de seguir con la integración, y corregir las fases 1 y 2 del diagnóstico.

**Cambios:**
1. **El gráfico solo lee:** App 7 ya no mueve el WebSocket del backend ni cambia el Swing al mirar otro timeframe o marcar "Swing Detector". En otro timeframe las flechas son `displayOnly`. El backend solo cambia timeframe, monedas o encendido del Swing con `confirm: "CAMBIAR_ALERTAS"`, y el Swing fija sus canales del WebSocket
2. **Modal del Swing:** como en App 9, con "Alertas al bot en Xm · el gráfico está en Ym" y botones con confirmación
3. **Backend del Swing:** servicio Swing, WebSocket con relleno tras cortes y servicio VWAP del backend de App 5, con origen `WATCHLIST`. Config ilegible: Swing sin alertas y copia del archivo
4. **Patrones apagados:** DTB, Rejection, `/api/pattern-alert` y `/api/rejection-patterns/detect` ya no mandan nada al bot. Solo opera el Swing
5. **Interruptor "Alertas":** estado desconocido si no lee, se refresca cada 15 s, solo maneja el Swing y exige `true` o `false`
6. **Pruebas al bot:** "Test 1x" y "Test 10x" piden confirmación y el backend `?confirm=ENVIAR_ALERTA_REAL`
7. **Protección:** Origin y Host como el bot, símbolos validados, dibujos con temporal y error 500 si el archivo está dañado; `START_PRODUCTION.bat` levanta la Watchlist solo en 127.0.0.1
8. **Gráficos:** WebSocket que se reconecta y recarga el histórico, timeframe y días en un paso, VWAP pedido una vez por moneda, pantalla completa que se limpia, carga vigente, vela en curso correcta (también la semanal) y dibujos que no se pisan
9. **Pruebas:** `2.WatchlistConIndicadores/backend/tests/run_checks.py` corre 114 pruebas sin conexión

**IMPORTANTE:**
- Reiniciar el backend (8000) y App 7.
- El Swing de la Watchlist tiene las alertas encendidas (15m, 10 monedas); hoy no opera porque el bot no permite el origen `WATCHLIST`.
- El `.venv` del backend 2 está roto (le falta `aiohttp`); el backend corre con el Python global.
- Probado en una copia aislada, en el navegador y con un bot falso. Nada se probó dentro de Electron ni contra el bot o Bybit reales. Queda la fase 3.

**Ver:** `7.WatchlistDesktop/CLAUDE.md` sección "Pruebas y Correcciones, Fases 1 y 2 (11 Noviembre 2026)"

---

### APP 1 (Backtester) - 12 Noviembre 2026: 2.º Gráfico Fluido

**Problema:** por encima de 1000x el 2.º gráfico avanzaba a saltos. Recibía la hora solo cuando cambiaba la pantalla de la principal, 8.5 veces por segundo, y a 10000x cada aviso traía 20 minutos: más de una vela de 15m por dibujo.

**Cambios:**
1. **Seguidor de la hora** (`replayFollower.js`): el 2.º gráfico avanza en cada cuadro de la pantalla, minuto a minuto, a la velocidad de la reproducción. Nunca muestra una hora posterior a la de la pantalla de la principal; va cerca de 0.1 s detrás y al pausar queda igual
2. **Paso de 1 minuto** en el reloj mientras el 2.º gráfico está a la vista (de a 5 si la fecha no tiene velas de 1 minuto). Al dejar de verlo, la principal vuelve a su paso y el reloj se realinea
3. **Ritmo según el costo del dibujo:** con muchos indicadores o miles de velas a la vista avanza cada varios cuadros
4. **Una sola principal:** con dos pestañas principales abiertas sigue una, y cambia si esa se cierra o queda en pausa mientras la otra reproduce
5. **Medición a pedido:** `?grafico=2&medir=1` muestra horas recibidas y dibujadas por segundo

**IMPORTANTE:** basta recargar las dos pestañas: no hay cambios en el backend. Medido con cuadros reales, principal en 1h y segundo en 15m: a 10000x pasó de 8.5 dibujos por segundo con 20 minutos cada uno a 59 con 3 minutos. Con 16 indicadores queda en unos 32 por segundo. Con el 2.º gráfico a la vista, la principal también forma sus velas minuto a minuto.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11", "2.º gráfico fluido"

---

### APP 9 (OrderFlowDesktop) - 11 Noviembre 2026: App 9 Reemplaza a App 8

**Pedido:** el usuario decidió dejar App 8 (Analizador Desktop) y operar desde App 9. Pidió traer de App 8 las órdenes limit y las correcciones del Swing, y después todo lo que faltaba para dejarla.

**Cambios:**
1. **Panel de trading:** tipo de orden Auto, Market o Limit, como en App 8. Auto usa Market si la entrada está a 0.1% o menos del precio; si no, Limit. Una Limit que cruza el precio y un SL o TP del lado equivocado bloquean el botón y dicen el motivo. En Market, cantidad y riesgo salen del precio actual
2. **Caja TP/SL:** el panel toma la caja tocada más recientemente (creada o movida, `updatedAt`), no la última creada. El doble clic para salir del modo dibujo ya no deja una caja suelta. Las etiquetas de la caja usan decimales según el precio
3. **Swing desde el gráfico:** el gráfico solo lee. Mirar otro timeframe, cambiar los días o abrir una moneda ya no cambia la config del Swing ni suma la moneda a las alertas. En otro timeframe las flechas se calculan aparte, solo para dibujar (`displayOnly`)
4. **Modal del Swing:** dice "Alertas al bot en Xm · el gráfico está en Ym" y trae botones para cambiar el timeframe de las alertas, usar los días del gráfico y agregar o quitar la moneda de las alertas, con confirmación
5. **Servicio Swing (backend de App 5):**
   - cooldown propio de cada moneda, guardado en `config/swing_cooldowns.json`;
   - señales con hueco, viejas o sin VWAP bloqueadas (`BLOCKED_GAP`, `BLOCKED_STALE`, `BLOCKED_NO_VWAP`);
   - un re-análisis a la vez y la detección histórica en un hilo;
   - config guardada con temporal y reemplazo, e intervalo inválido rechazado.
6. **Velas del backend:** tras un corte se rellenan en orden, y la vela en curso ya no se precarga como cerrada
7. **Servicio VWAP:** el de App 8. Cada moneda y timeframe tiene su estado, y el cálculo corre fuera del hilo principal. En 1m con 6,000 velas pasó de 12.7 s a 0.14 s, con los mismos valores (374,000 comparados, 0 diferencias). El filtro VWAP del Swing usa el VWAP de su propio timeframe
8. **Protección del backend:**
   - solo acepta páginas de este PC (Origin y Host, como el bot);
   - símbolos y nombres de archivo validados;
   - dibujos guardados con temporal y reemplazo, y un archivo ilegible responde error en vez de una lista vacía;
   - las alertas de prueba piden `?confirm=ENVIAR_ALERTA_REAL`, y `/api/clear-cache` ya no dispara una.
9. **Sin el Analizador:** App 9 ya no llama al puerto 10000
10. **Datos del usuario:** sus dibujos y la config del Swing del Analizador quedaron copiados en `5.Order_flow/backend` de su carpeta, con respaldo en `respaldo_2026-11-11_antes_de_dejar_app8`
11. **Pruebas:** `5.Order_flow/backend/tests/run_checks.py` corre 94 pruebas sin conexión

**IMPORTANTE:**
- Reiniciar el backend (11000) y App 9 para aplicar los cambios.
- El Swing de este backend envía con origen `ORDERFLOW`: el bot solo lo opera si ese origen está permitido en "Alert Origins".
- Conserva la espera de 120 s al arrancar, propia de este backend.
- El Swing de Order Flow quedó como el del Analizador: 15m, 90 días y 15 monedas. Dejó de vigilar AAVE, AVAX, INJ, KAS, LPT, SHIB1000, TON y UNI; se agregan desde el modal.
- Una página que use este backend tiene que venir de localhost o 127.0.0.1 (o `null` / `file://`). Los programas sin Origin, como el panel de descargas, siguen igual.
- De App 8 no se trajo el resto de su fase 2 (decimales del eje, Open Interest ordenado, zoom y escala de precios) ni lo que el usuario decidió dejar: Zonas V2, VP Zone Scanner, Strategy Builder en tiempo real, backtest de VP Periodic y Liquidation Clusters.
- Probado en una copia aislada, en el navegador y con un bot falso. Nada se probó dentro de Electron ni contra el bot o Bybit reales.

**Ver:** `9.OrderFlowDesktop/CLAUDE.md` sección "App 9 Reemplaza a App 8 (11 Noviembre 2026)"

---

### APP 1 (Backtester) - 11 Noviembre 2026: Panel de Trading Aparte, Cajas TP/SL y Velas que se Forman en el 2.º Gráfico

**Pedido:** después de probar el segundo gráfico, que avance fluido y no por saltos, que dibuje las cajas TP/SL de los trades, que la caja de texto cuadre con el estilo y que el panel de trading se pueda abrir aparte.

**Cambios:**
1. **Velas que se forman:** el reloj avanzaba con el paso del marco con que se creó (con 1h, de a 15 minutos). Ahora el segundo gráfico avisa su marco y el reloj toma el paso del más fino a la vista (`TimeController.setStepTimeframes()`). La velocidad no cambia
2. **Cajas TP/SL en el segundo gráfico:** con entrada, stop y objetivo de cada orden no cancelada, hasta su salida o la hora simulada
3. **Caja de texto:** con los estilos nuevos, fondo del gráfico, borde gris oscuro y texto del estilo. El Clásico sigue amarillo
4. **Panel de trading en ventana aparte:** botón ⧉ en su encabezado. La confirmación de orden y las imágenes del historial se abren en esa ventana; "Traerlo aquí" lo devuelve
5. **Sin saltos a velocidad alta (12/11):** al mirar el 2.º gráfico, la principal queda en segundo plano y el navegador frenaba su reloj a un paso por segundo (a 10000x, casi 3 horas por paso). Ahora el tick lo marca un Worker, que el navegador no frena
6. **Una sola principal:** con dos pestañas principales abiertas, el 2.º gráfico saltaba entre sus horas. Ahora sigue una, y pasa a otra solo si su hora avanza

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. Probado en una copia aislada; las ventanas se simularon con un marco, porque el panel de pruebas no abre ventanas emergentes.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11"

---

### APP 1 (Backtester) - 11 Noviembre 2026: Segundo Gráfico, Observador en Ventana Aparte y Mejoras

**Pedido:** seis mejoras después de probar la fase 4: más indicadores en el Observador, VP fijo de unos 400 niveles, el Observador en una ventana aparte, numeración de trades sin contar los cancelados, caja de texto en los dibujos y un segundo gráfico que siga la reproducción en otra pestaña.

**Cambios:**
1. **Segundo gráfico:** botón "2.º gráfico" en el encabezado. Abre otra pestaña que sigue la hora simulada de la principal (BroadcastChannel), con su propio marco e indicadores. Las velas salen del caché del navegador. Lo que se elige ahí para el análisis llega a la orden de la principal. No tiene reloj, órdenes ni los dibujos de la principal
2. **Observador en ventana aparte:** botón "Ventana aparte". Comparte los datos con la principal; el informe y el visor de imágenes se abren en ella
3. **Más para "Incluir en el análisis":** línea y bandas del VWAP, barras de volumen y la columna de cada vela en Delta de volumen, CVD, Interés abierto, Confluencia OI y volumen y Volumen de Respuesta
4. **Caja de texto:** botón "Texto" en la barra de dibujo; se escribe al crearla, doble clic la edita. Antes la caja existía en el código pero no tenía botón ni forma de escribir, y seleccionarla daba error
5. **Números de trade:** se asignan al ejecutarse la orden, así una cancelada no gasta número. Las sesiones viejas se numeran al cargarlas
6. **VP de rango fijo:** 400 niveles (antes 50), con el modal de 50 a 1000

**IMPORTANTE:** reiniciar el backend de App 1 (el registro guarda el número de trade) y recargar la página. El navegador debe permitir ventanas emergentes para la ventana del Observador. El segundo gráfico ocupa otra vez la memoria de las velas.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "SEGUNDO GRÁFICO, VENTANAS Y MEJORAS DEL 11/11"

---

### APP 1 (Backtester) - 10 Noviembre 2026: Prueba Manual de los Setups y Precio como Índice (fase 4)

**Pedido:** decidir a mano las reglas de cada setup sin gastar las fechas con que se comprueban. Además, con "Fecha al azar y oculta", que el precio tampoco delate la época: lo que importa son los porcentajes.

**Cambios:**
1. **Fecha de corte** en el modal de Setups (2025-07-01 por defecto): "Evaluar" nunca mira desde esa fecha, aunque la hora simulada sea posterior
2. **Comprobación final:** botón por receta que la corre solo en lo reservado, pide confirmar y queda registrada con su versión en `OrderFlowData/observer/setup_validations.jsonl`. El modal muestra cuántas veces se comprobó y el último resultado
3. **Versiones:** cada receta guardada suma una versión con fecha (`v1`, `v2`...)
4. **Tus trades por setup:** el informe del Observador da acierto y R de tus órdenes con cada setup elegido para el análisis, contra las que no lo tenían
5. **Precio como índice:** con fecha oculta el precio del inicio vale un número al azar entre 80 y 120 y el resto se mueve en el mismo porcentaje, con 3 decimales. Volumen, delta, CVD, OI y cantidades van en una escala donde la vela típica del inicio vale 1,000. Cubre gráfico, indicadores, dibujos, panel de trading, historial, dashboard, Excel y Observador. Las órdenes y el registro siguen en precios reales; "Revelar fecha" vuelve a mostrarlos
6. **Fallo de la fase 3:** "Evaluar" medía solo los últimos 70 días aunque pidiera 180. Ahora pide en tramos

**IMPORTANTE:** reiniciar el backend de App 1. Las evaluaciones anteriores a este cambio cubrieron 70 días como mucho. La comprobación final gasta lo reservado para esa receta: conviene usarla una vez, con las reglas ya decididas.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "ELEMENTOS DE ORDER FLOW" ("Prueba manual") y "OBSERVADOR" ("Retrocesos y fecha oculta")

---

### APP 1 (Backtester) - 10 Noviembre 2026: Setups de Order Flow como Recetas (fase 3)

**Problema:** los 91 setups de Orderflows Unlocked son combinaciones de elementos sin entrada, stop ni resultados. Strategic Flows, el producto del mismo autor, los combina con un "Consenso", pero no los mide.

**Cambios:**
1. **Recetas:** `backend/of_setups.py` combina los elementos de "Elementos OF":
   - modos: misma vela, al menos N, grupos con mínimo y secuencia en orden;
   - ventana de 1 a 5 velas;
   - filtros: swing, momentum (EMA 14) y confirmación de entrada.
   
   Cada voto cuenta en la vela con la que se conoce su elemento
2. **Biblioteca:** los 91 setups con el orden y la ventana leídos de las láminas, apagados de fábrica. Los cuatro que usan Market Weakness quedan marcados
3. **Gráfico:** corchete bajo o sobre las velas que votaron, con la etiqueta del setup, elegible para el análisis del trade
4. **Modal "Setups de Order Flow"** (desde el modal de Elementos OF): activar, evaluar una receta o toda la lista en los días anteriores a la hora simulada con costos y contra la base, ordenar por ventaja, editar y crear recetas propias

**IMPORTANTE:** reiniciar el backend de App 1. La evaluación usa solo lo ocurrido antes de la hora simulada; con menos de 30 casos avisa "muestra pequeña".

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE ORDER FLOW", "Setups como recetas"

---

### APP 1 (Backtester) - 10 Noviembre 2026: Elementos de Order Flow con Delta Exacto y Órdenes Reales (fase 2)

**Problema:** el almacén guarda compra y venta por minuto, así que el Max/Min Delta de una vela salía con resolución de 1 minuto. En BTC 15m eso marcaba Small Min/Max en 30% de las velas contra 12% exacto. Tampoco había forma de ver una orden que cruza varios precios ni las órdenes grandes.

**Cambios:**
1. **Almacén de flujo:** `OrderFlowData/tools/build_flow.py` guarda por minuto el máximo y el mínimo del delta dentro del minuto, y las órdenes agresivas de 3 precios o más (desde 100,000 USD) o de 250,000 USD o más. BTC completo: 2,416 días y 116 MB. `build_store.py` lo arma también para los días nuevos que descarga el panel
2. **Cuatro elementos nuevos en "Elementos OF":** Extreme Delta (XD) y Small Min/Max Delta (SM) en la tabla de la vela, barrido real (BR) y orden grande (GR) como franjas. Cada uno marca cerca del 5% de las velas
3. **Tabla de la vela:** suma Máx Δ y Mín Δ exactos

**IMPORTANTE:** reiniciar el backend de App 1. Del 07/12/2021 al 19/12/2022 Bybit publicó la hora en segundos: esos días tienen delta exacto, pero no barridos ni órdenes grandes.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE ORDER FLOW"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Elementos de Order Flow (fase 1)

**Problema:** los 91 setups de Orderflows Unlocked combinan unos 30 elementos de order flow, y App 1 solo dibujaba imbalances, stacked y delta. Los umbrales del libro son contratos del ES y en BTC marcan entre 30% y 90% de las velas.

**Cambios:**
1. **Lectura y calibración:** cinco agentes leyeron las 270 láminas de los PDF, y la fase 0 midió cada regla en BTC de 2020 a 2026. Todo quedó en `C:\Users\inven\OrderFlowData\research\orderflows_unlocked\`
2. **Motor:** `backend/of_elements.py` detecta 27 elementos con un step de análisis fijo por marco. Ocho de ellos (Stacked, Volume Imbalance, Reversal, Reload, Volume Decline, Thin Print, Open POC y ratio de extremos) solo aparecen en velas con volumen ≥ 2 veces la mediana de las 20 anteriores, ajustable en el modal. Los umbrales salen de los 30 días anteriores, para que cada elemento marque cerca del 5% de las velas. Solo usa velas cerradas antes de la hora simulada. Endpoint `/api/orderflow/elements/{symbol}`
3. **Indicador "Elementos OF":**
   - franjas que siguen hasta que el precio vuelve;
   - celdas marcadas, contornos de dos o tres velas y un triángulo con códigos;
   - panel "Tabla de la vela" (delta, Δ/Vol y delta acumulado del día) y EMA 14 opcional;
   - modal por grupos: Zonas, Giro en la zona y Continuación;
   - todo se puede elegir para el análisis del trade.
4. **Fuera por ahora:** Market Weakness, que las láminas no definen, y Extreme y Small Min/Max Delta, que necesitan el Max/Min Delta exacto (fase 2)

**IMPORTANTE:** reiniciar el backend de App 1 para aplicar los cambios. Son ayudas de lectura, no señales: el estudio de los 91 setups no encontró uno robusto. Solo BTC tiene almacén de trades.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ELEMENTOS DE ORDER FLOW"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Estilos Oscuro, Personalizado y Muhammad

**Pedido:** tres estilos más:
- un modo oscuro;
- un Personalizado basado en Nítido que guarde los colores cambiados sin tocar el Nítido original;
- Muhammad, basado en Nítido con una paleta del arte islámico investigada a fondo.

**Cambios:**
1. **Cinco estilos** en el modal "Estilo": Nítido, Oscuro, Personalizado, Muhammad y Clásico. Oscuro, Personalizado y Muhammad dejan cambiar sus colores; Nítido queda fijo, con sus colores grises y una nota
2. **Colores propios por estilo:** cada estilo editable guarda solo lo distinto a su paleta: `ui_theme_colors` (Personalizado, que parte de Nítido), `ui_theme_colors_oscuro` y `ui_theme_colors_muhammad`. Cada color y cada estilo vuelven a su paleta con un botón. Lo que antes se cambiaba en Nítido queda ahora en Personalizado, y Nítido vuelve a sus colores de fábrica
3. **Oscuro, en el lienzo:** fondo `#131722`, barras `#1E222D`, texto con 12:1 de contraste y velas como Nítido. Los textos derivados se aclaran en vez de oscurecerse. CVD, Volumen de Respuesta, Interés abierto, Liquidaciones, S&R, S&R v2 y el perfil dejan sus blancos y negros fijos
4. **Oscuro, fuera del lienzo:**
   - el encabezado, las barras y los botones toman las variables del estilo;
   - el panel de trading, los menús, la pantalla de inicio y los modales se oscurecen con un filtro que invierte la luz y devuelve el tono, así un botón verde sigue verde;
   - fotos y selectores de color mantienen sus colores reales;
   - la confirmación de orden y "Nuevo VP Fixed Range" van al body, para que el filtro no los encierre
5. **Muhammad:** papel marfil de manuscrito, turquesa de cobre y rojo bol de Iznik en las velas, cobalto en el POC, oro de iluminación en el área de valor, azul y verde nazaríes medidos en la Alhambra, morado de manganeso, minio, tinta negra y acento verde esmeralda. Texto 16:1 y datos 3.3:1 o más. Fuentes: mediciones publicadas de la Alhambra y de un santuario safávida, fotos del Art Institute of Chicago, V&A, Khalili y Ashmolean

**IMPORTANTE:**
- Basta recargar la página: no hay cambios en el backend.
- Comparado con el código de antes en Edge sin ventana, con ocho indicadores, Nítido y Clásico dan 0 píxeles distintos en la vista general y en el footprint.
- Un indicador nuevo dibuja sus paneles con `THEME.chartBg`, sus etiquetas con `THEME.labelBg` y sus textos de color fijo con `chartInk()`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTILO NÍTIDO", "Oscuro, Personalizado y Muhammad" y "Paleta Muhammad"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Liquidaciones de Velas Fijadas en su Mecha

**Problema:** al fijar el máximo o el mínimo de una vela en el indicador Liquidaciones, se contaba lo liquidado en la mitad de la vela de ese lado, y la franja medía siempre 0.2%. El usuario preguntó si era solo el precio del máximo. Pidió contar el pabilo, como un rango de precios con un alto máximo en % que él pueda ajustar.

**Cambios:**
1. **Rango:** el máximo cuenta su mecha de arriba, del cuerpo al extremo; el mínimo, la de abajo. Suma 0.1% por fuera por redondeo, como antes
2. **Mínimo y tope:** hacia adentro toma al menos 0.1%, así una vela que cerró en su extremo cuenta lo de ese precio, y a lo sumo el "Alto máximo de la mecha (% del precio)" del modal ⚙️: 0.5% por defecto, de 0.1 a 5
3. **Franja y etiqueta:** la franja cubre el rango contado y la etiqueta lo dice (`rango 0.24%`), con `(tope)` si la mecha era más larga
4. **Velas fijadas antes:** no guardaron su cuerpo y cuentan la mitad de la vela, ahora con el tope. Para pasarlas a la mecha, soltarlas y fijarlas de nuevo

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. Probado en una copia con una vela de BTC 15m del 24/10 con mecha de 0.237%: la franja fue del cuerpo a 0.1% sobre el máximo. Con tope de 0.12% se acortó y la etiqueta dijo "(tope)". Con datos por día de MarginPad, el monto es el del día completo en esos precios, como antes.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LIQUIDACIONES", "Velas fijadas"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Footprints al Alejar la Vista

**Problema:** con la simulación iniciada el 01/01/2026, el Order Flow solo se dibujaba desde el 24/12/2025, aunque el almacén tiene todo 2025. El indicador dejaba de pedir footprints con más de 400 velas en pantalla, unos 4 días en 15m. Lo ya cargado se seguía viendo y lo anterior quedaba vacío, sin aviso.

**Cambios:**
1. **Más velas:** pide footprints con hasta 1600 velas en pantalla, sin pasar de 70 días de trades. En 4h queda casi igual: hasta 420 velas
2. **Pedidos acotados:** al desplazarse pide media pantalla de más a cada lado, hasta 200 velas, y ningún pedido pasa de 70 días
3. **Aviso:** con más velas, el gráfico dice "Order Flow: acerca el zoom para cargar los footprints", y lo ya cargado se sigue dibujando

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. Reproducido y probado en una copia: con 481 velas, el desplazamiento hacia atrás antes se detenía en el 21/12 y ahora carga hasta el 15/12. Medido en el backend: 1600 velas de 15m tardan 0.3 a 0.6 s (3 MB); 1600 de 1h, 2 s la primera vez.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ORDER FLOW SOBRE LAS VELAS", "Dibujo"

---

### APP 1 (Backtester) - 9 Noviembre 2026: Colores Propios en los Modales de los Indicadores

**Problema:** con el estilo Nítido, un color cambiado en el modal del perfil de volumen no cambiaba nada; desde el modal "Estilo" sí. El usuario pidió que el estilo ponga los colores de todo, pero que lo cambiado en el modal de cada indicador se respete, incluidos el degradado y las intensidades de los perfiles.

**Cambios:**
1. **Regla:** cada indicador guarda en `customVisual` lo que el usuario cambió en su modal. Con Nítido eso se dibuja como lo dejó y el resto sigue el estilo. Una configuración anterior cuenta como propia si difiere del valor de fábrica
2. **Modales:**
   - perfil de volumen y VP de rango fijo: colores, clusters y degradado;
   - Order Flow: stacked de compra y de venta, y tamaño de las cifras;
   - confluencia OI y volumen: colores alcista y bajista;
   - volumen: intensidad, opacidad, degradado y brillo.
3. **Volver al estilo:** "Usar los del estilo" en el perfil y en la confluencia, y el botón de restablecer de los otros modales. Con Nítido, cada modal muestra el color que se dibuja
4. **Perfil de volumen:** el modal editaba un estado que los gráficos no leían. Ahora cambia el marco activo y sus colores pasan a todos los marcos. El modal "Estilo" suma el color "Clusters"
5. **Área de valor:** el perfil dinámico recibía 70 donde esperaba 0.70. Su área de valor abarcaba todo el perfil, con VAH y VAL en los extremos. En BTC 15m al 25/10 pasó de 81472.96 / 79186.95 a 81057.32 / 79925.86. Cambia también el Clásico
6. **VP de rango fijo:** el modal guardaba el ancho y el área de valor en otra unidad, y "Restaurar Defecto" dejaba las barras invisibles
7. **Volumen:** "Restaurar Valores por Defecto" borraba los colores de cluster y podía romper el dibujo hasta recargar. Además, cada cambio del modal se dibujaba con el valor anterior

**IMPORTANTE:**
- Basta recargar la página: no hay cambios en el backend.
- El Clásico da 0 píxeles distintos sin el perfil de volumen. Con el perfil activo, cambian solo el área de valor y sus líneas.
- Un VAH o VAL del perfil dinámico elegido para un trade anterior quedó en el extremo del perfil, y Rejection con el contexto "VP Dinámico" usaba esos mismos valores.
- La confluencia no guarda sus colores al recargar, como antes.
- Un indicador nuevo con colores en su modal sigue el patrón de `VP_FACTORY` con `isCustom()`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTILO NÍTIDO", "Ajustes propios en el modal de cada indicador"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Estilo Nítido con Colores Configurables

**Problema:** el usuario comparó App 1 con ATAS en su PC: App 1 se veía menos profesional. Mezclaba tres letras (el gráfico pedía "Inter", que no se carga y caía en Arial) y 240 colores sueltos de cuatro estilos distintos. Usaba 69 emojis como íconos, el eje de precios ponía valores sueltos y el footprint coloreaba oscuro el lado dominante aunque tuviera poco volumen. Pidió el cambio de estilo, eligió "Nítido" entre cinco paletas de prueba y pidió poder cambiar cada color.

**Cambios:**
1. **Estilo Nítido (por defecto):**
   - una sola letra, Segoe UI de 12 px;
   - velas #089981 y #F23645, con contraste parejo;
   - precios y horas redondos en los ejes, con el decimal de la moneda y la hora de Colombia;
   - leyenda con O, H, L, C, cambio y volumen de la vela bajo la cruz, y último precio en el eje;
   - sin brillo en el volumen.
2. **Footprint graduado:** cada celda toma color según su volumen. Las cifras van sin contorno y los desequilibrios en negrita, sin recuadro amarillo. El POC del perfil va en el color de acento.
3. **Interfaz:**
   - íconos de línea en lugar de emojis;
   - barra de dibujo con íconos y nombres, que se contrae a solo íconos;
   - botones neutros sobre el gráfico;
   - paneles de Delta, Interés abierto y Confluencia con títulos en español.
4. **Modal "Estilo y colores":** botón "Estilo" en el encabezado. Elige Nítido o Clásico y cambia 20 colores en seis grupos. Se ve al instante, se guarda en `localStorage` (`ui_theme`, `ui_theme_colors`) y se restablece. Los colores de texto se oscurecen solos si no se leen.
5. **Clásico:** el aspecto anterior queda idéntico, 0 píxeles distintos en el gráfico y el footprint.

**IMPORTANTE:** el usuario autorizó este cambio de estilos el 8/11. Basta recargar la página: el backend no cambió. Un indicador nuevo pregunta `isNewTheme()` al dibujar y toma sus colores de `THEME` (`components/uiTheme.js`).

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ESTILO NÍTIDO"

---

### APP 9 (OrderFlowDesktop) - 8 Noviembre 2026: Pruebas y Correcciones de Datos, Trading y Footprints

**Problema:** las pruebas de App 9 encontraron fallos que perdían datos, arriesgaban dinero real o mostraban footprints equivocados. El archivo local de footprints no se actualizaba desde el 05/11: cada sondeo de 5 s lanzaba otra descarga de 48 h a la nube, y la nube terminaba cortándolas. En BTC 5m las celdas mostraban el doble del volumen real, y en las monedas baratas cada vela quedaba en una sola celda.

**Cambios:**
1. **Panel de Trading:** abrirlo ya no deja el timeframe en `[object Promise]`: el temporizador del panel llamaba al setter del timeframe. La caja TP/SL se vuelve a leer cada 5 s y al cambiar de moneda, así que una orden ya no puede salir con el SL/TP de otra moneda. El badge muestra LIVE, TESTNET o DEMO según el bot, y los precios usan el tick de la moneda. Si la posición queda sin stop o el resultado es desconocido, un aviso pide no reintentar
2. **Archivo local:** una sola descarga por moneda a la vez y un intento cada 15 min. Baja las horas que faltan (48 a 168), comprimida y con corte real a los 180 s. Escribe primero a un temporal y luego reemplaza el archivo, en JSON compacto: BTC pasó de 89 a 64 MB con más datos. Si el archivo existente no se puede leer, no se sobrescribe. Se relee del disco solo si cambió
3. **Aplicar a historial:** ya no borra el archivo local y pausa de verdad el sondeo de Order Flow. El backend también limpia su caché en memoria: antes devolvía lo mismo. El historial conserva el step con que se grabó
4. **Footprints de 5m:** cada nivel va entero a la celda de su precio medio. El step de cada vela es el mayor entre el configurado y el de sus datos, y se aceptan steps menores de 0.01 (antes pasaban a 0.1). Volumen y delta se conservan exactos. POC, imbalances, stacked y z-score siguen la regla del backend en 1m. Archivo y backend se unen por minuto antes de agregar, y las velas del archivo quedan en caché
5. **Sondeo al backend:** pide los footprints completos cada 60 s y, entre medio, solo los últimos 10
6. **Gráfico:** con poco zoom o pocos días, Order Flow, VWAP y los paneles usan el mismo ancho por vela que las velas; antes se estiraban. El delta va debajo de la vela y el perfil marca el POC aunque sea el primer nivel. El campo de step size acepta valores como 0.002
7. **WebSocket de velas:** se reconecta tras un corte, envía ping cada 20 s y reconecta si pasan 60 s sin datos o vuelve la red
8. **Backend (App 5):**
   - La caché de velas se refresca al vencer; antes devolvía la misma foto hasta reiniciar
   - La consulta a la nube va en segundo plano; antes congelaba todo el backend hasta 50 s
   - El DELETE de caché valida el símbolo
   - Rejection solo avisa al bot por patrones de la vela actual o la anterior, con la hora del patrón para que el bot no repita la señal
9. **Arranque:** `1.START_ALL_ultimo.bat` espera hasta 10 min al backend y lo levanta solo en 127.0.0.1

**IMPORTANTE:** reiniciar el backend (11000) y App 9 para aplicar los cambios. Todo se probó en una copia aislada: backend en 11300, frontend en 11301, Electron oculto con una copia del archivo y un bot falso. Nada se probó contra el bot ni contra Bybit real.

**Pendiente (fases 3 y 4):**
- Swing cambia la config global desde el gráfico
- Steps del collector en la nube (XRP sigue en 0.005: 1 o 2 celdas por vela)
- Imbalance diagonal y tope de 100 niveles
- El relleno desde la nube al arrancar no llega a la API
- Hueco de 41 h del 03/11 en el archivo de BTC: se rellena con "Descargar ahora" del panel de Archivo

**Ver:** `9.OrderFlowDesktop/CLAUDE.md` sección "Pruebas y Correcciones (8 Noviembre 2026)"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Referencias en las Tres Imágenes

**Problema:** en el Observador, algunas referencias de un trade faltaban en una o dos de sus imágenes (Decisión, Apertura y Cierre) y sí salían en las otras. Un nivel nacido antes del borde izquierdo de la imagen se dibujaba, pero quedaba sin número. Uno fuera del rango de precio de la imagen no se dibujaba, como un objetivo justo debajo de las velas. Una marca fuera de la vista tampoco tenía número.

**Cambios:**
1. **Precio:** cada imagen abarca el precio de todos los niveles de su orden, con aire para su etiqueta
2. **Niveles anteriores:** un nivel que nace antes de la primera vela de la imagen lleva su número en el borde izquierdo, donde empieza su línea
3. **Marcas:** la imagen se aleja hasta la vela de cada marca, sin perder lo que mostraba y hasta 3 veces sus velas. Más lejos la imagen no cambia, para no dejar el trade en un rincón, y el número de la marca queda en el borde izquierdo, a su precio
4. **Gráfico:** no cambia. Solo las imágenes de los trades nuevos usan esto

**IMPORTANTE:** las imágenes ya tomadas no cambian: les siguen faltando esos números. No hay cambios en el backend: basta recargar la página.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "JOURNAL DE TRADES"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Nitidez del Gráfico

**Problema:** el gráfico se veía borroso y en pantallas grandes no mejoraba. El lienzo no usaba la densidad de la pantalla: con escala de Windows o zoom del navegador distinto de 100% el navegador lo estiraba. Además velas, mechas, líneas y celdas del footprint caían entre dos píxeles y se pintaban a medio tono, incluso a 100%. Las imágenes de trades se guardaban al tamaño de la pantalla.

**Cambios:**
1. **Densidad real:** el lienzo tiene los píxeles reales de la pantalla y se dibuja en píxeles CSS con esa escala. Se ajusta solo al mover la ventana a otro monitor o cambiar el zoom del navegador
2. **Píxeles enteros:** `components/chartPixels.js` lleva rectángulos y líneas horizontales y verticales a píxeles reales enteros: velas, volumen, ejes, cruz, perfiles, footprints, paneles, niveles y dibujos. Las mechas quedan centradas en el cuerpo
3. **Texto:** el lienzo es opaco, así el texto del gráfico sale con ClearType como el resto de la pantalla
4. **Imágenes de trades:** con el doble de píxeles que la pantalla, como mínimo. "Ver a tamaño real" del visor deja leer las cifras del footprint. Las marcas del Observador siguen en su lugar
5. **Sin cambios de estilo:** mismos colores, tamaños de letra y disposición. Una línea fina semitransparente ahora cae en una sola fila de píxeles y se ve más definida
6. **Velocidad:** igual que antes: 60 cuadros por segundo a 10000x con el lienzo a 1x, 1.5x, 2.25x y 3x, sin tareas largas, y el redibujo cuesta lo mismo (unos 4 ms)

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend. En la consola, `localStorage.setItem('chart_pixel_ratio', 'off')` y recargar vuelve al dibujo anterior; `removeItem` lo deshace. Un indicador nuevo dibuja sus líneas horizontales con `alignY` y `crispWidth`, y las verticales con `alignX`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "NITIDEZ DEL GRÁFICO"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Niveles Elegidos por Trade

**Problema:** los niveles y marcas elegidos para un trade seguían elegidos al abrir el siguiente, y cada orden nueva se los volvía a llevar. Valen solo para el caso en que se eligieron.

**Cambios:**
1. **Al crear la orden:** lo elegido pasa a ella con su papel y su nota (`takeLevels()`), y la lista del panel queda vacía para el trade siguiente. En el gráfico se quitan sus líneas y aros, y el menú los muestra sin marcar
2. **Registro:** la orden conserva su copia. El historial, el Observador y el informe la siguen usando igual
3. **Imágenes:** cada imagen dibuja los niveles de su orden, no la lista del panel. La de una limit que se llena después no muestra lo elegido para otro trade
4. **Lista anterior:** la lista guardada antes de este cambio juntaba lo elegido para todos los trades y ya no se carga (`analysis_levels_v2_`). Después de la actualización empieza vacía

**IMPORTANTE:** no hay cambios en el backend: basta recargar la página.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "REGISTRO AUTOMÁTICO" y "JOURNAL DE TRADES"

---

### APP 1 (Backtester) - 8 Noviembre 2026: Liquidaciones de Velas Fijadas

**Problema:** las zonas del indicador Liquidaciones solo miran 30 días hacia atrás, pero un barrido muy grande de hace meses puede seguir siendo soporte o resistencia.

**Cambios:**
1. **Fijar una vela:** con Liquidaciones activo, un clic en el máximo o el mínimo de una vela abre el menú de niveles con "Fijar liq. del máximo" o "Fijar liq. del mínimo"
2. **Franja propia:** queda una franja ámbar en ese precio, desde la vela hasta hoy, con lo liquidado en esa mitad de la vela y la fuente de su fecha. Si el precio la cruza queda tenue y punteada
3. **Lista propia:** las velas fijadas no son lo elegido para un trade. Siguen después de cada orden hasta que se sueltan, desde el menú o desde la lista del modal ⚙️ de Liquidaciones
4. **Análisis del trade:** un clic en la franja ofrece "Liq. de vela fijada", que entra con papel y nota a lo elegido y pasa a la orden como los demás niveles del Observador
5. **Sin futuro:** cada vela pide aparte sus liquidaciones, cortadas en la hora simulada. Con datos por día queda "parcial" hasta que cierra su día

**IMPORTANTE:** basta recargar la página: no hay cambios en el backend.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LIQUIDACIONES", "Velas fijadas"

---

### APP 1 (Backtester) - 7 Noviembre 2026: Indicador de Liquidaciones

**Problema:** el usuario usa las liquidaciones como zonas de barrido violento para estar alerta, y App 1 no tenía ese dato. Pidió "una especie de heatmap" con pocos niveles cerca del precio que cambien al avanzar la reproducción.

**Cambios:**
1. **Indicador "Liquidaciones":** hasta 3 zonas arriba y 3 abajo, a menos de 6%, con lo liquidado en 30 días. Rosada si se liquidaron largos y celeste si cortos, más opaca cuanto más dinero. Dos zonas mostradas dejan 0.25% de espacio, así un barrido ancho no llena el gráfico. Una zona que el precio atravesó queda tenue, punteada y marcada "cruzada"
2. **Fuentes:** MarginPad (todo el mercado, precio real por día), Coinalyze (todo el mercado, precio estimado con velas de 5 minutos), Binance Coin-M (un mercado) y Bitfinex (un mercado pequeño). En cada fecha manda la primera que la cubre, nunca se mezclan, y el gráfico dice cuál usa. En ⚙️ se puede fijar una
3. **Cobertura:** BTC tiene Coinalyze de julio 2021 a hoy, MarginPad del 08/10 al 07/11/2026, Coin-M de junio 2023 a octubre 2024 y Bitfinex en tramos sueltos. Las otras 6 monedas de App 1 tienen Coinalyze desde que Bybit tiene sus velas y MarginPad desde el 10/10/2026. Fuera de eso el indicador avisa y no dibuja nada
4. **Sin futuro:** el backend corta en la hora simulada. Un día de MarginPad se conoce al cerrar, un intervalo de Coinalyze también, y un evento en su hora. Con fecha oculta no muestra fuente, fechas ni montos
5. **Evidencia:** las zonas de Coinalyze coinciden con 76% de las de MarginPad, contra 33% por azar. Bitfinex acierta el lado como el azar, así que queda al final
6. **Velocidad:** a 10000x en 15m, 60 cuadros por segundo y ninguna tarea larga, igual que con el indicador apagado
7. **Datos:** `backend/liq_update.py` arma `OrderFlowData/liquidations`. La clave de Coinalyze la creó el usuario y está en `coinalyze_key.txt`, fuera del repositorio
8. **Actualización automática:** tarea programada de Windows "App1 Liquidaciones", todos los días a las 7:30 (`backend/liq_auto.py`, sin ventana). Coinalyze cada día y MarginPad cada 5 días. Registro en `OrderFlowData/liquidations/actualizacion.log`

**IMPORTANTE:** reiniciar el backend de App 1 para aplicar los cambios. MarginPad solo alcanza 30 días hacia atrás y Coinalyze unos 20 días en intervalos de 15 minutos: si la tarea deja de correr más de dos semanas, se pierde ese detalle.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "LIQUIDACIONES"

---

### TradingBot + App 10 - 7 Noviembre 2026: Auditoría de Órdenes en Bybit

**Problema:** la auditoría de App 10 y del bot encontró 17 fallos que podían abrir operaciones sin stop, duplicarlas o darlas por fallidas cuando sí se ejecutaron. También fallaban el redondeo de precios en las alertas del Analizador y de OrderFlow, y el paso de cantidad en los formularios de App 8 y App 9.

**Cambios:**
1. **SL heredado:** cada alerta trabaja con una copia de la configuración (`get_coin_config()`), así que su SL o TP no pasa a la siguiente. Al cargar se limpian los restos guardados en `trading_config.json`
2. **Respuesta perdida:** `order/create` no se reenvía a ciegas. El bot busca la orden por su `orderLinkId` y revisa la posición. Si no la encuentra, queda `unknown` con aviso crítico
3. **Posiciones sin SL:** los dos métodos comprueban el SL de la posición. Si no se puede poner, la posición se cierra a mercado (`closed_unprotected`) con aviso crítico. El secuencial pone TP y SL sobre la posición
4. **Duplicados:** una alerta se salta si ya hay una entrada pendiente en la moneda. Un Limit automático que ya cruza el mercado se rechaza. Se descartan las alertas repetidas y las que llegan más de 120 s tarde (`sent_at`)
5. **Tamaño:** el riesgo incluye la comisión taker de entrada y salida, y a mercado se usa el último precio de Bybit. Si el mínimo de Bybit arriesga más que lo configurado, la orden no se envía. Paso, tick y mínimo salen de `instruments-info`
6. **Riesgo diario:** se reserva bajo un candado común antes de ejecutar, también en `/api/alert` y `/api/trade/manual`
7. **Apalancamiento:** se fija en Bybit el `leverage` de la configuración, una vez por moneda. El modo de posición y el de margen no se cambian
8. **API local:** escucha solo en `127.0.0.1` y rechaza peticiones de otras páginas web (CORS, `Origin` y Host)
9. **Pausa:** "Pausar todo el trading" en el panel de orígenes y en la bandeja (`/api/settings/trading-paused`)
10. **App 10:** notificación del sistema cuando una posición queda sin protección. En modo cobertura muestra los dos lados, cada uno con su SL y TP
11. **Otras apps:** el Analizador y OrderFlow ya no redondean a 2 decimales precios, distancias ni SL/TP, y mandan `sent_at`. El envío por lotes del Analizador solo manda zonas con el trade abierto. Los formularios de App 8 y App 9 leen `step_size`

**IMPORTANTE:** reiniciar el bot y los backends de App 4 y App 5 para aplicar los cambios. Las 26 pruebas pasan contra un Bybit simulado, y 25 fallan con el código anterior, pero nada se probó contra Bybit real: hay que confirmarlo en modo Demo antes de operar en real. Las copias de `TradingBot_Python` dentro de App 2, 4 y 5 no se tocaron y conservan los fallos.

**Ver:** `10.TradingBotDesktop/CLAUDE.md` sección "Correcciones de la auditoria"

---

### Panel Order Flow - 7 Noviembre 2026: Descargas de Bybit y Collector de App 9

**Cambios:**
1. **Descargas:** ventana tkinter en `PanelOrderFlow/` (doble clic en `Abrir panel.bat`). Descarga cualquier moneda, la pausa, la reanuda y la detiene, maneja la cola de `queue.txt` y arma el almacén de App 1
2. **Collector:** una segunda pestaña muestra el estado de la nube (Northflank), del backend local en el puerto 11000 y de la copia de App 9. "Buscar huecos" revisa las últimas 6 horas
3. **Qué toca:** solo escribe `control.json` y `queue.txt`, y lanza `ingest.py`, `build_store.py` y `queue_runner.py`. No modifica las herramientas ni borra archivos. "Detener ya" corta solo los procesos de esas herramientas

**IMPORTANTE:** del 2021-12-05 hacia atrás, Bybit entrega los archivos de BTC con las filas invertidas, y esos días quedan para "revisar": el volumen no cuadra en 180 a 270 de los 1,440 minutos. Falta investigarlo.

**Ver:** `PanelOrderFlow/LEEME.md`

---

### APP 1 (Backtester) - 7 Noviembre 2026: Filtro VWAP del Swing con Rectángulos, Imágenes con Contexto e Historial sin Retroceso

**Problema:** el filtro VWAP del Swing no actuaba en App 1. La primera imagen de cada trade salía con el zoom de leer footprints y mostraba pocas velas. Ir a un trade desde el historial retrocedía la hora simulada y ocultaba las velas posteriores. Los círculos del visor del Observador se confundían con los aros morados del gráfico.

**Cambios:**
1. **Swing:** con su filtro VWAP encendido y el indicador VWAP activo, el filtro actúa dentro de los rectángulos dibujados en el gráfico. Afuera las señales no cambian: los rectángulos no son lista blanca. No cuentan los rectángulos que definen un VP Fixed. Entre bandas la señal se descarta; cerca de la banda inferior solo quedan mínimos y cerca de la superior solo máximos
2. **Caché del Swing:** se recalcula al cambiar un rectángulo (al soltarlo, no mientras se arrastra) y con cada cálculo nuevo del VWAP. En reproducción no se recalcula en cada tick
3. **Imágenes:** la de decisión y la de apertura muestran unas 5 veces las velas que había a la vista, sin bajar de 3 px por vela. Tu vista no cambia. La de cierre sigue encuadrando el trade completo
4. **Historial:** la fila y 📍 llevan la vista a la entrada del trade sin mover la hora simulada, con lo que pasó después a la derecha. Para volver al presente está "Ir a última vela". Un trade posterior a la hora simulada, después de retroceder el reloj, no se abre
5. **Observador:** los círculos numerados sobre las imágenes y los números de "Marcas y notas" son azul claro, igual que la marca de "Ir al gráfico". Los aros de lo elegido en el gráfico siguen morados

**IMPORTANTE:** no hay cambios en el backend: basta recargar la página.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "JOURNAL DE TRADES" y "REPRODUCCIÓN LIGERA"

---

### APP 1 (Backtester) - 7 Noviembre 2026: Niveles con Papel, Marcas con Nota y Carga sin Velas Duplicadas

**Problema:** las medidas del Observador no decían qué papel cumplía cada nivel ni por qué importaba una señal, y desde la imagen de un trade no se podía volver al punto exacto del gráfico. Además algunas órdenes no se abrían, la carga inicial enviaba cada vela dos veces y seguían pendientes las bandas de VWAP y el filtro del Swing.

**Cambios:**
1. **Papel:** al elegir un nivel con un clic se marca si es Soporte, Resistencia, Entrada u Objetivo, con una nota de por qué importa. Se ve en el menú, en el panel, en el gráfico y en la lectura de la orden
2. **Más niveles:** FVG (borde alto, 50% y borde bajo), la línea de Double Top/Bottom y Order Flow (POC de la vela, stacked e imbalances sueltos). Order Flow solo ofrece con footprints a la vista y no dibuja nada extra
3. **Marcas con nota:** rombos y flechas de Volumen de Respuesta, señales de Swing, extremos de Double Top/Bottom, rechazos y rombos de delta contrario. Entran como "Solo marca" y pueden recibir un papel
4. **Imágenes:** cada imagen guarda dónde quedó cada nivel o marca de la orden. En el Observador salen numeradas sobre la imagen, con su nota al pasar el mouse. "Ir al gráfico" lleva la vista a ese punto sin mover la hora simulada
5. **Delta:** debajo de los footprints a 13 px, con tamaño elegible en el modal de Order Flow
6. **Órdenes que no se abrían:** con "Automática" y "Usar precio actual", un clic justo cuando cambiaba el precio dejaba la orden pendiente al precio anterior: 1 de cada 6 a 10 clics con la app cargada. Ahora entra a mercado. La caja TP/SL de una orden viva se podía mover y la orden seguía en sus precios: ahora vuelve a los de la orden
7. **Carga inicial:** cada vela viajaba dos veces, porque `subdivisions` era copia de `main`. La respuesta bajó de 422 a 238 MB y la primera carga de unos 80 s a unos 60 s. Baja a unos 40 s cuando el caché del servidor se guarde sin la copia
8. **VWAP:** las bandas de sesión empiezan en la primera vela de su sesión, como el backend. Antes salían de 2.5 a 3.7 veces más anchas. BandWidth, BBWP y TTM se recalibraron por marco y las primeras velas de cada sesión quedan en gris
9. **Swing:** el filtro VWAP lee las bandas correctas. Actúa dentro de los rectángulos del gráfico desde la entrada "Filtro VWAP del Swing con Rectángulos, Imágenes con Contexto e Historial sin Retroceso"
10. **Observador:** sin análisis por sesión del mercado, porque cripto opera 24/7. La hora UTC se queda
11. **ARB, SUI y TRX:** no recibían velas nuevas desde el 22-23 de octubre. La expansión hacia atrás terminaba sin la actualización ni el guardado. Ahora sigue con las velas nuevas y guarda `first_available_ts` para no repetirla. El Open Interest nuevo se suma por hora al guardado: antes reemplazaba una serie larga por unas semanas
12. **Presets de VWAP:** uno guardado en otro marco, sin marco o antes de esta ronda conserva la calibración del marco donde se carga

**IMPORTANTE:** reiniciar el backend de App 1 para aplicar los cambios. Un indicador nuevo con ayudas visuales las ofrece en `selectableLevels()` con su lugar ya calculado en el dibujo (`x`, `y`, `r`, o `left`, `right`, `top`, `bottom`) y sin dibujar nada para eso.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "REGISTRO AUTOMÁTICO", "JOURNAL DE TRADES", "ÓRDENES", "REPRODUCCIÓN LIGERA" y "ORDER FLOW SOBRE LAS VELAS"

---

### APP 1 (Backtester) - 7 Noviembre 2026: Reproducción Ligera, S&R v2 Nuevo e Imágenes en el Observador

**Problema:** la reproducción se frenaba, el filtro z-score de S&R v2 no parecía hacer nada y las medidas del Observador no se podían confirmar a ojo.

**Cambios:**
1. **Reproducción:** con S&R v2 y z=1.5 en 15m pasó de 4.5 ticks por segundo y bloqueos de 475 ms a la velocidad pedida exacta, sin bloqueos y con 9% del navegador. El Observador no era la causa: cuesta 0.1 ms por tick
2. **Reloj:** si un tick llega tarde recupera el tiempo debido. Las velocidades sobre 18750x ya funcionan. Las órdenes se revisan en cada tick y la pantalla se actualiza 10 veces por segundo
3. **Gráfico:** solo trabaja el marco visible, no copia ni filtra todo el historial en cada dibujo, y el límite de 33 ms ya actúa al mover el mouse. Salieron unos 55 console.log por tick
4. **Indicadores:** Double Top/Bottom, Swing, VP Fixed y VWAP dejaron de recorrer todo el historial. VWAP en 5m bloqueaba 23 s al activarse
5. **S&R v2:** recorre las velas hacia adelante (`swingLevels.js`). Un nivel vale hasta que una vela cierra más allá de todos sus toques. El filtro ahora quita líneas y el modal muestra su efecto antes de aplicar. Se aplica a todos los marcos y se conserva al reiniciar. Un campo vacío no se aplica y un valor fuera de rango queda en el límite del modal
6. **S&R clásico:** ya no usa velas ni niveles futuros (caché, backend y vela final)
7. **Imágenes en el Observador:** miniaturas de Decisión, Apertura y Cierre. Al abrirlas se ven junto a las medidas. Cada imagen dice su marco y su hora simulada. Las limit y stop guardan además lo que se veía al decidir
8. **Sin futuro:** el reloj se detiene un momento para tomar cada imagen. Informe y CSV ya no usan la lectura de órdenes vivas. Controles del informe y reglas solo usan lo que la corrida ya vivió. Una imagen o un resultado no se muestran si pasan de lo vivido o si revelan la fecha oculta, salvo con "Ver igual". Ir a un trade de la vela en curso ya no adelanta el reloj. La línea vertical, el CSV y el Excel también ocultan la fecha. Con fecha oculta la prueba de reglas no muestra la tabla por año y el CSV deja esas órdenes al final
9. **Órdenes:** una orden ya no puede cerrarse antes de llenarse. Con el equipo cargado, el efecto de la hora repasaba velas viejas y la orden salía con un resultado que no ocurrió. El fallo ya existía antes de esta ronda
10. **Configurar:** el reloj anterior se detiene al iniciar otra vez, y el nuevo toma la velocidad del selector. Antes quedaba andando sin poder pausarlo

**Pendiente, anterior a esta ronda:** las bandas de VWAP de sesión y el filtro VWAP del Swing. Se corrigieron en la entrada "Niveles con Papel, Marcas con Nota y Carga sin Velas Duplicadas".

**IMPORTANTE:** medido en BTC contra niveles al azar, los niveles de S&R v2 no aguantan más que un precio cualquiera, con o sin filtro de volumen. Es un mapa de estructura. Un indicador nuevo no debe recorrer `knownCandles` entero en cada dibujo: usa búsqueda binaria o calcula al cerrar una vela.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "REPRODUCCIÓN LIGERA" y "JOURNAL DE TRADES", y `1.Altagracia_Crypto_Backtester/CLAUDE.md` sección S&R v2

---

### APP 1 (Backtester) - 6 Noviembre 2026: Registro Automático de Operaciones + Zone Detector Eliminado

**Problema:** marcar motivos antes de entrar depende de la memoria y estorba la decisión. Para encontrar patrones en las operaciones hacían falta datos que se guardaran solos y momentos sin entrada con qué compararlas.

**Cambios:**
1. **Medidas:** `measures.py` arma una tabla con una fila por vela de 15m cerrada y 58 medidas de 15m, 1h y 4h: contexto, tramo, volumen contra lo normal de su hora, Volumen de Respuesta, volatilidad, FVG, perfil, OI, delta y hora UTC. Cada orden se lee ahí al decidir y al llenarse. Nada se muestra hasta que la orden termina
2. **Dibujos:** cada orden guarda los trazos hechos en las últimas 100 velas o que tocan esas velas. Los posteriores a la orden no cuentan
3. **Niveles:** clic sobre un POC, VAH, VAL, soporte o resistencia en el canvas abre un menú con la casilla "Incluir en el análisis". Sirve en Volume Profile, VP Fixed Range, VP Periodic, S&R y S&R v2. La lista queda en el panel de trading y viaja con cada orden
4. **Resultado:** R neto, lo máximo a favor y en contra, duración y espera. Las canceladas también cuentan
5. **Motivos:** salieron de la entrada. Son opcionales y se agregan cuando la orden termina
6. **Informe:** qué distingue las entradas de 10 momentos sin entrada por orden, qué separa ganadoras de perdedoras y referencias. Una diferencia se marca solo si supera lo que da el azar
7. **Reglas:** hasta 3 condiciones probadas en fechas no operadas, con costos, por año y contra la base sin condición. También hay CSV con todo el registro
8. **Zone Detector:** eliminado de App 1: pestaña Zonas, `ZoneDetectorTester`, `ZoneVisualizerIndicator`, `/api/zones/*`, `zone_*.py` y sus exportes. Las otras apps tienen el suyo y no dependían de este

**IMPORTANTE:** `measures.py` repite la regla de `responseBalance.js` y `research/response_volume/engine.py`. Si cambia una fórmula, hay que subir `VERSION` en `measures.py` para reconstruir la tabla.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "REGISTRO AUTOMÁTICO"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Orden y Altura de Paneles + Estrategia Eliminada

**Cambios:**
1. **Orden:** cada panel de indicador tiene ▲▼ en el margen derecho
2. **Altura:** se arrastra el borde superior de cada panel. Solo cambia ese panel: el precio cede o recibe la diferencia
3. **Reparto:** se guarda por símbolo y lo comparten todos los marcos. La lista de indicadores trae un botón para restablecerlo
4. **Estrategia:** se quitaron la pestaña, `components/strategy/`, los endpoints `/api/strategies` y `strategy_*.py`. El panel Zonas no dependía de ella

**IMPORTANTE:** todo sigue en un solo canvas. El intento anterior con paneles separados dejó de dibujar los indicadores: los controles son HTML encima del canvas y el dibujo sigue centralizado en `renderIndicators()`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "Orden y altura de los paneles"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Volumen de Respuesta con Evidencia

**Problema:** el indicador usaba respuesta e iniciativa de Market Profile, que no es el concepto del usuario. Su idea viene de observación propia: cerca de una pausa o un giro, el volumen de la retracción se equipara al de la tendencia.

**Cambios:**
1. **Panel:** velas principales de compra contra las de venta. Arriba de cero pesa la compra y abajo la venta
2. **Señales:** rombo cuando la tendencia dominó y la respuesta la igualó. Flecha en velas con el doble o más del volumen normal de su hora
3. **Volumen por hora:** cada vela se compara con su misma hora en los 30 días anteriores. Sin ese ajuste la idea no se sostiene
4. **Evidencia:** en 2025 y 2026 el precio hizo nuevo extremo 5.6 pts menos en 15m y 10.6 menos en 1h que en situaciones iguales sin señal. En 4h no hay muestra. No anticipa dirección ni detecta techos o suelos
5. **Sin futuro:** `ResponseSeries` solo mira hacia atrás y se extiende con cada vela cerrada. 15m completo tarda 0.7 s

**IMPORTANTE:** `responseBalance.js` repite `research/response_volume/engine.py`. Si cambia la regla, hay que cambiar los dos y correr la paridad.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "VOLUMEN DE RESPUESTA" y `OrderFlowData/research/response_volume/INFORME.md`

---

### APP 1 (Backtester) - 6 Noviembre 2026: Órdenes por Riesgo, VP Periodic y Volumen de Respuesta

**Cambios:**
1. **Órdenes:** tamaño por monto fijo o por capital arriesgado, y tipo automático como en App 8. Toman entrada, stop y objetivo de la última caja TP/SL libre. Lejos del precio esperan: limit si el precio debe volver, stop si debe avanzar. Lógica en `orderPlan.js`
2. **Cajas TP/SL:** nacen con 45 px de riesgo, 130 px de ancho y riesgo beneficio 2, sin salirse del gráfico. Se miden en píxeles para verse igual en cualquier marco
3. **VP Periodic:** traído de App 8, con sesiones en hora UTC. Solo usa velas ya ocurridas y volumen real en sesiones terminadas
4. **Volumen de Respuesta:** ver la entrada "Volumen de Respuesta con Evidencia"
5. **Step:** con step automático una vela no pasa de 10 niveles (`maxLevels`). Una vela ancha une niveles y sube su propio step. Un step escrito a mano se respeta hasta 200 niveles
6. **Footprints:** se dibujan encima de los perfiles y demás indicadores
7. **Modales:** los de indicadores y el Observador quedaron en modo claro
8. **Pestaña Estrategia:** eliminada del frontend y del backend. Sus resultados dependían del futuro: detectaba las zonas con todas las velas antes de simular. También se borraron sus 8 estrategias guardadas, que siguen en el historial de git. El panel Zonas no dependía de ella

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` secciones "ÓRDENES", "SESIONES" y "ORDER FLOW SOBRE LAS VELAS"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Journal de Trades con Imagen

**Problema:** la imagen de cada trade nunca se pudo ver. El archivo se guardaba, pero al pedirlo `sanitize_filename()` le quitaba el punto y el backend buscaba `order_123png.png`. Además se tomaba al cerrar, y nada llegaba a la sesión sin guardarla a mano.

**Cambios:**
1. **Imagen de apertura:** se toma al abrir la posición, con indicadores y caja TP/SL. Mercado al crearla, limit y stop al ejecutarse. `OrderManager` ahora emite `tradeOpened` en los dos casos
2. **Imagen de cierre:** 10 velas después de cerrar (`EXIT_CAPTURE_CANDLES`), con el trade completo encuadrado sin cambiar la vista del usuario. Si la simulación no ha llegado, queda pendiente en `order.exitCaptureAt`, también al cargar la sesión
3. **Historial:** columna 📸 que abre las imágenes, con Apertura y Cierre. La fila y 📍 siguen llevando a la línea vertical
4. **Líneas verticales:** salen de las órdenes con `tradeBoundaries()`. Se ven en todos los marcos y vuelven al cargar una sesión. Antes solo existían en el marco activo y se perdían
5. **Navegación:** va a la ejecución del trade. En una orden limit iba a la hora en que se creó
6. **Sesión:** cada orden, ejecución, cierre y cancelación se guarda sola con `saveTradeSession()`. La primera operación crea la sesión si no existe. `mergeSession()` conserva nombre, fecha y notas
7. **Caja TP/SL:** su id queda en `order.tpslBoxId` y al cerrar termina en la hora de salida. `extendTPSLBox()` buscaba el tipo `tpslbox`, pero el tipo real es `tpsl`, así que nunca la encontraba

**IMPORTANTE:** todo dato nuevo de un trade va en la orden. `exportToJSON()` lo lleva a la sesión sin más código.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "JOURNAL DE TRADES"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Indicadores sin Futuro

**Problema:** VWAP, Swing, Rejection, Double Top/Bottom y Range Detection dejaban ver información que todavía no ocurría en la reproducción.

**Cambios:**
1. **VWAP:** la vela en formación salía de la vela final. En 4h eso anticipaba la dirección del resto de la vela en 81% de los casos. Ahora `_pointFor()` la calcula con lo ya ocurrido
2. **Swing:** no reconocía los marcos `1m` a `4h` y en 4h usaba 1 hora. Ahora una señal aparece al cerrar la última vela de su derecha
3. **Rejection:** marcaba la forma final de la vela mientras se formaba. Ahora solo marca velas cerradas y ya no analiza todo el historial en cada dibujo
4. **Double Top/Bottom:** todos los patrones aparecían 6 velas antes de poder conocerse. El detector entrega `knownAt` y `replacedAt`, y la flecha de entrada espera a que cierre su vela
5. **Range Detection:** el modal analizaba todas las velas, incluidas las futuras. Ahora recibe las cerradas y se ocultan rangos guardados que terminan después de la hora simulada
6. **Hora simulada:** Swing y Double Top/Bottom la leen de `priceContext.knownUntil` en cada dibujo. Antes solo la recibía la pestaña activa
7. **Double Top/Bottom al marcarlo:** calcula con la casilla, sin abrir ⚙️. Antes el precálculo corría cuando los gráficos aún no existían. Si el backend perdió las velas responde `needsCandles` y el indicador las reenvía. El detector ya no copia el historial por cada extremo: 15m completo tarda 0.7 s
8. **Rejection validado:** ahora sirve en backtesting. Envía las velas cerradas de la hora simulada y el backend valida cada vela solo con niveles cuyo rango ya terminó. Antes pedía velas recientes y el modal nunca le entregaba su configuración. Una simulación no envía alertas al bot

**IMPORTANTE:** un indicador nuevo que mire velas a la derecha debe decir cuándo se conoce cada señal. `allCandles` trae el futuro en backtesting: para calcular se usa `priceContext.knownCandles`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "INDICADORES SIN FUTURO"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Observador + Parámetros de Order Flow y FVG

**Problema:** faltaba poder cambiar step, imbalances y FVG, y faltaba medir cada operación manual contra la regla del laboratorio.

**Cambios:**
1. **Modal de Order Flow:** step por marco, ratio, comparación por nivel o diagonal, volumen mínimo, stacked, qué se muestra y zoom. El ⚙️ está junto al indicador. Aplica a todos los marcos y se guarda por símbolo
2. **Modal de FVG:** tamaño mínimo, cuándo deja de estar abierto, edad máxima, colores y opacidad
3. **Observador:** cada orden queda en `OrderFlowData/observer/journal.jsonl` con hora simulada, marco, perfiles, marcas y la lectura de la regla en ese minuto: contexto, movimiento, zona, OI y volumen
4. **Lectura oculta:** el backend no entrega la lectura hasta que la orden se cierra o se cancela. Ahí la pestaña 🔭 Observador muestra en qué coincidieron
5. **Informe:** qué condiciones se repiten, con y sin cada una, tú contra la regla, zona contra azar y mejores contra peores. Avisa si la muestra es pequeña
6. **Fecha oculta:** opción al iniciar. Elige un día al azar con trades descargados y muestra días relativos
7. **Retrocesos:** una orden creada después de retroceder el tiempo queda marcada y el informe la excluye por defecto

**IMPORTANTE:** `backend/observer.py` repite `readAt()` de `research/lab/engine.js`. Si cambia la regla, hay que cambiar los dos y correr `observer_parity.py`.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "OBSERVADOR"

---

### APP 1 (Backtester) - 6 Noviembre 2026: Reproducción sin Futuro + Footprints Reales sobre las Velas

**Problema:** la reproducción dejaba ver el futuro, la vista seguía 35% de pantalla detrás de la hora simulada y el order flow usaba un archivo de un mes. App 1 pasa a ser el puesto de trabajo manual, con los footprints de App 9 sobre las velas.

**Cambios:**
1. **Sin futuro:** `replayClock.js` arma la vela en formación con el marco más fino ya cerrado. Órdenes, VP y S/R solo usan lo ocurrido hasta la hora simulada
2. **Vista:** al seguir el precio, la vela más reciente queda a la vista (antes se escondían las últimas: unas 13 horas en 15m)
3. **Costos:** maker 0.02% y taker 0.055%, con TP y SL como taker, igual que el bot
4. **Almacén:** `OrderFlowData/store/` guarda por día, minuto y precio la compra y venta reales. `tools/build_store.py` lo crea desde `.tape` y `backend/footprint_store.py` lo lee
5. **Footprints:** `OrderFlowIndicator.js` usa el dibujo de App 9, pide solo las velas visibles y corta en `known_until`. Desde 16px el footprint reemplaza la vela, desde 60px hay cifras y delta; más angosto quedan líneas de stacked y marcas de delta contrario
6. **Zoom:** velas hasta 400px. Doble clic sobre una vela, con Order Flow activo, la acerca a 160px. El zoom vertical ahora se ancla al mouse con la escala real del dibujo
7. **Perfil y delta reales:** VP Fixed Range usa volumen real si el almacén cubre 99% del rango (muestra `· real` junto al POC). El panel Volume Delta usa delta real cuando todas las velas visibles lo tienen
8. **FVG:** indicador nuevo con la regla del laboratorio, solo con velas ya cerradas
9. **Caché:** si IndexedDB no puede guardar, la app sigue. Antes quedaba para siempre en "Cargando datos..."
10. **Open Interest:** `backend/oi_store.py` lee `OrderFlowData/oi/{SYMBOL}_5min.csv`, y el indicador pide solo la ventana visible. Antes solo había unos 22 días en caché
11. **Altura:** el gráfico llena la ventana sin scroll. El precio recibe primero su parte (`priceChartRatio`, 65% por defecto) y los paneles se comprimen hasta 48px. Antes el alto salía de la mitad del ancho

**IMPORTANTE:** después de descargar más días, correr `python -B C:\Users\inven\OrderFlowData\tools\build_store.py BTCUSDT`. Reiniciar el backend de App 1 para aplicar los cambios.

**Ver:** `1.Altagracia_Crypto_Backtester/Backtester/CLAUDE.md` sección "ORDER FLOW SOBRE LAS VELAS"

---

### TradingBot + Backends - 4 Noviembre 2026: Filtro de Alertas por Origen

**Problema:** Se atribuian al Analizador alertas que en realidad enviaba el backend de Order Flow (`5.Order_flow/backend`). Los backends 2, 4 y 5 usan la misma etiqueta `SWING_DETECTOR`, y la configuracion por simbolo ignoraba el apagado global.

**Cambios:**
1. **Filtro en el bot:** `/api/watchlist-alert` exige un campo `origin` permitido (`ANALIZADOR`, `WATCHLIST`, `ORDERFLOW`). Lo desconocido o sin origen responde 403 y se registra como `BLOCKED_ORIGIN:<origen>` en `alerts_received.log`
2. **Persistencia:** `allowed_origins` en `3.TradingBot_Python/config/bot_settings.json`. Por defecto solo `ANALIZADOR` esta habilitado
3. **UI:** panel "Alert Origins" en el dashboard de App 10 (`AlertOriginsPanel.jsx`)
4. **Swing (backends 4 y 5):** el apagado global tiene prioridad sobre la configuracion por simbolo
5. **Analizador:** `toggle-alerts` ya no detiene el servicio Swing, `/api/pattern-alert` respeta `alertsEnabled` y Rejection queda deshabilitado por defecto
6. **Watchlist:** DTB y Rejection siguen detectando con alertas apagadas; solo se omite el envio
7. **Order Flow:** `POST /api/swing/toggle-alerts` y un interruptor global de Swing en App 9, igual al del Analizador. Reemplaza la casilla por simbolo
8. **Swing en Analizador y Order Flow:** al cambiar de timeframe el servicio ahora se suscribe al nuevo intervalo (`reanalyze_historical`). Antes solo se suscribia al arrancar, y las velas en vivo se descartaban sin dejar rastro en `swing_alerts.log`
9. **Origen visible:** `origin` aparece en System Logs, como ultima columna de `alerts_received.log`, en `/api/alerts/recent` y en el historial de ordenes. La columna `source` no cambia porque la usa el Trading Journal
10. **Swing en Watchlist:** mismos limites del Analizador (`MAX_DAYS_BY_INTERVAL`, `MAX_CANDLES_ABSOLUTE`). Antes 1m con 90 dias pedia 129,600 velas por simbolo y congelaba el backend
11. **Watchlist, alertas:** el boton global usaba atributos inexistentes de `ConfigStore` y nunca confirmaba. El WebSocket arranca con los simbolos e intervalo del Swing (antes solo BTC y ETH). Bandas VWAP con sumas acumuladas (7200 velas: de 30s a 0.4s, mismo resultado), porque bloqueaban el backend y hacian caducar las alertas. El bot muestra cada bloqueo en System Logs

**IMPORTANTE:** Todo emisor nuevo hacia `/api/watchlist-alert` debe incluir `origin`, o el bot lo rechazara. Reiniciar el bot y los backends para aplicar los cambios.

---

### APP 9 (OrderFlowDesktop) - 4 Noviembre 2026: Limpieza de Rendimiento + Fix Footprints 5min

**Problema:** Aplicación muy lenta por exceso de console.log (151 en OrderFlowIndicator.js) y código debug acumulado.

**Cambios:**
1. **Limpieza de logs:** De 151 a 43 console.log/warn/error. Eliminados todos los logs per-frame, per-cell y per-second
2. **Eliminado aggregation-logger.js:** Módulo que escribía JSON a disco en cada agregación
3. **Eliminado debug rendering:** Columna de precios amarilla con sombras CSS costosas por celda por frame
4. **Fix footprints 5min recientes:** Backend retorna fps de 1min pero no se agregaban antes del merge. Agregado paso 2.5 en `fetchFootprints()` que agrega backend fps de 1min→5min antes del merge

**Archivos modificados:**
- `9.OrderFlowDesktop/src/components/indicators/OrderFlowIndicator.js` - Limpieza masiva de logs y debug
- `9.OrderFlowDesktop/src/utils/aggregation-logger.js` - **ELIMINADO**

**Ver:** `9.OrderFlowDesktop/CLAUDE.md` secciones "Limpieza de Rendimiento" y "Fix: Footprints no Cubren Velas en 5min Recientes"

---

### APP 8 (AnalizadorDesktop) - 20 Octubre 2026: Indicador Liquidation Clusters

**Implementación completa del indicador Liquidation Clusters con visualización en 3 capas y configuración UI.**

**Sistema de Renderizado en 3 Capas (Opción 4 - Modo Sutil):**
- **Top 3:** Líneas completas + labels compactos (opacidad 0.5-0.7)
- **Clusters 4-10:** Triángulos en borde + líneas punteadas (opacidad 0.2-0.5)
- **Clusters 11-50:** Sombreado muy sutil (opacidad 0.05)

**Labels Compactos:** Formato `🔥 🔻$2.5M 85%` (icono ranking + dirección + volumen + magnetic strength)

**Configuración Visual:**
- `labelPosition`: 'left' | 'right'
- `showTop3Lines`, `showMid7Markers`, `showRestShading`: true/false

**Bugs Corregidos:**
1. Gráfico desaparece → Firma incorrecta `renderOverlay()` → Corregida
2. Canvas corrupto → 120 `save()/restore()` por frame → Optimizado a 2
3. `priceToY` undefined → Sin validación `priceContext` → Helper con fallback
4. Bounds incorrectos → `.left/.right/.top/.bottom` → Cambiado a `.x/.y/.width/.height`

**Archivos modificados:**
- `src/components/indicators/LiquidationClustersIndicator.js` - Sistema 3 capas + updateConfig()
- `src/components/LiquidationClustersSettings.jsx` - Modal de configuración (NUEVO)
- `src/components/SingleSymbolAnalyzer.jsx` - Handlers + integración modal
- `src/components/MiniChart.jsx` - Botón config `🔥 LC` (rosa #E91E63)
- `src/components/indicators/IndicatorManager.js` - Getter `getLiquidationClustersIndicator()`

**Rendimiento:** 60x más rápido (de 5ms a 0.8ms por frame)

**Acceso:** Activar indicador → Click botón `🔥 LC` → Modal de configuración

**Ver documentación detallada:** `8.AnalizadorDesktop/CLAUDE.md` sección "Indicador Liquidation Clusters"

---

### APP 9 (OrderFlowDesktop) - 20 Octubre 2026: Fix Footprints Solo en Últimas 12h + Alturas Inconsistentes

**Problema:** Footprints solo se mostraban en las últimas 12h en timeframe 5min (20-30 días disponibles). Adicionalmente, celdas con alturas inconsistentes.

**Fixes implementados (todos resueltos):**
1. Preservar price_min/price_max en agregación (evita levelHeight=0)
2. Auto-download de archivos desactualizados (>12h)
3. Timestamp tolerance (30s)
4. Regenerar levels con step_size uniforme (grid fijo)
5. Step_size GLOBAL como MODA + sistema de 4 prioridades (backend > config > moda > default)
6. Expansión dinámica de levels en renderizado
7. Callback `onBackendConfigSaved` con pausa de PollingCoordinator + eliminación de archivo local
8. Backend DELETE endpoint limpia memoria + disco

**Ver documentación detallada:** `9.OrderFlowDesktop/CLAUDE.md`

---

### APP 1 (Backtester) - Octubre 2026: Header Fusionado + Fix Open Interest + UI Optimizations

**Cambios completados:**
1. **Header Fusionado (40px único)**: Eliminado header duplicado en main.jsx, consolidado todo en BacktestingApp.jsx con position fixed
2. **Fix Open Interest Endpoint**: Corrección de parámetros `Optional[int]` para start/end timestamps + import de typing
3. OI descarga datos a resolución real del timeframe (sin forward-fill/interpolación)
4. Mapeo directo: 1m→5min, 5m→5min, 15m→15min, 1h→1h, 4h→4h
5. MAX_OI_REQUESTS aumentado a 600 para máxima cobertura histórica
6. Backend retorna metadata de cobertura OI (fecha desde/hasta, intervalo)
7. Frontend muestra mensaje informativo con fecha exacta de disponibilidad
8. Helper `_getOICoverageMessage()` centraliza lógica en 3 modos de render

**Archivos modificados:**
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/main.jsx` - Eliminado header duplicado (50px)
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/backtesting/BacktestingApp.jsx` - Header único con icono, 40px
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/backtesting_styles.css` - Header position fixed, padding-top
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/backtesting/TimeframeTabs.css` - Tabs compactos (26px)
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/drawing/DrawingSidebar.css` - Alineado (top: 40px)
- `1.Altagracia_Crypto_Backtester/Backtester/backend/main.py` - Fix parámetros `Optional[int]` (líneas 5, 633-634)
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/indicators/OpenInterestIndicator.js` - metadata, cobertura

**IMPORTANTE**: Después de modificar `main.py`, es necesario **reiniciar el backend** para que los cambios tomen efecto (Ctrl+C y `start_backend.bat`).

### APP 1 (Backtester) - Febrero 2026: Reversion IndicatorPanel + Fix Open Interest Loading

**Problema 1: Intento Fallido de IndicatorPanel con Drag-and-Drop**

Se implementó un sistema de paneles de indicadores separados con funcionalidad de drag-and-drop para reordenar, redimensionar y gestionar indicadores de manera independiente:
- `IndicatorPanel.jsx` - Componente de panel individual con drag handles y resize
- `IndicatorPanel.css` - Estilos profesionales con animaciones y estados drag/drop
- Integración en `MiniChart.jsx` con estado `indicatorLayout` y ref `indicatorBoundsRef`

**Síntomas del fallo:**
- Los indicadores dejaron de aparecer completamente en el gráfico
- El canvas no mostraba ningún indicador después de la integración
- La lógica condicional para renderizar en IndicatorPanel vs canvas directo causaba conflictos
- El renderizado se intentaba hacer en refs de canvas individuales en lugar del canvas principal

**Solución aplicada:** Reversión completa de todos los cambios relacionados con IndicatorPanel

**Archivos revertidos:**
- `MiniChart.jsx`: Eliminado import, estado `indicatorLayout`, ref `indicatorBoundsRef`, lógica condicional, componente JSX
- Restaurado renderizado simple directo en canvas principal con `indicatorManagerRef.current.renderIndicators()`

**Resultado:** Los indicadores volvieron a aparecer correctamente.

**Lección aprendida:**
- El renderizado de indicadores en canvas es extremadamente sensible a la sincronización de bounds y contexts
- Separar indicadores en paneles independientes requiere arquitectura más compleja que la actual
- La lógica condicional para alternar modos de renderizado puede causar race conditions
- Es mejor mantener un sistema de renderizado simple y centralizado para indicadores en canvas

---

**Problema 2: Open Interest Data Loading**

Después de revertir los cambios de IndicatorPanel, el indicador de Open Interest no cargaba datos:
- UI mostraba "no hay datos de open interest para btcusdt"
- Backend no mostraba logs de fetch a Bybit API
- El indicador estaba habilitado pero no disparaba `fetchData()`

**Causa raíz:** Validación de datos incompleta en `IndicatorManager.js` método `updateIndicatorStates()`:

```javascript
// INCORRECTO (línea 332):
if (!indicator.dataMap || indicator.data.length === 0) {
  // Error: dataMap es un Map, necesita .size no .length
}
```

**Solución aplicada:**

```javascript
// CORRECTO:
if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
  console.log(`[${this.symbol}] 🔄 ${indicator.name} habilitado pero sin datos, recargando...`);
  promises.push(indicator.fetchData());
}
```

**Logging de diagnóstico agregado:**
- `OI State Check` - Verifica estado inicial del indicador
- `OI Data Validation` - Valida presencia de datos y decide si recargar

**Archivos modificados:**
- `1.Altagracia_Crypto_Backtester/Backtester/frontend/src/components/indicators/IndicatorManager.js` - Fix validación Open Interest + logging

**Resultado:** Open Interest ahora carga datos correctamente al estar habilitado.

**Patrón de validación para indicadores backend:**

Todos los indicadores que requieren datos del backend deben validar correctamente en `updateIndicatorStates()`:

```javascript
const backendIndicators = ["VWAP", "Open Interest", "Double Top/Bottom", "Support & Resistance", "Rejection Patterns"];

// En bloque: else if (shouldBeEnabled && wasEnabled)
if (backendIndicators.includes(indicator.name)) {
  // Validación específica por tipo de estructura de datos:

  // Arrays:
  if (indicator.name === "Support & Resistance") {
    if ((!indicator.resistances || indicator.resistances.length === 0) &&
        (!indicator.supports || indicator.supports.length === 0)) {
      promises.push(indicator.fetchData());
    }
  }

  // Maps (usar .size):
  else if (indicator.name === "Open Interest") {
    if (!indicator.dataMap || indicator.dataMap.size === 0 || indicator.data.length === 0) {
      promises.push(indicator.fetchData());
    }
  }

  // Objetos:
  else if (indicator.name === "VWAP") {
    if (!indicator.vwapData || Object.keys(indicator.vwapData || {}).length === 0) {
      promises.push(indicator.fetchData());
    }
  }
}
```

---

# APP 1: ALTAGRACIA CRYPTO BACKTESTER

**Ubicacion:** `1.Altagracia_Crypto_Backtester/Backtester/`

Sistema profesional de backtesting para criptomonedas con analisis avanzado de patrones, volumen y momentum.

## Estructura
