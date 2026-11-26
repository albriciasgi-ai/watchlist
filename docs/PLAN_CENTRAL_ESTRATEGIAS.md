# Plan: central de estrategias

Estado al 26/11/2026: concepto, cuatro prototipos y **el paso 1.1 construido en App 1**: la pestaña «Cocina» de la simulación manual, con sus fichas con imágenes (sección 5, «El paso 1.1, construido»). También pasó a App 1 el botón «Una vela más». Está en la rama de esta sesión, sin commit. Siguen los pasos 1.2 a 1.4: zonas y order flow, avisos al reproducir y el paso al backtesting global.

---

## 1. El pedido (25/11/2026)

Una central de estrategias en la suite (carpeta 12) donde el usuario arme sus estrategias con los indicadores que ya existen:

- visual y fácil: cada elemento es un bloque que se arrastra y se ordena, con sus variables, condiciones y filtros;
- con capas, porque una estrategia puede pedir varios marcos para el contexto;
- al guardarla, que se vea en el gráfico principal o en una pestaña nueva, con sus entradas y salidas;
- un panel con los trades del histórico de cada moneda, y un clic que lleve el gráfico al trade, como el backtesting global de App 1;
- un dashboard como el del backtester manual de App 1.

Referencia del usuario: el editor visual de HaasOnline (haasonline.com/editors), que «se asemeja un poco» pero «no es propiamente» su idea. Es un lienzo libre de nodos y cables, con más de 750 bloques.

---

## 2. Lo decidido con el usuario

Tras los prototipos 1 y 2 (25/11):

1. **Carriles con bloques tipados**, no un lienzo con cables. Tres tipos, cada uno con su forma y su color:
   - estado: se cumple o no en cada vela;
   - evento: ocurre en una vela;
   - zona: un área de precio que dura.
2. **La leyenda de los tipos queda a la vista.**
3. **Cada capa dice si el bloque encaja:** directo, con un ajuste (un evento en el contexto cuenta «si ocurrió en las últimas N velas»; un estado en el gatillo, «si se cumple en esas velas») o no encaja, con el motivo.
4. **No todo es secuencia.** El gatillo va por pasos. Dentro de un paso las señales se juntan en cualquier orden («todos», «al menos N» o «cualquiera», en N velas). Entre pasos: «después», «al tiempo o después» o «en cualquier orden».
5. **Condiciones con líneas:** el precio cruza o rebota en una EMA o en una línea del Alligator, dos líneas se cruzan, el precio está lejos de una línea, EMA ordenadas, Alligator despierto o dormido.
6. **Las zonas se eligen en el gráfico, con el mouse, sobre valores reales.** No hay lista de zonas. Un clic ofrece dos cosas:
   - «todas las de este tipo»: es una regla y se puede probar en el histórico;
   - «solo esta zona»: es una zona fija, para seguirla en vivo o en la simulación manual.
7. **Lado:** solo cortos, solo largos o los dos en espejo. Cada bloque se escribe a favor o en contra del trade.
8. **La estrategia se lee en una frase** que se arma sola.
9. **Se empieza en la simulación manual de App 1** (25/11), antes del backtesting global y de las alertas de compra.
10. **El propósito es «cocinar» estrategias nuevas** (25/11): en la simulación manual se diseñan las que después pasan al backtesting global. Es lo opuesto a traer reglas ya probadas. Por eso:
    - la central abre **en blanco**, y el usuario la va llenando a medida que ve el gráfico;
    - tiene que responder en tiempo casi real, para refinar hasta que la estrategia se comporte como él espera;
    - las reglas ya probadas se pueden abrir, pero no son el punto de partida.
