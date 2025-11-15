// optimizeRangeDetection.js
// Script para optimizar parámetros de Range Detection con datos reales de ETHUSDT

const https = require('https');

// ==================== CONFIGURACIÓN ====================

const SYMBOL = 'ETHUSDT';
const INTERVAL = '15m'; // 15 minutos
const DAYS = 15; // Últimos 15 días

// Rangos de parámetros a probar
const PARAM_RANGES = {
  swingLength: [3, 5, 7, 10],
  rangeTolerancePercent: [0.01, 0.02, 0.03, 0.05], // 1%, 2%, 3%, 5%
  minRangeDuration: [15, 20, 30, 40, 50]
};

// ==================== OBTENER DATOS ====================

async function fetchHistoricalData(symbol, interval, days) {
  const now = Date.now();
  const startTime = now - (days * 24 * 60 * 60 * 1000);

  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&limit=1000`;

  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          const candles = json.map(k => ({
            timestamp: k[0],
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low: parseFloat(k[3]),
            close: parseFloat(k[4]),
            volume: parseFloat(k[5])
          }));

          console.log(`✅ Descargados ${candles.length} velas de ${symbol} (${interval})`);
          resolve(candles);
        } catch (error) {
          console.error(`❌ Error parseando datos:`, error.message);
          resolve([]);
        }
      });
    }).on('error', (error) => {
      console.error(`❌ Error obteniendo datos:`, error.message);
      resolve([]);
    });
  });
}

// ==================== SWING DETECTION ====================

function findSwingHighs(candles, swingLength) {
  const swingHighs = [];

  for (let i = swingLength; i < candles.length - swingLength; i++) {
    const currentHigh = candles[i].high;
    let isSwingHigh = true;

    // Verificar izquierda
    for (let left = 1; left <= swingLength; left++) {
      if (candles[i - left].high >= currentHigh) {
        isSwingHigh = false;
        break;
      }
    }

    if (!isSwingHigh) continue;

    // Verificar derecha
    for (let right = 1; right <= swingLength; right++) {
      if (candles[i + right].high >= currentHigh) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swingHighs.push({
        index: i,
        price: currentHigh,
        timestamp: candles[i].timestamp
      });
    }
  }

  return swingHighs;
}

function findSwingLows(candles, swingLength) {
  const swingLows = [];

  for (let i = swingLength; i < candles.length - swingLength; i++) {
    const currentLow = candles[i].low;
    let isSwingLow = true;

    // Verificar izquierda
    for (let left = 1; left <= swingLength; left++) {
      if (candles[i - left].low <= currentLow) {
        isSwingLow = false;
        break;
      }
    }

    if (!isSwingLow) continue;

    // Verificar derecha
    for (let right = 1; right <= swingLength; right++) {
      if (candles[i + right].low <= currentLow) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swingLows.push({
        index: i,
        price: currentLow,
        timestamp: candles[i].timestamp
      });
    }
  }

  return swingLows;
}

// ==================== RANGE DETECTION ====================

function detectRangesHLH(swingHighs, swingLows, config) {
  const ranges = [];
  const tolerance = config.rangeTolerancePercent;

  for (let i = 0; i < swingHighs.length - 1; i++) {
    const firstHigh = swingHighs[i];

    for (let j = i + 1; j < swingHighs.length; j++) {
      const secondHigh = swingHighs[j];

      // Verificar si highs son similares
      const priceDiff = Math.abs(secondHigh.price - firstHigh.price);
      const avgPrice = (secondHigh.price + firstHigh.price) / 2;
      const diffPercent = priceDiff / avgPrice;

      if (diffPercent > tolerance) continue;

      // Buscar lows entre los highs
      const lowsBetween = swingLows.filter(sl =>
        sl.index > firstHigh.index && sl.index < secondHigh.index
      );

      if (lowsBetween.length === 0) continue;

      const lowestPoint = lowsBetween.reduce((min, curr) =>
        curr.price < min.price ? curr : min
      );

      const duration = secondHigh.index - firstHigh.index;
      if (duration < config.minRangeDuration) continue;

      ranges.push({
        type: 'H-L-H',
        high: Math.max(firstHigh.price, secondHigh.price),
        low: lowestPoint.price,
        duration: duration,
        startIndex: firstHigh.index,
        endIndex: secondHigh.index
      });

      break;
    }
  }

  return ranges;
}

function detectRangesLHL(swingHighs, swingLows, config) {
  const ranges = [];
  const tolerance = config.rangeTolerancePercent;

  for (let i = 0; i < swingLows.length - 1; i++) {
    const firstLow = swingLows[i];

    for (let j = i + 1; j < swingLows.length; j++) {
      const secondLow = swingLows[j];

      // Verificar si lows son similares
      const priceDiff = Math.abs(secondLow.price - firstLow.price);
      const avgPrice = (secondLow.price + firstLow.price) / 2;
      const diffPercent = priceDiff / avgPrice;

      if (diffPercent > tolerance) continue;

      // Buscar highs entre los lows
      const highsBetween = swingHighs.filter(sh =>
        sh.index > firstLow.index && sh.index < secondLow.index
      );

      if (highsBetween.length === 0) continue;

      const highestPoint = highsBetween.reduce((max, curr) =>
        curr.price > max.price ? curr : max
      );

      const duration = secondLow.index - firstLow.index;
      if (duration < config.minRangeDuration) continue;

      ranges.push({
        type: 'L-H-L',
        high: highestPoint.price,
        low: Math.min(firstLow.price, secondLow.price),
        duration: duration,
        startIndex: firstLow.index,
        endIndex: secondLow.index
      });

      break;
    }
  }

  return ranges;
}

// ==================== EVALUACIÓN DE CALIDAD ====================

function evaluateRanges(ranges, candles) {
  if (ranges.length === 0) {
    return {
      score: 0,
      totalRanges: 0,
      avgDuration: 0,
      avgRangeSize: 0,
      overlaps: 0,
      overlapRate: 0
    };
  }

  let totalDuration = 0;
  let totalRangeSize = 0;
  let overlaps = 0;

  // Calcular métricas
  ranges.forEach((range, i) => {
    totalDuration += range.duration;
    totalRangeSize += ((range.high - range.low) / range.low) * 100; // % del precio

    // Verificar overlaps con otros rangos
    for (let j = i + 1; j < ranges.length; j++) {
      const other = ranges[j];
      const timeOverlap = !(range.endIndex < other.startIndex || other.endIndex < range.startIndex);
      if (timeOverlap) overlaps++;
    }
  });

  const avgDuration = totalDuration / ranges.length;
  const avgRangeSize = totalRangeSize / ranges.length;
  const overlapRate = overlaps / ranges.length; // Overlaps por rango (mejor métrica)

  // Score mejorado:
  // 1. Duración: 30 puntos (más largo es mejor, óptimo ~50-100 velas)
  const durationScore = Math.min(avgDuration / 80, 1) * 30;

  // 2. Cantidad: 30 puntos (óptimo: 5-15 rangos)
  let countScore = 0;
  if (ranges.length >= 5 && ranges.length <= 15) {
    countScore = 30;
  } else if (ranges.length < 5) {
    countScore = (ranges.length / 5) * 30; // Penalizar pocos rangos
  } else {
    countScore = Math.max(0, 30 - ((ranges.length - 15) * 2)); // Penalizar muchos rangos
  }

  // 3. Tamaño: 25 puntos (óptimo: 1.5-5% del precio)
  let sizeScore = 0;
  if (avgRangeSize >= 1.5 && avgRangeSize <= 5) {
    sizeScore = 25;
  } else if (avgRangeSize < 1.5) {
    sizeScore = (avgRangeSize / 1.5) * 15; // Penalizar rangos pequeños
  } else {
    sizeScore = Math.max(0, 25 - ((avgRangeSize - 5) * 3)); // Penalizar rangos grandes
  }

  // 4. Overlaps: 15 puntos (penalizar rate > 3)
  const overlapScore = Math.max(0, 15 - (overlapRate * 2));

  const score = durationScore + countScore + sizeScore + overlapScore;

  return {
    score: score.toFixed(2),
    totalRanges: ranges.length,
    avgDuration: avgDuration.toFixed(1),
    avgRangeSize: avgRangeSize.toFixed(2) + '%',
    overlaps: overlaps,
    overlapRate: overlapRate.toFixed(2)
  };
}

// ==================== SIMULACIÓN ====================

async function runSimulation() {
  console.log('🚀 Iniciando optimización de parámetros para Range Detection...\n');

  // 1. Obtener datos
  const candles = await fetchHistoricalData(SYMBOL, INTERVAL, DAYS);
  if (candles.length === 0) {
    console.error('❌ No se pudieron obtener datos');
    return;
  }

  console.log(`\n📊 Datos: ${candles.length} velas de ${SYMBOL} (${INTERVAL})`);
  console.log(`   Rango: ${new Date(candles[0].timestamp).toISOString()} → ${new Date(candles[candles.length-1].timestamp).toISOString()}\n`);

  const results = [];

  // 2. Probar todas las combinaciones
  let testCount = 0;
  const totalTests = PARAM_RANGES.swingLength.length *
                     PARAM_RANGES.rangeTolerancePercent.length *
                     PARAM_RANGES.minRangeDuration.length;

  console.log(`🔬 Probando ${totalTests} combinaciones de parámetros...\n`);

  for (const swingLength of PARAM_RANGES.swingLength) {
    for (const tolerance of PARAM_RANGES.rangeTolerancePercent) {
      for (const minDuration of PARAM_RANGES.minRangeDuration) {
        testCount++;

        const config = {
          swingLength,
          rangeTolerancePercent: tolerance,
          minRangeDuration: minDuration
        };

        // Detectar swing points
        const swingHighs = findSwingHighs(candles, swingLength);
        const swingLows = findSwingLows(candles, swingLength);

        // Detectar rangos
        const rangesHLH = detectRangesHLH(swingHighs, swingLows, config);
        const rangesLHL = detectRangesLHL(swingHighs, swingLows, config);
        const allRanges = [...rangesHLH, ...rangesLHL];

        // Evaluar calidad
        const evaluation = evaluateRanges(allRanges, candles);

        results.push({
          config,
          swingPoints: { highs: swingHighs.length, lows: swingLows.length },
          ranges: {
            hlh: rangesHLH.length,
            lhl: rangesLHL.length,
            total: allRanges.length
          },
          evaluation,
          allRanges
        });

        // Mostrar progreso cada 10 tests
        if (testCount % 10 === 0) {
          console.log(`   Progreso: ${testCount}/${totalTests} (${((testCount/totalTests)*100).toFixed(1)}%)`);
        }
      }
    }
  }

  // 3. Ordenar por score
  results.sort((a, b) => parseFloat(b.evaluation.score) - parseFloat(a.evaluation.score));

  // 4. Mostrar top 10
  console.log('\n\n🏆 ===== TOP 10 MEJORES CONFIGURACIONES =====\n');

  results.slice(0, 10).forEach((result, i) => {
    console.log(`#${i + 1} - Score: ${result.evaluation.score}/100`);
    console.log(`   Parámetros:`);
    console.log(`      • swingLength: ${result.config.swingLength}`);
    console.log(`      • rangeTolerancePercent: ${(result.config.rangeTolerancePercent * 100).toFixed(1)}%`);
    console.log(`      • minRangeDuration: ${result.config.minRangeDuration}`);
    console.log(`   Resultados:`);
    console.log(`      • Swing Points: ${result.swingPoints.highs} highs, ${result.swingPoints.lows} lows`);
    console.log(`      • Rangos: ${result.ranges.total} total (${result.ranges.hlh} H-L-H, ${result.ranges.lhl} L-H-L)`);
    console.log(`      • Duración promedio: ${result.evaluation.avgDuration} velas`);
    console.log(`      • Tamaño promedio: ${result.evaluation.avgRangeSize}`);
    console.log(`      • Overlaps: ${result.evaluation.overlaps} (rate: ${result.evaluation.overlapRate})`);
    console.log('');
  });

  // 5. Análisis detallado del mejor resultado
  const best = results[0];
  console.log('\n📋 ===== ANÁLISIS DETALLADO DEL MEJOR RESULTADO =====\n');
  console.log(`Configuración óptima:`);
  console.log(`   • swingLength: ${best.config.swingLength}`);
  console.log(`   • rangeTolerancePercent: ${(best.config.rangeTolerancePercent * 100).toFixed(1)}%`);
  console.log(`   • minRangeDuration: ${best.config.minRangeDuration}\n`);

  console.log(`Rangos detectados (${best.allRanges.length}):\n`);
  best.allRanges.forEach((range, i) => {
    const startDate = new Date(candles[range.startIndex].timestamp).toISOString().slice(0, 16);
    const endDate = new Date(candles[range.endIndex].timestamp).toISOString().slice(0, 16);
    const rangeSize = ((range.high - range.low) / range.low * 100).toFixed(2);

    console.log(`   ${i + 1}. ${range.type} | ${startDate} → ${endDate}`);
    console.log(`      High: $${range.high.toFixed(2)} | Low: $${range.low.toFixed(2)} | Size: ${rangeSize}%`);
    console.log(`      Duration: ${range.duration} velas\n`);
  });

  console.log('\n✅ Optimización completada!');
}

// ==================== EJECUTAR ====================

runSimulation().catch(err => {
  console.error('❌ Error en simulación:', err);
});
