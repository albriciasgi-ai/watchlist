# Galería 1 (velas, patrones y cajas): las respuestas del usuario (23/11/2026)

Marcas del usuario: **Sí 38 · No 20 · No sé 1 · sin marcar 1 de 60** (4 casos por elemento; el texto que pegó está en
`evidencia/etapa7/galeria_marcas_1.txt`). Todos los "Sí" de FVG nuevo, Impulso, Swing, Volumen alto y Compresión.

Cada "No" y "No sé" se revisó con los datos de su corrida, repetida en la copia aislada (motor 6): las velas, los valores
de su elemento y por qué entró o no cada señal de la ventana. Las horas van en hora de Colombia (UTC−5), salvo que digan UTC.

## En una línea por elemento

| Elemento | Casos | Qué es |
|---|---|---|
| Flecha del volumen de respuesta | 243 (Sí, con pregunta) | Sin fallo: la vela que preguntas sí era una flecha, pero había una posición abierta |
| Rombo como giro / siguiendo el tramo | 9, 33, 64, 80 / 9, 39 | Sin fallo de cálculo. La definición del rombo no es la tuya en cuatro puntos (abajo). Dos cosas de pantalla confunden: O-35 y O-36 |
| Martillo o estrella, envolvente, doji | 27, 40, 91, 130 / 42 (y la nota de 166) / 7, 13 | La detección está bien. Pides tamaño mínimo y que el patrón sea un swing confirmado. La caja del elemento tapa la mecha (O-34) y el texto de la tendencia previa engaña (E-17) |
| Gaussian Channel | 42 | Sin fallo: la vela resaltada cierra 438 bajo la banda |
| Ruptura de caja | 11 / 32, 83 | El 11 es un fallo (F-18). El 32 y el 83 son el margen de 0.5 ATR, que no se dibuja ni se explicaba (E-18) |
| Borde de caja | 61 / 44 | El 61 es un fallo (F-19). En el 44, el "borde" es la quinta parte de la caja (E-19) |
| Cambio de carácter | 40, 71 | La regla hace lo que dice; tu criterio del swing es otro. El extremo dibujado no es el de la tendencia (F-20). Choca con el 17, que marcaste "Sí" |

## Caso por caso

### Flecha (RF), trade 243: "la primera vela grande verde parecía cumplir también"
- Sí cumplía: la verde del 11/09/23 a las 19:00 tenía 6.20 veces el volumen de su hora, y el tramo giró al alza con su
  cierre, así que iba a favor. Dio señal larga.
- No entró porque seguía abierto el corto del trade 242: entró el 08/09 a las 07:00 en 25,825.1, con stop en 26,214.2,
  y esa vela llegó a 25,947. Lo mismo con la verde siguiente (5.31 veces).
- El 242 tocó su stop dentro de la vela del 12/09 a las 03:00, y la flecha de esa misma vela (5.52 veces) entró: es el 243.
- Para entrar en la primera, la regla tendría que salir con la señal contraria. Con esa salida baja de +0.153 a +0.045 R
  por trade (de 267 a 434 trades).

### Rombos del volumen de respuesta
El rombo usa el tramo del zigzag de 2 ATR vigente al cerrar la vela de la señal (`response_volume.py`, `measures.zigzag`),
el mismo que decide qué velas son tendencia y cuáles respuesta. Mira las 10 últimas velas del tramo. Recalculado aparte,
da los mismos 125 rombos y el panel da el mismo tramo que el backend. Lo que no cuadra con tu lectura:

- **9 (giro: corto; siguiendo: largo), 05/09/20 a las 11:00.** Para el código, el tramo era el rebote alcista de 9,883 a
  10,624.5 (2.04 ATR), dentro de una caída de 6 ATR desde 12,066. Tú tomas la caída como tramo, y por eso su "respuesta"
  es tu "tendencia". Con el tramo a 3 ATR el rombo sale una vela antes y con las direcciones que esperabas (giro largo,
  +1.98 R; siguiendo, corto, −1.02 R).
- **33 (giro: largo), 12/11/21 a las 15:00.** El desplome del 10/11 a las 15:00 (5.38 veces) sí igualaba al rally. Pero
  giró el tramo con su propio cierre, y el giro desarma el rombo. Además, el panel Vol pinta de rojo una vela verde
  porque la junta en un grupo de barras (O-35).