11. **Todo se elige directamente sobre el gráfico** (25/11, tras probar el prototipo 3). Es lo que le gustó del prototipo 2: cada elemento está dibujado y se elige con un clic. Vale para las zonas, las marcas de los indicadores, las líneas y el volumen. La lista de «¿qué hay en esta vela?» queda como apoyo, no como el camino principal.
12. **Las zonas se ven como en el prototipo 2:** bandas con borde y etiqueta. Toda zona dibujada se puede elegir.
13. **Tiene que quedar claro si la estrategia entra donde él dijo** (25/11): en cada vela, si entra o no y por qué.
14. **La caja TP/SL y el VP fijo se colocan en el gráfico** y la estrategia los usa para el stop y el objetivo.
15. **En App 1, la cocina se ve como App 1** (26/11). El aspecto de los prototipos es solo de los prototipos: su gráfico es uno simplificado, hecho para decidir la mecánica. Al preguntar si así iba a quedar, el usuario dijo que le gusta más el de App 1, «más rico» y con gráficos «más agradables». Por eso:
    - el gráfico es el de la simulación manual, con sus velas, sus footprints, sus indicadores y el estilo elegido;
    - cada elemento se ve como lo dibuja su indicador, no como una marca de dos letras, y las zonas, como las dibuja el suyo (el punto 12 vale para los prototipos);
    - lo nuevo que se dibuja (dónde se cumple cada capa, la caja fantasma de la señal) usa las piezas que App 1 ya tiene: las filas bajo las velas del trade elegido y la caja TP/SL.

### La regla que la central tiene que poder decir

Ejemplo del usuario:

> El precio ha venido subiendo fuertemente durante un tiempo y se encuentra muy alejado de la EMA de ese marco. Se acerca a una zona de liquidación o resistencia y muestra una estrella fugaz. Luego aparece un exhaustion print, un esfuerzo sin resultado y una vela con buen volumen en la dirección contraria. Luego el precio se queda estático unas velas y aparece un stacked imbalance en una vela con un delta breakout a la baja. Ahí se entra, con el stop en el swing high anterior y el objetivo en el POC de un VP fijo dibujado antes.

De ahí salen seis cosas que el formulario de hoy no tiene:

| Qué pide la regla | Qué necesita la central |
|---|---|
| «Viene subiendo fuertemente» | Bloques de lo que venía pasando: avance en ATR en N velas |
| «Muy alejado de la EMA» | Distancia a una línea, en ATR |
| Una regla de giro | Sentido de cada bloque: a favor o en contra del trade |
| «Se queda estático unas velas» | Pausas: un estado que dura N velas |
| «Luego… luego…», con varias señales juntas | Pasos con grupos |
| «POC de un VP fijo dibujado antes» | Objetivo en un nivel dibujado por el usuario |

---

## 3. Principios

1. **Un solo motor.** El mismo código para el histórico, el gráfico, la simulación manual y el vivo: el del probador de App 1 (`rule_tester.py`). El Strategy Builder de App 8 y la pestaña Estrategia que se quitó de App 1 tenían motor propio y miraban el futuro.
2. **El corte.** `run()` hace dos cosas: hallar señales y simular trades. La simulación (llenados dentro de la vela, comisiones, minuto a minuto, motores 3 a 7) no se toca. Lo nuevo va en la mitad de las señales.
3. **Sin futuro.** Solo velas cerradas. Cada señal lleva la hora en que se conoce (`known`). Una capa de marco mayor se lee en su última vela cerrada.
4. **Lo compartido vive en App 1** y la suite lo importa, como el gráfico y los indicadores.
5. **Las fases y el conteo de variantes del probador se heredan.** Ver el histórico entero de una regla gasta sus fases 2 y 3.
6. **Lo que dibuja el usuario no se puede probar en el histórico global:** una zona fija o un VP fijo se dibujan sabiendo lo que pasó. Sirven en vivo y en la simulación manual, donde se dibujan sin futuro y valen desde ese momento.
7. **Cocinar es ajustar a lo que se ve.** Lo que valida una estrategia es el backtesting global, no la cocina.

---

## 4. Prototipos

Lienzo: https://claude.ai/artifact/9g6JfDANvRWKeP2XWEGDAL (privado del usuario).

