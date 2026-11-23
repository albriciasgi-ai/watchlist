# Plan: estrategias de Byko y de Trader Dale

Decidido con el usuario el 21/11/2026, a partir de tres PDF de `Dropbox\Altagracia\Capacitación`. Este archivo es la
hoja de ruta. Lo hecho en cada paso queda además en el CLAUDE.md de la app que lo recibe.

## Las fuentes

| PDF | Autor | Qué trae |
|---|---|---|
| "estrategias Byko con open interest" (5 págs.) | Byko | Tres firmas del OI: ruptura de valor, trampa de absorción y reversión por liquidación |
| "Trading strategys" (20 láminas) | Byko (Bikotrading Academy) | Falso rompimiento y ruptura de un rango |
| "ORDER-FLOW-Trading-Setups-Golden-ticket-edition" (160 págs.) | Trader Dale | Zonas de volumen con entrada en el primer regreso, cuatro confirmaciones, salidas y tres setups de Volume Profile |

**Ninguno trae estadísticas:** solo ejemplos elegidos. El libro de Dale dice que sus trades son hipotéticos y que
ninguno se operó en una cuenta real. Todo lo de aquí es una hipótesis que pasa por las tres fases del probador y sus
controles, como cualquier regla.

## Los dos experimentos

### 1. Cómo llega el precio al borde (Byko)

Cuatro de las cinco reglas de Byko dicen lo mismo: la forma de llegar al nivel decide.
- **Ruptura real:** el precio llega lento, con mínimos crecientes, arma una acumulación pegada al borde y el OI sube lento y parejo.
- **Ruptura falsa:** llega impulsivo, rompe con volumen extremo y el OI salta sin que el precio avance.

La quinta, la caída brusca del OI al final de un movimiento acelerado, marca el agotamiento: va aparte, como "purga de OI".

**Cómo se prueba:**
- cada llegada a un borde de rango, con su firma medida: velocidad en ATR, mínimos crecientes, volumen contra su hora, y OI lento o en salto;
- con dos trades simulados: seguir la ruptura y operarla en contra;
- con los dos controles de siempre (azar y tramo) y uno propio: **el mismo borde sin la firma**. Si la firma no le gana, no aporta nada sobre una ruptura cualquiera.

### 2. La zona y el primer regreso (Dale)

Lo nuevo no son las zonas, sino cuándo entrar en ellas:
- una zona marcada por el volumen: un cluster en una tendencia o en un rechazo, un nodo doble (POC alineado), una orden grande o desequilibrios apilados;
- el precio se aleja una o dos velas completas de 30m;
- se entra en el **primer** regreso, nunca en el segundo.

El probador entra hoy en la vela del evento, o con una limit que vence en pocas velas: esto nunca se probó.
- **Control propio:** zonas al azar con la misma mecánica (mismo alto, mismo alejamiento y primer regreso), como el del perfil desplazado.
- Es también el proceso manual del usuario: el movimiento con volumen, su perfil, el nodo de más volumen, el OI subiendo y una limit esperando.

## Reglas literales de los PDF

Se corren primero tal cual. Las cifras que los PDF no dan se fijan en este archivo **antes** de la primera corrida
de su paso, con pocas variantes declaradas.

| Regla | Lo que dice el PDF | Por fijar antes de correr |
|---|---|---|
| Falso rompimiento | Rango marcado en 1h. El precio llega rápido e impulsivo, rompe el borde con 3 a 5 veces el volumen medio y vuelve adentro. Se entra al volver, con el stop sobre la mecha y el objetivo 1:3. Mira la entrada en 5m | Fijado en el paso 2 (FB) |
| Ruptura | Rango largo. El precio llega lento y parejo al borde y arma una pequeña acumulación pegada a él. Se entra al romper, con el stop bajo el último retroceso y 1:3 | Fijado en el paso 2 (BA) |
| Ruptura de valor | 9 o 10 días en rango. El precio se aprieta contra un borde del área de valor y el OI sube lento y sostenido. Se entra al salir del área de valor | Fijado en el paso 2: BA con el filtro "OI sostenido" |
| Trampa de absorción | Tras un movimiento, en un nivel clave, el OI sube rápido y fuerte y el precio no avanza (el delta va muy a favor sin resultado). Se entra en contra | Fijado en el paso 2 (TA) |
| Purga de OI | Al final de un movimiento acelerado, el OI cae de golpe con volumen y delta extremos. Se entra al giro | Fijado en el paso 2 (PO) |
| Zonas de Dale | Zona de volumen en 30m. Se aleja 1 o 2 velas completas; se entra en el primer regreso, al inicio de la zona o en su celda de más volumen. Desequilibrio = 3 veces en diagonal, y apilados desde 3 | El cluster del tramo y el POC de la acumulación; hasta cuándo vale una zona |
| Confirmaciones de Dale | En la zona, en 5m: una orden limit grande, absorción (mucho volumen en los dos lados), agresión a favor con delta, o divergencia del CVD de 1m | Cómo se mide cada una con el almacén |
| Salidas de Dale | Objetivo justo antes del siguiente nodo de volumen (30m). Stop entre 10 y 20% del ATR diario; si la zona pide otro, no se opera. La subasta sin terminar es un imán | Cuántos días de perfil para buscar el siguiente nodo |

## Cómo se juzga

- **Fase 1** para elegir; las **fases 2 y 3**, las **43 monedas nuevas** y las **acciones** para comprobar.
- La Ruptura de caja ya lleva 748 corridas: una variante más tiene que ganarse el lugar en esos datos.
- **Ojo:** el protocolo de pruebas del backtesting global quedó pendiente de aprobación el 21/11. Su H1, sin medir, dice que el azar no copia los filtros de VWAP y EMA. Los controles propios de arriba comparan la misma regla con y sin la pieza, así que no dependen de eso.

