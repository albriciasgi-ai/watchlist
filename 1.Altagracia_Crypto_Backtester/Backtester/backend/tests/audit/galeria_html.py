"""
Protocolo (22/11/2026), etapa 7, prueba adicional 1: la galería de TODOS los elementos del probador (pedido del usuario:
los va a combinar en recetas nuevas y necesita que todos funcionen). Junta las capturas de cada elemento
(evidencia/pantalla/G_<clave>/) en 5 páginas por familia, con la definición de cada elemento tal como la calcula la app
y, en cada caso, "Sí, es lo que entiendo", "No" o "No sé" y una nota. Un botón copia las marcas para pegarlas en el chat.
Las imágenes van dentro de cada página (reducidas): se abren con doble clic, sin servidor.

23/11: el usuario pidió 4 casos por elemento en vez de los 12 capturados ("la mayoría son parecidos"). `pick()` elige
4 repartidos en la fase y, si hay de los dos lados, 2 largos y 2 cortos. Cada caso conserva su clave (`FV-7`, por su
lugar entre los 12), así las marcas ya hechas siguen valiendo.

Uso (desde backend/): python -B tests/audit/galeria_html.py CARPETA_DE_SALIDA [CASOS_POR_ELEMENTO]   (4; 0 = todos)
"""
import base64
import html
import io
import json
import re
import sys
from pathlib import Path

SHOTS = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\pantalla")
RUNS = Path(r"C:\Users\inven\OrderFlowData\research\pruebas_backtesting\2026-11-21\evidencia\etapa7\galeria_corridas.json")
# Motor 7 (23-24/11/2026): los elementos que cambiaron se corren y capturan otra vez, en G7_<clave>, con claves de caso
# nuevas (<clave>7-<n>): las marcas de antes eran de otros casos
RUNS_M7 = RUNS.with_name("galeria_corridas_m7.json")
M7 = ("HM", "EN", "DJ", "RBg", "RBs", "BX", "BE", "CC", "QA", "QV", "QB", "QR", "QT", "QS", "QC", "QE", "QG")
# Motor 8 (26/11/2026, galería 4): los elementos de order flow que cambiaron, en G8_<clave>, con las claves de
# galeria_corridas_m8.json (las velas que ya eran caso conservan la suya)
RUNS_M8 = RUNS.with_name("galeria_corridas_m8.json")
M8 = ("EX", "VD", "DT", "DD", "IV", "SQ", "VL", "AD", "RL")
H4, M15 = "BTC · 4h", "BTC · 15m"
PER_ELEMENT = 4

