# Métodos de medición para un launch monitor de golf DIY de bajo costo (radar CW, fotometría, spin, datos del palo, disparo, smartphone y calibración)

> **Nota sobre las fuentes (14/11/2026).** En esta sesión la lectura directa de páginas web estaba bloqueada (patents.google.com, hackaday.io, docs.opencv.org, raspberrypi.com, arxiv.org, mdpi.com, omnipresense.com, etc. respondieron 403 o no resolvieron). Por eso:
> 1. Las fuentes primarias más detalladas son el **código y la documentación de dos proyectos abiertos clonados con git**: **PiTrac** (cámaras + estroboscopio, commit `78f1de6` del 10/10/2026) y **OpenFlight** (radar OPS243-A + radar TI IWR6843, commit `739ad20` del 08/11/2026). Todo lo citado de ellos se leyó directamente en sus archivos.
> 2. Dos patentes de Full Swing se leyeron completas (PDF de patentimages.storage.googleapis.com, que sí era accesible).
> 3. El resto viene de **resúmenes del buscador web** (sin abrir la página). Se marca "(resumen de búsqueda)" cuando el dato no se pudo comprobar en el texto original.
> 4. El presupuesto de búsquedas web de la sesión se agotó al final. Quedaron sin buscar la documentación oficial de calibración de OpenCV y una fuente para la velocidad del sonido (ver Gaps).
> Los cálculos propios están en "Inferencias" y se indican como tales.

## 1. Radar Doppler CW para golf: ecuación, separar palo y bola, STFT, corrección del coseno, ubicación, I/Q, límites en interior, cómo miden ángulos y spin los comerciales y qué se puede hacer con un módulo barato

### Takeaway
Un solo radar CW de 24 GHz **con salida I/Q** (el OPS243-A, unos 249 USD) mide bien la velocidad de bola y del palo y el smash factor. Las bolas se capturan desde 1–1.5 m detrás del tee con un búfer circular que dispara un sensor de sonido. No mide ángulos ni el eje de spin. El spin por bandas laterales es posible en teoría, pero en el proyecto abierto más avanzado solo acierta (≈1% de error mediano) en una minoría de tiros (11 de 61).
El ángulo de salida exige varias antenas receptoras y medir la diferencia de fase, como hacen los comerciales. OpenFlight lo consigue con un TI IWR6843 de 60 GHz, unos 150 USD más: 0.83° de error medio absoluto (MAE) en hierros contra TrackMan, y bastante peor en driver.
Los módulos más baratos (HB100, CDM324) son de un solo canal, sin I/Q, y no distinguen si el blanco se acerca o se aleja.

