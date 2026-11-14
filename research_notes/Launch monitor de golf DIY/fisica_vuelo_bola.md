# Física del vuelo de la bola de golf: modelos, coeficientes y datos de validación (para un launch monitor DIY)

Notas al 2026-11-14. **Cómo se obtuvo esto (importante para el redactor):** en esta sesión WebFetch estuvo bloqueado por la red para casi todos los dominios (trackman.com, arxiv.org, illinois.edu, github.io, mdpi.com y patents.google.com devolvieron rechazo del proxy). Además, el cupo de WebSearch (compartido entre agentes) se agotó a mitad de la investigación. Por eso:
1. muchos datos vienen de resúmenes del buscador;
2. otros vienen del texto completo de cuatro repositorios públicos clonados con git:
   - `jhoblitt/tmelevation` (commit del 2026-10-10). Sus notas de investigación marcan cada dato como leído en la fuente primaria ([V]/[P]) o de segunda mano ([S]).
   - `gdifiore/libgolf` (2026-08-20);
   - `avrybrdly93/golfsim` (2025-11-01);
   - `esba1ley/golfball` (2025-07-10).

Cuando un dato viene de esas notas se cita la fuente primaria y el archivo de notas. Los cálculos de "Inferences" los hice yo con un script propio en Python que reimplementa las ecuaciones documentadas, sin ejecutar código descargado.

## 1. Ecuaciones de movimiento (3D, con eje de spin) y límites de la bola según USGA/R&A

### Takeaway
La literatura y los simuladores abiertos usan un modelo de masa puntual con tres fuerzas:
- arrastre opuesto a la velocidad relativa al aire, u = v − v_viento;
- sustentación de Magnus en la dirección ω̂ × û;
- gravedad.

El vector de spin conserva su eje y decae en magnitud. La bola de referencia es la del límite reglamentario: m ≤ 45.93 g y D ≥ 42.67 mm. Desde 2028 cambian las condiciones de la prueba de distancia (ODS), no el tamaño ni el peso.