- **Prototipo 1:** editor interactivo con tres capas, el momento de arrastrar y los tres tipos de bloque. Cifras de ejemplo.
- **Prototipo 2:** trae armada la regla del usuario. Cuatro pasos, la familia «Líneas y cruces», el lado, y un gráfico con 120 velas reales de BTC de 1 hora (20 al 25/11/2026, de Bybit) donde las zonas se eligen con un clic. Probado en el navegador el 25/11 a 321 px de ancho, con todo apilado: así se vería como panel lateral. A 1366 px lo vio el usuario.

- **Prototipo 3 (25/11, la cocina):** la simulación manual a 1366×768, con el panel lateral de 380 px de App 1 y «Cocina» como sexta pestaña. Abre en blanco. Trae:
  - reproducción vela a vela sobre 200 velas reales de BTC de 1 hora (17 al 25/11/2026; arranca el 21/11 a las 21:00 UTC);
  - «¿Qué hay en esta vela?» con un clic: los estados, eventos y zonas de esa vela, cada uno con cuántas velas a la vista lo cumplen y su botón para sumarlo;
  - zonas con un clic («todas» o «solo esta»);
  - los bloques con su cuenta, una fila por capa bajo las velas y el embudo, que dice dónde se queda la estrategia;
  - «Mis casos», los avisos con pausa, la caja fantasma con «Llevar al panel» y la orden simulada;
  - versiones, tres reglas para abrir como plantilla y «Pasar al backtesting global».

Las zonas, las líneas y las marcas de los prototipos 2 y 3 salen del código de App 1, solo leyendo: `smc.py` (order blocks y swings), `fvg_swing.py`, `vp_sessions.py` (valor del día anterior y el VP fijo sobre la subida, con volumen real), `liq_sweeps.py` (zonas de liquidaciones), `williams.py` (Alligator), `of_elements.detect(live=True)` y `rule_tester._pattern_events`.

**Lo que dio la regla del usuario en esas 120 velas,** con los valores de fábrica de cada detector:

| Pieza | Veces |
|---|---|
| Viene de subir 4 ATR en 24 velas | 9 velas |
| A más de 2 ATR sobre la EMA 50 | 3 velas |
| Estrella fugaz | 0 |
| Agotamiento en el extremo (bajista) | 7 |
| Esfuerzo sin resultado | 0 |
| Vela bajista con volumen alto | 17 |
| El precio se queda quieto (3 velas en 1 ATR) | 11 |
| Apilados de venta | 1 |
| Ruptura de delta a la baja | 6 |

Son cinco días de una moneda: no dice si la regla sirve. Sí muestra que, tal cual, pide varias cosas raras a la vez.

### Lo que dejó ver el prototipo 3

- **En la vela del techo** (23/11 a las 14:00) salen 8 estados, 7 eventos y 6 zonas. La cuenta de cada fila (por ejemplo, «a más de 2 ATR sobre la EMA 50: 3 de 96 velas») dice qué distingue ese momento.
- **Una estrategia cocinada ahí en un minuto** da 1 señal en 96 velas, en el techo: a más de 2 ATR sobre la EMA 50, cerca de una resistencia, y una vela bajista con volumen alto junto a una absorción en 5 velas. La regla del ejemplo del usuario se queda en el paso 1: la estrella fugaz no ocurre.
- **Decisiones que hubo que tomar,** y que valen para el motor:
  - el contexto y la zona se miran mientras se junta el paso 1, no en la vela de la entrada;
  - un patrón de vela cuenta en la vela en que se confirma, 2 velas después;
  - señales a menos de 4 velas una de otra cuentan una vez;
  - el clic en una vela es de la pestaña «Cocina»: con otra pestaña a la vista, el gráfico se usa como siempre;
  - la caja fantasma sale solo para una señal de 3 velas o menos.
- **Límites del prototipo:**
  - el motor es una versión simplificada dentro de la página, no el del probador;
  - los elementos de order flow, del VPA y de velas van con sus valores de fábrica;
  - no cuenta comisiones;
  - el VP fijo solo se dibuja sobre la subida;
  - las fechas son de la fase 3, porque son los datos recientes que había a mano.
