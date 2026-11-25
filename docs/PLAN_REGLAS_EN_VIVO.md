# Reglas en vivo: Impulso, FVG nuevo y B1

Fijado el 24/11/2026, antes de registrar nada.

## Por qué

Con el motor 6 del probador, las tres pasaron cerca de la fase 2 sin pasarla (ver
`1.Altagracia_Crypto_Backtester/Backtester/CONSOLIDADO_ESTRATEGIAS.pdf`): ganan lo mismo que con la medición anterior,
pero una fase de 18 meses no da margen para confirmar una ventaja de +0.15 R. Su fase 3 nunca se miró. En lugar de
gastarla, el usuario pidió registrarlas en vivo: los datos que lleguen desde hoy no los vio nadie.

## Las reglas

Las exactas del registro del usuario y de la búsqueda B, sin cambiar nada. Marco de 4 horas, a mercado en la apertura de
la vela siguiente a la señal, una posición a la vez por moneda y regla, sin espera.

| Registro | Elementos y filtros | Stop | Salida |
|---|---|---|---|
| `impulso` | El cierre avanza 2 ATR o más en 3 velas, hacia donde va | 1.5 ATR, margen 0.1, máximo 6 | Objetivo 3R |
| `fvg` | FVG nuevo con hueco de 0.3 ATR o más | 1.5 ATR, margen 0.1, máximo 6 | Objetivo 3R |
| `b1` | FVG nuevo de 0.6 ATR y volumen alto, los dos en 2 velas. EMA 50 a favor con pendiente; sin confluencia OI-volumen en contra; sin ir con la multitud | 1 ATR, margen 0.1, máximo 8 | Objetivo 2R, trailing a 4 ATR desde 1R, cierre a las 96 velas |

- **Motor:** el del probador que esté en la carpeta (hoy, el 6), con sus valores de fábrica, incluido el tope de la
  comisión en 0.3 R. Es como se midieron el 24/11.
- **Costos:** comisión taker de 0.055% por lado, como el probador. Sin deslizamiento medido: estas reglas tienen stops
  de 1 a 1.5 ATR de 4 horas, y el deslizamiento pesa poco (medido en la ruptura con volumen: 0.00 a 0.04 R por trade).

## Las monedas

Las 50 del probador: las 7 de siempre y las 43 nuevas (`rule_tester.candle_symbols("all")`). Una moneda que Bybit deje de
dar queda con su error y no detiene a las demás.

## Los datos

- **Velas de 4 horas de Bybit,** pedidas al cierre de cada vela. Solo cuentan las cerradas. La primera vez se bajan
  unas 1,000 velas por moneda (166 días), para que el ATR, la EMA y el volumen por hora arranquen con historia.
- **Sin minuto a minuto:** una vela con el stop y el objetivo dentro sigue su recorrido supuesto, como en las 43 monedas
  nuevas del probador. En las 7 de siempre el probador usaba los minutos del almacén: es la única diferencia.
- **OI y funding** (solo B1): los archivos de App 1 (`OrderFlowData/oi` y `OrderFlowData/funding`), que el registro
  pone al día antes de evaluar. Si el dato de una moneda no llega al cierre de la vela, B1 de esa moneda espera: no se
  evalúa con un dato viejo. Una moneda sin serie de OI no da señales de B1, igual que en el probador.
- **Desde cuándo:** cada moneda arranca en el primer cierre de 4 horas que ve el registro. Las señales anteriores no
  cuentan, aunque sus velas sirvan para calentar.

## Lo que se anota

Por regla y moneda: la señal, la entrada, la salida con su R, las señales que no entran por tener una posición abierta y
las que no se operan. Lo anotado como final no se reescribe: si al repetir la regla una orden da otro resultado, queda
una revisión, una sola vez.

Si la suite estuvo cerrada, al abrirla se pone al día con las velas que faltan: las de Bybit están completas, así que el
registro queda igual que si hubiera estado abierta.

## El juicio

Con el R por trade de las 50 monedas juntas, y el margen al 95% con los trades agrupados por la semana de su salida
(como el motor 6: las monedas se mueven juntas).

- **A los 3 y a los 6 meses:** una regla se descarta si su margen queda entero bajo cero. Si no, sigue.
- **A los 12 meses:** pasa si su margen queda entero sobre cero. Si no, no pasa.

Cada regla se juzga sola. Son tres miradas a la vez sobre los mismos meses y casi las mismas señales: si pasa una sola,
vale menos que si pasan las tres.

Con unas 50 semanas en un año, el margen esperado ronda ±0.2 R: una ventaja real menor que esa no se va a poder
confirmar tampoco en vivo. El registro sirve para descartar con claridad, y para confirmar solo si la ventaja es grande.

## Lo que no hace

- No envía nada: ni al bot ni a otro lado.
- No cambia las reglas. Una versión distinta sería otro registro, con su propio plan.
- No mira la fase 3 del probador.