# clave: (título, marco, cómo lo calcula la app, qué mirar en la captura)
E = {
    # Velas, patrones y cajas
    "FV": ("FVG nuevo", H4, "Un hueco entre la primera y la tercera de tres velas seguidas: en un alza, el mínimo de la tercera queda por encima del máximo de la primera (en una baja, al revés). Solo huecos de 0.3 ATR o más. Se conoce al cerrar la tercera.", "la caja clara del hueco y que la vela resaltada sea la tercera de las tres."),
    "IM": ("Impulso", H4, "El cierre avanza al menos 2 ATR respecto del cierre de 3 velas antes. La señal es la primera vela que lo cumple (la anterior no lo cumplía); su zona va del mínimo al máximo de esas velas.", "el avance de las últimas 3 velas hasta la vela resaltada."),
    "SP": ("Swing", H4, "Un máximo (o mínimo) que es el único extremo de 5 velas a cada lado. Se conoce 5 velas después. Un mínimo es alcista y un máximo, bajista.", "el extremo marcado y que la vela resaltada sea la quinta después de él."),
    "VH": ("Volumen alto para su hora", H4, "Una vela con el doble del volumen medio de su misma hora en los 30 días anteriores. Su lado es su color.", "la barra de volumen de la vela resaltada (abajo, bajo las velas) contra las demás, sobre todo las de su misma hora (en 4h, una de cada 6)."),
    "RF": ("Flecha del volumen de respuesta", H4, "Una vela con el doble o más del volumen mediano de su misma hora en los 30 días anteriores, que va a favor del tramo en curso (tramos que giran con 2 ATR). Su lado es el color de la vela.", "la barra de volumen de la vela resaltada (abajo) y que vaya en la dirección del tramo; el panel Volumen de Respuesta (más abajo) marca la flecha."),
    "RBg": ("Rombo del volumen de respuesta, como giro", H4, "Después de un tramo en que dominó el volumen de la tendencia, una vela de respuesta sube el promedio de la respuesta y lo iguala (el equilibrio del indicador Volumen de Respuesta). Si el equilibrio llega porque una vela de la tendencia deja la ventana, no hay rombo (desde el 23/11). Como giro, se opera contra el tramo, con la zona del cierre al extremo del tramo.", "en el panel Volumen de Respuesta (abajo), el tramo previo en que dominó el volumen de la tendencia y el rombo en la vela resaltada, donde la respuesta lo iguala; el trade va contra el tramo."),
    "RBs": ("Rombo del volumen de respuesta, siguiendo el tramo", H4, "El mismo rombo (solo cuando sube la respuesta), operado a favor del tramo, con la vela como zona.", "lo mismo que el rombo como giro (panel Volumen de Respuesta, abajo), pero el trade va a favor del tramo."),
    "HM": ("Martillo o estrella fugaz", H4, "Martillo (alcista): cuerpo arriba y una mecha de abajo larga (2 cuerpos o más y al menos 0.5 ATR), con la vela anterior cerrando más abajo que la de 6 velas antes, y en un swing: su mínimo pasa el de las 5 velas anteriores y las 2 siguientes no lo alcanzan. Estrella fugaz (bajista), al revés. La señal se conoce al cerrar la 2.ª vela después del patrón (desde el 23/11).", "el patrón, 2 velas antes de la vela resaltada (la que confirma el swing): su mecha y que sea el extremo."),
    "EN": ("Envolvente", H4, "Una vela cuyo cuerpo (de al menos 0.5 ATR) envuelve el cuerpo de la anterior, de color contrario, con la vela anterior cerrando en contra respecto de la de 6 velas antes, y en un swing: el extremo de las dos velas pasa el de las 5 anteriores y las 2 siguientes no lo alcanzan. La señal se conoce al cerrar la 2.ª vela después (desde el 23/11).", "las dos velas del patrón, 2 velas antes de la resaltada, y que su extremo sea el del swing."),
    "DJ": ("Doji", H4, "Doji libélula (alcista) o lápida (bajista): cuerpo casi nulo y una mecha larga hacia un lado (al menos 0.5 ATR), con la vela anterior cerrando en contra respecto de la de 6 velas antes, y en un swing confirmado por las 2 velas siguientes. La señal se conoce al cerrar la 2.ª (desde el 23/11).", "la mecha del doji, 2 velas antes de la resaltada, y que sea el extremo."),
    "GC": ("Gaussian Channel", H4, "Una vela cierra fuera de la banda del canal gaussiano (periodo 144, 4 polos, ancho 1.414) y la anterior no, con la línea central a favor: arriba es largo y abajo, corto. Sale al cerrar de vuelta dentro de la banda.", "las bandas del canal y que la vela resaltada cierre afuera."),
    "BX": ("Ruptura de caja", H4, "La primera vela que cierra fuera de una caja (una congestión que encuentra el detector de eficiencia con caja), del lado de ese cierre (desde el 23/11; antes pedía 0.5 ATR de margen). Solo cajas de hasta 5.5 ATR de alto.", "la caja (rectángulo con su centro punteado) y que la vela resaltada sea la primera que cierra fuera de ella."),
    "BE": ("Borde de caja, hacia el centro", H4, "La llegada del precio a la franja del 5% de arriba o de abajo de una caja vigente, para ir hacia su centro, con los filtros de cuerpo y cierre de fábrica. Una llegada por tramo: se rearma cuando una vela cierra en el tercio del centro, desde la vela siguiente (desde el 23/11).", "la caja y que la vela resaltada llegue a su franja del 5% de arriba o de abajo."),
    "CP": ("Compresión", H4, "La vela en que se detecta una caja. No tiene dirección: pone dos órdenes stop por fuera de la caja y entra la que se llena primero.", "la caja recién detectada y por qué lado salió el precio."),
    "CC": ("Cambio de carácter", H4, "Una tendencia de swings crecientes (2 tramos, swing de 3 velas; un máximo más alto cuenta solo si una vela cerró sobre el anterior) y una vela que cierra bajo el mínimo que originó el último tramo al alza abre un corto; al revés, un largo. La estructura va en velas de 4h (desde el 24/11).", "los swings de la tendencia, el swing roto (el que originó el último tramo) y que la vela resaltada cierre más allá."),
    # VPA
    "QA": ("Esfuerzo sin resultado (VPA)", H4, "Una vela con mucho volumen y poco rango (grado de 50% o más), alto para su hora y frente a las 20 velas anteriores; no cuenta si la vela anterior fue ancha, porque esa sí tuvo resultado, ni si la vela misma es ancha: se movió, aunque su volumen fuera todavía mayor (desde el 24/11). Se opera contra el color de la vela.", "el volumen alto (barra de abajo) frente a las velas de al lado, con una vela de poco recorrido que no sigue a una vela ancha."),
    "QV": ("Esfuerzo con resultado (VPA)", H4, "Elemento nuevo (24/11): una vela de rango ancho con volumen alto, para su hora y frente a las 20 velas anteriores, aunque su volumen sea todavía mayor que su rango (como la vela del 17/04/21, que antes salía como esfuerzo sin resultado). Va a favor de su color. Sirve de gatillo en una regla en secuencia, tras un clímax, un frenado o una prueba.", "el rango y el volumen (barra de abajo) de la vela resaltada frente a las de al lado."),
    "QB": ("Ruptura con volumen (VPA)", H4, "El primer cierre a más de 0.1 ATR fuera del máximo o mínimo de las 20 velas anteriores (con el cierre anterior adentro), si ese rango mide hasta 6 ATR, con volumen alto para su hora y frente a las 20 velas anteriores (desde el 24/11).", "el nivel roto (borde del rango), que la vela resaltada cierre más allá y su volumen (barra de abajo) frente a las de al lado."),
    "QF": ("Ruptura sin volumen (VPA)", H4, "La misma ruptura del rango de 20 velas, pero con volumen bajo para su hora. Se opera contra la ruptura.", "el nivel roto y el poco volumen de la vela resaltada (barra de abajo)."),
    "QR": ("Retroceso sin volumen tras la ruptura (VPA)", H4, "Después de una ruptura con volumen, en 8 velas el precio vuelve a ½ ATR del nivel con volumen medio bajo, al menos una vela vuelve en contra de la ruptura (desde el 24/11) y la vela resaltada cierra otra vez a favor.", "la ruptura previa (una vela grande que cierra fuera del rango), las velas que vuelven al nivel con poco volumen y la vela resaltada, que vuelve a cerrar a favor de la ruptura."),
    "QT": ("Prueba de poco volumen (VPA)", H4, "Una vela de poco volumen que entra al precio de una vela de las 20 anteriores con volumen alto y del color contrario, y la rechaza con la mecha: hacia abajo es alcista (prueba de oferta) y hacia arriba, bajista. Desde el 24/11, solo dentro de una caja de la pestaña Régimen (la de oferta en su mitad de abajo, la de demanda en la de arriba) y tras un frenado o un clímax de su lado en las 20 velas anteriores.", "la consolidación tras el frenado o el clímax, la vela de volumen alto anterior (su barra abajo) y la mecha de la vela resaltada, con poco volumen."),
    "QS": ("Frenado o techo (VPA)", H4, "En un tramo de al menos 2 ATR, 2 de las 3 últimas velas tienen mecha de al menos media vela contra el tramo (desde el 24/11; antes un tercio), cierre en su mitad de ese lado y volumen alto para su hora y frente a las 20 velas anteriores. Se opera contra el tramo, una vez por tramo.", "las mechas largas y el volumen (barras de abajo) de las velas resaltadas al final del tramo."),
    "QC": ("Clímax de volumen (VPA)", H4, "2 o más velas con volumen muy alto (3 veces o más, para su hora y frente a las 20 velas anteriores, desde el 24/11) y mecha contra el tramo, en 6 velas y a menos de 1 ATR entre sí. Se opera contra el tramo, una vez por tramo.", "las velas de volumen muy alto (barras de abajo) al final del tramo, frente a las de antes."),
    "QE": ("El medidor VPA cruza el umbral", H4, "El medidor de fuerza y debilidad del Lector VPA cruza su umbral: hacia arriba es largo y hacia abajo, corto. Desde el 24/11 el medidor lee la vela ancha con volumen alto como esfuerzo con resultado (antes, una roja así lo subía), y por eso hay cruces nuevos.", "el medidor en el panel del Lector VPA (abajo) en la vela resaltada."),
    "QG": ("El medidor VPA gira", H4, "Elemento nuevo (24/11): el medidor cruza el cero después de haber pasado el umbral del otro lado (pasó de −1 y ahora es positivo: largo; al revés, corto). El cruce del umbral (el elemento de arriba) sirve para seguir el movimiento; este, para el giro.", "en el panel del Lector VPA (abajo), las barras que pasaron la línea punteada de un lado y la vela resaltada, donde el medidor cruza el cero."),
    # Williams y SMC
    "WD": ("Barra divergente (1.er sabio)", H4, "Largo: una vela que hace un mínimo más bajo que la anterior, cierra en su mitad de arriba y queda entera bajo las tres líneas del Alligator, que se van abriendo; con el AO en rojo. Corto, al revés.", "la vela resaltada, dónde cierra dentro de su rango y las líneas del Alligator."),
    "WA": ("AO tres barras (2.º sabio)", H4, "Tres barras seguidas del AO del mismo color después de una de color contrario: verdes para un largo, rojas para un corto.", "las barras del AO en su panel (si está a la vista) y la vela resaltada, que es la tercera."),
    "WF": ("Ruptura de fractal (3.er sabio)", H4, "El precio pasa el último fractal (un máximo con dos velas más bajas a cada lado, o un mínimo al revés), del lado correcto de los dientes del Alligator. A mercado, la señal es la vela que lo pasa.", "el fractal y que la vela resaltada lo pase."),
    "BS": ("Ruptura de estructura (SMC)", H4, "La vela que cierra más allá del último swing de la estructura (BOS si sigue la tendencia, CHoCH si la cambia). La zona va del nivel roto al cierre.", "el nivel roto de la estructura y la vela que cierra más allá."),
    "OB": ("Order block (SMC)", H4, "La última vela contraria antes del movimiento que rompe la estructura. Nace con la ruptura; la señal es el regreso del precio a esa zona.", "la caja del order block y que el precio regrese a ella."),
    "BK": ("Breaker (SMC)", H4, "Un order block que el precio rompió: queda del lado contrario, como zona de regreso.", "el order block roto y el regreso del precio a él."),
    "EQ": ("Barrido de iguales (SMC)", H4, "Dos máximos (o mínimos) casi iguales y una vela que los pasa: barrer los máximos es bajista y los mínimos, alcista.", "los iguales marcados y la vela que los pasa."),
    # Order flow
    "VA": ("VA abandonada", M15, "La vela siguiente no entra en el área de valor de la vela (el 70% de su volumen, por niveles).", "el área de valor de la vela y que la siguiente no la toque."),
    "OG": ("Orderflows Gap", M15, "Las áreas de valor de dos velas seguidas no se tocan, con un hueco de al menos el umbral relativo en ATR.", "el hueco entre las dos áreas de valor; al pie, su tamaño contra el umbral."),
    "AP": ("POC alineado", M15, "El mismo POC (precio de más volumen) en dos velas seguidas.", "los POC de las dos velas (la línea azul de cada footprint) al mismo precio."),
    "SL": ("POC Slingshot", M15, "Dos velas del mismo color con el POC de la segunda hacia atrás del de la primera.", "los POC de las dos velas (la línea azul de cada footprint)."),
    "RL": ("Absorción (varios intentos)", M15, "Motor 8, la idea del usuario: una barrera que aguanta varios intentos. Un intento es una vela con mucho volumen agresivo en una celda (el 5% mayor de las celdas de 30 días) que cierra del otro lado de esa celda: llegó desde abajo comprando y cerró debajo, o desde arriba vendiendo y cerró encima. La señal es la vela que vuelve a intentar en el mismo nivel (a una celda o menos) en las 10 velas siguientes al primer intento, sin que ninguna vela entre las dos cerrara más allá del nivel; va en contra de los intentos. Cada intento más vuelve a dar la señal. Las 10 velas se eligen en el probador y en el modal (hasta 50).", "el primer intento y el segundo: de cerca, un marco en la celda de cada uno, en su vela, y el cierre del otro lado; al pie, el volumen del segundo contra el umbral."),
    "EX": ("Exhaustion Print", M15, "Motor 8: en el extremo hacia donde fue el precio, el lado que empuja casi en cero (bajo el umbral relativo). Si la vela hace el máximo de 5 velas, mira la compra en su máximo (los compradores se agotan: bajista); si hace el mínimo, la venta en su mínimo (alcista). Si no hace ninguno, o los dos, el extremo donde empieza la vela, como antes.", "de cerca, la celda del extremo marcado y lo poco que hay del lado que se agota; al pie, cuánto contra su umbral."),
    "ZP": ("Zero Print", M15, "Un 0 en una de las dos celdas del inicio de la vela (el mínimo de una verde, el máximo de una roja).", "de cerca, las dos celdas del inicio y el 0 del lado pasivo (una celda sin cifra)."),
    "DT": ("Delta Tail", M15, "Motor 8: la mecha donde empieza la vela (abajo en una verde, arriba en una roja) ocupa la mitad de su rango o más; el cuerpo va con delta a favor del color y la mecha con delta en contra, en su celda del extremo (desde el 10% del volumen medio por nivel) o sumada entera.", "la mecha (el marco va sobre ella) y, de cerca, su delta (compra menos venta) en contra frente al del cuerpo; al pie, cuánto de la vela es mecha."),
    "RS": ("Retail Suck", M15, "El lado pasivo del extremo decrece en tres niveles seguidos, con tamaño relativo.", "de cerca, el lado pasivo de las tres celdas del extremo, de mayor a menor; al pie, contra su umbral."),
    "DD": ("Delta Divergence", M15, "Una vela verde que hace el mínimo de 5 velas con el delta positivo, o una roja en el máximo con el delta negativo. Motor 8: una vela que hace a la vez el máximo y el mínimo (envuelve a las anteriores) no cuenta.", "la vela en el extremo de 5 velas y, en la tabla de abajo, su delta del lado de su color."),
    "PD": ("Price Action Divergence", M15, "El delta va contra el color de la vela, con tamaño relativo.", "el color de la vela contra su delta (bajo la vela y en la tabla); al pie, contra su umbral."),
    "IV": ("Inverse Imbalance", M15, "Dos desequilibrios contrarios seguidos en la mitad lejana de la vela (diagonal 4 a 1). Motor 8: la vela cierra en la mitad de su rango del lado de su color.", "de cerca, los dos desequilibrios contrarios (cifras en negrita) en la mitad lejana; al pie, dónde cerró."),
    "AD": ("Acumulación/Distribución", M15, "La celda de más volumen está del lado contrario y en el tercio del inicio de la vela. Motor 8: en esa celda, el lado contrario es al menos el doble del agresor.", "de cerca, la celda mayor, con el lado contrario al menos el doble; al pie, su tamaño contra el umbral."),
    "SW": ("Market Sweep", M15, "Una racha de 3 o más niveles sin contrapartida (el agresor barre sin que nadie le compre o venda).", "de cerca, la racha de celdas con el lado pasivo casi vacío; al pie, cuántas."),
    "VL": ("Vertical Liquidity", M15, "Una racha de 3 o más niveles con el agresor en el percentil 90 de 30 días. Motor 8: en cada nivel de la racha el agresor le gana al lado contrario.", "de cerca, la racha de celdas con mucho agresor, ganándole al otro lado; al pie, cuántas."),
    "SQ": ("Orderflows Sequencing", M15, "Una racha de 4 o más niveles desde el inicio de la vela con el agresor creciente. Motor 8: en cada nivel el agresor le gana al lado contrario y tiene al menos el 5% del volumen medio por nivel.", "de cerca, el agresor que crece nivel a nivel y le gana al otro lado; al pie, cuántos niveles."),
    "DB": ("Delta Breakout", M15, "Un salto de delta entre dos velas del mismo color, sobre el volumen típico.", "el delta de las dos velas (en la tabla); al pie, el salto contra su umbral."),
    "PW": ("POC Wave", M15, "Tres velas con sus POC en ola, como el libro.", "los POC de las tres velas (la línea azul de cada footprint)."),
    "DV": ("Delta/Volumen extremo", M15, "La razón delta/volumen a favor del color en o sobre el umbral relativo.", "el Δ/Vol de la vela en la tabla (resaltado); al pie, contra su umbral."),
    "ST": ("Desequilibrios apilados", M15, "Tres o más desequilibrios diagonales de 4 a 1 seguidos, a favor del color de la vela, en una vela con 2 o más veces el volumen mediano de las 20 anteriores.", "la franja del apilado y, de cerca, los desequilibrios en negrita; abajo, el volumen."),
    "VI": ("Volume Imbalance", M15, "Tres o más desequilibrios a favor del color, seguidos o no, en una vela de mucho volumen.", "los desequilibrios a favor en el footprint; abajo, el volumen; al pie, cuántos."),
    "IR": ("Imbalance Reversal", M15, "Un desequilibrio contrario en uno de los dos precios del inicio, en una vela de mucho volumen.", "de cerca, el desequilibrio contrario en el extremo de inicio; abajo, el volumen."),
    "RD": ("Imbalance Reload", M15, "Un desequilibrio al mismo precio en dos velas seguidas del mismo color, de mucho volumen.", "de cerca, un marco en cada celda que comparten la vela anterior y la de la señal: en las dos hay un desequilibrio a favor del color. Uno frente a una celda vacía también cuenta, aunque el footprint no lo marca; y en una celda con desequilibrio de los dos lados, el footprint marca solo el mayor."),
    "VD": ("Volume Decline", M15, "Motor 8: en el extremo hacia donde fue el precio, el lado que empuja decrece en sus tres precios (la compra hacia el máximo de 5 velas: bajista; la venta hacia el mínimo: alcista); si no hace ninguno, el pasivo crece del 1.º al 3.º precio desde el inicio, como antes. En una vela de mucho volumen.", "de cerca, las tres celdas del extremo marcado, decreciendo hacia él; abajo, el volumen."),
    "TP": ("Thin Print", M15, "Un nivel interior con contrapartida 0 (hasta 3 por vela), en una vela de mucho volumen.", "de cerca, un marco en cada celda interior con un lado vacío; abajo, el volumen."),
    "OP": ("Open POC", M15, "El POC de la vela queda fuera del rango de las 5 velas anteriores por al menos 0.25 ATR, en una vela de mucho volumen.", "el POC de la vela (línea azul) y el rango de las 5 anteriores; abajo, el volumen."),
    "RX": ("Ratio de extremos", M15, "En el lado pasivo, el 2.º precio dividido por el extremo da menos de 0.70 o más de 30, en una vela de mucho volumen.", "de cerca, las dos celdas del extremo del lado pasivo; abajo, el volumen."),
    "XD": ("Extreme Delta", M15, "El delta cierra en el 95% o más de su máximo (o mínimo) exacto dentro de la vela, con la razón delta/volumen sobre el umbral relativo.", "la tabla de la vela: el delta, resaltado, cierra en su máximo (o mínimo); al pie, contra su umbral."),
    "SM": ("Small Min/Max Delta", M15, "El lado contrario al color apenas movió el delta: un mínimo de delta pequeño en una verde, un máximo pequeño en una roja.", "la tabla de la vela: el Máx o el Mín Δ del lado contrario, resaltado y casi en cero."),
    "BR": ("Barrido real", M15, "La mayor orden agresiva de la vela que cruzó 3 precios o más, con USD sobre el umbral relativo.", "la franja de la orden y, de cerca, las celdas de los precios que cruzó, con un marco; al pie, sus USD contra el umbral."),
    "GR": ("Orden grande", M15, "La mayor orden agresiva de la vela, con USD sobre el umbral relativo.", "la franja de la orden y, de cerca, la celda de su precio (o las que cruzó), con un marco; al pie, sus USD contra el umbral."),
    # Perfil por sesión y liquidaciones
    "VR": ("Regreso al valor de la sesión anterior", M15, "La sesión (un día, en UTC) abre fuera del área de valor de la anterior y 30 minutos de cierres seguidos quedan dentro: va al borde contrario. Una vez por sesión.", "el valor de la sesión anterior (POC, VAH y VAL) y el regreso del precio."),
    "VF": ("Fallo fuera del valor de la sesión anterior", M15, "Con el cierre anterior dentro del valor, una vela pasa el VAH o el VAL y en 3 velas una cierra de vuelta dentro: va al POC.", "el borde pasado y el cierre de vuelta dentro."),
    "VX": ("Aceptación fuera del valor de la sesión anterior", M15, "30 minutos de cierres seguidos fuera del valor del mismo lado: sigue la salida. Una vez por lado y sesión.", "los cierres fuera del valor anterior."),
    "VE": ("Extremo del valor de la sesión anterior", M15, "La sesión abre dentro del área de valor de la anterior y el precio llega a un borde: en el VAL compra y en el VAH vende, con el objetivo en el POC.", "las líneas del valor anterior y que la vela resaltada toque el borde."),
    "LIQz": ("Barrido de la zona de liquidaciones", M15, "El precio estuvo entero de un lado de una zona de liquidaciones a la vista y una vela pasa su borde contrario: bajar a través de la zona es alcista (barrió esas liquidaciones) y subir, bajista.", "la zona barrida (resaltada entre las demás) y que la vela resaltada la atraviese."),
    "LIQs": ("Barrido de un swing en una zona de liquidaciones", M15, "El precio pasa un swing (5 velas a cada lado) que cae dentro de una zona de liquidaciones a la vista: barrer un mínimo es alcista y un máximo, bajista.", "el swing pasado, la zona donde cae y la vela que lo pasa."),
}