## Los pasos

### Paso 1: OI de 5 minutos de Bybit y Binance (empezado el 21/11/2026)

- El usuario pidió bajar los dos exchanges en los dos marcos, en vez de 1 hora de Bybit y 5 minutos de Binance.
- **Lo que se encontró:**
  - los dos dan 5 minutos desde que listan cada moneda;
  - el OI es una foto: 15 minutos, 1 hora y 4 horas salen de tomar el de 5 minutos en su marca.
- **Cómo se hizo:** `backend/oi_history.py` de App 1, guardado en `OrderFlowData/oi/5m/`. Detalle en el CLAUDE.md de App 1, sección "OI DE 5 MINUTOS DE BYBIT Y BINANCE (21/11/2026)".

### Paso 2: Byko, la llegada al borde y la purga de OI

Cuatro elementos del probador, cada uno con su firma y su control "sin la firma". Las cifras quedaron fijadas el
21/11/2026, **antes de la primera corrida**. Después solo se corren las variantes declaradas aquí.

**Común a los cuatro:**
- **Marco:** 1 hora, porque Byko marca el rango en 1 hora.
- **Cajas:** las de la eficiencia con caja de la pestaña Régimen (`er_box`), las mismas de la Ruptura de caja.
- **Fase 1:** las 7 monedas de siempre y las 43 nuevas, por separado.
- **Entrada:** a mercado, en la apertura de la vela siguiente.
- **Stop:** el borde lejano de la zona del elemento, con 0.1 ATR de margen (máximo 6 ATR).
- **Objetivo:** 3R, sin cierre por tiempo.
- **Operación:** una posición a la vez, sin espera tras cerrar.
- **Controles:** el azar, el tramo y "sin la firma". El de sin la firma son los mismos candidatos que no cumplen la firma, con todo lo demás igual.
- **Candidata a la fase 2** si cumple las tres condiciones:
  1. R por trade positivo;
  2. ventaja sobre el azar y sobre el tramo con margen (el criterio de siempre);
  3. diferencia positiva contra "sin la firma", con margen.

  Si cumple 1 y 2 pero no 3, la regla gana sin necesitar la lectura de Byko.

**FB, falso rompimiento:**
- **Perforación:** desde la vela siguiente a la detección de la caja hasta la que la termina, una vela pasa el techo con su máximo (o el piso con su mínimo), y la vela anterior había cerrado dentro.
- **Vuelta:** esa vela o una de las 3 siguientes cierra dentro de la caja. El evento es esa vela y va en contra de la perforación.
- **Firma**, las dos cosas:
  - llegada impulsiva: en las 4 velas hasta la que perfora, el mínimo estuvo a 2 ATR o más bajo el techo;
  - volumen: entre la que perfora y la que vuelve, una vela tiene 3 veces o más la mediana de su hora en los 30 días anteriores.
- **Zona:** del techo al máximo de la perforación. El stop queda sobre la mecha.
- Un evento por lado, hasta que un cierre vuelve al tercio central de la caja.

**BA, ruptura tras acumulación:**
- **Evento:** la vela que cierra fuera de la caja y la termina (la de la Ruptura de caja), a favor.
- **Firma:**
  - las 6 velas anteriores cerraron dentro de la caja y a 1 ATR o menos del borde que se rompe;
  - el mínimo de las 3 últimas es mayor o igual que el de las 3 primeras: mínimos crecientes (al revés en el piso).
- **Zona:** del borde al mínimo de esas 6 velas. El stop queda bajo el último retroceso.

**TA, trampa de absorción:**
- **Llegada:** dentro de una caja ya detectada, una vela llega al quinto de arriba de la caja (su máximo, al techo menos el 20% del alto). Antes, el cierre subió 2 ATR o más desde el mínimo de las 10 velas anteriores. Al revés en el piso.
- **Firma:**
  - el OI subió en las últimas 3 velas con un z de 2 o más (el cambio de 3 velas, contra los de los 30 días anteriores);
  - el cierre avanzó 0.5 ATR o menos en esas 3 velas.
- **Evento:** al cierre de esa vela, en contra.
- **Zona:** del cierre al máximo de las 3 velas.
- Un evento por lado, hasta que un cierre vuelve al tercio central.
- **OI:** la suma de Binance y Bybit (Binance + Bybit ÷ 2). Una llegada sin OI no cuenta en ninguno de los dos grupos.

**PO, purga de OI:**
- **Movimiento acelerado:** el cierre recorrió 3 ATR o más en las últimas 6 velas, y las 3 últimas recorrieron más que las 3 primeras, hacia el mismo lado.
- **Volumen:** la vela tiene 3 veces o más la mediana de su hora.
- **Firma:** el OI cayó en las últimas 2 velas con un z de −2 o menos.
- **Evento:** al cierre de esa vela, en contra del movimiento.
- **Zona:** del cierre al extremo de las 6 velas.
- Después de un candidato, con firma o sin ella, pasan 6 velas sin otro.
- **OI:** la suma, como en TA.

**Variantes declaradas** (no se corren otras):
- las cuatro en 4 horas;
- TA y PO con el OI de Bybit solo;
- BA con el filtro "OI sostenido": la ruptura de valor del PDF del OI.

**Lo que no entra:** el delta de la trampa y de la purga, porque las 43 monedas nuevas no tienen almacén de trades. La proporción de compra y venta agresiva de Binance podría reemplazarlo en una variante futura.

