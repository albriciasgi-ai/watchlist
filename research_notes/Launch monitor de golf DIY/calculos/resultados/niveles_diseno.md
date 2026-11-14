# Precisión esperada por nivel del diseño

Monte Carlo con 160 golpes por celda a través del simulador (modelo final). Solo errores de los sensores: falta sumar el error del modelo de vuelo.

**σ supuestos por nivel** (driver / hierro 7)

| Nivel | Velocidad | VLA ° | Giro rpm | HLA ° | Eje ° | Base |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Nivel 0: teléfono 240 fps | 3.00% / 3.00% | 1.0 / 1.0 | 600 / 1200 | 2.0 / 2.0 | 4.0 / 4.0 | vb: escala por el diámetro de ~40 px ±1 px (2.5%), centroide y obturador rodante; giro y eje no medidos |
| Nivel 1: solo radar | 0.85% / 1.30% | 2.0 / 2.5 | 600 / 1200 | 2.5 / 2.5 | 4.0 / 4.0 | vb: coseno corregido con un VLA supuesto por palo ±2-2.5° más 0.5% de geometría; VLA, giro, HLA y eje no medidos |
| Nivel 2: radar + cámara GS + estroboscopio | 0.30% / 0.30% | 0.2 / 0.2 | 150 / 170 | 0.4 / 0.4 | 3.0 / 1.0 | una cámara de lado; HLA por el tamaño (σ diámetro 0.3-0.5 px); giro por 4-6 imágenes con σθ ≈ 1.5-2° |
| Nivel 2+: dos cámaras o base más larga | 0.20% / 0.20% | 0.15 / 0.15 | 100 / 120 | 0.2 / 0.2 | 1.5 / 0.7 | estéreo o más imágenes del giro; supuesto optimista |

**Error de carry y de offline por los sensores** (yd)

| Aire | Golpe | Nivel | Carry RMS | Carry P95 | Offline RMS | Offline P95 |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Nivel del mar | Driver PGA | Nivel 0: teléfono 240 fps | 13.1 | 30.4 | 13.8 | 27.6 |
| Nivel del mar | Driver PGA | Nivel 1: solo radar | 9.0 | 19.1 | 14.3 | 29.0 |
| Nivel del mar | Driver PGA | Nivel 2: radar + cámara GS + estroboscopio | 1.5 | 3.0 | 6.3 | 12.6 |
| Nivel del mar | Driver PGA | Nivel 2+: dos cámaras o base más larga | 1.0 | 2.0 | 3.3 | 6.6 |
| Nivel del mar | Hierro 7 PGA | Nivel 0: teléfono 240 fps | 8.5 | 15.9 | 9.1 | 16.5 |
| Nivel del mar | Hierro 7 PGA | Nivel 1: solo radar | 6.0 | 12.3 | 10.0 | 20.9 |
| Nivel del mar | Hierro 7 PGA | Nivel 2: radar + cámara GS + estroboscopio | 1.0 | 1.9 | 2.1 | 3.7 |
| Nivel del mar | Hierro 7 PGA | Nivel 2+: dos cámaras o base más larga | 0.8 | 1.5 | 1.3 | 2.5 |
| Nivel del mar | Driver aficionado (supuesto) | Nivel 0: teléfono 240 fps | 10.7 | 20.5 | 9.1 | 18.8 |
| Nivel del mar | Driver aficionado (supuesto) | Nivel 1: solo radar | 8.0 | 16.2 | 9.9 | 18.4 |
| Nivel del mar | Driver aficionado (supuesto) | Nivel 2: radar + cámara GS + estroboscopio | 1.3 | 2.6 | 4.2 | 7.7 |
| Nivel del mar | Driver aficionado (supuesto) | Nivel 2+: dos cámaras o base más larga | 0.9 | 1.6 | 2.1 | 3.5 |
| Bogotá | Driver PGA | Nivel 0: teléfono 240 fps | 17.8 | 34.6 | 11.6 | 22.4 |
| Bogotá | Driver PGA | Nivel 1: solo radar | 19.7 | 40.3 | 15.1 | 28.8 |
| Bogotá | Driver PGA | Nivel 2: radar + cámara GS + estroboscopio | 2.7 | 5.4 | 4.5 | 8.7 |
| Bogotá | Driver PGA | Nivel 2+: dos cámaras o base más larga | 1.9 | 3.5 | 2.6 | 5.1 |
| Bogotá | Hierro 7 PGA | Nivel 0: teléfono 240 fps | 8.5 | 16.0 | 8.4 | 15.6 |
| Bogotá | Hierro 7 PGA | Nivel 1: solo radar | 5.9 | 12.6 | 9.6 | 19.7 |
| Bogotá | Hierro 7 PGA | Nivel 2: radar + cámara GS + estroboscopio | 0.9 | 1.7 | 1.8 | 3.3 |
| Bogotá | Hierro 7 PGA | Nivel 2+: dos cámaras o base más larga | 0.7 | 1.4 | 1.2 | 2.4 |
| Bogotá | Driver aficionado (supuesto) | Nivel 0: teléfono 240 fps | 13.7 | 25.6 | 8.1 | 15.3 |
| Bogotá | Driver aficionado (supuesto) | Nivel 1: solo radar | 12.2 | 23.6 | 10.2 | 20.7 |
| Bogotá | Driver aficionado (supuesto) | Nivel 2: radar + cámara GS + estroboscopio | 1.9 | 3.8 | 3.2 | 6.1 |
| Bogotá | Driver aficionado (supuesto) | Nivel 2+: dos cámaras o base más larga | 1.2 | 2.4 | 1.5 | 2.9 |

Error del modelo de vuelo (de trayectoria.py): RMS de carry 1.3-4.3 yd frente a TrackMan a nivel del mar; en Bogotá la dependencia de Re deja una banda de +3% a +13.5% (driver) y +9% a +20% (hierro 7) sin calibración local.
