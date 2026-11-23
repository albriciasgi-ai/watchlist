# Especificación del ciclo de un trade del probador de reglas (App 1)

Contrato para escribir un simulador **independiente** del probador (protocolo de pruebas, etapa 2). Describe qué hace el
probador con una señal ya conocida: cómo entra, dónde pone el stop y el objetivo, cómo recorre las velas, cuándo sale y
cuánto gana en R. No describe cómo se detectan los elementos ni los filtros: las señales llegan hechas.

Las convenciones marcadas **(convención)** son elecciones del probador que pueden discutirse; aquí se piden tal cual,
porque el objetivo es comprobar que el probador hace lo que dice, no rediseñarlo.

---

> **Motor 6 (22/11/2026, etapa 7 del protocolo):** lo que cambió va marcado **(motor 6)** en cada sección. Las
> corridas de motores anteriores no se reusan ni se cuentan.

## 1. Datos de entrada

- **(motor 6, H2)** Delante de las velas de la fase van las anteriores (las últimas 300 o 35 días, lo que sea más; en
  1D, todas): el ATR, los swings, las líneas, los filtros y los elementos de velas se calculan con ellas, pero ninguna
  señal ni entrada al azar cae en ellas. Los índices `k` de esta especificación cuentan desde la primera de esas velas.

- `tf`: minutos de cada vela de la regla (5, 15, 30, 60, 240 o 1440).
- `bars`: lista en orden de velas `{t, o, h, l, c, v}`. `t` es la **hora de apertura** en milisegundos UTC. Una vela
  cierra en `t + tf·60000`. Puede haber huecos (velas que faltan).
- `atr`: lista del mismo largo: el ATR de cada vela (ya calculado; no hay que calcularlo).
- `minutes_of(j)`: función que da los minutos negociados de la vela `j` en orden, como lista de `(t_ms, alto, bajo)`,
  o `None` / lista vacía si no hay minutos de esa vela.
- `signals`: lista de señales. Cada una:
  - `k`: índice de la vela con cuyo **cierre** se conoce la señal (la regla decide ahí);
  - `side`: lado del trade, `1` largo o `-1` corto;
  - `zone`: `[bajo, alto]` de la zona de los elementos que votaron, o `None`;
  - `i0`: índice de la primera vela que aportó un voto (para el stop "extremo de la vela del elemento");
  - `expiry`: velas de espera propias de una orden stop (solo para el tercer sabio de Williams), o `None`;
  - `sides`: con dos órdenes stop, los lados permitidos (`(1, -1)`, `(1,)` o `(-1,)`); si no, `(side,)`;
  - `id`: identificador.
- `opposite`: `{1: conjunto, -1: conjunto}`. `opposite[s]` son los índices de vela en que se conoce una señal **de
  lado s**. Un trade de lado `side` sale por señal contraria cuando su vela `j` está en `opposite[-side]`.
- `exit_at`: `{1: conjunto, -1: conjunto}`: velas en que el canal manda salir a un trade de ese lado (salida del canal
  gaussiano), o `None`.
- `vpa_exit`: `{1: {j: motivo}, -1: {j: motivo}}`: velas en que la salida VPA manda salir a un trade de ese lado, o `None`.
- `chain_on(k, side)`: función que dice si los flujos on-chain van a favor en la vela de la señal (objetivo mixto).
- `level_target(signal)`: precio del objetivo de nivel (POC, borde, centro o rango SMC) si la regla lo usa, o `None`.
- `rule`: la regla, con este formato:

```
entry: {type: "market" | "limit" | "stop" | "straddle",
        at: "near" | "mid" | "far"          (limit)
        expiry: N                            (limit, stop y straddle: velas que espera la orden)
        offset: x                            (stop y straddle: ATR)
        from: "close" | "zone"               (straddle; y stop si lo trae)
        cancel: true | false}                (stop)
stop:  {type: "atr" | "zone" | "swing" | "candle", atr: x, bars: N, buffer: x, minAtr: x, maxAtr: x}
exit:  {targetR: x | null, horizon: N | null, opposite: bool,
        trail: "none" | "swing" | "bars" | "atr" | "pct", trailBars: N, trailAtr: x, trailPct: x, trailStart: x,
        breakEven: x | ausente,
        tpTrail: {start: x, dist: x, unit: "r" | "atr" | "pct"} | ausente,
        chainTarget: {r: x, ...} | ausente,
        vpa: {fromR: x, ...} | ausente}
oneAtATime: bool, cooldown: N
targetAt: presente si el objetivo es de nivel (entonces targetR es null)
```

