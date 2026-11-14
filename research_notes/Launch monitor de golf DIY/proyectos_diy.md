# Proyectos DIY y open source de launch monitors de golf (estado al 2026-11-14)

Nota de método (para quien redacte el informe): las fuentes principales son los repositorios públicos de PiTrac (código y documentación) y OpenFlight, clonados y leídos completos el 2026-11-14. Las cifras de precisión "calculadas" salen de archivos CSV de esos repositorios; el cálculo está explicado en cada caso. En esta sesión no se pudieron abrir varios sitios (docs.pitrac.org, pitraclm.github.io, hackaday.io, golfwrx.com, instructables.com, scitepress.org, digitalcommons.usu.edu), y el cupo de búsquedas web compartido entre agentes (200) se agotó a mitad del trabajo. Lo que solo se conoce por el resumen de un buscador está marcado así.

## 1. PiTrac: estado en 2026, hardware, BOM, geometría, qué mide, precisión, software, simuladores, dificultad, limitaciones y roadmap

### Takeaway
PiTrac es el único launch monitor fotométrico open source con mediciones de spin. Funciona con 1 Raspberry Pi 5, 2 cámaras global shutter Sony IMX296 y un estroboscopio IR de 10 LED en una placa propia de componentes pasantes. Mide velocidad de bola, VLA, HLA, backspin y sidespin, y se conecta a GSPro, E6, OpenGolfSim y a TCP genérico. En noviembre de 2026 sigue siendo un proyecto inmaduro, sin releases formales y con poca actividad desde junio. Solo funciona bajo techo, no entrega datos del palo y no publica su costo total. La única comparación numérica que encontré contra un equipo comercial (Uneekor, 10 tiros, febrero de 2025) da unas 2.3 mph de error en velocidad, 0.6° en VLA, 2° en HLA y unos 300 rpm de backspin.

### Cited Findings

