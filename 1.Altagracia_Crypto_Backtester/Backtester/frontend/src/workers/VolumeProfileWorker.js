/**
 * Web Worker para cálculos de Volume Profile
 * Mueve cálculos pesados fuera del main thread
 */

/**
 * Calcula el Volume Profile para un rango de velas
 * @param {Array} candles - Velas con {high, low, close, volume}
 * @param {number} rowCount - Número de filas/bins (default 100)
 * @param {number} valueAreaPercent - Porcentaje para Value Area (default 70)
 */
function calculateVolumeProfile(candles, rowCount = 100, valueAreaPercent = 70) {
  if (!candles || candles.length === 0) {
    return { bins: [], poc: null, vah: null, val: null };
  }

  // 1. Encontrar rango de precios
  let minPrice = Infinity;
  let maxPrice = -Infinity;

  for (const candle of candles) {
    if (candle.low < minPrice) minPrice = candle.low;
    if (candle.high > maxPrice) maxPrice = candle.high;
  }

  const priceRange = maxPrice - minPrice;
  if (priceRange <= 0) {
    return { bins: [], poc: null, vah: null, val: null };
  }

  const binSize = priceRange / rowCount;

  // 2. Crear bins
  const bins = new Array(rowCount).fill(0).map((_, i) => ({
    index: i,
    priceMin: minPrice + i * binSize,
    priceMax: minPrice + (i + 1) * binSize,
    priceMid: minPrice + (i + 0.5) * binSize,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0
  }));

  // 3. Distribuir volumen en bins
  let totalVolume = 0;

  for (const candle of candles) {
    const isBullish = candle.close >= candle.open;
    const candleVolume = candle.volume || 0;

    // Distribuir volumen proporcionalmente en bins que toca la vela
    for (const bin of bins) {
      // Verificar si la vela toca este bin
      if (candle.high >= bin.priceMin && candle.low <= bin.priceMax) {
        // Calcular qué porción de la vela está en este bin
        const overlapMin = Math.max(candle.low, bin.priceMin);
        const overlapMax = Math.min(candle.high, bin.priceMax);
        const candleRange = candle.high - candle.low;

        let proportion = 1;
        if (candleRange > 0) {
          proportion = (overlapMax - overlapMin) / candleRange;
        }

        const volumeForBin = candleVolume * proportion;
        bin.volume += volumeForBin;
        totalVolume += volumeForBin;

        if (isBullish) {
          bin.buyVolume += volumeForBin;
        } else {
          bin.sellVolume += volumeForBin;
        }
      }
    }
  }

  // 4. Encontrar POC (Point of Control) - bin con más volumen
  let pocIndex = 0;
  let maxVolume = 0;

  for (let i = 0; i < bins.length; i++) {
    if (bins[i].volume > maxVolume) {
      maxVolume = bins[i].volume;
      pocIndex = i;
    }
  }

  const poc = bins[pocIndex]?.priceMid || null;

  // 5. Calcular Value Area (VAH y VAL)
  const targetVolume = totalVolume * (valueAreaPercent / 100);
  let accumulatedVolume = bins[pocIndex].volume;
  let vaLowIndex = pocIndex;
  let vaHighIndex = pocIndex;

  while (accumulatedVolume < targetVolume && (vaLowIndex > 0 || vaHighIndex < bins.length - 1)) {
    const volumeBelow = vaLowIndex > 0 ? bins[vaLowIndex - 1].volume : 0;
    const volumeAbove = vaHighIndex < bins.length - 1 ? bins[vaHighIndex + 1].volume : 0;

    if (volumeBelow >= volumeAbove && vaLowIndex > 0) {
      vaLowIndex--;
      accumulatedVolume += bins[vaLowIndex].volume;
    } else if (vaHighIndex < bins.length - 1) {
      vaHighIndex++;
      accumulatedVolume += bins[vaHighIndex].volume;
    } else if (vaLowIndex > 0) {
      vaLowIndex--;
      accumulatedVolume += bins[vaLowIndex].volume;
    }
  }

  const vah = bins[vaHighIndex]?.priceMid || null;
  const val = bins[vaLowIndex]?.priceMid || null;

  // 6. Normalizar volúmenes para visualización (0-100%)
  if (maxVolume > 0) {
    for (const bin of bins) {
      bin.volumePercent = (bin.volume / maxVolume) * 100;
    }
  }

  return {
    bins,
    poc,
    vah,
    val,
    totalVolume,
    priceRange: { min: minPrice, max: maxPrice },
    binSize
  };
}

/**
 * Detecta clusters de volumen alto
 * @param {Array} bins - Bins del volume profile
 * @param {number} threshold - Umbral mínimo de volumen (% del max)
 */
function detectVolumeClusters(bins, threshold = 30) {
  const clusters = [];
  let currentCluster = null;

  for (const bin of bins) {
    if (bin.volumePercent >= threshold) {
      if (!currentCluster) {
        currentCluster = {
          startPrice: bin.priceMin,
          endPrice: bin.priceMax,
          totalVolume: bin.volume,
          bins: [bin]
        };
      } else {
        currentCluster.endPrice = bin.priceMax;
        currentCluster.totalVolume += bin.volume;
        currentCluster.bins.push(bin);
      }
    } else if (currentCluster) {
      currentCluster.midPrice = (currentCluster.startPrice + currentCluster.endPrice) / 2;
      clusters.push(currentCluster);
      currentCluster = null;
    }
  }

  // Agregar último cluster si existe
  if (currentCluster) {
    currentCluster.midPrice = (currentCluster.startPrice + currentCluster.endPrice) / 2;
    clusters.push(currentCluster);
  }

  return clusters;
}

// Handler de mensajes del main thread
self.onmessage = function(e) {
  const { type, data, id } = e.data;

  try {
    let result;

    switch (type) {
      case 'CALCULATE_PROFILE':
        result = calculateVolumeProfile(
          data.candles,
          data.rowCount || 100,
          data.valueAreaPercent || 70
        );
        break;

      case 'DETECT_CLUSTERS':
        result = detectVolumeClusters(data.bins, data.threshold || 30);
        break;

      default:
        throw new Error(`Unknown message type: ${type}`);
    }

    self.postMessage({ id, success: true, result });
  } catch (error) {
    self.postMessage({ id, success: false, error: error.message });
  }
};
