# Plan: indicadores on-chain para el trading de cripto

Decidido con el usuario el 21/11/2026. Este archivo es la hoja de ruta; lo hecho en cada paso queda además en el
CLAUDE.md de la app que lo recibe.

## Por qué así

**La pregunta:** ¿la actividad de las blockchains avisa que se viene un movimiento del precio?

**Lo que dice la evidencia (21/11/2026):**

| Fuente | Qué se sabe | Para nosotros |
|---|---|---|
| MEV y flujo privado | Efecto de ejecución en los DEX de Ethereum, de segundos. El flujo privado no se ve antes de entrar al bloque. Ningún estudio serio lo usa para predecir el precio | **Descartado** |
| Mempool de BTC | Su crecimiento anticipa el volumen 24 a 48 h después. La dirección del precio sale mixta | Filtro de volatilidad, no de dirección |
| Flujos de BTC y ETH a exchanges | En un estudio con prueba fuera de muestra (arXiv 2411.06327, datos hasta 2023), la entrada de BTC casi no predice nada y la de ETH predice a la baja. Casi todo lo demás publicado son gráficos de los vendedores de datos | Probarlo nosotros |
| USDT que entra a exchanges | El mismo estudio: predice retornos positivos de BTC y ETH en 1 a 6 horas | Lo más prometedor, pero los datos por hora son pagos |
| Emisión de USDT y USDC | Suele llegar después de la subida. Es anécdota | Probarlo como filtro lento |
| Hyperliquid | Posiciones, apalancamiento y precio de liquidación de cada billetera, públicos y en tiempo real | Lo que más se parece a lo que ya hacemos (liquidaciones y barridos) |

**La advertencia:** de 141 predictores de Bitcoin, 67 parecían funcionar con los datos con que se armaron y solo 29
dieron algo con datos nuevos. Toda fuente on-chain pasa por las tres fases del probador y sus controles al azar,
como cualquier regla.

**Qué hay gratis con historia larga (revisado el 21/11/2026):**
- **Coin Metrics (API comunitaria):**
  - qué da: flujos de entrada y salida de exchanges y saldo en exchanges de BTC desde 2011 y de ETH desde 2015, y la emisión total de USDT y USDC, todos diarios;
  - qué no da: los flujos de stablecoins a exchanges, ni datos por hora;
  - licencia CC BY-NC 4.0, no comercial: si la suite se vende, hay que pagar la licencia o cambiar de fuente.
- **Dune:** desde septiembre de 2026 la cuenta gratis solo permite mirar. Su prueba es de 7 días con 2,500 créditos y pide tarjeta. Su tabla de flujos a exchanges no tiene Tron.
- **Hyperliquid:**
  - gratis: funding y velas desde mayo de 2023;
  - las ejecuciones (de donde salen posiciones y liquidaciones) solo desde 2025, en Amazon S3 de "paga quien descarga";
  - casi todo cae en la fase 3: no alcanza para elegir en la fase 1 y comprobar en la 2.
- **CryptoQuant:** prueba de 7 días del plan Advanced, con tarjeta. El plan gratis no tiene flujos.
- **Santiment:** el gratis da 1 año con 30 días de atraso.
- **Glassnode:** el gratis da poco y solo diario.

## Los pasos

### Paso 1 — Flujos on-chain diarios en el backtesting global ✅ hecho el 21/11/2026

- **Datos:** `backend/onchain_flows.py` baja Coin Metrics a `OrderFlowData/onchain/coinmetrics.json`. `market_update.py` lo actualiza al arrancar el backend, como mucho cada 2 horas.
- **Filtro "Flujos on-chain (diarios)"** en la sección Filtros del probador, con su gen en la búsqueda genética, apagado de fábrica. Tiene dos medidas:
  - **flujo neto a los exchanges** de BTC o ETH en N días, en % del saldo en exchanges. Salir de los exchanges se lee alcista;
  - **emisión de USDT y USDC** en N días. Que crezca se lee alcista.
- **Cómo filtra:** cada medida va en z-score contra el año anterior. "A favor" pide z ≥ umbral en la dirección del trade; "que no vaya en contra" deja todo menos lo contrario.
- **Sin futuro:** el dato de un día se usa desde las 06:00 UTC del día siguiente. Coin Metrics lo publica entre la 01:00 y las 04:00.
- **Primer estudio** (fase 1, 4h, siete monedas, Impulso y FVG nuevo; detalle en el CLAUDE.md de App 1, sección "FLUJOS ON-CHAIN (21/11/2026)"):
  - el flujo neto de 7 días a favor mejora hasta las entradas al azar (+0.19 R contra +0.01), pero no les suma a las reglas;
  - la emisión de USDT y USDC a favor sube el R de las dos reglas (Impulso de +0.16 a +0.38) y su ventaja sobre los controles, en las 7 monedas;
  - es candidata, no resultado: son pocos días distintos (137) y lo ponen los cortos de 2022 y los largos de 2023.

- **Segundo estudio** (21/11: fase 1, 4 reglas, las 7 de siempre y las 43 nuevas):
  - la emisión a favor no aumenta la ventaja de ninguna regla sobre sus controles;
  - sí sube el R de toda entrada, también la del azar (de −0.04 a +0.12/+0.16 R en las monedas nuevas);
  - se apoya en 2022 y en pocos días distintos.