- Comisiones: `taker` 0.00055 y `maker` 0.0002 (en acciones, 0.0002 las dos).
- `gap_ms`: un salto entre dos velas seguidas mayor que esto es un hueco de datos. Por defecto `max(6 h, 2·tf)`; en
  acciones, 5 días.

## 2. Salida

Por cada señal, una de tres cosas:
- `{"id", "skip": motivo}`: la orden no entró;
- `{"id", "open": true, ...}`: entró pero la fase terminó antes de su salida (no cuenta como trade);
- el trade: `{"id", "k", "side", "entry_i", "entry", "entry_t", "order", "stop", "target", "risk", "stop_atr",
  "exit_i", "exit", "exit_t", "reason", "gross", "r", "mfe", "mae", "bars", "reach"}`.

Después, la **selección** (sección 9) dice qué trades quedan, en qué orden y por qué se saltaron los demás.

Si no existe la vela `k + 1`, o el salto entre `k` y `k + 1` es un hueco de datos, la señal no da nada
(`"sin vela siguiente"`).

## 3. Entrada

### 3.1 A mercado

- Entra en la **apertura de la vela siguiente**: `entry_i = k + 1`, `entry = o[k+1]`, comisión de entrada `taker`.
- `order = "market"`.

### 3.2 Limit (`type = "limit"`)

- Sin zona (`zone = None`): entra a mercado (3.1).
- Precio de la limit, con `s = 1` (near), `0.5` (mid) o `0` (far):
  - largo: `zona_baja + s·(zona_alta − zona_baja)` (near es el borde alto, el más cercano al precio);
  - corto: `zona_alta − s·(zona_alta − zona_baja)`.
- Si la apertura de `k + 1` ya está del lado bueno o en el precio (`(o[k+1] − precio)·side ≤ 0`), entra a mercado (3.1).
- Si no, recorre las velas `j = k+1 … k+expiry` (las `expiry` primeras, incluida `k+1`). Se llena en la **primera vela
  que cruza** el precio, sin bastar con tocarlo: largo `l[j] < precio`, corto `h[j] > precio`.
  - Precio de llenado: el de la limit **(convención: también si la vela abrió más allá)**.
  - `entry_i = j`, comisión de entrada `maker`, `order = "limit"`.
- Si no se llena en esas velas: `skip = "limit sin llenar"`.

### 3.3 Orden stop a favor (`type = "stop"`)

- Nivel:
  - con zona y sin `from = "close"`: el borde de la zona a favor más el margen: largo `zona_alta + offset·atr[k]`,
    corto `zona_baja − offset·atr[k]`;
  - sin zona o con `from = "close"`: `c[k] + side·offset·atr[k]`.
- Cancelación: solo con zona, `cancel = true` y `zona_alta > zona_baja`. Nivel de cancelación: el otro borde
  (largo `zona_baja`, corto `zona_alta`). Se cancela si el precio lo **pasa** (largo `l < cancelación`, corto `h >`)
  antes de llenarse.
- Espera: `signal.expiry` si viene (**motor 6:** también 0, que es no esperar), si no `rule.entry.expiry` velas, desde
  `k + 1`.
- **(motor 6, F-06)** La del 3.er sabio existe desde la vela en que se supo el fractal, se rompa o no después: espera
  hasta que el precio lo pasa, llega otro fractal del mismo lado o se acaban las velas, y se cancela si lo pasa del lado
  equivocado de los dientes. Se llena al **pasar** el fractal (largo `h[j] > nivel`), no al tocarlo, como en el libro (un
  tick por encima).