### Cited Findings
**Ecuación Doppler, muestreo y resolución**
- El OPS243-A trabaja a 24.125 GHz (λ = 0.01243 m), con ADC de 12 bits. A esa frecuencia, 1 mph produce ≈71.7 Hz de Doppler — [OpenFlight, constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
- Manual del OPS243-A: la tasa de 10,000 muestras/s (comando SX, la de fábrica) detecta hasta 31.1 m/s (69.5 mph), y 20,000 muestras/s (S2) hasta 62.2 m/s (139.1 mph). La resolución de la velocidad reportada mejora al bajar la tasa de muestreo (resumen de búsqueda) — [Manual OPS243-A](https://manuals.online/omnipresense/radar/ops243-a/user-manual/14dlk).
- OpenFlight usa el modo de **búfer circular** ("rolling buffer", `GC`) del OPS243-A:
  - 30,000 muestras/s;
  - 4,096 muestras I y 4,096 Q, unos 136.5 ms, la mitad antes del disparo (16 de 32 bloques);
  - ventana de 128 muestras con FFT de 4,096 (relleno con ceros);
  - paso de 32 muestras, 937.5 ventanas/s.

  A 30 ksps llega a ~208 mph, y bajar la tasa alarga el búfer: 25 ksps dan 174 mph en 164 ms — [rolling-buffer.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/rolling-buffer.md), [constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
- En el código de OpenFlight, cada ventana se multiplica por una **ventana de Hann**, se arma la señal compleja I + jQ y se hace la FFT. Las frecuencias positivas son blancos que se **alejan** ("outbound") y las negativas los que se **acercan** ("inbound"); los picos se buscan por separado en cada lado — [processor.py](https://github.com/open-flight/openflight/blob/main/src/openflight/rolling_buffer/processor.py).
- Más constantes de OpenFlight:
  - zona excluida alrededor de DC: 150 bins, ~15 mph;
  - separación mínima entre picos: 50 bins, ~5 mph, para no tomar lóbulos laterales como blancos;
  - hasta 3 picos por dirección;
  - magnitud mínima: 3 — [constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
- Una patente antigua (US 6,456,232) describe una cadena FFT con bloques de 128 muestras y 512 bins de frecuencia, en otro sistema de radar (resumen de búsqueda) — [US6456232](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6456232).

**Separar el palo de la bola**
- La misma patente US 6,456,232 dice que la señal Doppler contiene dos componentes, la velocidad de la cabeza del palo y la de la bola, que un detector y procesador configurados adecuadamente pueden distinguir (resumen de búsqueda) — [US6456232](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6456232).
- OpenFlight arma una **línea de tiempo** de velocidades con ventanas solapadas y separa las regiones del palo, del impacto y de la bola. El palo es la ventana previa al impacto y la bola la posterior — [pipeline.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/pipeline.md).
  - Para el palo toma un cuantil del 70% de la "meseta" en los 18 ms previos, con 4 ms de guarda antes del impacto.
  - Busca el inicio de la bola dentro de 10 ms.
  - Descarta velocidades de palo mayores a 150 mph — [constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
- Acconeer, con su radar de 60 GHz, halló la velocidad del palo y de la bola como picos del espectro, y dice que una aplicación real necesita un algoritmo de decisión automático. En su ejemplo: palo 40 m/s, bola 57 m/s, smash 1.43 (resumen de búsqueda) — [Acconeer](https://acconeer.com/?p=208).
- La patente de Full Swing US 11,311,789 B2 (2022) muestra un espectrograma CW con una traza del palo y otra de la bola: bola 93.7 mph, palo 73.7 mph, smash 1.27. El radar recibe Doppler continuamente, pero solo procesa los datos posteriores a un evento de disparo, por ejemplo el reconocimiento del palo en movimiento — [US 11,311,789 B2 (PDF)](https://patentimages.storage.googleapis.com/c4/12/c0/b3f55a7f05d52b/US11311789.pdf).
- Proyecto de Instructables con un OPS243-A configurado por terminal: usa la lectura de velocidad máxima, suponiendo que la bola es lo más rápido frente al sensor (resumen de búsqueda) — [Instructables](https://instructables.com/Golf-Ball-Speed-Detector).

**Corrección del coseno y ubicación**
- Ubicación recomendada en OpenFlight: el OPS243-A **0.9–1.5 m (3–5 ft) detrás del tee**, apuntando por la línea de objetivo. El Doppler mide la componente a lo largo del haz, y fuera del eje lee de menos por cos θ. Unos pocos grados de desalineación cuestan una fracción de por ciento, y por eso el OPS243 no tiene paso de calibración — [positioning.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/positioning.md).
- OpenFlight corrige la velocidad de bola cuando conoce el ángulo vertical de salida. El OPS lee la componente radial de una bola que sale con ese ángulo, y la corrección (`correct_ball_speed`) usa la distancia y la altura del radar respecto de la bola — [server.py](https://github.com/open-flight/openflight/blob/main/src/openflight/server.py).
- El Mevo+ en interior: 2.4 m (8 ft) del sensor al tee, con 4 m (13 ft) como mínimo a la red, y 2.4 m en el modo "short indoor". La fuente no aclara si esos mínimos se miden desde el tee o desde el sensor (resumen de búsqueda) — [PlayBetter FAQ Mevo+](https://help.playbetter.com/en-US/flightscope-mevo+-faqs-&-specs-35650).

**Un canal contra I/Q**
- El HB100 (10.525 GHz) no entrega I y Q por separado, así que con su salida IF no se sabe si el blanco se acerca o se aleja — [All About Circuits, teardown HB100](https://www.allaboutcircuits.com/news/teardown-tuesday-hb100-doppler-radar-module/).
- Su hoja de datos describe un oscilador de resonador dieléctrico, un mezclador balanceado simple y un par de antenas — [HB100 datasheet](https://mm.digikey.com/Volume0/opasdata/d220001/medias/docus/6360/HB100.pdf).
- La señal IF es diminuta: microvoltios según una fuente — [robolink PDF](https://akademi.robolinkmarket.com/Data/EditorFiles/PDF/hb100-mikrodalga.pdf) — y 1–5 mV, con una ganancia sugerida de ~10,000×, según otra — [Zbotic](https://zbotic.in/doppler-radar-sensor-hb100-detect-motion-with-microwave-for-arduino-projects/).
- El CDM324 (24 GHz) se vende como módulo de un solo canal, con unos 15 m de alcance — [Altronics](https://www.altronics.com.au/p/z6495-24ghz-millimeter-wave-radar-cdm324-sensor-module).

**Límites en interior (red a pocos metros)**
- OpenFlight explica por qué el disparo es por hardware: un disparo por software tardaría decenas de ms, y en 40 ms una bola a 150 mph recorre unos 2.7 m — [pipeline.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/pipeline.md).
- En interior el piso produce un eco fuerte que llega justo después del directo. El estimador de ángulo de OpenFlight modela ese multitrayecto en lugar de filtrarlo, y por eso la distancia a la red es un dato de entrada — [positioning.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/positioning.md).
- El firmware propio del IWR6843 guarda 12 tomas en unos 72 ms, separadas ~6 ms, con un barrido de 3.2 GHz que da bins de distancia de ~4.7 cm. Con driver hubo solo 3 tomas limpias antes de la red. El firmware de julio de 2026 usa 18 tomas a 4 ms — [launch-angle.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/launch-angle.md).
- Sobre el radar K-LD7, OpenFlight dice que con un transmisor, una cadencia lenta y una o dos tomas útiles tras el impacto no podía separar la trayectoria de la bola del multitrayecto. Le faltaba alcanzar 1° frente a TrackMan — [launch-angle.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/launch-angle.md).

**Cómo miden los ángulos los radares comerciales: interferometría de fase**
- US 8,257,189 relaciona la diferencia de fase entre dos antenas con el ángulo de elevación de salida, y US 8,801,529 hace lo mismo para el azimut. US 8,257,189 advierte que, al separar más las antenas, la posición de la bola en vuelo afecta la fase medida y mete error (resumen de búsqueda) — [US8257189](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8257189), [US8801529](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8801529).
- US 10,850,179 da la relación entre fase, ángulo, separación de antenas y longitud de onda. Para tener precisión, la separación debe ser grande respecto de λ (resumen de búsqueda) — [US10850179](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/10850179), [US11446546](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11446546).
- US 12,186,643 usa tres o más antenas en un plano para los ángulos horizontal y vertical, y resuelve la ambigüedad de 2π con más antenas en una rejilla, con referencia a US 9,958,527 (resumen de búsqueda) — [US12186643](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12186643).
- FlightScope describe un arreglo en fase que compara fases para medir la dirección — [FlightScope technology](https://flightscope.com/pages/technology).
- Full Swing (US 11,311,789 B2) combina un transmisor CW con uno FMCW lineal y varios receptores en un **arreglo no uniforme**:
  - el CW mide, por desplazamiento de frecuencia, la velocidad de bola y de palo, el spin y el eje de spin a la salida;
  - el FMCW mide, por desplazamiento de fase, el ángulo de salida, el camino del palo, el ángulo de ataque y el ángulo de la cara (algunos calculados) — [US 11,311,789 B2](https://patentimages.storage.googleapis.com/c4/12/c0/b3f55a7f05d52b/US11311789.pdf).
- Resultado DIY con interferometría de fase en OpenFlight (TI IWR6843, 60 GHz, 3 TX × 4 RX, con 8 canales virtuales verticales): 0.83° de MAE en hierros y wedges en dos sesiones de interior contra TrackMan.
  - Cobertura: 76 de 87 tiros (87.4%), con mediana 0.67°, p90 1.80° y sesgo −0.04°.
  - Driver: MAE 3.55° y p90 15.57° por falsas trazas lentas; golpes malos: 2.20°.
  - Sesión del 22/07/2026 con el firmware nuevo: ~0.68° de MAE en 20 tiros, pero muy sensible a la inclinación medida del montaje (12.4°).
  - Geometría mal medida (inclinación, distancias al tee y a la red, alturas): da un ángulo plausible pero equivocado, sin error visible — [launch-angle.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/launch-angle.md), [positioning.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/positioning.md).
- Comparativa propia de OpenFlight, K-LD7 (24 GHz, 2 RX × 1 TX, ±15°) contra IWR6843 (60 GHz, 4 RX × 3 TX):
  - ángulo vertical en hierros: 2.14° contra 0.83° de MAE, con sesgo de +1.85° en el K-LD7;
  - driver: 4.80° contra 1.42°;
  - resolución Doppler: 0.85 m/s, aliada sobre 62 mph, contra 0.18 m/s.

  El K-LD7 quedó obsoleto en el proyecto — [iwr6843_vs_kld7_comparison.md](https://github.com/open-flight/openflight/blob/main/docs/iwr6843_vs_kld7_comparison.md), [README OpenFlight](https://github.com/open-flight/openflight).

**Cómo miden el spin los radares: bandas laterales y pegatinas metálicas**
- Familia de patentes de TrackMan (US 8,845,442, US 9,645,235 y US 10,962,635; inventor Fredrik Tuxen):
  - la velocidad de rotación sale del análisis en frecuencia de una señal con trazas espectrales equiespaciadas; la separación se relaciona con el spin;
  - el **eje de spin se determina solo a partir de la trayectoria**;
  - las bandas laterales tienen varios armónicos separados por la frecuencia de spin;
  - una bola perfectamente esférica no produce bandas laterales;
  - no hacen falta marcas en la bola (resumen de búsqueda) — [US8845442](https://patents.google.com/patent/US8845442), [US9645235](https://patents.google.com/patent/US9645235), [US10962635](https://patents.google.com/patent/US10962635).
- Litigio: el Tribunal Federal de Justicia de Alemania resolvió que FlightScope no infringía esa patente de TrackMan en Alemania. FlightScope afirma que el método se conocía desde los años 80 en radares balísticos, aunque es una afirmación de parte — [Golf Business News](https://golfbusinessnews.com/news/innovation-centre/flightscope-wins-patent-infringement-case-against-trackman-in-germany/), [FirstCallGolf](https://www.firstcallgolf.com/industry-news/release/2022-11-16/flightscope-wins-patent-infringement-case-against-trackman-in-german-federal-court-of-justice).
- Full Swing ilustra con espectros que el número de picos principales y su separación cambian con el spin, y que la posición del radar respecto del eje de spin cambia esos rasgos. Ejemplo de la figura: "RPM = 9941, AXIS = 3.2°" — [US 11,311,789 B2](https://patentimages.storage.googleapis.com/c4/12/c0/b3f55a7f05d52b/US11311789.pdf).
- FlightScope recomienda pegatinas metálicas para medir el spin en interior con el Mevo+, porque el vuelo es corto; afuera no hacen falta. La pegatina debe quedar mirando directamente al Mevo+ (resumen de búsqueda) — [PlayBetter FAQ Mevo+](https://help.playbetter.com/en-US/flightscope-mevo+-faqs-&-specs-35650).
  - Una reseña dice que en interior el spin solo se **mide** con bolas Titleist RCT o con las pegatinas, y que si no se estima con un algoritmo (fuente de baja calidad) — [reseña](https://golf-sim-lab-pro.pages.dev/reviews/flightscope-mevo-plus).
  - Un usuario reportó un 30–40% de spins medidos con pegatina en "Short Indoors" — [GolfSimulatorForum](https://golfsimulatorforum.com/forum/flightscope/360576-mevo-spin-measured-vs-calculated).
  - Un vendedor dice que las pegatinas de FlightScope tienen tamaño, grosor y reflectividad específicos, y que se cambian cuando se gastan (afirmación comercial) — [MIA Golf](https://miagolftechnology.com/products/flightscope-metallic-stickers).
- OpenFlight describe el problema del spin con un CW barato:
  - el estimador de producción usa la envolvente de amplitud, que solo capta la parte AM (1–5% de profundidad de modulación) y descarta la modulación de fase, donde va casi toda la energía;
  - la **desaceleración** de la bola "chirpea" la portadora ~3–4 kHz/s con driver, así que en 60 ms la portadora y las bandas se corren ~200 Hz, mientras las separaciones son de 40–270 Hz (2,500–8,000 rpm). Una FFT simple las borronea;
  - solución experimental: seguir la portadora con STFT de 256 muestras (~8.5 ms, salto de 2 ms), ajustar f_d(t) cuadrática, "dechirpear" multiplicando por exp(−j2π∫f_d dt) y buscar con un peine armónico (33–400 Hz, pasos de 0.5 Hz) bandas simétricas ±1f/±2f/±3f;
  - la costura de la bola modula a 2× (caso común según la patente de FlightScope US 9,868,044), y hay que decidir entre 1× y 2× — [spin-replay.md](https://github.com/open-flight/openflight/blob/main/docs/development/spin-replay.md).
- Resultados de ese spin experimental contra TrackMan (61 tiros, 11/06/2026):
  - envolvente de producción: 12 de 61 tiros, error mediano ~3,200 rpm;
  - dechirp con puntaje de peine ≥ 5: 11 de 61, **~1.0% de error mediano** (0.1–1.5% por tiro);
  - dechirp con un "oráculo" que elige bien el armónico: 18 de 61 dentro de ±10%.

  En la interfaz se marca EXPERIMENTAL, limitado a 1,500–11,000 rpm, y no se usa para la distancia. El multitrayecto puede dar valores plausibles pero falsos — [spin-replay.md](https://github.com/open-flight/openflight/blob/main/docs/development/spin-replay.md), [rolling-buffer.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/rolling-buffer.md).
- Constantes del detector de spin de producción de OpenFlight:
  - pasa-banda Butterworth de orden 4, ±700 Hz alrededor del Doppler de la bola;
  - FFT de la envolvente de 8,192 puntos;
  - rango de 33 a 200 Hz;
  - al menos 600 muestras (~20 ms) de señal de bola;
  - SNR mínima de 2.5 para reportar — [constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
- Precisión de velocidad declarada por OpenFlight: bola de 15 a 200 mph con ±0.5% (OPS243-A). No se encontró en su documentación una validación de la velocidad contra TrackMan con números — [README OpenFlight](https://github.com/open-flight/openflight).

### Inferencias
- **Ecuación Doppler:** f_d = 2·v·f₀/c (cálculo propio).
  - A 24.125 GHz son 160.9 Hz por m/s (71.9 Hz por mph; OpenFlight redondea a ≈71.7), y una bola a 75 m/s da ≈12.1 kHz.
  - A 10.525 GHz (HB100) son 70.2 Hz por m/s (31.4 Hz por mph), y la misma bola da ≈5.3 kHz.
  - Con I/Q complejo a fs = 30 ksps el rango sin ambigüedad es ±fs/2 = ±15 kHz, es decir ±93 m/s (208 mph). Coincide con lo citado y con el manual (10 ksps → 31.1 m/s).
- **Resolución contra precisión de la STFT** (cálculo propio):
  - una ventana de 128 muestras a 30 ksps dura 4.27 ms, con bins nativos de 234 Hz; el ancho a −3 dB del lóbulo principal de Hann (≈1.44 bins) es ≈337 Hz, unas 4.7 mph;
  - el relleno a 4,096 puntos da una rejilla de 7.3 Hz (0.10 mph), que interpola el pico pero no mejora la capacidad de separar dos blancos;
  - palo y bola suelen diferir en 30–50 mph y se separan bien en frecuencia; lo difícil es el **tiempo**, porque en el impacto conviven palo, bola, manos y varilla.
  - Una alternativa estándar al relleno con ceros es la interpolación parabólica del pico, pero no se encontró una fuente que la evalúe en golf.
- **Corrección del coseno:** el error relativo es 1 − cos θ (cálculo propio). Da 0.4% a 5°, 1.5% a 10°, 3.4% a 15°, 4.4% a 17° (salida típica de un hierro 7) y 6.0% a 20°.
  - Con el radar detrás de la bola, la salida vertical es el término dominante: sin medir o suponer ese ángulo, la velocidad de un wedge sale varios por ciento baja.
  - Además, como el radar está a 1–1.5 m y no en el infinito, el ángulo entre la línea de visión y la velocidad cambia mientras la bola se aleja (paralaje). Por eso OpenFlight usa la distancia y la altura en la corrección.
- **Spin por radar en interior** (cálculo propio):
  - 2,000–3,000 rpm de driver son 33–50 Hz, o 67–100 Hz si la costura modula a 2×;
  - para resolver 33–50 Hz se necesitan unos 20–30 ms de señal limpia;
  - una bola a 60–75 m/s recorre 2.5 m en 33–42 ms y 3 m en 40–50 ms, y los primeros cm están contaminados por el palo;
  - con la red a 2.5–3 m queda justo el mínimo, lo que explica la baja cobertura citada.
  - La desaceleración por arrastre a 70 m/s, con ρ = 1.225 kg/m³, Cd ≈ 0.25 y A = π·0.0213², sale ≈23 m/s², es decir ≈3.8 kHz/s. Coincide con los "3–4 kHz/s" de OpenFlight.
  - En Bogotá el aire es menos denso (ρ ≈ 0.9 kg/m³ supuesto, no verificado aquí): el chirp baja a ≈17 m/s² y la carga es algo más fácil.
- **El eje de spin** en la patente de TrackMan sale de la trayectoria. Con una red a 2.5–3 m no hay trayectoria suficiente, así que un radar CW en interior no puede medirlo y hay que inferirlo con el plano D o con una cámara.
- **Con un solo módulo CW barato con I/Q (OPS243-A) se puede:**
  - velocidad de bola, que necesita la corrección del coseno;
  - velocidad del palo antes del impacto;
  - smash factor;
  - el instante del impacto, útil para disparar cámaras;
  - un spin experimental cuando la señal es buena.
- **No se puede:** ángulos de salida, eje de spin, camino del palo, ángulo de ataque ni ángulo de la cara. Esos datos piden varios receptores con fase (o FMCW MIMO, como el IWR6843) o una cámara.
- **Con un HB100 o un CDM324 de un solo canal, sin I/Q:**
  - no se distingue si el blanco se aleja o se acerca: el palo en el backswing o las manos se confunden con la bola;
  - hay que construir un amplificador de ~10,000× y digitalizar la IF;
  - a 24 GHz, para 75 m/s hacen falta ≥24 ksps; una tarjeta de sonido de PC a 48 kHz alcanzaría en ancho de banda, pero no hay una fuente que lo valide para golf.

  Es la opción más barata, pero exige mucho más trabajo de electrónica que el OPS243-A.

### Gaps
- No se pudo leer la nota de aplicación de OmniPreSense para golf ni las especificaciones exactas de la FFT interna del OPS243-A; los sitios estaban bloqueados.
- No hay validación publicada de la velocidad de bola del OPS243-A contra TrackMan. El "±0.5%" es una afirmación del proyecto, probablemente tomada de la ficha del sensor.
- No se encontraron cifras de los requisitos de distancia en interior de TrackMan 4, ni la distancia mínima a la red con que un CW logra spin medido.
- Las patentes de interferometría solo se vieron en resúmenes, no en su texto completo (fórmulas y reivindicaciones sin verificar).
- No se encontró la nota de aplicación de Infineon, RFbeam ni InnoSenT específica para golf.
- Las normas colombianas sobre el uso de 24 GHz y 60 GHz no se investigaron.

## 2. Fotometría: varias imágenes de la bola en una exposición con estroboscopio, detección de la bola, posición 3D con una cámara (profundidad por tamaño) contra estéreo, velocidad, ángulo vertical (VLA) y horizontal (HLA) de salida y calibración de la cámara

### Takeaway
PiTrac es la referencia abierta, de código y diseño libres, con Raspberry Pi 5, dos cámaras global shutter IMX296 y un estroboscopio LED.
1. **Disparo:** la cámara 1 vigila la bola en un recorte de 98×88 a ~572 fps y detecta el movimiento.
2. **Captura:** la cámara 2, en disparo externo, abre el obturador mientras el estroboscopio da pulsos de ~8.7 µs con intervalos irregulares (0.7, 1.8, 3.0… ms). Así quedan varias bolas en una sola imagen.
3. **Detección:** las bolas se encuentran con YOLO (por defecto) o HoughCircles.
4. **Posición:** la distancia de cada bola sale de su radio en píxeles (profundidad por tamaño), y la velocidad y los ángulos de las posiciones 3D y del tiempo entre pulsos. El intervalo de cada imagen se reconoce por la razón de distancias.

La profundidad por tamaño es mucho menos precisa que la posición en el plano de la imagen. El ángulo que va hacia la cámara o se aleja de ella es el más ruidoso; con PiTrac de costado, es el HLA. PiTrac no publica una precisión validada contra un monitor comercial.

### Cited Findings
**Estado del proyecto**
- PiTrac se presenta como el primer launch monitor de golf abierto y gratis. Determina la velocidad de salida, los ángulos y el spin en tres dimensiones, y se conecta con GSPro y E6/TruGolf.
  - Advierte que es "really immature" y que la versión actual es "a bit dodgy".
  - Recomienda una sola Raspberry Pi 5; la visión estereoscópica podría requerir dos — [README PiTrac](https://github.com/PiTracLM/PiTrac).

**Cámaras**
- Soporta la Pi GS y la InnoMaker IMX296 mono:
  - sensor de 1456×1088 px, con 5.077 mm × 3.789 mm de sensor en el código;
  - lentes de 6 mm o 3.6 mm M12 — [camera_hardware.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/camera_hardware.cpp).
- La geometría de fábrica pone la cámara 1 a (−0.200, −0.234, 0.54) m de la bola esperada y la cámara 2 a (0.0, −0.051, 0.45) m. El radio esperado de la bola a 40 cm es de 87 px, un dato "crítico para el cálculo de distancias" — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).

**Estroboscopio**
- Vector de pulsos para driver: `[0.7, 1.8, 3.0, 2.2, 3.0, 7.1, 4.0, 0]` ms; para putter: `[5.0, 30.0, 30.0, 30.0, 50.0, 0]` ms.
- El ancho del pulso es de 1 bit, a 115,200 baudios para pulsos rápidos y lentos.
- Antes de la captura se mandan 12 pulsos de "cebado" a 15 fps para estabilizar la exposición — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- El tren de pulsos se genera **por el bus SPI** (`lgSpiWrite`) como un patrón de bits a una tasa fija, y el obturador externo (XTR) se maneja con GPIO25 (pin 22).
  - Primero se abre el obturador, luego se envía todo el tren SPI y al final se cierra.
  - La placa conectora V1 invertía la señal XTR; la V2 no — [pulse_strobe.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/pulse_strobe.cpp).
- Algunas placas IMX296, como la Pi GS, necesitan un pulso extra de "flush" tras el del obturador para sacar el cuadro del sensor, porque un disparo solo avanza su máquina de estados; la InnoMaker no lo necesita — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- La entrada de disparo externo (XTR) de la Raspberry Pi Global Shutter Camera es de **1.8 V**.
  - Ejemplo oficial: un GPIO de la Pico (GP28) a XTR con una resistencia de 1.5 kΩ, y 1.8 kΩ de XTR a GND.
  - Con varias cámaras con XTR en paralelo se usa `dtoverlay=imx296,always-on` (resumen de búsqueda) — [Raspberry Pi docs, Global Shutter Camera](https://www.raspberrypi.com/documentation/accessories/global-shutter-camera.html).
  - Otros fabricantes llaman XVS o FSIN a sus pines de disparo — [Arducam external trigger](https://docs.arducam.com/Raspberry-Pi-Camera/Multi-Camera-CamArray/external-trigger/).

**Qué intervalo corresponde a cada bola**
- PiTrac compara las razones entre las distancias de las bolas de la imagen con las razones entre los intervalos del estroboscopio. La mejor correlación da la correspondencia, y el tiempo útil es el que hay entre las dos bolas más centradas, que suelen no estar solapadas.
- El código remite a la patente **US 12,401,909** — [gs_camera.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_camera.cpp).
- US 12,401,909 B2, "Timing determination in camera-based motion measurement systems" (solicitud 18/428,191): su fondo menciona que las imágenes múltiples superpuestas dificultan analizar el movimiento de la bola (resumen de búsqueda) — [Google Patents US12401909](https://patents.google.com/patent/US12401909).

**Detección de la bola**
- El método por defecto para las bolas con estroboscopio es una red **YOLO** (marcada experimental) con NCNN; la alternativa es **HoughCircles** ("legacy").
  - Hough se ajusta con búsquedas iterativas de param2 (mínimo, máximo, incrementos) y desenfoques previos a Canny y a Hough.
  - Hay un modo "alt" con `HOUGH_GRADIENT_ALT` — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- El código incluye un detector de elipses (Fornaciari/YAED, con ED_Lib) para afinar el contorno, y rutinas para quitar reflejos y aislar la bola — [ball_image_proc.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/ball_image_proc.cpp).
- OpenCV `HoughCircles` ofrece `HOUGH_GRADIENT` y `HOUGH_GRADIENT_ALT`, según el espejo docs.rs de su referencia:
  - recomienda dp = 1.5;
  - con ALT, param1 (umbral superior de Canny) debe ser más alto, ~300, porque usa derivadas de Scharr;
  - param2 es una medida de "perfección" del círculo, ~0.9 en la mayoría de los casos.

  No se encontró que refine centro y radio con precisión subpíxel — [docs.rs opencv hough_circles](https://docs.rs/opencv/latest/opencv/imgproc/fn.hough_circles.html), [tutorial OpenCV HoughCircles 4.10](https://docs.opencv.org/4.10.0/da/d53/tutorial_py_houghcircles.html).

**Distancia, velocidad y spin**
- La distancia por tamaño usa el modelo estenopeico:

  `distancia = (resolución / (2·r_px)) · (2·R_bola) · (f / ancho_sensor)`,

  con R_bola = 0.021335 m. El ancho efectivo del sensor se corrige según el ángulo de la elipse. Luego `ComputeXyzDistanceFromOrthoCamPerspective` convierte la distancia y la posición en la imagen a X, Y, Z — [gs_camera.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_camera.cpp), [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- El spin se calcula como `rpm = 60·(ángulo/360)/Δt`, con Δt en µs entre las dos imágenes usadas — [gs_camera.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_camera.cpp).
- Tolerancias de las pruebas automáticas de PiTrac (regresión contra resultados esperados, **no** precisión contra un monitor comercial): velocidad de bola ±4 mph, VLA ±2°, HLA ±3°, backspin ±250 rpm y sidespin ±300 rpm — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).

**Calibración**
- **Intrínsecos:** la calibración de la distorsión del lente usa un tablero **ChArUco** con OpenCV ≥ 4.7. El código fija:
  - un objetivo de 40 o más imágenes, citando a Hagemann 2021 para lograr una desviación estándar de fx/fx menor a 0.2%;
  - cobertura de al menos el 80% de una rejilla de 10×10;
  - al menos un 40% de imágenes inclinadas;
  - un umbral de nitidez (varianza del Laplaciano de 100);
  - un margen de 10 px al borde, porque `cornerSubPix` sesga las esquinas cercanas — [calibration_manager.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/calibration_manager.py), [charuco_detector.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/charuco_detector.py).
- Ejemplo de intrínsecos guardados para la cámara 1: fx ≈ 1833.5 y fy ≈ 1832.2 px, con distorsión k1 = −0.509 (fuerte). La cámara 2 tiene fx ≈ 2340 px — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- **Extrínsecos y focal "efectiva":** la autocalibración pone una bola en una plantilla de posición conocida, por ejemplo a (−0.12, −0.28, 0.44) m de la cámara 1 en la caja V2, y calcula la focal promediando 6 fotos, porque la focal "rebota" por pequeñas variaciones en la detección.
  - También guarda los ángulos de la cámara 1 (pitch 2.14°, yaw −26.4°) — [gs_calibration.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_calibration.cpp), [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).

**Cámaras de los comerciales**
- **SkyTrak:** banco de LED IR para detectar la bola en su lugar, 2 flashes de xenón invisibles, 2 láseres Clase 3R y **2 cámaras** de alta velocidad. Se presenta como fotométrico (resumen de búsqueda) — [SkyTrak specs](https://resources.skytrakgolf.com/skytrak-technical-specifications), [GolfTec KB](https://support.golftec.com/kb/article/181-skytrak-technical-specifications/).
- **Foresight:** cámaras calibradas entre sí para medir el palo en 3D por estereoscopía (US 8,951,138) — [US8951138](https://patents.google.com/patent/US8951138).
- **Uneekor:** el EYE XO tiene 2 cámaras sobre la cabeza a más de 3,000 fps y el XO2, 3 cámaras. Esas cifras vienen de revendedores y reseñas (resumen de búsqueda) — [Carl's Place EYE XO](https://shop.carlofet.com/uneekor-eye-xo), [Golfers Authority](https://golfersauthority.com/uneekor-eye-xo-launch-monitor/).

### Inferencias
- **Error de la profundidad por tamaño:** de Z = f_px·D/(2r) sale dZ/Z = dr/r (cálculo propio).
  - Con lente de 6 mm en el IMX296 (f ≈ 1,720 px), la bola a 0.45 m mide r ≈ 82 px. PiTrac usa 87 px a 40 cm; el modelo da ~92, y la diferencia la absorbe su calibración.
  - Un error de radio de 0.5 px da dZ ≈ 2.8 mm.
  - Si dos imágenes de la bola están separadas 12.6 cm (70 m/s y 1.8 ms), el error en el ángulo hacia la cámara es ≈ atan(√2·2.8/126) ≈ 1.8°. Con 28 cm de separación (4 ms) baja a ≈0.8°.
  - Eso explica por qué la tolerancia de PiTrac para HLA (±3°) es mayor que para VLA (±2°).
  - Para bajar el error: usar más imágenes y ajustar una recta 3D, mejor ajuste subpíxel del borde (elipse), separaciones mayores o una segunda vista, ya sea estéreo o con espejo.
- **Velocidad y VLA:** salen sobre todo del movimiento en el plano de la imagen (cientos de píxeles), mucho más preciso que la profundidad. Una cámara de costado mide bien la velocidad y el VLA, y peor el HLA. Una cámara desde arriba mide bien el HLA y peor el VLA. Con las dos se cubren ambos ángulos.
- **Borrón con el estroboscopio** (cálculo propio):
  - 1 bit a 115,200 baudios dura ≈8.7 µs;
  - a 70 m/s la bola se mueve 0.61 mm en ese tiempo, unos 2.3 px con r = 80 px (3.75 px/mm);
  - pulsos de 20 µs dan ≈5 px y de 50 µs ≈13 px;
  - para driver conviene ≤10 µs, con LEDs muy potentes y la cámara con ganancia alta en un ambiente oscuro o con filtro IR.
- **Vector de pulsos para driver** (cálculo propio): a 70 m/s, 0.7 ms son 4.9 cm, apenas más que el diámetro de la bola (4.27 cm), así que las primeras imágenes casi se tocan; 1.8 ms son 12.6 cm.
  - Los intervalos distintos permiten saber qué pulso produjo cada imagen aunque falten bolas fuera del cuadro.
  - En total son 21.8 ms, unos 1.5 m de recorrido, más que el campo de una cámara a 45 cm. Por eso solo algunas bolas caen en la imagen.
- **Una implementación en Python con OpenCV** podría seguir estos pasos:
  1. Calibrar intrínsecos con ChArUco (`cv2.aruco.CharucoDetector` y `cv2.calibrateCamera`) y extrínsecos con la bola en una plantilla de posición conocida.
  2. Corregir la distorsión de la imagen estroboscópica.
  3. Detectar círculos con YOLO, o con HoughCircles más el ajuste de una elipse sobre el borde (`cv2.fitEllipse` con puntos de Canny) para afinar.
  4. Calcular Z por tamaño y X, Y por proyección.
  5. Asignar los intervalos por razones de distancia.
  6. Ajustar la recta 3D por mínimos cuadrados.
  7. Velocidad = distancia/Δt; VLA = atan2(ΔY, √(ΔX² + ΔZ²)); HLA = atan2(ΔZ_lateral, ΔX_objetivo), en el sistema de la línea de objetivo.

  Este flujo es una propuesta: no hay fuente que lo valide fuera de PiTrac, que lo hace en C++.

### Gaps
- No se encontró ninguna validación independiente y publicada de la precisión de PiTrac contra GCQuad, TrackMan o Mevo. La búsqueda no devolvió resultados.
- No se pudo verificar en el texto original la patente US 12,401,909: ni la asignación, ni las reivindicaciones, ni si es del autor de PiTrac.
- No se encontraron fuentes sobre el estéreo con espejo en golf.
- La documentación oficial de calibración de OpenCV (reproyección típica aceptable) no se pudo consultar, por bloqueo y por el presupuesto agotado.
- No se verificó si `HOUGH_GRADIENT_ALT` da precisión subpíxel.

## 3. Spin desde imágenes: bolas marcadas contra hoyuelos naturales, algoritmos de rotación 3D, cómo lo hace PiTrac, qué revelan las patentes, precisión y artículos (golf, tenis de mesa, béisbol)

### Takeaway
El método abierto y documentado es el de PiTrac, sin marcas en la bola:
1. aísla dos imágenes de la bola y las lleva al mismo radio;
2. extrae el patrón de hoyuelos con un banco de filtros Gabor y lo binariza;
3. compensa la perspectiva de cada bola;
4. proyecta la primera imagen a un hemisferio (z = √(r² − x² − y²)), la rota por ángulos candidatos de Euler, la vuelve a proyectar y elige la que más coincide con la segunda.

Hoy usa por defecto una red pequeña (NCNN, entrada de 128 px, salida en representación 6D de la rotación) y recurre a la búsqueda si el giro supera 60°.
Los comerciales baratos usan bolas marcadas (Rapsodo RPT a 240 fps) o el logo hacia la cámara (SkyTrak). Uneekor y Foresight leen hoyuelos con cámaras rápidas.
No hay cifras de precisión publicadas de PiTrac. En tenis de mesa con cámara de eventos, el error es grande (eje ≈33°).

### Cited Findings
**PiTrac, paso a paso** (código leído directamente)
- Aísla cada bola, las redimensiona al mismo radio y aplica Gabor (`ApplyGaborFilterToBall`), con un umbral calibrado para que entre el 39% y el 45% de la imagen quede blanca — [ball_image_proc.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/ball_image_proc.cpp), [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Rota cada imagen para compensar el ángulo con que la cámara ve la bola fuera de su centro, repartiendo la diferencia entre las dos. Después lleva los ángulos a los ejes del simulador y cambia el signo del sidespin según la convención del golf — [ball_image_proc.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/ball_image_proc.cpp).
- **Búsqueda "legacy"** (`GetRotatedImage`): proyecta la imagen 2D a un hemisferio (x² + y² + z² = r²), aplica la rotación candidata y vuelve a 2D.
  - El puntaje (`CompareRotationImage`) cuenta los píxeles iguales entre la candidata y la segunda imagen, sin contar los que se ignoran.
  - La búsqueda gruesa trabaja a 90 px: X de −36° a 36° (paso 4), Y de −15° a 15° (paso 5) y Z de −10° a 110° (paso 4). Luego afina — [ball_image_proc.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/ball_image_proc.cpp), [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- **Método por defecto "ml":** un predictor NCNN (`SpinPredictor`) toma las dos imágenes Gabor ternarias como 2 canales de 128 px.
  - Su salida es una rotación en representación 6D, que Gram-Schmidt convierte en matriz y luego en ángulos de Euler.
  - Si el giro en Z supera 60°, rehace solo Z con la búsqueda clásica en pasos de 2° — [ball_image_proc.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/ball_image_proc.cpp), [spin_predictor.hpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/spin_predictor.hpp), [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Las licencias de los modelos entrenados de PiTrac son aparte de la GPL — [README PiTrac](https://github.com/PiTracLM/PiTrac).
- **Verificación visual** (registro de Hackaday de marzo de 2024, anterior al cambio a ML): se aplica el spin calculado a la primera imagen y, si funciona, debe verse como la segunda. El objetivo era medir spin en 3 ejes sin marcas (resumen de búsqueda) — [Hackaday PiTrac log](https://hackaday.io/project/195042/log/228522-spin-analysis-accuracy-verification).

**Patentes y artículos de golf**
- US 7,209,576 ("Methods, apparatus and computer program products for processing images of a golf ball") determina backspin y sidespin desplazando imágenes de la bola hasta la mejor coincidencia (resumen de búsqueda) — [US7209576](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7209576).
- Otras patentes de la misma búsqueda: US 6,458,035, "Method of measuring rotational motion of a golf ball"; US 12,714,910, "Devices, systems, and methods for measuring spin of a golf ball"; y US 12,008,770, "…measuring ball spin" — [US6458035](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/6458035), [US12714910](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12714910), [US12008770](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/12008770).
  - El resumen atribuye a estas patentes, sin decir a cuál, cuatro ideas: recuperar el vector de rotación 3D con pocas imágenes de una cámara, con más precisión cuanto más cuadros (15–30); proyectar a un hemisferio y probar rotaciones candidatas, con la dificultad de que no se ve la cara trasera de la bola; correlacionar los centros de los hoyuelos; y una advertencia de que borrar los brillos del centro perjudica la precisión. Sin verificar.
- Imai et al. (IEEE SII 2016) estiman rotaciones grandes, de hasta ~60° entre dos cuadros infrarrojos, de una bola **sin marcas** (resumen de búsqueda) — [Imai 2016 (DOI vía unpaywall)](https://unpaywall.org/10.1109%2FSII.2016.7844057), [J-STAGE Robomec 2015](https://www.jstage.jst.go.jp/article/jsmermd/2015/0/2015__2A1-S08_1/_article/-char/en).

**Tenis de mesa**
- Tebbe, Klamt, Gao y Zell (ICRA 2020) comparan tres métodos: dos con una cámara rápida a 380 Hz que mira el logo, y uno que deduce el spin de la trayectoria por la fuerza de Magnus. El de trayectoria fue el más preciso, y el ajuste de segmentos circulares mejoró la extracción del logo (resumen de búsqueda) — [arXiv 1905.07967](https://ar5iv.arxiv.org/html/1905.07967).
- Gossard et al. (CVPRW 2024) usan una cámara de eventos, porque en las cámaras de cuadros el logo se borronea a alta velocidad.
  - Errores: 10.7 ± 17.3 rps en la magnitud y 32.9 ± 38.2° en el eje, en tiempo real.
  - El artículo plantea una regla de frecuencia de muestreo respecto del spin (redacción exacta sin verificar) (resumen de búsqueda) — [Gossard CVPRW 2024](https://openaccess.thecvf.com/content/CVPR2024W/CVsports/papers/Gossard_Table_Tennis_Ball_Spin_Estimation_with_an_Event_Camera_CVPRW_2024_paper.pdf), [arXiv 2404.09870](https://arxiv.org/abs/2404.09870v1).

**Comerciales**
- **Rapsodo MLM2PRO:** la cámara lee un patrón impreso en las bolas RPT a **240 fps** para el spin y su eje. Sin bolas RPT no hay spin medido; los demás datos sí salen. El patrón va bajo la capa transparente, con tolerancias estrictas de impresión (resumen de búsqueda) — [Rapsodo RPT](https://rapsodo.com/products/callaway-chrome-tour-golf-balls-rpt), [MyGolfSpy](https://mygolfspy.com/first-look-rapsodo-mobile-launch-monitor-mlm2pro/).
  - Un reseñador dice que el spin queda dentro del 1% y a menos de 200 rpm en la mayoría de los tiros, en una prueba informal. Es un resumen de búsqueda, y no se pudo confirmar cuál de las reseñas lo dice; la candidata es Golfers Authority — [Golfers Authority](https://golfersauthority.com/rapsodo-mlm2pro-launch-monitor/).
- **SkyTrak:** pide poner la bola sobre el punto láser y con el logo hacia la lente para un spin más preciso (resumen de búsqueda) — [SkyTrak FAQ](https://resources.skytrakgolf.com/frequently-asked-questions-about-the-skytrak-launch-monitor), [SkyTrak specs](https://resources.skytrakgolf.com/skytrak-technical-specifications).
- **Uneekor:** anuncia una tecnología patentada para bolas sin marcas ("Dimple Optix"); no se halló el número de patente — [Uneekor EYE XR](https://uneekor.com/golf-launch-monitors/eye-xr).
- **Foresight (afirmación propia):** en golpes centrados, el GCQuad dio una desviación estándar de spin de 82 rpm (rango de 226) contra 175 (620) del TrackMan 4 — [Foresight blog](https://www.foresightsports.com/blogs/golf-tips/comparing-golf-launch-monitor-foresight-sports-gcquad-and-gc3-stand-above-the-rest).

### Inferencias
- **Muestreo y aliasing** (cálculo propio): el giro entre las dos imágenes debe quedar muy por debajo de 180°, o la rotación es ambigua.
  - 3,000 rpm giran 12.6° en 0.7 ms y 32.4° en 1.8 ms.
  - 10,000 rpm giran 42° en 0.7 ms y 108° en 1.8 ms.
  - El rango de Z de PiTrac (hasta 110°) en 1.8 ms equivale a ≈10,200 rpm: está pensado para wedges con intervalos cortos.
  - Un smartphone a 240 fps (4.17 ms por cuadro) ve 750° por cuadro a 3,000 rpm. El spin con hoyuelos es inviable; las bolas RPT funcionan porque su patrón está diseñado para eso y Rapsodo combina la cámara con el radar.
- **Marcas contra hoyuelos:**
  - Una bola marcada, con una línea o puntos de alto contraste, simplifica mucho el problema: basta detectar 2 o 3 marcas y resolver la rotación como un problema de Wahba o Kabsch con cuaterniones. Es lo más fácil de implementar en Python.
  - Los hoyuelos exigen más resolución (r ≥ 80 px), iluminación sin brillos y el enfoque de Gabor y búsqueda, o una red entrenada, como en PiTrac.
  - Un camino intermedio: el logo hacia la cámara, como en SkyTrak.
- **Eje de spin:** sale de la misma rotación 3D, como cociente entre los componentes del vector de rotación (backspin y sidespin). Su error crece mucho cuando el spin es bajo o la imagen es pobre, como muestra el error de 33° en el eje en tenis de mesa.

### Gaps
- No se encontraron cifras de precisión publicadas del spin de PiTrac (ni del método legacy ni del ML) contra un monitor comercial. El registro de Hackaday no se pudo abrir.
- No se pudieron leer los textos de US 6,458,035, US 12,714,910 ni US 12,008,770, ni las patentes de Uneekor y SkyTrak (la de SkyTrak no se encontró). Tampoco las de Foresight sobre spin de bola.
- La búsqueda no dio artículos de béisbol (Hawk-Eye, costuras) con cifras.
- No hay datos sobre el error de los métodos de logo con cámara de cuadros del artículo de Tebbe.

## 4. Datos del palo a bajo costo: velocidad de la cabeza, ángulo de ataque, camino, ángulo de la cara y punto de impacto

### Takeaway
1. **Velocidad del palo:** la da el mismo radar CW antes del impacto (OpenFlight, Acconeer, Full Swing).
2. **Camino y ángulo de ataque:** necesitan ángulos, sea por radar MIMO con fase (OpenFlight IWR6843, experimental, ~1.2° RMSE según el propio proyecto) o por cámara con varios cuadros antes del impacto. PiTrac solo guarda esos cuadros (6 antes y 8 después), sin analizarlos todavía.
3. **Ángulo de la cara y punto de impacto:** los comerciales los miden con marcadores en la cara (Foresight, cuatro para la cara y el impacto) o pegatinas reflectantes (Uneekor).
4. **Sin marcadores:** el plano D da una aproximación. Según TrackMan, citado por Titleist, la dirección de salida es ~75% cara y 25% camino en hierros, y ~85/15 con driver.

### Cited Findings
- **Velocidad del palo por radar:** OpenFlight la toma de las lecturas previas al impacto del OPS243-A y calcula el smash factor; también tiene un modo para medir swings al aire — [README OpenFlight](https://github.com/open-flight/openflight), [constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
  - Acconeer (palo 40 m/s, bola 57 m/s) y Full Swing (73.7 y 93.7 mph) dan ejemplos de espectros con ambas trazas — [Acconeer](https://acconeer.com/?p=208), [US 11,311,789 B2](https://patentimages.storage.googleapis.com/c4/12/c0/b3f55a7f05d52b/US11311789.pdf).
  - Hay una patente de un "radar miniatura para medir velocidad de cabeza y tempo" (US 8,007,367); solo se vio el título — [Justia US8007367](https://patents.justia.com/patent/8007367).
- **Camino del palo por radar:** OpenFlight saca la salida horizontal y el camino de los cuadros previos al impacto del IWR6843.
  - La salida horizontal usa la fase de TX2 respecto de TX1/TX3, con una "fase de referencia" de la línea de objetivo calibrada por equipo.
  - En 41 tiros reservados contra TrackMan, la salida horizontal tuvo 0.948° de MAE con cobertura total y 0.797° en 37 tiros que pasaron el filtro de calidad — [club-path.md](https://github.com/open-flight/openflight/blob/main/docs/iwr6843/club-path.md).
  - Su comparativa propia da ±1.18° de RMSE para el camino y ±1.10° para el azimut — [iwr6843_vs_kld7_comparison.md](https://github.com/open-flight/openflight/blob/main/docs/iwr6843_vs_kld7_comparison.md).
  - El camino figura como "experimental" — [README OpenFlight](https://github.com/open-flight/openflight).
- **Cámara en PiTrac:** puede guardar imágenes del palo, apagado por defecto: 6 cuadros antes y 8 después del golpe, en 340×200 px, con ganancia de 40 y obturación de 0.4× el periodo del cuadro.
  - El recorte para el palo es mayor que el de vigilar la bola, así que la cámara va más lenta.
  - En el código el análisis está pendiente ("TBD – Perform analysis… just dump the frame images") — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json), [gs_club_data.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_club_data.cpp), [libcamera_interface.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/libcamera_interface.cpp).
- **Foresight**, patente US 8,951,138 (WAWGD Inc. dba Foresight Sports):
  - cámaras calibradas entre sí miden el palo en 3D por estereoscopía, con marcadores en la cara fotografiados durante el take-away y justo antes del impacto;
  - un sensor inercial cubre los momentos en que los marcadores salen de la vista;
  - la variante US 8,758,151 trabaja con una sola cámara y marcadores fuera de la cara (resumen de búsqueda) — [US8951138](https://patents.google.com/patent/US8951138), [US8758151](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8758151).
- Según Foresight, **cuatro marcadores** permiten todos los datos, incluidos el ángulo de la cara y el punto de impacto, y uno solo da los básicos. El ángulo de la cara es el giro (yaw) del plano de la cara respecto de la línea de objetivo — [Foresight club markers](https://help.foresightsports.com/hc/en-us/articles/4408197030035-How-to-Apply-and-Maintain-Club-Markers-for-Foresight-Sports-Devices), [Fiducial Application Guide](https://support.foresightsports.com/fiducial-application-guide), [Club Head Data Definitions](https://help.foresightsports.com/hc/en-us/articles/47214673873811-Club-Head-Data-Measurements-Definitions).
- **Uneekor:** los datos de bola funcionan sin marcas, pero los del palo necesitan sus pegatinas reflectantes de barra y punto (resumen de búsqueda) — [Golfers Authority Uneekor](https://golfersauthority.com/uneekor-eye-xo-launch-monitor/).
- **Rapsodo:** según un revendedor, desde mayo de 2025 el MLM2PRO mide el camino y el ángulo de ataque con el radar y dos cámaras — [Carl's Place MLM2PRO](https://shop.carlofet.com/rapsodo-mlm2pro-launch-monitor).
- **FlightScope** vende un "Pro Package and Face Impact Location"; el Pro Package agrega camino y cara contra camino (según un revendedor) — [PlayBetter Pro Package & FIL](https://www.playbetter.com/products/flightscope-pro-package-and-face-impact-location?ghref=2301%3A1337756), [FlightScope Mevo Gen2 Pro Package](https://flightscope.com/products/mevo-gen2-with-pro-package).
- **Plano D:** según TrackMan, citado por Titleist, el ángulo de la cara explica ~75% de la dirección de salida en hierros medios (25% el camino) y ~85% con driver (15%) — [Titleist club path](https://www.titleist.com/learning-lab/performance/golf-club-path), [Titleist face angle](https://www.titleist.com/learning-lab/performance/golf-club-face-angle).
  - GolfWRX da 75–80% sin separar por palo — [GolfWRX](https://www.golfwrx.com/146509/what-flightscope-and-trackman-can-tell-you-and-me/).
  - TrackMan define "face to path" como la diferencia entre el ángulo de la cara y el camino — [TrackMan Parameter Definitions](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions), [TrackMan, What is face angle](https://www.trackman.com/blog/golf/what-is-face-angle).

### Inferencias
- **Inversión aproximada del plano D** (cálculo propio, regla empírica y no física exacta): HLA ≈ k·cara + (1 − k)·camino, con k ≈ 0.75 en hierros y 0.85 con driver. Si se mide el HLA por cámara y el camino por cámara o radar, sale cara ≈ (HLA − (1 − k)·camino)/k.
  - Error: con k = 0.75, 1° de error en el camino da ~0.33° en la cara y 1° en el HLA da ~1.33°.
  - El eje de spin, si se mide, sirve para comprobar el signo de cara contra camino.
- **Ángulo de ataque y camino con una cámara global shutter a 300–600 fps:** se puede rastrear la cabeza, o una pegatina de alto contraste o retrorreflectante, en 3 a 6 cuadros previos al impacto y ajustar una recta o curva 3D. La vista de costado da el ataque y la vista desde arriba da el camino. Es el mismo principio de PiTrac y Uneekor, pero no hay implementación abierta que lo valide.
- **Punto de impacto barato:** pegatinas o spray de impacto leídos con una foto tras el golpe, o por cámara si se ve la cara. Con marcadores es mucho más simple que sin ellos.
- **Velocidad del palo por radar:** mide la velocidad radial del punto más reflectante, que puede ser la cara, la varilla o las manos. Por eso OpenFlight usa cuantiles de meseta y una ventana justo antes del impacto: es una medida aproximada.

### Gaps
- No hay cifras validadas de la precisión del ángulo de ataque ni de la cara con métodos DIY.
- El RMSE de 1.18° del camino viene del documento interno de OpenFlight, no de una validación independiente.
- No se encontraron algoritmos publicados de la cara sin marcadores a partir de imágenes, ni la precisión de la inversión del plano D.

## 5. Disparo (trigger): acústico, haz IR o cortina láser, radar, detección de movimiento por cámara y temporización en microsegundos con Pico (PIO) o ESP32

### Takeaway
Hay tres opciones probadas en proyectos abiertos:
- **Sensor de sonido cableado directo al radar** (OpenFlight): SparkFun SEN-14262 a HOST_INT del OPS243-A, con ~10 µs de latencia electrónica. El búfer circular guarda lo anterior, así que el retardo acústico no importa.
- **Detección de movimiento por cámara** (PiTrac): un recorte de 98×88 a ~572 fps, es decir 1.75 ms entre cuadros. Dispara el obturador y el estroboscopio por hardware.
- **Cortina IR láser** (SkyTrak, según foros).

Lo crítico es que **ningún disparo pase por software lento**. Para cámaras y estroboscopio, un microcontrolador (Pico con PIO, o el SPI de la Pi como hace PiTrac) da temporización de microsegundos, y la PIO del RP2040 marca tiempos con ~62.5 ns de resolución.

### Cited Findings
**Acústico y por radar (OpenFlight)**
- Cadena de disparo: el SEN-14262 detecta el golpe y sube su salida GATE, que va al pin HOST_INT del OPS243-A (hardware, ~10 µs) y también al BCM17 de la Pi. No hay software en el camino del OPS, y por eso la ventana de captura es confiable — [pipeline.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/pipeline.md).
  - Latencias: ~10 µs con el sonido y ~5–6 ms con el disparo interno por velocidad del OPS243 — [constants.md](https://github.com/open-flight/openflight/blob/main/docs/reference/constants.md).
- El disparo interno por velocidad del OPS243 es opcional y pide firmware v1.3.2 o mayor (rama 1.3): umbral de 25 mph, magnitud 25 y 6 segmentos previos. Rechaza volcados sin una bola de salida de al menos 35 mph — [hardware-trigger.md](https://github.com/open-flight/openflight/blob/main/docs/hardware-trigger.md).
- El SEN-14262 está pensado para 5 V. A 3.3 V su preamplificador tiene demasiada ganancia y GATE puede quedar pegado en alto. La solución es soldar una resistencia en R17, empezando por 47 kΩ — [sound-trigger.md](https://github.com/open-flight/openflight/blob/main/docs/build/sound-trigger.md).
- Con el búfer circular, el modo debe quedar guardado en la flash del OPS243, porque el firmware cambia el comportamiento de HOST_INT si se entra al modo en marcha.
  - Volcado: 40,556 bytes, ~1.8 s a 230,400 baudios.
  - A 19,200 baudios (fábrica) serían ~21 s, y cada captura quedaría truncada — [pipeline.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/pipeline.md).

**Por cámara (PiTrac)**
- La cámara 1 vigila la bola en un recorte de 96×88 px (máximo de la configuración); "98×88 puede dar 572 fps en la cámara GS".
  - El bucle de detección de movimiento corre con prioridad de tiempo real, y la codificación se hace después de revisar el movimiento, para sacarla del camino crítico.
  - Usa la etapa `motion_detect` de rpicam-apps con parámetros de diferencia y umbral de región — [libcamera_interface.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/libcamera_interface.cpp), [ball_watcher.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/ball_watcher.cpp), [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- El obturador externo se maneja con GPIO25 y el estroboscopio con SPI desde la Pi 5, sin microcontrolador aparte — [pulse_strobe.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/pulse_strobe.cpp).
- Raspberry Pi documenta cómo disparar la GS Camera con una Pico por XTR (1.8 V) — [Raspberry Pi docs GS Camera](https://www.raspberrypi.com/documentation/accessories/global-shutter-camera.html).

**Cortina láser (SkyTrak)**
- Según un foro de usuarios, cuando la bola cruza la línea láser IR, invisible a simple vista, las cámaras se disparan y toman una foto cada una.
- Según una patente citada en el foro, el sensor también estimaría la velocidad por la intensidad de la luz reflejada.
- Riesgo especulado: que la varilla cruce primero la cortina y dispare sin bola.
- Otro usuario reporta 3 imágenes por tiro. Todo es información de usuarios (resumen de búsqueda) — [GolfSimulatorForum SkyTrak FAQ](https://golfsimulatorforum.com/forum/skytrak/33189-skytrak-technical-faq).

**Microcontrolador**
- Un artículo de Columbia (2023) implementa en las PIO del RP2040 periféricos de captura de entrada y comparación de salida con precisión submicrosegundo.
  - Las diapositivas indican 16 MHz de muestreo de la PIO (reloj de 128 MHz con un contador de 8 ciclos) y unos 20 µs de reacción entrada→salida en su montaje (resumen de búsqueda) — [Columbia, hui2023timestamp.pdf](https://www.cs.columbia.edu/~sedwards/papers/hui2023timestamp.pdf), [diapositivas](https://www.cs.columbia.edu/~sedwards/presentations/2023-memocode-pio.pdf).
- El RP2040 no tiene captura de temporizador por hardware, y se puede armar con una o dos máquinas de estado PIO — [Cornell ECE4760](https://people.ece.cornell.edu/land/courses/ece4760/RP2040/C_SDK_PIO_control/Input_capture/index_pio_control.html).
- Un proyecto de strawlab usa una Pico para registrar cuándo se dispararon sus cámaras de alta velocidad (visto en un espejo de GitHub; el original sería github.com/strawlab/red-button-trigger-timestamp) — [red-button-trigger-timestamp (espejo)](https://github.kxpsado.workers.dev/strawlab/red-button-trigger-timestamp).

### Inferencias
- **Retardo acústico** (cálculo propio, con la velocidad del sonido de ≈343 m/s a 20 °C, valor de manual no citado aquí): un micrófono a 0.3 m de la bola oye el golpe 0.9 ms después; a 1.2 m (radar detrás del tee), 3.5 ms.
  - En 3.5 ms una bola a 70 m/s ya está a ~25 cm del tee.
  - Para el radar con búfer circular no importa, porque el búfer guarda lo anterior. Para una cámara sin búfer sí: el micrófono debe ir junto al tee, o la cámara debe esperar a que la bola llegue a su campo, sabiendo dónde está.
  - El sonido también se dispara con golpes al tapete, prácticas cercanas o swings de prueba que rozan el pasto. Conviene combinarlo con una condición del radar, como la velocidad saliente de más de 35 mph de OpenFlight.
- **Por cámara a 572 fps:** entre cuadros la bola a 70 m/s recorre 12 cm (cálculo propio). La detección tiene una incertidumbre de hasta 1.75 ms más la latencia de procesamiento. PiTrac la compensa con una cámara 2 de campo amplio y el tren de pulsos que cubre ~21.8 ms.
- **Haz IR casero:** un emisor y un fototransistor o fotodiodo cerca del tee, o dos haces separados una distancia conocida que hacen de cronógrafo, son baratos.
  - Los receptores IR modulados de control remoto son lentos (cientos de µs) y no sirven; hace falta un fotodiodo con comparador.
  - No hay una fuente que dé las latencias de los módulos baratos.
- **Arquitectura sugerida:** un evento de hardware (sonido, haz o radar) entra a la Pico. La PIO genera, con resolución de ciclo, el pulso de obturador hacia XTR, pasando por el divisor a 1.8 V, y el tren de estroboscopio, y registra las marcas de tiempo.
  - La Pi o el PC solo leen las imágenes y los tiempos.
  - Hacerlo con el SPI de la Pi, como PiTrac, también funciona sin microcontrolador, con una granularidad de 8.7 µs a 115,200 baudios.

### Gaps
- No se encontraron fuentes con latencias medidas de piezos o micrófonos electret contra el instante real del impacto.
- No se encontraron datos de captura de entrada del ESP32 (MCPWM o RMT) aplicados a esto.
- No hay especificaciones oficiales de la cortina láser de SkyTrak: solo foros y una patente sin identificar.
- No se verificó la velocidad del sonido con una fuente, porque el presupuesto de búsquedas se agotó.

## 6. Costo cero: video en cámara lenta de smartphone a 240/480 fps (qué se puede medir, precisión y límites por rolling shutter, borrón y tiempo de cuadro)

### Takeaway
A 240 fps un smartphone sirve para medir aproximadamente la velocidad del palo, el ángulo de ataque y el ángulo vertical de salida si se ven 2 o 3 cuadros de la bola. La velocidad de bola queda gruesa y el spin no se puede medir.
Los límites son tres:
1. **Distancia por cuadro:** la bola recorre ~29 cm entre cuadros a 70 m/s.
2. **Borrón:** la exposición automática no se controla.
3. **Rolling shutter:** desfasa en el tiempo las filas de la imagen y puede sesgar la velocidad entre ~10% y 15% si la bola cambia de altura en la imagen.

No se encontró ningún estudio revisado por pares que valide estas medidas con 240 fps contra un launch monitor.

### Cited Findings
- Una familia de patentes de apps móviles dice que sus experimentos con video de alta velocidad estimaron la velocidad de la cabeza dentro de ±10%. No describe el protocolo; la velocidad de la cabeza varió entre 2.4 y 6 veces la de las manos (resumen de búsqueda) — [US9050512](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9050512), [US9101812](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/9101812).
- Un cálculo en el foro de Kinovea:
  - la cabeza a 100 mph recorre unos 186 mm entre cuadros a 240 fps, y 30 fps no sirven para nada útil;
  - el borrón depende del obturador, y las cámaras con exposición automática tienen tiempos desconocidos (resumen de búsqueda) — [Kinovea forum](https://www.kinovea.org/en/forum/viewtopic.php?id=435).
- Un usuario de foro dice que con poca luz la cabeza se ve borrosa cerca del impacto a 240 fps — [TheSandTrap](https://thesandtrap.com/forums/topic/93677-high-speed-camera).
- **Rolling shutter:**
  - La marca de tiempo del cuadro es el inicio de la exposición de la primera fila, y la lectura es la diferencia entre la primera y la última; el API del teléfono suele exponer la marca de tiempo, el tiempo de lectura y la exposición (resumen de búsqueda; no se verificó si lo dice este artículo u otro de la misma búsqueda) — [arXiv 1805.08542](https://arxiv.org/pdf/1805.08542).
  - Un artículo de arXiv (2026) midió en un smartphone un desfase de **~6.58 µs por fila**, con dispersión menor a 10 µs — [arXiv 2605.29118](https://arxiv.org/pdf/2605.29118).
  - Un sensor apilado de Sony con DRAM (artículo de 2017, información antigua) bajaba la lectura a ~1/120 s y permitía 1,000 fps en 1080p — [CineD](https://www.cined.com/sony-develops-super-slow-motion-sensor-for-smartphones/).

### Inferencias
- **Geometría a 240 fps** (cálculo propio): el intervalo es de 4.17 ms y una bola a 70 m/s recorre 29 cm por cuadro.
  - Con un campo de ~1 m de ancho en 1080p (~1.9 px/mm), la bola mide ~80 px y aparece en solo 2 a 4 cuadros.
  - La velocidad con dos cuadros tiene una incertidumbre igual al error de posición dividido entre 29 cm: con ±5 mm de error por borrón, ~±2–3%, sin contar el rolling shutter.
  - A 480 fps la bola recorre 14.6 cm por cuadro, pero el teléfono suele bajar la resolución.
- **Borrón** (cálculo propio): con 1/240 s la bola deja una estela de 29 cm, con 1/2,000 s de 3.5 cm y con 1/10,000 s de 7 mm. Hace falta sol fuerte o mucha luz, y forzar la exposición corta con una app de exposición manual, si el teléfono lo permite.
- **Rolling shutter** (cálculo propio):
  - A 240 fps la lectura de 1,080 filas debe caber en el periodo de 4.17 ms, así que cada fila tarda menos de 3.86 µs.
  - Si la bola sube 15° y se eleva ~148 filas entre cuadros, el tiempo real entre sus dos posiciones difiere del nominal en hasta ~0.57 ms, un ~14%.
  - La velocidad o el ángulo pueden salir sesgados en esa proporción si no se corrige con el tiempo de cada fila (marca del cuadro más la fila por el tiempo de fila).
  - Además la bola sale inclinada o elíptica: con 80 filas de alto son ~0.3 ms de desfase entre su borde superior e inferior, unos 2 cm de corrimiento a 70 m/s.
  - Ayuda girar el teléfono para que la lectura vaya en el sentido que menos afecta, o calibrar el tiempo de fila con un LED parpadeante.
- **Tiempo de cuadro:** muchos teléfonos graban a una tasa variable o remuestrean. Conviene leer las marcas de tiempo del contenedor con ffprobe y no suponer el intervalo nominal.
- **Qué se puede medir con un teléfono, de mejor a peor:**
  1. ángulo de ataque y camino aproximados con la vista adecuada;
  2. velocidad del palo, con ±10% según la única fuente;
  3. ángulo vertical de salida, si se ven dos posiciones de la bola;
  4. velocidad de bola, gruesa;
  5. HLA, solo con una vista desde atrás o desde arriba.

  El spin no es viable con hoyuelos, y con una bola marcada de forma gruesa solo cerca del límite de aliasing.

### Gaps
- No se encontraron validaciones publicadas de golf con 240/480 fps de smartphone frente a TrackMan o GCQuad, ni mediciones de la fluctuación del tiempo de cuadro en cámara lenta.
- El dato de 6.58 µs por fila es de un teléfono y modo concretos, no de cámara lenta a 240 fps.
- No se pudo verificar qué teléfonos permiten fijar la exposición en cámara lenta.

## 7. Calibración y validación: comparar lado a lado con un monitor comercial en el campo de práctica, cronógrafo, pruebas de geometría conocida y bancos de spin

### Takeaway
El método más útil y documentado es comparar lado a lado con un TrackMan u otro monitor que exporte datos por tiro.
- **Emparejar:** por palo y orden cronológico, con tolerancia de velocidad de bola, como OpenFlight.
- **Reportar:** cobertura, MAE, percentiles (p50, p75, p90) y sesgo, separados por palo.
- **Geometría:** calibrar la cámara con ChArUco (40 o más imágenes) y medir la geometría del montaje (inclinación, alturas y distancias). Un error ahí da resultados plausibles pero falsos.

La referencia comercial también tiene incertidumbre, sobre todo en el spin, que es el dato menos confiable incluso entre TrackMan, Mevo+ y otros.

### Cited Findings
**Comparación lado a lado (OpenFlight)**
- El guion `compare_trackman.py` empareja tiros por palo y orden cronológico, con tolerancia de velocidad de bola, así que no hace falta el mismo número de tiros en ambos sistemas.
  - Acepta CSV hechos a mano de otros monitores con las columnas `shot_number_of`, `match_quality`, `spin_tm` y `ball_speed_tm`.
  - Solo puntúa los tiros con `match_quality == "good"`.
  - Recomienda validar en una sesión reservada, en otro día o montaje — [spin-replay.md](https://github.com/open-flight/openflight/blob/main/docs/development/spin-replay.md).
- Reporta la cobertura, el MAE, la mediana, p75, p90 y el sesgo, y separa driver, golpes malos y hierros para que el promedio no oculte los casos difíciles — [launch-angle.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/launch-angle.md).
- **Geometría:**
  - la inclinación del montaje, las distancias al tee y a la red y las alturas del radar y la bola se miden, no se estiman; un mal valor no da error, sino un ángulo plausible pero equivocado;
  - un inclinómetro LIS3DH corrige la inclinación sola;
  - su guion de calibración da una inclinación "candidata" que no sirve como referencia absoluta — [positioning.md](https://github.com/open-flight/openflight/blob/main/docs/how-it-works/positioning.md), [calibration.md](https://github.com/open-flight/openflight/blob/main/docs/iwr6843/calibration.md).
- La orientación horizontal se calibra con una "fase de referencia" de la línea de objetivo, propia de cada equipo, calculada en una sesión alineada con TrackMan — [club-path.md](https://github.com/open-flight/openflight/blob/main/docs/iwr6843/club-path.md).

**Calibración y pruebas (PiTrac)**
- Intrínsecos con ChArUco: 40 o más imágenes, cobertura de al menos el 80% y al menos un 40% inclinadas — [calibration_manager.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/calibration_manager.py).
- Plantillas de calibración con la bola en una posición conocida para cada cámara y tipo de caja. La focal se promedia en 6 fotos y se toleran hasta 4 fallas de detección — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json), [gs_calibration.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_calibration.cpp).
- Las pruebas automáticas de regresión tienen tolerancias de ±4 mph, ±2° VLA, ±3° HLA, ±250 rpm de backspin y ±300 rpm de sidespin — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).

**Estudios sobre la propia referencia**
- **Mevo+ contra TrackMan 4** (J Strength Cond Res, 2024; driver): el Mevo+ fue válido y confiable en velocidad de cabeza, velocidad de bola, carry y smash. La peor concordancia (Bland-Altman) fue en el spin; los autores piden cautela con el spin, el ángulo de salida, el ángulo de ataque y el eje de spin (resumen de búsqueda) — [AMiner](https://aminer.org/pub/65828b58939a5f40827d7e0f/validity-and-reliability-of-the-flightscope-mevo-launch-monitor-for-assessing-golf).
- **Confiabilidad del TrackMan 4** (Bishop et al., J Sports Sci 41(23):2138–2143; el volumen 41 es de 2023, aunque el resumen de búsqueda decía 2024): la velocidad de bola, la de cabeza y el carry fueron excelentes entre sesiones; el spin fue lo peor, con diferencias significativas entre sesiones (resumen de búsqueda) — [Bishop et al. PDF](https://repository.mdx.ac.uk/download/be181d52982e362d1ce01b36a328da43d62514bcb7bc3a394159898a997e7ee9/856196/Bishop_etal-Journal%20of%20Sports%20Sciences_41%2823%292138-2143_Trackman%204.pdf).
- Foresight afirma una menor dispersión de spin del GCQuad frente al TrackMan 4 (82 contra 175 rpm de desviación estándar); es una afirmación de parte — [Foresight blog](https://www.foresightsports.com/blogs/golf-tips/comparing-golf-launch-monitor-foresight-sports-gcquad-and-gc3-stand-above-the-rest).
- **Verificación visual del spin** (PiTrac, 2024): rotar la imagen 1 con el spin calculado y compararla con la imagen 2 (resumen de búsqueda) — [Hackaday PiTrac log](https://hackaday.io/project/195042/log/228522-spin-analysis-accuracy-verification).

### Inferencias
- **Protocolo sugerido en un campo de práctica de Bogotá o Medellín:** alquilar o pedir prestada una sesión con TrackMan, GCQuad o un Mevo+ y grabar 40–60 tiros por palo (wedge, 7, driver) con los dos sistemas a la vez.
  - Si los radares comparten banda, cuidar la interferencia: OpenFlight eligió 60 GHz para el ángulo en parte para no interferir con el OPS243 a 24 GHz.
  - Exportar el CSV, emparejar y reportar el MAE, p90, sesgo y cobertura por palo.
  - Repetir otro día, con la configuración congelada, para no ajustarse a una sola sesión.
- **Pruebas de geometría conocida, sin monitor comercial** (propuestas propias sin fuente):
  - **Tiempo:** un fotodiodo con osciloscopio, o la Pico registrando los pulsos del estroboscopio, confirma los intervalos reales.
  - **Escala y profundidad:** bolas en una plantilla a distancias medidas con cinta o láser; comparar la Z estimada por tamaño con la real en toda el área de trabajo.
  - **Velocidad sin referencia comercial:**
    - caída libre de la bola desde una altura conocida (v = √(2gh); desde 2 m da ≈6.3 m/s), para cámara y radar a baja velocidad;
    - un cronógrafo casero de dos haces IR a distancia conocida, para velocidades altas;
    - una bola atada a un brazo giratorio de radio conocido movido por un motor, con un tacómetro para la referencia.
  - **Spin:** una bola marcada montada en el eje de un taladro o motor brushless con tacómetro óptico (1,000–10,000 rpm), fotografiada con el mismo estroboscopio. Valida el algoritmo de rotación y el cálculo de rpm sin depender de un monitor comercial.
  - **Imágenes sintéticas:** renderizar bolas con hoyuelos rotadas una cantidad conocida, para probar el algoritmo de spin antes del hardware. Es la misma idea que la comprobación visual de PiTrac.
- **Qué se puede esperar del spin:** como la referencia comercial tiene una dispersión de spin del orden de 80–175 rpm en golpes centrados (cifras de Foresight) y es el dato menos confiable entre sistemas, un DIY no debería prometer más que eso. Las tolerancias de PiTrac (±250 rpm de backspin) son un objetivo razonable.

### Gaps
- No se encontraron fuentes sobre el uso de cronógrafos balísticos para pelotas de golf ni sobre bancos de spin comerciales o caseros con su precisión.
- Leach et al. (2017), que compara TrackMan Pro IIIe y GC2 HMT con una cámara de alta velocidad, apareció en los resultados pero sin una URL verificable propia: no se cita como fuente.
- Tampoco se citan un estudio con golfistas NCAA femeninas de varios dispositivos, por la misma razón, ni detalles de Bland-Altman con cifras (límites de concordancia en mph o rpm), que no se pudieron leer.
