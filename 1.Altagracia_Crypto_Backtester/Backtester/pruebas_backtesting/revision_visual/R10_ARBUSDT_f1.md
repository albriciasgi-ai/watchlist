# Revisión visual · R10 · ARBUSDT · 4h · fase 1 · Objetivo mixto con la emisión de stablecoins (E-06)

Impulso (≥ 2 ATR en 3 velas), a mercado, stop 1.5 ATR. Objetivo de 3R, o de 5R si la emisión de USDT y USDC de 30
días va a favor con z ≥ 0.5 (`exit.chainTarget`).

| Corrida | Trades | R medio | Motivos | Con 5R | Revisión |
|---|---|---|---|---|---|
| `…85ead1b8bceeb34b_1795310576` | 31 | +0.129 | 23 stop, 8 objetivo (6 en 3R, 2 en 5R) | 7: #18, #22, #23, #24, #28, #29, #31 | **31 de 31 bien** |

Capturas: `evidencia/pantalla/R10_ARBUSDT_f1/` (31).

- **Qué objetivo tomó cada trade, recalculado aparte** (`tests/audit/chain_check.py`): con lo documentado y sin usar
  `onchain_flows.py`, la emisión de 30 días, su z contra los 365 días anteriores (al menos 180) y el dato del día D
  usado desde D + 1 día + 6 h, con hueco de 3 días. Los 31 trades toman el mismo objetivo que el motor (5R en los
  siete de arriba, 3R en los demás), con la desviación de población y con la muestral: ningún trade queda cerca del
  umbral como para que la diferencia lo cambie.
- **En pantalla:** el objetivo del detalle es la entrada ± 5 o 3 veces el riesgo, exacto (3.000R y 5.000R medidos con
  los precios del detalle). La caja del gráfico lo dibuja a esa altura.
- **La salida, recalculada con las velas del gráfico** (`exitCheck`): en los 31 trades sale en la misma vela, por el
  mismo motivo y al mismo precio que dice el motor. Los dos trades con 5R que llegaron (#18, +4.96R; #22, +4.95R)
  tocan el objetivo de 5R, no el de 3R, y no salen al pasar por 3R.
- **Entrada:** a la apertura de la vela siguiente a la señal; las diferencias de 0.0001 a 0.0003 son las de H11 (velas
  oficiales contra las armadas con los trades del almacén).
- Una abierta al final de la fase (no cuenta, H6).