- **Probado en el navegador el 25/11:** la reproducción, el clic en una vela, sumar bloques y una zona, el embudo, los casos, el aviso con pausa en la señal, «Llevar al panel» y la orden simulada. El diseño de 1366 px se revisó por partes, a tamaño real.
- **Fuentes:** `OrderFlowData/research/central_estrategias/2026-11-25/` (la página, su armado, el script de datos y las pruebas).

### La prueba del usuario con el prototipo 3 (25/11)

Dijo que fue fácil entender la app y elegir los elementos. Tres cosas no le salieron:
- no supo cómo colocar la caja TP/SL (la herramienta no hacía nada);
- no pudo pintar el VP fijo (solo se dibujaba solo, después del techo);
- no supo si la estrategia entró en el punto que él dijo.

**Lo que había armado** (solo largos) no entraba en ninguno de sus tres puntos (20/11 a las 15:00, 21/11 a las 06:00 y 21/11 a las 13:00):
- el contexto tenía «delta comprador» y «delta vendedor» a la vez: ninguna vela cumple los dos;
- otros estados eran del techo de la subida y no se cumplen en sus tres velas;
- lo que vio en velas distintas quedó en un solo paso, pedido junto en 5 velas.

Lectura, por confirmar con él: los tres puntos eran pasos de un escenario y la entrada era el último.

**Corregido en el prototipo 3** (versión 14 del lienzo):
- cada bloque va al paso de la vela de donde se tomó: velas pegadas, mismo paso; una vela posterior, paso nuevo con su distancia;
- el contexto y la zona se miran «cuando empieza el gatillo» o «en la señal»;
- un paso se completa cuando ocurre uno de sus eventos (un estado solo acompaña);
- «Tu estrategia en esta vela»: si entra o no, y cada condición con ✓ o ✗;
- una franja arriba del panel con las señales a la vista y si entra en sus casos; el contexto avisa si dos de sus bloques nunca se dan juntos;
- VP fijo con dos clics y caja TP/SL con tres, que se traduce a regla («stop en el swing anterior y objetivo a 2.5R»);
- «Aquí sí» pasó a llamarse «Aquí entraría».

Su estrategia, con cada cosa en el paso de su vela, entra el 21/11 a las 13:00 y también a las 08:00.

### Prototipo 4 (25/11): todo se elige sobre el gráfico

Tras la versión 14 dijo que el prototipo nuevo no le dejaba elegir nada distinto a las resistencias, que el formato del prototipo 2 era mejor y que lo que le gustaba de él era elegir cada elemento sobre el gráfico.

**La causa:** en el prototipo 3 las zonas iban pintadas tenues, sin borde, y las ya terminadas se dibujaban pero no respondían al clic. Solo las resistencias se veían como algo que se elige. Los eventos y los estados no estaban en el gráfico: salían en una lista al hacer clic en una vela.

**El prototipo 4** es la misma cocina (mismo motor y mismas tarjetas), con otro gráfico:
- **Zonas** como en el prototipo 2: bandas con borde y etiqueta. Toda zona dibujada se elige. Las más chicas quedan encima; donde se enciman varias, la tarjeta ofrece las otras. Las ya terminadas van ocultas, con su interruptor, y se eligen solo como tipo.
- **Marcas:** cada evento es una etiqueta de dos letras sobre su vela (bajistas arriba, alcistas abajo), como el triángulo con códigos de Elementos OF. El nombre sale al pasar el mouse. Un clic abre su tarjeta: qué es, cuántas veces ocurrió a la vista (sus marcas quedan resaltadas) y «Usar en el paso N» o «Usar en el contexto».
- **Líneas:** un clic sobre una EMA o una línea del Alligator ofrece sus estados y eventos en esa vela. Los cruces y rebotes van marcados sobre la línea.
- **Volumen:** una franja con el volumen de cada vela y el color de su delta. Un clic ofrece el delta, el CVD y el medidor VPA de esa vela.
- **Vela:** un clic fuera de todo eso muestra todo lo de esa vela y si la estrategia entra ahí.
- **Entradas de la estrategia:** una etiqueta negra y tres líneas finas (entrada, stop y objetivo). Las cajas de color del prototipo 3 tapaban el gráfico.
- **Interruptores:** zonas por tipo, marcas por familia, líneas y cuántas velas se ven.

