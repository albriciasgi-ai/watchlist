// testRangeDetection.js
// Script de testing offline para calibrar el detector de rangos con datos históricos

const fs = require('fs');
const path = require('path');

// Importar el detector (simulando el entorno del navegador para Node.js)
class IndicatorBase {
  constructor(symbol, interval, days = 30) {
    this.symbol = symbol;
    this.interval = interval;
    this.days = days;
    this.name = "Base Indicator";
    this.data = [];
    this.enabled = true;
    this.height = 100;
    this.loading = false;
  }
  async fetchData() {}
  setEnabled(enabled) { this.enabled = enabled; }
  getHeight() { return this.enabled ? this.height : 0; }
}

// Copiar la clase RangeDetectionIndicator aquí (sin imports de ES6)
class RangeDetectionIndicator extends IndicatorBase {
  constructor(symbol, interval, days = 30) {
    super(symbol, interval, days);
    this.name = "Range Detection";
    this.height = 0;

    this.config = {
      windowSize: 30,
      atrPeriod: 14,
      atrThreshold: 0.7,
      priceRangeThreshold: 0.05,
      candleBalanceMin: 0.40,
      candleBalanceMax: 0.60,
      pocCentralRangeMin: 0.35,
      pocCentralRangeMax: 0.65,
      valueAreaMaxSize: 0.60,
      minConsolidationBars: 10,
      maxActiveRanges: 10,
      autoCreateFixedRange: true,
      enableDateFilter: false,
      startDate: null,
      endDate: null
    };

    this.detectedRanges = [];
    this.currentCandidate = null;
    this.lastAnalysisTimestamp = null;
    this.atrCache = [];
    this.profileCache = new Map();
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    if (newConfig.atrPeriod || newConfig.windowSize) {
      this.atrCache = [];
      this.profileCache.clear();
    }
  }

  setDateRange(startDate, endDate) {
    this.config.enableDateFilter = true;
    this.config.startDate = startDate;
    this.config.endDate = endDate;
  }

  analyze(allCandles) {
    if (!this.enabled || !allCandles || allCandles.length < this.config.windowSize + this.config.atrPeriod) {
      return this.detectedRanges;
    }

    const now = Date.now();
    if (this.lastAnalysisTimestamp && (now - this.lastAnalysisTimestamp) < 5000) {
      return this.detectedRanges;
    }
    this.lastAnalysisTimestamp = now;

    let candlesToAnalyze = allCandles;
    if (this.config.enableDateFilter && this.config.startDate && this.config.endDate) {
      candlesToAnalyze = allCandles.filter(c =>
        c.timestamp >= this.config.startDate && c.timestamp <= this.config.endDate
      );
      if (candlesToAnalyze.length < this.config.windowSize + this.config.atrPeriod) {
        return this.detectedRanges;
      }
    }

    const windowStart = candlesToAnalyze.length - this.config.windowSize;
    const windowCandles = candlesToAnalyze.slice(windowStart);

    const historicalATR = this.calculateATR(
      candlesToAnalyze.slice(windowStart - this.config.atrPeriod, windowStart),
      this.config.atrPeriod
    );
    const currentATR = this.calculateATR(windowCandles, this.config.atrPeriod);

    const atrRatio = historicalATR > 0 ? currentATR / historicalATR : 1;
    const volatilityDecreasing = atrRatio < this.config.atrThreshold;

    const priceAnalysis = this.analyzePriceRange(windowCandles);
    const isLateralMovement = priceAnalysis.rangeRatio < this.config.priceRangeThreshold;

    const candleBalance = this.analyzeCandleBalance(windowCandles);
    const isIndecision = candleBalance >= this.config.candleBalanceMin &&
                         candleBalance <= this.config.candleBalanceMax;

    let profileValidation = { isValid: false, poc: null, valueArea: null };

    if (volatilityDecreasing && isLateralMovement && isIndecision) {
      profileValidation = this.validateVolumeProfile(windowCandles);
    }

    const isConsolidation = volatilityDecreasing &&
                           isLateralMovement &&
                           isIndecision &&
                           profileValidation.isValid;

    if (isConsolidation) {
      this.handleConsolidationDetected(windowCandles, {
        atrRatio,
        priceAnalysis,
        candleBalance,
        profileValidation,
        score: this.calculateConsolidationScore({
          atrRatio,
          priceRangeRatio: priceAnalysis.rangeRatio,
          candleBalance,
          profileValid: profileValidation.isValid
        })
      });
    } else {
      this.handleNoConsolidation(windowCandles);
    }

    this.pruneOldRanges();
    return this.detectedRanges;
  }

