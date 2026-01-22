// src/components/indicators/SupportResistance2Indicator.js
// S&R v2 - Basado en Swing Points con filtro de rango de precio
// Más preciso que el S&R original, usa la misma lógica del Swing Detector

import IndicatorBase from "./IndicatorBase";

class SupportResistance2Indicator extends IndicatorBase {
  constructor(symbol, interval, days = 60) {
    super(symbol, interval, days);
    this.name = "S&R v2";
    this.height = 0; // No ocupa espacio propio, se dibuja sobre el chart
    this.days = days;

    console.log(`%c[SupportResistance2Indicator] VERSION 1.0 - Swing Points Based`, 'background: #9C27B0; color: white; font-weight: bold; padding: 4px;');

    // ==================== Parámetros de Detección ====================
    // Swing detection (N barras a cada lado para confirmar swing)
    this.swingBars = 5;

    // Clustering
    this.clusterDistancePct = 0.3; // % para agrupar swings cercanos

    // Filtros
    this.minTouches = 1;           // Mínimo de toques para considerar nivel válido (1 = cada swing es un nivel)
    this.maxLevels = 5;            // Máximo de niveles por lado (5 R + 5 S)
    this.priceRangePct = 10.0;     // % arriba/abajo del precio actual para buscar (10% para más cobertura)

    // Volumen
    this.volumeLookbackBars = 50;  // Para calcular z-score del volumen
    this.minVolumeZScore = 0;      // 0 = sin filtro de volumen

    // ==================== Visualización ====================
    this.showResistances = true;
    this.showSupports = true;
    this.showLabels = true;
    this.lineWidth = 2;

    // ==================== Datos ====================
    this.resistances = [];
    this.supports = [];
    this.currentPrice = 0;

    // ==================== Control Interno ====================
    this._lastCalculatedLength = 0;
    this._calculationValid = false;
    this._currentPlaybackTime = null;
    this._lastPlaybackTime = null;

    // Flags de logging
    this._renderLoggedOnce = false;
    this._noDataLoggedOnce = false;
    this._fallbackLoggedOnce = false;
    this._drawLoggedOnce = false;

    // ==================== Caché IndexedDB ====================
    this._dbName = 'SupportResistance2Cache';
    this._storeName = 'levels';
    this._dbVersion = 1;
    this._cachedRawLevels = null;
  }

  // ==================== IndexedDB Cache Methods ====================