**Decisiones que hubo que tomar:**
- a lo sumo 4 etiquetas por lado en cada vela; el resto va en «+N», que abre todo lo de esa vela. Primero las más raras;
- las marcas de order flow vienen apagadas: son 127 en 72 velas, contra 68 de velas y volumen;
- las letras piden unos 10 px por vela. El gráfico elige cuántas velas mostrar según el ancho (72 a 1366 px) y, si se piden más, las marcas pasan a ser puntos;
- al pasar de cortos a largos, cada bloque conserva su sentido (alcista o bajista). «Espejar los bloques» los cambia por su contrario;
- un clic a menos de 5 px de una línea elige la línea, no la vela.

**Lo que no cambió del prototipo 2:** su disposición en tres columnas (bloques, capas y gráfico). El 4 mantiene el gráfico grande a la izquierda y el panel a la derecha, como la simulación manual.

**Probado el 25/11:** la lógica sin navegador (tres series de pruebas y 24,000 acciones al azar, sin fallas). En el navegador, a 1366 px por partes y en un panel de 800 px: elegir una marca, una zona, la EMA 50, una barra de volumen y una vela; sumar al paso 1; el nombre al pasar el mouse; la estrategia ordenada con sus dos entradas; el VP fijo con dos clics y la caja TP/SL con tres.

**Sin probar:** la reproducción larga con todas las marcas encendidas, «Espejar los bloques» en pantalla (solo en las pruebas de lógica) y el uso real por el usuario. No hay arrastre: todo es con clics.

### La prueba del usuario con el prototipo 4 (26/11)

«Está bien. Tiene unos detalles menores pero en general funciona bien.» La distribución queda como está: con tres columnas, no. Lo que pidió, y lo que se hizo (versiones 19 y 20 del lienzo):

- **El gráfico vibraba** al pasar el mouse sobre una resistencia. El texto bajo el gráfico cambiaba de una línea a dos y movía el gráfico; la barra dejaba de estar bajo el mouse, el texto volvía y así seguía. Ahora ese texto tiene alto fijo.
- **El letrero de la señal** («Llevar al panel») tapaba la caja y no se podía quitar. Ahora nada va encima del gráfico: el aviso y el letrero de la señal van arriba del panel, cada uno con su ×. El aviso de lo que se está dibujando va bajo el gráfico.
- **No era claro qué es un «paso».** La capa del gatillo lo explica en una línea, y la tarjeta de cada elemento dice por qué va a ese paso.
- **«Una vela más»** le sirvió y pidió tenerlo en App 1: quedó hecho en la simulación manual (`TimeController.stepCandle`, 26/11).

**Visto en el navegador** (26/11, en un panel angosto de 327 px, con la pantalla en una sola columna):
- al pasar el mouse por una resistencia y por un soporte, el texto cambia y el gráfico queda en su sitio;
- una estrategia de un bloque dio su señal al reproducir: el aviso y el letrero salieron en el panel, «Llevar al panel» llenó el panel de trading, y cada × quitó lo suyo. La caja quedó a la vista en el gráfico, sin nada encima;
- la explicación de los pasos se lee en la capa del gatillo.

**Hallado al verlo y corregido (versión 20):** con el alto fijo, un texto de más líneas de las que caben salía cortado por arriba y por abajo. Pasaba en un panel angosto. Ahora el texto es más corto y se corta por líneas enteras: dos, o tres en una pantalla angosta.

En dos columnas se vio la pantalla quieta (el texto cabe en sus dos líneas y la explicación de los pasos está), pero el mouse y los clics solo se probaron en el panel angosto: es el mismo código.

**Para App 1,** de aquí sale una regla: ningún aviso de la cocina va encima de las velas, y nada que cambie al pasar el mouse puede mover el gráfico.