  calculateATR(candles, period) {
    if (!candles || candles.length < period) return 0;
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trueRanges.push(tr);
    }
    const relevantTRs = trueRanges.slice(-period);
    return relevantTRs.reduce((sum, tr) => sum + tr, 0) / relevantTRs.length;
  }

  analyzePriceRange(candles) {
    const high = Math.max(...candles.map(c => c.high));
    const low = Math.min(...candles.map(c => c.low));
    const range = high - low;
    const avgPrice = (high + low) / 2;
    const rangeRatio = avgPrice > 0 ? range / avgPrice : 0;
    return { high, low, range, avgPrice, rangeRatio };
  }

  analyzeCandleBalance(candles) {
    let bullishCount = 0;
    for (const candle of candles) {
      if (candle.close >= candle.open) bullishCount++;
    }
    return bullishCount / candles.length;
  }

  validateVolumeProfile(candles) {
    const priceAnalysis = this.analyzePriceRange(candles);
    const { low: minPrice, high: maxPrice, range } = priceAnalysis;
    if (range === 0) return { isValid: false };

    const rows = 50;
    const step = range / rows;

    const levels = Array(rows).fill(0).map((_, i) => ({
      price: minPrice + (step * i) + (step / 2),
      volume: 0,
      levelLow: minPrice + (step * i),
      levelHigh: minPrice + (step * (i + 1))
    }));

    for (const candle of candles) {
      for (let i = 0; i < rows; i++) {
        const overlap = this.calculateOverlap(
          candle.low, candle.high,
          levels[i].levelLow, levels[i].levelHigh
        );
        if (overlap > 0) {
          levels[i].volume += candle.volume * overlap;
        }
      }
    }

    let pocIndex = 0;
    let maxVolume = levels[0].volume;
    for (let i = 1; i < levels.length; i++) {
      if (levels[i].volume > maxVolume) {
        pocIndex = i;
        maxVolume = levels[i].volume;
      }
    }

    const poc = { index: pocIndex, price: levels[pocIndex].price, volume: maxVolume };
    const pocPosition = pocIndex / rows;
    const isPOCCentral = pocPosition >= this.config.pocCentralRangeMin &&
                         pocPosition <= this.config.pocCentralRangeMax;

    const totalVolume = levels.reduce((sum, l) => sum + l.volume, 0);
    const valueAreaThreshold = totalVolume * 0.70;
    let lowIndex = pocIndex;
    let highIndex = pocIndex;
    let cumulativeVolume = maxVolume;

    while (cumulativeVolume < valueAreaThreshold && (lowIndex > 0 || highIndex < rows - 1)) {
      const lowerVolume = lowIndex > 0 ? levels[lowIndex - 1].volume : 0;
      const upperVolume = highIndex < rows - 1 ? levels[highIndex + 1].volume : 0;
      if (lowerVolume > upperVolume) {
        lowIndex--;
        cumulativeVolume += lowerVolume;
      } else {
        highIndex++;
        cumulativeVolume += upperVolume;
      }
    }

    const valueAreaSize = (highIndex - lowIndex) / rows;
    const isValueAreaCompact = valueAreaSize < this.config.valueAreaMaxSize;
    const isValid = isPOCCentral && isValueAreaCompact;

    return {
      isValid,
      poc,
      valueArea: { lowIndex, highIndex, size: valueAreaSize, vahPrice: levels[highIndex].price, valPrice: levels[lowIndex].price },
      distribution: { isPOCCentral, isValueAreaCompact, pocPosition }
    };
  }

  calculateOverlap(candleLow, candleHigh, levelLow, levelHigh) {
    const overlapLow = Math.max(candleLow, levelLow);
    const overlapHigh = Math.min(candleHigh, levelHigh);
    const overlap = Math.max(0, overlapHigh - overlapLow);
    const candleSize = candleHigh - candleLow;
    return candleSize > 0 ? overlap / candleSize : 0;
  }

  calculateConsolidationScore({ atrRatio, priceRangeRatio, candleBalance, profileValid }) {
    let score = 0;
    score += Math.max(0, (1 - atrRatio) * 30);
    score += Math.max(0, (1 - (priceRangeRatio / this.config.priceRangeThreshold)) * 25);
    score += Math.max(0, (1 - Math.abs(0.5 - candleBalance) * 2) * 20);
    if (profileValid) score += 25;
    return Math.min(100, score);
  }

  handleConsolidationDetected(candles, metrics) {
    const startTimestamp = candles[0].timestamp;
    const endTimestamp = candles[candles.length - 1].timestamp;

    const existingRange = this.detectedRanges.find(r =>
      r.status === 'monitoring' &&
      ((startTimestamp >= r.startTimestamp && startTimestamp <= r.endTimestamp) ||
       (endTimestamp >= r.startTimestamp && endTimestamp <= r.endTimestamp))
    );

    if (existingRange) {
      existingRange.endTimestamp = endTimestamp;
      existingRange.consecutiveBars++;
      existingRange.lastUpdateTimestamp = Date.now();
      existingRange.score = metrics.score;
      existingRange.metrics = metrics;

      if (existingRange.consecutiveBars >= this.config.minConsolidationBars &&
          existingRange.status !== 'confirmed') {
        existingRange.status = 'confirmed';
      }
    } else {
      const newRange = {
        id: `range_${startTimestamp}`,
        symbol: this.symbol,
        startTimestamp,
        endTimestamp,
        status: 'monitoring',
        consecutiveBars: this.config.windowSize,
        detectedAt: Date.now(),
        lastUpdateTimestamp: Date.now(),
        score: metrics.score,
        metrics,
        profileCreated: false
      };
      this.detectedRanges.push(newRange);
    }

    this.currentCandidate = { startTimestamp, endTimestamp, metrics };
  }

  handleNoConsolidation(candles) {
    if (this.currentCandidate) {
      const lastTimestamp = candles[candles.length - 1].timestamp;
      this.detectedRanges.forEach(range => {
        if (range.status === 'confirmed' &&
            lastTimestamp > range.endTimestamp &&
            lastTimestamp - range.endTimestamp < 10 * this.getIntervalMs()) {
          range.status = 'broken';
          range.breakoutTimestamp = lastTimestamp;
        }
      });
      this.currentCandidate = null;
    }
  }

  pruneOldRanges() {
    if (this.detectedRanges.length <= this.config.maxActiveRanges) return;
    this.detectedRanges.sort((a, b) => b.detectedAt - a.detectedAt);
    this.detectedRanges.splice(this.config.maxActiveRanges);
  }

  getIntervalMs() {
    const map = { "1": 60000, "3": 180000, "5": 300000, "15": 900000, "30": 1800000, "60": 3600000, "120": 7200000, "240": 14400000, "D": 86400000, "W": 604800000 };
    return map[this.interval] || 900000;
  }
}

