# Cálculos de ingeniería para un launch monitor de golf DIY de presupuesto mínimo

Notas del 14/11/2026. Todos los números de las secciones "Inferences" salen de scripts propios en Python 3.13 (numpy 2.5.3, scipy 1.18.1) guardados en `/home/user/watchlist/research_notes/Launch monitor de golf DIY/calculos/`. `python ejecutar_todo.py` los corre todos en unos 4-5 minutos y deja las tablas completas en `calculos/resultados/*.md`. El modelo ajustado queda en `calculos/resultados/modelo_ajustado.json`.

**Limitación de la sesión:** el proxy bloqueó la lectura directa de páginas (patents.google.com, golfmonthly.com, raspberrypi.com, mdpi.com, hackaday.io, pitraclm.github.io y otras), y el cupo de búsquedas compartido se agotó. Los datos citados vienen de los resúmenes del buscador, no de los documentos originales: cada uno lleva su URL, y donde el resumen parecía confuso se dice. Las fórmulas estándar (ISA, ecuación de Buck, ley de Sutherland, velocidad del sonido, CODATA) se citan con su referencia habitual, que no se abrió en esta sesión.

## 1. Simulador de vuelo: modelo publicado, validación contra TrackMan y carry en altitud

### Takeaway
El modelo de Smits & Smith (1994), con sus constantes publicadas, se queda 26-29 yd corto en el driver del PGA Tour y se pasa 6-9 yd en el hierro 7 y el PW. Escalar CD y CL no lo arregla. Reajustar 4 de sus 8 constantes (cd2, cd3, cl1, p) deja el carry del driver y del hierro 7 a ≤2 yd y la altura máxima a ≤2 yd. El ángulo de llegada del hierro 7 queda 3° bajo y el carry del PW 7.5 yd corto. En altitud, el modelo final da en Bogotá +3% de carry con el driver, +9% con el hierro 7 y +13% con el PW. Otras dos variantes que ajustan igual de bien a nivel del mar dan hasta +13.5%, +20% y +21%: el efecto de la altitud **no queda fijado** por los datos a nivel del mar y hay que calibrarlo en el sitio.

