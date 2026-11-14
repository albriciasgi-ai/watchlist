# Launch monitors comerciales (tecnología, parámetros, precisión, precios 2026) y software de simulador que acepta equipos de terceros o DIY

Notas de investigación. Fecha de corte: 2026-11-14. Los precios son en USD salvo que se diga otra cosa. Cada precio lleva su fecha cuando la fuente la da; si no, va "consultado 2026-11-14".

**Limitaciones del método, para el redactor:**
- **Hosts bloqueados:** WebFetch no pudo abrir `gsprogolf.com`, `support.trackmangolf.com`, `www-opengolfsim.pages.dev` ni `www.golfmonthly.com` (DNS bloqueado por la red de la sesión). El contenido de esas páginas se obtuvo por dos vías:
  - resúmenes del buscador, que citan la URL original;
  - copias en GitHub. La documentación de GSPro Open Connect v1 se leyó en una reproducción del repositorio `tnbozman/gspro-interface`.
- **Búsquedas agotadas:** al final se acabó el presupuesto de búsquedas web compartido. Quedaron sin verificar el precio de Awesome Golf y si existe una "v2" de Open Connect.
- **Calidad de las fuentes:** muchas son minoristas o sitios de afiliados. Se marcan los conflictos entre ellas y las afirmaciones que vienen del propio fabricante.

## 1. Cómo funciona cada tecnología y qué mide directamente frente a lo que calcula o estima

### Takeaway
- **Radar de una antena** (PRGR, Shot Scope LM1, tipo SC100): solo da velocidades (palo y bola); la distancia es un modelo.
- **Radar multirreceptor** (TrackMan, Mevo+/Mevo Gen2, Garmin R10): suma ángulos por diferencia de fase entre antenas y lee el spin en el vuelo. En interior, con poco vuelo, calcula o estima spin y eje, y para el spin necesita pegatinas metálicas o bolas RCT.
- **Cámaras** (GC3/GCQuad/GC2/Launch Pro, Garmin R50, Uneekor EYE MINI LITE, Square): miden la bola en los primeros centímetros (velocidad, VLA, HLA, spin total y eje) y calculan el vuelo.
- **Híbridos** (MLM2PRO, MLM2XPRO, SkyTrak+, Mevo Gen2): combinan radar y cámara.
- **Esteras IR** (OptiShot 2): solo ven el palo y estiman todo el vuelo.

### Cited Findings