  async _openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this._dbName, this._dbVersion);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        if (!db.objectStoreNames.contains(this._storeName)) {
          db.createObjectStore(this._storeName, { keyPath: 'key' });
        }
      };
    });
  }

  _getCacheKey() {
    return `sr2_${this.symbol}_${this.interval}`;
  }

  _getParamsHash() {
    return JSON.stringify({
      swingBars: this.swingBars,
      clusterDistancePct: this.clusterDistancePct,
      minTouches: this.minTouches,
      priceRangePct: this.priceRangePct
    });
  }

  async _saveLevelsToCache(swingHighs, swingLows, candlesLength, referencePrice) {
    try {
      const db = await this._openDB();
      const transaction = db.transaction([this._storeName], 'readwrite');
      const store = transaction.objectStore(this._storeName);

      const cacheData = {
        key: this._getCacheKey(),
        paramsHash: this._getParamsHash(),
        candlesLength: candlesLength,
        referencePrice: referencePrice,
        swingHighs: swingHighs,
        swingLows: swingLows,
        calculatedAt: Date.now()
      };

      store.put(cacheData);

      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });

      console.log(`[${this.symbol}] 💾 S&R v2: Caché guardado (${swingHighs.length} highs, ${swingLows.length} lows)`);
      db.close();
    } catch (error) {
      console.warn(`[${this.symbol}] ⚠️ S&R v2: Error guardando caché:`, error);
    }
  }

  async _loadLevelsFromCache(candlesLength, currentPrice) {
    try {
      const db = await this._openDB();
      const transaction = db.transaction([this._storeName], 'readonly');
      const store = transaction.objectStore(this._storeName);
      const request = store.get(this._getCacheKey());

      const result = await new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      db.close();

      if (!result) {
        console.log(`[${this.symbol}] 📭 S&R v2: No hay caché`);
        return null;
      }

      // Verificar parámetros
      if (result.paramsHash !== this._getParamsHash()) {
        console.log(`[${this.symbol}] 🔄 S&R v2: Parámetros cambiaron, invalidando caché`);
        return null;
      }

      // Verificar cantidad de velas (1% tolerancia)
      const lengthDiff = Math.abs(result.candlesLength - candlesLength);
      if (lengthDiff > Math.max(10, candlesLength * 0.01)) {
        console.log(`[${this.symbol}] 🔄 S&R v2: Cantidad de velas cambió (${result.candlesLength} → ${candlesLength})`);
        return null;
      }

      // Verificar que el precio de referencia no cambió mucho (>2%)
      const priceDiff = Math.abs(result.referencePrice - currentPrice) / currentPrice * 100;
      if (priceDiff > 2) {
        console.log(`[${this.symbol}] 🔄 S&R v2: Precio cambió significativamente (${result.referencePrice.toFixed(2)} → ${currentPrice.toFixed(2)})`);
        return null;
      }

      console.log(`[${this.symbol}] ✅ S&R v2: Usando caché (${result.swingHighs.length} highs, ${result.swingLows.length} lows)`);
      return {
        swingHighs: result.swingHighs,
        swingLows: result.swingLows
      };
    } catch (error) {
      console.warn(`[${this.symbol}] ⚠️ S&R v2: Error leyendo caché:`, error);
      return null;
    }
  }

  async _invalidateCache() {
    try {
      const db = await this._openDB();
      const transaction = db.transaction([this._storeName], 'readwrite');
      const store = transaction.objectStore(this._storeName);
      store.delete(this._getCacheKey());

      await new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });

      console.log(`[${this.symbol}] 🗑️ S&R v2: Caché invalidado`);
      db.close();
    } catch (error) {
      console.warn(`[${this.symbol}] ⚠️ S&R v2: Error invalidando caché:`, error);
    }
  }

  // ==================== Detección de Swings ====================

  /**
   * Detecta Swing Highs - máximos locales confirmados
   * Un Swing High requiere que sea el HIGH más alto de las N barras anteriores Y posteriores
   */
  _detectSwingHighs(candles) {
    const swings = [];
    const n = this.swingBars;

    for (let i = n; i < candles.length - n; i++) {
      const candle = candles[i];
      let isSwingHigh = true;

      // Verificar N barras a la izquierda
      for (let j = i - n; j < i; j++) {
        if (candles[j].high >= candle.high) {
          isSwingHigh = false;
          break;
        }
      }

      // Verificar N barras a la derecha
      if (isSwingHigh) {
        for (let j = i + 1; j <= i + n; j++) {
          if (candles[j].high >= candle.high) {
            isSwingHigh = false;
            break;
          }
        }
      }

      if (isSwingHigh) {
        swings.push({
          price: candle.high,
          timestamp: candle.timestamp,
          index: i,
          volume: candle.volume
        });
      }
    }

    return swings;
  }

  /**
   * Detecta Swing Lows - mínimos locales confirmados
   * Un Swing Low requiere que sea el LOW más bajo de las N barras anteriores Y posteriores
   */
  _detectSwingLows(candles) {
    const swings = [];
    const n = this.swingBars;

    for (let i = n; i < candles.length - n; i++) {
      const candle = candles[i];
      let isSwingLow = true;

      // Verificar N barras a la izquierda
      for (let j = i - n; j < i; j++) {
        if (candles[j].low <= candle.low) {
          isSwingLow = false;
          break;
        }
      }

      // Verificar N barras a la derecha
      if (isSwingLow) {
        for (let j = i + 1; j <= i + n; j++) {
          if (candles[j].low <= candle.low) {
            isSwingLow = false;
            break;
          }
        }
      }

      if (isSwingLow) {
        swings.push({
          price: candle.low,
          timestamp: candle.timestamp,
          index: i,
          volume: candle.volume
        });
      }
    }

    return swings;
  }

  /**
   * Calcula el Z-Score del volumen para un conjunto de velas
   */
  _calculateVolumeZScore(volume, candles, lookback) {
    if (candles.length < lookback) return 0;

    const recentVolumes = candles.slice(-lookback).map(c => c.volume);
    const mean = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const variance = recentVolumes.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / recentVolumes.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    return (volume - mean) / stdDev;
  }

  // ==================== Clustering ====================

  /**
   * Agrupa swings cercanos en precio
   * @param {Array} swings - Array de swings
   * @param {number} distancePct - % máximo de distancia para agrupar
   * @returns {Array} - Array de clusters
   */
  _clusterSwings(swings, distancePct) {
    if (swings.length === 0) return [];

    // Ordenar por precio
    const sorted = [...swings].sort((a, b) => a.price - b.price);
    const clusters = [];
    let currentCluster = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const avgClusterPrice = currentCluster.reduce((sum, s) => sum + s.price, 0) / currentCluster.length;
      const priceDiff = Math.abs(sorted[i].price - avgClusterPrice) / avgClusterPrice * 100;

      if (priceDiff <= distancePct) {
        currentCluster.push(sorted[i]);
      } else {
        clusters.push(currentCluster);
        currentCluster = [sorted[i]];
      }
    }
    clusters.push(currentCluster);

    return clusters;
  }

  /**
   * Convierte clusters a niveles con estadísticas
   */
  _clustersToLevels(clusters, candles, type) {
    const totalCandles = candles.length;

    return clusters.map(cluster => {
      // Precio promedio del cluster
      const avgPrice = cluster.reduce((sum, s) => sum + s.price, 0) / cluster.length;

      // Toques = cantidad de swings en el cluster
      const touches = cluster.length;

      // Volumen promedio del cluster
      const avgVolume = cluster.reduce((sum, s) => sum + s.volume, 0) / cluster.length;

      // Z-Score del volumen promedio
      const avgVolumeZScore = this._calculateVolumeZScore(avgVolume, candles, this.volumeLookbackBars);

      // Timestamps del primer y último toque
      const timestamps = cluster.map(s => s.timestamp).sort((a, b) => a - b);
      const firstTouch = timestamps[0];
      const lastTouch = timestamps[timestamps.length - 1];

      // Índice del último toque (para calcular recencia)
      const lastIndex = Math.max(...cluster.map(s => s.index));

      // Recencia: 0-1, donde 1 es el más reciente
      const recency = lastIndex / totalCandles;

      // Strength: combinación de toques, volumen y recencia
      // Fórmula: (toques * 2) + (volumeZScore normalizado) + (recencia * 3)
      const volumeBonus = Math.max(0, Math.min(3, avgVolumeZScore)); // 0-3 puntos
      const recencyBonus = recency * 3; // 0-3 puntos
      const strength = Math.min(10, (touches * 2) + volumeBonus + recencyBonus);

      return {
        price: avgPrice,
        touches: touches,
        strength: strength,
        avgVolumeZScore: avgVolumeZScore,
        firstTouch: firstTouch,
        lastTouch: lastTouch,
        recency: recency,
        type: type
      };
    });
  }

  // ==================== Cálculo Principal ====================

  /**
   * PARTE 1: Detecta swings y crea clusters (se cachea)
   */
  _calculateRawLevels(candles, currentPrice) {
    const startTime = Date.now();

    // 1. Calcular rango de precio para filtrar
    const priceMin = currentPrice * (1 - this.priceRangePct / 100);
    const priceMax = currentPrice * (1 + this.priceRangePct / 100);

    console.log(`[${this.symbol}] 📊 S&R v2: Buscando niveles en rango $${priceMin.toFixed(2)} - $${priceMax.toFixed(2)} (±${this.priceRangePct}% de $${currentPrice.toFixed(2)})`);

    // 2. Detectar TODOS los swings
    let swingHighs = this._detectSwingHighs(candles);
    let swingLows = this._detectSwingLows(candles);

    console.log(`[${this.symbol}] 📊 S&R v2: Detectados ${swingHighs.length} swing highs, ${swingLows.length} swing lows (total)`);

    // 3. Filtrar por rango de precio
    swingHighs = swingHighs.filter(s => s.price >= priceMin && s.price <= priceMax);
    swingLows = swingLows.filter(s => s.price >= priceMin && s.price <= priceMax);

    console.log(`[${this.symbol}] 📊 S&R v2: Después de filtro de rango: ${swingHighs.length} highs, ${swingLows.length} lows`);

    // 4. Filtrar por volumen mínimo (si está configurado)
    if (this.minVolumeZScore > 0) {
      swingHighs = swingHighs.filter(s => {
        const zScore = this._calculateVolumeZScore(s.volume, candles.slice(0, s.index + 1), this.volumeLookbackBars);
        return zScore >= this.minVolumeZScore;
      });
      swingLows = swingLows.filter(s => {
        const zScore = this._calculateVolumeZScore(s.volume, candles.slice(0, s.index + 1), this.volumeLookbackBars);
        return zScore >= this.minVolumeZScore;
      });
      console.log(`[${this.symbol}] 📊 S&R v2: Después de filtro de volumen (z>=${this.minVolumeZScore}): ${swingHighs.length} highs, ${swingLows.length} lows`);
    }

    const duration = Date.now() - startTime;
    console.log(`[${this.symbol}] 📊 S&R v2: Detección completada en ${duration}ms`);

    return { swingHighs, swingLows };
  }

  /**
   * PARTE 2: Clustering y clasificación (siempre se ejecuta)
   */
  _processLevels(rawLevels, candles, currentPrice) {
    const { swingHighs, swingLows } = rawLevels;

    console.log(`[${this.symbol}] 📊 S&R v2 _processLevels: ${swingHighs.length} highs, ${swingLows.length} lows en rango`);

    // 1. Clustering
    const resistanceClusters = this._clusterSwings(swingHighs, this.clusterDistancePct);
    const supportClusters = this._clusterSwings(swingLows, this.clusterDistancePct);

    console.log(`[${this.symbol}] 📊 S&R v2: ${resistanceClusters.length} clusters de resistencia, ${supportClusters.length} clusters de soporte`);

    // 2. Convertir clusters a niveles con stats
    let resistances = this._clustersToLevels(resistanceClusters, candles, 'resistance');
    let supports = this._clustersToLevels(supportClusters, candles, 'support');

    console.log(`[${this.symbol}] 📊 S&R v2: ${resistances.length} R antes de filtro minTouches, ${supports.length} S`);

    // 3. Filtrar por toques mínimos
    resistances = resistances.filter(r => r.touches >= this.minTouches);
    supports = supports.filter(s => s.touches >= this.minTouches);

    console.log(`[${this.symbol}] 📊 S&R v2: ${resistances.length} R después de filtro minTouches=${this.minTouches}, ${supports.length} S`);

    // 4. Clasificar activo/roto
    const recentBarsForBreak = Math.min(50, Math.floor(candles.length * 0.1));
    const recentCandles = candles.slice(-recentBarsForBreak);
    const recentHigh = Math.max(...recentCandles.map(c => c.high));
    const recentLow = Math.min(...recentCandles.map(c => c.low));

    // 5. Separar resistencias activas y rotas
    const activeResistances = resistances
      .filter(r => r.price > currentPrice && recentHigh <= r.price)
      .map(r => ({ ...r, status: 'active', distanceToPrice: r.price - currentPrice }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    const brokenResistances = resistances
      .filter(r => r.price > currentPrice && recentHigh > r.price)
      .map(r => ({ ...r, status: 'broken', distanceToPrice: r.price - currentPrice }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    // 6. Separar soportes activos y rotos
    const activeSupports = supports
      .filter(s => s.price < currentPrice && recentLow >= s.price)
      .map(s => ({ ...s, status: 'active', distanceToPrice: currentPrice - s.price }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    const brokenSupports = supports
      .filter(s => s.price < currentPrice && recentLow < s.price)
      .map(s => ({ ...s, status: 'broken', distanceToPrice: currentPrice - s.price }))
      .sort((a, b) => a.distanceToPrice - b.distanceToPrice);

    // 7. Combinar y limitar
    this.resistances = [
      ...activeResistances.slice(0, this.maxLevels),
      ...brokenResistances.slice(0, Math.max(0, this.maxLevels - activeResistances.length))
    ];

    this.supports = [
      ...activeSupports.slice(0, this.maxLevels),
      ...brokenSupports.slice(0, Math.max(0, this.maxLevels - activeSupports.length))
    ];

    this.currentPrice = currentPrice;

    console.log(`[${this.symbol}] ✅ S&R v2: ${this.resistances.length} resistencias (${activeResistances.length} activas), ${this.supports.length} soportes (${activeSupports.length} activos)`);
  }

  /**
   * Calcula S&R - SÍNCRONO para poder usarse en renderOverlay
   * El caché de IndexedDB se carga/guarda de forma async en background
   */
  calculateFromCandles(candles) {
    if (!candles || candles.length < this.swingBars * 2 + 1) {
      console.warn(`[${this.symbol}] S&R v2: No hay suficientes velas (${candles?.length || 0})`);
      return;
    }

    const currentPrice = candles[candles.length - 1].close;
    console.log(`[${this.symbol}] 📊 S&R v2: Procesando ${candles.length} velas, precio actual: $${currentPrice.toFixed(2)}`);

    let rawLevels = null;

    // 1. Usar caché en memoria si existe
    if (this._cachedRawLevels) {
      rawLevels = this._cachedRawLevels;
      console.log(`[${this.symbol}] ⚡ S&R v2: Usando caché en memoria`);
    }

    // 2. Si no hay caché, calcular (síncrono)
    if (!rawLevels) {
      console.log(`[${this.symbol}] 🔄 S&R v2: Calculando niveles...`);
      rawLevels = this._calculateRawLevels(candles, currentPrice);
      this._cachedRawLevels = rawLevels;

      // Guardar en IndexedDB (async en background, no bloqueante)
      this._saveLevelsToCache(rawLevels.swingHighs, rawLevels.swingLows, candles.length, currentPrice);
    }

    // 3. Procesar niveles (clustering + clasificación) - SÍNCRONO
    this._processLevels(rawLevels, candles, currentPrice);

    this._lastCalculatedLength = candles.length;
    this._calculationValid = true;

    console.log(`[${this.symbol}] ✅ S&R v2: Cálculo completo - ${this.resistances.length} R, ${this.supports.length} S`);
  }

  // ==================== Playback ====================

  updatePlaybackDate(timestamp) {
    this._currentPlaybackTime = timestamp;

    if (this._lastPlaybackTime && timestamp !== this._lastPlaybackTime) {
      this._calculationValid = false;
      this._cachedRawLevels = null; // Invalidar caché porque el precio de referencia cambió
      this._renderLoggedOnce = false;
      this._noDataLoggedOnce = false;
      this._fallbackLoggedOnce = false;
    }
    this._lastPlaybackTime = timestamp;
  }

  // ==================== Renderizado ====================

  renderOverlay(ctx, bounds, visibleCandles, allCandles, priceContext) {
    if (!this.enabled) {
      console.log(`[${this.symbol}] ⛔ S&R v2: Indicador DESHABILITADO, no renderizando`);
      return;
    }

    // 🔍 DEBUG: Verificar contexto del canvas
    if (!ctx) {
      console.error(`[${this.symbol}] ❌ S&R v2: ctx es null/undefined!`);
      return;
    }

    // Calcular S&R si tenemos velas
    if (allCandles && allCandles.length > 0) {
      let candlesToUse = allCandles;

      // Filtrar por playback time
      if (this._currentPlaybackTime) {
        candlesToUse = allCandles.filter(c => c.timestamp <= this._currentPlaybackTime);
      } else if (visibleCandles && visibleCandles.length > 0) {
        const lastVisibleTs = visibleCandles[visibleCandles.length - 1].timestamp;
        candlesToUse = allCandles.filter(c => c.timestamp <= lastVisibleTs);

        if (!this._fallbackLoggedOnce) {
          console.log(`[${this.symbol}] 🔄 S&R v2: Usando visibleCandles como referencia`);
          this._fallbackLoggedOnce = true;
        }
      }

      const needsRecalculation = !this._calculationValid ||
                                 (this.resistances.length === 0 && this.supports.length === 0) ||
                                 candlesToUse.length !== this._lastCalculatedLength;

      if (needsRecalculation && candlesToUse.length > 0) {
        this.calculateFromCandles(candlesToUse);
        this._renderLoggedOnce = false;
        this._drawLoggedOnce = false;
      }
    }

    // Verificar datos
    if (this.resistances.length === 0 && this.supports.length === 0) {
      if (!this._noDataLoggedOnce) {
        console.warn(`[${this.symbol}] ⚠️ S&R v2: No hay niveles para renderizar`);
        this._noDataLoggedOnce = true;
      }
      return;
    }
    this._noDataLoggedOnce = false;

    const { width, height, minPrice, maxPrice, timeToX, priceToY } = priceContext;

    // Log una vez
    if (!this._renderLoggedOnce) {
      console.log(`[${this.symbol}] 🎨 S&R v2: Renderizando ${this.resistances.length} R, ${this.supports.length} S (precio: $${this.currentPrice?.toFixed(2)})`);
      this._renderLoggedOnce = true;
    }

    ctx.save();

    // Renderizar resistencias
    if (this.showResistances) {
      this.resistances.forEach((level, idx) => {
        this._drawLevel(ctx, level, 'resistance', bounds, priceContext, idx);
      });
    }

    // Renderizar soportes
    if (this.showSupports) {
      this.supports.forEach((level, idx) => {
        this._drawLevel(ctx, level, 'support', bounds, priceContext, idx);
      });
    }

    ctx.restore();
  }

  _drawLevel(ctx, level, type, bounds, priceContext, index) {
    // 🔧 FIX: width viene de bounds, no de priceContext
    const { minPrice, maxPrice, priceToY } = priceContext;
    const { width, height } = bounds;

    // Log de diagnóstico
    if (!this._drawLoggedOnce) {
      console.log(`[${this.symbol}] 🎨 S&R v2 _drawLevel: level.price=${level.price.toFixed(2)}, minPrice=${minPrice?.toFixed(2)}, maxPrice=${maxPrice?.toFixed(2)}, bounds.width=${width}`);
    }

    // Verificar que el nivel está en el rango visible
    if (level.price < minPrice || level.price > maxPrice) {
      if (!this._drawLoggedOnce) {
        console.log(`[${this.symbol}] ⚠️ S&R v2: Nivel ${level.price.toFixed(2)} fuera de rango visible [${minPrice?.toFixed(2)} - ${maxPrice?.toFixed(2)}]`);
      }
      return;
    }

    const y = priceToY(level.price);
    if (!this._drawLoggedOnce) {
      console.log(`[${this.symbol}] 🎨 S&R v2: y=${y}, height=${height}, width=${width}`);
    }
    if (y < 0 || y > height) return;

    // Colores base - FIJOS Y VISIBLES
    const isResistance = type === 'resistance';
    const baseColor = isResistance ? "#FF0000" : "#00FF00"; // Rojo y verde puros

    // Estilo según status - SIEMPRE VISIBLE
    let alpha = 1.0; // Alpha máximo
    let lineStyle = [];
    let lineWidth = 3; // Línea gruesa

    if (level.status === 'broken') {
      alpha = 0.6;
      lineStyle = [8, 4]; // Punteado
      lineWidth = 2;
    }

    const strokeColor = this._hexToRgba(baseColor, alpha);

    // Log del dibujo
    if (!this._drawLoggedOnce) {
      console.log(`[${this.symbol}] 🖌️ S&R v2 DIBUJANDO: y=${y.toFixed(0)}, width=${width}, color=${strokeColor}, lineWidth=${lineWidth}`);
      this._drawLoggedOnce = true;
    }

    // Dibujar línea
    // 🔧 FIX: Usar bounds.x como inicio y bounds.x + width como final
    const startX = bounds.x || 0;
    const endX = startX + width;

    ctx.beginPath();
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.setLineDash(lineStyle);
    ctx.moveTo(startX, y);
    ctx.lineTo(endX, y);
    ctx.stroke();
    ctx.setLineDash([]);

    // 🔍 DEBUG: Confirmar que se dibujó
    console.log(`[${this.symbol}] ✅ S&R v2: LÍNEA DIBUJADA - type=${type}, price=${level.price.toFixed(2)}, y=${y.toFixed(0)}, x=${startX}-${endX}, color=${strokeColor}`);

    // Dibujar etiqueta (lado izquierdo, sin fondo)
    if (this.showLabels) {
      const labelText = `${isResistance ? 'R' : 'S'}${index + 1}: $${level.price.toFixed(2)} (${level.touches}t, ${level.strength.toFixed(1)}★)`;
      const labelX = startX + 5;
      const labelY = y - 3;

      ctx.font = '10px Arial';
      ctx.fillStyle = this._hexToRgba(baseColor, level.status === 'broken' ? 0.6 : 1);
      ctx.textAlign = 'left';
      ctx.fillText(labelText, labelX, labelY);
    }
  }

  _hexToRgba(hex, alpha) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }

  // ==================== Configuración ====================

  updateConfig(config) {
    console.log(`[${this.symbol}] S&R v2 updateConfig:`, config);

    const recalculateParams = ['swingBars', 'clusterDistancePct', 'minTouches', 'priceRangePct',
                               'minVolumeZScore', 'volumeLookbackBars', 'maxLevels'];
    let needsRecalculate = false;

    if (config.swingBars !== undefined) this.swingBars = config.swingBars;
    if (config.clusterDistancePct !== undefined) this.clusterDistancePct = config.clusterDistancePct;
    if (config.minTouches !== undefined) this.minTouches = config.minTouches;
    if (config.priceRangePct !== undefined) this.priceRangePct = config.priceRangePct;
    if (config.minVolumeZScore !== undefined) this.minVolumeZScore = config.minVolumeZScore;
    if (config.volumeLookbackBars !== undefined) this.volumeLookbackBars = config.volumeLookbackBars;
    if (config.maxLevels !== undefined) this.maxLevels = config.maxLevels;
    if (config.showResistances !== undefined) this.showResistances = config.showResistances;
    if (config.showSupports !== undefined) this.showSupports = config.showSupports;
    if (config.showLabels !== undefined) this.showLabels = config.showLabels;

    for (const param of recalculateParams) {
      if (config[param] !== undefined) {
        needsRecalculate = true;
        break;
      }
    }

    if (needsRecalculate) {
      console.log(`[${this.symbol}] S&R v2: Config changed, invalidating cache`);
      this._calculationValid = false;
      this._cachedRawLevels = null;
      this._invalidateCache();
      this._renderLoggedOnce = false;
    }
  }

  clearData() {
    this.resistances = [];
    this.supports = [];
    this.currentPrice = 0;
    this._calculationValid = false;
    this._cachedRawLevels = null;
  }

  render(ctx, bounds, visibleCandles) {
    // No renderiza en panel - se dibuja sobre el chart
  }

  getHeight() {
    return 0;
  }
}

export default SupportResistance2Indicator;
