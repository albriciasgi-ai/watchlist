# Verificación del Fix: Footprints de Archivo

## Problema Resuelto
Los footprints del archivo agregado (1min → 5min) no se renderizaban porque usaban campo `price_levels` mientras el código de renderizado solo verificaba `levels`.

## Cambios Realizados

### 1. OrderFlowIndicator.js - `_aggregateFootprints()` (líneas 273-321)
- **Antes:** Retornaba footprints con `price_levels`
- **Ahora:** Retorna footprints con `levels` (normalizado al formato backend)
- Incluye todos los campos del backend: `symbol`, `interval`, `candle_open/high/low/close`, `step_size`, `num_levels`

### 2. OrderFlowIndicator.js - `renderOverlay()` (líneas 782-806)
- **Antes:** Solo verificaba `footprint.levels` → rechazaba footprints de archivo
- **Ahora:** Verifica `footprint.levels || footprint.price_levels` (soporte dual)
- Normaliza footprint antes de renderizar

## Cómo Verificar el Fix

### 1. Recargar la aplicación
```bash
# Ctrl+Shift+R en la app Electron para hard reload
```

### 2. Buscar en consola estos logs

**✅ Agregación normalizada:**
```
[OrderFlow] [BTCUSDT] ✅ Agregación completa: 297 footprints de 5min (formato normalizado con campo "levels")
```

**✅ Estructura normalizada:**
```
[OrderFlow] [BTCUSDT] 🔍 ESTRUCTURA - Primero: levels=true, price_levels=false, keys=17
[OrderFlow] [BTCUSDT] 🔍 ESTRUCTURA - Último: levels=true, price_levels=false, keys=17
```
(Nota: Ahora AMBOS deben tener `levels=true`)

**✅ Sin rechazos:**
```
[OrderFlow] [BTCUSDT] 🔍 RENDER: velas=300, matched=300, unmatched=0, noFp=0, noLevels=0, empty=0
```

**✅ Rango completo:**
```
[OrderFlow] [BTCUSDT] Rango merged: 16/10/2026, 10:15:00 a.m. → 17/10/2026, 1:45:00 p.m.
[OrderFlow] [BTCUSDT] CANDLES RANGE: 16/10/2026, 10:15:00 a.m. → 17/10/2026, 1:45:00 p.m.
[OrderFlow] [BTCUSDT] FP RANGE: 16/10/2026, 10:15:00 a.m. → 17/10/2026, 1:45:00 p.m.
```

### 3. Verificación Visual

- Timeframe: 5 minutos
- Días: 5 días
- **ANTES:** Footprints solo desde las 8:40 AM de hoy (~10 horas)
- **AHORA:** Footprints desde ayer 10:15 AM (~27 horas, rango completo)

## Estructura de Footprint Normalizada

Todos los footprints (archivo + backend) ahora tienen esta estructura:

```javascript
{
  candle_timestamp: 1729166100000,
  symbol: "BTCUSDT",
  interval: "5",
  candle_open: 81708.8,
  candle_high: 81708.8,
  candle_low: 81684.3,
  candle_close: 81698.0,
  step_size: 0.1,
  levels: [  // ✅ Campo "levels" (NO "price_levels")
    {
      price: 81708.8,
      bid_volume: 1234.5,
      ask_volume: 987.6,
      total_volume: 2222.1,
      delta: 246.9
    },
    // ... más levels
  ],
  num_levels: 120,
  total_volume: 266665.2,
  total_delta: 29630.8,
  delta: 29630.8,
  poc: 81698.0
}
```

## Fallback para Compatibilidad

El código de renderizado tiene fallback para footprints antiguos que aún usen `price_levels`:

```javascript
const levels = footprint.levels || footprint.price_levels;
```

Esto asegura compatibilidad hacia atrás si hay footprints sin normalizar en memoria.