// ==================== TEST RUNNER ====================

function formatDate(timestamp) {
  return new Date(timestamp).toISOString().replace('T', ' ').substring(0, 19);
}

function runTest(dataFile, interval, testConfig = {}) {
  console.log('\n' + '='.repeat(80));
  console.log(`TEST: ${dataFile} (${interval})`);
  console.log('='.repeat(80));

  // Cargar datos
  const filePath = path.join(__dirname, dataFile);
  const rawData = fs.readFileSync(filePath, 'utf8');
  const jsonData = JSON.parse(rawData);
  const candles = jsonData.klines || jsonData.data || [];

  console.log(`✓ Datos cargados: ${candles.length} velas`);
  console.log(`  Período: ${formatDate(candles[0].timestamp)} → ${formatDate(candles[candles.length - 1].timestamp)}`);

  // Inicializar detector
  const detector = new RangeDetectionIndicator('BTCUSDT', interval, 30);

  // Aplicar configuración de test
  if (Object.keys(testConfig).length > 0) {
    detector.updateConfig(testConfig);
    console.log(`✓ Configuración custom aplicada:`, testConfig);
  }

  // Analizar con ventana deslizante
  console.log(`\n🔍 Analizando con ventana deslizante (window=${detector.config.windowSize})...\n`);

  const step = 50; // Analizar cada 50 velas para performance
  const results = [];

  for (let i = detector.config.windowSize + detector.config.atrPeriod; i < candles.length; i += step) {
    const subset = candles.slice(0, i + 1);
    const ranges = detector.analyze(subset);

    // Registrar nuevos rangos detectados
    ranges.forEach(range => {
      if (!results.find(r => r.id === range.id)) {
        results.push({ ...range });
      }
    });
  }

  // Reporte final
  console.log('─'.repeat(80));
  console.log(`RESULTADOS: ${results.length} rangos detectados\n`);

  const confirmed = results.filter(r => r.status === 'confirmed');
  const monitoring = results.filter(r => r.status === 'monitoring');
  const broken = results.filter(r => r.status === 'broken');

  console.log(`  ✅ Confirmados: ${confirmed.length}`);
  console.log(`  👀 Monitoreando: ${monitoring.length}`);
  console.log(`  💥 Rotos (breakout): ${broken.length}\n`);

  if (confirmed.length > 0) {
    console.log('RANGOS CONFIRMADOS (Top 10):');
    console.log('─'.repeat(80));

    confirmed
      .sort((a, b) => b.score - a.score)
      .slice(0, 10)
      .forEach((range, i) => {
        const duration = range.endTimestamp - range.startTimestamp;
        const durationHours = (duration / (1000 * 60 * 60)).toFixed(1);

        console.log(`\n${i + 1}. [Score: ${range.score.toFixed(1)}/100] ID: ${range.id}`);
        console.log(`   Inicio:    ${formatDate(range.startTimestamp)}`);
        console.log(`   Fin:       ${formatDate(range.endTimestamp)}`);
        console.log(`   Duración:  ${durationHours} horas (${range.consecutiveBars} velas)`);

        if (range.metrics) {
          console.log(`   ATR Ratio: ${(range.metrics.atrRatio * 100).toFixed(1)}%`);
          console.log(`   Price Range: ${(range.metrics.priceAnalysis.rangeRatio * 100).toFixed(2)}%`);
          console.log(`   Balance: ${(range.metrics.candleBalance * 100).toFixed(1)}% alcistas`);
        }
      });
  }

  console.log('\n' + '='.repeat(80));

  // Guardar resultados
  const outputFile = path.join(__dirname, `results_${interval}_${Date.now()}.json`);
  fs.writeFileSync(outputFile, JSON.stringify({
    testFile: dataFile,
    interval,
    config: detector.config,
    totalCandles: candles.length,
    rangesDetected: results.length,
    confirmed: confirmed.length,
    monitoring: monitoring.length,
    broken: broken.length,
    ranges: results
  }, null, 2));

  console.log(`📄 Resultados guardados en: ${path.basename(outputFile)}\n`);

  return { results, detector };
}

// ==================== EJECUTAR TESTS ====================

console.log('🎯 RANGE DETECTION - CALIBRACIÓN CON DATOS HISTÓRICOS');
console.log('Iniciado:', new Date().toLocaleString('es-CO'));

// Test 1: 15 minutos con configuración default
runTest('BTCUSDT_sample.json', '15');

// Test 2: 5 minutos con configuración default
runTest('BTCUSDT_sample_5min.json', '5');

// Test 3: 15 minutos con umbrales más estrictos
runTest('BTCUSDT_sample.json', '15', {
  atrThreshold: 0.6,
  priceRangeThreshold: 0.04,
  minConsolidationBars: 15
});

// Test 4: 5 minutos con umbrales más relajados
runTest('BTCUSDT_sample_5min.json', '5', {
  atrThreshold: 0.8,
  priceRangeThreshold: 0.06,
  minConsolidationBars: 8
});

console.log('✅ Tests completados');