**Hecho el 21/11:**
- los cuatro elementos y el control "sin la firma" en el probador (CLAUDE.md de App 1, "ELEMENTOS DE BYKO EN EL PROBADOR");
- la fase 1 del falso rompimiento y de la ruptura (`OrderFlowData/research/byko/2026-11-21/resumen.md`):
  - el falso rompimiento no funciona en ningún marco;
  - la ruptura tras acumulación es candidata solo en 4 horas y en las monedas nuevas: 95 trades, +0.58 R, con margen sobre los tres controles. La pone casi toda 2022 y los cortos;
- falta la fase 1 de la trampa y la purga, que espera la bajada del OI.

**Fase 2 de BA en 4 horas** (aprobada por el usuario el 21/11). El criterio se fijó antes de correrla:
- **Qué se corre:** la misma regla, sin cambiar nada, en la fase 2 (01/01/2024 a 30/06/2025). Va en las 43 monedas nuevas, en las 7 de siempre y en las 99 acciones.
- **Pasa** si en las monedas nuevas cumple otra vez las tres condiciones de la fase 1: R positivo y ventaja con margen sobre el azar, el tramo y las rupturas sin la firma.
- **En las de siempre y en las acciones** se informa sin exigir margen: en la fase 1 dieron muy pocos trades.
- **Si pasa:** la fase 3 queda para otra decisión del usuario. **Si no pasa:** la regla se descarta y no se ajusta con lo visto.

**Resultado (21/11): no pasa; BA queda descartada.**
- En las monedas nuevas: 74 trades, −0.43 R. Pierde con margen contra el azar, el tramo y las rupturas sin la firma (esas dan +0.01 R).
- En las de siempre: 11 trades, +0.07 R.
- En las acciones: 33 trades, −0.59 R.
- Lo de la fase 1 era de 2022 y de los cortos.

**Trampa y purga, fase 1 (21/11, al terminar la bajada del OI):** ninguna es candidata.
- **Trampa:** en 1 hora, en las monedas nuevas, el salto del OI separa algo. Con él, +0.06 R; sin él, unos −0.23 R. La diferencia tiene margen, pero la regla no supera al azar ni al tramo, y con el OI de Bybit solo la diferencia se va.
- **Purga:** pierde como el azar, y la caída del OI no suma.

**Paso 2 cerrado:** ninguna de las cuatro reglas de Byko da ventaja (22 corridas de la fase 1 y una de la fase 2).

### Paso 3: Dale, la zona y el primer regreso

**Fijado el 21/11/2026, antes de la primera corrida.** Cinco elementos nuevos, cada uno con una zona de Dale y la misma
mecánica de regreso. Después solo se corren las variantes declaradas aquí.

**La mecánica, común a los cinco:**
- **La zona** nace en la vela en que se conoce.
- **Se arma** cuando, después de nacer, 2 velas completas (todo su rango) quedan del mismo lado de la zona: arriba para un largo, abajo para un corto. Es el "se aleja una o dos velas completas" de Dale, y el lado da la dirección: si el precio vuelve desde arriba, largo.
  - Las 2 velas van seguidas: si una toca la zona, la cuenta vuelve a empezar.
  - Si en 200 velas no se arma, la zona se descarta.
- **Entrada:** al armarse se pone una limit en el borde cercano de la zona. Vale 200 velas (unos 4 días en 30m) y se llena en el primer regreso. Cada zona da a lo sumo una entrada.
- **Stop:** entre el 10% y el 20% del ATR diario (el de 14 días, sin el día en curso), como pide Dale.
  - Si el borde lejano de la zona más 0.1 ATR queda más lejos que el 20%, la zona no se opera.
  - Si queda más cerca que el 10%, el stop se aleja hasta el 10%.
- **Objetivo:** 2R. Una posición a la vez, sin espera.
- **Marco:** 30 minutos, como sus footprints.

**Las zonas:**
- **DS, apilados con regreso:** la franja de los desequilibrios apilados (ST) del almacén, sin el filtro de velas de mucho volumen (Dale no lo pide). Solo las 6 monedas con almacén.
- **DN, nodo doble con regreso:** el POC alineado (AP), el mismo POC en dos velas seguidas. Solo las 6 monedas con almacén.
- **DG, orden grande con regreso:** la franja de la orden grande (GR), su "Trades Filter". Solo las 6 monedas con almacén, y sin órdenes del 07/12/2021 al 19/12/2022.
- **DA, acumulación con regreso:**
  - la caja de la pestaña Régimen que termina con una ruptura;
  - la zona es su POC: la franja de 30 filas con más volumen y las vecinas seguidas con el 70% o más;
  - antes de armarse, el precio tiene que llegar a 3 ATR del borde de la caja: el "fuerte movimiento" de Dale.
- **DC, cluster del tramo con regreso:**
  - el tramo del zigzag de 3 ATR, la primera vez que mide 5 ATR o más y cada vez que crece otros 5 ATR, porque las pausas de una tendencia larga aparecen después;
  - se toma el perfil del tramo en 30 filas;
  - el cluster es el pico más alto del perfil (una fila con tanto o más volumen que sus vecinas) dentro del 70% central del tramo, si tiene 1.5 veces o más la mediana de las filas;
  - la zona son esa fila y las vecinas seguidas con el 70% o más. Una franja que se cruza con otra del mismo tramo no se repite. Es también el proceso manual del usuario.
  - **Corregido antes de la primera corrida**, al probar con velas armadas: mirando una sola vez, el perfil tomaba la base del movimiento y no veía las pausas.