---

## 5. Etapas

### Etapa 1. La cocina: armar estrategias en la simulación manual de App 1

**Para qué.** Aquí se diseñan las estrategias nuevas que después pasan al backtesting global. El camino completo de una estrategia: se cocina en la simulación manual, se prueba a ciegas con el ayudante, se juzga en el backtesting global y, si pasa, da alertas en vivo.

**Cómo se usa:**
1. **Abre en blanco:** contexto, zona, gatillo, entrada, stop y objetivo, vacíos.
2. **Se llena desde el gráfico, eligiendo lo que se ve.** El usuario reproduce, pausa donde ve algo y lo suma:
   - un clic en una zona, una marca de un indicador, una línea o una barra de volumen ofrece «Usar en la estrategia», como hoy «Incluir en el análisis». Es el camino principal;
   - «¿Qué hay en esta vela?»: un clic en una vela lista todo lo que se cumple ahí (los eventos de esa vela, los estados vigentes y las zonas cercanas), cada uno con su botón;
   - lo de una misma vela va al mismo paso; lo de una vela posterior, a un paso después;
   - la paleta de bloques queda para buscar lo que no está a la vista.
3. **Responde enseguida.** Cada bloque que se suma o se cambia pinta dónde se cumple en lo ya recorrido y dice cuántas veces. La estrategia entera, igual, y además en qué paso se queda más veces. Nunca después de la hora simulada.
4. **«Mis casos».** El usuario marca velas «aquí entraría» y «aquí no». La cocina dice cuántos de sus casos atrapa la estrategia y cuántos avisos de más da, y en cada vela, si entra y por qué. Así se sabe si se comporta como él espera sin revisar todo a ojo tras cada cambio.
5. **Avisa al seguir reproduciendo.** La estrategia en borrador avisa en tres niveles: «escenario armado» (contexto y zona se cumplen), «a punto» (falta el último paso) y «señal». En la señal dibuja una caja fantasma con la entrada, el stop y el objetivo; «Llevar al panel» la vuelve una caja TP/SL normal. «Pausar al avisar» evita que a velocidad alta el aviso pase de largo. El usuario decide si abre la posición; el panel de trading, el Observador y el dashboard siguen igual.
6. **«Pasar al backtesting global».** La estrategia va al probador, donde se juzga con fases y controles. Lo que depende de un dibujo (zona fija, VP fijo) se cambia antes por su versión calculada, por ejemplo el POC del tramo anterior.
7. **«Abrir una regla ya probada»** existe, como plantilla. No es el punto de partida.
8. **Versiones.** Cada guardado suma una versión con su fecha, como las recetas de los setups, y se puede volver a una anterior si un ajuste la empeora.

**Cómo funciona:**
- el backend evalúa la estrategia con el motor del probador y devuelve cada cambio con la hora en que se conoce; la página lo muestra solo cuando la hora simulada pasa esa hora, y la vela en formación no cuenta;
- los bloques de velas, líneas y volumen responden al instante. Los de order flow tardan minutos la primera vez en cada tramo y después quedan guardados;
- cada aviso queda anotado, y la orden que el usuario abre tras un aviso queda unida a él en el Observador;
- lo que habría hecho la estrategia sola en cada señal se calcula y queda oculto hasta que la hora simulada pasa su salida.

**Antecedentes que ya existen:** los setups de order flow ya se dibujan durante la reproducción; «Incluir en el análisis» ya elige niveles con un clic en el gráfico; cada trade del probador ya guarda los elementos presentes en su ventana; la Revisión de candidatos ya mide «la regla propone y tú decides»; el Observador ya registra cada orden.

**En pasos:**

| Paso | Qué queda funcionando |
|---|---|
| 1.1 (hecho el 26/11) | La cocina en blanco con los bloques de velas, líneas y volumen; «¿Qué hay en esta vela?»; las marcas y la cuenta en lo recorrido; la frase; guardar con versiones. Entraron también los pasos y «¿entra aquí?» |
| 1.2 | Las zonas elegidas en el gráfico (también las dibujadas) y los bloques de order flow |
| 1.3 | «Mis casos»; los avisos al reproducir, con la caja fantasma y la pausa; la unión con el Observador |
| 1.4 | «Pasar al backtesting global» y «Abrir una regla ya probada» |

