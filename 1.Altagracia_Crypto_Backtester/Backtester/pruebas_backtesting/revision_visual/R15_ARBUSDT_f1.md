# Revisión visual · R15 · ARBUSDT · fase 1 · Cómo se combinan los elementos (E-12 y H3): la receta

Todas en 4h, con el FVG nuevo de 0.3 ATR o más (`FV03`), entrada a mercado, stop de 1.5 ATR y objetivo de 3R, una
posición a la vez y sin enfriamiento. Lo que cambia es la receta.

| | Receta | Corrida (`ARBUSDT_240_f1_…`) | Señales | Trades | R medio | Motivos | Revisión |
|---|---|---|---|---|---|---|---|
| R15a | FVG nuevo **e** Impulso (≥ 2 ATR en 3 velas) en la misma vela | `c0acb9314c7759fd_1795310599` | 16 | 14 | +0.111 | 4 objetivo, 10 stop | **14 de 14 bien** |
| R15b | **al menos 2** de FVG, Impulso y Ruptura de caja, en 3 velas | `735b4a373fa0ac4d_1795310601` | 52 | 32 | −0.030 | 8 objetivo, 24 stop | **32 de 32 bien** |
| R15c | **secuencia:** Ruptura de caja y después FVG, en 5 velas | `6f2d405233af214a_1795310603` | 14 | 13 | −0.103 | 3 objetivo, 10 stop | **13 de 13 bien** |
| R15d | la misma secuencia, **también en la misma vela** | `be14eb8d8b72ab76_1795310605` | 19 | 18 | +0.079 | 5 objetivo, 13 stop | **18 de 18 bien** |
| R15e | FVG, **solo largos** | `83923f9b9b95ad79_1795310607` | 58 | 29 | +0.072 | 8 objetivo, 21 stop | **29 de 29 bien** |
| R15f | FVG, **invertida** (en contra del hueco) | `4c0584f69f84b9b8_1795310609` | 117 | 41 | −0.152 | 9 objetivo, 32 stop | **41 de 41 bien** |
| R15g | FVG en un **extremo** de 5 velas (o una antes) | `29830deb18b7c304_1795310610` | 4 | 4 | +0.971 | 2 objetivo, 2 stop | **4 de 4 bien** |
| R15h | FVG **con momentum** (EMA 14) | `eb0e2408bd9be96b_1795310612` | 81 | 42 | +0.112 | 12 objetivo, 30 stop | **42 de 42 bien** |
| R15i | FVG **con confirmación** de 0.25 ATR en 2 velas | `775da9c4c8208330_1795310614` | 95 | 47 | +0.075 | 13 objetivo, 34 stop | **47 de 47 bien** |

Capturas: `evidencia/pantalla/R15a_ARBUSDT_f1/` a `R15i_ARBUSDT_f1/` (una por trade, y la del inicio y la del final en
los trades largos), con las hojas de contactos `pantalla/hoja_R15_1.jpg` a `hoja_R15_3.jpg`, con las que se
revisaron a la vista. La comprobación de cada captura (`batch` del ayudante: la entrada en la apertura, la salida
recalculada con las velas, su motivo y su precio) dio «ok» en los 240.

Embudo de cada corrida (con la señal repetida por `run(..., trace)`): las señales que no dieron trade son todas
«posición abierta», más una «abierta al final de la fase» en todas salvo R15g. Ninguna se descartó por otra cosa.

## La receta, recalculada aparte

`tests/audit/recipe_check.py` (`evidencia/capa_a/recipe_check_R15_separacion.log`) arma las señales desde la
documentación ("Setups como recetas" y la regla del probador), sin usar `of_setups.py`: un voto cuenta en la vela con
la que se conoce su elemento; la vela que dispara aporta un voto; los modos todas, al menos N y secuencia (contexto
antes del gatillo, o en la misma vela con `sameBar`); el lado; invertir solo cambia el lado del trade; el momentum
(EMA 14 con pendiente de 0.25 ATR en 3 velas y el cierre de su lado); el extremo; y la confirmación, que hace de la
vela que avanza a favor la señal. ATR: media simple de 14 rangos (H13).

- **Las nueve dan las mismas señales que el motor** (lado y vela), con una regla que la documentación no dice: tras
  una señal, el motor no da otra del mismo lado hasta que pasa una ventana (`i − última < ventana`). Sin esa regla, el
  recálculo tiene 23 señales más en R15b (ventana 3), 1 en R15c y 5 en R15d (ventana 5)
  (`recipe_check_R15_v2.log`); con ella, 0 de diferencia en las nueve. Anotado como **E-03** en DEFECTOS (S4, punto
  a precisar: evita contar varias veces el mismo grupo de votos, pero una regla con ventana de 3 o 5 velas da menos
  señales de las que se esperan al leerla, y la documentación no lo dice).
- **H3:** es la misma separación de la que habla H3. Las reglas de R15 no tienen filtros fuera de la receta, así que
  aquí solo se ve la separación entre señales que sí se operan. Lo que dice H3 (que una coincidencia descartada después
  por un filtro de VWAP, EMA, flujo, régimen u horario también gasta la ventana, y se pierde una señal válida en las
  velas siguientes) se mide en la etapa 4, con la B5 (ventana 2) y la de los sabios (ventana 10).
- **Invertida (R15f):** las 117 señales son las del FVG; cada trade va al lado contrario del hueco (23 largos y 18
  cortos en los 41 trades).
- **Solo largos (R15e):** los 29 trades son largos; las 58 señales son los FVG alcistas.
- **Confirmación (R15i):** la señal es la vela que confirma, y la entrada, la apertura siguiente. 95 señales en 93
  velas: dos veces dos FVG seguidos se confirman en la misma vela (28/06/23 12:00, corto, y 14/07/23 00:00, largo);
  el primero da el trade y el segundo sale «posición abierta». El recálculo da lo mismo.
- **Extremo (R15g):** con 5 velas y una de holgura quedan 4 de los 117 FVG; los 4 son trades.

## Lo que no cubre esta revisión

- El recálculo de R15 usa los eventos de los elementos que arma el motor (FVG, Impulso y Ruptura de caja): esos
  elementos se comprobaron aparte en R06 a R09 (capa A) y en R13c (la caja), no aquí.
- La capa A de R15 corre en BTC 4h (lote 4): los dos oráculos repiten cada trade con su stop y su objetivo.
- Los resultados son de 13 a 47 trades por corrida, para probar el motor: no dicen nada de las reglas.
