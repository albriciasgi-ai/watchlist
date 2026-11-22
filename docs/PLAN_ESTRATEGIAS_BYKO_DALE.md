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

Solo con lo que pase la fase 2:
- un detector en vivo como el de Williams y SMC, sin enviar nada al bot;
- las zonas de Dale y los bordes de Byko pasan solos a la defensa de zona y al estudio del libro;
- un panel con la firma del OI de cada moneda.