### El paso 1.1, construido (26/11)

Lo pidió el usuario: «Incluye esto y construye la cocina», tras pedir fichas con imágenes de cómo funcionan el contexto, los pasos y el gatillo, desplegables con un clic.

**Qué quedó en App 1:**
- la pestaña «Cocina» del panel derecho de la simulación manual, que abre en blanco;
- un clic en una vela lista lo que se cumple en ella, y cada cosa se suma al contexto o a un paso. Un clic sobre un nivel abre el menú de «Incluir en el análisis», que suma «Usar en la estrategia»;
- el contexto y el gatillo por pasos (hasta 4), con sus plazos. Los pasos estaban previstos para el 1.2 y entraron aquí: sin ellos las fichas y «paso 1» no tenían sentido;
- bajo las velas, una fila por capa pintada donde se cumple, un triángulo por señal y las EMA que miran los bloques;
- en la vela elegida, si la estrategia entra, si está a punto y qué falta;
- la frase, el buscador de bloques y el guardado por versiones;
- seis fichas con imagen: cómo se arma, cómo se llena, contexto, zona, gatillo y qué es un paso.

**Cómo quedó hecho,** frente a lo previsto:
- el motor está en el backend (`kitchen.py`) y arma cada evento con la función del probador de reglas: un solo motor de detección. La composición por capas y pasos es código nuevo de ese archivo, con el orden y los plazos del prototipo;
- la página manda las velas ya cerradas en la hora simulada. El motor no lee velas por su cuenta: así evalúa exactamente lo que el usuario ve y no puede mirar el futuro;
- lo recorrido son las últimas 1,000 velas cerradas del marco a la vista;
- cada elemento se elige por su vela, no por su marca: un clic en la vela lista todo lo de esa vela. Es una vuelta más que en el prototipo 4, y no obliga a tocar cada indicador;
- un bloque cuyo indicador está apagado no lo enciende: se ve en su fila bajo las velas. La ficha de cada bloque dice qué indicador lo dibuja.

**Lo que falta de la etapa 1:** las zonas y los bloques de order flow (1.2); «mis casos», los avisos al reproducir con su caja y la unión con el Observador (1.3); pasar la estrategia al backtesting global y abrir una regla ya probada (1.4). Para el 1.4, la composición por pasos tiene que alimentar el simulador del probador.

**Probado:** 16 pruebas del motor y 15 de la página. En pantalla, en una copia aislada con BTC desde el 01/01/2023: las fichas, una estrategia de dos pasos (7 señales en 15m, ninguna en 1h), el guardado, «Una vela más», el cambio de marco y de pestaña. No se vio la fecha oculta, el panel en ventana aparte ni los estilos oscuros.

**Lo que no hace:** no abre órdenes, no envía nada, no muestra resultados antes de tiempo.

### Etapa 2. Backtesting global de las mismas estrategias

La central como se pidió: trades por moneda, clic al gráfico, dashboard, fases y controles, con el mismo documento de estrategia y el mismo motor. Las estrategias con zonas fijas o niveles dibujados no entran: no se pueden probar ahí.

### Etapa 3. En el gráfico de la suite y en vivo

La estrategia como una capa del gráfico en vivo, en el principal o en una pestaña nueva. El registro en vivo de cualquier versión fijada, generalizando `rule_watch.py`. Avisos. Las alertas de confluencia pendientes entran aquí como modo «solo avisar». Nada se envía al bot.

### Etapa 4. Mejoras

Embudo en cada bloque, aporte por capa, depurador vela a vela, bloques propios, parecido entre estrategias, capa de mercado (BTC como contexto) y, al final, la señal en vivo que precarga la caja en el panel de trading.

---

