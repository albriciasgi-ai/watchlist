# Revisión visual · Etapa 4 · BTCUSDT · fase 1 · Elementos y filtros de prioridad 1

28 reglas de prueba de un elemento o de un filtro (`tests/audit/reglas_prueba.py`, FL-* y E-*), corridas en el backend
aislado con el motor 5 (ids en `evidencia/corridas_etapa4.log`), más el rombo (R19b). Las de filtro son el FVG nuevo de
0.3 ATR de R01 (a mercado, stop 1.5 ATR, 3R, una posición a la vez) con un filtro; las de elemento usan ese mismo ciclo
con su elemento. Todas en 4h salvo la cola de delta y los desequilibrios apilados (15m).

| Regla | Qué | Trades | R medio | Llamadas capa A | Oráculo A | Oráculo B |
|---|---|---|---|---|---|---|
| FL-VWAP | FVG 0.3 + VWAP 200 a favor, tope 2 desv. | 185 | +0.205 | 6,186 | igual | igual |
| FL-EMA | FVG 0.3 + EMA 50 a favor con pendiente | 226 | +0.244 | 6,226 | igual | igual |
| FL-CVD | FVG 0.3 + CVD 20 a favor | 216 | +0.306 | 6,235 | igual | igual |
| FL-OI | FVG 0.3 + OI sube 2% en 6 | 158 | +0.343 | 6,165 | igual | igual |
| FL-CONF | FVG 0.3 + confluencia OI-volumen | 130 | +0.094 | 6,158 | igual | igual |
| FL-CROWD | FVG 0.3 + no con la multitud | 233 | +0.205 | 6,249 | igual | igual |
| FL-STEADY | FVG 0.3 + OI sostenido | 177 | +0.329 | 6,195 | igual | igual |
| FL-CHAIN | FVG 0.3 + emisión de stablecoins a favor | 108 | +0.330 | 6,126 | igual | igual |
| FL-REG | FVG 0.3 fuera de los rangos | 54 | +0.661 | 6,054 | igual | igual |
| FL-REG1D | FVG 0.3 fuera de los rangos (1D) | 58 | −0.417 | 6,058 | igual | igual |
| FL-BRK | FVG 0.3 tras romper un rango | 19 | +0.644 | 6,019 | igual | igual |
| FL-HORA | FVG 0.3 en horario de Nueva York | 142 | +0.027 | 6,142 | igual | igual |
| E-IM | Impulso 2 ATR en 3 | 184 | +0.236 | 6,184 | igual | igual |
| E-SP | Swing de 5 velas | 266 | −0.213 | 6,267 | igual | igual |
| E-VH | Volumen alto | 190 | +0.114 | 6,191 | igual | igual |
| E-RF | Flecha a favor del tramo | 233 | +0.071 | 6,233 | igual | igual |
| E-HM | Martillo o estrella | 135 | −0.132 | 6,136 | igual | igual |
| E-EN | Envolvente | 217 | −0.034 | 6,218 | igual | igual |
| E-DJ | Doji | 17 | −0.118 | 6,017 | igual | igual |
| E-BX | Ruptura de caja ≤ 5.5 ATR | 108 | +0.286 | 6,108 | igual | igual |
| E-BE | Borde de caja | 99 | −0.037 | 6,100 | igual | igual |
| E-CP | Compresión, dos órdenes stop | 46 | +0.433 | 6,198 | igual | alcance de 4 (O-05) |
| E-QB | Ruptura con volumen (VPA) | 197 | +0.068 | 6,197 | igual | igual |
| E-WF | Ruptura de fractal, a mercado | 274 | −0.012 | 6,275 | igual | igual |
| E-WD | Barra divergente, a mercado | 282 | −0.155 | 6,283 | igual | igual |
| E-WA | AO tres barras, a mercado | 295 | −0.052 | 6,296 | igual | igual |
| E-DT | Cola de delta (15m) | 882 | −0.464 | 6,882 | igual | igual |
| E-ST | Desequilibrios apilados (15m) | 4,559 | −0.210 | 10,560 | igual | igual |
| R19b | Rombo de volumen, giro (stop 2 ATR, 2R) | 88 | −0.148 | 6,088 | igual | igual |

Son reglas de prueba para comprobar las piezas, no estudios: con muchas variantes sobre los mismos datos, un R medio
alto con pocos trades (FL-REG, FL-BRK) no dice nada.

- **Capa A:** todas las llamadas de las 29 corridas (la regla y los dos controles) iguales al oráculo A; con el B, solo
  el alcance de la compresión (O-05).
- **Capa B:** lo que la pantalla dijo de cada trade es igual a la corrida, en todas, y cada una corrida otra vez desde
  cero da lo mismo (`capa_b_etapa4.log` y las de la mañana del 22/11).
- **Capa C:** una captura por trade en `evidencia/pantalla/E4_*`, con la comprobación automática de cada una (entrada,
  salida recalculada con las velas del gráfico, el FVG en la vela de la señal en las de filtro, las dos órdenes en la
  compresión y la tabla de la vela de la señal en ✓): bien en todos los trades de 4h. La cola de delta y los
  desequilibrios apilados se capturaron primero con el gráfico en 4H (O-16) y se repitieron en 15M: bien en los 882 y
  en los 4,559, sin ningún aviso, con el gráfico en velas de 15 minutos en cada captura.
- **Capa B de las capturas en 15M** (22/11): la pantalla dice lo mismo que la corrida en los 882 trades de la cola de
  delta y en los 4,559 de los apilados, y los apilados corridos otra vez desde cero dan los mismos 4,559. La única
  diferencia que salió primero era del comparador, no de la app: el trade 1165 de los apilados tiene R = −1.125 exacto;
  la página lo escribe −1.13 (`toFixed` redondea el empate hacia afuera) y el comparador lo redondeaba a −1.12 (al par).
  Con el comparador redondeando como la página (`js_fixed`), 0 diferencias.
- **Hojas de contactos en 15M** (37 de la cola de delta y 190 de los apilados, 24 trades por hoja), revisadas por seis
  agentes aparte: **ningún trade mal**. Sus dudas se cerraron con los números de la corrida o con la captura a tamaño
  real:
  - objetivos con menos de +2.5 R (hasta −0.45 R en el #3442 de los apilados) y stops de −2 a −5.3 R: son trades con el
    stop muy corto en horas tranquilas, donde la comisión vale de 1 a 3.5 R (H18, con la evidencia de estas dos reglas);
  - lados que no se distinguían en la miniatura (#2588 y #3303 de los apilados): bien en la captura;
  - la línea con "42,324.8" en el eje es el último precio del final de la fase, no del trade (**O-17**).
- **Hojas de contactos** (16 trades por hoja en 4h), revisadas por agentes aparte: **ningún trade mal**. Lo que vieron
  y se comprobó: O-13 (el filtro on-chain se describe desde el largo en los cortos), O-14 (el cuadro de la señal tapa a
  veces la salida y el nombre de la fila tapa sus primeras casillas), O-15 (CVD redondeado, pendiente de la EMA que no
  se ve), el F-08 a la vista (mismo funding mostrado, distinta clase en FL-CROWD) y unas ✕ sueltas que son marcas del
  Lector VPA, encendido en la página aislada. Las dudas de lectura (lado, R, a. m. o p. m.) se cerraron con la captura
  o con su detalle: todas bien.
- **H11:** el único aviso de la comprobación automática en 4h fue el corto del 10/11/2021 (E-VH #79 y E-RF #108, el
  mismo trade): cae en el hueco del archivo de trades de BTC, y las velas del motor y del gráfico difieren ahí. Mismo R.