**Cómo seguir con el paso 1, en orden:**
1. ~~Emisión a favor con las cuatro reglas en la fase 1, en las monedas de siempre y las nuevas.~~ Hecho: no suma ventaja a las reglas.
2. ~~Una prueba del efecto propio del filtro sobre entradas al azar.~~ Reemplazada por la idea del usuario: usarlo para el objetivo, no para entrar.
3. **Objetivo mixto en la fase 1** (21/11): 5R con la emisión de 30 días a favor y 3R sin ella, en una corrida y con sus controles.
   - Da el mayor R total en 5 de 6 casos (tres reglas × dos grupos de monedas).
   - Sube en 2021, 2022 y 2023.
   - Mejora la salida, no la entrada.
   - Ya está en el probador como salida "Otro objetivo con los flujos on-chain a favor".
4. ~~**Fase 2, decidida antes de mirar:** la mixta contra 3R siempre.~~ **No pasó** (21/11):
   - en las monedas nuevas da menos R total en las tres reglas;
   - en la fase 2 los días con el filtro son los peores, al revés que en la fase 1.
5. **También con la ruptura con volumen del VPA** (la regla que pasó las tres fases), en las fases 1 a 3:
   - con el filtro a favor, como "que no vaya en contra" y con el objetivo mixto: ninguna variante mejora en las tres fases;
   - la señal cambió de signo en la fase 2.
6. **Cierre del paso 1:** la emisión de stablecoins y el flujo neto quedan como dato del trade y como opción del probador, sin uso recomendado. **Sigue el paso 2 (Hyperliquid).**

De paso, Impulso, FVG nuevo y la Ruptura de caja con 3R pasaron la fase 2 contra los dos controles: son candidatas a la fase 3. Eso va por el plan de las reglas, no por este.

### Paso 2 — Grabar Hyperliquid desde ya (grabación hecha el 21/11/2026; falta el indicador y el estudio)

**Hecho:**
- `12.AltagraciaTradingSuite/server/hl_recorder.py` graba, con la suite abierta:
  - el estado de cada moneda cada 5 minutos;
  - unas 1,200 cuentas, elegidas una vez al día (300 por capital y 1,000 por volumen del mes);
  - sus posiciones, con el precio de liquidación, cada 15 minutos.
- Ruta `/api/hyperliquid/liqmap/{símbolo}`. Detalle en el CLAUDE.md de la suite, sección "Hyperliquid".
- **Medido el 21/11 en BTC:** 150 M USD de largos y 170 M de cortos se liquidarían a menos de 25% del precio.

**Original:**

Solo hay historia de verdad si la grabamos nosotros, como se hizo con el libro el 13/11.

- **Grabador en la suite** (y en Northflank si hace falta 24/7): cada pocos minutos, las posiciones de las billeteras grandes (más de 1 M USD) de las monedas de la suite y su precio de liquidación, con la API pública `info` (`clearinghouseState`), y el OI y el funding de Hyperliquid.
- **Indicador:** el mapa de liquidaciones reales de Hyperliquid cerca del precio, con la regla de zonas del indicador Liquidaciones de App 1.
- **Estudio, con 4 a 6 semanas grabadas:** ¿el precio va a buscar esos clusters más que a un nivel al azar? Con la misma prueba que la defensa de zona.
- **Opcional, decide el usuario:** bajar del S3 de Hyperliquid las ejecuciones desde 2025. Necesita una cuenta de AWS del usuario y un costo bajo. Sirve como fase 3, no para elegir.

### Paso 3 — Mempool de BTC como filtro de volatilidad (pendiente, con verificación previa)

- **Primero:** comprobar qué historial gratis hay. Blockchain.com da series diarias del tamaño del mempool y de las comisiones; mempool.space no parece dar un historial descargable.
- **Si hay historial:** un filtro "se viene volatilidad" (mempool sobre lo normal), para reglas de ruptura e Impulso. Se prueba como el paso 1.

### Paso 4 — Flujos de stablecoins por hora (solo si los pasos 1 a 3 muestran algo)

- **Es lo del estudio de 1 a 6 horas.** Necesita pagar un mes:
  - Dune Analyst: unos $65 al mes, con flujos EVM sin Tron;
  - o CryptoQuant: su prueba de 7 días, o el plan con flujos.
- **Antes de pagar:** confirmar que el plan trae datos por hora, API y años de historia, y leer sus condiciones sobre bajar historia.
- Se baja una vez a `OrderFlowData/onchain/` y se prueba en 1h y 4h con las tres fases.

### Paso 5 — En vivo en la suite (solo con algo que pase la fase 2)

- El dato al día en el servidor de la suite, en el panel de la Watchlist y como medida del journal.
- Alertas solo por la central de alertas de confluencia que ya está pendiente.

## Reglas para todo el plan

- **Sin futuro:** cada dato se usa desde la hora en que se publica, no desde la fecha que lleva.
- **Contra el azar:** todo se mide contra los dos controles (entradas al azar y seguir el tramo), en las fases 1, 2 y 3, y en las monedas nuevas.
- **Licencias:** revisar antes de llevar un dato a una app que se venda.
