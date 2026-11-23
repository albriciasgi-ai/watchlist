# Revisión visual · R13 · ARBUSDT · fase 1 · Objetivos de nivel (E-06): perfil por sesión, caja y rango SMC

| | Regla | Corrida | Trades | R medio | Motivos | Revisión |
|---|---|---|---|---|---|---|
| R13a | 15m · regreso al valor (VR), sesiones de 1 día, stop tras el extremo (+0.1 ATR), objetivo en el borde contrario | `ARBUSDT_15_f1_1b441b56456fe0f9_1795310620` | 54 | −0.274 | 35 stop, 19 objetivo | **54 de 54 bien** |
| R13b | 15m · fallo fuera del valor (VF), sesiones de 1 día, stop tras el extremo (+0.1 ATR), objetivo en el POC | `ARBUSDT_15_f1_11505cf0ee40dbcb_1795310626` | 605 | −0.471 | 402 stop, 203 objetivo | **605 de 605 bien** |
| R13e | 1h · fallo fuera del valor (VF) con **sesiones semanales** (desde el lunes), al POC | `ARBUSDT_60_f1_f27aa916dd40da7b_1795317152` | 124 | −0.315 | 93 stop, 31 objetivo | **124 de 124 bien** |
| R13c | 4h · borde de caja (BE), stop tras el borde (+0.1 ATR), objetivo en el centro de la caja | `ARBUSDT_240_f1_096f262bc7b47f0a_1795310592` | 15 | +0.089 | 4 stop, 11 objetivo | **15 de 15 bien** |
| R13d | 4h · order block (OB) de la estructura mayor, a mercado, stop 1.5 ATR, objetivo en el extremo débil del rango SMC | `ARBUSDT_240_f1_b053babc6b68172e_1795310594` | 9 | +0.206 | 2 stop, 7 objetivo | **9 de 9 bien** |

## R13c y R13d, contra las implementaciones del navegador

`tests/audit/smc_box_check.py` y `.mjs` (`evidencia/capa_a/smc_box_R13cd_ARBUSDT_f1.log`), con las velas del motor:

- **Order block (R13d):** `computeSmc` de `smcStructure.js` (la del indicador) da 12 order blocks de la estructura
  mayor en la fase; la corrida dice 12 señales. Los 9 trades tienen la zona del OB, el objetivo en el mínimo (corto) o
  máximo (largo) del rango mayor en la vela de la señal y el stop a 1.5 ATR iguales. Los 3 OB sin trade (28/09,
  26/10 y 12/12/23, largos) son los 3 descartados por "objetivo del rango muy cerca o ya pasado". Con entrada a
  mercado el OB entra en la ruptura que lo crea, no en el regreso (así lo dice la documentación: "nace con la
  ruptura"; con limit espera el regreso).
- **Caja (R13c):** `erBox` de `regimeDetectors.js` con los parámetros afinados del detector (n 20, eficiencia bajo
  0.2, margen 0.5 ATR, salida con eficiencia 0.5) da las 15 cajas de los trades (inicio, detección, mínimo y máximo).
  La zona del borde es la franja del 20% de la caja de su lado, la vela de la señal llega a ella, el objetivo es el
  centro de la caja y el stop el borde lejano más 0.1 ATR, en los 15. La regla de la llegada (filtros de cuerpo y
  cierre) no está escrita en la documentación; se ve en cada trade el cierre en la caja (`closeAt`, de 0.61 a 0.95).
- **En pantalla:** la caja con "Centro de la caja" y "Borde de caja", y en R13d la estructura SMC encendida (OB, BOS,
  CHoCH, premium/discount). La comprobación de cada captura dio «ok» en los 24.
- **O-08:** el embudo de R13c dice "− objetivo del perfil muy cerca o ya pasado" (5 señales) aunque el objetivo es el
  centro de la caja.

Capturas: `evidencia/pantalla/R13a_ARBUSDT_f1/` y `R13b_ARBUSDT_f1/` (una por trade, más las hojas de contactos
`hoja_*.jpg` con que se revisaron a la vista). El gráfico se pasó a 15M: en 4H la comprobación de cada captura no
sirve.

## El perfil y las señales, recalculados aparte

`tests/audit/vp_check.py` (registros en `evidencia/capa_a/vp_check_R13ab_ARBUSDT_f1_*.log`), sin usar
`vp_sessions.py`: el perfil de la sesión UTC anterior con las celdas del almacén (50 franjas, POC en la de más volumen,
área de valor del 70% que crece hacia la vecina mayor, niveles en el centro de su franja), las velas del motor, y las
reglas de VR y VF como las dice la documentación.

- **Niveles:** POC, VAH, VAL, máximo y mínimo de la sesión anterior iguales en los 659 trades.
- **Señales:** VR, 72 recalculadas contra 72 de la corrida; VF, 1,260 contra 1,260.
- **Cada trade:** la señal, el lado, la zona (del borde al extremo), el stop (borde lejano + 0.1 ATR, media simple de
  14 rangos) y el objetivo (borde contrario o POC) iguales en los 659. Ningún objetivo a menos de 0.3 R.
- **La regla del 90%:** una sesión con menos del 90% de sus minutos no da niveles. El 12/08/23 de ARB tiene 1,286 de
  1,440 minutos en el almacén (89%), así que el 13/08 no tiene señales: el motor lo cumple (7 señales que da el
  recálculo sin esa regla).
- Lo que no coincidía al principio y su causa, ya anotado:
  - **O-07** (borde entre franjas en coma flotante): con fracciones exactas cambian los niveles de 2 trades de VR y 21
    de VF, una franja.
  - **E-02** (VF en la primera vela de la sesión): el motor toma la apertura de la sesión como "el cierre anterior";
    con lo literal salen 2 señales más.
  - El fallo se mide en la misma sesión: un fallo que empieza en la última vela de una sesión y cierra dentro en la
    primera de la siguiente se juzga con los niveles nuevos.

- **Sesiones semanales (R13e, agregada en esta etapa):** empiezan el lunes 00:00 UTC (las 124 sesiones de los trades
  son lunes). Niveles iguales en los 124 trades y 257 señales contra 257. La fase 1 de ARB empieza un domingo
  (23/04/23), a mitad de una semana: el motor toma esa primera vela como la apertura de la sesión (el trade #1 sale
  de ahí). Es parte del arranque en frío (H2): con VR semanal, "la sesión abrió fuera del valor" se mediría en la
  apertura de la fase, no en la del lunes.

## En pantalla

- La comprobación de cada captura (`batch` del ayudante: entrada en la apertura, salida recalculada con las velas
  de 15m, motivo y precio) dio «ok» en los 659 trades. R13b tiene una vela dudosa (14/07/23 16:00, objetivo a las
  16:04), la de siempre.
- El trade elegido dibuja el valor de la sesión anterior (franja naranja con su forma: «perfil B», «perfil D»), el
  POC anterior y el máximo o mínimo anterior, la caja del trade y la salida. Se ven bien en las 659 capturas.

## Para el informe (H18, decisión)

Con el stop tras el extremo del fallo, R13b tiene stops de hasta 0.023% del precio (mediana 0.40%). Las comisiones
(0.11% ida y vuelta) valen entonces de 1 a 5 R:

- 32 trades pierden más de 2 R (el peor, #248, −5.79 R);
- 6 trades llegan al objetivo y pierden: #273 llega al POC a 0.71 R brutos y queda en −0.56 R; #334, a 1.33 R
  brutos, en −0.65 R.

El mínimo de 0.3 R para el objetivo y el stop mínimo de 0.1 ATR no miran las comisiones. No es un error del cálculo
(el R neto es correcto); es una pregunta para el usuario.
