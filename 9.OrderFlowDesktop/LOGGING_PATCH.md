# PATCH: Logging Detallado para Agregación de Footprints

## Instrucciones

Para evitar conflictos con hot reload, sigue estos pasos:

1. **Detener el dev server** (Ctrl+C en la terminal donde corre `npm run dev:electron`)

2. **Aplicar cambios manualmente** en `src/components/indicators/OrderFlowIndicator.js`:

---

### CAMBIO 1: Inicializar estructura de logging (después de línea 338)

**BUSCAR:**
```javascript
    // Agregar cada grupo
    const aggregated = [];

    for (const [intervalStart, groupFootprints] of groups) {
      if (groupFootprints.length === 0) continue;
```

**REEMPLAZAR CON:**
```javascript
    // ========== INICIO LOGGING DETALLADO ==========
    const debugAnalysis = {
      symbol: this.symbol,
      timestamp_analysis: new Date().toISOString(),
      target_interval: targetInterval,
      step_size_usado: globalStepSize,
      step_size_source: source,
      total_footprints_1min: footprints1min.length,
      total_grupos: groups.size,
      grupos: []
    };

    console.log(`\n🔍 ANÁLISIS DE AGREGACIÓN INICIADO`);
    console.log(`📁 Analizando ${groups.size} grupos de ${intervalMinutes}min`);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const jsonFilename = `aggregation_debug_${timestamp}.json`;
    console.log(`📁 Se guardará en: ${jsonFilename}`);
    // ========== FIN INIT LOGGING ==========

    // Agregar cada grupo
    const aggregated = [];
    let grupoIndex = 0;

    for (const [intervalStart, groupFootprints] of groups) {
      if (groupFootprints.length === 0) continue;

      grupoIndex++;
```

---

### CAMBIO 2: Logging dentro del loop de agregación (después de línea ~347 donde calcula OHLC)

**BUSCAR (después del cálculo de OHLC):**
```javascript
      // 1. Calcular OHLC del intervalo agregado PRIMERO
      const candle_open = groupFootprints[0].candle_open || groupFootprints[0].open;
      const candle_close = groupFootprints[groupFootprints.length - 1].candle_close || groupFootprints[groupFootprints.length - 1].close;
      const candle_high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
      const candle_low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));

      // 2. ✅ USAR step_size GLOBAL (calculado una sola vez al inicio)
```

**INSERTAR DESPUÉS (antes del comentario "// 2. ✅ USAR step_size GLOBAL"):**
```javascript
      // ========== LOGGING DETALLADO DEL GRUPO ==========
      const grupoData = {
        grupo_id: grupoIndex,
        interval_start: new Date(intervalStart).toISOString(),
        interval_start_time: new Date(intervalStart).toLocaleTimeString('es-ES'),
        vela_calculada_de_footprints: {
          open: candle_open,
          high: candle_high,
          low: candle_low,
          close: candle_close,
          rango: candle_high - candle_low
        },
        footprints_1min: [],
        agregacion: {}
      };

      // Analizar cada footprint de 1min en el grupo
      let vol_sum_1min = 0;
      groupFootprints.forEach((fp, idx) => {
        const fpLevels = fp.levels || fp.price_levels || [];
        const fpVolumen = fp.total_volume || 0;
        vol_sum_1min += fpVolumen;

        const levelsData = fpLevels.map(l => ({
          price_min: l.price_min || l.price,
          price_max: l.price_max || l.price,
          bid: l.bid_volume || 0,
          ask: l.ask_volume || 0,
          total: l.total_volume || 0
        }));

        grupoData.footprints_1min.push({
          index: idx + 1,
          timestamp: new Date(fp.candle_timestamp).toLocaleTimeString('es-ES'),
          candle: {
            high: fp.candle_high || fp.high,
            low: fp.candle_low || fp.low,
            open: fp.candle_open || fp.open,
            close: fp.candle_close || fp.close
          },
          levels: {
            count: fpLevels.length,
            rango_min: fpLevels.length > 0 ? Math.min(...fpLevels.map(l => l.price_min || l.price)) : 0,
            rango_max: fpLevels.length > 0 ? Math.max(...fpLevels.map(l => l.price_max || l.price)) : 0,
            detalles: levelsData
          },
          volumen_total: fpVolumen,
          step_size: fp.step_size
        });
      });

      // Buscar vela REAL de 5min (si existe en this.candles)
      let velaReal = null;
      if (this.candles && this.candles.length > 0) {
        velaReal = this.candles.find(c => c.timestamp === intervalStart);
      }

      if (velaReal) {
        grupoData.vela_real_5min = {
          timestamp: intervalStart,
          open: velaReal.open,
          high: velaReal.high,
          low: velaReal.low,
          close: velaReal.close,
          volume: velaReal.volume
        };

        grupoData.comparacion_vela_real = {
          gap_high: velaReal.high - candle_high,
          gap_low: candle_low - velaReal.low,
          coincide_high: Math.abs(velaReal.high - candle_high) < 0.01,
          coincide_low: Math.abs(velaReal.low - candle_low) < 0.01
        };
      }
      // ========== FIN LOGGING GRUPO INIT ==========
```

---

### CAMBIO 3: Logging después de crear levels uniformes (después de línea ~411)

**BUSCAR:**
```javascript
      // 5. Convertir a array y ordenar descendente (NO FILTRAR - mantener levels vacíos)
      // Los levels vacíos son necesarios para que el footprint cubra toda la altura de la vela
      const levels = Array.from(uniformLevels.values())
        .sort((a, b) => b.price - a.price);

      // 🔍 DEBUG: Verificar estructura del nivel agregado uniforme (solo primer footprint)
```