- **El volumen por precio** de DA y DC se reparte parejo en el rango de cada vela, en todas las monedas. Es una aproximación: el almacén solo lo tienen 6.

**Control "zonas desplazadas":** cada zona se mueve entre 1 y 3 ATR hacia arriba o hacia abajo, al azar pero siempre igual, con el mismo alto y la misma mecánica.

**Candidata a la fase 2:** las mismas tres condiciones de Byko:
1. R por trade positivo;
2. ventaja sobre el azar y sobre el tramo con margen;
3. ventaja sobre las zonas desplazadas con margen.

**Variantes declaradas** (no se corren otras):
- DA y DC en 1 hora (Dale dice que los setups de perfil valen también en 1 hora);
- DC en 30 minutos con el filtro "OI sostenido": el proceso del usuario pide el OI subiendo.

**Lo que no entra todavía:**
- el setup de rechazo, que necesita el footprint de la vela de rechazo;
- las confirmaciones en 5m;
- el objetivo antes del siguiente nodo;
- la subasta sin terminar.

**Hecho el 21/11:** los cinco elementos y el control de zonas desplazadas en el probador (CLAUDE.md de App 1, "ZONAS DE TRADER DALE CON EL PRIMER REGRESO").

**Fase 1 (21 y 22/11): ninguna es candidata.** Son 16 corridas: las cinco zonas en 30 minutos y las variantes declaradas (`OrderFlowData/research/dale/2026-11-21/resumen.md`).
- **Dónde estuvo el volumen no aporta.** Ninguna zona le gana con margen a las mismas zonas desplazadas.
  - Los apilados dan +0.01 R por trade en las monedas de siempre (16,703 trades) y +0.04 en XRP. Sus zonas desplazadas dan +0.10 y +0.09: en las de siempre, la zona real pierde con margen contra una cualquiera.
  - Las otras cuatro pierden de −0.07 a −0.19 R, como sus zonas desplazadas.
- **La mecánica le gana al azar, pero pierde.** Alejarse y entrar con una limit en el primer regreso da más que entrar a mercado en velas al azar en 15 de las 16 corridas, hasta +0.25 R por trade y con margen en 9. Parte es la comisión de maker. Salvo los apilados, todas pierden.
- **El proceso del usuario** (el cluster del tramo con el OI sostenido) da −0.10 R en las de siempre y −0.13 en las nuevas, sin diferencia con las zonas desplazadas.
- **Una curiosidad sin valor de prueba:** las zonas desplazadas de los apilados ganan +0.09 a +0.10 R. Salió de un control, después de mirar los datos: solo vale como una hipótesis nueva, fijada antes de correrla y juzgada en las fases 2 y 3. Así se hizo: es DX, más abajo.
- **SUI** pasó a tener almacén mientras corría la fase. DS, DN y DG se repitieron con ella, sin cambiar las reglas, y dan lo mismo.

**Paso 3 cerrado:** las cinco zonas de Dale quedan descartadas en la fase 1.

### Hipótesis nueva: los apilados desplazados (DX)

**Fijada el 22/11/2026, antes de correrla en las fases 2 y 3**, a pedido del usuario. Sale del control de DS en la fase 1, mirado después de correrlo: las zonas desplazadas de los apilados dieron +0.097 R por trade en las monedas de siempre (12,364 trades) y +0.091 en XRP (3,010). Por eso no tiene valor de prueba en la fase 1, y se juzga solo con lo que no se miró.

**La regla, DX, es exactamente ese control:**
- cada franja de desequilibrios apilados (ST) del almacén, sin el filtro de velas de mucho volumen;
- movida entre 1 y 3 ATR arriba o abajo, con la misma semilla del control de la fase 1, y con el mismo alto;
- la mecánica de Dale sin cambios: se arma con 2 velas completas de un lado en 200 velas, limit en el borde cercano válida 200 velas, stop entre el 10% y el 20% del ATR diario (borde lejano más 0.1 ATR; más lejos que el 20%, no se opera), objetivo de 2R;
- 30 minutos, una posición a la vez, sin espera.

**Monedas:** las 7 con almacén de trades, juntas: BTC, ETH, SOL, ARB, GALA, SUI y XRP.

**Pasa la fase 2** (01/01/2024 a 30/06/2025) si, en las 7 juntas:
1. el R por trade es positivo con margen: el margen al 95% no toca el cero. Es más exigente que antes porque la hipótesis salió de mirar los datos;
2. le gana con margen al azar y al tramo.

**Se informa, sin exigirlo:**
- **el control propio:** las mismas zonas ancladas en velas al azar. Por cada franja, una vela al azar de la fase (semilla por franja), una zona del mismo alto en ATR centrada en su cierre, movida igual de 1 a 3 ATR y con la misma mecánica. Dice si importa el apilado o basta la mecánica;
- cada moneda, cada año y cada lado.

**Después:**
- **si pasa la fase 2,** se corre la fase 3 (desde el 01/07/2025) con la misma regla y el mismo criterio;
- **si no pasa,** queda descartada y la fase 3 no se gasta;
- en ningún caso se ajusta algo con lo visto en la fase 2.

