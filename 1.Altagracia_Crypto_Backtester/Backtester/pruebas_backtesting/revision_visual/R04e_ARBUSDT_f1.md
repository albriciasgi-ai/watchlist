# Revisión visual · R04e · ARBUSDT · 4h · fase 1

Regla: FVG nuevo ≥ 0.3 ATR, a mercado, **stop en el swing de 5 velas con mínimo 1 y máximo 2 ATR**, 3R.
Corrida aislada: `ARBUSDT_240_f1_7c7a70112129a5d1_1795307347` · 6 trades · +0.292 R · 117 señales: 101 con el stop "muy
largo", 1 "muy corto", 9 con una posición abierta. Capturas: `evidencia/pantalla/R04e_ARBUSDT_f1/`.

**Resultado: 6 de 6 bien.** El stop es el swing del gráfico más el margen (comprobación `swingCheck`), entre 1.06 y
1.89 ATR. Los topes **descartan** la señal; no recortan el stop (así lo dice CLAUDE.md: "Una señal con el stop a más de
maxAtr o menos de minAtr no se opera"). Revisar en la etapa 6 si la pantalla lo dice así.