**Principio físico del radar Doppler (patentes):**
- La velocidad de lanzamiento sale del corrimiento de frecuencia Doppler de la señal recibida — [US11844990B2](https://patents.google.com/patent/US11844990B2); [US 8257189](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8257189)
- Con dos antenas receptoras separadas, la diferencia de fase entre ellas se relaciona matemáticamente con el ángulo de elevación del lanzamiento. Un tercer par ortogonal da el azimut, y así se caracteriza la trayectoria inicial sin determinar la posición de la bola — [US11844990B2](https://patents.google.com/patent/US11844990B2); [US11311789](https://patentimages.storage.googleapis.com/c4/12/c0/b3f55a7f05d52b/US11311789.pdf)
- **Tipos de radar:**
  - los equipos convencionales usan onda continua (CW), de frecuencia casi constante;
  - algunos diseños nuevos suman FMCW (chirps de diente de sierra) para medir rango y carry directamente;
  - otros usan 4 receptores a la vez con *beamforming* digital, y estiman el spin y su eje en el dominio de la frecuencia.

  Fuentes: [US11311789](https://patentimages.storage.googleapis.com/c4/12/c0/b3f55a7f05d52b/US11311789.pdf); [US11844990B2](https://patents.google.com/patent/US11844990B2)

**Radar Doppler de una antena / "speed radar" (PRGR, tipo Swing Caddie SC100, Shot Scope LM1):**
- **PRGR (HS-130A / "Black Pocket"):**
  - es un radar Doppler "en la misma línea que TrackMan o FlightScope", no usa cámaras — [Golfalot](https://golfalot.com/equipment-review/prgr-portable-launch-monitor-review)
  - muestra velocidad de cabeza, velocidad de bola, smash factor y carry/total; no da spin ni ángulo de salida — [Golfalot](https://golfalot.com/equipment-review/prgr-portable-launch-monitor-review); [The Left Rough](https://theleftrough.com/prgr-launch-monitor-review/)
  - sirve en interior y también para practicar el swing sin bola — [SuperSpeed](https://superspeedgolf.com/collections/all-products/products/prgr-black-pocket-launch-monitor)
- **Shot Scope LM1** (a la venta desde marzo de 2026):
  - radar Doppler de 24 GHz (banda K);
  - cinco medidas: velocidad de bola, velocidad del palo, carry, total y smash factor;
  - trabaja a 1.5 m detrás de la bola y no tiene modo simulador.

  Fuentes: [Golfalot](https://golfalot.com/equipment-review/shot-scope-lm1-launch-monitor-review); [Stymie](https://stymie.golf/launch-monitors/shot-scope/lm1); [Golf Digest](https://www.golfdigest.com/story/shot-scope-lm1-launch-monitor-release); [SI](https://www.si.com/golf/gear/shot-scope-lm1-launch-monitor-packs-punch-shocking-price-point)
- **Swing Caddie SC100:** no encontré fuentes sobre su funcionamiento (ver Gaps).

**Radar Doppler multirreceptor:**
- **TrackMan:**
  - en modo exterior usa las primeras ~30 yardas de vuelo para determinar el spin axis;
  - en modo interior calcula el spin axis con las medidas del palo (spin loft y face to path).

  Fuente: [TrackMan blog – Spin Axis](https://www.trackman.com/blog/spin-axis)
- **Garmin Approach R10:**
  - **Qué mide y qué calcula:**
    - el radar mide la mayoría de valores; según una reseña, el spin, el ángulo de cara, la distancia y la desviación se calculan a partir de lo medido — [Golf Insider UK](https://golfinsideruk.com/garmin-approach-r10-review/)
    - el spin axis se calcula y no se mide; en interior, con vuelo corto, el spin se calcula con aprendizaje automático — [Golf Simulator Source](https://golfsimulatorsource.com/garmin-approach-r10/)
    - en un foro de Garmin: el side spin en interior se calcula con la dirección del path y de la bola, y no capta el *gear effect*. Un golpe de talón o de punta da un side spin muy equivocado — [Garmin Forums – Side spin](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/386004/side-spin)
    - en un foro: el spin medido solo vale con más de 20 m de vuelo y más de 90 mph de velocidad de bola; si no, es estimado. Es anecdótico — [Golf Simulator Forum](https://golfsimulatorforum.com/forum/golf-simulator-brands-and-types/garmin/354547-garmin-r10-getting-seriously-good)
  - **Lista de métricas** (ficha y tabla de Garmin): velocidades, ángulos de salida, spin rate y spin axis, apex, ángulo de ataque, club path, face angle, face to path, y desviación y distancia lateral de carry y total — [Garmin HK](https://www.garmin.com.hk/minisite/approach/approach-r10/); [Ficha R10 (GPS Central)](https://woo.gpscentral.ca/wp-content/uploads/Garmin_ApproachR10_Specifications.pdf)
  - **Bolas:** Garmin afirma que las Titleist Pro V1/Pro V1x RCT mejoran hasta 30 veces la precisión del spin y hasta 50% la del carry. Es una afirmación del fabricante — [Top Shelf Golf](https://topshelfgolf.com/products/garmin-approach-r10-launch-monitor-and-golf-simulator)
- **FlightScope Mevo+:**
  - "Fusion Tracking" (radar + cámara);
  - FlightScope recomienda 7–9 ft del sensor al tee y 13 ft de vuelo, y dice que se requieren puntos metálicos o bolas RCT para medir bien el spin — [FlightScope Mevo+](https://flightscope.com/products/mevo-plus/)
  - su manual exige 8 ft y pegatinas de aluminio en todo montaje de interior — [ManualsLib](https://www.manualslib.com/manual/2983441/Flightscope-MevoPlus.html)
  - **Medido o calculado, en disputa:**
    - en foros sostienen que, con puntos o RCT, mide spin y eje cuando los capta y que, si no, los calcula;
    - FlightScope dijo en un webinar que el eje se mide;
    - el spin loft se calcula.

    Fuente: [Golf Simulator Forum](https://golfsimulatorforum.com/forum/flightscope/360576-mevo-spin-measured-vs-calculated)
  - una guía de terceros lista el spin como medido — [GetRangeIQ](https://getrangeiq.com/devices/flightscope)
- **FlightScope Mevo Gen2:**
  - "Fusion Tracking": radar Doppler 3D más procesamiento de imagen sincronizado — [FlightScope blog (GolfBusters)](https://flightscope.com/blogs/news/golfbusters-reviews-the-flightscope-mevo-gen2-the-best-value-golf-simulator-experience)
  - desde noviembre de 2025 acepta los complementos Pro Package (club path, face to path, dynamic loft) y Face Impact Location (impacto lateral y vertical) — [SimBayFit](https://simbayfit.pages.dev/launch-monitors/flightscope-mevo-gen2/)

**Fotométricos (cámaras):**
- **Foresight GC3:**
  - tres cámaras con iluminación infrarroja integrada;
  - fotografía los primeros centímetros del vuelo y lee la rotación de los hoyuelos para el spin;
  - zona de golpe de 7" x 10";
  - mide velocidad de bola, ángulo de salida, ángulo lateral, spin total y spin axis; el carry es calculado;
  - los datos de palo se miden con un complemento.

  Fuentes: [Foresight GC3](https://www.foresightsports.com/gc3); [Golfbays GC3](https://golfbays.co.uk/products/gc3-launch-monitor)
- **GCQuad:**
  - cuatro cámaras con infrarrojo y zona de 18" x 14" — [Foresight EU GCQuad](https://foresightsports.eu/lp/gcquad)
  - las fuentes no coinciden en la velocidad de cuadro (6,000 o 10,000 fps) ni en si necesita pegatinas — [Golf.com](https://golf.com/?p=15438850); [Golfers Authority](https://golfersauthority.com/?p=155452)
- **Foresight, en general:** carry, altura máxima y total se calculan con un algoritmo a partir de los datos de salida medidos — [Foresight Help Center](https://help.foresightsports.com/hc/en-us/articles/47144162581523-Ball-Launch-Data-Measurements-Ball-Flight-Results); [Foresight – What we measure](https://foresightsports.com/what-we-measure)
- **Foresight GC2 (nuevo, 1/10/2026):**
  - dos cámaras de alta velocidad, solo datos de bola y sin opción de datos de palo;
  - pantalla de color de 2.8", batería y app Foresight+.

  Fuentes: [FirstCallGolf (comunicado)](https://www.firstcallgolf.com/industry-news/release/2026-10-01/foresight-sports-unveils-gc2-launch-monitor-incredible-accuracy-at-entry-level-price); [AmateurGolf](https://www.amateurgolf.com/golf-equipment-reviews/equipment-misc/foresight-gc2-launch-monitor-2026); [MyGolfSpy](https://mygolfspy.com/news-opinion/foresights-new-gc2-launch-monitor-has-me-totally-confused-and-excited/)
- **Bushnell Launch Pro:** el mismo hardware que el GC3; los datos de palo se abren con suscripción — [Breaking Eighty](https://breakingeighty.com/gc3-vs-launch-pro-vs-gcquad); [MyGolfSpy](https://mygolfspy.com/buyers-guides/golf-technology/foresight-gc3-vs-bushnell-launch-pro/)
- **Garmin Approach R50:**
  - tres cámaras de alta velocidad y más de 15 métricas, entre ellas spin rate y spin axis;
  - mide en el impacto, así que no necesita seguir el vuelo;
  - se ubica al lado de la bola y necesita menos espacio que el R10.

  Fuente: [Garmin blog – R50 vs R10](https://www.garmin.com/en-US/blog/outdoor/3-key-differences-between-garmin-approach-r50-and-r10/)
  - los datos de palo (velocidad, face angle, path, ángulo de ataque, smash) requieren una pegatina metálica en la cara; trae 250 — [Rain or Shine Golf](https://rainorshinegolf.com/products/garmin-r50-launch-monitor-and-golf-simulator); [Plugged In Golf](https://pluggedingolf.com/garmin-approach-r50-launch-monitor-review/)
  - otro minorista habla de "fusión de cámara y radar"; contradice la descripción de solo cámaras y parece poco fiable — [Rain or Shine (SimSquad)](https://simsquad.rainorshinegolf.com/products/garmin-r50-launch-monitor-and-golf-simulator)
- **Uneekor EYE MINI LITE:**
  - cámaras de alta velocidad y "Dimple Optix", que lee los hoyuelos de la bola;
  - no necesita bolas marcadas y las pegatinas de palo son opcionales.

  Fuente: [Uneekor EYE MINI LITE](https://uneekor.com/en-mn/products/eye-mini-lite-standalone)
  - necesita un PC — [Carl's Place](https://shop.carlofet.com/uneekor-eye-mini-lite)
  - unos minoristas dicen 19 datos y otros 10 — [PlayBetter](https://www.playbetter.com/products/uneekor-eye-mini-lite-golf-launch-monitor); [Carl's Place review](https://carlofet.com/blog/uneekor-eye-mini-accuracy-test)
- **Square Golf (original):**
  - "cámara de alta velocidad y visión artificial";
  - la versión original requería bolas marcadas especiales — [SimBayFit Square Golf](https://simbayfit.pages.dev/launch-monitors/square-golf/)
- **Square Golf Omni:**
  - cuatro cámaras, sirve en interior y exterior (también sobre grama);
  - usa pegatinas de palo, dos por palo.

  Fuentes: [PlayBetter Omni](https://www.playbetter.com/products/square-golf-omni-indoor-outdoor-launch-monitor?ghref=2301%3A1338702); [PlayBetter PGA Show 2026](https://www.playbetter.com/blogs/golf-tech-news/launch-monitors-and-simulators-2026-pga-show); [SimBayFit Square Golf](https://simbayfit.pages.dev/launch-monitors/square-golf/)

**Híbridos:**
- **Rapsodo MLM2PRO:**
  - radar Doppler más dos cámaras: "Shot Vision", gran angular para video, e "Impact Vision" a 240 fps para el impacto — [Ace Indoor Golf](https://aceindoorgolf.com/products/rapsodo-mlm2pro)
  - el radar se ocupa del vuelo y la distancia, y las cámaras del impacto y la ventana de salida — [Top Shelf Golf](https://topshelfgolf.com/products/rapsodo-mlm2pro-golf-launch-monitor)
  - **Spin:**
    - se mide ópticamente con el patrón impreso de las bolas RPT, no con un modelo de vuelo — [Elite Sim Golf](https://elitesimgolf.com/products/rapsodo-mlm2pro%E2%84%A2-portable-launch-monitor)
    - spin y eje requieren bolas RPT de Callaway o Titleist; las RCT no sirven — [GetRangeIQ Rapsodo](https://getrangeiq.com/devices/rapsodo)
- **Rapsodo MLM2XPRO (octubre de 2026):**
  - radar Doppler más dos cámaras de hasta 240 fps;
  - frente al MLM2PRO: procesa más rápido, lee putts y trae una app para PC.

  Fuentes: [PlayBetter MLM2XPRO](https://www.playbetter.com/blogs/golf-tech-news/rapsodo-mlm2xpro-everything-you-need-to-know); [MyGolfSpy MLM2X Pro](https://mygolfspy.com/news-opinion/the-new-rapsodo-mlm2x-pro-launch-monitor-isnt-perfect-but-at-899-it-doesnt-have-to-be/)
- **SkyTrak+ / ST+ / ST MAX:**
  - el radar Doppler dual mide los datos de palo: velocidad, smash factor, path y face angle;
  - la cámara fotométrica mide la bola: velocidad, ángulo de salida, spin y eje.

  Fuentes: [SkyTrak – What it measures](https://skytrakgolf.com/pages/what-does-the-skytrak-st-launch-monitor-measure); [Golfers Authority](https://golfersauthority.com/?p=132812)
  - el ST MAX se describe como radar Doppler dual más cámara fotométrica — [SimLab ST Max](https://simlab.golf/reviews/skytrak-st-max/); [Top Shelf Golf ST MAX](https://topshelfgolf.com/blogs/golf/skytrak-st-max-golf-simulator-complete-guide)

**Esteras de sensores infrarrojos (OptiShot 2):**
- los sensores IR del tapete siguen el palo antes, durante y después del impacto, y con eso estiman el vuelo — [Golfers Authority](https://golfersauthority.com/how-much-is-optishot-golf-simulator/)
- una reseña describe dos filas de sensores IR que disparan miles de pulsos por segundo — [Digital Trends](https://www.digitaltrends.com/game-reviews/optishot2-golf-simulator-review/)
- solo funciona en interior: el sol y otras fuentes IR interfieren — [Golfers Authority](https://golfersauthority.com/how-much-is-optishot-golf-simulator/)
- las fuentes no coinciden en el número de sensores: 16, 16 a 48 MHz, o 32 — [Smart Home Explorer](https://www.smarthomeexplorer.com/reviews/fitness/optishot-2-golf-in-a-box); [Top Shelf (reach.dog)](https://acceptance.reach.dog/shop/top-shelf-golf/products/optishot-2-launch-monitor-and-golf-simulator)
- el conector abierto **OptiSender** (Python, licencia MIT):
  - lee el OptiShot 2 por USB HID (VID 0x0547, PID 0x3294);
  - convierte los reportes de 60 bytes en velocidad de swing, face angle, path y contacto;
  - envía los tiros a Open Connect y a OpenGolfSim.

  Fuente: [GitHub dffeist/Optisender](https://github.com/dffeist/Optisender)

**Lanzamientos 2025–2026 relevantes:**
- **Rapsodo CLMPRO:** seis cámaras, se cuelga de techos de 9 ft — [TheGolfNewsNet Clubhouse (3/8/2026)](https://clubhouse.thegolfnewsnet.com/2026/08/03/the-most-interesting-launch-monitor-releases-so-far-in-2026/)
- **GOLFJOY Rigel 3 Pro:** tres cámaras, montaje cenital — [GOLFJOY](https://www.golfjoy.com/blogs/news/golfjoy-counts-down-to-pga-show-2026-ready-to-unveil-next-level-golf-tech)
- **Garmin Approach G82:** sobre todo un GPS de mano; el launch monitor es secundario — [SimLab G82](https://simlab.golf/reviews/garmin-g82/)
- **Blue Tees Rainmaker:** con pantalla propia — [Madknows](https://madknows.com/blue-tees-rainmaker-review/)
- **OpenLaunch Nova:**
  - "cámaras y radares en un formato compacto" — [Acconeer](https://acconeer.com/?p=15928)
  - OpenGolfSim describe su seguimiento de bola como Doppler y "de protocolo totalmente abierto" — [OpenGolfSim (12/2025)](https://www-opengolfsim.pages.dev/2025/12/08/openlaunch-nova-partnership.html)
  - su app de Windows lo conecta con GSPro y The Golf Club — [Microsoft Store NOVA](https://apps.microsoft.com/detail/9p01rhfl3jkl?hl=en-US)

### Inferences
- Un DIY de radar de una sola antena compite con el PRGR y el Shot Scope LM1. Esa clase solo entrega velocidades, y su carry tiene que salir de un modelo con ángulo y spin supuestos: ninguno de los dos reporta ángulo de salida.
- Para alimentar un simulador hace falta, además, el ángulo vertical y el horizontal. En radar eso pide al menos dos o tres receptores (fase); en cámara, estéreo o un modelo.
- **Spin en interior:** todos los equipos de radar baratos dependen de algo que les ayude a "ver" la rotación (puntos metálicos o RCT) o la estiman a partir de los datos del palo. Las cámaras la leen del patrón de la bola: logos, impresión RPT u hoyuelos.
  - Para un DIY de interior, eso sugiere que el spin por cámara (bola marcada) es la vía más directa.
  - Lo mismo sugiere el hecho de que TrackMan, en interior, calcula el eje desde el palo.
- **Medido y calculado:** carry, total, apex, ángulo de descenso y desviación son calculados en todas las tecnologías de impacto, incluso en Foresight. Solo los radares de alta gama los miden siguiendo el vuelo, y solo en exterior.

### Gaps
- No encontré la ficha técnica del Swing Caddie SC100 ni del Voice Caddie SC300i. No pude confirmar qué estiman, por ejemplo si el ángulo de salida del SC300i es medido.
- No se confirmó cuántas antenas tiene el Shot Scope LM1 ni el PRGR. Que sean "de una antena" es una inferencia por las métricas que dan.
- Tampoco hay confirmación oficial de FlightScope sobre qué es medido y qué calculado en interior en el Mevo+ y el Mevo Gen2: hay contradicción entre el webinar y los foros.
- No hay ficha técnica oficial del OpenLaunch Nova: sensores, métricas y precisión.
- Hay un estudio académico relevante sin leer: Loughborough, validez de radar frente a ópticos estereoscópicos — [PDF](https://repository.lboro.ac.uk/articles/How_valid_and_accurate_are_measurements_of_golf_impact_parameters_obtained_using_commercially_available_radar_and_stereoscopic_optical_launch_monitors_/9562799/files/17195102.pdf)

## 2. Definiciones (TrackMan / Foresight) de los parámetros de bola y palo, y cuáles necesita un simulador para volar la bola

### Takeaway
- Un simulador vuela la bola con cinco números de salida: velocidad de bola, VLA, HLA, spin total y spin axis.
  - GSPro marca como obligatorios Speed, SpinAxis, TotalSpin (o BackSpin + SideSpin), HLA y VLA.
  - OpenGolfSim pide ballSpeed, verticalLaunchAngle, horizontalLaunchAngle, spinSpeed y spinAxis.
- Los datos del palo son opcionales en ambos protocolos.
- Carry, apex, descenso, total y desviación son resultados del modelo de vuelo.

### Cited Findings

**Bola (definiciones de TrackMan, salvo que se indique):**
- **Ball speed:** velocidad del centro de gravedad de la bola inmediatamente después de separarse de la cara — [TrackMan Support – Parameter Definitions](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
- **Launch angle (VLA):** ángulo vertical de salida respecto al horizonte, medido justo después de la separación — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
- **Launch direction (HLA):** ángulo horizontal de salida respecto a la línea de objetivo, justo después de la separación — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
  - en GSPro, HLA negativo es a la izquierda y positivo a la derecha — [GSPro KB – Data Tiles](https://gspro.gitbook.io/gspro-knowledge-base/in-game-information/data-tiles)
  - Foresight lo llama "azimuth", también "side angle" o "deviation angle" — [Foresight 2021 PDF](https://golf.foresightsports.com/sites/default/files/downloads/2021/Understanding%20Ball%20Launch%20%20Club%20Data.pdf)
- **Spin rate (total spin):** velocidad de rotación de la bola alrededor de su eje de rotación resultante, justo después de separarse de la cara, en rpm — [TrackMan blog – Spin Rate](https://trackman.com/blog/golf/spin-rate)
  - Foresight: "el spin total alrededor del eje de inclinación del spin (*spin-tilt axis*), que crea curvatura y sustentación" — [Foresight Help Center](https://help.foresightsports.com/hc/en-us/articles/47144162581523-Ball-Launch-Data-Measurements-Ball-Flight-Results)
- **Spin axis:**
  - **TrackMan:** negativo, la bola curva a la izquierda; positivo, a la derecha; cero, sin curva. Para un diestro, un eje negativo pequeño es draw y uno grande es hook; los positivos son fade y slice.
  - **Ejemplo de TrackMan:** en un tiro de 150 yd, −10° dan unas 11 yd de curva y −2° unas 2.2 yd.

  Fuente: [TrackMan blog – Spin Axis](https://www.trackman.com/blog/spin-axis)
  - Full Swing usa la misma convención: positivo es fade en un diestro — [Full Swing blog](https://www.fullswinggolf.com/blog/shape-your-shots-like-a-pro-using-spin-axis-to-master-fades-and-draws-on-the-course/)
  - en Foresight, la curvatura queda definida por el spin total y la orientación del *spin-tilt axis* — [Foresight Help Center](https://help.foresightsports.com/hc/en-us/articles/47144162581523-Ball-Launch-Data-Measurements-Ball-Flight-Results)
  - **Error que hay que descartar:** un resumen de terceros decía que el eje positivo es draw. Contradice a TrackMan.
- **Backspin y sidespin:** son componentes del spin total. Backspin = Spin total × cos(eje) y Sidespin = Spin total × sin(eje), con el ángulo en radianes — [Mitchell Golf – Tilt Axis vs Sidespin](https://www.mitchellgolf.com/?p=272); [SkyTrak blog](https://www.skytrakgolf.com/blogs/articles/what-your-spin-numbers-are-actually-telling-you-and-what-they-re-not)
  - Foresight describe el backspin como un componente del spin total — [Foresight 2023 PDF](https://golf.foresightsports.com/sites/default/files/downloads/2023/2023%20Ball%20%26%20Club%20Data%20Doc.pdf)
  - el "sidespin" es en realidad la inclinación del eje, no un giro alrededor de un eje lateral — [Mitchell Golf](https://www.mitchellgolf.com/?p=272)
  - **Atribución dudosa:** el resumen del buscador atribuyó la fórmula a "una fuente" sin decir cuál; estas dos son las candidatas de la lista de resultados.
- **Carry:**
  - TrackMan mide el carry hasta el nivel del lanzamiento ("carry flat");
  - **Carry side:** posición lateral en ese punto respecto a la línea de objetivo;
  - **Curve:** desplazamiento lateral perpendicular entre la dirección de salida y el carry side.

  Fuente: [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
- **Total:** carry más el bote y el rodado esperados en un fairway estándar del PGA Tour al nivel del mar, según el spin, el ángulo y la velocidad de aterrizaje — [TrackMan – Ultimate Guide](https://www.trackman.com/blog/the-ultimate-guide-to-understanding-trackman)
- **Total side:** distancia perpendicular entre la línea de objetivo y la posición final calculada de la bola — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
- **Height / apex (altura máxima):** la altura máxima que alcanza la bola en su trayectoria — [TrackMan blog – 40 parameters](https://www.trackman.com/blog/golf/40-trackman-parameters)
  - el texto de la página de soporte aparece desordenado: atribuye a "Height" la definición de otra métrica. Hay que tomarlo con cautela — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
- **Landing angle (descent):** ángulo de llegada de la bola respecto al horizonte, en un punto con la misma elevación que el de salida — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
  - Foresight lo deriva con modelos físicos a partir de las condiciones de salida — [Foresight – What we measure](https://foresightsports.com/what-we-measure)
- **Hang time:** segundos hasta el carry flat — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)

**Palo (TrackMan):**
- **Club speed:** velocidad de la cabeza justo antes del impacto — [TrackMan – Ultimate Guide](https://www.trackman.com/blog/the-ultimate-guide-to-understanding-trackman)
- **Attack angle:** movimiento hacia arriba o abajo del centro geométrico de la cabeza en el momento de máxima compresión. Negativo es golpe descendente (hierros) y positivo, ascendente (driver) — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions); [TrackMan blog – 40 parameters](https://www.trackman.com/blog/golf/40-trackman-parameters)
- **Club path:** dirección dentro-fuera o fuera-dentro del centro geométrico de la cabeza respecto a la línea de objetivo, en el impacto — [TrackMan blog – 40 parameters](https://www.trackman.com/blog/golf/40-trackman-parameters)
- **Face angle:** hacia dónde apunta la cara en el punto central de contacto, en el impacto — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
  - TrackMan mide face angle y dynamic loft en el punto de impacto, no en el centro de la cara, porque es la orientación que influye en la bola. Ambos pueden variar 1–2° durante el impacto — [TrackMan – Club data definitions](https://www.trackman.com/blog/club-data-definitions)
- **Face to path:** diferencia entre el face angle reportado y el club path, es decir face angle − club path — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
  - según fuentes de terceros, negativo es cara cerrada respecto al path y positivo, abierta. Las convenciones varían entre equipos — [The Swing Lab](https://www.theswinglab.co.uk/you-can-see-the-data-but-what-does-it-mean); [My365Golf](https://my365golf.com/trackman-data-in-plain-english/)
- **Dynamic loft:** ángulo vertical de la cara en el punto de contacto, en el momento de máxima compresión — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
- **Spin loft:** ángulo entre la dirección de movimiento de la cabeza y la orientación de la cara, en el momento de máxima compresión. Es un ángulo 3D — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089892383515-TrackMan-Data-Parameter-Definitions)
  - la versión simplificada habitual es dynamic loft − attack angle — [GolfNewsNet](https://thegolfnewsnet.com/ryan_ballengee/2016/10/24/what-do-trackman-numbers-mean-interpret-results-launch-monitor-100881/)
- **Smash factor:** velocidad de bola dividida por velocidad del palo; en driver se busca cerca de 1.50 — [SGGT](https://www.sggt.co.uk/faqs/what-do-trackman-numbers-mean); [The Swing Lab](https://www.theswinglab.co.uk/you-can-see-the-data-but-what-does-it-mean)
- **Impact location:**
  - **Impact height:** posición vertical del impacto respecto al centro de la cara. Por encima del centro suele bajar el spin y por debajo, subirlo — [TrackMan – Impact Height](https://support.trackmangolf.com/hc/en-us/articles/39724519074843-Parameters-Impact-Height-Tee-to-Green)
  - **Impact offset:** posición hacia el talón o la punta — [TrackMan – Impact Offset](https://support.trackmangolf.com/hc/en-us/articles/39724554752155-Parameters-Impact-Offset-Tee-to-Green)

**Lo que exige cada simulador:**
- **GSPro Open Connect v1** (ver la pregunta 5):
  - en BallData son obligatorios Speed, SpinAxis, TotalSpin, HLA y VLA;
  - BackSpin y SideSpin solo si no se envía TotalSpin;
  - CarryDistance es opcional y ClubData no lleva marcas de obligatorio.

  Fuente: [Reproducción del doc oficial en GitHub (tnbozman)](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD); original en [gsprogolf.com/GSProConnectV1.html](https://gsprogolf.com/GSProConnectV1.html)
- **OpenGolfSim:** el objeto `shot` lleva `ballSpeed`, `verticalLaunchAngle`, `horizontalLaunchAngle`, `spinSpeed` y `spinAxis` — [OpenGolfSim Shot Data API](https://help.opengolfsim.com/desktop/apis/shot-data/); [OptiSender](https://github.com/dffeist/Optisender)
- **OpenShotGolf** (open source): spin, ángulo de salida y velocidad de bola se aplican en `hit_from_data`; el modelo aerodinámico usa densidad del aire, velocidad, diámetro, viscosidad y la relación de spin — [GitHub OpenShotGolf](https://github.com/jhauck2/OpenShotGolf)

### Inferences
- **Mínimo para un DIY:** ball speed (mph), VLA y HLA (°), spin total (rpm) y spin axis (°, positivo = curva a la derecha). Con eso juegan GSPro, OpenGolfSim y OpenShotGolf.
  - Sin spin y eje, el simulador no puede volar la bola de forma realista, porque esos datos son obligatorios en GSPro.
  - Un DIY que solo mida velocidades tendría que inventar valores por defecto (por ejemplo, un spin típico por palo), y la dispersión no se vería.
- **Datos de palo:** en ambos protocolos son opcionales y, por la documentación, parecen de visualización y análisis. No consta que GSPro los use para volar la bola: es una inferencia que no pude confirmar.
- **Convención de signos coherente para enviar** (TrackMan, GSPro KB, OptiSender):
  - HLA positivo = derecha;
  - spin axis positivo = curva a la derecha;
  - face y path positivos = a la derecha del objetivo;
  - en el marco del mundo, sin invertir para zurdos.

### Gaps
- La página oficial de TrackMan no se pudo abrir directamente (host bloqueado). Las definiciones se tomaron de resúmenes del buscador que la citan; la de "Height" tiene texto contradictorio.
- No encontré una página oficial de GSPro que confirme el signo del SpinAxis. Se infiere de TrackMan y de conectores como OptiSender.

## 3. Especificaciones de precisión publicadas, pruebas independientes contra TrackMan o GCQuad, y requisitos de interior

### Takeaway
- **Velocidad de bola:** es la métrica más estable incluso en equipos de ~$500.
- **Spin:** es la que más varía entre gamas.
- **Lo publicado por Garmin para el R10:**

  | Métrica | Tolerancia |
  |---|---|
  | Velocidad de bola | ±1 mph |
  | Velocidad de palo | ±3 mph |
  | Ángulos | ±1° |
  | Carry | ±5 yd |

  Pruebas independientes encuentran el spin del R10 hasta ~20% fuera de TrackMan.
- **En interior, frente a GCQuad** (MyGolfSpy), los mejores económicos (MLM2PRO, R50) quedan a menos de ~2.2% en carry y 1.5% en spin.
- **Requisitos de los radares:** 6–9 ft detrás de la bola y 8+ ft de vuelo hasta la red (unos 15–16 ft de largo), y para el spin, pegatinas metálicas o bolas RCT/RPT.
- **Las cámaras** van al lado de la bola.

### Cited Findings

**Garmin Approach R10:**
- **Precisión publicada por Garmin**, según Plugged In Golf comparada contra TrackMan:

  | Métrica | Tolerancia |
  |---|---|
  | Velocidad de palo | ±3 mph |
  | Velocidad de bola | ±1 mph |
  | Ángulo de salida y dirección | ±1° |
  | Carry | ±5 yd |

  Fuentes: [Plugged In Golf](https://pluggedingolf.com/garmin-approach-r10-launch-monitor-review/); [Golf Insider UK](https://golfinsideruk.com/garmin-approach-r10-review/)
- un representante de Garmin en el foro repite ±1° en salida y dirección, con el montaje recomendado — [Garmin manual / foros](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/274763/minimum-distance-to-net/1548612)
- **Pruebas independientes:**
  - una prueba frente a TrackMan halló de 1 a 4° de error en club path y face angle, y el R10 no mide el punto de impacto — [Golf Insider UK](https://golfinsideruk.com/garmin-approach-r10-review/)
  - **Atribución dudosa:** el resumen del buscador no asignó cada cifra a una URL concreta. Las candidatas son tres: [GolfMagic – R10 vs TrackMan indoor](https://www.golfmagic.com/equipment/golf-tech/garmin-approach-r10-vs-trackman-who-will-win-indoor-accuracy-test), [Golf Insider UK](https://golfinsideruk.com/garmin-approach-r10-review/) y [Cero Golf](https://www.cerogolf.com/post/how-accurate-is-the-garmin-r10-for-home-use). Las cifras son:
    - backspin unos 400 rpm por debajo de TrackMan en promedio;
    - en otra prueba, 19.7% de variación en spin con el carry a ~1%;
    - en exterior, de 1 a 3 mph y de 3 a 6 yd de TrackMan.
- **Montaje oficial** (manual de Garmin):
  - el tee a 8 ft (2.4 m) o más de la red;
  - el equipo en el suelo, de 6 a 8 ft (1.8–2.4 m) detrás del tee;
  - los ángulos se miden paralelos a la línea de objetivo;
  - en modo simulador hay que ingresar la distancia exacta del equipo al tee.

  Fuentes: [Manual R10 (PDF)](https://www8.garmin.com/manuals/webhelp/GUID-E2BBF6BE-4276-436F-B697-59ABEFD61933/EN-US/Approach_R10_OM_EN-US.pdf); [Manual R10 – Preparing for a Shot](https://www8.garmin.com/manuals/webhelp/GUID-E2BBF6BE-4276-436F-B697-59ABEFD61933/EN-US/GUID-88F65277-47D4-403D-8F79-719CAA256D6B.html)

**Rapsodo MLM2PRO:**
- **MyGolfSpy, febrero de 2026**, en interior y en promedio frente a GCQuad:

  | Métrica | Diferencia |
  |---|---|
  | Carry | 1.4% |
  | Spin | 1.5% |
  | Velocidad de bola | 0.3% |

  Fuentes: [Smash Factor Lab (agregador que cita a MyGolfSpy)](https://smashfactorlab.com/most-accurate-launch-monitor/); [MyGolfSpy – Three most accurate indoor](https://mygolfspy.com/news-opinion/three-of-the-most-accurate-indoor-launch-monitors-and-one-to-avoid/)
- MyGolfSpy lo puso entre los tres más precisos en interior, junto al GC3 y al Garmin R50. El que recomienda evitar es el Swami Launch Master Pro — [MyGolfSpy](https://mygolfspy.com/news-opinion/three-of-the-most-accurate-indoor-launch-monitors-and-one-to-avoid/)
- en la prueba 2025 de MyGolfSpy quedó primero en la general — [MyGolfSpy 2026 guide](https://mygolfspy.com/buyers-guides/golf-simulators/best-golf-personal-launch-monitors-of-2026/)
- **Espacio:**
  - Rapsodo, citado por un minorista: un poco más de 14 ft, unos 8 ft de la bola a la red más 6.5 a 8.5 ft detrás de la bola — [Elite Sim Golf](https://elitesimgolf.com/products/rapsodo-mlm2pro%E2%84%A2-portable-launch-monitor)
  - otro minorista dice de 14.5 a 16.5 ft — [Ace Indoor Golf](https://aceindoorgolf.com/products/rapsodo-mlm2pro)

**Garmin R50:**
- MyGolfSpy, febrero de 2026, en interior frente a GCQuad: spin 1.5% y carry 2.2% — [Smash Factor Lab](https://smashfactorlab.com/most-accurate-launch-monitor/)
- Plugged In Golf lo comparó contra su GCQuad y lo encontró "casi perfectamente en línea" — [Plugged In Golf R50](https://pluggedingolf.com/garmin-approach-r50-launch-monitor-review/)
- los datos de palo pueden ser inconsistentes, sobre todo el ángulo de ataque — [Golf Monthly R50 vs KIT](https://www.golfmonthly.com/buying-advice/garmin-approach-r50-vs-full-swing-kit-launch-monitor-read-our-head-to-head-verdict)
- **Espacio**, cifras de minoristas y no oficiales: el equipo ocupa unos 2 x 2 ft, la sala ~12 ft de fondo y 9–10 ft de techo, o bien una huella de 9'W x 12'D x 8'H — [PlayBetter R50 space](https://www.playbetter.com/blogs/golf-simulator-space/garmin-approach-r50-space-requirements)

**FlightScope Mevo, Mevo+ y Mevo Gen2:**
- **MyGolfSpy 2024**, con TrackMan y Foresight como referencia:
  - el Mevo original tuvo 40% de diferencia frente a TrackMan;
  - el Mevo+ tuvo 11% de diferencia en carry;
  - los equipos variaron desde menos de una yarda hasta casi 20 yd.

  Fuente: [MyGolfSpy – Launch Monitor Myths Debunked](https://mygolfspy.com/news-opinion/launch-monitor-myths-debunked/)
- **Mevo Gen2:**
  - GolfBusters, en interior frente a un Foresight de $15,000, dio 98–99% en carry y más de 99.5% en datos de palo. Lo publica FlightScope, así que es fuente sesgada — [FlightScope blog](https://flightscope.com/blogs/news/golfbusters-reviews-the-flightscope-mevo-gen2-the-best-value-golf-simulator-experience)
  - frente a un GC3, el carry de un hierro 8 quedó a 1–3 yd — [Golficity](https://golficity.com/?p=156050)
  - **Espacio:**
    - mínimo 16 ft: 8 ft de vuelo y 8 ft detrás — [PlayBetter Mevo Gen2 space](https://www.playbetter.com/blogs/golf-simulator-space/flightscope-mevo-gen2-space-requirements)
    - FlightScope recomienda 12 ft de ancho, 9 de alto y 15 de largo — [FlightScope Mevo Gen2 Simulator Bundle](https://flightscope.com/products/mevo-gen2-simulator-bundle)
  - no está publicada una guía específica del Gen2 sobre puntos metálicos en interior — [SimBayFit Gen2](https://simbayfit.pages.dev/launch-monitors/flightscope-mevo-gen2/)
- **Mevo+:**
  - 7–9 ft del sensor al tee y 13 ft de vuelo, con puntos metálicos o RCT — [FlightScope Mevo+](https://flightscope.com/products/mevo-plus/)
  - en interior, con pegatinas, rinde bien, pero por debajo del exterior sobre todo en spin — [Golf Simulator Nerd](https://www.golfsimulatornerd.com/blog/flightscope-mevo-plus-review-2026)

**MyGolfSpy, 12 equipos de $500 a $5,000:**
- la velocidad de bola fue la métrica más estable;
- el spin, la que más varió;
- la diferencia de precio está en cuánto se puede confiar en el dato, no en la distancia.

Fuente: [MyGolfSpy](https://mygolfspy.com/buyers-guide/we-tested-12-launch-monitors-ranging-from-500-to-5000-whats-the-real-difference/)

**Bushnell Launch Pro:** a unos 1.2 yd de TrackMan en carry, en una prueba independiente — [Cubical Golfer](https://www.cubicalgolfer.com/golf-launch-monitor-accuracy-test/)

**Swing Caddie SC4 / SC4 Pro:**
- el SC4 lleva un radar Doppler de 24 GHz (banda K) — [PlayBetter SC4](https://playbetter.com/products/swing-caddie-sc4-portable-golf-launch-monitor)
- **SC4 Pro frente a GCQuad:**
  - Plugged In Golf: "en línea en prácticamente cada tiro" — [Plugged In Golf SC4 Pro](https://pluggedingolf.com/swing-caddie-sc4-pro-launch-monitor-review/)
  - PlayBetter: "algo inestable con los palos largos" — [PlayBetter MLM2PRO vs SC4](https://www.playbetter.com/blogs/golf-simulator-comparisons/rapsodo-mlm2pro-vs-swing-caddie-sc4-comparison)
- según el fabricante, mide carry y total, velocidad de swing y de bola, smash factor, apex, ángulo y dirección de salida, y spin rate. Spin axis, side spin, back spin y dispersión son nuevos en el Pro — [Voice Caddie SC4 Pro](https://voicecaddie.com/products/sc4-pro)
- un reseñista dice que su algoritmo nuevo reduce en 600–700 rpm la brecha de spin en interior frente al SC4. Es la afirmación de una sola reseña — [PlayBetter SC4 Pro review](https://www.playbetter.com/blogs/golf-simulator-reviews/swing-caddie-sc4-pro-review)
- una guía de compras dice que en interior pierde mucha precisión sin 15+ ft de vuelo — [Cubical Golfer – best budget](https://www.cubicalgolfer.com/best-budget-launch-monitor/). **Atribución dudosa:** la fuente exacta de esa frase no quedó atribuida.

**SkyTrak:**
- dice estar a menos de 1.5° en datos de palo y 2 yd en bola frente a TrackMan;
- la fuente es un blog, no SkyTrak, y no hay prueba independiente.

Fuente: [Golfers Authority](https://golfersauthority.com/?p=132812)

**PRGR:**
- "exacto a ±1 mph" en velocidades, según un vendedor — [Golfers Authority PRGR](https://shop.golfersauthority.com/blogs/golf/prgr-launch-monitor-review)
- un usuario reportó solo 1 fallo en más de 100 bolas. Es anecdótico — [The Left Rough](https://theleftrough.com/prgr-launch-monitor-review/)

**Shot Scope LM1:**
- hay reseñas contra GCQuad y GC3, y una halla más variación en interior — [Golf Insider UK LM1](https://golfinsideruk.com/shot-scope-lm1-review/); [Golf Monthly LM1](https://www.golfmonthly.com/reviews/golf-tech-and-training-aids/shot-scope-lm1-launch-monitor-review)
- trabaja a 1.5 m detrás de la bola — [Stymie LM1](https://stymie.golf/launch-monitors/shot-scope/lm1)

**Uneekor EYE MINI LITE:**
- un minorista recomienda unos 10 ft de la bola a la pantalla;
- solo interior; zona de golpe de 12" x 8";
- se conecta por Ethernet.

Fuentes: [PlayBetter EYE MINI LITE](https://www.playbetter.com/products/uneekor-eye-mini-lite-golf-launch-monitor); [Golf Monthly review](https://golfmonthly.com/reviews/golf-tech-and-training-aids/uneekor-eye-mini-lite-launch-monitor-review)

**Square Golf Omni:** se anuncia para sol directo y grama natural — [PlayBetter Omni](https://www.playbetter.com/products/square-golf-omni-indoor-outdoor-launch-monitor?ghref=2301%3A1338702)

### Inferences
- **El objetivo realista** para un DIY que quiera "competir" con lo barato es el R10: ±1 mph en velocidad de bola, ±1° en ángulos y ±5 yd de carry. El spin en interior es justamente su debilidad (hasta ~20% de error).
- **Ser mejor que el R10 en interior** pasa por medir el spin con cámara y bola marcada, como Rapsodo con sus RPT.
- **Espacio de los radares:** un DIY por radar detrás de la bola heredaría las mismas exigencias, unos 15–16 ft de largo. Un DIY por cámara al lado de la bola, como el R50 o el GC3, cabe en salas más cortas.

### Gaps
- No obtuve cifras independientes de precisión, contra TrackMan o GCQuad, para varios equipos:
  - Square Golf (original y Omni);
  - SkyTrak+ y ST MAX;
  - Uneekor EYE MINI LITE;
  - Garmin G82, Blue Tees Rainmaker, Foresight GC2 y MLM2XPRO.

  Un sitio dio para la Omni 2.3% en velocidad de bola y 2.1% en carry frente a TrackMan, pero en la misma página le ponía un precio de $249, que contradice a todos los demás. Lo descarté.
- No obtuve las tablas individuales de MyGolfSpy 2025–2026 con el puntaje de cada equipo: solo extractos.
- No encontré las especificaciones oficiales de precisión de Rapsodo, FlightScope (Mevo+/Gen2), Square, SkyTrak ni Swing Caddie.

## 4. Precios actuales (2026, USD) con suscripciones obligatorias, y precios y disponibilidad en Colombia

### Takeaway
- **Lo más barato:**
  - $185–230 por un medidor de velocidades (PRGR);
  - $199.99 por el Shot Scope LM1 (marzo de 2026, sin suscripción).
- **El simulador completo más barato:**
  - Garmin R10, $399–599 en EE. UU.; COP 2,899,900 en la tienda oficial de Garmin Colombia;
  - Rapsodo MLM2PRO, $599–699.99 más ~$199.99/año para la mitad de sus funciones.
- **Cámaras sin suscripción:** Square Golf ($699) y Square Omni ($1,599).
- **Novedades de octubre de 2026:** Foresight GC2 ($1,699) y Rapsodo MLM2XPRO ($899.99).
- **Simulador para el PC:** GSPro cuesta ~$250/año aparte.

### Cited Findings

**Radares de velocidad (una métrica de "speed"):**
- **PRGR (HS-130A / Black Pocket):**
  - SuperSpeed: $184.00 con 20% de descuento sobre $229.99 — [SuperSpeed](https://superspeedgolf.com/collections/all-products/products/prgr-black-pocket-launch-monitor)
  - Rock Bottom Golf: $225 sobre $299.99 — [Rock Bottom (CBS shop)](https://shop.cbssports.com/hq-golf/products/24643)
  - Stymie: precio de calle $199.99 — [Stymie](https://stymie.golf/launch-monitors/prgr/hs-130a)
- **Shot Scope LM1:** $199.99 (£199), sin suscripción — [PlayBetter LM1](https://www.playbetter.com/products/shot-scope-lm1-golf-launch-monitor?utm_id=22952811972); [MyGolfSpy LM1](https://mygolfspy.com/news-opinion/the-new-shot-scope-lm1-launch-monitor-is-finally-out-heres-what-you-need-to-know/)

**Radares multirreceptor y equipos con "radar + algo":**
- **Garmin Approach R10:**
  - MSRP $599.99 — [Miyar Adventures](https://store.miyaradventures.com/products/garmin-approach-r10); [T5 Golf](https://t5golf.com/garmin-approach-r10-review/)
  - de oferta en $489.99 (Miyar), $399.99 (Fairway Jockey) o $399.99 nuevo (eBay). La fecha de estas páginas no está clara; consultado 2026-11-14 — [Miyar](https://store.miyaradventures.com/products/garmin-approach-r10); [Fairway Jockey](https://fairwayjockey.com/products/approach-r10); [eBay](https://www.ebay.com/itm/388932007265)
  - **Suscripción:** los campos del simulador requieren la suscripción de Garmin Golf ("más de 42,000 campos") — [MercadoLibre CO (ficha)](https://www.mercadolibre.com.co/garmin-approach-r10-monitor-portatil-de-lanzamiento-de-golf-lleva-tu-juego-a-casa-en-interiores-o-al-rango-de-conduccion-hasta-10-horas-de-duracion-de-la-bateria-con-paquete-de-alimentacion/p/MCO34341729)
  - **Precio de la suscripción:** según una fuente, $9.99/mes o $99/año, aunque no queda claro si se refiere al R10 — [PlayBetter <$1000](https://www.playbetter.com/blogs/golf-simulator-comparisons/what-is-the-best-golf-launch-monitor-under-1000)
- **Garmin Approach R50:** $4,999.99 — [Indoor Golf Outlet](https://indoorgolfoutlet.com/blogs/main/garmin-r50-vs-gcquad)
  - suscripción de $99.99 al año — [MyGolfSpy – Subscriptions Explained](https://mygolfspy.com/news-opinion/launch-monitor-subscriptions-explained-what-you-pay-after-you-buy/)
- **FlightScope Mevo Gen2:**
  - salió en agosto de 2025 a $1,199;
  - en flightscope.com costaba $1,299 en julio de 2026.

  Fuentes: [Front Desk Review (act. agosto 2026)](https://frontdeskreview.com/product/golf-simulators/flightscope-mevo-gen2/); [FlightScope (lanzamiento "under $1,200")](https://flightscope.com/blogs/news/flightscope-releases-mevo-gen2-the-most-complete-launch-monitor-and-simulator-on-the-market-and-its-under-1-200)
  - el kit con Pro Package y Face Impact cuesta $2,798 de lista, en oferta $2,274 — [FlightScope bundle](https://flightscope.com/products/mevo-gen2-with-pro-package-and-face-impact)
  - sus paquetes de app van de $4.99/mes a $600/año — [MyGolfSpy](https://mygolfspy.com/news-opinion/launch-monitor-subscriptions-explained-what-you-pay-after-you-buy/)
  - incluye para siempre 8 campos de E6 Connect — [MyGolfSpy](https://mygolfspy.com/news-opinion/launch-monitor-subscriptions-explained-what-you-pay-after-you-buy/)
- **FlightScope Mevo+:**
  - descontinuado y reemplazado por el Gen2;
  - precio de calle $1,099 (junio-agosto de 2026) contra un MSRP de $2,299.

  Fuentes: [SimBayFit Mevo+](https://simbayfit.pages.dev/launch-monitors/flightscope-mevo-plus/); [Front Desk Review Mevo+](https://frontdeskreview.com/product/golf-simulators/flightscope-mevo-plus/)
- **Swing Caddie SC4 Pro:**
  - MSRP $599–600, precio de calle ~$499–500 (junio de 2026) — [SimBayFit](https://simbayfit.pages.dev/launch-monitors/voice-caddie-sc4-pro/); [Plugged In Golf](https://pluggedingolf.com/swing-caddie-sc4-pro-launch-monitor-review/)
  - Golfers Authority: $499.99 — [Golfers Authority](https://golfersauthority.com/best-swing-caddie-launch-monitors/)

**Híbridos de Rapsodo:**
- **Rapsodo MLM2PRO:**
  - lista $699.99, en oferta $599.99 (junio de 2026) — [SimBayFit MLM2PRO](https://simbayfit.pages.dev/launch-monitors/rapsodo-mlm2pro/)
  - otros minoristas dicen $549.99 o $599.99 — [PlayBetter <$1000](https://www.playbetter.com/blogs/golf-simulator-comparisons/what-is-the-best-golf-launch-monitor-under-1000)
  - **Membresía Premium:**
    - $199.99 al año, tras una prueba de 45 días;
    - $329.99 por dos años;
    - de por vida, $499 a $599.99, según la fuente;
    - no es obligatoria, pero cambia mucho la experiencia.

    Fuentes: [Rapsodo blog](https://rapsodo.com/blogs/golf/what-is-a-rapsodo-premium-membership); [PlayBetter MLM2PRO](https://www.playbetter.com/products/rapsodo-mlm2pro); [App Pricing Lab](https://apppricinglab.com/app/apple/1659665092); [BriefGlance (feb. 2026)](https://briefglance.com/articles/rapsodo-brings-team-golf-indoors-with-major-mlm2pro-update)
  - **Dato que choca:** MyGolfSpy lista para el MLM2PRO $119.99 al año, que contradice los $199.99 de las otras fuentes — [MyGolfSpy](https://mygolfspy.com/news-opinion/launch-monitor-subscriptions-explained-what-you-pay-after-you-buy/)
- **Rapsodo MLM2XPRO:**
  - $899.99, a la venta desde mediados de octubre de 2026;
  - incluye 12 bolas RPT y 21 días de membresía Core;
  - la Core cuesta $199 al año o $499 de por vida, y "la mitad de las funciones" está detrás de ese pago.

  Fuentes: [PlayBetter MLM2XPRO](https://www.playbetter.com/products/rapsodo-mlm2xpro-golf-launch-monitor-simulator); [MyGolfSpy](https://mygolfspy.com/news-opinion/the-new-rapsodo-mlm2x-pro-launch-monitor-isnt-perfect-but-at-899-it-doesnt-have-to-be/); [Breaking Eighty](https://breakingeighty.com/rapsodo-mlm2xpro-review)
  - con la Core, en cinco años son unos $2,100 — [MyGolfSpy](https://mygolfspy.com/news-opinion/launch-monitor-subscriptions-explained-what-you-pay-after-you-buy/)

**Cámaras (fotométricos):**
- **Square Golf (original):** $699–699.99 (junio de 2026), sin suscripción para simulador; incluye 1,000 tokens de la app — [SimBayFit Square](https://simbayfit.pages.dev/launch-monitors/square-golf/)
  - en Reino Unido, £685 — [The Golf Shop Online](https://www.thegolfshoponline.co.uk/square-golf-indoor-launch-monitor/)
- **Square Golf Omni:** $1,599 (£1,600), sin suscripción para software de terceros — [PlayBetter Omni](https://www.playbetter.com/products/square-golf-omni-indoor-outdoor-launch-monitor?ghref=2301%3A1338702); [NCG](https://www.nationalclubgolfer.com/gb/reviews/launch-monitors/square-golf-omni-launch-monitor-review/); [Stymie Omni](https://stymie.golf/launch-monitors/square-golf/omni-edition)
  - un minorista avisó de poco inventario, con más previsto para julio de 2026 — [PlayBetter Omni](https://www.playbetter.com/products/square-golf-omni-indoor-outdoor-launch-monitor?ghref=2301%3A1338702)
- **Foresight GC2:**
  - $1,699 de lista (finales de octubre de 2026), con 30 días gratis de Foresight+;
  - los equipos Foresight y Bushnell comprados desde el 18/9/2026 funcionan con Foresight+, una membresía anual.

  Fuentes: [AmateurGolf – Foresight buying guide](https://amateurgolf.com/golf-tournament-news/foresight-launch-monitor-buying-guide-gc2-gc3-gcquad-quadmax); [GolfMagic GC2](https://www.golfmagic.com/equipment/news/foresight-sports-launches-gc2-launch-monitor-1699)
- **Bushnell Launch Pro (Circle B Edition):**
  - $2,999.99 de MSRP (agosto de 2026) — [Front Desk Review](https://frontdeskreview.com/product/golf-simulators/bushnell-launch-pro/)
  - otras fuentes dicen $2,499 — [PlayBetter](https://www.playbetter.com/blogs/golf-simulator-comparisons/bushnell-circle-b-edition-vs-launch-pro)
  - **Suscripciones:**
    - Silver, $199 al año — [Foresight Help Center](https://help.foresightsports.com/hc/en-us/articles/44753196328723-GC3s-Launch-Pro-and-Launch-Pro-Indoor-Subscriptions-Updated-Subscription-Options)
    - Gold, $499 o $599 al año según la fuente; es la que habilita GSPro — [Golfers Authority](https://golfersauthority.com/?p=224004); [PlayBetter Foresight subscriptions 2026](https://www.playbetter.com/blogs/golf-simulator-software/foresight-sports-subscriptions-guide-2026)
- **Foresight GC3:** el mismo hardware sin suscripción, $6,999–7,499 — [Breaking Eighty](https://breakingeighty.com/gc3-vs-launch-pro-vs-gcquad); [MyGolfSpy](https://mygolfspy.com/buyers-guides/golf-technology/foresight-gc3-vs-bushnell-launch-pro/)
- **Uneekor EYE MINI LITE:**
  - **Precio:** MSRP $1,999 según Stymie, $2,499 en SimSquad (antes $2,749), $2,750 como precio original en PlayBetter — [Stymie](https://stymie.golf/launch-monitors/vs/foresight-sports/falcon/uneekor/eye-mini-lite); [SimSquad](https://simsquad.rainorshinegolf.com/products/uneekor-eye-mini-lite); [PlayBetter](https://www.playbetter.com/products/uneekor-eye-mini-lite-golf-launch-monitor)
  - **Suscripción, en conflicto:**
    - Best Buy dice que se requiere la suscripción Gold, $499 al año;
    - PlayBetter dice que la plataforma Uneekor Player es gratis;
    - Indoor Golf Outlet dice que es compra única.

    Fuentes: [Best Buy](https://www.bestbuy.com/product/uneekor-eye-mini-lite-black/J3R84F35JG); [PlayBetter](https://www.playbetter.com/products/uneekor-eye-mini-lite-golf-launch-monitor); [Indoor Golf Outlet](https://indoorgolfoutlet.com/blogs/main/uneekor-eye-mini-lite-vs-mevo-gen2)

**SkyTrak:**
- **SkyTrak+:** descontinuado a inicios de 2026; el inventario restante se vende a ~$1,995–2,495 — [Breaking Eighty](https://breakingeighty.com/skytrak-plus-vs-skytrak-st-max); [Golf Simulator Nerd](https://www.golfsimulatornerd.com/blog/skytrak-plus-vs-st-max-comparison-2026)
- **ST MAX:** "desde $2,995", aunque otras páginas dicen $1,995, $2,195 o $3,495 — [Top Shelf Golf](https://topshelfgolf.com/blogs/golf/skytrak-st-max-golf-simulator-complete-guide); [SimLab](https://simlab.golf/reviews/skytrak-st-max/)
- **Membresías:** hay un nivel gratis con rango de práctica y datos de bola y palo; los pagos van de $99.99 a $599.99 al año según el nivel y la fuente — [Golf Simulator Videos](https://golfsimulatorvideos.com/skytrak-membership-plans/); [NorthCourse](https://northcourse.golf/articles/skytrak-core-cost)

**Estera IR:**
- **OptiShot 2:**
  - de $299 a $499 según la tienda; MSRP $499;
  - una tienda lo vende a $749.99;
  - el paquete "Golf in a Box" cuesta $1,499.99.

  Fuentes: [Golfers Authority](https://golfersauthority.com/how-much-is-optishot-golf-simulator/); [Digital Trends](https://www.digitaltrends.com/game-reviews/optishot2-golf-simulator-review/); [Smart Home Explorer](https://www.smarthomeexplorer.com/reviews/fitness/optishot-2-golf-in-a-box)

**Otros lanzamientos 2026:**
- **Garmin Approach G82:** $599.99 — [SimLab G82](https://simlab.golf/reviews/garmin-g82/)
- **Blue Tees Rainmaker:** $599.99, con membresía de app de $79.99 al año desde el segundo año — [Madknows](https://madknows.com/blue-tees-rainmaker-review/)
- **Rapsodo CLMPRO:** sin precio anunciado — [PlayBetter PGA Show 2026](https://www.playbetter.com/blogs/golf-tech-news/launch-monitors-and-simulators-2026-pga-show)
- **OpenLaunch Nova:** alrededor de $1,500–1,600 según un foro, previo al lanzamiento y sin confirmar — [Golf Simulator Forum](https://golfsimulatorforum.com/forum/golf-simulator-brands-and-types/general-and-unlisted/408145-nova-by-open-launch)

**Software de simulador:**
- **GSPro:**
  - ~$250 al año más impuestos; el complemento de por vida se descontinuó;
  - **requisitos:** Windows 10/11. Mínimo a 1080p: una "GTX 3060" (así figura), 16 GB de RAM y 10 GB de disco. Recomendado: RTX 3070 o 3060 Ti. Para 4K: RTX 3080 o superior con 32 GB.

  Fuentes: [GSPro (sitio oficial, vía buscador)](https://gsprogolf.com/); [GSPro KB – What specs can run GSPro](https://gspro.gitbook.io/gspro-knowledge-base/pc-requirements/what-specs-can-run-gspro); [Indoor Golf Shop partner listing ($250)](https://partners.shopindoorgolf.com/products/gspro-software.oembed)
- **E6 Connect:**
  - Basic ~$299–300 al año y Expanded ~$600 al año — [Golfers Authority – E6 cost](https://golfersauthority.com/e6-connect-cost/); [PGA Tour Superstore](https://www.pgatoursuperstore.com/kit-launch-monitor/1146281.html)
  - **E6 APEX:** Play $300 al año, Improve $150 al año (requiere Basic), Enjoy $450 al año (requiere Expanded) — [TruGolf E6 APEX](https://trugolf.com/pages/e6-apex)

**Referencia de gama alta (una línea cada uno):**
- **TrackMan iO:** desde $13,995, hasta $22,495 con datos de palo completos — [Indoor Golf Outlet](https://indoorgolfoutlet.com/blogs/main/trackman-io-vs-uneekor-eye-xo2)
- **TrackMan 4:** unos $21,495–27,585 en distribuidores — [All Seasons (dealer)](https://all-seasons-design-build.pages.dev/products/launch-monitors/trackman); [Carl's Place](https://shop.carlofet.com/launch-monitors)
- **Foresight GCQuad:** $14,500 — [Indoor Golf Outlet](https://indoorgolfoutlet.com/blogs/main/garmin-r50-vs-gcquad)
- **Foresight QuadMAX:** ~$20,000 — [PlayBetter](https://www.playbetter.com/blogs/golf-simulator-comparisons/garmin-approach-r50-vs-foresight-quadmax-and-gcquad-and-falcon)
- **Uneekor EYE XO2:** ~$11,000 de MSRP — [Indoor Golf Outlet](https://indoorgolfoutlet.com/blogs/main/trackman-io-vs-uneekor-eye-xo2)

**Colombia:**
- **Garmin Colombia (tienda oficial):** el Approach R10 figura a COP 2.899.900 (sin fecha en la página; consultado 2026-11-14) — [garmin.com.co – Approach R10](https://www.garmin.com.co/approach-r10/p)
  - el mismo catálogo lista el Approach Z30 a COP 2.199.900 y el CT10 a COP 378.900 — [garmin.com.co](https://www.garmin.com.co/approach-z30/p)
- **MercadoLibre Colombia:**
  - hay publicaciones del R10 entre unos COP 2.4 y 6.4 millones, varias agotadas o usadas — [MercadoLibre CO – R10 010-02356-00](https://www.mercadolibre.com.co/monitor-golf-garmin-approach-r10-negro-010-02356-00/p/MCO27239432); [MercadoLibre CO – R10](https://www.mercadolibre.com.co/garmin-approach-r10-monitor-portatil-de-lanzamiento-de-golf-lleva-tu-juego-a-casa-en-interiores-o-al-rango-de-conduccion-hasta-10-horas-de-duracion-de-la-bateria-con-paquete-de-alimentacion/p/MCO34341729)
  - de Rapsodo solo apareció el modelo viejo MLM ("MLM01"), no el MLM2PRO — [MercadoLibre CO – Rapsodo](https://articulo.mercadolibre.com.co/MCO-1347849591-rapsodo-monitor-de-lanzamiento-movil-para-golf-en-interior-_JM)
- **Desertcart Colombia:** importa el R10 y el MLM2PRO y gestiona envío y aduana; la búsqueda no mostró el precio — [Desertcart CO – R10](https://www.desertcart.co/products/335102456); [Desertcart CO – MLM2PRO](https://www.desertcart.co/products/539972706-rapsodo-mlm2pro-golf-launch-monitor-simulators-for-home-and-training)
- **Portafolio:** Garmin presentó en Colombia su línea Approach. La Federación Colombiana de Golf cuenta más de 14,000 golfistas activos (fecha del artículo no verificada) — [Portafolio](https://www.portafolio.co/negocios/empresas/garmin-lanza-en-colombia-su-linea-especializada-para-golfistas-tecnologia-de-precision-632180)
- **Referencia en Europa:** R10 a 430 € en El Corte Inglés (consultado 4/10/2026) — [ComprasSmartphone](https://comprasmartphone.com/relojes-deportivos/garmin-approach-r10)

### Inferences
- **El techo de presupuesto de un DIY en Colombia:** el R10 nuevo y oficial cuesta COP 2.899.900. Si el DIY cuesta más que eso, o mide menos, es difícil justificarlo salvo por el valor de aprender.
- **El costo real de cada opción comercial** suma hardware, suscripción del fabricante (para datos o para conectar con terceros) y simulador.
  - Ejemplo: MLM2PRO $599–699 + Premium $199.99/año + GSPro $250/año.
  - Un DIY se ahorra la suscripción del fabricante, pero no la de GSPro, salvo que use OpenGolfSim u OpenShotGolf (gratis).
- **Opciones sin suscripción** que sí sirven para simulador: Square Golf ($699), Square Omni ($1,599), GC3 y el R10 con GSPro (vía conectores). Son la comparación más justa para un DIY "sin pagos recurrentes".

### Gaps
- No encontré precios en COP en tiendas de golf de Bogotá o Medellín ni en Falabella: solo Garmin oficial, MercadoLibre y Desertcart sin precio.
- No obtuve el TRM de noviembre de 2026 para convertir; no se convirtió nada a USD.
- **Sin verificar:**
  - el precio de Awesome Golf (se acabaron las búsquedas);
  - el precio de la suscripción de Garmin Golf para el R10 en 2026;
  - la cuota anual de Foresight+ para el GC2.
- El precio del Rapsodo MLM2PRO tiene datos que chocan entre sí: $119.99 contra $199.99 al año de membresía.

## 5. API GSPro Open Connect: transporte, estructura JSON, campos y unidades, heartbeat o ready, códigos de respuesta, versiones y conectores de ejemplo

### Takeaway
- **Transporte:**
  - socket TCP abierto, sin autenticación, en 127.0.0.1, puerto "0921" (921);
  - el launch monitor es el cliente y GSPro Connect escucha.
- **Mensaje:** un JSON con raíz DeviceID, Units, ShotNumber y APIversion "1", más BallData, ClubData y ShotDataOptions.
- **Respuestas:**
  - 200, tiro recibido;
  - 201, información del jugador: mano y palo;
  - 5XX, fallo.
- **Lo que está retirado o sin implementar:** el heartbeat está retirado y las señales de ready, "sin implementar".
- **Lo que no especifica:** unidades de velocidad, spin y ángulos, ni el formato de trama. Los conectores comunitarios usan mph, rpm y grados, con Units "Yards".

### Cited Findings
- **Documento oficial:** "GSPro Open Connect v1 Documentation" en [gsprogolf.com/GSProConnectV1.html](https://gsprogolf.com/GSProConnectV1.html). No se pudo abrir directamente; su contenido se verificó en la reproducción comentada de [tnbozman/gspro-interface](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD).
- **Conexión:**
  - IP 127.0.0.1, puerto listado como "0921";
  - "the socket connection is open and does not require authentication";
  - comunicación bidireccional constante una vez conectado;
  - asume que el software del launch monitor corre en el mismo PC; si no, "firewall and port forwarding may be required".

  Fuente: [tnbozman](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD)
- **Ejemplo oficial del mensaje de tiro** (literal; el original trae comentarios `//` y no es JSON válido tal cual):
  ```
  {
  "DeviceID": "GSPro LM 1.1",        //required - unqiue per launch monitor / project type
  "Units": "Yards",                  //optional - default yards
  "ShotNumber": 13,                  //required - auto increment from LM
  "APIversion": "1",                 //required - "1" is current version
  "BallData": {
      "Speed": 147.5,                //required
      "SpinAxis": -13.2,             //required
      "TotalSpin": 3250.0,           //required
      "BackSpin": 2500.0,            //only required if total spin is not sent
      "SideSpin": -800.0,            //only required if total spin is not sent
      "HLA": 2.3,                    //required
      "VLA": 14.3,                   //required
      "CarryDistance": 256.5         //optional
  },
  "ClubData": {
      "Speed": 0.0, "AngleOfAttack": 0.0, "FaceToTarget": 0.0, "Lie": 0.0, "Loft": 0.0,
      "Path": 0.0, "SpeedAtImpact": 0.0, "VerticalFaceImpact": 0.0,
      "HorizontalFaceImpact": 0.0, "ClosureRate": 0.0
  },
  "ShotDataOptions": {
      "ContainsBallData": true,            //required
      "ContainsClubData": false,           //required
      "LaunchMonitorIsReady": true,        //optional
      "LaunchMonitorBallDetected": true,   //optional
      "IsHeartBeat": false                 //optional (retired)
  }
  }
  ```
  Fuente: [tnbozman (copia del doc oficial)](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD)
- **Respuestas de GSPro:**
  - **200:** "Shot received successfully";
  - **201:** información del jugador;
  - **501 / 5XX:** "Failure occurred".

  Ejemplo literal del 201:
  ```
  { "Code": 201, "Message": "GSPro Player Information", "Player": { "Handed": "RH", "Club": "DR" } }
  ```
  El doc dice que el 201 se usa normalmente en los launch monitors que deben cambiar entre golpes completos y putt — [tnbozman](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD)
- **Heartbeat y ready:**
  - el heartbeat está retirado: solo queda el campo `IsHeartBeat`, "(retired)";
  - las señales de ready figuran como mensaje del launch monitor a GSPro, pero "(currently not implemented)".

  Fuente: [tnbozman](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD)
- **Ambigüedades señaladas** por tnbozman (fuente: [tnbozman](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD)):
  - no da unidades ni signos para Speed, SpinAxis, HLA, VLA ni SideSpin;
  - no aclara si `Units` afecta a la velocidad;
  - choca TotalSpin "required" con el BackSpin "only required if total spin is not sent";
  - ClubData no tiene marcas de obligatorio ni unidades;
  - no define cómo se separan los mensajes en TCP: ni delimitador, ni salto de línea, ni prefijo de longitud;
  - no enumera los valores de `Handed` y `Club`;
  - el puerto "0921" lleva un cero inicial ambiguo.
- **Unidades y signos que usan los conectores comunitarios:**
  - **OptiSender** (MIT) envía `{"DeviceID":"OptiSender","Units":"Yards","ShotNumber":<n>,"APIversion":"1","BallData":{"Speed":<mph>,"SpinAxis":<deg>,"TotalSpin":<rpm>,"HLA":<deg>,"VLA":<deg>},...}`.
    - Lee el `Code=200` como tiro recibido y el `Code=201` como cambio de palo con `Player.Club`.
    - Signos en el marco del mundo: face y path positivos a la derecha del objetivo, y spin axis positivo = la bola curva a la derecha.

    Fuente: [GitHub dffeist/Optisender](https://github.com/dffeist/Optisender)
  - **HLA:** en la base de conocimiento de GSPro, negativo es izquierda y positivo, derecha — [GSPro KB – Data Tiles](https://gspro.gitbook.io/gspro-knowledge-base/in-game-information/data-tiles)
  - **FaceToTarget:** una implementación comunitaria invierte su signo porque GSPro espera "abierto = positivo". Otra nota que varios equipos no miden Lie, Loft, VerticalFaceImpact ni ClosureRate. Es lo que dice el resumen del buscador, sin URL exacta — candidatas: [DeepWiki – MLM2PRO GSPro Connection](https://deepwiki.com/springbok/MLM2PRO-GSPro-Connector/4.4-gspro-connection); [D-sorganization issue #5218](https://github.com/D-sorganization/Tools/issues/5218)
- **Versiones:**
  - el doc solo describe la v1, donde `"APIversion": "1"` es "current version";
  - el heartbeat pasó a "retired";
  - el doc dice que se documentarán más códigos después.

  Fuente: [tnbozman](https://github.com/tnbozman/gspro-interface/blob/main/OpenAPI-Documentation-Feedback.MD)
- **Conectores y proyectos de ejemplo en GitHub:**
  - **springbok/MLM2PRO-GSPro-Connector:**
    - en Python, GPL-3.0, para Windows;
    - para MLM2PRO y Mevo+, con putting por webcam o ExPutt;
    - por defecto "localhost/921";
    - admite GSCloud desde la V1.01.32.

    Fuente: [GitHub springbok](https://github.com/springbok/MLM2PRO-GSPro-Connector)
  - **dffeist/Optisender:** de OptiShot 2 a Open Connect v1 y a OpenGolfSim; en Python 3.9+, MIT; porta la lógica del proyecto C++ RepliShot — [GitHub Optisender](https://github.com/dffeist/Optisender)
  - **Otros:** kenjdavidson/gspro-connector — [GitHub](https://github.com/kenjdavidson/gspro-connector); matthew-johnston/gsp-r10-adapter, puente de R10 a GSPro — [GitHub README](https://github.com/matthew-johnston/gsp-r10-adapter/blob/main/README.md)
  - **PiTrac** (DIY open source):
    - integra GSPro en el puerto 921 y E6 en el puerto 2483;
    - se configura con la IP del PC del simulador desde su interfaz web en el Pi (puerto 8080);
    - trae scripts de prueba para GSPro y E6.

    Fuente: [PiTrac – Connecting to Golf Simulators](https://pitraclm.github.io/PiTrac/simulator-integration.html); log [Hackaday – GSPro sockets interface](https://hackaday.io/project/195042/log/228422-gspro-sockets-interface-working-at-least-on-test-platform)
  - **OpenShotGolf:** recibe Open Connect v1 en su propio puerto TCP 49152 y responde `{ "Code": 200 }`, o un 50x si el dato viene malformado — [GitHub OpenShotGolf](https://github.com/jhauck2/OpenShotGolf)
- **OpenGolf Connect** (opengolfapi.org), un "conector para todo launch monitor": su guía pide configurar el launch monitor como "GSPro / OpenAPI / OpenConnect" con el servidor en `IP-de-esta-máquina:921` — [OpenGolf Connect](https://opengolfapi.org/connect/)

### Inferences
- **Para un DIY en Python:** basta un cliente TCP que conecte a 127.0.0.1:921 y envíe un JSON por tiro, con ShotNumber incremental y `ContainsBallData: true`, y luego lea la respuesta, 200 o 201.
  - Conviene manejar los 201 para saber qué palo eligió el jugador y si toca modo putt.
- **Cómo separar los mensajes:** como el doc no lo dice, hay que probar empíricamente si GSPro acepta varios mensajes sin delimitador. Un objeto por envío, sin salto de línea, es lo que sugieren los ejemplos, pero no está confirmado.
- **Unidades recomendadas:** mph, rpm, grados y "Yards". Es lo que usan los conectores probados; el doc no lo dice.

### Gaps
- No pude abrir gsprogolf.com (bloqueado) ni comprobar si existe una "v2" de Open Connect o cambios en 2025–2026 (se acabaron las búsquedas).
- No pude verificar en una fuente de GSPro la lista completa de códigos de palo del 201, por ejemplo cómo se nombra el putter.
- No pude verificar si GSPro usa los datos de ClubData para volar la bola.
- OptiSender dice que su destino Open Connect por defecto es `127.0.0.1:9210` y que "funciona con MuniGolf, GSPro y otros". El puerto oficial de GSPro es 921. Lo de "MuniGolf" no se pudo verificar: la búsqueda no devolvió nada.

## 6. OpenGolfSim (¿gratis u open source?, qué ofrece, cómo recibe tiros) y otros simuladores que aceptan equipos de terceros o DIY: E6 Connect, The Golf Club 2019, Awesome Golf y otros

### Takeaway
- **OpenGolfSim:**
  - es un simulador de escritorio para Windows y Mac que se presenta como gratis;
  - tiene una "Developer API" documentada: TCP 127.0.0.1:3111, JSON terminado en salto de línea, mensajes `{"type":"device","status":"ready"}` y `{"type":"shot","shot":{...}}`, y resultados con `type: "result"`;
  - su motor de física (FUSE) y las herramientas de campos están en GitHub, pero no consta que la app sea open source.
- **E6 Connect:** su API (TruSimAPI) está bajo NDA.
- **The Golf Club 2019:** ya no se vende.
- **Awesome Golf:** no encontré API abierta.
- **Gratis y abiertos:** OpenShotGolf, un simulador open source con Godot que acepta Open Connect v1; y el bus abierto FRP (borrador).

### Cited Findings

**OpenGolfSim:**
- se presenta como software de simulador de golf gratis para Windows y Mac — [OpenGolfSim Desktop](https://www-opengolfsim.pages.dev/simulator/); [OpenGolfSim home](https://www-opengolfsim.pages.dev/)
- su app de control remoto para iPhone y iPad (OGS Control) cuesta $9.99 — [App Store OGS Control](https://apps.apple.com/us/app/ogs-control/id6745538399)
- **En GitHub (organización `opengolfsim`):**
  - FUSE, "motor ligero de física y simulación de golf 3D" en TypeScript, público y sin licencia a la vista;
  - herramientas de campos con licencia GPL-3.0: course-meshery-tool y course-terrain-tool;
  - SDK de Unity para crear campos;
  - plugins comunitarios: `ogs-plugin-square-omni` (Square Omni por Bluetooth) y `ogs-plugin-openconnect`;
  - `opengolfsim-desktop` es solo el rastreador de errores; el código de la app no está publicado.

  Fuente: [GitHub opengolfsim](https://github.com/opengolfsim)
- **Plugin Open Connect:** "permite que otras apps y dispositivos envíen tiros a OpenGolfSim por la API OpenConnect v1". Se instala copiando la carpeta en `%USERPROFILE%\AppData\Roaming\opengolfsim-desktop\plugins\`. El README no dice el puerto ni la licencia — [GitHub ogs-plugin-openconnect](https://github.com/opengolfsim/ogs-plugin-openconnect)
- **Developer API:**
  - comunicación TCP simple en el puerto 3111 con payloads JSON — [OGS Developer API](https://help.opengolfsim.com/desktop/apis/)
  - en la página de tiros: host 127.0.0.1, puerto 3111, `type: "shot"` y un objeto `shot` con `ballSpeed`, `verticalLaunchAngle`, `horizontalLaunchAngle`, `spinSpeed` y `spinAxis`;
  - **unidades:** imperial por defecto, con la velocidad en mph; `"unit": "metric"` la pasa a m/s;
  - **rango:** `verticalLaunchAngle` "debería estar entre 0° y 45°";
  - **resultado:** OGS devuelve un mensaje `result` con carry, total y lateral. Según la doc, "al momento de escribir" los resultados se guardan y envían en metros.

  Fuentes: [OGS Shot Data API](https://help.opengolfsim.com/desktop/apis/shot-data/); [OGS Code Examples](https://help.opengolfsim.com/desktop/apis/examples/)
  - los ejemplos envían `JSON.stringify(data) + '\n'`, es decir, un mensaje por línea — [OGS Code Examples](https://help.opengolfsim.com/desktop/apis/examples/)
  - aparte hay una Control API, también por TCP, para controlar el simulador a distancia — [OGS Control API](https://help.opengolfsim.com/desktop/apis/control/)
  - **Mensajes literales que usa OptiSender:**
    - heartbeat cada 0.5 s: `{"type":"device","status":"ready"}`;
    - tiro: `{"type":"shot","shot":{"ballSpeed":<mph>,"verticalLaunchAngle":<deg>,"horizontalLaunchAngle":<deg>,"spinSpeed":<rpm>,"spinAxis":<deg>}}`;
    - lo que recibe: `type=player` cambia el palo activo y `type=result` trae carry, total y rodado.

    Fuente: [GitHub Optisender](https://github.com/dffeist/Optisender)
  - **Problema conocido:** OpenFlight reportó que la Developer API se quedaba en "Initializing" con `isConnected = true` pero `isReady = false`. Probablemente falta el mensaje `device`/`ready`, aunque no está confirmado — [GitHub open-flight/openflight #186](https://github.com/open-flight/openflight/issues/186)
  - **Conflicto:** una página del proyecto OpenFlight dice que la Developer API de OGS "habla el protocolo OpenConnect V1". Eso choca con el formato `type: "shot"` de la doc oficial; el soporte de Open Connect parece venir del plugin aparte — [OpenFlight docs (vía buscador)](https://github.com/jewbetcha/openflight/blob/main/docs/simulator/opengolfsim.md); [ogs-plugin-openconnect](https://github.com/opengolfsim/ogs-plugin-openconnect)
- **Integraciones nativas:**
  - desde diciembre de 2025, el OpenLaunch Nova, sin middleware — [OpenGolfSim – Nova partnership](https://www-opengolfsim.pages.dev/2025/12/08/openlaunch-nova-partnership.html)
  - minijuegos "arcade" de la comunidad con integración directa del R10, de GSPro y de Springbok — [GitHub opengolfsim-arcade](https://github.com/Daniel-Uzcategui/opengolfsim-arcade)

**OpenShotGolf** (gratis, open source):
- simulador hecho con Godot 4.6 .NET, licencia GPL-2.0;
- probado en Linux y Windows; en macOS no está probado;
- probado oficialmente con PiTrac y con Square;
- por ahora tiene rango con datos, elección de palo y grabación; el juego en campo está en diseño inicial;
- servidor TCP en el puerto 49152 que recibe Open Connect v1.

Fuente: [GitHub OpenShotGolf](https://github.com/jhauck2/OpenShotGolf)

**E6 Connect (TruGolf):**
- **Precios:** Basic ~$299–300 al año y Expanded ~$600 al año — [Golfers Authority](https://golfersauthority.com/e6-connect-cost/); [PGA Tour Superstore](https://www.pgatoursuperstore.com/kit-launch-monitor/1146281.html)
- **Compatibilidad de E6 APEX:**
  - TruGolf, FlightScope, Garmin R10 y R50, Rapsodo, SkyTrak y SkyTrak+;
  - Ditect, VTrack, Golfin Idra y Square Golf.

  Fuente: [TruGolf E6 APEX](https://trugolf.com/pages/e6-apex)
- E6 Connect "clásico" sigue disponible y con mantenimiento, pero TruGolf concentra el desarrollo en APEX — [Golf Simulator Source – software guide](https://golfsimulatorsource.pages.dev/golf-simulator-software-guide/)
- con SkyTrak y Foresight, E6 se compra directamente al fabricante del launch monitor — [Carl's Place E6](https://shop.carlofet.com/e6-connect-software)
- **API cerrada:** PiTrac se conecta a E6 por "TruSimAPI", en el puerto 2483. Sus desarrolladores están bajo NDA con TruGolf y no pueden compartir detalles — [PiTrac – Simulator integration](https://pitraclm.github.io/PiTrac/simulator-integration.html)

**The Golf Club 2019 (TGC 2019):**
- ya no se vende, pero las suscripciones existentes siguen funcionando — [Uneekor support – 3rd-party software](https://support.uneekor.com/knowledge/what-3rd-party-software-is-compatible-with-the-uneekor-launch-monitor)
- un blog afirma que TGC y GSPro usan "arquitectura de API abierta". Es opinión, no documentación del fabricante — [SimCaddy – TGC vs GSPro](https://simcaddy.com/blogs/simcaddy-blog/tgc-vs-gspro-a-comparison)
- es compatible con SkyTrak+, Mevo+, X3C, MLM2PRO (con paquete pago) y Uneekor (Pro $199 al año o Champion $399 al año) — [MyGolfSimulator – compatibility guide](https://mygolfsimulator.com/launch-monitor-software-compatibility/); [Uneekor support](https://support.uneekor.com/knowledge/what-3rd-party-software-is-compatible-with-the-uneekor-launch-monitor)

**Awesome Golf:**
- figura como compatible con Square Golf, sin cargo adicional de Square, y con Garmin R10 y R50, Foresight GCQuad y Falcon, Mevo Gen2 y Bushnell Launch Pro — [MyGolfSimulator – compatibility guide](https://mygolfsimulator.com/launch-monitor-software-compatibility/)
- tiene licencias asociadas a la membresía Premium del MLM2PRO. Lo indica solo el título de la página de su documentación — [Awesome Golf Docs – MLM2PRO Premium](https://insights.awesome-golf.com/docs/reference/licenses/with-rapsodo-mlm2pro-premium)

**GSPro:**
- se conecta con los launch monitors de forma nativa o por su API abierta (Open Connect) — [PlayBetter – what golf simulators work with GSPro](https://www.playbetter.com/blogs/golf-simulator-software/what-golf-simulators-work-with-gspro)
- precio y requisitos en la pregunta 4;
- los equipos Foresight necesitan FSX 2020 o FSX Play, y el Bushnell Launch Pro, la suscripción Gold — [GSPro KB – Foresight & Bushnell guide](https://gspro.gitbook.io/gspro-knowledge-base/setup-and-installation/foresight-sports-and-bushnell-launch-pro-guide)

**Flight Relay Protocol (FRP):**
- "el bus abierto para datos de simulación de golf", sobre WebSocket;
- **mensajes:** `bus.actor`, `bus.sync`, `shot.trigger`, `shot.launch`, `shot.club`, `shot.impact`, `shot.flight` (con `basis` `tracked` o `modeled`), `shot.finished` y `golfer.turn`;
- **unidades:** cadenas con la unidad incluida ("67.2mps", "180.5m"); grados, rpm y segundos;
- es un borrador 0.3.0 con licencia CC0, implementado por "Flighthook" y con SDK en Rust;
- no lista ningún fabricante que lo soporte.

Fuente: [GitHub flightrelay/spec](https://github.com/flightrelay/spec)

### Inferences
- **Para un desarrollador de Python con Windows, la ruta más barata para probar un DIY:**
  - OpenGolfSim (gratis, TCP 3111, 5 campos, una línea JSON por mensaje y heartbeat `device/ready`);
  - u OpenShotGolf (open source, Open Connect v1 en el 49152).
- **El salto a GSPro:** reusar el mismo mensaje Open Connect v1, pero hacia el 921, y pagar ~$250 al año.
- **Un emisor para todos:** con un módulo que emita Open Connect v1, el mismo DIY alimenta GSPro, OpenShotGolf y OpenGolfSim (con el plugin `ogs-plugin-openconnect`).
- **Dónde no conviene apuntar:** E6 Connect y Awesome Golf no ofrecen una vía pública para equipos DIY. E6 exige un acuerdo con TruGolf (TruSimAPI bajo NDA).

### Gaps
- No pude confirmar la licencia del núcleo de OpenGolfSim ni la de FUSE, ni si tiene funciones o campos de pago (hosts bloqueados, búsquedas agotadas).
- No encontré el puerto en que escucha `ogs-plugin-openconnect`.
- No verifiqué el precio de Awesome Golf ni si tiene una API para terceros.
- No verifiqué si TGC 2019 tuvo un SDK público para launch monitors.
- No investigué Creative Golf 3D, ProTee Play, Golfisimo ni "Tangent Golf", que apareció en los resultados.

## 7. Quejas frecuentes de usuarios de equipos económicos

### Takeaway
- **Spin en interior:** sobre todo en el R10, y en general en los radares sin pegatinas o RCT.
- **Distancias cortas o errores de lectura en salas pequeñas.**
- **Interferencias.**
- **Regresiones de firmware.**
- **Bolas especiales obligatorias:** RPT en Rapsodo; puntos o RCT en Mevo.
- **Suscripciones que encierran la mitad de las funciones o la conexión con terceros.**

### Cited Findings

**Garmin R10 (foros de Garmin, anecdótico):**
- el spin "está por todas partes" y siempre sale más alto que en otro equipo;
- en interior bajan la velocidad de cabeza y la de bola;
- en garajes y sótanos pequeños las distancias salen 20+ yd cortas y el driver se lee mal;
- chips que volaron unos 8 ft se registraron como 40 yd, y el fallo aparecía con el proyector encendido;
- tras la versión 3.9 de firmware, "inusable en interior".

Fuentes: [Garmin Forums – R10 distances seem off](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/271911/r10-distances-seem-off/1319841); [Garmin Forums – way off indoors since 3.9](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/282288/r10-distances-are-way-off-indoors-since-3-9/1375827); [Garmin Forums – short chips](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/276075/issues-with-short-chips-r10-not-reading-them/1512426); [Garmin Forums – low ceiling basement](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/286851/garmin-r10-range-testing-in-large-indoor-area-vs-low-ceiling-basement-roof-height-problem-add-to-disclaimer); [Garmin Forums – inconsistent speeds](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/280150/very-inconsistent-distances-club-head-and-ball-speeds)
- un ventilador de calefacción alteraba las distancias. Subir la altitud o la temperatura en el software "da más distancia", pero no corrige la causa — [Garmin Forums – Setup / short yardages](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/429653/r10-approach-really-short-on-club-yardages/2006050)
- el side spin en interior no capta el *gear effect* — [Garmin Forums – Side spin](https://forums.garmin.com/outdoor-recreation/golf/f/approach-r10/386004/side-spin)
- el spin se desvía sobre todo en wedges y golpes malos — [Plugged In Golf](https://pluggedingolf.com/garmin-approach-r10-launch-monitor-review/)

**Rapsodo MLM2PRO y MLM2XPRO:**
- sin la membresía, el equipo pierde gran parte de su valor — [Golfers Authority – 5 reasons not to buy MLM2PRO](https://golfersauthority.com/5-reasons-not-to-buy-the-rapsodo-mlm2pro/)
- la mitad de las funciones del MLM2XPRO está detrás de un pago, $199 al año o $499 de por vida — [Breaking Eighty MLM2XPRO](https://breakingeighty.com/rapsodo-mlm2xpro-review)
- con bolas normales el spin no es preciso: hacen falta RPT — [GetRangeIQ](https://getrangeiq.com/devices/rapsodo)
- en interior se apoya más en la cámara, y una red o pantalla puede causar pequeñas diferencias de distancia — [Golf Simulator Advisor](https://golfsimulatoradvisor.com/rapsodo-mlm2pro-review/)

**FlightScope Mevo+:** sin puntos metálicos ni RCT, el spin y la forma del tiro pueden salir algo desviados en interior — [MyGolfSimulator – Mevo+ pros and cons](https://mygolfsimulator.com/mevo-plus-pros-and-cons/)

**Swing Caddie SC4 Pro:** puede perder los tiros muy desviados, como shanks y tops — [Golfers Authority](https://golfersauthority.com/best-swing-caddie-launch-monitors/)

**Uneekor EYE MINI LITE:**
- un usuario dice que el conector para software de terceros cuesta $200 al año (Reddit, 2024) — [Reddit (espejo)](https://reddit.birdcat.cafe/r/Golfsimulator/comments/1fe1ura/gspro_questions/lmnbz0s/?context=3)
- requiere un PC — [Carl's Place](https://shop.carlofet.com/uneekor-eye-mini-lite)

**Suscripciones en general:**
- MyGolfSpy explica que muchas suscripciones abren spin, dispersión y club path, y que el paquete base suele dar solo velocidad, carry y ángulo — [MyGolfSpy – Subscriptions Explained](https://mygolfspy.com/news-opinion/launch-monitor-subscriptions-explained-what-you-pay-after-you-buy/)
- un lector comenta que los equipos Foresight o Bushnell deben conectarse a internet "cada par de meses" o dejan de funcionar con su software. Es anecdótico — [MyGolfSpy – Bushnell Launch Pro review](https://mygolfspy.com/reviews/golf-technology/bushnell-launch-pro-review/)

**Esteras IR (OptiShot):** el sol y otras fuentes IR interfieren con las lecturas — [Golfers Authority](https://golfersauthority.com/how-much-is-optishot-golf-simulator/)

### Inferences
- **Lo que un DIY debería resolver:**
  - spin en interior sin bolas caras, por ejemplo con marcas propias en la bola y una cámara;
  - tolerancia a salas cortas y a interferencias, como ventiladores, luces o proyectores con radar e IR;
  - cero suscripciones;
  - salida Open Connect v1 para GSPro, OpenGolfSim u OpenShotGolf.
- **Las quejas del R10:** muchas vienen de su dependencia del vuelo de la bola en espacios cortos. Un DIY por radar detrás de la bola heredaría el mismo problema.

### Gaps
- Las quejas son de foros y reseñas, no de estudios controlados. No obtuve las notas de versión de Garmin de 2026 para saber si los problemas de interior de la 3.9 se corrigieron.
- No recogí quejas específicas de Square Golf, SkyTrak+ ni del PRGR.