### Cited Findings
- **Peso y diámetro (Reglas de Equipamiento, Parte 4):**
  - "The weight of the ball must not be greater than 1.620 ounces avoirdupois (45.93 g)";
  - "The diameter of the ball must not be less than 1.680 inches (42.67 mm)";
  - no hay peso mínimo ni diámetro máximo, y el tamaño se verifica con un anillo metálico.

  — [R&A, Rules of Equipment Part 4](https://www.randa.org/roe/the-rules-of-equipment/part-4-conformance-of-balls); [USGA Appendix III](https://www.usga.org/etc/designs/usga/content/rule-book/rule-14324.html)
- **Velocidad inicial:** el texto de la regla no da un número; remite al "Initial Velocity Standard" archivado en la USGA. Fuentes secundarias dicen 250 ft/s con 2% de tolerancia, sin verificar. — [USGA Appendix III](https://www.usga.org/etc/designs/usga/content/rule-book/rule-14324.html) (resumen del buscador)
- **Overall Distance Standard (ODS):** el límite sigue en 317 yd de carry + rodado, con 3 yd de tolerancia. Cambian las condiciones de prueba:

  | | Hasta 2027 | Desde enero 2028 (élite) y enero 2030 (todos) |
  |---|---|---|
  | Velocidad de cabeza | 120 mph | 125 mph |
  | Velocidad de bola equivalente | 176 mph | 183 mph |
  | Spin | 2520 rpm | 2220 rpm |
  | Lanzamiento | 10° | 11° |

  — [R&A 2023](https://www.randa.org/articles/decision-to-revise-golf-ball-testing-conditions-beginning-in-2028-announced); [USGA 2023](https://www.usga.org/content/usga/home-page/articles/2023/12/revised-golf-ball-testing-conditions-to-take-effect-in-2028.html); [ESPN](https://espn.com/golf/story/_/id/39053964/revised-golf-ball-testing-go-effect-2028)
- **Ecuaciones de Penner (2001), ecs. 12–15**, con φ = ángulo de la velocidad sobre la horizontal:
  - fuerzas: F_D = ½ρ(πr²)C_D v² y F_L = ½ρ(πr²)C_L v²;
  - a_x = (−F_D cos φ − F_L sin φ)/m;
  - a_y = (−F_D sin φ + F_L cos φ)/m − g, con g = 9.81 m/s²;
  - bola de 45.9 g y 4.27 cm, ρ = 1.204 kg/m³ ("dry air at 20 °C");
  - paso de 0.001 s, con incertidumbre de cálculo < 0.1 yd.

  — [Penner 2001, Am. J. Phys. 69:563, doi:10.1119/1.1344164](https://doi.org/10.1119/1.1344164), leído en primaria por [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md)
- **Misma física en componentes, sin trigonometría ni singularidad en el ápice** (tmelevation la usa así):

  ```
  u_x = v_x − w,  u_y = v_y,  U = √(u_x² + u_y²)
  dv_x/dt = −k·U·(C_D·u_x + C_L·u_y)
  dv_y/dt = −k·U·(C_D·u_y − C_L·u_x) − g
  dω/dt   = −λ0·(ρ/ρ0)·U·ω/r
  k = ρA/(2m),  A = πD²/4,  S = rω/U,  Re = ρUD/μ
  ```

  — [tmelevation, página de métodos](https://jhoblitt.github.io/tmelevation/methods.html) ([fuente HTML](https://github.com/jhoblitt/tmelevation/blob/main/site/methods.html)); [flight.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/flight.js)
- **Forma vectorial 3D de libgolf**, derivada del modelo de Alan Nathan (University of Illinois). El vector ω lleva el eje de spin en 3D.

  ```
  F_drag   = −c0·Cd·|u|·u
  F_magnus =  c0·(Cl/|ω|)·|u|·(ω × u)
  ```

  - La gravedad (−32.174 ft/s²) se suma aparte.
  - El spin decae por componente con `ω *= exp(−dt/τ)`, así que el eje se conserva.
  - S = |ω|·r/|v − v_viento|.

  — [libgolf, aerodynamic_model.md](https://github.com/gdifiore/libgolf/blob/main/docs/aerodynamic_model.md); [libgolf README](https://github.com/gdifiore/libgolf/blob/main/README.md)
- **Constante agrupada de libgolf y Nathan, en unidades de pie:**
  - `c0 = 0.07182·ρ·(5.125/masa_oz)·(circ_in/9.125)²`;
  - la referencia es una pelota de béisbol de 5.125 oz y 9.125 in de circunferencia;
  - la bola estándar de golf tiene 1.62 oz y 5.277 in de circunferencia.

  — [libgolf physics_constants.hpp](https://github.com/gdifiore/libgolf/blob/main/include/physics_constants.hpp)
- **Viento en libgolf y Nathan:** un solo vector horizontal que actúa sobre la altura `hWind` y es cero debajo. Un campo de viento 3D requiere un modelo propio. — [libgolf, aerodynamic_model.md](https://github.com/gdifiore/libgolf/blob/main/docs/aerodynamic_model.md)
- **Perfil logarítmico de viento:** Naruo & Mizota (2008) usaron un perfil logarítmico de capa límite verificado en campo, y los puntos de caída predichos para tiros de un profesional "agreed". Solo se leyó el resumen. — [registro LIDA](https://lida.sport-iat.de/twm/Record/3044663) vía [notas aero-data de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md.notes.md)
- **Flotación:** ρ·V_bola/m ≈ 0.11% del peso al nivel del mar; es despreciable. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)
- **Ley de sustentación de Robinson & Robinson (2013):** Jensen (2014) mostró por análisis dimensional que es incorrecta para fuerzas que dependen de ω. No usarla. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)
- **Magnus inverso:** con S = 0.1 y Re ≈ 7.5×10⁴ hay sustentación negativa (C_L = −0.137, LES), al final de un drive y más en altura. — [Li, Tsubokura & Tsunoda 2017, PMC6044256](https://pmc.ncbi.nlm.nih.gov/articles/PMC6044256)

### Inferences
- **Forma 3D en SI recomendada**, con z hacia arriba y u = v − v_viento(z):
  ```
  dv/dt = −(ρA/2m)·C_D(S,Re)·|u|·u + (ρA/2m)·C_L(S,Re)·|u|·(ω̂ × u) − g·ẑ
  dω/dt = −λ0·(ρ/ρ0)·(|u|/r)·ω
  ```
  - La segunda ecuación es vectorial: conserva el eje y es la misma ley de Smits & Smith (ver §3).
  - El "spin axis" de los launch monitors (inclinación α del eje respecto de la horizontal) se traduce en backspin = ω·cos α y sidespin = ω·sin α. libgolf recibe exactamente backspin y sidespin.
- **Unidades de `c0`:** comprobé que corresponde a ρA/(2m) en ft⁻¹ con ρ en lb/ft³. Con ρ en kg/m³ el número no cuadra. Conviene implementar todo en SI.
- **Integrador:** RK4 con dt = 0.01 s sobra para una precisión de décimas de yarda. tmelevation midió ≤ 0.002 yd de error en carry con dt = 0.05 s contra dt = 10⁻⁴ s ([aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)).

### Gaps
- No se verificó el valor del Initial Velocity Standard (250 ft/s ± 2%) en un documento primario.
- No se encontraron parámetros verificados de un perfil vertical de viento específico para golf (longitud de rugosidad, exponente). El escalón `hWind` de libgolf es una simplificación.
- Penner (2003), "The physics of golf", Rep. Prog. Phys. 66:131–171, no se pudo leer (de pago).

## 2. Coeficientes de arrastre y sustentación en función de S = rω/v y Re

### Takeaway
No existe un modelo cerrado, verificado en primaria, que cubra todo el rango de S: de S ≈ 0.07 en un drive de tour a más de 1 en el descenso de un wedge.
- **Smits & Smith (1994)** es la forma cerrada clásica, pero ajustada solo para driver. Sobreestima la sustentación de las bolas actuales en un 30–50% a S de driver.
- **Mediciones modernas** en aire quieto y en el Indoor Test Range de la USGA dan, a Re ≥ 7.5×10⁴, C_D ≈ 0.21–0.25 y C_L ≈ 0.11–0.17 a S de driver (0.05–0.10).
- **Crisis de arrastre** entre Re ≈ 5×10⁴ y 10⁵.
- **Pérdida de sustentación**, incluso negativa, bajo Re ≈ 7.5×10⁴. Depende del modelo de bola.
- **Entre bolas** la diferencia es de unos ±0.02 en los coeficientes, unos 18 m de carry en un drive.

### Cited Findings
#### Smits & Smith (1994), *Science and Golf II*
- **Fórmulas**, con validez para tiros de driver en 70,000 < Re < 210,000 y 0.08 < S < 0.2 (datos de túnel en 40,000 < Re < 250,000 y 0.04 < S < 1.4):
  ```
  C_D = 0.24 + 0.18·S + 0.06·sin(π·(Re − 90 000)/200 000)
  C_L = 0.54·S^0.4
  (dω/dt)·d²/(4U²) = −2×10⁻⁵·S
  ```
  - Su C_L salió unos 0.04 sobre el de Bearman & Harvey, con mayor dependencia de C_D en S.
  - Sobre Re 200,000 se observó una segunda caída de C_D, quizá por compresibilidad (Mach local de hasta 0.5).
  - La bola medida tenía m = 0.04593 kg y r = 0.02134 m.

  — Leído de segunda mano: texto de la reseña de R. D. Mehta reproducido en la patente [US 11,230,375 B1](https://patents.google.com/patent/US11230375B1/en), según las [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md); capítulo en [Taylor & Francis](https://www.taylorfrancis.com/chapters/edit/10.4324/9780203474709-54/new-aerodynamic-model-golf-ball-flight-smits-smith)
- **Conflictos menores:**
  - páginas 340–347 según tmelevation, 341–347 según la cita de una patente;
  - texto OCR de patentes que muestra "S^2.4" en vez de "S^0.4"; el HTML limpio dice 0.4.

  — [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md); [resumen del buscador sobre patentes](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11230375)
- **Contra la tabla TrackMan 2023:** sin calibrar y con su término de Re, el modelo erra el carry en −10.4% (driver PGA) y +5.1% (hierro 7 PGA). Sin el término de Re, el error es de −2.3% a +7.5%, pero cada ápice sale 6–8 yd alto. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)
- **Contra las bolas modernas:** la ley de lift de Smits & Smith queda en promedio +0.058 sobre lo medido en régimen supercrítico. Eso es ≈30–50% a S ≤ 0.15; la razón medido/S&S es ≈0.7–0.77 a S de driver. — [tmelevation aero-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md); discusión en [PR #6](https://github.com/jhoblitt/tmelevation/pull/6)

#### Bearman & Harvey (1976), *Aeronautical Quarterly* 27:112–122
- **Ensayo y forma de los datos:** túnel de viento con un modelo 2.5 veces más grande, bola convencional de los años 70 (también hexagonal). Los datos son solo tablas y gráficos, sin fórmula cerrada.
  - Rango: Re 40,000–240,000 y S 0.02–0.3; las series por rpm llegan a S = 1.0 a baja velocidad.
  - C_L sube monótonamente con S, de ≈0.08 a 0.25.
  - C_D sube para S > 0.1, de ≈0.27 a 0.32.
  - Las tendencias no dependen de Re para 126,000 < Re < 238,000.
  - A S = 0.15: C_D ≈ 0.28 y C_L ≈ 0.18.

  — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md) (de segunda mano, vía Mehta y Crabill)
- **Valores de lift altos:** 0.35 a S = 0.46, 0.40 a 0.64 y 0.45 a 1.0.
- **Magnus inverso:** a U = 14 m/s (Re ≈ 3.8×10⁴), C_L = −0.12 a S = 0.17.
- **Efecto del spin moderado:** baja el arrastre de la crisis, de 0.354 a 0.288 a Re 5.9×10⁴ entre S = 0 y 0.11.
- **Origen de estas lecturas:** figuras digitalizadas de la [tesis de Kensrud 2010 (WSU)](https://rex.libraries.wsu.edu/esploro/outputs/graduate/Determining-aerodynamic-properties-of-sports-balls/99900525114301842), figs. 2.13–2.14, y de [Crabill, Witherden & Jameson, arXiv:1806.00378](https://arxiv.org/abs/1806.00378), fig. 6. — [aero-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md)
- **Uso posterior:** Penner (2001) y MacDonald & Hanzely (1991) usaron coeficientes de Bearman & Harvey interpolados. Penner escribe que esos coeficientes "decrease with increasing speed and increase with increasing spin". — [Penner 2001](https://doi.org/10.1119/1.1344164) vía [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md)

#### Lyu, Kensrud, Smith & Tosaya (2018), *Proceedings* 2(6):238 (WSU, acceso abierto CC BY)
- **Ensayo:** 13 bolas comerciales lanzadas en aire quieto con barreras de luz, a 18–91 m/s y 1500–4500 rpm.
- **Sin spin:** C_D ≈ 0.5 a Re 5×10⁴ y ≈ 0.2 a 10⁵. La dispersión entre bolas es > 0.1 bajo Re 7.5×10⁴ y < 0.05 sobre 10⁵.
- **Ajustes para la bola Kirkland (KK), girando a 1500–2500 rpm:**
  ```
  C_D = 1.29e-10·Re² − 2.59e-5·Re + 1.50     (5e4 < Re < 1e5)
  C_D = 1.91e-11·Re² − 5.40e-6·Re + 0.56     (7.5e4 < Re < 2e5)
  C_L = −3.25·S² + 1.99·S                    (S ≈ 0.04–0.32; 32–91 m/s)
  ```
  Las velocidades bajas se excluyeron del ajuste de C_L "to avoid the influence of the reverse Magnus effect at low speed". La cuadrática de C_L tiene su máximo en S ≈ 0.31, así que no sirve para hierros ni wedges.
- **Diferencia entre bolas:** ΔC_D y ΔC_L ≈ 0.02 en promedio, que dan 18 m de diferencia de carry en un drive. Una incertidumbre de 0.0025 en C_D vale 2.3 m.

— [doi:10.3390/proceedings2060238](https://doi.org/10.3390/proceedings2060238), leído en primaria por las [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md); figura en [ResearchGate](https://www.researchgate.net/figure/a-Coefficient-of-drag-as-a-function-of-Reynolds-number-for-non-rotating-balls-b-Drag_fig3_323372659)

#### Lyu, Kensrud & Smith (2020), "The reverse Magnus effect in golf balls", *Sports Engineering* 23:3
- **Bolas y rango:** Pro V1, ChromeSoft y B330-RX en aire quieto, Re 4.9×10⁴–2×10⁵ y S 0.05–0.36.
- **A 2250 ± 250 rpm, C_L según Re:**

  | Re | C_L |
  |---|---|
  | 7.5×10⁴ | 0.14–0.22 |
  | 6.2–6.3×10⁴ | −0.02 a −0.09 |
  | 5×10⁴ | +0.08–0.14 |

- **A Re 6.5×10⁴** la sustentación es negativa para 0.07 < S < 0.21 en las tres bolas. El mínimo es −0.10 con hoyuelo circular y −0.15 con hoyuelo hexagonal.
- **Arrastre:** en un modelo, C_D pasa de ≈0.5 a 0.2 al cruzar la transición.
- **Desviación estándar de la medición:** 0.01 en C_L y 0.02 en C_D.

— [doi:10.1007/s12283-020-0318-1](https://doi.org/10.1007/s12283-020-0318-1) vía [aero-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md); [PDF en d-nb.info](https://d-nb.info/1209740354/34) (resumen del buscador)
- **Kensrud & Smith (2018), bolas deportivas sólidas:** 26–134 m/s y hasta 3900 rpm; lift y drag suben con el spin. — [Semantic Scholar](https://www.semanticscholar.org/paper/Drag-and-lift-measurements-of-solid-sports-balls-in-Kensrud-Smith/bef5bcdee5ee9da3d1b54652991179fd9eec3ecc)

#### USGA Indoor Test Range: patente US 6,186,002 B1 (Lieberman, Smits, Quintavalla y otros)
- **Formas de regresión**, con Re en unidades de 10⁵ y SR = ωR/V:
  ```
  C_D = A + B·SR² + C·Re + D·SR
  C_L = A + B·SR + C·Re⁻² + D·SR²
  ```
- **Coeficientes de la bola de ejemplo ("model 3"):**
  - C_L: A = 0.0860, B = 0.6463, C = −0.0122, D = 1.4789 (R² = 0.9946);
  - C_D: A = 0.2028, B = 2.8466, C = 0.0165, D = −0.2159 (R² = 0.9847).
- **Datos:** 42 tiros, con Re 8.1×10⁴–2.0×10⁵ y SR 0.042–0.22. La velocidad mínima del ensayo es 100 ft/s.
- **Límite declarado en el texto:** "Some balls exhibit a phenomenon at low speeds and spin rates called 'negative lift' … The above equations are not adequate to model that behavior."
- **Spin en su programa de trayectoria:** SRD = −0.00002.

— [US6186002B1](https://patents.google.com/patent/US6186002B1/en), leído en primaria por las [notas aero-data de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md.notes.md)

#### Patentes de Bridgestone (US 7,175,542; 7,238,121; 7,201,671; 8,021,249)
- **Condiciones:** bola lanzada a Re 7×10⁴ y 8×10⁴ con 2000 rpm, y a 1.8×10⁵ con 2520 rpm.
- **Pérdida de lift:** C_L(70k)/C_L(80k) = 65–85% en 12 diseños de hoyuelo, con mediana ≈ 82%. Una ley que dependa solo de S daría ≈ 106%.
- **Valores absolutos:**
  - a Re 70k y S ≈ 0.18: C_L 0.154–0.191 y C_D 0.228–0.233;
  - a Re 180k y S ≈ 0.088: C_L 0.163–0.173.

— [US7238121B2](https://patents.google.com/patent/US7238121B2/en) vía [aero-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md)

#### Aoki et al.
- **Aoki, Muto & Okanaga (2011)**, Trans. JSME B 77(775):793–802: esfera con hoyuelos del tamaño de una bola, girando hasta S = 2.0, a Re 4×10⁴–1.3×10⁵.
  - Arrastre: a Re 8×10⁴ y 1.3×10⁵, entre S 0.36 y 1.0, queda entre −0.023 y +0.014 de la ley moderna de tmelevation.
  - Sustentación: 0.010–0.045 más baja.
  - Sobre S = 1.0 el C_D sigue subiendo, pero allí solo se midió a Re ≤ 5×10⁴.

  — [doi:10.1299/kikaib.77.793](https://doi.org/10.1299/kikaib.77.793) vía la [página de métodos de tmelevation](https://jhoblitt.github.io/tmelevation/methods.html)
- **Aoki, Muto & Okanaga (2010)**, Procedia Eng. 2:2431 (328 hoyuelos): no se leyó en ninguna de las fuentes. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)

#### CFD y LES
- **Li, Tsubokura & Tsunoda (2017), bola girando a S = 0.1:**

  | Re | C_D | C_L |
  |---|---|---|
  | 4.3×10⁴ | 0.506 | +0.150 |
  | 7.5×10⁴ | 0.317 | −0.137 |
  | 1.1×10⁵ | 0.240 | +0.135 |

  — [PMC6044256](https://pmc.ncbi.nlm.nih.gov/articles/PMC6044256)
- **Li (2016), tesis, sin spin:** C_D ≈ 0.49 a 4.3×10⁴, 0.39 a 7.5×10⁴ y 0.22 a 1.1×10⁵. La posición de la crisis depende de la profundidad del hoyuelo. — [tesis de Li, Hokkaido](https://eprints.lib.hokudai.ac.jp/repo/huscap/all/62487/Jing_Li.pdf)
- **Crabill et al. (2019):** a S = 0.15 y Re = 1.5×10⁵, C_L ≈ 0.16 y C_D unos 5% sobre el valor estático. — [arXiv:1806.00378](https://arxiv.org/abs/1806.00378)

#### Ajuste a bolas modernas de tmelevation (octubre 2026)
- **Leyes:**
  ```
  C_L0(S) = 2.475·S                       S < 0.04
          = 0.065 + 0.85·S                 0.04 ≤ S ≤ 0.30
          = min(0.45, 0.32 + 0.25·(S − 0.30))   S > 0.30
  C_D0(S) = 0.22 − 0.27·S + 3.0·S²         S ≤ 0.22
          = C_D0(0.22) + 0.38·(min(S,0.64) − 0.22)   S > 0.22
  C_D = C_D0(S) + 1.35e-7·(max(Re, 1e5) − 1.5e5)
  ```
- **Ajuste:** mínimos cuadrados con rms 0.020 en C_D y 0.024 en C_L, sobre 81 puntos de bolas modernas a Re ≥ 7.5×10⁴ (ITR de la USGA, Bridgestone y Lyu 2018/2020).
- **Validez:** Re ≥ 7.5×10⁴. Ninguna bola moderna se ha medido sobre S ≈ 0.36; por encima, la forma es la de Bearman & Harvey.
- **Término de Re:** entre el +0.011 por 10⁵ de Bearman & Harvey y el +0.0165 de la bola del ITR.

— [métodos](https://jhoblitt.github.io/tmelevation/methods.html); [flight.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/flight.js); [aero-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md)
- **Pérdida de sustentación a bajo Re (forma propuesta):** f_L = 1 − a·w(Re), con w un escalón suave entre Re_hi ≈ 7.5×10⁴ (7.0–8.0×10⁴) y Re_lo ≈ 6.2×10⁴ (5.5–6.5×10⁴) y a ≈ 0.8–1.0 (medido 0.4–1.3).
  - Re 7.5×10⁴ equivale a ≈ 27.5 m/s a 25 °C al nivel del mar.
  - El autor da confianza media a la existencia y posición de la pérdida, y baja a su forma exacta.

  — [aero-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md)
- **Base de datos compilada:** `aero-data.csv` tiene 302 filas con Re, S, C_D, C_L, método e incertidumbre. Mezcla:
  - Lyu 2020 (figs. 3, 4, 5 y 7a, extraídas de los vectores del PDF);
  - Lyu 2018;
  - las 42 filas exactas del ITR de la USGA;
  - Bridgestone;
  - Bearman & Harvey, vía Kensrud y Crabill;
  - Aoki, vía Crabill.

  — [aero-data.csv](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.csv)

#### Modelo por defecto de libgolf (cita "Washington State University study by Bin Lyu, et al.")
- **Arrastre:** C_D = 0.500 + 0.18·S con Re ≤ 0.5×10⁵, lineal hasta 0.200 + 0.18·S con Re ≥ 1.0×10⁵.
- **Sustentación:**
  - C_L = 0 bajo Re 3×10⁴;
  - rampa suave hasta Re 5×10⁴;
  - entre Re 5×10⁴ y 7×10⁴, polinomios por tramo ("Bearman dimpled-sphere fits"):
    - 50k: 0.0472121 + 2.84795·S − 23.4342·S² + 45.4849·S³;
    - 60k: 0.320524 − 4.7032·S + 14.0613·S²;
    - 65k: 0.266667 − 4.0·S + 13.3333·S²;
    - 70k: 0.0496189 + 0.00211396·S + 2.34201·S²;
  - sobre 7×10⁴, saturación de Hill: C_L = ClMax(S)·16S/(1 + 16S), con ClMax pasando de 0.268 a 0.320 entre S 0.35 y 0.50.

— [DefaultAerodynamicModel.hpp](https://github.com/gdifiore/libgolf/blob/main/include/DefaultAerodynamicModel.hpp)

#### golfsim (Python, 2025): ejemplo de procedencia confusa
- **Sus fórmulas:**
  - C_L = 1.99S − 3.25S² para la bola con hoyuelos;
  - C_D = 0.2S + 0.29 con Re > 170,000 y 0.2S + 0.28 entre 150,000 y 170,000;
  - debajo, los polinomios de Re² de Lyu.
- **Atribución:** el README las atribuye a Smits & Smith (1994) y a Muto et al. (2012), pero los polinomios coinciden con los ajustes de Lyu 2018 para la bola KK.
- **Bola lisa:** C_L = 8.833S² − 3.017S (Re > 2×10⁵) y C_D = min(−0.1158(Re/10⁵)² + 0.0131(Re/10⁵) + 0.7408, 0.48).

— [golfsim README](https://github.com/avrybrdly93/golfsim/blob/main/README.md)

#### Penner, MacDonald & Hanzely y Jorgensen
- **Penner (2001)** no da fórmula cerrada: interpola datos de Bearman & Harvey con hoyuelo hexagonal. Penner (2003) no se verificó. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)
- **MacDonald & Hanzely (1991)**, Am. J. Phys. 59:213, usaron coeficientes de Bearman & Harvey para hallar el ángulo de lanzamiento óptimo, según Penner (2001). El artículo es cerrado y no se leyó. — [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md)
- **Jorgensen**, *The Physics of Golf* (libro): no se verificó. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)

### Inferences
- **Comparación de los modelos a Re = 1.5×10⁵,** calculada con las fórmulas citadas arriba:

| S | 0.05 | 0.08 | 0.10 | 0.15 | 0.20 | 0.25 | 0.30 |
|---|---|---|---|---|---|---|---|
| C_L Smits & Smith | 0.163 | 0.197 | 0.215 | 0.253 | 0.284 | 0.310 | 0.334 |
| C_L Lyu 2018 (KK) | 0.091 | 0.138 | 0.167 | 0.225 | 0.268 | 0.294 | 0.304 |
| C_L ITR USGA (ejemplo) | 0.117 | 0.142 | 0.160 | 0.211 | 0.269 | 0.335 | 0.408 |
| C_L tmelevation | 0.108 | 0.133 | 0.150 | 0.193 | 0.235 | 0.277 | 0.320 |
| C_L libgolf (Hill) | 0.119 | 0.150 | 0.165 | 0.189 | 0.204 | 0.214 | 0.222 |
| C_D Smits & Smith (con sin(Re)) | 0.298 | 0.303 | 0.307 | 0.316 | 0.325 | 0.334 | 0.343 |
| C_D Lyu 2018 (KK, sin S) | 0.180 | 0.180 | 0.180 | 0.180 | 0.180 | 0.180 | 0.180 |
| C_D ITR USGA (ejemplo) | 0.224 | 0.228 | 0.234 | 0.259 | 0.298 | 0.351 | 0.419 |
| C_D tmelevation | 0.214 | 0.218 | 0.223 | 0.247 | 0.286 | 0.317 | 0.336 |
| C_D libgolf | 0.209 | 0.214 | 0.218 | 0.227 | 0.236 | 0.245 | 0.254 |

  - A S de driver, el C_D de Smits & Smith con su término sin(Re) queda unos 0.08 sobre las mediciones modernas. Eso explica que sin calibrar acorte el driver ~10%.
  - A S ≥ 0.25 los modelos se separan mucho. El ITR extrapolado fuera de su rango sube demasiado, y libgolf satura pronto.
- **Diferencias entre tipos de bola:**
  - Las bolas modernas de tour (multicapa, cubierta de uretano) tienen la crisis de arrastre y el Magnus inverso a Re 6–7.5×10⁴. La bola de 1976 los tenía cerca de 4×10⁴.
  - La forma del hoyuelo (circular o hexagonal) cambia la magnitud del Magnus inverso.
  - La dispersión entre modelos de bola (±0.02) equivale a ~18 m de carry en un drive.

  Un launch monitor DIY que no sepa qué bola se usa tiene una incertidumbre irreducible de varios por ciento en carry, salvo que se calibre con la bola habitual del usuario.
- **Recomendación para el simulador:** usar las leyes modernas de tmelevation, que dependen de S y tienen un término débil de Re, y calibrarlas por palo contra TrackMan. Agregar como opción la pérdida de lift bajo Re 7.5×10⁴. Es la parte más incierta, y pesa más en hierros, wedges y en altura.

### Gaps
- No se leyeron en primaria: el capítulo de Smits & Smith, Bearman & Harvey (1976), Penner (2003), MacDonald & Hanzely (1991), el libro de Jorgensen ni Aoki (2010).
- Los coeficientes de Lyu 2018 vienen de las anotaciones de sus figuras.
- Los coeficientes del modelo general de la USGA (Quintavalla 2002, *Science and Golf IV*, cap. 30) no son públicos.
- No hay datos modernos para S > 0.36, para Re < 4.5×10⁴ ni para bola mojada.
- No existe una biblioteca pública de coeficientes por modelo comercial (Pro V1, Chrome Soft, etc.).
- No se revisó la investigación de 2021–2026 más allá de lo citado: Moriyama & Okanaga (2023), Kim & Choi (2014) y un preprint de 2026 sobre optimización bayesiana de hoyuelos ([arXiv 2608.12826](https://arxiv.org/pdf/2608.12826)) aparecieron en búsquedas pero no se leyeron.

## 3. Modelos de decaimiento del spin y tasas típicas

### Takeaway
El estándar es dω/dt = −λ·V·ω/R:
- λ = 2.0×10⁻⁵ según Smits & Smith, usado por Penner (2001) en su ec. 16, por el programa de trayectoria del ITR de la USGA y por libgolf;
- λ = 2.5×10⁻⁵ según el radar de Tavares et al. (1999);
- en ambos casos λ ∝ ρ.

Equivale a τ ≈ 24 s a 100 mph y a unos 2–7 %/s según la velocidad. Un drive aterriza con ~75–85% del spin inicial. El radar de TrackMan midió en una Pro V1x ≈ −75 rpm/s en promedio, en o por debajo de la ley de Smits. La elección del modelo de decaimiento mueve poco el carry.

### Cited Findings
- **Smits & Smith:** SRD = (dω/dt)·R²/v² = −λ·S, con λ = 2.0×10⁻⁵, de modo que:
  - dω/dt = −λ·v·ω/R;
  - ω(t) = ω0·exp(−∫λv/R dt);
  - τ = R/(λv) = 23.8 s a 44.7 m/s (100 mph).
- **Tavares:** λ = 2.5×10⁻⁵ y τ = 19.1 s.
- **Forma de torque:** I·dω/dt = −R·ρ·A·C_M·v², con C_M = β·S e I = 0.4·M·R². Da λ = β·π·R³·ρ/(M·α), con β = 0.010 (Smits) o 0.012 (Tavares) a ρ = 1.18 kg/m³. De ahí λ ∝ ρ.

— [Nathan, "The Spin Decay of a Baseball"](https://baseball.physics.illinois.edu/spindown-rev1.pdf), de segunda mano para golf, vía [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md)
- **En mph:** dω/dt = −4.0×10⁻⁶·v²·S/R² según Smits (con v en mph y R en m, ω en rad/s) y −5.0×10⁻⁶ según Tavares. Es equivalente a 2.0×10⁻⁵ en SI, porque 2.0×10⁻⁵ × 0.44704² ≈ 4.0×10⁻⁶. — [US 11,230,375 B1](https://patents.google.com/patent/US11230375B1/en) vía [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md); [resumen del buscador](https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/11712637)
- **Penner (2001), ec. 16:** α = dω/dt = −(0.00002)·(ω·v/r).
  - En túnel el decaimiento es casi exponencial.
  - Un drive aterriza con ≈ 75% del spin inicial.
  - SRD no depende de Re a S fijo para Re 1.0–2.5×10⁵, según Smits.

  — [Penner 2001](https://doi.org/10.1119/1.1344164) vía [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md)
- **TrackMan Newsletter #7:** "4% per second". Lyu et al. (2018) lo citan como el decaimiento de su simulación; el boletín original no se encontró. — [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md)
- **Tutelman (2016):** pérdida de ≈ 3.3–4 %/s, con el 4% tomado del boletín TrackMan de 2010. En unos 6 s de vuelo de un drive de tour, el spin baja a ≈ 78–82% del inicial. — [Tutelman, Spin Decay](https://www.tutelman.com/golf/ballflight/spinDecay.php)
- **Radar TrackMan en una patente de Acushnet (US 7,591,742 B2):** pendientes de spin contra tiempo en drives de un golfista experto. Las unidades no se indican; probablemente rpm/s.

  | Bola | Primeros 0.4 s | Vuelo completo |
  |---|---|---|
  | Titleist Professional (bobinada) | −186.83 | −87.304 |
  | Tour Balata (bobinada) | −340.18 | −131.15 |
  | Pro V1x (sólida) | −65.108 | −75.11 |

  — [US7591742B2](https://patents.google.com/patent/US7591742B2/en) vía [notas aero-data](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md.notes.md)
- **Implementaciones:**
  - libgolf: τ = 1/(TAU_COEFF·|v|/r), con TAU_COEFF = 0.00002 — [DefaultAerodynamicModel.hpp](https://github.com/gdifiore/libgolf/blob/main/include/DefaultAerodynamicModel.hpp);
  - golfsim: τ = 25 s fijo — [simulation.py](https://github.com/avrybrdly93/golfsim/blob/main/simulation.py);
  - programa del ITR de la USGA: SRD = −0.00002 — [US6186002B1](https://patents.google.com/patent/US6186002B1/en).
- **Sensibilidad:** cambiar el modelo de decaimiento (ninguno, λ fijo, λ ∝ ρ, Tavares o 4 %/s de TrackMan) mueve la ganancia de carry del driver a 10,000 ft en ≤ 1.6 yd, y la de los hierros en ≤ 0.7 yd. Solo el escalado con ρ vale de +0.7 a +1.6 yd. — [tmelevation aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)
- **En altura:** Titleist dice que el spin no se reduce pero el lift sí. — [tmelevation reference-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/reference-data.md)

### Inferences
- **Tasa instantánea de la ley de Smits, λV/R, al nivel del mar** (calculada):

  | V (m/s) | Tasa | τ |
  |---|---|---|
  | 20 | 1.9 %/s | 53 s |
  | 30 | 2.8 %/s | 36 s |
  | 45 | 4.2 %/s | 24 s |
  | 60 | 5.6 %/s | 18 s |
  | 75 | 7.0 %/s | 14 s |

  El promedio de un vuelo, ~4 %/s, coincide con la cifra de TrackMan.
- **Spin al aterrizar**, con mi reimplementación calibrada a la tabla TrackMan 2023 y λ ∝ ρ:

  | Tiro | Spin al aterrizar | Vuelo |
  |---|---|---|
  | Driver PGA | 0.78 del inicial | 7.1 s |
  | Hierro 7 PGA | 0.85 | 6.5 s |
  | PW PGA | 0.87 | 5.9 s |

- **Consecuencia para el DIY:** basta medir el spin en el lanzamiento y aplicar la ley. El error por usar 2.0 o 2.5×10⁻⁵ es menor que el de los coeficientes de lift y drag.

### Gaps
- No se encontró el boletín TrackMan #7 original ni un conjunto revisado por pares de decaimiento con bolas modernas.
- Tampoco hay mediciones públicas del decaimiento a S alto (wedges).

## 4. Densidad del aire (altitud, temperatura, presión, humedad) y efecto en el carry; Bogotá y Medellín

### Takeaway
Se calcula la presión de estación con la Atmósfera Estándar de EE. UU. de 1976 o, mejor, con un barómetro, y la densidad con gas ideal más el término de vapor (CIPM-2007 o presiones parciales).

| | Bogotá (~2,600 m) | Medellín (~1,500 m) |
|---|---|---|
| Presión estándar | ≈ 738 hPa | ≈ 846 hPa |
| Densidad | ≈ 0.87–0.91 kg/m³ | ≈ 0.99 kg/m³ |
| Fracción del aire a 25 °C y nivel del mar | 73–77% | ≈ 84% |
| Regla de Titleist (1.16% por 1,000 ft) | +9.9% | +5.7% |
| TrackMan, según Golf Digest | — | ≈ 6% a 1,500 m |

- Los drivers de tour medidos en altura ganaron entre +5.7% (a 2,361 m) y +9.5% (a 1,900 m).
- Los hierros medios ganan más (curva en campana) y los swings lentos, menos.

### Cited Findings
- **Presión con la Atmósfera Estándar de EE. UU. de 1976:**
  ```
  H = r0·Z/(r0 + Z),  r0 = 6 356 766 m
  P = 101325·(1 − 2.25577×10⁻⁵·H)^5.255876  Pa
  ```
  Constantes: T0 = 288.15 K, L = 0.0065 K/m, g0 = 9.80665 m/s², M = 28.9644 kg/kmol, R* = 8314.32 J/(kmol·K). — [tmelevation métodos](https://jhoblitt.github.io/tmelevation/methods.html), con la [USSA 1976 (NASA NTRS)](https://ntrs.nasa.gov/api/citations/19770009539/downloads/19770009539.pdf)
- **Aire seco:** ρ = P·M0/(R*·T), con R = 287.0531 J/(kg·K); da 1.2250 kg/m³ a 101325 Pa y 15 °C. — [tmelevation atmosphere.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/atmosphere.md)
- **Aire húmedo, CIPM-2007** (Picard et al., *Metrologia* 45:149):
  ```
  ρ = (p·Ma/(Z·R·T))·[1 − x_v·(1 − Mv/Ma)]
  R = 8.314472, Ma = 28.96546e-3, Mv = 18.01528e-3 kg/mol,  1 − Mv/Ma = 0.3780
  x_v = h·f·p_sv/p
  p_sv = exp(A·T² + B·T + C + D/T) Pa,
         A = 1.2378847e-5, B = −1.9121316e-2, C = 33.93711047, D = −6.3431645e3
  f = 1.00062 + 3.14e-8·p + 5.6e-7·t²   (t en °C)
  ```
  - Z ≈ 0.9996 y mueve la densidad en ≈ 0.04%.
  - Validez declarada: 600–1100 hPa y 15–27 °C.
  - **Equivalente simple:** ρ = (p − p_v)/(R_d·T) + p_v/(R_v·T), con p_v = h·p_sv(T), R_d = 287.05 y R_v = 461.5 J/(kg·K). Queda a ≤ 0.06% del CIPM completo entre 0 y 40 °C con 50% de humedad relativa.

  — [CIPM-2007, copia del NIST](https://www.nist.gov/sites/default/files/documents/calibrations/CIPM-2007.pdf) vía [atmosphere.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/atmosphere.md)
- **Cuánto pesa la humedad:** pasar de aire seco a húmedo baja la densidad. Para comparar, +1 °C la baja ≈ 0.35%.

  | Condición | 50% HR | 100% HR |
  |---|---|---|
  | Nivel del mar, 15 °C | −0.32% | −0.63% |
  | Nivel del mar, 25 °C | −0.59% | −1.18% |
  | 1,609 m, 25 °C | −0.72% | −1.43% |

  — [atmosphere.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/atmosphere.md)
- **Viscosidad (Sutherland):** μ = β·T^1.5/(T + S), con β = 1.458×10⁻⁶ y S = 110.4 K. Da μ(15 °C) = 1.7894×10⁻⁵ Pa·s y, con la forma de referencia de 1.716×10⁻⁵ a 273.15 K, μ(25 °C) = 1.8371×10⁻⁵. — [atmosphere.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/atmosphere.md); [métodos](https://jhoblitt.github.io/tmelevation/methods.html)
- **Alternativa de Nathan y libgolf:**
  - presión: P = P0·exp(−0.0001217·z), con z en m;
  - vapor saturado (Magnus–Tetens): SVP = 4.5841·exp((18.687 − T/234.5)·T/(257.14 + T)) mmHg, con T en °C;
  - coeficiente de vapor 0.3783;
  - Sutherland con 120 K y 1.512×10⁻⁶.

  — [libgolf physics_constants.hpp](https://github.com/gdifiore/libgolf/blob/main/include/physics_constants.hpp)
- **Barómetro:** el "barométrico" de un reporte del tiempo está reducido al nivel del mar y marca ~30 inHg a cualquier altura. Se necesita la presión de estación; a 5,280 ft la atmósfera estándar da 24.64 inHg. — [métodos de tmelevation](https://jhoblitt.github.io/tmelevation/methods.html)
- **Normalización de los launch monitors comerciales:**
  - TrackMan: "Default values are 77°F and sea level", en calma y con bola "premium" — [TrackMan, Normalization feature explained (2014)](https://www.trackman.com/blog/golf/normalization-feature-explained) vía [notas reference-data](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/reference-data.md.notes.md). Su portal de jugador normaliza a 25 °C y nivel del mar — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/29414570963868-Portal-Player-How-to-De-Normalise-Dynamic-Reports).
  - FlightScope: su "Environmental Optimizer" pide temperatura, altitud, humedad y viento.
  - Rapsodo MLM: asume nivel del mar.
  - Foresight GCQuad: usa su barómetro interno.

  — [atmosphere.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/atmosphere.md)
- **Regla de Titleist (Steve Aoyama, Acushnet):** "multiplying the elevation (in feet) by .00116", es decir 1.16% por cada 1,000 ft, lineal.
  - A 5,280 ft da ≈ 6%: un drive de 250 yd va a 265.
  - A 5,000 ft la densidad es ≈ 14% menor, así que la curva de un hook o un slice es ≈ 14% menor.
  - Es "less for players with slower swing speeds".

  — [GolfWRX (citas literales)](https://golfwrx.com/545618/tiger-woods-lofting-up-for-thin-air-examining-the-switch-and-what-happens-when-you-play-at-altitude/); [Titleist Learning Lab (archivo)](http://web.archive.org/web/20260509230837/https://www.titleist.com/learning-lab/performance/altitude-and-golf-ball-flight); [The Left Rough](https://theleftrough.com/how-much-does-elevation-affect-golf-distance/); [Calcipedia](https://www.calcipedia.org/calculators/golf-altitude-adjustment-calculator/)
- **Otras reglas:**
  - "2% por cada 1,000 ft": no tiene origen rastreable;
  - "1.1–1.6%": MyGolfSpy, sin citas;
  - "1.7%": Golf Monthly, sin citas;
  - "2.5 yd por cada 1,000 ft" en driver: un estudio TrackMan citado por GOLF.com que contradice otra cifra del mismo medio.

  — [tmelevation reference-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/reference-data.md); [GraphCalc](https://www.graphcalc.com/golf-altitude-adjustment-calculator/)
- **TrackMan, modelo de Justin Padjen para un profesional promedio a 7,800 ft** (2017, citado por la PGA TOUR; club a 113 mph):

  | Trayectoria | Lanz. | Carry (yd) | Ápice (ft) | Ángulo de caída | Velocidad al caer |
  |---|---|---|---|---|---|
  | Alta, nivel del mar | 10.7° | 282 | 102 | 38° | 65 mph |
  | Alta, 7,800 ft | 10.7° | 306 (+8.5%) | 84 (−18%) | 29° | 75 mph |
  | Baja, nivel del mar | 8.9° | 277 | 76 | 31° | 67 mph |
  | Baja, 7,800 ft | 8.9° | 288 (+4.0%) | 60 | 22° | 81 mph |

  - En toda la bolsa, los jugadores de trayectoria alta ganan "8 to 15 percent" según el palo, y los de bola baja "4-12 percent".
  - Padjen describe la ganancia como "más bien una campana": los wedges y los hierros largos ganan menos.

  — [PGA TOUR 2017](https://www.pgatour.com/article/news/long-form/2017/02/28/elevated-expectations-wgc-mexico-championship-altitude) vía [reference-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/reference-data.md)
- **TrackMan Support, simulador:** a "2100m or 7000ft", "the ball will travel roughly 10% further in the air than at sea level". — [TrackMan Support, VG Altitude in Course Play (2026-06-15)](https://support.trackmangolf.com/hc/en-us/articles/51714287935387-VG-Altitude-in-Course-Play)
- **"According to Trackman" (Golf Digest, 2025):**
  - "6 percent distance boost … at 1,500 metres";
  - 150 m pasan a ≈ 159 m;
  - los swings rápidos ganan cerca de 10% y los lentos cerca de 5%;
  - la mayor ganancia es en hierros medios y largos.

  — [Australian Golf Digest](https://www.australiangolfdigest.com.au/pro-golfers-calculate-their-yardages-golf-course-strategy-game-plan-golf-digest/)
- **Crans-Montana (1,500 m), Marco Penge:** 7.5% en los hierros 6 a 9 y 5% en el resto; su hierro 8 pasa de 180 a 190 yd. — [DP World Tour, 2026-09-02](https://app.europeantour.com/dpworld-tour/news/articles/detail/a-numbers-game-players-tackle-altitude-at-omega-european-masters/)
- **Castle Pines 2024 (~6,400 ft), hierro 7:**
  - Scheffler pasó de 184 a 206 yd (+12.0%) y McIlroy de 195 a 222 yd (+13.8%);
  - Harrison Shih, de TrackMan: los más afectados son los hierros 6 a 9.

  — [TaylorMade](https://taylormadegolf.fr/clubhouse/801423-seen-on-tour-scottie-rory-collin-tommy-prepare-for-altitude-at-the-bmw-championship.html?lang=fr_FR); [PGA TOUR 2024](https://pgatour.com/article/news/latest/2024/08/21/altitude-adjustment-colorado-castle-pines-golf-club-elevation-challenge-bmw-championship)
- **Drivers de tour medidos (radar TrackMan de la PGA TOUR):** cada jugador se comparó contra su propia temporada; el análisis es del autor de tmelevation.

  | Sede (año) | Altitud | ρ/ρ(25 °C, nivel del mar) | Δ carry |
  |---|---|---|---|
  | Chapultepec (2017–2020) | 7,746 ft | ≈ 0.78 | +16 a +22 yd (+5.7% a +7.8%) |
  | Castle Pines (2024) | 6,234 ft | 0.80 | +27.5 yd (+9.5%); ápice −10.5% |
  | Old Greenwood (2024) | 5,843 ft | 0.81 | +23.0 yd (+8.1%) |
  | Control: Vidanta | 56 ft | — | −1.1% |

  - En Chapultepec los jugadores subieron el spin entre 138 y 404 rpm y el lanzamiento entre 0.9° y 3.1°.
  - En 40 torneos cerca del nivel del mar: Δcarry = 148.8 − 150.1·ρ yd, es decir +1.5 yd por cada 1% menos de densidad (≈ +0.53% de carry por 1% de densidad).
  - Chapultepec queda 10–15 yd bajo esa recta.
  - Corregido por los cambios de lanzamiento: México +2.8% a +4.4% y Castle Pines +7.4%.

  — [altitude-evidence.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/altitude-evidence.md)
- **Arccos 2026 (GPS, distancia total, sin normalizar):** un hándicap 10 promedia 220.5 yd al nivel del mar y 239.7 yd a 5,000 ft o más, +19.2 yd. El informe dice ≈ 8.3%; el cociente da 8.7%. — [Arccos Driving Distance Report 2026](https://uploads.mygolfspy.com/uploads/2026/05/ArccosDrivingDistanceReport_2026Edition.pdf) vía [notas aero-data](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md.notes.md)
- **Modelo calibrado de tmelevation, con forma Smits sin término de Re y 15 °C constantes:**

  | Tiro | 5,000 ft | 10,000 ft |
  |---|---|---|
  | Driver PGA | +6.1% | +10.5% |
  | Hierro 7 PGA | +9.0% | +16.6% |
  | PW PGA | +8.5% | +15.8% |
  | Driver LPGA | +4.3% | +7.0% |

  - Con la pérdida de lift a bajo Re, las ganancias de hierros y wedges a 10,000 ft serían "3.5 % to 174 % smaller"; pasado el 100%, como en los hierros 4 a 7 LPGA, el carry bajaría con la altura.
  - Ninguna medición publicada de hierros confirma ni refuta ese recorte.

  — [aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md); [métodos](https://jhoblitt.github.io/tmelevation/methods.html)
- **Colombia (fuentes turísticas y comerciales):**
  - Bogotá (~2,600 m): "10–12%" más;
  - una tabla de Pelecanus da 9.89% para el Country Club de Bogotá, a 8,530 ft;
  - La Cima (3,000 m): ~11%;
  - "un palo menos";
  - para Medellín no se encontraron cifras.

  — [Pelecanus](https://pelecanus.com.co/en/playing-golf-extreme-altitudes-colombia/); [Revista Fairway](https://www.revistafairway.com/paises/colombia/bogota-una-ciudad-para-descubrir-a-pie-y-jugar-golf-sobre-los-3-000-metros/); [Play Golf Bogota](https://playgolfbogota.com/complete-guide-golf-bogota/) (todo según el resumen del buscador)

### Inferences
- **Densidad calculada** con USSA 1976 y la fórmula de presiones parciales con p_sv del CIPM. Las temperaturas y humedades son supuestos ilustrativos, no normales climáticas verificadas.

  | Condición | p (hPa) | ρ (kg/m³) | ρ/1.1839 (25 °C, nivel del mar) | ρ/1.225 (ISA) |
  |---|---|---|---|---|
  | Medellín 1,500 m, 22 °C, 65% HR | 845.6 | 0.990 | 0.837 | 0.808 |
  | Bogotá 2,600 m, 14 °C, 75% HR | 737.6 | 0.889 | 0.751 | 0.726 |
  | Bogotá 2,600 m, 20 °C, 50% HR | 737.6 | 0.871 | 0.736 | 0.711 |
  | Bogotá 2,600 m, 8 °C, 85% HR | 737.6 | 0.910 | 0.768 | 0.743 |

- **Reglas simples:**
  - Medellín: 1,500 m = 4,921 ft, así que la regla de Aoyama da +5.7%.
  - Bogotá: 2,600 m = 8,530 ft, así que da +9.9%. El 9.89% de Pelecanus para el Country Club de Bogotá coincide exactamente: Pelecanus parece aplicar la regla de Titleist.
- **Física (mi reimplementación de las leyes modernas de tmelevation):** cada fila se calibró (kD, kL) a la tabla TrackMan 2023 a 25 °C y nivel del mar, y luego se voló con la densidad local. No incluye la pérdida de lift a bajo Re.

  | Fila TrackMan 2023 | Medellín 22 °C, 65% HR | Bogotá 14 °C, 75% HR |
  |---|---|---|
  | Driver PGA | +19.8 yd (+7.0%) | +28.8 yd (+10.2%); ápice −5.2 yd; caída −8.4° |
  | Hierro 7 PGA | +15.8 yd (+9.0%) | +24.5 yd (+13.9%) |
  | PW PGA | +11.4 yd (+8.0%) | +17.5 yd (+12.3%) |
  | Driver LPGA (≈ velocidad de un amateur promedio) | +11.2 yd (+5.0%) | +15.7 yd (+7.0%) |
  | Hierro 7 LPGA | +10.5 yd (+7.3%) | +15.9 yd (+11.1%) |

  Para Bogotá probablemente es un **límite superior**: los drivers medidos en Chapultepec, a 2,361 m y ρ ≈ 0.78, ganaron menos que la recta de densidad.
- **Rango razonable para planificar**, del modelo, las reglas y las mediciones:

  | | Bogotá | Medellín |
  |---|---|---|
  | Driver | +6% a +10% (los swings lentos, en la parte baja) | +5% a +7% |
  | Hierros medios | +10% a +14% | +7% a +9% |

- **Temperatura y humedad:**
  - Una variación diaria de ±10 °C cambia la densidad en ~±3.5%, que serían ~±1.5–2% de carry si se usa la elasticidad medida de ~0.5.
  - La humedad cambia la densidad en ≤ 1–2%.
- **Diseño del DIY:**
  - Conviene un sensor barométrico de presión absoluta junto con la temperatura y la humedad, en lugar de la altitud o la presión de una app del tiempo.
  - El modelo debe recibir ρ y μ, no solo la "altitud".
  - Para comparar con TrackMan, hay que normalizar a 25 °C y nivel del mar.

### Gaps
- No obtuve normales climáticas citables (temperatura, humedad, presión de estación) ni altitudes exactas de los campos de Bogotá y Medellín: el cupo de búsqueda se agotó. Los 2,600 m y 1,500 m son los del encargo.
- No existen mediciones publicadas de carry en hierros a ninguna altura, ni de ningún palo por encima de 7,746 ft (2,361 m). Bogotá, con ~8,530 ft, queda fuera de todo dato medido.
- No se verificó el coeficiente de elevación "0.00427" del informe USGA *Golf Course Effects on Hitting Distance* (2023).

## 5. Bote y rodado (Penner "The run of a golf ball"; restitución y fricción; estimaciones empíricas)

### Takeaway
No hay un modelo físico de bote confiable: un estudio de 2023 sobre greens concluye que "a reliable physics-based model of golf-ball bounce is still lacking".
- **Penner** trata el césped compliante como una superficie rígida inclinada un ángulo efectivo θc. Ese ángulo crece linealmente con la velocidad y el ángulo de llegada; usa fricción cinética μ = 0.25 en su ejemplo y una restitución que depende de la velocidad.
- **Datos de rodado en green:** una razón ρ/R de 0.065–0.196 (promedio 0.131) en Penner, y un coeficiente de 0.05–0.1 en Roh & Lee.
- **Para un DIY**, lo práctico es reportar el carry, que es robusto, y tratar el rodado como un ajuste empírico por superficie.

### Cited Findings
- **Penner, "The run of a golf ball"** (Can. J. Phys., desde la p. 931):
  - la bola rebota contra una superficie rígida inclinada el ángulo crítico θc, dado por una fórmula empírica lineal en el ángulo y la velocidad de llegada;
  - define un coeficiente crítico de fricción cinética μc para que la bola quede rodando;
  - ejemplo con velocidad de impacto de 18.6 m/s sobre un green típico;
  - μ = 0.25.

  — [ResearchGate](https://www.researchgate.net/publication/237196163_The_run_of_a_golf_ball); [PDF alojado](http://waddengolfacademy.com/putting/Penner_The%20Run%20of%20a%20Golf%20Ball.pdf); [arXiv 2208.11685](https://arxiv.org/pdf/2208.11685) (resúmenes del buscador)
- **Penner (2001), Am. J. Phys.:** calculó bote, rodado y recorrido total. El ajuste paramétrico del modelo de recorrido con los datos de Williams da un comportamiento general razonable. — [arXiv 2208.11685](https://arxiv.org/pdf/2208.11685); [Springer 2023](https://link.springer.com/article/10.1007/s12283-023-00442-4) (resúmenes del buscador; no sé con certeza cuál de los dos lo dice)
- **Penner, "The physics of putting"**: el sitio de Rod Cross cita a Penner en Can. J. Phys. vol. 80 (2002), pp. 83–96, sobre la pendiente del green. Que sea este título es una inferencia mía.
  - la razón de rodado en greens ρg (ρ/R) va de 0.065 a 0.196, con promedio 0.131;
  - en una pendiente de 5° hacia abajo el valor crítico es 0.087 (= tan 5°);
  - es un desplazamiento relativo, no un coeficiente de fricción de rodado estándar.

  — [ResearchGate](https://www.researchgate.net/publication/237196126_The_physics_of_putting); [Rod Cross, Physics of Golf](https://www.physics.sydney.edu.au/~cross/GOLF/GOLF.htm)
- **Roh & Lee (2010)**, "Golf ball landing, bounce and roll on turf", Procedia Eng. 2:3237–3242:
  - el impacto con césped compliante equivale a uno con una superficie rígida inclinada (análisis de Daish);
  - con hierros de mucho loft y backspin, en greens firmes la bola puede botar hacia adelante y luego retroceder;
  - la resistencia al rodado viene de la compresión del green delante de la bola;
  - el coeficiente de fricción de rodado en green va de 0.05 a 0.1.

  — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1877705810003929); [CyberLeninka](https://cyberleninka.org/article/n/277443)
- **Biber, Jones, Champneys, Green & Szalai (2023)**, Sports Engineering: midieron botes en un green y ajustaron restitución, fricción y el ángulo efectivo de Penner.
  - Una relación lineal a tramos, no física, entre llegada y salida ajusta mejor que los modelos rígidos con fricción, incluido el de Penner, y distingue los botes en deslizamiento puro de los que ruedan.
  - Un ángulo constante β ajusta mejor que la fórmula de Penner.
  - Incluso las bolas que ruedan salen deslizando, tras invertir el spin.

  — [arXiv 2302.02758](https://arxiv.org/pdf/2302.02758); [Universidad de Bristol](https://research-information.bris.ac.uk/en/publications/measurements-and-linearized-models-for-golf-ball-bounce-on-a-gree/)
- **Otros datos de bote:**
  - Haake presentó el mayor conjunto público de datos de bote de bolas de golf;
  - el césped puede modelarse con una restitución que depende de la velocidad.

  — [arXiv 2208.11685](https://arxiv.org/pdf/2208.11685) (resumen del buscador)
- **Rod Cross:** la baja restitución horizontal de la bola de golf no se explica solo por su bajo coeficiente de fricción. — [Cross, Grip-slip behavior of a bouncing ball](https://www.physics.usyd.edu.au/~cross/PUBLICATIONS/GripSlip.pdf)
- **Modelo por defecto de libgolf:**
  - componente normal: v_n' = −COR_ef·v_n, con la restitución reducida según spin y velocidad normal (tomado de OpenFairway, `BounceCalculator.cs`);
  - impacto rasante o débil: v_t' = factor·v_t, con factor = 1 − μ_static·(1 − firmeza);
  - impacto empinado (≥ θc = 15°, según libgolf "matches Penner (2003)") y enérgico (≥ 20 m/s): v_t' = retención·|v|·sin(θ − θc) − 2·r·ω_back/7, con retención = 0.55·clamp(1 − rpm/8000, 0.40, 1);
  - rodado con fricción de Coulomb (μ_dyn); se detiene bajo 0.1 ft/s.

  — [bounce_model.md](https://github.com/gdifiore/libgolf/blob/main/docs/bounce_model.md); [DefaultBounceModel.hpp](https://github.com/gdifiore/libgolf/blob/main/include/DefaultBounceModel.hpp); [roll_model.md](https://github.com/gdifiore/libgolf/blob/main/docs/roll_model.md)
- **Valores por defecto de libgolf** (comentarios sin referencia; libgolf no da fuente para estos rangos):

  | Parámetro | Por defecto | Fairway | Rough | Green |
  |---|---|---|---|---|
  | Restitución (COR) | 0.4 | 0.4–0.5 | 0.2–0.3 | 0.3–0.4 |
  | Fricción estática | 0.5 | 0.4–0.6 (seco) | — | 0.3–0.5 |
  | Fricción dinámica | 0.2 | 0.15–0.25 | 0.4–0.6 | 0.1–0.15 |
  | Firmeza | 0.8 | — | — | — |
  | Retención de spin | 0.75 | — | — | — |

  — [ground_surface.hpp](https://github.com/gdifiore/libgolf/blob/main/include/ground_surface.hpp)
- **En altura:** la trayectoria es más plana, cae con menor ángulo y rueda más. — [Titleist Learning Lab (archivo)](http://web.archive.org/web/20260509230837/https://www.titleist.com/learning-lab/performance/altitude-and-golf-ball-flight)

### Inferences
- **Modelo empírico mínimo para un DIY:**
  1. Uno o dos botes con COR y retención tangencial dependientes del ángulo de llegada. El enfoque lineal a tramos de Biber et al. es más fiel que Penner.
  2. Rodado con desaceleración constante a = c·g, de modo que d = v²/(2·c·g). El valor c se calibra por superficie: green ~0.05–0.1 según Roh & Lee; en fairway no se halló un valor medido.
- **Qué reportar:** las tablas de TrackMan no dan distancia total. En el DIY, el carry debe ser el dato principal y el total una estimación etiquetada.
- **Procedencia dudosa:** el CSV de referencia de libgolf trae "totales" (driver PGA: carry 275 y total 295) que la tabla TrackMan citada no contiene ([shots_reference.csv](https://github.com/gdifiore/libgolf/blob/main/test/data/shots_reference.csv)).

### Gaps
- No pude leer la fórmula exacta de θc de Penner, sus coeficientes ni su ley de restitución en función de la velocidad: el PDF y ResearchGate estaban bloqueados. Solo quedan confirmados la forma lineal, μ = 0.25 y el ejemplo de 18.6 m/s.
- No se obtuvieron los valores de restitución y fricción de Haake para fairway ni green, ni los valores ajustados por Biber et al.
- No se verificó la velocidad de salida del Stimpmeter, útil para calibrar el rodado de un green con su "stimp".

## 6. Datos de validación (TrackMan PGA/LPGA, amateurs por hándicap, trayectorias publicadas)

### Takeaway
La tabla vigente que se encontró es la de **TrackMan con datos de 2023**, publicada en mayo de 2024 en "Introducing updated tour averages":
- da por palo la velocidad de cabeza, el ángulo de ataque, la velocidad de bola, el smash, el lanzamiento, el spin, la altura máxima, el ángulo de caída y el carry;
- un driver PGA: 115 mph, 171 mph, 10.4°, 2545 rpm y 282 yd; un driver LPGA: 96 mph, 143 mph, 12.6°, 2506 rpm y 223 yd;
- sigue circulando una tabla anterior (driver PGA de 113 mph, 167 mph y 275 yd), a veces mal fechada;
- no se halló una tabla más nueva antes de agotarse las búsquedas.

Otros datos útiles para validar:
- los tiros modelo de hierro 6 de TrackMan (2014), en calma y con viento;
- las corridas de Padjen en altura;
- los datos de radar de la PGA TOUR en altura;
- el ITR de la USGA;
- un CSV compilado de C_D y C_L;
- promedios amateurs del "TrackMan Combine", solo de segunda mano.

### Cited Findings
- **Tabla TrackMan "2023 Tour Averages"**, publicada en ["Introducing updated tour averages"](https://www.trackman.com/blog/introducing-updated-tour-averages). La transcripción es de [tmelevation data.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/data.js), verificada contra recortes ampliados de las imágenes ([transcripción](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/trackman-2023-tour-averages.md)).
  - Columnas: club (mph), ataque (°), bola (mph), smash, lanzamiento (°), spin (rpm), altura máxima (yd), caída (°) y carry (yd).
  - **PGA TOUR:**

    | Palo | Club | Ataque | Bola | Smash | Lanz. | Spin | Altura | Caída | Carry |
    |---|---|---|---|---|---|---|---|---|---|
    | Driver | 115 | −0.9 | 171 | 1.49 | 10.4 | 2545 | 35 | 39 | 282 |
    | Madera 3 | 110 | −2.3 | 162 | 1.47 | 9.3 | 3663 | 32 | 44 | 249 |
    | Madera 5 | 106 | −2.5 | 156 | 1.47 | 9.7 | 4322 | 33 | 48 | 236 |
    | Híbrido | 102 | −2.4 | 149 | 1.47 | 10.2 | 4587 | 31 | 49 | 231 |
    | Hierro 3 | 100 | −2.5 | 145 | 1.46 | 10.3 | 4404 | 30 | 48 | 218 |
    | Hierro 4 | 98 | −2.9 | 140 | 1.44 | 10.8 | 4782 | 31 | 49 | 209 |
    | Hierro 5 | 96 | −3.4 | 135 | 1.41 | 11.9 | 5280 | 33 | 50 | 199 |
    | Hierro 6 | 94 | −3.7 | 130 | 1.39 | 14.0 | 6204 | 32 | 50 | 188 |
    | Hierro 7 | 92 | −3.9 | 123 | 1.34 | 16.1 | 7124 | 34 | 51 | 176 |
    | Hierro 8 | 89 | −4.2 | 118 | 1.33 | 17.8 | 8078 | 33 | 51 | 164 |
    | Hierro 9 | 87 | −4.3 | 112 | 1.29 | 20.0 | 8793 | 32 | 52 | 152 |
    | PW | 84 | −4.7 | 104 | 1.24 | 23.7 | 9316 | 32 | 52 | 142 |

  - **LPGA Tour** (no tiene fila de hierro 3):

    | Palo | Club | Ataque | Bola | Smash | Lanz. | Spin | Altura | Caída | Carry |
    |---|---|---|---|---|---|---|---|---|---|
    | Driver | 96 | +2.8 | 143 | 1.49 | 12.6 | 2506 | 26 | 36 | 223 |
    | Madera 3 | 92 | −0.8 | 135 | 1.47 | 11.6 | 2595 | 25 | 38 | 200 |
    | Madera 5 | 90 | −1.6 | 130 | 1.46 | 12.3 | 4320 | 25 | 43 | 189 |
    | Híbrido | 87 | −1.9 | 125 | 1.44 | 13.9 | 4504 | 25 | 45 | 178 |
    | Hierro 4 | 82 | −1.7 | 118 | 1.43 | 13.9 | 4608 | 25 | 43 | 175 |
    | Hierro 5 | 81 | −2.0 | 114 | 1.42 | 14.6 | 4966 | 25 | 45 | 166 |
    | Hierro 6 | 80 | −2.3 | 111 | 1.41 | 16.7 | 5904 | 25 | 46 | 155 |
    | Hierro 7 | 78 | −2.5 | 106 | 1.38 | 18.5 | 6630 | 26 | 47 | 143 |
    | Hierro 8 | 76 | −2.8 | 102 | 1.36 | 20.8 | 7413 | 27 | 47 | 133 |
    | Hierro 9 | 74 | −3.2 | 95 | 1.30 | 23.5 | 7605 | 27 | 48 | 123 |
    | PW | 72 | −3.2 | 88 | 1.25 | 25.2 | 8465 | 27 | 48 | 111 |

  - Los metros se redondearon aparte: el hierro 4 PGA figura con 209 yd y 192 m.
- **Cómo se recogieron los datos:**
  - de torneos y del campo de práctica: más de 40 eventos para los hombres y más de 30 para las mujeres;
  - los hoyos de estadística se eligieron "going in opposite directions to reduce any effects from wind";
  - no se declaran altitud ni temperatura;
  - las mujeres vienen sobre todo del LPGA, con algo del LET y del campo de práctica;
  - carry, altura máxima y caída se miden respecto de la altura de lanzamiento.

  — [métodos de tmelevation](https://jhoblitt.github.io/tmelevation/methods.html); [resumen del buscador de la página de TrackMan](https://www.trackman.com/blog/golf/introducing-updated-tour-averages)
- **Fecha:** Golf Monthly incrusta un post de TrackMan del 2 de mayo de 2024 y llama a las cifras "2023 stats". Hierro 7: 176 yd con 92 mph de club y 123 mph de bola. — [Golf Monthly](https://www.golfmonthly.com/features/how-far-does-the-average-pga-tour-player-hit-his-7-iron)
- **TrackMan Support** aloja PDF de los promedios PGA y LPGA en yardas y metros. — [TrackMan Support](https://support.trackmangolf.com/hc/en-us/articles/5089752464667-Shot-Analysis-Tour-Averages-On-PGA-LPGA-Tour)
- **Tabla anterior a 2023:**
  - driver PGA de 113 mph, ataque −1.3°, 167 mph y ≈ 10.9° de lanzamiento; el spin está en una imagen que no se leyó — [GOLF.com, 2019-04-23](https://golf.com/instruction/driving/this-is-how-far-pga-and-lpga-tour-players-hit-it-with-every-club/) vía [notas reference-data](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/reference-data.md.notes.md);
  - ProYardages la presenta como "2024 season", con driver PGA de 113 mph y 275 yd y LPGA de 94 mph y 218 yd. No cuadra con la tabla 2023 — [ProYardages](https://proyardages.com/tour-averages/).
- **CSV de referencia de libgolf:** se rotula "PGA + LPGA Tour 2023 TrackMan averages", pero mezcla tablas. Su driver PGA tiene 171.5 mph, 10.4° y 2545 rpm (como 2023) con carry de 275 yd y altura de 32 yd (como la tabla anterior). Su driver LPGA tiene 140 mph, 13.2°, 2611 rpm y 218 yd. — [shots_reference.csv](https://github.com/gdifiore/libgolf/blob/main/test/data/shots_reference.csv)
- **Tiros modelo de TrackMan (2014, "Normalization feature explained"), hierro 6 PGA:** 130 mph, 14.7°, 6088 rpm y ataque −3.1°.

  | Condición | Carry | Altura | Caída |
  |---|---|---|---|
  | Calma | 184 yd | 33.8 yd | 48.0° |
  | Viento en contra 10 mph | 166 | 38.1 | 58.1° |
  | Viento en contra 20 mph | 143 | 42.8 | 69.5° |
  | Viento a favor 10 mph | 198 | 29.7 | 39.5° |
  | Viento a favor 20 mph | 207 | 26.1 | 32.7° |

  — [TrackMan 2014](https://www.trackman.com/blog/golf/normalization-feature-explained) vía [oracles.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/oracles.js)
- **Hierro 6 LPGA, en las mismas condiciones:** 110 mph, 18.6°, 5950 rpm y ataque −1.5°.

  | Condición | Carry | Altura | Caída |
  |---|---|---|---|
  | Calma | 152 yd | 27.7 yd | 45.6° |
  | Viento en contra 10 mph | 139 | 31.3 | 55.6° |
  | Viento en contra 20 mph | 121 | 35.3 | 67.4° |
  | Viento a favor 10 mph | 161 | 24.5 | 37.7° |
  | Viento a favor 20 mph | 167 | 21.7 | 31.7° |

  — [oracles.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/oracles.js)
- **Amateurs, "TrackMan Combine"** (solo de segunda mano, sin verificar en TrackMan):
  - velocidad de cabeza con driver, hombres: hándicap 5 ≈ 101 mph, 10 ≈ 95 mph y promedio (hándicap 14.5) ≈ 94 mph;
  - mujeres: 87, 83 y 79 mph para hándicap 5, 10 y 15;
  - velocidad de bola, hombres: scratch ≈ 161, hándicap 5 ≈ 147, 10 ≈ 138, 14.5 ≈ 133 y bogey ≈ 131 mph. El salto entre scratch y hándicap 5 parece sospechoso;
  - mujeres: scratch ≈ 131, 5 ≈ 125, 10 ≈ 119 y 15 ≈ 111 mph;
  - smash amateur ≈ 1.44 (≈ 1.43 en bogey);
  - regla de TrackMan: 1 mph de bola ≈ 2 yd de drive, y 1 mph de club "hasta ~3 yd".

  — [TrackMan, What is Ball Speed](https://www.trackman.com/blog/ball-speed); [KimCaddie](https://kimcaddie.com/en/post/20230712_ballspeed_headspeed); [Golfing Focus](https://golfingfocus.com/the-full-guide-to-what-is-a-good-ball-speed-for-a-driver/); [LPS Athletic](https://lpsathletic.com/pga-lpga-golf-swing-speed-driving-distance-standards/)
- **Carry por hándicap** (GolfLaunchLab, compilado de Shot Scope, Arccos y TrackMan, aproximado):

  | Hándicap | 5 | 10 | 15 | 20 | 25+ |
  |---|---|---|---|---|---|
  | Carry de driver (yd) | 249 | 230 | 217 | 202 | 186 |
  | Velocidad de bola (mph) | 150 | 140 | 133 | 126 | 117 |

  — [GolfLaunchLab](https://golflaunchlab.com/guides/golf-ball-speed-chart/)
- **Otros datos de prueba:**
  - Arccos 2026: un hándicap 10 promedia 220.5 yd de distancia total al nivel del mar, sobre ~10 millones de drives con GPS — [Arccos 2026](https://uploads.mygolfspy.com/uploads/2026/05/ArccosDrivingDistanceReport_2026Edition.pdf);
  - simulación de Lyu 2018: 71.5 m/s, 6°, 3000 rpm y 4 %/s de decaimiento — [notas de tmelevation](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md.notes.md);
  - golfsim trae 21 tiros con velocidad (m/s), lanzamiento, spin y carry "medido", por ejemplo 70.68 m/s, 12.4° y 2507 rpm con 268 yd. Su origen ("indoor simulator measurements") no es verificable — [simulation.py](https://github.com/avrybrdly93/golfsim/blob/main/simulation.py).
- **Medición independiente:** no se halló ningún conjunto académico de ángulo de caída, ápice y carry medidos sin el modelo de un fabricante.
  - TrackMan, en su producto de béisbol: "The radar follows the ball as long as possible, then physics-based trajectory modeling is applied".
  - Los estudios de fiabilidad (Bishop et al. 2023, J Sports Sci 41(23):2138) usan TrackMan como referencia.

  — [TrackMan Baseball Support](https://support.trackmanbaseball.com/hc/en-us/articles/47858440769435-Basics-How-the-Unit-Calculates-Carry-Distance) vía [notas aero-data](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/land-angle-spike/aero-data.md.notes.md)
- **USGA 2024 Distance Report:** su PDF de definiciones y conjuntos de datos existe, pero no se leyó. — [USGA 2024 Distance Report](https://digital-pd.usopen.com/content/dam/usga/images/equipment-standards/2024-distance-report/2024-Distance-Report-Definitions-and-Data-Sets.pdf)

### Inferences
- **Viento:** mi reimplementación 2D (leyes de tmelevation, viento horizontal uniforme), calibrada solo con el carry y la altura en calma del hierro 6 PGA de TrackMan, predice:

  | Caso | Carry (TrackMan) | Altura (TrackMan) | Caída (TrackMan) |
  |---|---|---|---|
  | En contra 10 mph | 165.0 (166) | 37.4 (38.1) | 57.3° (58.1°) |
  | En contra 20 mph | 142.1 (143) | 41.2 (42.8) | 69.0° (69.5°) |
  | A favor 10 mph | 198.5 (198) | 30.3 (29.7) | 39.2° (39.5°) |
  | A favor 20 mph | 208.4 (207) | 26.9 (26.1) | 32.7° (32.7°) |

  Un viento uniforme en altura reproduce el modelo de TrackMan a ±1.5 yd de carry, ±1.6 yd de altura y ±0.8° de caída. Sirve como prueba de regresión del simulador.
- **Tablas antiguas:** la tabla PGA de 113 mph y 275 yd, y la LPGA de 94 mph, 140 mph, 13.2°, 2611 rpm y 218 yd, son casi seguro las anteriores a 2023, que siguen citándose como "2024". Para validar hay que usar la de 2023 y no mezclarlas, como hace libgolf.
- **Proxy amateur:** el driver LPGA (96 mph de club) se parece en velocidad al amateur promedio masculino (~94 mph), aunque los amateurs tienen menor smash y otro lanzamiento y spin.
- **Tolerancias de prueba:** libgolf aprueba con ±5 yd de carry, ±6 yd de total, ±3 yd de ápice y ±3 yd de desvío lateral ([run.py](https://github.com/gdifiore/libgolf/blob/main/tools/calibration/run.py)). Son tolerancias razonables para comparar un DIY contra promedios.
- **Prueba con la ODS:** con las condiciones de 2028 (183 mph, 11°, 2220 rpm), una bola conforme debería dar ≤ 320 yd de carry + rodado en las condiciones de la USGA.

### Gaps
- No se encontraron trayectorias completas publicadas (x, y, z contra t) con sus condiciones de lanzamiento.
- No hay tablas oficiales de TrackMan por hándicap con lanzamiento, spin y ángulo de caída.
- No se verificaron los valores de spin de la tabla anterior (por ejemplo 2686 rpm en driver).
- No pude confirmar si TrackMan publicó tablas con datos de 2024–2026: las búsquedas se agotaron.

## 7. D-plane y leyes de vuelo (cara contra trayectoria, eje de spin, spin loft, smash)

### Takeaway
- **Dirección de salida:** la domina la cara. Fuentes de segunda mano que citan a TrackMan dan ~75% cara y 25% trayectoria en hierros, y ~85% y 15% en driver; Flushlab da 85/15 en hierros y 80/20 en driver, en conflicto.
- **Eje de spin:** es perpendicular al D-plane. Su inclinación crece con cara menos trayectoria y baja con el spin loft: ≈ 2° en hierros y ≈ 4° en driver por cada grado de cara menos trayectoria.
- **Spin loft:** solo es igual a loft dinámico menos ángulo de ataque si cara menos trayectoria es 0.
- **Smash de tour:** de 1.49 en driver a 1.24–1.25 en PW; los amateurs promedian ~1.44.
- **Spin en función de spin loft y velocidad:** no se halló una ecuación empírica publicada.

### Cited Findings
- **Reparto entre cara y trayectoria:**
  - Titleist, con datos de TrackMan: en hierros la cara explica ≈ 75% de la dirección inicial y la trayectoria el 25%; en driver ≈ 85% y 15% — [Titleist Learning Lab, Club Path](https://www.titleist.com/learning-lab/performance/golf-club-path);
  - mismo reparto para un hierro medio — [PGA Academy Australia](https://pgaacademy.com.au/trackman/starting-line-path-or-face/);
  - en las notas de TrackMan University de Bubany, la cara pesa ~3 veces más que la trayectoria en hierros y ~4 veces en driver — [Dan Bubany](https://danbubanygolf.com/trackman-university/);
  - otra fuente da ~85/15 en hierros y ~80/20 en driver, en conflicto — [Flushlab](https://flushlabgolf.com/blog/blog-physics-dplane.html);
  - otras dan 75–80% — [The DIY Golfer](https://www.thediygolfer.com/blog/d-plane-golf); [3Jack](http://3jack.blogspot.com/2009/11/answers-to-your-d-plane-questions-part.html) (resúmenes del buscador).
- **Definiciones:** cara menos trayectoria = ángulo de cara − trayectoria del club. Para un hierro 7 con plano de 63°, el cambio entre ángulo de ataque y trayectoria va 2:1. — [Dan Bubany](https://danbubanygolf.com/trackman-university/)
- **Inclinación del eje:** el eje es perpendicular al D-plane, y cara menos trayectoria es la entrada principal. Con poco spin loft (un driver golpeado algo hacia arriba), una diferencia pequeña inclina mucho el plano; con mucho spin loft (un wedge), lo inclina menos. — [Parennial Golf, D Plane Tilt](https://parennialgolf.com/shot-data/fs-d-plane-tilt)
- **Regla práctica:** "a 1 degree divergent angle between the clubface orientation and the clubhead path … will produce a tilt of the spin axis of 2 degrees (for an iron) and 4 degrees (for a driver)". — [Perfect Golf Swing Review](https://www.perfectgolfswingreview.net/ballflight.htm) (atribución según el resumen del buscador)
- **Spin loft:** solo equivale a loft dinámico menos ángulo de ataque si cara menos trayectoria es 0°. — [foro de Brian Manzella](https://forum.brianmanzellagolf.com/threads/what-tilts-the-spin-axis.17624/); [SkyTrak](https://www.skytrakgolf.com/blogs/articles/understanding-golf-ball-data-what-every-metric-actually-means-for-your-game) (resúmenes del buscador)
- **Tutelman, lanzamiento en 3D:** usa cara menos trayectoria como análogo del loft y el D-plane como plano de la dirección de la bola. Si se da el ángulo de cara F en vez de A, A = F − P. — [Tutelman, 3D launch](https://www.tutelman.com/golf/ballflight/3dlaunch.php)
- **"TrackMan's 10 Fundamentals"** (PDF en un sitio de terceros): la cara influye más que la trayectoria en la dirección de salida, y el eje de spin se inclina según la diferencia entre ambas. — [PDF](https://www.troxhammargk.se/media/t4dn2xcy/trackman-s-10-fundamentals.pdf)
- **Smash de tour (TrackMan 2023):**
  - PGA: 1.49 en driver, 1.47 en madera 3, 1.34 en hierro 7 y 1.24 en PW;
  - LPGA: 1.49 en driver, 1.38 en hierro 7 y 1.25 en PW.

  — [data.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/data.js)
- **Smash amateur:** ≈ 1.44, la meta en driver es ≈ 1.50, y los jugadores de bogey promedian ≈ 1.43. — [Fit My Golf Clubs](https://www.fitmygolfclubs.com/blog/smash-factor-chart); [LPS Athletic](https://lpsathletic.com/pga-lpga-golf-swing-speed-driving-distance-standards/) (resumen del buscador; no se sabe con certeza cuál de las dos lo dice)
- **Curva en altura:** a 5,000 ft el lift es ~14% menor, así que el hook o el slice curva ~14% menos (Aoyama). — [GolfWRX](https://golfwrx.com/545618/tiger-woods-lofting-up-for-thin-air-examining-the-switch-and-what-happens-when-you-play-at-altitude/) vía [reference-data.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/reference-data.md)

### Inferences
- **Geometría del D-plane** (derivación propia):
  - Sea p la dirección del club (trayectoria P, ataque A) y n la normal de la cara (cara F, loft dinámico L). El D-plane contiene p y n, y el eje de spin es paralelo a n × p.
  - Su componente vertical es cos L·cos A·sin(P − F), y su componente horizontal ≈ sin(spin loft). Por tanto:
    ```
    inclinación del eje ≈ atan( sin(F − P) / sin(spin loft) )
    ```
  - El signo depende de la convención.
  - Por grado de cara menos trayectoria da 4.8° con 12° de spin loft, 4.1° con 14°, 2.4° con 25° y 2.0° con 30°. Coincide con la regla de 2° en hierros y 4° en driver.
- **Dirección de salida** a partir de los porcentajes citados (aproximación lineal):
  - hierros: φ_salida ≈ 0.75·F + 0.25·P;
  - driver: φ_salida ≈ 0.85·F + 0.15·P;
  - en altura y con ángulos grandes el reparto puede cambiar.
- **Spin por un impacto que termina rodando** (cuerpo rígido, I = 2/5·m·r², derivación propia):
  ```
  ω ≈ (5/7)·V_club·sin(spin loft)/r · M/(M + m)
  ```

  | Palo | Supuesto | Estimación | TrackMan 2023 |
  |---|---|---|---|
  | Driver | 115 mph, 12° de spin loft, cabeza de 200 g | ≈ 2,780 rpm | 2545 rpm |
  | Hierro 7 | 92 mph, 24° de spin loft, cabeza de 265 g | ≈ 4,560 rpm | 7124 rpm |

  Ese modelo subestima mucho el spin de los hierros. El DIY debería medir el spin directamente o calibrar por palo con datos, no deducirlo del spin loft.

### Gaps
- No se encontró un documento primario de TrackMan con los porcentajes de cara y trayectoria, ni se consultó la deducción original del D-plane en el libro de Jorgensen.
- No hay una ecuación empírica publicada del spin en función del spin loft y la velocidad de cabeza, ni de la relación entre lanzamiento y loft dinámico.
- No se verificaron en esta sesión los límites de restitución y tiempo de contacto de la cabeza del driver (COR 0.830 y CT), que fijan el smash máximo de ≈ 1.50.

## 8. Simuladores de trayectoria de código abierto y cómo se calibraron

### Takeaway
Hay cuatro proyectos abiertos útiles:

| Proyecto | Lenguaje y licencia | Modelo | Validación |
|---|---|---|---|
| libgolf | C++20 y WASM, GPLv3 | Modelo de Nathan, con coeficientes según un estudio de WSU (Lyu) | Compara contra promedios TrackMan; sin optimizador |
| tmelevation | JS, Apache-2.0 | 2D, leyes ajustadas a mediciones de bolas modernas | Calibración por palo (kD, kL) a la tabla TrackMan 2023, más pruebas de altura y viento documentadas |
| golfsim | Python y JS, sin licencia | Ajustes de Lyu 2018 con atribución confusa, τ = 25 s | 21 tiros |
| esba1ley/golfball | Python, BSD-2 | Crisis de arrastre por rugosidad, atmósfera estándar de 1976 | — |

Además:
- opengolfcoach (Rust) y OpenFairway (C#, citado por libgolf) no se pudieron revisar;
- ningún simulador abierto está validado en una publicación revisada por pares contra datos de TrackMan.

### Cited Findings
- **libgolf:**
  - simula vuelo, bote y rodado, con aerodinámica, bote y rodado intercambiables;
  - la física en el aire se basa en el "TrajectoryCalculatorGolf" de Alan Nathan;
  - ejemplo del README: 160 mph, 11°, 3000 rpm, 70 °F, 50% de humedad y 29.92 inHg dan "Distance: 264.7 yards";
  - tiene visor 3D en WASM y licencia GPLv3;
  - último commit revisado: 2026-08-20.

  — [libgolf README](https://github.com/gdifiore/libgolf/blob/main/README.md); [calculadora de Nathan](http://baseball.physics.illinois.edu/trajectory-calculator-golf.html) (no accedida)
- **Validación de libgolf:** un arnés de validación y regresión "No optimizer — change model constants by hand", contra `shots_reference.csv` ("PGA + LPGA Tour 2023 TrackMan averages, small CI-friendly subset"). Umbrales en yardas, aprobado / moderado:

  | Medida | Aprobado | Moderado |
  |---|---|---|
  | Carry | 5 | 12 |
  | Total | 6 | 14 |
  | Ápice | 3 | 7 |
  | Desvío lateral | 3 | 7 |

  — [tools/calibration/README.md](https://github.com/gdifiore/libgolf/blob/main/tools/calibration/README.md); [run.py](https://github.com/gdifiore/libgolf/blob/main/tools/calibration/run.py)
- **tmelevation:** recalcula carry, altura máxima y ángulo de caída de la tabla TrackMan 2023 para cualquier altitud o presión.
  - **Modelo:**
    - 2D, con backspin puro;
    - leyes de C_D y C_L de bolas modernas;
    - decaimiento de spin de Smits ∝ ρ;
    - RK4 con dt = 0.05 s e interpolación de Hermite.
  - **Calibración:** Newton 2×2 sobre kD y kL por fila, para reproducir el carry y la altura del nivel del mar. Converge en 2–4 iteraciones y deja kD ≈ 0.87–1.32 y kL ≈ 0.92–1.48. El ángulo de caída queda como comprobación: el modelo cae 2–8° más plano en la madera 3 a PW PGA y a ≤ 0.9° en los drivers.
  - **Validación:** "oráculos" contra cifras de altitud y contra los tiros con viento de TrackMan.
  - **Licencia y fecha:** Apache-2.0; los datos de TrackMan quedan excluidos de la licencia. Commit del 2026-10-10.

  — [README](https://github.com/jhoblitt/tmelevation/blob/main/README.md); [métodos](https://jhoblitt.github.io/tmelevation/methods.html); [calibrate.js](https://github.com/jhoblitt/tmelevation/blob/main/site/js/calibrate.js)
- **Validación en la literatura:** su investigación no halló ningún artículo que valide un modelo de C_D y C_L contra los promedios de TrackMan. Lo más cercano:
  - Penner (2001), contra datos de máquina de Williams;
  - Bearman & Harvey, contra máquina de golpeo;
  - Lyu (2018), solo carry simulado.

  — [aero-model.md](https://github.com/jhoblitt/tmelevation/blob/main/docs/research/aero-model.md)
- **golfsim (Python, más una página JS):**
  - "Full 3D translational motion" con RK4 y decaimiento exponencial, τ = 25 s;
  - ρ = 1.225, r = 0.02135 m y m = 0.04593 kg;
  - compara 21 tiros con carry "medido";
  - preprint en Zenodo del 2025-11-01;
  - el repositorio no tiene archivo de licencia.

  — [README](https://github.com/avrybrdly93/golfsim/blob/main/README.md); [simulation.py](https://github.com/avrybrdly93/golfsim/blob/main/simulation.py); [Zenodo](https://zenodo.org/records/17499904)
- **esba1ley/golfball (Python, BSD-2):** "Projectile Simulation including the 'Drag Crisis' with selectable surface feature size", con su propia atmósfera estándar de 1976. Trae tablas de C_D en función de Re para esferas lisas y con hoyuelos de varias rugosidades (e/D = 1.25×10⁻², 5×10⁻³ y 1.5×10⁻³), además de `GolfBall.csv`. — [golfball](https://github.com/esba1ley/golfball)
- **opengolfcoach (Rust):** tiene un `trajectory.rs`; no se revisó. — [docs.rs](https://docs.rs/crate/opengolfcoach/0.3.0/source/src/trajectory.rs)
- **Otros recursos educativos:** el tutorial Python de "Physics in Sport" (usa ~3275 rpm como spin típico), la demostración de Wolfram y el tutorial de simstack. — [Physics-in-Sport](https://jrhodes95.github.io/Physics-in-Sport-Site/pythonmodel.html); [Wolfram](https://demonstrations.wolfram.com/FlightOfAGolfBall/); [simstack](https://simstack.readthedocs.io/en/latest/tutorials/projectile_motion/index.html)

### Inferences
- **Para el stack Python del usuario**, el camino más sólido:
  1. Pasar a 3D las ecuaciones de §1 con las leyes de tmelevation (§2), más λ ∝ ρ y la densidad de §4.
  2. Calibrar kD y kL por palo contra la tabla TrackMan 2023 a 25 °C y nivel del mar.
  3. Agregar como opción la pérdida de lift bajo Re 7.5×10⁴.
  4. Copiar la idea del arnés de regresión de libgolf, con tolerancias en yardas.

  Mi reimplementación 2D de ~80 líneas reprodujo la tabla tras calibrar, y los tiros con viento de TrackMan a ±1.5 yd.
- **Licencias:**
  - libgolf es GPLv3: si se integra su código, el resultado distribuido también tiene que ser GPL;
  - tmelevation (Apache-2.0) y golfball (BSD-2) son permisivos;
  - golfsim no tiene licencia, así que no se puede reutilizar su código.

### Gaps
- No se revisaron opengolfcoach, OpenFairway, la hoja de cálculo de Nathan ni simuladores comerciales con física publicada (GSPro y otros).
- No se halló documentación de cómo calibran sus modelos de vuelo TrackMan, FlightScope o Foresight: son propietarios.