- En cada vela `j`:
  - toca = largo `h[j] ≥ nivel`, corto `l[j] ≤ nivel` (el 3.er sabio, al pasarlo);
  - pasa la cancelación = como arriba;
  - si no toca y pasa la cancelación: cancelada;
  - si no toca: sigue;
  - si toca y también pasa la cancelación: decide el **primer minuto** de la vela en que pasa alguna de las dos
    (con `minutes_of`, o el recorrido supuesto de 4.1 si no hay minutos); si en ese minuto pasan las dos, gana la que
    esté más cerca de la apertura de la vela (`|nivel − o[j]|` contra `|o[j] − cancelación|`, empate a favor del
    llenado). Si gana la cancelación: cancelada;
  - si se llena: precio = el nivel, o `o[j]` si la vela abrió más allá del nivel (largo `o[j] > nivel`).
- Sin llenar al terminar la espera, o cancelada: `skip = "orden stop sin llenar"`.
- `order = "stop"`, comisión de entrada `taker`.

### 3.4 Dos órdenes stop (`type = "straddle"`)

- Niveles: `arriba = c[k] + offset·atr[k]` y `abajo = c[k] − offset·atr[k]` con `from = "close"`; con
  `from = "zone"` y zona: `zona_alta + offset·atr[k]` y `zona_baja − offset·atr[k]`.
- Solo se ponen las de los lados de `signal.sides`.
- En cada vela `j = k+1 … k+expiry` (las `expiry` primeras): tocan las que cumplan `h[j] ≥ arriba` (largo) o
  `l[j] ≤ abajo` (corto).
  - Si tocan las dos: el primer minuto en que alguna toca decide; si en ese minuto tocan las dos, o no hay minutos que
    lo digan, gana la más cercana a la apertura de la vela (`|arriba − o[j]| ≤ |o[j] − abajo|` → largo).
  - **Nota (21/11, etapa 2, E-05):** el motor y la documentación de App 1 dicen otra cosa cuando no hay minutos: decide
    el recorrido supuesto de la vela (sección 4.1: primero el extremo más cerca de la apertura; si empatan, el mínimo), y
    la cercanía queda solo para un mismo minuto que toca las dos. El oráculo B se escribió con el texto de arriba.
  - El lado del trade es el de la que se llenó; el precio, su nivel o `o[j]` si abrió más allá.
- Sin llenar: `skip = "ninguna orden stop se llenó"`. `order = "stop"`, comisión `taker`.

## 4. Stop, objetivo y filtros del stop

Todo con lo conocido al cierre de `k`, y con `entry` = el precio de entrada ya decidido.

- `atr`: `stop = entry − side·rule.stop.atr·atr[k]`.
- `zone` con zona: largo `zona_baja − buffer·atr[k]`, corto `zona_alta + buffer·atr[k]`. Sin zona: como `candle`.
- `candle`: largo `mín(l[i0 … k]) − buffer·atr[k]`, corto `máx(h[i0 … k]) + buffer·atr[k]` (`i0` se recorta a `[0, k]`).
  **(motor 6, H16)** En un FVG, `i0` es la primera de sus tres velas (antes, la tercera, la que lo da a conocer).
- `swing` con `N = rule.stop.bars`:
  - una vela `p` es pivote si su mínimo (largo; máximo en un corto) es el **único** extremo de la ventana
    `[p − N, p + N]` (si otra vela empata, no es pivote);
  - se busca hacia atrás desde `p = k − N` (el pivote más reciente ya confirmado), hasta 200 velas antes;
  - si el pivote queda detrás de la entrada (`(entry − valor)·side > 0`), el stop es `valor − side·buffer·atr[k]`;
  - si no, se sigue buscando desde `p − 1`, hasta revisar 6 pivotes;
  - sin pivote útil: largo `mín(l[máx(0, k − 4N) … k]) − buffer·atr[k]`, corto `máx(h[…]) + buffer·atr[k]`.
- **(motor 6, O-25)** El stop, el objetivo, el precio de la limit, el de las órdenes stop, el stop arrastrado y el
  objetivo arrastrado se redondean a 10 decimales: quita el ruido de coma flotante sin mover ningún precio real.