### Cited Findings
- Modelo usado: A. J. Smits y D. R. Smith, "A new aerodynamic model of a golf ball in flight", *Science and Golf II* (1994) — [Taylor & Francis](https://www.taylorfrancis.com/chapters/edit/10.4324/9780203474709-54/new-aerodynamic-model-golf-ball-flight-smits-smith).
- Según las patentes que resumen el modelo (US 6,186,002 y/o las "Steerable rotating projectile" que salieron en la misma búsqueda; el resumen no deja claro cuál dio cada dato):
  - Smits & Smith midieron en túnel de viento bolas girando con 40,000 < Re < 250,000 (y S entre 0.04 y un valor que el resumen da como 1.4).
  - El modelo suma una ley de decaimiento del giro y un arrastre no lineal con Re, "necesario para representar la disminución del CD observada por encima de Re ≈ 200,000".
  - Constantes: CD1 = 0.24, CD2 = 0.18, CD3 = 0.06, CL1 = 0.54, R1 = 0.00002, A1 = 90,000, A2 = 200,000; arrastre = constantes + término sinusoidal en Re.

  El resumen del buscador advierte que el texto está mal extraído — [US6186002 (Google Patents)](https://patents.google.com/patent/US6186002); [uspto.report](https://uspto.report/patent/grant/6186002); [patente "Steerable rotating projectile"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12528027).
- Decaimiento del giro:
  - Tavares et al. (1999) modelan el par como I·dω/dt = −R·ρ·A·C_M·v² — [patente US6286364](https://patents.google.com/patent/US6286364).
  - Con su medida, β ≈ 0.012, que equivale a τ = 20 s a 100 mph. Los datos de Smits & Smith equivalen a β = 0.009, o τ = 25 s a 100 mph — [arXiv 0803.4357](https://arxiv.org/pdf/0803.4357).
  - A. Nathan da λ = 2.5×10⁻⁵ para Tavares — [spindown-rev1](https://baseball.physics.illinois.edu/spindown-rev1.pdf).
  - Otra patente cita una forma con 4.0×10⁻⁶ y v en mph que no reproduce esos τ (probable error de extracción) — [patente "Steerable rotating projectile"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10118696).
- Bola: masa 0.04593 kg y radio 0.02134 m — [patente "Steerable rotating projectile"](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10118696). Coinciden con los límites de las Reglas de Golf (1.620 oz como máximo, 1.680 in como mínimo), que no se volvieron a consultar en esta sesión.
- **Tabla clásica "PGA TOUR AVERAGES" de TrackMan** (más antigua: publicada a más tardar en 2019; el año de los datos no está dicho):
  - Driver: 113 mph de palo, 167 mph de bola, 10.9°, 2,686 rpm, 32 yd de altura, 38° de llegada, 275 yd de carry — [support.trackmangolf.com](https://support.trackmangolf.com/hc/en-us/article_attachments/7349802113051); [Andrew Rice Golf](https://terri-rice-0z1d.squarespace.com/andrew-rice-golf/tag/golf+statistics).
  - Hierro 7: 90 / −4.3° / 120 / 1.33 / 16.3° / 7,097 rpm / 29 m (32 yd) / 50° / 157 m (172 yd) — [PDF 2019 en metros](https://teeituprva.com/wp-content/uploads/2019/03/PGA-AVERAGES-INTERACTIVE.pdf).
  - PW: 24.2° de salida y 52° de llegada (mismo PDF). La velocidad de 102 mph, los 9,304 rpm, las 29 yd y las 136 yd del PW se tomaron de esa misma tabla tal como se reproduce en general; en esta sesión solo se reconfirmaron la salida y la llegada.
- **Promedios actualizados de TrackMan** ("Introducing Updated Tour Averages", mayo 2024, temporada 2023):
  - driver: 115 mph de palo, 171 mph de bola, 35 yd de altura y 282 yd de carry en 2023 — [Golf Monthly](https://golfmonthly.com/tour/how-far-pga-tour-players-carry-their-drives); salida 10.4° — [TrackMan, launch angle](https://www.trackman.com/blog/launch-angle); 2,545 rpm — [TrackMan, spin rate](https://www.trackman.com/blog/spin-rate);
  - hierro 7: 92 mph de palo, 123 mph de bola, 176 yd de carry — [Golf Monthly](https://golfmonthly.com/features/how-far-does-the-average-pga-tour-player-hit-his-7-iron). Varias fuentes secundarias suman 7,124 rpm y smash 1.34, y otra 16.1° de salida y 51° de llegada — [golfdecode](https://golfdecode.com/pga-tour-average-swing-speed-ball-speed/); [fitmygolfclubs](https://www.fitmygolfclubs.com/blog/smash-factor-chart); [golfsidekick](https://www.golfsidekick.com/irons/7-iron/); [mygolfessentials](https://mygolfessentials.com/7-iron-launch-angle-in-golf/);
  - PW: 84 mph de palo, 104 mph de bola, 9,316 rpm, 142 yd (fuentes secundarias, mismas URLs). Sin salida, altura ni llegada confirmadas;
  - hierro 6: 14.0° y 6,204 rpm — [TrackMan, spin rate](https://www.trackman.com/blog/spin-rate).
- El informe de distancias 2024 de la USGA da, para la temporada 2024, 10.3° y 2,547 rpm con el driver — [USGA 2024 Distance Report](https://www.usga.org/content/dam/usga/images/equipment-standards/2024-distance-report/2024-Distance-Report.pdf).
- Un cuadro "PGA Tour Average Carry Distances (Trackman, 2026)" repite los números de 2023. No apareció una actualización oficial más nueva que la de mayo de 2024 — [deepswing](https://deepswing.io/blog/launch-monitor-numbers-explained?lang=en); [fitmygolfclubs](https://www.fitmygolfclubs.com/blog/7-iron-swing-speed-chart).
- Ciudades:
  - Bogotá: unos 2,640 m (otras fuentes dicen 2,625 m) y una media de 14 °C (otra fuente, 15 °C);
  - Medellín: unos 1,495 m y 22 °C de media.

  Fuentes: [El Tiempo](https://www.eltiempo.com/colombia/otras-ciudades/a-que-altura-estan-medellin-cali-y-bogota-sobre-el-nivel-del-mar-651358); [Nomado](https://www.nomadotravel.app/en/guides/bogota-weather-and-climate-guide); [Culture Trip](https://theculturetrip.com/articles/medellin-vs-bogota-which-city-is-for-you).
- Fórmulas estándar (referencias habituales, no abiertas en esta sesión):
  - atmósfera ISA: 288.15 K y 6.5 K/km — [Wikipedia: ISA](https://en.wikipedia.org/wiki/International_Standard_Atmosphere);
  - presión de vapor: ecuación de Buck — [Wikipedia](https://en.wikipedia.org/wiki/Arden_Buck_equation);
  - viscosidad: ley de Sutherland — [CFD Online](https://www.cfd-online.com/Wiki/Sutherland%27s_law).

### Inferences
**Modelo implementado** (`calculos/trayectoria.py`):
- **Fuerzas:** 3D, con gravedad, arrastre ½ρAC_D·V·**v** y Magnus ½ρAC_L·V²·(ω̂×v̂).
- **Giro:** el eje queda fijo en el espacio, sin precesión. S se calcula con la componente del giro perpendicular a la velocidad.
- **Coeficientes:** CD = cd1 + cd2·S + cd3·sin(π(Re−a1)/a2), con Re saturado a 40k-250k; CL = cl1·S^p.
- **Decaimiento:** dω/dt = −r1·(V/r)·ω, con r1 = 2×10⁻⁵ en SI. Da τ ≈ 24 s a 100 mph, coherente con los τ de 20-25 s citados.
- **Integración:** DOP853 con tolerancia 1e-9, y eventos para el ápice y el aterrizaje.
- **Convenciones de TrackMan:** HLA positivo a la derecha; eje de giro positivo hace curvar a la derecha.

**Validación SIN ajuste** (constantes publicadas, aire ISA a nivel del mar con 15 °C, ρ = 1.225 kg/m³). Cada celda da "simulado vs TrackMan (error)":

| Golpe (bola mph / VLA / rpm) | Carry yd | Altura máx yd | Llegada ° |
| :--- | ---: | ---: | ---: |
| Driver clásico 167 / 10.9° / 2,686 | 248.7 vs 275 (−26.3) | 36.4 vs 32 (+4.4) | 40.9 vs 38 (+2.9) |
| Hierro 7 clásico 120 / 16.3° / 7,097 | 180.7 vs 172 (+8.7) | 36.0 vs 32 (+4.0) | 44.8 vs 50 (−5.2) |
| PW clásico 102 / 24.2° / 9,304 | 142.2 vs 136 (+6.2) | 37.3 vs 29 (+8.3) | 48.8 vs 52 (−3.2) |
| Driver 2024 171 / 10.4° / 2,545 | 252.6 vs 282 (−29.4) | 35.9 vs 35 (+0.9) | 40.5 (sin dato) |
| Hierro 7 2024 123 / 16.1° / 7,124 | 185.0 vs 176 (+9.0) | 37.7 (sin dato) | 45.4 vs 51 (−5.6) |

Con aire a 25 °C, el driver clásico sube a 254.4 yd (−20.6) y el hierro 7 a 185.4 yd (+13.4). Que las condiciones de TrackMan sean otras no explica el error: los errores tienen signos opuestos según el palo.

**Qué se ajustó, exactamente:**
- **Método:** mínimos cuadrados ponderados de 4 constantes. Pesos: 2 yd de carry, 1 yd de altura y 1° de llegada.
- **Datos:** 13 valores de TrackMan, los 9 de la tabla clásica más los 4 confirmados de 2024.
- **Constantes fijas en el valor publicado:** cd1 = 0.24, a1 = 90,000, a2 = 200,000 y r1 = 2×10⁻⁵.
- **Resultado:**
  - **cd2:** de 0.18 a 0.284 (más arrastre con el giro);
  - **cd3:** de +0.06 a −0.067. El término de Re cambia de signo: el CD baja de ≈0.29 a Re 80k hasta ≈0.20 a Re 220k;
  - **cl1:** de 0.54 a 0.500;
  - **p:** de 0.40 a 0.499. Con S = 0.1 da un 15-25% menos de sustentación.

Resumen (RMS: carry yd / altura yd / llegada °):

| Variante | Tabla clásica | TrackMan 2024 |
| :--- | ---: | ---: |
| 1) Publicado | 16.4 / 5.9 / 3.9 | 21.7 / 0.9 / 5.6 |
| 2) Solo escalar CD y CL (k_cd = 0.935, k_cl = 0.960) | 15.0 / 6.1 / 4.3 | 18.3 / 1.2 / 6.5 |
| 3) 4 constantes ajustadas solo con la tabla clásica (validación cruzada) | 3.5 / 1.9 / 2.1 | 2.6 / 3.2 / 3.9 |
| 4) **Final**: 4 constantes con ambas tablas | 4.3 / 2.2 / 1.9 | 1.3 / 1.9 / 3.2 |

Errores del modelo final (simulado − TrackMan):
- **Tabla clásica:**
  - driver: +0.6 yd de carry, +1.7 yd de altura, +1.4° de llegada;
  - hierro 7: +0.4 yd, −0.6 yd, −2.9°;
  - PW: −7.5 yd, +3.3 yd, +0.5°.
- **TrackMan 2024:**
  - driver: −0.2 yd de carry (281.8 contra 282), −1.9 yd de altura;
  - hierro 7: +1.8 yd de carry, −3.2° de llegada.
- **Validación cruzada** (ajustado sin los datos de 2024): driver −0.9 yd de carry y −3.2 yd de altura; hierro 7 +3.6 yd y −3.9°.
- **Giro durante el vuelo:** el driver pierde un 22% (2,545 → 1,980 rpm en 6.75 s) y el hierro 7 un 15% (7,124 → 6,035 rpm en 6.49 s).

**Carry según la altitud** (modelo final; promedios de TrackMan 2024 para driver y hierro 7, tabla clásica para el PW). "Columna cálida" = presión hipsométrica con la temperatura media local y 6.5 K/km hacia el nivel del mar (SUPUESTO). Da +1.0% de presión en Medellín y +1.8% en Bogotá sobre la ISA, porque el trópico es más cálido que la atmósfera estándar.

| Aire | p kPa | ρ kg/m³ | Driver yd | Hierro 7 yd | PW yd |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Nivel del mar, ISA 15 °C | 101.3 | 1.225 | 281.8 | 177.8 | 128.5 |
| Medellín 1,495 m, ISA (5.3 °C) | 84.6 | 1.059 | 291.1 (+3.3%) | 187.3 (+5.3%) | 137.5 (+7.0%) |
| Medellín, columna cálida + 22 °C | 85.5 | 1.009 | 288.9 (+2.5%) | 188.2 (+5.8%) | 139.5 (+8.5%) |
| Bogotá 2,640 m, ISA (−2.2 °C) | 73.4 | 0.943 | 294.3 (+4.4%) | 193.3 (+8.7%) | 143.9 (+12.0%) |
| Bogotá, presión ISA + 14 °C | 73.4 | 0.890 | 290.3 (+3.0%) | 194.0 (+9.1%) | 146.2 (+13.7%) |
| Bogotá, columna cálida + 14 °C | 74.7 | 0.906 | 290.5 (+3.1%) | 193.4 (+8.7%) | 145.3 (+13.1%) |

En Bogotá la altura del driver baja de 33.1 a 26.1 yd y su ángulo de llegada de 39° a 29°.

**Banda de incertidumbre de la altitud.** Tres variantes ajustan casi igual a nivel del mar: RMS de carry de 4.3-5.4 yd en la tabla clásica y de 1.1-1.3 yd en la de 2024. Columna cálida:

| Variante | Driver: mar → Medellín / Bogotá | Hierro 7 | PW |
| :--- | ---: | ---: | ---: |
| A) final (cd3 = −0.067) | 282 → +2.5% / +3.1% | 178 → +5.8% / +8.7% | 129 → +8.5% / +13.1% |
| B) CD sin dependencia de Re (cd3 = 0) | 281 → +6.1% / +8.5% | 177 → +9.9% / +14.4% | 128 → +11.5% / +17.2% |
| C) Término de Re como el publicado (cd3 = +0.06) | 281 → +9.5% / +13.5% | 177 → +13.6% / +19.7% | 127 → +14.2% / +21.1% |
| Publicado sin ajustar (no reproduce el nivel del mar) | +11.0% / +16.2% | +12.9% / +18.8% | +12.9% / +18.9% |

- **Los datos de nivel del mar no separan el efecto de Re del de S:** a lo largo de cada vuelo, Re y S cambian juntos.
- **El efecto de la altitud depende de la variante:** en Bogotá, Re baja un 26% para la misma velocidad. Cuánto sube CD por eso (cerca de la "crisis" de arrastre de la bola) decide si el driver gana 3% o 13%.
- **Recomendación para el software:**
  - medir la densidad con un sensor de presión, temperatura y humedad;
  - calibrar un factor por palo en un campo de práctica local, con un medidor láser o contra un launch monitor comercial que normalice por altitud.

Sin calibrar, el carry en Bogotá tiene ±5% de incertidumbre de modelo: unas ±15 yd con el driver.

### Gaps
- **Smits & Smith original:** no se pudo leer. El signo y la fase del término sinusoidal, las unidades de R1 y el rango de S salen de un resumen de patente con texto dañado. El modelo es de bolas de 1994; las actuales vuelan distinto.
- **Promedios de TrackMan:**
  - no se encontró en qué condiciones se normalizan (altitud y temperatura);
  - el ±2 yd del ajuste puede absorber esa diferencia: 25 °C en lugar de 15 °C dan unas +2.7 yd de driver en el modelo final;
  - de 2024 faltan la llegada del driver, la altura del hierro 7 y la salida, altura y llegada del PW.
- **Altitud:** no se encontró ninguna medición del carry en altitud (Bogotá, Ciudad de México, Denver) con la que contrastar la banda. Tampoco se buscaron las presiones medidas de las estaciones de Bogotá y Medellín: la "columna cálida" es un supuesto.
- **Simplificaciones:** el modelo no incluye viento, humedad (aire seco; 70% de humedad bajaría la densidad un 0.5-0.8%) ni diferencias entre bolas (las de práctica vuelan distinto).

## 2. Sensibilidad del vuelo y precisión de sensor necesaria para ±2-3 yd

### Takeaway
Para un driver del PGA a nivel del mar, el carry cambia 2.0 yd por mph de bola, +2.7 yd por grado de VLA y +0.6 yd por cada 100 rpm; cada grado de HLA son 4.9 yd de desvío y cada grado de eje de giro, 2.0 yd de curva. En el hierro 7 son 1.8 yd/mph, −0.2 yd/° (está cerca del óptimo), −0.46 yd/100 rpm, 3.1 yd/° de HLA y 1.7 yd/° de eje.

Para ±2 yd (1σ) de carry repartidos entre velocidad, VLA y giro, el driver necesita velocidad ≤0.57 mph (0.33%), VLA ≤0.43° y giro ≤190 rpm. Para ±2 yd de desvío necesita HLA ≤0.29° y eje ≤0.70°. Las fichas comerciales de consumo (±1 mph, ±0.5°, ±150 rpm) equivalen a 2-3.4 yd de carry solo por esos datos: ±2-3 yd es el borde de lo comercial. El HLA y el eje de giro son lo más difícil.

### Cited Findings
- **Especificaciones encontradas** (todas secundarias o de reseñas):
  - **FlightScope Mevo+:** ±1 mph de bola, ±0.5° de salida, ±150 rpm, ±0.5 mph de palo, en una reseña de un sitio poco conocido — [golf-sim-lab-pro](https://golf-sim-lab-pro.pages.dev/reviews/flightscope-mevo-plus).
  - **SkyTrak (afirmación antigua):** ±1 mph de bola y ±1° de salida — [MyGolfSpy 2019](https://mygolfspy.com/buyers-guides/golf-technology/the-best-personal-launch-monitor-2019/). La URL exacta no se identificó entre los resultados.
  - **Bushnell Launch Pro:** "BALL SPEED ACCURACY: ±2 mph", en una página de especificaciones que salió en la búsqueda — [PlayBetter specs](https://playbetter.com/pages/golf-launch-monitors-simulators-specs). La URL exacta tampoco es segura.
  - **Tabla secundaria:**
    - TrackMan 4: ±1 mph de bola y ±50 rpm;
    - SkyTrak+: ±2-3 mph y ±300 rpm. Otra prueba del SkyTrak+ dio ±75 rpm frente a TrackMan, en conflicto con esa tabla.

    Fuentes: [smashfactorlab](https://smashfactorlab.com/most-accurate-launch-monitor/); [grumpygopher](https://www.grumpygopher.com/best-golf-launch-monitors).
- **Prueba independiente** (MyGolfSpy, febrero 2026, en interior, diferencia media contra un Foresight GCQuad):

  | Equipo | Carry | Giro | Velocidad de bola |
  | :--- | ---: | ---: | ---: |
  | Rapsodo MLM2PRO | 1.4% | 1.5% | 0.3% |
  | Garmin R50 | 2.2% | 1.5% | 0.3% |
  | Foresight GC3 | 1.5% | 2.0% | 0.4% |

  Fuente: [smashfactorlab](https://smashfactorlab.com/most-accurate-launch-monitor/).
- **Otros datos:**
  - en otra prueba, todos los equipos quedaron dentro de ±2 mph de TrackMan, y el SkyTrak+ dentro de ±0.5 mph — [cubicalgolfer](https://www.cubicalgolfer.com/golf-launch-monitor-accuracy-test/);
  - Foresight declararía un error absoluto medio de 1.58% de carry contra TrackMan al aire libre (secundario, sin confirmar) — [smashfactorlab](https://smashfactorlab.com/most-accurate-launch-monitor/).
- No se encontraron tolerancias oficiales de fábrica para TrackMan, GCQuad, Garmin R10 ni Uneekor, ni una sola especificación del eje de giro — mismos resultados de búsqueda.

### Inferences
Derivadas por diferencias centrales con el modelo final (`calculos/sensibilidad.py`). Los dos golpes de "aficionado" son SUPUESTOS ilustrativos: driver de 135 mph, 13° y 3,000 rpm; hierro 7 de 100 mph, 19° y 6,000 rpm.

| Golpe · aire | Carry yd | yd/mph | yd/° VLA | yd/100 rpm | Desvío yd/° HLA | Curva yd/° de eje |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Driver PGA · mar | 281.8 | 2.04 | +2.69 | +0.62 | 4.92 | 2.02 |
| Hierro 7 PGA · mar | 177.8 | 1.83 | −0.22 | −0.46 | 3.10 | 1.72 |
| Driver aficionado · mar | 209.5 | 2.42 | +2.43 | +0.40 | 3.66 | 1.33 |
| Hierro 7 aficionado · mar | 136.5 | 2.08 | +0.50 | −0.19 | 2.38 | 0.97 |
| Driver PGA · Bogotá | 290.5 | 2.79 | +5.95 | +1.48 | 5.07 | 1.49 |
| Hierro 7 PGA · Bogotá | 193.4 | 2.39 | +1.19 | −0.16 | 3.38 | 1.39 |

- **Linealidad:** la curva por grado de eje y el desvío por grado de HLA son iguales a 1° y a 5°. 5° de eje le quitan solo 0.4 yd de carry al driver.
- **Robustez frente al modelo** (variantes A, B y C, nivel del mar): las derivadas cambian ≤±15%. Driver: 1.92-2.04 yd/mph, 2.7-3.1 yd/°, 0.44-0.62 yd/100 rpm, 2.0-2.3 yd/° de eje.
- **Bogotá:** la sensibilidad del driver al VLA y al giro se duplica en el modelo A (con menos sustentación, el driver del PGA queda por debajo de su salida óptima), pero ese resultado depende del modelo.

**Precisión necesaria (1σ):**
- "sola" = el dato es la única fuente de error;
- "repartida" = reparto igual, sumado en cuadratura, entre 3 datos para el carry y entre 2 para el desvío.

| Golpe · aire | Velocidad sola / repartida | VLA | Giro | HLA (desvío) | Eje (desvío) |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **±2 yd** Driver PGA · mar | 0.98 / 0.57 mph (0.33%) | 0.74 / 0.43° | 323 / 186 rpm | 0.41 / 0.29° | 0.99 / 0.70° |
| ±2 yd Hierro 7 PGA · mar | 1.09 / 0.63 mph (0.51%) | > 5° (no limita) | 439 / 254 rpm | 0.64 / 0.46° | 1.16 / 0.82° |
| ±2 yd Driver aficionado · mar | 0.83 / 0.48 mph | 0.82 / 0.47° | 502 / 290 rpm | 0.55 / 0.39° | 1.50 / 1.06° |
| ±2 yd Driver PGA · Bogotá | 0.72 / 0.41 mph | 0.34 / 0.19° | 135 / 78 rpm | 0.39 / 0.28° | 1.34 / 0.95° |
| **±3 yd** Driver PGA · mar | 1.47 / 0.85 mph (0.50%) | 1.11 / 0.64° | 484 / 279 rpm | 0.61 / 0.43° | 1.48 / 1.05° |
| ±3 yd Hierro 7 PGA · mar | 1.64 / 0.95 mph | > 5° | 659 / 380 rpm | 0.97 / 0.68° | 1.74 / 1.23° |
| ±3 yd Driver aficionado · mar | 1.24 / 0.72 mph | 1.23 / 0.71° | 753 / 434 rpm | 0.82 / 0.58° | 2.25 / 1.59° |

**Error de carry (1σ, nivel del mar) que implican las fichas publicadas**, solo con los datos que cada una declara y tratando el "±" como 1σ:

| Ficha | Driver PGA | Hierro 7 PGA | Driver aficionado |
| :--- | ---: | ---: | ---: |
| Mevo+: ±1 mph, ±0.5°, ±150 rpm | 2.6 yd | 2.0 yd | 2.8 yd |
| SkyTrak antiguo: ±1 mph, ±1° | 3.4 yd | 1.8 yd | 3.4 yd |
| TrackMan 4 (tabla secundaria): ±1 mph, ±50 rpm | 2.1 yd | 1.8 yd | 2.4 yd |
| Bushnell Launch Pro: ±2 mph | 4.1 yd | 3.7 yd | 4.8 yd |

**Densidad del aire:** +1% de densidad cambia el carry del driver −0.8 yd en A, −1.0 yd en B y −1.3 yd en C. Usar en Bogotá la presión ISA en lugar de la real (−1.8% de densidad) mueve el carry de −0.2 a +2.0 yd según la variante. Un sensor de presión con error <0.5% basta: la densidad no limita.

**Conclusión:**
- **±3 yd de carry** pide unos ±0.8 mph (0.5%), ±0.6° y ±300 rpm con el driver: el nivel de un equipo de consumo bueno.
- **±2 yd de desvío** pide un HLA de ±0.3-0.4° y un eje de ±0.7-1.0°: más de lo que publica cualquier equipo de consumo.
- Para un sistema DIY lo realista es ±3-5 yd de desvío.

### Gaps
- No hay fichas oficiales de precisión de los fabricantes, ni sabemos si su "±" es 1σ, un 95% o un máximo.
- No se encontró ninguna especificación del eje de giro.
- Los golpes de aficionado son supuestos.
- Las derivadas heredan el error del modelo: llegada del hierro 7 −3° y carry del PW −7.5 yd.

## 3. Radar Doppler (HB100 a 10.525 GHz, CDM324 a 24.125 GHz)

### Takeaway
- **Desplazamiento Doppler:**
  - a 10.525 GHz: 70.2 Hz por m/s (31.4 Hz por mph, 19.5 Hz por km/h);
  - a 24.125 GHz: 160.9 Hz por m/s (71.9 Hz por mph).
- **Frecuencias y muestreo:**
  - bola hasta 85 m/s: 6.0 kHz o 13.7 kHz; palo hasta 55 m/s: 3.9 kHz u 8.9 kHz;
  - una tarjeta de audio de 44.1/48 kHz alcanza, con un 31-37% de margen para el CDM324.
- **Ventanas:** un vuelo de 2.5-3 m hasta la red dura 33-67 ms. Caben 3-7 ventanas de 10 ms independientes, con un bin de 0.62 m/s a 24 GHz o 1.42 m/s a 10.5 GHz.
- **Precisión por ruido:** con la interpolación espectral, el error por ruido es de centésimas de m/s si la SNR por muestra es ≥0 dB, y la ecuación del radar da +10 a +44 dB a 1-3 m. **Lo que limita es la geometría:** el error del coseno vale 2-17% en el impacto para VLA de 10-32°, con el radar 1.5-2.5 m detrás.
- **Palo:** la cabeza pasa solo 1.8-3.3 ms en los últimos 10 cm.

### Cited Findings
- **HB100:**
  - a 10.525 GHz, Fd = 31.36·V con V en mph, o 19.49·V con V en km/h; también da los factores para 9.35 y 24.125 GHz — [hoja HB100](https://temperosystems.com.au/wp-content/uploads/2020/07/HB100_RADAR.pdf.pdf); [foro PICBASIC](https://www.picbasic.co.uk/forum/archive/index.php/t-22864.html);
  - esos valores valen con el sensor quieto — [hoja HB100](https://temperosystems.com.au/wp-content/uploads/2020/07/HB100_RADAR.pdf.pdf);
  - desarme del módulo — [All About Circuits](https://www.allaboutcircuits.com/news/teardown-tuesday-hb100-doppler-radar-module/).
- **CDM324** (datos de revendedores; no se encontró hoja oficial):
  - transmite a 24.0-24.25 GHz (típico 24.125) con unos 16 dBm;
  - antena de 80° en horizontal por 32° en vertical; 5.5 V, 30 mA típicos (40 mA máximo);
  - un revendedor da la salida IF como "−300~300 mV", y el mismo listado dice "10 µs de ancho de pulso", que no se pudo verificar;
  - otro advierte que estos módulos "necesitan electrónica adicional".

  Fuentes: [Altronics](https://www.altronics.com.au/product/z6495-24ghz-millimeter-wave-radar-cdm324-sensor-module); [Electrónica Embajadores](https://www.electronicaembajadores.com/en/Productos/Detalle/SSRD009/sensors/microwave-radar-sensors/cdm324-movement-radar-sensor); [Lectronz](https://www.lectronz.com/products/cdm324-doppler-speed-sensor).
- Constante: c = 299,792,458 m/s — [NIST CODATA](https://physics.nist.gov/cgi-bin/cuu/Value?c) (no abierta en esta sesión).

### Inferences
Detalle en `calculos/radar_doppler.py` y `calculos/resultados/radar_doppler.md`.

**Muestreo:** con una banda útil de 0.45·fs (supuesto típico del filtro antialias), a 44.1 kHz queda 19.8 kHz y a 48 kHz 21.6 kHz, contra 13.7 kHz de la bola a 85 m/s en el CDM324: **alcanza**. 96 kHz da margen de sobra.

**STFT** (ventana Hann; separación de bins Δf = 1/T; lóbulo principal de −6 dB de 2 bins):

| Ventana | Δf | Δv por bin HB100 / CDM324 | Ventanas en 2.5-3 m: driver 75 m/s · hierro 7 55 · wedge 45 |
| :--- | ---: | ---: | ---: |
| 2 ms | 500 Hz | 7.1 / 3.1 m/s | 17-20 · 23-27 · 28-33 |
| 5 ms | 200 Hz | 2.9 / 1.2 m/s | 7-8 · 9-11 · 11-13 |
| 10 ms | 100 Hz | 1.4 / 0.62 m/s | 3.3-4 · 4.5-5.5 · 5.6-6.7 |
| 20 ms | 50 Hz | 0.71 / 0.31 m/s | 1.7-2 · 2.3-2.7 · 2.8-3.3 |

El vuelo dura 33-40 ms con el driver, 45-55 ms con el hierro 7 y 56-67 ms con el wedge.

**Monte Carlo** (bola a 75 m/s, 48 kHz, Hann, relleno ×8, interpolación gaussiana del pico, 400 pruebas). Error RMS de velocidad; los "atípicos" son picos equivocados:

| Módulo · ventana | SNR por muestra −10 dB | 0 dB | +10 dB | +20 dB |
| :--- | ---: | ---: | ---: | ---: |
| CDM324 · 2 ms | 2.8 m/s (41% atípicos) | 0.28 m/s | 0.084 m/s | 0.030 m/s |
| CDM324 · 5 ms | 0.44 m/s (13% atípicos) | 0.068 m/s | 0.022 m/s | 0.007 m/s |
| CDM324 · 10 ms | 0.080 m/s (0.5%) | 0.024 m/s | 0.007 m/s | 0.002 m/s |
| HB100 · 5 ms | 0.75 m/s (10% atípicos) | 0.16 m/s | 0.047 m/s | 0.016 m/s |
| HB100 · 10 ms | 0.17 m/s (0.8%) | 0.056 m/s | 0.018 m/s | 0.005 m/s |

- **Cerca del óptimo:** el error queda a 1.3-1.6 veces la cota de Cramér-Rao.
- **Sin sesgo** respecto de la velocidad en el centro de la ventana con deceleraciones de 25-60 m/s² ni con una modulación de amplitud del 30-50% a la frecuencia del giro (42 y 119 Hz).
- **Umbral:** por debajo de unos −10 dB aparecen picos equivocados. Por encima, el ruido no limita.

**SNR esperable** (CDM324, ecuación del radar):
- **Datos:** EIRP de 16 dBm (citado); recepción de ≈12 dBi, deducida del haz de 80°×32°; sección radar de la bola de π·r² = 14.3 cm². A 24 GHz, k·a ≈ 10.8: régimen óptico.
- **Supuesto:** cifra de ruido de 15-30 dB.
- **Resultado:** a 1/2/3 m llegan −71.5/−83.5/−90.5 dBm, que dan una SNR por muestra a 48 kHz de +44/+32/+25 dB con 15 dB de cifra de ruido, o +29/+17/+10 dB con 30 dB.
- **Faltan:** el ruido 1/f del mezclador, el amplificador y el ADC.

**Error del coseno** (radar detrás de la bola sobre la línea de objetivo; v_medida/v − 1 según la distancia que recorrió la bola):

| Radar | VLA | s = 0 | 0.5 m | 1 m | 3 m |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 2.0 m detrás, 5 cm de alto | 10° | −2.0% | −1.3% | −0.9% | −0.3% |
| 2.0 m detrás, 5 cm de alto | 16° | −4.6% | −3.0% | −2.1% | −0.7% |
| 2.0 m detrás, 5 cm de alto | 24° | −9.7% | −6.3% | −4.4% | −1.6% |
| 2.0 m detrás, 5 cm de alto | 32° | −16.5% | −10.8% | −7.6% | −2.7% |
| 2.0 m detrás, 30 cm de alto | 10° | −5.2% | −3.4% | −2.3% | −0.8% |
| 1.5 m detrás, 5 cm de alto | 10° | −2.2% | −1.2% | −0.8% | −0.2% |

- **Corrección con un VLA supuesto por palo:** con el driver real en 10-12° y el supuesto en 11°, el error queda en ±0.35% (±0.6 mph). Con un VLA real de 8° o 14°, en +0.9% o −1.2%. Con el wedge (supuesto 24°, real 20-28°), en ±3%.
- **HLA:** un HLA de 5° sin corregir suma −0.38%, y uno de 10°, −1.5%.
- **Consecuencia:** un radar solo necesita el VLA para dar la velocidad de bola dentro de ±1%.

**VLA a partir de la forma de v_r(t)** (información de Fisher; ventanas de 5 ms hasta 2.5 m; geometría conocida y bola en un punto marcado):
- con σ(v_r) = 0.05 m/s por ventana y el radar 2 m detrás y 30 cm arriba, el VLA del driver sale con σ ≈ 0.22° si se conoce la deceleración, y 0.81° si no;
- con el radar 1 m detrás, 0.15° o 0.37°;
- con el wedge, 0.12-0.63°.

Es teórico y sin validar: lo arruinarían una posición mal medida, el multitrayecto en la red o una σ(v_r) real mayor.

**Palo antes del impacto:**
- **Tiempo:** en los últimos 10 cm pasa 3.33 ms a 30 m/s, 2.50 ms a 40, 2.22 ms a 45, 2.00 ms a 50 y 1.82 ms a 55 m/s (87-160 muestras a 48 kHz). Con solo esos 10 cm, un bin vale 4.3-7.8 m/s en el HB100 y 1.9-3.4 m/s en el CDM324.
- **Ventana:** hace falta ajustar una curva sobre los últimos 20-50 cm.
- **Coseno:** si la cabeza sigue un arco de 1.2 m de radio (supuesto), la velocidad radial cae un 0.35% a 10 cm del impacto, un 3.1% a 30 cm y un 8.6% a 50 cm. El máximo de v_r está en el impacto.
- **Separación:** después del impacto el palo sigue a ≈60-70% de su velocidad (ver la sección 5) y la bola sale 1.2-1.5 veces más rápida: los dos tonos se separan en frecuencia.

**Elección:** el CDM324 da 2.3 veces más resolución en el mismo tiempo y un haz vertical más angosto (32°), así que es preferible. El HB100 alcanza para medir velocidades.

### Gaps
- No hay hoja oficial del CDM324 (patillas, ancho de banda de la IF, ganancia de conversión) ni se confirmó en esta sesión la potencia del HB100: la tabla de SNR descansa en una cifra de ruido supuesta.
- Faltan por modelar el multitrayecto y el eco de la red y las paredes, y el palo como blanco grande cerca de la bola.
- Medir el giro con el radar (bandas laterales a 42-155 Hz) necesitaría ventanas de 25-50 ms y datos de la modulación de la sección radar que no se encontraron.
- No se averiguó la regulación colombiana (ANE) de 10.5 y 24 GHz.

## 4. Cámara de obturador global y estroboscopio (IMX296 y OV9281)

### Takeaway
- **Campo:** el IMX296 con lente de 6 mm a 0.5 m ve 414×309 mm, a 0.284 mm/píxel, con la bola de 150 px.
- **Profundidad de campo:** solo 20 cm a f/2 y 13 cm a f/1.4, en el límite de lo que pide el HLA de ±10°. Hacen falta f/2-2.8 o una lente de 4 mm (52 cm a f/2), y eso choca con el presupuesto de luz.
- **Barrido:** a 75 m/s, 0.75 mm (2.6 px) con un pulso de 10 µs y 1.5 mm (5.3 px) con 20 µs.
- **Intervalo entre destellos:** el que sirve a la vez para driver y wedge con 4 imágenes es de 1.19-1.58 ms (6 mm a 0.5 m) o de 1.19-2.52 ms (4 mm a 0.5 m).
- **Rotación:** en 1 ms la bola gira 15° a 2,500 rpm y 56° a 9,300 rpm.
- **Precisiones:**
  - **velocidad:** la limita la escala (0.04-0.2%, que sale de la profundidad), no el centroide (0.03%);
  - **VLA:** la limita la calibración (el centroide solo da 0.015°);
  - **HLA,** con el tamaño de la bola: 0.17-0.43°;
  - **giro:** ±60-210 rpm;
  - **eje del driver:** ±1-4°. Es el cuello de botella del desvío.

### Cited Findings
- **Raspberry Pi Global Shutter Camera:**
  - sensor Sony IMX296LQR-C de 1.58 MP en color, píxeles de 3.45 µm y 6.3 mm de diagonal (1/2.9");
  - exposiciones de hasta 30 µs "con iluminación adecuada";
  - filtro de corte IR integrado; montura C/CS (trae adaptador C-CS); cable de 150 mm;
  - €59.95 con IVA (foto de agosto 2025); en producción al menos hasta enero de 2032.

  Fuentes: [Elektor](https://www.elektor.com/raspberry-pi-global-shutter-camera); [PiShop](https://www.pishop.us/product/raspberry-pi-global-shutter-camera/).
- **Resolución:** las tiendas dan 1440×1080 píxeles efectivos y una página de Waveshare 1456×1088 — [Waveshare](https://www.waveshare.com/product/raspberry-pi/boards-kits/raspberry-pi-5/raspberry-pi-global-shutter-camera.htm). Se calculó con 1456×1088, como en el pedido; la diferencia es del 1%.
- **Versiones monocromas con montura M12:** [Arducam IMX296 mono](https://www.arducam.com/1-58mp-imx296-mono-global-shutter-camera-module-with-m12-lens-for-raspberry-pi.html); [Waveshare IMX296 mono](https://www.waveshare.com/product/imx296-130-bw-camera.htm).
- **EMVA 1288 de una FLIR Firefly FFY-U3-16S2 (IMX296):**
  - eficiencia cuántica de 64.29% a 525 nm (mono);
  - saturación de 10,636 e- (mono) y 10,300 e- (color);
  - ruido oscuro temporal de 0.45 DN; el valor en e- no apareció. Otra página de la misma familia da unos 4.7-5.0 e-.

  Fuente: [FLIR EMVA](https://softwareservices.flir.com/FFY-U3-16S2/latest/EMVA/EMVA.html).
- **IR cercano:** Sony afirma alta sensibilidad del IMX296 en el IR cercano sin dar cifras por longitud de onda — [FRAMOS IMX296LLR](https://www.framos.com/en/products/imx296llr-c-19073); [hoja FRAMOS](https://www.mouser.com/datasheet/2/1051/Framos_07072023_FSM_IMX296_Datasheet-3225657.pdf).
- **OV9281:**
  - sensor de 1/4" monocromo de obturador global, 1280×800, píxeles de 3 µm, hasta 120 fps — [OmniVision PB v1.4](https://www.ovt.com/wp-content/uploads/2024/05/OV9281-PB-v1.4-WEB.pdf);
  - Arducam lista 1280×800 a 80 fps en Jetson y modo de disparo externo — [Arducam](https://www.arducam.com/product/arducam-ov9281-mipi-1mp-monochrome-global-shutter-ir-camera-module-for-jetson-nano/). Otro módulo de Arducam dice 143 fps en RAW8 y 114 fps en RAW10, más de los 120 fps del sensor — [Arducam DS](https://cdn.arducam.com/downloads/modules/OV9281/OV9281_MIPI_Camera_Module_Standalone_DS.pdf);
  - Leopard Imaging da 1296×816 píxeles activos — [Leopard](https://leopardimaging.com/wp-content/uploads/2026/08/LI-OV9281-MIPI-RS-85H_Datasheet_V0.2.pdf).
- **PiTrac** (DIY de código abierto):
  - usa la Pi Global Shutter o módulos IMX296 de InnoMaker, con una lente M12 de 6 mm por omisión — [PiTrac quickstart](https://pitraclm.github.io/PiTrac/quickstart.html); [lista de partes](https://jamespilgrim.github.io/PiTrac/hardware/parts-list.html);
  - captura imágenes estroboscópicas IR con cámaras baratas en vez de cámaras de alta velocidad — [PiTrac](https://jamespilgrim.github.io/PiTrac).

### Inferences
Modelo de lente delgada sin distorsión; detalle en `calculos/camara_estroboscopio.py`.

**Campo, mm/píxel y bola en píxeles:**

| Sensor · lente · distancia | HFOV | Campo mm | mm/px | Bola px |
| :--- | ---: | ---: | ---: | ---: |
| IMX296 · 4 mm · 0.4 / 0.5 / 0.7 m | 64° | 497×372 / 623×465 / 874×653 | 0.342 / 0.428 / 0.600 | 125 / 100 / 71 |
| IMX296 · 6 mm · 0.4 / 0.5 / 0.7 m | 45° | 330×246 / 414×309 / 581×434 | 0.227 / 0.284 / 0.399 | 188 / 150 / 107 |
| IMX296 · 8 mm · 0.4 / 0.5 / 0.7 m | 35° | 246×184 / 309×231 / 435×325 | 0.169 / 0.212 / 0.298 | 252 / 201 / 143 |
| OV9281 · 4 mm · 0.4 / 0.5 / 0.7 m | 51° | 380×238 / 476×298 / 668×418 | 0.297 / 0.372 / 0.522 | 144 / 115 / 82 |
| OV9281 · 6 mm · 0.4 / 0.5 / 0.7 m | 35° | 252×158 / 316×198 / 444×278 | 0.197 / 0.247 / 0.347 | 217 / 173 / 123 |
| OV9281 · 8 mm · 0.5 / 0.7 m | 27° | 236×148 / 332×208 | 0.184 / 0.259 | 231 / 164 |

**Profundidad de campo** (círculo de confusión de 2 px, IMX296):

| Lente · distancia | f/1.4 | f/2 | f/2.8 | f/4 |
| :--- | ---: | ---: | ---: | ---: |
| 4 mm · 0.5 m | 33 cm | 52 cm | 93 cm | 319 cm |
| 6 mm · 0.5 m | 13 cm | 20 cm | 29 cm | 44 cm |
| 6 mm · 0.7 m | 27 cm | 40 cm | 61 cm | 104 cm |
| 8 mm · 0.7 m | 15 cm | 21 cm | 31 cm | 46 cm |

El recorrido en profundidad a cubrir es de unos 20 cm (SUPUESTO: HLA de ±10° a lo largo de 40 cm más ±3 cm de colocación del tee). El OV9281 da un 10-15% menos de profundidad de campo.

**Barrido por movimiento** (mm, y píxeles a 0.284 mm/px):

| Velocidad | 5 µs | 10 µs | 20 µs | 50 µs |
| :--- | ---: | ---: | ---: | ---: |
| 40-55 m/s (wedge-hierro) | 0.2-0.3 mm (0.7-1.0 px) | 0.4-0.55 mm (1.4-1.9 px) | 0.8-1.1 mm (2.8-3.9 px) | 2.0-2.75 mm (7-10 px) |
| 75 m/s (driver) | 0.38 mm (1.3 px) | 0.75 mm (2.6 px) | 1.5 mm (5.3 px) | 3.75 mm (13.2 px) |
| 85 m/s | 0.43 mm (1.5 px) | 0.85 mm (3.0 px) | 1.7 mm (6.0 px) | 4.25 mm (15 px) |

El barrido es simétrico y no mueve el centroide. Para el giro conviene ≤10-20 µs: en 20 µs y a 10,000 rpm, la superficie de la bola recorre 0.45 mm.

**Intervalo entre destellos (µs).** Las imágenes no se tocan (≥1.25 D entre centros) y caben en el campo con D/4 de margen por lado; la primera cae en el borde del campo.

| Configuración · n | Driver 75 m/s, 10-15° | Wedge 45 m/s, 25-35° | Común a ambos |
| :--- | ---: | ---: | ---: |
| IMX296 6 mm @ 0.5 m · 3 | 711-2,366 | 1,185-4,286 | 1,185-2,366 |
| IMX296 6 mm @ 0.5 m · 4 | 711-1,578 | 1,185-2,857 | **1,185-1,578** |
| IMX296 6 mm @ 0.5 m · 5-6 | 711-1,183 / 711-947 | 1,185-2,143 / 1,185-1,714 | no hay |
| IMX296 4 mm @ 0.5 m · 4 / 6 | 711-2,522 / 711-1,513 | 1,185-4,568 / 1,185-2,741 | 1,185-2,522 / 1,185-1,513 |
| IMX296 6 mm @ 0.7 m · 4 / 6 | 711-2,333 / 711-1,400 | 1,185-4,226 / 1,185-2,535 | 1,185-2,333 / 1,185-1,400 |
| OV9281 4 mm @ 0.5 m · 4 | 711-1,860 | 1,185-3,017 | 1,185-1,860 |
| OV9281 6 mm @ 0.6 m · 4 | 711-1,427 | 1,185-2,242 | 1,185-1,427 |

El mínimo del wedge (1.19 ms) lo impone que sus imágenes no se toquen. Con un Δt fijo de 1.2-1.5 ms, 4 imágenes sirven para todos los palos. Con 6 imágenes, el Δt tiene que adaptarse a la velocidad (ver la sección 5).

**Rotación entre destellos (°):**

| rpm | 0.5 ms | 0.75 ms | 1.0 ms | 1.5 ms | 2.0 ms |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 2,000 | 6 | 9 | 12 | 18 | 24 |
| 2,500 | 8 | 11 | 15 | 22 | 30 |
| 3,000 | 9 | 14 | 18 | 27 | 36 |
| 5,000 | 15 | 22 | 30 | 45 | 60 |
| 7,000 | 21 | 32 | 42 | 63 | 84 |
| 10,000 | 30 | 45 | 60 | 90 | 120 |

Con 1.2-1.5 ms y 10,000 rpm la bola gira 72-90° por intervalo: el límite contra el aliasing de un patrón con simetría (líneas o logo). Para los wedges conviene usar el extremo corto de la ventana común.

**Precisión del giro y del eje** (orden de magnitud; σθ es el error de orientación de la bola en cada imagen, un SUPUESTO de 1-4°):

| Golpe · Δt · n | Rotación total | σθ = 1° | σθ = 2° | σθ = 4° |
| :--- | ---: | ---: | ---: | ---: |
| Driver 2,545 rpm · 0.7 ms · 4 | 32° | ±106 rpm, eje ±1.8° | ±213 rpm, eje ±3.6° | ±426 rpm, eje ±7.1° |
| Driver 2,545 rpm · 0.7 ms · 6 | 53° | ±57 rpm, eje ±1.1° | ±114 rpm, eje ±2.1° | ±228 rpm, eje ±4.3° |
| Hierro 7 7,124 rpm · 0.9 ms · 4 | 115° | ±83 rpm, eje ±0.5° | ±166 rpm, eje ±1.0° | ±331 rpm, eje ±2.0° |
| Wedge 9,300 rpm · 1.0 ms · 4 | 167° | ±75 rpm, eje ±0.3° | ±149 rpm, eje ±0.7° | ±298 rpm, eje ±1.4° |

El driver gira poco dentro del campo (32-53°), así que su eje es el dato peor medido. Cada grado de eje son 2 yd de curva (sección 2).

**HLA por el tamaño aparente de la bola** (una cámara de lado; Z = f·D/(d_px·p); regresión de Z contra la distancia recorrida):

| Configuración | σ del diámetro | σZ por imagen | σHLA n = 3, 25 cm | n = 4, 30 cm | n = 6, 30 cm |
| :--- | ---: | ---: | ---: | ---: | ---: |
| IMX296 6 mm @ 0.5 m (150 px) | 0.2 px | 0.67 mm | 0.22° | 0.17° | 0.15° |
| IMX296 6 mm @ 0.5 m | 0.3 px | 1.00 mm | 0.32° | 0.26° | 0.23° |
| IMX296 6 mm @ 0.5 m | 0.5 px | 1.66 mm | 0.54° | 0.43° | 0.38° |
| IMX296 6 mm @ 0.5 m | 1.0 px | 3.33 mm | 1.08° | 0.85° | 0.76° |
| IMX296 8 mm @ 0.7 m (143 px) | 0.5 px | 2.45 mm | 0.79° | 0.63° | 0.56° |
| OV9281 4 mm @ 0.5 m (115 px) | 0.5 px | 2.18 mm | 0.71° | 0.56° | 0.50° |

El ±0.29° que pide el desvío de ±2 yd exige medir el diámetro con un error ≤0.3 px. Es posible con un ajuste de borde subpíxel sobre una bola de ~150 px y bien iluminada, pero hay que probarlo.

**Velocidad y VLA por el error del centroide** (6 mm a 0.5 m; 30 cm = 1,056 px):
- **Centroide:** con σ = 0.2 px y n = 4, la velocidad sale con 0.025% (0.04 mph) y el VLA con 0.015°. Con 1 px, 0.13% y 0.07°.
- **Lo que domina:**
  - **escala:** con el diámetro a ±0.1 px es 0.04%, y a ±0.5 px, 0.2% (0.34 mph). Una bola 10 mm fuera del plano calibrado sin corregir da un 2% (3.4 mph): **hay que corregir la escala con la profundidad de cada imagen**;
  - **reloj del destello:** 1 µs sobre 2.1 ms es un 0.05%;
  - **VLA:** la nivelación y la calibración de la cámara (±0.1-0.2°, supuesto).

**Nivel 0, teléfono** (SUPUESTOS: 1920 px de ancho, HFOV de 69° a 1.5 m, ≈1.1 mm/px):
- a 240 fps la bola avanza 188 mm por cuadro a 45 m/s y 312 mm a 75 m/s, así que caben 6.6-11 cuadros en el campo de 2.07 m;
- con 1/2000 s de exposición el barrido es de 22-38 mm (21-35 px);
- el centroide solo aporta 0.2-0.6%, pero la escala (bola de ~40 px ±1 px = 2.5%) y el obturador rodante (sin cuantificar) dominan.

**Configuración recomendada:**
- **Cámara:** IMX296 monocromo, sin Bayer ni filtro de corte IR. La oficial en color trae ese filtro integrado.
- **Lente y distancia:** 6 mm a 0.55-0.6 m (campo de 455-500 mm) o 4 mm a 0.45-0.5 m, entre f/2 y f/2.8.
- **Destellos:** pulsos de 10-20 µs y Δt de 0.7-1.3 ms con el driver, o de 1.2-1.5 ms con el wedge. Con un Δt fijo único, 1.2-1.3 ms.

### Gaps
- No se encontró la eficiencia cuántica del IMX296 ni la del OV9281 a 730, 850 o 940 nm.
- Falta el detalle del disparo externo (XTR) de la cámara de Raspberry Pi: la documentación oficial no se pudo abrir.
- No se cuantificó la distorsión de las lentes M12 de 4-6 mm. El σθ del algoritmo de giro es un supuesto que pide pruebas con bolas marcadas.
- Falta el modelo del obturador rodante de los teléfonos (tiempo de lectura).

## 5. Presupuesto de latencia del disparo y dónde empieza el campo de visión

### Takeaway
- **Acústico:** con un micrófono a 0.3 m y detección analógica en un microcontrolador, el disparo llega 0.91-1.0 ms después del impacto, con la bola ya 41-85 mm adelante. A 0.1 m tarda 0.32-0.41 ms.
- **Radar en el microcontrolador:** 0.5-2 ms (23-172 mm).
- **Por la tarjeta de sonido del PC:** 6-51 ms, inservible para el estroboscopio.
- **Barrera IR:** dispara por posición: la bola siempre está en la barrera, sin importar su velocidad. Es la mejor opción.
- **Despegue del palo:** la bola tarda en separarse un diámetro de la cara ≈1.0 ms con el driver y ≈1.9 ms con el wedge. De todos modos la primera imagen debe quedar ≥75-90 mm adelante.
- **Campo:** para 4 imágenes de driver y wedge con un Δt fijo debe cubrir de ~35-40 mm a ~350-490 mm adelante del tee (346-474 mm de ancho). Con dos barreras que midan la velocidad y un Δt adaptado bastan unos 310 mm.

### Cited Findings
- Velocidad del sonido c = √(γRT), referencia estándar — [Wikipedia: velocidad del sonido](https://en.wikipedia.org/wiki/Speed_of_sound) (no abierta en esta sesión).
- Temperaturas medias usadas: 14 °C en Bogotá y 22 °C en Medellín — [Nomado](https://www.nomadotravel.app/en/guides/bogota-weather-and-climate-guide); [Culture Trip](https://theculturetrip.com/articles/medellin-vs-bogota-which-city-is-for-you).
- No se encontraron hojas de datos de los detectores (fotodiodo, fototransistor, comparador) en esta sesión: sus latencias son supuestos de orden de magnitud (ver Gaps).

### Inferences
Detalle en `calculos/latencia_disparo.py`.

**Sonido:** a 14 °C (339.7 m/s) tarda 0.29 ms en 0.1 m, 0.88 ms en 0.3 m, 1.47 ms en 0.5 m y 2.94 ms en 1 m. A 22 °C es un 1.4% más rápido.

**Latencia total y distancia recorrida por la bola.** Detectores SUPUESTOS:
- umbral sobre el frente del sonido: 20-100 µs;
- comparador más interrupción del microcontrolador: 5-20 µs;
- fotodiodo: 1-5 µs; fototransistor: 10-50 µs;
- tono Doppler en el microcontrolador: 0.5-2 ms;
- pila de audio del PC: 5-50 ms.

| Disparo | Latencia | Bola a 45 / 75 / 85 m/s |
| :--- | ---: | ---: |
| Acústico, micrófono a 0.3 m, analógico + microcontrolador | 0.91-1.00 ms | 41-45 / 68-75 / 77-85 mm |
| Acústico, micrófono a 0.1 m | 0.32-0.41 ms | 14-19 / 24-31 / 27-35 mm |
| Acústico por la tarjeta de sonido del PC | 5.9-51 ms | 0.27-2.3 / 0.44-3.8 / 0.5-4.3 m |
| Radar, tono de la bola detectado en el microcontrolador | 0.51-2.02 ms | 23-91 / 38-152 / 43-172 mm |
| Radar procesado en el PC | 5-50 ms | 0.23-4.3 m |
| Barrera IR a 2 cm delante de la bola (fotodiodo) | 0.24-0.45 ms según la velocidad | siempre 20 mm |

**Despegue de la bola** (momento lineal en 1D; masas de cabeza SUPUESTAS: 200, 260 y 290 g; sin el contacto de ~0.5 ms):

| Golpe | Bola | Palo después | Separación | Tiempo hasta 1 D de luz | Bola recorrió |
| :--- | ---: | ---: | ---: | ---: | ---: |
| Driver (115 mph) | 76.6 m/s | 33.8 m/s | 43.8 m/s | 0.97 ms | 75 mm |
| Hierro 7 (92 mph) | 55.1 | 31.4 | 26.4 | 1.61 ms | 89 mm |
| Wedge (83 mph) | 45.6 | 29.9 | 22.1 | 1.93 ms | 88 mm |

**Campo de visión necesario** (4 imágenes; driver a 75 m/s y 12°, wedge a 45 m/s y 30°; espera extra de 0.5 ms tras el disparo; distancias horizontales desde la posición inicial del centro de la bola):

| Disparo | Campo desde | Hasta | Ancho |
| :--- | ---: | ---: | ---: |
| Acústico a 0.3 m, Δt fijo de 1.3 ms | 34 mm | 418 mm | 384 mm |
| Radar en el microcontrolador, Δt fijo | 18 mm | 492 mm | 474 mm |
| Barrera IR a 2 cm, Δt fijo | 39 mm | 385 mm | 346 mm |
| Dos barreras IR que miden v, Δt adaptado a 25 cm de recorrido | 39 mm | 349 mm | 310 mm |

**Dos barreras IR** separadas 5 cm: la bola tarda 0.59-1.11 ms entre ellas, y con ±2 µs por flanco (supuesto) la velocidad sale con ±0.2-0.3%. Eso alcanza para adaptar el Δt y sirve como una segunda medida de velocidad.

**Diseño:**
- **Campo:** empieza unos 3-4 cm adelante del centro inicial de la bola y mide ≥35-40 cm: el IMX296 con 6 mm a 0.55-0.6 m o con 4 mm a 0.5 m.
- **Disparo:** una barrera IR (fotodiodo y comparador) 2-5 cm delante de la bola, con un micrófono de respaldo.
- **Tiempos:** los fija el microcontrolador, no la cámara. La cámara abre una exposición larga que cubre todos los destellos, y los destellos marcan cada imagen con precisión de microsegundos.
- **Datos del palo (inferencia):** otra barrera 10 cm detrás de la bola vería la cabeza unos 2 ms antes del impacto (10 cm a 45 m/s). Ese adelanto permitiría 1-2 destellos sobre el palo antes del impacto.

### Gaps
- Las latencias de los detectores son supuestos, y el tiempo de subida del sonido del impacto no se midió.
- No se cuantificaron los disparos falsos: swings de práctica, golpes contra la alfombra o un palo que corte la barrera.
- Las masas de las cabezas son supuestas.
- No se pudo confirmar en la documentación oficial (bloqueada) la latencia del disparo externo de la cámara.

## 6. Presupuesto de luz del estroboscopio IR (orden de magnitud)

### Takeaway
- **Un LED no alcanza:** un SFH 4715AS a 1 A (0.9 W/sr) a 0.5 m deja en la bola blanca 16-67 e- por píxel con un pulso de 20 µs, a f/1.4-2 y con una QE supuesta de 0.1-0.2.
- **Lo necesario:** para 300-1,000 e- hacen falta 4-55 W/sr, es decir, una irradiancia de 16-220 W/m² en la bola durante el pulso. Son unos 5-60 LEDs a 1 A, o unos 2-20 a 3 A en pulsos.
- **Ambiente:** con luces LED de interior la luz ambiente no molesta; con luz de día indirecta queda al límite (10-24% del destello) y con sol directo es imposible (10-24 veces el destello).
- **730 nm:** PiTrac usa un COB IR de 100 W a 730 nm, probablemente porque el sensor rinde más ahí. No se encontró la cifra que lo confirme.

### Cited Findings
- **LEDs OSRAM:**
  - SFH 4715AS: 900 mW/sr típicos a 1,000 mA (rango 710-1,120), pico a 860 nm — [ams-osram SFH 4715AS](https://ams-osram.com/products/leds/ir-leds/osram-oslon-black-sfh-4715as);
  - variante A01: 770 mW/sr (560-900) y haz de 80° — [ams-osram SFH 4715AS A01](https://ams-osram.com/products/leds/ir-leds/osram-oslon-black-sfh-4715as-a01);
  - SFH 4715A: 860 nm, 1.65 V, 1.5 A, 415 mW/sr mínimo a 1 A, 90° — [DigiKey](https://www.digikey.ie/en/products/detail/ams-osram-usa-inc/SFH-4715A/5004660);
  - la corriente de pulso máxima no salió en la búsqueda: está en la hoja PDF.
- **Sensor:** saturación del IMX296 mono de 10,636 e- — [FLIR EMVA](https://softwareservices.flir.com/FFY-U3-16S2/latest/EMVA/EMVA.html).
- **PiTrac:**
  - usa un COB IR de 100 W a 730 nm y un filtro de paso largo que deje pasar 730 nm, y advierte que los filtros de 850 nm son un error;
  - la tira LED de la sala no debe emitir IR — [lista de partes de PiTrac](https://jamespilgrim.github.io/PiTrac/hardware/parts-list.html);
  - al aire libre es difícil competir con el sol, y el estroboscopio IR de un Uneekor interfirió en una comparación — [registro de Hackaday](https://hackaday.io/project/195042/log/229824); [PiTrac](https://pitraclm.github.io/PiTrac/what-is-pitrac.html).
- **Constantes y espectro solar:**
  - h y c de CODATA — [NIST](https://physics.nist.gov/cuu/Constants/);
  - el sol a 860 nm da ≈1 W/m²/nm (espectro ASTM G173, valor de referencia) — [NREL AM1.5](https://www.nrel.gov/grid/solar-resource/spectra-am1.5.html).

  Ninguna de las dos páginas se abrió en esta sesión.

### Inferences
**Cálculo** (`calculos/presupuesto_luz_ir.py`):
- **Cadena:** E = I/d² → L = ρE/π → E_sensor = ρ·E·T/(4N²(1+m)²) → fotones por píxel en el pulso → electrones con la QE.
- **SUPUESTOS:** reflectancia de la bola ρ = 0.8, transmisión de la lente T = 0.9, QE = 0.10/0.20/0.35, intensidad proporcional a la corriente en pulsos, LED junto a la cámara.

**Electrones por píxel con UN LED a 1 A** (IMX296, 0.5 m):

| QE | f/1.4, 10 / 20 µs | f/2, 10 / 20 µs | f/2.8, 10 / 20 µs |
| :--- | ---: | ---: | ---: |
| 0.10 | 17 / 33 | 8 / 16 | 4 / 8 |
| 0.20 | 33 / 67 | 16 / 33 | 8 / 17 |
| 0.35 | 58 / 116 | 29 / 57 | 15 / 29 |

A 0.4 m son 1.56 veces más y a 0.7 m la mitad. El OV9281, con píxeles más chicos, recibe un 0.76 de eso.

**Intensidad necesaria** (IMX296 a 0.5 m). Con 300 e- la SNR del ruido de disparo es ≈17 (mínimo, con ganancia); con 1,000 e-, ≈32 (~10% de la saturación):

| Objetivo · QE · f/# · pulso | I necesaria | LEDs a 1 A | LEDs a 3 A | Irradiancia en la bola |
| :--- | ---: | ---: | ---: | ---: |
| 300 e- · 0.20 · f/2 · 20 µs | 8.3 W/sr | 9 | 3 | 33 W/m² |
| 300 e- · 0.10 · f/2 · 10 µs | 33 W/sr | 37 | 12 | 133 W/m² |
| 1,000 e- · 0.20 · f/1.4 · 20 µs | 13.5 W/sr | 15 | 5 | 54 W/m² |
| 1,000 e- · 0.20 · f/2 · 20 µs | 27.6 W/sr | 31 | 10 | 110 W/m² |
| 1,000 e- · 0.10 · f/2 · 10 µs | 110 W/sr | 123 | 41 | 442 W/m² |
| 1,000 e- · 0.35 · f/2 · 20 µs | 15.8 W/sr | 18 | 6 | 63 W/m² |

**Choque con la profundidad de campo:** pasar de f/2 a f/2.8 para ganar profundidad de campo (sección 4) duplica los LEDs necesarios. Un arreglo práctico, sin verificar:
- 12-24 LEDs de 850-860 nm a 2-3 A en pulsos, o un COB de 730 nm con lente;
- a 0.4-0.5 m de la bola, con f/2 y pulsos de 20 µs.

**Luz ambiente** (12 LEDs a 3 A a 0.5 m dan 130 W/m² en la bola; 4 destellos de 20 µs; cociente = energía ambiente / energía del destello dentro de la exposición):

| Ambiente (irradiancia en la banda, supuesta salvo la del sol) | Exposición de 2 ms | 5 ms |
| :--- | ---: | ---: |
| Sol directo con filtro de 50 nm (≈50 W/m²) | 9.7 | 24 |
| Luz de día indirecta, 1% del sol (0.5 W/m²) | 0.10 | 0.24 |
| Bombillo halógeno a 2 m (0.2 W/m²) | 0.04 | 0.10 |
| LED blanco de interior (≈0.002 W/m²) | 0.00 | 0.00 |

Conviene un cuarto o garaje sin sol directo, con luces LED, y un filtro de paso de banda o de paso largo en la cámara. La exposición debe ser la más corta que cubra los destellos: unos 4-5 ms para 4 destellos a 1.3 ms.

**Alimentación** (cadena en serie con un MOSFET; V_F ≈ 1.65 V a 1 A según el catálogo del SFH 4715A, supuesta casi constante):

| LEDs en serie | Corriente | Tensión de la cadena | Potencia en el pulso | Energía por golpe (4 × 20 µs) | Caída en 1,000 µF |
| :--- | ---: | ---: | ---: | ---: | ---: |
| 12 | 1 A | ≈20 V | 20 W | 1.6 mJ | 0.08 V |
| 12 | 3 A | ≈23 V | 70 W | 5.6 mJ | 0.24 V |
| 24 | 3 A | ≈47 V | 140 W | 11 mJ | 0.24 V |

La potencia media es mínima. Lo crítico es encender en menos de 1 µs con poca inductancia, con un driver de compuerta y un condensador al lado de los LEDs.

### Gaps
- Falta la QE espectral del IMX296 y del OV9281 en el IR cercano, el dato que más cambia el número de LEDs (hasta ×3.5).
- Falta la corriente de pulso máxima del SFH 4715AS y su caída de eficiencia, y la intensidad radiante real de un COB de 730 nm de 100 W con su óptica.
- No se midió la reflectancia de la bola en el IR cercano.
- No se evaluó la seguridad ocular (IEC 62471) de un arreglo de LEDs IR a 0.5 m.

## 7. Diseños de referencia por niveles (qué mide, precisión, diagrama, lista de materiales y riesgos)

### Takeaway
- **Nivel 0** (teléfono en cámara lenta, ~USD 0): velocidad de bola ±3% y VLA ±1°. El carry queda en ±9-13 yd RMS (±16-30 yd P95) porque el giro no se mide.
- **Nivel 1** (solo radar, ~USD 20-40): velocidad de palo, de bola y smash con ±0.85-1.3% (±1.5-2 mph) una vez corregido el coseno con un VLA supuesto. Sin VLA ni giro, el carry queda en ±6-9 yd RMS a nivel del mar y hasta ±20 yd en Bogotá.
- **Nivel 2** (radar + cámara IMX296 + estroboscopio IR): todos los datos de bola. Los sensores dejan el carry en ±1.0-1.5 yd RMS a nivel del mar y ±0.9-2.7 yd en Bogotá. El desvío queda en ±2-6 yd RMS, limitado en el driver por el eje de giro. Con el error del modelo de vuelo, unas ±3-5 yd de carry. En Bogotá, además, la banda de altitud de ±5% si no se calibra.
- **Nivel 2+** (dos cámaras o una base más larga para el giro): desvío de ±1.2-3.3 yd RMS.

### Cited Findings
- **Raspberry Pi Global Shutter Camera:** €59.95 con IVA (foto de agosto 2025); la versión oficial es en color con filtro de corte IR — [Elektor](https://www.elektor.com/raspberry-pi-global-shutter-camera). Hay módulos IMX296 monocromos con montura M12 — [Arducam](https://www.arducam.com/1-58mp-imx296-mono-global-shutter-camera-module-with-m12-lens-for-raspberry-pi.html); [Waveshare](https://www.waveshare.com/product/imx296-130-bw-camera.htm).
- **PiTrac** (referente del Nivel 2):
  - Pi Global Shutter o IMX296 de InnoMaker, lente M12 de 6 mm, COB IR de 100 W a 730 nm y filtro de paso largo — [PiTrac quickstart](https://pitraclm.github.io/PiTrac/quickstart.html); [lista de partes](https://jamespilgrim.github.io/PiTrac/hardware/parts-list.html);
  - sus materiales cuestan "alrededor de 1/20" de un Uneekor, y "no es un producto de calidad comercial" — [Hackaday](https://hackaday.io/project/195042/log/229824); [PiTrac](https://pitraclm.github.io/PiTrac/what-is-pitrac.html).
- **Radares:** el CDM324 necesita electrónica adicional — [Lectronz](https://www.lectronz.com/products/cdm324-doppler-speed-sensor). Factores Doppler del HB100 — [hoja HB100](https://temperosystems.com.au/wp-content/uploads/2020/07/HB100_RADAR.pdf.pdf).
- **Precios:** no se encontraron en esta sesión los de HB100, CDM324, Raspberry Pi 5, lentes, LEDs ni filtros. Los de la lista de materiales son estimaciones sin verificar (ver Gaps).

### Inferences
**Precisión por nivel.** Monte Carlo de 160 golpes por celda a través del simulador (`calculos/niveles_diseno.py`). Solo el error de los sensores, en yd (RMS / P95).

Sigma por nivel (driver / hierro 7):
- **Nivel 0:**
  - velocidad 3% (escala de ±2.5% más centroide y obturador rodante), VLA 1°;
  - giro no medido: valor típico del palo con 600/1,200 rpm de dispersión (supuesto);
  - HLA 2° y eje 4°, ambos supuestos.
- **Nivel 1:**
  - velocidad 0.85%/1.3%;
  - VLA no medido, 2°/2.5° de dispersión;
  - giro 600/1,200 rpm, HLA 2.5° y eje 4°, todos no medidos.
- **Nivel 2:**
  - velocidad 0.3%, VLA 0.2°;
  - giro 150/170 rpm, con 4-6 imágenes y σθ de 1.5-2°;
  - HLA 0.4° (diámetro con 0.3-0.5 px de error); eje 3°/1°.
- **Nivel 2+:** velocidad 0.2%, VLA 0.15°, giro 100/120 rpm, HLA 0.2° y eje 1.5°/0.7°. Es un supuesto optimista.

| Aire · golpe | Nivel 0: carry · desvío | Nivel 1 | Nivel 2 | Nivel 2+ |
| :--- | ---: | ---: | ---: | ---: |
| Mar · Driver PGA | 13.1/30.4 · 13.8/27.6 | 9.0/19.1 · 14.3/29.0 | **1.5/3.0 · 6.3/12.6** | 1.0/2.0 · 3.3/6.6 |
| Mar · Hierro 7 PGA | 8.5/15.9 · 9.1/16.5 | 6.0/12.3 · 10.0/20.9 | **1.0/1.9 · 2.1/3.7** | 0.8/1.5 · 1.3/2.5 |
| Mar · Driver aficionado (supuesto) | 10.7/20.5 · 9.1/18.8 | 8.0/16.2 · 9.9/18.4 | **1.3/2.6 · 4.2/7.7** | 0.9/1.6 · 2.1/3.5 |
| Bogotá · Driver PGA | 17.8/34.6 · 11.6/22.4 | 19.7/40.3 · 15.1/28.8 | 2.7/5.4 · 4.5/8.7 | 1.9/3.5 · 2.6/5.1 |
| Bogotá · Hierro 7 PGA | 8.5/16.0 · 8.4/15.6 | 5.9/12.6 · 9.6/19.7 | 0.9/1.7 · 1.8/3.3 | 0.7/1.4 · 1.2/2.4 |
| Bogotá · Driver aficionado | 13.7/25.6 · 8.1/15.3 | 12.2/23.6 · 10.2/20.7 | 1.9/3.8 · 3.2/6.1 | 1.2/2.4 · 1.5/2.9 |

A esto se suma el error del modelo de vuelo: 1.3-4.3 yd de RMS de carry contra TrackMan a nivel del mar, y en Bogotá ±5% sin calibración local (sección 1).

**Nivel 0, teléfono en cámara lenta (~USD 0-15)**
- **Mide:** velocidad de bola (±3%, ≈±4-5 mph), VLA (±1°), y velocidad aproximada del palo y HLA si se graba otro video desde atrás. No mide el giro.
- **Diagrama:**
  ```
  [Teléfono 240 fps en trípode, de lado a 1.5 m] → [video] → [PC: Python + OpenCV:
  detecta la bola, la escala por su diámetro (42.67 mm) o por una regla en el plano de
  la bola, ajusta la recta] → [velocidad, VLA] → [simulador con giro típico del palo] → [carry ± 10-20 yd]
  ```
- **Lista de materiales (estimación sin verificar):** el teléfono que ya tiene, un trípode o soporte (USD 5-15), una regla o una marca de referencia.
- **Riesgos:**
  - **cámara:** obturador rodante (sesga la velocidad si la bola sube entre cuadros), cámara lenta interpolada en algunos teléfonos, exposición automática larga (barrido) y compresión;
  - **escala:** depende de la distancia de la bola a la cámara, un 2% por cada 10 mm a 0.5 m de distancia equivalente;
  - **método:** todo es manual o fuera de línea.

**Nivel 1, solo radar (~USD 20-40, estimación sin verificar)**
- **Mide:** la velocidad de la cabeza (máximo de v_r antes del impacto, ±1% supuesto), la velocidad de bola (±0.85% con el driver y ±1.3% con el hierro 7 tras corregir el coseno con un VLA supuesto) y el smash factor. Opcionalmente, el VLA por la forma de v_r(t): teórico, 0.2-1.3°.
- **Diagrama:**
  ```
  [CDM324 24.125 GHz, 2 m detrás de la bola, 5-30 cm de alto, apuntando a la red]
     → IF (µV-mV) → [amplificador de 2 etapas con op-amp + filtro 300 Hz-15 kHz]
     → [tarjeta de audio USB 48 kHz, o ADC de un microcontrolador (RP2040/ESP32)]
     → [PC: STFT de 5-10 ms, seguimiento de picos, palo y bola separados por frecuencia]
     → [velocidad del palo, de la bola, smash] → [simulador con VLA y giro típicos: carry ± 6-20 yd]
  ```
- **Lista de materiales:** CDM324 (o HB100), op-amps y pasivos, tarjeta de audio USB o microcontrolador, fuente de 5 V y caja o trípode. El total de USD 20-40 es el del pedido y no se verificó.
- **Riesgos:**
  - el error del coseno exige conocer el VLA;
  - el eco del palo, la red, las paredes y la gente;
  - el diseño del amplificador de IF (ruido 1/f, ganancia) y la deriva de frecuencia del módulo;
  - la regulación de 10.5 y 24 GHz en Colombia, sin averiguar;
  - sin el giro, el carry es solo indicativo.

**Nivel 2, radar + cámara GS + estroboscopio IR (datos completos de bola)**
- **Mide:**
  - velocidad de bola ±0.3% (cámara, con la radar de control);
  - VLA ±0.2°; HLA ±0.4° (por profundidad, una cámara);
  - giro ±150-170 rpm y eje ±1° con hierros y ±3° con el driver;
  - y lo calculado: carry, altura, desvío y curva;
  - por el radar: velocidad del palo y smash.
- **Diagrama:**
  ```
  [Barrera IR 2 cm delante de la bola: LED IR + fotodiodo + comparador] ──┐
  [Micrófono + comparador (respaldo)] ────────────────────────────────────┤
                                                                         ▼
                            [Microcontrolador (RP2040): tiempos en µs, Δt adaptado]
                               │ disparo de exposición (XTR)    │ 4-6 pulsos de 10-20 µs
                               ▼                                ▼
  [IMX296 mono + lente 6 mm f/2-2.8 + filtro IR,     [driver MOSFET + 1,000 µF + 12-24 LEDs
   de lado a 0.55-0.6 m; campo 3→40 cm del tee]       850-860 nm a 2-3 A, o COB 730 nm]
                               │ CSI-2
                               ▼
  [Raspberry Pi 5: centroides, diámetro (profundidad → escala y HLA), orientación de la bola
   en cada imagen (giro y eje, con bola marcada)]   ◄── [CDM324 + amp + ADC: palo y bola]
                               │                    ◄── [sensor de presión, T y HR: densidad]
                               ▼
  [PC o la misma Pi: simulador (modelo ajustado + calibración local) → carry, altura,
   desvío, curva → interfaz de práctica o simulador]
  ```
- **Lista de materiales (estimación sin verificar, salvo la cámara oficial):**
  - Raspberry Pi 5 o 4 con fuente;
  - cámara IMX296, preferiblemente monocroma; la oficial cuesta €59.95;
  - lente M12 o CS de 6 mm y filtro IR de paso largo;
  - 12-24 LEDs IR de 850-860 nm o un COB de 730 nm, con MOSFET, driver de compuerta y condensadores;
  - fuente de 24-48 V;
  - microcontrolador para los tiempos, barrera IR y micrófono;
  - radar del Nivel 1 y sensor de presión, temperatura y humedad;
  - soportes y caja.

  Orden de magnitud total: USD 150-300, a confirmar con la investigación de precios.
- **Riesgos:**
  - el presupuesto de luz depende de la QE desconocida (hasta ×3.5) y choca con la profundidad de campo;
  - el giro y su eje necesitan bolas marcadas y un algoritmo de orientación con σθ ≤2°: es el desarrollo más difícil;
  - el eje del driver (±3°, unas 6 yd de curva) domina el desvío;
  - la luz ambiente IR (sol, halógenos) y otros equipos con estroboscopio IR;
  - los disparos falsos o dobles, y el palo dentro de las primeras imágenes;
  - la calibración (distorsión de la lente, nivelación de la cámara a ±0.1-0.2°, plano de la bola);
  - la seguridad ocular del arreglo IR;
  - en Bogotá, la incertidumbre del modelo de vuelo de ±5% si no se calibra.

**Complementos para datos del palo:**
- **Velocidad de la cabeza:** con el radar del Nivel 1.
- **Camino del palo y ángulo de ataque:** 1-2 destellos sobre la cabeza antes del impacto, con disparo anticipado por una barrera 10 cm detrás de la bola (~2 ms de adelanto a 45 m/s). Una segunda cámara desde arriba con el mismo estroboscopio. La cabeza avanza unos 25 mm en 0.5 ms y un error de 0.15 mm en ese tramo son 0.35° de dirección: el camino y el ataque saldrían con ±0.5-1°, un supuesto porque seguir la cabeza es más difícil que seguir una bola.
- **Ángulo de la cara:** con la cámara de arriba. Más difícil; sin estimar.
- **Alternativa barata para la velocidad y el tempo:** una IMU en la varilla. Altera el swing y no se cuantificó.

### Gaps
- No se obtuvieron precios de 2026 de HB100, CDM324, Raspberry Pi 5, lentes, LEDs, filtros ni COB, ni su costo en Colombia (impuestos, envío): la lista de materiales es una estimación para completar con la investigación de precios.
- Los σ del Nivel 0 (obturador rodante) y del algoritmo de giro (σθ) son supuestos sin prueba.
- No se probó nada en hardware. No se evaluó la seguridad ocular ni la regulación de radiofrecuencia en Colombia.
- Las cifras del Nivel 2+ son optimistas y dependen de una segunda cámara o de un campo más largo para el giro, no diseñados en detalle.