## 6. Cómo se sabe si una estrategia cocinada sirve (propuesta)

Tres miradas, de menos a más confiable:

1. **En la cocina:** cuántos de «mis casos» atrapa y cuántos avisos de más da. Solo orienta: la estrategia se ajustó mirando esos mismos casos.
2. **A ciegas, con el ayudante:** sesiones con fecha oculta en otras fechas, con las cuentas de la Revisión de candidatos:
   - la estrategia sola: R por trade de todas las señales, como las opera ella;
   - lo que agrega elegir: las señales que el usuario tomó menos las que dejó, medidas igual;
   - el criterio completo: los trades del usuario menos la estrategia sola;
   - sin aviso: los trades que abrió sin un aviso cerca.
3. **El juez:** el backtesting global, por fases y contra los controles.

Reglas:
- cocinar y probar a ciegas en fechas de la fase 1 (hasta 2023), para que las fases 2 y 3 lleguen limpias. Si la simulación está en otra fecha, la cocina lo avisa;
- cada estrategia guarda en qué monedas y fechas se cocinó, y el backtesting global marca como ya vista la fase que esas fechas toquen;
- en la mirada 2, nada se lee con menos de 30 señales tomadas y 30 dejadas;
- opcional, avisos de control: una de cada cuatro señales no se muestra y queda anotada. Sirve para ver si el aviso cambia lo que el usuario hace.

---

## 7. Decisiones pendientes

1. ~~Si se construye el paso 1.1 en App 1~~: construido el 26/11. Sigue decidir con qué se continúa: el 1.2 (zonas y order flow) o el 1.3 (avisos al reproducir), una vez que el usuario lo pruebe en su App 1.
2. ~~Tres columnas como el prototipo 2~~: decidido el 26/11, no. Queda el gráfico grande y el panel a la derecha.
3. Qué marcas vienen encendidas, y si las de order flow se eligen por elemento, como en el modal de Elementos OF.
4. En App 1, las marcas son las que ya dibuja cada indicador encendido (decidido el 26/11, punto 15 de la sección 2). Hacerlas elegibles toca `MiniChart` y los indicadores, como «Incluir en el análisis». Queda por decidir cómo se ve un bloque cuyo indicador está apagado. Propuesta: la cocina lo enciende mientras el bloque esté en la estrategia, como hace el trade elegido del backtesting global con los indicadores de su regla. En el paso 1.1 no se hizo: el elemento se elige por su vela y se ve en su fila bajo las velas.
5. Fechas para cocinar: solo la fase 1, o libres con un aviso.
6. Las reglas de la sección 6, y si lleva avisos de control.
7. Fases en la central (etapa 2): como en App 1 o todo el histórico a la vista.
8. Marco mayor: solo la última vela cerrada, o también la vela en formación armada con lo ya ocurrido.

---

## 8. Lo que hay que cuidar

- **Sobreajuste:** una estrategia que atrapa todos «mis casos» puede ser puro ajuste, sobre todo con pocos. Los avisos de más y el backtesting global lo delatan.
- **Anclaje:** con los avisos encendidos el usuario mira donde le avisan. Los avisos de control lo miden.
- **Order flow:** solo en las monedas con almacén de trades, y la primera detección de un tramo tarda minutos.
- **Velocidad:** a 10000x un aviso dura décimas de segundo. Por eso la pausa.
- **Pantalla:** la simulación manual ya está llena. La cocina iría como pestaña del panel derecho, apilada, y el panel de trading vuelve con «Llevar al panel».
- **Marcas sobre el gráfico:** con todas las familias encendidas hay velas con 15 eventos. Hacen falta el tope por vela, los interruptores y el zoom; si no, el gráfico no se lee.
- **Lo dibujado tiene que responder al clic:** una zona que se ve y no se puede elegir confunde. Pasó en el prototipo 3 con las zonas ya terminadas.
- **`RuleTesterApp.jsx` es una sola pieza de casi 3,000 líneas:** reusar la lista de trades y el contexto del trade pide sacarlos de ahí.