- `risk = (entry − stop)·side`. Si `risk ≤ 0`: `skip = "stop del lado equivocado"`.
- `stop_atr = risk / atr[k]` (0 si `atr[k]` no es positivo), **(motor 6, O-10)** redondeado a 9 decimales. Si
  `stop_atr < minAtr`: `skip = "stop muy corto"`; si `stop_atr > maxAtr`: `skip = "stop muy largo"`. Los topes
  descartan la señal; no recortan el stop.
- **(motor 6, H18)** Con `cap = rule.maxFeeR` (0.3 si la regla no lo trae; 0 lo apaga): si
  `cap > 0` y `(comisión_entrada + taker)·entry / risk > cap`: `skip = "comisión muy alta para el riesgo"`.
- Objetivo:
  - con `targetR`: `R = chainTarget.r` si la regla trae `chainTarget` y `chain_on(k, side)`, si no `targetR`;
    `target = entry + side·risk·R`;
  - con objetivo de nivel: `target = level_target(signal)`; si `(target − entry)·side < 0.3·risk`: `skip` (objetivo
    muy cerca o ya pasado);
  - sin objetivo: `target = None`.

### 4.1 Recorrido supuesto de una vela sin minutos

Cuatro puntos en orden: apertura, el extremo **más cercano a la apertura**, el otro extremo y el cierre. Si
`h − o < o − l` el máximo va primero (`o, h, l, c`); si no, el mínimo (`o, l, h, c`). Cada punto es un "minuto" con
alto = bajo = ese precio.

Si una vela tiene minutos pero ninguno muestra el toque que sí muestran el máximo o el mínimo de la vela
**(convención)**, se tratan como lo que dicen los minutos.

## 5. Recorrido de las velas

Desde `j = entry_i` hasta la última vela. En cada vela, en este orden:

1. **Hueco:** si `j > entry_i` y `t[j] − t[j−1] > gap_ms`: sale en `c[j−1]`, a la hora `t[j−1] + tf`, motivo
   `"hueco de datos"`.
2. **Toques dentro de la vela** (sin objetivo arrastrado; ver 6 para él):
   - `toca_stop` = largo `l[j] ≤ stop`, corto `h[j] ≥ stop`;
   - `toca_obj` = hay objetivo y largo `h[j] ≥ objetivo`, corto `l[j] ≤ objetivo`;
   - `vela_del_llenado` = `j = entry_i` y la entrada fue una limit llenada en el recorrido de 3.2, o una orden stop
     (o dos órdenes) llenada en su nivel. Una orden stop llenada **en la apertura** (la vela abrió más allá) no cuenta
     como vela del llenado: no hubo precios antes de entrar;
   - si `toca_stop` y (`toca_obj` o `vela_del_llenado`): se mira **minuto a minuto** (o con el recorrido supuesto):
     - en la vela del llenado, primero se busca el minuto del llenado: limit largo, el primer minuto con `bajo < entry`
       (corto `alto > entry`); orden stop largo, `alto ≥ entry` (corto `bajo ≤ entry`). Antes de ese minuto no cuenta
       nada. **En el minuto del llenado solo cuenta el stop** (si su bajo llega al stop en un largo: sale por stop);
     - después, el primer minuto en que se toca el stop o el objetivo decide; **si se tocan los dos en el mismo minuto,
       cuenta el stop**;
     - si ningún minuto toca nada, la vela no cierra el trade;
   - si no toca el stop pero toca el objetivo en la vela del llenado: **no cuenta ese objetivo; se deja para la vela
     siguiente (convención)**;
   - **salida por stop:** precio = el stop, o `o[j]` si la vela abrió más allá del stop (salvo en la vela del llenado);
     motivo `"stop"` si el stop es el inicial, `"stop en la entrada"` si es igual a la entrada, si no `"stop arrastrado"`;
   - **salida por objetivo:** precio = el objetivo (**convención: también si la vela abrió más allá**), motivo
     `"objetivo"`;
   - **hora de la salida (convención):** la del minuto que decidió, si se miró minuto a minuto; si no, la hora de
     apertura de la vela (`t[j]`).
3. Si no salió: `mfe = máx(mfe, (h[j] − entry)·side/risk)` en un largo (en un corto con `l[j]`) y
   `mae = mín(mae, (l[j] − entry)·side/risk)` (corto con `h[j]`). **Incluye la vela del llenado entera (convención).**