**Resultado (22/11): pasa la fase 2 y la fase 3** (`OrderFlowData/research/dale/2026-11-22/resumen.md`).
- **Comprobación:** en la fase 1, DX dio los mismos trades que el control de DS (12,976 en las de siempre, ya con SUI, y 3,010 en XRP).
- **Fase 2:** 10,747 trades, +0.056 R por trade (de +0.028 a +0.084). Le gana al azar (+0.26) y al tramo (+0.25) con margen. A las zonas ancladas en velas al azar, +0.053, también con margen.
- **Fase 3:** 11,416 trades, +0.030 R (de +0.003 a +0.057). Le gana al azar (+0.30) y al tramo (+0.29) con margen. A las anclas al azar, +0.016, sin margen.
- **Lo que la debilita:**
  - pasa por poco, y la ventaja se achica: +0.099, +0.056 y +0.030 en las tres fases;
  - antes de comisiones es estable (+0.18 en las fases 2 y 3): lo que crece es la comisión, porque los stops se achicaron en % del precio (0.66% a 0.58%);
  - BTC pierde en las dos fases, por la comisión: sus stops son de 0.32% a 0.38%;
  - en la fase 3, las zonas ancladas en velas al azar casi la igualan: lo que queda es, sobre todo, la mecánica;
  - **con deslizamiento** (medido después, sin cambiar el veredicto) solo aguanta si el objetivo va como orden limit y el stop desliza 0.02% o menos. Con las dos salidas a mercado y 0.02%, se va.
- **Lo que sigue** es el paso 4. Las tres fases están usadas: un ajuste, como dejar fuera BTC, sería una hipótesis nueva que solo el registro en vivo podría juzgar.

**Lo que se había propuesto** (antes de fijar las cifras):

- Entrada nueva del probador: en el primer regreso a la zona, tras alejarse N velas completas, con una limit en la zona que vence en X días.
- Zonas:
  - las que ya hay: desequilibrios apilados, POC alineado y orden grande;
  - nuevas: el cluster del tramo y el POC de la acumulación.
- Confirmaciones como filtro al tocar la zona.
- Salidas: objetivo antes del siguiente nodo y stop por ATR diario.
- La subasta sin terminar, con un estudio corto: ¿el precio vuelve a un máximo o mínimo "sin terminar" más que a uno terminado?
- El control de zonas al azar con la misma mecánica.
- Las zonas con footprint van en las 6 monedas con almacén. El cluster del tramo también puede ir en las nuevas, con el perfil por velas.

### Paso 4: en la suite

**Al 22/11:** ninguna regla de Byko ni de las cinco zonas de Dale pasó la fase 2. Solo la hipótesis DX, los apilados desplazados, pasó las fases 2 y 3, por poco y sensible a la ejecución. Es la única que hay para llevar.

Solo con lo que pase la fase 2:
- un detector en vivo como el de Williams y SMC, sin enviar nada al bot;
- las zonas de Dale y los bordes de Byko pasan solos a la defensa de zona y al estudio del libro;
- un panel con la firma del OI de cada moneda.

#### DX en vivo

**Fijado el 22/11/2026, antes de registrar nada.** Es la cuarta mirada a DX y la primera con datos que nadie vio: las tres fases ya se usaron, y lo que diga el registro no se puede ajustar con el histórico.

- **La regla:** la de las fases 2 y 3, sin cambiar nada (la de `OrderFlowData/research/dale/2026-11-22/dx.py`), en las 7 monedas con almacén: 30 minutos, una posición a la vez por moneda.
- **Desde cuándo:** desde que la suite corre este código, moneda por moneda. Una orden que se armó antes no cuenta.
- **Cómo:**
  - al cierre de cada vela de 30 minutos, con el almacén en vivo al día, la suite corre la función del probador (`rule_tester.run`) sobre lo visto en vivo;
  - cada vela se guarda tal como se vio al cerrar y no se vuelve a calcular: el registro es lo que se sabía en ese momento.
  - **Corregido el 22/11, en las primeras horas del registro.** El reinicio de la suite dejó 65 s sin grabar a las 21:27 UTC, y el almacén no da una vela que toca un hueco hasta que la nube la completa. El registro avanzaba sin ella: la vela de las 21:00 UTC quedó saltada en las 7 monedas. Ahora ninguna vela se salta: la que falta se espera hasta que la nube o el día oficial la completen, y las siguientes esperan con ella. El registro que ya la había saltado la vuelve a leer: la orden que esperaba o estaba abierta y con la vela completa no existe se anula, y si algo final cambia, queda como revisión. Una vela que en dos días no llega se salta, con un evento "hueco". Es cómo se leen los datos, no la regla ni el juicio.
- **Qué se anota:**
  - cada orden armada: su limit, su stop, su objetivo y hasta cuándo vale;
  - su entrada, su salida y su R con la cuenta del probador (entrada maker, salidas taker);
  - las que vencen sin llenarse y las que se llenan con otra posición abierta.
- **La ejecución, con la cinta** (lo que el probador no mide):
  - en cada salida, el precio de una orden a mercado disparada en el stop o el objetivo, como las de Bybit: el peor entre el primer trade que toca el nivel y el promedio, pesado por cantidad, de los trades a mercado del lado de la salida en los 100 ms siguientes;
  - con ese precio, el R con la ejecución medida;
  - si el precio pasó el objetivo en el minuto siguiente al toque: una orden limit ahí se habría llenado.
  - **Corregido el 22/11, antes de registrar nada.** Primero se fijó el promedio del medio segundo siguiente. Probado con la cinta real del 15 al 22/11, en una mecha de BTC ese medio segundo tenía 960 trades, de 65,549 a 65,417: el promedio tomaba precios de después de la vuelta, que una orden a mercado no consigue. Así, 13 de 89 stops salían con deslizamiento a favor. Con la regla nueva ninguno sale a favor.
