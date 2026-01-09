// testRangeDetection.js
// Script para verificar la lógica de merging de rangos

const https = require('https');

const SYMBOL = 'ETHUSDT';
const INTERVAL = '15m';
const DAYS = 15;

const CONFIG = {
  minRangeLength: 20,
  atrMultiplier: 1.0,
  atrLength: 200
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

// ==================== CÁLCULO DE INDICADORES ====================

function calculateATR(candles, period) {
  if (candles.length < period + 1) return [];

  const trueRanges = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr = Math.max(
      high - low,
      Math.abs(high - prevClose),
      Math.abs(low - prevClose)
    );

    trueRanges.push(tr);
  }

  const atrValues = [];

  for (let i = period - 1; i < trueRanges.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += trueRanges[i - j];
    }
    atrValues.push(sum / period);
  }

  return atrValues;
}

function calculateSMA(candles, period) {
  if (candles.length < period) return [];

  const smaValues = [];

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += candles[i - j].close;
    }
    smaValues.push(sum / period);
  }

  return smaValues;
}

// ==================== DETECCIÓN DE RANGOS ====================

function detectRanges(candles, atrValues, smaValues, config) {
  const length = config.minRangeLength;
  const startIndex = Math.max(config.atrLength, length);

  const detectedRanges = [];
  let currentRange = null;
  let prevCountOutside = null;

  for (let i = startIndex; i < candles.length; i++) {
    const atrIndex = i - config.atrLength;
    const smaIndex = i - length;

    if (atrIndex < 0 || smaIndex < 0 || atrIndex >= atrValues.length || smaIndex >= smaValues.length) {
      continue;
    }

    const atr = atrValues[atrIndex] * config.atrMultiplier;
    const ma = smaValues[smaIndex];

    let countOutside = 0;
    for (let j = 0; j < length; j++) {
      const idx = i - j;
      if (idx < 0) break;

      const deviation = Math.abs(candles[idx].close - ma);
      if (deviation > atr) {
        countOutside++;
      }
    }

    if (countOutside === 0 && prevCountOutside !== 0) {
      // NUEVO RANGO DETECTADO
      const rangeHigh = ma + atr;
      const rangeLow = ma - atr;
      const newRangeStartIndex = i - length + 1;

      const lastSavedRange = detectedRanges[detectedRanges.length - 1];

      if (lastSavedRange && newRangeStartIndex <= lastSavedRange.endIndex) {
        // HAY OVERLAP: Mergear
        console.log(`🔄 Mergeando rango overlapeado (startIndex ${newRangeStartIndex} <= lastEndIndex ${lastSavedRange.endIndex})`);

        lastSavedRange.endIndex = i;
        lastSavedRange.endTimestamp = candles[i].timestamp;
        lastSavedRange.high = Math.max(lastSavedRange.high, rangeHigh);
        lastSavedRange.low = Math.min(lastSavedRange.low, rangeLow);
        lastSavedRange.duration = lastSavedRange.endIndex - lastSavedRange.startIndex + 1;

        currentRange = null;
      } else {
        // NO HAY OVERLAP: Crear nuevo rango
        currentRange = {
          startIndex: newRangeStartIndex,
          startTimestamp: candles[newRangeStartIndex].timestamp,
          endIndex: i,
          endTimestamp: candles[i].timestamp,
          high: rangeHigh,
          low: rangeLow,
          duration: length
        };
      }
    } else if (countOutside === 0) {
      // EXTENDER RANGO
      if (currentRange) {
        currentRange.endIndex = i;
        currentRange.endTimestamp = candles[i].timestamp;
        currentRange.duration++;
        currentRange.high = Math.max(currentRange.high, ma + atr);
        currentRange.low = Math.min(currentRange.low, ma - atr);
      }
    } else {
      // FINALIZAR RANGO
      if (currentRange && currentRange.duration >= config.minRangeLength) {
        detectedRanges.push(currentRange);
      }
      currentRange = null;
    }

    prevCountOutside = countOutside;
  }

  if (currentRange && currentRange.duration >= config.minRangeLength) {
    detectedRanges.push(currentRange);
  }

  return detectedRanges;
}

function mergeOverlappingRanges(ranges) {
  if (ranges.length <= 1) return ranges;

  const merged = [];
  let currentMerged = null;

  ranges.sort((a, b) => a.startTimestamp - b.startTimestamp);

  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i];

    if (!currentMerged) {
      currentMerged = { ...range };
    } else {
      const hasTemporalOverlap = range.startTimestamp <= currentMerged.endTimestamp;
      const hasPriceOverlap =
        (range.low >= currentMerged.low && range.low <= currentMerged.high) ||
        (range.high >= currentMerged.low && range.high <= currentMerged.high) ||
        (range.low <= currentMerged.low && range.high >= currentMerged.high);

      if (hasTemporalOverlap || hasPriceOverlap) {
        // MERGEAR
        console.log(`🔗 Post-merge: Mergeando rangos overlapeados`);
        currentMerged.endTimestamp = Math.max(currentMerged.endTimestamp, range.endTimestamp);
        currentMerged.high = Math.max(currentMerged.high, range.high);
        currentMerged.low = Math.min(currentMerged.low, range.low);
        currentMerged.duration += range.duration;
      } else {
        merged.push(currentMerged);
        currentMerged = { ...range };
      }
    }
  }

  if (currentMerged) {
    merged.push(currentMerged);
  }

  return merged;
}

// ==================== EJECUTAR TEST ====================

async function runTest() {
  console.log('🚀 Iniciando test de Range Detection con merging...\n');

  const candles = await fetchHistoricalData(SYMBOL, INTERVAL, DAYS);
  if (candles.length === 0) {
    console.error('❌ No se pudieron obtener datos');
    return;
  }

  console.log(`\n📊 Datos: ${candles.length} velas de ${SYMBOL} (${INTERVAL})`);
  console.log(`   Configuración: minRangeLength=${CONFIG.minRangeLength}, atrMultiplier=${CONFIG.atrMultiplier}, atrLength=${CONFIG.atrLength}\n`);

  const atrValues = calculateATR(candles, CONFIG.atrLength);
  const smaValues = calculateSMA(candles, CONFIG.minRangeLength);

  console.log(`📊 ATR: ${atrValues.length} valores, SMA: ${smaValues.length} valores\n`);

  const rawRanges = detectRanges(candles, atrValues, smaValues, CONFIG);
  console.log(`\n📊 Rangos ANTES de post-merge: ${rawRanges.length}`);

  const finalRanges = mergeOverlappingRanges(rawRanges);
  console.log(`📊 Rangos DESPUÉS de post-merge: ${finalRanges.length}\n`);

  console.log(`🎯 ===== RANGOS FINALES (${finalRanges.length}) =====\n`);

  finalRanges.forEach((range, i) => {
    const startDate = new Date(range.startTimestamp).toISOString().slice(0, 16).replace('T', ' ');
    const endDate = new Date(range.endTimestamp).toISOString().slice(0, 16).replace('T', ' ');
    const rangeSize = ((range.high - range.low) / range.low * 100).toFixed(2);

    console.log(`${i + 1}. ${startDate} → ${endDate}`);
    console.log(`   High: $${range.high.toFixed(2)} | Low: $${range.low.toFixed(2)} | Size: ${rangeSize}%`);
    console.log(`   Duration: ${range.duration} velas\n`);
  });

  console.log('✅ Test completado!');
}

runTest().catch(err => {
  console.error('❌ Error:', err);
});