4. **Al cierre de la vela** (solo si `j > k` y existe `j + 1`, salvo el tiempo):
   1. señal contraria: si `rule.exit.opposite` y `j` está en `opposite[-side]`: sale en `o[j+1]`, hora `t[j+1]`,
      motivo `"señal contraria"`;
   2. canal: si `j` está en `exit_at[side]`: sale en `o[j+1]`, motivo `"sale del canal"`;
   3. VPA: si `j` está en `vpa_exit[side]` y `mfe ≥ rule.exit.vpa.fromR`: sale en `o[j+1]` con ese motivo;
   4. tiempo: si `horizon` y `j − entry_i + 1 ≥ horizon`: sale en `c[j]`, hora `t[j] + tf`, motivo `"tiempo"`;
   5. trailing (el stop solo se acerca, y solo si el cierre queda del lado bueno del nivel nuevo:
      `(c[j] − nivel)·side > 0` y `(nivel − stop)·side > 0`):
      - `swing` con `m = trailBars`: `p = j − m`; si `p − m ≥ 0` y `p > k` y el mínimo de `p` (largo; máximo en un
        corto) es el único extremo de `[p − m, j]`: `nivel = valor − side·buffer·atr[j]`;
      - `bars` con `m = trailBars`: `nivel = mín(l[j−m+1 … j]) − side·buffer·atr[j]` (corto `máx(h)` y `+`);
      - `atr` y `pct`, solo si `mfe ≥ trailStart` (0 si no viene): `mejor = entry + side·mfe·risk`;
        `nivel = mejor − side·(trailAtr·atr[j])` o `mejor − side·(mejor·trailPct/100)`;
   6. stop a la entrada: si `breakEven` y `mfe ≥ breakEven` y el stop sigue detrás de la entrada
      (`(entry − stop)·side > 0`) y el cierre está del lado bueno (`(c[j] − entry)·side > 0`): `stop = entry`.
5. Si se acaban las velas sin salir: `open = true`.

El stop que se mueve en el paso 4 vale desde la vela siguiente.

## 6. Objetivo arrastrado (`exit.tpTrail`)

Con `tpTrail` el objetivo fijo **nunca** cierra el trade:
- arranque: `entry + side·start·risk` (`start` ya viene recortado al objetivo);
- distancia: `dist·risk` (unidad `r`), `dist·atr[k]` (`atr`, fija desde la señal) o `dist%` del mejor precio (`pct`);
- desde la vela en que el precio llega al arranque, se mira **minuto a minuto** (o con el recorrido supuesto) toda
  vela: en cada minuto, primero si el precio toca el nivel más cercano entre el stop vigente y el objetivo arrastrado
  (el que esté más cerca del precio a favor: el mayor en un largo); sale ahí, o en la apertura de la vela si abrió más
  allá (salvo en la vela del llenado); después, si el mejor precio sube el objetivo arrastrado
  (`mejor − side·distancia`; solo se acerca). Motivo `"objetivo arrastrado"` si sale en él;
- en el minuto del llenado de una limit o una orden stop solo cuenta el stop;
- el trade guarda `tp_on`: la hora de la vela en que se activó, o `None`.

## 7. Resultado en R

- `gross = (exit − entry)·side / risk`.
- `cost = (comisión_entrada·entry + taker·exit) / risk`. La salida siempre paga `taker`.
- `r = gross − cost`, redondeado a 4 decimales.
- **(motor 6, B-05 y B-06)** Cada trade cerrado lleva además:
  - `slip`: lo que costaría 0.01% de deslizamiento por lado en los llenados a mercado (la entrada a mercado o con orden
    stop, y toda salida menos el objetivo fijo): `(entry si a mercado + exit si no es "objetivo")·0.0001 / risk`;
  - `funding`: `−side · Σ tasas de las liquidaciones en (entry_t, exit_t] · entry / risk` (las acciones, 0).

  Si la regla trae `slippage` (% por lado), `r −= slippage / 0.01 · slip`; si trae `funding`, `r += funding`. Lo mismo
  en los trades al azar.