- **Cuánto hace falta:**
  - las 7 dan de 600 a 700 trades por mes, y cada trade varía unos 1.5 R;
  - el margen al 95% del R por trade queda en ±0.07 a los 3 meses, ±0.05 a los 6 y ±0.03 a los 12;
  - confirmar los +0.03 R de la fase 3 con margen pide un año, y aun así queda justo.
- **El juicio**, con el R por trade de las 7 juntas con la ejecución medida:
  - a los 3 y a los 6 meses se descarta si su margen al 95% queda entero bajo cero; si no, sigue;
  - a los 12 meses pasa si su margen queda entero sobre cero; si no, no pasa.
- **Se informa, sin exigirlo:** el R con la cuenta del probador, cada moneda, cada lado, el deslizamiento medido y la parte de los objetivos que el precio pasó.
- **Nada se ajusta mientras corre.** Un cambio (sin BTC, un stop mínimo en % del precio) es otra hipótesis, con su propio registro.

**Observado al probar el registro (22/11), con días ya usados (del 15 al 22/11):**
- **Zonas unidas:** dos zonas que se arman en la misma vela y del mismo lado se unen en una sola orden. Su stop queda en el borde lejano de la otra zona, lejos del 10% al 20% del ATR diario. Pasó en 17 de los 164 trades, con un riesgo medio del 2.8% del precio y −0.32 R. Las fases 2 y 3 se corrieron así, y el registro lo conserva.
- **Para una versión refinada**, otra hipótesis que se explora en la fase 1 y se juzga con su propio registro:
  - una orden por zona;
  - la tendencia a favor. Es la idea del usuario: una zona de agresión no garantiza un movimiento después.

### Versión refinada de DX: el ripple entre marcos (estudio de la fase 1)

**Fijado el 22/11/2026, antes de correrlo.** El usuario pidió usar para la tendencia de DX el ripple de la sesión del VPA: el medidor del lector VPA leído en un marco mayor (`OrderFlowData/research/vpa/RIPPLE_QB.md`). En la ruptura con volumen salió al revés del libro: con el marco mayor fuerte a favor, la ruptura llega tarde. DX no persigue: espera un retroceso de 1 a 3 ATR con una limit, así que el efecto puede ir en cualquier sentido. Por eso primero se mide. Es un estudio y no elige todavía la regla.

- **La regla:** DX sin cambios, en la fase 1 de las 7 monedas con almacén, con una posición a la vez.
- **El medidor:** el del lector VPA de fábrica, en velas de 4 horas y de 1 día con toda su historia, en su última vela cerrada y del lado del trade. Los estados son los del estudio de QB: fuerte a favor (≥ 1), a favor (≥ 0.3), neutro, en contra (≤ −0.3) y fuerte en contra (≤ −1).
- **A, al armarse la orden:** el R por trade de cada estado, en 4 horas y en 1 día.
- **B, mientras la limit espera:** entre los trades que no estaban en contra al armarse, si el medidor se puso en contra (≤ −0.3) en alguna vela del marco mayor cerrada antes de llenarse la limit. Son los trades que una cancelación habría quitado. Aparte se informa ≤ −1.
- **Los cortes que deciden** (no se miran otros), cada uno en 4 horas y en 1 día:
  - A1, sin el marco mayor en contra (quita ≤ −0.3);
  - A2, sin el marco mayor fuerte a favor (quita ≥ 1), lo que salió en QB;
  - A3, solo con el marco mayor a favor (deja ≥ 0.3);
  - B1, sin que se ponga en contra mientras espera.
- **Vale la pena seguir** si un corte cumple tres cosas:
  1. lo que se queda gana más que lo que se quita, con el margen al 95% de la diferencia sobre cero, en las 7 juntas;
  2. va del mismo lado en al menos 5 de las 7 monedas;
  3. lo que se queda conserva al menos un tercio de los trades.
- **Se informa, sin exigirlo:** el R antes de comisiones, cada moneda, y las de siempre y XRP aparte.
- **Si vale:** se fija la versión refinada con ese corte, una orden por zona y su control (la misma regla sin el ripple), y se corre en la fase 1 por el probador. A ya está en el probador: es el filtro del medidor «leído en». B pide programar la cancelación de la limit.
- **Si no:** el ripple no se lleva a DX, y se decide si vale la pena C: la señal en el marco mayor y la entrada DX en 30 minutos.
- **Ojo:**
  - son 8 cortes, y con el margen al 95% uno podría salir por azar: por eso se piden también las monedas;
  - el estudio cuenta los trades que dio DX. Con una posición a la vez, una orden quitada deja entrar a otra, así que en la regla el efecto puede ser menor. Si vale, el probador tiene la última palabra en la fase 1.

