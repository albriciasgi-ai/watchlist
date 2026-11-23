# Revisión visual · Etapa 6 · Prioridad 2, marcos y acciones

Corridas de prueba de la etapa (`backend/tests/audit/reglas_prueba.py`, `STAGE6`) con captura de cada trade, como en
las etapas 3 a 5. Ids en `evidencia/corridas_etapa6.log`; capturas en `evidencia/pantalla/E6_*`.

| Grupo | Dónde | Corridas |
|---|---|---|
| Elementos de velas: VPA (8), SMC (4), cambio de carácter (4h y 15m), canal gaussiano | BTC 4h f1 (CC15 en 15m) | 14 |
| Filtros sobre el FVG 0.3: Williams (13), SMC (2), medidor VPA (2), horario (2), medidas (3) | BTC 4h f1 | 26 |
| Order flow (29), perfil por sesión (4) y liquidaciones (2), más la VA con hueco | ARB 15m f1 | 36 |
| Marcos: FVG 0.3 a 3R en 5m, 30m, 1h y 1D | ARB f1 (y 1D también en BTC) | 5 |
| Acciones: Impulso en 1h y 4h | AAPL y SPY f1 | 4 |

El order flow, el perfil y las liquidaciones se capturan en ARB 15m porque en BTC 15m cada elemento da de 1,750 a
4,860 trades (unos 87,000 en total). En BTC 15m van sus invariantes (las 36 reglas bien) y los comprobadores
independientes de todos sus eventos.

## Cómo se revisó

- **Capa C, cada trade:** la cola de la página abre la corrida desde el Historial, elige cada trade como un clic del
  usuario, encuadra y guarda la captura con el texto del detalle y la tabla de la señal. Cada captura lleva su
  comprobación automática con las velas del gráfico: entrada contra la apertura, ningún toque antes de la salida, la
  vela de la salida toca su nivel y, si es dudosa, quién gana. Las reglas de 30m y 1D se miran en 15M y 4H, y la
  comprobación une las velas del gráfico por bloques de su marco (`ruleCandles` en `capa_bc.js`). En las acciones, la
  vela que empieza a las :30 cuenta como alineada.
- **Capa B:** lo que dice la pantalla de cada trade contra la corrida guardada, y la corrida repetida desde cero.
- **Hojas de contactos:** 16 capturas por hoja en 4h y 24 en 15m, revisadas por agentes aparte con un encargo común
  (`evidencia/etapa6/encargo_revision_hojas.md`; informes `revision_hojas_*.md`).
- Un trade con aviso, o cuya captura salió antes de que cargara la tabla de la señal, se volvió a capturar. Fueron
  lecturas incompletas de la página, no diferencias del motor. También se repitieron las capturas que quedaron sin su
  línea de comprobación cuando se cerró la sesión (las líneas se guardaban cada 2 minutos).
- Las últimas capturas se repartieron entre las pestañas con una lista común (`workInit` y `worker` en `capa_bc.js`),
  sin pasar de 3 corridas a la vez: el backend guarda solo 3 corridas repetidas para el contexto del trade, y con 6
  a la vez cada captura tardaba unos 13 s en vez de 2 (**O-30**).

## Resultado