**Estado, versión y actividad (consultado 2026-11-14)**
- Repositorio canónico `PiTracLM/PiTrac` (antes `jamespilgrim/PiTrac`): 441 estrellas, 75 forks, 562 commits, 13 issues y 6 PR abiertos. La página de releases dice "There aren't any releases here" — [GitHub PiTrac](https://github.com/PiTracLM/PiTrac); [Releases](https://github.com/PiTracLM/PiTrac/releases).
- No hay tags de versión en el repositorio (`git ls-remote --tags` vacío). El único identificador de versión visible es `"DeviceID": "PiTrac LM 0.1"`, que el conector envía a GSPro — [gspro_sim.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/gspro_sim.py).
- El README todavía dice "This is a really immature project right now. The basic features usually work reliably, but the current release is a bit dodgy" — [README](https://github.com/PiTracLM/PiTrac/blob/main/README.md).
- Último commit en `main`: 2026-10-10 ("cam2 stills use camera2_ball_location since the camera2 mode is gone") — [commits](https://github.com/PiTracLM/PiTrac/commits/main).
- Commits por mes en `main`, contados por mí sobre el historial bajado desde 2025-11-01: nov-25 23, dic-25 24, ene-26 5, feb-26 5, mar-26 15, abr-26 23, may-26 14, jun-26 2, jul-26 0, ago-26 1, sep-26 0, oct-26 2. Autores en ese período: Connor Gallopo 51, James Pilgrim 44, Jesse Hernandez 10, markjonharman 5, stefanferry 3 y Matt Martin 1 — [historial de commits](https://github.com/PiTracLM/PiTrac/commits/main).
- La organización PiTracLM tiene 5 repositorios: PiTrac (C++, actualizado el 16-oct-2026), OGS-Plugin (vacío, 7-oct-2026), Docs (sitio de documentación, 30-may-2026), packages (paquetes .deb de dependencias, 15-abr-2026) y .github — [Org PiTracLM](https://github.com/PiTracLM); [OGS-Plugin](https://github.com/PiTracLM/OGS-Plugin).
- Hitos de 2026, según los commits:
  - ene: offsets de HLA y VLA y ajuste de versión de carcasa ([commits](https://github.com/PiTracLM/PiTrac/commits/main));
  - 20-feb: "Improvements HLA accuracy" ([742a657](https://github.com/PiTracLM/PiTrac/commit/742a657));
  - 21-feb: Connector Board V3 y placa IRLED ([022e74d](https://github.com/PiTracLM/PiTrac/commit/022e74d));
  - 18-mar: BOM de V3 "finalized based on testing on hardware" ([54f9a9f](https://github.com/PiTracLM/PiTrac/commit/54f9a9f));
  - 25-mar: carcasa V3 ([92f9c2b](https://github.com/PiTracLM/PiTrac/commit/92f9c2b));
  - 1-abr: "New ML Model, greatly improved spin processing" ([f678e48](https://github.com/PiTracLM/PiTrac/commit/f678e48));
  - 3-abr: "Single Process" ([b44c49b](https://github.com/PiTracLM/PiTrac/commit/b44c49b));
  - 7-abr: "Add ML Based Spin Detection" ([151c871](https://github.com/PiTracLM/PiTrac/commit/151c871));
  - 14-abr: calibración automática de distorsión de lente ([e060168](https://github.com/PiTracLM/PiTrac/commit/e060168));
  - 28-ago: actualización de licencias ([6ffc0eb](https://github.com/PiTracLM/PiTrac/commit/6ffc0eb)).

**Hardware actual**
- Computador: **1 Raspberry Pi 5** (se recomienda 8 GB), Active Cooler ("Required to keep temps low and timing consistent"), microSD de 64 GB y un cable USB-C para alimentar el Pi desde la Connector Board — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md) (publicada en [docs.pitrac.org](https://docs.pitrac.org/hardware/parts-list/)).
- "Only a single RPi5 is currently supported, however the path to stereoscopic vision currently requires two" — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- La configuración trae los modos `single` ("Single Pi (2 cameras on 1 Pi)", el predeterminado) y `dual` (una cámara por Pi) — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Cámaras: **2 × InnoMaker GS Camera IMX296 Mono** (recomendada, "tipo 5"). Alternativa: Raspberry Pi Global Shutter Camera, IMX296 color, "tipo 4". Datos del sensor IMX296: 5.077 × 3.789 mm, 1456 × 1088, 232 fps nativos y global shutter — [Cámaras](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/cameras/index.md); [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- La cámara Pi GS necesita dos modificaciones: quitarle el filtro IR-cut y soldarle los cables de disparo externo, lo que incluye retirar una resistencia SMD pequeña ("small and difficult"). La InnoMaker Mono no tiene filtro IR-cut y trae los pines Trigger+/Trigger− listos — [Cámaras](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/cameras/index.md).
- Cámaras obsoletas: OV5647, IMX219 e IMX477, por "Rolling shutter, motion blur". La Pi Camera v3 (IMX708) "lacks the high FPS mode needed" — [Cámaras](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/cameras/index.md).
- Lentes M12:
  - 6 mm (predeterminado, ~60° de FOV); la lista de partes pide "6 mm 3 MP Wide Angle Lens" de Adafruit;
  - 3.6 mm gran angular (~90°);
  - 8 o 12 mm, más estrechos.

  [Cámaras](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/cameras/index.md); [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- 2 cables FPC para Pi 5 (22 pines de 0.5 mm a 15 pines de 1 mm, 300 mm). Además, 1 o 2 filtros IR **longpass** de 1" que pasen 700 nm o más (Edmund Optics) sobre la cámara de vuelo — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- Iluminación de la bola en el tee: una tira LED COB USB que "Must produce no infrared light" — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- Alimentación: fuente **Mean Well LRS-75-5**, entrada AC C14 con fusible y cable 18 ga / 22 ga — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- **Connector Board V3**, toda de componentes pasantes. "Vendor assembly is not recommended": se arma a mano — [PCB Assembly](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/pcb-assembly.md). Sus componentes principales son:
  - regulador conmutado MC33063AP, LM317L e inductor de 33 µH;
  - driver de compuerta MCP1407 y 2 MOSFET IRLU024N;
  - DAC MCP4801 y ADC MCP3202, que según parece sirven para calibrar el estroboscopio (inferencia: existe un "V3 Board Calibration GUI", [#186](https://github.com/PiTracLM/PiTrac/commits/main), y un [strobe_calibration_manager.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/strobe_calibration_manager.py));
  - resistencias de potencia de 0.15 Ω (3 W) y 0.1 Ω (1 W).

  [BOM V3](https://github.com/PiTracLM/PiTrac/blob/main/Hardware/Assembly%20Files/V3%20Connector%20Only%20PCB/V3%20Connector%20Only%20Assembly/V3%20Connector%20Only%20Bill%20of%20Materials.csv).
- **Placa IRLED2**: 10 emisores IR Vishay **VSMA1085400** (SMD; se recomienda mandarlos a soldar al fabricante de la PCB) — [IRLED2 BOM](https://github.com/PiTracLM/PiTrac/blob/main/Hardware/Assembly%20Files/IRLED2%20Only%20PCB/IRLED2%20Only%20Assembly/IRLED2%20Only%20Bill%20of%20Materials.csv); [PCB Assembly](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/pcb-assembly.md).
  - DigiKey lo lista en 860 nm, 1.5 A y 80°: [DigiKey](https://www.digikey.co.uk/en/products/detail/vishay-semiconductor-opto-division/VSMA1085400/15786365).
  - LCSC lo describe como LED de 850 nm, con dominante de 860 nm: [LCSC](https://www.lcsc.com/product-detail/C6604340.html). Las dos fuentes no coinciden.
- PCB: se fabrica en JLCPCB o PCBWay a partir de los Gerbers del repositorio. El canal de Discord `#pitrac-stuff-for-sale` ofrece placas sobrantes "at cost" — [PCB Assembly](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/pcb-assembly.md); [Fabrication Files](https://github.com/PiTracLM/PiTrac/tree/main/Hardware/Fabrication%20Files).
- Placas anteriores, hoy obsoletas:
  - V1: optoacopladores H11L1, 74HC04, módulo MOS y un driver LED externo de 18–39 V y 3000 mA (dato del espejo jamespilgrim, conocido solo por el resumen de un buscador) — [resumen de búsqueda: parts list jamespilgrim](https://jamespilgrim.github.io/PiTrac/hardware/parts-list.html);
  - V2: boost de ~15–42 V, ciclo de trabajo limitado al 10% por dos 555 y una falla en los primeros lotes ("the strobe light would not turn off completely or quickly enough");
  - IRLED original: el LED SST-10-IRD-B90H-S810, caro, en configuración 5S2P.

  [Legacy connector boards](https://github.com/PiTracLM/Docs/blob/main/docs/legacy/connector-boards.md).
- **Carcasa V3** ("Version 3.0 (2026, stacked modules)"), además de la V2 ("Version 2.0 (2025, flat base)") — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
  - Usa unos 1.3 kg de filamento; la meta de 1 kg o menos "failed" — [V3 enclosure](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/v3-enclosure/index.md).
  - La pieza mayor mide 160 × 148 × 87.5 mm, así que cabe en una cama de 175 × 175 mm como la de una Prusa Mini — [V3 enclosure](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/v3-enclosure/index.md).
  - Se recomienda PETG con certificación UL94 V-0, por la tensión de red y el LED de alta potencia; "PLA will work as a cheaper alternative" — [3D printing](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/v3-enclosure/3d-printing.md).
  - Lleva un "Acrylic Shankshield" de 138 × 264 × 4 mm "protecting from club strikes", una placa trasera de acrílico y varillas y tornillos M5 — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- Piezas compradas que aparecen en el ensamblaje V3: Mean Well LRS-75, InnoMaker CAM-IMX296RAW (Mono GS), Raspberry Pi 5 Model B y el lente PT361060M3MP12 — [references.txt](https://github.com/PiTracLM/PiTrac/blob/main/3D%20Printed%20Parts/Enclosure%20Version%203/Part/Purchase/references.txt).

**BOM y costo**
- La lista oficial no da precios ni total; solo enlaces a Vilros, Amazon, Inno-Maker, Adafruit, Edmund Optics y DigiKey — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md).
- El README dice que la PCB se fabrica "for a few dollars" y que "The two Pi computers and cameras are the most expensive parts, and cost around $250 in total". La frase es de la época de 2 Pi y no tiene fecha — [README](https://github.com/PiTracLM/PiTrac/blob/main/README.md).
- La documentación reconoce: "It's not cheap, even by rich-country standards… PiTrac still costs hundreds of dollars to build", sin contar herramientas — [What is PiTrac](https://github.com/PiTracLM/Docs/blob/main/docs/build-guide/what-is-pitrac.md).
- La futura "Compute Board" costaría "US $80 or more (populated except for Pi's)" — [Roadmap](https://github.com/PiTracLM/Docs/blob/main/docs/reference/roadmap.md).

**Geometría de instalación y ambiente**
- La cámara 1 ("Tee Camera") vigila la bola en el tee y capta el impacto y el comienzo del vuelo. La cámara 2 ("Flight Camera") sigue la bola en vuelo, lleva el filtro IR y se dispara por hardware desde la cámara 1 — [Cámaras](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/cameras/index.md).
- Posiciones de la bola en el soporte de calibración, en metros (x, y, z) desde cada cámara:

  | Carcasa | Cámara 1 | Cámara 2 | Cámara 1 girada hacia atrás |
  |---|---|---|---|
  | V2 | (−0.12, −0.28, 0.44) | (0.00, 0.095, 0.435) | x = −0.52 |
  | V3 | (−0.12, −0.243, 0.481) | (0.00, 0.109, 0.481) | x = −0.521 |

  Es decir, la bola queda a unos 0.44–0.48 m frente a las cámaras — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- "It's not an outdoor system. The infrared-strobe based foundation for PiTrac would make it pretty difficult to work outdoors when competing with the sun" — [What is PiTrac](https://github.com/PiTracLM/Docs/blob/main/docs/build-guide/what-is-pitrac.md).
- El filtro longpass "cut[s] ambient visible-light interference" en la cámara de vuelo — [Glosario](https://github.com/PiTracLM/Docs/blob/main/docs/reference/glossary.md).
- Advertencia de montaje: "Some black cloth appears white under IR light - test first" — [Legacy enclosure assembly](https://github.com/PiTracLM/Docs/blob/main/docs/legacy/enclosure-assembly.md).
- Bolas: "White golf balls work best"; las de color o con dibujos confunden la detección, y las viejas y raspadas "might not work well" — [Troubleshooting](https://github.com/PiTracLM/Docs/blob/main/docs/reference/troubleshooting.md).
- Zurdos: modo "experimental, may need tweaking" — [Configuration](https://github.com/PiTracLM/Docs/blob/main/docs/software/using-pitrac/configuration.md); [Troubleshooting](https://github.com/PiTracLM/Docs/blob/main/docs/reference/troubleshooting.md).

**Qué mide**
- "ball launch speed, angles and spin in three dimensions" — [README](https://github.com/PiTracLM/PiTrac/blob/main/README.md).
- El mensaje a GSPro lleva `BallData` y pone `ClubData` en ceros con `"ContainsClubData": False`, así que no envía datos del palo. El eje de spin se calcula con atan(sidespin/backspin) — [gspro_sim.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/gspro_sim.py).
- Datos del palo: solo una función experimental que guarda imágenes del impacto (`kEnableClubImages`, apagada por defecto; 6 cuadros antes y 8 después, en un recorte de 340 × 200). No calcula velocidad ni trayectoria del palo — [gs_club_data.h](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_club_data.h); [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Tiene modo putting (`kStartInPuttingMode`) con su propia secuencia de estroboscopio — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).

**Cómo funciona**
- Detección de movimiento: la cámara 1 se recorta a 98 × 88 píxeles, que "can deliver 572 FPS on the GS cam" — [libcamera_interface.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/libcamera_interface.cpp).
- Estroboscopio: los pulsos se generan como patrones de bits por UART a 115200 baudios. Los vectores de tiempos son `[0.7, 1.8, 3.0, 2.2, 3.0, 7.1, 4.0, 0]` para driver y `[5, 30, 30, 30, 50, 0]` para putter — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Detección de la bola en vuelo: hay un detector **YOLO26 en formato NCNN**, configurado como predeterminado aunque etiquetado "experimental", y la alternativa clásica HoughCircles — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json); [ml_assets](https://github.com/PiTracLM/PiTrac/tree/main/Software/LMSourceCode/ml_assets).
- Spin: por defecto usa un modelo ML (NCNN `spin-predictor`). Si la rotación en Z supera 60°, cae a la búsqueda clásica: imágenes de hoyuelos filtradas con Gabor y una búsqueda gruesa de rotaciones en X/Y/Z, por ejemplo X de −36° a 36° en pasos de 4° — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Calibración:
  - soporte de calibración automática impreso en 3D — [Calibration Rig](https://github.com/PiTracLM/PiTrac/tree/main/3D%20Printed%20Parts/Enclosure%20Version%203/Part/Calibration%20Rig);
  - distorsión de lente con un tablero ChArUco: "40 good frames", un RMS menor de 0.6 px cuenta como bueno y mayor de 1.2 px se rechaza — [Express path](https://github.com/PiTracLM/Docs/blob/main/docs/build-guide/express-path.md).

**Precisión reportada**
- Comparación PiTrac contra **Uneekor**: 10 tiros del 2025-02-07 (dato antiguo, anterior a los modelos ML de 2026), con velocidades Uneekor de 54.5 a 91.5 mph. El modelo de Uneekor no se indica — [comparison template.csv](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/Testing/TestSuite_2025_02_07/comparison%20template.csv); [Uneekor Full.csv](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/Testing/TestSuite_2025_02_07/Uneekor%20Comparison%202025-02-07%20-%20Full.csv).
  - Diferencias que calculé:

    | Variable | Error absoluto medio | Error máximo | Sesgo de PiTrac |
    |---|---|---|---|
    | Velocidad de bola | ≈2.3 mph (≈3%) | 5.1 mph | ≈2.1 mph bajo |
    | VLA | 0.6° | 1.5° | — |
    | HLA | 2.0° | 5.0° | — |
    | Backspin | ≈298 rpm (≈7.7%) | 783 rpm | — |
    | Sidespin | ≈605 rpm | 2143 rpm | — |

  - Una fila del CSV trae 70.2 mph donde el CSV "Full" dice 72.6; la velocidad está corregida con ese valor.
  - En dos de los tiros de sidespin, el archivo anota "Uneekor's side spin appears incorrect".
- Las pruebas automáticas de regresión usan tolerancias de 250 rpm en backspin y 300 rpm en sidespin — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json).
- Un archivo de resultados de feb-2025 marca FAIL en 2 de 2 tiros, por ejemplo −1073 rpm de error en sidespin — [PiTrac_Test_Results.csv](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/Testing/TestSuite_2025_02_07/PiTrac_Test_Results.csv).
- Bitácora de Hackaday (conocida solo por el resumen de un buscador; sin fecha, probablemente de 2024–2025):
  - la precisión del spin depende de medir el ángulo entre exposiciones y el tiempo entre ellas;
  - el HLA es el punto débil, porque el radio aparente de la bola, que fija la posición en Z, "is pretty touchy";
  - con un solo estroboscopio funcionando, el borde de la bola sale menos nítido.

  [Hackaday.io logs](https://hackaday.io/project/195042/logs).
- No encontré ninguna comparación publicada en 2026, después del modelo ML de spin y de las mejoras de HLA.

**Software, lenguaje y licencia**
- Núcleo `pitrac_lm` en C++: libcamera, OpenCV para detección y "Physics Calculation". Servidor web en **Python con FastAPI** (puerto 8080, WebSocket y REST) y frontend en JS sin framework. "ActiveMQ has been removed"; los resultados pasan por HTTP POST — [Developer overview](https://github.com/PiTracLM/Docs/blob/main/docs/developer/overview.md); [server.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/server.py).
- La compilación usa OpenCV 4.13.0, lgpio 0.2.2 y NCNN — [build.sh](https://github.com/PiTracLM/PiTrac/blob/main/packaging/build.sh); [ml_assets](https://github.com/PiTracLM/PiTrac/tree/main/Software/LMSourceCode/ml_assets).
- La lista de créditos menciona Boost, ED_Lib, fmt, rpicam-apps, KiCad y FreeCAD. Todavía nombra Flask y ActiveMQ, que ya no se usan — [Credits](https://github.com/PiTracLM/PiTrac/blob/main/Credits/CONTRIBUTORS%20AND%20ATTRIBUTION.md).
- Instalación: Raspberry Pi OS de 64 bits (Trixie / Debian 13), compilando desde el código fuente en 10 a 20 minutos, "Difficulty: Intermediate (script-automated)", con unos 80 paquetes del sistema. Un paquete APT está "coming soon" — [Installation](https://github.com/PiTracLM/Docs/blob/main/docs/software/installation/index.md); [Build guide](https://github.com/PiTracLM/Docs/blob/main/docs/build-guide/index.md).
- En febrero de 2026 se facilitó compilar y probar en Visual Studio en Windows — [742a657](https://github.com/PiTracLM/PiTrac/commit/742a657).
- Licencia: código, documentación y hardware bajo **GPL-2.0**. Los modelos ML entrenados tienen una licencia propietaria aparte: "personal, non-commercial use" y uso comercial solo con permiso escrito — [README](https://github.com/PiTracLM/PiTrac/blob/main/README.md); [LICENSE.MODEL.md](https://github.com/PiTracLM/PiTrac/blob/main/LICENSE.MODEL.md).
- El repositorio `Docs` no tiene archivo de licencia (revisado localmente) — [PiTracLM/Docs](https://github.com/PiTracLM/Docs).

**Simuladores**
- **GSPro**: Open Connect API v1, puerto 921 — [gspro_sim.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/gspro_sim.py); [Simulator integration](https://github.com/PiTracLM/Docs/blob/main/docs/software/simulator-integration.md).
- **E6 Connect / TruGolf**: TruSimAPI, puerto 2483 — [Simulator integration](https://github.com/PiTracLM/Docs/blob/main/docs/software/simulator-integration.md). La autenticación de E6 depende de una biblioteca cerrada, `/usr/lib/pitrac/libpitrac_e6.so`; el repositorio guarda un objeto compilado cerrado — [e6_auth.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/e6_auth.py); [ClosedSourceObjectFiles](https://github.com/PiTracLM/PiTrac/tree/main/Software/LMSourceCode/ImageProcessing/ClosedSourceObjectFiles).
- **OpenGolfSim**: puerto 3111; también hay un simulador TCP genérico — [ogs_sim.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/ogs_sim.py); [tcp_sim.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/tcp_sim.py).
- Contactaron a 2k/TopGolf, "no response yet" — [README](https://github.com/PiTracLM/PiTrac/blob/main/README.md).

**Dificultad**
- "It's not easy, but if you're handy with a soldering iron, can figure out how to 3D print the parts, and are willing to burrow into the Linux operating system…" — [README](https://github.com/PiTracLM/PiTrac/blob/main/README.md).
- Está pensado para impresoras pequeñas, como las de una biblioteca pública, y "no surface mount chips". El acabado es honesto: "Half the features just baaaaaarely work" — [What is PiTrac](https://github.com/PiTracLM/Docs/blob/main/docs/build-guide/what-is-pitrac.md).
- La calibración de la cámara 2 tarda de 90 a 120 s ("This is normal") — [Troubleshooting](https://github.com/PiTracLM/Docs/blob/main/docs/reference/troubleshooting.md).

**Limitaciones conocidas y roadmap**
- Problemas conocidos:
  - los tiros muy bajos ("worm-burner") se pierden en el ruido visual de la alfombra;
  - los tiros muy abiertos quedan desenfocados, porque "The field of focus is too narrow";
  - la latencia entre el impacto y el estroboscopio es tan larga que "The ball has already moved halfway across the field of view";
  - al estroboscopio le falta documentación.

  [Known issues](https://github.com/PiTracLM/Docs/blob/main/docs/reference/known-issues.md).
- Roadmap:
  - Compute Board integrada;
  - visión estereoscópica con 2 Pi;
  - montaje en el techo;
  - carcasas de 3 o 4 cámaras;
  - estandarizar en InnoMaker y usar el lente M12 de 3.6 mm;
  - simuladores abiertos como JaySim y selección de palo;
  - "better support non-US builders".

  La página del roadmap está desactualizada en partes: todavía llama "newest" a la carcasa V2 — [Roadmap](https://github.com/PiTracLM/Docs/blob/main/docs/reference/roadmap.md).

### Inferences
- Para medir variables del palo, PiTrac no sirve hoy: no calcula ni envía datos del palo. Habría que sumarle otro sensor, por ejemplo un radar como el de OpenFlight, o desarrollar el análisis de las imágenes del impacto.
- La actividad de PiTrac cayó a 5 commits entre junio y octubre de 2026. Basarse en él es viable, pero conviene esperar poco soporte nuevo y apoyarse en Discord.
- Para un usuario con experiencia en Python y FastAPI, la capa web y los conectores son fáciles de modificar. El núcleo de visión en C++ es la parte costosa. El soporte de Windows en Visual Studio permite probar el procesamiento con las imágenes de prueba del repositorio antes de comprar hardware.
- El IR a 850–860 nm y su estrategia solo bajo techo calzan con un garaje o una habitación en Bogotá o Medellín. No sirven para un campo de práctica al aire libre.
- Por los 0.44–0.48 m entre cámara y bola y el escudo contra golpes, la unidad parece ir en el piso junto a la bola, frente al golfista, al estilo de SkyTrak o GC3. Es una inferencia: no está dicho de forma explícita en las fuentes leídas.
- El costo real hay que armarlo con la BOM, porque no hay un total oficial. Los $250 del README son de la época de 2 Pi.

### Gaps
- Precio total actualizado de la BOM de PiTrac (1 Pi 5, 2 InnoMaker, lentes, filtro, LRS-75-5, PCB, LEDs y filamento): no está publicado, y el cupo de búsquedas se agotó antes de buscar precios por componente.
- Precisión de PiTrac después de los cambios de 2026 (ML de spin, offsets de HLA, placa V3): no se encontró ninguna tabla publicada.
- Modelo de Uneekor usado en la comparación de 2025: no se indica.
- No se pudieron leer docs.pitrac.org, hackaday.io (bitácoras con fechas), Reddit ni Discord. Faltan reportes de usuarios sobre tasas de detección o costos reales.
- Distancias exactas recomendadas golfista–bola–unidad y tamaño mínimo de la habitación: no se encontraron en los documentos leídos.

## 2. Otros proyectos DIY y open source: radar, cámara, barreras de luz, IMU y proyectos universitarios

### Takeaway
El proyecto con más resultados medidos en 2026 es **OpenFlight**, con radares OPS243-A y TI IWR6843, en Python y React y bajo licencia AGPL-3.0. Cuesta unos $534 en su versión básica y unos $684 con el radar de ángulo. Lo validaron contra TrackMan:
- **velocidad de bola:** unas 2.7 mph de error, casi todas en contra, en una sesión de mayo de 2026;
- **ángulo de lanzamiento con hierros:** 0.83° de error medio con el IWR6843, en julio y agosto de 2026;
- **spin:** todavía no es confiable.

Su propio historial cuenta que empezó con los módulos baratos HB100/CDM324 y los abandonó. Fuera de PiTrac y OpenFlight, lo verificable son trackers de putt con webcam y proyectos universitarios sin cifras accesibles.

### Cited Findings

**OpenFlight (radar), `jewbetcha/openflight`, también en `open-flight/openflight`**
- "DIY Golf Launch Monitor using the OPS243-A Doppler radar". Licencia AGPL-3.0-or-later. Tiene 1.2k estrellas, 152 forks y 1,379 commits, y no publica releases — [GitHub OpenFlight](https://github.com/jewbetcha/openflight); [LICENSE](https://github.com/jewbetcha/openflight/blob/main/LICENSE).
- Commits por mes, contados por mí: dic-25 85, ene-26 108, feb 66, mar 77, abr 261, may 89, jun 160, jul 56, ago 297, sep 80, oct 88, nov (hasta el día 8) 12. Último commit el 2026-11-08. El autor principal es Coleman Rollins, con 791 commits — [commits](https://github.com/jewbetcha/openflight/commits/main).
- BOM, en USD aproximados, según la lista vigente en noviembre de 2026:

  | Parte | Precio |
  |---|---|
  | Radar OPS243-A | $249 |
  | Raspberry Pi 5 (4 GB o más) | $130 |
  | Pantalla de 7" | $46 |
  | Gatillo de sonido SparkFun SEN-14262 | $12 ($18 con la resistencia y los cables) |
  | Accesorios | $25 |
  | Fuente oficial de 27 W | $14 |
  | Carcasa (~750 g de PETG) | $52 |
  | **Base** | **≈$534** |
  | Radar TI IWR6843LEVM (opcional) | $150, total **≈$684** |
  | Inclinómetro LIS3DH (opcional) | $15 |
  | Cámara InnoMaker OV9281 (opcional, experimental) | $30 |
  | Batería X1202 (opcional) | +$104 |

  Los radares K-LD7 quedaron "deprecated" — [parts.md](https://github.com/jewbetcha/openflight/blob/main/docs/get-started/parts.md).
- Qué mide:
  - velocidad de bola de 15 a 200 mph, con "±0.5% accuracy (OPS243-A)" según el fabricante;
  - velocidad del palo antes del impacto, y con ellas el smash factor;
  - ángulo de lanzamiento, medido con el IWR6843 o estimado sin él;
  - club path y spin, ambos experimentales;
  - carry, con un modelo balístico.

  [README](https://github.com/jewbetcha/openflight/blob/main/README.md).
- Cifras técnicas: 71.7 Hz por mph a 24.125 GHz; 30 ksps alcanzan unas 208 mph; captura 4096 muestras I/Q (unos 136 ms alrededor del impacto); el gatillo HOST_INT tarda unos 10 µs — [README](https://github.com/jewbetcha/openflight/blob/main/README.md).
- **Validación contra TrackMan del 2026-05-06** (CSV del repositorio, 22 tiros "good" con driver, hierro 7 y PW, entre 82.7 y 162.6 mph de TrackMan). Diferencias que calculé, OpenFlight menos TrackMan:

  | Variable | Error absoluto medio | Error máximo | Observación |
  |---|---|---|---|
  | Velocidad de bola | **2.69 mph (2.2%)** | 3.66 mph | todas en contra |
  | Velocidad del palo | 5.6 mph (6.5%) | 13.5 mph | — |
  | Smash | +0.06 | — | — |
  | Ángulo vertical | 6.9° | — | probablemente de la época de los K-LD7, antes del IWR6843 (inferencia por la fecha) |
  | Spin | ≈3,000 rpm | — | solo 5 de 22 tiros tuvieron valor |
  | Carry | 16.6 yd | — | — |

  [comparison_20260506.csv](https://github.com/jewbetcha/openflight/blob/main/session_logs/comparison_20260506.csv).
- **Ángulo de lanzamiento con el IWR6843** (dos sesiones bajo techo contra TrackMan):
  - hierros y wedges: **0.83°** de error medio en los 76 de 87 tiros cubiertos (87.4%); la mitad de los tiros con menos de 0.67° y un sesgo de −0.04°;
  - driver: **3.55°**, con 18 de 22 tiros cubiertos, el 10% peor por encima de 15.57° y fallas por "ghost tracks";
  - una tercera sesión, el 22 de julio, dio unos 0.68°.

  [launch-angle.md](https://github.com/jewbetcha/openflight/blob/main/docs/how-it-works/launch-angle.md).
- Otro documento del mismo proyecto compara los K-LD7 con el IWR6843:

  | Medida | K-LD7 | IWR6843 |
  |---|---|---|
  | Ángulo con hierros | 2.14° | 0.83° |
  | Ángulo con driver (con filtro de rastros) | 4.80° | 1.42° |
  | Dirección (RMSE) | ±2.85° | ±1.10° |
  | Club path (RMSE) | — | ±1.18° |

  Su 1.42° de driver no coincide con el 3.55° anterior, que no usa ese filtro — [iwr6843_vs_kld7_comparison.md](https://github.com/jewbetcha/openflight/blob/main/docs/iwr6843_vs_kld7_comparison.md).
- Club path: 0.948° de error medio en 41 tiros de prueba, con una calibración propia de su prototipo; hay que recalibrar si cambia la placa, la carcasa o la alineación — [club-path.md](https://github.com/jewbetcha/openflight/blob/main/docs/iwr6843/club-path.md).
- Resumen del propio proyecto: "ball speed and club speed are the strongest numbers; launch angle is good within the estimator's stated limits; club path is honest but coarse; spin is not yet trustworthy per-shot" — [overview.md](https://github.com/jewbetcha/openflight/blob/main/docs/get-started/overview.md).
- Spin, estado del 2026-06-11 sobre 61 tiros:
  - el estimador de producción dio valor en 12 tiros, con un error mediano de unos 3,200 rpm;
  - uno de investigación ("dechirp") dio valor en 11 tiros, con un error mediano de alrededor del 1%;
  - las fallas típicas son errores de 2× o ½× — [spin-replay.md](https://github.com/jewbetcha/openflight/blob/main/docs/development/spin-replay.md).
- Un resumen de búsqueda atribuye a alguna página de OpenFlight una detección de spin del 50–60%, pero no lo encontré en el README — [resumen de búsqueda: wiki OpenFlight](https://github.com/open-flight/openflight/wiki).
- Posición: el OPS243-A va a 3–5 pies detrás del tee, apuntando a lo largo de la línea de objetivo. El rebote en el piso bajo techo se modela de forma explícita — [positioning.md](https://github.com/jewbetcha/openflight/blob/main/docs/how-it-works/positioning.md).
- El lead de OpenFlight, Coleman Rollins, contó en un podcast que construyó un launch monitor casero con una Raspberry Pi como "cerebro" (resumen de búsqueda) — [Podcast Linked by Golf](https://www.castfox.net/podcast/linked-by-golf-6886929/episode/how-to-build-your-own-launch-monitor-coleman-rollins-linked-by-golf-389142). También hay una entrevista en GolfWRX que no se pudo abrir: [GolfWRX Q&A](https://golfwrx.com/772829/qa-building-a-launch-monitor-at-home-from-scratch/).

**Nota de aplicación de OmniPreSense para golf (AN-029, rev. A, junio de 2026)**
- La bola de golf es "High" en reflectividad y se detecta a 5–10 m. El sensor se pone "2-3m (6-9 ft.) behind the ball facing the direction of travel" — [AN-029 (copia en OpenFlight)](https://github.com/jewbetcha/openflight/blob/main/docs/radar/AN-029-A_OPS243-for-Sports.pdf); [original](https://omnipresense.com/wp-content/uploads/2026/06/AN-029-A_OPS243-for-Sports_260621.pdf).
- Configuración recomendada: 30 ksps, 128 muestras y FFT de 4096, para 0.1 mph de resolución y hasta 209 mph. Con O2 o O3 reporta varios objetos (bola y palo) y da el smash factor. El campo de visión del OPS243 es de 20° × 24° — [AN-029](https://github.com/jewbetcha/openflight/blob/main/docs/radar/AN-029-A_OPS243-for-Sports.pdf).
- OpenFlight encontró errores en la nota:
  - el comando del tamaño de FFT es `X=32`, no `S>32`;
  - la tasa de reportes "near 200 Hz" contradice los 56 Hz de la presentación de 2025;
  - la presentación de 2025 recomendaba inclinar el sensor 10° hacia arriba.

  [radar/README.md](https://github.com/jewbetcha/openflight/blob/main/docs/radar/README.md).
- La presentación de julio de 2025 promete "Very accurate reporting (within <±1 mph)" — [Sports Ball Detect 2507](https://github.com/jewbetcha/openflight/blob/main/docs/radar/OmniPreSense_Sports_Ball_Detect_2507.pdf).
- Hay un Instructables, "Golf Ball Speed Detector", con el OPS243-A por USB, un trípode y una carcasa impresa, configurado con la aplicación de OmniPreSense (resumen de búsqueda; el sitio no se pudo abrir) — [Instructables](https://instructables.com/Golf-Ball-Speed-Detector).

**Módulos de radar baratos HB100 y CDM324 (experiencia de OpenFlight)**
- El prototipo de la "Phase 1" usaba un HB100 con un preamplificador LM358 de ganancia 100, un ADC MCP3008 (que admite solo 3.3 V) y una Pi 5 — [wiring guide archivada](https://github.com/jewbetcha/openflight/blob/main/archive/golf-launch-monitor-wiring-guide.md).
- La versión 5 pasó al CDM324:
  - muestreaba a 20 kHz durante 0.3 s;
  - analizaba la FFT entre 300 Hz y 12 kHz, unas 4 a 167 mph;
  - usaba 71.7 Hz por mph con el CDM324 y 31.36 con el HB100;
  - sus notas dicen "Removed direction detection (not possible with single-output radar)" y "Lowered thresholds for weak signals".

  [launch_monitor.py archivado](https://github.com/jewbetcha/openflight/blob/main/archive/launch_monitor.py).
- El changelog lo resume como "Migrated from CDM324/HB100 radar to OPS243-A" (v0.2.0, fechada 2024-12-01) — [changelog](https://github.com/jewbetcha/openflight/blob/main/docs/changelog.md).

**Cámaras: webcam, OV9281 y otras**
- **cam-putting-py**: simulador de putt con webcam para GSPro, en Python con OpenCV y una versión para Windows. Tiene 52 estrellas — [cam-putting-py](https://github.com/alleexx/cam-putting-py).
  - La cámara va al costado y arriba (~1 m), a 60 fps, y se recomienda una bola naranja.
  - Detecta por color en HSV y mide la velocidad del putt y el HLA.
  - Envía a localhost:8888, una extensión de gspro-garmin-connect-v2.
  - No da cifras de precisión, y hay que ajustar la luz y la cámara a mano.
- Es un fork de `natterman12/Golf-Ball-Tracking-and-Speed-Detection` (GPL-3.0, 4 commits, sin datos de precisión) — [natterman12](https://github.com/natterman12/Golf-Ball-Tracking-and-Speed-Detection).
- OpenFlight tiene un camino experimental con la OV9281 global shutter y YOLO11n en ONNX a 256 px, capturando a 640 × 480 y 60 fps por defecto. No forma parte de la medición de producción — [camera-yolo.md](https://github.com/jewbetcha/openflight/blob/main/docs/development/camera-yolo.md).
- Universidad de Oldenburg, 2023: medición del VLA con audio y video monocular, con una precisión de ±0.74° descrita como comparable a un launch monitor comercial (resumen de búsqueda) — [SciTePress 2023](https://scitepress.org/publishedPapers/2023/121632/pdf/index.html).

**Proyectos universitarios (solo por resúmenes de búsqueda; los documentos no se pudieron abrir)**
- UIUC ECE 445, "Real-Time Golf Swing Tracker": sensores en el grip para medir velocidad, ángulo y presión, con una IMU a unos 1000 Hz y respuesta en unos 5 s. Es un documento de diseño — [UIUC ECE445 doc](https://courses.grainger.illinois.edu/ece445/getfile.asp?id=23968); [otro doc](https://courses.grainger.illinois.edu/ece445/getfile.asp?id=24024).
- Utah State: "low cost launch monitor which can accurately represent the flight dynamics of a golf ball" — [USU Digital Commons](https://digitalcommons.usu.edu/eceengr_srdesign/83).
- UT Arlington, 2021: sensor IMU con interfaz gráfica para seguir la orientación del palo — [UTA Senior Design](https://websites.uta.edu/cseseniordesign/2021/05/11/golf-swing-analysis).
- Northern Arizona, 2003: brazo con servo y un launch monitor comercial leído por serial — [NAU capstone](https://ceias.nau.edu/capstone/projects/EE/2003/Golf_Swing/documentation/Problems_Encountered.doc).

### Inferences
- Las rutas con resultados medidos son dos: fotometría IR con global shutter (PiTrac) y radar Doppler comercial (OpenFlight). Combinar el OPS243-A, para velocidad del palo y de la bola, con un núcleo de cámaras tipo PiTrac, para ángulos y spin, cubriría más variables que cualquiera de los dos por separado.
- Los módulos baratos HB100 y CDM324 dan solo una magnitud de velocidad sin dirección y una señal débil. Necesitan un amplificador y un ADC, y OpenFlight los abandonó. Sirven como experimento de pocos dólares para medir velocidad del palo, no como launch monitor completo.
- Las 2.7 mph siempre en contra del OPS243-A frente a TrackMan son compatibles con el error coseno de la nota AN-029. Es probable que se puedan corregir con alineación o calibración, aunque esto es una inferencia.

### Gaps
- No se pudieron investigar, porque el cupo de búsquedas se agotó:
  - proyectos de golf con IPM-165, Infineon (BGT60 y similares) o Acconeer; un resultado de acconeer.com no se pudo abrir;
  - slow motion de 240/480 fps en teléfono con OpenCV, con cifras de precisión;
  - barreras de luz o cortinas láser;
  - la PS3 Eye;
  - proyectos de Cornell ECE 4760;
  - hilos de GolfSimulatorForum y Reddit.
- No se obtuvieron listas de materiales, costos ni tablas de precisión de los proyectos universitarios.
- No hay cifras numéricas de velocidad de bola de OpenFlight contra TrackMan después de mayo de 2026: solo la frase cualitativa del resumen de julio.

## 3. Código open source reutilizable (repositorio, licencia y lenguaje)

### Takeaway
Hay código maduro para casi todas las piezas: detección de bola, spin, procesamiento de radar y conectores a simuladores. El protocolo de facto es **Open Connect V1 de GSPro**: JSON sobre TCP, en el puerto 921 para GSPro, el 3111 para OpenGolfSim y el 921 para PAR-TEE. Las licencias son copyleft (GPL-2.0, AGPL-3.0 y GPL-3.0), salvo el adaptador del R10, que es MIT. Los modelos ML de PiTrac llevan una licencia no comercial aparte.

### Cited Findings

| Componente | Repositorio | Licencia | Lenguaje | Qué se reutiliza |
|---|---|---|---|---|
| Visión, estroboscopio, spin y conectores | [PiTracLM/PiTrac](https://github.com/PiTracLM/PiTrac) | GPL-2.0 (código, documentación y hardware); modelos ML con [licencia propietaria no comercial](https://github.com/PiTracLM/PiTrac/blob/main/LICENSE.MODEL.md) | C++ (OpenCV, libcamera, NCNN) y Python con FastAPI | YOLO26 en NCNN y HoughCircles; spin por Gabor más búsqueda 3D, o por ML; calibración ChArUco; conectores a GSPro, E6, OGS y TCP ([sims/](https://github.com/PiTracLM/PiTrac/tree/main/Software/web-server/sims)) |
| Radar | [jewbetcha/openflight](https://github.com/jewbetcha/openflight) | AGPL-3.0-or-later ([LICENSE](https://github.com/jewbetcha/openflight/blob/main/LICENSE)) | Python (Flask/SocketIO) y React ([README](https://github.com/jewbetcha/openflight/blob/main/README.md)) | Driver del OPS243-A con búfer circular y FFT, firmware y ángulos del IWR6843, balística y carry, conectores a GSPro, OGS, PAR-TEE, E6 y Garmin ([CLAUDE.md](https://github.com/jewbetcha/openflight/blob/main/CLAUDE.md)) |
| Garmin R10 a GSPro | [mholow/gsp-r10-adapter](https://github.com/mholow/gsp-r10-adapter) | MIT | C# (.NET) | Cliente Open Connect, servidor compatible con E6, Bluetooth LE; 94 estrellas |
| MLM2PRO y Mevo+ a GSPro | [springbok/MLM2PRO-GSPro-Connector](https://github.com/springbok/MLM2PRO-GSPro-Connector) | GPL-3.0 | Python (PySide6) | Conector con hilos y lectura de pantalla por OCR; 99 estrellas |
| Garmin R10 a GSPro | [travislang/gspro-garmin-connect-v2](https://github.com/travislang/gspro-garmin-connect-v2) | Sin licencia formal ("free to use it as you see fit") | Node/JS (deducido de los archivos) | Diseño de reenvío hacia la API de GSPro; v1.3.5, 139 estrellas |
| Putt con webcam | [alleexx/cam-putting-py](https://github.com/alleexx/cam-putting-py) | Tiene archivo de licencia, pero la página no dice cuál | Python y OpenCV | Seguimiento HSV, velocidad y HLA del putt |
| Velocidad del putt | [natterman12/Golf-Ball-Tracking-and-Speed-Detection](https://github.com/natterman12/Golf-Ball-Tracking-and-Speed-Detection) | GPL-3.0 | Python (deducido) | Base de cam-putting-py |

- Formato del mensaje a GSPro, tal como lo arma PiTrac: `{"DeviceID", "Units":"Yards", "ShotNumber", "APIversion":"1", "BallData":{...}, "ClubData":{Speed, AngleOfAttack, FaceToTarget, Lie, Loft, Path, SpeedAtImpact, VerticalFaceImpact, HorizontalFaceImpact, ClosureRate}, "ShotDataOptions":{ContainsBallData, ContainsClubData, LaunchMonitorIsReady, LaunchMonitorBallDetected, IsHeartBeat}}`, con mensajes de latido (`IsHeartBeat`) y un tope de 200 mph (`_MAX_SPEED_MPH`) — [gspro_sim.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/gspro_sim.py).
- GSPro requiere una licencia pagada convertida al tipo "OpenAPI"; la API Open Connect viene incluida — [OpenFlight: GSPro](https://github.com/jewbetcha/openflight/blob/main/docs/using/simulator/gspro.md).
- OpenGolfSim: "Developer API" en el puerto TCP 3111, protocolo OpenConnect V1, "the API has no auth" — [OpenFlight: OpenGolfSim](https://github.com/jewbetcha/openflight/blob/main/docs/using/simulator/opengolfsim.md).
- PAR-TEE: simulador para iPhone y iPad, OpenConnect V1, puerto TCP 921 — [OpenFlight: PAR-TEE](https://github.com/jewbetcha/openflight/blob/main/docs/using/simulator/partee.md).
- E6 Connect: TruSimAPI en el puerto 2483 — [PiTrac: Simulator integration](https://github.com/PiTracLM/Docs/blob/main/docs/software/simulator-integration.md). La autenticación usa un binario cerrado en PiTrac — [e6_auth.py](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/sims/e6_auth.py).

### Inferences
- Para un desarrollador de Python, conviene escribir el conector propio sobre Open Connect V1: así se habla con GSPro, con OpenGolfSim (que parece gratuito o de bajo costo; no verificado) y con PAR-TEE con el mismo código. OpenGolfSim sirve para probar sin pagar la licencia de GSPro.
- Copiar código de PiTrac obliga a publicar bajo GPL-2.0, y copiar de OpenFlight bajo AGPL-3.0, que también alcanza al uso por red. Los modelos ML de PiTrac solo valen para uso personal no comercial.

### Gaps
- No se verificó si OpenGolfSim es open source ni cuánto cuesta: el plugin de PiTrac está vacío y el cupo de búsquedas se agotó.
- No se encontró código independiente y documentado de estimación de spin fuera de PiTrac, ni de FFT para HB100 o CDM324 fuera del prototipo archivado de OpenFlight.

## 4. Modos de falla reportados por los constructores

### Takeaway
Los problemas repetidos son físicos y de configuración:
- la luz solar y el IR ambiente, por eso PiTrac solo funciona bajo techo;
- el desenfoque de movimiento y el obturador rolling;
- la latencia del gatillo;
- el error coseno y el multitrayecto en radar;
- el spin, poco confiable en las dos tecnologías;
- la geometría mal ingresada, que sesga los resultados sin dar ningún error;
- los gatillos de sonido mal calibrados.

### Cited Findings
- **Sol e IR ambiente:** el estroboscopio IR de PiTrac compite con el sol y no funciona al aire libre. La tira LED de luz visible no debe emitir IR. Algunas telas negras se ven blancas en IR — [What is PiTrac](https://github.com/PiTracLM/Docs/blob/main/docs/build-guide/what-is-pitrac.md); [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md); [Legacy enclosure](https://github.com/PiTracLM/Docs/blob/main/docs/legacy/enclosure-assembly.md).
  - Un filtro de luz visible faltante o ineficaz en la cámara 2 produce estelas en la imagen — [V2 board modification](https://github.com/PiTracLM/Docs/blob/main/docs/legacy/v2-board-modification.md).
  - En abril de 2026 se bajó la ganancia mínima a 0.1 "to help with multi-strobed environment operation" — [58e0a1c](https://github.com/PiTracLM/PiTrac/commit/58e0a1c).
- **Rolling shutter y desenfoque de movimiento:** PiTrac declaró obsoletas las cámaras rolling shutter por "motion blur" — [Cámaras](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/cameras/index.md).
  - Las primeras placas V2 no apagaban el estroboscopio "completely or quickly enough" — [Legacy connector boards](https://github.com/PiTracLM/Docs/blob/main/docs/legacy/connector-boards.md).
  - Para fotografiar el palo se prueba bajar el tiempo de obturación y subir la ganancia "to reduce blur" — [gs_club_data.h](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/gs_club_data.h).
- **Latencia y CPU:**
  - en PiTrac, la bola ya cruzó la mitad del campo de visión cuando empieza el estroboscopio — [Known issues](https://github.com/PiTracLM/Docs/blob/main/docs/reference/known-issues.md);
  - la cámara 1 se recorta para llegar a 572 fps — [libcamera_interface.cpp](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/ImageProcessing/libcamera_interface.cpp);
  - el Active Cooler se exige para mantener "timing consistent" — [Parts list](https://github.com/PiTracLM/Docs/blob/main/docs/hardware/parts-list.md);
  - en OpenFlight, una Pi 5 sin ventilador "throttles under sustained load" — [parts.md](https://github.com/jewbetcha/openflight/blob/main/docs/get-started/parts.md).
- **Detección de la bola:** se pierden los tiros muy bajos sobre la alfombra, y los tiros muy abiertos quedan desenfocados por la poca profundidad de campo — [Known issues](https://github.com/PiTracLM/Docs/blob/main/docs/reference/known-issues.md). También fallan los círculos falsos, la falta o el exceso de luz y las bolas de color o raspadas — [Troubleshooting](https://github.com/PiTracLM/Docs/blob/main/docs/reference/troubleshooting.md).
- **Spin:**
  - en PiTrac, el modelo ML cae a la búsqueda clásica si la rotación en Z supera 60° — [configurations.json](https://github.com/PiTracLM/PiTrac/blob/main/Software/web-server/configurations.json);
  - en la comparación de 2025, el error máximo de sidespin fue de 2143 rpm — [comparison template.csv](https://github.com/PiTracLM/PiTrac/blob/main/Software/LMSourceCode/Testing/TestSuite_2025_02_07/comparison%20template.csv);
  - en OpenFlight, "Short indoor flight windows and multipath make individual readings unreliable" — [README](https://github.com/jewbetcha/openflight/blob/main/README.md);
  - los estimadores eligen el armónico equivocado, con errores de 2× o ½× — [spin-replay.md](https://github.com/jewbetcha/openflight/blob/main/docs/development/spin-replay.md).
- **Calibración y deriva:**
  - en OpenFlight, "A bad tee distance or tilt does not produce an error", sino un resultado sesgado, sobre todo tras mover o golpear la unidad; por eso se suma el inclinómetro — [positioning.md](https://github.com/jewbetcha/openflight/blob/main/docs/how-it-works/positioning.md);
  - la referencia del club path es propia de cada montaje y hay que recalibrarla tras cualquier cambio — [club-path.md](https://github.com/jewbetcha/openflight/blob/main/docs/iwr6843/club-path.md);
  - PiTrac agregó en 2026 offsets de HLA y VLA y la calibración de distorsión ChArUco por lente — [742a657](https://github.com/PiTracLM/PiTrac/commit/742a657); [e060168](https://github.com/PiTracLM/PiTrac/commit/e060168).
- **Error coseno y multitrayecto en radar:**
  - una bola que pasa fuera del eje lee de menos en proporción al coseno — [AN-029](https://github.com/jewbetcha/openflight/blob/main/docs/radar/AN-029-A_OPS243-for-Sports.pdf); [README](https://github.com/jewbetcha/openflight/blob/main/README.md);
  - los K-LD7 sufrían "Severe ceiling/floor reflection phase errors" — [comparación](https://github.com/jewbetcha/openflight/blob/main/docs/iwr6843_vs_kld7_comparison.md);
  - con driver aparecen "ghost tracks" lentos, que se filtran rechazando los que van a menos del 65–70% de la velocidad del OPS — [launch-angle.md](https://github.com/jewbetcha/openflight/blob/main/docs/how-it-works/launch-angle.md);
  - el K-LD7 tiene un máximo de 62 mph — [README](https://github.com/jewbetcha/openflight/blob/main/README.md).
- **Gatillo y disparos falsos:**
  - el SEN-14262 a 3.3 V tiene demasiada ganancia y su salida GATE queda pegada en alto si no se suelda la resistencia R17. "Triggers constantly / too sensitive" se corrige bajándola — [sound-trigger.md](https://github.com/jewbetcha/openflight/blob/main/docs/build/sound-trigger.md);
  - la lista de pruebas exige revisar los swings de práctica sin bola y el movimiento ambiente — [hardware-trigger.md](https://github.com/jewbetcha/openflight/blob/main/docs/hardware-trigger.md);
  - PiTrac volvió más sensible su detección de movimiento en enero de 2026 (multiplicador de diferencia 0.7) — [commits](https://github.com/PiTracLM/PiTrac/commits/main).
- **Construcción:** la impresión de la carcasa dio "varied, inconsistent success" (bitácora de Hackaday, por resumen de búsqueda) — [Hackaday.io logs](https://hackaday.io/project/195042/logs). Otros problemas de la carcasa son el acceso difícil a los Pi y los soportes de impresión difíciles de quitar — [Known issues](https://github.com/PiTracLM/Docs/blob/main/docs/reference/known-issues.md).

### Inferences
- Un diseño de bajo costo debería prever desde el inicio:
  - un ambiente cerrado y oscuro en IR;
  - global shutter más un estroboscopio corto;
  - el gatillo desde una cámara recortada a cientos de fps, o desde el radar;
  - ventilación activa de la Pi 5;
  - una montura rígida con inclinómetro;
  - un protocolo de validación propio, con por lo menos un launch monitor prestado como referencia.

### Gaps
- No se reunieron reportes de foros (GolfSimulatorForum, Reddit, Discord) sobre la frecuencia de cada falla, la deriva de la calibración en el tiempo ni las tasas de disparos falsos de PiTrac: los sitios estaban bloqueados y se agotó el cupo de búsquedas.
- Para completar estos puntos habría que habilitar en la red de la sesión los dominios docs.pitrac.org, hackaday.io, golfwrx.com e instructables.com, o pedir una búsqueda adicional en un mensaje aparte.