**Resultado (22/11): no vale la pena seguir con el ripple** (`OrderFlowData/research/dale/2026-11-22/RIPPLE_DX.md`).
- DX en la fase 1: 15,986 trades, +0.099 R por trade (+0.226 antes de comisiones).
- **Ningún corte pasa.** El que más se acerca, A3 en 4 horas (solo con el marco mayor a favor), deja el 26% de los trades y le gana a lo que quita por +0.043 R, con un margen que toca el cero (−0.009 a +0.096).
- **No hay una dirección.** Con el medidor neutro, DX rinde menos que con él a favor o en contra: en 4 horas, +0.07 contra +0.11 a +0.14; en 1 día, +0.08 contra +0.11 a +0.25. Lo que separa parece ser que el marco mayor se esté moviendo, no hacia dónde.
- **B va al revés.** Los trades cuya limit se llenó después de que el marco mayor se pusiera en contra ganan lo mismo (4 horas: +0.107 contra +0.113) o más (1 día: +0.198 contra +0.103). Cancelar la orden los habría quitado.
- **Otra curiosidad:** las limit que se llenan antes de que cierre una vela de 4 horas rinden menos (+0.056 R, 3,847 trades) que las que esperan más (+0.11).
- Las dos curiosidades salieron de mirar la fase 1: solo valen como hipótesis nuevas, fijadas antes de correrlas.
- **Corrida corregida.** La primera tomó también AAVE, que pasó a tener almacén después de fijar el estudio. Además, le faltaba el medidor de 4 horas de BTC, ETH y SOL antes del 24/10/2021, porque ahí empieza el caché de App 1. Se repitió con las 7 monedas y las velas de 4 horas completadas desde el almacén de trades, como las de 1 día. Las dos dan lo mismo: ningún corte pasa (`RIPPLE_DX_primera.md`).
- **C** (la señal en el marco mayor y la entrada DX en 30 minutos) se apoya en la misma idea. Como A y B no muestran que el marco mayor le aporte a DX, no se hace por ahora.

### Stop y objetivo más lejos (exploración de la fase 1, 22/11)

Pregunta del usuario: si el stop y el objetivo se alejan 2 a 4 veces, ¿los costos dejan de importar? Las mismas zonas y la misma limit, con el borde lejano (el stop) k veces más lejos de la entrada y el objetivo en 2R. Solo la fase 1, sin gastar nada (`OrderFlowData/research/dale/2026-11-22/ancho_dx.py`, `ancho_x2.json` a `ancho_x4.json`).

| Stop y objetivo | Trades | R por trade | Antes de comisiones | Comisión | Stop en % del precio | Sobre las anclas al azar |
|---|---|---|---|---|---|---|
| ×1 (DX) | 15,986 | +0.099 ±0.023 | +0.226 | 0.127 | ~0.6% | +0.046, con margen |
| ×2 | 9,188 | +0.073 ±0.030 | +0.139 | 0.066 | 1.27% | +0.019, sin margen |
| ×3 | 5,642 | +0.055 ±0.038 | +0.100 | 0.044 | 1.88% | +0.009, sin margen |
| ×4 | 3,729 | +0.067 ±0.046 | +0.101 | 0.034 | 2.49% | +0.016, sin margen |

- **La comisión baja como se esperaba, pero lo que gana cada trade baja más:** de +0.23 a +0.10 R antes de comisiones. El R neto pasa de +0.10 a +0.06 o +0.07.
- **En total se gana mucho menos.** Con una posición a la vez, cada trade dura más (la mediana pasa de 1 hora a 4 y 13 horas) y entran menos. Con el mismo riesgo en dinero por trade, la fase 1 suma unos 1,580 R con ×1 y 250 con ×4.
- **Lo que aportaban los apilados desaparece:** sobre las mismas zonas ancladas en velas al azar, la ventaja deja de tener margen. La ventaja de DX está en el movimiento corto justo después del regreso a la zona.
- BTC, la moneda a la que más le pesa la comisión, no mejora: +0.077 R con ×1 y con ×2, y +0.041 con ×4.
- **Conclusión:** ensanchar no arregla los costos de DX: se queda la versión de siempre.

### Versión refinada de DX: una orden por zona y la tendencia por el precio (fase 1)

**Fijado el 22/11/2026, antes de correrlo.** Son las dos ideas que quedaban para la versión refinada. Solo la fase 1, que es para elegir.

**1. Una orden por zona (DX1).**
- Hoy, si dos zonas DX se arman en la misma vela y del mismo lado, el probador las une en una orden: entra en el borde cercano de una y pone el stop en el borde lejano de la otra, lejos de lo que pide Dale.
- En DX1, de las zonas que se arman en la misma vela y del mismo lado se opera solo la más cercana al precio, que es la del primer regreso, con su propio stop. Las demás no se operan.
- **Se adopta** si, en las 7 juntas, su R por trade no baja respecto a DX y no baja en más de 2 de las 7 monedas. Es un arreglo de la mecánica que la acerca a la regla de Dale, así que no se le pide margen.

**2. La tendencia por el precio.** Se mide al armarse la orden, en la última vela cerrada del marco mayor, con toda su historia:
- T1: el cierre de 4 horas sobre su EMA 200 en los largos, o bajo ella en los cortos;
- T2: el cierre de 1 día sobre su EMA 50, o bajo ella;
- T3: la EMA 50 de 4 horas subiendo en las últimas 6 velas en los largos, o bajando en los cortos.

Cada una es un corte que deja solo los trades con la tendencia a favor. Se mide sobre DX y sobre DX1, y pasa con las tres condiciones del estudio del ripple:
1. lo que se queda le gana a lo que se quita, con el margen al 95% de la diferencia sobre cero;
2. va del mismo lado en al menos 5 de las 7 monedas;
3. conserva al menos un tercio de los trades.

**Si algo pasa:** se fija la versión refinada con eso y se corre por el probador en la fase 1, con sus controles. Las fases 2 y 3 ya se usaron con DX: el juicio sería con su propio registro en vivo, o, si el usuario lo decide, con las fases 2 y 3 solo para ver si el cambio le suma a DX.

**Si nada pasa:** DX queda como está y sigue su registro en vivo.

**Resultado (22/11)** (`OrderFlowData/research/dale/2026-11-22/REFINADA_DX.md`):

**1. DX1 no se adopta.**