- `bars = exit_i − entry_i + 1`.
- En la salida por stop, `mae = mín(mae, (exit − entry)·side/risk)`; por objetivo, `mfe = máx(mfe, (objetivo − entry)·side/risk)`.

- **(motor 6, H4)** En la vela del llenado de una limit u orden stop, `mfe` y `mae` salen solo de los precios desde el
  llenado: con minutos, desde el minuto del llenado; sin ellos, desde el punto del recorrido supuesto en que cruzó la
  entrada. Antes contaban toda la vela, también lo de antes de entrar.
- **(E-01)** En la vela en que sale el objetivo arrastrado, `mfe` cuenta el mejor precio dentro de la vela hasta el
  minuto de la salida.
- **(E-04)** Con la señal contraria, la salida VPA y la salida por el canal, el trade sale en la apertura de la vela
  siguiente a la que avisa; `exit_i` es la que avisa y `bars` cuenta hasta ella (las velas en que estuvo abierto).

## 8. Hasta dónde llegó (`reach`)

Lo máximo a favor en R antes de tocar el **stop inicial**, en las 300 velas desde la entrada (desde la siguiente si la
entrada fue limit u orden stop), sin importar la salida elegida. Se corta en un hueco de datos o al tocar el stop
inicial. Si no se llega a cortar y no hay 300 velas, `reach = None`.

## 9. Selección de las señales

- Las señales se procesan en orden de `k`.
- **(motor 6, H2)** Una señal con `k` en las velas de antes de la fase no cuenta ni se simula.
- **A mercado, con una posición a la vez (convención):** una señal se salta si `k < exit_i` del último trade tomado
  (`"posición abierta"`) o, con `cooldown > 0` y tras un trade tomado, si `k ≤ exit_i + cooldown` (`"enfriamiento"`).
  Una que queda abierta al final de la fase ocupa todo lo que sigue.
  - **(motor 6, H15)** La señal de la vela de la salida (`k = exit_i`) ya puede entrar: se decide al cerrar esa vela,
    cuando el trade ya salió. Antes se saltaba (`k ≤ exit_i`).
  - **(motor 6, F-01)** Sin ningún trade tomado no hay enfriamiento. Antes empezaba activo al comienzo de la fase.
  - **(motor 6, H19)** Una vela con una señal larga y otra corta no da ninguna (`"señales opuestas en la misma vela"`).
- **Con limit, orden stop o dos órdenes, con una posición a la vez:** se simulan todas, se ordenan por
  `(entry_i, k)` y se toman en ese orden: se salta la que se llena con `entry_i < exit_i` del último tomado, o en la
  misma vela (`entry_i = exit_i`) si no se llenó después del momento de la salida; y con `cooldown > 0`, la que se
  llena con `entry_i ≤ exit_i + cooldown`.
  - **(motor 6, H15)** El momento de la salida dentro de su vela: una salida al cierre o en la apertura siguiente va
    después de todo lo de la vela; una en un nivel (stop, objetivo u objetivo arrastrado), el primer momento en que el
    precio lo toca (con minutos, su minuto; sin ellos, el tramo del recorrido supuesto y la parte del tramo), y si el
    trade entró en esa misma vela, desde su llenado. En el mismo minuto, o el mismo punto, no se sabe cuál fue antes y
    no entra.
  - **Desde el motor 5 (21/11, F-04):** dentro de la misma `entry_i` van por cuándo se llenó cada orden: con minutos, el
    primer minuto que la llena (limit al cruzar, orden stop al tocar; en la apertura si la vela abrió más allá); sin
    minutos, el tramo del recorrido supuesto (4.1) en que el precio llega a ella y, dentro del tramo, su distancia desde
    el comienzo. Solo si empatan (el mismo minuto, o el mismo punto), va primero la de menor `k`.
- **Sin una posición a la vez:** todas las que entran son trades.
- Con dos órdenes, una misma vela `k` pone sus órdenes una sola vez, y **(motor 6, F-05)** cuenta como una señal.
- **(E-03)** Tras una coincidencia de la receta en la vela `i`, no hay otra del mismo lado en las `ventana − 1` velas
  siguientes.
- Los trades se numeran desde 1 en el orden en que quedaron.