85 corridas, 31,556 trades y 31,556 capturas, en 1,503 hojas de contactos. La capa B leyó en pantalla los 31,556 trades: todos iguales a su corrida guardada, y cada corrida repetida desde cero dio lo mismo. La comprobación automática deja 5 avisos, todos de **O-25**: un toque exacto del nivel que el motor no cuenta por el ruido de coma flotante. Son 2 trades de ARB 15m que aparecen en 5 reglas (el corto del 07/08/23 en E-PW #286 y E-RD #280, y el del 24/09/23 en E-RL #251, E-VI #607 y E-VL #288). Los revisores aparte vieron las hojas de los 31,556 trades (informes A1 a A10, B1 a B8, C1 a C6, D1 a D15, S1 y S2): ningún trade mal.

| Carpeta | Trades | Capturas | Avisos de la comprobación | Capa B (leídos · distintos · repetida) | Hojas |
|---|---|---|---|---|---|
| E6_E-AD_ARBUSDT_f1 | 542 | 542 | 0 | 542 de 542 · 0 · igual | 23 |
| E6_E-AP_ARBUSDT_f1 | 304 | 304 | 0 | 304 de 304 · 0 · igual | 13 |
| E6_E-BK_BTCUSDT_f1 | 34 | 34 | 0 | 34 de 34 · 0 · igual | 3 |
| E6_E-BR_ARBUSDT_f1 | 482 | 482 | 0 | 482 de 482 · 0 · igual | 21 |
| E6_E-BS_BTCUSDT_f1 | 56 | 56 | 0 | 56 de 56 · 0 · igual | 4 |
| E6_E-CC15_BTCUSDT_f1 | 79 | 79 | 0 | 79 de 79 · 0 · igual | 4 |
| E6_E-CC_BTCUSDT_f1 | 84 | 84 | 0 | 84 de 84 · 0 · igual | 6 |
| E6_E-DB_ARBUSDT_f1 | 526 | 526 | 0 | 526 de 526 · 0 · igual | 22 |
| E6_E-DD_ARBUSDT_f1 | 684 | 684 | 0 | 684 de 684 · 0 · igual | 29 |
| E6_E-DV_ARBUSDT_f1 | 462 | 462 | 0 | 462 de 462 · 0 · igual | 20 |
| E6_E-EQ_BTCUSDT_f1 | 43 | 43 | 0 | 43 de 43 · 0 · igual | 3 |
| E6_E-EX_ARBUSDT_f1 | 487 | 487 | 0 | 487 de 487 · 0 · igual | 21 |
| E6_E-GC_BTCUSDT_f1 | 222 | 222 | 0 | 222 de 222 · 0 · igual | 14 |
| E6_E-GR_ARBUSDT_f1 | 482 | 482 | 0 | 482 de 482 · 0 · igual | 21 |
| E6_E-IR_ARBUSDT_f1 | 757 | 757 | 0 | 757 de 757 · 0 · igual | 32 |
| E6_E-IV_ARBUSDT_f1 | 911 | 911 | 0 | 911 de 911 · 0 · igual | 38 |
| E6_E-LIQs_ARBUSDT_f1 | 587 | 587 | 0 | 587 de 587 · 0 · igual | 25 |
| E6_E-LIQz_ARBUSDT_f1 | 979 | 979 | 0 | 979 de 979 · 0 · igual | 41 |
| E6_E-OB_BTCUSDT_f1 | 56 | 56 | 0 | 56 de 56 · 0 · igual | 4 |
| E6_E-OG_ARBUSDT_f1 | 645 | 645 | 0 | 645 de 645 · 0 · igual | 27 |
| E6_E-OP_ARBUSDT_f1 | 735 | 735 | 0 | 735 de 735 · 0 · igual | 31 |
| E6_E-PD_ARBUSDT_f1 | 552 | 552 | 0 | 552 de 552 · 0 · igual | 23 |
| E6_E-PW_ARBUSDT_f1 | 668 | 668 | 1 (286) | 668 de 668 · 0 · igual | 28 |
| E6_E-QA_BTCUSDT_f1 | 73 | 73 | 0 | 73 de 73 · 0 · igual | 5 |
| E6_E-QC_BTCUSDT_f1 | 36 | 36 | 0 | 36 de 36 · 0 · igual | 3 |
| E6_E-QE_BTCUSDT_f1 | 138 | 138 | 0 | 138 de 138 · 0 · igual | 9 |
| E6_E-QF_BTCUSDT_f1 | 9 | 9 | 0 | 9 de 9 · 0 · igual | 1 |
| E6_E-QR_BTCUSDT_f1 | 40 | 40 | 0 | 40 de 40 · 0 · igual | 3 |
| E6_E-QS_BTCUSDT_f1 | 54 | 54 | 0 | 54 de 54 · 0 · igual | 4 |
| E6_E-QT_BTCUSDT_f1 | 165 | 165 | 0 | 165 de 165 · 0 · igual | 11 |
| E6_E-RD_ARBUSDT_f1 | 733 | 733 | 1 (280) | 733 de 733 · 0 · igual | 31 |
| E6_E-RL_ARBUSDT_f1 | 485 | 485 | 1 (251) | 485 de 485 · 0 · igual | 21 |
| E6_E-RS_ARBUSDT_f1 | 596 | 596 | 0 | 596 de 596 · 0 · igual | 25 |
| E6_E-RX_ARBUSDT_f1 | 773 | 773 | 0 | 773 de 773 · 0 · igual | 33 |
| E6_E-SL_ARBUSDT_f1 | 677 | 677 | 0 | 677 de 677 · 0 · igual | 29 |
| E6_E-SM_ARBUSDT_f1 | 654 | 654 | 0 | 654 de 654 · 0 · igual | 28 |
| E6_E-SQ_ARBUSDT_f1 | 640 | 640 | 0 | 640 de 640 · 0 · igual | 27 |
| E6_E-SW_ARBUSDT_f1 | 584 | 584 | 0 | 584 de 584 · 0 · igual | 25 |
| E6_E-TP_ARBUSDT_f1 | 891 | 891 | 0 | 891 de 891 · 0 · igual | 38 |
| E6_E-VA_ARBUSDT_f1 | 681 | 681 | 0 | 681 de 681 · 0 · igual | 29 |
| E6_E-VAg_ARBUSDT_f1 | 346 | 346 | 0 | 346 de 346 · 0 · igual | 15 |
| E6_E-VD_ARBUSDT_f1 | 560 | 560 | 0 | 560 de 560 · 0 · igual | 24 |
| E6_E-VE_ARBUSDT_f1 | 150 | 150 | 0 | 150 de 150 · 0 · igual | 7 |
| E6_E-VF_ARBUSDT_f1 | 605 | 605 | 0 | 605 de 605 · 0 · igual | 26 |
| E6_E-VI_ARBUSDT_f1 | 931 | 931 | 1 (607) | 931 de 931 · 0 · igual | 39 |
| E6_E-VL_ARBUSDT_f1 | 497 | 497 | 1 (288) | 497 de 497 · 0 · igual | 21 |
| E6_E-VR_ARBUSDT_f1 | 54 | 54 | 0 | 54 de 54 · 0 · igual | 3 |
| E6_E-VX_ARBUSDT_f1 | 288 | 288 | 0 | 288 de 288 · 0 · igual | 12 |
| E6_E-XD_ARBUSDT_f1 | 479 | 479 | 0 | 479 de 479 · 0 · igual | 20 |
| E6_E-ZP_ARBUSDT_f1 | 746 | 746 | 0 | 746 de 746 · 0 · igual | 32 |
| E6_FL-ACb_BTCUSDT_f1 | 232 | 232 | 0 | 232 de 232 · 0 · igual | 15 |
| E6_FL-ACc_BTCUSDT_f1 | 260 | 260 | 0 | 260 de 260 · 0 · igual | 17 |
| E6_FL-ACz_BTCUSDT_f1 | 237 | 237 | 0 | 237 de 237 · 0 · igual | 15 |
| E6_FL-ALLa_BTCUSDT_f1 | 134 | 134 | 0 | 134 de 134 · 0 · igual | 9 |
| E6_FL-ALLs_BTCUSDT_f1 | 262 | 262 | 0 | 262 de 262 · 0 · igual | 17 |
| E6_FL-ALLz_BTCUSDT_f1 | 160 | 160 | 0 | 160 de 160 · 0 · igual | 10 |
| E6_FL-AOb_BTCUSDT_f1 | 223 | 223 | 0 | 223 de 223 · 0 · igual | 14 |
| E6_FL-AOc_BTCUSDT_f1 | 256 | 256 | 0 | 256 de 256 · 0 · igual | 16 |
| E6_FL-AOz_BTCUSDT_f1 | 229 | 229 | 0 | 229 de 229 · 0 · igual | 15 |
| E6_FL-BIAS_BTCUSDT_f1 | 198 | 198 | 0 | 198 de 198 · 0 · igual | 13 |
| E6_FL-GTe_BTCUSDT_f1 | 101 | 101 | 0 | 101 de 101 · 0 · igual | 7 |
| E6_FL-GTo_BTCUSDT_f1 | 230 | 230 | 0 | 230 de 230 · 0 · igual | 15 |
| E6_FL-GTs_BTCUSDT_f1 | 124 | 124 | 0 | 124 de 124 · 0 · igual | 8 |
| E6_FL-HORA2_BTCUSDT_f1 | 148 | 148 | 0 | 148 de 148 · 0 · igual | 10 |
| E6_FL-HORA3_BTCUSDT_f1 | 234 | 234 | 0 | 234 de 234 · 0 · igual | 15 |
| E6_FL-MED2_BTCUSDT_f1 | 126 | 126 | 0 | 126 de 126 · 0 · igual | 8 |
| E6_FL-MED3_BTCUSDT_f1 | 201 | 201 | 0 | 201 de 201 · 0 · igual | 13 |
| E6_FL-MED_BTCUSDT_f1 | 118 | 118 | 0 | 118 de 118 · 0 · igual | 8 |
| E6_FL-MFIg_BTCUSDT_f1 | 31 | 31 | 0 | 31 de 31 · 0 · igual | 2 |
| E6_FL-MFIn_BTCUSDT_f1 | 238 | 238 | 0 | 238 de 238 · 0 · igual | 15 |
| E6_FL-MFIs_BTCUSDT_f1 | 122 | 122 | 0 | 122 de 122 · 0 · igual | 8 |
| E6_FL-MFIv_BTCUSDT_f1 | 134 | 134 | 0 | 134 de 134 · 0 · igual | 9 |
| E6_FL-PD_BTCUSDT_f1 | 120 | 120 | 0 | 120 de 120 · 0 · igual | 8 |
| E6_FL-VPAf_BTCUSDT_f1 | 13 | 13 | 0 | 13 de 13 · 0 · igual | 1 |
| E6_FL-VPAn_BTCUSDT_f1 | 261 | 261 | 0 | 261 de 261 · 0 · igual | 17 |
| E6_FL-ZONE_BTCUSDT_f1 | 253 | 253 | 0 | 253 de 253 · 0 · igual | 16 |
| E6_R34-240_AAPL_f1 | 147 | 147 | 0 | 147 de 147 · 0 · igual | 10 |
| E6_R34-240_SPY_f1 | 154 | 154 | 0 | 154 de 154 · 0 · igual | 10 |
| E6_R34-60_AAPL_f1 | 440 | 440 | 0 | 440 de 440 · 0 · igual | 28 |
| E6_R34-60_SPY_f1 | 468 | 468 | 0 | 468 de 468 · 0 · igual | 30 |
| E6_R35-1D_ARBUSDT_f1 | 12 | 12 | 0 | 12 de 12 · 0 · igual | 1 |
| E6_R35-1D_BTCUSDT_f1 | 48 | 48 | 0 | 48 de 48 · 0 · igual | 3 |
| E6_R35-30_ARBUSDT_f1 | 427 | 427 | 0 | 427 de 427 · 0 · igual | 18 |
| E6_R35-5_ARBUSDT_f1 | 2761 | 2761 | 0 | 2761 de 2761 · 0 · igual | 116 |
| E6_R35-60_ARBUSDT_f1 | 192 | 192 | 0 | 192 de 192 · 0 · igual | 12 |

## Lo que vieron los revisores

Ningún trade mal. Las dudas se cerraron con la comprobación automática o con la captura suelta:
- PD #79 y #80: la cruz de la salida no se ve en la captura; la comprobación dice que la vela de la salida toca el
  stop;
- RX #50: la captura salió antes de que cargara el cuadro de la señal (`ready: false`); se repitió;
- E-LIQz: 20 trades salen en el objetivo con R negativo y 76 stops pierden más de 2 R. No es un error del dibujo:
  el stop queda tan cerca (desde 0.023% del precio) que la comisión vale más que el objetivo. Va a **H18**.
- Lote C (informes C1 a C6: los elementos VPA y SMC de BTC 4h, el cambio de carácter, los filtros del Alligator, la
  zona, el horario y las medidas, y la regla diaria de BTC recapturada), 2,212 trades: 2,209 bien, 2 sin la salida a la
  vista y 1 duda, cerrada:
  - R35-1D BTC #1 y #26 duran meses (del 29/04/20 al 26/07/20, y hasta el 08/05/22) y el encuadre de 4H no llega a su
    salida; la comprobación automática sí la encontró en la vela que toca su nivel, y mirada aparte con el final del
    trade, la cruz está en el objetivo (+2.99 R los dos), fechada al comienzo del día (O-06);
  - E-OB #1: no se ve la zona del order block de la regla. Es el de la estructura mayor (8,640 a 8,826) y queda bajo
    el precio de la captura, que encuadra la entrada (10,203), el stop y el objetivo; se ven solo los order blocks
    internos del indicador;
  - E-BS y E-OB dan los mismos 56 trades: es **O-21** (a mercado, el order block entra en la ruptura que lo crea);
  - FL-MED y FL-MED3: las señales de antes de la tabla de medidas (en BTC, hasta el 21/10/21) dicen "no se cumplía
    todo", con la línea de medidas en gris, y el trade entró igual (confusión 23, **O-26**). La capa B las daba por
    buenas porque buscaba "se cumplía todo", que también está en "no se cumplía todo"; la herramienta ya lo distingue,
    y en todas las capturas de las etapas 3 a 6 esa frase solo aparece en esas 3 reglas (118 trades cada una);
  - observaciones de pantalla: en FL-HORA3 el día del filtro es el UTC y la fecha del cuadro la de Colombia (una
    señal del domingo por la tarde pasa porque en UTC ya es lunes), y el rótulo de FL-HORA2 no dice que las 04:00 UTC
    cuentan; en ALLs, un largo con la línea "despierto a la baja" puede parecer contradictorio aunque cumpla el filtro
    del cierre sobre los dientes; en QE el panel del medidor no sale en la captura.
- Lote D (informes D1 a D15: order flow, perfil por sesión y liquidaciones en ARB 15m, y R35 en 5m, 30m y 1D),
  14,183 trades con las 21 capturas repetidas: todos bien. La regla diaria de ARB, recapturada, ya muestra la salida
  de sus 12 trades. Casos que se miraron y cuadran: los 5 avisos de **O-25**; en VF, stops de −3 a −6 R con el stop a
  0.15 ATR y un objetivo a −0.00 R, y en LIQs un objetivo a −5.77 R a 0.028% de la entrada (**H18**). La etiqueta
  "1.5629" que sale en las capturas de fines de diciembre es el último precio del final de la fase (**O-17**).
- Lote S (informes S1 y S2: Impulso en AAPL y SPY, 1h y 4h), 1,209 trades: todos bien. Los stops de −3 a −10 R son
  salidas en la apertura tras un hueco entre sesiones, como manda la regla de acciones (**O-32**: el rótulo dice
  "stop inicial" y la cruz queda lejos de la línea del stop). Las capturas de AAPL 1h del #1 al #224 salieron en
  Oscuro y más pequeñas (la pestaña de entonces tenía ese estilo); se leen con la captura suelta. Los pares que
  parecían repetidos (#170 y #171, #294 y #295, #370 y #371) son trades distintos, cercanos en el tiempo. Un revisor
  corrió Python una vez para leer textos de trades, contra el encargo; no escribió nada.

Observaciones de la pantalla, ya anotadas: O-01 (la línea de la salida tapa la mecha), O-14 (el cuadro de la señal
tapa la salida y el nombre de la fila tapa sus casillas), O-17 (el último precio del final de la fase en el eje) y
las marcas de otros indicadores encendidos. Nuevas: **O-29**, **O-31** (el horario en UTC leído con la hora de
Colombia) y **O-32** (la salida por un hueco entre sesiones rotulada como stop inicial).