- **64 (giro: corto), 22/01/23 a las 19:00.** El rombo salió porque la verde de 9.22 veces (21/01 a las 03:00) dejó la
  ventana de 10 velas, no porque subiera la respuesta. La venta fuerte llegó 3 velas después (23/01 a las 07:00).
- **80 (No sé), 09/09/23 a las 19:00.** La roja grande (08/09 a las 03:00, 5.13 veces) giró el tramo con su cierre y pasó
  a contar como tendencia del tramo nuevo, no como respuesta. Leída con el tramo anterior habría sido rombo, con un corto.
  El rombo de la señal salió cuando esa roja dejó la ventana, con todo quieto.
- **39 (siguiendo: corto), 23/02/22 a las 23:00.** Se armó con una sola vela, sin ninguna verde en la ventana, y la verde
  siguiente lo igualó. Ese mismo rombo como giro ganó +1.98 R: tu lectura de reversión cuadra.
- **En la fase 1 (119 rombos):**
  - 59 salen solo porque una vela de tendencia deja la ventana, 40 porque sube la respuesta y 20 por las dos;
  - 29 se arman sin ninguna vela de respuesta;
  - habría 31 más si la vela que gira el tramo se leyera con el tramo anterior.
- **De pantalla:** el título del panel dice la lectura de la última vela a la vista, no la de la señal (en el 33 dice "Tramo
  alcista" con el tramo del trade bajista), y el panel no sigue el tramo de la regla si se cambia (O-36).

### Martillo o estrella (HM), envolvente (EN) y doji (DJ)
La detección hace lo que dice su regla en los 8 casos, y la tendencia previa que pide el código se cumple. El código no pide
tamaño ni swing, y decide al cierre de la vela del patrón.

| Caso | Vela | Tamaño | ¿En un swing? |
|---|---|---|---|
| HM 27, estrella | 17/02/21 19:00 | rango 0.37 ATR; mecha 0.30 ATR | No: el máximo fue la vela anterior |
| HM 40, martillo | 19/05/21 07:00 | rango 3.75 ATR; mecha 3.09 ATR | Sí: el mínimo de más de 199 velas, confirmado 2 velas después (a las 19:00) |
| HM 91, estrella | 28/09/22 15:00 | rango 0.80 ATR; mecha 0.51 ATR | Sí: máximo de las 6 anteriores, nadie lo pasa en 10 |
| HM 130, martillo | 08/09/23 11:00 | rango 0.65 ATR; mecha 0.45 ATR | No: el mínimo fue 2 velas antes |
| EN 42, bajista | 31/12/20 03:00 | cuerpos de 0.18 y 0.31 ATR | No: el máximo fue 2 velas antes |
| EN 166, alcista (Sí) | 30/12/22 15:00 | cuerpos de 0.29 y 0.81 ATR | El mínimo fue la vela anterior a la envuelta |
| DJ 7, libélula | 21/01/22 07:00 | mecha 1.20 ATR | Mínimo de 199 velas, pero la 2.ª vela después lo perfora |
| DJ 13, lápida | 21/07/23 19:00 | mecha 0.40 ATR | No: el máximo fue 2 velas antes |

- **"No se ven los pabilos" es un fallo de pantalla (O-34):** la caja clara del elemento empieza en el centro de su vela y
  su borde cae sobre la mecha. Pasa en todas las capturas de todos los elementos.
- **"La quinta" (91):** el texto del martillo no dice "la quinta"; eso está en el del Swing. La estrella del 91 sí es el
  máximo del swing; su mecha estaba tapada y el máximo visible era el de la vela anterior.
- **La tendencia previa (E-17):** "después de una caída de 5 velas" suena a cinco velas seguidas. El código compara solo
  el cierre de la vela anterior con el de 6 velas antes (`candle_patterns.trend_fits`).
- **Cuántos quedarían** (BTC 4h, fase 1):

| Filtro | Martillo o estrella | Envolvente | Doji |
|---|---|---|---|
| Hoy | 215 | 578 | 18 |
| Lo que hace el patrón ≥ 0.5 ATR (mecha, o cuerpo en la envolvente) | 156 | 354 | 16 |
| Extremo de las 5 velas anteriores, confirmado por 2 velas después | 104 | 198 (237) | 12 |
| **Las dos** | **96** | **143 (170)** | **11** |

  Entre paréntesis, aceptando el extremo también en la vela anterior a la envuelta. Con las dos, de tus 8 casos quedan el
  40 y el 91 (y el 166 con el paréntesis).

### Gaussian Channel, trade 42: "la vela cerró por dentro"
La vela resaltada (25/01/21 a las 15:00, corto) abre en 33,440 y cierra en 32,284.5. La banda inferior en esa vela está en
32,722.9: cierra 438 por debajo (0.36 ATR), fuera. La línea punteada pasa por ese mismo valor. La que cerró dentro es la
anterior (33,428.5 contra 32,802.5), como pide la regla. Ninguno de los 226 trades incumple la definición. Falta saber qué
vela miraste.

### Ruptura de caja
- **11 (fallo, F-18).** La caja 11,125–11,826 no terminó porque el precio cerrara fuera, sino porque su eficiencia de 20
  velas pasó de 0.5. El código toma igual como ruptura la vela siguiente, y esa vela (27/08/20 a las 11:00) cerró en
  11,250, dentro de la caja. Pasa en 7 de las 141 rupturas de la fase; en 4, la vela cierra dentro (trades 11, 46, 51 y
  105).
- **32 y 83 (E-18).** La vela anterior sí cerró fuera del rectángulo, pero la caja solo se rompe con un cierre a más de
  0.5 ATR del borde. En el 32 cerró en 49,693.5, con el umbral en 49,858. En el 83 cerró en 23,113.5 y le faltaron 12.9
  para el umbral de 23,126.4. Pasa mucho: 70 de 141 rupturas tuvieron antes un cierre fuera dentro del margen, y en 23 fue
  la vela anterior. Ese margen no se dibuja.

### Borde de caja
- **61 (fallo, F-19).** El tramo ya había gastado su llegada. La vela de la señal (11/08/22 a las 15:00) tocó el borde a las
  16:32 (21:32 UTC) y volvió al tercio del centro a las 17:54. El código rearma con el cierre de la vela antes de mirar su
  llegada, y cuenta ese toque, que fue antes de volver al centro, como una llegada nueva. 61 de 178 bordes se rearman en su
  propia vela; en 56 el toque fue antes de volver. De ahí salen 27 de los 96 trades. La vela que esperabas, una antes
  (a las 11:00), no contó por E-08: la primera vela del tramo que tocó la franja (10/08 a las 19:00) cerró cerca de su
  máximo, no pasó el filtro de cierre y gastó la llegada. Eso se dejó como está el 23/11. Esa vela de las 11:00, además,
  cierra a 0.57 de su máximo, bajo el 0.6 que pide el filtro.
- **44 (E-19).** Para el código, el "borde" es la quinta parte de arriba o de abajo de la caja (37,808–39,034), no la línea.
  La vela de la señal (25/01/22 a las 23:00) llegó a 37,967, dentro de esa franja, y fue la llegada del tramo. La que
  esperabas, la segunda después de la entrada (26/01 a las 11:00), tocó a 146 del techo, pero el tramo ya había usado su
  llegada: hay una por tramo. Con una franja de 5% de la caja, la vela de la señal no llega y la señal sería justo esa.

### Cambio de carácter
- **40 (largo).** Para el código la tendencia era bajista:
  - máximos de swing: 61,097 y 58,968;
  - mínimos de swing: 58,350 y 55,665.5.

  El swing roto fue 58,968, el rebote posterior al mínimo. Tú esperabas el que originó el último tramo, 61,097. El precio no
  cerró sobre 61,097 en los 20 días siguientes y cayó a 40,829. La siguiente señal fue un corto (trade 41, +1.98 R).
- **71 (corto).** La tendencia "alcista" del código salía de mechas: ninguna vela cerró sobre el máximo anterior, 26,196.8.
  Antes los máximos venían bajando. Tú la lees bajista, y la estructura SMC de la app también: ruptura bajista de
  continuación el 14/06 y cambio de carácter alcista el 16/06. La propia regla dio un CC largo el 16/06, que no entró
  porque había una posición abierta. Los rótulos son los valores que usó la regla.
- **Choca con el 17, que marcaste "Sí":** es el espejo exacto del 40. Con tu criterio del 40, el 17 tampoco sería un cambio
  de carácter.
- **F-20:** la línea "Extremo de la tendencia" es el extremo desde el swing roto hasta la ruptura, no el de la tendencia, y
  empieza en la vela del swing. Pasa en 73 de 181 cambios, y de ahí sale el stop "detrás de la zona".
- **Variantes medidas** (181 eventos hoy):
  - con 3 tramos: 48 eventos;
  - con la tendencia confirmada por cierres: 123 (sale el 71);
  - con la referencia en el swing anterior al extremo: 138 (salen el 17 y el 40);
  - las dos juntas: 87.

  El elemento "Ruptura de estructura" de SMC con "solo CHoCH" ya existe: dispara en el 32, no en el 17 ni en el 40, y en el
  71 da el largo del 16/06.

## Lo que hay que decidir
1. **Patrones:** ¿exigir que lo que hace el patrón mida al menos 0.5 ATR y que sea un swing (el extremo de las 5 velas
   anteriores, confirmado por las 2 siguientes, con la señal al cierre de la 2.ª)? ¿2, 3 o 5 velas de confirmación? En la
   envolvente, ¿vale el extremo en la vela anterior a la envuelta?
2. **Rombo:**
   - ¿el tramo a 3 ATR?
   - ¿la vela que gira el tramo se lee con el tramo anterior?
   - ¿rombo solo cuando sube la respuesta, y no cuando una vela de tendencia deja la ventana?
   - ¿armarlo solo con al menos una vela de respuesta?

   Medido en la fase 1, sin margen en ninguna variante: el giro pasa de −0.15 a +0.10 R por trade con 3 ATR; el que sigue
   el tramo, de −0.01 a +0.19 R con "la respuesta sube".
3. **Cambio de carácter:**
   - ¿qué swing se rompe: el último swing (hoy) o el que originó el último tramo (como el CHoCH de SMC)?
   - ¿la tendencia vale con mechas o solo confirmada por cierres?
   - ¿cómo queda el 17?
   - ¿el stop detrás del extremo real de la tendencia?
4. **Ruptura de caja:** ¿mantener el margen de 0.5 ATR, dibujado, o probar "el primer cierre fuera" como otra regla?
5. **Borde de caja:** ¿la quinta parte de la caja (hoy) o una franja más angosta (5% de la caja, o una franja en ATR)?
6. **Gaussian Channel:** ¿qué vela o qué línea miraste en el 42?

## Decidido por el usuario (23/11, la misma noche)
1. **Patrones de velas:** "esos patrones son significativos si quedan en un swing". Martillo o estrella, envolvente y doji
   piden que lo que hace el patrón mida al menos 0.5 ATR (la mecha; en la envolvente, el cuerpo) y que sea un swing: el
   extremo de las 5 velas anteriores, confirmado por las 2 siguientes, con la señal al cierre de la 2.ª.
2. **Rombo:** solo cuando sube la respuesta (no cuando una vela de tendencia deja la ventana). El tramo sigue a 2 ATR, la
   vela que gira el tramo cuenta en el tramo nuevo y no se pide una vela de respuesta para armarlo.
3. **Cambio de carácter (24/11, con el par 17 y 40 explicado otra vez):** "B para los dos casos": se rompe el swing
   que originó el último tramo (el 17 y el 40 dejan de ser cambios de carácter). Y en el 71, "que el cierre esté por
   encima": un máximo más alto cuenta solo si alguna vela cerró sobre el anterior. El extremo de la zona pasa a ser el
   de la tendencia (F-20).
4. **Ruptura de caja:** el primer cierre afuera de la caja (sin el margen de 0.5 ATR). Corrige también F-18.
5. **Borde de caja:** la franja del borde es el 5% de la caja (no la quinta parte).
6. **Gaussian Channel 42 (24/11):** "sí está bien en el trade 42": no era un fallo.

Todo quedó en el **motor 7** (24/11), con F-18, F-19 y F-20; sin unir a main hasta terminar las cinco galerías. Antes,
O-34 se corrigió y las cinco galerías se capturaron otra vez. Los 8 elementos que cambiaron se corrieron con el motor 7 y
volvieron a la galería 1 con casos nuevos (sus marcas empiezan de cero).

## Propuesta de correcciones
- **Sin cambiar trades, antes de seguir con las galerías 2 a 5:**
  - O-34: las cajas de los elementos empiezan en el borde de su vela;
  - los textos de la galería (E-17, E-18, E-19);
  - volver a capturar los casos, con la mecha a la vista y, en las capturas con paneles, el volumen con el color de cada
    vela (O-35, solo en la copia aislada).
- **Con un motor nuevo, al terminar las cinco galerías:** F-18, F-19, lo que se decida de F-20 y de los conceptos, para que
  las corridas se repitan una sola vez.