PAGES = [
    ("1_velas", "Velas, patrones y cajas", ["FV", "IM", "SP", "VH", "RF", "RBg", "RBs", "HM", "EN", "DJ", "GC", "BX", "BE", "CP", "CC"],
     ""),
    ("2_vpa", "Lector VPA", ["QA", "QV", "QB", "QF", "QR", "QT", "QS", "QC", "QE", "QG"],
     "Volumen y rango de cada vela se miden contra lo normal de su misma hora en los 30 días anteriores; desde el 24/11, un volumen alto lo es también frente a las 20 velas anteriores (lo que ve el ojo). Cada lectura es un grado de 0 a 100% y cuenta desde 50%. Una vela ancha con volumen alto tuvo resultado, también para el medidor. Los elementos que cambiaron el 24/11 y los dos nuevos traen casos nuevos. Cada vela que ya era caso conserva tu marca; las capturas llevan el medidor nuevo."),
    ("3_williams_smc", "Williams y SMC", ["WD", "WA", "WF", "BS", "OB", "BK", "EQ"], ""),
    ("4_orderflow", "Order flow (footprint)", ["VA", "OG", "AP", "SL", "RL", "EX", "ZP", "DT", "RS", "DD", "PD", "IV", "AD", "SW", "VL", "SQ", "DB", "PW", "DV",
                                               "ST", "VI", "IR", "RD", "VD", "TP", "OP", "XD", "SM", "BR", "GR"],
     "Con los trades reales del almacén. El «inicio» de una vela es su mínimo si es verde y su máximo si es roja. «Agresor a favor» son las compras en una verde y las ventas en una roja; «pasivo», el lado contrario. Los umbrales «relativos» salen de los 30 días anteriores, para que cada elemento marque cerca del 5% de las velas. «Vela de mucho volumen»: 2 o más veces la mediana de las 20 anteriores. Desde el 25/11 el footprint va con las celdas con que se calcula el elemento (de 1 a 10 USD, según el precio: de lejos se ve como un mapa de calor) y con el POC de cada vela; los Elementos OF muestran solo ese elemento, y abajo van el volumen y la tabla de la vela (delta, Máx Δ, Mín Δ, Δ/Vol y delta acumulado del día). En los de desequilibrios, el footprint marca los de 4 a 1 en diagonal. En los elementos de celdas, la segunda imagen es de cerca: la zona del elemento en la vela de la señal, con un marco azul en sus celdas y, en cada celda, la venta a la izquierda y la compra a la derecha (una celda sin cifra es un 0 exacto; «0» es algo de menos de 0.05 BTC). Al pie, el valor del elemento contra su umbral. Desde el 26/11 (motor 8), los nueve elementos que cambiaron con lo que decidiste en esta galería traen casos de su corrida nueva: la absorción en varios intentos, Exhaustion Print, Delta Tail, Delta Divergence, Inverse Imbalance, Acumulación/Distribución, Vertical Liquidity, Sequencing y Volume Decline. Cada vela que ya era caso conserva tu marca; las demás empiezan sin marca. El ratio de extremos salió de la página."),
    ("5_perfil_liq", "Perfil por sesión y liquidaciones", ["VR", "VF", "VX", "VE", "LIQz", "LIQs"],
     "El perfil es el de la sesión anterior ya cerrada (un día, en UTC), con el volumen real del almacén. Las zonas de liquidaciones son las del indicador Liquidaciones a la vista en esa vela."),
]


