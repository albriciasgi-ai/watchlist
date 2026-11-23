# Revisión visual · R08 · ARBUSDT · 4h · fase 1 · Las salidas, de a una y en carrera (E-06 y E-07)

Entrada igual en las ocho: FVG nuevo ≥ 0.3 ATR, a mercado, stop 1.5 ATR. Cambia solo la salida. 117 señales en cada
una; una posición a la vez.

| | Salida | Corrida | Trades | R medio | Motivos | Revisión |
|---|---|---|---|---|---|---|
| R08a | ninguna (cierre a las 96 velas) | `…1f700f31a61d3880_1795310551` | 30 | +0.352 | 22 stop, 8 tiempo | **30 de 30 bien** |
| R08b | 3R y 12 velas | `…a00ff42c08b2d9e5_1795310553` | 74 | +0.053 | 32 stop, 7 objetivo, 35 tiempo | **74 de 74 bien** |
| R08c | trailing al swing de 5 velas | `…b34253e750a91e17_1795310555` | 46 | +0.090 | 26 stop, 20 arrastrado | **46 de 46 bien** |
| R08d | trailing al extremo de 3 velas | `…7cf6c4e0c74c955a_1795310557` | 79 | +0.023 | 6 stop, 73 arrastrado | **79 de 79 bien** |
| R08e | trailing a 3% del mejor precio desde 1R | `…ee752fbd1cf692fb_1795310559` | 65 | +0.112 | 33 stop, 32 arrastrado | **65 de 65 bien** |
| R08f | 3R y stop a la entrada en 1R | `…f686eb5477976388_1795310561` | 66 | +0.089 | 31 stop, 13 objetivo, 22 a la entrada | **66 de 66 bien** |
| R08g | señal contraria (y 96 velas) | `…a867379d6fe8b003_1795310563` | 40 | +0.311 | 19 stop, 18 señal contraria, 3 tiempo | **40 de 40 bien** |
| R08h | carrera: 3R, trailing 3 ATR desde 1R, entrada en 1.5R, 24 velas | `…a125c558c0afc387_1795310565` | 70 | +0.080 | 31 stop, 12 objetivo, 12 arrastrado, 6 a la entrada, 9 tiempo | **70 de 70 bien** |

Capturas: `evidencia/pantalla/R08a_ARBUSDT_f1/` a `R08h_ARBUSDT_f1/` (470).

- **La salida entera, recalculada aparte en cada trade** (`exitCheck`, en el ayudante): con las velas del gráfico, vela
  por vela desde la entrada, el stop vigente y el objetivo, y al cierre de cada vela la señal contraria (un FVG nuevo del
  otro lado, con su propio ATR de Wilder; sale en la apertura siguiente), el cierre por tiempo (la vela N, al cierre),
  el trailing (swing único de 5 velas por lado detrás del precio; extremo de 3 velas; 3% o 3 ATR del mejor precio desde
  su arranque) y el stop a la entrada (solo si el cierre ya está del lado bueno). En los 470 trades sale la misma vela,
  el mismo motivo y el mismo precio que dice el motor.
- **Diferencias de precio de 0.008% a 0.032%** (R08d trade 20; las salidas por señal contraria de R08g, que salen en
  una apertura): son las de H11, las velas oficiales del gráfico contra las armadas con los trades del almacén (la
  apertura o el máximo difieren en 0.0001 a 0.0003). La vela y el motivo coinciden.
- **Velas dudosas de salida** (tocan el stop vigente y el objetivo): una sola vela, la del 14/07/23 16:00 UTC, en R08b
  (#25, stop inicial), R08f (#24) y R08h (#26) (las dos con el stop ya a la entrada). Con los minutos del almacén el
  objetivo se tocó a las 16:04 y el stop a las 18:21 o 18:30: el motor sale por objetivo a las 16:04, bien
  (`minutos_salida2.py`, que toma el stop vigente del recorrido del stop del contexto del trade).
- **Cierre por tiempo:** sale al cierre de la vela N contada desde la entrada (R08a y R08g: 96; R08b: 12; R08h: 24),
  en el cierre de esa vela.
- **Sin ninguna salida (R08a):** el backend pone el cierre a las 96 velas, como dice la página; con solo la señal
  contraria (R08g), también.
- **La señal contraria (R08g):** en los 18 trades que salen por ella, la vela del FVG contrario y la apertura siguiente
  coinciden con las del motor.
- Una abierta al final de la fase en siete de las ocho (no cuenta, H6).