| Regla | Trades | R por trade | Antes de comisiones | R total | Sobre las anclas al azar |
|---|---|---|---|---|---|
| DX | 15,986 | +0.099 ±0.023 | +0.226 | +1,588 | +0.046, con margen |
| DX1 | 23,950 | +0.084 ±0.019 | +0.218 | +2,005 | +0.040, con margen |

- Su R por trade baja en 6 de las 7 monedas (todas menos ARB). La diferencia es de −0.016 R, con un margen que toca el cero (−0.045 a +0.014).
- **Lo que se vio:** solo el 4.6% de los grupos de zonas (6,170 de 134,739) trae dos o más. Aun así, DX1 tiene un 50% más de trades. Las órdenes unidas, con su stop lejano, duran mucho y ocupan la posición: al separarlas entran muchas señales que DX dejaba pasar, y esas rinden menos. Por eso sube el R total.
- El registro en vivo sigue con las zonas unidas, como las fases 2 y 3.

**2. La tendencia por el precio pasa, en los 3 cortes y en las dos bases:**

| Base | Tendencia | Se quedan | Con la tendencia a favor | En contra | Diferencia (95%) | Monedas |
|---|---|---|---|---|---|---|
| DX | T1, 4 horas contra su EMA 200 | 49% | +0.143 | +0.055 | +0.088 (+0.042 a +0.134) | 7 de 7 |
| DX | T2, 1 día contra su EMA 50 | 49% | +0.129 | +0.065 | +0.065 (+0.018 a +0.111) | 6 de 7 |
| DX | T3, la EMA 50 de 4 horas en 6 velas | 48% | +0.141 | +0.061 | +0.079 (+0.033 a +0.125) | 6 de 7 |
| DX1 | T1 | 49% | +0.120 | +0.049 | +0.072 (+0.034 a +0.109) | 6 de 7 |
| DX1 | T2 | 49% | +0.108 | +0.058 | +0.050 (+0.012 a +0.088) | 6 de 7 |
| DX1 | T3 | 48% | +0.121 | +0.049 | +0.072 (+0.035 a +0.110) | 7 de 7 |

- Con la tendencia del precio a favor, DX casi gana el triple que en contra. Es la idea del usuario: el medidor VPA no lo mostraba (estudio del ripple, arriba), y el precio sí.
- **La elegida es T1 sobre DX:** es la de margen más alto (+0.042), y va del mismo lado en las 7 monedas.
- **Lo que sigue según lo fijado:** correr DX con T1 por el probador en la fase 1, con sus controles, porque con una posición a la vez una señal quitada deja entrar a otra. Para eso el probador necesita leer la EMA en velas de 4 horas, como el medidor VPA «leído en». Después, cómo se juzga: con su propio registro en vivo, o con las fases 2 y 3 solo para ver si T1 le suma a DX, si el usuario lo decide.

### DX con T1 por el probador (fase 1)

**Fijado el 22/11/2026, antes de correrlo.** El probador ya lee la EMA en un marco mayor: «EMA leída en» (`lines[].tf`), con la EMA y el cierre de la última vela mayor ya cerrada.

- **La regla, DXT:** DX sin cambios, más el filtro «EMA 200 de 4 horas a favor»: el cierre de la última vela de 4 horas cerrada, del lado del trade respecto de su EMA 200. Fase 1, las 7 monedas con almacén, una posición a la vez.
- **Se queda como la versión refinada** si cumple tres cosas:
  1. su R por trade le gana al de DX con margen: la diferencia al 95% queda sobre cero;
  2. le gana con margen a las mismas zonas ancladas en velas al azar, que llevan el mismo filtro;
  3. es positiva en al menos 5 de las 7 monedas.
- **Se informa, sin exigirlo:**
  - el azar y el tramo, que no llevan el filtro de la EMA porque el probador no lo copia en esos controles (la H1 del protocolo de pruebas);
  - el R total, cada moneda, cada año y cada lado.
- **Diferencia con el estudio:** el probador arma las velas de 4 horas con las de la fase. La EMA 200 necesita 200 de ellas, así que el primer mes de la fase de cada moneda no tiene filtro y no opera.

**Resultado (22/11): DXT no se queda** (`OrderFlowData/research/dale/2026-11-22/DXT.md`).

| Regla | Trades | R por trade | R total | Sobre las anclas al azar | Monedas + |
|---|---|---|---|---|---|
| DX | 15,986 | +0.099 ±0.023 | +1,583 | +0.046 (+0.015 a +0.077) | 7 de 7 |
| DXT | 9,974 | +0.117 ±0.029 | +1,170 | +0.034 (−0.006 a +0.074) | 7 de 7 |

- **DXT − DX: +0.018 R por trade (−0.019 a +0.055), sin margen.** Contra las anclas al azar tampoco tiene margen. Solo cumple la de las monedas.
- **Por qué el estudio prometía más:** ahí los trades con la tendencia a favor daban +0.143 R. Pero con una posición a la vez, cada señal que el filtro quita deja entrar a otra, y esas rinden menos. Es lo que el plan advertía.
- **La tendencia ayuda a la mecánica, no a los apilados.** Con el filtro, las zonas ancladas en velas al azar suben más que DX: de +0.053 a +0.083 R, contra +0.099 a +0.117 de DX.
- **Un límite del criterio:** las dos corridas comparten muchos trades, así que el margen de la diferencia sale más ancho que el real. Con este criterio, fijado antes, no alcanza.
- **Conclusión de la versión refinada:** el ripple, las salidas más lejanas, una orden por zona y la tendencia por el precio no le ganan a DX con margen. DX queda como está y sigue su registro en vivo.
- **Lo que queda en el probador:** la EMA leída en un marco mayor, para otras reglas.