def picture(path, width=1000, quality=68):
    from PIL import Image  # aquí: galeria_cifras.py usa este módulo con el python de App 1, que no tiene PIL
    img = Image.open(path).convert("RGB")
    if img.width > width:
        img = img.resize((width, round(img.height * width / img.width)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=quality, optimize=True)
    # Con su tamaño en la etiqueta, la página no se corre mientras cargan las imágenes (los enlaces a cada elemento)
    uri = "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")
    return f'src="{uri}" width="{img.width}" height="{img.height}"'


def caption(meta):
    detail = (meta or {}).get("detail") or ""
    head = detail.split("\n")[0]
    side = "largo" if "Largo" in head else ("corto" if "Corto" in head else "")
    m = re.search(r"Señal ([^·]+)", detail)
    return (m.group(1).strip() if m else "", side)


def pick(items, k):
    """Hasta k casos variados de los capturados (en orden de la fase): repartidos en la fase y, si hay de los dos
    lados, la mitad largos y la mitad cortos (o todos los del lado que tenga menos). k = 0: todos."""
    if not k or len(items) <= k:
        return list(items)

    def spread(group, q):  # q casos repartidos en el grupo, sin tomar los bordes
        m = len(group)
        return list(group) if q >= m else [group[int((j + 0.5) * m / q)] for j in range(q)]

    longs = [it for it in items if it["side"] == "largo"]
    shorts = [it for it in items if it["side"] == "corto"]
    if not longs or not shorts or len(longs) + len(shorts) < len(items):
        return spread(items, k)
    q_short = min(len(shorts), k // 2)
    q_long = min(len(longs), k - q_short)
    q_short = min(len(shorts), k - q_long)
    return sorted(spread(longs, q_long) + spread(shorts, q_short), key=lambda it: it["i"])


def build_page(slug, title, codes, note, runs, nav_pages, per_element=PER_ELEMENT, runs_m7=None, runs_m8=None):
    runs_m7, runs_m8 = runs_m7 or {}, runs_m8 or {}
    parts, nav, total, missing = [], [], 0, []
    for code in codes:
        name, market, definition, look = E[code]
        m8 = code in M8 and (SHOTS / f"G8_{code}").exists()
        m7 = not m8 and code in M7 and (SHOTS / f"G7_{code}").exists()
        folder = SHOTS / (f"G8_{code}" if m8 else f"G7_{code}" if m7 else f"G_{code}")
        prefix = f"{code}8" if m8 else f"{code}7" if m7 else code
        runs_new = runs_m8 if m8 else runs_m7 if m7 else {}
        # Una captura con los paneles puede no tener la de solo el precio (los rombos del motor 7)
        files = sorted({folder / re.sub(r"_paneles(?=[.]jpg$)", "", f.name) for f in folder.glob("trade_[0-9][0-9][0-9][0-9]*.jpg")
                        if re.fullmatch(r"trade_[0-9]{4}(_paneles)?[.]jpg", f.name)}) if folder.exists() else []
        if not files:
            missing.append(code)
            continue
        nav.append(f'<a href="#{code}">{html.escape(name)}</a>')
        items = []
        for i, img in enumerate(files, 1):
            meta_path = img.with_suffix(".json")
            meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
            when, side = caption(meta)
            # 23/11: si hay captura con los paneles (la barra de volumen y los indicadores de abajo), va esa
            shown_img = img.with_name(img.stem + "_paneles.jpg")
            # 25/11: en el order flow, la imagen de cerca de las celdas del elemento, con sus cifras (galeria_of.py)
            close = img.with_name(img.stem + "_cerca.jpg")
            items.append({"i": i, "img": shown_img if shown_img.exists() else img, "when": when, "side": side,
                          "n": int(img.stem.split("_")[1]), "close": close if close.exists() else None})
        chosen = pick(items, per_element)
        # 23/11: el número de los elementos de volumen (cuánto volumen tuvo la vela), de galeria_cifras.py
        figures_path = folder / "cifras.json"
        figures = json.loads(figures_path.read_text(encoding="utf-8")) if figures_path.exists() else {}
        # 24/11: tras rehacer una corrida, cada caso lleva la clave de su vela (keys de galeria_corridas_m7.json): una
        # vela que sigue conserva su marca y una nueva empieza sin marca. Un texto es la clave entera (la de una página
        # anterior, como QE-7); un número, su lugar con el prefijo de la página
        keys = (runs_new.get(code) or {}).get("keys") or {}
        cases = []
        for shown, it in enumerate(chosen, 1):
            img, when, side, n = it["img"], it["when"], it["side"], it["n"]
            own = keys.get(str(n), it["i"])
            key = own if isinstance(own, str) else f"{prefix}-{own}"  # su lugar entre los capturados: las marcas siguen
            figure = figures.get(str(n))
            figure = f'<br><b>{html.escape(figure[:1].upper() + figure[1:])}</b>' if figure else ""
            close = (f'<img loading="lazy" {picture(it["close"])} alt="{html.escape(name)}, caso {shown}, de cerca">'
                     if it.get("close") else "")
            cases.append(
                f'<figure class="case" id="{key}"><img loading="lazy" {picture(img)} alt="{html.escape(name)}, caso {shown}">{close}'
                f'<figcaption><b>Caso {shown}</b> · señal {html.escape(when)} (hora de Colombia) · {side} · trade {n} de la corrida{figure}'
                f'<div class="marks" data-key="{key}" data-trade="{n}">'
                f'<label><input type="radio" name="{key}" value="Sí"> Sí, es lo que entiendo</label>'
                f'<label><input type="radio" name="{key}" value="No"> No</label>'
                f'<label><input type="radio" name="{key}" value="No sé"> No sé</label>'
                f'<input type="text" class="note" placeholder="Nota (opcional): qué ves distinto"></div></figcaption></figure>')
            total += 1
        info = runs_new.get(code) or runs.get(code) or {}
        trades = info.get("trades")
        parts.append(
            f'<section id="{code}"><h2>{html.escape(name)} <small>{market} · fase 1 · {len(chosen)} casos de {trades} trades</small></h2>'
            f'<p class="def"><b>Cómo lo calcula la app:</b> {html.escape(definition)}</p>'
            f'<p class="look"><b>Qué mirar:</b> {html.escape(look)}</p>'
            f'<p class="run">Corrida {html.escape(info.get("run", ""))}</p><div class="grid">{"".join(cases)}</div></section>')
    pages = " · ".join(f'<a href="GALERIA_{s}.html"{" class=here" if s == slug else ""}>{html.escape(t)}</a>' for s, t in nav_pages)
    how_many = (f"Son hasta {per_element} por elemento, repartidos en la fase y, si los hay, de los dos lados."
                if per_element else "Son todos los capturados de cada elemento, a lo largo de la fase.")
    page = (TEMPLATE.replace("{{TITLE}}", html.escape(title)).replace("{{PAGES}}", pages).replace("{{NOTE}}", html.escape(note))
            .replace("{{HOW_MANY}}", how_many)
            .replace("{{NAV}}", " · ".join(nav)).replace("{{SECTIONS}}", "".join(parts)).replace("{{TOTAL}}", str(total))
            .replace("{{KEY}}", f"galeria_etapa7_{slug}"))
    return page, total, missing


def main(out_dir, per_element=PER_ELEMENT):
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    runs = json.loads(RUNS.read_text(encoding="utf-8"))
    nav_pages = [(s, t) for s, t, _, _ in PAGES]
    for slug, title, codes, note in PAGES:
        runs_m7 = json.loads(RUNS_M7.read_text(encoding="utf-8")) if RUNS_M7.exists() else {}
        runs_m8 = json.loads(RUNS_M8.read_text(encoding="utf-8")) if RUNS_M8.exists() else {}
        page, total, missing = build_page(slug, title, codes, note, runs, nav_pages, per_element, runs_m7, runs_m8)
        path = out_dir / f"GALERIA_{slug}.html"
        path.write_text(page, encoding="utf-8")
        print(f"{path.name}: {total} casos" + (f" · sin capturas: {', '.join(missing)}" if missing else "") + f" ({path.stat().st_size / 1e6:.1f} MB)")


TEMPLATE = """<!doctype html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Galería · {{TITLE}}</title>
<style>
:root { --bg: #f6f7f9; --card: #ffffff; --ink: #1d2433; --muted: #5b6576; --line: #d9dee6; --accent: #2f6fde; --ok: #157f3b; --bad: #b42318; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 "Segoe UI", system-ui, sans-serif; }
header { position: sticky; top: 0; z-index: 5; background: var(--card); border-bottom: 1px solid var(--line); padding: 10px 20px; }
header h1 { margin: 0 0 2px; font-size: 19px; }
header p { margin: 3px 0; color: var(--muted); max-width: 1150px; font-size: 14px; }
.pages a { color: var(--accent); text-decoration: none; font-size: 14px; }
.pages a.here { color: var(--ink); font-weight: 600; }
.bar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-top: 6px; }
button { background: var(--accent); color: #fff; border: 0; border-radius: 6px; padding: 7px 13px; font: inherit; cursor: pointer; }
button.alt { background: #e8edf5; color: var(--ink); }
#count { color: var(--muted); font-size: 14px; }
nav { padding: 10px 20px; font-size: 14px; }
nav a { color: var(--accent); text-decoration: none; }
section { padding: 6px 20px 22px; scroll-margin-top: 190px; }
.case { scroll-margin-top: 190px; }
h2 { font-size: 18px; margin: 16px 0 6px; }
h2 small { color: var(--muted); font-weight: 400; font-size: 13px; }
.def, .look { max-width: 1150px; margin: 4px 0; }
.note-page { padding: 0 20px; color: var(--muted); max-width: 1150px; }
.run { color: var(--muted); font-size: 12px; margin: 2px 0 10px; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 520px), 1fr)); gap: 14px; }
.case { margin: 0; background: var(--card); border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.case img { width: 100%; height: auto; display: block; cursor: zoom-in; }
figcaption { padding: 8px 10px 10px; font-size: 13px; color: var(--muted); }
figcaption b { color: var(--ink); }
.marks { display: flex; flex-wrap: wrap; gap: 6px 14px; margin-top: 6px; color: var(--ink); }
.marks .note { flex: 1 1 100%; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.case.si { border-color: var(--ok); }
.case.no { border-color: var(--bad); box-shadow: 0 0 0 2px rgba(180,35,24,.15); }
#zoom { position: fixed; inset: 0; background: rgba(10,14,22,.92); display: none; align-items: center; justify-content: center; z-index: 10; cursor: zoom-out; }
#zoom img { max-width: 98vw; max-height: 96vh; }
</style></head>
<body>
<header>
<h1>Galería de elementos · {{TITLE}}</h1>
<div class="pages">{{PAGES}}</div>
<p>Cada caso es una señal real del probador (motor 6, copia aislada, BTC fase 1). {{HOW_MANY}} Marca si
lo que la app llama así es lo que tú entiendes por ese elemento. No importa si el trade ganó o perdió. La franja vertical
azul es la vela de la señal (cuando la regla decide) y el cuadro dice qué se cumplía; las marcas y cajas claras son el
elemento; la caja verde y roja es el trade. La regla entra en la apertura de la vela siguiente a la resaltada. La captura
termina unas velas después de la señal, para que el elemento se vea grande: el trade puede seguir fuera de la imagen. Un
clic en la imagen la agranda.</p>
<div class="bar"><button id="copy">Copiar mis marcas de esta página</button><button class="alt" id="clear">Borrar mis marcas</button>
<span id="count"></span></div>
</header>
<p class="note-page">{{NOTE}}</p>
<nav>{{NAV}}</nav>
{{SECTIONS}}
<div id="zoom"><img alt=""></div>
<script>
const KEY = '{{KEY}}';
let store = {};
try { store = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { store = {}; }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) {} };
const total = {{TOTAL}};
function paint() {
  let si = 0, no = 0, duda = 0;
  document.querySelectorAll('.marks').forEach(m => {
    const k = m.dataset.key, v = store[k] || {};
    m.querySelectorAll('input[type=radio]').forEach(r => { r.checked = r.value === v.mark; });
    m.querySelector('.note').value = v.note || '';
    const fig = m.closest('.case');
    fig.classList.toggle('si', v.mark === 'Sí');
    fig.classList.toggle('no', v.mark === 'No');
    if (v.mark === 'Sí') si++; else if (v.mark === 'No') no++; else if (v.mark === 'No sé') duda++;
  });
  document.getElementById('count').textContent = `Sí ${si} · No ${no} · No sé ${duda} · sin marcar ${total - si - no - duda} de ${total}`;
}
document.addEventListener('change', e => {
  const m = e.target.closest('.marks'); if (!m) return;
  const k = m.dataset.key; store[k] = store[k] || {};
  if (e.target.type === 'radio') store[k].mark = e.target.value;
  if (e.target.classList.contains('note')) store[k].note = e.target.value;
  save(); paint();
});
document.addEventListener('input', e => {
  if (!e.target.classList.contains('note')) return;
  const k = e.target.closest('.marks').dataset.key; store[k] = store[k] || {}; store[k].note = e.target.value; save();
});
document.getElementById('copy').onclick = async () => {
  const lines = ['Galería · {{TITLE}}: ' + document.getElementById('count').textContent];
  document.querySelectorAll('section').forEach(s => {
    const title = s.querySelector('h2').childNodes[0].textContent.trim();
    const rows = [...s.querySelectorAll('.marks')].map((m, i) => {
      const v = store[m.dataset.key] || {};
      return (v.mark && v.mark !== 'Sí') || v.note ? `caso ${i + 1} (trade ${m.dataset.trade}): ${v.mark || 'sin marcar'}${v.note ? ' (' + v.note + ')' : ''}` : null;
    }).filter(Boolean);
    const marked = [...s.querySelectorAll('.marks')].filter(m => (store[m.dataset.key] || {}).mark).length;
    lines.push(`${title}: ${marked} marcados` + (rows.length ? ' · ' + rows.join('; ') : (marked ? ' · todos "Sí"' : '')));
  });
  const text = lines.join('\\n');
  try { await navigator.clipboard.writeText(text); alert('Copiado. Pégalo en el chat.'); }
  catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); document.execCommand('copy'); t.remove(); alert('Copiado. Pégalo en el chat.'); }
};
document.getElementById('clear').onclick = () => { if (confirm('¿Borrar todas tus marcas de esta página?')) { store = {}; save(); paint(); } };
const zoom = document.getElementById('zoom');
document.addEventListener('click', e => {
  if (e.target.matches('.case img')) { zoom.querySelector('img').src = e.target.src; zoom.style.display = 'flex'; }
  else if (e.target.closest('#zoom')) zoom.style.display = 'none';
});
paint();
</script>
</body></html>
"""

if __name__ == "__main__":
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else PER_ELEMENT)