**INSERTAR ANTES del comentario "// 🔍 DEBUG":**
```javascript
      // ========== LOGGING AGGREGATION RESULTS ==========
      const levelsConVolumen = levels.filter(l => l.total_volume > 0).length;
      const levelsVacios = levels.length - levelsConVolumen;
      const volumenAgregado = levels.reduce((sum, l) => sum + l.total_volume, 0);

      grupoData.agregacion = {
        step_size_usado: step_size,
        grid_uniforme: {
          total_levels: levels.length,
          levels_con_volumen: levelsConVolumen,
          levels_vacios: levelsVacios,
          rango_min: levels.length > 0 ? Math.min(...levels.map(l => l.price_min)) : 0,
          rango_max: levels.length > 0 ? Math.max(...levels.map(l => l.price_max)) : 0,
          detalles: levels.map(l => ({
            price_min: l.price_min,
            price_max: l.price_max,
            volumen: l.total_volume
          }))
        },
        volumen: {
          suma_1min: vol_sum_1min,
          agregado: volumenAgregado,
          diferencia: volumenAgregado - vol_sum_1min,
          perdida: Math.abs(volumenAgregado - vol_sum_1min) > 0.01
        }
      };

      // Detectar problemas
      grupoData.problemas_detectados = [];

      if (velaReal) {
        if (grupoData.comparacion_vela_real.gap_high > 0.5) {
          grupoData.problemas_detectados.push(`Footprint NO cubre high real (gap: ${grupoData.comparacion_vela_real.gap_high.toFixed(2)} USD)`);
        }
        if (grupoData.comparacion_vela_real.gap_low > 0.5) {
          grupoData.problemas_detectados.push(`Footprint NO cubre low real (gap: ${grupoData.comparacion_vela_real.gap_low.toFixed(2)} USD)`);
        }
      }

      if (grupoData.agregacion.volumen.perdida) {
        grupoData.problemas_detectados.push(`Pérdida de volumen: ${grupoData.agregacion.volumen.diferencia.toFixed(2)}`);
      }

      // Agregar a análisis
      if (grupoIndex <= 50) {  // Solo primeros 50 grupos
        debugAnalysis.grupos.push(grupoData);
      }

      // Consola resumida
      const status = grupoData.problemas_detectados.length > 0 ? '❌' : '✅';
      const gaps = velaReal ? `gap_high=${grupoData.comparacion_vela_real.gap_high.toFixed(2)}, gap_low=${grupoData.comparacion_vela_real.gap_low.toFixed(2)}` : 'sin vela real';
      console.log(`Grupo ${grupoIndex}/${groups.size}: ${grupoData.interval_start_time} -> ${gaps} ${status}`);
      // ========== FIN LOGGING RESULTS ==========
```

---

### CAMBIO 4: Guardar JSON al final (después de línea ~505, antes del return)

**BUSCAR:**
```javascript
    console.log(`[OrderFlow] [${this.symbol}] ✅ Agregación completa: ${aggregated.length} footprints de ${intervalMinutes}min con ${aggregated[0]?.levels?.length || 0} levels uniformes`);
    console.log(`[OrderFlow] [${this.symbol}] 🔍 DISTRIBUCIÓN STEP_SIZES AGREGADOS:`, aggregatedDistribution);

    return aggregated;
```

**REEMPLAZAR CON:**
```javascript
    console.log(`[OrderFlow] [${this.symbol}] ✅ Agregación completa: ${aggregated.length} footprints de ${intervalMinutes}min con ${aggregated[0]?.levels?.length || 0} levels uniformes`);
    console.log(`[OrderFlow] [${this.symbol}] 🔍 DISTRIBUCIÓN STEP_SIZES AGREGADOS:`, aggregatedDistribution);

    // ========== GUARDAR ANÁLISIS A JSON ==========
    debugAnalysis.resumen = {
      total_grupos: groups.size,
      grupos_analizados: debugAnalysis.grupos.length,
      grupos_con_problemas: debugAnalysis.grupos.filter(g => g.problemas_detectados.length > 0).length,
      grupos_sin_vela_real: debugAnalysis.grupos.filter(g => !g.vela_real_5min).length,
      promedio_gap_high: debugAnalysis.grupos
        .filter(g => g.vela_real_5min)
        .reduce((sum, g) => sum + Math.abs(g.comparacion_vela_real.gap_high), 0) /
        (debugAnalysis.grupos.filter(g => g.vela_real_5min).length || 1),
      promedio_gap_low: debugAnalysis.grupos
        .filter(g => g.vela_real_5min)
        .reduce((sum, g) => sum + Math.abs(g.comparacion_vela_real.gap_low), 0) /
        (debugAnalysis.grupos.filter(g => g.vela_real_5min).length || 1)
    };

    // Guardar a archivo
    const jsonContent = JSON.stringify(debugAnalysis, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = jsonFilename;
    a.click();
    URL.revokeObjectURL(url);

    console.log(`\n✅ ANÁLISIS COMPLETADO`);
    console.log(`📊 Resumen: ${debugAnalysis.resumen.grupos_con_problemas}/${debugAnalysis.resumen.total_grupos} grupos con problemas`);
    console.log(`📁 Archivo guardado: ${jsonFilename}`);
    // ========== FIN GUARDAR JSON ==========

    return aggregated;
```

---

## Después de aplicar los cambios:

1. Guardar el archivo
2. Reiniciar dev server: `npm run dev:electron`
3. Cambiar a timeframe de 5 minutos
4. Se descargará automáticamente un archivo JSON con el análisis completo
5. Revisar el JSON para identificar la causa raíz del problema
