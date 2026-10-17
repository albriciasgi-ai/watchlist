/**
 * Script de prueba para verificar la agregación de footprints
 * Simula el método _aggregateFootprints() de OrderFlowIndicator.js
 */

const fs = require('fs');
const path = require('path');

// Ruta al archivo de footprints
const appDataPath = process.env.APPDATA || process.env.HOME;
const archivePath = path.join(appDataPath, 'orderflow-desktop', 'footprint_archive', 'BTCUSDT_1.json');

console.log('📂 Leyendo:', archivePath);

// Leer archivo
const data = JSON.parse(fs.readFileSync(archivePath, 'utf-8'));
const footprints1min = data.footprints || [];

console.log(`\n📊 Footprints de 1 minuto: ${footprints1min.length}`);

if (footprints1min.length === 0) {
  console.log('❌ No hay footprints para agregar');
  process.exit(1);
}

// Mostrar rango
const oldest = new Date(footprints1min[0].candle_timestamp);
const newest = new Date(footprints1min[footprints1min.length - 1].candle_timestamp);
console.log(`   Rango: ${oldest.toLocaleString()} -> ${newest.toLocaleString()}`);

/**
 * Función de agregación (copia de OrderFlowIndicator.js)
 */
function aggregateFootprints(footprints1min, targetInterval) {
  const intervalMinutes = parseInt(targetInterval);

  console.log(`\n🔄 Agregando a intervalos de ${intervalMinutes} minutos...`);

  // Agrupar por intervalo
  const groups = new Map();

  for (const fp of footprints1min) {
    const timestamp = fp.candle_timestamp;
    const intervalStart = Math.floor(timestamp / (intervalMinutes * 60 * 1000)) * (intervalMinutes * 60 * 1000);

    if (!groups.has(intervalStart)) {
      groups.set(intervalStart, []);
    }
    groups.get(intervalStart).push(fp);
  }

  console.log(`   Grupos creados: ${groups.size}`);

  // Agregar cada grupo
  const aggregated = [];

  for (const [intervalStart, groupFootprints] of groups) {
    if (groupFootprints.length === 0) continue;

    // Combinar price_levels
    const combinedLevels = new Map();

    for (const fp of groupFootprints) {
      // Soportar ambos formatos: levels[] (archivo) y price_levels[] (backend)
      const levels = fp.levels || fp.price_levels || [];

      for (const level of levels) {
        // Soportar price_mid (archivo) y price (backend)
        const price = level.price_mid || level.price;

        if (!combinedLevels.has(price)) {
          combinedLevels.set(price, {
            price: price,
            bid_volume: 0,
            ask_volume: 0,
            total_volume: 0,
            delta: 0
          });
        }

        const combined = combinedLevels.get(price);
        combined.bid_volume += level.bid_volume || 0;
        combined.ask_volume += level.ask_volume || 0;
        combined.total_volume += level.total_volume || 0;
        combined.delta += level.delta || 0;
      }
    }

    const price_levels = Array.from(combinedLevels.values()).sort((a, b) => b.price - a.price);

    // OHLC - Soportar candle_open/high/low/close (archivo) y open/high/low/close (backend)
    const open = groupFootprints[0].candle_open || groupFootprints[0].open;
    const close = groupFootprints[groupFootprints.length - 1].candle_close || groupFootprints[groupFootprints.length - 1].close;
    const high = Math.max(...groupFootprints.map(fp => fp.candle_high || fp.high));
    const low = Math.min(...groupFootprints.map(fp => fp.candle_low || fp.low));

    // Volúmenes
    const total_volume = groupFootprints.reduce((sum, fp) => sum + (fp.total_volume || 0), 0);
    const total_delta = groupFootprints.reduce((sum, fp) => sum + (fp.total_delta || fp.delta || 0), 0);

    // POC
    let poc = null;
    let max_volume = 0;
    for (const level of price_levels) {
      if (level.total_volume > max_volume) {
        max_volume = level.total_volume;
        poc = level.price;
      }
    }

    aggregated.push({
      candle_timestamp: intervalStart,
      open,
      high,
      low,
      close,
      total_volume,
      total_delta,
      delta: total_delta,
      poc,
      price_levels
    });
  }

  aggregated.sort((a, b) => a.candle_timestamp - b.candle_timestamp);

  return aggregated;
}

// Probar agregaciones
console.log('\n' + '='.repeat(60));

const intervals = [5, 15, 60];

for (const interval of intervals) {
  const aggregated = aggregateFootprints(footprints1min, interval.toString());

  if (aggregated.length > 0) {
    const oldestAgg = new Date(aggregated[0].candle_timestamp);
    const newestAgg = new Date(aggregated[aggregated.length - 1].candle_timestamp);

    console.log(`\n✅ Agregación a ${interval} minutos:`);
    console.log(`   Footprints: ${aggregated.length}`);
    console.log(`   Rango: ${oldestAgg.toLocaleString()} -> ${newestAgg.toLocaleString()}`);

    // Mostrar algunos detalles del primer footprint
    const first = aggregated[0];
    console.log(`   Primer footprint:`);
    console.log(`     Timestamp: ${new Date(first.candle_timestamp).toLocaleString()}`);
    console.log(`     OHLC: O=${first.open} H=${first.high} L=${first.low} C=${first.close}`);
    console.log(`     Volume: ${first.total_volume}`);
    console.log(`     Delta: ${first.delta}`);
    console.log(`     POC: ${first.poc}`);
    console.log(`     Price levels: ${first.price_levels.length}`);
  } else {
    console.log(`\n❌ Agregación a ${interval} minutos: 0 footprints`);
  }
}

console.log('\n' + '='.repeat(60));
console.log('✅ Test completado\n');
