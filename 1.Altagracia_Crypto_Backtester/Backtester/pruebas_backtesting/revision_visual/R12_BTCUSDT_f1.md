# Revisión visual · R12 · BTCUSDT · 1D · fase 1 · Canal gaussiano (E-04, E-06 y marco de 1 día)

Gaussian Channel 144, 4 polos, 1.414, canal a favor, solo largos, a mercado, stop en la línea central (borde lejano de
la zona, margen 0), salida por la banda.

| Corrida | Trades | R medio | Motivos | Revisión |
|---|---|---|---|---|
| `BTCUSDT_1440_f1_fe733881b5a62efc_1795310590` | 4 | +0.745 | 1 stop, 3 salen del canal | **4 de 4 bien** |

Capturas: `evidencia/pantalla/R12_BTCUSDT_f1/` (en el gráfico de 4h: no hay marco de 1 día).

- **El canal, recalculado aparte** (`tests/audit/gc_check.py`, `evidencia/capa_a/gc_check_R12_BTCUSDT_f1.log`): el
  filtro de 4 polos armado como cuatro filtros de un polo en cascada (la forma de Ehlers), no con la recursión
  binomial del motor, empezando en el primer dato. Da el mismo canal que el motor (diferencia relativa máxima 2.5e-12)
  en las 1,346 velas diarias de la fase (desde el 25/04/2020).
- **Las señales:** con el cruce limpio sobre la banda superior y la línea central subiendo, desde la vela 288, salen 4
  señales de largo en la fase: 14/09/21, 04/10/21, 13/03/23 y 02/05/23. Son los 4 trades, y el embudo de la corrida
  dice 4 señales y ninguna descartada.
- **Entrada y stop:** a la apertura del día siguiente, y el stop es la línea central del día de la señal, exacto.
- **Salidas:** el #1 sale por stop el 20/09/21; los otros tres, en la apertura del día siguiente al primer cierre
  bajo la banda superior (19/11/21, 02/05/23 y 08/05/23), al mismo precio que el motor.
- **En pantalla:** el gráfico de 4h dibuja las tres líneas del canal de la regla con su nombre, la caja del trade y la
  salida «Salida al salir del canal · +2.14 R».
- **Observación (O-06, para la etapa 6):** en 1D no hay minuto a minuto, así que una salida por stop se fecha al
  comienzo del día (#1: 20/09/21 00:00 UTC). En el gráfico de 4h la marca de la salida queda en la primera vela de 4h
  de ese día, aunque el precio tocó el stop más tarde: el ayudante lo marcó («la vela de la salida no toca el stop»,
  mínimo 45,078.5 en esa vela de 4h). El resultado del trade no cambia.
