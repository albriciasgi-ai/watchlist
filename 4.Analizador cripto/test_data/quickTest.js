// quickTest.js - Test rápido con debug detallado
const fs = require('fs');

const data = JSON.parse(fs.readFileSync('BTCUSDT_sample.json'));
const allCandles = data.klines;

console.log(`\n📊 ANÁLISIS RÁPIDO - ${allCandles.length} velas totales\n`);

// Tomar ventanas de diferentes períodos para análisis
const testWindows = [
  { start: 50000, size: 60, label: 'Período medio (2021)' },
  { start: 100000, size: 60, label: 'Período medio (2022)' },
  { start: 150000, size: 60, label: 'Período reciente (2023)' },
  { start: allCandles.length - 1000, size: 60, label: 'Muy reciente (2025)' }
];

testWindows.forEach(({ start, size, label }) => {
  const candles = allCandles.slice(start, start + size);

  console.log(`\n${'='.repeat(70)}`);
  console.log(`${label} - ${size} velas`);
  console.log(`Desde: ${new Date(candles[0].timestamp).toISOString().substring(0, 19)}`);
  console.log(`Hasta: ${new Date(candles[candles.length-1].timestamp).toISOString().substring(0, 19)}`);
  console.log(`${'='.repeat(70)}`);

  // ATR
  let atrSum = 0;
  for(let i = 1; i < Math.min(15, candles.length); i++) {
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - candles[i-1].close),
      Math.abs(candles[i].low - candles[i-1].close)
    );
    atrSum += tr;
  }
  const atr = atrSum / 14;

  // Price stats
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const priceRange = maxHigh - minLow;
  const avgPrice = (maxHigh + minLow) / 2;
  const rangeRatio = priceRange / avgPrice;

  // Balance
  let bullish = 0;
  candles.forEach(c => { if(c.close >= c.open) bullish++; });
  const balance = bullish / candles.length;

  // Volatilidad (desviación estándar de closes)
  const avgClose = closes.reduce((a,b) => a+b, 0) / closes.length;
  const variance = closes.reduce((sum, c) => sum + Math.pow(c - avgClose, 2), 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / avgClose; // Coeficiente de variación

  console.log(`\n📈 MÉTRICAS:`);
  console.log(`  ATR:              ${atr.toFixed(2)}`);
  console.log(`  Price Range:      ${priceRange.toFixed(2)} (${(rangeRatio * 100).toFixed(2)}%)`);
  console.log(`  Avg Price:        ${avgPrice.toFixed(2)}`);
  console.log(`  Std Dev:          ${stdDev.toFixed(2)} (CV: ${(cv * 100).toFixed(2)}%)`);
  console.log(`  Bullish Balance:  ${(balance * 100).toFixed(1)}%`);

  // Evaluación
  console.log(`\n🎯 EVALUACIÓN:`);
  const isLowVolatility = cv < 0.05; // 5% coeficiente de variación
  const isNarrowRange = rangeRatio < 0.10; // 10% rango precio
  const isBalanced = balance >= 0.35 && balance <= 0.65;

  console.log(`  ✓ Baja volatilidad:   ${isLowVolatility ? '✅ SÍ' : '❌ NO'} (CV < 5%)`);
  console.log(`  ✓ Rango estrecho:     ${isNarrowRange ? '✅ SÍ' : '❌ NO'} (< 10%)`);
  console.log(`  ✓ Balance:            ${isBalanced ? '✅ SÍ' : '❌ NO'} (35-65%)`);

  const isConsolidation = isLowVolatility && isNarrowRange && isBalanced;
  console.log(`\n  🎯 CONSOLIDACIÓN:     ${isConsolidation ? '✅✅✅ DETECTADA' : '❌ NO DETECTADA'}`);
});

console.log(`\n${'='.repeat(70)}\n`);

// Buscar el mejor período de consolidación en todo el dataset
console.log('🔍 BUSCANDO MEJORES PERÍODOS DE CONSOLIDACIÓN...\n');

const candidatesResults = [];
const windowSize = 60;
const step = 1000; // Cada 1000 velas para rapidez

for(let i = 0; i < allCandles.length - windowSize; i += step) {
  const candles = allCandles.slice(i, i + windowSize);

  // Quick calculations
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const closes = candles.map(c => c.close);
  const maxHigh = Math.max(...highs);
  const minLow = Math.min(...lows);
  const priceRange = maxHigh - minLow;
  const avgPrice = (maxHigh + minLow) / 2;
  const rangeRatio = priceRange / avgPrice;

  const avgClose = closes.reduce((a,b) => a+b, 0) / closes.length;
  const variance = closes.reduce((sum, c) => sum + Math.pow(c - avgClose, 2), 0) / closes.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / avgClose;

  let bullish = 0;
  candles.forEach(c => { if(c.close >= c.open) bullish++; });
  const balance = bullish / candles.length;

  // Score consolidación
  const score =
    (cv < 0.05 ? 40 : 0) +
    (rangeRatio < 0.10 ? 40 : 0) +
    ((balance >= 0.35 && balance <= 0.65) ? 20 : 0);

  if(score >= 80) {
    candidatesResults.push({
      index: i,
      timestamp: candles[0].timestamp,
      cv: cv,
      rangeRatio: rangeRatio,
      balance: balance,
      score: score
    });
  }
}

console.log(`Encontrados ${candidatesResults.length} períodos candidatos (score >= 80)\n`);

if(candidatesResults.length > 0) {
  console.log('TOP 10 PERÍODOS DE CONSOLIDACIÓN:\n');
  candidatesResults
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .forEach((c, i) => {
      console.log(`${i+1}. Score: ${c.score}/100`);
      console.log(`   Fecha: ${new Date(c.timestamp).toISOString().substring(0, 19)}`);
      console.log(`   CV: ${(c.cv * 100).toFixed(2)}% | Range: ${(c.rangeRatio * 100).toFixed(2)}% | Balance: ${(c.balance * 100).toFixed(1)}%`);
      console.log('');
    });
} else {
  console.log('⚠️ No se encontraron períodos de consolidación con score >= 80');
  console.log('   Esto sugiere que los umbrales necesitan ajuste o que BTC tiene alta volatilidad\n');
}

// Estadísticas generales del dataset
console.log(`${'='.repeat(70)}`);
console.log('📊 ESTADÍSTICAS GENERALES DEL DATASET\n');

const allCloses = allCandles.map(c => c.close);
const avgAll = allCloses.reduce((a,b) => a+b, 0) / allCloses.length;
const varianceAll = allCloses.reduce((sum, c) => sum + Math.pow(c - avgAll, 2), 0) / allCloses.length;
const stdDevAll = Math.sqrt(varianceAll);
const cvAll = stdDevAll / avgAll;

console.log(`Total velas:       ${allCandles.length}`);
console.log(`Precio promedio:   $${avgAll.toFixed(2)}`);
console.log(`Std Dev global:    ${stdDevAll.toFixed(2)}`);
console.log(`CV global:         ${(cvAll * 100).toFixed(2)}%`);
console.log(`\n✅ Análisis completado\n`);
